# Persistence

ConjureDB's persistence layer protects in-memory data against process crashes
and device restarts. It combines periodic **snapshots** (full-state dumps) with
a **write-ahead journal** (per-transaction change log) to provide configurable
durability guarantees — from zero-overhead in-memory-only mode to fully durable
encrypted storage with cloud sync.

**See also:** [Transactions](/docs/engine/transactions) · [PGO](/docs/performance/pgo) · [Getting Started](/docs/getting-started)

---

## Architecture Overview

```text
                    ┌─────────────────────────────────────────────┐
                    │              DbContext                       │
                    │  Commit() ─────────┬───────────────────────  │
                    └────────────────────┼────────────────────────┘
                                         │
                                         ▼
                    ┌─────────────────────────────────────────────┐
                    │         Serialized Background Worker Lane    │
                    │                                             │
                    │  1. Sync secondary indices                  │
                    │  2. Write journal entry (ChangeRecord)      │
                    │  3. Write TransactionEnd marker             │
                    │  4. Adaptive flush to disk                  │
                    │  5. Trigger snapshot (if threshold reached) │
                    └──────────────┬──────────────┬───────────────┘
                                   │              │
                        ┌──────────▼──┐    ┌──────▼───────────┐
                        │   Journal   │    │    Snapshot       │
                        │ (WAL files) │    │ (full-state file) │
                        └──────┬──────┘    └──────┬───────────┘
                               │                  │
                    ┌──────────▼──────────────────▼───────────────┐
                    │        Optional Encryption Layer             │
                    │   AES-GCM (4 KB chunks, per-chunk auth)     │
                    └──────────────┬──────────────────────────────┘
                                   │
                    ┌──────────────▼──────────────────────────────┐
                    │          File System / Remote Storage        │
                    └─────────────────────────────────────────────┘
```

### Persistence Mechanisms Comparison

| Mechanism | Purpose | Granularity | Survives Crash | File Location |
|-----------|---------|-------------|---------------|---------------|
| **Snapshot** | Full database state | Periodic (configurable) | ✅ | `<DataDir>/snapshots/` |
| **Journal (WAL)** | Per-transaction log | Every commit | ✅ (after flush) | `<DataDir>/journal/` |
| **Delta Snapshot** | Modified entities only | Periodic (incremental) | ✅ | `<DataDir>/snapshots/` |
| **Remote Snapshot** | Cloud backup | On demand / periodic | ✅ (off-device) | Cloud storage |

---

## Snapshots

### How Snapshots Work

`SnapshotHandler` serializes the entire database state into a single binary
file. Only `DbSet`s satisfying **both** conditions are included:

1. `Count > 0` — empty collections are skipped.
2. `PersistenceType != None` — collections excluded from persistence are skipped.

Serialization uses an `ArrayBufferWriter<byte>` with a default capacity of
**64 KB** that grows as needed.

### Binary Format (V5)

```text
┌──────────────────────────────────────┐
│ Magic Header     (8 bytes)           │  "UMDBV2\0\0" (0x554D_4442_5632_0000)
├──────────────────────────────────────┤
│ Format Version   (2 bytes)           │  ushort: 5 (supports v2+)
├──────────────────────────────────────┤
│ Epoch            (8 bytes)           │  ulong: monotonic snapshot version
├──────────────────────────────────────┤
│ Schema Length    (4 bytes)           │  uint: byte length of schema section
├──────────────────────────────────────┤
│ Encryption Flag  (1 byte)            │  0 = plaintext, 1 = encrypted
├──────────────────────────────────────┤
│ Schema CRC-32    (4 bytes)           │  CRC-32 of schema section
├──────────────────────────────────────┤
│ Schema Section   (N bytes)           │  typed schema descriptors
├──────────────────────────────────────┤
│ DbSet Count      (4 bytes)           │  int: number of serialized collections
├──────────────────────────────────────┤
│ ┌──────────────────────────────────┐ │
│ │ SectionLength  (4 bytes)         │ │  int: byte length of section payload
│ │ Section CRC-32 (4 bytes)         │ │  CRC-32 of section payload
│ │ TypeId         (2 bytes)         │ │  ushort: schema `type_id` value
│ │ MaxId          (4 bytes)         │ │  int: persisted identity allocator max
│ │ DataLength     (4 bytes)         │ │  int: byte length of serialized data
│ │ Data           (N bytes)         │ │  MessagePack-serialized collection
│ └──────────────────────────────────┘ │
│          ... repeated per DbSet ...  │
└──────────────────────────────────────┘
```

V5 snapshots fail fast when the schema checksum or any DbSet section checksum
does not match. Encrypted snapshots are also authenticated by AES-GCM per
chunk; the V5 CRC framing protects plaintext snapshots and catches accidental
corruption before data is applied to live collections.

### Durable Publication Contract

Full and incremental snapshots are published through the same fail-closed
sequence: write a `*.tmp` file, flush its payload to storage, atomically rename
it to `*.dat`, then sync the parent directory. A full snapshot is additionally
read and validated after publication; delta snapshots are decoded and validated
before their dirty-tracking cursor advances. A failure after rename removes the
final file and syncs that deletion before the operation can be retried.
Normal retention and superseded-delta cleanup delete the complete eligible
batch first, then issue one parent-directory sync if at least one file was
removed. A failure of either maintenance sync is logged but does not invalidate
an already published and validated full snapshot; publication rollback failures
remain part of the failing write attempt.

Files ending in `*.tmp` are never recovery candidates. They model a process
interruption before publication and are ignored rather than promoted. On
platforms where directory fsync is supported, the directory sync is the
durability barrier for file creation, rename, and deletion metadata. Windows
uses the platform-specific supported persistence contract and does not issue a
directory fsync.

### File Naming and Retention

| Property | Value |
|----------|-------|
| Directory | `<DataDirectory>/snapshots/` |
| File pattern | `snapshot_{UnixTimeMilliseconds}.dat` |
| Retention | `MaxSnapshotsToKeep` (default **10**) |
| Cleanup | After each new snapshot, oldest files exceeding limit are deleted |

File names use 13-digit `UnixTimeMilliseconds`, so lexicographic order equals
chronological order.

### Snapshot Triggers

Snapshots can be triggered by:

| Trigger | Description |
|---------|-------------|
| **Periodic timer** | `AutomaticSnapshotInterval` (default 5 min) |
| **Change threshold** | `MaxStateChangesBeforeSnapshot` (default 100 entity mutations) |
| **Queue depth** | `QueueThresholdForSnapshot` (default 10 pending journal entries) |
| **Manual** | `DbContext.SaveAsync()` |
| **Post-migration** | Automatic if `SnapshotAfterMigration` enabled |

### Snapshot Guards

A snapshot is **skipped** if:

- Another snapshot is already in progress (semaphore guard).
- Secondary index synchronization is ongoing.
- `Version` has not changed since the last snapshot.

### Incremental (Delta) Snapshots

When enabled, delta snapshots serialize only entities modified since the last
snapshot, dramatically reducing I/O for large databases with localized writes.

```text
┌────────────┐    ┌────────────┐    ┌────────────┐    ┌──────────────┐
│ Full Snap  │───▶│  Delta 1   │───▶│  Delta 2   │───▶│  Delta 3     │
│ (epoch 0)  │    │ (epoch 1)  │    │ (epoch 2)  │    │ (epoch 3)    │
└────────────┘    └────────────┘    └────────────┘    └──────────────┘
                                                            │
                                                   chain length = 3
                                                   (max default: 10)
```

**Delta chain rules:**

| Rule | Default | Description |
|------|---------|-------------|
| `MaxDeltaChainLength` | 10 | Force a full snapshot after this many deltas |
| `DeltaToFullThreshold` | 0.5 | Force a full snapshot if dirty-entity ratio exceeds 50% |

When the chain length or dirty ratio exceeds the threshold, the next snapshot
is automatically a full snapshot, resetting the chain.

**Delta snapshot format** preserves its compact header: magic, base epoch, new
epoch, transaction version, and DbSet-section count. Epochs describe dirty
tracking, but the **transaction version in the decoded header** is the durable
recovery identity. Recovery does not trust delta filenames for ordering.

Before applying any delta, recovery reads each typed header and ignores a delta
whose transaction version is less than or equal to the loaded full snapshot;
its obsolete body is not decoded. It fully parses every newer candidate before
mutation and rejects negative section/entity/removal counts, duplicate type
sections, and trailing bytes. A finalized delta must declare at least one DbSet
section, and every declared section must contain at least one added, updated, or
removed entity; the writer never publishes empty deltas or empty sections.
Remaining candidates are sorted by transaction
version and duplicate versions are rejected. Parsing or validation failure fails
startup before delta state is mutated; it never silently falls back to a partial
chain. Valid deltas are then applied as one transaction and advance the
effective durable version to the highest accepted delta header.

---

## Journal (Write-Ahead Log)

The journal records every committed transaction as a sequence of `ChangeRecord`
entries. If the process crashes between snapshots, journal replay recovers the
missing transactions.

### Pipeline Architecture

```text
 worker lane (commit)          JournalRecordQueue            "ConjureDB journal" thread
    │                              │                                 │
    │  ChangeRecord per change,    │  bounded ring                   │
    │  TransactionEnd marker       │  (ChannelCapacity: 1024)        │
    │─────────────────────────────>│  woken at each transaction end  │
    │                              │  and at half capacity           │
    │                              │────────────────────────────────>│ serialize + frame
    │                              │                                 │ via JournalBufferManager (64 KB)
    │                              │                                 │ write + OS flush per transaction
    │                              │                                 │ file rotation
 Commit() with a forced flush ──── drains the queue and syncs the file itself (no lane, no ThreadPool)
```

- **Batched (`FastMobile`)**: the journal thread persists each committed transaction to the OS promptly after
  its transaction-end marker (no physical sync), coalescing whatever is queued into one drain.
- **Flush per commit (`CriticalState`, `ForceFlushEveryCommit`, `CommitAsync(forceFlush: true)`)**: the committing
  thread drains the queue and syncs the journal file (`FlushFileBuffers` / `fsync`) before the commit returns.
- **Backpressure**: a producer that finds the queue full blocks on a monitor until a drain frees a slot (timeout
  `StateChangeEnqueueTimeout`, 5 s); a terminal journal fault wakes it at once and it rethrows the fault.
- **`WorkerExecutionMode.Inline`**: no journal thread; the committing thread writes the transaction through after
  the commit, and a producer that finds the queue full drains it itself.
- No journal path uses the ThreadPool, a `Task` or a timer; see
  [Concurrency Control — Journal thread](/docs/engine/concurrency#journal-thread).

### ChangeRecord Structure

Each journal record is MessagePack-serialized:

| Field | Type | Description |
|-------|------|-------------|
| `EntityTypeId` | `ushort` | The schema `type_id` value |
| `OperationType` | `ChangeType` | `Insert`, `Update`, or `Delete` |
| `ChangesCount` | `uint` | Number of entities in this batch |
| `SerializedChange` | `byte[]` | MessagePack-serialized entity data |
| `DataLength` | `int` | Length of `SerializedChange` |
| `Version` | `ulong` | Transaction version (monotonic) |
| `Type` | `ChangeRecordType` | `Change` or `TransactionEnd` marker |

A committed transaction produces one or more `Change` records followed by
exactly one `TransactionEnd` record. **Transactions without a `TransactionEnd`
marker are considered incomplete and discarded during recovery.**

### Entry Wire Format

Each entry on disk uses magic-prefixed framing with CRC-32 integrity:

```text
┌─────────────────────────────────┐
│ Magic          (4 bytes)        │  "UMJE" (0x554D4A45)
├─────────────────────────────────┤
│ Payload Length (4 bytes)        │  int: byte length of payload
├─────────────────────────────────┤
│ CRC-32         (4 bytes)        │  Checksum of payload
├─────────────────────────────────┤
│ Payload        (N bytes)        │  MessagePack(ChangeRecord)
└─────────────────────────────────┘
```

The magic bytes enable detection of corrupt or truncated entries. The CRC-32
checksum validates payload integrity during recovery.

### File Naming and Rotation

| Property | Value |
|----------|-------|
| Directory | `<DataDirectory>/journal/` |
| File pattern | `journal_{Ticks}.dat` |
| Rotation trigger | File size exceeds `MaxJournalFileSize` (default **2 MB**) |
| Rotation action | Flush + close current file, create new file |

### Adaptive Flush Interval

Committed transactions never wait for an interval: each transaction-end marker wakes the journal thread. The
interval governs only records of a transaction still in progress (a large transaction's records the thread has
already framed into its buffer): while such a partial buffer or queued records exist, the thread parks for the
adaptive interval and then writes them out.

| Condition | Interval |
|-----------|----------|
| Base | `FlushInterval` (100 ms) |
| Write ops/sec ≥ `HighWriteOpsPerSecond` (100) | half, not below `MinFlushIntervalMs` (100 ms) |
| Battery low (`IBatteryStatusProvider`) | double, not above `MaxFlushIntervalMs` (5000 ms) |

With nothing pending the thread parks without a timeout: an idle game does not wake it.

-----------|----------|
| Write ops/sec ≥ `HighWriteOpsPerSecond` (100) | Accelerate toward `MinFlushIntervalMs` (100 ms) |
| Write ops/sec < threshold | Decelerate toward `MaxFlushIntervalMs` (5000 ms) |
| Battery low (`IBatteryStatusProvider`) | Decelerate to `MaxFlushIntervalMs` (5000 ms) |
| Base interval | `FlushInterval` (100 ms) |

This adaptive strategy balances durability against I/O cost:
- **High-throughput bursts** → low-latency flushes (100 ms)
- **Idle periods** → reduced disk activity (up to 5 s)
- **Low battery** → deferred writes to conserve power

---

## Recovery

On startup, `DbContextBuilder.Build()` (or `BuildAsync()`) executes a
multi-phase recovery sequence. No manual intervention is required.

### Recovery Flow

```text
            ┌──────────────────────────┐
            │ Phase 1: Remote Snapshot │
            │ (if IRemoteSnapshotHandler│
            │  is configured)          │
            └────────────┬─────────────┘
                         │
                         ▼
            ┌──────────────────────────┐
            │ Phase 2: Local Snapshot  │
            │ Load latest snapshot_*.dat│
            │ Apply schema migrations  │
            └────────────┬─────────────┘
                         │
                         ▼
            ┌──────────────────────────┐
            │ Phase 2a: Delta Replay   │
            │ (if incremental enabled) │
            │ Replay delta chain       │
            └────────────┬─────────────┘
                         │
                         ▼
            ┌──────────────────────────┐
            │ Phase 3: Journal Replay  │
            │ Replay journal_*.dat     │
            │ Skip version ≤ snapshot  │
            │ Discard incomplete txns  │
            └────────────┬─────────────┘
                         │
                         ▼
            ┌──────────────────────────┐
            │ Phase 4: Post-Migration  │
            │ (if schema migrated)     │
            │ Take immediate snapshot  │
            └──────────────────────────┘
```

### Phase 1 — Remote Snapshot (if configured)

If an `IRemoteSnapshotHandler` is registered, the engine queries the remote
version and compares it with the local snapshot version:

| Strategy | Behavior |
|----------|----------|
| `RemoteFirst` (default) | Use remote if its version ≥ local; otherwise local |
| `LocalFirst` | Use local if available; otherwise download remote |
| `ForceRemote` | Always download and use the remote snapshot |
| `ForceLocal` | Always use the local snapshot; ignore remote |

The remote version returned by `GetRemoteVersionAsync()` is used only to select
the winning source. It is not a journal-replay fence. After a remote source wins,
the durable fence is the maximum of the local full-snapshot header and the
`DbContext.Version` actually established by `LoadSnapshotAsync()`. A provider
that advertises a newer version but performs no load cannot suppress journal
transactions in that gap.

### Phase 2 — Local Snapshot Load

1. Scan `<DataDirectory>/snapshots/` for `snapshot_*.dat` files.
2. Select the most recent file (by filename).
3. Deserialize according to the binary format (magic → version → epoch → data).
4. Apply schema migrations if the schema has changed
   (`MigrationOrchestrator`).

### Phase 2a — Delta Replay (if incremental enabled)

1. Discover only finalized `delta_*.dat` files; ignore `*.tmp` files.
2. Read every typed header before mutation; ignore a delta whose header
   transaction version is less than or equal to the loaded full-snapshot
   version.
3. Fully parse every newer candidate before mutation and validate its complete
   payload, including the non-zero section count and non-empty section shape.
4. Sort newer deltas by header transaction version and reject duplicate
   versions.
5. Apply the validated chain atomically. Any malformed or unreadable candidate
   fails recovery without partially applying the chain.

### Phase 3 — Journal Replay

1. Discover all journal files in `<DataDirectory>/journal/`.
2. Sort **oldest-first** by filename (ticks-based naming ensures correct order).
3. Capture the effective durable version: the maximum of the loaded full
   snapshot and the highest applied delta. When remote state wins, use the
   version actually established by the remote load, never its advertised
   selection version, and still retain the local full-header lower bound.
4. Read entries sequentially:
   - **Skip** entries with `Version ≤ effective durable version`.
   - **Group** entries by `Version`.
   - **Apply** only groups that have a `TransactionEnd` marker.
   - **Discard** the last group if `TransactionEnd` is missing (incomplete
     transaction).
5. Handle corruption per `JournalCorruptionPolicy`:
   - `StopAtCorruption` (default) — halt recovery at first corrupt entry.
   - Other policies allow skipping corrupt entries with diagnostic logging.
   - `Fail` is required for `DurabilityPolicy.CriticalState` and
     `DurabilityPolicy.ForceFlushEveryCommit`, so high-value durability
     profiles do not accept partial journal replay.

### Phase 4 — Post-Migration Snapshot

If schema migrations were applied during Phase 2, and `SnapshotAfterMigration`
is enabled, an immediate snapshot is taken. This prevents re-running migrations
on the next startup.

### Recovery Guarantees

| Guarantee | Description |
|-----------|-------------|
| **Atomicity** | Only fully committed transactions (with `TransactionEnd`) are replayed |
| **Ordering** | Journal entries are replayed in version order |
| **Idempotency** | Replaying already-applied entries (version ≤ effective durable version) is skipped |
| **Integrity** | CRC-32 validates each journal entry; corrupt entries are handled per policy |

---

## Encryption

ConjureDB supports AES-GCM authenticated encryption for data at rest.
When enabled, both snapshot and journal files are transparently encrypted.
For the explicit security boundary and operational assumptions, see
[Encryption Threat Model](/docs/engine/encryption-threat-model).

### Cryptographic Details

Encryption uses AES-GCM with PBKDF2 (SHA-256, **100,000 iterations**) key
derivation; see [Encryption Configuration](/docs/engine/configuration#encryption-configuration)
for algorithm, key-size, and chunk parameters. The persistence-specific on-disk
nonce layout is 12 bytes: `[fileNonceSalt(4)][chunkIndex(8)]`, where
`fileNonceSalt` is generated randomly for every encrypted file write.

### Chunk-Based Encryption Format

```text
File Layout:
┌────────────────────┐
│ Salt    (4 bytes)   │  Random per-file nonce salt
├────────────────────┤
│ ┌────────────────┐ │
│ │ Nonce (12 B)   │ │  [fileNonceSalt(4)][chunkIndex(8)]
│ │ Length (4 B)    │ │  Plaintext length
│ │ Ciphertext (N) │ │  Encrypted payload
│ │ Tag   (16 B)   │ │  GCM authentication tag
│ └────────────────┘ │
│  ... repeated ...  │
└────────────────────┘
```

GCM mode provides both **confidentiality** (encryption) and **integrity**
(authentication). Any tampering with the ciphertext is detected during
decryption and causes an authentication failure.

The 4-byte `fileNonceSalt` is stored in the encrypted file header and is
independent from the PBKDF2 `EncryptionOptions.Salt`. It is generated fresh for
each encrypted chunked file write, including rewrites of the same path. The
8-byte chunk counter is monotonic within a file and fails before reuse.

### Key Management

**Salt generation:**

```csharp
// Generate a cryptographically random salt
var salt = EncryptionOptions.GenerateRandomSalt();
// Returns a 32-byte random value, base64-encoded
```

**Key derivation:**

```csharp
// PBKDF2: password + salt → AES key
using var kdf = new Rfc2898DeriveBytes(
    password, saltBytes,
    iterations: 100_000,
    hashAlgorithm: HashAlgorithmName.SHA256);
byte[] key = kdf.GetBytes(keySizeBytes); // 16, 24, or 32 bytes
```

**Critical requirements:**

| Requirement | Details |
|-------------|---------|
| Salt uniqueness | Each database instance must use a unique salt |
| Salt persistence | The salt must be stored and reused to decrypt existing files |
| Salt minimum size | ≥16 bytes UTF-8 encoded (validated by `EncryptionOptions.Validate()`) |
| Password entropy | Use a high-entropy passphrase — never hard-code in source |
| Password storage | Load from secure configuration or secrets manager |

### EncryptionOptions Reference

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `IsEnabled` | `bool` | `false` | Master switch for encryption |
| `Password` | `string` | *(required)* | Passphrase for PBKDF2 key derivation |
| `KeySizeInBits` | `int` | 256 | AES key length: 128, 192, or 256 |
| `Salt` | `string` | *(required)* | Base64-encoded random salt (≥16 bytes) |
| `CustomProtectedFileStreamFactory` | `IProtectedFileStreamFactory` | `null` | Override default encryption implementation |

### Configuration

```csharp
var context = DbContextBuilder<GameDbContext>.Create()
    .WithDataDirectory("./data")
    .WithEncryption(enc => enc
        .Password(Environment.GetEnvironmentVariable("DB_PASSWORD"))
        .KeySizeInBits(256)
        .Salt(EncryptionOptions.GenerateRandomSalt()))
    .Build();
```

### Custom File Stream Factory

For advanced scenarios (hardware security modules, envelope encryption,
custom key management), implement `IProtectedFileStreamFactory`:

```csharp
public interface IProtectedFileStreamFactory
{
    Stream CreateReadStream(string filePath);
    Stream CreateWriteStream(string filePath);
}
```

Register via `EncryptionOptions.CustomProtectedFileStreamFactory` to replace
the default `ChunkedAesGcmStreamWriter/Reader` implementation.

---

## Remote Sync

For tables with `PersistenceType.Remote`, the persistence layer supports
uploading snapshots to cloud storage for cross-device state transfer.

### IRemoteSnapshotHandler Interface

```csharp
public interface IRemoteSnapshotHandler : IAsyncDisposable
{
    Task<ulong?> GetRemoteVersionAsync();
    Task LoadSnapshotAsync(DbContext context);
    Task UploadSnapshotAsync(DbContext context, ulong version);
    ValueTask DisposeAsync();
}
```

Implement this interface to integrate with any cloud storage provider
(S3, Azure Blob, Firebase, Google Cloud Storage, custom backend).

### RemoteSnapshotOptions Reference

For the full `RemoteSnapshotOptions` parameter table (`OwnedByContext`, `BorrowedByCaller`, `RequestTimeout`, `MaxRetryAttempts`, `ResolutionStrategy`), see [Remote Sync Parameters Summary](/docs/engine/configuration#remote-sync-parameters-summary). `StateResolutionStrategy` conflict handling is described in [Recovery Phase 1](#phase-1--remote-snapshot-if-configured) above.

### Conflict Resolution Strategies

| Strategy | Local Available | Remote Newer | Action |
|----------|----------------|-------------|--------|
| `RemoteFirst` | Yes | Yes | Use remote |
| `RemoteFirst` | Yes | No | Use local |
| `RemoteFirst` | No | — | Use remote |
| `LocalFirst` | Yes | — | Use local |
| `LocalFirst` | No | — | Use remote |
| `ForceRemote` | — | — | Always remote |
| `ForceLocal` | — | — | Always local |

### Configuration

```csharp
var context = DbContextBuilder<GameDbContext>.Create()
    .WithDataDirectory("./data")
    .WithRemoteSnapshot(rem => rem
        .OwnedByContext(new FirebaseSnapshotHandler(firebaseConfig))
        .ResolutionStrategy(StateResolutionStrategy.LocalFirst)
        .MaxRetryAttempts(5)
        .RequestTimeout(TimeSpan.FromSeconds(30)))
    .Build();
```

---

## Serialization

The persistence layer uses `IBinarySerializer` for all entity serialization,
with MessagePack as the default implementation.

### IBinarySerializer Interface

```csharp
public interface IBinarySerializer
{
    byte[] Serialize<T>(T obj);
    void Serialize<T>(IBufferWriter<byte> writer, T obj);    // zero-copy
    T Deserialize<T>(ReadOnlyMemory<byte> data);              // zero-copy
    T Deserialize<T>(byte[] data);
}
```

| Overload | Allocation Behavior | Use Case |
|----------|-------------------|----------|
| `Serialize<T>(T)` | Allocates `byte[]` | Simple serialization |
| `Serialize<T>(IBufferWriter, T)` | Zero-copy into snapshot buffer | Snapshot serialization |
| `Deserialize<T>(ReadOnlyMemory)` | Zero-copy from pooled buffer | Snapshot deserialization |
| `Deserialize<T>(byte[])` | Reads from byte array | Journal deserialization |

### Custom Serializer

```csharp
var context = DbContextBuilder<GameDbContext>.Create()
    .WithSerializer(new MyCustomSerializer())
    .Build();
```

Your custom serializer must handle all entity types used in persisted `DbSet`s.

---

## Schema Migration

When the database schema changes (entities added/removed/modified), the
`MigrationOrchestrator` detects schema differences during snapshot load and
applies registered migrations in order. For the full migration flow, detection
rules, and configuration, see [Schema Migration](/docs/schema/schema-migration).

---

## Configuration Reference

For the full `SnapshotOptions` and `JournalOptions` parameter tables (types,
defaults, and descriptions), see
[Snapshot Parameters Summary](/docs/engine/configuration#snapshot-parameters-summary) and
[Journal Parameters Summary](/docs/engine/configuration#journal-parameters-summary).
The on-disk format and recovery architecture those options govern are described
in the [Snapshots](#snapshots) and [Journal (Write-Ahead Log)](#journal-write-ahead-log)
sections above.

---

## Performance Tuning

### Snapshot Interval Trade-offs

| Interval | Recovery Time | I/O Cost | Journal Size |
|----------|--------------|----------|-------------|
| 1 minute | Minimal journal replay | High | Small |
| 5 minutes (default) | Moderate replay | Balanced | Moderate |
| 30 minutes | Longer replay | Low | Large |

### Buffer Sizing

| Buffer | Default | Increase When |
|--------|---------|---------------|
| `SerializationBufferSize` (journal) | 4 KB | Large entities (>4 KB serialized) |
| `SerializationBufferSize` (snapshot) | 64 KB | Large databases (>10K entities) |
| `ChannelCapacity` | 1,024 | Commit latency spikes (backpressure) |
| `BufferSize` (journal) | 64 KB | High-throughput bursts |

### Mobile-Specific Tuning

ConjureDB is optimized for mobile game clients:

| Feature | Default Behavior |
|---------|-----------------|
| Small buffers | 4 KB serialization buffers reduce memory pressure |
| Few pooled buffers | 4 buffers minimize peak memory |
| Battery awareness | Provide `IBatteryStatusProvider` to defer writes on low battery |
| Adaptive flush | Automatically scales 100 ms – 5 s based on activity |

### Encryption Overhead

| Operation | Overhead | Cause |
|-----------|----------|-------|
| Startup | ~50–200 ms | PBKDF2 key derivation (100K iterations) |
| Read/write | ~10–15% | Per-chunk AES-GCM encryption/decryption |
| File size | ~3% increase | Per-chunk nonce (12B) + tag (16B) overhead |

### Journal Rotation

| Setting | Trade-off |
|---------|-----------|
| Small `MaxJournalFileSize` (1 MB) | Fast recovery scan, more files |
| Default (2 MB) | Balanced |
| Large (10 MB) | Fewer files, slower per-file scan |

---

## Complete Configuration Example

```csharp
var db = await DbContextBuilder<GameDb>.Create()
    // Storage location
    .WithDataDirectory("/data/game")

    // Snapshot configuration
    .WithSnapshot(snap => snap
        .AutomaticSnapshotInterval(TimeSpan.FromMinutes(5))
        .MaxSnapshotsToKeep(10)
        .EnableIncrementalSnapshots(true)
        .MaxDeltaChainLength(15)
        .DeltaToFullThreshold(0.4)
        .WithJournaling(j => j
            .FlushInterval(TimeSpan.FromMilliseconds(100))
            .RecordsPerWrite(32)
            .ChannelCapacity(2048)
            .MaxJournalFileSize(4 * 1024 * 1024)))  // 4 MB

    // Encryption
    .WithEncryption(enc => enc
        .Password(SecureConfig.GetDbPassword())
        .KeySizeInBits(256)
        .Salt(SecureConfig.GetDbSalt()))

    // Remote sync
    .WithRemoteSnapshot(rem => rem
        .OwnedByContext(new CloudSnapshotHandler())
        .ResolutionStrategy(StateResolutionStrategy.LocalFirst)
        .MaxRetryAttempts(5))

    // Schema migration
    .WithMigration(mig => mig
        .SnapshotAfterMigration(true))

    // Serialization
    .WithSerializer(new MessagePackBinarySerializer())

    // Mobile power management
    .WithBatteryStatusProvider(new MobileBatteryProvider())

    // Logging
    .WithLoggerFactory(loggerFactory)

    .BuildAsync();
```

---

## Backup and Restore

For operational backup and restore strategies — manual and file-level (cold) backups, restoring from a backup, and cloud (remote) restore — see [Backup and Restore](/docs/engine/backup-restore).

---

## Troubleshooting

For persistence symptoms and fixes — slow startup from large journal replay,
missing data after a crash, encryption key mismatch, and serialization errors —
see the [Persistence & Data Issues](/docs/reference/troubleshooting#persistence--data-issues)
and [Performance Issues](/docs/reference/troubleshooting#performance-issues) sections of the
Troubleshooting guide.

Persistence-specific quick fixes:

- **Snapshot too large** — set `PersistenceType.None` on transient tables so
  they are excluded from snapshots.
- **Too many journal files** — increase `MaxJournalFileSize` to reduce rotation
  frequency.
- **Commit latency spikes** — increase `ChannelCapacity` to absorb journal
  channel backpressure.

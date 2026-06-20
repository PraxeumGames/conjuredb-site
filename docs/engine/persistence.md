# Persistence

ConjureDB's persistence layer protects in-memory data against process crashes
and device restarts. It combines periodic **snapshots** (full-state dumps) with
a **write-ahead journal** (per-transaction change log) to provide configurable
durability guarantees — from zero-overhead in-memory-only mode to fully durable
encrypted storage with cloud sync.

**See also:** [Transactions](/docs/engine/transactions) · [PGO](/docs/performance/pgo) · [Getting Started](/docs/getting-started)

---

## Architecture Overview

```
                    ┌─────────────────────────────────────────────┐
                    │              DbContext                       │
                    │  Commit() ─────────┬───────────────────────  │
                    └────────────────────┼────────────────────────┘
                                         │
                                         ▼
                    ┌─────────────────────────────────────────────┐
                    │          Background Worker Thread            │
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

```
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

```
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

**Delta snapshot format** uses `DeltaSnapshotFormat` with base epoch and new
epoch tracking. The `DeltaChainManager` tracks dirty entities between
snapshots and replays deltas on recovery.

---

## Journal (Write-Ahead Log)

The journal records every committed transaction as a sequence of `ChangeRecord`
entries. If the process crashes between snapshots, journal replay recovers the
missing transactions.

### Pipeline Architecture

```
 Commit()                     JournalWriter                 JournalBackgroundProcessor
    │                              │                                 │
    │  ChangeRecord + version      │                                 │
    │─────────────────────────────>│  BoundedChannel<T>             │
    │                              │  (capacity: 1024)              │
    │                              │─────────────────────────────-->│
    │                              │                                │ Batch serialize
    │                              │                                │ via JournalBufferManager
    │                              │                                │ (64 KB ring buffer)
    │                              │                                │
    │                              │                                │ Write to disk
    │                              │                                │ Adaptive flush
    │                              │                                │ File rotation
```

### ChangeRecord Structure

Each journal record is MessagePack-serialized:

| Field | Type | Description |
|-------|------|-------------|
| `EntityTypeId` | `ushort` | The schema `type_id` value |
| `OperationType` | `ChangeType` | `Add`, `Update`, or `Remove` |
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

```
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

The background processor dynamically adjusts flush timing based on write
throughput and device state:

| Condition | Behavior |
|-----------|----------|
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

```
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

### Phase 2 — Local Snapshot Load

1. Scan `<DataDirectory>/snapshots/` for `snapshot_*.dat` files.
2. Select the most recent file (by filename).
3. Deserialize according to the binary format (magic → version → epoch → data).
4. Apply schema migrations if the schema has changed
   (`MigrationOrchestrator`).

### Phase 2a — Delta Replay (if incremental enabled)

1. Load delta snapshots in chain order via `DeltaChainManager`.
2. Apply each delta to reconstruct the full state.
3. If any delta is corrupt or missing, fall back to the last full snapshot.

### Phase 3 — Journal Replay

1. Discover all journal files in `<DataDirectory>/journal/`.
2. Sort **oldest-first** by filename (ticks-based naming ensures correct order).
3. Capture `baseSnapshotVersion` from the loaded snapshot.
4. Read entries sequentially:
   - **Skip** entries with `Version ≤ baseSnapshotVersion`.
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
| **Idempotency** | Replaying already-applied entries (version ≤ snapshot) is skipped |
| **Integrity** | CRC-32 validates each journal entry; corrupt entries are handled per policy |

---

## Encryption

ConjureDB supports AES-GCM authenticated encryption for data at rest.
When enabled, both snapshot and journal files are transparently encrypted.
For the explicit security boundary and operational assumptions, see
[Encryption Threat Model](/docs/engine/encryption-threat-model).

### Cryptographic Details

| Parameter | Value |
|-----------|-------|
| Algorithm | AES-GCM (authenticated encryption with associated data) |
| Key derivation | PBKDF2 with SHA-256, **100,000 iterations** |
| Key sizes | 128, 192, or 256 bits (default: **256**) |
| Chunk size | **4,096 bytes** — independent GCM authentication per chunk |
| Nonce | Chunked journals use 12 bytes: `[fileNonceSalt(4)][chunkIndex(8)]`; `fileNonceSalt` is generated randomly for every encrypted file write |
| Tag | 16 bytes per chunk (GCM authentication tag) |
| Library | BouncyCastle `GcmBlockCipher` |

### Chunk-Based Encryption Format

```
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
    Stream CreateReadStream(string path, EncryptionOptions options, int bufferSize = 4096, bool chunked = false);
    Stream CreateWriteStream(string path, EncryptionOptions options, int bufferSize = 4096, bool chunked = false);
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
public interface IRemoteSnapshotHandler
{
    Task<ulong?> GetRemoteVersionAsync();
    Task LoadSnapshotAsync(DbContext context);
    Task UploadSnapshotAsync(DbContext context, ulong version);
}
```

Implement this interface to integrate with any cloud storage provider
(S3, Azure Blob, Firebase, Google Cloud Storage, custom backend).

### RemoteSnapshotOptions Reference

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `RequestTimeout` | `TimeSpan?` | *(provider-specific)* | Timeout for individual remote operations |
| `MaxRetryAttempts` | `int` | 3 | Retry count on transient failures |
| `StateResolutionStrategy` | enum | `RemoteFirst` | Conflict resolution (see Recovery Phase 1) |
| `RemoteSnapshotHandler` | `IRemoteSnapshotHandler` | `null` | Custom implementation |

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
        .RemoteHandler(new FirebaseSnapshotHandler(firebaseConfig))
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
`MigrationOrchestrator` handles schema evolution during snapshot load.

### Migration Flow

1. Snapshot is loaded with old schema metadata.
2. `MigrationOrchestrator` detects schema differences.
3. Registered migrations are applied in order.
4. If `SnapshotAfterMigration` is enabled, an immediate snapshot is taken
   with the new schema.

### Configuration

```csharp
var context = DbContextBuilder<GameDbContext>.Create()
    .WithMigration(mig => mig
        .SnapshotAfterMigration(true)
        .VerboseLogging(true))
    .Build();
```

---

## Configuration Reference

### SnapshotOptions

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `SerializationBufferSize` | `int` | 65,536 (64 KB) | `ArrayBufferWriter` initial capacity |
| `AutomaticSnapshotInterval` | `TimeSpan` | 5 minutes | Periodic snapshot frequency |
| `MaxSnapshotsToKeep` | `int` | 10 | Retention limit (oldest deleted) |
| `CompressSnapshots` | `bool` | `true` | Enable compression |
| `FileStreamBufferSize` | `int` | 4,096 (4 KB) | `FileStream` write buffer |
| `EnableIncrementalSnapshots` | `bool` | `false` | Enable delta snapshots |
| `MaxDeltaChainLength` | `int` | 10 | Max deltas before forced full snapshot |
| `DeltaToFullThreshold` | `double` | 0.5 | Dirty ratio forcing full snapshot |

### JournalOptions

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `IsEnabled` | `bool` | `false` | Master switch for journaling |
| `BufferSize` | `int` | 65,536 (64 KB) | Ring buffer for batch writes |
| `SerializationBufferSize` | `int` | 4,096 (4 KB) | Per-entry serialization workspace |
| `SerializationBuffersCount` | `int` | 4 | Pooled serialization buffer count |
| `ChannelCapacity` | `int` | 1,024 | `BoundedChannel` capacity (backpressure) |
| `FileStreamBufferSize` | `int` | 4,096 (4 KB) | `FileStream` write buffer |
| `MaxEntrySize` | `int` | 131,072 (128 KB) | Safety limit (rejects oversized entries) |
| `RecordsPerWrite` | `int` | 16 | Max records per I/O batch |
| `FlushInterval` | `TimeSpan` | 100 ms | Base flush interval |
| `MaxStateChangesBeforeSnapshot` | `int` | 100 | Entity mutation count triggering snapshot |
| `MaxJournalFileSize` | `int` | 2,097,152 (2 MB) | File rotation threshold |
| `QueueThresholdForSnapshot` | `int` | 10 | Queue depth triggering snapshot hint |
| `DelayBeforeSnapshotMs` | `int` | 500 | Batching delay before snapshot execution |
| `HighWriteOpsPerSecond` | `int` | 100 | Threshold for accelerating flush |
| `MinFlushIntervalMs` | `int` | 100 | Lower bound for adaptive flush |
| `MaxFlushIntervalMs` | `int` | 5,000 | Upper bound for adaptive flush |

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
        .RemoteHandler(new CloudSnapshotHandler())
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

### Manual Backup

```csharp
// Force a snapshot (can be done at any time)
await context.SaveAsync();

// The latest snapshot file is at:
// <DataDirectory>/snapshots/snapshot_<timestamp>.dat
```

### File-Level Backup

To create a cold backup:

1. Call `context.Dispose()` to ensure all pending writes are flushed.
2. Copy the entire `<DataDirectory>` (snapshots + journal).
3. Include the encryption salt if encryption is enabled.

### Restore from Backup

1. Stop the application.
2. Replace `<DataDirectory>` contents with the backup.
3. Start the application — recovery runs automatically.

### Cloud Restore

```csharp
// Force download from cloud storage
var context = await DbContextBuilder<GameDbContext>.Create()
    .WithRemoteSnapshot(rem => rem
        .RemoteHandler(cloudHandler)
        .ResolutionStrategy(StateResolutionStrategy.ForceRemote))
    .BuildAsync();
```

---

## Troubleshooting

### Common Issues

| Symptom | Cause | Solution |
|---------|-------|----------|
| Slow startup | Large journal replay | Decrease snapshot interval or `MaxStateChangesBeforeSnapshot` |
| High memory during snapshot | Large database | Increase `SerializationBufferSize`, consider incremental snapshots |
| Commit latency spikes | Journal channel backpressure | Increase `ChannelCapacity` |
| Encryption errors on load | Salt or password mismatch | Verify salt and password match original values |
| Missing data after crash | Journal not flushed | Use `CommitAsync(forceFlush: true)` for critical data |
| Too many journal files | High write throughput | Increase `MaxJournalFileSize` |
| Snapshot too large | All entities persisted | Set `PersistenceType.None` on transient tables |

# Backup and Restore

How to backup, restore, and protect your ConjureDB database.

> **Related docs:**
> [Persistence](/docs/engine/persistence) covers the persistence architecture in depth.
> [Configuration](/docs/engine/configuration) details every option and its default.
> This guide focuses on *operational* backup/restore strategies and recipes.

---

## Overview

ConjureDB persists data through two complementary mechanisms:

| Mechanism | What it captures | Granularity | File pattern |
|-----------|-----------------|-------------|--------------|
| **Snapshot** | Full (or delta) database state | Point-in-time | `snapshot_{UnixTimeMs}.dat` |
| **Journal (WAL)** | Individual committed transactions | Per-commit | `journal_{Ticks}.dat` |

Together they provide a recovery model analogous to PostgreSQL's base backup + WAL
archiving: a snapshot is the "base backup" and journal files are the "WAL segments."

### Why Backup Matters for Game Clients

Game client databases hold irreplaceable player state — progression, inventory,
purchases, and settings. Unlike server-side databases that run on redundant storage,
game clients operate on consumer devices where:

- The app can be killed mid-write (swipe-away, OS memory pressure).
- Storage can be corrupted (sudden power loss, SD-card failures).
- Players switch devices and expect continuity.
- Refund disputes require proof of purchase history.

A solid backup strategy turns a potential data-loss incident into a transparent
recovery that the player never notices.

### Backup Strategies at a Glance

| Strategy | Data-loss window | Complexity | Best for |
|----------|-----------------|------------|----------|
| **Snapshot-only** | Up to snapshot interval | Low | Config data, non-critical state |
| **Snapshot + Journal** | Zero (last committed txn) | Medium | Player progress, purchases |
| **Cloud Save** | Zero + cross-device | Higher | Cross-device play, live-service games |

---

## Snapshot Backups

### Manual Snapshots

Trigger a snapshot explicitly with `Save()` or `SaveAsync()`:

```csharp
// Synchronous — blocks until fully written to disk
db.Save();

// Asynchronous — preferred on main thread
await db.SaveAsync();
```

**When to trigger manual snapshots:**

| Event | Why |
|-------|-----|
| Level / stage completion | Natural checkpoint the player expects |
| Significant purchase | Protect monetization data immediately |
| App backgrounding | Last chance before OS may kill the process |
| Before risky operation | Schema migration, bulk import |

**Example — save on Unity app pause:**

```csharp
private void OnApplicationPause(bool paused)
{
    if (paused)
    {
        // Fire-and-forget is acceptable here; the snapshot
        // writer is already crash-safe.
        _ = db.SaveAsync();
    }
}
```

**Example — save after purchase:**

```csharp
public async Task CompletePurchase(PurchaseRecord purchase)
{
    db.Set<PurchaseRecord>().Add(purchase);
    db.Commit();

    // Force a durable snapshot so the purchase survives any crash.
    await db.SaveAsync();
}
```

> **Note:** `Save()` / `SaveAsync()` is a no-op if no data has changed since the
> last snapshot (version comparison). Calling it frequently is safe.

### Automatic Snapshots

Enable persistence and the runtime takes periodic snapshots automatically:

```csharp
var db = DbContextBuilder<GameDb>.Create()
    .WithDataDirectory("save/")
    .WithSnapshot(snap => snap
        .AutomaticSnapshotInterval(TimeSpan.FromMinutes(5))
        .MaxSnapshotsToKeep(10))
    .Build();
```

| Option | Default | Description |
|--------|---------|-------------|
| `AutomaticSnapshotInterval` | 5 min | Time between automatic snapshots |
| `MaxSnapshotsToKeep` | 10 | Oldest snapshots are pruned beyond this count |
| `SerializationBufferSize` | 64 KB | Internal buffer for MessagePack serialization |

**File naming and location:**

Snapshots are stored under `<DataDirectory>/snapshots/`:

```
save/
└── snapshots/
    ├── snapshot_1718000000000.dat   ← oldest
    ├── snapshot_1718000300000.dat
    └── snapshot_1718000600000.dat   ← latest
```

When `MaxSnapshotsToKeep` is exceeded, the oldest file is deleted after the new
snapshot is fully written and fsynced.

### Incremental (Delta) Snapshots

Full snapshots serialize the entire database. For large datasets this can be slow
and produce large files. Delta snapshots capture only entities modified since the
last full snapshot.

```csharp
var db = DbContextBuilder<GameDb>.Create()
    .WithDataDirectory("save/")
    .WithSnapshot(snap => snap
        .EnableIncrementalSnapshots()
        .MaxDeltaChainLength(10)
        .DeltaToFullThreshold(0.5))
    .Build();
```

| Option | Default | Description |
|--------|---------|-------------|
| `EnableIncrementalSnapshots` | `false` | Turn on delta snapshot mode |
| `MaxDeltaChainLength` | 10 | Max deltas before forcing a full snapshot |
| `DeltaToFullThreshold` | 0.5 | If ≥ 50 % of entities are dirty, take a full snapshot instead |

**How delta chains work:**

```
Full snapshot (epoch 100)
  └─ Delta 1 (epoch 101) — 12 modified entities
      └─ Delta 2 (epoch 102) — 3 modified entities
          └─ Delta 3 (epoch 103) — 7 modified entities
              └─ ... up to MaxDeltaChainLength
                  └─ Full snapshot (epoch 110) — chain resets
```

Recovery loads the base full snapshot, then applies each delta in epoch order.

**When a full snapshot is forced:**

1. Delta chain length reaches `MaxDeltaChainLength`.
2. Ratio of dirty entities to total entities exceeds `DeltaToFullThreshold`.
3. A post-migration snapshot is required after schema changes.

**Recommendation:** Start with `MaxDeltaChainLength = 10` and
`DeltaToFullThreshold = 0.5`. Monitor snapshot sizes — if deltas approach the full
snapshot size, lower the threshold.

### Snapshot File Format

**Full snapshots (V5 format):**

```
┌──────────────────────────────────────────────────┐
│ Magic (8 bytes)  0x554D_4442_5632_0000 "UMDBV2"  │
│ Format Version (2 bytes)  ushort = 5             │
│ Epoch / Version (8 bytes)  ulong                 │
│ Schema Length (4 bytes)  uint                    │
│ Encryption Flag (1 byte)  0/1                    │
│ Schema CRC-32 (4 bytes)                          │
│ Schema Section (N bytes)                         │
│ DbSet Count (4 bytes)  int                       │
├──────────────────────────────────────────────────┤
│ DbSet Section 1:                                 │
│   Section Length (4 bytes)                       │
│   Section CRC-32 (4 bytes)                       │
│   TypeId (2 bytes), MaxId (4 bytes)              │
│   DataLength (4 bytes), MessagePack payload      │
│ DbSet Section 2  ...                             │
│ ...                                              │
└──────────────────────────────────────────────────┘
```

The schema section and every full-snapshot DbSet section are CRC-32 validated
before deserialization. A checksum mismatch fails recovery instead of applying
partially corrupted state.

**Delta snapshots:**

```
┌──────────────────────────────────────────────────┐
│ Magic (4 bytes)  0x55_4D_44_53 "UMDS"            │
│ Base Epoch (8 bytes)  ulong                      │
│ New Epoch (8 bytes)   ulong                      │
│ Transaction Version (8 bytes)  ulong             │
│ DbSet Section Count (4 bytes)  int               │
├──────────────────────────────────────────────────┤
│ Modified entity sections (MessagePack)           │
└──────────────────────────────────────────────────┘
```

**File sizes:** Snapshot size is proportional to the number of entities and their
serialized field sizes. A database with 10,000 simple entities typically produces
snapshots in the 100 KB – 1 MB range. Enable encryption (AES-GCM) adds ~16 bytes
per 4 KB chunk for authentication tags.

---

## Journal (WAL) Backups

### Journal Files

The write-ahead journal records every committed transaction between snapshots.
Each journal entry is a framed record:

```
┌─────────────────────────────────────────┐
│ Magic (4 bytes)  0x554D_4A45 "UMJE"     │
│ Length (4 bytes)                         │
│ MessagePack payload (variable)          │
│ CRC-32 checksum (4 bytes)               │
└─────────────────────────────────────────┘
```

Journal files are stored under `<DataDirectory>/journal/`:

```
save/
└── journal/
    ├── journal_638550000000000000.dat
    └── journal_638550036000000000.dat
```

**File rotation:** When a journal file exceeds `MaxJournalFileSize` (default: 2 MB),
a new file is created. Old journal files are pruned after a successful snapshot
captures their state.

**Journal + Snapshot = complete backup:** The journal captures every commit that
happens *between* snapshots. On recovery, the latest snapshot is loaded first, then
journal entries with versions newer than the snapshot are replayed in order. This
guarantees zero data loss down to the last committed transaction.

### Journal Configuration for Durability

```csharp
var db = DbContextBuilder<GameDb>.Create()
    .WithDataDirectory("save/")
    .WithSnapshot(snap => snap
        .AutomaticSnapshotInterval(TimeSpan.FromMinutes(5))
        .WithJournaling(journal => journal
            .FlushInterval(TimeSpan.FromMilliseconds(100))
            .MaxJournalFileSize(2 * 1024 * 1024)))
    .Build();
```

| Option | Default | Effect on durability |
|--------|---------|---------------------|
| `FlushInterval` | 100 ms | Lower = less data at risk; higher = better throughput |
| `MaxJournalFileSize` | 2 MB | Controls rotation; larger files = fewer fsyncs |
| `MaxStateChangesBeforeSnapshot` | 100 | Auto-triggers snapshot after N journal entries |
| Recovery corruption policy | `StopAtCorruption` | Lower-level `JournalOptions` recovery behavior; not part of the fluent builder |

**Corruption policies:**

| Policy | Behavior | Use when |
|--------|----------|----------|
| `StopAtCorruption` | Stop replay at first corrupt entry; recover what is valid | Default — safe, predictable |
| `SkipCorrupted` | Scan forward for next valid magic marker; skip corrupt entries | Maximize recovery at the cost of potential gaps |
| `Fail` | Throw `JournalCorruptionException` immediately | Strict environments; fail-fast |

**Forced flush for critical commits:**

```csharp
// CommitAsync with forceFlush: true waits until the journal entry
// is fsynced to disk before returning.
await db.CommitAsync(forceFlush: true);
```

Use `forceFlush: true` for high-value operations (purchases, irreversible actions)
where you need a guarantee that the data is on persistent storage before proceeding.

---

## Backup Strategies

### Strategy 1: Snapshot-Only

The simplest approach. Periodic snapshots capture full database state.

```csharp
var db = DbContextBuilder<GameDb>.Create()
    .WithDataDirectory("save/")
    .WithSnapshot(snap => snap
        .AutomaticSnapshotInterval(TimeSpan.FromMinutes(5))
        .MaxSnapshotsToKeep(5))
    .Build();
```

**Characteristics:**

- Data-loss window equals the snapshot interval (up to 5 minutes in this example).
- No journal overhead — simpler file management.
- Recovery loads a single file.

**Best for:** Settings, preferences, cosmetic state — anything where losing a few
minutes of changes is acceptable.

**Example — settings database:**

```csharp
// SettingsDb is generated from `.conjure` schema AdditionalFiles.
// Its schema declares UserPreference and GraphicsSettings tables with explicit type_id values.

// Configure with snapshot-only, long interval
var settings = DbContextBuilder<SettingsDb>.Create()
    .WithDataDirectory("settings/")
    .WithSnapshot(snap => snap
        .AutomaticSnapshotInterval(TimeSpan.FromMinutes(15))
        .MaxSnapshotsToKeep(3))
    .Build();
```

### Strategy 2: Snapshot + Journal

Zero data loss. The journal captures every committed transaction between snapshots.

```csharp
var db = DbContextBuilder<GameDb>.Create()
    .WithDataDirectory("save/")
    .WithSnapshot(snap => snap
        .AutomaticSnapshotInterval(TimeSpan.FromMinutes(5))
        .MaxSnapshotsToKeep(10)
        .WithJournaling(journal => journal
            .FlushInterval(TimeSpan.FromMilliseconds(100))
            .MaxJournalFileSize(2 * 1024 * 1024)
            .MaxStateChangesBeforeSnapshot(100)))
    .Build();
```

**Characteristics:**

- Zero data loss (every committed transaction is journaled).
- Journal auto-triggers snapshots after `MaxStateChangesBeforeSnapshot` entries,
  keeping journal files short and recovery fast.
- Slightly higher I/O — journal writes on every commit.

**Best for:** Player progression, inventory, in-app purchase records — anything
where losing even one transaction is unacceptable.

**Example — player progress database:**

```csharp
// PlayerDb is generated from `.conjure` schema AdditionalFiles.
// Its schema declares PlayerProfile, InventoryItem, PurchaseRecord, and QuestProgress tables.

var playerDb = DbContextBuilder<PlayerDb>.Create()
    .WithDataDirectory("player/")
    .WithSnapshot(snap => snap
        .AutomaticSnapshotInterval(TimeSpan.FromMinutes(3))
        .MaxSnapshotsToKeep(10)
        .EnableIncrementalSnapshots()
        .MaxDeltaChainLength(10)
        .WithJournaling(journal => journal
            .FlushInterval(TimeSpan.FromMilliseconds(50))
            .MaxStateChangesBeforeSnapshot(50)))
    .Build();
```

### Strategy 3: Cloud Save (Remote Sync)

Extends snapshot + journal with remote storage for cross-device play.

```csharp
var db = DbContextBuilder<GameDb>.Create()
    .WithDataDirectory("save/")
    .WithSnapshot(snap => snap
        .AutomaticSnapshotInterval(TimeSpan.FromMinutes(5))
        .WithJournaling())
    .WithRemoteSnapshot(remote => remote
        .RemoteHandler(new MyCloudSaveHandler())
        .ResolutionStrategy(StateResolutionStrategy.RemoteFirst)
        .MaxRetryAttempts(3)
        .RequestTimeout(TimeSpan.FromSeconds(10)))
    .Build();
```

**Characteristics:**

- Combines local persistence with cloud backup.
- Conflict resolution handles concurrent saves from multiple devices.
- Network failures fall back to local state gracefully.

**Best for:** Cross-device play, live-service games, games requiring server-side
save verification.

### Strategy Decision Table

| Game type | Recommended strategy | Snapshot interval | Journal | Cloud |
|-----------|---------------------|-------------------|---------|-------|
| Casual / hyper-casual | Snapshot-only | 10–15 min | No | Optional |
| Mid-core mobile | Snapshot + Journal | 3–5 min | Yes | Recommended |
| Hardcore RPG / MMO client | Snapshot + Journal + Cloud | 1–3 min | Yes, `forceFlush` on purchases | Yes |
| PC / Console single-player | Snapshot + Journal | 5 min | Yes | Optional (Steam Cloud) |
| Live-service with cross-device | Snapshot + Journal + Cloud | 3 min | Yes | Required |

---

## Restore Procedures

### Automatic Recovery on Open

`Build()` and `BuildAsync()` perform a full recovery automatically by calling `InitializeAsync()` internally:

```csharp
var db = DbContextBuilder<GameDb>.Create()
    .WithDataDirectory("save/")
    .WithSnapshot(snap => snap.WithJournaling())
    .Build();
```

**Recovery sequence:**

```
Build() / BuildAsync()
  │
    └─ InitializeAsync()
            │
            ├─ 1. Build()  — register all DbSets
            │
            ├─ 2. RecoverAsync()
            │     ├─ Check remote snapshot (if IRemoteSnapshotHandler configured)
            │     ├─ Apply StateResolutionStrategy (remote vs. local)
            │     ├─ Load latest full snapshot
            │     ├─ Apply delta snapshots in epoch order (if incremental enabled)
            │     └─ Replay journal entries with version > snapshot version
            │
            ├─ 3. InitializeJournal()  — start journal writer
            │
            └─ 4. TakePostMigrationSnapshotIfNeeded()  — if schema changed
```

No manual intervention is required. After `Build()` or `BuildAsync()` returns, the database
is in a consistent state reflecting the last committed transaction.

### Manual Restore from Backup

To restore from a specific backup, copy the desired snapshot files into the data
directory before re-opening the context:

```csharp
// 1. Stop the database (if running)
await db.DisposeAsync();

// 2. Clear the current data directory
Directory.Delete("save/snapshots", recursive: true);
Directory.Delete("save/journal", recursive: true);

// 3. Copy backup files into place
Directory.CreateDirectory("save/snapshots");
File.Copy("backups/snapshot_1718000000000.dat", "save/snapshots/snapshot_1718000000000.dat");

// 4. Re-initialize — recovery loads the restored snapshot
var db = DbContextBuilder<GameDb>.Create()
    .WithDataDirectory("save/")
    .WithSnapshot(snap => snap.WithJournaling())
    .Build();
```

**Handling corrupted snapshots:** The snapshot handler loads the *latest* snapshot
file by Unix timestamp. If the latest snapshot is corrupted, remove it and
the next `Build()` / `BuildAsync()` call will fall back to the next most recent snapshot. With
`MaxSnapshotsToKeep = 10`, you have up to 10 recovery points.

```csharp
// Fallback chain example:
// save/snapshots/
//   snapshot_1718000600000.dat  ← corrupted, delete this
//   snapshot_1718000300000.dat  ← recovery will use this
//   snapshot_1718000000000.dat  ← oldest fallback
```

### Point-in-Time Recovery

With journaling enabled, recovery replays all journal entries after the snapshot.
To restore to a specific point in time:

1. Start with a snapshot taken *before* the target time.
2. Keep only journal files covering the period up to the target time.
3. Remove journal files with timestamps *after* the desired recovery point.
4. Re-open the context with `Build()` or `BuildAsync()`.

```csharp
// To recover to a state at approximately 2024-06-10 14:30:00:

// 1. Keep the snapshot from before that time
// 2. Remove journal files created after that time:
var cutoff = new DateTime(2024, 6, 10, 14, 30, 0).Ticks;
foreach (var journal in Directory.GetFiles("save/journal/", "journal_*.dat"))
{
    var ticks = long.Parse(Path.GetFileNameWithoutExtension(journal).Split('_')[1]);
    if (ticks > cutoff)
        File.Delete(journal);
}

// 3. Re-open the context; Build()/BuildAsync() replay only the remaining entries
```

**Limitations:**

- Point-in-time recovery granularity depends on journal entry density and
  `FlushInterval`. With `FlushInterval = 100ms`, the resolution is ~100 ms.
- Journal entries are replayed in full — you cannot stop at a specific transaction
  *within* a journal file without external tooling.
- Delta snapshots must form a complete chain from the base full snapshot; removing
  a delta in the middle invalidates subsequent deltas.

---

## Encrypted Backups

When encryption is enabled, both snapshots and journal files are transparently
encrypted using AES-GCM with per-4 KB-chunk authentication tags.

```csharp
var db = DbContextBuilder<GameDb>.Create()
    .WithDataDirectory("save/")
    .WithSnapshot(snap => snap.WithJournaling())
    .WithEncryption(enc => enc
        .Password("player-specific-secret")
        .KeySizeInBits(256))
    .Build();
```

### Key Management for Backups

| Concern | Recommendation |
|---------|---------------|
| **Key derivation** | PBKDF2 from password + salt. Salt is auto-generated (32 random bytes) if not specified. |
| **Salt persistence** | The salt must be available at recovery time. Store it alongside (but separate from) the backup, or use a deterministic salt derived from a player ID. |
| **Key rotation** | To change the encryption key, load the database with the old key, then re-save with a new `DbContextBuilder` configured with the new key. |
| **Backup portability** | Encrypted backups require the same password + salt to restore. Document these in your key management system. |

```csharp
// Key rotation example:

// 1. Open with old key
var oldDb = DbContextBuilder<GameDb>.Create()
    .WithDataDirectory("save/")
    .WithSnapshot(snap => snap.WithJournaling())
    .WithEncryption(enc => enc
        .Password("old-password")
        .Salt("old-salt"))
    .Build();

// 2. Export data (in-memory — no files involved)
var profiles = oldDb.Set<PlayerProfile>().ToArray();

await oldDb.DisposeAsync();

// 3. Clear old files and re-create with new key
Directory.Delete("save/", recursive: true);

var newDb = DbContextBuilder<GameDb>.Create()
    .WithDataDirectory("save/")
    .WithSnapshot(snap => snap.WithJournaling())
    .WithEncryption(enc => enc
        .Password("new-password")
        .KeySizeInBits(256))
    .Build();

foreach (var profile in profiles)
    newDb.Set<PlayerProfile>().Add(profile);

newDb.Commit();
await newDb.SaveAsync();
```

### Encryption Details

| Property | Value |
|----------|-------|
| Algorithm | AES-GCM (authenticated encryption) |
| Key derivation | PBKDF2 from password + salt |
| Chunk size | 4 KB |
| Auth tag | 16 bytes per chunk |
| Key sizes | 128, 192, or 256 bits (default: 256) |
| Salt | 32 random bytes, base64-encoded (auto-generated if omitted) |

---

## Cloud Save Integration

### Remote Snapshot Handler

Implement `IRemoteSnapshotHandler` to integrate with any cloud storage backend:

```csharp
public interface IRemoteSnapshotHandler : IAsyncDisposable
{
    Task<ulong?> GetRemoteVersionAsync();
    Task LoadSnapshotAsync(DbContext context);
    Task UploadSnapshotAsync(DbContext context, ulong version);
}
```

ConjureDB provides `RemoteSnapshotHandlerBase` with built-in retry logic. Override
three protected methods:

```csharp
public class MyCloudSaveHandler : RemoteSnapshotHandlerBase
{
    private readonly ICloudStorageClient _client;

    public MyCloudSaveHandler(ICloudStorageClient client, RemoteSnapshotOptions options)
        : base(options)
    {
        _client = client;
    }

    protected override async Task<ulong?> GetRemoteVersionInternalAsync(
        CancellationToken ct)
    {
        var metadata = await _client.GetMetadataAsync("save.dat", ct);
        return metadata?.Version;
    }

    protected override async Task<SnapshotData?> GetSnapshotDataAsync(
        CancellationToken ct)
    {
        var bytes = await _client.DownloadAsync("save.dat", ct);
        if (bytes == null) return null;
        return MessagePackSerializer.Deserialize<SnapshotData>(bytes);
    }

    protected override async Task UploadSnapshotDataAsync(
        SnapshotData data, CancellationToken ct)
    {
        var bytes = MessagePackSerializer.Serialize(data);
        await _client.UploadAsync("save.dat", bytes, ct);
    }
}
```

**`SnapshotData` structure (nested in `RemoteSnapshotHandlerBase`):**

```csharp
public class SnapshotData // Nested inside RemoteSnapshotHandlerBase
{
    public ulong Version { get; set; }
    public Dictionary<ushort, byte[]> Data { get; init; }           // DbSet ID → serialized data
    public EntitySchemaDescriptor[] SchemaDescriptors { get; init; } // Schema metadata
}
```

Inside a class that inherits from `RemoteSnapshotHandlerBase`, you can use `SnapshotData` directly in method signatures. Outside that inheritance scope, use `RemoteSnapshotHandlerBase.SnapshotData`.

### Conflict Resolution

When both local and remote snapshots exist, `StateResolutionStrategy` controls
which one wins:

```csharp
.WithRemoteSnapshot(remote => remote
    .ResolutionStrategy(StateResolutionStrategy.RemoteFirst))
```

| Strategy | Behavior | Use when |
|----------|----------|----------|
| `RemoteFirst` | Use remote unless unavailable; then fall back to local | Default — server is authority |
| `LocalFirst` | Use local unless remote is newer | Offline-first games |
| `ForceRemote` | Always use remote; ignore local | Server-authoritative games |
| `ForceLocal` | Always use local; ignore remote | Debugging, offline mode |

**Resolution flow during `InitializeAsync()`:**

```
GetRemoteVersionAsync()
  │
  ├─ Remote available?
  │   ├─ Yes → Compare with local snapshot version
  │   │         ├─ RemoteFirst:  load remote
  │   │         ├─ LocalFirst:   load local (unless remote > local)
  │   │         ├─ ForceRemote:  load remote
  │   │         └─ ForceLocal:   load local
  │   │
  │   └─ No (timeout / network error)
  │         └─ Fall back to local snapshot
  │
  └─ No handler configured → load local snapshot
```

### Retry and Timeout Configuration

```csharp
.WithRemoteSnapshot(remote => remote
    .RemoteHandler(new MyCloudSaveHandler())
    .MaxRetryAttempts(3)                       // Default: 3
    .RequestTimeout(TimeSpan.FromSeconds(10))) // Per-request timeout
```

`RemoteSnapshotHandlerBase` retries failed remote operations up to
`MaxRetryAttempts` times. Each individual request is bounded by `RequestTimeout`.

### Platform Integration Examples

**Unity Cloud Save:**

```csharp
public class UnityCloudSaveHandler : RemoteSnapshotHandlerBase
{
    protected override async Task<ulong?> GetRemoteVersionInternalAsync(
        CancellationToken ct)
    {
        var data = await CloudSaveService.Instance.Data.Player
            .LoadAsync(new HashSet<string> { "save_version" });

        if (data.TryGetValue("save_version", out var item))
            return Convert.ToUInt64(item.Value.GetAs<long>());

        return null;
    }

    protected override async Task<SnapshotData?> GetSnapshotDataAsync(
        CancellationToken ct)
    {
        var data = await CloudSaveService.Instance.Data.Player
            .LoadAsync(new HashSet<string> { "save_data" });

        if (!data.TryGetValue("save_data", out var item))
            return null;

        var bytes = Convert.FromBase64String(item.Value.GetAs<string>());
        return MessagePackSerializer.Deserialize<SnapshotData>(bytes);
    }

    protected override async Task UploadSnapshotDataAsync(
        SnapshotData data, CancellationToken ct)
    {
        var bytes = MessagePackSerializer.Serialize(data);
        var saveData = new Dictionary<string, object>
        {
            ["save_version"] = (long)data.Version,
            ["save_data"] = Convert.ToBase64String(bytes)
        };
        await CloudSaveService.Instance.Data.Player.SaveAsync(saveData);
    }
}
```

**Steam Cloud (Steamworks.NET):**

```csharp
public class SteamCloudHandler : RemoteSnapshotHandlerBase
{
    private const string FileName = "player_save.dat";

    protected override Task<ulong?> GetRemoteVersionInternalAsync(
        CancellationToken ct)
    {
        if (!SteamRemoteStorage.FileExists(FileName))
            return Task.FromResult<ulong?>(null);

        var bytes = new byte[SteamRemoteStorage.GetFileSize(FileName)];
        SteamRemoteStorage.FileRead(FileName, bytes, bytes.Length);
        var data = MessagePackSerializer.Deserialize<SnapshotData>(bytes);
        return Task.FromResult<ulong?>(data.Version);
    }

    protected override Task<SnapshotData?> GetSnapshotDataAsync(
        CancellationToken ct)
    {
        if (!SteamRemoteStorage.FileExists(FileName))
            return Task.FromResult<SnapshotData?>(null);

        var bytes = new byte[SteamRemoteStorage.GetFileSize(FileName)];
        SteamRemoteStorage.FileRead(FileName, bytes, bytes.Length);
        return Task.FromResult<SnapshotData?>(
            MessagePackSerializer.Deserialize<SnapshotData>(bytes));
    }

    protected override Task UploadSnapshotDataAsync(
        SnapshotData data, CancellationToken ct)
    {
        var bytes = MessagePackSerializer.Serialize(data);
        SteamRemoteStorage.FileWrite(FileName, bytes, bytes.Length);
        return Task.CompletedTask;
    }
}
```

---

## Best Practices

### Mobile Games

Mobile platforms aggressively kill backgrounded apps. Design your backup strategy
around this reality.

```csharp
var db = DbContextBuilder<MobileGameDb>.Create()
    .WithDataDirectory(Application.persistentDataPath + "/save")
    .WithSnapshot(snap => snap
        .AutomaticSnapshotInterval(TimeSpan.FromMinutes(3))
        .MaxSnapshotsToKeep(5)
        .WithJournaling(journal => journal
            .FlushInterval(TimeSpan.FromMilliseconds(200))
            .MaxStateChangesBeforeSnapshot(50)))
    .WithRemoteSnapshot(remote => remote
        .RemoteHandler(cloudHandler)
        .ResolutionStrategy(StateResolutionStrategy.RemoteFirst))
    .Build();
```

**Key practices:**

| Practice | Implementation |
|----------|---------------|
| Save on app background | Call `SaveAsync()` in `OnApplicationPause(true)` |
| Save on level completion | Call `SaveAsync()` after committing level results |
| Minimize battery impact | Use longer `FlushInterval` (200–500 ms) |
| Minimize snapshot frequency | Use journal to avoid frequent full writes |
| Cloud sync on resume | Upload snapshot in `OnApplicationPause(false)` |

```csharp
private async void OnApplicationPause(bool paused)
{
    if (paused)
    {
        // Save locally before OS kills us
        await db.SaveAsync();
    }
    else
    {
        // Optionally sync to cloud on resume
        await UploadToCloud();
    }
}
```

### PC / Console Games

PC and console games have more reliable storage and power, but players expect
manual save slots and quick-save.

**Auto-save with manual save slots:**

```csharp
public class SaveManager
{
    private readonly string _baseDir;

    public SaveManager(string baseDir)
    {
        _baseDir = baseDir;
    }

    /// <summary>
    /// Create a named save slot by copying the current snapshot files.
    /// </summary>
    public async Task CreateSaveSlot(DbContext db, string slotName)
    {
        // 1. Force a fresh snapshot
        await db.SaveAsync();

        // 2. Copy snapshot files to the save slot directory
        var slotDir = Path.Combine(_baseDir, "slots", slotName);
        Directory.CreateDirectory(slotDir);

        var snapshotDir = Path.Combine(_baseDir, "snapshots");
        foreach (var file in Directory.GetFiles(snapshotDir, "snapshot_*.dat"))
        {
            File.Copy(file, Path.Combine(slotDir, Path.GetFileName(file)),
                overwrite: true);
        }
    }

    /// <summary>
    /// Restore from a named save slot.
    /// </summary>
    public void RestoreSaveSlot(string slotName)
    {
        var slotDir = Path.Combine(_baseDir, "slots", slotName);
        var snapshotDir = Path.Combine(_baseDir, "snapshots");
        var journalDir = Path.Combine(_baseDir, "journal");

        // Clear current state
        if (Directory.Exists(snapshotDir))
            Directory.Delete(snapshotDir, recursive: true);
        if (Directory.Exists(journalDir))
            Directory.Delete(journalDir, recursive: true);

        // Copy slot files to snapshot directory
        Directory.CreateDirectory(snapshotDir);
        foreach (var file in Directory.GetFiles(slotDir, "snapshot_*.dat"))
        {
            File.Copy(file, Path.Combine(snapshotDir, Path.GetFileName(file)));
        }

        // Next Build()/BuildAsync() will load from the restored slot
    }
}
```

**Quick-save / quick-load:**

```csharp
// Quick-save: just trigger a snapshot
public async Task QuickSave(DbContext db)
{
    db.Commit();
    await db.SaveAsync();
}

// Quick-load: dispose, restore, rebuild
public async Task<GameDb> QuickLoad(GameDb db, DbContextBuilder<GameDb> builder)
{
    await db.DisposeAsync();
    // Build() loads the latest snapshot automatically
    return builder.Build();
}
```

### Live-Service Games

Live-service games need frequent saves, cloud sync, and schema migration support
across updates.

```csharp
var db = DbContextBuilder<LiveGameDb>.Create()
    .WithDataDirectory("save/")
    .WithSnapshot(snap => snap
        .AutomaticSnapshotInterval(TimeSpan.FromMinutes(1))
        .MaxSnapshotsToKeep(15)
        .EnableIncrementalSnapshots()
        .MaxDeltaChainLength(5)
        .WithJournaling(journal => journal
            .FlushInterval(TimeSpan.FromMilliseconds(50))
            .MaxStateChangesBeforeSnapshot(30)))
    .WithRemoteSnapshot(remote => remote
        .RemoteHandler(cloudHandler)
        .ResolutionStrategy(StateResolutionStrategy.RemoteFirst)
        .MaxRetryAttempts(5)
        .RequestTimeout(TimeSpan.FromSeconds(15)))
    .WithEncryption(enc => enc
        .Password(PlayerAuth.GetEncryptionKey())
        .KeySizeInBits(256))
    .Build();
```

**Key practices:**

| Concern | Approach |
|---------|----------|
| Session data | Frequent snapshots (1 min) + journal |
| Cross-device | Cloud sync with `RemoteFirst` strategy |
| Game updates | Schema migration (see [SchemaMigration](/docs/schema/schema-migration)) + post-migration snapshot |
| Anti-cheat | Encrypt local saves; validate server-side |
| Version conflicts | Upload snapshot after every significant event; `RemoteFirst` ensures latest device wins |

---

## Troubleshooting

| Problem | Cause | Solution |
|---------|-------|---------|
| Corrupted snapshot | Crash during write | Enable journal for zero-loss recovery; the previous snapshot is still intact due to `MaxSnapshotsToKeep` |
| Large snapshot files | Too many or large entities | Enable incremental snapshots; lower `DeltaToFullThreshold`; prune unused data |
| Slow restore | Long journal to replay | Increase snapshot frequency (`AutomaticSnapshotInterval`) or lower `MaxStateChangesBeforeSnapshot` to shorten journal |
| Cloud sync conflicts | Concurrent saves from multiple devices | Set `StateResolutionStrategy` explicitly; `RemoteFirst` is safest for most games |
| Recovery loads stale data | Journal files deleted or corrupt | Ensure `MaxSnapshotsToKeep` > 1 for fallback; use `StopAtCorruption` policy to recover partial journal |
| Out of disk space | Too many snapshots + journals | Lower `MaxSnapshotsToKeep`; reduce `MaxJournalFileSize`; enable incremental snapshots |
| Encryption key lost | Salt not persisted | Always store the salt separately; use deterministic salt derivation from player ID if possible |
| Snapshot skipped | No data changed since last snapshot | Expected behavior — `Save()` is a no-op when version is unchanged |

---

## See Also

- [Persistence](/docs/engine/persistence) — Architecture and format details
- [Configuration](/docs/engine/configuration) — Complete option reference
- [Schema Migration](/docs/schema/schema-migration) — Handling schema changes across game updates
- [Transactions](/docs/engine/transactions) — Commit semantics and isolation

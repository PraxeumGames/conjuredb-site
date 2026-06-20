# Configuration Reference

Complete reference for all ConjureDB configuration parameters.

**See also:** [Database Engine](/docs/engine/database-engine) · [Persistence](/docs/engine/persistence) · [Getting Started](/docs/getting-started) · [PGO](/docs/performance/pgo)

---

## Overview

ConjureDB is configured entirely through the `DbContextBuilder<TContext>` fluent API. All settings are applied at database creation time and **cannot be changed after `Build()` / `BuildAsync()` is called**. Each builder instance is intended to be used exactly once — calling `BuildAsync()` a second time throws `InvalidOperationException`.

```csharp
var db = DbContextBuilder<GameDb>.Create()
    .WithDataDirectory("/data/game")
    .WithSnapshot(snap => snap
        .AutomaticSnapshotInterval(TimeSpan.FromMinutes(5))
        .WithJournaling(j => j.FlushInterval(TimeSpan.FromSeconds(1))))
    .WithEncryption(enc => enc
        .Password("strong-password")
        .KeySizeInBits(256))
    .WithLoggerFactory(loggerFactory)
    .WithMemoryBudgetMB(256)
    .Build();
```

### Configuration Hierarchy

```
DbContextBuilder<TContext>
├── WithDataDirectory(string)
├── WithSerializer(IBinarySerializer)
├── WithSettingsLoaderFactory(SettingsLoaderFactory)
├── WithLoggerFactory(ILoggerFactory) / WithNullLogger()
├── WithMemoryBudget(long) / WithMemoryBudgetMB(int)
├── WithBatteryStatusProvider(IBatteryStatusProvider)
├── WithDurabilityPolicy(DurabilityPolicy)
├── WithNoPersistence()
├── WithRuntimeMode(ConjureDBRuntimeMode)
├── WithQueryInterceptor(IQueryInterceptor)
├── WithQueryInterceptorFactory(Func<DbContext, IQueryInterceptor?>)
├── WithSnapshot(Action<SnapshotOptionsBuilder>)
│   ├── SerializationBufferSize(int)
│   ├── AutomaticSnapshotInterval(TimeSpan)
│   ├── MaxSnapshotsToKeep(int)
│   ├── EnableIncrementalSnapshots(bool)
│   ├── MaxDeltaChainLength(int)
│   ├── DeltaToFullThreshold(double)
│   └── WithJournaling(Action<JournalOptionsBuilder>)
│       ├── FlushInterval(TimeSpan)
│       ├── MaxJournalFileSize(int)
│       ├── RecordsPerWrite(int)
│       ├── MaxStateChangesBeforeSnapshot(int)
│       ├── BufferSize(int)
│       ├── ChannelCapacity(int)
│       ├── MaxEntrySize(int)
│       ├── SerializationBufferSize(int)
│       ├── SerializationBuffersCount(int)
│       ├── FileStreamBufferSize(int)
│       ├── QueueThresholdForSnapshot(int)
│       ├── DelayBeforeSnapshotMs(int)
│       ├── HighWriteOpsPerSecond(int)
│       ├── MinFlushIntervalMs(int)
│       └── MaxFlushIntervalMs(int)
├── WithEncryption(Action<EncryptionOptionsBuilder>)
│   ├── Password(string)
│   ├── KeySizeInBits(int)
│   └── Salt(string)
├── WithRemoteSnapshot(Action<RemoteSnapshotOptionsBuilder>)
│   ├── RequestTimeout(TimeSpan)
│   ├── MaxRetryAttempts(int)
│   ├── ResolutionStrategy(StateResolutionStrategy)
│   └── RemoteHandler(IRemoteSnapshotHandler)
└── WithMigration(Action<MigrationOptionsBuilder>)
    ├── SnapshotAfterMigration(bool)
    └── VerboseLogging(bool)
```

### Builder Construction

Use `DbContextBuilder<T>.Create()` as the standard builder entry point. The builder binds to the public `TContext(DbConfiguration)` constructor, which keeps the same API across desktop/server runtimes and Unity IL2CPP.

| Method | Recommended | Description |
|--------|-------------|-------------|
| `DbContextBuilder<T>.Create()` | ✅ | Unified builder path. Requires a public `TContext(DbConfiguration)` constructor. |

```csharp
// Unified builder path for desktop, server, and IL2CPP
var db = DbContextBuilder<GameDb>.Create().Build();
```

### Build Methods

| Method | Description |
|--------|-------------|
| `Build()` | Synchronous. Blocks until recovery (snapshot + journal replay) completes. Safe for Unity's synchronous init. |
| `BuildAsync()` | Asynchronous. Preferred in async contexts. Avoid calling from code with a `SynchronizationContext` to prevent deadlocks. |

---

## General Settings

### DataDirectory

| Property | Value |
|----------|-------|
| **Type** | `string` |
| **Default** | `Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "db_data")` |
| **Builder method** | `WithDataDirectory(string)` |

Filesystem path where all persistence files are stored: snapshots (`<DataDir>/snapshots/`), journals (`<DataDir>/journal/`), and delta snapshots. Must not be empty or whitespace. Can be absolute or relative.

```csharp
.WithDataDirectory("/data/game-db")
```

> **Note:** Ensure the application has read/write permissions to this directory. On mobile platforms, use the application's persistent data path.

### Serializer

| Property | Value |
|----------|-------|
| **Type** | `IBinarySerializer` |
| **Default** | Built-in MessagePack serializer |
| **Builder method** | `WithSerializer(IBinarySerializer)` |

Custom binary serializer for snapshot and journal persistence. The serializer must implement:

```csharp
public interface IBinarySerializer
{
    byte[] Serialize<T>(T obj);
    void Serialize<T>(IBufferWriter<byte> writer, T obj);
    T Deserialize<T>(ReadOnlyMemory<byte> data);
    T Deserialize<T>(byte[] data);
}
```

```csharp
.WithSerializer(new CustomSerializer())
```

> **Note:** Changing the serializer after data has been persisted will make existing snapshots and journals unreadable. The default MessagePack serializer is recommended unless you have specific requirements.

### SettingsLoaderFactory

| Property | Value |
|----------|-------|
| **Type** | `SettingsLoaderFactory` |
| **Default** | Default factory (uses `DefaultSettingsAccessProvider` and `MessagePackBinarySerializer`) |
| **Builder method** | `WithSettingsLoaderFactory(SettingsLoaderFactory)` |

Factory for creating settings loaders used to hydrate non-persistent `DbSet`s that carry a `[Settings]` attribute. Override to provide custom settings data sources.

```csharp
.WithSettingsLoaderFactory(new SettingsLoaderFactory(customLoaders, accessProvider, serializerFactory))
```

### LoggerFactory

| Property | Value |
|----------|-------|
| **Type** | `ILoggerFactory` (`Microsoft.Extensions.Logging`) |
| **Default** | `NullLoggerFactory` (no logging) |
| **Builder methods** | `WithLoggerFactory(ILoggerFactory)`, `WithNullLogger()` |

Structured logging factory used by the context, background worker, transaction manager, and persistence layer. Compatible with any `Microsoft.Extensions.Logging` provider.

```csharp
// Enable logging with a provider
.WithLoggerFactory(LoggerFactory.Create(builder =>
    builder.AddConsole().SetMinimumLevel(LogLevel.Debug)))

// Explicitly disable logging (default)
.WithNullLogger()
```

> **Note:** ConjureDB uses [ZLogger](https://github.com/Cysharp/ZLogger) internally for zero-allocation structured logging. Any `ILoggerFactory` implementation is accepted.

### MemoryBudget

| Property | Value |
|----------|-------|
| **Type** | `long` (bytes) or `int` (megabytes) |
| **Default** | Disabled (no budget tracking) |
| **Builder methods** | `WithMemoryBudget(long)`, `WithMemoryBudgetMB(int)` |

Sets a maximum memory allocation budget. When enabled, all allocations are tracked and pressure events are raised at warning (≥90%) and critical (≥100%) thresholds. Allocations that would exceed the budget are rejected.

```csharp
// Set budget in bytes
.WithMemoryBudget(512L * 1024 * 1024)  // 512 MB

// Set budget in megabytes (convenience)
.WithMemoryBudgetMB(512)
```

**Memory Pressure Levels:**

| Level | Threshold | Behavior |
|-------|-----------|----------|
| `Normal` | < 90% of budget | Normal operation |
| `Warning` | ≥ 90% of budget | `MemoryPressureChanged` event fired |
| `Critical` | ≥ 100% of budget | New allocations rejected, event fired |

The `MemoryBudget` instance is accessible via `DbConfiguration.MemoryBudget` after build and exposes:

| Property / Method | Type | Description |
|-------------------|------|-------------|
| `TotalAllocatedBytes` | `long` | Current total allocated bytes (thread-safe) |
| `BudgetBytes` | `long` | Configured budget limit |
| `UsageRatio` | `double` | Current usage as ratio (0.0–∞) |
| `CurrentLevel` | `MemoryPressureLevel` | Current pressure level |
| `MemoryPressureChanged` | `event` | Fired on level transitions |
| `TryAllocate(long, string)` | `bool` | Attempt allocation; returns false if over budget |
| `Release(long)` | `void` | Release previously allocated bytes |

### BatteryStatusProvider

| Property | Value |
|----------|-------|
| **Type** | `IBatteryStatusProvider` |
| **Default** | `null` (disabled) |
| **Builder method** | `WithBatteryStatusProvider(IBatteryStatusProvider)` |

Supplies battery charge information so the persistence layer can defer non-critical I/O (automatic snapshots, journal flushes) when the device is low on battery. Designed for mobile/handheld game clients.

```csharp
public class UnityBatteryProvider : IBatteryStatusProvider
{
    public bool IsBatteryLow() => SystemInfo.batteryLevel < 0.15f
        && SystemInfo.batteryStatus == BatteryStatus.Discharging;
}

// Usage
.WithBatteryStatusProvider(new UnityBatteryProvider())
```

The interface has a single method:

```csharp
public interface IBatteryStatusProvider
{
    bool IsBatteryLow();
}
```

When `IsBatteryLow()` returns `true`, the persistence layer defers automatic snapshots and may extend journal flush intervals to conserve battery.

## Durability Policy

Durability profiles are configured via `WithDurabilityPolicy(DurabilityPolicy)`.
They define how aggressively ConjureDB forces committed journal data to stable
storage.

| Property | Value |
|----------|-------|
| **Type** | `DurabilityPolicy` |
| **Default** | `DurabilityPolicy.FastMobile` |
| **Builder method** | `WithDurabilityPolicy(DurabilityPolicy)` |

```csharp
.WithDurabilityPolicy(DurabilityPolicy.CriticalState)
```

| Value | Behavior |
|-------|----------|
| `FastMobile` | Mobile-first default. Journal writes are flushed by the adaptive background policy. Use `CommitAsync(forceFlush: true)` when a specific commit must wait for durable journal flush. |
| `CriticalState` | Every committed transaction must force the journal to stable storage. Use for purchases, currency, inventory, entitlements, or other state that must fail closed. |
| `ForceFlushEveryCommit` | Alias for the strictest policy. Every committed transaction forces durable journal flush before the commit completes. |

`DurabilityPolicy.CriticalState` and
`DurabilityPolicy.ForceFlushEveryCommit` require
`JournalCorruptionPolicy.Fail`. These profiles must fail startup on journal
corruption instead of accepting partial replay.

## No Persistence

Disable all file-based persistence via `WithNoPersistence()`.

| Property | Value |
|----------|-------|
| **Type** | Builder toggle |
| **Default** | Disabled |
| **Builder method** | `WithNoPersistence()` |

`WithNoPersistence()` turns off snapshots, journals, and incremental snapshots.
Use it for server-side or test contexts where an external system owns durability.

```csharp
.WithNoPersistence()
```

> **Note:** Table-level `PersistenceType` still describes entity intent, but with `WithNoPersistence()` the builder disables file-based persistence for the whole context instance.

## Runtime Mode

Runtime mode is configured via `WithRuntimeMode(ConjureDBRuntimeMode)`.

| Property | Value |
|----------|-------|
| **Type** | `ConjureDBRuntimeMode` |
| **Default** | Resolved from AppContext / build defaults |
| **Builder method** | `WithRuntimeMode(ConjureDBRuntimeMode)` |

Overrides the runtime mode for the current context.

| Value | Behavior |
|-------|----------|
| `Client` | Client-oriented runtime mode. This is the default when no server override is active. |
| `Server` | Server-oriented runtime mode. Also sets the process-level `ConjureDB.ServerMode` AppContext switch. |

```csharp
.WithRuntimeMode(ConjureDBRuntimeMode.Server)
```

> **Note:** In server builds, overriding back to `Client` is rejected.

## Query Interception

Query interception is configured via `WithQueryInterceptor(IQueryInterceptor)` or `WithQueryInterceptorFactory(Func<DbContext, IQueryInterceptor?>)`.

| Builder method | Description |
|----------------|-------------|
| `WithQueryInterceptor(IQueryInterceptor)` | Reuses one fixed interceptor instance for all contexts created by the builder. |
| `WithQueryInterceptorFactory(Func<DbContext, IQueryInterceptor?>)` | Creates an interceptor per context instance before the operation registry is sealed. |

```csharp
.WithQueryInterceptorFactory(db => new MyQueryInterceptor(db))
```

See [Database Engine](/docs/engine/database-engine) for the full `IQueryInterceptor` contract and result semantics.

---

## Snapshot Configuration

Snapshot settings are configured via `WithSnapshot(Action<SnapshotOptionsBuilder>)` or `WithDefaultSnapshot()`.

```csharp
.WithSnapshot(snap => snap
    .AutomaticSnapshotInterval(TimeSpan.FromMinutes(5))
    .MaxSnapshotsToKeep(5)
    .SerializationBufferSize(128 * 1024)
    .EnableIncrementalSnapshots(true)
    .MaxDeltaChainLength(8)
    .DeltaToFullThreshold(0.4))
```

> **Note:** Calling `WithSnapshot(...)` automatically enables snapshot persistence (`IsEnabled = true`). Use `WithDefaultSnapshot()` to enable snapshots with all default settings.

### Snapshot Parameters

#### AutomaticSnapshotInterval

| Property | Value |
|----------|-------|
| **Type** | `TimeSpan` |
| **Default** | `TimeSpan.FromMinutes(5)` |
| **Builder method** | `AutomaticSnapshotInterval(TimeSpan)` |

Interval between automatic periodic snapshots. Snapshots are taken on the background worker thread after pending commits are applied. Set to `TimeSpan.Zero` to disable automatic snapshots (manual-only via `DbContext.SaveAsync()`).

```csharp
.WithSnapshot(s => s.AutomaticSnapshotInterval(TimeSpan.FromMinutes(10)))
```

> **Tip:** Shorter intervals reduce data loss window but increase I/O. For games with frequent saves, 1–5 minutes is typical. For idle/background apps, 10–30 minutes may suffice.

#### MaxSnapshotsToKeep

| Property | Value |
|----------|-------|
| **Type** | `int` |
| **Default** | `10` |
| **Builder method** | `MaxSnapshotsToKeep(int)` |

Maximum number of snapshot files retained on disk. When a new snapshot is created and the limit is exceeded, the oldest snapshot is deleted. Applies to both full and delta snapshots.

```csharp
.WithSnapshot(s => s.MaxSnapshotsToKeep(3))
```

> **Note:** Keep at least 2–3 snapshots to allow recovery if the latest snapshot is corrupted.

#### SerializationBufferSize

| Property | Value |
|----------|-------|
| **Type** | `int` (bytes) |
| **Default** | `65,536` (64 KB) |
| **Builder method** | `SerializationBufferSize(int)` |

Initial capacity of the `ArrayBufferWriter<byte>` used to serialize entities during snapshot writes. The buffer grows automatically if needed, but setting an appropriate initial size avoids reallocation.

```csharp
.WithSnapshot(s => s.SerializationBufferSize(256 * 1024))  // 256 KB
```

> **Tip:** Set this to approximately the expected snapshot size. For databases with many large entities, increase to 256 KB–1 MB.

#### CompressSnapshots

| Property | Value |
|----------|-------|
| **Type** | `bool` |
| **Default** | `true` |
| **Builder method** | Not currently exposed on `SnapshotOptionsBuilder` |

Snapshot files are compressed by default in the runtime snapshot format. This is
part of the persisted `SnapshotOptions` contract, but the current fluent
configuration builder does not expose a public toggle.

> **Note:** See [Persistence](/docs/engine/persistence) for the on-disk snapshot format and option matrix. If a future builder toggle is introduced, it should be documented here as the canonical configuration surface.

#### EnableIncrementalSnapshots

| Property | Value |
|----------|-------|
| **Type** | `bool` |
| **Default** | `false` |
| **Builder method** | `EnableIncrementalSnapshots(bool)` |

When enabled, only entities modified since the last snapshot are written (delta snapshots). Full snapshots are still created periodically based on `MaxDeltaChainLength` and `DeltaToFullThreshold`. Significantly reduces snapshot I/O for large databases with low churn.

```csharp
.WithSnapshot(s => s.EnableIncrementalSnapshots(true))
```

> **Note:** Delta snapshots require replaying the delta chain on recovery, which increases startup time proportionally to chain length. Balance with `MaxDeltaChainLength`.

#### MaxDeltaChainLength

| Property | Value |
|----------|-------|
| **Type** | `int` |
| **Default** | `10` |
| **Builder method** | `MaxDeltaChainLength(int)` |

Maximum number of consecutive delta snapshots before a full snapshot is forced. Limits recovery time by bounding the number of deltas that must be replayed during startup.

```csharp
.WithSnapshot(s => s
    .EnableIncrementalSnapshots(true)
    .MaxDeltaChainLength(5))
```

> **Note:** Only relevant when `EnableIncrementalSnapshots` is `true`. Lower values produce more full snapshots (more I/O) but faster recovery.

#### DeltaToFullThreshold

| Property | Value |
|----------|-------|
| **Type** | `double` (ratio, 0.0–1.0) |
| **Default** | `0.5` |
| **Builder method** | `DeltaToFullThreshold(double)` |

When the ratio of dirty (modified) entities to total entities exceeds this threshold, a full snapshot is created instead of a delta. Prevents delta snapshots from being nearly as large as full snapshots.

```csharp
.WithSnapshot(s => s
    .EnableIncrementalSnapshots(true)
    .DeltaToFullThreshold(0.3))  // Full snapshot if >30% changed
```

> **Note:** Only relevant when `EnableIncrementalSnapshots` is `true`. A value of `0.5` means a full snapshot is taken when more than half the entities have changed since the last full snapshot.

### Snapshot Parameters Summary

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `AutomaticSnapshotInterval` | `TimeSpan` | 5 min | Interval between automatic snapshots |
| `MaxSnapshotsToKeep` | `int` | 10 | Maximum snapshot files retained on disk |
| `SerializationBufferSize` | `int` | 64 KB | Initial serialization buffer capacity |
| `CompressSnapshots` | `bool` | `true` | Runtime default for snapshot file compression |
| `EnableIncrementalSnapshots` | `bool` | `false` | Enable delta snapshots |
| `MaxDeltaChainLength` | `int` | 10 | Max consecutive deltas before forced full |
| `DeltaToFullThreshold` | `double` | 0.5 | Dirty ratio to trigger full snapshot |

---

## Journal (WAL) Configuration

The write-ahead journal provides crash-recovery by recording each committed transaction to disk before secondary index synchronization completes. Journal settings are nested within the snapshot configuration.

```csharp
.WithSnapshot(snap => snap
    .WithJournaling(j => j
        .FlushInterval(TimeSpan.FromMilliseconds(200))
        .MaxJournalFileSize(4 * 1024 * 1024)
        .MaxStateChangesBeforeSnapshot(500)))
```

### Enabling Journaling

There are two ways to enable the journal:

```csharp
// With default settings
.WithSnapshot(s => s.WithJournaling())

// With custom settings
.WithSnapshot(s => s.WithJournaling(j => j
    .FlushInterval(TimeSpan.FromMilliseconds(500))))
```

Journaling is disabled by default. When enabled, the journal is written by the background worker thread after each committed transaction.

### Journal Parameters

#### FlushInterval

| Property | Value |
|----------|-------|
| **Type** | `TimeSpan` |
| **Default** | `100 ms` |
| **Builder method** | `FlushInterval(TimeSpan)` |

Base interval between forced flushes of journal data to disk. The actual interval may vary based on the adaptive flush logic (see `MinFlushIntervalMs` / `MaxFlushIntervalMs`), battery status, and write activity.

```csharp
.WithJournaling(j => j.FlushInterval(TimeSpan.FromMilliseconds(500)))
```

> **Trade-off:** Lower values improve durability (less data loss on crash) at the cost of more I/O and battery drain. Higher values batch more writes but increase the data-loss window.

#### MaxJournalFileSize

| Property | Value |
|----------|-------|
| **Type** | `int` (bytes) |
| **Default** | `2,097,152` (2 MB) |
| **Builder method** | `MaxJournalFileSize(int)` |

Maximum size in bytes for a single journal file before rotation. When a journal file reaches this size, it is closed and a new file is created. Keeps individual files manageable and aids incremental cleanup.

```csharp
.WithJournaling(j => j.MaxJournalFileSize(4 * 1024 * 1024))  // 4 MB
```

#### RecordsPerWrite

| Property | Value |
|----------|-------|
| **Type** | `int` |
| **Default** | `16` |
| **Builder method** | `RecordsPerWrite(int)` |

Number of change records batched into a single write I/O operation. Higher values reduce syscall overhead but increase memory pressure per flush.

```csharp
.WithJournaling(j => j.RecordsPerWrite(32))
```

#### MaxStateChangesBeforeSnapshot

| Property | Value |
|----------|-------|
| **Type** | `int` |
| **Default** | `100` |
| **Builder method** | `MaxStateChangesBeforeSnapshot(int)` |

Maximum number of state-change entries (individual entity mutations — Add, Update, Remove) that can accumulate in the journal before automatically triggering a full snapshot. Prevents unbounded journal growth and bounds recovery time.

```csharp
.WithJournaling(j => j.MaxStateChangesBeforeSnapshot(500))
```

> **Note:** Each `Add`, `Update`, or `Remove` on an entity counts as one state change. A single `Commit()` with 10 mutations counts as 10 state changes.

#### BufferSize

| Property | Value |
|----------|-------|
| **Type** | `int` (bytes) |
| **Default** | `65,536` (64 KB) |
| **Builder method** | `BufferSize(int)` |

Size of the write buffer used to batch multiple journal entries before flushing to disk. Larger buffers improve throughput but increase memory usage and potential data loss on crash.

```csharp
.WithJournaling(j => j.BufferSize(128 * 1024))  // 128 KB
```

> **Tip:** Should be aligned with flash storage page size for optimal performance on mobile devices.

#### ChannelCapacity

| Property | Value |
|----------|-------|
| **Type** | `int` |
| **Default** | `1024` |
| **Builder method** | `ChannelCapacity(int)` |

Bounded capacity of the internal `Channel<T>` used to queue journal entries. When the channel is full, backpressure is applied — writers are blocked until the journal processor catches up.

```csharp
.WithJournaling(j => j.ChannelCapacity(2048))
```

> **Note:** Increase for high-throughput systems with bursty write patterns. The default of 1024 is suitable for most game client workloads.

#### MaxEntrySize

| Property | Value |
|----------|-------|
| **Type** | `int` (bytes) |
| **Default** | `131,072` (128 KB) |
| **Builder method** | `MaxEntrySize(int)` |

Maximum allowed size for a single journal entry. Entries exceeding this size are considered corrupted during recovery and handled according to `CorruptionPolicy`. Prevents out-of-memory issues from malformed journal data.

```csharp
.WithJournaling(j => j.MaxEntrySize(256 * 1024))  // 256 KB
```

> **Note:** Set based on the largest expected legitimate entity size after serialization.

#### SerializationBufferSize (Journal)

| Property | Value |
|----------|-------|
| **Type** | `int` (bytes) |
| **Default** | `4,096` (4 KB) |
| **Builder method** | `SerializationBufferSize(int)` |

Initial size of the buffer for serializing individual journal entries via MessagePack. If an entry exceeds this size, the buffer automatically expands. Buffers are managed through an object pool (see `SerializationBuffersCount`).

```csharp
.WithJournaling(j => j.SerializationBufferSize(16 * 1024))  // 16 KB
```

> **Tip:** For mobile devices, 4 KB–16 KB is recommended. For systems with large entities, 64 KB+ reduces reallocation frequency.

#### SerializationBuffersCount

| Property | Value |
|----------|-------|
| **Type** | `int` |
| **Default** | `4` |
| **Builder method** | `SerializationBuffersCount(int)` |

Number of serialization buffers maintained in the object pool. Higher values allow more concurrent serialization operations but increase base memory usage.

```csharp
.WithJournaling(j => j.SerializationBuffersCount(8))
```

> **Tip:** Increase for high-concurrency scenarios where multiple threads commit simultaneously.

#### FileStreamBufferSize (Journal)

| Property | Value |
|----------|-------|
| **Type** | `int` (bytes) |
| **Default** | `4,096` (4 KB) |
| **Builder method** | `FileStreamBufferSize(int)` |

Buffer size for `FileStream` I/O operations when writing to journal files. Smaller values conserve memory; larger values reduce syscall frequency.

```csharp
.WithJournaling(j => j.FileStreamBufferSize(8 * 1024))  // 8 KB
```

> **Note:** The default 4 KB is optimized for mobile environments with memory constraints. For desktop/server, 8–64 KB may improve throughput.

#### QueueThresholdForSnapshot

| Property | Value |
|----------|-------|
| **Type** | `int` |
| **Default** | `10` |
| **Builder method** | `QueueThresholdForSnapshot(int)` |

When the number of pending journal records exceeds this threshold, the snapshot trigger is delayed (by `DelayBeforeSnapshotMs`) to allow the journal queue to drain first. Prevents snapshot I/O from competing with journal writes during bursts.

```csharp
.WithJournaling(j => j.QueueThresholdForSnapshot(20))
```

#### DelayBeforeSnapshotMs

| Property | Value |
|----------|-------|
| **Type** | `int` (milliseconds) |
| **Default** | `500` |
| **Builder method** | `DelayBeforeSnapshotMs(int)` |

Delay in milliseconds before taking a snapshot when the journal queue is busy (exceeds `QueueThresholdForSnapshot`). Allows additional writes to be batched into the same snapshot.

```csharp
.WithJournaling(j => j.DelayBeforeSnapshotMs(1000))  // 1 second
```

#### HighWriteOpsPerSecond

| Property | Value |
|----------|-------|
| **Type** | `int` |
| **Default** | `100` |
| **Builder method** | `HighWriteOpsPerSecond(int)` |

Write operations per second threshold that triggers high-throughput mode. When the journal detects write rates above this threshold, it switches to less frequent flushes and larger batches to optimize throughput.

```csharp
.WithJournaling(j => j.HighWriteOpsPerSecond(500))
```

#### MinFlushIntervalMs

| Property | Value |
|----------|-------|
| **Type** | `int` (milliseconds) |
| **Default** | `100` |
| **Builder method** | `MinFlushIntervalMs(int)` |

Minimum flush interval for the adaptive flush logic. The journal will not flush more frequently than this, even under heavy write load. Prevents excessive I/O during burst writes.

```csharp
.WithJournaling(j => j.MinFlushIntervalMs(50))  // More aggressive flushing
```

#### MaxFlushIntervalMs

| Property | Value |
|----------|-------|
| **Type** | `int` (milliseconds) |
| **Default** | `5000` |
| **Builder method** | `MaxFlushIntervalMs(int)` |

Maximum flush interval for the adaptive flush logic. The journal will flush at least this often, even under low write load, to bound the data-loss window on crash.

```csharp
.WithJournaling(j => j.MaxFlushIntervalMs(10000))  // 10 seconds max
```

### Adaptive Flush Logic

The journal uses an adaptive flush strategy that adjusts the flush interval based on write activity:

```
Write Rate ─────────────────────────────────────────────►
                │                    │
  MaxFlushIntervalMs          MinFlushIntervalMs
   (5000 ms)                   (100 ms)
                │                    │
  Low activity ─┤────────────────────┤─ High activity
                │  HighWriteOps/s    │
                │  threshold (100)   │
```

- **Low write rate** (below `HighWriteOpsPerSecond`): Flushes at `MaxFlushIntervalMs` to conserve I/O.
- **High write rate** (at or above `HighWriteOpsPerSecond`): Flushes at `MinFlushIntervalMs` for durability.
- **Battery low**: Flush intervals may be extended when `IBatteryStatusProvider.IsBatteryLow()` returns `true`.

### Journal Corruption Policy

The `JournalCorruptionPolicy` controls how the recovery handler responds to corrupted journal entries. Configure it through `WithJournaling(j => j.CorruptionPolicy(...))`.

| Value | Behavior |
|-------|----------|
| `StopAtCorruption` | Stop replaying at the first corrupted entry. Recovers all valid entries up to corruption point. **(Default)** |
| `SkipCorrupted` | Skip corrupted entries and continue replaying subsequent valid entries. |
| `Fail` | Throw an exception immediately on encountering corruption. |

`DurabilityPolicy.CriticalState` and `DurabilityPolicy.ForceFlushEveryCommit`
require `JournalCorruptionPolicy.Fail`. These profiles force committed journal
data to stable storage and must also fail startup on journal corruption instead
of accepting partial replay.

### Journal Parameters Summary

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `FlushInterval` | `TimeSpan` | 100 ms | Base interval between disk flushes |
| `MaxJournalFileSize` | `int` | 2 MB | Max file size before rotation |
| `RecordsPerWrite` | `int` | 16 | Records batched per write I/O |
| `MaxStateChangesBeforeSnapshot` | `int` | 100 | State changes before auto-snapshot |
| `BufferSize` | `int` | 64 KB | Write buffer size |
| `ChannelCapacity` | `int` | 1024 | Bounded queue capacity |
| `MaxEntrySize` | `int` | 128 KB | Max single entry size |
| `SerializationBufferSize` | `int` | 4 KB | Per-entry serialization buffer |
| `SerializationBuffersCount` | `int` | 4 | Pooled serialization buffers |
| `FileStreamBufferSize` | `int` | 4 KB | FileStream I/O buffer |
| `QueueThresholdForSnapshot` | `int` | 10 | Queue depth to delay snapshot |
| `DelayBeforeSnapshotMs` | `int` | 500 ms | Delay before snapshot on busy queue |
| `HighWriteOpsPerSecond` | `int` | 100 | Ops/sec for high-throughput mode |
| `MinFlushIntervalMs` | `int` | 100 ms | Min adaptive flush interval |
| `MaxFlushIntervalMs` | `int` | 5000 ms | Max adaptive flush interval |
| `CorruptionPolicy` | `JournalCorruptionPolicy` | `StopAtCorruption` | Recovery behavior for corrupted journal entries |

---

## Encryption Configuration

ConjureDB supports AES-GCM encryption for all persistence files (snapshots and journals). Encryption is configured via `WithEncryption(Action<EncryptionOptionsBuilder>)`.

```csharp
.WithEncryption(enc => enc
    .Password("my-strong-unique-password")
    .KeySizeInBits(256)
    .Salt("unique-per-database-salt-value-here"))
```

### Encryption Parameters

#### Password

| Property | Value |
|----------|-------|
| **Type** | `string` |
| **Default** | `null` (required when encryption is enabled) |
| **Builder method** | `Password(string)` |

Encryption password used for AES key derivation via PBKDF2. Required when encryption is enabled. Must be a strong, unique password.

```csharp
.WithEncryption(enc => enc.Password("secure-password-here"))
```

> **Security:** Never hardcode passwords in source code. Load from secure storage (e.g., iOS Keychain, Android Keystore, environment variables).

#### KeySizeInBits

| Property | Value |
|----------|-------|
| **Type** | `int` |
| **Default** | `256` |
| **Allowed values** | `128`, `192`, `256` |
| **Builder method** | `KeySizeInBits(int)` |

AES key size in bits. Higher key sizes provide stronger encryption at a marginal CPU cost.

```csharp
.WithEncryption(enc => enc
    .Password("secure-password")
    .KeySizeInBits(128))  // Faster, still secure for most use cases
```

| Key Size | Security Level | Performance Impact |
|----------|---------------|--------------------|
| 128-bit | Strong | Fastest |
| 192-bit | Stronger | Negligible overhead vs 128 |
| 256-bit | Strongest | Negligible overhead vs 192 |

> **Recommendation:** Use 256-bit (default) unless profiling shows encryption as a bottleneck on your target device.

#### Salt

| Property | Value |
|----------|-------|
| **Type** | `string` |
| **Default** | Cryptographically random (32 bytes, Base64-encoded via `RandomNumberGenerator`) |
| **Builder method** | `Salt(string)` |

Cryptographic salt for PBKDF2 key derivation and nonce generation. Must be at least 16 bytes when UTF-8 encoded. Each database instance should use a unique salt.

```csharp
.WithEncryption(enc => enc
    .Password("secure-password")
    .Salt("my-unique-database-salt-at-least-16-bytes"))
```

> **Important:** The default generates a **new random salt on each instantiation**. If you need to read data encrypted in a previous session, you **must** persist and reuse the same salt. Store it alongside the encrypted data or in platform-secure storage.

You can generate a salt programmatically:

```csharp
string salt = EncryptionOptions.GenerateRandomSalt();        // 32 bytes (default)
string salt = EncryptionOptions.GenerateRandomSalt(64);      // 64 bytes
```

### Encryption Implementation Details

- **Algorithm:** AES-GCM (Galois/Counter Mode) — authenticated encryption with associated data (AEAD)
- **Chunking:** Files are encrypted in 4 KB chunks, each with its own authentication tag
- **Key derivation:** PBKDF2 from password + salt
- **Implementation:** BouncyCastle (portable, Unity-compatible — no platform-specific crypto APIs)
- **Custom streams:** `IProtectedFileStreamFactory` can be overridden for platform-specific encryption (e.g., iOS Keychain integration)

### Encryption Parameters Summary

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `Password` | `string` | `null` (required) | PBKDF2 key derivation password |
| `KeySizeInBits` | `int` | 256 | AES key size: 128, 192, or 256 |
| `Salt` | `string` | Random (32 bytes) | Key derivation salt (≥16 bytes UTF-8) |

---

## Remote Sync Configuration

Remote snapshot sync enables cloud save / backup functionality. Configured via `WithRemoteSnapshot(Action<RemoteSnapshotOptionsBuilder>)`.

```csharp
.WithRemoteSnapshot(remote => remote
    .RemoteHandler(new CloudSaveHandler())
    .RequestTimeout(TimeSpan.FromSeconds(30))
    .MaxRetryAttempts(5)
    .ResolutionStrategy(StateResolutionStrategy.RemoteFirst))
```

### Remote Sync Parameters

#### RemoteHandler

| Property | Value |
|----------|-------|
| **Type** | `IRemoteSnapshotHandler` |
| **Default** | `null` (required for remote sync) |
| **Builder method** | `RemoteHandler(IRemoteSnapshotHandler)` |

Handler implementation responsible for uploading and downloading remote snapshots. The handler must implement:

```csharp
public interface IRemoteSnapshotHandler
{
    Task<ulong?> GetRemoteVersionAsync();
    Task LoadSnapshotAsync(DbContext context);
    Task UploadSnapshotAsync(DbContext context, ulong version);
}
```

#### RequestTimeout

| Property | Value |
|----------|-------|
| **Type** | `TimeSpan` |
| **Default** | `null` (no timeout) |
| **Builder method** | `RequestTimeout(TimeSpan)` |

HTTP request timeout for remote snapshot operations (upload, download, version check).

```csharp
.WithRemoteSnapshot(r => r.RequestTimeout(TimeSpan.FromSeconds(30)))
```

#### MaxRetryAttempts

| Property | Value |
|----------|-------|
| **Type** | `int` |
| **Default** | `3` |
| **Builder method** | `MaxRetryAttempts(int)` |

Maximum number of retry attempts for failed remote snapshot operations before giving up.

```csharp
.WithRemoteSnapshot(r => r.MaxRetryAttempts(5))
```

#### ResolutionStrategy

| Property | Value |
|----------|-------|
| **Type** | `StateResolutionStrategy` |
| **Default** | `RemoteFirst` |
| **Builder method** | `ResolutionStrategy(StateResolutionStrategy)` |

Conflict resolution strategy when local and remote snapshot versions diverge.

| Strategy | Behavior |
|----------|----------|
| `LocalFirst` | Use local state unless remote is strictly newer |
| `RemoteFirst` | Prefer remote state **(Default)** |
| `ForceLocal` | Always use local state, ignore remote |
| `ForceRemote` | Always use remote state, overwrite local |

```csharp
.WithRemoteSnapshot(r => r.ResolutionStrategy(StateResolutionStrategy.ForceRemote))
```

### Remote Sync Parameters Summary

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `RemoteHandler` | `IRemoteSnapshotHandler` | `null` (required) | Upload/download handler |
| `RequestTimeout` | `TimeSpan?` | `null` | HTTP request timeout |
| `MaxRetryAttempts` | `int` | 3 | Max retries on failure |
| `ResolutionStrategy` | `StateResolutionStrategy` | `RemoteFirst` | Conflict resolution strategy |

---

## Migration Configuration

Schema migration settings are configured via `WithMigration(Action<MigrationOptionsBuilder>)`.

```csharp
.WithMigration(m => m
    .SnapshotAfterMigration(true)
    .VerboseLogging(true))
```

### Migration Parameters

#### SnapshotAfterMigration

| Property | Value |
|----------|-------|
| **Type** | `bool` |
| **Default** | `true` |
| **Builder method** | `SnapshotAfterMigration(bool)` |

When enabled, automatically takes a full snapshot after migrations are applied so that subsequent startups do not need to re-run migrations. Recommended to keep enabled.

```csharp
.WithMigration(m => m.SnapshotAfterMigration(true))
```

#### VerboseLogging

| Property | Value |
|----------|-------|
| **Type** | `bool` |
| **Default** | `false` |
| **Builder method** | `VerboseLogging(bool)` |

Enables detailed logging of each migration step for debugging schema evolution issues. Requires an active `ILoggerFactory` to see output.

```csharp
.WithMigration(m => m.VerboseLogging(true))
```

### Migration Parameters Summary

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `SnapshotAfterMigration` | `bool` | `true` | Auto-snapshot after migration |
| `VerboseLogging` | `bool` | `false` | Detailed migration logging |

---

## Configuration Examples

### Minimal Configuration (In-Memory Only)

No persistence — data lives only in memory. Fastest startup, zero I/O.

```csharp
var db = DbContextBuilder<GameDb>.Create()
    .Build();
```

### Snapshot-Only Persistence

Periodic snapshots without journaling. Simple and low-overhead, but data since the last snapshot is lost on crash.

```csharp
var db = DbContextBuilder<GameDb>.Create()
    .WithDataDirectory("game_data")
    .WithSnapshot(s => s
        .AutomaticSnapshotInterval(TimeSpan.FromMinutes(5))
        .MaxSnapshotsToKeep(5))
    .Build();
```

### Production Game Client

Full durability with journaling, encryption, incremental snapshots, and memory budget.

```csharp
var db = DbContextBuilder<GameDb>.Create()
    .WithDataDirectory(Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "MyGame", "db"))
    .WithSnapshot(s => s
        .AutomaticSnapshotInterval(TimeSpan.FromMinutes(3))
        .MaxSnapshotsToKeep(5)
        .EnableIncrementalSnapshots(true)
        .MaxDeltaChainLength(5)
        .DeltaToFullThreshold(0.3)
        .SerializationBufferSize(128 * 1024)
        .WithJournaling(j => j
            .FlushInterval(TimeSpan.FromMilliseconds(200))
            .MaxStateChangesBeforeSnapshot(500)
            .MaxJournalFileSize(4 * 1024 * 1024)
            .BufferSize(64 * 1024)))
    .WithEncryption(enc => enc
        .Password(SecureStorage.GetPassword())
        .KeySizeInBits(256)
        .Salt(SecureStorage.GetSalt()))
    .WithMemoryBudgetMB(256)
    .WithLoggerFactory(loggerFactory)
    .Build();
```

### Unity Mobile Game (AOT-Safe)

Configuration tailored for mobile: unified builder path, battery awareness, conservative memory.

```csharp
var db = DbContextBuilder<GameDb>.Create()
    .WithDataDirectory(Application.persistentDataPath + "/db")
    .WithSnapshot(s => s
        .AutomaticSnapshotInterval(TimeSpan.FromMinutes(5))
        .MaxSnapshotsToKeep(3)
        .SerializationBufferSize(32 * 1024)
        .WithJournaling(j => j
            .FlushInterval(TimeSpan.FromMilliseconds(500))
            .MaxStateChangesBeforeSnapshot(200)
            .MaxJournalFileSize(1 * 1024 * 1024)
            .BufferSize(32 * 1024)
            .SerializationBufferSize(4 * 1024)
            .SerializationBuffersCount(2)
            .FileStreamBufferSize(4 * 1024)
            .ChannelCapacity(512)))
    .WithEncryption(enc => enc
        .Password(GetEncryptionPassword())
        .KeySizeInBits(256))
    .WithBatteryStatusProvider(new UnityBatteryProvider())
    .WithMemoryBudgetMB(128)
    .Build();
```

### Development / Debug

Verbose logging, no encryption, fast snapshots for iteration.

```csharp
var db = DbContextBuilder<GameDb>.Create()
    .WithDataDirectory("dev_data")
    .WithSnapshot(s => s
        .AutomaticSnapshotInterval(TimeSpan.FromSeconds(30))
        .MaxSnapshotsToKeep(3)
        .WithJournaling())
    .WithLoggerFactory(LoggerFactory.Create(builder =>
        builder.AddConsole().SetMinimumLevel(LogLevel.Debug)))
    .WithMigration(m => m.VerboseLogging(true))
    .Build();
```

### High-Write Workload

Optimized for applications with frequent mutations (e.g., real-time simulation, trading).

```csharp
var db = DbContextBuilder<GameDb>.Create()
    .WithDataDirectory("highwrite_data")
    .WithSnapshot(s => s
        .AutomaticSnapshotInterval(TimeSpan.FromMinutes(10))
        .MaxSnapshotsToKeep(5)
        .EnableIncrementalSnapshots(true)
        .MaxDeltaChainLength(3)
        .DeltaToFullThreshold(0.2)
        .SerializationBufferSize(256 * 1024)
        .WithJournaling(j => j
            .FlushInterval(TimeSpan.FromMilliseconds(50))
            .MaxJournalFileSize(8 * 1024 * 1024)
            .RecordsPerWrite(64)
            .MaxStateChangesBeforeSnapshot(2000)
            .BufferSize(256 * 1024)
            .ChannelCapacity(4096)
            .MaxEntrySize(256 * 1024)
            .SerializationBufferSize(64 * 1024)
            .SerializationBuffersCount(8)
            .FileStreamBufferSize(64 * 1024)
            .HighWriteOpsPerSecond(1000)
            .MinFlushIntervalMs(25)
            .MaxFlushIntervalMs(2000)))
    .WithMemoryBudgetMB(1024)
    .Build();
```

### Cloud Save with Remote Sync

Persistent local database with cloud backup.

```csharp
var db = DbContextBuilder<GameDb>.Create()
    .WithDataDirectory("cloud_game_data")
    .WithSnapshot(s => s
        .AutomaticSnapshotInterval(TimeSpan.FromMinutes(5))
        .MaxSnapshotsToKeep(5)
        .WithJournaling())
    .WithRemoteSnapshot(r => r
        .RemoteHandler(new MyCloudSaveHandler(httpClient))
        .RequestTimeout(TimeSpan.FromSeconds(30))
        .MaxRetryAttempts(5)
        .ResolutionStrategy(StateResolutionStrategy.RemoteFirst))
    .WithEncryption(enc => enc
        .Password(SecureStorage.GetPassword()))
    .Build();
```

---

## Configuration Best Practices

### Journal vs. Snapshot-Only

| Consideration | Snapshot-Only | Snapshot + Journal |
|---------------|---------------|-------------------|
| Data loss window | Up to `AutomaticSnapshotInterval` | Up to `FlushInterval` (ms) |
| Disk I/O | Periodic large writes | Continuous small writes |
| Recovery time | Fast (single file read) | Snapshot + journal replay |
| Complexity | Simple | More tuning parameters |
| Recommended for | Development, non-critical data | Production, user-facing data |

**Rule of thumb:** If losing 5 minutes of data is unacceptable, enable journaling.

### Memory Budget Sizing

| Scenario | Recommended Budget |
|----------|--------------------|
| Mobile casual game | 64–128 MB |
| Mobile RPG / strategy | 128–256 MB |
| Desktop game client | 256–512 MB |
| Desktop simulation | 512 MB–2 GB |

Subscribe to `MemoryPressureChanged` to react to pressure levels:

```csharp
budget.MemoryPressureChanged += (sender, args) =>
{
    if (args.Level == MemoryPressureLevel.Warning)
        EvictCaches();
    else if (args.Level == MemoryPressureLevel.Critical)
        ReduceEntityPools();
};
```

### Encryption Performance Impact

AES-GCM encryption adds overhead to all persistence I/O:

| Operation | Overhead (approximate) |
|-----------|----------------------|
| Snapshot write | 5–15% slower |
| Snapshot read | 5–15% slower |
| Journal write | 3–10% per entry |
| Journal read (recovery) | 3–10% per entry |

The chunked 4 KB encryption means overhead scales linearly with data size. For most game clients, the overhead is negligible compared to serialization cost.

### Flush Interval Tuning

| Scenario | FlushInterval | MinFlushIntervalMs | MaxFlushIntervalMs |
|----------|---------------|--------------------|--------------------|
| Maximum durability | 50 ms | 25 ms | 1000 ms |
| Balanced (default) | 100 ms | 100 ms | 5000 ms |
| Battery-friendly | 500 ms | 200 ms | 10000 ms |
| High throughput | 100 ms | 50 ms | 3000 ms |

### Incremental Snapshot Tuning

| Workload | DeltaToFullThreshold | MaxDeltaChainLength |
|----------|---------------------|---------------------|
| Low churn (< 5% entities change between snapshots) | 0.5 | 10 |
| Medium churn (5–20%) | 0.3 | 5–8 |
| High churn (> 20%) | 0.2 | 3–5 |
| Batch imports | 0.1 | 2 |

---

## All Parameters Quick Reference

### General

| Parameter | Default | Builder Method |
|-----------|---------|----------------|
| DataDirectory | `<BaseDir>/db_data` | `WithDataDirectory(string)` |
| Serializer | MessagePack | `WithSerializer(IBinarySerializer)` |
| SettingsLoaderFactory | Default factory | `WithSettingsLoaderFactory(SettingsLoaderFactory)` |
| LoggerFactory | NullLoggerFactory | `WithLoggerFactory(ILoggerFactory)` |
| MemoryBudget | Disabled | `WithMemoryBudget(long)` / `WithMemoryBudgetMB(int)` |
| BatteryStatusProvider | Disabled | `WithBatteryStatusProvider(IBatteryStatusProvider)` |

### Snapshot

| Parameter | Default | Builder Method |
|-----------|---------|----------------|
| AutomaticSnapshotInterval | 5 min | `AutomaticSnapshotInterval(TimeSpan)` |
| MaxSnapshotsToKeep | 10 | `MaxSnapshotsToKeep(int)` |
| SerializationBufferSize | 64 KB | `SerializationBufferSize(int)` |
| CompressSnapshots | true | Runtime default only (no fluent builder toggle) |
| EnableIncrementalSnapshots | false | `EnableIncrementalSnapshots(bool)` |
| MaxDeltaChainLength | 10 | `MaxDeltaChainLength(int)` |
| DeltaToFullThreshold | 0.5 | `DeltaToFullThreshold(double)` |

### Durability

| Parameter | Default | Builder Method |
|-----------|---------|----------------|
| DurabilityPolicy | `FastMobile` | `WithDurabilityPolicy(DurabilityPolicy)` |

### Journal (WAL)

| Parameter | Default | Builder Method |
|-----------|---------|----------------|
| FlushInterval | 100 ms | `FlushInterval(TimeSpan)` |
| MaxJournalFileSize | 2 MB | `MaxJournalFileSize(int)` |
| RecordsPerWrite | 16 | `RecordsPerWrite(int)` |
| MaxStateChangesBeforeSnapshot | 100 | `MaxStateChangesBeforeSnapshot(int)` |
| BufferSize | 64 KB | `BufferSize(int)` |
| ChannelCapacity | 1024 | `ChannelCapacity(int)` |
| MaxEntrySize | 128 KB | `MaxEntrySize(int)` |
| SerializationBufferSize | 4 KB | `SerializationBufferSize(int)` |
| SerializationBuffersCount | 4 | `SerializationBuffersCount(int)` |
| FileStreamBufferSize | 4 KB | `FileStreamBufferSize(int)` |
| QueueThresholdForSnapshot | 10 | `QueueThresholdForSnapshot(int)` |
| DelayBeforeSnapshotMs | 500 ms | `DelayBeforeSnapshotMs(int)` |
| HighWriteOpsPerSecond | 100 | `HighWriteOpsPerSecond(int)` |
| MinFlushIntervalMs | 100 ms | `MinFlushIntervalMs(int)` |
| MaxFlushIntervalMs | 5000 ms | `MaxFlushIntervalMs(int)` |

### Encryption

| Parameter | Default | Builder Method |
|-----------|---------|----------------|
| Password | null (required) | `Password(string)` |
| KeySizeInBits | 256 | `KeySizeInBits(int)` |
| Salt | Random (32 bytes) | `Salt(string)` |

### Remote Sync

| Parameter | Default | Builder Method |
|-----------|---------|----------------|
| RemoteHandler | null (required) | `RemoteHandler(IRemoteSnapshotHandler)` |
| RequestTimeout | null | `RequestTimeout(TimeSpan)` |
| MaxRetryAttempts | 3 | `MaxRetryAttempts(int)` |
| ResolutionStrategy | RemoteFirst | `ResolutionStrategy(StateResolutionStrategy)` |

### Migration

| Parameter | Default | Builder Method |
|-----------|---------|----------------|
| SnapshotAfterMigration | true | `SnapshotAfterMigration(bool)` |
| VerboseLogging | false | `VerboseLogging(bool)` |

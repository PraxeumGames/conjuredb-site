# Database Engine Reference

ConjureDB is a high-performance, zero-allocation, in-memory NoSQL database engine designed for game clients, embedded applications, and latency-sensitive systems. This document is the authoritative API reference for the runtime database engine.

---

## Architecture Overview

### Storage Model

ConjureDB stores all data in-memory using contiguous, cache-friendly arrays. Each entity type occupies a dedicated **`DbSet<T>`** collection backed by a `PrimaryIndex<T>`. Entities are identified by `int` primary keys and stored in dense, contiguous storage with O(1) lookups.

```text
┌─────────────────────────────────────────────────────────┐
│                        DbContext                        │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │ DbSet<Player>│  │ DbSet<Item>  │  │ DbSet<Order> │  │
│  │              │  │              │  │              │  │
│  │ PrimaryIndex │  │ PrimaryIndex │  │ PrimaryIndex │  │
│  │ SecondaryIdx │  │ SecondaryIdx │  │ SecondaryIdx │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  │
│                                                         │
│  TransactionManager  │  DbWorker  │  DbPersistence     │
└─────────────────────────────────────────────────────────┘
```

### Core Types

| Type | Responsibility |
|------|----------------|
| `DbContext` | Entry point. Owns entity collections, transactions, persistence, background worker, and diagnostics. |
| `DbSet<T>` | Typed collection for a single entity table. Provides CRUD, primary-key lookup, index access, and change subscriptions. |
| `TransactionManager` | Coordinates versioned ACID transactions across all tables. |
| `DbWorker` | Serialized background execution lane for deferred secondary index synchronization and journal writes. |
| `DbPersistence` | Manages snapshots, journals (WAL), encryption, and remote sync. |

### Transaction Semantics

ConjureDB uses versioned ACID transactions. All mutations (Add, Update, Remove) are buffered and applied atomically on `Commit()`. Nested transactions are not supported.

**Isolation level**: Read-committed. Uncommitted mutations are invisible to other readers. After `Commit()`, primary index updates are immediately visible; secondary index updates are deferred to the background worker.

### Thread Safety Model

| Operation | Thread Safety |
|-----------|--------------|
| Mutations (`Add`, `Update`, `Remove`, `BeginTransaction`, `Commit`, `Rollback`) | **Single-threaded** — caller must synchronize |
| Primary index point reads (`FindById`, `TryFindById`, `Contains`, `Count`) | **Safe from any thread** after `Commit()` |
| Primary index bulk borrows (`All()`, `AsMemory`, `DenseIndexById`) | **Temporal separation** — live views require no concurrent writer mutation; consume them before the next mutation |
| Secondary index value-owned/snapshot-owned reads (via synchronized query APIs) | **Safe from any thread** after worker sync; by-ref/no-sync borrows require temporal separation and no concurrent index mutation |
| `CommitAsync` | Thread-safe via internal `SemaphoreSlim` |
| `Dispose()` | Persistent-only contexts: one caller thread. After `Frame` is created: owning frame thread only; a late teardown failure may be retried on that thread. |

---

## DbContext

`DbContext` is the central entry point for the ConjureDB database. Application
contexts are generated from `.conjure` schema files; the generated context owns
the `DbSet<T>` registrations, explicit runtime table descriptors, indexes, and
compiled operations.

### Defining a Context

```conjure
table Player(plural: Players, persistence: local, capacity: 1024, type_id: 1) {
  id       : int @id
  name     : string
  level    : int
  guild_id : int
}
```

The generated `GameDbContext` exposes typed sets for runtime code and registers
them through schema descriptors during `Build()`.

### Properties

| Property | Type | Description |
|----------|------|-------------|
| `Version` | `ulong` | Latest committed transaction version. Increments with each `Commit()`. |
| `IsTransactionInStarted` | `bool` | `true` when a transaction is in progress. |
| `IsInitialized` | `bool` | `true` only after `InitializeAsync()` and `OnInitialize()` complete successfully. Initialization is single-attempt; a failure is terminal and the context must be disposed. |
| `IsWorkerRunning` | `bool` | Serialized background scheduler status. |
| `WorkerHealth` | `WorkerHealthState` | Current health state: `Healthy`, `Degraded`, or `Stopped`. |
| `Profiler` | `IQueryProfiler` | PGO profiler instance. Default: `NullQueryProfiler.Instance` (zero overhead). |
| `IndexCollector` | `IndexRecommendationCollector?` | Collects filter column usage for index recommendations. |
| `JoinCollector` | `JoinCardinalityCollector?` | Collects join statistics for strategy optimization. |
| `PackedKeyRangeCollector` | `PackedKeyRangeCollector?` | Collects key ranges for packed key selection. |
| `ReactiveQueryRegistry` | `ReactiveQueryRegistry` | Registry for all active reactive queries. Coordinates IVM delta application. |
| `MigrationRegistry` | `MigrationRegistry` | Registry for schema migrations. Register migrations before `InitializeAsync()`. |
| `Persistence` | `DbPersistence` | Persistence layer for snapshot and journal management. |
| `DbSets` | `DbSetRegistry` | Read-only view of persistent entity collections, indexed by durable type id. Supports `Count`, `Contains(typeId)`, getter-only lookup, `TryGetValue(typeId, out set)`, allocation-free `foreach`, and `AsSpan()`. Registry membership is sealed during `InitializeAsync()`; frame-local ephemeral storage is excluded. |
| `Frame` | `FrameScheduler` | Context-owned frame runtime. Owner-thread only; ownership is captured when the context is constructed. |
| `ReactiveTelemetryCollector` | `ReactiveRuntimeTelemetryCollector` | Always-on in-memory telemetry for reactive queries. |

#### Read-only DbSet registry

`DbSets` returns a `DbSetRegistry`, not the runtime's mutable sparse-set storage.
The context remains the sole owner of registry membership, which is fixed when
`InitializeAsync()` seals the runtime. Applications can inspect the registered
persistent sets without an allocation:

```csharp
var registry = context.DbSets;

if (registry.Count != 0 && registry.TryGetValue(registry.AsSpan()[0].Id, out var set))
    Console.WriteLine($"{set.TableName}: {set.Count}");

foreach (var registeredSet in registry)
    Console.WriteLine(registeredSet.TableName);
```

The registry also provides `Count`, `Contains(typeId)`, a getter-only
`registry[typeId]` indexer, and `AsSpan()`. It intentionally has no `Add`,
`Remove`, `Clear`, or index setter. Persistent set registration is a build-time
context concern; attempts by a derived context to call `AddSet<T>` after the
runtime seal fail before worker or persistence state can change.

### Transaction Methods

#### `BeginTransaction()`

```csharp
public void BeginTransaction()
```

Opens a write scope. All subsequent mutations on any `DbSet<T>` are buffered until `Commit()` or `Rollback()`.

**Throws**: `InvalidOperationException` if a transaction is already active.

```csharp
context.BeginTransaction();
context.Players.Add(new Player { Id = 1, Name = "Alice" });
context.Commit();
```

#### `BeginScopedTransaction()`

```csharp
public TransactionScope BeginScopedTransaction()
```

Returns a stack-only `TransactionScope` that auto-rolls back on `Dispose()` if not committed. Preferred pattern for exception safety.

```csharp
using var tx = context.BeginScopedTransaction();
context.Players.Add(new Player { Id = 1, Name = "Alice" });
tx.Commit();
// If an exception occurs before Commit(), Dispose() auto-rolls back.
```

**`TransactionScope` members:**

| Method | Description |
|--------|-------------|
| `Commit()` | Commits all buffered mutations. |
| `Dispose()` | Rolls back if `Commit()` was not called. |

#### `Commit()`

```csharp
public void Commit()
```

Atomically applies all buffered mutations to the primary index, fires change event subscribers, advances `Version`, and signals the background worker. On .NET 6+, records `TransactionCommits` and `CommitDurationMs` metrics.

**Throws**: `InvalidOperationException` if no transaction is active.

#### `CommitAsync(bool forceFlush, CancellationToken)`

```csharp
public async Task CommitAsync(bool forceFlush = false, CancellationToken cancellationToken = default)
```

Async variant of `Commit()`. Serialized via internal `SemaphoreSlim` for thread safety.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `forceFlush` | `bool` | `false` | When `true`, waits for the journal to flush to disk before returning — guarantees durability. |
| `cancellationToken` | `CancellationToken` | `default` | Cancellation token for the async wait. |

#### `Rollback()`

```csharp
public void Rollback()
```

Discards all buffered mutations and ends the transaction.

**Throws**: `InvalidOperationException` if no transaction is active.

### Query & Command Methods

#### `Set<T>()`

```csharp
public DbSet<T> Set<T>()
```

Returns the `DbSet<T>` for the specified entity type. The set must have been registered during `Build()`.

```csharp
DbSet<Player> players = context.Set<Player>();
```

#### `Query<TQuery, TResult>(TQuery)`

```csharp
public TResult Query<TQuery, TResult>(TQuery query) where TQuery : IQuery<TResult>
```

Executes a strongly-typed query against this context.

#### `Execute<TCommand>(TCommand)`

```csharp
public Task Execute<TCommand>(TCommand command) where TCommand : ICommand
```

Executes a strongly-typed command that mutates database state.

### Query Interception

ConjureDB can intercept query dispatch before the compiled handler runs. This is
configured on `DbContextBuilder<TContext>` and applied during context construction,
before the operation registry is sealed.

Builder hooks:

```csharp
public DbContextBuilder<TContext> WithQueryInterceptor(IQueryInterceptor interceptor)
public DbContextBuilder<TContext> WithQueryInterceptorFactory(Func<DbContext, IQueryInterceptor?> factory)
```

Interceptor contract:

```csharp
public interface IQueryInterceptor
{
    QueryInterceptionResult<TResult> Intercept<TQuery, TResult>(DbContext context, TQuery query)
        where TQuery : IQuery<TResult>;
}
```

`QueryInterceptionResult<TResult>` is a closed result union with three outcomes:

| Result | Runtime behavior |
|--------|------------------|
| `Proceed` | The compiled query handler runs normally. |
| `Override(result)` | The interceptor supplies the final result and the compiled handler is skipped. |
| `Rejected(reasonCode)` | Query dispatch aborts and `DbContext.Query(...)` throws `InvalidOperationException` with the rejection reason code. |

Typical uses:

- portable/interpreted override for selected queries under explicit host policy,
- diagnostics and policy gates before compiled dispatch,
- deterministic test harness overrides for specific query types.

The `Dual` execution lane only emits both artifacts. ConjureDB does not
automatically switch between compiled and portable execution on its own; a
host-owned surface such as `IQueryInterceptor` must decide whether to proceed,
override, or reject dispatch.

```csharp
var context = DbContextBuilder<GameDbContext>.Create()
    .WithQueryInterceptorFactory(db => new MyQueryInterceptor())
    .Build();
```

Rules:

- interception applies to `Query<TQuery, TResult>(...)`, not command execution,
- the interceptor instance is attached before `OperationRegistry.Seal()`,
- a factory may return `null` when a context should run without interception.

### Persistence Methods

#### `Save()` / `SaveAsync()`

```csharp
public void Save()
public async Task SaveAsync()
```

Triggers a manual persistence snapshot of the current database state. `Save()` blocks the calling thread; prefer `SaveAsync()` in async contexts.

#### `SaveProfile(string path, RuntimeProfileGovernanceMetadata? governanceMetadata = null)`

```csharp
public void SaveProfile(string path, RuntimeProfileGovernanceMetadata? governanceMetadata = null)
```

Exports collected PGO profile data to a JSON file with automatic schema hash computation. Requires `EnableProfiling()` to be called first; logs a warning and returns if profiling is not active. The export includes query/operator telemetry, join/index runtime hints, materialized relation/index/arrangement state diagnostics, and table-level column cardinality summaries (`DistinctCount`, MCV, histogram) used by compiler profile-driven optimization. Optional governance metadata lets you persist profile identity, lifecycle, provenance, workload fingerprint, and evidence lineage directly into the runtime export.

```csharp
context.EnableProfiling();
// ... run representative workloads ...
context.SaveProfile("profile.json", new RuntimeProfileGovernanceMetadata
{
    ProfileId = "profile.default",
    LifecycleState = "candidate",
    ProvenanceSource = "local.dev",
    WorkloadFingerprint = "workload.default"
});
```

#### `EnableProfiling()`

```csharp
public void EnableProfiling()
```

Activates PGO instrumentation mode. Creates and assigns `QueryProfilerCollector`, `IndexRecommendationCollector`, `JoinCardinalityCollector`, and `PackedKeyRangeCollector`. Idempotent — calling multiple times is safe.

#### `PrintProfileSummary()`

```csharp
public void PrintProfileSummary()
```

Prints collected profile summary to `Console`. Useful for development debugging.

### Diagnostics Methods

#### `HasPendingCommits()`

```csharp
public bool HasPendingCommits()
```

Returns `true` when committed transactions are still queued for background synchronization.

#### `GetMemoryReport()`

```csharp
public MemoryReport GetMemoryReport()
```

Collects a point-in-time memory usage report across persistent tables, frame-local runtime state, and derived materialized state. If the context owns a frame runtime, call this method on its owning frame thread: live ephemeral storage is not a cross-thread snapshot. Persistent-only contexts retain the existing reporting contract.

**`MemoryReport` fields:**

| Field | Type | Description |
|-------|------|-------------|
| `TotalBytes` | `long` | Total estimated memory across persistent tables, frame-local runtime state, and derived materialized state |
| `TableBytes` | `long` | Total estimated memory across persistent tables and frame-local runtime state |
| `MaterializedBytes` | `long` | Total estimated memory across materialized views, indexes, and shared arrangements |
| `BudgetBytes` | `long` | Configured memory budget (0 if none) |
| `BudgetUsageRatio` | `double` | `TotalBytes / BudgetBytes`, or `0` when no budget is configured |
| `BudgetPressureLevel` | `MemoryPressureLevel` | Estimated pressure level for `TotalBytes` using the same Normal/Warning/Critical thresholds as `MemoryBudget` |
| `MaterializedMemoryPressure` | `MaterializedMemoryPressureReport` | Materialized-state pressure split, enforcement mode, and stable pressure/enforcement reason codes |
| `Sets` | `List<DbSetMemoryReport>` | Per-persistent-table breakdown: `Name`, `EntityCount`, `PrimaryIndexBytes` |
| `EphemeralSets` | `List<EphemeralSetMemoryReport>` | Per-frame-local-table storage and deferred-command memory |
| `EphemeralDomains` | `List<EphemeralDomainMemoryReport>` | Per-domain frame-local identity storage |
| `EphemeralRuntimeBytes` | `long` | Shared frame command-playback bookkeeping not owned by one table |
| `MaterializedViews` | `List<MaterializedViewMemoryReport>` | Per materialized relation: `Name`, `Origin`, `Visibility`, `OwnerQueryName`, `OwnerQueryNames`, `VisibleRowCount`, `RelationBytes`, `IndexBytes`, `TotalBytes` |
| `MaterializedArrangements` | `List<MaterializedArrangementMemoryReport>` | Per shared arrangement: `Name`, `Kind`, typed key fields `SourceId` and `KeyMemberId`, diagnostic fields `SourceName` and `KeyMemberName`, owner view/query names, `GroupCount`, `RowCount`, `PendingDeltaCount`, `TotalBytes` |

#### `GetHealthReport()`

```csharp
public HealthReport GetHealthReport()
```

Collects a point-in-time health report including worker state, transaction status, per-DbSet stats, and materialized in-memory state stats. If the context owns a frame runtime, call this method on its owning frame thread. Cross-thread operational monitoring must consume an application-published immutable report rather than reading live ephemeral storage.

**`HealthReport` fields:**

| Field | Type | Description |
|-------|------|-------------|
| `WorkerState` | `WorkerHealthState` | `Healthy`, `Degraded`, or `Stopped` |
| `IsTransactionActive` | `bool` | Whether a transaction is in progress |
| `TotalEntityCount` | `long` | Sum of persistent and frame-local row counts |
| `EstimatedMemoryBytes` | `long` | Total estimated non-materialized memory across persistent tables and frame-local runtime state |
| `EphemeralRuntimeBytes` | `long` | Shared frame command-playback bookkeeping not owned by one ephemeral table |
| `EstimatedMaterializedMemoryBytes` | `long` | Total estimated materialized view and shared arrangement memory |
| `MaterializedBudgetPressureLevel` | `MemoryPressureLevel` | Estimated pressure level for materialized state alone |
| `MaterializedBackpressureRecommended` | `bool` | Whether materialized-state pressure alone recommends backpressure |
| `MaterializedMemoryPressureEnforcementMode` | `MaterializedMemoryPressureEnforcementMode` | `Enforced` when memory budget plus materialized compaction are active, `ObservedOnly` when budget exists without compaction, `Unconfigured` without a budget |
| `Sets` | `List<DbSetHealthInfo>` | Per-persistent-table: `Name`, `EntityCount`, `EstimatedBytes` |
| `EphemeralSets` | `List<EphemeralSetMemoryReport>` | Per-frame-local-table storage and deferred-command memory |
| `EphemeralDomains` | `List<EphemeralDomainMemoryReport>` | Per-domain frame-local identity storage |
| `MaterializedViews` | `List<MaterializedViewHealthInfo>` | Per materialized relation: `Name`, `Origin`, `Visibility`, `OwnerQueryName`, `OwnerQueryNames`, row/weight/index/subscriber counts, `Version`, `EstimatedBytes`, `Diagnostics` including delta counts and maintenance timing |
| `MaterializedArrangements` | `List<MaterializedArrangementHealthInfo>` | Per shared arrangement: `Name`, `Kind`, typed key fields `SourceName` and `KeyMemberName`, owner view/query names, `GroupCount`, `RowCount`, `PendingDeltaCount`, `EstimatedBytes` |
| `ReactiveQueries` | `ReactiveQueryRegistryHealthInfo` | Active reactive materialized facades: query counts, priority split, materialized access kind, pending delta counts, subscriber counts, and last replay result/count timing per query and delta buffer |

`EstimatedMemoryBytes` includes persistent tables plus frame-local set, identity-domain, and playback state. It does not include materialized views; derived state is reported separately through `EstimatedMaterializedMemoryBytes`.
With a configured memory budget, materialized state contributes to total
pressure. When materialized compaction is enabled, critical pressure forces a
materialized compaction attempt at the synchronized commit barrier; this is the
runtime enforcement path behind the health and memory-report enforcement mode.

#### `GetTableByTypeId(ushort typeId)`

```csharp
public DbSetBase? GetTableByTypeId(ushort typeId)
```

Looks up a `DbSetBase` by its compile-time type id. Returns `null` if not found.

### Events

| Event | Signature | Description |
|-------|-----------|-------------|
| `SynchronizationException` | `event Action<Exception>?` | Fired when the background worker encounters an exception during secondary index synchronization. Also logged at `Critical` level. |
| `WorkerHealthChanged` | `event EventHandler<WorkerHealthChangedEventArgs>?` | Fired when the worker transitions between health states. `WorkerHealthChangedEventArgs` contains `State` and optional `Exception`. |

### Lifecycle Callbacks

Override these `virtual` methods in your `DbContext` subclass to hook into initialization:

| Method | When Called | Typical Use |
|--------|------------|-------------|
| `OnBeforeBuild()` | Before the generated `Build()` runs | Register schema migrations via `MigrationRegistry` |
| `OnAfterBuild()` | After `Build()` completes | Add custom secondary indices or post-build configuration |
| `OnInitialize()` | End of `InitializeAsync()` after full recovery | Application-level initialization that depends on restored data |

### Lifecycle

1. **`Build()` / `BuildAsync()`** — creates the context, calls `InitializeAsync()`:
   - Invokes `OnBeforeBuild()` → generated `Build()` → `OnAfterBuild()`.
   - Starts the serialized background scheduler: the context's dedicated worker thread
     (`WorkerExecutionMode.DedicatedThread`) and the index-sync helper threads, or no thread in
     `WorkerExecutionMode.Inline` mode, where each commit runs its cycle on the committing thread.
   - Loads settings for `[Settings]`-marked DbSets.
   - Recovers state from the latest snapshot + journal replay.
   - Initializes journal.
   - Takes post-migration snapshot if needed.
   - Pre-warms identity allocators for persistent tables.
   - Invokes `OnInitialize()`.
   - Publishes `IsInitialized = true` only after that hook returns. Concurrent initialization,
     retry after a failed attempt, and initialization after disposal fail closed.
2. **Use** — `BeginTransaction()` / mutations / `Commit()` cycle.
3. **`Dispose()`** — waits up to 2 seconds for pending commits, then advances through explicit teardown stages. A failure before destructive frame teardown leaves the live lifecycle available for correction and retry; a later failure resumes from the last completed stage.

---

## DbContextBuilder

`DbContextBuilder<TContext>` provides a fluent API for constructing and initializing a `DbContext`-derived instance. Each builder instance may be used **exactly once** — calling `Build()` or `BuildAsync()` a second time throws `InvalidOperationException`.

### Basic Usage

```csharp
var context = DbContextBuilder<GameDbContext>.Create()
    .WithDataDirectory("./data")
    .WithSerializer(new MessagePackBinarySerializer())
    .WithSnapshot(snap => snap
        .AutomaticSnapshotInterval(TimeSpan.FromMinutes(5))
        .MaxSnapshotsToKeep(10)
        .EnableIncrementalSnapshots()
        .WithJournaling(j => j
            .FlushInterval(TimeSpan.FromMilliseconds(100))
            .MaxJournalFileSize(2 * 1024 * 1024)
            .ChannelCapacity(1024)))
    .WithEncryption(enc => enc
        .Password("my-secret")
        .KeySizeInBits(256)
        .Salt("unique-per-db-salt"))
    .WithMigration(m => m
        .SnapshotAfterMigration(true)
        .VerboseLogging(false))
    .WithLoggerFactory(loggerFactory)
    .WithBatteryStatusProvider(batteryProvider)
    .WithMemoryBudgetMB(256)
    .Build();
```

> **AOT/IL2CPP Note**: `DbContextBuilder<T>.Create()` is the standard builder path on IL2CPP and desktop runtimes. Keep the context's public `GameDbContext(DbConfiguration)` constructor so the builder can bind to it without splitting the API surface.
> ```csharp
> DbContextBuilder<GameDbContext>.Create()
> ```

### Top-Level Builder Methods

| Method | Description |
|--------|-------------|
| `WithDataDirectory(string)` | Root directory for all persistence files. Default: `{AppDomain.BaseDirectory}/db_data`. Throws if empty/whitespace. |
| `WithSerializer(IBinarySerializer)` | Binary serializer for snapshots and journals. Default: `MessagePackBinarySerializer`. |
| `WithSettingsLoaderFactory(SettingsLoaderFactory)` | Custom loader factory for `[Settings]`-marked DbSets. |
| `WithSnapshot(Action<SnapshotOptionsBuilder>)` | Configure snapshot persistence (intervals, journaling, incremental snapshots). |
| `WithDefaultSnapshot()` | Enable snapshot persistence with all default settings. |
| `WithNoPersistence()` | Disable all file-based persistence (snapshots, journals, incremental snapshots). |
| `WithDurabilityPolicy(DurabilityPolicy)` | Set the runtime durability profile for journal-backed commits. Default: `FastMobile`. |
| `WithEncryption(Action<EncryptionOptionsBuilder>)` | Configure AES-GCM encryption for snapshot and journal files. |
| `WithRemoteSnapshot(Action<RemoteSnapshotOptionsBuilder>)` | Configure remote snapshot upload/download (cloud save). |
| `WithMigration(Action<MigrationOptionsBuilder>)` | Configure schema migration options. |
| `WithLoggerFactory(ILoggerFactory)` | Structured logging via `Microsoft.Extensions.Logging`. Default: `NullLoggerFactory`. |
| `WithNullLogger()` | Explicitly disables logging (default behavior). |
| `WithBatteryStatusProvider(IBatteryStatusProvider)` | Defer non-critical I/O on low-battery devices (mobile/handheld). |
| `WithMemoryBudget(long bytes)` | Set memory budget in bytes. Enables pressure tracking. |
| `WithMemoryBudgetMB(int megabytes)` | Set memory budget in megabytes. Throws if ≤ 0. |
| `WithRuntimeMode(ConjureDBRuntimeMode)` | Override the runtime mode (`Client` or `Server`) for this context; otherwise the mode is resolved from AppContext/build defaults. |
| `WithQueryInterceptor(IQueryInterceptor)` | Configure a fixed query interceptor instance for contexts created by this builder. |
| `WithQueryInterceptorFactory(Func<DbContext, IQueryInterceptor?>)` | Configure a per-context query interceptor factory before the operation registry is sealed. |
| `WithFrameSchedulerOptions(FrameSchedulerOptions)` | Configure the pure-.NET fixed step and maximum fixed ticks per `Pump`. External hosts such as Unity supply their own active fixed step. |
| `Build()` | Synchronous build + `InitializeAsync().GetAwaiter().GetResult()`. Blocks the calling thread. |
| `BuildAsync()` | Async build (one-time use; throws `InvalidOperationException` if called twice). |

### Snapshot Options

Configured via `WithSnapshot(snap => snap.Method(...))`.

| Method | Type | Default | Description |
|--------|------|---------|-------------|
| `AutomaticSnapshotInterval(TimeSpan)` | `TimeSpan` | 5 min | Interval between automatic periodic snapshots. `TimeSpan.Zero` to disable. |
| `MaxSnapshotsToKeep(int)` | `int` | 10 | Number of snapshot files to retain on disk. Older snapshots are deleted. |
| `SerializationBufferSize(int)` | `int` | 64 KB | Pre-allocated buffer for entity serialization during writes. |
| `EnableIncrementalSnapshots(bool)` | `bool` | `false` | When enabled, only modified entities are written (delta snapshots). |
| `MaxDeltaChainLength(int)` | `int` | 10 | Maximum delta snapshots before a forced full snapshot. Bounds recovery time. |
| `DeltaToFullThreshold(double)` | `double` | 0.5 | Dirty-entity ratio above which a full snapshot replaces an incremental one. |
| `WithJournaling()` | — | disabled | Enable write-ahead journal with defaults. |
| `WithJournaling(Action<JournalOptionsBuilder>)` | — | — | Enable and configure journal. |

### Journal (WAL) Options

Configured via `WithJournaling(j => j.Method(...))` inside snapshot options.

| Method | Type | Default | Description |
|--------|------|---------|-------------|
| `FlushInterval(TimeSpan)` | `TimeSpan` | 100 ms | Base flush interval. Adaptive range: `MinFlushIntervalMs`–`MaxFlushIntervalMs`. |
| `MaxJournalFileSize(int)` | `int` | 2 MB | File size threshold triggering journal rotation. |
| `ChannelCapacity(int)` | `int` | 1024 | Bounded channel capacity before backpressure is applied. |
| `MaxEntrySize(int)` | `int` | 128 KB | Maximum allowed size per journal entry. Entries exceeding this cause a write failure. |
| `BufferSize(int)` | `int` | 64 KB | Internal ring buffer for batching writes. |
| `SerializationBufferSize(int)` | `int` | varies | Per-entry MessagePack serialization buffer. |
| `SerializationBuffersCount(int)` | `int` | varies | Number of pooled serialization buffers. More buffers reduce contention. |
| `FileStreamBufferSize(int)` | `int` | varies | `FileStream` buffer size for journal writes. |
| `RecordsPerWrite(int)` | `int` | 16 | Records batched per physical write I/O. Higher values reduce syscall overhead. |
| `MaxStateChangesBeforeSnapshot(int)` | `int` | 100 | State-change count triggering an automatic snapshot. Prevents unbounded journal growth. |
| `QueueThresholdForSnapshot(int)` | `int` | varies | Queue depth threshold triggering a snapshot. |
| `DelayBeforeSnapshotMs(int)` | `int` | varies | Delay after snapshot trigger to batch additional writes. |
| `HighWriteOpsPerSecond(int)` | `int` | 100 | Ops/sec threshold for switching to high-throughput flush mode. |
| `MinFlushIntervalMs(int)` | `int` | 100 | Floor for adaptive flush interval (ms). |
| `MaxFlushIntervalMs(int)` | `int` | 5000 | Ceiling for adaptive flush interval (ms). |

### Encryption Options

Configured via `WithEncryption(enc => enc.Method(...))`. Uses AES-GCM with PBKDF2 key derivation.

| Method | Type | Default | Description |
|--------|------|---------|-------------|
| `Password(string)` | `string` | — | Encryption password (required). Used for AES key derivation via PBKDF2. |
| `KeySizeInBits(int)` | `int` | 256 | AES key size. Supported: 128, 192, 256. |
| `Salt(string)` | `string` | — | Cryptographic salt for key derivation/nonce generation. Must be ≥16 bytes UTF-8. Each database instance should use a unique salt. |

### Remote Snapshot Options

Configured via `WithRemoteSnapshot(r => r.Method(...))`. Enables cloud save scenarios.

| Method | Type | Default | Description |
|--------|------|---------|-------------|
| `OwnedByContext(IRemoteSnapshotHandler)` | `IRemoteSnapshotHandler` | — | Handler disposed by the created context after snapshot work drains. |
| `BorrowedByCaller(IRemoteSnapshotHandler)` | `IRemoteSnapshotHandler` | — | Handler retained and disposed by its caller. |
| `RequestTimeout(TimeSpan)` | `TimeSpan` | — | HTTP request timeout for remote operations. |
| `MaxRetryAttempts(int)` | `int` | 3 | Retry count for failed remote operations. |
| `ResolutionStrategy(StateResolutionStrategy)` | enum | `RemoteFirst` | Conflict resolution: `LocalFirst`, `RemoteFirst`, `ForceLocal`, `ForceRemote`. |

### Migration Options

Configured via `WithMigration(m => m.Method(...))`.

| Method | Type | Default | Description |
|--------|------|---------|-------------|
| `SnapshotAfterMigration(bool)` | `bool` | `true` | Automatically take a full snapshot after migrations so subsequent startups skip re-migration. |
| `VerboseLogging(bool)` | `bool` | `false` | Enable detailed logging of migration steps. |

---

## DbSet&lt;T&gt;

`DbSet<T>` is the typed collection interface for a single entity table. Each set provides immediate-consistency primary key access and optional deferred-commit secondary indexes.

### Entity Requirements

Entities must have an `int Id` property (by convention, the primary key). Entities are typically classes or structs decorated with `table`:

```conjure
table Player(plural: Players, persistence: local, capacity: 1024, type_id: 1) {
  id       : int @id
  name     : string
  level    : int
  guild_id : int
  email    : string
  score    : int
}
```

### Properties

| Property | Type | Description |
|----------|------|-------------|
| `Count` | `int` | Number of entities currently stored in the primary index. |
| `MaxId` | `int` | Highest object id ever observed (monotonic, never decreases). |
| `SyncIndex` | `SynchronizedIndex<T>` | The synchronized (secondary) index container. |
| `this[int objectId]` | `T` | Direct primary-index lookup by id (indexer). |

### Read Operations

Point reads and value-owned/snapshot-owned primary results are safe from any
thread after `Commit()`; secondary-index results are safe after worker sync.
Live/by-ref/no-sync borrows—including `All()`, `AsMemory`, `DenseIndexById`, and
compiled/secondary-index by-ref paths—require temporal separation from writer or
index mutation and must be consumed before the next mutation.

#### `FindById(int id)`

```csharp
public T FindById(int id)
```

Retrieves entity by primary key. **O(1)**. Throws if the entity does not exist.

#### `TryFindById(int id, out T item)`

```csharp
public bool TryFindById(int id, out T item)
```

Non-throwing lookup. Returns `false` if the entity does not exist. **O(1)**.

#### `Contains(int id)`

```csharp
public bool Contains(int id)
```

Returns `true` if an entity with the given id exists. **O(1)**.

#### `All()`

```csharp
public ReadOnlyMemory<T> All()
```

Borrows a zero-copy `ReadOnlyMemory<T>` view of all entities visible to the current
transaction. **O(1)**, no allocation — this is the ABI the compiled query hot path
scans through.

It is a **borrow**, not a snapshot. Like `PrimaryIndex<T>.GetRefUnchecked` and
`DbSet<T>.TryFindByIdRef`, it aliases primary storage and is invalidated by the next
`Add`/`Remove`/`Update`/`Commit`/`Rollback` on the owning table. Consume it
synchronously, do not retain it across a mutation boundary, do not hand it to a
deferred consumer, and do not write through references recovered from it with
`MemoryMarshal`/`Unsafe` — recovering a writable reference from any of the runtime's
`ref readonly`/`ReadOnlySpan` surfaces and writing through it corrupts primary storage.

Call `All().ToArray()` when you need an owned snapshot that stays stable across a
later mutation, or `PrimaryIndex.All` for a deferred owning enumeration.

#### Enumeration

```csharp
foreach (var player in context.Players.PrimaryIndex)
{
    // Stable transaction-visible enumeration in dense array order.
}
```

The enumerator selects its source on the first movement. An eligible synchronized
committed shadow is retained and fails closed if a later commit changes its
generation. Every other source, including uncommitted, shadowless, or stale-shadow
state, is copied into an owned snapshot that remains stable across later changes.
The enumerator does not expose writable primary-storage slots. Apply changes
through the owning `DbSet<T>` transaction API. Use `All().Span` only for an
explicitly scoped zero-copy read that does not cross a mutation.

### Mutation Operations

All mutations require an active transaction (`BeginTransaction()` must have been called).

#### `Add(in T item)` — Single Insert

```csharp
public void Add(in T item)
```

Inserts a single entity. The entity's `Id` is used as the primary key.

#### `Add(int id, T item)` — Insert with Explicit ID

```csharp
public void Add(int id, T item)
```

Inserts an entity with an explicit primary key, overriding the entity's `Id` field.

#### `Add(T[] items)` — Batch Insert

```csharp
public void Add(T[] items)
```

Inserts multiple entities in a single operation. More efficient than individual `Add` calls.

#### `AddUnchecked(in T item)` / `AddUnchecked(T[] items)`

```csharp
public void AddUnchecked(in T item)
public void AddUnchecked(T[] items)
```

Insert without secondary index pre-validation. Use only when you are certain no uniqueness constraints will be violated. Commit finalization still fails closed if synchronized indices cannot represent the committed state.

#### `Update(T item)` — Single Update

```csharp
public void Update(T item)
```

Replaces an existing entity identified by `item.Id`.

#### `Update(T[] items)` / `Update(List<T> items)` — Batch Update

```csharp
public void Update(T[] items)
public void Update(List<T> items)
```

Batch update. The `List<T>` overload avoids a `ToArray()` allocation.

#### `Remove(int id)` — Remove by ID

```csharp
public bool Remove(int id)
```

Removes the entity with the given primary key. Returns `true` if the entity existed.

#### `Remove(T item)` — Remove by Entity

```csharp
public bool Remove(T item)
```

Removes the specified entity (by its `Id`).

#### `Remove(int[] ids)` / `Remove(List<int> ids)` — Batch Remove

```csharp
public void Remove(int[] ids)
public void Remove(List<int> ids)
```

Removes multiple entities by their primary keys.

#### `Upsert(int id, T item)` — Insert or Update

```csharp
public void Upsert(int id, T item)
```

Inserts the entity if `id` does not exist; updates it otherwise.

### Capacity Management

#### `EnsureCapacity(int maxId, int valueCapacity)`

```csharp
public void EnsureCapacity(int maxId, int valueCapacity)
```

Reserves the set's primary, synchronized and secondary-index storage and every generated
materialized-view structure derived from it, so growth up to those sizes never resizes or rehashes
during play. Storage starts small whatever the declared `capacity:`; call this at load time for a
table that will grow. `DbContext.ReserveDerivedState()` reserves all generated view state to the
declared capacities.

```csharp
context.Players.EnsureCapacity(maxId: 10_000, valueCapacity: 10_000);
```

### Change Notifications

#### `Subscribe(ChangeHandler<StateChange<T>>)`

```csharp
public IDisposable Subscribe(ChangeHandler<StateChange<T>> handler)
```

Subscribes to real-time change events. The handler is called synchronously during `Commit()` for each Add/Update/Remove operation. Returns an `IDisposable` to unsubscribe.

```csharp
IDisposable subscription = context.Players.Subscribe(
    (in StateChange<Player> change) =>
    {
        switch (change.Type)
        {
            case ChangeType.Add:
                Console.WriteLine($"Added player {change.Id}");
                break;
            case ChangeType.Update:
                Console.WriteLine($"Updated player {change.Id}");
                break;
            case ChangeType.Remove:
                Console.WriteLine($"Removed player {change.Id}");
                break;
        }
    });

// Later:
subscription.Dispose();
```

### StateChange&lt;T&gt;

Each buffered change is represented as a `StateChange<T>` struct:

| Field | Type | Description |
|-------|------|-------------|
| `Type` | `ChangeType` | `Add = 0`, `Update = 1`, `Remove = 2` |
| `IsSingleItem` | `bool` | `true` for single-item changes |
| `Id` | `int` | Entity ID (single-item operations) |
| `NewItem` | `T?` | New value (for Add/Update) |
| `OldItem` | `T?` | Previous value (for Update/Remove) |
| `NewItems` | `ReadOnlyMemory<T>` | New items (batch operations) |
| `OldItems` | `ReadOnlyMemory<T>` | Old items (batch operations) |
| `Version` | `ulong` | Transaction version |

### Index Creation

Secondary indexes are typically declared via `schema index` attributes. The `Create...Index...` helpers are protected `DbSet<T>` hooks used by generated `Build()` code or custom derived `DbSet<T>` implementations, not public app-code APIs. All secondary indexes use deferred-commit consistency — updated asynchronously by the background worker after `Commit()`.

```conjure
table Player(plural: Players, persistence: local) {
  id       : int @id
  guild_id : int
  level    : int
  email    : string

  @@index(fields: [guild_id], name: "Player_ByGuild", kind: lookup)
  @@index(fields: [level], name: "Player_ByLevel", kind: sorted_set)
  @@index(fields: [email], name: "Player_ByEmail", kind: unique)
}
```

For comprehensive index documentation, including range/grouped/aggregation/spatial index shapes, see [Indexing](/docs/schema/indexing).

---

## Transaction Model

ConjureDB uses versioned ACID transactions with a single-writer model.

### Transaction Flow

```text
BeginTransaction()       Commit()                    Background Worker
       │                    │                           │
       ▼                    ▼                           ▼
  Open write scope     Apply buffered              Sync secondary
       │              changes to primary            indices async
       ▼              index atomically                  │
  Buffer mutations          │                           ▼
                       Fire change                 Signal completion
                       subscribers
```

1. **`BeginTransaction()`** — opens a write scope for buffering mutations.
2. **Mutations** — `Add()` / `Update()` / `Remove()` buffer changes for each table.
3. **`Commit()`** — applies all buffered changes to the primary index atomically, fires change event subscribers, and signals the background worker.
4. **`CommitAsync(forceFlush, cancellationToken)`** — async variant; if `forceFlush=true`, waits for the journal to be flushed to disk.
5. **`Rollback()`** — discards all buffered mutations and ends the transaction.

### Consistency Model

| Index Type | Consistency | Mechanism |
|------------|-------------|-----------|
| `PrimaryIndex` | **Immediate** | Updated synchronously inside `Commit()` |
| `SynchronizedIndex` (secondary) | **Deferred-commit** | Buffered; synced by `DbWorker` after commit |

When application code accesses a secondary index, synchronization is handled automatically. Secondary index reads always reflect committed data.

### Error Handling

Mutation failures can produce:

- **`InvalidOperationException`** — calling mutation methods outside a transaction, nested `BeginTransaction()`, `Commit()` / `Rollback()` without an active transaction.
- **`MutationPreconditionException`** — mutation assertion failed (e.g., compiled mutation `assert` clause). Indicates the transaction was rolled back. Contains a `Condition` property describing the failed assertion.
- **`SecondaryIndexValidationException`** — a secondary index constraint (e.g., uniqueness) was violated during background sync. Signals that state must be rolled back to the last valid snapshot.

---

## Background Worker

A serialized background execution lane synchronizes secondary indexes after each
transaction commit. By default it is one ConjureDB-owned background thread per context, started
by `InitializeAsync` and joined by `Dispose`; the commit path takes no ThreadPool work item, so a
game that keeps the ThreadPool busy does not delay commits, and a cycle allocates nothing. Hosts
without threads (Unity WebGL) select `WorkerExecutionMode.Inline`, which runs the cycle on the
committing thread. See [Concurrency Control — Worker thread](/docs/engine/concurrency#worker-thread).

### Worker Health States

| State | Description |
|-------|-------------|
| `Healthy` | Worker operating normally. All indices are up to date. |
| `Degraded` | Worker encountered a retryable error but is still running. Failed transactions are rolled back; commits remain accepted, but stay on the serialized worker lane until a successful retry returns it to `Healthy`. |
| `Stopped` | Worker stopped due to a critical failure. Application-level recovery may be needed. |

Monitor via `context.WorkerHealth` property and `context.WorkerHealthChanged` event.

The frame runtime has its **own** worker lane that is unrelated to the persistence worker above:
`FrameWorkerPool` (see [Ephemeral Tables § *Parallel frame systems*](/docs/advanced/ephemeral-tables#parallel-frame-systems--host-options))
keeps its workers spinning for a bounded wall-clock budget and parks them when it expires. That
residency boundary is measurable on the frame clock: a parked worker observes the next release
9–15 µs late (worst 36.5 µs) against 0.2 µs for a worker still inside its budget, and a 2 ms
idle gap — an ordinary game frame — moves the measured frame p50 from 14.7 µs to 55.0 µs. The
figures and their method live with the fork-cost owner in the internal frame-execution design notes.

---

## Reactive Queries

`ReactiveQuery<TResult>` exposes auto-maintaining query results. For the IVM model (applying only the per-commit delta, O(changes) instead of O(N) re-execution), see [Reactive Queries](/docs/advanced/reactive-queries#the-ivm-solution).
Reactive queries are declared in the schema DSL with `reactive query` and
exposed through generated context/query methods. The generated method returns
the public `ReactiveQuery<T>` facade; execution reads a compiler-owned Z-set
materialized relation or index slice.

### Synchronization Model

| Surface | Description |
|---------|-------------|
| Materialized relation/index | Compiler-generated maintained state owned by the context. |
| Slice buffer | Tracks affected relation/index slices after commits and replays current materialized rows during `SyncReactiveQueries()`. |
| `ReactiveQuery<T>` | Public facade exposing `Current`, `Subscribe`, and `SubscribeChanged` without exposing mutable materialized state. |

### Priority Tiers

Each reactive query carries a `Critical` / `Normal` / `Background` priority that the context's `ReactiveQueryRegistry` uses to schedule delta application. For the tier semantics and frame-budget meanings see [Reactive Queries](/docs/advanced/reactive-queries#priority-levels).

### Lifecycle

Within `DbContext`, the registry drives reactive maintenance as follows:

1. Delta application runs on the serialized background execution lane during
   `SyncReactiveQueries`.
2. Notifications fire in the lane's synchronization-completion phase.
3. The `_dirty` volatile flag signals changed state after materialized relation/index buffers drain.

---

## Memory Management

### Memory Budget

Configure a memory budget to track allocation pressure:

```csharp
var context = DbContextBuilder<GameDbContext>.Create()
    .WithMemoryBudgetMB(256)
    .Build();
```

**`MemoryBudget` members:**

| Member | Type | Description |
|--------|------|-------------|
| `BudgetBytes` | `long` | Configured budget in bytes |
| `TotalAllocatedBytes` | `long` | Current total allocated bytes |
| `UsageRatio` | `double` | `TotalAllocatedBytes / BudgetBytes` |
| `CurrentLevel` | `MemoryPressureLevel` | `Normal`, `Warning` (≥90%), or `Critical` (≥100%) |
| `TryAllocate(long, string)` | `bool` | Atomic allocation with budget enforcement |
| `Release(long)` | `void` | Atomic deallocation |
| `MemoryPressureChanged` | `event` | Fires at Warning and Critical thresholds |

### Capacity Pre-allocation

The schema `table` `capacity:` is a planning value: storage and derived view state start small and
grow. Reserve at load time with `EnsureCapacity()` (per table, reaches derived view state) or
`ReserveDerivedState()` (all view state, to the declared capacities):

```conjure
// Via schema (preferred — evaluated by the manual compiler)
table Player(plural: Players, persistence: local, capacity: 10000) {
  id : int @id
}
```

```csharp
// Via runtime call
context.Players.EnsureCapacity(maxId: 10_000, valueCapacity: 10_000);
```

---

## Materialized Views

Schema-first `materialized view` declarations define compiler-owned derived
relations. They are not persisted tables and do not expose a public mutable
view lifecycle API. Generated context startup builds the relation from current
base-table state, generated Z-set maintainers apply later base-table deltas,
and declared `@@index` entries provide typed read paths for ordinary and
reactive queries.

```conjure
materialized view GuildStats(
    capacity: 4096,
    refresh: incremental,
    rewrite: auto
) {
    guild_id: int
    player_count: long

    @@identity(fields: [guild_id])
    @@index(fields: [guild_id], name: "GuildStats_ByGuild", kind: unique)
} = from Player p
    | group p.guild_id (aggregate player_count = count())
    | select { guild_id = guild_id, player_count = player_count }
```

Ordinary `query` methods may read a named materialized view directly, or the
optimizer may select a named `rewrite: auto` view / hidden `ReactiveAutoView`
candidate when typed equivalence and cost checks prove the substitution.

---

## Attributes Reference

### `table` — Entity Registration

Declares a ConjureDB entity table and controls registration, persistence, and capacity. Tables are declared in `.conjure` schema files.

```conjure
table Player(plural: Players, persistence: local, capacity: 1024, type_id: 1) {
  id : int @id
}
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `name` | identifier | — | Logical table name for snapshots and DSL queries. Required. |
| `plural` | identifier | — | Set/alias name; both the table name and its plural resolve in `from`/`join`. |
| `persistence` | keyword | `local` | `none` (in-memory only), `local` (snapshot + journal), `remote`. |
| `capacity` | `int` | 16 | Initial capacity hint. Should be a power of 2. |

**`PersistenceType` values:**

| Value | Description |
|-------|-------------|
| `None` | In-memory only. Data is lost on process exit. |
| `Local` | Persisted via snapshots and journals to the data directory. |
| `Remote` | Persisted via `IRemoteSnapshotHandler` (cloud save). |

### `@@index` — Secondary Index Declaration

Declares secondary indexes inside a `.conjure` `table` block. Multiple `@@index` entries may be declared.

```conjure
table Player(plural: Players, persistence: local) {
  id       : int @id
  guild_id : int
  email    : string
  level    : int

  @@index(fields: [guild_id], kind: lookup)
  @@index(fields: [email], kind: unique)
  @@index(fields: [level], kind: sorted_set)
}
```

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `name` | `string?` | auto | Unique index identifier |
| `kind` | keyword | `lookup` | Index structure type (see table below) |
| `fields` | identifier list | — | Key columns |
| `filter` | `string?` | — | DSL filter expression for partial indexes |
| `included` | identifier list | — | Non-key columns for index-only scans |
| `value` | identifier | — | Column for aggregation indexes |
| `range` | identifier | — | Secondary range key for range_lookup/grouped_sorted |
| `encoding` | enum | `Default` | Key encoding strategy (e.g., `PackedInt32LowCardStringToUInt64`) |

**`kind` values:**

| Value | Structure | Complexity | Use Case |
|-------|-----------|-----------|----------|
| `lookup` | Hash map | O(1) equality | Group-by, equality filters |
| `unique` | Hash map | O(1) equality | Uniqueness constraints |
| `sorted_list` | Sorted list | O(log n) range | Range queries with duplicates |
| `sorted_set` | Sorted set | O(log n) range | Range queries, ordered enumeration |
| `aggregation` | Hash map | O(1) grouped | Pre-computed COUNT aggregates |
| `universal_aggregation` | Hash map | O(1) grouped | Pre-computed SUM/AVG/MIN/MAX/COUNT |
| `range_lookup` | Composite | O(1) existence | Group + range existence queries |
| `grouped_sorted` | Composite | O(log n) | Group + sorted range queries |
| `spatial_grid` | Grid | O(1) cell | Spatial proximity queries |

### `query` — Query Declaration

Queries are declared in `.conjure` schema with the `query` keyword and compiled ahead of time to generated C#; see [Compiled Queries](/docs/query-language/compiled-queries). Parameters are referenced in the pipeline with a leading `@`. There is no C# query attribute; the generator emits a method on the entity's set, which you call from C#.

```conjure
query GetTopPlayers(minLevel: int) -> Player[] {
    from Players
    | filter level > @minLevel
    | sort -level
    | take 10
}
```

The generated method is exposed on the entity set and called from C#:

```csharp
Player[] top = context.Players.GetTopPlayers(minLevel);
```

Executable query bodies use braces in source format 2. Optional per-query planning hints are written on the header line, e.g. `query GetTopPlayers(minLevel: int) -> Player[] @planning(no_optimize: true) { ... }`.

Advanced bounded-domain and shape-specialization hints on `query` are documented in [CompiledQueries](/docs/query-language/compiled-queries).

### `mutation` — Mutation Declaration

Mutations are declared in `.conjure` schema with the `mutation` keyword (update, delete, insert, upsert) and are automatically transaction-wrapped. Parameters are referenced with a leading `@`. There is no C# mutation attribute; the generator emits a method (returning the affected-row `int`) on the entity's set.

```conjure
mutation LevelUp(id: int) -> int {
    update Player
    | filter id == @id
    | set { level = level + 1 }
}
```

Call the generated method from C#:

```csharp
int affected = context.Players.LevelUp(id);
```

> Mutations are always wrapped in a `TransactionScope` and return the affected-row count (`int`).

### `reactive query` — Reactive Query Declaration

Generates reactive queries with incremental view maintenance (IVM).

```conjure
reactive query GuildLeaderboard(guild_id: int) -> PlayerScore[] {
    from Player
    | filter guild_id == @guild_id
    | sort -score, id
    | take 50
    | select {
        name = name,
        score = score
    }
}
```

The generated C# surface returns `ReactiveQuery<PlayerScore>` and reads from a
named materialized view or a hidden compiler-owned `ReactiveAutoView`.

### `extern function` — UDF Registration

Exposes a plain `public static` C# method (no attribute) to DSL queries via an `extern function` declaration in `.conjure` schema that binds the DSL name to the fully-qualified method.

```csharp
// Plain C# method — no attribute.
public static float Distance(float x1, float y1, float x2, float y2)
    => MathF.Sqrt((x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1));
```

```conjure
extern function distance(x1: float, y1: float, x2: float, y2: float) -> float = MyGame.MathUtils.Distance
```

The DSL name (`distance`) is then callable in query pipelines; binding is by the fully-qualified method name on the right of `=`.

### `@relation` — Relationship Declaration

Declares FK relationships for query optimization (bounds inference, join planning). Does **not** generate navigation properties — purely an optimization hint. Annotate the foreign-key field with `@relation(references: Target.Field)` in the `.conjure` schema.

```conjure
table Order(plural: Orders, persistence: local) {
  Id       : int @id
  PlayerId : int @relation(references: Player.Id)
}
```

| Property | Type | Description |
|----------|------|-------------|
| `references` | identifier | Referenced entity field, written `Target.Field`. |

### `@relation(on_delete:)` — Parent Removal Policy

Declares what should happen to child rows when the referenced parent entity is removed.
Write it as an `on_delete:` argument on the child foreign-key field's `@relation` annotation in the `.conjure` schema.

```conjure
table OrderItem(plural: OrderItems, persistence: local) {
  Id      : int @id
  OrderId : int @relation(references: Order.Id, on_delete: cascade)
}
```

| Argument | Type | Default | Description |
|----------|------|---------|-------------|
| `on_delete` | keyword | `cascade` | `cascade` (remove children with the parent), `set_null` (null out a nullable FK), `restrict` (block parent removal while children exist), `no_action`, or `set_default`. |

> `on_delete: restrict` throws `CascadeRestrictException` when a parent delete is attempted while matching children still exist.

### `schema_version` — Schema Versioning

Version control for entity schemas. Used during snapshot recovery to detect and apply migrations. Declared as a `schema_version:` table option in the `.conjure` schema.

```conjure
table Player(persistence: local, schema_version: 2) {
    // fields...
}
```

| Property | Type | Description |
|----------|------|-------------|
| `schema_version` | `uint` | Schema version (must be > 0). |

### `[Settings]` — Configuration Entity

Marks entities loaded from external configuration (not persisted via snapshots).

```csharp
[Settings("GameConfig")]
public class GameConfig { ... }
```

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `Name` | `string` | — | Settings identifier. Required. |
| `SerializerType` | `Type?` | `null` | Custom serializer type. |
| `LoaderType` | `Type?` | `null` | Custom loader type. |

### `type_id` — Stable Runtime Type ID

Assigns the schema-owned numeric type ID used by persistence, migration
descriptors, and fast runtime set lookup.

```conjure
table Player(plural: Players, persistence: local, type_id: 42) {
  id : int @id
}
```

| Property | Type | Description |
|----------|------|-------------|
| `type_id` | `ushort` | Type identifier (must be > 0). |

### `[PgoMode]` — Profile-Guided Optimization

Configures PGO mode for compiled queries.

```csharp
[PgoMode(PgoMode.Use, profilePath: "profile.json")]
public class GameDbContext : DbContext { ... }
```

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `Mode` | `PgoMode` | `None` | `None`, `Collect` (runtime instrumentation), `Use` (apply pre-collected stats). |
| `ProfilePath` | `string?` | `null` | Path to profile JSON when `Mode = Use`. |

### `@relation` — Reference Injection

A single-valued `@relation` foreign key lets the generator inject the referenced entity for navigation at code-gen time. Declare it on the foreign-key field in the `.conjure` schema.

```conjure
table Product(plural: Products, persistence: local) {
  Id         : int @id
  CategoryId : int @relation(references: Category.Id)
}
```

### `@@navigation` — Parent-Child Navigation

Marks parent→child navigation collections (optional; auto-discovered by default). Declared as a table-level `@@navigation` entry in the `.conjure` schema.

```conjure
table Player(plural: Players, persistence: local) {
  Id : int @id

  @@navigation(name: "Inventory", references: InventorySlot.PlayerId)
}
```

### `[FixedArray]` / `[FixedBlob]` / `[FixedLength]` — Fixed-Size Collections

Control fixed-size serialization for arrays, byte blobs, and collections respectively.

```csharp
[FixedArray(10)]
public int[] Scores { get; set; }

[FixedBlob(256)]
public byte[] Avatar { get; set; }

[FixedLength(5)]
public List<string> Tags { get; set; }
```

### `[DebugGeneration]` — Compiler Debug Traces

Enables detailed compiler debugging output during code generation.

```conjure
query HighLevelPlayers() -> Player[] {
    from Players | filter level > 10
}
```

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `TraceLevel` | `DebugTraceLevel` | `Normal` | `None`, `Summary`, `Normal`, `Verbose` |
| `OutputPath` | `string?` | `null` | Trace output file; `null` = console |
| `Stages` | `string?` | `null` | Comma-separated stages: Parsing, Binding, Validation, Optimization, Planning, Emission |
| `TracePoints` | `string?` | `null` | Fine-grained trace point control |

---

## Persistence

### Overview

ConjureDB's persistence layer provides crash recovery and durability through a combination of full/incremental snapshots and a write-ahead journal (WAL).

### Recovery Process

On startup, `InitializeAsync()` performs:

1. Load the latest valid snapshot (full or incremental chain).
2. Replay journal entries written after the snapshot.
3. Rebuild secondary indexes from the recovered primary index state.
4. If migrations were applied, optionally take a post-migration snapshot.

### Snapshot Files

Snapshots capture the complete database state. Stored in the configured data directory.

- **Full snapshots**: All entities from all persistent tables.
- **Incremental (delta) snapshots**: Only entities modified since the last snapshot. Chain up to `MaxDeltaChainLength` deltas before a forced full snapshot.

### Journal (WAL) Files

The journal records committed transactions between snapshots. Provides crash recovery with bounded data loss (configurable via `FlushInterval`).

- Entries are batched via a bounded channel with configurable capacity.
- Adaptive flush interval adjusts based on write throughput.
- Journal files rotate at `MaxJournalFileSize`.
- Auto-snapshot triggers when `MaxStateChangesBeforeSnapshot` is reached.

### Encryption

When enabled, all snapshot and journal files are encrypted using AES-GCM with PBKDF2-derived keys. Configured via `WithEncryption()` on the builder.

---

## Error Handling

### Exception Types

| Exception | When Thrown | Description |
|-----------|------------|-------------|
| `InvalidOperationException` | Transaction API misuse | Nested `BeginTransaction()`, `Commit()`/`Rollback()` without active transaction, double initialization, double `Build()`/`BuildAsync()`. |
| `MutationPreconditionException` | Compiled mutation assertion failure | The `assert` clause in a compiled mutation failed. Properties: `Condition` (string). Transaction is rolled back. |
| `SecondaryIndexValidationException` | Background sync | A secondary index constraint (e.g., uniqueness) was violated. State may need rollback to last valid snapshot. |
| `ArgumentNullException` | Builder / API null arguments | Null arguments to builder methods or `DbContext` constructor. |
| `ArgumentException` | Builder validation | Empty `DataDirectory`, invalid configuration values. |
| `ArgumentOutOfRangeException` | Budget/capacity | Non-positive memory budget, invalid attribute parameters. |

### Diagnostic Events

- `SynchronizationException` event on `DbContext` — fired on background sync errors.
- `WorkerHealthChanged` event on `DbContext` — fired on worker state transitions.
- `MemoryPressureChanged` event on `MemoryBudget` — fired at Warning (90%) and Critical (100%) thresholds.

---

## OpenTelemetry Metrics (.NET 6+)

On .NET 6+, ConjureDB emits structured metrics via `System.Diagnostics.Metrics`:

| Metric | Type | Description |
|--------|------|-------------|
| `TransactionCommits` | Counter | Total number of committed transactions |
| `TransactionRollbacks` | Counter | Total number of rolled-back transactions |
| `CommitDurationMs` | Histogram | Commit latency in milliseconds |
| `SnapshotsTaken` | Counter | Total snapshots taken |
| `SnapshotDurationMs` | Histogram | Snapshot write latency |
| `JournalEntriesWritten` | Counter | Total journal entries written |
| `IndexSyncDurationMs` | Histogram | Secondary index sync latency |

---

## Performance Characteristics

### Internal Data Structures

| Component | Description |
|-----------|-------------|
| `PrimaryIndex<T>` | Dense storage with O(1) lookups by ID. Swap-and-pop removal. |
| `SparseSet<T>` | O(1) membership test and iteration. No tombstones. |
| High-performance hash maps | Open-addressing with linear probing and bounded probe distance. |

### Operation Complexity

| Operation | Time | Allocations | Notes |
|-----------|------|-------------|-------|
| `FindById(id)` | O(1) | Zero | Direct dense storage read |
| `TryFindById(id, out)` | O(1) | Zero | |
| `Contains(id)` | O(1) | Zero | |
| `Count` | O(1) | Zero | Cached field |
| `MaxId` | O(1) | Zero | Monotonic cached field |
| `All()` | O(1) | Zero | Borrows `ReadOnlyMemory<T>` over live rows; `ToArray()` for an owned snapshot |
| `PrimaryIndex.DenseIndexById` | O(1) | Zero | Borrows the live id-to-dense map; `ToArray()` for an owned snapshot |
| `Add(item)` | O(1) amortized | Zero (if pre-allocated) | May trigger array resize |
| `Update(item)` | O(1) | Zero | Direct slot write |
| `Remove(id)` | O(1) | Zero | Swap-and-pop removal |
| `Upsert(id, item)` | O(1) amortized | Zero (if pre-allocated) | Contains check + Add or Update |
| Lookup index query | O(1) | Zero | Hash-based |
| Sorted index query | O(log n) | Allocation per result set | Tree-based |
| Aggregation index | O(1) | Zero | Pre-computed |
| `Commit()` | O(k) | Minimal | k = number of mutations in transaction |

### Zero-Allocation Patterns

ConjureDB enforces zero-allocation constraints in runtime and generated code:

- Primary index operations use direct array access — no boxing, no iterator objects.
- `All()`, `PrimaryIndex.AsMemory` and `PrimaryIndex.DenseIndexById` borrow live storage —
  zero-copy views, no allocation. They are caller-bound: consume synchronously, never
  retain across a mutation, and call `ToArray()` when an owned snapshot is required.
- `StateChange<T>` is a struct passed by `in` reference to subscribers — no heap allocation.
- `TransactionScope` is a stack-only struct — no GC pressure.
- Serialization buffers are pooled and reused across commits.

### Unity / IL2CPP Considerations

- Compatible with Unity 2021.3+ and .NET Standard 2.1.
- Use `DbContextBuilder<T>.Create()` with a public `TContext(DbConfiguration)` constructor:
  ```csharp
    DbContextBuilder<GameDbContext>.Create()
  ```
- No `dynamic`, no reflection in hot paths, no `System.Linq.Expressions` at runtime.
- `[MethodImpl(MethodImplOptions.AggressiveInlining)]` is applied to performance-critical methods.
- Struct-based designs with `ref` returns and `Span<T>` for value-type access.

---

## Key Performance Guidelines

1. **Batch mutations in transactions** — amortizes per-operation overhead across `Commit()`.
2. **Use primary-key lookups** — `FindById()` is O(1), zero allocation.
3. **Pre-allocate with capacity hints** — set `capacity` in `table` for large collections to avoid runtime resizing.
4. **Avoid LINQ in hot paths** — use direct index methods or compiled queries.
5. **Use `Count` property, not LINQ `.Count()`** — avoids enumeration overhead.
6. **Use `All()` for bulk reads** — borrows `ReadOnlyMemory<T>` over the dense array, no copy. Finish the read before the next mutation, or take `All().ToArray()` if the result must outlive it.
7. **Choose the right index type** — Lookup for equality, SortedSet for ranges, Aggregation for pre-computed metrics.
8. **Use `CommitAsync(forceFlush: true)` for durability-critical writes** — ensures journal flush before returning.
9. **Monitor with `GetHealthReport()` / `GetMemoryReport()`** — detect degraded worker states and memory pressure early.
10. **Use `reactive query` over polling** — reactive queries read maintained materialized relation/index state and apply supported Z-set deltas instead of polling or re-running source queries.

# Concurrency Control

How ConjureDB manages concurrent access to data — a reference for game
developers who need to understand what is safe, what is not, and why.

**See also:** [Transactions](/docs/engine/transactions) · [Ephemeral Tables](/docs/advanced/ephemeral-tables) ·
[Reactive Queries](/docs/advanced/reactive-queries) · [Persistence](/docs/engine/persistence) ·
[Database Engine](/docs/engine/database-engine)

> **Relationship with Transactions:**
> [Transactions](/docs/engine/transactions) covers the transaction lifecycle, commit variants,
> rollback semantics, durability guarantees, and API reference.
> This page focuses on the *concurrency model* — thread interactions, synchronization
> primitives, isolation semantics, index consistency, and safe usage patterns for
> multi-threaded game architectures.

---

## Overview

Persistent ConjureDB tables use a **single-writer / multi-reader** concurrency model:

- **One writer thread** — all mutations (`Add`, `Update`, `Remove`) happen inside
  transactions on a single designated thread (typically the game main thread).
- **Multiple reader threads** — point reads and value-owned/snapshot-owned results
  from committed, synchronized data are safe without blocking. Live/by-ref/no-sync borrows
  (`All`, `AsMemory`, `DenseIndexById`, and compiled/secondary-index by-ref paths)
  require temporal separation from writer or index mutation.
- **One serialized synchronization lane** — processes committed transactions,
  synchronizes secondary indices, applies reactive query deltas, and writes journal
  entries, one burst at a time. A synchronous `Commit()` runs its burst on the committing
  thread (it waits for it anyway, so no other thread is woken and none has to be scheduled);
  `CommitAsync()` hands its burst to one ConjureDB-owned background thread per context
  (`WorkerExecutionMode.DedicatedThread`, the default), or runs it on the committing thread too
  (`WorkerExecutionMode.Inline`, for hosts without threads). The commit path takes no
  ThreadPool work item. See [Worker thread](#worker-thread).

Mutation staging and the writer-to-background ring transport remain **lock-free**.
Commit dispatch, worker lifecycle, and ordered health publication use narrow internal
monitors; they do not protect primary rows or make readers contend with the writer.
Point reads and value-owned/snapshot-owned routes access committed primary data
without synchronization. Live/by-ref/no-sync borrows are not concurrent-reader
routes: consume them before the next writer or index mutation.

Ephemeral tables have a deliberately different contract: **single-reader /
single-writer on the owning frame thread**. Their reads, writes, iteration, event
lifecycle, and structural playback are frame-thread-only. They do not enter a
transaction, the background worker or persistence, and they do not provide MVCC or
safe background readers. Publication of ephemeral sources into existing ReactiveQuery/IVM
is not implemented yet; this is not a permanent integration prohibition. Integration must
reuse the existing subsystem and define result lifetime, ownership, publication and reset
semantics without weakening the storage's concurrency guarantees. See
[Ephemeral Tables — Concurrency and ownership](/docs/advanced/ephemeral-tables#concurrency-and-ownership).
Unless a section explicitly says otherwise, the worker, transaction, index, version,
and reactive details below describe persistent tables only.

### Design Rationale

Game clients run in a single process with a predictable threading model:

| Thread | Role | Typical Source |
|--------|------|----------------|
| Main thread (60 fps) | Game logic, mutations | Unity `Update()` / `FixedUpdate()` |
| Synchronization lane | Index sync, journal writes | The committing thread for `Commit()`; the ConjureDB-owned worker thread (one per context) for `CommitAsync()` |
| UI thread | Display updates | Unity UI toolkit |
| Network thread | Server communication | Transport layer |
| Audio thread | Sound processing | Audio engine |

Traditional databases (PostgreSQL, MySQL) use MVCC with row-level locks to support
arbitrary concurrent writers. This adds significant complexity: version chains, vacuum,
deadlock detection, lock escalation. None of this is necessary when there is a single
logical writer, which is the natural model for game clients.

ConjureDB eliminates this complexity entirely:

- **No locks** on the primary index
- **No MVCC version chains** — no undo logs, no garbage collection
- **No data-lock deadlocks** — there are no row/page locks; internal scheduler monitors
  have narrow, ordered ownership
- **No reader/writer lock contention** — point readers and owned results do not
  block writers; live borrows require temporal separation rather than locking
- **Zero-allocation** on the hot mutation/dispatch path — a semaphore wake and event signals
  avoid per-commit delegate or `Task` allocation

---

## Persistent concurrency architecture

```text
Main Thread (writer)                  Serialized Background Execution Lane
┌──────────────────────────┐          ┌────────────────────────────────────┐
│ BeginTransaction()       │          │ State: Idle / ScheduledOrRunning   │
│                          │          │ Dedicated "ConjureDB worker" thread│
│ Add / Update / Remove    │          │                                    │
│   ↓ immediate on         │          │                                    │
│   PrimaryIndex (dense    │          │                                    │
│   array, no locks)       │          │                                    │
│   ↓ enqueue StateChange  │          │                                    │
│   into CommitBuffer      │          │                                    │
│   (ring buffer)          │          │                                    │
│                          │          │                                    │
│ Commit()                 │          │                                    │
│   ↓ advance commitStart  │          │                                    │
│   ↓ dispatch events      │          │                                    │
│   ↓ Version = N+1        │          │                                    │
│   ↓ Volatile.Write       │          │                                    │
│     (_commitVersion)     │          │                                    │
│   ↓ mark commit pending  │          │                                    │
│   ↓ claim lane if Idle:  │          │ CommitAsync(): wake the worker     │
│     Commit() runs the    │          │ thread (semaphore), no pool item   │
│     burst right here ────┼─ same ──→│   ↓ claim serialized ownership     │
│ Read point/value-owned  │          │   ↓ for each version:              │
│ primary data ✅          │          │     SyncIndex (write lock)         │
│                          │          │     SyncReactiveQueries            │
│                          │          │     TransactionEnd (journal)       │
│                          │          │     Volatile.Write                 │
│                          │          │       (_lastProcessedVersion)      │
│                          │          │     Complete waiters               │
│                          │          │   ↓ drain or observe newer version │
│                          │          │   ↓ publish Idle when caught up    │
└──────────────────────────┘          └────────────────────────────────────┘
        ▲                                          ▲
        │ point/value-owned reads                   │
   ┌────┴─────────┐                                 │
   │ Reader       │   FindById / TryFindById /      │
   │ Threads      │   Contains / Count              │
   │              │   (dense array, lock-free)      │
   │              │                                 │
   │              │   Secondary value-owned queries ─┘
   │              │   (safe after background sync)
   └──────────────┘
```

### Inter-Thread Communication

The writer and serialized background execution lane communicate through three
mechanisms:

1. **`CommitBuffer<T>` (ring buffer)** — carries `StateChange<T>` records from the
   writer to the background lane. Uses cache-line padded indices (`PaddedInt`, 64-byte
   aligned) and `Volatile.Read`/`Volatile.Write` for lock-free producer-consumer
   semantics.

2. **Serialized scheduler state** — a commit claims the lane only when it is `Idle`.
   `Commit()` then runs the burst on the committing thread; `CommitAsync()` releases the
   `SemaphoreSlim` the parked worker thread consumes (in `Inline` mode the committing thread runs
   every burst). No route allocates a delegate or work item per synchronous commit. Commits that
   arrive while the lane is `ScheduledOrRunning` are coalesced by version and consumed by the
   current burst, which publishes `Idle` before it releases its committers, so a released writer's
   next commit always finds the lane free.

3. **Pending/completion signals and `Volatile` version counters** — `_commitEvent`
   records whether unprocessed work may exist, while separate completion signals
   release synchronous commit and shutdown waiters. `_commitVersion` (written by the
   writer) and `_lastProcessedVersion` (written by the background lane) use
   `Volatile.Read`/`Volatile.Write` because `ulong` is not supported by the C#
   `volatile` keyword.

---

## Persistent isolation level

Persistent ConjureDB tables provide **read-committed** isolation, achieved
structurally rather than through locks or MVCC:

| Property | Guarantee | Mechanism |
|----------|-----------|-----------|
| **No dirty reads** | Readers never see uncommitted data | Committed data published via `Volatile.Write` on version; `CommitBuffer.commitStart` advances only on commit |
| **No lost updates** | Impossible — only one writer | Single-writer serialization by caller contract |
| **No write-write conflicts** | Impossible — only one writer | No concurrent transactions |
| **No data-lock deadlocks** | No row/page locks participate in a transaction | Single-writer data ownership plus narrow, ordered internal scheduler monitors |
| **Read-your-writes** | Writer sees its own uncommitted changes on primary index | Mutations applied immediately to `PrimaryIndex` |
| **No phantom reads** | Single-writer eliminates insert anomalies | No concurrent inserts possible |

### Comparison with SQL Isolation Levels

| Anomaly | Read Uncommitted | Read Committed | Repeatable Read | Serializable | **ConjureDB** |
|---------|:---:|:---:|:---:|:---:|:---:|
| Dirty read | ✗ | ✓ | ✓ | ✓ | **✓** |
| Non-repeatable read | ✗ | ✗ | ✓ | ✓ | **✓** (single writer) |
| Phantom read | ✗ | ✗ | ✗ | ✓ | **✓** (single writer) |
| Write skew | ✗ | ✗ | ✗ | ✓ | **✓** (single writer) |

✓ = prevented, ✗ = possible

Because there is only one writer, ConjureDB achieves anomaly prevention equivalent to
serializable isolation without the overhead of predicate locks or serialization graphs.
However, this is not classical serializability — it is a consequence of the
single-writer architecture.

### What Readers See

| Reader Location | Sees | Notes |
|----------------|------|-------|
| Writer thread, inside transaction | Uncommitted primary index state | Read-your-writes on primary index only |
| Writer thread, outside transaction | Latest committed state | Same point/value-owned primary routes as other readers |
| Reader thread, primary point/value-owned route | Latest committed state | Live/by-ref/no-sync primary borrows require temporal separation from writer mutation |
| Reader thread, secondary value/snapshot-owned route | Last-synced committed state | Safe after worker sync; secondary by-ref/no-sync borrows require temporal separation from index mutation |
| Reactive query consumer | Last-notified committed state | Updated after worker applies deltas and notifies |

---

## Persistent version tracking and ordering

Every successful commit increments a monotonic `ulong` version counter:

```text
Version 0 (initial)
    │
    ├─ BeginTransaction() → ActiveTransactionVersion = 1
    ├─ Commit() → Version = 1, worker signaled
    │
    ├─ BeginTransaction() → ActiveTransactionVersion = 2
    ├─ Commit() → Version = 2, worker signaled
    │
    └─ ...
```

### Version Consumers

| Component | Version Used | Purpose |
|-----------|-------------|---------|
| **Background execution lane** | `_commitVersion`, `_lastProcessedVersion` | Sequential processing — never skips a version |
| **Journal** | `ChangeRecord.Version` | Recovery replays `version > snapshotVersion` |
| **Snapshot** | Header version | Identifies the snapshot's logical point in time |
| **Reactive queries** | `ReactiveQuery.Version` | Tracks which database version the materialized view reflects |
| **`HasPendingCommits()`** | Compares committed vs. processed | Determines if worker has unprocessed versions |

### Ordering Guarantees

- Versions are **strictly monotonic** — no gaps, no reuse.
- `Rollback()` does **not** consume a version number.
- The background lane processes versions **in order** — version N is fully processed
  (secondary indices synced, reactive queries updated, journal written) before
  version N+1 begins.
- `CommitAsync()` returns only after the background lane has processed the specific
  version.

For detailed version lifecycle and `CommitAsync` semantics, see
[Transactions — Version Tracking](/docs/engine/transactions#version-tracking).

---

## Thread Safety Reference

### Persistent operation safety matrix

| Operation | Thread Safety | Notes |
|-----------|:---:|-------|
| `FindById(id)` | ✅ Any thread | Dense array lookup, no synchronization needed |
| `TryFindById(id, out entity)` | ✅ Any thread | Same as `FindById` |
| `Contains(id)` | ✅ Any thread | Sparse-to-dense index check |
| `Count` | ✅ Any thread | Single `int` field read |
| `All` / `AsMemory` / `DenseIndexById` | ⚠ Temporal separation | Live zero-copy borrow over contiguous storage; no concurrent writer mutation. Read it on the writer thread or while writer mutation is quiescent, and consume it before the next mutation |
| `IsTransactionInStarted` | ✅ Any thread | `Volatile.Read` provides cross-thread visibility |
| `Version` | ✅ Any thread | `Volatile.Read` on `ulong` |
| `HasPendingCommits()` | ✅ Any thread | Checks the background lane's pending-work signal |
| Compiled query execution (value-owned/snapshot-owned result) | ✅ Any thread | Compiled by-ref/no-sync borrow paths require temporal separation and no concurrent writer mutation |
| Secondary index query (value-owned/snapshot-owned result, after sync) | ✅ Any thread | Synchronized reads are safe; secondary-index by-ref/no-sync borrow paths require temporal separation and no concurrent index mutation |
| `ReactiveQuery<T>.Current` | ✅ Any thread | Direct mode: temporal separation; DoubleBuffered: front-buffer snapshot |
| `BeginTransaction()` | ❌ Writer only | No locking — concurrent calls corrupt state |
| `Add` / `Update` / `Remove` / `Upsert` | ❌ Writer only | Must be within an active transaction |
| `Commit()` | ❌ Writer only | Advances version, schedules the background lane |
| `CommitAsync()` | ❌ Writer only | Internal `SemaphoreSlim` serializes the async wait |
| `Rollback()` | ❌ Writer only | Traverses change buffer in reverse |

### Ephemeral operation safety matrix

| Operation | Thread Safety | Notes |
|-----------|:---:|-------|
| Row/component reads, `Count`, chunk access | ❌ Owning frame thread only | Always-on owner-thread guard; no background-reader contract |
| Direct row/component writes outside a running system | ❌ Owning frame thread only | Non-transactional frame-local state |
| Generated system reads/writes | ❌ Active system invocation only | Exact typed access manifest is validated against the current `FrameContext` |
| Structural work during a system | ❌ Record on owning frame thread | Applied by scheduler-owned deterministic boundary playback |
| Event append/read and singleton access | ❌ Owning frame thread only | System access is manifest-validated; event swap/clear is scheduler-owned |
| `FrameScheduler.Pump` / Unity phase calls | ❌ Scheduler owner thread only | Re-entry and cross-thread use fail closed |

Persistent-table guarantees in the preceding matrix do not extend to ephemeral
storage. In particular, an ephemeral `Count` or chunk span is not an any-thread
snapshot and must not be handed to a worker, UI, or network thread.

### Persistent primary index: why reads are lock-free

The primary index (`PrimaryIndex<T>`) uses a dense array with a sparse id-to-index
mapping:

```text
Sparse index:  [_, 0, _, 2, 1, _, ...]   (id → dense index)
Dense array:   [Entity1, Entity4, Entity3] (contiguous storage)
```

- **Point reads** access the sparse array to resolve the dense index, then read from
  the dense array. Both are plain array accesses — no locks, no `Volatile`, no fences.
- **Writes** modify both arrays, but are serialized on the writer thread by the
  transaction model. A concurrent reader may observe a partially-written entity
  only if the entity type contains reference fields that are updated non-atomically.
  For value-type-only entities (the common case in games), point reads are consistent.
- **Bulk reads** via `All` / `AsMemory` borrow a `ReadOnlyMemory<T>` slice of the dense
  array, and `DenseIndexById` borrows the sparse map the same way. They allocate nothing
  and are live borrows rather than snapshots: no writer mutation may overlap them, and
  they must be consumed before the next mutation. Compiled and secondary-index
  by-ref/no-sync paths carry the same temporal-separation contract; point reads and
  value-owned/snapshot-owned results keep their any-thread guarantee.

### Persistent secondary index: synchronized access

Secondary indices are updated by the serialized background execution lane after
commit.
They use a `ShadowReaderWriterLock` (`_syncLock`, writer-preferring, no recursion) with two roles:

1. **Write lock** — held during `SyncIndex()` (main thread lazy sync) and
   `WorkerSync()` (background lane). Prevents concurrent mutation of the
   secondary index data structures.

2. **Monitor lock** — used for read-read mutual exclusion on aggregation index
   partials and enumerator lifetime management.

Why not `ReaderWriterLockSlim`: it keeps per-thread lock records in a thread static, so a thread's first
write acquisition of any instance allocates its static block (176 B on .NET 8) and a thread's first read of an
instance allocates a 48 B record; its wait events are also created lazily, at the first acquisition that blocks.
An index-sync helper that first won a table after warm-up therefore allocated at an arbitrary cycle.
`ShadowReaderWriterLock` keeps no per-thread state (one interlocked state word; a monitor object created up
front for blocking), so no acquisition on any thread allocates.

When you query a secondary index:

```csharp
// Value-owned result — safe after worker has synced
var items = db.Items.GetIndex<int>().Find(categoryId);
```

The query internally calls `SyncIndex()` which either:
- Returns immediately if no pending changes exist, or
- Acquires the write lock and applies pending changes before returning.

If background synchronization holds the write lock, `SyncIndex()` first applies a
100ms write-lock timeout and then waits on the secondary index's `_syncComplete`
signal rather than contending indefinitely.

### Persistent unique index: dual-validation strategy

Unique secondary indices (`UniqueIndex<TKey>`) use a two-layer validation approach
to detect duplicates at `Add()` time, before the worker has synced:

1. **`ConcurrentDictionary<TKey, int> _pendingKeys`** — thread-safe set of keys that
   have been validated but not yet committed to the synchronized lookup. Checked first.

2. **`Dictionary<TKey, int> _lookup`** — committed keys, protected by
   `_syncLock.TryEnterReadLock(0)`. If the worker holds the write lock, the read-lock
   attempt is skipped — the background lane's own `AddInternal` will catch any
   duplicate as a fail-safe.

3. **`_pendingKeys.TryAdd(key, id)`** — reserves the key atomically. If another
   in-flight add in the same transaction already reserved it, throws
   `SecondaryIndexValidationException`.

On rollback, `RollbackValidateAdd` removes the key from `_pendingKeys`.

---

## Synchronization Primitives Reference

ConjureDB uses a minimal set of synchronization primitives, chosen to minimize
overhead on the hot path:

| Primitive | Location | Purpose |
|-----------|----------|---------|
| `Volatile.Read` / `Volatile.Write` | `TransactionManager`, `DbWorker`, `ReactiveQuery` | Acquire/release semantics for flags and `ulong` version counters |
| `volatile bool` | `ReactiveQuery._dirty` | Single-writer/single-reader dirty-state flag between the background lane and notification phase |
| `PaddedInt` (64-byte struct) | `CommitBuffer` | Cache-line padding to prevent false sharing between producer and consumer indices |
| Scheduler state + `SemaphoreSlim` wake | `DbWorker` (`DbWorker.Lane.cs`, `WorkerLaneThread`) | Coalesces commits into one serialized background execution lane on the context's dedicated worker thread |
| Bounded ring + `lock` / `Monitor` | `JournalRecordQueue`, `JournalWriterLane` | Journal record hand-off with blocking backpressure, and the parked "ConjureDB journal" thread ([Journal thread](#journal-thread)) |
| `lock` / `Monitor` | `DbWorker._clientWorkerScheduleLock` | Owns the `Idle`/`ScheduledOrRunning` transition, scheduled-burst count, and shutdown completion signal |
| `lock` / `Monitor` | `DbWorker._workerLifecycleLock` | Serializes worker start/dispose lifecycle transitions; it does not guard commit processing |
| `lock` / `Monitor` | `DbWorker._healthTransitionLock` | Preserves health-event order and single-publisher ownership while callbacks run outside scheduler scratch ownership |
| `lock` / `Monitor` | `DbWorker._pendingAsyncCommitLock` | Serializes registration, completion, cancellation, and removal of the one supported async commit waiter |
| `ManualResetEventSlim` | `DbWorker._commitEvent` | Pending-commit marker used by `HasPendingCommits()` |
| `ManualResetSignal` (spin, then `Monitor`) | `DbWorker._syncCommitProcessedEvent` | Synchronous commit completion/failure signaling |
| `ManualResetEventSlim` | `DbWorker._clientWorkerCompletedEvent` | Scheduled work-item lifetime and shutdown signaling |
| `ShadowReaderWriterLock` (spin, then `Monitor`) | `SynchronizedIndex._syncLock` | Protects secondary index data during sync; allows concurrent readers |
| `SemaphoreSlim(1, 1)` | `DbContext._commitLock` | Serializes concurrent `CommitAsync()` calls |
| `ConcurrentDictionary<TKey, int>` | `UniqueIndex._pendingKeys` | Thread-safe pending key tracking for unique constraint validation |
| `Interlocked.CompareExchange` | `MemoryBudget` | Lock-free CAS loop for atomic memory allocation tracking |
| `TaskCompletionSource<bool>` | `DbWorker._pendingAsyncCommitCompletion` | Async completion signaling for the currently registered `CommitAsync()` caller |

### Why Not Traditional Locks?

| Traditional Approach | ConjureDB Alternative | Why |
|---------------------|----------------------|-----|
| Row/page `lock` on writes | Single-writer data contract | Primary mutation staging needs no data lock; only narrow scheduler bookkeeping uses monitors |
| `ReaderWriterLock` on primary index | Dense array point reads + single-writer writes | Point reads are plain array access; live borrows require temporal separation |
| `Mutex` for transactions | `InvalidOperationException` if re-entered | Fail-fast instead of blocking |
| Lock-free CAS on data structures | `Volatile` + ring buffer | Simpler, sufficient for single-producer/single-consumer |

---

## CommitBuffer: Lock-Free Ring Buffer

The `CommitBuffer<T>` is the core inter-thread communication mechanism. It is a
bounded single-producer / single-consumer ring buffer using cache-line padded indices:

```text
Capacity = 4 (simplified)

State: 2 items pending for worker
┌───────┬───────┬───────┬───────┐
│  [0]  │  [1]  │  [2]  │  [3]  │
│ Add   │ Upd   │       │       │
└───────┴───────┴───────┴───────┘
  head=3  commitStart=0  current=2

Main thread enqueues at _current (no Volatile — single-writer).
Worker dequeues from _head (Volatile.Read / Volatile.Write).
Commit() advances _commitStart to _current (Volatile.Write).
```

### Backpressure

If the ring buffer fills (worker cannot drain fast enough), the producer
spins with `SpinWait`. After a configurable spin limit (default 100,000 spins ≈ 100 ms),
an `InvalidOperationException` is thrown:

```text
CommitBuffer full: waited 100000 spins (~100 ms).
Buffer capacity=64, pending=63. Background lane may be blocked or buffer capacity is insufficient.
```

This is a fail-fast mechanism — not a retry. See
[Transactions — Buffer Overflow](/docs/engine/transactions#4-buffer-overflow-in-large-transactions)
for mitigation strategies.

### False Sharing Prevention

The head, commitStart, and current indices are stored in `PaddedInt` structs with
`[StructLayout(LayoutKind.Explicit, Size = 64)]` — ensuring each index occupies its
own cache line. Without padding, the producer and consumer could thrash each other's
cache lines even though they access different indices, degrading performance by
10–100× on multi-core CPUs.

---

## Secondary Index Synchronization

Secondary indices follow a **deferred-commit** pattern:

```text
  Main Thread                            Serialized Background Lane
  ───────────                            ──────────────────────────
  1. Add(entity)
     → PrimaryIndex.Add() [immediate]
     → StateChangeBuffer.Enqueue()
     → UniqueIndex.ValidateAdd()
       (ConcurrentDictionary check)

  2. Commit()
     → CommitBuffer.Commit()
       (advance commitStart)
     → Mark pending and schedule if Idle
                                         3. SynchronizedIndex.WorkerSync()
                                            → _syncLock.EnterWriteLock()
                                            → CommitBuffer.TryDequeue() loop
                                              → apply Add/Update/Remove
                                                to all registered indices
                                            → _syncLock.ExitWriteLock()

                                         4. ReactiveQuery.ApplyChanges()

                                         5. Persistence.TransactionEnd()

                                         6. Volatile.Write(_lastProcessedVersion)

                                         7. CompletePendingTasks()
                                            → TCS.TrySetResult(true)
                                            → CommitAsync() callers unblocked
```

### Consistency Windows

| After this point... | Primary index | Secondary indices | Reactive queries | Journal |
|---------------------|:---:|:---:|:---:|:---:|
| `Add()` / `Update()` / `Remove()` | ✅ Updated | ❌ Stale | ❌ Stale | ❌ Not written |
| `Commit()` returns | ✅ Updated | ✅ Updated | ✅ Updated (notified) | ⏳ Pending |
| `CommitAsync()` returns | ✅ Updated | ✅ Updated | ✅ Updated (notified) | ⏳ Pending flush |
| `CommitAsync(forceFlush: true)` returns | ✅ Updated | ✅ Updated | ✅ Updated (notified) | ✅ Flushed |

Both commit forms return only after the version's synchronization burst has finished — including
reactive delta application *and* notification dispatch — whichever thread ran it. See
[Commit completion boundary](#commit-completion-boundary) for why that boundary is load-bearing
rather than a convenience.

### Worker thread

`Commit()` returns only after its version is synchronized, so where that work runs is on the frame-time
critical path.

**A synchronous commit runs its own burst.** The committing thread claims the lane and runs the burst itself —
index sync (with the helper threads when a cycle is large enough to parallelize, the committing thread being
one of the participants), materialized and reactive maintenance, notifications, waiter release. It would wait
for that work anyway; running it anywhere else only adds two thread wake-ups (committer to worker, worker to
committer) and makes the commit's latency depend on how soon the operating system schedules a parked thread:
tens of microseconds on an idle machine, a scheduler quantum or much worse on a loaded device — the stalls of
lane fix-86 (see [Commit stalls](#commit-stalls-lane-fix-86)). No `Commit()` waits for another thread to be
scheduled: the lane is always `Idle` when a writer commits (every burst publishes `Idle` before releasing its
committers, and `Commit()` first waits for an in-flight `CommitAsync()`), the parallel index-sync join never
waits for a helper that has not started ([below](#parallel-secondary-index-processing)), and health observers
run on the worker thread.

`WorkerConfiguration` selects where asynchronous bursts run:

| Setting | Default | Meaning |
|---|---|---|
| `WorkerExecution` | `DedicatedThread` | `DedicatedThread`: one ConjureDB-owned background thread per context ("ConjureDB worker") runs `CommitAsync()` bursts and publishes health transitions. `Inline`: no thread; every burst runs on the committing thread. |
| `WorkerThreadPriority` | `Normal` | Priority of every thread ConjureDB starts for the worker: the worker thread and the index-sync helpers. |

**Dedicated thread.** Started by `InitializeAsync` (a host that cannot start threads fails there with
`PlatformNotSupportedException` naming `WorkerExecution`), parked on a semaphore between wake-ups, a background
thread (an undisposed context never keeps the process alive), joined by `Dispose` after in-flight work has
drained. The scheduler wakes it once per `Idle` → `ScheduledOrRunning` transition of an asynchronous commit;
commits that arrive while a burst runs are coalesced into it. A burst that ran on a committing thread hands its
health transitions to it (a separate wake-up reason, so a burst is never run twice). A committing thread that has to
wait for another thread's burst spins briefly, then blocks on a monitor (`ManualResetSignal`; unlike
`ManualResetEventSlim` it never creates its lock object lazily, which put 24 B on the frame thread at the first
commit that had to block). The worker's cycle — wake, burst, completion, park — and a synchronous commit's cycle on
the committing thread allocate nothing (`DbWorkerLaneExclusiveTests` pins 0 B on both), and nothing on the commit
path queues a ThreadPool work item or a `Task`.

Why not the ThreadPool. The worker used to be one reusable ThreadPool work item per burst. Games keep the pool
busy (Unity code commonly blocks pool threads), and every commit then waited behind the host's items. Lane
feat-83 measured it (i7-12800H, 20 logical processors, .NET 8 Release; one table with Lookup + SortedSet +
Unique indexes, so every commit takes the worker path; `ConjureDB.Benchmarks --commit-latency-probe`):

Commit() latency in µs, p50 / p99 / max (`before.csv`, `after.csv`, `after-inline.csv`):

| Pool | Rows/tx | Pacing | ThreadPool work item (before) | Dedicated thread (after) | Inline (after) |
|---|---:|---|---|---|---|
| block | 1 | burst | 59,380 / 172,629 / 374,917 | 4.2 / 9.1 / 95 | 4.7 / 15 / 62 |
| block | 10 | burst | 61,089 / 169,974 / 713,967 | 37 / 124 / 598 | 28 / 77 / 162 |
| block | 1,000 | burst | 62,170 / 63,950 / 69,342 | 1,644 / 3,887 / 9,350 | 1,361 / 6,524 / 13,209 |
| block | 1 | frame | 60,706 / 111,410 / 216,346 | 64 / 6,639 / 39,629 | 14 / 27 / 144 |
| block | 10 | frame | 60,797 / 145,825 / 354,232 | 66 / 20,103 / 47,370 | 27 / 60 / 15,301 |
| block | 1,000 | frame | 59,954 / 116,142 / 147,926 | 1,204 / 5,064 / 12,696 | 1,201 / 2,589 / 5,960 |
| idle | 1 | burst | 24 / 112-260 / 7-40 ms | 6 / 44-95 / 2-7 ms | 3.5 / 12 / 58 |
| idle | 1 | frame | 79-94 / 12-24 ms / 22-55 ms | 73-80 / 0.2-10 ms / 2-58 ms | 12 / 33 / 158 |
| idle | 1,000 | burst | 1,354-1,608 / 9-41 ms / 11-50 ms | 1,226-1,511 / 8-25 ms / 11-34 ms | 1,357 / 5,688 / 11,072 |

The idle rows for the two thread designs are the range over three interleaved runs (`ab-idle.csv`).

`block` caps the pool at `ProcessorCount` threads and keeps 4 x `ProcessorCount` self-requeueing items that
each block 1 ms (a 15.6 ms timer tick on Windows) in it; `burst` commits back to back, `frame` spins 2 ms
between commits so every commit pays a cold wake-up. The machine was shared with other builds (60-100% CPU
load), so every tail above ~1 ms is scheduler noise that both designs see; interleaved runs on the idle pool
(`ab-idle.csv`) put the medians at 6 µs vs 24 µs (1 row, burst) and 73-80 µs vs 79-94 µs (1 row, frame), with
tails of the same order.

**Async commits.** `CommitAsync()` completes a `TaskCompletionSource` created with
`RunContinuationsAsynchronously`: the worker never runs the awaiting caller's continuation (that would put the
rest of the caller's method on the worker thread and block the next burst behind it). The caller resumes on its
`SynchronizationContext` — the Unity main thread in a game, which needs no pool thread — or, when it has none,
on the ThreadPool. The pool-free path is the synchronous `Commit()`. `Dispose` drains pending commits with a
synchronous wait for the same reason.

**Where callbacks run.** Secondary-index subscribers and reactive notifications run on the thread that runs the
burst: the committing thread inside `Commit()`, the worker thread for `CommitAsync()`. A callback that blocks
delays its commit. `WorkerHealthChanged` observers always run on the worker thread (in `Inline` mode, in the
burst's tail): an observer may commit again (a recovery commit after `Degraded`), which it could not do inside
the failed commit on the committing thread; its commit then runs nested on the worker thread. A synchronous
commit issued from inside a running burst of the same thread (a subscriber or notification that commits) would
wait for itself; it fails fast with `InvalidOperationException` instead of deadlocking. A retryable failure's
logger calls run on the thread that ran the failed burst.

**Priority.** Default `Normal`, by measurement and by the waiting relationship. (Measured before synchronous
commits ran their own burst; it now governs `CommitAsync()` completion and the index-sync helpers a synchronous
commit joins.) When a committing thread waits for the worker, worker time is frame time: below the committing thread's priority the worker
is preempted by every Normal thread (the host's pool work, job threads) while the frame thread waits on it — a
priority inversion. Above it, the worker would preempt the render thread and the host for work nobody waits on
during `CommitAsync()`. `Normal` is also what the ThreadPool threads it used to run on had. Measured under CPU
contention (20 CPU-bound Normal pool items plus the shared machine's load; one commit per 2 ms; 600 commits):

Commit() latency in µs, p50 / p99 (`priority.csv`):

| Frame thread | Worker BelowNormal | Worker Normal | Worker AboveNormal |
|---|---|---|---|
| Normal, 1 row | starved: 600 commits did not finish in 600 s | 23,779 / 43,675 | 21,110 / 44,441 |
| Normal, 10 rows | not run (same) | 22,923 / 57,045 | 25,692 / 56,822 |
| AboveNormal, 1 row | 2,348 / 2,481,050 | 16,506 / 33,504 | 1,037 / 7,672 |
| AboveNormal, 10 rows | 85 / 2,542,559 | 8,063 / 27,293 | 23 / 9,282 |

Below the committing thread the worker starves (seconds). Above it there is no gain: the committing thread's
own wake-up then dominates. Matching it is what matters: a Normal worker behind an AboveNormal frame thread
still loses ~8-16 ms per commit, an AboveNormal one ~0.02-1 ms. Normal is the priority of a default thread, so
the default matches a default frame thread; a game that raises its main thread's priority should raise
`WorkerThreadPriority` to the same level.

The effect is platform-defined: Windows maps it to the thread priority; Linux/Android runtimes may ignore a priority change of
a normal (non-realtime) thread without elevated privileges.

**Inline mode and Unity WebGL.** WebGL has no threads. Select `WorkerExecution = WorkerExecutionMode.Inline`
and `IndexSyncExecution = IndexSyncExecutionMode.Sequential` there: a commit then runs the whole cycle —
index sync, materialized and reactive maintenance, notifications — on the committing thread before returning,
and no thread is started. With the thread-based defaults the context fails `InitializeAsync` with
`PlatformNotSupportedException` naming the setting instead of degrading silently. (The precompiled
netstandard2.1 assembly cannot see Unity's `UNITY_WEBGL` define, so the choice belongs to the host's
configuration.) Inline mode is also valid with helper threads: the committing thread then takes the worker's
place in a parallel index-sync cycle.

Remaining ThreadPool use, off the commit path: snapshot scheduling and `WaitForSynchronizationAsync`. The journal
has its own thread ([Journal thread](#journal-thread)).

### Journal thread

With journaling on, the worker lane turns every state change into a journal record and ends the transaction with a
transaction-end marker. Where those records are written:

| Commit | Who writes the journal | Physical sync |
|---|---|---|
| `DurabilityPolicy.FastMobile` (default) | the journal thread ("ConjureDB journal"), promptly after the transaction-end marker | no (write + OS flush per transaction) |
| `CriticalState` / `ForceFlushEveryCommit`, or `CommitAsync(forceFlush: true)` | the committing thread, before `Commit()` returns | yes (`FlushFileBuffers` / `fsync`) |
| any policy, `WorkerExecutionMode.Inline` | the committing thread, before `Commit()` returns; no journal thread | only when the policy asks |

- **Hand-off.** Records go into a bounded ring (`JournalOptions.ChannelCapacity`, 1 024 records, allocated once,
  one monitor). A full ring blocks the producer until a drain frees a slot (5 s timeout); a record that fills the ring
  to half wakes the journal thread early, so a large transaction rarely blocks. A terminal journal fault wakes every
  blocked producer at once and it rethrows the fault. Inline, a producer that finds the ring full drains it itself.
- **Journal thread.** Started by `InitializeAsync` (a host that cannot start threads fails there, naming
  `WorkerExecution`), a background thread at `WorkerThreadPriority`, parked on a monitor: without a timeout when nothing
  is pending, with the adaptive flush interval while a partial transaction is buffered. Requests coalesce. `Dispose`
  closes admission, persists every queued record with a final sync, then joins the thread. A wake/drain/park cycle
  allocates nothing (`JournalWriterLaneExclusiveTests` pins 0 B per record).
- **Durability point.** A forced flush never waits for the journal thread: the committing thread takes the journal's
  write lock, drains the ring and syncs the file itself — the same split as PostgreSQL, where a backend flushes WAL
  in its own commit and the WAL writer only serves asynchronous commits. Nothing on that path queues a ThreadPool
  item or waits on a `Task`, and it allocates nothing. Under a flush-per-commit policy the transaction end does not
  wake the journal thread at all. `CommitAsync(forceFlush: true)` performs the sync on the calling thread before its
  task completes.
- **Streams.** Journal files are opened for synchronous I/O. An overlapped (async) handle made each synchronous write
  and flush allocate a completion event (176 B) and cost 3.5x per OS write on Windows.

Why not the ThreadPool. The journal writer used to be a `Task.Run` loop polling with `Task.Delay`, and the record
queue a bounded `Channel` whose blocked writer was released by a continuation queued to the pool. Under a saturated
pool every refill of a full queue waited for a pool thread, and a forced flush that met the background loop on the
write lock resumed on the pool. Lane feat-85 measured it with `ConjureDB.Benchmarks --commit-latency-probe --journal
batched,flush --fsync off` (same machine and table as above; `--fsync off` keeps every write and OS flush but performs
the physical sync as an OS flush, so the disk's own latency — tens to hundreds of ms of tail on this shared machine —
does not hide the scheduling path). Ranges are two interleaved rounds (`latency.csv`):

Commit() latency, p50 / p99 / max (µs unless marked), saturated pool (`block`):

| Journal | Rows/tx | Pacing | Before (pool writer) | After (journal thread) |
|---|---:|---|---|---|
| batched | 1 | burst | 34-48 / 128-1.6 ms / 64-76 ms | 6-9 / 67-150 / 0.4-6.5 ms |
| batched | 10 | burst | 54-84 / 14-55 ms / 105-116 ms | 50-58 / 169-236 / 0.9-2.6 ms |
| batched | 1,000 | burst | 61.3-61.6 ms / 91-378 ms / 94-515 ms | 2.1 ms / 6.6-8.7 ms / 10-13 ms |
| batched | 1,000 | frame | 59.0-59.8 ms / 77-83 ms / 77-167 ms | 1.9-2.1 ms / 3.6-7.6 ms / 6.6-25 ms |
| flush | 1 | burst | 17-45 / 0.1-12.3 ms / 56-57 ms | 10-13 / 84-90 / 192-466 |
| flush | 10 | burst | 100-104 / 0.4-2.1 ms / 7.6-27 ms | 31-33 / 142-151 / 311-926 |
| flush | 1,000 | burst | 2.2-5.3 ms / 4.7-154 ms / 6.4-245 ms | 2.0-2.2 ms / 3.6-3.9 ms / 6.6-7.8 ms |

The same workloads with an idle pool (for the closure criterion: saturated-pool p99 in the idle-pool range):

| Journal | Rows/tx | Pacing | Before | After |
|---|---:|---|---|---|
| batched | 1,000 | burst | 2.3-3.0 ms / 8.4-9.6 ms / 15-27 ms | 2.2-2.7 ms / 4.1-4.5 ms / 7.1-8.8 ms |
| flush | 1 | burst | 17-26 / 171-305 / 0.7-1.8 ms | 11-15 / 75-98 / 0.2-14 ms |
| flush | 1,000 | burst | 3.0-3.4 ms / 9.1-17 ms / 14-26 ms | 1.9-2.8 ms / 3.1-12 ms / 5.5-14 ms |

Journaled throughput with the real sync (`throughput.csv`, rows/s at the p50 commit, two rounds, burst pacing):

| Pool | Journal | 1,000 rows/tx before | after | 10,000 rows/tx before | after |
|---|---|---:|---:|---:|---:|
| idle | batched | 36k-109k | 103k-315k | 45k-79k | 156k-290k |
| idle | flush | 51k-69k | 63k-119k | 50k-51k | 200k-263k |
| block | batched | 16.1k-16.2k | 71k-166k | 15.8k-16.9k | 154k-280k |
| block | flush | 77k-132k | 63k-112k | 16.6k-16.7k | 188k-247k |

A 10,000-row transaction overflows the 1,024-record queue, so before it paid a pool round trip per refill even with
an idle pool; one sync-bound 1,000-row flush commit is within noise. With the real sync a 1-row flush-per-commit
commit is disk-bound either way (p50 3-7 ms before, 3-18 ms after, tails of 10-360 ms in both on this shared disk;
`fsync.csv`); its committing thread allocated 197-243 B per commit before (the overlapped handle) and 0 B after.

#### Commit stalls (lane fix-86)

Symptom (lanes feat-81/feat-84, worker on the ThreadPool): under heavy machine load a `Commit()` sometimes blocked
in `CommitAndWait` for tens of seconds to minutes with no worker running. A stack dump showed the committing thread
parked on its event, no worker frame on any thread, and a pool thread that had dequeued the burst's work item busy
creating another pool thread before running it: the burst waited behind ThreadPool thread injection. The hand-off
protocol itself loses no wake-up (an exhaustive interleaving model of `CommitAndWait` against the burst finds no
deadlock). The dedicated worker thread (feat-83) removed the pool, but not the cause: every `Commit()` still blocked
until the operating system scheduled a parked thread — on an idle 20-thread machine a 1-row Lookup commit measured
p50 2.8 us, p99 169 us, max 58 ms that way, against 1.4 us / 10 us / 0.12 ms when the committing thread ran the
burst itself. Hence the current design: a synchronous commit runs its own burst, and nothing on its path waits for
another thread to be scheduled. `DbWorkerCommitHandoffInterleavingTests` pins it (a busy worker thread, a worker
held in the tail of an asynchronous burst: both used to block the commit); `DbWorkerCommitStressTests` (opt-in,
`CONJUREDB_COMMIT_STRESS_SECONDS`) runs many frame threads, CPU noise and mid-flight disposal and fails on any
blocking commit over 100 ms that a control thread handoff measured at the same time does not explain.

### Parallel Secondary Index Processing

When one commit changes several tables, the client worker can synchronize their secondary indexes
concurrently. `WorkerConfiguration` (set with `DbConfiguration.Worker` or
`DbContextBuilder.WithWorkerConfiguration`) selects how:

| Setting | Default | Meaning |
|---|---|---|
| `IndexSyncExecution` | `DedicatedHelperThreads` | `Sequential`: every table on the thread running the burst, no extra thread. `DedicatedHelperThreads`: that thread plus ConjureDB-owned helper threads. |
| `IndexSyncHelperThreadCount` | `null` = `min(ProcessorCount - 1, 2)` | Helper threads (1..16 when explicit). The worker is always a participant, so the default engages at most three cores. One processor gives zero helpers: every cycle is sequential. |
| `MinOverlappableChangesForParallelSync` | 256 | A cycle runs in parallel only when the pending changes of every changed table *except the largest* reach this count. |

How a parallel cycle runs:

- The cycle's owner (the thread running the burst) orders the changed tables by pending changes, longest
  first, releases `min(helpers, tables - 1)` helper wake-ups, and claims tables itself. Every participant
  takes the next table with an interlocked increment, so a late helper never delays the cycle and the owner
  never blocks while work is unclaimed. When the owner runs out of tables it takes back every wake-up no
  helper has consumed yet (that helper has not started, and all the work is claimed), and then waits only for
  the helpers that did start, which are running their last table: the commit never waits for the operating
  system to schedule a parked helper. The owner parks for them on a semaphore the last helper releases; a
  yielding spin was measured and rejected (on an oversubscribed machine every yield requeues the owner behind
  every runnable thread: join p50 22 ms vs 2 us parked). The one cross-thread wait left on a synchronous commit is
  this join: a helper
  preempted in the middle of its table holds the commit until it is scheduled again (a table being synchronized
  cannot be taken over). It only happens in a cycle the overlappable work pays for, and on a saturated device it
  costs what a preemption of the committing thread itself costs. A host that wants no cross-thread wait at all on
  `Commit()` selects `IndexSyncExecution = IndexSyncExecutionMode.Sequential`.
- Helpers are started when the worker starts (a host without threads fails at initialization, not at the
  first large commit), park on a semaphore between cycles, are background threads, and are joined by
  `Dispose`. A cycle allocates nothing and uses no ThreadPool work item and no `Task`, including the first cycle a
  given helper joins (which one that is depends on scheduling): the index sync lock keeps no per-thread state, and
  the per-table failure slots are sized with the worker's table buffers, not at the first parallel cycle.
- One table's failure reaches the commit with its own type. If several fail, all are logged and a
  `SecondaryIndexValidationException` wins (it stops the worker); otherwise the longest table's failure is
  rethrown. Cancellation stops further claims; tables already claimed finish.
- The commit-phase diagnostics (`WorkerSyncAllocBytes`) include what the helper threads allocated.

**Default and when to choose `Sequential`.** The default is `DedicatedHelperThreads` with the 256-change threshold,
and the threshold is what keeps helpers off the frame path: a commit joins helpers only when the pending changes of
its changed tables *other than the largest* reach 256. A per-frame commit (a handful of rows, usually one or two
tables) is below it and runs sequentially on the committing thread, touching no helper and waiting on no thread.
Only large multi-table commits — typically load time, a save restore, a bulk import — go parallel, and those are the
commits where two or three cores cut the sync time 1.9-2.4x (feat-81).

A parallel commit's one cross-thread wait is the join with the helpers that started. Measured by
`DbWorkerCommitStressTests` (lane fix-86: 40 frame threads with a mix of small and bulk commits — the stress uses
thresholds of 1-49 changes so that many commits go parallel — plus 40 spinning threads on 20 logical CPUs, 10
minutes each):

| Extra load from other processes | Commits that joined helpers | Join p50 | p99 | p99.9 | max | Thread-handoff control p50 / p99 |
|---|---:|---:|---:|---:|---:|---|
| ~88% busy box | 31k of 439k | 2 us | 47 ms | 77 ms | 157 ms | 6 ms / 37 ms |
| a further 40 spinning threads | 13k of 338k | 2 us | 119 ms | 234 ms | 400 ms | 49 ms / 186 ms |

The tail is a helper preempted mid-table on a machine oversubscribed 4-6x, and it tracks the machine's own
thread-handoff latency measured alongside. No commit in either run waited for a burst another thread owned. On an
idle device the join is the remaining sync time of the helpers' last tables.

A host with a strict per-commit latency budget that also commits large multi-table transactions on the frame
thread — where even a load-time commit must not wait on another thread — selects
`IndexSyncExecution = IndexSyncExecutionMode.Sequential`: every commit then runs entirely on the committing thread,
and large commits take their full sequential sync time instead (1.9-2.4x longer). Raising
`MinOverlappableChangesForParallelSync` is the middle ground: helpers only for commits above the chosen size.

This is transparent to callers — the consistency guarantees remain identical: `Commit()` returns only after
every table of the version is synchronized, whichever thread synchronized it.

**Unity WebGL** has no threads: select `IndexSyncExecution = IndexSyncExecutionMode.Sequential` together with
`WorkerExecution = WorkerExecutionMode.Inline` (see [Worker thread](#worker-thread)).

#### Why not `Task.Run` / `Task.WaitAll`

The previous design queued one `Task` per heavy table and blocked the worker in `Task.WaitAll`. Measured
(lane feat-81, i7-12800H under processor affinity, .NET 8, Release; one transaction updates every row of
N tables; worker-sync phase median):

- It allocated a task array, a Task and a closure per table on every parallel cycle: +530..650 B for two
  tables, about +2 KB for eight. The dedicated helpers allocate nothing (process-wide delta vs sequential
  within measurement noise; the allocation test pins 0 B on the worker and helpers).
- At equal participant counts the two are at parity. Speedup over sequential on four P-cores:
  2 tables x 1k changes, three indexes: Task.Run 1.92x, one helper 1.89x; 8 x 10k: Task.Run 2.85x (it used
  every pool thread), two helpers 2.40x. On two P-cores both reach 1.7-1.9x for large work; on
  two P + two E cores two helpers reach 1.8-2.5x.
- With the ThreadPool kept busy by the host (ProcessorCount self-requeueing 1 ms work items), the tasks queue
  behind the host's work and `WaitAll` mostly runs them inline: Task.Run fell to sequential speed or below
  (2 x 10k on four cores: 29.4 ms vs sequential 26.2 ms) while two helpers kept their gain (18.4 ms).

Threshold. Waking and joining a helper costs about 10-25 us; the gain is the overlappable work's sync time.
Per-change sync cost depends on the index kinds (Lookup about 0.04 us, SortedSet about 0.5 us, Lookup +
SortedSet + Unique about 0.6 us per change on this machine), so a change-count threshold is a compromise:
at 256 the worst case for cheap indexes is one wake-up overhead lost, and expensive indexes below it miss at
most about 70 us. TODO(perf): weight pending changes by a measured per-table sync cost (an EWMA of
nanoseconds per change recorded around each table's sync, zero-alloc) and compare the overlappable
*time* with the wake-up cost. Closure: the probe (`ConjureDB.Benchmarks --index-sync-probe`) shows no
parallel cycle slower than sequential by more than the wake-up cost and no missed gain above it, across the
lookup/sorted/mixed profiles on 2P, 4P and 2P+2E masks, with the decision tests made deterministic by
injecting the cost table.

Raw data: `docs/benchmarks/runs/2026-09-25-index-sync-parallelism/`. Reproduce:
`dotnet run -c Release --project ConjureDB.Benchmarks -- --index-sync-probe --affinity 55 --label 4p`.

---

## Reactive Query Consistency

Reactive queries (`ReactiveQuery<TResult>`) maintain incrementally-updated materialized
views. Their consistency model has two modes:

### Direct Mode (Default)

The serialized background lane and readers share one container. Safe under the
**temporal separation contract**:
reads must not overlap with background synchronization cycles. In practice, this means
reading on the writing thread between frames (where the lane is idle) or after a commit returns.
Debug builds can assert the contract at runtime: set `CONJUREDB_REACTIVE_TEMPORAL_PROBE` to
`destructive` (fails on the overlaps that lose rows) or `throw` (fails on any overlap). The
nightly and release reactive-fuzz lanes run with it armed.

#### Commit completion boundary

A commit is complete only when the **entire** cycle for that version has finished — secondary-index
sync, materialized-view maintenance, reactive delta drain, and the synchronization-completion phase
that dispatches change notifications. `Commit()` returns and `CommitAsync()`'s task completes only
after that phase, so when control returns to the writer the lane owns nothing: reads are separated,
and the writer's next transaction cannot collide with in-flight reactive maintenance. This holds in
both runtime modes — Client mode runs the cycle on the background worker and releases the writer
afterwards; Server mode (and the Client-mode inline fast paths) runs the whole cycle, notification
included, on the committing thread.

This boundary is load-bearing, not a convenience. `StateChangeBuffer.Commit()` dispatches state
changes into the IVM maintainers **synchronously on the writing thread**, and the per-buffer delta
state those maintainers touch (touched-key sets, observed relation versions) is drained and cleared
by the background lane without a lock. If a commit released its writer before the lane finished,
the next transaction's dispatch would race that drain and silently drop touched keys — a lost
result row that survives until the same key is touched again.

Consequence: subscriber callbacks dispatched by the notification phase run *inside* the commit
window. A callback must not block on the completion of the commit that triggered it, and must not
start a new one — a commit issued from a notification callback is rejected with
`reactive-commit-from-notification-callback` instead of deadlocking.

A callback that throws does not abandon the boundary: notification failures are isolated per query,
every remaining query is still notified, and the collected failures are raised on
`DbContext.SynchronizationException` as a `ReactiveNotificationDispatchException`. They never fault
the commit — the data is already applied, and faulting the waiter would drive the commit path into
rolling back state the lane has already published.

### DoubleBuffered Mode

The serialized background lane mutates a back-buffer. On notification, front and back
buffers are atomically swapped under a lock:

```text
Background Execution Lane        Reader Thread
─────────────────────────        ─────────────
ApplyChanges()
  → mutate back-buffer
  → _hasPreparedBackSnapshot = true
  → _dirty = true (volatile)
                                  Current (property)
                                    → Volatile.Read(_frontSnapshot)
                                    → return front-buffer span
NotifyIfDirty()
  → read _dirty (volatile)
  → lock (_snapshotLock)
  → swap front ↔ back
  → _dirty = false
  → dispatch change events
```

The `_dirty` flag uses `volatile` with single-writer (background lane) / single-reader
(notification phase) semantics. `Interlocked` is unnecessary because the flag is
idempotent — racing writes all write `true`.

### Update Ordering

- Reactive queries update **after all secondary indices** for a version are synced.
- Multiple reactive queries for the same version see the same committed state.
- Update order within a single version is deterministic (registration order).

For reactive query lifecycle and subscription patterns, see
[Reactive Queries](/docs/advanced/reactive-queries).

---

## Memory Budget: Lock-Free Allocation Tracking

`MemoryBudget` tracks allocation pressure across threads using `Interlocked.CompareExchange`:

```csharp
// CAS loop — atomic check-and-update without locks
long current, newTotal;
do
{
    current = Volatile.Read(ref _totalAllocatedBytes);
    newTotal = current + bytes;
    if (newTotal > _budgetBytes) return false;
} while (Interlocked.CompareExchange(ref _totalAllocatedBytes, newTotal, current) != current);
```

This pattern is safe for arbitrary concurrent callers. The CAS loop retries only when
another thread modified `_totalAllocatedBytes` between the read and the exchange —
a rare event in practice.

Pressure level transitions use `Interlocked.Exchange` and fire events only on
actual level changes.

---

## Comparison with Traditional Databases

### Concurrency Model Comparison

| Feature | PostgreSQL (MVCC) | SQLite (WAL) | ConjureDB |
|---------|:-:|:-:|:-:|
| **Isolation** | Read Uncommitted – Serializable | Serializable | Read-committed (effective Serializable) |
| **Write concurrency** | Multiple writers | Single writer | Single writer |
| **Read concurrency** | Unlimited | Unlimited (WAL mode) | Point/value-owned routes; live borrows require temporal separation |
| **Locking mechanism** | Row/table/predicate locks | File/SHM locks | None (structural guarantee) |
| **Deadlocks** | Possible (detected + aborted) | Possible (timeout-based) | Impossible |
| **VACUUM / compaction** | Required (dead tuple cleanup) | Auto-checkpoint | Not needed |
| **Undo / redo log** | WAL + undo via tuple visibility | WAL | Journal (redo only) |
| **Version overhead per row** | xmin/xmax/cmin/cmax (24 bytes) | None (WAL frames) | None |
| **Snapshot isolation** | Full MVCC snapshots | Read transactions see snapshot | N/A — single writer |
| **Write amplification** | 2× (WAL + heap) | 2× (WAL + DB) | 1× (journal only) |

### Why No MVCC?

MVCC solves a problem ConjureDB does not have: concurrent writers needing to see
consistent snapshots while other writers modify data. With a single writer:

- **No version chains** — each entity exists exactly once, in the dense array.
- **No visibility checks** — each point reader sees the latest committed primary
  version; secondary and reactive readers observe their documented synchronized version.
- **No dead tuples** — removed entities are immediately reclaimed (dense array compaction).
- **No anti-wraparound vacuum** — no transaction ID space to exhaust.
- **No snapshot too old** errors.

The trade-off is clear: ConjureDB cannot support multiple concurrent writers. For game
clients with a single process and a single game loop, this is the correct trade-off.

---

## Error Handling and Recovery

### Transaction Conflicts

Transaction conflicts (write-write, read-write) are **impossible** in ConjureDB's
single-writer model. There is no `SERIALIZATION_FAILURE`, no retry logic, no conflict
resolution strategy needed.

### Unique Constraint Violations

The only "conflict" that can occur is a unique index constraint violation:

```csharp
db.BeginTransaction();
db.Players.Add(new Player { Id = 1, Username = "Alice" }); // OK
db.Players.Add(new Player { Id = 2, Username = "Alice" }); // ❌ SecondaryIndexValidationException
// Transaction is still active — caller can Rollback() or catch and continue
```

This is detected synchronously at `Add()` time via the dual-validation strategy
(pending keys + committed keys). The transaction remains active — the caller decides
whether to rollback or handle the error.

### Background Execution Failures

If the background execution lane encounters an exception during secondary index sync:

1. **First failure**: logged at Error level, the lane enters `Degraded` health state.
   The `TaskCompletionSource` for the affected version is faulted, unblocking
   `CommitAsync()` callers with the exception. The failed transaction is rolled back,
   and the lane continues accepting commits at that version. Inline/no-work advancement
   remains disabled until one serialized worker retry succeeds and returns the lane to
   `Healthy`.

2. **Consecutive failures** (≥ 3): the lane enters `Stopped` health state and stops
   accepting work.
   All pending `TaskCompletionSource` objects are drained with the last exception.

3. **`SecondaryIndexValidationException`**: the lane stops immediately (critical
   data integrity issue). The `WorkerHealthChanged` event fires.

Monitor worker health:

```csharp
db.WorkerHealthChanged += (sender, args) =>
{
    if (args.State == WorkerHealthState.Stopped)
    {
        Log.Critical("Worker stopped: {Error}", args.Exception);
        // Application-level recovery: restart, alert, or graceful shutdown
    }
};
```

`WorkerHealthChanged` runs on the worker lane (the worker thread, or the committing thread in
`Inline` mode), in the tail of the burst that failed or recovered, after that burst released
the scheduler. A callback may submit a recovery commit after a retryable failure: the new burst
runs nested on the lane thread instead of waiting for it. It must not synchronously dispose the
context: hand disposal off and execute it only after the callback returns. This keeps the
burst's callback-tail lifetime ahead of primitive teardown. The lane is one thread, so a
callback (or a logger provider) that blocks delays every later commit until it returns.

### Recovery After Crash

On startup, the recovery process:

1. Loads the latest snapshot (contains a version number).
2. Replays journal entries with `version > snapshotVersion`.
3. Discards incomplete transactions (missing `TransactionEnd` marker).

No torn pages are possible — journal entries are complete records. No lock recovery
is needed — there are no locks to clean up. See
[Persistence — Recovery](/docs/engine/persistence#recovery) for full details.

---

## Game-Specific Patterns

### Pattern 1: Frame-Based Write Batching

Batch all mutations into a single transaction per frame to minimize commit overhead
and ensure atomicity:

```csharp
// Unity MonoBehaviour — main thread only
void FixedUpdate()
{
    if (!_hasPendingChanges)
        return;

    using var tx = db.BeginScopedTransaction();

    ProcessPlayerInput(db);
    UpdateGameState(db);
    ApplyPhysicsResults(db);

    tx.Commit();
    _hasPendingChanges = false;
    // Commit() ran the burst (index sync, reactive maintenance) before returning
}
```

**Why this works:** `Commit()` runs its own burst on the game thread before it returns, so secondary
indices and reactive results are current for the rest of the frame, and the commit's latency is its
own CPU cost with no cross-thread hand-off.

### Pattern 2: Background Thread Reads

Reader threads can use point lookups and value-owned/snapshot-owned query results
after commit. Live/by-ref/no-sync compiled or primary borrows are caller-bound:
no writer mutation may overlap them, and they must be consumed before the next
mutation.

```csharp
// Network thread — point lookup is safe after commit
void OnServerRequest(int playerId)
{
    // Primary index: lock-free dense array access
    if (db.Players.TryFindById(playerId, out var player))
    {
        SendToServer(player);
    }
}

// UI thread — compiled query returns an owned result
void UpdateLeaderboard()
{
    var top10 = db.Players.GetTopPlayers(limit: 10);
    // Owned result from committed primary data; by-ref/no-sync variants are temporal-separation routes
    RefreshUI(top10);
}
```

### Pattern 3: Async Commit for Immediate Secondary Index Access

When you need to query a secondary index immediately after a mutation:

```csharp
// After adding a player to a guild, query guild members immediately
db.BeginTransaction();
db.Players.Update(playerId, player with { GuildId = guildId });

await db.CommitAsync();
// Secondary indices are now current — safe to query
var guildMembers = db.Players.GetIndex<int>().Find(guildId);
UpdateGuildUI(guildMembers);
```

### Pattern 4: Durable Purchases with Async Flush

For critical state changes (in-app purchases), wait for disk durability:

```csharp
db.BeginTransaction();
db.Players.Update(playerId, player with { Gems = player.Gems - price });
db.Inventory.Add(new InventoryItem { PlayerId = playerId, ItemId = itemId });

try
{
    await db.CommitAsync(forceFlush: true);
    // Data is on disk — safe to confirm to the player
    ShowPurchaseConfirmation();
}
catch
{
    db.Rollback();
    ShowPurchaseError();
    throw;
}
```

### Pattern 5: ECS Multi-System Reads

In an ECS architecture, systems can read concurrently through point or owned
results. A live `All` borrow remains caller-bound and must not overlap the writer.
Only one system should write per frame:

```csharp
// Movement system — READ ONLY on the owning frame thread for the live All borrow
void UpdateMovement(float deltaTime)
{
    foreach (var entity in db.Entities.All)
    {
        if (entity.HasVelocity)
            UpdatePosition(entity, deltaTime);
    }
}

// Damage system — WRITE (main thread only, single transaction)
void ProcessDamageQueue()
{
    if (damageQueue.Count == 0) return;

    using var tx = db.BeginScopedTransaction();
    while (damageQueue.TryDequeue(out var damage))
    {
        var entity = db.Entities.FindById(damage.TargetId);
        db.Entities.Update(damage.TargetId, entity with
        {
            Health = Math.Max(0, entity.Health - damage.Amount)
        });
    }
    tx.Commit();
}
```

### Pattern 6: Reactive Queries for UI Updates

Use reactive queries instead of polling — they update automatically after commit, so
the UI always reflects the latest committed state.

**Concurrency guarantee:** subscriber callbacks fire in the burst's notification phase (on the
committing thread for `Commit()`, on the worker thread for `CommitAsync()`) *after* it has applied the version's deltas and synced all
secondary indices, so a reactive-query consumer never observes a partially-synced or
uncommitted state. The update is delivered once per affecting commit — no polling
loop is needed.

For defining queries, accessing the materialized view, and the subscription modes
(`Subscribe` / `SubscribeSpan` / `SubscribeChanged`), see
[Reactive Queries — Quick Start](/docs/advanced/reactive-queries#quick-start) and
[Subscription Modes](/docs/advanced/reactive-queries#subscription-modes).

---

## Best Practices

### Do

1. **Keep transactions short** — one transaction per frame, with all mutations batched.
   Long transactions block subsequent `BeginTransaction()` calls.

2. **Designate one writer thread** — typically the game main thread. All mutations
   must happen on this thread. Do not share write access across threads.

3. **Prefer `CommitAsync()` on async call sites** — both forms return only after the burst
   finished the version (secondary indices, reactive maintenance, and notification), so both
   are equally fresh. `Commit()` runs that burst on the calling thread; `CommitAsync()` yields it
   to the worker thread. Never commit from inside a reactive notification callback: the callback runs inside the
   commit window, so the nested commit is rejected with
   `reactive-commit-from-notification-callback`.

4. **Use `CommitAsync(forceFlush: true)` for critical data** — purchases, account
   state, anything where data loss is unacceptable.

5. **Use `TransactionScope` for exception safety** — the `ref struct` RAII wrapper
   guarantees rollback if `Commit()` is not called before the scope exits.

6. **Use reactive queries instead of polling** — they are updated automatically after
   each commit and avoid redundant re-queries.

7. **Monitor worker health** — subscribe to `WorkerHealthChanged` to detect and
   respond to synchronization failures.

### Don't

1. **Don't hold transactions across frames** — this blocks subsequent writes and
   prevents the worker from processing commits.

2. **Don't call `BeginTransaction()` from multiple threads** — there is no locking.
   Concurrent calls will corrupt internal state.

3. **Don't mutate outside a transaction** — `Add()`, `Update()`, `Remove()` without
   an active transaction enqueues changes that cannot be committed properly.

4. **Don't read secondary indices from another thread while a commit is in flight** —
   `Commit()` and `CommitAsync()` return with indices current, but a concurrent reader has
   no such boundary. Read after the commit returns.

5. **Don't block lane callbacks** — reactive notifications and synchronization-completion
   callbacks run serially in the burst; for `Commit()` that is the committing (game) thread.
   Long-running handlers extend the commit.

6. **Don't subscribe/unsubscribe inside event handlers** — `EventDispatcher` callbacks
   fire under a lock. Calling `Subscribe()` or `Dispose()` from within causes deadlock.
   See [Transactions — Common Pitfalls](/docs/engine/transactions#common-pitfalls).

---

## Diagnostics and Monitoring

### Checking Worker Status

```csharp
// Is the worker running?
bool running = db.IsWorkerRunning;

// Are there unprocessed commits?
bool pending = db.HasPendingCommits();

// Current worker health
WorkerHealthState health = db.WorkerHealth;

// Last worker exception (if degraded/stopped)
Exception? lastError = db.WorkerHealth == WorkerHealthState.Healthy
    ? null
    : /* access via WorkerHealthChanged event args */;
```

### Version Monitoring

```csharp
// Current committed version
ulong version = db.Version;

// Active transaction version (writer thread only)
ulong activeVersion = db.ActiveTransactionVersion;

// Is a transaction in progress?
bool inTransaction = db.IsTransactionInStarted;
```

### Performance Metrics

On .NET 6+, ConjureDB records index sync duration via `ConjureDBMetrics.IndexSyncDurationMs`
(histogram). Use this to detect background synchronization latency spikes that might
indicate:

- Buffer overflow risk (too many changes per commit)
- Secondary index rebuild cost (too many indices)
- Reactive query maintenance cost for complex materialized-view shapes

---

## Glossary

| Term | Definition |
|------|-----------|
| **Dense array** | Contiguous array in `PrimaryIndex` storing entities without gaps. Enables cache-friendly iteration and lock-free point reads. |
| **Sparse index** | Integer array mapping entity IDs to dense array positions. O(1) lookup. |
| **CommitBuffer** | Cache-line padded ring buffer for single-producer/single-consumer inter-thread state change transport. |
| **StateChangeBuffer** | Typed wrapper around `CommitBuffer<StateChange<T>>` with rollback support and event dispatching. |
| **SynchronizedIndex** | Secondary index container that applies changes from the `CommitBuffer` under a write lock. |
| **Background execution lane** | Serialized reusable work-item lane that processes committed versions sequentially: sync indices → reactive queries → journal. |
| **Temporal separation** | Contract where readers and writers access shared state at non-overlapping times, eliminating the need for locks. |
| **PaddedInt** | 64-byte struct ensuring a single `int` field occupies an entire cache line to prevent false sharing. |
| **Version** | Monotonically increasing `ulong` counter incremented on each successful commit. |

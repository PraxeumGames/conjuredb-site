# Concurrency Control

How ConjureDB manages concurrent access to data — a reference for game
developers who need to understand what is safe, what is not, and why.

**See also:** [Transactions](/docs/engine/transactions) · [Reactive Queries](/docs/advanced/reactive-queries) ·
[Persistence](/docs/engine/persistence) · [Database Engine](/docs/engine/database-engine)

> **Relationship with Transactions.md:**
> [Transactions](/docs/engine/transactions) covers the transaction lifecycle, commit variants,
> rollback semantics, durability guarantees, and API reference.
> This page focuses on the *concurrency model* — thread interactions, synchronization
> primitives, isolation semantics, index consistency, and safe usage patterns for
> multi-threaded game architectures.

---

## Overview

ConjureDB uses a **single-writer / multi-reader** concurrency model:

- **One writer thread** — all mutations (`Add`, `Update`, `Remove`) happen inside
  transactions on a single designated thread (typically the game main thread).
- **Multiple reader threads** — any thread can read committed data from the primary
  index without blocking.
- **One background worker thread** — processes committed transactions, synchronizes
  secondary indices, applies reactive query deltas, and writes journal entries.

There are **no traditional locks on the write path**. Concurrency is achieved through
structural separation: the writer thread and the worker thread communicate via lock-free
ring buffers with volatile signaling. Readers access the primary index through a dense
array that is always safe for concurrent reads.

### Design Rationale

Game clients run in a single process with a predictable threading model:

| Thread | Role | Typical Source |
|--------|------|----------------|
| Main thread (60 fps) | Game logic, mutations | Unity `Update()` / `FixedUpdate()` |
| Worker thread | Index sync, journal writes | ConjureDB internal |
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
- **No deadlocks** — impossible by construction
- **No lock contention** — readers never block writers, writers never block readers
- **Zero-allocation** on the hot path — no `Monitor.Enter`, no `SemaphoreSlim` acquire

---

## Concurrency Architecture

```
Main Thread (writer)                   Worker Thread (background)
┌──────────────────────────┐           ┌──────────────────────────────────┐
│ BeginTransaction()       │           │ Wait on ManualResetEventSlim    │
│                          │           │                                  │
│ Add / Update / Remove    │           │                                  │
│   ↓ immediate on         │           │                                  │
│   PrimaryIndex (dense    │           │                                  │
│   array, no locks)       │           │                                  │
│   ↓ enqueue StateChange  │           │                                  │
│   into CommitBuffer      │           │                                  │
│   (ring buffer)          │           │                                  │
│                          │           │                                  │
│ Commit()                 │           │                                  │
│   ↓ advance commitStart  │           │                                  │
│   ↓ dispatch events      │           │                                  │
│   ↓ Version = N+1        │           │                                  │
│   ↓ Volatile.Write       │           │                                  │
│     (_commitVersion)     │           │                                  │
│   ↓ _commitEvent.Set()   ├──signal──→│ Wake up                         │
│                          │           │   ↓ Volatile.Read(_commitVersion)│
│ Read primary index ✅    │           │   ↓ for each version:            │
│ (always current)         │           │     SyncIndex (write lock)       │
│                          │           │     SyncReactiveQueries          │
│                          │           │     TransactionEnd (journal)     │
│                          │           │     Volatile.Write               │
│                          │           │       (_lastProcessedVersion)    │
│                          │           │     CompletePendingTasks (TCS)   │
│                          │           │   ↓ _commitEvent.Reset()         │
└──────────────────────────┘           └──────────────────────────────────┘
        ▲                                          ▲
        │ safe reads (any thread)                   │
   ┌────┴─────────┐                                 │
   │ Reader       │   FindById / TryFindById /      │
   │ Threads      │   Contains / Count / All()      │
   │              │   (dense array, lock-free)       │
   │              │                                  │
   │              │   Secondary index queries ───────┘
   │              │   (safe after worker sync)
   └──────────────┘
```

### Inter-Thread Communication

The main thread and worker thread communicate through two mechanisms:

1. **`CommitBuffer<T>` (ring buffer)** — carries `StateChange<T>` records from the
   writer to the worker. Uses cache-line padded indices (`PaddedInt`, 64-byte aligned)
   and `Volatile.Read`/`Volatile.Write` for lock-free producer-consumer semantics.

2. **`ManualResetEventSlim`** — the worker blocks on this event when idle. `Commit()`
   signals the event to wake the worker. The worker resets it after processing all
   pending versions.

3. **`Volatile` version counters** — `_commitVersion` (written by main thread) and
   `_lastProcessedVersion` (written by worker) use `Volatile.Read`/`Volatile.Write`
   because `ulong` is not supported by the C# `volatile` keyword.

---

## Isolation Level

ConjureDB provides **read-committed** isolation, achieved structurally rather than
through locks or MVCC:

| Property | Guarantee | Mechanism |
|----------|-----------|-----------|
| **No dirty reads** | Readers never see uncommitted data | Committed data published via `Volatile.Write` on version; `CommitBuffer.commitStart` advances only on commit |
| **No lost updates** | Impossible — only one writer | Single-writer serialization by caller contract |
| **No write-write conflicts** | Impossible — only one writer | No concurrent transactions |
| **No deadlocks** | Impossible — no locks on write path | Structural guarantee |
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
| Writer thread, outside transaction | Latest committed state | Same as any reader |
| Any other thread, primary index | Latest committed state | Dense array reads are always safe |
| Any other thread, secondary index | Last-synced committed state | May lag by one transaction until worker catches up |
| Reactive query consumer | Last-notified committed state | Updated after worker applies deltas and notifies |

---

## Version Tracking and Ordering

Every successful commit increments a monotonic `ulong` version counter:

```
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
| **Worker thread** | `_commitVersion`, `_lastProcessedVersion` | Sequential processing — never skips a version |
| **Journal** | `ChangeRecord.Version` | Recovery replays `version > snapshotVersion` |
| **Snapshot** | Header version | Identifies the snapshot's logical point in time |
| **Reactive queries** | `ReactiveQuery.Version` | Tracks which database version the materialized view reflects |
| **`HasPendingCommits()`** | Compares committed vs. processed | Determines if worker has unprocessed versions |

### Ordering Guarantees

- Versions are **strictly monotonic** — no gaps, no reuse.
- `Rollback()` does **not** consume a version number.
- The worker processes versions **in order** — version N is fully processed
  (secondary indices synced, reactive queries updated, journal written) before
  version N+1 begins.
- `CommitAsync()` returns only after the worker has processed the specific version.

For detailed version lifecycle and `CommitAsync` semantics, see
[Transactions — Version Tracking](/docs/engine/transactions#version-tracking).

---

## Thread Safety Reference

### Operation Safety Matrix

| Operation | Thread Safety | Notes |
|-----------|:---:|-------|
| `FindById(id)` | ✅ Any thread | Dense array lookup, no synchronization needed |
| `TryFindById(id, out entity)` | ✅ Any thread | Same as `FindById` |
| `Contains(id)` | ✅ Any thread | Sparse-to-dense index check |
| `Count` | ✅ Any thread | Single `int` field read |
| `All` / `AsMemory` | ✅ Any thread | Returns `ReadOnlyMemory<T>` over contiguous storage |
| `IsTransactionInStarted` | ✅ Any thread | `Volatile.Read` provides cross-thread visibility |
| `Version` | ✅ Any thread | `Volatile.Read` on `ulong` |
| `HasPendingCommits()` | ✅ Any thread | Checks `ManualResetEventSlim.IsSet` |
| Compiled query execution (read-only) | ✅ Any thread | Reads only from primary index |
| Secondary index query (after sync) | ✅ Any thread | Protected by `ReaderWriterLockSlim` |
| `ReactiveQuery<T>.Current` | ✅ Any thread | Direct mode: temporal separation; DoubleBuffered: front-buffer snapshot |
| `BeginTransaction()` | ❌ Writer only | No locking — concurrent calls corrupt state |
| `Add` / `Update` / `Remove` / `Upsert` | ❌ Writer only | Must be within an active transaction |
| `Commit()` | ❌ Writer only | Advances version, signals worker |
| `CommitAsync()` | ❌ Writer only | Internal `SemaphoreSlim` serializes the async wait |
| `Rollback()` | ❌ Writer only | Traverses change buffer in reverse |

### Primary Index: Why Reads Are Lock-Free

The primary index (`PrimaryIndex<T>`) uses a dense array with a sparse id-to-index
mapping:

```
Sparse index:  [_, 0, _, 2, 1, _, ...]   (id → dense index)
Dense array:   [Entity1, Entity4, Entity3] (contiguous storage)
```

- **Reads** access the sparse array to resolve the dense index, then read from the
  dense array. Both are plain array accesses — no locks, no `Volatile`, no fences.
- **Writes** modify both arrays, but are serialized on the writer thread by the
  transaction model. A concurrent reader may observe a partially-written entity
  only if the entity type contains reference fields that are updated non-atomically.
  For value-type-only entities (the common case in games), reads are always consistent.
- **Enumeration** via `All` / `AsMemory` returns a `ReadOnlyMemory<T>` slice of the
  dense array. The count may lag by one operation mid-transaction, but callers outside
  the writer thread only see committed state.

### Secondary Index: Synchronized Access

Secondary indices are updated by the background worker thread after commit.
They use a `ReaderWriterLockSlim` (`_syncLock`) with two roles:

1. **Write lock** — held during `SyncIndex()` (main thread lazy sync) and
   `WorkerSync()` (background worker). Prevents concurrent mutation of the
   secondary index data structures.

2. **Monitor lock** — used for read-read mutual exclusion on aggregation index
   partials and enumerator lifetime management.

When you query a secondary index:

```csharp
// On any thread — safe after worker has synced
var items = db.Items.GetIndex<int>().Find(categoryId);
```

The query internally calls `SyncIndex()` which either:
- Returns immediately if no pending changes exist, or
- Acquires the write lock and applies pending changes before returning.

If the worker holds the write lock, `SyncIndex()` waits for the worker to finish
(via `ManualResetEventSlim` with a 100ms write-lock timeout) rather than blocking
indefinitely.

### Unique Index: Dual-Validation Strategy

Unique secondary indices (`UniqueIndex<TKey>`) use a two-layer validation approach
to detect duplicates at `Add()` time, before the worker has synced:

1. **`ConcurrentDictionary<TKey, int> _pendingKeys`** — thread-safe set of keys that
   have been validated but not yet committed to the synchronized lookup. Checked first.

2. **`Dictionary<TKey, int> _lookup`** — committed keys, protected by
   `_syncLock.TryEnterReadLock(0)`. If the worker holds the write lock, the read-lock
   attempt is skipped — the worker's own `AddInternal` will catch any duplicate as a
   fail-safe.

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
| `volatile bool` | `ReactiveQuery._dirty` | Single-writer/single-reader dirty-state flag between worker and notification threads |
| `PaddedInt` (64-byte struct) | `CommitBuffer` | Cache-line padding to prevent false sharing between producer and consumer indices |
| `ManualResetEventSlim` | `DbWorker._commitEvent` | Worker thread sleep/wake signaling |
| `ReaderWriterLockSlim` | `SynchronizedIndex._syncLock` | Protects secondary index data during sync; allows concurrent readers |
| `SemaphoreSlim(1, 1)` | `DbContext._commitLock` | Serializes concurrent `CommitAsync()` calls |
| `ConcurrentDictionary<TKey, int>` | `UniqueIndex._pendingKeys` | Thread-safe pending key tracking for unique constraint validation |
| `Interlocked.CompareExchange` | `MemoryBudget` | Lock-free CAS loop for atomic memory allocation tracking |
| `TaskCompletionSource<bool>` | `DbWorker._pendingTasks` | Async completion signaling for `CommitAsync()` callers |

### Why Not Traditional Locks?

| Traditional Approach | ConjureDB Alternative | Why |
|---------------------|----------------------|-----|
| `lock (obj)` on writes | Single-writer contract | No contention possible — zero overhead |
| `ReaderWriterLock` on primary index | Dense array reads + single-writer writes | Reads are plain array access — no synchronization needed |
| `Mutex` for transactions | `InvalidOperationException` if re-entered | Fail-fast instead of blocking |
| Lock-free CAS on data structures | `Volatile` + ring buffer | Simpler, sufficient for single-producer/single-consumer |

---

## CommitBuffer: Lock-Free Ring Buffer

The `CommitBuffer<T>` is the core inter-thread communication mechanism. It is a
bounded single-producer / single-consumer ring buffer using cache-line padded indices:

```
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

```
CommitBuffer full: waited 100000 spins (~100 ms).
Buffer capacity=64, pending=63. Worker thread may be blocked or buffer capacity is insufficient.
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

```
  Main Thread                            Worker Thread
  ──────────                             ─────────────
  1. Add(entity)
     → PrimaryIndex.Add() [immediate]
     → StateChangeBuffer.Enqueue()
     → UniqueIndex.ValidateAdd()
       (ConcurrentDictionary check)

  2. Commit()
     → CommitBuffer.Commit()
       (advance commitStart)
     → Worker signaled
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
| `Commit()` returns | ✅ Updated | ⏳ Pending | ⏳ Pending | ⏳ Pending |
| Worker completes sync | ✅ Updated | ✅ Updated | ✅ Updated | ✅ Buffered |
| `CommitAsync()` returns | ✅ Updated | ✅ Updated | ✅ Updated | ⏳ Pending flush |
| `CommitAsync(forceFlush: true)` returns | ✅ Updated | ✅ Updated | ✅ Updated | ✅ Flushed |

### Parallel Secondary Index Processing

When the worker configuration enables parallel processing
(`ParallelProcessingEnabled = true`), the worker partitions secondary index sync work:

- **Light sets** (pending changes < `MinPendingChangesForParallel`): processed
  sequentially on the worker thread.
- **Heavy sets** (pending changes ≥ threshold): processed in parallel via `Task.Run`,
  with `Task.WaitAll` synchronization.

This is transparent to callers — the consistency guarantees remain identical.

---

## Reactive Query Consistency

Reactive queries (`ReactiveQuery<TResult>`) maintain incrementally-updated materialized
views. Their consistency model has two modes:

### Direct Mode (Default)

Worker and readers share one container. Safe under the **temporal separation contract**:
reads must not overlap with worker sync cycles. In practice, this means reading on the
main thread between frames (where the worker is idle) or after `CommitAsync()` returns.

### DoubleBuffered Mode

Worker mutates a back-buffer. On notification, front and back buffers are atomically
swapped under a lock:

```
Worker Thread                     Reader Thread
─────────────                     ─────────────
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

The `_dirty` flag uses `volatile` with single-writer (worker) / single-reader
(notification thread) semantics. `Interlocked` is unnecessary because the flag is
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
| **Read concurrency** | Unlimited | Unlimited (WAL mode) | Unlimited |
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
- **No visibility checks** — every reader sees the same (latest committed) version.
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

### Worker Thread Failures

If the background worker encounters an exception during secondary index sync:

1. **First failure**: logged at Error level, worker enters `Degraded` health state.
   The `TaskCompletionSource` for the affected version is faulted, unblocking
   `CommitAsync()` callers with the exception.

2. **Consecutive failures** (≥ 3): worker enters `Stopped` health state and exits.
   All pending `TaskCompletionSource` objects are drained with the last exception.

3. **`SecondaryIndexValidationException`**: worker stops immediately (critical data
   integrity issue). The `WorkerHealthChanged` event fires.

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
    // Worker thread syncs secondary indices in background
}
```

**Why this works:** One commit per frame means one worker wake-up per frame. The worker
processes the version between frames, so secondary indices are current by the next
`FixedUpdate()`.

### Pattern 2: Background Thread Reads

Any thread can safely read from the primary index:

```csharp
// Network thread — reads are always safe
void OnServerRequest(int playerId)
{
    // Primary index: lock-free dense array access
    if (db.Players.TryFindById(playerId, out var player))
    {
        SendToServer(player);
    }
}

// UI thread — compiled queries are read-only
void UpdateLeaderboard()
{
    var top10 = leaderboardQuery.Execute(db);
    // Always sees committed data — never dirty reads
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

In an ECS architecture, multiple systems can read concurrently. Only one system
should write per frame:

```csharp
// Movement system — READ ONLY (any thread)
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

Use reactive queries instead of polling — they update automatically after commit:

```unimem
// Define a reactive query (compiled at build time)
reactive query PlayerInventory(player_id: int) -> InventoryRow[] =
    from Items
    | filter OwnerId == @player_id
    | select { Name = Name, Quantity = Quantity, Rarity = Rarity }
```

```csharp
// Access the materialized view (once)
var inventoryQuery = db.PlayerInventory(playerId: localPlayerId);

// Subscribe to changes
inventoryQuery.SubscribeSpan(items =>
{
    // Called after each commit that affects the Items table
    RefreshInventoryUI(items);
});
```

Reactive queries eliminate the need for manual polling loops and ensure the UI always
reflects the latest committed state. See [Reactive Queries](/docs/advanced/reactive-queries) for
full details.

---

## Best Practices

### Do

1. **Keep transactions short** — one transaction per frame, with all mutations batched.
   Long transactions block subsequent `BeginTransaction()` calls.

2. **Designate one writer thread** — typically the game main thread. All mutations
   must happen on this thread. Do not share write access across threads.

3. **Use `CommitAsync()` when you need secondary index freshness** — `Commit()` returns
   before secondary indices are updated. If you query a secondary index immediately
   after, use `CommitAsync()` to wait for the worker.

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

4. **Don't assume secondary indices are current after `Commit()`** — they are updated
   asynchronously. Use `CommitAsync()` if you need them immediately.

5. **Don't block the worker thread** — event handlers dispatched during `Commit()`
   run synchronously. Long-running handlers delay the worker and increase the
   consistency window.

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
(histogram). Use this to detect worker thread latency spikes that might indicate:

- Buffer overflow risk (too many changes per commit)
- Secondary index rebuild cost (too many indices)
- Reactive query maintenance cost for complex materialized-view shapes

---

## Glossary

| Term | Definition |
|------|-----------|
| **Dense array** | Contiguous array in `PrimaryIndex` storing entities without gaps. Enables cache-friendly iteration and lock-free reads. |
| **Sparse index** | Integer array mapping entity IDs to dense array positions. O(1) lookup. |
| **CommitBuffer** | Cache-line padded ring buffer for single-producer/single-consumer inter-thread state change transport. |
| **StateChangeBuffer** | Typed wrapper around `CommitBuffer<StateChange<T>>` with rollback support and event dispatching. |
| **SynchronizedIndex** | Secondary index container that applies changes from the `CommitBuffer` under a write lock. |
| **Worker thread** | Background thread that processes committed versions sequentially: sync indices → reactive queries → journal. |
| **Temporal separation** | Contract where readers and writers access shared state at non-overlapping times, eliminating the need for locks. |
| **PaddedInt** | 64-byte struct ensuring a single `int` field occupies an entire cache line to prevent false sharing. |
| **Version** | Monotonically increasing `ulong` counter incremented on each successful commit. |

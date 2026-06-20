# Transactions

ConjureDB uses monotonically-versioned ACID transactions with a single-writer /
multi-reader concurrency model. This page is the authoritative reference for
transaction semantics, durability guarantees, and performance characteristics.

**See also:** [Concurrency Control](/docs/engine/concurrency) · [Persistence](/docs/engine/persistence) · [Reactive Queries](/docs/advanced/reactive-queries) · [Navigation Editors](/docs/advanced/navigation-editors)

---

## Transaction Model

ConjureDB follows an **optimistic, single-writer** transaction design:

| Property | Guarantee |
|----------|-----------|
| **Atomicity** | All mutations in a transaction commit or none do. Rollback reverses every change. |
| **Consistency** | Primary-key uniqueness and FK integrity (via code-gen) are enforced before commit. |
| **Isolation** | Single-writer eliminates write–write conflicts by construction. Readers see the latest committed state or in-flight primary-index mutations on the writer thread. |
| **Durability** | Configurable — from in-memory-only to journal-flushed-to-disk. See [Durability Guarantees](#durability-guarantees). |

There is no MVCC snapshot isolation. Reads always see the most recent committed
(or, on the writer thread, uncommitted) primary-index state. This is acceptable
for the target domain (game clients with a single logical writer) and eliminates
version-chain overhead.

### Comparison with Other Systems

| Feature | ConjureDB | SQLite | PostgreSQL |
|---------|-----------|--------|------------|
| Concurrency | Single writer, lock-free readers | Single writer (WAL mode: concurrent readers) | MVCC, multiple writers |
| Isolation level | Read-committed (effective) | Serializable | Read committed – Serializable |
| Nested transactions | Not supported | Savepoints | Savepoints |
| Version tracking | Monotonic `ulong` | Internal WAL frame counter | 32-bit xid / 64-bit xid8 |
| Locking | None (structural guarantee) | File locks / SHM locks | Row-level / predicate locks |

---

## Transaction Lifecycle

### State Machine

```
                 ┌──────────────┐
                 │   IDLE       │
                 │ Version = N  │
                 └──────┬───────┘
                        │ BeginTransaction()
                        ▼
                 ┌──────────────┐
                 │   ACTIVE     │
                 │ ActiveVer    │
                 │   = N + 1    │
                 └──┬───────┬───┘
         Commit()   │       │  Rollback()
                    ▼       ▼
           ┌────────────┐ ┌─────────────┐
           │  COMMITTED │ │ ROLLED BACK │
           │ Version=N+1│ │ Version = N │
           └────────────┘ └─────────────┘
                 │               │
                 └───────┬───────┘
                         ▼
                 ┌──────────────┐
                 │   IDLE       │
                 └──────────────┘
```

### Step-by-Step

1. **`BeginTransaction()`** — Transitions from IDLE to ACTIVE. Sets
   `ActiveTransactionVersion = Version + 1`. Throws
   `InvalidOperationException` if a transaction is already active.

2. **Mutations** — `Add()`, `Update()`, `Remove()`, `Upsert()` on any `DbSet<T>`.
   Each mutation enqueues a `StateChange<T>` into the table's `StateChangeBuffer<T>`,
   applies the change to the primary index immediately, and defers secondary-index
   updates until commit finalization.

3. **`Commit()`** — Atomically finalizes all buffered changes. It stages every
   modified table buffer, dispatches synchronous change events, waits for worker
   synchronization, rolls back staged primary changes if finalization fails before
   publication, advances `Version`, and clears transaction state.

4. **`Rollback()`** — Reverts all pending changes:
   - Traverses the change buffer **in reverse order** and undoes each
     mutation on the primary index.
   - Resets `ActiveTransactionVersion` back to `Version`.
   - Clears transaction state.

### Basic Example

```csharp
context.BeginTransaction();

context.Players.Add(new Player { Id = 1, Name = "Alice", Level = 10 });
context.Players.Update(2, new Player { Id = 2, Name = "Bob", Level = 20 });
context.Items.Remove(42);

context.Commit();
// Version incremented; secondary indices are synchronized for this version
```

---

## TransactionScope (Recommended)

`TransactionScope` is a zero-allocation `ref struct` that provides RAII-style
transaction management. If `Commit()` is not called before the scope exits,
`Dispose()` automatically calls `Rollback()`.

```csharp
using var tx = context.BeginScopedTransaction();

context.Players.Add(new Player { Id = 1, Name = "Alice" });
context.Orders.Add(new Order { Id = 100, PlayerId = 1 });

tx.Commit(); // If this line is not reached, all changes are rolled back.
```

### Exception-Safe Mutations

```csharp
using var tx = context.BeginScopedTransaction();

try
{
    context.Players.Add(player);
    ValidateBusinessRules(player); // may throw
    tx.Commit();
}
catch (ValidationException ex)
{
    // tx.Dispose() is called by `using` → automatic Rollback()
    Log.Error("Validation failed: {Message}", ex.Message);
}
```

### Async Limitation

`TransactionScope` is a `ref struct` — it **cannot** be used across `await`
boundaries. For async commit scenarios, use the manual
`BeginTransaction()` / `CommitAsync()` pattern:

```csharp
context.BeginTransaction();
context.Purchases.Add(purchase);

try
{
    await context.CommitAsync(forceFlush: true);
}
catch
{
    // CommitAsync rolls back staged changes before rethrowing when finalization fails.
    throw;
}
```

---

## Commit vs CommitAsync

ConjureDB provides three commit variants with different durability and
blocking semantics:

| Method | Blocks Until | Primary Index | Secondary Indices | Journal Flush | Use Case |
|--------|-------------|---------------|-------------------|---------------|----------|
| `Commit()` | Worker finishes | ✅ Immediate after success | ✅ Complete | ⏳ Async | Synchronous mutation flow |
| `CommitAsync()` | Worker finishes | ✅ Immediate after success | ✅ Awaited | ⏳ Async | Async mutation flow |
| `CommitAsync(forceFlush: true)` | Worker + journal flush | ✅ Immediate | ✅ Awaited | ✅ Awaited | Critical state (purchases) |

### `Commit()` — Synchronous Finalization

Applies changes to primary indices, stages the commit buffers, waits for worker
synchronization, then publishes the new version. If worker synchronization or
journaling fails before publication, ConjureDB rolls back the staged primary
changes, rebuilds synchronized indices from primary state, and rethrows.

```csharp
context.BeginTransaction();
context.Players.Add(player);
context.Commit();
// Returns after secondary indices are current for the published version
```

**When to use:** Synchronous flows where the caller wants a committed version
or an exception with no partially published transaction.

### `CommitAsync()` — Wait for Secondary Indices

Returns a `Task` that completes when the background worker has synchronized
all secondary indices for this transaction version. It uses the same staged
publish/rollback contract as `Commit()`. Serialized via an internal
`SemaphoreSlim` (`_commitLock`) — multiple concurrent `CommitAsync()` calls
are safe but will serialize.

```csharp
context.BeginTransaction();
context.Players.Add(new Player { Id = 1, GuildId = 5 });
await context.CommitAsync();
// Secondary indices are now current — safe to query
var guildMembers = context.Players.GetIndex<int>().Find(5);
```

**When to use:** Async mutation flows and callers that should not block a
thread while waiting for worker completion.

### `CommitAsync(forceFlush: true)` — Wait for Disk Durability

Additionally waits for the journal to flush all pending writes to disk.
This is the strongest durability guarantee.

```csharp
context.BeginTransaction();
context.Players.Update(player.Id, playerWithPurchase);
await context.CommitAsync(forceFlush: true);
// Data is on disk — safe to confirm "purchase complete" to the user
```

**When to use:** After purchases, account-linking, or any state change where
data loss is unacceptable. Only effective when journaling is enabled —
otherwise data reaches disk only at the next snapshot.

---

## Rollback Semantics

### Automatic Rollback (TransactionScope)

```csharp
using var tx = context.BeginScopedTransaction();
context.Players.Add(player);
// No tx.Commit() → Dispose() calls Rollback()
```

### Manual Rollback

```csharp
context.BeginTransaction();
context.Players.Add(player);
context.Rollback(); // All changes reverted
```

### Rollback Operations

Rollback traverses the change buffer **in reverse order** and applies the
inverse operation on the primary index:

| Original Operation | Rollback Action |
|-------------------|-----------------|
| `Add(entity)` | Remove the entity from the primary index |
| `Update(id, newValue)` | Restore the entity to its `OldItem` value |
| `Remove(id)` | Re-insert the removed entity |

### What Rollback Does NOT Do

- **Secondary indices** — pending, uncommitted changes are not applied. If commit
    finalization fails after a staged sync begins, synchronized indices are rebuilt
    from the rolled-back primary state before the exception returns.
- **Version increment** — `Version` is not advanced. It stays at the
  pre-transaction value.
- **Journal entries** — nothing is written. The journal only records
  committed transactions.
- **Subscriber notifications** — no change events are dispatched.

---

## Version Tracking

Every transaction is assigned a monotonically increasing `ulong` version.

```csharp
var v0 = context.Version;           // e.g., 42

context.BeginTransaction();
var active = context.ActiveTransactionVersion;  // 43
context.Players.Add(player);
context.Commit();

var v1 = context.Version;           // 43
Debug.Assert(v1 == v0 + 1);
```

### Where Versions Are Used

| Consumer | How Version Is Used |
|----------|-------------------|
| **Journal** | Each `ChangeRecord` carries the transaction version. Recovery replays only `version > snapshotVersion`. |
| **Snapshot** | The snapshot header records the version at capture time. |
| **Worker thread** | Processes versions sequentially to maintain ordered secondary index updates. |
| **Reactive queries** | `ReactiveQuery<T>.Version` tracks which database version the materialized view reflects. |
| **`HasPendingCommits()`** | Returns `true` if the worker has not yet processed the latest version. |

### Version Invariants

- Versions are **strictly monotonic** — no gaps, no reuse.
- `Rollback()` does **not** consume a version number.
- `Version` is updated atomically during `Commit()`.
- `ActiveTransactionVersion` is visible only on the writer thread.

---

## Thread Safety

### Concurrency Model: Single-Writer, Multi-Reader

ConjureDB uses a cooperative concurrency model optimized for game clients:

```
Main Thread (writer, 60 fps)            Worker Thread (background)
┌─────────────────────────┐             ┌──────────────────────────┐
│ BeginTransaction()      │             │                          │
│ Add / Update / Remove   │             │ Wait for commit signal   │
│ Commit()                │──signal────>│ Sync secondary indices   │
│                         │             │ Write journal entries     │
│ Read primary index ✅   │             │ Signal completion         │
│ (always current)        │             │ Take snapshots            │
│                         │             │                          │
│ Read secondary index ✅ │<───done─────│ (after worker finishes)  │
│ (after CommitAsync)     │             │                          │
└─────────────────────────┘             └──────────────────────────┘
        ▲
        │ safe reads from any thread
   ┌────┴────┐
   │ Reader  │  FindById / TryFindById / Contains / Count / All()
   │ Threads │  (primary index is lock-free for reads)
   └─────────┘
```

### Thread Safety Matrix

| Operation | Thread Safety | Notes |
|-----------|--------------|-------|
| `FindById`, `TryFindById`, `Contains`, `Count` | ✅ Any thread | Primary index uses dense array with atomic-friendly access |
| `All()` enumeration | ✅ Any thread | Snapshot enumeration |
| `BeginTransaction()` | ❌ Writer thread only | No locking — concurrent calls corrupt state |
| `Add`, `Update`, `Remove`, `Upsert` | ❌ Writer thread only | Must be within an active transaction |
| `Commit()` | ❌ Writer thread only | |
| `CommitAsync()` | ❌ Writer thread only | Internal semaphore serializes the async wait |
| `Rollback()` | ❌ Writer thread only | |
| `IsTransactionInStarted` | ✅ Any thread | Uses `Volatile.Read/Write` for safe cross-thread visibility |
| Secondary index queries | ✅ Any thread | Safe after the worker has processed the version |

### CommitAsync Serialization

`CommitAsync()` acquires `_commitLock` (a `SemaphoreSlim`). Multiple concurrent
calls are serialized. The `TaskCompletionSource` uses
`RunContinuationsAsynchronously` to prevent deadlocks from synchronous
continuations.

---

## Nested Transactions

Nested transactions are **not supported**. Calling `BeginTransaction()` while
a transaction is already active throws `InvalidOperationException`:

```csharp
context.BeginTransaction();
context.BeginTransaction();  // ❌ InvalidOperationException: "Transaction already started"
```

### Workaround: Logical Grouping

If you need savepoint-like semantics, partition your mutations into
separate sequential transactions:

```csharp
// Transaction 1: Create player
using (var tx = context.BeginScopedTransaction())
{
    context.Players.Add(player);
    tx.Commit();
}

// Transaction 2: Create inventory (can fail independently)
using (var tx = context.BeginScopedTransaction())
{
    context.Inventories.Add(new Inventory { PlayerId = player.Id });
    tx.Commit();
}
```

---

## Durability Guarantees

Changes progress through multiple stages before reaching persistent storage.
Each stage provides a stronger durability guarantee:

| Stage | Trigger | Survives Process Crash | Survives Device Reboot |
|-------|---------|----------------------|----------------------|
| Primary index (in-memory) | `Commit()` | ❌ | ❌ |
| Secondary indices (in-memory) | Worker thread sync | ❌ | ❌ |
| Journal buffer (in-memory) | Worker calls `TransactionEnd(version)` | ❌ | ❌ |
| Journal file (on disk) | Adaptive flush (100 ms – 5 s) | ✅ | ✅ |
| Journal forced flush | `CommitAsync(forceFlush: true)` | ✅ | ✅ |
| Snapshot (on disk) | Periodic (default 5 min) or threshold | ✅ | ✅ |

### Durability Window

Between `Commit()` and the next journal flush, there is a **durability window**
where committed transactions exist only in memory. The size of this window
depends on:

- **Adaptive flush interval** (100 ms – 5 s, based on write throughput)
- **Battery status** (flush may be deferred on low battery)
- **`forceFlush` parameter** (eliminates the window entirely)

For critical data, always use `CommitAsync(forceFlush: true)`:

```csharp
// Non-critical: daily quest progress (acceptable to lose last few seconds)
context.BeginTransaction();
context.Quests.Update(questId, updatedQuest);
context.Commit();

// Critical: in-app purchase (must survive crash)
context.BeginTransaction();
context.Purchases.Add(purchase);
context.Inventory.Add(purchasedItem);
await context.CommitAsync(forceFlush: true);
```

### Recovery Behavior

On startup, the recovery process:

1. Loads the latest snapshot.
2. Replays journal entries with `Version > snapshotVersion`.
3. Discards incomplete transactions (missing `TransactionEnd` marker).

See [Persistence — Recovery](/docs/engine/persistence#recovery) for full details.

---

## Error Handling During Commit

### Commit Error Path

If an error occurs during `Commit()`:

1. **State validation** — `InvalidOperationException` if no transaction active.
2. **Buffer staging** — Each changed table stages its commit buffer for the
   active version.
3. **Worker finalization** — Secondary indices, reactive coordination, and
   journal transaction-end processing complete for the staged version.
4. **Publication** — `Version` advances only after worker finalization succeeds.

If worker finalization fails before publication, ConjureDB rolls back the staged
primary-index mutations, clears the staged buffers, rebuilds synchronized
indices from primary state, resets `ActiveTransactionVersion`, and rethrows the
original exception. The failed transaction is not published.

### CommitAsync Error Handling

```csharp
context.BeginTransaction();
context.Players.Add(player);

try
{
    await context.CommitAsync(forceFlush: true, cancellationToken);
}
catch (OperationCanceledException)
{
    // Cancellation is honored before commit reaches worker finalization.
    // Once finalization starts, the commit runs to success or terminal failure.
}
catch (Exception ex)
{
    // The transaction was not published if finalization failed before Version advanced.
    Log.Error("CommitAsync failed: {Error}", ex);
}
```

---

## Performance Characteristics

### Commit Cost Breakdown

| Phase | Cost | Allocations |
|-------|------|-------------|
| Buffer iteration | O(changed tables) | Zero |
| Per-table commit | O(changes in table) | Zero (ring buffer) |
| Event dispatch | O(subscribers × changes) | Zero (in-delegate) |
| Worker synchronization | Variable (depends on secondary index count) | Zero |
| Version update | O(1) | Zero |
| **Total `Commit()`** | **O(total changes)** | **Zero** |

### CommitAsync Additional Cost

| Phase | Cost | Allocations |
|-------|------|-------------|
| Semaphore acquire | O(1) | Zero (cached) |
| TaskCompletionSource | O(1) | 1 allocation (pooled on .NET 6+) |
| Worker wait | Variable (same finalization work as `Commit()`) | Zero |
| Journal flush | Variable (depends on buffer size + I/O) | Zero |

### Throughput Benchmarks (Typical)

| Scenario | Operations/sec | Notes |
|----------|---------------|-------|
| Single Add + Commit | ~2,000,000 | Primary index only, no persistence |
| Batch 100 Adds + Commit | ~500,000 txn/s | 50M entity writes/sec |
| Single Add + CommitAsync | ~200,000 | Includes secondary index sync |
| Single Add + CommitAsync(forceFlush) | ~5,000–50,000 | Depends on I/O device |

---

## Common Pitfalls

### 1. Mutations Outside a Transaction

Calling `Add()`, `Update()`, or `Remove()` without an active transaction enqueues
changes that cannot be committed or rolled back properly. **Always** wrap
mutations in a transaction.

```csharp
// ❌ Wrong — mutations without transaction
context.Players.Add(player);
context.Commit(); // InvalidOperationException

// ✅ Correct
context.BeginTransaction();
context.Players.Add(player);
context.Commit();
```

### 2. Forgetting to Commit

An open transaction blocks subsequent `BeginTransaction()` calls.
Use `TransactionScope` to prevent this:

```csharp
// ❌ Dangerous — if DoWork() throws, transaction stays open forever
context.BeginTransaction();
DoWork(context);
context.Commit();

// ✅ Safe — auto-rollback on any exception
using var tx = context.BeginScopedTransaction();
DoWork(context);
tx.Commit();
```

### 3. Choosing Between Commit() and CommitAsync()

Both `Commit()` and `CommitAsync()` wait until secondary indices are current
for the published version. Choose `CommitAsync()` when you need the same
consistency contract without blocking the calling thread:

```csharp
context.BeginTransaction();
context.Players.Add(new Player { Id = 1, GuildId = 5 });
context.Commit();
var guildMembers = context.Players.GetIndex<int>().Find(5);

context.BeginTransaction();
context.Players.Add(new Player { Id = 2, GuildId = 5 });
await context.CommitAsync();
var updatedGuildMembers = context.Players.GetIndex<int>().Find(5);
```

### 4. Buffer Overflow in Large Transactions

The `StateChangeBuffer<T>` is a fixed-capacity ring buffer (default 64 entries).
If a transaction exceeds capacity and the worker cannot drain fast enough,
a backpressure exception fires:

```
InvalidOperationException: CommitBuffer full: waited 100000 spins (~100 ms).
Buffer capacity=64, pending=63. Worker thread may be blocked or buffer capacity is insufficient.
```

**Solutions:**
- Break large mutations into multiple smaller transactions.
- Increase buffer capacity via the `table Name(..., capacity: N)` option.
- Increase the spin limit via `CommitBuffer<T>(capacity, spinLimit)`.

### 5. Subscribing/Unsubscribing Inside a Handler

Change event handlers fire synchronously during `Commit()` under the
`EventDispatcher` lock. Calling `Subscribe` or `Dispose` from within a
handler causes a deadlock:

```csharp
// ❌ Deadlock — Dispose() tries to acquire the dispatcher lock
context.Players.Subscribe(change =>
{
    subscription.Dispose(); // DEADLOCK
});
```

### 6. Using TransactionScope Across Await

```csharp
// ❌ Compilation error — ref struct cannot cross await boundary
using var tx = context.BeginScopedTransaction();
await SomeAsyncOperation();
tx.Commit();

// ✅ Use manual API for async scenarios
context.BeginTransaction();
try
{
    await SomeAsyncOperation();
    await context.CommitAsync();
}
catch
{
    context.Rollback();
    throw;
}
```

---

## Compiled Mutations

The `mutation` system automatically wraps all statements in a
`TransactionScope`. You do not need to manage transactions manually:

```prql
mutation DeductGold(playerId: int, amount: int) {
    update Players
    | filter Id == @playerId and Gold >= @amount
    | set Gold = Gold - @amount
}
```

The generated code opens a scoped transaction, executes the write pipeline, and
commits. If any statement throws, the entire mutation is rolled back
automatically. Mutations are declared in a `.conjure` schema and the generator
emits a method on the target entity's set (returning the affected-row count), so
you invoke them as `context.Players.DeductGold(playerId, amount)`.

See [Compiled Mutations](/docs/query-language/mutations) for full details.

---

## Disposal and Shutdown

`DbContext.Dispose()` performs a best-effort wait (up to 2 seconds) for pending
commits to flush before shutting down the worker thread and persistence layer.

```csharp
// Graceful shutdown
using var context = builder.Build();
// ... use context ...
// Dispose() flushes pending commits, stops worker, closes files
```

### Shutdown Sequence

1. Wait up to 2 seconds for the worker to process pending versions.
2. Flush the journal buffer to disk.
3. Stop the worker thread.
4. Dispose persistence resources (file handles, streams).

### Active Transaction at Disposal

If a transaction is still active at disposal time, it is **not** automatically
committed or rolled back. Always finalize transactions before disposing:

```csharp
// ❌ Dangerous — open transaction at disposal
context.BeginTransaction();
context.Players.Add(player);
context.Dispose(); // Transaction state is undefined

// ✅ Safe — use TransactionScope
using var tx = context.BeginScopedTransaction();
context.Players.Add(player);
tx.Commit();
context.Dispose();
```

---

## Patterns and Recipes

### Batch Import with Progress

```csharp
const int batchSize = 50;
var items = GetLargeDataset();

for (int i = 0; i < items.Length; i += batchSize)
{
    using var tx = context.BeginScopedTransaction();

    var batch = items.AsSpan(i, Math.Min(batchSize, items.Length - i));
    foreach (var item in batch)
        context.Items.Add(item);

    tx.Commit();
    ReportProgress(i + batch.Length, items.Length);
}
```

### Conditional Commit (Validate-Then-Commit)

```csharp
using var tx = context.BeginScopedTransaction();

var player = context.Players.FindById(playerId);
var newGold = player.Gold - cost;

if (newGold < 0)
    return PurchaseResult.InsufficientFunds; // auto-rollback

context.Players.Update(playerId, player with { Gold = newGold });
context.Inventory.Add(new InventoryItem { PlayerId = playerId, ItemId = itemId });

tx.Commit();
return PurchaseResult.Success;
```

### Reward Distribution with Error Recovery

```csharp
using var tx = context.BeginScopedTransaction();

try
{
    foreach (var playerId in eligiblePlayers)
    {
        var player = context.Players.FindById(playerId);
        context.Players.Update(playerId, player with
        {
            Gold = player.Gold + rewardAmount,
            LastRewardTime = DateTime.UtcNow
        });
    }

    tx.Commit();
    Log.Info("Distributed rewards to {Count} players", eligiblePlayers.Count);
}
catch (Exception ex)
{
    // Auto-rollback via TransactionScope — no player receives partial reward
    Log.Error("Reward distribution failed: {Error}", ex);
    throw;
}
```

### Durable Purchase Flow

```csharp
context.BeginTransaction();

// Deduct currency
var player = context.Players.FindById(playerId);
context.Players.Update(playerId, player with { Gems = player.Gems - price });

// Grant item
context.Inventory.Add(new InventoryItem
{
    PlayerId = playerId,
    ItemId = itemId,
    AcquiredAt = DateTime.UtcNow
});

// Record purchase for analytics
context.PurchaseLog.Add(new PurchaseRecord
{
    PlayerId = playerId,
    ItemId = itemId,
    Price = price,
    Timestamp = DateTime.UtcNow
});

// Wait for disk durability before confirming to the player
await context.CommitAsync(forceFlush: true);
ShowConfirmation("Purchase complete!");
```

---

## Quick Reference

### API Summary

| Method | Returns | Description |
|--------|---------|-------------|
| `BeginTransaction()` | `void` | Opens a transaction. Throws if one is already active. |
| `BeginScopedTransaction()` | `TransactionScope` | Returns a zero-alloc RAII scope. |
| `Commit()` | `void` | Synchronous commit — waits for worker finalization before publishing `Version`. |
| `CommitAsync(bool forceFlush, CancellationToken ct)` | `Task` | Async commit — waits for secondary indices (+ optional flush). |
| `Rollback()` | `void` | Reverts all pending changes. |
| `IsTransactionInStarted` | `bool` | Whether a transaction is currently active. |
| `Version` | `ulong` | Last committed version. |
| `ActiveTransactionVersion` | `ulong` | Current in-flight version (writer thread only). |
| `HasPendingCommits()` | `bool` | Whether the worker has unprocessed versions. |

### Decision Matrix

| Scenario | API to Use |
|----------|-----------|
| Synchronous mutation flow | `Commit()` |
| Async mutation flow needing current secondary indices | `CommitAsync()` |
| Critical state (purchases, account) | `CommitAsync(forceFlush: true)` |
| Any mutation block | `BeginScopedTransaction()` + `tx.Commit()` |
| Async mutation flow | Manual `BeginTransaction()` + `CommitAsync()` |
| Large batch import | Multiple small transactions with `TransactionScope` |

# Reactive Queries

Reactive queries are public subscription facades over Z-set materialized
state. Supported shapes are lowered to named materialized views or hidden
compiler-owned `ReactiveAutoView` relations/indexes and update automatically
when underlying data changes. Instead of re-executing the source query on
every commit, supported maintainers apply O(changes) delta operations to the
existing result. Shapes outside the current maintainer matrix fail before
emission with typed diagnostics.

**See also:** [Transactions](/docs/engine/transactions) · [PGO](/docs/performance/pgo) · [Navigation Editors](/docs/advanced/navigation-editors) · [Query Language](/docs/query-language/reference)

---

## Overview

### Schema-First Materialized Views

The new schema-first materialization path is based on `materialized view`
declarations and Z-set deltas. A materialized view is a derived in-memory
relation over source-of-truth base tables; it does not have persistence,
`type_id`, `schema_version`, WAL entries, snapshots, TTL, or cache semantics.

Reactive queries over materialized views read and subscribe through the same
materialized relation or materialized index slice used by ordinary compiled
queries. That materialized facade is the reactive execution contract:
generated reactive code reads maintained Z-set relation/index state and must
not emit non-materialized reactive execution code.

Reactive queries over ordinary tables or virtual views do not require users to
hand-declare a materialized view just to get incremental behavior. If the query
shape is supported by the Z-set maintainer matrix, the schema binder creates an
internal hidden materialized view with origin `ReactiveAutoView`. It is private
compiler-owned state: it has no persistence, no public schema name, no WAL or
snapshot metadata, and no `DbSet<T>`. The reactive query reads/subscribes to
that hidden relation or index, and ordinary compiled queries can reuse the same
hidden state when their typed normalized body is proven equivalent and the
materialized access is costed as cheaper than the base plan or exactly matches a
maintained index. Failed equivalence proof is not an error; the ordinary query
keeps its base-table plan.

Explain/debug output makes hidden reuse explicit with the hidden view id,
`origin: ReactiveAutoView`, `visibility: Internal`, `ownerReactiveQuery`, and
`rewriteSource: ReactiveAutoView` or `rewriteSource: NamedAutoRewrite`, plus the
proof kind, selected/base cost, and selected relation/index access. Shapes that
are not covered by the Z-set maintainer matrix fail with a typed compiler
diagnostic before emission.

### The Problem

One-shot query execution evaluates the source pipeline on each call:

```
Commit() -> Query executes source pipeline -> Result
```

For a 10,000-row table queried 60 times/second, this means 600,000 row
evaluations per second — most of which are wasted because only a few rows
changed.

### The IVM Solution

Reactive queries subscribe to data changes and apply **incremental deltas**:

```
Commit() → Z-set maintenance → O(changes) updates → Result (always current)
```

For supported shapes on the same 10,000-row table with 5 changes per frame,
this drops to 300 evaluations per second — a **2000x reduction**.

### Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                    Compile-Time (Code Generation)                     │
│                                                                      │
│  DSL Query ──> Hidden/Named Materialized View ──> Z-set Plan         │
│                (ReactiveAutoView or user MV)       + Index Selection │
└─────────────────────────────────────┬────────────────────────────────┘
                                      │ Generated C# code
                                      v
┌──────────────────────────────────────────────────────────────────────┐
│                    Runtime (Delta Application)                        │
│                                                                      │
│  Commit() ──> Base-table ZDelta ──> MaterializedRelation.Apply      │
│                                  ──> Materialized Indexes           │
│                                  ──> Reactive facade buffers        │
│                                                                      │
│  Subscribers:  Subscribe() / SubscribeSpan() / SubscribeChanged()    │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Quick Start

### 1. Define a Reactive Query

```text
reactive query TopPlayersByGuild(guild_id: int) -> Player[] =
    from Players
    | filter GuildId == @guild_id
    | sort -Level
    | take 10
    | select { Name = Name, Level = Level }
```

### 2. Access the Materialized View

```csharp
var view = context.TopPlayersByGuild(guildId: 5);

// Read current results (zero-copy span)
ReadOnlySpan<PlayerView> topPlayers = view.Current;
foreach (var p in topPlayers)
    Console.WriteLine($"{p.Name}: Level {p.Level}");

// Subscribe to changes
view.Subscribe(snapshot =>
{
    // Called automatically when Players table changes
    RefreshUI(snapshot.Span);
});
```

### 3. Results Update Automatically

```csharp
context.BeginTransaction();
context.Players.Update(playerId, player with { Level = player.Level + 1 });
context.Commit();
// view.Current now reflects the level-up — no re-query needed
```

---

## Subscription Modes

ConjureDB provides three subscription modes optimized for different use cases:

### `Subscribe(ChangeHandler<ReadOnlyMemory<T>>)` — Snapshot Mode

Receives an immutable memory snapshot after each delta application. Safe to
store and read from any thread.

```csharp
view.Subscribe(snapshot =>
{
    // snapshot is a ReadOnlyMemory<T> — immutable, thread-safe
    UpdateLeaderboardUI(snapshot);
});
```

**Use when:** You need to pass the result to another thread (e.g., render
thread), or store it for later comparison.

### `SubscribeSpan(SpanChangeHandler<T>)` — Zero-Allocation Mode

Receives an ephemeral `ReadOnlySpan<T>`. No allocation — the span points
directly into the result container's backing array.

```csharp
view.SubscribeSpan(span =>
{
    // span is only valid during this callback — do NOT store it
    for (int i = 0; i < span.Length; i++)
        RenderRow(i, span[i]);
});
```

**Use when:** Performance is critical (game loop, 60 fps). Main thread only.

### `SubscribeChanged(ReactiveQueryChangedHandler<T>)` — Delta Mode

Receives both the delta payload (what changed) and the current snapshot.

```csharp
view.SubscribeChanged(changes =>
{
    if (changes.IsReset)
    {
        RebuildUI(changes.Current);
        return;
    }

    // Incremental UI update
    foreach (var change in changes.Changes)
    {
        switch (change.Action)
        {
            case ReactiveChangeAction.Add:
                InsertRow(change.NewItem);
                break;
            case ReactiveChangeAction.Remove:
                RemoveRow(change.EntityId);
                break;
            case ReactiveChangeAction.Replace:
                UpdateRow(change.EntityId, change.NewItem);
                break;
        }
    }
});
```

**Use when:** You need to know what specifically changed (e.g., animate
additions/removals in a list view).

### Subscription Comparison

| Mode | Allocation | Thread Safety | Change Details | Best For |
|------|-----------|---------------|---------------|----------|
| `Subscribe` | 1 copy (Memory) | ✅ Cross-thread | ❌ Snapshot only | Multi-threaded consumers |
| `SubscribeSpan` | Zero | ❌ Main thread only | ❌ Snapshot only | Game loop (60 fps) |
| `SubscribeChanged` | 1 copy (Memory) | ✅ Cross-thread | ✅ Delta + snapshot | Animated UI |

---

## Plan Classification

At compile time, the compiler classifies each reactive query's physical plan
to determine the most efficient delta handling strategy. Classification is
a **structural ratchet** — the system picks the most incremental strategy
that the query shape supports.

### Classification Hierarchy

The compiler automatically selects the best update strategy based on the query shape.

| Query Shape | Update Strategy | Stateful |
|-------------|----------------|----------|
| Filter + Project | Stateless filter+project | ❌ |
| Sort + Take (TopK) | Sorted top-K with overflow | ✅ |
| Distinct | Reference-counting | ✅ |
| Scalar Aggregate | Singleton materialized aggregate state | ✅ |
| Grouped Aggregate | Per-group accumulators, including HAVING-style visibility | ✅ |
| Join | Materialized arrangements for inner/left/right/full/semi/anti equijoins, including supported connected graph and alias-scoped self-join provenance shapes | ✅ |
| Row-number TopK window | Partitioned TopK state for bounded `row_number <= K` windows | ✅ |
| Union All | Independent branch maintainers | ✅ |
| Set operations | Counted dual-branch state for `union`, `intersect`, and `except` variants | ✅ |
| Subqueries | Compiler metadata exists; executable paths require decorrelation to a supported materialized maintainer | — |
| Unsupported shapes | Compile-time diagnostic | — |

---

## Delta Handling

Each supported query shape is lowered to a Z-set materialized maintainer. The
following table summarizes how source changes are applied to materialized
relation/index state:

| Query Shape | Add | Remove | Update | Notes |
|-------------|-----|--------|--------|-------|
| Filter + Project | Apply filter → add to result | Remove by entity ID | Re-evaluate filter; add/remove/update accordingly | Stateless, O(1) per change |
| TopK | Sorted insert into maintained state | Remove + promote from overflow | Remove + re-insert (position may change) | Overflow buffer backs evicted items |
| Distinct | Increment refcount; visible when count = 1 | Decrement refcount; removed when count = 0 | Decrement old + increment new | Reference-counting based |
| Aggregate (scalar) | Update singleton accumulator | Update singleton accumulator | Remove old + add new | Empty input keeps one scalar result row |
| Aggregate (grouped) | Update group accumulators | Remove group when count = 0, unless HAVING only hides it | Update group accumulators | Per-group tracking plus counted ordered extrema for `min`/`max` |
| Join | Probe/update materialized arrangements | Remove old join rows and unmatched outer rows as needed | Remove old + probe/add new | Inner, left, right, full, semi, and anti equijoins |
| Row-number TopK window | Insert candidate into partitioned ordered state | Remove candidate and diff partition top-K | Remove old + add new | Requires one partition key, deterministic sort, and a positive literal row-number bound |
| Union All | Independent per-branch maintenance | Independent per-branch maintenance | Independent per-branch maintenance | One maintainer per branch |
| Set operations | Update branch counts and emit visible multiplicity diff | Update branch counts and emit visible multiplicity diff | Remove old branch row + add new branch row | `union`, `intersect`, `intersect all`, `except`, and `except all` preserve set/bag semantics |

---

## Materialized Facade Buffers

Reactive queries expose `ReactiveQuery<T>` as a public facade over maintained
materialized relation/index state. Slice buffers replay the current relation or
index slice into a result container during `SyncReactiveQueries()`; supported
paths do not execute the original source pipeline at query time.

---

## Incrementalization Support

At compile time, the compiler reports whether each reactive query supports
incremental updates:

| Verdict | Meaning | Compile-Time Action |
|---------|---------|-------------------|
| `Incremental` | Fully incrementalizable | Generate hidden/named materialized relation maintenance |
| `Unsupported` | No supported Z-set materialized maintainer exists for this shape | Compile-time rejection with a typed diagnostic |

Use the `ReactiveQueryDiagnostics` API to inspect incrementalization decisions
at runtime (see [Diagnostics](#diagnostics-and-observability)).

---

## Supported and Unsupported Operators

### Fully Supported (Incremental)

| DSL Operator | Delta Pattern |
|-------------|--------------|
| `from Table` | Base-table Z-delta source |
| `filter Predicate` | Stateless conditional |
| `select Projection` | Stateless transform |
| `sort ...` + bounded `take N` | TopK with maintained ordered state |
| bounded `row_number` window | Partitioned TopK state for `sort | window(row_number) | filter row_number <= K | select` |
| `distinct` | Refcount-based |
| scalar `count`, `sum`, `avg`, `min`, `max` | Singleton materialized aggregate state |
| grouped `count`, `sum`, `avg`, `min`, `max` | Per-group accumulator fields plus counted ordered extrema state |
| `join Table (condition)` | Materialized arrangement maintenance for inner, left, right, full, semi, and anti equijoins |
| `union all` | Independent branch maintainers |
| `union` | Dual-branch counted set state with set semantics |
| `intersect`, `intersect all` | Dual-branch counted set state with set/bag intersection semantics |
| `except`, `except all` | Dual-branch counted set state with set/bag difference semantics |

### Conditional or Unsupported in This Release

| Operator | Caveat |
|----------|--------|
| `take` (without deterministic `sort`) | Requires a supported deterministic ordering proof; otherwise rejected |
| Subqueries | Expression-level subqueries are classifier/proof metadata in this release. A query is executable only when the subquery has already been lowered into an explicit supported relational operator shape, such as semi/anti join or grouped aggregate; residual expression-level subquery filters are rejected before emission |

### Unsupported

These operators do not have an executable Z-set maintainer in this release and
fail with a typed compiler diagnostic:

| Operator | Reason |
|----------|--------|
| Unbounded or unranked window functions (`rank`, `dense_rank`, arbitrary frames, unbounded `row_number`) | No bounded partitioned TopK maintainer |
| Join chains beyond the current single-join materialized maintainer | Requires a generalized join-graph materialized maintainer across capability analysis, runtime state, and generated maintenance code |
| Correlated scalar residuals | Non-FK correlation |

---

## Strict vs Permissive Mode

### Strict Performance Mode

`ReactiveCompilationMode.StrictPerformance` is a compiler/emission setting, not an attribute.

In strict mode, any query outside the maintainer matrix is **rejected at
compile time** with an `EmissionException`. This ensures that all reactive
queries in the application are guaranteed to be maintained through Z-set
materialized state.

```
// Compilation error in strict mode:
// error UM6011: Reactive query 'RankedPlayers' is not supported by the
// current Z-set reactive maintainer matrix.
```

### Permissive Mode (Default)

Permissive mode still publishes diagnostic capability metadata for analysis,
but unsupported reactive roots still fail before emission. Generated reactive
code is not produced without a supported materialized maintainer.

### Choosing a Mode

| Scenario | Recommended Mode |
|----------|-----------------|
| Game UI (60 fps) | Strict — no unsupported maintainer shapes in hot path |
| Analytics dashboard | Permissive — richer diagnostics while unsupported shapes are implemented |
| Development/prototyping | Permissive — faster iteration |

---

## Performance Characteristics

### IVM vs Full Query Re-Execution

| Table Size | Changes/Commit | Full Query Re-Execution | IVM Delta | Speedup |
|-----------|---------------|-------------|-----------|---------|
| 1,000 | 1 | ~50 us | ~1 us | ~50x |
| 1,000 | 5 | ~50 us | ~5 us | ~10x |
| 10,000 | 1 | ~500 us | ~1 us | ~500x |
| 10,000 | 20 | ~500 us | ~20 us | ~25x |
| 100,000 | 1 | ~5 ms | ~1 us | ~5000x |
| 100,000 | 100 | ~5 ms | ~100 us | ~50x |

### Cost Model

| Operation | Time Complexity | Space Complexity |
|-----------|----------------|-----------------|
| SFP delta (per change) | O(1) | O(result size) |
| TopK delta (per change) | O(log K) | O(K + overflow) |
| Distinct delta (per change) | O(1) amortized | O(distinct values) |
| Aggregate delta (per change) | O(1) | O(groups) |
| Join delta (per change) | O(matches) | O(result + index) |
| Full query re-execution | O(N) | O(result size) |

### Memory Overhead

Each reactive query maintains or reuses:

- **Materialized relation** — consolidated positive Z-set rows
- **Materialized index state** — declared or synthesized access paths
- **Result container** — proportional to visible result size
- **Delta buffer** — pooled, reused across frames
- **Join arrangements** — proportional to arranged source keys for join maintainers

---

## ReactiveQuery<T> API Reference

```csharp
public class ReactiveQuery<T>
{
    // Current materialized result
    ReadOnlySpan<T> Current { get; }

    // Database version this result reflects
    long Version { get; }

    // Optional keyed lookup when the underlying container supports it
    bool TryGetByEntityId(int entityId, out T result);

    // Subscription methods
    IDisposable Subscribe(ChangeHandler<ReadOnlyMemory<T>> handler);
    IDisposable SubscribeSpan(SpanChangeHandler<T> handler);
    IDisposable SubscribeChanged(ReactiveQueryChangedHandler<T> handler);

    // Execution priority (affects scheduling)
    ReactiveQueryPriority Priority { get; }
    void SetPriority(ReactiveQueryPriority newPriority);

    // Runtime diagnostic snapshot
    ReactiveQueryDiagnostics GetDiagnostics();
}
```

### Priority Levels

| Priority | Frame Budget | Use Case |
|----------|-------------|----------|
| `Critical` | Immediate (within commit) | Active UI panel |
| `Normal` | Within frame budget | Visible but not primary |
| `Background` | Deferred | Off-screen or analytics |

Priority can be driven by PGO hints — see [PGO — Reactive Query PGO Hints](/docs/performance/pgo#reactive-query-pgo-hints).

---

## Examples

### Example 1: Live Inventory View

```text
reactive query PlayerInventory(player_id: int) -> InventoryRow[] =
    from Items
    | filter OwnerId == @player_id
    | select { Name = Name, Quantity = Quantity, Rarity = Rarity }
    | sort -Rarity, Name
    | take 50
```

```csharp
var inventory = context.PlayerInventory(playerId: currentPlayer.Id);

// Initial render
RenderInventoryGrid(inventory.Current);

// Auto-update on item changes
inventory.SubscribeSpan(items =>
{
    // Called when items are added, removed, or modified
    // Only the changed items are processed internally — O(changes)
    RenderInventoryGrid(items);
});

// When player picks up an item:
context.BeginTransaction();
context.Items.Add(new Item
{
    OwnerId = currentPlayer.Id,
    Name = "Legendary Sword",
    Quantity = 1,
    Rarity = 5
});
context.Commit();
// inventory.Current is already updated — UI refreshes via subscription
```

### Example 2: Dashboard Counters

```text
reactive query GuildStats() -> GuildStatsRow[] =
    from Players
    | group (GuildId) (aggregate {
        MemberCount = count(),
        AverageLevel = avg(Level)
    })
```

```csharp
var guildStats = context.GuildStats();

guildStats.Subscribe(_ =>
{
    var current = guildStats.Current.First(x => x.GuildId == myGuild.Id);
    memberCountLabel.Text = $"Members: {current.MemberCount}";
    avgLevelLabel.Text = $"Avg Level: {current.AverageLevel:F1}";
});

// The grouped aggregate row updates through the Z-set materialized facade.
```

### Example 3: Real-Time Leaderboard

```text
reactive query TopPlayers() -> LeaderboardRow[] =
    from Players
    | join Guilds g (GuildId == g.Id)
    | sort -Level, Name
    | take 100
    | select { Name = Name, Level = Level, GuildName = g.Name }
```

```csharp
var leaderboard = context.TopPlayers();

leaderboard.SubscribeChanged(changes =>
{
    if (changes.IsReset)
    {
        leaderboardUI.Rebuild(changes.Current);
        return;
    }

    // Common: animate individual changes
    foreach (var change in changes.Changes)
    {
        switch (change.Action)
        {
            case ReactiveChangeAction.Add:
                leaderboardUI.AnimateInsert(change.NewItem);
                break;
            case ReactiveChangeAction.Remove:
                leaderboardUI.AnimateRemove(change.EntityId);
                break;
            case ReactiveChangeAction.Replace:
                leaderboardUI.AnimateMove(change.EntityId, change.NewItem);
                break;
        }
    }
});
```

### Example 4: Parameterized Bounded Reactive Query

```text
reactive query ActiveQuestsWithRewards(player_id: int) -> QuestRow[] =
    from Quests
    | filter PlayerId == @player_id
    | filter IsActive
    | select { QuestName = QuestName, Progress = Progress, TargetProgress = TargetProgress }
    | sort -Progress
    | take 20
```

```csharp
var activeQuests = context.ActiveQuestsWithRewards(playerId);

// The hidden ReactiveAutoView stores the non-parameterized source shape.
// The player filter, order, and limit are applied through the materialized
// read facade, not by scanning the source table at query time.
```

---

## Diagnostics and Observability

### ReactiveQueryDiagnostics

```csharp
var diag = view.GetDiagnostics();

Console.WriteLine($"Result count: {diag.ResultCount}");
Console.WriteLine($"Pending delta items: {diag.PendingDeltaItemCount}");
Console.WriteLine($"Memory subscribers: {diag.MemorySubscriberCount}");
Console.WriteLine($"Version: {diag.Version}");
```

### Monitoring Recommendations

| Metric | Healthy | Investigate |
|--------|---------|------------|
| Delta latency (P95) | < 2 ms (12.5% of frame) | > 4 ms |
| Container size growth | Stable | Monotonically increasing |

---

## Integration with Other Features

### Transactions

Reactive query results update during `Commit()`. Materialized Z-set maintenance
runs synchronously as part of the commit sequence. See [Transactions](/docs/engine/transactions).

### PGO

PGO profiles drive reactive query buffer pre-allocation and priority
suggestions. See [PGO — Reactive Query PGO Hints](/docs/performance/pgo#reactive-query-pgo-hints).

### Navigation Editors

Editor `OnChanged` / `OnDeepChanged` subscriptions are complementary to
reactive queries. Use Editors for per-entity notifications and reactive queries
for materialized views. See [Navigation Editors](/docs/advanced/navigation-editors#reactive-subscriptions).

### Persistence

Reactive query results are **not persisted** — they are recomputed from the
database state on startup through materialized-view initial build. Z-set
maintenance owns subsequent commits. See [Persistence](/docs/engine/persistence).

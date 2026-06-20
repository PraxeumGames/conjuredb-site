# Performance Tips

Guide to writing efficient queries and optimizing ConjureDB performance for game applications.

ConjureDB is an in-memory database designed for game clients where every microsecond matters. This guide covers practical techniques for writing fast queries, choosing the right indexes, eliminating allocations, and keeping your game running at a stable frame rate.

**See also:** [Indexing](/docs/schema/indexing) · [Compiled Queries](/docs/query-language/compiled-queries) · [PGO](/docs/performance/pgo) · [Database Engine](/docs/engine/database-engine)

---

## Table of Contents

- [Compiled Queries vs Runtime Queries](#compiled-queries-vs-runtime-queries)
- [Index Selection Guide](#index-selection-guide)
- [Query Optimization](#query-optimization)
- [Zero-Allocation Patterns](#zero-allocation-patterns)
- [Understanding Compiler Warnings](#understanding-compiler-warnings)
- [PGO Workflow Summary](#pgo-workflow-summary)
- [Memory Management](#memory-management)
- [Unity-Specific Performance](#unity-specific-performance)
- [Common Anti-Patterns](#common-anti-patterns)
- [Benchmarking Your Queries](#benchmarking-your-queries)
- [Game-Specific Patterns](#game-specific-patterns)

---

## Compiled Queries vs Runtime Queries

The single most impactful performance decision is whether your queries are compiled at build time or interpreted at runtime.

### Always Use `query` for Production Code

Compiled queries are transformed into optimized C# methods during `dotnet build`. The generated code uses direct index access, zero-reflection field reads, and pre-computed execution strategies. There is no parsing, no expression tree construction, and no runtime planning overhead.

```csharp
// ✅ GOOD — compiled at build time, zero overhead at runtime
schema query "from Players | filter Level > @minLevel | sort -Score | take @n")]
IEnumerable<Player> GetTopPlayers(int minLevel, int n);
```

Runtime queries (ad-hoc `context.Query(...)` calls) pay the full cost of parsing, binding, optimization, and code generation on every invocation. They are useful for debugging and development tools, but should never appear in game loops.

```csharp
// ❌ BAD — full compilation pipeline on every call
var result = context.Query("from Players | filter Level > 10 | take 5");
```

### Performance Comparison

| Aspect | Compiled Query | Runtime Query |
|--------|---------------|---------------|
| Parse + bind + optimize | Build time (zero at runtime) | Every call |
| Index selection | Pre-computed optimal path | Computed per call |
| Allocation | Zero (NoAlloc variants) | Query plan + result containers |
| Suitable for game loop | ✅ Yes | ❌ No |
| Suitable for dev tools | ✅ Yes | ✅ Yes |

### NoAlloc Variants for Zero-Allocation Hot Paths

Every compiled query automatically generates `...NoAlloc()` and `...ForEach<TConsumer>()` helper surfaces. Use these in performance-critical paths where even a `List<T>` allocation is unacceptable:

```csharp
// Standard — allocates a List<T> internally
IEnumerable<Player> GetTopPlayers(int minLevel, int n);

// NoAlloc — pooled outer result, no List<T> allocation
ConjureDB.Collections.DisposableQueryResult<Player> GetTopPlayersNoAlloc(int minLevel, int n);

// Streaming callback — lowest-allocation public surface
void GetTopPlayersForEach<TConsumer>(ref TConsumer consumer, int minLevel, int n)
    where TConsumer : struct, ConjureDB.Query.IQueryConsumer<Player>;
```

```csharp
// Usage in a game loop — zero GC pressure in the outer result container
using var result = context.Players.GetTopPlayersNoAlloc(minLevel: 50, n: 10);
var span = result.Span;

for (int i = 0; i < span.Length; i++)
{
    ref readonly var player = ref span[i];
    RenderPlayer(player);
}
```

for (int i = 0; i < count; i++)
{
    ref readonly var player = ref buffer[i];
    RenderLeaderboardEntry(player.Name, player.Score);
}
```

---

## Index Selection Guide

Choosing the right index type is the difference between O(1) and O(n). ConjureDB provides specialized index structures for every common access pattern.

### When to Use Each Index Type

| Query Pattern | Recommended Index | Complexity | Why |
|---------------|-------------------|------------|-----|
| Exact key lookup (`filter GuildId == 42`) | **LookupIndex** | O(1) | Hash-based equality, non-unique keys |
| Unique key lookup (`filter Email == "..."`) | **UniqueIndex** | O(1) | Hash-based, enforces uniqueness constraint |
| Range queries (`filter Price >= 10 and Price <= 50`) | **SortedSetIndex** | O(log n + k) | Tree-based range scan |
| Sorted enumeration (`sort -Score | take 10`) | **SortedSetIndex** | O(log n) | Pre-cached ascending/descending order |
| Category + sorted (`filter GuildId == @g | sort -Score | take 10`) | **GroupedSortedIndex** | O(1) group + O(k) | Pre-sorted per group, zero-sort TopN |
| EXISTS range check (`does order X have qty > 100?`) | **RangeLookupIndex** | O(1) | Sparse min/max arrays |
| Pre-computed totals (`sum Score where GuildId == @g`) | **AggregationIndex** | O(1) | Incrementally maintained aggregates |
| Multiple grouped aggregates (`sum, avg, count per guild`) | **UniversalAggregationIndex** | O(1) per metric | Pre-computed grouped stats |
| Global metrics (`total gold across all players`) | **GlobalAggregationIndex** | O(1) | Running sum/count/min/max |
| Small, rarely-mutated sorted data | **SortedListIndex** | O(log n) lookup | Dense array, cache-friendly iteration |

### Index Overhead

Every index consumes memory and adds update cost. Only add indexes that your queries actually use.

| Index Type | Memory per Entry | Insert Cost | Update Cost (key change) | Notes |
|------------|-----------------|-------------|-------------------------|-------|
| PrimaryIndex | ~size of entity | O(1) amort. | O(1) | Always present, automatic |
| LookupIndex | ~4 bytes (objectId in bucket) | O(1) amort. | O(1) remove + O(1) insert | Type-specialized for int/ulong |
| UniqueIndex | ~12 bytes (key + objectId) | O(1) | O(1) | Pre-commit duplicate check adds overhead |
| SortedSetIndex | ~16 bytes (group entry) | O(log n) | O(log n) × 2 | Cached orderings rebuilt lazily after mutations |
| SortedListIndex | ~8 bytes (sorted array slot) | O(n) shift | O(n) shift × 2 | Dense array; insertions shift elements |
| GroupedSortedIndex | ~12 bytes (group slot) | O(log k) per group | O(log k) × 2 | k = group size |
| RangeLookupIndex | ~12 bytes (3 sparse arrays) | O(1) | O(1) | Min/max boundary removals mark group dirty |
| AggregationIndex | ~32 bytes (running stats) | O(1) | O(1) | Lazy min/max recomputation on removal |
| UniversalAggregationIndex | ~40 bytes per group | O(1) | O(1) | Ranking cache adds overhead if enabled |

### When NOT to Add an Index

- **Tables with < 100 rows** — full scan is often faster than index overhead.
- **Write-heavy columns with rare reads** — index update cost outweighs query savings.
- **Columns only used in projections** — indexes help filters and sorts, not `select`.
- **Low-selectivity columns** (e.g., `bool IsActive` on a table where 95% are active) — the index returns nearly all rows; a scan is comparable.

**Rule of thumb:** If the compiler emits warning `UM7003` (unused index), remove the index to save memory and update cost.

---

## Query Optimization

### Filter Before Join

Applying filters before joins reduces the number of rows that participate in the join, dramatically reducing work for large tables.

```dsl
# ❌ BAD — joins all users with all orders, then filters
from Users
| join Orders o (Id == o.UserId)
| filter Age > 18

# ✅ GOOD — filters users first, then joins only matching users
from Users
| filter Age > 18
| join Orders o (Id == o.UserId)
```

The compiler's optimizer will attempt predicate pushdown automatically, but writing filters early makes intent clear and ensures optimal plans even without PGO data.

### Use Projections to Reduce Data

Select only the columns you need. The compiler eliminates reads of unused fields, reducing memory bandwidth:

```dsl
# ❌ BAD — reads all 15 columns per entity
from Players
| filter GuildId == @guildId

# ✅ GOOD — reads only the 3 columns needed
from Players
| filter GuildId == @guildId
| select Id, Name, Score
```

### Use TAKE to Limit Results

Unbounded queries can produce unexpectedly large result sets. Always use `take` when you only need a subset:

```dsl
# ❌ BAD — sorts entire table, returns everything
from Players
| sort -Score

# ✅ GOOD — sorts and returns only top 10
from Players
| sort -Score
| take 10
```

When a `take` limit is present, the compiler can use a heap-based TopN algorithm (O(n log k) where k = limit) instead of a full O(n log n) sort. For k ≤ 64, the heap is stack-allocated with zero GC pressure.

### Prefer Indexed Lookups Over Full Scans

The compiler selects indexes automatically when available. Ensure the columns you filter on have appropriate indexes:

```csharp
// ✅ With a LookupIndex on GuildId — O(1) hash lookup
schema query "from Players | filter GuildId == @guildId")]
IEnumerable<Player> GetGuildPlayers(int guildId);

// ❌ Without an index on Name — O(n) full scan
schema query "from Players | filter Name == @name")]
IEnumerable<Player> FindByName(string name);
```

If you see compiler warning `UM7001` (full scan on large table), add an index on the filtered column.

### Leverage Pre-Sorted Indexes

When you have a `SortedSetIndex` on the sort column, the compiler eliminates the sort operator entirely:

```csharp
// SortedSetIndex on Score → sort is free (pre-cached ordering)
schema query "from Players | sort -Score | take @n")]
IEnumerable<Player> GetTopPlayers(int n);

// GroupedSortedIndex on (GuildId, Score) → group access + pre-sorted iteration
schema query "from Players | filter GuildId == @g | sort -Score | take @n")]
IEnumerable<Player> GetTopGuildPlayers(int g, int n);
```

### Use Aggregation Indexes for Metrics

Don't scan tables to compute sums and counts. Use pre-computed aggregation indexes:

```csharp
// ❌ BAD — scans all players to compute sum
schema query "from Players | aggregate { Total = sum Score }")]
long GetTotalScore();

// ✅ GOOD — declare a GlobalAggregationIndex, O(1) read
[Index(Name = "GlobalScore", Type = IndexType.Aggregation, ValueProperty = "Score")]
public int Score { get; set; }
// O(1): context.Players.SyncIndex.GlobalScore.GetGlobalSum()
```

For grouped aggregations, use `UniversalAggregationIndex`:

```csharp
// O(1) per guild — no GROUP BY scan required
[Index(Name = "ScoreByGuild", Type = IndexType.UniversalAggregation,
       Keys = new[] { "GuildId" }, ValueProperty = "Score")]
public int GuildId { get; set; }
```

---

## Zero-Allocation Patterns

In game loops running at 60 FPS, you have ~16.6 ms per frame. Every heap allocation adds GC pressure that eventually causes frame-rate hitches. ConjureDB provides multiple zero-allocation access patterns.

### NoAlloc Query Overloads

Every compiled query has `...NoAlloc()` and `...ForEach<TConsumer>()` helpers:

```csharp
// Allocating version — creates a List<T>
IEnumerable<Player> GetTopPlayers(int n);

// NoAlloc version — pooled outer result
ConjureDB.Collections.DisposableQueryResult<Player> GetTopPlayersNoAlloc(int n);
```

```csharp
// Use the pooled span directly
using var result = context.Players.GetTopPlayersNoAlloc(n: 20);
var buf = result.Span;

for (int i = 0; i < buf.Length; i++)
{
    ref readonly var p = ref buf[i];
    // Use p.Name, p.Score, etc. — no copies
}
```

### Ref Access (`FindById`, Enumeration)

Use `ref readonly` access to avoid copying entity structs:

```csharp
// O(1) lookup returning a reference — no struct copy
ref readonly var player = ref context.Players.FindById(playerId);

// Zero-copy enumeration over all entities
ReadOnlyMemory<T> all = context.Players.All();
var span = all.Span;
for (int i = 0; i < span.Length; i++)
{
    ref readonly var entity = ref span[i];
    // Direct field access, no allocation
}
```

### Zero-Allocation Index Enumeration

Secondary indexes provide `QueryDirect` and `QueryDirectByRef` methods that return struct enumerables:

```csharp
// Struct enumerable — no heap allocation
var directResults = context.Players.SyncIndex.GuildId_Lookup.QueryDirect(guildId);
foreach (var player in directResults) { /* ... */ }

// By-ref struct enumerable — no copies of large structs
var refResults = context.Players.SyncIndex.GuildId_Lookup.QueryDirectByRef(guildId);
foreach (ref readonly var player in refResults) { /* ... */ }
```

### Value-Type Results

For scalar queries, prefer value-type returns to avoid boxing:

```csharp
// Returns int directly — no boxing, no allocation
schema query "from Players | aggregate { MaxLevel = max Level }")]
int GetMaxLevel();

// Returns long — no boxing
schema query "from Players | filter GuildId == @g | aggregate { Total = sum Score }")]
long GetGuildTotalScore(int g);
```

---

## Understanding Compiler Warnings

The ConjureDB compiler produces structured warnings (UM7xxx) when it detects suboptimal query patterns. These warnings are actionable — each one points to a specific performance issue with a concrete fix.

### Plan Warnings Reference

| Warning | Description | Impact | How to Fix |
|---------|-------------|--------|------------|
| `UM7001` | Full scan on large table | O(n) scan instead of indexed access | Add a `LookupIndex` or `SortedSetIndex` on the filtered column |
| `UM7002` | Cartesian product (JOIN without condition) | O(n × m) cross join | Add a join condition: `join Orders o (Id == o.UserId)` |
| `UM7003` | Unused index — a suitable index exists but was not used | Index update overhead with no query benefit | Remove the unused index or adjust query filters to use it |
| `UM7004` | Sort without LIMIT on large result set | Full O(n log n) sort with unbounded output | Add `take N` to enable heap-based TopN, or add a `SortedSetIndex` |
| `UM7005` | Correlated subquery not decorrelated | Per-row re-evaluation, O(n × m) | Rewrite as a join or use `exists` with an indexed predicate |
| `UM7006` | Missing PGO statistics for a critical query | Compiler uses conservative heuristic defaults | Collect a PGO profile (see [PGO Workflow](#pgo-workflow-summary)) |
| `UM7007` | Nested loop join on large tables | O(n × m) without index | Add a `LookupIndex` on the join key, or enable PGO for strategy selection |
| `UM7008` | Full sort on large dataset | O(n log n) with no limit or index | Add `take N`, add a `SortedSetIndex`, or use PGO |
| `UM7009` | Index recommendation from Index Advisor | Advisor detected a missing index opportunity | Review the recommendation and add the suggested index |
| `UM7010` | Semi/Anti join fell back to NestedLoop | EXISTS not fully decorrelated or no index | Add index on the correlated column or restructure the subquery |
| `UM7011` | Nested collection allocation in projection | Per-entity `List<T>` allocation, O(n × m) | Flatten with a join instead of nested collections |
| `UM7013` | PGO profile untrusted | Stale or low-quality profile → heuristic fallback | Recollect the profile on a representative workload |
| `UM7014` | PGO profile version mismatch | Profile schema doesn't match current entities | Regenerate the profile after schema changes |
| `UM7015` | Correlated scalar subquery fallback | Per-row evaluation of scalar subquery | Rewrite as join + aggregation or decorrelate manually |
| `UM7016` | Heuristic planning fallback | Missing statistics or metadata | Provide PGO data or manual hints via `query` attributes |
| `UM7018` | PGO profile data inconsistency | Invalid key range or conflicting data in profile | Recollect the profile; check for data corruption |

### Join-Specific Diagnostics

| Warning | Description | How to Fix |
|---------|-------------|------------|
| `JOIN0001` | No applicable join strategy for predicate | Ensure join predicate uses equality on indexed columns |
| `JOIN0003` | Conjunctive join predicate unsupported | Simplify the join predicate or split into separate joins |
| `JOIN0004` | PGO join strategy hint unavailable | The hinted strategy doesn't exist for this join; remove or change the hint |
| `JOIN0005` | PGO enforce failed — strategy unavailable | Relax enforcement to `Hint` mode, or add the required index |

### Interpreting Warnings in Build Output

```bash
dotnet build -c Release
# warning UM7001: Full scan on table 'Players' (estimated 10,000 rows).
#   Consider adding an index on column 'Name'.
# warning UM7004: Sort on 'Score' without LIMIT.
#   Consider adding 'take N' or a SortedSetIndex on 'Score'.
```

Address `UM7001` and `UM7002` warnings first — they indicate the most severe performance issues (full scans and cartesian products).

---

## PGO Workflow Summary

Profile-Guided Optimization lets the compiler make data-driven decisions instead of relying on heuristics. PGO follows the same pattern as LLVM PGO and .NET Dynamic PGO.

### Quick Start (4 Steps)

**1. Instrument — Enable profile collection:**

```csharp
[PgoMode(PgoMode.Collect, ProfilePath = "./profiles/game.json")]
public class GameDbContext : DbContext { ... }
```

**2. Run — Execute a representative workload:**

```csharp
// Run realistic gameplay scenarios (not synthetic benchmarks)
for (int i = 0; i < 10_000; i++)
{
    context.Players.GetTopPlayers(limit: 10);
    context.Players.GetGuildStats();
    context.Players.GetPlayerInventory(playerId: rng.Next(1, 1000));
}
```

**3. Export — Save the profile:**

```csharp
context.SaveProfile("./profiles/game.json");
```

Then regenerate your query host against the collected profile:

```bash
dotnet run --project ConjureDB.CodeGen.Manual -- ./Game.Data --profile=./profiles/game.json
```

Pass the source directory explicitly. If you omit it, `ConjureDB.CodeGen.Manual`
falls back to `ConjureDB.CodeGen.Sandbox`, which is useful for local experiments
but not for rebuilding your application with the collected profile.

**4. Rebuild — Switch to Use mode and rebuild:**

```csharp
[PgoMode(PgoMode.Use, ProfilePath = "./profiles/game.json")]
public class GameDbContext : DbContext { ... }
```

```bash
dotnet build -c Release
```

### What PGO Improves

| Decision | Without PGO | With PGO | Typical Speedup |
|----------|-------------|----------|-----------------|
| Aggregation strategy | Hash dictionary | DenseArray (stackalloc) | 3–8× |
| TopN implementation | Runtime branching | ConstantHeap (stackalloc) | 1.5–2× |
| Join strategy | Heuristic guess | Index lookup (observed FK range) | 2–5× |
| Sort operator | Always emitted | Eliminated when pre-sorted | ∞ (zero cost) |
| Output buffer | 4 resizes (grow-double) | Pre-allocated to average result count | 1.2–1.5× |
| Packed-key width | Conservative `ulong` | Narrowest type for observed range | Memory savings |

### When PGO Has Minimal Impact

- Tables with < 100 rows (overhead is negligible)
- Simple scan-filter-project without aggregation or joins
- Queries where the heuristic default is already close to observed values

### Manual Hints (Without Full PGO)

Override individual decisions with `query` attributes:

```csharp
schema query "from Players | group GuildId (...)", MaxGroupKeyValue = 256)]
IEnumerable<GuildStats> GetGuildStats();
```

| Hint | Effect |
|------|--------|
| `MaxGroupKeyValue` | Force DenseArray aggregation if ≤ threshold |
| `MaxKeyValue` | Override bounded comparison-key range for dense set-operation / DISTINCT strategies |
| `NoOptimize = true` | Disable PGO optimizations (baseline comparison) |

Join-strategy preference, sort skipping, and selectivity overrides come from planning profiles / PGO data rather than `CompiledQueryAttribute`.

See [PGO](/docs/performance/pgo) for full documentation.

---

## Memory Management

### Capacity Pre-allocation

Set accurate initial capacities in `table` attributes to avoid runtime resizing. The primary index doubles capacity when exhausted — each doubling copies the entire array:

```csharp
// ❌ BAD — default capacity, resizes multiple times as players join
table "Players", PersistenceType.Local)]
public class Player { ... }

// ✅ GOOD — pre-allocate for expected steady-state count
table "Players", PersistenceType.Local, capacity: 10_000)]
public class Player { ... }
```

For secondary indexes, use `PrewarmIndexAllocator`:

```csharp
context.Players.EnsureCapacity(maxId: 10_000, valueCapacity: 10_000);
```

### Memory Budget

Set a memory budget to track pressure across all tables:

```csharp
var context = DbContextBuilder<GameDbContext>.Create()
    .WithMemoryBudgetMB(256)
    .Build();
```

### Monitoring Memory Usage

Use `GetMemoryReport()` and `GetHealthReport()` to inspect runtime memory:

```csharp
var report = context.GetMemoryReport();
Console.WriteLine($"Total: {report.TotalBytes / 1024 / 1024} MB");
Console.WriteLine($"Tables: {report.TableBytes / 1024 / 1024} MB");
Console.WriteLine($"Materialized: {report.MaterializedBytes / 1024 / 1024} MB");
Console.WriteLine($"Budget: {report.BudgetBytes / 1024 / 1024} MB");
Console.WriteLine($"Pressure: {report.BudgetPressureLevel} ({report.BudgetUsageRatio:P1})");

foreach (var set in report.Sets)
{
    Console.WriteLine($"  {set.Name}: {set.EntityCount} entities, " +
                      $"{set.PrimaryIndexBytes / 1024} KB");
}

foreach (var view in report.MaterializedViews)
{
    Console.WriteLine($"  {view.Name}: {view.VisibleRowCount} rows, " +
                      $"{view.TotalBytes / 1024} KB");
}
```

```csharp
var health = context.GetHealthReport();
Console.WriteLine($"Worker: {health.WorkerState}");
Console.WriteLine($"Entities: {health.TotalEntityCount}");
Console.WriteLine($"Memory: {health.EstimatedMemoryBytes / 1024 / 1024} MB");
```

---

## Unity-Specific Performance

### IL2CPP Considerations

ConjureDB is designed for IL2CPP compatibility. Key constraints:

- **No reflection** — generated code uses direct field access, not `PropertyInfo`.
- **No `dynamic`** — all types are statically resolved at compile time.
- **No `Expression<T>`** — queries compile to plain C# methods, not expression trees.
- **AOT-safe construction** — `DbContextBuilder<T>.Create()` is the standard path. Keep the public `TContext(DbConfiguration)` constructor so the builder can bind to it under IL2CPP:

```csharp
var context = DbContextBuilder<GameDbContext>.Create()
    .WithDataDirectory(Application.persistentDataPath + "/db")
    .Build();
```

### GC Pressure Reduction

The primary source of GC pauses in Unity games is frequent small allocations that accumulate in Generation 0. ConjureDB provides zero-allocation paths for every hot operation:

| Operation | Allocating API | Zero-Alloc API |
|-----------|---------------|----------------|
| Query results | `IEnumerable<T>` return | `Get...NoAlloc()` / `Get...ForEach<TConsumer>()` |
| Index lookup | `Query(key)` → `IEnumerable<T>` | `QueryDirect(key)` → struct enumerable |
| Entity access | `FindById(id)` → copy | `ref readonly` via `FindById` |
| Full iteration | `foreach` on `IEnumerable` | `All()` → `ReadOnlyMemory<T>.Span` |

**Rule of thumb:** In your `Update()` loop, use only NoAlloc query helpers and `ref readonly` access.

### Frame Budget Management

Typical frame budgets:

| Target FPS | Frame Budget | Recommended DB Budget |
|------------|-------------|----------------------|
| 60 FPS | 16.6 ms | ≤ 1 ms for all DB operations |
| 30 FPS | 33.3 ms | ≤ 3 ms for all DB operations |
| 120 FPS | 8.3 ms | ≤ 0.5 ms for all DB operations |

**Strategies for staying within budget:**

1. **Pre-compute with reactive queries** — let the worker thread maintain query results. Read `Current` in the game loop (O(1), zero allocation):

```csharp
schema reactive query "from Players | filter Level > 10 | sort -Score | take 20")]
ReactiveQuery<Player> TopPlayers { get; }

// In Update() — O(1) read, zero allocation
ReadOnlySpan<Player> top = context.TopPlayers.Current;
```

2. **Amortize writes across frames** — batch mutations and commit once per frame, not per operation:

```csharp
// ❌ BAD — commit per item pickup
void OnItemPickup(Item item)
{
    context.BeginTransaction();
    context.Items.Add(item);
    context.Commit();
}

// ✅ GOOD — batch mutations, commit once per frame
void LateUpdate()
{
    if (_pendingItems.Count == 0) return;

    context.BeginTransaction();
    foreach (var item in _pendingItems)
        context.Items.Add(item);
    context.Commit();
    _pendingItems.Clear();
}
```

### Async Commit for Smooth Frames

Use `CommitAsync` to avoid blocking the main thread on journal flush:

```csharp
// Non-blocking commit — journal flush happens in background
await context.CommitAsync(forceFlush: false);

// Blocking commit with durability guarantee (for save points)
await context.CommitAsync(forceFlush: true);
```

### Mobile Battery Awareness

On mobile, reduce I/O when battery is low:

```csharp
var context = DbContextBuilder<GameDbContext>.Create()
    .WithBatteryStatusProvider(new UnityBatteryProvider())
    .WithSnapshot(snap => snap
        .AutomaticSnapshotInterval(TimeSpan.FromMinutes(5)))
    .Build();
```

ConjureDB automatically defers non-critical I/O operations (periodic snapshots, journal compaction) when the battery provider reports low charge.

---

## Common Anti-Patterns

| Anti-Pattern | Problem | Solution |
|--------------|---------|----------|
| LINQ in `Update()` loop | Allocation per frame (iterators, closures) | Compiled query with `NoAlloc()` / `ForEach<TConsumer>()` helper |
| String concatenation in filters | GC pressure from temporary strings | Use `@parameters` in DSL queries |
| Unbounded queries (no `take`) | Memory spike, O(n log n) sort | Always add `take N` to limit results |
| Missing indexes on join keys | O(n × m) nested loop join | Add `LookupIndex` on foreign key columns |
| Updating inside enumeration | "Collection was modified" exception | Collect IDs first, then mutate in separate loop |
| Commit per mutation | Worker thread overhead per commit | Batch mutations, commit once per frame |
| Ignoring compiler warnings | Undetected full scans, cartesian products | Fix every `UM7xxx` warning before shipping |
| Over-indexing (index every column) | Wasted memory, slower writes | Only index columns used in filters/sorts/joins |
| Scanning for aggregates | O(n) per frame for sum/count | Use `AggregationIndex` or `UniversalAggregationIndex` |
| Allocating results you don't read | GC pressure from unused `List<T>` | Use scalar return types or NoAlloc helpers |

### Anti-Pattern Deep Dives

#### Updating Inside Enumeration

```csharp
// ❌ BAD — modifying collection during iteration
foreach (var player in context.Players)
{
    if (player.Level > 50)
        context.Players.Update(new Player { Id = player.Id, Score = player.Score + 100 });
}

// ✅ GOOD — collect IDs first, then mutate
var toUpdate = new List<int>();
var allPlayers = context.Players.All().Span;
for (int i = 0; i < allPlayers.Length; i++)
{
    if (allPlayers[i].Level > 50)
        toUpdate.Add(allPlayers[i].Id);
}

context.BeginTransaction();
foreach (var id in toUpdate)
{
    var player = context.Players.FindById(id);
    context.Players.Update(new Player { Id = id, Score = player.Score + 100 });
}
context.Commit();
```

#### Over-Indexing

```csharp
// ❌ BAD — indexes on columns never used in queries
[Index(Name = "ByName", Type = IndexType.Lookup)]
public string Name { get; set; }      // Never filtered

[Index(Name = "ByEmail", Type = IndexType.Lookup)]
public string Email { get; set; }     // Never filtered

[Index(Name = "ByCreatedAt", Type = IndexType.SortedSet)]
public DateTime CreatedAt { get; set; } // Never sorted

// ✅ GOOD — only index what you query
[Index(Name = "ByGuild", Type = IndexType.Lookup)]
public int GuildId { get; set; }       // Used in: filter GuildId == @g

[Index(Name = "ByScore", Type = IndexType.SortedSet)]
public int Score { get; set; }         // Used in: sort -Score | take 10
```

---

## Benchmarking Your Queries

### `[DebugGeneration]` Trace Levels

Use the `[DebugGeneration]` attribute to inspect the compiler's decisions:

```csharp
[DebugGeneration(TraceLevel = DebugTraceLevel.Verbose, OutputPath = "./debug")]
public interface IPlayerRepository : IRepository<Player>
{
    schema query "from Players | sort -Score | take 10")]
    IEnumerable<Player> GetTopPlayers();
}
```

| Level | What You See |
|-------|-------------|
| `None` | No output |
| `Summary` | Stage boundaries and final decisions |
| `Normal` | IR snapshots between compilation stages |
| `Verbose` | Full pipeline trace: parsing → binding → optimization → planning → emission |

### Plan Dumping via CLI

Inspect the physical plan for any compiled query:

```bash
dotnet run --project ConjureDB.CodeGen.Manual -- ./Game.Data --dump-plan=GetTopPlayers
```

Output shows the operator tree with cost estimates. The exact operators depend
on the query text and available indexes; for the `GetTopPlayers` example above,
expect a scan over `Players` plus sort/top-N planning rather than a parameterized
filter unless your query actually includes one.

```
Scan(Players) ...
    Sort(...) ...
        TopN(...) ...
```

Key things to look for:
- **`strategy=IndexedRange`** — good, using an index
- **`strategy=FullScan`** — bad, scanning all rows
- **`Sort(strategy=NoOp)`** — good, sort eliminated (pre-sorted data)
- **`cost=0`** — operator is free (eliminated by optimizer)

### Stopwatch Measurement

For quick benchmarking during development:

```csharp
var sw = System.Diagnostics.Stopwatch.StartNew();
for (int i = 0; i < 10_000; i++)
{
    _ = context.Players.GetTopPlayers(minLevel: 10, n: 10);
}
sw.Stop();
Console.WriteLine($"Avg: {sw.Elapsed.TotalMicroseconds / 10_000:F1} µs/query");
```

### BenchmarkDotNet Integration

For rigorous benchmarking with statistical significance:

```csharp
[MemoryDiagnoser]
[SimpleJob(RuntimeMoniker.Net80)]
public class QueryBenchmarks
{
    private GameDbContext _context;

    [GlobalSetup]
    public void Setup()
    {
        _context = DbContextBuilder<GameDbContext>.Create()
            .WithDataDirectory("./bench_data")
            .Build();
        // Populate with representative data
    }

    [Benchmark(Baseline = true)]
    public IEnumerable<Player> TopPlayers_Allocating()
        => _context.Players.GetTopPlayers(minLevel: 10, n: 10);

    [Benchmark]
    public int TopPlayers_NoAlloc()
    {
        using var result = _context.Players.GetTopPlayersNoAlloc(minLevel: 10, n: 10);
        return result.Span.Length;
    }

    [GlobalCleanup]
    public void Cleanup() => _context.Dispose();
}
```

Run with:

```bash
dotnet run -c Release --project ConjureDB.Benchmarks
```

---

## Game-Specific Patterns

### Inventory System

**Entity design:**

```csharp
table "Inventory", PersistenceType.Local, capacity: 50_000)]
public record InventoryItem
{
    public int Id { get; set; }

    [Index(Name = "ByPlayer", Type = IndexType.Lookup)]
    public int PlayerId { get; set; }

    [Index(Name = "ByPlayerAndRarity",
           Type = IndexType.GroupedSorted,
           Keys = new[] { "PlayerId" },
           RangeProperty = "Rarity")]
    public int Rarity { get; set; }

    [Index(Name = "ItemCount",
           Type = IndexType.UniversalAggregation,
           Keys = new[] { "PlayerId" },
           ValueProperty = "Quantity")]
    public int Quantity { get; set; }

    public int ItemTemplateId { get; set; }
    public int EnchantLevel { get; set; }
}
```

**Common queries:**

```csharp
// All items for a player — O(1) lookup
schema query "from Inventory | filter PlayerId == @pid")]
IEnumerable<InventoryItem> GetPlayerItems(int pid);

// Total item count — O(1) aggregation
schema query "from Inventory | filter PlayerId == @pid | aggregate { Total = sum Quantity }")]
int GetTotalItemCount(int pid);

// Rarest items first — O(1) group + O(k) iteration, pre-sorted
schema query "from Inventory | filter PlayerId == @pid | sort -Rarity | take @n")]
IEnumerable<InventoryItem> GetRarestItems(int pid, int n);
```

**Performance characteristics:**
- Player items lookup: O(1) via `LookupIndex` → microseconds
- Item count: O(1) via `UniversalAggregationIndex` → nanoseconds
- Rarest items: O(1) group access via `GroupedSortedIndex` → microseconds

### Leaderboard

**Entity design:**

```csharp
table "Players", PersistenceType.Local, capacity: 100_000)]
public record Player
{
    public int Id { get; set; }
    public string Name { get; set; }

    [Index(Name = "Score_Sorted", Type = IndexType.SortedSet)]
    public int Score { get; set; }

    [Index(Name = "ScoresByGuild",
           Type = IndexType.GroupedSorted,
           Keys = new[] { "GuildId" },
           RangeProperty = "Score")]
    public int GuildId { get; set; }

    [Index(Name = "GuildTotalScore",
           Type = IndexType.UniversalAggregation,
           Keys = new[] { "GuildId" },
           ValueProperty = "Score")]
    public int _GuildId_Agg { get; set; } // alias to avoid duplicate property
}
```

**Queries:**

```csharp
// Global Top-N — O(n) with SortedSet pre-sorted, O(k) iteration
schema query "from Players | sort -Score | take @n")]
IEnumerable<Player> GetGlobalLeaderboard(int n);

// Guild Top-N — O(1) group + O(k), zero sorting
schema query "from Players | filter GuildId == @g | sort -Score | take @n")]
IEnumerable<Player> GetGuildLeaderboard(int g, int n);

// Top guilds by total score — O(k) from pre-ranked aggregation
schema query
    "from Players | group GuildId (aggregate { Total = sum Score }) | sort -Total | take @n",
    MaxGroupKeyValue = 10000)]
IEnumerable<GuildRanking> GetTopGuilds(int n);
```

**For reactive leaderboards** (auto-updating UI):

```csharp
schema reactive query "from Players | sort -Score | take 20")]
ReactiveQuery<Player> TopPlayersLive { get; }

// In Update() — always current, zero allocation
ReadOnlySpan<Player> top = context.TopPlayersLive.Current;
```

### Config Tables (Read-Only Patterns)

Game config (item templates, level requirements, skill trees) is loaded once and read frequently:

```csharp
table "ItemTemplates", PersistenceType.None, capacity: 5_000)]
public record ItemTemplate
{
    public int Id { get; set; }
    public string Name { get; set; }
    public int Rarity { get; set; }
    public int BasePrice { get; set; }

    [Index(Name = "ByRarity", Type = IndexType.SortedSet)]
    public int _Rarity { get; set; }
}
```

**Optimization tips for config tables:**
- Use `PersistenceType.None` — no snapshot/journal overhead since data is loaded from game files.
- Set capacity exactly — no resizing since the dataset is fixed.
- Use `UniqueIndex` for lookups by external ID (e.g., template string ID).
- Prefer `SortedListIndex` over `SortedSetIndex` for small, never-mutated tables — dense array iteration is cache-friendlier.

```csharp
// Pre-load all config in one transaction
context.BeginTransaction();
foreach (var template in LoadFromGameFiles())
    context.ItemTemplates.Add(template);
context.Commit();

// All subsequent reads are O(1) or O(log n) — zero allocation
```

### Real-Time Multiplayer State

For multiplayer games with frequent state updates:

**Transaction batching:**

```csharp
// ❌ BAD — commit per player update (20 commits/tick for 20 players)
foreach (var update in networkUpdates)
{
    context.BeginTransaction();
    context.Players.Update(update);
    context.Commit(); // triggers worker sync each time
}

// ✅ GOOD — single commit per network tick
context.BeginTransaction();
foreach (var update in networkUpdates)
    context.Players.Update(update);
context.Commit(); // one worker sync for all updates
```

**Delta subscriptions for state sync:**

```csharp
// Subscribe to changes and send only deltas to the network layer
context.Players.Subscribe((in StateChange<Player> change) =>
{
    switch (change.Type)
    {
        case ChangeType.Update:
            NetworkManager.SendDelta(change.Id, change.NewItem);
            break;
        case ChangeType.Add:
            NetworkManager.SendSpawn(change.NewItem);
            break;
        case ChangeType.Remove:
            NetworkManager.SendDespawn(change.Id);
            break;
    }
});
```

**Use reactive queries for derived state:**

```csharp
// Nearby enemies — auto-maintained by worker thread
schema reactive query "from Enemies | filter IsAlive == true | sort Distance | take 10")]
ReactiveQuery<Enemy> NearestEnemies { get; }

// In Update() — current snapshot, zero allocation, O(1)
var enemies = context.NearestEnemies.Current;
```

---

## Performance Checklist

Before shipping, verify every item:

- [ ] All game-loop queries use `query` (no runtime queries in hot paths)
- [ ] Hot-path queries use `NoAlloc()` / `ForEach<TConsumer>()` helpers
- [ ] All `UM7xxx` compiler warnings are resolved
- [ ] `table` capacity matches expected steady-state entity count
- [ ] Every filtered/sorted/joined column has an appropriate index
- [ ] No indexes on columns that are never queried (`UM7003`)
- [ ] Aggregation metrics use `AggregationIndex`, not full-table scans
- [ ] Mutations are batched — one `Commit()` per frame, not per operation
- [ ] Reactive queries are used for UI-bound data (leaderboards, HUD metrics)
- [ ] PGO profile is collected on representative workload (not synthetic data)
- [ ] Memory budget is set via `WithMemoryBudgetMB()`
- [ ] `CommitAsync(forceFlush: false)` is used for non-critical writes
- [ ] Mobile builds use `WithBatteryStatusProvider()`
- [ ] IL2CPP contexts keep a public `TContext(DbConfiguration)` constructor so `DbContextBuilder<T>.Create()` remains valid

---

## See Also

- [Indexing Reference](/docs/schema/indexing) — comprehensive index type documentation
- [Compiled Queries](/docs/query-language/compiled-queries) — `query` attribute reference and patterns
- [PGO](/docs/performance/pgo) — full Profile-Guided Optimization workflow
- [Database Engine](/docs/engine/database-engine) — `DbContext`, `DbSet<T>`, transactions, persistence
- [Reactive Queries](/docs/advanced/reactive-queries) — incremental view maintenance
- [Query Language](/docs/query-language/reference) — DSL syntax reference

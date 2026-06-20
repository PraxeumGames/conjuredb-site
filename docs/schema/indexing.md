# Indexing Reference

ConjureDB provides a rich set of index structures that turn O(n) table scans into O(1) or O(log n) lookups. This page is the comprehensive reference for every index type, its declaration, API, complexity guarantees, query optimizer integration, and practical usage patterns.

---

## Overview

### Why Indexes Matter

ConjureDB is an in-memory database for game clients. Even though data lives in RAM, scanning every row in a `DbSet<T>` for each query wastes CPU budget that should go to rendering and gameplay. Indexes provide sub-linear access paths that the compiled query engine uses to answer queries without full-table scans.

The compiler enforces this: **unindexed access patterns produce hard compilation errors**, not silent degradation.

### Index Categories

ConjureDB organizes indexes into two categories with distinct consistency models:

| Category | Consistency | Lifecycle |
|----------|-------------|-----------|
| **PrimaryIndex** | Immediate (synchronous) | Automatically created for every `DbSet<T>`. Mutations take effect instantly. |
| **SecondaryIndex** | Deferred-commit | Declared via `schema index` attribute or `@@index` in schema files. Maintained by the background worker thread after each transaction commit. Secondary index reads always reflect committed data. |

### Index Types at a Glance

| IndexType | Data Structure | Lookup | Insert | Supported Queries | Best For |
|-----------|----------------|--------|--------|-------------------|----------|
| **Primary** | Dual-array (sparse + dense) | O(1) | O(1) amort. | Key lookup by `Id` | Every table (automatic) |
| **Lookup** | Type-specialized hash map | O(1) | O(1) amort. | Equality (`==`), `IN` | Non-unique key lookups |
| **Unique** | `Dictionary<TKey, int>` | O(1) | O(1) | Equality; uniqueness enforced | Unique constraints |
| **SortedSet** | `SortedSet<Group>` + cached arrays | O(log n) | O(log n) | Equality, range, ordering | Range scans, ORDER BY |
| **SortedList** | Sorted dense array | O(log n) | O(n) | Equality, range, ordering | Small ordered sets |
| **RangeLookup** | Sparse min/max arrays | O(1) | O(1) | EXISTS with range predicates | "Does any X exist where Y > Z?" |
| **GroupedSorted** | Sparse sorted lists | O(1) group | O(log n) insert | Group + sort pattern | Top-N per group |
| **Aggregation** | Running scalars | O(1) | O(1) | Global Sum, Count, Min, Max | Table-wide metrics |
| **UniversalAggregation** | `Dictionary<TKey, Stats>` | O(1) | O(1) | Grouped Sum, Avg, Count, Min, Max | Per-group metrics |
| **CrossTableArray** | Dense array cross-reference | O(1) | O(1) | Foreign-key array access | Cross-table lookups |
| **SpatialGrid** | Uniform spatial hash grid | O(cells × ents/cell) | O(1) | Radius, bounds, nearest-K | 2D/3D proximity queries |

---

## Index Types

### PrimaryIndex\<T\>

Every `DbSet<T>` automatically receives a `PrimaryIndex<T>` — the authoritative store for all entities, keyed by their integer `Id`. You never declare it explicitly; it exists the moment you define a table.

#### Storage

The primary index uses dense, contiguous storage for entities with a separate ID-to-slot mapping. This provides O(1) lookups by ID while keeping iteration dense (no gaps to skip).

#### API

| Method | Complexity | Description |
|--------|------------|-------------|
| `Contains(objectId)` | O(1) | Returns `true` if the entity exists. |
| `this[objectId]` | O(1) | Read entity by ID. |
| `Count` | O(1) | Number of stored entities. |
| `All` | O(n) | `IEnumerable<T>` over all entities (dense, no gaps). |
| `AsMemory` | O(1) | `ReadOnlyMemory<T>` zero-copy view. |
| `Upsert(objectId, item)` | O(1) amort. | Insert or update. |
| `Remove(objectId)` | O(1) | Swap-and-pop removal — no compaction needed. |

#### Capacity Growth

When storage is exhausted, capacity is **doubled**. Set an accurate `capacity` in the `table` attribute to avoid resizing in steady state:

```csharp
table "Players", PersistenceType.Local, capacity: 10_000)]
public record Player { /* ... */ }
```

#### Thread Safety

`PrimaryIndex<T>` is **not** thread-safe. All mutations must be serialized by the caller — typically through the `DbContext` transaction model (`BeginTransaction()` / `Commit()`).

#### When to Use

You don't choose PrimaryIndex — it's always there. Use it for:

- Direct entity lookup by `Id` (the most common access pattern).
- Full-table iteration when no filter applies.
- As the backing store that all secondary indexes reference.

---

### LookupIndex\<TKey\>

A hash-based equality index for non-unique keys. The workhorse for `filter Column == value` queries.

#### Declaration

```csharp
// Attribute-based (on entity property)
[Index(Name = "PlayersByGuild", Type = IndexType.Lookup)]
public int GuildId { get; set; }

// Composite key
[Index(Name = "PlayersByGuildAndRole",
       Type = IndexType.Lookup,
       Keys = new[] { "GuildId", "Role" })]
public int GuildId { get; set; }
```

```
// Schema-based (.conjure)
table Player {
  guild_id: int @index(name: "PlayersByGuild", kind: lookup)
}
// or table-level:
@@index(fields: [guild_id], name: "PlayersByGuild", kind: lookup)
```

#### Data Structure

LookupIndex is **type-specialized** to avoid boxing and virtual `GetHashCode` calls:

| Key Type | Backing Structure | Hash Strategy |
|----------|-------------------|---------------|
| `int`, `uint` | Integer-optimized hash map | Multiplicative (Fibonacci) hashing |
| `ulong` | Long-optimized hash map | High-quality integer finalizer |
| Other | `Dictionary<TKey, List<int>>` | Default `GetHashCode` |

Each bucket maps a key value to a list of matching `objectId` values.

#### API

| Method | Complexity | Description |
|--------|------------|-------------|
| `Query(key)` | O(1) amort. | Returns `IEnumerable<T>` of all entities with the given key. |
| `QueryDirect(key)` | O(1) amort. | Zero-allocation struct enumerable (used by generated code). |
| `QueryDirectByRef(key)` | O(1) amort. | Zero-allocation by-ref enumerable; avoids struct copies. |
| `ContainsKey(key)` | O(1) amort. | Returns `true` if any entity has this key value. |
| `Query(from, to)` | O(k) | Range query over sorted key cache (k = number of keys in range). |
| `All()` | O(n) | All entities in the index. |

#### Null Handling

Entities with `null` keys are tracked separately, avoiding null-key issues in hash maps. Queries for `null` keys work transparently.

#### Partial Index Support

An optional filter predicate can restrict which entities are indexed:

```csharp
[Index(Name = "ActivePlayersByGuild",
       Type = IndexType.Lookup,
       Keys = new[] { "GuildId" },
       FilterPredicate = "IsActive == true",
       FilterColumns = new[] { "IsActive" })]
public int GuildId { get; set; }
```

Only entities passing the predicate are inserted, reducing index size and update cost.

#### Complexity

| Operation | Time | Space per entry |
|-----------|------|-----------------|
| Lookup | O(1) average | 4 bytes (objectId in list) + hash map overhead |
| Insert | O(1) amortized | — |
| Remove | O(1) (swap in group list) | — |
| Update (key change) | O(1) remove + O(1) insert | — |

#### When to Use

- Equality filters: `filter GuildId == 42`
- `IN` queries: `filter Status in ("Active", "Pending")`
- Non-unique keys with multiple matches per value
- High-frequency lookups where O(1) amortized is critical

#### Limitations

- No ordered iteration guarantee (hash-based).
- Not suitable for range queries (use `SortedSet` instead).
- Memory grows with number of distinct key values × entries per key.

---

### UniqueIndex\<TKey\>

A uniqueness-constrained equality index. Guarantees exactly one entity per key value.

#### Declaration

```csharp
[Index(Name = "PlayerByUsername", Type = IndexType.Unique)]
public string Username { get; set; }
```

#### Data Structure

`Dictionary<TKey, int>` — each key maps to exactly one `objectId`. Pending keys from the current transaction are tracked separately for pre-commit duplicate detection.

#### API

| Method | Complexity | Description |
|--------|------------|-------------|
| `Query(key)` | O(1) | Returns the single matching entity. Throws `KeyNotFoundException` if absent. |
| `TryQuery(key, out item)` | O(1) | Returns `false` if absent (no exception). |
| `TryGetValue(key, out value)` | O(1) | Compatibility alias for dictionary-like API. |
| `Contains(key)` | O(1) | `true` if the key exists. |
| `this[key]` | O(1) | Indexer — same as `Query(key)`. |
| `All()` | O(n) | All entities in the table. |

#### Uniqueness Enforcement

- **Insert** with a duplicate key throws `SecondaryIndexValidationException`.
- Validation happens at two levels:
  1. **Pre-commit** (`ValidateAdd`): checks both committed keys and pending keys (from the current transaction).
  2. **Worker sync** (`AddInternal`): final check when the background worker applies changes.
- **Key changes** during updates are handled atomically: the old mapping is removed and the new mapping is inserted in a single operation.

#### Example

```csharp
table "Players", PersistenceType.Local, capacity: 1000)]
public record Player
{
    public int Id { get; set; }

    [Index(Name = "PlayerByEmail", Type = IndexType.Unique)]
    public string Email { get; set; }

    public string Name { get; set; }
}

// Usage in query:
// from Players | filter Email == "alice@example.com" | single
```

#### When to Use

- Natural keys (email, username, external ID) that must be unique.
- Foreign key targets where the relationship is 1:1.
- Any column where duplicate values represent a data integrity violation.

#### Limitations

- Exactly one entity per key — not suitable for non-unique lookups.
- Duplicate detection adds slight overhead to inserts.

---

### SortedSetIndex\<TKey\>

An ordered index supporting equality lookups, range predicates, and ordered iteration. The most versatile secondary index type.

#### Declaration

```csharp
[Index(Name = "Level_Sorted", Type = IndexType.SortedSet)]
public int Level { get; set; }

// With partial filter
[Index(Name = "ActivePlayersByLevel",
       Type = IndexType.SortedSet,
       Keys = new[] { "Level" },
       FilterPredicate = "IsActive == true",
       FilterColumns = new[] { "IsActive" })]
public int Level { get; set; }
```

```
// Schema-based
table Player {
  level: int @index(name: "Level_Sorted", kind: sorted_set)
}
```

#### Data Structure

`SortedSet<Group>` where each `Group` holds a `List<int>` of member `objectId` values sharing the same key. Groups are ordered by key value.

**Cached orderings:** The index maintains pre-computed ascending and descending orderings, lazily rebuilt after mutations. Ordered iteration is O(1) per element after the first access following a mutation batch.

**Group boundaries:** For descending access, the index also caches group boundary data, enabling O(log n) slicing for predicates like `key > threshold` without per-query allocations.

**Zero-allocation lookups:** Reusable `Group` objects (`_searchGroup`, `_searchGroupUpper`) are mutated in-place for search and range queries. No heap allocation per lookup.

#### API

| Method | Complexity | Description |
|--------|------------|-------------|
| `Query(key)` | O(log n) | All entities with the exact key. |
| `QueryDirect(key)` | O(log n) | Zero-allocation struct enumerable. |
| `QueryDirectByRef(key)` | O(log n) | Zero-allocation by-ref enumerable. |
| `Query(from, to)` | O(log n + k) | Range query: all entities with keys in `[from, to]` inclusive. |
| `QueryGreaterThan(key)` | O(log n + k) | All entities with key > threshold. |
| `QueryGreaterThanOrEqual(key)` | O(log n + k) | All entities with key ≥ threshold. |
| `QueryLessThan(key)` | O(log n + k) | All entities with key < threshold. |
| `QueryLessThanOrEqual(key)` | O(log n + k) | All entities with key ≤ threshold. |
| `QueryGreaterThanReverse(key)` | O(log n + k) | Descending order, key > threshold. |
| `QueryGreaterThanOrEqualReverse(key)` | O(log n + k) | Descending order, key ≥ threshold. |
| `QueryLessThanReverse(key)` | O(log n + k) | Descending order, key < threshold. |
| `QueryLessThanOrEqualReverse(key)` | O(log n + k) | Descending order, key ≤ threshold. |
| `ContainsKey(key)` | O(log n) | `true` if any entity has this key. |
| `All()` | O(n) | All entities in ascending key order. |
| `AllReverse()` | O(n) | All entities in descending key order. |
| `EnumerateAllReverse()` | O(n) | Zero-allocation descending struct enumerable. |
| `EnumerateAllReverseByRef()` | O(n) | Zero-allocation descending by-ref enumerable. |

*(Where n = number of distinct key values, k = number of matching entities.)*

#### Complexity

| Operation | Time |
|-----------|------|
| Point lookup | O(log n) |
| Range scan | O(log n + k) |
| Ordered iteration (cached) | O(1) per element |
| Insert / Remove | O(log n) |
| Update (key change) | O(log n) remove + O(log n) insert |

#### Example

```csharp
table "Items", PersistenceType.Local, capacity: 50_000)]
public record Item
{
    public int Id { get; set; }
    public string Name { get; set; }

    [Index(Name = "ItemsByPrice", Type = IndexType.SortedSet)]
    public int Price { get; set; }
}

// DSL queries that use this index:
// Range: from Items | filter Price >= 100 and Price <= 500
// Top-K: from Items | sort -Price | take 10
// Minimum: from Items | sort Price | take 1
```

#### When to Use

- Range filters: `filter Level >= 10 and Level <= 50`
- ORDER BY queries: `sort -Price`
- Min/Max queries (via ordered access)
- Any query combining equality, range, and ordering on the same column

#### Limitations

- O(log n) per operation vs O(1) for `Lookup` — use `Lookup` for pure equality.
- Cached snapshot rebuild after mutations is O(n) — acceptable for batch mutations, but consider `GroupedSorted` for frequently-mutated per-group sorted data.

---

### SortedListIndex\<TKey\>

Functionally similar to `SortedSet`, using a dense sorted array instead of a tree. Supports the same query patterns with different performance trade-offs.

#### Declaration

```csharp
[Index(Name = "PlayersByScore", Type = IndexType.SortedList)]
public int Score { get; set; }
```

```
// Schema-based
table Player {
  score: int @index(name: "PlayersByScore", kind: sorted_list)
}
```

#### Data Structure

Uses a dense sorted array of object IDs kept in sorted order by key. Range queries use binary search for O(log n) bound location.

#### API

Supports the same range query methods as `SortedSet`:

| Method | Complexity | Description |
|--------|------------|-------------|
| `QueryGreaterThan(key)` | O(log n + k) | All entities with key > threshold. |
| `QueryLessThanOrEqual(key)` | O(log n + k) | All entities with key ≤ threshold. |
| Range queries | O(log n + k) | All standard range predicates. |
| Ordered iteration | O(n) | Dense array traversal. |

#### Complexity

| Operation | Time |
|-----------|------|
| Point lookup | O(log n) via binary search |
| Range scan | O(log n + k) |
| Insert | O(n) — requires array shifting |
| Remove | O(n) — requires array shifting |

#### When to Use

- Small collections where insert/remove is infrequent.
- Queries that benefit from cache-friendly dense array iteration.
- When the compiler maps `sorted_list` schema declarations.

#### SortedSet vs SortedList

| Property | SortedSet | SortedList |
|----------|-----------|------------|
| Insert/Remove | O(log n) | O(n) |
| Range lookup | O(log n + k) | O(log n + k) |
| Memory layout | Tree nodes (scattered) | Dense array (cache-friendly) |
| Best for | Large, frequently mutated sets | Small, rarely mutated sets |

---

### RangeLookupIndex\<TRangeKey\>

Answers **O(1) EXISTS queries** for group-specific range predicates. Designed for patterns like _"does any order in group X have quantity > 100?"_ without scanning.

#### Declaration

```csharp
[Index(Name = "OrderQuantityRange",
       Type = IndexType.RangeLookup,
       Keys = new[] { "OrderId" },
       RangeProperty = "Quantity")]
public int OrderId { get; set; }
```

#### Data Structure

Three sparse arrays indexed by `int` group key, tracking the minimum value, maximum value, and data presence for each group. Initial capacity: 1024 slots. Arrays grow automatically as higher group keys are observed.

#### API

All query methods are O(1):

| Method | Semantics |
|--------|-----------|
| `ExistsGreaterThan(groupKey, threshold)` | `max > threshold` |
| `ExistsGreaterThanOrEqual(groupKey, threshold)` | `max >= threshold` |
| `ExistsLessThan(groupKey, threshold)` | `min < threshold` |
| `ExistsLessThanOrEqual(groupKey, threshold)` | `min <= threshold` |
| `ExistsInRange(groupKey, lo, hi)` | `min <= hi && max >= lo` (range overlap) |
| `ContainsGroup(groupKey)` | `true` if the group has any items |
| `GetMax(groupKey)` | Maximum range value in the group |
| `GetMin(groupKey)` | Minimum range value in the group |
| `EnsureSynchronized()` | Force sync barrier before bulk checks |
| `EnumerateGroupsGreaterThan(threshold)` | Zero-allocation scan of groups with max > threshold |
| `EnumerateGroupsGreaterThanOrEqual(threshold)` | Zero-allocation scan of groups with max ≥ threshold |

**"AssumeSynced" variants** (`ExistsGreaterThanAssumeSynced`, etc.) skip the sync barrier for generated code that has already called `EnsureSynchronized()` once before a loop.

#### Incremental Maintenance

- **Adds** update min/max inline — O(1).
- **Removes** that hit a min/max boundary mark the group dirty. Only dirty groups are rebuilt on the next query — not the entire index.

#### Example

```csharp
table "OrderItems", PersistenceType.Local, capacity: 50_000)]
public record OrderItem
{
    public int Id { get; set; }

    [Index(Name = "OrderQuantityRange",
           Type = IndexType.RangeLookup,
           Keys = new[] { "OrderId" },
           RangeProperty = "Quantity")]
    public int OrderId { get; set; }

    public int Quantity { get; set; }
}

// Query: "Does order #42 have any item with quantity > 100?"
// Compiles to: index.ExistsGreaterThan(42, 100)  → O(1)
```

#### When to Use

- EXISTS-style range checks within groups (semi-join patterns).
- Cross-table filtering: "does the related table have any row matching a range predicate?"
- Any pattern where you need a boolean answer about range existence, not the actual rows.

#### Limitations

- Only answers EXISTS questions — does not return matching entities.
- Group key must be `int` (designed for entity ID foreign keys).
- Min/max approximation: reports that a range *may* contain matches (no false negatives, but removing the actual min/max triggers a group rescan).

---

### GroupedSortedIndex\<TRangeKey\>

Optimized for the common game-client pattern: **group by an integer key, then iterate each group in sorted order by a range key** (e.g., _"top scores per guild"_, _"items by category sorted by price"_).

#### Declaration

```csharp
[Index(Name = "ScoresByGuild",
       Type = IndexType.GroupedSorted,
       Keys = new[] { "GuildId" },
       RangeProperty = "Score")]
public int GuildId { get; set; }
```

```
// Schema-based
@@index(fields: [guild_id], name: "ScoresByGuild", kind: grouped_sorted, range: "score")
```

#### Data Structure

`List<Entry>?[]` — a sparse array indexed by `int` group key. Each non-null slot is a sorted list kept in **descending** order by `TRangeKey`.

Insertion uses binary search for O(log k) placement within a group of k elements. A parallel tracking array maps each entity to its position for O(1) removal.

#### API

| Method | Complexity | Description |
|--------|------------|-------------|
| `QueryDirectDescending(groupKey)` | O(1) group access | Zero-allocation descending iteration. |
| `QueryDirectDescendingByRef(groupKey)` | O(1) group access | By-ref descending (no struct copies). |
| `QueryDirectAscending(groupKey)` | O(1) group access | Zero-allocation ascending iteration. |
| `QueryDirectAscendingByRef(groupKey)` | O(1) group access | By-ref ascending. |

All enumerables are zero-allocation struct types supporting `foreach`.

#### Target Query Pattern

```dsl
from Scores
| filter GuildId == @guildId
| sort -Score
| take 10
```

The compiler recognizes this filter + sort + take pattern and routes it to a `GroupedSortedIndex`. The group is accessed in O(1), and iteration is already in the required descending order — no runtime sort needed.

#### Example

```csharp
table "Scores", PersistenceType.Local, capacity: 100_000)]
public record Score
{
    public int Id { get; set; }

    [Index(Name = "ScoresByGuild",
           Type = IndexType.GroupedSorted,
           Keys = new[] { "GuildId" },
           RangeProperty = "Points")]
    public int GuildId { get; set; }

    public int Points { get; set; }
}

// "Top 10 scores in guild #7" → O(1) group access + O(10) iteration
// No sorting at query time — data is pre-sorted.
```

#### When to Use

- Top-N per group queries (leaderboards, category rankings).
- Patterns combining `filter GroupKey == X | sort ±RangeKey | take N`.
- When the group key is a dense integer (entity ID, category enum).

#### Limitations

- Group key must be `int` (sparse array addressing).
- Insertion is O(log k) per group (binary search + list insert with shifting).
- Not suitable for groups with very frequent mutations and large group sizes — consider `SortedSet` in that case.

---

### GlobalAggregationIndex\<TValue\> (IndexType.Aggregation)

O(1) **global** (ungrouped) aggregations over an entire `DbSet`. Pre-computes Sum, Count, Min, Max as entities are added, updated, and removed.

#### Declaration

```csharp
[Index(Name = "GlobalGold",
       Type = IndexType.Aggregation,
       ValueProperty = "Gold")]
public int Gold { get; set; }
```

#### Data Structure

Maintains running `sum`, `count`, `min`, and `max` values that are updated incrementally as entities are added, updated, and removed.

#### API

| Method | Complexity | Description |
|--------|------------|-------------|
| `GetGlobalSum()` | O(1) | Sum of all values. |
| `GetGlobalAverage()` | O(1) | `Sum / Count`. |
| `GetGlobalCount()` | O(1) | Number of entities. |
| `GetGlobalMin()` | O(1) amort. | Minimum value. |
| `GetGlobalMax()` | O(1) amort. | Maximum value. |
| `GetAllGlobalStats()` | O(1) amort. | Returns `(sum, avg, min, max, count)` tuple. |

#### Min/Max Tracking

Min/Max tracking is **lazy**: the frequency map (`SortedDictionary<TValue, int>`) is only materialized when a removal hits the current min or max. This avoids the cost of maintaining a sorted structure for workloads dominated by inserts.

Once materialized, the sorted dictionary provides O(log n) min/max recomputation via its first/last key.

#### Example

```csharp
// O(1) access to the total gold in the game economy:
var totalGold = goldIndex.GetGlobalSum();
var avgGold = goldIndex.GetGlobalAverage();
```

#### When to Use

- Dashboard metrics: total currency, average player level, global min/max score.
- Any ungrouped aggregate that would otherwise require a full-table scan.

#### Limitations

- Only supports numeric value types (`struct` with `IComparable<TValue>`).
- Sum uses `long` — overflow is possible for very large values.
- Value type must be convertible via `Convert.ToInt64()`.

---

### UniversalAggregationIndex\<TKey, TValue\> (IndexType.UniversalAggregation)

Pre-computed **grouped** aggregations — O(1) per metric per group. The grouped equivalent of `GlobalAggregationIndex`.

ConjureDB provides three aggregation index variants, automatically selected based on the query's aggregation needs:

| Variant | Class | Per-Key Footprint | Aggregations |
|---------|-------|-------------------|--------------|
| Full stats | `AllStatsAggregationIndex<TKey, TValue>` | ~40 bytes | Sum, Avg, Count, Min, Max |
| Sum + Count | `SumCountAggregationIndex<TKey>` | 12 bytes | Sum, Avg, Count |
| Count only | `CountOnlyAggregationIndex<TKey>` | 4 bytes | Count |

#### Declaration

```csharp
[Index(Name = "TotalScoreByGuild",
       Type = IndexType.UniversalAggregation,
       Keys = new[] { "GuildId" },
       ValueProperty = "Score")]
public int GuildId { get; set; }
```

#### Data Structure (AllStatsAggregationIndex)

`Dictionary<TKey, AggregationStats>` where each stats entry tracks sum, count, min, max, and dirty flags for lazy min/max recomputation.

#### API

| Method | Complexity | Description |
|--------|------------|-------------|
| `GetSum(key)` | O(1) | Sum for the group. |
| `GetAverage(key)` | O(1) | `Sum / Count` for the group. |
| `GetCount(key)` | O(1) | Number of entities in the group. |
| `GetMin(key)` | O(1) amort. | Minimum value; rescans group if dirty. |
| `GetMax(key)` | O(1) amort. | Maximum value; rescans group if dirty. |
| `Keys` | — | `IEnumerable<TKey>` of all group keys. |
| `EnumerateSums()` | O(n) | Zero-allocation struct enumerable of `(Key, Sum)` pairs. |
| `EnumerateAllStats()` | O(n) | Zero-allocation struct enumerable of `(Key, Sum, Min, Max, Count)`. |
| `EnumerateTopSums(limit)` | O(k) | Top-K groups by sum (descending), pre-sorted. |
| `EnumerateTopAllStats(limit)` | O(k) | Top-K with full stats, pre-sorted. |

#### Lazy Min/Max Recomputation

When an element is removed, the index cannot cheaply determine whether it held the current min or max. Instead, it sets a dirty flag. On the next `GetMin` or `GetMax` call, the index rescans the group. Insertions that extend the current extrema clear the flag immediately.

**Trade-off:** If your workload has frequent deletes and frequent `GetMin`/`GetMax` calls, consider a `SortedSet` index (O(log n) extrema via tree navigation) instead of an aggregation index (O(k) recomputation on dirty min/max, where k = group size).

#### Ranking Support

When `enableRanking` is true (default), the index maintains a pre-sorted ranking cache of groups by sum (descending) with ascending key tiebreak. `EnumerateTopSums(limit)` returns results in O(k) without any sorting at query time.

#### Example

```csharp
table "Scores", PersistenceType.Local, capacity: 100_000)]
public record Score
{
    public int Id { get; set; }

    [Index(Name = "ScoreStatsByGuild",
           Type = IndexType.UniversalAggregation,
           Keys = new[] { "GuildId" },
           ValueProperty = "Points")]
    public int GuildId { get; set; }

    public int Points { get; set; }
}

// O(1) queries:
// Total points for guild #7:  index.GetSum(7)
// Average points per player:  index.GetAverage(7)
// Top 10 guilds by total:     index.EnumerateTopSums(10)
```

#### When to Use

- Real-time dashboards: per-guild scores, per-category totals.
- Leaderboard aggregates: "which guild has the highest total score?"
- Any grouped metric that would otherwise require `GROUP BY` + aggregation scan.

#### Limitations

- Sum uses `long` — overflow possible for extremely large values.
- Min/Max recomputation after deletes is O(k) per dirty group.
- Memory scales with number of distinct groups.

---

## Composite Indexes

Composite indexes use multiple columns as the key. Declared via the `Keys` property:

```csharp
[Index(Name = "PlayerByGuildAndRole",
       Type = IndexType.Lookup,
       Keys = new[] { "GuildId", "Role" })]
public int GuildId { get; set; }
```

In schema files, use `@@index` at the table level:

```
table Player {
  id: int @id
  guild_id: int
  role: string
  level: int

  @@index(fields: [guild_id, role], name: "PlayerByGuildAndRole", kind: lookup)
  @@index(fields: [level], name: "Level_Sorted", kind: sorted_set)
}
```

### Key Encoding Strategies

For composite keys with low-cardinality string components, packed encodings eliminate heap allocation:

| Encoding | Key Layout | Resulting Key Type | Benefit |
|----------|------------|--------------------|---------|
| `Default` | Standard composite key | Tuple / struct | General purpose |
| `PackedInt32LowCardStringToUInt64` | `int + string` → `ulong` | `ulong` | 8-byte key, no string alloc |
| `PackedUInt8LowCardStringToUInt16` | `byte + string` → `ushort` | `ushort` | 2-byte key (≤255 int values, ≤255 strings) |
| `PackedUInt16LowCardStringToUInt32` | `ushort + string` → `uint` | `uint` | 4-byte key (≤65535 int values, ≤65535 strings) |

Packed encodings map the string portion to a dense integer via an interning table, then bit-pack it with the integer portion. This enables the composite key to use integer-specialized hash maps for maximum performance.

```csharp
[Index(Name = "PlayerByGuildAndRole",
       Type = IndexType.Lookup,
       Keys = new[] { "GuildId", "Role" },
       KeyEncoding = IndexKeyEncoding.PackedInt32LowCardStringToUInt64)]
public int GuildId { get; set; }
```

> **Precondition:** The planner must prove that the integer and string values fit within the encoding's range. If selected without satisfying preconditions, runtime will fail fast.

---

## Index Declaration

### Attribute-Based (`schema index`)

The `schema index` attribute is applied to entity properties. Multiple indexes can be declared on the same property:

```csharp
table "Players", PersistenceType.Local, capacity: 10_000)]
public record Player
{
    public int Id { get; set; }

    [Index(Name = "PlayersByGuild", Type = IndexType.Lookup)]
    [Index(Name = "GuildScoreAgg",
           Type = IndexType.UniversalAggregation,
           Keys = new[] { "GuildId" },
           ValueProperty = "Score")]
    public int GuildId { get; set; }

    [Index(Name = "PlayerByEmail", Type = IndexType.Unique)]
    public string Email { get; set; }

    [Index(Name = "PlayersByLevel", Type = IndexType.SortedSet)]
    public int Level { get; set; }

    public int Score { get; set; }
}
```

### Full `schema index` Attribute Reference

```csharp
[Index(
    Name = "...",                      // Required. Unique index name within the entity.
    Type = IndexType.Lookup,           // Index type (default: Lookup).
    Keys = new[] { "Col1", "Col2" },   // Composite key columns. Null = attributed property only.
    IncludedColumns = new[] { "Col3" },// Covering index columns for index-only scans.
    ValueProperty = "...",             // Value column for aggregation indexes.
    RangeProperty = "...",             // Range column for RangeLookup / GroupedSorted.
    FilterPredicate = "...",           // Partial index filter expression.
    FilterColumns = new[] { "..." },   // Columns referenced by FilterPredicate.
       KeyEncoding = IndexKeyEncoding.Default, // Composite key packing strategy.
       SpatialDimensions = SpatialDimensions.TwoDimensional, // 2D/3D layout for SpatialGrid indexes.
       CellSize = 100.0f,                  // Uniform cell size for SpatialGrid indexes.
       CoordinateProperties = new[] { "PosX", "PosY" } // Explicit coordinate members for SpatialGrid indexes.
)]
```

### Schema-Based (`.conjure`)

In schema files, indexes can be declared at the field level or table level:

**Field-level:**
```
table Player {
  name: string @index(name: "Name_Idx", kind: lookup)
  level: int   @index(name: "Level_Sorted", kind: sorted_set)
}
```

**Table-level (`@@index`):**
```
table Player {
  id: int @id
  guild_id: int
  level: int

  @@index(fields: [guild_id, level], name: "GuildLevel_Lookup", kind: lookup)
}
```

**Available `kind` values:** `lookup`, `sorted_set`, `sorted_list`, `unique`, `aggregation`, `universal_aggregation`, `range_lookup`, `grouped_sorted`, `spatial_grid`.

---

## Covering Indexes and Index-Only Scans

When a query only accesses columns that are part of the index key plus `IncludedColumns`, the optimizer can perform an **index-only scan** — reading data directly from the index without dereferencing the main table. This is significant I/O savings on mobile devices.

```csharp
[Index(Name = "PlayersByGuild",
       Type = IndexType.Lookup,
       Keys = new[] { "GuildId" },
       IncludedColumns = new[] { "Name", "Level" })]
public int GuildId { get; set; }

// This query can use an index-only scan:
// from Players | filter GuildId == 42 | select Name, Level
// No table dereference needed — Name and Level are in the index.
```

---

## Partial (Filtered) Indexes

Partial indexes include only a subset of rows, reducing memory footprint and maintenance cost:

```csharp
[Index(Name = "ActivePlayersByLevel",
       Type = IndexType.SortedSet,
       Keys = new[] { "Level" },
       FilterPredicate = "IsActive == true",
       FilterColumns = new[] { "IsActive" })]
public int Level { get; set; }
```

The optimizer uses `FilterColumns` to determine if a query's `WHERE` clause implies the index predicate. If the query filters on `IsActive == true`, the partial index is eligible; otherwise it is not.

**Supported on all secondary index types** — Lookup, SortedSet, RangeLookup, GroupedSorted, and aggregation indexes all accept filter predicates.

---

## Query Optimizer Integration

The ConjureDB compiler automatically selects the optimal index for each query. Understanding how this works helps you design effective indexes.

### Scan Strategy Selection

The `ScanStrategyPlanner` generates multiple physical alternatives for every table access:

| Strategy | Description | When Used |
|----------|-------------|-----------|
| `FullScan` | Iterate all entities in the `PrimaryIndex` | Baseline (always generated) |
| `PrimaryKeyLookup` | Direct `TryFindById()` via PrimaryIndex | `filter Id == @param` |
| `SecondaryIndexScan` | Hash lookup via LookupIndex | `filter Column == value` |
| `SortedSetScan` | Ordered iteration via SortedSetIndex | `sort Column` without filter |
| `IndexedScan` | Range scan via SortedSetIndex | `filter Column >= X and Column <= Y` |
| `IndexOnlyScan` | Covering index scan (no table dereference) | Query uses only indexed + included columns |

### Filter Index Selection

The `FilterStrategyPlanner` analyzes filter predicates and maps them to index-backed strategies:

| Predicate Type | Strategy | Index Type Used |
|----------------|----------|-----------------|
| Equality (`==`) | `IndexedLookup` | Lookup or Unique |
| Range (`>=`, `<=`, `BETWEEN`) | `IndexedRange` | SortedSet |
| Group + Sort | `GroupedSorted` | GroupedSorted |
| Primary key | `PrimaryKeyLookup` | PrimaryIndex |

The optimizer extracts AND conjuncts from complex predicates and detects range patterns (e.g., `X >= lo AND X <= hi` → `BETWEEN`) to select the most efficient index.

### Join Optimization

The `JoinSecondaryIndexPlanner` discovers candidate indexes on the lookup side of joins:

| Index Kind | Predicate Type | Join Strategy |
|------------|----------------|---------------|
| Unique | Equality | `UniqueIndexLookup` — always preferred |
| Lookup | Equality | `SecondaryIndexLookup` — hash probe per row |
| SortedSet | Range | `SortedSetRange` — range-based probe |
| SortedSet | Equality | `SecondaryIndexLookup` — hash probe fallback |

### Cost Model

The optimizer generates **all viable alternatives** and uses a cost model to select the cheapest plan. Key factors:

- **Selectivity estimates** guide filter strategy ranking.
- **PGO hints** (Profile-Guided Optimization) can override strategy selection based on runtime profiling.
- The `CascadesOptimizationStage` explores the full search space before the `PhysicalPlanningStage` selects a winner.

---

## Foreign Keys and References

### Foreign Keys

`[ForeignKey]` declares a relationship used by the optimizer for join strategy selection:

```csharp
table "Items")]
public record Item
{
    public int Id { get; set; }

    [ForeignKey(nameof(Player))]
    public int PlayerId { get; set; }

    public string Name { get; set; }
}
```

The compiler uses FK declarations to:
- Infer key bounds for optimization (e.g., DenseHeap strategy).
- Select efficient join strategies (index-nested-loop joins via PrimaryIndex).

### Injected References

For read-only config tables, `[InjectReference]` generates a direct O(1) getter:

```csharp
[InjectReference(nameof(ItemTemplate))]
public int TemplateId { get; set; }
```

This resolves the referenced entity through the target table's `PrimaryIndex` — an O(1) pointer chase rather than a join. Use for immutable lookup tables (item templates, config data).

---

## SpatialGridIndex

Uniform spatial hash grid for nearby-object queries in 2D or 3D worlds. Space is partitioned into fixed-size cells; entities are assigned to cells based on `floor(coord / cellSize)`. Queries identify candidate cells, iterate their contents, and apply exact Euclidean-distance refinement. Designed for high-frequency proximity lookups typical in game clients — entity detection, area-of-effect, collision pre-filtering.

### Declaration

**C# attribute:**

```csharp
table "GameObjects", PersistenceType.Local, capacity: 50_000)]
public record GameObject
{
    public int Id { get; set; }

    [Index("spatial_pos", Type = IndexType.SpatialGrid,
        SpatialDimensions = SpatialDimensions.TwoDimensional,
        CellSize = 100f,
        CoordinateProperties = new[] { "PosX", "PosY" })]
    public float PosX { get; set; }
    public float PosY { get; set; }
    public string Name { get; set; } = "";
}
```

**Schema (`.conjure`):**

```
table GameObjects {
  id: int @id
  pos_x: float
  pos_y: float
  pos_z: float
  name: string

  @@index(fields: [pos_x], name: "spatial_pos", kind: spatial_grid,
          coordinates: [pos_x, pos_y], dimensions: 2, cell_size: 100)

  @@index(fields: [pos_x], name: "spatial_pos_3d", kind: spatial_grid,
          coordinates: [pos_x, pos_y, pos_z], dimensions: 3, cell_size: 50)
}
```

### Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `SpatialDimensions` | `SpatialDimensions` | `TwoDimensional` | `TwoDimensional` (X, Y) or `ThreeDimensional` (X, Y, Z) |
| `CellSize` | `float` | `100.0f` | Uniform side length of each grid cell |
| `CoordinateProperties` | `string[]` | — | Property names for coordinates; 2 elements for 2D, 3 for 3D |

### Data Structure

A hash map from integer cell keys (`floor(x / cellSize)`, `floor(y / cellSize)`, …) to lists of dense entity IDs. Only occupied cells consume memory — empty regions of the world have zero cost.

### Query Types

| Query Kind | Runtime Method | Semantics |
|------------|----------------|-----------|
| **Radius** | `QueryWithinRadius2D` / `QueryWithinRadius3D` | All entities within Euclidean radius of a center point |
| **Bounds** | `QueryWithinBounds2D` / `QueryWithinBounds3D` | All entities inside an axis-aligned bounding box |
| **NearestK** | `QueryNearestK2D` / `QueryNearestK3D` | K nearest entities to a center point (exact, deterministic tie-breaking) |

All query methods accept a caller-provided `Span<int>` buffer and return the count of matching entity IDs written into it. Generated code uses `stackalloc` buffers (default 256 elements) for zero-allocation queries.

### DSL Queries

Spatial queries use built-in functions in `filter` expressions. The compiler detects these patterns and plans a `PhysicalSpatialScan` instead of a full table scan.

```
// Find all objects within 50 units of a point
from GameObjects
| filter within_radius(PosX, PosY, @centerX, @centerY, 50.0)
| select Name, PosX, PosY

// Find all objects in a bounding box
from GameObjects
| filter within_bounds(PosX, PosY, @minX, @minY, @maxX, @maxY)
| select Name, PosX, PosY

// 3D radius query
from GameObjects
| filter within_radius(PosX, PosY, PosZ, @cx, @cy, @cz, @radius)
| select Name, PosX, PosY, PosZ

// Combine spatial filter with other predicates
from GameObjects
| filter within_radius(PosX, PosY, @cx, @cy, @radius) and IsActive == true
| select Name, PosX, PosY
```

When a spatial predicate is combined with non-spatial predicates (e.g., `and IsActive == true`), the optimizer applies the spatial index for candidate selection and evaluates the remaining predicate as a residual post-filter.

### Complexity

| Operation | Complexity | Notes |
|-----------|------------|-------|
| Insert / Remove / Move | O(1) | Hash lookup + list append/remove |
| Radius / Bounds query | O(cells_in_range × entities_per_cell) | Exact refinement per candidate |
| NearestK query | O(cells_in_range × entities_per_cell) | Expanding search with exact sort |

### Cell Size Guidance

Cell size determines the trade-off between query precision and memory/iteration cost:

| Cell Size vs. Query Radius | Effect |
|----------------------------|--------|
| `cellSize ≈ typical radius` | Optimal — queries touch ~4 cells (2D) or ~8 cells (3D) |
| `cellSize ≪ radius` | Many cells iterated per query; higher overhead |
| `cellSize ≫ radius` | Few cells but many false-positive candidates; more refinement work |

**Rule of thumb:** set `CellSize` close to your most common query radius. For a game with 100-unit interaction range, `CellSize = 100` is a good starting point.

### When to Use

- Proximity queries in 2D/3D game worlds (nearby enemy detection, loot pickup range).
- Area-of-effect targeting (splash damage, heal zones).
- Collision detection broad phase.
- K-nearest-neighbor queries (find closest N allies).
- Any workload where entities have spatial coordinates and queries are position-based.

### Limitations

- **Euclidean distance only** — no geodesic (spherical) distance, no Manhattan distance.
- **No toroidal wrap** — wrapping worlds are not supported; coordinates are treated as flat Cartesian.
- **No polygon / arbitrary geometry queries** — only axis-aligned bounds and circular/spherical regions.
- **Coordinate properties must be explicit** — auto-detection from composite structs is not supported; list individual `float` properties.
- **Static cell size** — cell size is set at index declaration and cannot be changed at runtime.
- **No temporal dimension** — moving queries (e.g., trajectory intersection) are not supported.

---

## Custom Collection Types

ConjureDB ships low-level collection types in `ConjureDB.Collections`. These are the building blocks used internally by every index, and are available for direct use.

### High-Performance Hash Maps

General-purpose open-addressing hash tables optimized for different key types.

| Property | Value |
|----------|-------|
| Load factor | 0.75 |
| Collision resolution | Linear probing with displacement tracking |

Integer-key variants use power-of-2 capacity with bitwise masking and type-specialized hash functions for optimal performance.

### SparseSet\<T\>

Dual-array data structure: O(1) add, get, remove, contains via swap-and-pop.

| Operation | Complexity |
|-----------|------------|
| Add / Contains / Remove / Get | O(1) |
| Iteration | O(n) dense, no gaps |

### OrderStatisticTree

Augmented red-black tree with per-node `size` field:

| Operation | Complexity |
|-----------|------------|
| Insert / Remove | O(log n) |
| Select(k) | O(log n) — k-th smallest element |
| Rank(key) | O(log n) — position of a key |

Useful for leaderboard queries with positional lookups.

### Pooled Hash Maps

`ArrayPool`-backed, append-only maps for short-lived aggregation contexts. Rent from the shared pool to avoid GC pressure.

---

## Performance Considerations

### Memory Overhead Per Index Type

| Index Type | Per-Entity Overhead | Per-Key Overhead | Notes |
|------------|---------------------|------------------|-------|
| PrimaryIndex | ~12 bytes (dense slot + ID mapping) | — | Always present |
| Lookup | 4 bytes (objectId in list) | Hash bucket overhead | Type-specialized maps reduce overhead |
| Unique | — | ~20 bytes (dictionary entry) | One entry per entity |
| SortedSet | 4 bytes (objectId in group) | ~80 bytes (tree node + group) | Plus cached snapshot arrays |
| RangeLookup | — | ~17 bytes (min + max + hasData) | Sparse arrays; empty groups cost nothing |
| GroupedSorted | ~8 bytes (Entry + indexInGroup) | List overhead per group | Sparse array of lists |
| Aggregation | — | ~48 bytes (stats fields) | Global only — no per-entity overhead |
| UniversalAggregation | — | 12–40 bytes per group (variant-dependent) | Dictionary + stats struct |
| SpatialGrid | 4 bytes (objectId in cell list) | Hash bucket per occupied cell | Only occupied cells consume memory |

### Update Cost

| Index Type | Insert | Remove | Key Change |
|------------|--------|--------|------------|
| Lookup | O(1) | O(1) | O(1) + O(1) |
| Unique | O(1) | O(1) | O(1) + O(1) |
| SortedSet | O(log n) | O(log n) | O(log n) + O(log n) |
| SortedList | O(n) | O(n) | O(n) + O(n) |
| RangeLookup | O(1) | O(1) amort. | O(1) amort. |
| GroupedSorted | O(log k) | O(1) | O(log k) + O(1) |
| Aggregation | O(1) | O(1) amort. | O(1) amort. |
| UniversalAggregation | O(1) | O(1) amort. | O(1) amort. |
| SpatialGrid | O(1) | O(1) | O(1) (re-hash to new cell) |

### When NOT to Index

- **Very small tables** (< 100 rows): Full scan is faster than index maintenance.
- **Write-heavy, read-light columns**: Index update cost outweighs query benefit.
- **High-cardinality unique columns already covered by PrimaryIndex**: Redundant.
- **Columns never used in filters, sorts, or joins**: Dead index overhead.

### Index Count Guidelines

- **1–3 secondary indexes per table** is typical for game-client workloads.
- Each index adds deferred-commit processing to every transaction.
- The optimizer considers all declared indexes — unused indexes only waste memory and update time.
- Use PGO recommendations to identify which indexes are actually exercised.

---

## PGO Index Recommendations

[Profile-Guided Optimization](/docs/performance/pgo) (PGO) can provide index guidance, but the
current repository supports that through **two bounded paths**, not a single
"complete index oracle".

### How PGO Suggests Indexes

1. **Profile-side evidence collection**
   - profiling/export produces canonical `AutoIndexCandidates` and
     `GroupedIndexProfiles` in the `PgoProfile`.
   - these candidates carry normalized descriptors, evidence metadata, what-if
     deltas, and reason codes.

2. **Compile-time what-if planning**
   - the planning-owned `AutoIndexAdvisor` builds hypothetical one-index schema
     overlays and re-plans the query to estimate marginal benefit.
   - candidates are deterministically bucketed into `recommended`,
     `held-back`, and `suppressed` sets under explicit per-table/global/write/
     memory budgets.
   - the compiler writes a derived `auto-index-report.json` and exposes the same
     advisory summary through `PlanExplain.AutoIndexAdvisory`.

Today, the strongest supported claim is that PGO helps discover and rank useful
indexes for covered shapes in a **report-only** workflow. The repository does
**not** claim that PGO always discovers the full globally optimal index set for
every query or workload.

### Covered guidance today

- **Full table scans** that could be avoided with an index.
- **Missing filter support** for covered predicate shapes.
- **Join predicates without index support** for covered join patterns.
- **Sort / TopN** patterns where ordered access would be cheaper.
- **Grouped-index usage** from runtime profile data.

Each recommendation/report includes rationale, evidence quality, status, and
what-if metadata in structured output.

### Accepting Recommendations

PGO guidance is intentionally accepted through **explicit schema ownership**:

1. Enable `CompilerOptions.AutoIndexing.Mode = ReportOnly`.
2. Review `auto-index-report.json` or `PlanExplain.AutoIndexAdvisory`.
3. Optionally use the profiling CLI to inspect evidence and generate a patch preview:
   - `auto-index analyze`
   - `auto-index show`
   - `auto-index patch --surface csharp|schema`
4. Record the owner decision in `.conjuredb/auto-index.decisions.json` with
   `auto-index decide` if you want future reviews to suppress or mark the
   candidate as already accepted.
5. Add the chosen `schema index` attribute or schema declaration explicitly.
6. Re-compile and re-profile to verify the improvement.

The current production path does **not** auto-create indexes, mutate schema
metadata during compilation, or route advisory candidates into runtime/codegen
materialization.

### CLI Review Workflow

```bash
dotnet run --project ConjureDB.Profiling -- auto-index analyze --profile ./profiles/game.json
dotnet run --project ConjureDB.Profiling -- auto-index show --profile ./profiles/game.json --candidate 1
dotnet run --project ConjureDB.Profiling -- auto-index patch --profile ./profiles/game.json --candidate 1 --surface schema
dotnet run --project ConjureDB.Profiling -- auto-index decide --profile ./profiles/game.json --candidate 1 --decision accepted --surface schema --target-file ./schema/game.conjure
```

Important DX constraints:

- `patch` previews/export diffs only; it does not edit tracked files.
- `surface` is always explicit. The tool never guesses between C# and schema.
- ambiguous ownership fails closed and reports candidate target files instead of
  mutating anything.
- accepted/suppressed decisions only affect review noise and ranking; they do
  not change compilation semantics until you explicitly add the index to schema.

### Profile-Driven Index Lifecycle

```
Profile query workload  →  PGO/runtime advisor surfaces canonical candidates
      ↓
Compile with ReportOnly  →  what-if planning ranks candidates
      ↓
Accept explicitly via schema index attributes or schema declarations
      ↓
Re-compile  →  Optimizer uses new indexes
      ↓
Re-profile  →  Verify improvement, remove unused indexes
```

---

## Best Practices

### Choosing the Right Index Type

| Query Pattern | Recommended Index | Why |
|---------------|-------------------|-----|
| `filter X == value` | **Lookup** | O(1) hash lookup |
| `filter X == value` (unique) | **Unique** | O(1) + integrity guarantee |
| `filter X >= lo and X <= hi` | **SortedSet** | O(log n + k) range scan |
| `sort X` / `sort -X` | **SortedSet** | Cached ordered arrays |
| `sort X \| take 1` (min/max) | **SortedSet** | First/last element of cached array |
| `filter GroupKey == x \| sort -Y \| take N` | **GroupedSorted** | Pre-sorted groups, O(1) access |
| "Does group X have any Y > Z?" | **RangeLookup** | O(1) EXISTS check |
| `select sum(X), count(X) group by Y` | **UniversalAggregation** | Pre-computed O(1) per group |
| `select sum(X) from Table` | **Aggregation** | Pre-computed O(1) global |
| Unique constraint enforcement | **Unique** | Throws on duplicate |
| `filter within_radius(X, Y, ...)` | **SpatialGrid** | Spatial hash grid, O(cells × ents/cell) |
| `filter within_bounds(X, Y, ...)` | **SpatialGrid** | Spatial hash grid, AABB candidate selection |
| Nearest-K entities to a point | **SpatialGrid** | Exact K-nearest with deterministic tie-breaking |

### Index Naming Conventions

- Use descriptive names: `PlayersByGuild`, `ItemsByPrice`, `ScoreStatsByGuild`.
- For composite keys: `PlayerByGuildAndRole`.
- For aggregations: `TotalScoreByGuild`, `GlobalGold`.
- For partial indexes: `ActivePlayersByLevel`.

### Common Game Patterns

#### Inventory System

```csharp
table "Items", PersistenceType.Local, capacity: 5_000)]
public record Item
{
    public int Id { get; set; }

    [ForeignKey(nameof(Player))]
    [Index(Name = "ItemsByPlayer", Type = IndexType.Lookup)]
    public int PlayerId { get; set; }

    [Index(Name = "ItemsByRarity", Type = IndexType.SortedSet)]
    public int Rarity { get; set; }

    [Index(Name = "ItemsByPlayerSortedByRarity",
           Type = IndexType.GroupedSorted,
           Keys = new[] { "PlayerId" },
           RangeProperty = "Rarity")]
    public int PlayerId2 => PlayerId; // GroupedSorted uses int group key

    public string Name { get; set; }
    public int Quantity { get; set; }
}

// "All items for player #42":             filter PlayerId == 42
// "Player #42's rarest items":            filter PlayerId == 42 | sort -Rarity | take 5
// "All legendary items (rarity >= 90)":   filter Rarity >= 90
```

#### Leaderboard

```csharp
table "Scores", PersistenceType.Local, capacity: 100_000)]
public record Score
{
    public int Id { get; set; }

    [Index(Name = "ScoresByPlayer", Type = IndexType.Lookup)]
    public int PlayerId { get; set; }

    [Index(Name = "ScoresSorted", Type = IndexType.SortedSet)]
    public long Points { get; set; }

    [Index(Name = "ScoreStatsByGuild",
           Type = IndexType.UniversalAggregation,
           Keys = new[] { "GuildId" },
           ValueProperty = "Points")]
    [Index(Name = "TopScoresByGuild",
           Type = IndexType.GroupedSorted,
           Keys = new[] { "GuildId" },
           RangeProperty = "Points")]
    public int GuildId { get; set; }
}

// Global top 10:                   sort -Points | take 10
// Guild #7 total:                  index.GetSum(7)
// Guild #7 top 10:                 filter GuildId == 7 | sort -Points | take 10
// Top 5 guilds by total score:     index.EnumerateTopSums(5)
```

#### Config Lookup

```csharp
table "ItemTemplates", PersistenceType.None, capacity: 1_000)]
public record ItemTemplate
{
    public int Id { get; set; }

    [Index(Name = "TemplateByCode", Type = IndexType.Unique)]
    public string Code { get; set; }

    public string Name { get; set; }
    public int BasePrice { get; set; }
}

// Unique lookup by code:  filter Code == "SWORD_01" | single
// Never duplicates — UniqueIndex throws on insert conflict.
```

---

## Related Documentation

- [Getting Started](/docs/getting-started) — Setup and basic usage
- [Query Language](/docs/query-language/reference) — DSL syntax reference
- [Compiled Queries](/docs/query-language/compiled-queries) — How the compiler selects indexes
- [PGO](/docs/performance/pgo) — Profile-Guided Optimization and index recommendations

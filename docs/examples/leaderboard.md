# Leaderboard (Top-N)

A leaderboard is the canonical "sorted view" workload: take the highest scores, in
order, and keep them current as scores change. ConjureDB compiles the query to a bounded
walk over a sorted index — it never sorts the whole table.

## Schema

```conjure
table Player(plural: Players, persistence: local, capacity: 50000, type_id: 1) {
    Id: int @id
    Name: string
    GuildId: int
    Score: int

    @@index(fields: [Score], name: "PlayersByScore", kind: sorted_set)
}
```

The `sorted_set` index on `Score` is what turns "top N" into an O(N) head-read instead of an
O(n log n) sort. You never name it in a query: the planner picks the access path, and the
declaration only says which paths exist.

## Query

```conjure
query GetTopScorers(minScore: int, count: int) -> Player[] {
    from Player p
    | filter p.Score > @minScore
    | sort { -p.Score, p.Id }
    | take @count
}
```

`sort` takes a key block when there is more than one key, and `-` means descending. The
tie-break on `Id` is what makes the page order reproducible between calls.

## Call it from C#

```csharp
using ConjureDB;

using var ctx = DbContextBuilder<GameDbContext>.Create()
    .WithDataDirectory("./data")
    .WithDefaultSnapshot()
    .Build();

// Compiled: walks PlayersByScore and stops after `count` rows.
var top10 = ctx.Players.GetTopScorers(minScore: 0, count: 10);
```

## Pick the result surface

`-> Player[]` materializes an owned array. When the leaderboard is redrawn every frame,
declare a non-allocating surface instead and let the caller own the lease:

```conjure
query StreamTopScorers(count: int) -> pooled<Player> {
    from Player p
    | sort { -p.Score, p.Id }
    | take @count
}
```

See [Result signatures](/docs/query-language/reference#result-signatures-and-cardinality)
for `pooled<T>`, `seq<T>` and `map<K, V>`.

## Keep it fresh reactively

When you want the leaderboard to update as scores change — without recomputing it every
frame — declare it as a reactive query. Incremental view maintenance applies each score
change as a small update to the materialized result. See
[Reactive Queries](/docs/advanced/reactive-queries) and
[performance tips](/docs/performance/performance-tips) for the indexing and reactive
patterns behind this.

# Leaderboard (Top-N)

A leaderboard is the canonical "sorted view" workload: take the highest scores, in
order, and keep them current as scores change. ConjureDB compiles the query to a bounded
walk over a sorted index — it never sorts the whole table.

## Schema

```prql
table Player(plural: Players, persistence: local, capacity: 50000, type_id: 1) {
    Id: int @id
    Name: string
    GuildId: int
    Score: int

    @@index(fields: [Score], name: "PlayersByScore", kind: sorted_set)
}
```

The `sorted` index on `Score` is what turns "top N" into an O(N) head-read instead of an
O(n log n) sort.

## Query

```prql
query GetTopScorers(minScore: int, count: int) -> Player[] {
    from Players
    | filter Score > minScore
    | sort -Score
    | take count
}
```

## Call it from C#

```csharp
using ConjureDB;

using var ctx = DbContextBuilder<GameDbContext>.Create()
    .WithDataDirectory("./data")
    .WithDefaultSnapshot()
    .Build();

// Compiled, allocation-free: walks PlayersByScore and stops after `count` rows.
var top10 = ctx.GetTopScorers(minScore: 0, count: 10);
```

## Keep it fresh reactively

When you want the leaderboard to update as scores change — without recomputing it every
frame — declare it as a reactive query. Incremental view maintenance applies each score
change as a small update to the materialized result. See
[the docs on getting started](/docs/getting-started) and
[performance tips](/docs/performance/performance-tips) for the indexing and reactive
patterns behind this.

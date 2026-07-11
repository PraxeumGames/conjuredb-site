# Stats & Reporting

Aggregations — counts, sums, top-K per group — are where an interpreted engine spends the
most and where compilation pays off the most. ConjureDB plans the grouping and aggregate
placement at build time.

## Group and aggregate

Count players per level and report their average score:

```prql
type LevelStat { Level: int, Players: int, AvgScore: float }

query LevelStats() -> LevelStat[] {
    from Players
    | group Level (
        aggregate {
            Players = count(),
            AvgScore = avg(Score)
        }
    )
    | sort Level
}
```

## Top-K per group with a window function

The "top 3 players per level" shape — a windowed ranking — is one query, not a manual
loop-and-sort:

```prql
type PlayerRank { Level: int, Name: string, Score: int, Rank: int }

query Top3PerLevel() -> PlayerRank[] {
    from Players
    | sort -Score
    | window by Level (Rank = row_number)
    | filter Rank <= 3
    | select { Level, Name, Score, Rank }
}
```

## Call it from C#

```csharp
using ConjureDB;

using var ctx = DbContextBuilder<GameDbContext>.Create()
    .WithNoPersistence()
    .Build();

var perLevel = ctx.LevelStats();
var podium = ctx.Top3PerLevel();
```

For the full catalog of aggregate and window functions, and the SQL ⇄ DSL mapping, see the
[Query Language reference](/docs/query-language/reference) and
[SQL reference & examples](/docs/query-language/sql-reference).

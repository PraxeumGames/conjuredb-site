# Stats & Reporting

Aggregations — counts, sums, top-K per group — are where an interpreted engine spends the
most and where compilation pays off the most. ConjureDB plans the grouping and aggregate
placement at build time.

## Group and aggregate

`group key (pipeline)` opens a scope: the inner pipeline runs once per key, and it is not
itself a reduction — it may filter, sort, limit, project or aggregate.

Counting players per level is a keyed reduction, so the natural result surface is a map:
the group key supplies `K`, the child pipeline supplies `V`.

```conjure
query PlayerCountsByLevel() -> map<int, long> {
    from Player p | group p.Level (aggregate count())
}
```

A row-shaped reduction names its outputs:

```conjure
type LevelStat {
    Players: long
    AvgScore: double?
}

query LevelStats() -> map<int, LevelStat> {
    from Player p
    | group p.Level (
        aggregate { Players = count(), AvgScore = avg(p.Score) }
    )
}
```

`count()` is a non-nullable `long` and is zero on empty input. `avg`, `sum`, `min` and `max`
are absent on empty input — `double?` here — and the declared type has to admit that rather
than inventing a zero. A whole-table reduction drops the group and the name:

```conjure
query TotalScore() -> long? {
    from Player p | aggregate sum(p.Score)
}
```

Aggregate calls are legal only inside `aggregate` or an admitted window invocation. For a
HAVING-style query, reduce first and then filter the named output.

## Top-K per group with a window

There is no `window` stage. A ranking is a named `derive` value inside a scoped group,
ordered by that scope's `sort`:

```conjure
type PlayerRank {
    Level: int
    Name: string
    Score: int
    Rank: long
}

query Top3PerLevel() -> PlayerRank[] {
    from Player p
    | group p.Level (
        sort { -p.Score, p.Id }
        | derive Rank = row_number()
        | filter Rank <= 3
        | select { Level = p.Level, Name = p.Name, Score = p.Score, Rank }
    )
}
```

`row_number`, `rank`, `dense_rank`, `lag` and `lead` carry their own window role and take no
frame. An aggregate used as a window value does need one — `avg(p.Score) over rows(-2, 0)`.

## Call it from C#

```csharp
using ConjureDB;

using var ctx = DbContextBuilder<GameDbContext>.Create()
    .WithNoPersistence()
    .Build();

var perLevel = ctx.LevelStats();        // map<int, LevelStat>
var podium = ctx.Top3PerLevel();
```

For the full catalog of aggregate and window functions, and the SQL ⇄ DSL mapping, see the
[Query Language reference](/docs/query-language/reference) and
[SQL reference & examples](/docs/query-language/sql-reference).

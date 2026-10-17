# Compiled Queries

Compiled queries are declared in `.conjure` schema files and compiled ahead of
time into generated C#. The schema file is the source of truth for table shape,
parameter types, result shape, indexes, and optimization hints.

## Basic Query

```conjure
query GetPlayersByLevel(minLevel: int) -> Player[] {
    from Players
    | filter Level >= @minLevel
    | sort -Level
}
```

The generator lowers this through the compiler pipeline:

```text
.conjure query -> AST -> semantic IR -> canonical IR -> physical plan -> generated C#
```

There is no reflection or runtime query parsing in steady state.

## Result Shapes

Return a table row:

```conjure
query GetPlayer(id: int) -> Player? {
    from Players
    | filter Id == @id
    | single_or_default
}
```

Return a projection:

```conjure
query GetLeaderboard(count: int) -> LeaderboardRow[] {
    from Players
    | sort -Score
    | take @count
    | select {
        playerId = Id,
        name = Name,
        score = Score
    }
}
```

Return aggregates:

```conjure
query GetGuildScoreTotals() -> GuildScoreTotal[] {
    from Players p
    | group p.GuildId (aggregate {
        TotalScore = sum(p.Score),
        PlayerCount = count()
      })
    | select { GuildId = GuildId, TotalScore = TotalScore, PlayerCount = PlayerCount }
}
```

## NoAlloc Variants

Collection queries may expose three generated execution surfaces when their physical
plans satisfy the corresponding compiler contract:

- the ordinary method materializes its result;
- `...NoAlloc()` avoids the ordinary `List<T>` result and returns a
  `DisposableQueryResult<T>` backed by `ArrayPool<T>`; a cold or trimmed pool rent may
  still allocate, so this surface does not claim zero heap for the complete call. Its
  separate compiler-execution proof rejects per-query heap collections, allocating
  expressions, reference-result construction, and unproved index preparation inside
  the selected physical plan;
- `...ForEach<TConsumer>(ref consumer, ...)` streams into caller-owned storage and is
  emitted only when the compiler proves zero heap for the generated query path. The
  caller-owned `TConsumer.OnRow` callback is outside that proof; the complete call is
  zero heap only when the supplied consumer is allocation-free as well.

The compiler optimizes supplementary surfaces independently. An ordinary query may
therefore keep a cheaper allocating hash plan while its `ForEach` surface selects a
direct index lookup that satisfies the compiler-execution zero-heap constraint. If no legal plan can be
proved, generation omits that supplementary surface rather than publishing an
unsound allocation guarantee.

## Cardinality

Use lower-case terminals in schema queries:

```text
| single
| single_or_default
| first
| first_or_default
| any
| count
| to_list
```

`first` and `first_or_default` should have deterministic ordering when exposed
as generated APIs. The compiler warns when order cannot be proven.

## Parameters

Parameters are declared in the query signature and referenced by name:

```conjure
query GetItems(ownerId: int, minRarity: int) -> Item[] {
    from Items
    | filter OwnerId == @ownerId
    | filter Rarity >= @minRarity
    | sort -Rarity
}
```

## Indexes

Declare indexes in the same schema so the optimizer has typed metadata:

```conjure
table Item(plural: Items, persistence: local, capacity: 50000, type_id: 2) {
    Id: int @id
    OwnerId: int
    Rarity: int

    @@index(fields: [OwnerId], name: "ItemsByOwner", kind: lookup)
    @@index(fields: [OwnerId, Rarity], name: "ItemsByOwnerRarity", kind: sorted_set)
}
```

## Materialized View Sources

A compiled query can read a `materialized view` as an ordinary source. From the
query's perspective, when the source is a materialized view and the query shape
matches a declared materialized index, the planner may emit a
`PhysicalMaterializedIndexSeek` instead of executing the source pipeline. With
`rewrite: auto`, candidate substitution preserves residual
predicates/projections and can still become `PhysicalMaterializedIndexSeek` when
a declared materialized index matches. Ordinary queries whose normalized body
matches a reactive query's hidden `ReactiveAutoView` relation are planned over
that already maintained relation/index when equivalence is proven; plan explain
reports the hidden origin, proof kind, selected/base cost, and selected
materialized access. See [Schema Language](/docs/schema/schema-language#66--views-and-materialized-views)
for materialized-view declaration semantics, the `rewrite` option, in-memory
derivation, and `ReactiveAutoView` visibility rules.

## Hints and PGO

Profile-guided optimization data is consumed by the compiler as structured
metadata, not as source-level attributes. Query-local hints belong in schema
hint blocks when an explicit override is required.

## Reactive Queries

Reactive queries use schema declarations and the same query language. For new
schema-first materialized-view sources, reactive execution is a facade over the
materialized relation or materialized index slice. Unsupported reactive shapes
fail before emission rather than producing generated code without a supported
Z-set materialized maintainer.

```conjure
reactive query TopPlayers(count: int) -> Player[] {
    from Players
    | sort -Score
    | take @count
}
```

## Custom Functions

Register external pure functions in schema:

```conjure
extern function calculateDamage(level: int, power: int) -> int =
    Game.Rules.Combat.CalculateDamage
```

The compiler emits direct static calls for approved extern functions.

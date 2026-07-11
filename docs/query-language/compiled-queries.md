# Compiled Queries

Compiled queries are declared in `.conjure` schema files and compiled ahead of
time into generated C#. The schema file is the source of truth for table shape,
parameter types, result shape, indexes, and optimization hints.

## Basic Query

```prql
query GetPlayersByLevel(minLevel: int) -> Player[] {
    from Players
    | filter Level >= @minLevel
    | select { Id, Name, Level }
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

```prql
query GetPlayer(id: int) -> Player? {
    from Players
    | filter Id == @id
    | single_or_default
}
```

Return a projection:

```prql
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

```prql
query GetGuildScoreTotals() -> GuildScoreTotal[] {
    from Players
    | group GuildId (aggregate {
        totalScore = sum(Score),
        playerCount = count()
      })
}
```

## Cardinality

Use lower-case terminals in schema queries:

```prql
| single
| single_or_default
| first
| first_or_default
| any
| count
| to_list
```

`first`/`first_or_default` return the first row in the pipeline's current
order; pair them with an explicit `sort` for a deterministic result, as results
are otherwise unordered.

## Parameters

Parameters are declared in the query signature and referenced by name:

```prql
query GetItems(ownerId: int, minRarity: int) -> Item[] {
    from Items
    | filter OwnerId == @ownerId
    | filter Rarity >= @minRarity
    | sort -Rarity
}
```

## Indexes

Declare indexes in the same schema so the optimizer has typed metadata:

```prql
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
materialized access. See [Schema Language](/docs/schema/schema-language#65--views-and-materialized-views)
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

```prql
reactive query TopPlayers(count: int) -> Player[] {
    from Players
    | sort -Score
    | take @count
}
```

## Custom Functions

Register external pure functions in schema:

```prql
extern function calculateDamage(level: int, power: int) -> int =
    Game.Rules.Combat.CalculateDamage
```

The compiler emits direct static calls for approved extern functions.

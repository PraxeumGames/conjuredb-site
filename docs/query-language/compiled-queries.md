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
        totalScore = sum Score,
        playerCount = count
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

`first` and `first_or_default` should have deterministic ordering when exposed
as generated APIs. The compiler warns when order cannot be proven.

## Parameters

Parameters are declared in the query signature and referenced in the body with a leading `@`:

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

Queries can read a `materialized view` as an ordinary source. The materialized
view is derived in memory from base tables and is not persisted.

```unimem
query GetPlayerItems(player_id: int, max_count: int) -> PlayerItemRow[] =
    from PlayerItemRow
    | filter owner_id == @player_id
    | sort -rarity, name
    | take @max_count
```

When the source is a materialized view and the query shape matches a declared
materialized index, the planner may use a materialized index seek instead of
executing the source pipeline. With `rewrite: explicit`, this is direct-source
only. With `rewrite: auto`, the view is an optimizer-visible materialized
candidate for ordinary base-table queries whose typed normalized prefix is
proven equivalent to the view source. Candidate substitution preserves
residual predicates/projections and can still become
`PhysicalMaterializedIndexSeek` when a declared materialized index matches.

Reactive queries can also create hidden internal materialized views. These
hidden `ReactiveAutoView` relations are not user-addressable schema sources, but
they are optimizer-visible. If an ordinary query has the same normalized body as
a reactive query, the compiler may plan the ordinary query over the already
maintained hidden relation/index. This is a typed, costed optimizer
substitution: failed equivalence proof leaves the base plan selected rather than
raising a diagnostic. Plan explain reports the hidden origin, visibility, owner
reactive query, proof kind, selected/base cost, and selected materialized access
so this reuse is observable.

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
    | take count
}
```

## Custom Functions

Register external pure functions in schema:

```prql
extern function calculateDamage(level: int, power: int) -> int =
    Game.Rules.Combat.CalculateDamage
```

The compiler emits direct static calls for approved extern functions.

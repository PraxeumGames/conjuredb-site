# Getting Started

ConjureDB is schema-first. The only supported frontend contract is a `.conjure`
schema file that declares tables, indexes, queries, mutations, commands, and
extern functions. Generated MessagePack attributes are compiler output.

## Install

```bash
dotnet add package ConjureDB
dotnet add package MessagePack
```

Add schema files under `schema/` beside the target project. The manual compiler uses
that directory and `Generated/` by default; `--schema-root` and `--output` provide
explicit overrides.

## Define Tables

Create `schema/game.conjure`:

```conjure
table Player(plural: Players, persistence: local, capacity: 1000, type_id: 1) {
    Id: int @id
    Name: string
    Level: int
    Score: int

    @@index(fields: [Level], name: "PlayersByLevel", kind: sorted_set)
    @@index(fields: [Score], name: "PlayersByScore", kind: sorted_set)
}

table Item(plural: Items, persistence: local, capacity: 10000, type_id: 2) {
    Id: int @id
    OwnerId: int
    ItemType: string
    Quantity: int

    @@index(fields: [OwnerId], name: "ItemsByOwner", kind: lookup)
}
```

Persisted tables must declare `type_id`. Runtime-only tables may omit it only
when `persistence: none`; the generator assigns a deterministic runtime-local id
that is never used for durable snapshot identity.

## Add Queries

```conjure
query GetHighLevelPlayers(minLevel: int) -> Player[] {
    from Players
    | filter Level > @minLevel
    | select { Id, Name, Level }
}

query GetTopScorers(minScore: int, count: int) -> Player[] {
    from Players
    | filter Score > @minScore
    | sort -Score
    | take @count
}
```

Queries compile ahead of time into generated C# methods during the explicit manual
compiler step. There is no runtime query parser on the hot path, and normal
`dotnet build` only compiles the committed generated pack.

> Note: This is the minimal teaching version of the top-N query and `Player`
> table. For the indexed, reactive version that stays current as scores change,
> see [Reactive Queries](/docs/advanced/reactive-queries#example-3-real-time-leaderboard).

## Add Mutations

```conjure
mutation GrantItem(playerId: int, itemType: string, quantity: int) {
    insert Items
    | values {
        OwnerId = @playerId,
        ItemType = @itemType,
        Quantity = @quantity
    }
}
```

> Note: This `GrantItem` is the simple insert-mutation form (`itemType: string`).
> A different upsert mutation also named `GrantItem` appears in
> [Mutations](/docs/query-language/mutations#upsert), and a `GrantItem` command appears in
> [Build Your First Game](/docs/build-your-first-game); they are distinct examples.

Use compiled mutations or compiled commands for write-side behavior. Normal game
validation failures should be modeled as typed command outcomes.

## Create a Context

The manual compiler emits the requested context name.

```csharp
using ConjureDB;

using var context = DbContextBuilder<GameDbContext>.Create()
    .WithDataDirectory("./data")
    .WithDefaultSnapshot()
    .Build();

var players = context.Set<Player>();

context.BeginTransaction();
players.Add(new Player { Id = 1, Name = "Hero", Level = 10, Score = 500 });
context.Commit();
```

`Update()` takes the row that replaces the stored one — it does not take a mutation of it:

```csharp
context.BeginTransaction();
var hero = players.FindById(1);
players.Update(hero with { Score = hero.Score + 250 });   // a NEW row carrying the new values
context.Commit();
```

If a `class` row is mutated in place and passed back, the update carries the same instance as its old
row and its new row, the previous values no longer exist, and every index and materialized view would
retract under the new key. The runtime refuses that change with an `InvalidOperationException`; see
[Transactions](/docs/engine/transactions#updating-a-row-pass-a-new-instance) for the rule and the correct
patterns. A `struct` or `record struct` row is copied on read and is never affected.

For temporary persistent-table tests or tools that should not touch disk, disable
persistence at the context boundary:

```csharp
var context = DbContextBuilder<GameDbContext>.Create()
    .WithNoPersistence()
    .Build();
```

`WithNoPersistence()` does not turn persistent tables into the frame-local ephemeral
storage kind. For ECS-style non-transactional frame state, declare `ephemeral table`,
`event table`, or `singleton table` and follow
[Ephemeral Tables and Frame Systems](/docs/advanced/ephemeral-tables).

## Manual Generation

For deterministic local generation, CI diagnostics, or PGO-driven codegen:

```bash
dotnet run --project ConjureDB.Compiler -- generate MyGame.csproj \
  --context GameDbContext --namespace MyGame --output Generated
dotnet run --project ConjureDB.Compiler -- verify MyGame.csproj
```

Generated files are compiler output. If generated C# is wrong, fix the schema
parser, binder, planner, or emitter and regenerate.

## Troubleshooting

| Symptom | Check |
|---------|-------|
| No generated context | Run `ConjureDB.Compiler generate` against the authoritative project and commit the complete `Generated/` pack. |
| Missing persisted table id | Add `type_id` to every `persistence: local` or `persistence: remote` table. |
| Slow filtered query | Declare a matching schema `@@index` and rerun generation. |
| Snapshot compatibility error | Keep `type_id`, field ordinals, and schema versions stable across releases. |

See [Schema Language](/docs/schema/schema-language), [Compiled Queries](/docs/query-language/compiled-queries),
[Mutations](/docs/query-language/mutations), and [Indexing](/docs/schema/indexing) for detailed references.

# Getting Started

ConjureDB is schema-first. The only supported frontend contract is a `.conjure`
schema file that declares tables, indexes, queries, mutations, commands, and
extern functions. Generated MessagePack attributes are compiler output.

## Install

```bash
dotnet add package ConjureDB
dotnet add package ConjureDB.CodeGen
dotnet add package MessagePack
```

Add schema files under `schema/` or mark individual MSBuild `AdditionalFiles`
with `ConjureDBSchema=true`.

```xml
<PropertyGroup>
  <ConjureDBSchemaRoot>$(MSBuildProjectDirectory)/schema</ConjureDBSchemaRoot>
  <ConjureDBSchemaNamespace>$(RootNamespace)</ConjureDBSchemaNamespace>
  <ConjureDBSchemaContextName>$(MSBuildProjectName)DbContext</ConjureDBSchemaContextName>
</PropertyGroup>
```

## Define Tables

Create `schema/game.conjure`:

```prql
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

```prql
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

Queries compile at build time into generated C# methods. There is no runtime
query parser on the hot path.

> Note: This is the minimal teaching version of the top-N query and `Player`
> table. For the indexed, reactive version that stays current as scores change,
> see [Reactive Queries](/docs/advanced/reactive-queries#example-3-real-time-leaderboard).

## Add Mutations

```prql
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

The source generator emits the context named by `ConjureDBSchemaContextName`.

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

For ephemeral tests or tools that should not touch disk, disable persistence at
the context boundary:

```csharp
var context = DbContextBuilder<GameDbContext>.Create()
    .WithNoPersistence()
    .Build();
```

## Manual Generation

For deterministic local generation, CI diagnostics, or PGO-driven codegen:

```bash
dotnet run --project ConjureDB.CodeGen.Manual -- schema Generated
dotnet run --project ConjureDB.CodeGen.Manual -- schema --verify-only
```

Generated files are compiler output. If generated C# is wrong, fix the schema
parser, binder, planner, or emitter and regenerate.

## Troubleshooting

| Symptom | Check |
|---------|-------|
| No generated context | Schema files are included as `AdditionalFiles` with `ConjureDBSchema=true`. |
| Missing persisted table id | Add `type_id` to every `persistence: local` or `persistence: remote` table. |
| Slow filtered query | Declare a matching schema `@@index` and rerun generation. |
| Snapshot compatibility error | Keep `type_id`, field ordinals, and schema versions stable across releases. |

See [Schema Language](/docs/schema/schema-language), [Compiled Queries](/docs/query-language/compiled-queries),
[Mutations](/docs/query-language/mutations), and [Indexing](/docs/schema/indexing) for detailed references.

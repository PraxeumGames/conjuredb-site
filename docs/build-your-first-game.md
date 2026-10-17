# Build Your First Game

This walkthrough uses the schema-first frontend. The game domain lives in
`.conjure` files; generated C# is committed output from the manual compiler.

## Project Shape

```text
MyGame/
├── MyGame.Domain/
│   ├── schema/
│   │   └── game.conjure
│   └── MyGame.Domain.csproj
└── MyGame.Unity/
```

`MyGame.Domain.csproj` references the ConjureDB runtime packages. It includes the
committed `Generated/` sources as ordinary C#; no compiler analyzer is installed in
the consumer build. Set `<ConjureDBSyntaxVersion>2</ConjureDBSyntaxVersion>` in
that project before invoking the manual compiler; format 2 is not inferred from
the source text.

## Schema

Create `schema/game.conjure`:

```conjure
table PlayerProfile(plural: PlayerProfiles, persistence: local, capacity: 1024, type_id: 1) {
    Id: int @id
    DisplayName: string
    Level: int
    Gold: long
}

table InventorySlot(plural: InventorySlots, persistence: local, capacity: 4096, type_id: 2) {
    Id: int @id
    PlayerId: int
    ItemId: int
    Amount: int

    @@unique(fields: [PlayerId, ItemId], name: "InventorySlot_Player_Item")
}

table QuestProgress(plural: QuestProgressRows, persistence: local, capacity: 2048, type_id: 3) {
    Id: int @id
    PlayerId: int
    QuestId: int
    Completed: bool

    @@index(fields: [PlayerId], name: "QuestProgress_ByPlayer", kind: lookup)
}
```

## Queries

```conjure
query GetInventory(playerId: int) -> InventorySlot[] {
    from InventorySlots
    | filter PlayerId == @playerId
    | sort ItemId
}

query GetPlayerGold(playerId: int) -> long {
    from PlayerProfiles
    | filter Id == @playerId
    | select Gold
    | single
}
```

## Commands

```conjure
module Inventory {
    type GrantItemResult {
        itemId: int
        amountAfter: int
    }

    command GrantItem(playerId: int, itemId: int, amount: int) -> GrantItemResult
    kind: local
    {
        require @amount > 0 else InvalidAmount

        upsert InventorySlot
        | key { PlayerId = @playerId, ItemId = @itemId }
        | set { Amount += @amount }
        | returning { amountAfter = Amount } into slotAfter

        return {
            itemId = @itemId,
            amountAfter = slotAfter.AmountAfter
        }
    }
}
```

> Note: This `GrantItem` is the compiled-command form (`require`/`upsert`/`returning`); it is distinct from the like-named [`GrantItem` mutation](/docs/query-language/mutations#upsert) in Mutations and the one in Getting Started, which have different bodies.

Compiled commands are state transitions. External dispatch owns transactions;
subcommands compile to direct `ExecuteCore` calls.

## Use The Generated Context

Generate the AOT pack explicitly after schema or project-semantic changes:

```bash
dotnet run --project ConjureDB.Compiler -- generate MyGame.Domain/MyGame.Domain.csproj \
  --context GameDbContext --namespace MyGame.Domain
```

Normal `dotnet build` consumes that committed pack and does not run schema compilation.

```csharp
using ConjureDB;

using var context = DbContextBuilder<GameDbContext>.Create()
    .WithDataDirectory("./data")
    .WithDefaultSnapshot()
    .Build();

var players = context.Set<PlayerProfile>();

context.BeginTransaction();
players.Add(new PlayerProfile
{
    Id = 1,
    DisplayName = "Hero",
    Level = 1,
    Gold = 1000
});
context.Commit();
```

## Unity

Copy runtime DLLs and the generated domain assembly into the Unity project. The
Unity player consumes generated runtime artifacts; schema parsing and generation
happen only when the manual compiler is invoked.

## Next Steps

- [Schema Language](/docs/schema/schema-language)
- [Compiled Queries](/docs/query-language/compiled-queries)
- [Mutations](/docs/query-language/mutations)
- Compiled Commands
- Unity Integration

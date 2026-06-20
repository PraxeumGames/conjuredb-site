# Build Your First Game

This walkthrough uses the schema-first frontend. The game domain lives in
`.conjure` files; generated C# is build output.

## Project Shape

```text
MyGame/
├── MyGame.Domain/
│   ├── schema/
│   │   └── game.conjure
│   └── MyGame.Domain.csproj
└── MyGame.Unity/
```

`MyGame.Domain.csproj` should reference ConjureDB runtime packages and
`ConjureDB.CodeGen` as an analyzer/source-generator package.

## Schema

Create `schema/game.conjure`:

```prql
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

```prql
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

```prql
module Inventory

command GrantItem(playerId: int, itemId: int, amount: int) -> GrantItemResult
kind local
{
    require amount > 0 else InvalidAmount

    upsert InventorySlots
    | key { PlayerId: playerId, ItemId: itemId }
    | set Amount += amount
    | returning { amountAfter: Amount } into slotAfter

    return {
        itemId: itemId,
        amountAfter: slotAfter.amountAfter
    }
}
```

> Note: This `GrantItem` is the compiled-command form (`require`/`upsert`/`returning`); it is distinct from the like-named [`GrantItem` mutation](/docs/query-language/mutations#upsert) in Mutations.md and the one in GettingStarted.md, which have different bodies.

Compiled commands are state transitions. External dispatch owns transactions;
subcommands compile to direct `ExecuteCore` calls.

## Use The Generated Context

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
happen during the .NET build step.

## Next Steps

- [Schema Language](/docs/schema/schema-language)
- [Compiled Queries](/docs/query-language/compiled-queries)
- [Mutations](/docs/query-language/mutations)
- Compiled Commands
- Unity Integration

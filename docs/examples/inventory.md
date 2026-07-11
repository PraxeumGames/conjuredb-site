# Player Inventory

The inventory screen is the workhorse for filters, joins and atomic writes: items a
player owns, queried by owner, kept consistent as items are granted or consumed.

:::note
This example shares its `InventorySlot` schema and `GrantItem` command with the
[Build Your First Game](/docs/build-your-first-game) tutorial, which introduces and
explains them. Keep the two in sync if you change either.
:::

## Schema

```prql
table InventorySlot(plural: InventorySlots, persistence: local, capacity: 4096, type_id: 2) {
    Id: int @id
    PlayerId: int
    ItemId: int
    Amount: int

    @@unique(fields: [PlayerId, ItemId], name: "InventorySlot_Player_Item")
}
```

The `@@unique(PlayerId, ItemId)` constraint guarantees at most one slot per (PlayerId, ItemId)
and accelerates exact full-pair lookups. It does **not** accelerate the per-player
`GetInventory` query, which binds only the leading `PlayerId` column — a unique index is a
full-key hash probe with no partial-key/prefix capability, so that filter would full-scan. To
make per-player lookups fast, add a dedicated leading-column index: `@@index(fields:
[PlayerId], kind: lookup)` (a multi-value hash returning all of a player's slots).

## Query

```prql
query GetInventory(playerId: int) -> InventorySlot[] {
    from InventorySlots
    | filter PlayerId == @playerId
    | sort ItemId
}
```

## Mutate atomically with a command

Granting an item is a single, atomic state transition — an upsert that accumulates the
amount, with a guard that rejects invalid input at compile-checked boundaries:

```prql
module Inventory {
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
}
```

## Call it from C#

```csharp
using ConjureDB;

using var ctx = DbContextBuilder<GameDbContext>.Create()
    .WithDataDirectory("./data")
    .WithDefaultSnapshot()
    .Build();

var slots = ctx.GetInventory(playerId: 1);
```

Validation failures (here, `InvalidAmount`) are modelled as typed command outcomes, not
exceptions — see [Getting Started](/docs/getting-started) for the full command workflow.

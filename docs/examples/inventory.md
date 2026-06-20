# Player Inventory

The inventory screen is the workhorse for filters, joins and atomic writes: items a
player owns, queried by owner, kept consistent as items are granted or consumed.

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

The `@@unique` constraint on `(PlayerId, ItemId)` is both a correctness guarantee and the
index that makes per-player lookups fast.

## Query

```prql
query GetInventory(playerId: int) -> InventorySlot[] {
    from InventorySlots
    | filter PlayerId == playerId
    | sort ItemId
}
```

## Mutate atomically with a command

Granting an item is a single, atomic state transition — an upsert that accumulates the
amount, with a guard that rejects invalid input at compile-checked boundaries:

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

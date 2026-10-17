# Player Inventory

The inventory screen is the workhorse for filters, joins and atomic writes: items a
player owns, queried by owner, kept consistent as items are granted or consumed.

:::note
This example shares its `InventorySlot` schema and `GrantItem` command with the
[Build Your First Game](/docs/build-your-first-game) tutorial, which introduces and
explains them. Keep the two in sync if you change either.
:::

## Schema

```conjure
table InventorySlot(plural: InventorySlots, persistence: local, capacity: 4096, type_id: 2) {
    Id: int @id
    PlayerId: int
    ItemId: int
    Amount: int

    @@unique(fields: [PlayerId, ItemId])
    @@index(fields: [PlayerId], name: "InventorySlot_ByPlayer", kind: lookup)
}
```

The `@@unique(fields: [PlayerId, ItemId])` constraint guarantees at most one slot per
(PlayerId, ItemId) and accelerates exact full-pair lookups. It does **not** accelerate the
per-player `GetInventory` query, which binds only the leading `PlayerId` column — a unique
index is a full-key hash probe with no partial-key/prefix capability. That is why the
leading-column `lookup` index above exists: it is a multi-value hash returning all of a
player's slots.

## Query

```conjure
query GetInventory(playerId: int) -> InventorySlot[] {
    from InventorySlot s
    | filter s.PlayerId == @playerId
    | sort s.ItemId
}
```

## Mutate atomically with a command

Granting an item is a single, atomic state transition — an upsert that accumulates the
amount, with a guard that rejects invalid input at compile-checked boundaries:

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

Command bodies read parameters as `@name`, assign with `=`, and use `key` / `returning …
into` as explicit single-row write contracts. The bulk form of the same write is a
[mutation](/docs/query-language/mutations).

## Call it from C#

```csharp
using ConjureDB;

using var ctx = DbContextBuilder<GameDbContext>.Create()
    .WithDataDirectory("./data")
    .WithDefaultSnapshot()
    .Build();

var slots = ctx.InventorySlots.GetInventory(playerId: 1);
```

Validation failures (here, `InvalidAmount`) are modelled as typed command outcomes, not
exceptions — see [Getting Started](/docs/getting-started) for the full command workflow.

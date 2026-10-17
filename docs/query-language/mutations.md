# Mutations

Compiled mutations are schema-owned write pipelines used by the compiler and by
CompiledCommand lowering. They are declared in `.conjure` files and compiled
ahead of time.

For gameplay state transitions, prefer Compiled Commands.
Commands add typed errors, event payloads, effect manifests, and direct
subcommand composition on top of mutation primitives.

## Update

```conjure
mutation AddExperience(playerId: int, amount: int) -> int {
    update Player
    | filter Id == @playerId
    | set { Experience = Experience + @amount }
}
```

## Insert

```conjure
mutation CreatePlayer(id: int, name: string) -> int {
    insert Player
    | values {
        Id = @id,
        Name = @name,
        Level = 1,
        Experience = 0
    }
}
```

## Upsert

```conjure
mutation GrantItem(playerId: int, itemId: int, amount: int) -> int {
    upsert InventorySlot
    | filter PlayerId == @playerId && ItemId == @itemId
    | set { Amount = Amount + @amount }
}
```

> Note: This is the upsert-mutation form of `GrantItem`. On insert, the new row's default `Amount` is zero; on update, the current `Amount` is incremented. Schema mutations use `=` assignments rather than command-style `+=`. It is distinct from the [`GrantItem` command](/docs/build-your-first-game#commands), which adds typed errors and `key`/`returning` contracts.

## Delete

```conjure
mutation RemoveExpiredReward(playerId: int, rewardId: int) -> int {
    delete RewardClaim
    | filter PlayerId == @playerId
    | filter RewardId == @rewardId
}
```

Bulk mutation forms remain storage-level primitives. Command bodies use stricter
single-row write statements with explicit `key`, `require`, and
`returning ... into` contracts.
The examples return the affected-row count through the generated `int` method.

## Atomicity

External operation dispatch owns transaction boundaries. Generated command
`ExecuteCore` methods do not open nested transactions. Storage-level mutations
remain atomic when invoked through their owning generated wrapper.

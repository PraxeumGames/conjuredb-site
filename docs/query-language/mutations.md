# Mutations

Compiled mutations are schema-owned write pipelines used by the compiler and by
CompiledCommand lowering. They are declared in `.conjure` files and compiled
ahead of time.

For gameplay state transitions, prefer Compiled Commands.
Commands add typed errors, event payloads, effect manifests, and direct
subcommand composition on top of mutation primitives.

## Update

```prql
mutation AddExperience(playerId: int, amount: int) {
    update Players
    | filter Id == playerId
    | set Experience = Experience + amount
}
```

## Insert

```prql
mutation CreatePlayer(id: int, name: string) {
    insert Players
    | values {
        Id: id,
        Name: name,
        Level: 1,
        Experience: 0
    }
}
```

## Upsert

```prql
mutation GrantItem(playerId: int, itemId: int, amount: int) {
    upsert InventorySlots
    | key { PlayerId: playerId, ItemId: itemId }
    | set Amount += amount
}
```

## Delete

```prql
mutation RemoveExpiredReward(playerId: int, rewardId: int) {
    delete RewardClaims
    | filter PlayerId == playerId
    | filter RewardId == rewardId
}
```

Bulk mutation forms remain storage-level primitives. Command bodies use stricter
single-row write statements with explicit `key`, `require`, and
`returning ... into` contracts.

## Atomicity

External operation dispatch owns transaction boundaries. Generated command
`ExecuteCore` methods do not open nested transactions. Storage-level mutations
remain atomic when invoked through their owning generated wrapper.

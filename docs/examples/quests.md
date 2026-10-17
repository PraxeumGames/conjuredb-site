# Quests & Progress

Progress tracking is a lookup-by-owner workload with a simple state flip. It shows how a
declared index keeps per-player reads fast and how a command performs the write.

:::note
The `QuestProgress` table here is the same one introduced in
[Build Your First Game](/docs/build-your-first-game); this page adds the `GetOpenQuests`
query and the `CompleteQuest` command on top of it.
:::

## Schema

```conjure
table QuestProgress(plural: QuestProgressRows, persistence: local, capacity: 2048, type_id: 3) {
    Id: int @id
    PlayerId: int
    QuestId: int
    Completed: bool

    @@index(fields: [PlayerId], name: "QuestProgress_ByPlayer", kind: lookup)
}
```

## Query the player's open quests

```conjure
query GetOpenQuests(playerId: int) -> QuestProgress[] {
    from QuestProgress q
    | filter q.PlayerId == @playerId && !q.Completed
    | sort q.QuestId
}
```

The `lookup` index on `PlayerId` means this filter is a direct index probe, not a table
scan — even with thousands of rows. The query never names the index: the planner proves
the filter matches it and chooses the probe.

## Complete a quest with a command

```conjure
module Quests {
    type CompleteQuestResult {
        questId: int
    }

    command CompleteQuest(playerId: int, questId: int) -> CompleteQuestResult
    kind: local
    {
        upsert QuestProgress
        | key { PlayerId = @playerId, QuestId = @questId }
        | set { Completed = true }

        return { questId = @questId }
    }
}
```

## Count what is left

A scalar reduction is an `aggregate` with one unnamed aggregate, and the signature says it
returns a non-nullable `long`:

```conjure
query OpenQuestCount(playerId: int) -> long {
    from QuestProgress q
    | filter q.PlayerId == @playerId && !q.Completed
    | aggregate count()
}
```

## Call it from C#

```csharp
using ConjureDB;

using var ctx = DbContextBuilder<GameDbContext>.Create()
    .WithDataDirectory("./data")
    .WithDefaultSnapshot()
    .Build();

var open = ctx.QuestProgressRows.GetOpenQuests(playerId: 1);
```

See [Indexing](/docs/schema/indexing) for how to choose `lookup` vs `sorted_set` / `sorted_list`
vs `unique` indexes for each access pattern.

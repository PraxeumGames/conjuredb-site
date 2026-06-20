# Quests & Progress

Progress tracking is a lookup-by-owner workload with a simple state flip. It shows how a
declared index keeps per-player reads fast and how a command performs the write.

:::note
The `QuestProgress` table here is the same one introduced in
[Build Your First Game](/docs/build-your-first-game); this page adds the `GetOpenQuests`
query and the `CompleteQuest` command on top of it.
:::

## Schema

```prql
table QuestProgress(plural: QuestProgressRows, persistence: local, capacity: 2048, type_id: 3) {
    Id: int @id
    PlayerId: int
    QuestId: int
    Completed: bool

    @@index(fields: [PlayerId], name: "QuestProgress_ByPlayer", kind: lookup)
}
```

## Query the player's open quests

```prql
query GetOpenQuests(playerId: int) -> QuestProgress[] {
    from QuestProgressRows
    | filter PlayerId == @playerId && Completed == false
    | sort QuestId
}
```

The `lookup` index on `PlayerId` means this filter is a direct index probe, not a table
scan — even with thousands of rows.

## Complete a quest with a command

```prql
module Quests

command CompleteQuest(playerId: int, questId: int) -> CompleteQuestResult
kind local
{
    upsert QuestProgressRows
    | key { PlayerId: playerId, QuestId: questId }
    | set Completed = true

    return { questId: questId }
}
```

## Call it from C#

```csharp
using ConjureDB;

using var ctx = DbContextBuilder<GameDbContext>.Create()
    .WithDataDirectory("./data")
    .WithDefaultSnapshot()
    .Build();

var open = ctx.GetOpenQuests(playerId: 1);
```

See [Indexing](/docs/schema/indexing) for how to choose `lookup` vs `sorted` vs `unique`
indexes for each access pattern.

# Troubleshooting

Solutions for common issues when working with ConjureDB.

> **See also:** [Error Codes](/docs/reference/error-codes) · [Performance Tips](/docs/performance/performance-tips) · [Getting Started](/docs/getting-started)

---

## Table of Contents

- [Setup & Installation](#setup--installation)
- [Code Generation Issues](#code-generation-issues)
- [Query Compilation Errors](#query-compilation-errors)
- [Runtime Errors](#runtime-errors)
- [Performance Issues](#performance-issues)
- [Persistence & Data Issues](#persistence--data-issues)
- [Unity-Specific Issues](#unity-specific-issues)
- [Schema & Migration Issues](#schema--migration-issues)
- [Reactive Query Issues](#reactive-query-issues)
- [FAQ](#faq)

---

## Setup & Installation

### Build error: "Could not find package ConjureDB"

**Problem:** NuGet package not found during `dotnet build` or `dotnet restore`.

**Cause:** Missing package reference or misconfigured NuGet sources.

**Solution:**

```bash
# Add the core package and source generator
dotnet add package ConjureDB
dotnet add package ConjureDB.CodeGen
```

If you use a private feed, ensure it is listed in your `nuget.config`:

```xml
<configuration>
  <packageSources>
    <add key="MyFeed" value="https://my-feed.example.com/v3/index.json" />
  </packageSources>
</configuration>
```

---

### Analyzer version conflicts

**Problem:** Build warnings or errors about incompatible analyzer versions when ConjureDB.CodeGen and other source generators coexist.

**Cause:** Multiple generators targeting different versions of `Microsoft.CodeAnalysis` APIs.

**Solution:**

1. Ensure all analyzer packages target the same .NET SDK version.
2. Pin the SDK version in `global.json`:

```json
{
  "sdk": {
    "version": "9.0.300",
    "rollForward": "latestPatch"
  }
}
```

3. If conflicts persist, verify that `ConjureDB.CodeGen` is referenced as an analyzer, not a regular dependency:

```xml
<PackageReference Include="ConjureDB.CodeGen"
                  OutputItemType="Analyzer"
                  ReferenceOutputAssembly="false" />
```

---

### Unity: "Assembly not found" errors

**Problem:** Unity reports `Assembly 'ConjureDB' ... could not be found` in the Console.

**Cause:** The DLLs are not placed in the correct folder or their `.meta` platform settings exclude the active build target.

**Solution:**

1. Place `ConjureDB.dll` and `ConjureDB.CodeGen.dll` under `Assets/Plugins/ConjureDB/`.
2. Place `ConjureDB.CodeGen.dll` under `Assets/Plugins/ConjureDB/Analyzers/` — set its `.meta` to **exclude from all platforms** (it runs at compile time only via Roslyn).
3. Verify each `.meta` file has the correct platform include/exclude flags in the Inspector.
4. If using the Unity package, run the provided `build-unity-package.sh` to populate the correct structure.

---

## Code Generation Issues

### No generated code after adding `query`

**Problem:** The build succeeds but the expected generated method implementations are missing. Calling the query results in `NotImplementedException` or a missing member error.

**Cause:** The source generator is not activated.

**Solution:**

1. Confirm `ConjureDB.CodeGen` is referenced as an **analyzer** (see [Analyzer version conflicts](#analyzer-version-conflicts)).
2. Queries are declared in a `.conjure` schema file with the `query` keyword — there is no C# attribute. The generator emits a method on the entity's generated set (and on the `I<Entity>Queries` interface it implements), which you call as `context.<EntitySet>.<QueryName>(args)`:

```text
// In a .conjure schema file
query GetHighLevel(minLevel: int) -> Player[] {
    from Players | filter Level > @minLevel
}
```

```csharp
// Call the generated method on the context's entity set
Player[] result = db.Players.GetHighLevel(minLevel);
```

If the query is missing, confirm it is declared in a `.conjure` file that is included in the build (the schema is the only source of truth — a method on a plain C# interface or class is never generated).

3. Rebuild the project (`dotnet build`). Check the `obj/` directory for generated `.g.cs` files.

---

### Generated code has compilation errors

**Problem:** Build fails inside auto-generated `*.g.cs` files with type mismatches or missing members.

**Cause:** Schema entity definitions changed but the generated code was not regenerated, or the entity is missing required attributes.

**Solution:**

1. Clean and rebuild:

```bash
dotnet clean && dotnet build
```

2. Ensure every persisted property on your entity has a `[Key(n)]` attribute with a unique ordinal:

```csharp
[MessagePackObject]
public record Player(
    [property: Key(0)] int Id,
    [property: Key(1)] string Name,
    [property: Key(2)] int Level  // ← don't forget [Key]
);
```

3. If you renamed or removed a property, confirm the compiled query DSL text matches the current schema.

---

## Query Compilation Errors

### UM1007 — Table not found

**Problem:** `error UM1007: Unknown table 'Player'`.

**Cause:** The query references a table name that does not match any table declared in the `.conjure` schema.

**Solution:** The table name in the DSL must match the schema table name or its declared plural/table alias.

```prql
table Player(plural: Players, persistence: none) {
  id    : int @id
  level : int
}
```

```text
// Both 'from Player' (table name) and 'from Players' (plural alias) resolve.
// UM1007 fires only when the source matches NEITHER the table name nor its plural alias.
query GetHigh() -> Player[] = from Players | filter Level > 10
```

```csharp
// Call the generated method
Player[] result = db.Players.GetHigh();
```

**See also:** [UM1007 in Error Codes](/docs/reference/error-codes#semantic-errors-um1xxx)

---

### UM1008 — Column not found

**Problem:** `error UM1008: Unknown column 'PlayerName' in table 'Players'`.

**Cause:** The column name in the DSL does not match any public property on the entity type.

**Solution:** Use the exact C# property name (case-sensitive):

```csharp
public record Player([property: Key(0)] int Id,
                     [property: Key(1)] string Name);
```

```text
// ❌ Wrong — property is "Name", not "PlayerName"
query FindByName(name: string) -> Player[] = from Players | filter PlayerName == @name

// ✅ Correct
query FindByName(name: string) -> Player[] = from Players | filter Name == @name
```

**See also:** [UM1008 in Error Codes](/docs/reference/error-codes#semantic-errors-um1xxx)

---

### UM1002 — Ambiguous column reference

**Problem:** `error UM1002: Ambiguous column reference 'Id'` — typically in queries with joins.

**Cause:** Multiple tables in the query define a column with the same name and no table qualifier is used.

**Solution:** Prefix the column with the table alias:

```text
// ❌ Ambiguous — both Players and Guilds have "Id"
query PlayerGuilds() -> PlayerGuildView[] =
    from Players | join Guilds g (GuildId == Id) | select Id, g.Name

// ✅ Qualified — use alias prefix
query PlayerGuilds() -> PlayerGuildView[] =
    from Players p | join Guilds g (p.GuildId == g.Id) | select p.Id, g.Name
```

**See also:** [UM1002 in Error Codes](/docs/reference/error-codes#semantic-errors-um1xxx)

---

### UM1001 — Missing table alias

**Problem:** `error UM1001: Missing table alias` in a join or self-join query.

**Cause:** A `join` clause requires an alias to distinguish the joined table, especially for self-joins.

**Solution:** Always provide an alias for joined tables:

```text
// ❌ Missing alias
query PlayerGuilds() -> PlayerGuildView[] = from Players | join Guilds (GuildId == Id)

// ✅ With alias
query PlayerGuilds() -> PlayerGuildView[] = from Players | join Guilds g (GuildId == g.Id)
```

---

### UM1005 — Invalid aggregate usage

**Problem:** `error UM1005: Invalid aggregate usage` — aggregate function used outside a `group` context.

**Cause:** `sum()`, `count()`, `avg()`, etc. require a preceding `group` stage or must be used as a scalar aggregate over the entire table.

**Solution:**

```text
// ❌ Wrong — aggregate without group
query ScoreByName() -> ScoreView[] = from Players | select Name, sum(Score)

// ✅ Correct — aggregate with group
query ScoreByLevel() -> ScoreView[] = from Players | group Level | select Level, sum(Score)

// ✅ Also correct — scalar aggregate (no select of non-aggregated columns)
query TotalScore() -> long = from Players | select sum(Score)
```

**See also:** [UM1005 in Error Codes](/docs/reference/error-codes#semantic-errors-um1xxx)

---

### UM1009 — Type mismatch in expression

**Problem:** `error UM1009: Type mismatch` — comparing or operating on incompatible types.

**Cause:** A filter or expression combines values of incompatible types (e.g., comparing `string` to `int`).

**Solution:** Ensure both sides of an operator have compatible types:

```text
// ❌ Type mismatch — Level is int, "10" is string literal
query ByLevel() -> Player[] = from Players | filter Level == "10"

// ✅ Correct — integer literal
query ByLevel() -> Player[] = from Players | filter Level == 10
```

---

### UM5001 — Feature not supported

**Problem:** `error UM5001: Unsupported feature` — using a DSL construct that the compiler does not yet implement.

**Cause:** The query uses syntax or a function that is not supported in the current compiler version.

**Solution:** Check the [Query Language Reference](/docs/query-language/reference) for supported syntax. Common unsupported constructs include:

- SQL-style `WITH` / `WITH RECURSIVE` CTE syntax (use `let` instead)
- SQLite-specific `GLOB`
- SQLite-specific `COLLATE NOCASE` sort modifiers
- Certain window function frame types
- Dynamic pivot operations

**Workaround:** Restructure the query to use supported operators, or perform the operation in application code after the query.

**See also:** [UM5xxx in Error Codes](/docs/reference/error-codes#unsupported-features-um5xxx)

---

### UM5005 — Syntax error

**Problem:** `error UM5005: Syntax error` — the query text could not be parsed.

**Cause:** Malformed DSL syntax — missing pipe `|`, unclosed parentheses, invalid keywords.

**Solution:** Verify the query against the [Query Language Reference](/docs/query-language/reference):

```text
// ❌ Missing pipe separator
query ByLevel() -> Player[] = from Players filter Level > 10

// ✅ Correct pipe syntax
query ByLevel() -> Player[] = from Players | filter Level > 10
```

---

### UM6001 — Code emission failed

**Problem:** `error UM6001: Code emission failed` — the compiler could not generate C# code for the optimized plan.

**Cause:** The physical plan contains a node or strategy the emitter does not handle. This typically occurs with complex join patterns or edge-case expressions.

**Solution:**

1. Simplify the query and rebuild to isolate the problematic construct.
2. Emit a plan-diagnosis report for the query to inspect the physical plan and optimization trace:

```bash
dotnet run --project ConjureDB.CodeGen.Manual -- <schemaDir> <outDir> --dump-plan=<QueryName> --dump-plan-report=plan-report.md
```

3. If the issue persists, file a bug report with the query text, entity schema, and full diagnostic output.

**See also:** [UM6xxx in Error Codes](/docs/reference/error-codes#emission-errors-um6xxx)

---

## Runtime Errors

### "No active transaction" — InvalidOperationException

**Problem:** `InvalidOperationException: Transaction is not started` when calling `Add()`, `Update()`, or `Remove()`.

**Cause:** All mutations require an explicit transaction.

**Solution:**

```csharp
// ❌ Wrong — no transaction
db.Players.Add(new Player(1, "Alice", 10));

// ✅ Correct — wrap in transaction
db.BeginTransaction();
db.Players.Add(new Player(1, "Alice", 10));
db.Commit();
```

---

### Duplicate key — SecondaryIndexValidationException

**Problem:** `SecondaryIndexValidationException: Duplicate key 'X' in unique index` on `Commit()`.

**Cause:** Two entities share the same value for a property covered by a `UniqueIndex`.

**Solution:**

1. Check for duplicate values before inserting:

```csharp
var existing = db.Players.FindByName("Alice");
if (existing == null)
{
    db.Players.Add(new Player(nextId, "Alice", 1));
}
```

2. If you intend to allow duplicates, use `LookupIndex` instead of `UniqueIndex`.

**Note:** The exception message distinguishes three sub-cases:
- **Direct duplicate** — two entities have the same key.
- **Pending sync** — a prior `Add` in the same transaction already claimed the key.
- **Concurrent race** — detected during deferred secondary index commit (single-writer model violation).

---

### MutationPreconditionException — Transaction rolled back

**Problem:** `MutationPreconditionException` when a mutation assertion fails.

**Cause:** A precondition attached to the mutation (e.g., version check, invariant guard) was violated.

**Solution:** Inspect the exception message for the failing precondition. Re-read the entity state and retry the mutation with the correct values.

---

### Entity not found by primary key

**Problem:** `InvalidOperationException: entity was not found by primary key` during deferred sort or TopN operations.

**Cause:** An entity referenced by a secondary index or sort buffer was removed between index construction and access.

**Solution:** Ensure mutations and reads are not interleaved without a fresh commit. Use transactions to maintain consistent snapshots:

```csharp
db.BeginTransaction();
// ... mutations ...
db.Commit();

// Now read — snapshot is consistent
var results = queries.GetTopPlayers(10);
```

---

## Performance Issues

### Query is slow — full table scan (UM7001)

**Symptom:** Warning `UM7001: Full scan on table 'X'`, query takes longer than expected.

**Diagnosis:** The filter columns do not have a matching index, forcing the engine to scan every row.

**Solution:** Add an index on the filtered property:

```text
table Player {
  Id      : int @id
  Name    : string
  GuildId : int
  Level   : int

  @@index(fields: [GuildId], kind: lookup) // ← add index
}
```

**See also:** [Performance Tips — Index Selection Guide](/docs/performance/performance-tips#index-selection-guide) · [Indexing](/docs/schema/indexing)

---

### Cartesian product warning (UM7002)

**Symptom:** Warning `UM7002: Cartesian product` — join without a condition.

**Cause:** A `join` stage has no predicate, producing a cross product of both tables.

**Solution:** Add a join condition:

```text
// ❌ Cartesian product
query PlayerGuilds() -> PlayerGuildView[] = from Players | join Guilds g

// ✅ With join condition
query PlayerGuilds() -> PlayerGuildView[] = from Players | join Guilds g (GuildId == g.Id)
```

---

### Sort without LIMIT (UM7004)

**Symptom:** Warning `UM7004: Sort without LIMIT on table with N rows`.

**Cause:** Sorting the entire table without a `take` clause allocates and sorts all rows.

**Solution:** Add a `take` clause or use a pre-sorted index:

```text
// ⚠️ Sorts all players
query TopPlayers() -> Player[] = from Players | sort -Score

// ✅ Only materializes top 10
query TopPlayers() -> Player[] = from Players | sort -Score | take 10
```

---

### High memory usage

**Symptom:** Application memory grows beyond expected bounds.

**Cause:** Oversized `capacity` hints, unbounded query result buffers, or missing `Dispose()`.

**Solution:**

1. Set `capacity` to a realistic estimate, not a large constant — it pre-allocates arrays.
2. Use `take` to bound result sets.
3. Always call `db.Dispose()` on shutdown to flush pending writes and release buffers.
4. Use `.WithMemoryBudgetMB()` in configuration to monitor usage.

**See also:** [Performance Tips — Memory Management](/docs/performance/performance-tips#memory-management)

---

### GC spikes in Unity

**Symptom:** Frame drops correlating with GC.Collect in the Unity Profiler.

**Cause:** Allocations from LINQ, boxing, or string formatting in the query hot path.

**Solution:**

1. Use `query` — generated code is zero-allocation.
2. Avoid LINQ (`.Where()`, `.Select()`) on hot paths; use index methods or compiled queries.
3. Use `Span<T>` and `stackalloc` patterns where the API supports them.
4. Cache query result arrays instead of re-querying every frame.

**See also:** [Performance Tips — Zero-Allocation Patterns](/docs/performance/performance-tips#zero-allocation-patterns) · [Performance Tips — Unity-Specific Performance](/docs/performance/performance-tips#unity-specific-performance)

---

### Slow startup — large database restore

**Symptom:** Application takes several seconds to start when restoring a large snapshot.

**Cause:** Snapshot deserialization and journal replay scale with data size.

**Solution:**

1. Keep snapshots small — snapshot only on meaningful checkpoints, not every frame.
2. Snapshots are already compressed by default (`SnapshotOptions.CompressSnapshots = true`); there is no separate `WithSnapshotCompression()` builder method to call.
3. Profile startup with `System.Diagnostics.Stopwatch` around `DbContext` creation to identify the bottleneck (snapshot load vs. journal replay vs. index rebuild).

---

## Persistence & Data Issues

### Data lost on restart

**Problem:** All data disappears after restarting the application.

**Cause:** Persistence is not configured — ConjureDB defaults to in-memory-only mode.

**Solution:**

Mark persisted tables with `PersistenceType.Local`, then configure the storage location and snapshot support on the builder:

```csharp
var db = DbContextBuilder<GameDb>.Create()
    .WithDataDirectory("./gamedata")
    .WithDefaultSnapshot()
    .Build();
```

---

### JournalCorruptionException

**Problem:** `JournalCorruptionException` on startup during journal replay.

**Cause:** The journal file was partially written (crash during commit) or the file was externally modified.

**Solution:**

1. If the snapshot is intact, delete the corrupted journal file — committed data up to the last snapshot is preserved.
2. Implement a backup strategy: keep the previous snapshot alongside the current one.
3. Inspect the exception's `Offset` and `JournalFile` properties for diagnostic details (the read-status detail appears only in the exception message text).

---

### MessagePackSerializationException

**Problem:** `MessagePackSerializationException` when loading persisted data.

**Cause:** Entity properties are missing `[Key(n)]` attributes, or `[Key]` ordinals were reordered between versions.

**Solution:**

1. Every serialized property must have `[Key(n)]` with a **unique, stable** ordinal.
2. Never reuse or reorder `[Key]` indices across schema versions — add new properties with the next available ordinal.
3. Use `[IgnoreMember]` for computed properties that should not be persisted.

```csharp
[MessagePackObject]
public record Player(
    [property: Key(0)] int Id,
    [property: Key(1)] string Name,
    [property: Key(2)] int Level,
    [property: Key(3)] int Score  // ← new field gets next ordinal
);
```

---

### Encryption key mismatch

**Problem:** Decryption fails when loading a snapshot encrypted with a different key.

**Cause:** The AES-GCM encryption key used at save time does not match the key provided at load time.

**Solution:**

1. Ensure the same key is configured in `DbContextBuilder` at both save and load time.
2. On iOS, keys can be stored in the Keychain; on Android, use the Keystore.
3. If the key is truly lost, the encrypted snapshot cannot be recovered — this is by design.

---

## Unity-Specific Issues

### IL2CPP code stripping

**Problem:** `MissingMethodException` or `TypeLoadException` at runtime in IL2CPP builds.

**Cause:** The IL2CPP linker strips types and methods it considers unreachable.

**Solution:** Add a `link.xml` file to your project that preserves ConjureDB and MessagePack assemblies:

```xml
<!-- Assets/link.xml -->
<linker>
  <assembly fullname="ConjureDB" preserve="all" />
  <assembly fullname="ConjureDB.CodeGen" preserve="all" />
  <assembly fullname="MessagePack" preserve="all" />
  <assembly fullname="MessagePack.Annotations" preserve="all" />
</linker>
```

---

### AOT compilation errors with DbContextBuilder

**Problem:** `InvalidOperationException` when using `DbContextBuilder<T>.Create()` under IL2CPP.

**Cause:** The unified builder expects a public `TContext(DbConfiguration)` constructor. If that constructor is missing or non-public, `Create()` cannot bind to the context type.

**Solution:** Keep the `DbConfiguration` constructor public and continue using `Create()`:

```csharp
public partial class GameDb : DbContext
{
    public GameDb(DbConfiguration config) : base(config)
    {
    }
}

var db = DbContextBuilder<GameDb>.Create()
    .Build();
```

---

### Mono vs IL2CPP behavioral differences

**Problem:** Code works in the Unity Editor (Mono) but fails in IL2CPP builds.

**Cause:** IL2CPP has stricter AOT constraints — no runtime code generation, no `System.Reflection.Emit`, stricter generic instantiation.

**Solution:**

1. Always test in an IL2CPP build before shipping.
2. Avoid `dynamic`, runtime generic type construction, and stripping the public `DbConfiguration` constructor that `DbContextBuilder<T>.Create()` relies on.
3. Use `query` — the source generator produces AOT-compatible code at build time.

---

### WebGL limitations

**Problem:** File I/O or persistence features do not work in WebGL builds.

**Cause:** WebGL runs in a browser sandbox with no direct filesystem access.

**Solution:**

1. Use ConjureDB in **in-memory-only mode** (no persistence) for WebGL.
2. For save/load, serialize the snapshot to a byte array and store via `PlayerPrefs` or IndexedDB (via a JavaScript plugin).
3. Keep data sizes small — WebGL has limited memory.

---

### Android/iOS file path issues

**Problem:** `FileNotFoundException` or `UnauthorizedAccessException` when configuring persistence on mobile.

**Cause:** Mobile platforms restrict writable paths.

**Solution:** Use `Application.persistentDataPath`:

```csharp
var db = DbContextBuilder<GameDb>.Create()
    .WithDataDirectory(Application.persistentDataPath + "/conjuredb")
    .Build();
```

---

## Schema & Migration Issues

### SchemaMigrationException on startup

**Problem:** `SchemaMigrationException` when loading a snapshot with a different schema version.

**Cause:** The entity schema changed (fields added, removed, or types changed) and no migration was registered.

**Solution:**

1. For **adding nullable fields**: no migration needed — MessagePack tolerates missing keys (they default to `null`/`default`).
2. For **breaking changes** (field removal, type change, reordering): increment the table `schema_version` and register a migration handler.
3. Ensure `type_id` is stable across versions - it is the entity's identity for persistence.

```prql
table Player(plural: Players, persistence: local, type_id: 1, schema_version: 2) {
  id        : int @id
  name      : string
  level     : int
  new_field : int?
}
```

**See also:** [Schema Migration](/docs/schema/schema-migration)

---

### Schema fingerprint mismatch

**Problem:** `Incompatible` migration verdict with no clear schema difference.

**Cause:** The FNV-1a fingerprint includes `TypeId`, `SchemaVersion`, and all field descriptors. Even reordering `[Key]` ordinals changes the fingerprint.

**Solution:**

1. Never reorder persisted field ordinals - append new fields after existing fields.
2. Check that `type_id` and `schema_version` values match what was used when the snapshot was saved.

---

## Reactive Query Issues

### Subscription not firing on data change

**Problem:** A `reactive query` subscription does not emit updates when the underlying data changes.

**Cause:** The reactive system uses Incremental View Maintenance (IVM) — it only fires for changes that affect the query's result set.

**Solution:**

1. Verify the mutation is inside a committed transaction (`BeginTransaction()` → mutate → `Commit()`).
2. Confirm the change actually affects the query result (e.g., if the filter excludes the modified row, no notification fires).
3. Check that the subscription is still active and not disposed.

---

### Stale data in reactive view

**Problem:** The reactive query returns data that does not reflect the latest commit.

**Cause:** Reactive queries expose maintained materialized relation/index state.
Changes become visible after the transaction commits and the reactive registry
drains the affected materialized slice buffers.

**Solution:** Read from the reactive query **after** `Commit()` and
`ReactiveQueryRegistry.SyncReactiveQueries()`, not between `BeginTransaction()`
and `Commit()`. `Current` reflects the latest drained materialized state.

---

### UM6010 — No supported reactive materialized maintainer

**Problem:** `error UM6010: ReactiveUnsupportedMaintainerRejected` — the reactive compiler cannot lower the query to a Z-set materialized maintainer.

**Cause:** The query pattern is outside the current materialized-view maintainer matrix, so there is no reactive execution path to generate.

**Solution:**

1. Simplify the query to use patterns supported by IVM (simple filters, joins, aggregates, TopK).
2. If live subscription is not required, use a standard `query` and invoke it explicitly from the caller.

**See also:** [Reactive Queries](/docs/advanced/reactive-queries) · [UM6010 in Error Codes](/docs/reference/error-codes#emission-errors-um6xxx)

---

### Performance degradation with many reactive subscriptions

**Problem:** Frame time increases proportionally with the number of active reactive queries.

**Cause:** Each active reactive query observes a maintained materialized
relation or index slice. Too many live subscriptions can amplify commit and
slice replay cost.

**Solution:**

1. Only subscribe to reactive queries that need real-time updates (e.g., visible UI).
2. Dispose subscriptions when they are no longer visible (e.g., when a UI panel closes).
3. Use runtime reactive telemetry to identify the most expensive materialized
   maintenance or slice replay paths.

---

## FAQ

### General

**Q: Is ConjureDB thread-safe?**
A: ConjureDB uses a **single-writer** model. Reads (`FindById`, `All`, compiled queries) are safe from any thread, including Unity's job system. Writes (`BeginTransaction`, `Add`, `Update`, `Remove`, `Commit`) must be serialized to a single thread.

---

**Q: How much data can ConjureDB handle?**
A: ConjureDB is designed for game-client-scale data: thousands to hundreds of thousands of entities per table. The primary index uses a Robin Hood hashtable with O(1) lookups. For larger datasets, set the `capacity` hint appropriately to avoid excessive rehashing.

---

**Q: Does ConjureDB support SQL?**
A: No. ConjureDB uses a pipe-based DSL that is more expressive for game development patterns. See the [Query Language Reference](/docs/query-language/reference) for complete syntax. A [SQL Reference](/docs/query-language/sql-reference) comparison is available for users migrating from SQL.

---

**Q: Can I use ConjureDB without the source generator?**
A: Yes. The core engine (`DbContext`, `DbSet<T>`, transactions, persistence) works standalone. Compiled queries are opt-in via `ConjureDB.CodeGen`. You can use `FindById()`, `All()`, and index methods directly.

---

**Q: What happens if my app crashes mid-transaction?**
A: Uncommitted transactions are discarded. Committed data is recovered from the latest snapshot plus journal replay on next startup. No partial commits are possible.

---

### Queries

**Q: Can I use LINQ with ConjureDB?**
A: You can, but it is **not recommended** for hot paths. LINQ allocates (enumerator objects, closures, delegate invocations) which causes GC pressure. Use `query` for zero-allocation queries or call index methods directly.

---

**Q: How do I do a LEFT JOIN?**
A: Use the `left join` syntax in the DSL. Declare the query in a `.conjure` schema and call the generated method:

```text
query GetPlayersWithGuilds() -> PlayerGuildView[] =
    from Players p | left join Guilds g (p.GuildId == g.Id) | select p.Name, g.Name
```

```csharp
PlayerGuildView[] result = db.Players.GetPlayersWithGuilds();
```

Players without a matching guild will have `null` for the guild columns.

---

**Q: Why is my query returning no results?**
A: Common causes:
1. **Filter too restrictive** — check parameter values match existing data.
2. **Wrong table name** — see [UM1007](#um1007--table-not-found).
3. **Case sensitivity** — string comparisons in filters are case-sensitive by default.
4. **Empty table** — verify data was inserted and committed before querying.

---

**Q: How do I debug a compiled query?**
A: The generated `.g.cs` file includes the original DSL text (`// DSL:`) and per-operator strategy comments (e.g. `// === Join Strategy: SecondaryIndexLookup ===`) under `obj/Debug/net8.0/generated/`. The full optimization trace and physical plan are **not** embedded in the generated file — emit them as a separate markdown report with `--dump-plan` / `--dump-plan-report`. Declare the query in a `.conjure` schema:

```text
query GetTop() -> Player[] = from Players | filter Level > 10 | sort -Score | take 5
```

```bash
dotnet run --project ConjureDB.CodeGen.Manual -- <schemaDir> <outDir> --dump-plan=GetTop --dump-plan-report=plan-report.md
```

---

### Performance

**Q: How do I know if my query uses an index?**
A: Three approaches:
1. **Compiler warnings** — if the query does a full scan, the compiler emits `UM7001` (full scan on a large table). `UM7009` (index recommendation) is produced only when the experimental index-access analyzer is explicitly enabled (`CompilerOptions.EnableExperimentalIndexAccessAnalyzer = true`); by default it is off, so rely on the auto-index advisory below.
2. **Plan-diagnosis report** — emit the physical plan for the query to see which index (if any) was selected for each scan node:

```bash
dotnet run --project ConjureDB.CodeGen.Manual -- <schemaDir> <outDir> --dump-plan=<QueryName> --dump-plan-report=plan-report.md
```

3. **Auto-index advisory** — if you compile with `CompilerOptions.AutoIndexing.Mode = ReportOnly`, inspect `PlanExplain.AutoIndexAdvisory` or the derived `auto-index-report.json`. This shows which missing indexes would likely help, without mutating the schema or changing the selected executable plan.

---

**Q: What's the overhead of reactive queries?**
A: Reactive queries add per-commit overhead proportional to the number of
changed rows, not total rows. For typical game UIs, IVM provides up to 2000x
improvement over full re-evaluation. Use runtime reactive telemetry to measure
materialized maintenance and slice replay costs.

---

**Q: What is PGO and should I use it?**
A: Profile-Guided Optimization (PGO) lets the compiler use runtime statistics (table sizes, selectivities) to choose better join strategies, buffer sizing, and index advisory decisions. Collect a profile from a representative play session, then pass it to the compiler. If you want safe index guidance, enable `AutoIndexingMode.ReportOnly`; it produces advisory output only and does not create indexes automatically. See [PGO](/docs/performance/pgo) for the workflow.

---

### Unity

**Q: Does ConjureDB work with IL2CPP?**
A: Yes. ConjureDB is designed for IL2CPP from the ground up. Use `DbContextBuilder<T>.Create()` with a public `TContext(DbConfiguration)` constructor, add `link.xml` to prevent stripping, and use `query` for AOT-safe query generation. See [IL2CPP code stripping](#il2cpp-code-stripping) and [AOT compilation errors](#aot-compilation-errors-with-dbcontextbuilder).

---

**Q: Can I use ConjureDB in a Unity ECS (DOTS)?**
A: ConjureDB is a separate in-memory database, not an ECS replacement. You can use it alongside DOTS for persistent game data (inventory, progression, configuration) while DOTS handles simulation. Access ConjureDB from the main thread and copy results into ECS components as needed.

---

**Q: What about WebGL?**
A: ConjureDB works in WebGL for in-memory-only usage. Persistence features require filesystem access, which is unavailable in the browser sandbox. See [WebGL limitations](#webgl-limitations) for workarounds.

---

**Q: What Unity versions are supported?**
A: Unity 2021.3 LTS and later, targeting .NET Standard 2.1. Both Mono and IL2CPP scripting backends are supported, though IL2CPP is the recommended production target.

---

## Getting More Help

If your issue is not covered here:

1. Check the [Error Codes](/docs/reference/error-codes) reference for detailed explanations of every diagnostic code.
2. Emit a plan-diagnosis report with `dotnet run --project ConjureDB.CodeGen.Manual -- <schemaDir> <outDir> --dump-plan=<QueryName> --dump-plan-report=plan-report.md` to inspect the compiler's selected plan and optimization trace.
3. Review the [Performance Tips](/docs/performance/performance-tips) for optimization guidance.
4. File a bug report with: query text, entity schema, full diagnostic output, and .NET / Unity version.

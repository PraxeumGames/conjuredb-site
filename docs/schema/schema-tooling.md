# ConjureDB Schema Tooling Reference

> CLI commands, LSP support, migration integration, diagnostics, examples, and best practices for the ConjureDB Schema DSL.
> For schema syntax reference, see [Schema Language](/docs/schema/schema-language).

---

## 1  CLI Reference

### 1.1  `ConjureDB.Compiler` — Project-Aware Validation And Generation

`ConjureDB.Compiler.dll` is the single manual compiler assembly. Its CLI evaluates the
target SDK-style project through MSBuild/Roslyn, compiles the `.conjure`/DSL frontend,
and emits the complete executable generated pack. It is not installed as an analyzer
and does not run during normal `dotnet build`.

The compiler admits only normalized source format 2. The owning project must
declare `<ConjureDBSyntaxVersion>2</ConjureDBSyntaxVersion>` in its project
file only after all effective schema inputs owned by that project have been migrated; missing or unsupported versions are rejected rather than inferred. A
standalone stored schema owner uses `conjure.project.json` with exactly
`{"syntaxVersion": 2}`.

Projects that reference `ConjureDB.Compiler` inherit its complete CLI, Roslyn Workspace,
and MSBuild runtime dependency closure. Runtime and Unity projects that do not reference
the compiler remain free of that closure and compile only the committed generated C# pack.

**Usage:**

```bash
dotnet run --project ConjureDB.Compiler -- generate <project.csproj> [options]
dotnet run --project ConjureDB.Compiler -- verify <project.csproj> [options]
```

**Positional arguments:**

| Argument | Description |
|----------|-------------|
| `<project.csproj>` | Authoritative SDK-style C# project and semantic/reference closure |

**Options:**

| Option | Default | Description |
|--------|---------|-------------|
| `--schema-root <dir>` | `<project-dir>/schema` | Override the recursively searched schema directory |
| `--output <dir>` | `<project-dir>/Generated` | Override the generated-pack directory |
| `--context <Name>` | project-derived | Override the generated `DbContext` subclass name |
| `--namespace <Name>` | project-derived | Override the generated C# namespace |
| `--framework <TFM>` | project-derived | Select a target framework for a multi-target project |
| `--strict` | off | Treat compiler warnings as errors |

**Example:**

```bash
dotnet run --project ConjureDB.Compiler -- generate ./Game.Data.csproj \
    --schema-root ./schemas --output ./Generated \
    --context GameDbContext --namespace Game.Data
```

### 1.2  Pipeline Stages and Output

The CLI is fail-closed. It stops before publication when project loading, schema
processing, binding, planning, validation, or emission reports an error. `generate`
publishes a complete pack atomically; `verify` performs the same compilation without
publishing files.

One manual generation session holds the project and generated-pack locks through
MSBuild evaluation, candidate validation, diagnostics, and publication. Publication is
journaled before filesystem mutation and records exact paths, lengths, and SHA-256 hashes.
After an interrupted process, the next session either completes the already committed
directory rename or restores the exact previous pack; changed, linked, corrupt, or
otherwise ambiguous artifacts fail closed instead of being deleted. Cancellation before
the commit rename restores the previous pack.

### 1.3  Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Compilation succeeded |
| non-zero | Command, project-load, schema, binding, planning, emission, or I/O error |

### 1.4  Generated File Types

| File Pattern | Source Declaration | Content |
|-------------|-------------------|---------|
| `Schema.<EnumName>.g.cs` | `enum` | C# enum type |
| `Schema.<TableName>.g.cs` | `table` / `struct table` | Entity `record` / `record struct` with attributes |
| `Schema.<TypeName>.g.cs` | `type` / `struct type` | Plain `record` / `record struct` |
| `Schema.I<Entity>Queries.g.cs` | `query` / `reactive query` | Repository interface with `query` methods |
| `Schema.I<Entity>Mutations.g.cs` | `mutation` | Repository interface with `mutation` methods |
| `Schema.<ModuleInterfaceName>.g.cs` | `module` | Module interface containing query/mutation members |
| `Schema.<ContextName>.g.cs` | *(all tables)* | executable `partial class <ContextName> : DbContext` with schema descriptor registration |

### 1.5  Generated DbContext

The generated `DbContext` registers a typed `DbSet<T>` for each table using the schema descriptor:

```csharp
using System;
using ConjureDB;

namespace Game.Data;

public partial class GameDbContext : DbContext
{
    public GameDbContext(DbConfiguration config) : base(config)
    {
    }

    protected override void Build()
    {
        RegisterSet(new DbSet<Player>(this, PlayerDescriptor));
        RegisterSet(new DbSet<Guild>(this, GuildDescriptor));
        RegisterSet(new DbSet<Inventory>(this, InventoryDescriptor));
    }
}
```

The supported full pipeline is:

1. Keep `.conjure` sources under the target project's schema root.
2. Run `ConjureDB.Compiler verify` or `generate` explicitly against that project.
3. Commit the complete generated pack; ordinary builds compile it as C# and never load
   compiler assemblies.

**Pluralization rules:**
- Names ending in `s`, `x`, `z`, `ch`, `sh` → append `es` (e.g., `Match` → `Matches`)
- Names ending in consonant + `y` → replace `y` with `ies` (e.g., `Inventory` → `Inventories`)
- Otherwise → append `s` (e.g., `Player` → `Players`)

---

## 2  LSP Support

The `ConjureDB.Schema.Lsp` project provides a Language Server Protocol server for `.conjure` files.

### 2.1  Editor Integration

The LSP server is launched by the `vscode-conjuredb` VSCode extension. It communicates via stdin/stdout using the standard LSP protocol.

**To install:**

```bash
cd vscode-conjuredb
npm ci && npm run compile && npm run package:vsix && npm run install:vsix
```

### 2.2  Supported LSP Features

| Feature | Handler | Description |
|---------|---------|-------------|
| Diagnostics | `TextDocumentSyncHandler` | Real-time parse and binding errors as you type |
| Go-to-definition | `DefinitionHandler` | Navigate to declaration of tables, enums, types, fragments |
| Find references | `ReferencesHandler` | Find all usages of a symbol across the import closure |
| Completion | `CompletionHandler` | Context-aware suggestions for types, tables, enums, fields, annotations |
| Hover | `HoverHandler` | Type information and declaration details on hover |
| Document symbols | `DocumentSymbolHandler` | Outline view of tables, enums, queries, mutations, fragments |

### 2.3  Import Closure Scope

For any active document, the LSP builds a **transitive import closure** (the active file plus all recursively imported files) and runs all language features on that closure:

- Go-to-definition resolves symbols from imported files.
- Find references collects references across the closure.
- Completion includes tables/enums/queries/mutations from imported files.
- Hover describes symbols declared in imported files.

Imported files are loaded from disk on demand, even if not currently open in the editor.

**Current limitations:**
- The LSP does **not** build a full project-wide semantic index.
- IntelliSense scope is limited to the active file's transitive import closure.
- Symbols in unrelated workspace files are excluded until reachable through imports.

### 2.4  VSCode Extension Features

- **Syntax highlighting** — keywords, types, annotations, operators, strings, comments
- **Bracket matching and auto-closing** — `{}`, `[]`, `()`, `""`
- **Code folding** — fold table, query, mutation, fragment blocks
- **Full LSP integration** — all features listed above

### 2.5  Module Support

- **Syntax highlighting** — the `module` keyword is highlighted as a declaration keyword.
- **Completions** — the LSP provides context-aware completions inside module bodies (tables, queries, mutations, fragments, etc.).
- **Document outline** — modules appear as top-level symbols with nested tables, queries, and mutations in the outline view.
- **Snippets** — type `module` or `ummod` to expand the module declaration snippet.

---

## 3  Migration Integration

### 3.1  Schema Versioning

Use `schema_version` and `type_id` table options to enable migration tracking:

```conjure
table Player(persistence: local, type_id: 1, schema_version: 3) {
  id    : int  @id
  name  : string
  score : long     // was: int in version 2
}
```

Generated descriptor metadata:

```csharp
new EntitySchemaDescriptor(
    typeId: 1,
    schemaVersion: 3,
    entityName: "Player",
    fields: PlayerFields)
```

### 3.2  Compatibility, Auto-Handled Changes, and Manual Migration

When loading persisted snapshots, ConjureDB compares the stored schema fingerprint against the current definition and classifies the change as identical, backward-compatible, requiring migration, or incompatible. Adding/removing fields and widening nullability are auto-handled; breaking changes (type change, narrowed nullability) require an `EntityMigrationBuilder` registered in `DbContext.OnBeforeBuild()`. Single-step migrations (v1→v2, v2→v3) are resolved into contiguous, forward-only chains automatically. See [Schema Migration](/docs/schema/schema-migration) for the compatibility verdict table ([Overview](/docs/schema/schema-migration#overview)), [auto-handled changes](/docs/schema/schema-migration#automatic-handling), the builder's `KeepField`/`DropField`/`AddField`/`TransformField` operations ([Field Operations](/docs/schema/schema-migration#field-operations)), and migration chains.

---

## 4  Diagnostic Reference

### 4.1  Code Ranges

| Code Range | Phase | Description |
|------------|-------|-------------|
| `SCH0xxx` | Lexer | Unterminated strings, unexpected characters |
| `SCH1xxx` | Parser | Unexpected tokens, invalid options, empty bodies |
| `SCH2xxx` | Binder | Duplicate names, unknown types, FK validation, PK validation |
| `SCH3xxx` | Import graph | Missing imports, cycles, duplicate file identities |
| `SCH5xxx` | Semantic validator | Structural invariants (pre-bind) |

### 4.2  Complete Diagnostic List

| Code | Phase | Severity | Description |
|------|-------|----------|-------------|
| `SCH1001` | Parser | Error | Expected token not found (type name, `@default` constant, body delimiter) |
| `SCH1002` | Parser | Error | Unexpected token (expected declaration or field) |
| `SCH1003` | Parser | Error | Invalid table option (unknown key or invalid persistence value) |
| `SCH1004` | Parser | Error | Invalid index kind |
| `SCH1005` | Parser | Error | Invalid annotation (`@` or `@@` with unknown keyword) |
| `SCH1006` | Parser | Error | Invalid index option key or value |
| `SCH1007` | Parser | Error | Empty body (query, mutation, or fragment) |
| `SCH1008` | Parser | Error | Integer literal out of Int32 range |
| `SCH1021` | Parser | Error | Type field does not support annotations |
| `SCH2001` | Binder | Error | Duplicate declaration name (enum, table, type, query, mutation, fragment, extern alias) |
| `SCH2003` | Binder | Error | Foreign key references non-existent table |
| `SCH2004` | Binder | Error | Critical reference error (abort emission) |
| `SCH2005` | Binder | Error | Table has no primary key field |
| `SCH2006` | Binder | Error | Table has multiple primary key fields |
| `SCH2007` | Binder | Error | Unknown index type |
| `SCH2011` | Binder | Error | Duplicate field name after PascalCase normalization |
| `SCH2014` | Binder | Error | Duplicate `[Key]` ordinal in table |
| `SCH2015` | Binder | Error | Invalid enum backing type |
| `SCH2016` | Binder | Error | Invalid `aggregation_variant` value |
| `SCH2017` | Binder | Error | `aggregation_variant` on non-aggregation index |
| `SCH2018` | Binder | Error | Query body must start with `from <Table>` / source table not declared |
| `SCH2020` | Binder | Error | Field count exceeds maximum |
| `SCH3002` | Import | Error | Missing import target |
| `SCH3003` | Import | Error | Import cycle detected |
| `SCH3004` | Import | Error | Duplicate canonical file identity |
| `SCH5001` | Validator | Error | Duplicate field name in table (pre-bind) |
| `SCH5002` | Validator | Error | `@id` and `@relation` on same field |
| `SCH5003` | Validator | Warning | Missing `@id` on non-struct table |
| `SCH5005` | Validator | Error | Duplicate field name in type |
| `SCH5006` | Validator | Error | Type field has table annotations |
| `SCH5007` | Validator | Error | `@@index` field does not exist in table |

---

## 5  Examples

### 5.1  Complete Game Schema

```conjure
// game.conjure — Full game schema example

// ═══════════════════════════════════
// Enums
// ═══════════════════════════════════

enum PlayerStatus {
    Active = 0,
    Banned = 1,
    Inactive = 2,
}

enum Rank : byte {
    Recruit = 0,
    Veteran = 1,
    Elite   = 2,
    Officer = 3,
}

// ═══════════════════════════════════
// Custom Types (DTOs)
// ═══════════════════════════════════

type PlayerDto {
    id       : int
    name     : string
    rank     : Rank
    level    : int
    score    : int
    guild_id : int?
}

type GuildDto {
    id    : int
    title : string
    rank  : Rank
}

// ═══════════════════════════════════
// Extern Type Aliases
// ═══════════════════════════════════

extern type Vector3   = UnityEngine.Vector3
extern type GeoPoint  = Game.Contracts.GeoPoint
extern type GuildView = Game.Contracts.GuildView

// ═══════════════════════════════════
// Tables
// ═══════════════════════════════════

table Guild(persistence: local, capacity: 256) {
    id        : int    @id
    title     : string @unique
    rank      : Rank
    leader_id : int?

    @@index(fields: [title], name: "Guild_ByTitle", kind: lookup)
    @@index(fields: [rank],  name: "Guild_ByRank",  kind: lookup)
}

table Player(persistence: local, capacity: 16384) {
    id        : int          @id
    guild_id  : int?         @relation(references: Guild.id, on_delete: set_null)
    name      : string
    rank      : Rank
    level     : int
    score     : int
    status    : PlayerStatus
    tags      : list<string>
    avatar    : binary?
    position  : GeoPoint?

    @@index(fields: [guild_id], name: "Player_ByGuild",      kind: lookup)
    @@index(fields: [name],     name: "Player_ByName",       kind: lookup)
    @@index(fields: [level],    name: "Player_ByLevel",      kind: sorted_set)
    @@index(fields: [score],    name: "Player_ByScore",      kind: sorted_set,
            is_pgo_recommended: true)
    @@index(fields: [guild_id asc, level desc], name: "Player_ByGuildLevel",
            kind: sorted_set)
    @@index(fields: [guild_id asc, score desc], name: "Player_ByGuildScore",
            kind: sorted_set)
}

table Item {
    id       : int    @id
    owner_id : int    @relation(references: Player.id, on_delete: cascade)
    name     : string
    rarity   : int

    @@index(fields: [owner_id], name: "Item_ByOwner", kind: lookup)
}

struct table Position {
    id : int   @id
    x  : float
    y  : float
    z  : float
}

table Inventory(type_id: 10, schema_version: 2) {
    id        : int          @id
    player_id : int          @relation(references: Player.id, on_delete: cascade)
    data      : binary
    tags      : list<string>
    position  : Vector3
}

// ═══════════════════════════════════
// Fragments
// ═══════════════════════════════════

fragment high_level_players(min_level: int) =
    from Player
    | filter level >= @min_level

fragment players_in_guild(gid: int) =
    from Player
    | filter guild_id == @gid

// ═══════════════════════════════════
// Queries
// ═══════════════════════════════════

query ListGuilds() -> Guild[] {
    from Guild
    | sort title
}

query GetGuildById(id: int) -> Guild {
    from Guild
    | filter id == @id
    | single
}

query ListHighLevelPlayers(min_level: int) -> Player[] {
    @high_level_players(@min_level)
    | sort -score
    | take 100
}

query ListGuildPlayers(gid: int) -> Player[] {
    @players_in_guild(@gid)
    | sort -level
    | take 50
}

query ListPlayerNames(min_level: int) -> string[] {
    from Player
    | filter level >= @min_level
    | sort name
    | select name
}

query PlayerTagBuckets() -> list<string>[] {
    from Player
    | select tags
}

query TopPlayersDto(min_level: int) -> PlayerDto[] {
    from Player
    | filter level >= @min_level
    | sort -score
    | take 100
    | select {
        id = id,
        name = name,
        rank = rank,
        level = level,
        score = score,
        guild_id = guild_id
      }
}

query GuildDtos() -> GuildDto[] {
    from Guild
    | sort title
    | select { id = id, title = title, rank = rank }
}

query GuildViewsClr() -> GuildView[] {
    from Guild
    | sort title
    | select { Id = id, Title = title, Rank = rank }
}

// ═══════════════════════════════════
// Reactive Queries
// ═══════════════════════════════════

reactive query WatchTopPlayers(min_level: int) -> Player[] {
    from Player
    | filter level >= @min_level
    | sort -score
    | take 10
}

// ═══════════════════════════════════
// Mutations
// ═══════════════════════════════════

mutation ResetGuildTitles() -> int {
    update Guild
    | set { title = "reset" }
    | require confirm_full_table
}

mutation BanPlayer(player_id: int) {
    update Player
    | filter id == @player_id
    | set { status = 1 }
}

mutation DeleteInactivePlayers() -> int {
    delete Player
    | filter status == 2
}

mutation CreatePlayer(name: string, level: int) -> Player {
    insert Player
    | values { name = @name, level = @level, score = 0, status = 0 }
}

mutation PromotePlayers(min_level: int) -> int {
    update Player
    | filter level >= @min_level
    | set { rank = Rank.Elite }
}
```

### 5.2  Multi-File Project

**`schema/core/types.conjure`:**

```conjure
enum Rank : byte {
    Bronze = 0,
    Silver = 1,
    Gold = 2,
}

type Currency {
    code   : string
    amount : decimal
}

extern type Vector3 = UnityEngine.Vector3
```

**`schema/entities/guild.conjure`:**

```conjure
import "../core/types.conjure"

table Guild(persistence: local, capacity: 256) {
    id    : int    @id
    name  : string @unique
    rank  : Rank

    @@index(fields: [name], name: "Guild_ByName", kind: lookup)
}
```

**`schema/entities/player.conjure`:**

```conjure
import "../core/types.conjure"
import "guild.conjure"

table Player(persistence: local, capacity: 16384) {
    id       : int    @id
    guild_id : int?   @relation(references: Guild.id, on_delete: set_null)
    name     : string
    rank     : Rank
    balance  : Currency

    @@index(fields: [name],     name: "Player_ByName",  kind: lookup)
    @@index(fields: [guild_id], name: "Player_ByGuild", kind: lookup)
}

fragment active_players() =
    from Player
    | filter rank != Rank.Bronze

query TopPlayers() -> Player[] {
    @active_players()
    | sort -rank
    | take 100
}
```

**Generate:**

```bash
dotnet run --project ConjureDB.Compiler -- generate ./Game.Data.csproj \
    --schema-root ./schema --output ./Generated \
    --context GameDbContext --namespace Game.Data
```

### 5.3  Complex Index Configurations

```conjure
table Analytics(persistence: local, capacity: 65536) {
    id          : int    @id
    user_id     : int
    event_type  : int
    timestamp   : datetime
    value       : float
    region      : string

    // Hash lookup for user queries
    @@index(fields: [user_id], name: "Analytics_ByUser", kind: lookup)

    // Sorted index for time-range queries
    @@index(fields: [timestamp], name: "Analytics_ByTime", kind: sorted_set)

    // Composite sorted index with direction control
    @@index(fields: [event_type asc, timestamp desc],
            name: "Analytics_ByEventTime",
            kind: sorted_set)

    // Aggregation index for sum/count queries
    @@index(fields: [event_type],
            name: "Analytics_EventAgg",
            kind: aggregation,
            value: value,
            aggregation_variant: sum_count)

    // Partial index for event type 1; this is a typed .conjure expression
    @@index(fields: [region],
            name: "Analytics_EventType1",
            kind: lookup,
            filter: event_type == 1)

    // Index with covering columns
    @@index(fields: [user_id],
            name: "Analytics_UserCover",
            kind: sorted_set,
            included: [event_type, value])

    // PGO-recommended index
    @@index(fields: [user_id, event_type],
            name: "Analytics_UserEvent",
            kind: sorted_set,
            is_pgo_recommended: true)
}
```

`Analytics_EventType1` indexes only rows whose `event_type` is exactly `1`.
It is not equivalent to indexing every positive event type: partial-index
maintenance does not admit `event_type > 0`. Use an explicitly maintained
boolean field if that broader membership is required.

### 5.4  Schema with All Type Variants

```conjure
extern type CustomData = MyApp.Types.CustomData

enum Priority {
    Low = 0,
    Medium = 1,
    High = 2,
    Critical = 3,
}

type Metadata {
    created_by : string
    created_at : datetime
    version    : int
}

struct type Coordinate {
    lat : double
    lng : double
}

table Task(persistence: local, capacity: 4096) {
    id          : int             @id
    title       : string
    priority    : Priority
    metadata    : Metadata
    location    : Coordinate?
    tags        : list<string>
    scores      : int[]
    binary_data : binary
    custom      : extern CustomData?
    deadline    : datetime?
    duration    : timespan
    ref_id      : guid
    is_active   : bool
    weight      : float
    counter     : long

    @@index(fields: [priority], name: "Task_ByPriority", kind: sorted_set)
    @@index(fields: [is_active asc, priority desc], name: "Task_ActivePriority",
            kind: sorted_set)
}
```

The fields of this persistent table declare no defaults: a field default is
`@default(constant)`, and it is admitted only on plain ephemeral tables, where
it completes an `insert`/`upsert` payload that omits the field
(see [Schema Language §8.3](/docs/schema/schema-language)). Initialize `is_active`,
`weight` and `counter` explicitly when creating a `Task`. The retired
`field: T = value` suffix is rejected with `SCH2173`.

---

## 6  Best Practices

### 6.1  Naming Conventions

- **Files:** use `snake_case.conjure` or descriptive names (`game.conjure`, `analytics.conjure`).
- **Tables:** use `PascalCase` singular nouns (`Player`, `Guild`, `InventoryItem`).
- **Fields:** use `snake_case` in schema (`guild_id`, `created_at`); they auto-convert to `PascalCase` in C#.
- **Enums:** use `PascalCase` for both type and members (`PlayerStatus`, `Active`).
- **Indexes:** use descriptive names with entity prefix (`Player_ByGuild`, `Analytics_ByEventTime`).
- **Queries/Mutations:** use `PascalCase` verb-noun (`GetTopPlayers`, `BanPlayer`, `DeleteInactive`).
- **Fragments:** use `snake_case` descriptive names (`active_players`, `high_level_players`).

### 6.2  Index Strategy

- **Start with lookup indexes** on fields used in `filter` equality expressions.
- **Use sorted_set indexes** on fields used in range predicates or `sort` clauses.
- **Add composite indexes** when queries frequently filter/sort on field combinations.
- **Use `included` columns** to create covering indexes and avoid table lookups.
- **Apply `aggregation_variant: count_only`** when only counts are needed (reduces memory).
- **Use `is_pgo_recommended: true`** to mark PGO-suggested indexes for documentation.

### 6.3  Schema Organization

- **One file per domain area** — keep related tables, queries, and mutations together.
- **Extract shared types** into a `core/` or `shared/` directory and use imports.
- **Use extern type aliases** for frequently referenced CLR types.
- **Use fragments** to avoid duplicating common filter/sort pipelines.
- **Keep query bodies concise** — use a braced pipeline body for a single-pipeline query.

### 6.4  Version Management

- **Always assign `type_id`** to persisted tables — auto-generated IDs can shift.
- **Increment `schema_version`** on every breaking change.
- **Never reuse `[Key]` ordinals** for fields with different types.
- **Prefer backward-compatible changes** — add nullable fields instead of changing types.
- **Register migration chains** contiguously (v1→v2, v2→v3 — no gaps).

---

## 7  Appendix: Normalized Syntax Summary

Project-aware compilation admits .conjure source format 2 only. The full
reference is [Schema Language](/docs/schema/schema-language); the forms below summarize
the declaration and expression distinctions most often needed when authoring:

```ebnf
(* Selected normalized format-2 forms; the full grammar is in the Schema Language reference. *)
parameters          = "(", [ parameter, { ",", parameter } ], ")" ;
parameter           = IDENT, ":", type ;
parameter_reference = "@", IDENT ;

query               = [ "reactive" ], "query", IDENT, parameters, "->", type,
                      [ query_hints ], "{", query_body, "}" ;
mutation            = "mutation", IDENT, parameters, [ "->", type ],
                      "{", mutation_body, "}" ;
command             = "command", IDENT, parameters, [ "->", type ],
                      [ command_metadata ], "{", command_statements, "}" ;
system              = "system", IDENT, "(", system_options, ")",
                      "{", system_body, "}" ;
fragment            = "fragment", IDENT, parameters,
                      ( "=", pipeline | "{", pipeline, "}" ) ;
view                = "view", IDENT, "{", { field }, "}", "=", pipeline ;

field               = IDENT, ":", type, { field_annotation } ;
metadata_entry      = IDENT, ":", metadata_value ;
projection_field    = IDENT, "=", expression ;
value_field         = IDENT, "=", expression ;

pipeline            = source, { "|", transform } ;
source              = "from", qualified_name, [ IDENT ]
                    | "@", IDENT, "(", [ argument_list ], ")" ;
transform           = "filter", expression | "sort", sort_list
                    | "take", expression | "skip", expression
                    | "select", projection_list | "join", join_source
                    | "group", group_expression
                    | "aggregate", "{", aggregate_list, "}" ;
```

Schema fields and named metadata use :; record values and named projection
fields use =. Operation parameters are referenced as @name. Query, mutation,
command, and system bodies are braced; fragments and views keep their
declaration-specific forms. Query pipeline filtering is spelled filter.



*For additional documentation see:*
- [Schema Language Reference](/docs/schema/schema-language)
- [Query Language Reference](/docs/query-language/reference)
- [Schema Migration Guide](/docs/schema/schema-migration)
- [Getting Started](/docs/getting-started)
- [Profile-Guided Optimization](/docs/performance/pgo)
- VSCode Extension README

## Named scalar constants

Named constants are evaluated when the schema is compiled and become typed literals in generated
execution. They do not add runtime parameters or tables:

```conjure
const Tau: float = 6.2831855f
const MissingLimit: int? = null
const DefaultLimit: int = MissingLimit ?? 42

module Combat {
    const DefaultLimit: int = 100
    const DoubleLimit: int = DefaultLimit * 2
}
```

Definitions may refer to later constants. Their dependency graph must be acyclic. Inside a module,
exact local names shadow global exact names; another module's value uses its qualified name, such
as `Combat.DoubleLimit`. Case-only spelling changes are not constant-name aliases.

The declared scalar or enum type, including nullability, is preserved. Null requires a nullable
declared carrier. Implicit nullable-to-nonnullable assignments are refused. Integral constant
narrowing is range-checked; arithmetic is checked unless the expression explicitly uses
`unchecked`. Every branch must be compile-time closed, even if evaluation will not select it.
An unselected arithmetic fault is not executed.

Function calls, runtime parameters, tables, collections, records, entity references, and object or
binary payloads are not named scalar constants. Floating constant values must be finite. These
rules do not introduce or change const-table content providers.

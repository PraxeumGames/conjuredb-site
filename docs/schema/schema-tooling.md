# ConjureDB Schema Tooling Reference

> CLI commands, LSP support, migration integration, diagnostics, examples, and best practices for the ConjureDB Schema DSL.
> For schema syntax reference, see [Schema Language](/docs/schema/schema-language).

---

## 1  CLI Reference

### 1.1  `ConjureDB.Schema.Cli` — Validation + Metadata Generation

> **Supported path after wave one:** `ConjureDB.Schema.Cli` validates `.conjure` files and emits **metadata C#**. To get an executable `DbContext` and runnable queries, include the emitted C# in a project that also runs `ConjureDB.CodeGen` (or `ConjureDB.CodeGen.Manual`).

**Usage:**

```bash
dotnet run --project ConjureDB.Schema.Cli -- <schema-dir> <output-dir> [options]
```

**Positional arguments:**

| Argument | Description |
|----------|-------------|
| `<schema-dir>` | Directory containing `.conjure` files (searched recursively) |
| `<output-dir>` | Directory where generated `.g.cs` files are written (created if not exists) |

**Options:**

| Option | Default | Description |
|--------|---------|-------------|
| `--context=<Name>` | `AppDbContext` | Name of the generated `DbContext` subclass |
| `--namespace=<Name>` | `Generated` | C# namespace for all generated code |
| `--validate` | off | Run parse/import/merge/bind validation without writing `.g.cs` output |

**Example:**

```bash
dotnet run --project ConjureDB.Schema.Cli -- \
    ./schemas ./Generated \
    --context=GameDbContext \
    --namespace=Game.Data
```

### 1.2  Pipeline Stages and Output

The CLI is fail-fast. It processes files in stages, prints progress to stdout and diagnostics to stderr, and stops before emission if any stage reports errors:

```
Found 3 .conjure file(s)
Resolving imports...
Merging declarations...
Binding...
Emitting to ./Generated...
  → PlayerStatus.g.cs
  → Player.g.cs
  → Guild.g.cs
  → IPlayerQueries.cs
  → IPlayerMutations.cs
  → GameDbContext.g.cs
Done. 6 file(s) generated.
```

### 1.3  Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success — all files generated |
| `1` | Error — parse, import, merge, bind, or I/O errors |

### 1.4  Generated File Types

| File Pattern | Source Declaration | Content |
|-------------|-------------------|---------|
| `<EnumName>.g.cs` | `enum` | C# enum type |
| `<TableName>.g.cs` | `table` / `struct table` | Entity `record` / `record struct` with attributes |
| `<TypeName>.g.cs` | `type` / `struct type` | Plain `record` / `record struct` |
| `I<Entity>Queries.cs` | `query` / `reactive query` | Repository interface with `query` methods |
| `I<Entity>Mutations.cs` | `mutation` | Repository interface with `mutation` methods |
| `<ModuleInterfaceName>.g.cs` | `module` | Module interface containing query/mutation members |
| `<ContextName>.g.cs` | *(all tables)* | executable `partial class <ContextName> : DbContext` with schema descriptor registration |

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

1. Add `.conjure` files as schema AdditionalFiles.
2. Let the source generator run the shared `SchemaPipelineRunner` path.
3. Use `ConjureDB.CodeGen.Manual` only when intentionally regenerating checked-in generated packs.

**Pluralization rules:**
- Names ending in `s`, `x`, `z`, `ch`, `sh` → append `es` (e.g., `Match` → `Matches`)
- Names ending in consonant + `y` → replace `y` with `ies` (e.g., `Inventory` → `Inventories`)
- Otherwise → append `s` (e.g., `Player` → `Players`)

---

## 2  LSP Support

The `ConjureDB.Schema.Lsp` project provides a Language Server Protocol server for `.conjure` files.

### 2.1  Editor Integration

The LSP server is launched by the `vscode-unimem` VSCode extension. It communicates via stdin/stdout using the standard LSP protocol.

**To install:**

```bash
cd vscode-unimem
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

```
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

### 3.2  Compatibility Detection

When loading persisted snapshots, ConjureDB compares the stored schema fingerprint (FNV-1a hash of TypeId + SchemaVersion + fields) against the current definition:

| Verdict | Action |
|---------|--------|
| `Identical` | Loaded directly |
| `BackwardCompatible` | Loaded via MessagePack tolerance (added fields, widened nullability) |
| `RequiresMigration` | Migration chain applied before deserialization |
| `Incompatible` | Hard error — `SchemaMigrationException` |
| `EntityRemoved` | Data skipped (warning logged) |
| `EntityAdded` | Empty DbSet initialized |

### 3.3  Auto-Handled Changes

No migration code required for:

- **Adding a new field** — MessagePack assigns default values to absent fields.
- **Removing a field** — MessagePack silently skips extra stored fields (do not reuse the ordinal).
- **Widening nullability** — `string` → `string?` is backward-compatible.

### 3.4  Manual Migration Builder

For breaking changes (type change, narrowed nullability), register migrations in `DbContext.OnBeforeBuild()`:

```csharp
protected override void OnBeforeBuild()
{
    MigrationRegistry.Register(
        new EntityMigrationBuilder(typeId: 1, fromVersion: 2, toVersion: 3)
            .KeepField(0)                                        // Id: keep
            .KeepField(1)                                        // Name: keep
            .TransformField<int, long>(2, static v => (long)v)   // Score: int → long
            .Build());
}
```

**Field operations:**

| Operation | Description |
|-----------|-------------|
| `KeepField(ordinal)` | Copy field value unchanged |
| `DropField(ordinal)` | Skip source field |
| `AddField<T>(ordinal, defaultValue)` | Add new field with default |
| `TransformField<TSrc,TDst>(ordinal, fn)` | Transform field type |

### 3.5  Migration Chains

Migrations are registered as single-step transforms (v1→v2, v2→v3). The `MigrationRegistry` automatically resolves multi-step chains. The chain must be contiguous and forward-only.

For full migration documentation, see [SchemaMigration.md](/docs/schema/schema-migration).

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
| `SCH1001` | Parser | Error | Expected token not found (type name, default value, body delimiter) |
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

```
// game.conjure — Full game schema example

// ═══════════════════════════════════
// Enums
// ═══════════════════════════════════

enum PlayerStatus { Active = 0, Banned = 1, Inactive = 2 }

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
    guild_id  : int?         @relation(references: Guild.id, onDelete: SetNull)
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
    @@index(fields: [guild_id, level], name: "Player_ByGuildLevel",
            kind: sorted_set, order: [asc, desc])
    @@index(fields: [guild_id, score], name: "Player_ByGuildScore",
            kind: sorted_set, order: [asc, desc])
}

table Item {
    id       : int    @id
    owner_id : int    @relation(references: Player.id, onDelete: Cascade)
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
    player_id : int          @relation(references: Player.id, onDelete: Cascade)
    data      : binary
    tags      : list<string>
    position  : Vector3
}

// ═══════════════════════════════════
// Fragments
// ═══════════════════════════════════

fragment high_level_players(min_level: int) =
    from Player
    | where level >= @min_level

fragment players_in_guild(gid: int) =
    from Player
    | where guild_id == @gid

// ═══════════════════════════════════
// Queries
// ═══════════════════════════════════

query ListGuilds() -> Guild[] =
    from Guild
    | sort title

query GetGuildById(id: int) -> Guild =
    from Guild
    | where id == @id
    | sort id
    | take 1
    | require found

query ListHighLevelPlayers(min_level: int) -> Player[] =
    @high_level_players(@min_level)
    | sort -score
    | take 100

query ListGuildPlayers(gid: int) -> Player[] =
    @players_in_guild(@gid)
    | sort -level
    | take 50

query ListPlayerNames(min_level: int) -> string[] =
    from Player
    | where level >= @min_level
    | sort name
    | select name

query PlayerTagBuckets() -> list<string>[] =
    from Player
    | select tags

query TopPlayersDto(min_level: int) -> PlayerDto[] =
    from Player
    | where level >= @min_level
    | sort -score
    | take 100
    | select { id, name, rank, level, score, guild_id } as PlayerDto

query GuildDtos() -> GuildDto[] =
    from Guild
    | sort title
    | select { id, title, rank } as GuildDto

query GuildViewsClr() -> GuildView[] =
    from Guild
    | sort title
    | select { id -> Id, title -> Title, rank -> Rank } as extern GuildView

// ═══════════════════════════════════
// Reactive Queries
// ═══════════════════════════════════

reactive query WatchTopPlayers(min_level: int) -> Player[] =
    from Player
    | where level >= @min_level
    | sort -score
    | take 10

// ═══════════════════════════════════
// Mutations
// ═══════════════════════════════════

mutation ResetGuildTitles() -> int =
    update Guild
    | set title = "reset"
    | require confirm_full_table

mutation BanPlayer(player_id: int) =
    update Player
    | where id == @player_id
    | set status = 1

mutation DeleteInactivePlayers() -> int =
    delete Player
    | where status == 2

mutation CreatePlayer(name: string, level: int) -> Player =
    insert Player
    | values { name = @name, level = @level, score = 0, status = 0 }

mutation PromotePlayers(min_level: int) -> int =
    update Player
    | where level >= @min_level
    | set rank = Rank.Elite
```

### 5.2  Multi-File Project

**`schema/core/types.conjure`:**

```
enum Rank : byte { Bronze = 0, Silver = 1, Gold = 2 }

type Currency {
    code   : string
    amount : decimal
}

extern type Vector3 = UnityEngine.Vector3
```

**`schema/entities/guild.conjure`:**

```
import "../core/types.conjure"

table Guild(persistence: local, capacity: 256) {
    id    : int    @id
    name  : string @unique
    rank  : Rank

    @@index(fields: [name], name: "Guild_ByName", kind: lookup)
}
```

**`schema/entities/player.conjure`:**

```
import "../core/types.conjure"
import "guild.conjure"

table Player(persistence: local, capacity: 16384) {
    id       : int    @id
    guild_id : int?   @relation(references: Guild.id, onDelete: SetNull)
    name     : string
    rank     : Rank
    balance  : Currency

    @@index(fields: [name],     name: "Player_ByName",  kind: lookup)
    @@index(fields: [guild_id], name: "Player_ByGuild", kind: lookup)
}

fragment active_players() =
    from Player
    | where rank != Rank.Bronze

query TopPlayers() -> Player[] =
    @active_players()
    | sort -rank
    | take 100
```

**Generate:**

```bash
dotnet run --project ConjureDB.Schema.Cli -- \
    ./schema ./Generated \
    --context=GameDbContext \
    --namespace=Game.Data
```

### 5.3  Complex Index Configurations

```
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
    @@index(fields: [event_type, timestamp],
            name: "Analytics_ByEventTime",
            kind: sorted_set,
            order: [asc, desc])

    // Aggregation index for sum/count queries
    @@index(fields: [event_type],
            name: "Analytics_EventAgg",
            kind: aggregation,
            value: value,
            aggregation_variant: sum_count)

    // Filtered index for active regions only
    @@index(fields: [region],
            name: "Analytics_ActiveRegion",
            kind: lookup,
            filter: "EventType > 0",
            filter_columns: [event_type])

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

### 5.4  Schema with All Type Variants

```
extern type CustomData = MyApp.Types.CustomData

enum Priority { Low = 0, Medium = 1, High = 2, Critical = 3 }

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
    is_active   : bool            = true
    weight      : float           = 1.0
    counter     : long            = 0

    @@index(fields: [priority], name: "Task_ByPriority", kind: sorted_set)
    @@index(fields: [is_active, priority], name: "Task_ActivePriority",
            kind: sorted_set, order: [asc, desc])
}
```

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

- **Start with lookup indexes** on fields used in `where` equality filters.
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
- **Keep query bodies concise** — use `=` expression bodies for single-pipeline queries.

### 6.4  Version Management

- **Always assign `type_id`** to persisted tables — auto-generated IDs can shift.
- **Increment `schema_version`** on every breaking change.
- **Never reuse `[Key]` ordinals** for fields with different types.
- **Prefer backward-compatible changes** — add nullable fields instead of changing types.
- **Register migration chains** contiguously (v1→v2, v2→v3 — no gaps).

---

## 7  Appendix: Grammar Summary

```ebnf
file            = { import | extern_type | enum | type | table | query
                  | reactive_decl | mutation | fragment } ;

import          = "import" STRING ;
extern_type     = "extern" "type" IDENT "=" qualified_name ;

enum            = "enum" IDENT [ ":" backing_type ] "{" enum_members "}" ;
enum_members    = enum_member { "," enum_member } [ "," ] ;
enum_member     = IDENT [ "=" [ "-" ] INT ] ;

type            = [ "struct" ] "type" IDENT "{" { type_field } "}" ;
type_field      = IDENT ":" type_ref ;

table           = [ "struct" ] "table" IDENT [ table_options ] "{" { field | table_ann } "}" ;
table_options   = "(" option { "," option } ")" ;
option          = ( "persistence" | "capacity" | "schema_version" | "type_id" | "plural" )
                  ":" value ;

field           = IDENT ":" type_ref { field_ann } [ "=" default_value ] ;
field_ann       = "@" ( "id" | "unique" | "default" "(" value ")"
                      | "index" [ "(" index_params ")" ]
                      | "relation" [ "(" relation_params ")" ] ) ;

table_ann       = "@@" ( "index" | "unique" ) "(" composite_params ")" ;

type_ref        = [ "extern" ] ( scalar_type | IDENT | "list" "<" type_ref ">" )
                  [ "?" ] [ "[]" ] ;

query           = "query" IDENT "(" params ")" "->" type_ref ( "=" body | "{" body "}" ) ;
reactive_decl   = "reactive" query ;
mutation        = "mutation" IDENT "(" params ")" [ "->" type_ref ]
                  ( "=" body | "{" body "}" ) ;
fragment        = "fragment" IDENT "(" params ")" ( "=" body | "{" body "}" ) ;

body            = source_clause { "|" pipeline_step } ;
source_clause   = "from" IDENT [ IDENT ]
                | ( "update" | "delete" | "insert" | "upsert" ) IDENT
                | "@" IDENT "(" args ")" ;

pipeline_step   = "where" expr | "filter" expr | "sort" sort_fields
                | "take" expr | "limit" expr | "skip" expr
                | "select" select_items | "distinct"
                | [ modifier ] "join" IDENT [ IDENT ] [ "on" expr ]
                | "group" expr | "set" expr | "values" "{" expr "}"
                | "assert" expr | "returning" expr
                | "require" ( "found" | "confirm_full_table" )
                | ( "union" | "intersect" | "except" ) expr ;
```

---

*For additional documentation see:*
- [Schema Language Reference](/docs/schema/schema-language)
- [Query Language Reference](/docs/query-language/reference)
- [Schema Migration Guide](/docs/schema/schema-migration)
- [Getting Started](/docs/getting-started)
- [Profile-Guided Optimization](/docs/performance/pgo)
- VSCode Extension README

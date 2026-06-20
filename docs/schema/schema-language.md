# ConjureDB Schema Language Reference

> Comprehensive reference for the ConjureDB Schema DSL (`.conjure` files).
> Version: current · Engine: ConjureDB · Build SDK: .NET 9.0.300 · Runtime targets: .NET 8 / .NET Standard 2.1

---

## 1  Overview

The ConjureDB Schema Language is the single public authoring contract for defining data models, indexes, queries, mutations, commands, and reusable fragments in `.conjure` files. The schema compiler generates both metadata and executable C# artifacts from that source of truth.

### 1.1  Schema-First Contract

| Aspect | Contract |
|--------|----------|
| Definition | All tables, views, materialized views, indexes, queries, mutations, commands, and extern functions live in `.conjure` files |
| Code generation | Generated entities, `DbContext`, repositories/modules, commands, indexes, and operation registration |
| Tooling | CLI, MSBuild `AdditionalFiles`, source generator, and LSP diagnostics consume the same schema pipeline |
| Source of truth | `.conjure`; generated C# is compiler output and must not be hand-edited |

### 1.2  Code Generation Pipeline

The schema compilation pipeline processes `.conjure` files in five deterministic stages:

```
 ┌──────────┐    ┌────────────────┐    ┌───────┐    ┌──────┐    ┌──────┐
 │  Parse   │ -> │ Resolve Imports│ -> │ Merge │ -> │ Bind │ -> │ Emit │
 └──────────┘    └────────────────┘    └───────┘    └──────┘    └──────┘
  SCH0xxx/1xxx     SCH3xxx               --         SCH2xxx     .g.cs files
```

1. **Parse** — each `.conjure` file is independently lexed and parsed into an AST.
2. **Resolve Imports** — import paths are validated and a deterministic dependency order is built (topological sort).
3. **Merge** — declarations from all files are merged into a single `SchemaFile`; duplicate names produce errors.
4. **Bind** — name resolution, type checking, FK/relation validation, index validation, fragment expansion.
5. **Emit** — metadata C# generation for entities, enums, custom types, repository interfaces, mutation interfaces, and `DbContext`.

Errors at any stage abort the pipeline with structured diagnostics printed to stderr.

### 1.3  Generated Artifacts

| Schema Declaration | Generated File | C# Artifact |
|--------------------|----------------|-------------|
| `table Player` | `Player.g.cs` | `[MessagePackObject] public record Player` |
| `struct table Pos` | `Pos.g.cs` | `[MessagePackObject] public record struct Pos` |
| `view ActiveRows` | metadata only | Virtual reusable query source, no storage |
| `materialized view PlayerItemRow` | metadata + derived runtime state | In-memory derived relation, no persistence/type id/schema version |
| `enum Status` | `Status.g.cs` | `public enum Status` |
| `type PlayerDto` | `PlayerDto.g.cs` | `public record PlayerDto` |
| `struct type Vec2` | `Vec2.g.cs` | `public record struct Vec2` |
| `query GetX(…) -> Player[]` | `IPlayerQueries.cs` | `interface IPlayerQueries : IRepository<Player>` |
| `reactive query Watch(…) -> Player[]` | `IPlayerQueries.cs` | Method returns `ReactiveQuery<Player>` |
| `mutation Ban(…)` | `IPlayerMutations.cs` | `interface IPlayerMutations : IRepository<Player>` |
| *(all tables)* | `AppDbContext.g.cs` | metadata-only `partial class AppDbContext : DbContext` |

---

## 2  File Structure

### 2.1  File Format

Schema files use the `.conjure` extension. They are plain text, UTF-8 encoded. The parser is line-ending agnostic (LF, CRLF, CR all work).

### 2.2  Comments

Line comments start with `//` and extend to the end of the line:

```
// This is a comment
table Player {    // inline comment
  id : int  @id
}
```

Block comments are **not** supported.

### 2.3  Top-Level Declarations

A `.conjure` file may contain any number of the following top-level declarations, in any order:

```
import "path/to/other.conjure"
extern type Alias = Qualified.ClrName
enum EnumName { … }
type TypeName { … }
struct type TypeName { … }
module ModuleName { … }
fragment name(params…) = body
view ViewName { … } = pipeline
materialized view ViewName(options…) { … } = pipeline
```

**Modules** are an optional organizational unit for most declarations and the required identity boundary for commands. Tables, queries, mutations, reactive queries, enums, types, extern types, and fragments may appear either at the top level or inside modules. Commands must appear inside a module so their canonical identity is `Module.Command`. When modules are present, ConjureDB emits an `I{ModuleName}` interface that groups the declarations owned by that module.

### 2.4  Imports

Import other `.conjure` files to reference their declarations:

```
import "common.conjure"
import "../shared/types.conjure"
```

**Resolution rules:**
- Paths are resolved **relative to the importing file's directory**.
- Resolved paths are canonicalized to absolute normalized file identities.
- The import graph must be acyclic — cycles produce diagnostic `SCH3003`.
- An import target that is not part of the discovered schema file set produces `SCH3002`.

**Compilation order** is import-driven: dependencies are processed before importers.

```
schema/core/base.conjure
schema/shared/types.conjure   // import "../core/base.conjure"
schema/feature/main.conjure   // import "../shared/types.conjure"
```

Resulting compilation order: `base.conjure` → `types.conjure` → `main.conjure`.

### 2.5  Module Definitions

Modules group related tables, queries, mutations, commands, and reactive queries into a cohesive unit. Each module generates a C# interface (`I{ModuleName}`) that serves as the API surface for its operations.

#### Syntax

```
module <Name> {
    [enum | type | extern type | struct table | table | view | materialized view | query | reactive query | mutation | command | fragment]*
}
```

#### Scoping Rules

| Declaration       | Top-level? | Inside module? | Notes                                                     |
|-------------------|:----------:|:--------------:|-----------------------------------------------------------|
| `table`           |     ✅     |       ✅       | Core data; modules add generated interface grouping       |
| `view`            |     ✅     |       ✅       | Virtual reusable query source; no indexes or storage      |
| `materialized view` |  ✅     |       ✅       | Derived in-memory relation with `@@index`; no persistence |
| `query`           |     ✅     |       ✅       | Operations on data; modules surface them via `I{Module}`  |
| `reactive query`  |     ✅     |       ✅       | Same as `query`, with reactive return shapes              |
| `mutation`        |     ✅     |       ✅       | Same as `query`, for mutation contracts                   |
| `command`         |     ❌     |       ✅       | Deterministic operation contracts; module name forms identity |
| `enum`            |     ✅     |       ✅       | Shared infrastructure, may be global                      |
| `type`            |     ✅     |       ✅       | Shared projection types                                   |
| `extern type`     |     ✅     |       ✅       | CLR bridge types, inherently global                       |
| `fragment`        |     ✅     |       ✅       | Reusable query snippets                                   |

All declarations are **globally visible** regardless of where they are defined — modules are organizational, not namespaces.

#### Example

```text
// Global shared types
enum Rarity { Common = 0, Uncommon = 1, Rare = 2, Epic = 3, Legendary = 4 }
type PlayerDto { id: int, name: string, level: int }

module Core {
    table Player(persistence: local) {
        id    : int    @id
        name  : string
        level : int
        score : int
    }

    query TopPlayers(count: int) -> Player[] =
        from Player | sort -score | take @count

    mutation BanPlayer(player_id: int) =
        update Player | where id == @player_id | set status = 1
}

module LootGeneration {
    table LootItem {
        id          : int    @id
        name        : string
        rarity      : Rarity
        drop_weight : float
    }

    query RollLoot(seed: long) -> LootItem[] =
        from generate(64, @seed) g
        | join LootItem i on hash_index(g.Seed, 0L, 6) == i.Id
        | select i.*
}
```

#### Generated C#

Each module produces an interface when modules are used:

```csharp
// module Core → ICore
public interface ICore
{
    Player[] TopPlayers(int count);
    void BanPlayer(int playerId);
}

// module LootGeneration → ILootGeneration : IDpgQueryHost
// (IDpgQueryHost base when module contains virtual-source queries)
public interface ILootGeneration : IDpgQueryHost
{
    LootItem[] RollLoot(long seed);
}
```

After the emitted C# is added to a project that also runs `ConjureDB.CodeGen`, the executable `DbContext` exposes modules via a typed accessor:

```csharp
context.Module<ICore>().TopPlayers(10);
context.Module<ILootGeneration>().RollLoot(seed);
```

#### Interface Base Rules

| Module Content                              | Generated Base    |
|---------------------------------------------|-------------------|
| Has virtual-source queries (`from generate(…)`) | `IDpgQueryHost`   |
| Only table-sourced queries                  | No base (standalone) |
| Mixed                                       | `IDpgQueryHost`   |

#### Diagnostics

| Code    | Description                           |
|---------|---------------------------------------|
| SCH3001 | Duplicate module name                 |
| SCH3003 | Duplicate table name across modules   |
| SCH3004 | Duplicate enum/type across modules    |

---

## 3  Type System

### 3.1  Primitive Types

| Schema Type | C# Type | Description |
|-------------|---------|-------------|
| `int` | `int` | Signed 32-bit integer |
| `long` | `long` | Signed 64-bit integer |
| `float` | `float` | 32-bit IEEE 754 float |
| `double` | `double` | 64-bit IEEE 754 float |
| `decimal` | `decimal` | 128-bit decimal |
| `string` | `string` | UTF-16 string (reference type) |
| `bool` | `bool` | Boolean |
| `byte` | `byte` | Unsigned 8-bit integer |
| `short` | `short` | Signed 16-bit integer |
| `uint` | `uint` | Unsigned 32-bit integer |
| `ulong` | `ulong` | Unsigned 64-bit integer |
| `datetime` | `DateTime` | Date and time |
| `timespan` | `TimeSpan` | Time duration |
| `guid` | `Guid` | 128-bit GUID |
| `binary` | `byte[]` | Binary data (reference type) |
| `char` | `char` | Single Unicode character |
| `dateonly` | `DateOnly` | Date without time |
| `timeonly` | `TimeOnly` | Time without date |
| `datetimeoffset` | `DateTimeOffset` | Date/time with UTC offset |

### 3.2  Nullable Types

Append `?` to any type to make it nullable:

```
guild_id   : int?          // generates: int?
score      : float?        // generates: float?
name       : string        // string is already a reference type; no '?' needed for null
avatar     : binary?       // binary (byte[]) is already a reference type
```

For value types, `?` generates `Nullable<T>`. For reference types (`string`, `binary`), the `?` is accepted but does not change the generated CLR type since they are already nullable.

### 3.3  Array Types

Append `[]` to any type to generate a C# array:

```
scores     : int[]         // generates: int[]
tags       : string[]      // generates: string[]
points     : float[]       // generates: float[]
```

Generated fields are initialized with `System.Array.Empty<T>()` by default.

### 3.4  Collection Types — `list<T>`

Use `list<T>` for read-only list types:

```
tags       : list<string>    // generates: IReadOnlyList<string>
items      : list<int>       // generates: IReadOnlyList<int>
nested     : list<string>?   // generates: IReadOnlyList<string> (nullable ref type)
```

Generated fields are initialized with `System.Array.Empty<T>()` by default.

### 3.5  Enum Types

Reference an enum declaration by name as a field type:

```
enum PlayerStatus { Active = 0, Banned = 1, Inactive = 2 }

table Player {
  id     : int           @id
  status : PlayerStatus  // generates: PlayerStatus
}
```

Enum types can be used in table fields, type fields, query parameters, and return types.

### 3.6  Custom Type References

Fields can reference other `type` declarations by name:

```
type Address {
  city    : string
  country : string
}

table Player {
  id      : int      @id
  address : Address
}
```

### 3.7  Extern Types

Use `extern` as a type modifier for types defined in external C# code:

```
// In field declarations:
position : extern Vector3                     // generates: Vector3
position : extern Vector3?                    // generates: Vector3?
view     : extern Game.Contracts.PlayerView   // generates: Game.Contracts.PlayerView (qualified)
data     : extern MyNamespace.MyStruct[]      // generates: MyNamespace.MyStruct[]
```

Extern types pass through to generated code as-is without schema-level validation.

### 3.8  Extern Type Aliases

Register top-level aliases for frequently used external types:

```
extern type Vector3   = UnityEngine.Vector3
extern type GeoPoint  = Game.Contracts.GeoPoint
extern type GuildView = Game.Contracts.GuildView
```

**Syntax:** `extern type <Alias> = <Qualified.CLR.Name>`

After registration, the alias can be used directly in field types, query parameters, and return types:

```
table Player {
  id       : int       @id
  position : GeoPoint?
}

query GuildViewsClr() -> GuildView[] =
    from Guild
    | sort title
    | select { id -> Id, title -> Title } as extern GuildView
```

Duplicate alias names produce diagnostic `SCH2001`.

---

## 4  Enum Definitions

### 4.1  Syntax

```
enum <Name> [: <BackingType>] {
    <Member1> [= <Value>],
    <Member2> [= <Value>],
    …
}
```

### 4.2  Basic Enums

```
enum PlayerStatus { Active = 0, Banned = 1, Inactive = 2 }
```

Generated C#:

```csharp
namespace Generated;

public enum PlayerStatus
{
    Active = 0,
    Banned = 1,
    Inactive = 2,
}
```

### 4.3  Auto-Incrementing Values

Explicit values are optional. Members auto-increment from the previous value (starting at 0):

```
enum Direction { North, South, East, West }
// equivalent to: North = 0, South = 1, East = 2, West = 3
```

You can mix explicit and implicit values:

```
enum Priority { Low = 10, Medium, High }
// Low = 10, Medium = 11, High = 12
```

### 4.4  Negative Values

Enum members can have negative values:

```
enum Temperature { Freezing = -1, Cold = 0, Warm = 1, Hot = 2 }
```

### 4.5  Custom Backing Types

Specify a backing integer type after the name with a colon:

```
enum Rank : byte { Recruit = 0, Veteran = 1, Elite = 2, Officer = 3 }
```

| Backing Type | C# Type | Range |
|--------------|---------|-------|
| `byte` | `byte` | 0–255 |
| `sbyte` | `sbyte` | -128–127 |
| `short` / `int16` | `short` | -32768–32767 |
| `ushort` / `uint16` | `ushort` | 0–65535 |
| `int` / `int32` | `int` | *(default)* |
| `uint` / `uint32` | `uint` | 0–4294967295 |
| `long` / `int64` | `long` | Signed 64-bit |
| `ulong` / `uint64` | `ulong` | Unsigned 64-bit |

Generated C# includes the backing type in the enum declaration:

```csharp
public enum Rank : byte
{
    Recruit = 0,
    Veteran = 1,
    Elite = 2,
    Officer = 3,
}
```

### 4.6  Trailing Commas

Trailing commas are allowed and ignored:

```
enum Flags { A = 1, B = 2, C = 4, }
```

### 4.7  Diagnostics

| Code | Condition |
|------|-----------|
| `SCH2001` | Duplicate enum declaration name |
| `SCH2015` | Invalid backing type |
| `SCH1008` | Integer literal out of Int32 range |

---

## 5  Type Definitions

The `type` keyword defines plain data structures (DTOs, value objects) without table semantics (no indexes, no primary key, no persistence). They generate C# `record` or `record struct` types.

### 5.1  Syntax

```
[struct] type <Name> {
    <field_name> : <Type>
    …
}
```

### 5.2  Reference Types (record)

```
type PlayerDto {
    id       : int
    name     : string
    rank     : Rank
    level    : int
    score    : int
    guild_id : int?
}
```

Generated C#:

```csharp
namespace Generated;

public record PlayerDto
{
    public int Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public Rank Rank { get; set; }
    public int Level { get; set; }
    public int Score { get; set; }
    public int? GuildId { get; set; }
}
```

### 5.3  Value Types (record struct)

```
struct type Vec2 {
    x : float
    y : float
}
```

Generated C#:

```csharp
namespace Generated;

public record struct Vec2
{
    public float X { get; set; }
    public float Y { get; set; }
}
```

### 5.4  Restrictions

- Type fields **cannot** have annotations (`@id`, `@index`, `@relation`, etc.). Attempting to add annotations produces diagnostic `SCH1021`.
- Duplicate field names within a type produce diagnostic `SCH5005`.
- Field names follow the same `snake_case` → `PascalCase` conversion as table fields.

---

## 6  Table Definitions

### 6.1  Basic Syntax

```
table <Name> [(options…)] {
    <field_name> : <Type> [annotations…] [= default]
    …
    [@@table_annotations…]
}
```

Every non-struct table **must** have exactly one `@id` (primary key) field.

### 6.2  Table Options

Options are specified in parentheses after the table name, using `key: value` syntax, comma-separated:

```
table Inventory(persistence: local, capacity: 1024, schema_version: 2, type_id: 10) {
  …
}
```

| Option | Value | Description |
|--------|-------|-------------|
| `persistence` | `local` \| `remote` \| `none` | Persistence strategy. Maps to `PersistenceType.Local/Remote/None` in the generated table descriptor |
| `capacity` | integer literal | Initial hashtable capacity hint in the generated table descriptor |
| `schema_version` | integer literal | Schema version for migration tracking in the generated schema descriptor |
| `type_id` | integer literal | Stable persistence/runtime type discriminator (1-65535) in the generated schema descriptor |

All options are optional. Tables with no options omit the parentheses:

```
table Guild {
  id   : int    @id
  name : string
}
```

**Alternative option separator:** both `key: value` and `key = value` syntax are accepted for table options.

### 6.3  Struct Tables

Prefix `table` with `struct` to generate a C# `record struct` (value type):

```
struct table Position {
  id : int   @id
  x  : float
  y  : float
  z  : float
}
```

Generated C#:

```csharp
[MessagePackObject]
public record struct Position
{
    [Key(0)]
    public int Id { get; set; }

    [Key(1)]
    public float X { get; set; }

    [Key(2)]
    public float Y { get; set; }

    [Key(3)]
    public float Z { get; set; }
}
```

### 6.4  Generated Entity Example

Given:

```
table Player(persistence: local, capacity: 16384, schema_version: 1, type_id: 1) {
  id       : int          @id
  guild_id : int?         @relation(references: Guild.id, onDelete: SetNull)
  name     : string
  level    : int
  score    : int
  status   : PlayerStatus
  tags     : list<string>
  avatar   : binary?

  @@index(fields: [name],  name: "Player_ByName",  kind: lookup)
  @@index(fields: [level], name: "Player_ByLevel", kind: sorted_set)
}
```

Generated C#:

```csharp
using MessagePack;
using ConjureDB;

namespace Generated;

[MessagePackObject]
public record Player
{
    [Key(0)]
    public int Id { get; set; }

    [Key(1)]
    public int? GuildId { get; set; }

    [Key(2)]
    public string Name { get; set; } = string.Empty;

    [Key(3)]
    public int Level { get; set; }

    [Key(4)]
    public int Score { get; set; }

    [Key(5)]
    public PlayerStatus Status { get; set; }

    [Key(6)]
    public IReadOnlyList<string> Tags { get; set; } = System.Array.Empty<string>();

    [Key(7)]
    public byte[] Avatar { get; set; } = System.Array.Empty<byte>();
}
```

### 6.5  Views And Materialized Views

`view` and `materialized view` use the same table-like field body as `table`,
but their source query is always written after the declaration body with
`= <pipeline>`.

```text
view ActiveItemRow {
    owner_id : int
    item_id  : int
    name     : string
    quantity : int
    rarity   : int
} = from Item i
    | filter i.is_deleted == false
    | select {
        owner_id = i.owner_id,
        item_id = i.id,
        name = i.name,
        quantity = i.quantity,
        rarity = i.rarity
    }
```

A `view` is virtual: it stores no rows, has no indexes, and expands as a
named reusable pipeline source.

```text
materialized view PlayerItemRow(
    capacity: 50000,
    refresh: incremental,
    rewrite: explicit
) {
    owner_id : int
    item_id  : int
    name     : string
    quantity : int
    rarity   : int

    @@identity(fields: [item_id])
    @@index(fields: [owner_id, rarity desc, name asc],
             name: "PlayerItemRow_ByOwnerRarity",
             kind: grouped_sorted)
} = from Item i
    | filter i.is_deleted == false
    | select {
        owner_id = i.owner_id,
        item_id = i.id,
        name = i.name,
        quantity = i.quantity,
        rarity = i.rarity
    }
```

A `materialized view` is a derived in-memory relation maintained from
authoritative base tables or from another materialized relation through
Z-set deltas. It may declare table-level `@@identity`,
`@@index`, and `@@unique`. It never declares or emits persistence metadata:
`persistence`, `type_id`, `schema_version`, `storage`, and `warm_start` are
invalid. Field-level annotations and defaults are invalid in both virtual and
materialized views.

Options:

| Option | Values | v1 execution contract |
|--------|--------|-----------------------|
| `capacity` | integer literal | Capacity hint for runtime materialization |
| `refresh` | `incremental` \| `rebuild` \| `manual` | `incremental` is executable; `rebuild` and `manual` parse into metadata but fail executable binding |
| `rewrite` | `none` \| `explicit` \| `auto` | `explicit` optimizes direct `from MaterializedViewName`; `auto` makes the view an optimizer-visible candidate for proven equivalent query prefixes |

Queries read both virtual and materialized views as ordinary sources:

```text
query GetPlayerItems(player_id: int, max_count: int) -> PlayerItemRow[] =
    from PlayerItemRow
    | filter owner_id == @player_id
    | sort -rarity, name
    | take @max_count
```

For materialized views, the planner may choose a declared materialized index
when the query filter, sort, and limit match the index shape.

Reactive queries over tables or virtual views can create hidden compiler-owned
materialized views. Hidden reactive views have origin `ReactiveAutoView`,
internal visibility, no public DSL source name, and no persistence metadata.
They are visible to the optimizer, so an ordinary query with the same normalized
body can reuse the already maintained hidden relation/index. Explain output
prints the hidden origin, visibility, owner reactive query, and selected
materialized access.

Materialized view source support is intentionally capability-checked. The
executable matrix includes direct base-table pipelines with `filter`,
`derive`, `select`, single inner/left/semi/anti equijoins, `distinct`,
`union`, `union all`, `intersect`, `intersect all`, `except`, and
`except all` branch materialization, scalar and grouped
`count`/`sum`/`avg`/`min`/`max`, and
bounded `sort` + `take` TopK shapes. A materialized view may read a simple virtual view
source when that virtual view expands to a direct base-table
`filter* | select { ... }` pipeline. A materialized view may also read another
materialized view directly for `filter* | select { ... }`; the generated
context builds source materialized views before dependents and maintains
dependents from relation transition deltas. Unsupported composed shapes fail
with `SCH5027` when they are outside the Z-set materialized maintainer matrix.
The `SCH5027` message includes a structured reason descriptor with source
kind, unsupported operator, dependency path, and supported maintainer family so
tooling can report the exact unsupported boundary.
View and materialized-view fields are bound in a complete typed relation
catalog before projection validation, so references to later declarations are
validated the same way as references to earlier declarations.

### 6.6  Diagnostics

| Code | Condition |
|------|-----------|
| `SCH2001` | Duplicate table declaration name |
| `SCH2005` | Table has no primary key field |
| `SCH2006` | Table has more than one primary key field |
| `SCH2011` | Duplicate field name after PascalCase normalization |
| `SCH2014` | Duplicate `[Key]` ordinal |
| `SCH2020` | Field count exceeds maximum |
| `SCH5001` | Duplicate field name in table (pre-bind) |
| `SCH5002` | `@id` and `@relation` on the same field |
| `SCH5003` | Missing `@id` on non-struct table (warning) |
| `SCH5007` | `@@index` references non-existent field |
| `SCH2034` | Materialized view refresh mode is parsed but not executable by the in-memory materialized maintainer contract |
| `SCH2038` | View source projection is missing a declared field |
| `SCH2039` | View source projection produces an undeclared field |
| `SCH2040` | View source projection type is not assignable to the declared field |
| `SCH2041` | View dependency cycle |
| `SCH2042` | Semi/anti materialized view projection references the right source or is ambiguous |
| `SCH2043` | Mutation targets a `view` or `materialized view` |
| `SCH2044` | Left-join materialized view projects an unsupported right-source expression |
| `SCH5021` | Duplicate field name in a view declaration |
| `SCH5022` | Field-level annotations and defaults are not supported in views |
| `SCH5023` | Virtual view declares table-level annotations such as `@@index` or `@@identity` |
| `SCH5024` | Materialized view `@@index` references a missing field |
| `SCH5025` | Materialized view `@@identity` references a missing field |
| `SCH5026` | Materialized view declares an unsupported annotation |
| `SCH5027` | Materialized view source is outside the supported Z-set materialized maintainer matrix |
| `SCH5028` | Materialized view `@@index` uses an unsupported materialized runtime index kind |
| `SCH5029` | Materialized view index shape is invalid, such as an empty index field list or a `grouped_sorted` index without both key and sort fields |

---

## 7  Field Declarations

### 7.1  Syntax

```
<field_name> : <Type> [@annotation1] [@annotation2(…)] [= default_value]
```

### 7.2  Naming Convention

Field names use `snake_case` in the schema and are automatically converted to `PascalCase` in generated C# code:

| Schema | Generated C# |
|--------|-------------|
| `guild_id` | `GuildId` |
| `first_name` | `FirstName` |
| `id` | `Id` |

### 7.3  Default Values

Fields can have default values assigned with `=` after all annotations:

```
table Config {
  id      : int    @id
  name    : string = "default"
  count   : int    = 42
  enabled : bool   = true
  tags    : list<string> = []
}
```

**Supported default value forms:**

| Form | Example | Description |
|------|---------|-------------|
| Integer literal | `= 42` | Numeric default |
| String literal | `= "hello"` | String default |
| Identifier | `= true`, `= false`, `= Active` | Boolean or enum member |
| Empty collection | `= []` | Empty array/list default |

**Automatic defaults** — some types receive defaults even without explicit `= value`:

| Type | Auto-default |
|------|-------------|
| `string` | `string.Empty` |
| `binary` | `System.Array.Empty<byte>()` |
| `list<T>` | `System.Array.Empty<T>()` |
| `T[]` (arrays) | `System.Array.Empty<T>()` |

---

## 8  Field Annotations

Annotations use the `@` prefix and appear after the field type. Multiple annotations can be placed on the same field:

```
id       : int    @id
guild_id : int?   @relation(references: Guild.id, onDelete: SetNull)
level    : int    @index(kind: sorted_set, name: "Level_Sorted")
                  @index(kind: aggregation, name: "Level_Agg", value: level)
```

### 8.1  `@id` — Primary Key

Marks the field as the table's primary key. Every non-struct table must have **exactly one** `@id` field.

```
id : int @id
```

**Constraints:**
- Only one `@id` per table (diagnostic `SCH2006` if multiple).
- Cannot coexist with `@relation` on the same field (diagnostic `SCH5002`).

### 8.2  `@unique` — Uniqueness Constraint

Marks the field as having a unique constraint:

```
email : string @unique
```

### 8.3  `@default(value)` — Default Value (annotation form)

Alternative to the `= value` suffix syntax for specifying default values:

```
score : int @default(0)
name  : string @default("unknown")
tags  : list<string> @default([])
```

### 8.4  `@index(…)` — Index Declaration

Declares an index on the field.

**Syntax:**

```
@index(name: "IndexName", kind: <index_type> [, option: value, …])
```

**Minimal form** (no parameters, defaults to lookup):

```
name : string @index
```

When `kind` is omitted, the default index type is `lookup`.

**Index types:**

| Kind | C# `IndexType` | Description |
|------|----------------|-------------|
| `lookup` | `Lookup` | Hash-based O(1) exact-match lookup |
| `sorted_set` | `SortedSet` | Sorted set for range queries and ordered iteration |
| `sorted_list` | `SortedList` | Sorted list index |
| `unique` | `Unique` | Unique constraint index |
| `aggregation` | `Aggregation` | Aggregation index (sum, count, average, etc.) |
| `universal_aggregation` | `UniversalAggregation` | Universal aggregation index |
| `range_lookup` | `RangeLookup` | Range-based lookup |
| `grouped_sorted` | `GroupedSorted` | Grouped and sorted index |

**Index options:**

| Option | Value Type | Applicable Index Types | Description |
|--------|------------|----------------------|-------------|
| `name` | `"string"` | All | Index name (used by the generated index structure). Defaults to field PascalCase name |
| `kind` | identifier | All | Index type (see table above). Defaults to `lookup` |
| `value` | field name | `aggregation`, `universal_aggregation` | Value property for aggregation computation |
| `keys` | `[field1, field2]` | All | Additional composite key fields |
| `range` | field name | `range_lookup` | Range property |
| `included` | `[field1, field2]` | All | Included (covering) columns for index-only scans |
| `filter` | `"predicate"` | All | Filter predicate string for partial/filtered indexes |
| `filter_columns` | `[field1, field2]` | All | Columns referenced in the filter predicate |
| `encoding` | identifier | All | Key encoding strategy. Emitted as `IndexKeyEncoding.<value>` |
| `aggregation_variant` | `all_stats` \| `sum_count` \| `count_only` | `aggregation`, `universal_aggregation` | Controls which aggregate statistics are maintained |
| `is_pgo_recommended` | `true` \| `false` | All | Marks this index as recommended by Profile-Guided Optimization |

**Examples:**

```
// Simple lookup index
name : string @index(kind: lookup, name: "Name_Lookup")

// Sorted set index
level : int @index(kind: sorted_set, name: "Level_Sorted")

// Aggregation index with value property and variant
level : int @index(kind: aggregation, name: "Level_Agg",
                   value: level, aggregation_variant: count_only)

// Index with filter predicate
score : int @index(kind: sorted_set, name: "ActiveScore",
                   filter: "Status == 0", filter_columns: [status])

// Index with included columns for covering queries
name : string @index(kind: lookup, name: "Name_Cover",
                     included: [level, score])

// PGO-recommended index
score : int @index(kind: sorted_set, name: "Score_Idx",
                   is_pgo_recommended: true)

// Multiple indexes on the same field
level : int @index(kind: sorted_set, name: "Level_Sorted")
            @index(kind: aggregation, name: "Level_Agg", value: level)
```

**Diagnostics:**

| Code | Condition |
|------|-----------|
| `SCH2007` | Unknown index type |
| `SCH2016` | Invalid `aggregation_variant` value |
| `SCH2017` | `aggregation_variant` used on non-aggregation index |
| `SCH1004` | Invalid index kind |
| `SCH1006` | Invalid index option |

### 8.5  `@relation(…)` — Foreign Key / Relation

Declares a foreign key relationship to another table.

**Syntax:**

```
@relation(
    references: <Entity>[.<field>],
    [name: "RelationName",]
    [fields: <field> | [field1, field2],]
    [onDelete: <Action>,]
    [onUpdate: <Action>]
)
```

**Parameters:**

| Parameter | Required | Description |
|-----------|----------|-------------|
| `references` | Yes | Target entity, optionally with `.field` (e.g., `Guild.id`) |
| `name` | No | Explicit relation name |
| `fields` | No | Source field(s) for the relation. Single field or bracket list |
| `onDelete` | No | Referential action on delete |
| `onUpdate` | No | Referential action on update |

**Referential actions:**

| Action | C# Enum | Description |
|--------|---------|-------------|
| `Cascade` | `ReferentialAction.Cascade` | Delete/update related records |
| `SetNull` | `ReferentialAction.SetNull` | Set foreign key to NULL |
| `Restrict` | `ReferentialAction.Restrict` | Prevent the operation |
| `NoAction` | `ReferentialAction.NoAction` | No action (database default) |
| `SetDefault` | `ReferentialAction.SetDefault` | Set foreign key to default value |

**Examples:**

```
// Simple FK referencing Guild.id, set null on delete
guild_id  : int? @relation(references: Guild.id, onDelete: SetNull)

// Cascading delete
owner_id  : int  @relation(references: Player.id, onDelete: Cascade)

// With explicit relation name and both actions
player_id : int  @relation(
    name: "FK_Inventory_Player",
    references: Player.id,
    onDelete: Cascade,
    onUpdate: NoAction
)

// Multi-field relation
owner_id : int  @relation(references: Player.id, onDelete: Cascade)

Keep `@relation(...)` declarations single-field. Composite `fields: [...]` lists are not part of the current bound relation contract.
```

**Generated C#:**

The `@relation` annotation records the foreign-key relationship as compiler metadata (used for bounds inference and join planning); it is not emitted as a C# attribute. The generated entity field carries only its MessagePack `[Key]`:

```csharp
[Key(1)]
public int? GuildId { get; set; }
```

**Diagnostics:**

| Code | Condition |
|------|-----------|
| `SCH2003` | Foreign key references non-existent table |
| `SCH5002` | `@id` and `@relation` on same field |

---

## 9  Table Annotations

Table-level annotations use the `@@` prefix and appear inside the table body, after all field declarations.

### 9.1  `@@index(…)` — Composite Index

Declares a multi-field composite index at the table level.

**Syntax:**

```
@@index(
    fields: [field1 [asc|desc], field2 [asc|desc], …],
    name: "IndexName",
    [kind: <index_type>,]
    [order: [asc|desc, asc|desc, …],]
    [<index_option>: <value>, …]
)
```

**Parameters:**

| Parameter | Required | Description |
|-----------|----------|-------------|
| `fields` | Yes | Bracket list of field names. Each field may have an inline `asc`/`desc` modifier |
| `name` | No | Index name for generated `schema index` or `[CompositeIndex]` attribute |
| `kind` | No | Index type (same values as `@index`). Defaults to `lookup` |
| `order` | No | Sort direction list applied positionally to fields: `[asc, desc, asc]` |

All index options from `@index` are also valid here (`value`, `keys`, `range`, `included`, `filter`, `filter_columns`, `encoding`, `aggregation_variant`, `is_pgo_recommended`).

**Sort directions** can be specified in two ways:

1. **Inline with field name:** `fields: [level desc, score asc]`
2. **Separate order list:** `order: [desc, asc]` (applied positionally to fields)

If both are specified, the inline direction takes precedence.

**Examples:**

```
table Player {
  id       : int @id
  guild_id : int?
  level    : int
  score    : int
  name     : string

  // Simple composite index
  @@index(fields: [guild_id, level], name: "Player_ByGuildLevel", kind: sorted_set)

  // With sort directions
  @@index(fields: [guild_id, score], name: "Player_ByGuildScore",
          kind: sorted_set, order: [asc, desc])

  // Inline sort directions
  @@index(fields: [level desc, score asc], name: "Player_ByLevelScore",
          kind: sorted_set)

  // Lookup index
  @@index(fields: [name], name: "Player_ByName", kind: lookup)

  // With PGO flag
  @@index(fields: [score], name: "Player_ByScore",
          kind: sorted_set, is_pgo_recommended: true)
}
```

**Single-field `@@index`:** When `@@index` has exactly one field, it is emitted as a regular `schema index` attribute on that field (same as `@index`). Multi-field `@@index` generates a `[CompositeIndex]` attribute on the table.

**Generated C# for composite indexes:**

```csharp
// Multi-field @@index:
[CompositeIndex("Player_ByGuildLevel", Fields = new[] { "GuildId", "Level" }, Kind = IndexType.SortedSet)]
```

### 9.2  `@@unique(…)` — Composite Unique Constraint

Shorthand for `@@index(…)` with forced `kind: unique`:

```
@@unique(fields: [email, region])
```

Equivalent to:

```
@@index(fields: [email, region], kind: unique)
```

### 9.3  `@@navigation(…)` — Parent-Side Child Collection Navigation

Declares an explicit parent-side child collection navigation for Option 2 schema-first generation. The annotation is **metadata only**: ConjureDB emits a declarative property on the parent entity, while runtime traversal and mutation stay explicit on generated editors and `ChildCollectionHandle` APIs. No lazy loading or entity-backed live collection is introduced.

**Syntax:**

```text
@@navigation(
    name: "Orders",
    references: Order.customer_id
)
```

**Parameters:**

| Parameter | Required | Description |
|-----------|----------|-------------|
| `name` | Yes | Generated parent-side navigation property name |
| `references` | Yes | Child entity and child FK field in `Child.field` form |

**Example:**

```text
table Customer {
  id: int @id

  @@navigation(name: "Orders", references: Order.customer_id)
}

table Order {
  id: int @id
  customer_id: int @relation(references: Customer.id)
}
```

**Generates** a child-collection navigation accessor on the parent entity, reachable through the generated `CollectionHandle` API and backed by a lookup index on the child's foreign-key field.

**Validation rules:**

- `name` must be a non-empty C#-compatible identifier.
- `references` must use explicit `Child.field` syntax.
- The referenced child entity must exist.
- The referenced child FK field must exist on the child entity.
- A parent table may declare a given child/FK pair only once.

**Diagnostics:**

| Code | Condition |
|------|-----------|
| `SCH5015` | Missing or invalid `name` parameter |
| `SCH5016` | `references` is missing or not in `Child.field` form |
| `SCH5017` | Navigation name conflicts with another emitted member |
| `SCH5020` | Duplicate `@@navigation` for the same child/FK pair |
| `SCH2030` | Referenced child entity does not exist |
| `SCH2031` | Referenced child FK field does not exist |

---

## 10  Query Definitions

### 10.1  Syntax

```
query <Name>(<param1>: <type>, …) -> <ReturnType> = <body>
```

Optional query planning metadata may appear after the return type and before
the body:

```
query <Name>(<params>) -> <ReturnType>
@planning(no_optimize: true, set_op_key_max_values: [9, 4])
= <body>
```

or with brace body (legacy, still supported):

```
query <Name>(<param1>: <type>, …) -> <ReturnType> {
    <body>
}
```

### 10.2  Parameters

Parameters use `name: type` syntax, comma-separated. Parameters are referenced in the body with `@param_name`:

```
query GetTopPlayers(min_level: int, max_count: int) -> Player[] =
    from Player
    | where level >= @min_level
    | sort -score
    | take @max_count
```

Parameter types support the full type system: primitives, enums, extern types, nullable types, arrays, and lists.

### 10.3  Return Types

| Return Type | Generated C# | Description |
|-------------|-------------|-------------|
| `Player` | `Player` | Single entity |
| `Player[]` | `Player[]` | Array of entities |
| `string[]` | `string[]` | Array of scalars |
| `int` | `int` | Single scalar |
| `list<string>[]` | `IReadOnlyList<string>[]` | Array of lists |
| `PlayerDto[]` | `PlayerDto[]` | Array of custom types |
| `extern Game.Views.PV[]` | `Game.Views.PV[]` | Array of extern types |

### 10.4  Planning Hints

`@planning(...)` is a typed schema-owned carrier for bounded workload facts that
must reach the compiler planning profile. Use it for benchmark/proof schemas
where the query source already knows closed-world domain limits. Do not encode
planner flags in method names.

Supported options:

| Option | Type | Description |
|--------|------|-------------|
| `no_optimize` | `bool` | Disable optimizer/PGO strategy selection for explicit A/B comparison queries |
| `max_key_value` / `min_key_value` | `int` | Dense key bounds for scalar-key planning |
| `max_group_key_value` | `int` | Dense group-key bound |
| `expected_result_count` | `int` | Trusted positive expected output row count for bounded planning and preallocation |
| `max_result_count` | `int` | Trusted positive maximum output row count for bounded TopK/result-capacity planning |
| `set_op_key_max_values` / `set_op_key_min_values` | `int[]` | Per-component set-op comparison-key bounds |
| `set_op_right_distinct_count` | `int` | Right-side distinct key count for set-op early-exit tuning |
| `aggregate_group_key_max_values` / `aggregate_group_key_min_values` | `int[]` | Per-component grouped-aggregate key bounds |
| `aggregate_group_key_string_value_sets` | `string[]` | Per-component grouped-aggregate string domains, encoded as pipe-separated values |
| `aggregate_distinct_value_max_values` / `aggregate_distinct_value_min_values` | `int[]` | Per-aggregate `count(distinct ...)` value bounds |
| `aggregate_distinct_value_string_value_sets` | `string[]` | Per-aggregate distinct string domains, encoded as pipe-separated values |

Example:

```text
query GetTopStatusBuckets(limit: int) -> StatusBucketView[]
@planning(
    aggregate_group_key_string_value_sets: ["Pending|Completed|Cancelled"],
    aggregate_distinct_value_max_values: [99]
) {
    from Order o
    | group o.Status (aggregate { DistinctPlayers = count(distinct o.PlayerId) })
    | sort -DistinctPlayers
    | take @limit
}
```

### 10.5  Query Body — Pipeline Operators

The query body uses the ConjureDB DSL pipeline syntax. It starts with a **source clause** followed by zero or more **pipeline steps** separated by `|`:

```
from <Entity> [<alias>]
| <step1>
| <step2>
| …
```

**Source clauses:**

| Source | Syntax | Description |
|--------|--------|-------------|
| Table scan | `from <Entity>` | Read all rows from the entity |
| Table scan with alias | `from <Entity> <alias>` | Aliased table scan |
| Virtual view | `from <ViewName>` | Expand a reusable logical view source |
| Materialized view | `from <MaterializedViewName>` | Read maintained in-memory relation/index state |
| Fragment invocation | `@fragment_name(args)` | Expands the fragment body |

**Pipeline steps:**

| Step | Syntax | Description |
|------|--------|-------------|
| `where` / `filter` | `\| where <predicate>` | Filter rows by predicate. `where` is auto-substituted to `filter` for compiler compatibility |
| `sort` | `\| sort [-]field1 [, [-]field2]` | Sort results. Prefix `-` for descending |
| `take` / `limit` | `\| take <n>` | Limit result count |
| `skip` | `\| skip <n>` | Skip first N results |
| `select` | `\| select field1, field2` | Project specific fields |
| `select … as` | `\| select { f1, f2 } as TypeName` | Project into a named DTO |
| `select … as extern` | `\| select { … } as extern ExternalType` | Project into an extern CLR type |
| `join` | `\| join <Entity> [<alias>] [on <expr>]` | Inner join |
| `left join` | `\| left join <Entity> [<alias>] on <expr>` | Left outer join |
| `right join` | `\| right join <Entity> on <expr>` | Right outer join |
| `full join` | `\| full join <Entity> on <expr>` | Full outer join |
| `semi join` | `\| semi join <Entity> on <expr>` | Semi join |
| `anti join` | `\| anti join <Entity> on <expr>` | Anti join |
| `distinct` | `\| distinct` | Remove duplicate rows |
| `group` | `\| group <expr>` | Group by expression |
| `require found` | `\| require found` | Assert at least one result |
| `require confirm_full_table` | `\| require confirm_full_table` | Confirm full table scan intent |
| `union` | `\| union <expr>` | Set union |
| `intersect` | `\| intersect <expr>` | Set intersection |
| `except` | `\| except <expr>` | Set difference |

### 10.6  Reactive Queries

Prefix `query` with `reactive` to generate a `ReactiveQuery<T>` return type instead of a static array:

```
reactive query WatchTopPlayers(min_level: int) -> Player[] =
    from Player
    | where level >= @min_level
    | sort -score
    | take 10
```

Generated C#:

```csharp
ReactiveQuery<Player> WatchTopPlayers(int minLevel);
```

### 10.7  Generated Query Interface

Queries are grouped by their source entity (`from <Table>`) into repository interfaces:

```csharp
using ConjureDB;

namespace Generated;

public interface IPlayerQueries : IRepository<Player>
{
    Player[] GetTopPlayers(int minLevel);

    Player FindPlayer(string name);
}
```

### 10.7  Diagnostics

| Code | Condition |
|------|-----------|
| `SCH2018` | Query body must start with `from <TableName>` after fragment expansion |
| `SCH2018` | Query source table not declared |
| `SCH1007` | Empty query body |

---

## 11  Mutation Definitions

### 11.1  Syntax

```
mutation <Name>(<params…>) [-> <ReturnType>] = <body>
```

or with brace body:

```
mutation <Name>(<params…>) [-> <ReturnType>] {
    <body>
}
```

### 11.2  Mutation Verbs

The mutation body starts with a verb instead of `from`:

| Verb | Syntax | Description |
|------|--------|-------------|
| `update` | `update <Entity>` | Update existing records |
| `delete` | `delete <Entity>` | Delete records |
| `insert` | `insert <Entity>` | Insert new records |
| `upsert` | `upsert <Entity>` | Insert or update records |

### 11.3  Mutation-Specific Pipeline Steps

| Step | Syntax | Applicable Verbs | Description |
|------|--------|-------------------|-------------|
| `set` | `\| set field = value` | `update` | Set field values |
| `values` | `\| values { field1 = value, … }` | `insert`, `upsert` | Specify field values for insertion |
| `assert` | `\| assert <expr>` | All | Assert a condition |
| `returning` | `\| returning <expr>` | All | Return specific fields |
| `require confirm_full_table` | `\| require confirm_full_table` | `update`, `delete` | Confirm full-table operation intent |

### 11.4  Return Types

| Declaration | Return Type | Description |
|-------------|-------------|-------------|
| `mutation Ban(…)` | `void` | No return value |
| `mutation Ban(…) -> int` | `int` | Affected row count |
| `mutation Create(…) -> Player` | `Player` | Single entity |
| `mutation Batch(…) -> Player[]` | `Player[]` | Array of entities |
| `command Buy(…) -> Result` | `CommandResult<Result, BuyErrorCode>` plus command handler metadata | Deterministic command contract |

### 11.5  Examples

```
// Void mutation (no return type)
mutation BanPlayer(player_id: int) =
    update Player
    | where id == @player_id
    | set status = 1

// Returns affected row count
mutation DeleteInactivePlayers() -> int =
    delete Player
    | where status == 2

// Returns created entity
mutation CreatePlayer(name: string, level: int) -> Player =
    insert Player
    | values { name = @name, level = @level, score = 0, status = 0 }

// Full-table update with safety guard
mutation ResetGuildTitles() -> int =
    update Guild
    | set title = "reset"
    | require confirm_full_table

// Upsert
mutation UpsertPlayer(name: string) -> Player =
    upsert Player
    | values { name = @name }
```

### 11.6  Generated Mutation Interface

Mutations are grouped by their target entity into mutation interfaces:

```csharp
using ConjureDB;

namespace Generated;

public interface IPlayerMutations : IRepository<Player>
{
    void BanPlayer(int playerId);

    int DeleteInactivePlayers();

    Player CreatePlayer(string name, int level);
}
```

---

## 12  Command Definitions

Commands describe validated game/backend operations at the schema layer. They are emitted as typed command request/result models, deterministic handlers, error-code manifests, operation metadata, and context registration code. Commands are for operation contracts; table queries and simple CRUD-style mutations should remain `query`/`mutation` declarations.

### 12.1  Syntax

```
command <Name>(<params…>) [-> <ResultType>]
kind <local | local_or_online | online_player | admin | server_job | internal>
[auth <policy-or-none>]
[idempotent by <param> [optional]]
[scope <scope-name>(<param>, …) [optional] | none]
{
    <statement>*
}
```

`kind` defaults to `local` when omitted by the emitted metadata path. `auth`, `idempotent`, and `scope` are metadata clauses; parameter references inside them must name command parameters exactly.

Commands must be declared inside `module` blocks. A module may import command namespaces for short-name resolution:

```
module Shop {
    using Economy
    using Game.Inventory as Inv
}
```

### 12.2  Body Statements

| Statement | Syntax | Description |
|-----------|--------|-------------|
| Variable | `var name = <expression>` | Binds a pure value, command invocation, or query pipeline. Names share scope with parameters and prior variables. |
| Require | `require <condition> else ErrorName [{ field: expression, … }]` | Fails the command with a typed error code and optional payload when the condition is false. |
| Write | `update` / `upsert` / `insert` / `delete` pipeline statement | Performs one explicit single-row state transition. Writes are not valid behind `var`. |
| Event | `event EventName { field: expression, … }` | Adds an emitted event effect and validates payload expressions. |
| Return | `return { field: expression, … }` | Returns an object payload matching the declared result type. |

Command expressions may reference parameters, prior variables, object members, and deterministic context paths. Supported context paths are `ctx.now`, `ctx.tick`, `ctx.contentVersion`, `ctx.seasonId`, `ctx.random.next_int`, and `ctx.random.next_uint64`.

Object-like command payloads use `field: expression` syntax. `set` remains assignment-oriented and supports compound assignments such as `Amount += quantity`.

Writes are command statements, not `var` pipelines. Upsert binds the inserted-or-updated row through `returning ... into <name>`:

```text
upsert InventorySlot
| key { PlayerId: playerId, ItemId: itemId }
| set Amount += quantity
| returning { amountAfter: Amount } into inventoryAfter
```

### 12.3  Command Pipelines

A command variable can bind a constrained read pipeline:

```
var wallet =
    from Wallet
    | filter PlayerId == playerId
    | single else WalletMissing { playerId: playerId }
```

Single-row write statements use explicit keys or values instead of filters:

```text
update Wallet
| key { Id: wallet.Id } else WalletMissing { playerId: playerId }
| require Balance >= cost else InsufficientFunds { balance: Balance, cost: cost }
| set Balance -= cost, Version += 1
| returning { balanceAfter: Balance, version: Version } into walletAfter

upsert InventorySlot
| key { PlayerId: playerId, ItemId: itemId }
| set Amount += quantity
| returning { amountAfter: Amount } into inventoryAfter

insert Receipt
| values { Id: receiptId, PlayerId: playerId, ReceiptKey: receiptKey, Amount: amount }
| conflict else DuplicateReceipt { receiptKey: receiptKey }
| returning { receiptId: Id, amount: Amount } into receiptAfter

delete Receipt
| key { Id: receiptId } else ReceiptMissing { receiptId: receiptId }
| returning { receiptKey: ReceiptKey } into deletedReceipt
```

Supported query pipeline operators are `filter`, `select`, and the terminal operators `single`, `single_or_default`, `first`, `first_or_default`, `any`, `count`, and `to_list`. Terminals must use lower-case PRQL-style spelling and every command read pipeline must end with one explicit terminal.

Supported write statement forms are:

| Operation | Required clauses | Optional clauses | Notes |
|-----------|------------------|------------------|-------|
| `update` | `key ... else`, `set` | `require ... else`, `returning ... into` | Missing row is a typed error from the key clause. |
| `upsert` | `key`, `set` | `returning ... into` | Insert-or-update by primary key or declared unique index. |
| `insert` | `values` | `conflict else`, `returning ... into` | Required fields must be supplied unless schema proves a generated/default value. |
| `delete` | `key ... else` | `require ... else`, `returning ... into` | `returning` projects the pre-delete row. |

Command write statements reject `filter`, reject terminals such as `single`, reject `returning` without `into`, and never generate a full-scan fallback. `key` must resolve to the table primary key or a named unique index.

### 12.4  Subcommands

Commands can call other schema commands directly:

```
var debit = SpendGold(playerId: playerId, amount: cost)
```

Calls resolve by short name in the current module, then imported `using` modules, then by fully-qualified canonical identity. Alias-qualified calls such as `Inv.GrantItem(...)` resolve through `using Game.Inventory as Inv`. Ambiguous imported short names are hard binding errors. Arguments may be positional or named, but a single call cannot mix both forms. Command call graphs must be acyclic.

### 12.5  Generated Command Artifacts

For each command, schema emission produces deterministic C# artifacts in generated files:

| Artifact | Purpose |
|----------|---------|
| Request record | Typed command input with PascalCase properties for parameters. |
| Result record / `CommandResult` shape | Typed success payload, error code, and command-result carrier. |
| Error enum | `None` plus errors declared by `require`, pipeline `else`, and invoked subcommands. |
| Handler class | Deterministic command execution over the generated context/editor APIs; `internal` commands emit executors and metadata but are not externally registered as handlers. |
| Metadata class | Canonical identity, `CommandKind`, authorization, idempotency, scope descriptors, and effect manifest. |
| Context registration partial | Registers external handlers and all command metadata in deterministic canonical-identity order. |

Generated command code is output of the schema compiler. Do not edit generated command files manually; change the `.conjure` command declaration or the schema emitter, then regenerate.

### 12.6  Example

```text
module Shop {
    table Wallet {
        id: int @id
        playerId: int
        balance: long
        version: int

        @@unique(fields: [playerId], name: "Wallet_ByPlayer")
    }

    table InventorySlot {
        id: int @id
        playerId: int
        itemId: int
        amount: int

        @@unique(fields: [playerId, itemId], name: "InventorySlot_ByPlayerItem")
    }

    type PurchaseResult {
        balanceAfter: long
        version: int
        inventoryAmount: int
    }

    command BuyItem(playerId: int, itemId: int, quantity: int, requestId: guid, cost: long) -> PurchaseResult
    kind local_or_online
    idempotent by requestId optional
    scope player(playerId) optional
    {
        update Wallet
        | key { PlayerId: playerId } else WalletMissing { playerId: playerId }
        | require Balance >= cost else InsufficientFunds {
            balance: Balance,
            cost: cost
        }
        | set Balance -= cost,
              Version += 1
        | returning { balanceAfter: Balance, version: Version } into walletAfter

        upsert InventorySlot
        | key { PlayerId: playerId, ItemId: itemId }
        | set Amount += quantity
        | returning { amountAfter: Amount } into inventoryAfter

        event ItemPurchased {
            playerId: playerId,
            cost: cost,
            itemId: itemId,
            quantity: quantity,
            balanceAfter: walletAfter.BalanceAfter
        }

        return {
            balanceAfter: walletAfter.BalanceAfter,
            version: walletAfter.Version,
            inventoryAmount: inventoryAfter.AmountAfter
        }
    }
}
```

### 12.7  Diagnostics

Command binding diagnostics are documented in [Error Codes](/docs/reference/error-codes#binding-errors-sch2xxx), including `SCH2110` through `SCH2149`.

---

## 13  Fragment Definitions

### 13.1  Syntax

```
fragment <name>(<params…>) = <body>
```

or with brace body:

```
fragment <name>(<params…>) {
    <body>
}
```

### 13.2  Defining Fragments

Fragments define reusable pipeline snippets. They must start with a source clause (`from <Entity>`):

```
fragment high_level_players(min_level: int) =
    from Player
    | where level >= @min_level

fragment players_in_guild(gid: int) =
    from Player
    | where guild_id == @gid

fragment all_players() =
    from Player
```

### 13.3  Invoking Fragments

Invoke fragments with `@fragment_name(args)` at the beginning of a query or mutation body:

```
query ListHighLevelPlayers(min_level: int) -> Player[] =
    @high_level_players(@min_level)
    | sort -score
    | take 100

query ListGuildPlayers(gid: int) -> Player[] =
    @players_in_guild(@gid)
    | sort -level
    | take 50
```

Fragment parameters are substituted textually — `@min_level` in the fragment body is replaced with the argument from the call site.

### 13.4  Zero-Parameter Fragments

Fragments with no parameters use empty parentheses:

```
fragment all_guilds() =
    from Guild

query ListGuilds() -> Guild[] =
    @all_guilds()
    | sort title
```

### 13.5  Fragment Cycle Detection

Fragment references must be acyclic. If fragment A references fragment B and fragment B references fragment A, the validator reports an error. Detection happens during the pre-bind semantic validation phase, using graph traversal over `@Name(` patterns in fragment bodies (skipping string literals and comments).

**Diagnostics:**

| Code | Condition |
|------|-----------|
| `SCH2001` | Duplicate fragment declaration name |

---

## 14  Import System

### 14.1  File Imports

```
import "path/to/file.conjure"
```

Import paths are always relative to the directory of the file containing the `import` statement. Absolute paths are not supported.

### 14.2  Module Resolution

When the schema CLI scans a directory, it discovers all `*.conjure` files recursively. The import graph determines compilation order:

1. Files with no imports are compiled first.
2. Files that import other files are compiled after their dependencies.
3. All declarations from all files are merged into a single schema.
4. Duplicate declaration names across files produce errors.

### 14.3  Circular Import Handling

Circular imports are detected and rejected:

```
// a.conjure
import "b.conjure"

// b.conjure
import "a.conjure"   // ← SCH3003: Import cycle detected
```

### 14.4  Import Diagnostics

| Code | Condition |
|------|-----------|
| `SCH3002` | Import target file not found in the schema file set |
| `SCH3003` | Import cycle detected |
| `SCH3004` | Duplicate canonical file identity (two files normalize to the same path) |

---

*For CLI, LSP, migration tools, diagnostics, examples, and best practices, see [Schema Tooling](/docs/schema/schema-tooling).*

*For additional documentation see:*
- [Query Language Reference](/docs/query-language/reference)
- [Schema Migration Guide](/docs/schema/schema-migration)
- [Getting Started](/docs/getting-started)
- [Profile-Guided Optimization](/docs/performance/pgo)
- VSCode Extension README

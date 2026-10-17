# ConjureDB Schema Language Reference

A `.conjure` file declares data shapes and operations. The schema is the authoring
source; generated C# is output, not a second place to define the model.

This reference describes supported declarations. See [Data Types](/docs/query-language/data-types)
for value and result types, [Query Language](/docs/query-language/reference) for pipelines, and
[Schema Workflow](/docs/schema/schema-workflow) for project configuration and generation.

## 1  Overview

A minimal runtime-local schema is:

```conjure
table Player(persistence: none) {
    Id: int @id
    Name: string
    Score: int
}

query AllPlayers() -> Player[] {
    from Player p
}
```

`persistence: none` explicitly selects a non-persisted ordinary table. A persisted
project needs stable table type IDs; see [Table Definitions](#6--table-definitions).

Tables, enums, and declared record types produce corresponding C# types. Queries
and mutations produce typed operation APIs. Modules group operations into generated
interfaces. Generation is explicit and project-owned; see
[Schema Tooling](/docs/schema/schema-tooling). Never edit generated files by hand.

## 2  File Structure

### 2.1  File Format

Files are UTF-8 text with the `.conjure` extension. The owning project must still
explicitly select the admitted source-format marker:

```xml
<PropertyGroup>
  <ConjureDBSyntaxVersion>2</ConjureDBSyntaxVersion>
</PropertyGroup>
```

The marker is **not** an instruction to use historical spellings. The canonical
forms documented here apply to admitted inputs. Setting the marker to `3` is not
supported. A standalone stored owner uses `conjure.project.json` with
`{"syntaxVersion": 2}`. See [Schema Workflow](/docs/schema/schema-workflow).

### 2.2  Lexical Rules

- Write language keywords in lowercase: `table`, `type`, `query`, `const`.
- Identifier references require exact declared spelling. External C# names must
  match their actual host symbols. Do not declare siblings that differ only in
  case; collision admission never creates a case-insensitive lookup alias.
- Use `//` for line comments. Schema files do not support block comments.
- Separate fields and body declarations with newlines. Separate options,
  parameters, and expression-list elements with commas; trailing commas are
  allowed in those lists.
- `:` introduces a declared type or an option value. `=` assigns an expression.
  A field construction default is an annotation, `@default(expression)`.

For example, these are two fields, not a comma-separated field list:

```conjure
struct type Point {
    X: float
    Y: float
}
```

### 2.3  Declarations

Supported declaration families include:

| Family | Purpose |
|---|---|
| `table`, `struct table` | Ordinary indexed entities |
| `ephemeral table`, `event table`, `singleton table` | Frame-oriented storage |
| `type`, `struct type`, `enum` | Declared data shapes and named values |
| `const` | Typed compile-time scalar value |
| `using Module.Name`, `using Alias = Type` | File-local name resolution |
| `extern type`, `extern function` | Explicit C# integration |
| `module` | Declaration and operation grouping |
| `view`, `materialized view` | Reusable or maintained relations |
| `query`, `reactive query` | Read APIs and subscriptions |
| `mutation`, `command` | Write operations |
| `fragment` | Reusable pipeline fragment |
| `entity domain`, `system` | Entity-reference domains and frame execution |

Commands belong to modules. Systems and entity domains belong at file level.
Not every declaration is legal in every scope or storage kind.

### 2.4  Imports and Module Imports

These forms have different purposes:

| Form | Meaning |
|---|---|
| `import "shared.conjure"` | Include a discovered schema file by relative path |
| `using Economy.Core` | Make declarations of that module available in this file |
| `using PriceRow = Economy.Core.Price` | Give an actual type a local spelling |

A file import resolves relative to the importing file, must target a discovered
schema input, and cannot form a file-import cycle. A module import refers to a
module in the loaded schema; it does not load another file by itself.

The following is a **two-file example**. Keep both files in the schema input set.

`prices.conjure`:

```conjure
module Economy.Core {
    type Price {
        Amount: decimal
    }
    const TaxRate: decimal = 0.2m
}
```

`items.conjure`:

```conjure
import "prices.conjure"
using Economy.Core
using ItemPrice = Economy.Core.Price

table Item(persistence: none) {
    Id: int @id
    Price: ItemPrice
}
```

Imports and aliases are lexical to their declaring file; they are not re-exported
through an importing file. Missing or ambiguous targets, duplicate imports, alias
cycles, and collisions are errors. Module qualification does not make duplicate
short table/type declarations interchangeable: the current schema catalog still
rejects colliding declarations.

### 2.4.1  File-Local Aliases

Aliases can name declared tables, nominal types, scalars, nullable/array types,
and named tuple result shapes. An alias does not create a new type or new table.
Alias chains must resolve without cycles.

```conjure
using Number = int
using MaybeNumber = Number?
using PlayerRow = (Id: int, Score: int)
using Players = Player

table Player(persistence: none) {
    Id: Number @id
    Score: Number
    Bonus: MaybeNumber
}

query Scores() -> PlayerRow[] {
    from Players p | select { p.Id, p.Score }
}
```

A table alias is another name for the same table, including in sources and type
references. It is not a source alias like `p` in `from Player p`. Do not shadow an
active table alias with a parameter or a local source name.

### 2.5  Modules and Constants

Modules group declarations and give constants and functions qualified names.
A constant has a declared type and a closed compile-time expression:

```conjure
module Limits {
    const Base: int = 10
    const DoubleBase: int = Base * 2
    function doubled(value: int) -> int {
        return value * 2
    }
}

const DefaultLimit: int = Limits.DoubleBase
```

Forward constant dependencies are supported; cycles are rejected. A constant
cannot read a query parameter, table row, clock, or arbitrary runtime call. Its
value must fit its declared type. Arithmetic faults and overflow are diagnostics;
use explicit `unchecked(...)` only when wrapping arithmetic is intentional.

`using Limits` can import the module into the declaring file. Module-local
constants/functions take precedence over imported ones; competing imported names
must not be resolved arbitrarily. Functions have their own parameter/local scope;
see [Custom Functions](/docs/query-language/functions).

## 3  Type System

Use canonical scalar names, such as `int`, `long`, `bool`, `float`, `double`,
`decimal`, `string`, `datetime`, `timespan`, `guid`, `fixed32`, and `fixed64`.
The complete primitive table and literal rules are in [Data Types](/docs/query-language/data-types).

| Source type | Meaning |
|---|---|
| `T` | A declared value type or nominal type |
| `T?` | An absence-admitting value/result |
| `T[]` | An array; in a query signature, an owned result collection |
| `T?[]` | An array whose elements may be absent |
| `(Id: int, Name: string)` | Named tuple type, with at least two distinct members |
| `pooled<T>` | A read-only pooled query result, disposed by its consumer |
| `seq<T>` | A push-consumer query result |
| `map<K, V>` | A keyed query result shaped by a final `group` |
| `ref Entity` | A domain-specific ephemeral entity reference |

Result constructors are query-result choices, not general-purpose stored-field
containers. Do not use `pooled<T>`, `seq<T>`, or `map<K, V>` as table fields.
An alias does not bypass that restriction. Arrays and nominal reference values
are also not valid arbitrary fields of ephemeral row storage.

`T?[]` makes the **element** optional; it does not mean a nullable array.
Do not transpose suffixes or rewrite an old collection signature without checking
its public result shape.

## 4  Enum Definitions

An enum is a nominal set of named integral values. Its default backing type is
`int`; supported explicit backing types are `byte`, `sbyte`, `short`, `ushort`,
`int`, `uint`, `long`, and `ulong`.

```conjure
enum PlayerState: byte {
    Idle = 0,
    Active = 1,
    Disabled = 2,
}

table Player(persistence: none) {
    Id: int @id
    State: PlayerState @default(PlayerState.Idle)
}
```

Omitted member values increment from the preceding value. Values must fit the
backing type. Write qualified enum members such as `PlayerState.Active`, not an
integer cast to the enum name. See [Enum Literals](/docs/query-language/data-types#enum-literals).

## 5  Type Definitions

`type` declares a nominal reference record; `struct type` declares a nominal value
record. They have fields, not table storage, primary keys, or indexes.

```conjure
struct type Point {
    X: float
    Y: float
}

type PlayerSummary {
    Id: int
    Name: string
}

table Player(persistence: none) {
    Id: int @id
    Name: string
}

query Summaries() -> PlayerSummary[] {
    from Player p | select { p.Id, p.Name }
}
```

A declared result shape checks the names, types, nullability, and required members
of its projection. Structural resemblance does not turn a different nominal type
into this type. An alias such as `using Summary = PlayerSummary` names the same
type rather than declaring a second record.

Record values can be contextual (`{ X = ..., Y = ... }`) or explicitly nominal
(`Point { X = ..., Y = ... }`). In a scalar `select`, parenthesize a whole record
value to distinguish it from a result-field projection; see
[Composite Types](/docs/query-language/data-types#composite-types).

## 6  Table Definitions

Ordinary tables, including `struct table`, require exactly one non-nullable `@id`
field. `struct table` selects a value-record C# entity; it does not remove the
primary-key requirement.

```conjure
table Player(plural: Players, persistence: local, type_id: 101, schema_version: 1) {
    Id: int @id
    Name: string
    Score: int @default(0)
}
```

### 6.2  Table Options

| Option | Supported meaning |
|---|---|
| `plural: Players` | Generated set/API name |
| `persistence: local` / `remote` / `none` | Explicit persistence selection |
| `type_id: 101` | Stable explicit table discriminator; values 1 through 65535 |
| `schema_version: 1` | Persisted schema version |
| `capacity: 1024` | Positive initial capacity |

For a generated persisted pack, declare explicit, unique `type_id` values. A
missing ID is not replaced with a generated persisted identity. Ordinary
`persistence: none` tables and ephemeral storage kinds can receive deterministic
runtime-local IDs. Omitting `persistence` is not the same as explicitly declaring
`none` for this rule. Retain persisted IDs across schema evolution; see
[Persistence](/docs/engine/persistence) and [Schema Migration](/docs/schema/schema-migration).

### 6.5  Ephemeral Tables, Events, Singletons, Domains, And Systems

```conjure
ephemeral table Body(plural: Bodies, capacity: 1024) {
    Id: int @id
    X: float
}

event table Hit(capacity: 128, lifetime: next_frame) {
    Target: ref Body
    Damage: int
}

singleton table FrameTime {
    Delta: float
}

system Advance(phase: update) {
    from Body b | set { b.X = b.X + FrameTime.Delta }
}
```

These storage kinds do not declare `persistence`, `type_id`, or `schema_version`.
Ordinary ephemeral rows have `@id`; events are keyless; singletons have implicit
one-row identity and do not declare `@id` or capacity. Events admit `lifetime:
frame` or `next_frame`. Ephemeral fields must satisfy the storage kind's supported
value-layout restrictions; collection/reference payloads are not implicitly boxed.

`ref Body` preserves the addressed entity domain. It is not an integer ID or a
nullable/collection field. `none` is an absent handle value where that contract
admits one. Entity domains explicitly group permitted target tables.

Systems have their own update, join, fold, resource, and write contracts. A `sort`
on a driver defines traversal order; it is not interchangeable with sorting a
completed query result. A `@parent` link must remain a forest: cycles are rejected
on writes. Parent depth is engine-maintained, not an ordinary user-writable field.
See [Ephemeral Tables](/docs/advanced/ephemeral-tables) for the complete system grammar,
parent-link constraints, scheduling, and ordering rules.

### 6.6  Views And Materialized Views

A view declares its output fields and then a source pipeline. Use a named scalar
projection for one field; braces require at least two fields.

```conjure
table Item(persistence: none) {
    Id: int @id
    OwnerId: int
}

view ItemOwner {
    OwnerId: int
} = from Item i | select OwnerId = i.OwnerId

materialized view OwnerCount {
    OwnerId: int
    Count: long
} = from Item i
    | group i.OwnerId (aggregate Count = count())
    | select { OwnerId = OwnerId, Count = Count }
```

A virtual `view` stores no rows. A `materialized view` stores derived in-memory
state and must pass the supported maintenance rules; an arbitrary query is not
necessarily maintainable. It has no persistence/type-ID/schema-version contract.

Current materialized-view options include `capacity`, `refresh: incremental`,
`rebuild`, or `manual`, and `rewrite: explicit`, `auto`, or `none`. The selected
mode must satisfy its maintenance/rewrite constraints. These are options of a
materialized view, not a second form of `query`; virtual views do not accept them.
See [Compiled Queries](/docs/query-language/compiled-queries) for materialized query use.

## 7  Field Declarations

A field is `Name: Type` followed by its annotations. Field and declaration names
retain schema identity; generated C# property names follow the generator's naming
rules. Avoid names that collide after generated-name normalization.

```conjure
const InitialScore: int = 10

table Player(persistence: none) {
    Id: int @id
    Score: int @default(InitialScore)
    Nickname: string?
}
```

See [Construction Defaults](#83--defaultconstant--construction-default) for the
default annotation's assignment rules.

## 8  Field Annotations

| Annotation | Purpose and principal constraint |
|---|---|
| `@id` | The table's single primary key; not nullable |
| `@unique` | A unique key on an ordinary table; not admitted on ephemeral kinds |
| `@default(value)` | Typed construction default |
| `@relation(references: Parent.Id, ...)` | Typed relation to another table |
| `@index(...)` | A declared access path; see [Indexing](/docs/schema/indexing) |
| `@range(lower..upper)` | A typed declared range, lower-inclusive and upper-exclusive |

### 8.3  `@default(constant)` — Construction Default

`@default(...)` supplies a construction default; it is not a computed field or a
rule applied again on each update. A closed expression must be assignable to the
field, including its declared nullability. Nominal record defaults must initialize
the actual declared members. Runtime parameters and row reads are not defaults.

### 8.5  Relations

Relations use snake_case option names and lowercase action values:

```conjure
table Guild(persistence: none) {
    Id: int @id
}

table Player(persistence: none) {
    Id: int @id
    GuildId: int? @relation(references: Guild.Id, on_delete: set_null)
}
```

Supported relation action spellings include `cascade`, `restrict`, `no_action`,
`set_null`, and `set_default`. The chosen action must fit the relation field's
nullability/default contract.

### 8.6  Declared Ranges

A declared range can use closed constants and supported temporal constructors:

```conjure
const End: int = 100

ephemeral table Probe(capacity: 8) {
    Id: int @id
    Value: int @range(0..End)
}
```

`@range` bounds must be closed, ordered, typed values; invalid bounds are errors.
**The annotation is not a universal write-time validation guarantee.** In
particular, it does not establish that every mutable host/API write has been
range-checked. Do not remove checks or treat unvalidated values as proven in range
merely because the field has this annotation. See [Ranges](/docs/query-language/data-types#ranges).

## 9  Table Annotations

Table-level annotations appear on their own lines inside the field body.

```conjure
table Player(persistence: none) {
    Id: int @id
    Name: string
    GuildId: int
    @@unique(fields: [Name])
    @@index(fields: [GuildId, Id], kind: sorted_set, name: "ByGuild")
}
```

`@@unique` declares a composite unique key. `@@index` declares a composite access
path. Field `@unique` and an equivalent table-level unique declaration do not
create independent constraints: duplicate/colliding declarations are errors.
On nullable unique keys, null is a key value, so two rows cannot both own it.
The current unique-index transaction contract does not allow reusing a key that
the same transaction releases by deletion or reassignment; commit that release
before assigning the key to another row.

`@@navigation(name: "items", references: Item.OwnerId)` declares a parent-side
child collection through an actual relation. Navigation targets and lookup keys
must be valid; a similarly named unrelated field is not a relation. See
[Indexing](/docs/schema/indexing) and [Query Language](/docs/query-language/reference).

## 10  Query Definitions

A query always has a parameter list, a result signature, and a pipeline body.
Use `@parameter` in query expressions, including when its name resembles a field.

```conjure
table Player(persistence: none) {
    Id: int @id
    Name: string
    Score: int
}

query Ranked(minScore: int) -> Player[] {
    from Player p
    | filter p.Score >= @minScore
    | sort -p.Score, p.Id
}

query Find(id: int) -> Player? {
    from Player p | filter p.Id == @id
}

query RequirePlayer(id: int) -> Player {
    from Player p | filter p.Id == @id | single
}

query CountPlayers() -> long {
    from Player p | aggregate count()
}
```

### 10.3  Return Types and Cardinality

The signature chooses both the value shape and collection API. It does not
silently choose an arbitrary row from a multi-row result.

| Signature | Result contract |
|---|---|
| `T` | Required one-row/scalar result |
| `T?` | Optional result/value; zero rows may produce absence |
| `T[]` | Owned array of all result rows |
| `pooled<T>` | Read-only pooled result, valid until disposal |
| `seq<T>` | Push-consumer result rather than an array-returning sibling API |
| `map<K, V>` | Keys and values defined by the final scoped group |

When row cardinality is not already proved, a required result needs `single`, or
an ordered selection with `first`. An optional result needs `single_or_default`,
or an ordered selection with `first_or_default`. Equality on an actual key can
prove at-most-one; it does not prove that the row exists. A collection does not
accept a row-selection terminal. Redundant or shape-mismatched terminals are
errors. `any` answers existence and requires a non-nullable `bool` result.

A single scalar output aggregate is unnamed (`aggregate count()`). Aggregates
returned as named row members require explicit assignments
(`aggregate Count = count()`). Empty-input folds can return a value such as
`count()`'s zero or an absent value such as `sum(...)`; the declared scalar type
must admit the actual result. See [Collection Types](/docs/query-language/data-types#collection-types)
and [Query Language](/docs/query-language/reference) for examples and complete marker rules.

### 10.4  Planning Hints

The current query annotation form is `@planning(...)`, between the signature and
the body. Options are comma-separated `name: value` entries. Hints must match
actual keys and operator surfaces; they do not replace type, cardinality, or
ordering checks.

Supported families include key-domain bounds, expected/max result counts,
set-operation domain information, aggregate dense domains, and dense-sort key
surfaces. Use [Query Language](/docs/query-language/reference) for the current hint vocabulary.
Bounds on a dense-sort surface are a query execution contract: out-of-contract
values can raise a range violation. This is distinct from claiming that
`@range` validates every storage write.

### 10.6  Reactive Queries

`reactive query` declares a subscription, not a separate projection grammar.
The compiler checks whether the source can be maintained and whether parameters
belong in a supported read tail. Ephemeral sources and unsupported aggregate,
window, or correlated shapes are not automatically converted into maintained
views. See [Compiled Queries](/docs/query-language/compiled-queries).

## 11  Mutation Definitions

A mutation declares a parameter list and an optional result type, then a write
pipeline. Its verbs include `insert`, `update`, `delete`, and `upsert`; write
projections use `set { Field = expression }`. An unrestricted whole-table write
must acknowledge that intent explicitly.

```conjure
table Player(persistence: none) {
    Id: int @id
    Score: int
}

mutation SetScore(id: int, score: int) {
    update Player
    | filter Id == @id
    | set { Score = @score }
}
```

Mutation return contracts and returning projections must agree. See
[Query Language](/docs/query-language/reference) for write-pipeline operations.

## 12  Command Definitions

Commands belong to a module and may combine queries, checked requirements, local
state, and writes. Their metadata uses `:`; a canonical grouped metadata example
is:

```conjure
module Validation {
    command Echo(value: int) -> int (kind: internal) {
        return @value
    }
}
```

The command's result is optional in the declaration only when the command returns
no value; an optional **value** is instead written `-> T?`. Failure behavior and
transaction rules are command contracts, not type aliases. For transaction
boundaries, see [Transactions](/docs/engine/transactions).

## 13  Fragment Definitions

The current reusable pipeline-fragment declaration remains `fragment` with a
parameter list and `= pipeline`. A fragment call uses `@Name(...)` at its supported
pipeline site. Expansion must resolve the actual parameters, source, and fields;
recursive expansion is rejected. A fragment is not a scalar `function` and does
not create materialized state. See [Query Language](/docs/query-language/reference).

## 14  Migration Notes

This complete **intentionally rejected** schema demonstrates a retired scalar
spelling (`SCH2173`); the corrected field type is `int`.

```conjure
type LegacyShape {
    Value: int32
}
```

The following are **intentional negative examples**, not supported authoring
forms:

```text
Value: int32                         // use int
Value: optional int                  // use int?
Value: many int                      // use int[]
Value: int = 1                       // use @default(1)
using Economy.Core as E              // module import is using Economy.Core
@relation(references: Guild.Id, onDelete: SetNull)
                                     // use on_delete: set_null
select { Id = p.Id }                 // one output: select Id = p.Id
aggregate { Count = count() }         // one assignment: aggregate Count = count()
```

For query collection APIs, choose `T[]`, `pooled<T>`, `seq<T>`, or `map<K, V>`
rather than documenting a CLR list interface as the collection policy. Migrating
a CLR-shaped result signature can change the generated method set, ownership,
and lifetime; it is not automatically API-preserving.

Diagnostics and offered edits are described in [Error Codes](/docs/reference/error-codes).
An edit without proof of result/API preservation may deliberately have no fix-it.

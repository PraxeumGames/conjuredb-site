# Data Types

Types describe values, declared storage, and query results. Use schema type names
in `.conjure` source; a generated C# carrier is not an alternative source grammar.
See [Schema Language](/docs/schema/schema-language) for declarations and
[Query Language](/docs/query-language/reference) for expressions and pipelines.

## Type System Overview

There are three distinct choices:

1. **Value type:** a scalar, enum, declared record, entity reference, or collection
   element.
2. **Absence:** `T?` admits an absent value; `T` does not silently discard absence
   at a declared assignment boundary.
3. **Query result surface:** `T[]`, `pooled<T>`, `seq<T>`, and `map<K, V>` choose
   different ownership and generated API contracts.

A nominal type alias does not create a new type. A collection result constructor
does not make that result type valid as a stored field.

## Numeric Types

### Integer Types

| Schema type | Width | Range |
|---|---|---|
| `sbyte` | Signed 8-bit | −128 to 127 |
| `byte` | Unsigned 8-bit | 0 to 255 |
| `short` | Signed 16-bit | −32,768 to 32,767 |
| `ushort` | Unsigned 16-bit | 0 to 65,535 |
| `int` | Signed 32-bit | −2³¹ to 2³¹−1 |
| `uint` | Unsigned 32-bit | 0 to 2³²−1 |
| `long` | Signed 64-bit | −2⁶³ to 2⁶³−1 |
| `ulong` | Unsigned 64-bit | 0 to 2⁶⁴−1 |

Use suffixes to select a literal's type: `1u`, `1L`, and `1ul`. A sign is an
expression operator, as in `-1L`. A constant assignment may fit a smaller declared
integral type; a runtime narrowing is not justified merely because the value
usually fits.

### Floating-Point Types

`float` is IEEE 754 binary32; `double` is IEEE 754 binary64. An unsuffixed decimal
real literal is `double`. Use `1f` or `0.5f` for `float`, and `1d` for an explicit
`double` literal. Do not rely on a `double` literal implicitly narrowing to `float`.

### Decimal Type

`decimal` is the CLR decimal value type. Use `m`, as in `12.50m`. Decimal and
binary floating-point arithmetic are not interchangeable numeric families;
choose conversions deliberately rather than assuming a common numeric rank.

### Fixed-Point Types

| Schema type | Carrier | Format | Literal example |
|---|---|---|---|
| `fixed32` | `ConjureDB.Numerics.Fixed32` | Q16.16 | `1.5fx32` |
| `fixed64` | `ConjureDB.Numerics.Fixed64` | Q32.32 | `1.5fx64` |

Fixed-point values do not silently mix with integer or IEEE floating-point values.
Use their supported typed operations and explicit conversions. The exact
`fixed32` to `fixed64` widening is supported; the reverse is not implicit.
`fixed` is not a canonical substitute for `fixed64`.

### Numeric Promotion Hierarchy

Promotion is governed by the actual operand types and the operation. It is not
simply “the larger width wins”: signed/unsigned ranges, decimal, fixed point,
nullability, and potentially lossy conversions matter. Typical lossless writes
include `int` to `long` and `float` to `double`; a `long` result cannot be assigned
to `int` without an explicit admitted conversion.

### Aggregate Type Inference

An aggregate's result type and empty-input behavior are part of its contract.
`count()` returns `long`, including zero for empty input. Value folds such as
`sum`, `min`, `max`, and `avg` can be absent on empty input; do not declare a
non-nullable result unless the actual operation and input prove non-absence.

```conjure
table Sale(persistence: none) {
    Id: int @id
    Amount: int
}

query SaleCount() -> long {
    from Sale s | aggregate count()
}

query AverageAmount() -> double? {
    from Sale s | aggregate avg(s.Amount)
}
```

A scalar output aggregate is unnamed. A row-member aggregate has an explicit
assignment name. Adding a `select` to a scalar aggregate is not permission to
use an unnamed aggregate as an authored row member.

## Boolean Type

`bool` has the values `true` and `false`; `bool?` also admits absence.

### Two-Valued Boolean Logic

Comparisons use two-valued results rather than SQL `UNKNOWN`. Null equality is
explicit: `null == null` is true, and an absent value differs from a non-absent
one. Ordered comparisons involving absence do not make the value present.
Use `&&`, `||`, and `!`; short-circuiting and the actual expression's effects are
preserved. An absence-admitting boolean must be handled where a definite boolean
is required.

## Character and String Types

`char` is one UTF-16 code unit; `string` is a reference string. String comparison
is ordinal. The declaration distinguishes `string` from `string?`, even though
both use a reference-type CLR carrier. A CLR reference representation does not
make a declared non-nullable result or field nullable.

```conjure
table Player(persistence: none) {
    Id: int @id
    Nickname: string?
}

query DisplayNames() -> string[] {
    from Player p | select Name = p.Nickname ?? "anonymous"
}

query UnnamedPlayers() -> Player[] {
    from Player p | filter p.Nickname == null
}
```

Use canonical `text.*` functions for string operations; see
[Custom Functions](/docs/query-language/functions). Do not substitute C# instance methods or
retired collection/string call spellings.

## Temporal Types

| Schema type | C# carrier |
|---|---|
| `datetime` | `System.DateTime` |
| `datetimeoffset` | `System.DateTimeOffset` |
| `dateonly` | `System.DateOnly` |
| `timeonly` | `System.TimeOnly` |
| `timespan` | `System.TimeSpan` |

A temporal type is not a number merely because its carrier has ticks. Comparisons
and supported arithmetic require appropriate temporal operands; different date/time
types are not automatically interchangeable.

Calendar construction uses expressions such as `datetime(2024, 1, 1)`, not an
`@`-prefixed date literal. Duration literals include `s`, `ms`, `min`, and `h`.
Their typed value is a `timespan`.

```conjure
const Epoch: datetime = datetime(2024, 1, 1)
const RetryDelay: timespan = 1s + 500ms

table EventRecord(persistence: none) {
    Id: int @id
    CreatedAt: datetime @default(Epoch)
}
```

Runtime clocks are not closed schema constants or closed range endpoints.
Temporal conversion and date functions are described in
[Custom Functions](/docs/query-language/functions).

## Binary Type

`binary` is a binary value carried by `byte[]`. It is semantically distinct from
the general array type `byte[]`; do not assume that equal CLR representations
make the two source types interchangeable in every operation.

```conjure
table Payload(persistence: none) {
    Id: int @id
    Content: binary
    OptionalContent: binary?
}
```

Binary values support compatible equality, not general scalar ordering.
Storage-kind restrictions still apply: a managed binary payload is not an
arbitrary ephemeral-row field.

## Identifier Types

### Guid

`guid` maps to `System.Guid`. It is not a stringly typed entity reference. Use a
typed parameter or the supported conversion contract when crossing a textual
boundary. Domain-specific frame references use `ref T`, described below.

## Nullable Types

### Syntax

| Form | Meaning |
|---|---|
| `int?` | An integer or absence |
| `string?` | A string declaration that admits absence |
| `Player?` | An optional entity/result value |
| `int[]` | An array of non-nullable integers |
| `int?[]` | An array of optional integers |

The suffix order matters. `T?[]` does **not** mean an absent array container.
Do not rewrite `optional many T` mechanically to that form: it changes which
value can be absent. Direct type syntax does not admit `T[]?` as an alternative
spelling for optional elements.

### Null Handling Operators and Functions

- Test absence with `value == null` or `value != null`.
- Use `value ?? replacement` to choose an alternative for absence.
- Use `condition ? left : right` for a conditional expression. Its branches must
  have an admitted common type and nullability.

An explicit cast does not automatically prove that an absent value is present.
A declared write must satisfy both the target's type and its nullability.

### Optional Results and Row Cardinality

The question “can this **value** be absent?” differs from “how many **rows** does
this query produce?” An ungrouped `avg` produces one scalar row whose value can
be absent. A key lookup can produce zero or one entity row. The signature and
completed pipeline are checked together.

| Completed row cardinality | Required `-> T` | Optional `-> T?` | Collection result |
|---|---|---|---|
| Exactly one, proved | No row terminal | No row terminal | No row terminal |
| At most one, proved | `single` | No row terminal | No row terminal |
| Many or not proved | `single`, or ordered `first` | `single_or_default`, or ordered `first_or_default` | No row terminal |

The result value must still fit its declared type in every cell of the table.
`first` and `first_or_default` require an actual qualifying order. A terminal that
is redundant or conflicts with the signature is rejected, rather than silently
changing the API. `single` checks multiplicity; it does not choose an arbitrary row.

## Enum Types

### Schema Definition

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

query ActivePlayers() -> Player[] {
    from Player p | filter p.State == PlayerState.Active
}
```

### Backing Types

The default is `int`. Explicit integral backing types are `sbyte`, `byte`,
`short`, `ushort`, `int`, `uint`, `long`, and `ulong`. Values must fit the backing
range. An omitted member value increments from its predecessor.

### Enum Type Compatibility

An enum has its own nominal identity. Two independently declared enums are not
interchangeable merely because they have identical backing types and values.
Supported equality with an enum's backing integer type does not make that integer
an assignable enum value or authorize an integer-to-enum cast. Enum ordering is
not a general numeric operation.

### Enum Literals

Write a declared member, such as `PlayerState.Active`. A field/default typed as
that enum accepts its own members, not the same-valued member of another enum.
Do not manufacture an enum value by writing `1 as PlayerState`.

### Flags Enums

An enum can declare powers of two and named combinations, but that declaration
does not create a separate flags-expression grammar:

```conjure
enum Permissions {
    None = 0,
    Read = 1,
    Write = 2,
    ReadWrite = 3,
}
```

Use the declared combination `Permissions.ReadWrite` when needed. A bare `|` is a
pipeline separator, not an enum-combination operator. Do not infer C# `[Flags]`
behavior from these member values.

## Collection Types

### Collection Kinds

An ordinary query's result signature selects one generated consumer surface:

| Source result | Ownership and consumption | Generated method shape |
|---|---|---|
| `T[]` | Owned array copy; the caller can modify that copy | `Read(...)` returns an array |
| `pooled<T>` | Stable pooled copy, read-only, valid until `Dispose` | `Read(...)` returns `ReadOnlyPooledQueryResult<T>` |
| `seq<T>` | Rows pushed to a typed consumer during execution | `ReadForEach<TConsumer>(..., ref consumer)` |
| `map<K, V>` | Owned keyed result from a final scoped group | `Read(...)` returns a dictionary |

Only the selected method surface is generated. An array result does not also
request `ReadNoAlloc`, and a sequence does not add an array-returning `Read`.
Choosing a different surface can therefore change the public C# API.

A pooled result is a **copy**, not a borrowed view into mutable table storage.
Source writes do not change that copy. Copies of a pooled result handle share
its disposal/lifetime; do not use any copy after disposal. Its public API does
not expose writable backing storage. A sequence is a push API, not a promise of
an `IEnumerable<T>` object that the caller can enumerate later.

### Schema Syntax

This complete example selects each supported surface explicitly:

```conjure
table Row(plural: Rows, persistence: none) {
    Id: int @id
    Bucket: int
    Score: int
}

using PlayerRow = (Id: long, Score: int)

query ArrayRows() -> int[] {
    from Row r | select r.Id
}

query PooledRows() -> pooled<int> {
    from Row r | select r.Id
}

query SequenceRows() -> seq<int> {
    from Row r | select r.Id
}

query MapRows() -> map<int, int[]> {
    from Row r | group r.Bucket (sort r.Id | select r.Id)
}

query MapCounts() -> map<int, long> {
    from Row r | group r.Bucket (aggregate count())
}

query MapTuples() -> map<int, PlayerRow[]> {
    from Row r | group r.Bucket (sort r.Id | select { r.Id, r.Score })
}
```

A map query must end in the actual `group Key (pipeline)`. The key supplies `K`;
the inner output supplies `V`. A collection value retains the partition's rows;
a scalar value requires the supported scalar reduction. A nullable key, a scalar
value manufactured from an arbitrary multi-row `select`, or a pipeline suffix
after the final group is rejected. An inner filter can leave an existing
partition with an empty array value.

Selected result constructors cannot be nested arbitrarily: `pooled<T>` and
`seq<T>` require non-array elements, a map value may be an array but not another
selected result constructor, and a map key cannot be optional or a collection.

These constructors are result-only. They do not invent a storage or parameter
ABI for `pooled<T>`, `seq<T>`, or `map<K, V>`. Stored arrays use `T[]` where the
storage kind permits arrays. A nominal alias cannot bypass storage restrictions.

### Migration from CLR Collection Signatures

Use the source result constructors to state collection policy, not a CLR list
interface. The following is an **intentional migration example**, not the
recommended signature for a new query:

```text
-> extern System.Collections.Generic.IReadOnlyList<int>
```

There is no universally API-preserving replacement: choose `int[]`, `pooled<int>`,
or `seq<int>` according to ownership and consumption, then review the actual
generated return type and method set. A type alias alone does not prove equality
of those public APIs.

## Composite Types

### Declared Records

`type Name` declares a nominal reference record; `struct type Name` declares a
nominal value record. Both describe named members. A named tuple alias is a
structural tuple spelling, not a new nominal record declaration.

```conjure
struct type Pair {
    First: int
    Second: int?
}

using PairAlias = Pair

table Row(persistence: none) {
    Id: int @id
}

query Pairs() -> Pair[] {
    from Row r | select (PairAlias { First = r.Id, Second = null })
}
```

`PairAlias { ... }` constructs the actual `Pair`. Member names, duplicates,
required members, conversions, and nullability are checked against its declared
shape. Source order is retained for expression evaluation; it is not an excuse
to bind values to whichever member happens to occupy that position.

A contextual record value `{ First = expression, Second = expression }` needs
an actual declared target shape. A nominal value explicitly names that shape.
In contrast, `select { r.Id, Score = expression }` is a named result-field
projection. One scalar output is written without tuple braces; parenthesize a
whole nominal record value as shown above.

### Composite Type Compatibility

Nominal identity matters: a different record with the same field names is not
implicitly the same type. Aliases preserve identity. An enum, table entity,
struct record, reference record, and named tuple are not interchangeable just
because generated code happens to expose similar members.

## Extern Types

`extern type Alias = Qualified.ClrType` declares a C# bridge type. The owning
project must provide the actual referenced symbol; a guessed name or an unrelated
same-named type is not sufficient. It is also possible to use an explicit
`extern Qualified.ClrType` at an admitted type-reference boundary.

These are **syntax templates**, requiring a real project reference and actual
host members, rather than self-contained schema examples:

```text
extern type Position = Game.Geometry.Position
extern function project(value: Position) -> float = Game.Geometry.Project
```

External construction/projection must match the real accessible C# constructor
and members. A private or mismatched constructor is not made usable by an alias.
For functions and project integration, see [Custom Functions](/docs/query-language/functions)
and [Schema Workflow](/docs/schema/schema-workflow).

## Entity References

The source type `ref Entity` carries an ephemeral entity domain. It is an opaque
generational reference, not a numeric key. Equality and supported domain-preserving
uses do not imply arithmetic, ordering, or casts to/from integers.

```conjure
ephemeral table Actor(capacity: 16) {
    Id: int @id
    Health: int
}

event table Hit(capacity: 16, lifetime: next_frame) {
    Target: ref Actor
    Damage: int
}
```

A reference must name an admitted entity/table domain. An optional reference is
represented by the handle's `none` contract, not by adding `?` to a reference
field. Reference arrays, persisted reference fields, and references nested into
unsupported stored record layouts are rejected. See
[Ephemeral Tables](/docs/advanced/ephemeral-tables).

## Type Coercion and Conversion

### Implicit Conversions

Declared assignments admit supported implicit conversions, not arbitrary
reinterpretation. Non-absence is checked independently of the CLR type:
`string?` cannot become a required `string` merely because both carriers are
references. A narrowing aggregate result also needs explicit intent.

### Explicit Casts

Use the expression form `value as Type`; the historical `cast(value as Type)`
form is not the canonical syntax.

```conjure
table Player(persistence: none) {
    Id: int @id
    Score: int
}

query WideScores() -> long[] {
    from Player p | select Score = p.Score as long
}
```

Casts must belong to a supported conversion. They do not grant arbitrary
integer-to-enum, integer-to-reference, or unrelated nominal conversions. Use
`checked(...)` and `unchecked(...)` where the supported arithmetic/cast contract
requires explicit overflow behavior. Function-based parsing and conversion have
their own failure/nullability contracts; see [Custom Functions](/docs/query-language/functions).

## Ranges

`lower..upper` is lower-inclusive and upper-exclusive. A predicate such as
`Value in 0..10` includes zero and excludes ten. `@range(0..10)` declares typed
range metadata using the same endpoint convention.

Range endpoints must be ordered, closed, and compatible with the field's supported
numeric or temporal domain. Constants and supported calendar/duration expressions
can supply endpoints; runtime parameters and clocks cannot.

A declared range is **not** a universal mutable-storage invariant. It does not
prove that every host/API write was range-checked. Do not rely on the annotation
alone to remove validation, narrow a result type, or assume an out-of-range write
cannot occur. Query execution contracts such as a dense-sort hint are separate
and can enforce their own range checks.

## Schema Type Names vs C# Names

| Canonical source | C# carrier |
|---|---|
| `sbyte`, `byte`, `short`, `ushort` | Corresponding C# integral type |
| `int`, `uint`, `long`, `ulong` | Corresponding C# integral type |
| `float`, `double`, `decimal` | Corresponding C# numeric type |
| `bool`, `char`, `string` | Corresponding C# scalar/reference type |
| `datetime`, `datetimeoffset` | `System.DateTime`, `System.DateTimeOffset` |
| `dateonly`, `timeonly`, `timespan` | Corresponding `System` temporal type |
| `guid` | `System.Guid` |
| `binary` | `byte[]`, with binary semantics |
| `fixed32`, `fixed64` | Corresponding `ConjureDB.Numerics` fixed-point type |
| `object` | `System.Object`, only where the operation/storage admits it |
| Declared enum | Generated enum with its declared backing type |
| `type Name` / `struct type Name` | Generated reference/value record |
| `T[]` | Array of the actual element type |
| `ref Entity` | Domain-typed ephemeral entity handle |

CLR names and carriers belong at integration boundaries. They do not replace
canonical schema spellings or override lifetime, storage, and nullability rules.
The owning project/runtime must support the carrier; a schema spelling alone
does not provide an unavailable framework or external type.

## Intentional Negative Migration Examples

The following old spellings are shown **only to explain rejection/migration**:

```text
int32       -> int
boolean     -> bool
single      -> float
timestamp   -> datetime
interval    -> timespan
fixed       -> fixed64
optional T  -> T?
many T      -> T[]
```

This complete **intentionally rejected** schema uses the retired wrapper/type
spellings (`SCH2173`). Its canonical field type is `int?[]`, not an optional
array container.

```conjure
type LegacyShape {
    Values: many optional int32
}
```

Compound wrapper edits must preserve which value is optional. If that cannot be
proved, a diagnostic may deliberately omit an automatic edit. See
[Error Codes](/docs/reference/error-codes) and [Schema Migration](/docs/schema/schema-migration).

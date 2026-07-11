# Data Types

This document is a comprehensive reference for all data types supported in ConjureDB — in schema
definitions (`.conjure` files), the query DSL, and at runtime. Each type is described with its size,
range, schema name, C# mapping, and usage examples.

> **See also:**
> [Schema Language](/docs/schema/schema-language) — defining types in `.conjure` files •
> [Query Language](/docs/query-language/reference) — using types in queries •
> [Custom Functions](/docs/query-language/functions) — type conversion and string functions

---

## Type System Overview

ConjureDB's type system is built on .NET's Common Type System (CTS) with additional structure for
query compilation and optimization. Every value in ConjureDB belongs to one of the following
**type categories**:

| Category       | Description                                      | Examples                         |
|----------------|--------------------------------------------------|----------------------------------|
| **Scalar**     | Primitive types with no internal structure        | `int`, `string`, `DateTime`      |
| **Struct**     | Value types with named members                   | User-defined `type` declarations |
| **Class**      | Reference types with named members               | User-defined `table` declarations|
| **Enum**       | Enumeration types with named constants            | `enum PlayerStatus { ... }`      |
| **Collection** | Ordered sequences of a single element type        | `int[]`, `list<string>`          |
| **Dictionary** | Map types with distinct key and value descriptors | `IReadOnlyDictionary<string, int>` |
| **Nullable**   | Wrapper indicating a value type may be absent     | `int?`, `DateTime?`              |
| **Unknown**    | Placeholder for unresolved or untyped external values | Internal compiler use only   |
| **Error**      | Sentinel for type errors (compatible with all)    | Internal compiler use only       |

The compiler tracks types through a unified `TypeDescriptor` system. All type descriptors are
**immutable** and scalar singletons are **cached** for identity comparison, which enables efficient
type checks throughout the compilation pipeline.

---

## Numeric Types

### Integer Types

ConjureDB supports six integer types as field/scalar types — `byte`, `short`, `int`, `uint`, `long`,
and `ulong`. The signed 8-bit (`sbyte`) and unsigned 16-bit (`ushort`) types are available **only as
enum backing types** (see [Backing Types](#backing-types)), not as field or scalar types.

| Schema Name | C# Type         | Size    | Minimum                    | Maximum                     | Notes           |
|-------------|-----------------|---------|----------------------------|-----------------------------|-----------------|
| `sbyte`     | `System.SByte`  | 1 byte  | −128                       | 127                         | Signed 8-bit — enum backing only |
| `byte`      | `System.Byte`   | 1 byte  | 0                          | 255                         | Unsigned 8-bit  |
| `short`     | `System.Int16`  | 2 bytes | −32,768                    | 32,767                      | Signed 16-bit   |
| `ushort`    | `System.UInt16` | 2 bytes | 0                          | 65,535                      | Unsigned 16-bit — enum backing only |
| `int`       | `System.Int32`  | 4 bytes | −2,147,483,648             | 2,147,483,647               | **Default integer type** |
| `uint`      | `System.UInt32` | 4 bytes | 0                          | 4,294,967,295               | Unsigned 32-bit |
| `long`      | `System.Int64`  | 8 bytes | −9,223,372,036,854,775,808 | 9,223,372,036,854,775,807   | Signed 64-bit   |
| `ulong`     | `System.UInt64` | 8 bytes | 0                          | 18,446,744,073,709,551,615  | Unsigned 64-bit |

**Integer literals** in queries are typed as `int` (Int32) by default. If the value exceeds the
Int32 range, the compiler promotes the literal to `long` (Int64).

**Arithmetic promotion:** Sub-`int` types (`sbyte`, `byte`, `short`, `ushort`) are automatically
widened to `int` for arithmetic operations. Mixed `int`/`uint` operations promote to `long`.
Multiplication applies additional widening: `int × int → long`, `uint × uint → ulong`.

```
// Schema
table Inventory {
    slot: byte
    quantity: int
    total_value: long
}

// Query — byte is widened to int for arithmetic
from Inventory | select slot * quantity
```

### Floating-Point Types

| Schema Name | C# Type          | Size    | Approximate Range                   | Precision         | Notes       |
|-------------|------------------|---------|-------------------------------------|--------------------|-------------|
| `float`     | `System.Single`  | 4 bytes | ±1.5 × 10⁻⁴⁵ to ±3.4 × 10³⁸      | ~6–9 digits        | IEEE 754    |
| `double`    | `System.Double`  | 8 bytes | ±5.0 × 10⁻³²⁴ to ±1.7 × 10³⁰⁸    | ~15–17 digits      | IEEE 754    |

Floating-point literals with a decimal point (e.g., `3.14`) are typed as `double` by default.

> **⚠ Precision warning:** Floating-point types use binary representation and cannot exactly
> represent all decimal fractions. For financial or other precision-critical calculations, use
> `decimal` instead.

### Decimal Type

| Schema Name | C# Type           | Size     | Range                                        | Precision    |
|-------------|--------------------|----------|----------------------------------------------|--------------|
| `decimal`   | `System.Decimal`   | 16 bytes | ±1.0 × 10⁻²⁸ to ±7.9228 × 10²⁸             | 28–29 digits |

Decimal provides exact representation of base-10 fractions, making it the correct choice for:

- Currency and monetary values
- Financial calculations requiring exact rounding
- Any domain where `0.1 + 0.2 == 0.3` must hold

```
// Schema
table Transaction {
    amount: decimal
    tax_rate: decimal
}
```

### Fixed-Point Types

ConjureDB provides deterministic binary fixed-point types for game logic that must produce
bit-identical results across platforms (e.g. lockstep simulation, replay verification). Unlike
`float`/`double`, they have no rounding drift.

| Schema Name          | C# Type                        | Size    | Format  | Backing | Notes                    |
|----------------------|--------------------------------|---------|---------|---------|--------------------------|
| `fixed` / `fixed64`  | `ConjureDB.Numerics.Fixed64`   | 8 bytes | Q32.32  | `long`  | 32 integer + 32 fractional bits |
| `fixed32`            | `ConjureDB.Numerics.Fixed32`   | 4 bytes | Q16.16  | `int`   | 16 integer + 16 fractional bits (range ±32,768) |

`fixed` is an alias for the Q32.32 `fixed64` type.

**Literals** use the suffixes `fx` / `fx64` for `Fixed64` and `fx32` for `Fixed32`
(e.g. `10.5fx`, `3fx32`). **C-style and SQL-style casts** accept the targets `fixed`, `fixed64`,
and `fixed32` (e.g. `(fixed)x`, `cast(x as fixed32)`).

Fixed-point types are numeric, but they form their own family: they do **not** implicitly promote
to or from `int`, `float`, `double`, or `decimal`. Converting between fixed-point and other numeric
families requires an explicit cast.

```
// Schema
table PhysicsBody {
    position_x: fixed
    velocity:   fixed32
}
```

### Numeric Promotion Hierarchy

When two numeric values of different types appear in the same expression (comparison, arithmetic,
`CASE` branches), the compiler promotes the narrower type to the wider type according to this
ranking:

| Rank | Types                   |
|------|-------------------------|
| 1    | `byte`, `sbyte`         |
| 2    | `short`, `ushort`       |
| 3    | `int`, `uint`           |
| 4    | `long`, `ulong`         |
| 5    | `float`                 |
| 6    | `double`                |
| 7    | `decimal`               |

The promoted type is the one with the higher rank. The result inherits nullability if either
operand is nullable.

> **Note:** Mixing `decimal` with `float` or `double` in arithmetic or comparison is allowed. Because
> `decimal` is the highest-ranked numeric type, the expression promotes to `decimal` and the
> `float`/`double` operand is coerced to `decimal` automatically — no explicit cast is required.

### Aggregate Type Inference

Aggregate functions infer their result type from the input:

| Input Type               | `sum()` Result | `avg()` Result |
|--------------------------|----------------|----------------|
| Any integer type         | `long`         | `double`       |
| `decimal`                | `decimal`      | `decimal`      |
| `float`                  | `double`       | `double`       |
| `double`                 | `double`       | `double`       |

Nullability rules differ by aggregate. `avg`, `min`, and `max` **always** return a nullable type,
because an empty group yields NULL regardless of input nullability (e.g. `avg(nonnull_int) → double?`).
`sum` preserves its input's nullability (`sum(nullable_int) → long?`, `sum(nonnull_int) → long`), and
`count` always returns a non-nullable `long`.

---

## Boolean Type

| Schema Name | C# Type          | Size   | Values         |
|-------------|------------------|--------|----------------|
| `bool`      | `System.Boolean` | 1 byte | `true`, `false`|

### Three-Valued Logic

When a boolean value is nullable (`bool?`), comparisons and logical operators follow SQL-style
**three-valued logic** where the result may be `true`, `false`, or `null` (unknown).

**AND truth table:**

| `a`     | `b`     | `a AND b` |
|---------|---------|-----------|
| `true`  | `true`  | `true`    |
| `true`  | `false` | `false`   |
| `true`  | `null`  | `null`    |
| `false` | `true`  | `false`   |
| `false` | `false` | `false`   |
| `false` | `null`  | `false`   |
| `null`  | `true`  | `null`    |
| `null`  | `false` | `false`   |
| `null`  | `null`  | `null`    |

**OR truth table:**

| `a`     | `b`     | `a OR b` |
|---------|---------|----------|
| `true`  | `true`  | `true`   |
| `true`  | `false` | `true`   |
| `true`  | `null`  | `true`   |
| `false` | `true`  | `true`   |
| `false` | `false` | `false`  |
| `false` | `null`  | `null`   |
| `null`  | `true`  | `true`   |
| `null`  | `false` | `null`   |
| `null`  | `null`  | `null`   |

**NOT truth table:**

| `a`     | `NOT a` |
|---------|---------|
| `true`  | `false` |
| `false` | `true`  |
| `null`  | `null`  |

> **Note:** In `filter` clauses, `null` is treated as `false` — rows where the condition evaluates
> to `null` are excluded, consistent with SQL `WHERE` semantics.

---

## Character and String Types

### Char

| Schema Name | C# Type        | Size    | Description                  |
|-------------|----------------|---------|------------------------------|
| `char`      | `System.Char`  | 2 bytes | Single UTF-16 code unit      |

`char` can be implicitly converted to `string`. In practice, `string` is preferred for most
use cases.

### String

| Schema Name | C# Type         | Size     | Max Length                | Nullability       |
|-------------|-----------------|----------|---------------------------|--------------------|
| `string`    | `System.String` | Variable | ~2 GB (runtime limit)     | Reference type — inherently nullable |

Strings are **reference types** and therefore inherently nullable. Appending `?` in schema
definitions is accepted for clarity but is not required.

**String comparison:** Ordinal comparison by default. String comparisons in queries use
`StringComparison.Ordinal` semantics.

**String operations in queries:**

| Function        | Signature                         | Description                          |
|-----------------|-----------------------------------|--------------------------------------|
| `length(s)`     | `(string) → int`                  | Character count                      |
| `upper(s)`      | `(string) → string`               | Convert to uppercase                 |
| `lower(s)`      | `(string) → string`               | Convert to lowercase                 |
| `trim(s)`       | `(string) → string`               | Remove leading/trailing whitespace   |
| `contains(s,t)` | `(string, string) → bool?`        | Substring search                     |
| `startswith(s,t)`| `(string, string) → bool?`       | Prefix check                         |
| `endswith(s,t)` | `(string, string) → bool?`        | Suffix check                         |
| `substring(s,i)`| `(string, int) → string`          | Extract from position                |
| `substring(s,i,n)` | `(string, int, int) → string`  | Extract with length                  |
| `replace(s,old,new)` | `(string, string, string) → string` | Replace occurrences           |
| `concat(a,b,…)` | `(string, string, …) → string`   | Concatenate strings                  |
| `indexof(s,t)`  | `(string, string) → int?`         | Find position of substring           |

> **See:** [Custom Functions](/docs/query-language/functions) for the complete function reference.

**String concatenation type:** The `+` operator with at least one string operand produces `string`.
If both operands are unknown/null, the result type is unknown.

---

## Temporal Types

ConjureDB supports five temporal types covering dates, times, time zones, and durations.

| Schema Name        | C# Type                  | Size     | Description                              | Availability |
|--------------------|--------------------------|----------|------------------------------------------|--------------|
| `datetime`         | `System.DateTime`        | 8 bytes  | Date and time (no time zone)             | All runtimes |
| `datetimeoffset`   | `System.DateTimeOffset`  | 10 bytes | Date, time, and UTC offset               | All runtimes |
| `dateonly`         | `System.DateOnly`        | 4 bytes  | Date without time component              | .NET 6+      |
| `timeonly`         | `System.TimeOnly`        | 8 bytes  | Time of day without date                 | .NET 6+      |
| `timespan`         | `System.TimeSpan`        | 8 bytes  | Duration / elapsed time interval         | All runtimes |

### DateTime

Represents a date and time without time zone information. The internal representation stores ticks
(100-nanosecond intervals since 0001-01-01 00:00:00).

```
// Schema
table Event {
    created_at: datetime
    updated_at: datetime?
}

// Query
from Event | filter created_at > @2024-01-01
```

### DateTimeOffset

Represents a date, time, and UTC offset. Use this type when you need to preserve the original time
zone context of a timestamp.

```
// Schema
table AuditLog {
    timestamp: datetimeoffset
}
```

### DateOnly and TimeOnly

Available on .NET 6 and later. `DateOnly` stores a calendar date without a time component;
`TimeOnly` stores a time of day without a date.

```
// Schema
table Schedule {
    day: dateonly
    start_time: timeonly
    end_time: timeonly
}
```

### TimeSpan

Represents a duration or time interval. Commonly used for cooldowns, session lengths, and elapsed
time calculations.

```
// Schema
table Session {
    duration: timespan
    idle_timeout: timespan?
}
```

### Temporal Type Compatibility

Temporal types are **not interchangeable**. Comparisons and promotions require both operands to be
the same temporal type. There is no implicit conversion between `DateTime` and `DateTimeOffset`, or
between `DateOnly` and `DateTime`.

| Operation         | Requirement                              |
|-------------------|------------------------------------------|
| `a == b`          | Same temporal type                       |
| `a > b`           | Same temporal type                       |
| `CASE` branches   | All branches must be same temporal type   |

---

## Binary Type

| Schema Name | C# Type         | Size     | Description                          | Nullability       |
|-------------|-----------------|----------|--------------------------------------|--------------------|
| `binary`    | `System.Byte[]` | Variable | Arbitrary binary data                | Reference type — inherently nullable |

Binary data is stored as byte arrays. Like `string`, `binary` is a reference type and is
inherently nullable.

**Use cases:**
- Serialized protocol buffers or MessagePack payloads
- Image thumbnails or small binary assets
- Cryptographic hashes or signatures

**Fixed-length constraints:** The type system supports fixed-length binary constraints through
`TypeConstraints`. Two binary values are equality-comparable only when their fixed-length
constraints are compatible (both unconstrained, or same length).

```
// Schema
table Asset {
    data: binary
    hash: binary       // e.g., SHA-256 digest
}
```

---

## Identifier Types

### Guid

| Schema Name | C# Type        | Size     | Format                                      |
|-------------|----------------|----------|----------------------------------------------|
| `guid`      | `System.Guid`  | 16 bytes | 128-bit universally unique identifier        |

Guids support **equality** and **ordering** comparisons. They can be implicitly converted to
`string` and explicitly converted back from `string`.

```
// Schema
table Player {
    id: guid @id
    session_id: guid?
}

// Query
from Player | filter id == cast('550e8400-e29b-41d4-a716-446655440000' as guid)
```

---

## Nullable Types

Any value type can be made nullable by appending `?` to the type name. Reference types (`string`,
`binary`) are inherently nullable and do not require the `?` suffix (though it is accepted for
clarity).

### Syntax

```
// Schema definition
table Player {
    name: string          // Reference type — already nullable
    guild_id: int?        // Nullable value type → Nullable<int>
    score: float?         // Nullable value type → Nullable<float>
    last_login: datetime? // Nullable value type → Nullable<DateTime>
}
```

### NULL Semantics in Comparisons

Comparisons involving `null` follow SQL semantics:

| Expression       | Result  | Explanation                          |
|------------------|---------|--------------------------------------|
| `null == null`   | `null`  | Unknown equals unknown is unknown    |
| `null == 42`     | `null`  | Unknown equals known is unknown      |
| `null != 42`     | `null`  | Unknown not-equals known is unknown  |
| `null > 42`      | `null`  | Cannot order unknown values          |
| `null + 42`      | `null`  | Arithmetic with null propagates null |

### Null Handling Operators and Functions

| Syntax                          | Description                                    |
|---------------------------------|------------------------------------------------|
| `coalesce(a, b)`                | Returns `a` if non-null, else `b`              |
| `is_null(expr)`                 | Returns `true` if expression is null            |
| `is_not_null(expr)`             | Returns `true` if expression is not null        |

```
// Query — filter out null values
from Player | filter is_not_null(guild_id)

// Query — provide default
from Player | select coalesce(guild_id, 0) as effective_guild
```

### Nullability Propagation

The compiler propagates nullability through expressions:

| Operation                       | Result Nullability                              |
|---------------------------------|-------------------------------------------------|
| Non-null `op` non-null          | Non-nullable                                    |
| Nullable `op` anything          | Nullable                                        |
| Anything `op` nullable          | Nullable                                        |
| `CASE` without `ELSE`           | Always nullable                                 |
| `CASE` with any nullable branch | Nullable                                        |
| Comparison (any operands)       | `bool?` if either operand is nullable            |
| Logical AND/OR                  | `bool?` if either operand is nullable, else `bool` |

---

## Enum Types

Enumerations define a fixed set of named constants backed by an integer type.

### Schema Definition

```
// Simple enum (default backing type: int)
enum PlayerStatus {
    Active = 0
    Banned = 1
    Inactive = 2
}

// Enum used in a table
table Player {
    status: PlayerStatus
    role: PlayerRole?      // Nullable enum
}
```

### Backing Types

Enums can be backed by any integer scalar type. The backing type is determined by the enum
definition and affects storage size:

| Backing Type | Size    | Range          |
|--------------|---------|----------------|
| `byte`       | 1 byte  | 0–255          |
| `sbyte`      | 1 byte  | −128–127       |
| `short`      | 2 bytes | −32,768–32,767 |
| `ushort`     | 2 bytes | 0–65,535       |
| `int`        | 4 bytes | Full int range |
| `uint`       | 4 bytes | Full uint range|
| `long`       | 8 bytes | Full long range|
| `ulong`      | 8 bytes | Full ulong range|

### Enum Type Compatibility

| Operation                | Allowed?     | Notes                                     |
|--------------------------|--------------|-------------------------------------------|
| Enum == Enum (same type) | ✅ Yes       | Direct comparison                         |
| Enum == underlying int   | ✅ Yes       | Enum compared to its backing type          |
| Enum == different Enum   | ❌ No        | Different enum types are not comparable    |
| Cast enum ↔ backing type | ✅ Explicit  | `(int)status` or `(PlayerStatus)0`        |

```
// Query — filter by enum value
from Player | filter status == PlayerStatus.Active

// Query — cast to underlying type
from Player | select (int)status as status_code
```

### Flags Enums

Flags enums allow bitwise combinations of values. Each value should be a power of two:

```
enum Permissions {
    None = 0
    Read = 1
    Write = 2
    Execute = 4
    All = 7
}
```

---

## Collection Types

ConjureDB supports several collection kinds, but **mutable collections are prohibited** in entity
definitions. Only immutable/read-only collections are allowed.

### Collection Kinds

| Kind                 | C# Type                       | Mutable? | Allowed in Entities? |
|----------------------|-------------------------------|----------|----------------------|
| **Array**            | `T[]`                         | Fixed    | ✅ Yes               |
| **ReadOnlyList**     | `IReadOnlyList<T>`            | No       | ✅ Yes (preferred)   |
| **ReadOnlyCollection** | `IReadOnlyCollection<T>`   | No       | ✅ Yes               |
| **Sequence**         | `IEnumerable<T>`              | No       | ✅ Yes               |
| **List**             | `List<T>`                     | Yes      | ❌ Disallowed        |
| **Collection**       | `ICollection<T>`              | Yes      | ❌ Disallowed        |
| **Set**              | `ISet<T>`                     | Yes      | ❌ Disallowed        |

> **Design rationale:** Mutable collections are forbidden in entity types because entities are
> stored in indexed structures where mutation could violate index consistency. The compiler throws
> `InvalidOperationException` if a mutable collection kind is used.

### Schema Syntax

```
// Array syntax
table Player {
    scores: int[]              // generates: int[]
    tags: string[]             // generates: string[]
}

// List syntax (generates IReadOnlyList<T>)
table Player {
    inventory: list<int>       // generates: IReadOnlyList<int>
    friends: list<string>      // generates: IReadOnlyList<string>
}

// Nullable collection
table Player {
    items: list<string>?       // generates: IReadOnlyList<string>?
}
```

**Default initialization:** Collection fields are initialized with `Array.Empty<T>()` by default,
avoiding null reference issues.

### Collection Type Promotion

When two collections appear in the same expression (e.g., `CASE` branches), the compiler checks:

1. Element types must be compatible (via standard type promotion rules)
2. Collection kinds must be the same or resolvable
3. Fixed-length constraints (if any) must match

---

## Composite Types

### Struct Types (Value Semantics)

Structs are value types with named members. They are defined using the `type` keyword in schema
files.

```
// Schema definition
type Address {
    city: string
    country: string
    zip: string?
}

// Used as a field
table Player {
    home_address: Address
    work_address: Address?
}
```

**Characteristics:**
- Copied by value when assigned
- Compared by structural equality (all members must match)
- Cannot be `null` unless explicitly nullable (`Address?`)
- No navigation properties or identity

### Class Types (Reference Semantics)

Classes are reference types defined using the `table` keyword. They serve as the primary entity
types in ConjureDB.

```
// Schema definition
table Player {
    id: int @id
    name: string
    level: int
}
```

**Characteristics:**
- Reference semantics — identity-based comparison
- Inherently nullable (reference types)
- Support primary keys and indexes
- Can have navigation properties to other tables

### Composite Type Compatibility

Two composite types are compatible if they are the **exact same type** (by full name). There is no
structural subtyping — two types with identical member layouts but different names are not
interchangeable.

If both types have CLR type information available, .NET assignability rules are also checked
(e.g., a derived class is assignable to its base class).

---

## Extern Types

Extern types allow referencing types defined outside the ConjureDB schema, such as Unity types or
custom game types.

### Inline Extern

```
// Direct extern reference
table Player {
    position: extern Vector3
    rotation: extern Quaternion?
    view: extern Game.Contracts.PlayerView
}
```

### Extern Type Aliases

Top-level aliases map short names to fully qualified types:

```
// Alias declarations
extern type Vector3 = UnityEngine.Vector3
extern type Quaternion = UnityEngine.Quaternion
extern type GeoPoint = Game.Contracts.GeoPoint

// Usage with alias
table Player {
    position: Vector3
    spawn: Vector3?
    data: GeoPoint[]
}
```

Extern types are resolved as an opaque `Class` type with the specified full name and no inspectable
members. They participate in limited type checking — the compiler tracks them for consistency (using
nominal, exact-name compatibility) but cannot inspect their members.

---

## Type Coercion and Conversion

### Implicit Conversions

Implicit conversions are applied automatically by the compiler when types are mixed in expressions.
No cast syntax is required.

| Source Type     | Target Type   | Direction    | Notes                           |
|-----------------|---------------|-------------|---------------------------------|
| `byte`          | `short`       | Widening    | Unsigned 8-bit → signed 16-bit  |
| `byte`          | `int`         | Widening    | 8-bit → 32-bit                  |
| `byte`          | `long`        | Widening    | 8-bit → 64-bit                  |
| `sbyte`         | `short`       | Widening    | Signed 8-bit → signed 16-bit    |
| `sbyte`         | `int`         | Widening    | 8-bit → 32-bit                  |
| `sbyte`         | `long`        | Widening    | 8-bit → 64-bit                  |
| `short`         | `int`         | Widening    | 16-bit → 32-bit                 |
| `short`         | `long`        | Widening    | 16-bit → 64-bit                 |
| `ushort`        | `int`         | Widening    | Unsigned 16-bit → signed 32-bit |
| `ushort`        | `uint`        | Widening    | Unsigned 16-bit → unsigned 32-bit|
| `ushort`        | `long`        | Widening    | 16-bit → 64-bit                 |
| `int`           | `long`        | Widening    | 32-bit → 64-bit                 |
| `uint`          | `long`        | Widening    | Unsigned 32-bit → signed 64-bit |
| `uint`          | `ulong`       | Widening    | Unsigned 32-bit → unsigned 64-bit|
| `float`         | `double`      | Widening    | IEEE 754 single → double        |
| `char`          | `string`      | Expansion   | Single character → string       |
| `guid`          | `string`      | Formatting  | GUID → string representation    |
| Non-null `T`    | `T?`          | Nullability | Value → nullable wrapper        |

**General rule:** A numeric conversion is implicit whenever both operands are numeric and
`rank(source) ≤ rank(target)` in the numeric promotion hierarchy — spanning the integer,
floating-point, and `decimal` families. Because the rule uses `≤` (not strictly `<`), same-rank
cross-sign pairs (`int` ↔ `uint`, `byte` ↔ `sbyte`, `short` ↔ `ushort`, `long` ↔ `ulong`) are
implicit in both directions. Only rank-decreasing conversions (e.g. `long → int`, `double → float`,
`decimal → double`) require an explicit cast. (Fixed-point types are excluded — see
[Fixed-Point Types](#fixed-point-types).)

### Explicit Casts

Explicit casts require cast syntax and may fail at runtime if the value is out of range.

**C-style syntax:**
```
from Player | select (long)score
from Player | select (int)status
```

**SQL-style syntax:**
```
from Player | select cast(score as long)
from Player | select cast(status as int)
```

> **See:** [Query Language — Type Casting](/docs/query-language/reference#type-casting) for detailed syntax.

### Explicit Conversion Rules

| Source Type     | Target Type   | Notes                                        |
|-----------------|---------------|----------------------------------------------|
| Any numeric     | Any numeric   | Narrowing allowed (may lose data)            |
| `enum`          | Backing type  | Extract underlying integer value              |
| Backing type    | `enum`        | Assign integer to enum (unchecked)            |
| `string`        | `guid`        | Parse GUID from string representation        |
| `guid`          | `string`      | Format GUID as string (also implicit)        |

### Type Conversion Functions

For runtime conversions that may fail, use conversion functions instead of casts:

| Function       | Signature                           | Description                            |
|----------------|-------------------------------------|----------------------------------------|
| `to_string(x)` | `(any) → string?`                  | Convert any value to its string form   |
| `to_int(x)`    | `(string\|double\|long\|float\|decimal) → int?`    | Parse/convert to integer               |
| `to_long(x)`   | `(string\|int\|double\|float\|decimal) → long?`    | Parse/convert to long                  |
| `to_double(x)` | `(string\|int\|long\|float\|decimal) → double?`    | Parse/convert to double                |

> **See:** [Custom Functions — Type Conversion](/docs/query-language/functions#type-conversion-functions) for
> details.

---

## Type Comparison Matrix

This matrix shows which type conversions are supported and in what mode.

**Legend:** ✅ Implicit · 🔶 Explicit · ❌ Unsupported · ➖ Same type

### Numeric Conversions

| From ↓ \ To → | `sbyte` | `byte` | `short` | `ushort` | `int`  | `uint`  | `long` | `ulong` | `float` | `double` | `decimal` |
|----------------|---------|--------|---------|----------|--------|---------|--------|---------|---------|----------|-----------|
| `sbyte`        | ➖      | ✅     | ✅      | ✅       | ✅     | ✅      | ✅     | ✅      | ✅      | ✅       | ✅        |
| `byte`         | ✅      | ➖     | ✅      | ✅       | ✅     | ✅      | ✅     | ✅      | ✅      | ✅       | ✅        |
| `short`        | 🔶      | 🔶     | ➖      | ✅       | ✅     | ✅      | ✅     | ✅      | ✅      | ✅       | ✅        |
| `ushort`       | 🔶      | 🔶     | ✅      | ➖       | ✅     | ✅      | ✅     | ✅      | ✅      | ✅       | ✅        |
| `int`          | 🔶      | 🔶     | 🔶      | 🔶       | ➖     | ✅      | ✅     | ✅      | ✅      | ✅       | ✅        |
| `uint`         | 🔶      | 🔶     | 🔶      | 🔶       | ✅     | ➖      | ✅     | ✅      | ✅      | ✅       | ✅        |
| `long`         | 🔶      | 🔶     | 🔶      | 🔶       | 🔶     | 🔶      | ➖     | ✅      | ✅      | ✅       | ✅        |
| `ulong`        | 🔶      | 🔶     | 🔶      | 🔶       | 🔶     | 🔶      | ✅     | ➖      | ✅      | ✅       | ✅        |
| `float`        | 🔶      | 🔶     | 🔶      | 🔶       | 🔶     | 🔶      | 🔶     | 🔶      | ➖      | ✅       | ✅        |
| `double`       | 🔶      | 🔶     | 🔶      | 🔶       | 🔶     | 🔶      | 🔶     | 🔶      | 🔶      | ➖       | ✅        |
| `decimal`      | 🔶      | 🔶     | 🔶      | 🔶       | 🔶     | 🔶      | 🔶     | 🔶      | 🔶      | 🔶       | ➖        |

### Cross-Category Conversions

| From ↓ \ To → | `string` | `bool` | `guid` | `datetime` | `enum` |
|----------------|----------|--------|--------|------------|--------|
| `string`       | ➖       | ❌     | 🔶     | ❌         | ❌     |
| `bool`         | ❌       | ➖     | ❌     | ❌         | ❌     |
| `guid`         | ✅       | ❌     | ➖     | ❌         | ❌     |
| `char`         | ✅       | ❌     | ❌     | ❌         | ❌     |
| `datetime`     | ❌       | ❌     | ❌     | ➖         | ❌     |
| `enum`         | ❌       | ❌     | ❌     | ❌         | 🔶¹    |
| Numeric        | ❌       | ❌     | ❌     | ❌         | 🔶²    |

¹ Explicit cast between enum and its backing integer type only.
² Numeric → enum requires the numeric type to match the enum's backing type.

---

## Equality and Ordering Support

Not all types support all comparison operations. This table summarizes which operations are
valid for each type family.

| Type Family    | `==` / `!=` | `<` / `>` / `<=` / `>=` | Notes                                    |
|----------------|-------------|--------------------------|------------------------------------------|
| Integer types  | ✅          | ✅                       | Cross-type comparison with promotion     |
| Floating-point | ✅          | ✅                       | Cross-type comparison with promotion     |
| `decimal`      | ✅          | ✅                       | Mixes with float/double; promotes to decimal |
| `bool`         | ✅          | ❌                       | Equality only                            |
| `string`       | ✅          | ✅                       | Ordinal comparison                       |
| `char`         | ✅          | ✅                       | Compatible with string for equality      |
| `datetime`     | ✅          | ✅                       | Same temporal type required              |
| `datetimeoffset` | ✅        | ✅                       | Same temporal type required              |
| `dateonly`     | ✅          | ✅                       | Same temporal type required              |
| `timeonly`     | ✅          | ✅                       | Same temporal type required              |
| `timespan`     | ✅          | ✅                       | Same temporal type required              |
| `guid`         | ✅          | ✅                       | Byte-order comparison                    |
| `binary`       | ✅          | ❌                       | Fixed-length constraints must match      |
| Enum           | ✅          | ❌                       | Same enum type or enum ↔ backing type    |
| Collection     | ✅          | ❌                       | Element types must be compatible         |
| Struct/Class   | ✅          | ❌                       | Same type required                       |

---

## Schema Type Names vs C# Names

Quick reference for mapping between schema file syntax, C# types, and the internal type system.

| Schema (`.conjure`) | C# Type                 | ScalarKind          | Type Family | Value Type? |
|---------------------|-------------------------|---------------------|-------------|-------------|
| `sbyte`²            | `System.SByte`          | `SByte`             | Numeric     | Yes         |
| `byte`              | `System.Byte`           | `Byte`              | Numeric     | Yes         |
| `short`             | `System.Int16`          | `Int16`             | Numeric     | Yes         |
| `ushort`²           | `System.UInt16`         | `UInt16`            | Numeric     | Yes         |
| `int`               | `System.Int32`          | `Int32`             | Numeric     | Yes         |
| `uint`              | `System.UInt32`         | `UInt32`            | Numeric     | Yes         |
| `long`              | `System.Int64`          | `Int64`             | Numeric     | Yes         |
| `ulong`             | `System.UInt64`         | `UInt64`            | Numeric     | Yes         |
| `float`             | `System.Single`         | `Single`            | Numeric     | Yes         |
| `double`            | `System.Double`         | `Double`            | Numeric     | Yes         |
| `decimal`           | `System.Decimal`        | `Decimal`           | Numeric     | Yes         |
| `fixed` / `fixed64` | `ConjureDB.Numerics.Fixed64` | `Fixed64`      | Numeric     | Yes         |
| `fixed32`           | `ConjureDB.Numerics.Fixed32` | `Fixed32`      | Numeric     | Yes         |
| `bool`              | `System.Boolean`        | `Boolean`           | Boolean     | Yes         |
| `char`              | `System.Char`           | `Char`              | String      | Yes         |
| `string`            | `System.String`         | `String`            | String      | No          |
| `datetime`          | `System.DateTime`       | `DateTime`          | Temporal    | Yes         |
| `datetimeoffset`    | `System.DateTimeOffset` | `DateTimeOffset`    | Temporal    | Yes         |
| `dateonly`          | `System.DateOnly`       | `DateOnly`          | Temporal    | Yes         |
| `timeonly`          | `System.TimeOnly`       | `TimeOnly`          | Temporal    | Yes         |
| `timespan`          | `System.TimeSpan`       | `TimeSpan`          | Temporal    | Yes         |
| `guid`              | `System.Guid`           | `Guid`              | Guid        | Yes         |
| `binary`            | `System.Byte[]`         | `Binary`            | Binary      | No          |
| `T[]`               | `T[]`                   | —                   | Collection  | No          |
| `list<T>`           | `IReadOnlyList<T>`      | —                   | Collection  | No          |
| `T?`                | `Nullable<T>`           | —                   | —           | Yes¹        |

¹ `T?` for value types creates `Nullable<T>` (still a value type). For reference types, `?`
is a nullability annotation only.

² `sbyte` and `ushort` are usable only as [enum backing types](#backing-types), not as field or
scalar types.

---

## Type Families

Type families group related types for compatibility checking. Two types from different families
are generally incompatible unless an explicit exception applies.

| Family         | Member Types                                                        |
|----------------|---------------------------------------------------------------------|
| **Numeric**    | `sbyte`, `byte`, `short`, `ushort`, `int`, `uint`, `long`, `ulong`, `float`, `double`, `decimal` |
| **String**     | `string`, `char`                                                    |
| **Temporal**   | `datetime`, `datetimeoffset`, `dateonly`, `timeonly`, `timespan`     |
| **Boolean**    | `bool`                                                              |
| **Binary**     | `binary` (`byte[]`)                                                 |
| **Guid**       | `guid`                                                              |
| **Collection** | `T[]`, `list<T>`, and other collection kinds                        |
| **Dictionary** | Map types with key and value descriptors (`IReadOnlyDictionary<K, V>`) |
| **Object**     | Struct/class types without a specific family                        |
| **Unknown**    | Unresolved / external placeholder (compatible with all types)        |
| **Null**       | NULL literals (no type — compatible with all nullable types)        |
| **Error**      | Type errors (compatible with all types to prevent cascading errors)  |

### Cross-Family Compatibility

The only cross-family implicit conversion is:

| Source Family | Target Family | Direction        |
|---------------|---------------|------------------|
| Guid          | String        | Implicit (→)     |
| String        | Guid          | Explicit only    |

All other cross-family conversions are unsupported by the type system.

---

## CASE Expression Type Resolution

`CASE` (or `if`/`else` in DSL syntax) expressions require the compiler to find a common type
across all branches. The algorithm:

1. **Ignore** null literals and unknown types.
2. **Pair** all remaining branch types and check `AreCompatible`.
3. **Promote** to the widest compatible type.
4. **Nullability:** The result is nullable if:
   - There is no `ELSE` branch (missing branch implies possible null), or
   - Any branch type is nullable.
5. **Error:** If any two branch types are incompatible, the expression is a type error.

```
// All branches numeric — result promoted to long
from Player | select case
    when level < 10 then (short)1
    when level < 50 then 2
    else (long)3
end

// Missing ELSE — result is int? (nullable)
from Player | select case
    when level > 50 then level
end
```

---

## Type Descriptor Internals

This section is for contributors and advanced users who need to understand the internal type
representation.

### TypeDescriptor Properties

| Property           | Type                                 | Description                                |
|--------------------|--------------------------------------|--------------------------------------------|
| `Category`         | `TypeCategory`                       | Unknown, Scalar, Struct, Class, Enum, Collection, Dictionary, Nullable, Error |
| `ScalarKind`       | `ScalarKind`                         | Specific scalar (valid when Category == Scalar) |
| `FullName`         | `string?`                            | CLR type name (composite/enum types)       |
| `IsValueType`      | `bool`                               | True for struct, enum, scalar (except String, Binary, Object) |
| `Members`          | `ImmutableArray<MemberDescriptor>`   | Named members (composite types only)       |
| `ElementType`      | `TypeDescriptor?`                    | Element type (collections only)            |
| `UnderlyingType`   | `TypeDescriptor?`                    | Inner type (Nullable) or backing type (Enum)|
| `EnumValues`       | `ImmutableArray<EnumValueDescriptor>` | Enum constants (enums only)               |
| `Constraints`      | `TypeConstraints?`                   | Fixed length, collection kind              |
| `ClrType`          | `Type?`                              | Cached CLR reflection type                 |

### Query Methods

| Method               | Returns   | Description                                           |
|----------------------|-----------|-------------------------------------------------------|
| `IsScalar`           | `bool`    | Category == Scalar                                    |
| `IsComposite`        | `bool`    | Category is Struct or Class                           |
| `IsCollection`       | `bool`    | Category == Collection                                |
| `IsEnum`             | `bool`    | Category == Enum                                      |
| `IsNullable`         | `bool`    | Category == Nullable OR IsReferenceType               |
| `IsNullableValueType`| `bool`    | Category == Nullable (Nullable\<T\> wrapper)          |
| `IsReferenceType`    | `bool`    | !IsValueType                                          |
| `CoreType`           | `TypeDescriptor` | Self, or unwraps Nullable\<T\> → T               |
| `IsInteger`          | `bool`    | Any of the 8 integer ScalarKinds                      |
| `IsFloatingPoint`    | `bool`    | Single, Double, or Decimal                            |
| `IsNumeric`          | `bool`    | IsInteger OR IsFloatingPoint                          |
| `IsTemporal`         | `bool`    | Any of the 5 temporal ScalarKinds                     |
| `IsBinary`           | `bool`    | ScalarKind == Binary                                  |
| `CollectionKind`     | `CollectionKind` | From Constraints (collections only)              |
| `FixedLength`        | `int?`    | From Constraints (binary/collections)                 |

### Factory Methods

```csharp
// Scalar singletons
TypeDescriptor.Scalar(ScalarKind.Int32)         // → cached Int32 singleton
TypeDescriptor.FromScalarKind(ScalarKind.String) // → cached String singleton

// Composite types
TypeDescriptor.Struct("MyApp.Address", members)
TypeDescriptor.Class("MyApp.Player", members)

// Enums
TypeDescriptor.Enum("MyApp.Status", ScalarKind.Int32, enumValues)

// Collections
TypeDescriptor.Collection(elementType, fullName, constraints)

// Nullable wrapper
TypeDescriptor.NullableOf(TypeDescriptor.Int32)  // → cached NullableInt32

// From CLR reflection
TypeDescriptor.FromClrType(typeof(int))          // → cached Int32

// Parse type name string
TypeDescriptor.ParseTypeName("int?")             // → NullableInt32
TypeDescriptor.ParseTypeName("int[]")            // → Collection<Int32>
TypeDescriptor.ParseTypeName("IReadOnlyList<int>") // → Collection<Int32, ReadOnlyList>
// Note: mutable container names such as "List<int>" throw InvalidOperationException.
```

---

## Summary of Type Categories

```
┌─────────────────────────────────────────────────────────────┐
│                     TypeDescriptor                          │
├─────────────┬───────────────────────────────────────────────┤
│  Scalar     │ SByte, Byte, Int16, UInt16, Int32, UInt32,   │
│             │ Int64, UInt64, Single, Double, Decimal,       │
│             │ Fixed64, Fixed32, Boolean, Char, String,      │
│             │ DateTime, DateTimeOffset, DateOnly, TimeOnly, │
│             │ TimeSpan, Guid, Binary, Object                │
├─────────────┼───────────────────────────────────────────────┤
│  Struct     │ User-defined value types (type keyword)       │
├─────────────┼───────────────────────────────────────────────┤
│  Class      │ Entity types (table keyword)                  │
├─────────────┼───────────────────────────────────────────────┤
│  Enum       │ Named constants with integer backing type     │
├─────────────┼───────────────────────────────────────────────┤
│  Collection │ Array, ReadOnlyList, ReadOnlyCollection,      │
│             │ Sequence (mutable kinds disallowed)            │
├─────────────┼───────────────────────────────────────────────┤
│  Dictionary │ Map types (key + value descriptors)           │
├─────────────┼───────────────────────────────────────────────┤
│  Nullable   │ Nullable<T> wrapper for value types           │
├─────────────┼───────────────────────────────────────────────┤
│  Unknown    │ Unresolved / external placeholder             │
├─────────────┼───────────────────────────────────────────────┤
│  Error      │ Sentinel — compatible with all types          │
└─────────────┴───────────────────────────────────────────────┘
```

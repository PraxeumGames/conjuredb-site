# Expressions and Operators

Complete reference for value expressions, operators, type coercion rules, and built-in functions
in the ConjureDB query language.

> **Cross-references**
>
> - [QueryLanguage.md](/docs/query-language/reference) — pipeline transforms (`filter`, `derive`, `select`, …)
>   that *consume* expressions.
> - [CustomFunctions.md](/docs/query-language/functions) — defining your own C# functions callable from queries.

---

## 1  Lexical Structure

### 1.1  Identifiers

Identifiers name columns, table aliases, and user-defined functions.

```
Name        Age        user_id        _hidden
```

**Rules**

| Rule | Detail |
|------|--------|
| First character | Letter (`a-z`, `A-Z`) or underscore (`_`) |
| Subsequent | Letters, digits (`0-9`), underscores |
| Case sensitivity | Identifiers are **case-sensitive** at the parser level; function lookup is **case-insensitive** |
| Quoting | Not supported — there is no backtick or bracket quoting mechanism |

### 1.2  Reserved Words

The following words are treated as **keywords** by the lexer and cannot be used as bare
identifiers in most positions:

```
from    select   filter   derive   group   aggregate  sort    take    skip
join    left     right    inner    full    semi       anti    window  loop
union   remove   intersect except  and     or         not     null    true
false   in       as       switch   cast    sum        count   avg     average
min     max      distinct asc      desc    version    like    is      by
frame   between  let      into     with    update     delete  insert  upsert
set     values   assert   returning
```

When a keyword is followed by `(` and is not in the *structural* set (e.g. `count`, `sum`,
`avg`, `min`, `max`), the parser treats it as a **function call**.

### 1.3  Literals

#### 1.3.1  Numeric Literals

| Form | Example | Notes |
|------|---------|-------|
| Integer | `42`, `0`, `100` | Parsed as `int` by default |
| Long | `42L` | Suffix `L` forces `long` |
| Float | `3.14F` | Suffix `F` forces `float` |
| Double | `3.14`, `3.14D` | Decimal point without suffix → `double`; suffix `D` explicit |
| Decimal | `3.14M` | Suffix `M` forces `decimal` |
| Scientific | `1E10`, `2.5e-3` | Exponent with optional sign |

**Restrictions**

- Leading decimal point is **not allowed**: write `0.5`, not `.5`.
- Trailing decimal point is **not allowed**: write `3.0`, not `3.`.
- Multiple decimal points produce a hard error.
- Hexadecimal (`0x`) is **not supported**.

#### 1.3.2  String Literals

Strings are delimited by single quotes (`'…'`) or double quotes (`"…"`).

```
"hello world"
'it''s escaped'       -- SQL-style doubled quote
"line\nbreak"         -- C-style backslash escape
```

**Escape sequences**

| Escape | Meaning |
|--------|---------|
| `\n` | Newline (U+000A) |
| `\r` | Carriage return (U+000D) |
| `\t` | Tab (U+0009) |
| `\\` | Backslash |
| `\'` | Single quote |
| `\"` | Double quote |
| `\0` | Null character (U+0000) |
| `\uXXXX` | Unicode code point (4 hex digits) |

Both SQL-style quote doubling (`''` inside `'…'`, `""` inside `"…"`) and
C-style backslash escapes are supported simultaneously.

#### 1.3.3  Boolean Literals

```
true    false
```

Case-insensitive keywords.

#### 1.3.4  Null Literal

```
null
```

Case-insensitive keyword. Represents the absence of a value; participates in
three-valued logic (see [§8 NULL Handling](#8--null-handling)).

#### 1.3.5  Temporal Literals

Temporal literals use the `@` prefix to distinguish them from parameters.

| Kind | Syntax | Example |
|------|--------|---------|
| Date | `@YYYY-MM-DD` | `@2025-01-15` |
| Time | `@THH:MM[:SS[.fff]]` | `@T14:30`, `@T14:30:00.500` |
| Timestamp | `@YYYY-MM-DDTHH:MM[:SS[.fff]]` | `@2025-01-15T14:30:00` |
| Interval | `@P…` (ISO 8601 duration) | `@P2DT3H`, `@PT30M`, `@P1Y6M` |

Date/time validation is strict: `@2025-02-30` produces a lexer error.

### 1.4  Comments

```
# This is a line comment — extends to end of line
```

The language uses `#` for line comments. Block comments (`/* … */`) are **not supported**.

### 1.5  Parameters

External values are referenced with the `@` prefix followed by an identifier:

```
@minAge    @userName    @threshold
```

**Rules**

- Parameter names follow identifier rules (letter/underscore start, alphanumeric body).
- Parameter names **cannot** start with a digit (e.g. `@1` is invalid).
- Parameter names cannot be empty (`@` alone is invalid).
- When the character after `@` looks like a temporal literal (digit sequence matching
  `YYYY-MM-DD`, `T` + digit, or `P` + digit/T), it is parsed as a temporal literal
  instead of a parameter.
- Parameter types are inferred from usage context during binding.

### 1.6  Operators (Lexical Tokens)

The following single- and multi-character operator tokens are recognized:

| Token | Description |
|-------|-------------|
| `+` `-` `*` `/` `%` | Arithmetic |
| `==` `!=` `<>` | Equality / inequality |
| `<` `>` `<=` `>=` | Ordering |
| `&&` `\|\|` | Logical (symbolic form) |
| `??` | Null coalescing |
| `=>` | Switch arm separator |
| `!` | Logical NOT (symbolic form) |
| `?` `.` | Null-conditional access (`?.`) |
| `:` | Used internally |

**Invalid operator sequences** produce explicit lexer errors:

| Input | Error |
|-------|-------|
| `===` | "Use `==` for equality comparison" |
| `><` | "Invalid operator" |

---

## 2  Value Expressions

### 2.1  Column References

**Simple reference** — refers to a column in the current scope:

```
Name
Age
user_id
```

**Qualified reference** — disambiguates across joined tables using a table alias:

```
u.Name
o.Total
u.Profile.Address.City
```

**Null-conditional access** — safe navigation for nullable nested properties:

```
u.Profile?.Address?.City
```

Dot-separated paths of arbitrary depth are supported. During binding, each segment
is resolved against the schema of the preceding segment.

### 2.2  Operator Invocations

**Unary operators** — prefix position:

```
-Amount            # arithmetic negation
not IsActive       # logical negation
!IsActive          # logical negation (symbolic)
```

**Binary operators** — infix position between two sub-expressions:

```
Price * Quantity
Age >= 18 and IsActive
Name ?? "Unknown"
```

See [§3 Operator Precedence](#3--operator-precedence) for full evaluation order.

### 2.3  Function Calls

Standard parenthesized syntax:

```
length(Name)
substring(Name, 0, 5)
round(Price, 2)
```

**Bare-prefix syntax** — for common unary functions, parentheses may be omitted
when the argument is a single column reference:

```
len u.Name          # equivalent to length(u.Name)
lower u.Name        # equivalent to lower(u.Name)
upper Status        # equivalent to upper(Status)
trim Name           # equivalent to trim(Name)
```

Supported bare-prefix functions: `len`, `length`, `lower`, `upper`, `trim`.

**DISTINCT modifier** (aggregate context only):

```
count(distinct UserId)
```

Currently `distinct` is supported only inside `count(…)`.

**Method-call syntax** — property-style invocation on column references:

```
Name.Contains("text")
Name.StartsWith("A")
Name.EndsWith("son")
```

See [§10 Built-in Functions](#10--built-in-functions) for the complete catalog.

### 2.4  Type Casts

Two syntactic forms are supported; both produce identical AST nodes.

**C-style cast:**

```
(int)Price
(double)Quantity
(string)Code
```

**SQL-style CAST:**

```
cast(Price as int)
cast(Quantity as double)
cast(Code as string)
```

**Supported type names:**

| Name | .NET Type | Aliases |
|------|-----------|---------|
| `int` | `Int32` | `int32` |
| `long` | `Int64` | `int64` |
| `short` | `Int16` | — |
| `byte` | `Byte` | — |
| `float` | `Single` | — |
| `double` | `Double` | — |
| `decimal` | `Decimal` | — |
| `bool` | `Boolean` | `boolean` |
| `string` | `String` | — |

See [§9 Type Coercion](#9--type-coercion-rules) for when explicit casts are required.

### 2.5  Conditional Expressions (Switch)

The `switch` expression is the ConjureDB equivalent of SQL `CASE`. It uses postfix
syntax — the *scrutinee* expression precedes the `switch` keyword:

```
expr switch {
    pattern => result,
    pattern => result,
    _       => default_result
}
```

**Relational patterns** — compare the scrutinee with a relational operator:

```
Age switch {
    >= 65 => "Senior",
    >= 18 => "Adult",
    _     => "Minor"
}
```

**Value patterns** — implicitly use `==`:

```
Status switch {
    "Active"   => 1,
    "Inactive" => 0,
    _          => -1
}
```

**Rules**

- At least one arm is required.
- A default arm (`_ => …`) is **mandatory**.
- Arms are separated by commas; trailing commas are **not allowed**.
- Both `{ }` and `( )` delimiters are accepted.
- Branch result types must be compatible; the compiler infers the common type
  using the CASE type unification rules (see [§9.4](#94--case-expression-type-inference)).

### 2.6  Null Coalescing (`??`)

Returns the left operand if it is not null, otherwise the right operand:

```
MiddleName ?? ""
Price ?? 0.0
u.Nickname ?? u.Name ?? "Anonymous"
```

The `??` operator is left-associative and can be chained.

### 2.7  Subquery Expressions

Subqueries are pipeline expressions enclosed in parentheses:

```
# Scalar subquery
TotalAmount > (from Orders | filter UserId == u.Id | aggregate sum(Amount))

# EXISTS subquery
exists(from Orders | filter UserId == u.Id)

# IN subquery
CategoryId in (from Categories | filter IsActive | select Id)
```

**Scalar subquery** — must return exactly one row and one column. Used wherever
a single value is expected.

**EXISTS subquery** — returns `true` if the inner pipeline produces at least one row.
Must use the `exists(…)` function syntax.

**IN subquery** — tests membership against the single-column result set of the inner
pipeline. See [§7 Set Membership](#7--set-membership).

### 2.8  Collection Navigation

For nested collection properties (e.g. `Orders` on a `User` entity), the language
provides aggregate navigation syntax:

**Method-call style:**

```
u.Orders.Any(o => o.Total > 100)
u.Orders.Count(o => o.Status == "Shipped")
u.Orders.Sum(o => o.Total)
```

**Phrase style:**

```
sum u.Orders (by o.Total)
count u.Orders (where o.Status == "Active")
avg u.Orders (by o.Total, where o.Amount > 0)
```

Supported navigation methods: `any`, `all`, `count`, `sum`, `min`, `max`, `average`/`avg`.

---

## 3  Operator Precedence

Operators are listed from **lowest** to **highest** precedence. Operators at the same
level associate **left-to-right** unless noted otherwise.

| Level | Operator(s) | Associativity | Description |
|------:|-------------|:-------------:|-------------|
| 1 | `or`, `\|\|` | Left | Logical disjunction |
| 2 | `and`, `&&` | Left | Logical conjunction |
| 3 | `==` `!=` `<` `>` `<=` `>=` `is` `in` `like` `between` | Left | Comparison / pattern / set |
| 4 | `??` | Left | Null coalescing |
| 5 | `+` `-` | Left | Additive |
| 6 | `*` `/` `%` | Left | Multiplicative |
| 7 | `not` `!` `-` (unary) | **Right** | Unary negation |
| 8 | `switch` (postfix) | Left | Conditional expression |
| 9 | `(…)` `.` `func()` literals | — | Atomics |

**Parentheses** override precedence at any level:

```
(a + b) * c
(x or y) and z
```

### Precedence Examples

```
# Parsed as: (a + (b * c))
a + b * c

# Parsed as: ((a > 0) and (b < 10))
a > 0 and b < 10

# Parsed as: (Name ?? ("Unknown"))
Name ?? "Unknown"

# Parsed as: (((not a) and b) or c) — NOT binds tighter than AND/OR
not a and b or c
```

---

## 4  Arithmetic Operators

| Operator | Description | Example | Result Type |
|:--------:|-------------|---------|-------------|
| `+` | Addition | `3 + 4` → `7` | Widest numeric operand |
| `-` | Subtraction | `10 - 3` → `7` | Widest numeric operand |
| `*` | Multiplication | `2 * 5` → `10` | Widest numeric operand (with overflow promotion) |
| `/` | Division | `10 / 3` → `3` (integer) | Widest numeric operand |
| `%` | Modulo | `10 % 3` → `1` | Widest numeric operand |
| `-` (unary) | Negation | `-Amount` | Same as operand |

Both operands **must be numeric**. Applying arithmetic to non-numeric types produces
a binding error.

### 4.1  Numeric Promotion Rules

When operands have different numeric types, the compiler promotes both to a common type
following C# widening rules:

| Rank | Type | Notes |
|-----:|------|-------|
| 1 | `byte`, `sbyte` | Widened to `int` for any arithmetic |
| 2 | `short` (`Int16`), `ushort` (`UInt16`) | Widened to `int` for any arithmetic |
| 3 | `int` (`Int32`), `uint` (`UInt32`) | Mixed `int`/`uint` → `long` |
| 4 | `long` (`Int64`), `ulong` (`UInt64`) | — |
| 5 | `float` (`Single`) | — |
| 6 | `double` (`Double`) | — |
| 7 | `decimal` (`Decimal`) | Highest rank |

**Widening direction:** lower rank is promoted to higher rank.

**Sub-int widening:** All types with rank ≤ 2 (`byte`, `sbyte`, `short`, `ushort`)
are widened to `int` (`Int32`) before arithmetic, matching the C# specification.

**Multiplication overflow promotion:** To prevent silent overflow, `int * int` promotes
the result to `long`, and `uint * uint` promotes to `ulong`.

**Mixed signed/unsigned:** `int` + `uint` promotes both to `long`.

### 4.2  Nullability Propagation

If **either** operand is nullable, the result is nullable:

```
# If Price is int? and Quantity is int:
Price * Quantity    -- result type: int? (actually long? due to multiplication promotion)
```

### 4.3  Division Behavior

Integer division truncates toward zero (C# semantics):

```
7 / 2       -- result: 3 (int)
-7 / 2      -- result: -3 (int)
7.0 / 2.0   -- result: 3.5 (double)
```

Division by zero in integer context throws at runtime; floating-point division by zero
produces `Infinity` or `NaN` per IEEE 754.

---

## 5  Comparison Operators

| Operator | Description | SQL Equivalent |
|:--------:|-------------|:--------------:|
| `==` | Equal | `=` |
| `!=` | Not equal | `<>` |
| `<` | Less than | `<` |
| `>` | Greater than | `>` |
| `<=` | Less than or equal | `<=` |
| `>=` | Greater than or equal | `>=` |

### 5.1  Type Compatibility for Comparisons

**Equality** (`==`, `!=`) is supported between:

| Left Type | Right Type | Behavior |
|-----------|-----------|----------|
| Numeric | Numeric | Promote to common type, then compare |
| String/Char | String/Char | Ordinal comparison |
| Boolean | Boolean | Direct comparison |
| Temporal | Temporal (same kind) | Same temporal type required |
| Enum | Enum (same type) | Compare by enum value |
| Enum | Numeric (underlying type) | Compare enum's underlying value |
| Guid | Guid | Direct comparison |
| Collection | Collection | Element-type-compatible check |
| Any nullable | `null` | Null test |

**Ordering** (`<`, `>`, `<=`, `>=`) is supported for types that implement `IComparable`:
numeric, string, char, temporal (same kind), guid, boolean, and enum types.

Cross-family comparisons (e.g. `int == string`) produce a **binding error**.

### 5.2  NULL Comparison Semantics

ConjureDB uses **three-valued logic** for comparisons involving `NULL`:

| Expression | Result |
|------------|--------|
| `NULL == NULL` | `NULL` (not `true`) |
| `NULL != NULL` | `NULL` (not `false`) |
| `42 == NULL` | `NULL` |
| `42 != NULL` | `NULL` |
| `NULL < 10` | `NULL` |
| `NULL >= 0` | `NULL` |

To test for null, use `is null` / `is not null` (see [§8 NULL Handling](#8--null-handling)).

---

## 6  Logical Operators

### 6.1  AND

Keyword form `and` or symbolic form `&&`.

**Truth table** (three-valued logic):

| `a` | `b` | `a and b` |
|:---:|:---:|:---------:|
| `true` | `true` | `true` |
| `true` | `false` | `false` |
| `true` | `NULL` | `NULL` |
| `false` | `true` | `false` |
| `false` | `false` | `false` |
| `false` | `NULL` | `false` |
| `NULL` | `true` | `NULL` |
| `NULL` | `false` | `false` |
| `NULL` | `NULL` | `NULL` |

Key property: `false AND NULL` evaluates to `false` (short-circuit — `false` dominates).

### 6.2  OR

Keyword form `or` or symbolic form `||`.

**Truth table** (three-valued logic):

| `a` | `b` | `a or b` |
|:---:|:---:|:--------:|
| `true` | `true` | `true` |
| `true` | `false` | `true` |
| `true` | `NULL` | `true` |
| `false` | `true` | `true` |
| `false` | `false` | `false` |
| `false` | `NULL` | `NULL` |
| `NULL` | `true` | `true` |
| `NULL` | `false` | `NULL` |
| `NULL` | `NULL` | `NULL` |

Key property: `true OR NULL` evaluates to `true` (short-circuit — `true` dominates).

### 6.3  NOT

Keyword form `not` or symbolic form `!`.

| `a` | `not a` |
|:---:|:-------:|
| `true` | `false` |
| `false` | `true` |
| `NULL` | `NULL` |

**Result type:** `bool` if operand is non-nullable `bool`; `bool?` if operand is
nullable.

### 6.4  Short-Circuit Evaluation

In generated code, `and` and `or` use short-circuit evaluation:

- `a and b` — `b` is not evaluated if `a` is `false`.
- `a or b` — `b` is not evaluated if `a` is `true`.

---

## 7  Set Membership and Pattern Operators

### 7.1  IN / NOT IN

Tests whether a value is a member of a set:

```
# Literal list
Status in ("Active", "Pending", "Review")

# Parameter list
CategoryId in @allowedCategories

# Subquery
UserId in (from Admins | select Id)
```

**NOT IN** — negate with `not`:

```
not (Status in ("Deleted", "Archived"))
```

### 7.2  LIKE

SQL-compatible pattern matching on strings:

```
Name like "A%"           # starts with 'A'
Email like "%@%.com"     # contains '@' and ends with '.com'
Code like "AB_12"        # _ matches exactly one character
```

| Wildcard | Meaning |
|----------|---------|
| `%` | Zero or more characters |
| `_` | Exactly one character |

The `like` operator preserves nullability: if either operand is nullable, the result
is `bool?`.

### 7.3  CONTAINS / STARTSWITH / ENDSWITH

Method-call style string pattern matching:

```
Name.Contains("son")
Name.StartsWith("Dr.")
Email.EndsWith("@example.com")
```

These are resolved as function calls through the function resolution service.

### 7.4  BETWEEN

Range test — inclusive on both ends:

```
Age between 18 and 65
```

Desugared by the parser into:

```
Age >= 18 and Age <= 65
```

The `and` inside `between … and …` is a syntactic separator, not the logical `and`
operator.

### 7.5  IS NULL / IS NOT NULL

Definite null test (see also [§8 NULL Handling](#8--null-handling)):

```
MiddleName is null
Email is not null
```

These always return a definite `bool` (`true` or `false`), never `NULL`.

### 7.6  EXISTS / NOT EXISTS

Tests whether a correlated subquery returns any rows:

```
exists(from Orders | filter UserId == u.Id)
not exists(from Returns | filter OrderId == o.Id)
```

The `exists` keyword is parsed as a function call whose argument is a subquery
pipeline starting with `from`.

---

## 8  NULL Handling

### 8.1  Three-Valued Logic

ConjureDB follows SQL's three-valued logic. Expressions involving `NULL` generally
propagate `NULL` rather than producing `true` or `false`:

| Category | NULL Behavior |
|----------|--------------|
| Arithmetic (`+`, `-`, `*`, `/`, `%`) | Any `NULL` operand → `NULL` result |
| Comparison (`==`, `!=`, `<`, etc.) | Any `NULL` operand → `NULL` result |
| Logical `and` | `false and NULL` → `false`; `true and NULL` → `NULL` |
| Logical `or` | `true or NULL` → `true`; `false or NULL` → `NULL` |
| Logical `not` | `not NULL` → `NULL` |
| String (`like`, `contains`, etc.) | `NULL` operand → `NULL` result |
| `in` | `NULL` element in set → may produce `NULL` |

### 8.2  IS NULL / IS NOT NULL

The only operators that return definite boolean results for `NULL`:

```
value is null       # true if value is NULL, false otherwise
value is not null   # false if value is NULL, true otherwise
```

### 8.3  Null Coalescing (`??`)

Provides a non-null fallback:

```
MiddleName ?? ""                        # "" if MiddleName is NULL
Price ?? DefaultPrice ?? 0              # chained coalescing
```

Bound through the `coalesce` function. The result type is the common type of both
operands; the result is non-nullable if the right operand is non-nullable.

### 8.4  Coalesce Function

Function-call equivalent of `??`:

```
coalesce(MiddleName, "Unknown")
```

### 8.5  IS_NULL / IS_NOT_NULL Functions

Function-call equivalents of the `is null` / `is not null` operators:

```
is_null(value)       # equivalent to: value is null
is_not_null(value)   # equivalent to: value is not null
```

Aliases: `isnull`, `isnotnull`.

---

## 9  Type Coercion Rules

### 9.1  Type Families

Every type belongs to a **type family** that determines compatibility:

| Family | Types |
|--------|-------|
| Numeric | `byte`, `sbyte`, `short`, `ushort`, `int`, `uint`, `long`, `ulong`, `float`, `double`, `decimal` |
| String | `string`, `char` |
| Boolean | `bool` |
| Temporal | `DateTime`, `DateTimeOffset`, `DateOnly`, `TimeOnly`, `TimeSpan` |
| Guid | `Guid` |
| Binary | `byte[]` (with optional fixed length) |
| Object | User-defined structs, classes, enums |
| Collection | `T[]`, `List<T>`, `IReadOnlyList<T>`, etc. |
| Null | The `null` literal (compatible with any nullable type) |
| Error | Error types (compatible with everything to prevent cascading errors) |

**Cross-family compatibility:** Types in different families are generally **incompatible**,
with these exceptions:

- `Guid` ↔ `String` — bidirectional compatibility, promoted to `string`.
- `Unknown` family — compatible with any family for propagation.
- `Null` — compatible with any nullable type.
- `Error` — compatible with everything.

### 9.2  Implicit Widening

Implicit conversions happen automatically when the compiler can guarantee no data loss:

| Source | Target | Condition |
|--------|--------|-----------|
| Numeric | Numeric | Source rank ≤ target rank (see [§4.1](#41--numeric-promotion-rules)) |
| `char` | `string` | Always |
| `Guid` | `string` | Always |
| Non-nullable `T` | `Nullable<T>` | Always |

**Examples:**

```
# int → long (implicit)
from Users | derive BigId = (long)0 + Id

# byte → int (implicit in arithmetic)
from Sensors | filter Reading + 10 > Threshold
```

### 9.3  Explicit Casting

Explicit casts are required when the conversion may lose data or change representation:

```
(int)Price          # double → int: truncation possible
cast(Code as int)   # string → int: parse may fail
```

**Explicit conversion matrix:**

| Source → Target | Allowed |
|-----------------|:-------:|
| Numeric → Numeric | ✓ (any direction) |
| Enum → Numeric (underlying type) | ✓ |
| Numeric → Enum (underlying type) | ✓ |
| Guid → String | ✓ |
| String → Guid | ✓ |
| Other cross-family | ✗ |

### 9.4  CASE Expression Type Inference

When a `switch` expression has branches with different types, the compiler unifies
them using pairwise promotion:

1. Collect concrete (non-null, non-unknown) types from all branches.
2. Promote pairwise using `AreCompatible` (numeric promotion, temporal matching, etc.).
3. If any branch is `null` or nullable, the result is nullable.
4. If there is no `else` arm (default `_`), the result is nullable.
5. If branches have incompatible families, a binding error is produced.

```
# int and long branches → long result
x switch {
    > 100 => (long)1,
    _     => 0            # promoted to long
}
```

### 9.5  Aggregate Result Type Inference

| Aggregate | Input Type | Result Type |
|-----------|-----------|-------------|
| `count` | Any | `int` (never nullable) |
| `sum` | Integer types | `long` (nullable if input is nullable) |
| `sum` | `float`, `double` | `double` (nullable if input is nullable) |
| `sum` | `decimal` | `decimal` (nullable if input is nullable) |
| `avg` | Any numeric | `double?` |
| `min`, `max` | Any orderable | Same as input (nullable if input is nullable) |

### 9.6  Conversion Functions

For conversions that require runtime parsing or formatting, use the built-in
conversion functions:

```
to_int("42")           # string → int?
to_double("3.14")      # string → double?
to_long("100000")      # string → long?
to_string(42)          # int → string?
```

See [Functions Reference](/docs/query-language/functions#scalar-functions) for the conversion-function catalog.

---

## 10  Built-in Functions

> **See also:** [CustomFunctions.md](/docs/query-language/functions) for defining your own functions.

Function names are **case-insensitive**. Aliases are listed in parentheses.

### 10.1  Scalar Function Catalog

The complete signature catalog for the built-in **String**, **Math**, **Date/Time**,
**Type Conversion**, and **Null Handling** scalar functions lives in the canonical
functions reference: [Functions Reference](/docs/query-language/functions#scalar-functions).

Semantic notes specific to expression evaluation:

- Type conversion functions (`to_string`, `to_int`, `to_double`, `to_long`) return
  **nullable** types — they return `null` if the conversion fails at runtime rather
  than throwing.
- `date_trunc` accepts the units `"year"`, `"month"`, `"day"`, `"hour"`, `"minute"`,
  and `"second"`.
- For the evaluation semantics of the null-handling functions and operators
  (`coalesce`/`??`, `is_null`, `is_not_null`), see [§8 NULL Handling](#8--null-handling);
  for type-coercion rules see [§9 Type Coercion](#9--type-coercion-rules).

### 10.6  Spatial Functions

Spatial functions test geometric relationships between entity coordinates and query regions. When used in `filter`, the compiler plans a spatial index scan instead of a full table scan (requires a declared `SpatialGrid` index on the referenced coordinate columns).

| Function | Signature (2D) | Signature (3D) | Description |
|----------|-----------------|-----------------|-------------|
| `within_radius` | `(entityX, entityY, centerX, centerY, radius: float) → bool` | `(entityX, entityY, entityZ, centerX, centerY, centerZ, radius: float) → bool` | `true` if entity is within Euclidean radius of center |
| `within_bounds` | `(entityX, entityY, minX, minY, maxX, maxY: float) → bool` | `(entityX, entityY, entityZ, minX, minY, minZ, maxX, maxY, maxZ: float) → bool` | `true` if entity is inside axis-aligned bounding box |
| `distance` | `(x1, y1, x2, y2: float) → float` | `(x1, y1, z1, x2, y2, z2: float) → float` | Euclidean distance between two points |

**Notes:**

- `within_radius` and `within_bounds` are designed as **filter predicates** — the compiler recognizes them and rewrites the plan to use a `SpatialGrid` index when one is available.
- `distance` is a scalar expression usable in `select`, `derive`, `sort`, and `filter`. It does **not** trigger spatial index selection by itself.
- All distance calculations use **Euclidean distance** (`√(Σ(aᵢ − bᵢ)²)`). Geodesic, Manhattan, and Chebyshev distances are not supported.

**Examples:**

```
// Radius query — entities within 100 units of a point
from GameObjects
| filter within_radius(PosX, PosY, @cx, @cy, 100.0)
| select Name, PosX, PosY

// Bounding box query
from GameObjects
| filter within_bounds(PosX, PosY, 0.0, 0.0, 500.0, 500.0)

// Distance as a computed column
from GameObjects
| derive Dist = distance(PosX, PosY, @targetX, @targetY)
| sort Dist
| take 10

// 3D radius query
from GameObjects
| filter within_radius(PosX, PosY, PosZ, @cx, @cy, @cz, @radius)
```

---

## 11  Aggregate Expressions

Aggregate functions operate on sets of rows and produce a single result per group.
They are valid only inside `aggregate` transforms or in `derive`/`select` with an
implicit group context.

### 11.1  Standard Aggregates

| Function | Aliases | Description | DISTINCT | Result |
|----------|---------|-------------|:--------:|--------|
| `count()` | — | Count all rows | — | `long` (never null) |
| `count(expr)` | — | Count non-null values | ✓ | `long` (never null) |
| `sum(expr)` | — | Sum of values | ✓ | `long` / `double` / `decimal` |
| `avg(expr)` | `average` | Arithmetic mean | ✓ | `double?` |
| `min(expr)` | — | Minimum value | ✓ | Same as input |
| `max(expr)` | — | Maximum value | ✓ | Same as input |
| `first(expr)` | — | First value in group | — | Same as input |
| `last(expr)` | — | Last value in group | — | Same as input |

### 11.2  Boolean and Bitwise Aggregates

| Function | Aliases | Description |
|----------|---------|-------------|
| `any()` | — | True if group is non-empty (0-arity) |
| `any(expr)` | — | True if any value is truthy |
| `all(expr)` | — | True if all values are truthy |
| `bool_and(expr)` | `booland` | Logical AND across all values |
| `bool_or(expr)` | `boolor` | Logical OR across all values |
| `bit_and(expr)` | `bitand` | Bitwise AND across all values |
| `bit_or(expr)` | `bitor` | Bitwise OR across all values |

### 11.3  Statistical Aggregates

| Function | Aliases | Description |
|----------|---------|-------------|
| `stddev(expr)` | `stdev`, `std_dev` | Sample standard deviation |
| `stddev_pop(expr)` | `stdevpop`, `stdev_pop` | Population standard deviation |
| `variance(expr)` | — | Sample variance |
| `var_pop(expr)` | `varpop`, `variance_pop`, `variancepop` | Population variance |

### 11.4  Collection Aggregate

| Function | Aliases | Description |
|----------|---------|-------------|
| `array_agg(expr)` | `arrayagg` | Collect values into an array |

### 11.5  DISTINCT Modifier

Use `distinct` inside `count` to count only unique values:

```
from Orders
| aggregate UniqueCustomers = count(distinct CustomerId)
```

Currently, `distinct` is supported only for `count(…)`. Using `distinct` with other
aggregates produces a parse error.

### 11.6  Nested Aggregate Prohibition

Aggregates **cannot** be nested:

```
# ERROR: nested aggregate
avg(sum(Amount))
```

The compiler detects nested aggregates during binding and produces a diagnostic error.

**Examples:**

```
from Orders
| group CustomerId (
    aggregate {
        OrderCount = count(),
        TotalSpent = sum(Amount),
        AvgOrder   = avg(Amount),
        FirstOrder = min(OrderDate),
        LastOrder  = max(OrderDate)
    }
)
```

---

## 12  Window Expressions

Window functions compute values across a set of rows related to the current row,
without collapsing groups.

### 12.1  Syntax

```
function(args) | window (
    partition_by Column1, Column2
    sort Column3
    frame between N preceding and M following
)
```

Window expressions are specified through the `window` pipeline transform.

### 12.2  Ranking Functions

| Function | Signature | Requires ORDER BY | Description |
|----------|-----------|:-----------------:|-------------|
| `row_number()` | `() → int` | ✓ | Sequential number within partition |
| `rank()` | `() → int` | ✓ | Rank with gaps for ties |
| `dense_rank()` | `() → int` | ✓ | Rank without gaps |
| `ntile(n)` | `(n: int) → int` | ✓ | Bucket number (1 to n) |

### 12.3  Navigation Functions

| Function | Signature | Requires ORDER BY | Description |
|----------|-----------|:-----------------:|-------------|
| `lag(expr)` | `(col) → nullable type` | ✓ | Value from previous row |
| `lag(expr, offset)` | `(col, n: int) → nullable type` | ✓ | Value from n rows before |
| `lead(expr)` | `(col) → nullable type` | ✓ | Value from next row |
| `lead(expr, offset)` | `(col, n: int) → nullable type` | ✓ | Value from n rows after |
| `first_value(expr)` | `(col) → nullable type` | ✓ | First value in frame |
| `last_value(expr)` | `(col) → nullable type` | ✓ | Last value in frame |

`lag` and `lead` always return nullable types since there may be no row at the
specified offset.

### 12.4  Windowed Aggregates

The following aggregates can also be used as window functions:

| Function | Signature | Description |
|----------|-----------|-------------|
| `count()` | `() → int` | Count rows in frame |
| `count(expr)` | `(col) → int` | Count non-null values in frame |
| `sum(expr)` | `(col) → numeric?` | Running/windowed sum |
| `avg(expr)` | `(col) → double?` | Running/windowed average |
| `min(expr)` | `(col) → nullable type` | Minimum in frame |
| `max(expr)` | `(col) → nullable type` | Maximum in frame |

### 12.5  Frame Specification

The frame clause defines the subset of partition rows used for computation:

```
frame between <start> and <end>
```

| Bound | Meaning |
|-------|---------|
| `N preceding` | N rows before current |
| `current row` | The current row |
| `N following` | N rows after current |
| `unbounded preceding` | First row of partition |
| `unbounded following` | Last row of partition |

**Example — 3-row moving average:**

```
from Sales
| window (
    partition_by Region
    sort SaleDate
    frame between 1 preceding and 1 following
    derive MovingAvg = avg(Amount)
)
```

---

## 13  Expression Evaluation Order

### 13.1  Short-Circuit Evaluation

Logical operators use short-circuit evaluation in generated code:

- `a and b` — if `a` is `false`, `b` is **not evaluated**.
- `a or b` — if `a` is `true`, `b` is **not evaluated**.

This means side-effect-free expressions in `b` may be skipped entirely.

### 13.2  Aggregate vs. Scalar Context

Expressions are evaluated in one of two contexts:

| Context | Description | Example |
|---------|-------------|---------|
| Scalar | Per-row evaluation | `filter Age > 18` |
| Aggregate | Per-group evaluation | `aggregate Total = sum(Amount)` |

Mixing contexts is an error:

```
# ERROR: scalar column in aggregate context without aggregation
from Orders | aggregate Total = sum(Amount) + CustomerId
```

### 13.3  Operator Evaluation

Within a single expression, evaluation follows:

1. **Parentheses** — innermost first.
2. **Precedence** — higher-precedence operators bind tighter (see [§3](#3--operator-precedence)).
3. **Associativity** — left-to-right for most binary operators; right-to-left for unary.
4. **Short-circuit** — for `and`/`or` only.

### 13.4  Determinism

Function volatility affects optimization:

| Category | Meaning | Examples |
|----------|---------|---------|
| Immutable | Same inputs always produce same output | `length()`, `round()`, `abs()` |
| Stable | May return different values across transactions | `now()`, `utcnow()` |

The compiler uses volatility information to determine whether expressions can be
folded at compile time, cached, or reordered.

---

## Appendix A: Complete Operator Quick Reference

| Operator | Type | Operands | Result | NULL Propagation |
|:--------:|------|----------|--------|:----------------:|
| `+` | Arithmetic | numeric, numeric | numeric | Yes |
| `-` | Arithmetic | numeric, numeric | numeric | Yes |
| `*` | Arithmetic | numeric, numeric | numeric | Yes |
| `/` | Arithmetic | numeric, numeric | numeric | Yes |
| `%` | Arithmetic | numeric, numeric | numeric | Yes |
| `-` (unary) | Arithmetic | numeric | numeric | Yes |
| `==` | Comparison | compatible | bool | Yes → NULL |
| `!=` | Comparison | compatible | bool | Yes → NULL |
| `<` | Comparison | orderable | bool | Yes → NULL |
| `>` | Comparison | orderable | bool | Yes → NULL |
| `<=` | Comparison | orderable | bool | Yes → NULL |
| `>=` | Comparison | orderable | bool | Yes → NULL |
| `and` / `&&` | Logical | bool, bool | bool | Partial (see truth table) |
| `or` / `\|\|` | Logical | bool, bool | bool | Partial (see truth table) |
| `not` / `!` | Logical | bool | bool | Yes |
| `??` | Null coalescing | T?, T | T | Special (returns non-null) |
| `is null` | Null test | any | bool | Never (always definite) |
| `is not null` | Null test | any | bool | Never (always definite) |
| `in` | Set membership | T, set of T | bool | Yes |
| `like` | Pattern | string, string | bool | Yes |
| `between` | Range | orderable | bool | Desugared to `>=` and `<=` |

---

## Appendix B: Numeric Type Promotion Matrix

The table shows the result type when combining two numeric operands with an arithmetic
or comparison operator. Read as: `result = promote(row, column)`.

| | `byte` | `short` | `int` | `long` | `float` | `double` | `decimal` |
|-----------|:------:|:-------:|:-----:|:------:|:-------:|:--------:|:---------:|
| **`byte`** | int | int | int | long | float | double | decimal |
| **`short`** | int | int | int | long | float | double | decimal |
| **`int`** | int | int | int | long | float | double | decimal |
| **`long`** | long | long | long | long | float | double | decimal |
| **`float`** | float | float | float | float | float | double | — |
| **`double`** | double | double | double | double | double | double | — |
| **`decimal`** | decimal | decimal | decimal | decimal | — | — | decimal |

> **Note:** `byte` and `short` types are widened to `int` for all arithmetic
> operations. The `int` entries in those rows reflect the post-widening result type.
> For multiplication specifically, `int × int → long` and `uint × uint → ulong`
> to prevent overflow.

---

## Appendix C: Type Family Compatibility Matrix

| | Numeric | String | Boolean | Temporal | Guid | Binary | Object | Collection | Null |
|------------|:-------:|:------:|:-------:|:--------:|:----:|:------:|:------:|:----------:|:----:|
| **Numeric** | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ |
| **String** | ✗ | ✓ | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ | ✓ |
| **Boolean** | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ |
| **Temporal** | ✗ | ✗ | ✗ | ✓¹ | ✗ | ✗ | ✗ | ✗ | ✓ |
| **Guid** | ✗ | ✓ | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ | ✓ |
| **Binary** | ✗ | ✗ | ✗ | ✗ | ✗ | ✓² | ✗ | ✗ | ✓ |
| **Object** | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓³ | ✗ | ✓ |
| **Collection** | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓⁴ | ✓ |
| **Null** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

¹ Temporal types must be the **same kind** (`DateTime` ↔ `DateTime`, not `DateTime` ↔ `TimeSpan`).
² Binary types require compatible fixed-length constraints.
³ Object types require class hierarchy compatibility (`IsAssignableFrom`).
⁴ Collection types require compatible element types and collection kinds.

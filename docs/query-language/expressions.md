# Expressions and Operators

Complete reference for value expressions, operators, type coercion rules, and built-in functions
in the ConjureDB query language.

> **Source format**: current canonical `.conjure` syntax (owning format marker `2`)

Expression-only blocks illustrate syntax in an existing typed scope. Blocks
labelled `dsl` are query-body fragments: declare their input tables, fields,
parameters, and result signatures in the containing schema. For example,
`Players.GuildId` and `Players.DeletedAt` below are nullable fields; `Users.Id`
is an integer; `Sensors.Reading` is a byte and `Threshold` is numeric. Window
examples assume `Sales` has `Region: string`, `SaleDate: datetime`, and
`Amount: decimal`. These names are examples, not built-in tables.

> **Cross-references**
>
> - [Query Language](/docs/query-language/reference) — pipeline transforms (`filter`, `derive`, `select`, …)
>   that *consume* expressions.
> - [Custom Functions](/docs/query-language/functions) — scalar built-ins, schema functions, and host C# function declarations.

---

## 1  Lexical Structure

### 1.1  Identifiers

Identifiers name columns, table aliases, and user-defined functions.

```text
Name        Age        user_id        _hidden
```

**Rules**

| Rule | Detail |
|------|--------|
| First character | Letter (`a-z`, `A-Z`) or underscore (`_`) |
| Subsequent | Letters, digits (`0-9`), underscores |
| Case sensitivity | Identifier references require exact declared spelling; case-only sibling declarations are forbidden |
| Quoting | Not supported — there is no backtick or bracket quoting mechanism |

### 1.2  Reserved Words

Keywords use their lowercase spelling (`from`, `filter`, `true`, `null`). Many
words are contextual identifiers rather than a globally reserved list. Their
admission as a field, alias, or function name depends on the grammar position.
Write identifiers exactly as declared. A case-only mismatch is an error, not
an alternative spelling; its diagnostic names the actual declaration.

### 1.3  Literals

#### 1.3.1  Numeric Literals

| Form | Example | Notes |
|------|---------|-------|
| Integer | `42`, `0`, `100` | The first of `int`, `uint`, `long`, `ulong` that holds the value |
| Unsigned | `7u`, `7UL` | Suffix `u` → `uint` (or `ulong` when larger); `UL` → `ulong` |
| Long | `42L` | Suffix `L` → `long` (or `ulong` when larger) |
| Float | `3.14f` | Suffix `f` forces `float` |
| Double | `3.14`, `3.14d` | Decimal point without suffix → `double`; suffix `d` explicit |
| Decimal | `3.14m` | Suffix `m` forces `decimal` |
| Scientific | `1E10`, `2.5e-3` | Exponent with optional sign |

**Restrictions**

- Leading decimal point is **not allowed**: write `0.5`, not `.5`.
- Trailing decimal point is **not allowed**: write `3.0`, not `3.`.
- Multiple decimal points produce a hard error.
- Hexadecimal (`0x`) is **not supported**.

#### 1.3.2  String Literals

`.conjure` strings use double quotes (`"…"`). Single-quoted SQL
strings are not schema-source literals.

```text
"hello world"
"it's escaped"       // A single quote is ordinary text inside a double-quoted string.
"line\nbreak"        // Backslash escape.
```

**Escape sequences**

| Escape | Meaning |
|--------|---------|
| `\n` | Newline (U+000A) |
| `\r` | Carriage return (U+000D) |
| `\t` | Tab (U+0009) |
| `\\` | Backslash |
| `\"` | Double quote |

An unrecognized backslash escape produces a lexer warning and retains the
backslash and following character; SQL-style quote doubling is not an escape.

#### 1.3.3  Boolean Literals

```text
true    false
```

Use the lowercase keywords `true` and `false`.

#### 1.3.4  Null Literal

```text
null
```

Use lowercase `null`. Represents the absence of a value. `NULL` remains a
data value; boolean expressions use the two-valued rules in [§8 NULL Handling](#8--null-handling).

#### 1.3.5  Temporal Literals

Construct date/time values with `datetime(...)`, and write durations with their
unit suffixes. The old `@` date/time spellings are not canonical source.

```text
datetime(2025, 1, 15)
5s
100ms
1h + 30min
```

The `@` prefix in an expression identifies a declared query parameter, not a
date literal. See [Data Types](/docs/query-language/data-types) for temporal carriers and arithmetic.

### 1.4  Comments

```text
// This is a line comment — extends to end of line
```

`.conjure` uses `//` for line comments. `#` and block comments
(`/* … */`) are **not supported**.

### 1.5  Parameters

External values are referenced with the `@` prefix followed by an identifier:

```text
@minAge    @userName    @threshold
```

**Rules**

- Parameter names follow identifier rules (letter/underscore start, alphanumeric body).
- Parameter names **cannot** start with a digit (e.g. `@1` is invalid).
- Parameter names cannot be empty (`@` alone is invalid).
- Query parameters are declared with types in the `query Name(name: Type)` header;
  body references use `@name`. Declaration annotations such as `@planning(...)`
  are metadata, not expression parameters.

### 1.6  Operators (Lexical Tokens)

The following single- and multi-character operator tokens are recognized:

| Token | Description |
|-------|-------------|
| `+` `-` `*` `/` `%` | Arithmetic |
| `==` `!=` | Equality / inequality |
| `<` `>` `<=` `>=` | Ordering |
| `&&` `\|\|` `!` | Boolean operations |
| `??` | Null coalescing |
| `=>` | Switch arm separator |
| `?` `.` | Null-conditional access (`?.`) |
| `?` `:` | Conditional expression (`condition ? yes : no`); `:` also separates typed fields |
| `..` | Range bounds, for example `Level in 10..20` |
| `=` | Assignment or named projection/record field; not comparison |

**Invalid operator sequences** produce explicit lexer errors:

| Input | Error |
|-------|-------|
| `===` | "Use `==` for equality comparison" |
| `><` | "Invalid operator" |

---

## 2  Value Expressions

### 2.1  Column References

**Simple reference** — refers to a column in the current scope:

```text
Name
Age
user_id
```

**Qualified reference** — disambiguates across joined tables using a table alias:

```text
u.Name
o.Total
u.Profile.Address.City
```

**Null-conditional access** — safe navigation for nullable nested properties:

```text
u.Profile?.Address?.City
```

Dot-separated paths of arbitrary depth are supported. During binding, each segment
is resolved against the schema of the preceding segment.

### 2.2  Operator Invocations

**Unary operators** — prefix position:

```text
-Amount            // arithmetic negation
!IsActive       // logical negation
```

**Binary operators** — infix position between two sub-expressions:

```text
Price * Quantity
Age >= 18 && IsActive
Name ?? "Unknown"
```

See [§3 Operator Precedence](#3--operator-precedence) for full evaluation order.

### 2.3  Function Calls

Use the catalog's module-qualified scalar names:

```text
text.length(Name)
text.substring(Name, 0, 5)
math.round(Price, 2)
text.lower(u.Name)
text.contains(Name, "text")
```

Arguments may be positional or use the selected overload's parameter names.
Function admission checks actual types and arity, not spelling alone. Scalar
`math.min(a, b)` is not the row aggregate `min(value)`.

In aggregate context, distinct counting is `count_distinct(UserId)`, not
`count(distinct UserId)`. Collection lambdas and instance-style calls are not
substitutes for nested pipelines. See [§10 Built-in Functions](#10--built-in-functions)
and [Functions Reference](/docs/query-language/functions).

### 2.4  Type Casts

Write an explicit conversion as `expression as type`:

```text
Price as int
Quantity as double
Code as string
```

Use canonical source type names, including `int`, `long`, `float`, `double`,
`decimal`, `bool`, `string`, `datetime`, `timespan`, `guid`, `fixed32`, and
`fixed64`. CLR aliases such as `Int32` and `Boolean` are not source aliases.
A syntactically valid cast still requires a supported source/target conversion.
`cast(expression as Type)` is retired. See [§9 Type Coercion](#9--type-coercion-rules).

### 2.5  Conditional Expressions (Switch)

For a two-way choice, use `condition ? whenTrue : whenFalse`.

The `switch` expression is the ConjureDB equivalent of SQL `CASE`. It uses postfix
syntax — the *scrutinee* expression precedes the `switch` keyword:

```text
expr switch {
    pattern => result,
    pattern => result,
    _       => default_result
}
```

**Relational patterns** — compare the scrutinee with a relational operator:

```text
Age switch {
    >= 65 => "Senior",
    >= 18 => "Adult",
    _     => "Minor"
}
```

**Value patterns** — implicitly use `==`:

```text
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
- Switch arms use `{ }` delimiters.
- Branch result types must be compatible; the compiler infers the common type
  using the CASE type unification rules (see [§9.4](#94--case-expression-type-inference)).

### 2.6  Null Coalescing (`??`)

Returns the left operand if it is not null, otherwise the right operand:

```text
MiddleName ?? ""
Price ?? 0.0
u.Nickname ?? u.Name ?? "Anonymous"
```

The `??` operator is right-associative, as in C#, and can be chained: `a ?? b ?? c` is `a ?? (b ?? c)`.

### 2.7  Subquery Expressions

Subqueries are parenthesized pipelines. These expression fragments assume an
outer alias `u`, an `Orders` table with `UserId` and `Amount`, and a `Categories`
table with `Id` and `IsActive`:

```text
TotalAmount > (from Orders o | filter o.UserId == u.Id | aggregate sum(o.Amount))
exists(from Orders o | filter o.UserId == u.Id)
CategoryId in (from Categories c | filter c.IsActive | select c.Id)
```

One unnamed aggregate supplies a scalar reduction, with the aggregate's actual
nullable result contract. A scalar selection requires a suitable scalar terminal
and cardinality; an arbitrary multirow selection is not implicitly one value.
`exists(pipeline)` or `(pipeline | any)` tests whether there is a row.
Membership consumes the selected scalar values. Correlated aliases stay local
to the enclosing query scope. See [Query Language](/docs/query-language/reference#nested-pipelines-and-existence).

### 2.8  Collection Navigation

Navigate only relationships actually declared by the schema. Use the navigation
as a nested pipeline source, with an explicit alias for child fields:

```text
exists(from u.Orders o | filter o.Total > 100)
(from u.Orders o | filter o.Status == "Shipped" | aggregate count())
(from u.Orders o | aggregate sum(o.Total))
```

An all-rows condition can be expressed as absence of a violating row, for example
`!exists(from u.Orders o | filter !(o.Total > 100))`. This is vacuously true
for an empty collection. Choose the null predicate deliberately: negating a
comparison includes its two-valued null behavior.

Collection projections use a nested pipeline directly. Lambda navigation such
as `Orders.Sum(o => o.Total)` and aggregate phrases such as `sum Orders (by Total)`
are retired, not alternate forms of scalar function calls.

---

## 3  Operator Precedence

Operators are listed from **lowest** to **highest** precedence. Operators at the same
level associate **left-to-right** unless noted otherwise.

| Level | Operator(s) | Associativity | Description |
|------:|-------------|:-------------:|-------------|
| 1 | `? :` | Right | Conditional expression |
| 2 | `??` | Right | Null coalescing |
| 3 | `\|\|` | Left | Logical disjunction |
| 4 | `&&` | Left | Logical conjunction |
| 5 | `==` `!=` | Not chainable | Equality |
| 6 | `<` `>` `<=` `>=` `in` `not in` `like` | Not chainable | Ordering, pattern, membership |
| 7 | `..` | Not chainable | Range bounds |
| 8 | `+` `-` | Left | Additive |
| 9 | `*` `/` `%` | Left | Multiplicative |
| 10 | `as type` | Left | Explicit conversion |
| 11 | `!` `-` (unary) | Right | Unary operators |
| 12 | `switch`, calls, member/index access, `(…)`, literals | — | Primary/postfix expressions |

Comparisons and ranges cannot be chained. Write `(a < b) && (b < c)`, not
`a < b < c`. A cast applies to its operand; parenthesize a compound expression
before casting its result.

**Parentheses** override precedence at any level:

```text
(a + b) * c
(x || y) && z
```

### Precedence Examples

```text
// Parsed as: (a + (b * c))
a + b * c

// Parsed as: ((a > 0) && (b < 10))
a > 0 && b < 10

// Parsed as: (Name ?? ("Unknown"))
Name ?? "Unknown"

// Parsed as: (((!a) && b) || c) — ! binds tighter than &&/||
!a && b || c
```

---

## 4  Arithmetic Operators

| Operator | Description | Example | Result Type |
|:--------:|-------------|---------|-------------|
| `+` | Addition | `3 + 4` → `7` | Selected common numeric carrier |
| `-` | Subtraction | `10 - 3` → `7` | Selected common numeric carrier |
| `*` | Multiplication | `2 * 5` → `10` | Selected common numeric carrier |
| `/` | Division | `10 / 3` → `3` (integer) | Selected common numeric carrier |
| `%` | Modulo | `10 % 3` → `1` | Selected common numeric carrier |
| `-` (unary) | Negation | `-Amount` | Same as operand |

These are the numeric forms. Other typed operations, such as compatible
date/time and duration addition, have their own contracts; see
[Data Types](/docs/query-language/data-types#temporal-types). Arbitrary cross-family arithmetic is
not admitted.

### 4.1  Numeric Promotion Rules

Numeric promotion depends on both carriers, signedness, and the operation; it
is not a single rank in which decimal always wins.

- Sub-`int` integral operands widen to `int` for binary arithmetic.
- Mixed `int` and `uint` use `long`.
- A signed integral operand and `ulong` have no common integral carrier.
- Integral operands can meet a supported floating-point or decimal carrier.
  This does not guarantee exact floating-point representation of every integer.
- `float` can widen to `double`; decimal and binary floating point do not mix
  implicitly.
- `fixed32` can widen to `fixed64`; fixed-point and ordinary numeric carriers
  do not silently mix in arithmetic.

`int * int` remains `int`, and `uint * uint` remains `uint`: multiplication is
not an automatic overflow-widening operation. Integral overflow follows the
selected checked/unchecked contract. Cast an operand before multiplication when
a wider result is intended, for example `(Quantity as long) * UnitCount`.
See [Data Types](/docs/query-language/data-types#numeric-promotion-hierarchy).

### 4.2  Nullability Propagation

If **either** operand is nullable, the result is nullable:

```text
// If Price is int? and Quantity is int:
Price * Quantity    // nullable numeric result; the promoted type depends on both operands
```

### 4.3  Division Behavior

Integer division truncates toward zero (C# semantics):

```text
7 / 2       // result: 3 (int)
-7 / 2      // result: -3 (int)
7.0 / 2.0   // result: 3.5 (double)
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

**Ordering** (`<`, `>`, `<=`, `>=`) requires an admitted ordered pair: for example,
compatible numerics, strings/chars, the same temporal kind, or GUIDs. A CLR type
implementing `IComparable` does not by itself grant DSL ordering support.
Boolean values are not a numeric ordering domain.

Cross-family comparisons (e.g. `int == string`) produce a **binding error**.

### 5.2  NULL Comparison Semantics

Two rules govern comparisons involving `NULL`, and they must be read together.

**Rule 1 — comparing against the `null` literal is a null test.**

`expr == null` tests absence; `expr != null` tests presence. Each produces a
definite `bool`, including in a projection. Use these spellings rather than the
retired SQL-style `is null` / `is not null` forms.

```conjure
from Players | filter GuildId != null
```

```conjure
from Players | select IsLive = (DeletedAt != null)
```

The same tests work with the literal on the left. A nonnullable present value
is never absent.

**Rule 2 — every other comparison is two-valued.** A comparison whose operands are
values (not the `null` literal) is `false` when either operand is `NULL`, in every
context:

| Expression | Result |
|------------|--------|
| `nullableA == nullableB` (both absent) | `false` |
| `nullableA != nullableB` (both absent) | `false` |
| `nullableA == nullableB` (either is `NULL`) | `false` |
| `NULL < 10` | `false` |
| `NULL >= 0` | `false` |

`filter`, join predicates, conditional expressions, and projections therefore observe the
same boolean result. There is no `UNKNOWN` boolean value in the DSL.

See [§8 NULL Handling](#8--null-handling).

---

## 6  Logical Operators

### 6.1  AND

Use `&&` for logical conjunction.

**Truth table** (two-valued; a nullable boolean operand is normalized to `false`):

| `a` | `b` | `a && b` |
|:---:|:---:|:---------:|
| `true` | `true` | `true` |
| `true` | `false` | `false` |
| `true` | `NULL` | `false` |
| `false` | `true` | `false` |
| `false` | `false` | `false` |
| `false` | `NULL` | `false` |
| `NULL` | `true` | `false` |
| `NULL` | `false` | `false` |
| `NULL` | `NULL` | `false` |

`NULL` is normalized to `false` before boolean composition.

### 6.2  OR

Use `||` for logical disjunction.

**Truth table** (two-valued; a nullable boolean operand is normalized to `false`):

| `a` | `b` | `a \|\| b` |
|:---:|:---:|:--------:|
| `true` | `true` | `true` |
| `true` | `false` | `true` |
| `true` | `NULL` | `true` |
| `false` | `true` | `true` |
| `false` | `false` | `false` |
| `false` | `NULL` | `false` |
| `NULL` | `true` | `true` |
| `NULL` | `false` | `false` |
| `NULL` | `NULL` | `false` |

`NULL` is normalized to `false` before boolean composition.

### 6.3  NOT

Use `!` for logical negation.

| `a` | `!a` |
|:---:|:-------:|
| `true` | `false` |
| `false` | `true` |
| `NULL` | `true` |

**Result type:** `bool`.

### 6.4  Short-Circuit Evaluation

In generated code, `&&` and `||` use short-circuit evaluation:

- `a && b` — `b` is not evaluated if `a` is `false`.
- `a || b` — `b` is not evaluated if `a` is `true`.

---

## 7  Set Membership and Pattern Operators

### 7.1  IN / NOT IN

Tests whether a value is a member of a set:

```text
// Literal list
Status in ("Active", "Pending", "Review")

// Parameter list
CategoryId in @allowedCategories

// Subquery
UserId in (from Admins | select Id)
```

**NOT IN** is a distinct filter operator:

```text
Status not in ("Deleted", "Archived")
```

Do not replace it with `!(Status in (...))`: for a null probe or a null
right-hand value, `not in` remains false while `!(in)` complements the
already two-valued `in` result. See [Query Language — Nulls in membership](/docs/query-language/reference#nulls-in-membership).

### 7.2  LIKE

SQL-compatible pattern matching on strings:

```text
Name like "A%"           // starts with 'A'
Email like "%@%.com"     // contains '@' and ends with '.com'
Code like "AB_12"        // _ matches exactly one character
```

| Wildcard | Meaning |
|----------|---------|
| `%` | Zero or more characters |
| `_` | Exactly one character |

The `like` operator is two-valued: if either operand is `NULL`, the result is `false`.

### 7.3  CONTAINS / STARTSWITH / ENDSWITH

Use qualified scalar string predicates:

```text
text.contains(Name, "son")
text.startswith(Name, "Dr.")
text.endswith(Email, "@example.com")
```

Their selected overload determines types and null behavior; they are not
collection navigation methods.

### 7.4  BETWEEN

SQL-style `between` is retired. To preserve an inclusive SQL range, write both
comparisons explicitly:

```text
Age >= 18 && Age <= 65
```

Canonical range membership is **half-open**, not inclusive at both ends:

```text
Age in 18..65        // Age >= 18 && Age < 65
Age not in 18..65    // negated half-open range membership
```

Do not replace an inclusive upper bound with the same half-open endpoint.

### 7.5  IS NULL / IS NOT NULL

Use canonical literal comparisons:

```text
MiddleName == null
Email != null
```

These are definite null tests, never an unknown Boolean. SQL-style `is null`
and `is not null` are retired. See [§5.2](#52--null-comparison-semantics).

### 7.6  EXISTS / NOT EXISTS

Tests whether a correlated subquery returns any rows:

```text
exists(from Orders | filter UserId == u.Id)
!exists(from Returns | filter OrderId == o.Id)
```

The `exists` keyword is parsed as a function call whose argument is a subquery
pipeline starting with `from`.

---

## 8  NULL Handling

### 8.1  Two-Valued Boolean Logic

ConjureDB keeps `NULL` as a data value but uses two-valued boolean logic. Every
comparison, membership, pattern, and logical expression returns `true` or `false`:

| Category | NULL Behavior |
|----------|--------------|
| Arithmetic (`+`, `-`, `*`, `/`, `%`) | Any `NULL` operand → `NULL` result |
| Comparison (`==`, `!=`, `<`, etc.) against a **value** | Any `NULL` operand → `false` |
| Comparison (`==`, `!=`) against the **`null` literal** | Definite `true`/`false` — it *is* a null test, see [§5.2](#52--null-comparison-semantics) |
| Logical `&&` | `NULL` operand is `false` |
| Logical `\|\|` | `NULL` operand is `false` |
| Logical `!` | `!NULL` → `true` |
| String (`like`, `contains`, etc.) | `NULL` operand → `false` |
| `in` | A `NULL` probe or member is a non-match, so `in` is `false` |
| `not in` | `false` when a `NULL` takes part — **not** the negation of `in` |

This is not a predicate-boundary conversion: the same two-valued result is visible in a
`select` projection and in every predicate position.

Membership is the one operator whose two rows are not symmetric: `in` and `not in` are *both*
`false` when a `NULL` takes part, so `not in` is not the complement of `in`, and `!(x in S)` is
a different predicate from `x not in S`. The rule is stated normatively in
[Query Language § Set Membership](/docs/query-language/reference#nulls-in-membership).

### 8.2  IS NULL / IS NOT NULL

The canonical null tests are literal comparisons:

```text
value == null       // true exactly when absent
value != null       // true exactly when present
```

These return a definite Boolean. The heading retains the familiar SQL terminology;
`is null` / `is not null` are not admitted source spellings.

### 8.3  Null Coalescing (`??`)

Provides a non-null fallback:

```text
MiddleName ?? ""                        // "" if MiddleName is NULL
Price ?? DefaultPrice ?? 0              // chained coalescing, right-associative: Price ?? (DefaultPrice ?? 0)
```

A chain is one coalesce over all its operands. The result type is the common type of the
operands; the result is non-nullable if the last operand is non-nullable.

### 8.4  Retired `coalesce(…)` Call

The function-call spelling `coalesce(a, b, …)` is retired (`SCH2173`): write the operator, `(a ?? (b ?? …))`.
The diagnostic carries a fix-it that rewrites the whole call.

### 8.5  IS_NULL / IS_NOT_NULL Functions

Write `value == null` or `value != null`, rather than the retired `is_null`,
`is_not_null`, `isnull`, or `isnotnull` call spellings. Presence tests do not
supply a default value; use `??` when a fallback is required.

---

## 9  Type Coercion Rules

### 9.1  Type Families

Every type belongs to a **type family** that determines compatibility:

| Family | Types |
|--------|-------|
| Numeric | Integral, floating-point, decimal, and fixed-point carriers, subject to their distinct promotion rules |
| String | `string`, `char` |
| Boolean | `bool` |
| Temporal | `datetime`, `datetimeoffset`, `dateonly`, `timeonly`, `timespan` |
| Guid | `guid` |
| Binary | `binary` (not a synonym for every `byte[]` operation) |
| Object | User-defined structs, classes, enums |
| Collection | declared arrays and admitted query-result constructors; see [Data Types](/docs/query-language/data-types) |
| Null | The `null` literal (compatible with any nullable type) |

**Cross-family compatibility:** Types in different families are generally **incompatible**,
with these exceptions:

- `Guid` ↔ `String` — bidirectional compatibility, promoted to `string`.
- `Null` — compatible with any nullable type.

### 9.2  Implicit Widening

Implicit conversions require an admitted source/target pair. Arithmetic common-type
selection does not imply that every assignment or result signature accepts the same
conversion:

| Source | Target | Condition |
|--------|--------|-----------|
| `int` | `long` | Widening integral conversion |
| `float` | `double` | Widening floating-point conversion |
| `fixed32` | `fixed64` | Exact fixed-point widening |
| Present `T` | `T?` | Where that nullable carrier is admitted |

**Examples:**

```conjure
// int → long (implicit)
from Users | derive BigId = (0 as long) + Id
```

```conjure
// byte → int (implicit in arithmetic)
from Sensors | filter Reading + 10 > Threshold
```

### 9.3  Explicit Casting

An admitted explicit conversion uses `as`:

```text
Price as int       // a supported double → int conversion can truncate
Quantity as double
```

A numeric target is not permission to parse arbitrary text. Explicit conversions
must exist for the selected source and target carriers, and must preserve the
supported nullability contract. They do not authorize integer-to-enum,
integer-to-entity-reference, or unrelated nominal-record conversions. Use
`checked(expression)` or `unchecked(expression)` to select the supported local
integral overflow policy; `unchecked` does not suppress division by zero.
See [Data Types](/docs/query-language/data-types#type-coercion-and-conversion).

### 9.4  CASE Expression Type Inference

When a `switch` expression has branches with different types, the compiler unifies
them using pairwise promotion:

1. Collect concrete (non-null, non-unknown) types from all branches.
2. Promote pairwise using `AreCompatible` (numeric promotion, temporal matching, etc.).
3. If any branch is `null` or nullable, the result is nullable.
4. Incompatible branch types produce a binding error.

A `switch` requires a default `_` arm; omitting it is not a way to request an
optional result. A conditional expression similarly has both result branches.

```text
// int and long branches → long result
x switch {
    > 100 => (1 as long),
    _     => 0            // promoted to long
}
```

### 9.5  Aggregate Result Type Inference

| Aggregate | Input Type | Result Type |
|-----------|-----------|-------------|
| `count()`, `count(value)`, `count_distinct(value)` | Rows / values | `long` (never nullable) |
| `sum` | Integer types | `long?` without a nonempty-input proof |
| `sum` | `float`, `double` | Catalog-selected nullable numeric carrier without a nonempty-input proof |
| `sum` | `decimal` | `decimal?` without a nonempty-input proof |
| `avg` | Any numeric | `double?` |
| `min`, `max` | Supported numeric / fixed-point | Input carrier, nullable without a nonempty-input proof |

### 9.6  Conversion Functions

Conversion-function aliases such as `to_int`, `to_long`, `to_double`, and
`to_string` are retired source spellings, not a runtime parsing API. Use the
supported `expression as type` conversion. If text parsing is required, declare
an actual schema/host function with its own failure and nullability contract;
do not infer that a numeric cast parses a string.
See [Functions Reference](/docs/query-language/functions#type-conversion-functions).

---

## 10  Built-in Functions

> **See also:** [Custom Functions](/docs/query-language/functions) for the selected signatures
> and for declaring schema or host functions.

Use documented canonical module-qualified scalar names. Authored schema and host
function references require the exact declared spelling. Builtin and keyword
admission follows their documented vocabulary, not a generic identifier alias.

### 10.1  Scalar Function Catalog

The signature catalog for `text`, `math`, `date`, and `bits` is maintained in
[Functions Reference](/docs/query-language/functions#scalar-functions). A name alone does not
guarantee an overload for every carrier or support on every execution target.

- `date.date_trunc` accepts the supported literal units `"year"`, `"month"`,
  `"day"`, `"hour"`, `"minute"`, and `"second"`. A dynamic unit is not admitted.
- A function call evaluates its supplied arguments once in authored order.
  Nullable lifting is not short-circuiting: an absent early argument does not
  by itself skip later arguments.
- `??` and literal null tests have their own operator semantics; retired
  `coalesce`, `is_null`, and `is_not_null` calls are not alternatives.
- Explicit casts and `checked`/`unchecked` select supported conversion and
  integral overflow contracts. They do not change the overload catalog.

### 10.6  Spatial Functions

Spatial functions test geometric relationships between entity coordinates and query regions. When used as supported `filter` predicates, they can enable spatial index selection when a compatible `SpatialGrid` index is declared. A call alone does not guarantee an index access path.

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

These fragments assume `GameObjects` has `Name: string` and compatible numeric
`PosX`, `PosY`, `PosZ` coordinates. Declare `cx`, `cy`, `cz`, `radius`, `targetX`,
and `targetY` with the selected overload's coordinate type in the containing
query header. The literal distances below use the float overload.

```conjure
// Radius query — entities within 100 units of a point
from GameObjects
| filter within_radius(PosX, PosY, @cx, @cy, 100.0f)
| select { Name, PosX, PosY }
```

```conjure
// Bounding box query
from GameObjects
| filter within_bounds(PosX, PosY, 0.0f, 0.0f, 500.0f, 500.0f)
```

```conjure
// Distance as a computed column
from GameObjects
| derive Dist = distance(PosX, PosY, @targetX, @targetY)
| sort Dist
| take 10
```

```conjure
// 3D radius query
from GameObjects
| filter within_radius(PosX, PosY, PosZ, @cx, @cy, @cz, @radius)
```

---

## 11  Aggregate Expressions

Aggregate functions operate on sets of rows and produce a single result per group.
They belong in `aggregate` stages, not arbitrary per-row expressions. A group
creates partition scope but does not by itself make scalar calls into reductions.
Admitted aggregate window calls belong in `derive` with an explicit frame.
Use `aggregate count()` for a scalar row reduction, or `aggregate Count = count()`
for a named row field. The old `| count` terminal is retired; the aggregate
returns `long`, not the old terminal's `int`.
`count(*)` is retired. A single named assignment has no braces; multiple
assignments use a named block.

### 11.1  Standard Aggregates

| Function | Aliases | Description | DISTINCT | Result |
|----------|---------|-------------|:--------:|--------|
| `count()` | — | Count all rows inside an aggregate | — | `long` (never null) |
| `count_distinct(expr)` | — | Count distinct present values | Dedicated call | `long` (never null) |
| `count(expr)` | — | Count non-null values | — | `long` (never null) |
| `sum(expr)` | — | Sum of values | — | Selected numeric carrier, nullable without a nonempty-input proof |
| `avg(expr)` | — | Arithmetic mean | — | `double?` |
| `min(expr)` | — | Minimum supported numeric / fixed-point value | — | Same as input |
| `max(expr)` | — | Maximum supported numeric / fixed-point value | — | Same as input |
| `any_value(expr)` | — | Arbitrary present representative, not a first-row guarantee | — | Nullable input carrier |

### 11.2  Boolean and Bitwise Aggregates

| Function | Aliases | Description |
|----------|---------|-------------|
| `any()` | — | Non-null `bool`: true if group is non-empty, false if empty |
| `any(expr)` | — | Boolean reduction on nonnullable `bool` input; nullable scalar result for empty input |
| `bool_and(expr)` | — | Logical AND across all values |
| `bool_or(expr)` | — | Logical OR across all values |
| `bit_and(expr)` | — | Bitwise AND across all values |
| `bit_or(expr)` | — | Bitwise OR across all values |

### 11.3  Statistical Aggregates

| Function | Aliases | Description |
|----------|---------|-------------|
| `stddev(expr)` | — | Sample standard deviation |
| `stddev_pop(expr)` | — | Population standard deviation |
| `variance(expr)` | — | Sample variance |
| `var_pop(expr)` | — | Population variance |

### 11.4  Collection Aggregate

| Function | Aliases | Description |
|----------|---------|-------------|
| `array_agg(expr)` | — | Collect values into an array |

### 11.5  DISTINCT Modifier

Use the dedicated aggregate to count distinct present values:

```conjure
from Orders
| aggregate UniqueCustomers = count_distinct(CustomerId)
```

The `distinct` call modifier is retired. Do not assume it can be attached to
other reductions; use only catalog-admitted aggregate functions.

### 11.6  Nested Aggregate Prohibition

Aggregates **cannot** be nested:

```text
// ERROR: nested aggregate
avg(sum(Amount))
```

The compiler detects nested aggregates during binding and produces a diagnostic error.

**Examples:**

Assume `Orders` declares `CustomerId: int` and `Amount: decimal`. This returns named aggregate fields per customer;
its containing result signature must admit their actual nullable types.

```conjure
from Orders
| group CustomerId (
    aggregate {
        OrderCount = count(),
        TotalSpent = sum(Amount),
        AvgOrder   = avg(Amount),
        MinAmount  = min(Amount),
        MaxAmount  = max(Amount)
    }
)
```

---

## 12  Window Expressions

Window functions compute values across a set of rows related to the current row,
without collapsing groups.

### 12.1  Syntax

There is no authored `window` stage. A window call is a named `derive` output;
partitioning comes from an enclosing scoped group and ordering from `sort` in
that scope. Aggregate windows require an explicit frame:

```conjure
from Sales s
| group s.Region (
    sort s.SaleDate
    | derive MovingAvg = avg(s.Amount) over rows(-1, 1)
    | select { s.Region, s.SaleDate, MovingAvg }
  )
```

`rows(-1, 1)` includes the previous, current, and next rows. Ranking and
navigation functions use their catalog window role without an aggregate `over`
frame. Derive the output before reading it in a filter or projection.

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
| `first(expr)` | `(value) over rows(start, end)` | ✓ | First value in explicit frame |
| `last(expr)` | `(value) over rows(start, end)` | ✓ | Last value in explicit frame |

`lag` and `lead` always return nullable types since there may be no row at the
specified offset. `first_value` and `last_value` are retired aliases; framed
`first` and `last` use the actual selected window result contract.

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

Window count uses its selected `int` window result carrier; ordinary aggregate
count returns `long`. Do not copy the aggregate signature onto a window call.

### 12.5  Frame Specification

An aggregate window must state a frame:

```text
over rows(start, end)
over range(start, end)
```

| Bound | Meaning |
|-------|---------|
| `-N` | N rows before the current row for a row frame |
| `0` | The current row |
| `N` | N rows after the current row for a row frame |
| `unbounded` | Unbounded on that side |

Frame endpoints are **inclusive**, unlike half-open `in a..b` membership.
Row offsets must be admitted constant integral values, with start no greater
than end. A `range` frame measures distance along exactly one compatible numeric
or temporal sort key, not row count; temporal bounds use durations such as
`over range(-5s, 0s)`. SQL `GROUPS` frames are not supported.

**Example — running total:**

```conjure
from Sales s
| group s.Region (
    sort s.SaleDate
    | derive RunningTotal = sum(s.Amount) over rows(unbounded, 0)
    | select { s.Region, s.SaleDate, RunningTotal }
  )
```

If sort keys tie, supply an admitted tie-breaker when the query requires a
fully determined row sequence. A window does not establish an order by itself.

---

## 13  Expression Evaluation Order

### 13.1  Short-Circuit Evaluation

Logical operators use short-circuit evaluation in generated code:

- `a && b` — if `a` is `false`, `b` is **not evaluated**.
- `a || b` — if `a` is `true`, `b` is **not evaluated**.

This means side-effect-free expressions in `b` may be skipped entirely.

### 13.2  Aggregate vs. Scalar Context

Expressions are evaluated in one of two contexts:

| Context | Description | Example |
|---------|-------------|---------|
| Scalar | Per-row evaluation | `filter Age > 18` |
| Aggregate | Per-group evaluation | `aggregate Total = sum(Amount)` |

An aggregate assignment is a call, not a scalar expression combining grouped
and per-row values:

```conjure
// ERROR: an aggregate assignment is not an arbitrary scalar expression
from Orders | aggregate Total = sum(Amount) + CustomerId
```

### 13.3  Operator Evaluation

Within a single expression, evaluation follows:

1. **Parentheses** — innermost first.
2. **Precedence** — higher-precedence operators bind tighter (see [§3](#3--operator-precedence)).
3. **Associativity** — left-to-right for most binary operators; right-to-left for unary.
4. **Short-circuit** — for `&&`/`||`; conditional choice and `??` also skip unselected operands.

### 13.4  Determinism

Function volatility affects optimization:

| Category | Meaning | Examples |
|----------|---------|---------|
| Immutable | Same inputs always produce same output | `text.length(value)`, `math.round(value)`, `math.abs(value)` |
| Stable | May return different values across transactions | `date.now()`, `date.utcnow()` |
| Unknown | No effect proof supplied by the function owner | custom C# and schema `extern` functions |

The compiler uses volatility information to determine whether expressions can be
folded at compile time, cached, or reordered. `Unknown` is the conservative
default: an unproven function is treated as neither pure nor deterministic, so
the compiler never folds, caches, or reorders around it.

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
| `==` | Comparison | compatible | bool | `NULL` value operand → `false`* |
| `!=` | Comparison | compatible | bool | `NULL` value operand → `false`* |
| `<` | Comparison | orderable | bool | `NULL` operand → `false` |
| `>` | Comparison | orderable | bool | `NULL` operand → `false` |
| `<=` | Comparison | orderable | bool | `NULL` operand → `false` |
| `>=` | Comparison | orderable | bool | `NULL` operand → `false` |
| `&&` | Logical | bool, bool | bool | `NULL` is normalized to `false` |
| `\|\|` | Logical | bool, bool | bool | `NULL` is normalized to `false` |
| `!` | Logical | bool | bool | `!NULL` → `true` |
| `??` | Null coalescing | T?, T | T | Special (returns non-null) |
| `== null` | Null test | any | bool | Never (always definite) |
| `!= null` | Null test | any | bool | Never (always definite) |
| `in` | Set membership | T, set of T | bool | `NULL` is a non-match, so `in` is `false` |
| `not in` | Set membership | T, set of T | bool | `false` when a `NULL` takes part; not the negation of `in` |
| `like` | Pattern | string, string | bool | `NULL` operand → `false` |
| `in a..b` | Range | compatible numeric / temporal bounds | bool | Half-open: lower inclusive, upper exclusive |

\* `expr == null` and `expr != null` are definite absence / presence tests.

---

## Appendix B: Numeric Type Promotion Matrix

The table shows nonnullable result carriers for ordinary binary arithmetic on
these operand types. It is not an assignment-conversion or comparison-result
table; comparisons produce `bool`, and nullable arithmetic lifts the result.

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
> Multiplication uses the same carriers as other binary arithmetic; it does not
> automatically widen `int` or `uint`. Overflow follows the selected policy.

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

¹ Common temporal carriers must be the **same kind** (`datetime` with `datetime`,
not `datetime` with `timespan`); temporal arithmetic has separate typed rules.
² Binary values require compatible binary contracts, not merely the same CLR array carrier.
³ Nominal records and enums retain their declared identity. A common family does
not grant structural assignment, cross-enum equality, or an unrelated record cast.
⁴ Collection types require compatible element types and collection kinds; selected
query-result constructors do not create a general storage or parameter conversion.

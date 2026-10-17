# Custom Functions

ConjureDB resolves function calls while compiling the schema or query. Syntax V3 has
module-qualified scalar built-ins, aggregate and window functions, checked PURE
functions written in the schema, and explicit declarations for host C# functions.
These are different contracts: a name in the catalog is not a promise that every
execution target, reactive query, or materialized view can execute it.

See [Query Language](/docs/query-language/reference) for pipelines,
[Schema Language](/docs/schema/schema-language) for declarations, and
[Data Types](/docs/query-language/data-types) for type and conversion rules.

## Function kinds

| Kind | Declaration or call | Where it belongs |
|---|---|---|
| Scalar built-in | `math.abs(value)`, `text.upper(name)` | Scalar expressions, subject to the selected overload and target |
| Aggregate | `count()`, `sum(value)` | An aggregate stage inside a group, or an admitted window call with an explicit frame |
| Window | `row_number()`, `lag(value)` | A `derive` expression with the required preceding order and frame contract |
| PURE schema function | `function name(x: int) -> int { return x }` | Scalar calls after the compiler admits the definition |
| Host function | `extern function name(x: int) -> int = Demo.Api.Method` | Scalar calls with a matching host signature and target support |

A schema `function` or `extern function` does not define a custom aggregate or
window function. Overload resolution checks the actual argument types, nullability,
parameter names, and result type; it does not dispatch through reflection at runtime.
A native extern call is emitted against its selected C# implementation. This does
not imply that every function is allocation-free or has no runtime cost.

<a id="scalar-functions"></a>

## Scalar built-ins

Use the canonical qualified name. Scalar `math.min(a, b)` is different from the
aggregate `min(value)`. The following is a selection of implemented families, not
an assertion that every numeric type has every overload.

| Module | Calls | Notes |
|---|---|---|
| `math` | `abs`, `sqrt`, `sin`, `cos`, `round`, `ceiling`, `floor` | Numeric overloads select the result carrier; for example, supported `float` transcendental calls retain single precision |
| `math` | `log`, `power`, `exp`, `sign`, `truncate`, `min`, `max` | `min` and `max` take two scalar operands; `power` parameters are `value` and `exp` |
| `text` | `length`, `upper`, `lower`, `trim` | String operations; nullable inputs affect the selected result contract |
| `text` | `contains`, `startswith`, `endswith` | Boolean predicates; a null input produces `false` |
| `text` | `substring`, `replace`, `concat`, `indexof` | `substring` has two- and three-argument overloads; `concat` accepts positional additional strings |
| `date` | `now()`, `utcnow()` | Clock reads, not immutable calculations; not allowed in a PURE body |
| `date` | `year`, `month`, `day`, `hour`, `minute`, `second` | Extract a date/time component |
| `date` | `date_add`, `date_add_hours`, `date_add_minutes`, `date_add_seconds` | The complete leaf name is retained: use `date.date_add`, not `date.add` |
| `date` | `date_diff`, `date_trunc` | `date_trunc` takes a supported literal unit: `year`, `month`, `day`, `hour`, `minute`, or `second` |
| `bits` | `and`, `or`, `xor`, `not`, `shl`, `shr` | Integer operations; shift counts are `int` |
| `bits` | `has(flags, flag)` | Requires the same actual CLR `[Flags]` enum type on both operands |

The `datetime(...)` constructor is global; it is not `date.datetime(...)`.
Use lowercase DSL type names such as `int`, `double`, `datetime`, `timespan`,
`guid`, `fixed32`, and `fixed64`. Use `T?` for an admitted nullable type.
The spelling `DateTime` in a C# host signature is not the DSL type spelling.

<a id="string-functions"></a>

### String example

This is a query body. Its input is a table named `Players` with columns `Id: int`
and `Name: string`; `prefix: string` is a parameter of the containing query.

```conjure
from Players p
| derive {
    NameLength = text.length(p.Name),
    Label = text.upper(text.substring(p.Name, 0, 5))
  }
| filter text.startswith(p.Name, @prefix)
| select { p.Id, NameLength, Label }
```

`text.substring` positions are zero-based. It intersects the requested interval
with the string: `text.substring("abcdef", 4, 10)` is `"ef"`, and
`text.substring("abcdef", -2, 4)` is `"ab"`. A negative length is an error.
`text.indexof` searches for the first occurrence; use its selected overload's
nullable result contract rather than assuming every string call returns a value.
String composition such as `text.concat` propagates a null input rather than
silently treating it as an empty string. The Boolean predicates above are the
explicit exception to null propagation.

## Arguments and evaluation

Calls accept positional arguments and supported named arguments. Names belong to
the selected overload, not to an arbitrary alias for the function. For example,
`math.power(exp: 3.0, value: 2.0)` returns the same value as
`math.power(2.0, 3.0)`, but its argument expressions are evaluated in the order
written: `exp` first, then `value`.

```conjure
function scaled_power(divisor: int, value: int) -> double {
    return math.power(exp: 10 / divisor, value: value + 1)
}
```

In this definition the division is evaluated before the addition. Reordering names
does not reorder effects or exceptions into signature order. An ordinary call
evaluates each supplied argument once in source order, even if the callee does not
use it. A strict nullable-lifted call still evaluates later arguments when an
earlier argument is null; null propagation is not short-circuit argument evaluation.

Unknown names, duplicate assignments to a parameter, and positional arguments
after a name has displaced its positional slot are rejected. To avoid ambiguity,
put positional arguments first and named arguments last. A trailing comma is
accepted in a call.

### Arity, defaults, and variadic calls

- Schema PURE and extern declarations use fixed `name: type` parameters. Their
  declaration syntax has no parameter default initializer or variadic marker.
- Some built-ins have distinct shorter overloads, such as
  `text.substring(str, start)` and `text.substring(str, start, length)`. These are
  not permission to omit arbitrary parameters from another overload.
- A selected overload may admit optional parameters, but named binding does not
  synthesize an absent non-leading default. Do not use a later named argument to
  skip an earlier declared slot.
- Positional variadic built-ins such as `text.concat("a", "b", "c")` are supported
  by their own overload contract. Named variadic expansion is not a general
  supported feature; there is no spread syntax that expands a supplied collection
  into an arbitrary argument list.
- A host C# method having optional, generic, or `params` metadata does not by itself
  grant the schema a new call shape. The declared signature and actual emitted
  host invocation must be admitted together.

## Nulls and conditional evaluation

Use `value == null` and `value != null` to test absence. Use `value ?? fallback`
for coalescing and `condition ? whenTrue : whenFalse` for conditional selection.
These are language operators, not calls to helper functions.

```conjure
module OptionalScores {
    function or_zero(value: int?) -> int { return value ?? 0 }
    query Echo(value: int?) -> int {
        from generate(1) i
        | select or_zero(@value)
    }
}
```

`??` evaluates the right operand only when the left value is null. The conditional
operator evaluates only its selected branch. `&&` and `||` evaluate left to right
and short-circuit. Their nullable Boolean operands are normalized to `false`:
for `flag: bool?`, `flag && true` is false when `flag` is null, while
`flag || true` is true. Do not assume SQL three-valued `AND`/`OR` truth tables.
A predicate boundary also admits a row only when its condition is true.

These rules do not make all nullable expressions interchangeable. Arithmetic,
comparisons, function results, and declared assignment/return boundaries have their
own typed nullability contracts. Use `??` when a required result needs an explicit
replacement value; declaring a non-nullable result does not invent one.

<a id="type-conversion-functions"></a>

## Casts and checked arithmetic

Use `expression as Type` for an explicit conversion, not conversion-function
aliases. The target is a DSL type name and may have an admitted nullable suffix.
A cast must be supported by the selected source/target types; it is not a general
CLR object cast or a substitute for parsing arbitrary text.

```conjure
function widen(value: int) -> double { return value as double }
function wrap_increment(value: int) -> int { return unchecked(value + 1) }
```

Integral arithmetic is checked by default. Use `checked(expression)` or
`unchecked(expression)` to select the supported integral overflow policy locally.
`unchecked` does not suppress division by zero or make an unsupported cast valid.
See [Expressions](/docs/query-language/expressions) and [Data Types](/docs/query-language/data-types) for the detailed
operator and conversion contracts.

## PURE functions in the schema

A `function` declaration defines a compiler-checked PURE scalar function. There is
no separate `@pure` annotation to turn an arbitrary expression or host call into
one. Parameters and `let` locals inside the body use bare lexical names; query and
command parameters at the call site use `@name`.

```conjure
module Scores {
    function increment(value: int) -> int {
        let next = value + 1
        return identity(next)
    }
    function identity(value: int) -> int { return value }
    query Increment(value: int) -> int {
        from generate(1) i
        | select increment(@value)
    }
}
```

A body consists of zero or more `let name = expression` statements and one final
`return expression`. Locals are evaluated eagerly, including an unused local whose
initializer throws. Functions may call other admitted PURE functions, including
forward declarations, but the complete call graph must be acyclic. Conditional
expressions can select a result; imperative loops, mutable locals, and early-return
statements are not part of this body grammar.

Admission requires pointer-free value-type signatures and zero-heap body
expressions. Admitted scalar value types and their nullable forms are supported;
nominal value types require their own admission. Do not assume that any CLR struct,
string, array, reference type, or row reference becomes a valid PURE parameter just
because it can appear elsewhere in a schema.

PURE bodies cannot capture a table row, issue a subquery, access a workspace or
snapshot, construct a system RNG, read the clock, or perform mutations. Calls must
have the compiler's exact immutable and zero-heap admission. An ordinary extern
declaration does not supply that admission. Argument expressions at a caller still
belong to that caller: purity of the function body does not erase an argument's
fault, effect, or evaluation order.

## Extern C# functions

Use an explicit schema declaration to name a host implementation. A public static
method in the compilation's references is not automatically exposed to the DSL.
For example, provide this host code:

```csharp
namespace Game;

public static class ScoreFunctions
{
    public static int Boost(int value, int bonus) => checked(value + bonus);
}
```

Then declare and call it in the schema:

```conjure
extern function boost(value: int, bonus: int) -> int = Game.ScoreFunctions.Boost
module Scores {
    query Boost(value: int, bonus: int) -> int {
        from generate(1) i
        | select boost(value: @value, bonus: @bonus)
    }
}
```

The declaration fixes the DSL parameter names and types, result type and
nullability, and qualified host method. The host binding must match the complete
physical signature. A nullable carrier or default argument is not silently
inferred to repair a mismatch. Invalid or ambiguous declarations are compilation
errors, not functions that are silently skipped.

Keep host assemblies available to the compiler and the generated application.
Use [Schema Language](/docs/schema/schema-language) for `extern type` declarations when a
host type is needed; that declaration does not waive function signature, value,
collection, or target restrictions. The primitive example above does not imply
that arbitrary CLR collections, `ref`/`out` parameters, or generic methods are
universally available through a schema declaration.

An extern declaration alone is not proof of immutability, zero allocation, absence
of exceptions, or permission to reorder the call. Host-call admission and the
selected execution target must supply the relevant contract. In particular, do
not assume an ordinary extern can be called from a PURE body or a reactive query.
The host implementation remains responsible for its actual behavior and costs.

## Aggregate functions

Aggregate spellings remain unqualified. Common aggregate families are:

| Calls | Contract |
|---|---|
| `count()`, `count(value)`, `count_distinct(value)` | Count rows, non-null values, or structurally distinct non-null values; aggregate count returns `long` |
| `sum(value)`, `avg(value)` | Numeric inputs with the selected widening and empty-input result policy |
| `min(value)`, `max(value)` | Supported numeric and fixed-point inputs; not a general comparer for strings, Boolean values, enums, dates, or GUIDs |
| `any_value(value)` | An arbitrary non-null representative; null for empty/all-null input. It does not promise the first row |
| `bool_and(value)`, `bool_or(value)` | Non-nullable Boolean inputs; empty-input and grouped-result nullability follow the selected aggregate contract |
| `bit_and(value)`, `bit_or(value)` | Supported integer aggregate overloads, distinct from scalar `bits.and` and `bits.or` |
| `stddev(value)`, `variance(value)`, `stddev_pop(value)`, `var_pop(value)` | Supported numeric statistical aggregates |

Other catalog families, including collection-producing aggregates, require their
own target capabilities; a catalog entry is not universal backend support.
Do not infer that aggregate results all share one empty-input identity or result
width. Grouped populated input and scalar empty input can have different
nullability contracts.

For a table `Orders` with `UserId: int` and `Amount: decimal`, this query body
computes one result per user. The aggregate `filter` suffix limits input to that
aggregate, not the whole group:

```conjure
from Orders o
| group o.UserId (aggregate {
    Rows = count(),
    Positive = sum(o.Amount) filter (o.Amount > 0m)
  })
| select { UserId = o.UserId, Rows, Positive }
```

## Window functions

Windows belong in `derive`. A preceding `sort` supplies their order; a containing
`group` supplies partition input. Ranking and navigation functions such as
`row_number`, `rank`, `dense_rank`, `ntile`, `lag`, and `lead` require an order
and forbid an explicit frame. Tie-sensitive functions need a sufficient ordering
for their selected contract. Framed aggregates and boundary functions `first` and
`last` require an explicit frame; there is no implicit default frame.

For a table `Orders` with unique `Id: int` and `Amount: decimal`:

```conjure
from Orders o
| sort o.Id
| derive Running = sum(o.Amount) over rows(unbounded, 0)
| select { o.Id, Running }
```

Frame endpoints are inclusive; `rows(-2, 0)` includes the two preceding rows and
the current row. `range` frames additionally require the supported single numeric
or temporal ordering key and compatible row-invariant offsets. Window result
types come from the window overload, not from an assumed aggregate result type.
Navigation overloads and named/default argument forms must also be representable
by the selected schema and execution path; do not assume every catalog form is
available in every context.

## Migration from retired spellings

These are **negative migration examples**, not accepted alternatives:

| Retired source | Canonical source |
|---|---|
| `abs(x)`, `upper(x)`, `year(x)` | `math.abs(x)`, `text.upper(x)`, `date.year(x)` |
| `len(x)`, `toupper(x)`, `substr(x, start)` | `text.length(x)`, `text.upper(x)`, `text.substring(x, start)` |
| `is_null(x)`, `is_not_null(x)` | `x == null`, `x != null` |
| `coalesce(a, b, c)` | `a ?? b ?? c` |
| `to_int(x)`, `to_double(x)`, `to_long(x)`, `cast(x as int)` | `x as int`, `x as double`, `x as long` |
| `wrapping_add_int(a, b)` | `unchecked(a + b)` |
| `a and b`, `a or b`, `not a` | `a && b`, `a \|\| b`, `!a` |
| `count(*)`, `count(distinct x)` | `count()`, `count_distinct(x)` |
| `first_value(x)`, `last_value(x)` | `first(x)`, `last(x)` with the required window frame |

Do not migrate by mechanically removing modules or copying C# member names into
DSL calls. Select the actual overload and preserve authored argument order,
nullability, and the surrounding aggregate/window context.

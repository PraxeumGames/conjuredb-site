# Custom Functions

## Overview

ConjureDB provides a rich set of **built-in functions** (scalar, aggregate, and window) and supports extending the DSL with user-defined C# functions via an `extern function` declaration in the schema. All functions are resolved at compile time and emit direct static method calls — no reflection, no delegates, no runtime overhead.

---

## Table of Contents

- [Built-in Functions Catalog](#built-in-functions-catalog)
  - [Scalar Functions](#scalar-functions)
  - [Aggregate Functions](#aggregate-functions)
  - [Window Functions](#window-functions)
- [Custom Function Definition](#custom-function-definition)
- [Using Functions in DSL](#using-functions-in-dsl)
- [Function Requirements](#function-requirements)
- [Supported Parameter & Return Types](#supported-parameter--return-types)
- [Discovery Mechanism](#discovery-mechanism)
- [How Functions Are Compiled](#how-functions-are-compiled)
- [Limitations](#limitations)
- [Examples](#examples)

---

## Built-in Functions Catalog

### Scalar Functions

#### String Functions

| Function | Aliases | Signature | Description |
|----------|---------|-----------|-------------|
| `length` | `len` | `(string) → int` | Returns string length |
| `upper` | `toupper` | `(string) → string` | Convert to uppercase |
| `lower` | `tolower` | `(string) → string` | Convert to lowercase |
| `trim` | — | `(string) → string` | Remove leading and trailing whitespace |
| `contains` | — | `(string, string) → bool?` | Check if string contains substring |
| `startswith` | — | `(string, string) → bool?` | Check if string starts with prefix |
| `endswith` | — | `(string, string) → bool?` | Check if string ends with suffix |
| `substring` | `substr` | `(string, int) → string` | Extract substring from position |
| `substring` | `substr` | `(string, int, int) → string` | Extract substring with length |
| `replace` | — | `(string, string, string) → string` | Replace all occurrences of substring |
| `concat` | — | `(string, string, ...) → string` | Variadic string concatenation |
| `indexof` | — | `(string, string) → int?` | Find first index of substring (null if not found) |

**Examples:**

```dsl
from Players
| derive NameLen = length(Name)
| derive Upper = upper(Name)
| derive HasTag = contains(Name, "Pro")
| derive Short = substring(Name, 0, 5)
| filter startswith(Name, @prefix)
| select Id, NameLen, Upper, HasTag, Short
```

#### Null Handling Functions

| Function | Aliases | Signature | Description |
|----------|---------|-----------|-------------|
| `coalesce` | — | `(object, object) → object` | Return first non-null value |
| `is_null` | `isnull` | `(object) → bool` | Returns true if value is null |
| `is_not_null` | `isnotnull` | `(object) → bool` | Returns true if value is not null |

**Examples:**

```dsl
from Players
| left join Guilds g (GuildId == g.Id)
| derive GuildName = coalesce(g.Name, "No Guild")
| filter is_not_null(g.Id)
| select Id, Name, GuildName
```

#### Date/Time Functions

| Function | Aliases | Signature | Description |
|----------|---------|-----------|-------------|
| `now` | — | `() → DateTime` | Current local time (stable within query) |
| `utcnow` | — | `() → DateTime` | Current UTC time (stable within query) |
| `year` | — | `(DateTime) → int?` | Extract year component |
| `month` | — | `(DateTime) → int?` | Extract month component |
| `day` | — | `(DateTime) → int?` | Extract day component |
| `hour` | — | `(DateTime) → int?` | Extract hour component |
| `minute` | — | `(DateTime) → int?` | Extract minute component |
| `second` | — | `(DateTime) → int?` | Extract second component |
| `date_add` | — | `(DateTime, double) → DateTime` | Add days to date |
| `date_add_hours` | — | `(DateTime, double) → DateTime` | Add hours to date |
| `date_add_minutes` | — | `(DateTime, double) → DateTime` | Add minutes to date |
| `date_add_seconds` | — | `(DateTime, double) → DateTime` | Add seconds to date |
| `date_diff` | — | `(DateTime, DateTime) → double?` | Difference in days |
| `date_trunc` | — | `(DateTime, string) → DateTime` | Truncate to unit (`"year"`, `"month"`, `"day"`, `"hour"`, `"minute"`) |

> **Note:** `now()` and `utcnow()` have **Stable** volatility — they return the same value within a single query execution but may differ between calls.

**Examples:**

```dsl
from Orders
| filter CreatedAt > date_add(now(), -7)
| derive DaysAgo = date_diff(now(), CreatedAt)
| derive OrderMonth = month(CreatedAt)
| select OrderId, DaysAgo, OrderMonth
```

```dsl
from Events
| derive TruncatedDate = date_trunc(EventTime, "day")
| group TruncatedDate (aggregate { Count = count Id })
| sort -Count
```

#### Math Functions

| Function | Aliases | Signature | Description |
|----------|---------|-----------|-------------|
| `abs` | — | `(numeric) → numeric` | Absolute value |
| `sqrt` | — | `(double) → double?` | Square root |
| `round` | — | `(double) → double` | Round to nearest integer |
| `round` | — | `(double, int) → double` | Round to N decimal places |
| `ceiling` | `ceil` | `(double) → double` | Round up to nearest integer |
| `floor` | — | `(double) → double` | Round down to nearest integer |
| `log` | `ln` | `(double) → double?` | Natural logarithm |
| `power` | `pow` | `(double, double) → double?` | Raise to power |
| `exp` | — | `(double) → double?` | e raised to power |
| `sign` | — | `(numeric) → int?` | Sign: -1, 0, or 1 |
| `truncate` | — | `(double) → double` | Remove decimal portion |
| `max` | — | `(object, object) → object` | Maximum of two values (scalar) |
| `min` | — | `(object, object) → object` | Minimum of two values (scalar) |

> All math functions accept `int`, `long`, `float`, `double`, and `decimal` overloads where applicable. Return types match or widen to `double?`/`decimal?` for nullable-safe operations.

**Examples:**

```dsl
from Players
| derive NormalizedScore = round(Score / 100.0, 2)
| derive ScoreLog = log(Score + 1)
| derive ClampedLevel = min(max(Level, 1), 100)
| select Id, NormalizedScore, ScoreLog, ClampedLevel
```

#### Type Conversion Functions

| Function | Aliases | Signature | Description |
|----------|---------|-----------|-------------|
| `to_string` | — | `(object) → string?` | Convert any value to string |
| `to_int` | — | `(string\|double\|long) → int?` | Convert to integer |
| `to_double` | — | `(string\|int\|long) → double?` | Convert to double |
| `to_long` | — | `(string\|int\|double) → long?` | Convert to long |

**Examples:**

```dsl
from Config
| derive IntValue = to_int(StringValue)
| filter is_not_null(IntValue)
| select Key, IntValue
```

---

### Aggregate Functions

Aggregate functions operate over groups of rows (or the entire table if no `group` clause). All aggregate functions support the `FILTER` clause for conditional aggregation.

| Function | Aliases | Arity | DISTINCT | Signature | Description |
|----------|---------|-------|----------|-----------|-------------|
| `count` | — | 0 | No | `() → long` | Count all rows |
| `count` | — | 1 | Yes | `(object) → long` | Count non-null values |
| `sum` | — | 1 | Yes | `(numeric) → numeric?` | Sum of values |
| `avg` | `average` | 1 | Yes | `(numeric) → double?` | Arithmetic mean |
| `min` | — | 1 | Yes | `(object) → object?` | Minimum value |
| `max` | — | 1 | Yes | `(object) → object?` | Maximum value |
| `first` | — | 1 | No | `(object) → object?` | First value in group |
| `last` | — | 1 | No | `(object) → object?` | Last value in group |
| `all` | — | 1 | No | `(bool) → bool?` | True if all values are true (AND) |
| `any` | — | 0–1 | No | `([bool]) → bool?` | True if any value is true (OR) |
| `bool_and` | `booland` | 1 | No | `(bool) → bool?` | Boolean AND aggregate |
| `bool_or` | `boolor` | 1 | No | `(bool) → bool?` | Boolean OR aggregate |
| `bit_and` | `bitand` | 1 | No | `(int\|long) → long?` | Bitwise AND aggregate |
| `bit_or` | `bitor` | 1 | No | `(int\|long) → long?` | Bitwise OR aggregate |
| `stddev` | `stdev`, `std_dev` | 1 | No | `(numeric) → double?` | Sample standard deviation |
| `variance` | — | 1 | No | `(numeric) → double?` | Sample variance |
| `stddev_pop` | `stddevpop`, `stdev_pop` | 1 | No | `(numeric) → double?` | Population standard deviation |
| `var_pop` | `varpop`, `variance_pop` | 1 | No | `(numeric) → double?` | Population variance |
| `array_agg` | `arrayagg` | 1 | No | `(object) → Array[T]` | Collect values into array |

**Examples:**

```dsl
# Basic aggregation
from Players
| aggregate {
    TotalPlayers = count,
    AvgScore = avg Score,
    MaxLevel = max Level,
    MinScore = min Score
}
```

```dsl
# Grouped aggregation with multiple functions
from Players
| group GuildId (aggregate {
    MemberCount = count Id,
    TotalScore = sum Score,
    AvgLevel = avg Level,
    TopScore = max Score,
    ScoreStdDev = stddev Score
})
| sort -TotalScore
| take 10
```

```dsl
# DISTINCT aggregation
from Orders
| aggregate {
    UniqueCustomers = count distinct CustomerId,
    UniqueItems = count distinct ItemId
}
```

```dsl
# Boolean aggregation
from Players
| group GuildId (aggregate {
    AllActive = all IsActive,
    AnyPremium = any IsPremium
})
```

```dsl
# Array aggregation
from Players
| group GuildId (aggregate {
    MemberNames = array_agg Name
})
```

---

### Window Functions

Window functions compute values across a set of rows related to the current row, defined by `OVER` clause with optional `PARTITION BY` and `ORDER BY`.

**Syntax:**

```dsl
function_name(args) over ([partition Column1, Column2] sort [-]Column3, Column4)
```

#### Ranking Functions

| Function | Aliases | Requires ORDER BY | Signature | Description |
|----------|---------|-------------------|-----------|-------------|
| `row_number` | — | Yes | `() → int` | Sequential number within partition |
| `rank` | — | Yes | `() → int` | Rank with gaps for ties |
| `dense_rank` | — | Yes | `() → int` | Rank without gaps for ties |
| `ntile` | — | Yes | `(int) → int` | Divide rows into N equal buckets |

#### Navigation Functions

| Function | Aliases | Requires ORDER BY | Signature | Description |
|----------|---------|-------------------|-----------|-------------|
| `lag` | — | Yes | `(object) → object?` | Value from previous row |
| `lag` | — | Yes | `(object, int) → object?` | Value from N rows before |
| `lead` | — | Yes | `(object) → object?` | Value from next row |
| `lead` | — | Yes | `(object, int) → object?` | Value from N rows ahead |
| `first_value` | `first` | Yes | `(object) → object?` | First value in window frame |
| `last_value` | `last` | Yes | `(object) → object?` | Last value in window frame |

#### Windowed Aggregates

| Function | Aliases | Requires ORDER BY | Signature | Description |
|----------|---------|-------------------|-----------|-------------|
| `count` | — | No | `() → int` | Count rows in window |
| `count` | — | No | `(object) → int` | Count non-nulls in window |
| `sum` | — | No | `(numeric) → numeric?` | Sum over window |
| `avg` | — | No | `(numeric) → double?` | Average over window |
| `min` | — | No | `(numeric) → numeric?` | Minimum over window |
| `max` | — | No | `(numeric) → numeric?` | Maximum over window |

**Examples:**

```dsl
# Ranking within guild
from Players
| derive GuildRank = row_number() over (partition GuildId sort -Score)
| filter GuildRank <= 3
| select Id, Name, GuildId, Score, GuildRank
```

```dsl
# Running total
from Orders
| derive RunningTotal = sum(Amount) over (partition CustomerId sort OrderDate)
| select OrderId, CustomerId, Amount, RunningTotal
```

```dsl
# Compare with previous value
from Players
| sort -Score
| derive PrevScore = lag(Score) over (sort -Score)
| derive ScoreDiff = Score - coalesce(PrevScore, 0)
| select Id, Name, Score, ScoreDiff
```

```dsl
# Top-K per partition (optimized by WindowRowNumberTopKPerPartitionPlanningPass)
from Players
| derive Rank = row_number() over (partition GuildId sort -Score)
| filter Rank <= @topK
| select GuildId, Id, Name, Score, Rank
```

```dsl
# Dense ranking with ntile
from Players
| derive Tier = ntile(4) over (sort -Score)
| derive DenseRank = dense_rank() over (sort -Score)
| select Id, Name, Score, Tier, DenseRank
```

---

## Custom Function Definition

### extern function Declaration

A custom function has two parts: a plain **`public static` method** in C# (no attribute) and an `extern function` declaration in your `.conjure` schema that maps a DSL name to that fully-qualified method:

```
extern function calculateDamage(baseDamage: int, enchantLevel: int) -> int = GameMath.CalculateDamage
extern function xpForLevel(level: int) -> long = GameMath.XpForLevel
extern function clampScore(score: int, min: int, max: int) -> int = GameMath.ClampScore
```

```csharp
public static class GameMath
{
    public static int CalculateDamage(int baseDamage, int enchantLevel)
    {
        return baseDamage + enchantLevel * 10;
    }

    public static long XpForLevel(int level)
    {
        return (long)(100 * Math.Pow(1.5, level - 1));
    }

    public static int ClampScore(int score, int min, int max)
    {
        return score < min ? min : score > max ? max : score;
    }
}
```

### Declaration Form

```
extern function <dslName>(<param>: <Type>, ...) -> <ReturnType> = <Fully.Qualified.Static.Method>
```

| Part | Description |
|------|-------------|
| `<dslName>` | Name used in DSL expressions. |
| parameters | Comma-separated `name: Type` list; types use the schema type grammar (`int`, `string`, `extern Some.Clr.Type`, `T[]`, `T?`, generics). |
| `-> <ReturnType>` | Return type of the function. |
| `= <method>` | Fully-qualified name of the target `public static` C# method. |

---

## Using Functions in DSL

Reference functions by their registered name in any expression context:

```dsl
from Players
| derive Damage = calculateDamage(BaseDamage, EnchantLevel)
| derive RequiredXp = xpForLevel(Level)
| filter Damage > @minDamage
| select Id, Name, Damage, RequiredXp
```

### Supported Expression Contexts

| Context | Example |
|---------|---------|
| `derive` | `derive Damage = calculateDamage(BaseDamage, EnchantLevel)` |
| `filter` | `filter calculateDamage(BaseDamage, EnchantLevel) > 100` |
| `select` | `select calculateDamage(BaseDamage, EnchantLevel) as Damage` |
| `sort` | `sort -calculateDamage(BaseDamage, EnchantLevel)` |
| Mutation `set` | `set Score = clampScore(it.Score + @bonus, 0, 10000)` |

---

## Function Requirements

Custom function methods **must** satisfy all of the following:

| Requirement | Validation |
|-------------|-----------|
| Be `public static` | Instance / non-public methods cannot be referenced by an `extern function` declaration |
| Not be generic | Generic methods are rejected |
| No `ref` / `out` / `in` parameters | `RefKind != RefKind.None` → rejected per parameter |
| No `params` parameters | `IsParams` → rejected |
| No optional/default parameters | `HasExplicitDefaultValue` → rejected |

> **Note:** Methods violating these constraints produce a **compile-time warning** and are skipped. Other valid functions continue to work normally.

---

## Supported Parameter & Return Types

| Category | Allowed Types |
|----------|---------------|
| Integer | `int`, `long`, `short`, `byte` |
| Floating-point | `float`, `double`, `decimal` |
| Boolean | `bool` |
| String | `string` |
| Date/Time | `DateTime`, `DateTimeOffset` |
| Identity | `Guid`, `char` |
| Nullable scalars | `int?`, `long?`, `double?`, etc. |
| Read-only collections | `T[]`, `IReadOnlyList<T>`, `IReadOnlyCollection<T>`, `IEnumerable<T>` |
| Structs / Classes | Any CLR-resolvable value or reference type |

> **Prohibited:** Mutable collection types (`List<T>`, `Dictionary<K,V>`) are rejected to ensure generated code remains allocation-free.

---

## Discovery Mechanism

Functions are registered by `extern function` declarations in your `.conjure` schema. Each declaration names the DSL function and the fully-qualified C# static method it maps to, so no attribute scanning or manual runtime registration is needed.

Each declaration produces a mapping from a DSL function name to a fully qualified C# method name (e.g., `calculateDamage` → `GameMath.CalculateDamage`), which the compiler uses for direct code generation.

---

## How Functions Are Compiled

Custom functions compile to direct static calls — no reflection overhead. The generated code calls your static method directly by its fully qualified name (e.g., `GameMath.CalculateDamage(row.BaseDamage, row.EnchantLevel)`).

### Overload Resolution

When multiple overloads exist for a function (e.g., `round(double)` and `round(double, int)`), the compiler selects the best match based on:

1. Arity match (correct number of arguments)
2. Type compatibility (exact type match preferred over implicit coercion)
3. Ties produce a compile-time error

---

## Limitations

| Limitation | Details |
|-----------|---------|
| **Scalar only** | Custom functions must be scalar. Aggregate and window custom functions are not supported. |
| **Deterministic** | Functions must be deterministic — the compiler may evaluate them at compile time for constant folding. |
| **Side-effect free** | Functions may be called in any order, possibly not at all if the optimizer eliminates the expression. |
| **No duplicate signatures** | Each `(name, arity)` pair must be unique. Multiple arities for the same DSL name are allowed, but duplicate `(name, arity)` registrations produce a compile-time error. |
| **No recursion** | Custom functions cannot call other custom functions within the DSL (they can in C# implementation). |

---

## Examples

### String Helper Functions

```csharp
public static class StringHelpers
{
    public static string Initials(string firstName, string lastName)
        => $"{firstName[0]}{lastName[0]}";

    public static string Truncate(string value, int maxLength)
        => value.Length <= maxLength ? value : value.Substring(0, maxLength);
}
```

```
extern function initials(firstName: string, lastName: string) -> string = StringHelpers.Initials
extern function truncate(value: string, maxLength: int) -> string = StringHelpers.Truncate
```

```dsl
from Players
| derive Tag = initials(FirstName, LastName)
| derive ShortName = truncate(Name, 10)
| select Id, Tag, ShortName
```

### Nullable-Safe Function

```csharp
public static class NullableHelpers
{
    public static int SafeLength(string? value)
        => value?.Length ?? 0;
}
```

```
extern function safeLength(value: string) -> int = NullableHelpers.SafeLength
```

```dsl
from Players
| left join Guilds g (GuildId == g.Id)
| derive NameLen = safeLength(g.Name)
| select Id, NameLen
```

### Game Logic Functions

```csharp
public static class GameLogic
{
    public static string TierForLevel(int level)
        => level switch
        {
            < 10 => "Bronze",
            < 25 => "Silver",
            < 50 => "Gold",
            < 75 => "Platinum",
            _ => "Diamond"
        };

    public static double CombatPower(int attack, int defense, int speed)
        => attack * 1.5 + defense * 1.2 + speed * 0.8;
}
```

```
extern function tierForLevel(level: int) -> string = GameLogic.TierForLevel
extern function combatPower(attack: int, defense: int, speed: int) -> double = GameLogic.CombatPower
```

```dsl
from Players
| derive Tier = tierForLevel(Level)
| derive CP = combatPower(Attack, Defense, Speed)
| sort -CP
| take 100
| select Id, Name, Tier, CP
```

### Using Custom + Built-in Functions Together

```dsl
from Players
| derive CP = combatPower(Attack, Defense, Speed)
| derive NormalizedCP = round(CP / max(CP) over (), 4)
| derive Rank = dense_rank() over (sort -CP)
| filter Rank <= @topN
| select Id, Name, CP, NormalizedCP, Rank
```

---

## See Also

- [Compiled Queries](/docs/query-language/compiled-queries) — `query` attribute and code generation
- [Query Language](/docs/query-language/reference) — DSL syntax reference
- [Mutations](/docs/query-language/mutations) — using functions in mutation `set` clauses
- [PGO](/docs/performance/pgo) — profile-guided optimization

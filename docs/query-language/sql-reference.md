# SQL Reference & Examples

This reference compares SQL with the **implemented Syntax V3** query language.
SQL blocks are comparison material, not `.conjure` input. `dsl` blocks are real
query-body examples; their source tables and parameters are described below.
The comparisons explain intent, not identical null semantics, execution plans,
ordering, or generated APIs.

See [Query Language](/docs/query-language/reference), [Set Operations](/docs/query-language/set-operations),
[Functions Reference](/docs/query-language/functions), and [Mutations](/docs/query-language/mutations) for the
full contracts.

## Table of Contents

- [SQL Equivalents](#sql-equivalents)
- [Examples](#examples)
  - [Basic Queries](#basic-queries)
  - [Filtering and Sorting](#filtering-and-sorting)
  - [Joins](#joins)
  - [Aggregations](#aggregations)
  - [Window Functions Examples](#window-functions-examples)
  - [Complex Queries](#complex-queries)
- [Result Shapes and Cardinality](#result-shapes-and-cardinality)

## SQL Equivalents

These are canonical source forms, not a SQL compatibility grammar. Named output
blocks describe members; they do not preserve a previous positional CLR API by
accident.

| ConjureDB DSL | SQL concept / qualification |
|---|---|
| `from Players p` | `FROM Players AS p` |
| `filter predicate` | `WHERE predicate`; after a reduction, a HAVING-like filter |
| `select p.Id` | One scalar output, `SELECT p.Id` |
| `select { p.Id, Label = p.Name }` | Named outputs, `SELECT p.Id, p.Name AS Label` |
| `derive Adjusted = p.Score + 1` | Add a computed value while retaining the current row |
| `join Orders o (o.PlayerId == p.Id)` | Inner join with an explicit predicate |
| `left join`, `right join`, `full join` | Outer joins; the absent side becomes nullable |
| `filter (from Orders o \| filter o.PlayerId == p.Id \| any)` | Correlated `EXISTS` |
| `filter !(from Orders o \| filter o.PlayerId == p.Id \| any)` | Correlated `NOT EXISTS` |
| `group p.Level (aggregate Players = count())` | Grouped row count, with an explicit child pipeline |
| `aggregate Total = sum(o.Total)` | One named whole-input aggregate output |
| `aggregate count()` | Scalar whole-input row count |
| `sort { -p.Score, p.Id }` | `ORDER BY p.Score DESC, p.Id ASC` |
| `sort p.Name nulls last` | Explicit null placement in ordering |
| `skip 10 \| take 5` | `OFFSET 10 LIMIT 5`, after an actual sort when order matters |
| `select p.Level \| distinct` | Distinct projected levels |
| `let ids = (from Players p \| select p.Id)` | Named intermediate pipeline, not a recursive CTE |
| `union (pipeline)`, `union all (pipeline)` | Set union, with/without duplicate removal |
| `intersect (pipeline)`, `except (pipeline)` | Set operations on compatible projected shapes |
| `p.Level in 10..20` | `p.Level >= 10 AND p.Level < 20`, **not** inclusive `BETWEEN` |
| `p.Id in (1, 3, 5)` | Membership, subject to the DSL's null rules |
| `p.Name == null`, `p.Name != null` | Absence tests, not SQL source spellings |
| `p.Name ?? "Unknown"` | Coalescing with lazy fallback evaluation |
| `p.Score > 0 ? "Positive" : "Other"` | Conditional expression, comparable to searched `CASE` |
| `p.Score as double` | An admitted explicit numeric conversion |
| `text.contains(p.Name, "Pro")` | A text predicate, not an infix `contains` operator |
| `count_distinct(o.PlayerId)` | Distinct present-value aggregate count |
| `sum(o.Total) filter (o.Total > 0m)` | Per-aggregate `FILTER (WHERE ...)` |
| `derive Rn = row_number()` | Ordered ranking in a derive stage |
| `derive Running = sum(o.Total) over rows(unbounded, 0)` | An explicit aggregate window frame |

Boolean operators are `&&`, `||`, and `!`. In `&&`/`||`, nullable Boolean operands
are normalized to false; do not import SQL three-valued truth tables. Ordinary
function arguments are eager and follow authored source order, including named
arguments. `&&`, `||`, `??`, and `?:` retain their conditional evaluation rules.

The language does not accept SQL `WITH`, recursive CTEs, `CAST(...)`, `BETWEEN`,
`IS NULL`, wildcard aggregate arguments, or DISTINCT aggregate modifiers as
alternative spellings. Use the corresponding canonical form above. Specialized
navigation and result terminals also have their own contracts, not SQL method
name matching.

## Examples

The query bodies below assume these source columns. Table declarations, indexes,
and declared query result types belong to the surrounding schema; they are not
created by a `from` clause.

| Source | Relevant columns |
|---|---|
| `Players` | `Id: int` (unique), `Name: string`, `Level: int`, `Score: int`, `OptionalScore: int?` |
| `Orders` | `Id: int` (unique), `PlayerId: int`, `CustomerId: int`, `Total: decimal` |
| `OrderItems` | `Id: int` (unique), `OrderId: int`, `Qty: int` |
| `Customers` | `Id: int` (unique), `Name: string` |
| `Products` | `Id: int` (unique), `CategoryId: int`, `Name: string`, `Price: decimal` |
| `Sales` | `Id: int` (unique), `Region: int`, `Date: datetime`, `Amount: decimal` |

Where used, `prefix: string` and `n: int` are parameters of the containing query,
referenced as `@prefix` and `@n`. Named multi-output examples need a corresponding
named result shape; scalar and collection examples need their actual selected
signature. See [Result Shapes and Cardinality](#result-shapes-and-cardinality).

### Basic Queries

**Project named columns.** SQL:

```sql
SELECT p.Id, p.Name, p.Level, p.Score
FROM Players AS p
ORDER BY p.Id;
```

DSL:

```conjure
from Players p
| sort p.Id
| select { p.Id, p.Name, p.Level, p.Score }
```

**Filter and compute a value.** `derive` retains the current row; `select` chooses
the result members. Multiple outputs use braces, while one scalar output need not.

```conjure
from Players p
| filter p.Level >= 10
| derive DoubleScore = p.Score * 2
| sort p.Id
| select { p.Id, p.Name, DoubleScore }
```

**Distinct projected values:**

```conjure
from Players p | select p.Level | distinct | sort Level
```

`distinct` applies to the current projected value or row, not an implicit key
list. For one row per key with a chosen representative, use a scoped group with
an explicit sort and limit.

**Pagination.** An actual order makes the selected page meaningful:

```conjure
from Players p | sort p.Id | skip 10 | take 5 | select p.Id
```

### Filtering and Sorting

**Multiple conditions and text predicates:**

```conjure
from Players p
| filter p.Level >= 10 && p.Score > 500 && text.startswith(p.Name, @prefix)
| sort { -p.Score, p.Id }
| select { p.Id, p.Name, p.Score }
```

**Null filtering:**

```conjure
from Players p
| filter p.OptionalScore != null
| sort p.Id
| select { p.Id, p.OptionalScore }
```

**Pattern matching and explicit null ordering:**

```conjure
from Players p
| filter p.Name like "A%"
| sort { p.Name nulls last, p.Id }
| select { p.Id, p.Name }
```

**Inclusive SQL BETWEEN versus a half-open range.** SQL:

```sql
SELECT p.Id, p.Level FROM Players AS p WHERE p.Level BETWEEN 10 AND 50;
```

To preserve those inclusive bounds, write both comparisons:

```conjure
from Players p
| filter p.Level >= 10 && p.Level <= 50
| select { p.Id, p.Level }
```

By contrast, this canonical range includes 10 but **excludes 50**:

```conjure
from Players p | filter p.Level in 10..50 | select { p.Id, p.Level }
```

List, array, and nested-pipeline membership use a two-valued present-value match.
A null probe or null element does not match. `not in` additionally preserves null
witnesses: for nonempty input it requires a present probe and present elements,
with no equality match. It is therefore not interchangeable with `!(x in values)`.
See [membership semantics](/docs/query-language/reference#nulls-in-membership).

### Joins

**Inner join.** The predicate belongs in parentheses; there is no `ON` keyword.

```sql
SELECT p.Name, o.Total
FROM Players AS p JOIN Orders AS o ON p.Id = o.PlayerId AND o.Total > 100;
```

```conjure
from Players p
| join Orders o (p.Id == o.PlayerId && o.Total > 100m)
| sort { o.Total, o.Id }
| select { p.Name, o.Total }
```

**Left join detecting missing matches:**

```conjure
from Orders o
| left join OrderItems i (i.OrderId == o.Id)
| filter i.Id == null
| sort o.Id
| select OrderId = o.Id
```

**Left join with grouping.** The non-null item ID is absent on an unmatched row,
so `count(i.Id)` counts actual items rather than the outer placeholder row.

```conjure
from Orders o
| left join OrderItems i (i.OrderId == o.Id)
| group o.Id (aggregate ItemCount = count(i.Id))
| sort o.Id
| select { OrderId = o.Id, ItemCount }
```

**Right and full joins:**

```conjure
from Players p
| right join Orders o (p.Id == o.PlayerId && o.Total >= 100m)
| sort o.Id
| select { OrderId = o.Id, PlayerName = p.Name, o.Total }
```

```conjure
from Players p
| full join Orders o (p.Id == o.PlayerId)
| select { PlayerId = p.Id, OrderId = o.Id }
| sort { PlayerId nulls last, OrderId nulls last }
```

**Existence and non-existence.** Use a correlated nested pipeline instead of a
semi/anti-join source spelling. The child filters its own rows; `any` produces a
non-nullable Boolean, not a projected ID coerced to Boolean.

```conjure
from Players p
| filter (from Orders o | filter o.PlayerId == p.Id | any)
| sort p.Id
| select p.Id
```

```conjure
from Players p
| filter !(from Orders o | filter o.PlayerId == p.Id | any)
| sort p.Id
| select p.Id
```

**Join with a reduced subquery source.** The child has named outputs that the
outer alias can reference:

```conjure
from Players p
| join (
    from Orders o
    | group o.PlayerId (aggregate Cnt = count())
    | select { PlayerId = o.PlayerId, Cnt }
  ) t (t.PlayerId == p.Id)
| sort { -t.Cnt, p.Id }
| select { p.Id, t.Cnt }
```

### Aggregations

A group is a **scope**, not an implicit reduction. Its body is a source-less
pipeline applied independently to each key. `aggregate` reduces its actual input.
One named aggregate is unbraced; two or more aggregates use a block.

**Grouped totals and HAVING.** SQL:

```sql
SELECT o.PlayerId, SUM(o.Total) AS SumTotal, COUNT(*) AS Cnt
FROM Orders AS o
GROUP BY o.PlayerId
HAVING SUM(o.Total) > 200;
```

```conjure
from Orders o
| group o.PlayerId (aggregate { SumTotal = sum(o.Total), Cnt = count() })
| filter SumTotal > 200m
| sort o.PlayerId
| select { PlayerId = o.PlayerId, SumTotal, Cnt }
```

**Multiple keys** use a key block, not a parenthesized key list:

```conjure
from Players p
| group { p.Level, p.Score } (aggregate Players = count())
| select { p.Level, p.Score, Players }
```

**Whole-input aggregates** do not require an empty group key:

```conjure
from Orders o
| aggregate { AvgTotal = avg(o.Total), DistinctPlayers = count_distinct(o.PlayerId) }
```

`count()` counts rows; `count(value)` counts present values;
`count_distinct(value)` counts distinct present values. These aggregate counts
return non-nullable `long` and produce zero for empty input. Value reductions
such as `sum`, `avg`, `min`, and `max` have their own nullable empty-input result
contracts. Integer `sum` widens; do not infer every result type from its operand.
A populated group does not prove every filtered or nullable reduction nonempty.

**Scalar aggregate** results use one unnamed aggregate:

```conjure
from Orders o | aggregate sum(o.Total)
```

The declared result of that example is `decimal?`, not a named row. For a
row-shaped result, author the output name, for example `aggregate Total = sum(o.Total)`.

**Sum of distinct values.** Deduplicate the actual input before reducing it;
there is no DISTINCT modifier inside a scalar aggregate call:

```conjure
from Players p | select p.Score | distinct | aggregate sum(Score)
```

**Filtered aggregate:**

```conjure
from Players p | aggregate HighCount = count() filter (p.Level >= 10)
```

The suffix changes input to that aggregate only. A preceding pipeline `filter`
would instead change input to every aggregate in that stage.

### Window Functions Examples

Window expressions belong in `derive`. Partitioning comes from an enclosing
`group`; ordering comes from a preceding `sort` inside the relevant scope.
Aggregate windows require an explicit frame. Ranking/navigation functions such
as `row_number`, `rank`, `dense_rank`, `lag`, and `lead` forbid an aggregate frame.

**Global row number:**

```conjure
from Players p
| sort { -p.Score, p.Id }
| derive Rn = row_number()
| select { p.Id, p.Score, Rn }
```

**Top N per group.** SQL:

```sql
SELECT Id, Name, CategoryId, Price FROM (
    SELECT p.*, ROW_NUMBER() OVER (PARTITION BY CategoryId ORDER BY Price DESC, Id) AS Rn
    FROM Products AS p
) ranked WHERE Rn <= :n;
```

```conjure
from Products p
| group p.CategoryId (
    sort { -p.Price, p.Id }
    | derive Rn = row_number()
    | filter Rn <= @n
    | select { p.Id, p.Name, p.CategoryId, p.Price }
  )
```

The child limit or filter is per partition, not one global top N. A sort inside
the group is not a global sort of the flattened output.

**Running total:**

```conjure
from Orders o
| sort o.Id
| derive RunningTotal = sum(o.Total) over rows(unbounded, 0)
| select { o.Id, o.Total, RunningTotal }
```

**Partitioned running total:**

```conjure
from Orders o
| group o.PlayerId (
    sort o.Id
    | derive RunningTotal = sum(o.Total) over rows(unbounded, 0)
    | filter RunningTotal >= 250m
    | select { o.Id, o.PlayerId, o.Total, RunningTotal }
  )
```

**Moving average and navigation:**

```conjure
from Sales s
| group s.Region (
    sort { s.Date, s.Id }
    | derive {
        MovingAvg = avg(s.Amount) over rows(-6, 0),
        Prev = lag(s.Amount),
        Next = lead(s.Amount)
      }
    | select { s.Date, s.Amount, MovingAvg, Prev, Next }
  )
```

Frame endpoints are inclusive: `rows(-6, 0)` includes six preceding rows through
the current row. This differs from half-open scalar range membership. A `range`
frame measures key values, requires one compatible numeric/temporal sort key,
and uses its admitted row-invariant offsets. Navigation absence and result
carriers follow their selected window overloads, not the type of an ordinary
aggregate with the same spelling.

### Complex Queries

**Derived conditional values and casts:**

```conjure
from Players p
| derive {
    Tier = p.Score >= 1000 ? "Diamond" : (p.Score >= 500 ? "Gold" : "Silver"),
    ScaledScore = p.Score as double
  }
| sort p.Id
| select { p.Id, Tier, ScaledScore }
```

**Named intermediate pipelines and set operations:**

```conjure
let high_ids = (from Players p | filter p.Score > 500 | select p.Id)
from high_ids
| union (from Players other | filter other.Level >= 10 | select other.Id)
| sort Id
```

Both sides must have compatible projected types/shapes. `union` removes
duplicates; `union all` preserves them. This does not introduce recursive CTE
semantics or reconcile unrelated named outputs by position.

**A correlated scalar reduction and child collection:**

```conjure
from Players p
| sort p.Id
| select {
    p.Id,
    Total = (from Orders o | filter o.PlayerId == p.Id | aggregate sum(o.Total)),
    OrderIds = (from Orders child | filter child.PlayerId == p.Id | sort child.Id | select child.Id)
  }
```

The outer result needs a nullable decimal `Total` member and an `int[]` child
member. The child pipeline's sort applies separately to each player. There is no
collection wrapper function or PascalCase collection-method call here.

**Correlated membership:**

```conjure
from Players p
| filter p.OptionalScore != null
| filter p.OptionalScore in (
    from Players q
    | filter q.Level == p.Level && q.OptionalScore != null && q.Score >= 50
    | select q.OptionalScore
  )
| select p.Id
```

**Outer join with an explicit fallback:**

```conjure
from Orders o
| left join Customers c (o.CustomerId == c.Id)
| sort o.Id
| select { o.Id, CustomerName = c.Name ?? "Unknown", o.Total }
```

The fallback supplies the required value; an absent outer row does not silently
become an empty string or numeric zero.

## Result Shapes and Cardinality

A query declaration chooses the result surface. For example, given the `Players`
source described above:

```conjure
query PlayerIds() -> int[] {
    from Players p | sort p.Id | select p.Id
}
query PlayerCount() -> long {
    from Players p | aggregate count()
}
query HighestScore() -> int? {
    from Players p | sort { -p.Score, p.Id } | select p.Score | first_or_default
}
query HasPlayers() -> bool {
    from Players p | any
}
```

`T[]`, `pooled<T>`, `seq<T>`, and `map<K, V>` select different generated surfaces;
a declaration does not automatically emit all of them. A streaming signature
selects its consumer method, and a pooled result is a caller-disposed read-only
lease. Module-owned queries retain their generated module interface; selecting a
surface does not move the method to a different owner.

For scalar/row results, `single` checks exactly one row and `single_or_default`
checks at most one while preserving absence. `first`/`first_or_default` select a
row from an actual defined order rather than checking uniqueness. Whether a
marker is required, redundant, or invalid depends on the declared result and the
compiler's completed cardinality proof. An array signature is not made scalar by
appending a terminal, and optional numeric absence is not `default(int)`.

The old `| count` terminal is retired; use aggregate `count()` returning `long`.
That replacement does not prove equality with the old `int` result API. There is
no `to_list` terminal: the declared collection surface owns materialization.

These examples deliberately author current named outputs and result signatures.
They do not establish public-API equivalence for an existing generated corpus;
changing a shipped query requires checking its actual generated contract.

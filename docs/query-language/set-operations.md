# Set Operations & Composition Reference

> **Source format**: current canonical `.conjure` syntax (owning format marker `2`)
> **Audience**: Developers writing compiled queries via `query`
> **See also:** [Query Language](/docs/query-language/reference) · [SQL Reference](/docs/query-language/sql-reference) · [Functions Reference](/docs/query-language/functions)

---

This document covers set-level operations that combine multiple pipelines,
reusable named-subquery bindings (`let`), and
subquery expressions. Examples show fragments for a braced `query` body;
declare `min: decimal` in the containing query's typed header where `@min` is used.
Tables and columns in a fragment must be declared by the containing schema; the
examples use `Players` (`Id`, `Name`, `Level`, `Score`, `GuildId`, `MiddleName`,
`OptionalScore`), `Guilds` (`Id`, `GuildName`, `IsActive`), `Customers` (`Id`,
`Name`, `IsVip`), `Orders` (`Id`, `PlayerId`, `CustomerId`, `Total`, `TotalAmount`,
`Amount`, `Status`), `OrderItems` (`OrderId`, `Qty`), and `Products` (`Id`,
`CategoryId`, `Discontinued`). IDs and levels are integers, amounts are decimal,
names/status are strings, and flags are Boolean; `MiddleName` and `OptionalScore`
are nullable string and numeric columns. Adapt both the declarations and result
shape together rather than treating these names as built-in data sources.

## Table of Contents

- [Set Operations](#set-operations)
- [LET Bindings (CTEs)](#let-bindings-ctes)
- [SQL-Style WITH Status](#sql-style-with-status)
- [Subquery Expressions](#subquery-expressions)
- [Examples](#examples)
  - [Subqueries](#subqueries)
  - [Named Subqueries and Composition](#named-subqueries-and-composition)
  - [Set Operations Examples](#set-operations-examples)

---

## Set Operations

Combines results from multiple pipelines.

**Syntax:**

```ebnf
set_op = "union" ["all"] "(" pipeline ")"
       | "intersect" ["all"] "(" pipeline ")"
       | "except" ["all"] "(" pipeline ")" ;
```

| Operator | Description | Duplicates |
|----------|-------------|------------|
| `union` | Combine rows from both sides | Removed |
| `union all` | Combine rows from both sides | Kept |
| `intersect` | Rows present in both sides | Removed |
| `intersect all` | Rows present in both sides | Kept |
| `except` | Left rows not present in right | Removed |
| `except all` | Left rows not present in right | Kept |

Both operands must publish compatible result shapes. Matching uses the projected
values. Project the intended keys before a set operation; to retain a complete
left row while testing a key, use correlated existence instead of a `by` clause.
`intersect all` keeps the minimum multiplicity on the two sides; `except all`
subtracts right-side multiplicity, stopping at zero.

**Examples — union:**

```conjure
from Players | filter Level > 10 | select Id
| union (from Players | filter Score > 1000 | select Id)
| sort Id
```

**Examples — union all:**

```conjure
from Players | filter Level > 10 | select Id
| union all (from Players | filter Score >= 2000 | select Id)
| sort Id
```

**Examples — intersect:**

```conjure
from Players | filter Level > 10 | select Id
| intersect (from Players | filter Score > 1000 | select Id)
| sort Id
```

**Examples — intersect all:**

```conjure
from Players p | filter p.Level >= 10 | select { p.MiddleName, p.OptionalScore }
| intersect all (from Players x | filter x.OptionalScore == null || x.MiddleName == null | select { x.MiddleName, x.OptionalScore })
```

**Examples — except:**

```conjure
from Players | filter Score > 1000 | select Id
| except (from Players | filter Level > 10 | select Id)
| sort Id
```

**Example — key-based exclusion while retaining the left row:**

```conjure
from Products p | filter p.CategoryId == 1
| filter !exists(from Products other | filter other.Discontinued && other.Id == p.Id)
```

**SQL equivalent:**

```sql
-- union all
SELECT Id FROM Players WHERE Level > 10
UNION ALL
SELECT Id FROM Players WHERE Score >= 2000;

-- except
SELECT Id FROM Players WHERE Score > 1000
EXCEPT
SELECT Id FROM Players WHERE Level > 10;
```

## LET Bindings (CTEs)

Defines reusable named pipelines inside a query body, before its main pipeline.
Bindings are query-local and non-recursive; they are not module-level variables.
SQL-style `with` is not an alternative DSL spelling.

**Syntax:**

```ebnf
let_decl = "let" IDENT "=" "(" pipeline ")" ;
```

**Examples — single binding:**

```conjure
let top_players = (from Players | filter Score > 1000 | select { Id, Name, Score, GuildId })

from top_players t
| join Guilds g (t.GuildId == g.Id)
| select { t.Name, g.GuildName }
```

**Examples — multiple bindings:**

```conjure
let high_value = (from Orders | filter TotalAmount > @min)
let vip_customers = (from Customers | filter IsVip == true)

from high_value h
| join vip_customers v (h.CustomerId == v.Id)
| select { h.Id, v.Name, h.TotalAmount }
| sort -TotalAmount
```

**SQL equivalent:**

```sql
-- let top_players = (...) from top_players ...
WITH top_players AS (SELECT Id, Name, Score, GuildId FROM Players WHERE Score > 1000)
SELECT t.Name, g.GuildName
FROM top_players t JOIN Guilds g ON t.GuildId = g.Id;
```

**Bare set operations are retired.** `A union from B` (no `|`, no parentheses) is refused with `SCH2173`; write `A | union (from B)`. The retired bare form was right-associative: its operand ran to the end of the enclosing pipeline, so `A union from B union from C` meant `A | union (from B | union (from C))`, not SQL's left-to-right evaluation of a set-operation chain. The canonical stage is explicit about its operand.

---
## SQL-Style WITH Status

SQL-style `with Name as (...)` is a retired spelling: the parser refuses it with `SCH2173`, and a fix-it rewrites a single CTE to `let Name = (...)`. A `with` that declares several CTEs is refused without a fix-it (one edit cannot rewrite them all); write one `let` per CTE. A CTE column list (`Name(col1, col2) as (...)`) used to be parsed and silently dropped; it is refused without a fix-it, because renaming the outputs needs an explicit `select` inside the `let`.

- Use `let name = (pipeline)` for named-subquery reuse.
- `| into name` is retired as well; write `let name = (pipeline)` and start a new `from name` pipeline.
- `with recursive ... as (...)` is rejected with UM5003. Recursive/transitive-closure traversal is not implemented.

---

## Subquery Expressions

A parenthesized pipeline can be correlated with aliases from its enclosing query.
An unnamed aggregate supplies a scalar reduction; collection projections and
scalar terminals have different result contracts. An arbitrary multirow selection
is not automatically a scalar. Declare the containing query's result type and
cardinality accordingly. See [Query Language](/docs/query-language/reference#result-signatures-and-cardinality).

**Scalar subquery (single-value result):**

```conjure
from Players p
| select { p.Id, OrderCount = (from Orders o | filter o.PlayerId == p.Id | aggregate count()) }
```

**IN subquery:**

```conjure
from Players
| filter GuildId in (from Guilds | filter IsActive == true | select Id)
```

**EXISTS subquery:**

```conjure
from Players p
| filter exists (from Orders o | filter o.PlayerId == p.Id)
```

---

A multi-output `select` uses a named tuple (`select { ... }`); a single
output is scalar (`select Id`). A group body has its own scope: reduce and name
its outputs before the enclosing pipeline reads them.

## Examples

### Subqueries

**Correlated EXISTS:**

```conjure
from Players p
| filter exists(from Orders o | filter o.PlayerId == p.Id && o.Total > 100m | select o.Id)
| select p.Id
| sort p.Id
```

**Correlated NOT EXISTS:**

```conjure
from Players p
| filter !exists(from Orders o | filter o.PlayerId == p.Id && o.Total > 100m | select o.Id)
| select p.Id
| sort p.Id
```

**Correlated IN:**

```conjure
from Orders o
| filter o.Id in (from OrderItems i | filter i.OrderId == o.Id | select i.OrderId)
| select o.Id
| sort o.Id
```

**Correlated NOT IN:**

Negated membership is not interchangeable with `!exists` or `!(x in S)` in the
presence of null values. See [nulls in membership](/docs/query-language/reference#nulls-in-membership).

```conjure
from Orders o
| filter o.Id not in (from OrderItems i | filter i.OrderId == o.Id && i.Qty > 1 | select i.OrderId)
| select o.Id
| sort o.Id
```

**Combined EXISTS and IN:**

```conjure
from Players p
| filter exists(from Orders o | filter o.PlayerId == p.Id && o.Total > 20m | select o.Id)
  && !exists(from Orders n | filter n.PlayerId == p.Id && n.Total < 0m | select n.Id)
  && p.Id in (
    from Orders a | filter a.Total >= 20m | select a.PlayerId
    | intersect all (from Orders b | filter b.Total <= 100m | select b.PlayerId)
  )
```

### Named Subqueries and Composition

**Simple let binding:**

```conjure
let high_value = (from Orders | filter TotalAmount > @min)

from high_value h
| join Customers c (h.CustomerId == c.Id)
| select { h.Id, c.Name, h.TotalAmount }
| sort -TotalAmount
```

For staged composition, use `let` bindings. `with recursive` is rejected with UM5003 rather than silently evaluating only an anchor pipeline.

**Staged pipeline with let:**

```conjure
let shipped = (from Orders | filter Status == "Shipped")
from shipped
| group CustomerId (aggregate Total = sum(Amount))
| sort -Total
| take 10
```


### Set Operations Examples

**Union:**

```conjure
from Players | filter Level > 10 | select Id
| union (from Players | filter Score > 1000 | select Id)
| sort Id
```

**Union all:**

```conjure
from Players | filter Level > 10 | select Id
| union all (from Players | filter Score >= 2000 | select Id)
| sort Id
```

**Union with post-processing:**

```conjure
from Players p | filter p.Score >= 80 | select { Tier = p.Level, ActorId = p.Id }
| union (from Players p2 | filter p2.Level >= 2 && p2.Score >= 60 | select { Tier = p2.Level, ActorId = p2.Id })
| filter Tier >= 2
| group Tier (aggregate DistinctActors = count_distinct(ActorId))
| select { Tier, DistinctActors }
| sort { -DistinctActors, Tier }
```

**Intersect:**

```conjure
from Players | filter Level > 10 | select Id
| intersect (from Players | filter Score > 1000 | select Id)
| sort Id
```

**Intersect all with NULLs:**

```conjure
from Players p | filter p.Level >= 10 | select { p.MiddleName, p.OptionalScore }
| intersect all (
    from Players x
    | filter x.OptionalScore == null || x.MiddleName == null
    | select { x.MiddleName, x.OptionalScore }
  )
```

**Except:**

```conjure
from Players | filter Score > 1000 | select Id
| except (from Players | filter Level > 10 | select Id)
| sort Id
```

**Except all:**

```conjure
from Players p | filter p.Level >= 10 | select { p.MiddleName, p.OptionalScore }
| except all (
    from Players x
    | filter x.OptionalScore == null
    | select { x.MiddleName, x.OptionalScore }
  )
```

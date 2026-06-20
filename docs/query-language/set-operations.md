# Set Operations & Composition Reference

> **Version**: 1.0 — ConjureDB Compiler
> **Audience**: Developers writing compiled queries via `query`
> **See also:** [Query Language](/docs/query-language/reference) · [SQL Reference](/docs/query-language/sql-reference) · [Functions Reference](/docs/query-language/functions)

---

This document covers set-level operations that combine multiple pipelines, reusable named sub-query bindings (`let` / `into`), and subquery expressions.

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
       | "intersect" ["all"] "(" pipeline ")" ["by" column_list]
       | "except" ["all"] "(" pipeline ")" ["by" column_list] ;
```

| Operator | Description | Duplicates |
|----------|-------------|------------|
| `union` | Combine rows from both sides | Removed |
| `union all` | Combine rows from both sides | Kept |
| `intersect` | Rows present in both sides | Removed |
| `intersect all` | Rows present in both sides | Kept |
| `except` | Left rows not present in right | Removed |
| `except all` | Left rows not present in right | Kept |

The optional `by` clause specifies which columns to use for matching (for `intersect` and `except`).

**Examples — union:**

```
from Players | filter Level > 10 | select Id
| union (from Players | filter Score > 1000 | select Id)
| sort Id
```

**Examples — union all:**

```
from Players | filter Level > 10 | select Id
| union all (from Players | filter Score >= 2000 | select Id)
| sort Id
```

**Examples — intersect:**

```
from Players | filter Level > 10 | select Id
| intersect (from Players | filter Score > 1000 | select Id)
| sort Id
```

**Examples — intersect all:**

```
from Players p | filter p.Level >= 10 | select { p.MiddleName, p.OptionalScore }
| intersect all (from Players x | filter x.OptionalScore is null || x.MiddleName is null | select { x.MiddleName, x.OptionalScore })
```

**Examples — except:**

```
from Players | filter Score > 1000 | select Id
| except (from Players | filter Level > 10 | select Id)
| sort Id
```

**Examples — except with by:**

```
from Products | filter CategoryId == 1
| except (from Products | filter Discontinued == true) by Id
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

Defines reusable named sub-queries at the module level. This is conceptually similar to a non-recursive SQL `WITH` binding, but `let` is the supported DSL surface.

**Syntax:**

```ebnf
let_decl = "let" IDENT "=" "(" pipeline ")" ;
```

**Examples — single binding:**

```
let top_players = (from Players | filter Score > 1000 | select Id, Name, Score)

from top_players t
| join Guilds g (t.GuildId == g.Id)
| select t.Name, g.GuildName
```

**Examples — multiple bindings:**

```
let high_value = (from Orders | filter TotalAmount > @min)
let vip_customers = (from Customers | filter IsVip == true)

from high_value h
| join vip_customers v (h.CustomerId == v.Id)
| select h.Id, v.Name, h.TotalAmount
| sort -h.TotalAmount
```

**SQL equivalent:**

```sql
-- let top_players = (...) from top_players ...
WITH top_players AS (SELECT Id, Name, Score FROM Players WHERE Score > 1000)
SELECT t.Name, g.GuildName
FROM top_players t JOIN Guilds g ON t.GuildId = g.Id;
```

---
## SQL-Style WITH Status

SQL-style `with ... as (...)` and `with recursive ... as (...)` text is **not** part of the supported DSL contract today.

- Use `let name = (pipeline)` for supported named-subquery reuse.
- Use `| into name` for a lightweight single-pipeline handoff.
- Expect SQL-style `WITH`, `WITH RECURSIVE`, and column-list CTE declarations to fail at compile time until the compiler exposes a first-class, fully supported contract for them.

---

## Subquery Expressions

Subqueries can appear in several expression positions.

**Scalar subquery (single-value result):**

```
from Players p
| select p.Id, (from Orders o | filter o.PlayerId == p.Id | aggregate { Cnt = count o.Id }) as OrderCount
```

**IN subquery:**

```
from Players
| filter GuildId in (from Guilds | filter IsActive == true | select Id)
```

**EXISTS subquery:**

```
from Players p
| filter exists (from Orders o | filter o.PlayerId == p.Id)
```

---

## Examples

### Subqueries

**Correlated EXISTS:**

```
from Players p
| filter exists(from Orders o | filter o.PlayerId == p.Id && o.Total > 100 | select o.Id)
| select p.Id
| sort p.Id
```

**Correlated NOT EXISTS:**

```
from Players p
| filter not exists(from Orders o | filter o.PlayerId == p.Id && o.Total > 100 | select o.Id)
| select p.Id
| sort p.Id
```

**Correlated IN:**

```
from Orders o
| filter o.Id in (from OrderItems i | filter i.OrderId == o.Id | select i.OrderId)
| select o.Id
| sort o.Id
```

**Correlated NOT IN:**

```
from Orders o
| filter o.Id not in (from OrderItems i | filter i.OrderId == o.Id && i.Qty > 1 | select i.OrderId)
| select o.Id
| sort o.Id
```

**Combined EXISTS and IN:**

```
from Players p
| filter exists(from Orders o | filter o.PlayerId == p.Id && o.Total > 20 | select o.Id)
  && not exists(from Orders n | filter n.PlayerId == p.Id && n.Total < 0 | select n.Id)
  && p.Id in (
    from Orders a | filter a.Total >= 20 | select a.PlayerId
    | intersect all (from Orders b | filter b.Total <= 100 | select b.PlayerId)
  )
```

### Named Subqueries and Composition

**Simple let binding:**

```
let high_value = (from Orders | filter TotalAmount > @min)

from high_value h
| join Customers c (h.CustomerId == c.Id)
| select h.Id, c.Name, h.TotalAmount
| sort -h.TotalAmount
```

For staged composition, prefer supported `let` bindings or `| into` handoffs. SQL-style `with` / `with recursive` examples are intentionally omitted here because they are not part of the supported DSL contract yet.

**Pipeline with into:**

```
from Orders
| filter Status == "Shipped"
| into shipped

from shipped
| group CustomerId (aggregate { Total = sum Amount })
| sort -Total
| take 10
```


### Set Operations Examples

**Union:**

```
from Players | filter Level > 10 | select Id
| union (from Players | filter Score > 1000 | select Id)
| sort Id
```

**Union all:**

```
from Players | filter Level > 10 | select Id
| union all (from Players | filter Score >= 2000 | select Id)
| sort Id
```

**Union with post-processing:**

```
from Players p | filter p.Score >= 80 | select { Tier = p.Level, ActorId = p.Id }
| union (from Players p2 | filter p2.Level >= 2 && p2.Score >= 60 | select { Tier = p2.Level, ActorId = p2.Id })
| filter Tier >= 2
| group Tier (aggregate { DistinctActors = count ActorId })
| select { Tier, DistinctActors }
| sort -DistinctActors, Tier
```

**Intersect:**

```
from Players | filter Level > 10 | select Id
| intersect (from Players | filter Score > 1000 | select Id)
| sort Id
```

**Intersect all with NULLs:**

```
from Players p | filter p.Level >= 10 | select { p.MiddleName, p.OptionalScore }
| intersect all (
    from Players x
    | filter x.OptionalScore is null || x.MiddleName is null
    | select { x.MiddleName, x.OptionalScore }
  )
```

**Except:**

```
from Players | filter Score > 1000 | select Id
| except (from Players | filter Level > 10 | select Id)
| sort Id
```

**Except all:**

```
from Players p | filter p.Level >= 10 | select { p.MiddleName, p.OptionalScore }
| except all (
    from Players x
    | filter x.OptionalScore is null
    | select { x.MiddleName, x.OptionalScore }
  )
```

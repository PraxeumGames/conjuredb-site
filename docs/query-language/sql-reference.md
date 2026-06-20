# SQL Reference & Examples

> **Version**: 1.0 — ConjureDB Compiler
> **Audience**: Developers writing compiled queries via `query`
> **See also:** [Query Language](/docs/query-language/reference) · [Set Operations](/docs/query-language/set-operations) · [Functions Reference](/docs/query-language/functions) · [Mutations](/docs/query-language/mutations)

---

This document provides a complete mapping between ConjureDB DSL syntax and SQL equivalents, plus practical query examples from basic to advanced.

## Table of Contents

- [SQL Equivalents](#sql-equivalents)
- [Examples](#examples)
  - [Basic Queries](#basic-queries)
  - [Filtering and Sorting](#filtering-and-sorting)
  - [Joins](#joins)
  - [Aggregations](#aggregations)
  - [Window Functions Examples](#window-functions-examples)
  - [Complex Queries](#complex-queries)

---

## SQL Equivalents

Complete mapping between ConjureDB DSL syntax and SQL equivalents.

| ConjureDB DSL | SQL Equivalent |
|---------------|----------------|
| `from Table t` | `FROM Table t` / `FROM Table AS t` |
| `filter condition` | `WHERE condition` |
| `filter` after `group` | `HAVING condition` |
| `select col1, col2` | `SELECT col1, col2` |
| `select col as alias` | `SELECT col AS alias` |
| `select Alias = expr` | `SELECT expr AS Alias` |
| `derive Col = expr` | `SELECT *, expr AS Col` |
| `join T t (pred)` | `INNER JOIN T t ON pred` |
| `left join T t (pred)` | `LEFT OUTER JOIN T t ON pred` |
| `right join T t (pred)` | `RIGHT OUTER JOIN T t ON pred` |
| `full join T t (pred)` | `FULL OUTER JOIN T t ON pred` |
| `semi join T t (pred)` | `WHERE EXISTS (SELECT 1 FROM T t WHERE pred)` |
| `anti join T t (pred)` | `WHERE NOT EXISTS (SELECT 1 FROM T t WHERE pred)` |
| `group col (aggregate {...})` | `GROUP BY col` with aggregate `SELECT` |
| `aggregate { A = sum X }` | `SELECT SUM(X) AS A` (no `GROUP BY`) |
| `sort col` | `ORDER BY col ASC` |
| `sort -col` | `ORDER BY col DESC` |
| `sort col nulls first` | `ORDER BY col NULLS FIRST` |
| `take N` | `LIMIT N` / `TOP N` |
| `skip N` | `OFFSET N` |
| `distinct` | `SELECT DISTINCT` |
| `let name = (...)` | `WITH name AS (...)` |
| `\| into var` | `WITH var AS (...)` (implicit) |
| `union (...)` | `UNION (...)` |
| `union all (...)` | `UNION ALL (...)` |
| `intersect (...)` | `INTERSECT (...)` |
| `intersect all (...)` | `INTERSECT ALL (...)` |
| `except (...)` | `EXCEPT (...)` |
| `except all (...)` | `EXCEPT ALL (...)` |
| `X between A and B` | `X BETWEEN A AND B` |
| `X in (...)` | `X IN (...)` |
| `X not in (...)` | `X NOT IN (...)` |
| `exists (...)` | `EXISTS (...)` |
| `not exists (...)` | `NOT EXISTS (...)` |
| `X is null` | `X IS NULL` |
| `X is not null` | `X IS NOT NULL` |
| `X ?? Y` | `COALESCE(X, Y)` |
| `coalesce(X, Y)` | `COALESCE(X, Y)` |
| `X switch { >= V => R, _ => D }` | `CASE WHEN X >= V THEN R ELSE D END` |
| `cast(X as type)` | `CAST(X AS type)` |
| `X like 'pattern'` | `X LIKE 'pattern'` |
| `X contains Y` | `X LIKE '%' \|\| Y \|\| '%'` / `INSTR(X, Y) > 0` |
| `count(distinct X)` | `COUNT(DISTINCT X)` |
| `agg(X) filter (where P)` | `agg(X) FILTER (WHERE P)` (PostgreSQL) |
| `window (Rn = row_number)` | `ROW_NUMBER() OVER (ORDER BY ...)` |
| `window by Col (Rn = row_number)` | `ROW_NUMBER() OVER (PARTITION BY Col ORDER BY ...)` |
| `sum X frame: -6..0` | `SUM(X) OVER (... ROWS BETWEEN 6 PRECEDING AND CURRENT ROW)` |
| `o.Product.Name` (navigation) | `JOIN Products p ON o.ProductId = p.Id` → `p.Name` |
| `o.Product?.Name` (safe nav) | `LEFT JOIN Products p ON o.ProductId = p.Id` → `p.Name` |
| `c.Orders.Any()` (collection nav) | `EXISTS (SELECT 1 FROM Orders WHERE CustomerId = c.Id)` |
| `c.Orders.Count()` (collection nav) | `(SELECT COUNT(*) FROM Orders WHERE CustomerId = c.Id)` |

> `WITH ... AS (...)` and `WITH RECURSIVE ... AS (...)` remain SQL equivalents only. The supported DSL input surface for named subqueries is `let` (or `| into`), not raw SQL-style `with` text.

---
## Examples

### Basic Queries

**Select all columns:**

```
from Players | select Id, Name, Level, Score | sort Id
```

**Filter and project:**

```
from Players
| filter Level >= 10
| select Id, Name
| sort Id
```

**Computed columns:**

```
from Players p
| derive { DoubleScore = p.Score * 2 }
| select { p.Id, DoubleScore }
| sort p.Id
```

**Distinct values:**

```
from Players | select Level | distinct | sort Level
```

**Pagination:**

```
from Players | select Id | sort Id | skip 1 | take 2
```

### Filtering and Sorting

**Multi-condition filter:**

```
from Players p
| filter p.Level >= 10 && p.Score > 500
| select p.Id, p.Name
| sort -p.Score
```

**NULL filtering:**

```
from Players | filter Name is null | select Id | sort Id
from Players | filter Name is not null | select Id, Name | sort Id
```

**Pattern matching:**

```
from Players | filter Name like 'A%' | select Id, Name | sort Id
```

**Multi-column sort with NULL ordering:**

```
from Players | sort Name nulls last, Id
```

**BETWEEN:**

```
from Players | filter Level between 10 and 50 | select Id, Level | sort Id
```

### Joins

**Inner join with compound predicate:**

```
from Players p
| join Orders o (p.Id == o.PlayerId && o.Total > 100)
| select p.Name, o.Total
| sort o.Total
```

**Left join detecting missing matches:**

```
from Orders o
| left join OrderItems i (i.OrderId == o.Id)
| filter i.Id is null
| select { OrderId = o.Id }
| sort o.Id
```

**Left join with grouping:**

```
from Orders o
| left join OrderItems i (i.OrderId == o.Id)
| group o.Id (aggregate { ItemCount = count i.Id })
| select { OrderId = o.Id, ItemCount }
| sort o.Id
```

**Right join:**

```
from Players p
| right join Orders o (p.Id == o.PlayerId && o.Total >= 100)
| select { OrderId = o.Id, PlayerName = p.Name, o.Total }
| sort o.Id
```

**Full join:**

```
from Players p
| full join Orders o (p.Id == o.PlayerId)
| select p.Id as PlayerId, o.Id as OrderId
| sort PlayerId, OrderId
```

**Semi join (players with orders):**

```
from Players p
| semi join Orders o (p.Id == o.PlayerId)
| select p.Id
| sort p.Id
```

**Anti join (players without orders):**

```
from Players p
| anti join Orders o (p.Id == o.PlayerId)
| select p.Id
| sort p.Id
```

**Multi-table join chain:**

```
from Players p
| join Orders o (p.Id == o.PlayerId)
| join OrderItems i (i.OrderId == o.Id)
| select { p.Name, i.Qty }
| sort p.Id, i.Id
```

**Join with subquery source:**

```
from Players p
| join (
    from Orders o
    | sort -o.Total, o.Id | take 6
    | group o.PlayerId (aggregate { Cnt = count o.Id })
    | select { o.PlayerId, Cnt }
    | distinct
    | sort -Cnt, o.PlayerId | take 2
  ) t (t.PlayerId == p.Id)
| select { p.Id, t.Cnt }
| sort -t.Cnt, p.Id
```

### Aggregations

**Basic aggregation with grouping:**

```
from Orders o
| group o.PlayerId (aggregate { SumTotal = sum o.Total, Cnt = count o.Id })
| select o.PlayerId, SumTotal, Cnt
| sort o.PlayerId
```

**Multi-key grouping:**

```
from Orders o
| group (o.PlayerId, o.Id) (aggregate { MinTotal = min o.Total, MaxTotal = max o.Total })
| select { o.PlayerId, o.Id, MinTotal, MaxTotal }
| sort o.PlayerId, o.Id
```

**Global aggregate (no grouping):**

```
from Orders o
| group {} (aggregate { AvgTotal = avg o.Total, DistinctPlayers = count(distinct o.PlayerId) })
| select AvgTotal, DistinctPlayers
```

**HAVING (post-group filter):**

```
from Orders o
| group o.PlayerId (aggregate { SumTotal = sum o.Total })
| filter SumTotal > 200
| select o.PlayerId, SumTotal
| sort o.PlayerId
```

**Scalar aggregate (entire table):**

```
from Orders
| aggregate { TotalRevenue = sum Amount, OrderCount = count Id, AvgOrder = avg Amount }
```

**DISTINCT aggregate:**

```
from Players | aggregate { DistinctScore = sum(distinct Score) }
```

**Filtered aggregate:**

```
from Players | aggregate { HighCount = count(Id) filter (where Level >= 10) }
```

**Semi-join with aggregation:**

```
from Players p
| semi join Orders o (p.Id == o.PlayerId && o.Total >= 100)
| group p.Level (aggregate { EngagedPlayers = count p.Id, TotalScore = sum p.Score })
```

### Window Functions Examples

**Top-N per group:**

```
from Products
| sort -Price
| window by CategoryId (Rank = row_number)
| filter Rank <= @n
| select Id, Name, CategoryId, Price
```

**Global row number:**

```
from Players p
| sort -p.Score, p.Id
| window (Rn = row_number)
| select { p.Id, p.Score, Rn }
```

**Partitioned row number:**

```
from Orders o
| sort o.Id
| window by o.PlayerId (Rn = row_number)
| select { o.Id, o.PlayerId, Rn }
| sort o.PlayerId, o.Id
```

**Running total:**

```
from Orders o
| sort o.Id
| window (RunningTotal = sum o.Total)
| select { o.Id, o.Total, RunningTotal }
```

**Partitioned running total with filter:**

```
from Orders o
| sort o.Id
| window by o.PlayerId (RunningTotal = sum o.Total)
| filter RunningTotal >= 250
| select { o.Id, o.PlayerId, o.Total, RunningTotal }
| sort o.PlayerId, o.Id
```

**Moving average:**

```
from Sales
| sort Date
| window (MovingAvg = avg Amount frame: -6..0)
| select Date, Amount, MovingAvg
```

**Lag/lead:**

```
from Sales
| sort Region, Date
| window by Region (Prev = lag Amount, Next = lead Amount)
| select Date, Amount, Prev, Next
```


### Complex Queries

**Switch with derived columns:**

```
from Players
| derive {
    Tier = Score switch {
        >= 1000 => "Diamond",
        >= 500  => "Gold",
        _       => "Silver"
    },
    PowerLevel = Level * Score
}
| select Id, Name, Tier, PowerLevel
```

**Multi-bucket switch:**

```
from Players
| select Id, (Score switch { >= 1000 => 2, >= 500 => 1, _ => 0 }) as Bucket
| sort Id
```

**Derive with filter and sort:**

```
from Players p
| derive { X = p.Score * 2 + p.Level }
| filter X >= 25
| select { p.Id, p.Score, X }
| sort p.Id
```

**Anti-join with aggregation:**

```
from Players p
| anti join Orders o (p.Id == o.PlayerId && o.Total >= 90)
| group p.Level (aggregate {
    DormantPlayers = count p.Id,
    MinScore = min p.Score,
    MaxTotal = max p.Score
  })
```

**Complex filter with EXISTS, NOT EXISTS, and IN:**

```
from Players p
| filter (p.Level >= 10 || exists(from Orders o | filter o.PlayerId == p.Id && o.Total > 100 | select o.Id))
  && p.Id > 0
| select p.Id
| sort p.Id
```

**Correlated subquery with intersect:**

```
from Players p
| filter p.OptionalScore is not null
| filter p.OptionalScore in (
    from Players q
    | filter q.Level == p.Level && q.OptionalScore is not null && q.Score >= 50
    | select q.OptionalScore
  )
```

**Left join with coalesce:**

```
from Orders o
| left join Customers c (o.CustomerId == c.Id)
| select o.Id, coalesce(c.Name, "Unknown") as CustomerName, o.TotalAmount
```

**Full pipeline — filtered join → group → sort → limit:**

```
from Reviews r
| join Products p (r.ProductId == p.Id)
| group p.Id (aggregate { AvgRating = average r.Rating, Count = count r.Id })
| filter Count >= 5
| sort -AvgRating
| take 10
```

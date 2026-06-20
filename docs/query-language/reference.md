# ConjureDB Query Language Reference

> **Version**: 1.0 — ConjureDB Compiler  
> **Audience**: Developers writing compiled queries via `query`

---

## Table of Contents

- [Overview](#overview)
- [Syntax](#syntax)
  - [Pipeline Structure](#pipeline-structure)
  - [Comments](#comments)
  - [Identifiers and Quoting](#identifiers-and-quoting)
- [Data Sources](#data-sources)
  - [FROM Clause](#from-clause)
  - [Table Aliases](#table-aliases)
  - [Subqueries as Sources](#subqueries-as-sources)
- [Transforms (Operators)](#transforms-operators)
  - [FILTER](#filter)
  - [SELECT](#select)
  - [DERIVE](#derive)
  - [JOIN](#join)
  - [GROUP](#group)
  - [AGGREGATE](#aggregate)
  - [WINDOW](#window)
  - [SORT](#sort)
  - [TAKE](#take)
  - [SKIP](#skip)
  - [DISTINCT](#distinct)
  - [INTO](#into)
- [ORM-Style Navigation](#orm-style-navigation)
  - [Dot-Path Navigation](#dot-path-navigation)
  - [Safe Navigation (`?.`)](#safe-navigation-)
  - [Navigation in JOIN Predicates](#navigation-in-join-predicates)
  - [Collection Navigation](#collection-navigation)
- [Expressions](#expressions)
  - [Literals](#literals)
  - [Parameters](#parameters)
  - [Operators](#operators)
  - [NULL Handling](#null-handling)
  - [Pattern Matching](#pattern-matching)
  - [Set Membership (IN / NOT IN)](#set-membership-in--not-in)
  - [BETWEEN](#between)
  - [EXISTS / NOT EXISTS](#exists--not-exists)
  - [Type Casting](#type-casting)
  - [Switch (CASE) Expressions](#switch-case-expressions)
  - [Method Call Syntax](#method-call-syntax)
- [See Also](#see-also)

---

## Overview

ConjureDB uses a **pipeline-based query language** inspired by PRQL and functional data transformation patterns. Queries are composed as a chain of **transforms** separated by the pipe operator (`|`), reading naturally from top to bottom.

Queries are compiled **ahead-of-time** into optimized, zero-allocation C# code. Each query is declared in a `.conjure` schema file with the `query` keyword; the source generator emits a method on the corresponding entity set (e.g. `context.Players.GetTopPlayersByScore(limit)`).

**Key design principles:**

- **Pipe-first**: Data flows through a linear chain of transforms, each operating on the output of the previous one.
- **Composable**: Sub-pipelines, `let` bindings, and `| into` naming enable modular query construction without dropping into SQL text.
- **Familiar**: Operator names map closely to SQL (`filter` ≈ `WHERE`, `select` ≈ `SELECT`, `group` ≈ `GROUP BY`), but the syntax removes nesting and subquery gymnastics.
- **Strongly typed**: All expressions are statically typed during AOT compilation. Type mismatches are compile-time errors, not runtime surprises.

**Relationship to SQL:**

| ConjureDB DSL | SQL Equivalent |
|---------------|----------------|
| `from Table` | `FROM Table` |
| `filter ...` | `WHERE ...` |
| `select ...` | `SELECT ...` |
| `derive ...` | `SELECT *, expr AS alias` |
| `join ...` | `JOIN ... ON ...` |
| `group ... (aggregate ...)` | `GROUP BY ... SELECT agg(...)` |
| `sort ...` | `ORDER BY ...` |
| `take N` | `LIMIT N` / `TOP N` |
| `skip N` | `OFFSET N` |
| `distinct` | `SELECT DISTINCT` |
| `let name = (...)` | `WITH name AS (...)` |

> **Support boundary:** the SQL equivalence table is conceptual. The supported named-subquery surface is `let` (and `| into`), while SQL-style `WITH` / `WITH RECURSIVE` text, SQLite `GLOB`, and per-sort collations such as `COLLATE NOCASE` are outside the current DSL contract and are expected to fail at compile time.

---
## Syntax

### Pipeline Structure

A query module consists of optional **`let` declarations** followed by a **main pipeline**:

```
[let name = (pipeline)]
[let name2 = (pipeline)]

from <table> [<alias>]
| <transform>
| <transform>
| ...
```

**Grammar:**

```ebnf
module     = { let_decl } pipeline ;
let_decl   = "let" IDENT "=" "(" pipeline ")" ;
pipeline   = from_clause { "|" transform } ;
from_clause = "from" ( IDENT | let_ref ) [ IDENT ] ;
transform  = filter | select | derive | join | group
           | aggregate | window | sort | take | skip
           | distinct | into | set_op ;
```

Each transform receives the row set from the preceding step, applies its operation, and passes the result downstream.

### Comments

Line comments begin with `#` and extend to the end of the line:

```
from Players   # Start with the Players table
| filter Level > 10   # Only high-level players
| select Id, Name
```

There are no block comments.

### Identifiers and Quoting

Identifiers follow standard rules: start with a letter or underscore, followed by letters, digits, or underscores. Keywords used as identifiers must be contextually unambiguous.

Qualified identifiers use dot notation:

```
alias.ColumnName
alias.Navigation.Property
```

---

## Data Sources

### FROM Clause

Every pipeline begins with a `from` clause specifying the data source.

**Syntax:**

```ebnf
from_clause = "from" table_ref [ alias ] ;
table_ref   = IDENT | let_ref ;
alias       = IDENT ;
```

**Examples:**

```
from Players
from Orders o
from top_players t    # Reference to a let-binding
```

### Table Aliases

Aliases provide shorthand names for tables and are required when joining multiple tables to disambiguate column references.

```
from Players p
| join Orders o (p.Id == o.PlayerId)
| select p.Name, o.Total
```

Aliases are single identifiers and follow the table reference. When provided, all column references from that table must use the alias prefix.

### Subqueries as Sources

Parenthesized pipelines can serve as inline data sources in joins:

```
from Orders o
| join (from Products p | filter p.IsActive == true | select p.Id, p.Name) prod (o.ProductId == prod.Id)
| select o.Id, prod.Name
```

Named subquery sources use `alias = (pipeline)` syntax:

```
from Orders o
| join t = (from Products p | select p.Id, p.Name) (o.ProductId == t.Id)
| select o.Id, t.Name
```

---

## Transforms (Operators)

### FILTER

Keeps only rows that satisfy a boolean predicate. Equivalent to SQL `WHERE` (or `HAVING` when placed after `group`).

**Syntax:**

```ebnf
filter = "filter" predicate ;
predicate = expr
          | expr comp_op expr
          | predicate ("and" | "&&") predicate
          | predicate ("or" | "||") predicate
          | ("not" | "!") predicate
          | "(" predicate ")"
          | "exists" "(" pipeline ")"
          | "not" "exists" "(" pipeline ")" ;
```

**Comparison operators:**

| Operator | Aliases | Description |
|----------|---------|-------------|
| `==` | `=` | Equality |
| `!=` | `<>` | Inequality |
| `>` | | Greater than |
| `>=` | | Greater than or equal |
| `<` | | Less than |
| `<=` | | Less than or equal |

**Logical operators:**

| Operator | Aliases | Description |
|----------|---------|-------------|
| `and` | `&&` | Logical AND |
| `or` | `\|\|` | Logical OR |
| `not` | `!` | Logical negation |

**Examples — basic filters:**

```
from Players | filter Level > 10
from Players | filter Level > @minLevel and IsActive == true
```

**Examples — compound predicates with parentheses:**

```
from Players | filter (Score < 100 or Level >= 50) and IsActive == true
from Players p | filter not (p.Level >= 10 || p.Id == 1)
```

**Examples — NULL checks:**

```
from Players | filter Name is null
from Players | filter Name is not null
```

**Examples — pattern matching:**

```
from Players | filter Name like 'A%'
from Players | filter Name contains @searchTerm
```

**Examples — existence tests:**

```
from Players p
| filter exists (from Orders o | filter o.PlayerId == p.Id)

from Players p
| filter not exists (from Bans b | filter b.PlayerId == p.Id)
```

**Examples — set membership:**

```
from Players | filter Level in (1, 5, 10)
from Players | filter Status not in ("Banned", "Suspended")
```

**Examples — correlated subquery in filter:**

```
from Players p
| filter p.Id in (from Orders o | filter o.Total > 100 | select o.PlayerId)
```

**Examples — BETWEEN:**

```
from Players | filter Level between 10 and 50
```

> **Note:** `between` is syntactic sugar — it is lowered to `Level >= 10 and Level <= 50` during parsing.

**Multiple filters** can be chained; they are logically ANDed:

```
from Players p
| filter p.Level >= 10
| filter p.Score > 500
# Equivalent to: filter p.Level >= 10 and p.Score > 500
```

**SQL equivalent:**

```sql
-- from Players | filter Level > 10 and Name is not null
SELECT * FROM Players WHERE Level > 10 AND Name IS NOT NULL;
```

**Examples — spatial queries:**

Spatial filter functions trigger index-accelerated spatial scans when a `SpatialGrid` index is declared on the referenced coordinate columns (see [Indexing — SpatialGridIndex](/docs/schema/indexing#spatialgridindex)).

```
// Radius query — all objects within 50 units of a point
from GameObjects
| filter within_radius(PosX, PosY, @centerX, @centerY, 50.0)
| select Name, PosX, PosY

// Bounding box query
from GameObjects
| filter within_bounds(PosX, PosY, @minX, @minY, @maxX, @maxY)
| select Name, PosX, PosY

// 3D radius query
from GameObjects
| filter within_radius(PosX, PosY, PosZ, @cx, @cy, @cz, @radius)
| select Name, PosX, PosY, PosZ

// Spatial filter combined with other predicates
from GameObjects
| filter within_radius(PosX, PosY, @cx, @cy, @radius) and IsActive == true
| select Name, PosX, PosY
```

> **Note:** `within_radius` uses Euclidean distance. `within_bounds` tests axis-aligned bounding box containment. Non-spatial predicates combined with spatial functions are applied as residual post-filters after spatial index candidate selection.

---

### SELECT

Projects specific columns, computed expressions, or structured objects. Equivalent to SQL `SELECT`.

**Syntax:**

```ebnf
select       = "select" column_list | "select" obj_block ;
column_list  = column { "," column } ;
column       = expr [ "as" IDENT ]
             | IDENT "=" expr
             | alias ".*" ;
obj_block    = "{" field_assign { "," field_assign } "}" ;
field_assign = IDENT "=" expr
             | IDENT "=" obj_block
             | IDENT "=" collect_clause ;
```

**Examples — basic projection:**

```
from Players | select Id, Name
from Players | select Id, Name, Score
```

**Examples — aliased columns:**

```
from Players | select Id, upper(Name) as UpperName, Score
from Players | select PlayerID = Id, PlayerName = Name
```

**Examples — wildcard (all columns from alias):**

```
from Players p
| join Orders o (p.Id == o.PlayerId)
| select p.*, o.Total
```

**Examples — computed expressions:**

```
from Players p | select p.Id, p.Score * 2 as DoubleScore
from Players | select Id, (Level switch { >= 10 => 1, _ => 0 }) as IsHigh
```

**Examples — object projection (nested structures):**

```dsl
from Customers c
| select {
    Id = c.Id,
    Profile = {
      Name = c.Name,
      IsVip = c.IsVip
    }
  }
```

**Examples — collection projection with `collect`:**

```dsl
from Customers c
| select {
    Id = c.Id,
    Orders = collect c.Orders (
      where TotalAmount > @minTotal,
      sort -OrderDate,
      take 5,
      select {
        Id = Id,
        Total = TotalAmount
      }
    )
  }
```

**`collect` clause rules:**

- Mandatory form: `collect <path> ([where ...], [sort ...], [take ...], select { ... })`
- Clause order is strict: `where` → `sort` → `take` → `select`
- `take` accepts literals and parameters: `take 5`, `take @orderTake`
- Inner `select { ... }` is mandatory and defines element shape
- Object blocks must have explicit `field = expression` assignments
- Empty object blocks are rejected

**SQL equivalent:**

```sql
-- from Players | select Id, upper(Name) as UpperName
SELECT Id, UPPER(Name) AS UpperName FROM Players;
```

---

### DERIVE

Adds new computed columns to the row without removing existing ones. Equivalent to SQL `SELECT *, expr AS alias`.

**Syntax:**

```ebnf
derive = "derive" IDENT "=" expr
       | "derive" "{" field_assign { "," field_assign } "}" ;
```

**Examples — single column:**

```
from Products | derive Value = Price * Quantity
from Products | derive DiscountedPrice = Price * 0.9m
```

**Examples — multiple columns (block form):**

```
from Products | derive { Tax = Price * 0.1m, Total = Price * 1.1m }

from Players
| derive {
    Tier = Score switch {
        >= 1000 => "Diamond",
        >= 500  => "Gold",
        _       => "Silver"
    },
    PowerLevel = Level * Score
}
```

**Forward references within a block:**

Derived columns in a block can reference earlier derivations within the same block:

```
from Products | derive { Subtotal = Price * Quantity, Tax = Subtotal * 0.1m }
```

**Examples — derive with filter:**

```
from Players p
| derive { X = p.Score * 2 + p.Level }
| filter X >= 25
| select { p.Id, p.Score, X }
```

**SQL equivalent:**

```sql
-- from Products | derive { Tax = Price * 0.1m, Total = Price * 1.1m }
SELECT *, Price * 0.1 AS Tax, Price * 1.1 AS Total FROM Products;
```

---

### JOIN

Combines rows from two data sources based on a join predicate.

**Syntax:**

```ebnf
join = [join_type] "join" table_ref alias "(" predicate ")"
     | [join_type] "join" alias "=" "(" pipeline ")" "(" predicate ")"
     | [join_type] "join" "(" pipeline ")" alias "(" predicate ")" ;
join_type = "inner" | "left" | "right" | "full" | "semi" | "anti" ;
```

When no `join_type` is specified, `inner` is the default.

**Join types:**

| Keyword | SQL Equivalent | Description |
|---------|---------------|-------------|
| `join` / `inner join` | `INNER JOIN` | Only matching rows from both sides |
| `left join` | `LEFT OUTER JOIN` | All left rows; NULLs for non-matching right columns |
| `right join` | `RIGHT OUTER JOIN` | All right rows; NULLs for non-matching left columns |
| `full join` | `FULL OUTER JOIN` | All rows from both sides; NULLs where no match |
| `semi join` | `WHERE EXISTS(...)` | Left rows that have ≥1 match on the right; no right columns in output |
| `anti join` | `WHERE NOT EXISTS(...)` | Left rows that have no match on the right |

**Examples — inner join:**

```
from Players p
| join Orders o (p.Id == o.PlayerId)
| select p.Name, o.Total
```

**Examples — left join:**

```
from Orders o
| left join Customers c (o.CustomerId == c.Id)
| select o.Id, coalesce(c.Name, "Unknown") as CustomerName
```

**Examples — right join:**

```
from Players p
| right join Orders o (p.Id == o.PlayerId && o.Total >= 100)
| select { OrderId = o.Id, PlayerName = p.Name, o.Total }
```

**Examples — full join:**

```
from Players p
| full join Orders o (p.Id == o.PlayerId)
| select p.Id as PlayerId, o.Id as OrderId
```

**Examples — semi join (players who have orders):**

```
from Players p
| semi join Orders o (p.Id == o.PlayerId)
| select p.Id, p.Name
```

**Examples — anti join (players without orders):**

```
from Players p
| anti join Orders o (p.Id == o.PlayerId)
| select p.Id, p.Name
```

**Examples — compound join predicate:**

```
from Players p
| join Orders o (p.Id == o.PlayerId && o.Total > 100)
| select p.Name, o.Total
```

**Examples — join with subquery source:**

```
from Players p
| join (from Orders o | sort -o.Total | take 100) top_orders (p.Id == top_orders.PlayerId)
| select p.Name, top_orders.Total
```

**Examples — named subquery join:**

```
from Orders o
| join t = (from Products p | select p.Id, p.Name) (o.ProductId == t.Id)
| select o.Id, t.Name
```

**Examples — multiple joins (chained):**

```
from Players p
| join Orders o (p.Id == o.PlayerId)
| join OrderItems i (i.OrderId == o.Id)
| select { p.Name, i.Qty }
| sort p.Id, i.Id
```

**SQL equivalent:**

```sql
-- from Players p | left join Orders o (p.Id == o.PlayerId) | select p.Name, o.Total
SELECT p.Name, o.Total
FROM Players p LEFT JOIN Orders o ON p.Id = o.PlayerId;
```

---

### GROUP

Groups rows by one or more columns and computes aggregates per group. Equivalent to SQL `GROUP BY`.

**Syntax:**

```ebnf
group = "group" group_keys "(" "aggregate" "{" agg_list "}" ")"
      | "group" group_keys "(" agg_list ")" ;
group_keys = column_ref { "," column_ref }
           | "(" column_ref { "," column_ref } ")"
           | "{}" ;
agg_list   = agg_assign { "," agg_assign } ;
agg_assign = IDENT "=" agg_func ;
```

Using `{}` (empty braces) as group keys produces a **global aggregate** (single-row result, equivalent to omitting `GROUP BY`).

**Examples — single key:**

```
from Orders o
| group o.PlayerId (aggregate { SumTotal = sum o.Total, Cnt = count o.Id })
```

**Examples — multiple keys:**

```
from Orders o
| group (o.PlayerId, o.Id) (aggregate { MinTotal = min o.Total, MaxTotal = max o.Total })
```

**Examples — flat multi-key syntax (no parentheses):**

```
from Items | group ProductId, CategoryId (aggregate { Qty = sum Quantity, Cnt = count Id })
```

**Examples — global aggregate (no grouping):**

```
from Orders o
| group {} (aggregate { AvgTotal = avg o.Total, DistinctPlayers = count(distinct o.PlayerId) })
```

**Examples — HAVING equivalent (filter after group):**

```
from Orders o
| group o.PlayerId (aggregate { SumTotal = sum o.Total })
| filter SumTotal > 200
| select o.PlayerId, SumTotal
```

> **Note:** Place a `filter` after `group` to achieve SQL `HAVING` behavior.

**SQL equivalent:**

```sql
-- from Orders o | group o.PlayerId (aggregate { Total = sum o.Amount })
SELECT o.PlayerId, SUM(o.Amount) AS Total
FROM Orders o
GROUP BY o.PlayerId;
```

---

### AGGREGATE

Computes aggregate values. Can be used standalone (without `group`) for **scalar aggregates** that collapse the entire table into one row.

**Syntax:**

```ebnf
aggregate  = "aggregate" "{" agg_list "}" ;
agg_list   = agg_assign { "," agg_assign } ;
agg_assign = IDENT "=" agg_func [ "filter" "(" "where" predicate ")" ] ;
agg_func   = func_name column_ref
           | func_name "(" column_ref ")"
           | func_name "(" "distinct" column_ref ")"
           | func_name "(" "*" ")"
           | func_name "()" ;
```

**Aggregate function names:**

| Function | Aliases | Description |
|----------|---------|-------------|
| `count` | | Count non-null values (or all rows with `count(*)`) |
| `sum` | | Sum of numeric values |
| `avg` | `average` | Arithmetic mean |
| `min` | | Minimum value |
| `max` | | Maximum value |
| `first` | | First value in group |
| `last` | | Last value in group |
| `stddev` | `stdev`, `std_dev` | Sample standard deviation |
| `stddev_pop` | `stdevpop`, `stdev_pop` | Population standard deviation |
| `variance` | | Sample variance |
| `var_pop` | `varpop`, `variance_pop`, `variancepop` | Population variance |
| `bool_and` | `booland` | Logical AND of all values |
| `bool_or` | `boolor` | Logical OR of all values |
| `bit_and` | `bitand` | Bitwise AND of all values |
| `bit_or` | `bitor` | Bitwise OR of all values |
| `array_agg` | `arrayagg` | Collect values into array |

**DISTINCT modifier:**

Add `distinct` inside parentheses to aggregate only unique values:

```
from Orders | aggregate { UniqueProducts = count(distinct ProductId) }
from Players | aggregate { DistinctScore = sum(distinct Score) }
```

> **Note:** `distinct` is not allowed with `count(*)`.

**FILTER clause on aggregates:**

Apply a per-aggregate filter using the `filter (where ...)` clause:

```
from Players
| aggregate {
    HighCount = count(Id) filter (where Level >= 10),
    TotalScore = sum Score
  }
```

**Examples — scalar aggregate (no group):**

```
from Orders
| aggregate { TotalRevenue = sum Amount, OrderCount = count Id, AvgOrder = avg Amount }
```

**Examples — with distinct and filter:**

```
from Players p
| group {} (aggregate {
    CntName = count p.Name,
    DistinctNames = count(distinct p.Name),
    HighLevelCount = count(p.Id) filter (where p.Level >= 10)
  })
```

**SQL equivalent:**

```sql
-- from Orders | aggregate { Total = sum Amount, Cnt = count(*) }
SELECT SUM(Amount) AS Total, COUNT(*) AS Cnt FROM Orders;

-- count(Id) filter (where Level >= 10)
COUNT(Id) FILTER (WHERE Level >= 10)   -- PostgreSQL syntax
```

---

### WINDOW

Computes window functions over partitions of the data without collapsing rows. Equivalent to SQL `OVER(...)`.

**Syntax:**

```ebnf
window    = "window" ["by" partition_cols] "(" win_list ")" ;
partition_cols = column_ref { "," column_ref }
              | "(" column_ref { "," column_ref } ")" ;
win_list  = win_assign { "," win_assign } ;
win_assign = IDENT "=" win_func [column_ref] [frame_spec] ;
win_func  = "row_number" | "rank" | "dense_rank"
          | "sum" | "avg" | "average" | "min" | "max" | "count"
          | "lag" | "lead" | "ntile" | "first_value" | "last_value" ;
frame_spec = "frame:" bound ".." bound ;
bound     = ["-"] INTEGER | /* empty (unbounded) */ ;
```

**Partition columns (`by` clause):**

When `by` is specified, window functions are computed within each partition. Without `by`, the entire result set is a single partition.

```
# Global window (entire result set)
from Players | sort -Score | window (Rn = row_number)

# Partitioned by GuildId
from Players | window by GuildId (Rn = row_number)

# Multiple partition columns
from Sales | window by (Region, Category) (Rn = row_number)
```

**Window function reference:**

| Function | Args | Description | Return Type |
|----------|------|-------------|-------------|
| `row_number` | 0 | Sequential number within partition | `int` |
| `rank` | 0 | Rank with gaps for ties | `int` |
| `dense_rank` | 0 | Rank without gaps | `int` |
| `ntile(N)` | 1 | Distribute rows into N buckets | `int` |
| `lag col` | 1 | Value from previous row | `Nullable<T>` |
| `lag col, offset` | 2 | Value from N rows back | `Nullable<T>` |
| `lead col` | 1 | Value from next row | `Nullable<T>` |
| `lead col, offset` | 2 | Value from N rows ahead | `Nullable<T>` |
| `first_value col` | 1 | First value in window frame | `Nullable<T>` |
| `last_value col` | 1 | Last value in window frame | `Nullable<T>` |
| `sum col` | 1 | Running/partitioned sum | Same as aggregate `sum` |
| `avg col` / `average col` | 1 | Running/partitioned average | `double?` |
| `min col` | 1 | Running/partitioned minimum | `Nullable<T>` |
| `max col` | 1 | Running/partitioned maximum | `Nullable<T>` |
| `count` | 0 | Running/partitioned count | `int` |
| `count col` | 1 | Running/partitioned count of non-null values | `int` |

**Frame specification:**

Frames control which rows relative to the current row are included in the window computation.

| Frame | SQL Equivalent | Meaning |
|-------|----------------|---------|
| `frame: -2..0` | `ROWS BETWEEN 2 PRECEDING AND CURRENT ROW` | Current row and 2 preceding |
| `frame: 0..0` | `ROWS BETWEEN CURRENT ROW AND CURRENT ROW` | Current row only |
| `frame: -1..1` | `ROWS BETWEEN 1 PRECEDING AND 1 FOLLOWING` | 1 preceding through 1 following |
| `frame: 0..` | `ROWS BETWEEN CURRENT ROW AND UNBOUNDED FOLLOWING` | Current row to end of partition |
| `frame: ..0` | `ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW` | Start of partition to current row |
| `frame: ..` | `ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING` | Entire partition |
| `frame: -6..0` | `ROWS BETWEEN 6 PRECEDING AND CURRENT ROW` | 7-row sliding window |

**Examples — ranking:**

```
from Players p
| sort -p.Score, p.Id
| window (Rn = row_number)
| filter Rn <= 10
| select { p.Id, p.Score, Rn }
```

**Examples — partitioned ranking:**

```
from Orders o
| sort o.Id
| window by o.PlayerId (Rn = row_number)
| select { o.Id, o.PlayerId, Rn }
```

**Examples — running aggregate:**

```
from Orders o
| sort o.Id
| window (RunningTotal = sum o.Total)
| select { o.Id, o.Total, RunningTotal }
```

**Examples — partitioned running aggregate:**

```
from Orders o
| sort o.Id
| window by o.PlayerId (RunningTotal = sum o.Total)
| select { o.Id, o.PlayerId, o.Total, RunningTotal }
```

**Examples — sliding window (moving average):**

```
from Sales
| sort Date
| window (MovingAvg = average Amount frame: -6..0)
| select Date, Amount, MovingAvg
```

**Examples — lag/lead:**

```
from Sales
| window by Region (Prev = lag Amount, Next = lead Amount)
| select Date, Amount, Prev, Next
```

**Examples — ntile:**

```
from Players
| sort -Score
| window (Quartile = ntile(4))
| select Id, Name, Score, Quartile
```

**SQL equivalent:**

```sql
-- from Players | sort -Score | window by GuildId (Rn = row_number)
SELECT *, ROW_NUMBER() OVER (PARTITION BY GuildId ORDER BY Score DESC) AS Rn
FROM Players;

-- window (Running = sum Amount frame: -6..0)
SUM(Amount) OVER (ORDER BY Date ROWS BETWEEN 6 PRECEDING AND CURRENT ROW) AS Running
```

---

### SORT

Orders rows by one or more columns. Equivalent to SQL `ORDER BY`.

**Syntax:**

```ebnf
sort       = "sort" sort_spec { "," sort_spec } ;
sort_spec  = ["+"|"-"] column_ref [null_order] ;
null_order = "nulls" ("first" | "last") ;
```

- **`+` prefix** (or no prefix): ascending order (default)
- **`-` prefix**: descending order
- **`nulls first`**: NULL values sort before non-NULL
- **`nulls last`**: NULL values sort after non-NULL

**Examples — basic sorting:**

```
from Players | sort Score          # Ascending (default)
from Players | sort -Score         # Descending
from Players | sort +Score         # Ascending (explicit)
```

**Examples — multi-column sort:**

```
from Players | sort GuildId, -Score         # Guild ascending, score descending
from Players | sort -Level, Score, Id       # Three columns, mixed directions
```

**Examples — NULL ordering:**

```
from Players | sort Name nulls last, Id
from Players | sort -Score nulls first
```

**SQL equivalent:**

```sql
-- from Players | sort -Score, Name nulls last
SELECT * FROM Players ORDER BY Score DESC, Name NULLS LAST;
```

---

### TAKE

Limits the number of returned rows. Equivalent to SQL `LIMIT` / `TOP`.

**Syntax:**

```ebnf
take = "take" ( INTEGER | PARAMETER ) ;
```

**Examples:**

```
from Players | sort -Score | take 10
from Players | take @count
```

**SQL equivalent:**

```sql
-- from Players | sort -Score | take 10
SELECT * FROM Players ORDER BY Score DESC LIMIT 10;
```

---

### SKIP

Skips the first N rows. Equivalent to SQL `OFFSET`. Typically used with `take` for pagination.

**Syntax:**

```ebnf
skip = "skip" ( INTEGER | PARAMETER ) ;
```

**Examples:**

```
from Players | sort -Score | skip 20 | take 10     # Page 3 (rows 21-30)
from Players | sort Id | skip @offset | take @limit
```

**SQL equivalent:**

```sql
-- from Players | sort Id | skip 20 | take 10
SELECT * FROM Players ORDER BY Id LIMIT 10 OFFSET 20;
```

---

### DISTINCT

Removes duplicate rows from the result. Equivalent to SQL `SELECT DISTINCT`.

**Syntax:**

```ebnf
distinct = "distinct" [ column_list | "{" column_list "}" ] ;
```

When no columns are specified, deduplication operates on the entire row. When columns are specified, only those columns are considered for uniqueness.

**Examples — whole-row distinct:**

```
from Players | select GuildId | distinct
from Players | select Level, Score | distinct | sort Level, Score
```

**Examples — column-specific distinct:**

```
from Players | distinct Level
from Players | distinct { Level, GuildId }
```

**Examples — distinct in pipeline:**

```
from Players p
| join Orders o (p.Id == o.PlayerId)
| select { PlayerId = p.Id }
| distinct
| sort PlayerId
```

**SQL equivalent:**

```sql
-- from Players | select Level | distinct
SELECT DISTINCT Level FROM Players;
```

---

### INTO

Assigns the current pipeline to a named variable for later reference. The result becomes an implicit `let` declaration.

**Syntax:**

```ebnf
into = "into" IDENT ;
```

**Examples:**

```
from Orders | filter Status == "Shipped" | into shipped
from shipped | group CustomerId (aggregate { Total = sum Amount })
```

**SQL equivalent:**

```sql
-- into shipped ... from shipped
WITH shipped AS (SELECT * FROM Orders WHERE Status = 'Shipped')
SELECT CustomerId, SUM(Amount) AS Total FROM shipped GROUP BY CustomerId;
```

---
## ORM-Style Navigation

ConjureDB supports ORM-style dot-path navigation for accessing related entities without writing explicit joins.

### Dot-Path Navigation

Reference related entities using dot notation. The compiler automatically lowers these to `INNER JOIN` chains.

**Syntax:**

```ebnf
nav_path = alias "." segment { "." segment } ;
segment  = IDENT ;
```

**Examples:**

```
from Orders o
| filter o.Product.Category.Name == "Electronics"
| select o.Id
```

**Lowered equivalent:**

```
from Orders o
| join Products __p (o.ProductId == __p.Id)
| join Categories __c (__p.CategoryId == __c.Id)
| filter __c.Name == "Electronics"
| select o.Id
```

### Safe Navigation (`?.`)

Use `?.` between segments to mark a nullable traversal. A `?.` hop generates a `LEFT JOIN` instead of an `INNER JOIN`, and all downstream hops in the same path also become left joins.

**Examples:**

```
from Orders o
| filter o.Product?.Category.Name == "Electronics"
| select o.Id, o.TotalAmount
```

**Semantics:**

| Path | Join Type |
|------|-----------|
| `o.Product.Name` | `INNER JOIN Products` |
| `o.Product?.Name` | `LEFT JOIN Products` |
| `o.Product.Category?.Name` | `INNER JOIN Products`, `LEFT JOIN Categories` |
| `o.Product?.Category.Name` | `LEFT JOIN Products`, `LEFT JOIN Categories` |

> **Note:** Once `?.` appears in a path, all downstream hops become LEFT JOINs.

### Navigation in JOIN Predicates

Navigation paths work inside `JOIN ... (predicate)` conditions with two rewrite modes.

**Left-root navigation (expanded in outer pipeline):**

```dsl
from Orders o
| join Categories c (o.Product.CategoryId == c.Id)
| select o.Id
```

The compiler inserts the intermediate join into the outer pipeline.

**Right-root navigation (expanded inside right source):**

```dsl
from Orders o
| join Products p (o.ProductId == p.Id and p.Category.Name == "Electronics")
| select o.Id
```

The compiler wraps the right side in a subquery with materialized helper columns.

**Navigation over `let`/subquery aliases:**

Navigation works on projected aliases when FK column lineage is deterministic:

```dsl
let filtered_reviews = (
  from Reviews r | select r.Id, r.CustomerId, r.Rating
)
from filtered_reviews f
| filter f.Customer.Country == "USA"
| select f.Id, f.Rating
```

**Implicit root resolution:**

When the first navigation segment is unambiguous, you can omit the alias:

```dsl
from filtered_reviews f
| filter Customer.Country == "USA"     # Equivalent to f.Customer.Country
```

> **Fail-fast rules:**
> - Opaque projection lineage (only computed columns) → compilation error
> - Ambiguous navigation root (multiple aliases could own the segment) → compilation error with candidate list
> - Navigation inside `JOIN ... ON` from right-root when right source is shape-changing (`group`/`aggregate`/`window`/`distinct`/set ops) → hard error

### Collection Navigation

For one-to-many relationships, use collection navigation methods instead of correlated subqueries.

**Supported methods:**

| Method | Description | Lowers To |
|--------|-------------|-----------|
| `Any()` | Has any related rows | `EXISTS(...)` |
| `Any(predicate)` | Has any matching rows | `EXISTS(... WHERE ...)` |
| `All(predicate)` | All related rows match | `NOT EXISTS(... WHERE NOT ...)` |
| `Count()` | Count of related rows | Correlated scalar aggregate |
| `Count(predicate)` | Count of matching rows | Correlated filtered aggregate |
| `Sum(selector[, predicate])` | Sum of related values | Correlated scalar aggregate |
| `Min(selector[, predicate])` | Min of related values | Correlated scalar aggregate |
| `Max(selector[, predicate])` | Max of related values | Correlated scalar aggregate |
| `Average(selector[, predicate])` / `Avg(...)` | Average of related values | Correlated scalar aggregate |

**Examples — basic collection navigation:**

```dsl
from Customers c
| filter c.Orders.Any()
| select c.Id, c.Name
```

**Examples — with predicate (lambda form):**

```dsl
from Customers c
| filter c.Orders.Any(o => o.TotalAmount > @minTotal)
| filter c.Orders.Count(o => o.TotalAmount > @minTotal) > @minCount
| filter c.Orders.Sum(o => o.TotalAmount, o => o.TotalAmount > @minTotal) > @minSum
| select c.Id, c.Name
```

**PRQL-like phrase syntax (alternative):**

```dsl
from Customers c
| filter sum c.Orders (by TotalAmount, where TotalAmount > @minTotal) > @minSum
| filter count c.Orders (where TotalAmount > @minTotal) > @minCount
| select c.Id, c.Name
```

**Phrase syntax rules:**

- `sum|min|max|average|avg`: require `(by <selector>)` with optional `, where <predicate>`
- `count`: supports optional `(where <predicate>)`, rejects `by`

> **Fail-fast rules:**
> - Requires explicit root alias (`c.Orders.Any()`, not `Orders.Any()`)
> - Collection segment must map to a deterministic reverse FK edge
> - Collection navigation inside `JOIN ... ON` is rejected — rewrite to explicit subquery
> - Lambda form requires qualified element references (`o => o.Amount`, not just `Amount`)
> - Direct predicate form (without `=>`) allows unqualified element references

**Observability reason codes:**

- `navigation.implicit_root.inferred` — implicit root was resolved
- `navigation.synthetic_join.inserted` — synthetic join was added
- `navigation.collection.lowered` — collection navigation was lowered
- `collection.materialization.decision` — physical planning decision for nested collections

---

## Expressions

### Literals

| Type | Syntax | Examples |
|------|--------|---------|
| Integer | Digits, optional `L` suffix | `42`, `0`, `123L` (long) |
| Float | Decimal point or suffix | `3.14`, `1.5F` (float), `2.7D` (double) |
| Decimal | `m`/`M` suffix | `9.99m`, `100.00M` |
| Scientific | `e`/`E` notation | `1.5e-3`, `2E10` |
| String | Single or double quotes | `'hello'`, `"world"` |
| Boolean | `true`, `false` | `true`, `false` |
| Null | `null` | `null` |
| Date | `@YYYY-MM-DD` | `@2025-01-15` |
| Time | `@THH:MM[:SS[.fff]]` | `@T12:30`, `@T12:30:45.123` |
| Timestamp | `@YYYY-MM-DDTHH:MM[:SS[.fff]]` | `@2025-01-15T12:30:45` |
| Interval | `@P...` (ISO 8601 subset) | `@P2DT3H` (2 days, 3 hours) |

**String escape sequences:**

| Escape | Character | Notes |
|--------|-----------|-------|
| `\n` | Newline | C-style |
| `\t` | Tab | C-style |
| `\r` | Carriage return | C-style |
| `\\` | Backslash | C-style |
| `\'` | Single quote | C-style |
| `\"` | Double quote | C-style |
| `\0` | Null character | C-style |
| `\uXXXX` | Unicode code point | C-style |
| `''` | Single quote | SQL-style (inside `'...'` only) |
| `""` | Double quote | SQL-style (inside `"..."` only) |

**Number suffixes:**

| Suffix | Type | Example |
|--------|------|---------|
| (none) | `int` / `double` (with dot) | `42`, `3.14` |
| `L` | `long` | `123L` |
| `F` | `float` | `1.5F` |
| `D` | `double` | `2.7D` |
| `M` / `m` | `decimal` | `9.99m` |

### Parameters

External values are referenced with the `@` prefix. Parameters are mapped to C# method parameters by name during code generation.

**Syntax:**

```ebnf
parameter = "@" IDENT ;
```

**Examples:**

```
from Players | filter Level > @minLevel | take @count
from Players | sort Id | skip @offset | take @limit
```

### Operators

#### Operator Precedence (lowest to highest)

| Level | Operators | Associativity |
|-------|-----------|---------------|
| 1 | `or`, `\|\|` | Left |
| 2 | `and`, `&&` | Left |
| 3 | `==`, `!=`, `<>`, `<`, `>`, `<=`, `>=`, `is null`, `is not null`, `like`, `in`, `between` | Non-associative |
| 4 | `??` (null coalesce) | Right |
| 5 | `+`, `-` (binary) | Left |
| 6 | `*`, `/`, `%` | Left |
| 7 | `not`, `!`, `-` (unary) | Right (prefix) |
| 8 | `switch`, `.`, `?.`, `[]`, `()` | Left (postfix) |

#### Arithmetic Operators

| Operator | Description | Example |
|----------|-------------|---------|
| `+` | Addition | `Price + Tax` |
| `-` | Subtraction | `Total - Discount` |
| `*` | Multiplication | `Price * Quantity` |
| `/` | Division | `Total / Count` |
| `%` | Modulo (remainder) | `Id % 2` |
| `-` (unary) | Negation | `-Score` |

#### Comparison Operators

| Operator | Aliases | Description |
|----------|---------|-------------|
| `==` | `=` | Equality |
| `!=` | `<>` | Inequality |
| `>` | | Greater than |
| `>=` | | Greater than or equal |
| `<` | | Less than |
| `<=` | | Less than or equal |

#### Logical Operators

| Operator | Aliases | Description |
|----------|---------|-------------|
| `and` | `&&` | Logical AND |
| `or` | `\|\|` | Logical OR |
| `not` | `!` | Logical NOT |

### NULL Handling

**Operators:**

| Expression | Description |
|------------|-------------|
| `expr is null` | True if expression is NULL |
| `expr is not null` | True if expression is not NULL |
| `a ?? b` | Returns `a` if non-null, else `b` (null coalesce) |
| `coalesce(a, b, ...)` | Returns first non-null argument |

**Examples:**

```
from Players | filter Email is null
from Players | filter Notes is not null
from Orders | select Id, coalesce(ShipDate, OrderDate) as EffectiveDate
from Players | derive DisplayName = Name ?? "Anonymous"
```

### Pattern Matching

**String comparison operators:**

| Operator | Syntax | Description |
|----------|--------|-------------|
| `like` | `col like 'pattern'` | SQL LIKE pattern (`%` = any chars, `_` = single char) |
| `contains` | `col contains value` | Substring search |
| `startswith()` | `startswith(col, prefix)` | Prefix test |
| `endswith()` | `endswith(col, suffix)` | Suffix test |

**Infix operator forms:**

```
from Players | filter Name like 'A%'        # Names starting with 'A'
from Players | filter Name like 'A_%'       # Names starting with 'A', at least 2 chars
from Players | filter Name contains @term   # Substring search
```

**Function forms:**

```
from Players | filter startswith(Name, @prefix)
from Players | filter endswith(Email, "@gmail.com")
from Players | filter contains(Bio, "veteran")
```

### Set Membership (IN / NOT IN)

**Syntax:**

```ebnf
in_expr = expr "in" "(" value_list ")"
        | expr "in" "(" pipeline ")"
        | expr "in" PARAMETER
        | expr "not" "in" "(" value_list ")"
        | expr "not" "in" "(" pipeline ")" ;
```

**Examples — literal list:**

```
from Players | filter Level in (1, 5, 10)
from Players | filter Status not in ("Cancelled", "Returned")
```

**Examples — parameter (collection):**

```
from Players | filter CategoryId in @ids
```

**Examples — subquery:**

```
from Orders o
| filter o.Id in (from OrderItems i | filter i.OrderId == o.Id | select i.OrderId)

from Orders o
| filter o.Id not in (from OrderItems i | filter i.Qty > 1 | select i.OrderId)
```

### BETWEEN

Range test operator. Syntactic sugar that lowers to two comparisons.

**Syntax:**

```ebnf
between = expr "between" expr "and" expr ;
```

**Example:**

```
from Players | filter Level between 10 and 50
# Equivalent to: filter Level >= 10 and Level <= 50
```

### EXISTS / NOT EXISTS

Tests for the presence or absence of correlated rows.

**Syntax:**

```ebnf
exists = "exists" "(" pipeline ")"
       | "not" "exists" "(" pipeline ")" ;
```

**Examples:**

```
from Players p
| filter exists (from Orders o | filter o.PlayerId == p.Id)
| select p.Id, p.Name

from Players p
| filter not exists (from Bans b | filter b.PlayerId == p.Id)
| select p.Id, p.Name
```

**Examples — compound with other predicates:**

```
from Players p
| filter p.Level >= 10 && exists(from Orders o | filter o.PlayerId == p.Id && o.Total > 100 | select o.Id)
| select p.Id
```

### Type Casting

Two syntax forms are supported for type conversion.

**C-style cast:**

```ebnf
c_cast = "(" type ")" expr ;
```

```
derive IntId = (int)StringId
derive Amount = (decimal)RawValue
```

**SQL-style cast:**

```ebnf
sql_cast = "cast" "(" expr "as" type ")" ;
```

```
derive IntId = cast(StringId as int)
derive Amount = cast(RawValue as decimal)
```

Both forms are semantically identical. Use whichever reads more clearly in context.

### Switch (CASE) Expressions

Pattern-matching expressions equivalent to SQL `CASE WHEN`. Both braces `{}` and parentheses `()` delimiters are supported.

**Syntax:**

```ebnf
switch_expr = expr "switch" ("{" | "(") switch_arm { "," switch_arm } ("}" | ")") ;
switch_arm  = pattern "=>" expr
            | "_" "=>" expr ;
pattern     = comp_op literal
            | literal ;
```

**Examples — simple switch:**

```
from Players
| select Id, (Level switch { >= 10 => 1, _ => 0 }) as IsHigh
```

**Examples — multi-arm switch:**

```
from Players
| derive Tier = Score switch {
    >= 1000 => "Diamond",
    >= 500  => "Gold",
    >= 100  => "Silver",
    _       => "Bronze"
}
```

**Examples — switch in derive block:**

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

**SQL equivalent:**

```sql
-- Score switch { >= 1000 => "Diamond", >= 500 => "Gold", _ => "Silver" }
CASE WHEN Score >= 1000 THEN 'Diamond'
     WHEN Score >= 500 THEN 'Gold'
     ELSE 'Silver'
END
```

> **Note:** The `_` arm is the default/else case. It must be the last arm. No trailing comma is allowed after the final arm.

### Method Call Syntax

Expressions support method-call syntax for function invocation:

```
from Players | filter Name.Contains("admin")
from Players | derive Upper = Name.ToUpper()
```

These are resolved to the corresponding built-in functions during compilation.

---


## See Also

- **[Set Operations & Composition](/docs/query-language/set-operations)** — `union`, `intersect`, `except`, `let` bindings, `into`, and subquery expressions
- **[SQL Reference & Examples](/docs/query-language/sql-reference)** — DSL ↔ SQL equivalents table, practical query examples (basic through advanced)
- **[Functions Reference](/docs/query-language/functions)** — built-in string, math, date/time, aggregate, and window functions
- **[Mutations](/docs/query-language/mutations)** — `update`, `delete`, `insert`, `upsert`, `assert` statements
- **[Expressions](/docs/query-language/expressions)** — expression details and advanced usage

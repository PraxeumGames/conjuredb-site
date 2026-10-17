# ConjureDB Query Language Reference

This reference describes the **implemented Syntax V3 query contract (waves
1A–1C)**. A query is a typed pipeline declared in a `.conjure` file and compiled
ahead of time. Parsing an expression does not establish that its types, result
shape, ordering, or execution context are valid: binding checks those contracts.

The declared result selects the generated API. Queries do not acquire every
materialization overload automatically, and a query's module/table owner is not
changed by choosing a different collection surface.

## Contents

- [Example schema](#example-schema)
- [Syntax and names](#syntax-and-names)
- [Sources and intermediate results](#sources-and-intermediate-results)
- [Filtering and expressions](#filtering-and-expressions)
- [Named projections and derive](#named-projections-and-derive)
- [Joins](#joins)
- [Scoped groups and aggregates](#scoped-groups-and-aggregates)
- [Windows in derive](#windows-in-derive)
- [Nested pipelines and existence](#nested-pipelines-and-existence)
- [Ordering, limits, and distinct](#ordering-limits-and-distinct)
- [Set operations](#set-operations)
- [Result signatures and cardinality](#result-signatures-and-cardinality)
- [Sampling, shuffling, and generated rows](#sampling-shuffling-and-generated-rows)
- [Current boundaries and migration](#current-boundaries-and-migration)
- [Related references](#related-references)

## Example schema

Unless a section supplies a standalone module, its query declarations are added
to this shared schema. Names such as `Player`, `Purchase`, and `Guild` are source
declarations, not assumed CLR collections. Explicit runtime IDs below make the
context suitable for generated runtime examples as well as binding.

```conjure
struct table Player(plural: Players, persistence: none, type_id: 64011) {
    Id: int @id
    GuildId: int
    Name: string
    Score: int
    Level: int
}
struct table Purchase(plural: Purchases, persistence: none, type_id: 64012) {
    Id: int @id
    PlayerId: int
    Amount: long
}
struct table Guild(plural: Guilds, persistence: none, type_id: 64013) {
    Id: int @id
    Name: string
}

using PlayerRow = (Id: int, Name: string, Score: int)
using PurchaseRow = (Id: int, Amount: long)
using ScoredId = (Id: int, Adjusted: int)
```

## Syntax and names

### Pipeline structure

A query has parameters, a declared result, optional named intermediate pipelines,
and one main pipeline. `|` separates stages; line breaks improve readability but
do not replace the pipe.

```conjure
query TopPlayers(minimum: int, limit: int) -> PlayerRow[] {
    from Player p
    | filter p.Score >= @minimum
    | sort { -p.Score, p.Id }
    | take @limit
    | select { p.Id, p.Name, p.Score }
}
```

### Parameters and lexical rules

<a id="parameters"></a>

Use lower-case language keywords: `from`, `filter`, `select`, `group`, and so on.
User parameters are read as `@minimum`, not bare `minimum`. Source aliases follow
the source: `from Player p`.

- `//` introduces a line comment. Block comments and hash comments are not part
  of the admitted source grammar.
- Strings use double quotes, for example `"Alice"`.
- Numbers support typed suffixes, including `L`, `u`, `ul`, `f`, `d`, `m`,
  `fx32`, and `fx64`. Keep the intended carrier explicit when it matters.
- Duration literals include `5s`, `100ms`, `2min`, and `1h`. Use `datetime(...)`
  for date/time construction, not an `@` date literal.
- Many words are contextual identifiers, not globally reserved words. Whether a
  word can name an alias or member depends on that grammar position.
- **Identifier references are case-sensitive.** Use the declaration's exact
  spelling. Names that differ only in case cannot be sibling declarations;
  rejecting such a collision does not make either spelling an alias.

<a id="transforms-operators"></a>

This is a pipeline outline, not a second executable grammar:

```text
query Name(parameters) -> ResultType {
    let intermediate = (from Source alias | ...)
    from Source alias
    | stage
    | stage
    | optional_cardinality_marker
}
```

## Sources and intermediate results

### Tables and aliases

<a id="from-clause"></a>

`from Player p` reads the declared table. The alias qualifies its fields, such as
`p.Id`. Aliases are particularly useful in joins and correlated nested pipelines.
A projection changes the visible row surface; fields removed by `select` do not
remain readable merely because they existed in the original table.

Navigation sources can traverse declared relationships, for example a declared
collection navigation in `from parent.Children child`. Navigation must come from
actual schema relationship metadata; a dotted spelling does not invent a
relationship. See [Schema Language](/docs/schema/schema-language) for relationship declarations.

### Named intermediate pipelines

Use `let name = (from ... | ...)` before the main pipeline. These bindings are
non-recursive and scoped to the query; they are not writes or mutable variables.

```conjure
query EligiblePlayers(minimum: int) -> PlayerRow[] {
    let eligible = (
        from Player p
        | filter p.Score >= @minimum
        | select { p.Id, p.Name, p.Score }
    )
    from eligible e
    | select { e.Id, e.Name, e.Score }
}
```

A named pipeline is not an implicit materialization promise. The compiler chooses
its physical implementation while retaining the query's observable semantics.

### Literal rows

Query pipelines do not currently admit `from values` as a source. Literal values
can appear in expressions, but a literal row list is not a query table. Use a
declared table, a named pipeline, or the supported `generate(count)` source.
System-driver syntax has a separate admission contract and does not extend the
query grammar.

## Filtering and expressions

<a id="filter"></a>

`filter predicate` retains rows for which the predicate holds. Use `&&`, `||`,
and `!` for boolean operations, `==`/`!=` for equality, and `== null`/`!= null` for
absence tests. `??` supplies an explicit fallback; `?:` selects a value.

```conjure
query MidLevelPlayers() -> PlayerRow[] {
    from Player p
    | filter (p.Level in 10..20) && p.Score > 0
    | select { p.Id, p.Name, p.Score }
}
```

`x in a..b` is **half-open**: it tests `x >= a && x < b`. The upper bound is
excluded. `x not in a..b` is its negated range-membership form. This is distinct
from inclusive window-frame endpoints. Membership also supports lists such as
`x in (1, 3, 5)`, a declared collection parameter, and a scalar-output nested
pipeline.

```conjure
query PlayersInGuilds(guilds: int[]) -> PlayerRow[] {
    from Player p
    | filter p.GuildId in @guilds
    | select { p.Id, p.Name, p.Score }
}
```

### Nulls in membership

List, collection, and nested-pipeline membership returns a plain `bool`. `x in S`
is true only when a present probe equals a present element. A null probe or null
element is a non-match. `x not in S` is true when `S` is empty; otherwise the
probe and every element must be present, and no element may equal the probe.
A null probe over nonempty input, or a null element anywhere in that input,
makes `not in` false.

Consequently, `!(x in S)` and `x not in S` are not interchangeable: the former
negates the already two-valued result. Negated membership needs an element-
inspectable right-hand carrier; an unsupported carrier is refused rather than
silently losing the null-witness rule. Typed arrays are an admitted carrier.
This membership rule does not change the half-open bounds of range membership.

<a id="null-handling"></a>

Nullable expressions retain their typed absence semantics. A nullable value is
not automatically a matching predicate, and absence is not an implicit numeric
zero. Use an explicit presence test or fallback when the query requires one.
Boolean short-circuiting and function-argument evaluation order remain observable;
rewriting a predicate must not move an effectful or throwing expression into a
previously unreached branch.

### Type casting

The cast form is `expression as Type`. Arithmetic can be enclosed in `checked(...)`
or `unchecked(...)` when that overflow policy is needed. These are not SQL
`CAST` expressions and are not retired wrapping-function aliases.

### Functions and enum members

<a id="enum-members"></a>

An enum constant uses its declared type and member, `EnumName.MemberName`, and
retains the enum's type rather than becoming an untyped backing integer. A bare
member name does not import every enum's members into the current scope. A
member of a different enum is not interchangeable merely because its backing
value is equal. See [Data Types](/docs/query-language/data-types) for enum conversion rules.

Built-in scalar functions have their actual module-qualified names, for example
`math.abs`, `math.power`, and `text.upper`. Other catalog families include
`date.*` and `bits.*`; availability and operand types belong to the function
catalog, not to spelling alone.

```conjure
query PlayerLabels() -> string[] {
    from Player p
    | select text.upper(p.Name)
}
```

Named arguments name the actual selected declaration's parameters:
`math.power(exp: 2.0, value: 3.0)`. Reordering parameter assignment does not reorder
the authored evaluation of argument expressions. Unknown or repeated labels are
errors. A native user function retains its lexical module/import ownership;
there is no global fallback from an unqualified name to every built-in module.

Record construction uses `{ Field = expression }` or `Type { Field = expression }`.
A result type must be available in its genuine declaration or project context;
a textual type name alone does not authorize a CLR constructor or member read.
See [Expressions](/docs/query-language/expressions) and [Custom Functions](/docs/query-language/functions) for
individual operators and function declarations.

## Named projections and derive

### Select

A scalar projection can be a single expression:

```conjure
query PlayerIds() -> int[] {
    from Player p | select p.Id
}
```

Multiple outputs use a **named object block**. Assign a name explicitly, or use a
member's name as shorthand. Source order is retained in the named output contract. A declared tuple's CLR
field order still comes from its declaration; named binding maps the authored
fields to that target rather than guessing constructor positions.

```conjure
query AdjustedPlayers(bonus: int) -> ScoredId[] {
    from Player p
    | select { p.Id, Adjusted = p.Score + @bonus }
}
```

`select { p.Id }` is a one-field named object, not a positional one-element list.
Use the declared result to express the intended row/tuple shape. Unbraced
multi-expression positional projections are retired. A declared named tuple is
not an instruction to bind arbitrary extern constructor arguments by position.

### Derive

`derive` adds named values while retaining the current row. Several additions
can be written in a block.

```conjure
query PositiveAdjustedPlayers(bonus: int) -> ScoredId[] {
    from Player p
    | derive Adjusted = p.Score + @bonus
    | filter Adjusted > 0
    | select { p.Id, Adjusted }
}
```

Use `derive` before `sort` when ordering by a computed expression: sort keys are
column references, not arbitrary scalar-expression slots. An aggregate call in
`derive` requires its window role and explicit frame where applicable; it is not
an implicit whole-input reduction.

## Joins

<a id="join"></a>

Canonical joins are:

```text
join Source alias (predicate)
left join Source alias (predicate)
right join Source alias (predicate)
full join Source alias (predicate)
```

Plain `join` means an inner join. The predicate is parenthesized; `on`, the
explicit `inner join` spelling, and inferred `(==Key)` shorthand are retired.

```conjure
using PlayerGuild = (PlayerId: int, GuildName: string)
query GuildMembers() -> PlayerGuild[] {
    from Player p
    | join Guild g (p.GuildId == g.Id)
    | select { PlayerId = p.Id, GuildName = g.Name }
}
```

A join can use equality, conjunctions, or a general admitted boolean predicate.
The compiler selects probes, indexes, or scans; a particular access path is not
part of the query's meaning. An index is not required to make an ordinary admitted
join predicate semantically valid.

Outer joins make the absent side nullable. Test presence or provide a fallback
before requiring a nonnullable member in the result.

```conjure
query GuildLabels() -> string[] {
    from Player p
    | left join Guild g (p.GuildId == g.Id)
    | select g.Name ?? "No guild"
}
```

Null keys do not become equal merely because both sides are absent. For
existence/non-existence filtering, use `exists(...)` or `!exists(...)`, not
semi/anti-join source spellings. See [Ordering](#ordering-limits-and-distinct) for
observable join traversal and unmatched outer rows.

## Scoped groups and aggregates

### Group creates a scope

<a id="group"></a>

`group key (pipeline)` runs the inner pipeline independently for each key.
Multiple keys use a key block. A group is not itself a reduction: its body may
filter, sort, take, project, aggregate, or contain supported nested stages.

```conjure
query BestPlayerIdsPerGuild() -> int[] {
    from Player p
    | group p.GuildId (
        sort { -p.Score, p.Id }
        | take 1
        | select p.Id
    )
}
```

The `take 1` applies **per group**, not once globally. A later projection closes
the old row surface in that scope. `sort` inside a group orders that group's
rows; it is not a global sort of the flattened result.

### Aggregate reduces its actual input

<a id="aggregate"></a>

`aggregate` without group keys produces one aggregate row, including for empty
input. A row-shaped aggregate names its outputs:

```conjure
using ScoreSummary = (Count: long, Total: long?)
query ScoreSummaryRow() -> ScoreSummary {
    from Player p
    | aggregate { Count = count(), Total = sum(p.Score) }
}
```

In a scalar result position, the single aggregate must instead be **unnamed**:

```conjure
query PlayerCount() -> long {
    from Player p | aggregate count()
}
query TotalScore() -> long? {
    from Player p | aggregate sum(p.Score)
}
```

This also applies to a scalar nested aggregate. A name on that otherwise
unobservable scalar output is rejected, rather than silently changing its shape.

| Aggregate | Meaning / empty-input behavior |
|---|---|
| `count()` | Row count, nonnullable `long`; empty input gives zero |
| `count(value)` | Count of present values; empty input gives zero |
| `count_distinct(value)` | Distinct present-value count |
| `sum`, `min`, `max`, `avg` | Value reductions; empty input is absent, not an implicit zero |
| `any_value(value)` | An arbitrary value; not an ordering guarantee |
| `any()` | Existence aggregate; false for empty input |
| `array_agg(value)` | Collection-valued aggregate; not the removed nested-pipeline wrapper |

Other admitted aggregates and exact result carriers are catalog-defined. For
example, integer `sum` widens to a nullable `long`, not necessarily its input
carrier. Do not infer aggregate types from a CLR method's name.

An aggregate may restrict its own input with `filter (predicate)`:

```conjure
query PositiveScoreTotal() -> long? {
    from Player p | aggregate sum(p.Score) filter (p.Score > 0)
}
```

A group starts with at least one row, but a child filter, limit, join, or aggregate
filter can remove every contributing value. Non-nullability requires the actual
nonempty-input proof; merely writing `group` is insufficient. Nullable operands
also retain their absence behavior.

Aggregate calls outside `aggregate` or an admitted window invocation are errors.
Write the reduction first, then filter its named output for a HAVING-like query.

### Grouped maps

A `map<K, V>` result ends in its actual `group` stage. The group key supplies
`K`; the child pipeline supplies `V`. Collection-valued children and scalar
aggregate children are different shapes.

```conjure
query PlayerIdsByGuild() -> map<int, int[]> {
    from Player p | group p.GuildId (select p.Id)
}
query PlayerCountsByGuild() -> map<int, long> {
    from Player p | group p.GuildId (aggregate count())
}
```

Nullable map keys are not admitted. An existing group whose child filters out
all rows still has its own partition and may produce an empty collection value;
an empty outer source does not invent a group. Do not append a flattening stage
and assume the same map result contract survives.

## Windows in derive

<a id="window"></a>

There is no standalone `window` stage. Window values are named `derive` outputs;
partitioning comes from an enclosing scoped group and ordering from `sort` in
that scope.

```conjure
using RunningScore = (Id: int, Running: long?)
query RunningScores() -> RunningScore[] {
    from Player p
    | sort p.Id
    | derive Running = sum(p.Score) over rows(unbounded, 0)
    | select { p.Id, Running }
}
query TopThreeIds() -> int[] {
    from Player p
    | sort { -p.Score, p.Id }
    | derive Position = row_number()
    | filter Position <= 3
    | select p.Id
}
```

- Aggregate windows require an explicit `over rows(start, end)` or
  `over range(start, end)` frame. There is no implicit default frame.
- `rows(-2, 0)` includes two preceding rows through the current row. Endpoints
  are inclusive; `0` means the current row, negative offsets precede it, and
  positive offsets follow it. `unbounded` opens the corresponding end.
- Row offsets must be admitted constant integral offsets. Row-dependent frame
  bounds and reversed frames are rejected.
- `range` measures **sort-key values**, not row counts. It requires exactly one
  compatible numeric or temporal sort key. Temporal distance uses duration
  values, for example `over range(-5s, 0s)` on an ascending datetime key.
- `row_number`, `rank`, `dense_rank`, `lag`, and `lead` use their catalog-owned
  window role without `over`. Giving them an aggregate frame is an error.
- Window calls belong in `derive`, not directly in `filter` or `select`.
  Derive the value, then refer to its name.

For partitioned windows, place the sort and derive inside `group key (...)`.
The sort keys required for deterministic window evaluation must actually be
available and ordered in that scope.

## Nested pipelines and existence

<a id="subquery-expressions"></a>

A parenthesized pipeline is the canonical nested-query form. It can be correlated
with aliases in its enclosing scope.

- In a collection-valued projection, a nested pipeline supplies the child rows.
- A scalar terminal supplies a selected/checked scalar value.
- One unnamed aggregate supplies a scalar reduction.
- `exists(pipeline)` or `(pipeline | any)` supplies existence, not an arbitrary
  projected value converted to `bool`.

```conjure
query PlayersWithPurchases() -> PlayerRow[] {
    from Player p
    | filter exists(from Purchase o | filter o.PlayerId == p.Id)
    | select { p.Id, p.Name, p.Score }
}
query PlayersWithoutPurchases() -> PlayerRow[] {
    from Player p
    | filter !exists(from Purchase o | filter o.PlayerId == p.Id)
    | select { p.Id, p.Name, p.Score }
}
query PurchaseTotals() -> long?[] {
    from Player p
    | select (from Purchase o | filter o.PlayerId == p.Id | aggregate sum(o.Amount))
}
```

Child order and limits are local to each parent. They must not be lifted into a
single global limit. For a collection projection, declare the collection member
in the outer result type and use the nested pipeline directly as its value:

```conjure
type PlayerPurchaseIds {
    Id: int
    PurchaseIds: int[]
}
query PurchaseHistory() -> PlayerPurchaseIds[] {
    from Player p
    | select {
        p.Id,
        PurchaseIds = (from Purchase o
            | filter o.PlayerId == p.Id
            | sort o.Id
            | take 5
            | select o.Id)
    }
}
```

There is no `collect(...)` wrapper.

Membership can consume a one-output nested pipeline:

```conjure
query PurchasingPlayerIds() -> int[] {
    from Player p
    | filter p.Id in (from Purchase o | select o.PlayerId)
    | select p.Id
}
```

The compiler validates the actual correlation, carrier, and result-shaping
combination. A representable nested syntax does not authorize arbitrary runtime
fallbacks, recursive queries, or borrowed CLR member/constructor metadata.

## Ordering, limits, and distinct

Order-sensitive operations need a defined input sequence. For table sources,
write an explicit `sort` before `take`, `skip`, selecting `first` markers, and
window evaluation. Do not rely on the physical index or scan selected by a plan.
Literal `values` and `generate` sources have construction-defined order.

```conjure
query PlayerPage(offset: int, limit: int) -> PlayerRow[] {
    from Player p
    | sort { -p.Score, p.Id }
    | skip @offset
    | take @limit
    | select { p.Id, p.Name, p.Score }
}
query DistinctGuildIds() -> int[] {
    from Player p | select p.GuildId | distinct
}
```

<a id="sort"></a>

`sort` keys are columns, optionally prefixed with `-` for descending or `+` for
ascending. Several keys use `{ ... }`. Nullable keys may specify `nulls first`
or `nulls last`. Derive a computed key before sorting by it.

<a id="take"></a>
<a id="skip"></a>

`take n` limits the number of rows; `skip n` discards the leading rows of the
admitted input sequence. Supply valid nonnegative page sizes and offsets; these
stages are not a substitute for defining which rows come first.

<a id="distinct"></a>

`distinct` removes repeated projected rows/values while preserving the first
occurrence. Project the comparison value first when distinctness should apply
to that value rather than the entire input row.

The observable sequence rules are:

| Operation | Sequence contract |
|---|---|
| Table source | Canonical logical traversal follows ascending primary-key identity when order is observable |
| `filter`, `derive`, `select`, `take`, `skip` | Preserve the relevant input sequence |
| `sort` | Establishes key order; equal keys retain input order |
| `distinct` | Retains the first occurrence in the input sequence |
| Ordinary join | Left traversal first; matches for a left row follow the right side's canonical order |
| Right/full outer join | Unmatched right rows follow the matched/left-driven traversal, in right canonical order |
| Scoped group | Groups follow first appearance of keys; each child starts with its group's input order |
| `union all` | Left input followed by right input |
| `sample`, `shuffle` | Defined by the admitted seed and sampling algorithm |

These rules do not make every final unsorted collection a user-visible sorted
list. Where only the final collection's multiset is observable, its order can be
unspecified. If the consumer needs a particular ordering, express it in the
pipeline. A group, join, or projection does not by itself grant every downstream
operation a usable sort proof.

## Set operations

Set operands are parenthesized pipelines with compatible result shapes. `union
all` retains duplicates; `union` eliminates them. `intersect` and `except` operate
on the projected row/value shape, rather than on an extra `by` key clause.

```conjure
query ActivePlayerIds() -> int[] {
    from Player p
    | filter p.Level >= 10
    | select p.Id
    | union (from Player other | filter other.Score > 100 | select other.Id)
}
```

For keyed membership, write a scalar projection and `in`/`not in`, or a correlated
`exists`/`!exists`. Set operations cannot invent missing members or reconcile
incompatible projected types merely by ordinal position.

## Result signatures and cardinality

### The signature chooses the surface

| Signature | Ownership / generated surface |
|---|---|
| `T[]` | An owned array result; the selected ordinary query method materializes it |
| `pooled<T>` | A read-only pooled result lease, disposed by its caller; generated type `ReadOnlyPooledQueryResult<T>` |
| `seq<T>` | Push traversal through the selected `NameForEach<TConsumer>(ref consumer, ...)` method |
| `map<K, V>` | Group-keyed dictionary result with values supplied by the scoped group body |
| `T` / `T?` | Required / optional row or scalar result, subject to cardinality admission |

For these canonical result constructors, only the selected surface is emitted. For example, `seq<int>` does not also
create a materializing `Name()` or a `NameNoAlloc()` companion. A pooled lease is
not a borrowed view into table storage, and does not expose the writable pooled
builder. Result-surface aliases retain their declared target:

```conjure
using PlayerFeed = seq<int>
query StreamPlayerIds() -> PlayerFeed {
    from Player p | select p.Id
}
```

Native modules retain their generated interface ownership: a declaration in
`module Sampling` is accessed through `context.Module<ISampling>()`, not an
invented `context.Sampling` property. Table-owned queries retain their actual
generated table repository contract. Surface selection changes that contract's
method/result shape; it does not move a query to a different owner.

### Cardinality markers

The compiler combines the **declared result** with its **completed cardinality
proof**. An estimate, a runtime count parameter, or a literal that has not earned
such a proof is not enough to remove a required marker.

| Declared result | Exactly one proven | At most one proven | Many / unknown |
|---|---|---|---|
| Required `T` | No marker | `single` | `single`, or ordered `first` |
| Optional `T?` | No marker | No marker | `single_or_default`, or ordered `first_or_default` |
| Collection surface | No marker | No marker | No marker |

A redundant marker is rejected. A collection cannot be turned into a scalar
contract by appending a terminal. `single`/`single_or_default` check uniqueness;
`first`/`first_or_default` select one row from the defined input order. Required
markers fail on empty input; optional markers preserve absence. An optional
numeric result does not replace absence with `default(int)`.

```conjure
query FindPlayer(id: int) -> Player? {
    from Player p | filter p.Id == @id
}
query HighestScore() -> int? {
    from Player p | sort { -p.Score, p.Id } | select p.Score | first_or_default
}
query HasHighScorer(minimum: int) -> bool {
    from Player p | filter p.Score >= @minimum | any
}
```

A primary-key equality can prove at-most-one; a global aggregate proves one
aggregate row. Proof is tied to the actual pipeline and its available keys, not
to a similar-looking expression in another query. `any` is an existence producer
requiring a nonnullable `bool` result, not a marker for an optional boolean value.

The old `| count` terminal is retired. Write `aggregate count()` for a row-count
reduction returning nonnullable `long`. This is not an API-preserving alias for
the old `int32` terminal; an existing generated contract needs migration proof.

## Sampling, shuffling, and generated rows

These are real query stages/sources, not RNG-capability constructors for systems.
The following module is standalone and needs no synthetic table:

```conjure
module Sampling {
    query Rows(count: int) -> int[] {
        from generate(@count) i | select i.RowIndex
    }
    query Choose(count: int, seed: uint) -> int[] {
        from generate(8) i
        | sample @count (seed: @seed)
        | select i.RowIndex
    }
    query Permutation(seed: uint) -> int[] {
        from generate(8) i
        | shuffle (seed: @seed)
        | select i.RowIndex
    }
}
```

- `generate(n)` emits indices `0` through `n - 1` as `RowIndex`. Runtime
  nonpositive counts emit no rows. There is no source `Seed` field or second
  seed argument.
- `sample n (seed: s)` samples without replacement; `replacement: true` permits
  repeated rows. Optional `weight: expression` selects weighted sampling.
- The seed is explicit, invocation-local `unity32` state. A zero seed is invalid;
  it is not silently changed to a different seed.
- For sampling/shuffling, the count and seed are invocation-level inputs, not
  row-dependent expressions.
  A weight may depend on the current row, but must meet its numeric/presence
  contract. Negative or otherwise invalid weights are not silently clamped.
- Without replacement, zero-weight rows are ineligible. Replacement requires a
  positive total weight for a nonempty selection. Nonpositive requested counts
  produce no sample rows; an empty source produces no fabricated choice.
- `shuffle (seed: s)` permutes the input. It is not `sort` by an uncontrolled
  random scalar. The same admitted seed and input sequence reproduce the result.

For table sampling, the input sequence and its canonical ownership remain part
of deterministic behavior; unrelated changes in physical access must not become
a hidden second RNG input.

## Current boundaries and migration

The examples above are current query syntax, not a compatibility tutorial. The
following are **rejected legacy spellings**, shown only to identify diagnostics:

| Rejected form | Current direction |
|---|---|
| `select A, B` | `select { A, B }`, or explicit named assignments |
| `select ... as Type` | Put the result type on the query declaration |
| `to_list` terminal | Select `T[]`, `pooled<T>`, or another supported result surface in the signature |
| `count(*)` | `count()` for aggregate row count |
| Inline `select sum(...)` | An explicit `aggregate`, or framed window in `derive` |
| `window ...` stage | Scoped `group`, `sort`, and `derive` window values |
| `collect(from ...)` | A direct parenthesized nested pipeline in a declared collection member |
| `semi join` / `anti join` | `exists(...)` / `!exists(...)` predicates |
| `join ... on ...`, `inner join`, `(==Key)` | Plain/outer join with an explicit parenthesized predicate |
| `intersect/except ... by key` | Project the comparison shape or use membership/existence |
| `cast(value as T)` | `value as T` |
| `and`, `or`, prefix `not`, `is null`, `between` | `&&`, `||`, `!`, `== null`, half-open range membership |
| `with name as (...)`, `alias = Source` | Query `let` and source-following aliases |

Range migration must preserve the intended endpoint: an inclusive legacy upper
bound is not the same predicate as the V3 excluded upper bound. Likewise, changing
a result surface can change its generated CLR API; similar rows do not establish
API equivalence.

A diagnostic fix-it is available only when the compiler can prove its exact
replacement and source extent. Some shape/API changes require a deliberate
rewrite; a diagnostic without an automatic edit is not permission to retain the
retired positive form.

Do not infer support from every decision in the broader RFC:

- Half-open membership and `@range` metadata do **not** establish a universal
  declared-range storage invariant. Do not assume every write path enforces an
  annotation or that it removes overflow checks.
- Recursive queries, a zero-copy borrowed result invalidated by later table
  writes, and arbitrary SQL window extensions are not promised here.
- Current query syntax does not imply that later command/system language waves
  or proposed schema/index removals have already shipped.
- Reactive/materialized queries have additional maintainability and lifetime
  admission. Ordinary query examples are not a promise that every shape can be
  incrementally maintained.
- Zero compiler-owned execution allocation is a separate admitted execution
  contract, not a guarantee for every array materialization or host function.

## Related references

- [Schema Language](/docs/schema/schema-language): declarations, relationships, modules, and query ownership.
- [Data Types](/docs/query-language/data-types): carriers, nullability, aliases, and result types.
- [Expressions](/docs/query-language/expressions): expression and operator details.
- [Custom Functions](/docs/query-language/functions): native and host function declarations.
- [Compiled Queries](/docs/query-language/compiled-queries): generated API use and execution.
- [Getting Started](/docs/getting-started): project setup and generation.

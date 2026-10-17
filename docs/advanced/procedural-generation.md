# Deterministic Procedural Generation (DPG)

## Overview

ConjureDB supports Deterministic Procedural Generation (DPG): a set of query
operators and runtime primitives that produce reproducible, seed-driven content
entirely within the compiled query pipeline. DPG targets game-client scenarios
where content must be generated on the fly — loot tables, daily offers, NPC
populations, level layouts, reward distributions — with repeatable results when
the seed, ordered input, and sampling contract are unchanged. `generate` itself is count-only and does not consume randomness.

Key properties:

| Property | Description |
|----------|-------------|
| **Deterministic** | Sampling uses an invocation-local Unity32 stream; the seed and input traversal order determine its sequence. Hash helpers are separate pure functions. |
| **Execution** | `generate` streams virtual rows; current sampling plans buffer input in managed collections. Do not assume sampling is zero-allocation. |
| **Composable** | DPG operators (`generate`, `sample`, `shuffle`, `materialize`) compose with compatible pipeline stages (`filter`, `sort`, `join`, `derive`, `select`, etc.). |

---

## Core Concepts

### Deterministic Hashing

The runtime hashing library (`DpgHash`) is based on xxHash64. It is separate
from the Unity32 stream used by `sample` and `shuffle`. Every
hash function is **pure** — no side effects or global state. The hash mixing
core uses integer arithmetic. `hash_normal` additionally uses floating-point
Box–Muller math; do not infer an arbitrary-runtime bit-exact guarantee from the
integer mixing core alone.

#### Hash Functions

| Function | Signature | Return Type | Description |
|----------|-----------|-------------|-------------|
| `hash` | `hash(seed: long, key: long) → long` | `long` | Core 64-bit hash. Combines a seed with an arbitrary key. |
| `hash_int` | `hash_int(seed: long, value: long, min: int, max: int) → int` | `int` | Uniform integer in `[min, max)`. |
| `hash_float` | `hash_float(seed: long, value: long) → double` | `double` | Uniform double in `[0.0, 1.0)`. IEEE 754 compliant. |
| `hash_normal` | `hash_normal(seed: long, value: long, mean: double, stddev: double) → double` | `double` | Normally distributed double (Box-Muller, deterministic). |
| `hash_index` | `hash_index(seed: long, value: long, count: int) → int` | `int` | Uniform index in `[0, count)`. Sugar for `hash_int(seed, value, 0, count)`. |

All public DPG hash functions accept a `long` seed as the first argument and
produce fully deterministic output. Range, float, normal, and index helpers
also take an explicit `value` input that is folded into the deterministic hash.

---

### Virtual Row Generation

The `generate(count)` source produces virtual rows without an underlying table
or `DbSet`. Each row exposes `RowIndex`, an `int` in `0 .. count-1`. A
nonpositive runtime count produces no rows. There is no implicit `Seed` column.

Virtual rows are created lazily during query execution. The source compiles to
a counted loop; downstream operators determine any additional storage needs.

```conjure
from generate(100) g
| select g.RowIndex
```

For keyed procedural values, explicitly derive a hash from your seed and
`RowIndex`; see [Generated Inventory with Templates](#pattern-2-generated-inventory-with-templates).

---

### Sampling

The `sample` operator selects rows with an invocation-local Unity32 random
stream. The seed must be a nonzero `uint`; zero is rejected rather than
normalized. Count and seed must be independent of the current input row.

```text
sample <count> (seed: <seed_expr> [, weight: <weight_expr>] [, replacement: true])
```

**Uniform sampling** (no `weight:` argument) uses partial Fisher–Yates without
replacement. With `replacement: true`, each output slot draws an input index
independently, so duplicates are possible.

**Weighted sampling** uses Efraimidis–Spirakis priorities without replacement
and cumulative weight bounds with replacement. Weights must be finite and
nonnegative; zero-weight rows are ineligible. Without replacement the result
contains at most the number of eligible rows. Weighted replacement requires a
finite, positive total weight for nonempty input. Empty input produces no rows.
A nonpositive runtime sample count produces no rows.

Sampling is **without replacement** by default. The current emitter buffers all
input rows, so this is not a streaming or zero-allocation operator. Input
traversal order is part of reproducibility: sort by a stable unique key before
sampling when the upstream traversal order is not otherwise fixed.

### Shuffling

The `shuffle` operator applies a Unity32 Fisher–Yates permutation to all input
rows, using the same seed requirements as sampling:

```text
shuffle (seed: <seed_expr>)
```

For identical ordered input and seed, uniform sampling without replacement
returns a prefix of that shuffle. This is not hash-priority ordering.

**Sequence migration:** canonical sampling changes the random sequence from
the retired hash-based sampling surface. Updating the spelling does not
preserve old sampled content. Count-only generation also removes the implicit
`Seed` output, so any generated public result types and saved procedural content
must be reviewed explicitly; there is no automatic API or content equivalence.

---

### Materialization

The `materialize` operator persists DPG results into a named table and
controls when that table is refreshed:

```text
materialize into <TableName> [refresh on(<sources>) [every(<interval>)]]
```

Materialized results are stored as a regular `DbSet` and can be queried by
other compiled queries. Refresh is tick-driven (game-loop model, no OS timers),
ensuring deterministic update timing.

---

## Usage Patterns

### Pattern 1: Simple Loot Table

Select up to 5 weighted items from a loot template table with unique `ItemId`
values. Sampling parameters
(`@playerSeed`, `@dailySeed`, `@spawnSeed`, and `@gameSeed` below) are nonzero
`uint` values; seeds passed to the separate hash helpers are `long` values.

```conjure
from LootTemplates t
| sort t.ItemId
| sample 5 (seed: @playerSeed, weight: t.DropWeight)
| select { t.ItemId, t.Name, t.Rarity }
```

### Pattern 2: Generated Inventory with Templates

Generate 100 virtual slots, join each to an item template using a hashed index,
then derive per-slot quantity and quality. This example requires template IDs
to be dense in `[0, 50)`; use an explicit lookup mapping for other key layouts.
`RowSeed` is an authored derived value, not a column supplied by `generate`.

```conjure
from generate(100) g
| derive RowSeed = hash(@worldSeed, g.RowIndex)
| join ItemTemplates t (hash_index(RowSeed, 0L, 50) == t.Id)
| derive {
  Quantity = hash_int(RowSeed, 1L, 1, 10),
  Quality = hash_float(RowSeed, 2L)
}
| select { Slot = g.RowIndex, Name = t.Name, Quantity = Quantity, Quality = Quality }
```

### Pattern 3: Daily Offers

Deterministic daily shop: 3 weighted products, materialized and refreshed on
source change or every 24 hours.

```conjure
from Products p
| sort p.Id
| sample 3 (seed: @dailySeed, weight: p.OfferWeight)
| select { p.Id, p.Name, p.Price }
| materialize into DailyOffers refresh on(Products) every(86400 s)
```

### Pattern 4: Weighted Enemy Spawning

Use `sample n (seed: @seed, weight: weight_expr)` for weighted deterministic
picks. With replacement, the same template may be chosen more than once:

```conjure
from EnemyTemplates e
| sort e.Id
| sample 20 (seed: @spawnSeed, weight: e.SpawnWeight, replacement: true)
| select e.Id
```

The standalone `hash_weighted_index` helper is not part of the current DSL surface,
so weighted selection should be expressed through `sample`, while positional
and level variation can still come from `hash_float(seed, value)` and
`hash_int(seed, value, min, max)`.

### Pattern 5: Shuffled Deck

Deterministic shuffle of a card deck, then draw 5. The example assumes each
`(Suit, Rank)` pair identifies one card.

```conjure
from Cards c
| sort c.Suit, c.Rank
| shuffle (seed: @gameSeed)
| take 5
| select { c.Suit, c.Rank, c.Value }
```

### Pattern 6: Deterministic NPC Names

Combine first and last name tables via independent hashed indices to generate
NPC names. Pass the current positive row counts explicitly; `count(fn)` is not a
scalar table-cardinality expression inside a join predicate. The example assumes
each name table has dense integer IDs in `[0, count)` and that the supplied
counts match the table contents. Without that contract, a hashed index can miss
a row, so use an explicit lookup mapping instead.

```conjure
from generate(50) g
| derive RowSeed = hash(@townSeed, g.RowIndex)
| join FirstNames fn (hash_index(RowSeed, 0L, @firstNameCount) == fn.Id)
| join LastNames ln (hash_index(RowSeed, 100L, @lastNameCount) == ln.Id)
| select { First = fn.Name, Last = ln.Name, NpcId = g.RowIndex }
```

---

## Materialization & Refresh

### Source-Based Refresh

```text
from ... | materialize into Cache refresh on(Templates, Config)
```

When `Templates` or `Config` tables receive commits, `Cache` is scheduled for
full regeneration on the next tick.

### Interval-Based Refresh

```text
from ... | materialize into DailyDeals every(86400 s)
```

Regenerated every 86 400 seconds (24 hours) in game-loop ticks — not
wall-clock time. The tick counter is owned by the `DbContext` and advanced
explicitly by the game loop.

### Combined

```text
from ... | materialize into Cache refresh on(Templates) every(3600 s)
```

Whichever condition fires first triggers regeneration. After regeneration the
interval timer resets.

---

## Hash Function Reference

| Function | Signature | Range | Example |
|----------|-----------|-------|---------|
| `hash` | `(seed: long, key: long) → long` | Full `long` range | `hash(@seed, 42L)` → deterministic 64-bit value |
| `hash_int` | `(seed: long, value: long, min: int, max: int) → int` | `[min, max)` | `hash_int(@seed, 0L, 1, 100)` → integer in `[1, 100)` |
| `hash_float` | `(seed: long, value: long) → double` | `[0.0, 1.0)` | `hash_float(@seed, 0L)` → `0.7312...` |
| `hash_normal` | `(seed: long, value: long, mean: double, stddev: double) → double` | Unbounded (normal dist.) | `hash_normal(@seed, 0L, 0.0, 1.0)` → `−0.42...` |
| `hash_index` | `(seed: long, value: long, count: int) → int` | `[0, count)` | `hash_index(@seed, 0L, 50)` → index in `[0, 50)` |

---

## Design Notes

- **Determinism contracts.** Hash helpers are keyed pure functions; sampling
  uses a separate invocation-local Unity32 stream whose consumption depends on
  ordered input. Neither count-only generation nor a syntax migration preserves
  the removed implicit seed/result contract. Validate saved-content expectations
  when changing the query, input order, or sampling contract.

- **Performance.** `generate` compiles to a counted loop. Current `sample` and
  `shuffle` plans buffer input in managed lists; weighted selection also needs
  auxiliary state. Measure the complete query rather than assuming zero heap
  use or a single-pass reservoir implementation.

- **Composability.** DPG operators are regular pipeline stages. They can be
  freely combined with `filter`, `sort`, `join`, `derive`, `group`, `select`,
  and other operators where their contracts permit. Sampling is order-sensitive;
  optimizer transformations must preserve the authored traversal sequence and
  random-stream consumption rather than freely reordering rows across it.

- **Materialization scheduler.** Refresh is tick-driven, not timer-driven. The
  game loop calls `DbContext.Tick()` which checks pending refresh conditions.
  This avoids OS timer jitter and keeps regeneration deterministic with respect
  to game state.

- **Compatibility with PGO.** DPG queries benefit from
  [Profile-Guided Optimization](/docs/performance/pgo) — PGO data can size output buffers,
  select join strategies, and tune aggregation thresholds for materialized DPG
  results.

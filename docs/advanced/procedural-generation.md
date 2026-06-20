# Deterministic Procedural Generation (DPG)

## Overview

ConjureDB supports Deterministic Procedural Generation (DPG): a set of query
operators and runtime primitives that produce reproducible, seed-driven content
entirely within the compiled query pipeline. DPG targets game-client scenarios
where content must be generated on the fly — loot tables, daily offers, NPC
populations, level layouts, reward distributions — while guaranteeing that the
same seed always yields the same output on every platform and every run.

Key properties:

| Property | Description |
|----------|-------------|
| **Deterministic** | Same seed + same input = identical output across all platforms (IEEE 754 compliant, integer-only arithmetic in hash functions). |
| **Efficient** | Zero-allocation in generated code. No managed collections on the hot path. |
| **Composable** | DPG operators (`generate`, `sample`, `shuffle`, `materialize`) compose freely with all other pipeline stages (`filter`, `sort`, `join`, `derive`, `select`, etc.). |

---

## Core Concepts

### Deterministic Hashing

DPG is built on a runtime hashing library (`DpgHash`) based on xxHash64. Every
hash function is **pure** — no side effects, no global state, no floating-point
arithmetic in the mixing core — ensuring bit-identical results regardless of
platform, JIT, or runtime version.

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

The `generate(count, seed)` operator produces virtual rows without any
underlying table or `DbSet`. Each row receives two implicit columns:

| Column | Type | Derivation |
|--------|------|------------|
| `RowIndex` | `int` | Sequential `0 .. count-1`. |
| `Seed` | `long` | `hash(baseSeed, rowIndex)` — unique per-row seed. |

Virtual rows are created lazily during query execution. No intermediate
collection is allocated — the emitter produces a counted loop that feeds
downstream operators directly.

```
from generate(100, @worldSeed) g
| select g.RowIndex, g.Seed
```

---

### Sampling

The `sample` operator performs deterministic subset selection:

```
sample <count> seed <seed_expr> [by <weight_expr>]
```

**Uniform sampling** (no `by` clause): each row is hashed with the provided
seed; the top-N rows by hash priority are selected. This is an O(N) single-pass
algorithm with zero allocations beyond the output buffer.

**Weighted sampling** (`by weight_expr`): implements the Efraimidis-Spirakis
one-pass weighted reservoir algorithm. Each row's priority is
derived from a deterministic uniform sample raised to `(1 / weight)`, and the
top-N priorities win. This
guarantees that higher-weight rows are proportionally more likely to appear.

By default, sampling is **without replacement** — each row can appear at most
once. Append `with replacement` to allow duplicates.

---

### Shuffling

The `shuffle` operator applies a deterministic permutation to all input rows:

```
shuffle <seed_expr>
```

Semantically, `shuffle seed` is sugar for
`sample int.MaxValue seed expr` (without replacement). Every row receives a
hash-derived priority and the output is ordered by that priority, producing a
deterministic permutation of the entire input.

---

### Materialization

The `materialize` operator persists DPG results into a named table and
controls when that table is refreshed:

```
materialize into <TableName> [refresh on(<sources>) [every(<interval>)]]
```

Materialized results are stored as a regular `DbSet` and can be queried by
other compiled queries. Refresh is tick-driven (game-loop model, no OS timers),
ensuring deterministic update timing.

---

## Usage Patterns

### Pattern 1: Simple Loot Table

Select 5 weighted items from a loot template table.

```
from LootTemplates t
| sample 5 seed @playerSeed by t.DropWeight
| select t.ItemId, t.Name, t.Rarity
```

### Pattern 2: Generated Inventory with Templates

Generate 100 virtual slots, join each to an item template using a hashed index,
then derive per-slot quantity and quality.

```
from generate(100, @worldSeed) g
| join ItemTemplates t (hash_index(g.Seed, 0L, 50) == t.Id)
| derive {
  Quantity = hash_int(g.Seed, 0L, 1, 10),
  Quality = hash_float(g.Seed, 0L)
}
| select g.RowIndex as Slot, t.Name, Quantity, Quality
```

### Pattern 3: Daily Offers

Deterministic daily shop: 3 weighted products, materialized and refreshed on
source change or every 24 hours.

```
from Products p
| sample 3 seed @dailySeed by p.OfferWeight
| select p.Id, p.Name, p.Price
| materialize into DailyOffers refresh on(Products) every(86400 s)
```

### Pattern 4: Weighted Enemy Spawning

Use `sample ... by <weight_expr>` for weighted deterministic picks. The
standalone `hash_weighted_index` helper is not part of the current DSL surface,
so weighted selection should be expressed through `sample`, while positional
and level variation can still come from `hash_float(seed, value)` and
`hash_int(seed, value, min, max)`.

### Pattern 5: Shuffled Deck

Deterministic shuffle of a card deck, then draw 5.

```
from Cards c
| shuffle @gameSeed
| take 5
| select c.Suit, c.Rank, c.Value
```

### Pattern 6: Deterministic NPC Names

Combine first and last name tables via independent hashed indices to generate
unique NPC names.

```
from generate(50, @townSeed) g
| join FirstNames fn (hash_index(g.Seed, 0L, count(fn)) == fn.Id)
| join LastNames ln (hash_index(hash(g.Seed, 100L), 0L, count(ln)) == ln.Id)
| select fn.Name as First, ln.Name as Last, g.RowIndex as NpcId
```

---

## Materialization & Refresh

### Source-Based Refresh

```
from ... | materialize into Cache refresh on(Templates, Config)
```

When `Templates` or `Config` tables receive commits, `Cache` is scheduled for
full regeneration on the next tick.

### Interval-Based Refresh

```
from ... | materialize into DailyDeals every(86400 s)
```

Regenerated every 86 400 seconds (24 hours) in game-loop ticks — not
wall-clock time. The tick counter is owned by the `DbContext` and advanced
explicitly by the game loop.

### Combined

```
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

- **Determinism guarantee.** All hash functions use integer-only arithmetic for
  the mixing core. Floating-point conversions happen only at the final output
  step and follow IEEE 754 rules, ensuring cross-platform reproducibility.

- **Performance.** Generated code is zero-allocation on the hot path. `generate`
  compiles to a counted loop; `sample` is a single-pass O(N) scan; `shuffle`
  reuses the `sample` implementation. No managed heap allocations occur during
  execution.

- **Composability.** DPG operators are regular pipeline stages. They can be
  freely combined with `filter`, `sort`, `join`, `derive`, `group`, `select`,
  and all other operators. The optimizer handles DPG nodes like any other
  relational operator — they participate in predicate pushdown, join reordering,
  and emission.

- **Materialization scheduler.** Refresh is tick-driven, not timer-driven. The
  game loop calls `DbContext.Tick()` which checks pending refresh conditions.
  This avoids OS timer jitter and keeps regeneration deterministic with respect
  to game state.

- **Compatibility with PGO.** DPG queries benefit from
  [Profile-Guided Optimization](/docs/performance/pgo) — PGO data can size output buffers,
  select join strategies, and tune aggregation thresholds for materialized DPG
  results.

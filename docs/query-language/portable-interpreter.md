# Portable Interpreter (No-JIT Runtime)

How ConjureDB runs queries that are delivered as configuration at runtime — on platforms that forbid
JIT compilation — without giving up speed or zero-allocation execution.

ConjureDB's default path compiles every query you declare to C# at build time, so there is nothing to
interpret at runtime (see [Compiled Queries](/docs/query-language/compiled-queries)). But some queries
are not known at build time — they ship later as content or config (live-ops tuning, server-authored
queries). On iOS and Unity/IL2CPP you cannot JIT or emit code at runtime to handle them. The
**portable interpreter** is the lane that executes those queries: it runs a compact, pre-verified
bytecode with **no JIT, no runtime code generation, and no reflection**, so it works everywhere AOT
does — and it is still fast and allocation-lean.

**See also:** [Compiled Queries](/docs/query-language/compiled-queries) · [Performance Tips](/docs/performance/performance-tips) · [Query Language](/docs/query-language/reference) · [Database Engine](/docs/engine/database-engine)

---

## Table of Contents

- [Two execution lanes](#two-execution-lanes)
- [When each lane runs](#when-each-lane-runs)
- [Performance expectations](#performance-expectations)
- [What it is not](#what-it-is-not)

---

## Two execution lanes

ConjureDB has two explicit, contract-driven execution lanes for the same query semantics:

| Lane | What it is | Built for |
|---|---|---|
| **AOT C#** (default) | Your query is compiled to C# at build time and runs as native AOT/IL2CPP code | The hottest, highest-throughput queries you know at build time |
| **Portable interpreter** | The query ships as a portable bytecode artifact and is executed by a no-JIT register-based interpreter | Config-delivered queries that are not known at build time, on platforms without a JIT |

Both lanes produce **bit-identical results** — the portable lane is continuously verified against the
AOT-compiled path by differential and SQL-parity tests. The portable interpreter is a deliberate
second lane, **not** a silent fallback: the runtime executes only the lane your host policy allows,
and fails fast with an explicit reason code if a requested lane is unavailable or incompatible.

## When each lane runs

- A query you write and ship in your build → **AOT C#**. This is the default and the path the
  [Performance](/performance) numbers describe. Nothing is interpreted.
- A query delivered as content or configuration after the build (so there is no C# to compile ahead
  of time), running on iOS or Unity/IL2CPP where runtime codegen is forbidden → **portable
  interpreter**.

You do not pick the lane per call at random — it is determined at compile time and by explicit host
policy. Mark a query hot-path-critical to keep it in the AOT lane; mark it config-dynamic to make it
portable.

## Performance expectations

The portable interpreter is built to be the kind of interpreter you can run in a frame budget:

- **Zero steady-state allocation.** Every operator family (scan, filter, project, sort, top-N, hash
  and multi-key aggregate, distinct, join, set ops, window) executes amortized-allocation-free —
  ≤ ~600 bytes per query for the heaviest scenario, and **0 bytes** for a point lookup. Pooled
  hashtables and arena-backed key/accumulator buffers keep the GC out of the hot path.
- **O(1) keyed lookups.** A primary-key lookup probes the index in constant time — about **19 ns**
  regardless of table size, versus a full scan that grows with row count. A point lookup is fully
  allocation-free.
- **~10–50 ns per row.** Most queries run in that band per row scanned, so latency tracks how much
  data the query touches rather than interpreter overhead. On a 1,000-row table a filtered projection
  is ~8 µs and a hash group-by is ~4 µs.
- **Parity with the AOT lane.** Same results, same ordering, same null semantics — the interpreter is
  a strict consumer of the same planned metadata the AOT lane uses.

:::note
The portable lane is fast for an interpreter, but the AOT C# lane is still the throughput ceiling —
keep your hottest, build-time-known queries there. The portable lane's job is to run the queries the
AOT lane structurally cannot (those not known at build time) on platforms a JIT cannot run on, without
falling off a performance cliff.
:::

See the [Performance](/performance) page for the full measured table: throughput and allocation for
all 16 operator scenarios, plus the O(1)-vs-O(n) scaling study across table sizes.

## What it is not

- It is **not** a runtime query parser or a `dynamic`/reflection-based evaluator. The query is
  compiled and verified ahead of time into a typed bytecode; the device only decodes and executes it.
- It is **not** a degraded fallback for failed compilation. Lane selection is explicit; an
  unsupported or incompatible plan is a hard error with a reason code, never a silent downgrade.
- It does **not** replace the AOT C# lane. It complements it for the config-delivered, no-JIT case.

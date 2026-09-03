# Ephemeral Tables — Reference

:::caution Platform status
Ephemeral tables run on .NET 8+ / CoreCLR hosts. Unity (Mono, IL2CPP, and the CoreCLR
backend preview) is not supported until the netstandard2.1 emission profile lands.
:::

Ephemeral tables store high-frequency game state that exists only for the current
process session. They use generated chunked storage and a `DbContext`-owned
`FrameScheduler`. They are frame-local storage with a compiled access path — not a
second incremental data platform.

Persistent tables remain the sole owner of transactions, persistence, secondary and
spatial indexes, Reactive Query, materialized views, IVM, Z-sets, DbSet/query
subscriptions, and retained change history.

This page is written to answer one question without reading compiler source: **what is
supported, what is refused, and what simply does not exist yet.** Every refusal below is
a typed diagnostic you will actually see, quoted by its code.

- Concepts and cases: [Ephemeral Tables and Frame Systems](/docs/advanced/ephemeral-tables)
- Worked example: [Arena: an ECS-style game loop](/docs/examples/arena-ecs)

---

## Capability matrix

### Supported today

| Capability | Since | Notes |
|---|---|---|
| Typed schema kinds: `ephemeral table`, `event table`, `singleton table` | P0 | Chunked struct-of-arrays storage, no reflection |
| `entity domain` — one id/generation authority shared by member tables | P0 | Tables outside a declared domain get an implicit single-table domain |
| Generational `EntityHandle` with always-on staleness checks | P0 | Release builds included |
| Enabled masks (`SetEnabled`) as visibility without moving rows | P0 | Iteration visibility changes at deterministic boundaries |
| Imperative API: `Create`, `CreateFor`, `Destroy`, `IsAlive`, `VisitEntities` | P0 | Reflection-free generated accessors |
| Compiled chunk scan with `filter` and `select` | P1 | Column pruning drives the touched group set |
| Compiled direct lookup when the query constrains the ephemeral row id | P1 | Planner selects `EphemeralDirectLookup` instead of scanning |
| Scalar aggregates — `count(*)`, including filtered and by-id forms | P1 | Cardinality-only counts avoid materializing rows |
| `sort … | take k` bounded Top-N over an ephemeral source | P1 | |
| Compiled reads over `event table` rows | P1 | Reads the readable buffer; see [Event tables and double buffering](#event-tables-and-double-buffering) |
| Mixed joins between ephemeral and persistent tables, both orientations | P1 | Full detail in [Interop with persistent tables](#interop-with-persistent-tables) |
| Bitmap semi/anti membership across kinds | P1 | Fan-out-once semi, anti complement, rebuilt per call |
| Grouped aggregation (`group … (aggregate { … })`) over ephemeral and event sources | P1 | Ordinary allocating surface; see the note below |
| `distinct` over a projected ephemeral column | P1 | Ordinary allocating surface |
| Set operations (`union`, `intersect`) mixing an ephemeral and a persistent branch | P1 | Ordinary allocating surface |
| Correlated `exists(...)` subquery from an ephemeral driver into a persistent table | P1 | |
| `window by … (rn = row_number)` partitioned by an ephemeral column | P1 | Ordinary allocating surface |
| `NoAlloc` / `ForEach` query variants over ephemeral storage | P1 | Subject to the usual static zero-heap proof |
| Per-table `ForEachChunk<TKernel>` chunk consumer | P1 | Constrained call, no boxing — see [Per-table chunk kernels](#per-table-chunk-kernels) |
| Frame-scoped row leases (`AcquireRowRead` / `AcquireRowWrite`) for hand-written systems | 2026-09 | One authorization per system invocation; see [Hand-written systems and exact access](#hand-written-systems-and-exact-access) |
| `OnFrameRuntimeRegistered` ordering hook against generated systems | 2026-09 | See [Ordering hand-written systems against generated ones](#ordering-hand-written-systems-against-generated-ones) |
| Per-system and per-frame managed-allocation accounting in `LastFrameReport` | 2026-09 | `FrameSystemTiming.AllocatedBytes`, `LastFrameReport.AllocatedBytes` |
| netstandard2.1 row references (Unity Mono / IL2CPP / CoreCLR) | 2026-09 | Generated `RowRef` / `RowMutRef` / query row refs carry a ref-field branch and a portable column-array + offset branch under `#if NET7_0_OR_GREATER`; see [Platforms](#platforms) |
| Host-substituted system implementations (`FrameScheduler.SubstituteImplementation`, `DbContextBuilder.ConfigureFrameRuntime`) | 2026-09 | Identical access manifest required; see [Host-accelerated kernels](#host-accelerated-kernels-unity-jobs--burst) |
| Frame-scoped recording leases (`Commands.AcquireRecorder`, `CreateRange` / `DestroyRange`) | 2026-09 | One structural authorization per system invocation; see [Recording leases and the lookup view](#recording-leases-and-the-lookup-view) |
| Pin-stable chunk memory and `AcquireEntityLookup` for host kernels | 2026-09 | `EphemeralChunkMemory.PointerOf`, `EphemeralEntityLookup.TryResolve`; see [Host-accelerated kernels](#host-accelerated-kernels-unity-jobs--burst) |
| `system` declaration, `FrameScheduler`, typed access manifests | P2 | |
| Command buffers with provisional handles resolved at boundaries | P2 | |
| Post-commit `command … event … into <EventTable>` routes | P2 | Publishes only after commit |
| `PresentationBinding`, explain snapshots, per-system timings, Unity hosting | P2 | |
| Portable-vector (SIMD) frame-system kernels | post-P2 | Deliberately narrow — see [Frame-system SIMD lane](#frame-system-simd-lane) |
| Portable-vector `COUNT(*)` over one `Float32` range predicate | post-P2 | Narrower still — see [Compiled-query vector lane](#compiled-query-vector-lane) |

### Refused by design — permanent

These are owner decisions, not gaps. There is no planned phase that removes them.

| What you tried | Diagnostic you will see | Sanctioned alternative |
|---|---|---|
| `reactive query` reading (or joining) an ephemeral table, directly or transitively | **UMEP013** `EphemeralSourceNotReactive` — *"…this storage kind is permanently non-reactive and cannot feed materialized/IVM maintenance (no delta stream). Publish results into a persistent table and use that as the source instead."* | Run a frame-rate compiled query; or publish a typed summary to a persistent table and make that the reactive source; or `command → event → system` |
| `materialized view` whose source lineage reaches an ephemeral table (including through views and fragments) | **UMEP013**, with the offending source path named | Same as above |
| A transactional `command` / `mutation` writing an ephemeral table | **UMEP014** `Transactional operation '{0}' cannot write ephemeral table '{1}'` | Write from a frame system, or route one typed payload with `event … into <EventTable>` |
| A mutation method on an ephemeral query host | **UMCG028** *"Mutation method '{0}' cannot be emitted on ephemeral table '{1}'. Frame-local writes are owned by frame systems and command buffers."* | Frame systems and command buffers |
| `singleton table` used as a `FROM` or join source | **BIND_RES_057** *"Singleton table '{0}' cannot be a query source. Read it through its direct accessor (e.g. `context.<Name>.Value`) instead of FROM/join."* | The direct accessor |
| Compiled queries hosted on a singleton table | **UMCG026** *"Singleton tables cannot host compiled queries…"* | Move the query to a plain-ephemeral, event, or persistent `FROM` entity |
| An ephemeral query on the PortableRuntime execution target | **UM6022** `PortableUnsupportedStrategy` | PortableRuntime execution of ephemeral scans is an explicit non-goal; run the generated host path |
| `@index` on an ephemeral table | **UMEP002** | Join to a persistent table that owns the index ([Interop with persistent tables](#interop-with-persistent-tables)) |
| `persistence:` / `type_id:` on an ephemeral table | **UMEP003** / **UMEP004** | Ephemeral data is never persisted or migrated |
| `@relation` whose **target** is an ephemeral kind (from any table), or `@@navigation` on an ephemeral table | **UMEP009** — *"relations INTO ephemeral kinds are forbidden (frame-lifetime rows must not be referenced)"* | Join on the plain int key instead ([Dangling keys under id reuse](#dangling-keys-under-id-reuse)). A relation **from** an ephemeral table **to** a persistent one is allowed |
| Change detection: `changed()`, per-chunk change versions, epochs, system cursors, delta journal, dirty enumeration | *no syntax exists* | Run the frame kernel over all rows; or use a persistent table + IVM when sparse incremental work is the real need |
| MVCC, rollback, transactions, retained history over ephemeral data | *no API exists* | Persistent tables |

### Not offered today

These are **not** scheduled phases. The former P3/P5 umbrella phases were retired
because they grouped unrelated optimizations without evidence that the P0–P2 product
boundary missed a contract or SLO. Each item below is an *evidence-triggered program*:
work starts only after its trigger is demonstrated and an owner is named.

| Not available | Status | Reopen trigger |
|---|---|---|
| Per-**query** chunk consumers (`ForEachChunk` bound to a filtered query) | Not offered. Honoring a predicate needs per-query selection vectors, which do not exist. The per-**table** `ForEachChunk` is shipped instead | A workload that needs a filtered zero-heap chunk consumer |
| Automatic presentation interpolation / previous-value columns | Not offered. `FrameContext.InterpolationAlpha` is exposed; history and policy stay presentation-owned | A title demonstrates visible stutter and presentation-local history is insufficient |
| Archetype clusters, cluster joins, layout solver, grid-as-storage | Not reserved designs. A future program must re-derive them from evidence | A broadphase or repeated multi-table probe misses its SLO after schema and query tuning |
| Parallel frame execution | Not offered; scheduling is serial and deterministic | Serial scheduling measured as a bottleneck with at least two expensive disjoint groups |
| IL2CPP / Burst performance claims | No recorded evidence. Recorded proofs are CoreCLR-only | A shipping target requires that platform lane |
| Networking / rollback | Out of scope for this feature | A title chooses a concrete netcode model |

---

## Schema declarations

```prql
table Player(persistence: none, type_id: 61001) {
    Id: int @id
    Level: int
}

ephemeral table Position(plural: Positions, capacity: 1024, max_capacity: 65536) {
    Id: int @id
    X: float
    Y: float
    OwnerId: int @relation(references: Player.Id)   // ephemeral -> persistent is allowed

    @@group(fields: [X, Y], name: "Pos")
}

ephemeral table Velocity(plural: Velocities, capacity: 1024) {
    Id: int @id
    Dx: float
    Dy: float
}

event table DamageEvent(plural: DamageEvents, capacity: 256, lifetime: next_frame) {
    SourceId: int
    TargetId: int
    Amount: int
}

singleton table FrameTime {
    Dt: float
    Tick: long
}

entity domain Unit { Position, Velocity }
```

Table options accepted by the parser are `persistence`, `capacity`, `max_capacity`,
`lifetime`, `schema_version`, `type_id`, and `plural`. Anything else is rejected by
name. `lifetime:` accepts exactly `frame` or `next_frame`.

### The three ephemeral kinds

| Kind | Identity | Chunked scan | Direct id lookup | Lifetime |
|---|---|---|---|---|
| `ephemeral table` | Generational `EntityHandle`; `@id` must be a non-nullable `int` | yes | yes | Rows live until destroyed |
| `event table` | none | yes (whole-row) | no | Cleared at `FrameEnd` (`frame`) or swapped at `FrameStart` (`next_frame`) |
| `singleton table` | exactly one row | no | no | Field-cost frame-global state |

Column types must be pointer-free: unmanaged scalars (`int`, `long`, `float`, `double`,
`decimal`, `bool`, `byte`, `short`, `uint`, `ulong`, `datetime`, `timespan`, `guid`,
`Fixed32`, `Fixed64`), enums, declared blittable structs, and their nullable forms.
Strings, binary, lists, arrays, and extern CLR types are rejected.

### Declaration diagnostics

Every ephemeral schema rejection is one of these codes.

| Code | Raised when |
|---|---|
| `UMEP001` | A column type is not pointer-free/blittable |
| `UMEP002` | A secondary index is declared |
| `UMEP003` | `persistence:` is declared |
| `UMEP004` | `type_id:` is declared |
| `UMEP005` | An `event` or `singleton` table declares an `@id` field |
| `UMEP006` | A `singleton` table declares `capacity:` |
| `UMEP007` | `lifetime:` is declared on a non-event kind |
| `UMEP008` | A `@@group(...)` layout is invalid |
| `UMEP009` | A `@relation` targets an ephemeral kind, or `@@navigation` is declared on one (a relation *from* ephemeral *to* persistent is fine) |
| `UMEP010` | The capacity contract is invalid |
| `UMEP011` | `entity domain` membership is invalid |
| `UMEP012` | An `@id` field is not a non-nullable `int` |
| `UMEP013` | A reactive query or materialized view depends on ephemeral storage |
| `UMEP014` | A transactional command or mutation writes an ephemeral table |
| `UMEP015` | A command event route targets a table that is not an event table |

Code-generation-time refusals use the `UMCG` family: `UMCG026` (singleton query host),
`UMCG028` (mutation on an ephemeral host), `UMCG029` (repository/host owner mismatch),
`UMCG030` (storage kind cannot host an ephemeral query surface). `UMCG024` wraps an
underlying DSL compilation failure for an ephemeral query host and quotes the inner
compiler diagnostic.

---

## Query language support

### What compiles over an ephemeral source

Planning admits exactly two access paths for a non-persistent source:
`EphemeralChunkScan` and `EphemeralDirectLookup`. Any other scan strategy over such a
table is an emission-invariant violation, not a slow path.

| DSL shape | Access path | Evidence |
|---|---|---|
| `from P p \| filter p.X > @minX \| select p.Id, p.X, p.Y` | chunk scan, pruned column groups | shipped test |
| `from P p \| filter p.Id == @id \| select …` | direct lookup through the sparse map | shipped test |
| `from P p \| aggregate { Cnt = count(*) }` | cardinality-only count | shipped test |
| `from P p \| filter … \| aggregate { Cnt = count(*) }` | filtered count | shipped test |
| `from P p \| sort -p.Y \| take @k \| select …` | bounded Top-N | shipped test |
| `from E e \| filter … \| select …` over an `event table` | whole-row event stream scan | shipped test |
| `from E e \| join P p (e.TargetId == p.Id) \| select …` | ephemeral slot probe | shipped test |
| `from P p \| join Player pl (p.OwnerId == pl.Id) \| select …` | persistent index families ([Interop with persistent tables](#interop-with-persistent-tables)) | shipped test |
| semi/anti membership across kinds | bitmap membership | shipped test |
| `from P p \| group p.OwnerId (aggregate { Cnt = count(*) }) \| select …` | chunk scan + grouped aggregate | shipped test |
| `from P p \| filter … \| group … (aggregate { MaxY = max(p.Y) }) \| select …` | pre-group filter + grouped aggregate | shipped test |
| `from E e \| group e.TargetId (aggregate { Total = sum(e.Amount) }) \| select …` | event stream + grouped aggregate | shipped test |
| `from P p \| select p.OwnerId \| distinct` | chunk scan + distinct | shipped test |
| `from P p \| select p.OwnerId \| union (from Player pl \| select pl.Id)` | mixed-branch set operation | shipped test |
| `from P p \| filter exists(from Player pl \| filter pl.Id == p.OwnerId \| select pl.Id) \| select p.Id` | correlated EXISTS into a persistent table | shipped test |
| `from P p \| sort -p.Y, p.Id \| window by p.OwnerId (rn = row_number) \| select …` | chunk scan + row-number window | shipped test |

Disabled rows and destroyed rows are excluded from every one of these paths, including
direct lookups and slot probes.

**Result-surface note for the set-oriented shapes.** Grouped aggregation, `distinct`,
set operations, and row-number windows are supported on the **ordinary allocating**
query surface only. Their results own a growable collection, so the compiler-owned
zero-heap proof for the `NoAlloc` and `ForEach` variants legitimately declines them and
reports `UMCG034` *"…was not generated (Unproven)"* at generation time. That is a
resource-contract verdict, not a failure: the ordinary surface is generated, compiles,
and is proven correct. Ask for these shapes on the allocating surface.

The mandatory baseline SLO for the feature is **≤ 350 µs for 100k rows × 3 components**.
For compiled reads specifically, the recorded content-addressed gate measured a filtered
compiled query at 1.057× / 1.037× and a cardinality-only compiled count at 0.938× /
0.909× against their hand-written twins at 100k / 1M rows. Those ratios are payload- and
host-specific recordings, not a cross-platform SLO.

### Frame-system SIMD lane

`system` declarations support a set-oriented update with same-domain id joins, an
optional filter, and `=`, `+=`, `-=`, `*=`, `/=`:

```prql
system IntegrateMotion(phase: fixed_update) {
    update Position p
    | join Velocity v (p.Id == v.Id)
    | set p.X += v.Dx * @dt,
          p.Y += v.Dy * @dt
}
```

The compiler publishes a typed execution decision for every generated kernel. The
portable-vector body is admitted only for: one source, no join, no filter, direct
non-null `float` SoA columns, and expressions built from column reads, `float`/`double`
literals, `@dt`, `+`, `-`, `*`, and unary negation. Every other valid shape runs the
canonical scalar body with a typed rejection reason — a semantic fallback, not a second
planner.

An eligible kernel guards on `Vector.IsHardwareAccelerated`, widens `float` to `double`
where the bound expression requires it, computes all right-hand sides before the first
store (preserving exact simultaneous `set` semantics), then narrows once. Dense bitmap
words vectorize for every admitted kernel. Mixed-word SIMD is deliberately narrower: at
least four assignments and eight widened-double operations, then at least 16 fully
enabled lanes in the word. Cheaper kernels, fragmented blocks, and final sub-vector
tails use the same scalar body.

`FrameSchedulerOptions.KernelExecutionPolicy` fixes dispatch for the scheduler's
lifetime. `Auto` is the production default. `ForceScalarPortableKernel` runs the same
generated scalar oracle with intrinsics still enabled — for deterministic diagnostics
and A/B validation, not as a second planner.

**Recorded evidence (developer host, CoreCLR only — not a cross-platform guarantee):**
the final-payload proof is PASS across all ten mask profiles and all 80 isolated
processes, with exact scalar parity and 0 B/frame. Dense 100k rows measured 60.208 µs
for the portable-vector body at a 2.803× forced-scalar/vector ratio. The independent
BenchmarkDotNet lane measured the generated frame pump at 235.03 µs (100k dense) and
180.70 µs (100k sparse-25%). See the
generated-system SIMD proof
and the independent BDN oracle.
No IL2CPP or Burst SIMD-lane claim is made; the on-device sample measurements are in [Platforms](#platforms).

### Per-table chunk kernels

`ForEachChunk<TKernel>` is the shipped chunk-consumer surface and is **per table**, not
per query — it visits live chunks with a constrained, non-boxing call. A per-query chunk
consumer would need selection vectors to honor a predicate; those do not exist, so the
surface is not offered rather than silently ignoring filters.

### Compiled-query vector lane

Separate from and narrower than the [frame-system lane](#frame-system-simd-lane): an exact scalar `COUNT(*)` over one direct
non-null `Float32` range predicate (`>`, `>=`, `<`, `<=`, including the normalized
reversed operand form) may compare fully enabled bitmap words with `Vector<float>`.
Mixed words, the final tail, unsupported widths, and unavailable hardware run the scalar
predicate. Other filtered or projected queries remain scalar. This does not relax the
frame-system lane's one-source/no-filter rule and does not create a general vectorized
query surface.

---

## Storage semantics you must know

### Frame lifecycle

One `context.Frame.Pump(deltaTimeSeconds)` executes `FrameStart`, zero or more capped
`FixedUpdate` ticks, `Update`, `LateUpdate`, `FrameEnd`. Structural playback and event
lifecycle changes occur **only** at scheduler boundaries.

If a system throws, the exception propagates and already-applied writes are **not**
rolled back — there is no transaction. The scheduler discards structural commands that
never reached a boundary and clears `lifetime: frame` events before releasing the failed
frame. Already-appended `next_frame` rows stay part of the executed prefix and become
readable at the next `FrameStart`.

### Event tables and double buffering

`next_frame` is the double-buffered lifetime: appends go to the back buffer while
readers see the front buffer, and the buffers swap at `FrameStart`. So a row appended
during frame *N* becomes readable during frame *N+1*, and disappears at the following
swap.

`frame` is single-buffered: rows are readable in the current frame and cleared at
`FrameEnd`.

Context-attached streams reject direct `SwapBuffers`/`Clear` calls — the scheduler is
the sole boundary owner. Standalone streams may drive them manually.

### Generation checks

`EntityHandle` is `{ int Id; uint Generation }`. Id `0` is never issued, so `default` is
the invalid handle. A negative id marks a **provisional** handle returned by a command
buffer, legal only inside its originating playback window.

The generation check is always on, release builds included:

- handle-based reads (`IsAlive`, `TryGetLocation`, generated `TryGetRow`/`TryGetRowMut`)
  return **false** for a stale handle — they do not throw and never alias a reused id;
- `Destroy` with a stale handle returns **false** and is idempotent;
- `SetEnabled` with a stale or unattached handle **throws**;
- `CreateFor` with a stale handle throws and names the current generation.

### Entity domains

An `entity domain` gives its member tables one id allocator and one generation
authority, so id-aligned rows across tables address the same logical entity. A table not
listed in any declared domain gets an implicit single-table domain, where set-level
`Destroy` also recycles the identity.

Domain destroy preflights every member before changing any table and removes the entity
from all of them; it fails if a member has an open iteration. Id space is paged (4096
ids per page, grown on demand), so there is no fixed id ceiling to design around.

Domains are single-writer: construct, mutate, schedule, and dispose on the owning frame
thread.

### Capacity is a soft estimate

`capacity:` is a **reservation and a planning estimate, not a cap.** Growth past it is
legal. The optimizer records it as `DeclaredCapacityEstimate` with rows = capacity,
lower bound ≈ 0, upper bound = 2 × capacity, confidence 0.5 — honest-wide because the
live row count varies per frame.

`max_capacity:` is the separate **hard** cap. Only then does the optimizer publish a
true upper bound, and a create past it throws
*"Ephemeral table '…' reached its hard row cap of N"* rather than growing.

A `singleton table` cannot declare capacity at all (`UMEP006`).

### Persistence exclusion

Ephemeral tables never persist, never migrate, and carry no `type_id` — code generation
assigns their runtime identities. `persistence:` and `type_id:` are rejected outright
(`UMEP003` / `UMEP004`). There is no snapshot, journal, or restore path for ephemeral
data: it exists for the process session only.

---

## Interop with persistent tables

### Mixed joins

A compiled query may read current-frame ephemeral state and join it to a persistent
table, in both orientations.

When the **ephemeral** side is the lookup target, a raw-id slot probe resolves it.
When the **persistent** side is the lookup target, it keeps its normal access contract
on the ordinary allocating surface:

- a primary-key join emits `TryFindByIdRef`;
- a declared non-unique lookup emits `SecondaryIndexLookup`, including duplicate fan-out
  and SQL null-equality semantics;
- a declared `sorted_set` emits `SortedSetRange` with the ephemeral row supplying the
  dynamic bound;
- a declared `grouped_sorted` index consumes the ephemeral equality key plus range
  bound; for an at-most-one ephemeral probe its ordering drives bounded Top-K directly;
- none of these builds a query-local hash table or falls back to a nested loop.

Index synchronization stays entirely with the persistent table. On a clean index the
synchronized persistent index is used; if the persistent transaction is dirty, generated
access reads transaction-visible primary state so an uncommitted insert, delete, or key
move is reflected immediately. After commit the synchronized index produces the same
membership and order; rollback restores the previous committed result. Mutating the
ephemeral probe key or range bound redirects the next query immediately, with no change
tracker. Ephemeral storage acquires no index, transaction, or synchronization machinery
from this interaction.

`NoAlloc` and `ForEach` variants additionally require a static zero-heap proof.
Primary-key probes satisfy it directly; a secondary index does not, because
`EnsureSynchronized` may grow index-owned storage — those variants fail closed for the
index candidate and stream transaction-visible primary storage instead. For
grouped-sorted Top-K, constrained variants use a compiler-owned bounded Top-N buffer
(maximum 512); non-positive limits are empty and an oversized constrained runtime limit
fails against that bound.

See Ecosystem Interop.
The mixed-interop proof inventory
is currently marked *final refresh pending* — it is a correctness and plan-ownership
inventory, not a latency benchmark, and its recorded counts predate the current
generated payload.

### Dangling keys under id reuse

An ephemeral table may declare `@relation` to a *persistent* table, but nothing may
declare a relation whose target is ephemeral (`UMEP009`) — so a join that looks up an
ephemeral row does so on a plain int key. That has a documented consequence you must
design around:

> **A compiled join on a raw id is generation-agnostic. After an id is destroyed and
> recycled, the join resolves the *current* holder of that id, not the original entity.**

This is deliberate — the probe is a single sparse-map read and carries no generation. If
you need alias-safe references, hold an `EntityHandle`: handle-based reads perform the
generation check and return false for a stale entity. Compiled foreign-key joins accept
hit-on-current-holder semantics by design.

---

## Platforms

The runtime assembly targets `net8.0` and `netstandard2.1`. Generated ephemeral packs compile for
both: every row reference (`RowRef`, `RowMutRef`, the compiler-owned query row refs) is emitted
twice under `#if NET7_0_OR_GREATER` — C# 11 `ref` fields on CoreCLR, and a portable branch that
keeps the chunk's column array plus the dense row offset on runtimes without
`RuntimeFeature.ByRefFields` (Unity Mono, IL2CPP). The portable branch costs one array
indirection and a bounds check per field access on handle-based reads only; chunk kernels,
compiled scans and the SIMD lanes never go through row references. A domain project that ships
to Unity therefore targets `net8.0;netstandard2.1` and Unity consumes the netstandard2.1 build;
`UniMemory.Ephemeral.NetStandardGate` compiles the reference pack for netstandard2.1 in every
solution build so the portable branch cannot regress silently. On IL2CPP `Vector.IsHardwareAccelerated`
is false, so both vector lanes execute their scalar oracle by contract.

Generated query metadata is reflection-free data (`GeneratedQueryMethodAbi` carries the declaring
type, name, return type and parameter contracts; nothing is resolved at initialization), and frame
diagnostics convert clock ticks without `TimeSpan.FromSeconds`, which rounds to milliseconds on
Unity's Mono corlib. Both were found by running the Arena sample on device.

**Measured hosts (2026-09-03, Unity 6000.7.0a2, Arena sample, 100 k units, one fixed tick per frame, M4 Max):**

| host | frame p50 | frame p99 | allocations | notes |
|---|---:|---:|---|---|
| .NET 8 (headless runner) | 497 µs | 683 µs | 0 B in systems | reference |
| Unity IL2CPP, release player | 485 µs | 701 µs | 0 B/frame | .NET 8 parity; C++-compiled generated kernels |
| Unity Mono player | 2 061 µs | 2 275 µs | 0 B/frame | ~4× slower, mostly in the hand-written collision pass |
| Unity Mono + Burst kernel for `IntegrateBodies` | 1 856 µs | 2 085 µs | 0 B/frame | Burst substitute 3.7× faster than the JIT kernel, bit-identical digest |
| Unity IL2CPP + Burst job graphs (IntegrateBodies, PresentationSync) | 429–436 µs | 499–545 µs | 0 B/frame | one combined completion per system over pin-stable chunk memory; the two streaming kernels 1.7× / 2.4× |
| Unity IL2CPP, 1 M units, generated kernels | 2 088 µs | 2 415 µs | 0 B/frame | streaming systems are 68 % of the frame |
| Unity IL2CPP, 1 M units + Burst job graphs | 1 003 µs | 1 165 µs | 0 B/frame | kernels 3.8× / 5.1×, bandwidth-bound (~200 GB/s) |
| Unity IL2CPP, recording lease + playback window (generated kernels) | 394 µs | 440 µs | 0 B/frame | Fire 37 → 12 µs, boundary ≈60 → ≈20 µs |
| Unity IL2CPP + Burst job graphs + Burst collision over `AcquireEntityLookup` | 171 µs | 205 µs | 0 B/frame | collision 244 → 43 µs; below the Entities port of the same simulation (190 µs) |
| Unity IL2CPP, 1 M units, job graphs + Burst collision | 453 µs | 512 µs | 0 B/frame | Entities port: 491–513 µs |

The CoreCLR *player* backend that 6000.7.0a2 lists is not installed with that alpha and could not be
measured. These are sample measurements on one machine, not a contractual performance claim; the
recorded SIMD proofs remain CoreCLR-only.

## Driving frames

Pure .NET hosts drive the context-owned scheduler directly:

```csharp
context.Frame.Pump(deltaTimeSeconds);
```

Unity hosts install the package adapter once per player session:

```csharp
await context.InitializeAsync(); // generated registration completes and seals the schedule
ConjureDBPlayerLoop.Install(context);

// Session teardown:
ConjureDBPlayerLoop.Uninstall(context.Frame);
context.Dispose();
```

Installation consumes the already sealed schedule; it never seals registration itself.
Installing an uninitialized context or an unsealed standalone scheduler fails without
changing the PlayerLoop or closing registration. Installation also acquires a
scheduler-owned host lease: disposing the context while installed fails before teardown,
so the owner can uninstall and retry without leaving stale callbacks.

Unity remains the fixed-step accumulator. Each Unity `FixedUpdate` callback forwards
exactly one ConjureDB fixed tick; the adapter never runs a second accumulator. The
active Unity fixed step is supplied at `FrameStart`, including frames with zero fixed
callbacks, and `FrameContext.InterpolationAlpha` is resampled after the fixed passes
immediately before `Update`.

---

## Declarative systems

A `system` body is a driver source followed by ordered clauses. Clause order is execution
order for every driver row, so the statement reads like the imperative loop it replaces:

```unimem
system Collision(phase: fixed_update, before: [IntegrateBodies, IntegrateProjectiles]) {
    from Projectile p
    | join Body b on handle (p.TargetId, p.TargetGeneration)
    | match {
        miss b => set ArenaCounter.ProjectilesLostTarget += 1  destroy p
        (b.X - p.X) * (b.X - p.X) + (b.Y - p.Y) * (b.Y - p.Y) <= ArenaSetting.HitRadiusSquared =>
            emit HitEvent { ProjectileId: p.Id, TargetId: p.TargetId, TargetGeneration: p.TargetGeneration, Damage: p.Damage }
            destroy p
        p.TtlTicks <= 0 => set ArenaCounter.ProjectilesExpired += 1  destroy p
      }
}

system ApplyHits(phase: frame_start) {
    from HitEvent h
    | join Unit u on handle (h.TargetId, h.TargetGeneration)
    | filter u.Health > 0
    | set u.Health -= h.Damage, ArenaCounter.Hits += 1
    | join Body b (u.Id == b.Id)
    | match { u.Health <= 0 => emit DeadSlot { Slot: b.ViewSlot }  destroy entity u }
}
```

- **Driver**: `update`/`from` a plain ephemeral table (chunked rows, enabled mask honoured),
  `from` an event table (the frame's readable buffer, append-only), or `update` a singleton
  (one row). Persistent tables are refused.
- **Joins**: `join T alias (x.Id == alias.Id)` is the same-domain id join; `join T alias on
  handle (id, generation)` is a generational probe of any plain ephemeral table, so a
  recycled id never resolves. A miss skips the row unless a later `match` has a `miss alias`
  arm — then the join publishes a hit flag instead.
- **`filter`** skips the row; **`set`** is a simultaneous block (all right-hand sides, then
  all stores) whose targets may be the driver, a joined alias, or a singleton; **`match`**
  runs exactly one arm — the first `miss alias =>` or `guard =>` that holds — and its
  effects: `set`, `emit Event { … }` (every column once), `destroy alias`, `destroy entity
  alias`. Destroys are deferred commands that play back at the phase boundary, exactly like
  `Commands.Destroy` from a hand-written system.
- **Scope**: singleton tables are visible by their table name in every system; a written
  singleton is `ref`-leased, a read-only one copied. `@dt` and `@fixedDt` are the frame
  parameters; `(float)@fixedDt` narrows.
- **Manifest**: derived exactly — column modes (physical groups, whole-row singleton and
  event leases), row-domain reads for iterated and probed tables, row-domain writes for
  emitted event tables, structural access for destroyed tables — and published on the
  generated `IFrameSystem`, so a host kernel can substitute it with the identical manifest.

The Arena sample declares its collision, hit application, and clock this way and reproduces
the previous hand-written systems bit for bit (same presentation digest and counters at
100 k units, and at the denser 2 k / 512-shot and 300 / 2 048-shot configurations).
Whatever needs branching the grammar does not express — random shooters, engine calls —
stays a hand-written system, ordered against the generated ones as shown below.

## Hand-written systems and exact access

Use `IFrameSystem` for branching, engine interop, or other imperative gameplay. The
manifest is immutable and uses generated table/column identities:

```csharp
sealed class DamageSystem : IFrameSystem
{
    private static readonly SystemAccessManifest Manifest = new(
        columns:
        [
            SystemColumnAccess.Write(
                DamageEventsSet.FrameTableId,
                (int)DamageEventColumn.Amount),
        ]);

    public SystemAccessManifest Access => Manifest;

    public void Run(in FrameContext frame)
    {
        // Access generated table APIs here.
    }
}

context.Frame.Register(
    FramePhase.Update,
    new FrameSystemName("Gameplay.Damage"),
    new DamageSystem());
```

Two unordered systems with overlapping access — write/write, write/read, or structural
against any table access — fail when the schedule is sealed; registration order inside a
phase is **not** an ordering edge. Use the `FrameSystemId` returned by `Register` with
`OrderBefore`/`OrderAfter` to add an explicit edge. Ids are owned by their scheduler and
cannot be forged or reused with another scheduler. A `FrameSystemName` must be a valid
C# identifier (no dots or spaces).

### Ordering hand-written systems against generated ones

`OnAfterBuild` runs before the schema-declared systems register, so their ids are not
available there. Override `OnFrameRuntimeRegistered` — called after generated
registration and before the schedule is sealed — and resolve them by name:

```csharp
protected override void OnFrameRuntimeRegistered()
{
    base.OnFrameRuntimeRegistered();
    if (!Frame.TryGetSystemId(new FrameSystemName("IntegrateBodies"), out var integrate))
        throw new InvalidOperationException("IntegrateBodies is not registered.");
    Frame.OrderBefore(_collision, integrate);   // collision reads what the kernel writes
}
```

### Row leases: one authorization per invocation

`TryGetRow`, `TryGetRowById`, `TryGetRowMut`, `GetChunk` and `Append` are exact: every
call is authorized against the executing system's manifest. That is the right default
for occasional access and the wrong shape for a loop that probes thousands of handles
per tick — a collision or targeting pass spent about 80 ns per projectile on
authorization alone before the leases existed, 17× the storage cost of the probe itself.

Acquire a lease once from the executing `FrameContext`; probes through it use the
unchecked storage ABI (the generation check stays on):

```csharp
public void Run(in FrameContext context)
{
    var bodies = _context.Bodies.AcquireRowRead(in context);      // RowReadLease
    var units = _context.Units.AcquireRowWrite(in context);       // RowWriteLease
    var hits = _context.HitEvents.AcquireWriter(in context);      // WriterLease (events)

    foreach (ref readonly var hit in _context.HitEvents.GetChunk(0))
    {
        if (!bodies.TryGetRow(new EntityHandle(hit.TargetId, hit.TargetGeneration), out var body))
            continue;                                              // stale target: skipped, not aliased
        if (units.TryGetRowMut(target, out var unit))
            unit.Health -= hit.Damage;
    }
}
```

Leases are stack-only tokens bound to the invocation that acquired them, exactly like
the compiler-owned chunk access tokens; acquiring one outside an executing system, or
with a foreign context, fails closed. The manifest still has to declare the row domain
and every non-key column of the table for the requested mode.

### Recording leases and the lookup view

Structural commands have the same per-call cost structure row probes had before row leases: a
frame-thread check, a lifecycle check, a coordinator sequence and a manifest lookup on every
`Commands.Create` / `Destroy`. `Commands.AcquireRecorder(in context)` authorizes once per system
invocation and returns a `RecordingLease` whose `Create`, `CreateFor`, `Destroy`, `CreateRange` and
`DestroyRange` record straight into the buffer. Ordering is unchanged: every record still takes
the next coordinator-wide sequence, and a range reserves one contiguous block so it orders as a
unit against what other systems record afterwards. Acquisition without structural access to the
table fails exactly like a per-record call would.

```csharp
public void Run(in FrameContext context)
{
    var bodies = _context.Bodies.AcquireRowRead(in context);          // row probes, authorized once
    var projectiles = _context.Projectiles.Commands.AcquireRecorder(in context); // creates, authorized once
    for (var shot = 0; shot < shots; shot++)
        projectiles.Create(new Projectile { /* … */ });
}
```

Boundary playback applies the recorded window with one structural guard per table and replays
runs of creates as a single bulk append; the resulting ids, generations and dense layout are
identical to record-by-record playback.

`AcquireEntityLookup(in context)` (row-domain read) hands a host kernel the table's own id→row
lookup: pin-stable pages of `(generation << 32) | denseSlot` entries and the chunk geometry.
`EphemeralEntityLookup.TryResolve` is the reference resolution; a Burst job inlines the same
lines over the page pointers and reads the resolved row through the column chunk pointers, so a
probe pass over thousands of handles can run on worker threads while the frame thread only drains
the outcomes into the event writer and the recording lease, in the serial order.

### Allocation accounting

`LastFrameReport.AllocatedBytes` is the managed allocation of the whole frame on the
owner thread, and `FrameSystemTiming.AllocatedBytes` attributes it per system; the
difference is scheduler-owned boundary work (command playback, event lifecycle, outbox
drain). A steady-state frame loop reports zero; a non-zero value names the offender
without a profiler.

Generated scoped chunk accessors validate the executing `FrameContext` token and the
exact columns they expose. Direct structural mutation is rejected during a system;
record structural work through the generated table's command buffer:

```csharp
var entity = context.Positions.Commands.Create(in position);
context.Velocities.Commands.CreateFor(entity, in velocity);
```

The returned negative handle is provisional. It may be referenced by later records in
the same playback window. At the next boundary the scheduler merges every table's
records in global sequence order and resolves the handle to a real domain identity.
`TryResolveProvisional` reads the most recent playback window that consumed records in
any attached table: a window in which nothing was recorded (the post-`FrameEnd` /
pre-`FrameStart` pair is the common case) keeps the previous window readable, so a
spawn recorded at `FrameEnd` resolves from the first `FrameStart` system of the next
frame. Stale handles from older windows still fail the window-stamp check.

---

### Host-accelerated kernels (Unity Jobs / Burst)

A schema-declared `system` is a contract — phase, name, exact access manifest, and the generated
scalar implementation that serves as its oracle. The implementation is replaceable before the
schedule seals: `FrameScheduler.SubstituteImplementation(id, implementation)` keeps the system's
id, name, phase and ordering edges and requires the substitute to declare exactly the registered
manifest (`FrameScheduleError.ImplementationAccessMismatch` otherwise). The host takes part in
registration through `DbContextBuilder<TContext>.ConfigureFrameRuntime`, which runs after the
generated and application registrations and before sealing; the domain assembly never references
the host.

```csharp
var context = DbContextBuilder<ArenaDbContext>.Create()
    .WithNoPersistence()
    .ConfigureFrameRuntime(ctx =>
    {
        ctx.Frame.TryGetSystemId(new FrameSystemName("IntegrateBodies"), out var integrateBodies);
        ctx.Frame.SubstituteImplementation(integrateBodies, new BurstIntegrateBodiesSystem(ctx));
    })
    .Build();
```

The substitute declares the manifest by hand from the generated set's public column enum and
table id, and runs a Burst job directly over the set's chunk memory:

```csharp
public sealed unsafe class BurstIntegrateBodiesSystem : IFrameSystem
{
    public SystemAccessManifest Access { get; } = new(
        columns: new[]
        {
            SystemColumnAccess.ReadWrite(BodiesSet.FrameTableId, (int)BodiesSet.Column.X),
            SystemColumnAccess.ReadWrite(BodiesSet.FrameTableId, (int)BodiesSet.Column.Y),
            SystemColumnAccess.Read(BodiesSet.FrameTableId, (int)BodiesSet.Column.Vx),
            SystemColumnAccess.Read(BodiesSet.FrameTableId, (int)BodiesSet.Column.Vy),
        },
        rowDomains: new[] { SystemRowDomainAccess.Read(BodiesSet.FrameTableId) });

    public void Run(in FrameContext context)
    {
        for (var chunk = 0; chunk < _context.Bodies.ChunkCount; chunk++)
        {
            var pos = _context.Bodies.GetPosChunkMut(in context, chunk);   // frame-scoped, manifest-checked
            var vel = _context.Bodies.GetVelChunk(in context, chunk);
            var enabled = _context.Bodies.GetEnabledMask(chunk);
            fixed (BodiesSet.BodyPosColumns* p = pos)
            fixed (BodiesSet.BodyVelColumns* v = vel)
            fixed (ulong* e = enabled)
            {
                new IntegrateJob { Positions = p, Velocities = v, Enabled = e, DeltaTime = context.DeltaTimeSeconds }
                    .ScheduleParallel(pos.Length, 1024, default)
                    .Complete();                                            // inside the pin, inside Run
            }
        }
    }
}
```

Rules that keep this inside the frame contract:

- **No copies.** The job reads and writes the set's column arrays in place; the enabled mask is
  the storage's own bitmap.
- **Chunk memory is pin-stable.** Every chunk array with an unmanaged element type keeps one
  address for the table's lifetime (pinned object heap on .NET 5+, pinned handles owned by the
  table elsewhere), so `EphemeralChunkMemory.PointerOf(span)` yields a pointer a job can use
  without a `fixed` scope. A system may therefore schedule one job per chunk over all chunks
  and complete the combined handle once. The pointers are valid within the frame-system
  invocation that acquired the spans (structural playback at the next boundary may retire or
  reuse chunks), and every job using them must complete before `Run` returns, so the
  single-writer contract is untouched. Job graphs spanning *systems* are still not offered.
- **Same math, same results.** `FloatMode.Strict` and the generated system's double-precision
  update make the Burst kernel bit-identical to the scalar oracle; the sample verifies this by
  comparing presentation digests between `-arenaKernels managed` and `-arenaKernels burst`.
- **Exact manifest.** The substitute's manifest is not a superset: `GetEnabledMask` and
  `ChunkCount` are system-scoped reads authorized by the row-domain entry; the column entries
  authorize the frame-scoped chunk accessors.

## Events, singletons, and command routes

Appending to an event table is immediate but access-checked inside systems. Singleton
`Value` and `Ref` access is checked against the active system manifest; outside frame
execution, initialization and tooling code may use the same generated APIs on the owning
frame thread.

A command may route one typed event payload into an ephemeral event table:

```prql
module Combat {
    command ApplyDamage(sourceId: int, targetId: int, amount: int)
    kind local
    {
        // Persistent transactional statements and validation appear above.
        event DamageApplied into DamageEvent {
            SourceId: sourceId,
            TargetId: targetId,
            Amount: amount
        }
    }
}
```

Every payload member binds to an exact target column. The transaction publishes the
command event **only after commit**; rollback publishes nothing. A scheduler boundary
drains the committed outbox on the frame thread, so the transaction never mutates
ephemeral storage directly. An event statement without `into <EventTable>` remains an
ordinary command event with no frame-table route. Routing into a non-event table is
`UMEP015`.

---

## Presentation and tooling

`PresentationBinding<TPresentation>` maps a generation-safe entity handle to an engine
object or pooled presentation slot. It removes the exact binding when its domain
destroys that entity, so a stale handle can never remove a later generation's
presentation.

Generated ephemeral sets expose a reflection-free `VisitEntities` visitor with the
current handle, enabled state, and typed row. The scheduler exposes the sealed schedule
and exact manifests through `GetExplainSnapshot()` and reuses `LastFrameReport` for
per-system timing without allocating each frame. `LastFrameReport` always describes the
most recently *completed* (or failed) frame: the in-flight frame is recorded into a private
buffer and published when it ends, so a `MonoBehaviour` callback or presentation code that
reads it mid-frame sees one whole frame, never a half-reset buffer. The Unity adapter
publishes frame and per-system profiler markers.

---

## Concurrency and ownership

- Construct, mutate, schedule, and dispose the context on its owning frame thread.
- Collect `GetMemoryReport()` / `GetHealthReport()` on that same thread when frame-local
  state exists; publish an immutable snapshot for background monitoring.
- Record structural changes through `Commands` while a system is executing.
- Use provisional handles only inside their originating recording window, then resolve
  them immediately after that boundary.
- Treat generated `.g.cs` files as compiler output: change the schema and regenerate.
- Do not add reactive/DbSet subscriptions, IVM/MV/Z-set/delta bridges, maintenance hooks,
  or reactive profiles over ephemeral tables. Persistent tables own that entire
  subsystem, and the boundary is permanent ([Refused by design](#refused-by-design--permanent)).

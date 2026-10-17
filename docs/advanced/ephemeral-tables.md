# Ephemeral Tables and Frame Systems

:::info Platform status
Ephemeral tables run on **.NET 8** hosts and in **Unity on Mono and IL2CPP** (netstandard2.1
domain assembly, verified on Unity 6000.7.0a2 with the Arena sample: the IL2CPP player runs the
100 k-unit frame at .NET 8 speed, 0 B/frame). Unity's CoreCLR player backend is not shipped in
that alpha and is unmeasured. Every persistent-table feature on this site is unaffected.
:::

Persistent tables are the right home for the state a game keeps: inventory, progression,
config, everything that survives a session and wants indexes, transactions and reactive
views. Frame state is different. Ten thousand positions that change every tick, projectiles
that live for ninety ticks, hit events that matter for exactly one frame — nobody wants a
transaction log for that, and nobody wants to write it as a `List<GameObject>` either. This
is the workload people reach for an ECS for.

ConjureDB gives that state its own storage kind, in the same schema file, with the same
compiled queries — and one thing no ECS has: a cost-based planner that joins live frame state
to your persistent tables and their indexes.

Ephemeral tables use generated chunked storage and a `DbContext`-owned `FrameScheduler`.
They are frame-local storage with a compiled access path — not a second incremental data
platform. Persistent tables own transactions, persistence, persistent index maintenance and
retained change history. Ephemeral tables may own synchronous lookup/bucketed indexes for
frame-system access paths. Reactive Query, materialized views and IVM remain one shared
subsystem: frame workloads may use it, but ephemeral storage does not grow a second
incremental engine of its own. Ephemeral *sources* are still refused by the maintenance
guards until their change-publication and lifetime contracts are supported.

This page answers one question: **what is supported, what is refused, and what simply does
not exist yet.** Every refusal below is a typed diagnostic you will actually see, quoted by
its code.

**See also:** [Schema Language](/docs/schema/schema-language) · [Compiled Queries](/docs/query-language/compiled-queries) · [Arena example](/docs/examples/arena-ecs) · [Reactive Queries](/docs/advanced/reactive-queries)

---

## Capability matrix

### Supported today

| Capability | Landed in | Notes |
|---|---|---|
| Typed schema kinds: `ephemeral table`, `event table`, `singleton table` | P0 | Chunked struct-of-arrays storage, no reflection |
| `entity domain` — one id/generation authority shared by member tables | P0 | Tables outside a declared domain get an implicit single-table domain |
| Generational `EntityHandle` with always-on staleness checks | P0 | Release builds included |
| Enabled masks (`SetEnabled`) as visibility without moving rows | P0 | Iteration visibility changes at deterministic boundaries |
| Imperative API: `Create`, `CreateFor`, `Destroy`, `IsAlive`, `VisitEntities` | P0 | Reflection-free generated accessors |
| Compiled chunk scan with `filter` and `select` | P1 | Column pruning drives the touched group set |
| Compiled direct lookup when the query constrains the ephemeral row id | P1 | Planner selects `EphemeralDirectLookup` instead of scanning |
| Generation-safe compiled handle lookup | 2026-09 | `entity_handle(alias)` retains domain/type evidence and full Id/Generation; raw-id joins unchanged |
| Scalar aggregates — `count(*)`, including filtered and by-id forms | P1 | Cardinality-only counts avoid materializing rows |
| `sort … | take k` bounded Top-N over an ephemeral source | P1 | |
| Compiled reads over `event table` rows | P1 | Reads the readable buffer; see [Event tables and double buffering](#event-tables-and-double-buffering) |
| Generated typed spawn/clone recipes for declared domains | 2026-09 | [Recipes](#typed-spawn-and-clone-recipes); captured component values and visibility, explicit capacity, no implicit child cloning |
| Mixed joins between ephemeral and persistent tables, both orientations | P1 | Full detail in [Interop with persistent tables](#interop-with-persistent-tables) |
| Bitmap semi/anti membership across kinds | P1 | Fan-out-once semi, anti complement, rebuilt per call |
| Grouped aggregation (`group … (aggregate { … })`) over ephemeral and event sources | P1 | Ordinary allocating surface; see the note below |
| `distinct` over a projected ephemeral column | P1 | Ordinary allocating surface |
| Set operations (`union`, `intersect`) mixing an ephemeral and a persistent branch | P1 | Ordinary allocating surface |
| Correlated `exists(...)` subquery from an ephemeral driver into a persistent table | P1 | |
| `window by … (rn = row_number)` partitioned by an ephemeral column | P1 | Ordinary allocating surface |
| `NoAlloc` / `ForEach` query variants over ephemeral storage | P1 | Subject to the usual static zero-heap proof |
| Per-table `ForEachChunk<TKernel>` chunk consumer | P1 | Constrained call, no boxing — see [Per-table chunk kernels](#per-table-chunk-kernels) |
| `system` declaration, `FrameScheduler`, typed access manifests | P2 | |
| Command buffers with provisional handles resolved at boundaries | P2 | |
| Post-commit `command … event … into <EventTable>` routes | P2 | Publishes only after commit |
| `PresentationBinding`, explain snapshots, per-system timings, Unity hosting | P2 | |
| Frame-scoped row leases (`AcquireRowRead` / `AcquireRowWrite`) for hand-written systems | 2026-09 | One authorization per system invocation; see [Hand-written systems and exact access](#hand-written-systems-and-exact-access) |
| `OnFrameRuntimeRegistered` ordering hook against generated systems | 2026-09 | See [Ordering hand-written systems against generated ones](#ordering-hand-written-systems-against-generated-ones) |
| Per-system and per-frame managed-allocation accounting in `LastFrameReport` | 2026-09 | `FrameSystemTiming.AllocatedBytes`, `LastFrameReport.AllocatedBytes` |
| netstandard2.1 row references (Unity Mono / IL2CPP / CoreCLR) | 2026-09 | Generated `RowRef` / `RowMutRef` / query row refs carry a ref-field branch and a portable column-array + offset branch under `#if NET7_0_OR_GREATER`; see [Platforms](#platforms) |
| Host-substituted system implementations (`FrameScheduler.SubstituteImplementation`, `DbContextBuilder.ConfigureFrameRuntime`) | 2026-09 | Identical access manifest required; see [Host-accelerated kernels](#host-accelerated-kernels-unity-jobs--burst) |
| Frame-scoped recording leases (`Commands.AcquireRecorder` / `AcquireEntityRecorder`, `CreateRange` / `DestroyRange`) | 2026-09 | Table or whole-domain structural authorization once per system invocation; see [Recording leases and the lookup view](#recording-leases-and-the-lookup-view) |
| Pin-stable chunk memory and `AcquireEntityLookup` for host kernels | 2026-09 | `EphemeralChunkMemory.PointerOf`, `EphemeralEntityLookup.TryResolve`; see [Host-accelerated kernels](#host-accelerated-kernels-unity-jobs--burst) |
| Portable-vector (SIMD) frame-system kernels | post-P2 | Deliberately narrow — see [Frame-system SIMD lane](#frame-system-simd-lane) |
| Portable-vector `COUNT(*)` over one `Float32` range predicate | post-P2 | Narrower still — see [Compiled-query vector lane](#compiled-query-vector-lane) |
| `@index(kind: lookup)` / `@index(kind: bucketed)` on an ephemeral table column, maintained synchronously, and the access path it serves: `join … on index` in a system, and an equality on the indexed column in a **compiled query** | Declarative Systems Phase B | One declared index serves both consumers: a `query` whose filter is an equality on the indexed column is served by that index's bucket group instead of a chunk walk. See [Secondary indexes](#secondary-indexes) |
| Persistent index sources in a system: full-key lookup, scalar sorted range, bounded grouped Top-K and proven partial indexes | 2026-09 extension | Read-only committed NoSync access, explicit range preparation and host quiescence. See [Persistent index sources in a system](#persistent-index-sources-in-a-system) |
| Tag tables — an `@id`-only ephemeral table as a component label | Declarative Systems Phase B | No payload column group at all; the `insert` payload block is optional for one. See [Tag tables](#tag-tables) |
| `@parent(depth: Col[, max_depth: N])` hierarchies with an engine-maintained depth, acyclicity checked at the write, and the `sort` ordered driver over the depth's `bucketed` index | Declarative Systems Phase B | The depth is engine state: a `set` of it and an `insert` payload naming it are both `SCH2171`. See [Hierarchies and the ordered driver](#hierarchies-and-the-ordered-driver) |
| `join T a on index (a.Key in (e1, …, ek))` — the multi-key form as **one** access path, and the quantized-cell broadphase it exists for | Declarative Systems Phase B | 1..16 keys, probed in listed order, equal keys probed once. A 3×3 neighbourhood is one clause, not nine. See [Secondary indexes](#secondary-indexes) |
| `ids: dense` table modifier — `slot = id - 1`, no paged id map | Declarative Systems Phase B | Every path that could break the arithmetic is refused (`SCH2172`). See [`ids: dense`](#ids-dense) |
| `upsert T for e` on an entity that already owns a `T` row — attach-or-overwrite | Declarative Systems Phase B | An upsert: last-wins in recording order, identity preserved. The direct `EphemeralSet<T>.CreateFor` still throws. See [Frame lifecycle](#frame-lifecycle) |
| Inter-system dependency-driven admission (`FrameSchedulerOptions.InterSystemConcurrencyPolicy`) | 2026-09 | Concurrent invocations are admitted only where the sealed order permits overlap and the host explicitly selects `Auto` or `Bounded(n)`. The default is `Off`: it uses ordinary per-system dispatch while retaining each system's intra-system parallel row work. A totally ordered phase, an attached observer, and `FrameParallelExecutionPolicy.ForceSequential` also take that ordinary path. See Frame execution contract |
| Fused frame-system packs (`ConjureDBFrameSystemFusion`) | 2026-09 | A pack opts in through the MSBuild property, keeping the emitted registration reproducible. Admitted independent systems share a union-range invocation; an admitted ordered chain uses a `StagedOrdered` driver with the exact member-union capture manifest and per-member scheduling identity. Ordering is never bypassed to force a union. Fusion is an execution choice, not a promise of a speedup; the strict-chain fixture currently favors ordinary execution |
| Staged invocation contract (`FrameStagedRangePlan`, `SubmitStaged` / `ExecuteStaged`) | 2026-09 | The runtime seam plus an emitted staged driver are proven end to end (`ConjureDB.Tests/Core/Frame/GeneratedStagedFusionEndToEndTests.cs`); adoption by a shipped pack is gated on the same seal refusal named above |
| Generated native (Burst) row bodies (`ConjureDBFrameNativeRowBody`) | 2026-09 | `FrameNativeRowBody<TInputs>` plus `FrameWorkerPool.TryBindNativeRowBody` hand one granted range to a native body; ranges, failure reporting and state digests match the managed body, and a pack that does not bind keeps the managed body |
| External (host-owned) row storage (`ConjureDBFrameExternalStorage`) | 2026-09 | `EphemeralExternalStorageContract`, `ExternalRowGeometry` and `ExternalColumnChunkDirectory<T>` bind declared columns of a contiguous host buffer without copying; identity-addressed reads, indexed tables and row creation stay refused, and a pack with the fact off is emitted unchanged. Binding **live** Entities archetype chunks is not exercised |
| Presentation publish pipeline (`UnityFramePublishPipeline`) | 2026-09 | Declared per-table publishers (`IUnityFrameRowPublisher<TValue>` over a pin-stable `UnityRowBuffer<TValue>`) run inside the existing PlayerLoop node after the scheduler phase, fail closed on capacity, and report allocations. This publishes presentation data; it is **not** change detection |
| Unity Frame Inspector (`ConjureDBFrameInspectorWindow`) | 2026-09 | **Window → ConjureDB → Frame Inspector**: host status, the sealed schedule with per-system timings and allocations, the fusion plan, the publish report and both table registries, from `Integrations/Unity/ConjureDB.Unity/Editor/ConjureDBFrameInspectorWindow.cs` |

**A spelling note.** The system DSL's verbs ARE the mutation API's, as of Phase C W0:
`insert T { … }`, `upsert T for e { … }`, `delete a` / `delete entity a`, `event E { … }`,
the row-local `var name = expr`, and the counted driver `from generate(n) i`. The spellings
they replaced — `create`, `create … for`, `destroy`, `emit`, `let`, `range`, and the
ephemeral `@index` option `keys: <count>` (now `buckets:`) — are **rejected** with `SCH2173`
naming the replacement: there are no aliases and no second dialect. Nothing about the
semantics changed, and the parity digests are the proof of that; the audit, with the reason
for each verdict and the decision record for the wave, is the internal frame-execution design notes

### Reactive integration — current implementation limitation

The following are current admission failures, **not permanent product prohibitions**.
Existing reactive/materialized results may be consumed through supported query and
materialized-view paths; this does not imply a separate direct `ReactiveQuery`
frame-source adapter. Feeding ephemeral changes into IVM is the opposite direction:
the source guards below concern that producer direction. Integration must reuse existing
IVM and preserve frame/worker ownership, publication and reset semantics.

| What you tried | Diagnostic you will see | Sanctioned alternative |
|---|---|---|
| `reactive query` reading (or joining) an ephemeral table, directly or transitively | **UMEP013** `EphemeralSourceNotReactive`: ephemeral-source publication into existing IVM is not implemented yet. | Until integration is implemented, run a frame-rate compiled query or explicitly publish a typed persistent summary. This is not the only permitted long-term architecture. |
| `materialized view` whose source lineage reaches an ephemeral table (including through views and fragments) | **UMEP013**, with the offending source path named | Same as above |

### Refused by design

These restrictions are unchanged by the reactive-integration clarification.

| What you tried | Diagnostic you will see | Sanctioned alternative |
|---|---|---|
| A transactional `command` / `mutation` writing an ephemeral table | **UMEP014** `Transactional operation '{0}' cannot write ephemeral table '{1}'` | Write from a frame system, or route one typed payload with `event … into <EventTable>` |
| A mutation method on an ephemeral query host | **UMCG028** *"Mutation method '{0}' cannot be emitted on ephemeral table '{1}'. Frame-local writes are owned by frame systems and command buffers."* | Frame systems and command buffers |
| `singleton table` used as a `FROM` or join source | **BIND_RES_057** *"Singleton table '{0}' cannot be a query source. Read it through its direct accessor (e.g. `context.<Name>.Value`) instead of FROM/join."* | The direct accessor |
| Compiled queries hosted on a singleton table | **UMCG026** *"Singleton tables cannot host compiled queries…"* | Move the query to a plain-ephemeral, event, or persistent `FROM` entity |
| An ephemeral query on the PortableRuntime execution target | **UM6022** `PortableUnsupportedStrategy` | PortableRuntime execution of ephemeral scans is an explicit non-goal; run the generated host path |
| `persistence:` / `type_id:` on an ephemeral table | **UMEP003** / **UMEP004** | Ephemeral data is never persisted or migrated |
| `@relation` whose **target** is an ephemeral kind (from any table), or `@@navigation` on an ephemeral table | **UMEP009** — *"relations INTO ephemeral kinds are forbidden (frame-lifetime rows must not be referenced)"* | Join on the plain int key instead ([Dangling keys under id reuse](#dangling-keys-under-id-reuse)). A relation **from** an ephemeral table **to** a persistent one is allowed |
| Automatic field-change detection: `changed()`, per-chunk change versions, system cursors, dirty enumeration | *no syntax exists* | Run the frame kernel over all rows; or use a persistent table + IVM when sparse incremental work is the real need |
| MVCC, rollback, transactions, retained transactional history over ephemeral data | *no API exists* | Persistent tables |

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
| IL2CPP / Burst *contractual* performance claims | Not made universally. W8 records generated Unity/IL2CPP host measurements and native semantic tests (see [Platforms](#platforms)); these are host- and workload-specific. The portable SIMD proof remains CoreCLR-only; netstandard2.1 compilation is gated (`ConjureDB.Ephemeral.NetStandardGate`) | A shipping target requires that platform lane |
| Networking / rollback | Out of scope for this feature | A title chooses a concrete netcode model |

---

## Schema declarations

```conjure
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
`lifetime`, `ids`, `schema_version`, `type_id`, and `plural`. Anything else is rejected by
name. `lifetime:` accepts exactly `frame` or `next_frame`; `ids:` accepts exactly `dense`.

#### `ids: dense`

`ephemeral table Slot(plural: Slots, capacity: 100000, ids: dense)` declares that this
table's identities are allocated densely from 1 in creation order and are **never
destroyed**. Its id-to-row map is then not a map: the row for id *n* is slot *n − 1*,
bounds-checked against the live row count and read through the same enabled word every
probe reads, and the paged id map is not allocated at all. It is the roster / pool /
fixed-slot shape — rows created once at configuration and addressed by their ordinal
forever.

Because the promise is what makes the arithmetic correct, every path that could break it
is refused (`SCH2172`). This list is the normative statement of the modifier's obligations;
every other mention of them refers back to it.

- the table must own its entity domain — a shared domain allocates ids across its
  members, so their id runs interleave;
- `delete`, `delete entity` and `upsert … for` targeting it are compile errors in a
  frame system, and the runtime `Destroy` / `DestroyEntity` entry points refuse it too,
  from the direct, domain and command-playback paths;
- the modifier applies only to a plain `ephemeral table`: event streams and singletons
  own no per-row identity, and a persistent table owns a host-assigned primary key.

Disable a row instead of destroying it. A table that must delete keeps the general id
map, which is a paged direct array rather than a hash probe and is not slow.

### Typed spawn and clone recipes

Every **declared** entity domain emits a value recipe (`<Domain>EntityRecipe`) and a
context-owned helper (`context.<Domain>Entities`). Recipe properties use the member table's
plural name and `EphemeralSpawnComponent<TRow>`: the default value means absent; constructing
one selects the component, its value and its initial enabled state.

For the demo's `Actors` domain, with valid `unitDefaults` and `bodyDefaults` supplied by the host:

```csharp
context.ActorsEntities.PrepareCapacity(32); // recording capacity per playback window
var recipe = new ActorsEntityRecipe
{
    Units = new EphemeralSpawnComponent<Unit>(unitDefaults),
    Bodies = new EphemeralSpawnComponent<Body>(bodyDefaults, enabled: false)
};
var provisional = context.ActorsEntities.Spawn(in recipe);
context.Frame.Pump(0d); // the existing playback boundary publishes the entity
if (!context.ActorsEntities.TryResolveProvisional(provisional, out var spawned))
    throw new InvalidOperationException("Spawn has not been applied.");
var copy = context.ActorsEntities.Clone(spawned);
```

`Clone(source)` copies every present member component, including its enabled state.
`Clone(source, in selection)` copies only selected members that are present: the recipe values
are **not** defaults for missing source components. Data is captured in the authorized recording
window, so subsequent source edits or destruction do not change the recorded copy. `None`,
provisional and stale sources are rejected before recording anything. Like existing handles,
raw C# `EntityHandle` values remain context/domain-scoped; their bits carry no world identifier.

Self-references are remapped only when the field's **declared entity domain** and the entire
source identity (`Id + Generation`) match. Other generations, other domains with coincident
numeric handles, and other external references remain unchanged. This is a component value
copy, not deep graph cloning: children are not implicitly copied.

Call `PrepareCapacity` outside execution. It prepares command records, payloads and identity
remaps for the declared maximum operations per window, not resident row capacity. The helper
preflights authority and all member recording budgets before appending any command, so recording
capacity failure cannot leave a partially recorded recipe. This does **not** add rollback or
transactional playback: a later component-validation failure has the existing playback contract.
A sparse domain permits an empty recipe/selection (identity only). A dense single-member domain
uses its normal row-creating path and rejects an empty selection, preserving dense ID/row alignment.
Generated API name collisions are schema errors (`SCH2170`), not silently renamed members.

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

`handle(T)` is the one type only ephemeral kinds may declare: an 8-byte
`ConjureDB.EntityHandle` (int id + uint generation) addressing an entity of `T`'s entity
domain, stored like any other unmanaged column.

```conjure
ephemeral table Projectile(plural: Projectiles, capacity: 4096) {
    Id: int @id
    Target: handle(Unit)      // one column replaces an id/generation pair
    Damage: int
}

event table HitEvent(plural: HitEvents, capacity: 1024, lifetime: frame) {
    Target: handle(Unit)
    Damage: int
}
```

- `T` must be a plain `ephemeral table`. A persistent table cannot declare the type
  (`UMEP016`) and the nullable form is rejected (`UMEP017`) — the absent value is
  `EntityHandle.None`.
- The type's identity is the **entity domain**, not the table. Member tables of one
  `entity domain` name the same handle type, and a value of it probes any of them; a table
  in no declared domain owns an implicit single-table domain of its own name.
- Handles compare with `==` / `!=` against the same domain only: no ordering, no
  arithmetic, and no conversion to or from integers.
- A handle must be a column of the table; reaching one through a declared `struct type`
  is rejected (`UMEP001`), because the generated row remapper addresses columns.
- Every ephemeral or event table with a handle column gets a generated static
  `ProvisionalRemapper`. A deferred `Commands.Create` returns a provisional handle, and any
  event row that stores one is rewritten to the real handle at the next phase boundary,
  after the insert plays back. An unresolvable provisional handle throws at the boundary and
  the rows of that failed window are discarded, so a bad row cannot re-throw at every later
  boundary.
- A provisional handle may be emitted only into a **`next_frame`** event table. Its rows become
  readable at the frame-start swap, which runs after the boundary remap, so a consumer never
  observes a provisional handle. A `frame` stream is readable in the very phase that appends to
  it — before any boundary — so the remap would be too late and the DSL refuses the event
  (`SCH2166`). The runtime still remaps `frame` streams at boundaries, for handles a host writes
  in one phase and reads in a later one.

### Tag tables

An `ephemeral table` whose `@id` is its **only** column is a **tag table**: a label an
entity either carries or does not.

```conjure
ephemeral table Chiller(plural: Chillers, capacity: 256) {
    Id: int @id
    Heat: int
}

ephemeral table Frozen(plural: Frozens, capacity: 256) {
    Id: int @id
}

entity domain Cryo { Chiller, Frozen }
```

It is a table, not a keyword, so nothing about it is special-cased:

| Written | Means |
|---|---|
| `upsert Frozen for c` | Attaches the tag to the entity `c` currently resolves to. The payload block is optional because `Frozen` has no non-identity column — the rule is stated normatively in [Schema Language](/docs/schema/schema-language) under *Effects*, `insert T`. A written block must be empty; every field in it is reported as its own `SCH2167` with its own span. |
| `insert Frozen` | The same attach on a **fresh** entity of `Frozen`'s domain, rather than on one an alias already names. It is how the "insert the entity, then attach its components" order is written: `let h = insert Frozen` names the new entity, and `upsert Body for h { … }` attaches the rest to it. |
| `from Frozen z` | Drives over exactly the tagged entities — O(#tagged), not O(#entities). |
| `join Frozen z (c.Id == z.Id)` | An existence test. |
| `match { miss z => { … } }` | Absence: the arm runs for the untagged rows. |
| `delete z` | Removes the tag. The entity and its other component rows are untouched. |
| `disable z` / `enable z` | Hide and restore the tag row like any other row. |

`Frozen` must be a member of the target's `entity domain` for `upsert Frozen for c` to
name it, exactly as for any other component table.

**Storage.** A tag table has no payload column group at all, so it carries only the paged
sparse id map, the slot→id chunks and the enabled bitmap: one 32 KB sparse page per 4 096
ids, 4 bytes per row for the id chunk, and one 64-bit word per 64 rows for the bitmap.
Its chunk row capacity is budgeted from the slot→id entry, the one per-row structure it
still has.

Chunks are allocated whole, and the 64 KB chunk budget divided by that 4-byte entry gives
a chunk of **16 384 rows**. So the first tagged row costs a 64 KB id chunk, a 2 KB enabled
bitmap and a 32 KB sparse page — **100 352 bytes** — and rows 2 through 16 384 cost nothing
more. `capacity:` does not change this: it is a soft cardinality hint for costing and
reserves nothing (see [Schema Language](/docs/schema/schema-language)), and the chunk budget is a
property of the machine rather than of the declared cardinality.

That floor is **not** particular to tag tables. A payload table whose widest column group is
an `int` derives the same 16 384-row chunk, so a `capacity: 256` table with three `int`
columns allocates the same bookkeeping plus 64 KB per column group on its first row. A tag
table is simply the shape where the bookkeeping is all there is.

**Why not the alternatives.** A `bool` column on the main table would make every entity
carry the byte and would turn "iterate the frozen units" from O(#frozen) into O(#units) —
the exact cost the table-is-an-archetype model exists to avoid; Unity DOTS' zero-sized
`IComponentData` tag is the same construct for the same reason. The enabled bit is the
visibility of the row itself, one axis per table, so two independent tags cannot share it.
A dedicated `tag table` keyword would be a second spelling of a shape the language already
expresses, which the binder would then have to keep in step for no semantic gain.

### Declaration diagnostics

Every ephemeral schema rejection is one of these codes.

| Code | Raised when |
|---|---|
| `UMEP001` | A column type is not pointer-free/blittable |
| `UMEP002` | A secondary index is declared on an event or singleton table, which owns no rows to index |
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
| `UMEP016` | A persistent table reaches a `handle(...)` column, directly or through a declared struct type |
| `UMEP017` | A `handle(...)` column is declared nullable |
| `UMEP018` | Invalid `@index` on an ephemeral table: unsupported kind, unsupported or nullable key type, the `@id` column, or a composite `@@index`/`@@unique` |
| `UMEP019` | An indexed column is named in a `@@group` |
| `SCH2171` | Invalid ordered access path: a `sort` driver over a column with no `bucketed` index, or a `@parent` declaration missing a companion index, naming a bad depth column, or with a `max_depth` outside that depth's domain; also a `set` or `insert` payload naming the engine-maintained depth column |

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
| `from P p \| aggregate Cnt = count()` | cardinality-only count | shipped test |
| `from P p \| filter … \| aggregate Cnt = count()` | filtered count | shipped test |
| `from P p \| sort -p.Y \| take @k \| select …` | bounded Top-N | shipped test |
| `from E e \| filter … \| select …` over an `event table` | whole-row event stream scan | shipped test |
| `from E e \| join P p (e.TargetId == p.Id) \| select …` | ephemeral slot probe | shipped test |
| `from P p \| join Player pl (p.OwnerId == pl.Id) \| select …` | persistent index families ([Interop with persistent tables](#interop-with-persistent-tables)) | shipped test |
| semi/anti membership across kinds | bitmap membership | shipped test |
| `from P p \| group p.OwnerId (aggregate Cnt = count()) \| select …` | chunk scan + grouped aggregate | shipped test |
| `from P p \| filter … \| group … (aggregate MaxY = max(p.Y)) \| select …` | pre-group filter + grouped aggregate | shipped test |
| `from E e \| group e.TargetId (aggregate Total = sum(e.Amount)) \| select …` | event stream + grouped aggregate | shipped test |
| `from P p \| select p.OwnerId \| distinct` | chunk scan + distinct | shipped test |
| `from P p \| select p.OwnerId \| union (from Player pl \| select pl.Id)` | mixed-branch set operation | shipped test |
| `from P p \| filter exists(from Player pl \| filter pl.Id == p.OwnerId \| select pl.Id) \| select p.Id` | correlated EXISTS into a persistent table | shipped test |
| `from P p \| group p.OwnerId (sort { -p.Y, p.Id } \| derive rn = row_number() \| select …)` | chunk scan + row-number window | shipped test |

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

### Generation-safe references in compiled queries

`entity_handle(alias)` denotes the current full identity of an ephemeral **row-table**
alias. It is a typed relational value, not a field added to the row schema. For example:

```conjure
from Shot s
| join Fighter f (s.Target == entity_handle(f))
| select { ShotId = s.Id, Hp = f.Hp }
```

A filter such as `entity_handle(f) == @target` also compares the full identity. The target
must be alive, attached to the selected component table and enabled. Deleted/recycled,
missing-component, disabled, None and provisional targets do not match. The compiler
rejects comparisons between different declared handle domains; a missing outer-join row
projects a nullable handle, not `EntityHandle.None`.

The planner may select a full-handle sparse probe or a generic join. Both retain the
captured identity, including buffered hash rows and self-joins. Allocating, `ForEach` and
`NoAlloc` results agree wherever those surfaces are admitted. Existing resource restrictions
remain: a full outer hash join is allocating-only; this feature does not expand portable,
Burst or wildcard-query admission.

An external C# `EntityHandle` still contains only Id/Generation, not a world/domain token.
Callers must supply handles from the query's owning context/domain; coincident raw bits from
an unrelated context cannot be distinguished at runtime. Domain checking inside the query
uses its bound typed expressions. See `CompiledEntityHandleQueryTests` for the live, stale,
visibility, missing-component, nullable-outer, self-join and hash-replay cases.

### Frame-system SIMD lane

`system` declarations support a set-oriented update with same-domain id joins, an
optional filter, and `=`, `+=`, `-=`, `*=`, `/=`:

```conjure
system IntegrateMotion(phase: fixed_update) {
    from Position p
    | join Velocity v (p.Id == v.Id)
    | set { p.X += v.Dx * @dt, p.Y += v.Dy * @dt }
}
```

The compiler publishes a typed execution decision for every generated kernel. The
portable-vector body is admitted for a single in-place `set` over one chunked source,
without joins, indexed-column writes or an ordered driver. Assignment targets and
column reads are direct non-null `float` SoA columns; assignment expressions use
column reads, `float`/`double` literals, `@dt`, `+`, `-`, `*`, and unary negation.
An optional filter may be one supported comparison over direct non-null
`float`/`double` columns and literals. Its lane mask preserves unselected values;
float-to-double promotion is preserved, not approximated by narrowing the literal.
For an otherwise admitted statement, an unsupported predicate reports
`FilterNotMaskable`; joins and other rejected statement shapes retain their own
reasons. Every other valid shape runs the
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

The later filtered SIMD measurement
records ten-profile exact parity and dense speedups of 1.92× at 100k rows and
3.00× at 1M rows. Sparse25 at 1M was about 14% slower; this is not an all-profile
speedup claim. These remain scoped cohort results, not a Unity explicit-vector
guarantee. The later targeted acceptance map
records current-source verification and its limits without claiming a full-corpus receipt.

### Parallel frame systems — host options

Splitting a system's per-row work across worker threads is a **host** decision, never a
schema one: the worker count is a property of the machine, and a schema knob could not mean
the same thing on a phone, a ten-core server and a single-core test host. Four
`FrameSchedulerOptions` members carry it, all immutable for the scheduler's lifetime:

| Option | Default | What it does |
|---|---|---|
| `ParallelExecutionPolicy` | `Auto` | `Auto` splits an admitted system's row work across the scheduler's workers when the driver is large enough to pay for the fork. `ForceSequential` runs every system's row work on the frame thread. |
| `MaxWorkerCount` | unbounded | Upper bound on the **total** workers a fork uses, counting the frame thread as worker 0. The realized count is additionally bounded by `ProcessorCount − 1`. |
| `MinimumRowsPerParallelWorker` | `4096` | Rows a worker must be given before a fork is worth its barrier. The previous `16384` was derived from a CoreCLR-era cold fork-join; on the release IL2CPP player the measured sweep is better or neutral at `4096` on every shape (a twenty-lane small profile 65.8 → 58.0 µs, its fused three-invocation form 32.6 → 29.5 µs, a large profile's p99 145 → 126 µs, the strict chain at TOTAL8 67.2 → 58.3 µs), because at 16 384 rows a lane below the floor plans a single range and cannot be forked at all. The configured value is the **8-worker baseline**: seal scales it by the sealed owner-inclusive budget, `effective = configured × max(1, sealedWorkers / 8)` (so `8192` at 16 workers), because on the extra threads a floor that low splits work into ranges too small to amortize their barriers; the currently measured sixteen-worker independent cohorts are `1.69×`/`1.80×` against the external DOTS reference — the earlier `2.92×`/`2.02×` pair predates the DISP dense-range probe and the FUS staged-capacity fix and is **not reproducible on this SHA**, so it is retired rather than quoted. The resolved effective value is reported in the sealed schedule snapshot, and lowering the configured value further (for example `1024`) remains the lever for range-starved strict chains. See the internal frame-execution design notes. |
| `WorkerThreadPriority` | `Normal` | Scheduling priority of every background worker thread the scheduler starts. A fork's barrier is frame time — the frame thread waits for the slowest worker — so a worker below the frame thread's priority starves under CPU contention and stretches the frame. Match the frame thread, exactly as `WorkerConfiguration.WorkerThreadPriority` does for the commit worker (see [ConcurrencyControl](/docs/engine/concurrency)); higher gains nothing and would let workers preempt the render thread. Undefined values are rejected when the scheduler is constructed. Linux and Android may ignore a priority change of a normal thread without elevated privileges. |

`ForceSequential` is not a debug flag with fuzzy semantics: for **a frame that completes**,
the frame transcript, every counter and every digest are **identical** between it and `Auto`
at every worker count, because the sequential lane is the one-worker case of the same row
body and effects are always applied on the frame thread in row order. It exists so an A/B
determinism harness can run the same binary both ways.

The qualification is real and worth reading once. A frame that **fails** — a system threw,
including through the fail-closed guard on an undersized effect-record buffer — is reported
`Aborted`, and its storage holds whatever the ranges that did not throw had already applied
in place while nothing recorded was applied at all. Which rows those are depends on how the
ranges were distributed across threads, so an aborted frame's storage is not required to
match `ForceSequential`'s. A failed frame is a defect to fix, not a state to resume from.

**You do not need to set `MaxWorkerCount` for the default to be safe.** The pool splits a
driver into more ranges than it has workers and every worker claims the next unclaimed one,
so a worker the OS deschedules simply claims nothing and its peers finish its share. That is
what makes the sealed default (`ProcessorCount − 1`) an operating point rather than a cliff.
Set the bound when you want to reserve cores for something else — an audio thread, a render
thread — not to work around the barrier.

**What a fork costs**, including the cold fork a 60 Hz frame actually pays and the CPU an
idle pool spends waiting, is measured per worker count in the internal frame-execution design notes; that table is the
one owner of those figures and this page deliberately does not restate them. Reproduce them
on your own host with `dotnet ConjureDB.Benchmarks.dll --frame-fork-join` and
`--frame-cold-fork`.

**A parked worker costs a measurable handshake on the frame after a gap.** The pool's workers
wait by spinning against a bounded wall-clock budget and park when it expires, and a parked
worker observes the next release only when the frame thread's wake reaches the OS scheduler:
measured on the release IL2CPP player a parked worker sees that release 9–15 µs late (worst
36.5 µs) where a still-spinning worker sees it in 0.2 µs, and a 2 ms idle gap — an ordinary
game frame — moves the measured frame p50 from 14.7 µs to 55.0 µs. The shipped back-to-back
protocol cannot see that cost because its frames never let the workers park; treating it needs
its own mechanism and its own evidence, not a longer spin budget that taxes every idle core
between frames. Figures and method: the internal frame-execution design notes.

Worker allocation is included in the frame report: `FrameSystemTiming.AllocatedBytes` and
`LastFrameReport.AllocatedBytes` cover the workers as well as the frame thread, with
`WorkerAllocatedBytes` reported separately, so a 0 B/frame budget still means what it says
once a system forks.

`FrameSystemTiming.WorkerBackend` records the finalized registered system's declared scheduling
backend (`Managed` for an ordinary unscheduled system), independently of its execution `Route`.
It remains a descriptor when a system is paused or has no work; it does not prove that a body,
Burst code, or a physical worker ran. `Forks` describes accepted submission plans, including a
native adapter's parallel job submitted from its own `Run`; `ActualWorkerCount` separately records
observed participants. A synchronous native `Run` has no submitted fork. Native execution claims
therefore need the route, actual work, and the adapter's own execution evidence together, not the
backend descriptor alone.

### Generated-host fusion (adopted packs)

A generated host can ask the compiler to fuse provably independent same-phase systems into a
single scheduled invocation by declaring `<ConjureDBFrameSystemFusion>true</ConjureDBFrameSystemFusion>`
in the owning project file. There is no environment variable and no runtime switch: adoption is a
fact of the generated pack's build graph, so the emitted registration, the pack that ships and the
documentation of the shape are one contract, and an adopted pack is byte-reproducible from its own
project alone.

What adoption emits:

- a conflict-free group becomes **one union-range invocation**: a single census over the
  concatenated chunk domain plans one fork, one pooled job publishes it, and each range is
  dispatched into the owning member's own emitted row body. The group registers as one system, so
  it reports one `FrameSystemTiming` row for the whole group;
- a group whose members are ordered by an access conflict becomes a **staged invocation**: one
  stage per member, each stage publishing before the next is admitted, with every member still
  registered in its own right and therefore still reporting its own `FrameSystemTiming` row.

Fail-closed limits, all typed:

- members must be managed-backend, `DirectNoThrow` systems with stable chunk views; a member that
  is not refuses the group (`FusionKindMismatch`, `LifecycleContractRefused`) and the pack keeps
  the per-system schedule it would have emitted without adoption;
- a staged plan needs as many ranges as the completed stages have planned, so a stage-heavy chain
  needs more sealed range capacity than `workers × RangesPerWorker`; the refusal is explicit rather
  than a truncated plan;
- fusion never changes the frame transcript, the row digest or the publication order of the
  systems it replaces: an adopted pack and its non-adopted sibling must agree row for row, which is
  what the fixture pairs under exist to prove.

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
frame-system lane's bounded single-source comparison-filter contract and does not insert a general vectorized
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

### System and group activation

`FrameScheduler` exposes owner-bound `FrameSystemId` and `FrameSystemGroupId` values.
Before `Seal`, declare groups with `RegisterGroup(new FrameSystemGroupName("AI"))` and
attach registered systems with `AddToGroup(group, systemId)`. `TryGetSystemId` resolves a
registered typed system name without sealing. A system has at most one direct group; a
group has at most one parent, and cycles are rejected. Membership is immutable after seal.

A generated context seals its schedule during initialization. Declare its groups in
`DbConfiguration.FrameRuntimeConfiguration`: this callback runs after generated systems
register and before seal, so it can resolve their IDs and add them to groups. Retain the
returned group IDs to pause/resume them after initialization.

Use `SetEnabled(id, bool)`, `Pause(id)` and `Resume(id)` for either kind of id on the
scheduler's owner thread **between complete frames**. An open manually hosted frame is
not idle, including intervals between its phases. `IsEnabled` reports local configuration;
`IsActive` includes disabled ancestors. `IsActive` and `GetActivationSnapshot` seal registration
if necessary. Resuming a child does not override a paused parent.

Paused systems acquire no execution leases, submit no jobs and publish no effects. Their
initialized resources remain owned until scheduler disposal. Global event aging, structural
boundaries and the fixed-step clock continue even when every system is inactive. Dependencies
between active systems remain valid across paused intermediate systems, including native
submission tokens.

Fully active fusion retains the original execution path. A partially active fused/staged group
uses only its active members' individual lifecycles; `GetActivationSnapshot` exposes this
selection. Activation plans are rebuilt when configuration changes, not per row or per frame.
Changing configuration can allocate; the unchanged warmed execution path does not allocate
for activation bookkeeping. Runtime tests cover native submission contracts; this is not an
additional Unity/IL2CPP execution certification.

### Explicit row-change observation

Each row table exposes an opt-in `RowChanges` journal. Call `Enable(capacity)` on
the owner thread during setup, read its typed `Entries` after the relevant playback
boundary, then `Clear()` after consumption. Each `EphemeralRowChange` contains a
`Kind` and the exact `EntityHandle` captured when the operation was applied. Attach,
detach, enabled/disabled transitions and successful explicit buffered upsert replacements
are distinct kinds. `RowReplaced` also records equal-payload replacements; it is an
operation notification, not a comparison of field values.

A bulk attach emits one `RowAttached` entry per row in reservation order. Deletion,
compaction or ID reuse before consumption cannot change those recorded identities.
Failed or stale/no-op operations, relocation bookkeeping and arbitrary `ref`/span/native
field writes do not produce replacement notifications.

The buffer has fixed capacity in **row entries**: always check `Overflowed` and
`DroppedCount` before treating its contents as complete. `DroppedCount` is a `long` that
saturates at `long.MaxValue` (meaning at least that many drops), so overflow cannot wrap
away. Re-enabling the journal resets its history; increasing capacity cannot recover
already dropped entries. The journal is disabled by default and recording does not
allocate. It is not a callback during partially applied playback, a cross-table total
order, an old-value snapshot, a column-change tracker, or a persistent/IVM delta feed.

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
- `SetEnabled` with a stale or unattached handle **throws** when called directly: the caller
  holds a handle it just obtained, so a stale one is its own defect;
- a *buffered* `SetEnabled` — one a system recorded through `Commands` — is instead **dropped**
  at playback when its handle no longer resolves. Another command of the same window may
  legitimately have destroyed the row, and once the slot is reused, applying the bit would flip
  the visibility of a **different** entity. Dropping it is deferred-command semantics, not a
  silent failure: `FrameScheduler.LastFrameReport.BoundaryDrops` counts every dropped
  `SetEnabled`, `Destroy` and `DestroyEntity` of the frame. Within one system row the shape is statically
  visible and refused instead — an `enable`/`disable` (or a `upsert … for`) after a `delete`
  of the same alias is `SCH2164` (`SCH2167` for the insert) at compile time;
- `CreateFor` with a stale handle throws and names the current generation.
- a *buffered* `upsert … for` — one a system recorded, or a `Commands.CreateFor` call — is an
  **upsert**, under the rule stated normatively in
  [Schema Language](/docs/schema/schema-language#65--ephemeral-tables-events-singletons-domains-and-systems)
  under *Effects*, `upsert T for target`. The *direct* `EphemeralSet<T>.CreateFor` is the one
  exception and still throws on a duplicate: outside a playback window no other command could
  have created the row, so a duplicate is the caller's defect.

### Entity domains

An `entity domain` gives its member tables one id allocator and one generation
authority, so id-aligned rows across tables address the same logical entity. A table not
listed in any declared domain gets an implicit single-table domain, where set-level
`Destroy` also recycles the identity.

Domain delete preflights every member before changing any table and removes the entity
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
true upper bound, and a insert past it throws
*"Ephemeral table '…' reached its hard row cap of N"* rather than growing.

A `singleton table` cannot declare capacity at all (`UMEP006`).

### Persistence exclusion

Ephemeral tables never persist, never migrate, and carry no `type_id` — code generation
assigns their runtime identities. `persistence:` and `type_id:` are rejected outright
(`UMEP003` / `UMEP004`). There is no snapshot, journal, or restore path for ephemeral
data: it exists for the process session only.

### Secondary indexes

An ephemeral table column may declare `@index(name: "…", kind: lookup | bucketed, buckets: N)`.
The index has no staging buffer, no epoch, and no fresh-or-scan alternative plan: every
mutation that can change an indexed column's value, or a row's membership, updates the
index in the same call, before that call returns — the index is exactly as fresh as the
storage it indexes. It exists to serve reads, and there is one rule set for both consumers:
a frame system reaches it through `join … on index (…)`, and a **compiled query** whose filter
is an equality on the indexed column is served by it too — the planner resolves the declared
index from the equality and lowers the read to that index's bucket group instead of a chunk
walk. An equality on a column that declares no index keeps chunk-scanning, and so does every
predicate an index cannot serve (a range, a conjunction, a computed value), so the access path
always follows the declaration and never an inference.

An index probe visits its candidates in ascending dense-slot order, which is the chunk scan's
own chunk-then-offset order, so a query answered by an index returns the same rows in the same
order as the same query answered by a scan — a digest folded over visit order is unaffected. A
`lookup` index's candidates are confirmed against the indexed column's own cell; a `bucketed`
index's are exact by construction.

Admitted kinds are `lookup` (hashed bucket, a sizing hint) and `bucketed` (the key is the
bucket, a hard domain bound — a write outside `[0, buckets)` is a runtime error naming the
table, column and value). Admitted key types: `int`, `uint`, `short`, `ushort`, `byte`,
`sbyte`, `long`, `ulong`, an enum-typed column, and `handle(D)`; for `bucketed`, an
integral or enum column — a `handle(D)` has no ordering domain and is refused statically.
(`sbyte` and `ushort` are admitted keys, but neither is a declarable ephemeral column type
yet, so a column of that width is rejected as a column before its index is read.)

A `bucketed` key's **non-negativity is a runtime fact, not a column-type one**: the key is
usually computed (`cy * Width + cx`), so no column type makes it non-negative, and a write
of a key outside `[0, buckets)` — negative or too large — is refused before it stores, naming
the table, column, value and domain. A signed column is therefore admitted deliberately:
declaring the column `uint` to "make it non-negative" would turn a detectable negative into
a silently wrapped huge key.

`buckets:` must not exceed the table's **row bound** — its `max_capacity` when it declares one,
otherwise its `capacity` (`UMEP018`, `SchemaEphemeralIndexValidator.cs:312`): a table holding
at most N rows holds at most N distinct keys, so a larger count is a bucket array that can
never be reached, and for `bucketed` a declared key domain wider than the row domain. `buckets:`
defaults to the table's `capacity` when the annotation omits it
(`EphemeralColumnIndex.cs:56-57`); a table that grows past its capacity hint keeps the index
it declared, which is why the *bound* reads the hard cap and the *default* reads the hint.

**Visibility is not membership.** The index holds every **live** row of the table, enabled or
not: `SetEnabled` flips one bitmap word and moves nothing, so an index never churns on
enable/disable and bucket occupancy counts disabled rows. Only a insert, a delete and a key
write change an index. A generated system's pair loop applies the enabled filter after the
probe, exactly as a chunk scan does; a hand-written kernel reading the index view must apply
it itself. This sentence is the normative rule — every other statement of it, in this
document and in
[Schema Language](/docs/schema/schema-language) and the internal frame-execution design notes,
refers back to it.

`name:` is optional and defaults to `<Table>_<Column>_Index`. It is the index's identity in
diagnostics and explain output, so it must be unique within its table — including against
another column's derived default (`UMEP018`).

Rejected key types and kinds, each for a stated reason, report `UMEP018`:

- `float` / `double` / `decimal` keys — equality on a computed float key is a defect
  generator; a quantized `int` cell key is the correct spelling.
- A nullable column — a null key has no bucket, and a null group would be a second
  membership mechanism nothing downstream consumes.
- `string` — kept off this hot path like every other internal key.
- The `@id` column — identity is not a secondary index; declare the table
  `ids: dense` instead if the identity probe itself is the bottleneck.
- `unique`, `sorted_set`, `sorted_list`, `range_lookup`, `grouped_sorted`, `aggregation`,
  `spatial_grid` — each is a different container with its own maintenance cost, and none
  is required by a shape this contract serves; `unique` in particular needs a conflict
  check a deferred `insert` can only raise at the playback boundary, which is a second
  mechanism this design does not add.

Composite `@@index` / `@@unique` (a multi-column key) stay rejected on ephemeral tables
(`UMEP018`): a multi-column ephemeral key is not supported.

**The write rule** — the write choke point, stated normatively here; every other mention of it
in this document, in [Schema Language](/docs/schema/schema-language) and in the internal frame-execution design notes
refers back to it. An indexed column is placed in a storage group of its own by the
chunk-layout planner, and that group is emitted with **no writable span, ref, or pointer
accessor**. `RowMutRef` hands out the column as `ref readonly`, `ChunkViewMut` and the
host's `StorageGroupNFrameWriteAccess.GetChunk` token hand out a `ReadOnlySpan`, and no
`Get<Group>ChunkMut` is generated for it at all — any of them could otherwise write the
column without the index seeing it. The refusal happens **at capability acquisition**,
before any accessor exists: naming an indexed column in a `Write`-mode column acquisition
is an error, whoever asks and whatever it intends to do with it (the index view a job
probes is read-only for the same reason). That also means a whole-row mutable view of an
indexed table acquires `Write` over the unindexed columns and `Read` over the indexed
ones — which is exactly what it hands out.

That refusal is a **capability** rule, not a memory barrier. A host holding a read-only
span of an indexed column can still reinterpret it as writable memory — through
`EphemeralChunkMemory.PointerOf(ReadOnlySpan<T>)`, which exists for Burst jobs that read
through pointers, or through `Unsafe` directly — and a write made that way desynchronizes
the index. That is outside the contract in exactly the way writing through any read-only
span is, and no in-process check can close it; do not do it.

The only writable path to an indexed column is the generated set's checked mutator,
`Set<Column>(int chunkIndex, int offset, T value)`: it stores the value and then links or
relinks the index before it returns, so column and index can never disagree. A declarative
`set` of an indexed column lowers to this call instead of a span store, and an indexed
column may not be named in a `@@group` declaration (`UMEP019`) — a group's contract is
exactly the interleaved-span rule the previous paragraph removes for an indexed column.

---

### Hierarchies and the ordered driver

A `handle` column pointing into its OWN table may declare `@parent(depth: Col[,
max_depth: N])`. Both companion indexes are required (`SCH2171` names whichever is
missing): the `lookup` on the link column is the children lookup the depth propagation
walks, and the `bucketed` on the depth column is the ordering access path a `sort`
driver iterates. A root is depth 0, so a depth domain of `buckets` buckets holds
`[0, buckets - 1]` and `max_depth` must fit inside it; omitted, it defaults to
`buckets - 1`.

The declaration and the traversal it enables are printed once, in the internal frame-execution design notes: a
`Node` table whose `Parent` carries the link and the children lookup, a `Depth` carrying the
ordering buckets, and the `PropagateTransforms` system that walks them top-down.

The depth column is engine state and a row's depth is its count of live ancestors; a write
that would close a cycle or exceed `max_depth` is refused at the write, so the graph is a
forest at all times and a depth-ordered driver needs no cycle handling. Those rules are
stated normatively in
[Schema Language § `@parent`](/docs/schema/schema-language#65--ephemeral-tables-events-singletons-domains-and-systems);
what belongs here is what they cost at run time.

Cost: a reparent is O(ancestors ≤ `max_depth`) + O(subtree); attaching a leaf is
O(`max_depth`). Both bounds are stated, and `max_depth` makes the first constant. The
subtree walk is an explicit queue over one pooled `int[]` held for the table's lifetime,
so a warm table allocates 0 B per reparent.

**Destroying a parent that still has children is allowed, and re-roots the orphaned
cone.** Each child of the destroyed row becomes a root — depth 0, its own subtree
rewritten relative to it — while its parent cell keeps the handle no live row answers, so
`join … on ref` still takes its miss arm and the row reads as a root there too. The
rows are not destroyed: a cascade would be a second structural pass no clause asked for,
and a hierarchy that wants one writes it as a declarative `delete` driven by the ordered
driver. The depths move because a depth IS the count of live ancestors: an orphan holding
a depth that counts a destroyed row would sit in the same bucket as its own new parent
after a later reparent, where the ordered driver's guard arm never fires. This paragraph is
the normative statement of the re-rooting rule; the design decision behind it and its
measurement are in the internal frame-execution design notes
`SetEnabled(false)` is not a delete — [visibility is not
membership](#secondary-indexes) — so a disabled parent keeps its depth and keeps counting as
an ancestor, while a probe of it misses: its children propagate as roots for as long as it is
disabled.

**`sort [-]alias.Col` is an access path, never an operator.** Its grammar, its visiting order
and its `SCH2171` admission rule are stated normatively in
[Schema Language § `sort` on a driver](/docs/schema/schema-language#65--ephemeral-tables-events-singletons-domains-and-systems);
there is no sort node, no permutation buffer and no O(n log n) pass in the frame. What this
section adds is what it costs. An ordered driver never vectorizes
(`OrderedDriver`), since the portable vector kernel loads contiguous lanes out of one
chunk and a key-ordered walk crosses chunks arbitrarily. Measured on 20 000 nodes over 5
levels, Release, medians of three interleaved runs: **201 µs / 0 B against a hand-written
depth-bucketed frame system's 202 µs / 0 B — 0.99×.**

Read that baseline precisely, because there are two different questions and only one of them
is answered by 0.99×. It says the ordered driver costs what a hand-rolled bucket walk **over
the same ephemeral storage** costs — the ordering is free, which is the claim the `sort`
access path is making. It does not say the declared shape costs what the same traversal
written **without a database** costs. Against flat arrays — a `parent[]`, a `worldX[]` and a
depth-bucketed ordinal list, which is what a game programmer writes by hand — the same
20 000-node traversal is **3.8×–3.9×**: the declared shape resolves each parent through a
handle probe and reads it through a chunked address computation, where the flat arm indexes
`worldX[parent]`. The comparison engine below reports both, and neither number is the whole
answer on its own.

### Measuring your own shapes against hand-written C#

`ConjureDB.Benchmarks` ships a comparison engine for the declared shapes. It answers the
question you actually have before adopting one — *what does declaring this cost me against
writing it myself?* — and it answers it honestly, because it refuses to compare two costs
until the two implementations have been shown to compute the same answer.

```bash
dotnet run -c Release --project ConjureDB.Benchmarks -- --ephemeral-readiness
dotnet run -c Release --project ConjureDB.Benchmarks -- --ephemeral-readiness \
  --actors 20000 --warmup 30 --frames 60 --seed 20260904
```

Three declared shapes — a grid broadphase, a transform hierarchy and a tag table — are driven
against hand-written arms over one seeded workload at 20 000 actors: an incrementally
maintained `Dictionary<int, List<int>>`, a rebuild-per-frame map, a full O(n²) scan, a
depth-bucketed flat-array traversal and a `HashSet<int>`. Every arm runs in a **process of
its own** (`--arm <name>`), because .NET's dynamic PGO will otherwise specialize a shared
code path for whichever arm ran first and charge the next one for it; the runner spawns them,
runs three interleaved rounds and reports medians.

What it prints, and what to take from it:

- a **digest** per shape, which every arm must agree on before any ratio is computed;
- per arm, the **shape's own work** (for a declared shape, the sum of the times the frame
  report charged its systems), the **whole frame's wall clock**, the **maintenance step**
  alone, and **median and max bytes per frame**;
- the ratios, against their thresholds, with a non-zero exit code when a verdict changes.

Read the two byte columns together. A median of 0 with a non-zero max is a single frame — a
tiered-JIT recompile, a pooled block growing once — while a non-zero median is the steady
state, which is what a 0 B/frame claim is about. On the reference machine every declared
shape reads 0 B median; the hand-written grid arms read ~5 KB/frame and ~839 KB/frame,
which is the `List<int>` churn their idioms require and not a defect in them.

On the reference machine the broadphase beats a full O(n²) scan by **52×–62×** and its index
maintenance costs **0.96×–0.99×** a hand-maintained dictionary's — while the depth-ordered
traversal costs **3.8×** a flat-array walk and the whole grid frame costs **1.10×** a
rebuild-per-frame map. The pattern is one thing: a chunked SoA store pays an address
computation for every randomly addressed row, so a declared shape wins where the access path
saves work (the broadphase visits ~11 candidates instead of 20 000) and loses where the two
implementations do the same amount of work and differ only in how a row is reached. Measure
your own shape before you assume which side of that line it is on.

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

### Persistent index sources in a system

A declarative `system` may read a persistent table through a declared index. Persistent
aliases are read-only and publish no frame write capability; the scheduler does not synchronize
persistent commits. Query and frame planning share the index capability classification, but
retain different visibility and acquisition contracts.

| Access | Frame syntax / admission | Pair order |
| --- | --- | --- |
| Lookup | Full equality key; a composite key requires equality for **every** declared key column, regardless of conjunct order | Primary ID ascending |
| `sorted_set` range | Scalar lower/upper comparisons (`<`, `<=`, `>`, `>=`); optional join-local `sort [-]alias.Key` | Key then primary ID, both in the selected direction |
| `grouped_sorted` Top-K | Complete group equality plus join-local `sort [-]alias.RangeColumn` and `take K`, where K is a positive compile-time integer | Range key then primary ID, both in the selected direction, bounded by K |
| Partial index | Only when the actual bound join predicate proves the index filter using the shared implication rules | The selected family's order |

For example, the acceptance pack contains:

```conjure
system ReadRange(phase: update) {
    from Request q
    | join Entry e on index (e.Score >= q.Lower && e.Score < q.Upper) pin (Entry_Score_Sorted)
    | set { q.Range = q.Range * 10 + e.Digit }
}
system ReadTop(phase: update, after: [ReadRange]) {
    from Request q
    | join Entry e on index (e.Team == q.Team) pin (Entry_Team_Score)
    | sort -e.Score | take 3
    | set { q.Top = q.Top * 10 + e.Digit }
}
```

These are join-local indexed traversals, not a general frame sort. Missing key columns,
unsupported windows or unproven partial predicates are compilation errors (`SCH2169`), not
hidden scans. The planner chooses the first declared admissible index. `pin (Name)` asserts
that selected identity; it cannot force another index or manufacture a predicate proof.
Ephemeral `lookup`/`bucketed` admission is unchanged.

**Commit, prepare when required, then pump.** A context with selected sorted-range systems emits
`PrepareCommittedFrameIndexReads()`. Call it outside any open frame or transaction, after
persistent publication is synchronized and before the next pump. Preparation owns any snapshot
storage growth; it never synchronizes a dirty index. Unprepared/stale reads refuse through
`FrameHostContractException`. Membership, committed source and preparation generations detect
observed changes, including non-key updates/row relocation, rebuild/rollback and repeated
preparation invalidating an outstanding borrow. Grouped windows use the index's bounded NoSync
cursor; they do not allocate a query-local sort buffer. Lookup retains its existing index-owned
ID-order buffer contract. Ordinary query transaction visibility is unchanged.

**The host must not overlap persistent mutation or commits with frame consumption.** This is
NoSync temporal separation, not concurrent snapshot isolation: cursors do not hold a read lock
or immutable-memory lease across consumption. Version checks cannot exclude a writer between
checking a stamp and reading memory. Persistent sources are not protected by frame access manifests.
A retained mutable `record` object is likewise still host-owned; mutating it outside the normal
write path is not made safe by a read-only system alias.

`PersistentFrameIndexTests` compares all four shapes with ordinary query oracles, verifies exact
bounds and stable ties after rebuild/rollback, stale/dirty/owner refusals, retained capacities,
and zero allocation on the warmed admitted fixture. This is not a new general performance claim.

### Query-lane index synchronization

Index synchronization stays entirely with the persistent table. On a clean index the
synchronized persistent index is used; if the persistent transaction is dirty, generated
query access reads transaction-visible primary state so an uncommitted insert, delete, or
key move is reflected immediately. After commit the synchronized index produces the same
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
declare a relation whose target is ephemeral (`UMEP009`). This does not prohibit typed
handle columns or the safe `entity_handle(alias)` comparison described above. Plain numeric
ID joins retain their separate contract:

> **A compiled join on a raw id is generation-agnostic. After an id is destroyed and
> recycled, the join resolves the *current* holder of that id, not the original entity.**

This is deliberate. For generation-safe references, retain an `EntityHandle` and compare it
with `entity_handle(targetAlias)`, or use the explicit handle-based row accessors. Existing
numeric-ID foreign-key joins are not silently rewritten into full-handle joins.

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
`ConjureDB.Ephemeral.NetStandardGate` compiles the reference pack for netstandard2.1 in every
solution build so the portable branch cannot regress silently. On IL2CPP `Vector.IsHardwareAccelerated`
is false, so both vector lanes execute their scalar oracle by contract.

Generated query metadata is reflection-free data (`GeneratedQueryMethodAbi` carries the declaring
type, name, return type and parameter contracts; nothing is resolved at initialization), and frame
diagnostics convert clock ticks without `TimeSpan.FromSeconds`, which rounds to milliseconds on
Unity's Mono corlib. Both were found by running the Arena sample on device.

**Historical measured hosts before generated-adapter cutover (2026-09-03, Unity 6000.7.0a2, Arena sample, 100 k units, one fixed tick per frame, M4 Max):**

For the published generated host and its p50/p99 distinction, see the
W8 comparison.

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
order for every driver row, so the statement reads like the imperative loop it replaces.
Here `before:` states a hard ordering dependency; a relaxable preference would use
`prefer_before:` instead. The arena systems are excerpts; referenced tables and other
systems are declared elsewhere:

```conjure
system Collision(phase: fixed_update, before: [IntegrateBodies, IntegrateProjectiles]) {
    from Projectile p
    | join Body b on ref (p.Target)
    | match {
        miss b => {
            set { ArenaCounter.ProjectilesLostTarget += 1 }
            delete p
        }
        (b.X - p.X) * (b.X - p.X) + (b.Y - p.Y) * (b.Y - p.Y) <= ArenaSetting.HitRadiusSquared => {
            event HitEvent { ProjectileId = p.Id, Target = p.Target, Damage = p.Damage }
            delete p
        }
        p.TtlTicks <= 0 => {
            set { ArenaCounter.ProjectilesExpired += 1 }
            delete p
        }
      }
}

system ApplyHits(phase: frame_start) {
    from HitEvent h
    | join Unit u on ref (h.Target)
    | filter u.Health > 0
    | set { u.Health -= h.Damage, ArenaCounter.Hits += 1 }
    | join Body b (u.Id == b.Id)
    | match {
        u.Health <= 0 => {
            event DeadSlot { Slot = b.ViewSlot }
            delete entity u
        }
      }
}

system Fire(phase: fixed_update, before: [Collision]) {
    from generate(ArenaSetting.ShotsPerTick) shot
    | draw r1 from Rng.State
    | let shooterSlot = rand_int(r1, ArenaSetting.SlotCount)
    | lookup Slot ss on id (shooterSlot + 1)
    | lookup Player owner on id (ss.PlayerId)
    | filter owner.Level > 0
    | insert Projectile { X = ss.X, Y = ss.Y, Damage = owner.Level, TtlTicks = ArenaSetting.ProjectileTtlTicks }
    | set { ArenaCounter.ProjectilesFired += 1 }
}
```

- **Driver**: `update`/`from` a plain ephemeral table (chunked rows, enabled mask honoured),
  `from` an event table (the frame's readable buffer, append-only), or `update` a singleton
  (one row). Persistent tables are refused. `from generate(count) name` is a counted driver: it
  iterates no table, binds `name` to an `int` over `0 … count-1`, and runs zero iterations
  for a non-positive count. The count is evaluated once, before the loop, so it sees only
  singletons and frame parameters.
- **Joins and lookups**: `join T alias (x.Id == alias.Id)` is the same-domain id join;
  `join T alias on ref (expr)` is a direct generational probe by a whole `handle(D)`
  value, where `T` belongs to domain `D` (`SCH2158` otherwise), and
  `join T alias on ref (id, generation)` is the same probe from a stored `int`/`uint`
  pair; a recycled id never resolves. `lookup T alias on id (expr)` probes by primary id —
  through the entity token for a plain ephemeral table, or
  through the generated primary-key lookup for a persistent table with a single `int` key.
  A miss skips the row unless a later `match` has a `miss alias` arm — then the join
  publishes a hit flag instead. A persistent source is read-only for the whole statement and
  publishes nothing in the manifest: it is outside the frame's authority, exactly as it is
  for a hand-written system.
- **Row-locals**: `var name = expr` binds a value visible to every later clause;
  `draw name from Singleton.Column` advances a `uint` singleton column by one xorshift32 step
  and binds the new state. Both are readable from their declaring clause on and may not
  shadow a source alias or singleton table name.
- **`filter`** skips the row; **`set`** is a simultaneous block (all right-hand sides, then
  all stores) whose targets may be the driver, a joined alias, or a singleton; **`match`**
  runs exactly one arm — the first `miss alias =>` or `guard =>` that holds — and its
  effects. Every effect is also usable as a top-level clause, where it runs unconditionally
  for the row: `set`, `event Event { … }` (every column once), `insert T { … }` and
  `upsert T for target { … }` (every non-identity column once, except that a column declaring
  `@default(constant)` may be omitted and receives its default — Schema Language §8.3; the
  runtime allocates the id — and `for` an entity that already owns a row of `T` **overwrites**
  that row, keeping its identity and enabled bit, with omitted defaulted columns reset to their
  defaults: the effect is an upsert, which is exactly what the verb says),
  `delete alias`, `delete entity alias`, and `enable`/`disable alias`. All of them are
  deferred commands that play back at the phase boundary, exactly like the matching
  `Commands` call from a hand-written system — so a created row exists only after the next
  boundary, and a disabled row keeps its handle.
- **Provisional handles**: `var name = insert T { … }` binds the buffered insert's handle —
  the row it names appears only at the next phase boundary, so the value is *provisional*, and
  so is a `var` that aliases it. It may be used as the `for` target of a later `upsert`, as a
  handle-column value in an `insert` payload, or as a handle-column value in the payload of an
  `event` into a `next_frame` event table; anywhere else (a `set` into a live row or singleton, a
  `join … on ref`, a comparison, a `filter`, or an `event` into a `frame`-lifetime stream,
  whose rows are readable in the same phase before the boundary remaps them) it would name a row
  that does not exist and reports `SCH2166`. Both buffered forms
  are rewritten at the boundary — an insert whose payload may hold one plays back through the
  created table's generated row remapper, and an event stream remaps the rows it appended
  since the previous boundary — so nothing downstream ever observes a provisional handle at
  rest:

  ```conjure
  system Hatch(phase: frame_end) {
      from generate(Hatchery.Count) i
      | let unit = insert Unit { Hp = 5 }
      | upsert Body for unit { X = i, Owner = unit }
      | event Spawned { Origin = unit, Tag = i }
  }
  ```
- **Scope**: singleton tables are visible by their table name in every system; a written
  singleton is `ref`-leased, a read-only one copied. The frame parameters are `@dt`,
  `@fixedDt` and `@alpha` (`float`, as Unity's `Time.deltaTime`) and `@frame` / `@fixedTick`
  (`long`).
- **Handle parts**: `entity_id(h)` and `entity_generation(h)` read the two parts of a
  `handle(T)` value in any lane, including queries, where a handle column has no other
  projection. They read what is stored rather than resolving it, so a stale handle still
  reports the identity it was written with.
- **Deterministic randomness**: `rand_int(state, exclusiveMax)`, `rand_float(state)`, and
  `rand_float(state, min, max)` derive values from the `uint` state a `draw` produced. They
  are the same arithmetic as `ConjureDB.Frame.DeterministicRandom` (whose `Seed(int)` a host
  uses to set the initial state), so a host and a generated system that walk the stream in
  the same order agree bit for bit. One `draw` yields one state; the draw order is part of
  the system's contract.
- **Manifest**: derived exactly — column modes (physical groups, whole-row singleton and
  event leases), row-domain reads for iterated and probed tables, row-domain writes for
  emitted event tables, structural access for tables a `delete`, `insert`, or `enable`
  changes — and published on the generated `IFrameSystem`, so a host kernel can substitute
  it with the identical manifest. Counted drivers and persistent sources contribute nothing.

The Arena sample declares its whole simulation this way — the two integrators, collision, hit
application, the clock, and the entity lifecycle (`Fire`, `Respawn`, `ResolveRespawns`) — and
reproduces the previous hand-written systems bit for bit (same presentation digest and counters
at 100 k units, and at the denser 2 k / 512-shot and 300 / 2 048-shot configurations). Its only
remaining hand-written system is the presentation sink, which streams positions into host memory
the schema knows nothing about; that is the shape hand-written systems are still for — engine
interop and branching the grammar does not express — ordered against the generated ones as shown
below.

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
    var deaths = _context.DeathEvents.AcquireWriter(in context);  // WriterLease (events)

    foreach (ref readonly var hit in _context.HitEvents.GetChunk(0))
    {
        if (!bodies.TryGetRow(hit.Target, out var body))
            continue;                                              // stale target: skipped, not aliased
        if (!units.TryGetRowMut(hit.Target, out var unit))
            continue;
        unit.Health -= hit.Damage;
        if (unit.Health <= 0)
            deaths.Append(new DeathEvent { Target = hit.Target, X = body.X, Y = body.Y });
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
table fails exactly like a per-record call would. Foreign-scheduler, default and stale
contexts are rejected before a lease is granted.

Use `Commands.AcquireEntityRecorder(in context)` when recording identity-only
`CreateEntity` or entity-wide `DestroyEntity`:
it checks structural access to **every member table of the entity domain** once.
The returned lease supports the same table operations plus `CreateEntity` and
`DestroyEntity`. `CreateEntity` records an identity reservation without a row and
returns a provisional handle for subsequent `CreateFor` commands in the same
coordinated playback window. It requires prepared identity and table-command
capacity; dense identity tables refuse it. Admission failures consume no provisional
handle, sequence, or record. `DestroyEntity` removes all member rows and invalidates
the shared identity at playback. Ordinary `Destroy` removes only the row; a
table-scoped lease cannot call either domain operation, even when the system's
manifest grants domain-wide access.

Acquire only one recorder per table per invocation. If creates and entity-wide
deletes target the same table, select `AcquireEntityRecorder` up front and reuse
that lease; a second acquisition through either method is rejected. Different
member tables still have separate command buffers and may each acquire one lease.
Generated systems select the required scope automatically. Leases remain scoped
to the owning frame invocation; worker jobs produce effect records for owner-thread
publication instead of acquiring or sharing command recorders.

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

`EphemeralEntityLookup` is the **single owner of that encoding** — `PageSizeLog2` / `PageSize` /
`PageMask`, the `AbsentEntry` sentinel, and `Pack` / `GenerationOf` / `SlotOf` / `PageIndexOf` /
`PageOffsetOf`. A hand-inlined mirror should spell the page arithmetic with those members rather
than with its own literals, so a page-geometry change cannot leave the pointer probe and the
managed probe disagreeing.

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

### Logical ordinals over bounded projection outputs

A bounded system output publishes rows and their full source handles in its driver's
capture order. Its `FrameProjectionStamp` proves publication lifetime, **not** that
a projected logical ordinal is unique, in range, or complete. When a consumer needs
ordinal addressing, create a `FrameProjectionOrdinalIndex<T>` once during cold
composition from the output's `Reader`, its scheduler's publication authority,
an exact expected extent, and an explicit typed selector. A static lambda is enough:

```csharp
var byOrdinal = new FrameProjectionOrdinalIndex<PoseRow>(
    output.Reader, scheduler.ProjectionPublicationAuthority, expectedRows,
    static (in PoseRow row) => row.LogicalOrdinal);
```

`Bind(view)` accepts a live `FrameProjectionView<T>` only from that exact output
owner. It checks count, each full nonprovisional source handle, ordinal range,
uniqueness and coverage before returning a checked view indexed by ordinal. The
selector returns `long`; bounds are checked before narrowing to a backing index.
The selector must be stable and pure for a publication. A repeated bind of the
same current stamp reuses the retained map; failed authorized rebinds revoke old
ordinal views. Count and row access recheck both index activation and source
publication. A direct view already published by an earlier system may bind inside
a later UI system's `Run`; external consumers still use the reader's completed
publication-window admission. Disposing the index releases its local backing even
after the source scheduler is disposed.

The index retains only one ordinal-to-source-row `int[]`, with
`RetainedIndexPayloadBytes == expectedRows * sizeof(int)` while live; that property
does not count object/delegate overhead or claim a total-memory saving. The output
buffer retains the actual rows. This utility neither sorts/copies those rows nor
proves cross-table handle domain, liveness, or application-specific relationships.

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
        if (!ctx.Frame.TryGetSystemId(new FrameSystemName("IntegrateBodies"), out var integrateBodies))
            throw new InvalidOperationException("IntegrateBodies is not registered.");
        ctx.Frame.SubstituteImplementation(integrateBodies, new IntegrateBodiesUnityBurstSystem(ctx));
    })
    .Build();
```

`IntegrateBodiesUnityBurstSystem` and its native kernel are compiler output from
the same bound system body as the managed implementation. The generated adapter
owns the exact manifest, borrowed column views, job scheduling and completion;
the host does not copy the computation or its manifest by hand. The Unity sample
also substitutes generated `IntegrateProjectiles`, `Collision` and `Fire`
adapters. Only `BurstPresentationSyncSystem` remains host-authored because its
destination is host-owned presentation memory, not a generated table.

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
  comparing presentation digests between `-arenaKernels managed` and `-arenaKernels burst-presentation`.
- **Exact manifest.** The substitute's manifest is not a superset: `GetEnabledMask` and
  `ChunkCount` are system-scoped reads authorized by the row-domain entry; the column entries
  authorize the frame-scoped chunk accessors.

#### Invocation-local immutable grid storage

`FrameInvocationGridSnapshot<T>` is a runtime owner for generated systems that need a stable
logical-grid read while later rows write the source table. It is **not** a second table, a
presentation projection, or a retained value from an earlier frame. A registered system first
prepares its sealed maximum through `FrameScheduler.PrepareExecutionCapacity()`. A generated owner
using this primitive **must** copy enabled source rows once under its current `Run` or `Capture`
authority, after predecessor publication and before any body write. The runtime verifies current
invocation authority, exact manifest access and complete logical-key coverage; source-row
provenance and source-order placement remain compiler/generated-owner obligations. The manifest
must authorize the source row domain and exact key and value columns; a worker-capture transport
token alone does not authorize the copy.

The owner requires a positive runtime `rows × columns` shape no greater than its sealed
`maximumCells`. Every logical key in that shape must have exactly one **enabled** row. A missing,
duplicate, or out-of-range enabled key rejects the whole capture; disabled rows are invisible.
`AddEnabled(int|uint key, T value)` and `Seal()` enforce this before a readonly view can be
borrowed. `Sample(long row, long column)` returns the captured, same-typed outside value for
coordinates outside the shape and otherwise addresses the copied logical key, never a physical
table slot. The initial value types the compiler intends to expose are `int`, `uint`, `float`,
and `double`; the runtime owner itself accepts unmanaged `T`.

An ordered `Run` with retained snapshot storage implements `IFrameRetainedSystem` without
claiming parallel workers. Scheduled/Unity adapters continue the existing
`IFrameScheduledSystem` lifecycle. Both paths prepare before their first invocation and release
the snapshot after owner work or accepted jobs settle; no-work capture also clears its snapshot.
The scheduler adopts retained owners only after structural `Seal` planning and worker-pool creation;
before that point (including a rejected structural seal), callers still own constructor resources.
Checked managed writers and leases fail after release or invocation failure. Raw unmanaged
worker views have no safe use-after-free detector and must not escape the settled job lifetime.
Disposal invalidates leases and frees the retained backing only after scheduler/adapter settlement.
The capacity report appends `InvocationGridSnapshotBytes` for the value cells and coverage bitmap;
this excludes object headers and pin handles. Every capture still pays one owner-side copy and
bitmap clear, but no per-frame backing allocation. This is the runtime ownership contract;
authored snapshot syntax and compiler admission are separate features.

#### Invocation-local construction workspaces (runtime foundation)

`FrameBooleanWorkspace` and `FrameHandleWorkspace` are closed, managed-only retained owners for
an ordinary ordered `Run`. They are **not** public arrays, tables, immutable grid snapshots, or
worker/native-job views. The generated system is responsible for implementing
`IFrameRetainedSystem`, calling each owner's `PrepareCapacity` during the scheduler's explicit
cold preparation, and enclosing every entered `Scope` in a `finally`/`using` unwind. This runtime
API alone does not make an authored `workspace` clause available; parser, binder, and emitter
admission are separate work.

Each declaration has a stable `FrameWorkspaceSiteId` and a **positive** fixed retained capacity. `BeginScope`
accepts a count from zero through that capacity under the exact registered current `Run` and
returns a checked scope. Each activation clears the active boolean bits to false or the active
handle assignment bits to unfilled, even when the same declaration is re-entered for a later
child row. A handle slot can be written more than once in one activation; a read before its first
write, an out-of-range index, stale scope copy, wrong thread, wrong owner, or revoked invocation
is rejected. Bounds and unfilled-read faults latch rejection for that invocation; `Dispose`/`Abort` unwinds the
scope, and a later invocation may reuse the cold-prepared backing. Activation tokens do not wrap
or silently reopen an older scope. Boolean slots accept ordinary true **and** false writes.

Handle slots carry opaque `EntityHandle` values, including externally captured stale full handles
and provisional handles issued in the coordinated recording window. `EntityHandle` has only
Id+Generation, not a runtime domain or world tag: the workspace therefore **does not** claim to
verify a handle's domain, liveness, or provisional issuer. The compiler must prove typed-domain
and provisional-use restrictions, and existing command playback validates provisional resolution
and target behavior. A child-created provisional may be stored in an enclosing workspace and
read later in the **same invocation**; the workspace alias itself remains lexical. Workspace
storage never publishes handles or rows across invocations.

The scheduler disposes retained owners only after work has settled. `InvocationBooleanWorkspaceBytes`
and `InvocationHandleWorkspaceBytes` capacity rows report per-system, per-site retained payload
bytes, including assignment bits but excluding managed object/array headers. Plain managed
arrays/bitsets are allocated during cold preparation and released by owner disposal; there are
no per-activation allocations, pins, or native pointer lifetimes.

## Events, singletons, and command routes

Appending to an event table is immediate but access-checked inside systems. Singleton
`Value` and `Ref` access is checked against the active system manifest; outside frame
execution, initialization and tooling code may use the same generated APIs on the owning
frame thread.

A command may route one typed event payload into an ephemeral event table. This is
an excerpt: the declared command event and preceding validation live elsewhere in
the owning schema.

```conjure
module Combat {
    command ApplyDamage(sourceId: int, targetId: int, amount: int)
    (kind: local)
    {
        // Persistent transactional statements and validation appear above.
        event DamageApplied into DamageEvent {
            SourceId = @sourceId,
            TargetId = @targetId,
            Amount = @amount
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
- Treat generated `.g.cs` files as compiler output. Change the schema/compiler source and
  regenerate with
  `dotnet run --project ConjureDB.Compiler -- generate <project.csproj>`; use
  `verify` for validation without publication, and run `bash ci/generator-drift-gate.sh`
  after regenerating every affected registered pack. Normal builds do not regenerate.
- Reuse the existing Reactive Query/IVM/materialized-view subsystem; do not implement
  a separate incremental engine inside ephemeral storage. Integration must preserve
  frame ownership, source publication and reset semantics. Ephemeral-source maintenance
  is currently unsupported, not permanently forbidden
  ([current integration limitation](#reactive-integration--current-implementation-limitation)).

## Frame-state digest

`FrameStateDigest` computes one deterministic checksum over the frame-visible state of the
ephemeral tables a context registered — the same value for the same state, whatever worker
count or chunk geometry produced it. It is a caller-invoked operation for assertions and CI
gates, not per-frame work.

```csharp
var digest = FrameStateDigest.Compute(context);   // throws if any table is not covered
Console.WriteLine(digest);                        // 0x1f3c…  (tables: 12, rows: 4096)
```

What the digest covers, per participating table: the table identity; per live chunk the live
row count and the enabled-bitmap bits; per row the slot identity (the `slot -> id` word a handle
resolves to); and every declared column value in declaration order. What it deliberately does
not cover: chunk capacity, pooled or retired chunks, free-id ordering, indexes and other derived
structures, publish buffers, scheduler and lease bookkeeping, telemetry, and persistent tables —
none of which can differ between two equal states.

Two digests are comparable when they come from the same build and report the same coverage.
Equal values mean the covered state is equal; a different value proves divergence. It is a
checksum for regression and determinism evidence, not a cryptographic commitment.

**Coverage is explicit, never silent.** A table whose columns are not folded (today: nullable
columns, text, decimal, date/time, `Guid`, binary, fixed-point and nominal value types), a table
shape that is not chunked rows (singletons, streams), or a table whose rows an engine host owns — a
table bound to host-provided row memory, whose frame-visible rows live in memory the table never
allocates, reads or writes, so folding would report something that is not the frame's state, and
which therefore participates again as soon as the binding is released — refuses:

- `FrameStateDigest.Compute(context)` throws `FrameStateDigestUnsupportedException` naming the
  tables, so a CI gate can never pass on a digest that quietly omitted state.
- `FrameStateDigest.ComputePartial(context)` folds the covered tables and reports the rest through
  `FrameStateDigestResult.UnsupportedTables`, for callers that compare like-for-like coverage.

Typical CI use:

```csharp
var before = FrameStateDigest.Compute(context);
RunFrameWorkload(context, workers: 8);
var after = FrameStateDigest.Compute(context);
Assert.Equal(expectedDigest, after.Value);        // same build, any worker count
```

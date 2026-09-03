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

**See also:** [Schema Language](/docs/schema/schema-language) · [Compiled Queries](/docs/query-language/compiled-queries) · [Arena example](/docs/examples/arena-ecs) · [Reactive Queries](/docs/advanced/reactive-queries)

---

## The three ephemeral kinds

```prql
// Design data: persistent, indexed, transactional — as usual.
table UnitTemplate(plural: UnitTemplates, persistence: none, capacity: 64, type_id: 9001) {
    Id: int @id
    Tier: int @index(name: "UnitTemplate_Tier_Lookup", kind: lookup)
    MaxHealth: int
    Speed: float
}

// Frame state: chunked struct-of-arrays storage, generational handles, no persistence.
ephemeral table Unit(plural: Units, capacity: 100000) {
    Id: int @id
    TemplateId: int @relation(references: UnitTemplate.Id)
    Health: int
}

ephemeral table Body(plural: Bodies, capacity: 100000) {
    Id: int @id
    X: float
    Y: float
    Vx: float
    Vy: float
    ViewSlot: int
}

// One-frame messages: appended this frame, readable next frame, gone the frame after.
event table HitEvent(plural: HitEvents, capacity: 4096, lifetime: next_frame) {
    ProjectileId: int
    TargetId: int
    TargetGeneration: uint
    Damage: int
}

// Exactly one row, field-cost access.
singleton table ArenaClock {
    Tick: long
    FixedDt: float
}

// Unit and Body share one identity: a Body row with id 42 is the same entity as Unit 42.
entity domain Actors { Unit, Body }
```

| Kind | What it is | Identity | Lifetime |
|---|---|---|---|
| `ephemeral table` | Chunked SoA columns, enabled bitmap, direct id lookup | `EntityHandle { Id, Generation }` | until destroyed |
| `event table` | Append-only message stream | none | cleared at `FrameEnd` (`frame`) or double-buffered across one frame (`next_frame`) |
| `singleton table` | One row of frame-global state | none | process session |

Columns must be pointer-free (numbers, enums, blittable structs, nullables). Strings, lists
and persistence options are rejected at compile time with typed diagnostics (`UMEP001`…`UMEP015`).

### Why "table is archetype"

An ECS stores components in archetypes and pays to migrate an entity whenever its component
set changes. A ConjureDB schema is static: a table *is* its archetype, forever. Composition is
expressed as rows in other tables of the same `entity domain`, joined by id. Adding a
"component" to an entity is `Bodies.CreateFor(handle, …)`; removing it is a destroy on that
table. No migration, and the "which tables match this query" list is a compile-time constant
in the generated code.

---

## Systems: declared or hand-written

The bulk arithmetic goes into a `system` declaration. The compiler turns it into one fused
chunk kernel with an exact access manifest; direct `float` columns take the SIMD lane
automatically:

```prql
system IntegrateBodies(phase: fixed_update) {
    update Body b
    | set b.X += b.Vx * @dt,
          b.Y += b.Vy * @dt
}
```

Gameplay that probes, branches, and emits is declarative too. A system body is a driver
followed by ordered clauses — clause order is execution order per row — so the collision
pass of the Arena sample reads like the loop it replaces, and the compiler derives the
manifest, the hit flags, the deferred destroys, and the event appends:

```prql
system Collision(phase: fixed_update, before: [IntegrateBodies, IntegrateProjectiles]) {
    from Projectile p
    | join Body b on handle (p.TargetId, p.TargetGeneration)        // generation-checked probe
    | match {
        miss b => set ArenaCounter.ProjectilesLostTarget += 1  destroy p   // stale target, never aliased
        (b.X - p.X) * (b.X - p.X) + (b.Y - p.Y) * (b.Y - p.Y) <= ArenaSetting.HitRadiusSquared =>
            emit HitEvent { ProjectileId: p.Id, TargetId: p.TargetId, TargetGeneration: p.TargetGeneration, Damage: p.Damage }
            destroy p                                                  // recorded now, applied at the phase boundary
        p.TtlTicks <= 0 => set ArenaCounter.ProjectilesExpired += 1  destroy p
      }
}

system ApplyHits(phase: frame_start) {
    from HitEvent h                                                   // event driver: last frame's front buffer
    | join Unit u on handle (h.TargetId, h.TargetGeneration)
    | filter u.Health > 0
    | set u.Health -= h.Damage, ArenaCounter.Hits += 1               // joined-alias write, singleton counter
    | join Body b (u.Id == b.Id)
    | match { u.Health <= 0 => emit DeadSlot { Slot: b.ViewSlot }  destroy entity u }
}
```

`join … (a.Id == b.Id)` is the same-domain id join; `join … on handle (id, generation)`
probes any ephemeral table by generational handle. A miss skips the row unless a later
`match` names it in a `miss` arm, in which case the join publishes a hit flag and the arm
runs on the miss branch. `set` blocks are simultaneous (all right-hand sides, then all
stores); `match` runs the first arm whose selector holds; singleton tables are in scope by
name. Everything a hand-written system would have to declare — column modes, row-domain
reads and writes, structural access — is derived and published on the generated
`IFrameSystem`, so a host kernel can still stand in for it with the identical manifest.

What stays hand-written is what the grammar does not express: the random-number consumer
that fires shots, roster bookkeeping, and the presentation sink. Such a system declares the
exact columns it touches; the scheduler validates conflicts between unordered systems when
the schedule is sealed and refuses to guess an order:

```csharp
sealed class FireSystem : IFrameSystem
{
    static readonly SystemAccessManifest Manifest = new(
        columns: [ SystemColumnAccess.Read(BodiesSet.FrameTableId, (int)BodiesSet.Column.X), /* … */ ],
        rowDomains: [ SystemRowDomainAccess.Read(BodiesSet.FrameTableId) ],
        structuralTables: [ ProjectilesSet.FrameTableId ]);

    public SystemAccessManifest Access => Manifest;

    public void Run(in FrameContext context)
    {
        var bodies      = _db.Bodies.AcquireRowRead(in context);            // authorize once per invocation
        var projectiles = _db.Projectiles.Commands.AcquireRecorder(in context);
        ref var counters = ref _db.ArenaCounters.Ref;                        // singleton, whole-row lease

        for (var shot = 0; shot < _config.ShotsPerTick; shot++)
        {
            var shooter = _roster[_rng.NextInt(_roster.SlotCount)];
            var target  = _roster[_rng.NextInt(_roster.SlotCount)];
            if (!bodies.TryGetRow(shooter, out var from) || !bodies.TryGetRow(target, out var to)) continue;
            projectiles.Create(new Projectile { TargetId = target.Id, TargetGeneration = target.Generation, /* … */ });
            counters.ProjectilesFired++;
        }
    }
}
```

Structural changes inside a system always go through the table's command buffer
(`Commands.Create`, `CreateFor`, `Destroy`, `DestroyEntity`, `SetEnabled`) and are played
back at the next phase boundary in recorded order; a buffered `Create` returns a provisional
handle you can pass to later commands in the same window and resolve after the boundary.

---

## Frame lifecycle

```csharp
context.Frame.Pump(deltaTimeSeconds);          // .NET hosts: FrameStart → FixedUpdate×N → Update → LateUpdate → FrameEnd
ConjureDBPlayerLoop.Install(context);          // Unity: injected into the PlayerLoop, Unity owns the fixed-step accumulator
```

A host can also stand its own kernel in for a schema-declared system before the schedule
seals — `ConfigureFrameRuntime` on the builder plus `Frame.SubstituteImplementation` — as long as
the substitute declares the identical access manifest. That is how the Arena sample runs Burst
job graphs in the `IntegrateBodies` and `ArenaPresentationSync` slots in Unity without the domain
assembly referencing Unity; chunk memory is pin-stable, so a job graph works on the table's own
arrays and completes once per system
([details](../examples/arena-ecs.md#unity-mono-il2cpp-and-burst)).

There is no transaction and no rollback for frame state: mutation is immediately visible on
the frame thread and the *schedule* is the consistency boundary. A `next_frame` event
appended during frame N is readable during frame N+1 by every phase, which makes
"produce anywhere, consume next frame" work regardless of where the producer runs.

---

## Queries over live state, and across the boundary

Every query shape you already use compiles over ephemeral tables: filtered scans, direct id
lookups, cardinality-only counts, bounded Top-N, grouped aggregation, set operations, and the
zero-heap `ForEach` / `NoAlloc` variants. The planner admits exactly two access paths for an
ephemeral source — chunk scan and direct lookup — and selects the persistent index when the
join crosses the boundary:

```prql
// UI at frame rate: the ten most damaged units, without allocating.
query GetWeakestUnits(k: int) -> extern IEnumerable<(int Id, int Health)> {
    from Unit u | sort u.Health, u.Id | take @k | select u.Id, u.Health
}

// Which shots are aimed at a boss? Live projectile → live unit → persistent template.
query CountProjectilesAimedAtTier(tier: int) -> long {
    from Projectile p
    | join Unit u (p.TargetId == u.Id)
    | join UnitTemplate t (u.TemplateId == t.Id)
    | filter t.Tier == @tier
    | aggregate { Cnt = count(*) }
}

// Damage dealt per target during the last frame, straight off the event stream.
query GetHitTotalsByTarget() -> extern IEnumerable<(int TargetId, long Total)> {
    from HitEvent h | group h.TargetId (aggregate { Total = sum(h.Damage) }) | select h.TargetId, Total
}
```

The strategic case is selective: "projectiles targeting boss-flagged NPCs" resolves through
the persistent `lookup` index into a bitmap semi-join and a handful of O(1) probes into the
ephemeral sparse map instead of a 100 k-row scan — measured at **575× a full scan at 0.2 %
selectivity** on the reference host. No ECS has an optimizer to make that choice for you.

### Dangling ids, by design

A compiled join on a raw `int` id is generation-agnostic: after an id is destroyed and
recycled, the join resolves the *current* holder. That is deliberate (one sparse-map read,
no generation carried). When aliasing matters — a projectile's target, a UI selection —
store `EntityHandle` (or id + generation as two columns, as `HitEvent` does) and probe with
`TryGetRow`, which fails closed on a stale handle.

---

## What is deliberately not there

- **No reactive queries or materialized views over ephemeral tables.** Frame state changes
  wholesale every tick; incremental maintenance would cost more than the recompute. Run a
  compiled query at frame rate, or publish a typed summary into a persistent table and make
  *that* reactive.
- **No change detection**, no MVCC, no rollback, no persistence, no secondary indexes on
  ephemeral tables (join to a persistent table that owns the index instead).
- **No parallel system execution** — scheduling is serial and deterministic; ordering is
  explicit and never inferred from access manifests.

The complete capability matrix, every diagnostic code and every refusal is in the
[reference page](/docs/reference/ephemeral-tables-reference).

---

## Performance, honestly

Reference host: Apple M4 Max, .NET 8, single thread. Ephemeral-table release proof
(2026-07-31, BenchmarkDotNet):

| Workload | Result |
|---|---|
| Iterate + mutate 3 components, 100 k rows | 98 µs (hand-written SoA: 92 µs) |
| Generated frame pump, 100 k dense, 4 assignments | 236 µs · SIMD lane 2.8× over scalar |
| Create with values | 23 ns / entity |
| Steady-state frame loop | 0 B / frame over 240 frames |
| Compiled filtered `count(*)` vs hand-written | 5.2× (vector lane) |
| Selective probe vs full scan, 0.2 % / 1 % | 575× / 101× |
| Bitmap semi/anti join vs generic hash join | 4.8–6.2× |

The [Arena example](/docs/examples/arena-ecs) runs a whole ECS-style frame — 100 k units,
23 k live projectiles, collisions, hits, deaths, respawns — in **p50 452 µs / p99 694 µs**
with 0 B allocated inside every system, against a hand-rolled struct-of-arrays ECS of the
same simulation at p50 336 µs / p99 1 910 µs, producing bit-identical results.

Where an ECS still wins: hand-vectorized engines (Friflo, Frent) iterate three components in
8–20 µs; multi-threaded system execution; and bullet-hell spawn storms — command-buffer
playback costs ~150–200 ns per recorded create. Those are the documented, accepted trades.

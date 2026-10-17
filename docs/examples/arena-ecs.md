# Arena: an ECS-style game loop (100 k units)

The sample everybody writes to evaluate an ECS: units move, fire projectiles at each other,
projectiles hit or expire, units die and respawn — every tick, for a hundred thousand
entities. Here it is on ephemeral tables, next to the same simulation hand-written as a
struct-of-arrays ECS, driven by one RNG stream and cross-checked for identical results.

Source: `ConjureDB.Samples.EcsDemo` in the repository (domain, headless runner, Unity host).

## Schema (excerpt)

```conjure
entity domain Actors { Unit, Body }
entity domain Shots  { Projectile }

ephemeral table Projectile(plural: Projectiles, capacity: 16384) {
    Id: int @id
    Target: ref Body           // generational handle — never hits a recycled id
    X: float
    Y: float
    Vx: float
    Vy: float
    Damage: int
    TtlTicks: int
}

event table HitEvent(capacity: 4096, lifetime: next_frame) {
    Target: ref Unit
    Damage: int
}

system IntegrateProjectiles(phase: fixed_update) {
    from Projectile p
    | set { p.X += p.Vx * @dt, p.Y += p.Vy * @dt, p.TtlTicks -= 1 }
}
```

## The frame

| Phase | System | What it does |
|---|---|---|
| FrameStart | ResolveRespawns | turns last frame's provisional spawn handles into real ones |
| FrameStart | `ApplyHits` (schema-declared) | drives the `HitEvent` front buffer, `join Unit u on ref (h.Target)`, `set { u.Health -= h.Damage }`, `match { u.Health <= 0 => { event DeadSlot …  delete entity u } }` |
| FixedUpdate | Fire | 256 random shots per tick: a counted `from generate(…)` driver, two `lookup … on id` probes, one `insert Projectile` |
| FixedUpdate | `Collision` (schema-declared) | `join Body b on ref (p.Target)` then one `match` arm per projectile: miss → lost target, in radius → `event HitEvent` + `delete p`, ttl → expired |
| FixedUpdate | `IntegrateBodies`, `IntegrateProjectiles` | schema-declared kernels |
| Update | `Clock` (schema-declared) | `from ArenaClock c \| set { c.Tick += 1, c.FixedDt = @fixed_dt }` |
| LateUpdate | PresentationSync | streams positions into the slot-indexed presentation buffer (a `TransformAccessArray` in Unity) |
| FrameEnd | Respawn | refills dead slots through the command buffers; resolves next frame |

The scheduler refuses to seal if two unordered systems overlap. `Collision` orders itself
in the schema (`before: [IntegrateBodies, IntegrateProjectiles]`); the hand-written `Fire`
slots in front of it from the `OnFrameRuntimeRegistered` hook. Five of the nine systems are
now schema declarations; the four that stay hand-written are the random-number consumer
(`Fire`), the roster bookkeeping (`ResolveRespawns`, `Respawn`), and the presentation sink.

## Numbers

Apple M4 Max, .NET 8.0.11, single thread, 120 warm-up + 600 measured frames, 100 000 units,
256 shots per tick, ~23 000 live projectiles.

| engine | p50 | p99 | mean | allocations |
|---|---:|---:|---:|---|
| ConjureDB ephemeral tables | 452 µs | 694 µs | 459 µs | 0 B in every system; ~6 KB/frame of scheduler growth spikes |
| hand-written SoA ECS | 336 µs | 1 910 µs | 424 µs | 0 B |

Both engines report the same presentation digest, the same 2 118 hits and the same deaths.

Per system, ConjureDB:

| system | mean µs |
|---|---:|
| Collision (23 k target probes) | 151 |
| IntegrateBodies (100 k rows) | 97 |
| PresentationSync (100 k rows) | 63 |
| Fire (256 shots) | 45 |
| IntegrateProjectiles (23 k rows) | 35 |
| ApplyHits | 1.4 |

Frame-rate queries a UI would run between two pumps, at 100 k units:

| query | µs | bytes |
|---|---:|---:|
| `CountUnits()` (cardinality only) | 5 | 0 |
| `GetWeakestUnits(10)` ForEach (bounded Top-N) | 165 | 0 |
| `GetBodiesInBox(±50)` ForEach (filtered scan) | 377 | 0 |
| `GetHitTotalsByTarget()` (grouped aggregate over the event stream) | 5 | 6.7 K |

## Unity: Mono, IL2CPP and Burst

The same domain assembly (its `netstandard2.1` build) runs in a Unity 6000.7.0a2 player with the
scheduler injected into the PlayerLoop. The bootstrap paces the player with `Time.captureDeltaTime`
so every frame carries exactly one fixed tick, like the headless runner, and reads the completed
frame's report from `LateUpdate`. Same machine, 120 warm-up + 600 measured frames:

| host | units | kernels | frame p50 | IntegrateBodies | PresentationSync |
|---|---:|---|---:|---:|---:|
| .NET 8 headless | 100 k | generated scalar | 497 µs | 98 µs | 63 µs |
| Unity IL2CPP | 100 k | generated scalar | 484 µs | 61 µs | 81 µs |
| Unity IL2CPP | 100 k | Burst job graphs for both streaming systems | **436 µs** | 35 µs | 34 µs |
| Unity IL2CPP | 1 M | generated scalar | 2 088 µs | 618 µs | 822 µs |
| Unity IL2CPP | 1 M | Burst job graphs for both streaming systems | **1 003 µs** | 163 µs | 155 µs |
| Unity Mono | 100 k | generated scalar | 2 061 µs | 259 µs | 260 µs |
| Unity Mono | 100 k | Burst, inline | 1 856 µs | 70 µs | 261 µs |

Every mode reproduces the managed run's presentation digest and simulation counters; the Burst
kernels are bit-identical to the generated scalar oracle.

The Burst kernels are host-side `IFrameSystem`s that declare the same manifest the compiler derived
for the declared systems and are installed before sealing:

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

Inside `Run`, a system takes each chunk's column spans through the frame-scoped accessors, turns
them into pointers with `EphemeralChunkMemory.PointerOf` (chunk memory is pin-stable for the
table's lifetime), schedules one `[BurstCompile]` job per chunk over the table's own memory with
the storage's enabled bitmap as the mask, and completes the combined handle once before returning.

What it taught us:

- **IL2CPP alone closes the gap.** The IL2CPP player runs the frame at .NET 8 speed, and its
  C++-compiled generated kernel is as fast as a Burst kernel run inline.
- **One completion per system is what makes jobs pay.** The first attempt pinned each chunk with
  `fixed` and completed each chunk's job in its own scope: 179 µs for a 61 µs kernel. The same
  job as one graph: 35 µs.
- **Streaming kernels are bandwidth-bound.** At 1 M rows the graphs deliver 3.8× and 5.1× on
  15 workers because the loops move ~200 GB/s; the frame halves because those two systems are
  two thirds of it. At 100 k the frame gains 10–12 %: collision, half the frame, is serial by
  design (generation-checked probes into another table, event appends).
- **Burst codegen is the Mono escape hatch** (3.7× on the kernel there), not an IL2CPP one.

Full steps, logs and the research notes: the `ConjureDB.Samples.EcsDemo.Unity` sample in the repository.

## DOTS baseline

The same simulation ported to Unity Entities 1.4.8 (`ISystem`s, Burst `IJobEntity` jobs and a
Burst-compiled fire system, an `EntityCommandBuffer` per tick, `NativeQueue` hit events, `Entity`
references as generation-checked targets), driven in the same phase order on the same IL2CPP host,
Burst execution verified by a probe. Same RNG draw order, same presentation digest.

| units | engine | frame p50 | Fire | Collision | IntegrateBodies | PresentationSync |
|---:|---|---:|---:|---:|---:|---:|
| 100 k | DOTS, parallel collision job | **190 µs** | 16 µs | 53 µs | 31 µs | 38 µs |
| 100 k | DOTS, serial collision job | 430 µs | 21 µs | 280 µs | — | 42 µs |
| 100 k | ConjureDB, generated kernels | 484–506 µs | 37–41 µs | 229–245 µs | 61 µs | 81 µs |
| 100 k | ConjureDB, Burst job graphs | **423–436 µs** | 37 µs | 244 µs | 35 µs | 33–34 µs |
| 1 M | DOTS, parallel collision job | **491–513 µs** | 40–43 µs | 73–78 µs | — | 180–187 µs |
| 1 M | ConjureDB, Burst job graphs | **985–1 031 µs** | 79 µs | 494–503 µs | 158–177 µs | 153–169 µs |

Two facts. The storage kernels are at parity: integration, projectile integration and
presentation cost the same in both designs, and ConjureDB's serial collision pass is faster than
the equivalent serial Burst job. The 2× that Entities kept on the frame was three measurable items
on the ConjureDB side — the collision probe as a parallel job, per-record command authorization,
and boundary playback — and they were closed the same day:

| units | engine | frame p50 | Fire | Collision | boundary |
|---:|---|---:|---:|---:|---:|
| 100 k | ConjureDB, generated kernels, before | 484–506 µs | 37–41 µs | 229–245 µs | ≈60 µs |
| 100 k | ConjureDB, generated kernels, after | 394 µs | 12 µs | 204 µs | ≈20 µs |
| 100 k | **ConjureDB, job graphs + Burst collision** | **171 µs** | 15 µs | **43 µs** | ≈20 µs |
| 100 k | DOTS baseline | 190 µs | 16 µs | 53 µs | 36 µs |
| 1 M | ConjureDB, generated kernels, after | 1 804 µs | 37 µs | 322 µs | ≈20 µs |
| 1 M | **ConjureDB, job graphs + Burst collision** | **453 µs** | 42 µs | **62 µs** | ≈20 µs |
| 1 M | DOTS baseline | 491–513 µs | 40–43 µs | 73–78 µs | 195–204 µs |

What changed: `Commands.AcquireRecorder` authorizes a system's structural records once (the
recording counterpart of the row leases), boundary playback guards each table once and replays
runs of creates as one bulk append, and `AcquireEntityLookup` hands a host job the table's
pin-stable id→row pages so the collision probe runs on worker threads while the frame thread
drains its outcomes in serial order. Same digests, 0 B/frame.

## What the sample taught us

Building it surfaced the sharp edges you would hit too, and they are fixed in the runtime
rather than worked around in the sample: per-call manifest checks on `TryGetRow` were
17× the storage cost of the probe (hence the row leases), a spawn recorded at `FrameEnd`
could not be resolved at `FrameStart` (resolutions now survive empty boundaries), and
hand-written systems had no way to order themselves against generated kernels (hence the
`OnFrameRuntimeRegistered` hook). The remaining accepted losses are the ones every
schema-first engine has: a hand-vectorized ECS iterates faster, and spawn storms pay for
command-buffer playback.

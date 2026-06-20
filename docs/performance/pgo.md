# Profile-Guided Optimization (PGO)

ConjureDB supports Profile-Guided Optimization: the runtime collects
query-execution statistics during development or testing, exports them as a
JSON profile, and the compiler uses that profile to make better code-generation
decisions — choosing optimal strategies for joins, aggregations, sorting,
buffer sizing, and operator fusion.

PGO evidence can be collected locally or through a backend-assisted telemetry
path. In the deeper optimization model, `ConjureDB.GameBackend.*` acts as the
authoritative collection and normalization layer for workload evidence; the
compiler remains the system that turns approved statistics into optimization
decisions.

Without PGO the compiler relies on reasonable heuristic defaults. With PGO,
every decision is backed by observed data, producing code that is measurably
faster for the profiled workload.

**See also:** [Transactions](/docs/engine/transactions) · [Persistence](/docs/engine/persistence) · [Query Language](/docs/query-language/reference)

---

## Why PGO?

PGO follows the same two-phase pattern used by LLVM PGO, .NET Dynamic PGO,
and PostgreSQL's `pg_stat_statements`:

```
  1. INSTRUMENT        2. COLLECT           3. EXPORT        4. REBUILD

  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐  ┌──────────────┐
  │ PgoMode =    │───>│ Run workload │───>│ Export JSON  │─>│ PgoMode =    │
  │ Collect      │    │ (real game   │    │ profile      │  │ Use          │
  │              │    │  sessions)   │    │              │  │              │
  └──────────────┘    └──────────────┘    └──────────────┘  └──────────────┘
```

PGO data helps the compiler choose better strategies for joins, aggregations,
sorting, buffer pre-allocation, and operator fusion — without requiring you to
understand compiler internals. You provide data; the compiler makes decisions.

For small projects, one local profile is often enough. For larger games, the
same loop can be fed by backend-collected fleet telemetry so deep optimization
is based on representative workload evidence rather than a single device run.

---

## How to Collect

### Step 1: Enable Profile Collection

Add the `[PgoMode]` attribute at assembly or DbContext level:

```csharp
// Assembly-level (instruments all queries)
[assembly: PgoMode(PgoMode.Collect, "./profiles/game.json")]

// Per-context (instruments one context)
[PgoMode(PgoMode.Collect, "./profiles/game.json")]
public class GameDbContext : DbContext { ... }
```

### Step 2: Run a Representative Workload

Execute realistic gameplay or test scenarios. The runtime automatically
collects statistics about operator timings, row counts, join cardinalities,
filter selectivities, and key ranges. All collection is thread-safe.

In production builds, use `NullQueryProfiler` — a no-op implementation that
guarantees zero runtime overhead while keeping instrumentation call-sites in
generated code.

### Backend-Assisted Collection

For larger deployments, telemetry collection does not have to stay device-local.
Companies using `ConjureDB.GameBackend.*` as the foundation for their own backend
can ingest operator telemetry, cardinality evidence, and profile provenance from
clients, test shards, or authoritative replay, normalize that data, and
materialize approved profile artifacts for the compiler.

The backend is part of the PGO feedback loop, not a separate optimization
engine. Strategy selection and deep optimization stay compiler-owned.

---

## How to Export

```csharp
var exporter = new ProfileDataExporter(
    context.Profiler,
    context.IndexCollector,
    context.JoinCollector,
    context.PackedKeyCollector);
exporter.Export("./profiles/game.json");
```

Or via CLI:

```bash
dotnet run --project ConjureDB.CodeGen.Manual --pgo --profile=./profiles/game.json
```

---

## How to Apply

Switch to `PgoMode.Use` and rebuild:

```csharp
[assembly: PgoMode(PgoMode.Use, "./profiles/game.json")]
```

```bash
dotnet build -c Release
```

For manual schema generation, use the committed profile without `--pgo` when producing a release/perf artifact:

```bash
dotnet run --project ConjureDB.CodeGen.Manual --profile=./profiles/game.json
```

`--pgo` is the collect/instrumentation mode and emits runtime timing hooks; profile-use builds should consume the profile while keeping generated query methods instrumentation-free.

The compiler reads the profile and uses it to drive all optimization decisions.

### PgoMode Values

| Mode | Behavior |
|------|----------|
| `None` | No profiling or profile usage (default) |
| `Collect` | Runtime records statistics during execution |
| `Use` | Compiler reads the exported profile and drives planning/code-generation |

---

## Profile Format

The exporter writes a single JSON file:

```json
{
  "version": 4,
  "profileId": "profile.default",
  "lifecycleState": "approved",
  "generatedAt": "2026-03-20T10:30:00Z",
  "schemaHash": "a3f1c7...  (SHA-256)",
  "coverage": 0.93,
  "stabilityScore": 0.91,
  "tables": {
    "Players": { "columns": ["Id", "Name", "GuildId", "Level"] }
  },
  "queries": {
    "GetTopPlayers": {
      "invocations": 14200,
      "averageTicks": 4820,
      "averageResultCount": 42,
      "minKey": 1,
      "maxKey": 9847
    }
  },
  "autoIndexCandidates": [
    {
      "stableId": "Players|Lookup|GuildId",
      "tableName": "Players",
      "kind": "lookup",
      "keys": ["GuildId"],
      "includedColumns": ["Id", "Name"],
      "recommendationTier": "recommended",
      "overlapGroupKey": "Players|lookup|GuildId",
      "writePenalty": 1.5,
      "memoryPenalty": 128.0,
      "buildPenalty": 24.0,
      "netBenefit": 12.5,
      "status": "generated",
      "evidence": {
        "profileCoverage": 0.93,
        "sampleCount": 500,
        "readWriteRatio": 8.0,
        "confidence": 0.88,
        "originQueryIds": ["GetTopPlayers"]
      },
      "whatIfDelta": {
        "supported": true,
        "baselineCost": 41.0,
        "candidateCost": 17.5,
        "benefit": 23.5,
        "selectedOperatorType": "LookupSeekNode"
      },
      "reasonCodes": [
        "candidate_generated",
        "candidate_what_if_improved"
      ]
    }
  ],
  "recommendedSet": ["Players|Lookup|GuildId"],
  "heldBackSet": [],
  "suppressedSet": [],
  "budgetSummary": {
    "maxRecommendedCandidates": 8,
    "maxRecommendedPerTable": 2,
    "maxWritePenaltyBudget": 25.0,
    "maxMemoryPenaltyBudget": 2048.0,
    "consumedWritePenalty": 1.5,
    "consumedMemoryPenalty": 128.0
  },
  "joinStats": {
    "Players-Guilds": {
      "usageCount": 8400,
      "joinSelectivity": 0.0001,
      "matchRatio": 1.0,
      "maxFkValue": 512,
      "recommendedStrategy": "index"
    }
  },
  "groupedIndexProfiles": {
    "Items.PlayerId.Level": {
      "recommendedType": "GroupedSorted",
      "isWriteHeavy": false,
      "isTopNDominant": true,
      "maxGroupSize": 84
    }
  }
}
```

Owner decisions are stored separately from the canonical profile in the
workspace-local manifest `.conjuredb/auto-index.decisions.json`.

### Schema Hash

The `SchemaHash` is a SHA-256 digest computed over sorted
`{tableName}.{columnName}` pairs. The compiler emits a warning when the current
schema hash does not match the profile, indicating staleness.

---

## Profile Lifecycle

Profiles follow a lifecycle with quality-based promotion:

```
  ┌─────────┐    quality met     ┌───────────┐    quality met     ┌──────────┐
  │  DRAFT  │───────────────────>│ CANDIDATE │───────────────────>│ APPROVED │
  └─────────┘                    └───────────┘                    └──────────┘
       │                                                               │
       │ stale                                                    stale│
       v                                                               v
  ┌─────────┐                                                    ┌──────────┐
  │ EXPIRED │                                                    │ EXPIRED  │
  └─────────┘                                                    └──────────┘
```

| State | Optimizations Enabled |
|-------|-----------------------|
| `Draft` | Heuristic fallback only |
| `Candidate` | All PGO optimizations (if quality thresholds met) |
| `Approved` | All PGO optimizations |
| `Expired` | Heuristic fallback only |

The compiler validates profile quality automatically. Low-quality profiles
(insufficient coverage, low stability, or high outlier rate) are rejected with
diagnostic warnings such as `pgo.profile.rejected.low_coverage`. When a profile
is untrusted, the compiler falls back to heuristic defaults.

---

## What PGO Optimizes

PGO data helps the compiler choose better strategies for joins, aggregations,
sorting, and buffer sizing. Here is a summary of what improves:

| Decision | Without PGO (heuristic) | With PGO |
|----------|------------------------|----------|
| Aggregation strategy | Hash (general purpose) | DenseArray when key range is small |
| Fused aggregate + TopN | Disabled (unknown key range) | DenseHeap when key range confirmed |
| TopN implementation | Runtime branching | Stack-allocated heap (zero GC pressure) |
| Output buffer capacity | Fixed default | Pre-allocated to actual average result count |
| Join strategy | Heuristic guess | Observed selectivity → optimal index/hash/nested-loop |
| Join order | Left-to-right | Selectivity-ordered (most selective first) |
| Sort operator | Always emitted | Eliminated when pre-sorted confirmed |
| Packed-key width | Conservative `ulong` | Narrowest type fitting observed range |
| Index guidance | Declared/manual indexes only | Profile-driven report-only auto-index advisory with what-if planning; no schema mutation, no runtime/codegen materialization, and no proof of globally optimal index discovery |
| Reactive buffer sizing | Default capacities | PGO-observed container peaks |

---

## Safe Auto-Index Advisor

PGO can drive a planning-owned **safe auto-index advisor**. This path is
explicitly report-only and is meant to help you decide which indexes should be
declared in the schema.

- Enable it with `CompilerOptions.AutoIndexing.Mode = ReportOnly`.
- The planner only treats advisory evidence as actionable when the profile
  lifecycle and quality thresholds are trusted.
- Candidates are normalized into `PgoProfile.AutoIndexCandidates`.
- Each candidate is evaluated with one-index hypothetical planning, so the
  report captures marginal benefit rather than mutating the real schema.
- The compiler assigns each candidate a deterministic recommendation tier:
  `Recommended`, `HeldBack`, or `Suppressed`.
- Tier selection is budgeted and deterministic: global/per-table limits plus
  write and memory budgets decide which candidates are promoted into the
  recommended set.
- The compiler writes a derived `auto-index-report.json` and exposes the same
  summary through `PlanExplain.AutoIndexAdvisory`.

What this mode does **not** do:

- It does not create persistent indexes.
- It does not mutate the schema passed to the compiler.
- It does not change the executable selected physical plan.
- It does not route advisory candidates into code generation or runtime
  materialization.

Supported candidate families include lookup, unique, sorted/range,
grouped-sorted, covering/composite, partial, and aggregation indexes. If the
profile is untrusted or below thresholds, candidates are retained for
observability but marked `insufficientEvidence`.

Typical host-side configuration:

```csharp
var options = CompilerOptions.CreateDefault(schema) with
{
    AutoIndexing = new AutoIndexingOptions
    {
        Mode = AutoIndexingMode.ReportOnly,
        UseWhatIfPlanning = true,
        MinProfileCoverage = 0.60,
        MinSampleCount = 10,
        MinReadWriteRatio = 2.0,
        MinNetBenefit = 5.0,
        MaxRecommendedCandidates = 8,
        MaxRecommendedPerTable = 2,
        MaxWritePenaltyBudget = 25.0,
        MaxMemoryPenaltyBudget = 2048.0
    }
};
```

Use this mode to guide explicit schema evolution. It is a governed advisory
loop, not an automatic physical-design mutator.

### CLI-first review loop

V2 adds a host-owned workflow in `ConjureDB.Profiling`:

```bash
dotnet run --project ConjureDB.Profiling -- auto-index analyze --profile ./profiles/game.json
dotnet run --project ConjureDB.Profiling -- auto-index show --profile ./profiles/game.json --candidate 1
dotnet run --project ConjureDB.Profiling -- auto-index patch --profile ./profiles/game.json --candidate 1 --surface csharp
dotnet run --project ConjureDB.Profiling -- auto-index decide --profile ./profiles/game.json --candidate 1 --decision accepted --surface csharp --target-file ./Game/Player.cs
```

This workflow is still report-only in compiler core:

- `analyze` ranks `recommended`, `held-back`, then `suppressed` candidates.
- `show` prints evidence, what-if delta, overlap group, and blocked reasons.
- `patch` produces a diff preview for `csharp` or `schema` surface; it does not
  edit tracked source files.
- `decide` records an owner decision in `.conjuredb/auto-index.decisions.json`
  so accepted/suppressed candidates stop polluting future review output.

---

## Canonical indexed proof workloads

The repository now keeps the canonical “indexes already exist, PGO still helps”
selection in `ConjureDB.Compiler.SnapshotTests/Infrastructure/PgoIndexedProofWorkloads.cs`.
These workloads are intentionally index-backed from the start, so a future proof
run must demonstrate planning or codegen gains rather than a missing-index save.

| Workload | Manual indexes already present | What PGO must prove |
|----------|-------------------------------|---------------------|
| `q07-complex-join` (`GetTopSpenders`) | `Orders_Completed_Player_Amount_UniversalAggregation` + `Players` PK | Join specialization after the indexed pre-aggregation already exists: tighter dense-PK join sizing, better build/probe contract, cheaper generated join code |
| `q08-exists-semi-join` (`GetPlayersWithHighValueOrders`) | `Orders_Player_Amount_RangeLookup` + `Players_Level_Sorted` | Selectivity-driven semi-join mode selection (`ProbeDrivenExists` vs denser candidate precompute/streaming path), not access-path discovery |
| `q11-top-orders-for-player` (`GetTopOrdersForPlayer`) | `Orders_Player_Amount_GroupedSorted` | Parameterized `take @limit` should benefit from PGO-sized bounded TopN/container code on top of the already-correct grouped-sorted lookup |
| `q14-top-order-item-scores` (`GetTopOrderItemScores`) | `Orders_Completed_Amount_Sorted`, `Items_Weapon_Player_ItemScore_GroupedSorted`, `Items_Weapon_ItemScore_Sorted` | Threshold monotone-join / TopN contracts and generated-code early-stop shape, not index recommendation |

This selection is intentionally small. It covers the main proof surfaces we care
about in indexed workloads: join specialization, strategy hints from selectivity,
TopN/container sizing, denser internal data structures, and generated-code shape.

You can validate this indexed proof pack with repository-native commands:

```bash
# 1. Structural proof: golden plan/code snapshots for indexed workloads
dotnet test ConjureDB.Compiler.SnapshotTests/ConjureDB.Compiler.SnapshotTests.csproj --filter FullyQualifiedName~PgoIndexedProofSnapshots

# 2. Compiler-side proof: plan/codegen evidence + compiler timing deltas
dotnet run --project ConjureDB.Compiler.Benchmarks -- --pgo-proof-export BenchmarkDotNet.Artifacts/results/pgo-indexed-proof-report.json

# 3. Runtime-side proof: runtime-comparable indexed workloads, PGO vs NoOptimize execution
dotnet run -c Release --project ConjureDB.VsSqlite.Benchmarks -- --pgo-proof-runtime-export BenchmarkDotNet.Artifacts/results/pgo-indexed-proof-runtime-report.json

# 4. Human-readable summary joining structural and runtime evidence
dotnet run --project ConjureDB.Compiler.Benchmarks -- --pgo-proof-report \
  BenchmarkDotNet.Artifacts/results/pgo-indexed-proof-report.json \
  BenchmarkDotNet.Artifacts/results/pgo-indexed-proof-runtime-report.json \
  BenchmarkDotNet.Artifacts/results/pgo-indexed-proof-summary.txt
```

The runtime proof uses `NoOptimize=true` sibling queries as the baseline. That
baseline keeps the same manually declared indexes and query semantics, but
removes the PGO-driven planning/codegen decisions. This is the relevant
comparison when you want to prove that PGO still adds value after the schema
already exposes the correct access paths. Workloads whose `NoOptimize` sibling
is not yet a stable runtime-equivalent baseline remain in the structural
compiler-proof lane and are reported as `runtime: n/a` in the joined summary.

---

## Manual Hints

Apply supported per-query hint properties using `query` attributes:

```csharp
schema query "from Players | group GuildId (...)", MaxGroupKeyValue = 256)]
IEnumerable<GuildStats> GetGuildStats();
```

### Available Hint Parameters

| Parameter | Effect |
|-----------|--------|
| `MaxGroupKeyValue` | Force DenseArray aggregation if <= threshold |
| `MaxKeyValue` | Override bounded comparison-key range for dense set-operation / DISTINCT strategies |
| `NoOptimize = true` | Disable advanced optimizations (baseline comparison) |

Other PGO-directed overrides such as `SkipSort`, join-strategy preference, and filter-selectivity hints live in planning profiles / PGO data, not on `CompiledQueryAttribute`.

### Precedence Order

```
schema query attributes  (highest priority)
        |
        v
PGO profile data (observed)
        |
        v
PK/FK inference
        |
        v
Heuristic defaults          (lowest priority)
```

---

## PGO in CI/CD

### Recommended Pipeline

```
┌──────────┐     ┌──────────────┐     ┌───────────────┐     ┌──────────┐
│ Nightly  │────>│  Instrument  │────>│ Export profile │────>│  Commit  │
│ Tests    │     │  (Collect)   │     │   (.json)     │     │  profile │
└──────────┘     └──────────────┘     └───────────────┘     └──────────┘
                                                                  │
                                                                  v
┌──────────┐     ┌──────────────┐     ┌───────────────┐     ┌──────────┐
│  Release │<────│  Build with  │<────│  Load profile │<────│  CI/CD   │
│  Build   │     │  PgoMode.Use │     │   (.json)     │     │  Pipeline│
└──────────┘     └──────────────┘     └───────────────┘     └──────────┘
```

### CI Integration Steps

1. **Nightly job** runs integration tests with `PgoMode.Collect`.
2. **Export** the profile to a known path in the repository.
3. **Validate** the schema hash matches the current schema.
4. **Commit** the profile to version control (ensures reproducible builds).
5. **Release builds** use `PgoMode.Use` with the committed profile.

### Schema Hash Validation

```bash
# The compiler warns when the profile SchemaHash doesn't match:
# warning: Schema hash mismatch. Profile was generated for different schema version.
```

Regenerate the profile whenever entities are added, removed, or modified.

### Profile Versioning

Check profiles into version control alongside the code:

```
profiles/
  game.json          # Main game profile
  tutorial.json      # Tutorial-specific profile
  benchmark.json     # Synthetic benchmark profile
```

---

## Performance Impact

### Current selected proof cases

The repository now includes a reproducible indexed-proof pack with committed
snapshots plus generated benchmark artifacts:

- `BenchmarkDotNet.Artifacts/results/pgo-indexed-proof-report.json`
- `BenchmarkDotNet.Artifacts/results/pgo-indexed-proof-runtime-report.json`
- `BenchmarkDotNet.Artifacts/results/pgo-indexed-proof-summary.txt`

These measurements are important because they do **not** rely on "PGO fixed a
missing index". The benchmark workloads already declare the required indexes and
compare PGO against a `NoOptimize` baseline or a structural compiler-proof lane.
At the same time, this pack is still a **proof suite**, not a representative
average over all query shapes. It is meant to answer "can PGO still matter after
indexes already exist?" rather than "what speedup should every project expect?".

Current measured cases:

| Workload | Evidence type | Baseline | PGO | Measured impact |
|----------|---------------|----------|-----|-----------------|
| `q07-complex-join` | Runtime | `0.3559ms` | `0.3528ms` | `1.01x` |
| `q08-exists-semi-join` | Runtime | `0.7638ms` | `0.6885ms` | `1.11x` |
| `q11-top-orders-for-player` | Compiler/codegen | compile/codegen proof only | compile/codegen proof only | `runtime: n/a` in the current runtime lane |
| `q14-top-order-item-scores` | Runtime | `2.9257ms` | `0.0139ms` | `210.14x` |

How to interpret these results:

- `q07` and `q08` are the "heuristics were already decent" cases. They show that
  PGO can still help on indexed queries, but only modestly.
- `q11` currently proves a planning/codegen contract only. It should not be used
  as a runtime headline until the runtime-equivalent baseline lane is upgraded.
- `q14` is intentionally a high-leverage case: PGO enables a threshold
  monotone-join / early-stop contract on top of already-declared indexes. The
  large win is real for this workload, but it should be read as a **best-case
  proof of capability**, not as a typical blanket expectation.

At the time of writing, the joined proof summary reports:

- 4 canonical indexed workloads covered
- 3 runtime-measured workloads
- 3/3 runtime-measured workloads where PGO is faster than `NoOptimize`
- strongest observed runtime win: `q14-top-order-item-scores` at `210.14x`

If you want one sentence of truth instead of marketing: the current repository
has real benchmark-backed evidence that PGO can matter even when indexes are
already present, but the public proof pack is still a **small, intentionally
selected suite**, and only one current case demonstrates a very large runtime
win.

You can regenerate these artifacts with:

```bash
dotnet test ConjureDB.Compiler.SnapshotTests/ConjureDB.Compiler.SnapshotTests.csproj --filter FullyQualifiedName~PgoIndexedProofSnapshots
dotnet run --project ConjureDB.Compiler.Benchmarks -- --pgo-proof-export BenchmarkDotNet.Artifacts/results/pgo-indexed-proof-report.json
dotnet run -c Release --project ConjureDB.VsSqlite.Benchmarks -- --pgo-proof-runtime-export BenchmarkDotNet.Artifacts/results/pgo-indexed-proof-runtime-report.json
dotnet run --project ConjureDB.Compiler.Benchmarks -- --pgo-proof-report \
  BenchmarkDotNet.Artifacts/results/pgo-indexed-proof-report.json \
  BenchmarkDotNet.Artifacts/results/pgo-indexed-proof-runtime-report.json \
  BenchmarkDotNet.Artifacts/results/pgo-indexed-proof-summary.txt
```

### Architectural improvement patterns

| Scenario | Without PGO | With PGO | Speedup |
|----------|-------------|----------|---------|
| GroupBy (256 keys) | Hash dictionary | DenseArray (stackalloc) | 3-8x |
| TopN (limit=10) | RuntimeSwitch branch | ConstantHeap (stackalloc) | 1.5-2x |
| Join (FK <= 10K) | Hash join | DenseArray index lookup | 2-5x |
| Sort (pre-sorted) | Full sort | Eliminated | Infinite (zero cost) |
| Output buffer | 4 resizes (grow-double) | Pre-allocated | 1.2-1.5x |

These are architectural patterns, not guaranteed headline numbers for every
query. For concrete current metrics, prefer the proof artifacts above, and do
not treat the current proof pack as a representative average across all query
shapes.

### When PGO Has Minimal Impact

- Queries with very small tables (< 100 rows)
- Simple scan-filter-project without aggregation or joins
- Queries where the heuristic guess is already close to observed values

---

## Reactive Query PGO Hints

PGO also drives reactive query (IVM) container sizing:

| Hint | Default | Effect |
|------|---------|--------|
| `DefaultFrameBudgetMicros` | 2000 µs (2 ms) | Target budget per delta application |
| `MaxResultCount` | — | Pre-size result containers |
| `MaxGroupCount` | — | Pre-size aggregate dictionary |
| `JoinOutputCapacity` | — | Pre-allocate join result containers |
| `DenseMaxEntityId` | 100,000 | Enable dense identity maps if entity IDs fit |

See [Reactive Queries](/docs/advanced/reactive-queries) for more details on IVM.

---

## Configuration Options

| Option | Default | Description |
|--------|---------|-------------|
| `AllowHeuristicSelectivity` | `true` | Enable heuristic selectivity when no PGO data is available |
| `PgoTrustPolicy` | — | Set minimum quality thresholds for profile acceptance |

---

## Best Practices

1. **Collect on representative workloads** — synthetic benchmarks may produce
   unrepresentative profiles. Use real gameplay sessions or replay recorded
   inputs.

2. **Regenerate profiles periodically** — data distributions change as the game
   evolves. A stale profile (mismatched `SchemaHash`) triggers a compiler
   warning.

3. **Check profiles into version control** — ensures reproducible builds across
   the team and CI.

4. **Use `NullQueryProfiler` in production** — the null profiler guarantees
   zero overhead; collection should only happen in instrumented test builds.

5. **Inspect advisory output** — review `AutoIndexCandidates`,
   `GroupedIndexProfiles`, and the derived `auto-index-report.json`. The report
   is deterministic and explain-oriented; the canonical payload lives in
   `PgoProfile.AutoIndexCandidates`. Advisory candidates are not applied
   automatically to the schema or code generator.

6. **Use `NoOptimize = true`** on queries with highly variable cardinality
   where a fixed PGO snapshot would be misleading.

7. **Start without PGO** — heuristic defaults are reasonable for most workloads.
   Add PGO when benchmarks show specific queries need optimization.

8. **Validate profile quality** — check Coverage and StabilityScore in the
   profile metadata. Low-quality profiles may cause worse performance than
   heuristic defaults.

---

## Complete Example: End-to-End PGO Workflow

### 1. Instrument

```csharp
// GameDbContext.cs
[PgoMode(PgoMode.Collect, "./profiles/game.json")]
public class GameDbContext : DbContext
{
    // Generated from .conjure schema AdditionalFiles.
    // DbSet registrations are emitted from schema descriptors during Build().
}
```

### 2. Run Workload

```csharp
// Run realistic gameplay scenarios
for (int i = 0; i < 10_000; i++)
{
    var topPlayers = context.GetTopPlayersByLevel(limit: 10);
    var guildStats = context.GetGuildStats();
    var inventory = context.GetPlayerInventory(playerId: rng.Next(1, 1000));
}
```

### 3. Export

```csharp
var exporter = new ProfileDataExporter(
    context.Profiler,
    context.IndexCollector,
    context.JoinCollector,
    context.PackedKeyCollector);
exporter.Export("./profiles/game.json");
```

### 4. Review Profile

```bash
# Inspect the exported profile
cat profiles/game.json | jq '.JoinStats'
# {
#   "Players-Guilds": {
#     "matchRatio": 1.0,
#     "maxFkValue": 512,
#     "recommendedStrategy": "index"
#   }
# }
```

### 5. Rebuild

```csharp
// Switch to Use mode
[PgoMode(PgoMode.Use, "./profiles/game.json")]
public class GameDbContext : DbContext { ... }
```

```bash
dotnet build -c Release
# The compiler now uses PGO data for strategy selection:
# info: PGO: GetGuildStats -> DenseArray (maxKey=512)
# info: PGO: GetTopPlayersByLevel -> ConstantHeap (limit confirmed <= 64)
# info: PGO: Players-Guilds -> IndexLookup (maxFk=512)
```

### 6. Benchmark

```bash
dotnet run -c Release --project ConjureDB.Benchmarks
# Compare PGO vs heuristic baselines
```

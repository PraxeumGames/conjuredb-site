# Profile-Guided Optimization (PGO)

ConjureDB can use representative runtime or replay telemetry to improve cardinality estimates, physical-plan choices, bounded allocations, and reactive container sizing. Collection and optimization are separate: release code consumes an offline, governed profile and does not need production timing instrumentation.

PGO is fail-closed. Supplying an invalid, stale, unapproved, or schema-incompatible profile fails the explicit PGO input instead of silently compiling with unrelated heuristics.

## Trust model

ConjureDB accepts two different kinds of optimizer input:

| Input | Statistics | Planning directives | Governance required |
|---|---:|---:|---:|
| PGO V7 artifact | Yes | Yes | Exact schema/content/workload promotion proof |
| Standalone statistics profile | Yes | No | No PGO trust; explicit statistics-only path |

A profile does not become trusted by writing `"lifecycleState": "approved"` into JSON. An approved artifact must also have a matching record in a host-owned promotion registry. Candidate artifacts are rejected unless the host explicitly enables a canary policy.

## Collection lifecycle

```text
instrumented generated pack
      |
      v
representative workload
      |
      v
runtime/replay evidence
      |
      v
assemble and review PGO V7 artifact
      |
      v
host promotion registry
      |
      v
manual release-pack compilation with PgoMode=Use
```

`PgoMode.Collect` enables instrumentation. `PgoMode.Use` consumes an already assembled and promoted V7 artifact. The compiler does not self-promote telemetry.

Use realistic game sessions, deterministic replay, or backend-collected fleet evidence. A synthetic microbenchmark profile is useful for a focused proof but should not be promoted as a representative production workload without separate evidence.

## PGO V7 format

V7 is a breaking, strict JSON contract. Its top-level shape is:

```json
{
  "version": 7,
  "profileId": "profile.release.2026-07-09",
  "lifecycleState": "approved",
  "workloadFingerprint": "workload.realtime.release",
  "generatedAt": "2026-07-09T17:50:00Z",
  "profilingDuration": "00:30:00",
  "schemaFingerprint": "<64 lowercase hex characters>",
  "coverage": 0.94,
  "stabilityScore": 0.92,
  "outlierRate": 0.03,
  "evidence": {
    "sourceProfileIds": ["capture.release.42"],
    "workloadFingerprints": ["workload.realtime.release"],
    "schemaFingerprints": ["<same schema fingerprint>"],
    "provenanceSources": ["runtime.telemetry.release"],
    "observationWindowStartUtc": "2026-07-09T17:20:00Z",
    "observationWindowEndUtc": "2026-07-09T17:50:00Z"
  },
  "statistics": {
    "version": 3,
    "kind": 0,
    "generatedAt": "2026-07-09T17:50:00Z",
    "tables": {},
    "queries": {},
    "joins": {}
  },
  "queryEvidence": {
    "inventory.by-owner": {
      "queryId": "inventory.by-owner",
      "shapeKey": 17,
      "driverTable": { "tableName": "Inventory", "rowCount": 48 },
      "executionCount": 12000,
      "avgInputRows": 48.2,
      "avgOutputRows": 3.7,
      "avgExecutionTimeMicros": 14.8,
      "p50ExecutionTimeMicros": 12.1,
      "p90ExecutionTimeMicros": 19.3,
      "p95ExecutionTimeMicros": 23.4,
      "p99ExecutionTimeMicros": 31.6,
      "provenanceSource": "runtime.telemetry.release",
      "sampleCount": 12000,
      "lastUpdatedUtc": "2026-07-09T17:50:00Z",
      "runtimeMaintainedIndexDirtyEpochProbability": 0.0,
      "limitParameters": {
        "limit": {
          "sampleCount": 12000,
          "min": 1,
          "max": 200,
          "mean": 41.2,
          "median": 20,
          "upperPercentile": 150
        }
      }
    }
  },
  "operatorEvidence": {},
  "autoIndexCandidates": []
}
```

This is a shape illustration, not an approved usable artifact: the schema fingerprint, evidence, sample count, quality thresholds, and promotion record must all match the real compilation input.

There is one canonical statistics payload. V7 does not accept duplicate root-level `tables`, `queries`, or `joinStats` objects. Query latency/provenance evidence is stored under `queryEvidence`; operator-kind distributions without query identity are stored under `operatorEvidence`; cardinality/cost data is stored under `statistics`.

At compilation time, admitted query evidence is selected only by an exact query-id and shape-key match. A profile entry for another query or another shape cannot influence the current query. Operator distributions remain typed global evidence and are not reinterpreted as query evidence. `runtimeMaintainedIndexDirtyEpochProbability` is optional per-query measured evidence: omission or explicit `null` means unmeasured, while `0.0` is a measured clean epoch and is preserved as distinct authority.

Unknown members, duplicate properties, wrong casing, missing required fields, and any
profile version other than 7 are rejected. Canonical serialization emits nested
statistics version 3. The reader accepts historical statistics version 2 only through
the explicit lossless v2-to-v3 migration contract; every other nested statistics
version is rejected.

### Runtime LIMIT/OFFSET parameter evidence

`queryEvidence[*].limitParameters` is the observed distribution of each LIMIT/OFFSET
parameter of the query, keyed by the **parameter name as authored in the DSL**
(`take @limit`, `skip @offset`). It is optional, and its canonical "none" is omission:
an empty object is rejected, so a profile for a query with no runtime window keeps its
content fingerprint unchanged.

Each distribution carries `sampleCount`, the observed hull `min`/`max`, the `mean`, the
`median` (P50) and `upperPercentile` (P90). It must satisfy
`0 <= min <= median <= upperPercentile <= max`, `min <= mean <= max`, a positive
`sampleCount` no larger than the query's `executionCount`, and a canonical parameter
name; otherwise admission rejects the profile with
`pgo.admission.rejected.contract`.

Where it comes from and what it does:

* The runtime records it. With PGO instrumentation on, the generated query calls
  `IQueryProfiler.RecordLimitParameter(queryHandle, parameterOrdinal, value)` once per
  invocation for every LIMIT/OFFSET parameter the selected plan reads. No string reaches
  the recording path: the compiler numbers the query's parameters by their index in the
  plan's ordinal-sorted instrumentation contract (the same list the plan attestation
  publishes as `LimitParameterNames`), and emits, as a nested type of the generated host,
  one site per query whose static readonly `Handle` is minted once by
  `QueryLimitParameterSiteRegistry.Register(queryId, parameterNames)`. The handle is
  process-wide rather than per pack because one profiler may observe contexts of several
  packs. The collector keeps a base-2 histogram per (handle, ordinal), updated lock-free
  with interlocked operations, so concurrent invocations of one query never serialize;
  there is no per-sample retention and no allocation after a collector's first record of
  a query. Query ids and parameter names are resolved from the registry only when the
  report is built, and sites sharing a query id and parameter name are merged, so
  `ProfileDataExporter` writes the same `Queries[*].LimitParameters` it always has.
* The cost model consumes it. `RuntimeLimitEstimator` builds a piecewise-linear CDF in
  `log(1 + k)` through `(min, 0), (median, .5), (upperPercentile, .9), (max, 1)` and
  ranks it **above** both of its priors; the estimate's source becomes
  `ProfileParameterDistribution`. A page size and a page depth are separate variables:
  when both the count and the offset are runtime parameters, both need evidence, and
  their quantile knots add. Evidence for only one of the two leaves the estimate on the
  prior rather than guessing half a distribution.
* It is plan input. The distributions are part of the pack's PGO plan-input
  fingerprint, so a pack generated under one observed page-depth distribution is not
  considered up to date under another.

**What it buys, measured.** `GetPlayersByCreatedAtOffsetPage(offset, limit)`
(`sort CreatedAt | skip @offset | take @limit`) over 200 000 players, page size 20, with two
profiles that differ in exactly the `offset` distribution: a deep one (median 100 000) makes the
planner select the full sort, and offset 100 000 goes from 126.0 ms to 36.3 ms (**3.47x**); a
shallow one (median 10) keeps the bounded heap, and offsets 10 and 1 000 stay at 2.60 ms and
4.62 ms. No other plan in the pack moves. Without the distribution both workloads get the same
scale-free prior over the relation, and one of the two is always priced wrongly — that is the
error this field removes, and the reason it ranks above the priors rather than blending with them.

In a governed artifact, the distribution is not authored: each runtime-evidence receipt
states the parameter values its measured invocation ran with
(`limitParameters: [{ "parameterName": ..., "value": ... }]`, ordinal-sorted, unique,
non-negative, omitted when there are none), every window of a corpus must observe the
same parameter set, and the corpus merges them sample-weighted. The ratified profile
must project that merge exactly.

### The shape axis (new in V7)

A **shape key** names a *regime* a query runs in, and a regime is a row count on one
**driver table**. V7 therefore makes the two inseparable:

* `queryEvidence[*].driverTable` is **required whenever `shapeKey` is non-null** and
  **forbidden when `shapeKey` is null**. An evidence row that claims a shape without
  naming the table whose row count distinguishes it cannot say which regime it is
  about; an evidence row that carries a regime coordinate with no shape to attribute
  it to is equally unusable.
* Each violation has its own stable contract name, so a rejection is attributable
  without reading prose: `PgoProfile.QueryEvidence.DriverTable.RequiredForShapeKey`,
  `...ForbiddenWithoutShapeKey`, `...TableName`, `...RowCount`, `...MergeConflict`.
* `driverTable.tableName` must be a table of the bound schema; `driverTable.rowCount`
  must be non-negative. In a governed artifact it must additionally equal the row
  count that artifact's own runtime-evidence corpus observed for that table.
* Merging refuses two evidence rows for one query that disagree on shape key, and
  refuses two rows under one shape key that disagree on driver table.

**One corpus is one regime.** Every window in a governed runtime-evidence corpus must
observe byte-identical input tables — that is what makes the corpus's measurement a
statement about a single regime, and it is unchanged in V7. A **regime set** is
therefore *N corpora*, one per regime, bound together by the profile-set manifest.

**The manifest is the binding.** The profile-set manifest is at version 2, and every
member declares an explicitly required, explicitly nullable `shapeKey` plus its
`governedRuntimeEvidence` binding:

```json
{
  "version": 2,
  "baselineShapeKey": 1,
  "profiles": [
    {
      "queryId": "repo:Game.IPlayerQueries@repo:T0:GetTopSpenders(int)",
      "shapeKey": 0,
      "profilePath": "q07-shape-0-approved-profile.json",
      "promotionRegistryPath": "q07-shape-0-approved-registry.json",
      "evaluationTimeUtc": "2026-09-13T12:00:00Z",
      "governedRuntimeEvidence": {
        "corpusPath": "q07-shape-0-ratification-corpus.json",
        "sourceRevision": "<40 lowercase hex characters>"
      },
      "profileContentFingerprint": "<canonical profile SHA-256>"
    }
  ]
}
```

Members are ordered by query id, and the members of one query id by ascending shape
key. A query id may appear more than once **only** when every one of its members
declares a non-null shape key — two shape-less profiles for one identity would be two
unattributable authorities for the same query. Admission then requires each member's
profile to declare **exactly** the shape key its manifest member declared: a
mismatched shape, a missing shape where one was declared, and a shape where none was
declared are all rejected.

**The baseline regime is declared, never inferred.** `baselineShapeKey` is **required
when any member declares a shape key and forbidden when none does**, and it names the
regime the *rest of the pack* is compiled in: every query that has no regime set of its
own is compiled exactly once, under the statistics of the members at that shape. Every
shape-declaring query must have a member at the baseline shape, and those members must
carry byte-identical normalized statistics, because they describe one measured world.

Two things depend on this being declared rather than guessed. The whole-schema statistics
authority used to be the statistics of whichever member sorted first by (query id, shape
key), so publishing a small-regime member for an alphabetically early query silently
recompiled every other query in the pack at that regime's cardinality. And a *collapse*
retains the baseline shape, so a collapse is only observationally identical to never
having specialized when the retained body is the one the baseline regime's search
produced.

**What members of one regime set may disagree about.** Members that declare no shape key
describe one measured world and must carry byte-identical normalized statistics, exactly
as before the shape axis existed. Members at different shape keys describe *different*
measured worlds and carry their own complete statistics — not just a different driver-table
row count. That is not a loosening for convenience: measured at 5,000 and 50,000 players
the VsSqlite workload differs in five of its nine tables, because every dependent table's
row count scales and so do the per-column distinct counts, most-common values and
histograms costing reads. A rule that allowed only the driver table to move would admit no
honestly measured regime pair at all. What ties a member to its measurement instead is
`driverTable.rowCount`: it must equal the row count that member's own statistics carry for
that table, which is checked at admission.

Publish a shape-keyed member with the corpus-resolved regime coordinate:

```bash
dotnet run --project ConjureDB.Compiler -- pgo-evidence project-profile   ./q07-shape-1-ratification-corpus.json <source-revision>   vssqlite.q07.approved.shape-1   ./q07-shape-1-approved-profile.json ./q07-shape-1-approved-registry.json   --approved-at-utc 2026-09-13T12:00:00Z   --shape-key 1 --driver-table Players
```

`--shape-key` and `--driver-table` are one declaration: supplying either alone fails,
and a driver table the corpus never observed as an input table fails rather than
being invented. The row count written into the profile is the one the corpus measured.

**What compiling a shape-keyed set does.** Each shape-declaring query's members become a
regime set, and each regime is searched under **its own member's statistics provider** —
the per-(query, shape) seam. The compiler then either specializes or collapses, and says
which in the generated source:

* regimes whose winning plans have the same fingerprint **collapse** to the baseline shape
  (`// Shape specialization: collapsed to shape N: identical physical plans`), and the pack
  is byte-identical to an unspecialized one;
* regimes whose plans differ, and whose modelled cost separation in the higher regime clears
  `MinCostSeparation` (default 1.15), **specialize**: a `__SelectShape_<Method>` selector
  reading the driver table's live `Count`, a `const long` activation threshold bisected
  through the search itself, and a `__ShapeN` body per retained regime — for each of the
  `main`, `nonalloc` and `foreach` families;
* broken premises refuse loudly instead of picking a side: `no_flip`, `non_monotonic`,
  `driver_table_ambiguous`.

With no admitted regime set a query compiles exactly as it would with no PGO at all — the
PGO gate holding by construction rather than by a runtime check. See
the compiler's query-shape specialization program.

### Measuring a second regime

A regime set needs one governed corpus **per regime**, and a corpus's calibration
windows attest a statistics-only bootstrap receipt that names the statistics profile
the measured pack was generated from. That profile is part of the claim: a statistics
payload is honest for exactly one regime, for every table it describes, so a window
measured at one size may not attest a payload measured at another. The VsSqlite
governed lane binds the two through one type, `BenchmarkStatisticsRegime`, which maps
a regime to the project-relative statistics profile that describes it and is the only
place that mapping exists.

Produce a regime's statistics payload with the regime named explicitly — there is no
default, because an implicit regime is exactly the mistake the binding prevents:

```bash
dotnet run -c Release --project ConjureDB.VsSqlite.Benchmarks -- \
  --pgo-generate-statistics-profile profiles/statistics/r05000-profile.json \
  --player-count 5000
```

This writes the compiler statistics artifact `generate --statistics-profile` consumes
(the runtime profile `--pgo-generate-profile` writes is a different, non-interchangeable
serialization). Then run the campaign's statistics-only generation against *that* file,
so the bootstrap receipt the regime's calibration windows attest names it.

**Regimes must share one index-key encoding.** The compiler chooses a composite index's
runtime key encoding from the statistics profile: the VsSqlite workload's
`WalletTransactions (PlayerId, Currency)` index is emitted with the dense 16-bit packed
encoding when the observed maximum of the leading int key fits in 16 bits, and with the
64-bit encoding above that. A governed measurement runs a fixed pack built from one
statistics profile, so every regime measured against that pack must stay inside that
pack's encoding — for this workload, at most 65,535 players. `BenchmarkStatisticsRegime`
refuses a larger regime at the boundary that owns the decision rather than letting it
surface as a packed-key overflow during workload setup. A regime pair that straddles the
boundary is not a query-shape question at all: it changes the index layout, which one
pack cannot carry two of.

**Driver tables are per query, and must have been observed.** `--driver-table` is checked
against the input tables that query's corpus actually recorded, so one campaign's two
queries can legitimately use different driver tables — in the VsSqlite lane Q07's regime
coordinate is `Players` and Q38's is `Orders`, because Q38 never observes `Players`.
Naming a table the corpus did not observe fails rather than being invented.

**Worked example.** `ConjureDB.VsSqlite.Benchmarks/profiles/shape-axis-q07-q38.evidence/`
holds a complete, admitted two-regime set: two queries x two regimes (5,000 / 50,000
players), each member with its own statistics, `baselineShapeKey: 1`, and a `command-log.md`
recording every command. Both of its queries collapse — a 10x driver-table change moves
neither plan, at compile time and in the attested runtime measurement alike — so it ships no
shape variant, which is the collapse rule working rather than a gap.

**Worked example: a regime pair that produces a shape — and a shape that did not ship.**
`ConjureDB.VsSqlite.Benchmarks/profiles/shape-axis-q07-q38-qmixedsort.evidence/` holds the first
published set that specializes anything: the same two regimes, three queries (Q07, Q38 and
`QMixedSort`), six members, `baselineShapeKey: 1`. `QMixedSort` is

```conjure
from Orders o | sort o.Amount, -o.Id | take @limit
```

and its two regimes genuinely disagree. At 124,957 `Orders` rows the optimizer selects
`TopN(RuntimeSwitch) └ Scan(Order)` and no index; at 12,552 rows it selects
`Limit └ Sort(FullSort) └ Scan(Order, IndexedScan, Orders_Amount_Sorted)`. Because the two plans
differ, the collapse rule does not fire and the pack emits a dispatch:

```text
// Shape specialization: specialized on Order.Count >= 20619
public Order[] QMixedSort(int limit)
{
    if (__SelectShape_QMixedSort() >= __ShapeActivationRows_QMixedSort)
        return QMixedSort__Shape1(limit);
    return QMixedSort__Shape0(limit);
}
```

Three things in that snippet are worth naming:

* **The activation row count is bisected, not declared.** 20,619 is where the planner found the
  selected plan to change when it re-compiled the query at driver-table row counts between the two
  measured coordinates. A profile set never states a threshold; it states two measurements.
* **The selector reads the driver table's live `Count`**, which is an O(1) field read, and nothing
  else. The shape is chosen per call, so a world that grows past the threshold starts running the
  other plan without a rebuild.
* **A specialized query has no single plan, so it has no single attestation.** The generated type
  publishes `ShapePlanAttestations` — one `GeneratedQueryPlanAttestation` per retained shape, keyed
  by the profile set's own shape key — and its scalar `PlanAttestation` is the *baseline* shape's,
  which is the regime every non-specialized query in the pack is compiled in. Tooling that ratifies
  a measured plan against the pack must pick the shape matching the regime it measured; ratifying
  the baseline attestation against a small-regime measurement is supposed to fail, and does.

The set costs +0.83 % generated lines over the whole pack, against the ratchet's +8 % cap, and
`command-log.md` beside it records every command, every content fingerprint and all 1,800 measured
samples behind it.

**And the project does not admit it.** The measurement that a shape must pass is not "the optimizer
prefers a different plan here" but "the different plan is faster here", and this one is not: in the
5,000-player regime the specialized body runs **2,579 µs against the canonical plan's 98 µs** on the
same data, because it fully sorts a scan that is already ordered to produce 20 rows while the
canonical plan runs a bounded `TopN`. Dispatch itself is cheap — +2.54 % in the canonical regime,
byte-identical allocations — but a 26x regression below the threshold is a silent degradation, so
`ConjureDBPgoProfileSetPath` still points at the single-regime set and the pack ships no
`__SelectShape_`. The evidence directory stays committed as the measurement, and what it proves is a
cost-model defect rather than a faster query. This is the shape axis working as intended: a regime
pair that differs earns a *measurement*, and only a measurement that wins earns a shipped shape.

### The shape-variant ratchet

Specialization is the one optimizer feature whose failure mode is code size, so it ships
behind `ci/shape-variant-gate.sh`, which asserts per committed pack that

1. every plan-census entry whose variant is `<family>/shape-N` pairs with an admitted,
   promoted profile-set member at the same `queryId` and `shapeKey` — Invariant 1 checked
   against shipped artifacts;
2. the number of such entries never grows past its committed baseline
   (`ci/baselines/shape-variant-baseline.json`); and
3. generated lines per pack stay within **+8%** of that baseline.

Raising either number is a deliberate act: the baseline is re-blessed with
`bash ci/shape-variant-gate.sh --update-baseline` **in the same commit** that lands the
profile members authorizing the new shapes.

### Directional join evidence

`statistics.joins[*].matchFraction` means “fraction of left-side rows that find a match on the right.” It is directional and must be serialized explicitly. It is not inner-join selectivity or output fanout, and the optimizer does not infer the reverse direction.

## Promotion registry

The registry is a separate versioned JSON artifact:

```json
{
  "version": 2,
  "approvals": [
    {
      "profileId": "profile.release.2026-07-09",
      "contentFingerprint": "<canonical profile SHA-256>",
      "schemaFingerprint": "<optimizer-schema SHA-256>",
      "workloadFingerprint": "workload.realtime.release",
      "approvedAtUtc": "2026-07-09T18:00:00+00:00"
    }
  ]
}
```

The promotion owner—normally CI/CD or a backend governance service—must compute the canonical content fingerprint and publish the profile and registry together. Editing the profile after promotion invalidates the record.

## Applying PGO During Manual Compilation

PGO is an explicit input to the manual `ConjureDB.Compiler`; it is never consumed by
an MSBuild source generator. A target project may define the atomic manual-generation
defaults `ConjureDBPgoProfilePath`, `ConjureDBPgoPromotionRegistryPath`, and
`ConjureDBPgoEvaluationTimeUtc`. The standard `generate <project.csproj>` command
evaluates those properties, and the explicit UTC evaluation time makes recency
decisions reproducible. All three properties are required together.

A complete CLI governed-PGO triplet or `--statistics-profile` explicitly overrides the
project default. `--pgo` collection instrumentation disables a project governed-PGO
replay input for that invocation, while preserving explicit or project standalone
statistics. Partial governed-PGO overrides are rejected rather than combined with
project values.

Use a governed PGO artifact:

```bash
dotnet run --project ConjureDB.Compiler -- generate ./Game.Data.csproj \
  --schema-root ./schema --output ./Generated \
  --pgo-profile ./profiles/release.pgo.json \
  --pgo-promotion-registry ./profiles/pgo-promotions.json \
  --pgo-evaluation-time-utc 2026-07-09T18:00:00Z
```

For projects that compile several independently governed queries, use one
self-contained profile-set manifest instead of a project-global profile:

```xml
<ConjureDBPgoProfileSetPath>$(MSBuildProjectDirectory)/profiles/release.profile-set.json</ConjureDBPgoProfileSetPath>
```

or override it explicitly:

```bash
dotnet run --project ConjureDB.Compiler -- generate ./Game.Data.csproj \
  --schema-root ./schema --output ./Generated \
  --pgo-profile-set ./profiles/release.profile-set.json
```

The manifest lists at least two exact query identities in ordinal order. Each
member supplies its own governed profile, promotion registry, UTC evaluation
time, runtime-evidence corpus, source revision, and expected profile
fingerprint. Member paths are normalized relative paths contained by the
manifest directory. Every member is admitted independently; generation shares
statistics only when all normalized statistics payloads and optimizer-schema
identities are identical, and it selects PGO/runtime evidence only for the
exact compiled query.

`ConjureDBPgoProfileSetPath` and `--pgo-profile-set` are self-contained
boundaries. They cannot be combined with standalone statistics, the
single-profile properties/options, candidate-canary/bootstrap options, or
`--pgo` collection instrumentation. Partial combinations fail instead of
inheriting project defaults.

Use standalone statistics without granting planning trust:

```bash
dotnet run --project ConjureDB.Compiler -- generate ./Game.Data.csproj \
  --schema-root ./schema --output ./Generated \
  --statistics-profile ./profiles/synthetic-statistics.json
```

The two inputs are mutually exclusive. `--pgo` enables collection instrumentation; it
is not the profile-use switch:

```bash
dotnet run --project ConjureDB.Compiler -- generate ./Game.Data.csproj --pgo
```

## Validating an artifact

The profiling CLI binds the actual `.conjure` schema and uses the same admission service as compilation:

```bash
dotnet run --project ConjureDB.Profiling -- \
  validate-profile \
  --schema-root ./schema \
  --pgo-profile ./profiles/release.pgo.json \
  --promotion-registry ./profiles/pgo-promotions.json \
  --pgo-evaluation-time-utc 2026-07-09T18:00:00Z
```

Validation reports a stable admission reason code. Typical rejection classes include malformed contract, schema mismatch, stale/future timestamps, inconsistent evidence, low quality, invalid lifecycle, missing/mismatched promotion, and invalid canonical statistics.

## What admitted PGO can influence

Depending on available evidence and compiler proofs, an admitted profile can influence:

- table, predicate, query, and directional join estimates;
- join, aggregate, Top-N, set-operation, and access-path strategy selection;
- bounded preallocation and dense-key eligibility;
- the runtime-limit estimate for a `@limit`/`@offset` window, from the observed
  per-parameter distribution rather than from the scale-free prior;
- query-shape and hot-path classification;
- reactive/IVM container sizing and scheduling hints;
- report-only auto-index evidence.

PGO evidence does not override semantic legality. Required ordering, null semantics, identity, uniqueness, bounds, and allocation safety still need proof in the compiler. Sampled distinct counts do not become uniqueness constraints, and observed maxima do not automatically become permanent hard bounds.

## Auto-index governance

Auto-index candidates in a profile are advisory. They are not silently applied to schema or generated code. Review them through the owner workflow:

```bash
PGO_GOVERNANCE=(--schema-root ./schema --pgo-profile ./profiles/release.pgo.json --promotion-registry ./profiles/pgo-promotions.json --pgo-evaluation-time-utc 2026-07-09T18:00:00Z)
dotnet run --project ConjureDB.Profiling -- auto-index analyze "${PGO_GOVERNANCE[@]}"
dotnet run --project ConjureDB.Profiling -- auto-index show "${PGO_GOVERNANCE[@]}" --candidate 1
dotnet run --project ConjureDB.Profiling -- auto-index patch "${PGO_GOVERNANCE[@]}" --candidate 1 --surface schema
dotnet run --project ConjureDB.Profiling -- auto-index decide "${PGO_GOVERNANCE[@]}" --candidate 1 --decision accepted --surface schema --target-file ./schema/game.conjure
```

Every auto-index review command admits the exact PGO bytes against the bound schema,
host policy, promotion registry, and explicit evaluation time. Patch previews and owner
decisions carry the admitted content fingerprint, so a changed artifact makes an earlier
decision stale. Owner decisions live separately in `.conjuredb/auto-index.decisions.json`.
They support review and tooling; they are not compiler plan semantics.

## CI/CD recommendations

1. Collect or aggregate telemetry from a representative, versioned workload.
2. Assemble one strict V7 artifact with one optimizer-schema fingerprint.
3. Validate quality, timestamps, evidence lineage, and schema compatibility.
4. Benchmark PGO against the non-PGO baseline on the same corpus.
5. Promote the exact content hash through the host registry.
6. Commit or publish the profile and registry atomically.
7. Run manual release-pack compilation with an explicit evaluation time and fail the pipeline on admission failure.
8. Recollect and repromote after schema or representative workload changes.

Do not reuse a promotion record after modifying a profile, and do not permit a local candidate profile in release-pack generation through canary policy.

## Performance evidence

The repository contains compiler and runtime proof lanes for selected indexed workloads, including:

- `PgoIndexedProofSnapshots`;
- the compiler benchmark `--pgo-proof-export` lane;
- the VsSQLite runtime `--pgo-proof-runtime-export` lane;
- the joined `--pgo-proof-report` artifact.

These are capability proofs, not a promise of a universal speedup. Always interpret them together with the workload, plan diff, correctness gates, allocation data, and the non-PGO baseline.

## Troubleshooting

- **Schema rejection:** regenerate the artifact for the exact schema; the fingerprint covers more than table and column names.
- **Promotion mismatch:** publish a registry record for the exact canonical content hash; do not edit promoted JSON.
- **Stale or future timestamp:** verify UTC timestamps and the explicit compiler evaluation time.
- **Evidence rejection:** keep one schema/workload/provenance binding per admitted artifact and ensure query timestamps lie inside its observation window.
- **Quality rejection:** increase representative coverage/sample count or improve stability; do not lower policy merely to make a profile pass.
- **Statistics rejection:** validate names, finite probabilities, non-negative cardinalities, and explicit directional `matchFraction` values.

For implementation details, see PGO Internals.

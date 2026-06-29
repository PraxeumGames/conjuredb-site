// Hand-maintained metrics for the portable (no-JIT) interpreter lane — the ConjureDB-branded surface
// of the project's portable-runtime benchmarks. NOT auto-generated (unlike ./benchmarks.ts); update
// it from current BenchmarkDotNet exports. Older historical notes live in
// UniMemory.Benchmarks/PortableRuntime/portable-perf-baseline.md.
//
// Source runs (Apple M4 Max, .NET 8.0.11 Arm64, BenchmarkDotNet v0.14.0, InProcessEmitToolchain,
// WarmupCount=4, IterationCount=8, workstation GC, default tiered JIT):
//   - PortableVsSqliteBenchmarks     → each scenario vs equivalent SQL on an in-memory SQLite DB
//                                       seeded with the IDENTICAL 1000/1000/500-row data (the headline table)
//   - PortableInterpreterBenchmarks  → portable-only corroborating ns/query + alloc table (1000-row corpus)
//   - PortableScanSourceBenchmarks   → delegate-vs-slot scan source × table size (the scaling table)
//
// SQLite gets fast pragmas, a Prepare()d statement, and a PK index only — matching the portable
// corpus's index availability — and both engines fully materialize the result. These are
// measurements of one configuration (1000-row in-memory tables, one thread, one host) — not a
// guarantee.

export type InterpStat = {n: string; l: string};
export type InterpReason = {title: string; body: string};
// sqlite/cdb/x mirror the main benchmark tables' shape: baseline time, ConjureDB time, "N× faster".
export type InterpScenario = {q: string; what: string; sqlite: string; cdb: string; x: string; alloc: string};
export type InterpScalingRow = {scenario: string; rows: string; slot: string; delegate: string; note: string};

// Headline cards for the section hero band.
export const INTERP_STATS: InterpStat[] = [
  {n: '4.7–57×', l: 'faster than SQLite across 17 query shapes'},
  {n: '17 / 17', l: 'scenarios faster than SQLite'},
  {n: '0 B', l: 'allocation on a keyed point lookup'},
  {n: 'No JIT', l: 'runs on iOS / IL2CPP'},
];

// The "why this lane is still fast" cards (2×2 grid, mirrors the compiled-path "Four reasons").
export const INTERP_REASONS: InterpReason[] = [
  {
    title: 'No JIT, no codegen',
    body: 'Config-delivered queries ship as a pre-verified bytecode and run through a register-based interpreter — no runtime IL emission, no reflection — so they work on iOS and Unity/IL2CPP where a JIT cannot.',
  },
  {
    title: 'Allocation-light runtime',
    body: 'Pooled hashtables and arena-backed key/accumulator buffers keep allocation tiny: 0 bytes for a point lookup, and no current corpus scenario above 265 bytes per query.',
  },
  {
    title: 'O(1) keyed lookups',
    body: 'A primary-key probe is constant-time — about 23 ns in the current vs-SQLite harness, and flat across table sizes — because the lane uses the same index as the compiled path, not a scan.',
  },
  {
    title: 'Parity, not approximation',
    body: 'The interpreter produces bit-identical results to the AOT C# lane — same rows, ordering and null semantics — continuously verified by differential and SQL-parity tests.',
  },
];

// The full 17-scenario comparison vs SQLite (same query, same 1000/1000/500-row in-memory data,
// PK index only on both, prepared statements, full result materialized). Ordered by ConjureDB
// per-query latency (cheapest first). "x" = SQLite mean / ConjureDB mean.
export const INTERP_SCENARIOS: InterpScenario[] = [
  {q: 'Point lookup', what: 'Fetch one row by primary key', sqlite: '702 ns', cdb: '22.9 ns', x: '31× faster', alloc: '0 B'},
  {q: 'Sort top-N', what: 'Sort by price, take 10', sqlite: '18.0 µs', cdb: '2.53 µs', x: '7.1× faster', alloc: '176 B'},
  {q: 'Hash aggregate', what: 'Count rows grouped by a column', sqlite: '105 µs', cdb: '4.02 µs', x: '26× faster', alloc: '96 B'},
  {q: 'Range top-N', what: 'Filter, sort by score, take 10', sqlite: '32.8 µs', cdb: '5.09 µs', x: '6.4× faster', alloc: '176 B'},
  {q: 'Set union', what: 'Union two result sets (dedup)', sqlite: '126 µs', cdb: '5.58 µs', x: '23× faster', alloc: '265 B'},
  {q: 'Set intersect', what: 'Intersect two result sets (dedup)', sqlite: '128 µs', cdb: '5.60 µs', x: '23× faster', alloc: '265 B'},
  {q: 'Distinct', what: 'Distinct values of one column', sqlite: '30.9 µs', cdb: '6.51 µs', x: '4.7× faster', alloc: '80 B'},
  {q: 'Scan · filter · project', what: 'Filter a table, project three columns', sqlite: '157 µs', cdb: '6.79 µs', x: '23× faster', alloc: '41 B'},
  {q: 'Multi-key aggregate', what: 'Count + sum grouped by two columns', sqlite: '294 µs', cdb: '6.91 µs', x: '43× faster', alloc: '40 B'},
  {q: 'Window · row_number', what: 'row_number() over a sorted partition', sqlite: '490 µs', cdb: '8.62 µs', x: '57× faster', alloc: '41 B'},
  {q: 'Aggregate · double key', what: 'Sum grouped by a floating-point column', sqlite: '489 µs', cdb: '9.73 µs', x: '50× faster', alloc: '42 B'},
  {q: 'Multi-aggregate', what: 'Count/sum/min/max grouped by a column', sqlite: '150 µs', cdb: '10.8 µs', x: '14× faster', alloc: '40 B'},
  {q: 'Window · running sum', what: 'Running SUM() over an ordered frame', sqlite: '618 µs', cdb: '13.0 µs', x: '47× faster', alloc: '42 B'},
  {q: 'Multi-column distinct', what: 'Distinct over two columns', sqlite: '171 µs', cdb: '13.0 µs', x: '13× faster', alloc: '80 B'},
  {q: 'Hash join', what: 'Inner-join two tables on a key', sqlite: '380 µs', cdb: '13.4 µs', x: '28× faster', alloc: '2 B'},
  {q: 'Aggregate · string key', what: 'Count grouped by a string column', sqlite: '408 µs', cdb: '15.1 µs', x: '27× faster', alloc: '41 B'},
  {q: 'Complex expression', what: 'Arithmetic projection, then filter on the result', sqlite: '258 µs', cdb: '22.4 µs', x: '12× faster', alloc: '147 B'},
];

// The O(1)-vs-O(n) scaling story, from PortableScanSourceBenchmarks. Slot/delegate are the two
// production-representative scan sources (delegate = the real per-column projection-delegate scan,
// like TypedTableScanProvider). A keyed lookup is flat across sizes; a scan grows with the row count,
// and the production delegate source costs ~2× the flat slot source on scan-bound work.
export const INTERP_SCALING: InterpScalingRow[] = [
  {scenario: 'Point lookup', rows: '1,000', slot: '19 ns', delegate: '30 ns', note: 'flat — O(1) keyed'},
  {scenario: 'Point lookup', rows: '10,000', slot: '19 ns', delegate: '30 ns', note: 'flat'},
  {scenario: 'Point lookup', rows: '100,000', slot: '19 ns', delegate: '30 ns', note: 'flat'},
  {scenario: 'Scan · filter · project', rows: '1,000', slot: '7.9 µs', delegate: '16 µs', note: 'scan grows with rows'},
  {scenario: 'Scan · filter · project', rows: '10,000', slot: '75 µs', delegate: '159 µs', note: '≈10× the rows'},
  {scenario: 'Scan · filter · project', rows: '100,000', slot: '662 µs', delegate: '1.50 ms', note: '≈10× the rows'},
];

// Numbers referenced inline in the section prose.
export const INTERP_SUMMARY = {
  scenarios: 17,
  fasterThanSqlite: 17,
  speedupRange: '4.7–57×',
  pointLookupVsSqlite: '31×',
  pointLookupNs: '23 ns',
  heaviestAlloc: '265 B',
  productionScanFactor: '~2×',
  host: 'Apple M4 Max · .NET 8 · single thread',
  corpusRows: 1000,
};

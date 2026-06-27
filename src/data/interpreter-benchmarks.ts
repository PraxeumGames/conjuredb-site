// Hand-maintained metrics for the portable (no-JIT) interpreter lane — the ConjureDB-branded surface
// of the project's portable-runtime benchmarks. NOT auto-generated (unlike ./benchmarks.ts); update
// it from the BenchmarkDotNet results recorded in
// UniMemory.Benchmarks/PortableRuntime/portable-perf-baseline.md.
//
// Source runs (Apple M4 Max, .NET 8.0.11 Arm64, BenchmarkDotNet v0.14.0, InProcessEmitToolchain,
// WarmupCount=4, IterationCount=8, workstation GC):
//   - PortableVsSqliteBenchmarks     → each scenario vs equivalent SQL on an in-memory SQLite DB
//                                       seeded with the IDENTICAL 1000/1000/500-row data (the headline)
//   - PortableInterpreterBenchmarks  → the 16-scenario ns/query + alloc table (1000-row corpus)
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
  {n: '1.2–36×', l: 'faster than SQLite across 16 query shapes'},
  {n: '16 / 16', l: 'scenarios faster than SQLite, zero-alloc'},
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
    title: 'Still zero-allocation',
    body: 'Pooled hashtables and arena-backed key/accumulator buffers keep every operator off the heap: ≤ ~600 bytes per query for the heaviest scenario, and 0 bytes for a point lookup.',
  },
  {
    title: 'O(1) keyed lookups',
    body: 'A primary-key probe is constant-time — about 19 ns whether the table holds a thousand rows or a hundred thousand — because the lane uses the same index as the compiled path, not a scan.',
  },
  {
    title: 'Parity, not approximation',
    body: 'The interpreter produces bit-identical results to the AOT C# lane — same rows, ordering and null semantics — continuously verified by differential and SQL-parity tests.',
  },
];

// The full 16-scenario comparison vs SQLite (same query, same 1000/1000/500-row in-memory data,
// PK index only on both, prepared statements, full result materialized). Ordered by ConjureDB
// per-query latency (cheapest first). "x" = SQLite mean / ConjureDB mean.
export const INTERP_SCENARIOS: InterpScenario[] = [
  {q: 'Point lookup', what: 'Fetch one row by primary key', sqlite: '682 ns', cdb: '19 ns', x: '36× faster', alloc: '0 B'},
  {q: 'Hash aggregate', what: 'Count rows grouped by a column', sqlite: '102 µs', cdb: '3.98 µs', x: '26× faster', alloc: '96 B'},
  {q: 'Distinct', what: 'Distinct values of one column', sqlite: '31.5 µs', cdb: '7.32 µs', x: '4.3× faster', alloc: '128 B'},
  {q: 'Scan · filter · project', what: 'Filter a table, project three columns', sqlite: '155 µs', cdb: '8.17 µs', x: '19× faster', alloc: '41 B'},
  {q: 'Range top-N', what: 'Filter, sort by score, take 10', sqlite: '32.4 µs', cdb: '11.7 µs', x: '2.8× faster', alloc: '176 B'},
  {q: 'Multi-column distinct', what: 'Distinct over two columns', sqlite: '164 µs', cdb: '13.0 µs', x: '13× faster', alloc: '81 B'},
  {q: 'Sort top-N', what: 'Sort by price, take 10', sqlite: '18.2 µs', cdb: '14.8 µs', x: '1.2× faster', alloc: '282 B'},
  {q: 'Multi-key aggregate', what: 'Count + sum grouped by two columns', sqlite: '290 µs', cdb: '27.7 µs', x: '10× faster', alloc: '140 B'},
  {q: 'Complex expression', what: 'Arithmetic projection, then filter on the result', sqlite: '263 µs', cdb: '35.0 µs', x: '7.5× faster', alloc: '149 B'},
  {q: 'Aggregate · string key', what: 'Count grouped by a string column', sqlite: '418 µs', cdb: '44.2 µs', x: '9.5× faster', alloc: '136 B'},
  {q: 'Hash join', what: 'Inner-join two tables on a key', sqlite: '377 µs', cdb: '47.5 µs', x: '7.9× faster', alloc: '402 B'},
  {q: 'Aggregate · double key', what: 'Sum grouped by a floating-point column', sqlite: '492 µs', cdb: '51.1 µs', x: '9.6× faster', alloc: '151 B'},
  {q: 'Set intersect', what: 'Intersect two result sets (dedup)', sqlite: '127 µs', cdb: '53.3 µs', x: '2.4× faster', alloc: '403 B'},
  {q: 'Set union', what: 'Union two result sets (dedup)', sqlite: '125 µs', cdb: '55.8 µs', x: '2.2× faster', alloc: '349 B'},
  {q: 'Multi-aggregate', what: 'Count/sum/min/max grouped by a column', sqlite: '146 µs', cdb: '60.8 µs', x: '2.4× faster', alloc: '152 B'},
  {q: 'Window · row_number', what: 'row_number() over a sorted partition', sqlite: '489 µs', cdb: '160 µs', x: '3.1× faster', alloc: '596 B'},
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
  scenarios: 16,
  fasterThanSqlite: 16,
  speedupRange: '1.2–36×',
  pointLookupVsSqlite: '36×',
  pointLookupNs: '19 ns',
  heaviestAlloc: '596 B',
  productionScanFactor: '~2×',
  host: 'Apple M4 Max · .NET 8 · single thread',
  corpusRows: 1000,
};

// Hand-maintained metrics for the portable (no-JIT) interpreter lane — the ConjureDB-branded surface
// of the project's portable-runtime benchmarks. NOT auto-generated (unlike ./benchmarks.ts); update
// it from current BenchmarkDotNet exports. Older historical notes live in
// UniMemory.Benchmarks/PortableRuntime/portable-perf-baseline.md.
//
// Source runs (Apple M4 Max, .NET 8.0.11 Arm64, BenchmarkDotNet v0.14.0, InProcessEmitToolchain,
// WarmupCount=4, IterationCount=8, workstation GC, default tiered JIT):
//   - PortableVsSqliteBenchmarks     → each scenario vs equivalent SQL on an in-memory SQLite DB
//                                       seeded with the IDENTICAL 1000/1000/500-row data (the headline table)
//                                       current artifact:
//                                       UniMemory_2/.ai/investigations/2026-07-02-1119-portable-interpreter-topn-fullscan-overhead-bdn-full-23.json
//   - PortableInterpreterBenchmarks  → portable-only corroborating ns/query + alloc table (1000-row corpus)
//   - ExpressionVmSuperinstructionBenchmarks and --portable-superinstructions-corpus
//                                     → fused-vs-defused expression opcode evidence
//   - PortableScanSourceBenchmarks   → internal runtime proof gate; not surfaced here
//
// SQLite gets fast pragmas, a Prepare()d statement, a PK index, and matching secondary indexes for
// the index-aware scenarios; both engines fully materialize the result. These are
// measurements of one configuration (1000/1000/500-row Players/Orders/Products in-memory tables,
// one thread, one host) — not a guarantee.

export type InterpStat = {n: string; l: string};
export type InterpReason = {title: string; body: string};
// sqlite/cdb/x mirror the main benchmark tables' shape: baseline time, ConjureDB time, "N× faster".
export type InterpScenario = {q: string; what: string; sqlite: string; cdb: string; x: string; alloc: string};

// Headline cards for the section hero band.
export const INTERP_STATS: InterpStat[] = [
  {n: '4.2–50×', l: 'faster than SQLite across 23 relational shapes'},
  {n: '23 / 23', l: 'relational scenarios faster than SQLite'},
  {n: '~18×', l: 'indexed range top-N vs portable full scan'},
  {n: '0 B', l: 'allocation on a keyed point lookup'},
];

// The "why this lane is still fast" cards (2×2 grid, mirrors the compiled-path "Four reasons").
export const INTERP_REASONS: InterpReason[] = [
  {
    title: 'No JIT, no codegen',
    body: 'Config-delivered queries ship as a pre-verified bytecode and run through a register-based interpreter — no runtime IL emission, no reflection — so they work on iOS and Unity/IL2CPP where a JIT cannot.',
  },
  {
    title: 'Allocation-light runtime',
    body: 'Pooled hashtables and arena-backed key/accumulator buffers keep allocation tiny: 0 bytes for a point lookup, and no current 23-scenario vs-SQLite corpus case above 152 bytes per query.',
  },
  {
    title: 'Index-backed access',
    body: 'A primary-key probe is constant-time at about 49 ns in the current vs-SQLite harness, and secondary-index plans use the same ordered accessors as the compiled path. Indexed range top-N is about 18× faster than the portable full-scan variant.',
  },
  {
    title: 'Parity, not approximation',
    body: 'The interpreter produces bit-identical results to the AOT C# lane — same rows, ordering and null semantics — continuously verified by differential and SQL-parity tests.',
  },
];

// The full 23-scenario comparison vs SQLite (same query, same 1000/1000/500-row in-memory data,
// matching indexes for each scenario, prepared statements, full result materialized). Ordered by ConjureDB
// per-query latency (cheapest first). "x" = SQLite mean / ConjureDB mean.
export const INTERP_SCENARIOS: InterpScenario[] = [
  {q: 'Point lookup', what: 'Fetch one row by primary key', sqlite: '634 ns', cdb: '49 ns', x: '13× faster', alloc: '0 B'},
  {q: 'Indexed range top-N', what: 'Use score index for range filter + top 10', sqlite: '7.59 µs', cdb: '433 ns', x: '18× faster', alloc: '40 B'},
  {q: 'Indexed stock top-N', what: 'Use stock index for range filter + top 10', sqlite: '2.54 µs', cdb: '525 ns', x: '4.8× faster', alloc: '40 B'},
  {q: 'Indexed score lookup', what: 'Use score index for equality lookup', sqlite: '22.9 µs', cdb: '1.51 µs', x: '15× faster', alloc: '40 B'},
  {q: 'Sort top-N', what: 'Sort by price, take 10', sqlite: '17.8 µs', cdb: '2.57 µs', x: '6.9× faster', alloc: '152 B'},
  {q: 'Distinct', what: 'Distinct values of one column', sqlite: '31.0 µs', cdb: '2.98 µs', x: '10× faster', alloc: '40 B'},
  {q: 'Multi-column distinct', what: 'Distinct over two columns', sqlite: '165 µs', cdb: '4.28 µs', x: '38× faster', alloc: '96 B'},
  {q: 'Hash aggregate', what: 'Count rows grouped by a column', sqlite: '110 µs', cdb: '4.28 µs', x: '26× faster', alloc: '96 B'},
  {q: 'Indexed scan · filter · project', what: 'Use level index, then project three columns', sqlite: '174 µs', cdb: '6.26 µs', x: '28× faster', alloc: '40 B'},
  {q: 'Set union', what: 'Union two result sets (dedup)', sqlite: '126 µs', cdb: '6.30 µs', x: '20× faster', alloc: '97 B'},
  {q: 'Set intersect', what: 'Intersect two result sets (dedup)', sqlite: '128 µs', cdb: '6.34 µs', x: '20× faster', alloc: '97 B'},
  {q: 'Score lookup', what: 'Scan/filter rows by score equality', sqlite: '37.8 µs', cdb: '6.60 µs', x: '5.7× faster', alloc: '40 B'},
  {q: 'Scan · filter · project', what: 'Filter a table, project three columns', sqlite: '160 µs', cdb: '7.60 µs', x: '21× faster', alloc: '41 B'},
  {q: 'Range top-N', what: 'Filter, sort by score, take 10', sqlite: '33.4 µs', cdb: '7.81 µs', x: '4.3× faster', alloc: '152 B'},
  {q: 'Multi-key aggregate', what: 'Count + sum grouped by two columns', sqlite: '301 µs', cdb: '9.30 µs', x: '32× faster', alloc: '97 B'},
  {q: 'Aggregate · double key', what: 'Sum grouped by a floating-point column', sqlite: '471 µs', cdb: '9.69 µs', x: '49× faster', alloc: '42 B'},
  {q: 'Window · row_number', what: 'row_number() over a sorted partition', sqlite: '490 µs', cdb: '11.5 µs', x: '43× faster', alloc: '129 B'},
  {q: 'Product stock top-N', what: 'Full-scan filter, sort by stock, take 10', sqlite: '48.3 µs', cdb: '11.5 µs', x: '4.2× faster', alloc: '152 B'},
  {q: 'Multi-aggregate', what: 'Count/sum/min/max grouped by a column', sqlite: '152 µs', cdb: '12.7 µs', x: '12× faster', alloc: '40 B'},
  {q: 'Window · running sum', what: 'Running SUM() over an ordered frame', sqlite: '772 µs', cdb: '15.5 µs', x: '50× faster', alloc: '99 B'},
  {q: 'Aggregate · string key', what: 'Count grouped by a string column', sqlite: '404 µs', cdb: '15.9 µs', x: '25× faster', alloc: '42 B'},
  {q: 'Hash join', what: 'Inner-join two tables on a key', sqlite: '381 µs', cdb: '17.8 µs', x: '21× faster', alloc: '3 B'},
  {q: 'Complex expression', what: 'Arithmetic projection, then filter on the result', sqlite: '242 µs', cdb: '25.6 µs', x: '9.4× faster', alloc: '147 B'},
];

// Numbers referenced inline in the section prose.
export const INTERP_SUMMARY = {
  scenarios: 23,
  fasterThanSqlite: 23,
  speedupRange: '4.2–50×',
  pointLookupVsSqlite: '13×',
  pointLookupNs: '49 ns',
  heaviestAlloc: '152 B',
  currentCorpusScenarios: 23,
  indexedRangeVsFullScan: '~18×',
  superinstructionHitGeomean: '+6.5%',
  host: 'Apple M4 Max · .NET 8 · single thread',
  corpusRows: 1000,
  corpusShape: '1000/1000/500-row Players/Orders/Products corpus',
};

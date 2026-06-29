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
//   - ExpressionVmSuperinstructionBenchmarks and --portable-superinstructions-corpus
//                                     → fused-vs-defused expression opcode evidence
//   - PortableScanSourceBenchmarks   → internal runtime proof gate; not surfaced here
//
// SQLite gets fast pragmas, a Prepare()d statement, and a PK index only — matching the portable
// corpus's index availability — and both engines fully materialize the result. These are
// measurements of one configuration (1000-row in-memory tables, one thread, one host) — not a
// guarantee.

export type InterpStat = {n: string; l: string};
export type InterpReason = {title: string; body: string};
// sqlite/cdb/x mirror the main benchmark tables' shape: baseline time, ConjureDB time, "N× faster".
export type InterpScenario = {q: string; what: string; sqlite: string; cdb: string; x: string; alloc: string};

// Headline cards for the section hero band.
export const INTERP_STATS: InterpStat[] = [
  {n: '4.8–52×', l: 'faster than SQLite across 17 relational shapes'},
  {n: '17 / 17', l: 'relational scenarios faster than SQLite'},
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
    body: 'Pooled hashtables and arena-backed key/accumulator buffers keep allocation tiny: 0 bytes for a point lookup, and no current 21-scenario corpus case above 193 bytes per query.',
  },
  {
    title: 'O(1) keyed lookups',
    body: 'A primary-key probe is constant-time — about 31 ns in the current vs-SQLite harness and 33 ns in the full portable corpus — because the lane uses the same index as the compiled path, not a scan.',
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
  {q: 'Point lookup', what: 'Fetch one row by primary key', sqlite: '719 ns', cdb: '31.2 ns', x: '23× faster', alloc: '0 B'},
  {q: 'Sort top-N', what: 'Sort by price, take 10', sqlite: '18.1 µs', cdb: '2.50 µs', x: '7.2× faster', alloc: '176 B'},
  {q: 'Hash aggregate', what: 'Count rows grouped by a column', sqlite: '110 µs', cdb: '4.25 µs', x: '26× faster', alloc: '96 B'},
  {q: 'Set intersect', what: 'Intersect two result sets (dedup)', sqlite: '126 µs', cdb: '5.46 µs', x: '23× faster', alloc: '57 B'},
  {q: 'Set union', what: 'Union two result sets (dedup)', sqlite: '123 µs', cdb: '5.47 µs', x: '23× faster', alloc: '57 B'},
  {q: 'Range top-N', what: 'Filter, sort by score, take 10', sqlite: '33.2 µs', cdb: '5.64 µs', x: '5.9× faster', alloc: '176 B'},
  {q: 'Scan · filter · project', what: 'Filter a table, project three columns', sqlite: '157 µs', cdb: '6.55 µs', x: '24× faster', alloc: '41 B'},
  {q: 'Distinct', what: 'Distinct values of one column', sqlite: '31.8 µs', cdb: '6.67 µs', x: '4.8× faster', alloc: '80 B'},
  {q: 'Aggregate · double key', what: 'Sum grouped by a floating-point column', sqlite: '509 µs', cdb: '9.77 µs', x: '52× faster', alloc: '42 B'},
  {q: 'Window · row_number', what: 'row_number() over a sorted partition', sqlite: '492 µs', cdb: '9.91 µs', x: '50× faster', alloc: '129 B'},
  {q: 'Multi-aggregate', what: 'Count/sum/min/max grouped by a column', sqlite: '154 µs', cdb: '11.4 µs', x: '14× faster', alloc: '40 B'},
  {q: 'Hash join', what: 'Inner-join two tables on a key', sqlite: '390 µs', cdb: '13.9 µs', x: '28× faster', alloc: '2 B'},
  {q: 'Multi-column distinct', what: 'Distinct over two columns', sqlite: '171 µs', cdb: '13.9 µs', x: '12× faster', alloc: '81 B'},
  {q: 'Window · running sum', what: 'Running SUM() over an ordered frame', sqlite: '619 µs', cdb: '14.4 µs', x: '43× faster', alloc: '98 B'},
  {q: 'Aggregate · string key', what: 'Count grouped by a string column', sqlite: '434 µs', cdb: '16.3 µs', x: '27× faster', alloc: '42 B'},
  {q: 'Complex expression', what: 'Arithmetic projection, then filter on the result', sqlite: '266 µs', cdb: '22.7 µs', x: '12× faster', alloc: '147 B'},
  {q: 'Multi-key aggregate', what: 'Count + sum grouped by two columns', sqlite: '309 µs', cdb: '28.6 µs', x: '11× faster', alloc: '140 B'},
];

// Numbers referenced inline in the section prose.
export const INTERP_SUMMARY = {
  scenarios: 17,
  fasterThanSqlite: 17,
  speedupRange: '4.8–52×',
  pointLookupVsSqlite: '23×',
  pointLookupNs: '31 ns',
  heaviestAlloc: '193 B',
  currentCorpusScenarios: 21,
  superinstructionHitGeomean: '+6.5%',
  host: 'Apple M4 Max · .NET 8 · single thread',
  corpusRows: 1000,
};

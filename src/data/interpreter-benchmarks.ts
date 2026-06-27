// Hand-maintained metrics for the portable (no-JIT) interpreter lane — the ConjureDB-branded surface
// of the project's portable-runtime benchmarks. NOT auto-generated (unlike ./benchmarks.ts); update
// it from the BenchmarkDotNet results recorded in
// UniMemory.Benchmarks/PortableRuntime/portable-perf-baseline.md.
//
// Source runs (Apple M4 Max, .NET 8.0.11 Arm64, BenchmarkDotNet v0.14.0, InProcessEmitToolchain,
// WarmupCount=4, IterationCount=8, workstation GC):
//   - PortableInterpreterBenchmarks  → the 16-scenario ns/query + alloc table (1000-row corpus)
//   - PortableScanSourceBenchmarks   → delegate-vs-slot scan source × table size (the scaling table)
//   - PortableThroughputBenchmarks   → sustained ops/sec for the representative scenarios
//
// queries/sec is the derived single-thread 1e9 / Mean_ns. These are measurements of one
// configuration (1000-row in-memory tables, one thread, one host) — not a guarantee.

export type InterpStat = {n: string; l: string};
export type InterpReason = {title: string; body: string};
export type InterpScenario = {q: string; what: string; ns: string; alloc: string; qps: string};
export type InterpScalingRow = {scenario: string; rows: string; slot: string; delegate: string; note: string};

// Headline cards for the section hero band.
export const INTERP_STATS: InterpStat[] = [
  {n: '52M / s', l: 'point lookups, one thread (O(1), 0 B)'},
  {n: '0 B', l: 'allocation on a keyed lookup'},
  {n: '16 / 16', l: 'operator scenarios amortized zero-alloc'},
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

// The full 16-scenario throughput / allocation table (1000-row corpus). ns = Mean per query;
// qps = derived 1e9 / Mean_ns single-thread throughput.
export const INTERP_SCENARIOS: InterpScenario[] = [
  {q: 'Point lookup', what: 'Fetch one row by primary key', ns: '19.3 ns', alloc: '0 B', qps: '51.9M'},
  {q: 'Hash aggregate', what: 'Count rows grouped by a column', ns: '3.80 µs', alloc: '96 B', qps: '263K'},
  {q: 'Distinct', what: 'Distinct values of one column', ns: '7.40 µs', alloc: '128 B', qps: '135K'},
  {q: 'Scan · filter · project', what: 'Filter a table, project three columns', ns: '8.26 µs', alloc: '41 B', qps: '121K'},
  {q: 'Range top-N', what: 'Filter, sort by score, take 10', ns: '12.1 µs', alloc: '176 B', qps: '82.6K'},
  {q: 'Multi-column distinct', what: 'Distinct over two columns', ns: '13.3 µs', alloc: '81 B', qps: '75.4K'},
  {q: 'Sort top-N', what: 'Sort by price, take 10', ns: '14.6 µs', alloc: '282 B', qps: '68.4K'},
  {q: 'Multi-key aggregate', what: 'Count + sum grouped by two columns', ns: '28.0 µs', alloc: '140 B', qps: '35.7K'},
  {q: 'Complex expression', what: 'Arithmetic projection, then filter on the result', ns: '34.3 µs', alloc: '149 B', qps: '29.2K'},
  {q: 'Aggregate · string key', what: 'Count grouped by a string column', ns: '43.9 µs', alloc: '136 B', qps: '22.8K'},
  {q: 'Hash join', what: 'Inner-join two tables on a key', ns: '48.9 µs', alloc: '402 B', qps: '20.4K'},
  {q: 'Aggregate · double key', what: 'Sum grouped by a floating-point column', ns: '51.5 µs', alloc: '151 B', qps: '19.4K'},
  {q: 'Set intersect', what: 'Intersect two result sets (dedup)', ns: '54.9 µs', alloc: '403 B', qps: '18.2K'},
  {q: 'Set union', what: 'Union two result sets (dedup)', ns: '56.2 µs', alloc: '349 B', qps: '17.8K'},
  {q: 'Multi-aggregate', what: 'Count/sum/min/max grouped by a column', ns: '57.4 µs', alloc: '152 B', qps: '17.4K'},
  {q: 'Window · row_number', what: 'row_number() over a sorted partition', ns: '161 µs', alloc: '596 B', qps: '6.2K'},
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
  zeroAllocScenarios: 16,
  pointLookupNs: '19 ns',
  pointLookupQps: '52M',
  heaviestAlloc: '596 B',
  allocReduction: '99.5%',
  productionScanFactor: '~2×',
  lookupVsScanAt100k: '~35,000×',
  host: 'Apple M4 Max · .NET 8 · single thread',
  corpusRows: 1000,
};

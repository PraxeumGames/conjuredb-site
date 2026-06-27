import type {ReactNode} from 'react';
import Link from '@docusaurus/Link';
import Layout from '@theme/Layout';
import {BenchmarkExplorer} from '@site/src/components/BenchmarkExplorer';
import {BenchVerdict} from '@site/src/components/BenchVerdict';
import {BENCH_SUMMARY} from '@site/src/data/benchmarks';
import {
  INTERP_STATS,
  INTERP_REASONS,
  INTERP_SCENARIOS,
  INTERP_SCALING,
  INTERP_SUMMARY,
} from '@site/src/data/interpreter-benchmarks';
import styles from './marketing.module.css';

function Header(): ReactNode {
  return (
    <header className={styles.pageHead}>
      <div className="container">
        <span className="cdb-kicker">Performance</span>
        <h1 className={styles.pageTitle}>Fast because of what it doesn't do</h1>
        <p className={styles.pageLead}>
          ConjureDB is fast for structural reasons, not tricks: compilation removes runtime
          parsing and planning; declared indexes turn the lists you'd loop over every frame
          into O(1) or O(log n) lookups; the query hot path avoids heap allocations; and
          reactive views apply deltas instead of recomputing. The numbers below follow from
          that — and we tell you exactly how they were measured.
        </p>
      </div>
    </header>
  );
}

const PERF_STATS: {n: string; l: string}[] = [
  {n: '56 / 56', l: 'production queries ≥50× vs SQLite'},
  {n: '108×', l: 'PK lookup'},
  {n: '661×', l: 'leaderboard top-N'},
  {n: '0', l: 'queries slower than SQLite'},
];

function PerfStats(): ReactNode {
  return (
    <section className="cdb-section cdb-section--tight">
      <div className="container">
        <div className="cdb-stats">
          {PERF_STATS.map((s) => (
            <div className="cdb-stat" key={s.l}>
              <b>{s.n}</b>
              <span>{s.l}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

const WHY: {title: string; body: string}[] = [
  {title: 'Nothing is interpreted', body: 'Queries are compiled to C# at build time. There is no parser or planner on the hot path at runtime.'},
  {title: 'Indexes you declare', body: 'A matching index turns a full scan into a direct lookup or a bounded range walk — chosen by the optimizer.'},
  {title: 'Allocation-lean paths', body: 'Struct storage, ref returns and pooled buffers keep query evaluation off the heap; only the result collection is materialized, so per-query GC stays low.'},
  {title: 'Deltas, not recomputes', body: 'Incremental view maintenance updates reactive results by the size of the change, not the size of the table.'},
];

function Why(): ReactNode {
  return (
    <section className="cdb-section">
      <div className="container">
        <span className="cdb-kicker">Where the speed comes from</span>
        <h2 className="cdb-h2">Four structural reasons</h2>
        <div className="cdb-grid" style={{gridTemplateColumns: 'repeat(2, 1fr)', marginTop: '1.6rem'}}>
          {WHY.map((w) => (
            <div className="cdb-card" key={w.title}>
              <h3>{w.title}</h3>
              <p>{w.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

type Row = {q: string; what: string; sqlite: string; dictDefault?: string; cdb: string; x: string};
// BenchmarkDotNet (.NET 8, 50,000 records, 4 warmup + 8 iterations, median shown).
// Baseline = Dictionary<int,object> with preset capacity where a matching Dictionary row exists.
// ConjureDB numbers include the June 2026 direct-commit/generated-mutation rewrite
// and current-set generated mutation slow-path split.
const VS_DICT_READS: Row[] = [
  {q: 'Search', what: 'Look up 50k items by id (dense-id index = a direct array hit)', sqlite: '753 µs', cdb: '56.0 µs', x: '13× faster'},
  {q: 'Iterate', what: 'Scan all 50k — a flat contiguous span', sqlite: '87.1 µs', cdb: '88.4 µs', x: '≈ parity'},
];

// BenchmarkDotNet SimpleCrudLongPerfCompare (.NET 8, 5,000,000 records/operations,
// 4 warmup + 8 iterations, median shown). CRUD write lane uses a longer body to avoid
// short-iteration/tiered-JIT artifacts; measured with tiered compilation/PGO disabled.
const VS_DICT_CRUD: Row[] = [
  {q: 'Add — batched', what: 'Insert 5M with bulk Add(T[]) in one transaction', sqlite: '22.5 ms', dictDefault: '33.5 ms', cdb: '28.5 ms', x: '1.3× slower'},
  {q: 'Add — explicit tx / 10 calls', what: 'Insert 5M via BeginTransaction + 10 Add calls + Commit', sqlite: '22.5 ms', dictDefault: '33.5 ms', cdb: '122 ms', x: '5.4× slower'},
  {q: 'Add — bulk API / 10 rows', what: 'Insert 5M via BeginTransaction + Add(T[10]) + Commit', sqlite: '22.5 ms', dictDefault: '33.5 ms', cdb: '60.3 ms', x: '2.7× slower'},
  {q: 'Add — direct 1 / commit', what: 'Insert 5M via the direct single-row commit API', sqlite: '22.5 ms', dictDefault: '33.5 ms', cdb: '23.8 ms', x: '≈ parity'},
  {q: 'Add — generated mutation', what: 'Insert 5M through the generated command/mutation API', sqlite: '22.5 ms', dictDefault: '33.5 ms', cdb: '27.2 ms', x: '1.2× slower'},
  {q: 'Update — direct 1 / commit', what: 'Update 5M existing rows through the direct single-row commit API', sqlite: '15.0 ms', cdb: '15.8 ms', x: '≈ parity'},
  {q: 'Update — generated mutation', what: 'Update 5M existing rows through the generated command/mutation API', sqlite: '15.0 ms', cdb: '21.8 ms', x: '1.5× slower'},
  {q: 'Upsert — update existing', what: 'Upsert 5M existing rows through the generated command/mutation API', sqlite: '14.9 ms', cdb: '22.8 ms', x: '1.5× slower'},
  {q: 'Upsert — insert miss', what: 'Upsert 5M missing rows through the generated command/mutation API', sqlite: '22.3 ms', dictDefault: '34.0 ms', cdb: '38.2 ms', x: '1.7× slower'},
  {q: 'Remove — batched', what: 'Delete 5M with bulk Remove(int[]) in one transaction', sqlite: '16.0 ms', cdb: '18.0 ms', x: '1.1× slower'},
  {q: 'Remove — explicit tx / 10 calls', what: 'Delete 5M via BeginTransaction + 10 Remove calls + Commit', sqlite: '16.0 ms', cdb: '97.8 ms', x: '6.1× slower'},
  {q: 'Remove — bulk API / 10 rows', what: 'Delete 5M via BeginTransaction + Remove(int[10]) + Commit', sqlite: '16.0 ms', cdb: '47.0 ms', x: '2.9× slower'},
  {q: 'Remove — direct 1 / commit', what: 'Delete 5M via the direct single-row commit API', sqlite: '16.0 ms', cdb: '19.8 ms', x: '1.2× slower'},
  {q: 'Remove — generated mutation', what: 'Delete 5M through the generated command/mutation API', sqlite: '16.0 ms', cdb: '19.7 ms', x: '1.2× slower'},
];

function Table({
  title,
  head,
  rows,
  baseline,
  secondaryBaseline,
  resultHeader = 'Result',
}: {
  title: string;
  head: string;
  rows: Row[];
  baseline: string;
  secondaryBaseline?: string;
  resultHeader?: string;
}): ReactNode {
  return (
    <div style={{marginTop: '2rem'}}>
      <h3 style={{marginBottom: '0.3rem'}}>{title}</h3>
      <p className="cdb-lead" style={{fontSize: '0.95rem'}}>{head}</p>
      <div className={styles.tableWrap}>
        <table className={styles.benchTable}>
          <thead>
            <tr>
              <th>Operation</th>
              <th>What it does</th>
              <th className="num">{baseline}</th>
              {secondaryBaseline ? <th className="num">{secondaryBaseline}</th> : null}
              <th className="num">ConjureDB</th>
              <th>{resultHeader}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.q}>
                <td>{r.q}</td>
                <td style={{color: 'var(--cdb-muted)'}}>{r.what}</td>
                <td className="num">{r.sqlite}</td>
                {secondaryBaseline ? <td className="num">{r.dictDefault ?? '—'}</td> : null}
                <td className="num">{r.cdb}</td>
                <td className={r.x.includes('faster') || r.x.includes('parity') ? styles.win : ''}>{r.x}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Verdict(): ReactNode {
  return (
    <section className="cdb-section">
      <div className="container">
        <span className="cdb-kicker">The verdict</span>
        <h2 className="cdb-h2">LINQ vs SQLite vs ConjureDB</h2>
        <p className="cdb-lead">
          The same queries, the same 50,000-row data, three ways to run them: the hand-written LINQ a
          developer reaches for first, embedded SQLite, and ConjureDB. Here is how they stack up.
        </p>
        <BenchVerdict />
      </div>
    </section>
  );
}

function Families(): ReactNode {
  return (
    <section className="cdb-section" style={{background: 'var(--cdb-surface)'}}>
      <div className="container">
        <span className="cdb-kicker">The coverage</span>
        <h2 className="cdb-h2">Every query shape, measured</h2>
        <p className="cdb-lead">
          The verdict above isn't one cherry-picked query. It holds across a governed taxonomy of{' '}
          <strong>{BENCH_SUMMARY.families} query families</strong> — {BENCH_SUMMARY.caseCount}{' '}
          BenchmarkDotNet cases vs SQLite at 50,000 players, spanning filters, lookups, joins,
          aggregation, windows, semi/anti/exists, set operations, outer joins, distinct and
          sort/pagination. All <strong>{BENCH_SUMMARY.releaseCommon} production-tier cases run
          ≥{BENCH_SUMMARY.target}×</strong>, none slower; the weakest is {BENCH_SUMMARY.weakest}×.
          Every row carries all three baselines side by side — open one for the ConjureDB, LINQ and
          SQL form and the per-engine timings. Browse by family:
        </p>
        <BenchmarkExplorer />
        <p className={styles.caveat}>
          Methodology: ConjureDB and SQLite figures are from the project's authoritative all-case
          BenchmarkDotNet proof (57 cases) vs SQLite, Release, .NET 8, 50,000-row datasets; the
          best-measured ConjureDB variant is shown per query. The LINQ baseline is measured
          separately on the identical dataset and query parameters (in-process timing). These are{' '}
          <strong>measurements of one configuration — not a guarantee</strong>. Your game is
          different: schema, hardware and generated plan all matter, so benchmark your own workload.
          Raw benchmark data ships with the source.
        </p>
      </div>
    </section>
  );
}

function VsDict(): ReactNode {
  return (
    <section className="cdb-section">
      <div className="container">
        <span className="cdb-kicker">A different yardstick</span>
        <h2 className="cdb-h2">And against a plain Dictionary</h2>
        <p className="cdb-lead">
          SQLite and LINQ are query baselines. For raw collection operations the honest comparison
          is a <code>Dictionary</code> — and ConjureDB is honest both ways.
        </p>
        <div className={styles.dictCard}>
          <Table
            title="vs a plain Dictionary — raw reads"
            head="50,000 items, fair fight: the Dictionary gets preset capacity and does none of the work — no transactions, no indexes, no change tracking, no replay-safe commands. ConjureDB still wins primary-key lookups by using a dense-id index and runs level on a contiguous scan."
            rows={VS_DICT_READS}
            baseline="Dictionary"
          />
          <Table
            title="vs a plain Dictionary — CRUD writes"
            head="5,000,000 operations, median shown. The known-size Dictionary column uses preset capacity; the default-capacity column shows the common missed-capacity case for insert-like operations where resize/rehash happens inside the measured work."
            rows={VS_DICT_CRUD}
            baseline="Dictionary known size"
            secondaryBaseline="Dictionary default"
            resultHeader="Result vs known size"
          />
        </div>
      </div>
    </section>
  );
}

function NoJitRuntime(): ReactNode {
  return (
    <section className="cdb-section" style={{background: 'var(--cdb-surface)'}}>
      <div className="container">
        <span className="cdb-kicker">The other lane</span>
        <h2 className="cdb-h2">And a no-JIT lane for config-delivered queries</h2>
        <p className="cdb-lead">
          Everything above is the compiled lane: queries you know at build time, lowered to C# with
          nothing to interpret at runtime. But some queries ship later — as content or config — and on
          iOS and Unity/IL2CPP you can't JIT or generate code at runtime to run them. ConjureDB runs
          those on a <strong>portable interpreter</strong>: a pre-verified bytecode executed with no
          JIT, no codegen and no reflection. It's a deliberate second lane, not a fallback — and it
          stays fast and allocation-lean.
        </p>

        <div className="cdb-stats">
          {INTERP_STATS.map((s) => (
            <div className="cdb-stat" key={s.l}>
              <b>{s.n}</b>
              <span>{s.l}</span>
            </div>
          ))}
        </div>

        <div className="cdb-grid" style={{gridTemplateColumns: 'repeat(2, 1fr)', marginTop: '1.6rem'}}>
          {INTERP_REASONS.map((r) => (
            <div className="cdb-card" key={r.title}>
              <h3>{r.title}</h3>
              <p>{r.body}</p>
            </div>
          ))}
        </div>

        <div style={{marginTop: '2rem'}}>
          <h3 style={{marginBottom: '0.3rem'}}>Every operator, measured on the no-JIT lane</h3>
          <p className="cdb-lead" style={{fontSize: '0.95rem'}}>
            {INTERP_SUMMARY.scenarios} query shapes on a {INTERP_SUMMARY.corpusRows}-row in-memory
            table, one thread. Every one is amortized zero-allocation; per-query latency tracks how
            much data the query touches, at roughly 10–50 ns per row.
          </p>
          <div className={styles.tableWrap}>
            <table className={styles.benchTable}>
              <thead>
                <tr>
                  <th>Query shape</th>
                  <th>What it does</th>
                  <th className="num">Per query</th>
                  <th className="num">Allocated</th>
                  <th className="num">Queries / sec</th>
                </tr>
              </thead>
              <tbody>
                {INTERP_SCENARIOS.map((r) => (
                  <tr key={r.q}>
                    <td>{r.q}</td>
                    <td style={{color: 'var(--cdb-muted)'}}>{r.what}</td>
                    <td className="num">{r.ns}</td>
                    <td className={r.alloc === '0 B' ? `num ${styles.win}` : 'num'}>{r.alloc}</td>
                    <td className="num">{r.qps}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {INTERP_SCALING.length > 0 ? (
          <div style={{marginTop: '2rem'}}>
            <h3 style={{marginBottom: '0.3rem'}}>O(1) lookups, whatever the table size</h3>
            <p className="cdb-lead" style={{fontSize: '0.95rem'}}>
              The same plans against the production scan source (each column read through a projection
              delegate, like the real engine) as the table grows from 1k to 100k rows. A keyed lookup
              stays flat; a scan grows with the row count — which is exactly why the lane keys point
              lookups instead of scanning them.
            </p>
            <div className={styles.tableWrap}>
              <table className={styles.benchTable}>
                <thead>
                  <tr>
                    <th>Query shape</th>
                    <th className="num">Rows</th>
                    <th className="num">Slot source</th>
                    <th className="num">Delegate source</th>
                    <th>vs row count</th>
                  </tr>
                </thead>
                <tbody>
                  {INTERP_SCALING.map((r) => (
                    <tr key={r.scenario + r.rows}>
                      <td>{r.scenario}</td>
                      <td className="num">{r.rows}</td>
                      <td className="num">{r.slot}</td>
                      <td className="num">{r.delegate}</td>
                      <td className={r.note.toLowerCase().includes('flat') ? styles.win : ''}>{r.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        <p className="cdb-lead" style={{marginTop: '1.6rem', fontSize: '0.95rem'}}>
          Fast for an interpreter — but the compiled C# lane above is still the throughput ceiling.
          Keep your hottest, build-time-known queries there; the portable lane's job is to run the
          queries the compiled lane structurally can't, on platforms a JIT can't.
        </p>
        <p className={styles.caveat}>
          Methodology: {INTERP_SUMMARY.host}, BenchmarkDotNet, {INTERP_SUMMARY.corpusRows}-row
          in-memory tables, median of 8 iterations after 4 warmups; queries/sec is the derived
          1e9 / mean-ns single-thread rate, and allocation is BenchmarkDotNet's managed Allocated/op.
          One configuration — not a guarantee. Benchmark your own workload.
        </p>
      </div>
    </section>
  );
}

function Cta(): ReactNode {
  return (
    <section className="cdb-section cdb-center">
      <div className="container">
        <h2 className="cdb-h2">Speed you can audit</h2>
        <p className="cdb-lead" style={{margin: '0 auto 1.6rem'}}>
          The fastest path is the one with nothing dynamic in it. See how the compiler gets
          there.
        </p>
        <div className={styles.ctaRow} style={{justifyContent: 'center'}}>
          <Link className="button button--primary button--lg" to="/how-it-works">
            How it works
          </Link>
          <Link className="button button--secondary button--lg" to="/docs/performance/performance-tips">
            Performance tips
          </Link>
        </div>
      </div>
    </section>
  );
}

export default function Performance(): ReactNode {
  return (
    <Layout
      title="ConjureDB performance"
      description="ConjureDB is fast for structural reasons: compiled queries, declared indexes, zero-allocation paths and delta-based reactive maintenance. Honest, methodology-first benchmarks vs SQLite and a plain Dictionary.">
      <Header />
      <main>
        <PerfStats />
        <Why />
        <Verdict />
        <Families />
        <VsDict />
        <NoJitRuntime />
        <Cta />
      </main>
    </Layout>
  );
}

import type {ReactNode} from 'react';
import Link from '@docusaurus/Link';
import Layout from '@theme/Layout';
import {BenchmarkExplorer} from '@site/src/components/BenchmarkExplorer';
import {BENCH_SUMMARY} from '@site/src/data/benchmarks';
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

type Row = {q: string; what: string; sqlite: string; cdb: string; x: string};
const VS_DICT: Row[] = [
  {q: 'Search', what: 'Lookup over 50k items', sqlite: '698 µs', cdb: '54 µs', x: '12.85×'},
  {q: 'Add (batched)', what: 'Insert 50k in a transaction', sqlite: '608 µs', cdb: '178 µs', x: '3.41×'},
  {q: 'Iterate', what: 'Scan all 50k', sqlite: '80 µs', cdb: '66 µs', x: '1.21×'},
  {q: 'Remove', what: 'Delete pass', sqlite: '113 µs', cdb: '235 µs', x: '2.1× slower'},
];

function Table({title, head, rows, baseline}: {title: string; head: string; rows: Row[]; baseline: string}): ReactNode {
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
              <th className="num">ConjureDB</th>
              <th>Result</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.q}>
                <td>{r.q}</td>
                <td style={{color: 'var(--cdb-muted)'}}>{r.what}</td>
                <td className="num">{r.sqlite}</td>
                <td className="num">{r.cdb}</td>
                <td className={r.x.includes('slower') ? '' : styles.win}>{r.x}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Numbers(): ReactNode {
  return (
    <section className="cdb-section" style={{background: 'var(--cdb-surface)'}}>
      <div className="container">
        <span className="cdb-kicker">The numbers</span>
        <h2 className="cdb-h2">Measured against real baselines</h2>
        <p className="cdb-lead">
          The 50× number isn't one cherry-picked query. It holds across a governed taxonomy of{' '}
          <strong>{BENCH_SUMMARY.families} query families</strong> — {BENCH_SUMMARY.caseCount}{' '}
          BenchmarkDotNet cases vs SQLite at 50,000 players, spanning filters, lookups, joins,
          aggregation, windows, semi/anti/exists, set operations, outer joins, distinct and
          sort/pagination. All <strong>{BENCH_SUMMARY.releaseCommon} production-tier cases run
          ≥{BENCH_SUMMARY.target}×</strong>, none slower; the weakest is {BENCH_SUMMARY.weakest}×.
          Each case carries three baselines side by side — the hand-written LINQ a developer would
          write by hand, embedded SQLite, and ConjureDB — measured on the same dataset. Browse by
          family:
        </p>
        <BenchmarkExplorer />
        <Table
          title="vs a plain Dictionary — raw collection ops"
          head="50,000 items. Honest both ways: reads are aggressively optimized; the delete pass is slower because the engine maintains an index snapshot, a write-ahead journal and change tracking the Dictionary does not."
          rows={VS_DICT}
          baseline="Dictionary"
        />
        <p className={styles.caveat}>
          Methodology: figures are from the project's authoritative all-case BenchmarkDotNet
          proof (57 cases) vs SQLite, Release, .NET 8, 50,000-row datasets; the best measured
          variant is shown per query. These are <strong>measurements of one configuration —
          not a guarantee</strong>. Your game is different: schema, hardware and generated plan
          all matter, so benchmark your own workload. Raw benchmark data ships with the source.
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
        <Numbers />
        <Cta />
      </main>
    </Layout>
  );
}

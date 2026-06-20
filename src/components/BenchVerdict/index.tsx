import type {ReactNode} from 'react';
import {BENCH_COMPARE} from '@site/src/data/benchmarks';
import styles from './styles.module.css';

const FLOOR_NS = 1000; // 1 µs visual floor so the fastest bar stays visible on a log scale

function barWidth(ns: number, maxNs: number): string {
  const pct =
    ((Math.log10(ns) - Math.log10(FLOOR_NS)) / (Math.log10(maxNs) - Math.log10(FLOOR_NS))) * 100;
  return `${Math.max(7, Math.min(100, pct))}%`;
}

export function BenchVerdict(): ReactNode {
  const c = BENCH_COMPARE;
  if (!c) return null;
  const maxNs = Math.max(c.linqNs, c.sqliteNs, c.cdbNs);
  const bars = [
    {key: 'linq', label: 'Hand-written LINQ', time: c.linqTime, mult: `${c.cdbVsLinq.toLocaleString()}× slower`, ns: c.linqNs, cls: styles.linq},
    {key: 'sqlite', label: 'SQLite', time: c.sqliteTime, mult: `${c.cdbVsSqlite.toLocaleString()}× slower`, ns: c.sqliteNs, cls: styles.sqlite},
    {key: 'cdb', label: 'ConjureDB', time: c.cdbTime, mult: 'baseline', ns: c.cdbNs, cls: styles.cdb},
  ];

  return (
    <div className={styles.wrap}>
      <div className={styles.chart}>
        <div className={styles.chartHead}>
          Typical query time — geometric mean across all {c.cases} cases · log scale
        </div>
        {bars.map((b) => (
          <div key={b.key} className={styles.row}>
            <div className={styles.name}>{b.label}</div>
            <div className={styles.track}>
              <div className={`${styles.bar} ${b.cls}`} style={{width: barWidth(b.ns, maxNs)}}>
                <span className={styles.time}>{b.time}</span>
              </div>
              <span className={styles.mult}>{b.mult}</span>
            </div>
          </div>
        ))}
      </div>

      <div className={styles.stats}>
        <div className={styles.stat}>
          <span className={styles.statNum}>~{c.cdbVsLinq.toLocaleString()}×</span>
          <span className={styles.statLabel}>faster than hand-written LINQ (geomean)</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statNum}>~{c.cdbVsSqlite.toLocaleString()}×</span>
          <span className={styles.statLabel}>faster than SQLite (geomean)</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statNum}>
            {c.linqSlowerThanSqlite}/{c.cases}
          </span>
          <span className={styles.statLabel}>cases where naive LINQ is slower than SQLite</span>
        </div>
      </div>

      <div className={styles.notes}>
        <p className={styles.note}>
          <strong>It’s index hits, not magic.</strong> The biggest multipliers come from a declared
          index turning a full O(n) — or O(n·m) — scan into an O(1)/O(log n) probe. Hand-written
          LINQ over a plain <code>List&lt;T&gt;</code> has no index, so it walks everything; on
          correlated queries that is quadratic, which is why naive LINQ often lands{' '}
          <em>slower than SQLite</em> — SQLite at least has a planner and indexes.
        </p>
        <p className={styles.note}>
          <strong>And this is the floor, not the ceiling.</strong> These are one-shot evaluations —
          ConjureDB runs the query against its indexes on every call, same as SQLite and the LINQ.
          For hot, repeatedly-read queries it can go further with{' '}
          <strong>incremental view maintenance</strong>: instead of re-evaluating, it applies
          O(changes) deltas as data is written and reads just return the maintained result. That
          moves cost to write time — proportional to what changed, not the dataset, and kept off the
          synchronous read path — so it’s a deliberate read/write trade these benchmarks don’t use.
        </p>
      </div>
    </div>
  );
}

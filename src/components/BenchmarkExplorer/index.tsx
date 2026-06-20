import {useState, type ReactNode} from 'react';
import {BENCH_GROUPS} from '@site/src/data/benchmarks';
import styles from './styles.module.css';

export function BenchmarkExplorer(): ReactNode {
  const [active, setActive] = useState(0);
  const g = BENCH_GROUPS[active];
  return (
    <div className={styles.explorer}>
      <div className={styles.tabs} role="tablist">
        {BENCH_GROUPS.map((grp, i) => (
          <button
            key={grp.id}
            type="button"
            role="tab"
            aria-selected={i === active}
            className={i === active ? styles.tabActive : styles.tab}
            onClick={() => setActive(i)}>
            {grp.tab}
            <span className={styles.count}>{grp.rows.length}</span>
          </button>
        ))}
      </div>

      <div className={styles.panel}>
        <div className={styles.panelHead}>
          <h3 className={styles.panelTitle}>{g.title}</h3>
          <span className={styles.range}>
            {g.rows.length} {g.rows.length === 1 ? 'case' : 'cases'}
            {g.range ? ` · ${g.range} vs SQLite` : ''}
          </span>
        </div>

        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Query</th>
                <th className={styles.num}>SQLite</th>
                <th className={styles.num}>ConjureDB</th>
                <th className={styles.num}>Speedup</th>
                <th className={styles.num}>Alloc</th>
              </tr>
            </thead>
            <tbody>
              {g.rows.map((r) => (
                <tr key={r.q}>
                  <td>
                    {r.label}
                    {r.cls === 'StressRare' && <span className={styles.badge}>stress-rare</span>}
                  </td>
                  <td className={styles.num}>{r.sqlite}</td>
                  <td className={styles.num}>{r.cdb}</td>
                  <td className={`${styles.num} ${styles.win}`}>{r.x}</td>
                  <td className={`${styles.num} ${styles.alloc}`}>{r.alloc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

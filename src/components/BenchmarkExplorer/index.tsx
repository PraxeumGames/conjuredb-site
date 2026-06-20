import {Fragment, useState, type ReactNode} from 'react';
import {BENCH_GROUPS, type BenchRow} from '@site/src/data/benchmarks';
import styles from './styles.module.css';

type FormKey = 'dsl' | 'linq' | 'sql';
const FORMS: {key: FormKey; label: string; lang: string}[] = [
  {key: 'dsl', label: 'ConjureDB', lang: 'conjure'},
  {key: 'linq', label: 'Hand-written LINQ', lang: 'csharp'},
  {key: 'sql', label: 'SQLite SQL', lang: 'sql'},
];

function rankClass(rank?: string): string {
  if (rank === 'fast') return styles.rankFast;
  if (rank === 'mid') return styles.rankMid;
  if (rank === 'slow') return styles.rankSlow;
  return '';
}

function Variants({variants}: {variants: NonNullable<BenchRow['variants']>}): ReactNode {
  return (
    <div className={styles.variants}>
      <span className={styles.variantsHead}>Execution variants</span>
      <div className={styles.variantList}>
        {variants.map((v) => (
          <span key={v.kind} className={v.best ? styles.variantBest : styles.variant}>
            <span className={styles.variantKind}>{v.kind}</span>
            <span className={styles.variantTime}>{v.time}</span>
            <span className={styles.variantAlloc}>{v.alloc}</span>
            {v.best && <span className={styles.variantFlag}>fastest</span>}
          </span>
        ))}
      </div>
      <p className={styles.variantNote}>
        Each query compiles into materializing, zero-allocation (<code>NoAlloc</code>) and streaming
        (<code>ForEach</code>) entry points — the fastest is what the table shows.
      </p>
    </div>
  );
}

function LinqCallout({row}: {row: BenchRow}): ReactNode {
  if (!row.linqNs || !row.linqVsCdb) return null;
  return (
    <div className={styles.callout}>
      <span className={styles.calloutBolt} aria-hidden>
        ⚡
      </span>
      <span>
        ConjureDB runs this <b className={styles.win}>{row.linqVsCdb}</b> faster than the
        hand-written LINQ — <span className={styles.cnum}>{row.cdb}</span> vs{' '}
        <span className={styles.cnum}>{row.linqNs}</span>
        {row.alloc && row.linqAlloc && (
          <>
            , and allocates <span className={styles.cnum}>{row.alloc}</span> vs{' '}
            <span className={styles.cnum}>{row.linqAlloc}</span>
          </>
        )}
        .
        {row.linqVsSqlite && (
          <>
            {' '}
            The naive LINQ is itself <b>{row.linqVsSqlite}</b> than SQLite here.
          </>
        )}
        {row.idxWin && (
          <>
            {' '}
            That gap is a <b>declared-index hit</b>: ConjureDB answers this from an index — an
            O(1)/O(log n) probe — instead of the full scan the LINQ walks.
          </>
        )}
      </span>
    </div>
  );
}

function CaseDetail({row}: {row: BenchRow}): ReactNode {
  // Default to LINQ — the relatable baseline for a game/Unity dev.
  const available = FORMS.filter((f) => row[f.key]);
  const [form, setForm] = useState<FormKey>(
    available.find((f) => f.key === 'linq')?.key ?? available[0]?.key ?? 'dsl',
  );
  if (available.length === 0) return null;
  const active = available.find((f) => f.key === form) ?? available[0];
  return (
    <div className={styles.detail}>
      {row.summary && <p className={styles.summary}>{row.summary}</p>}
      <div className={styles.formTabs} role="tablist">
        {available.map((f) => (
          <button
            key={f.key}
            type="button"
            role="tab"
            aria-selected={f.key === active.key}
            className={f.key === active.key ? styles.formTabActive : styles.formTab}
            onClick={() => setForm(f.key)}>
            {f.label}
          </button>
        ))}
      </div>
      {active.key === 'linq' && <LinqCallout row={row} />}
      <pre className={styles.code} data-lang={active.lang}>
        <code>{row[active.key]}</code>
      </pre>
      {active.key === 'dsl' && row.variants && row.variants.length > 1 && (
        <Variants variants={row.variants} />
      )}
      {active.key === 'linq' && row.linqNote && <p className={styles.note}>{row.linqNote}</p>}
      {active.key === 'linq' && (
        <p className={styles.disclaimer}>
          Hand-written equivalent over plain <code>List&lt;T&gt;</code>, no indexes — the naive
          version a developer reaches for first. Measured on the identical dataset and query
          parameters as the ConjureDB/SQLite figures (single machine, in-process timing).
        </p>
      )}
    </div>
  );
}

export function BenchmarkExplorer(): ReactNode {
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const g = BENCH_GROUPS[active];

  const selectTab = (i: number) => {
    setActive(i);
    setOpen(null);
  };
  const toggleRow = (q: string) => setOpen((cur) => (cur === q ? null : q));

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
            onClick={() => selectTab(i)}>
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
        <p className={styles.hint}>
          Three baselines, same 50,000-row dataset. Select a query for its ConjureDB, LINQ and SQL
          form.
        </p>

        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Query</th>
                <th className={styles.num}>LINQ</th>
                <th className={styles.num}>SQLite</th>
                <th className={styles.num}>ConjureDB</th>
                <th className={styles.num}>vs SQLite</th>
                <th className={styles.num}>Alloc</th>
              </tr>
            </thead>
            <tbody>
              {g.rows.map((r) => {
                const isOpen = open === r.q;
                const expandable = Boolean(r.dsl || r.linq || r.sql);
                return (
                  <Fragment key={r.q}>
                    <tr
                      className={`${expandable ? styles.rowClickable : ''} ${isOpen ? styles.rowOpen : ''}`}
                      onClick={expandable ? () => toggleRow(r.q) : undefined}
                      aria-expanded={expandable ? isOpen : undefined}>
                      <td>
                        {expandable && (
                          <span className={`${styles.caret} ${isOpen ? styles.caretOpen : ''}`} aria-hidden>
                            ▸
                          </span>
                        )}
                        {r.label}
                        {r.cls === 'StressRare' && <span className={styles.badge}>stress-rare</span>}
                      </td>
                      <td className={`${styles.num} ${rankClass(r.rankLinq)}`}>{r.linqNs ?? '—'}</td>
                      <td className={`${styles.num} ${rankClass(r.rankSqlite)}`}>{r.sqlite}</td>
                      <td className={`${styles.num} ${rankClass(r.rankCdb)}`}>{r.cdb}</td>
                      <td className={`${styles.num} ${styles.win}`}>{r.x}</td>
                      <td className={`${styles.num} ${styles.alloc}`}>{r.alloc}</td>
                    </tr>
                    {isOpen && (
                      <tr className={styles.detailRow}>
                        <td colSpan={6}>
                          <CaseDetail row={r} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

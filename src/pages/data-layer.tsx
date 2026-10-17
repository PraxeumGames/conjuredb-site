import type {ReactNode} from 'react';
import Link from '@docusaurus/Link';
import Layout from '@theme/Layout';
import useBrokenLinks from '@docusaurus/useBrokenLinks';
import {BenchmarkExplorer} from '@site/src/components/BenchmarkExplorer';
import {BenchVerdict} from '@site/src/components/BenchVerdict';
import StatusBadge from '@site/src/components/StatusBadge';
import {BENCH_COMPARE, BENCH_SUMMARY} from '@site/src/data/benchmarks';
import {
  INTERP_STATS,
  INTERP_REASONS,
  INTERP_SCENARIOS,
  INTERP_SUMMARY,
} from '@site/src/data/interpreter-benchmarks';
import styles from './marketing.module.css';

// The data layer page: what ConjureDB (the data engine inside Conjure) is, why
// it exists, and the benchmarks — the reader's own status quo first.

function Header(): ReactNode {
  return (
    <header className={styles.pageHead}>
      <div className="container">
        <div className={styles.kickerRow}>
          <span className="cdb-kicker">Data layer · ConjureDB</span>
          <StatusBadge status="shipped" />
        </div>
        <h1 className={styles.pageTitle}>The hidden data layer in your client, compiled.</h1>
        <p className={styles.pageLead}>
          Every game client already contains a data layer, written by hand: dictionaries as
          indexes, nested lookups as joins, OnChanged subscriptions as cache invalidation. ConjureDB
          is that layer declared once and compiled to plain C# — the part of Conjure you can use
          today.
        </p>
        <div className={styles.ctaRow} style={{marginTop: '1.6rem'}}>
          <Link className="button button--primary button--lg" to="/docs/getting-started">
            Get started
          </Link>
          <a className="button button--secondary button--lg" href="#benchmarks">
            See the benchmarks
          </a>
        </div>
      </div>
    </header>
  );
}

const STATS: {n: string; l: string}[] = [
  {n: '0 B', l: 'per frame on the query hot path'},
  {n: 'O(1)', l: 'indexed lookups'},
  {n: `${BENCH_COMPARE.cdbVsLinq}×`, l: 'vs hand-written LINQ over lists, 57-query workload'},
  {n: 'AOT', l: 'IL2CPP-safe, no reflection'},
];

function Stats(): ReactNode {
  return (
    <section className="cdb-section cdb-section--tight">
      <div className="container">
        <div className="cdb-stats">
          {STATS.map((s) => (
            <div className="cdb-stat" key={s.l}>
              <b>{s.n}</b>
              <span>{s.l}</span>
            </div>
          ))}
        </div>
        <p className={styles.footnote}>57-query game workload, 50 000 players; full methodology below.</p>
      </div>
    </section>
  );
}

type Item = {title: string; body: string};

function Cards({items}: {items: Item[]}): ReactNode {
  return (
    <div className={`cdb-grid ${styles.grid2}`} style={{marginTop: '1.6rem'}}>
      {items.map((it) => (
        <div className="cdb-card" key={it.title}>
          <h3>{it.title}</h3>
          <p>{it.body}</p>
        </div>
      ))}
    </div>
  );
}

const FIXES: Item[] = [
  {
    title: 'ScriptableObjects & manager singletons',
    body: 'Fine for config and small state. As soon as data must be queried, joined and kept consistent, they become a database with no schema, no indexes and no query planner — maintained entirely in your head.',
  },
  {
    title: 'Manual dictionaries + hand-rolled indexes',
    body: 'They work until a second index has to stay in sync with the first. Then every write path must remember to update every derived structure, and the ones it forgets become your bugs.',
  },
  {
    title: 'An event bus for "refresh on change"',
    body: 'It starts clean and becomes its own spaghetti: refresh order is implicit, over-refreshing burns the frame, under-refreshing ships stale UI, and nobody can safely add a dependency.',
  },
  {
    title: 'Just embed an SQL engine or an ORM',
    body: 'Now you pay it all at runtime: query parsing, planning, reflection, allocations and millisecond latency — none of which fit IL2CPP or a per-frame budget measured in microseconds.',
  },
];

function Fixes(): ReactNode {
  return (
    <section className="cdb-section cdb-surface">
      <div className="container">
        <span className="cdb-kicker">Why the usual fixes don't hold</span>
        <h2 className="cdb-h2">Every familiar tool trades clean code for runtime cost</h2>
        <p className="cdb-lead">
          Each option is good at something — and each breaks on either maintainability or
          the frame budget. That dilemma is the real problem.
        </p>
        <Cards items={FIXES} />
      </div>
    </section>
  );
}

function Reframe(): ReactNode {
  return (
    <section className="cdb-section">
      <div className="container">
        <span className="cdb-kicker">The reframe</span>
        <h2 className="cdb-h2">You already know every query before you ship.</h2>
        <p className="cdb-lead">
          Your game ships with a fixed set of screens. The shop runs the same offer query it
          ran yesterday; the inventory the same lookup. You know the whole catalogue of
          questions your game will ever ask before the build leaves your machine — so there's
          no reason to work them out again on the player's device, every frame.
        </p>
        <p className="cdb-lead" style={{marginTop: '1rem'}}>
          ConjureDB keeps the one good idea — describe data declaratively, in one place —
          and moves the entire cost from runtime to <strong>build time</strong>. The
          compiler does once, correctly, what you'd otherwise do by hand, every frame,
          slightly wrong.
        </p>
      </div>
    </section>
  );
}

const OUTCOMES: Item[] = [
  {
    title: 'Features that travel between games',
    body: "Behind a declarative schema, a feature owns its data on its own terms — not welded into one game's managers and presenters. Build a shop or inventory once and carry it into the next project.",
  },
  {
    title: 'Fast without hand-optimizing',
    body: "A cost-based optimizer turns the lists you'd loop over into index lookups, and picks the plan for you. You stop hand-tuning data code and the frame budget stops being the thing you fight.",
  },
  {
    title: 'Screens that refresh themselves',
    body: "Incremental view maintenance keeps a view current by applying only what changed — no manual OnChanged wiring, no refresh-order bugs, no stale UI. Shapes it can't maintain are rejected at compile time, not silently degraded.",
  },
  {
    title: 'It stays manageable as it grows',
    body: 'One home for data logic instead of a tangle across scripts. The coupling that makes a growing game unmaintainable goes away — so the project stays workable from 3 systems to 30.',
  },
];

function Outcomes(): ReactNode {
  return (
    <section className="cdb-section cdb-surface">
      <div className="container">
        <span className="cdb-kicker">What it buys you</span>
        <h2 className="cdb-h2">Four wins from one decision</h2>
        <Cards items={OUTCOMES} />
      </div>
    </section>
  );
}

const WHY: Item[] = [
  {title: 'Nothing is interpreted', body: 'Queries are compiled to C# at build time. There is no parser or planner on the hot path at runtime.'},
  {title: 'Indexes you declare', body: 'A matching index turns a full scan into a direct lookup or a bounded range walk — chosen by the optimizer.'},
  {title: 'Allocation-lean paths', body: 'Struct storage, ref returns and pooled buffers keep query evaluation off the heap; only the result collection is materialized, so per-query GC stays low.'},
  {title: 'Deltas, not recomputes', body: 'Incremental view maintenance updates reactive results by the size of the change, not the size of the table.'},
];

function Speed(): ReactNode {
  return (
    <section className="cdb-section">
      <div className="container">
        <span className="cdb-kicker">Where the speed comes from</span>
        <h2 className="cdb-h2">Four structural reasons</h2>
        <Cards items={WHY} />
      </div>
    </section>
  );
}

// ---- Benchmarks -------------------------------------------------------------

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
      <p className="cdb-lead" style={{fontSize: 'var(--fs-md)'}}>{head}</p>
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

function VsHandWritten(): ReactNode {
  const c = BENCH_COMPARE;
  const kept = c.cases - c.excluded;
  const compare = [
    {
      label: `Typical query time · geomean of ${kept} real-work cases`,
      linq: c.linqTime,
      cdb: c.cdbTime,
    },
    {label: 'Speedup', linq: '—', cdb: `~${c.cdbVsLinq}× faster`},
    {
      label: `Allocated · all ${c.cases} cases`,
      linq: `${c.linqTotalAlloc} total`,
      cdb: `0 B on ${c.cdbZeroAlloc} of ${c.cases}`,
    },
  ];
  return (
    <section id="benchmarks" className="cdb-section cdb-surface">
      <div className="container">
        <span className="cdb-kicker">Against what you write today</span>
        <h2 className="cdb-h2">vs hand-written C#</h2>
        <p className="cdb-lead">
          The honest baseline is not a database. It is the LINQ over lists and the Dictionary you
          would otherwise write.
        </p>
        <div className={styles.compare}>
          {compare.map((k) => (
            <div className={styles.compareCell} key={k.label}>
              <span className={styles.compareLabel}>{k.label}</span>
              <dl>
                <div>
                  <dt>Hand-written LINQ</dt>
                  <dd>{k.linq}</dd>
                </div>
                <div className={styles.compareCdb}>
                  <dt>ConjureDB</dt>
                  <dd>{k.cdb}</dd>
                </div>
              </dl>
            </div>
          ))}
        </div>
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

// From docs/examples/arena-ecs.md, the follow-up table after "Two facts".
const ARENA: {units: string; engine: string; p50: string; cdb: boolean}[] = [
  {units: '100 k', engine: 'ConjureDB, job graphs + Burst collision', p50: '171 µs', cdb: true},
  {units: '100 k', engine: 'DOTS baseline', p50: '190 µs', cdb: false},
  {units: '1 M', engine: 'ConjureDB, job graphs + Burst collision', p50: '453 µs', cdb: true},
  {units: '1 M', engine: 'DOTS baseline', p50: '491–513 µs', cdb: false},
];

function FrameState(): ReactNode {
  return (
    <section className="cdb-section">
      <div className="container">
        <span className="cdb-kicker">Frame state</span>
        <h2 className="cdb-h2">vs a hand-written ECS and Unity Entities</h2>
        <p className="cdb-lead">
          Per-frame state measured on the Arena sample: 100 000 units, projectiles, hits, respawns,
          same RNG draw order and identical digests.
        </p>
        <div className={styles.tableWrap} style={{maxWidth: '44rem', margin: '1.6rem auto 0'}}>
          <table className={styles.benchTable}>
            <thead>
              <tr>
                <th>Units</th>
                <th>Engine</th>
                <th className="num">Frame p50</th>
              </tr>
            </thead>
            <tbody>
              {ARENA.map((r) => (
                <tr key={r.units + r.engine}>
                  <td className="num" style={{textAlign: 'left'}}>
                    {r.units}
                  </td>
                  <td>{r.engine}</td>
                  <td className={r.cdb ? `num ${styles.win}` : 'num'}>{r.p50}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className={styles.footnote}>
          0 B/frame in every system.{' '}
          <Link to="/docs/examples/arena-ecs">Full numbers and what they taught us →</Link>
        </p>
      </div>
    </section>
  );
}

function Verdict(): ReactNode {
  return (
    <section className="cdb-section cdb-surface">
      <div className="container">
        <span className="cdb-kicker">Against an embedded SQL engine</span>
        <p className={styles.sideNote}>
          Kept for completeness: an in-memory, compiled, closed-world engine should beat a
          general-purpose SQL engine on a known workload. The interesting comparisons are the two
          above.
        </p>
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
    <section className="cdb-section">
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

function NoJitRuntime(): ReactNode {
  return (
    <section className="cdb-section cdb-surface">
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

        <Cards items={INTERP_REASONS} />

        <div style={{marginTop: '2rem'}}>
          <h3 style={{marginBottom: '0.3rem'}}>Every operator, measured against SQLite</h3>
          <p className="cdb-lead" style={{fontSize: 'var(--fs-md)'}}>
            The fair fight: SQLite is itself a bytecode interpreter, so this is interpreter vs
            interpreter. Each of the {INTERP_SUMMARY.scenarios} shapes runs the same query over the
            same {INTERP_SUMMARY.corpusShape} data, with matching indexes for each
            scenario and prepared statements — and the no-JIT lane wins all {INTERP_SUMMARY.fasterThanSqlite},
            from {INTERP_SUMMARY.speedupRange}, while keeping point lookups at 0 B and the heaviest
            current {INTERP_SUMMARY.currentCorpusScenarios}-scenario corpus case at {INTERP_SUMMARY.heaviestAlloc}.
          </p>
          <div className={styles.tableWrap}>
            <table className={styles.benchTable}>
              <thead>
                <tr>
                  <th>Query shape</th>
                  <th>What it does</th>
                  <th className="num">SQLite</th>
                  <th className="num">ConjureDB</th>
                  <th>vs SQLite</th>
                  <th className="num">Allocated</th>
                </tr>
              </thead>
              <tbody>
                {INTERP_SCENARIOS.map((r) => (
                  <tr key={r.q}>
                    <td>{r.q}</td>
                    <td style={{color: 'var(--cdb-muted)'}}>{r.what}</td>
                    <td className="num">{r.sqlite}</td>
                    <td className="num">{r.cdb}</td>
                    <td className={styles.win}>{r.x}</td>
                    <td className={r.alloc === '0 B' ? `num ${styles.win}` : 'num'}>{r.alloc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <p className="cdb-lead" style={{marginTop: '1.6rem', fontSize: 'var(--fs-md)'}}>
          Some of the win is structural: an in-process engine on your own heap skips the
          managed↔native marshaling SQLite pays per query — which is exactly why you'd embed one on a
          client. And the compiled C# lane above is still the throughput ceiling; keep your hottest,
          build-time-known queries there. The portable lane's job is to run the queries the compiled
          lane structurally can't, on platforms a JIT can't — and to still beat SQLite doing it.
          The v1 superinstruction pass is measured separately: fused opcode hit scenarios improve
          {INTERP_SUMMARY.superinstructionHitGeomean} geomean, with the rest of the corpus flat.
        </p>
        <p className={styles.caveat}>
          Methodology: {INTERP_SUMMARY.host}, BenchmarkDotNet, IterationCount=8 after 4 warmups
          with BenchmarkDotNet's reported outlier filtering.
          Both engines run the same query over the same {INTERP_SUMMARY.corpusShape} data
          with a primary-key index plus matching secondary indexes for index-aware scenarios, prepared statements,
          and the full result materialized; SQLite is in-memory with fast pragmas
          (synchronous=OFF, temp_store=MEMORY). “vs SQLite” is SQLite's mean ÷ ConjureDB's mean.
          One configuration — not a guarantee. Benchmark your own workload.
        </p>
      </div>
    </section>
  );
}

const NOT_FOR: Item[] = [
  {
    title: 'Arbitrary runtime queries',
    body: 'If designers must type new queries that run on player devices, you need a runtime engine. ConjureDB is closed-world: queries are known and compiled before ship. Changes after the build go through the liveops lane as compiled artifacts.',
  },
  {
    title: 'Trivially small or throwaway state',
    body: 'Three booleans behind an options menu, or a prototype you delete in two weeks, do not need a schema. A dictionary is the right answer.',
  },
  {
    title: 'A multi-writer server database',
    body: 'This is single-writer and client-owned — no MVCC, no row locks, no distributed transactions. It is a fast local layer, not a contention-solving backend.',
  },
  {
    title: 'A source of authority on its own',
    body: 'The client data layer is a fast local replica, not the truth. In Conjure the truth is the server side, which verifies the device by replay; that part is a validated prototype, not yet in the product.',
  },
];

function NotFor(): ReactNode {
  return (
    <section className="cdb-section">
      <div className="container">
        <span className="cdb-kicker">Honest limits</span>
        <h2 className="cdb-h2">When ConjureDB is the wrong choice</h2>
        <Cards items={NOT_FOR} />
        <p className="cdb-lead" style={{marginTop: '1.6rem'}}>
          The cost is real, too: a schema to maintain, a build step, and a new way of
          thinking for your team. We think it is worth it for a growing game that wants to
          keep both its architecture and its frame budget — but you should decide with eyes
          open.
        </p>
      </div>
    </section>
  );
}

function Cta(): ReactNode {
  return (
    <section className="cdb-section cdb-surface cdb-center">
      <div className="container">
        <h2 className="cdb-h2">Speed you can audit</h2>
        <p className="cdb-lead" style={{margin: '0 auto 1.6rem'}}>
          Every number on this page is one configuration, measured with its method published. Your
          schema, hardware and plans differ — benchmark your own scenario before you decide.
        </p>
        <div className={styles.ctaRow} style={{justifyContent: 'center'}}>
          <Link className="button button--primary button--lg" to="/docs/getting-started">
            Get started
          </Link>
          <Link className="button button--secondary button--lg" to="/how-it-works">
            How it works
          </Link>
        </div>
      </div>
    </section>
  );
}

export default function DataLayer(): ReactNode {
  useBrokenLinks().collectAnchor('benchmarks');
  return (
    <Layout
      title="Data layer — ConjureDB, the compiled data layer for game clients"
      description="ConjureDB is the in-memory data layer inside Conjure: declared once, compiled to plain C#, with indexed lookups, allocation-free query paths and self-updating views. Benchmarks against hand-written C#, Unity Entities and an embedded SQL engine, with methodology.">
      <Header />
      <main>
        <Stats />
        <Fixes />
        <Reframe />
        <Outcomes />
        <Speed />
        <VsHandWritten />
        <FrameState />
        <Verdict />
        <Families />
        <NoJitRuntime />
        <NotFor />
        <Cta />
      </main>
    </Layout>
  );
}

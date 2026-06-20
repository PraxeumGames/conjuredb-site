import {useState, type ReactNode} from 'react';
import styles from './styles.module.css';

// VSCode Dark+ token helpers — hand-colored for a crisp, reliable editor look
// independent of any Prism grammar availability.
const K = ({children}: {children: ReactNode}) => <span className={styles.kw}>{children}</span>;
const T = ({children}: {children: ReactNode}) => <span className={styles.ty}>{children}</span>;
const F = ({children}: {children: ReactNode}) => <span className={styles.fn}>{children}</span>;
const S = ({children}: {children: ReactNode}) => <span className={styles.str}>{children}</span>;
const N = ({children}: {children: ReactNode}) => <span className={styles.num}>{children}</span>;
const C = ({children}: {children: ReactNode}) => <span className={styles.com}>{children}</span>;
const V = ({children}: {children: ReactNode}) => <span className={styles.varname}>{children}</span>;

export type CodeTab = {name: string; lang: string; lines: ReactNode[]};

function Dot({color}: {color: string}) {
  return <span className={styles.dot} style={{background: color}} />;
}

export function CodeWindow({tabs}: {tabs: CodeTab[]}) {
  const [active, setActive] = useState(0);
  const tab = tabs[active];
  return (
    <div className={styles.window}>
      <div className={styles.titlebar}>
        <div className={styles.dots}>
          <Dot color="#ff5f56" />
          <Dot color="#ffbd2e" />
          <Dot color="#27c93f" />
        </div>
        <div className={styles.tabs}>
          {tabs.map((t, i) => (
            <button
              key={t.name}
              type="button"
              className={i === active ? styles.tabActive : styles.tab}
              onClick={() => setActive(i)}>
              {t.name}
            </button>
          ))}
        </div>
        <span className={styles.lang}>{tab.lang}</span>
      </div>
      <div className={styles.body}>
        <div className={styles.gutter} aria-hidden="true">
          {tab.lines.map((_, i) => (
            <span key={i}>{i + 1}</span>
          ))}
        </div>
        <pre className={styles.code}>
          {tab.lines.map((line, i) => (
            <div className={styles.line} key={i}>
              {line}
              {'\n'}
            </div>
          ))}
          <div className={styles.line}>
            <span className={styles.caret} />
          </div>
        </pre>
      </div>
    </div>
  );
}

// How-it-works signature: the plan the optimizer chose, the way an EXPLAIN reads.
export const PLAN_TABS: CodeTab[] = [
  {
    name: 'query plan',
    lang: 'explain',
    lines: [
      <C># the plan ConjureDB chose for TopScorers — inspectable, not hidden</C>,
      <>{' '}</>,
      <><T>TopK</T> <V>k</V>=count <K>by</K> Score <K>desc</K>            <C>~O(count), bounded</C></>,
      <>└─ <T>IndexScan</T> <V>PlayersByScore</V> (<K>desc</K>)</>,
      <>{'     '}<K>where</K> Score &gt; min</>,
      <>{'     '}stop-early <C>✓</C>   sort <C>none</C>   full-scan <C>no</C></>,
      <>{'     '}allocations <N>0</N></>,
    ],
  },
];

// The hero's "compile" story: a .conjure source file and the plain C# it emits.
export const HERO_TABS: CodeTab[] = [
  {
    name: 'game.conjure',
    lang: 'ConjureDB schema',
    lines: [
      <><K>table</K> <T>Player</T>(plural: Players, capacity: <N>50000</N>) {'{'}</>,
      <>    <V>Id</V>: <K>int</K> <span className={styles.attr}>@id</span></>,
      <>    <V>Name</V>: <K>string</K></>,
      <>    <V>Score</V>: <K>int</K></>,
      <>{' '}</>,
      <>    @@<F>index</F>(fields: [Score], kind: sorted)</>,
      <>{'}'}</>,
      <>{' '}</>,
      <C># every screen can reuse this — written once</C>,
      <><K>query</K> <F>TopScorers</F>(min: <K>int</K>, count: <K>int</K>) -&gt; <T>Player</T>[] {'{'}</>,
      <>    <K>from</K> Players</>,
      <>    | <K>filter</K> Score &gt; min</>,
      <>    | <K>sort</K> -Score</>,
      <>    | <K>take</K> count</>,
      <>{'}'}</>,
    ],
  },
  {
    name: 'Players.g.cs',
    lang: 'generated C#',
    lines: [
      <C>// Generated at build time. Plain C#, no reflection,</C>,
      <C>// no runtime query parser. Read it if you don't trust it.</C>,
      <><K>public</K> <T>ReadOnlySpan</T>&lt;<T>Player</T>&gt; <F>TopScorers</F>(<K>int</K> min, <K>int</K> count)</>,
      <>{'{'}</>,
      <>    <K>var</K> top = <V>_topN</V>.<F>Rent</F>(count);</>,
      <>    <K>foreach</K> (<K>ref readonly</K> <K>var</K> p <K>in</K> <V>_byScoreDesc</V>)</>,
      <>    {'{'}</>,
      <>        <K>if</K> (p.<V>Score</V> &lt;= min) <K>break</K>;</>,
      <>        <K>if</K> (!top.<F>TryOffer</F>(<K>in</K> p)) <K>break</K>;</>,
      <>    {'}'}</>,
      <>    <K>return</K> top.<V>Span</V>;</>,
      <>{'}'}</>,
    ],
  },
];

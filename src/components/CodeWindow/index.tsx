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

// How-it-works signature: the physical plan, in the planner's real tree format.
export const PLAN_TABS: CodeTab[] = [
  {
    name: 'query plan',
    lang: 'explain',
    lines: [
      <C>// the plan ConjureDB picks for GetTopScorers — inspectable</C>,
      <>{' '}</>,
      <><T>TopN</T> (limit=count, order=<V>Score</V> <K>desc</K>)</>,
      <>└── <T>Scan</T> (<T>Player</T>,</>,
      <>{'         '}strategy=<K>SortedSetScan</K>,</>,
      <>{'         '}index=<V>Player_ByScore</V>)</>,
    ],
  },
];

// The hero's "compile" story: a .conjure source file and the plain C# it emits.
export const HERO_TABS: CodeTab[] = [
  {
    name: 'game.conjure',
    lang: 'ConjureDB schema',
    lines: [
      <><K>table</K> <T>Player</T>(</>,
      <>    persistence: <K>local</K>, capacity: <N>16384</N>, type_id: <N>1001</N>) {'{'}</>,
      <>    <V>Id</V>: <K>int</K> <span className={styles.attr}>@id</span></>,
      <>    <V>Name</V>: <K>string</K></>,
      <>    <V>Score</V>: <K>int</K></>,
      <>{' '}</>,
      <>    @@<F>index</F>(fields: [Score], name: <S>"Player_ByScore"</S>, kind: <K>sorted_set</K>)</>,
      <>{'}'}</>,
      <>{' '}</>,
      <C>// every screen can reuse this — written once</C>,
      <><K>query</K> <F>GetTopScorers</F>(count: <K>int</K>) -&gt; <T>Player</T>[] {'{'}</>,
      <>    <K>from</K> <T>Player</T> <V>p</V></>,
      <>    | <K>sort</K> {'{'} -<V>p.Score</V>, <V>p.Id</V> {'}'}</>,
      <>    | <K>take</K> <span className={styles.attr}>@count</span></>,
      <>{'}'}</>,
    ],
  },
  {
    name: 'Player.g.cs',
    lang: 'generated C#',
    lines: [
      <C>// Generated at build time — plain C#, no reflection.</C>,
      <><K>public</K> <T>IEnumerable</T>&lt;<T>Player</T>&gt; <F>GetTopScorers</F>(<K>int</K> count)</>,
      <>{'{'}</>,
      <>    <K>var</K> results = <K>new</K> <T>Player</T>[<T>Math</T>.<F>Max</F>(<N>1</N>, <F>ClampResultCapacity</F>(count))];</>,
      <>    <K>var</K> n = <N>0</N>;</>,
      <>    <K>foreach</K> (<K>var</K> p <K>in</K> <V>_context</V>.<V>Players</V>.<V>PlayerScoreIndex</V>.<F>TakeReverse</F>(count))</>,
      <>    {'{'}</>,
      <>        <K>if</K> (n &gt;= results.<V>Length</V>) <T>Array</T>.<F>Resize</F>(<K>ref</K> results, results.<V>Length</V> * <N>2</N>);</>,
      <>        results[n++] = p;</>,
      <>    {'}'}</>,
      <>    <K>return</K> n == results.<V>Length</V></>,
      <>        ? results : <K>new</K> <T>ArrayPrefixReadOnlyList</T>&lt;<T>Player</T>&gt;(results, n);</>,
      <>{'}'}</>,
    ],
  },
];

// How-it-works, "one command, two places": the generated command both sides run.
export const BUY_TABS: CodeTab[] = [
  {
    name: 'BuyItem.g.cs',
    lang: 'generated C#',
    lines: [
      <C>// generated once — runs on both sides</C>,
      <><K>public static</K> <T>BuyResult</T> <F>BuyItem</F>(</>,
      <>    <K>ref</K> <T>PlayerState</T> <V>s</V>, <K>in</K> <T>Item</T> <V>item</V>)</>,
      <>{'{'}</>,
      <>    <K>if</K> (<V>s</V>.<V>Gold</V> &lt; <V>item</V>.<V>Price</V>)</>,
      <>        <K>return</K> <T>BuyResult</T>.<V>NotEnoughGold</V>;</>,
      <>    <V>s</V>.<V>Gold</V> -= <V>item</V>.<V>Price</V>;</>,
      <>    <V>s</V>.<V>Inventory</V>.<F>Upsert</F>(<V>item</V>.<V>Id</V>, <N>1</N>);</>,
      <>    <K>return</K> <T>BuyResult</T>.<V>Ok</V>;</>,
      <>{'}'}</>,
    ],
  },
];

import {createContext, useContext, useState, type CSSProperties, type ReactNode} from 'react';
import styles from './styles.module.css';

// VSCode Dark+ token helpers — hand-colored for a crisp, reliable editor look
// independent of any Prism grammar availability.
export const K = ({children}: {children: ReactNode}) => <span className={styles.kw}>{children}</span>;
export const T = ({children}: {children: ReactNode}) => <span className={styles.ty}>{children}</span>;
export const F = ({children}: {children: ReactNode}) => <span className={styles.fn}>{children}</span>;
export const S = ({children}: {children: ReactNode}) => <span className={styles.str}>{children}</span>;
export const N = ({children}: {children: ReactNode}) => <span className={styles.num}>{children}</span>;
export const C = ({children}: {children: ReactNode}) => <span className={styles.com}>{children}</span>;
export const V = ({children}: {children: ReactNode}) => <span className={styles.varname}>{children}</span>;
export const A = ({children}: {children: ReactNode}) => <span className={styles.attr}>{children}</span>;

export type CodeTab = {name: string; lang: string; lines: ReactNode[]};

function Dot({color}: {color: string}) {
  return <span className={styles.dot} style={{background: color}} />;
}

/**
 * `dense`: smaller type for narrow columns. `locked`: a fixed-height,
 * non-scrolling excerpt — the reader sees how much there is, not every line.
 * `maxLines`: cap the visible lines and scroll the rest inside the window.
 * Inside a `CodeCap` provider (the homepage's under-the-hood panels), a window
 * longer than the cap shows that many lines over a faded edge, with
 * `show all ⌄` / `show less ⌃` in its footer.
 */
export const CodeCap = createContext<number | undefined>(undefined);

export function CodeWindow({
  tabs,
  dense = false,
  locked = false,
  maxLines,
}: {
  tabs: CodeTab[];
  dense?: boolean;
  locked?: boolean;
  maxLines?: number;
}) {
  const [active, setActive] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const cap = useContext(CodeCap);
  const tab = tabs[active];
  const capped = cap !== undefined && tab.lines.length > cap;
  const clipped = capped && !expanded;
  return (
    <div
      className={[styles.window, dense && styles.dense, locked && !capped && styles.locked, clipped && styles.clipped]
        .filter(Boolean)
        .join(' ')}
      style={capped ? ({'--cw-cap': cap} as CSSProperties) : undefined}>
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
      <div
        className={maxLines ? `${styles.body} ${styles.scroll}` : styles.body}
        style={maxLines ? ({'--cw-lines': maxLines} as CSSProperties) : undefined}>
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
      {capped && (
        <div className={styles.footer}>
          <button type="button" className={styles.more} aria-expanded={expanded} onClick={() => setExpanded((x) => !x)}>
            {expanded ? 'show less ⌃' : `show all ${tab.lines.length} lines ⌄`}
          </button>
        </div>
      )}
    </div>
  );
}

// How-it-works signature: the shape of the plan it picks.
export const PLAN_TABS: CodeTab[] = [
  {
    name: 'query plan',
    lang: 'explain',
    lines: [
      <C>// illustrative: the plan ConjureDB picks for GetTopScorers</C>,
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
      <><K>module</K> <T>Leaderboard</T> {'{'}</>,
      <>    <K>table</K> <T>Player</T>(</>,
      <>        persistence: <K>local</K>, capacity: <N>16384</N>, type_id: <N>1001</N>) {'{'}</>,
      <>        <V>Id</V>: <K>int</K> <span className={styles.attr}>@id</span></>,
      <>        <V>Name</V>: <K>string</K></>,
      <>        <V>Score</V>: <K>int</K></>,
      <>{' '}</>,
      <>        @@<F>index</F>(fields: [Score], name: <S>"Player_ByScore"</S>, kind: <K>sorted_set</K>)</>,
      <>    {'}'}</>,
      <>{' '}</>,
      <>    <C>// every UI view can reuse this — written once</C></>,
      <>    <K>query</K> <F>GetTopScorers</F>(count: <K>int</K>) -&gt; <T>Player</T>[] {'{'}</>,
      <>        <K>from</K> <T>Player</T> <V>p</V></>,
      <>        | <K>sort</K> {'{'} -<V>p.Score</V>, <V>p.Id</V> {'}'}</>,
      <>        | <K>take</K> <span className={styles.attr}>@count</span></>,
      <>    {'}'}</>,
      <>{'}'}</>,
    ],
  },
  {
    name: 'Player.g.cs',
    lang: 'generated C#',
    lines: [
      <C>// Generated at build time — plain C#, no reflection.</C>,
      <><K>public</K> <T>Player</T>[] <F>GetTopScorers</F>(<K>int</K> count)</>,
      <>{'{'}</>,
      <>    <K>var</K> results = <K>new</K> <T>Player</T>[<T>Math</T>.<F>Max</F>(<N>1</N>, <F>ClampResultCapacity</F>(count))];</>,
      <>    <K>var</K> n = <N>0</N>;</>,
      <>    <K>var</K> ordered = <V>Context</V>.<V>Players</V>.<V>Player_ByScore</V>.<F>TakeReverseByRef</F>(count);</>,
      <>    <K>for</K> (<K>var</K> i = <N>0</N>; i &lt; ordered.<V>Length</V>; i++)</>,
      <>    {'{'}</>,
      <>        <K>ref readonly var</K> p = <K>ref</K> ordered.<F>GetRefAtUnchecked</F>(i);</>,
      <>        <K>if</K> (n &gt;= results.<V>Length</V>) <T>Array</T>.<F>Resize</F>(<K>ref</K> results, results.<V>Length</V> * <N>2</N>);</>,
      <>        results[n++] = p;</>,
      <>    {'}'}</>,
      <>    <K>return</K> n == results.<V>Length</V> ? results : results[..n];</>,
      <>{'}'}</>,
    ],
  },
];

// How-it-works, "one command, two places": the generated command both sides run.
export const BUY_TABS: CodeTab[] = [
  {
    name: 'BuyItemExecutor.g.cs',
    lang: 'generated C#',
    lines: [
      <C>// generated once — runs on both sides (abridged)</C>,
      <><K>public static class</K> <T>BuyItemExecutor</T></>,
      <>{'{'}</>,
      <>    <K>public static</K> <T>BuyItemOutcome</T> <F>ExecuteCore</F>(</>,
      <>        <T>DbContext</T> context, <T>BuyItemCommand</T> command, <T>CommandExecutionFrame</T> frame)</>,
      <>    {'{'}</>,
      <>        <K>ref var</K> wallet = <K>ref</K> context.<V>Wallets</V>.<F>GetRef</F>(command.<V>PlayerId</V>);</>,
      <>        <K>if</K> (wallet.<V>Balance</V> &lt; command.<V>Cost</V>)</>,
      <>            <K>return</K> <T>BuyItemOutcome</T>.<F>Failure</F>(<T>BuyItemErrorCode</T>.<V>InsufficientFunds</V>);</>,
      <>        wallet.<V>Balance</V> -= command.<V>Cost</V>;</>,
      <>        context.<V>Inventory</V>.<F>Upsert</F>(command.<V>PlayerId</V>, command.<V>ItemId</V>, <N>1</N>);</>,
      <>        <K>return</K> <T>BuyItemOutcome</T>.<F>Success</F>();</>,
      <>    {'}'}</>,
      <>{'}'}</>,
    ],
  },
];

import {useEffect, useRef, useState, type CSSProperties, type ReactNode} from 'react';
import clsx from 'clsx';
import {C, CodeWindow, F, K, N, T, type CodeTab} from '@site/src/components/CodeWindow';
import styles from './styles.module.css';

// Declarative vs imperative, in three beats:
//   1. the same requirement written both ways, and who owns each decision;
//   2. change the requirement — four places on the left, one line on the right;
//   3. why a small, checked language is safe for assistant drafts.
// The query follows docs/query-language: `| filter`, `| sort`, `| take`, `!` for negation.

/** A hotspot line on the imperative side: tinted, with its number at the end. */
function Hot({n, children}: {n: string; children: ReactNode}) {
  return (
    <span className={styles.hot}>
      {children}
      <span className={styles.hotNum}>{n}</span>
    </span>
  );
}

const IMPERATIVE: CodeTab[] = [
  {
    name: 'ShopOffers.cs',
    lang: 'imperative',
    lines: [
      <><K>public sealed class</K> <T>ShopOffers</T>(<T>Wallet</T> wallet, <T>OfferCatalog</T> catalog, <T>OfferListView</T> view)</>,
      <>{'{'}</>,
      <Hot n="③">    <K>readonly</K> <T>List</T>&lt;<T>Offer</T>&gt; cache = <K>new</K>();</Hot>,
      <Hot n="③">    <K>bool</K> dirty = <K>true</K>;</Hot>,
      <>    <K>int</K> lastGold = -<N>1</N>;</>,
      <>{' '}</>,
      <>    <K>public void</K> <F>Start</F>()</>,
      <>    {'{'}</>,
      <>        wallet.OnGoldChanged += _ =&gt; dirty = <K>true</K>;</>,
      <>        catalog.OnPriceChanged += _ =&gt; dirty = <K>true</K>;</>,
      <Hot n="④">        <C>// (no OnOfferRemoved handler)</C></Hot>,
      <>    {'}'}</>,
      <>{' '}</>,
      <Hot n="①">    <K>public void</K> <F>Update</F>()</Hot>,
      <>    {'{'}</>,
      <>        <K>if</K> (!dirty &amp;&amp; wallet.Gold == lastGold) <K>return</K>;</>,
      <>        <F>Rebuild</F>(wallet.Gold);</>,
      <>    {'}'}</>,
      <>{' '}</>,
      <>    <K>void</K> <F>Rebuild</F>(<K>int</K> gold)</>,
      <>    {'{'}</>,
      <Hot n="②">        <K>var</K> result = <K>new</K> <T>List</T>&lt;<T>Offer</T>&gt;();</Hot>,
      <>        <K>foreach</K> (<K>var</K> o <K>in</K> catalog.All)</>,
      <>            <K>if</K> (o.Price &lt;= gold) result.<F>Add</F>(o);</>,
      <>        result.<F>Sort</F>(ByPrice);</>,
      <>        cache.<F>Clear</F>();</>,
      <>        <K>for</K> (<K>int</K> i = <N>0</N>; i &lt; result.Count &amp;&amp; i &lt; <N>10</N>; i++)</>,
      <>            cache.<F>Add</F>(result[i]);</>,
      <>        lastGold = gold;</>,
      <>        dirty = <K>false</K>;</>,
      <>        view.<F>Refresh</F>(cache);</>,
      <>    {'}'}</>,
      <>{' '}</>,
      <>    <K>static int</K> <F>ByPrice</F>(<T>Offer</T> a, <T>Offer</T> b) =&gt; a.Price.<F>CompareTo</F>(b.Price);</>,
      <>{'}'}</>,
    ],
  },
];

const HOTSPOTS: [string, string][] = [
  ['①', 'runs every frame'],
  ['②', 'allocates a list per run'],
  ['③', 'manual cache + dirty flag'],
  ['④', 'forgot: offer removed → stale row'],
];

type Change = 'class' | 'owned';

/** The declarative side; each change adds one line (and, for class, a parameter). */
function declarativeTabs(on: Set<Change>): CodeTab[] {
  const cls = on.has('class');
  const own = on.has('owned');
  const add = (node: ReactNode) => <span className={styles.added}>{node}</span>;
  return [
    {
      name: 'shop.conjure',
      lang: 'declarative',
      lines: [
        <>
          <K>reactive query</K> <F>AffordableOffers</F>(gold: <K>int</K>
          {cls && <span className={styles.addedInline}>, playerClass: <K>int</K></span>}) -&gt; <T>Offer</T>[] {'{'}
        </>,
        <>    <K>from</K> <T>Offer</T> o</>,
        <>    | <K>filter</K> o.Price &lt;= @gold</>,
        ...(cls ? [add(<>    | <K>filter</K> o.Class == @playerClass</>)] : []),
        ...(own ? [add(<>    | <K>filter</K> !o.Owned</>)] : []),
        <>    | <K>sort</K> o.Price</>,
        <>    | <K>take</K> <N>10</N></>,
        <>{'}'}</>,
      ],
    },
  ];
}

const LEDGER = ['data structure & index', 'when to recompute', 'what to allocate', 'ordering & invalidation', 'threading'];

// Beat 2: what each change costs on the imperative side.
type Hunk = {where: string; lines: string[]; forget?: boolean};
const HUNKS: Record<Change, {hunks: Hunk[]; added: number}> = {
  class: {
    added: 12,
    hunks: [
      {where: 'Rebuild · filter', lines: ['if (o.Price <= gold', '    && o.Class == player.Class) result.Add(o);']},
      {where: 'fields + Update · cache key', lines: ['int lastClass = -1;', 'if (!dirty && wallet.Gold == lastGold', '    && player.Class == lastClass) return;']},
      {where: 'Rebuild · comparer path', lines: ['result.Sort(ByClassThenPrice);', 'static int ByClassThenPrice(Offer a, Offer b) => …;', 'lastClass = player.Class;']},
      {where: 'Start · new subscription', lines: ['player.OnClassChanged += _ => dirty = true;', '// and unsubscribe it, and order it', '// against OnPriceChanged'], forget: true},
    ],
  },
  owned: {
    added: 10,
    hunks: [
      {where: 'Rebuild · filter', lines: ['if (inventory.Owns(o.ItemId)) continue;']},
      {where: 'constructor · new dependency', lines: ['public sealed class ShopOffers(…, Inventory inventory, …)']},
      {where: 'Start · new subscriptions', lines: ['inventory.OnItemAdded += _ => dirty = true;', 'inventory.OnItemRemoved += _ => dirty = true;'], forget: true},
      {where: 'OnDestroy · unsubscribe', lines: ['inventory.OnItemAdded -= …;', 'inventory.OnItemRemoved -= …;', '// one more pair to keep in sync']},
    ],
  },
};
const CHANGE_LABEL: Record<Change, string> = {class: "only the player's class", owned: 'exclude owned items'};
const PLAN: Record<Change, string> = {
  class: 'plan: index Offer_ByClass · delta-maintained',
  owned: 'plan: filter in the maintained pipeline · delta-maintained',
};

/**
 * 'static' (server render, reduced motion: the final state) → 'armed' (waiting
 * off screen) → 'play' (scrolled into view once; CSS runs the sequence).
 */
function useReveal<T extends HTMLElement>(threshold = 0.4) {
  const ref = useRef<T>(null);
  const [phase, setPhase] = useState<'static' | 'armed' | 'play'>('static');
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    setPhase('armed');
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setPhase('play');
          io.disconnect();
        }
      },
      {threshold},
    );
    io.observe(el);
    return () => io.disconnect();
  }, [threshold]);
  return [ref, phase] as const;
}

function SameRequirement(): ReactNode {
  const [ledgerRef, phase] = useReveal<HTMLDivElement>(0.5);
  return (
    <div className={styles.band}>
      <h3 className={styles.bandTitle}>Same requirement, two ways</h3>
      <p className={styles.requirement}>Show the 10 cheapest offers the player can afford. Keep it current.</p>
      <div className={styles.pair}>
        <div className={styles.side}>
          <div className={styles.window}>
            <CodeWindow tabs={IMPERATIVE} dense />
          </div>
          <ol className={styles.hotspots}>
            {HOTSPOTS.map(([n, t]) => (
              <li key={n}>
                <span className={styles.hotNum}>{n}</span>
                {t}
              </li>
            ))}
          </ol>
          <p className={clsx(styles.summary, styles.summaryRed)}>≈ 40 lines · 4 decisions that are yours · 1 bug already in</p>
        </div>
        <div className={styles.side}>
          <div className={styles.window}>
            <CodeWindow tabs={declarativeTabs(new Set())} dense />
          </div>
          <p className={styles.summary}>6 lines · 0 of those decisions are yours</p>

          <div ref={ledgerRef} className={clsx(styles.ledger, phase === 'armed' && styles.armed, phase === 'play' && styles.play)} role="table" aria-label="Who decides">
            <div className={styles.ledgerHead} role="row">
              <span role="columnheader">who decides</span>
              <span role="columnheader">imperative</span>
              <span role="columnheader">declarative</span>
            </div>
            {LEDGER.map((row, i) => (
              <div key={row} className={styles.ledgerRow} role="row" style={{'--i': i} as CSSProperties}>
                <span role="rowheader">{row}</span>
                <span role="cell" className={styles.you}>
                  you
                </span>
                <span role="cell" className={styles.compiler}>
                  compiler
                </span>
              </div>
            ))}
          </div>
          <p className={styles.caption}>
            Nothing on the right can be written &lsquo;wrong&rsquo; in the ways the left goes wrong:
            those decisions are not yours to get wrong.
          </p>
        </div>
      </div>
    </div>
  );
}

function ChangeRequirement(): ReactNode {
  const [on, setOn] = useState<Set<Change>>(new Set());
  const [blink, setBlink] = useState(0);
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) setOn(new Set<Change>(['class', 'owned']));
  }, []);
  const toggle = (c: Change) => {
    setOn((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else {
        next.add(c);
        setBlink((b) => b + 1);
      }
      return next;
    });
  };
  const active = (['class', 'owned'] as Change[]).filter((c) => on.has(c));
  const hunks = active.flatMap((c) => HUNKS[c].hunks.map((h) => ({...h, change: c})));
  const added = active.reduce((n, c) => n + HUNKS[c].added, 0);
  return (
    <div className={styles.band}>
      <h3 className={styles.bandTitle}>Change the requirement</h3>
      <div className={styles.changes} role="group" aria-label="Change the requirement">
        {(['class', 'owned'] as Change[]).map((c) => (
          <button key={c} type="button" aria-pressed={on.has(c)} className={clsx(styles.change, on.has(c) && styles.changeOn)} onClick={() => toggle(c)}>
            {on.has(c) ? '✓ ' : '+ '}
            {CHANGE_LABEL[c]}
          </button>
        ))}
      </div>
      <div className={styles.pair}>
        <div className={styles.side}>
          <span className={styles.sideLabel}>ShopOffers.cs · imperative</span>
          {hunks.length === 0 ? (
            <p className={styles.empty}>pick a change above</p>
          ) : (
            <ul className={styles.hunks}>
              {hunks.map((h, i) => (
                <li key={`${h.change}-${h.where}`} className={styles.hunk} style={{'--i': i} as CSSProperties}>
                  <span className={styles.hunkWhere}>{h.where}</span>
                  <pre>
                    {h.lines.map((l) => (
                      <span key={l}>+ {l}</span>
                    ))}
                  </pre>
                  {h.forget && (
                    <span key={blink} className={styles.forget}>
                      ④ another place to forget
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className={clsx(styles.summary, styles.summaryRed)} aria-live="polite">
            {active.length === 0 ? '—' : `+${added} lines · ${hunks.length} places · new invalidation path${active.length > 1 ? 's' : ''}`}
          </p>
        </div>
        <div className={styles.side}>
          <span className={styles.sideLabel}>shop.conjure · declarative</span>
          <div className={styles.window}>
            <CodeWindow key={active.join()} tabs={declarativeTabs(on)} dense />
          </div>
          {active.map((c) => (
            <p key={c} className={styles.plan}>
              {PLAN[c]} <span className={styles.illustrative}>(illustrative)</span>
            </p>
          ))}
          <p className={styles.summary} aria-live="polite">
            {active.length === 0 ? '—' : `+${active.length} line${active.length > 1 ? 's' : ''} · 1 place`}
          </p>
        </div>
      </div>
    </div>
  );
}

const DOOR: {title: string; body: string}[] = [
  {title: 'Small surface', body: 'The whole language fits in a few pages. An assistant can hold all of it, and so can you.'},
  {
    title: 'The compiler reviews every draft',
    body: 'A draft is bound, typed and planned before it exists. Wrong shapes come back as diagnostics, not as bugs in production.',
  },
  {title: 'Humans review intent', body: 'You read six lines of what, not forty lines of how.'},
];

function Door(): ReactNode {
  const [ref, phase] = useReveal<HTMLDivElement>(0.5);
  return (
    <div className={styles.band}>
      <h3 className={styles.bandTitle}>Why this is the door for assistants</h3>
      <div className={styles.cards}>
        {DOOR.map((d) => (
          <div key={d.title} className={styles.card}>
            <h4>{d.title}</h4>
            <p>{d.body}</p>
          </div>
        ))}
      </div>
      <div ref={ref} className={clsx(styles.runs, phase === 'armed' && styles.armed, phase === 'play' && styles.play)}>
        <div className={styles.run}>
          <span className={clsx(styles.chip, styles.step)} style={{'--t': '0s'} as CSSProperties}>
            assistant: sort offers by rarity
          </span>
          <span className={clsx(styles.arrow, styles.step)} style={{'--t': '0.3s'} as CSSProperties} aria-hidden="true">
            <span>→</span>
          </span>
          <span className={clsx(styles.chip, styles.mono, styles.step)} style={{'--t': '0.4s'} as CSSProperties}>
            +1 line · <code>| sort o.Rarity</code>
          </span>
          <span className={clsx(styles.arrow, styles.step)} style={{'--t': '0.7s'} as CSSProperties} aria-hidden="true">
            <span>→</span>
          </span>
          <span className={clsx(styles.chip, styles.mono, styles.rejected, styles.step)} style={{'--t': '0.8s'} as CSSProperties}>
            compiler: unknown column Rarity on Offer — did you mean Tier?
          </span>
        </div>
        <div className={styles.run}>
          <span className={clsx(styles.chip, styles.step)} style={{'--t': '1.6s'} as CSSProperties}>
            assistant: …by tier
          </span>
          <span className={clsx(styles.arrow, styles.step)} style={{'--t': '1.9s'} as CSSProperties} aria-hidden="true">
            <span>→</span>
          </span>
          <span className={clsx(styles.chip, styles.mono, styles.step)} style={{'--t': '2s'} as CSSProperties}>
            +1 line · <code>| sort o.Tier</code>
          </span>
          <span className={clsx(styles.arrow, styles.step)} style={{'--t': '2.3s'} as CSSProperties} aria-hidden="true">
            <span>→</span>
          </span>
          <span className={clsx(styles.chip, styles.mono, styles.accepted, styles.step)} style={{'--t': '2.4s'} as CSSProperties}>
            compiler: ok · 0 diagnostics
          </span>
        </div>
      </div>
      <p className={styles.caption}>
        A rejected draft costs a second. That is what makes it safe to let an assistant write the
        first version.
      </p>
    </div>
  );
}

export default function DeclarativeVsImperative(): ReactNode {
  return (
    <div className={styles.root}>
      <SameRequirement />
      <ChangeRequirement />
      <Door />
    </div>
  );
}

import type {CSSProperties, ReactNode} from 'react';
import clsx from 'clsx';
import {C, CodeWindow, F, K, N, T, type CodeTab} from '@site/src/components/CodeWindow';
import DemoStage, {type DemoStep} from '@site/src/components/DemoStage';
import styles from './styles.module.css';

// Declarative vs imperative, in the DemoStage shell. Four steps: the same
// requirement written both ways (and who owns each decision); two changes to
// the requirement — four places on the left, one line on the right; and an
// assistant's draft the compiler rejects, then accepts.
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

const STEPS: DemoStep[] = [
  {
    id: 'requirement',
    label: 'the requirement',
    holdMs: 4200,
    narration:
      'The same requirement, written as steps on the left and as a result on the right. The four marked places on the left are decisions you own — and one is already a bug.',
  },
  {
    id: 'class',
    label: "add: only the player's class",
    narration: 'One line on the right; four places on the left, and another place to forget.',
  },
  {
    id: 'owned',
    label: 'add: exclude owned items',
    narration: 'One more line on the right; four more places on the left, with a second invalidation path to keep in sync.',
  },
  {
    id: 'assistant',
    label: "an assistant tries 'sort by rarity'",
    holdMs: 4200,
    narration:
      'The draft names a column that does not exist; the compiler says so in a second, and the corrected draft compiles. That is what makes a first version from an assistant safe to try.',
  },
];

const COST: Record<string, [string, string]> = {
  requirement: ['≈ 40 lines · 4 decisions that are yours · 1 bug already in', '6 lines · 0 of those decisions are yours'],
  class: ['+12 lines · 4 places · new invalidation path', '+1 line · 1 place'],
  owned: ['+22 lines · 8 places · new invalidation paths', '+2 lines · 1 place'],
  assistant: ['', 'a rejected draft costs a second'],
};

function Ledger(): ReactNode {
  return (
    <div className={styles.ledger} role="table" aria-label="Who decides">
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
  );
}

function Hunks({active}: {active: Change[]}): ReactNode {
  const hunks = active.flatMap((c) => HUNKS[c].hunks.map((h) => ({...h, change: c})));
  return (
    <ul className={styles.hunks}>
      {hunks.map((h, i) => (
        <li key={`${h.change}-${h.where}`} className={styles.hunk} style={{'--i': i} as CSSProperties}>
          <span className={styles.hunkWhere}>{h.where}</span>
          <pre>
            {h.lines.map((l) => (
              <span key={l}>+ {l}</span>
            ))}
          </pre>
          {h.forget && <span className={styles.forget}>④ another place to forget</span>}
        </li>
      ))}
    </ul>
  );
}

function Drafts(): ReactNode {
  const step = (t: string) => ({'--t': t}) as CSSProperties;
  return (
    <div className={styles.runs}>
      <div className={styles.run}>
        <span className={clsx(styles.chip, styles.step)} style={step('0s')}>
          assistant: sort offers by rarity
        </span>
        <span className={clsx(styles.arrow, styles.step)} style={step('0.3s')} aria-hidden="true">
          <span>→</span>
        </span>
        <span className={clsx(styles.chip, styles.mono, styles.step)} style={step('0.4s')}>
          +1 line · <code>| sort o.Rarity</code>
        </span>
        <span className={clsx(styles.arrow, styles.step)} style={step('0.7s')} aria-hidden="true">
          <span>→</span>
        </span>
        <span className={clsx(styles.chip, styles.mono, styles.rejected, styles.step)} style={step('0.8s')}>
          compiler: unknown column Rarity on Offer — did you mean Tier?
        </span>
      </div>
      <div className={styles.run}>
        <span className={clsx(styles.chip, styles.step)} style={step('1.6s')}>
          assistant: …by tier
        </span>
        <span className={clsx(styles.arrow, styles.step)} style={step('1.9s')} aria-hidden="true">
          <span>→</span>
        </span>
        <span className={clsx(styles.chip, styles.mono, styles.step)} style={step('2s')}>
          +1 line · <code>| sort o.Tier</code>
        </span>
        <span className={clsx(styles.arrow, styles.step)} style={step('2.3s')} aria-hidden="true">
          <span>→</span>
        </span>
        <span className={clsx(styles.chip, styles.mono, styles.accepted, styles.step)} style={step('2.4s')}>
          compiler: ok · 0 diagnostics
        </span>
      </div>
    </div>
  );
}

function Stage({index}: {index: number}): ReactNode {
  const active: Change[] = index === 1 ? ['class'] : index >= 2 ? ['class', 'owned'] : [];
  const on = new Set(active);
  const changing = index === 1 || index === 2;
  return (
    <div className={styles.stage}>
      <p className={styles.requirement}>
        Show the 10 cheapest offers the player can afford. Keep it current.
        {on.has('class') && <span className={styles.reqAdd}> Only the player&apos;s class.</span>}
        {on.has('owned') && <span className={styles.reqAdd}> Exclude owned items.</span>}
      </p>
      <div className={clsx(styles.pair, index === 3 && styles.dimmed)}>
        <div className={styles.side}>
          {changing ? (
            <>
              <span className={styles.sideLabel}>ShopOffers.cs · the change</span>
              <Hunks active={index === 1 ? ['class'] : ['owned']} />
            </>
          ) : (
            <>
              <div className={styles.window}>
                <CodeWindow tabs={IMPERATIVE} dense maxLines={18} />
              </div>
              <ol className={styles.hotspots}>
                {HOTSPOTS.map(([n, t]) => (
                  <li key={n}>
                    <span className={styles.hotNum}>{n}</span>
                    {t}
                  </li>
                ))}
              </ol>
            </>
          )}
        </div>
        <div className={styles.side}>
          <div className={styles.window}>
            <CodeWindow tabs={declarativeTabs(on)} dense />
          </div>
          {active.map((c) => (
            <p key={c} className={styles.plan}>
              {PLAN[c]} <span className={styles.illustrative}>(illustrative)</span>
            </p>
          ))}
          <Ledger />
        </div>
      </div>
      {index === 3 && <Drafts />}
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

export default function DeclarativeVsImperative(): ReactNode {
  return (
    <div className={styles.root}>
      <DemoStage
        title="same requirement, two ways"
        steps={STEPS}
        costLine={({step}) => {
          const [left, right] = COST[step];
          return (
            <span className={styles.costPair}>
              {left && <span className={styles.costRed}>imperative · {left}</span>}
              <span className={styles.costGold}>{left ? `declarative · ${right}` : right}</span>
            </span>
          );
        }}>
        {({index, run, live}) => (
          <div key={`${run}-${index}`} className={clsx(live && styles.live)}>
            <Stage index={index} />
          </div>
        )}
      </DemoStage>
      <div className={styles.door}>
        <h3 className={styles.doorTitle}>Why this is the door for assistants</h3>
        <div className={styles.cards}>
          {DOOR.map((d) => (
            <div key={d.title} className={styles.card}>
              <h4>{d.title}</h4>
              <p>{d.body}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

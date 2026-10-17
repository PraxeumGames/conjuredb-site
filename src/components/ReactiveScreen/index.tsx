import {useState, type ReactNode} from 'react';
import clsx from 'clsx';
import {DEVICE_STATUS_H, DeviceFrame} from '@site/src/components/Glyphs';
import {C, CodeWindow, F, K, T, V, type CodeTab} from '@site/src/components/CodeWindow';
import DemoStage, {CompilerNotes, type DemoStep} from '@site/src/components/DemoStage';
import styles from './styles.module.css';

// "UI views update themselves": a shop UI view bound to a view model (a
// reactive query), in the shared DemoStage shell. Each step is one event; in
// "reactive" mode only the rows whose output changed are touched, in
// "hand-wired" mode an OnChanged presenter refreshes every row — and on the
// third event its handlers run in the wrong order and leave a stale row.

type Mode = 'reactive' | 'wired';
type Row = {name: string; price: number | null; owned: boolean};

const START_GOLD = 220;
const BASE: Row[] = [
  {name: 'Sword', price: 350, owned: false},
  {name: 'Shield', price: 180, owned: true},
  {name: 'Potion', price: 120, owned: false},
  {name: 'Mega potion', price: 480, owned: false},
  {name: 'Bow', price: 300, owned: true},
  {name: 'Whetstone', price: null, owned: false}, // unlocks with a sword
];

const EVENTS = ['server grants +200 gold', 'liveops: potions −50 %', 'player buys sword'];

// What SubscribeChanged delivers for each event: per-row deltas
// (ReactiveChangeAction.Add / Remove / Replace), not the cause.
const DELTAS: string[][] = [
  ['Replace · gold 220 → 420', 'Replace · row 1 · affordable'],
  ['Replace · row 3 · price 120 → 60', 'Replace · row 4 · price 480 → 240'],
  ['Replace · gold 420 → 70', 'Replace · row 1 · owned', 'Replace · row 4 · too expensive', 'Replace · row 6 · price — → 80'],
];
// The hand-wired presenter: every change refreshes everything, and on the
// third event the price handler runs before the list refresh that undoes it.
const WIRED: string[][] = [
  ['OnGoldChanged → refresh 6 rows'],
  ['OnPriceChanged ×2 → refresh 6 rows'],
  ['OnGoldChanged → refresh 6 rows', 'OnPriceChanged → row 6 · 80', 'OnInventoryChanged → refresh 6 rows', '! cached list → row 6 back to —'],
];
const STALE_ROW = 5; // overwritten by a refresh from the cached offer list

// What you write, per mode. Bind/Apply stand for whatever list widget the game uses.
const PRESENTER: CodeTab[] = [
  {
    name: 'ShopPresenter.cs',
    lang: 'C#',
    lines: [
      <><K>public sealed class</K> <T>ShopPresenter</T>(<T>Wallet</T> wallet, <T>Inventory</T> inventory,</>,
      <>    <T>PriceService</T> prices, <T>OfferCatalog</T> offers, <T>OfferListView</T> view)</>,
      <>{'{'}</>,
      <>    <T>List</T>&lt;<T>OfferRow</T>&gt; rows = <K>new</K>();</>,
      <>{' '}</>,
      <>    <K>public void</K> <F>Start</F>()</>,
      <>    {'{'}</>,
      <>        wallet.<V>OnGoldChanged</V> += <F>OnGoldChanged</F>;</>,
      <>        inventory.<V>OnInventoryChanged</V> += <F>OnInventoryChanged</F>;</>,
      <>        prices.<V>OnPriceChanged</V> += <F>OnPriceChanged</F>;</>,
      <>        offers.<V>OnOfferAdded</V> += <F>OnOfferAdded</F>;</>,
      <>        <F>Refresh</F>();</>,
      <>    {'}'}</>,
      <>{' '}</>,
      <>    <K>void</K> <F>OnGoldChanged</F>(<K>int</K> gold) =&gt; <F>Refresh</F>();</>,
      <>    <K>void</K> <F>OnInventoryChanged</F>(<T>ItemId</T> item) =&gt; <F>Refresh</F>();</>,
      <>    <K>void</K> <F>OnOfferAdded</F>(<T>Offer</T> offer) =&gt; <F>Refresh</F>();</>,
      <>{' '}</>,
      <>    <K>void</K> <F>OnPriceChanged</F>(<T>OfferId</T> id, <K>int</K> price)</>,
      <>    {'{'}</>,
      <>        <C>// TODO: price change arrives before offer list refresh → stale row</C></>,
      <>        <K>var</K> n = rows.<F>FindIndex</F>(r =&gt; r.Id == id);</>,
      <>        <K>if</K> (n &lt; <span>0</span>) <K>return</K>;</>,
      <>        rows[n] = rows[n] <K>with</K> {'{'} Price = price {'}'};</>,
      <>        view.<F>SetRow</F>(n, rows[n]);</>,
      <>    {'}'}</>,
      <>{' '}</>,
      <>    <K>void</K> <F>Refresh</F>()</>,
      <>    {'{'}</>,
      <>        rows.<F>Clear</F>();</>,
      <>        <K>foreach</K> (<K>var</K> offer <K>in</K> offers.<F>Visible</F>(inventory))</>,
      <>        {'{'}</>,
      <>            <K>var</K> price = offers.<F>CachedPrice</F>(offer.Id);</>,
      <>            <K>var</K> owned = inventory.<F>Has</F>(offer.ItemId);</>,
      <>            rows.<F>Add</F>(<K>new</K> <T>OfferRow</T>(offer, price, owned, !owned &amp;&amp; price &lt;= wallet.Gold));</>,
      <>        {'}'}</>,
      <>        rows.<F>Sort</F>((a, b) =&gt; a.Price.<F>CompareTo</F>(b.Price));</>,
      <>        view.<F>SetRows</F>(rows);</>,
      <>    {'}'}</>,
      <>{' '}</>,
      <>    <K>public void</K> <F>OnDestroy</F>()</>,
      <>    {'{'}</>,
      <>        wallet.<V>OnGoldChanged</V> -= <F>OnGoldChanged</F>;</>,
      <>        inventory.<V>OnInventoryChanged</V> -= <F>OnInventoryChanged</F>;</>,
      <>        prices.<V>OnPriceChanged</V> -= <F>OnPriceChanged</F>;</>,
      <>        offers.<V>OnOfferAdded</V> -= <F>OnOfferAdded</F>;</>,
      <>    {'}'}</>,
      <>{'}'}</>,
    ],
  },
];
const SCHEMA: CodeTab[] = [
  {
    name: 'shop.conjure',
    lang: 'schema',
    lines: [
      <><K>materialized view</K> <T>ShopOffers</T> {'{'}</>,
      <>    …</>,
      <>{'}'} = <K>from</K> <T>Offer</T> o</>,
      <>    | <K>join</K> <T>Price</T> p (o.Id == p.OfferId)</>,
      <>    | <K>select</K> {'{ … }'}</>,
      <>{' '}</>,
      <><K>reactive query</K> <F>Offers</F>() -&gt; <T>OfferRow</T>[] {'{'}</>,
      <>    <K>from</K> <T>ShopOffers</T></>,
      <>    | <K>sort</K> Price</>,
      <>{'}'}</>,
    ],
  },
];
const COMPILER = ['join maintainer on Offer × Price', 'delta per commit', 'bounded sort state'];

const NARRATION: Record<Mode, string[]> = {
  reactive: [
    'Gold changed, so the view model changed one row — the sword became affordable — and the UI view updated that one row.',
    'Two prices halved: the view model changed two rows, and only those two rows were redrawn.',
    'One purchase changed gold, ownership and an unlocked price: four rows changed, four redrawn, nothing else touched.',
  ],
  wired: [
    'OnGoldChanged fires and the presenter rebuilds all six rows to change one.',
    'Two price events, two full refreshes: six rows redrawn twice for two changes.',
    'Three events fire, the presenter refreshes all six rows, and the price change arrives before the list refresh: row 6 is stale.',
  ],
};

const SCREEN: CodeTab[] = [
  {
    name: 'ShopView.cs',
    lang: 'C#',
    lines: [
      <><K>var</K> offers = ctx.<F>Offers</F>();</>,
      <>offersList.<F>Bind</F>(offers.<V>Current</V>);</>,
      <>offers.<F>SubscribeChanged</F>(</>,
      <>    changes =&gt; offersList.<F>Apply</F>(changes));</>,
    ],
  },
];

type State = {gold: number; rows: Row[]};

function stateAfter(applied: number): State {
  let gold = START_GOLD;
  let rows = BASE.map((r) => ({...r}));
  if (applied >= 1) gold += 200;
  if (applied >= 2) rows = rows.map((r) => (r.name.toLowerCase().includes('potion') && r.price ? {...r, price: r.price / 2} : r));
  if (applied >= 3) {
    gold -= rows[0].price ?? 0;
    rows = rows.map((r, i) => (i === 0 ? {...r, owned: true} : i === 5 ? {...r, price: 80} : r));
  }
  return {gold, rows};
}

/** What a row shows: price, affordability, owned — the reactive query's output. */
const view = (r: Row, gold: number) =>
  `${r.owned}|${r.price ?? '-'}|${!r.owned && r.price !== null && r.price <= gold}`;

const ROW_H = 46;
const ROWS_TOP = DEVICE_STATUS_H + 48;

export default function ReactiveScreen(): ReactNode {
  const [mode, setMode] = useState<Mode>('reactive');
  const wired = mode === 'wired';
  const steps: DemoStep[] = EVENTS.map((label, i) => ({
    id: `e${i + 1}`,
    label,
    narration: NARRATION[mode][i],
    alt: wired && i === 2,
  }));

  return (
    <DemoStage
      title="UI view stays in sync"
      modes={[
        {id: 'reactive', label: 'reactive'},
        {id: 'wired', label: 'hand-wired'},
      ]}
      mode={mode}
      onMode={(m) => setMode(m as Mode)}
      steps={steps}
      stageMinHeight={{wide: '28rem', narrow: '33rem'}}
      costLine={({index}) => {
        const applied = index + 1;
        if (wired) return applied >= 3 ? 'rows refreshed 6 / 6 · 1 stale' : 'rows refreshed 6 / 6';
        return `rows touched ${touchedRows(applied).length} / 6 · delta, not rescan`;
      }}
      codeTabs={[
        {id: 'schema', label: 'schema', content: <CodeWindow tabs={SCHEMA} dense />},
        {
          id: 'write',
          label: 'what you write',
          content: (
            <div className={styles.write}>
              <CodeWindow tabs={wired ? PRESENTER : SCREEN} dense locked={wired} />
              <p className={clsx(styles.writeSummary, wired && styles.red)}>
                {wired ? '≈ 40 lines · 4 subscriptions · 1 ordering bug' : '4 lines · 0 subscriptions to manage · no ordering'}
              </p>
            </div>
          ),
        },
        {id: 'compiler', label: 'what the compiler does', content: <CompilerNotes lines={COMPILER} />},
      ]}>
      {({index, run}) => <Stage applied={index + 1} wired={wired} run={run} />}
    </DemoStage>
  );
}

function touchedRows(applied: number): number[] {
  if (applied === 0) return [];
  const now = stateAfter(applied);
  const before = stateAfter(applied - 1);
  return now.rows.map((r, i) => (view(r, now.gold) !== view(before.rows[i], before.gold) ? i : -1)).filter((i) => i >= 0);
}

function Stage({applied, wired, run}: {applied: number; wired: boolean; run: number}): ReactNode {
  const now = stateAfter(applied);
  const before = stateAfter(Math.max(0, applied - 1));
  const touched = touchedRows(applied);
  const stale = wired && applied >= 3;
  const flashed = applied === 0 ? [] : wired ? BASE.map((_, i) => i) : touched;

  return (
    <div className={clsx(styles.stage, wired && styles.isWired)}>
      <svg
        className={styles.svg}
        viewBox="0 0 270 380"
        role="img"
        style={{fontSize: 15}}
        aria-label={`Shop UI view: gold ${now.gold}. ${now.rows.map((r) => `${r.name} ${r.owned ? 'owned' : r.price ?? 'locked'}`).join(', ')}.`}>
        {/* OnChanged web from every row to the presenter beside the device (hand-wired) */}
        <g className={styles.web}>
          {BASE.map((_, i) => (
            <path key={i} d={`M222 ${ROWS_TOP + i * ROW_H + 10} C252 ${ROWS_TOP + i * ROW_H + 10} 262 190 300 190`} />
          ))}
        </g>
        <DeviceFrame x={1} y={1} width={220} height={378}>
          <text className={styles.goldLabel} x={16} y={DEVICE_STATUS_H + 22}>
            gold
          </text>
          <text className={styles.gold} x={58} y={DEVICE_STATUS_H + 22}>
            {now.gold.toLocaleString('en-US')}
          </text>
          {now.rows.map((r, i) => {
            const y = ROWS_TOP + i * ROW_H;
            const showStale = stale && i === STALE_ROW;
            const price = showStale ? before.rows[i].price : r.price;
            const affordable = !r.owned && price !== null && price <= now.gold;
            return (
              <g key={r.name} transform={`translate(10 ${y - 12})`}>
                {flashed.includes(i) && (
                  <rect key={`${wired}-${applied}-${run}`} className={clsx(styles.flash, wired && styles.flashRed)} width={200} height={ROW_H - 6} rx={6} />
                )}
                <text className={clsx(styles.name, !r.owned && !affordable && styles.dim)} x={8} y={22}>
                  {r.name}
                </text>
                {r.owned && (
                  <g transform="translate(116 8)">
                    <rect className={styles.tag} width={56} height={20} rx={10} />
                    <text className={styles.tagText} x={28} y={14.5} textAnchor="middle">owned</text>
                  </g>
                )}
                {showStale && (
                  <g transform="translate(110 8)">
                    <rect className={styles.staleTag} width={52} height={20} rx={10} />
                    <text className={styles.staleText} x={26} y={14.5} textAnchor="middle">stale</text>
                  </g>
                )}
                {!r.owned && (
                  <text className={clsx(styles.price, !affordable && styles.dim)} x={192} y={22} textAnchor="end">
                    {price === null ? '—' : price}
                  </text>
                )}
              </g>
            );
          })}
        </DeviceFrame>
      </svg>

      <div className={styles.panel}>
        {wired && (
          <pre className={styles.presenter}>
            <span className={styles.cls}>ShopPresenter</span>
            {'\n'}  OnGoldChanged      += Refresh;
            {'\n'}  OnInventoryChanged += Refresh;
            {'\n'}  OnOfferAdded       += Refresh;
            {'\n'}  OnPriceChanged     += OnPriceChanged;
            {'\n'}<span className={styles.missed}>  // arrival order decides the row</span>
          </pre>
        )}
        <div className={styles.stream}>
          <span className={styles.streamTitle}>{wired ? 'OnChanged handlers' : 'SubscribeChanged · per-row deltas'}</span>
          <ol>
            {(wired ? WIRED : DELTAS).slice(0, applied).flatMap((lines, step) =>
              lines.map((l) => (
                <li key={`${step}-${l}`} className={clsx(step === applied - 1 && styles.latest, l.startsWith('! ') && styles.miss)}>
                  {l.replace(/^! /, '')}
                </li>
              )),
            )}
          </ol>
        </div>
      </div>
    </div>
  );
}

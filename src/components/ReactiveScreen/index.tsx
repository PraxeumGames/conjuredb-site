import {useEffect, useRef, useState, type ReactNode} from 'react';
import clsx from 'clsx';
import {DEVICE_STATUS_H, DeviceFrame} from '@site/src/components/Glyphs';
import styles from './styles.module.css';

// "Screens update themselves": a shop screen backed by a reactive query.
// Each event changes the data; in "reactive view" mode only the rows whose
// output changed are touched, in "hand-wired" mode an OnChanged presenter
// refreshes every row — and misses one subscription on the third event.

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

const EVENTS = ['server grants +200 gold', 'liveops: potions −50%', 'player buys sword'];

// What SubscribeChanged delivers for each event: per-row deltas
// (ReactiveChangeAction.Add / Remove / Replace), not the cause.
const DELTAS: string[][] = [
  ['Replace · gold 220 → 420', 'Replace · row 1 · affordable'],
  ['Replace · row 3 · price 120 → 60', 'Replace · row 4 · price 480 → 240'],
  ['Replace · gold 420 → 70', 'Replace · row 1 · owned', 'Replace · row 4 · too expensive', 'Replace · row 6 · price — → 80'],
];
// The hand-wired presenter: every change refreshes everything; one event has no handler.
const WIRED: string[][] = [
  ['OnGoldChanged → refresh 6 rows'],
  ['OnPricesChanged → refresh 6 rows'],
  ['OnGoldChanged → refresh 6 rows', 'inventory changed → no handler'],
];
const STALE_ROW = 5; // the hand-wired presenter never subscribed to inventory changes

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
  const [applied, setApplied] = useState(0);
  const [auto, setAuto] = useState(true);
  const [visible, setVisible] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setAuto(false);
      setApplied(3);
    }
  }, []);

  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), {threshold: 0.35});
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Auto-play: one event every 2.2 s, a pause on the final state, then again.
  useEffect(() => {
    if (!auto || !visible) return;
    const t = window.setTimeout(() => setApplied((a) => (a >= 3 ? 0 : a + 1)), applied >= 3 ? 3600 : 2200);
    return () => window.clearTimeout(t);
  }, [auto, visible, applied]);

  const now = stateAfter(applied);
  const before = stateAfter(Math.max(0, applied - 1));
  const touched = applied === 0 ? [] : now.rows.map((r, i) => view(r, now.gold) !== view(before.rows[i], before.gold)).map((c, i) => (c ? i : -1)).filter((i) => i >= 0);
  const wired = mode === 'wired';
  const stale = wired && applied >= 3;
  const flashed = applied === 0 ? [] : wired ? BASE.map((_, i) => i) : touched;

  const fire = (n: number) => {
    setAuto(false);
    setApplied(n);
  };
  const pickMode = (m: Mode) => {
    setMode(m);
    setAuto(false);
    setApplied(0);
  };

  return (
    <div ref={rootRef} className={clsx(styles.root, wired && styles.isWired)}>
      <div className={styles.toggle} role="group" aria-label="How the screen is kept up to date">
        {(['reactive', 'wired'] as Mode[]).map((m) => (
          <button key={m} type="button" aria-pressed={mode === m} className={clsx(mode === m && styles.on)} onClick={() => pickMode(m)}>
            {m === 'reactive' ? 'reactive view' : 'hand-wired'}
          </button>
        ))}
      </div>

      {/* The query (or the presenter it replaces); the web below runs up to it. */}
      {wired ? (
        <pre className={clsx(styles.code, styles.presenter)}>
          <span className={styles.cls}>ShopPresenter</span>
          {'\n'}  OnGoldChanged   += RefreshAll;
          {'\n'}  OnPricesChanged += RefreshAll;
          {'\n'}<span className={styles.missed}>  // OnInventoryChanged — never wired</span>
        </pre>
      ) : (
        <pre className={styles.code}>
          <span className={styles.kw}>materialized view</span> ShopOffers {'{'}
          {'\n'}    …
          {'\n'}{'}'} = <span className={styles.kw}>from</span> Offer o
          {'\n'}    | <span className={styles.kw}>join</span> Price p (o.Id == p.OfferId)
          {'\n'}    | <span className={styles.kw}>select</span> {'{ … }'}
          {'\n'}
          {'\n'}<span className={styles.kw}>reactive query</span> Offers() -&gt; OfferRow[] {'{'}
          {'\n'}    <span className={styles.kw}>from</span> ShopOffers
          {'\n'}    | <span className={styles.kw}>sort</span> Price
          {'\n'}{'}'}
        </pre>
      )}
      <div className={styles.stage}>
        <div className={styles.deviceCol}>
          <svg className={styles.svg} viewBox="0 0 270 380" role="img" style={{fontSize: 15}}
            aria-label={`Shop screen: gold ${now.gold}. ${now.rows.map((r) => `${r.name} ${r.owned ? 'owned' : r.price ?? 'locked'}`).join(', ')}.`}>
            {/* OnChanged web from the presenter to every row (hand-wired mode) */}
            <g className={styles.web}>
              {BASE.map((_, i) => (
                <path key={i} d={`M222 ${ROWS_TOP + i * ROW_H + 10} C252 ${ROWS_TOP + i * ROW_H + 10} 258 60 258 -6`} />
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
                      <rect key={`${mode}-${applied}`} className={clsx(styles.flash, wired && styles.flashRed)} width={200} height={ROW_H - 6} rx={6} />
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
          <p className={styles.counter} aria-live="polite">
            {applied === 0
              ? 'waiting for an event'
              : wired
                ? 'rows refreshed 6 / 6'
                : `rows touched ${touched.length} / 6 · delta, not rescan`}
          </p>
        </div>

        <div className={styles.side}>
          <div className={styles.controls}>
            <button
              type="button"
              className={styles.next}
              onClick={() => fire(applied >= 3 ? 0 : applied + 1)}>
              {applied >= 3 ? 'reset ↺' : `▸ ${EVENTS[applied]}`}
            </button>
          </div>
          <div className={styles.stream}>
            <span className={styles.streamTitle}>
              {wired ? 'OnChanged handlers' : 'SubscribeChanged · per-row deltas'}
            </span>
            <ol>
              {(wired ? WIRED : DELTAS).slice(0, applied).flatMap((lines, step) =>
                lines.map((l) => (
                  <li key={`${step}-${l}`} className={clsx(step === applied - 1 && styles.latest, l.includes('no handler') && styles.miss)}>
                    {l}
                  </li>
                )),
              )}
              {applied === 0 && <li className={styles.empty}>no changes yet</li>}
            </ol>
          </div>
        </div>
      </div>
      <p className={styles.caption}>
        A materialized view keeps the result and the compiler maintains it by delta — filters,
        joins, aggregates, bounded Top-K. A reactive query is the screen&apos;s subscription to it:
        the current rows and per-row changes. Ordinary queries reuse the same state.
      </p>
    </div>
  );
}

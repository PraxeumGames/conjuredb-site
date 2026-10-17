import {useEffect, useRef, useState, type CSSProperties, type ReactNode} from 'react';
import clsx from 'clsx';
import {DEVICE_STATUS_H, DeviceFrame, ServerFrame, WifiGlyph, serverHashAt} from '@site/src/components/Glyphs';
import styles from './styles.module.css';

// Visual B — "offline tap → server replay". The device runs the compiled
// logic and logs the player's actions; on reconnect the server replays the
// log with the same compiled logic and compares state. Built like
// TangleToSchema: SVG + CSS, React only flips the phase class. Timed steps
// inside a phase are CSS animation delays, restarted by the class change.

type Phase = 'offline' | 'reconnect' | 'replay' | 'forged';
const PHASES: Phase[] = ['offline', 'reconnect', 'replay', 'forged'];

const HOLD_MS: Record<Phase, number> = {offline: 4600, reconnect: 2600, replay: 4000, forged: 5200};

const PHASE_CLASS: Record<Phase, string> = {
  offline: styles.isOffline,
  reconnect: styles.isReconnect,
  replay: styles.isReplay,
  forged: styles.isForged,
};

const STEPS: {phase: Phase; n: string; label: string}[] = [
  {phase: 'offline', n: '01', label: 'play offline'},
  {phase: 'reconnect', n: '02', label: 'reconnect'},
  {phase: 'replay', n: '03', label: 'server replays'},
  {phase: 'forged', n: '04', label: 'forged action rejected'},
];

const ARIA: Record<Phase, string> = {
  offline:
    'Play offline: the phone has no connection; the server still holds the last verified state, a hash of 91c0, and waits for the log. The player buys a sword, equips it, opens a chest, claims a 200 gold reward and buys a potion. Each action is applied on the device at once and written to a local log: 5 actions, 0 requests. Gold goes from 1,200 to 1,050; device state hash a3f9.',
  reconnect:
    'Reconnect: the connection is back and the five logged actions travel to the server as one packet, starting from the last verified state 91c0. The server notes: log received.',
  replay:
    'Server replays: the server runs the same five actions with the same compiled logic, checking each one — 5 actions in 11 microseconds. Its state hash is a3f9, the same as the device. Verdict: accepted.',
  forged:
    'Forged action rejected: the device holds a forged state — gold 1,250, hash f00d — because the third action in its log is forged: BuyItem(sword, price: 0). The server accepts the first two actions, rejects the forged one and stops at state 5e02; the states differ. Verdict: rejected, state rolled back. Then the device rolls back to the server state: gold 950, hash 5e02 — server state restored.',
};

// Phase 01 story.
const ACTIONS = ['BuyItem(sword)', 'EquipItem', 'OpenChest', 'ClaimReward', 'BuyItem(potion)'];
const FORGED = 'BuyItem(sword, price: 0)';
const TAP = [0.5, 1.2, 1.9, 2.6, 3.3]; // seconds into phase 01
const TAP_ON = ['buy', 'sword', 'chest', 'chest', 'buy'] as const;
const GOLD = ['1,200', '950', '950', '950', '1,150', '1,050'];
const HASH = ['#91c0', '#b7e2', '#4d18', '#c06a', '#2f9d', '#a3f9'];
// Phase 03: fast replay, one check every 120 ms.
const TICK = (i: number) => 0.5 + 0.12 * i;
const MICROS = [2, 4, 6, 9, 11];
// Phase 04: slower so the ✗ is readable.
const TICK_FORGED = [0.6, 0.85, 1.1];
// Phase 04 has two beats: the server rejects the forged log, then (SNAP)
// the device rolls back to the server's state.
const SNAP = 2.6;

// --- per-phase visibility -------------------------------------------------
// true = visible for the whole phase, 'off' = fade out at phase start,
// {in, out} = appear / disappear at those seconds into the phase.
type Vis = true | 'off' | {in?: number; out?: number};
type VisSpec = Partial<Record<1 | 2 | 3 | 4, Vis>>;

function vis(spec: VisSpec, extra?: string): {className: string; style: CSSProperties} {
  const cls: (string | undefined)[] = [styles.v, extra];
  const style: Record<string, string> = {};
  for (const n of [1, 2, 3, 4] as const) {
    const v = spec[n];
    if (v === undefined) continue;
    if (v === true) cls.push(styles[`on${n}`]);
    else if (v === 'off') cls.push(styles[`off${n}`]);
    else {
      // Without `in`, the element is visible from the start of the phase.
      cls.push(v.in === undefined ? styles[`x${n}`] : styles[`w${n}`]);
      if (v.in !== undefined) style[`--i${n}`] = `${v.in}s`;
      if (v.out !== undefined) {
        style[`--o${n}`] = `${v.out}s`;
        cls.push(styles[`o${n}`]);
      }
    }
  }
  return {className: clsx(cls), style: style as CSSProperties};
}

/** A sequence of values that replace each other at the given times. */
function sequence(times: number[], phase: 1 | 3): VisSpec[] {
  return times.map((t, k) => ({[phase]: {in: k === 0 ? undefined : t, out: times[k + 1]}}));
}

// --- layouts ---------------------------------------------------------------
type Pt = [number, number];
type Anchor = 'start' | 'middle' | 'end';
type Box = {x: number; y: number; w: number; h: number};
type Layout = {
  top: number; // viewBox y offset — trims empty space above the drawing
  w: number;
  h: number;
  font: number;
  shopFont: number;
  device: Box;
  stream: string;
  marks: Pt[];
  labels: {at: Pt; anchor: Anchor}[];
  corner: {at: Pt; anchor: Anchor};
  deviceHash: Pt;
  server: Box;
  slots: Pt[];
  forgedLabel: Pt;
  counter: Pt;
  note: Pt;
  rollNote: Pt;
  match: {a: Pt; b: Pt; label: {at: Pt; anchor: Anchor}};
  verdict: Pt;
};

const WIDE_MARKS: Pt[] = [300, 360, 420, 480, 540].map((x) => [x, 200]);
const WIDE: Layout = {
  top: 50,
  w: 880,
  h: 345,
  font: 14,
  shopFont: 12,
  device: {x: 40, y: 70, w: 200, h: 260},
  stream: 'M240 200 H600',
  marks: WIDE_MARKS,
  labels: WIDE_MARKS.map(([x], i) => ({at: [x, i % 2 ? 224 : 186], anchor: 'middle'})),
  corner: {at: [420, 112], anchor: 'middle'},
  deviceHash: [262, 322],
  server: {x: 600, y: 60, w: 250, h: 280},
  slots: [653, 689, 725, 761, 797].map((x) => [x, 200]),
  forgedLabel: [725, 238],
  counter: [725, 264],
  note: [725, 140],
  rollNote: [140, 354],
  match: {a: [392, 318], b: [610, 318], label: {at: [501, 308], anchor: 'middle'}},
  verdict: [725, 372],
};

const NARROW_MARKS: Pt[] = [272, 306, 340, 374, 408].map((y) => [180, y]);
const NARROW: Layout = {
  top: 0,
  w: 360,
  h: 750,
  font: 12.5,
  shopFont: 10.5,
  device: {x: 100, y: 8, w: 160, h: 230},
  stream: 'M180 238 V500',
  marks: NARROW_MARKS,
  labels: NARROW_MARKS.map(([x, y]) => ({at: [x + 14, y + 4], anchor: 'start'})),
  corner: {at: [16, 276], anchor: 'start'},
  deviceHash: [16, 456],
  server: {x: 30, y: 500, w: 300, h: 200},
  slots: [100, 140, 180, 220, 260].map((x) => [x, 578]),
  forgedLabel: [180, 610],
  counter: [180, 636],
  note: [180, 636],
  rollNote: [180, 258],
  match: {a: [20, 464], b: [20, 690], label: {at: [316, 684], anchor: 'end'}},
  verdict: [180, 728],
};

// --- the phone's shop screen ---------------------------------------------
function shopGeom(w: number, h: number) {
  const p = 14;
  const gap = 7;
  const cw = (w - 2 * p - 2 * gap) / 3;
  const ch = cw * 1.45;
  const top = DEVICE_STATUS_H + 44;
  const cards = [0, 1, 2].map((i) => ({x: p + i * (cw + gap), y: top, w: cw, h: ch}));
  const buy = {x: p, y: h - p - 36, w: w - 2 * p, h: 34};
  const center = (b: {x: number; y: number; w: number; h: number}): Pt => [b.x + b.w / 2, b.y + b.h / 2];
  return {p, cards, buy, goldY: DEVICE_STATUS_H + 24, targets: {buy: center(buy), sword: center(cards[0]), chest: center(cards[2])}};
}

const ITEMS = [
  {name: 'sword', price: '250'},
  {name: 'potion', price: '100'},
  {name: 'chest', price: 'open'},
];

function ItemIcon({i, s}: {i: number; s: number}) {
  if (i === 0)
    return (
      <g className={styles.icon}>
        <path d={`M${-s * 0.7} ${s * 0.7} L${s * 0.7} ${-s * 0.7}`} />
        <path d={`M${-s * 0.55} ${s * 0.15} L${-s * 0.15} ${s * 0.55}`} />
      </g>
    );
  if (i === 1)
    return (
      <g className={styles.icon}>
        <circle cy={s * 0.25} r={s * 0.5} />
        <path d={`M${-s * 0.18} ${-s * 0.25} V${-s * 0.7} H${s * 0.18} V${-s * 0.25}`} />
      </g>
    );
  return (
    <g className={styles.icon}>
      <rect x={-s * 0.75} y={-s * 0.5} width={s * 1.5} height={s * 1.1} rx={2} />
      <path d={`M${-s * 0.75} ${-s * 0.05} H${s * 0.75}`} />
      <circle cy={s * 0.15} r={s * 0.12} />
    </g>
  );
}

function Shop({layout}: {layout: Layout}) {
  const {w, h} = layout.device;
  const g = shopGeom(w, h);
  return (
    <g style={{fontSize: layout.shopFont}}>
      <text className={styles.goldLabel} x={g.p} y={g.goldY}>
        gold
      </text>
      <g {...vis({4: {in: SNAP, out: SNAP + 0.5}}, styles.flash)}>
        <rect x={g.p + 30} y={g.goldY - 13} width={62} height={18} rx={4} />
      </g>
      {sequence([0, ...TAP.map((t) => t + 0.08)], 1).map((spec, k) => (
        <text
          key={k}
          {...vis({...spec, ...(k === 5 ? {2: true, 3: true} : {})}, styles.goldValue)}
          x={g.p + 34}
          y={g.goldY}>
          {GOLD[k]}
        </text>
      ))}
      <text {...vis({4: {out: SNAP}}, clsx(styles.goldValue, styles.red))} x={g.p + 34} y={g.goldY}>
        1,250
      </text>
      <text {...vis({4: {in: SNAP}}, styles.goldValue)} x={g.p + 34} y={g.goldY}>
        950
      </text>

      {g.cards.map((c, i) => (
        <g key={ITEMS[i].name}>
          <rect className={styles.card} x={c.x} y={c.y} width={c.w} height={c.h} rx={6} />
          <g transform={`translate(${c.x + c.w / 2} ${c.y + c.h * 0.36})`}>
            <ItemIcon i={i} s={c.w * 0.22} />
          </g>
          <text className={styles.cardName} x={c.x + c.w / 2} y={c.y + c.h * 0.72} textAnchor="middle">
            {ITEMS[i].name}
          </text>
          <text className={styles.cardPrice} x={c.x + c.w / 2} y={c.y + c.h * 0.9} textAnchor="middle">
            {ITEMS[i].price}
          </text>
        </g>
      ))}

      <rect className={styles.buy} x={g.buy.x} y={g.buy.y} width={g.buy.w} height={g.buy.h} rx={8} />
      <text className={styles.buyLabel} x={g.buy.x + g.buy.w / 2} y={g.buy.y + g.buy.h / 2} dominantBaseline="central" textAnchor="middle">
        Buy
      </text>

      {TAP.map((t, i) => {
        const [tx, ty] = g.targets[TAP_ON[i]];
        return (
          <g key={i} transform={`translate(${tx} ${ty})`}>
            <circle className={styles.ripple} r={16} style={{'--i1': `${t}s`} as CSSProperties} />
          </g>
        );
      })}
    </g>
  );
}

// --- the scene -------------------------------------------------------------
function textWidth(chars: number, fontPx: number) {
  return chars * fontPx * 0.6;
}

function Scene({layout, phase, className}: {layout: Layout; phase: Phase; className: string}) {
  const {device, server, match} = layout;
  const smallPx = layout.font * 0.8;
  const [hx, hy] = serverHashAt(server.x, server.y, server.h);
  const mid: Pt = [(match.a[0] + match.b[0]) / 2, (match.a[1] + match.b[1]) / 2];
  const len = Math.hypot(match.b[0] - match.a[0], match.b[1] - match.a[1]) || 1;
  const breakStyle = {
    '--bx': `${((match.b[0] - match.a[0]) / len) * 7}px`,
    '--by': `${((match.b[1] - match.a[1]) / len) * 7}px`,
  } as CSSProperties;
  const forgedW = textWidth(FORGED.length, smallPx);

  return (
    <svg
      className={className}
      viewBox={`0 ${layout.top} ${layout.w} ${layout.h}`}
      role="img"
      aria-label={ARIA[phase]}
      style={{fontSize: layout.font}}>
      <g className={styles.scene}>
        {/* The device */}
        <DeviceFrame
          x={device.x}
          y={device.y}
          width={device.w}
          height={device.h}
          network={<WifiGlyph arcsClassName={styles.wifiArcs} crossClassName={styles.wifiCross} />}>
          <Shop layout={layout} />
        </DeviceFrame>

        {/* The action log */}
        <path className={styles.stream} d={layout.stream} />
        {sequence([0, ...TAP.map((t) => t + 0.08)], 1).map((spec, k) => (
          <text
            key={k}
            {...vis(spec, styles.corner)}
            x={layout.corner.at[0]}
            y={layout.corner.at[1]}
            textAnchor={layout.corner.anchor}>
            {k} {k === 1 ? 'action' : 'actions'} · 0 requests
          </text>
        ))}
        <text
          {...vis({2: {in: 0.3}}, styles.corner)}
          x={layout.corner.at[0]}
          y={layout.corner.at[1]}
          textAnchor={layout.corner.anchor}>
          5 actions · 1 request
        </text>
        {ACTIONS.map((a, i) => (
          <text
            key={a}
            {...vis({1: {in: TAP[i] + 0.08}, 2: 'off'}, styles.markLabel)}
            x={layout.labels[i].at[0]}
            y={layout.labels[i].at[1]}
            textAnchor={layout.labels[i].anchor}>
            {a}
          </text>
        ))}

        {/* Device state hash */}
        {sequence([0, ...TAP.map((t) => t + 0.08)], 1).map((spec, k) => (
          <text
            key={k}
            {...vis({...spec, ...(k === 5 ? {2: true, 3: true} : {})}, styles.hash)}
            x={layout.deviceHash[0]}
            y={layout.deviceHash[1]}>
            device state {HASH[k]}
          </text>
        ))}
        <text {...vis({4: {out: SNAP}}, clsx(styles.hash, styles.red))} x={layout.deviceHash[0]} y={layout.deviceHash[1]}>
          device state #f00d
        </text>
        <text {...vis({4: {in: SNAP}}, styles.hash)} x={layout.deviceHash[0]} y={layout.deviceHash[1]}>
          device state #5e02
        </text>
        <g {...vis({4: {in: SNAP + 0.1}}, styles.rollNote)}>
          <rect
            x={layout.rollNote[0] - textWidth(27, smallPx) / 2 - 6}
            y={layout.rollNote[1] - smallPx}
            width={textWidth(27, smallPx) + 12}
            height={smallPx * 1.5}
          />
          <text x={layout.rollNote[0]} y={layout.rollNote[1]} textAnchor="middle">
            rolled back to server state
          </text>
        </g>

        {/* Match line between the two hashes */}
        <g style={breakStyle}>
          <path className={clsx(styles.matchHalf, styles.matchA)} d={`M${match.a[0]} ${match.a[1]} L${mid[0]} ${mid[1]}`} />
          <path className={clsx(styles.matchHalf, styles.matchB)} d={`M${mid[0]} ${mid[1]} L${match.b[0]} ${match.b[1]}`} />
        </g>
        {/* The server */}
        <ServerFrame
          className={styles.server}
          x={server.x}
          y={server.y}
          width={server.w}
          height={server.h}
          title="Server · player grain"
        />
        <text
          {...vis({3: {in: 1.35}}, styles.matchLabel)}
          x={match.label.at[0]}
          y={match.label.at[1]}
          textAnchor={match.label.anchor}>
          state matches
        </text>
        <text
          {...vis({4: {in: 1.35, out: SNAP}}, clsx(styles.matchLabel, styles.red))}
          x={match.label.at[0]}
          y={match.label.at[1]}
          textAnchor={match.label.anchor}>
          state differs
        </text>
        <text
          {...vis({4: {in: SNAP + 0.2}}, clsx(styles.matchLabel, styles.muted))}
          x={match.label.at[0]}
          y={match.label.at[1]}
          textAnchor={match.label.anchor}>
          server state restored
        </text>
        <text {...vis({2: true, 3: {out: 1.15}, 4: {out: 1.3}}, styles.serverHash)} x={hx} y={hy}>
          state #91c0
        </text>
        <text {...vis({3: {in: 1.15}}, styles.serverHash)} x={hx} y={hy}>
          state #a3f9
        </text>
        <text {...vis({4: {in: 1.3}}, styles.serverHash)} x={hx} y={hy}>
          state #5e02
        </text>
        {/* Offline, the server is still the source of truth: its last verified state. */}
        <g {...vis({1: true}, styles.waiting)}>
          <text className={styles.serverHash} x={layout.note[0]} y={layout.note[1]} textAnchor="middle">
            last verified state #91c0
          </text>
          <text className={styles.note} x={layout.note[0]} y={layout.note[1] + layout.font * 1.4} textAnchor="middle">
            waiting for the log
          </text>
        </g>
        <text {...vis({2: {in: 1.2}}, styles.note)} x={layout.note[0]} y={layout.note[1]} textAnchor="middle">
          log received
        </text>

        {/* Replay: checks, counter, the forged action */}
        {layout.slots.map(([sx, sy], i) => (
          <g key={i} transform={`translate(${sx} ${sy - 18})`}>
            <path
              {...vis({3: {in: TICK(i) + 0.02}, ...(i < 2 ? {4: {in: TICK_FORGED[i]}} : {})}, styles.check)}
              d="M-4.5 0 l3 3 l6 -6.5"
            />
            {i === 2 && <path {...vis({4: {in: TICK_FORGED[2]}}, styles.cross)} d="M-4 -4 L4 4 M4 -4 L-4 4" />}
          </g>
        ))}
        {MICROS.map((us, k) => (
          <text
            key={k}
            {...vis({3: {in: TICK(k) + 0.02, out: k < 4 ? TICK(k + 1) + 0.02 : undefined}}, styles.counter)}
            x={layout.counter[0]}
            y={layout.counter[1]}
            textAnchor="middle">
            {k + 1} {k === 0 ? 'action' : 'actions'} · {us} µs
          </text>
        ))}
        <text
          {...vis({4: {in: TICK_FORGED[2]}}, clsx(styles.counter, styles.red))}
          x={layout.counter[0]}
          y={layout.counter[1]}
          textAnchor="middle">
          stopped at action 3
        </text>
        <g {...vis({4: {in: 0.25}}, styles.forged)}>
          <text x={layout.forgedLabel[0]} y={layout.forgedLabel[1]} textAnchor="middle">
            {FORGED}
          </text>
        </g>
        <path
          {...vis({4: {in: TICK_FORGED[2]}}, styles.strike)}
          d={`M${layout.forgedLabel[0] - forgedW / 2 - 3} ${layout.forgedLabel[1] - smallPx * 0.32} h${forgedW + 6}`}
        />

        {/* Markers: added on the device's log, then sent to the server as one packet */}
        {layout.marks.map(([mx, my], i) => {
          const [sx, sy] = layout.slots[i];
          const style = {
            '--tx': `${sx - mx}px`,
            '--ty': `${sy - my}px`,
            '--d': `${0.3 + i * 0.05}s`,
          } as CSSProperties;
          return (
            <g key={i} transform={`translate(${mx} ${my})`}>
              <g className={clsx(styles.mk, i === 2 && styles.forgedMk, i > 2 && styles.afterMk)} style={style}>
                <g {...vis({1: {in: TAP[i] + 0.08}, 2: true, 3: true, 4: true})}>
                  <rect className={styles.mkBox} x={-5} y={-5} width={10} height={10} rx={2} />
                </g>
              </g>
            </g>
          );
        })}

        {/* Verdict */}
        <Verdict at={layout.verdict} label="accepted" spec={{3: {in: 1.55}}} px={smallPx} />
        <Verdict at={layout.verdict} label="rejected · state rolled back" spec={{4: {in: 1.5}}} px={smallPx} red />
      </g>
    </svg>
  );
}

function Verdict({at, label, spec, px, red}: {at: Pt; label: string; spec: VisSpec; px: number; red?: boolean}) {
  const w = textWidth(label.length, px) + 26;
  return (
    <g {...vis(spec, clsx(styles.verdict, red && styles.red))}>
      <rect x={at[0] - w / 2} y={at[1] - 13} width={w} height={24} rx={12} />
      <text x={at[0]} y={at[1]} dominantBaseline="central" textAnchor="middle">
        {label}
      </text>
    </g>
  );
}

export default function ReplayVerify(): ReactNode {
  const [phase, setPhase] = useState<Phase>('offline');
  const [auto, setAuto] = useState(true);
  const [visible, setVisible] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Reduced motion: show the replay result, no cycling.
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => {
      if (mq.matches) {
        setAuto(false);
        setPhase('replay');
      }
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  // Only cycle while on screen; restart the story when it scrolls into view.
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), {threshold: 0.35});
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!auto || !visible) return;
    const t = window.setTimeout(() => {
      setPhase((p) => PHASES[(PHASES.indexOf(p) + 1) % PHASES.length]);
    }, HOLD_MS[phase]);
    return () => window.clearTimeout(t);
  }, [phase, auto, visible]);

  const pick = (p: Phase) => {
    setAuto(false);
    setPhase(p);
  };

  return (
    <div ref={rootRef} className={clsx(styles.root, PHASE_CLASS[phase], !visible && auto && styles.paused)}>
      <div className={styles.stage}>
        <Scene layout={WIDE} phase={phase} className={styles.wide} />
        <Scene layout={NARROW} phase={phase} className={styles.narrow} />
      </div>
      <div className={styles.steps} role="group" aria-label="Show step">
        {STEPS.map((s) => {
          const active = s.phase === phase;
          return (
            <button
              key={s.phase}
              type="button"
              aria-pressed={active}
              className={clsx(styles.step, active && styles.stepActive, s.phase === 'forged' && styles.stepRed)}
              onClick={() => pick(s.phase)}>
              <span className={styles.stepN}>{s.n}</span>
              <span className={styles.stepLabel}>{s.label}</span>
              {active && auto && visible && (
                <span
                  key={phase}
                  className={styles.stepTimer}
                  style={{animationDuration: `${HOLD_MS[phase]}ms`}}
                  aria-hidden="true"
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

import {useEffect, useId, useRef, useState, type CSSProperties, type ReactNode} from 'react';
import clsx from 'clsx';
import styles from './styles.module.css';

// Hero visual: hand-wired game scripts (muted red-grey) collapse into one
// game.conjure file (gold), which then fans out into generated modules.
// Pure SVG + CSS transitions; React only flips the phase class.

type Phase = 'tangle' | 'schema' | 'generated';
const PHASES: Phase[] = ['tangle', 'schema', 'generated'];

// Time on each phase in auto-play: its transition plus a ~2.5 s hold.
const HOLD_MS: Record<Phase, number> = {tangle: 3300, schema: 3600, generated: 4600};

const PHASE_CLASS: Record<Phase, string> = {
  tangle: styles.isTangle,
  schema: styles.isSchema,
  generated: styles.isGenerated,
};

const STEPS: {phase: Phase; n: string; label: string}[] = [
  {phase: 'tangle', n: '01', label: 'hand-written today'},
  {phase: 'schema', n: '02', label: 'you write this'},
  {phase: 'generated', n: '03', label: 'compiler generates this'},
];

const ARIA: Record<Phase, string> = {
  tangle:
    'Hand-written today: ShopPresenter, InventoryMgr, QuestSystem, a Dictionary of items, an OnChanged event bus, LeaderboardUI and SaveManager, all wired to each other.',
  schema: 'You write this: one game.conjure file describing state, screens and rules.',
  generated:
    'The compiler generates this: storage with indexes, self-updating screens, frame systems, save and load, and plain C# with zero allocations per frame.',
};

const SCRIPTS = [
  'ShopPresenter',
  'InventoryMgr',
  'QuestSystem',
  'Dictionary<Item>',
  'OnChanged bus',
  'LeaderboardUI',
  'SaveManager',
];
const BUS = 4; // index of the event bus — drawn as a pill

// Accretion, not architecture: every pair of the 7 scripts is wired, two
// pairs twice over, at uneven weights. `signal` wires carry event traffic.
const WIRES: {a: number; b: number; bend: number; w: number; signal?: boolean}[] = [
  {a: 0, b: 1, bend: 40, w: 0.9},
  {a: 0, b: 2, bend: -110, w: 0.6},
  {a: 0, b: 3, bend: -30, w: 1.2},
  {a: 0, b: 4, bend: 50, w: 0.8, signal: true},
  {a: 0, b: 4, bend: -25, w: 0.6},
  {a: 0, b: 5, bend: -60, w: 1.1},
  {a: 0, b: 6, bend: 90, w: 0.7},
  {a: 1, b: 2, bend: -35, w: 1.0},
  {a: 1, b: 3, bend: 45, w: 0.8, signal: true},
  {a: 1, b: 4, bend: -70, w: 1.2},
  {a: 1, b: 5, bend: 120, w: 0.6, signal: true},
  {a: 1, b: 6, bend: 60, w: 0.9},
  {a: 2, b: 3, bend: -50, w: 0.7},
  {a: 2, b: 4, bend: 35, w: 1.0, signal: true},
  {a: 2, b: 5, bend: 80, w: 0.6},
  {a: 2, b: 6, bend: -45, w: 1.1},
  {a: 3, b: 4, bend: 30, w: 0.9},
  {a: 3, b: 5, bend: -40, w: 0.7, signal: true},
  {a: 3, b: 5, bend: 65, w: 1.2},
  {a: 3, b: 6, bend: 85, w: 0.6},
  {a: 4, b: 5, bend: 55, w: 0.8, signal: true},
  {a: 4, b: 6, bend: -30, w: 1.0},
];

const MODULES = [
  {title: 'Storage + indexes', sub: 'O(1) lookups'},
  {title: 'Self-updating screens', sub: 'shop · inventory · ranks'},
  {title: 'Frame systems', sub: 'scheduled per phase'},
  {title: 'Save / load', sub: 'local persistence'},
  {title: 'Plain C#', sub: '0 alloc / frame'},
];

const CARD_LINES: ReactNode[] = [
  <><tspan className={styles.kw}>table</tspan> Item {'{ … }'}</>,
  <><tspan className={styles.kw}>reactive query</tspan> ShopOffers</>,
  <><tspan className={styles.kw}>command</tspan> BuyItem(…)</>,
  <><tspan className={styles.kw}>system</tspan> Move(phase: …)</>,
];

type Pt = [number, number];
type Layout = {
  w: number;
  h: number;
  font: number;
  script: {w: number; h: number};
  scripts: {at: Pt; rot: number}[];
  card: {cx: number; cy: number; w: number; h: number; line: number};
  module: {w: number; h: number};
  modules: Pt[];
};

const WIDE: Layout = {
  w: 760,
  h: 440,
  font: 15,
  script: {w: 168, h: 36},
  scripts: [
    {at: [140, 72], rot: -4},
    {at: [560, 60], rot: 3},
    {at: [652, 206], rot: -3},
    {at: [318, 168], rot: 2},
    {at: [470, 284], rot: -2},
    {at: [128, 300], rot: 4},
    {at: [600, 380], rot: -5},
  ],
  card: {cx: 380, cy: 210, w: 236, h: 176, line: 21},
  module: {w: 212, h: 58},
  modules: [
    [118, 128],
    [642, 128],
    [118, 300],
    [642, 300],
    [380, 398],
  ],
};

const NARROW: Layout = {
  w: 360,
  h: 460,
  font: 12.5,
  script: {w: 140, h: 32},
  scripts: [
    {at: [86, 48], rot: -4},
    {at: [262, 84], rot: 3},
    {at: [140, 160], rot: 2},
    {at: [278, 222], rot: -3},
    {at: [92, 260], rot: -2},
    {at: [232, 336], rot: 4},
    {at: [98, 410], rot: -4},
  ],
  card: {cx: 180, cy: 222, w: 204, h: 160, line: 19},
  module: {w: 166, h: 52},
  modules: [
    [91, 52],
    [269, 52],
    [91, 360],
    [269, 360],
    [180, 426],
  ],
};

function wirePath(p: Pt, q: Pt, bend: number): string {
  const [x1, y1] = p;
  const [x2, y2] = q;
  const len = Math.hypot(x2 - x1, y2 - y1) || 1;
  // Control point pushed off the midpoint, perpendicular to the wire.
  const cx = (x1 + x2) / 2 + (-(y2 - y1) / len) * bend;
  const cy = (y1 + y2) / 2 + ((x2 - x1) / len) * bend;
  return `M${x1} ${y1} Q${cx.toFixed(1)} ${cy.toFixed(1)} ${x2} ${y2}`;
}

function Scene({layout, phase, className}: {layout: Layout; phase: Phase; className: string}) {
  const glowId = `${useId().replace(/:/g, '')}glow`;
  const {card} = layout;
  const origin = `${card.cx}px ${card.cy}px`;
  const cardTop = card.cy - card.h / 2;
  const cardLeft = card.cx - card.w / 2;

  return (
    <svg
      className={className}
      viewBox={`0 0 ${layout.w} ${layout.h}`}
      role="img"
      aria-label={ARIA[phase]}
      style={{fontSize: layout.font}}>
      <defs>
        <radialGradient id={glowId}>
          <stop offset="0%" stopColor="var(--ifm-color-primary)" stopOpacity="0.28" />
          <stop offset="100%" stopColor="var(--ifm-color-primary)" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Act 1 — the tangle. The whole group collapses into the card's centre. */}
      <g className={styles.tangleGroup} style={{transformOrigin: origin}}>
        <g className={styles.drift}>
          {WIRES.map((wr, i) => (
            <path
              key={i}
              className={clsx(styles.wire, wr.signal && styles.signal)}
              d={wirePath(layout.scripts[wr.a].at, layout.scripts[wr.b].at, wr.bend)}
              style={{strokeWidth: wr.w, animationDelay: `${(i % 5) * -0.37}s`}}
            />
          ))}
          {SCRIPTS.map((name, i) => {
            const {at, rot} = layout.scripts[i];
            const {w, h} = layout.script;
            return (
              <g key={name} transform={`translate(${at[0]} ${at[1]}) rotate(${rot})`}>
                <g
                  className={styles.breathe}
                  style={{animationDelay: `${i * -0.9}s`, animationDuration: `${4.6 + (i % 3) * 0.8}s`}}>
                  <rect
                    className={styles.script}
                    x={-w / 2}
                    y={-h / 2}
                    width={w}
                    height={h}
                    rx={i === BUS ? h / 2 : 6}
                  />
                  <text className={styles.scriptLabel} textAnchor="middle" dominantBaseline="central">
                    {name}
                  </text>
                </g>
              </g>
            );
          })}
        </g>
      </g>

      {/* Act 3 — rays and generated modules, drawn under the card. */}
      <g className={styles.output}>
        {layout.modules.map(([mx, my], i) => {
          const d = `M${card.cx} ${card.cy} L${mx} ${my}`;
          const delay = {'--d': `${0.12 * i}s`} as CSSProperties;
          return (
            <g key={i} style={delay}>
              <path className={styles.ray} d={d} pathLength={1} />
              <path className={styles.flow} d={d} />
            </g>
          );
        })}
        {layout.modules.map(([mx, my], i) => {
          const {w, h} = layout.module;
          const style = {
            '--d': `${0.25 + 0.12 * i}s`,
            '--dx': `${card.cx - mx}px`,
            '--dy': `${card.cy - my}px`,
          } as CSSProperties;
          return (
            <g key={MODULES[i].title} transform={`translate(${mx} ${my})`}>
              <g className={styles.module} style={style}>
                <rect className={styles.moduleBase} x={-w / 2} y={-h / 2} width={w} height={h} rx={9} />
                <rect className={styles.moduleTint} x={-w / 2} y={-h / 2} width={w} height={h} rx={9} />
                <text className={styles.moduleTitle} textAnchor="middle" y={-h * 0.11}>
                  {MODULES[i].title}
                </text>
                <text className={styles.moduleSub} textAnchor="middle" y={h * 0.29}>
                  {MODULES[i].sub}
                </text>
              </g>
            </g>
          );
        })}
      </g>

      {/* Act 2 — the one file you write. */}
      <g className={styles.card} style={{transformOrigin: origin}}>
        <circle className={styles.glow} cx={card.cx} cy={card.cy} r={card.w * 0.85} fill={`url(#${glowId})`} />
        <rect className={styles.cardBox} x={cardLeft} y={cardTop} width={card.w} height={card.h} rx={12} />
        <text className={styles.cardName} x={cardLeft + 16} y={cardTop + 26}>
          game.conjure
        </text>
        <line
          className={styles.cardRule}
          x1={cardLeft}
          x2={cardLeft + card.w}
          y1={cardTop + 40}
          y2={cardTop + 40}
        />
        {CARD_LINES.map((line, i) => (
          <text key={i} className={styles.cardLine} x={cardLeft + 16} y={cardTop + 60 + i * card.line}>
            {line}
          </text>
        ))}
        <line
          className={styles.cardRule}
          x1={cardLeft}
          x2={cardLeft + card.w}
          y1={cardTop + card.h - 32}
          y2={cardTop + card.h - 32}
        />
        <text className={styles.cardCaption} x={card.cx} y={cardTop + card.h - 12} textAnchor="middle">
          state · screens · rules
        </text>
      </g>
    </svg>
  );
}

export default function TangleToSchema(): ReactNode {
  const [phase, setPhase] = useState<Phase>('tangle');
  const [auto, setAuto] = useState(true);
  const [visible, setVisible] = useState(true);
  const rootRef = useRef<HTMLDivElement>(null);

  // Reduced motion: show the finished picture, no cycling.
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => {
      if (mq.matches) {
        setAuto(false);
        setPhase('generated');
      }
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  // Don't cycle while scrolled out of view.
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), {threshold: 0.2});
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
    <div ref={rootRef} className={clsx(styles.root, PHASE_CLASS[phase])}>
      <div className={styles.stage}>
        <Scene layout={WIDE} phase={phase} className={styles.wide} />
        <Scene layout={NARROW} phase={phase} className={styles.narrow} />
      </div>
      <div className={styles.steps} role="group" aria-label="Show stage">
        {STEPS.map((s) => {
          const active = s.phase === phase;
          return (
            <button
              key={s.phase}
              type="button"
              aria-pressed={active}
              className={clsx(styles.step, active && styles.stepActive, s.phase === 'tangle' && styles.stepWire)}
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

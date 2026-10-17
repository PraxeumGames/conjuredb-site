import {useEffect, useId, useRef, useState, type CSSProperties, type ReactNode} from 'react';
import clsx from 'clsx';
import Steps from '@site/src/components/Steps';
import {DemoHeader, DemoNarration} from '@site/src/components/DemoStage';
import styles from './styles.module.css';

// Hero visual: today's two hand-wired programs (client + server, muted
// red-grey) collapse into one game.conjure file (gold), which then compiles
// into both sides — client (gold), server (steel blue) — with the replayed
// action stream between them. Pure SVG + CSS; React only flips the phase class.

type Phase = 'tangle' | 'schema' | 'generated';
const PHASES: Phase[] = ['tangle', 'schema', 'generated'];

// Time on each phase in auto-play: its transition plus a ~2.5 s hold.
// Phase 03 holds longer so the action stream gets a few full passes.
const HOLD_MS: Record<Phase, number> = {tangle: 5000, schema: 7000, generated: 7000};

const PHASE_CLASS: Record<Phase, string | undefined> = {
  tangle: undefined,
  schema: styles.isSchema,
  generated: styles.isGenerated,
};

const NARRATION: Record<Phase, string> = {
  tangle: 'Today a game is two programs — the client and the server — wired to each other by hand, and every feature is written twice.',
  schema: 'With Conjure you write one file: the state, the commands and the questions your UI views ask.',
  generated: 'The compiler builds both sides from it — the client and the server-side logic — and the server replays what the client did.',
};

const STEPS: {key: Phase; n: string; label: string; alt?: boolean; live?: string}[] = [
  {key: 'tangle', n: '01', label: 'two programs today', alt: true},
  {key: 'schema', n: '02', label: 'you write this'},
  {
    key: 'generated',
    n: '03',
    label: 'builds both sides',
    live: 'builds both sides — the compiler emits the client and the server-side logic; the backend and liveops runtime host it',
  },
]

const ARIA: Record<Phase, string> = {
  tangle:
    'Two programs today: client scripts (ShopPresenter, InventoryMgr, QuestSystem, an OnChanged bus) and server code (PlayerController API, DTOs and protocol, save migrations, an admin panel, an analytics SDK), wired to each other across the network.',
  schema:
    'You write this: one game.conjure file with a Shop module (an Offer table, a Buy command and an Offers reactive query) and a BattlePass module.',
  generated:
    'Builds both sides: the compiler emits the client and the server-side logic; the backend and liveops runtime host it. Shown: the client (UI views, frame, local state), the server (player, config, shared state), a replay verifier, liveops and modules. Player commands stream from client to server and are verified by replay.',
};

// Indices 0–3 are client scripts, 4–8 server code.
const SCRIPTS = [
  'ShopPresenter',
  'InventoryMgr',
  'QuestSystem',
  'OnChanged bus',
  'PlayerController API',
  'DTOs + protocol',
  'Save migrations',
  'Admin panel',
  'Analytics SDK',
];
const BUS = 3; // the event bus is drawn as a pill

// Accretion, not architecture: wiring inside each program, one doubled pair,
// uneven weights, and seven wires across the network. `signal` = live traffic.
const WIRES: {a: number; b: number; bend: number; w: number; signal?: boolean}[] = [
  // client
  {a: 0, b: 1, bend: 30, w: 0.9},
  {a: 0, b: 2, bend: -40, w: 1.1},
  {a: 0, b: 3, bend: 45, w: 0.7, signal: true},
  {a: 0, b: 3, bend: -30, w: 0.6},
  {a: 1, b: 2, bend: 35, w: 0.8},
  {a: 1, b: 3, bend: -25, w: 1.2},
  {a: 2, b: 3, bend: 30, w: 0.7},
  // server
  {a: 4, b: 5, bend: -30, w: 1.0},
  {a: 4, b: 6, bend: 40, w: 0.7},
  {a: 5, b: 6, bend: -35, w: 0.9, signal: true},
  {a: 5, b: 7, bend: 30, w: 0.6},
  {a: 4, b: 8, bend: -60, w: 1.1},
  {a: 6, b: 8, bend: 25, w: 0.8},
  {a: 7, b: 8, bend: -30, w: 1.2},
  {a: 5, b: 8, bend: 45, w: 0.6},
  // across the network
  {a: 0, b: 4, bend: -35, w: 0.9, signal: true},
  {a: 1, b: 5, bend: 40, w: 0.7, signal: true},
  {a: 2, b: 6, bend: -30, w: 1.1},
  {a: 3, b: 4, bend: 55, w: 0.6},
  {a: 3, b: 7, bend: -40, w: 1.0, signal: true},
  {a: 1, b: 8, bend: 50, w: 0.8, signal: true},
  {a: 2, b: 5, bend: -45, w: 0.6},
];

type Tone = 'client' | 'server' | 'gold';
const OUTPUTS: {title: string; sub: string; tone: Tone; small?: boolean}[] = [
  {title: 'Client', sub: 'UI views · frame · local state', tone: 'client'},
  {title: 'Server', sub: 'player · config · shared state', tone: 'server'},
  {title: 'Replay verifier', sub: 'actions in, verdict out', tone: 'gold'},
  {title: 'Liveops', sub: 'rules without a release', tone: 'gold', small: true},
  {title: 'Modules', sub: 'battle pass · store · inventory', tone: 'gold', small: true},
];

// `indent` is in characters (mono), so a module body can sit inside its braces.
const CARD_LINES: {indent: number; line: ReactNode}[] = [
  {indent: 0, line: <><tspan className={styles.kw}>module</tspan> Shop {'{'}</>},
  {indent: 2, line: <><tspan className={styles.kw}>table</tspan> Offer {'{ … }'}</>},
  {indent: 2, line: <><tspan className={styles.kw}>command</tspan> Buy(…)</>},
  {indent: 2, line: <><tspan className={styles.kw}>reactive query</tspan> Offers</>},
  {indent: 0, line: <>{'}'}</>},
  {indent: 0, line: <><tspan className={styles.kw}>module</tspan> BattlePass {'{ … }'}</>},
];

const MARKERS = 4; // actions in flight on the client → server stream

type Pt = [number, number];
type Layout = {
  w: number;
  h: number;
  font: number;
  scriptH: number;
  scripts: {at: Pt; rot: number; w: number}[];
  // The network boundary between the two halves of the tangle.
  network: {d: string; label: Pt; client: Pt; server: Pt; vertical: boolean};
  card: {cx: number; cy: number; w: number; h: number; line: number};
  outputs: {at: Pt; w: number; h: number; sub?: string[]}[];
  // Stream path, where the markers start, and how far they travel.
  stream: {d: string; start: Pt; travel: Pt; check: Pt; label?: Pt};
};

const WIDE: Layout = {
  w: 760,
  h: 420,
  font: 15,
  scriptH: 36,
  scripts: [
    {at: [108, 78], rot: -4, w: 166},
    {at: [262, 158], rot: 3, w: 160},
    {at: [100, 246], rot: 2, w: 156},
    {at: [250, 336], rot: -3, w: 160},
    {at: [540, 62], rot: 3, w: 200},
    {at: [642, 150], rot: -3, w: 176},
    {at: [512, 236], rot: 2, w: 176},
    {at: [652, 316], rot: -4, w: 140},
    {at: [522, 384], rot: 3, w: 160},
  ],
  network: {d: 'M380 30 V410', label: [380, 20], client: [16, 20], server: [744, 20], vertical: true},
  card: {cx: 380, cy: 192, w: 264, h: 222, line: 22},
  // Text in the drawing is ≥ 1em (≈ 11px at 1280 wide), so outputs carry two-line subtitles.
  outputs: [
    {at: [118, 192], w: 200, h: 84, sub: ['UI views · frame', 'local state']},
    {at: [642, 192], w: 200, h: 84, sub: ['player · config', 'shared state']},
    {at: [380, 358], w: 240, h: 62},
    {at: [118, 366], w: 200, h: 72, sub: ['rules without', 'a release']},
    {at: [642, 366], w: 200, h: 72, sub: ['battle pass ·', 'store · inventory']},
  ],
  stream: {d: 'M118 150 V58 H642 V150', start: [128, 58], travel: [504, 0], check: [0, -13], label: [380, 44]},
};

const NARROW: Layout = {
  w: 360,
  h: 580,
  font: 13,
  scriptH: 32,
  scripts: [
    {at: [92, 44], rot: -4, w: 140},
    {at: [262, 100], rot: 3, w: 134},
    {at: [104, 172], rot: 2, w: 132},
    {at: [252, 240], rot: -3, w: 134},
    {at: [150, 330], rot: 3, w: 172},
    {at: [268, 400], rot: -3, w: 150},
    {at: [96, 450], rot: 2, w: 150},
    {at: [262, 506], rot: -4, w: 120},
    {at: [118, 548], rot: 3, w: 134},
  ],
  network: {d: 'M10 287 H350', label: [350, 279], client: [10, 12], server: [10, 302], vertical: false},
  card: {cx: 190, cy: 214, w: 236, h: 208, line: 20},
  outputs: [
    {at: [190, 52], w: 236, h: 70, sub: ['UI views · frame', 'local state']},
    {at: [190, 368], w: 236, h: 70, sub: ['player · config', 'shared state']},
    {at: [190, 446], w: 236, h: 52},
    {at: [100, 530], w: 168, h: 70, sub: ['rules without', 'a release']},
    {at: [280, 530], w: 168, h: 70, sub: ['battle pass ·', 'store · inventory']},
  ],
  stream: {d: 'M72 52 H26 V368 H72', start: [26, 62], travel: [0, 296], check: [13, 4]},
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
  const {card, network, stream} = layout;
  const origin = `${card.cx}px ${card.cy}px`;
  const cardTop = card.cy - card.h / 2;
  const cardLeft = card.cx - card.w / 2;
  const lh = layout.font * 1.05;

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

      {/* Act 1 — two programs and the glue. The whole group collapses into the card. */}
      <g className={styles.tangleGroup} style={{transformOrigin: origin}}>
        <g className={styles.drift}>
          <path className={styles.network} d={network.d} />
          <text
            className={styles.networkLabel}
            x={network.label[0]}
            y={network.label[1]}
            textAnchor={network.vertical ? 'middle' : 'end'}>
            network
          </text>
          <text className={styles.halfLabel} x={network.client[0]} y={network.client[1]}>
            client
          </text>
          <text
            className={styles.halfLabel}
            x={network.server[0]}
            y={network.server[1]}
            textAnchor={network.vertical ? 'end' : 'start'}>
            server
          </text>
          {WIRES.map((wr, i) => (
            <path
              key={i}
              className={clsx(styles.wire, wr.signal && styles.signal)}
              d={wirePath(layout.scripts[wr.a].at, layout.scripts[wr.b].at, wr.bend)}
              style={{strokeWidth: wr.w, animationDelay: `${(i % 5) * -0.37}s`}}
            />
          ))}
          {SCRIPTS.map((name, i) => {
            const {at, rot, w} = layout.scripts[i];
            const h = layout.scriptH;
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

      {/* Act 3 — rays, the action stream and both sides, drawn under the card. */}
      <g className={styles.output}>
        {layout.outputs.map(({at: [mx, my]}, i) => {
          const d = `M${card.cx} ${card.cy} L${mx} ${my}`;
          const delay = {'--d': `${0.12 * i}s`} as CSSProperties;
          return (
            <g key={i} style={delay} className={clsx(OUTPUTS[i].tone === 'server' && styles.tServer)}>
              <path className={styles.ray} d={d} pathLength={1} />
              <path className={styles.flow} d={d} />
            </g>
          );
        })}

        <g className={styles.stream}>
          <path className={styles.streamLine} d={stream.d} />
          {stream.label && (
            <text className={styles.streamLabel} x={stream.label[0]} y={stream.label[1]} textAnchor="middle">
              actions → replayed on the server
            </text>
          )}
          {Array.from({length: MARKERS}, (_, i) => {
            const style = {
              '--mx': `${stream.travel[0]}px`,
              '--my': `${stream.travel[1]}px`,
              '--p': `${(i + 0.6) / MARKERS}`,
              animationDelay: `${(-i * 4.4) / MARKERS}s`,
            } as CSSProperties;
            return (
              <g key={i} transform={`translate(${stream.start[0]} ${stream.start[1]})`}>
                <g className={clsx(styles.marker, i === MARKERS - 1 && styles.markerDone)} style={style}>
                  <rect className={styles.markerBox} x={-4.5} y={-4.5} width={9} height={9} rx={2} />
                  <path
                    className={styles.check}
                    style={{animationDelay: style.animationDelay}}
                    d={`M${stream.check[0] - 4} ${stream.check[1]} l3 3 l5.5 -6`}
                  />
                </g>
              </g>
            );
          })}
        </g>

        {layout.outputs.map(({at: [mx, my], w, h, sub}, i) => {
          const out = OUTPUTS[i];
          const lines = sub ?? [out.sub];
          const titleY = (-lines.length * lh) / 2 + 3;
          const style = {
            '--d': `${0.25 + 0.12 * i}s`,
            '--dx': `${card.cx - mx}px`,
            '--dy': `${card.cy - my}px`,
          } as CSSProperties;
          return (
            <g key={out.title} transform={`translate(${mx} ${my})`}>
              <g
                className={clsx(
                  styles.module,
                  out.tone === 'server' && styles.tServer,
                  out.tone === 'client' && styles.tClient,
                  out.small && styles.small,
                )}
                style={style}>
                <rect className={styles.moduleBase} x={-w / 2} y={-h / 2} width={w} height={h} rx={9} />
                <rect className={styles.moduleTint} x={-w / 2} y={-h / 2} width={w} height={h} rx={9} />
                <text className={styles.moduleTitle} textAnchor="middle" y={titleY}>
                  {out.title}
                </text>
                {lines.map((line, j) => (
                  <text key={j} className={styles.moduleSub} textAnchor="middle" y={titleY + lh * (j + 1) + 2}>
                    {line}
                  </text>
                ))}
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
        {CARD_LINES.map(({indent, line}, i) => (
          <text
            key={i}
            className={styles.cardLine}
            x={cardLeft + 16 + indent * layout.font * 0.6}
            y={cardTop + 60 + i * card.line}>
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
          state · UI views · rules
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
  const replay = () => {
    setPhase('tangle');
    setAuto(!window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  };

  return (
    <div ref={rootRef} className={clsx(styles.root, PHASE_CLASS[phase])}>
      <DemoHeader title="two programs, one schema" onReplay={replay} seen={visible} />
      <div className={styles.stage}>
        <Scene layout={WIDE} phase={phase} className={styles.wide} />
        <Scene layout={NARROW} phase={phase} className={styles.narrow} />
      </div>
      <Steps
        steps={STEPS}
        active={phase}
        onPick={pick}
        timerMs={auto && visible ? HOLD_MS[phase] : undefined}
        label="Show stage"
        columns={3}
        silent
      />
      <DemoNarration>{NARRATION[phase]}</DemoNarration>
    </div>
  );
}

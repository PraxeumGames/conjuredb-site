import {useEffect, useRef, useState, type CSSProperties, type ReactNode} from 'react';
import clsx from 'clsx';
import {CodeWindow, F, K, T, type CodeTab} from '@site/src/components/CodeWindow';
import {DEVICE_STATUS_H, DeviceFrame, ServerFrame} from '@site/src/components/Glyphs';
import StatusBadge from '@site/src/components/StatusBadge';
import styles from './styles.module.css';

// "A feature is a schema, not a sprint": one module declared, compiled into a
// screen, a server command and liveops knobs, then carried to another project.
// Plays once (~4.5 s) when scrolled into view; every step is a CSS animation
// delay (--t), restarted by remounting the stage.

/** Delay helper: the step lands `t` seconds into the run. */
const at = (t: number) => ({'--t': `${t}s`}) as CSSProperties;

const LINES: ReactNode[] = [
  <><K>module</K> <T>BattlePass</T> {'{'}</>,
  <>    <K>table</K> <T>Tier</T> {'{ … }'}</>,
  <>    <K>table</K> <T>Progress</T> {'{ … }'}</>,
  <>    <K>command</K> <F>ClaimTier</F>(…)</>,
  <>    <K>reactive query</K> <F>Track</F>(…)</>,
  <>{'}'}</>,
];
const TYPE = (i: number) => 0.15 + i * 0.18;
const MODULE_TABS: CodeTab[] = [
  {
    name: 'battlepass.conjure',
    lang: '',
    lines: LINES.map((l, i) => (
      <span key={i} className={styles.typed} style={at(TYPE(i))}>
        {l}
      </span>
    )),
  },
];

const T_ARROW1 = 1.4;
const T_DEVICE = 1.6;
const T_SERVER = 2.1;
const T_LIVEOPS = 2.6;
const T_ARROW2 = 3.0;
const T_COPY = 3.05;
const T_OVERRIDE = 3.5;
const T_STRIP = [3.9, 4.2, 4.5];

function Check({t}: {t: number}) {
  return (
    <svg className={clsx(styles.a, styles.check)} style={at(t)} viewBox="0 0 16 16" aria-hidden="true">
      <circle cx={8} cy={8} r={7} />
      <path d="M4.6 8.2 l2.3 2.3 l4.5 -4.8" />
    </svg>
  );
}

function Arrow({t}: {t: number}) {
  return (
    <div className={clsx(styles.arrow, styles.a)} style={at(t)} aria-hidden="true">
      <svg viewBox="0 0 40 12">
        <path d="M2 6 H36 M31 1.5 L36.5 6 L31 10.5" />
      </svg>
    </div>
  );
}

/** The battle-pass screen: five tier chips, a progress bar, a claim button. */
function PassScreen() {
  const w = 120;
  const h = 200;
  const chip = 16;
  const gap = 4;
  const x0 = (w - 5 * chip - 4 * gap) / 2;
  return (
    <svg className={styles.device} viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Battle pass screen: tiers 1 to 3 of 5 reached, progress 62 percent, a Claim button." style={{fontSize: 12}}>
      <DeviceFrame x={0} y={0} width={w} height={h}>
        <text className={styles.screenTitle} x={x0} y={DEVICE_STATUS_H + 18}>
          Battle pass
        </text>
        {[1, 2, 3, 4, 5].map((n, i) => (
          <g key={n} transform={`translate(${x0 + i * (chip + gap)} ${DEVICE_STATUS_H + 32})`}>
            <rect className={n <= 3 ? styles.tierOn : styles.tierOff} width={chip} height={chip} rx={4} />
            <text className={n <= 3 ? styles.tierNumOn : styles.tierNum} x={chip / 2} y={chip / 2} textAnchor="middle" dominantBaseline="central">
              {n}
            </text>
          </g>
        ))}
        <rect className={styles.barTrack} x={x0} y={DEVICE_STATUS_H + 64} width={w - 2 * x0} height={6} rx={3} />
        <rect className={styles.barFill} x={x0} y={DEVICE_STATUS_H + 64} width={(w - 2 * x0) * 0.62} height={6} rx={3} />
        <text className={styles.barText} x={w - x0} y={DEVICE_STATUS_H + 86} textAnchor="end">
          62 %
        </text>
        <rect className={styles.claim} x={x0} y={h - 44} width={w - 2 * x0} height={24} rx={6} />
        <text className={styles.claimText} x={w / 2} y={h - 32} textAnchor="middle" dominantBaseline="central">
          Claim
        </text>
      </DeviceFrame>
    </svg>
  );
}

function Stage(): ReactNode {
  return (
    <>
      <div className={styles.cols}>
        {/* The copy travels from the declaration to Project B, over the top. */}
        <svg className={clsx(styles.copyPath, styles.a)} style={at(T_COPY)} viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true">
          <path d="M14 10 C 30 -6, 70 -6, 86 10" />
        </svg>

        <div className={styles.col}>
          <span className={styles.colLabel}>declare</span>
          <div className={styles.module}>
            <CodeWindow tabs={MODULE_TABS} dense />
          </div>
          <p className={styles.mono}>one file · one owner · both sides</p>
        </div>

        <Arrow t={T_ARROW1} />

        <div className={styles.col}>
          <span className={styles.colLabel}>compiled</span>
          <div className={styles.outputs}>
            <figure className={clsx(styles.out, styles.outDevice, styles.a)} style={at(T_DEVICE)}>
              <PassScreen />
              <figcaption className={styles.mono}>
                screen binds Track <Check t={T_DEVICE + 0.3} />
              </figcaption>
            </figure>
            <div className={styles.outStack}>
              <figure className={clsx(styles.out, styles.a)} style={at(T_SERVER)}>
                <svg className={styles.server} viewBox="0 0 200 80" role="img" aria-label="Server, player grain: ClaimTier replayed and verified." style={{fontSize: 13}}>
                  <ServerFrame x={0.5} y={0.5} width={199} height={79} title="Server · player grain">
                    <text className={styles.serverLine} x={16} y={50}>
                      ClaimTier ·
                    </text>
                    <text className={styles.serverLine} x={16} y={67}>
                      replayed and verified
                    </text>
                  </ServerFrame>
                </svg>
                <figcaption className={styles.meta}>
                  <StatusBadge status="prototype" />
                  <Check t={T_SERVER + 0.3} />
                </figcaption>
              </figure>
              <figure className={clsx(styles.out, styles.a)} style={at(T_LIVEOPS)}>
                <div className={styles.liveops}>
                  <span className={styles.liveopsTitle}>liveops</span>
                  <ul className={styles.knobs}>
                    {['season length', 'tier xp', 'rewards'].map((k) => (
                      <li key={k}>
                        <span className={styles.knob} aria-hidden="true" />
                        {k}
                      </li>
                    ))}
                  </ul>
                </div>
                <figcaption className={styles.meta}>
                  <span className={styles.mono}>tunable after release</span>
                  <StatusBadge status="prototype" />
                  <Check t={T_LIVEOPS + 0.3} />
                </figcaption>
              </figure>
            </div>
          </div>
        </div>

        <Arrow t={T_ARROW2} />

        <div className={styles.col}>
          <span className={styles.colLabel}>reused</span>
          <div className={styles.projectB}>
            <span className={styles.projectTitle}>Project B</span>
            <pre className={clsx(styles.miniModule, styles.a, styles.slideIn)} style={at(T_COPY + 0.15)}>
              <span className={styles.kw}>module</span> BattlePass {'{'}
              {'\n'}    <span className={styles.kw}>table</span> Tier {'{ … }'}
              {'\n'}    <span className={styles.kw}>table</span> Progress {'{ … }'}
              {'\n'}    <span className={styles.kw}>command</span> ClaimTier(…)
              {'\n'}    <span className={styles.kw}>reactive query</span> Track(…)
              {'\n'}{'}'}
            </pre>
            {/* No override syntax is documented yet: a labelled box, not code. */}
            <div className={clsx(styles.override, styles.a)} style={at(T_OVERRIDE)}>
              <span className={styles.overrideTitle}>overrides</span>
              <span>tiers 5 → 10</span>
              <span>rewards: Project B table</span>
            </div>
          </div>
          <p className={styles.mono}>same module · screen re-skinned · 0 lines of logic rewritten</p>
        </div>
      </div>

      <div className={styles.strip}>
        <span className={clsx(styles.chip, styles.prompt, styles.a)} style={at(T_STRIP[0])}>
          assistant: add a weekly reset to the battle pass
        </span>
        <span className={clsx(styles.stripArrow, styles.a)} style={at(T_STRIP[1] - 0.1)} aria-hidden="true">
          <span className={styles.stripGlyph}>→</span>
        </span>
        <span className={clsx(styles.chip, styles.diff, styles.a)} style={at(T_STRIP[1])}>
          +4 lines · module BattlePass
        </span>
        <span className={clsx(styles.stripArrow, styles.a)} style={at(T_STRIP[2] - 0.1)} aria-hidden="true">
          <span className={styles.stripGlyph}>→</span>
        </span>
        <span className={clsx(styles.chip, styles.verdict, styles.a)} style={at(T_STRIP[2])}>
          compiler: ok · 0 diagnostics
        </span>
      </div>
      <p className={styles.caption}>
        Small, typed, closed: the compiler rejects what is wrong, so a draft from an assistant is
        safe to try.
      </p>
    </>
  );
}

export default function FeatureSlice(): ReactNode {
  // idle: final state (SSR, reduced motion) · armed: hidden until in view · play: running
  const [state, setState] = useState<'idle' | 'armed' | 'play'>('idle');
  const [run, setRun] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const el = rootRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    setState('armed');
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting) return;
        io.disconnect();
        setState('play');
      },
      {threshold: 0.3},
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const replay = () => {
    setState('play');
    setRun((r) => r + 1);
  };

  return (
    <div ref={rootRef} className={clsx(styles.root, state === 'armed' && styles.armed, state === 'play' && styles.play)}>
      <button type="button" className={styles.replay} onClick={replay} disabled={state === 'armed'}>
        replay ↺
      </button>
      <Stage key={run} />
    </div>
  );
}

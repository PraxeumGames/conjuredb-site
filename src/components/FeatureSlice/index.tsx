import type {CSSProperties, ReactNode} from 'react';
import clsx from 'clsx';
import Link from '@docusaurus/Link';
import {CodeWindow, F, K, T, V, type CodeTab} from '@site/src/components/CodeWindow';
import DemoStage, {CompilerNotes, type DemoStep} from '@site/src/components/DemoStage';
import {DEVICE_STATUS_H, DeviceFrame, ServerFrame} from '@site/src/components/Glyphs';
import StatusBadge from '@site/src/components/StatusBadge';
import styles from './styles.module.css';

// "A feature is a schema, not a sprint", in the DemoStage shell: one module
// declared, compiled into a UI view, a server command and liveops knobs,
// carried to another project, then extended by an assistant's draft. Steps
// reveal the columns cumulatively — what an earlier step revealed stays at
// full brightness; step 04 highlights the assistant strip. Every delay (--t)
// is relative to the step's start.

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

const T_ARROW1 = 0;
const T_DEVICE = 0.15;
const T_SERVER = 0.65;
const T_LIVEOPS = 1.15;
const T_ARROW2 = 0;
const T_COPY = 0.05;
const T_COMPILE = 0.6;
const T_STRIP = [0.15, 0.55, 0.95];

const PLAIN_TABS: CodeTab[] = [{name: 'battlepass.conjure', lang: 'schema', lines: LINES}];
const VIEW_TABS: CodeTab[] = [
  {
    name: 'BattlePassView.cs',
    lang: 'C#',
    lines: [
      <><K>var</K> track = context.<F>Track</F>(playerId: player.Id);</>,
      <>passView.<F>Bind</F>(track.<V>Current</V>);</>,
      <>track.<F>SubscribeChanged</F>(changes =&gt; passView.<F>Apply</F>(changes));</>,
    ],
  },
];
const COMPILER = [
  'UI view model: Track, maintained by delta',
  'server command: ClaimTier, replayed and verified',
  'liveops knobs: season length · tier xp · rewards',
];

const STEPS: DemoStep[] = [
  {
    id: 'declare',
    label: 'declare',
    holdMs: 7000,
    narration: 'One file declares the feature: its tables, the one command that changes them, and the reactive query the UI view binds.',
  },
  {
    id: 'compiled',
    label: 'compiled',
    holdMs: 7000,
    narration:
      'From that file the compiler produces the view model the UI view binds, the server side of the command, and the knobs liveops can turn after release.',
  },
  {
    id: 'adapted',
    label: 'adapted',
    holdMs: 7000,
    narration:
      'Project B stores rewards as cards and prices in gems. Two declarations change; the compiler re-checks every join and regenerates the view model and the server command. The logic is untouched.',
  },
  {
    id: 'assistant',
    label: 'an assistant drafts',
    holdMs: 7000,
    narration: (
      <>
        Small, typed, closed: the compiler rejects what is wrong, so a draft from an assistant is safe to try.{' '}
        <Link to="/how-it-works#declarative">why declarative →</Link>
      </>
    ),
  },
];

function Check({t}: {t: number}) {
  return (
    <svg className={clsx(styles.a, styles.check)} style={at(t)} viewBox="0 0 16 16" aria-hidden="true">
      <circle cx={8} cy={8} r={7} />
      <path d="M4.6 8.2 l2.3 2.3 l4.5 -4.8" />
    </svg>
  );
}

function Arrow({t, cls}: {t: number; cls: string | false}) {
  return (
    <div className={clsx(styles.arrow, styles.a, cls)} style={at(t)} aria-hidden="true">
      <svg viewBox="0 0 40 12">
        <path d="M2 6 H36 M31 1.5 L36.5 6 L31 10.5" />
      </svg>
    </div>
  );
}

/** The battle-pass UI view: five tier chips, a progress bar, a claim button. */
function PassScreen() {
  const w = 120;
  const h = 200;
  const chip = 16;
  const gap = 4;
  const x0 = (w - 5 * chip - 4 * gap) / 2;
  return (
    <svg className={styles.device} viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Battle pass UI view: tiers 1 to 3 of 5 reached, progress 62 percent, a Claim button." style={{fontSize: 12}}>
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

function Stage({index, live}: {index: number; live: boolean}): ReactNode {
  // Columns reveal cumulatively: hidden until their step, then they stay at
  // full brightness. The step's own column plays its entrance (once live).
  const on = (i: number) => clsx(index < i && styles.hidden, index === i && live && styles.play);
  const col = (i: number) => clsx(styles.col, on(i));
  return (
    <>
      <div className={styles.cols}>
        {/* The copy travels from the declaration to Project B, over the top. */}
        <svg className={clsx(styles.copyPath, styles.a, on(2))} style={at(T_COPY)} viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true">
          <path d="M14 10 C 30 -6, 70 -6, 86 10" />
        </svg>

        <div className={col(0)}>
          <span className={styles.colLabel}>declare</span>
          <div className={styles.module}>
            <CodeWindow tabs={MODULE_TABS} dense />
          </div>
          <p className={styles.mono}>one file · one owner · both sides</p>
        </div>

        <Arrow t={T_ARROW1} cls={on(1)} />

        <div className={col(1)}>
          <span className={styles.colLabel}>compiled</span>
          <div className={styles.outputs}>
            <figure className={clsx(styles.out, styles.outDevice, styles.a)} style={at(T_DEVICE)}>
              <PassScreen />
              <figcaption className={styles.mono}>
                UI view binds the Track view model <Check t={T_DEVICE + 0.3} />
              </figcaption>
            </figure>
            <div className={styles.outStack}>
              <figure className={clsx(styles.out, styles.a)} style={at(T_SERVER)}>
                <svg className={styles.server} viewBox="0 0 200 80" role="img" aria-label="Server, player state: ClaimTier replayed and verified." style={{fontSize: 13}}>
                  <ServerFrame x={0.5} y={0.5} width={199} height={79} title="Server · player state">
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

        <Arrow t={T_ARROW2} cls={on(2)} />

        <div className={col(2)}>
          <span className={styles.colLabel}>adapted</span>
          <div className={styles.projectB}>
            <span className={styles.projectTitle}>Project B</span>
            {/* The module, pointed at Project B's model: two declarations change
                (a relation, documented as @relation, and a value-typed price). */}
            <pre className={clsx(styles.miniModule, styles.a, styles.slideIn)} style={at(T_COPY + 0.15)}>
              <span className={styles.kw}>module</span> BattlePass {'{'}
              {'\n'}  <span className={styles.kw}>table</span> Tier {'{'}
              {'\n'}    Reward: <span className={styles.kw}>int</span> @relation(
              {'\n'}<span className={styles.del}>-     references: Item.Id)</span>
              {'\n'}<span className={styles.add}>+     references: Card.Id)</span>
              {'\n'}<span className={styles.del}>-   Price: Gold</span>
              {'\n'}<span className={styles.add}>+   Price: Gems</span>
              {'\n'}  {'}'}
              {'\n'}  <span className={styles.kw}>command</span> ClaimTier(…)
              {'\n'}  <span className={styles.kw}>reactive query</span> Track(…)
              {'\n'}{'}'}
            </pre>
            <p className={clsx(styles.compilerLine, styles.a)} style={at(T_COMPILE)}>
              compiler: re-checked 3 joins · regenerated view model + server command · ok
            </p>
          </div>
          <p className={styles.mono}>same module · 2 declarations changed · logic untouched</p>
        </div>
      </div>

      <div className={clsx(styles.strip, on(3), index === 3 && styles.stripOn)}>
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
    </>
  );
}

export default function FeatureSlice(): ReactNode {
  return (
    <DemoStage
      title="a feature from declaration to reuse"
      steps={STEPS}
      codeTabs={[
        {id: 'schema', label: 'schema', content: <CodeWindow tabs={PLAIN_TABS} dense />},
        {id: 'write', label: 'what you write', content: <CodeWindow tabs={VIEW_TABS} dense />},
        {id: 'compiler', label: 'what the compiler does', content: <CompilerNotes lines={COMPILER} />},
      ]}>
      {({index, run, live}) => (
        <div key={`${run}-${index}`} className={styles.root}>
          <Stage index={index} live={live} />
        </div>
      )}
    </DemoStage>
  );
}

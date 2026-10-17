import type {CSSProperties, ReactNode} from 'react';
import clsx from 'clsx';
import useBrokenLinks from '@docusaurus/useBrokenLinks';
import {BUY_TABS, CodeWindow} from '@site/src/components/CodeWindow';
import {DEVICE_STATUS_H, DeviceFrame, ServerFrame} from '@site/src/components/Glyphs';
import DemoStage, {type DemoStep} from '@site/src/components/DemoStage';
import styles from './styles.module.css';

// Visual C — one generated command, run on the device and on the server, in
// the DemoStage shell. Same input state, same seed, same output hash.

type Run = 'idle' | 'running' | 'done';

const DEVICE_US = 3.1;
const SERVER_US = 2.4;
const INPUT = '#91c0';
const SEED = '0x5A3C';
const OUTPUT = '#a3f9';

function Progress({x, y, w, run}: {x: number; y: number; w: number; run: Run}) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <text className={styles.cmd} x={0} y={-12}>
        BuyItem(sword)
      </text>
      <rect className={styles.track} width={w} height={5} rx={2.5} />
      <rect className={clsx(styles.fill, run !== 'idle' && styles.fillOn)} width={w} height={5} rx={2.5} />
      <path
        className={clsx(styles.tick, run === 'done' && styles.tickOn)}
        d={`M${w / 2 - 7} 26 l5 5 l10 -11`}
      />
    </g>
  );
}

function Rows({us, run, side}: {us: number; run: Run; side: 'device' | 'server'}) {
  // Timings show once the run has finished; while running, the bar carries it.
  return (
    <dl className={clsx(styles.rows, styles[side])}>
      <div>
        <dt>input state</dt>
        <dd>{INPUT}</dd>
      </div>
      <div>
        <dt>seed</dt>
        <dd>{SEED}</dd>
      </div>
      <div>
        <dt>output state</dt>
        <dd className={clsx(run === 'done' && styles.resolved)}>{run === 'done' ? OUTPUT : '—'}</dd>
      </div>
      <div className={styles.timing}>
        <dt>time</dt>
        <dd>{run === 'done' ? us.toFixed(1) : '—'} µs</dd>
      </div>
    </dl>
  );
}

const STEP_RUN: Run[] = ['idle', 'running', 'done'];

// The two frames are a mirrored pair: same size, same inner rhythm (title,
// command, progress bar, check), so the eye compares like with like.
const FRAME_W = 300;
const FRAME_H = 200;
const TITLE_Y = 50;
const BAR_Y = 120; // also where the "identical" sign sits, between the frames
const PAD_X = 18;

function Frame({side, run}: {side: 'device' | 'server'; run: Run}) {
  const inner = (
    <>
      <text className={clsx(styles.where, side === 'server' && styles.whereServer)} x={PAD_X} y={TITLE_Y}>
        {side === 'device' ? 'device · IL2CPP' : 'server · .NET 8'}
      </text>
      <Progress x={PAD_X} y={BAR_Y} w={FRAME_W - 2 * PAD_X} run={run} />
    </>
  );
  return (
    <svg className={styles.frame} viewBox={`0 0 ${FRAME_W} ${FRAME_H}`} aria-hidden="true" style={{fontSize: 14}}>
      {side === 'device' ? (
        <DeviceFrame x={0.5} y={0.5} width={FRAME_W - 1} height={FRAME_H - 1}>
          {inner}
        </DeviceFrame>
      ) : (
        <ServerFrame x={0.5} y={0.5} width={FRAME_W - 1} height={FRAME_H - 1} title="">
          {inner}
        </ServerFrame>
      )}
    </svg>
  );
}

export default function TwoPlaces({id}: {id?: string}): ReactNode {
  // Register the anchor so links like /how-it-works#replay pass the broken-anchor check.
  const brokenLinks = useBrokenLinks();
  if (id) brokenLinks.collectAnchor(id);
  const steps: DemoStep[] = [
    {
      id: 'input',
      label: 'same input',
      narration: 'Both sides start from the same verified state and the same seed — the only inputs the command can read.',
    },
    {
      id: 'run',
      label: 'run on both',
      narration: 'The same generated command runs on the device under IL2CPP and on the server under .NET 8 — nothing shared between them but the inputs.',
    },
    {
      id: 'same',
      label: 'identical state',
      narration: 'Both land on the same state hash. That is what lets the server replay a journal and trust the result.',
    },
  ];
  return (
    <div id={id} className={styles.root}>
      <DemoStage
        title="one command, two places"
        steps={steps}
        costLine="same result verified on x86-64, ARM64 and IL2CPP"
        codeTabs={[{id: 'compiler', label: 'what the compiler does', content: <CodeWindow tabs={BUY_TABS} dense />}]}>
        {({index, run: k}) => {
          const run = STEP_RUN[index];
          return (
            <div
              key={`${k}-${index}`}
              className={clsx(styles.stage, styles[run])}
              style={{'--frame-w': `${FRAME_W}px`, '--bar-y': `${BAR_Y}px`} as CSSProperties}>
              <div className={styles.side}>
                <Frame side="device" run={run} />
                <Rows us={DEVICE_US} run={run} side="device" />
              </div>

              <div className={styles.equals}>
                <span className={styles.equalsRow}>
                  <span className={styles.equalsLine} aria-hidden="true" />
                  <span className={styles.equalsSign} aria-hidden="true" />
                  <span className={styles.equalsLine} aria-hidden="true" />
                </span>
                <span className={styles.equalsLabel}>{run === 'done' ? 'identical' : 'same input, same seed'}</span>
              </div>

              <div className={clsx(styles.side, styles.serverSide)}>
                <Frame side="server" run={run} />
                <Rows us={SERVER_US} run={run} side="server" />
              </div>
            </div>
          );
        }}
      </DemoStage>
    </div>
  );
}

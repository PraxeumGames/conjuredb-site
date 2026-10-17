import {useState, type ReactNode} from 'react';
import clsx from 'clsx';
import useBrokenLinks from '@docusaurus/useBrokenLinks';
import {BUY_TABS, CodeWindow} from '@site/src/components/CodeWindow';
import {DEVICE_STATUS_H, DeviceFrame, ServerFrame} from '@site/src/components/Glyphs';
import DemoStage, {type DemoStep} from '@site/src/components/DemoStage';
import styles from './styles.module.css';

// Visual C — one generated command, run on the device and on the server, in
// the DemoStage shell. Same input state, same seed, same output hash; the
// platform mode only changes the device label.

type Run = 'idle' | 'running' | 'done';
type Platform = 'IL2CPP' | '.NET 8' | 'ARM64';
const PLATFORMS: Platform[] = ['IL2CPP', '.NET 8', 'ARM64'];

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

export default function TwoPlaces({id}: {id?: string}): ReactNode {
  // Register the anchor so links like /how-it-works#replay pass the broken-anchor check.
  const brokenLinks = useBrokenLinks();
  if (id) brokenLinks.collectAnchor(id);
  const [platform, setPlatform] = useState<Platform>('IL2CPP');
  const steps: DemoStep[] = [
    {
      id: 'input',
      label: 'same input',
      narration: 'Both sides start from the same verified state and the same seed — the only inputs the command can read.',
    },
    {
      id: 'run',
      label: 'run on both',
      narration: `The same generated command runs on the device under ${platform} and on the server under .NET — nothing shared between them but the inputs.`,
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
        modes={PLATFORMS.map((p) => ({id: p, label: p}))}
        mode={platform}
        onMode={(p) => setPlatform(p as Platform)}
        steps={steps}
        costLine={({index}) =>
          index === 0
            ? `input ${INPUT} · seed ${SEED} on both sides`
            : index === 1
              ? 'BuyItem(sword) · same generated code · illustrative timings'
              : `device ${DEVICE_US} µs · server ${SERVER_US} µs · output ${OUTPUT} = ${OUTPUT}`
        }
        codeTabs={[{id: 'compiler', label: 'what the compiler does', content: <CodeWindow tabs={BUY_TABS} dense />}]}>
        {({index, run: k}) => {
          const run = STEP_RUN[index];
          return (
            <div key={`${k}-${index}`} className={clsx(styles.stage, styles[run])}>
              <div className={clsx(styles.side, styles.deviceSide)}>
                <svg className={styles.frame} viewBox="0 0 160 220" aria-hidden="true" style={{fontSize: 14}}>
                  <DeviceFrame x={0.5} y={0.5} width={159} height={219}>
                    <text className={styles.where} x={14} y={DEVICE_STATUS_H + 22}>
                      device · {platform}
                    </text>
                    <Progress x={14} y={DEVICE_STATUS_H + 92} w={131} run={run} />
                  </DeviceFrame>
                </svg>
                <Rows us={DEVICE_US} run={run} side="device" />
              </div>

              <div className={styles.equals}>
                <span className={styles.equalsSign} aria-hidden="true" />
                <span className={styles.equalsLabel}>{run === 'done' ? 'identical' : 'same input, same seed'}</span>
              </div>

              <div className={clsx(styles.side, styles.serverSide)}>
                <svg className={styles.frame} viewBox="0 0 250 150" aria-hidden="true" style={{fontSize: 14}}>
                  <ServerFrame x={0.5} y={0.5} width={249} height={149} title="Server · player state">
                    <Progress x={18} y={88} w={214} run={run} />
                  </ServerFrame>
                </svg>
                <Rows us={SERVER_US} run={run} side="server" />
              </div>
            </div>
          );
        }}
      </DemoStage>
    </div>
  );
}

import {useCallback, useEffect, useRef, useState, type ReactNode} from 'react';
import clsx from 'clsx';
import useBrokenLinks from '@docusaurus/useBrokenLinks';
import {BUY_TABS, CodeWindow} from '@site/src/components/CodeWindow';
import {DEVICE_STATUS_H, DeviceFrame, ServerFrame} from '@site/src/components/Glyphs';
import styles from './styles.module.css';

// Visual C — one generated command, run on the device and on the server.
// Same input state, same seed, same output hash; the platform toggle only
// changes the device label. Runs once when scrolled into view.

type Run = 'idle' | 'running' | 'done';
type Platform = 'IL2CPP' | '.NET 8' | 'ARM64';
const PLATFORMS: Platform[] = ['IL2CPP', '.NET 8', 'ARM64'];

const RUN_MS = 1100;
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
        <dd>{run === 'idle' ? '—' : us.toFixed(1)} µs</dd>
      </div>
    </dl>
  );
}

export default function TwoPlaces({id}: {id?: string}): ReactNode {
  // Register the anchor so links like /how-it-works#replay pass the broken-anchor check.
  const brokenLinks = useBrokenLinks();
  if (id) brokenLinks.collectAnchor(id);
  const [run, setRun] = useState<Run>('idle');
  const [t, setT] = useState(0); // 0..1 progress of the counters
  const [platform, setPlatform] = useState<Platform>('IL2CPP');
  const reduced = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  const rootRef = useRef<HTMLDivElement>(null);

  const start = useCallback(() => {
    window.clearInterval(timer.current);
    if (reduced.current) {
      setT(1);
      setRun('done');
      return;
    }
    // Reset first so the progress bars can fill again on a re-run.
    setRun('idle');
    setT(0);
    let t0 = 0;
    timer.current = window.setInterval(() => {
      if (!t0) {
        t0 = performance.now();
        setRun('running');
        return;
      }
      const k = Math.min(1, (performance.now() - t0) / RUN_MS);
      setT(k);
      if (k >= 1) {
        window.clearInterval(timer.current);
        setRun('done');
      }
    }, 40);
  }, []);

  useEffect(() => () => window.clearInterval(timer.current), []);

  // Reduced motion: show the finished state, no counting.
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    reduced.current = mq.matches;
    if (mq.matches) {
      setT(1);
      setRun('done');
    }
  }, []);

  // Run once when it first scrolls into view.
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          io.disconnect();
          if (!reduced.current) start();
        }
      },
      {threshold: 0.4},
    );
    io.observe(el);
    return () => io.disconnect();
  }, [start]);

  // A new platform clears the run so it can be run again; the hash won't change.
  const pickPlatform = (p: Platform) => {
    setPlatform(p);
    if (reduced.current) return;
    window.clearInterval(timer.current);
    setRun('idle');
    setT(0);
  };

  return (
    <div id={id} ref={rootRef} className={clsx(styles.root, styles[run])}>
      <div className={styles.stage}>
        <div className={clsx(styles.side, styles.deviceSide)}>
          <svg className={styles.frame} viewBox="0 0 160 220" aria-hidden="true" style={{fontSize: 14}}>
            <DeviceFrame x={0.5} y={0.5} width={159} height={219}>
              <text className={styles.where} x={14} y={DEVICE_STATUS_H + 22}>
                device · {platform}
              </text>
              <Progress x={14} y={DEVICE_STATUS_H + 92} w={131} run={run} />
            </DeviceFrame>
          </svg>
          <div className={styles.toggle} role="group" aria-label="Device runtime">
            {PLATFORMS.map((p) => (
              <button
                key={p}
                type="button"
                aria-pressed={p === platform}
                className={clsx(p === platform && styles.toggleOn)}
                onClick={() => pickPlatform(p)}>
                {p}
              </button>
            ))}
          </div>
          <Rows us={DEVICE_US * t} run={run} side="device" />
        </div>

        <div className={styles.code}>
          <CodeWindow tabs={BUY_TABS} />
          <div className={styles.equals}>
            <span className={styles.equalsSign} aria-hidden="true" />
            <span className={styles.equalsLabel}>{run === 'done' ? 'identical' : 'same input, same seed'}</span>
          </div>
        </div>

        <div className={clsx(styles.side, styles.serverSide)}>
          <svg className={styles.frame} viewBox="0 0 250 150" aria-hidden="true" style={{fontSize: 14}}>
            <ServerFrame x={0.5} y={0.5} width={249} height={149} title="Server · player grain">
              <Progress x={18} y={88} w={214} run={run} />
            </ServerFrame>
          </svg>
          <Rows us={SERVER_US * t} run={run} side="server" />
        </div>
      </div>

      <div className={styles.controls}>
        <button type="button" className="button button--primary" onClick={start} disabled={run === 'running'}>
          Run on both
        </button>
      </div>
      <p className={styles.note}>illustrative timings</p>
      <p className={styles.srOnly} aria-live="polite">
        {run === 'done'
          ? `Both sides finished. Device on ${platform}: ${DEVICE_US} µs, output ${OUTPUT}. Server: ${SERVER_US} µs, output ${OUTPUT}. Identical.`
          : ''}
      </p>
    </div>
  );
}

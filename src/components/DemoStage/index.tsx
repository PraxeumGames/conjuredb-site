import {useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode} from 'react';
import clsx from 'clsx';
import Steps from '@site/src/components/Steps';
import styles from './styles.module.css';

// One shell for every interactive visual on the site, top to bottom:
//   header (▶ interactive · title | modes | ↺ replay) → stage → cost line →
//   step rail → narration → code tabs (collapsed by default).
// Autoplay runs once, when the shell is 40 % visible, then waits on the last
// step. Clicking a step pins it; ↺ replay runs the steps again. Reduced
// motion shows the last step, static. Nothing blinks: a continuous process
// is a <Sweep>, a thin bar travelling left to right.

export type DemoStep = {
  id: string;
  label: string;
  narration: ReactNode;
  holdMs?: number; // how long autoplay stays on this step (default 3200)
  alt?: boolean; // the wire-red variant (a failure step)
};
export type DemoMode = {id: string; label: string};
export type DemoCodeTab = {id: string; label: string; content: ReactNode};

/** What the stage, the cost line and the narration see. */
export type DemoContext = {
  step: string;
  index: number;
  /** Increments on every replay or mode change: key CSS animations on it to restart them. */
  run: number;
  /** True while autoplay is advancing (false when pinned, finished or reduced motion). */
  playing: boolean;
  reduced: boolean;
};

const DEFAULT_HOLD = 3200;

type Props = {
  title: string;
  steps: DemoStep[];
  modes?: DemoMode[];
  mode?: string;
  onMode?: (id: string) => void;
  onStep?: (id: string) => void;
  costLine?: ReactNode | ((ctx: DemoContext) => ReactNode);
  codeTabs?: DemoCodeTab[];
  /** Fixed stage height per breakpoint, so steps never resize the block. */
  stageMinHeight?: {wide: string; narrow: string};
  stageClassName?: string;
  /** Columns of the step rail on phones (default 2). */
  narrowColumns?: number;
  children: ReactNode | ((ctx: DemoContext) => ReactNode);
};

export default function DemoStage({
  title,
  steps,
  modes,
  mode,
  onMode,
  onStep,
  costLine,
  codeTabs,
  stageMinHeight,
  stageClassName,
  narrowColumns = 2,
  children,
}: Props): ReactNode {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [seen, setSeen] = useState(false);
  const [run, setRun] = useState(0);
  const [tab, setTab] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const last = steps.length - 1;
  // Steps and onStep are usually rebuilt on every parent render; read them
  // through a ref so a parent re-render never resets the autoplay timer.
  const latest = useRef({steps, onStep});
  latest.current = {steps, onStep};

  const go = useCallback((i: number) => {
    setIndex(i);
    latest.current.onStep?.(latest.current.steps[i].id);
  }, []);

  // Reduced motion: the last step, static. Otherwise wait to be seen.
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setReduced(true);
      setIndex(last);
      return;
    }
    const el = rootRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting) return;
        io.disconnect();
        setSeen(true);
        setPlaying(true);
      },
      {threshold: 0.4},
    );
    io.observe(el);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Autoplay: hold each step, stop on the last one.
  useEffect(() => {
    if (!playing) return;
    const hold = latest.current.steps[index]?.holdMs ?? DEFAULT_HOLD;
    const t = window.setTimeout(() => (index >= last ? setPlaying(false) : go(index + 1)), hold);
    return () => window.clearTimeout(t);
  }, [playing, index, last, go, run]);

  const replay = () => {
    setRun((r) => r + 1);
    if (reduced) return;
    go(0);
    setPlaying(true);
  };
  const pick = (id: string) => {
    setPlaying(false);
    setRun((r) => r + 1);
    go(Math.max(0, steps.findIndex((s) => s.id === id)));
  };
  const pickMode = (id: string) => {
    if (id === mode) return;
    onMode?.(id);
    setRun((r) => r + 1);
    if (!reduced && seen) {
      go(0);
      setPlaying(true);
    }
  };

  const ctx: DemoContext = {step: steps[index].id, index, run, playing, reduced};
  const stageStyle = stageMinHeight
    ? ({'--stage-h': stageMinHeight.wide, '--stage-h-narrow': stageMinHeight.narrow} as CSSProperties)
    : undefined;
  const cost = typeof costLine === 'function' ? costLine(ctx) : costLine;
  const activeTab = codeTabs?.find((t) => t.id === tab);

  return (
    <div ref={rootRef} className={clsx(styles.root, seen && styles.seen)}>
      <div className={styles.header}>
        <span className={styles.title}>
          <span className={styles.play} aria-hidden="true">
            ▶
          </span>{' '}
          interactive · {title}
        </span>
        <div className={styles.controls}>
          {modes && modes.length > 0 && (
            <div className={styles.modes} role="group" aria-label={`${title}: mode`}>
              {modes.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  aria-pressed={m.id === mode}
                  className={clsx(styles.mode, m.id === mode && styles.modeOn)}
                  onClick={() => pickMode(m.id)}>
                  {m.label}
                </button>
              ))}
            </div>
          )}
          <button type="button" className={styles.replay} onClick={replay}>
            ↺ replay
          </button>
        </div>
      </div>

      <div className={clsx(styles.stage, stageClassName)} style={stageStyle}>
        {typeof children === 'function' ? children(ctx) : children}
      </div>

      {cost && <p className={styles.cost}>{cost}</p>}

      <Steps
        steps={steps.map((s, i) => ({key: s.id, n: String(i + 1).padStart(2, '0'), label: s.label, alt: s.alt}))}
        active={steps[index].id}
        onPick={pick}
        timerMs={playing && index <= last ? (steps[index].holdMs ?? DEFAULT_HOLD) : undefined}
        label={`${title}: step`}
        columns={steps.length}
        narrowColumns={Math.min(narrowColumns, steps.length)}
        silent
      />
      <p className={styles.narration} aria-live="polite">
        {steps[index].narration}
      </p>

      {codeTabs && codeTabs.length > 0 && (
        <div className={styles.code}>
          <div className={styles.tabs} role="tablist" aria-label={`${title}: code`}>
            {codeTabs.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={t.id === tab}
                aria-expanded={t.id === tab}
                className={clsx(styles.tab, t.id === tab && styles.tabOn)}
                onClick={() => setTab((cur) => (cur === t.id ? null : t.id))}>
                {t.label}
              </button>
            ))}
            <span className={clsx(styles.chevron, tab && styles.chevronOpen)} aria-hidden="true">
              ⌄
            </span>
          </div>
          {activeTab && (
            <div className={styles.tabPanel} role="tabpanel">
              {activeTab.content}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** A continuous process: a thin bar sweeping left to right every ~1.6 s, with a mono label. */
export function Sweep({label, className}: {label: ReactNode; className?: string}): ReactNode {
  return (
    <div className={clsx(styles.sweep, className)}>
      <span className={styles.sweepTrack} aria-hidden="true">
        <span className={styles.sweepBar} />
      </span>
      <span className={styles.sweepLabel}>{label}</span>
    </div>
  );
}

/** A box of mono lines for the "what the compiler does" tab. */
export function CompilerNotes({lines}: {lines: ReactNode[]}): ReactNode {
  return (
    <ul className={styles.notes}>
      {lines.map((l, i) => (
        <li key={i}>{l}</li>
      ))}
    </ul>
  );
}

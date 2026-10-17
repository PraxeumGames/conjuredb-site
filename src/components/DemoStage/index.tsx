import {useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode} from 'react';
import clsx from 'clsx';
import Steps from '@site/src/components/Steps';
import styles from './styles.module.css';

// One shell for every interactive visual on the site, top to bottom:
//   header (▶ interactive · title | modes | ↺ replay) → stage → cost line →
//   step rail → narration → code tabs (collapsed by default).
// Everything renders at first paint, static and fully visible. Autoplay — the
// step timer and the entrance effects (ctx.live) — starts once, when the
// header row is fully in view or 20 % of the shell is (stages taller than
// 70 vh use the header rule only), then waits on the last step. Clicking a
// step pins it; ↺ replay runs the steps again. Reduced motion shows the last
// step, static. Nothing blinks: a continuous process is a <Sweep>.

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
  /**
   * False until the autoplay trigger fires (and always under reduced motion):
   * entrance effects — typing, reveals — run only when true, so the first
   * paint is the static, complete step.
   */
  live: boolean;
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
  /**
   * Start as a poster: the last step as a static frame under a ▶ play button,
   * no autoplay. Play (or picking a step) starts the demo as usual.
   */
  poster?: boolean;
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
  poster = false,
  children,
}: Props): ReactNode {
  const [index, setIndex] = useState(poster ? steps.length - 1 : 0);
  const [posterOn, setPosterOn] = useState(poster);
  const [playing, setPlaying] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [seen, setSeen] = useState(false);
  const [run, setRun] = useState(0);
  const [tab, setTab] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const last = steps.length - 1;
  // Steps and onStep are usually rebuilt on every parent render; read them
  // through a ref so a parent re-render never resets the autoplay timer.
  const latest = useRef({steps, onStep});
  latest.current = {steps, onStep};

  const go = useCallback((i: number) => {
    setIndex(i);
    latest.current.onStep?.(latest.current.steps[i].id);
  }, []);

  // Reduced motion: the last step, static. Otherwise start on the first of:
  // the header row fully in view, or 20 % of the shell in view (unless the
  // shell is taller than 70 vh, where 20 % can sit below the fold).
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setReduced(true);
      setIndex(last);
      return;
    }
    const root = rootRef.current;
    const header = headerRef.current;
    if (!root || !header || typeof IntersectionObserver === 'undefined') return;
    const start = () => {
      ios.forEach((io) => io.disconnect());
      setSeen(true);
      // A poster waits for its ▶ play.
      if (!poster) setPlaying(true);
    };
    const watch = (el: Element, threshold: number) =>
      new IntersectionObserver(([e]) => e.isIntersecting && start(), {threshold});
    const ios = [watch(header, 1)];
    ios[0].observe(header);
    if (root.getBoundingClientRect().height <= window.innerHeight * 0.7) {
      const io = watch(root, 0.2);
      io.observe(root);
      ios.push(io);
    }
    return () => ios.forEach((io) => io.disconnect());
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
    setPosterOn(false);
    setRun((r) => r + 1);
    if (reduced) return;
    setSeen(true);
    go(0);
    setPlaying(true);
  };
  const pick = (id: string) => {
    if (posterOn && !reduced) {
      // Leaving the poster through a step starts the demo from that step.
      setPosterOn(false);
      setSeen(true);
      setRun((r) => r + 1);
      go(Math.max(0, steps.findIndex((s) => s.id === id)));
      setPlaying(true);
      return;
    }
    setPosterOn(false);
    setSeen(true);
    setPlaying(false);
    setRun((r) => r + 1);
    go(Math.max(0, steps.findIndex((s) => s.id === id)));
  };
  const pickMode = (id: string) => {
    if (id === mode) return;
    onMode?.(id);
    setRun((r) => r + 1);
    if (!reduced && seen && !posterOn) {
      go(0);
      setPlaying(true);
    }
  };

  const ctx: DemoContext = {step: steps[index].id, index, run, playing, reduced, live: seen && !reduced && !posterOn};
  const stageStyle = stageMinHeight
    ? ({'--stage-h': stageMinHeight.wide, '--stage-h-narrow': stageMinHeight.narrow} as CSSProperties)
    : undefined;
  const cost = typeof costLine === 'function' ? costLine(ctx) : costLine;
  const activeTab = codeTabs?.find((t) => t.id === tab);

  return (
    <div ref={rootRef} className={clsx(styles.root, seen && styles.seen)}>
      <div ref={headerRef}>
        <DemoHeader title={title} modes={modes} mode={mode} onMode={pickMode} onReplay={replay} />
      </div>

      <div className={clsx(styles.stage, stageClassName)} style={stageStyle}>
        {typeof children === 'function' ? children(ctx) : children}
        {posterOn && !reduced && (
          <div className={styles.poster}>
            <button type="button" className={styles.playBtn} onClick={replay} aria-label={`Play: ${title}`}>
              ▶ play
            </button>
          </div>
        )}
      </div>


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
      {/* One block under the rail: the cost (mono) when it carries a number, then the narration. */}
      <div className={styles.readout}>
        {cost && (typeof cost !== 'string' || /\d/.test(cost)) && <p className={styles.cost}>{cost}</p>}
        <DemoNarration>{steps[index].narration}</DemoNarration>
      </div>

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

/** The shell's header row on its own (the hero uses it without the surface). */
export function DemoHeader({
  title,
  modes,
  mode,
  onMode,
  onReplay,
  seen,
}: {
  title: string;
  seen?: boolean; // pulses the ▶ twice, once (DemoStage sets it on its root instead)
  modes?: DemoMode[];
  mode?: string;
  onMode?: (id: string) => void;
  onReplay: () => void;
}): ReactNode {
  return (
    <div className={clsx(styles.header, seen && styles.seen)}>
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
                onClick={() => onMode?.(m.id)}>
                {m.label}
              </button>
            ))}
          </div>
        )}
        <button type="button" className={styles.replay} onClick={onReplay}>
          ↺ replay
        </button>
      </div>
    </div>
  );
}

/** The narration line under a step rail. */
export function DemoNarration({children}: {children: ReactNode}): ReactNode {
  return (
    <p className={styles.narration} aria-live="polite">
      {children}
    </p>
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

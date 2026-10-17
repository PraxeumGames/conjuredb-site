import {createContext, useCallback, useContext, useEffect, useRef, useState, type CSSProperties, type ReactNode} from 'react';
import clsx from 'clsx';
import Steps from '@site/src/components/Steps';
import {CodeCap, CodeWindow} from '@site/src/components/CodeWindow';
import styles from './styles.module.css';

// One shell for every interactive visual on the site, top to bottom:
//   header (▶ interactive · title | modes | ↺ replay) → stage → cost line →
//   step rail → narration → "under the hood" panel (open, segmented tabs).
// Everything renders at first paint, static and fully visible. Only the demo
// most in view runs: the first time a shell is that demo it autoplays once
// (the step timer and the entrance effects, ctx.live), then waits on the last
// step; while another demo is most in view, its timer pauses. Clicking a step
// pins it and stops the timer; ↺ replay runs the steps again. A `manual`
// demo never autoplays: it starts on step 01 with ← prev / next → beside the
// rail. Reduced motion shows the last step, static. Nothing blinks: a
// continuous process is a <Sweep>.

export type DemoStep = {
  id: string;
  label: string;
  narration: ReactNode;
  holdMs?: number; // how long autoplay stays on this step (default 5000; use 7000 when it changes code or more than three elements)
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

const DEFAULT_HOLD = 5000;

/**
 * Page-level defaults for the shells inside a subtree. The homepage caps the
 * under-the-hood code at 7 visible lines (`show all ⌄` expands it).
 */
export const DemoDefaults = createContext<{hoodLines?: number}>({});

// Only the demo most in view runs. Each shell reports its visible area; the
// one with the largest area is active, the others pause their timers.
type Entry = {area: number; setActive: (on: boolean) => void};
const registry = new Map<symbol, Entry>();
let activeId: symbol | null = null;
function elect() {
  let best: symbol | null = null;
  let bestArea = 0;
  registry.forEach((e, id) => {
    if (e.area > bestArea) {
      best = id;
      bestArea = e.area;
    }
  });
  if (best === activeId) return;
  const prev = activeId;
  activeId = best;
  if (prev) registry.get(prev)?.setActive(false);
  if (best) registry.get(best)?.setActive(true);
}
const THRESHOLDS = Array.from({length: 21}, (_, i) => i / 20);

type Props = {
  title: string;
  steps: DemoStep[];
  modes?: DemoMode[];
  mode?: string;
  onMode?: (id: string) => void;
  onStep?: (id: string) => void;
  costLine?: ReactNode | ((ctx: DemoContext) => ReactNode);
  codeTabs?: DemoCodeTab[];
  /** Fixed stage height on wide screens, so steps never resize the block. Below 997px the stage is its content. */
  stageMinHeight?: {wide: string};
  stageClassName?: string;
  /** Columns of the step rail on phones (default 2). */
  narrowColumns?: number;
  /**
   * No autoplay: the demo starts pinned on step 01 and the reader steps through
   * it with the rail or ← prev / next →. For code-heavy demos.
   */
  manual?: boolean;
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
  manual = false,
  children,
}: Props): ReactNode {
  const {hoodLines} = useContext(DemoDefaults);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [active, setActive] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [seen, setSeen] = useState(false);
  const [run, setRun] = useState(0);
  const [tab, setTab] = useState<string | undefined>(codeTabs?.[0]?.id);
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

  // Reduced motion: the last step, static. Otherwise take part in the
  // most-in-view election; the first time this shell wins, it autoplays once.
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setReduced(true);
      setIndex(last);
      return;
    }
    const root = rootRef.current;
    if (!root || typeof IntersectionObserver === 'undefined') return;
    const id = Symbol(title);
    registry.set(id, {area: 0, setActive});
    const io = new IntersectionObserver(
      ([e]) => {
        const r = e.intersectionRect;
        const area = r.width * r.height;
        // Counts once a fifth of it, or 40 % of the viewport, is in view.
        const enough = e.intersectionRatio >= 0.2 || area >= 0.4 * window.innerWidth * window.innerHeight;
        const entry = registry.get(id);
        if (entry) entry.area = enough ? area : 0;
        elect();
      },
      {threshold: THRESHOLDS},
    );
    io.observe(root);
    return () => {
      io.disconnect();
      registry.delete(id);
      if (activeId === id) activeId = null;
      elect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The first time this shell is the one most in view, it plays once.
  useEffect(() => {
    if (active && !seen && !reduced) {
      setSeen(true);
      if (!manual) setPlaying(true);
    }
  }, [active, seen, reduced, manual]);

  // Autoplay: hold each step, stop on the last one; paused while another demo is most in view.
  useEffect(() => {
    if (!playing || !active) return;
    const hold = latest.current.steps[index]?.holdMs ?? DEFAULT_HOLD;
    const t = window.setTimeout(() => (index >= last ? setPlaying(false) : go(index + 1)), hold);
    return () => window.clearTimeout(t);
  }, [playing, active, index, last, go, run]);

  const replay = () => {
    setRun((r) => r + 1);
    if (reduced) return;
    setSeen(true);
    go(0);
    if (!manual) setPlaying(true);
  };
  const stepBy = (d: number) => {
    setSeen(true);
    setPlaying(false);
    setRun((r) => r + 1);
    go(Math.min(last, Math.max(0, index + d)));
  };
  const pick = (id: string) => {
    setSeen(true);
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
      if (!manual) setPlaying(true);
    }
  };

  const ctx: DemoContext = {step: steps[index].id, index, run, playing, reduced, live: seen && !reduced};
  const stageStyle = stageMinHeight ? ({'--stage-h': stageMinHeight.wide} as CSSProperties) : undefined;
  const cost = typeof costLine === 'function' ? costLine(ctx) : costLine;
  const activeTab = codeTabs?.find((t) => t.id === tab) ?? codeTabs?.[0];

  return (
    <div ref={rootRef} className={clsx(styles.root, seen && styles.seen)}>
      <DemoHeader title={title} modes={modes} mode={mode} onMode={pickMode} onReplay={replay} />

      <div className={clsx(styles.stage, stageClassName)} style={stageStyle}>
        {typeof children === 'function' ? children(ctx) : children}
      </div>

      {/* The cost, in mono under the stage, when it carries a number. */}
      {cost && (typeof cost !== 'string' || /\d/.test(cost)) && <p className={styles.cost}>{cost}</p>}

      <div className={clsx(styles.rail, manual && styles.railManual)}>
        {manual && (
          <button type="button" className={styles.stepBtn} onClick={() => stepBy(-1)} disabled={index === 0}>
            ← prev
          </button>
        )}
        <div className={styles.railSteps}>
          <Steps
            steps={steps.map((s, i) => ({key: s.id, n: String(i + 1).padStart(2, '0'), label: s.label, alt: s.alt}))}
            active={steps[index].id}
            onPick={pick}
            timerMs={playing && active ? (steps[index].holdMs ?? DEFAULT_HOLD) : undefined}
            label={`${title}: step`}
            columns={steps.length}
            narrowColumns={Math.min(narrowColumns, steps.length)}
            silent
          />
        </div>
        {manual && (
          <button type="button" className={styles.stepBtn} onClick={() => stepBy(1)} disabled={index === last}>
            next →
          </button>
        )}
      </div>
      <DemoNarration>{steps[index].narration}</DemoNarration>

      {codeTabs && codeTabs.length > 0 && activeTab && (
        <div className={styles.hood}>
          <div className={styles.hoodHead}>
            <span className={styles.hoodLabel}>
              under the hood{codeTabs.length === 1 && ` · ${codeTabs[0].label}`}
            </span>
            {codeTabs.length > 1 && (
              <div className={clsx(styles.modes, styles.hoodTabs)} role="tablist" aria-label={`${title}: under the hood`}>
                {codeTabs.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    role="tab"
                    aria-selected={t.id === activeTab.id}
                    className={clsx(styles.mode, t.id === activeTab.id && styles.modeOn)}
                    onClick={() => setTab(t.id)}>
                    {t.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className={styles.hoodBody} role="tabpanel">
            <CodeCap.Provider value={hoodLines}>{activeTab.content}</CodeCap.Provider>
          </div>
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

/** The "what the compiler does" tab: plain lines in the same code window. */
export function CompilerNotes({lines}: {lines: ReactNode[]}): ReactNode {
  return (
    <CodeWindow
      dense
      tabs={[
        {
          name: 'what the compiler does',
          lang: '',
          lines: lines.map((l, i) => (
            <span key={i} className={styles.note}>
              › {l}
            </span>
          )),
        },
      ]}
    />
  );
}

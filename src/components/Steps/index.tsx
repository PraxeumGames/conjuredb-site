import type {CSSProperties, ReactNode} from 'react';
import clsx from 'clsx';
import styles from './styles.module.css';

// Step buttons under the animated visuals (hero, replay). One component so
// the buttons, the progress timer and the hover/focus states are identical.

// `live` overrides what the aria-live caption announces for this step.
export type Step<K extends string> = {key: K; n: string; label: string; alt?: boolean; live?: string};

export default function Steps<K extends string>({
  steps,
  active,
  onPick,
  timerMs,
  label,
  columns,
  narrowColumns = columns,
}: {
  steps: Step<K>[];
  active: K;
  onPick: (key: K) => void;
  timerMs?: number; // shows the progress bar on the active step while auto-playing
  label: string;
  columns: number;
  narrowColumns?: number;
}): ReactNode {
  const current = steps.find((s) => s.key === active);
  const style = {'--cols': columns, '--cols-narrow': narrowColumns} as CSSProperties;
  return (
    <>
      <div className={styles.steps} role="group" aria-label={label} style={style}>
        {steps.map((s) => {
          const on = s.key === active;
          return (
            <button
              key={s.key}
              type="button"
              aria-pressed={on}
              className={clsx(styles.step, on && styles.active, s.alt && styles.alt)}
              onClick={() => onPick(s.key)}>
              <span className={styles.n}>{s.n}</span>
              <span className={styles.label}>{s.label}</span>
              {on && timerMs ? (
                <span
                  key={`${s.key}-${timerMs}`}
                  className={styles.timer}
                  style={{animationDuration: `${timerMs}ms`}}
                  aria-hidden="true"
                />
              ) : null}
            </button>
          );
        })}
      </div>
      <p className={styles.live} aria-live="polite">
        {current ? `Step ${current.n}: ${current.live ?? current.label}` : ''}
      </p>
    </>
  );
}

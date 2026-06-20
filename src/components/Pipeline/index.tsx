import {Fragment} from 'react';
import styles from './styles.module.css';

type Step = {t: string; s: string};
const STEPS: Step[] = [
  {t: 'game.conjure', s: 'your data & queries'},
  {t: 'bind & type', s: 'analysis'},
  {t: 'optimize', s: 'Cascades · indexes'},
  {t: 'plan', s: 'physical plan'},
  {t: 'emit C#', s: 'zero-alloc'},
];

export function Pipeline() {
  return (
    <div className={styles.pipe}>
      {STEPS.map((step, i) => (
        <Fragment key={step.t}>
          <div className={styles.node}>
            <b>{step.t}</b>
            <span>{step.s}</span>
          </div>
          {i < STEPS.length - 1 && <div className={styles.link} aria-hidden="true" />}
        </Fragment>
      ))}
    </div>
  );
}

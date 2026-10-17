import type {ReactNode} from 'react';
import clsx from 'clsx';
import styles from './styles.module.css';

// One badge style for every capability on the site. State is carried by the
// dot only: gold = shipped, steel = prototype validated, muted = the rest
// (planned is a hollow dot). No traffic-light colours.

export type Status = 'shipped' | 'in-progress' | 'prototype' | 'planned';

const LABEL: Record<Status, string> = {
  shipped: 'shipped',
  'in-progress': 'in progress',
  prototype: 'prototype validated',
  planned: 'planned',
};

const DOT: Record<Status, string> = {
  shipped: styles.shipped,
  'in-progress': styles.inProgress,
  prototype: styles.prototype,
  planned: styles.planned,
};

export default function StatusBadge({
  status,
  children,
  className,
}: {
  status: Status;
  children?: ReactNode;
  className?: string;
}): ReactNode {
  return (
    <span className={clsx(styles.badge, className)}>
      <span className={clsx(styles.dot, DOT[status])} aria-hidden="true" />
      {children ?? LABEL[status]}
    </span>
  );
}

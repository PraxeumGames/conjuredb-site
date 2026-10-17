import type {ReactNode} from 'react';
import {DeviceFrame, ServerFrame} from '@site/src/components/Glyphs';
import styles from './styles.module.css';

// Small static pictures for the three homepage claims. Same palette and the
// same device / server silhouettes as the hero and the replay visual.

function Svg({children, label}: {children: ReactNode; label: string}) {
  return (
    <svg className={styles.svg} viewBox="0 0 320 180" role="img" aria-label={label} style={{fontSize: 14}}>
      {children}
    </svg>
  );
}

/** Claim 3: one module of the schema feeding both sides. */
export function ModuleSlice(): ReactNode {
  return (
    <Svg label="A BattlePass schema module with a table, a command and a reactive query, wired to both the device and the server.">
      <path className={styles.wire} d="M100 126 Q72 136 46 142" />
      <path className={styles.wire} d="M220 126 Q250 136 275 144" />
      <rect className={styles.card} x={55} y={8} width={210} height={118} rx={9} />
      <text className={styles.cardTitle} x={67} y={28}>
        <tspan className={styles.kw}>module</tspan> BattlePass {'{'}
      </text>
      <line className={styles.cardRule} x1={55} x2={265} y1={37} y2={37} />
      <text className={styles.code} x={81} y={54}>
        <tspan className={styles.kw}>table</tspan> Tier
      </text>
      <text className={styles.code} x={81} y={70}>
        <tspan className={styles.kw}>command</tspan> ClaimTier
      </text>
      <text className={styles.code} x={81} y={86}>
        <tspan className={styles.kw}>reactive query</tspan> Progress
      </text>
      <text className={styles.cardTitle} x={67} y={110}>
        {'}'}
      </text>
      <DeviceFrame x={24} y={132} width={40} height={46} />
      <ServerFrame x={236} y={134} width={78} height={42} title="" />
    </Svg>
  );
}

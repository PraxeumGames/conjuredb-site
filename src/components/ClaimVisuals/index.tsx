import type {ReactNode} from 'react';
import {DEVICE_STATUS_H, DeviceFrame, ServerFrame, WifiGlyph} from '@site/src/components/Glyphs';
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

const Check = ({x, y}: {x: number; y: number}) => (
  <path className={styles.check} d={`M${x - 8} ${y} l5.5 5.5 l11 -12`} />
);

/** Claim 1: offline device → log → server with a check. */
export function OfflineCheck(): ReactNode {
  return (
    <Svg label="A phone with no connection sends a log of three actions to the server, which checks it.">
      <DeviceFrame
        x={18}
        y={18}
        width={78}
        height={146}
        network={<WifiGlyph crossClassName={styles.cross} />}>
        <rect className={styles.screenLine} x={12} y={DEVICE_STATUS_H + 14} width={40} height={6} rx={3} />
        <rect className={styles.screenBlock} x={12} y={DEVICE_STATUS_H + 30} width={54} height={30} rx={5} />
        <rect className={styles.screenBtn} x={12} y={146 - 34} width={54} height={18} rx={5} />
      </DeviceFrame>
      <path className={styles.stream} d="M104 91 H206" />
      {[128, 155, 182].map((x) => (
        <rect key={x} className={styles.marker} x={x - 4.5} y={86.5} width={9} height={9} rx={2} />
      ))}
      <ServerFrame x={212} y={46} width={92} height={90} title="server">
        <Check x={46} y={64} />
      </ServerFrame>
    </Svg>
  );
}

/** Claim 2: a 16.6 ms frame with a sliver for the data layer; replay is shorter still. */
export function FrameBudget(): ReactNode {
  return (
    <Svg label="A 16.6 millisecond frame bar with a small slice for the data layer at 0 bytes allocated, and a much shorter bar for replay at microseconds per command.">
      <text className={styles.label} x={14} y={40}>
        frame
      </text>
      <text className={styles.label} x={306} y={40} textAnchor="end">
        16.6 ms
      </text>
      <rect className={styles.track} x={14} y={50} width={292} height={14} rx={7} />
      <rect className={styles.gold} x={14} y={50} width={26} height={14} rx={7} />
      <path className={styles.tickLine} d="M27 66 V80" />
      <text className={styles.goldLabel} x={22} y={93}>
        data layer · 0 B
      </text>

      <rect className={styles.serverBar} x={14} y={124} width={30} height={10} rx={5} />
      <text className={styles.serverLabel} x={54} y={133}>
        replay · µs per command
      </text>
    </Svg>
  );
}

/** Claim 3: one module of the schema feeding both sides. */
export function ModuleSlice(): ReactNode {
  return (
    <Svg label="A battlepass schema module with a table, a command and a reactive query, wired to both the device and the server.">
      <path className={styles.wire} d="M100 96 Q70 112 46 124" />
      <path className={styles.wire} d="M220 96 Q250 112 275 126" />
      <rect className={styles.card} x={60} y={10} width={200} height={86} rx={9} />
      <text className={styles.cardTitle} x={72} y={30}>
        battlepass/
      </text>
      <line className={styles.cardRule} x1={60} x2={260} y1={39} y2={39} />
      <text className={styles.code} x={72} y={56}>
        <tspan className={styles.kw}>table</tspan> Tier
      </text>
      <text className={styles.code} x={72} y={70}>
        <tspan className={styles.kw}>command</tspan> ClaimTier
      </text>
      <text className={styles.code} x={72} y={84}>
        <tspan className={styles.kw}>reactive query</tspan> Progress
      </text>
      <DeviceFrame x={24} y={110} width={44} height={66} />
      <ServerFrame x={236} y={118} width={78} height={54} title="" />
    </Svg>
  );
}

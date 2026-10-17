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

/** Claim 1: offline device → command journal → server with a check. */
export function OfflineCheck(): ReactNode {
  return (
    <Svg label="A phone with no connection sends a journal of three commands to the server, which checks it.">
      <DeviceFrame
        x={14}
        y={18}
        width={70}
        height={146}
        network={<WifiGlyph crossClassName={styles.cross} />}>
        <rect className={styles.screenLine} x={11} y={DEVICE_STATUS_H + 14} width={34} height={6} rx={3} />
        <rect className={styles.screenBlock} x={11} y={DEVICE_STATUS_H + 30} width={48} height={30} rx={5} />
        <rect className={styles.screenBtn} x={11} y={146 - 34} width={48} height={18} rx={5} />
      </DeviceFrame>
      <path className={styles.stream} d="M92 91 H170" />
      {[108, 130, 152].map((x) => (
        <rect key={x} className={styles.marker} x={x - 4.5} y={86.5} width={9} height={9} rx={2} />
      ))}
      {/* Two-line title so "Server · player grain" stays ≥ 11px in a small frame. */}
      <ServerFrame
        x={176}
        y={36}
        width={130}
        height={110}
        title={
          <>
            Server ·
            <tspan x={38} dy="1.25em">
              player grain
            </tspan>
          </>
        }>
        <Check x={65} y={82} />
      </ServerFrame>
    </Svg>
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

import type {CSSProperties, ReactNode} from 'react';
import clsx from 'clsx';
import Link from '@docusaurus/Link';
import {DEVICE_STATUS_H, DeviceFrame} from '@site/src/components/Glyphs';
import {A, C, CodeWindow, F, K, T, type CodeTab} from '@site/src/components/CodeWindow';
import DemoStage, {CompilerNotes, type DemoStep} from '@site/src/components/DemoStage';
import styles from './styles.module.css';

// "Meta and core in one architecture", in the DemoStage shell: the inventory
// UI view (persistent state, the meta) on the left, the battlefield (per-frame
// state, the core) on the right, and the two connections between them —
// equipped stats flow into the fight through an indexed join, a hit flows
// back into progression as a command.

type Box = {x: number; y: number; w: number; h: number};
type Label = {x: number; y: number; lines: string[]};
type Layout = {w: number; h: number; font: number; device: Box; field: Box; down: string; up: string; downLabel: Label; upLabel: Label};

const WIDE: Layout = {
  w: 640,
  h: 300,
  font: 13,
  device: {x: 30, y: 20, w: 150, h: 260},
  field: {x: 460, y: 20, w: 150, h: 260},
  down: 'M186 108 C 290 108, 350 108, 454 108',
  up: 'M454 212 C 350 212, 290 212, 186 248',
  downLabel: {x: 320, y: 86, lines: ['equipped stats → Collision', '(indexed join)']},
  upLabel: {x: 320, y: 190, lines: ['HitEvent → Progression.AddXp', '(command)']},
};
const NARROW: Layout = {
  w: 340,
  h: 300,
  font: 14.5,
  device: {x: 2, y: 20, w: 120, h: 260},
  field: {x: 218, y: 20, w: 120, h: 260},
  down: 'M126 108 C 160 108, 180 108, 214 108',
  up: 'M214 212 C 180 212, 160 212, 126 248',
  downLabel: {x: 170, y: 84, lines: ['indexed', 'join']},
  upLabel: {x: 170, y: 188, lines: ['AddXp', 'command']},
};

const INVENTORY = ['Sword +12', 'Bow', 'Ring', 'Potion ×3'];

// Deterministic "random" so server and client render the same battlefield.
function rand(seed: number) {
  const x = Math.sin(seed * 999.13) * 43758.5453;
  return x - Math.floor(x);
}
const UNITS = Array.from({length: 34}, (_, i) => ({
  x: rand(i + 1),
  y: rand(i + 101),
  dx: (rand(i + 201) - 0.5) * 12,
  dy: (rand(i + 301) - 0.5) * 12,
  dur: 3 + rand(i + 401) * 4,
  team: i % 3 === 0,
}));

const STEPS: DemoStep[] = [
  {
    id: 'equip',
    label: 'equip the sword (meta)',
    narration:
      "Equipping a sword is an ordinary write to a persistent table: the inventory UI view updates, and the sword's stats are now game state.",
  },
  {
    id: 'fight',
    label: 'the fight reads its stats (core, indexed join)',
    narration:
      "Every frame, the Collision system reads the equipped weapon's stats through an indexed join — persistent state inside the per-frame loop, no copy, 0 B allocated.",
  },
  {
    id: 'xp',
    label: 'a hit grants XP (core → meta, command)',
    narration:
      'A hit is a HitEvent in the frame; after the frame commits it becomes a Progression.AddXp command, and the XP in the inventory UI view goes up.',
  },
];

const SCHEMA: CodeTab[] = [
  {
    name: 'game.conjure',
    lang: 'schema',
    lines: [
      <C>// persistent — the meta</C>,
      <><K>table</K> <T>Inventory</T> {'{ … }'}</>,
      <><K>table</K> <T>Progression</T> {'{ … }'}</>,
      <>{' '}</>,
      <C>// per-frame — the core</C>,
      <><K>ephemeral table</K> <T>Unit</T> {'{ … }'}</>,
      <><K>event table</K> <T>HitEvent</T> {'{ … }'}</>,
      <><K>system</K> <F>Collision</F>(phase: <A>fixed_update</A>)</>,
    ],
  },
];
const COMPILER = ['join Inventory on index in Collision', 'HitEvent → Progression.AddXp after commit'];

function Scene({L, index, className}: {L: Layout; index: number; className: string}) {
  const {device, field} = L;
  return (
    <svg
      className={className}
      viewBox={`0 0 ${L.w} ${L.h}`}
      role="img"
      style={{fontSize: L.font}}
      aria-label="On the left a phone with the inventory: Sword +12 equipped, Bow, Ring, Potion ×3, and the player's XP. On the right a battlefield of units. Equipped weapon stats flow from the inventory into the battlefield's Collision system through an indexed join; a hit flows back as a Progression.AddXp command.">
      {/* The meta UI view */}
      <DeviceFrame x={device.x} y={device.y} width={device.w} height={device.h}>
        <text className={styles.screenTitle} x={12} y={DEVICE_STATUS_H + 16}>
          inventory
        </text>
        {index === 0 && <rect className={styles.rowLit} x={6} y={DEVICE_STATUS_H + 27} width={device.w - 12} height={24} rx={5} />}
        {INVENTORY.map((item, i) => (
          <text key={item} className={styles.item} x={12} y={DEVICE_STATUS_H + 44 + i * 26}>
            {item}
          </text>
        ))}
        <circle className={styles.equipped} cx={device.w - 16} cy={DEVICE_STATUS_H + 40} r={3.5} />
        {index === 2 && <rect className={styles.rowLit} x={6} y={device.h - 40} width={device.w - 12} height={26} rx={5} />}
        <text className={styles.xp} x={12} y={device.h - 22}>
          XP {index >= 2 ? '1,265' : '1,240'}
        </text>
      </DeviceFrame>

      {/* The core: units, and the player's unit carrying the sword */}
      <g transform={`translate(${field.x} ${field.y})`}>
        <rect className={styles.field} width={field.w} height={field.h} rx={10} />
        {UNITS.map((u, i) => (
          <circle
            key={i}
            className={u.team ? styles.unitB : styles.unit}
            cx={8 + u.x * (field.w - 16)}
            cy={8 + u.y * (field.h - 16)}
            r={2.2}
            style={{'--dx': `${u.dx}px`, '--dy': `${u.dy}px`, animationDuration: `${u.dur}s`} as CSSProperties}
          />
        ))}
        <g transform={`translate(${field.w / 2} ${field.h / 2})`}>
          <circle className={clsx(styles.hero, index >= 1 && styles.heroOn)} r={5} />
          {index >= 1 && <circle className={styles.heroRing} r={12} />}
        </g>
      </g>

      {/* The two connections; the active one carries a travelling pulse */}
      <path className={clsx(styles.track, index === 1 && styles.trackOn)} d={L.down} />
      {index === 1 && <path className={styles.pulse} d={L.down} />}
      <path className={clsx(styles.track, index === 2 && styles.trackOn)} d={L.up} />
      {index === 2 && <path className={styles.pulse} d={L.up} />}
      {[L.downLabel, L.upLabel].map((lab, k) => (
        <text key={k} className={clsx(styles.label, index === k + 1 && styles.labelOn)} x={lab.x} y={lab.y} textAnchor="middle">
          {lab.lines.map((line, j) => (
            <tspan key={line} x={lab.x} dy={j ? '1.25em' : 0}>
              {line}
            </tspan>
          ))}
        </text>
      ))}
    </svg>
  );
}

export default function MetaCore(): ReactNode {
  return (
    <div className={styles.root}>
      <DemoStage
        title="meta and core, one schema"
        steps={STEPS}
        costLine="0 B per frame · one planner"
        codeTabs={[
          {id: 'schema', label: 'schema', content: <CodeWindow tabs={SCHEMA} dense />},
          {id: 'compiler', label: 'what the compiler does', content: <CompilerNotes lines={COMPILER} />},
        ]}>
        {({index, run}) => (
          <div key={run} className={styles.stage}>
            <Scene L={WIDE} index={index} className={styles.wide} />
            <Scene L={NARROW} index={index} className={styles.narrow} />
          </div>
        )}
      </DemoStage>
      <p className={styles.proof}>
        Arena sample · 100 000 units · 171 µs per frame on IL2CPP + Burst · 0 B allocated{' '}
        <Link to="/docs/examples/arena-ecs">methodology →</Link>
      </p>
    </div>
  );
}

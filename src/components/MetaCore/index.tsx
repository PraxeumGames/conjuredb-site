import type {CSSProperties, ReactNode} from 'react';
import Link from '@docusaurus/Link';
import {DEVICE_STATUS_H, DeviceFrame} from '@site/src/components/Glyphs';
import styles from './styles.module.css';

// "Meta and core in one architecture": one schema with persistent tables
// (the meta: inventory, progression) and per-frame tables + a system (the
// core: units, hits), and the two connections that cross between them.

type Box = {x: number; y: number; w: number; h: number};
type Layout = {w: number; h: number; card: Box; device: Box; field: Box};

const WIDE: Layout = {
  w: 540,
  h: 330,
  card: {x: 112, y: 5, w: 316, h: 320},
  device: {x: 0, y: 62, w: 100, h: 206},
  field: {x: 440, y: 62, w: 100, h: 206},
};
// Wide claim cards: device | schema | battlefield as three columns (0.8 / 1.4 / 0.8).
const ROW: Layout = {
  w: 760,
  h: 330,
  card: {x: 222, y: 5, w: 316, h: 320},
  device: {x: 46, y: 62, w: 120, h: 206},
  field: {x: 594, y: 62, w: 120, h: 206},
};
const NARROW: Layout = {
  w: 320,
  h: 500,
  card: {x: 2, y: 2, w: 316, h: 320},
  device: {x: 14, y: 338, w: 120, h: 156},
  field: {x: 150, y: 346, w: 165, h: 140},
};

const INVENTORY = ['Sword +12', 'Bow', 'Ring', 'Potion ×3'];

// Deterministic "random" so server and client render the same battlefield.
function rand(seed: number) {
  const x = Math.sin(seed * 999.13) * 43758.5453;
  return x - Math.floor(x);
}
const UNITS = Array.from({length: 40}, (_, i) => ({
  x: rand(i + 1),
  y: rand(i + 101),
  dx: (rand(i + 201) - 0.5) * 14,
  dy: (rand(i + 301) - 0.5) * 14,
  dur: 3 + rand(i + 401) * 4,
  team: i % 3 === 0,
}));
const SHOTS = Array.from({length: 6}, (_, i) => ({y: 0.15 + rand(i + 501) * 0.7, delay: -rand(i + 601) * 2.4}));

function Scene({layout, className}: {layout: Layout; className: string}) {
  const {card, device, field} = layout;
  const tx = card.x + 22; // text column inside the card
  const right = card.x + card.w - 20;
  const gl = card.x + 11; // left gutter: persistent → frame
  const gr = card.x + card.w - 9; // right gutter: frame → persistent
  const y = (n: number) => card.y + n;
  return (
    <svg
      className={className}
      viewBox={`0 0 ${layout.w} ${layout.h}`}
      role="img"
      style={{fontSize: 12.5}}
      aria-label="One game.conjure schema: persistent tables Inventory and Progression for the meta, and per-frame tables Unit and HitEvent with a Collision system for the core. Equipped weapon stats flow down into Collision through an indexed join; HitEvent flows up into Progression.AddXp as a command. On the left a phone shows the inventory; on the right a battlefield of units.">
      {/* The meta UI view */}
      <DeviceFrame x={device.x} y={device.y} width={device.w} height={device.h}>
        <text className={styles.screenTitle} x={12} y={DEVICE_STATUS_H + 14}>
          inventory
        </text>
        {INVENTORY.map((item, i) => (
          <g key={item}>
            <text className={styles.item} x={12} y={DEVICE_STATUS_H + 38 + i * 24}>
              {item}
            </text>
            {i === 0 && <circle className={styles.equipped} cx={device.w - 14} cy={DEVICE_STATUS_H + 34 + i * 24} r={3.5} />}
          </g>
        ))}
        <text className={styles.xp} x={12} y={device.h - 18}>
          XP 1,240
        </text>
      </DeviceFrame>

      {/* The core: units and projectiles */}
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
        {SHOTS.map((s, i) => (
          <line
            key={i}
            className={styles.shot}
            x1={0}
            x2={7}
            y1={s.y * field.h}
            y2={s.y * field.h}
            style={{'--run': `${field.w}px`, animationDelay: `${s.delay}s`} as CSSProperties}
          />
        ))}
      </g>

      {/* The schema */}
      <rect className={styles.card} x={card.x} y={card.y} width={card.w} height={card.h} rx={12} />
      <text className={styles.cardName} x={tx} y={y(24)}>
        game.conjure
      </text>
      <line className={styles.rule} x1={card.x} x2={card.x + card.w} y1={y(36)} y2={y(36)} />

      <text className={styles.group} x={tx} y={y(58)}>
        persistent
      </text>
      <text className={styles.line} x={tx} y={y(80)}>
        <tspan className={styles.kw}>table</tspan> Inventory {'{ … }'}
      </text>
      <text className={styles.line} x={tx} y={y(102)}>
        <tspan className={styles.kw}>table</tspan> Progression {'{ … }'}
      </text>

      <text className={styles.label} x={tx} y={y(136)}>
        equipped weapon stats →
      </text>
      <text className={styles.label} x={tx} y={y(152)}>
        Collision (indexed join)
      </text>
      <text className={styles.label} x={right} y={y(178)} textAnchor="end">
        HitEvent →
      </text>
      <text className={styles.label} x={right} y={y(194)} textAnchor="end">
        Progression.AddXp (command)
      </text>

      <line className={styles.split} x1={card.x + 1} x2={card.x + card.w - 1} y1={y(214)} y2={y(214)} />
      <text className={styles.group} x={tx} y={y(234)}>
        per-frame
      </text>
      <text className={styles.line} x={tx} y={y(256)}>
        <tspan className={styles.kw}>ephemeral table</tspan> Unit {'{ … }'}
      </text>
      <text className={styles.line} x={tx} y={y(278)}>
        <tspan className={styles.kw}>event table</tspan> HitEvent {'{ … }'}
      </text>
      <text className={styles.line} x={tx} y={y(300)}>
        <tspan className={styles.kw}>system</tspan> Collision(phase: fixed_update)
      </text>

      {/* The two connections across the line, as pulses */}
      <path className={styles.track} d={`M${tx - 4} ${y(76)} H${gl} V${y(296)} H${tx - 4}`} />
      <path className={styles.pulseDown} d={`M${tx - 4} ${y(76)} H${gl} V${y(296)} H${tx - 4}`} />
      <path className={styles.arrow} d={`M${tx - 9} ${y(292)} l5 4 l-5 4`} />
      <path className={styles.track} d={`M${right + 6} ${y(274)} H${gr} V${y(98)} H${right + 6}`} />
      <path className={styles.pulseUp} d={`M${right + 6} ${y(274)} H${gr} V${y(98)} H${right + 6}`} />
      <path className={styles.arrow} d={`M${right + 11} ${y(94)} l-5 4 l5 4`} />
    </svg>
  );
}

export default function MetaCore(): ReactNode {
  return (
    <div className={styles.root}>
      <Scene layout={ROW} className={styles.row} />
      <Scene layout={WIDE} className={styles.wide} />
      <Scene layout={NARROW} className={styles.narrow} />
      <p className={styles.facts}>one file · one planner · two storage kinds</p>
      <p className={styles.caption}>
        Persistent tables for the meta, per-frame tables for the core, in the same schema — and a
        planner that joins live frame state to persistent indexes. Normally these are two
        architectures.
      </p>
      <p className={styles.proof}>
        Arena sample · 100 000 units · 171 µs per frame on IL2CPP + Burst · 0 B allocated{' '}
        <Link to="/docs/examples/arena-ecs">methodology →</Link>
      </p>
    </div>
  );
}

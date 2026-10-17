import type {CSSProperties, ReactNode} from 'react';
import clsx from 'clsx';
import DemoStage, {type DemoStep} from '@site/src/components/DemoStage';
import styles from './styles.module.css';

// "Vertical slices": the same four features drawn as a layered monolith
// (each feature smeared across UI · Managers · Services · Data, wired to the
// others at every layer) and as slices (UI view → module → optional systems,
// over a generated floor, with only declared references between them).

type View = 'monolith' | 'slices';
type Action = 'remove' | 'copy' | null;
type FeatureId = 'shop' | 'inv' | 'quests' | 'bp';

const FEATURES: {id: FeatureId; name: string; module: string; screen: string; systems: boolean}[] = [
  {id: 'shop', name: 'Shop', module: 'Shop', screen: 'ShopView', systems: false},
  {id: 'inv', name: 'Inventory', module: 'Inventory', screen: 'InventoryView', systems: false},
  {id: 'quests', name: 'Quests', module: 'Quests', screen: 'QuestView', systems: true},
  {id: 'bp', name: 'Battle pass', module: 'BattlePass', screen: 'BattlePassView', systems: true},
];

// The monolith: each layer holds a fragment of every feature, in no shared order.
const LAYERS: {name: string; frags: [FeatureId, string][]}[] = [
  {name: 'UI', frags: [['shop', 'ShopPresenter'], ['quests', 'QuestPanel'], ['bp', 'BattlePassUI'], ['inv', 'InventoryView']]},
  {name: 'Managers', frags: [['inv', 'InventoryManager'], ['shop', 'ShopManager'], ['quests', 'QuestManager'], ['bp', 'BattlePassManager']]},
  {name: 'Services', frags: [['quests', 'QuestSystem'], ['bp', 'PassService'], ['shop', 'ShopService'], ['inv', 'InventoryService']]},
  {name: 'Data', frags: [['bp', 'PassProgress'], ['quests', 'QuestSave'], ['inv', 'InventoryData'], ['shop', 'ShopData']]},
];
// Cross-feature calls, at every layer.
const WIRES: [string, string][] = [
  ['ShopPresenter', 'InventoryManager'],
  ['BattlePassUI', 'QuestManager'],
  ['QuestPanel', 'ShopManager'],
  ['ShopManager', 'PassService'],
  ['QuestSystem', 'ShopService'],
  ['InventoryService', 'QuestSave'],
  ['PassService', 'InventoryData'],
];
// Declared references between slices: [from, to, how].
const REFS: [FeatureId, FeatureId, string][] = [
  ['shop', 'inv', 'by command'],
  ['quests', 'inv', 'by command'],
  ['bp', 'quests', 'by id'],
  ['bp', 'inv', 'by command'],
];

const MESSAGES: Record<Exclude<Action, null>, string> = {
  remove: '0 files touched elsewhere · 2 declared references resolved at compile time',
  copy: 'same module · rewards now reference Card · prices in Gems · compiler re-checked the joins',
};

type Box = {x: number; y: number; w: number; h: number};
type Layout = {
  w: number;
  h: number;
  font: number;
  narrow: boolean;
  band: (i: number) => Box; // a monolith layer
  layerLabel: (i: number) => {x: number; y: number};
  frag: (layer: number, slot: number) => Box;
  caption: {x: number; y: number; lines: string[]};
  col: (i: number) => {x: number; y: number; w: number}; // a slice column origin
  slice: {name: number; screen: [number, number]; module: [number, number]; systems: [number, number]};
  floor: Box;
  rowLabels?: boolean;
  refPath: (from: number, to: number) => {d: string; lx: number; ly: number};
  copy: {frame: Box; col: {x: number; y: number; w: number}};
};

const WIDE: Layout = {
  w: 760,
  h: 360,
  font: 13,
  narrow: false,
  band: (i) => ({x: 84, y: 4 + i * 80, w: 676, h: 70}),
  layerLabel: (i) => ({x: 0, y: 4 + i * 80 + 40}),
  frag: (_, slot) => ({x: 92 + slot * 168, y: 0, w: 152, h: 32}),
  caption: {x: 380, y: 348, lines: ['a feature is a horizontal smear; removing one leaves holes in four layers']},
  col: (i) => ({x: 90 + i * 170, y: 0, w: 150}),
  slice: {name: 70, screen: [80, 52], module: [140, 118], systems: [266, 32]},
  floor: {x: 90, y: 310, w: 660, h: 38},
  rowLabels: true,
  refPath: (from, to) => {
    const cx = (i: number) => 165 + i * 170;
    const a = cx(from) + (from > to ? -14 : 14);
    const b = cx(to) + (from > to ? 14 + (Math.abs(from - to) - 1) * 18 : -14);
    const mid = (a + b) / 2;
    // Adjacent references arc low; the one that skips a column arcs over them.
    const long = Math.abs(from - to) > 1;
    return {d: `M${a} 56 Q${mid} ${long ? -36 : 20} ${b} 56`, lx: mid, ly: long ? 10 : 38};
  },
  copy: {frame: {x: 584, y: 24, w: 176, h: 322}, col: {x: 597, y: 0, w: 150}},
};

const NARROW: Layout = {
  w: 340,
  h: 500,
  font: 12.5,
  narrow: true,
  band: (i) => ({x: 0, y: 18 + i * 112, w: 340, h: 86}),
  layerLabel: (i) => ({x: 2, y: 12 + i * 112}),
  frag: (_, slot) => ({x: 8 + (slot % 2) * 166, y: Math.floor(slot / 2) * 38 - 30, w: 158, h: 30}),
  caption: {x: 170, y: 470, lines: ['a feature is a horizontal smear;', 'removing one leaves holes in four layers']},
  col: (i) => ({x: 6 + (i % 2) * 182, y: 16 + Math.floor(i / 2) * 236, w: 152}),
  slice: {name: 12, screen: [20, 38], module: [66, 102], systems: [176, 28]},
  floor: {x: 6, y: 460, w: 328, h: 34},
  refPath: (from, to) => {
    // Grid: Shop (0,0) · Inventory (1,0) / Quests (0,1) · Battle pass (1,1)
    const key = `${from}-${to}`;
    if (key === '0-1') return {d: 'M70 24 H184', lx: 128, ly: 24};
    if (key === '3-2') return {d: 'M188 260 H100', lx: 136, ly: 260};
    if (key === '3-1') return {d: 'M300 232 V188', lx: 300, ly: 214};
    return {d: 'M70 238 L196 188', lx: 120, ly: 214}; // Quests → Inventory
  },
  // No room to the right: Project B takes the lower row's place.
  copy: {frame: {x: 0, y: 238, w: 340, h: 214}, col: {x: 6, y: 266, w: 152}},
};

const fragBox = (L: Layout, layer: number, slot: number): Box => {
  const band = L.band(layer);
  const f = L.frag(layer, slot);
  return L.narrow ? {...f, y: band.y + 44 + f.y} : {...f, y: band.y + 19};
};
const fragAt = (L: Layout, label: string) => {
  for (let l = 0; l < LAYERS.length; l++) {
    const s = LAYERS[l].frags.findIndex(([, n]) => n === label);
    if (s >= 0) return fragBox(L, l, s);
  }
  throw new Error(label);
};

function Monolith({L}: {L: Layout}) {
  return (
    <g className={styles.mono}>
      {LAYERS.map((layer, i) => {
        const b = L.band(i);
        const lab = L.layerLabel(i);
        return (
          <g key={layer.name}>
            <rect className={styles.band} x={b.x} y={b.y} width={b.w} height={b.h} rx={8} />
            <text className={styles.layerName} x={lab.x} y={lab.y} dominantBaseline={L.narrow ? undefined : 'middle'}>
              {layer.name}
            </text>
          </g>
        );
      })}
      {LAYERS.map((layer, l) =>
        layer.frags.map(([id, label], s) => {
          const b = fragBox(L, l, s);
          return (
            <g key={label}>
              <rect className={clsx(styles.frag, styles[id])} x={b.x} y={b.y} width={b.w} height={b.h} rx={6} />
              <text className={styles.fragText} x={b.x + b.w / 2} y={b.y + b.h / 2} textAnchor="middle" dominantBaseline="central">
                {label}
              </text>
            </g>
          );
        }),
      )}
      {WIRES.map(([a, b]) => {
        const p = fragAt(L, a);
        const q = fragAt(L, b);
        const same = Math.abs(p.y - q.y) < 1;
        const d = same
          ? `M${p.x + p.w / 2} ${p.y + p.h} C${p.x + p.w / 2} ${p.y + p.h + 18} ${q.x + q.w / 2} ${q.y + q.h + 18} ${q.x + q.w / 2} ${q.y + q.h}`
          : `M${p.x + p.w / 2 + 10} ${p.y + p.h} L${q.x + q.w / 2 - 10} ${q.y}`;
        return (
          <g key={a + b}>
            <path className={styles.wire} d={d} />
            <circle className={styles.wireEnd} cx={same ? q.x + q.w / 2 : q.x + q.w / 2 - 10} cy={same ? q.y + q.h : q.y} r={2.4} />
          </g>
        );
      })}
      {L.caption.lines.map((line, i) => (
        <text key={line} className={styles.caption} x={L.caption.x} y={L.caption.y + i * 17} textAnchor="middle">
          {line}
        </text>
      ))}
    </g>
  );
}

function Column({L, i, at, art}: {L: Layout; i: number; at?: {x: number; y: number; w: number}; art?: boolean}) {
  const f = FEATURES[i];
  const c = at ?? L.col(i);
  const s = L.slice;
  const lx = c.x + 10;
  const mod = c.y + s.module[0];
  const lineGap = L.narrow ? 18 : 21;
  return (
    <g>
      <text className={styles.colName} x={L.narrow ? c.x : c.x + c.w / 2} y={c.y + s.name} textAnchor={L.narrow ? 'start' : 'middle'}>
        {f.name}
      </text>
      <rect className={clsx(styles.screen, art && styles.newArt)} x={c.x} y={c.y + s.screen[0]} width={c.w} height={s.screen[1]} rx={7} />
      <text className={styles.screenName} x={lx} y={c.y + s.screen[0] + (L.narrow ? 16 : 21)}>
        {f.screen}
      </text>
      <text className={styles.small} x={lx} y={c.y + s.screen[0] + (L.narrow ? 31 : 39)}>
        {art ? 'new UI art' : 'binds view model'}
      </text>
      <rect className={styles.module} x={c.x} y={mod} width={c.w} height={s.module[1]} rx={8} />
      <text className={styles.code} x={lx} y={mod + (L.narrow ? 20 : 24)}>
        <tspan className={styles.kw}>module</tspan> {f.module} {'{'}
      </text>
      {['tables', 'commands', 'reactive query'].map((t, k) => (
        <text key={t} className={styles.code} x={lx + 12} y={mod + (L.narrow ? 20 : 24) + (k + 1) * lineGap}>
          {t}
        </text>
      ))}
      <text className={styles.code} x={lx} y={mod + (L.narrow ? 20 : 24) + 4 * lineGap}>
        {'}'}
      </text>
      {art && (
        <text
          className={styles.override}
          x={L.narrow ? c.x + c.w + 14 : lx}
          y={L.narrow ? mod + s.module[1] / 2 : c.y + s.systems[0] + s.systems[1] / 2}
          dominantBaseline="central">
          → Card · Gems
        </text>
      )}
      {f.systems && (
        <>
          <rect className={styles.systems} x={c.x} y={c.y + s.systems[0]} width={c.w} height={s.systems[1]} rx={6} />
          <text className={styles.small} x={lx} y={c.y + s.systems[0] + s.systems[1] / 2} dominantBaseline="central">
            systems
          </text>
        </>
      )}
    </g>
  );
}

function Slices({L, action}: {L: Layout; action: Action}) {
  const copying = action === 'copy';
  // Wide: the project shrinks to make room. Narrow: the lower row steps aside.
  const aside = (id: FeatureId) => copying && L.narrow && (id === 'quests' || id === 'bp');
  return (
    <g className={styles.slices}>
      <g className={clsx(styles.project, copying && !L.narrow && styles.shrunk)}>
        {L.rowLabels && (
          <>
            <text className={styles.rowLabel} x={0} y={L.slice.screen[0] + 30}>
              UI view
            </text>
            <text className={styles.rowLabel} x={0} y={L.slice.module[0] + 62}>
              module
            </text>
            <text className={styles.rowLabel} x={0} y={L.slice.systems[0] + 20}>
              systems
            </text>
          </>
        )}
        {REFS.map(([a, b, how]) => {
          const from = FEATURES.findIndex((f) => f.id === a);
          const to = FEATURES.findIndex((f) => f.id === b);
          const p = L.refPath(from, to);
          const w = how.length * L.font * 0.56 + 12;
          return (
            <g key={a + b} className={clsx(styles.lift, a === 'bp' && action === 'remove' && styles.lifted, aside(a) && styles.aside)}>
              <path className={styles.ref} d={p.d} />
              <rect className={styles.refPill} x={p.lx - w / 2} y={p.ly - 9} width={w} height={18} rx={9} />
              <text className={styles.refText} x={p.lx} y={p.ly} textAnchor="middle" dominantBaseline="central">
                {how}
              </text>
            </g>
          );
        })}
        {FEATURES.map((f, i) => (
          <g key={f.id} className={clsx(styles.lift, f.id === 'bp' && action === 'remove' && styles.lifted, aside(f.id) && styles.aside)}>
            <Column L={L} i={i} />
          </g>
        ))}
        <rect className={styles.floor} x={L.floor.x} y={L.floor.y} width={L.floor.w} height={L.floor.h} rx={8} />
        {/* Narrow: the floor label takes two lines to stay ≥ 11px. */}
        {(L.narrow
          ? ['generated: storage · indexes', 'view models · server side']
          : ['generated: storage · indexes · view models · server side']
        ).map((line, i, all) => (
          <text
            key={line}
            className={styles.floorText}
            x={L.floor.x + L.floor.w / 2}
            y={L.floor.y + L.floor.h / 2 + (i - (all.length - 1) / 2) * 14}
            textAnchor="middle"
            dominantBaseline="central">
            {line}
          </text>
        ))}
      </g>
      <g className={clsx(styles.projectB, copying && styles.shown)} aria-hidden={!copying}>
          <rect className={styles.frameB} x={L.copy.frame.x} y={L.copy.frame.y} width={L.copy.frame.w} height={L.copy.frame.h} rx={10} />
          <text className={styles.frameTitle} x={L.copy.frame.x + 12} y={L.copy.frame.y + 20}>
            Project B
          </text>
          <Column L={L} i={0} at={L.copy.col} art />
          {L.narrow ? (
            <text className={styles.small} x={L.copy.frame.x + L.copy.frame.w - 12} y={L.copy.frame.y + 20} textAnchor="end">
              same module
            </text>
          ) : (
            <>
              <rect className={styles.floor} x={L.copy.col.x} y={L.floor.y} width={L.copy.col.w} height={L.floor.h} rx={8} />
              <text className={styles.floorText} x={L.copy.col.x + L.copy.col.w / 2} y={L.floor.y + L.floor.h / 2} textAnchor="middle" dominantBaseline="central">
                generated
              </text>
            </>
          )}
      </g>
    </g>
  );
}

function Scene({L, view, action, className}: {L: Layout; view: View; action: Action; className: string}) {
  return (
    <svg
      className={clsx(className, view === 'slices' ? styles.isSlices : styles.isMono, action === 'remove' && styles.isRemoved)}
      viewBox={`0 0 ${L.w} ${L.h}`}
      style={{fontSize: L.font} as CSSProperties}
      role="img"
      aria-label={
        view === 'monolith'
          ? 'Today: a game client in four layers — UI, Managers, Services, Data. Shop, Quests, Battle pass and Inventory each have a piece in every layer, and red calls cross between features at every layer.'
          : 'With Conjure: Shop, Inventory, Quests and Battle pass as vertical columns — a UI view bound to a view model, a schema module with tables, commands and a reactive query, and optional systems — over a generated floor of storage, indexes, view models and server side. Only dotted references by id or by command connect them.'
      }>
      <Monolith L={L} />
      <Slices L={L} action={action} />
    </svg>
  );
}

const STEPS: DemoStep[] = [
  {
    id: 'monolith',
    label: 'today: a monolith',
    alt: true,
    narration:
      'Today: four layers, and every feature smeared across all of them, wired to the others at every layer. Removing one leaves holes in four layers.',
  },
  {
    id: 'slices',
    label: 'with slices',
    narration:
      'With slices, each feature is one column — UI view, module, optional systems — over a generated floor. Only declared references cross between them.',
  },
  {
    id: 'remove',
    label: 'remove Battle pass',
    narration: 'Remove Battle pass and the other three stay whole: nothing else is edited, and its two references are checked by the compiler.',
  },
  {
    id: 'copy',
    label: 'copy Shop to another game',
    narration: 'Copy Shop to another game and point it at that game’s model: rewards now reference Card, prices are in Gems, and the compiler re-checks the joins.',
  },
];
const COST: Record<string, string> = {
  monolith: `${WIRES.length} cross-feature calls across 4 layers`,
  slices: `${REFS.length} declared references · by id or by command`,
  remove: MESSAGES.remove,
  copy: MESSAGES.copy,
};

export default function MonolithVsSlices(): ReactNode {
  return (
    <div className={styles.root}>
      <DemoStage title="four features, two shapes" steps={STEPS} costLine={({step}) => COST[step]}>
        {({step}) => {
          const view: View = step === 'monolith' ? 'monolith' : 'slices';
          const action: Action = step === 'remove' ? 'remove' : step === 'copy' ? 'copy' : null;
          return (
            <>
              <Scene L={WIDE} view={view} action={action} className={styles.wide} />
              <Scene L={NARROW} view={view} action={action} className={styles.narrow} />
            </>
          );
        }}
      </DemoStage>
    </div>
  );
}

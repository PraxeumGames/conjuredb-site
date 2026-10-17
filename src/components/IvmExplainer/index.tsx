import {useState, type CSSProperties, type ReactNode} from 'react';
import clsx from 'clsx';
import {DEVICE_STATUS_H, DeviceFrame} from '@site/src/components/Glyphs';
import {CodeWindow, F, K, N, T, type CodeTab} from '@site/src/components/CodeWindow';
import DemoStage, {CompilerNotes, Sweep, type DemoStep} from '@site/src/components/DemoStage';
import styles from './styles.module.css';

// One event, three mechanisms, in the DemoStage shell: a leaderboard UI view
// kept current by rebuilding every frame, by re-running the query on every
// event (Rx-style), or by pushing the change through the query's own
// maintainers (IVM). Maintainer names follow docs/advanced/reactive-queries.md.

type Mode = 'rebuild' | 'rx' | 'ivm';
type EventId = 'levelup' | 'rename' | 'leave';
type Player = {id: string; name: string; level: number; guild: number};

const BASE: Player[] = [
  {id: 'aria', name: 'Aria', level: 60, guild: 1},
  {id: 'bo', name: 'Bo', level: 58, guild: 2},
  {id: 'cyn', name: 'Cyn', level: 57, guild: 3},
  {id: 'p7', name: 'Player 7', level: 56, guild: 1},
  {id: 'dax', name: 'Dax', level: 55, guild: 3},
  {id: 'eli', name: 'Eli', level: 53, guild: 2},
  {id: 'fen', name: 'Fen', level: 50, guild: 1},
  {id: 'gus', name: 'Gus', level: 49, guild: 3},
  {id: 'hal', name: 'Hal', level: 49, guild: 2},
  {id: 'ivo', name: 'Ivo', level: 49, guild: 1},
  // below the cut: kept in the Top-K state as the next candidates
  {id: 'jun', name: 'Jun', level: 48, guild: 2},
  {id: 'p42', name: 'Player 42', level: 48, guild: 2},
];
const GUILDS: Record<number, string> = {1: 'Ravens', 2: 'Wolves', 3: 'Owls'};

function top10(ev: EventId | null) {
  let players = BASE.map((p) => ({...p}));
  const guilds = {...GUILDS};
  if (ev === 'levelup') players = players.map((p) => (p.id === 'p42' ? {...p, level: 51} : p));
  if (ev === 'leave') players = players.filter((p) => p.id !== 'p7');
  if (ev === 'rename') guilds[3] = 'Strix';
  return [...players]
    .sort((a, b) => b.level - a.level || a.name.localeCompare(b.name))
    .slice(0, 10)
    .map((p) => ({...p, guildName: guilds[p.guild]}));
}
const BEFORE = top10(null);

const EVENTS: {id: EventId; label: string}[] = [
  {id: 'levelup', label: 'Player 42 levels up'},
  {id: 'rename', label: 'Guild 3 renamed'},
  {id: 'leave', label: 'Player 7 leaves'},
];

const NARRATION: Record<Mode, Record<EventId, string>> = {
  rebuild: {
    levelup:
      'Every frame the query runs again over 10 000 rows: the level-up is picked up on the next frame, at the same cost as a frame with no change.',
    rename: 'The rename costs nothing extra — because every frame already pays the full price.',
    leave: 'Player 7 leaves and the next rebuild drops the row. Between events, 60 times a second, the work is the same.',
  },
  rx: {
    levelup:
      'The level-up fires an event, and every subscriber re-runs the whole query — 10 000 rows scanned, sorted and cut to ten — to change two rows.',
    rename: 'One guild name changes, and the query runs again from scratch, once per subscriber.',
    leave: 'A player leaves: another full re-run per subscriber. The cost follows the table, not the change.',
  },
  ivm: {
    levelup:
      'The level-up travels as one delta: probe one guild, compare with the cut-off, insert at #7. Two rows of the result change; nothing else is touched.',
    rename: "One key changes in the join's arrangement and three rows get the new name. Nothing is re-sorted.",
    leave: 'The row is retracted and the Top-K state promotes the next candidate it already kept. Two rows change.',
  },
};

// The chain, collapsed (source → maintainers → result) or expanded (five operators).
type Box = {name: string; sub: string};
const COLLAPSED: Box[] = [
  {name: 'source', sub: 'Players · 10 000 rows'},
  {name: 'maintainers', sub: 'join · sort · take 10'},
  {name: 'result', sub: 'TopPlayers · 10 rows'},
];
const EXPANDED: Box[] = [
  {name: 'Players', sub: '10 000 rows'},
  {name: 'join Guilds', sub: 'arrangement'},
  {name: 'sort −Level', sub: 'sorted state'},
  {name: 'take 10', sub: 'Top-K state'},
  {name: 'TopPlayers', sub: 'materialized · 10 rows'},
];
const RX = {collapsed: ['scan 10 000', '10 000 probes · sort · top 10', 'rebuilt · 10 rows'], expanded: ['scan 10 000', '10 000 probes', 'sort 10 000', 'top 10', 'rebuilt · 10 rows']};
const STATUS: Record<'ivm' | 'rx', Record<EventId, {collapsed: string[]; expanded: string[]}>> = {
  ivm: {
    levelup: {
      collapsed: ['1 row changed', 'probe 1 key · insert at #7, evict #10', '2 rows changed'],
      expanded: ['1 row changed', 'probe 1 key → 1 row', 'compare with the cut-off', 'insert at #7, evict #10', '2 rows changed'],
    },
    rename: {
      collapsed: ['0 rows', '1 key changed → 3 matching rows', '3 rows changed'],
      expanded: ['0 rows', '1 key changed → 3 rows', 'order unchanged', 'no change', '3 rows changed'],
    },
    leave: {
      collapsed: ['1 row removed', 'retract 1 · promote the next candidate', '2 rows changed'],
      expanded: ['1 row removed', 'retract 1', '—', 'promote the next candidate', '2 rows changed'],
    },
  },
  rx: {levelup: RX, rename: RX, leave: RX},
};

// Steady-state load per frame: 10 000 rows, 5 changes, 2 subscribers. The bar
// is one frame's budget, linear in rows evaluated; rebuilding the result fills it.
const BUDGET_ROWS = 10010;
const FRAME: Record<Mode, {rows: number; text: string}> = {
  rebuild: {rows: 10010, text: '10 000 rows + redraw 10, every frame, even with 0 changes'},
  rx: {rows: 100000, text: '10 000 × 2 subscribers × 5 changes = 100 000 rows per frame'},
  ivm: {rows: 15, text: '≈ 3 rows × 5 changes = 15 rows per frame'},
};

const SCHEMA: CodeTab[] = [
  {
    name: 'leaderboard.conjure',
    lang: 'schema',
    lines: [
      <><K>reactive query</K> <F>TopPlayers</F>() -&gt; <T>LeaderboardRow</T>[] {'{'}</>,
      <>    <K>from</K> <T>Players</T></>,
      <>    | <K>join</K> <T>Guilds</T> g (GuildId == g.Id)</>,
      <>    | <K>sort</K> {'{'} -Level, Name {'}'}</>,
      <>    | <K>take</K> <N>10</N></>,
      <>    | <K>select</K> {'{ … }'}</>,
      <>{'}'}</>,
    ],
  },
];
const COMPILER = [
  'join arrangement on Guilds, keyed by Id',
  'sorted Top-K state that keeps the next candidates',
  'a materialized result, consistent once per commit',
];
const NUMBERS = [
  '10 000 rows · 60 fps · 5 changes per frame',
  '600 000 row evaluations per second re-querying, 300 with IVM',
  'rebuild every frame: 600 000 with zero changes',
];

function Budget({mode}: {mode: Mode}) {
  const f = FRAME[mode];
  const over = f.rows > BUDGET_ROWS;
  return (
    <span className={clsx(styles.budget, mode !== 'ivm' && styles.red)}>
      <span className={clsx(styles.track, over && styles.trackOver)} aria-hidden="true">
        <span style={over ? undefined : {width: `max(3px, ${(f.rows / BUDGET_ROWS) * 100}%)`}} />
      </span>
      <span className={styles.budgetText}>
        frame budget · {f.text}
        {over && <span className={styles.overTag}>over budget</span>}
      </span>
    </span>
  );
}

function Leaderboard({ev, mode, run}: {ev: EventId; mode: Mode; run: string}) {
  const rows = top10(ev);
  const changed = new Set(
    rows
      .filter((r, i) => {
        const b = BEFORE.find((x) => x.id === r.id);
        return !b || b.guildName !== r.guildName || BEFORE.indexOf(b) !== i;
      })
      .map((r) => r.id),
  );
  const W = 230;
  const H = 400;
  const top = DEVICE_STATUS_H + 48;
  const rowH = 30;
  return (
    <svg
      className={styles.device}
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      style={{fontSize: 12.5}}
      aria-label={`Leaderboard: ${rows.map((r, i) => `${i + 1}. ${r.name}, level ${r.level}, ${r.guildName}`).join('; ')}.`}>
      <DeviceFrame x={1} y={1} width={W - 2} height={H - 2}>
        <text className={styles.screenTitle} x={14} y={DEVICE_STATUS_H + 22}>
          Top players
        </text>
        {/* Rebuild: a faint band travelling down the list — redrawn every frame, never a flash. */}
        {mode === 'rebuild' && <rect className={styles.shimmer} x={6} y={top - 20} width={W - 14} height={rowH * 2} rx={6} />}
        {rows.map((r, i) => {
          const y = top + i * rowH;
          const hit = mode === 'ivm' ? changed.has(r.id) : mode === 'rx';
          return (
            <g key={r.id}>
              {hit && <rect key={run} className={clsx(styles.flash, mode === 'rx' && styles.flashRed)} x={6} y={y - 19} width={W - 14} height={rowH - 4} rx={5} />}
              <text className={clsx(styles.rank, mode === 'ivm' && changed.has(r.id) && styles.gold)} x={14} y={y}>
                {i + 1}
              </text>
              <text className={styles.name} x={36} y={y}>
                {r.name}
              </text>
              <text className={styles.lvl} x={150} y={y} textAnchor="end">
                {r.level}
              </text>
              <text className={styles.guild} x={W - 16} y={y} textAnchor="end">
                {r.guildName}
              </text>
            </g>
          );
        })}
      </DeviceFrame>
    </svg>
  );
}

function Chain({ev, mode, expanded}: {ev: EventId; mode: Mode; expanded: boolean}) {
  const boxes = expanded ? EXPANDED : COLLAPSED;
  const statuses =
    mode === 'rebuild'
      ? boxes.map((_, i) => (i === 0 ? 'scan 10 000' : i === boxes.length - 1 ? 'rebuilt · 10 rows' : 're-run'))
      : STATUS[mode][ev][expanded ? 'expanded' : 'collapsed'];
  return (
    <ol className={clsx(styles.chain, mode !== 'ivm' && styles.chainRed)}>
      {boxes.map((b, i) => (
        <li key={b.name} className={styles.box} style={{'--i': i} as CSSProperties}>
          <span className={styles.boxHead}>
            <span className={styles.boxName}>{b.name}</span>
            <span className={styles.boxSub}>{b.sub}</span>
          </span>
          <span className={styles.boxStatus}>{statuses[i]}</span>
        </li>
      ))}
    </ol>
  );
}

export default function IvmExplainer(): ReactNode {
  const [mode, setMode] = useState<Mode>('ivm');
  const [expanded, setExpanded] = useState(false);
  const steps: DemoStep[] = EVENTS.map((e) => ({id: e.id, label: e.label, narration: NARRATION[mode][e.id]}));
  return (
    <div className={styles.wrap}>
    <DemoStage
      title="one event, three mechanisms"
      manual
      modes={[
        {id: 'rebuild', label: 'rebuild every frame'},
        {id: 'rx', label: 'Rx · re-query'},
        {id: 'ivm', label: 'IVM · delta'},
      ]}
      mode={mode}
      onMode={(m) => setMode(m as Mode)}
      steps={steps}
      narrowColumns={1}
      stageMinHeight={{wide: '27rem'}}
      costLine={<Budget mode={mode} />}
      codeTabs={[
        {id: 'schema', label: 'schema', content: <CodeWindow tabs={SCHEMA} dense />},
        {id: 'compiler', label: 'what the compiler does', content: <CompilerNotes lines={COMPILER} />},
        {id: 'numbers', label: 'numbers', content: <CompilerNotes lines={NUMBERS} />},
      ]}>
      {({step, run, live}) => (
        <div className={clsx(styles.stage, styles[mode], live && styles.live)}>
          <Leaderboard ev={step as EventId} mode={mode} run={`${run}-${step}-${mode}`} />
          <div className={styles.side}>
            {mode === 'rebuild' && <Sweep label="re-running every frame · 10 000 rows, 0 changes" />}
            <Chain key={`${run}-${step}-${mode}-${expanded}`} ev={step as EventId} mode={mode} expanded={expanded} />
            <button type="button" className={styles.toggle} aria-pressed={expanded} onClick={() => setExpanded((x) => !x)}>
              {expanded ? '− hide operators' : '+ show operators'}
            </button>
          </div>
        </div>
      )}
    </DemoStage>
    </div>
  );
}

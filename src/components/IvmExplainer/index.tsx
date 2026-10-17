import {useEffect, useRef, useState, type CSSProperties, type ReactNode} from 'react';
import clsx from 'clsx';
import styles from './styles.module.css';

// Incremental view maintenance, step by step: the same event pushed through
// the query's own operators as a delta (IVM), versus re-running the query for
// every subscriber on each event (Rx-style), versus rebuilding the result every
// frame. Maintainer names follow docs/advanced/reactive-queries.md: join
// arrangements, sorted Top-K state.

type Mode = 'rebuild' | 'rx' | 'ivm';
const MODES: {id: Mode; label: string}[] = [
  {id: 'rebuild', label: 'rebuild every frame'},
  {id: 'rx', label: 'Rx · re-query on event'},
  {id: 'ivm', label: 'IVM · delta'},
];
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

type EventId = 'levelup' | 'rename' | 'leave' | 'batch';
const EVENTS: {id: EventId; label: string}[] = [
  {id: 'levelup', label: 'Player 42: level 48 → 51'},
  {id: 'rename', label: 'Guild 3 renamed'},
  {id: 'leave', label: 'Player 7 leaves'},
];
const BATCH_LABEL = 'Player 42 level-up + Player 7 leaves, one commit';

type World = {players: Player[]; guilds: Record<number, string>};
function apply(ev: EventId | null): World {
  let players = BASE.map((p) => ({...p}));
  const guilds = {...GUILDS};
  if (ev === 'levelup' || ev === 'batch') players = players.map((p) => (p.id === 'p42' ? {...p, level: 51} : p));
  if (ev === 'leave' || ev === 'batch') players = players.filter((p) => p.id !== 'p7');
  if (ev === 'rename') guilds[3] = 'Strix';
  return {players, guilds};
}
function top10(w: World) {
  return [...w.players]
    .sort((a, b) => b.level - a.level || a.name.localeCompare(b.name))
    .slice(0, 10)
    .map((p) => ({...p, guildName: w.guilds[p.guild]}));
}

const OPS = [
  {name: 'Players', sub: '10 000 rows'},
  {name: 'join Guilds', sub: 'arrangement'},
  {name: 'sort −Level', sub: ''},
  {name: 'take 10', sub: 'Top-K state'},
  {name: 'TopPlayers', sub: 'materialized · 10 rows'},
];

type Story = {ops: string[]; subs: [string, string]};
const IVM: Record<EventId, Story> = {
  levelup: {
    ops: ['1 row changed', 'probe 1 key → 1 row', 'compare with boundary (level 49)', 'insert at #7, evict #10', '2 rows changed'],
    subs: ['Add · Player 42 at #7 · Remove · #10', '— (no change)'],
  },
  rename: {
    ops: ['0 rows', '1 key changed → 3 matching rows', 'order unchanged', 'no change', '3 rows changed'],
    subs: ['Replace ×3', 'Replace · name'],
  },
  leave: {
    ops: ['1 row removed', 'retract 1', '—', 'Remove #4 → promote next candidate from Top-K state', '2 rows changed'],
    subs: ['Remove · #4 · Add · Jun at #10', '— (no change)'],
  },
  batch: {
    ops: ['2 rows changed', 'probe 1 key, retract 1', 'compare with boundary (level 49)', 'insert at #6, remove #4', '2 rows changed · 1 consistent batch'],
    subs: ['Add · Player 42 at #6 · Remove · Player 7', '— (no change)'],
  },
};
const REBUILD: Story = {
  ops: ['scan 10 000', '10 000 probes', 'sort 10 000', 'top 10', 'rebuilt · every frame'],
  subs: ['redraw 10 rows · every frame', 'redraw · every frame'],
};
const REQUERY: Story = {
  ops: ['scan 10 000', '10 000 probes', 'sort 10 000', 'top 10', 'rebuilt · 10 rows'],
  subs: ['re-ran query · 10 rows', 're-ran query · 10 rows'],
};
const REQUERY_BATCH: Story = {
  ops: ['scan 10 000 ×2', '10 000 probes ×2', 'sort 10 000 ×2', 'top 10 ×2', 'rebuilt twice · 10 rows'],
  subs: ['re-ran query ×2 · 10 rows each', 're-ran query ×2 · 10 rows each'],
};

const HOP_MS = 250;

// Steady-state load: 10 000 rows, 5 changes per frame, 2 subscribers.
// The bar is one frame's budget, linear in rows evaluated; rebuilding the
// whole result fills it.
const BUDGET_ROWS = 10010;
const FRAME: Record<Mode, {rows: number; text: string; alloc: string; allocFull: boolean}> = {
  rebuild: {rows: 10010, text: '10 000 rows + redraw 10 rows, every frame, even with 0 changes', alloc: 'every frame', allocFull: true},
  rx: {rows: 100000, text: '10 000 × 2 subscribers × 5 changes = 100 000 rows per frame', alloc: 'every re-run', allocFull: true},
  ivm: {rows: 15, text: '≈ 3 rows × 5 changes = 15 rows per frame', alloc: '0 on the maintained path', allocFull: false},
};

export default function IvmExplainer(): ReactNode {
  const [mode, setMode] = useState<Mode>('ivm');
  const [batch, setBatch] = useState(false);
  const [ev, setEv] = useState<EventId | null>(null);
  const [hop, setHop] = useState(-1); // which operator the delta has reached; 5 = done
  const [flashes, setFlashes] = useState(0); // re-query: how many times the table has flashed
  const reduced = useRef(false);
  const timers = useRef<number[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);
  const autoPlayed = useRef(false);

  const clear = () => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  };
  useEffect(() => clear, []);

  const run = (id: EventId, m: Mode = mode) => {
    clear();
    setEv(id);
    setFlashes(0);
    if (reduced.current) {
      setHop(5);
      setFlashes(id === 'batch' && m === 'rx' ? 2 : 1);
      return;
    }
    if (m === 'rebuild') {
      // The chain is already running every frame; the event just lands in it.
      setHop(5);
      setFlashes(1);
      return;
    }
    if (m === 'rx') {
      // Every operator runs in full, for every subscriber, at once.
      setHop(5);
      setFlashes(1);
      if (id === 'batch') timers.current.push(window.setTimeout(() => setFlashes(2), 1100));
      return;
    }
    setHop(0);
    for (let i = 1; i <= 5; i++) timers.current.push(window.setTimeout(() => setHop(i), i * HOP_MS));
    timers.current.push(window.setTimeout(() => setFlashes(1), 5 * HOP_MS));
  };

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      reduced.current = true;
      autoPlayed.current = true;
      setEv('levelup');
      setHop(5);
      setFlashes(1);
    }
  }, []);

  // Play the first event once, when the explainer scrolls into view.
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting && !autoPlayed.current) {
          autoPlayed.current = true;
          io.disconnect();
          run('levelup', 'ivm');
        }
      },
      {threshold: 0.4},
    );
    io.observe(el);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pickMode = (m: Mode) => {
    setMode(m);
    if (ev) run(ev, m);
  };
  const pickBatch = (b: boolean) => {
    setBatch(b);
    clear();
    setEv(null);
    setHop(-1);
    setFlashes(0);
  };

  const rebuild = mode === 'rebuild';
  const story: Story | null = rebuild ? REBUILD : !ev ? null : mode === 'ivm' ? IVM[ev] : ev === 'batch' ? REQUERY_BATCH : REQUERY;
  const done = hop >= 5;
  const before = top10(apply(null));
  // Re-query on a batch shows the intermediate state between the two runs.
  const intermediate = mode === 'rx' && ev === 'batch' && flashes === 1;
  const after = !ev || !done ? before : top10(apply(intermediate ? 'levelup' : ev));
  const changedIds = new Set(
    after.filter((r, i) => {
      const b = before.find((x) => x.id === r.id);
      return !b || b.guildName !== r.guildName || before.indexOf(b) !== i;
    }).map((r) => r.id),
  );
  const newIds = new Set(after.filter((r) => !before.some((b) => b.id === r.id)).map((r) => r.id));
  const removed = done && mode === 'ivm' ? before.filter((b) => !after.some((r) => r.id === b.id)) : [];
  const frame = FRAME[mode];
  const over = frame.rows > BUDGET_ROWS;
  const budgetWidth = over ? undefined : `max(3px, ${(frame.rows / BUDGET_ROWS) * 100}%)`;

  return (
    <div ref={rootRef} className={clsx(styles.root, mode !== 'ivm' && styles.requery)}>
      <div className={styles.top}>
        <pre className={styles.query}>
          <span className={styles.kw}>reactive query</span> TopPlayers() -&gt; LeaderboardRow[] {'{'}
          {'\n'}    <span className={styles.kw}>from</span> Players
          {'\n'}    | <span className={styles.kw}>join</span> Guilds g (GuildId == g.Id)
          {'\n'}    | <span className={styles.kw}>sort</span> {'{'} -Level, Name {'}'}
          {'\n'}    | <span className={styles.kw}>take</span> 10
          {'\n'}    | <span className={styles.kw}>select</span> {'{ … }'}
          {'\n'}{'}'}
        </pre>
        <div className={styles.switches}>
          <div className={styles.seg} role="group" aria-label="Mechanism">
            {MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                aria-pressed={mode === m.id}
                className={clsx(mode === m.id && (m.id === 'ivm' ? styles.on : styles.onRed))}
                onClick={() => pickMode(m.id)}>
                {m.label}
              </button>
            ))}
          </div>
          <label className={styles.check}>
            <input type="checkbox" checked={batch} onChange={(e) => pickBatch(e.target.checked)} />
            two events in one commit
          </label>
        </div>
      </div>

      <div className={styles.mid}>
        <div className={styles.chainCol}>
          <ol className={clsx(styles.chain, rebuild && styles.pulse)} style={{'--hop': Math.max(0, Math.min(hop, 4))} as CSSProperties}>
            {mode === 'ivm' && hop >= 0 && !done && (
              <span className={styles.token} aria-hidden="true">
                {ev === 'batch' ? 'Δ×2' : 'Δ'}
              </span>
            )}
            {OPS.map((op, i) => {
              const lit = !!story && (rebuild || (mode === 'rx' ? done : hop >= i));
              return (
                <li key={op.name} className={clsx(styles.op, lit && styles.lit)}>
                  <span className={styles.opName}>{op.name}</span>
                  {op.sub && <span className={styles.opSub}>{op.sub}</span>}
                  <span className={styles.opStatus} aria-live={i === 4 ? 'polite' : undefined}>
                    {lit ? story!.ops[i] : ' '}
                  </span>
                </li>
              );
            })}
          </ol>
          <div className={styles.budget}>
            <div className={styles.budgetHead}>
              <span>frame budget · rows evaluated per frame</span>
              {over && <span className={styles.overTag}>over budget</span>}
            </div>
            <div className={clsx(styles.track, over && styles.trackOver)}>
              <span style={budgetWidth ? {width: budgetWidth} : undefined} />
            </div>
            <span className={styles.budgetText} aria-live="polite">
              {frame.text}
            </span>
            <div className={clsx(styles.track, styles.allocTrack)}>
              <span style={{width: frame.allocFull ? '100%' : '0%'}} />
            </div>
            <span className={styles.budgetText}>allocations: {frame.alloc}</span>
          </div>
          <div className={styles.subs}>
            {['Leaderboard UI view', 'Guild header'].map((name, i) => (
              <div key={name} className={clsx(styles.sub, (done || rebuild) && styles.subOn)}>
                <span className={styles.subName}>{name}</span>
                <span className={styles.subLine}>{(done || rebuild) && story ? story.subs[i] : 'waiting'}</span>
              </div>
            ))}
          </div>
        </div>

        <div className={styles.tableWrap}>
          {intermediate && <span className={styles.interTag}>intermediate state visible</span>}
          <table className={clsx(styles.table, mode === 'rx' && done && styles.flashAll, rebuild && styles.pulseAll)} key={`${mode}-${ev}-${flashes}`}>
            <thead>
              <tr>
                <th>#</th>
                <th>name</th>
                <th>lvl</th>
                <th>guild</th>
              </tr>
            </thead>
            <tbody>
              {after.map((r, i) => {
                const isNew = done && mode === 'ivm' && newIds.has(r.id);
                const moved = done && mode === 'ivm' && !isNew && changedIds.has(r.id);
                const guildChanged = done && mode === 'ivm' && before.find((b) => b.id === r.id)?.guildName !== r.guildName;
                return (
                  <tr key={r.id} className={clsx(isNew && styles.rowNew, moved && !guildChanged && styles.rowMoved)}>
                    <td>{i + 1}</td>
                    <td>{r.name}</td>
                    <td>{r.level}</td>
                    <td className={clsx(guildChanged && styles.cellNew)}>{r.guildName}</td>
                  </tr>
                );
              })}
              {removed.map((r) => (
                <tr key={`gone-${r.id}`} className={styles.rowGone}>
                  <td>–</td>
                  <td>{r.name}</td>
                  <td>{r.level}</td>
                  <td>{r.guildName}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className={styles.bottom}>
        <div className={styles.events}>
          {(batch ? [{id: 'batch' as EventId, label: BATCH_LABEL}] : EVENTS).map((e) => (
            <button key={e.id} type="button" className={clsx(styles.event, ev === e.id && styles.eventOn)} onClick={() => run(e.id)}>
              {e.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

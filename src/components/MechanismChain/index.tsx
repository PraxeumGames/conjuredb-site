import {Fragment, type ReactNode} from 'react';
import styles from './styles.module.css';

// The mechanism in four beats, each one the reason for the next. A rail of
// cards joined by "therefore"; each card jumps to its deeper section.

type Beat = {n: string; id: string; title: string; body: string; glyph: ReactNode};

// Tiny static glyphs in plain strokes — no new illustration style.
const BRACKETS = (
  <>
    <path d="M12 3 Q7 3 7 7 V10 Q7 12 4 12 Q7 12 7 14 V17 Q7 21 12 21" />
    <path d="M24 3 Q29 3 29 7 V10 Q29 12 32 12 Q29 12 29 14 V17 Q29 21 24 21" />
  </>
);
const CHEVRONS = (
  <>
    <path d="M5 6 L11 12 L5 18" />
    <path d="M15 6 L21 12 L15 18" />
    <path d="M25 6 L31 12 L25 18" />
  </>
);
const HASH = (x: number) => (
  <>
    <path d={`M${x + 2} 7 V17 M${x + 6} 7 V17 M${x} 10 H${x + 8} M${x} 14 H${x + 8}`} />
  </>
);
const EQUALS = (
  <>
    {HASH(1)}
    <path d="M14 10 H22 M14 14 H22" className={styles.gold} />
    {HASH(27)}
  </>
);
const CHECK = <path d="M9 12.5 L15 18 L27 6" />;

const BEATS: Beat[] = [
  {
    n: '01',
    id: 'closed-world',
    title: 'Closed world',
    body: 'You declare the whole game: state, commands, the questions screens ask, modules, frame rules. There is no query the compiler has not seen and no command it has not typed.',
    glyph: BRACKETS,
  },
  {
    n: '02',
    id: 'compiler',
    title: 'Compiler',
    body: 'It binds, type-checks, plans with a cost-based optimizer and emits plain C#. No parser, no planner, no reflection on the device. A shape it cannot guarantee is rejected with a diagnostic, never degraded silently.',
    glyph: CHEVRONS,
  },
  {
    n: '03',
    id: 'determinism',
    title: 'Determinism',
    body: 'Commands are pure transitions over declared state: a fixed floating-point math library, seeded random declared in the schema, a single writer per state owner. Same inputs, same state — on IL2CPP, Mono or .NET.',
    glyph: EQUALS,
  },
  {
    n: '04',
    id: 'replay',
    title: 'Replay',
    body: 'So the same generated command can run on the device and in a per-player grain. The device applies it immediately and logs it; the server replays the log and compares the state. That is the whole trust model.',
    glyph: CHECK,
  },
];

export default function MechanismChain(): ReactNode {
  return (
    <ol className={styles.rail}>
      {BEATS.map((b, i) => (
        <Fragment key={b.id}>
          {i > 0 && (
            <li className={styles.link} aria-hidden="true">
              <span>therefore</span>
            </li>
          )}
          <li className={styles.beat}>
            <a className={styles.card} href={`#${b.id}`}>
              <span className={styles.top}>
                <span className={styles.n}>{b.n}</span>
                <svg className={styles.glyph} viewBox="0 0 36 24" aria-hidden="true">
                  {b.glyph}
                </svg>
              </span>
              <span className={styles.title}>{b.title}</span>
              <span className={styles.body}>{b.body}</span>
            </a>
          </li>
        </Fragment>
      ))}
    </ol>
  );
}

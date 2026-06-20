import type {ReactNode} from 'react';
import Link from '@docusaurus/Link';
import Layout from '@theme/Layout';
import styles from './marketing.module.css';

function Header(): ReactNode {
  return (
    <header className={styles.pageHead}>
      <div className="container">
        <span className="cdb-kicker">Why ConjureDB</span>
        <h1 className={styles.pageTitle}>
          The hidden database in your client was always there
        </h1>
        <p className={styles.pageLead}>
          You have not been avoiding a database. You have been writing one — by hand,
          spread across presenters, managers and ScriptableObjects, with its indexes as
          ad-hoc dictionaries, its joins as nested lookups, its queries as service methods,
          and its cache invalidation as a tangle of <code>OnChanged</code> subscriptions
          no one fully understands. The only choice is whether you keep building it by
          hand, or compile it.
        </p>
      </div>
    </header>
  );
}

type Item = {title: string; body: string};

const FIXES: Item[] = [
  {
    title: 'ScriptableObjects & manager singletons',
    body: 'Fine for config and small state. As soon as data must be queried, joined and kept consistent, they become a database with no schema, no indexes and no query planner — maintained entirely in your head.',
  },
  {
    title: 'Manual dictionaries + hand-rolled indexes',
    body: 'They work until a second index has to stay in sync with the first. Then every write path must remember to update every derived structure, and the ones it forgets become your bugs.',
  },
  {
    title: 'An event bus for "refresh on change"',
    body: 'It starts clean and becomes its own spaghetti: refresh order is implicit, over-refreshing burns the frame, under-refreshing ships stale UI, and nobody can safely add a dependency.',
  },
  {
    title: 'Just embed SQLite or an ORM',
    body: 'Now you pay at runtime for what a server pays for: query parsing, planning, reflection, allocations and millisecond latency — none of which fit IL2CPP or a per-frame budget measured in microseconds.',
  },
];

function Fixes(): ReactNode {
  return (
    <section className="cdb-section" style={{background: 'var(--cdb-surface)'}}>
      <div className="container">
        <span className="cdb-kicker">Why the usual fixes don't hold</span>
        <h2 className="cdb-h2">Every familiar tool trades clean code for runtime cost</h2>
        <p className="cdb-lead">
          Each option is good at something — and each breaks on either maintainability or
          the frame budget. That dilemma is the real problem.
        </p>
        <div className="cdb-grid" style={{gridTemplateColumns: 'repeat(2, 1fr)', marginTop: '1.6rem'}}>
          {FIXES.map((f) => (
            <div className="cdb-card" key={f.title}>
              <h3>{f.title}</h3>
              <p>{f.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Reframe(): ReactNode {
  return (
    <section className="cdb-section">
      <div className="container">
        <span className="cdb-kicker">The reframe</span>
        <h2 className="cdb-h2">A server doesn't know its queries in advance. You do.</h2>
        <p className="cdb-lead">
          Your client ships with a fixed set of screens. The shop screen runs the same
          offer-visibility query it ran yesterday. The entire catalog of questions your
          game will ever ask is known before the build leaves your machine. Everything a
          server pays for at runtime exists to cope with <em>not knowing</em> — so why are
          you paying for it?
        </p>
        <p className="cdb-lead" style={{marginTop: '1rem'}}>
          ConjureDB keeps the one good idea — describe data declaratively, in one place —
          and moves the entire cost from runtime to <strong>build time</strong>. The
          compiler does once, correctly, what you'd otherwise do by hand, every frame,
          slightly wrong.
        </p>
      </div>
    </section>
  );
}

const OUTCOMES: Item[] = [
  {
    title: 'Player experience',
    body: 'Correct, fresh screens — no stale offers, no impossible states, no refresh glitches — and durable saves, so progress survives crashes and restarts.',
  },
  {
    title: 'Developer velocity',
    body: 'One home for data logic. Reusable queries written once and called from every screen. New features stop forcing an archaeology dig through hidden invalidation wiring.',
  },
  {
    title: 'Reliability & confidence',
    body: 'Refresh-order correctness is structural, not hand-wired. Unsupported reactive shapes are rejected at compile time, never silently degraded. Plans are inspectable.',
  },
];

function Outcomes(): ReactNode {
  return (
    <section className="cdb-section" style={{background: 'var(--cdb-surface)'}}>
      <div className="container">
        <span className="cdb-kicker">What it buys you</span>
        <h2 className="cdb-h2">Outcomes, not features</h2>
        <div className="cdb-grid" style={{marginTop: '1.6rem'}}>
          {OUTCOMES.map((o) => (
            <div className="cdb-card" key={o.title}>
              <h3>{o.title}</h3>
              <p>{o.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

const NOT_FOR: Item[] = [
  {
    title: 'Arbitrary runtime queries',
    body: 'If designers must type new queries that run on player devices, you need a runtime engine. ConjureDB is closed-world: queries are known and compiled before ship.',
  },
  {
    title: 'Trivially small or throwaway state',
    body: 'Three booleans behind an options menu, or a prototype you delete in two weeks, do not need a schema. A dictionary is the right answer.',
  },
  {
    title: 'A multi-writer server database',
    body: 'This is single-writer and client-owned — no MVCC, no row locks, no distributed transactions. It is a fast local layer, not a contention-solving backend.',
  },
  {
    title: 'A source of authority',
    body: 'It is a fast local cache, not a security oracle. Premium currency and competitive rankings still need server truth.',
  },
];

function NotFor(): ReactNode {
  return (
    <section className="cdb-section">
      <div className="container">
        <span className="cdb-kicker">Honest limits</span>
        <h2 className="cdb-h2">When <em>not</em> to use ConjureDB</h2>
        <p className="cdb-lead">
          A tool you can trust draws its own boundaries out loud. ConjureDB's strengths
          come from its constraints — here is where it is the wrong choice.
        </p>
        <div className="cdb-grid" style={{gridTemplateColumns: 'repeat(2, 1fr)', marginTop: '1.6rem'}}>
          {NOT_FOR.map((n) => (
            <div className="cdb-card" key={n.title}>
              <h3>{n.title}</h3>
              <p>{n.body}</p>
            </div>
          ))}
        </div>
        <p className="cdb-lead" style={{marginTop: '1.6rem'}}>
          The cost is real, too: a schema to maintain, a build step, and a new way of
          thinking for your team. We think it is worth it for a growing game that wants to
          keep both its architecture and its frame budget — but you should decide with eyes
          open.
        </p>
      </div>
    </section>
  );
}

function Cta(): ReactNode {
  return (
    <section className="cdb-section cdb-center">
      <div className="container">
        <h2 className="cdb-h2">See the mechanism, not a pitch</h2>
        <p className="cdb-lead" style={{margin: '0 auto 1.6rem'}}>
          ConjureDB earns trust by opening the box. Read how the compiler works — and how
          you can read the C# it generates.
        </p>
        <div className={styles.ctaRow} style={{justifyContent: 'center'}}>
          <Link className="button button--primary button--lg" to="/how-it-works">
            How it works
          </Link>
          <Link className="button button--secondary button--lg" to="/performance">
            See the performance
          </Link>
        </div>
      </div>
    </section>
  );
}

export default function Why(): ReactNode {
  return (
    <Layout
      title="Why ConjureDB"
      description="You already built a database in your game client — by hand. ConjureDB lets you describe data declaratively and compiles it, moving the cost from runtime to build time. Here is the case for it, and where it is the wrong choice.">
      <Header />
      <main>
        <Fixes />
        <Reframe />
        <Outcomes />
        <NotFor />
        <Cta />
      </main>
    </Layout>
  );
}

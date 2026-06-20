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
    body: 'Now you pay it all at runtime: query parsing, planning, reflection, allocations and millisecond latency — none of which fit IL2CPP or a per-frame budget measured in microseconds.',
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
        <h2 className="cdb-h2">You already know every query before you ship.</h2>
        <p className="cdb-lead">
          Your game ships with a fixed set of screens. The shop runs the same offer query it
          ran yesterday; the inventory the same lookup. You know the whole catalogue of
          questions your game will ever ask before the build leaves your machine — so there's
          no reason to work them out again on the player's device, every frame.
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
    title: 'Features that travel between games',
    body: 'Behind a declarative schema, a feature owns its data on its own terms — not welded into one game\'s managers and presenters. Build a shop or inventory once and carry it into the next project.',
  },
  {
    title: 'Fast without hand-optimizing',
    body: 'A cost-based optimizer turns the lists you\'d loop over into index lookups, and picks the plan for you. You stop hand-tuning data code and the frame budget stops being the thing you fight.',
  },
  {
    title: 'Screens that refresh themselves',
    body: 'Incremental view maintenance keeps a view current by applying only what changed — no manual OnChanged wiring, no refresh-order bugs, no stale UI. Shapes it can\'t maintain are rejected at compile time, not silently degraded.',
  },
  {
    title: 'It stays manageable as it grows',
    body: 'One home for data logic instead of a tangle across scripts. The coupling that makes a growing game unmaintainable goes away — so the project stays workable from 3 systems to 30.',
  },
];

function Outcomes(): ReactNode {
  return (
    <section className="cdb-section" style={{background: 'var(--cdb-surface)'}}>
      <div className="container">
        <span className="cdb-kicker">What it buys you</span>
        <h2 className="cdb-h2">Four wins from one decision</h2>
        <div className="cdb-grid" style={{gridTemplateColumns: 'repeat(2, 1fr)', marginTop: '1.6rem'}}>
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

import type {ReactNode} from 'react';
import Link from '@docusaurus/Link';
import Layout from '@theme/Layout';
import styles from './index.module.css';

function Hero(): ReactNode {
  return (
    <header className={styles.hero}>
      <div className="container">
        <span className={styles.eyebrow}>In-memory data layer · built for game clients</span>
        <h1 className={styles.title}>
          You already have a database in your game.
          <br />
          <span className={styles.grad}>ConjureDB compiles it.</span>
        </h1>
        <p className={styles.subtitle}>
          The data logic in a game client is real — it's just smeared by hand across
          presenters, managers and ad-hoc caches. ConjureDB lets you describe it
          declaratively and compiles it to zero-allocation C# at build time: clean,
          reusable architecture that still fits inside a frame.
        </p>
        <div className={styles.ctaRow}>
          <Link className="button button--primary button--lg" to="/how-it-works">
            See how it works
          </Link>
          <Link className="button button--secondary button--lg" to="/docs/getting-started">
            Read the docs
          </Link>
        </div>
        <div className={styles.chips}>
          <span className={styles.chip}>.NET 8+</span>
          <span className={styles.chip}>Unity 2021.3+ · IL2CPP &amp; Mono</span>
          <span className={styles.chip}>Zero-allocation hot paths</span>
          <span className={styles.chip}>No reflection · AOT-safe</span>
        </div>
      </div>
    </header>
  );
}

function Problem(): ReactNode {
  return (
    <section className="cdb-section">
      <div className="container">
        <span className="cdb-kicker">The hidden cost</span>
        <h2 className="cdb-h2">The shop screen that depends on everything</h2>
        <p className="cdb-lead">
          A single screen's offers depend on the wallet, owned items, offer config, the
          current time, the player segment, and purchase history — each changing
          independently. Wire the refreshes by hand and you get the bugs every large
          client ships:
        </p>
        <div className="cdb-grid" style={{marginTop: '1.6rem'}}>
          <div className="cdb-card">
            <h3>Stale &amp; wrong UI</h3>
            <p>Missed invalidation leaves prices, sold-out offers and reward badges showing impossible state.</p>
          </div>
          <div className="cdb-card">
            <h3>Refresh-order bugs</h3>
            <p>Intermittent glitches from a dependency graph nobody can see, let alone order correctly.</p>
          </div>
          <div className="cdb-card">
            <h3>Drifting duplicate logic</h3>
            <p>The same join lives in three presenters, in three slightly different, slightly broken ways.</p>
          </div>
        </div>
        <p className="cdb-lead" style={{marginTop: '1.6rem'}}>
          That's a database — indexes as dictionaries, queries as service methods, joins as
          nested loops, invalidation as <code>OnChanged</code> spaghetti — built by hand,
          badly. The only real question is whether you keep hand-building it, or compile it.
        </p>
      </div>
    </section>
  );
}

type Pillar = {title: string; body: string};
const PILLARS: Pillar[] = [
  {
    title: 'Architecture without the frame tax',
    body: 'Describe data once in a declarative query; reuse it from every screen. The cost of the abstraction is paid at build time, not in your frame budget.',
  },
  {
    title: 'Zero-allocation at runtime',
    body: 'Queries compile to ordinary C# over struct storage with pooled, no-alloc result paths — no reflection, no runtime codegen, no surprise GC spikes.',
  },
  {
    title: 'Reactive views that stay fresh',
    body: 'Incremental view maintenance updates a result by applying only the change, so keeping a leaderboard or inventory current scales with edits, not data size.',
  },
  {
    title: 'Ships where games ship',
    body: 'Targets .NET Standard 2.1 and survives IL2CPP and a tight mobile frame precisely because nothing is dynamic. Read the generated code if you do not trust it.',
  },
];

function Pillars(): ReactNode {
  return (
    <section className="cdb-section" style={{background: 'var(--cdb-surface)'}}>
      <div className="container">
        <span className="cdb-kicker">What you get</span>
        <h2 className="cdb-h2">A real database engine, tuned for the client</h2>
        <div className="cdb-grid" style={{gridTemplateColumns: 'repeat(2, 1fr)', marginTop: '1.6rem'}}>
          {PILLARS.map((p) => (
            <div className="cdb-card" key={p.title}>
              <h3>{p.title}</h3>
              <p>{p.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

type Role = {who: string; gets: string; link: string; cta: string};
const ROLES: Role[] = [
  {
    who: 'CEOs & Producers',
    gets: 'Fewer "my progress vanished" tickets and stale-UI bugs; a codebase that keeps moving as the game grows from 3 systems to 30.',
    link: '/why',
    cta: 'Why it matters →',
  },
  {
    who: 'CTOs & Tech Leads',
    gets: 'A cost-based optimizer and incremental view maintenance — server-grade ideas — with explicit, honest limits and inspectable plans.',
    link: '/how-it-works',
    cta: 'How it works →',
  },
  {
    who: 'Senior Developers',
    gets: 'A schema-first DSL, compiled queries and mutations, indexing you control, and zero-allocation editors — with examples to copy from.',
    link: '/docs/getting-started',
    cta: 'Get started →',
  },
];

function Roles(): ReactNode {
  return (
    <section className="cdb-section">
      <div className="container">
        <span className="cdb-kicker">Who it's for</span>
        <h2 className="cdb-h2">One project, read at every altitude</h2>
        <div className="cdb-grid" style={{marginTop: '1.6rem'}}>
          {ROLES.map((r) => (
            <div className="cdb-card" key={r.who}>
              <h3>{r.who}</h3>
              <p style={{marginBottom: '1rem'}}>{r.gets}</p>
              <Link to={r.link}>{r.cta}</Link>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Proof(): ReactNode {
  return (
    <section className="cdb-section" style={{background: 'var(--cdb-surface)'}}>
      <div className="container cdb-center">
        <span className="cdb-kicker">Measured, not asserted</span>
        <h2 className="cdb-h2">Built to be fast — and to show its work</h2>
        <p className="cdb-lead" style={{margin: '0 auto'}}>
          In a 20-query game-workload benchmark against SQLite (50,000 players), every
          query ran <strong>50× or faster</strong>, none slower. Numbers depend on your
          workload and hardware — so we publish the methodology and tell you to benchmark
          your own scenario.
        </p>
        <div className={styles.proofCta}>
          <Link className="button button--primary button--lg" to="/performance">
            See the benchmarks &amp; methodology
          </Link>
        </div>
      </div>
    </section>
  );
}

function FinalCta(): ReactNode {
  return (
    <section className="cdb-section cdb-center">
      <div className="container">
        <h2 className="cdb-h2">Stop hand-rolling your data layer</h2>
        <p className="cdb-lead" style={{margin: '0 auto 1.6rem'}}>
          Describe a schema, write a query, and call compiled, allocation-free code from C#.
        </p>
        <div className={styles.ctaRow} style={{justifyContent: 'center'}}>
          <Link className="button button--primary button--lg" to="/docs/getting-started">
            Get started
          </Link>
          <Link className="button button--secondary button--lg" to="/why">
            Read the case for it
          </Link>
        </div>
      </div>
    </section>
  );
}

export default function Home(): ReactNode {
  return (
    <Layout
      title="ConjureDB — a compiled data layer for game clients"
      description="ConjureDB is an in-memory database for game clients that compiles a declarative query DSL to zero-allocation C# at build time. Clean architecture, ACID transactions, reactive views, and full Unity support.">
      <Hero />
      <main>
        <Problem />
        <Pillars />
        <Roles />
        <Proof />
        <FinalCta />
      </main>
    </Layout>
  );
}

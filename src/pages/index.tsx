import type {ReactNode} from 'react';
import Link from '@docusaurus/Link';
import Layout from '@theme/Layout';
import {CodeWindow, HERO_TABS} from '@site/src/components/CodeWindow';
import styles from './index.module.css';

function Hero(): ReactNode {
  return (
    <header className={styles.hero}>
      <div className={styles.heroGlow} aria-hidden="true" />
      <div className={`container ${styles.heroGrid}`}>
        <div className={styles.heroCopy}>
          <span className={styles.eyebrow}>
            <span className={styles.eyebrowDot} /> In-memory database · Unity &amp; .NET game clients
          </span>
          <h1 className={styles.title}>
            Stop fighting
            <br />
            <span className={styles.grad}>your own game data.</span>
          </h1>
          <p className={styles.subtitle}>
            Right now it's hand-wired across managers, ScriptableObjects and OnChanged events until a
            simple shop or inventory owns your week — and a year later it's a tangle you're scared to
            touch. ConjureDB lets you describe your data once and generates the fast C# instead: clean
            systems you build once and reuse, with no spaghetti and no GC spikes from your data layer.
          </p>
          <div className={styles.ctaRow}>
            <Link className="button button--primary button--lg" to="/docs/getting-started">
              Get started
            </Link>
            <Link className="button button--secondary button--lg" to="/why">
              Why ConjureDB
            </Link>
          </div>
          <div className={styles.chips}>
            <span className={styles.chip}>Unity 2021.3+ · IL2CPP &amp; Mono</span>
            <span className={styles.chip}>.NET 8 · .NET Standard 2.1</span>
            <span className={styles.chip}>Index-aware optimizer</span>
            <span className={styles.chip}>Reactive views · IVM</span>
          </div>
        </div>
        <div className={styles.heroCode}>
          <CodeWindow tabs={HERO_TABS} />
          <p className={styles.heroCodeCaption}>
            You write the schema &amp; query. ConjureDB emits the C# — switch the tab and read it.
          </p>
        </div>
      </div>
    </header>
  );
}

type Stat = {n: string; l: string};
const STATS: Stat[] = [
  {n: '50×+', l: 'faster than SQLite*'},
  {n: 'O(1)', l: 'indexed lookups'},
  {n: 'AOT', l: 'IL2CPP-safe'},
  {n: '1', l: 'build step · no runtime parser'},
];

function StatBand(): ReactNode {
  return (
    <section className="cdb-section cdb-section--tight">
      <div className="container">
        <div className="cdb-stats">
          {STATS.map((s) => (
            <div className="cdb-stat" key={s.l}>
              <b>{s.n}</b>
              <span>{s.l}</span>
            </div>
          ))}
        </div>
        <p style={{textAlign: 'center', marginTop: '0.85rem', fontSize: '0.8rem', color: 'var(--cdb-muted)'}}>
          * 57-query game-workload benchmark vs SQLite (50,000 players).{' '}
          <Link to="/performance">See the methodology →</Link>
        </p>
      </div>
    </section>
  );
}

const PAINS: string[] = [
  "A shop or inventory that should've taken a day takes a week.",
  'The same systems — inventory, quests, progression — rewritten from scratch in every new project.',
  'Game data spread across managers, ScriptableObjects and singletons — impossible to follow.',
  'OnChanged events wired by hand; miss one subscription and the UI shows the wrong thing.',
  'Touch one feature and three others break — and nobody is sure why.',
  'Lists you loop over every frame, until the GC starts spiking.',
];

function Problems(): ReactNode {
  return (
    <section className="cdb-section">
      <div className="container">
        <span className="cdb-kicker">Sound familiar?</span>
        <h2 className="cdb-h2">The features that quietly eat your sprints</h2>
        <p className="cdb-lead">
          It always starts simple. Then the data spreads across scripts, the edge cases pile up, and
          the "quick" feature owns your week — the same way, every project:
        </p>
        <div className="cdb-grid" style={{marginTop: '2rem'}}>
          {PAINS.map((p) => (
            <div className={`cdb-card ${styles.pain}`} key={p}>
              <p>{p}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function OneIdea(): ReactNode {
  return (
    <section className="cdb-section cdb-surface">
      <div className="container cdb-center">
        <span className="cdb-kicker">There's a calmer way</span>
        <h2 className="cdb-h2" style={{maxWidth: '20ch', margin: '0.5rem auto 0.9rem'}}>
          Describe your data — don't wire it by hand
        </h2>
        <p className="cdb-lead" style={{margin: '0 auto'}}>
          Underneath, every one of those is the same thing: game data hand-wired across your scripts.
          ConjureDB lets you describe your data and the queries you need — players, items, scores — in
          one place, and generates the fast C# that used to sprawl across a dozen MonoBehaviours. You
          get clean, reusable systems, and the speed comes for free.
        </p>
      </div>
    </section>
  );
}

type Benefit = {tag: string; title: string; body: string; link: string; cta: string};
const BENEFITS: Benefit[] = [
  {
    tag: 'Architecture & reuse',
    title: 'Features that travel between games',
    body: "Behind a declarative schema, a feature owns its data on its own terms — not welded into one game's managers and presenters. Build a shop or inventory once and carry it into the next project.",
    link: '/why',
    cta: 'Why it matters →',
  },
  {
    tag: 'Performance',
    title: 'Fast lookups, not per-frame loops',
    body: "ConjureDB indexes your data and picks the fast path for every query, so the lookups you'd otherwise write as loops over lists don't cost you frames. You say what you want; it finds the quickest way there.",
    link: '/how-it-works',
    cta: 'How it works →',
  },
  {
    tag: 'Reactivity · IVM',
    title: 'Views that stay fresh by themselves',
    body: 'Incremental view maintenance keeps leaderboards and inventories current by applying only what changed — no manual invalidation, no refresh-order bugs, cost that scales with edits not data size.',
    link: '/docs/advanced/reactive-queries',
    cta: 'Reactive queries →',
  },
  {
    tag: 'Frame budget',
    title: 'AOT-safe, allocation-lean C#',
    body: 'It compiles to plain C# — no runtime codegen, no reflection on the query path — so it survives IL2CPP and a tight mobile frame. The query hot path is allocation-free; if you do not trust it, read the generated code.',
    link: '/performance',
    cta: 'See performance →',
  },
];

function Benefits(): ReactNode {
  return (
    <section className="cdb-section">
      <div className="container">
        <span className="cdb-kicker">What that one move buys you</span>
        <h2 className="cdb-h2">Four wins from the same decision</h2>
        <div className="cdb-grid" style={{gridTemplateColumns: 'repeat(2, 1fr)', marginTop: '2rem'}}>
          {BENEFITS.map((b) => (
            <div className={`cdb-card ${styles.benefit}`} key={b.title}>
              <span className={styles.benefitTag}>{b.tag}</span>
              <h3>{b.title}</h3>
              <p style={{marginBottom: '1rem'}}>{b.body}</p>
              <Link to={b.link}>{b.cta}</Link>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Cost(): ReactNode {
  return (
    <section className="cdb-section cdb-surface">
      <div className="container cdb-center">
        <span className="cdb-kicker">The bottom line</span>
        <h2 className="cdb-h2" style={{maxWidth: '24ch', margin: '0.5rem auto 0.9rem'}}>
          Less to reinvent. Less to untangle.
        </h2>
        <p className="cdb-lead" style={{margin: '0 auto'}}>
          Features stop being from-scratch rebuilds and become things you declare once and reuse
          across titles. The coupling that makes a growing game unmanageable goes away — so your team
          spends its time on the game, not on rebuilding its plumbing. Better architecture that costs
          you neither frames nor the same feature twice.
        </p>
      </div>
    </section>
  );
}

function Proof(): ReactNode {
  return (
    <section className="cdb-section cdb-center">
      <div className="container">
        <span className="cdb-kicker">Measured, not asserted</span>
        <h2 className="cdb-h2">Fast — and willing to show its work</h2>
        <p className="cdb-lead" style={{margin: '0 auto'}}>
          In a 57-query game-workload benchmark against SQLite (50,000 players), all 56 production
          queries ran <strong>50× or faster</strong>, none slower. Numbers depend on your workload and
          hardware — so we publish the methodology and tell you to benchmark your own scenario.
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

type Role = {who: string; gets: string};
const ROLES: Role[] = [
  {
    who: 'CEOs & Producers',
    gets: 'Build a system once and reuse it across every title, instead of paying to rebuild the same features for each new game.',
  },
  {
    who: 'CTOs & Tech Leads',
    gets: 'A cost-based optimizer and incremental view maintenance, with explicit, honest limits and inspectable, generated code you can read.',
  },
  {
    who: 'Senior Developers',
    gets: 'A schema-first DSL, compiled queries and mutations, indexing you control, and zero-allocation editors — with examples to copy from.',
  },
];

function Roles(): ReactNode {
  return (
    <section className="cdb-section">
      <div className="container">
        <span className="cdb-kicker">Who it's for</span>
        <h2 className="cdb-h2">One project, read at every altitude</h2>
        <div className="cdb-grid" style={{marginTop: '2rem'}}>
          {ROLES.map((r) => (
            <div className="cdb-card" key={r.who}>
              <h3>{r.who}</h3>
              <p>{r.gets}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function FinalCta(): ReactNode {
  return (
    <section className="cdb-section cdb-center">
      <div className="container">
        <h2 className="cdb-h2">Read the full argument</h2>
        <p className="cdb-lead" style={{margin: '0 auto 2rem'}}>
          From the shop screen that depends on everything to a compiled data layer — the case for
          ConjureDB, and the honest limits, in one read.
        </p>
        <div className={styles.ctaRow} style={{justifyContent: 'center'}}>
          <Link className="button button--primary button--lg" to="/why">
            Why ConjureDB
          </Link>
          <Link className="button button--secondary button--lg" to="/docs/getting-started">
            Get started
          </Link>
        </div>
      </div>
    </section>
  );
}

export default function Home(): ReactNode {
  return (
    <Layout
      title="ConjureDB — an in-memory data layer for game clients"
      description="ConjureDB is an in-memory database for game clients. Describe your data and queries declaratively and compile them into fast, reactive, reusable C#. Better architecture, index-driven performance, reactive views, and lower development cost — for Unity & .NET.">
      <Hero />
      <main>
        <StatBand />
        <Problems />
        <OneIdea />
        <Benefits />
        <Cost />
        <Proof />
        <Roles />
        <FinalCta />
      </main>
    </Layout>
  );
}

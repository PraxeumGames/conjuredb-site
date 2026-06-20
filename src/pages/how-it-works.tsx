import type {ReactNode} from 'react';
import Link from '@docusaurus/Link';
import Layout from '@theme/Layout';
import {CodeWindow, HERO_TABS} from '@site/src/components/CodeWindow';
import {Pipeline as BuildPipeline} from '@site/src/components/Pipeline';
import styles from './marketing.module.css';

function Header(): ReactNode {
  return (
    <header className={styles.pageHead}>
      <div className="container">
        <span className="cdb-kicker">How it works</span>
        <h1 className={styles.pageTitle}>Compile, don't interpret</h1>
        <p className={styles.pageLead}>
          A compiler is just a translator: it does at build time, mechanically and the same
          way every time, what you'd otherwise do badly by hand at runtime. ConjureDB treats
          the client data layer as a compiled program — parsed, bound, optimized, planned,
          validated and emitted before it ever reaches a player's device.
        </p>
      </div>
    </header>
  );
}

function Translate(): ReactNode {
  return (
    <section className="cdb-section">
      <div className="container">
        <span className="cdb-kicker">From description to code</span>
        <h2 className="cdb-h2">You describe the <em>what</em>. The compiler writes the <em>how</em>.</h2>
        <p className="cdb-lead">
          A declared query is a description of a result. ConjureDB turns it into the C#
          method you would have written by hand — generated correctly, identically, every
          build.
        </p>
        <div style={{maxWidth: '44rem', marginTop: '1.6rem'}}>
          <CodeWindow tabs={HERO_TABS} />
          <p style={{marginTop: '0.9rem', fontSize: '0.85rem', color: 'var(--cdb-muted)'}}>
            Switch tabs: the same query, and the plain C# ConjureDB emits for it.
          </p>
        </div>
      </div>
    </section>
  );
}

function Pipeline(): ReactNode {
  return (
    <section className="cdb-section" style={{background: 'var(--cdb-surface)'}}>
      <div className="container">
        <span className="cdb-kicker">The pipeline</span>
        <h2 className="cdb-h2">Five stages, all at build time</h2>
        <p className="cdb-lead">
          Nothing on this path runs on the player's device. The output is plain C# (or a
          portable artifact) — there is no query parser on the hot path.
        </p>
        <BuildPipeline />
      </div>
    </section>
  );
}

function Optimizer(): ReactNode {
  return (
    <section className="cdb-section">
      <div className="container">
        <span className="cdb-kicker">The optimizer</span>
        <h2 className="cdb-h2">A glass box, not a black box</h2>
        <p className="cdb-lead">
          A Cascades-style, cost-based optimizer makes the choices a senior engineer makes
          by hand — which index, which join strategy, what order, when to stop scanning,
          whether to eliminate a sort — but deterministically and exhaustively, using your
          schema, your indexes, cardinality estimates and profile data. The difference: every
          choice is inspectable. The plan is output you can read; the strategy names are real
          and finite; nothing is hidden.
        </p>
      </div>
    </section>
  );
}

function Ivm(): ReactNode {
  return (
    <section className="cdb-section" style={{background: 'var(--cdb-surface)'}}>
      <div className="container">
        <span className="cdb-kicker">Reactive data</span>
        <h2 className="cdb-h2">Keep the result. Apply only the change.</h2>
        <p className="cdb-lead">
          Static queries are the easy half. Your shop screen isn't static — it changes
          whenever anything it depends on changes. Incremental view maintenance keeps a
          materialized result fresh by applying only the delta: add an item, you add one
          row; change a config field, you touch the rows that pointed at it. The cost of
          staying fresh scales with the size of the <em>change</em>, not the size of the
          data — the only property that fits inside a frame.
        </p>
        <p className="cdb-lead" style={{marginTop: '1rem'}}>
          And it is honest about its limits: a query shape it cannot maintain incrementally
          is <strong>rejected at compile time</strong>, never silently degraded to a hidden
          full rescan.
        </p>
      </div>
    </section>
  );
}

function NoMagic(): ReactNode {
  return (
    <section className="cdb-section">
      <div className="container">
        <span className="cdb-kicker">No magic</span>
        <h2 className="cdb-h2">If you don't trust it, read it</h2>
        <p className="cdb-lead">
          The generated code is plain source you can open. There is no reflection, no
          runtime code generation, no hidden GC — which is exactly why it survives IL2CPP
          and a tight mobile frame. ConjureDB earns trust by removing mystery, not by
          asserting quality.
        </p>
        <div className={styles.ctaRow} style={{marginTop: '1.6rem'}}>
          <Link className="button button--primary button--lg" to="/docs/getting-started">
            Start building
          </Link>
          <Link className="button button--secondary button--lg" to="/performance">
            See the performance
          </Link>
        </div>
      </div>
    </section>
  );
}

export default function HowItWorks(): ReactNode {
  return (
    <Layout
      title="How ConjureDB works"
      description="ConjureDB compiles a declarative query DSL to zero-allocation C# through a five-stage pipeline: frontend, analysis, a Cascades cost-based optimizer, physical planning, and emission. Reactive views stay fresh with incremental view maintenance.">
      <Header />
      <main>
        <Translate />
        <Pipeline />
        <Optimizer />
        <Ivm />
        <NoMagic />
      </main>
    </Layout>
  );
}

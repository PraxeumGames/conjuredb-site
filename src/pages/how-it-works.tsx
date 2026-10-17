import type {ReactNode} from 'react';
import Link from '@docusaurus/Link';
import Layout from '@theme/Layout';
import useBrokenLinks from '@docusaurus/useBrokenLinks';
import {CodeWindow, PLAN_TABS} from '@site/src/components/CodeWindow';
import {Pipeline as BuildPipeline} from '@site/src/components/Pipeline';
import MechanismChain from '@site/src/components/MechanismChain';
import TwoPlaces from '@site/src/components/TwoPlaces';
import IvmExplainer from '@site/src/components/IvmExplainer';
import DeclarativeVsImperative from '@site/src/components/DeclarativeVsImperative';
import styles from './marketing.module.css';

function Header(): ReactNode {
  return (
    <header className={styles.pageHead}>
      <div className="container">
        <span className="cdb-kicker">How it works</span>
        <h1 className={styles.pageTitle}>A closed world, compiled.</h1>
        <p className={styles.pageLead}>
          A game knows every state, command and question before it ships. Conjure treats that as a
          contract: everything a runtime would otherwise do on the device or on the server happens
          once, at build time — and what comes out is deterministic enough to run in two places and
          agree.
        </p>
      </div>
    </header>
  );
}

function Declarative(): ReactNode {
  return (
    <section id="declarative" className="cdb-section">
      <div className="container">
        <span className="cdb-kicker">Declarative, not imperative</span>
        <h2 className="cdb-h2">You say what. The compiler decides how.</h2>
        <p className="cdb-lead">
          Imperative code tells the machine the steps: loop, check, cache, invalidate, redraw.
          Declarative code states the result you want and leaves the steps to a compiler that knows
          your whole game. The difference is not style — it is who owns the hard decisions, and
          whether a change costs one line or four files.
        </p>
        <DeclarativeVsImperative />
      </div>
    </section>
  );
}

function Chain(): ReactNode {
  return (
    <section className="cdb-section cdb-section--tight">
      <div className="container">
        <MechanismChain />
      </div>
    </section>
  );
}

// Anchors from the chain: #determinism lands on this section, #replay on the visual.
function OneCommand(): ReactNode {
  return (
    <section id="determinism" className="cdb-section cdb-surface">
      <div className="container">
        <span className="cdb-kicker">Same code, both sides</span>
        <h2 className="cdb-h2">One command. Two places. One answer.</h2>
        <p className="cdb-lead">
          The command you declare is compiled once. The device runs it to move the game forward;
          the server runs the very same code to check. Here is BuyItem(sword) doing both.
        </p>
        <TwoPlaces id="replay" />
        <p className={styles.visualCaption}>
          Not a protocol. Not a second implementation. The same compiled command, with a fixed math
          library and a seeded random, so both sides can only reach the same state.
        </p>
      </div>
    </section>
  );
}

function InsideCompiler(): ReactNode {
  return (
    <section id="compiler" className="cdb-section">
      <div className="container">
        <span className="cdb-kicker">Inside the compiler</span>
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
    <section className="cdb-section cdb-surface">
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
        <div style={{maxWidth: '42rem', margin: '1.6rem auto 0'}}>
          <CodeWindow tabs={PLAN_TABS} />
          <p className={styles.codeCaption}>
            Ask for the plan and read what it picked — an index walk, bounded, no sort, no allocations.
          </p>
        </div>
      </div>
    </section>
  );
}

function Ivm(): ReactNode {
  return (
    <section id="ivm" className="cdb-section">
      <div className="container">
        <span className="cdb-kicker">Reactive data</span>
        <h2 className="cdb-h2">Not an event bus. A maintained result.</h2>
        <p className="cdb-lead">
          Rebuilding every frame pays for the whole table even when nothing changed. Rx moves
          events and every subscriber re-runs its query. Incremental view maintenance moves the
          change itself through the query&apos;s own operators and keeps the result as a table.
          Same event, three mechanisms — step through it.
        </p>
        <IvmExplainer />
        <p className={styles.visualCaption}>
          IVM is not a subscription trick. The compiler lowers the query into maintainers — filter,
          join arrangements, grouped accumulators, bounded Top-K state — and each commit pushes only
          the delta through them. The result is a table: consistent once per commit, proportional in
          cost to the change, and indexable like any other table. A reactive query is how a UI view
          subscribes to that view model. A shape the maintainers cannot keep does not compile.
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

const LIMITS: {title: string; body: string}[] = [
  {
    title: 'Queries nobody declared',
    body: "Designers cannot type new queries that run on players' devices. Changes after the build ship as compiled artifacts through the liveops lane, verified like everything else.",
  },
  {
    title: 'Many writers on one state',
    body: 'Each piece of state has one owner and one writer. Shared state such as clans and leaderboards gets its own owner on the server; there is no multi-writer contention to resolve.',
  },
  {
    title: 'Rendering and feel',
    body: 'Conjure is the logic and the data. Unity still draws the frame, plays the sound and reads the touch.',
  },
  {
    title: 'A schema to maintain',
    body: 'There is a schema and a build step. For a prototype you will delete in two weeks, a dictionary is still the right answer.',
  },
];

function Limits(): ReactNode {
  return (
    <section id="closed-world" className="cdb-section cdb-surface">
      <div className="container">
        <span className="cdb-kicker">Honest limits</span>
        <h2 className="cdb-h2">What the closed world rules out</h2>
        <div className={`cdb-grid ${styles.grid2}`}>
          {LIMITS.map((l) => (
            <div className="cdb-card" key={l.title}>
              <h3>{l.title}</h3>
              <p>{l.body}</p>
            </div>
          ))}
        </div>
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
          runtime code generation, nothing dynamic on the query path — which is exactly why it
          survives IL2CPP and a tight mobile frame. Conjure earns trust by removing mystery,
          not by asserting quality.
        </p>
        <div className={styles.ctaRow} style={{marginTop: '1.6rem', justifyContent: 'center'}}>
          <Link className="button button--primary button--lg" to="/platform">
            Platform
          </Link>
          <Link className="button button--secondary button--lg" to="/docs/getting-started">
            Read the docs
          </Link>
        </div>
      </div>
    </section>
  );
}

export default function HowItWorks(): ReactNode {
  // Section anchors the mechanism chain (and other pages) link to.
  const brokenLinks = useBrokenLinks();
  ['declarative', 'closed-world', 'compiler', 'determinism', 'ivm'].forEach((id) => brokenLinks.collectAnchor(id));
  return (
    <Layout
      title="How Conjure works — a closed world, compiled"
      description="A game knows every state, command and question before it ships. Conjure compiles that closed world at build time into deterministic C#, so the same command runs on the device and on the server and both reach the same state.">
      <Header />
      <main>
        <Declarative />
        <Chain />
        <OneCommand />
        <InsideCompiler />
        <Optimizer />
        <Ivm />
        <Limits />
        <NoMagic />
      </main>
    </Layout>
  );
}

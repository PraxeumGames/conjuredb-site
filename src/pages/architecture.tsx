import type {ReactNode} from 'react';
import Link from '@docusaurus/Link';
import Layout from '@theme/Layout';
import {A, CodeWindow, F, K, N, T, V, type CodeTab} from '@site/src/components/CodeWindow';
import MonolithVsSlices from '@site/src/components/MonolithVsSlices';
import StatusBadge, {type Status} from '@site/src/components/StatusBadge';
import styles from './marketing.module.css';

// Architecture: vertical slices in a game client. Snippets follow
// docs/schema/schema-language.md (modules, commands) and
// docs/advanced/reactive-queries.md (binding a reactive query from C#).

function Header(): ReactNode {
  return (
    <header className={styles.pageHead}>
      <div className="container">
        <span className="cdb-kicker">Architecture</span>
        <h1 className={styles.pageTitle}>Vertical slices, finally possible in a game client.</h1>
        <p className={styles.pageLead}>
          Game clients grow into one fat monolith: every feature reaches into every manager, so
          nothing can be removed, replaced or reused. When a feature&apos;s state and rules are
          declared in one schema module, the feature becomes a vertical slice — data, logic, screen
          and server behaviour in one folder — that you can add, delete or carry to the next game.
        </p>
      </div>
    </header>
  );
}

function Shapes(): ReactNode {
  return (
    <section className="cdb-section">
      <div className="container">
        <span className="cdb-kicker">Same four features, two shapes</span>
        <MonolithVsSlices />
      </div>
    </section>
  );
}

const MODULE_TABS: CodeTab[] = [
  {
    name: 'battlepass.conjure',
    lang: 'schema',
    lines: [
      <><K>module</K> <T>BattlePass</T> {'{'}</>,
      <>    <K>table</K> <T>PassProgress</T>(persistence: <K>local</K>, type_id: <N>7101</N>, schema_version: <N>1</N>) {'{'}</>,
      <>        <V>PlayerId</V>: <K>int</K> <A>@id</A></>,
      <>        <V>Xp</V>: <K>int</K></>,
      <>        <V>Tier</V>: <K>int</K></>,
      <>    {'}'}</>,
      <>{' '}</>,
      <>    <K>type</K> <T>AddXpResult</T> {'{'}</>,
      <>        <V>xpAfter</V>: <K>int</K></>,
      <>    {'}'}</>,
      <>{' '}</>,
      <>    <K>command</K> <F>AddXp</F>(playerId: <K>int</K>, amount: <K>int</K>) -&gt; <T>AddXpResult</T></>,
      <>    kind: <K>local</K></>,
      <>    {'{'}</>,
      <>        <K>require</K> @amount &gt; <N>0</N> <K>else</K> InvalidAmount</>,
      <>{' '}</>,
      <>        <K>upsert</K> <T>PassProgress</T></>,
      <>        | <K>key</K> {'{'} PlayerId = @playerId {'}'}</>,
      <>        | <K>set</K> {'{'} Xp += @amount {'}'}</>,
      <>        | <K>returning</K> {'{'} xpAfter = Xp {'}'} <K>into</K> progressAfter</>,
      <>{' '}</>,
      <>        <K>return</K> {'{'} xpAfter = progressAfter.XpAfter {'}'}</>,
      <>    {'}'}</>,
      <>{' '}</>,
      <>    <K>reactive query</K> <F>Track</F>(playerId: <K>int</K>) -&gt; <T>PassProgress</T>[] {'{'}</>,
      <>        <K>from</K> <T>PassProgress</T> p</>,
      <>        | <K>filter</K> p.PlayerId == @playerId</>,
      <>    {'}'}</>,
      <>{'}'}</>,
    ],
  },
];

const SCREEN_TABS: CodeTab[] = [
  {
    name: 'BattlePassScreen.cs',
    lang: 'C#',
    lines: [
      <><K>var</K> track = context.<F>Track</F>(playerId: player.Id);</>,
      <>passView.<F>Bind</F>(track.<V>Current</V>);</>,
      <>track.<F>SubscribeChanged</F>(changes =&gt; passView.<F>Apply</F>(changes));</>,
    ],
  },
];

const TREE: [string, string][] = [
  ['features/battlepass/', ''],
  ['  battlepass.conjure', 'module BattlePass { … }'],
  ['  BattlePassScreen.cs', 'binds the reactive view'],
  ['  BattlePassSystems.cs', 'optional per-frame logic'],
  ['  art/', 'prefabs, sprites'],
];

function Contents(): ReactNode {
  return (
    <section className="cdb-section cdb-surface">
      <div className="container">
        <span className="cdb-kicker">One folder</span>
        <h2 className="cdb-h2">What a slice contains</h2>
        <div className={styles.sliceGrid}>
          <div>
            <pre className={styles.tree} aria-label="Folder tree of the battle pass slice">
              {TREE.map(([path, note]) => (
                <span key={path} className={styles.treeRow}>
                  <span className={path.endsWith('/') && !note ? styles.treeRoot : undefined}>{path}</span>
                  <span className={styles.treeNote}>{note}</span>
                </span>
              ))}
            </pre>
            <p className={styles.treeCaption}>
              The feature&apos;s state, rules, screen and frame logic sit together. Delete the folder
              and the feature is gone; copy it and the feature moves.
            </p>
          </div>
          <div className={styles.sliceCode}>
            <CodeWindow tabs={MODULE_TABS} dense />
            <CodeWindow tabs={SCREEN_TABS} dense />
            <p className={styles.codeCaption}>
              A module groups the feature&apos;s table, command and reactive query. The CLI generates a
              separate interface for each module — <code>ICore</code> for <code>module Core</code>,{' '}
              <code>ISocial</code> for <code>module Social</code> — and the screen binds the reactive
              query through the generated context.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

type Card = {title: string; body: string; status?: Status};

const RULES: Card[] = [
  {
    title: 'One owner per table',
    body: 'A module owns its tables. Other slices read through declared queries and joins, never through a manager reference.',
  },
  {
    title: 'Commands are the only writes',
    body: "State changes go through the module's commands. There is no cross-feature method call to break when a slice changes.",
  },
  {
    title: 'Screens bind to views',
    body: "A screen subscribes to the module's reactive query. No presenter knows about other features' events.",
  },
  {
    title: 'The same slice runs on the server',
    body: "Commands are deterministic, so the module's logic is the server's logic too.",
    status: 'prototype',
  },
];

function CardGrid({cards}: {cards: Card[]}): ReactNode {
  return (
    <div className={`cdb-grid ${cards.length === 4 ? styles.grid2 : ''}`}>
      {cards.map((c) => (
        <div className="cdb-card" key={c.title}>
          <div className={styles.cardHead}>
            <h3>{c.title}</h3>
            {c.status && <StatusBadge status={c.status} />}
          </div>
          <p>{c.body}</p>
        </div>
      ))}
    </div>
  );
}

function Rules(): ReactNode {
  return (
    <section className="cdb-section">
      <div className="container">
        <span className="cdb-kicker">Ownership</span>
        <h2 className="cdb-h2">Why it holds together without coupling</h2>
        <CardGrid cards={RULES} />
      </div>
    </section>
  );
}

const STEPS: string[] = [
  'Copy the folder.',
  'Compile: unresolved references come back as diagnostics, not runtime surprises.',
  'Bind the screen to your art; override what the new game does differently.',
];

function Carry(): ReactNode {
  return (
    <section className="cdb-section cdb-surface">
      <div className="container">
        <span className="cdb-kicker">Reuse</span>
        <h2 className="cdb-h2">Carrying a feature to the next game</h2>
        <ol className={styles.steps}>
          {STEPS.map((s, i) => (
            <li key={s} className="cdb-card">
              <span className={styles.stepNum}>{String(i + 1).padStart(2, '0')}</span>
              <p>{s}</p>
            </li>
          ))}
        </ol>
        <p className={styles.honest}>
          What travels: the schema module, its generated code and the screen logic. What you still
          adapt: art, layout and balance.
        </p>
      </div>
    </section>
  );
}

const NOT: Card[] = [
  {
    title: 'Not microservices',
    body: 'One process, one context on the device. Slices are compile-time ownership, not network boundaries.',
  },
  {
    title: 'Not runtime plugins',
    body: 'Nothing is loaded dynamically. Slices are compiled together; the compiler checks the whole.',
  },
  {
    title: 'Not free of design',
    body: 'A slice still needs a clean boundary. The compiler enforces ownership; you still choose it.',
  },
];

function NotThis(): ReactNode {
  return (
    <section className="cdb-section">
      <div className="container">
        <span className="cdb-kicker">Boundaries</span>
        <h2 className="cdb-h2">What this is not</h2>
        <CardGrid cards={NOT} />
      </div>
    </section>
  );
}

function Closing(): ReactNode {
  return (
    <section className="cdb-section cdb-surface">
      <div className="container">
        <h2 className="cdb-h2">Start with one slice</h2>
        <p className="cdb-lead">
          Pick a feature you have rewritten twice. Declare it as a module, bind one screen, and see
          what the compiler says about the rest.
        </p>
        <div className={styles.ctaRow} style={{marginTop: '1.6rem', justifyContent: 'center'}}>
          <Link className="button button--primary button--lg" to="/docs/schema/schema-language">
            Schema language
          </Link>
          <Link className="button button--secondary button--lg" to="/platform">
            Platform
          </Link>
        </div>
      </div>
    </section>
  );
}

export default function Architecture(): ReactNode {
  return (
    <Layout
      title="Architecture — vertical slices in a game client"
      description="When a feature's state, rules and screen are declared in one schema module, it becomes a vertical slice you can add, delete or carry to the next game — data, logic, screen and server behaviour in one folder.">
      <Header />
      <main>
        <Shapes />
        <Contents />
        <Rules />
        <Carry />
        <NotThis />
        <Closing />
      </main>
    </Layout>
  );
}

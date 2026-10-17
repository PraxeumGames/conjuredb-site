import type {ReactNode} from 'react';
import Link from '@docusaurus/Link';
import Layout from '@theme/Layout';
import {CodeWindow, HERO_TABS} from '@site/src/components/CodeWindow';
import TangleToSchema from '@site/src/components/TangleToSchema';
import ReplayVerify from '@site/src/components/ReplayVerify';
import StatusBadge, {type Status} from '@site/src/components/StatusBadge';
import {FrameBudget, ModuleSlice, OfflineCheck} from '@site/src/components/ClaimVisuals';
import styles from './index.module.css';

function Hero(): ReactNode {
  return (
    <header className={styles.hero}>
      <div className={styles.heroGlow} aria-hidden="true" />
      <div className={`container ${styles.heroGrid}`}>
        <div className={styles.heroCopy}>
          <span className={styles.eyebrow}>
            <span className={styles.eyebrowDot} /> Compiled game platform · Unity &amp; .NET
          </span>
          <h1 className={styles.title}>
            One schema.
            <br />
            <span className={styles.grad}>Client, server, liveops.</span>
          </h1>
          <p className={styles.subtitle}>
            <span className={styles.subLine}>
              Conjure compiles a declarative description of your game into the client data layer,
              the server, replay verification and liveops.
            </span>
            <span className={styles.subLine}>
              Play offline, verify on the server, ship features in days — with a three-person team.
            </span>
          </p>
          <div className={styles.ctaRow}>
            <Link className="button button--primary button--lg" to="/docs/getting-started">
              Read the docs
            </Link>
            <Link className="button button--secondary button--lg" to="/how-it-works">
              How it works
            </Link>
          </div>
          <div className={styles.chips}>
            <span className={styles.chip}>Offline-first</span>
            <span className={styles.chip}>Replay-verified</span>
            <span className={styles.chip}>0 B/frame</span>
            <span className={styles.chip}>Features = schema</span>
            <span className={styles.chip}>Self-hosted</span>
          </div>
        </div>
        <div className={styles.heroVisual}>
          <TangleToSchema />
        </div>
      </div>
    </header>
  );
}

type Fact = {text: string; status: Status};
const REPLAY_FACTS: Fact[] = [
  {text: 'Deterministic by construction — own float math, seeded random in the schema', status: 'shipped'},
  {text: 'Replay verification on the server', status: 'prototype'},
  {text: 'Microseconds per command, device and server', status: 'shipped'},
];

function ReplaySection(): ReactNode {
  return (
    <section className={`cdb-section cdb-surface ${styles.joinNext}`}>
      <div className="container">
        <span className="cdb-kicker">Play offline. The server still checks.</span>
        <h2 className="cdb-h2">No request per tap. No trust in the client.</h2>
        <p className={`cdb-lead ${styles.replayLead}`}>
          The device runs the compiled logic and writes down what the player did. When the network
          is back, the server replays that log with the same compiled logic and compares the state.
        </p>
        <ReplayVerify />
        <p className={styles.replayCaption}>
          Same compiled command on both sides. Same inputs, same state — or the session is rejected.
        </p>
        <ul className={styles.facts}>
          {REPLAY_FACTS.map((f) => (
            <li key={f.text} className={styles.fact}>
              <span>{f.text}</span>
              <StatusBadge status={f.status} />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

type Stat = {n: string; l: string};
const STATS: Stat[] = [
  {n: '1 schema', l: 'client, server, liveops'},
  {n: '0 B', l: 'per frame on the device'},
  {n: 'µs', l: 'per command, device and server'},
  {n: '0', l: 'trust required in the client'},
];

function StatBand(): ReactNode {
  return (
    <section className={`cdb-section cdb-section--tight cdb-surface ${styles.statBand}`}>
      <div className="container">
        <div className="cdb-stats">
          {STATS.map((s) => (
            <div className="cdb-stat" key={s.l}>
              <b>{s.n}</b>
              <span>{s.l}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

type Claim = {
  title: string;
  body: string;
  badges: {label: string; status: Status}[];
  link: {label: string; to: string};
  visual: ReactNode;
};

const CLAIMS: Claim[] = [
  {
    title: 'Play offline. The server still checks.',
    body: 'The device runs the game with no connection and writes down what the player did. The server replays that log with the same compiled logic and either accepts the state or rolls it back. No request per tap, no latency, no trust in the client.',
    badges: [
      {label: 'replay verification', status: 'prototype'},
      {label: 'determinism', status: 'shipped'},
    ],
    link: {label: 'See the mechanism →', to: '/how-it-works#replay'},
    visual: <OfflineCheck />,
  },
  {
    title: 'Fast by default — on the frame and on the server.',
    body: 'Everything is compiled and proven before it ships. On the device: index-aware, allocation-free queries and per-frame systems at 0 B per frame. On the server: microsecond commands, so one grain replays a whole session in less time than a frame. The frame budget stops being a fight and verification stops being a cost.',
    badges: [
      {label: 'device', status: 'shipped'},
      {label: 'server replay', status: 'prototype'},
    ],
    link: {label: 'Arena: 100 000 units →', to: '/docs/examples/arena-ecs'},
    visual: <FrameBudget />,
  },
  {
    title: 'A feature is a schema, not a sprint.',
    body: 'A battle pass or a store is a module of the schema: its tables, commands and queries in one place, for both sides. Override it instead of forking it. Change rules through liveops without a release. And because the language is small and typed, an assistant can draft a feature and the compiler rejects what is wrong.',
    badges: [
      {label: 'modules & overrides', status: 'shipped'},
      {label: 'liveops', status: 'prototype'},
      {label: 'ready-made modules', status: 'planned'},
    ],
    link: {label: 'Every part and its status →', to: '/platform'},
    visual: <ModuleSlice />,
  },
];

function Claims(): ReactNode {
  return (
    <section className="cdb-section">
      <div className="container">
        <span className="cdb-kicker">Why this is new</span>
        <h2 className="cdb-h2">Three things you could not do before.</h2>
        <div className={styles.claims}>
          {CLAIMS.map((c, i) => (
            <article key={c.title} className={`cdb-card ${styles.claim} ${i % 2 ? styles.claimFlip : ''}`}>
              <div className={styles.claimText}>
                <h3>{c.title}</h3>
                <p>{c.body}</p>
                <ul className={styles.claimBadges}>
                  {c.badges.map((b) => (
                    <li key={b.label}>
                      <span>{b.label}</span>
                      <StatusBadge status={b.status} />
                    </li>
                  ))}
                </ul>
                <Link to={c.link.to}>{c.link.label}</Link>
              </div>
              <div className={styles.claimVisual}>{c.visual}</div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

type Shipped = {title: string; line: string; to?: string};
const SHIPPED: Shipped[] = [
  {
    title: 'Compiled queries, commands and mutations',
    line: 'Declared once, planned by a cost-based optimizer, emitted as plain C#.',
    to: '/docs/getting-started',
  },
  {
    title: 'Screens that update themselves',
    line: 'Reactive views maintained by applying only what changed.',
    to: '/docs/advanced/reactive-queries',
  },
  {
    title: 'Frame state and systems',
    line: 'Chunked storage, generational handles, systems scheduled per phase, 0 B per frame.',
    to: '/docs/advanced/ephemeral-tables',
  },
  {
    title: 'Portable interpreter',
    line: 'A no-JIT lane for queries that arrive after the build, bit-identical to compiled code.',
    to: '/docs/query-language/portable-interpreter',
  },
  {
    title: 'Determinism',
    line: 'Fixed float math and seeded random declared in the schema, held by tests.',
  },
];

function ShippedToday(): ReactNode {
  return (
    <section className="cdb-section cdb-surface">
      <div className="container">
        <span className="cdb-kicker">Shipped</span>
        <h2 className="cdb-h2">What you can use today</h2>
        <p className="cdb-lead">
          The data layer, frame state, determinism and the interpreter are in the docs now. The
          server and liveops are validated prototypes; the services are designed. The platform page
          keeps the whole list honest.
        </p>
        <div className={styles.shipped}>
          <div className={styles.shippedCode}>
            <CodeWindow tabs={HERO_TABS} />
            <p className={styles.shippedCaption}>
              You write the schema. Conjure emits the C# — switch the tab and read it.
            </p>
          </div>
          <ul className={styles.shippedList}>
            {SHIPPED.map((s) => (
              <li key={s.title}>
                <span className={styles.shippedTitle}>{s.title}</span>
                <span className={styles.shippedLine}>{s.line}</span>
                {s.to && (
                  <Link className={styles.shippedLink} to={s.to}>
                    Docs →
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </div>
        <p className={styles.proofLine}>
          Arena sample · 100 000 units · 171 µs per frame on IL2CPP · 0 B allocated{' '}
          <Link to="/docs/examples/arena-ecs">methodology →</Link>
        </p>
        <div className={styles.ctaRow} style={{justifyContent: 'center', marginTop: '1.6rem'}}>
          <Link className="button button--secondary button--lg" to="/platform">
            Platform: every part and its status
          </Link>
        </div>
      </div>
    </section>
  );
}

type Role = {who: string; gets: string};
const ROLES: Role[] = [
  {
    who: 'Small studios',
    gets: 'The infrastructure a platform team would build — client data layer, server, verification, liveops — compiled from one schema, without the platform team.',
  },
  {
    who: 'Tech leads',
    gets: 'A deterministic, compiled model with explainable plans, generated code you can read, and limits stated out loud.',
  },
  {
    who: 'Gameplay programmers',
    gets: 'Declare state and commands. Screens update themselves, the frame stays flat, and the same feature runs on the server without a second implementation.',
  },
];

function Roles(): ReactNode {
  return (
    <section className="cdb-section">
      <div className="container">
        <span className="cdb-kicker">Who it's for</span>
        <h2 className="cdb-h2">Built for a team of three. Readable by a team of thirty.</h2>
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
    <section className="cdb-section cdb-center cdb-surface">
      <div className="container">
        <h2 className="cdb-h2">See every part and its real status</h2>
        <p className="cdb-lead" style={{margin: '0 auto 2rem'}}>
          The platform page lists what is shipped, what is landing, what has been proven in a
          prototype and what is only designed.
        </p>
        <div className={styles.ctaRow} style={{justifyContent: 'center'}}>
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

export default function Home(): ReactNode {
  return (
    <Layout
      title="Conjure — one schema, compiled for client and server"
      description="Conjure compiles one declarative description of your game into the client data layer, the server, replay verification and liveops. Play offline, verify on the server by replay, ship features in days — for Unity & .NET.">
      <Hero />
      <main>
        <ReplaySection />
        <StatBand />
        <Claims />
        <ShippedToday />
        <Roles />
        <FinalCta />
      </main>
    </Layout>
  );
}

import type {ReactNode} from 'react';
import Link from '@docusaurus/Link';
import Layout from '@theme/Layout';
import useBrokenLinks from '@docusaurus/useBrokenLinks';
import PlatformMap from '@site/src/components/PlatformMap';
import {GROUPS, PARTS, partsIn, type Part} from '@site/src/components/PlatformMap/parts';
import StatusBadge, {STATUS_LABEL, type Status} from '@site/src/components/StatusBadge';
import mk from './marketing.module.css';
import styles from './platform.module.css';

const LEGEND: {status: Status; text: string}[] = [
  {status: 'shipped', text: 'in the docs and usable today'},
  {status: 'prototype', text: 'built and tested end to end in a prototype, not yet in the product'},
  {status: 'planned', text: 'designed, not built'},
];

function Header(): ReactNode {
  return (
    <header className={mk.pageHead}>
      <div className="container">
        <span className="cdb-kicker">Platform</span>
        <h1 className={mk.pageTitle}>One schema. Every part it compiles.</h1>
        <p className={mk.pageLead}>
          Conjure compiles a declarative description of your game into the parts below. Each one
          carries its real status — what is in the docs today, what has been proven in a prototype,
          and what is only designed.
        </p>
        <ul className={styles.legend}>
          {LEGEND.map((l) => (
            <li key={l.status}>
              <StatusBadge status={l.status} />
              <span>{l.text}</span>
            </li>
          ))}
        </ul>
      </div>
    </header>
  );
}

function PartCard({part, wide}: {part: Part; wide?: boolean}): ReactNode {
  useBrokenLinks().collectAnchor(part.id);
  const links = part.status === 'shipped' ? part.links : undefined;
  return (
    <article id={part.id} className={`cdb-card ${styles.part} ${wide ? styles.partWide : ''}`}>
      <div className={styles.partHead}>
        <h3>{part.name}</h3>
        <div className={styles.badges}>
          <StatusBadge status={part.status} />
          {part.also && (
            <StatusBadge status={part.also.status}>
              {STATUS_LABEL[part.also.status]} · {part.also.note}
            </StatusBadge>
          )}
        </div>
      </div>
      <p>{part.body}</p>
      {part.items && (
        <div className={styles.whatsIn}>
          <span className={styles.whatsInLabel}>What's in it</span>
          <ul>
            {part.items.map((it) =>
              typeof it === 'string' ? (
                <li key={it}>{it}</li>
              ) : (
                <li key={it.label}>
                  <Link to={it.to}>{it.label}</Link>
                </li>
              ),
            )}
          </ul>
        </div>
      )}
      {links && links.length > 0 && (
        <div className={styles.links}>
          {links.map((l) => (
            <Link key={l.to + l.label} to={l.to}>
              {l.label} →
            </Link>
          ))}
        </div>
      )}
    </article>
  );
}

function Parts(): ReactNode {
  const compiler = PARTS.find((p) => p.group === 'compiler')!;
  return (
    <section className={`cdb-section ${styles.partsSection}`}>
      <div className="container">
        <PartCard part={compiler} wide />
        {GROUPS.map((g) => (
          <div key={g.id} className={styles.group}>
            <h2 className={styles.groupTitle}>{g.title}</h2>
            <div className={styles.grid}>
              {partsIn(g.id).map((p) => (
                <PartCard key={p.id} part={p} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

const SHIPS: {title: string; body: string}[] = [
  {
    title: 'Open runtime, closed compiler',
    body: 'The runtime and everything it generates are open and yours to read. The compiler is the part we keep.',
  },
  {
    title: 'You host',
    body: 'The server runs wherever Orleans runs. There is no hosted service to depend on.',
  },
  {
    title: 'Subscription or contract',
    body: 'Access is by subscription or contract. Nothing is on sale yet; this site is here for feedback.',
  },
];

function HowItShips(): ReactNode {
  return (
    <section className="cdb-section cdb-surface">
      <div className="container">
        <h2 className="cdb-h2">How it ships</h2>
        <div className="cdb-grid">
          {SHIPS.map((s) => (
            <div className="cdb-card" key={s.title}>
              <h3>{s.title}</h3>
              <p>{s.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Cta(): ReactNode {
  return (
    <section className="cdb-section cdb-section--tight">
      <div className="container">
        <div className={styles.cta}>
          <Link className="button button--primary button--lg" to="/docs/getting-started">
            Read the docs
          </Link>
          <Link className="button button--secondary button--lg" to="/how-it-works">
            How it works
          </Link>
        </div>
      </div>
    </section>
  );
}

export default function Platform(): ReactNode {
  return (
    <Layout
      title="Platform — what Conjure compiles from one schema"
      description="Every part Conjure compiles from one schema — client data layer, frame state, player server, replay verification, liveops, modules and services — each with its real status: shipped, prototype validated or planned.">
      <Header />
      <main>
        <section className="cdb-section cdb-section--tight">
          <div className="container">
            <PlatformMap />
          </div>
        </section>
        <Parts />
        <HowItShips />
        <Cta />
      </main>
    </Layout>
  );
}

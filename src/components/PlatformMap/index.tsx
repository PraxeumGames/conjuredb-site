import {useEffect, useRef, useState, type ReactNode} from 'react';
import clsx from 'clsx';
import {DeviceFrame, ServerFrame} from '@site/src/components/Glyphs';
import {StatusDot} from '@site/src/components/StatusBadge';
import {GROUPS, PARTS, partsIn, type GroupId} from './parts';
import styles from './styles.module.css';

// The platform as a diagram: the schema in the centre, four groups around it,
// each part a pill that jumps to its card. A static CSS grid; the device and
// server groups sit on the shared DeviceFrame / ServerFrame silhouettes.

/** Pixel size of an element, so a backdrop SVG can match it without distortion. */
function useBoxSize<T extends HTMLElement>(fallback: [number, number]) {
  const ref = useRef<T>(null);
  const [size, setSize] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([entry]) => {
      const {width, height} = entry.contentRect;
      setSize([Math.round(width), Math.round(height)]);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

function Pills({group}: {group: GroupId}) {
  return (
    <ul className={styles.pills}>
      {partsIn(group).map((p) => (
        <li key={p.id}>
          <a className={styles.pill} href={`#${p.id}`}>
            <StatusDot status={p.status} />
            {p.name}
          </a>
        </li>
      ))}
    </ul>
  );
}

function Backdrop({kind}: {kind: 'device' | 'server'}) {
  const [ref, [w, h]] = useBoxSize<HTMLDivElement>([280, 240]);
  return (
    <div ref={ref} className={styles.backdrop} aria-hidden="true">
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{fontSize: 14}}>
        {kind === 'device' ? (
          <DeviceFrame x={0.5} y={0.5} width={w - 1} height={h - 1} />
        ) : (
          <ServerFrame x={0.5} y={0.5} width={w - 1} height={h - 1} title="Server" />
        )}
      </svg>
    </div>
  );
}

function Group({id, title}: {id: Exclude<GroupId, 'compiler'>; title: string}) {
  const framed = id === 'device' || id === 'server';
  return (
    <div className={clsx(styles.group, styles[id], framed && styles.framed)}>
      {framed && <Backdrop kind={id} />}
      {/* The server frame draws its own title. */}
      <span className={clsx(styles.groupTitle, id === 'server' && styles.srOnly)}>{title}</span>
      <Pills group={id} />
    </div>
  );
}

export default function PlatformMap(): ReactNode {
  const compiler = PARTS.find((p) => p.group === 'compiler')!;
  return (
    <div className={styles.map}>
      <div className={styles.center}>
        <a className={styles.schema} href={`#${compiler.id}`}>
          <span className={styles.schemaName}>game.conjure</span>
          <span className={styles.schemaLines}>
            <span>
              <b>table</b> Item {'{ … }'}
            </span>
            <span>
              <b>command</b> BuyItem(…)
            </span>
            <span>
              <b>reactive query</b> ShopOffers
            </span>
            <span>
              <b>module</b> BattlePass
            </span>
          </span>
          <span className={styles.schemaFoot}>
            <StatusDot status={compiler.status} />
            {compiler.name}
          </span>
        </a>
      </div>
      {GROUPS.map((g) => (
        <Group key={g.id} id={g.id} title={g.title} />
      ))}
    </div>
  );
}

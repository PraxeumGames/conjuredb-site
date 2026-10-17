import type {ReactNode} from 'react';
import clsx from 'clsx';
import styles from './styles.module.css';

// The site's recurring characters: the player's device and the server.
// Plain SVG groups positioned by x/y/width/height so every visual draws the
// exact same silhouettes. Children use coordinates relative to the frame's
// top-left corner.

type FrameProps = {
  x: number;
  y: number;
  width: number;
  height: number;
  className?: string;
  children?: ReactNode;
};

/** Height of the device status bar; content below it starts at this y. */
export const DEVICE_STATUS_H = 26;

export function DeviceFrame({
  x,
  y,
  width,
  height,
  network,
  className,
  children,
}: FrameProps & {network?: ReactNode}) {
  const r = Math.min(width, height) * 0.13;
  return (
    <g className={clsx(styles.device, className)} transform={`translate(${x} ${y})`}>
      <rect className={styles.deviceBody} width={width} height={height} rx={r} />
      <rect className={styles.deviceScreen} x={5} y={5} width={width - 10} height={height - 10} rx={r - 4} />
      <rect className={styles.deviceNotch} x={width * 0.36} y={9} width={width * 0.28} height={6} rx={3} />
      {network && <g transform={`translate(${width - 24} ${DEVICE_STATUS_H - 10})`}>{network}</g>}
      {children}
    </g>
  );
}

/** Wi-Fi glyph centred on (0, 0); the cross is drawn on top for "offline". */
export function WifiGlyph({arcsClassName, crossClassName}: {arcsClassName?: string; crossClassName?: string}) {
  return (
    <g className={styles.wifi}>
      <g className={arcsClassName}>
        <path d="M-7 -1.5 A10 10 0 0 1 7 -1.5" />
        <path d="M-4.4 1.4 A6 6 0 0 1 4.4 1.4" />
        <circle cx={0} cy={4.4} r={1.3} className={styles.wifiDot} />
      </g>
      {crossClassName && <path className={clsx(styles.wifiCross, crossClassName)} d="M-7.5 -5.5 L7.5 6.5" />}
    </g>
  );
}

/** Server card in the steel server tint, with a title and a hash line slot. */
export function ServerFrame({
  x,
  y,
  width,
  height,
  title,
  hash,
  className,
  children,
}: FrameProps & {title: ReactNode; hash?: ReactNode}) {
  return (
    <g className={clsx(styles.server, className)} transform={`translate(${x} ${y})`}>
      <rect className={styles.serverBase} width={width} height={height} rx={12} />
      <rect className={styles.serverTint} width={width} height={height} rx={12} />
      <g className={styles.serverIcon} transform="translate(16 13)">
        <rect width={14} height={4.5} rx={1.2} />
        <rect y={6.5} width={14} height={4.5} rx={1.2} />
        <rect y={13} width={14} height={4.5} rx={1.2} />
      </g>
      <text className={styles.serverTitle} x={38} y={26}>
        {title}
      </text>
      {children}
      {hash && <g transform={`translate(16 ${height - 16})`}>{hash}</g>}
    </g>
  );
}

/** Where ServerFrame puts its hash line, relative to the frame. */
export function serverHashAt(x: number, y: number, height: number): [number, number] {
  return [x + 16, y + height - 16];
}

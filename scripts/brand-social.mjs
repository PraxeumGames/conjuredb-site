// Renders the brand raster assets from vector sources:
//   static/img/social-card.png  — 1200×630 Open Graph card
//   static/img/favicon.ico      — 16/32/48 px, from static/img/favicon.svg
// Text is converted to outlines with opentype.js (static @fontsource weights of
// the site fonts), so rendering doesn't depend on fonts installed on the machine.
// Run: npm run brand:social
import {readFileSync, writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import opentype from 'opentype.js';
import sharp from 'sharp';

const require = createRequire(import.meta.url);
const font = (pkg, file) => {
  const buf = readFileSync(require.resolve(`${pkg}/files/${file}`));
  return opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
};
const grotesk = font('@fontsource/space-grotesk', 'space-grotesk-latin-600-normal.woff');
const geist = font('@fontsource/geist-sans', 'geist-sans-latin-400-normal.woff');

/** Text as an SVG path, with tracking in em (e.g. -0.02). Returns [d, advance]. */
function textPath(f, text, x, y, size, tracking = 0) {
  let cursor = x;
  const parts = [];
  const glyphs = f.stringToGlyphs(text);
  glyphs.forEach((g, i) => {
    parts.push(g.getPath(cursor, y, size).toPathData(2));
    const kern = i < glyphs.length - 1 ? f.getKerningValue(g, glyphs[i + 1]) : 0;
    cursor += ((g.advanceWidth + kern) / f.unitsPerEm) * size + tracking * size;
  });
  return [parts.join(''), cursor - x];
}

const C = {bg: '#121419', ink: '#ece9e3', gold: '#ecc25c', line: '#262a31'};
const W = 1200;
const H = 630;
const X = 104;

const [word] = textPath(grotesk, 'Conjure', X + 92, 300, 112, -0.02);
const [line1, w1] = textPath(geist, 'One schema. ', X, 420, 50);
const [line2] = textPath(geist, 'Client, server, liveops.', X + w1, 420, 50);

const diamond = (cx, cy, s, fill) =>
  `<rect x="${cx - s / 2}" y="${cy - s / 2}" width="${s}" height="${s}" rx="${s * 0.18}" transform="rotate(45 ${cx} ${cy})" fill="${fill}"/>`;

const card = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <radialGradient id="g" cx="0.78" cy="0.1" r="0.75">
      <stop offset="0" stop-color="${C.gold}" stop-opacity="0.16"/>
      <stop offset="1" stop-color="${C.gold}" stop-opacity="0"/>
    </radialGradient>
    <pattern id="grid" width="46" height="46" patternUnits="userSpaceOnUse">
      <path d="M46 0H0V46" fill="none" stroke="#ffffff" stroke-opacity="0.025"/>
    </pattern>
  </defs>
  <rect width="${W}" height="${H}" fill="${C.bg}"/>
  <rect width="${W}" height="${H}" fill="url(#grid)"/>
  <rect width="${W}" height="${H}" fill="url(#g)"/>
  ${diamond(X + 34, 262, 46, C.gold)}
  <path d="${word}" fill="${C.ink}"/>
  <path d="${line1}" fill="${C.ink}" fill-opacity="0.9"/>
  <path d="${line2}" fill="${C.gold}"/>
  <rect x="${X}" y="${H - 104}" width="${W - 2 * X}" height="1" fill="${C.line}"/>
</svg>`;

await sharp(Buffer.from(card)).png({compressionLevel: 9}).toFile('static/img/social-card.png');

// favicon.ico with PNG-encoded entries (supported by every current browser).
const svg = readFileSync('static/img/favicon.svg');
const sizes = [16, 32, 48];
const pngs = await Promise.all(sizes.map((s) => sharp(svg, {density: 384}).resize(s, s).png().toBuffer()));
const header = Buffer.alloc(6 + 16 * sizes.length);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
sizes.forEach((s, i) => {
  const e = 6 + 16 * i;
  header.writeUInt8(s, e);
  header.writeUInt8(s, e + 1);
  header.writeUInt16LE(1, e + 4);
  header.writeUInt16LE(32, e + 6);
  header.writeUInt32LE(pngs[i].length, e + 8);
  header.writeUInt32LE(offset, e + 12);
  offset += pngs[i].length;
});
writeFileSync('static/img/favicon.ico', Buffer.concat([header, ...pngs]));
console.log('wrote static/img/social-card.png and static/img/favicon.ico');

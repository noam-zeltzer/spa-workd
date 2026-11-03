// Converts a TTF into the compact "typeface" JSON that three.js' Font/TextGeometry
// read, keeping only the glyphs the reel extrudes, and writes it into index.html
// between the TYPEFACE markers so the page stays a single self-contained file.
//
//   node tools/build-font.mjs <font.ttf> <path/to/three/examples/jsm/libs/opentype.module.js>
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const [ttfPath, opentypePath] = process.argv.slice(2);
if (!ttfPath || !opentypePath) {
  console.error('usage: node tools/build-font.mjs <font.ttf> <opentype.module.js>');
  process.exit(1);
}
const { default: opentype } = await import(pathToFileURL(opentypePath).href);

const KEEP = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789&-./';
const buf = await readFile(ttfPath);
const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const scale = 100000 / ((font.unitsPerEm || 2048) * 72);
const r = Math.round;

const glyphs = {};
for (const ch of KEEP) {
  const g = font.charToGlyph(ch);
  let o = '';
  for (const c of g.path.commands) {
    o += (c.type === 'C' ? 'b' : c.type.toLowerCase()) + ' ';
    if (c.x !== undefined) o += `${r(c.x * scale)} ${r(c.y * scale)} `;
    if (c.x1 !== undefined) o += `${r(c.x1 * scale)} ${r(c.y1 * scale)} `;
    if (c.x2 !== undefined) o += `${r(c.x2 * scale)} ${r(c.y2 * scale)} `;
  }
  glyphs[ch] = { ha: r(g.advanceWidth * scale), x_min: r((g.xMin ?? 0) * scale), x_max: r((g.xMax ?? 0) * scale), o: o.trim() };
}
const json = {
  glyphs,
  familyName: 'Archivo Expanded Black',
  ascender: r(font.ascender * scale),
  descender: r(font.descender * scale),
  underlinePosition: font.tables.post.underlinePosition,
  underlineThickness: font.tables.post.underlineThickness,
  boundingBox: { xMin: font.tables.head.xMin, xMax: font.tables.head.xMax, yMin: font.tables.head.yMin, yMax: font.tables.head.yMax },
  resolution: 1000,
};

const page = join(dirname(fileURLToPath(import.meta.url)), '..', 'index.html');
const html = await readFile(page, 'utf8');
const re = /(<script id="typeface" type="application\/json">)[\s\S]*?(<\/script>)/;
if (!re.test(html)) throw new Error('typeface marker not found in index.html');
await writeFile(page, html.replace(re, `$1${JSON.stringify(json)}$2`));
console.log(`typeface: ${Object.keys(glyphs).length} glyphs, ${JSON.stringify(json).length} bytes`);

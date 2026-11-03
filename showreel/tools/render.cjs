// Offline renderer: drives index.html in headless Chromium frame by frame and pipes
// lossless PNG frames into ffmpeg. The page's own renderFrame(t) does the motion blur.
//
//   node tools/render.cjs --three <node_modules/three> --out reel.mp4 [--from 0 --to 15]
//   node tools/render.cjs --three <node_modules/three> --stills 0.5,4.6,13.9 --outdir stills/
//   node tools/render.cjs --three <node_modules/three> --probe 4.5,8.3
//
// Network: page requests are answered from disk. three.js comes from a local npm
// install, Google Fonts are fetched once with curl and cached.
const { chromium } = require('playwright');
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const ROOT = path.join(__dirname, '..');
const THREE_DIR = arg('three');
const CACHE = arg('cache', path.join(require('node:os').tmpdir(), 'reel-cache'));
const FPS = 60;
if (!THREE_DIR) { console.error('--three <path to node_modules/three> is required'); process.exit(1); }
fs.mkdirSync(CACHE, { recursive: true });

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.css': 'text/css', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.m4a': 'audio/mp4' };
const typeOf = (p, fallback) => TYPES[path.extname(p.split('?')[0])] || fallback || 'application/octet-stream';

function cached(url) {
  const f = path.join(CACHE, crypto.createHash('sha1').update(url).digest('hex'));
  if (!fs.existsSync(f)) execFileSync('curl', ['-sSfL', '-A', UA, '-o', f, url]);
  return fs.readFileSync(f);
}

async function main() {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', '--disable-accelerated-2d-canvas'] });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') console.log('[page]', m.type(), m.text()); });
  page.on('pageerror', e => console.log('[pageerror]', e.message));
  await page.addInitScript(() => { window.__REEL_RENDER__ = true; });
  await page.route('**/*', async route => {
    const url = route.request().url();
    try {
      if (url.startsWith('https://reel.local/')) {
        const p = path.join(ROOT, decodeURIComponent(new URL(url).pathname));
        if (!fs.existsSync(p)) return route.fulfill({ status: 404, body: '' });
        return route.fulfill({ status: 200, contentType: typeOf(p), body: fs.readFileSync(p) });
      }
      const m = url.match(/^https:\/\/cdn\.jsdelivr\.net\/npm\/three@[\d.]+\/(.*)$/);
      if (m) return route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(path.join(THREE_DIR, m[1])) });
      if (url.startsWith('https://fonts.googleapis.com/')) return route.fulfill({ status: 200, contentType: 'text/css', body: cached(url), headers: { 'access-control-allow-origin': '*' } });
      if (url.startsWith('https://fonts.gstatic.com/')) return route.fulfill({ status: 200, contentType: typeOf(url, 'font/woff2'), body: cached(url), headers: { 'access-control-allow-origin': '*' } });
      return route.fulfill({ status: 404, body: '' });
    } catch (e) { console.log('[route]', url, e.message); return route.fulfill({ status: 500, body: '' }); }
  });
  await page.goto('https://reel.local/index.html');
  const t0 = Date.now();
  await page.evaluate(() => window.reel.ready);
  console.log(`ready in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  // Render and read back in one round trip; toDataURL PNG is lossless and much faster than a screenshot.
  const shot = async (t, K) => {
    const url = await page.evaluate(([t, K]) => { window.reel.renderFrame(t, K ?? undefined); return document.getElementById('reel').toDataURL('image/png'); }, [t, K ?? null]);
    return Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
  };

  // --probe 4.5,8.3 : time one sub-frame and one 4-sample frame per timestamp (finds slow scenes)
  const probe = arg('probe');
  if (probe) {
    for (const s of probe.split(',')) {
      const ms = await page.evaluate(t => {
        const flush = () => document.getElementById('reel').getContext('2d').getImageData(0, 0, 1, 1);
        let a = performance.now(); window.reel.renderFrame(t, 1); flush(); const k1 = performance.now() - a;
        a = performance.now(); window.reel.renderFrame(t, 4); flush(); return [k1, performance.now() - a];
      }, +s);
      console.log(`t=${s}  1 sample ${ms[0].toFixed(0)}ms  4 samples ${ms[1].toFixed(0)}ms`);
    }
    await browser.close(); return;
  }

  const stills = arg('stills');
  if (stills) {
    const outdir = arg('outdir', path.join(ROOT, 'stills'));
    fs.mkdirSync(outdir, { recursive: true });
    const K = arg('k') ? +arg('k') : undefined;
    for (const s of stills.split(',')) {
      const t = +s, a = Date.now();
      fs.writeFileSync(path.join(outdir, `t${t.toFixed(3)}.png`), await shot(t, K));
      console.log(`still ${t.toFixed(3)}s in ${Date.now() - a}ms`);
    }
    await browser.close(); return;
  }

  const from = +arg('from', 0), to = +arg('to', 15);
  const out = arg('out', path.join(ROOT, 'reel.mp4'));
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'png', '-i', '-',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', arg('crf', '16'), '-tune', 'film', '-pix_fmt', 'yuv420p', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-movflags', '+faststart', out], { stdio: ['pipe', 'inherit', 'inherit'] });
  const n0 = Math.round(from * FPS), n1 = Math.round(to * FPS);
  const start = Date.now();
  for (let n = n0; n < n1; n++) {
    const png = await shot(n / FPS);
    if (!ff.stdin.write(png)) await new Promise(r => ff.stdin.once('drain', r));
    if ((n - n0) % 30 === 0) {
      const el = (Date.now() - start) / 1000, done = n - n0 + 1;
      console.log(`frame ${n}/${n1}  ${(el / done * 1000).toFixed(0)} ms/frame  eta ${((n1 - n - 1) * el / done).toFixed(0)}s`);
    }
  }
  ff.stdin.end();
  await new Promise(r => ff.on('close', r));
  console.log(`wrote ${out} in ${((Date.now() - start) / 1000).toFixed(0)}s`);
  await browser.close();
}
main().catch(e => { console.error(e); process.exit(1); });

/* Render the Android launcher and notification icons from the logo's sofa.
   Run from the repo root:  node tools/android-icons.mjs
   Chromium does the rasterising, so there is no image library to install. */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { mkdir, readFile } from 'node:fs/promises';

const ROOT = '/home/user/spa-workd';
const RES = `${ROOT}/android/app/src/main/res`;

// Inlined rather than fetched: an <img> pointing at a URL makes every
// setContent wait on the network, which turns a two-second job into minutes.
const SOFA = 'data:image/png;base64,' +
  (await readFile(`${ROOT}/icons/sofa.png`)).toString('base64');

// Android density buckets. Legacy launcher icons are 48dp, adaptive
// foregrounds 108dp, status-bar icons 24dp.
const DPI = [
  ['mdpi', 1], ['hdpi', 1.5], ['xhdpi', 2], ['xxhdpi', 3], ['xxxhdpi', 4],
];

function page(css, body) {
  return `<style>html,body{margin:0;padding:0}${css}</style>${body}`;
}

const browser = await chromium.launch();

const sheet = await browser.newPage();

async function shoot(html, size, out) {
  await sheet.setViewportSize({ width: size, height: size });
  await sheet.setContent(html, { waitUntil: 'load' });
  await sheet.screenshot({ path: out, omitBackground: true });
}

for (const [bucket, scale] of DPI) {
  const mip = `${RES}/mipmap-${bucket}`;
  const draw = `${RES}/drawable-${bucket}`;
  await mkdir(mip, { recursive: true });
  await mkdir(draw, { recursive: true });

  // legacy square launcher icon, 48dp
  const legacy = Math.round(48 * scale);
  await shoot(page(
    `.t{width:${legacy}px;height:${legacy}px;border-radius:${Math.round(legacy * 0.22)}px;
      background:linear-gradient(135deg,#FDFDFB,#F1EFE7);display:grid;place-items:center;overflow:hidden}
     img{width:${Math.round(legacy * 0.76)}px;display:block}`,
    `<div class="t"><img src="${SOFA}"></div>`), legacy, `${mip}/ic_launcher.png`);

  // legacy round launcher icon, 48dp
  await shoot(page(
    `.t{width:${legacy}px;height:${legacy}px;border-radius:50%;
      background:linear-gradient(135deg,#FDFDFB,#F1EFE7);display:grid;place-items:center;overflow:hidden}
     img{width:${Math.round(legacy * 0.66)}px;display:block}`,
    `<div class="t"><img src="${SOFA}"></div>`), legacy, `${mip}/ic_launcher_round.png`);

  // adaptive foreground, 108dp, art kept inside the 72dp safe zone
  const fg = Math.round(108 * scale);
  await shoot(page(
    `.t{width:${fg}px;height:${fg}px;display:grid;place-items:center}
     img{width:${Math.round(fg * 0.58)}px;display:block}`,
    `<div class="t"><img src="${SOFA}"></div>`), fg, `${mip}/ic_launcher_foreground.png`);

  // status-bar icon, 24dp: a white silhouette, which Android then tints
  const stat = Math.round(24 * scale);
  await shoot(page(
    `.t{width:${stat}px;height:${stat}px;display:grid;place-items:center}
     .s{width:${Math.round(stat * 0.92)}px;height:${Math.round(stat * 0.92 * 265 / 461)}px;
        background:#fff;-webkit-mask:url(${SOFA}) center/contain no-repeat;
        mask:url(${SOFA}) center/contain no-repeat}`,
    `<div class="t"><div class="s"></div></div>`), stat, `${draw}/ic_stat_sofa.png`);

  console.log('icons', bucket);
}

await browser.close();

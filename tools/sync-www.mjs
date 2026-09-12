/* Collect the web app into www/ for Capacitor.
   The web app itself stays no-build and keeps living at the repo root; www/ is
   generated and gitignored, so nothing is duplicated in version control. */
import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const www = join(root, 'www');

// index.html and the assets it pulls in. Deliberately not the Artifact shell,
// the service worker (the APK ships its assets locally) or icons/logo-source.png.
const FILES = [
  'index.html',
  'styles.css',
  'app.js',
  'manifest.webmanifest',
  'icons/sofa.png',
  'icons/wordmark.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
];

await rm(www, { recursive: true, force: true });
await mkdir(www, { recursive: true });
for (const file of FILES) {
  const to = join(www, file);
  await mkdir(dirname(to), { recursive: true });
  await cp(join(root, file), to);
}
console.log(`www/: ${FILES.length} files`);

#!/usr/bin/env node
/**
 * Contact sheet for the `cloudburst-crossing-3d` figure generator.
 *
 *   npm run figures                        4 figures, the artwork's own seed
 *   npm run figures -- out.png 1234 6      path, seed, how many
 *
 * The ink caricatures are the hardest thing in that piece to get right and
 * the slowest to judge through a full 3D render, where they end up two
 * hundred pixels tall inside a minute-long capture. This boots the studio's
 * Vite server, draws the walk-cycle atlases straight into a page, and
 * screenshots them — the same code path the artwork uses, at a size you can
 * actually see, in a couple of seconds.
 */
import { createServer } from 'vite';
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PAGE = path.join(ROOT, '.figure-preview.html');
const OUT = process.argv[2] ?? path.join(ROOT, 'renders', 'cloudburst-crossing-3d', 'figures.png');
const SEED = Number(process.argv[3] ?? 517203);
const N = Number(process.argv[4] ?? 4);

await fs.writeFile(PAGE, `<!doctype html><html><body style="margin:0;background:#2b2f36">
<div id="sheet" style="display:flex;flex-wrap:wrap"></div>
<script type="module">
import { figureSpec, figureAtlas } from '/src/artworks/cloudburst-crossing-3d/figures.js';
import { createRandom } from '/src/shared/random.js';
const host = document.getElementById('sheet');
for (let i = 0; i < ${N}; i++) {
  const rng = createRandom(${SEED} + i * 7919);
  const spec = figureSpec(rng);
  const { texture } = figureAtlas(spec, () => createRandom(${SEED} + i * 104729), { cellH: 360 });
  const c = texture.image;
  c.style.width = '600px';
  c.style.background = '#3a4049';
  host.appendChild(c);
}
document.body.dataset.done = '1';
</script></body></html>`);

await fs.mkdir(path.dirname(OUT), { recursive: true });
const server = await createServer({ root: ROOT, server: { port: 0 }, logLevel: 'error' });
await server.listen();
const base = server.resolvedUrls.local[0].replace(/\/$/, '');
const url = `${base}/.figure-preview.html`;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1220, height: 1400 } });
page.on('pageerror', (e) => console.error('PAGE ERROR:', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.error('console:', m.text()); });
await page.goto(url, { waitUntil: 'networkidle' });
try {
  await page.waitForSelector('body[data-done="1"]', { timeout: 20000 });
} catch { console.error('timed out waiting for draw'); }
await page.locator('#sheet').screenshot({ path: OUT });
await browser.close();
await server.close();
await fs.rm(PAGE, { force: true });
console.log('wrote', OUT);

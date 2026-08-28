#!/usr/bin/env node
/**
 * Multi-seed renderer + contact sheet.
 *
 *   npm run render:grid -- <artwork-slug> [--count 12] [--base 483928]
 *
 * One good-looking seed proves nothing about a generative system. This renders
 * a run of seeds and composes them into a single sheet so the generator itself
 * can be judged, not one lucky output.
 *
 * Writes:
 *   renders/<slug>/grid/seed-<n>.png     one per seed
 *   renders/<slug>/contact-sheet.png     all of them, labelled
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  findArtwork,
  startStudio,
  launchBrowser,
  captureArtwork,
  parseArgs
} from './render-artwork.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RENDERS_DIR = path.join(ROOT, 'renders');

/** Sequential seeds from a base — reproducible and easy to talk about. */
function seedRun(base, count) {
  return Array.from({ length: count }, (_, i) => base + i);
}

/**
 * Compose the contact sheet in the browser: the tiles are embedded as data
 * URIs in a plain CSS grid and screenshotted. Avoids a native image library.
 */
async function composeSheet({ browser, tiles, title, outPath }) {
  const cols = Math.min(4, Math.ceil(Math.sqrt(tiles.length)));
  const tileSize = 420;
  const gap = 18;
  const pad = 28;
  const sheetWidth = cols * tileSize + (cols - 1) * gap + pad * 2;

  const cells = tiles
    .map(
      (t) => `
      <figure>
        <img src="data:image/png;base64,${t.base64}" alt="seed ${t.seed}" />
        <figcaption>seed ${t.seed}</figcaption>
      </figure>`
    )
    .join('');

  const html = `<!doctype html>
<html><head><meta charset="utf-8" /><style>
  * { box-sizing: border-box; margin: 0; }
  body { background: #14161a; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  #sheet { width: ${sheetWidth}px; padding: ${pad}px; background: #14161a; }
  h1 { color: #d8d6d2; font-size: 15px; font-weight: 500; margin-bottom: ${pad}px;
       letter-spacing: 0.06em; }
  #grid { display: grid; grid-template-columns: repeat(${cols}, ${tileSize}px); gap: ${gap}px; }
  figure { width: ${tileSize}px; }
  img { display: block; width: ${tileSize}px; height: auto; background: #000; }
  figcaption { color: #7d817f; font-size: 11px; padding-top: 6px; }
</style></head>
<body><div id="sheet"><h1>${title}</h1><div id="grid">${cells}</div></div></body></html>`;

  const page = await browser.newPage({ viewport: { width: sheetWidth, height: 900 }, deviceScaleFactor: 1 });
  try {
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluate(() =>
      Promise.all(
        [...document.images].map((img) => (img.complete ? null : img.decode().catch(() => null)))
      )
    );
    await page.locator('#sheet').screenshot({ path: outPath });
  } finally {
    await page.close();
  }
  return outPath;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const slug = args._[0];

  if (!slug || args.help) {
    console.log(`
Usage: npm run render:grid -- <artwork-slug> [options]

Options:
  --count <n>    How many seeds to render (default 12)
  --base <n>     First seed (default: the artwork's meta.seed)
  --seeds a,b,c  Render exactly these seeds instead of a run
  --no-sheet     Skip the contact sheet, keep the individual PNGs
  --timeout <ms> Per-render readiness timeout (default 60000)
`);
    process.exit(args.help || slug ? 0 : 1);
  }

  const artwork = await findArtwork(slug);
  const base = args.base !== undefined ? Number(args.base) : artwork.seed;
  const count = args.count !== undefined ? Number(args.count) : 12;
  const seeds = args.seeds
    ? String(args.seeds).split(',').map((s) => Number(s.trim()))
    : seedRun(base, count);

  if (seeds.some((s) => !Number.isFinite(s))) throw new Error('Seeds must be numbers.');

  const timeout = args.timeout ? Number(args.timeout) : 60_000;
  const gridDir = path.join(RENDERS_DIR, artwork.slug, 'grid');
  await fs.rm(gridDir, { recursive: true, force: true });
  await fs.mkdir(gridDir, { recursive: true });

  const studio = await startStudio();
  const browser = await launchBrowser();
  const rel = (p) => path.relative(ROOT, p);

  try {
    console.log(`Rendering ${seeds.length} seeds of ${artwork.slug} (${artwork.engine}) ...`);
    const tiles = [];
    for (const [i, seed] of seeds.entries()) {
      const outPath = path.join(gridDir, `seed-${seed}.png`);
      await captureArtwork({ browser, studioUrl: studio.url, artwork, seed, outPath, timeout });
      const buf = await fs.readFile(outPath);
      tiles.push({ seed, base64: buf.toString('base64') });
      process.stdout.write(`  [${i + 1}/${seeds.length}] seed ${seed}\n`);
    }

    console.log(`  -> ${rel(gridDir)}/`);

    if (!args['no-sheet']) {
      const sheetPath = path.join(RENDERS_DIR, artwork.slug, 'contact-sheet.png');
      await composeSheet({
        browser,
        tiles,
        title: `${artwork.title} — ${seeds.length} seeds (${seeds[0]}–${seeds.at(-1)})`,
        outPath: sheetPath
      });
      const buf = await fs.readFile(sheetPath);
      console.log(`  -> ${rel(sheetPath)}  ${(buf.length / 1024).toFixed(0)} KB`);
    }
  } finally {
    await browser.close();
    await studio.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`\nGrid render failed: ${err.message}\n`);
    process.exit(1);
  });
}

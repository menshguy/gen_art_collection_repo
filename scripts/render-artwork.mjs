#!/usr/bin/env node
/**
 * Headless renderer.
 *
 *   npm run render -- <artwork-slug>
 *   npm run render -- <artwork-slug> --seed 483928
 *
 * Boots a Vite server in-process (so nothing has to already be running on a
 * particular port), opens the artwork in capture mode, waits for the artwork's
 * own readiness signal rather than an arbitrary sleep, and writes a PNG.
 */

import { createServer } from 'vite';
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARTWORKS_DIR = path.join(ROOT, 'src', 'artworks');
const RENDERS_DIR = path.join(ROOT, 'renders');

/* --------------------------- artwork metadata --------------------------- */

export async function loadArtworks() {
  const entries = await fs.readdir(ARTWORKS_DIR, { withFileTypes: true });
  const out = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(ARTWORKS_DIR, entry.name);
    const metaPath = path.join(dir, 'meta.js');
    try {
      await fs.access(metaPath);
    } catch {
      continue;
    }
    const mod = await import(pathToFileURL(metaPath).href);
    const meta = mod.default ?? mod;
    out.push({
      slug: entry.name,
      dir,
      title: meta.title ?? entry.name,
      engine: meta.engine,
      seed: meta.seed ?? 1,
      width: meta.width ?? 1200,
      height: meta.height ?? 1200,
      animated: Boolean(meta.animated),
      captureFrames: meta.captureFrames ?? (meta.animated ? 60 : 1),
      description: meta.description ?? ''
    });
  }
  return out.sort((a, b) => a.slug.localeCompare(b.slug));
}

export async function findArtwork(slug) {
  const all = await loadArtworks();
  const found = all.find((a) => a.slug === slug);
  if (!found) {
    const names = all.map((a) => `  ${a.slug}  (${a.engine})`).join('\n');
    throw new Error(`Unknown artwork "${slug}".\nAvailable:\n${names || '  (none)'}`);
  }
  return found;
}

/* ------------------------------ studio server --------------------------- */

export async function startStudio() {
  const server = await createServer({
    root: ROOT,
    configFile: path.join(ROOT, 'vite.config.js'),
    logLevel: 'error',
    server: { port: 0, strictPort: false, host: '127.0.0.1' }
  });
  await server.listen();
  const url = server.resolvedUrls?.local?.[0];
  if (!url) {
    await server.close();
    throw new Error('Vite started but reported no local URL.');
  }
  return { server, url: url.replace(/\/$/, ''), close: () => server.close() };
}

export async function launchBrowser() {
  return chromium.launch({
    args: [
      // Software WebGL, so Three artworks render on a headless machine.
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--disable-lcd-text'
    ]
  });
}

/* -------------------------------- capture -------------------------------- */

/**
 * Render one artwork at one seed into `outPath`.
 * Returns { path, bytes, width, height }.
 */
export async function captureArtwork({ browser, studioUrl, artwork, seed, outPath, timeout = 60_000 }) {
  const page = await browser.newPage({
    viewport: { width: artwork.width, height: artwork.height },
    deviceScaleFactor: 1
  });

  const problems = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`console: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));

  const url = `${studioUrl}/?art=${encodeURIComponent(artwork.slug)}&seed=${seed}&capture=1`;

  try {
    await page.goto(url, { waitUntil: 'load', timeout });

    try {
      await page.waitForFunction(
        () => {
          const s = window.__ARTWORK_STATE__;
          return Boolean(s && (s.ready || s.error));
        },
        null,
        { timeout }
      );
    } catch {
      const partial = await page.evaluate(() => window.__ARTWORK_STATE__).catch(() => null);
      const detail = partial
        ? `frames drawn: ${partial.frame}, needs ${artwork.captureFrames}`
        : 'the studio never initialised (check for a module-load error)';
      throw new Error(
        `Timed out after ${timeout}ms waiting for "${artwork.slug}" to signal ready — ${detail}.` +
          (problems.length ? `\n${problems.slice(0, 5).join('\n')}` : '')
      );
    }

    const state = await page.evaluate(() => window.__ARTWORK_STATE__);
    if (state?.error) throw new Error(`Artwork threw while rendering:\n${state.error}`);

    const canvas = page.locator('#artwork-root canvas').first();
    if ((await canvas.count()) === 0) {
      throw new Error(`"${artwork.slug}" mounted but produced no canvas.`);
    }

    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await canvas.screenshot({ path: outPath, animations: 'allow' });

    const buf = await fs.readFile(outPath);
    const size = pngSize(buf);
    if (problems.length) {
      console.warn(`  ! browser reported ${problems.length} problem(s):`);
      for (const p of problems.slice(0, 5)) console.warn(`    ${p}`);
    }
    return { path: outPath, bytes: buf.length, ...size, problems };
  } finally {
    await page.close();
  }
}

/** Read width/height straight out of the PNG IHDR chunk. */
function pngSize(buf) {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return { width: 0, height: 0 };
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/* ---------------------------------- cli ---------------------------------- */

export function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token.startsWith('--')) {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) args[key] = true;
      else {
        args[key] = next;
        i++;
      }
    } else {
      args._.push(token);
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const slug = args._[0];

  if (!slug || args.help) {
    const all = await loadArtworks();
    console.log(`
Usage: npm run render -- <artwork-slug> [options]

Options:
  --seed <n>       Seed to render (default: the artwork's meta.seed)
  --out <path>     Explicit output file
  --timeout <ms>   Readiness timeout (default 60000)
  --open           Print the studio URL for this render

Artworks:
${all.map((a) => `  ${a.slug.padEnd(20)} ${a.engine.padEnd(6)} ${a.width}x${a.height}`).join('\n') || '  (none)'}
`);
    process.exit(args.help || slug ? 0 : 1);
  }

  const artwork = await findArtwork(slug);
  const seed = args.seed !== undefined ? Number(args.seed) : artwork.seed;
  if (!Number.isFinite(seed)) throw new Error(`--seed must be a number, got "${args.seed}"`);

  const timeout = args.timeout ? Number(args.timeout) : 60_000;
  const outDir = path.join(RENDERS_DIR, artwork.slug);
  const seedPath = path.join(outDir, `seed-${seed}.png`);
  const latestPath = path.join(outDir, 'latest.png');

  const studio = await startStudio();
  const browser = await launchBrowser();

  try {
    if (args.open) console.log(`studio: ${studio.url}/?art=${artwork.slug}&seed=${seed}`);
    console.log(`Rendering ${artwork.slug} (${artwork.engine}) seed ${seed} ...`);
    const result = await captureArtwork({
      browser,
      studioUrl: studio.url,
      artwork,
      seed,
      outPath: args.out ? path.resolve(args.out) : seedPath,
      timeout
    });

    if (!args.out) await fs.copyFile(seedPath, latestPath);

    const rel = (p) => path.relative(ROOT, p);
    console.log(`  ${rel(result.path)}  ${result.width}x${result.height}  ${(result.bytes / 1024).toFixed(0)} KB`);
    if (!args.out) console.log(`  ${rel(latestPath)}`);
  } finally {
    await browser.close();
    await studio.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`\nRender failed: ${err.message}\n`);
    process.exit(1);
  });
}

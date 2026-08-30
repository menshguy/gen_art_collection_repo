#!/usr/bin/env node
/**
 * Headless renderer.
 *
 *   npm run render -- <artwork-slug>
 *   npm run render -- <artwork-slug> --seed 483928
 *   npm run render -- <artwork-slug> --version 2
 *
 * With no --version this renders the artwork's latest version, which is what
 * the working files in src/artworks/<slug>/ always are. --version <n> renders
 * the frozen snapshot in versions/v<n>/ instead, using that version's own
 * meta.js, and writes to its own filenames so it can never overwrite the
 * latest version's latest.png.
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
import { resolveSize, parseAspect, formatSize } from '../src/shared/canvas-size.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARTWORKS_DIR = path.join(ROOT, 'src', 'artworks');
const RENDERS_DIR = path.join(ROOT, 'renders');

/* --------------------------- artwork metadata --------------------------- */

/** The archived version numbers under <dir>/versions, ascending. */
async function archivedVersions(dir) {
  try {
    const entries = await fs.readdir(path.join(dir, 'versions'), { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory() && /^v[1-9][0-9]*$/.test(e.name))
      .map((e) => Number(e.name.slice(1)))
      .sort((a, b) => a - b);
  } catch {
    return [];
  }
}

/** Read a meta.js into the flat shape the renderer and the studio both use. */
async function readMeta(metaPath, { slug, dir, version, isLatest }) {
  const mod = await import(pathToFileURL(metaPath).href);
  const meta = mod.default ?? mod;
  return {
    slug,
    dir,
    version,
    isLatest,
    title: meta.title ?? slug,
    engine: meta.engine,
    seed: meta.seed ?? 1,
    width: meta.width ?? 1200,
    height: meta.height ?? 1200,
    animated: Boolean(meta.animated),
    captureFrames: meta.captureFrames ?? (meta.animated ? 60 : 1),
    description: meta.description ?? ''
  };
}

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
    // The working files are always the latest version: one past the highest
    // archived number, exactly as the studio's registry derives it.
    const history = await archivedVersions(dir);
    const latest = history.length ? Math.max(...history) + 1 : 1;
    out.push({
      ...(await readMeta(metaPath, { slug: entry.name, dir, version: latest, isLatest: true })),
      history
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

/**
 * One version of one artwork. `version` undefined/null means the latest, so
 * the no-flag path is unchanged.
 */
export async function findArtworkVersion(slug, version) {
  const latest = await findArtwork(slug);
  if (version === undefined || version === null || version === '') return latest;

  const n = Number(version);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`--version must be a positive integer (got "${version}")`);
  }
  if (n === latest.version) return latest;

  const known = [...latest.history, latest.version].map((v) => `v${v}`).join(', ');
  if (!latest.history.includes(n)) {
    throw new Error(`"${slug}" has no version ${n}. Versions: ${known}.`);
  }

  const dir = path.join(latest.dir, 'versions', `v${n}`);
  return readMeta(path.join(dir, 'meta.js'), { slug, dir, version: n, isLatest: false });
}

/* --------------------------------- sizing -------------------------------- */

/**
 * Apply --width / --height / --aspect / --scale to an artwork, returning a
 * copy. meta.js stays the artwork's native size; these flags reframe a single
 * render, which is how you find out whether a composition crops badly at a
 * different shape without editing the piece.
 */
export function applySizeArgs(artwork, args) {
  if (args.aspect !== undefined && parseAspect(args.aspect) === null) {
    throw new Error(`--aspect must look like 16:9, 0.75, square or portrait (got "${args.aspect}")`);
  }
  for (const key of ['width', 'height', 'scale']) {
    if (args[key] === undefined) continue;
    const value = Number(args[key]);
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`--${key} must be a positive number (got "${args[key]}")`);
    }
  }

  const size = resolveSize(artwork, {
    width: args.width,
    height: args.height,
    aspect: args.aspect,
    scale: args.scale
  });

  return { ...artwork, width: size.width, height: size.height, size };
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

  // `v` is only sent for an archived version: the studio already defaults to
  // the latest, and leaving it off keeps the capture URL identical to before.
  const version = artwork.isLatest === false ? `&v=${artwork.version}` : '';
  const url =
    `${studioUrl}/?art=${encodeURIComponent(artwork.slug)}&seed=${seed}${version}` +
    `&w=${artwork.width}&h=${artwork.height}&capture=1`;

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

/* ------------------------------- safety net ------------------------------ */

/**
 * Warn when the auto-snapshot hook has never run.
 *
 * Rendering is the one command that happens on every pass of the visual loop,
 * which makes it the right place to notice that version history is not being
 * captured. The hook once stopped firing and stayed silent for days; this turns
 * that into something visible within one render.
 */
async function warnIfSafetyNetInactive() {
  const log = path.join(ROOT, '.claude', 'auto-snapshot.log');
  try {
    await fs.access(log);
  } catch {
    console.warn(
      '\n  ! The auto-snapshot hook has never run, so artwork edits are NOT being versioned.\n' +
        '    Run `npm run snapshot -- --doctor` to find out why (usually: open /hooks once,\n' +
        '    or restart the session, so Claude Code reloads .claude/settings.json).\n'
    );
  }
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
  --version <n>    Render an archived version instead of the latest one
                   (writes renders/<slug>/v<n>-*.png, never latest.png)
  --width <px>     Override the canvas width
  --height <px>    Override the canvas height
  --aspect <r>     Reshape at the same pixel count: 16:9, 4:5, 0.75,
                   square, portrait, landscape, wide, story, cinema.
                   Combined with --width or --height, that edge wins.
  --scale <f>      Multiply the final size (0.5 for a fast look, 2 for print)
  --out <path>     Explicit output file
  --timeout <ms>   Readiness timeout (default 60000)
  --open           Print the studio URL for this render

Artworks:
${
      all
        .map(
          (a) =>
            `  ${a.slug.padEnd(20)} ${a.engine.padEnd(6)} ${`${a.width}x${a.height}`.padEnd(11)} v${a.version}${
              a.history.length ? ` (v1–v${a.version} available)` : ''
            }`
        )
        .join('\n') || '  (none)'
    }
`);
    process.exit(args.help || slug ? 0 : 1);
  }

  const native = await findArtworkVersion(slug, args.version === true ? undefined : args.version);
  const artwork = applySizeArgs(native, args);
  const seed = args.seed !== undefined ? Number(args.seed) : artwork.seed;
  if (!Number.isFinite(seed)) throw new Error(`--seed must be a number, got "${args.seed}"`);

  const timeout = args.timeout ? Number(args.timeout) : 60_000;
  const outDir = path.join(RENDERS_DIR, artwork.slug);
  // A reframed render gets its own filename so it never overwrites the
  // artwork's native-size render of the same seed. An archived version is
  // prefixed for the same reason: `latest.png` must keep meaning "the newest
  // render of the latest version", so old versions never write to it.
  const prefix = artwork.isLatest ? '' : `v${artwork.version}-`;
  const suffix = artwork.size.overridden ? `@${formatSize(artwork.size)}` : '';
  const seedPath = path.join(outDir, `${prefix}seed-${seed}${suffix}.png`);
  const latestPath = path.join(outDir, 'latest.png');
  const writesLatest = !args.out && artwork.isLatest;

  await warnIfSafetyNetInactive();

  const studio = await startStudio();
  const browser = await launchBrowser();

  try {
    if (args.open) {
      console.log(
        `studio: ${studio.url}/?art=${artwork.slug}&seed=${seed}` +
          (artwork.isLatest ? '' : `&v=${artwork.version}`) +
          (artwork.size.overridden ? `&w=${artwork.width}&h=${artwork.height}` : '')
      );
    }
    console.log(
      `Rendering ${artwork.slug} v${artwork.version}${artwork.isLatest ? ' (latest)' : ' (archived)'}` +
        ` (${artwork.engine}) seed ${seed} at ${formatSize(artwork.size)}` +
        (artwork.size.overridden ? ` (native ${formatSize(artwork.size.native)}) ...` : ' ...')
    );
    const result = await captureArtwork({
      browser,
      studioUrl: studio.url,
      artwork,
      seed,
      outPath: args.out ? path.resolve(args.out) : seedPath,
      timeout
    });

    if (writesLatest) await fs.copyFile(seedPath, latestPath);

    const rel = (p) => path.relative(ROOT, p);
    console.log(`  ${rel(result.path)}  ${result.width}x${result.height}  ${(result.bytes / 1024).toFixed(0)} KB`);
    if (writesLatest) console.log(`  ${rel(latestPath)}`);
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

#!/usr/bin/env node
/**
 * Artwork contract validation.
 *
 *   npm run validate     (also runs as the first half of `npm run check`)
 *
 * Catches the mistakes that otherwise show up as a blank studio: a bad engine
 * name, a meta.js that disagrees with the files on disk, a slug the URL cannot
 * carry. Not a test framework — just the contract.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARTWORKS_DIR = path.join(ROOT, 'src', 'artworks');

const ENGINES = {
  p5: 'sketch.p5.js',
  three: 'scene.three.js'
};

const errors = [];
const warnings = [];

const fail = (slug, msg) => errors.push(`${slug}: ${msg}`);
const warn = (slug, msg) => warnings.push(`${slug}: ${msg}`);

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

function checkMeta(slug, meta) {
  if (typeof meta !== 'object' || meta === null) {
    fail(slug, 'meta.js must default-export an object');
    return false;
  }
  if (!meta.title || typeof meta.title !== 'string') fail(slug, 'meta.title must be a non-empty string');
  if (!Object.hasOwn(ENGINES, meta.engine)) {
    fail(slug, `meta.engine must be one of ${Object.keys(ENGINES).join(' | ')} (got ${JSON.stringify(meta.engine)})`);
    return false;
  }
  for (const key of ['seed', 'width', 'height']) {
    const value = meta[key];
    if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
      fail(slug, `meta.${key} must be a positive integer (got ${JSON.stringify(value)})`);
    }
  }
  if (meta.width > 8000 || meta.height > 8000) {
    warn(slug, `${meta.width}x${meta.height} is very large — headless capture may be slow or run out of memory`);
  }
  if (meta.animated !== undefined && typeof meta.animated !== 'boolean') {
    fail(slug, 'meta.animated must be a boolean');
  }
  if (meta.captureFrames !== undefined && (!Number.isInteger(meta.captureFrames) || meta.captureFrames < 1)) {
    fail(slug, 'meta.captureFrames must be a positive integer');
  }
  if (!meta.animated && meta.captureFrames > 1) {
    warn(slug, 'captureFrames > 1 on a still artwork has no effect unless it defines p.draw');
  }
  return true;
}

async function main() {
  if (!(await exists(ARTWORKS_DIR))) {
    console.error(`No src/artworks directory at ${ARTWORKS_DIR}`);
    process.exit(1);
  }

  const entries = await fs.readdir(ARTWORKS_DIR, { withFileTypes: true });
  const dirs = entries.filter((e) => e.isDirectory());
  const seen = new Map();
  const rows = [];

  for (const entry of dirs) {
    const slug = entry.name;
    const dir = path.join(ARTWORKS_DIR, slug);

    if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
      fail(slug, 'directory name must be a lowercase-kebab slug (it becomes ?art=<slug>)');
    }
    const lower = slug.toLowerCase();
    if (seen.has(lower)) fail(slug, `collides with "${seen.get(lower)}" on case-insensitive filesystems`);
    seen.set(lower, slug);

    const metaPath = path.join(dir, 'meta.js');
    if (!(await exists(metaPath))) {
      // A directory of loose files is a common half-finished state; name it.
      fail(slug, 'missing meta.js');
      continue;
    }

    let meta;
    try {
      const mod = await import(pathToFileURL(metaPath).href);
      meta = mod.default ?? mod;
    } catch (err) {
      fail(slug, `meta.js failed to import: ${err.message}`);
      continue;
    }

    if (!checkMeta(slug, meta)) continue;

    const expected = ENGINES[meta.engine];
    const expectedPath = path.join(dir, expected);
    if (!(await exists(expectedPath))) {
      fail(slug, `engine "${meta.engine}" requires ${expected}, which does not exist`);
      continue;
    }

    const source = await fs.readFile(expectedPath, 'utf8');
    if (!/export\s+default/.test(source)) {
      fail(slug, `${expected} has no default export (the host cannot mount it)`);
    }

    // One artwork, one engine. Two engine files in one directory means an
    // abandoned port that will silently never run.
    for (const [engine, file] of Object.entries(ENGINES)) {
      if (engine === meta.engine) continue;
      if (await exists(path.join(dir, file))) {
        fail(slug, `also contains ${file}; one artwork uses exactly one engine — make a separate artwork directory`);
      }
    }

    rows.push({
      slug,
      engine: meta.engine,
      size: `${meta.width}x${meta.height}`,
      seed: meta.seed,
      animated: meta.animated ? 'animated' : 'still'
    });
  }

  if (rows.length === 0 && errors.length === 0) {
    warnings.push('src/artworks is empty — nothing to validate');
  }

  console.log(`\nArtworks (${rows.length}):`);
  for (const r of rows) {
    console.log(
      `  ${r.slug.padEnd(22)} ${r.engine.padEnd(6)} ${r.size.padEnd(11)} seed ${String(r.seed).padEnd(9)} ${r.animated}`
    );
  }

  if (warnings.length) {
    console.log(`\nWarnings (${warnings.length}):`);
    for (const w of warnings) console.log(`  ! ${w}`);
  }

  if (errors.length) {
    console.log(`\nErrors (${errors.length}):`);
    for (const e of errors) console.log(`  x ${e}`);
    console.log('');
    process.exit(1);
  }

  console.log('\nAll artworks valid.\n');
}

main().catch((err) => {
  console.error(`Validation crashed: ${err.message}`);
  process.exit(1);
});

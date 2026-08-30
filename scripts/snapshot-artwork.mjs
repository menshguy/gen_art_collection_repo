#!/usr/bin/env node
/**
 * Artwork versioning.
 *
 *   npm run snapshot -- <artwork-slug> [--note "what this version is"]
 *   npm run snapshot -- <artwork-slug> --list
 *   npm run snapshot -- --list
 *
 * Freezes an artwork's CURRENT files into src/artworks/<slug>/versions/v<n>/
 * so the next edit produces a new latest version instead of destroying the old
 * one. Run this BEFORE editing an artwork, never after: the whole point is that
 * the code being archived is still the code that shipped.
 *
 * The archive is a full copy of the artwork directory (every file except the
 * versions/ tree itself, so multi-file pieces keep their helpers and shaders)
 * plus a version.json manifest holding what the snapshot itself knows: which
 * version it is, when it was taken, and an optional note.
 *
 * The one thing that is not copied verbatim is import paths. An archive sits
 * two directories deeper than the artwork, so a specifier that climbs out of
 * the artwork — `../../shared/random.js` — would resolve to the wrong place
 * and the version would fail to load. Those get two extra levels prepended.
 * Nothing else about the code is touched.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARTWORKS_DIR = path.join(ROOT, 'src', 'artworks');

const ENGINE_FILES = { p5: 'sketch.p5.js', three: 'scene.three.js' };

const rel = (p) => path.relative(ROOT, p);

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------- inspection ------------------------------ */

/** The archived version numbers under <dir>/versions, ascending. */
export async function archivedVersions(dir) {
  const versionsDir = path.join(dir, 'versions');
  if (!(await exists(versionsDir))) return [];
  const entries = await fs.readdir(versionsDir, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory() && /^v[1-9][0-9]*$/.test(e.name))
    .map((e) => Number(e.name.slice(1)))
    .sort((a, b) => a - b);
}

/**
 * Everything the CLI needs to know about one artwork's version history.
 * `latest` is the version number the working files currently represent.
 */
export async function versionState(slug) {
  const dir = path.join(ARTWORKS_DIR, slug);
  if (!(await exists(path.join(dir, 'meta.js')))) {
    throw new Error(`"${slug}" is not an artwork (no ${rel(path.join(dir, 'meta.js'))}).`);
  }

  const mod = await import(pathToFileURL(path.join(dir, 'meta.js')).href);
  const meta = mod.default ?? mod;
  const engineFile = ENGINE_FILES[meta.engine];
  if (!engineFile) {
    throw new Error(`"${slug}" declares unknown engine ${JSON.stringify(meta.engine)}.`);
  }
  if (!(await exists(path.join(dir, engineFile)))) {
    throw new Error(`"${slug}" declares engine "${meta.engine}" but has no ${engineFile}.`);
  }

  const history = await archivedVersions(dir);
  const latest = history.length ? Math.max(...history) + 1 : 1;

  const notes = new Map();
  for (const n of history) {
    const manifest = path.join(dir, 'versions', `v${n}`, 'version.json');
    if (!(await exists(manifest))) continue;
    try {
      notes.set(n, JSON.parse(await fs.readFile(manifest, 'utf8')));
    } catch {
      // A corrupt manifest is a display problem, not a reason to refuse work.
    }
  }

  return { slug, dir, meta, engineFile, history, latest, notes };
}

async function listAllArtworks() {
  const entries = await fs.readdir(ARTWORKS_DIR, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

/* -------------------------------- rewriting ------------------------------ */

/** How much deeper versions/v<n>/ sits than the artwork directory. */
const DEPTH_OFFSET = '../../';

/**
 * Prepend `../../` to every import specifier that climbs out of the artwork
 * directory, so the copy resolves shared modules from its deeper location.
 *
 * Specifiers starting with `./` are intra-artwork and are copied alongside the
 * code, so they need no adjustment. Bare specifiers ('p5', 'three') resolve
 * through node_modules and are already location-independent.
 */
export function rewriteImports(source) {
  let count = 0;
  const bump = (head, quote, spec) => {
    count += 1;
    return `${head}${quote}${DEPTH_OFFSET}${spec}${quote}`;
  };
  const out = source
    // import x from '../..', export * from '../..'
    .replace(/(\bfrom\s*)(['"])(\.\.\/[^'"]*)\2/g, (_, h, q, spec) => bump(h, q, spec))
    // import('../..')
    .replace(/(\bimport\s*\(\s*)(['"])(\.\.\/[^'"]*)\2/g, (_, h, q, spec) => bump(h, q, spec))
    // import '../..'  (side-effect only)
    .replace(/(\bimport\s+)(['"])(\.\.\/[^'"]*)\2/g, (_, h, q, spec) => bump(h, q, spec));
  return { source: out, count };
}

/** Every file in the artwork directory except the versions/ tree. */
async function artworkFiles(dir, prefix = '') {
  const entries = await fs.readdir(path.join(dir, prefix), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relPath = prefix ? path.join(prefix, entry.name) : entry.name;
    if (entry.isDirectory()) {
      if (!prefix && entry.name === 'versions') continue;
      files.push(...(await artworkFiles(dir, relPath)));
    } else if (entry.isFile()) {
      files.push(relPath);
    }
  }
  return files;
}

/* -------------------------------- snapshot ------------------------------- */

/**
 * Copy the working files into versions/v<latest>/.
 *
 * Refuses when the working engine file is byte-identical to the newest
 * archive: that means nothing has changed since the last snapshot, and
 * archiving again would push a duplicate into the drawer.
 */
export async function snapshot(
  slug,
  { note = '', force = false, sessionId = null, onUnchanged = 'throw' } = {}
) {
  const state = await versionState(slug);
  const { dir, meta, engineFile, latest } = state;

  const working = rewriteImports(await fs.readFile(path.join(dir, engineFile), 'utf8')).source;

  if (!force && state.history.length) {
    const previous = Math.max(...state.history);
    const previousFile = path.join(dir, 'versions', `v${previous}`, engineFile);
    if (await exists(previousFile)) {
      // Compared after rewriting, since that is the form the archive holds.
      if ((await fs.readFile(previousFile, 'utf8')) === working) {
        // For the auto-snapshot hook this is the happy path, not an error: the
        // state about to be edited is already safely archived as v<previous>.
        if (onUnchanged === 'skip') return { slug, skipped: 'unchanged', version: previous };
        throw new Error(
          `${slug}/${engineFile} is unchanged since v${previous}, so there is nothing new to archive.\n` +
            `  Edit the artwork first, or pass --force if you really want a duplicate version.`
        );
      }
    }
  }

  const target = path.join(dir, 'versions', `v${latest}`);
  if (await exists(target)) {
    throw new Error(`${rel(target)} already exists — refusing to overwrite an archived version.`);
  }

  const files = await artworkFiles(dir);
  let rewritten = 0;

  for (const file of files) {
    const from = path.join(dir, file);
    const to = path.join(target, file);
    await fs.mkdir(path.dirname(to), { recursive: true });

    // Only JS carries import specifiers; anything else is copied untouched.
    if (/\.(js|mjs)$/.test(file)) {
      const result = rewriteImports(await fs.readFile(from, 'utf8'));
      rewritten += result.count;
      await fs.writeFile(to, result.source);
    } else {
      await fs.copyFile(from, to);
    }
  }

  const manifest = {
    version: latest,
    slug,
    engine: meta.engine,
    file: engineFile,
    title: meta.title ?? slug,
    note: note || meta.versionNote || '',
    archivedAt: new Date().toISOString(),
    // Which Claude Code session archived this. The auto-snapshot hook reads it
    // to answer "have I already snapshotted this artwork in this session?".
    sessionId,
    files: files.sort(),
    rewrittenImports: rewritten
  };
  await fs.writeFile(path.join(target, 'version.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  return { slug, version: latest, next: latest + 1, target, manifest };
}

/* --------------------------------- doctor -------------------------------- */

/**
 * Is the safety net actually working?
 *
 * This exists because the auto-snapshot hook silently stopped firing and
 * nothing anywhere could tell us. It answers three questions that were
 * previously unanswerable: is the hook wired up, does its command resolve, and
 * has it ever actually run?
 */
export async function doctor() {
  const settingsPath = path.join(ROOT, '.claude', 'settings.json');
  const logPath = path.join(ROOT, '.claude', 'auto-snapshot.log');
  const problems = [];

  console.log('\nAuto-snapshot hook');

  let command = null;
  try {
    const settings = JSON.parse(await fs.readFile(settingsPath, 'utf8'));
    const entries = settings?.hooks?.PreToolUse ?? [];
    for (const entry of entries) {
      for (const h of entry.hooks ?? []) {
        if (h.type === 'command' && /auto-snapshot-hook/.test(h.command ?? '')) command = h.command;
      }
    }
  } catch (err) {
    problems.push(`could not read .claude/settings.json: ${err.message}`);
  }

  if (!command) {
    problems.push('no PreToolUse hook referencing auto-snapshot-hook.mjs in .claude/settings.json');
    console.log('  wired up        NO');
  } else {
    console.log('  wired up        yes');
    // The exact failure that broke it before: a path that only resolves from
    // one working directory, failing silently from anywhere else.
    const quoted = command.match(/"([^"]+)"/)?.[1] ?? '';
    const resolved = quoted.replace(/\$\{CLAUDE_PROJECT_DIR:-([^}]*)\}/, '$1');
    const ok = await exists(resolved);
    console.log(`  command path    ${ok ? 'resolves' : 'DOES NOT RESOLVE'}  ${resolved}`);
    if (!ok) problems.push(`the hook command path does not exist: ${resolved}`);
    if (/\$\{CLAUDE_PROJECT_DIR:-\.\}/.test(command)) {
      problems.push('the hook falls back to a relative path — it will not fire from another cwd');
    }
  }

  if (await exists(logPath)) {
    const lines = (await fs.readFile(logPath, 'utf8')).trim().split('\n').filter(Boolean);
    const archived = lines.filter((l) => l.includes('ARCHIVED')).length;
    console.log(`  invocations     ${lines.length} logged, ${archived} archived a version`);
    console.log(`  last activity   ${lines.at(-1) ?? '(none)'}`);
  } else {
    console.log('  invocations     NEVER RAN (no .claude/auto-snapshot.log)');
    problems.push(
      'the hook has never run. If you just added or changed it, open /hooks once in Claude Code ' +
        'to reload settings (or restart the session) — hooks are read at session start.'
    );
  }

  // Drift: an artwork whose working files differ from its newest archive has
  // unversioned changes. Normal mid-session; suspicious if it is every artwork.
  console.log('\nArtworks');
  for (const slug of await listAllArtworks()) {
    let state;
    try {
      state = await versionState(slug);
    } catch {
      continue;
    }
    let status = 'no history yet';
    if (state.history.length) {
      const newest = Math.max(...state.history);
      const archived = path.join(state.dir, 'versions', `v${newest}`, state.engineFile);
      const working = rewriteImports(
        await fs.readFile(path.join(state.dir, state.engineFile), 'utf8')
      ).source;
      const same = (await exists(archived)) && (await fs.readFile(archived, 'utf8')) === working;
      status = same ? `v${newest} archived, no changes since` : `changed since v${newest}`;
    }
    console.log(`  ${slug.padEnd(24)} v${state.latest}  ${status}`);
  }

  if (problems.length) {
    console.log(`\nProblems (${problems.length}):`);
    for (const p of problems) console.log(`  x ${p}`);
    console.log('');
    return 1;
  }
  console.log('\nThe safety net is live.\n');
  return 0;
}

/* ---------------------------------- cli ---------------------------------- */

function parseArgs(argv) {
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

async function printHistory(slug) {
  const state = await versionState(slug);
  console.log(`\n${state.meta.title ?? slug}  (${slug}, ${state.meta.engine})`);
  // Columns: version, state, archive date, note — so the notes read as a list.
  const row = (n, state_, when, note) =>
    `  ${`v${n}`.padEnd(4)} ${state_.padEnd(10)} ${when.padEnd(12)} ${note}`;
  console.log(row(state.latest, 'latest', '', state.meta.versionNote || '(working files)'));
  for (const n of [...state.history].reverse()) {
    const info = state.notes.get(n);
    console.log(
      row(n, 'archived', info?.archivedAt ? info.archivedAt.slice(0, 10) : '', info?.note ?? '')
    );
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const slug = args._[0];

  if (args.help || (!slug && !args.list && !args.doctor)) {
    const all = await listAllArtworks();
    console.log(`
Usage: npm run snapshot -- <artwork-slug> [options]

Archives the artwork's current files as a version, so the edit you are about
to make becomes a NEW latest version and the old one stays viewable in the
studio's version drawer. Run it BEFORE you edit.

Options:
  --note "<text>"  What the version being archived is / was
  --list           Show the version history instead of archiving
  --doctor         Check that the auto-snapshot hook is wired up and firing
  --force          Archive even if nothing has changed since the last version

Artworks:
${all.map((s) => `  ${s}`).join('\n') || '  (none)'}
`);
    process.exit(args.help ? 0 : 1);
  }

  if (args.doctor) {
    process.exit(await doctor());
  }

  if (args.list) {
    const slugs = slug ? [slug] : await listAllArtworks();
    for (const s of slugs) {
      try {
        await printHistory(s);
      } catch (err) {
        console.log(`\n${s}\n  ! ${err.message}`);
      }
    }
    console.log('');
    return;
  }

  const note = typeof args.note === 'string' ? args.note : '';
  const result = await snapshot(slug, {
    note,
    force: Boolean(args.force),
    sessionId: typeof args.session === 'string' ? args.session : null
  });

  console.log(`\nArchived ${slug} v${result.version} -> ${rel(result.target)}`);
  console.log(
    `  ${result.manifest.files.length} file(s)` +
      (result.manifest.rewrittenImports
        ? `, ${result.manifest.rewrittenImports} import path(s) re-based`
        : '')
  );
  if (result.manifest.note) console.log(`  note: ${result.manifest.note}`);
  console.log(
    `  The working files are now v${result.next}. Edit them; v${result.version} stays viewable\n` +
      `  in the studio drawer and at ?art=${slug}&v=${result.version}.\n`
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`\nVersioning failed: ${err.message}\n`);
    process.exit(1);
  });
}

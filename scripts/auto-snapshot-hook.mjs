#!/usr/bin/env node
/**
 * Auto-snapshot hook (PreToolUse on Edit / Write).
 *
 * Version history cannot depend on anyone remembering to run a command. This
 * runs before every file edit and, the FIRST time a given session touches a
 * given artwork, archives that artwork's current files as a version. The edit
 * then lands on what is, by definition, a new latest version.
 *
 * One snapshot per artwork per session — not per edit — so the render-critique
 * -fix loop produces one drawer entry rather than twelve. "Already snapshotted
 * in this session" is recorded as sessionId inside the newest version.json, so
 * the state lives with the archive and survives anything restarting.
 *
 * Reads the hook payload on stdin; see the contract at the bottom. It fails
 * CLOSED: if an artwork needs archiving and archiving does not work, the edit
 * is blocked rather than allowed to overwrite history.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { snapshot, versionState } from './snapshot-artwork.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARTWORKS_DIR = path.join(ROOT, 'src', 'artworks');
const LOG = path.join(ROOT, '.claude', 'auto-snapshot.log');

/**
 * Record every invocation, including the no-ops.
 *
 * The first version of this hook logged nothing, so when it silently stopped
 * firing there was no way to tell "ran and decided to skip" from "never ran at
 * all" — and the failure went unnoticed across several sessions. A log line per
 * call makes that distinction checkable (`npm run snapshot -- --doctor`).
 */
async function log(decision, detail = '') {
  try {
    const line = `${new Date().toISOString()}  ${decision.padEnd(18)} ${detail}\n`;
    await fs.mkdir(path.dirname(LOG), { recursive: true });
    await fs.appendFile(LOG, line);
  } catch {
    // Logging must never be the reason an edit fails.
  }
}

/** Allow the tool call through, optionally telling the user and the model. */
function allow(message, context) {
  if (message || context) {
    const out = { suppressOutput: !message };
    if (message) out.systemMessage = message;
    if (context) {
      out.hookSpecificOutput = { hookEventName: 'PreToolUse', additionalContext: context };
    }
    process.stdout.write(JSON.stringify(out));
  }
  process.exit(0);
}

/** Block the edit. Exit 2 feeds stderr back to the model to act on. */
function block(reason) {
  process.stderr.write(reason);
  process.exit(2);
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * The artwork slug a path belongs to, or null.
 * Returns { slug, inVersions } so archived files can be handled separately.
 */
function artworkOf(filePath) {
  const rel = path.relative(ARTWORKS_DIR, path.resolve(filePath));
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  const parts = rel.split(path.sep);
  if (parts.length < 2) return null; // the artworks dir itself
  return { slug: parts[0], inVersions: parts[1] === 'versions' };
}

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/** The sessionId recorded in the newest archived version, if any. */
async function lastSnapshotSession(dir, history) {
  if (!history.length) return null;
  const manifest = path.join(dir, 'versions', `v${Math.max(...history)}`, 'version.json');
  try {
    return JSON.parse(await fs.readFile(manifest, 'utf8')).sessionId ?? null;
  } catch {
    return null;
  }
}

async function main() {
  const raw = await readStdin();
  let payload;
  try {
    payload = JSON.parse(raw || '{}');
  } catch {
    allow(); // A payload we cannot read is not a reason to block an edit.
  }

  const filePath = payload?.tool_input?.file_path;
  if (typeof filePath !== 'string' || !filePath) {
    await log('skip:no-path', payload?.tool_name ?? '');
    allow();
  }

  const target = artworkOf(filePath);
  if (!target) {
    // Not artwork code — studio, scripts, docs. Logged at low volume on purpose.
    await log('skip:not-artwork', path.relative(ROOT, filePath));
    allow();
  }

  // Archived versions are immutable. Blocking here is the point: an edit to a
  // frozen version silently rewrites history that is supposed to be evidence.
  if (target.inVersions) {
    await log('block:frozen', path.relative(ROOT, filePath));
    block(
      `Refusing to edit ${path.relative(ROOT, filePath)}: files under versions/ are frozen ` +
        `snapshots of earlier versions.\nEdit the working files at src/artworks/${target.slug}/ ` +
        `instead — they are the latest version, and this hook archives them for you.`
    );
  }

  const { slug } = target;
  const dir = path.join(ARTWORKS_DIR, slug);

  // A brand-new artwork has nothing to archive; it starts life as v1.
  if (!(await exists(path.join(dir, 'meta.js')))) {
    await log('skip:new-artwork', slug);
    allow();
  }

  let state;
  try {
    state = await versionState(slug);
  } catch {
    // Half-written artwork (meta.js exists, engine file does not yet).
    await log('skip:incomplete', slug);
    allow();
  }
  if (!(await exists(path.join(dir, state.engineFile)))) {
    await log('skip:incomplete', slug);
    allow();
  }

  const sessionId = payload?.session_id ?? null;
  if (sessionId && (await lastSnapshotSession(dir, state.history)) === sessionId) {
    await log('skip:same-session', `${slug} session=${sessionId}`);
    allow(); // Already archived this artwork in this session.
  }

  let result;
  try {
    result = await snapshot(slug, { sessionId, onUnchanged: 'skip' });
  } catch (err) {
    await log('BLOCK:failed', `${slug} ${err.message.split('\n')[0]}`);
    block(
      `Auto-snapshot of "${slug}" failed, so this edit was blocked to avoid losing the ` +
        `current version.\n${err.message}\n\n` +
        `Fix the cause, or run \`npm run snapshot -- ${slug}\` manually, then retry the edit.`
    );
  }

  if (result.skipped === 'unchanged') {
    await log('skip:unchanged', `${slug} already archived as v${result.version}`);
    allow(); // Pre-edit state is already archived as v<result.version>.
  }

  await log('ARCHIVED', `${slug} v${result.version} -> working files are v${result.next}`);
  allow(
    `Archived ${slug} v${result.version} — your edit becomes v${result.next}`,
    `Auto-snapshot: "${slug}" v${result.version} was archived to ` +
      `src/artworks/${slug}/versions/v${result.version}/ before this edit. The working files ` +
      `are now v${result.next}, which is what the studio selects by default. Do NOT run ` +
      `\`npm run snapshot\` for this artwork again in this session — iterate freely; ` +
      `further edits stay within v${result.next}.`
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(async (err) => {
    // An unexpected crash must not silently disable history.
    await log('CRASH', err.message);
    block(`Auto-snapshot hook crashed: ${err.stack ?? err.message}`);
  });
}

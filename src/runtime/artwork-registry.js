/**
 * Artwork discovery and versioning.
 *
 * Drop a directory into src/artworks/ containing meta.js plus either
 * sketch.p5.js or scene.three.js and it appears in the studio. There is no
 * list to edit anywhere.
 *
 * Versions
 * --------
 * The files at the top of an artwork directory are ALWAYS the latest version:
 *
 *   src/artworks/<slug>/meta.js            latest meta
 *   src/artworks/<slug>/sketch.p5.js       latest artwork
 *   src/artworks/<slug>/versions/v1/       a frozen snapshot of version 1
 *   src/artworks/<slug>/versions/v2/       a frozen snapshot of version 2
 *
 * Each versions/v<n>/ directory is a byte-faithful copy of what that version
 * shipped (its own meta.js and its own engine file, because an older version
 * may have had a different size, seed or even title) plus a version.json
 * manifest written by `npm run snapshot`.
 *
 * The latest version number is therefore derived, never stored: it is one more
 * than the highest archived number. Archiving is what advances it, which is why
 * `npm run snapshot -- <slug>` must run BEFORE an artwork is edited.
 */

const metaModules = import.meta.glob('../artworks/*/meta.js', { eager: true });
const p5Modules = import.meta.glob('../artworks/*/sketch.p5.js');
const threeModules = import.meta.glob('../artworks/*/scene.three.js');

const versionMetaModules = import.meta.glob('../artworks/*/versions/*/meta.js', { eager: true });
const versionManifestModules = import.meta.glob('../artworks/*/versions/*/version.json', {
  eager: true
});
const versionP5Modules = import.meta.glob('../artworks/*/versions/*/sketch.p5.js');
const versionThreeModules = import.meta.glob('../artworks/*/versions/*/scene.three.js');

/** `../artworks/foo/meta.js` -> `foo` */
const slugOf = (path) => path.split('/').at(-2);
/** `../artworks/foo/versions/v2/meta.js` -> `foo` */
const versionSlugOf = (path) => path.split('/').at(-4);
/** `../artworks/foo/versions/v2/meta.js` -> 2 */
const versionNumberOf = (path) => Number(path.split('/').at(-2).replace(/^v/, ''));

const defaultOf = (mod) => mod?.default ?? mod;

/**
 * One runnable thing: a specific version of a specific artwork. This is what
 * the hosts mount, so every field the hosts read comes from the meta.js that
 * shipped with that version — not from the latest one.
 */
function makeVersion({ slug, version, isLatest, meta, load, manifest }) {
  return {
    slug,
    version,
    isLatest,
    title: meta.title ?? slug,
    engine: meta.engine,
    seed: meta.seed ?? 1,
    width: meta.width ?? 1200,
    height: meta.height ?? 1200,
    animated: Boolean(meta.animated),
    // Frames to render before a capture is considered settled.
    captureFrames: meta.captureFrames ?? (meta.animated ? 60 : 1),
    description: meta.description ?? '',
    tags: meta.tags ?? [],
    // What this version is. The archive records it in version.json at snapshot
    // time; the latest version can describe itself with meta.versionNote.
    note: manifest?.note ?? meta.versionNote ?? '',
    archivedAt: manifest?.archivedAt ?? null,
    load
  };
}

/* --------------------------- archived versions --------------------------- */

/** slug -> [version entry, ...] ascending, latest excluded. */
const archived = new Map();

for (const [path, mod] of Object.entries(versionMetaModules)) {
  const slug = versionSlugOf(path);
  const version = versionNumberOf(path);
  if (!Number.isInteger(version) || version < 1) continue;

  const meta = defaultOf(mod);
  const dir = `../artworks/${slug}/versions/v${version}`;
  const load =
    meta.engine === 'three'
      ? versionThreeModules[`${dir}/scene.three.js`]
      : versionP5Modules[`${dir}/sketch.p5.js`];
  const manifest = defaultOf(versionManifestModules[`${dir}/version.json`]);

  if (!archived.has(slug)) archived.set(slug, []);
  archived.get(slug).push(makeVersion({ slug, version, isLatest: false, meta, load, manifest }));
}

for (const list of archived.values()) list.sort((a, b) => a.version - b.version);

/* ------------------------------- artworks -------------------------------- */

const artworks = new Map();

for (const [path, mod] of Object.entries(metaModules)) {
  const slug = slugOf(path);
  const meta = defaultOf(mod);
  const history = archived.get(slug) ?? [];

  // Derived, not stored: the working files are one past the highest archive.
  const latestNumber = history.length ? Math.max(...history.map((v) => v.version)) + 1 : 1;
  const latest = makeVersion({
    slug,
    version: latestNumber,
    isLatest: true,
    meta,
    load:
      meta.engine === 'three'
        ? threeModules[`../artworks/${slug}/scene.three.js`]
        : p5Modules[`../artworks/${slug}/sketch.p5.js`]
  });

  // Newest first: the drawer reads top-down as "most recent history first",
  // and `versions[0]` is always the default selection.
  const versions = [latest, ...[...history].reverse()];

  artworks.set(slug, {
    // The artwork IS its latest version, so every existing caller that reads
    // `artwork.engine` / `.width` / `.load` keeps working untouched.
    ...latest,
    versions,
    latest,
    hasHistory: history.length > 0
  });
}

/** All artworks, alphabetical by title. */
export function listArtworks() {
  return [...artworks.values()].sort((a, b) => a.title.localeCompare(b.title));
}

export function getArtwork(slug) {
  return artworks.get(slug) ?? null;
}

/**
 * A specific version of an artwork. `version` null/undefined means the latest,
 * which is what an URL with no `?v=` asks for.
 */
export function getArtworkVersion(slug, version) {
  const artwork = artworks.get(slug);
  if (!artwork) return null;
  if (version === null || version === undefined || version === '') return artwork.latest;
  const n = Number(version);
  if (!Number.isFinite(n)) return artwork.latest;
  return artwork.versions.find((v) => v.version === n) ?? null;
}

/** First artwork in the list — used when no ?art= is given. */
export function defaultArtwork() {
  return listArtworks()[0] ?? null;
}

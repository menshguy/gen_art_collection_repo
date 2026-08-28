/**
 * Artwork discovery.
 *
 * Drop a directory into src/artworks/ containing meta.js plus either
 * sketch.p5.js or scene.three.js and it appears in the studio. There is no
 * list to edit anywhere.
 */

const metaModules = import.meta.glob('../artworks/*/meta.js', { eager: true });
const p5Modules = import.meta.glob('../artworks/*/sketch.p5.js');
const threeModules = import.meta.glob('../artworks/*/scene.three.js');

const slugOf = (path) => path.split('/').at(-2);

const artworks = new Map();

for (const [path, mod] of Object.entries(metaModules)) {
  const slug = slugOf(path);
  const meta = mod.default ?? mod;
  const p5Path = `../artworks/${slug}/sketch.p5.js`;
  const threePath = `../artworks/${slug}/scene.three.js`;

  artworks.set(slug, {
    slug,
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
    load: meta.engine === 'three' ? threeModules[threePath] : p5Modules[p5Path]
  });
}

/** All artworks, alphabetical by title. */
export function listArtworks() {
  return [...artworks.values()].sort((a, b) => a.title.localeCompare(b.title));
}

export function getArtwork(slug) {
  return artworks.get(slug) ?? null;
}

/** First artwork in the list — used when no ?art= is given. */
export function defaultArtwork() {
  return listArtworks()[0] ?? null;
}

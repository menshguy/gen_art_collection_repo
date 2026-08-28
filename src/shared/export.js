/**
 * In-browser PNG export.
 *
 * This is for saving a frame while you are looking at it in the studio.
 * Automated/headless renders go through `npm run render` (scripts/render-artwork.mjs),
 * which is the path Claude should use when critiquing its own work.
 */

/** `flow-study_seed-483928_2026-08-28T12-04-11.png` */
export function renderFilename(slug, seed, ext = 'png') {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `${slug}_seed-${seed}_${stamp}.${ext}`;
}

/** Save any canvas element as a PNG download. */
export function saveCanvas(canvas, filename = 'artwork.png') {
  if (!canvas) throw new Error('saveCanvas: no canvas given');
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }, 'image/png');
}

/** Save the artwork currently mounted in the studio. */
export function saveArtwork(slug, seed) {
  const canvas = document.querySelector('#artwork-root canvas');
  if (!canvas) throw new Error('saveArtwork: no artwork canvas mounted');
  saveCanvas(canvas, renderFilename(slug, seed));
}

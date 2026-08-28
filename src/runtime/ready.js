/**
 * The readiness signal that makes automated capture reliable.
 *
 * scripts/render-artwork.mjs waits for `window.__ARTWORK_STATE__.ready`
 * instead of sleeping for an arbitrary number of milliseconds, so a slow
 * scene is never screenshotted half-drawn.
 */

const state = {
  ready: false,
  frame: 0,
  slug: null,
  seed: null,
  engine: null,
  error: null
};

if (typeof window !== 'undefined') window.__ARTWORK_STATE__ = state;

export function beginArtwork({ slug, seed, engine }) {
  state.ready = false;
  state.frame = 0;
  state.slug = slug;
  state.seed = seed;
  state.engine = engine;
  state.error = null;
  if (typeof document !== 'undefined') delete document.body.dataset.artworkReady;
  return state;
}

export function tickFrame() {
  state.frame += 1;
  return state.frame;
}

export function signalReady() {
  if (state.ready) return;
  state.ready = true;
  if (typeof document !== 'undefined') document.body.dataset.artworkReady = '1';
}

export function signalError(err) {
  state.error = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err);
  if (typeof document !== 'undefined') document.body.dataset.artworkError = '1';
}

export function artworkState() {
  return state;
}

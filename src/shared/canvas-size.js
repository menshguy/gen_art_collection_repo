/**
 * Canvas size and aspect overrides.
 *
 * meta.js gives an artwork its native size. This module lets that size be
 * overridden without editing the artwork — from the studio toolbar, from the
 * URL (`?w=&h=`), or from the render CLI (`--width --height --aspect --scale`)
 * — so a composition that crops badly at one shape can be re-shot at another.
 *
 * Plain ESM with no Vite-only syntax: the browser studio and the Node render
 * scripts import the same rules, so what you see in the studio is what
 * `npm run render` writes.
 */

/** Hard limits. Below MIN a sketch has no room; above MAX headless capture starts failing. */
export const MIN_EDGE = 64;
export const MAX_EDGE = 8000;

/**
 * Named ratios, ordered as they appear in the studio dropdown.
 * `value` is width / height.
 */
export const ASPECT_PRESETS = [
  { id: '9:16', label: '9:16 story', value: 9 / 16 },
  { id: '2:3', label: '2:3 portrait', value: 2 / 3 },
  { id: '3:4', label: '3:4 portrait', value: 3 / 4 },
  { id: '4:5', label: '4:5 portrait', value: 4 / 5 },
  { id: '1:1', label: '1:1 square', value: 1 },
  { id: '5:4', label: '5:4 landscape', value: 5 / 4 },
  { id: '4:3', label: '4:3 landscape', value: 4 / 3 },
  { id: '3:2', label: '3:2 landscape', value: 3 / 2 },
  { id: '16:9', label: '16:9 wide', value: 16 / 9 },
  { id: '2:1', label: '2:1 wide', value: 2 },
  { id: '21:9', label: '21:9 cinema', value: 21 / 9 }
];

/** Friendly words accepted by --aspect in addition to the preset ids. */
const ASPECT_ALIASES = {
  square: '1:1',
  portrait: '2:3',
  landscape: '3:2',
  wide: '16:9',
  story: '9:16',
  cinema: '21:9'
};

const clampEdge = (n) => Math.min(MAX_EDGE, Math.max(MIN_EDGE, Math.round(n)));

/**
 * "16:9" | "16x9" | "16/9" | "1.777" | "square" -> width / height.
 * Returns null for anything unusable, so callers can report a bad flag.
 */
export function parseAspect(input) {
  if (input === null || input === undefined || input === '' || input === true) return null;
  if (typeof input === 'number') return Number.isFinite(input) && input > 0 ? input : null;

  const raw = String(input).trim().toLowerCase();
  const key = ASPECT_ALIASES[raw] ?? raw;

  const pair = key.match(/^(\d+(?:\.\d+)?)\s*[:x/]\s*(\d+(?:\.\d+)?)$/);
  if (pair) {
    const w = Number(pair[1]);
    const h = Number(pair[2]);
    return w > 0 && h > 0 ? w / h : null;
  }

  const single = Number(key);
  return Number.isFinite(single) && single > 0 ? single : null;
}

/** The preset id whose ratio matches width/height, or null for a custom shape. */
export function matchAspect(width, height, tolerance = 0.005) {
  if (!(width > 0) || !(height > 0)) return null;
  const ratio = width / height;
  let best = null;
  for (const preset of ASPECT_PRESETS) {
    const error = Math.abs(preset.value - ratio) / preset.value;
    if (error <= tolerance && (best === null || error < best.error)) best = { id: preset.id, error };
  }
  return best?.id ?? null;
}

/**
 * Resolve a final canvas size from an artwork's native size plus overrides.
 *
 *   { width, height }  both given  -> used as-is
 *   { width }  or  { height }      -> the other edge follows `aspect`, or the native ratio
 *   { aspect }  alone              -> reshaped at constant pixel area, so render cost holds
 *   { scale }                      -> multiplies whatever the above produced
 *
 * `native` is { width, height } from meta.js. Always returns a usable size.
 */
export function resolveSize(native, overrides = {}) {
  const base = {
    width: Number.isFinite(native?.width) && native.width > 0 ? native.width : 1200,
    height: Number.isFinite(native?.height) && native.height > 0 ? native.height : 1200
  };

  const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
  };

  const wanted = { width: num(overrides.width), height: num(overrides.height) };
  const aspect = parseAspect(overrides.aspect);
  const scale = num(overrides.scale) ?? 1;

  let width;
  let height;

  if (wanted.width && wanted.height) {
    ({ width, height } = wanted);
  } else if (wanted.width) {
    width = wanted.width;
    height = width / (aspect ?? base.width / base.height);
  } else if (wanted.height) {
    height = wanted.height;
    width = height * (aspect ?? base.width / base.height);
  } else if (aspect) {
    // Keep the pixel count the artwork was tuned at; only change its shape.
    const area = base.width * base.height;
    width = Math.sqrt(area * aspect);
    height = width / aspect;
  } else {
    ({ width, height } = base);
  }

  width = clampEdge(width * scale);
  height = clampEdge(height * scale);

  return {
    width,
    height,
    native: base,
    overridden: width !== base.width || height !== base.height
  };
}

/** Overrides carried by a URL / query string. Only explicit w & h travel. */
export function readSizeParams(params) {
  const get = (key) => {
    const value = params.get(key);
    if (value === null || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const width = get('w');
  const height = get('h');
  const aspect = params.get('aspect');
  return {
    ...(width ? { width } : {}),
    ...(height ? { height } : {}),
    ...(aspect ? { aspect } : {})
  };
}

/** `1600x900` — used in filenames and status text. */
export function formatSize({ width, height }) {
  return `${width}x${height}`;
}

/**
 * A small library of deliberately constrained palettes.
 *
 * These exist to discourage `color = random(rainbow)`. Each palette has a
 * background, a few structural colours, and one accent used sparingly.
 * Treat them as starting points — a piece built around a reference image
 * should derive its own palette from that image instead.
 */

export const palettes = {
  // Warm paper, iron marks, one oxidised red. Print-like.
  ferrous: {
    bg: '#e8e2d6',
    colors: ['#2b2724', '#5c534a', '#8a7f70', '#b3a893'],
    accent: '#a8341f'
  },
  // Cold ink on bone. High contrast, architectural.
  blueprint: {
    bg: '#f2f0eb',
    colors: ['#16243a', '#2f4a6d', '#59728f', '#93a5b6'],
    accent: '#d4622a'
  },
  // Night field. Low-key, for luminous work — not neon.
  nocturne: {
    bg: '#0d1013',
    colors: ['#1c2329', '#2f3d45', '#516a6f', '#8fa3a6'],
    accent: '#e0c887'
  },
  // Dry earth. Muted, dusty, good for dense mark-making.
  sediment: {
    bg: '#ded5c6',
    colors: ['#3d3227', '#6b5642', '#997a56', '#c0a179'],
    accent: '#3f5a52'
  },
  // Pale green-grey with a single deep note. Quiet, botanical.
  lichen: {
    bg: '#e6e7e0',
    colors: ['#2c3630', '#4f5f52', '#7d8c78', '#a9b3a0'],
    accent: '#b8563f'
  },
  // Near-monochrome. Forces value and density to do the work.
  graphite: {
    bg: '#f4f4f2',
    colors: ['#111111', '#3a3a3a', '#6e6e6e', '#a5a5a5'],
    accent: '#1f5fbf'
  }
};

export const paletteNames = Object.keys(palettes);

/** Look up a palette by name, falling back to a sensible default. */
export function getPalette(name = 'ferrous') {
  return palettes[name] ?? palettes.ferrous;
}

/** Deterministically choose a palette with a seeded rng. */
export function pickPalette(rng) {
  return palettes[paletteNames[Math.floor(rng() * paletteNames.length)]];
}

/** '#rrggbb' -> { r, g, b } with components in 0..255. */
export function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const int = parseInt(full, 16);
  return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 };
}

/** { r, g, b } (0..255) -> '#rrggbb'. */
export function rgbToHex({ r, g, b }) {
  const to = (v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

/** Blend two hex colours. t=0 -> a, t=1 -> b. */
export function mixHex(a, b, t) {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  return rgbToHex({
    r: ca.r + (cb.r - ca.r) * t,
    g: ca.g + (cb.g - ca.g) * t,
    b: ca.b + (cb.b - ca.b) * t
  });
}

/** 'rgba(r,g,b,alpha)' from a hex colour — handy for layered marks. */
export function withAlpha(hex, alpha) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Perceived luminance 0..1. Use it to keep contrast deliberate. */
export function luminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

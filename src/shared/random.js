/**
 * Seeded randomness.
 *
 * Everything here is deterministic: the same seed always produces the same
 * sequence, so an artwork can be refined against a locked seed and reproduced
 * later. Keep this file small — it is a toolkit, not a framework.
 */

/** Hash a string or number into a well-distributed 32-bit integer seed. */
export function hashSeed(value) {
  const str = String(value);
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Mulberry32 PRNG. Fast, tiny, good enough for visual work.
 * Returns a function producing floats in [0, 1).
 */
export function mulberry32(seed) {
  let a = hashSeed(seed);
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Create a seeded random helper bundle.
 *
 *   const rng = createRandom(483928)
 *   rng()            -> float in [0,1)
 *   rng.range(2, 8)  -> float in [2,8)
 *   rng.pick(items)  -> one item
 */
export function createRandom(seed) {
  const next = mulberry32(seed);

  const rng = () => next();

  rng.seed = seed;

  /** Float in [min, max). */
  rng.range = (min, max) => min + next() * (max - min);

  /** Integer in [min, max] inclusive. */
  rng.int = (min, max) => Math.floor(min + next() * (max - min + 1));

  /** True with probability p. */
  rng.chance = (p = 0.5) => next() < p;

  /** Uniform pick. */
  rng.pick = (arr) => arr[Math.floor(next() * arr.length)];

  /**
   * Weighted pick. `weights[i]` corresponds to `items[i]`.
   * Use this instead of uniform choice when some outcomes should dominate.
   */
  rng.weighted = (items, weights) => {
    let total = 0;
    for (const w of weights) total += w;
    let r = next() * total;
    for (let i = 0; i < items.length; i++) {
      r -= weights[i];
      if (r <= 0) return items[i];
    }
    return items[items.length - 1];
  };

  /** Normal distribution (Box-Muller). Clusters values around `mean`. */
  rng.gaussian = (mean = 0, sd = 1) => {
    let u = 0;
    let v = 0;
    while (u === 0) u = next();
    while (v === 0) v = next();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };

  /**
   * Skewed value in [0,1): exponent > 1 biases toward 0, < 1 toward 1.
   * Useful for scale hierarchies — many small things, few large ones.
   */
  rng.skew = (exponent = 2) => Math.pow(next(), exponent);

  /** Fisher-Yates, returns a new array. */
  rng.shuffle = (arr) => {
    const out = arr.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  };

  /** Symmetric jitter in [-amount, amount]. */
  rng.jitter = (amount = 1) => (next() * 2 - 1) * amount;

  /** Random point on the unit circle. */
  rng.onCircle = (radius = 1) => {
    const a = next() * Math.PI * 2;
    return { x: Math.cos(a) * radius, y: Math.sin(a) * radius };
  };

  /** Uniformly distributed point inside a circle (not clustered at centre). */
  rng.inCircle = (radius = 1) => {
    const a = next() * Math.PI * 2;
    const r = Math.sqrt(next()) * radius;
    return { x: Math.cos(a) * r, y: Math.sin(a) * r };
  };

  return rng;
}

/**
 * Poisson-disc sampling (Bridson). Produces evenly-spaced-but-not-gridded
 * points — the default choice when "scattered" should not mean "clumped
 * and gappy". `minDist` may be a number or a function (x, y) => number
 * for density that varies across the canvas.
 */
export function poissonDisc({ width, height, minDist, tries = 20, rng = Math.random }) {
  const distAt = typeof minDist === 'function' ? minDist : () => minDist;
  const minR = typeof minDist === 'function' ? findMinRadius(width, height, distAt) : minDist;
  const cell = minR / Math.SQRT2;
  const cols = Math.ceil(width / cell);
  const rows = Math.ceil(height / cell);
  const grid = new Array(cols * rows).fill(-1);
  const points = [];
  const active = [];

  const insert = (p) => {
    const gx = Math.floor(p.x / cell);
    const gy = Math.floor(p.y / cell);
    grid[gy * cols + gx] = points.length;
    points.push(p);
    active.push(points.length - 1);
  };

  const fits = (p, r) => {
    if (p.x < 0 || p.y < 0 || p.x >= width || p.y >= height) return false;
    const gx = Math.floor(p.x / cell);
    const gy = Math.floor(p.y / cell);
    const span = Math.ceil(r / cell) + 1;
    for (let y = Math.max(0, gy - span); y <= Math.min(rows - 1, gy + span); y++) {
      for (let x = Math.max(0, gx - span); x <= Math.min(cols - 1, gx + span); x++) {
        const idx = grid[y * cols + x];
        if (idx === -1) continue;
        const other = points[idx];
        const dx = other.x - p.x;
        const dy = other.y - p.y;
        const need = Math.max(r, distAt(other.x, other.y));
        if (dx * dx + dy * dy < need * need) return false;
      }
    }
    return true;
  };

  insert({ x: rng() * width, y: rng() * height });

  while (active.length) {
    const ai = Math.floor(rng() * active.length);
    const parent = points[active[ai]];
    const pr = distAt(parent.x, parent.y);
    let placed = false;
    for (let i = 0; i < tries; i++) {
      const a = rng() * Math.PI * 2;
      const d = pr * (1 + rng());
      const cand = { x: parent.x + Math.cos(a) * d, y: parent.y + Math.sin(a) * d };
      if (fits(cand, distAt(cand.x, cand.y))) {
        insert(cand);
        placed = true;
        break;
      }
    }
    if (!placed) active.splice(ai, 1);
  }

  return points;
}

function findMinRadius(width, height, distAt) {
  let min = Infinity;
  for (let y = 0; y <= 8; y++) {
    for (let x = 0; x <= 8; x++) {
      min = Math.min(min, distAt((x / 8) * width, (y / 8) * height));
    }
  }
  return Math.max(1, min);
}

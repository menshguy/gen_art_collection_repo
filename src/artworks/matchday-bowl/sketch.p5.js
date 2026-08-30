/**
 * Matchday Bowl
 *
 * Four interacting systems, no scattered primitives:
 *
 *   1. a pinhole projection of a superelliptic bowl of revolution — this
 *      carries the whole composition, because the convergence of the seat
 *      rows *is* the composition;
 *   2. a seat lattice on that bowl whose garment colour is drawn from a
 *      patchy allegiance field, so the crowd reads as two supporter masses
 *      bleeding into each other rather than as coloured noise;
 *   3. an analytic sun: every seat tests its own ray against the overhang
 *      above it, and the stadium rim is shadow-projected onto the turf to
 *      give the pitch its hard curved edge;
 *   4. steering agents on the grass, free to run out of frame.
 *
 * Every seat jumps on its own phase and its own rate. Coherence is a property
 * of the moment, not of position: ordinary cheering is incoherent, and a goal
 * pulls one support — only the one that scored — onto a common beat.
 */

import { createRandom } from '../../shared/random.js';
import { hexToRgb, rgbToHex, withAlpha, mixHex } from '../../shared/palettes.js';
import { clamp, lerp, smoothstep, TAU } from '../../shared/math.js';

export default function sketch(p, ctx) {
  const { width, height, noise } = ctx;
  let rng = createRandom(ctx.seed);

  /* ------------------------------ 3D scaffolding ------------------------ */

  const v3 = (x, y, z) => ({ x, y, z });
  const sub = (a, b) => v3(a.x - b.x, a.y - b.y, a.z - b.z);
  const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
  const cross = (a, b) =>
    v3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
  const norm = (a) => {
    const l = Math.hypot(a.x, a.y, a.z) || 1;
    return v3(a.x / l, a.y / l, a.z / l);
  };

  // High on one sideline, near a corner, so the near stand recedes to the
  // upper left and the pitch falls away to the lower right.
  const CAM = v3(76, 54, 74);
  const TARGET = v3(-50, 20, 10);
  const FOV = 36;

  const FWD = norm(sub(TARGET, CAM));
  const RIGHT = norm(cross(FWD, v3(0, 1, 0)));
  const UP = cross(RIGHT, FWD);
  const FOCAL = (height * 0.5) / Math.tan((FOV * Math.PI) / 360);

  /** World point -> { x, y, z, s }; s is pixels per world metre. Null if behind. */
  function project(pt) {
    const ex = pt.x - CAM.x;
    const ey = pt.y - CAM.y;
    const ez = pt.z - CAM.z;
    const z = ex * FWD.x + ey * FWD.y + ez * FWD.z;
    if (z < 5) return null;
    const s = FOCAL / z;
    return {
      x: width * 0.5 + (ex * RIGHT.x + ey * RIGHT.y + ez * RIGHT.z) * s,
      y: height * 0.5 - (ex * UP.x + ey * UP.y + ez * UP.z) * s,
      z,
      s
    };
  }

  /* ------------------------------ bowl plan ----------------------------- */

  const PITCH_HALF_X = 52.5;
  const PITCH_HALF_Z = 34;

  // The bowl wraps the pitch as a rounded rectangle offset — which is what a
  // real stadium is, and it keeps the seating a constant distance from the
  // touchline instead of cutting inside the corners the way an oval does.
  // Everything is walked by arc length, so seat spacing is exactly uniform
  // and rows run dead straight down the sidelines.
  const BASE = 6; // metres from the pitch rectangle to the innermost ring

  const ringLength = (d) => 4 * PITCH_HALF_X + 4 * PITCH_HALF_Z + TAU * (BASE + d);

  /**
   * Point at arc length `sArc` around the ring `d` metres out, with the
   * outward normal. Walks: right side, corner, top, corner, left, corner,
   * bottom, corner.
   */
  function planArc(sArc, d) {
    const r = BASE + d;
    const A = PITCH_HALF_X;
    const B = PITCH_HALF_Z;
    const quarter = (Math.PI * r) / 2;
    const total = 4 * A + 4 * B + TAU * r;
    let t = sArc % total;
    if (t < 0) t += total;

    if (t < 2 * B) {
      return { x: A + r, z: -B + t, nx: 1, nz: 0 };
    }
    t -= 2 * B;
    if (t < quarter) {
      const a = t / r;
      return { x: A + r * Math.cos(a), z: B + r * Math.sin(a), nx: Math.cos(a), nz: Math.sin(a) };
    }
    t -= quarter;
    if (t < 2 * A) {
      return { x: A - t, z: B + r, nx: 0, nz: 1 };
    }
    t -= 2 * A;
    if (t < quarter) {
      const a = Math.PI / 2 + t / r;
      return { x: -A + r * Math.cos(a), z: B + r * Math.sin(a), nx: Math.cos(a), nz: Math.sin(a) };
    }
    t -= quarter;
    if (t < 2 * B) {
      return { x: -A - r, z: B - t, nx: -1, nz: 0 };
    }
    t -= 2 * B;
    if (t < quarter) {
      const a = Math.PI + t / r;
      return { x: -A + r * Math.cos(a), z: -B + r * Math.sin(a), nx: Math.cos(a), nz: Math.sin(a) };
    }
    t -= quarter;
    if (t < 2 * A) {
      return { x: -A + t, z: -B - r, nx: 0, nz: -1 };
    }
    t -= 2 * A;
    const a = (3 * Math.PI) / 2 + t / r;
    return { x: A + r * Math.cos(a), z: -B + r * Math.sin(a), nx: Math.cos(a), nz: Math.sin(a) };
  }

  /**
   * Tiers, measured outward from the innermost ring. Each upper tier hangs
   * over the one below, which is what puts the back rows into deep shade.
   */
  const DECKS = [
    { d0: 1, d1: 30, y0: 1.8, y1: 20.0, rows: 34 },
    { d0: 27, d1: 42, y0: 26.5, y1: 36.5, rows: 17 },
    { d0: 39, d1: 72, y0: 40.5, y1: 67.0, rows: 33 }
  ];
  const ROOF = { d: 62, y: 79 }; // canopy lip above the top tier
  const OVERHANG = 10; // how far each soffit reaches back inward
  const SEAT_GAP = 0.52;

  /* --------------------------- seeded daylight -------------------------- */

  /** How far a ring reaches along (ux, uz) — the support of the bowl. */
  function ringSupport(ux, uz, d) {
    const len = ringLength(d);
    let best = -Infinity;
    for (let i = 0; i < 96; i++) {
      const q = planArc((i / 96) * len, d);
      const v = q.x * ux + q.z * uz;
      if (v > best) best = v;
    }
    return best;
  }

  /** Rescale a colour to a fixed luminance, keeping its hue. */
  function atLuminance(c, target) {
    const l = 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
    const k = target / (l || 1);
    return [c[0] * k, c[1] * k, c[2] * k];
  }

  /**
   * Every seed gets its own sun: direction, strength and colour.
   *
   * Azimuth and time of day are sampled, but elevation is *solved*. The rim's
   * shadow edge lands at `ringSupport - throw` along the sun axis, so deciding
   * where that edge should cross the pitch fixes the throw, and the throw fixes
   * the elevation. Sampling elevation instead would sometimes light the whole
   * pitch and sometimes bury it — both read as flat — so solving it is what
   * makes strong light/shadow contrast a property of every seed rather than
   * a lucky one.
   *
   * Sun and sky are then held at fixed luminance and varied only in hue, so a
   * dusk seed is as bright as a midday seed, just a different temperature.
   */
  function buildLight(rand) {
    // Direction swings across a 150-degree arc rather than the full circle.
    // The bowl's principal crowd mass faces +z; letting the sun behind it
    // would leave every visible stand in shade, which is contrast on paper but
    // a uniformly dark frame in practice. This keeps that mass lit while the
    // shadow's orientation still changes completely from seed to seed.
    const az = rand.range(Math.PI * 1.08, Math.PI * 1.92);
    const ux = Math.cos(az);
    const uz = Math.sin(az);

    // 0 = low raking light (dawn / sunset), 1 = high neutral midday.
    const tod = rand.range(0, 1);

    // Where the shadow edge crosses the pitch, as a signed fraction of the
    // pitch's own reach along the sun axis. The range is deliberately narrow:
    // it has to leave a substantial wedge of grass on *both* sides of the line
    // for every seed, which is the whole point of solving for elevation.
    const cross = lerp(-0.22, 0.42, tod);
    const rimReach = ringSupport(ux, uz, ROOF.d);
    const pitchReach = Math.abs(ux) * PITCH_HALF_X + Math.abs(uz) * PITCH_HALF_Z;
    const throwLen = Math.max(30, rimReach - cross * pitchReach);
    const elev = Math.atan2(ROOF.y, throwLen);

    const stops = [
      { sun: [1.0, 0.60, 0.32], sky: [0.52, 0.44, 0.90] }, // sunset, violet shade
      { sun: [1.0, 0.86, 0.64], sky: [0.58, 0.64, 0.94] }, // golden hour
      { sun: [1.0, 0.99, 0.97], sky: [0.62, 0.78, 1.0] } //  midday, blue shade
    ];
    const f = tod * (stops.length - 1);
    const i0 = Math.min(stops.length - 2, Math.floor(f));
    const k = f - i0;
    const blend = (key) => stops[i0][key].map((v, j) => lerp(v, stops[i0 + 1][key][j], k));

    const sun = atLuminance(blend('sun'), 1.0);
    const sky = atLuminance(blend('sky'), 0.72);

    return {
      dir: norm(v3(ux * Math.cos(elev), Math.sin(elev), uz * Math.cos(elev))),
      sun: { r: sun[0], g: sun[1], b: sun[2] },
      sky: { r: sky[0], g: sky[1], b: sky[2] },
      tod,
      elev,
      gain: lerp(0.78, 1.05, tod) * rand.range(0.96, 1.08),
      amb: 0.48 * rand.range(0.94, 1.06),
      veil: lerp(0.26, 0.38, tod)
    };
  }

  // Its own stream, so the light does not shift when crowd sampling changes.
  const LIGHT = buildLight(createRandom(`${ctx.seed}:light`));
  const SUN = LIGHT.dir;
  const SUN_C = LIGHT.sun;
  const SKY_C = LIGHT.sky;

  /** Drop a point straight down its sun ray onto the turf plane. */
  const groundShadow = (pt) => {
    const t = pt.y / SUN.y;
    return v3(pt.x - t * SUN.x, 0, pt.z - t * SUN.z);
  };

  /** Does direct sun reach a seat at (normal, d, y)? 0..1, with a sharp edge. */
  function sunlight(nx, nz, d, y, deckIndex) {
    const above = deckIndex < DECKS.length - 1 ? DECKS[deckIndex + 1] : null;
    const edgeD = above ? above.d0 - OVERHANG * 0.35 : ROOF.d;
    const edgeY = above ? above.y0 : ROOF.y;
    if (y >= edgeY) return 1;
    const radial = SUN.x * nx + SUN.z * nz; // >0 means the sun is behind the stand
    const t = (edgeY - y) / SUN.y;
    const reach = d + t * radial;
    // Soft edge so the shadow line reads as a boundary, not a hard clip.
    return smoothstep(edgeD + 0.9, edgeD - 0.9, reach);
  }

  /* -------------------------------- palette ----------------------------- */

  /* --------------------------- teams and support ------------------------ */

  // Two kits per seed. Each team contributes three crowd colours — first
  // strip, change strip and a trim — because an end is never ten thousand
  // copies of one shirt.
  const KIT_STOCK = [
    { main: '#2b57a4', alt: '#1d3364', trim: '#7fa6dd' }, // royal
    { main: '#b4302c', alt: '#7d1f20', trim: '#e0a7a0' }, // crimson
    { main: '#efc02a', alt: '#c99a17', trim: '#f5e3a4' }, // gold
    { main: '#1f6b3c', alt: '#14492a', trim: '#8dc2a1' }, // forest
    { main: '#66b6e0', alt: '#3f8cba', trim: '#d6ecf7' }, // sky
    { main: '#6d2440', alt: '#4a1730', trim: '#c58ea3' }, // claret
    { main: '#e2701f', alt: '#b8541a', trim: '#f6c193' }, // tangerine
    { main: '#eae6dc', alt: '#cfc9bb', trim: '#9aa0a6' }, // white
    { main: '#23262c', alt: '#3a3e46', trim: '#8f949b' }, // black
    { main: '#4a2f77', alt: '#33205a', trim: '#a893c9' }, // violet
    { main: '#1d7a7a', alt: '#12595c', trim: '#93cccb' }, // teal
    { main: '#8c1f5a', alt: '#5f1440', trim: '#d193b4' }  // magenta
  ];

  const lum = (hex) => {
    const c = hexToRgb(hex);
    return (c.r * 0.299 + c.g * 0.587 + c.b * 0.114) / 255;
  };
  /** Rough perceptual distance between two kits' first strips. */
  const kitGap = (a, b) => {
    const ca = hexToRgb(a.main);
    const cb = hexToRgb(b.main);
    return Math.hypot(ca.r - cb.r, ca.g - cb.g, ca.b - cb.b) / 441 + Math.abs(lum(a.main) - lum(b.main)) * 0.5;
  };

  // The second kit is drawn far enough from the first in hue and value that
  // the two supports can never read as one mass at seat scale.
  const TEAMS = (() => {
    const first = rng.int(0, KIT_STOCK.length - 1);
    const order = rng.shuffle(KIT_STOCK.map((_, i) => i));
    const ok = order.find((i) => i !== first && kitGap(KIT_STOCK[first], KIT_STOCK[i]) > 0.42);
    const second = ok !== undefined ? ok : order.find((i) => i !== first);
    return [KIT_STOCK[first], KIT_STOCK[second]];
  })();

  /**
   * How the ground is filled, as a spectrum rather than a switch:
   *
   *   uniform — one support has the place to itself, and still is not wearing
   *             one identical shirt: first strip, change strip, trim, plus the
   *             few who turned up in the other lot's colours;
   *   split   — two masses in whatever proportion this fixture drew, sitting
   *             apart, because supporters sit with their own;
   *   neutral — a crowd in its own clothes and nobody's colours.
   */
  const CROWD = (() => {
    const mode = rng.weighted(['uniform', 'split', 'neutral'], [3.5, 4, 2.5]);
    if (mode === 'uniform') {
      const side = rng.chance(0.5);
      return {
        mode,
        partisan: rng.range(0.78, 0.93),
        mix: side ? rng.range(0.9, 0.99) : rng.range(0.01, 0.1),
        seg: rng.range(0.35, 0.7)
      };
    }
    if (mode === 'split') {
      // Anything from a travelling end of two thousand to an even house.
      return { mode, partisan: rng.range(0.76, 0.92), mix: rng.range(0.18, 0.82), seg: rng.range(0.8, 0.98) };
    }
    return { mode, partisan: rng.range(0.08, 0.26), mix: rng.range(0.35, 0.65), seg: rng.range(0.1, 0.45) };
  })();

  /* -------------------------------- palette ----------------------------- */

  // The pale majority the sun blows toward white, plus ordinary clothes, skin
  // and hair. These carry a neutral crowd on their own.
  const NEUTRALS = [
    '#efeae0', '#dcd5c6', '#f6f3ec', '#2b2d35', '#c1926c', '#7a6350',
    '#7d8a99', '#8a7a5e', '#9a5b4a', '#4a5a6b', '#b9b3a4', '#3f4a44'
  ];
  const NEUTRAL_W = [0.17, 0.11, 0.12, 0.09, 0.08, 0.06, 0.07, 0.06, 0.06, 0.06, 0.07, 0.05];

  const GARMENTS = [
    TEAMS[0].main, TEAMS[0].alt, TEAMS[0].trim,
    TEAMS[1].main, TEAMS[1].alt, TEAMS[1].trim,
    ...NEUTRALS
  ];

  /** Garment weights for an end belonging to team 0 or team 1. */
  function endWeights(team) {
    const w = new Array(GARMENTS.length).fill(0);
    const p = CROWD.partisan;
    // Even a home end carries some away colours: people in the wrong shirt,
    // and people whose coat simply is that colour.
    const loyalty = 0.87;
    const share = [0.68, 0.21, 0.11];
    for (let i = 0; i < 3; i++) {
      w[team * 3 + i] += p * loyalty * share[i];
      w[(1 - team) * 3 + i] += p * (1 - loyalty) * share[i];
    }
    for (let i = 0; i < NEUTRALS.length; i++) w[6 + i] = (1 - p) * NEUTRAL_W[i];
    return w;
  }
  const HOME = endWeights(0);
  const AWAY = endWeights(1);
  const GWEIGHT = new Array(GARMENTS.length).fill(0);

  /** Weighted index draw — GARMENTS may repeat a hex, so indices, not values. */
  function pickGarment(w) {
    let total = 0;
    for (let i = 0; i < w.length; i++) total += w[i];
    let r = rng() * total;
    for (let i = 0; i < w.length; i++) {
      r -= w[i];
      if (r <= 0) return i;
    }
    return w.length - 1;
  }

  const LEVELS = 8;

  /**
   * Light any surface under this seed's sun. Everything visible goes through
   * here, which is what keeps a dusk seed coherent: grass, steel, kits and
   * shirts all shift temperature together instead of only the crowd.
   *
   * Two tinted terms — an ambient fill in the sky's colour, which is all a
   * shadowed surface receives, plus a superlinear direct term in the sun's.
   * Mixing toward white instead would grey out the team blocks and would make
   * every seed the same temperature.
   */
  function shade(hex, t, veilMul = 0.4) {
    const { r, g, b } = hexToRgb(hex);
    const amb = LIGHT.amb;
    const dir = LIGHT.gain * t * t;
    let rr = r * (amb * SKY_C.r + dir * SUN_C.r);
    let gg = g * (amb * SKY_C.g + dir * SUN_C.g);
    let bb = b * (amb * SKY_C.b + dir * SUN_C.b);
    // Bounced skylight, so shadow keeps its hue rather than going to mud.
    const bounce = (1 - t) * 26;
    rr += bounce * SKY_C.r;
    gg += bounce * SKY_C.g;
    bb += bounce * SKY_C.b;
    // Veiling glare: hard sun washes colour out, it does not saturate it.
    const veil = LIGHT.veil * veilMul * t * t;
    rr = lerp(rr, 252 * SUN_C.r, veil);
    gg = lerp(gg, 250 * SUN_C.g, veil);
    bb = lerp(bb, 246 * SUN_C.b, veil);
    return rgbToHex({ r: rr, g: gg, b: bb });
  }

  // garment x lighting level, flattened, so the draw loop never mixes colour.
  const SEAT_COLOR = [];
  for (let g = 0; g < GARMENTS.length; g++) {
    for (let l = 0; l < LEVELS; l++) SEAT_COLOR.push(shade(GARMENTS[g], l / (LEVELS - 1), 1));
  }
  const SPARK = shade('#fffdf0', 1, 1);
  const SEAT_DARK = shade('#39435c', 0.10);

  // The crowd is rasterised into a pixel buffer rather than drawn with tens of
  // thousands of fillRect calls, so colours are pre-packed little-endian RGBA.
  const pack = (hex) => {
    const { r, g, b } = hexToRgb(hex);
    return ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
  };
  const SEAT_COLOR32 = SEAT_COLOR.map(pack);
  const SPARK32 = pack(SPARK);
  const SEAT_DARK32 = pack(SEAT_DARK);

  // Two mow tones, lit and shadowed by the same sun as everything else.
  const GRASS_BASE = ['#6a9c3a', '#5f8f33'];
  const GRASS_SUN = GRASS_BASE.map((c) => shade(c, 1));
  const GRASS_SHADE = GRASS_BASE.map((c) => shade(c, 0.06));
  const STEEL = shade('#445980', 0.40);
  const STEEL_DARK = shade('#2b3a58', 0.04);
  // The stand fascia carries the colours of whoever fills the ground.
  const DOMINANT = TEAMS[CROWD.mix >= 0.5 ? 0 : 1];
  const FASCIA = shade(mixHex('#25467f', DOMINANT.alt, 0.55), 0.34);
  const FASCIA_LIT = shade(mixHex('#3a63aa', DOMINANT.main, 0.5), 0.86);
  const BG = shade('#1b2540', 0.08);
  const TICK = withAlpha(shade('#e2ecfa', 0.9), 0.72);

  /* ------------------------- allegiance + jump fields ------------------- */

  // Biased to the arc this camera can see: a seam behind the lens is a seam
  // that never existed as far as the picture is concerned.
  const SPLIT_ANGLE = 2.5 + rng.jitter(1.4);

  /**
   * Signed allegiance. Positive is the first team's ground, negative the
   * second's. Two things read it: what a seat *wears*, blended across the seam
   * by how segregated this house is, and who a seat *supports*, which is a
   * hard question with no in-between.
   */
  function allegianceField(px, pz, d) {
    // The proportion moves the seam around the bowl instead of diluting either
    // mass, so a small travelling support gets a small wedge and the rest of
    // the ground is the other lot.
    const bias = (CROWD.mix - 0.5) * 2.6;
    const patch =
      noise.fbm2D(px * 0.016, pz * 0.016 + d * 0.02, { octaves: 4 }) * lerp(1.15, 0.14, CROWD.seg);
    return Math.cos(Math.atan2(pz, px) - SPLIT_ANGLE) + bias + patch;
  }

  // Segregation sets how crisp the seam is. Supporters sit with their own,
  // so a split house wants a hard edge and a neutral one wants none.
  const SEAM_SOFT = lerp(1.4, 0.1, CROWD.seg);

  /* ------------------------------ seat build ---------------------------- */

  // One bucket set per (tier, depth band). Depth bands give painter's order
  // inside a tier; the tier tag gives it between tiers.
  const BANDS = 9;
  const bands = [];
  for (let tier = 0; tier < 3; tier++) {
    for (let i = 0; i < BANDS; i++) {
      bands.push({ tier, zSum: 0, n: 0, buckets: new Map(), spark: [], dark: [] });
    }
  }

  // Flat arrays: one seat is 6 consecutive floats. Keeps the hot loop
  // allocation-free at ~40k marks a frame.
  const SX = [];
  const SY = [];
  const SW = [];
  const SH = [];
  const SPHASE = [];
  const SRATE = [];
  const SAMP = [];
  const SGATE = [];
  const SFAN = [];
  let LIFT = new Float32Array(0);
  let FAN = new Uint8Array(0);
  // Seats held by each support, counted rather than assumed: the majority is
  // the whole basis of who gets to score.
  const FAN_COUNT = [0, 0];
  let SUPPORT = 0;

  function buildSeats() {
    const margin = 60;
    for (let k = 0; k < DECKS.length; k++) {
      const deck = DECKS[k];
      for (let r = 0; r < deck.rows; r++) {
        const rf = deck.rows > 1 ? r / (deck.rows - 1) : 0;
        const d = lerp(deck.d0, deck.d1, rf);
        const y = lerp(deck.y0, deck.y1, rf);

        // Rows stagger by half a seat, as real seating bowls do.
        const total = ringLength(d);
        let sArc = (r % 2) * SEAT_GAP * 0.5;
        while (sArc < total) {
          const pl = planArc(sArc, d);
          const pr = project(v3(pl.x, y, pl.z));

          let step = 3.0;
          if (pr) {
            // Far rows thin out to roughly a seat per pixel: past that the
            // marks only overdraw each other.
            step = Math.max(SEAT_GAP, 1.25 / pr.s);
            const on =
              pr.x > -margin && pr.x < width + margin && pr.y > -margin && pr.y < height + margin;
            if (on) {
              // A seat's own value wanders around whatever the shadow test
              // says, so neither the lit nor the shaded mass goes flat.
              const lit = sunlight(pl.nx, pl.nz, d, y, k);
              const grain = noise.noise2D(pl.x * 0.55, pl.z * 0.55) * 0.5 + 0.5;
              const jitterLit = clamp(lerp(0.06, 0.74, lit) + grain * lerp(0.14, 0.24, lit));
              const level = Math.min(LEVELS - 1, Math.round(jitterLit * (LEVELS - 1)));

              const alleg = allegianceField(pl.x, pl.z, d);
              const a = clamp(smoothstep(-SEAM_SOFT, SEAM_SOFT, alleg));
              for (let g = 0; g < GARMENTS.length; g++) GWEIGHT[g] = lerp(AWAY[g], HOME[g], a);
              const garment = pickGarment(GWEIGHT);

              // Who the seat supports: the same field, thresholded instead of
              // blended, with a ragged seam so the two masses interlock where
              // they meet. Deliberately not read off the shirt — a coat is not
              // an allegiance, and a house in its own clothes still has to be
              // able to erupt as one body rather than as a speckle.
              const fan = alleg + rng.jitter(0.22) >= 0 ? 0 : 1;
              FAN_COUNT[fan]++;

              // Jump phase is individual, with only a slight local drag. A
              // stand is ten thousand people each on their own count; a smooth
              // phase field across the seating reads instantly as a Mexican
              // wave, which is the one crowd behaviour that never happens
              // unless a crowd organises it. So the field is capped well under
              // a full cycle and can never close one across a block: mates
              // lean together, no front travels through the stand.
              const drag = noise.fbm2D(pl.x * 0.14, pl.z * 0.14 + rf * 0.6, { octaves: 2 });
              const heat = clamp(
                0.35 + 0.9 * (noise.fbm2D(pl.x * 0.012 + 11, pl.z * 0.012 - 4, { octaves: 2 }) * 0.5 + 0.5)
              );

              const idx = SX.length;
              SX.push(pr.x);
              SY.push(pr.y);
              SW.push(clamp(0.44 * pr.s, 1, 7));
              SH.push(clamp(0.66 * pr.s, 1.2, 10));
              SPHASE.push(rng.range(0, TAU) + drag * 1.2);
              // Nobody holds a beat exactly. Slightly different rates mean two
              // neighbours who happen to start together drift apart within a
              // few jumps instead of locking into a pattern.
              SRATE.push(0.86 + rng.skew(1.2) * 0.3);
              SAMP.push((0.19 + rng.skew(1.4) * 0.25) * pr.s);
              // How loud it has to get before this seat is on its feet. Most
              // of the bowl clears the ordinary-play threshold and bounces all
              // match; the last holdouts only get up for a goal.
              SGATE.push(clamp((1 - heat) * 0.55 + rng() * 0.30));
              SFAN.push(fan);

              const slot = Math.min(BANDS - 1, Math.floor(clamp(pr.z / 230) * BANDS));
              const band = bands[k * BANDS + slot];
              band.zSum += pr.z;
              band.n++;
              const key = garment * LEVELS + level;
              let bucket = band.buckets.get(key);
              if (!bucket) {
                bucket = [];
                band.buckets.set(key, bucket);
              }
              bucket.push(idx);
              // Accents, not a third full pass.
              if (level >= LEVELS - 2 && pr.s > 3.0 && rng.chance(0.16)) band.spark.push(idx);
              if (level >= LEVELS - 3 && pr.s > 3.8 && rng.chance(0.16)) band.dark.push(idx);
            }
          }
          sArc += step;
        }
      }
    }
  }

  let drawBands = [];
  let LIT_POLY = [];
  let crowdG = null;
  let crowdBuf = null;
  let crowdImg = null;

  /* ------------------------------- players ------------------------------ */

  const TEAM_A = { shirt: TEAMS[0].main, shorts: TEAMS[0].trim, socks: TEAMS[0].alt };
  const TEAM_B = { shirt: TEAMS[1].main, shorts: TEAMS[1].trim, socks: TEAMS[1].alt };
  // The keeper has to clash with both — which is why keepers wear green.
  const KEEPER = (() => {
    const stock = ['#48b58c', '#d8f24a', '#f26b1f', '#7a3fb5', '#1fc4d8', '#e8368f'];
    let best = stock[0];
    let bestGap = -1;
    for (const hex of stock) {
      const gap = Math.min(kitGap({ main: hex }, TEAMS[0]), kitGap({ main: hex }, TEAMS[1]));
      if (gap > bestGap) {
        bestGap = gap;
        best = hex;
      }
    }
    return { shirt: best, shorts: '#1c2028', socks: '#1c2028' };
  })();

  let players = [];
  let ball = null;

  // Each kit is resolved once in sun and once in shade, so a player crossing
  // the shadow line changes value instead of staying lit on dark grass.
  const SHADE_T = 0.08;
  const litKit = (kit) => ({
    shirt: shade(kit.shirt, 1),
    shorts: shade(kit.shorts, 1),
    socks: shade(kit.socks, 1),
    skin: shade('#c99a72', 1)
  });
  const darkKit = (kit) => ({
    shirt: shade(kit.shirt, SHADE_T),
    shorts: shade(kit.shorts, SHADE_T),
    socks: shade(kit.socks, SHADE_T),
    skin: shade('#c99a72', SHADE_T)
  });
  const KITS = new Map();
  for (const k of [TEAM_A, TEAM_B, KEEPER]) KITS.set(k, { sun: litKit(k), shade: darkKit(k) });
  const BALL_C = { sun: shade('#fbfcf6', 1), shade: shade('#fbfcf6', SHADE_T) };

  const GOAL_HALF_W = 3.66;

  // The camera stands beyond one goal line and looks down the pitch, so only
  // the goal at -x is in frame; the far one sits off the right edge entirely.
  // The side attacking -x is therefore the only side whose goals can be seen,
  // and that side is handed to whichever support fills the bowl — the noise
  // and the net have to be the same event, or the eruption has nothing to
  // point at.
  const VISIBLE_GOAL = -1; // the goal this camera can see
  const SCORING_SIDE = -VISIBLE_GOAL; // defends +x, attacks the visible goal

  let match = null;

  function buildPlayers() {
    players = [];
    // Home positions for the side defending -x; team B is the mirror. Keepers
    // are separate because they do not chase — see keeperTarget.
    const outfield = [
      [-34, -17], [-33, -6], [-33, 6], [-34, 17],
      [-18, -22], [-16, -7], [-16, 7], [-18, 22],
      [-3, -11], [-3, 11]
    ];
    const mk = (hx, hz, kit, side, keeper) => ({
      home: { x: hx, z: hz },
      x: hx + rng.jitter(3),
      z: hz + rng.jitter(3),
      vx: 0,
      vz: 0,
      speed: 0,
      kit,
      side,
      keeper,
      phase: rng.range(0, TAU),
      pull: keeper ? 0 : 0.18 + rng.skew(1.6) * 0.55,
      top: keeper ? 4.8 : 6.4 + rng.range(0, 2.4),
      wander: rng.range(0, 100)
    });
    const KIT_OF = [TEAM_A, TEAM_B];
    for (const side of [-1, 1]) {
      const kit = KIT_OF[side === SCORING_SIDE ? SUPPORT : 1 - SUPPORT];
      players.push(mk(side * (PITCH_HALF_X - 2.5), 0, KEEPER, side, true));
      for (const [hx, hz] of outfield) players.push(mk(-side * hx, -side * hz, kit, side, false));
    }

    ball = { x: 0, z: 0, tx: -18, tz: 6, speed: 14, shot: false, onTarget: false, attack: -1 };
    match = {
      mode: 'play',
      timer: 0,
      nextShot: rng.range(6, 15),
      celebrateFor: 0,
      celebrateTotal: 1,
      scorer: SCORING_SIDE,
      scorerTeam: SUPPORT,
      rally: { x: 0, z: 0 },
      excite: 0.48,
      // One number per support, not one for the ground.
      excites: [0.48, 0.48],
      jumpPhase: 0
    };
    pickBallTarget();
  }

  /**
   * Where a keeper wants to stand, given where the ball is. Expressed along
   * his own axis, so -PITCH_HALF_X is his goal line whichever end he defends.
   */
  function keeperTarget(k) {
    // Ball position along his own axis, so -PITCH_HALF_X is *his* goal line
    // whichever end he defends. (k.side * ball.x gets this backwards.)
    const bx = -k.side * ball.x;
    const quarter = PITCH_HALF_X * 0.5; // the final quarter of the field
    let depth;
    let top;
    if (bx < -quarter) {
      depth = 1.6; // ball in his final quarter: stay on the line
      top = 5.4;
    } else if (bx < 0) {
      // Between midfield and that quarter: out to the six-yard box.
      depth = lerp(1.6, 5.5, (bx + quarter) / quarter);
      top = 3.8;
    } else {
      // Play at the far end: stroll out past his box, in no hurry.
      depth = lerp(5.5, 16.5, clamp(bx / PITCH_HALF_X));
      top = 1.9;
    }
    // Shade across with the ball, but never wider than the angle he is
    // covering — a keeper on his line barely moves off centre.
    const reach = 2.2 + depth * 0.55;
    return { x: k.side * (PITCH_HALF_X - depth), z: clamp(ball.z * 0.42, -reach, reach), top };
  }

  function pickBallTarget() {
    if (match.timer > match.nextShot && Math.abs(ball.x) > 12) {
      // An attempt on the goal the ball is already nearest. The far end is off
      // frame and belongs to the other lot, so an attempt there is always kept
      // out, and most of the shooting is left to the end that can be seen.
      const side = ball.x >= 0 ? 1 : -1;
      if (side === VISIBLE_GOAL || rng.chance(0.4)) {
        const onTarget = side === VISIBLE_GOAL && rng.chance(0.62);
        ball.attack = side;
        ball.shot = true;
        ball.onTarget = onTarget;
        ball.tx = side * (PITCH_HALF_X + 0.6);
        ball.tz = onTarget
          ? rng.range(-GOAL_HALF_W * 0.82, GOAL_HALF_W * 0.82)
          : (rng.chance() ? 1 : -1) * rng.range(GOAL_HALF_W * 1.5, 13);
        ball.speed = 26 + rng.skew(1.3) * 15;
        return;
      }
      // Held up at the wrong end. Play on, and look again shortly.
      match.nextShot = match.timer + rng.range(2.5, 6);
    }
    // Ordinary play. Targets are drawn from zones weighted by how far they
    // are from where the ball already is, so possession genuinely travels
    // end to end and drags the outfield off the frame and back again.
    // (Mirroring the ball about the halfway line does not work: near x=0 it
    // is a fixed point and play stalls in midfield.)
    ball.shot = false;
    const zones = [-44, -24, -6, 12, 30, 46];
    const weights = zones.map((zx) => 0.1 + (Math.abs(zx - ball.x) / 105) * 2.6 + (Math.abs(zx) / 46) * 0.7);
    ball.tx = clamp(rng.weighted(zones, weights) + rng.jitter(10), -50, 50);
    ball.tz = clamp(ball.z + rng.jitter(26), -31, 31);
    ball.speed = 11 + rng.skew(1.4) * 19;
  }

  function scoreGoal() {
    match.mode = 'celebrate';
    match.celebrateTotal = rng.range(6, 8.5);
    match.celebrateFor = match.celebrateTotal;
    match.scorer = -ball.attack; // the side attacking that goal
    match.scorerTeam = SUPPORT; // which, by construction, is the majority
    match.rally = { x: ball.attack * (PITCH_HALF_X - 15), z: rng.range(15, 27) };
    ball.shot = false;
    ball.x = ball.attack * (PITCH_HALF_X - 0.6);
    ball.z = clamp(ball.z, -GOAL_HALF_W, GOAL_HALF_W);
  }

  function kickOff() {
    match.mode = 'play';
    match.timer = 0;
    match.nextShot = rng.range(9, 20);
    ball.x = 0;
    ball.z = 0;
    ball.speed = 14;
    pickBallTarget();
  }

  function stepBall(dt) {
    const dx = ball.tx - ball.x;
    const dz = ball.tz - ball.z;
    const dist = Math.hypot(dx, dz) || 1e-6;
    const stepLen = ball.speed * dt;
    if (stepLen >= dist) {
      ball.x = ball.tx;
      ball.z = ball.tz;
      if (ball.shot) {
        if (ball.onTarget) {
          scoreGoal();
        } else {
          // Wide: goal kick, and nobody shoots again for a while.
          ball.shot = false;
          ball.x = ball.attack * (PITCH_HALF_X - 6);
          ball.z = clamp(ball.z * 0.4, -14, 14);
          match.nextShot = match.timer + rng.range(6, 15);
          pickBallTarget();
        }
        return;
      }
      pickBallTarget();
      return;
    }
    ball.x += (dx / dist) * stepLen;
    ball.z += (dz / dist) * stepLen;
  }

  /**
   * How loud each support is, tracked separately. Through ordinary play the two
   * move together — both lift as the ball nears a goal, both spike as a shot
   * goes in — and a goal then splits them completely: one end at full voice,
   * the other silent, because the only thing a conceding end does is sit down.
   * Noise falls away far more slowly than it rises, which is what a roar
   * actually does; a conceded goal is the one exception.
   */
  function stepExcitement(dt) {
    const near = clamp((Math.abs(ball.x) - 26) / (PITCH_HALF_X - 26));
    let target = 0.46 + 0.26 * near * near;
    if (ball.shot) target = Math.max(target, 0.76);
    const celebrating = match.mode === 'celebrate';
    let roar = target;
    if (celebrating) {
      const elapsed = match.celebrateTotal - match.celebrateFor;
      roar = elapsed < 2.6 ? 1 : lerp(0.94, 0.5, clamp((elapsed - 2.6) / 4.2));
    }
    for (let f = 0; f < 2; f++) {
      const scored = f === match.scorerTeam;
      const tgt = celebrating ? (scored ? roar : 0) : target;
      const e = match.excites[f];
      // A conceded goal takes a stand's noise away inside a second. Nothing
      // else in the match falls anywhere near that fast.
      const rate = tgt > e ? 0.15 : celebrating && !scored ? 0.075 : 0.011;
      match.excites[f] = e + (tgt - e) * rate;
    }
    match.excite = Math.max(match.excites[0], match.excites[1]);
    // Everyone bounces quicker when the noise goes up.
    match.jumpPhase += dt * (4.8 + 6.2 * match.excite);
  }

  function stepPlayers(dt, t) {
    const celebrating = match.mode === 'celebrate';
    for (const pl of players) {
      let tx;
      let tz;
      let top = pl.top;

      if (pl.keeper) {
        const k = keeperTarget(pl);
        tx = k.x;
        tz = k.z;
        top = k.top;
      } else if (celebrating && pl.side === match.scorer) {
        // Off toward the corner in a loose knot, not a neat circle.
        tx = match.rally.x + Math.cos(pl.phase) * 8;
        tz = match.rally.z + Math.sin(pl.phase) * 8;
        top = pl.top * 1.2;
      } else if (celebrating) {
        tx = pl.home.x * 0.65;
        tz = pl.home.z * 0.65;
        top = pl.top * 0.4;
      } else {
        // Hold shape, chase the ball, drift on noise — three weights, so the
        // team moves as a body instead of ten independent dots.
        const wob = noise.fbm2D(pl.wander + t * 0.22, pl.wander * 0.4 - t * 0.17, { octaves: 2 });
        const wob2 = noise.fbm2D(pl.wander * 0.7 - t * 0.19, pl.wander + t * 0.24, { octaves: 2 });
        tx = lerp(pl.home.x + wob * 13, ball.x, pl.pull) + wob2 * 4;
        tz = lerp(pl.home.z + wob2 * 11, ball.z, pl.pull) + wob * 4;
      }

      const ax = tx - pl.x;
      const az = tz - pl.z;
      const ad = Math.hypot(ax, az) || 1e-6;
      const want = Math.min(top, ad * 1.4);
      pl.vx = lerp(pl.vx, (ax / ad) * want, 0.08);
      pl.vz = lerp(pl.vz, (az / ad) * want, 0.08);
      pl.x += pl.vx * dt;
      pl.z += pl.vz * dt;
      pl.speed = Math.hypot(pl.vx, pl.vz);
    }
  }

  function stepPlay(dt, t) {
    match.timer += dt;
    if (match.mode === 'play') {
      stepBall(dt);
    } else {
      match.celebrateFor -= dt;
      if (match.celebrateFor <= 0) kickOff();
    }
    stepExcitement(dt);
    stepPlayers(dt, t);
  }

  /* ------------------------- static plate helpers ----------------------- */

  const g2 = () => p.drawingContext;

  function polyPath(pts) {
    const c = g2();
    c.beginPath();
    let started = false;
    for (const pt of pts) {
      if (!pt) return false;
      if (!started) {
        c.moveTo(pt.x, pt.y);
        started = true;
      } else c.lineTo(pt.x, pt.y);
    }
    c.closePath();
    return started;
  }

  const groundPt = (x, z) => project(v3(x, 0, z));

  /** Sutherland-Hodgman: clip a convex world-space polygon by another. */
  function clipPoly(subject, clip) {
    let out = subject;
    for (let i = 0; i < clip.length; i++) {
      const a = clip[i];
      const b = clip[(i + 1) % clip.length];
      const nx = b.z - a.z;
      const nz = -(b.x - a.x);
      const inside = (pt) => (pt.x - a.x) * nx + (pt.z - a.z) * nz <= 0;
      const input = out;
      out = [];
      for (let j = 0; j < input.length; j++) {
        const cur = input[j];
        const prev = input[(j + input.length - 1) % input.length];
        const ci = inside(cur);
        const pi = inside(prev);
        if (ci !== pi) {
          const d1 = (prev.x - a.x) * nx + (prev.z - a.z) * nz;
          const d2 = (cur.x - a.x) * nx + (cur.z - a.z) * nz;
          const t = d1 / (d1 - d2);
          out.push({ x: lerp(prev.x, cur.x, t), z: lerp(prev.z, cur.z, t) });
        }
        if (ci) out.push(cur);
      }
      if (!out.length) return out;
    }
    return out;
  }

  /** The patch of turf the rim aperture still lets sun onto. */
  function litPatch() {
    const rim = [];
    const rimLen = ringLength(ROOF.d);
    for (let i = 0; i < 96; i++) {
      const pl = planArc((i / 96) * rimLen, ROOF.d);
      rim.push(groundShadow(v3(pl.x, ROOF.y, pl.z)));
    }
    const pitch = [
      { x: -PITCH_HALF_X, z: -PITCH_HALF_Z },
      { x: PITCH_HALF_X, z: -PITCH_HALF_Z },
      { x: PITCH_HALF_X, z: PITCH_HALF_Z },
      { x: -PITCH_HALF_X, z: PITCH_HALF_Z }
    ];
    return clipPoly(pitch, rim);
  }

  /** Is a turf point inside the convex lit region? */
  function inLit(px, pz) {
    if (LIT_POLY.length < 3) return true;
    for (let i = 0; i < LIT_POLY.length; i++) {
      const a = LIT_POLY[i];
      const b = LIT_POLY[(i + 1) % LIT_POLY.length];
      const nx = b.z - a.z;
      const nz = -(b.x - a.x);
      if ((px - a.x) * nx + (pz - a.z) * nz > 0) return false;
    }
    return true;
  }

  function stripeQuad(x0, x1) {
    return [
      { x: x0, z: -PITCH_HALF_Z },
      { x: x1, z: -PITCH_HALF_Z },
      { x: x1, z: PITCH_HALF_Z },
      { x: x0, z: PITCH_HALF_Z }
    ];
  }

  function fillGround(poly, color) {
    const pts = poly.map((q) => groundPt(q.x, q.z));
    if (pts.some((q) => !q)) return;
    const c = g2();
    c.fillStyle = color;
    if (polyPath(pts)) c.fill();
  }

  function line3(a, b, color, w) {
    const pa = project(a);
    const pb = project(b);
    if (!pa || !pb) return;
    const c = g2();
    c.strokeStyle = color;
    c.lineWidth = Math.max(0.8, w * Math.min(pa.s, pb.s));
    c.beginPath();
    c.moveTo(pa.x, pa.y);
    c.lineTo(pb.x, pb.y);
    c.stroke();
  }

  function arc3(cx, cz, r, a0, a1, color, w) {
    const c = g2();
    c.strokeStyle = color;
    c.beginPath();
    let started = false;
    let scale = 1;
    for (let i = 0; i <= 40; i++) {
      const a = lerp(a0, a1, i / 40);
      const pr = groundPt(cx + Math.cos(a) * r, cz + Math.sin(a) * r);
      if (!pr) continue;
      scale = pr.s;
      if (!started) {
        c.moveTo(pr.x, pr.y);
        started = true;
      } else c.lineTo(pr.x, pr.y);
    }
    c.lineWidth = Math.max(0.8, w * scale);
    if (started) c.stroke();
  }

  function drawPitch() {
    const c = g2();
    const nStripes = 12;
    const stripeW = (PITCH_HALF_X * 2) / nStripes;

    // Everything in shade first, then the sun patch is clipped back over it.
    for (let i = 0; i < nStripes; i++) {
      const x0 = -PITCH_HALF_X + i * stripeW;
      fillGround(stripeQuad(x0, x0 + stripeW), GRASS_SHADE[i % 2]);
    }

    const lit = LIT_POLY;
    if (lit.length > 2) {
      const pts = lit.map((q) => groundPt(q.x, q.z));
      if (!pts.some((q) => !q)) {
        c.save();
        if (polyPath(pts)) c.clip();
        for (let i = 0; i < nStripes; i++) {
          const x0 = -PITCH_HALF_X + i * stripeW;
          fillGround(stripeQuad(x0, x0 + stripeW), GRASS_SUN[i % 2]);
        }
        c.restore();
      }
    }
  }

  function drawMarkings() {
    const c = g2();
    c.lineCap = 'round';
    const white = withAlpha(shade('#f4f7f0', 0.72), 0.82);
    const L = 0.13;
    const X = PITCH_HALF_X;
    const Z = PITCH_HALF_Z;

    line3(v3(-X, 0.02, -Z), v3(X, 0.02, -Z), white, L);
    line3(v3(-X, 0.02, Z), v3(X, 0.02, Z), white, L);
    line3(v3(-X, 0.02, -Z), v3(-X, 0.02, Z), white, L);
    line3(v3(X, 0.02, -Z), v3(X, 0.02, Z), white, L);
    line3(v3(0, 0.02, -Z), v3(0, 0.02, Z), white, L);
    arc3(0, 0, 9.15, 0, TAU, white, L);

    for (const sgn of [-1, 1]) {
      const gx = sgn * X;
      const px = sgn * (X - 16.5);
      const bx = sgn * (X - 5.5);
      line3(v3(gx, 0.02, -20.16), v3(px, 0.02, -20.16), white, L);
      line3(v3(gx, 0.02, 20.16), v3(px, 0.02, 20.16), white, L);
      line3(v3(px, 0.02, -20.16), v3(px, 0.02, 20.16), white, L);
      line3(v3(gx, 0.02, -9.16), v3(bx, 0.02, -9.16), white, L);
      line3(v3(gx, 0.02, 9.16), v3(bx, 0.02, 9.16), white, L);
      line3(v3(bx, 0.02, -9.16), v3(bx, 0.02, 9.16), white, L);
      arc3(sgn * (X - 11), 0, 9.15, -sgn * 0.93, sgn * 0.93, white, L);
    }

    // Goals: posts, bar, and a hint of net so the frame reads as a volume.
    for (const sgn of [-1, 1]) {
      const gx = sgn * X;
      const goalW = 3.66;
      const bar = withAlpha(shade('#fbfdf8', 0.8), 0.95);
      line3(v3(gx, 0, -goalW), v3(gx, 2.44, -goalW), bar, 0.26);
      line3(v3(gx, 0, goalW), v3(gx, 2.44, goalW), bar, 0.26);
      line3(v3(gx, 2.44, -goalW), v3(gx, 2.44, goalW), bar, 0.26);
      const back = gx + sgn * 1.9;
      const net = withAlpha(shade('#e4ebe4', 0.7), 0.24);
      for (let i = 0; i <= 8; i++) {
        const z = lerp(-goalW, goalW, i / 8);
        line3(v3(gx, 2.44, z), v3(back, 1.5, z), net, 0.07);
        line3(v3(back, 1.5, z), v3(back, 0, z), net, 0.07);
      }
      for (let i = 1; i < 4; i++) {
        const y = (i / 4) * 1.5;
        line3(v3(back, y, -goalW), v3(back, y, goalW), net, 0.07);
      }
    }
  }

  /** Ring of hoardings and the dark apron between turf and stands. */
  const STRIP_STEPS = 420;

  function drawApron() {
    const c = g2();
    const strip = (dInner, dOuter, yInner, yOuter, color) => {
      c.fillStyle = color;
      let fwdPts = [];
      let backPts = [];
      const flush = () => {
        if (fwdPts.length >= 2) {
          c.beginPath();
          c.moveTo(fwdPts[0].x, fwdPts[0].y);
          for (const pt of fwdPts) c.lineTo(pt.x, pt.y);
          for (let i = backPts.length - 1; i >= 0; i--) c.lineTo(backPts[i].x, backPts[i].y);
          c.closePath();
          c.fill();
        }
        fwdPts = [];
        backPts = [];
      };
      const len = ringLength(dOuter);
      for (let i = 0; i <= STRIP_STEPS; i++) {
        const sArc = (i / STRIP_STEPS) * len;
        const a = planArc(sArc, dInner);
        const b = planArc(sArc, dOuter);
        const pa = project(v3(a.x, yInner, a.z));
        const pb = project(v3(b.x, yOuter, b.z));
        if (!pa || !pb) {
          flush();
          continue;
        }
        fwdPts.push(pa);
        backPts.push(pb);
      }
      flush();
    };

    strip(-6, -3.2, 0, 0.04, shade('#4f7d46', 0.34)); // run-off grass
    strip(-3.2, -1.3, 0.04, 0.04, shade('#31402f', 0.16)); // track
    strip(-1.3, -1.2, 0.04, 1.15, shade('#c4463a', 0.72)); // hoarding face
    strip(-1.2, 1.2, 1.15, 1.45, shade('#2a3550', 0.10)); // walkway
  }

  /* --------------------------- bowl architecture ------------------------ */

  /**
   * A band of the bowl between two radii and two heights. Argument order is
   * (inner, outer, low, high, colour) — every call site depends on it.
   */
  function ring(dInner, dOuter, yLow, yHigh, color) {
    const c = g2();
    c.fillStyle = color;
    let top = [];
    let bot = [];
    // Fill each unbroken run separately: the near side of the bowl passes
    // behind the camera, and stitching across that gap paints the whole frame.
    const flush = () => {
      if (top.length >= 2) {
        c.beginPath();
        c.moveTo(top[0].x, top[0].y);
        for (const pt of top) c.lineTo(pt.x, pt.y);
        for (let i = bot.length - 1; i >= 0; i--) c.lineTo(bot[i].x, bot[i].y);
        c.closePath();
        c.fill();
      }
      top = [];
      bot = [];
    };
    const len = ringLength(dOuter);
    for (let i = 0; i <= STRIP_STEPS; i++) {
      const sArc = (i / STRIP_STEPS) * len;
      const inner = planArc(sArc, dInner);
      const outer = planArc(sArc, dOuter);
      const pt = project(v3(outer.x, yHigh, outer.z));
      const pb = project(v3(inner.x, yLow, inner.z));
      if (!pt || !pb) {
        flush();
        continue;
      }
      top.push(pt);
      bot.push(pb);
    }
    flush();
  }

  /** Sparse light ticks along a fascia, standing in for signage. */
  function fasciaTicks(d, yLow, yHigh, color) {
    const c = g2();
    c.fillStyle = color;
    const len = ringLength(d);
    for (let sArc = 0; sArc < len; sArc += 1.1) {
      const a = planArc(sArc, d);
      const pa = project(v3(a.x, lerp(yLow, yHigh, 0.42), a.z));
      const pb = project(v3(a.x, lerp(yLow, yHigh, 0.72), a.z));
      if (!pa || !pb) continue;
      if (pa.x < -40 || pa.x > width + 40 || pa.s > 40) continue;
      const n = noise.noise2D(a.x * 0.16, a.z * 0.16);
      if (n < 0.15) continue;
      const w = clamp(0.35 * pa.s, 1, 7);
      const h = clamp(Math.abs(pa.y - pb.y), 1, 26);
      c.fillRect(pa.x, pb.y, w, h);
    }
  }

  function drawTierStructure(k) {
    const deck = DECKS[k];
    // Soffit: the underside of this tier, reaching back over the tier below.
    if (k > 0) {
      // A soffit is the underside of a tier: only draw it when the eye is
      // actually beneath it, or it paints over the bowl behind it.
      if (CAM.y < deck.y0) {
        ring(deck.d0 - OVERHANG, deck.d0, deck.y0 - 0.4, deck.y0 - 0.4, STEEL_DARK);
      }
      ring(deck.d0, deck.d0, deck.y0 - 3.4, deck.y0 - 0.4, FASCIA);
      ring(deck.d0, deck.d0, deck.y0 - 1.6, deck.y0 - 0.9, FASCIA_LIT);
      fasciaTicks(deck.d0 - 0.05, deck.y0 - 3.4, deck.y0 - 0.4, TICK);
    } else {
      ring(deck.d0, deck.d0, 1.35, deck.y0 - 0.2, STEEL);
    }
  }

  function drawRoof() {
    // Canopy lip and its dark underside, clamping the top of the frame.
    ring(ROOF.d - 22, ROOF.d + 10, ROOF.y - 1.5, ROOF.y + 1.0, shade('#1a2338', 0.02));
    ring(ROOF.d + 10, ROOF.d + 10, ROOF.y + 1.0, ROOF.y + 7.0, shade('#2b3a58', 0.30));
  }

  /* ------------------------------ videoboard ---------------------------- */

  /** Screen quad hung off the near-corner canopy, plus its dark surround. */
  function drawVideoboard() {
    const c = g2();
    const dBoard = ROOF.d - 12;
    const boardLen = ringLength(dBoard);
    const th0 = 0.470 * boardLen;
    const th1 = 0.552 * boardLen;
    const yTop = ROOF.y - 2.0;
    const yBot = ROOF.y - 21.0;

    const corner = (sArc, y, dd = dBoard) => {
      const a = planArc(sArc, dd);
      return project(v3(a.x, y, a.z));
    };

    // Dark housing, slightly larger than the screen.
    const housing = [
      corner(th0 - 5, yTop + 5.5, dBoard + 8),
      corner(th1 + 5, yTop + 5.5, dBoard + 8),
      corner(th1 + 5, yBot - 3.0, dBoard),
      corner(th0 - 5, yBot - 3.0, dBoard)
    ];
    if (housing.every(Boolean)) {
      c.fillStyle = '#101c36';
      if (polyPath(housing)) c.fill();
    }

    // Three panels: video, then the two flag blocks.
    const panels = [
      { a: 0.0, b: 0.46, fill: ['#5c86bf', '#c8d8e8'] },
      { a: 0.50, b: 0.72, fill: ['#22398f', '#e9ecef'] },
      { a: 0.76, b: 1.0, fill: ['#f0c62c', '#1f4fa8'] }
    ];
    panels.forEach((panel, i) => {
      const ta = lerp(th0, th1, panel.a);
      const tb = lerp(th0, th1, panel.b);
      const quad = [corner(ta, yTop), corner(tb, yTop), corner(tb, yBot), corner(ta, yBot)];
      if (!quad.every(Boolean)) return;
      c.save();
      if (polyPath(quad)) c.clip();
      const minX = Math.min(...quad.map((q) => q.x));
      const maxX = Math.max(...quad.map((q) => q.x));
      const minY = Math.min(...quad.map((q) => q.y));
      const maxY = Math.max(...quad.map((q) => q.y));
      const grad = c.createLinearGradient(minX, minY, maxX, maxY);
      grad.addColorStop(0, panel.fill[0]);
      grad.addColorStop(1, panel.fill[1]);
      c.fillStyle = grad;
      c.fillRect(minX, minY, maxX - minX, maxY - minY);
      if (i === 0) {
        // A pale figure, so the video panel reads as a picture not a swatch.
        c.fillStyle = 'rgba(24,38,70,0.55)';
        c.beginPath();
        c.ellipse((minX + maxX) * 0.52, (minY + maxY) * 0.55, (maxX - minX) * 0.10, (maxY - minY) * 0.30, 0.2, 0, TAU);
        c.fill();
      }
      c.restore();
    });
  }

  /* --------------------------- foreground heads ------------------------- */

  let foreground = [];

  function buildForeground() {
    foreground = [];
    // A single row of near heads along the bottom-left, overlapping into one
    // dark mass. They are the only thing in the frame with a hard silhouette,
    // which is what sets the depth of everything behind them.
    let x = -width * 0.04;
    while (x < width * 0.34) {
      const r = width * (0.036 + rng.skew(1.5) * 0.030);
      foreground.push({
        x,
        y: height + r * (0.30 + rng.range(0, 0.30)),
        r,
        cap: rng.chance(0.30),
        phone: false
      });
      x += r * (1.15 + rng.range(0, 0.55));
    }
    // Exactly one of them stands up with a phone raised. Any figure whose head
    // sits below the frame would leave the phone floating on its own.
    if (foreground.length) {
      const hero = foreground[rng.int(1, foreground.length - 2)];
      hero.y = height - hero.r * 0.45;
      hero.phone = true;
    }
  }

  function drawForeground() {
    const c = g2();
    const ink = withAlpha(shade('#151d30', 0.0), 0.96);
    for (const f of foreground) {
      c.fillStyle = ink;
      // Shoulders first, then the head, so the row merges into one mass.
      c.beginPath();
      c.ellipse(f.x, f.y + f.r * 1.28, f.r * 2.0, f.r * 1.5, 0, 0, TAU);
      c.fill();
      c.beginPath();
      c.ellipse(f.x, f.y, f.r * 0.84, f.r, 0, 0, TAU);
      c.fill();
      if (f.cap) {
        c.beginPath();
        c.ellipse(f.x, f.y - f.r * 0.30, f.r * 1.02, f.r * 0.66, 0, Math.PI, TAU);
        c.fill();
      }
      // A raised phone only reads if its owner is visible under it.
      if (f.phone) {
        c.save();
        c.translate(f.x + f.r * 0.92, f.y - f.r * 1.30);
        c.rotate(-0.14);
        c.fillStyle = ink;
        c.fillRect(-f.r * 0.19, -f.r * 0.34, f.r * 0.38, f.r * 0.68);
        c.fillStyle = withAlpha(shade('#9fc0e6', 0.55), 0.5);
        c.fillRect(-f.r * 0.13, -f.r * 0.28, f.r * 0.26, f.r * 0.56);
        c.restore();
      }
    }
  }

  /* ------------------------------ the crowd ----------------------------- */

  /* ----------------------------- player draw ---------------------------- */

  function drawPlayers(t) {
    const c = g2();
    const sorted = players.slice().sort((a, b) => {
      const pa = project(v3(a.x, 0, a.z));
      const pb = project(v3(b.x, 0, b.z));
      return (pb ? pb.z : 0) - (pa ? pa.z : 0);
    });

    for (const pl of sorted) {
      const base = project(v3(pl.x, 0, pl.z));
      if (!base) continue;
      const h = 1.82 * base.s;
      if (base.x < -60 || base.x > width + 60 || base.y < -60 || base.y > height + 60) continue;

      const kit = KITS.get(pl.kit)[inLit(pl.x, pl.z) ? 'sun' : 'shade'];
      const stride = Math.min(1, pl.speed / 6.5);
      const cycle = Math.sin(pl.phase + t * (4 + pl.speed * 1.5));
      const swing = cycle * stride;

      // Cast shadow, thrown down the same sun ray as everything else.
      const sh = groundShadow(v3(pl.x, 1.0, pl.z));
      const ps = project(v3(sh.x, 0.01, sh.z));
      if (ps) {
        c.fillStyle = withAlpha(GRASS_SHADE[0], 0.55);
        c.beginPath();
        c.ellipse(ps.x, ps.y, h * 0.30, h * 0.10, 0, 0, TAU);
        c.fill();
      }

      const hipY = base.y - h * 0.52;
      const w = h * 0.20;

      c.strokeStyle = kit.socks;
      c.lineWidth = Math.max(1, h * 0.07);
      c.lineCap = 'round';
      c.beginPath();
      c.moveTo(base.x, hipY);
      c.lineTo(base.x + swing * h * 0.20, base.y);
      c.moveTo(base.x, hipY);
      c.lineTo(base.x - swing * h * 0.20, base.y - Math.abs(swing) * h * 0.10);
      c.stroke();

      c.fillStyle = kit.shorts;
      c.fillRect(base.x - w * 0.5, hipY - h * 0.10, w, h * 0.16);

      c.fillStyle = kit.shirt;
      c.fillRect(base.x - w * 0.55, base.y - h * 0.85, w * 1.1, h * 0.30);

      // Arms counter-swing; two strokes are enough to read as running.
      c.strokeStyle = kit.shirt;
      c.lineWidth = Math.max(1, h * 0.055);
      c.beginPath();
      c.moveTo(base.x, base.y - h * 0.78);
      c.lineTo(base.x - swing * h * 0.16, base.y - h * 0.55);
      c.stroke();

      c.fillStyle = kit.skin;
      c.beginPath();
      c.arc(base.x, base.y - h * 0.93, Math.max(1, h * 0.085), 0, TAU);
      c.fill();
    }

    const bp = project(v3(ball.x, 0.16, ball.z));
    if (bp) {
      const bs = groundShadow(v3(ball.x, 0.16, ball.z));
      const bsp = project(v3(bs.x, 0.01, bs.z));
      if (bsp) {
        c.fillStyle = withAlpha(GRASS_SHADE[0], 0.5);
        c.beginPath();
        c.ellipse(bsp.x, bsp.y, bp.s * 0.20, bp.s * 0.08, 0, 0, TAU);
        c.fill();
      }
      c.fillStyle = inLit(ball.x, ball.z) ? BALL_C.sun : BALL_C.shade;
      c.beginPath();
      c.arc(bp.x, bp.y, Math.max(1.2, bp.s * 0.14), 0, TAU);
      c.fill();
    }
  }

  /* -------------------------------- frame ------------------------------- */

  /** Opaque axis-aligned rect straight into the crowd buffer. */
  function rect32(x, y, w, h, col) {
    let x0 = x | 0;
    let y0 = y | 0;
    let x1 = (x + w) | 0;
    let y1 = (y + h) | 0;
    if (x0 < 0) x0 = 0;
    if (y0 < 0) y0 = 0;
    if (x1 > width) x1 = width;
    if (y1 > height) y1 = height;
    for (let yy = y0; yy < y1; yy++) {
      const row = yy * width;
      for (let xx = x0; xx < x1; xx++) crowdBuf[row + xx] = col;
    }
  }

  /**
   * The whole crowd, far bands to near, in one pass. Seats rise on a squared
   * sine so the ascent is quick and the hang is slow — a jump, not a wobble.
   */
  /**
   * Vertical offset of every seat this frame. Computed once and reused by all
   * three passes — the body, the gap it leaves behind, and the highlight —
   * which is also a third of the sin calls the passes used to make separately.
   */
  function computeLift() {
    const ph = match.jumpPhase;
    // Amplitude and coherence are both read off a support's own noise, so the
    // seam in the seating becomes a seam in the movement: at a goal one mass
    // goes up and the other is left sitting in its own colours, which is the
    // only moment the two blocks are legible as two blocks.
    //
    // Ordinary cheering is incoherent — everyone on their own beat. A goal
    // pulls that end onto one beat and it leaps together, which is what makes
    // the eruption read as a step change rather than just more of the same.
    const amp = [0, 0];
    const inv = [0, 0];
    for (let f = 0; f < 2; f++) {
      const e = match.excites[f];
      amp[f] = 0.72 + 1.25 * e;
      inv[f] = 1 - clamp((e - 0.58) / 0.42) * 0.6;
    }
    for (let s = 0; s < LIFT.length; s++) {
      const f = FAN[s];
      const gate = match.excites[f] - SGATE[s];
      if (gate <= 0) {
        LIFT[s] = 0;
        continue;
      }
      const j = Math.sin(SPHASE[s] * inv[f] + ph * SRATE[s]);
      // Squared sine: a quick launch and a slow hang, the shape of a jump.
      LIFT[s] = j > 0 ? j * j * SAMP[s] * amp[f] * (gate < 0.14 ? gate / 0.14 : 1) : 0;
    }
  }

  function rasterCrowd(t) {
    computeLift();
    crowdBuf.fill(0);
    for (const band of drawBands) {
      for (const [key, idxs] of band.buckets) {
        const col = SEAT_COLOR32[key];
        for (let i = 0; i < idxs.length; i++) {
          const s = idxs[i];
          rect32(SX[s], SY[s] - LIFT[s], SW[s], SH[s], col);
        }
      }
      for (let i = 0; i < band.dark.length; i++) {
        const s = band.dark[i];
        const lift = LIFT[s];
        if (lift < 1) continue;
        rect32(SX[s], SY[s] - lift + SH[s], SW[s], Math.min(lift, SH[s] * 1.3), SEAT_DARK32);
      }
      for (let i = 0; i < band.spark.length; i++) {
        const s = band.spark[i];
        rect32(SX[s], SY[s] - LIFT[s], SW[s] * 0.6, Math.max(1, SH[s] * 0.3), SPARK32);
      }
    }
    crowdG.drawingContext.putImageData(crowdImg, 0, 0);
  }

  function drawFrame(t) {
    const c = g2();
    c.save();
    p.background(BG);

    drawPitch();
    // Apron before markings: the goal net reaches past the goal line, and the
    // apron ring starts exactly on it, so drawing it after erased both goals.
    drawApron();
    drawMarkings();
    drawPlayers(t);

    // The crowd lands as one blit; the tier structure is then laid over it,
    // which is also what makes each fascia occlude the rows behind it.
    rasterCrowd(t);
    p.image(crowdG, 0, 0, width, height);

    drawRoof();
    drawTierStructure(2);
    drawTierStructure(1);
    drawTierStructure(0);

    drawVideoboard();
    drawForeground();
    c.restore();
  }

  function build() {
    rng = createRandom(ctx.seed);
    SX.length = 0;
    SY.length = 0;
    SW.length = 0;
    SH.length = 0;
    SPHASE.length = 0;
    SRATE.length = 0;
    SAMP.length = 0;
    SGATE.length = 0;
    SFAN.length = 0;
    FAN_COUNT[0] = 0;
    FAN_COUNT[1] = 0;
    LIT_POLY = litPatch();
    buildSeats();
    LIFT = new Float32Array(SX.length);
    FAN = Uint8Array.from(SFAN);
    // Whoever brought the most people gets the end the camera is pointed at.
    SUPPORT = FAN_COUNT[0] >= FAN_COUNT[1] ? 0 : 1;
    // Far bands first, so a nearer row can overlap the one behind it.
    drawBands = bands
      .filter((b) => b.n > 0)
      .sort((a, b) => b.zSum / b.n - a.zSum / a.n);
    buildPlayers();
    buildForeground();
  }

  p.setup = () => {
    p.createCanvas(width, height);
    p.noStroke();
    // Density 1: the crowd is a hard speckle and wants exact pixels.
    crowdG = p.createGraphics(width, height);
    crowdG.pixelDensity(1);
    crowdBuf = new Uint32Array(width * height);
    crowdImg = new ImageData(new Uint8ClampedArray(crowdBuf.buffer), width, height);
    build();
  };

  p.draw = () => {
    const t = p.frameCount / 60;
    stepPlay(1 / 60, t);
    drawFrame(t);
  };
}

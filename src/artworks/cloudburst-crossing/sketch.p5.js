/**
 * Cloudburst Crossing
 *
 * Four interacting systems, no scattered primitives:
 *
 *   1. one pinhole camera. Buildings, road, crosswalk, rain, splashes,
 *      figures and traffic are all authored in metres and share a single
 *      projection, so foreshortening is consistent rather than faked —
 *      a raindrop 3m away and one 30m away are the same object at
 *      different depths;
 *   2. a fog wall. Every colour is mixed toward the storm grey by
 *      1 - exp(-z * density), which is what actually carries depth here:
 *      past ~40m the city is a value, not a shape;
 *   3. an emitter set. A dozen lights own all the chroma in the frame, and
 *      each one is mirrored through the ground plane into a rippling
 *      vertical smear — the wet road is built from reflections, not texture.
 *      The same lights brighten rain streaks that pass near them;
 *   4. rain as a population. Drops fall in world space under one wind
 *      vector; when a drop reaches y=0 it may hand its position to the
 *      splash system, so spray is spatially correlated with the rain that
 *      caused it rather than sprinkled independently.
 *
 * The seed moves the city — block heights, window fields, tree placement,
 * storefronts, traffic — and the weather, which is always rain and is
 * weighted hard toward the heavy end. The camera, the mast right of centre,
 * the lit block on the left and the dark wall on the right are fixed: that
 * is the composition, and the seed varies inside it.
 */

import { createRandom } from '../../shared/random.js';
import { hexToRgb, rgbToHex } from '../../shared/palettes.js';
import { clamp, lerp, TAU } from '../../shared/math.js';

export default function sketch(p, ctx) {
  const W = ctx.width;
  const H = ctx.height;
  const noise = ctx.noise;
  let rng = createRandom(ctx.seed);

  /* ------------------------------- camera -------------------------------- */

  // A phone held at eye height on the corner. Wide-ish, level horizon, so
  // the road falls away below the middle and the mast runs off the top.
  // Measured off the reference: the road vanishes just below mid-frame, so
  // wet ground takes the lower 55% — that proportion is the composition.
  // FOCAL matches the crop's ~52 degree horizontal field.
  const HORIZON = H * 0.45;
  const VPX = W * 0.44;
  const FOCAL = H * 1.5;
  const EYE = 1.55;

  /** World metres -> screen. `s` is pixels per metre at that depth. */
  function project(x, y, z) {
    if (z < 0.45) return null;
    const s = FOCAL / z;
    return { x: VPX + x * s, y: HORIZON + (EYE - y) * s, s };
  }

  /** Depth of the ground point under a screen row. */
  function groundZ(sy) {
    const d = sy - HORIZON;
    return d <= 0.5 ? 1e5 : (EYE * FOCAL) / d;
  }

  /* ------------------------------- weather ------------------------------- */

  // Always raining; the distribution is deliberately lopsided toward the
  // top of the range so a downpour is the norm and merely heavy is the
  // exception. skew(<1) biases toward 1.
  const storm = 0.54 + 0.46 * rng.skew(0.42);
  // Wind picks a side and scales with the storm, so gusty seeds also lean.
  const windDir = rng.chance(0.55) ? -1 : 1;
  const windX = windDir * (0.8 + storm * storm * 4.6);
  const windZ = rng.jitter(0.9) * storm;
  const fogDensity = lerp(0.019, 0.039, storm);

  // Haze needs a few metres to accumulate. Fogging from zero greyed out the
  // foreground, and a storm picture with no black in it has no weather in it.
  const FOG_START = 6;
  const fogT = (z) => 1 - Math.exp(-Math.max(0, z - FOG_START) * fogDensity);

  /* ------------------------------- palette ------------------------------- */

  const P = {
    skyTop: '#78828a',
    skyMid: '#a3a9aa',
    skyLow: '#c8c4b9',
    fog: '#b2b4b0',
    fogWarm: '#c9bda8',
    roadFar: '#a4a8a7',
    roadNear: '#191d20',
    roadWet: '#4a5054',
    bldFront: '#5b6165',
    bldSide: '#252b31',
    bldFar: '#7d858a',
    bldDark: '#2f363b',
    concrete: '#363c40',
    metal: '#3b4247',
    foliage: '#1e2723',
    foliageLit: '#4c5a4a',
    warmWin: '#ffc079',
    warmCore: '#fff2d4',
    sodium: '#ffa244',
    ledRed: '#ff3a2a',
    sigGreen: '#4dffb2',
    sigAmber: '#ffab35',
    sigRed: '#ff4630',
    brake: '#ff3120',
    walk: '#e2f4ff',
    hand: '#ff6b2e',
    boxOrange: '#c9491c',
    taxi: '#efc02a',
    banner: '#3a2c5e',
    awning: '#22302c',
    shirtRed: '#c0392b'
  };

  const rgbCache = new Map();
  function RGB(hex) {
    let v = rgbCache.get(hex);
    if (!v) {
      v = hexToRgb(hex);
      rgbCache.set(hex, v);
    }
    return v;
  }

  const FOG = RGB(P.fog);

  /** hex mixed toward the fog by depth; `lift` adds extra haze on top. */
  function fogged(hex, z, lift = 0) {
    const c = RGB(hex);
    const t = clamp(fogT(z) + lift);
    return {
      r: c.r + (FOG.r - c.r) * t,
      g: c.g + (FOG.g - c.g) * t,
      b: c.b + (FOG.b - c.b) * t
    };
  }

  const setFill = (g, c, a = 255) => g.fill(c.r, c.g, c.b, a);
  const setStroke = (g, c, a = 255) => g.stroke(c.r, c.g, c.b, a);

  /* ---------------------------- glow sprite ------------------------------ */

  // Soft radial sprites, one per colour, blitted through the raw 2D context.
  // p5's tint() re-tints the source image pixel by pixel on every call, which
  // at a few hundred glows a frame costs more than the rest of the piece put
  // together; pre-colouring and using globalAlpha is ~200x cheaper.
  const SPR = 96;
  const spriteCache = new Map();

  function spriteFor(hex) {
    let sp = spriteCache.get(hex);
    if (sp) return sp;
    const c = RGB(hex);
    const g = p.createGraphics(SPR * 2, SPR * 2);
    g.pixelDensity(1);
    g.loadPixels();
    for (let y = 0; y < SPR * 2; y++) {
      for (let x = 0; x < SPR * 2; x++) {
        const d = Math.hypot(x - SPR + 0.5, y - SPR + 0.5) / SPR;
        // Two lobes: a tight core and a wide atmospheric bloom, which is what
        // a light actually grows inside rain.
        const a = d > 1 ? 0 : clamp(Math.exp(-d * d * 13) + Math.exp(-d * d * 2.1) * 0.5);
        const i = (y * SPR * 2 + x) * 4;
        g.pixels[i] = c.r;
        g.pixels[i + 1] = c.g;
        g.pixels[i + 2] = c.b;
        g.pixels[i + 3] = Math.round(a * 255);
      }
    }
    g.updatePixels();
    spriteCache.set(hex, g);
    return g;
  }

  /** Soft radial mark. Works in both BLEND and ADD; caller sets the mode. */
  function glow(g, sx, sy, r, hex, a, squash = 1) {
    if (r < 0.5 || a <= 1.2) return;
    if (sx < -r * 2 || sx > W + r * 2 || sy < -r * 3 || sy > H + r * 3) return;
    const cx = g.drawingContext;
    const prev = cx.globalAlpha;
    cx.globalAlpha = Math.min(1, a / 255);
    cx.drawImage(spriteFor(hex).canvas, sx - r, sy - r * squash, r * 2, r * 2 * squash);
    cx.globalAlpha = prev;
  }

  /* --------------------------- world primitives -------------------------- */

  const V = (x, y, z) => ({ x, y, z });

  /** Fill a world-space quad. Skips anything that crosses behind the lens. */
  function quad3(g, a, b, c, d, col, alpha = 255) {
    const pa = project(a.x, a.y, a.z);
    const pb = project(b.x, b.y, b.z);
    const pc = project(c.x, c.y, c.z);
    const pd = project(d.x, d.y, d.z);
    if (!pa || !pb || !pc || !pd) return null;
    setFill(g, col, alpha);
    g.quad(pa.x, pa.y, pb.x, pb.y, pc.x, pc.y, pd.x, pd.y);
    return [pa, pb, pc, pd];
  }

  /**
   * A face is an origin plus two world directions and their extents, so a
   * window at (u, v) on the face is an exact world quad — no affine
   * interpolation of an already-projected shape, which would bow the grid.
   */
  function facePoint(f, u, v) {
    return V(
      f.o.x + f.u.x * u + f.v.x * v,
      f.o.y + f.u.y * u + f.v.y * v,
      f.o.z + f.u.z * u + f.v.z * v
    );
  }

  function faceQuad(g, f, u0, v0, u1, v1, col, alpha = 255) {
    return quad3(
      g,
      facePoint(f, u0, v0),
      facePoint(f, u1, v0),
      facePoint(f, u1, v1),
      facePoint(f, u0, v1),
      col,
      alpha
    );
  }

  /* -------------------------------- layout ------------------------------- */

  // Emitters. Everything in here gets a bloom, a mirrored smear in the road,
  // and a chance to brighten rain falling in front of it.
  const lights = [];
  const addLight = (o) => {
    lights.push(o);
    return o;
  };

  const buildings = [];
  const trees = [];
  const posts = [];
  const banners = [];
  const awnings = [];
  const shopfronts = [];
  const props = [];

  // The fixed landmark: the signal mast right of centre that splits the
  // frame. Seeds move the city around it, never it.
  const MAST = { x: 0.55, z: 14, h: 12.5, r: 0.17 };
  const CURB_X = 3.2;

  let signals = [];
  let pedSignal = null;
  let ledSign = null;
  let lampGlare = null;

  function makeLayout() {
    /* --- left block: the lit facade that owns the upper left ------------- */
    const zL = rng.range(40, 52);
    const left = {
      x0: -46,
      x1: rng.range(-6.5, -2.5),
      z0: zL,
      z1: zL + rng.range(18, 30),
      h: rng.range(20, 29),
      kind: 'lit',
      floors: rng.int(5, 8),
      cols: rng.int(16, 26),
      litBias: rng.range(-0.05, 0.34),
      warm: rng.pick([P.warmWin, '#ffb96a', '#ffcb8c'])
    };
    buildings.push(left);

    // The facade is aggregated into a few reflectors: two hundred window
    // reflections would be mud, and at this distance the road only ever
    // shows the mass anyway.
    for (let i = 0; i < 5; i++) {
      addLight({
        x: lerp(left.x1 - 2, -24, (i + rng.range(0.1, 0.9)) / 5),
        y: ((i + 0.6) / 5) * left.h * 0.86 + 2,
        z: zL,
        hex: left.warm,
        r: 1.3,
        power: 0.55,
        bloom: 0.55
      });
    }

    // A red sign band high on the facade: the one hot accent up in the fog,
    // and the only saturated red above the horizon.
    ledSign = {
      x: left.x1 - rng.range(11, 20),
      y: left.h * rng.range(0.55, 0.76),
      z: zL,
      w: rng.range(3.0, 5.0),
      rows: rng.int(1, 2)
    };
    addLight({ x: ledSign.x, y: ledSign.y, z: zL, hex: P.ledRed, r: 3.0, power: 0.62, bloom: 0.8 });

    /* --- distant blocks dissolving into the fog wall --------------------- */
    let cursor = -44;
    while (cursor < 12) {
      const w = rng.range(9, 22);
      const z0 = rng.range(72, 150);
      buildings.push({
        x0: cursor,
        x1: cursor + w,
        z0,
        z1: z0 + rng.range(12, 30),
        h: rng.range(14, 40),
        kind: 'far',
        floors: rng.int(4, 10),
        cols: rng.int(5, 12),
        litBias: rng.range(0.3, 0.7),
        warm: P.warmWin
      });
      cursor += w + rng.range(2, 9);
    }

    /* --- right block: the dark wall that closes the frame ---------------- */
    const rightX = rng.range(4.6, 5.8);
    const right = {
      x0: rightX,
      x1: 40,
      z0: 3,
      z1: rng.range(32, 48),
      h: rng.range(24, 34),
      kind: 'wall',
      floors: rng.int(6, 10),
      cols: rng.int(10, 16),
      litBias: rng.range(0.72, 0.93),
      warm: rng.pick(['#f0cf9a', '#e6c489', '#f4d9ab'])
    };
    buildings.push(right);

    // Storefronts along its base: the only cold light in the piece, set
    // against all that sodium.
    let sz = rng.range(10, 13.5);
    while (sz < right.z1 - 4) {
      const len = rng.range(1.8, 3.6);
      const cold = rng.chance(0.55);
      const hex = cold ? rng.pick(['#6fb3c8', '#88a9ca', '#63a6b8']) : rng.pick(['#e0b47e', '#e0a45e']);
      shopfronts.push({ x: rightX, z0: sz, z1: sz + len, y0: 0.4, y1: rng.range(2.3, 2.9), hex });
      addLight({ x: rightX - 0.2, y: 1.9, z: sz + len * 0.5, hex, r: 1.9, power: 0.42, bloom: 0.6 });
      sz += len + rng.range(0.9, 3.0);
    }

    // Awnings notch the wall into dark horizontal bands.
    let az = rng.range(13, 16);
    while (az < right.z1 - 5) {
      const len = rng.range(3, 6.5);
      awnings.push({ x: rightX, z0: az, z1: az + len, y: rng.range(3.0, 3.5), depth: rng.range(0.9, 1.4) });
      az += len + rng.range(1.6, 4.5);
    }

    // Banner poles on the near sidewalk.
    for (let i = 0, n = rng.int(2, 3); i < n; i++) {
      banners.push({
        x: rightX - rng.range(0.5, 1.1),
        z: rng.range(17, 34),
        y0: rng.range(5.0, 6.0),
        h: rng.range(1.7, 2.4),
        w: rng.range(0.8, 1.1),
        hue: rng.pick(['#241b3c', '#1f1c38', '#2c2038']),
        mark: rng.range(0.25, 0.7)
      });
    }

    /* --- street furniture ------------------------------------------------ */

    // Sodium heads on curved arms leaning out over the roadway. The nearest
    // one is the brightest thing in the frame and anchors the warm side.
    for (let i = 0, n = rng.int(2, 3); i < n; i++) {
      const z = rng.range(16, 40);
      const x = rng.range(-13, -5);
      const post = { x, z, h: rng.range(6.6, 8.4), r: 0.11, kind: 'lamp', reach: rng.range(1.8, 3.0) };
      posts.push(post);
      const l = addLight({
        x: x + post.reach,
        y: post.h,
        z,
        hex: P.sodium,
        r: 0.5,
        power: 1.0,
        bloom: 3.4,
        haze: true
      });
      if (!lampGlare || z < lampGlare.z) lampGlare = l;
    }

    // Signals at three depths. The cross-street heads run the opposite
    // phase, which is what makes the pair read as an intersection rather
    // than two decorations.
    signals = [
      { x: rng.range(-6, -2), y: rng.range(3.7, 4.5), z: rng.range(20, 27), offset: 0, size: 0.4 },
      { x: rng.range(2.5, 6), y: rng.range(3.6, 4.4), z: rng.range(33, 46), offset: 0.5, size: 0.36 },
      { x: rng.range(-16, -6), y: rng.range(3.6, 4.4), z: rng.range(55, 78), offset: rng.chance(0.5) ? 0 : 0.5, size: 0.34 }
    ];
    if (rng.chance(0.55)) {
      signals.push({ x: rng.range(-4, 4), y: rng.range(3.6, 4.2), z: rng.range(60, 95), offset: 0, size: 0.3 });
    }
    for (const s of signals) {
      posts.push({ x: s.x, z: s.z, h: s.y + 0.55, r: 0.08, kind: 'signal' });
      s.light = addLight({ x: s.x, y: s.y, z: s.z, hex: P.sigGreen, r: 0.4, power: 1.0, bloom: 2.0, dyn: 'signal', ref: s });
    }

    pedSignal = { x: MAST.x + 0.46, y: 2.95, z: MAST.z, w: 0.55, h: 0.62 };
    pedSignal.light = addLight({
      x: pedSignal.x,
      y: pedSignal.y,
      z: pedSignal.z,
      hex: P.walk,
      r: 0.34,
      power: 0.85,
      bloom: 1.2,
      dyn: 'ped'
    });

    // The orange box beside the mast: a near-field block of local colour
    // that stops the middle distance going entirely grey.
    props.push({
      kind: 'box',
      x: MAST.x + rng.range(0.8, 1.4),
      z: MAST.z - rng.range(3.0, 4.2),
      w: 0.62,
      h: 1.2,
      d: 0.5,
      hex: P.boxOrange
    });
    if (rng.chance(0.6)) {
      props.push({ kind: 'bin', x: CURB_X + rng.range(0.3, 1.2), z: rng.range(15, 26), w: 0.6, h: 0.95, d: 0.6, hex: '#4b5155' });
    }
    for (let i = 0, n = rng.int(3, 6); i < n; i++) {
      props.push({ kind: 'bollard', x: rng.range(-11, -4), z: rng.range(16, 25), w: 0.18, h: 1.0, d: 0.18, hex: '#22282b' });
    }

    /* --- trees: soft dark masses in the middle distance ------------------ */
    for (let i = 0, n = rng.int(4, 7); i < n; i++) {
      trees.push({
        x: rng.range(-19, 3.5),
        z: rng.range(18, 47),
        trunk: rng.range(2.4, 3.6),
        r: rng.range(2.8, 5.0),
        blobs: rng.int(26, 44),
        n: rng.range(0, 100)
      });
    }
    trees.sort((a, b) => b.z - a.z);
    buildings.sort((a, b) => b.z0 - a.z0);
  }

  /* ---------------------------- the static plate -------------------------- */

  // Everything that does not move is painted once and blitted each frame.
  // Only light, water, people and traffic are recomputed.
  let plate = null;

  function paintSky(g) {
    for (let y = 0; y <= HORIZON + 3; y += 2) {
      const t = y / HORIZON;
      const c =
        t < 0.55
          ? mixRGB(RGB(P.skyTop), RGB(P.skyMid), t / 0.55)
          : mixRGB(RGB(P.skyMid), RGB(P.skyLow), (t - 0.55) / 0.45);
      g.noStroke();
      setFill(g, c, 255);
      g.rect(0, y, W, 3);
    }
    // Cloud base: soft darker masses drifting across the top, so the sky is
    // weather rather than a gradient.
    for (let i = 0; i < 90; i++) {
      const x = rng.range(-0.1, 1.1) * W;
      const y = rng.range(-0.05, 0.55) * HORIZON;
      const r = rng.range(0.08, 0.3) * W;
      const n = noise.fbm2D(x * 0.002, y * 0.004, { octaves: 3 });
      glow(g, x, y, r, n > 0 ? '#6e767d' : '#c6c8c4', 12 + Math.abs(n) * 26, 0.5);
    }
  }

  function mixRGB(a, b, t) {
    return { r: lerp(a.r, b.r, t), g: lerp(a.g, b.g, t), b: lerp(a.b, b.b, t) };
  }

  function paintGround(g) {
    const near = RGB(P.roadNear);
    g.noStroke();
    for (let y = HORIZON; y < H; y += 2) {
      const z = groundZ(y + 1);
      const t = clamp(fogT(z) * 1.04);
      setFill(g, mixRGB(near, FOG, t), 255);
      g.rect(0, y, W, 3);
    }

    // Puddle field: broad soft value patches in world space, so the sheen
    // pools and drains in bands rather than sitting as screen-space noise.
    for (let i = 0; i < 1400; i++) {
      const z = 4.2 + rng.skew(1.7) * 70;
      const x = rng.range(-1, 1) * (z * 0.75 + 8);
      const pr = project(x, 0.002, z);
      if (!pr || pr.y > H + 60) continue;
      const n = noise.fbm2D(x * 0.09, z * 0.06, { octaves: 3 });
      const r = rng.range(0.5, 3.2) * pr.s;
      const wet = n > 0.06;
      glow(g, pr.x, pr.y, r, wet ? '#c2c6c4' : '#1e2326', (Math.abs(n) * 26 + 5) * (1 - fogT(z) * 0.8), EYE / z);
    }

    // Crosswalk: the ladder we are standing on, plus the one running away
    // across the side street. Worn by a noise field, never a clean stripe.
    const stripe = (a, b, c, d, z) => {
      const n = noise.noise2D(a.x * 0.12, a.z * 0.12) * 0.5 + 0.5;
      quad3(g, a, b, c, d, fogged('#b9bdbb', z), 18 + n * 46);
    };
    for (let z = 4.3; z < 13.5; z += 1.42) {
      stripe(V(-13, 0.004, z), V(CURB_X, 0.004, z), V(CURB_X, 0.004, z + 0.62), V(-13, 0.004, z + 0.62), z);
    }
    for (let x = -14; x < 2; x += 1.42) {
      stripe(V(x, 0.004, 15), V(x + 0.62, 0.004, 15), V(x + 0.62, 0.004, 24), V(x, 0.004, 24), 19);
    }

    // Curb and the raised sidewalk on the right.
    for (let z = 9; z < 56; z += 2) {
      const zm = z + 1;
      quad3(g, V(CURB_X, 0.17, z), V(26, 0.17, z), V(26, 0.17, z + 2.05), V(CURB_X, 0.17, z + 2.05), fogged(P.concrete, zm), 235);
      quad3(g, V(CURB_X, 0, z), V(CURB_X, 0.17, z), V(CURB_X, 0.17, z + 2.05), V(CURB_X, 0, z + 2.05), fogged('#5e6467', zm), 220);
    }
  }

  /* ------------------------------ facades -------------------------------- */

  function buildFaces(b) {
    const faces = [];
    if (b.kind === 'wall') {
      faces.push({
        o: V(b.x0, 0, b.z0),
        u: V(0, 0, 1),
        v: V(0, 1, 0),
        wu: b.z1 - b.z0,
        wv: b.h,
        side: true
      });
    } else {
      faces.push({ o: V(b.x0, 0, b.z0), u: V(1, 0, 0), v: V(0, 1, 0), wu: b.x1 - b.x0, wv: b.h, side: false });
      if (b.x1 < -0.5 && b.kind === 'lit') {
        faces.push({ o: V(b.x1, 0, b.z0), u: V(0, 0, 1), v: V(0, 1, 0), wu: b.z1 - b.z0, wv: b.h, side: true });
      }
    }
    return faces;
  }

  function paintBuilding(g, b) {
    for (const f of buildFaces(b)) {
      const base = f.side ? P.bldSide : b.kind === 'far' ? P.bldFar : P.bldFront;
      const n = f.side ? 34 : 18;
      for (let i = 0; i < n; i++) {
        const u0 = (i / n) * f.wu;
        const u1 = ((i + 1.02) / n) * f.wu;
        const mid = facePoint(f, (u0 + u1) * 0.5, f.wv * 0.5);
        faceQuad(g, f, u0, 0, u1, f.wv, fogged(base, mid.z));
      }
      paintWindows(g, b, f);
    }
  }

  function paintWindows(g, b, f) {
    const cols = Math.max(2, Math.round(b.cols * (f.side ? f.wu / Math.max(1, b.x1 - b.x0) : 1)));
    const floorH = f.wv / b.floors;
    const colW = f.wu / cols;
    const winH = floorH * 0.54;
    const winW = colW * 0.7;
    const sill = floorH * 0.24;
    const warm = RGB(b.warm);
    const core = RGB(P.warmCore);
    const blooms = [];

    for (let fl = 0; fl < b.floors; fl++) {
      const v0 = fl * floorH + sill;
      // Glass buildings read as continuous lit bands before they read as
      // windows; the band carries the floor, the panels carry the texture.
      if (b.kind === 'lit') {
        const mid = facePoint(f, f.wu * 0.5, v0 + winH * 0.5);
        faceQuad(g, f, 0, v0, f.wu, v0 + winH, fogged(b.warm, mid.z * 0.42), 40);
      }
      for (let c = 0; c < cols; c++) {
        // Lit windows cluster: a noise field, not a coin flip per cell.
        const field = noise.noise2D(c * 0.5 + b.z0 * 0.07, fl * 0.75 + b.x0 * 0.03);
        if (field < b.litBias) continue;
        const u0 = c * colW + (colW - winW) * 0.5;
        const pt = facePoint(f, u0 + winW * 0.5, v0 + winH * 0.5);
        const bright = clamp(0.35 + (field - b.litBias) * 1.5 + rng.jitter(0.18));
        const col = mixRGB(warm, core, bright * 0.6);
        // Emissive: light scatters through haze rather than being buried by
        // it, so windows keep punching out of the fog wall.
        const t = clamp(fogT(pt.z) * 0.66);
        faceQuad(g, f, u0, v0, u0 + winW, v0 + winH, mixRGB(col, FOG, t), 190 + bright * 60);
        const pr = project(pt.x, pt.y, pt.z);
        if (pr && bright > 0.45) blooms.push({ pr, bright, z: pt.z, w: winW });
      }
    }

    g.blendMode(g.ADD);
    for (const bl of blooms) {
      glow(g, bl.pr.x, bl.pr.y, Math.max(3, bl.w * bl.pr.s * 2.0), b.warm, (13 + bl.bright * 22) * (1 - fogT(bl.z) * 0.45));
    }
    g.blendMode(g.BLEND);
  }

  function paintLedSign(g) {
    const s = ledSign;
    const rowH = 0.38;
    for (let r = 0; r < s.rows; r++) {
      const y = s.y + r * (rowH * 1.5);
      let x = s.x;
      while (x < s.x + s.w) {
        const seg = rng.range(0.22, 0.75);
        if (rng.chance(0.82)) {
          quad3(g, V(x, y, s.z), V(x + seg, y, s.z), V(x + seg, y + rowH, s.z), V(x, y + rowH, s.z),
            mixRGB(RGB(P.ledRed), FOG, fogT(s.z) * 0.35), 235);
        }
        x += seg + rng.range(0.12, 0.34);
      }
    }
    const pr = project(s.x + s.w * 0.5, s.y + s.rows * 0.4, s.z);
    if (pr) {
      g.blendMode(g.ADD);
      glow(g, pr.x, pr.y, s.w * pr.s * 1.5, P.ledRed, 60);
      g.blendMode(g.BLEND);
      }
  }

  /* --------------------------- furniture & trees -------------------------- */

  function paintTrees(g) {
    for (const tr of trees) {
      const fog = fogT(tr.z);
      quad3(g, V(tr.x - 0.12, 0, tr.z), V(tr.x + 0.12, 0, tr.z), V(tr.x + 0.12, tr.trunk + 0.6, tr.z),
        V(tr.x - 0.12, tr.trunk + 0.6, tr.z), fogged('#2a2f2c', tr.z), 235);
      const cy = tr.trunk + tr.r * 0.85;
      for (let i = 0; i < tr.blobs; i++) {
        const a = rng.range(0, TAU);
        const rr = Math.sqrt(rng()) * tr.r;
        const ox = Math.cos(a) * rr;
        const oy = Math.sin(a) * rr * 0.85;
        const oz = rng.jitter(tr.r * 0.5);
        const pr = project(tr.x + ox, cy + oy, tr.z + oz);
        if (!pr) continue;
        // Canopy is silhouette first: dark, soft-edged, only the lamp side
        // lifts. Detail here would only fight the fog.
        const lit = lampGlare ? clamp(1 - Math.hypot(tr.x + ox - lampGlare.x, cy + oy - lampGlare.y) / 12) : 0;
        const hex = lit > 0.45 && rng.chance(0.3) ? P.foliageLit : P.foliage;
        glow(g, pr.x, pr.y, rng.range(0.5, 1.1) * tr.r * 0.5 * pr.s, hex, (118 + lit * 40) * (1 - fog * 0.7), 0.9);
      }
      }
  }

  function paintPosts(g) {
    for (const po of posts) {
      quad3(g, V(po.x - po.r, 0, po.z), V(po.x + po.r, 0, po.z), V(po.x + po.r, po.h, po.z), V(po.x - po.r, po.h, po.z),
        fogged(P.metal, po.z), 240);
      if (po.kind !== 'lamp') continue;
      // Curved arm out over the roadway.
      const steps = 12;
      for (let i = 0; i < steps; i++) {
        const t0 = i / steps;
        const t1 = (i + 1) / steps;
        const px = (t) => po.x + po.reach * t * t;
        const py = (t) => po.h - 1.5 + 1.5 * (1 - (1 - t) * (1 - t));
        quad3(g, V(px(t0), py(t0) - 0.07, po.z), V(px(t1), py(t1) - 0.07, po.z),
          V(px(t1), py(t1) + 0.07, po.z), V(px(t0), py(t0) + 0.07, po.z), fogged(P.metal, po.z), 235);
      }
      quad3(g, V(po.x + po.reach - 0.35, po.h - 0.16, po.z), V(po.x + po.reach + 0.35, po.h - 0.16, po.z),
        V(po.x + po.reach + 0.35, po.h + 0.1, po.z), V(po.x + po.reach - 0.35, po.h + 0.1, po.z),
        fogged('#2b3136', po.z), 240);
    }

    // Signal housings are static; only the lens changes.
    for (const s of signals) {
      const w = s.size * 0.62;
      quad3(g, V(s.x - w, s.y - s.size * 1.5, s.z), V(s.x + w, s.y - s.size * 1.5, s.z),
        V(s.x + w, s.y + s.size * 1.5, s.z), V(s.x - w, s.y + s.size * 1.5, s.z), fogged('#1d2326', s.z), 245);
    }
  }

  function paintBanners(g) {
    for (const b of banners) {
      const wall = buildings.find((q) => q.kind === 'wall');
      quad3(g, V(b.x - b.w, b.y0 - 0.08, b.z), V(wall.x0, b.y0 - 0.08, b.z), V(wall.x0, b.y0, b.z), V(b.x - b.w, b.y0, b.z),
        fogged(P.metal, b.z), 235);
      quad3(g, V(b.x - b.w, b.y0 - b.h, b.z), V(b.x, b.y0 - b.h, b.z), V(b.x, b.y0, b.z), V(b.x - b.w, b.y0, b.z),
        fogged(b.hue, b.z), 240);
      // One pale abstract mark low on the banner — a shape, never lettering.
      const my = b.y0 - b.h * b.mark;
      quad3(g, V(b.x - b.w * 0.72, my, b.z), V(b.x - b.w * 0.28, my, b.z),
        V(b.x - b.w * 0.28, my + b.h * 0.16, b.z), V(b.x - b.w * 0.72, my + b.h * 0.16, b.z),
        fogged('#a9a4bd', b.z), 190);
    }
  }

  function paintWallDetail(g) {
    for (const a of awnings) {
      for (let z = a.z0; z < a.z1; z += 1.2) {
        const z1 = Math.min(a.z1, z + 1.22);
        quad3(g, V(a.x, a.y, z), V(a.x - a.depth, a.y - 0.35, z), V(a.x - a.depth, a.y - 0.35, z1), V(a.x, a.y, z1),
          fogged(P.awning, z), 245);
        quad3(g, V(a.x - a.depth, a.y - 0.35, z), V(a.x - a.depth, a.y - 0.95, z), V(a.x - a.depth, a.y - 0.95, z1),
          V(a.x - a.depth, a.y - 0.35, z1), fogged('#171f1d', z), 245);
      }
    }
    for (const s of shopfronts) {
      // Dark reveal around the glass, so the panel reads as a window in a wall
      // rather than a rectangle floating in front of one.
      quad3(g, V(s.x - 0.02, s.y0 - 0.3, s.z0 - 0.35), V(s.x - 0.02, s.y0 - 0.3, s.z1 + 0.35),
        V(s.x - 0.02, s.y1 + 0.35, s.z1 + 0.35), V(s.x - 0.02, s.y1 + 0.35, s.z0 - 0.35), fogged('#12181a', s.z0), 250);
      // Mullions: glass divided into panes reads as a shopfront; one
      // unbroken rectangle reads as a lightbox.
      const panes = Math.max(2, Math.round((s.z1 - s.z0) / 1.1));
      const pw = (s.z1 - s.z0) / panes;
      for (let i = 0; i < panes; i++) {
        const z = s.z0 + i * pw + 0.07;
        const z1 = s.z0 + (i + 1) * pw - 0.07;
        const t = clamp(fogT(z) * 0.45);
        const v = 0.82 + noise.noise2D(i * 1.3, s.z0 * 0.4) * 0.18;
        quad3(g, V(s.x, s.y0, z), V(s.x, s.y0, z1), V(s.x, s.y1, z1), V(s.x, s.y1, z),
          mixRGB(shadeRGB(s.hex, v), FOG, t), 180);
      }
      const pr = project(s.x, (s.y0 + s.y1) * 0.5, (s.z0 + s.z1) * 0.5);
      const pool = project(s.x - 1.1, 0.18, (s.z0 + s.z1) * 0.5);
      if (pr) {
        g.blendMode(g.ADD);
        // Light pooling on the wet pavement in front of the glass.
        if (pool) glow(g, pool.x, pool.y, Math.min((s.z1 - s.z0) * pool.s * 0.8, W * 0.14), s.hex, 30, 0.35);
        glow(g, pr.x, pr.y, Math.min((s.z1 - s.z0) * pr.s * 0.4, W * 0.16), s.hex, 40);
        g.blendMode(g.BLEND);
          }
    }
  }

  function paintProps(g) {
    const sorted = props.slice().sort((a, b) => b.z - a.z);
    for (const b of sorted) {
      const hw = b.w * 0.5;
      const hd = b.d * 0.5;
      quad3(g, V(b.x - hw, 0, b.z - hd), V(b.x + hw, 0, b.z - hd), V(b.x + hw, b.h, b.z - hd), V(b.x - hw, b.h, b.z - hd),
        fogged(b.hex, b.z), 250);
      if (b.x - hw > 0.2) {
        quad3(g, V(b.x - hw, 0, b.z - hd), V(b.x - hw, 0, b.z + hd), V(b.x - hw, b.h, b.z + hd), V(b.x - hw, b.h, b.z - hd),
          fogged(b.hex, b.z, 0.18), 250);
      }
      if (b.kind === 'box') {
        // Window, lid and a wet highlight down the near corner.
        quad3(g, V(b.x - hw * 0.66, b.h * 0.44, b.z - hd - 0.01), V(b.x + hw * 0.66, b.h * 0.44, b.z - hd - 0.01),
          V(b.x + hw * 0.66, b.h * 0.78, b.z - hd - 0.01), V(b.x - hw * 0.66, b.h * 0.78, b.z - hd - 0.01),
          fogged('#1b2124', b.z), 240);
        quad3(g, V(b.x - hw, b.h, b.z - hd), V(b.x + hw, b.h, b.z - hd), V(b.x + hw, b.h, b.z + hd),
          V(b.x - hw, b.h, b.z + hd), fogged('#8a5334', b.z), 250);
        quad3(g, V(b.x - hw, 0, b.z - hd - 0.02), V(b.x - hw * 0.82, 0, b.z - hd - 0.02),
          V(b.x - hw * 0.82, b.h, b.z - hd - 0.02), V(b.x - hw, b.h, b.z - hd - 0.02),
          fogged('#f0885a', b.z), 190);
      }
    }
  }

  function paintMast(g) {
    const m = MAST;
    quad3(g, V(m.x - m.r, 0, m.z), V(m.x + m.r, 0, m.z), V(m.x + m.r, m.h, m.z), V(m.x - m.r, m.h, m.z),
      fogged('#171b1e', m.z), 252);
    // Highlight edge: a wet metal pole is a dark bar with one bright side.
    quad3(g, V(m.x + m.r * 0.35, 0, m.z - 0.01), V(m.x + m.r, 0, m.z - 0.01), V(m.x + m.r, m.h, m.z - 0.01),
      V(m.x + m.r * 0.35, m.h, m.z - 0.01), fogged('#454b4e', m.z), 190);

    // Arm and the ONE WAY plate.
    const ay = 5.15;
    quad3(g, V(m.x - 1.66, ay + 0.02, m.z), V(m.x, ay + 0.02, m.z), V(m.x, ay + 0.16, m.z), V(m.x - 1.66, ay + 0.16, m.z),
      fogged('#20262a', m.z), 250);
    const sx0 = m.x - 1.62;
    const sx1 = m.x - 0.34;
    quad3(g, V(sx0, ay - 0.38, m.z), V(sx1, ay - 0.38, m.z), V(sx1, ay + 0.02, m.z), V(sx0, ay + 0.02, m.z),
      fogged('#171b1d', m.z), 250);
    // Arrow: a bar and a head, no lettering.
    const ax = sx0 + 0.14;
    quad3(g, V(ax + 0.14, ay - 0.21, m.z - 0.01), V(sx1 - 0.14, ay - 0.21, m.z - 0.01),
      V(sx1 - 0.14, ay - 0.14, m.z - 0.01), V(ax + 0.14, ay - 0.14, m.z - 0.01), fogged('#e6e8e4', m.z), 240);
    const pa = project(ax, ay - 0.175, m.z - 0.01);
    const pb = project(ax + 0.2, ay - 0.04, m.z - 0.01);
    const pc = project(ax + 0.2, ay - 0.31, m.z - 0.01);
    if (pa && pb && pc) {
      const c = fogged('#e6e8e4', m.z);
      setFill(g, c, 240);
      g.triangle(pa.x, pa.y, pb.x, pb.y, pc.x, pc.y);
    }
    // A small secondary plate below, as on every real mast.
    quad3(g, V(m.x - 0.34, ay - 1.1, m.z), V(m.x - 0.02, ay - 1.1, m.z), V(m.x - 0.02, ay - 0.62, m.z),
      V(m.x - 0.34, ay - 0.62, m.z), fogged('#20262a', m.z), 245);

    // Pedestrian signal housing.
    const ps = pedSignal;
    quad3(g, V(ps.x - ps.w * 0.5, ps.y - ps.h * 0.5, ps.z), V(ps.x + ps.w * 0.5, ps.y - ps.h * 0.5, ps.z),
      V(ps.x + ps.w * 0.5, ps.y + ps.h * 0.5, ps.z), V(ps.x - ps.w * 0.5, ps.y + ps.h * 0.5, ps.z),
      fogged('#1a2023', ps.z), 252);
    quad3(g, V(ps.x - ps.w * 0.5, ps.y + ps.h * 0.5, ps.z), V(ps.x + ps.w * 0.62, ps.y + ps.h * 0.5, ps.z),
      V(ps.x + ps.w * 0.62, ps.y + ps.h * 0.62, ps.z), V(ps.x - ps.w * 0.5, ps.y + ps.h * 0.62, ps.z),
      fogged('#2b3236', ps.z), 250);
  }

  function paintPlate() {
    const g = p.createGraphics(W, H);
    g.pixelDensity(1);
    g.noStroke();
    paintSky(g);
    paintGround(g);
    for (const b of buildings) paintBuilding(g, b);
    paintLedSign(g);
    paintTrees(g);
    paintWallDetail(g);
    paintPosts(g);
    paintBanners(g);
    paintProps(g);
    paintMast(g);
    plate = g;
  }

  /* ------------------------------ the signals ----------------------------- */

  // Slow enough to be watched rather than noticed. Green owns most of the
  // cycle, amber is a beat, red holds while people cross.
  const CYCLE = 21;

  function signalHex(offset, t) {
    const u = (t / CYCLE + offset) % 1;
    if (u < 0.44) return P.sigGreen;
    if (u < 0.52) return P.sigAmber;
    return P.sigRed;
  }

  /** Walk while the near street is stopped, then a slow flashing hand. */
  function pedState(t) {
    const u = (t / CYCLE) % 1;
    if (u < 0.52) return { hex: P.hand, on: 1, walk: false };
    const r = (u - 0.52) / 0.48;
    if (r < 0.62) return { hex: P.walk, on: 1, walk: true };
    if (r < 0.9) return { hex: P.hand, on: Math.sin(t * TAU * 0.9) > 0 ? 1 : 0.06, walk: false };
    return { hex: P.hand, on: 1, walk: false };
  }

  function lightHex(l, t) {
    if (l.dyn === 'signal') return signalHex(l.ref.offset, t);
    if (l.dyn === 'ped') return pedState(t).hex;
    return l.hex;
  }

  function lightPower(l, t) {
    if (l.dyn === 'ped') return l.power * pedState(t).on;
    return l.power;
  }

  function drawSignalLenses(g, t) {
    for (const s of signals) {
      const hex = signalHex(s.offset, t);
      const pr = project(s.x, s.y, s.z);
      if (!pr) continue;
      const r = s.size * pr.s * 0.42;
      const c = mixRGB(RGB(hex), FOG, fogT(s.z) * 0.35);
      g.noStroke();
      setFill(g, c, 250);
      g.ellipse(pr.x, pr.y, r * 2, r * 2);
    }

    const ps = pedSignal;
    const st = pedState(t);
    const pr = project(ps.x, ps.y, ps.z);
    if (pr && st.on > 0.5) {
      const c = mixRGB(RGB(st.hex), FOG, fogT(ps.z) * 0.3);
      g.noStroke();
      setFill(g, c, 250);
      const w = ps.w * pr.s * 0.62;
      const h = ps.h * pr.s * 0.62;
      if (st.walk) {
        // Striding figure: a head, a body bar, two legs.
        g.ellipse(pr.x, pr.y - h * 0.32, w * 0.24, w * 0.24);
        g.rectMode(p.CENTER);
        g.rect(pr.x, pr.y - h * 0.02, w * 0.2, h * 0.36);
        g.rectMode(p.CORNER);
        g.strokeCap(p.SQUARE);
        setStroke(g, c, 250);
        g.strokeWeight(w * 0.12);
        g.line(pr.x, pr.y + h * 0.12, pr.x - w * 0.22, pr.y + h * 0.42);
        g.line(pr.x, pr.y + h * 0.12, pr.x + w * 0.2, pr.y + h * 0.4);
        g.noStroke();
      } else {
        // Raised hand: a palm block with four stubs.
        g.rectMode(p.CENTER);
        g.rect(pr.x, pr.y + h * 0.08, w * 0.46, h * 0.34);
        for (let i = 0; i < 4; i++) {
          g.rect(pr.x - w * 0.17 + i * w * 0.115, pr.y - h * 0.18, w * 0.085, h * 0.24);
        }
        g.rectMode(p.CORNER);
      }
    }
  }

  function drawBlooms(g, t, extra) {
    g.blendMode(g.ADD);
    for (const l of lights) {
      const pr = project(l.x, l.y, l.z);
      if (!pr) continue;
      const hex = lightHex(l, t);
      const pw = lightPower(l, t);
      if (pw <= 0.02) continue;
      const clear = 1 - fogT(l.z) * 0.35;
      glow(g, pr.x, pr.y, Math.max(4, l.r * pr.s * (1.6 + (l.bloom ?? 1) * 1.5)), hex, 52 * pw * clear);
      // Haze lobe: the big soft ball a strong lamp grows inside rain.
      if (l.haze) glow(g, pr.x, pr.y, Math.min(l.r * pr.s * 16 * (0.7 + storm * 0.6), W * 0.26), hex, 20 * pw * (1 - fogT(l.z) * 0.5));
      glow(g, pr.x, pr.y, Math.max(2, l.r * pr.s * 0.7), '#ffffff', 120 * pw * clear);
    }
    for (const l of extra) {
      const pr = project(l.x, l.y, l.z);
      if (!pr) continue;
      glow(g, pr.x, pr.y, Math.max(3, l.r * pr.s * 4), l.hex, 55 * l.power);
      glow(g, pr.x, pr.y, Math.max(1.6, l.r * pr.s * 1.2), '#ffffff', 95 * l.power);
    }
    g.blendMode(g.BLEND);
  }

  /* ---------------------------- wet reflections --------------------------- */

  // Reflections are rendered into a third-scale buffer and upscaled. Wet
  // asphalt has no sharp detail anyway, so the resampling *is* the blur —
  // and it cuts the fill cost of these very large soft marks by nine.
  const RS = 3;
  let refBuf = null;

  function reflect(g, l, hex, power, t, k) {
    const gp = project(l.x, 0, l.z);
    if (!gp || gp.y < HORIZON) return;
    if (gp.x < -W * 0.3 || gp.x > W * 1.3) return;
    const clear = 1 - fogT(l.z) * 0.6;
    if (power * clear < 0.045) return;
    const end = project(l.x, -l.y * 1.8, l.z);
    const len = Math.min(H, (end ? end.y : H * 2) - gp.y);
    if (len < 8) return;
    const segs = Math.round(clamp(len / 30, 5, 18));
    const rBase = Math.min(l.r, 1.5);
    for (let i = 1; i <= segs; i++) {
      const u = i / segs;
      // Past the mirror point the smear keeps running toward the viewer —
      // that long tail is what makes asphalt read as flooded.
      const pr = project(l.x, -l.y * u * 1.8, l.z);
      if (!pr || pr.y > H + 40) break;
      const rip = noise.noise2D(u * 3.4 + l.z * 0.4, t * 0.6 + l.x * 0.3) * (0.3 + u * 2.2) * pr.s * 0.05;
      const w = Math.min(rBase * pr.s * (1.2 + u * 3.2), W * 0.075);
      const a = power * 175 * Math.pow(1 - u * 0.6, 2.3) * clear;
      glow(g, (pr.x + rip) * k, pr.y * k, w * k, hex, a, 0.45 + u * 0.6);
    }
  }

  function drawReflections(g, t, extra) {
    const k = 1 / RS;
    refBuf.clear();
    refBuf.blendMode(refBuf.ADD);
    for (const l of lights) {
      const pw = lightPower(l, t);
      if (pw > 0.02) reflect(refBuf, l, lightHex(l, t), pw, t, k);
    }
    for (const l of extra) reflect(refBuf, l, l.hex, l.power, t, k);
    refBuf.blendMode(refBuf.BLEND);
   
    g.blendMode(g.ADD);
    g.image(refBuf, 0, 0, W, H);
   
    g.blendMode(g.BLEND);
  }

  /* --------------------------------- rain --------------------------------- */

  const drops = [];
  const RAIN_NEAR = 3.4;
  const RAIN_FAR = 48;
  const dropSpan = (z) => z * 0.66 + 7;

  /** The slab of world actually visible at depth z, with a little margin. */
  function frustum(z) {
    const s = FOCAL / z;
    return { hw: (W * 0.55 + 40) / s, top: EYE + (HORIZON + 60) / s };
  }

  function seedDrop(d, warm) {
    const z = 1 / lerp(1 / RAIN_NEAR, 1 / RAIN_FAR, rng());
    const f = frustum(z);
    d.z = z;
    d.v = 8.4 + storm * 6.2 + rng.range(-1.6, 1.6);
    d.len = rng.range(0.75, 1.4);
    d.a = rng.range(0.5, 1);
    // Enough upwind headroom that the frame stays evenly full once the wind
    // has swept the first population out of it.
    const drift = Math.min(Math.abs(windX) * (f.top / d.v), f.hw * 2);
    d.x = rng.range(-f.hw, f.hw) - Math.sign(windX) * rng() * drift;
    d.y = warm ? rng.range(0, f.top) : f.top;
    d.hw = f.hw + drift + 2;
    return d;
  }

  function initRain() {
    const n = Math.round(900 + storm * 1500);
    for (let i = 0; i < n; i++) drops.push(seedDrop({}, true));
  }

  function updateRain(dt) {
    for (const d of drops) {
      d.y -= d.v * dt;
      d.x += windX * dt;
      d.z += windZ * dt;
      if (d.y <= 0) {
        // The splash is handed the drop's own landing point, so spray is
        // correlated with the rain that caused it.
        if (splashes.length < MAX_SPLASH && d.z < 24 && rng() < 0.2) addSplash(d.x, d.z);
        seedDrop(d, false);
      } else if (d.z < RAIN_NEAR || d.z > RAIN_FAR || Math.abs(d.x) > d.hw) {
        seedDrop(d, false);
      }
    }
  }

  // Screen positions of the few lights strong enough to light passing rain.
  let hotLights = [];
  function updateHotLights(t) {
    hotLights.length = 0;
    for (const l of lights) {
      if ((l.bloom ?? 0) < 1.0) continue;
      const pr = project(l.x, l.y, l.z);
      if (!pr) continue;
      const c = RGB(lightHex(l, t));
      hotLights.push({ x: pr.x, y: pr.y, r: l.r * pr.s * 10 + 45, c, p: lightPower(l, t) });
    }
  }

  const RAIN_COOL = { r: 206, g: 216, b: 220 };

  function drawRain(g, zMin, zMax) {
    const baseA = 34 + storm * 62;
    for (const d of drops) {
      if (d.z < zMin || d.z >= zMax) continue;
      const p0 = project(d.x, d.y, d.z);
      if (!p0) continue;
      if (p0.x < -60 || p0.x > W + 60 || p0.y > H + 40) continue;
      const ex = 0.014 * d.len;
      const p1 = project(d.x - windX * ex, d.y + d.v * ex, d.z);
      if (!p1) continue;
      let a = baseA * d.a * (1 - fogT(d.z) * 0.92);
      let cr = RAIN_COOL.r;
      let cg = RAIN_COOL.g;
      let cb = RAIN_COOL.b;
      for (const hl of hotLights) {
        const dx = p0.x - hl.x;
        const dy = p0.y - hl.y;
        const dd = dx * dx + dy * dy;
        const rr = hl.r * hl.r;
        if (dd > rr) continue;
        const k = (1 - dd / rr) * hl.p;
        a += 46 * k;
        cr = lerp(cr, hl.c.r, k * 0.45);
        cg = lerp(cg, hl.c.g, k * 0.45);
        cb = lerp(cb, hl.c.b, k * 0.45);
      }
      g.stroke(cr, cg, cb, Math.min(190, a));
      g.strokeWeight(clamp(0.0045 * p0.s, 0.4, 2.2));
      g.line(p1.x, p1.y, p0.x, p0.y);
    }
  }

  /* ------------------------------- splashes ------------------------------- */

  const splashes = [];
  const MAX_SPLASH = 1100;

  function addSplash(x, z) {
    splashes.push({
      x,
      z,
      age: 0,
      life: rng.range(0.22, 0.42),
      // Heavy tail: a few big crowns, a great many almost invisible ones.
      r: (0.03 + rng.skew(2.6) * 0.19) * (0.7 + storm * 0.6),
      crown: rng.int(2, 5),
      cs: rng.range(0.35, 0.85)
    });
  }

  function updateSplashes(dt) {
    for (let i = splashes.length - 1; i >= 0; i--) {
      splashes[i].age += dt;
      if (splashes[i].age >= splashes[i].life) splashes.splice(i, 1);
    }
  }

  function drawSplashes(g, zMin, zMax) {
    g.blendMode(g.ADD);
    g.noFill();
    for (const s of splashes) {
      if (s.z < zMin || s.z >= zMax) continue;
      const pr = project(s.x, 0, s.z);
      if (!pr || pr.y > H + 30 || pr.x < -40 || pr.x > W + 40) continue;
      const u = s.age / s.life;
      const squash = EYE / s.z;
      const clear = 1 - fogT(s.z) * 0.85;
      const rr = s.r * (0.25 + u * 1.5) * pr.s;

      // The collapsing crown, as soft droplets rather than strokes. Drawn as
      // lines they read as tally marks; drawn as specks they read as water.
      if (u < 0.8) {
        const rise = u * 3.2 * (1 - u * 1.1);
        for (let k = 0; k < s.crown; k++) {
          const ang = (k / s.crown) * TAU + s.cs * 6;
          const spread = s.r * (0.5 + u * 1.9);
          const pp = project(
            s.x + Math.cos(ang) * spread,
            Math.max(0, s.cs * 0.4 * rise),
            s.z + Math.sin(ang) * spread * 0.5
          );
          if (pp) glow(g, pp.x, pp.y, Math.max(0.9, pr.s * 0.016), '#e8f4f6', 150 * (1 - u) * clear);
        }
      }
      // A ring only survives within a few metres; past that it is a lie.
      if (rr > 9) {
        g.stroke(226, 238, 240, 42 * (1 - u) * (1 - u) * clear);
        g.strokeWeight(clamp(pr.s * 0.004, 0.5, 1.4));
        g.ellipse(pr.x, pr.y, rr * 2, rr * 2 * squash);
      }
      if (u < 0.35) {
        glow(g, pr.x, pr.y, Math.max(1.4, s.r * pr.s * 2.4), '#dcecf0', 130 * (1 - u / 0.35) * clear, squash * 1.8);
      }
    }
    g.blendMode(g.BLEND);
    g.noStroke();
  }

  /** The low band of atomised water standing over the road in a downpour. */
  function drawSpray(g, t, zMin, zMax) {
    g.blendMode(g.ADD);
    const n = Math.round((260 + storm * 620) * (zMax > 12 ? 1 : 0.7));
    for (let i = 0; i < n; i++) {
      const z = zMin + rng.skew(1.9) * (zMax - zMin);
      const span = dropSpan(z);
      const x = rng.range(-span, span);
      const y = rng.skew(2.2) * 0.34 * (0.6 + storm);
      const pr = project(x, y, z);
      if (!pr || pr.y > H + 20 || pr.x < -20 || pr.x > W + 20) continue;
      const clear = 1 - fogT(z) * 0.9;
      g.stroke(214, 228, 232, (13 + storm * 24) * clear * (1 - y / 0.4));
      g.strokeWeight(clamp(pr.s * 0.005, 0.4, 1.8));
      g.line(pr.x, pr.y, pr.x, pr.y - pr.s * 0.02);
    }
    g.blendMode(g.BLEND);
    g.noStroke();

    // Ground fog drifting downwind, thickest where the lamps light it.
    g.blendMode(g.ADD);
    for (let i = 0; i < 26; i++) {
      const z = 6 + ((i * 3.1 + t * (0.5 + storm)) % 34);
      const nx = noise.noise2D(i * 1.7, t * 0.12);
      const x = nx * 16 + windX * 0.4;
      const pr = project(x, 0.8, z);
      if (!pr) continue;
      const lit = lampGlare ? clamp(1 - Math.abs(x - lampGlare.x) / 16) : 0.3;
      glow(g, pr.x, pr.y, Math.min(pr.s * 3.4, W * 0.2), lit > 0.6 ? P.fogWarm : '#aeb6b8', (4 + lit * 6) * (1 - fogT(z) * 0.7), 0.42);
    }
    g.blendMode(g.BLEND);
  }

  /* -------------------------------- people -------------------------------- */

  // Muted city clothing with two saturated notes, because a crowd is mostly
  // greys and the eye needs somewhere to land.
  const GARMENTS = ['#b23a2e', '#2f4a6b', '#38443f', '#5f666b', '#262b2f', '#7a5a3e',
    '#26543f', '#8b9094', '#c3c7c5', '#46345a', '#1f3340', '#a8452e'];
  const GWEIGHTS = [3, 3, 3, 4, 5, 2, 2, 3, 2, 2, 3, 2];
  const DARKS = ['#1a1e21', '#242a2f', '#2f3338', '#14181b', '#3a3f42'];
  const SKINS = ['#8d6a52', '#c39a78', '#6b4c3a', '#a87f61', '#dcb595'];
  const UMBRELLAS = ['#191d20', '#22303a', '#2b2430', '#3a3f3c', '#5a4a3c'];

  const peds = [];

  function dressPed(pd) {
    pd.h = rng.range(1.6, 1.87);
    pd.shirt = rng.weighted(GARMENTS, GWEIGHTS);
    pd.pants = rng.pick(DARKS);
    pd.skin = rng.pick(SKINS);
    pd.hair = rng.pick(['#141618', '#2b211a', '#4a3a2c', '#6b6560']);
    pd.cadence = rng.range(4.4, 6.2);
    pd.phase = rng.range(0, TAU);
    pd.umb = rng.chance(0.5) ? { r: rng.range(0.36, 0.5), hex: rng.pick(UMBRELLAS) } : null;
    pd.bag = !pd.umb && rng.chance(0.45);
    return pd;
  }

  function placePed(pd, first) {
    const l = pd.lane;
    if (l === 'anchor') {
      // One large figure crossing slowly, seeded off-centre so it never
      // parks on the mast, and re-entering the moment it leaves.
      const dir = pd.dir ?? (rng.chance(0.5) ? 1 : -1);
      pd.dir = -dir;
      pd.z = rng.range(5.0, 6.6);
      const hw = (W * 0.5) / (FOCAL / pd.z);
      pd.x = first ? (rng.chance(0.5) ? -1 : 1) * rng.range(hw * 0.34, hw * 0.92) : dir > 0 ? -hw - 0.6 : hw + 0.6;
      pd.vx = dir * rng.range(0.4, 0.7);
      pd.vz = rng.jitter(0.05);
      pd.face = dir;
      pd.hw = hw + 1.0;
    } else if (l === 'edge') {
      // Walks in toward the lens close to a frame edge, so it grows and slides
      // out of shot half-cropped rather than parading through the middle.
      pd.x = (rng.chance(0.5) ? -1 : 1) * rng.range(1.7, 2.7);
      pd.z = first ? rng.range(3.6, 9) : rng.range(8.5, 10.5);
      pd.vx = rng.jitter(0.05);
      pd.vz = -rng.range(0.5, 0.85);
      pd.face = 0;
    } else if (l === 'near') {
      // Walking out of the frame toward the lens: the biggest silhouettes,
      // and the reason the foreground never reads as empty.
      pd.x = rng.range(-3.2, 3.0);
      pd.z = first ? rng.range(4.2, 17) : rng.range(15, 20);
      pd.vx = rng.jitter(0.12);
      pd.vz = -rng.range(0.85, 1.35);
      pd.face = 0;
    } else if (l === 'cross') {
      const dir = rng.chance(0.5) ? 1 : -1;
      pd.z = rng.range(9, 13);
      pd.x = first ? rng.range(-11, 6) : dir > 0 ? -12 : 7;
      pd.vx = dir * rng.range(1.0, 1.6);
      pd.vz = rng.jitter(0.06);
      pd.face = dir;
    } else if (l === 'walk') {
      pd.x = rng.range(CURB_X + 0.4, CURB_X + 1.9);
      pd.z = first ? rng.range(11, 40) : rng.chance(0.5) ? 11 : 42;
      pd.vz = pd.z > 30 ? -rng.range(0.9, 1.4) : rng.range(0.9, 1.4);
      pd.vx = rng.jitter(0.08);
      pd.face = 0;
    } else {
      const dir = rng.chance(0.5) ? 1 : -1;
      pd.z = rng.range(20, 46);
      pd.x = first ? rng.range(-18, 4) : dir > 0 ? -20 : 6;
      pd.vx = dir * rng.range(0.9, 1.5);
      pd.vz = rng.jitter(0.05);
      pd.face = dir;
    }
    return pd;
  }

  function initPeds() {
    const plan = [['anchor', 1], ['edge', 2], ['cross', 5], ['walk', 5], ['far', 6]];
    for (const [lane, n] of plan) {
      for (let i = 0; i < n; i++) peds.push(dressPed(placePed({ lane }, true)));
    }
  }

  function updatePeds(dt) {
    for (const pd of peds) {
      pd.x += pd.vx * dt;
      pd.z += pd.vz * dt;
      const gone =
        (pd.lane === 'anchor' && Math.abs(pd.x) > pd.hw) ||
        (pd.lane === 'edge' && pd.z < 3.4) ||
        (pd.lane === 'near' && pd.z < 3.9) ||
        (pd.lane === 'cross' && (pd.x < -13 || pd.x > 8)) ||
        (pd.lane === 'walk' && (pd.z < 10 || pd.z > 44)) ||
        (pd.lane === 'far' && (pd.x < -22 || pd.x > 8));
      if (gone) dressPed(placePed(pd, false));
    }
  }

  function drawPersonReflection(g, pd, t) {
    const pr = project(pd.x, 0, pd.z);
    if (!pr || pr.y < HORIZON) return;
    const hpx = pd.h * pr.s;
    if (hpx < 14) return;
    g.noStroke();
    for (let i = 1; i <= 11; i++) {
      const u = i / 11;
      const pp = project(pd.x, -pd.h * u * 1.25, pd.z);
      if (!pp || pp.y > H + 30) break;
      const rip = noise.noise2D(u * 3 + pd.x * 0.7, t * 0.7 + pd.z * 0.3) * u * hpx * 0.055;
      const c = fogged(u < 0.42 ? pd.pants : pd.shirt, pd.z);
      setFill(g, c, 96 * Math.pow(1 - u, 1.4));
      g.ellipse(pr.x + rip, pp.y, hpx * 0.26 * (1 - u * 0.2), hpx * 0.1);
    }
  }

  function drawPerson(g, pd, t) {
    const pr = project(pd.x, 0, pd.z);
    if (!pr) return;
    const s = pr.s;
    const hpx = pd.h * s;
    if (hpx < 5 || pr.x < -180 || pr.x > W + 180) return;

    const k = pd.z < 8 ? 0.5 : pd.z < 16 ? 0.68 : 0.86;
    const shirt = fogged(shade(pd.shirt, k), pd.z);
    const dark = fogged(shade(pd.pants, k + 0.12), pd.z);
    const skin = fogged(shade(pd.skin, k * 0.7), pd.z);
    const ph = pd.phase + t * pd.cadence;
    const sw = Math.sin(ph);
    const bob = Math.abs(Math.cos(ph)) * hpx * 0.013;
    const fx = pr.x;
    const fy = pr.y - bob;
    // Canonical proportions: head about an eighth of standing height, shoulders
    // at four fifths, hips just under a half. Getting these wrong is what made
    // the first pass read as lollipops rather than people.
    const hip = fy - hpx * 0.47;
    const sho = fy - hpx * 0.815;
    const neck = fy - hpx * 0.845;
    const headY = fy - hpx * 0.925;
    const headR = hpx * 0.062;
    // Everyone leans into the wind by the same field, which is what makes a
    // crowd read as being in one storm rather than as separate figures.
    const lean = -Math.sign(windX) * hpx * 0.03 * (0.4 + storm * 0.8);
    const stride = hpx * (pd.face === 0 ? 0.055 : 0.115);
    const shW = hpx * 0.105;
    const hipW = hpx * 0.072;

    g.strokeCap(p.ROUND);
    setStroke(g, dark, 250);
    g.strokeWeight(hpx * 0.072);
    const off = pd.face === 0 ? hpx * 0.032 : 0;
    // A minimum stance so the legs never merge into a single column at the
    // moment the gait phase crosses zero.
    const stance = hpx * 0.028;
    const footA = fx - off + sw * stride - stance;
    const footB = fx + off - sw * stride + stance;
    g.line(fx - off, hip, footA, fy + bob);
    g.line(fx + off, hip, footB, fy + bob * 0.5);
    g.noStroke();
    setFill(g, dark, 250);
    g.ellipse(footA - hpx * 0.012, fy + bob, hpx * 0.075, hpx * 0.026);
    g.ellipse(footB + hpx * 0.012, fy + bob * 0.5, hpx * 0.075, hpx * 0.026);
    g.strokeCap(p.ROUND);

    g.noStroke();
    setFill(g, shirt, 252);
    g.beginShape();
    g.curveVertex(fx - shW * 0.55 + lean, sho - hpx * 0.02);
    g.curveVertex(fx - shW * 0.55 + lean, sho - hpx * 0.02);
    g.curveVertex(fx + shW * 0.55 + lean, sho - hpx * 0.02);
    g.curveVertex(fx + shW + lean, sho + hpx * 0.045);
    g.curveVertex(fx + hipW * 1.06, hip + hpx * 0.04);
    g.curveVertex(fx - hipW * 1.06, hip + hpx * 0.04);
    g.curveVertex(fx - shW + lean, sho + hpx * 0.045);
    g.curveVertex(fx - shW * 0.55 + lean, sho - hpx * 0.02);
    g.curveVertex(fx - shW * 0.55 + lean, sho - hpx * 0.02);
    g.endShape(p.CLOSE);
    setStroke(g, shirt, 252);
    g.strokeWeight(hpx * 0.028);
    g.line(fx - shW * 0.82 + lean, sho - hpx * 0.01, fx + shW * 0.82 + lean, sho - hpx * 0.01);
    // Collar and hem: two small value breaks stop the coat reading as a slab.
    setStroke(g, fogged(shade(pd.shirt, k * 0.72), pd.z), 220);
    g.strokeWeight(hpx * 0.02);
    g.line(fx - shW * 0.55 + lean, sho + hpx * 0.005, fx + shW * 0.55 + lean, sho + hpx * 0.005);
    g.line(fx - hipW * 0.8, hip + hpx * 0.028, fx + hipW * 0.8, hip + hpx * 0.028);

    g.strokeWeight(hpx * 0.042);
    g.line(fx - shW * 0.74 + lean, sho + hpx * 0.02, fx - shW * 0.66 - sw * stride * 0.2, hip + hpx * 0.09);
    if (!pd.umb) {
      g.line(fx + shW * 0.74 + lean, sho + hpx * 0.02, fx + shW * 0.66 + sw * stride * 0.2, hip + hpx * 0.09);
    }

    // Neck, then head. A head that floats above the shoulders is the single
    // fastest way to make a figure look like a sticker.
    setStroke(g, skin, 250);
    g.strokeWeight(hpx * 0.036);
    g.line(fx + lean * 1.2, neck + hpx * 0.02, fx + lean * 1.5, headY + headR * 0.7);
    g.noStroke();
    setFill(g, skin, 252);
    g.ellipse(fx + lean * 1.5, headY, headR * 1.75, headR * 2.05);
    setFill(g, fogged(shade(pd.hair, k), pd.z), 252);
    g.arc(fx + lean * 1.5, headY + headR * 0.1, headR * 1.85, headR * 2.0, p.PI + 0.15, TAU - 0.15);

    if (pd.bag) {
      setFill(g, fogged(shade('#4a4237', k), pd.z), 245);
      g.ellipse(fx - shW * 0.98, hip + hpx * 0.005, hpx * 0.07, hpx * 0.095);
    }

    if (pd.umb) {
      const ur = pd.umb.r * s;
      const uy = headY - hpx * 0.1;
      const uc = fogged(pd.umb.hex, pd.z);
      setStroke(g, dark, 235);
      g.strokeWeight(Math.max(0.6, hpx * 0.014));
      g.line(fx + lean * 1.6, uy, fx + shW * 0.6, sho + hpx * 0.14);
      // Forearm up to the handle, so the umbrella is held rather than balanced.
      setStroke(g, shirt, 245);
      g.strokeWeight(hpx * 0.04);
      g.line(fx + shW * 0.72 + lean, sho + hpx * 0.03, fx + shW * 0.6, sho + hpx * 0.13);
      g.noStroke();
      setFill(g, skin, 250);
      g.ellipse(fx + shW * 0.6, sho + hpx * 0.14, hpx * 0.022, hpx * 0.026);
      g.noStroke();
      setFill(g, uc, 250);
      g.arc(fx + lean * 1.6, uy, ur * 2, ur * 0.95, p.PI, TAU, p.CHORD);
      // Wet canopies catch the sky along the top edge.
      setStroke(g, fogged('#aeb6b6', pd.z), 150);
      g.strokeWeight(Math.max(0.5, hpx * 0.012));
      g.noFill();
      g.arc(fx + lean * 1.6, uy, ur * 2, ur * 0.95, p.PI + 0.22, TAU - 0.22);
      // Runoff off the rim.
      if (hpx > 40) {
        g.stroke(206, 218, 220, 90);
        g.strokeWeight(Math.max(0.5, hpx * 0.008));
        for (let k = -1; k <= 1; k += 2) {
          g.line(fx + lean * 1.6 + k * ur, uy, fx + lean * 1.6 + k * ur * 1.05, uy + hpx * 0.22);
        }
      }
      g.noStroke();
    }
  }

  /* ------------------------------- traffic -------------------------------- */

  const VEHICLES = {
    car: { bw: 1.8, bh: 0.78, bl: 4.3, ch: 0.62, cl: 2.3, coff: -0.1 },
    van: { bw: 2.0, bh: 1.1, bl: 5.0, ch: 1.05, cl: 3.4, coff: 0.2 },
    truck: { bw: 2.35, bh: 1.5, bl: 7.2, ch: 1.5, cl: 5.4, coff: 0.6 }
  };
  const CAR_HUES = ['#22282c', '#33393e', '#15191c', '#4a5054', '#5e2620', '#1e3247', '#7c8185'];
  const CAR_W = [4, 3, 4, 2, 2, 2, 2];

  const vehicles = [];
  let nextSpawn = 2.5;

  function makeVehicle(o) {
    const kind = o.kind ?? rng.weighted(['car', 'van', 'truck'], [7, 3, 1.6]);
    return {
      kind,
      axis: o.axis,
      x: o.x,
      z: o.z,
      dir: o.dir,
      speed: o.speed,
      hex: o.hex ?? rng.weighted(CAR_HUES, CAR_W),
      brake: o.brake ?? false,
      wrap: o.wrap ?? false,
      bike: false
    };
  }

  function initTraffic() {
    // A slow queue crawling away up the avenue, brake lights on. This is the
    // reference's real subject: a receding line of red.
    const lane = rng.range(-9, -5.5);
    const n = rng.int(3, 4);
    let z = rng.range(21, 26);
    for (let i = 0; i < n; i++) {
      vehicles.push(makeVehicle({
        axis: 'z',
        x: lane + rng.jitter(0.55),
        z,
        dir: 1,
        speed: rng.range(0.35, 0.9),
        brake: true,
        wrap: true,
        // One yellow cab: the single warm mass in the middle distance.
        hex: i === rng.int(0, n - 1) ? P.taxi : undefined,
        kind: i === 0 && rng.chance(0.3) ? 'truck' : undefined
      }));
      z += rng.range(5.5, 8.5);
    }
  }

  function updateTraffic(dt, t) {
    nextSpawn -= dt;
    if (nextSpawn <= 0) {
      nextSpawn = rng.range(5, 13);
      const roll = rng();
      if (roll < 0.34) {
        // Cross traffic on the side street.
        const dir = rng.chance(0.5) ? 1 : -1;
        vehicles.push(makeVehicle({ axis: 'x', x: dir > 0 ? -24 : 20, z: rng.range(26, 36), dir, speed: rng.range(4.5, 8) }));
      } else if (roll < 0.62) {
        // Something coming toward the lens, headlights first.
        vehicles.push(makeVehicle({ axis: 'z', x: rng.range(0.5, 3.2), z: 46, dir: -1, speed: rng.range(4, 7.5) }));
      } else if (roll < 0.82) {
        const v = makeVehicle({ axis: 'z', x: rng.range(-11, -7), z: 5, dir: 1, speed: rng.range(4, 7) });
        vehicles.push(v);
      } else {
        // A cyclist, hunched, one red eye behind.
        const dir = rng.chance(0.5) ? 1 : -1;
        const v = makeVehicle({ axis: 'x', x: dir > 0 ? -18 : 16, z: rng.range(13, 18), dir, speed: rng.range(3.4, 5.2) });
        v.bike = true;
        v.rider = dressPed({ lane: 'bike' });
        vehicles.push(v);
      }
    }

    for (let i = vehicles.length - 1; i >= 0; i--) {
      const v = vehicles[i];
      if (v.axis === 'z') v.z += v.dir * v.speed * dt;
      else v.x += v.dir * v.speed * dt;
      if (v.wrap) {
        if (v.z > 52) v.z = rng.range(19, 23);
        continue;
      }
      if (v.z > 54 || v.z < 4.2 || v.x < -30 || v.x > 26) vehicles.splice(i, 1);
    }
  }

  function boxFaces(g, cx, cy, cz, hx, hy, hz, base, z, alphaTop = 255) {
    // Top first, then the visible side, then the near face: painter order for
    // an axis-aligned box seen from in front and slightly above.
    if (cy + hy < EYE) {
      quad3(g, V(cx - hx, cy + hy, cz - hz), V(cx + hx, cy + hy, cz - hz), V(cx + hx, cy + hy, cz + hz),
        V(cx - hx, cy + hy, cz + hz), fogged(base.top, z), alphaTop);
    }
    if (cx - hx > 0.15) {
      quad3(g, V(cx - hx, cy - hy, cz - hz), V(cx - hx, cy - hy, cz + hz), V(cx - hx, cy + hy, cz + hz),
        V(cx - hx, cy + hy, cz - hz), fogged(base.side, z), 252);
    } else if (cx + hx < -0.15) {
      quad3(g, V(cx + hx, cy - hy, cz - hz), V(cx + hx, cy - hy, cz + hz), V(cx + hx, cy + hy, cz + hz),
        V(cx + hx, cy + hy, cz - hz), fogged(base.side, z), 252);
    }
    quad3(g, V(cx - hx, cy - hy, cz - hz), V(cx + hx, cy - hy, cz - hz), V(cx + hx, cy + hy, cz - hz),
      V(cx - hx, cy + hy, cz - hz), fogged(base.front, z), 254);
  }

  const shadeRGB = (hex, k) => {
    const c = RGB(hex);
    return { r: c.r * k, g: c.g * k, b: c.b * k };
  };

  const shadeCache = new Map();
  /** Same hue, scaled value — a wet roof reflecting sky is the same paint. */
  function shade(hex, k) {
    const key = hex + k;
    let v = shadeCache.get(key);
    if (!v) {
      const c = RGB(hex);
      v = rgbToHex({ r: c.r * k, g: c.g * k, b: c.b * k });
      shadeCache.set(key, v);
    }
    return v;
  }

  function vehicleLights(v, out) {
    const d = VEHICLES[v.kind];
    const along = v.axis === 'z' ? 'z' : 'x';
    const half = d.bl * 0.5;
    const rear = along === 'z' ? { x: v.x, z: v.z - v.dir * half } : { x: v.x - v.dir * half, z: v.z };
    const front = along === 'z' ? { x: v.x, z: v.z + v.dir * half } : { x: v.x + v.dir * half, z: v.z };
    const spread = along === 'z' ? d.bw * 0.38 : 0;
    const zspread = along === 'z' ? 0 : d.bw * 0.34;
    const power = v.brake ? 1.45 : 0.75;
    for (const k of [-1, 1]) {
      out.push({ x: rear.x + k * spread, y: 0.62, z: rear.z + k * zspread, hex: P.brake, r: 0.17, power, tag: 'tail' });
      out.push({ x: front.x + k * spread, y: 0.62, z: front.z + k * zspread, hex: '#fff0cc', r: 0.14, power: 0.75, tag: 'head', front: true });
    }
  }

  function drawVehicle(g, v, t) {
    if (v.bike) return drawBike(g, v, t);
    const d = VEHICLES[v.kind];
    const along = v.axis === 'z';
    const hx = along ? d.bw * 0.5 : d.bl * 0.5;
    const hz = along ? d.bl * 0.5 : d.bw * 0.5;
    const base = { front: shade(v.hex, 0.5), side: shade(v.hex, 0.72), top: shade(v.hex, 0.98) };
    // Contact shadow first: without it the box floats above the road.
    const gp = project(v.x, 0.01, v.z);
    if (gp) {
      g.noStroke();
      setFill(g, fogged('#0d1113', v.z), 130);
      g.ellipse(gp.x, gp.y, hx * 2.6 * gp.s, hz * 1.3 * gp.s * (EYE / v.z));
    }
    // Wheels under the body, never over it.
    setFill(g, fogged('#101416', v.z), 250);
    for (const sgn of [-0.62, 0.62]) {
      const wp = along
        ? project(v.x + (v.x > 0 ? -hx : hx), 0.28, v.z + sgn * hz)
        : project(v.x + sgn * hx, 0.28, v.z + (v.z > 0 ? -hz : hz));
      if (wp) g.ellipse(wp.x, wp.y, 0.56 * wp.s, 0.56 * wp.s * 0.85);
    }

    boxFaces(g, v.x, d.bh * 0.5, v.z, hx, d.bh * 0.5, hz, base, v.z);
    const chx = along ? d.bw * 0.43 : d.cl * 0.5;
    const chz = along ? d.cl * 0.5 : d.bw * 0.43;
    const glass = { front: '#141a1e', side: '#1b2226', top: shade(v.hex, 0.9) };
    boxFaces(g, v.x + (along ? 0 : d.coff * v.dir), d.bh + d.ch * 0.5, v.z + (along ? d.coff * v.dir : 0),
      chx, d.ch * 0.5, chz, glass, v.z);
    // Wet glass catches the pale sky along its upper half.
    quad3(g, V(v.x - chx * 0.82, d.bh + d.ch * 0.5, v.z - chz), V(v.x + chx * 0.82, d.bh + d.ch * 0.5, v.z - chz),
      V(v.x + chx * 0.82, d.bh + d.ch * 0.92, v.z - chz), V(v.x - chx * 0.82, d.bh + d.ch * 0.92, v.z - chz),
      fogged('#8f989a', v.z), 90);

    // Wheel spray: the plume a vehicle drags through standing water.
    g.blendMode(g.ADD);
    const plume = Math.round(6 + v.speed * 4);
    for (let i = 0; i < plume; i++) {
      const back = rng() * (v.speed * 0.35 + 0.4);
      const px = along ? v.x + rng.jitter(d.bw * 0.6) : v.x - v.dir * (hx + back);
      const pz = along ? v.z - v.dir * (hz + back) : v.z + rng.jitter(d.bw * 0.6);
      const pr = project(px, rng.skew(2) * 0.7, pz);
      if (!pr) continue;
      glow(g, pr.x, pr.y, rng.range(0.15, 0.5) * pr.s, '#c8d6d8', 26 * (1 - fogT(pz) * 0.8), 0.7);
    }
    g.blendMode(g.BLEND);
  }

  function drawBike(g, v, t) {
    const pr = project(v.x, 0, v.z);
    if (!pr) return;
    const s = pr.s;
    g.noFill();
    setStroke(g, fogged('#1a1f22', v.z), 235);
    g.strokeWeight(Math.max(0.7, 0.05 * s));
    for (const k of [-0.55, 0.55]) {
      const w = project(v.x + k * v.dir, 0.34, v.z);
      if (w) g.ellipse(w.x, w.y, 0.68 * s, 0.68 * s);
    }
    g.noStroke();

    // The rider is an ordinary figure lifted onto the saddle and pedalling.
    const rider = v.rider;
    rider.x = v.x - v.dir * 0.05;
    rider.z = v.z;
    rider.h = 1.35;
    rider.phase = t * 9;
    rider.cadence = 0;
    rider.face = v.dir;
    g.push();
    g.translate(0, -0.55 * s);
    drawPerson(g, rider, t);
    g.pop();
  }

  /* ------------------------------ atmosphere ------------------------------ */

  // Depth veil, vignette and film grain are all static, so they are composited
  // into one image at build time and laid down in a single pass. On a
  // software rasteriser every extra full-frame pass costs more than every
  // raindrop in the piece put together.
  let overlay = null;

  function paintOverlay() {
    const g = p.createGraphics(W, H);
    g.pixelDensity(1);
    g.loadPixels();
    const veilStrength = 0.1 + storm * 0.1;
    const px = g.pixels;
    for (let y = 0; y < H; y++) {
      const z = y < HORIZON ? 60 : groundZ(y + 0.5);
      // Rain between the lens and the city, not a filter over the picture.
      const aVeil = clamp(fogT(Math.min(z, 90)) * veilStrength) * (y < HORIZON ? 0.5 : 0.85);
      const fy = Math.min(y / (H * 0.055), (H - y) / (H * 0.1), 1);
      for (let x = 0; x < W; x++) {
        const fx = Math.min(x / (W * 0.05), (W - x) / (W * 0.05), 1);
        const aVig = (1 - Math.min(fx, fy)) * 0.34;
        // over-composite veil, then vignette, then a grain speck
        let a = aVeil;
        let cr = FOG.r * a;
        let cg = FOG.g * a;
        let cb = FOG.b * a;
        if (aVig > 0.001) {
          cr = 18 * aVig + cr * (1 - aVig);
          cg = 21 * aVig + cg * (1 - aVig);
          cb = 23 * aVig + cb * (1 - aVig);
          a = aVig + a * (1 - aVig);
        }
        const r = rng();
        if (r < 0.34) {
          const ga = (rng() * 22 + 4) / 255;
          const v = r < 0.17 ? 255 : 0;
          cr = v * ga + cr * (1 - ga);
          cg = v * ga + cg * (1 - ga);
          cb = v * ga + cb * (1 - ga);
          a = ga + a * (1 - ga);
        }
        const i = (y * W + x) * 4;
        px[i] = a > 0 ? cr / a : 0;
        px[i + 1] = a > 0 ? cg / a : 0;
        px[i + 2] = a > 0 ? cb / a : 0;
        px[i + 3] = a * 255;
      }
    }
    g.updatePixels();
    overlay = g;
  }

  /* --------------------------------- loop --------------------------------- */

  let mastPlate = null;
  let MB = { x: 0, y: 0, w: 0, h: 0 };

  p.setup = () => {
    p.createCanvas(W, H);
    makeLayout();
    paintPlate();
    refBuf = p.createGraphics(Math.ceil(W / RS), Math.ceil(H / RS));
    refBuf.pixelDensity(1);
    refBuf.noStroke();
    mastPlate = p.createGraphics(W, H);
    mastPlate.pixelDensity(1);
    mastPlate.noStroke();
    paintMast(mastPlate);
    // The mast is a narrow vertical strip; blitting the whole frame to put it
    // back on top would cost another full pass for a few percent of the pixels.
    const ms = FOCAL / MAST.z;
    MB = {
      x: Math.max(0, Math.floor(VPX + (MAST.x - 1.75) * ms)),
      y: 0,
      w: 0,
      h: Math.min(H, Math.ceil(HORIZON + EYE * ms) + 6)
    };
    MB.w = Math.min(W - MB.x, Math.ceil(VPX + (MAST.x + 0.85) * ms) - MB.x);
    paintOverlay();
    initRain();
    initPeds();
    initTraffic();
  };

  const DT = 1 / 60;
  const frameLights = [];

  p.draw = () => {
    const t = p.frameCount * DT;

    updateRain(DT);
    updateSplashes(DT);
    updatePeds(DT);
    updateTraffic(DT, t);
    updateHotLights(t);

    frameLights.length = 0;
    for (const v of vehicles) if (!v.bike) vehicleLights(v, frameLights);

    p.image(plate, 0, 0);

    drawReflections(p, t, frameLights);
    drawSpray(p, t, 12, 44);

    // Far half: traffic and the far pavement, depth-sorted, then the mast
    // put back on top so nothing crossing behind it paints over it.
    const far = [];
    for (const v of vehicles) far.push({ z: v.z, kind: 'v', o: v });
    for (const pd of peds) if (pd.z > 9) far.push({ z: pd.z, kind: 'p', o: pd });
    far.sort((a, b) => b.z - a.z);
    for (const a of far) {
      if (a.kind === 'v') {
        drawVehicle(p, a.o, t);
      } else {
        drawPersonReflection(p, a.o, t);
        drawPerson(p, a.o, t);
      }
    }
   
    p.image(mastPlate, MB.x, MB.y, MB.w, MB.h, MB.x, MB.y, MB.w, MB.h);
    drawSignalLenses(p, t);
    drawBlooms(p, t, frameLights);

    drawRain(p, 9, RAIN_FAR);
    drawSplashes(p, 7, 60);

    const near = peds.filter((pd) => pd.z <= 9).sort((a, b) => b.z - a.z);
    for (const pd of near) {
      drawPersonReflection(p, pd, t);
      drawPerson(p, pd, t);
    }

    drawSplashes(p, 0, 7);
    drawSpray(p, t, 4.2, 12);
    drawRain(p, 0, 9);

    p.image(overlay, 0, 0);
  };

  if (ctx.pane) {
    const params = { storm, fog: fogDensity, cycle: CYCLE };
    ctx.pane.addBinding(params, 'storm', { min: 0.3, max: 1, step: 0.01 });
    ctx.pane.addBinding(params, 'fog', { min: 0.008, max: 0.07, step: 0.001 });
  }
}

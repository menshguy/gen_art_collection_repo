/**
 * Through the Skylight
 *
 * A Vermont hillside in foliage season, seen from inside a house through a
 * forward-slanted skylight in the rain. Four systems carry the image:
 *
 *   1. one fog field. Every colour in the scene is mixed toward a storm grey
 *      by the depth of the band it belongs to, so distance is a loss of
 *      contrast and chroma rather than a change of subject. Past the mid
 *      slope the forest is a value, not a shape;
 *   2. a depth-banded forest. Far slopes are canopy *masses* — a silhouette
 *      from an fbm ridge, filled, then stippled — while the near bands are
 *      real trees: a trunk, a recursive branch skeleton, and foliage clustered
 *      on the branch tips. A single noise field over x picks each tree's
 *      colour family, so rust, gold and spruce clump into stands the way a
 *      real hillside does instead of alternating per tree;
 *   3. a glass surface running on a wetness field. Every rivulet *erases* a
 *      channel through the condensation, eats the beads it passes, and sheds
 *      what its tail cannot carry as beads of its own. It also writes into a
 *      coarse map of where water has already been and steers up that map's
 *      gradient — so heads fall into channels other water has already made,
 *      coalesce when they touch, run faster and further on wet glass than on
 *      dry, and the pane sorts itself into a few trunk routes with tributaries
 *      and long dry stretches between them. What you see sharply is what the
 *      water has cleared;
 *   4. one gust field, mostly at rest. Each band is a damped oscillator hung
 *      off it, tuned lower the nearer and heavier it is, so a band lags the
 *      gust, leans while it holds and rocks back when it drops. Bands are
 *      blitted in horizontal strips whose offset grows toward the top, so
 *      trees bend rather than slide.
 *
 * The composition is fixed: a large pale void in the upper half with one warm
 * leaf in it, a dense band of forest below, a dark frame cropping the bottom
 * left. The seed moves the weather, the hillside, the colour of each stand,
 * the trees and the water. It does not move that arrangement.
 */

import { createRandom } from '../../shared/random.js';
import { mixHex, withAlpha, hexToRgb, rgbToHex } from '../../shared/palettes.js';
import { clamp, lerp, smoothstep, smootherstep, map, TAU } from '../../shared/math.js';

export default function sketch(p, ctx) {
  const W = ctx.width;
  const H = ctx.height;
  const noise = ctx.noise;
  let rng = createRandom(ctx.seed);

  /* --------------------------- composition ---------------------------- */

  // The window leans away from the viewer, so the sill is not level: it lifts
  // to the right. Everything below it is house, everything above is glass.
  const SILL_L = H * 0.878;
  const SILL_R = H * 0.845;
  const sillY = (x) => lerp(SILL_L, SILL_R, x / W);

  // The far ridge. Above this line there is nothing but weather — that void is
  // the composition, and it is deliberately more than half the frame.
  const RIDGE = H * 0.545;

  /* ----------------------------- palette ------------------------------ */

  const C = {
    skyTop: '#b9bec0',
    skyMid: '#c6cac8',
    skyLow: '#cfd0cb',
    fogFar: '#c9ccc8',
    fogWarm: '#cdc8bc',
    mist: '#e7e8e3',
    mistCool: '#dee1de',
    beadDark: '#9ba19f',
    beadHi: '#fbfcf9',
    waterHi: '#f6f8f4',
    waterDk: '#8f9694',
    trunk: '#4c4136',
    trunkDk: '#2a231c',
    wood: '#2a2019',
    woodMid: '#4a3728',
    woodHi: '#6b4f39',
    sill: '#adaea8',
    sillHi: '#d8dad5',
    sillDk: '#6f716c',
    leaf: '#c8942f',
    leafDk: '#8d5c1c',
    leafHi: '#e8c76a'
  };

  // Autumn colour families. `w` weights how much of the hillside each claims;
  // rust and orange dominate, spruce punctuates, bare is rare.
  const FOLIAGE = [
    { key: 'rust', lo: '#4a2219', base: '#9c4728', hi: '#ca7838', w: 3.0, conifer: false },
    { key: 'crimson', lo: '#3f1a18', base: '#8a3229', hi: '#ba5347', w: 1.7, conifer: false },
    { key: 'orange', lo: '#573118', base: '#b46324', hi: '#dd9633', w: 2.6, conifer: false },
    { key: 'gold', lo: '#5a4b1a', base: '#b69931', hi: '#e2c853', w: 2.0, conifer: false },
    { key: 'olive', lo: '#37411f', base: '#74803a', hi: '#a1aa56', w: 1.1, conifer: false },
    { key: 'green', lo: '#1f2a18', base: '#42512f', hi: '#637346', w: 0.9, conifer: false },
    { key: 'spruce', lo: '#111c16', base: '#263427', hi: '#3c4d38', w: 1.5, conifer: true },
    { key: 'bare', lo: '#3a2c1f', base: '#6d5539', hi: '#997a52', w: 0.28, conifer: false },
    // Never chosen by the field — reserved for the hero, which has to hold its
    // value under half a pane of condensation.
    { key: 'maple', lo: '#2b1410', base: '#6e241b', hi: '#a8402e', w: 0, conifer: false }
  ];

  const FAM_CDF = [];
  {
    let acc = 0;
    for (const f of FOLIAGE) {
      acc += f.w;
      FAM_CDF.push(acc);
    }
    for (let i = 0; i < FAM_CDF.length; i++) FAM_CDF[i] /= acc;
  }

  const mixCache = new Map();
  /** Cached hex blend — the tree painters ask for the same handful of colours
   *  tens of thousands of times, and `mixHex` allocates. */
  function mixC(a, b, t) {
    const q = Math.round(clamp(t) * 60);
    const k = a + b + q;
    let v = mixCache.get(k);
    if (v === undefined) {
      v = mixHex(a, b, q / 60);
      mixCache.set(k, v);
    }
    return v;
  }

  /* ------------------------- aerial perspective ------------------------ */

  function rgbToHsl(r, g, b) {
    r /= 255;
    g /= 255;
    b /= 255;
    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    const l = (mx + mn) * 0.5;
    const d = mx - mn;
    if (d < 1e-6) return { h: 0, s: 0, l };
    const sat = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    let h;
    if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (mx === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
    return { h, s: sat, l };
  }

  function hue2rgb(a, b, t) {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return a + (b - a) * 6 * t;
    if (t < 1 / 2) return b;
    if (t < 2 / 3) return a + (b - a) * (2 / 3 - t) * 6;
    return a;
  }

  function hslToHex(h, s, l) {
    let r, g, b;
    if (s < 1e-6) {
      r = g = b = l;
    } else {
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const a = 2 * l - q;
      r = hue2rgb(a, q, h + 1 / 3);
      g = hue2rgb(a, q, h);
      b = hue2rgb(a, q, h - 1 / 3);
    }
    return rgbToHex({ r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) });
  }

  const fogCache = new Map();

  /**
   * Distance, done as a veil of light rather than as a lerp toward grey.
   *
   * A straight RGB blend toward the fog colour eats value and chroma at the
   * same rate, so every family converges on the same neutral and the middle
   * distance collapses into one colourless band — which is exactly what a
   * fogged hillside does not do. Haze scatters light *into* the path: it lifts
   * a colour toward the fog's lightness, washes its saturation only part of
   * the way, and leaves its hue alone. So lightness travels the whole
   * distance, saturation about two thirds of it, and the hue does not move.
   * Depth still reads, because depth was always carried by value.
   */
  function fogMix(hex, fogHex, t) {
    const q = Math.round(clamp(t) * 48);
    const key = hex + fogHex + q;
    let v = fogCache.get(key);
    if (v !== undefined) return v;
    const u = q / 48;
    const c = hexToRgb(hex);
    const f = hexToRgb(fogHex);
    const a = rgbToHsl(c.r, c.g, c.b);
    const b = rgbToHsl(f.r, f.g, f.b);
    v = hslToHex(a.h, a.s * (1 - u * 0.62) + b.s * u * 0.3, lerp(a.l, b.l, u));
    fogCache.set(key, v);
    return v;
  }

  // Weather. Always raining; how hard decides fog density, wind and how much
  // water is on the glass. Skewed toward the heavy end.
  let storm;
  let windBias;
  let gustSeed;
  let fogLift; // multiplies every band's fog amount
  // Set by the Tweakpane slider; null means "whatever the seed rolled".
  let stormOverride = null;

  function rollWeather() {
    // The draw happens either way, so overriding the storm does not shift the
    // rest of the seed's stream: the same hillside, the same trees, the same
    // water, painted under different weather.
    const rolled = 0.45 + 0.55 * rng.skew(0.55);
    storm = stormOverride === null ? rolled : stormOverride;
    windBias = rng.chance(0.6) ? 1 : -1;
    gustSeed = rng.range(0, 500);
    fogLift = lerp(0.74, 1.02, storm);
  }

  // Once eagerly, so the Tweakpane binding has the seed's own weather to show.
  // `build()` re-seeds before rolling again, so this draw costs nothing.
  rollWeather();

  /** The fog colour a band at screen height y mixes toward. */
  function fogColAt(y) {
    return mixC(C.fogFar, C.fogWarm, clamp(map(y, RIDGE, H * 0.92, 0, 0.55)));
  }

  /** Family index at x for a given band. Clustered, so stands read as stands. */
  function familyAt(x, off) {
    const n = clamp(noise.fbm2D(x * 0.0019 + off * 11.7, off * 4.3, { octaves: 2 }) * 0.7 + 0.5);
    for (let i = 0; i < FAM_CDF.length; i++) if (n <= FAM_CDF[i]) return i;
    return FOLIAGE.length - 1;
  }

  /** An 8-step value ramp for one family at one fog depth. Precomputed once. */
  function ramp(famIdx, fogT, y) {
    const f = FOLIAGE[famIdx];
    const fc = fogColAt(y);
    const out = new Array(9);
    for (let i = 0; i < 9; i++) {
      // Weighted toward the light end: more of each family's range is spent
      // in its own colour and less in its shadow, so a fogged hillside still
      // has chroma in it.
      const t = Math.pow(i / 8, 0.82);
      const base = t < 0.5 ? mixC(f.lo, f.base, t * 2) : mixC(f.base, f.hi, (t - 0.5) * 2);
      out[i] = fogMix(base, fc, clamp(fogT * fogLift));
    }
    return out;
  }

  /* ------------------------------- wind -------------------------------- */

  const DT = 1 / 45;

  /**
   * The gust envelope: 0 at rest, 1 at the top of a squall, and — because it
   * is a squared fbm rather than a raw one — most of the time down near the
   * bottom. Wind on a hillside is long stretches of near-stillness broken by
   * a swell that builds and eases, not a continuous vibration.
   */
  function gust(t) {
    const n = clamp(noise.fbm2D(t * 0.062 + gustSeed, 7.31, { octaves: 3 }) * 0.9 + 0.5);
    const swell = clamp(noise.noise2D(t * 0.017 + gustSeed * 0.31, 2.1) * 0.7 + 0.5);
    return clamp(Math.pow(n, 2.3) * (0.25 + 1.05 * swell));
  }

  /**
   * Every band is a damped oscillator hanging off the same gust. A tree does
   * not trace the wind: it lags behind it, leans while the gust holds, and
   * rocks back a couple of times when the gust drops. Heavy near bands are
   * tuned slower than light far ones, which is why the depths never move in
   * lockstep — no phase-offset sine can buy that.
   */
  const OSC = [];

  function newOsc(freq, zeta, gain) {
    const w = TAU * freq;
    const o = { x: 0, v: 0, k: w * w, c: 2 * zeta * w, gain };
    OSC.push(o);
    return o;
  }

  function stepWind(dt, t) {
    // Always downwind. The gust eases off; it never blows the other way.
    const drive = windBias * gust(t);
    for (const o of OSC) {
      o.v += (drive * o.gain - o.x) * o.k * dt - o.v * o.c * dt;
      o.x += o.v * dt;
    }
  }

  /* ------------------------------ plates ------------------------------- */

  /**
   * A pool of offscreen surfaces. A rebuild asks for exactly the same plates
   * in exactly the same order, so they are wiped and handed back rather than
   * reallocated — a fresh set per slider tick would leak a canvas the size of
   * the frame a dozen times over, and p5 will not let go of them on request.
   * A plate whose size does not match is replaced, so this stays correct if
   * the layer set ever changes; it just stops being free.
   */
  const PLATES = [];
  let plateIdx = 0;

  function newPlate(w, h) {
    const pw = Math.ceil(w);
    const ph = Math.ceil(h);
    let g = PLATES[plateIdx];
    if (g && g.width === pw && g.height === ph) {
      g.resetMatrix();
      g.clear();
    } else {
      g = p.createGraphics(pw, ph);
      g.pixelDensity(1);
      PLATES[plateIdx] = g;
    }
    g.noStroke();
    plateIdx++;
    return g;
  }

  /**
   * A depth band. `groups` sub-plates hold interleaved trees so neighbours
   * bend out of phase with each other instead of the whole band moving as
   * one rigid slab.
   */
  function newLayer({ x0, y0, x1, y1, groups = 1, sway, topY, baseY }) {
    const w = x1 - x0;
    const h = y1 - y0;
    const plates = [];
    const oscs = [];
    // Bigger sway means a nearer, taller, heavier band, so it is tuned lower:
    // the spruce in the foreground swings about twice as slowly as the scrub
    // on the far ridge.
    const freq = clamp(0.66 - sway * 0.012, 0.24, 0.72);
    for (let i = 0; i < groups; i++) {
      const g = newPlate(w, h);
      g.translate(-x0, -y0); // paint in canvas coordinates
      plates.push(g);
      oscs.push(newOsc(freq * rng.range(0.84, 1.2), rng.range(0.28, 0.44), rng.range(0.82, 1.18)));
    }
    return { x0, y0, x1, y1, w, h, plates, oscs, sway, topY, baseY };
  }

  const STRIP = 14;

  function blitLayer(L, t) {
    for (let i = 0; i < L.plates.length; i++) {
      const g = L.plates[i];
      const bend = L.oscs[i].x * L.sway;
      for (let sy = 0; sy < L.h; sy += STRIP) {
        const sh = Math.min(STRIP, L.h - sy);
        const yMid = L.y0 + sy + sh * 0.5;
        const f = clamp((L.baseY - yMid) / (L.baseY - L.topY));
        const dx = bend * Math.pow(f, 1.7);
        p.image(g, L.x0 + dx, L.y0 + sy, L.w, sh, 0, sy, L.w, sh);
      }
    }
  }

  /* -------------------------------- sky -------------------------------- */

  let skyPlate;

  function paintSky(g) {
    // A flat luminous gradient. The top is the lightest thing in the frame
    // after the mist, and it darkens very slightly toward the ridge so the
    // hillside has something to sit against.
    for (let y = 0; y < H; y += 3) {
      const t = y / H;
      const col =
        t < 0.62
          ? mixC(C.skyTop, C.skyMid, smoothstep(0, 0.62, t))
          : mixC(C.skyMid, C.skyLow, smoothstep(0.62, 1, t));
      g.fill(col);
      g.rect(0, y, W, 4);
    }

    // Rain veils: long faint vertical bands of falling water, only legible
    // against the void. They are the only motion cue outside the glass.
    for (let i = 0; i < 46; i++) {
      const x = rng() * W;
      const wdt = rng.range(18, 130);
      const top = rng.range(-0.1, 0.35) * H;
      const bot = top + rng.range(0.25, 0.75) * H;
      const a = rng.range(0.012, 0.05) * storm;
      g.fill(withAlpha(rng.chance(0.5) ? '#ffffff' : '#9aa2a4', a));
      g.rect(x, top, wdt, bot - top);
    }

    // Cloud structure: horizontal fbm banding, very low contrast.
    for (let y = 0; y < RIDGE + 60; y += 6) {
      const n = noise.fbm2D(y * 0.0022, 3.9, { octaves: 3 });
      const a = Math.abs(n) * 0.055;
      g.fill(withAlpha(n > 0 ? '#ffffff' : '#8f9698', a));
      g.rect(0, y, W, 7);
    }
  }

  /* ------------------------------ forest ------------------------------- */

  function taperedStroke(g, x1, y1, x2, y2, w1, w2, col) {
    const a = Math.atan2(y2 - y1, x2 - x1) + Math.PI / 2;
    const cx = Math.cos(a);
    const cy = Math.sin(a);
    g.fill(col);
    g.beginShape();
    g.vertex(x1 + cx * w1, y1 + cy * w1);
    g.vertex(x2 + cx * w2, y2 + cy * w2);
    g.vertex(x2 - cx * w2, y2 - cy * w2);
    g.vertex(x1 - cx * w1, y1 - cy * w1);
    g.endShape(g.CLOSE);
  }

  /**
   * A distant slope. Not a filled shape — a *population* of small trees whose
   * scale, height in frame and fog all follow one depth parameter, so the band
   * has internal depth and a silhouette made of crowns rather than of noise.
   * A flat fill at this distance reads as a paper cut-out, which is the thing
   * a fogged hillside is least like.
   */
  function paintTreeMass(g, { ridge, amp, freq, bottom, fogT, off, count, hMin, hMax, markSize, marksPer, fade }) {
    const ridgeAt = (x) =>
      ridge +
      noise.fbm2D(x * freq + off * 31.1, off * 5.7, { octaves: 4, gain: 0.55 }) * amp +
      noise.fbm2D(x * freq * 4.1 + off * 3.3, off * 2.1, { octaves: 2 }) * amp * 0.32;

    // Understorey, so the canopy has something dark behind it instead of sky.
    // Neutral, not family-coloured: the family field is quantised, and letting
    // it colour a solid fill chops the hillside into hard vertical blocks.
    for (let x = -4; x <= W + 4; x += 3) {
      const y = ridgeAt(x) + amp * 0.35;
      const shade = noise.fbm2D(x * 0.004 + off * 3.7, off, { octaves: 2 }) * 0.5 + 0.5;
      for (let k = 0; k < 4; k++) {
        const yy = y + ((bottom - y) * k) / 4;
        const base = mixC('#4d3c2c', '#735d43', shade * 0.7 + k * 0.06);
        g.fill(fogMix(base, fogColAt(yy), clamp(fogT * fogLift * (1.2 - k * 0.05))));
        g.rect(x - 0.6, yy, 4.2, (bottom - y) / 4 + 1.5);
      }
    }

    // Depth inside the band: d=0 sits on the ridge, small and drowned in fog;
    // d=1 sits at the foot of the slope, larger and clearer.
    const trees = [];
    for (let i = 0; i < count; i++) {
      const x = rng.range(-50, W + 50);
      const d = rng.skew(0.8);
      trees.push({ x, d, y: lerp(ridgeAt(x) + amp * 0.5, bottom, d) });
    }
    trees.sort((a, b) => a.y - b.y);
    for (const t of trees) {
      const h = lerp(hMin, hMax, t.d) * rng.range(0.72, 1.28);
      paintSmallTree(
        g,
        { x: t.x, baseY: t.y + h * 0.2, h, fam: familyAt(t.x, off), lean: rng.jitter(0.3) },
        clamp(lerp(fogT * 1.18, fogT * 0.78, t.d)),
        marksPer * lerp(0.7, 1.3, t.d),
        markSize * lerp(0.8, 1.3, t.d)
      );
    }

    // The ridge has to dissolve upward into the weather. A hard silhouette
    // against the void is the fastest way to lose the sense of rain.
    if (fade) {
      const fc = fogColAt(ridge);
      for (let y = ridge - amp * 5; y < ridge + fade; y += 2) {
        const a =
          0.95 *
          smoothstep(ridge - amp * 5, ridge - amp * 1.2, y) *
          (1 - smoothstep(ridge - amp * 1.2, ridge + fade, y));
        g.fill(withAlpha(fc, a));
        g.rect(0, y, W, 3);
      }
    }

    // Fog caught in the trees — the thing that says "wet hillside" rather
    // than "green shape".
    const fw = mixC(fogColAt(ridge), '#ffffff', 0.3);
    for (let k = 0; k < 22; k++) {
      const x = rng() * W;
      const y = lerp(ridgeAt(x), bottom, rng.skew(1.7));
      g.fill(withAlpha(fw, rng.range(0.04, 0.17) * (0.4 + fogT)));
      g.ellipse(x, y, rng.range(60, 300), rng.range(12, 60));
    }
  }

  /* ------------------------------- trees -------------------------------- */

  /** Tree positions along a band: clustered spacing, not a jittered grid. */
  function seedTrees(x0, x1, spacing, off) {
    const trees = [];
    let x = x0 - spacing;
    while (x < x1 + spacing) {
      const dens = noise.fbm2D(x * 0.0014 + off * 9.1, off * 6.4, { octaves: 2 }) * 0.5 + 0.5;
      const gap = spacing * (0.32 + rng.skew(1.5) * 1.5) * lerp(1.5, 0.62, dens);
      x += gap;
      trees.push(x);
    }
    return trees;
  }

  function growBranch(g, x, y, ang, len, wgt, depth, tips, col, bnd) {
    const x2 = x + Math.cos(ang) * len;
    const y2 = y + Math.sin(ang) * len;
    if (wgt > 1.6) {
      taperedStroke(g, x, y, x2, y2, wgt * 0.5, wgt * 0.31, col);
    } else {
      g.stroke(col);
      g.strokeWeight(Math.max(0.55, wgt));
      g.line(x, y, x2, y2);
      g.noStroke();
    }
    // Terminate at the crown boundary as well as at depth. Without it the
    // reach of the recursion is len/(1-ratio) — on a big tree that is most of
    // the frame, and the crown runs off its own plate.
    if (depth <= 0 || len < 7 || (bnd && Math.hypot(x2 - bnd.x, y2 - bnd.y) > bnd.r)) {
      // Foliage grows *along* a twig, not only off its end. One cluster per
      // terminal branch is exactly what leaves a generated tree looking like a
      // diagram of a tree; three or four spread down the twig is a canopy.
      const nT = rng.int(2, 4);
      for (let i = 0; i < nT; i++) {
        const u = 0.3 + ((i + rng()) / nT) * 0.72;
        tips.push({ x: lerp(x, x2, u), y: lerp(y, y2, u), r: len * (0.66 + rng.skew(1.3) * 0.62) });
      }
      return;
    }
    const n = rng.chance(0.28) ? 3 : 2;
    for (let i = 0; i < n; i++) {
      const side = i === 0 ? -1 : i === 1 ? 1 : rng.chance(0.5) ? -1 : 1;
      growBranch(
        g,
        x2,
        y2,
        ang + rng.range(0.24, 0.62) * side + rng.jitter(0.1),
        len * rng.range(0.56, 0.74),
        wgt * 0.6,
        depth - 1,
        tips,
        col,
        bnd
      );
    }
    // Interior foliage. Without it the crown is a hollow shell of clusters
    // sitting on the outline and the middle of the tree shows sky.
    if (depth <= 2) {
      const nI = rng.int(1, 2);
      for (let i = 0; i < nI; i++) {
        const u = rng.range(0.34, 0.96);
        tips.push({ x: lerp(x, x2, u), y: lerp(y, y2, u), r: len * rng.range(0.52, 0.86) });
      }
    }
  }

  /**
   * One foliage cluster. The lit half is the top of the cluster, not the top
   * of the tree — that local gradient is what makes a crown read as leaves
   * rather than as a coloured patch.
   */
  function crownMarks(g, cx, cy, cr, pal, top, bot, count, markSize, bodyAlpha) {
    const s0 = clamp(map(cy, top, bot, 1, 0));
    // Two overlapping lobes rather than one disc: the cluster gets a waist in
    // its silhouette instead of reading as a bubble with dots on it.
    if (bodyAlpha > 0.02) {
      // Three tilted, unequal lobes rather than one disc. A single ellipse per
      // cluster is what turns a crown into a stack of pom-poms: the mass has
      // to have a lumpy, directional outline before the marks go on it.
      g.push();
      g.translate(cx, cy);
      g.rotate(rng.jitter(0.9));
      // Four stacked lobes running dark at the bottom to lit at the top. The
      // value ladder inside a single cluster is most of what makes a canopy
      // look like it has depth in it rather than area.
      for (let i = 0; i < 4; i++) {
        g.fill(withAlpha(pal[clamp(Math.round((0.02 + s0 * 0.2 + i * 0.17) * 8), 0, 8)], bodyAlpha));
        const rw = cr * rng.range(0.95, 1.75);
        g.ellipse(rng.jitter(cr * 0.52), rng.jitter(cr * 0.36) - cr * (i * 0.1 - 0.05), rw, rw * rng.range(0.5, 0.9));
      }
      g.pop();
    }
    for (let k = 0; k < count; k++) {
      // Centre-weighted, and a few marks allowed to break past the boundary.
      // Uniform scatter over a disc is why a stippled crown reads as confetti:
      // real foliage is a dense mass whose edge frays.
      const a = rng() * TAU;
      const rr = cr * (0.14 + rng.skew(0.78) * 1.0);
      const dx = Math.cos(a) * rr;
      const dy = Math.sin(a) * rr * 0.86;
      const s = 0.14 + (-dy / cr) * 0.32 + s0 * 0.3 + rng.jitter(0.15);
      g.fill(pal[clamp(Math.round(s * 8), 0, 8)]);
      const sz = markSize * (0.55 + rng.skew(1.5) * 1.25);
      g.ellipse(cx + dx, cy + dy, sz, sz * rng.range(0.6, 0.95));
    }
  }

  /**
   * How many marks a cluster needs, from its area and the mark's, rather than
   * from a number picked by hand at each call site. Hand-picked counts always
   * undershoot on the big trees, because cluster area grows quadratically and
   * the guess does not — which is how a canopy ends up looking bare.
   */
  function markCount(density, cr, markSize, cap) {
    return clamp(Math.round((density * 2.7 * cr * cr) / (markSize * markSize * 0.62)), 8, cap);
  }

  function paintFoliage(g, tips, pal, top, bot, density, markSize, crMin, crMax, bnd, bodyScale = 1) {
    for (const tip of tips) {
      const cr = clamp(tip.r * 0.6, crMin, crMax);
      // A cluster body is only painted in full in the interior of the crown.
      // On the silhouette it has sky behind it and reads as a translucent
      // disc, which is the single most artificial thing a generated tree can
      // do — so out there the mass is built from marks instead, and the marks
      // are what fray the edge. Deep inside, the body already covers the
      // ground, so the marks are only texture and can be far fewer: paint the
      // mass where it is cheap and the edge where it matters.
      // Body clusters are opaque; only the skeleton's own clusters fade, and
      // only in the outer band where they are the silhouette. Fading the body
      // out across the middle of the crown is what left a translucent annulus
      // with the tree behind showing through it.
      const inner = bnd ? 1 - smoothstep(bnd.r * 0.55, bnd.r * 0.98, Math.hypot(tip.x - bnd.x, tip.y - bnd.y)) : 1;
      const solid = tip.fill ? 1 : inner;
      const per = markCount(density * (1 - solid * 0.78), cr, markSize, 240);
      crownMarks(g, tip.x, tip.y - cr * 0.1, cr, pal, top, bot, per, markSize, (0.1 + solid * 0.87) * bodyScale);
    }
  }

  /** A sapling or a distant tree: too small for a skeleton, so a trunk and a
   *  few crown lobes. Used in their hundreds to build the far slopes. */
  function paintSmallTree(g, T, fogT, density, markSize) {
    const fam = FOLIAGE[T.fam];
    const pal = ramp(T.fam, fogT, T.baseY);
    const top = T.baseY - T.h;
    const barkCol = mixC(C.trunkDk, fogColAt(T.baseY), clamp(fogT * fogLift * 1.06));

    if (fam.conifer) {
      const maxW = T.h * rng.range(0.16, 0.26);
      const tiers = Math.max(4, Math.round(T.h / Math.max(2.5, markSize * 1.6)));
      taperedStroke(g, T.x, T.baseY, T.x, top, Math.max(0.6, T.h * 0.016), 0.4, barkCol);
      for (let i = 0; i < tiers; i++) {
        const u = i / (tiers - 1);
        const y = lerp(top, T.baseY, u);
        const half = maxW * Math.pow(u, 0.8);
        const n = Math.max(2, Math.round(half / Math.max(1.2, markSize * 0.5)));
        for (let k = 0; k < n; k++) {
          const q = rng.jitter(1);
          const v = 0.5 - Math.abs(q) * 0.24 - u * 0.26 + rng.jitter(0.13);
          g.fill(pal[clamp(Math.round(v * 8), 0, 8)]);
          const sz = markSize * (0.55 + rng.skew(1.5));
          g.ellipse(T.x + q * half, y + Math.abs(q) * half * 0.45, sz, sz * 0.72);
        }
      }
      return;
    }

    taperedStroke(
      g, T.x, T.baseY, T.x + T.lean * T.h * 0.09, T.baseY - T.h * 0.6,
      Math.max(0.6, T.h * 0.028), 0.4, barkCol
    );
    const lobes = rng.int(3, 5);
    const cw = T.h * rng.range(0.34, 0.54);
    for (let i = 0; i < lobes; i++) {
      const cr = cw * rng.range(0.5, 0.95);
      crownMarks(
        g,
        T.x + rng.jitter(cw * 0.65),
        top + T.h * rng.range(0.05, 0.45),
        cr,
        pal, top, T.baseY,
        markCount(density, cr, markSize, 52),
        markSize, 0.58
      );
    }
  }

  /** A deciduous tree: trunk, branch skeleton, foliage clustered on the tips. */
  function paintDeciduous(g, T, fogT, marks, markSize) {
    const bare = T.fam === 7;
    const pal = ramp(T.fam, fogT, T.baseY);
    const barkCol = mixC(bare ? C.trunk : C.trunkDk, fogColAt(T.baseY), clamp(fogT * fogLift * 0.92));
    const top = T.baseY - T.h;
    const trunkTop = T.baseY - T.h * rng.range(0.36, 0.52);
    const lean = T.lean;

    // Trunk in two segments so it bows rather than pointing like a stick.
    const midY = lerp(T.baseY, trunkTop, 0.55);
    const midX = T.x + lean * T.h * 0.05;
    const topX = T.x + lean * T.h * 0.11;
    const bw = Math.max(1.1, T.h * 0.017);
    taperedStroke(g, T.x, T.baseY + 4, midX, midY, bw, bw * 0.68, barkCol);
    taperedStroke(g, midX, midY, topX, trunkTop, bw * 0.68, bw * 0.42, barkCol);

    const tips = [];
    // Big trees get more generations, so their twigs end short and the crown
    // is built from many small clusters instead of a few huge ones.
    const depth = T.h > H * 0.3 ? 5 : T.h > H * 0.14 ? 4 : 3;
    const crownR = T.h * rng.range(0.4, 0.55);
    const bnd = { x: topX, y: trunkTop - crownR * 0.3, r: crownR };
    const nMain = T.h > H * 0.3 ? rng.int(5, 7) : rng.int(3, 5);
    for (let i = 0; i < nMain; i++) {
      const up = i / (nMain - 1 || 1);
      const ax = lerp(midX, topX, up);
      const ay = lerp(midY, trunkTop, up);
      const dir = i % 2 === 0 ? -1 : 1;
      growBranch(
        g,
        ax,
        ay,
        -Math.PI / 2 + rng.range(0.3, 0.95) * dir + lean * 0.35,
        crownR * rng.range(0.36, 0.56),
        bw * 0.8 * (1 - up * 0.3),
        depth,
        tips,
        barkCol,
        bnd
      );
    }
    growBranch(g, topX, trunkTop, -Math.PI / 2 + lean * 0.5 + rng.jitter(0.18), crownR * 0.55, bw * 0.75, depth, tips, barkCol, bnd);

    // The body of the crown.
    //
    // A branch skeleton can only ever hang foliage on the *outline* of a
    // crown, because every twig that reaches the boundary stops there. That
    // leaves the middle of a big tree empty, and scattering filler clusters at
    // random does not close it: random placement at any affordable count is
    // Poisson, and Poisson always leaves holes the size of the cluster itself.
    // A hole in a canopy is the one artefact that cannot be read as anything
    // but a mistake.
    //
    // So the interior is laid on a jittered lattice, spaced closer than the
    // clusters are wide, inside a boundary whose radius is modulated by angle
    // so the mass is lobed rather than round. It goes in first, and the
    // skeleton's own clusters draw over it and fray its edge.
    if (!bare) {
      const fillTips = [];
      const step = bnd.r * 0.2;
      const lobe = (px, py) => {
        const a = Math.atan2(py, px);
        return 0.95 * (0.72 + 0.4 * (noise.noise2D(Math.cos(a) * 1.7 + T.x * 0.013, Math.sin(a) * 1.7) * 0.5 + 0.5));
      };
      for (let gy = -bnd.r; gy <= bnd.r; gy += step) {
        for (let gx = -bnd.r; gx <= bnd.r; gx += step) {
          const px = gx + rng.jitter(step * 0.45);
          const py = gy + rng.jitter(step * 0.45);
          if (Math.hypot(px, py * 1.06) / bnd.r > lobe(px, py)) continue;
          fillTips.push({ x: bnd.x + px, y: bnd.y + py, r: bnd.r * rng.range(0.17, 0.27), fill: true });
        }
      }
      tips.unshift(...fillTips);
    }

    // Cluster radius is a fraction of the *tree*, never of the branch that
    // spawned it: branch length runs to hundreds of pixels on a big tree and
    // turns the crown into one opaque blob.
    // A bare tree is bare: thin marks *and* almost no body, or the crown fill
    // hands it the same solid mass as a tree in full leaf and it reads as a
    // dead grey blob planted in the middle of the composition.
    paintFoliage(
      g, tips, pal, top, T.baseY, marks * (bare ? 0.3 : 1), markSize,
      T.h * 0.05, T.h * 0.125, bnd, bare ? 0.16 : 1
    );

    // A few twigs redrawn over the leaves: structure reads through a thinning
    // late-season canopy, which is what makes these trees look like October.
    if (T.h > H * 0.17) {
      // Sparingly. There are three times as many clusters as there used to be,
      // and one twig per cluster turns a full crown into a pincushion.
      g.stroke(withAlpha(barkCol, 0.5));
      g.strokeWeight(Math.max(0.5, bw * 0.14));
      for (const tip of tips) {
        if (!rng.chance(0.08)) continue;
        const a = rng.range(-2.6, -0.5);
        const l = tip.r * rng.range(0.3, 0.75);
        g.line(tip.x, tip.y, tip.x + Math.cos(a) * l, tip.y + Math.sin(a) * l);
      }
      g.noStroke();
    }
  }

  /** A conifer: a spire of drooping branch tiers, always the darkest value. */
  function paintConifer(g, T, fogT, markSize) {
    const pal = ramp(6, fogT, T.baseY);
    const barkCol = mixC(C.trunkDk, fogColAt(T.baseY), clamp(fogT * fogLift));
    const top = T.baseY - T.h;
    const maxW = T.h * rng.range(0.23, 0.33);
    taperedStroke(g, T.x, T.baseY + 4, T.x + T.lean * T.h * 0.05, top, Math.max(0.9, T.h * 0.014), 0.6, barkCol);

    const tiers = Math.max(9, Math.round(T.h / (markSize * 1.35)));
    for (let i = 0; i < tiers; i++) {
      const u = i / (tiers - 1);
      const y = lerp(top, T.baseY, u);
      const half = maxW * Math.pow(u, 0.78) * (0.72 + noise.noise2D(u * 9.3, T.x * 0.05) * 0.35);
      const cx = T.x + T.lean * T.h * 0.05 * (1 - u);
      const n = Math.max(3, Math.round(half / (markSize * 0.34)));
      for (let k = 0; k < n; k++) {
        const s = rng.jitter(1);
        const x = cx + s * half;
        const droop = Math.abs(s) * half * rng.range(0.3, 0.7);
        const v = 6.4 - Math.abs(s) * 1.9 - u * 1.6 + rng.jitter(1.2);
        g.fill(pal[clamp(Math.round(v), 0, 8)]);
        const sz = markSize * (0.6 + rng.skew(1.4) * 1.1);
        g.ellipse(x, y + droop, sz, sz * 0.74);
      }
    }
  }

  function paintTree(g, T, fogT, marks, markSize) {
    if (FOLIAGE[T.fam].conifer) paintConifer(g, T, fogT, markSize);
    else paintDeciduous(g, T, fogT, marks, markSize);
  }

  /* ------------------------- band construction -------------------------- */

  let farMass, midMass, midTrees, nearTrees, frontLeft, frontRight, shrub;
  const fogBanks = [];

  function buildTreeBand(L, { x0, x1, spacing, baseY, baseVar, hMin, hMax, fogT, marks, markSize, off, poles }) {
    const xs = seedTrees(x0, x1, spacing, off);
    const groups = L.plates.length;
    // Bare poles first, behind everything: the grey trunk field that shows
    // through a thinning canopy and does most of the work of "woods".
    if (poles) {
      for (let i = 0; i < poles; i++) {
        const g = L.plates[i % groups];
        const x = lerp(x0, x1, rng());
        const by = baseY + rng.jitter(baseVar);
        const h = lerp(hMin, hMax, rng()) * rng.range(0.75, 1.05);
        const col = mixC(C.trunkDk, fogColAt(by), clamp(fogT * fogLift * 1.25));
        taperedStroke(g, x, by, x + rng.jitter(h * 0.06), by - h, Math.max(0.5, h * 0.006), 0.35, col);
      }
    }
    for (let i = 0; i < xs.length; i++) {
      const x = xs[i];
      const g = L.plates[i % groups];
      const by = baseY + rng.jitter(baseVar);
      const T = {
        x,
        baseY: by,
        h: lerp(hMin, hMax, rng.skew(1.7)),
        fam: familyAt(x, off),
        lean: rng.jitter(0.35)
      };
      paintTree(g, T, fogT, marks, markSize);
    }
  }

  /** The nearest vegetation: bright, sharp, and cropped by the sill. */
  function paintShrub(L) {
    const groups = L.plates.length;
    const clumps = [];
    let x = -60;
    while (x < W + 60) {
      x += rng.range(40, 240);
      clumps.push(x);
    }
    for (let i = 0; i < clumps.length; i++) {
      const g = L.plates[i % groups];
      const cx = clumps[i];
      const cy = sillY(cx) + rng.range(-6, 24);
      const hgt = H * (0.022 + rng.skew(1.5) * 0.08);
      const wdt = rng.range(60, 170);
      // Bright chartreuse and gold dominate down here; the eye needs one
      // place in the frame where the colour is not veiled.
      const fam = rng.weighted([3, 4, 0, 2, 5, 6, 7], [1.7, 2.4, 1.6, 1.6, 2.6, 1.4, 1.2]);
      const pal = ramp(fam, 0.05, cy);
      const n = Math.round(wdt * hgt * 0.02);
      for (let k = 0; k < n; k++) {
        const u = rng.gaussian(0, 0.36);
        const v = rng.skew(1.3);
        const px = cx + u * wdt;
        const py = cy - v * hgt;
        const s = clamp(0.04 + v * 0.6 + rng.jitter(0.2));
        g.fill(pal[clamp(Math.round(s * 8), 0, 8)]);
        const sz = rng.range(4, 11);
        g.ellipse(px, py, sz, sz * rng.range(0.55, 0.9));
      }
      // Stems: a few tapered strokes give the clump a direction.
      for (let k = 0; k < 7; k++) {
        const a = rng.jitter(0.5);
        const l = hgt * rng.range(0.6, 1.15);
        g.stroke(withAlpha(pal[rng.int(1, 4)], 0.8));
        g.strokeWeight(rng.range(0.8, 2.2));
        g.line(cx + rng.jitter(wdt * 0.3), cy + 8, cx + rng.jitter(wdt * 0.3) + Math.sin(a) * l * 0.5, cy - l);
        g.noStroke();
      }
    }
  }

  function paintFogBank(g, y0, y1, seedOff, strength) {
    const fc = mixC(C.fogFar, '#ffffff', 0.55);
    for (let k = 0; k < 240; k++) {
      const x = rng.range(-0.15, 1.15) * W;
      const yy = lerp(y0, y1, rng.skew(1.4));
      const n = noise.fbm2D(x * 0.002 + seedOff, yy * 0.004, { octaves: 3 }) * 0.5 + 0.5;
      const a = n * n * strength * rng.range(0.4, 1.3);
      if (a < 0.01) continue;
      g.fill(withAlpha(fc, a));
      g.ellipse(x + 0.15 * W, yy - y0, rng.range(120, 520), rng.range(24, 110));
    }
  }

  function buildForest() {
    farMass = newLayer({ x0: 0, y0: H * 0.43, x1: W, y1: H * 0.72, sway: 2.5, topY: H * 0.52, baseY: H * 0.72 });
    paintTreeMass(farMass.plates[0], {
      ridge: RIDGE,
      amp: H * 0.032,
      freq: 0.0011,
      bottom: H * 0.72,
      fogT: 0.72,
      off: 1,
      count: 520,
      hMin: H * 0.012,
      hMax: H * 0.034,
      markSize: 3.3,
      marksPer: 0.56,
      fade: H * 0.08
    });

    midMass = newLayer({ x0: 0, y0: H * 0.5, x1: W, y1: H * 0.86, sway: 5, topY: H * 0.59, baseY: H * 0.86 });
    paintTreeMass(midMass.plates[0], {
      ridge: H * 0.607,
      amp: H * 0.042,
      freq: 0.0016,
      bottom: H * 0.86,
      fogT: 0.44,
      off: 2,
      count: 390,
      hMin: H * 0.022,
      hMax: H * 0.07,
      markSize: 3.9,
      marksPer: 0.56,
      fade: H * 0.05
    });

    midTrees = newLayer({
      x0: 0, y0: H * 0.57, x1: W, y1: H * 0.89, groups: 2, sway: 9, topY: H * 0.63, baseY: H * 0.85
    });
    buildTreeBand(midTrees, {
      x0: -40, x1: W + 40, spacing: 36, baseY: H * 0.822, baseVar: H * 0.012,
      hMin: H * 0.05, hMax: H * 0.13, fogT: 0.3, marks: 0.75, markSize: 4.0, off: 3, poles: 16
    });

    nearTrees = newLayer({
      x0: 0, y0: H * 0.55, x1: W, y1: H * 0.93, groups: 2, sway: 17, topY: H * 0.63, baseY: H * 0.9
    });
    buildTreeBand(nearTrees, {
      x0: -60, x1: W + 60, spacing: 60, baseY: H * 0.878, baseVar: H * 0.014,
      hMin: H * 0.08, hMax: H * 0.2, fogT: 0.09, marks: 0.95, markSize: 5.4, off: 4, poles: 8
    });

    // A handful of emergents: bare or nearly leafless trees standing above the
    // general canopy. They are what stops the skyline reading as a hedge, and
    // besides the hero they are the only forms that touch the fog.
    for (let i = 0; i < rng.int(5, 9); i++) {
      const far = rng.chance(0.55);
      const band = far ? midTrees : nearTrees;
      paintDeciduous(
        band.plates[i % 2],
        {
          x: rng() * W,
          baseY: (far ? H * 0.822 : H * 0.878) + rng.jitter(12),
          h: H * rng.range(0.13, 0.22),
          fam: 7,
          lean: rng.jitter(0.3)
        },
        far ? 0.4 : 0.24,
        0.08,
        3.0
      );
    }

    // The left edge: a stand of spruce, cropped. Dark, vertical, and the only
    // hard value in the left half — it anchors that side against the void.
    frontLeft = newLayer({
      x0: 0, y0: H * 0.44, x1: W * 0.4, y1: H * 0.95, groups: 2, sway: 20, topY: H * 0.55, baseY: H * 0.93
    });
    {
      const spires = [
        { x: W * 0.03, h: H * 0.31 },
        { x: W * 0.115, h: H * 0.26 },
        { x: W * 0.2, h: H * 0.22 },
        { x: W * 0.275, h: H * 0.18 }
      ];
      for (let i = 0; i < spires.length; i++) {
        const s = spires[i];
        paintConifer(
          frontLeft.plates[i % 2],
          { x: s.x + rng.jitter(12), baseY: H * 0.9 + rng.jitter(14), h: s.h * rng.range(0.9, 1.12), lean: rng.jitter(0.25) },
          0.06,
          6.2
        );
      }
      paintDeciduous(
        frontLeft.plates[1],
        { x: W * 0.145, baseY: H * 0.905, h: H * 0.19, fam: 0, lean: -0.3 },
        0.07,
        1.0,
        6.0
      );
    }

    // The hero: one big maple entering from the right, the only form that
    // penetrates the fog void, and the piece's depth ladder in a single tree.
    frontRight = newLayer({
      x0: W * 0.46, y0: H * 0.3, x1: W, y1: H, groups: 2, sway: 26, topY: H * 0.4, baseY: H * 0.95
    });
    paintDeciduous(
      frontRight.plates[0],
      { x: W * 1.06, baseY: H * 0.93, h: H * 0.46, fam: 8, lean: -0.34 },
      0.02,
      1.3,
      6.0
    );
    paintDeciduous(
      frontRight.plates[1],
      { x: W * 0.78, baseY: H * 0.92, h: H * 0.26, fam: 2, lean: 0.2 },
      0.08,
      0.95,
      6.0
    );

    shrub = newLayer({ x0: 0, y0: H * 0.78, x1: W, y1: H * 0.95, groups: 2, sway: 13, topY: H * 0.79, baseY: H * 0.95 });
    paintShrub(shrub);

    for (let i = 0; i < 2; i++) {
      const y0 = H * (i === 0 ? 0.5 : 0.6);
      const y1 = H * (i === 0 ? 0.78 : 0.9);
      const g = newPlate(W * 1.3, y1 - y0);
      paintFogBank(g, y0, y1, i * 17.3, i === 0 ? 0.28 : 0.15);
      fogBanks.push({ g, y0, ph: rng.range(0, TAU), amp: W * (i === 0 ? 0.055 : 0.035) });
    }
  }

  function drawFogBanks(t, which) {
    const b = fogBanks[which];
    const dx = Math.sin(t * 0.055 + b.ph) * b.amp + windBias * gust(t) * b.amp * 0.4;
    p.image(b.g, -W * 0.15 + dx, b.y0);
  }

  /* ------------------------------- glass -------------------------------- */

  let glassPlate;
  const beads = [];
  const beadGrid = new Map();
  const CELL = 36;

  /** How thick the condensation film is at height y. Heavy where the glass is
   *  coldest, thin near the frame — the hillside has to survive it. */
  function mistProfile(y) {
    return lerp(0.9, 0.11, smoothstep(0.12, 0.78, y / H));
  }

  /** Sideways bias: the wind drives the rain onto one half of the pane, and
   *  that half is washed clearer. It is also what lets the hero tree hold its
   *  colour while the void stays milky. */
  function mistSide(x) {
    return windBias > 0 ? lerp(1.06, 0.66, x / W) : lerp(0.66, 1.06, x / W);
  }

  function mistAlpha(x, y) {
    const n = noise.fbm2D(x * 0.0034 + 40, y * 0.0034, { octaves: 3 }) * 0.5 + 0.5;
    return clamp(mistProfile(y) * mistSide(x) * (0.6 + 0.75 * n));
  }

  /**
   * A coarse map of how wet each patch of glass is. Every track deposits into
   * it, and it barely decays, so the pane keeps a memory of where water has
   * already run.
   *
   * This is the single thing that separates rain on glass from a set of
   * parallel scratches. A channel that has already been cleared is a
   * low-resistance path — the film there is thicker and the glass behind it is
   * no longer dry — so the next head that comes near does not run past it, it
   * falls into it and the two go on as one. Steering each head up the local
   * gradient of this field is a cheap stand-in for the film-height term in a
   * shallow-water solve, and it buys the behaviour that actually reads as
   * rain: tributaries, confluences, a few heavily used trunk routes, and long
   * stretches of glass that stay dry between them.
   */
  const WCELL = 8;
  const WGW = Math.ceil(W / WCELL) + 2;
  const WGH = Math.ceil(H / WCELL) + 2;
  const wet = new Float32Array(WGW * WGH);

  function wetAt(x, y) {
    const i = (x / WCELL) | 0;
    const j = (y / WCELL) | 0;
    if (i < 0 || j < 0 || i >= WGW || j >= WGH) return 0;
    return wet[j * WGW + i];
  }

  function wetAdd(x, y, a) {
    const i = (x / WCELL) | 0;
    const j = (y / WCELL) | 0;
    if (i < 0 || j < 0 || i >= WGW || j >= WGH) return;
    const k = j * WGW + i;
    wet[k] = Math.min(2.5, wet[k] + a);
    if (i > 0) wet[k - 1] = Math.min(2.5, wet[k - 1] + a * 0.45);
    if (i < WGW - 1) wet[k + 1] = Math.min(2.5, wet[k + 1] + a * 0.45);
  }

  /** The slope the film wants: lean toward the wettest column just ahead. */
  function filmPull(x, y, reach) {
    const here = wetAt(x, y);
    let best = here + 0.02;
    let bd = 0;
    for (let s = -3; s <= 3; s++) {
      if (!s) continue;
      const d = (s * reach) / 3;
      const v = wetAt(x + d, y) / (1 + Math.abs(s) * 0.4);
      if (v > best) {
        best = v;
        bd = d;
      }
    }
    if (!bd) return 0;
    return clamp((best - here) * 1.6) * Math.sign(bd);
  }

  function addBead(g, x, y, r) {
    // A bead is a lens: it clears the mist under itself, then keeps a bright
    // rim and a dark underside. Clearing is why beads read as *on* the glass.
    g.erase(clamp(r * 0.16) * 210 + 40, 0);
    g.ellipse(x, y, r * 1.8, r * 1.75);
    g.noErase();
    g.fill(withAlpha(C.beadDark, 0.28));
    g.ellipse(x, y + r * 0.28, r * 1.75, r * 1.5);
    g.fill(withAlpha(C.beadHi, 0.55));
    g.ellipse(x - r * 0.34, y - r * 0.38, r * 0.75, r * 0.65);
    if (r > 3.2) {
      g.fill(withAlpha('#ffffff', 0.7));
      g.ellipse(x - r * 0.4, y - r * 0.45, r * 0.32, r * 0.28);
    }
    const b = { x, y, r, alive: true };
    beads.push(b);
    const key = Math.floor(y / CELL) * 4096 + Math.floor(x / CELL);
    let arr = beadGrid.get(key);
    if (!arr) beadGrid.set(key, (arr = []));
    arr.push(b);
  }

  function eatBeads(g, x, y, w) {
    let gained = 0;
    const c0 = Math.floor((x - w) / CELL);
    const c1 = Math.floor((x + w) / CELL);
    const r0 = Math.floor((y - w) / CELL);
    const r1 = Math.floor((y + w) / CELL);
    for (let cy = r0; cy <= r1; cy++) {
      for (let cx = c0; cx <= c1; cx++) {
        const arr = beadGrid.get(cy * 4096 + cx);
        if (!arr) continue;
        for (const b of arr) {
          if (!b.alive) continue;
          if (Math.hypot(b.x - x, b.y - y) > w + b.r) continue;
          b.alive = false;
          gained += b.r * b.r * 0.0022;
        }
      }
    }
    return gained;
  }

  function newTrack() {
    return { wob: rng.range(0, 200), travel: 0, next: 5 };
  }

  /**
   * The wet track a head drags behind it, and the only place a trail is drawn.
   *
   * A trail is not a ribbon of constant width. The film a head leaves is
   * unstable: it necks, and the necks pinch off into separate drops — the
   * Rayleigh–Plateau breakup you can watch happen on any window. The interval
   * between those drops is a few channel widths, scattered, and it stretches
   * when the head is fast enough to outrun its own tail. Scheduling them at a
   * fixed multiple of the width instead is exactly what made the old trails
   * read as dotted lines drawn by a machine.
   *
   * Everything it sheds goes in as a real bead, so a later head running the
   * same channel eats it. That is the other half of blending: a trunk route
   * gets scrubbed clean and re-beaded over and over instead of accumulating
   * permanent decoration.
   */
  function layTrack(g, tr, x0, y0, x1, y1, w, speed, vigour) {
    const moved = Math.hypot(x1 - x0, y1 - y0);
    if (moved < 0.15) return 0;
    // Necking: the channel pulses in width along its own length.
    const neck = 0.6 + 0.75 * (noise.noise2D(y1 * 0.014, tr.wob + 3) * 0.5 + 0.5);
    carve(g, x0, y0, x1, y1, w * neck, (55 + Math.min(w, 10) * 17 + vigour * 45) * (0.5 + neck * 0.65));
    wetAdd(x1, y1, moved * 0.055 * (0.5 + w * 0.13));

    tr.travel += moved;
    let shed = 0;
    while (tr.travel >= tr.next) {
      tr.travel -= tr.next;
      const u = clamp(1 - tr.travel / moved);
      const bx = lerp(x0, x1, u);
      const by = lerp(y0, y1, u);
      const clump = noise.noise2D(by * 0.0065, tr.wob + 21) * 0.5 + 0.5;
      const r = w * (0.26 + rng.skew(2.1) * 1.15) * lerp(0.6, 1.5, clump);
      if (r > 0.55) {
        addBead(g, bx + rng.jitter(w * 0.6), by, r);
        shed += r * r * 0.0018;
      }
      tr.next = Math.max(2.2, w * lerp(1.2, 10, clump) * rng.range(0.45, 2.1) * (0.5 + speed * 0.0032));
    }
    return shed;
  }

  function carve(g, x0, y0, x1, y1, w, strength) {
    g.erase(strength * 0.3, strength * 0.3);
    g.stroke(255);
    g.strokeWeight(w * 2.6);
    g.line(x0, y0, x1, y1);
    g.erase(strength, strength);
    g.strokeWeight(w * 1.05);
    g.line(x0, y0, x1, y1);
    g.noErase();
    // Meniscus: the rim of the channel holds water and catches the sky.
    const film = clamp(mistProfile((y0 + y1) * 0.5) * 1.3);
    if (film > 0.05) {
      // The rim of the channel holds water and catches the sky — unevenly,
      // and rarely on both sides at once. Two matched rails read as a printed
      // stripe rather than as a meniscus.
      const n = noise.noise2D(y0 * 0.018, x0 * 0.009) * 0.5 + 0.5;
      g.strokeWeight(0.9);
      g.stroke(withAlpha(C.waterHi, (0.03 + 0.15 * n) * film));
      g.line(x0 - w * 0.9, y0, x1 - w * 0.9, y1);
      g.stroke(withAlpha(C.waterHi, (0.03 + 0.15 * (1 - n)) * film));
      g.line(x0 + w * 0.9, y0, x1 + w * 0.9, y1);
    }
    g.stroke(withAlpha(C.waterDk, 0.045));
    g.strokeWeight(w * 0.7);
    g.line(x0, y0, x1, y1);
    g.noStroke();
  }

  let filmAlpha = null;
  let healTick = 0;

  /**
   * The condensation re-forms.
   *
   * Without this the pane is a ratchet: it only ever gets more cleared, so
   * after a few minutes every channel the storm has ever cut is still sitting
   * there and the accumulated network reads as a drainage map — a drawing of
   * rain rather than rain. Healing pulls each pixel's alpha back toward the
   * film's own, never past it, so the glass reaches a steady density instead
   * of filling up: channels cut, hold for half a minute or so, and fog over.
   */
  const HEAL_BANDS = 45;

  function healGlass() {
    if (!filmAlpha) return;
    // One band per frame. Reading the whole plate at once costs more than a
    // frame is worth in a software rasterizer, and there is no reason the
    // fogging has to be simultaneous — a window does not re-mist in lockstep.
    const bandH = Math.ceil(H / HEAL_BANDS);
    const y0 = healTick * bandH;
    const h = Math.min(bandH, H - y0);
    if (h <= 0) return;
    const c2 = glassPlate.drawingContext;
    const img = c2.getImageData(0, y0, W, h);
    const px = img.data;
    const base = y0 * W;
    const n = W * h;
    for (let i = 0, j = 3; i < n; i++, j += 4) {
      const t = filmAlpha[base + i];
      const a = px[j];
      if (a < t - 1) px[j] = a + (t - a) * 0.028;
    }
    c2.putImageData(img, 0, y0);
  }

  function paintGlass(g) {
    // Condensation, written straight into the pixels. Painted as overlapping
    // translucent shapes it accumulates toward flat white and the hillside
    // disappears behind it; here the film's opacity is exactly what the
    // profile says it is.
    const SS = 14;
    const gw = Math.ceil(W / SS) + 2;
    const gh = Math.ceil(H / SS) + 2;
    const field = new Float32Array(gw * gh);
    for (let j = 0; j < gh; j++) {
      for (let i = 0; i < gw; i++) {
        field[j * gw + i] =
          noise.fbm2D(i * SS * 0.0034 + 40, j * SS * 0.0034, { octaves: 3 }) * 0.5 + 0.5;
      }
    }
    const mA = hexToRgb(C.mist);
    const mB = hexToRgb(C.mistCool);
    g.loadPixels();
    const gpx = g.pixels;
    for (let y = 0; y < H; y++) {
      const fy = y / SS;
      const j0 = Math.floor(fy);
      const ty = fy - j0;
      const prof = mistProfile(y);
      for (let x = 0; x < W; x++) {
        const fx = x / SS;
        const i0 = Math.floor(fx);
        const tx = fx - i0;
        const n =
          lerp(
            lerp(field[j0 * gw + i0], field[j0 * gw + i0 + 1], tx),
            lerp(field[(j0 + 1) * gw + i0], field[(j0 + 1) * gw + i0 + 1], tx),
            ty
          );
        const i = 4 * (y * W + x);
        gpx[i] = mA.r + (mB.r - mA.r) * n;
        gpx[i + 1] = mA.g + (mB.g - mA.g) * n;
        gpx[i + 2] = mA.b + (mB.b - mA.b) * n;
        gpx[i + 3] = clamp(prof * mistSide(x) * (0.6 + 0.75 * n)) * 255;
      }
    }
    g.updatePixels();
    // The condensation's own alpha, kept so a cleared channel has a ceiling to
    // heal back to — and only ever back to, never past it.
    filmAlpha = new Uint8Array(W * H);
    for (let i = 0, j = 3; i < filmAlpha.length; i++, j += 4) filmAlpha[i] = gpx[j];

    // Older runs, already made and half re-fogged: the storm has a history,
    // and — because they seed the wetness field — the routes the live water
    // will find and reuse are already on the glass before the first frame.
    const smears = rng.int(6, 11);
    for (let i = 0; i < smears; i++) {
      const tr = newTrack();
      let x = rng() * W;
      let y = rng.range(-0.08, 0.16) * H;
      const end = Math.min(H * 0.87, y + rng.range(0.22, 1.0) * H);
      const wdt = rng.range(1.8, 6.5);
      const wig = 3.5 + rng.skew(2.4) * 18;
      while (y < end) {
        const wob = noise.noise2D(y * 0.0026, tr.wob) + noise.noise2D(y * 0.011, tr.wob + 7) * 0.3;
        const slope = clamp(wob * wig * 0.022 + filmPull(x, y + 16, 22) * 0.45, -0.44, 0.44);
        const nx = x + slope * 8;
        layTrack(g, tr, x, y, nx, y + 8, wdt, 130, 0.3);
        x = nx;
        y += 8;
      }
      addBead(g, x, y, wdt * rng.range(0.8, 1.5));
    }

    // Beads, denser where the mist is thick, sizes heavily skewed small.
    const attempts = Math.round(3600 * (0.6 + storm * 0.7));
    for (let i = 0; i < attempts; i++) {
      const x = rng() * W;
      const y = rng() * H * 0.9;
      if (y > sillY(x) - 6) continue;
      const m = mistAlpha(x, y);
      if (rng() > m * 0.75) continue;
      addBead(g, x, y, 0.9 + rng.skew(3.4) * 6);
    }
  }

  /* ----------------------------- rivulets ------------------------------- */

  const rivs = [];
  let spawnAcc = 0;

  function newRivulet(x, y, vol) {
    const r = newTrack();
    r.x = x;
    r.y = y;
    r.v = rng.range(0, 30);
    r.vol = vol;
    // A few tracks wander a long way across the pane; most barely stray.
    r.wig = 3.5 + rng.skew(2.8) * 18;
    r.ws = 0.55 + rng.skew(1.7) * 1.3;
    r.stall = 0;
    r.alive = true;
    return r;
  }

  const widthOf = (r) => (0.8 + r.vol * 4.6) * r.ws;

  /**
   * Coalescence. Two heads that touch become one head with the sum of their
   * water, the momentum-weighted speed of both, and the wander of whichever
   * was larger — so a confluence visibly *quickens*, which is the tell that
   * makes it read as water rather than as two lines crossing. Without this
   * every track on the pane stays a stranger to every other one, and no
   * amount of noise on the paths will make them look like they belong to the
   * same sheet of water.
   */
  function mergeRivulets() {
    const M = 26;
    const cells = new Map();
    for (const r of rivs) {
      if (!r.alive) continue;
      const k = ((r.y / M) | 0) * 4096 + ((r.x / M) | 0);
      let a = cells.get(k);
      if (!a) cells.set(k, (a = []));
      a.push(r);
    }
    for (const r of rivs) {
      if (!r.alive) continue;
      const ci = (r.x / M) | 0;
      const cj = (r.y / M) | 0;
      for (let j = cj - 1; j <= cj + 1 && r.alive; j++) {
        for (let i = ci - 1; i <= ci + 1 && r.alive; i++) {
          const a = cells.get(j * 4096 + i);
          if (!a) continue;
          for (const o of a) {
            if (o === r || !o.alive || !r.alive) continue;
            // End-on only: one head catching another in the same track. Two
            // heads a channel-width apart merging sideways is the Y-junction,
            // and a pane full of Y-junctions is a fractal tree, not rain.
            const wr = widthOf(r) + widthOf(o);
            if (Math.abs(o.x - r.x) > wr * 0.85 + 1.5) continue;
            if (Math.abs(o.y - r.y) > wr * 2.4 + 7) continue;
            const big = r.vol >= o.vol ? r : o;
            const small = big === r ? o : r;
            const m = big.vol + small.vol;
            big.x = (big.x * big.vol + small.x * small.vol) / m;
            big.y = Math.max(big.y, small.y);
            big.v = (big.v * big.vol + small.v * small.vol) / m + 18;
            big.vol = m;
            small.alive = false;
          }
        }
      }
    }
  }

  function stepWater(dt, t) {
    const g = glassPlate;

    spawnAcc += dt * (1.1 + storm * 2.4);
    while (spawnAcc >= 1) {
      spawnAcc -= 1;
      if (rng.chance(0.62) && beads.length) {
        // A bead that grew too heavy finally lets go.
        let b = null;
        for (let k = 0; k < 24 && !b; k++) {
          const c = beads[rng.int(0, beads.length - 1)];
          if (c.alive && c.r > 4.6) b = c;
        }
        if (b) {
          b.alive = false;
          rivs.push(newRivulet(b.x, b.y, 0.22 + b.r * 0.05));
        }
      } else {
        // Rain lands where it lands. Letting new heads hunt for the wettest
        // column meant every one of them started beside an existing trunk and
        // hooked into it within a few frames — which is what drew the pane as
        // a dendrite. Reuse has to be something water discovers on the way
        // down, not a condition of its birth.
        const vol = rng.chance(0.16) ? rng.range(0.62, 1.35) : rng.range(0.1, 0.44);
        rivs.push(newRivulet(rng() * W, rng.range(-20, 0.12 * H), vol));
      }
    }

    for (const r of rivs) {
      if (!r.alive) continue;
      const w = widthOf(r);

      // Running on wet glass is nothing like running on dry glass: there is
      // no dry film to wet ahead of it, so the head keeps its water and the
      // contact line has far less to catch on. This is what sorts the pane
      // into a hierarchy on its own — a head that finds an established route
      // runs the whole pane, and a head that strikes dry glass beads out
      // within a few hundred pixels.
      const onFilm = clamp(wetAt(r.x, r.y) * 0.85);

      if (r.stall > 0) {
        // Pinned: the contact line is stuck in the hysteresis window and the
        // head waits where it is. It does not creep sideways while it waits —
        // letting it do that is what drew the right-angled steps.
        r.stall -= dt;
        r.v *= 0.5;
      } else {
        r.v += 1500 * dt * (0.26 + r.vol * 1.15) * (1 + onFilm * 0.35);
        r.v *= 0.9;
        if (rng.chance((0.02 + 0.06 * (1 - r.vol)) * (1 - onFilm * 0.65))) r.stall = rng.range(0.04, 0.5);
      }

      const dy = r.v * dt;
      // Sideways motion is a *slope*, not a speed. A rivulet wanders as it
      // descends; how far it strays is set by how far it has fallen, so it
      // can never run out horizontally, and the film pull can bend it into a
      // neighbouring channel without ever turning the path into a staircase.
      const wob = noise.noise2D(r.y * 0.0026, r.wob) + noise.noise2D(r.y * 0.011, r.wob + 9) * 0.3;
      // A weak, short-range nudge. At the old gain a head could see a
      // channel most of a centimetre away and turn into it in a few frames,
      // which reads as a decision rather than as drift; now convergence takes
      // most of a pane, which is how long it takes on a real window.
      const slope = clamp(wob * r.wig * 0.022 + filmPull(r.x, r.y + dy + w * 4, 22) * 0.5, -0.44, 0.44);
      const nx = r.x + slope * (dy + 0.3);
      const ny = r.y + dy;

      r.vol += eatBeads(g, nx, ny, w * 1.2);
      r.vol -= layTrack(g, r, r.x, r.y, nx, ny, w, r.v, clamp(r.vol));
      r.vol -= Math.hypot(nx - r.x, ny - r.y) * 0.0012 * (0.45 + w * 0.1) * (1 - onFilm * 0.8);

      r.x = nx;
      r.y = ny;
      if (r.vol < 0.055) {
        // Too little water left to drag the contact line any further: it pins
        // for good, and what is left of it stays on the glass as a drop. Most
        // tracks end this way, which is why the pane fills with short stubs
        // and only a few runs reach the sill.
        addBead(g, r.x, r.y, Math.max(1.2, w * 1.2));
        r.alive = false;
      } else if (r.y > sillY(r.x) - 4 || r.x < -30 || r.x > W + 30) {
        r.alive = false;
      }
    }

    mergeRivulets();
    for (let i = rivs.length - 1; i >= 0; i--) if (!rivs[i].alive) rivs.splice(i, 1);

    // The film dries back very slowly, so a trunk route stays attractive for
    // a long time but the pane does not end up uniformly wet.
    for (let i = 0; i < wet.length; i++) wet[i] *= 0.9988;

    healGlass();
    healTick = (healTick + 1) % HEAL_BANDS;

    stepLeaves(dt, t);
  }

  function drawHeads() {
    for (const r of rivs) {
      const w = (0.8 + r.vol * 4.6) * r.ws;
      p.fill(withAlpha(C.waterDk, 0.3));
      p.ellipse(r.x, r.y + w * 0.2, w * 2.0, w * 2.7);
      p.fill(withAlpha(C.beadHi, 0.42));
      p.ellipse(r.x - w * 0.3, r.y - w * 0.45, w * 0.85, w * 0.8);
      p.fill(withAlpha('#ffffff', 0.55));
      p.ellipse(r.x - w * 0.38, r.y - w * 0.55, w * 0.3, w * 0.28);
    }
  }

  /* ------------------------------- leaves ------------------------------- */

  const leaves = [];

  function newLeaf(x, y, size) {
    return {
      x,
      y,
      size,
      rot: rng.jitter(0.7),
      wob: rng.range(0, 100)
    };
  }

  /** A caught leaf holds where it landed; it only trembles in the gusts. */
  function stepLeaves(dt, t) {
    for (const L of leaves) L.rot += Math.sin(t * 4.1 + L.wob) * 0.0016 * gust(t);
  }

  const LOBE_A = [-1.19, -0.62, 0, 0.62, 1.19];
  const LOBE_R = [0.66, 0.9, 1.0, 0.9, 0.66];

  function leafOutline(g, L, r) {
    const vx = (a, rr) => {
      const th = L.rot + a;
      g.vertex(L.x + Math.cos(th) * rr * r, L.y + Math.sin(th) * rr * r);
    };
    g.beginShape();
    g.vertex(L.x, L.y);
    vx(-1.62, 0.3);
    for (let i = 0; i < 5; i++) {
      if (i > 0) vx((LOBE_A[i - 1] + LOBE_A[i]) / 2, 0.36);
      vx(LOBE_A[i] - 0.13, LOBE_R[i] * 0.72);
      vx(LOBE_A[i] - 0.05, LOBE_R[i] * 0.94);
      vx(LOBE_A[i], LOBE_R[i]);
      vx(LOBE_A[i] + 0.05, LOBE_R[i] * 0.94);
      vx(LOBE_A[i] + 0.13, LOBE_R[i] * 0.72);
    }
    vx(1.62, 0.3);
    g.endShape(g.CLOSE);
  }

  function drawLeaves() {
    for (const L of leaves) {
      const r = L.size;
      // Water piled against the leaf's lower edge.
      p.noStroke();
      p.fill(withAlpha(C.waterDk, 0.055));
      p.ellipse(L.x + Math.cos(L.rot) * r * 0.45, L.y + Math.sin(L.rot) * r * 0.45 + r * 0.18, r * 1.7, r * 0.8);

      p.fill(mixC(C.leaf, C.leafDk, 0.42));
      leafOutline(p, L, r);

      // Veins and a shaded half give it a surface instead of a silhouette.
      p.stroke(withAlpha(C.leafDk, 0.55));
      p.strokeWeight(Math.max(0.7, r * 0.014));
      for (let i = 0; i < 5; i++) {
        const th = L.rot + LOBE_A[i];
        p.line(L.x, L.y, L.x + Math.cos(th) * LOBE_R[i] * r * 0.9, L.y + Math.sin(th) * LOBE_R[i] * r * 0.9);
      }
      p.stroke(withAlpha(C.leafDk, 0.8));
      p.strokeWeight(Math.max(0.9, r * 0.02));
      p.line(L.x, L.y, L.x - Math.cos(L.rot) * r * 0.75, L.y - Math.sin(L.rot) * r * 0.75);
      p.noStroke();

      // Wet highlight along the upper edge, and the mist reclaiming it.
      p.fill(withAlpha(C.leafHi, 0.3));
      p.ellipse(L.x + Math.cos(L.rot + 0.4) * r * 0.35, L.y + Math.sin(L.rot + 0.4) * r * 0.35 - r * 0.12, r * 0.5, r * 0.3);
      p.fill(withAlpha(C.mist, 0.1));
      leafOutline(p, L, r * 1.02);
    }
  }

  /* ---------------------------- frame and grain -------------------------- */

  let framePlate;
  let leftPlate;
  let overlayPlate;
  const FRAME_Y = H * 0.78;
  const LEFT_W = W * 0.12;
  const LEFT_Y = 0;

  function paintFrame(g) {
    g.translate(0, -FRAME_Y);
    for (let x = 0; x < W; x += 2) {
      const y = sillY(x);
      g.fill(mixC(C.sillHi, C.sill, 0.25));
      g.rect(x, y, 3, 9);
      g.fill(C.sill);
      g.rect(x, y + 9, 3, 12);
      g.fill(C.sillDk);
      g.rect(x, y + 21, 3, 7);
      g.fill(mixC(C.wood, C.woodMid, 0.4));
      g.rect(x, y + 28, 3, 16);
      g.fill(C.wood);
      g.rect(x, y + 44, 3, H - y);
    }
    // Wood grain and the shadowed inner face of the frame.
    // The frame falls away from the sill into shadow.
    for (let y = 0; y < H - FRAME_Y; y += 3) {
      const yy = FRAME_Y + y;
      const u = clamp(map(yy, sillY(W * 0.5) + 40, H, 0, 1));
      g.fill(withAlpha('#0d0906', 0.5 * smootherstep(0, 1, u)));
      g.rect(0, yy, W, 4);
    }
    for (let i = 0; i < 260; i++) {
      const x = rng() * W;
      const y = sillY(x) + 46 + rng.skew(1.2) * (H - sillY(x) - 46);
      const l = rng.range(80, 420);
      g.stroke(withAlpha(rng.chance(0.45) ? C.woodHi : '#120d09', rng.range(0.03, 0.16)));
      g.strokeWeight(rng.range(1.2, 5));
      g.line(x, y, x + l, y + rng.jitter(2));
      g.noStroke();
    }
    // Water standing on the sill.
    for (let i = 0; i < 220; i++) {
      const x = rng() * W;
      const y = sillY(x) + rng.range(1, 26);
      g.fill(withAlpha(rng.chance(0.4) ? '#ffffff' : C.sillDk, rng.range(0.1, 0.5)));
      const s = rng.range(1, 4.5);
      g.ellipse(x, y, s, s * 0.8);
    }
    g.resetMatrix();
  }

  function paintLeft(g) {
    g.translate(0, -LEFT_Y);
    for (let y = LEFT_Y + 2; y < H * 0.9; y += 2) {
      const w = lerp(0, 44, smoothstep(H * 0.3, H * 0.96, y));
      g.fill(C.wood);
      g.rect(0, y, w, 3);
      g.fill(withAlpha(C.woodHi, 0.35));
      g.rect(w - 2, y, 2.4, 3);
      // The wet glazing bead just inside the frame catches the sky.
      g.fill(withAlpha('#b6bcbb', 0.28 * smoothstep(H * 0.62, H * 0.88, y)));
      g.rect(w + 0.5, y, 2.5, 3);
    }
    g.resetMatrix();
  }

  function paintOverlay(g) {
    g.loadPixels();
    const px = g.pixels;
    let s = (ctx.seed | 0) >>> 0 || 1;
    for (let y = 0; y < H; y++) {
      const dy = (y / H - 0.48) * 2;
      for (let x = 0; x < W; x++) {
        const dx = (x / W - 0.5) * 2;
        const d = Math.sqrt(dx * dx * 1.05 + dy * dy * 0.62);
        const vign = clamp((d - 0.66) * 1.05) * 74;
        s ^= s << 13;
        s ^= s >>> 17;
        s ^= s << 5;
        const n = ((s >>> 0) / 4294967296) * 2 - 1;
        const grainDark = Math.max(0, -n) * 15;
        const grainLite = Math.max(0, n) * 12;
        const i = 4 * (y * W + x);
        if (vign + grainDark >= grainLite) {
          px[i] = 26;
          px[i + 1] = 26;
          px[i + 2] = 24;
          px[i + 3] = vign + grainDark;
        } else {
          px[i] = 255;
          px[i + 1] = 255;
          px[i + 2] = 252;
          px[i + 3] = grainLite;
        }
      }
    }
    g.updatePixels();
  }

  /* ------------------------------- compose ------------------------------ */

  const WARM = 260;

  /**
   * Everything the seed and the weather decide, from scratch. Re-seeding at
   * the top is what makes the storm slider mean something: the parameter under
   * test changes and nothing else does.
   */
  function build() {
    plateIdx = 0;
    OSC.length = 0;
    fogBanks.length = 0;
    beads.length = 0;
    beadGrid.clear();
    filmAlpha = null;
    healTick = 0;
    rivs.length = 0;
    leaves.length = 0;
    spawnAcc = 0;
    wet.fill(0);

    rng = createRandom(ctx.seed);
    rollWeather();

    skyPlate = newPlate(W, H);
    paintSky(skyPlate);

    buildForest();

    glassPlate = newPlate(W, H);
    glassPlate.strokeCap(glassPlate.ROUND);
    paintGlass(glassPlate);

    framePlate = newPlate(W, H - FRAME_Y);
    paintFrame(framePlate);
    leftPlate = newPlate(LEFT_W, H * 0.9);
    paintLeft(leftPlate);
    overlayPlate = newPlate(W, H);
    paintOverlay(overlayPlate);

    // The hero leaf: the one warm mark in the void, and the reason the top
    // half of the frame is allowed to be empty.
    leaves.push(newLeaf(W * 0.245, H * 0.508, W * 0.062));

    for (let i = 0; i < WARM; i++) {
      stepWind(DT, i * DT);
      stepWater(DT, i * DT);
    }
  }

  p.setup = () => {
    p.createCanvas(W, H);
    p.noStroke();
    p.strokeCap(p.ROUND);
    p.ellipseMode(p.CENTER);
    build();
  };

  p.draw = () => {
    const t = (WARM + p.frameCount) * DT;
    stepWind(DT, t);
    stepWater(DT, t);

    p.image(skyPlate, 0, 0);
    blitLayer(farMass, t);
    drawFogBanks(t, 0);
    blitLayer(midMass, t);
    blitLayer(midTrees, t);
    drawFogBanks(t, 1);
    blitLayer(nearTrees, t);
    blitLayer(frontLeft, t);
    blitLayer(frontRight, t);
    blitLayer(shrub, t);

    p.image(glassPlate, 0, 0);
    drawHeads();
    drawLeaves();

    p.image(framePlate, 0, FRAME_Y);
    p.image(leftPlate, 0, LEFT_Y);
    p.image(overlayPlate, 0, 0);
  };

  if (ctx.pane) {
    const params = { storm };
    ctx.pane.addBinding(params, 'storm', { min: 0.3, max: 1, step: 0.01 }).on('change', (ev) => {
      stormOverride = ev.value;
      build();
    });
  }
}

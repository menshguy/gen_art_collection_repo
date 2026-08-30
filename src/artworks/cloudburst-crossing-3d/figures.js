/**
 * The people.
 *
 * These are drawings, not models. The reference is a sketchbook page of
 * ink-and-watercolour caricatures — enormous noses in profile, round glasses
 * with no eyes behind them, heavy jowls, potbellies, short legs, small feet —
 * and no amount of geometry and lighting was going to arrive there. So each
 * figure is generated as a pen drawing: a caricature rig posed through a walk
 * cycle, drawn frame by frame into a sprite atlas, and hung on a billboard in
 * the street.
 *
 * Two consequences shape everything below.
 *
 * The figures are drawn in **profile**, and the billboard turns about Y only.
 * That is not a limitation to work around — it is why the scene is a crossing.
 * People walk across the view, which is exactly the angle the sketches are
 * drawn from, and a profile caricature reads at a fraction of the pixels a
 * three-quarter view would need.
 *
 * And the walk cycle is baked into an **atlas**, not redrawn per frame. Twelve
 * poses per figure are drawn once at startup and animated by shifting UVs, so
 * the per-frame cost of a crowd is a UV offset each.
 */

import * as THREE from 'three';
import { ink, inkContour, wash, paper, hatch } from './ink.js';

export const FRAMES = 12;
const COLS = 4;
const ROWS = 3;
const CELL_ASPECT = 0.58;

/* ------------------------------- palette -------------------------------- */

// Sampled from the reference: warm ochre skin, cool grey cloth, one rust head
// of hair, black ink, cream paper. Deliberately tiny — the sketches get all
// their colour interest out of five pigments and the white of the page.
const SKIN = ['#e0a875', '#eebc84', '#d99f6d', '#e8b478'];
const CLOTH = ['#7b838f', '#949ba4', '#69727e', '#a0a6ad', '#5d6672'];
const HAIR = ['#a5462e', '#8d4526', '#3d3833', '#7a726a', '#c2bdb4'];
const PAPER = '#f2ede2';
const INK = '#0d0b09';

/* ------------------------------ the spec -------------------------------- */

/**
 * One person, decided up front.
 *
 * Correlated, not independently random: a stout build gets a bigger belly,
 * shorter legs and a heavier jaw together, because that is one caricature
 * decision rather than four unrelated dice rolls.
 */
export function figureSpec(rng) {
  const stout = rng.chance(0.55);
  const bulk = stout ? rng.range(0.55, 1.0) : rng.range(0.05, 0.4);
  return {
    stout,
    bulk,
    height: rng.range(1.62, 1.84),               // metres, drives sprite scale
    legs: 0.44 - bulk * 0.05,                    // hip height as a fraction
    headScale: 1.0 + bulk * 0.12,
    nose: rng.range(0.9, 1.45),                  // the caricature's whole point
    jowl: 0.4 + bulk * 0.75,
    bald: rng.chance(0.3),
    hair: rng.pick(HAIR),
    hairMass: rng.range(0.6, 1.5),
    moustache: rng.chance(0.4),
    beard: rng.chance(0.28),
    glasses: rng.weighted(['round', 'rect', null], [4, 3, 3]),
    skin: rng.pick(SKIN),
    coat: rng.pick(CLOTH),
    coatShade: rng.pick(CLOTH),
    trouser: rng.pick(CLOTH),
    coatLen: rng.range(0.06, 0.24),              // below the hip
    shoe: rng.chance(0.5) ? INK : '#3b3229',
    umbrella: rng.chance(0.55),
    umbrellaColor: rng.weighted([INK, '#5c6672', '#7a3f33', '#43505c'], [3, 2, 1, 2]),
    stride: rng.range(0.30, 0.46),
    lean: rng.range(0.02, 0.14),
    bounce: rng.range(0.6, 1.3),
    cadence: rng.range(0.85, 1.2)
  };
}

/* -------------------------------- rigging -------------------------------- */

/** Two-bone IK. `bend` picks which way the joint buckles. */
function ik2(ax, ay, bx, by, l1, l2, bend) {
  const dx = bx - ax;
  const dy = by - ay;
  let d = Math.hypot(dx, dy);
  d = Math.min(d, (l1 + l2) * 0.999);
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  const ux = dx / (d || 1);
  const uy = dy / (d || 1);
  return [ax + ux * a - uy * h * bend, ay + uy * a + ux * h * bend];
}

const smoothstep01 = (t) => t * t * (3 - 2 * t);

/**
 * The foot's path over one cycle, in figure units.
 *
 * Driven from the foot rather than from joint angles, because the one thing
 * a walk cycle must not do is let the planted foot slide or float. Stance is
 * the ground pushing past underneath; swing is a lift and a reach.
 */
function footPath(phase, stride, lift) {
  const ph = phase - Math.floor(phase);
  const STANCE = 0.62;
  if (ph < STANCE) {
    const u = ph / STANCE;
    return [stride * (0.5 - u), 0, 1];   // x, height, planted
  }
  const u = (ph - STANCE) / (1 - STANCE);
  return [stride * (u === 0 ? -0.5 : -0.5 + smoothstep01(u)), lift * Math.sin(Math.PI * u), 0];
}

/* ------------------------------- drawing --------------------------------- */

/**
 * The head. This is where the likeness lives, so it gets the most control
 * points: a shallow forehead, a brow that overhangs, a nose that leaves the
 * face entirely, a short upper lip, and a jaw that keeps going.
 */
function drawHead(ctx, spec, rng, { x, y, h, tilt }) {
  const n = spec.nose;
  const j = spec.jowl;

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(tilt);

  // The head, in units of its own height, origin where it meets the neck and
  // facing +x. Everything here is a caricature decision, and two of them
  // matter more than the rest:
  //
  //   the skull is as long as it is tall — a wide flat cranium reads as a
  //   helmet, and the reference heads are domes;
  //
  //   the nose is a *ball on a bridge*, not a projection. It leaves the face
  //   at the bridge, swells, and hangs below the nostril line, ending only a
  //   little further forward than the chin. A tip that reaches well past the
  //   chin at brow height is a duck's bill, which is exactly what the first
  //   two attempts drew.
  const outline = [
    [-h * 0.30, h * 0.10],                              // neck, back
    [-h * 0.52, -h * 0.14],
    [-h * 0.57, -h * 0.48],
    [-h * 0.44, -h * 0.80],
    [-h * 0.20, -h * 0.98],
    [h * 0.06, -h * 1.02],                              // crown
    [h * 0.26, -h * 0.94],
    [h * 0.33, -h * 0.74],                              // brow ridge
    [h * 0.35, -h * 0.62],
    [h * 0.26, -h * 0.545],                             // bridge notch
    [h * 0.36, -h * 0.475],
    [h * (0.44 + 0.06 * n), -h * 0.415],                // the ball of the nose
    [h * (0.50 + 0.10 * n), -h * 0.350],
    [h * (0.50 + 0.10 * n), -h * 0.290],
    [h * (0.42 + 0.05 * n), -h * 0.250],
    [h * 0.33, -h * 0.245],                             // nostril, tucked back
    [h * 0.315, -h * 0.215],
    // The lower face has to come *forward*, nearly to the nose tip. Leave it
    // set back and the nose plus a flat lip read as one horizontal wedge —
    // which is how a caricature nose turns into a duck's bill.
    [h * 0.42, -h * 0.175],                             // upper lip
    [h * 0.34, -h * 0.125],                             // mouth
    [h * 0.43, -h * 0.070],                             // lower lip
    [h * 0.34, -h * 0.025],                             // crease beneath it
    [h * 0.45, h * 0.035],                              // chin
    [h * (0.30 + 0.10 * j), h * (0.15 + 0.05 * j)],
    [h * (0.00 + 0.10 * j), h * (0.22 + 0.06 * j)],     // jowl
    [-h * 0.20, h * 0.17]
  ];
  paper(ctx, outline, rng, { color: PAPER, slip: 1.1 });
  wash(ctx, outline, rng, { color: spec.skin, alpha: 0.8, slip: h * 0.035, rim: 0.55, dry: 0.5 });
  // A second pass pooled under the brow and along the jaw. The sketches build
  // form by letting one pigment overlap itself, never by shading in grey.
  wash(ctx, [
    [-h * 0.02, -h * 0.60], [h * 0.30, -h * 0.52], [h * (0.44 + 0.08 * n), -h * 0.33],
    [h * 0.38, -h * 0.07], [h * 0.10, h * 0.16], [-h * 0.24, h * 0.02]
  ], rng, { color: spec.skin, alpha: 0.46, slip: h * 0.03, rim: 0.6, dry: 0.55 });

  const heavy = h * 0.072;
  inkContour(ctx, outline, rng, { weight: heavy, wobble: h * 0.006, swell: 0.5, breaks: 2, color: INK });

  // Ear: a hook, never a shape.
  ink(ctx, [
    [-h * 0.08, -h * 0.50], [-h * 0.22, -h * 0.45], [-h * 0.24, -h * 0.28], [-h * 0.08, -h * 0.26]
  ], rng, { weight: heavy * 0.6, wobble: h * 0.004, color: INK });

  // Glasses: a heavy ring with nothing behind it, which is how every face on
  // the reference page reads. The eye is a dot at most, and often absent.
  if (spec.glasses) {
    const cx = h * 0.13;
    const cy = -h * 0.655;
    const r = h * 0.185;
    if (spec.glasses === 'round') {
      const circle = Array.from({ length: 16 }, (_, i) => {
        const a = (i / 16) * Math.PI * 2;
        return [cx + Math.cos(a) * r, cy + Math.sin(a) * r * 1.04];
      });
      inkContour(ctx, circle, rng, { weight: heavy * 0.9, wobble: h * 0.004, swell: 0.45, breaks: 1, color: INK });
      // Behind the lens: a wash of skin, and — sometimes — a single dot.
      // The reference faces are mostly eyeless, and the ones that aren't get
      // one mark, never a drawn eye.
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = spec.skin;
      ctx.beginPath();
      ctx.ellipse(cx + r * 0.15, cy + r * 0.1, r * 0.55, r * 0.45, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      if (rng.chance(0.55)) {
        ctx.save();
        ctx.fillStyle = INK;
        ctx.beginPath();
        ctx.ellipse(cx + r * 0.35, cy + r * 0.12, r * 0.19, r * 0.17, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    } else {
      inkContour(ctx, [
        [cx - r * 1.05, cy - r * 0.62], [cx + r * 1.1, cy - r * 0.7],
        [cx + r * 1.05, cy + r * 0.6], [cx - r, cy + r * 0.52]
      ], rng, { weight: heavy * 1.1, wobble: h * 0.003, breaks: 1, color: INK });
    }
    ink(ctx, [[cx + r * 1.0, cy - r * 0.1], [h * 0.30, -h * 0.56]], rng, { weight: heavy * 0.45, color: INK });
    ink(ctx, [[cx - r * 1.0, cy - r * 0.12], [-h * 0.12, -h * 0.50]], rng, { weight: heavy * 0.4, color: INK });
  }

  // The brow line and a crease or two: the marks that make it a face.
  ink(ctx, [[h * 0.02, -h * 0.82], [h * 0.26, -h * 0.76]], rng, {
    weight: heavy * 0.45, taperOut: 0.6, wobble: h * 0.004, color: INK
  });
  // Nostril, and the mouth. Two marks, and the face has an expression.
  ink(ctx, [[h * (0.34 + 0.04 * n), -h * 0.262], [h * (0.42 + 0.05 * n), -h * 0.252]], rng, {
    weight: heavy * 0.75, taperIn: 0.3, taperOut: 0.3, color: INK
  });
  ink(ctx, [[h * 0.22, -h * 0.145], [h * 0.40, -h * 0.128]], rng, {
    weight: heavy * 0.55, taperIn: 0.25, taperOut: 0.45, color: INK
  });

  if (spec.moustache) {
    hatch(ctx, h * 0.26, -h * 0.175, rng, {
      count: 11, len: h * 0.10, spread: h * 0.24, angle: 0.5, jitter: 0.55,
      weight: heavy * 0.6, color: INK
    });
  }
  if (spec.beard) {
    hatch(ctx, h * 0.24, -h * 0.02, rng, {
      count: 13, len: h * 0.09, spread: h * 0.34, angle: 1.25, jitter: 0.8,
      weight: heavy * 0.5, color: spec.hair
    });
  }

  // Hair: a wash for the mass, ticks for the edge. A bald head keeps the
  // ticks above the ear, which is most of the joke.
  const m = spec.hairMass;
  if (!spec.bald) {
    wash(ctx, [
      [-h * 0.58, -h * 0.50], [-h * 0.46, -h * 0.82], [-h * 0.16, -h * 1.04],
      [h * 0.20, -h * 0.98], [h * 0.12, -h * 0.84], [-h * 0.24, -h * 0.78],
      [-h * 0.46, -h * 0.60]
    ], rng, { color: spec.hair, alpha: 0.72, slip: h * 0.03, rim: 0.55, dry: 0.5 });
    hatch(ctx, -h * 0.14, -h * 1.00, rng, {
      count: Math.round(11 * m), len: h * 0.16 * m, spread: h * 0.72, angle: -1.35, jitter: 0.9,
      weight: heavy * 0.6, color: spec.hair
    });
  }
  hatch(ctx, -h * 0.46, -h * 0.58, rng, {
    count: Math.round(5 * m), len: h * 0.13 * m, spread: h * 0.22, angle: -2.5, jitter: 0.8,
    weight: heavy * 0.55, color: spec.bald ? spec.hair : INK
  });

  ctx.restore();
}

/**
 * A limb as a *shape*, not as a thick line.
 *
 * The first attempt drew arms and legs as heavy tapered strokes, and they came
 * out as black sticks: at this scale a stroke wide enough to read is wide
 * enough to swallow its own interior. A trouser leg in the reference is a pale
 * wash with a line down either side of it, so that is what this builds — a
 * polygon offset from the bone, washed, then contoured.
 */
function tube(joints, widths) {
  const left = [];
  const right = [];
  for (let i = 0; i < joints.length; i++) {
    const [x, y] = joints[i];
    const [px, py] = joints[Math.min(i + 1, joints.length - 1)];
    const [qx, qy] = joints[Math.max(i - 1, 0)];
    let nx = -(py - qy);
    let ny = px - qx;
    const n = Math.hypot(nx, ny) || 1;
    nx /= n;
    ny /= n;
    const w = widths[i];
    left.push([x + nx * w, y + ny * w]);
    right.push([x - nx * w, y - ny * w]);
  }
  return [...left, ...right.reverse()];
}

function drawTube(ctx, rng, joints, widths, { color, alpha = 0.7, weight = 3, blank = true }) {
  const poly = tube(joints, widths);
  if (blank) paper(ctx, poly, rng, { color: PAPER, slip: 1.0, alpha: 0.95 });
  wash(ctx, poly, rng, { color, alpha, slip: weight * 1.1, rim: 0.5, dry: 0.35 });
  inkContour(ctx, poly, rng, { weight, wobble: weight * 0.22, swell: 0.5, breaks: 2, color: INK });
}

/** A shoe: a low wedge, always the heaviest black on the figure. */
function drawShoe(ctx, rng, [ax, ay], size, color, forward) {
  const s = size;
  const poly = [
    [ax - s * 0.55 * forward, ay - s * 0.75],
    [ax + s * 1.05 * forward, ay - s * 0.30],
    [ax + s * 1.35 * forward, ay + s * 0.28],
    [ax + s * 0.6 * forward, ay + s * 0.42],
    [ax - s * 0.7 * forward, ay + s * 0.34]
  ];
  paper(ctx, poly, rng, { color, slip: 1.1 });
  inkContour(ctx, poly, rng, { weight: s * 0.45, wobble: s * 0.06, breaks: 1, color: INK });
}

/** A hand: a blunt mitten. Fingers never survive this scale anyway. */
function drawHand(ctx, rng, [hx, hy], size, color) {
  const poly = Array.from({ length: 9 }, (_, i) => {
    const a = (i / 9) * Math.PI * 2;
    return [hx + Math.cos(a) * size * (0.85 + rng() * 0.35), hy + Math.sin(a) * size * (0.7 + rng() * 0.3)];
  });
  paper(ctx, poly, rng, { color: PAPER, slip: 0.8 });
  wash(ctx, poly, rng, { color, alpha: 0.7, slip: size * 0.3, rim: 0.5, dry: 0 });
  inkContour(ctx, poly, rng, { weight: size * 0.55, wobble: size * 0.1, breaks: 1, color: INK });
}

/**
 * One pose, drawn into the current cell.
 * The figure faces +x; the atlas is mirrored in the shader for the other way.
 */
function drawPose(ctx, spec, rng, phase, H, CELL_W, CELL_H) {
  const G = CELL_H - 12;              // ground line inside the cell
  const cx = CELL_W * 0.44;
  const hipY = G - H * spec.legs;
  const shY = G - H * 0.735;
  const headH = H * 0.255 * spec.headScale;

  const bob = Math.cos(4 * Math.PI * phase) * H * 0.012 * spec.bounce;
  const sway = Math.sin(2 * Math.PI * phase) * H * 0.010;
  const lean = spec.lean;

  const thigh = (G - hipY) * 0.50;
  const shin = (G - hipY) * 0.52;
  const stride = H * spec.stride;
  const lift = H * 0.05;

  const hip = [cx + sway * 0.4, hipY + bob];
  const shoulder = [cx + sway * 0.4 + lean * H * 0.55, shY + bob];

  const legW = H * (0.036 + spec.bulk * 0.014);
  const shoeSize = H * 0.030;

  const drawLeg = (ph, near) => {
    const [fx, fh] = footPath(ph, stride, lift);
    const ankle = [hip[0] + fx, G - fh - shoeSize * 0.55];
    const knee = ik2(hip[0], hip[1], ankle[0], ankle[1], thigh, shin, 1);
    ctx.save();
    ctx.globalAlpha = near ? 1 : 0.82;
    drawTube(ctx, rng, [hip, knee, ankle], [legW * 1.35, legW, legW * 0.78], {
      color: spec.trouser, alpha: near ? 0.95 : 0.82, weight: H * 0.021
    });
    drawShoe(ctx, rng, ankle, shoeSize, spec.shoe, 1);
    ctx.restore();
  };

  drawLeg(phase + 0.5, false);
  drawLeg(phase, true);

  /* ------------------------------ torso ------------------------------- */

  // Sloped shoulders, a collar, and a belly that arrives before the hip:
  // three decisions that turn a rounded rectangle into a body.
  const belly = 0.085 + spec.bulk * 0.070;
  const coatDrop = H * spec.coatLen;
  const torso = [
    [shoulder[0] - H * 0.030, shoulder[1] - H * 0.045],   // collar, back
    [shoulder[0] + H * 0.048, shoulder[1] - H * 0.042],   // collar, front
    [shoulder[0] + H * 0.090, shoulder[1] + H * 0.020],   // shoulder drop
    [shoulder[0] + H * 0.104, shoulder[1] + H * 0.115],
    [hip[0] + H * belly, hip[1] - H * 0.055],             // belly
    [hip[0] + H * (belly * 0.80), hip[1] + coatDrop],
    [hip[0] - H * 0.088, hip[1] + coatDrop * 0.9],
    [hip[0] - H * 0.100, hip[1] - H * 0.10],
    [shoulder[0] - H * 0.112, shoulder[1] + H * 0.10],
    [shoulder[0] - H * 0.092, shoulder[1] + H * 0.010]
  ];
  paper(ctx, torso, rng, { color: PAPER, slip: 1.2 });
  wash(ctx, torso, rng, { color: spec.coat, alpha: 0.94, slip: H * 0.020, rim: 0.5, dry: 0.45 });
  inkContour(ctx, torso, rng, { weight: H * 0.030, wobble: H * 0.004, swell: 0.45, breaks: 2, color: INK });

  // A lapel or a placket, and one fold. More than that and the wash stops
  // reading as watercolour and starts reading as line art with a tint.
  ink(ctx, [
    [shoulder[0] + H * 0.030, shoulder[1] - H * 0.030],
    [shoulder[0] + H * 0.072, shoulder[1] + H * 0.075],
    [hip[0] + H * belly * 0.80, hip[1] - H * 0.030]
  ], rng, { weight: H * 0.011, wobble: H * 0.004, taperOut: 0.5, color: INK });
  ink(ctx, [
    [hip[0] - H * 0.045, hip[1] + H * 0.015],
    [hip[0] + H * 0.020, hip[1] + coatDrop * 0.75]
  ], rng, { weight: H * 0.009, wobble: H * 0.005, taperIn: 0.4, color: INK });

  /* ------------------------------- head ------------------------------- */

  drawHead(ctx, spec, rng, {
    x: shoulder[0] + H * 0.012,
    y: shoulder[1] - H * 0.020,
    h: headH,
    tilt: -0.08 - lean * 0.8 + Math.sin(2 * Math.PI * phase) * 0.03
  });

  /* ------------------------------- arms -------------------------------- */

  const upper = H * 0.150;
  const fore = H * 0.145;
  const armW = H * 0.030 + spec.bulk * H * 0.008;

  const drawArm = (ph, near, holdUp) => {
    const sh = [shoulder[0] - H * 0.010, shoulder[1] + H * 0.055];
    let hand;
    if (holdUp) {
      // Holding the umbrella: the hand parks in front of the chest and the
      // shaft rises out of it, so the pose stops being a walk cycle and
      // becomes someone sheltering.
      hand = [sh[0] + H * 0.105, sh[1] + H * 0.150];
    } else {
      const a = -Math.sin(2 * Math.PI * ph) * 0.62;
      hand = [sh[0] + Math.sin(a) * (upper + fore) * 0.90, sh[1] + Math.cos(a * 0.5) * (upper + fore) * 0.86];
    }
    const elbow = ik2(sh[0], sh[1], hand[0], hand[1], upper, fore, -1);
    ctx.save();
    ctx.globalAlpha = near ? 1 : 0.72;
    drawTube(ctx, rng, [sh, elbow, hand], [armW * 1.1, armW * 0.85, armW * 0.62], {
      color: near ? spec.coat : spec.coatShade, alpha: near ? 0.9 : 0.86, weight: H * 0.019, blank: near
    });
    drawHand(ctx, rng, hand, H * 0.022, spec.skin);
    ctx.restore();
    return hand;
  };

  drawArm(phase + 0.5, false, false);
  const frontHand = drawArm(phase, true, spec.umbrella);

  /* ----------------------------- umbrella ------------------------------ */

  if (spec.umbrella) {
    const top = [frontHand[0] - H * 0.04, frontHand[1] - H * 0.44];
    const span = H * 0.30;
    const rise = H * 0.17;

    // A dome, built as an arc out and a scalloped hem back: the scallop is
    // what says fabric stretched over ribs rather than a mushroom cap.
    const arc = [];
    for (let i = 0; i <= 8; i++) {
      const u = i / 8;
      const a = Math.PI * (1 - u);
      arc.push([top[0] + Math.cos(a) * span, top[1] - Math.sin(a) * rise + Math.pow(Math.abs(u - 0.5) * 2, 2) * H * 0.045]);
    }
    const hem = [];
    for (let i = 8; i >= 0; i--) {
      const u = i / 8;
      const x = top[0] + (u * 2 - 1) * span;
      const sag = Math.sin(u * Math.PI * 4) * H * 0.030;
      hem.push([x, top[1] + H * 0.055 - Math.cos((u - 0.5) * Math.PI) * H * 0.035 + sag]);
    }
    const canopy = [...arc, ...hem.slice(1, -1)];

    ink(ctx, [[frontHand[0], frontHand[1] + H * 0.02], [top[0], top[1] - rise - H * 0.03]], rng, {
      weight: H * 0.011, taperIn: 0.05, taperOut: 0.05, swell: 0.25, color: INK
    });
    paper(ctx, canopy, rng, { color: PAPER, slip: 1.3 });
    wash(ctx, canopy, rng, { color: spec.umbrellaColor, alpha: 0.93, slip: H * 0.018, rim: 0.5, dry: 0.35 });
    inkContour(ctx, canopy, rng, { weight: H * 0.026, wobble: H * 0.005, swell: 0.45, breaks: 1, color: INK });
    // Ribs, and the crook of the handle.
    for (const u of [0.25, 0.5, 0.75]) {
      const x = top[0] + (u * 2 - 1) * span;
      ink(ctx, [[top[0], top[1] - rise * 0.5], [x, top[1] + H * 0.04]], rng, {
        weight: H * 0.005, taperIn: 0.35, taperOut: 0.6, color: INK
      });
    }
    ink(ctx, [
      [frontHand[0], frontHand[1] + H * 0.02],
      [frontHand[0] + H * 0.022, frontHand[1] + H * 0.085],
      [frontHand[0] - H * 0.048, frontHand[1] + H * 0.095]
    ], rng, { weight: H * 0.010, color: INK });
  }
}

/* -------------------------------- atlas ---------------------------------- */

/**
 * Draw one person's whole walk cycle into a single texture.
 *
 * The rng is re-seeded per frame from a fixed offset so the wobble is *stable*
 * across the cycle — otherwise every frame re-rolls its own hand and the
 * figure boils. Same hand, different pose.
 */
export function figureAtlas(spec, makeRng, { cellH = 360 } = {}) {
  // Cell size is a placement decision, not a constant: the figure two metres
  // from the lens needs four times the pixels of the one dissolving into the
  // fog, and giving them all the near figure's resolution would spend most of
  // an artwork's texture budget on people who are forty pixels tall.
  const CELL_H = Math.round(cellH);
  const CELL_W = Math.round(cellH * CELL_ASPECT);
  const canvas = document.createElement('canvas');
  canvas.width = CELL_W * COLS;
  canvas.height = CELL_H * ROWS;
  const ctx = canvas.getContext('2d');
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Room above the head for an umbrella, and below the heel for nothing at
  // all — the sprite is anchored at the ground line, not at the cell.
  const H = CELL_H * 0.70;
  for (let f = 0; f < FRAMES; f++) {
    const col = f % COLS;
    const row = Math.floor(f / COLS);
    ctx.save();
    ctx.translate(col * CELL_W, row * CELL_H);
    ctx.beginPath();
    ctx.rect(0, 0, CELL_W, CELL_H);
    ctx.clip();
    drawPose(ctx, spec, makeRng(), f / FRAMES, H, CELL_W, CELL_H);
    ctx.restore();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  // `foot` is where the ground line sits in the cell, so the scene can hang
  // the sprite by the soles rather than by the centre of a quad.
  return {
    texture: tex, cols: COLS, rows: ROWS,
    cellW: CELL_W, cellH: CELL_H, aspect: CELL_ASPECT,
    figureFrac: H / CELL_H, footFrac: (CELL_H - 12) / CELL_H
  };
}

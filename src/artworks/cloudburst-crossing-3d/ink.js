/**
 * A small pen-and-watercolour kit, drawn into a 2D canvas.
 *
 * The reference sketches are not "a character with an outline". They are two
 * separate media that do not quite agree with each other, and the disagreement
 * is the whole style:
 *
 *   - the **ink** is a nib under uneven pressure. Weight swells and thins
 *     along a single line, contours break rather than closing, ends overshoot
 *     into little hooks, and nothing is drawn twice the same way.
 *   - the **wash** is laid separately and misses. It overshoots the jaw,
 *     stops short of the cuff, pools darker where it dried against an edge,
 *     and leaves bare paper as highlight.
 *
 * Every helper below takes an rng, so a figure's hand-drawn wobble is part of
 * the artwork's seed rather than of `Math.random`.
 */

/** Correlated jitter: a shaky line, not a noisy one. */
function shake(points, amp, rng) {
  // One random walk along the path, so neighbouring points drift together
  // and the stroke reads as an unsteady hand rather than as static.
  let dx = rng.jitter(amp);
  let dy = rng.jitter(amp);
  return points.map(([x, y]) => {
    dx = dx * 0.7 + rng.jitter(amp) * 0.6;
    dy = dy * 0.7 + rng.jitter(amp) * 0.6;
    return [x + dx, y + dy];
  });
}

/** Catmull-Rom resample, so a handful of control points becomes a curve. */
export function smooth(points, steps = 6) {
  if (points.length < 3) return points.slice();
  const out = [];
  const p = [points[0], ...points, points[points.length - 1]];
  for (let i = 1; i < p.length - 2; i++) {
    const [x0, y0] = p[i - 1];
    const [x1, y1] = p[i];
    const [x2, y2] = p[i + 1];
    const [x3, y3] = p[i + 2];
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      const t2 = t * t;
      const t3 = t2 * t;
      out.push([
        0.5 * ((2 * x1) + (-x0 + x2) * t + (2 * x0 - 5 * x1 + 4 * x2 - x3) * t2 + (-x0 + 3 * x1 - 3 * x2 + x3) * t3),
        0.5 * ((2 * y1) + (-y0 + y2) * t + (2 * y0 - 5 * y1 + 4 * y2 - y3) * t2 + (-y0 + 3 * y1 - 3 * y2 + y3) * t3)
      ]);
    }
  }
  out.push(points[points.length - 1]);
  return out;
}

/**
 * One inked line.
 *
 * Filled as a ribbon rather than stroked, because a stroke of constant width
 * is exactly what a nib never gives you. Width is driven by a slow wave along
 * the line plus the ends, so the swell lands somewhere different every time.
 */
export function ink(ctx, pts, rng, {
  weight = 3,
  taperIn = 0.35,
  taperOut = 0.25,
  swell = 0.55,
  wobble = 0.7,
  color = '#15120f',
  hook = 0
} = {}) {
  const path = smooth(shake(pts, wobble, rng), 5);
  if (path.length < 2) return;

  if (hook) {
    // The overshoot at the end of a fast stroke: the nib leaves the paper
    // late and drags a little tail past the corner.
    const [ax, ay] = path[path.length - 2];
    const [bx, by] = path[path.length - 1];
    const len = Math.hypot(bx - ax, by - ay) || 1;
    path.push([bx + ((bx - ax) / len) * hook, by + ((by - ay) / len) * hook + hook * 0.4]);
  }

  const phase = rng() * Math.PI * 2;
  const freq = 1.2 + rng() * 2.4;
  const left = [];
  const right = [];

  for (let i = 0; i < path.length; i++) {
    const t = i / (path.length - 1);
    const [x, y] = path[i];
    const [px, py] = path[Math.min(i + 1, path.length - 1)];
    const [qx, qy] = path[Math.max(i - 1, 0)];
    let nx = -(py - qy);
    let ny = px - qx;
    const n = Math.hypot(nx, ny) || 1;
    nx /= n;
    ny /= n;

    const ends = Math.min(1, t / Math.max(taperIn, 1e-3)) * Math.min(1, (1 - t) / Math.max(taperOut, 1e-3));
    const pressure = 1 + Math.sin(phase + t * freq * Math.PI * 2) * swell;
    const w = (weight * 0.5) * Math.max(0.12, ends) * Math.max(0.25, pressure);

    left.push([x + nx * w, y + ny * w]);
    right.push([x - nx * w, y - ny * w]);
  }

  ctx.beginPath();
  ctx.moveTo(left[0][0], left[0][1]);
  for (let i = 1; i < left.length; i++) ctx.lineTo(left[i][0], left[i][1]);
  for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i][0], right[i][1]);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

/** A closed inked contour, deliberately left open in one or two places. */
export function inkContour(ctx, pts, rng, opts = {}) {
  const { breaks = 1, ...rest } = opts;
  const closed = [...pts, pts[0]];
  const path = smooth(closed, 5);
  const n = path.length;
  if (breaks <= 0) {
    ink(ctx, path, rng, { ...rest, taperIn: 0.02, taperOut: 0.02 });
    return;
  }
  // Cut the loop into arcs with gaps at random places: a contour that never
  // quite closes is the single clearest signature of a quick pen drawing.
  const cuts = Array.from({ length: breaks }, () => rng());
  cuts.sort((a, b) => a - b);
  let start = 0;
  for (const c of [...cuts, 1]) {
    const end = Math.floor(c * n);
    const gap = Math.floor(n * (0.015 + rng() * 0.05));
    const seg = path.slice(start, Math.max(start + 4, end - gap));
    if (seg.length > 3) ink(ctx, seg, rng, { ...rest, taperIn: 0.06, taperOut: 0.12 });
    start = end;
  }
}

/** Fill a polygon path on the context (no stroke). */
function tracePoly(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
}

/**
 * A watercolour wash.
 *
 * Offset from the shape it belongs to, edged with a darker rim where the
 * pigment dried against the boundary, and interrupted by a dry patch of bare
 * paper. Registered exactly to the ink it would look like a fill; missing by
 * two or three pixels it looks painted.
 */
export function wash(ctx, pts, rng, {
  color = '#9aa2ac',
  alpha = 0.85,
  slip = 3.5,
  rim = 0.35,
  dry = 0.35
} = {}) {
  const offX = rng.jitter(slip);
  const offY = rng.jitter(slip * 0.7);
  const shape = smooth(shake(pts.map(([x, y]) => [x + offX, y + offY]), slip * 0.8, rng), 5);

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  tracePoly(ctx, shape);
  ctx.fill();

  if (rim > 0) {
    // Edge darkening: pigment migrates to the drying boundary.
    ctx.globalAlpha = alpha * rim;
    ctx.lineWidth = 2.6 + rng() * 2.4;
    ctx.strokeStyle = color;
    ctx.lineJoin = 'round';
    ctx.stroke();
  }

  if (dry > 0 && rng.chance(0.8)) {
    // A patch the brush skipped. Bare paper is what keeps a wash from
    // reading as a flat vector fill.
    ctx.globalCompositeOperation = 'destination-out';
    ctx.globalAlpha = dry;
    const cx = shape[Math.floor(rng() * shape.length)][0];
    const cy = shape[Math.floor(rng() * shape.length)][1];
    const r = 4 + rng() * 12;
    ctx.beginPath();
    ctx.ellipse(cx, cy, r, r * (0.5 + rng() * 0.8), rng() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }
  ctx.restore();
}

/** Flat opaque body colour — the paper the washes sit on. */
export function paper(ctx, pts, rng, { color = '#efe9dd', alpha = 1, slip = 1.2 } = {}) {
  const shape = smooth(shake(pts, slip, rng), 5);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  tracePoly(ctx, shape);
  ctx.fill();
  ctx.restore();
}

/** Short parallel ticks: hair, stubble, folds, the hatching on a garment. */
export function hatch(ctx, x, y, rng, { count = 8, len = 10, spread = 12, angle = -1.2, jitter = 0.5, weight = 2, color = '#15120f' } = {}) {
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : i / (count - 1);
    const a = angle + rng.jitter(jitter);
    const ox = x + (t - 0.5) * spread + rng.jitter(1.5);
    const oy = y + rng.jitter(1.5);
    const l = len * (0.55 + rng() * 0.75);
    ink(ctx, [[ox, oy], [ox + Math.cos(a) * l, oy + Math.sin(a) * l]], rng, {
      weight, taperIn: 0.1, taperOut: 0.55, swell: 0.3, wobble: 0.5, color
    });
  }
}

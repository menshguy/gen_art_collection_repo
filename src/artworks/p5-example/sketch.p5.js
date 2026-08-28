/**
 * Drift Lattice
 *
 * Three interacting systems, no scattered primitives:
 *   1. a rectilinear lattice whose nodes are displaced by a domain-warped
 *      fbm field — this carries the composition;
 *   2. hatch marks aligned to the same field, gated by a density mask with a
 *      single off-centre centre of gravity — this carries texture and weight;
 *   3. a handful of accent bars at density peaks — this carries hierarchy.
 *
 * The density mask deliberately starves the upper right so the negative space
 * reads as a decision rather than an accident.
 */

import { createRandom } from '../../shared/random.js';
import { getPalette, withAlpha } from '../../shared/palettes.js';
import { clamp, smoothstep, map } from '../../shared/math.js';

export default function sketch(p, ctx) {
  const { width, height, noise } = ctx;

  // Re-seeded at the top of every render so a control tweak changes the
  // parameter under test and nothing else.
  let rng = ctx.rng;

  const params = {
    cols: 54,
    warp: 74,
    density: 0.8,
    hatch: 1.0,
    grain: true
  };

  const palette = getPalette('ferrous');
  const margin = width * 0.085;

  // Centre of gravity, low and left of centre. Everything is measured from here.
  const mass = { x: width * 0.36, y: height * 0.63, r: width * 0.62 };

  /**
   * Warped position of lattice node (u, v), u/v in 0..1.
   * Displacement is mostly vertical so rows stay legible as strata: they
   * bend past each other rather than crossing into a tangle.
   */
  function node(u, v) {
    const x = margin + u * (width - margin * 2);
    const y = margin + v * (height - margin * 2);
    const w = noise.warp2D(x * 0.0013, y * 0.0013, 0.9, { octaves: 3, gain: 0.5 });
    const a = noise.fbm2D(w.x, w.y, { octaves: 3 }) * Math.PI * 1.35;
    const amp = params.warp * (0.4 + 0.6 * (noise.fbm2D(x * 0.0009 + 40, y * 0.0009 - 12, { octaves: 2 }) * 0.5 + 0.5));
    return {
      x: x + Math.cos(a) * amp * 0.3,
      y: y + Math.sin(a) * amp,
      angle: a
    };
  }

  /** 0..1 mark density at a point: mass falloff, roughened by noise. */
  function densityAt(x, y) {
    const d = Math.hypot(x - mass.x, y - mass.y) / mass.r;
    const falloff = smoothstep(1.05, 0.12, d);
    const rough = 0.55 + 0.45 * (noise.fbm2D(x * 0.0022, y * 0.0022, { octaves: 3 }) * 0.5 + 0.5);
    // Bias against the upper right so the void is structural, not random.
    const quadrant = 1 - smoothstep(0.45, 1.0, (x / width) * 0.65 + (1 - y / height) * 0.75);
    return clamp(falloff * rough * (0.25 + 0.75 * quadrant)) * params.density;
  }

  /** Split a polyline into runs of points that clear the density threshold. */
  function surviving(pts, threshold) {
    const runs = [];
    let run = [];
    for (const pt of pts) {
      if (densityAt(pt.x, pt.y) >= threshold) {
        run.push(pt);
      } else if (run.length) {
        runs.push(run);
        run = [];
      }
    }
    if (run.length) runs.push(run);
    return runs;
  }

  /** Draw one run as a smooth curve; weight and value follow its density. */
  function drawRun(run, { shadeIndex, alpha, weight }) {
    if (run.length < 2) return;
    let sum = 0;
    for (const pt of run) sum += densityAt(pt.x, pt.y);
    const dens = sum / run.length;
    p.stroke(withAlpha(palette.colors[shadeIndex(dens)], alpha(dens)));
    p.strokeWeight(weight(dens));
    p.beginShape();
    p.curveVertex(run[0].x, run[0].y);
    for (const pt of run) p.curveVertex(pt.x, pt.y);
    p.curveVertex(run.at(-1).x, run.at(-1).y);
    p.endShape();
  }

  function drawLattice() {
    const rows = Math.round(params.cols * 0.7);
    p.noFill();

    // Rows carry the drift, drawn as curves so the strata flow rather than
    // kink. Runs break where the density field fails: the lattice dissolves
    // into the void instead of being cropped by it.
    const rowStyle = {
      shadeIndex: (d) => Math.min(3, Math.floor((1 - d) * 3.2)),
      alpha: (d) => 0.22 + d * 0.74,
      weight: (d) => map(d, 0.14, 1, 0.6, 3.2, true)
    };
    for (let j = 0; j <= rows; j++) {
      const v = j / rows;
      const pts = [];
      for (let i = 0; i <= params.cols; i++) pts.push(node(i / params.cols, v));
      for (const run of surviving(pts, 0.14)) drawRun(run, rowStyle);
    }

    // Every fourth column, faintly: enough cross-structure to read as a
    // lattice, not so much that it becomes a mesh.
    const colStyle = {
      shadeIndex: () => 1,
      alpha: (d) => 0.08 + d * 0.26,
      weight: (d) => map(d, 0.34, 1, 0.4, 1.2, true)
    };
    for (let i = 0; i <= params.cols; i += 4) {
      const u = i / params.cols;
      const pts = [];
      for (let j = 0; j <= rows; j++) pts.push(node(u, j / rows));
      for (const run of surviving(pts, 0.34)) drawRun(run, colStyle);
    }
  }

  function drawHatching() {
    const rows = Math.round(params.cols * 0.62);
    for (let j = 0; j <= rows; j++) {
      for (let i = 0; i <= params.cols; i++) {
        const n = node(i / params.cols, j / rows);
        const dens = densityAt(n.x, n.y);
        if (dens < 0.2) continue;
        // Denser regions get more, longer, darker strokes: correlated
        // variation rather than independent randomness per mark.
        const count = Math.floor(params.hatch * dens * 7);
        for (let k = 0; k < count; k++) {
          const spread = 16 + dens * 26;
          const ox = rng.gaussian(0, spread);
          const oy = rng.gaussian(0, spread * 0.7);
          const x = n.x + ox;
          const y = n.y + oy;
          const local = densityAt(x, y);
          if (local < 0.12) continue;
          const a = n.angle + rng.jitter(0.22) + Math.PI * 0.5;
          const len = (5 + local * 26) * (0.5 + rng.skew(1.6));
          // The densest tenth gets the darkest ink: the mass earns a core.
          const shade = local > 0.78 ? palette.colors[0] : rng.weighted(palette.colors, [4, 3, 2, 1]);
          p.stroke(withAlpha(shade, 0.1 + local * 0.62));
          p.strokeWeight(0.5 + local * 1.7);
          p.line(x - Math.cos(a) * len * 0.5, y - Math.sin(a) * len * 0.5,
                 x + Math.cos(a) * len * 0.5, y + Math.sin(a) * len * 0.5);
        }
      }
    }
  }

  function drawAccents() {
    // Few, large, and only at the peaks: the accent is hierarchy, not colour
    // noise. Candidates are ranked by density so the bars land on the crest
    // of the mass whatever the seed does.
    const candidates = [];
    for (let i = 0; i < 900; i++) {
      const x = rng.gaussian(mass.x, width * 0.19);
      const y = rng.gaussian(mass.y, height * 0.17);
      if (x < margin || y < margin || x > width - margin || y > height - margin) continue;
      candidates.push({ x, y, d: densityAt(x, y) });
    }
    candidates.sort((a, b) => b.d - a.d);

    // One dominant bar, two subordinates. Sizes are stepped, not random, so
    // the accents form a hierarchy instead of a row of equals.
    const sizes = [0.135, 0.06, 0.038];
    const placed = [];
    p.noStroke();
    for (const c of candidates) {
      if (placed.length >= sizes.length) break;
      if (placed.some((q) => Math.hypot(q.x - c.x, q.y - c.y) < width * 0.17)) continue;
      const n = node((c.x - margin) / (width - margin * 2), (c.y - margin) / (height - margin * 2));
      const len = width * sizes[placed.length];
      placed.push(c);
      p.push();
      p.translate(c.x, c.y);
      p.rotate(n.angle * 0.42);
      p.fill(palette.accent);
      p.rect(-len * 0.5, -width * 0.0028, len, width * 0.0056);
      p.pop();
    }
  }

  function drawGrain() {
    if (!params.grain) return;
    p.noStroke();
    for (let i = 0; i < 26000; i++) {
      const x = rng() * width;
      const y = rng() * height;
      const dens = densityAt(x, y);
      p.fill(withAlpha(palette.colors[0], 0.02 + dens * 0.05));
      p.rect(x, y, 1.3, 1.3);
    }
  }

  function render() {
    rng = createRandom(ctx.seed);
    p.randomSeed(ctx.seed);
    p.noiseSeed(ctx.seed);
    p.background(palette.bg);
    drawLattice();
    drawAccents();
    drawHatching();
    drawGrain();
  }

  p.setup = () => {
    p.createCanvas(width, height);
    render();
  };

  // Controls exist because these four numbers are the ones actually worth
  // pushing while looking at the piece. They never appear in a capture.
  if (ctx.pane) {
    const pane = ctx.pane;
    pane.addBinding(params, 'cols', { min: 12, max: 90, step: 1 });
    pane.addBinding(params, 'warp', { min: 0, max: 420, step: 5 });
    pane.addBinding(params, 'density', { min: 0.2, max: 1.4, step: 0.02 });
    pane.addBinding(params, 'hatch', { min: 0, max: 2.5, step: 0.05 });
    pane.addBinding(params, 'grain');
    pane.on('change', () => render());
  }
}

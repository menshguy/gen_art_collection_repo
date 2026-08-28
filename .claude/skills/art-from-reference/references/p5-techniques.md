# p5 technique decision aid

A menu, not a textbook. Match the visual problem to a technique instead of defaulting to
`ellipse()` in a loop. Shared helpers live in `src/shared/` (`createRandom`, `poissonDisc`,
`createNoise` → `noise2D/fbm2D/warp2D/flowAngle`, palettes).

## Fields and flow

| Want | Reach for |
| --- | --- |
| directional motion, hair/current/grain-of-wood | **flow field**: `angle = fbm2D(x*s, y*s) * τ`, advect particles, draw their trails |
| swirling, incompressible motion | **curl-ish field**: sample the noise gradient and rotate it 90° |
| organic distortion of anything regular | **domain warping**: `warp2D(x, y, strength)` before sampling |
| texture with structure at several scales | **fbm**: 3–5 octaves; raise gain for roughness |
| ridges, strata, cracks | `1 - abs(noise)`, then square or cube it for sharper crests |
| a field that respects a shape | multiply the field by a mask (distance function, image alpha) |

Advect with a small step and many steps; long straight steps look mechanical.

## Placement

| Want | Reach for |
| --- | --- |
| even spacing without a grid | **Poisson-disc** (`poissonDisc`, radius can vary by position) |
| clusters | pick N cluster centres, then `rng.gaussian` around each |
| many small, few large | `rng.skew(2)` or power-law sizes; correlate size with density |
| structured but not rigid | **jittered grid**, jitter ≥ 30% of spacing or the rows still read |
| nested composition, varied rectangles | **recursive subdivision**, split with weighted ratios, stop on a size/depth rule |
| forms that touch but never overlap | **circle/shape packing**, largest first, radius from a density field |
| growth, tendrils, accumulation | **agents**: walkers with steering rules and a deposit trail |
| space partitioned by proximity | **Voronoi/Delaunay** (worth a small dependency only if central) |

Never place every element with independent `random(width), random(height)` — that is the single
most recognisable weak-generative signature.

## Line and mark

- `beginShape()` + `curveVertex()` for flowing strokes; break the polyline into runs and drop the
  runs that fall outside your density mask, so forms dissolve instead of being clipped.
- Vary weight and alpha with the same field that drives density — correlated variation reads as
  intent.
- **Hatching**: short parallel strokes aligned to a field angle; density and length carry value.
  **Stippling**: dot density carries value; jitter positions with Poisson, not uniform random.
- **Tapered strokes**: draw a stroke as a thin polygon with varying half-width, not a `line()`.
- Overlap many low-alpha marks rather than few opaque ones when you want depth of surface.
- Differential growth: a closed polyline with repulsion between nodes, attraction along it, and
  node insertion when segments stretch — produces coral/brain folds.

## Layers and surface

- `createGraphics()` buffers: build the piece in layers (structure / texture / accent), then
  composite. Buffers also let you mask (`ERASE`, or draw a shape then `blendMode(MULTIPLY)`).
- Blend modes: `MULTIPLY` for ink on paper, `SCREEN`/`ADD` for light, `OVERLAY` for contrast.
  Use one deliberately; stacking three is mud.
- Grain: thousands of 1px marks at 2–6% alpha, weighted by the density field so grain reinforces
  form. Uniform grain over everything is noise, not texture.
- Feedback: draw the previous buffer back slightly transformed (scale/rotate/offset) with low
  alpha for trails and echoes.
- `loadPixels()`/`updatePixels()` for per-pixel work — dithering, displacement from an image,
  reaction-diffusion.

## Colour

- Start from `src/shared/palettes.js` or sample the reference. Three to five colours plus one
  accent used on under 5% of the image.
- Tie colour to something structural: height, depth, density, angle, cluster id. Per-element
  `rng.pick(colors)` is acceptable only with **weights**.
- Check value structure by imagining it greyscale — if it flattens, contrast is doing nothing.

## Performance

Precompute per-element data into flat arrays before drawing. Hoist colour strings. Cache noise
samples. Use offscreen buffers for anything drawn more than once. Keep `pixelDensity` to the
host's setting.

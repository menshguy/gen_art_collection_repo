---
description: Conventions for p5.js artwork files in this studio
paths: ["src/artworks/**/*.p5.js"]
---

# p5 artwork rules

## Contract

Instance mode only. The file default-exports a factory; the host owns mounting, teardown,
pixel density, seeding and the readiness signal.

```js
export default function sketch(p, ctx) {
  p.setup = () => {
    p.createCanvas(ctx.width, ctx.height);
    // draw here for a still piece — no p.draw means no wasted loop
  };
}
```

`ctx = { seed, rng, noise, width, height, capture, pane, reload, artwork }`

- `ctx.rng` — seeded helper from `src/shared/random.js` (`range`, `int`, `pick`, `weighted`,
  `gaussian`, `skew`, `shuffle`, `jitter`, `inCircle`).
- `ctx.noise` — seeded simplex from `src/shared/math.js` (`noise2D`, `fbm2D`, `warp2D`,
  `flowAngle`). `p.noise()` is fine too; both are seeded.
- Never call `Math.random()`. The whole studio depends on seed reproducibility.
- Never call `p.randomSeed`/`p.noiseSeed` with anything but `ctx.seed`.

## Canvas

- Always `p.createCanvas(ctx.width, ctx.height)`. The canvas is a fixed artwork-sized surface
  scaled by CSS; do not use `windowWidth`/`windowHeight` and do not resize on window events.
- Always paint a `background()` explicitly — a transparent canvas captures against white.
- The host sets `pixelDensity` (1 for captures, up to 2 live). Do not override it.

## Structure

- Draw everything in `setup()` for a still piece and define no `p.draw` — the host then skips
  the animation loop entirely.
- If you define `p.draw`, it must be safe to run repeatedly, and animation should be driven by
  `p.frameCount` rather than `p.millis()` if you want reproducible captures.
- Re-seed at the top of any re-render function (`rng = createRandom(ctx.seed)`) so a Tweakpane
  tweak changes the parameter under test and nothing else.
- Create no DOM elements. No `createButton`, no `createSlider`, no `createDiv` — the studio owns
  the page. Interactive parameters belong on `ctx.pane` (Tweakpane), which is absent during
  captures, so guard with `if (ctx.pane)`.

## Performance

- Hoist allocations out of hot loops: no `new p5.Vector`, `color()`, or array literals per mark
  in a loop that runs 10⁵ times. Precompute palettes and colour strings.
- Cache repeated `noise()` samples; sampling the same field twice per element is common waste.
- Use `p.createGraphics()` offscreen buffers for layers you redraw or reuse — masks,
  accumulation, texture plates, blend passes.
- `p.beginShape()/curveVertex()` beats hundreds of `line()` calls for a continuous stroke, and
  looks better.

## Aesthetics

Use what p5 is genuinely good at: mark-making, line quality, layering, blend modes, offscreen
compositing, pixel manipulation, hatching, stippling, accumulation and feedback.

Do not write demo-code aesthetics: uniformly scattered `ellipse()` calls, rainbow `random()`
colours, or a grid of identical shapes with jitter standing in for a composition. Marks should
belong to a field, a mass, or a system — see `.claude/skills/art-from-reference/references/p5-techniques.md`.

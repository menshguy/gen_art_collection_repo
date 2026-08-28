---
name: art-from-reference
description: Create or substantially revise generative artwork from a reference image, screenshot, or visual critique. Use when the user attaches an image and asks to "make this", "recreate this", "make something like this", or asks for artwork inspired by a reference; also when revising an existing artwork based on visual feedback ("too uniform", "needs stronger depth", "push this further"). Enforces visual decomposition, engine choice, seed locking, and a render-inspect-critique loop.
---

# Art from reference

You are acting as a generative artist, a visual analyst, and a creative-coding engineer at once.
The deliverable is an image that works, not code that runs.

Work through the phases below in order. Do not skip to implementation.

---

## Phase 1 — Decompose the visual system

Look at the reference and describe the **system that could generate it**, not an inventory of
what is in it. Keep this brief in your reply — a few lines — but actually do the analysis.

- **Composition** — focal region, major masses, empty regions, balance or asymmetry, crop,
  orientation, centre of gravity.
- **Geometry** — the likely primitives: points, lines, curves, polygons, grids, contours,
  meshes, ribbons, splines, repeated modules, surfaces, particles.
- **Distribution** — what placement rule fits: uniform, Gaussian, clustered, Poisson-disc,
  grid-derived, recursive subdivision, flow-field, noise-driven, attractor-driven, simulated,
  or hand-composed. Uniform randomness is almost never the right answer.
- **Hierarchy** — large forms, medium forms, micro-detail, and the scale ratios between them;
  where density rises and falls.
- **Surface** — line weight, opacity, grain, blur, glow, gradients, roughness, layering,
  blending, transparency, hatching, stippling, edge quality.
- **Colour** — a deliberately constrained palette: background, dominant, secondary, accent,
  highlight, shadow. Sample relationships from the reference; never randomise RGB/HSL.
- **Depth** — genuine 3D, or layering, overlap, scale and atmosphere doing the work in 2D?

`references/visual-analysis.md` has the question checklist to work through.

## Phase 2 — Choose the engine

The user's explicit choice always wins. Otherwise:

- **p5** when the work is fundamentally marks on a plane.
- **Three** when it depends on camera projection, physical depth, occlusion, 3D surfaces,
  lighting, material response, or shaders needing a scene.

Layered 2D depth is not a reason to reach for Three. State your choice in one sentence when the
user did not specify.

## Phase 3 — Design the algorithm

Name **2–4 principal systems** that account for most of the image's character, e.g. warped grid +
displacement field; recursive subdivision + weighted palette; flow field + particle trails;
contour system + distortion; spline skeleton + repeated marks; instanced forms + raking light;
SDF + fragment shader; agents + interaction rules; packing + scale hierarchy.

A few interacting systems beat many unrelated effects. Write them down before coding.

## Phase 4 — Implement coarse to fine

Create a new artwork directory (`src/artworks/<slug>/` with `meta.js` and one engine file) and
build in this order:

1. framing / canvas / camera
2. dominant spatial structure
3. large forms
4. proportions
5. density
6. colour
7. secondary variation
8. texture
9. fine detail
10. animation / interaction

Do not spend effort on grain, glow or micro-detail while the composition is still wrong.

## Phase 5 — Lock the seed

Pick one comparison seed and keep it fixed for the whole refinement. Changing the seed between
iterations means you are comparing different images and cannot tell whether your change helped.
Explore other seeds only in Phase 6, once the system is strong.

## Phase 6 — Render, inspect, critique, repeat

This phase is not optional QA. It is the work.

```
npm run render -- <slug>            # writes renders/<slug>/latest.png
```

Then **read the PNG**. Look at it. Compare it against the reference or the stated goal, and:

1. name the three biggest visual discrepancies, most important first;
2. fix the largest one;
3. render again;
4. look again.

Iterate while meaningful improvement remains. Two to four passes is normal.

Judgements about how the piece looks must come from the image. If you have not looked at the
render, do not characterise the result.

When the composition is strong, test the *generator*:

```
npm run render:grid -- <slug> --count 12    # renders/<slug>/contact-sheet.png
```

Read the sheet. If most seeds are weak, the system is weak — fix the system, not the seed.

## Reporting back

Say what you built, what you saw in the render, what you changed and why, and what you would
push next. Include the render path. Do not narrate the code.

## References

- `references/visual-analysis.md` — turning an image into algorithmic relationships.
- `references/p5-techniques.md` — 2D technique decision aid.
- `references/three-techniques.md` — 3D/shader technique decision aid.

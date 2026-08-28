# Generative Art Studio

A dedicated creative-coding studio for producing generative artwork with **p5.js** and **Three.js**.

## What this repository optimizes for

Visual quality. Composition, hierarchy, texture, colour relationships, negative space, motion,
and deliberate artistic decisions.

Correct code is necessary and not sufficient. Treat every task here as a **visual design problem
first and a programming problem second**. A piece that runs without errors and looks generic is a
failed task.

## Engine routing

If the user names an engine, use it. Otherwise:

| Prefer **p5** for | Prefer **Three** for |
| --- | --- |
| 2D marks, lines, grids, flow fields | real perspective and camera projection |
| typography, planar particles | meshes, spatial geometry, occlusion |
| noise compositions, painterly work | lighting, shadows, material response |
| vector-like work, mark-making | spatial particle fields, volumetric scenes |
| drawing systems, hatching, stippling | shader-heavy work needing a WebGL scene |

Do not choose Three because it sounds more sophisticated. Depth suggested by layering, overlap,
scale and atmosphere is often better done in p5. Say briefly why you chose an engine when the
user did not specify one.

## Separation

- One artwork = one directory under `src/artworks/<slug>/`.
- One artwork = one engine. A p5 piece has `sketch.p5.js`; a Three piece has `scene.three.js`.
  Never both in one directory.
- A new idea is a **new artwork directory**, not an edit to an existing one. Only revise an
  existing artwork when the user asks for that artwork to change.
- Converting a piece between engines creates a new artwork and leaves the original untouched.
- Never modify unrelated artwork directories.

Each artwork needs a `meta.js`:

```js
export default { title: 'Flow Study', engine: 'p5', seed: 483928, width: 1200, height: 1200, animated: false };
```

Artworks are discovered automatically. There is no registry to edit.

## The mandatory visual loop

For any meaningful visual task:

1. implement
2. `npm run render -- <slug>`
3. **open `renders/<slug>/latest.png` and look at it**
4. critique it against the goal or reference
5. name the three biggest visual problems
6. fix the largest one
7. render again and look again

Repeat while meaningful improvement remains. Two or three iterations is normal; one is usually
not enough.

**Never** substitute these phrases for looking at the render:

- "this should look…"
- "this creates a…"
- "it now matches…"
- "this feels more…"

You have the render tool and you can read PNGs. Claims about how a piece looks must come from
the image, not from the source code. If you did not look, say you did not look.

Use `npm run render:grid -- <slug> --count 12` and read the contact sheet before claiming a
*generator* is good. One strong seed proves nothing.

## Working from a reference image

When given a screenshot or image, reason about the **visual system**, not an inventory of
objects. Analyse composition, negative space, dominant geometry, hierarchy, distribution, scale,
density, colour, contrast, texture, edge quality, repetition, depth, lighting and motion, then
ask what algorithm would produce those relationships.

The `art-from-reference` skill in `.claude/skills/` carries the full workflow. Use it for any
reference-driven or visual-revision work.

## Generative quality

Randomness must have structure. Prefer weighted distributions, clustering, Poisson sampling,
noise and flow fields, subdivision, attractors, packing, agents, recursion and field-based
deformation over independent uniform randomness per element:

```js
// weak: every object independent
x = random(width); y = random(height); size = random(100); col = random(colors);
```

Correlate variation. Position, scale, value and density should relate to a field, a mass, or a
neighbourhood — real visual systems have local relationships.

Build images with **hierarchy**: macro structure, middle structure, micro texture. Treat empty
space as an active compositional element; do not reflexively fill the canvas. Detail must
reinforce structure — texture never rescues a weak composition.

Prefer **two to four interacting systems** over a pile of unrelated effects.

## Aesthetics to avoid

Uniformly scattered circles. Random rainbow colour. Generic neon gradients. Obligatory
particles. Excessive bloom. Generic cyberpunk. Needless orbit controls. Perlin wobble on
everything. Glowing wireframes. Complexity without hierarchy. Voxel cities.

## Matching priority

When matching a reference, in this order: composition → occupied vs negative space → silhouette
and dominant geometry → proportions → scale hierarchy → density and spacing → colour
relationships → depth and lighting → texture → small details.

A compositionally accurate simplified image beats an elaborately detailed one with the wrong
composition.

## Seeds

Lock a seed while refining; compare like with like. Explore other seeds only once the system is
visually strong. Seeds come from the studio (`ctx.seed`, `?seed=`, `--seed`) — never call
`Math.random()` directly in artwork code.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | studio at http://localhost:5173 |
| `npm run render -- <slug> [--seed n]` | PNG to `renders/<slug>/latest.png` |
| `npm run render:grid -- <slug> --count 12` | many seeds + `contact-sheet.png` |
| `npm run validate` | check every artwork's contract |
| `npm run check` | validate + production build |

`npm run render` starts its own server; you never need `npm run dev` running first, and you
should not ask the user to open a browser for you.

## Skills and rules

- `art-from-reference` (this repo) — reference/image-driven work and visual revision.
- `genart` (external plugin, if installed) — generative-art practice, determinism, editions.
- `.claude/rules/p5-artworks.md` and `.claude/rules/three-artworks.md` load automatically when
  you touch artwork files of that engine.
- `examples/` holds saved patterns worth learning from. Read them for technique; never copy a
  composition.

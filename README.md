# Generative Art Studio

A permanent local studio for making generative artwork with **p5.js** and **Three.js**, built to
be driven by **Claude Code**.

Attach a screenshot, say *"make this in p5"*, and Claude analyses the image, writes the artwork,
renders it to a PNG, **looks at that PNG**, critiques it, and iterates. The repository supplies
the workflow so your prompts can stay short.

---

## A. What this repo is

- A **permanent studio**, not a one-off project. Come back to it whenever you want to make
  something; artworks accumulate.
- **Claude Code works inside it.** `CLAUDE.md`, `.claude/rules/` and `.claude/skills/` define how
  Claude behaves here: visual quality first, one artwork per directory, and a mandatory
  render-and-critique loop.
- **p5 and Three coexist**, but each artwork is written natively in one engine. There is no
  abstraction pretending they are the same library.
- **Every artwork is isolated** in its own directory. New idea = new directory. Old work never
  gets clobbered by a new experiment.
- **Visual feedback is the point.** Headless rendering exists so Claude can judge results from
  images instead of describing what code "should" produce.

---

## B. First-time setup

**Prerequisites**

| Thing | Needed | Check with |
| --- | --- | --- |
| Node.js | 20.19+ or 22.12+ (Vite 8) | `node --version` |
| npm | any recent | `npm --version` |
| Claude Code | for the AI workflow | `claude --version` |
| Git | optional | `git --version` |

**Install**

```bash
npm install
npx playwright install chromium     # headless browser used for rendering
```

**Verify everything works**

```bash
npm run check                       # validates artworks + production build
npm run render -- p5-example        # writes renders/p5-example/latest.png
npm run render -- three-example
```

If those three commands succeed and the PNGs look like artwork, the studio is working.

**Claude plugin (optional but recommended)**

Inside Claude Code, run:

```
/plugin marketplace add camilleroux/genart-skill
/plugin install genart@camilleroux-genart
```

The `genart` skill adds general generative-art practice: determinism, resolution independence,
editions and contact-sheet thinking. It is installed *outside* this repo so it can be updated
normally. **Nothing here depends on it** — the studio's own rendering workflow stands alone.

---

## C. Starting the studio

```bash
npm run dev
```

Open **http://localhost:5173**. You get a sidebar listing every artwork (grouped by engine), the
artwork itself on a neutral stage, and a thin toolbar: title, engine badge, seed field, a random
seed button, reload, pause/play for animated pieces, and a **clean ↗** link that opens the
artwork with no studio chrome at all.

Keyboard: `r` new random seed, `s` save the current frame as a PNG, `space` pause/play.

---

## D. Creating artwork

1. Launch Claude Code from the repository root: `claude`
2. Optionally attach or paste a screenshot.
3. Give a short prompt — *"Make this in p5."*
4. Claude creates `src/artworks/<slug>/` with `meta.js` and one engine file.
5. Claude implements the major composition first.
6. Claude runs `npm run render -- <slug>`.
7. Claude opens the PNG and critiques it against your reference.
8. Claude fixes the biggest problem and renders again — usually two to four passes.
9. Open it yourself at `http://localhost:5173/?art=<slug>`.

You do not need `npm run dev` running for Claude to render; the render script starts its own
server.

---

## E. How to prompt Claude

Short prompts are enough. The repository already tells Claude to analyse, choose an engine, lock
a seed, render, look, critique and iterate.

**Explicit p5**
> Make this in p5.

**Explicit Three**
> Recreate this using Three.js.

**Let Claude choose**
> Create a generative system inspired by this image. Choose the engine that makes the most sense.

**Interpretation rather than recreation**
> Use this only as compositional inspiration. Create something original with a similar density
> and visual rhythm.

**Improve something**
> The current version feels too uniform. Make the scale distribution more interesting and create
> stronger negative space. Render and inspect it before stopping.

**Push quality**
> Push this substantially further. Don't just add more detail — improve the underlying
> composition and visual system, then render and critique it.

**Seed exploration**
> The system is working. Render 12 different seeds and tell me which compositions are strongest
> and why.

**Engine conversion**
> Make a new Three.js interpretation of this p5 experiment. Keep the original untouched.

Conversion should **create a new artwork**, not overwrite the old implementation. Both versions
are worth keeping; they are different pieces.

---

## F. Choosing p5 vs Three.js

**p5 is generally best for**

2D marks · lines · fields · grids · flow · drawing systems · typography · painterly algorithms ·
planar particles · hatching and stippling · anything that is fundamentally ink on a plane.

**Three is generally best for**

3D · meshes · cameras · lighting and shadow · materials · spatial systems · deep particle
fields · shader-heavy scenes · anything that depends on projection and occlusion.

**Do not use Three just because it sounds more advanced.** Layered depth — overlap, scale
falloff, atmospheric fade — is often more beautiful and more controllable in p5. Reach for Three
when the image genuinely needs a camera.

---

## G. Why p5 and Three are kept separate

They share the studio: the same seed handling, the same UI, the same render pipeline, the same
`src/shared/` utilities. They do **not** share an artwork abstraction.

A wrapper that made `p5.Vector` and `THREE.Vector3` interchangeable, or unified "draw a shape"
across both, would be a lowest-common-denominator API that fights both libraries and hides the
things each is good at. Instead the studio is interchangeable at the *studio* level — pick an
engine per artwork — and each artwork file is idiomatic code for its own library. Claude writes
better p5 and better Three this way, and so will you.

---

## H. Repository structure

```
CLAUDE.md                    always-loaded rules for Claude
README.md                    this file
index.html, vite.config.js   the dev shell

.claude/
  settings.json              small permission allowlist so renders don't prompt
  rules/
    p5-artworks.md           loaded when Claude touches *.p5.js
    three-artworks.md        loaded when Claude touches *.three.js
  skills/art-from-reference/ the reference -> analysis -> render -> critique workflow
    SKILL.md
    references/              visual-analysis, p5-techniques, three-techniques

src/
  main.js, style.css         studio UI (not artwork)
  runtime/
    artwork-registry.js      auto-discovery of src/artworks/*
    p5-host.js               mounts/unmounts p5, seeding, capture, readiness
    three-host.js            renderer, loop, disposal, fixed-timestep captures
    ready.js                 the readiness signal capture depends on
  shared/
    random.js                seeded PRNG, weighted/gaussian/skew, Poisson-disc
    math.js                  lerp/map/easing + seeded simplex, fbm, domain warp
    palettes.js              constrained palettes and colour helpers
    export.js                in-browser PNG save
  artworks/
    p5-example/              meta.js + sketch.p5.js
    three-example/           meta.js + scene.three.js

references/<slug>/           reference images you want to keep
renders/<slug>/              generated PNGs (git-ignored)
examples/                    a library of past work worth learning from
scripts/                     render, render:grid, validate
```

---

## I. The artwork contract

Every artwork directory contains a `meta.js` and exactly one engine file.

```js
// src/artworks/flow-study/meta.js
export default {
  title: 'Flow Study',
  engine: 'p5',            // 'p5' | 'three'
  seed: 483928,
  width: 1200,
  height: 1200,
  animated: false,
  // optional:
  captureFrames: 60,       // frames to settle before a capture (animated pieces)
  description: 'one line about the piece'
};
```

**p5** — `sketch.p5.js`, instance mode:

```js
export default function sketch(p, ctx) {
  p.setup = () => {
    p.createCanvas(ctx.width, ctx.height);
    p.background('#e8e2d6');
    // draw here; omit p.draw entirely for a still piece
  };
}
```

**Three** — `scene.three.js`:

```js
export default function scene(ctx) {
  const world = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, ctx.width / ctx.height, 0.5, 400);
  return { scene: world, camera, update(t, dt) {}, resize(w, h) {}, dispose() {} };
}
```

Both receive `ctx = { seed, rng, noise, width, height, capture, pane, reload, artwork }`; Three
also gets `renderer`. The host owns mounting, sizing, pixel density, the animation loop and
teardown. Three artworks must release what they create in `dispose()`.

The canvas is always created at the artwork's real dimensions and scaled down by CSS, so what
you see in the browser is exactly what gets rendered to disk.

---

## J. Seeds

A **seed** is the number that makes randomness repeatable. Same seed + same code = same image,
every time.

Why it matters: while you are refining a piece, you want to see the effect of *your change*, not
a different roll of the dice. So lock a seed, iterate against it, and only then look at others.

- Set the default in `meta.js` (`seed: 483928`).
- Change it live in the toolbar, or press `r` for a random one.
- Load one directly: `http://localhost:5173/?art=flow-study&seed=12345`
- Render one: `npm run render -- flow-study --seed 12345`

Artwork code never calls `Math.random()`; it uses `ctx.rng` and `ctx.noise`, both seeded from
`ctx.seed`. Animated Three captures advance on a fixed timestep, so even a moving piece renders
identically for a given seed.

---

## K. Rendering

```bash
npm run render -- <artwork-slug>
npm run render -- <artwork-slug> --seed 483928
npm run render -- <artwork-slug> --out somewhere/else.png
```

Output:

```
renders/<slug>/seed-<n>.png     the specific seed
renders/<slug>/latest.png       always the most recent render
```

The script starts its own Vite server on a free port, opens the artwork in capture mode, waits
for the artwork to signal that it has finished drawing (not a fixed sleep), screenshots the
canvas at its exact dimensions, and shuts down. Browser console errors and shader failures are
reported instead of silently producing a black square.

**Claude is expected to open these PNGs and judge them.** That is the whole reason the command
exists. If Claude describes a result without rendering it, tell it to render and look.

Options: `--seed`, `--out`, `--timeout <ms>`, `--open`.

---

## L. Contact sheets / multiple seeds

```bash
npm run render:grid -- <artwork-slug> --count 12
npm run render:grid -- <artwork-slug> --count 12 --base 500
npm run render:grid -- <artwork-slug> --seeds 12,99,4821
```

Output:

```
renders/<slug>/grid/seed-<n>.png      each seed
renders/<slug>/contact-sheet.png      all of them, labelled, in one image
```

A generative artwork is a **generator**, not an image. One good seed can hide a weak system — if
eleven of twelve seeds are mediocre, the system is mediocre and no amount of seed-hunting fixes
that. Read the sheet, then improve the rules.

---

## M. Tweakpane

[Tweakpane](https://tweakpane.github.io/docs/) is a tiny control panel that appears at the top
right of the stage when an artwork defines controls. Drag a slider, see the composition change
immediately — far faster than editing numbers and re-running.

Claude adds controls when a piece has parameters genuinely worth pushing by eye (density, noise
scale, warp strength, palette, camera height, light intensity, particle count). Not every
artwork needs them.

Controls are **development instruments only**: the panel does not exist in capture mode, so it
never appears in a render.

---

## N. Working from screenshots

**Fast workflow — attach it in chat**

Paste or drag an image into Claude Code and prompt normally. Best for one-offs. Claude will not
refuse to work just because the image is not saved in the repo.

**Persistent workflow — save it**

```
references/<artwork-slug>/reference.png
```

Then: *"Use `references/forest-lines/reference.png` and make this in p5."*

Worth doing when you expect to return to a piece. Months later Claude can re-read the original
intent without you hunting for the screenshot. See `references/README.md`.

---

## O. The visual feedback loop

```
REFERENCE
   |
ANALYZE VISUAL SYSTEM
   |
SELECT ENGINE
   |
IMPLEMENT
   |
RENDER
   |
INSPECT PNG
   |
CRITIQUE
   |
MODIFY
   |
RENDER AGAIN
```

**Why this repository insists on it:** a language model can write plausible visual code and then
describe what it *ought* to look like without ever seeing the result. That is the single biggest
failure mode in AI-assisted generative art — confident prose about an image nobody looked at.

`npm run render` closes the loop. Claude renders a PNG and reads it back as an image, so its
critique is about the actual output. When Claude seems to be stopping early or narrating instead
of judging, say: **"Render it and critique the result before stopping."**

---

## P. How to get better results

- **Describe what feels wrong visually**, not what code to change. Claude is better at fixing
  "the centre feels accidentally empty" than at guessing why you asked for a smaller step size.
- **Use compositional vocabulary**: composition, density, rhythm, hierarchy, scale, texture,
  contrast, negative space, silhouette, value structure.
- **Ask Claude to "push the system"**, not to "add detail". Detail on a weak composition makes a
  busy weak composition.
- **Lock a seed while refining**, then explore seeds afterwards.
- **Save what works** into `examples/` so future sessions can learn from your taste.
- **Say when you want interpretation** rather than recreation — otherwise Claude will try to
  match the reference.
- **Use screenshots liberally.** A rough sketch, a photo, a frame from a film, another artwork's
  layout — all work as references.
- **Stay on p5 for planar problems.** Escalating to Three rarely fixes a 2D composition.
- **Ask for a critique explicitly** when Claude stops early: *"Render it, look at it, and tell me
  the three biggest problems."*

---

## Q. Good vs weak prompts

| Weak | Better |
| --- | --- |
| Add more particles. | The centre feels empty accidentally rather than deliberately. Increase density near the lower-left mass, preserve the negative space in the upper right, and introduce more variation in particle scale. |
| Make it cooler. | This feels like a generic particle demo. Reduce the number of independent effects, establish one dominant flow direction, introduce clustered density, and use a restrained palette. |
| More detail. | The macro structure is fine but there is nothing at mid-scale — everything is either the big form or fine grain. Add a middle layer that follows the same field. |
| It looks bad. | The value structure is flat: everything sits at the same lightness, so nothing reads as foreground. Give the mass a dark core and let the edges dissolve. |
| Fix the colours. | Four hues are competing. Pick one dominant colour, one supporting neutral, and use the red on less than five percent of the image. |

The pattern: name the *visual* problem and the *relationship* you want, and let Claude choose the
mechanism.

---

## R. Command reference

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the studio at http://localhost:5173 |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Serve the production build |
| `npm run render -- <slug>` | Render one artwork to `renders/<slug>/latest.png` |
| `npm run render -- <slug> --seed <n>` | Render a specific seed |
| `npm run render:grid -- <slug> --count 12` | Render many seeds + a contact sheet |
| `npm run validate` | Check every artwork's metadata and files |
| `npm run check` | `validate` + production build |
| `npm run setup:browser` | Install Playwright's Chromium |
| `npm run render -- --help` | Full flag list (same for `render:grid`) |

---

## S. Adding successful examples

When a piece works, copy it into `examples/<category>/<name>/` with a short `NOTES.md` saying
what is worth reusing. Claude reads these for technique — distributions, shader patterns,
composition strategies, performance fixes — and is told **not** to reproduce their compositions.
See `examples/README.md`.

---

## T. Creating an artwork by hand

Claude will normally do this, but it is two small files.

```bash
mkdir -p src/artworks/my-piece
```

`src/artworks/my-piece/meta.js`

```js
export default {
  title: 'My Piece', engine: 'p5', seed: 1234, width: 1200, height: 1200, animated: false
};
```

`src/artworks/my-piece/sketch.p5.js`

```js
export default function sketch(p, ctx) {
  p.setup = () => {
    p.createCanvas(ctx.width, ctx.height);
    p.background('#e8e2d6');
    p.stroke('#2b2724');
    for (let i = 0; i < 400; i++) {
      const x = ctx.rng.gaussian(ctx.width * 0.4, 180);
      const y = ctx.rng.gaussian(ctx.height * 0.6, 180);
      const a = ctx.noise.flowAngle(x, y);
      p.line(x, y, x + Math.cos(a) * 30, y + Math.sin(a) * 30);
    }
  };
}
```

For a Three piece use `scene.three.js` and the shape in section I instead. Then:

```bash
npm run validate                 # confirms the contract
npm run render -- my-piece
```

It appears in the sidebar automatically — there is no registry to edit.

---

## U. Troubleshooting

**`browserType.launch: Executable doesn't exist`** — Playwright's browser is missing:
`npx playwright install chromium`.

**Port 5173 already in use** — Vite picks the next free port and prints it. Rendering is
unaffected; the render script always uses its own ephemeral port.

**An artwork doesn't appear in the sidebar** — run `npm run validate`. Usually a missing
`meta.js`, a slug that is not lowercase-kebab, or an engine that does not match the file present.

**"declares engine X but has no Y"** — `meta.engine` and the filename disagree. `p5` needs
`sketch.p5.js`; `three` needs `scene.three.js`. One artwork, one engine.

**Render times out waiting for ready** — the artwork threw before finishing, or an animated piece
needs more frames. The error reports how many frames were drawn. Check the browser console via
`npm run dev`, raise `captureFrames` in `meta.js`, or pass `--timeout 120000`.

**Three canvas looks stretched** — the host sizes the canvas; artworks should not call
`renderer.setSize`. Update `camera.aspect` in `resize(w, h)` and call
`updateProjectionMatrix()`.

**p5 "global mode" errors** — this studio is instance mode only. Every p5 call goes through the
`p` argument: `p.line()`, not `line()`.

**A screenshot came out blank or half-drawn** — the artwork never signalled ready. Still p5
pieces signal after `setup`; animated pieces after `captureFrames` frames. If you draw
asynchronously, make sure the drawing happens inside `setup` or `draw`.

**Shader compile errors** — they appear in the render script output as browser console errors.
Three prints the offending GLSL with line numbers.

**WebGL unavailable / black Three render** — the render script already forces SwiftShader
software rendering. In a browser, check `chrome://gpu`.

**genart plugin not found** — install it in Claude Code with the two `/plugin` commands in
section B. Nothing in this repository requires it.

---

## V. How the Claude configuration fits together

| File | Loaded when | Job |
| --- | --- | --- |
| `CLAUDE.md` | every session | studio identity, engine routing, separation rules, the mandatory render/critique loop, quality principles |
| `.claude/rules/p5-artworks.md` | Claude touches a `*.p5.js` file | instance mode, seeding, no DOM, offscreen buffers, hot-loop allocation |
| `.claude/rules/three-artworks.md` | Claude touches a `*.three.js` file | disposal, instancing, deliberate camera and lighting, no default OrbitControls |
| `.claude/skills/art-from-reference/` | image/reference-driven or visual-revision work | the six-phase workflow, plus technique references loaded only when needed |
| `genart` plugin (external) | when relevant | general generative-art practice, determinism, editions |

They are layered on purpose: the always-loaded file stays short, engine detail loads only when
relevant, and deep technique notes load only when the skill needs them.

---

## W. Updating

```bash
npm outdated
npm update              # minor/patch
npm install three@latest p5@latest vite@latest tweakpane@latest    # majors, deliberately
npx playwright install chromium                                     # after a Playwright bump
npm run check           # confirm nothing broke
npm run render -- p5-example && npm run render -- three-example     # and confirm visually
```

Three.js makes breaking changes between minor versions; re-render both examples after upgrading.

The `genart` plugin is **not** part of this repository. Update it through Claude Code:

```
/plugin marketplace update camilleroux-genart
```

Never copy the plugin's files into this repo — it stays independently installable and
updatable.
# gen_art_collection_repo

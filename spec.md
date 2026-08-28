# BUILD SPEC — Generative Art Studio for Claude Code

## Objective

Build a permanent local creative-coding studio optimized for using Claude Code to create **high-quality generative artwork from screenshots, reference images, descriptions, and iterative prompts**.

The studio must support both:

* **p5.js**
* **Three.js / WebGL**

They must coexist in the same repository while individual artworks remain cleanly separated by rendering engine.

The finished repository should make workflows like these possible:

> Make this in p5.

> Recreate the visual system in this screenshot using Three.js.

> Make a generative artwork inspired by this. Choose whichever engine makes more sense.

> Make this composition less uniform and more organic.

> Give this much stronger depth and lighting.

> Render 12 seeds and show me which ones work best.

> Push this much further. Render it and critique the result before stopping.

The goal is emphatically **not just to generate valid JavaScript**.

The goal is to make Claude operate as a **generative artist + creative-coding engineer + visual critic** inside this repository.

---

# 1. Operating instructions for this setup task

Perform the setup yourself as completely as possible.

Do not stop after creating a scaffold.

Do not repeatedly ask me for permission between normal local development steps.

You may:

* create files and folders
* initialize npm
* install npm dependencies
* configure Vite
* create Claude Code skills/rules
* create rendering utilities
* create example artworks
* run builds
* run the dev server for testing
* run Playwright
* capture screenshots
* debug failures
* modify configuration
* create documentation

Before changing anything, inspect the current directory.

If it is empty, build the studio here.

If it already contains files that could conflict with this project, create a `generative-studio` directory rather than overwriting unrelated work.

Use plain modern JavaScript unless there is an unusually strong reason not to.

Do NOT add React, Vue, Next.js, TypeScript, Tailwind, or another application framework. This is a creative-coding studio, not a web application product.

Use Vite as the development shell.

At the end:

1. Make sure the application runs.
2. Make sure both a p5 artwork and a Three.js artwork work.
3. Make sure automated screenshot capture works.
4. Run a production build.
5. Review the finished README for completeness.
6. Give me a concise summary of what you created.
7. Give me a section titled **WHAT YOU NEED TO DO NOW** containing every remaining manual action I need to perform.
8. If nothing remains, explicitly say that setup is complete and tell me the exact command to launch the studio.

Do not claim something works unless you tested it.

---

# 2. Environment audit

Before building, determine what is already installed.

Check at minimum:

* operating system
* Git
* Node.js
* npm
* Claude Code version if accessible
* whether this is already a Git repository
* whether the `genart` Claude Code plugin appears to be installed

Use a currently supported Node version appropriate for Vite.

If a prerequisite is unavailable and cannot safely be installed automatically, continue building everything else possible and put the exact missing prerequisite and installation instructions under **WHAT YOU NEED TO DO NOW**.

Do not make me manually install something that you can reasonably install from the project.

---

# 3. Core dependencies

The project should use approximately this stack:

### Runtime

* Vite
* p5
* three
* tweakpane

### Development / rendering

* Playwright
* Chromium for Playwright

Add another small dependency only when it materially simplifies the studio.

Avoid dependency bloat.

Install Playwright's Chromium browser as part of setup if possible.

---

# 4. Install and verify the genart Claude skill

This project should be designed to work with:

`camilleroux/genart-skill`

The Claude Code plugin installation commands are:

```text
/plugin marketplace add camilleroux/genart-skill
/plugin install genart@camilleroux-genart
```

Do not copy the plugin's internal scripts or skill files into this repository.

The plugin should remain independently installed so it can be updated normally.

Verify whether it is currently available.

If Claude Code cannot execute its own `/plugin` commands programmatically during this setup session, do NOT treat that as a setup failure.

Instead, finish the repository and put these exact commands under **WHAT YOU NEED TO DO NOW**, explaining that they should be entered into Claude Code.

The project must still have its own rendering workflow so that its core functionality does not break if the external plugin is unavailable.

The `genart` skill should supplement this studio with knowledge around:

* generative-art practice
* deterministic randomness
* seed handling
* resolution independence
* export
* edition/contact-sheet thinking
* creative coding techniques
* generative-art verification

Our custom project skill will handle the more specific **reference-image → visual analysis → implementation → rendering → critique** workflow.

---

# 5. Repository architecture

Create a clean structure based on the following:

```text
generative-studio/
│
├── CLAUDE.md
├── README.md
├── package.json
├── vite.config.js
├── index.html
├── .gitignore
│
├── .claude/
│   ├── settings.json                 # only if useful
│   │
│   ├── rules/
│   │   ├── p5-artworks.md
│   │   └── three-artworks.md
│   │
│   └── skills/
│       └── art-from-reference/
│           ├── SKILL.md
│           └── references/
│               ├── visual-analysis.md
│               ├── p5-techniques.md
│               └── three-techniques.md
│
├── src/
│   ├── main.js
│   ├── style.css
│   │
│   ├── runtime/
│   │   ├── artwork-registry.js
│   │   ├── p5-host.js
│   │   └── three-host.js
│   │
│   ├── shared/
│   │   ├── random.js
│   │   ├── palettes.js
│   │   ├── math.js
│   │   └── export.js
│   │
│   └── artworks/
│       ├── p5-example/
│       │   ├── meta.js
│       │   └── sketch.p5.js
│       │
│       └── three-example/
│           ├── meta.js
│           └── scene.three.js
│
├── references/
│   └── .gitkeep
│
├── renders/
│   └── .gitkeep
│
├── examples/
│   └── README.md
│
└── scripts/
    ├── render-artwork.mjs
    ├── render-grid.mjs
    └── validate-artworks.mjs
```

You may adjust minor details if implementation realities require it, but preserve the underlying architecture.

---

# 6. Critical architecture rule: p5 and Three stay separate

Do NOT create one giant abstraction that attempts to make p5 and Three.js behave as if they are the same library.

They aren't.

They should be interchangeable at the **studio level**, not inside artwork implementations.

Each artwork directory uses exactly one rendering engine.

A p5 artwork should primarily contain:

```text
sketch.p5.js
```

A Three.js artwork should primarily contain:

```text
scene.three.js
```

Both live under:

```text
src/artworks/<artwork-slug>/
```

Examples:

```text
src/artworks/flow-study/sketch.p5.js

src/artworks/glass-landscape/scene.three.js
```

Never put unrelated artworks into the same giant script.

Never rewrite an old artwork just to create a new experiment.

New idea = new artwork directory unless I explicitly ask to revise an existing piece.

---

# 7. Artwork metadata

Every artwork should include a small `meta.js`.

Use a simple contract similar to:

```js
export default {
  title: "Flow Study",
  engine: "p5",
  seed: 483928,
  width: 1200,
  height: 1200,
  animated: false
};
```

Three.js example:

```js
export default {
  title: "Glass Landscape",
  engine: "three",
  seed: 934222,
  width: 1200,
  height: 1200,
  animated: true
};
```

Reasonable additional metadata is acceptable, but keep the contract small.

---

# 8. p5 architecture

Use **p5 instance mode**, not global mode.

An individual p5 artwork should expose the sketch itself rather than initialize unrelated page UI.

The p5 runtime should own mounting/unmounting.

The artwork should concentrate on artwork.

The host should handle things such as:

* choosing the container
* destroying the previous p5 instance
* seed passed by the studio
* resize/capture integration
* hiding studio chrome during automated renders

Seed `random()` and `noise()` appropriately when deterministic output is intended.

Avoid unnecessary DOM elements created by sketches.

---

# 9. Three.js architecture

Three.js artwork code may own:

* Scene
* Camera
* Renderer
* Geometry
* Materials
* Lights
* animation
* shaders
* post-processing when required

The studio host should provide the mounting container and common context.

Every Three artwork must clean up after itself.

Dispose of appropriate:

* geometries
* materials
* textures
* render targets
* renderer resources
* event listeners
* animation loops

Avoid memory leaks when switching artworks.

Do not add OrbitControls by default.

Add interaction only when it is artistically useful.

---

# 10. Artwork discovery

Prefer automatic artwork discovery using Vite capabilities such as `import.meta.glob`.

Creating a new artwork directory should NOT require editing five registry files.

The studio should discover:

* metadata
* p5 artworks
* Three artworks

from `src/artworks/`.

---

# 11. Studio UI

Build a deliberately minimal development interface.

This is NOT the artwork.

The interface should help me browse and develop artworks.

Include:

* artwork selector/gallery
* artwork title
* engine indicator
* current seed
* new/random seed action
* ability to enter a specific seed
* reload/reset
* pause/play when relevant
* direct access to a clean artwork-only rendering URL

Do not create a giant dashboard.

Do not let the development UI visually interfere with artwork.

Support a URL pattern approximately like:

```text
?art=flow-study&seed=12345
```

and:

```text
?art=flow-study&seed=12345&capture=1
```

When `capture=1`:

* hide studio navigation
* hide debug panels
* remove margins
* render only the artwork
* use the artwork's intended dimensions/aspect ratio
* make automated screenshots reliable

If a better query structure makes implementation cleaner, that is acceptable.

---

# 12. Tweakpane

Install Tweakpane and make it easy for artwork implementations to use.

Do not force every artwork to have controls.

Claude should add controls when adjusting parameters interactively would improve visual iteration.

Typical useful controls include:

* seed
* density
* scale
* spacing
* line width
* opacity
* noise scale
* noise amplitude
* distortion
* palette
* speed
* camera FOV
* camera distance
* lighting
* roughness
* particle count

Debug controls must be hidden from final/capture renders.

---

# 13. Deterministic randomness

Create simple shared utilities for seeded randomness.

Do not build a gigantic framework.

The important behavior is:

* given the same seed, an artwork intended to be deterministic should reproduce the same composition on the same environment
* visual refinement should generally happen against a locked seed
* new seeds should be easy to explore afterward

When an artwork relies on randomness:

1. establish a seed
2. keep that seed fixed while matching/comparing
3. verify multiple seeds once the system is visually successful

Make it possible to pass the seed from the URL.

---

# 14. Automated rendering

This is one of the most important features in the repository.

Create a Playwright-based renderer.

I want Claude to be able to run something approximately like:

```bash
npm run render -- flow-study
```

and get:

```text
renders/flow-study/latest.png
```

Also support an explicit seed:

```bash
npm run render -- flow-study --seed 483928
```

The script should:

1. ensure the studio is available
2. open the desired artwork in capture mode
3. wait until rendering is ready
4. capture the artwork
5. write a predictable PNG path
6. exit cleanly
7. report useful errors

Do not require me to manually open Chrome.

Use an explicit readiness signal if needed instead of depending purely on fragile arbitrary sleeps.

It is acceptable to have a small timeout fallback.

---

# 15. Multi-seed rendering / contact sheets

Create a command approximately like:

```bash
npm run render:grid -- flow-study --count 12
```

This should render multiple deterministic seeds.

Produce either:

* individual renders plus a contact sheet

or, if contact-sheet composition materially complicates the implementation:

* a clearly organized directory of numbered/seeded PNGs

Prefer a contact sheet if reasonably straightforward.

This exists so Claude and I can evaluate whether an actual **generator** is strong rather than judging one lucky seed.

---

# 16. Validation

Create:

```bash
npm run check
```

It should at minimum validate:

* artwork metadata
* supported engine
* expected artwork file exists
* duplicate/invalid slug problems where relevant
* production build

Feel free to compose several commands under `npm run check`.

Do not create an elaborate test framework simply for the sake of testing.

---

# 17. Required package scripts

Provide intuitive scripts, ideally including:

```text
npm run dev
npm run build
npm run preview
npm run render -- <artwork>
npm run render:grid -- <artwork>
npm run check
```

Document every command in the README.

---

# 18. Root CLAUDE.md

Create a concise project-level `CLAUDE.md`.

Do NOT turn it into an encyclopedia.

Keep it roughly under 200 lines if practical.

Its job is to provide rules Claude should remember during essentially every session.

It must establish at least the following principles.

## Project identity

This repository is a dedicated creative-coding studio for producing high-quality generative artwork using p5.js or Three.js.

## Primary goal

Optimize for:

* visual quality
* originality
* composition
* visual hierarchy
* texture
* motion
* deliberate artistic decisions

Code correctness is necessary but is not sufficient.

Treat generative-art tasks as visual design problems first and programming problems second.

## Engine routing

If I explicitly request p5 or Three, obey that request.

If unspecified:

Prefer p5 for:

* 2D drawing
* lines
* grids
* flow fields
* typography
* planar particles
* noise-based compositions
* painterly work
* vector-like work
* mark-making

Prefer Three.js for:

* real perspective
* depth
* meshes
* cameras
* spatial particles
* lighting
* shadows
* materials
* shader-heavy work
* volumetric/spatial scenes

Do not choose Three merely because it sounds more sophisticated.

## Separation

One artwork = one artwork directory.

One artwork = one engine unless I explicitly request something hybrid.

Never mix unrelated experiments.

## Reference-image behavior

When given a screenshot/image, Claude must reason about the **visual system**, not merely enumerate visible objects.

Analyze things like:

* composition
* negative space
* dominant geometry
* hierarchy
* distributions
* scale
* density
* color
* contrast
* texture
* line/edge quality
* repetition
* randomness
* depth
* lighting
* motion

## Mandatory visual loop

For meaningful visual tasks:

1. implement
2. run
3. render
4. inspect the rendered image
5. critique it against the goal/reference
6. identify the biggest visual problems
7. modify
8. render again

Repeat while meaningful visual improvements remain.

Claude must NOT say:

* "this should look..."
* "this creates..."
* "it now matches..."
* "this feels more..."

as a substitute for actually looking at the resulting render.

## Generative-quality principles

Prefer structured systems to arbitrary randomness.

Consider:

* weighted distributions
* clustering
* Poisson sampling
* noise fields
* flow fields
* subdivision
* attractors
* packing
* agents
* recursive systems
* field-based deformation

Avoid uniform random placement when a designed distribution would work better.

## Common weak LLM aesthetics to avoid

Do not default to:

* uniformly scattered circles
* random rainbow color
* generic neon gradients
* obligatory particles
* excessive bloom
* generic cyberpunk
* needless orbit controls
* random Perlin wobble on everything
* glowing wireframes
* complexity without hierarchy

Use a small number of strong interacting visual systems.

## Matching priority

When matching a reference, prioritize:

1. overall composition
2. occupied vs negative space
3. silhouette / dominant geometry
4. proportions
5. scale hierarchy
6. density / spacing
7. color relationships
8. depth / lighting
9. texture
10. small details

A compositionally accurate simplified image is better than an elaborately detailed incorrect composition.

## Existing work

Do not modify unrelated artwork directories.

Prefer creating a new artwork for a new concept.

## Skills

Use the installed `genart` skill when relevant.

Use the project `art-from-reference` skill for image/reference-driven work.

---

# 19. Path-specific Claude rules

Use `.claude/rules/` to keep engine-specific instructions out of the always-loaded root instructions.

Create:

```text
.claude/rules/p5-artworks.md
```

scoped to p5 artwork files.

It should cover things such as:

* instance mode
* seeded randomness
* no unnecessary DOM
* sensible canvas scaling
* avoid allocations inside hot loops
* use offscreen graphics when appropriate
* exploit p5's actual strengths
* visual quality over generic demo-code aesthetics

Create:

```text
.claude/rules/three-artworks.md
```

scoped to Three artwork files.

It should cover:

* cleanup/disposal
* avoid unnecessary per-frame allocations
* reuse vectors/materials/geometry where practical
* InstancedMesh for large repeated meshes when appropriate
* BufferGeometry/shaders where useful
* camera composition matters
* lighting/material choices must be deliberate
* no default OrbitControls
* do not use expensive post-processing merely to make weak geometry appear interesting

Use correct path-scoped rule frontmatter.

---

# 20. Custom skill: `art-from-reference`

Create:

```text
.claude/skills/art-from-reference/SKILL.md
```

This skill should trigger whenever I ask Claude to:

* create artwork from a screenshot
* recreate an image
* make something "like this"
* create artwork inspired by a supplied reference
* substantially revise an artwork based on visual feedback
* infer a generative system from visual inspiration

The skill should make Claude behave like a **generative artist, visual analyst, and creative-coding engineer**.

It should use progressive disclosure: keep the main workflow in `SKILL.md` and detailed technique notes in `references/`.

The skill must enforce the following workflow.

---

## Phase 1 — Visual decomposition

Before implementation, determine:

### Composition

* focal region
* major masses
* empty/negative regions
* balance/asymmetry
* crop
* orientation
* center of gravity

### Geometry

Infer likely visual primitives:

* points
* lines
* curves
* polygons
* grids
* contours
* meshes
* ribbons
* splines
* repeated modules
* surfaces
* particles

### Distribution

Determine whether placement resembles:

* uniform
* Gaussian
* clustered
* Poisson-disc
* grid-derived
* recursive subdivision
* flow-field-driven
* noise-driven
* attractor-driven
* physically simulated
* manually composed

Do not default to uniform randomness.

### Hierarchy

Estimate:

* large forms
* medium forms
* micro-detail
* scale relationships
* density gradients

### Surface

Analyze:

* line weight
* opacity
* grain
* blur
* glow
* gradients
* roughness
* layering
* blending
* transparency
* hatching/stippling
* edge characteristics

### Color

Infer a deliberately constrained palette and identify:

* background
* dominant colors
* secondary colors
* accent colors
* highlights
* shadows

Do not independently randomize RGB/HSL values.

### Depth

Determine whether depth is:

* genuinely 3D

or merely:

* layering
* scale
* overlap
* atmospheric cues
* 2D perspective tricks

Do not automatically reach for Three.js.

---

## Phase 2 — Engine choice

Explicit user engine choice always wins.

Otherwise select based on the visual system.

Use p5 when the work fundamentally consists of marks on a plane.

Use Three when the work fundamentally depends on:

* camera projection
* physical depth
* occlusion
* 3D surfaces
* spatial geometry
* lighting
* material response
* shaders requiring a Three/WebGL environment

Explain the choice briefly when the user did not specify an engine.

---

## Phase 3 — Algorithm design

Identify roughly **2–4 principal systems** that account for most of the image's visual character.

Examples:

* warped grid + displacement field
* recursive subdivision + palette weighting
* flow field + particle trails
* contour system + distortion
* spline skeleton + repeated marks
* instanced forms + lighting
* SDF + fragment shader
* agents + interaction rules
* packing + scale hierarchy

Prefer a few interacting systems over lots of unrelated effects.

---

## Phase 4 — Coarse-to-fine implementation

Develop in approximately this order:

1. framing/canvas/camera
2. dominant spatial structure
3. large forms
4. proportions
5. density
6. color
7. secondary variation
8. texture
9. fine detail
10. animation / interaction

Do not spend significant effort on grain, glow, or micro-detail while the composition is still incorrect.

---

## Phase 5 — Lock the seed

Choose a deterministic comparison seed.

Keep it stable while refining visual correspondence.

Do not unknowingly compare different random outputs after each code change.

After the artwork becomes visually strong, inspect additional seeds.

---

## Phase 6 — Mandatory render/critique loop

After the first implementation:

1. run the artwork
2. render it
3. inspect the actual PNG
4. compare against the reference/goal
5. identify the three biggest visual discrepancies
6. fix the most important discrepancy
7. render again
8. inspect again

Perform multiple iterations when useful.

Do not evaluate visual success purely from source code.

The iteration loop is a core part of the creative process, not optional QA.

---

# 21. Skill reference: `visual-analysis.md`

Create a concise reference document teaching Claude how to analyze image references algorithmically.

Emphasize questions such as:

* What creates the composition?
* Where is the visual density?
* Where is empty space?
* What appears deterministic?
* What appears stochastic?
* What distribution would create these positions?
* What scale hierarchy exists?
* Which relationships matter more than individual objects?
* What creates texture?
* What creates depth?
* Which details could be omitted without losing the image's identity?
* Which 20% of visual mechanisms create 80% of the effect?

Teach Claude to convert:

```text
image appearance
```

into:

```text
algorithmic relationships
```

rather than translating it into a literal object-by-object drawing.

---

# 22. Skill reference: `p5-techniques.md`

Create a practical creative-coding cookbook for techniques Claude should consider rather than repeatedly defaulting to simple random primitives.

Include short guidance on when to consider:

* flow fields
* curl-like fields
* domain warping
* layered noise
* Poisson-disc sampling
* Gaussian/weighted distributions
* recursive subdivision
* packing
* agent systems
* particle advection
* trail accumulation
* differential-growth concepts
* contour systems
* grids and warped grids
* splines
* Bézier structures
* reaction-diffusion concepts
* L-systems
* Delaunay/Voronoi when useful
* offscreen graphics buffers
* masking
* blend modes
* pixel manipulation
* grain
* hatching
* stippling
* feedback systems
* vector/export-oriented strategies

Do not write a giant textbook.

Make it a decision aid.

---

# 23. Skill reference: `three-techniques.md`

Create the equivalent decision aid for Three.js.

Include:

* BufferGeometry
* InstancedMesh
* Points
* custom ShaderMaterial
* vertex displacement
* fragment shaders
* SDF techniques
* procedural textures
* FBO/ping-pong techniques
* GPU particles
* curve/spline geometry
* ribbons
* custom normals
* orthographic vs perspective composition
* directional/area/environment lighting
* fog/depth cues
* physically based materials
* selective post-processing
* domain warping/noise in GLSL
* raymarching concepts when genuinely useful

Again: decision aid, not encyclopedia.

---

# 24. Reference-image storage

Create:

```text
references/
```

This is where persistent screenshots/reference images can be stored.

Recommended convention:

```text
references/<artwork-slug>/
```

For example:

```text
references/forest-lines/reference.png
references/forest-lines/reference-2.png
```

Claude must still be able to work from an image directly attached to the Claude Code conversation even when the attachment does not have a convenient repository path.

Do not block art generation merely because a reference was supplied through chat instead of saved in `references/`.

Explain the distinction in README.

---

# 25. Render storage

Use:

```text
renders/<artwork-slug>/
```

Keep at least:

```text
latest.png
```

Organize multi-seed renders sensibly.

Avoid filling Git history with generated PNGs unless there is a reason.

Configure `.gitignore` appropriately.

A `.gitkeep` is fine for preserving the top-level directory.

---

# 26. Curated examples library

Create:

```text
examples/
```

This is intentionally different from `src/artworks/`.

`src/artworks/` contains active runnable artworks.

`examples/` is a future knowledge library for successful patterns I want Claude to learn from.

Create `examples/README.md` explaining that over time I can save strong previous experiments such as:

```text
examples/great-flow-fields/
examples/great-line-work/
examples/great-particles/
examples/great-three-shaders/
examples/great-subdivision/
```

Claude may inspect relevant examples for:

* algorithmic patterns
* composition techniques
* performance solutions
* useful abstractions
* shader patterns

Claude must NOT blindly reproduce the composition.

The idea is to build a local corpus of techniques and creative-coding approaches that have already worked well for me.

---

# 27. README.md — extremely important

Create an excellent human-facing root README.

This is my manual for the studio.

Assume that months from now I may remember none of the setup details.

It must tell me everything useful I can do in this repository without requiring me to inspect source code.

Use clear headings and concise explanations.

Include at minimum the following sections.

---

## A. What this repo is

Explain:

* permanent generative-art studio
* Claude Code is intended to work inside it
* p5 and Three coexist
* each artwork is isolated
* visual feedback/rendering is central

---

## B. First-time setup

Document:

* prerequisites
* Node/npm requirements
* installation
* Playwright Chromium setup
* Claude Code requirements
* genart plugin installation
* how to verify the project

Include exact commands.

---

## C. Starting the studio

Show exact command:

```bash
npm run dev
```

Explain the local URL and what appears.

---

## D. Creating artwork

Explain the normal workflow.

For example:

1. launch Claude Code from repo root
2. optionally attach a screenshot
3. give a simple prompt
4. Claude creates a new artwork directory
5. Claude implements it
6. Claude renders it
7. Claude visually critiques it
8. Claude iterates
9. open it in the browser

---

## E. How to prompt Claude

This section is very important.

Explain that I should NOT need giant prompts because the repository supplies the workflow.

Include examples like:

### Explicit p5

> Make this in p5.

### Explicit Three

> Recreate this using Three.js.

### Let Claude choose

> Create a generative system inspired by this image. Choose the engine that makes the most sense.

### More artistic freedom

> Use this only as compositional inspiration. Create something original with a similar density and visual rhythm.

### Improve something

> The current version feels too uniform. Make the scale distribution more interesting and create stronger negative space. Render and inspect it before stopping.

### Push quality

> Push this substantially further. Don't just add more detail. Improve the underlying composition and visual system, then render and critique it.

### Seed exploration

> The system is working. Render 12 different seeds and identify which compositions are strongest and why.

### Engine conversion

> Make a new Three.js interpretation of this p5 experiment. Keep the original untouched.

Explicitly explain that **conversion should normally create a new artwork instead of overwriting the old implementation**.

---

## F. Choosing p5 vs Three.js

Include a readable comparison.

### p5 is generally best for

* 2D marks
* lines
* fields
* grids
* flow
* drawing systems
* typography
* painterly algorithms
* planar particles

### Three is generally best for

* 3D
* meshes
* cameras
* lighting
* materials
* spatial systems
* deep particle fields
* shader-heavy scenes

Also explain:

**Do not use Three just because it sounds more advanced.**

---

## G. Why p5 and Three are kept separate

Explain the architecture philosophy:

They coexist in the same studio, but individual artwork code remains native to its engine.

This prevents bad abstractions and lets Claude use each library naturally.

---

## H. Repository structure

Document the key directories and what belongs in each.

---

## I. Artwork contract

Document `meta.js`.

Document p5 artwork expectations.

Document Three artwork expectations.

---

## J. Seeds

Explain:

* what a seed is
* why locked seeds help iterative visual development
* how to set one
* how to generate another
* how to render one specific seed

Keep explanation practical rather than mathematical.

---

## K. Rendering

Document:

```bash
npm run render -- <artwork>
```

and seed usage.

Explain where PNGs appear.

Explain that Claude is expected to inspect those renders itself during development.

---

## L. Contact sheets / multiple seeds

Document the multi-seed command.

Explain why evaluating several seeds matters for generative art.

---

## M. Tweakpane

Explain:

* what it is
* when Claude will use it
* that it is for development/refinement
* that controls disappear during clean captures

---

## N. Working from screenshots

Explain both workflows:

### Fast workflow

Attach/paste screenshot directly into Claude Code and prompt naturally.

### Persistent-reference workflow

Save image under:

```text
references/<artwork-name>/
```

and tell Claude to use it.

Explain that persistent references are useful for returning to an artwork later.

---

## O. The visual feedback loop

Explicitly document:

```text
REFERENCE
   ↓
ANALYZE VISUAL SYSTEM
   ↓
SELECT ENGINE
   ↓
IMPLEMENT
   ↓
RENDER
   ↓
INSPECT PNG
   ↓
CRITIQUE
   ↓
MODIFY
   ↓
RENDER AGAIN
```

Explain why this repository insists on this workflow.

The problem we are solving is LLMs generating plausible code without actually judging what the code produced.

---

## P. How to get better results

Include advice such as:

* describe what feels wrong visually, not only what code to change
* reference composition, density, rhythm, hierarchy, scale, texture and negative space
* ask Claude to "push the system", not merely "add detail"
* lock a seed while refining
* explore many seeds afterward
* save successful approaches into `examples/`
* explicitly tell Claude when you want interpretation rather than recreation
* use screenshots liberally
* use p5 for planar problems instead of automatically escalating to Three
* ask Claude to render and critique when it appears to be stopping too early

---

## Q. Good vs weak prompts

Include examples demonstrating the difference.

Weak:

> Add more particles.

Better:

> The center feels empty accidentally rather than deliberately. Increase density near the lower-left mass, preserve negative space in the upper-right, and introduce more variation in particle scale.

Weak:

> Make it cooler.

Better:

> The piece feels like a generic particle demo. Reduce the number of independent effects, establish one dominant flow direction, introduce clustered density, and use a restrained palette.

The README should teach me a little bit of visual vocabulary without becoming an art textbook.

---

## R. Commands reference

Create one concise command table with every npm command and what it does.

---

## S. Adding successful examples

Explain how and why to populate `examples/`.

---

## T. Creating a fresh artwork manually

Even though Claude will usually do this, explain how a human could create:

```text
src/artworks/my-piece/meta.js
src/artworks/my-piece/sketch.p5.js
```

or:

```text
src/artworks/my-piece/meta.js
src/artworks/my-piece/scene.three.js
```

---

## U. Troubleshooting

Include likely issues:

* Playwright Chromium missing
* port already in use
* artwork doesn't appear
* bad metadata
* Three canvas not resizing
* p5 global-mode conflicts
* screenshot occurs before scene is ready
* shader errors
* WebGL issues
* genart plugin unavailable

Give practical fixes.

---

## V. Claude configuration

Explain:

* purpose of `CLAUDE.md`
* purpose of `.claude/rules/`
* purpose of `.claude/skills/art-from-reference/`
* purpose of external `genart` plugin
* how these complement one another

---

## W. Updating the project

Document normal dependency update practices.

Also explain that the external genart plugin should be updated through Claude Code's plugin mechanism rather than copied into this repo.

---

# 28. Avoid excessive abstraction

This repository should be pleasant for Claude to understand.

Do not build:

* a huge class hierarchy
* an "art framework" with dozens of concepts
* an ECS
* a plugin system inside our plugin system
* complicated dependency injection
* unnecessary build tooling
* a generic abstraction over every p5 and Three API

The runtime exists to eliminate repetitive boilerplate.

Artwork code should remain expressive and direct.

---

# 29. Performance expectations

Aim for smooth interactive desktop browser performance.

Claude should routinely consider:

### p5

* pixel density
* object allocation
* expensive nested loops
* repeated noise calls
* offscreen buffers
* precomputation where useful

### Three

* draw calls
* InstancedMesh
* shared geometry/materials
* BufferGeometry
* shader-based approaches for large repeated systems
* avoiding needless object creation per animation frame
* GPU vs CPU responsibilities

Do not prematurely optimize small sketches.

Do address obvious performance problems.

---

# 30. Creative quality principles

The project should consistently communicate the following philosophy to Claude.

### Structured randomness

Randomness should have purpose.

Prefer relationships such as:

* clusters
* attractors
* gradients
* weighted choices
* fields
* masks
* nested scales
* directional tendencies
* exclusion zones
* recurrence

over:

```js
x = random(width)
y = random(height)
size = random(100)
color = random(colors)
```

for every object independently.

### Hierarchy

Strong images usually contain different scales of information.

Think in:

* macro structure
* middle structure
* micro texture

### Negative space

Empty space is an active compositional tool.

Do not automatically fill the canvas.

### Variation

Variation should be correlated where appropriate.

Real visual systems often contain local relationships rather than independent randomness.

### Detail

Detail should reinforce the underlying structure.

Do not use texture to hide weak composition.

---

# 31. Create two starter artworks

Build two intentionally simple but aesthetically competent test artworks.

## `p5-example`

Use p5.

It should demonstrate:

* seeded randomness
* non-uniform distribution
* deliberate palette
* instance-mode setup
* resize/capture compatibility

Do NOT make it a random-circle demo.

## `three-example`

Use Three.js.

It should demonstrate:

* camera
* real spatial depth
* intentional lighting/materials
* deterministic arrangement where practical
* clean disposal
* capture compatibility

Do NOT make it a spinning rainbow cube.

The examples are architectural validation, not portfolio masterpieces.

---

# 32. Test the full workflow

Before declaring setup complete:

### p5

* open `p5-example`
* confirm it renders
* render PNG through Playwright
* confirm PNG exists
* inspect for obvious failure

### Three

* open `three-example`
* confirm it renders
* render PNG
* confirm PNG exists
* inspect for obvious failure

### Seeds

Confirm explicit seed URLs/commands work.

### Studio

Confirm switching between p5 and Three works without refresh-related breakage or leaked canvases.

### Build

Run the production build.

### Validation

Run `npm run check`.

Fix failures.

---

# 33. Git hygiene

Create a sensible `.gitignore`.

Generally ignore:

* `node_modules`
* Vite build output
* temporary render output
* OS junk
* logs
* local-only Claude configuration if appropriate

Keep:

* project Claude instructions
* skills
* rules
* source code
* README
* reference directory structure
* examples documentation

Do not accidentally ignore `.claude/skills` or `.claude/rules`.

---

# 34. Final response to me

When setup is complete, do not dump every implementation detail.

Give me:

## CREATED

Brief summary of architecture.

## VERIFIED

State exactly what you actually tested successfully.

## GENART PLUGIN STATUS

Tell me whether it is installed/available.

If not, give me:

```text
/plugin marketplace add camilleroux/genart-skill
/plugin install genart@camilleroux-genart
```

## WHAT YOU NEED TO DO NOW

Give me an ordered list of only the actions that genuinely remain.

For example:

1. Install the genart Claude plugin with these commands.
2. Run `npm run dev`.
3. Open the local URL.
4. Attach an image and say `Make this in p5.`

Do not tell me to configure things that are already configured.

## FIRST PROMPT TO TRY

Finish with a suggested first test prompt:

> Use the attached image as a reference and create a new generative artwork from it. Choose p5.js or Three.js based on the visual system unless I specify otherwise. Establish a deterministic seed, implement the major composition first, render the result, inspect your render against the reference, and iterate on the largest visual discrepancies before stopping.

Also remind me that after setup I should usually be able to use much shorter prompts such as:

> Make this in p5.

or:

> Make a Three.js version of this.

because the repository's instructions and skills already define the full workflow.

---

# Definition of done

This task is complete only when the repository functions as a reusable **Claude-powered generative-art studio**, not merely when Vite starts.

I should be able to return to this repository repeatedly, launch Claude Code, attach visual inspiration, request either p5.js or Three.js work, and have Claude:

**analyze → implement → render → inspect → critique → iterate**

without needing me to re-explain the workflow every session.

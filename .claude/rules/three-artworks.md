---
description: Conventions for Three.js artwork files in this studio
paths: ["src/artworks/**/*.three.js"]
---

# Three.js artwork rules

## Contract

The file default-exports a factory returning a small handle. The host owns the renderer, the
animation loop, capture sizing and teardown.

```js
export default function scene(ctx) {
  const world = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, ctx.width / ctx.height, 0.5, 400);
  return {
    scene: world, camera,
    update(t, dt) {},
    resize(w, h) {},
    render(renderer) {},   // optional — only for post-processing
    dispose() {}
  };
}
```

`ctx = { renderer, width, height, seed, rng, noise, capture, pane, reload, artwork }`

- Do not create a `WebGLRenderer` — use `ctx.renderer`. Setting `shadowMap`, `toneMapping` and
  exposure on it is expected.
- Do not start your own `requestAnimationFrame` loop; put per-frame work in `update(t, dt)`.
- Captures advance on a fixed timestep, so `update` must derive motion from `t`, never from
  `Date.now()` or `performance.now()`, or renders stop being reproducible.
- Never call `Math.random()`; use `ctx.rng` / `ctx.noise`.

## Cleanup

`dispose()` must release everything the artwork created: geometries, materials, textures, render
targets, shadow maps, and any listeners or timers. `disposeObject(root)` from
`src/runtime/three-host.js` traverses a scene graph and disposes geometry, materials and their
textures. Switching artworks in the studio must not leak a canvas or a GL context.

## Performance

- Watch draw calls. Many copies of one mesh is `InstancedMesh`, not a loop of `Mesh` objects.
  Above ~100k elements, move to `Points` or a custom `ShaderMaterial`.
- Share geometry and material instances; do not build a new material per object.
- Allocate no `Vector3`/`Matrix4`/`Color` inside `update()`. Hoist scratch objects to the
  factory scope and mutate them.
- Prefer `BufferGeometry` with typed arrays for generated forms, and GPU work (vertex
  displacement, instancing, shaders) over per-frame CPU rebuilds.

## Composition

- Camera placement is a compositional decision: frame the subject, decide what leaves the frame,
  and leave negative space. A field that fills every edge reads as a texture, not an image.
  Look at the render and judge the silhouette.
- Consider orthographic when the piece is about pattern and structure rather than perspective.
- Lighting must be deliberate: usually one dominant key that creates readable shadow direction,
  plus restrained fill. Raking light reveals form; flat frontal light hides it.
- Use fog, scale falloff and atmospheric value shift as depth cues before reaching for effects.
- **No OrbitControls by default.** Add interaction only when it is artistically necessary.
- Do not use post-processing (bloom especially) to make weak geometry look interesting. Fix the
  geometry, the lighting and the framing first. See
  `.claude/skills/art-from-reference/references/three-techniques.md`.

# Three.js technique decision aid

A menu, not a textbook. The host owns the renderer and the loop; artworks own scene, camera,
geometry, materials, lights and shaders. See `.claude/rules/three-artworks.md` for the contract.

## Geometry strategy

| Want | Reach for |
| --- | --- |
| thousands of copies of one form | **InstancedMesh** — one draw call; per-instance matrix and colour |
| 10⁵+ elements, no lighting needed | **Points** with a `ShaderMaterial`, size attenuation, soft sprite alpha |
| a generated surface or form | **BufferGeometry** with typed position/normal/uv arrays |
| a surface that moves | **vertex shader displacement** — keep the geometry static on the CPU |
| tubes, cables, growth along a path | `CatmullRomCurve3` + `TubeGeometry`, or a custom ribbon from a frame |
| ribbons that face the camera | build quads from a curve, orient with the camera-facing binormal |
| implicit or volumetric form | raymarched SDF in a fullscreen fragment shader — only when the piece truly needs it |

Prefer few large buffers over many small objects. Merging static geometry beats a scene graph of
hundreds of meshes.

## Shaders

- `ShaderMaterial` / `onBeforeCompile` when a material behaviour cannot be expressed with the
  standard materials. Patch the standard material when you want lighting for free.
- Port the noise you already use: fbm and domain warping in GLSL give the same families of form
  as `src/shared/math.js`, evaluated per pixel or per vertex.
- **FBO / ping-pong**: two render targets swapped each frame hold state on the GPU — particle
  positions, reaction-diffusion, flow accumulation, feedback trails.
- Procedural texture in the fragment shader (stripes, gradients, noise, triplanar) avoids asset
  loading entirely and stays crisp at any resolution.
- Keep uniforms explicit; drive them from `update(t, dt)` so captures stay reproducible.

## Camera and framing

- Framing is composition. Decide the subject's silhouette in frame, what leaves the frame, and
  how much empty space surrounds it — then look at the render and judge it.
- Long lens (fov 20–35) compresses and flattens, reads as considered; wide (fov 60+) exaggerates
  and reads as a game camera. Default to the long end.
- **Orthographic** when the piece is about pattern, structure, repetition or elevation.
- Camera height decides whether a field reads as a landscape (low) or an object (high). If the
  subject fills every edge, you are inside it — pull back.
- Motion: slow arcs and drifts that keep the composition readable at every frame. Not spinning.

## Light and material

- One dominant key light with a clear direction, raking rather than frontal, plus restrained
  fill (`HemisphereLight`, or a low-intensity ambient). Shadow direction is what makes a form
  legible.
- Shadows: one shadow-casting light, a tight shadow camera frustum, `PCFSoftShadowMap`, and a
  small negative bias. Wide frustums waste resolution and produce acne.
- `MeshStandardMaterial` roughness/metalness are compositional choices: high roughness reads as
  stone/paper/clay, low as glass/metal. Do not leave defaults by accident.
- Environment lighting (`PMREMGenerator` + a generated or procedural environment) makes metal and
  glass believable; without it they look like plastic.
- Depth cues in order of value: occlusion, shadow, fog, scale falloff, atmospheric value shift.
  Fog colour should match the background exactly or the horizon shows a seam.

## Post-processing

Use it selectively and last. Bloom on weak geometry is the most recognisable failure mode in
LLM-written Three scenes. If a piece only looks interesting with bloom, fix the geometry,
lighting and framing instead.

Legitimate uses: subtle vignette, film grain matched to the piece, depth of field where focus is
compositional, tone mapping (`ACESFilmic`) plus deliberate exposure.

## Performance

Draw calls first, then per-frame allocation, then shader cost. Hoist scratch `Vector3`/`Matrix4`/
`Color` objects out of `update()`. Update instance matrices only when they change; set
`DynamicDrawUsage` when they change every frame. Shadow maps and large render targets are the
usual memory sinks — dispose them.

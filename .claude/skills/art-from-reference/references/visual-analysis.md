# Visual analysis

The purpose of looking at a reference is to convert **appearance** into **algorithmic
relationships**. Not "there are lines in the upper left" but "line density falls off with
distance from a mass whose centre sits at roughly 35%, 60%".

Literal object-by-object transcription produces dead images. Relationships produce living ones.

## The core questions

Work through these. Answer them out loud (briefly) before writing code.

**Structure**
- What single decision creates the composition? Remove it and the image collapses.
- Where is the visual centre of gravity? Is the frame balanced or deliberately weighted?
- What is the ratio of occupied to empty area? Is the empty space shaped, or leftover?
- Does anything cross or leave the frame? Where does the crop cut, and does that matter?

**Distribution**
- What placement rule would produce these positions? Test the candidates: grid, jittered grid,
  Poisson-disc, clustered/Gaussian, flow-field advection, subdivision, packing, physical
  settling, hand-placed.
- Is spacing even (Poisson/packing) or clumpy (uniform random)? Clumps and gaps are the
  signature of naive `random()`; even-but-not-gridded is the signature of a designed sampler.
- Is there a density *gradient*? What drives it — distance from a point, a noise field, an
  edge, a curve?

**Hierarchy**
- How many distinct scales of information exist? Name the macro form, the mid-level repetition,
  and the micro texture.
- What is the size ratio between the largest and smallest elements? Is size distributed evenly
  or heavily skewed (many small, few large)?
- What is the single most important element, and what makes it read as most important — size,
  value contrast, isolation, colour, position?

**Determinism vs stochasticity**
- What looks exactly repeated, and what looks perturbed?
- Where is the variation correlated (neighbours resemble neighbours) and where is it
  independent? Correlated variation implies a field; independent variation implies per-element
  randomness. Most convincing images are mostly correlated.

**Surface and texture**
- What actually creates the texture: many small marks, overlapping transparency, grain, noise
  in a shader, material roughness, or accumulated strokes?
- What is the line quality — uniform width, pressure-varying, tapered, broken, wobbling?
- How are elements blended: opaque overlap, multiply, additive, screen?

**Colour**
- How many colours are really in play? Usually fewer than it first appears.
- What is the value structure in greyscale? Squint at it: a strong image has a readable
  light/dark structure independent of hue.
- Which colour is the accent, and how little of it is used?
- Are colours tied to something (height, depth, density, direction) or applied per element?

**Depth**
- Is the depth genuine projection, or overlap + scale + atmospheric fade?
- If 3D: where is the light coming from, how hard is it, and what is the camera's height and
  focal length telling you?

## Reduction

Two questions decide the whole implementation:

1. **Which 20% of the visual mechanisms create 80% of the effect?** Build those first.
2. **Which details could be removed without losing the image's identity?** Do not build those
   until the rest is right.

A simplified image with correct composition, hierarchy and value structure reads as a successful
interpretation. A detailed image with the wrong composition reads as a failure, regardless of
how much work went into the detail.

## From analysis to parameters

Turn each observation into something with a number or a rule attached:

| Observation | Implementation |
| --- | --- |
| "dense at the bottom, thinning upward" | density = f(y), gate placement on it |
| "clumps of 5–10 near curves" | sample along splines with Gaussian offsets |
| "everything leans the same way" | one dominant angle field + small per-element jitter |
| "a few big ones, mostly small" | `rng.skew(2)` or a power-law size distribution |
| "even spacing, no grid" | Poisson-disc, with radius varying by field |
| "colour tracks height" | map value to a two-colour ramp; accent only at the extreme |
| "edges dissolve" | falloff mask on alpha/size; break runs where the mask fails |

When you cannot name the rule, describe the *relationship* and pick the simplest field that
produces it. Then render it and look.

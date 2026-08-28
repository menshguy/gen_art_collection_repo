# Examples — a personal corpus of what worked

This directory is **not** part of the running studio. Nothing here is loaded, built, or
rendered. `src/artworks/` holds live runnable artworks; `examples/` is a growing library of
techniques worth learning from.

## Why it exists

Over time you will produce pieces where something specific worked well: a distribution that
finally looked organic, a shader trick, a composition strategy, a performance fix. Copying that
folder here turns a one-off success into a reusable reference that Claude can read when it hits
a similar problem — a local corpus of approaches that have already proven themselves for *your*
taste, rather than generic internet defaults.

## How to add one

Copy the artwork directory out of `src/artworks/` into a named category folder, and add a short
note about what is worth stealing from it:

```
examples/
  great-flow-fields/
    forest-lines/          # copied from src/artworks/forest-lines
      meta.js
      sketch.p5.js
      reference.png        # optional: the render or reference it came from
    NOTES.md               # what works here and why
  great-line-work/
  great-particles/
  great-three-shaders/
  great-subdivision/
  great-lighting/
```

`NOTES.md` matters more than the code. One paragraph is enough:

> The density mask multiplies a radial falloff by a low-frequency fbm and a quadrant bias. That
> third term is what makes the empty corner read as deliberate instead of accidental. Reusable
> anywhere a composition needs shaped negative space.

## How Claude should use it

Claude may read these for **algorithmic patterns, composition strategies, performance solutions,
useful abstractions and shader patterns**.

Claude must **not** reproduce a composition from here into a new piece. The point is technique
transfer, not self-plagiarism. If you want a variation on an existing piece, say so explicitly.

## Suggested prompt

> Before implementing, look at `examples/great-flow-fields/` and use the density-masking
> approach from it, but build a new composition.

/**
 * p5 host.
 *
 * Owns mounting, unmounting, pixel density, seeding and the readiness signal
 * so that sketch.p5.js files can be nothing but artwork. Sketches are written
 * in instance mode:
 *
 *   export default function sketch(p, ctx) {
 *     p.setup = () => { p.createCanvas(ctx.width, ctx.height); ... }
 *     p.draw  = () => { ... }
 *   }
 *
 * ctx = { seed, rng, noise, width, height, capture, pane, reload, artwork }
 */

import p5 from 'p5';
import { createRandom } from '../shared/random.js';
import { createNoise } from '../shared/math.js';
import { beginArtwork, signalReady, signalError, tickFrame } from './ready.js';

export async function mountP5({ artwork, container, seed, capture = false, pane = null, reload = () => {} }) {
  const mod = await artwork.load();
  const factory = mod.default;
  if (typeof factory !== 'function') {
    throw new Error(`${artwork.slug}/sketch.p5.js must default-export a function (p, ctx) => {}`);
  }

  const { width, height, captureFrames } = artwork;
  const readyAt = Math.max(1, capture ? captureFrames : 1);

  beginArtwork({ slug: artwork.slug, seed, engine: 'p5' });

  let instance = null;
  let paused = false;

  const sketch = (p) => {
    const ctx = {
      seed,
      rng: createRandom(seed),
      noise: createNoise(seed),
      width,
      height,
      capture,
      pane,
      reload,
      artwork
    };

    factory(p, ctx);

    const userSetup = p.setup;
    const userDraw = p.draw;
    const userWindowResized = p.windowResized;

    p.setup = () => {
      // Capture renders at density 1 so the PNG is exactly width x height.
      p.pixelDensity(capture ? 1 : Math.min(2, window.devicePixelRatio || 1));
      p.randomSeed(seed);
      p.noiseSeed(seed);
      try {
        userSetup?.();
      } catch (err) {
        signalError(err);
        throw err;
      }
      if (!p.width || !p.height) p.createCanvas(width, height);
      // A sketch that draws entirely in setup gets no pointless draw loop.
      if (!userDraw) {
        p.noLoop();
        signalReady();
      }
    };

    p.draw = () => {
      if (!userDraw) return;
      try {
        userDraw();
      } catch (err) {
        signalError(err);
        p.noLoop();
        throw err;
      }
      if (tickFrame() >= readyAt) signalReady();
    };

    // The canvas is a fixed artwork-sized surface scaled by CSS, so sketches
    // do not need to handle window resizing unless they opt in.
    p.windowResized = userWindowResized ?? (() => {});
  };

  instance = new p5(sketch, container);

  return {
    engine: 'p5',
    instance,
    get canvas() {
      return container.querySelector('canvas');
    },
    isAnimated: artwork.animated,
    isPaused: () => paused,
    pause() {
      paused = true;
      instance.noLoop();
    },
    play() {
      paused = false;
      instance.loop();
    },
    destroy() {
      try {
        instance.remove();
      } catch {
        /* p5 throws if it was already torn down; nothing to do. */
      }
      container.replaceChildren();
    }
  };
}

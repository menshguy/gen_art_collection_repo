/**
 * Three.js host.
 *
 * Owns the renderer, the animation loop, capture sizing and teardown.
 * The artwork owns everything expressive — scene, camera, geometry,
 * materials, lights, shaders — and disposes what it created:
 *
 *   export default function scene(ctx) {
 *     const scene = new THREE.Scene()
 *     const camera = new THREE.PerspectiveCamera(...)
 *     return {
 *       scene, camera,
 *       update(t, dt) {},
 *       resize(w, h) {},
 *       render(renderer) {},   // optional: only for post-processing
 *       dispose() {}
 *     }
 *   }
 *
 * ctx = { renderer, width, height, seed, rng, noise, capture, pane, reload, artwork }
 */

import * as THREE from 'three';
import { createRandom } from '../shared/random.js';
import { createNoise } from '../shared/math.js';
import { beginArtwork, signalReady, signalError, tickFrame } from './ready.js';

export async function mountThree({ artwork, container, seed, capture = false, pane = null, reload = () => {} }) {
  const mod = await artwork.load();
  const factory = mod.default;
  if (typeof factory !== 'function') {
    throw new Error(`${artwork.slug}/scene.three.js must default-export a function (ctx) => handle`);
  }

  const { width, height, captureFrames } = artwork;
  const readyAt = Math.max(1, capture ? captureFrames : 1);

  beginArtwork({ slug: artwork.slug, seed, engine: 'three' });

  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    // Lets the in-browser PNG export read the buffer back.
    preserveDrawingBuffer: true,
    powerPreference: 'high-performance'
  });
  // Capture renders at ratio 1 so the PNG is exactly width x height.
  renderer.setPixelRatio(capture ? 1 : Math.min(2, window.devicePixelRatio || 1));
  renderer.setSize(width, height, true);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);

  let handle;
  try {
    handle = factory({
      renderer,
      width,
      height,
      seed,
      rng: createRandom(seed),
      noise: createNoise(seed),
      capture,
      pane,
      reload,
      artwork
    });
  } catch (err) {
    signalError(err);
    renderer.dispose();
    container.replaceChildren();
    throw err;
  }

  if (!handle || (!handle.render && (!handle.scene || !handle.camera))) {
    renderer.dispose();
    container.replaceChildren();
    throw new Error(
      `${artwork.slug}/scene.three.js must return { scene, camera, ... } or provide a render(renderer) method`
    );
  }

  let rafId = null;
  let paused = false;
  let disposed = false;
  const clock = new THREE.Clock();

  // Captures advance on a fixed timestep instead of the wall clock, so an
  // animated artwork renders the same image every time for a given seed.
  const CAPTURE_DT = 1 / 60;
  let captureTime = 0;

  const drawFrame = () => {
    let t;
    let dt;
    if (capture) {
      dt = CAPTURE_DT;
      captureTime += dt;
      t = captureTime;
    } else {
      dt = clock.getDelta();
      t = clock.getElapsedTime();
    }
    try {
      handle.update?.(t, dt);
      if (handle.render) handle.render(renderer);
      else renderer.render(handle.scene, handle.camera);
    } catch (err) {
      signalError(err);
      stopLoop();
      throw err;
    }
    if (tickFrame() >= readyAt) signalReady();
  };

  const loop = () => {
    if (disposed) return;
    rafId = requestAnimationFrame(loop);
    drawFrame();
  };

  const stopLoop = () => {
    if (rafId !== null) cancelAnimationFrame(rafId);
    rafId = null;
  };

  // A still artwork — and any capture — renders exactly the frames it needs
  // and then stops burning GPU. Only a live animated artwork takes the RAF path.
  if (artwork.animated && !capture) {
    loop();
  } else {
    for (let i = 0; i < readyAt; i++) drawFrame();
  }

  return {
    engine: 'three',
    handle,
    renderer,
    get canvas() {
      return renderer.domElement;
    },
    isAnimated: artwork.animated,
    isPaused: () => paused,
    pause() {
      if (!artwork.animated) return;
      paused = true;
      stopLoop();
    },
    play() {
      if (!artwork.animated || !paused) return;
      paused = false;
      clock.getDelta(); // discard the paused interval
      loop();
    },
    destroy() {
      disposed = true;
      stopLoop();
      try {
        handle.dispose?.();
      } catch (err) {
        console.warn('[three-host] artwork dispose() threw:', err);
      }
      renderer.dispose();
      renderer.forceContextLoss?.();
      container.replaceChildren();
    }
  };
}

/**
 * Convenience for artworks: dispose everything reachable from a root object.
 * Artworks with unusual resources (render targets, textures they created but
 * never attached) still need to dispose those explicitly.
 */
export function disposeObject(root) {
  root.traverse?.((obj) => {
    obj.geometry?.dispose?.();
    const material = obj.material;
    if (!material) return;
    const materials = Array.isArray(material) ? material : [material];
    for (const m of materials) {
      for (const value of Object.values(m)) {
        if (value && value.isTexture) value.dispose();
      }
      m.dispose?.();
    }
  });
}

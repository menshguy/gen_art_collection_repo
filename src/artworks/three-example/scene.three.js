/**
 * Sediment Field
 *
 * The visual system is depth, not decoration:
 *   1. one InstancedMesh of thin slabs on a jittered grid — a single draw call
 *      for ~9k pieces;
 *   2. a ridged noise field controlling height, tilt and colour, so scale and
 *      value are correlated rather than random per instance;
 *   3. a low camera, one hard key light with shadows, and fog tuned to the
 *      field depth — the depth cues do the work, not post-processing.
 */

import * as THREE from 'three';
import { getPalette, hexToRgb, mixHex } from '../../shared/palettes.js';
import { clamp, smoothstep } from '../../shared/math.js';
import { disposeObject } from '../../runtime/three-host.js';

export default function scene({ renderer, width, height, seed, rng, noise, capture, pane }) {
  const palette = getPalette('sediment');

  const params = {
    gridSize: 96,
    spacing: 0.62,
    heightScale: 7.4,
    cameraHeight: 44,
    drift: 0.12
  };

  const world = new THREE.Scene();
  world.background = new THREE.Color(palette.bg);
  const span = params.gridSize * params.spacing;
  world.fog = new THREE.Fog(palette.bg, span * 1.1, span * 3.1);

  // Framed from above and outside the field, so the island reads as one
  // object sitting in space rather than a city the camera is lost inside.
  const camera = new THREE.PerspectiveCamera(30, width / height, 0.5, 400);
  camera.position.set(span * 0.8, params.cameraHeight, span * 1.15);
  camera.lookAt(3.5, 0.4, 0);

  /* ------------------------------ field ------------------------------ */

  // Ridged noise: sharp crests, broad troughs. Reads as strata, not hills.
  const ridge = (x, z) => {
    const n = noise.fbm2D(x * 0.05, z * 0.05, { octaves: 5, gain: 0.52 });
    const r = 1 - Math.abs(n);
    // Cubed: sharp crest lines with broad empty troughs between them, rather
    // than an even scatter of heights.
    const broad = noise.fbm2D(x * 0.014 + 20, z * 0.014 - 8, { octaves: 2 }) * 0.5 + 0.5;
    return clamp(r * r * r * broad * 2.1);
  };

  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshStandardMaterial({
    roughness: 0.82,
    metalness: 0.04,
    vertexColors: false
  });

  const count = params.gridSize * params.gridSize;
  const slabs = new THREE.InstancedMesh(geometry, material, count);
  slabs.castShadow = true;
  slabs.receiveShadow = true;
  slabs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  const half = params.gridSize / 2;
  let live = 0;

  for (let iz = 0; iz < params.gridSize; iz++) {
    for (let ix = 0; ix < params.gridSize; ix++) {
      // Enough jitter that the base grid never reads as rows of cubes.
      const x = (ix - half) * params.spacing + rng.jitter(params.spacing * 0.38);
      const z = (iz - half) * params.spacing + rng.jitter(params.spacing * 0.38);

      // Circular falloff keeps the field an island in space rather than a
      // rectangle that runs off every edge of the frame.
      const radial = smoothstep(half * params.spacing * 1.02, half * params.spacing * 0.36,
                                Math.hypot(x, z));
      const h = ridge(x, z) * radial;
      if (h < 0.1) continue; // exposed ground = negative space

      const tall = Math.pow(h, 1.5) * params.heightScale + 0.06;
      dummy.position.set(x, tall / 2, z);
      dummy.rotation.set(0, rng.jitter(0.14) + h * 0.5, 0);
      dummy.scale.set(
        params.spacing * (0.42 + h * 0.34),
        tall,
        params.spacing * (0.16 + h * 0.2)
      );
      dummy.updateMatrix();
      slabs.setMatrixAt(live, dummy.matrix);

      // Value tracks height: dark bases, lit crests, accent only at the top 8%.
      const base = mixHex(palette.colors[1], palette.colors[3], clamp(0.12 + h * 1.5));
      const hex = h > 0.84 ? mixHex(base, palette.accent, clamp((h - 0.84) * 3.2)) : base;
      const { r, g, b } = hexToRgb(hex);
      color.setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace);
      slabs.setColorAt(live, color);
      live++;
    }
  }

  slabs.count = live;
  slabs.instanceMatrix.needsUpdate = true;
  if (slabs.instanceColor) slabs.instanceColor.needsUpdate = true;
  world.add(slabs);

  /* ------------------------------ ground ------------------------------ */

  const groundGeo = new THREE.PlaneGeometry(span * 8, span * 8);
  const groundMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(mixHex(palette.bg, palette.colors[2], 0.3)),
    roughness: 1
  });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  world.add(ground);

  /* ------------------------------ light ------------------------------ */

  // One hard key raking across the field creates the long shadows that make
  // the height field legible; the fill only keeps the shadows from going flat.
  const key = new THREE.DirectionalLight(0xfff1de, 3.1);
  key.position.set(-span * 0.55, span * 0.42, span * 0.28);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 1;
  key.shadow.camera.far = span * 2;
  key.shadow.camera.left = -span * 0.75;
  key.shadow.camera.right = span * 0.75;
  key.shadow.camera.top = span * 0.75;
  key.shadow.camera.bottom = -span * 0.75;
  key.shadow.bias = -0.0016;
  world.add(key);

  const fill = new THREE.HemisphereLight(0xdfe6ee, 0x4a3f33, 1.05);
  world.add(fill);

  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.02;

  /* ------------------------------ motion ------------------------------ */

  const origin = camera.position.clone();
  const target = new THREE.Vector3(3.5, 0.4, 0);

  // Live controls for the values worth judging by eye. Structural values
  // (grid size, spacing) would need a rebuild, so they stay in code.
  if (pane) {
    const exposure = { value: renderer.toneMappingExposure };
    pane.addBinding(params, 'drift', { min: 0, max: 0.5, step: 0.01 });
    pane
      .addBinding(params, 'cameraHeight', { min: 4, max: 90, step: 0.5 })
      .on('change', (ev) => { origin.y = ev.value; });
    pane
      .addBinding(exposure, 'value', { label: 'exposure', min: 0.4, max: 2, step: 0.01 })
      .on('change', (ev) => { renderer.toneMappingExposure = ev.value; });
    pane
      .addBinding(key, 'intensity', { label: 'key light', min: 0, max: 6, step: 0.05 });
  }

  return {
    scene: world,
    camera,

    update(t) {
      // A slow arc, not a spin: the composition stays readable at every frame.
      const a = Math.sin(t * params.drift) * 0.16;
      camera.position.x = origin.x * Math.cos(a) - origin.z * Math.sin(a);
      camera.position.z = origin.x * Math.sin(a) + origin.z * Math.cos(a);
      camera.position.y = origin.y + Math.sin(t * params.drift * 1.7) * 0.6;
      camera.lookAt(target);
    },

    resize(w, h) {
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    },

    dispose() {
      disposeObject(world);
      slabs.dispose();
      world.clear();
      geometry.dispose();
      material.dispose();
      groundGeo.dispose();
      groundMat.dispose();
      key.shadow.map?.dispose();
      key.dispose?.();
      fill.dispose?.();
    }
  };
}

/**
 * Vendored Poly Haven assets (CC0), loaded once at module scope.
 *
 * The Three host calls the artwork factory synchronously and, in capture mode,
 * immediately draws every frame it needs. So nothing may still be in flight
 * when the factory runs. Top-level await is the lever: `mountThree` awaits the
 * module, so by the time the factory exists the geometry and textures are
 * already resident and the first captured frame is the finished scene.
 *
 * Restore the files with `npm run assets` — see scripts/fetch-assets.mjs.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';

const BASE = `${import.meta.env.BASE_URL ?? '/'}assets/`;

const gltfLoader = new GLTFLoader();
const rgbeLoader = new RGBELoader();
const texLoader = new THREE.TextureLoader();

const MODELS = [
  'street_lamp_01',
  'street_lamp_02',
  'fire_hydrant',
  'metal_trash_can',
  'water_manhole_cover',
  'concrete_road_barrier',
  'covered_car',
  'trashbag'
];

const SURFACES = {
  asphalt: 'asphalt_03',
  pavement: 'brushed_concrete_03',
  brick: 'brick_wall_006'
};

/** Load one model and hand back its root, with shadow flags already set. */
async function loadModel(id) {
  const gltf = await gltfLoader.loadAsync(`${BASE}models/${id}/${id}.gltf`);
  const root = gltf.scene;
  root.traverse((obj) => {
    if (!obj.isMesh) return;
    obj.castShadow = true;
    obj.receiveShadow = true;
  });
  return root;
}

/** Diffuse + normal + roughness as a repeating PBR set. */
async function loadSurface(id, repeat) {
  const [map, normalMap, roughnessMap] = await Promise.all([
    texLoader.loadAsync(`${BASE}textures/${id}/Diffuse.jpg`),
    texLoader.loadAsync(`${BASE}textures/${id}/nor_gl.jpg`),
    texLoader.loadAsync(`${BASE}textures/${id}/Rough.jpg`)
  ]);
  map.colorSpace = THREE.SRGBColorSpace;
  for (const t of [map, normalMap, roughnessMap]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat, repeat);
    t.anisotropy = 8;
  }
  return { map, normalMap, roughnessMap };
}

const [modelList, asphalt, pavement, brick, envHdr] = await Promise.all([
  Promise.all(MODELS.map(loadModel)),
  loadSurface(SURFACES.asphalt, 6),
  loadSurface(SURFACES.pavement, 4),
  loadSurface(SURFACES.brick, 3),
  rgbeLoader.loadAsync(`${BASE}hdri/night_bridge.hdr`)
]);

export const models = Object.fromEntries(MODELS.map((id, i) => [id, modelList[i]]));
export const surfaces = { asphalt, pavement, brick };
export const envSource = envHdr;

/**
 * A fresh, independently transformable copy of a scanned prop.
 *
 * Geometry and textures are shared with the original — only the scene-graph
 * nodes are new — so twenty bollards cost one upload, not twenty. Materials
 * are cloned per placement, though, because the scene grades each prop's
 * colour towards the night palette rather than leaving photogrammetry albedo
 * (shot in daylight) sitting in a rainy sodium-lit street.
 */
export function instance(id, { grade = null, variant = null } = {}) {
  const root = models[id].clone(true);
  // Poly Haven ships material variants as overlapping copies of the whole
  // model in one file — a clean hydrant and an aged one occupying the same
  // space. Rendered as-is you get z-fighting and double geometry, so a
  // variant has to be chosen and the rest dropped.
  if (variant) {
    const drop = [];
    root.traverse((obj) => {
      if (!obj.isMesh) return;
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      if (!mats.some((m) => m.name === variant)) drop.push(obj);
    });
    for (const obj of drop) obj.removeFromParent();
  }
  root.traverse((obj) => {
    if (!obj.isMesh) return;
    const src = Array.isArray(obj.material) ? obj.material : [obj.material];
    const cloned = src.map((m) => {
      const c = m.clone();
      grade?.(c, obj);
      return c;
    });
    obj.material = Array.isArray(obj.material) ? cloned : cloned[0];
    obj.castShadow = true;
    obj.receiveShadow = true;
  });
  return root;
}

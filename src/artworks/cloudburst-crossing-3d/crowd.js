/**
 * Putting the drawings in the street.
 *
 * Each figure is one billboard carrying its own walk-cycle atlas, turning
 * about Y only. Three things follow from that and they decide the staging:
 *
 *   - people walk **across** the view, not up and down it, because a profile
 *     caricature is what the reference draws and what a Y-billboard shows
 *     honestly. This is why the scene is a crossing;
 *   - the cycle is advanced by **distance travelled**, not by the clock, so
 *     the planted foot never skates. Speed and stride stay locked together
 *     however fast a given figure walks;
 *   - nobody appears or disappears in open view. A figure's lane runs from
 *     well behind one facade line to well behind the other, so it walks out
 *     from behind a building and back in — and the far lanes are recycled
 *     past the point where the fog is already opaque.
 *
 * Lighting is deliberately not the same as for the scan props. A drawing that
 * obeys the street's light exactly turns into a grey smudge at night, and the
 * point of these is that they are drawn. So they keep a floor of their own
 * value and take the lamps on top of it — lit enough to belong, self-lit
 * enough to stay a drawing.
 */

import * as THREE from 'three';
import { EMITTER_UNIFORMS_GLSL, EMITTER_AIR_GLSL } from './lighting.js';
import { figureSpec, figureAtlas, FRAMES } from './figures.js';

const vert = /* glsl */ `
  uniform vec3  uOrigin;
  uniform vec2  uSize;      // metres: width, height
  uniform float uFlip;

  varying vec2 vUv;
  varying vec3 vWorld;
  varying float vDist;

  void main() {
    // Cylindrical billboard: yaw towards the camera, never pitch. A sprite
    // that also tips backwards is a sprite whose feet leave the ground.
    vec3 toCam = cameraPosition - uOrigin;
    toCam.y = 0.0;
    toCam = normalize(toCam);
    vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), toCam));

    vec3 world = uOrigin
      + right * (position.x * uSize.x)
      + vec3(0.0, 1.0, 0.0) * ((position.y + 0.5) * uSize.y);

    vec4 mv = viewMatrix * vec4(world, 1.0);
    vWorld = world;
    vDist = -mv.z;
    vUv = vec2(uFlip > 0.0 ? uv.x : 1.0 - uv.x, uv.y);
    gl_Position = projectionMatrix * mv;
  }
`;

const frag = /* glsl */ `
  precision highp float;
  ${EMITTER_UNIFORMS_GLSL}
  ${EMITTER_AIR_GLSL}

  uniform sampler2D uMap;
  uniform vec2  uGrid;      // cols, rows
  uniform float uFrame;
  uniform vec3  uSelf;      // the value a drawing keeps in the dark
  uniform float uLitGain;
  uniform vec3  uFogColor;
  uniform float uFogDensity;

  varying vec2 vUv;
  varying vec3 vWorld;
  varying float vDist;

  void main() {
    float fcol = mod(uFrame, uGrid.x);
    float frow = floor(uFrame / uGrid.x);
    // The atlas is a canvas, so its first row is at the top while the
    // texture's v runs up from the bottom — hence the row flip.
    vec2 uv = vec2(
      (vUv.x + fcol) / uGrid.x,
      (vUv.y + (uGrid.y - 1.0 - frow)) / uGrid.y
    );
    vec4 t = texture2D(uMap, uv);
    if (t.a < 0.30) discard;

    // The drawing is on cream paper, and cream paper does not survive a
    // rainy night at full value — it reads as a sticker on a photograph. So
    // the sheet is graded down and slightly cooled before the street lights
    // it, which lets a figure standing in a lamp pool come back to full
    // warmth while one in the dark falls to an inked silhouette.
    float lum = dot(t.rgb, vec3(0.299, 0.587, 0.114));
    vec3 sheet = mix(vec3(lum), t.rgb, 0.84) * vec3(0.40, 0.43, 0.49);
    // Soaked from the hem down. Everyone in this street has been walking
    // through standing water, and a uniformly dry figure is the giveaway.
    sheet *= mix(0.52, 1.0, smoothstep(0.02, 0.42, vUv.y));

    vec3 lit = uSelf + airLight(vWorld + vec3(0.0, 0.4, 0.0), 0.9) * uLitGain;
    // Rolled off rather than clipped. Cream paper under a sodium lamp will
    // otherwise reach pure white and take the ink line with it, and the ink
    // line is the entire reason these are drawings.
    lit = lit / (1.0 + lit * 0.55);
    vec3 col = sheet * lit * 1.15;

    float f = 1.0 - exp(-uFogDensity * uFogDensity * vDist * vDist);
    col = mix(col, uFogColor, clamp(f, 0.0, 1.0));

    gl_FragColor = vec4(col, t.a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/**
 * Where people walk.
 *
 * Lanes, not scatter. Real pedestrians occupy a handful of desire lines and a
 * crossing concentrates them into two counter-flowing streams; a uniform
 * sprinkle of people across a junction is the thing that reads as a video
 * game. `cellH` falls with distance because so does the pixel budget.
 */
function lanes(crossZ) {
  return [
    // The hero: close enough to the lens to be the subject, and bare-headed,
    // because a canopy over the one face big enough to read would hide the
    // only thing on this figure worth the pixels.
    { z: -1.4, dir: -1, cellH: 620, extent: 12, umbrella: false, offset: 0.492 },
    // Its counterweight, crossing the other way under a canopy. An umbrella
    // is the strongest silhouette a rain picture has available.
    { z: crossZ + 0.4, dir: 1, cellH: 470, umbrella: true, offset: 0.62 },
    { z: crossZ - 1.4, dir: -1, cellH: 340, umbrella: true, offset: 0.235 },
    // The pavement, further off. Placed on the far side so they read against
    // the fog rather than crowding the near edge of the frame.
    { z: -17.5, dir: 1, cellH: 250, offset: 0.44 },
    { z: -22.5, dir: -1, cellH: 210, umbrella: true, offset: 0.72 },
    { z: -32, dir: 1, cellH: 170, offset: 0.10 }
  ];
}

export function createCrowd({ rng, emitterUniforms, fogColor, fogDensity, crossZ, roadHalf, kerbHeight, extent = 15.5 }) {
  const group = new THREE.Group();
  const geo = new THREE.PlaneGeometry(1, 1);
  const people = [];
  const materials = [];
  const textures = [];

  for (const lane of lanes(crossZ)) {
    const spec = figureSpec(rng);
    if (lane.umbrella !== undefined) spec.umbrella = lane.umbrella;
    const seed = Math.floor(rng() * 1e9);
    const atlas = figureAtlas(spec, () => makeRng(seed), { cellH: lane.cellH });
    textures.push(atlas.texture);

    // The sprite is sized so the *drawn figure* is spec.height metres tall,
    // not so the cell is — the cell has headroom for an umbrella.
    const height = spec.height / atlas.figureFrac;
    const width = height * atlas.aspect;

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        ...emitterUniforms,
        uMap: { value: atlas.texture },
        uGrid: { value: new THREE.Vector2(atlas.cols, atlas.rows) },
        uFrame: { value: 0 },
        uOrigin: { value: new THREE.Vector3() },
        uSize: { value: new THREE.Vector2(width, height) },
        uFlip: { value: lane.dir },
        // Low floor, high gain. A drawing that keeps its paper value at night
        // reads as a sticker on a photograph; one driven almost entirely by
        // the street glows in the light pools and falls to a lit silhouette
        // outside them, while the ink line survives either way.
        uSelf: { value: new THREE.Color(0x1b2230) },
        uLitGain: { value: 1.30 },
        uFogColor: { value: new THREE.Color(fogColor) },
        uFogDensity: { value: fogDensity }
      },
      vertexShader: vert,
      fragmentShader: frag,
      transparent: true,
      depthWrite: true,
      side: THREE.DoubleSide,
      toneMapped: true
    });
    materials.push(mat);

    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    group.add(mesh);

    // Feet sit a hair below the sprite's own ground line so the soles meet
    // the water rather than hovering over their own reflection.
    const footDrop = height * (1 - atlas.footFrac);

    people.push({
      mat,
      lane,
      spec,
      // One stride of the atlas cycle covers this much ground; the cycle is
      // driven from it, which is what stops the feet sliding.
      cycleLength: spec.height * spec.stride * 2.05,
      speed: rng.range(1.05, 1.45) * spec.cadence,
      extent: lane.extent ?? extent,
      // Staged, not scattered: each lane's starting offset is chosen so the
      // group reads as a composition at the frame the still is taken on.
      x: (lane.offset ?? rng()) * 2 * (lane.extent ?? extent) - (lane.extent ?? extent),
      y: -footDrop,
      phase: rng()
    });
  }

  return {
    group,
    update(t) {
      for (const p of people) {
        const travel = p.speed * t;
        // Wrap through the whole lane, both ends of which are behind a
        // facade — a figure only ever appears from behind a building.
        const e = p.extent;
        const span = e * 2;
        let x = p.x + travel * p.lane.dir;
        x = ((x + e) % span + span) % span - e;
        // Step up onto the pavement at the kerb, rather than wading along
        // at road level with both feet buried in the paving.
        const onKerb = Math.abs(x) > roadHalf ? kerbHeight : 0;
        p.mat.uniforms.uOrigin.value.set(x, p.y + onKerb, p.lane.z);
        const cycle = (travel / p.cycleLength + p.phase) % 1;
        p.mat.uniforms.uFrame.value = Math.floor(cycle * FRAMES) % FRAMES;
      }
    },
    dispose() {
      geo.dispose();
      for (const m of materials) m.dispose();
      for (const t of textures) t.dispose();
    }
  };
}

/** Local mulberry32, so a figure's hand is stable across its own frames. */
function makeRng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rng = () => next();
  rng.range = (min, max) => min + next() * (max - min);
  rng.chance = (p = 0.5) => next() < p;
  rng.pick = (arr) => arr[Math.floor(next() * arr.length)];
  rng.jitter = (amount = 1) => (next() * 2 - 1) * amount;
  rng.weighted = (items, weights) => {
    let total = 0;
    for (const w of weights) total += w;
    let r = next() * total;
    for (let i = 0; i < items.length; i++) {
      r -= weights[i];
      if (r <= 0) return items[i];
    }
    return items[items.length - 1];
  };
  return rng;
}

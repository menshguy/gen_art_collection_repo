/**
 * Water in the air.
 *
 * Three things are happening at once in a cloudburst, and the p5 version only
 * had the first:
 *
 *   1. **streaks** — falling drops, motion-blurred by the eye into lines. The
 *      thing that makes them read is not the lines themselves but the fact
 *      that they are *lit*: a drop is a lens, and it is bright only where a
 *      lamp is throwing light through it. Uniform white hatching over the
 *      whole frame is the tell of fake rain;
 *   2. **spray** — the 10cm of atomised water standing off the road where the
 *      drops shatter. This is the honest version of "splashes". Individual
 *      white dots read as gunfire because a real impact does not produce one
 *      bright particle, it produces a haze that is only visible inside a
 *      light pool and invisible everywhere else;
 *   3. **mist** — the low bank of suspended water the light pools sit inside,
 *      which is what gives a rainy street its glow.
 *
 * (Ring ripples, the fourth part, live in the road shader — they are a
 * property of the water surface, not of the air.)
 *
 * All three read the shared emitter list, so all three brighten together
 * inside a lamp's reach and vanish together outside it.
 */

import * as THREE from 'three';
import { EMITTER_UNIFORMS_GLSL, EMITTER_AIR_GLSL } from './lighting.js';

const FOG_GLSL = /* glsl */ `
  uniform vec3  uFogColor;
  uniform float uFogDensity;
  vec3 applyFog(vec3 col, float dist) {
    float f = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
    return mix(col, uFogColor, clamp(f, 0.0, 1.0));
  }
`;

/* ============================== streaks ============================== */

const streakVert = /* glsl */ `
  ${EMITTER_UNIFORMS_GLSL}
  ${EMITTER_AIR_GLSL}

  attribute vec3 aSeed;    // normalised cell position in the box
  attribute vec3 aParam;   // x = length scale, y = fall scale, z = opacity

  uniform float uTime;
  uniform vec3  uBox;      // box extents around the viewer
  uniform vec3  uBoxCenter;
  uniform vec3  uWind;
  uniform float uFall;
  uniform float uWidth;
  uniform float uLength;
  uniform vec3  uAmbient;
  uniform float uLitGain;

  varying vec2 vUv;
  varying vec3 vCol;
  varying float vAlpha;
  varying float vDist;

  void main() {
    float fall = uFall * aParam.y;
    vec3 vel = vec3(uWind.x, -fall, uWind.z);

    // The drop's own endless fall, wrapped back into a box that travels with
    // the viewer. Wrapping rather than respawning is why nothing ever pops:
    // a drop leaving the bottom of the box is the same drop re-entering the
    // top, and there is no spawn event to catch the eye.
    vec3 p = (aSeed - 0.5) * uBox + vel * uTime;
    p = mod(p + uBox * 0.5, uBox) - uBox * 0.5;
    p += uBoxCenter;

    // The quad is built from the fall direction and the view, so the streak
    // always lies along the drop's travel — a billboard that merely faces the
    // camera gives you tilted confetti.
    vec3 dir = normalize(vel);
    vec3 toCam = normalize(cameraPosition - p);
    vec3 side = normalize(cross(dir, toCam));

    float len = uLength * aParam.x;
    vec3 world = p + side * (position.x * uWidth) + dir * (position.y * len);

    vec4 mv = viewMatrix * vec4(world, 1.0);
    vDist = -mv.z;
    vUv = uv;
    vAlpha = aParam.z;
    // Per-vertex lighting: a streak is a few pixels across, so evaluating the
    // emitter sum per fragment would buy nothing.
    vCol = uAmbient + airLight(p, 1.0) * uLitGain;

    gl_Position = projectionMatrix * mv;
  }
`;

const streakFrag = /* glsl */ `
  precision mediump float;
  ${FOG_GLSL}
  uniform float uOpacity;
  varying vec2 vUv;
  varying vec3 vCol;
  varying float vAlpha;
  varying float vDist;

  void main() {
    // Soft across, tapered along: a drop is brightest in its middle and its
    // motion blur fades out at both ends.
    float across = 1.0 - abs(vUv.x * 2.0 - 1.0);
    float along = 1.0 - pow(abs(vUv.y * 2.0 - 1.0), 2.2);
    float a = across * across * along * vAlpha * uOpacity;
    if (a < 0.002) discard;
    // Near drops are out of focus. Nothing is sharp at arm's length in rain.
    a *= mix(0.55, 1.0, smoothstep(0.6, 3.2, vDist));
    gl_FragColor = vec4(applyFog(vCol, vDist), a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/* =============================== spray =============================== */

const sprayVert = /* glsl */ `
  ${EMITTER_UNIFORMS_GLSL}
  ${EMITTER_AIR_GLSL}

  attribute vec3 aSeed;    // xz = ground position, y = phase
  attribute vec2 aParam;   // x = height scale, y = period scale

  uniform float uTime;
  uniform float uWidth;
  uniform vec3  uWind;

  varying vec2 vUv;
  varying vec3 vCol;
  varying float vAlpha;
  varying float vDist;

  void main() {
    float period = 0.34 * aParam.y;
    float life = fract(uTime / period + aSeed.y);

    // A ballistic bounce: up fast, back down under gravity. The particle is
    // brightest at the top of its arc, where the water is most atomised.
    float h = (life * (1.0 - life) * 4.0) * 0.11 * aParam.x;
    vec3 p = vec3(aSeed.x + uWind.x * 0.01 * life, h, aSeed.z);

    vec3 toCam = normalize(cameraPosition - p);
    vec3 side = normalize(cross(vec3(0.0, 1.0, 0.0), toCam));
    vec3 world = p + side * (position.x * uWidth) + vec3(0.0, position.y * 0.055 * aParam.x, 0.0);

    vec4 mv = viewMatrix * vec4(world, 1.0);
    vDist = -mv.z;
    vUv = uv;
    // Spray is pure scattered light: it has no albedo of its own, so outside
    // a light pool it is simply not there. That is the whole difference
    // between a shimmer on the road and a scatter of white dots.
    vCol = airLight(p + vec3(0.0, 0.05, 0.0), 0.62);
    vAlpha = (1.0 - abs(life * 2.0 - 1.0)) * 0.9;

    gl_Position = projectionMatrix * mv;
  }
`;

const sprayFrag = /* glsl */ `
  precision mediump float;
  ${FOG_GLSL}
  uniform float uOpacity;
  varying vec2 vUv;
  varying vec3 vCol;
  varying float vAlpha;
  varying float vDist;

  void main() {
    float across = 1.0 - abs(vUv.x * 2.0 - 1.0);
    float along = 1.0 - abs(vUv.y * 2.0 - 1.0);
    float a = across * along * vAlpha * uOpacity;
    // Falls away with distance: past a few metres the individual bounce is
    // far smaller than a pixel and only the aggregate haze survives.
    a *= smoothstep(34.0, 4.0, vDist);
    float lum = dot(vCol, vec3(0.33));
    a *= clamp(lum * 1.6, 0.0, 1.0);
    if (a < 0.003) discard;
    gl_FragColor = vec4(applyFog(vCol * 1.5, vDist), a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/* =============================== mist ================================ */

const mistVert = /* glsl */ `
  ${EMITTER_UNIFORMS_GLSL}
  ${EMITTER_AIR_GLSL}

  attribute vec3 aSeed;
  attribute vec2 aParam;   // x = radius, y = drift phase

  uniform float uTime;
  uniform vec3  uWind;

  varying vec2 vUv;
  varying vec3 vCol;
  varying float vDist;
  varying float vFade;

  void main() {
    float drift = uTime * 0.35;
    vec3 p = aSeed;
    p.x += sin(drift * 0.6 + aParam.y * 6.283) * 1.4 + uWind.x * 0.08 * uTime;
    p.z += cos(drift * 0.45 + aParam.y * 6.283) * 1.1;
    p.y += sin(drift * 0.9 + aParam.y * 12.0) * 0.12;

    vec3 toCam = normalize(cameraPosition - p);
    vec3 side = normalize(cross(vec3(0.0, 1.0, 0.0), toCam));
    vec3 up = normalize(cross(toCam, side));
    vec3 world = p + side * (position.x * aParam.x * 2.0) + up * (position.y * aParam.x * 1.15);

    vec4 mv = viewMatrix * vec4(world, 1.0);
    vDist = -mv.z;
    vUv = uv;
    vCol = airLight(p, 0.85);
    // Mist thins out where it meets the ground and where it runs out of the
    // low band it lives in — it is a layer, not a cloud.
    vFade = smoothstep(0.0, 0.22, p.y) * smoothstep(2.4, 0.7, p.y);

    gl_Position = projectionMatrix * mv;
  }
`;

const mistFrag = /* glsl */ `
  precision mediump float;
  ${FOG_GLSL}
  uniform float uOpacity;
  varying vec2 vUv;
  varying vec3 vCol;
  varying float vDist;
  varying float vFade;

  void main() {
    vec2 d = vUv * 2.0 - 1.0;
    float r = dot(d, d);
    float a = pow(max(0.0, 1.0 - r), 2.4) * vFade * uOpacity;
    float lum = dot(vCol, vec3(0.33));
    a *= clamp(lum * 1.35, 0.0, 1.0);
    // Never in front of the camera's own nose, and gone by mid-distance —
    // otherwise the mist becomes a second fog and flattens the street.
    a *= smoothstep(1.2, 4.0, vDist) * smoothstep(52.0, 18.0, vDist);
    if (a < 0.002) discard;
    gl_FragColor = vec4(applyFog(vCol * 0.75, vDist), a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/* ============================== assembly ============================= */

function quad() {
  return new THREE.PlaneGeometry(1, 1);
}

function baseMaterial(vertexShader, fragmentShader, uniforms) {
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.NormalBlending,
    side: THREE.DoubleSide,
    toneMapped: true
  });
}

/**
 * Build the whole water-in-air system.
 *
 * `layers` is deliberately a short list of shells at different scales rather
 * than one big particle count: near rain is long, soft and out of focus, mid
 * rain is the sharp readable hatch, far rain is fine enough that the fog
 * finishes it. One uniform cloud of drops cannot be all three at once.
 */
export function createRain({ rng, emitterUniforms, fogColor, fogDensity, ambient, focus }) {
  const group = new THREE.Group();
  const materials = [];
  const geometries = [];
  const shared = {
    uTime: { value: 0 },
    uWind: { value: new THREE.Vector3(2.6, 0, 0.6) },
    uFogColor: { value: new THREE.Color(fogColor) },
    uFogDensity: { value: fogDensity }
  };

  // Rain is far less visible in a photograph than in a drawing. Almost all of
  // what you see is drops passing through a light — so the ambient term stays
  // low and the lit gain stays high. Turning the ambient up is how rain ends
  // up as a curtain of white rope laid over the whole frame.
  const LAYERS = [
    // count, box, length, width, fall, opacity, litGain, ambient — near to far
    { count: 190, box: [13, 9, 13], length: 1.7, width: 0.042, fall: 23, opacity: 0.16, lit: 0.55, ambient: 0.20 },
    { count: 2600, box: [34, 14, 40], length: 0.80, width: 0.013, fall: 25, opacity: 0.34, lit: 1.15, ambient: 0.26 },
    { count: 1900, box: [72, 22, 84], length: 0.40, width: 0.024, fall: 26, opacity: 0.22, lit: 1.5, ambient: 0.30 }
  ];

  const boxCenters = [];

  for (const cfg of LAYERS) {
    const geo = quad();
    const count = cfg.count;
    const seeds = new Float32Array(count * 3);
    const params = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      seeds[i * 3] = rng();
      seeds[i * 3 + 1] = rng();
      seeds[i * 3 + 2] = rng();
      // Drop size and speed are correlated — bigger drops fall faster and
      // streak longer — so the field has a scale hierarchy instead of noise.
      const big = rng.skew(1.7);
      params[i * 3] = 0.55 + big * 1.1;
      params[i * 3 + 1] = 0.8 + big * 0.5;
      params[i * 3 + 2] = 0.35 + big * 0.75;
    }
    const inst = new THREE.InstancedBufferGeometry();
    inst.index = geo.index;
    inst.attributes.position = geo.attributes.position;
    inst.attributes.uv = geo.attributes.uv;
    inst.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 3));
    inst.setAttribute('aParam', new THREE.InstancedBufferAttribute(params, 3));
    inst.instanceCount = count;

    const center = new THREE.Vector3();
    boxCenters.push({ center, box: cfg.box });

    const mat = baseMaterial(streakVert, streakFrag, {
      ...emitterUniforms,
      ...shared,
      uBox: { value: new THREE.Vector3(...cfg.box) },
      uBoxCenter: { value: center },
      uFall: { value: cfg.fall },
      uWidth: { value: cfg.width },
      uLength: { value: cfg.length },
      uOpacity: { value: cfg.opacity },
      uLitGain: { value: cfg.lit },
      uAmbient: { value: new THREE.Color(ambient).multiplyScalar(cfg.ambient) }
    });
    const mesh = new THREE.Mesh(inst, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 4;
    group.add(mesh);
    materials.push(mat);
    geometries.push(inst, geo);
  }

  /* ------------------------------- spray ------------------------------ */

  // Anchored to the road in front of the camera rather than following it:
  // the shimmer belongs to the wet surface, not to the viewer.
  const SPRAY = 4200;
  {
    const geo = quad();
    const seeds = new Float32Array(SPRAY * 3);
    const params = new Float32Array(SPRAY * 2);
    for (let i = 0; i < SPRAY; i++) {
      // Denser near the camera, where a bounce is still resolvable.
      const t = rng.skew(1.6);
      seeds[i * 3] = focus.x + rng.jitter(1) * (5.5 + t * 8);
      seeds[i * 3 + 1] = rng();
      seeds[i * 3 + 2] = focus.z + rng.range(-1, 1) * (6 + t * 22);
      params[i * 2] = 0.5 + rng.skew(2) * 1.5;
      params[i * 2 + 1] = 0.7 + rng() * 0.7;
    }
    const inst = new THREE.InstancedBufferGeometry();
    inst.index = geo.index;
    inst.attributes.position = geo.attributes.position;
    inst.attributes.uv = geo.attributes.uv;
    inst.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 3));
    inst.setAttribute('aParam', new THREE.InstancedBufferAttribute(params, 2));
    inst.instanceCount = SPRAY;

    const mat = baseMaterial(sprayVert, sprayFrag, {
      ...emitterUniforms,
      ...shared,
      uWidth: { value: 0.012 },
      uOpacity: { value: 0.9 }
    });
    const mesh = new THREE.Mesh(inst, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 5;
    group.add(mesh);
    materials.push(mat);
    geometries.push(inst, geo);
  }

  /* -------------------------------- mist ------------------------------ */

  // Many small puffs, not a few big ones. A large soft quad near the ground
  // is a large soft quad *intersecting* the ground, and the hard line where
  // it cuts the road gives the whole trick away. Below about a metre across,
  // at this opacity, the cut is shorter than the eye can find.
  const MIST = 460;
  {
    const geo = quad();
    const seeds = new Float32Array(MIST * 3);
    const params = new Float32Array(MIST * 2);
    for (let i = 0; i < MIST; i++) {
      seeds[i * 3] = focus.x + rng.jitter(1) * 15;
      seeds[i * 3 + 1] = 0.12 + rng.skew(2.0) * 1.5;
      seeds[i * 3 + 2] = focus.z + rng.range(-1, 1) * 24;
      params[i * 2] = 0.32 + rng.skew(1.6) * 0.95;
      params[i * 2 + 1] = rng();
    }
    const inst = new THREE.InstancedBufferGeometry();
    inst.index = geo.index;
    inst.attributes.position = geo.attributes.position;
    inst.attributes.uv = geo.attributes.uv;
    inst.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 3));
    inst.setAttribute('aParam', new THREE.InstancedBufferAttribute(params, 2));
    inst.instanceCount = MIST;

    const mat = baseMaterial(mistVert, mistFrag, {
      ...emitterUniforms,
      ...shared,
      uOpacity: { value: 0.11 }
    });
    const mesh = new THREE.Mesh(inst, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 3;
    group.add(mesh);
    materials.push(mat);
    geometries.push(inst, geo);
  }

  return {
    group,
    /**
     * One gust field drives every layer, so the whole downpour leans together
     * instead of each shell having its own weather.
     */
    update(t, noise, camPos) {
      shared.uTime.value = t;
      // A real downpour leans, and the lean breathes. Enough shear that the
      // streaks are obviously falling *across* the street rather than
      // dropping like a ruled hatch.
      const gust = noise.fbm2D(t * 0.14, 0, { octaves: 2 });
      shared.uWind.value.set(5.2 + gust * 3.4, 0, 1.1 + gust * 1.2);
      for (const { center, box } of boxCenters) {
        center.set(camPos.x, box[1] * 0.5 - 1.2, camPos.z - box[2] * 0.28);
      }
    },
    dispose() {
      for (const m of materials) m.dispose();
      for (const g of geometries) g.dispose();
    }
  };
}

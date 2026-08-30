/**
 * The wet carriageway.
 *
 * This is the piece. A rainy street at night is not asphalt with some shine
 * on it — it is a rough mirror, and almost everything the image is made of
 * happens on this one plane:
 *
 *   - a puddle field carved by the road camber, so water pools in the gutters
 *     and in the hollows rather than scattering in random blobs;
 *   - a mirrored half-resolution pass of the whole street, sampled through the
 *     water's own normal so the reflection breaks up where the surface is
 *     disturbed and holds where it is calm;
 *   - one GGX highlight per emitter. A rough water surface stretches a point
 *     light into a long streak running towards the viewer, and that streak —
 *     not a painted-on glow — is what makes a road read as wet;
 *   - analytic ring ripples from rain impacts, summed over a hash grid so
 *     rings interfere with each other instead of stamping identical decals.
 *
 * The ripples are also the answer to splashes. Rain hitting standing water
 * does not produce white sparks; it produces expanding rings that are only
 * visible where a light is reflecting off them. Modelling the ring in the
 * surface normal means they appear exactly where they should — inside the
 * light pools — and vanish in the dark, for free.
 */

import * as THREE from 'three';
import { MAX_EMITTERS, EMITTER_UNIFORMS_GLSL } from './lighting.js';

const vertexShader = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const fragmentShader = /* glsl */ `
  precision highp float;

  uniform sampler2D tDiffuse;
  uniform sampler2D tNormal;
  uniform sampler2D tRough;
  uniform sampler2D tReflect;
  uniform sampler2D tNoise;

  uniform vec2  uResolution;
  uniform float uTime;
  uniform vec3  uCamPos;
  uniform vec3  uFogColor;
  uniform float uFogDensity;
  uniform vec3  uSkyColor;
  uniform float uRoadHalf;
  uniform float uCrossZ;
  uniform float uWetness;
  uniform float uRainRate;

  ${EMITTER_UNIFORMS_GLSL}

  varying vec3 vWorld;

  const float PI = 3.14159265359;

  float hash1(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }
  vec2 hash2(vec2 p) {
    return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453);
  }

  /* ---------------------------------------------------------------------
     Rain ripples.

     Every cell of a 0.4m grid launches one ring, at its own phase, from its
     own jittered centre. Three cells either way are summed, so rings from
     neighbouring impacts overlap and interfere — which is what stops a rain
     surface reading as a repeating stamp. The wave is a decaying oscillation
     trailing an expanding front; it is returned as a slope, not a height,
     because only the normal is ever used.
  --------------------------------------------------------------------- */
  vec2 rippleSlope(vec2 p, float t, float rate) {
    const float CELL = 0.42;
    const float PERIOD = 0.85;
    const float SPEED = 1.35;
    vec2 g = p / CELL;
    vec2 base = floor(g);
    vec2 acc = vec2(0.0);

    for (int j = -1; j <= 1; j++) {
      for (int i = -1; i <= 1; i++) {
        vec2 c = base + vec2(float(i), float(j));
        vec2 centre = (c + hash2(c)) * CELL;
        float phase = hash1(c + 3.7);
        // Not every cell fires every period: at lower rain rates impacts thin
        // out rather than every ring simply getting weaker.
        if (hash1(c + 11.3) > rate) continue;
        float life = fract(t / PERIOD + phase);
        vec2 d = p - centre;
        float r = length(d) + 1e-4;
        float front = life * SPEED * PERIOD;
        float x = r - front;
        float wave = sin(x * 46.0) * exp(-abs(x) * 15.0) * exp(-r * 3.4) * (1.0 - life) * (1.0 - life);
        acc += (d / r) * wave;
      }
    }
    return acc;
  }

  /* Wind-driven chop: the broad, slow disturbance the rings ride on. */
  vec2 chopSlope(vec2 p, float t) {
    vec2 a = texture2D(tNoise, p * 0.11 + vec2(t * 0.021, -t * 0.014)).rg - 0.5;
    vec2 b = texture2D(tNoise, p * 0.37 - vec2(t * 0.05, t * 0.032)).rg - 0.5;
    return a * 1.0 + b * 0.55;
  }

  /* ---------------------------------------------------------------------
     Road markings. Bars run with the traffic and repeat across the street,
     which is what a crossing actually looks like from the kerb; the stop
     line sits ahead of it, and a dashed centre line runs away up the road.
  --------------------------------------------------------------------- */
  float markings(vec3 p) {
    float paint = 0.0;

    float band = smoothstep(1.85, 1.62, abs(p.z - uCrossZ));
    float bars = smoothstep(0.22, 0.28, abs(fract(p.x / 0.92 + 0.5) - 0.5) * 0.92);
    paint = max(paint, band * (1.0 - bars) * step(abs(p.x), uRoadHalf - 0.45));

    float stop = smoothstep(0.13, 0.09, abs(p.z - (uCrossZ + 2.6)));
    paint = max(paint, stop * step(abs(p.x), uRoadHalf - 0.4));

    float dash = smoothstep(0.075, 0.055, abs(p.x)) *
                 step(0.45, fract(p.z / 4.2)) * step(abs(p.z - uCrossZ), 90.0) *
                 (1.0 - smoothstep(2.6, 3.4, -abs(p.z - uCrossZ)));
    paint = max(paint, dash * step(3.4, abs(p.z - uCrossZ)));

    // Worn: paint on a used road is scuffed away in the wheel tracks.
    float wear = texture2D(tNoise, p.xz * 0.85).b;
    return paint * smoothstep(0.10, 0.52, wear);
  }

  void main() {
    vec3 P = vWorld;
    vec2 uvA = P.xz * 0.33;
    vec3 V = normalize(uCamPos - P);
    float viewDist = distance(uCamPos, P);

    /* ---------------------------- surface ---------------------------- */

    vec3 albedo = texture2D(tDiffuse, uvA).rgb;
    albedo = pow(albedo, vec3(1.9)) * vec3(0.30, 0.31, 0.35);

    // Road paint under standing water is not white. It is a dark, slightly
    // warmer patch that returns a much stronger specular than the asphalt
    // around it — which is why a wet crossing reads as stripes of *reflection*
    // rather than stripes of pigment.
    float paint = markings(P);
    albedo = mix(albedo, vec3(0.105, 0.102, 0.096), paint);

    // Camber: the road crowns down its centre line, so the water runs to the
    // gutters. Puddles are the noise field minus that slope — they are found
    // where the road dips, never in the crown.
    float camber = pow(abs(P.x) / uRoadHalf, 2.0);
    float field = texture2D(tNoise, P.xz * 0.055).r;
    float hollow = field * 1.35 - 0.52 - camber * 0.75;
    float puddle = smoothstep(0.0, 0.10, hollow);
    // The gutters hold water whatever the noise says.
    puddle = max(puddle, smoothstep(0.80, 0.97, abs(P.x) / uRoadHalf) * 0.92);
    puddle *= uWetness;

    // Even outside the puddles the road is soaked — this is a cloudburst.
    float wet = mix(0.62 * uWetness, 1.0, puddle);

    /* ---------------------------- normal ----------------------------- */

    vec3 nTex = texture2D(tNormal, uvA).xyz * 2.0 - 1.0;
    vec3 N = normalize(vec3(nTex.x, 1.0, nTex.y) * vec3(1.0, 1.0, 1.0));
    N = normalize(mix(N, vec3(0.0, 1.0, 0.0), 0.35 + 0.6 * puddle));

    // Ripple detail is worth its cost only where it will be seen; past ~30m
    // one screen pixel spans several rings and the sum is just noise.
    float rippleFade = smoothstep(46.0, 12.0, viewDist);
    vec2 slope = vec2(0.0);
    if (rippleFade > 0.01) {
      slope += rippleSlope(P.xz, uTime, uRainRate) * 0.85 * rippleFade;
      slope += chopSlope(P.xz, uTime) * 0.22;
    }
    N = normalize(N + vec3(slope.x, 0.0, slope.y) * (0.30 + 1.25 * puddle));

    float rough = mix(0.46, 0.055, wet);
    rough = mix(rough, rough * 1.12, paint * 0.4);
    float a = max(rough * rough, 0.0015);
    float a2 = a * a;

    /* ---------------------------- lighting --------------------------- */

    // Ambient is the sky the road can see: an overcast city night, which is
    // dimly lit from below by everything else in the street.
    vec3 col = albedo * uSkyColor * (0.16 + 0.10 * (1.0 - puddle));

    float ndv = max(dot(N, V), 1e-4);

    for (int e = 0; e < ${MAX_EMITTERS}; e++) {
      if (e >= uEmitterCount) break;
      vec3  lp = uEmitterPos[e].xyz;
      float radius = uEmitterPos[e].w;
      vec3  lc = uEmitterCol[e].rgb;
      float li = uEmitterCol[e].w;

      vec3 Ld = lp - P;
      float d = length(Ld);
      vec3 L = Ld / d;
      float atten = li / (1.0 + (d / radius) * (d / radius) * 3.2);
      if (atten < 0.0006) continue;

      float ndl = max(dot(N, L), 0.0);
      col += albedo * lc * ndl * atten * 1.5;

      // GGX. Low roughness plus a rippled normal is the whole trick: the
      // highlight smears down the reflection direction and breaks into the
      // broken vertical streak a wet road gives a street lamp.
      vec3 H = normalize(L + V);
      float ndh = max(dot(N, H), 0.0);
      float vdh = max(dot(V, H), 1e-4);
      float dnm = ndh * ndh * (a2 - 1.0) + 1.0;
      float D = a2 / (PI * dnm * dnm);
      float k = a * 0.5;
      float G = (ndl / (ndl * (1.0 - k) + k)) * (ndv / (ndv * (1.0 - k) + k));
      float F = 0.028 + 0.972 * pow(1.0 - vdh, 5.0);
      col += lc * (D * G * F) * atten * wet * ndl * 2.6;
    }

    /* --------------------------- reflection -------------------------- */

    // Planar mirror, sampled at the fragment's own screen position — the
    // reflection camera is the view camera mirrored in this plane, so a point
    // on the plane and its reflected world lie on the same pixel.
    vec2 suv = gl_FragCoord.xy / uResolution;
    // Distortion has to shrink with distance or the far road turns to mush:
    // the same slope covers fewer pixels the further away the water is.
    float distort = (0.10 * puddle + 0.02) / (1.0 + viewDist * 0.30);
    suv += vec2(N.x, N.z) * distort;
    suv = clamp(suv, vec2(0.0015), vec2(0.9985));
    vec3 refl = texture2D(tReflect, suv).rgb;

    float fres = 0.03 + 0.97 * pow(1.0 - ndv, 5.0);
    // Rough water scatters the reflection away; smooth puddles keep it.
    float mirror = clamp(fres * wet * mix(0.35, 1.0, puddle) * (1.0 - rough * 1.4), 0.0, 0.92);
    col = mix(col, refl, mirror);

    /* ------------------------------ fog ------------------------------ */

    float fogF = 1.0 - exp(-uFogDensity * uFogDensity * viewDist * viewDist);
    col = mix(col, uFogColor, clamp(fogF, 0.0, 1.0));

    gl_FragColor = vec4(col, 1.0);

    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/** A small tiling field of correlated noise: puddles, wear and chop. */
export function noiseTexture(noise, size = 256) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const u = (x / size) * 8;
      const v = (y / size) * 8;
      // Broad hollows, mid chop, fine wear — one field per channel so the
      // shader can correlate them instead of drawing three unrelated noises.
      data[i] = Math.round((noise.fbm2D(u, v, { octaves: 3, gain: 0.55 }) * 0.5 + 0.5) * 255);
      data[i + 1] = Math.round((noise.fbm2D(u * 2.3 + 40, v * 2.3 - 17, { octaves: 2 }) * 0.5 + 0.5) * 255);
      data[i + 2] = Math.round((noise.fbm2D(u * 5.1 - 90, v * 5.1 + 61, { octaves: 4, gain: 0.6 }) * 0.5 + 0.5) * 255);
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

export function createRoadMaterial({ surface, noiseTex, reflectTexture, emitterUniforms, fogColor, fogDensity, skyColor, roadHalf, crossZ, resolution }) {
  const uniforms = {
    ...emitterUniforms,
    tDiffuse: { value: surface.map },
    tNormal: { value: surface.normalMap },
    tRough: { value: surface.roughnessMap },
    tReflect: { value: reflectTexture },
    tNoise: { value: noiseTex },
    uResolution: { value: new THREE.Vector2(resolution.x, resolution.y) },
    uTime: { value: 0 },
    uCamPos: { value: new THREE.Vector3() },
    uFogColor: { value: new THREE.Color(fogColor) },
    uFogDensity: { value: fogDensity },
    uSkyColor: { value: new THREE.Color(skyColor) },
    uRoadHalf: { value: roadHalf },
    uCrossZ: { value: crossZ },
    uWetness: { value: 1 },
    uRainRate: { value: 0.85 }
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    fog: false,
    toneMapped: true
  });

  return material;
}

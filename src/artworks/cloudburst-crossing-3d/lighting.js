/**
 * One emitter list, shared by every shader in the piece.
 *
 * The road, the rain, the spray and the ground mist all sample the same
 * uniform arrays — literally the same uniform objects, uploaded once. That is
 * a performance detail second and a compositional rule first: a lamp cannot
 * brighten the pavement without also brightening the rain falling through it
 * and the mist boiling at its foot. Give each system its own idea of where
 * the light is and the image separates into stacked effects, which is exactly
 * the failure mode the studio's brief warns about.
 */

import * as THREE from 'three';

export const MAX_EMITTERS = 14;

/** Uniform block shared by every lit material. */
export function createEmitterUniforms() {
  return {
    uEmitterPos: { value: Array.from({ length: MAX_EMITTERS }, () => new THREE.Vector4()) },
    uEmitterCol: { value: Array.from({ length: MAX_EMITTERS }, () => new THREE.Vector4()) },
    uEmitterCount: { value: 0 }
  };
}

/** GLSL declarations matching the block above. */
export const EMITTER_UNIFORMS_GLSL = /* glsl */ `
  uniform vec4 uEmitterPos[${MAX_EMITTERS}];   // xyz = world position, w = radius
  uniform vec4 uEmitterCol[${MAX_EMITTERS}];   // rgb = colour,        w = intensity
  uniform int  uEmitterCount;
`;

/**
 * In-scattered light at a point in the air.
 *
 * Used by everything volumetric — rain streaks, spray, mist. No normal, no
 * shadowing: a droplet scatters in every direction, so all that matters is
 * how much light reaches it.
 */
export const EMITTER_AIR_GLSL = /* glsl */ `
  vec3 airLight(vec3 P, float reach) {
    vec3 sum = vec3(0.0);
    for (int e = 0; e < ${MAX_EMITTERS}; e++) {
      if (e >= uEmitterCount) break;
      vec3 d = uEmitterPos[e].xyz - P;
      float r = uEmitterPos[e].w * reach;
      float dist2 = dot(d, d);
      sum += uEmitterCol[e].rgb * uEmitterCol[e].w / (1.0 + dist2 / (r * r) * 3.0);
    }
    return sum;
  }
`;

/**
 * The emitters worth uploading, ranked by what they will actually contribute.
 *
 * A street has more lit windows than the array can hold, and the ones that
 * matter are the ones whose light lands in frame. Ranking by intensity and
 * reach against distance keeps a shopfront forty metres up the road from
 * displacing the near lamp that is drawing the long streak on the water.
 */
export function packEmitters(uniforms, emitters, camPos) {
  const scored = emitters
    .map((e) => ({
      e,
      score: (e.intensity * e.radius * e.radius) / (1 + e.position.distanceToSquared(camPos) * 0.04)
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_EMITTERS);

  const pos = uniforms.uEmitterPos.value;
  const col = uniforms.uEmitterCol.value;
  for (let i = 0; i < scored.length; i++) {
    const { e } = scored[i];
    pos[i].set(e.position.x, e.position.y, e.position.z, e.radius);
    col[i].set(e.color.r, e.color.g, e.color.b, e.intensity);
  }
  uniforms.uEmitterCount.value = scored.length;
  return scored.map((s) => s.e);
}

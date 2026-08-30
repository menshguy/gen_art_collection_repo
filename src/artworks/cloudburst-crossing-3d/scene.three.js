/**
 * Cloudburst Crossing 3D
 *
 * Four systems, all reading one shared emitter list:
 *
 *   1. a street in metres — scanned CC0 street furniture graded down into a
 *      sodium-lit night, with real kerbs, brackets and signal visors;
 *   2. a wet road shader — puddles carved by the camber, a mirrored
 *      half-resolution pass rippled by the water, and one GGX highlight per
 *      emitter, which is what stretches a lamp into a vertical smear;
 *   3. rain as depth-graded shells lit by those same emitters, landing as
 *      ring ripples in the road shader and a ground-hugging spray band;
 *   4. ink-and-wash figures, drawn rather than modelled, walking through
 *      the fog.
 *
 * Nothing here is allowed to be an independent effect. A lamp that brightens
 * has to brighten the rain falling through it, the mist at its foot and the
 * streak on the water beneath it, or the image comes apart into layers.
 */

import * as THREE from 'three';
import { disposeObject } from '../../runtime/three-host.js';
import { envSource, surfaces } from './assets.js';
import {
  LAYOUT, PALETTE, buildGround, buildFacades, buildLamps, buildSignal, buildProps
} from './city.js';
import { createRoadMaterial, noiseTexture } from './road.js';
import { createEmitterUniforms, packEmitters } from './lighting.js';
import { createRain } from './rain.js';
import { createCrowd } from './crowd.js';
import { createTraffic } from './vehicles.js';

export default function scene({ renderer, width, height, seed, rng, noise, capture, pane }) {
  const disposables = [];
  const world = new THREE.Scene();
  const L = LAYOUT;
  const CROSS_Z = -8.6;

  /* ------------------------------ camera ------------------------------ */

  // Standing at the kerb on the right-hand pavement, looking across the
  // crossing and up the street. Deliberately off-axis: the vanishing point
  // sits left of centre so the road runs out of the bottom-left corner
  // instead of forming a symmetrical corridor, and the eye is low enough
  // that the water owns the bottom half of the frame.
  const camera = new THREE.PerspectiveCamera(41, width / height, 0.15, 220);
  const camHome = new THREE.Vector3(2.62, 1.31, 6.6);
  const camTarget = new THREE.Vector3(-2.05, 0.62, -19);
  camera.position.copy(camHome);
  camera.lookAt(camTarget);

  /* --------------------------- air and light --------------------------- */

  const fogColor = new THREE.Color(PALETTE.fog);
  world.background = fogColor;
  // Thick, and exponential. The fog is not atmosphere for its own sake: it is
  // what lets a car or a figure arrive out of the distance instead of popping
  // into existence at a spawn point.
  const FOG_DENSITY = 0.036;
  world.fog = new THREE.FogExp2(fogColor, FOG_DENSITY);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const envMap = pmrem.fromEquirectangular(envSource).texture;
  world.environment = envMap;
  world.environmentIntensity = 0.42;
  pmrem.dispose();

  const sky = new THREE.HemisphereLight(0x3d4756, 0x090b0e, 0.5);
  world.add(sky);

  /* ------------------------------- street ------------------------------ */

  const emitters = [];
  const emitterUniforms = createEmitterUniforms();
  const streetGroup = new THREE.Group();
  streetGroup.add(buildGround(disposables));
  streetGroup.add(buildFacades(rng, disposables, emitters));
  streetGroup.add(buildLamps(rng, disposables, emitters));
  streetGroup.add(buildSignal(disposables, emitters, { x: L.roadHalf + 0.6, z: CROSS_Z - 4.2, facing: 1 }));
  streetGroup.add(buildProps(rng, disposables));
  world.add(streetGroup);

  /* ------------------------------ traffic ------------------------------ */

  const glowTex = radialTexture();
  disposables.push(glowTex);
  const traffic = createTraffic({
    rng, disposables, emitters, glowTexture: glowTex, roadHalf: L.roadHalf,
    fogColor, fogDensity: FOG_DENSITY
  });
  world.add(traffic.group);

  /* ------------------------------- glows ------------------------------- */

  // A lamp in falling rain is not a point — it is a sphere of lit water. The
  // halo is what puts the light *in the air* rather than only on the surfaces
  // it reaches, and it is the main reason the far end of the street reads as
  // depth rather than a flat grey wall.
  const glowGroup = new THREE.Group();
  for (const e of emitters) {
    if (!e.glow) continue;
    const mat = new THREE.SpriteMaterial({
      map: glowTex,
      color: e.color,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
      opacity: 0.75,
      fog: false
    });
    disposables.push(mat);
    const sprite = new THREE.Sprite(mat);
    sprite.position.copy(e.position);
    // Sized to the lamp, not to its reach. A halo scaled from the emitter's
    // 16m radius is a 13m screen-aligned quad that ploughs through the road,
    // and the road then depth-clips it into a hard horizontal edge across
    // half the frame. The glow's job is to bloom the lamp; the rain and the
    // mist are what carry its light out into the air.
    sprite.scale.setScalar(e.glowSize ?? 3.4);
    sprite.renderOrder = 1;
    glowGroup.add(sprite);
  }
  world.add(glowGroup);

  /* -------------------------- reflection pass -------------------------- */

  // Half resolution. A reflection in disturbed water is low-frequency by the
  // time it reaches the eye, so the detail thrown away here is detail the
  // ripple distortion would have destroyed anyway — and it buys back the
  // whole cost of the second pass.
  const rt = new THREE.WebGLRenderTarget(Math.round(width / 2), Math.round(height / 2), {
    type: THREE.HalfFloatType,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: true
  });
  const mirrorCam = new THREE.PerspectiveCamera(camera.fov, camera.aspect, camera.near, camera.far);
  const mirrorTarget = new THREE.Vector3();
  const mirrorUp = new THREE.Vector3();
  const scratchFwd = new THREE.Vector3();

  /* -------------------------------- road ------------------------------- */

  const noiseTex = noiseTexture(noise);
  const roadGeo = new THREE.PlaneGeometry(L.roadHalf * 2, L.far + L.near, 1, 1);
  const roadMat = createRoadMaterial({
    surface: surfaces.asphalt,
    noiseTex,
    reflectTexture: rt.texture,
    emitterUniforms,
    fogColor,
    fogDensity: FOG_DENSITY,
    skyColor: 0x5a6878,
    roadHalf: L.roadHalf,
    crossZ: CROSS_Z,
    resolution: { x: width, y: height }
  });
  disposables.push(roadGeo, roadMat, noiseTex);
  const road = new THREE.Mesh(roadGeo, roadMat);
  road.rotation.x = -Math.PI / 2;
  road.position.z = -(L.far - L.near) / 2;
  world.add(road);



  /* -------------------------------- rain ------------------------------- */

  const rain = createRain({
    rng,
    emitterUniforms,
    fogColor,
    fogDensity: FOG_DENSITY,
    // Rain that is not in a light pool still has to be faintly visible, or
    // the dark half of the frame goes dry. This is the sky's own scatter.
    ambient: new THREE.Color(0x46536a),
    focus: { x: 0, z: CROSS_Z + 2 }
  });
  world.add(rain.group);

  /* ------------------------------- people ------------------------------ */

  const crowd = createCrowd({
    rng,
    emitterUniforms,
    fogColor,
    fogDensity: FOG_DENSITY,
    crossZ: CROSS_Z,
    roadHalf: L.roadHalf,
    kerbHeight: L.kerbHeight
  });
  world.add(crowd.group);

  /* ------------------------------ renderer ----------------------------- */

  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;

  if (pane) {
    const p = { exposure: renderer.toneMappingExposure };
    pane.addBinding(p, 'exposure', { min: 0.2, max: 2.5, step: 0.01 })
      .on('change', (ev) => { renderer.toneMappingExposure = ev.value; });
    pane.addBinding(roadMat.uniforms.uWetness, 'value', { label: 'wetness', min: 0, max: 1, step: 0.01 });
    pane.addBinding(roadMat.uniforms.uRainRate, 'value', { label: 'rain rate', min: 0, max: 1, step: 0.01 });
  }

  return {
    scene: world,
    camera,

    update(t) {
      roadMat.uniforms.uTime.value = t;
      roadMat.uniforms.uCamPos.value.copy(camera.position);
      traffic.update(t);
      // Headlights move, so the ranked shortlist has to be rebuilt each frame
      // rather than baked once — otherwise an approaching car lights nothing.
      packEmitters(emitterUniforms, emitters, camera.position);
      rain.update(t, noise, camera.position);
      crowd.update(t);
    },

    render(renderer) {
      // The mirror camera is the view camera reflected in the road plane, so
      // a point on the road and the world it reflects land on the same pixel
      // and the shader can sample by screen position alone.
      mirrorCam.fov = camera.fov;
      mirrorCam.aspect = camera.aspect;
      mirrorCam.position.set(camera.position.x, -camera.position.y, camera.position.z);
      camera.getWorldDirection(scratchFwd);
      mirrorTarget.set(
        camera.position.x + scratchFwd.x,
        -(camera.position.y + scratchFwd.y),
        camera.position.z + scratchFwd.z
      );
      // Reflecting `up` as well as the eye keeps the basis right-handed, so
      // nothing has to have its winding order flipped for this pass.
      mirrorUp.set(0, 1, 0).applyQuaternion(camera.quaternion);
      mirrorUp.y *= -1;
      mirrorCam.up.copy(mirrorUp);
      mirrorCam.lookAt(mirrorTarget);
      mirrorCam.updateMatrixWorld();
      mirrorCam.projectionMatrix.copy(camera.projectionMatrix);
      mirrorCam.projectionMatrixInverse.copy(camera.projectionMatrixInverse);

      // Rain is excluded from the mirror pass. Reflected rain would be rain
      // falling *upwards* out of the water, and the streaks are dense enough
      // that the error is immediately legible.
      road.visible = false;
      rain.group.visible = false;
      renderer.setRenderTarget(rt);
      renderer.clear();
      renderer.render(world, mirrorCam);
      road.visible = true;
      rain.group.visible = true;

      renderer.setRenderTarget(null);
      renderer.render(world, camera);
    },

    resize(w, h) {
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      rt.setSize(Math.round(w / 2), Math.round(h / 2));
      roadMat.uniforms.uResolution.value.set(w, h);
    },

    dispose() {
      rain.dispose();
      crowd.dispose();
      disposeObject(world);
      for (const d of disposables) d.dispose?.();
      envMap.dispose();
      rt.dispose();
      world.clear();
    }
  };
}

/** A soft radial falloff, used for every glow in the piece. */
function radialTexture(size = 128) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  // Two-stage falloff: a small bright core inside a wide, very faint bloom,
  // which is how a light source in fog actually falls off. A single linear
  // gradient reads as a sticker.
  g.addColorStop(0.0, 'rgba(255,255,255,1)');
  g.addColorStop(0.06, 'rgba(255,255,255,0.62)');
  g.addColorStop(0.22, 'rgba(255,255,255,0.20)');
  g.addColorStop(0.52, 'rgba(255,255,255,0.045)');
  g.addColorStop(1.0, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

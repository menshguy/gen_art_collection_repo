/**
 * Traffic.
 *
 * The complaint about the p5 version was that cars popped in and out at
 * random, so the rule here is simple and absolute: a vehicle only ever
 * changes state where the fog is already opaque. Each car runs a long lane
 * from ~80m out to ~20m behind the camera and is recycled at the far end,
 * where `1 - exp(-(density*d)^2)` has been sitting at 0.99 for twenty metres.
 * Nothing appears; things arrive.
 *
 * The bodies are primitives, not scans, and that is deliberate. At the
 * distance traffic lives at in this weather a car is a silhouette and two
 * lights — the geometry that would repay a scan is never resolved, while the
 * headlights, which *are* resolved, matter enormously: they join the shared
 * emitter list, so an approaching car lights the road, the falling rain and
 * the mist as it comes, and drags its own reflection up the water towards
 * the camera.
 */

import * as THREE from 'three';
import { PALETTE } from './city.js';

/**
 * The beam.
 *
 * A headlight in a downpour is not a bright dot, it is a visible shaft — the
 * one thing that makes traffic read as traffic at forty metres in fog. Drawn
 * as an open cone with additive blending on both faces, so the shell doubles
 * up towards the silhouette and the shaft looks denser at its edges, which is
 * how a real light cone in suspended water behaves.
 */
const beamVert = /* glsl */ `
  varying float vT;
  varying float vR;
  varying float vDist;
  void main() {
    // The cone is built along +Y with its apex up; uv.y runs base-to-apex.
    vT = 1.0 - uv.y;
    vR = 1.0;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vDist = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const beamFrag = /* glsl */ `
  precision mediump float;
  uniform vec3  uColor;
  uniform float uOpacity;
  uniform vec3  uFogColor;
  uniform float uFogDensity;
  varying float vT;
  varying float vDist;
  void main() {
    // Dense at the lamp, gone by the end of its throw.
    float a = pow(max(0.0, 1.0 - vT), 2.2) * uOpacity;
    if (a < 0.003) discard;
    float f = 1.0 - exp(-uFogDensity * uFogDensity * vDist * vDist);
    gl_FragColor = vec4(mix(uColor, uFogColor, clamp(f, 0.0, 1.0)) * a, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const BODY_COLORS = [0x1d2026, 0x2a2118, 0x14181d, 0x232a2e, 0x2b2326];

function buildBody(rng, disposables) {
  const car = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({
    color: new THREE.Color(rng.pick(BODY_COLORS)),
    roughness: 0.14,     // soaked: a car in a downpour is a mirror with wheels
    metalness: 0.55,
    envMapIntensity: 1.5
  });
  // Dark glass with a restrained environment: a windscreen that mirrors the
  // sky at full strength turns into a white slab, which is exactly how the
  // first pass at these cars read.
  const glass = new THREE.MeshStandardMaterial({
    color: 0x090c10, roughness: 0.10, metalness: 0.25, envMapIntensity: 0.7,
    side: THREE.DoubleSide
  });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x0b0c0e, roughness: 0.75 });
  disposables.push(paint, glass, rubber);

  const len = rng.range(4.2, 4.9);
  const wid = rng.range(1.72, 1.86);

  // The body is an extruded side profile, not a stack of boxes. Head-on in
  // fog a box reads as a fridge with two lights on it; what identifies a car
  // at forty metres is the line — a low nose, a bonnet, a cabin set back and
  // tucked in, a boot. One shape gets all of that, and the bevel gives the
  // wet paint an edge highlight to run along.
  const L = len / 2;
  const profile = new THREE.Shape();
  profile.moveTo(-L, 0.20);
  profile.lineTo(-L, 0.46);
  profile.lineTo(-L * 0.80, 0.66);
  profile.lineTo(-L * 0.44, 0.74);
  profile.lineTo(-L * 0.26, 1.28);
  profile.lineTo(L * 0.06, 1.40);
  profile.lineTo(L * 0.34, 1.26);
  profile.lineTo(L * 0.50, 0.76);
  profile.lineTo(L * 0.88, 0.68);
  profile.lineTo(L, 0.50);
  profile.lineTo(L, 0.20);
  profile.closePath();

  const bodyGeo = new THREE.ExtrudeGeometry(profile, {
    depth: wid, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.07, bevelSegments: 2, steps: 1
  });
  bodyGeo.translate(0, 0, -wid / 2);
  // Head-on, a car's identifying feature is that the roof is narrower than
  // the sills. Without this taper the extruded profile is still a rectangle
  // from the only angle oncoming traffic is ever seen from.
  {
    const pos = bodyGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      const t = Math.min(1, Math.max(0, (y - 0.62) / 0.78));
      pos.setZ(i, pos.getZ(i) * (1 - 0.26 * t * t));
    }
    pos.needsUpdate = true;
    bodyGeo.computeVertexNormals();
  }
  bodyGeo.rotateY(Math.PI / 2);
  const wheel = new THREE.CylinderGeometry(0.33, 0.33, 0.24, 14);
  const screen = new THREE.PlaneGeometry(1, 1);
  disposables.push(bodyGeo, wheel, screen);

  const body = new THREE.Mesh(bodyGeo, paint);
  body.castShadow = true;
  car.add(body);

  // Windscreen and backlight, laid on the profile's own slopes.
  for (const s of [1, -1]) {
    const pane = new THREE.Mesh(screen, glass);
    pane.scale.set(wid * 0.84, 0.72, 1);
    pane.position.set(0, 1.07, s > 0 ? L * 0.20 : -L * 0.36);
    pane.rotation.x = s > 0 ? -0.62 : 0.70;
    car.add(pane);
  }

  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const w = new THREE.Mesh(wheel, rubber);
      w.rotation.z = Math.PI / 2;
      w.position.set(sx * wid * 0.5, 0.33, sz * len * 0.30);
      car.add(w);
    }
  }

  return { car, len, wid };
}

export function createTraffic({ rng, disposables, emitters, glowTexture, roadHalf, fogColor, fogDensity }) {
  const group = new THREE.Group();
  const cars = [];

  // Two coming towards the camera and one going away: headlights for the
  // light, tail lights for the depth, and never a symmetrical pair.
  const plan = [
    { lane: -roadHalf * 0.52, dir: 1, speed: rng.range(7.5, 9.5), z: -34 },
    { lane: -roadHalf * 0.52, dir: 1, speed: rng.range(6.5, 8.0), z: -66 },
    { lane: roadHalf * 0.50, dir: -1, speed: rng.range(8.5, 11.0), z: -13 }
  ];

  const lampGeo = new THREE.CircleGeometry(0.155, 14);
  const beamGeo = new THREE.ConeGeometry(1.55, 11, 16, 1, true);
  beamGeo.translate(0, -11 / 2, 0);
  // Apex at the origin, throw along +Z, so a car's own facing rotation aims
  // it. Rotating the other way points every beam out of the back of the car.
  beamGeo.rotateX(-Math.PI / 2);
  disposables.push(lampGeo, beamGeo);

  for (const p of plan) {
    const { car, len, wid } = buildBody(rng, disposables);
    car.rotation.y = p.dir > 0 ? 0 : Math.PI;
    group.add(car);

    const facing = p.dir;                       // +1 = towards the camera
    const headHex = 0xfff2d8;
    const tailHex = 0xff2a18;

    const lights = [];
    for (const sx of [-1, 1]) {
      const headMat = new THREE.MeshBasicMaterial({ color: headHex });
      const tailMat = new THREE.MeshBasicMaterial({ color: tailHex });
      disposables.push(headMat, tailMat);

      const head = new THREE.Mesh(lampGeo, headMat);
      head.position.set(sx * wid * 0.36, 0.66, len * 0.5 * facing + 0.03 * facing);
      head.rotation.y = facing > 0 ? 0 : Math.PI;
      car.add(head);

      const tail = new THREE.Mesh(lampGeo, tailMat);
      tail.scale.set(1, 0.55, 1);
      tail.position.set(sx * wid * 0.38, 0.74, -len * 0.5 * facing - 0.03 * facing);
      tail.rotation.y = facing > 0 ? Math.PI : 0;
      car.add(tail);

      // Only the headlights join the emitter list. Tail lights are bright
      // enough to see and far too dim to light anything, and adding them
      // would just crowd out a street lamp in the ranking.
      const emitter = {
        position: new THREE.Vector3(),
        color: new THREE.Color(headHex),
        intensity: 0.55,
        radius: 12,
        glow: 0
      };
      emitters.push(emitter);
      lights.push({ emitter, local: new THREE.Vector3(sx * wid * 0.36, 0.66, len * 0.5 * facing) });

      const glowMat = new THREE.SpriteMaterial({
        map: glowTexture, color: new THREE.Color(headHex), blending: THREE.AdditiveBlending,
        depthWrite: false, transparent: true, opacity: 0.62, fog: false
      });
      const tailGlowMat = new THREE.SpriteMaterial({
        map: glowTexture, color: new THREE.Color(tailHex), blending: THREE.AdditiveBlending,
        depthWrite: false, transparent: true, opacity: 0.3, fog: false
      });
      disposables.push(glowMat, tailGlowMat);

      const beamMat = new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: new THREE.Color(headHex) },
          uOpacity: { value: 0.30 },
          uFogColor: { value: new THREE.Color(fogColor) },
          uFogDensity: { value: fogDensity }
        },
        vertexShader: beamVert,
        fragmentShader: beamFrag,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        toneMapped: true
      });
      disposables.push(beamMat);
      const beam = new THREE.Mesh(beamGeo, beamMat);
      beam.position.copy(head.position);
      // Dipped, and splayed a little outwards.
      beam.rotation.set(facing > 0 ? -0.055 : 0.055, facing > 0 ? sx * 0.05 : Math.PI - sx * 0.05, 0);
      beam.renderOrder = 6;
      car.add(beam);

      const glow = new THREE.Sprite(glowMat);
      // Kept clear of the road: a headlight halo big enough to touch the
      // tarmac gets sliced by it.
      glow.scale.setScalar(1.5);
      glow.position.copy(head.position);
      car.add(glow);

      const tailGlow = new THREE.Sprite(tailGlowMat);
      tailGlow.scale.setScalar(0.85);
      tailGlow.position.copy(tail.position);
      car.add(tailGlow);
    }

    // The plume off the back wheels. In this much water it is the loudest
    // thing a moving car does, and it is what stops the car looking like it
    // is driving through a still photograph.
    const sprayMat = new THREE.SpriteMaterial({
      map: glowTexture, color: new THREE.Color(0x8f9bad), blending: THREE.NormalBlending,
      depthWrite: false, transparent: true, opacity: 0.16, fog: true
    });
    disposables.push(sprayMat);
    const plumes = [];
    for (let i = 0; i < 3; i++) {
      const s = new THREE.Sprite(sprayMat);
      s.scale.setScalar(1.1 + i * 0.7);
      s.position.set(0, 0.26 + i * 0.09, (-len * 0.5 - 0.35 - i * 0.9) * facing);
      car.add(s);
      plumes.push(s);
    }

    cars.push({ car, lights, z0: p.z, dir: p.dir, speed: p.speed, lane: p.lane, plumes });
  }

  const SPAN = 108;      // -84 .. +24, both ends deep inside opaque fog
  const START = -84;

  return {
    group,
    update(t) {
      for (const c of cars) {
        const travel = c.speed * t * c.dir;
        let z = c.z0 + travel;
        z = ((z - START) % SPAN + SPAN) % SPAN + START;
        c.car.position.set(c.lane, 0, z);
        for (const l of c.lights) {
          l.emitter.position.set(c.lane + l.local.x, l.local.y, z + l.local.z);
        }
      }
    }
  };
}

export const TRAFFIC_TAIL = PALETTE.signalRed;

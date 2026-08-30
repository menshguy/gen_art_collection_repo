/**
 * The street itself: kerbs, facades, shopfronts, signals, and the scanned
 * props that dress them. Everything is in metres — the camera, the rain and
 * the figures all share these coordinates, which is the whole reason for
 * moving this piece off a 2D pinhole fake and into a real scene.
 *
 * X runs across the street, Y is up, Z runs away from the camera (negative).
 */

import * as THREE from 'three';
import { instance, surfaces } from './assets.js';

export const LAYOUT = {
  roadHalf: 5.2,   // kerb to kerb is 10.4m — a two-lane street with parking
  kerbHeight: 0.15,
  walkWidth: 4.2,
  get facade() { return this.roadHalf + this.walkWidth; },
  far: 78,         // everything past this is pure fog
  near: 16         // road continues behind the camera so reflections have fetch
};

export const PALETTE = {
  night: 0x2a2f38,
  fog: 0x333a44,
  asphalt: 0x0d0f13,
  kerb: 0x33343a,
  brick: 0x2a2621,
  sodium: 0xffab52,
  mercury: 0xbcd3e8,
  signalRed: 0xff3a26,
  signalGreen: 0x2fe08e,
  warmWindow: 0xffcf8c,
  coolWindow: 0x86c6dd
};

/**
 * Every source of light in the frame, in one list.
 *
 * The road shader, the rain shader and the ground mist all read this, so a
 * lamp cannot glow on the pavement without also lighting the rain falling
 * through it and smearing down the puddle beneath it. Keeping them in one
 * array is what stops the piece looking like unrelated effects stacked up.
 */
export function makeEmitters() {
  return [];
}

/* --------------------------- material grading --------------------------- */

/**
 * Photogrammetry albedo is shot in daylight. Dropped into a sodium-lit night
 * it reads as a bright daytime object pasted onto a dark plate, so every
 * scanned material is pulled down in value, pushed towards the night's
 * blue-grey, and wetted: rain has been falling on all of this for an hour.
 */
export function gradeWet({ darken = 0.34, tint = PALETTE.night, tintAmount = 0.3, roughness = 0.24, metalness = null } = {}) {
  return (m) => {
    if (m.color) m.color.multiplyScalar(darken).lerp(new THREE.Color(tint), tintAmount);
    if ('roughness' in m) m.roughness = roughness;
    if (metalness !== null && 'metalness' in m) m.metalness = metalness;
    if (m.map) m.map.anisotropy = 8;
    m.envMapIntensity = 1.15;
  };
}

/* ------------------------------- surfaces ------------------------------- */

export function buildGround(disposables) {
  const group = new THREE.Group();
  const L = LAYOUT;
  const depth = L.far + L.near;
  const midZ = -(L.far - L.near) / 2;

  // Pavements. Real kerbs, because the kerb line is the strongest drawn edge
  // in a street photograph and the thing that tells you where the water goes.
  const walkMat = new THREE.MeshStandardMaterial({
    ...surfaces.pavement,
    color: new THREE.Color(0x6f7176),
    roughness: 0.62,
    metalness: 0.02,
    normalScale: new THREE.Vector2(0.7, 0.7)
  });
  disposables.push(walkMat);

  const kerbMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(PALETTE.kerb),
    roughness: 0.45,
    metalness: 0.02
  });
  disposables.push(kerbMat);

  for (const side of [-1, 1]) {
    const walkGeo = new THREE.BoxGeometry(L.walkWidth, L.kerbHeight, depth);
    disposables.push(walkGeo);
    const walk = new THREE.Mesh(walkGeo, walkMat);
    walk.position.set(side * (L.roadHalf + L.walkWidth / 2), L.kerbHeight / 2, midZ);
    walk.receiveShadow = true;
    group.add(walk);

    // A thin darker face on the kerb edge so it reads as a step, not a shade.
    const faceGeo = new THREE.BoxGeometry(0.09, L.kerbHeight * 1.02, depth);
    disposables.push(faceGeo);
    const face = new THREE.Mesh(faceGeo, kerbMat);
    face.position.set(side * (L.roadHalf - 0.03), L.kerbHeight / 2, midZ);
    group.add(face);
  }

  return group;
}

/* ------------------------------- facades -------------------------------- */

/**
 * Buildings are deliberately dumb: extruded blocks with a brick surface and
 * lit apertures. In this weather nothing above the first floor survives the
 * fog, so detail there would be spent on pixels that never resolve. What has
 * to be right is the shopfront band at eye level, because that is where the
 * warm light comes from.
 */
export function buildFacades(rng, disposables, emitters) {
  const group = new THREE.Group();
  const L = LAYOUT;

  const brickMat = new THREE.MeshStandardMaterial({
    ...surfaces.brick,
    color: new THREE.Color(PALETTE.brick),
    roughness: 0.78,
    metalness: 0.0,
    normalScale: new THREE.Vector2(0.8, 0.8)
  });
  disposables.push(brickMat);

  const glassGeo = new THREE.PlaneGeometry(1, 1);
  disposables.push(glassGeo);

  for (const side of [-1, 1]) {
    let z = L.near - 4;
    while (z > -L.far) {
      // Frontage widths cluster around a shop unit rather than spreading
      // uniformly — a terrace is repeated modules with occasional doubles.
      const w = rng.weighted([4.5, 6.5, 9.5, 14], [4, 4, 2, 1]) * rng.range(0.9, 1.1);
      const h = rng.range(9, 22);
      const setback = rng.range(0, 0.5);

      const geo = new THREE.BoxGeometry(10, h, w);
      disposables.push(geo);
      const block = new THREE.Mesh(geo, brickMat);
      block.position.set(side * (L.facade + 5 + setback), h / 2, z - w / 2);
      block.castShadow = true;
      block.receiveShadow = true;
      group.add(block);

      // Shopfront: one lit aperture per unit, not every unit lit.
      // Nothing lit on the two units nearest the camera: a bright pane a few
      // metres off the lens is a flat cream slab pinned to the frame edge,
      // and it competes with the figure it is standing behind.
      if (rng.chance(0.62) && z < -5.5 && z > -L.far * 0.72) {
        const warm = rng.chance(0.86);
        const hex = warm ? PALETTE.warmWindow : PALETTE.coolWindow;
        const glassH = rng.range(2.0, 2.8);
        const glassW = w * rng.range(0.42, 0.66);
        // A shopfront seen through this much rain is a dim, warm rectangle,
        // not a lightbox. Held near the fog's own value it reads as depth;
        // any brighter and it reads as a hole cut in the wall.
        const mat = new THREE.MeshBasicMaterial({
          color: new THREE.Color(hex).multiplyScalar(rng.range(0.09, 0.24)),
          fog: true
        });
        disposables.push(mat);
        const pane = new THREE.Mesh(glassGeo, mat);
        pane.scale.set(glassW, glassH, 1);
        pane.position.set(side * (L.facade + setback - 0.02), glassH / 2 + 0.55, z - w / 2);
        pane.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
        group.add(pane);

        emitters.push({
          position: new THREE.Vector3(pane.position.x, pane.position.y, pane.position.z),
          color: new THREE.Color(hex),
          intensity: 0.22 * glassW * glassH * 0.12,
          radius: 9
        });
      }

      // Upper windows. Almost all of them dark, a handful lit, and none of
      // them joining the emitter list — at this height and this fog density
      // they contribute nothing but the thing the frame actually needs up
      // there, which is evidence that the wall is a building.
      const floors = Math.floor((h - 4.2) / 3.1);
      for (let f = 0; f < floors; f++) {
        const y = 4.6 + f * 3.1;
        const bays = Math.max(1, Math.round(w / 2.9));
        for (let b = 0; b < bays; b++) {
          if (rng.chance(0.14)) continue;          // blind bays, blocked lights
          const wz = z - (b + 0.5) * (w / bays) + rng.jitter(0.12);
          const lit = rng.chance(0.13) && y < 15;
          const warm = rng.chance(0.78);
          const hex = lit ? (warm ? PALETTE.warmWindow : PALETTE.coolWindow) : 0x080a0d;
          const mat = new THREE.MeshBasicMaterial({
            color: new THREE.Color(hex).multiplyScalar(lit ? rng.range(0.10, 0.34) : 1),
            fog: true
          });
          disposables.push(mat);
          const pane = new THREE.Mesh(glassGeo, mat);
          pane.scale.set(rng.range(1.0, 1.3), rng.range(1.45, 1.8), 1);
          pane.position.set(side * (L.facade + setback - 0.015), y + rng.jitter(0.1), wz);
          pane.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
          group.add(pane);
        }
      }

      z -= w + rng.range(0.1, 0.6);
    }
  }

  return group;
}

/* -------------------------------- lamps --------------------------------- */

/**
 * Street lighting.
 *
 * `street_lamp_01` is a 3.9m scanned luminaire — the right object but too
 * short for a carriageway, so it is mounted on a drawn mast and its bulb
 * material is turned into an emitter. The scan supplies the thing a box
 * cannot: a cast aluminium head with real wear in its normal map, which is
 * what sells the lamp when it is the brightest object in the frame.
 */
export function buildLamps(rng, disposables, emitters) {
  const group = new THREE.Group();
  const L = LAYOUT;

  // Staggered, not paired: opposite sides offset by half a span so the light
  // pools alternate down the street instead of forming the rungs of a ladder.
  const span = 15.5;
  const placements = [];
  for (const side of [-1, 1]) {
    const offset = side > 0 ? 0 : span / 2;
    for (let z = 1.5 - offset; z > -L.far; z -= span) {
      placements.push({ side, z: z + rng.jitter(1.1) });
    }
  }

  for (const { side, z } of placements) {
    const x = side * (L.roadHalf + 0.9);
    // The scan is a complete 3.9m post. Scaled a little past life size it
    // sits at the height a carriageway lantern actually hangs at, and its
    // cast-iron wear — which no box will give you — is the reason it holds
    // up as the brightest object in the frame.
    const scale = rng.range(1.32, 1.4);

    const lamp = instance('street_lamp_01', {
      grade: (m) => {
        if (m.name?.includes('bulb')) {
          m.emissive = new THREE.Color(PALETTE.sodium);
          m.emissiveIntensity = 12;
          m.color = new THREE.Color(0x160c02);
          return;
        }
        if (m.name?.includes('glass')) {
          m.emissive = new THREE.Color(PALETTE.sodium);
          m.emissiveIntensity = 2.4;
          m.transparent = true;
          m.opacity = 0.5;
          m.roughness = 0.08;
          m.metalness = 0;
          return;
        }
        gradeWet({ darken: 0.34, tintAmount: 0.4, roughness: 0.34, metalness: 0.55 })(m);
      }
    });
    // The bracket leans out over the carriageway, so each side turns to face
    // the road rather than the shopfronts behind it.
    lamp.rotation.y = side > 0 ? Math.PI * 0.5 : -Math.PI * 0.5;
    lamp.position.set(x, L.kerbHeight, z);
    lamp.scale.setScalar(scale);
    group.add(lamp);

    const lampPos = new THREE.Vector3(x - side * 0.25 * scale, L.kerbHeight + 3.45 * scale, z);
    emitters.push({
      position: lampPos,
      color: new THREE.Color(PALETTE.sodium),
      intensity: 1,
      radius: 16,
      glow: 1,
      glowSize: 5.4
    });

    // A real point light for the near lamps only. Further up the street the
    // emitter list is enough: the road, the rain and the mist all read it,
    // and nothing up there is close enough for a shading falloff to matter.
    if (z > -30) {
      const light = new THREE.PointLight(PALETTE.sodium, 34, 24, 1.9);
      light.position.copy(lampPos);
      group.add(light);
    }
  }

  return group;
}

/* ------------------------------ signal head ----------------------------- */

/**
 * A traffic signal built properly: a housing with three recessed lenses and
 * real visors over them. The visor is the entire reason a signal reads as a
 * signal from the side — without it you have a coloured rectangle, which is
 * what the p5 version had.
 */
export function buildSignal(disposables, emitters, { x, z, facing = 1 }) {
  const group = new THREE.Group();

  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x16181c, roughness: 0.5, metalness: 0.35 });
  const housingGeo = new THREE.BoxGeometry(0.34, 1.05, 0.3);
  const lensGeo = new THREE.CircleGeometry(0.115, 20);
  const visorGeo = new THREE.CylinderGeometry(0.145, 0.145, 0.17, 16, 1, true, 0, Math.PI);
  const poleGeo = new THREE.CylinderGeometry(0.08, 0.1, 1, 10);
  const armGeo = new THREE.CylinderGeometry(0.06, 0.06, 1, 8);
  disposables.push(bodyMat, housingGeo, lensGeo, visorGeo, poleGeo, armGeo);

  const poleH = 5.6;
  const pole = new THREE.Mesh(poleGeo, bodyMat);
  pole.scale.y = poleH;
  pole.position.set(x, poleH / 2, z);
  pole.castShadow = true;
  group.add(pole);

  const armLen = 4.6;
  const arm = new THREE.Mesh(armGeo, bodyMat);
  arm.scale.y = armLen;
  arm.rotation.z = Math.PI / 2;
  arm.position.set(x - Math.sign(x) * armLen / 2, poleH - 0.25, z);
  group.add(arm);

  const headX = x - Math.sign(x) * armLen * 0.82;
  const housing = new THREE.Mesh(housingGeo, bodyMat);
  housing.position.set(headX, poleH - 0.95, z);
  housing.castShadow = true;
  group.add(housing);

  const states = [
    { hex: PALETTE.signalRed, y: 0.34, on: false },
    { hex: 0xffa524, y: 0, on: false },
    { hex: PALETTE.signalGreen, y: -0.34, on: true }
  ];

  for (const s of states) {
    const mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(s.hex).multiplyScalar(s.on ? 1 : 0.06)
    });
    disposables.push(mat);
    const lens = new THREE.Mesh(lensGeo, mat);
    lens.position.set(headX, poleH - 0.95 + s.y, z + facing * 0.16);
    lens.rotation.y = facing > 0 ? 0 : Math.PI;
    group.add(lens);

    const visor = new THREE.Mesh(visorGeo, bodyMat);
    visor.rotation.x = Math.PI / 2;
    visor.rotation.y = facing > 0 ? 0 : Math.PI;
    visor.position.set(headX, poleH - 0.95 + s.y + 0.02, z + facing * 0.23);
    group.add(visor);

    if (s.on) {
      emitters.push({
        position: new THREE.Vector3(headX, poleH - 0.95 + s.y, z),
        color: new THREE.Color(s.hex),
        intensity: 0.16,
        radius: 7
      });
    }
  }

  return group;
}

/* -------------------------------- props --------------------------------- */

/**
 * Kerbside clutter, placed against the kerb line rather than scattered.
 * Real pavements organise their junk: bins sit against walls, hydrants sit
 * on the kerb, bags pile beside bins. Uniform scatter is what made the p5
 * version's street furniture read as decoration.
 */
export function buildProps(rng, disposables) {
  const group = new THREE.Group();
  const L = LAYOUT;
  const wet = gradeWet();

  const place = (id, { x, z, ry = 0, scale = 1, y = L.kerbHeight, grade = wet, variant = null }) => {
    const obj = instance(id, { grade, variant });
    obj.position.set(x, y, z);
    obj.rotation.y = ry;
    obj.scale.setScalar(scale);
    group.add(obj);
    return obj;
  };

  // Manholes sit in the carriageway, flush, and become the darkest wet metal
  // in the road — they break the puddle field up without adding silhouette.
  for (const z of [-3.4, -19.5, -41]) {
    place('water_manhole_cover', {
      x: rng.range(-3, 3), z, y: 0.004, ry: rng.range(0, Math.PI),
      grade: gradeWet({ darken: 0.3, roughness: 0.16, metalness: 0.85 })
    });
  }

  // Right kerb: the side the camera is on, so these read at full size.
  place('fire_hydrant', {
    x: L.roadHalf + 0.5, z: -2.4, ry: -1.3, scale: 1.05, variant: 'fire_hydrant_aged',
    // A hydrant is the one saturated object on a grey street. Held back from
    // full pillar-box red it stays an accent rather than a mascot.
    grade: gradeWet({ darken: 0.4, tint: 0x6b1c14, tintAmount: 0.34, roughness: 0.3 })
  });
  place('metal_trash_can', { x: L.facade - 0.7, z: -6.8, ry: 0.7, variant: 'metal_trash_can_rust' });
  place('trashbag', { x: L.facade - 1.25, z: -7.5, ry: 2.1 });
  place('trashbag', { x: L.facade - 0.95, z: -8.2, ry: 0.4, scale: 0.88 });

  // Left kerb: further away, so they only need to hold a silhouette.
  place('concrete_road_barrier', { x: -L.roadHalf - 1.3, z: -22, ry: 0.06 });
  place('concrete_road_barrier', { x: -L.roadHalf - 1.3, z: -23.6, ry: -0.04 });
  place('metal_trash_can', { x: -L.facade + 0.8, z: -16, ry: -0.5, variant: 'metal_trash_can_rust' });

  // A parked car under a tarp: a large soft mass at the left kerb that reads
  // as bulk in the fog without pretending to be a driveable vehicle.
  place('covered_car', {
    // Parked in the near-side lane with its wheels on the road: the scan's
    // origin sits 0.3m below its lowest point, so it has to be lifted by
    // exactly that to stand on the tarmac rather than hover over it.
    x: -L.roadHalf + 1.15, z: -19.5, ry: Math.PI / 2 + 0.02, y: 0.30,
    grade: gradeWet({ darken: 0.42, tintAmount: 0.42, roughness: 0.42 })
  });

  return group;
}

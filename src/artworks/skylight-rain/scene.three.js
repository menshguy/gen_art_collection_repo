/**
 * Skylight in Rain
 *
 * Inside a house on a Vermont hillside, looking out through a forward-slanted
 * skylight while it rains. Four systems:
 *
 *   1. the hillside as receding slices. Each band is real terrain — a ribbon
 *      whose ridge line is an fbm profile and whose near face slopes toward the
 *      camera — so the bands occlude each other and exponential fog does the
 *      desaturation. The near canopy keeps its chroma; by the last ridge the
 *      forest is a value, not a colour;
 *   2. one instanced canopy. Every leaf cluster in the frame is one draw call
 *      of camera-facing quads, coloured from an autumn field that clusters by
 *      position so stands read as stands, and bent by one gust field so the
 *      whole hillside moves together;
 *   3. the glass. The world renders to a target; the pane then reads it back
 *      through a procedural water field — condensation blurs and greys it,
 *      while running water refracts, *warms* and saturates what is behind it.
 *      Wet glass is a lens, and this is the piece's subject;
 *   4. the room. Dark wood mullions and a plant in the near corner, lit by one
 *      warm interior source, against the cold overcast outside.
 */

import * as THREE from 'three';
import { clamp, lerp, smoothstep } from '../../shared/math.js';
import { disposeObject } from '../../runtime/three-host.js';

export default function scene({ renderer, width, height, seed, rng, noise, capture, pane }) {
  /* ------------------------------ palette ------------------------------ */

  const SKY_HIGH = new THREE.Color('#a4a8a9');
  const SKY_LOW = new THREE.Color('#c0c4c6');
  const FOG = new THREE.Color('#b0b6ba');

  // Vermont, third week of October, under rain: everything is a step darker
  // and a step warmer than the postcard version.
  const FAMILIES = [
    { c: '#d8a41c', w: 3.0 }, // chrome yellow — beech and birch, the dominant
    { c: '#c8731c', w: 2.6 }, // orange sugar maple
    { c: '#a63418', w: 1.5 }, // scarlet red maple, the accent
    { c: '#7a2f1c', w: 1.1 }, // deep crimson, already turning over
    { c: '#6f7a30', w: 1.3 }, // olive, still green
    { c: '#243a2a', w: 2.2 }, // spruce and fir — index 5, checked as conifer
    { c: '#8a5f2c', w: 0.9 } //  rust brown, oak and distance
  ];
  const FAM_CDF = [];
  {
    let a = 0;
    for (const f of FAMILIES) FAM_CDF.push((a += f.w));
    for (let i = 0; i < FAM_CDF.length; i++) FAM_CDF[i] /= a;
  }
  const FAM_COL = FAMILIES.map((f) => new THREE.Color(f.c));

  /** Autumn family at a world position — clustered, so stands read as stands. */
  const famAt = (x, z) => {
    // Frequency scales with distance, so a stand covers about the same angle
    // whether it is 40 metres away or 1000 — otherwise the near band comes out
    // one flat colour and the far ridge comes out static.
    const s = 1.1 / Math.max(30, Math.abs(z));
    const n = clamp(noise.fbm2D(x * s, z * s * 0.35, { octaves: 2 }) * 0.75 + 0.5);
    for (let i = 0; i < FAM_CDF.length; i++) if (n <= FAM_CDF[i]) return i;
    return FAM_COL.length - 1;
  };

  /* ------------------------------- world ------------------------------- */

  const world = new THREE.Scene();
  world.background = FOG.clone();
  // Tuned so the near canopy is barely touched and the last ridge is ~95% gone.
  const FOG_DENSITY = 0.00062;
  world.fog = new THREE.FogExp2(FOG.getHex(), FOG_DENSITY);

  // The eye is the origin and the camera is level, so every band's terrain
  // height *is* its screen position: y = -z * tan(angle). The band table below
  // was derived from where each ridge should land in the frame, not guessed at.
  const camera = new THREE.PerspectiveCamera(38, width / height, 0.5, 3200);
  camera.position.set(0, 0, 0);
  camera.rotation.order = 'YXZ';
  camera.rotation.x = 0;

  const lightDir = new THREE.Vector3(-0.35, 0.86, 0.37).normalize();

  /* ------------------------------ backdrop ----------------------------- */

  const skyGeo = new THREE.PlaneGeometry(6000, 4000);
  const skyMat = new THREE.ShaderMaterial({
    depthWrite: false,
    depthTest: false,
    uniforms: {
      uHigh: { value: SKY_HIGH.clone() },
      uLow: { value: SKY_LOW.clone() }
    },
    vertexShader: `
      varying float vY;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vY = wp.y;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: `
      uniform vec3 uHigh;
      uniform vec3 uLow;
      varying float vY;
      void main() {
        // Brightest just above the far ridge, cooling with height: the value
        // structure the whole image hangs on.
        gl_FragColor = vec4(mix(uLow, uHigh, smoothstep(-20.0, 900.0, vY)), 1.0);
        #include <colorspace_fragment>
      }
    `
  });
  const sky = new THREE.Mesh(skyGeo, skyMat);
  sky.position.set(0, 400, -2900);
  sky.renderOrder = -10;
  world.add(sky);

  /* ------------------------------- terrain ----------------------------- */

  // Distance, how far the ridge rises, how rough it is. Near bands are small
  // and close; far bands are large and high, so the hillside opposite sits
  // above the near canopy the way it does from a house on a slope.
  // The valley floor falls away to band 3, then the slope opposite climbs
  // back above the eye. `base` is the terrain height at the near edge; `amp`
  // is the relief it gains by its ridge.
  const BANDS = [
    // Each base is solved from where that band's canopy should sit in the
    // frame, measured at the band's *ridge* (its far edge) rather than its
    // centre — measuring at the centre is what made every band bunch together.
    // Canopy tops land at 0.83, 0.76, 0.70, 0.64, 0.58 and 0.52 of the frame,
    // so the hillside takes a little under half the picture and the fogged
    // pane takes the rest.
    { z: -55, depth: 45, width: 320, base: -42, amp: 6, freq: 0.04, seg: 90 },
    { z: -115, depth: 80, width: 520, base: -64, amp: 14, freq: 0.024, seg: 110 },
    { z: -230, depth: 150, width: 860, base: -89, amp: 30, freq: 0.014, seg: 130 },
    { z: -450, depth: 260, width: 1400, base: -127, amp: 60, freq: 0.008, seg: 140 },
    { z: -800, depth: 400, width: 2100, base: -164, amp: 105, freq: 0.0048, seg: 140 },
    { z: -1400, depth: 600, width: 3400, base: -190, amp: 170, freq: 0.0028, seg: 130 }
  ];

  const terrainGeos = [];
  const terrainMats = [];

  /** Ridge profile for a band: fbm along x, with a long swell under it. */
  // Normalised to roughly 0..1 with mean 0.5, so a band's base can be solved
  // for directly: base = wantedCrest - 0.75 * amp.
  function ridge(band, x, i) {
    const swell = noise.fbm2D(x * band.freq * 0.32 + i * 40.1, i * 13.7, { octaves: 2 }) * 0.5 + 0.5;
    const detail = noise.fbm2D(x * band.freq + i * 91.3, i * 7.1, { octaves: 4, gain: 0.52 });
    return clamp(0.15 + 0.7 * swell + 0.42 * detail);
  }

  const bandSurface = [];

  for (let i = 0; i < BANDS.length; i++) {
    const b = BANDS[i];
    const nx = b.seg;
    const nz = 10;
    const geo = new THREE.PlaneGeometry(b.width, b.depth, nx, nz);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const col = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    const dark = new THREE.Color('#2b2f26');

    for (let k = 0; k < pos.count; k++) {
      const x = pos.getX(k);
      const zLocal = pos.getZ(k); // -depth/2 .. depth/2
      // u = 0 at the near edge, 1 at the ridge behind it.
      const u = clamp((-zLocal + b.depth / 2) / b.depth);
      const h = ridge(b, x, i);
      const y = b.base + h * b.amp * Math.pow(u, 0.72);
      pos.setY(k, y);
      pos.setZ(k, zLocal + b.z);

      // Slope shading, plus a hint of the forest colour underneath the trees
      // so gaps in the canopy do not show bare ground.
      const fam = FAM_COL[famAt(x, zLocal + b.z)];
      c.copy(dark).lerp(fam, 0.66).multiplyScalar(0.62 + 0.5 * Math.pow(u, 0.6));
      col[k * 3] = c.r;
      col[k * 3 + 1] = c.g;
      col[k * 3 + 2] = c.b;
    }
    geo.computeVertexNormals();
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));

    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, fog: true });
    const mesh = new THREE.Mesh(geo, mat);
    world.add(mesh);
    terrainGeos.push(geo);
    terrainMats.push(mat);

    bandSurface.push((x) => {
      // Height of the ridge crest for scattering trees along the band.
      return { h: ridge(b, x, i), b };
    });
  }

  /* ------------------------------- haze -------------------------------- */

  // Mist lying in the hollows. One sheet in front of each far ridge: this is
  // what separates the slices from one another. Fog alone gives a smooth
  // gradient, and a smooth gradient reads as one hill, not six.
  const hazeGeo = new THREE.PlaneGeometry(1, 1);
  const hazeMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uColor: { value: new THREE.Color('#c9c4b7') }, uOpacity: { value: 1 } },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uOpacity;
      varying vec2 vUv;
      void main() {
        // Dense along the valley floor, dissolving upward.
        float a = smoothstep(1.0, 0.05, vUv.y) * smoothstep(0.0, 0.12, vUv.y);
        a *= smoothstep(0.0, 0.09, vUv.x) * smoothstep(1.0, 0.91, vUv.x);
        gl_FragColor = vec4(uColor, a * uOpacity);
      }
    `
  });
  const hazeMeshes = [];
  function addHaze(z, yBase, hgt, w, opacity) {
    const m = new THREE.Mesh(hazeGeo, hazeMat.clone());
    m.material.uniforms.uColor.value = new THREE.Color('#c9c4b7');
    m.material.uniforms.uOpacity.value = opacity;
    m.scale.set(w, hgt, 1);
    m.position.set(0, yBase + hgt * 0.5, z);
    m.renderOrder = 2;
    world.add(m);
    hazeMeshes.push(m);
  }
  addHaze(-155, -92, 62, 900, 0.5);
  addHaze(-320, -150, 100, 1600, 0.62);
  addHaze(-600, -192, 140, 2500, 0.7);
  addHaze(-1100, -222, 190, 3800, 0.78);

  const hemi = new THREE.HemisphereLight(0xdcd9cf, 0x413a2c, 1.15);
  world.add(hemi);
  const key = new THREE.DirectionalLight(0xe4e0d5, 0.55);
  key.position.copy(lightDir).multiplyScalar(100);
  world.add(key);

  /* ------------------------------- canopy ------------------------------ */

  /**
   * An atlas of four leaf clumps. A single radially-symmetric sprite is what
   * makes generated forests read as bubbles: real foliage hangs in irregular
   * lobes with sky-holes through it and a ragged, leafy silhouette. Three
   * deciduous clumps, each built from elongated leaf marks at random angles
   * around two or three lobe centres, plus one needled tuft for spruce.
   */
  function leafAtlas() {
    const C = 128;
    const S = C * 2;
    const cv = document.createElement('canvas');
    cv.width = cv.height = S;
    const g = cv.getContext('2d');
    g.clearRect(0, 0, S, S);

    for (let cell = 0; cell < 4; cell++) {
      const ox = (cell % 2) * C;
      const oy = ((cell / 2) | 0) * C;
      const conifer = cell === 3;
      const pad = 10;

      const lobes = [];
      const nl = conifer ? 3 : rng.int(2, 4);
      for (let i = 0; i < nl; i++) {
        lobes.push({
          x: ox + C * (conifer ? 0.5 + rng.jitter(0.05) : 0.5 + rng.jitter(0.2)),
          y: oy + C * (conifer ? 0.26 + i * 0.24 : 0.5 + rng.jitter(0.18)),
          r: C * (conifer ? 0.19 - i * 0.025 : rng.range(0.17, 0.3))
        });
      }
      // Sky-holes. A clump you cannot see through is a solid, not foliage.
      const holes = [];
      for (let i = 0; i < 2; i++) {
        holes.push({
          x: ox + C * rng.range(0.22, 0.78),
          y: oy + C * rng.range(0.22, 0.78),
          r: C * rng.range(0.05, 0.13)
        });
      }

      const n = conifer ? 340 : 300;
      for (let k = 0; k < n; k++) {
        const L = lobes[rng.int(0, lobes.length - 1)];
        const a = rng() * Math.PI * 2;
        // Spilling a little past the lobe is what gives the silhouette its
        // leafy raggedness instead of a clean circular edge.
        const rr = Math.pow(rng(), 0.5) * L.r * 1.2;
        const x = L.x + Math.cos(a) * rr;
        const y = L.y + Math.sin(a) * rr * (conifer ? 1.2 : 0.88);
        if (x < ox + pad || x > ox + C - pad || y < oy + pad || y > oy + C - pad) continue;
        let inHole = false;
        for (const ho of holes) if (Math.hypot(x - ho.x, y - ho.y) < ho.r) inHole = true;
        if (inHole) continue;

        // Light from above: the sprite carries shading the geometry cannot.
        const v = clamp(0.46 + (oy + C * 0.52 - y) / (C * 0.85) + (rng() - 0.5) * 0.42);
        const q = Math.round(104 + v * 151);
        g.save();
        g.translate(x, y);
        g.rotate(conifer ? Math.PI * 0.5 + rng.jitter(0.55) : rng() * Math.PI);
        g.fillStyle = `rgba(${q}, ${q}, ${q}, ${0.55 + rng() * 0.45})`;
        g.beginPath();
        if (conifer) g.ellipse(0, 0, rng.range(1.1, 2.2), rng.range(5, 11), 0, 0, Math.PI * 2);
        else g.ellipse(0, 0, rng.range(2.6, 6.4), rng.range(1.5, 3.4), 0, 0, Math.PI * 2);
        g.fill();
        g.restore();
      }
    }

    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  const leafTex = leafAtlas();
  // Canvas rows are flipped into uv, so the conifer tuft drawn at canvas
  // cell (1,1) is addressed at uv offset (0.5, 0).
  const CELL_UV = [
    [0, 0.5],
    [0.5, 0.5],
    [0, 0],
    [0.5, 0]
  ];

  const clusters = [];
  const tmpCol = new THREE.Color();

  // Half-width of the frustum at unit depth. Bands are far wider than this so
  // their terrain reaches the frame edges, but scattering trees across the
  // whole width spends the budget where the camera cannot see it and leaves
  // the hillsides bare.
  const TAN_H = Math.tan(THREE.MathUtils.degToRad(19)) * (width / height);

  const limbs = [];

  /** Trunk and main limbs, so a crown has something visibly holding it up. */
  function addWood(x, z, ground, h, crownBase, conifer) {
    const lean = rng.jitter(0.06);
    limbs.push({
      x, y: ground, z,
      dx: lean, dy: 1, dz: rng.jitter(0.05),
      len: crownBase - ground + h * 0.1,
      rad: h * (conifer ? 0.016 : 0.022)
    });
    if (conifer) return;
    const nl = rng.int(3, 5);
    for (let i = 0; i < nl; i++) {
      const up = i / Math.max(1, nl - 1);
      const a = rng() * Math.PI * 2;
      const spread = rng.range(0.35, 0.8);
      limbs.push({
        x: x + lean * (crownBase - ground) * up,
        y: lerp(ground + (crownBase - ground) * 0.55, crownBase + h * 0.08, up),
        z,
        dx: Math.cos(a) * spread,
        dy: 1,
        dz: Math.sin(a) * spread,
        len: h * rng.range(0.16, 0.3),
        rad: h * rng.range(0.006, 0.011)
      });
    }
  }

  function addTree(x, z, ground, h, fam, clustersPer, clusterFrac, wood, dim, sway) {
    const conifer = fam === 5;
    const crownR = h * (conifer ? 0.19 : 0.4);
    const crownBase = ground + h * (conifer ? 0.14 : 0.44);
    const crownTop = ground + h;
    const tPhase = rng() * Math.PI * 2;

    // A crown is two or three overlapping lobes, not one ellipsoid. This is
    // most of what stops a tree reading as a ball on a stick.
    const lobes = [];
    if (!conifer) {
      const nl = rng.int(2, 4);
      for (let i = 0; i < nl; i++) {
        lobes.push({
          x: x + rng.jitter(crownR * 0.5),
          z: z + rng.jitter(crownR * 0.5),
          y: lerp(crownBase, crownTop, 0.3 + rng() * 0.55),
          r: crownR * rng.range(0.5, 0.95)
        });
      }
    }

    for (let k = 0; k < clustersPer; k++) {
      let px, py, pz, ry;
      if (conifer) {
        const v = Math.pow(rng(), 0.75);
        const rad = crownR * (1 - v * 0.88) * (0.55 + rng() * 0.75);
        const a = rng() * Math.PI * 2;
        const rr = Math.sqrt(rng()) * rad;
        px = x + Math.cos(a) * rr;
        pz = z + Math.sin(a) * rr;
        py = lerp(crownTop, crownBase, v) + rng.jitter(crownR * 0.18);
        ry = 1 - v;
      } else {
        const L = lobes[rng.int(0, lobes.length - 1)];
        const a = rng() * Math.PI * 2;
        const el = rng() * Math.PI - Math.PI / 2;
        const rr = Math.pow(rng(), 0.55) * L.r;
        px = L.x + Math.cos(a) * Math.cos(el) * rr;
        pz = L.z + Math.sin(a) * Math.cos(el) * rr * 0.85;
        py = L.y + Math.sin(el) * rr * 0.8;
        ry = clamp((py - crownBase) / Math.max(1, crownTop - crownBase));
      }

      const shade = clamp(0.4 + (ry - 0.15) * 0.85 + (rng() - 0.5) * 0.3);
      tmpCol.copy(FAM_COL[fam]).multiplyScalar((0.5 + shade * 0.82) * (dim || 1));
      clusters.push({
        x: px,
        y: py,
        z: pz,
        size: crownR * clusterFrac * (0.45 + Math.pow(rng(), 1.6) * 1.6),
        aspect: conifer ? rng.range(0.55, 0.9) : rng.range(0.95, 1.8),
        rot: conifer ? rng.jitter(0.25) : rng() * Math.PI * 2,
        cell: conifer ? 3 : rng.int(0, 2),
        r: tmpCol.r,
        g: tmpCol.g,
        b: tmpCol.b,
        phase: rng() * Math.PI * 2,
        baseY: ground,
        treeH: h,
        tPhase,
        sway: sway || 1
      });
    }

    if (wood) addWood(x, z, ground, h, crownBase, conifer);
  }

  function plantBand(i, { count, hMin, hMax, clustersPer, clusterFrac, wood, dim, sway }) {
    const b = BANDS[i];
    const halfVis = TAN_H * Math.abs(b.z) * 1.3;
    for (let t = 0; t < count; t++) {
      const x = (rng() - 0.5) * 2 * Math.min(halfVis, b.width * 0.49);
      const u = Math.pow(rng(), 0.65);
      const zLocal = -b.depth / 2 + u * b.depth;
      const z = zLocal + b.z;
      // The terrain's own parameter runs 1 at the far edge (the ridge) to 0 at
      // the near edge. Scattering against `u` directly buries half the forest
      // inside the hill and floats the other half above it.
      const ground = b.base + ridge(b, x, i) * b.amp * Math.pow(1 - u, 0.72);
      const fam = famAt(x, z);
      const conifer = fam === 5;
      const h = lerp(hMin, hMax, Math.pow(rng(), conifer ? 0.7 : 1.5));
      addTree(x, z, ground, h, fam, clustersPer, clusterFrac, wood, dim || 1, sway || 1);
    }
  }

  /**
   * Trees at the window's edge. Close enough to be out of the fog entirely,
   * cropped by the frame, and the darkest and most saturated things in the
   * picture — the view needs something to be seen *through*, not just a hole
   * with a landscape in it.
   */
  function plantEdge() {
    // Solved rather than guessed: at distance z the frame is z*tan(19 deg)
    // high and 0.194*z wide, so a crown of radius r centred at x crosses the
    // edge only when |x| - r sits just inside 0.194*z, and its centre has to
    // land within the vertical span or the tree misses the picture entirely.
    const spots = [
      { x: -9.5, z: -30, g: -12.5, h: 13.5 },
      { x: -13.5, z: -42, g: -17, h: 18 },
      { x: 10.0, z: -28, g: -14.5, h: 13 },
      { x: 14.0, z: -40, g: -20.5, h: 17.5 },
      { x: -4.5, z: -36, g: -22, h: 15 },
      { x: 4.0, z: -40, g: -24, h: 16 }
    ];
    for (const sp of spots) {
      const x = sp.x + rng.jitter(1.1);
      const z = sp.z + rng.jitter(2.0);
      const fam = rng.weighted([0, 1, 2, 3, 5], [2.4, 2.6, 2.0, 1.4, 1.6]);
      // A crown this close subtends hundreds of pixels; at 300 small clusters
      // it reads as confetti hanging in the mist rather than as a tree.
      // Dimmer than the hillside behind: under an overcast the nearest
      // foliage is the darkest thing outside, and that contrast is what makes
      // these read as a frame rather than as more of the same forest.
      addTree(x, z, sp.g + rng.jitter(1.0), sp.h * rng.range(0.9, 1.1), fam, 460, 0.13, true, 0.68, 1.2);
    }
  }

  // Cluster count rises and cluster size falls as bands come forward, so the
  // canopy has the same apparent grain at every distance instead of turning
  // into a handful of huge blobs up close.
  plantBand(0, { count: 44, hMin: 9, hMax: 20, clustersPer: 130, clusterFrac: 0.2, wood: true, sway: 1.4 });
  plantBand(1, { count: 190, hMin: 10, hMax: 26, clustersPer: 54, clusterFrac: 0.24, wood: true, sway: 1.9 });
  plantBand(2, { count: 900, hMin: 12, hMax: 30, clustersPer: 26, clusterFrac: 0.36, wood: false, sway: 2.5 });
  // Distant foliage is darkened before the fog lightens it. A gold-dominant
  // palette sits too close to the fog's own value, and without this the
  // receding ridges dissolve into it entirely instead of stacking.
  plantBand(3, { count: 1800, hMin: 14, hMax: 32, clustersPer: 15, clusterFrac: 0.56, dim: 0.84, sway: 2.2 });
  plantBand(4, { count: 2600, hMin: 16, hMax: 34, clustersPer: 11, clusterFrac: 0.76, dim: 0.7, sway: 0.9 });
  plantBand(5, { count: 3000, hMin: 20, hMax: 42, clustersPer: 8, clusterFrac: 1.0, dim: 0.52, sway: 0.35 });
  plantEdge();

  const N = clusters.length;
  const aOffset = new Float32Array(N * 3);
  const aColor = new Float32Array(N * 3);
  const aSize = new Float32Array(N);
  const aAspect = new Float32Array(N);
  const aRot = new Float32Array(N);
  const aCell = new Float32Array(N * 2);
  const aTree = new Float32Array(N * 4);
  const aPhase = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const c = clusters[i];
    aOffset[i * 3] = c.x;
    aOffset[i * 3 + 1] = c.y;
    aOffset[i * 3 + 2] = c.z;
    aColor[i * 3] = c.r;
    aColor[i * 3 + 1] = c.g;
    aColor[i * 3 + 2] = c.b;
    aSize[i] = c.size;
    aAspect[i] = c.aspect;
    aRot[i] = c.rot;
    aCell[i * 2] = CELL_UV[c.cell][0];
    aCell[i * 2 + 1] = CELL_UV[c.cell][1];
    aTree[i * 4] = c.baseY;
    aTree[i * 4 + 1] = c.treeH;
    aTree[i * 4 + 2] = c.tPhase;
    aTree[i * 4 + 3] = c.sway;
    aPhase[i] = c.phase;
  }
  clusters.length = 0;

  const quad = new THREE.PlaneGeometry(1, 1);
  const canopyGeo = new THREE.InstancedBufferGeometry();
  canopyGeo.index = quad.index;
  canopyGeo.attributes.position = quad.attributes.position;
  canopyGeo.attributes.uv = quad.attributes.uv;
  canopyGeo.instanceCount = N;
  canopyGeo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(aOffset, 3));
  canopyGeo.setAttribute('aColor', new THREE.InstancedBufferAttribute(aColor, 3));
  canopyGeo.setAttribute('aSize', new THREE.InstancedBufferAttribute(aSize, 1));
  canopyGeo.setAttribute('aAspect', new THREE.InstancedBufferAttribute(aAspect, 1));
  canopyGeo.setAttribute('aRot', new THREE.InstancedBufferAttribute(aRot, 1));
  canopyGeo.setAttribute('aCell', new THREE.InstancedBufferAttribute(aCell, 2));
  canopyGeo.setAttribute('aTree', new THREE.InstancedBufferAttribute(aTree, 4));
  canopyGeo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(aPhase, 1));
  canopyGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, -600), 3000);

  const canopyMat = new THREE.ShaderMaterial({
    transparent: false,
    alphaTest: 0.36,
    side: THREE.DoubleSide,
    uniforms: {
      uMap: { value: leafTex },
      uTime: { value: 0 },
      uGust: { value: 1 },
      uFogColor: { value: FOG.clone() },
      uFogDensity: { value: FOG_DENSITY }
    },
    vertexShader: `
      attribute vec3 aOffset;
      attribute vec3 aColor;
      attribute float aSize;
      attribute float aAspect;
      attribute float aRot;
      attribute vec2 aCell;
      attribute vec4 aTree;
      attribute float aPhase;
      uniform float uTime;
      uniform float uGust;
      varying vec2 vUv;
      varying vec3 vColor;
      varying float vDepth;
      void main() {
        vUv = uv * 0.5 + aCell;
        vColor = aColor;

        // The crown bends as one body about the tree's own base, with a
        // displacement capped at a fraction of the tree's height. Letting each
        // cluster translate on its own lets foliage drift metres clear of the
        // trunk that is supposed to be holding it.
        float u = clamp((aOffset.y - aTree.x) / max(aTree.y, 0.001), 0.0, 1.0);
        float s = sin(uTime * 0.75 + aTree.z) * 0.66 + sin(uTime * 1.55 + aTree.z * 1.7) * 0.24;
        float lean = (0.3 + 0.7 * s) * uGust;
        float amp = aTree.y * 0.075 * aTree.w * pow(u, 1.7);
        vec3 wp = aOffset;
        wp.x += lean * amp;
        wp.z += lean * amp * 0.32;
        wp.y -= abs(lean) * amp * 0.22;
        // Independent flutter, at leaf scale only — centimetres, not metres.
        float f = sin(uTime * 2.3 + aPhase) * 0.6 + sin(uTime * 3.6 + aPhase * 2.1) * 0.4;
        wp.x += f * aSize * 0.04 * uGust;
        wp.y += f * aSize * 0.03 * uGust;

        vec4 mv = modelViewMatrix * vec4(wp, 1.0);
        vec2 p = position.xy * vec2(aSize * aAspect, aSize);
        float c = cos(aRot), sn = sin(aRot);
        mv.xy += mat2(c, -sn, sn, c) * p;
        vDepth = -mv.z;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      uniform sampler2D uMap;
      uniform vec3 uFogColor;
      uniform float uFogDensity;
      varying vec2 vUv;
      varying vec3 vColor;
      varying float vDepth;
      void main() {
        vec4 tex = texture2D(uMap, vUv);
        if (tex.a < 0.36) discard;
        vec3 col = vColor * (0.45 + tex.r * 0.85);
        float f = 1.0 - exp(-uFogDensity * uFogDensity * vDepth * vDepth);
        gl_FragColor = vec4(mix(col, uFogColor, clamp(f, 0.0, 1.0)), 1.0);
        #include <colorspace_fragment>
      }
    `
  });

  const canopy = new THREE.Mesh(canopyGeo, canopyMat);
  canopy.frustumCulled = false;
  world.add(canopy);

  /* ------------------------------ woody parts --------------------------- */

  const limbGeo = new THREE.CylinderGeometry(0.18, 0.5, 1, 5, 1, true);
  limbGeo.translate(0, 0.5, 0);
  const limbMat = new THREE.MeshLambertMaterial({
    color: 0x2b241c,
    fog: true,
    side: THREE.DoubleSide
  });
  const woody = new THREE.InstancedMesh(limbGeo, limbMat, Math.max(1, limbs.length));
  {
    const dummy = new THREE.Object3D();
    const up = new THREE.Vector3(0, 1, 0);
    const dir = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    for (let i = 0; i < limbs.length; i++) {
      const L = limbs[i];
      dir.set(L.dx, L.dy, L.dz).normalize();
      quat.setFromUnitVectors(up, dir);
      dummy.position.set(L.x, L.y, L.z);
      dummy.quaternion.copy(quat);
      dummy.scale.set(L.rad, L.len, L.rad);
      dummy.updateMatrix();
      woody.setMatrixAt(i, dummy.matrix);
    }
    woody.count = limbs.length;
    limbs.length = 0;
  }
  world.add(woody);

  /* --------------------------------- rain ------------------------------ */

  // Rain in the volume between the pane and the near canopy. It is barely
  // visible against the overcast and unmistakable against the dark trees,
  // which is exactly how rain reads in the reference.
  const RAIN = 1400;
  const rainPos = new Float32Array(RAIN * 3);
  const rainSpeed = new Float32Array(RAIN);
  const rainLen = new Float32Array(RAIN);
  const rainWid = new Float32Array(RAIN);
  for (let i = 0; i < RAIN; i++) {
    const d = 6 + Math.pow(rng(), 0.6) * 90;
    rainPos[i * 3] = (rng() - 0.5) * d * 0.75;
    rainPos[i * 3 + 1] = rng() * 70 - 24;
    rainPos[i * 3 + 2] = -d;
    rainSpeed[i] = 26 + rng() * 22;
    rainLen[i] = (0.5 + rng() * 1.5) * (0.3 + d * 0.012);
    rainWid[i] = 0.012 + rng() * 0.02;
  }
  const rainQuad = new THREE.PlaneGeometry(1, 1);
  const rainGeo = new THREE.InstancedBufferGeometry();
  rainGeo.index = rainQuad.index;
  rainGeo.attributes.position = rainQuad.attributes.position;
  rainGeo.attributes.uv = rainQuad.attributes.uv;
  rainGeo.instanceCount = RAIN;
  rainGeo.setAttribute('aPos', new THREE.InstancedBufferAttribute(rainPos, 3));
  rainGeo.setAttribute('aSpeed', new THREE.InstancedBufferAttribute(rainSpeed, 1));
  rainGeo.setAttribute('aLen', new THREE.InstancedBufferAttribute(rainLen, 1));
  rainGeo.setAttribute('aWid', new THREE.InstancedBufferAttribute(rainWid, 1));
  rainGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, -50), 200);

  const rainMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
      uTilt: { value: 0.22 },
      uColor: { value: new THREE.Color('#dfe1de') },
      uFogColor: { value: FOG.clone() },
      uFogDensity: { value: FOG_DENSITY }
    },
    vertexShader: `
      attribute vec3 aPos;
      attribute float aSpeed;
      attribute float aLen;
      attribute float aWid;
      uniform float uTime;
      uniform float uTilt;
      varying vec2 vUv;
      varying float vDepth;
      void main() {
        vUv = uv;
        vec3 p = aPos;
        p.y = mod(p.y - uTime * aSpeed, 70.0) - 24.0;
        p.x += uTilt * 9.0 * uTime;
        p.x = mod(p.x + 60.0, 120.0) - 60.0;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        // The streak leans with the wind rather than falling plumb.
        vec2 q = vec2(position.x * aWid, position.y * aLen);
        float c = cos(uTilt), s = sin(uTilt);
        mv.xy += mat2(c, -s, s, c) * q;
        vDepth = -mv.z;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform vec3 uFogColor;
      uniform float uFogDensity;
      varying vec2 vUv;
      varying float vDepth;
      void main() {
        float a = smoothstep(0.5, 0.0, abs(vUv.x - 0.5)) * smoothstep(0.0, 0.35, vUv.y) * smoothstep(1.0, 0.7, vUv.y);
        float f = 1.0 - exp(-uFogDensity * uFogDensity * vDepth * vDepth);
        gl_FragColor = vec4(mix(uColor, uFogColor, clamp(f, 0.0, 1.0)), a * 0.42 * (1.0 - f * 0.7));
        #include <colorspace_fragment>
      }
    `
  });
  const rain = new THREE.Mesh(rainGeo, rainMat);
  rain.frustumCulled = false;
  rain.renderOrder = 5;
  world.add(rain);

  /* ------------------------------- the room ---------------------------- */

  // Everything here is within a metre and a half of the eye, so it is drawn
  // after the pane and lit by its own warm source. The outside is overcast and
  // cold; the room is the only warm thing in the frame.
  //
  // At z = -1.22 the opening is only 0.47 m wide and 0.84 m tall on screen, so
  // every dimension below is centimetres. The sill lifts very slightly to the
  // right: the window is not square to the eye, and that tilt is most of what
  // says "photographed" rather than "drawn".
  const room = new THREE.Scene();

  const PZ = -1.22;
  const HW = 0.232;
  const HH = 0.42;
  const tilt = 0.03;

  const cherry = new THREE.MeshStandardMaterial({ color: 0x46180f, roughness: 0.45, metalness: 0.03 });
  const cherryDark = new THREE.MeshStandardMaterial({ color: 0x2b0f08, roughness: 0.55, metalness: 0.03 });
  const lead = new THREE.MeshStandardMaterial({ color: 0x33352f, roughness: 0.5, metalness: 0.4 });
  const metalMat = new THREE.MeshStandardMaterial({ color: 0x8b9092, roughness: 0.62, metalness: 0.25 });

  function addPart(geo, mat, pos, rot) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(pos[0], pos[1], pos[2]);
    m.rotation.set(rot ? rot[0] : 0, rot ? rot[1] : 0, rot ? rot[2] : tilt);
    m.castShadow = true;
    m.receiveShadow = true;
    room.add(m);
    return m;
  }

  // Jambs, two mullions dividing the opening into three lights, a transom rail
  // across the upper third, and a head band at the very top — the arrangement
  // of the reference window, at the scale this framing allows.
  const MUL = 0.076;
  const TRANSOM = 0.2;

  addPart(new THREE.BoxGeometry(0.022, 2.2, 0.07), cherry, [-HW, -0.02, PZ]);
  addPart(new THREE.BoxGeometry(0.022, 2.2, 0.07), cherry, [HW, -0.02, PZ]);
  addPart(new THREE.BoxGeometry(0.0105, 2.2, 0.05), cherry, [-MUL, -0.02, PZ]);
  addPart(new THREE.BoxGeometry(0.0105, 2.2, 0.05), cherry, [MUL, -0.02, PZ]);
  addPart(new THREE.BoxGeometry(2 * HW, 0.014, 0.058), cherry, [0, TRANSOM, PZ]);
  addPart(new THREE.BoxGeometry(2 * HW + 0.06, 0.026, 0.08), cherryDark, [0, HH + 0.008, PZ]);

  // Diamond leading in the transom lights. Each bar's length is solved against
  // its light's rectangle so nothing overhangs into the neighbouring light.
  {
    const barGeo = new THREE.BoxGeometry(0.0021, 1, 0.0021);
    const lights = [
      [-HW + 0.015, -MUL - 0.008],
      [-MUL + 0.008, MUL - 0.008],
      [MUL + 0.008, HW - 0.015]
    ];
    const y0 = TRANSOM + 0.01;
    const y1 = HH;
    const bars = [];
    const SP = 0.026;
    for (const [xa, xb] of lights) {
      const a = (xb - xa) / 2;
      const b = (y1 - y0) / 2;
      const cx = (xa + xb) / 2;
      const cy = (y0 + y1) / 2;
      for (let dir = 0; dir < 2; dir++) {
        const sgn = dir === 0 ? 1 : -1;
        const span = a + b;
        for (let D = -span; D <= span; D += SP) {
          // Line x - sgn*y = D, clipped to the rectangle.
          const lo = Math.max(-b, sgn > 0 ? -a - D : D - a);
          const hi = Math.min(b, sgn > 0 ? a - D : D + a);
          if (hi - lo < 0.008) continue;
          const ym = (lo + hi) / 2;
          bars.push({
            x: cx + D + sgn * ym,
            y: cy + ym,
            len: (hi - lo) * Math.SQRT2,
            rot: sgn > 0 ? -Math.PI / 4 : Math.PI / 4
          });
        }
      }
    }
    const leading = new THREE.InstancedMesh(barGeo, lead, Math.max(1, bars.length));
    const d = new THREE.Object3D();
    for (let i = 0; i < bars.length; i++) {
      const B = bars[i];
      d.position.set(B.x, B.y, PZ - 0.006);
      d.rotation.set(0, 0, B.rot + tilt);
      d.scale.set(1, B.len, 1);
      d.updateMatrix();
      leading.setMatrixAt(i, d.matrix);
    }
    leading.count = bars.length;
    leading.castShadow = true;
    room.add(leading);
  }

  // Sill: a painted stool catching the cold light off the pane, a cherry apron
  // below it turned to face the room, and the wall carrying down out of frame.
  addPart(new THREE.BoxGeometry(1.2, 0.022, 0.1), metalMat, [0, -0.352, PZ - 0.02], [0.1, 0, tilt]);
  addPart(new THREE.BoxGeometry(1.2, 0.034, 0.06), cherry, [0, -0.378, PZ + 0.02]);
  addPart(new THREE.BoxGeometry(1.2, 0.014, 0.05), cherryDark, [0, -0.399, PZ + 0.024]);
  addPart(new THREE.BoxGeometry(1.2, 0.7, 0.05), cherryDark, [0, -0.76, PZ + 0.04]);

  /* ------------------------------ money tree ---------------------------- */

  // Leaflets are solid geometry, not alpha-tested cards. An alpha-tested plane
  // casts its shadow through a depth pass that samples the cut-out per texel,
  // which is what was making the plant's shadow ragged; a real polygon casts a
  // clean one.
  function leafletGeometry() {
    const N = 10;
    const pos = [];
    const idx = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const w = Math.sin(Math.pow(t, 0.68) * Math.PI) * 0.14;
      // A shallow fold along the midrib, so a leaflet catches light on one
      // half and shades on the other instead of reading as a flat chip.
      pos.push(-w, t, -w * 0.3, w, t, -w * 0.3);
    }
    for (let i = 0; i < N; i++) {
      const a = i * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  const leafGeo = leafletGeometry();
  const leafMat = new THREE.MeshStandardMaterial({
    color: 0x6fa53c,
    roughness: 0.42,
    metalness: 0.0,
    side: THREE.DoubleSide
  });
  // A leaf held against a bright window is lit from *behind*: most of what
  // reaches the eye is light that has passed through the blade, which is why
  // backlit foliage reads far brighter, yellower and more even than foliage
  // lit from the front. A standard material has no path for that, so the
  // transmitted term is added straight into the indirect diffuse.
  leafMat.onBeforeCompile = (sh) => {
    sh.uniforms.uThru = { value: new THREE.Color('#9ccb52') };
    sh.uniforms.uThruAmt = { value: 0.62 };
    sh.fragmentShader = 'uniform vec3 uThru;\nuniform float uThruAmt;\n' + sh.fragmentShader;
    sh.fragmentShader = sh.fragmentShader.replace(
      '#include <lights_fragment_end>',
      `#include <lights_fragment_end>
       float thru = 0.18 + 0.82 * pow(clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0), 1.1);
       reflectedLight.indirectDiffuse += uThru * (thru * uThruAmt);`
    );
  };

  const stemMat = new THREE.MeshStandardMaterial({ color: 0x4a3a26, roughness: 0.72 });
  const stemGeos = [];
  const clusters3 = [];

  // Slender bare stems rising from below the sill, each carrying a palmate
  // whorl of leaflets at its tip — a pachira, as in the reference.
  const stemPaths = [
    [[-0.15, -0.62, -0.86], [-0.145, -0.4, -0.87], [-0.125, -0.16, -0.88], [-0.108, 0.06, -0.88]],
    [[-0.168, -0.62, -0.83], [-0.176, -0.42, -0.84], [-0.166, -0.22, -0.85], [-0.144, -0.05, -0.86]],
    [[-0.14, -0.62, -0.9], [-0.128, -0.46, -0.9], [-0.096, -0.3, -0.9], [-0.055, -0.19, -0.9]],
    [[-0.156, -0.62, -0.88], [-0.15, -0.34, -0.89], [-0.12, -0.06, -0.9], [-0.07, 0.16, -0.9]],
    // One stem leaning right over onto the pane.
    [[-0.163, -0.62, -0.86], [-0.176, -0.36, -0.95], [-0.172, -0.13, -1.07], [-0.152, 0.05, -1.16]]
  ];
  for (const path of stemPaths) {
    const curve = new THREE.CatmullRomCurve3(path.map((p) => new THREE.Vector3(p[0], p[1], p[2])));
    const g = new THREE.TubeGeometry(curve, 22, 0.0016, 6, false);
    const m = new THREE.Mesh(g, stemMat);
    m.castShadow = true;
    m.receiveShadow = true;
    room.add(m);
    stemGeos.push(g);
    const tip = path[path.length - 1];
    clusters3.push({ p: new THREE.Vector3(tip[0], tip[1], tip[2]), s: 1, flat: tip[2] < -1.05 ? 1 : 0 });
  }
  // One whorl part way up, and one drooping into the middle of the frame.
  clusters3.push({ p: new THREE.Vector3(-0.128, -0.17, -0.885), s: 0.78 });
  clusters3.push({ p: new THREE.Vector3(-0.06, -0.2, -0.9), s: 0.86 });
  // Whorls resting on the glass: held at the pane and splayed almost flat
  // against it, so their blades face the camera and take the window full on.
  clusters3.push({ p: new THREE.Vector3(-0.166, -0.08, -1.17), s: 0.95, flat: 1 });
  clusters3.push({ p: new THREE.Vector3(-0.196, -0.26, -1.17), s: 0.8, flat: 1 });
  clusters3.push({ p: new THREE.Vector3(-0.118, 0.07, -1.17), s: 0.72, flat: 1 });

  {
    let total = 0;
    for (const c of clusters3) total += 7;
    const leafMesh = new THREE.InstancedMesh(leafGeo, leafMat, total);
    const d = new THREE.Object3D();
    const up = new THREE.Vector3(0, 1, 0);
    const dir = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    let i = 0;
    for (const c of clusters3) {
      const n = rng.int(5, 7);
      const spin = rng() * Math.PI * 2;
      for (let k = 0; k < n; k++) {
        const a = spin + (k / n) * Math.PI * 2 + rng.jitter(0.22);
        // Leaflets radiate outward and hang: near-horizontal at the base of the
        // whorl, drooping further the longer they are.
        if (c.flat) {
          // Splayed in the plane of the glass rather than radiating into the
          // room, so each blade presents its full face to the window.
          dir.set(Math.cos(a), Math.sin(a) * 0.8 - 0.12, 0.06 + rng.jitter(0.05)).normalize();
        } else {
          const droop = rng.range(0.35, 1.05);
          dir.set(Math.cos(a) * Math.cos(droop), -Math.sin(droop) * 0.85 + 0.25, Math.sin(a) * Math.cos(droop)).normalize();
        }
        quat.setFromUnitVectors(up, dir);
        d.position.copy(c.p);
        d.quaternion.copy(quat);
        const len = c.s * rng.range(0.052, 0.088);
        d.scale.set(len, len, len);
        d.updateMatrix();
        leafMesh.setMatrixAt(i, d.matrix);
        // Leaves nearer the glass take more light through them; the rest vary
        // so a whorl is never one flat colour.
        const lit = (c.flat ? 1.12 : 0.9) * rng.range(0.72, 1.15);
        tmpCol.setRGB(0.42 * lit, 0.66 * lit, 0.25 * lit);
        leafMesh.setColorAt(i, tmpCol);
        i++;
      }
    }
    leafMesh.count = i;
    if (leafMesh.instanceColor) leafMesh.instanceColor.needsUpdate = true;
    leafMesh.castShadow = true;
    leafMesh.receiveShadow = true;
    room.add(leafMesh);
  }

  /* -------------------------------- light ------------------------------- */

  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  // From the left, so the mullions and the plant throw their shadows *across*
  // the sill rather than away from the camera. Contrast comes from the shadow
  // having somewhere to fall, not from turning the lamp up.
  const lamp = new THREE.SpotLight(0xff9a34, 7.5, 6.5, 0.78, 0.45, 1.5);
  lamp.position.set(-0.55, 0.3, 0.62);
  lamp.target.position.set(0.2, -0.58, -1.15);
  lamp.castShadow = true;
  // A tight frustum rather than a big map: 2048 quadruples the depth pass and
  // the software renderer cannot afford it. Concentrating 1024 texels on the
  // metre that actually contains geometry gets the same edge quality.
  lamp.shadow.mapSize.set(1024, 1024);
  lamp.shadow.camera.near = 0.55;
  lamp.shadow.camera.far = 2.4;
  lamp.shadow.bias = -0.0012;
  lamp.shadow.normalBias = 0.006;
  lamp.shadow.radius = 3;
  room.add(lamp);
  room.add(lamp.target);

  // Low enough that the shadows actually go dark. A generous ambient is the
  // fastest way to flatten a lit interior back out again.
  room.add(new THREE.AmbientLight(0x2c2016, 0.45));

  // A small warm bounce off the floor, so the underside of the sill is not
  // solid black.
  const bounce = new THREE.PointLight(0xff9a52, 0.45, 1.4, 2);
  bounce.position.set(0.12, -0.95, -0.5);
  room.add(bounce);

  // The cold half of the contrast: daylight off the wet pane raking back into
  // the room, strong enough to own the up-facing surfaces. The sill top reads
  // cold from the window while its front faces read warm from the lamp, and
  // that split across one piece of wood is the whole contrast.
  const windowFill = new THREE.DirectionalLight(0x7fa6c2, 1.5);
  windowFill.position.set(-0.6, 0.7, -1);
  room.add(windowFill);

  /* -------------------------------- the pane --------------------------- */

  const dpr = renderer.getPixelRatio();
  const WORLD_SCALE = 0.72;
  const rtOpts = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: true };
  const rtScene = new THREE.WebGLRenderTarget(
    Math.round(width * dpr * WORLD_SCALE),
    Math.round(height * dpr * WORLD_SCALE),
    rtOpts
  );
  const bw = Math.max(2, Math.round((width * dpr) / 5));
  const bh = Math.max(2, Math.round((height * dpr) / 5));
  const rtA = new THREE.WebGLRenderTarget(bw, bh, { ...rtOpts, depthBuffer: false });
  const rtB = new THREE.WebGLRenderTarget(bw, bh, { ...rtOpts, depthBuffer: false });

  const fsGeo = new THREE.PlaneGeometry(2, 2);
  const fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const fsScene = new THREE.Scene();
  const fsMesh = new THREE.Mesh(fsGeo, null);
  fsMesh.frustumCulled = false;
  fsScene.add(fsMesh);

  const FS_VERT = `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
  `;

  const blurMat = new THREE.ShaderMaterial({
    uniforms: { tMap: { value: null }, uDir: { value: new THREE.Vector2() } },
    vertexShader: FS_VERT,
    fragmentShader: `
      uniform sampler2D tMap;
      uniform vec2 uDir;
      varying vec2 vUv;
      void main() {
        vec3 c = texture2D(tMap, vUv).rgb * 0.2270270;
        c += texture2D(tMap, vUv + uDir * 1.3846154).rgb * 0.3162162;
        c += texture2D(tMap, vUv - uDir * 1.3846154).rgb * 0.3162162;
        c += texture2D(tMap, vUv + uDir * 3.2307692).rgb * 0.0702703;
        c += texture2D(tMap, vUv - uDir * 3.2307692).rgb * 0.0702703;
        gl_FragColor = vec4(c, 1.0);
      }
    `
  });

  /* ------------------------- water simulation --------------------------- */

  // The water is simulated, not drawn. Two ping-ponged buffers hold, per texel,
  // how much water is sitting there (R) and how wet the glass under it is (G).
  // Each step:
  //
  //   * surface tension pins anything under a mass threshold, so most of the
  //     pane is beads that never move;
  //   * water above the threshold runs, and runs *faster the heavier it is*;
  //   * a texel gathers from the whole column it could have arrived from this
  //     frame, so a running drop sweeps up every bead it passes and gains
  //     their mass — which makes it faster still. That cascade is the whole
  //     behaviour: a pane sits still, then one drop tips over and tears a
  //     track down it;
  //   * water leaves wetness behind, wetness decays slowly, and the pinning
  //     threshold is lower where the glass is already wet, so later drops
  //     follow the tracks earlier ones made.
  //
  // Nothing about the shape of a rivulet is authored anywhere.
  const SIM_SCALE = 0.58;
  const simW = Math.max(64, Math.round(width * SIM_SCALE));
  const simH = Math.max(64, Math.round(height * SIM_SCALE));
  const simOpts = {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    wrapS: THREE.ClampToEdgeWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
    depthBuffer: false,
    type: THREE.UnsignedByteType
  };
  let rtWaterA = new THREE.WebGLRenderTarget(simW, simH, simOpts);
  let rtWaterB = new THREE.WebGLRenderTarget(simW, simH, simOpts);
  // The simulation buffer is necessarily noisy at texel scale — every frame
  // sprinkles new drops into it. A normal taken straight off it varies row to
  // row, and a horizontal refraction that varies row to row shears whatever is
  // behind the glass into dashes. So the optics read a blurred copy.
  const rtWN1 = new THREE.WebGLRenderTarget(simW, simH, simOpts);
  const rtWN2 = new THREE.WebGLRenderTarget(simW, simH, simOpts);

  const SIM_HASH = `
    vec3 hash33(vec3 p3) {
      p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973));
      p3 += dot(p3, p3.yxz + 33.33);
      return fract((p3.xxy + p3.yxx) * p3.zyx);
    }
    vec2 hash22b(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.xx + p3.yz) * p3.zy);
    }
    float vnoiseb(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      float a = hash22b(i).x, b = hash22b(i + vec2(1.0, 0.0)).x;
      float c = hash22b(i + vec2(0.0, 1.0)).x, d = hash22b(i + vec2(1.0, 1.0)).x;
      return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
    }
    // The pane leans away from the eye, so a physical drop covers fewer pixels
    // near the top of the frame and gravity's screen-space pull is weaker there.
    float paneScale(float y) { return mix(0.9, 1.5, smoothstep(0.05, 1.0, y)); }
  `;

  const simMat = new THREE.ShaderMaterial({
    uniforms: {
      tPrev: { value: null },
      uTexel: { value: new THREE.Vector2(1 / simW, 1 / simH) },
      uTime: { value: 0 },
      uAspect: { value: width / height },
      uSeed: { value: (seed % 997) * 0.017 },
      uSpawn: { value: 0.005 },
      uFlow: { value: 3.0 }
    },
    vertexShader: FS_VERT,
    fragmentShader: `
      uniform sampler2D tPrev;
      uniform vec2 uTexel;
      uniform float uTime;
      uniform float uAspect;
      uniform float uSeed;
      uniform float uSpawn;
      uniform float uFlow;
      varying vec2 vUv;
      ${SIM_HASH}

      // Texels travelled this frame. Zero until surface tension gives way; the
      // threshold falls on glass that is already wet, and roughness varies it
      // across the pane — glass is not uniformly smooth, and without that
      // every track gives way at the same moment and falls dead plumb.
      float speedOf(float m, float tr, float sc, float rough) {
        float thresh = mix(0.26, 0.09, tr) * (0.72 + 0.56 * rough);
        return clamp((m - thresh) * uFlow / sc, 0.0, 3.0);
      }

      void main() {
        vec2 uv = vUv;
        float sc = paneScale(uv.y);
        vec4 prev = texture2D(tPrev, uv);

        // Gather: sum every source above that would land here this frame. The
        // tent kernel conserves mass, and two sources landing on one texel is
        // exactly a merge.
        float mass = 0.0;
        float rough = vnoiseb(vec2(uv.x * 44.0 + uSeed * 3.0, uv.y * 12.0));
        for (int i = 0; i <= 4; i++) {
          float fi = float(i);
          vec2 q = uv + vec2(0.0, fi * uTexel.y);
          // The pane's own imperfections: a slow meander from the noise and a
          // sharp kink from the sine, whose phase comes from that same noise so
          // the kinks never fall into a period. It is a property of the glass,
          // not of the drop, so everything running down a given line wanders
          // the same way and tracks rejoin each other.
          //
          // One noise per tap, not three — the gather runs five times per texel
          // over a million texels, and it was the whole frame budget.
          float m1 = vnoiseb(vec2(q.x * 9.0 + uSeed, q.y * 7.0));
          float slope = (m1 - 0.5) * 1.5 + sin(q.y * 240.0 + m1 * 44.0) * 0.6;
          q.x -= slope * fi * uTexel.y;
          vec4 sc4 = texture2D(tPrev, q);
          float sv = speedOf(sc4.r, sc4.g, paneScale(q.y), rough);
          mass += sc4.r * max(0.0, 1.0 - abs(sv - fi));
        }

        // A little cohesion: drops pull themselves together instead of
        // dissolving into a haze of single texels.
        float lap = texture2D(tPrev, uv + vec2(uTexel.x, 0.0)).r
                  + texture2D(tPrev, uv - vec2(uTexel.x, 0.0)).r
                  + texture2D(tPrev, uv + vec2(0.0, uTexel.y)).r
                  + texture2D(tPrev, uv - vec2(0.0, uTexel.y)).r
                  - 4.0 * prev.r;
        mass += lap * 0.055;

        // New rain, in two sparse layers. The spawn grid must stay far finer
        // than the spawn *rate*, or every cell fills every few frames and the
        // grid itself becomes visible as a lattice across the pane.
        vec2 pu = vec2(uv.x * uAspect, uv.y);
        float bucket = floor(uTime * 24.0);
        float add = 0.0;
        // Rain does not arrive evenly across a pane. Gusts wet parts of it far
        // more than others, and that unevenness is what breaks up the regular
        // spacing of the tracks.
        float spawnP = uSpawn * (0.2 + 1.6 * vnoiseb(vec2(uv.x * 2.6 + uTime * 0.035, uv.y * 1.3 + uSeed)));
        // The spawn grid is shifted by a random offset every tick. Left fixed,
        // one drop per cell per tick accumulates into a visible lattice no
        // matter how much the position is jittered inside the cell.
        vec2 gridOff = hash22b(vec2(bucket, 7.3 + uSeed));

        // Mist-fine beads: too light to move, they are what a fat drop
        // eventually sweeps up.
        {
          float cs = 0.0085;
          vec2 base = floor(pu / cs + gridOff);
          for (int oy = -1; oy <= 1; oy++) {
            for (int ox = -1; ox <= 1; ox++) {
              vec2 cid = base + vec2(float(ox), float(oy));
              vec3 h = hash33(vec3(cid, bucket + uSeed * 31.0));
              if (h.z > spawnP) continue;
              // h.z is the spawn test and so is always tiny; size and mass
              // need their own draw or every drop is born too small to run.
              vec3 g = hash33(vec3(cid + 7.3, bucket * 1.7 + uSeed * 11.0));
              vec2 c = (cid - gridOff + h.xy) * cs;
              float r = (0.0016 + pow(g.x, 2.2) * 0.0032) / sc;
              add += smoothstep(r, 0.0, distance(pu, c)) * (0.06 + g.y * 0.26);
            }
          }
        }

        // The occasional fat one that arrives already heavy enough to go.
        {
          float cs = 0.04;
          vec2 base = floor(pu / cs + gridOff.yx * 1.7);
          for (int oy = -1; oy <= 1; oy++) {
            for (int ox = -1; ox <= 1; ox++) {
              vec2 cid = base + vec2(float(ox), float(oy));
              vec3 h = hash33(vec3(cid + 91.0, bucket * 0.37 + uSeed * 7.0));
              if (h.z > spawnP * 0.55) continue;
              vec3 g = hash33(vec3(cid + 3.1, bucket * 2.3 + uSeed * 5.0));
              vec2 c = (cid - gridOff.yx * 1.7 + h.xy) * cs;
              float r = (0.0026 + pow(g.x, 2.0) * 0.0055) / sc;
              add += smoothstep(r, 0.0, distance(pu, c)) * (0.35 + g.y * 0.75);
            }
          }
        }

        // Evaporation has to depend on size or the pane simply fills: fine
        // droplets dry off or are absorbed into the film within a second,
        // while anything big enough to run persists. That difference is what
        // leaves discrete beads and a handful of tracks instead of a sheet.
        float evap = mix(0.9915, 0.99955, smoothstep(0.05, 0.32, mass));
        mass = clamp(mass * evap + add, 0.0, 1.0);

        // Wetness is laid by water that *ran*, not by water that sat. A pinned
        // bead wets nothing; letting it do so turns the whole pane into a
        // blotch rather than a set of tracks.
        float myV = speedOf(prev.r, prev.g, sc, rough);
        float trail = max(prev.g * 0.9975, smoothstep(0.03, 0.2, prev.r) * smoothstep(0.3, 1.1, myV));

        gl_FragColor = vec4(mass, trail, 0.0, 1.0);
      }
    `
  });

  const glassMat = new THREE.ShaderMaterial({
    uniforms: {
      tScene: { value: rtScene.texture },
      tBlur: { value: rtB.texture },
      tWater: { value: rtWaterA.texture },
      tWaterN: { value: rtWN2.texture },
      uWaterTexel: { value: new THREE.Vector2(1 / simW, 1 / simH) },
      uTime: { value: 0 },
      uAspect: { value: width / height },
      uStorm: { value: 1 },
      uMist: { value: new THREE.Color('#dbdfe1') },
      uLamp: { value: new THREE.Color('#ff8a2c') }
    },
    vertexShader: FS_VERT,
    fragmentShader: `
      uniform sampler2D tScene;
      uniform sampler2D tBlur;
      uniform sampler2D tWater;
      uniform sampler2D tWaterN;
      uniform vec2 uWaterTexel;
      uniform float uTime;
      uniform float uAspect;
      uniform float uStorm;
      uniform vec3 uMist;
      uniform vec3 uLamp;
      varying vec2 vUv;
      ${SIM_HASH}

      float fbm(vec2 p) {
        float v = 0.0, a = 0.5;
        for (int i = 0; i < 3; i++) { v += a * vnoiseb(p); p *= 2.07; a *= 0.5; }
        return v;
      }

      void main() {
        vec2 e = uWaterTexel;
        // Optics read the smoothed field throughout: the raw buffer is grainy
        // by construction and every optical term inherits that grain.
        vec4 w0 = texture2D(tWaterN, vUv);
        float m = w0.r;
        float tr = w0.g;

        // The water surface, differenced into a normal. Everything optical
        // follows from this one gradient — no droplet is drawn anywhere. The
        // field is read through a small blur first: a drop's edge in the raw
        // buffer is a cliff, and a cliff refracts as a thin band that shears
        // the canopy behind it into dashes instead of bending it.
        float hL = texture2D(tWaterN, vUv - vec2(e.x * 2.4, 0.0)).r;
        float hR = texture2D(tWaterN, vUv + vec2(e.x * 2.4, 0.0)).r;
        float hD = texture2D(tWaterN, vUv - vec2(0.0, e.y * 2.4)).r;
        float hU = texture2D(tWaterN, vUv + vec2(0.0, e.y * 2.4)).r;
        vec2 grad = vec2(hR - hL, hU - hD);

        float wet = smoothstep(0.05, 0.3, m);
        float clear = clamp(max(wet, tr * 0.5), 0.0, 1.0);

        float prof = mix(0.02, 0.95, smoothstep(0.28, 0.99, vUv.y));
        float mot = 0.62 * fbm(vUv * vec2(uAspect, 1.0) * 3.6 + 2.3)
                  + 0.38 * vnoiseb(vUv * vec2(uAspect * 5.0, 1.8) * 11.0 + 7.1);
        float sheet = vnoiseb(vec2(vUv.x * uAspect * 30.0, vUv.y * 0.65 + 3.0));
        float broad = smoothstep(0.3, 0.74, fbm(vUv * vec2(uAspect * 0.9, 0.85) * 2.2 + 11.0));
        float film = clamp(prof * (0.3 + 1.5 * mot) * (0.52 + 0.7 * broad) * (0.5 + 1.0 * sheet), 0.0, 1.0);
        film *= 1.0 - clear * 0.94;

        // A drop is a lens: the steeper its surface, the further it throws
        // what is behind it.
        vec2 refr = clamp(grad, vec2(-0.5), vec2(0.5)) * 0.055;
        vec2 uvS = clamp(vUv + refr, vec2(0.002), vec2(0.998));
        vec3 sharp = texture2D(tScene, uvS).rgb;
        vec3 blurred = texture2D(tBlur, clamp(vUv + refr * 0.35, vec2(0.004), vec2(0.996))).rgb;

        // Water warms and saturates what is *behind* it, so this has to happen
        // before the film is laid over the top. Applied afterwards it tints the
        // condensation itself, and a warm shift on near-white fog reads as a
        // sheet of yellow rather than as wet glass.
        vec3 scene = mix(sharp, blurred, clamp(film * 1.15, 0.0, 1.0));
        // ...and only in proportion to how much view there is behind it. With
        // a thick film there is nothing back there but grey, and warming grey
        // just makes it yellow.
        float behind = wet * (1.0 - film * 0.9);
        float luma = dot(scene, vec3(0.2126, 0.7152, 0.0722));
        scene = mix(vec3(luma), scene, 1.0 + 0.7 * behind);
        scene *= mix(vec3(1.0), vec3(1.05, 1.0, 0.93), behind);
        scene *= 1.0 - 0.13 * wet;

        vec3 col = mix(scene, uMist, film * 0.56);

        // One overcast key on the water surface: the bright rim on a bead's
        // upper left, and the lit edge of every running channel.
        float spec = clamp(dot(normalize(vec3(-grad * 26.0, 1.0)), normalize(vec3(-0.45, 0.62, 0.65))), 0.0, 1.0);
        col += vec3(1.0, 0.97, 0.93) * pow(spec, 20.0) * wet * 0.3;

        // The lamp reaches the bottom of the pane and catches in the water
        // there — the only warm thing on the glass, against a cold view.
        float glow = smoothstep(0.34, -0.02, vUv.y);
        glow *= glow;
        col += uLamp * glow * (0.05 + 0.5 * clear);
        col += uLamp * glow * spec * 0.5;

        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }
    `
  });

  /* -------------------------------- handle ----------------------------- */

  const params = { gust: 1.0, storm: 1.0 };
  if (pane) {
    pane.addBinding(params, 'gust', { min: 0, max: 2.5, step: 0.05 });
    pane.addBinding(params, 'storm', { min: 0.2, max: 2, step: 0.05 });
  }

  const tmpV2 = new THREE.Vector2();
  let warmLeft = 440;
  let simTime = 0;

  function stepWater(renderer) {
    simTime += 1 / 60;
    simMat.uniforms.tPrev.value = rtWaterA.texture;
    simMat.uniforms.uTime.value = simTime;
    fsMesh.material = simMat;
    renderer.setRenderTarget(rtWaterB);
    renderer.render(fsScene, fsCam);
    const swap = rtWaterA;
    rtWaterA = rtWaterB;
    rtWaterB = swap;
    glassMat.uniforms.tWater.value = rtWaterA.texture;
  }

  // Two separable iterations. One is not enough: the surface has to be smooth
  // enough that its *vertical* slope varies slowly, or the refraction
  // compresses the hillside into horizontal bands down every track.
  function blurWater(renderer) {
    fsMesh.material = blurMat;
    // One pass, narrow. Two passes smoothed the beads out of existence — the
    // field only has to lose its per-texel grain, not its drops.
    blurMat.uniforms.tMap.value = rtWaterA.texture;
    blurMat.uniforms.uDir.value.set(0.7 / simW, 0);
    renderer.setRenderTarget(rtWN1);
    renderer.render(fsScene, fsCam);
    blurMat.uniforms.tMap.value = rtWN1.texture;
    blurMat.uniforms.uDir.value.set(0, 0.7 / simH);
    renderer.setRenderTarget(rtWN2);
    renderer.render(fsScene, fsCam);
  }

  return {
    scene: world,
    camera,
    update(t) {
      // Gusts: a slow envelope over the oscillation, so the hillside surges
      // rather than ticking.
      // Gusts build and fade over many seconds and the hillside is mostly
      // still between them; a fast envelope around a high mean reads as
      // jitter rather than as wind.
      const nz = clamp(noise.fbm2D(t * 0.055, 4.2, { octaves: 2 }) * 0.5 + 0.5);
      const g = 0.22 + 1.25 * Math.pow(nz, 1.5);
      canopyMat.uniforms.uTime.value = t;
      canopyMat.uniforms.uGust.value = g * params.gust;
      rainMat.uniforms.uTime.value = t;
      rainMat.uniforms.uTilt.value = 0.12 + g * 0.2;
      glassMat.uniforms.uTime.value = t;
      glassMat.uniforms.uStorm.value = params.storm;
      simMat.uniforms.uSpawn.value = 0.005 * params.storm;
    },
    render(renderer) {
      const prevClear = renderer.autoClear;

      // The pane has to have been raining a while before it is worth looking
      // at. Running the whole warm-up in one frame queues more GPU work than
      // the capture's buffer read can drain, so it is spread over the first
      // several frames instead — done well before the capture frame, and a
      // gentler start live.
      if (warmLeft > 0) {
        const chunk = Math.min(warmLeft, 55);
        for (let i = 0; i < chunk; i++) stepWater(renderer);
        warmLeft -= chunk;
      }
      stepWater(renderer);
      blurWater(renderer);

      renderer.setRenderTarget(rtScene);
      renderer.clear();
      renderer.render(world, camera);

      // Two cheap separable passes at quarter resolution: the condensation
      // needs a soft copy of the world to smear, not a second render of it.
      fsMesh.material = blurMat;
      blurMat.uniforms.tMap.value = rtScene.texture;
      blurMat.uniforms.uDir.value.set(1.6 / rtA.width, 0);
      renderer.setRenderTarget(rtA);
      renderer.render(fsScene, fsCam);
      blurMat.uniforms.tMap.value = rtA.texture;
      blurMat.uniforms.uDir.value.set(0, 1.6 / rtA.height);
      renderer.setRenderTarget(rtB);
      renderer.render(fsScene, fsCam);

      renderer.setRenderTarget(null);
      renderer.clear();
      fsMesh.material = glassMat;
      renderer.render(fsScene, fsCam);

      renderer.clearDepth();
      renderer.autoClear = false;
      renderer.render(room, camera);
      renderer.autoClear = prevClear;
    },
    resize(w, h) {
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      const r = renderer.getPixelRatio();
      rtScene.setSize(Math.round(w * r * WORLD_SCALE), Math.round(h * r * WORLD_SCALE));
      rtA.setSize(Math.max(2, Math.round((w * r) / 5)), Math.max(2, Math.round((h * r) / 5)));
      rtB.setSize(rtA.width, rtA.height);
      glassMat.uniforms.uAspect.value = w / h;
    },
    dispose() {
      disposeObject(world);
      disposeObject(room);
      leafGeo.dispose();
      for (const g of stemGeos) g.dispose();
      leafTex.dispose();
      quad.dispose();
      rainQuad.dispose();
      canopyGeo.dispose();
      rainGeo.dispose();
      fsGeo.dispose();
      blurMat.dispose();
      glassMat.dispose();
      rtScene.dispose();
      rtA.dispose();
      rtB.dispose();
      rtWaterA.dispose();
      rtWaterB.dispose();
      rtWN1.dispose();
      rtWN2.dispose();
      simMat.dispose();
      tmpV2.set(0, 0);
    }
  };
}

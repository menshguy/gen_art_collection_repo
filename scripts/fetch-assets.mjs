#!/usr/bin/env node
/**
 * Vendored external assets.
 *
 *   npm run assets            download anything missing
 *   npm run assets -- --force re-download everything
 *
 * Everything here comes from Poly Haven and is CC0 (public domain, no
 * attribution required). Poly Haven's model library is photogrammetry-derived
 * PBR geometry, which is what `cloudburst-crossing-3d` uses for its street
 * furniture instead of hand-modelled boxes.
 *
 * The files land in `public/assets/`, which Vite serves at `/assets/...` and
 * which is gitignored — they are large binaries with a reproducible source, so
 * the manifest is the thing worth committing, not 30MB of JPEGs. Serving them
 * from `public/` rather than from the artwork directory also means a version
 * snapshot copies source, not textures.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public', 'assets');
const API = 'https://api.polyhaven.com';

/** What the artwork needs, and at what resolution. */
export const MANIFEST = {
  models: {
    resolution: '1k',
    ids: [
      'street_lamp_01',        // wall-mounted luminaire, reused as the head of a mast
      'street_lamp_02',        // the lamp posts that carry the light pools
      'fire_hydrant',          // foreground kerbside accent
      'metal_trash_can',       // pavement clutter
      'water_manhole_cover',   // wet metal in the road
      'concrete_road_barrier', // mid-ground mass at the kerb
      'covered_car',           // parked bulk under a tarp
      'trashbag'               // small pavement clutter
    ]
  },
  textures: {
    resolution: '1k',
    maps: ['Diffuse', 'nor_gl', 'Rough'],
    ids: [
      'asphalt_03',        // road surface
      'brushed_concrete_03', // pavement
      'brick_wall_006'     // facades
    ]
  },
  hdris: {
    resolution: '1k',
    // Overcast night: soft, low-contrast ambient with no hard sun. It lights
    // the scan props and gives the wet surfaces something real to reflect.
    ids: ['night_bridge']
  }
};

const force = process.argv.includes('--force');

async function exists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}

async function download(url, dest) {
  if (!force && (await exists(dest))) return 0;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.writeFile(dest, buf);
  return buf.length;
}

async function files(id) {
  const res = await fetch(`${API}/files/${id}`);
  if (!res.ok) throw new Error(`files/${id}: ${res.status}`);
  return res.json();
}

let bytes = 0;
const note = (label, n) => {
  bytes += n;
  if (n) console.log(`  + ${label} (${(n / 1e6).toFixed(2)} MB)`);
};

/* -------------------------------- models -------------------------------- */

async function fetchModel(id, res) {
  const entry = (await files(id))?.gltf?.[res]?.gltf;
  if (!entry) throw new Error(`${id}: no gltf at ${res}`);
  const dir = path.join(OUT, 'models', id);
  // The .gltf references its .bin and textures by relative path, so the
  // include map has to be reproduced verbatim underneath it.
  note(`${id}/${id}.gltf`, await download(entry.url, path.join(dir, `${id}.gltf`)));
  for (const [rel, file] of Object.entries(entry.include ?? {})) {
    note(`${id}/${rel}`, await download(file.url, path.join(dir, rel)));
  }
}

/* ------------------------------- textures ------------------------------- */

async function fetchTexture(id, res, maps) {
  const all = await files(id);
  const dir = path.join(OUT, 'textures', id);
  for (const map of maps) {
    const file = all?.[map]?.[res]?.jpg;
    if (!file) { console.warn(`  ! ${id}: no ${map} jpg at ${res}`); continue; }
    note(`${id}/${map}.jpg`, await download(file.url, path.join(dir, `${map}.jpg`)));
  }
}

/* --------------------------------- hdris -------------------------------- */

async function fetchHdri(id, res) {
  const file = (await files(id))?.hdri?.[res]?.hdr;
  if (!file) throw new Error(`${id}: no hdr at ${res}`);
  note(`${id}.hdr`, await download(file.url, path.join(OUT, 'hdri', `${id}.hdr`)));
}

/* --------------------------------- main --------------------------------- */

console.log(`Poly Haven assets (CC0) -> ${path.relative(ROOT, OUT)}`);
for (const id of MANIFEST.models.ids) {
  console.log(`model  ${id}`);
  await fetchModel(id, MANIFEST.models.resolution);
}
for (const id of MANIFEST.textures.ids) {
  console.log(`texture ${id}`);
  await fetchTexture(id, MANIFEST.textures.resolution, MANIFEST.textures.maps);
}
for (const id of MANIFEST.hdris.ids) {
  console.log(`hdri   ${id}`);
  await fetchHdri(id, MANIFEST.hdris.resolution);
}
console.log(bytes ? `\ndownloaded ${(bytes / 1e6).toFixed(1)} MB` : '\nalready up to date');

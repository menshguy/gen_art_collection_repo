/**
 * Studio shell.
 *
 * This is development chrome, not artwork. It browses artworks and their
 * versions, controls the seed, and gets completely out of the way when
 * ?capture=1 is set so that automated renders contain nothing but the piece.
 *
 * An artwork's latest version is what loads by default. Earlier versions live
 * in a drawer under the artwork's nav item and are reachable at ?art=<slug>&v=<n>.
 * Everything mounted here is a *version* — the size, seed and animation
 * settings come from the meta.js that shipped with it, so opening v1 shows v1
 * as it actually was.
 */

import './style.css';
import { Pane } from 'tweakpane';
import {
  listArtworks,
  getArtwork,
  getArtworkVersion,
  defaultArtwork
} from './runtime/artwork-registry.js';
import { beginArtwork, signalError } from './runtime/ready.js';
import { saveArtwork } from './shared/export.js';
import {
  ASPECT_PRESETS,
  resolveSize,
  matchAspect,
  readSizeParams,
  formatSize
} from './shared/canvas-size.js';

const el = {
  studio: document.getElementById('studio'),
  list: document.getElementById('artwork-list'),
  count: document.getElementById('artwork-count'),
  title: document.getElementById('artwork-title'),
  badge: document.getElementById('engine-badge'),
  versionBadge: document.getElementById('version-badge'),
  seedInput: document.getElementById('seed-input'),
  seedRandom: document.getElementById('seed-random'),
  reload: document.getElementById('reload'),
  playpause: document.getElementById('playpause'),
  aspectSelect: document.getElementById('aspect-select'),
  widthInput: document.getElementById('width-input'),
  heightInput: document.getElementById('height-input'),
  sizeReset: document.getElementById('size-reset'),
  cleanLink: document.getElementById('clean-link'),
  stage: document.getElementById('stage'),
  root: document.getElementById('artwork-root'),
  status: document.getElementById('status')
};

const artworks = listArtworks();
let current = null; // mounted host handle
let currentVersion = null; // the version entry actually mounted
// { width?, height?, aspect? } — empty means "use the size in meta.js".
let sizeOverride = {};
let currentSize = null; // the resolved { width, height } actually mounted
let pane = null;
let paneContainer = null;
// Slugs whose version drawer the user has opened. Purely chrome state.
const openDrawers = new Set();

/** A version link only needs `&v=` when it is not the default (latest). */
const versionQuery = (version) => (version && !version.isLatest ? `&v=${version.version}` : '');

/* ----------------------------- URL state ----------------------------- */

function readUrl() {
  const params = new URLSearchParams(location.search);
  const slug = params.get('art');
  const artwork = (slug && getArtwork(slug)) || defaultArtwork();
  // An unknown ?v= falls back to the latest rather than showing nothing.
  const version = artwork
    ? (getArtworkVersion(artwork.slug, params.get('v')) ?? artwork.latest)
    : null;
  const seedParam = params.get('seed');
  const seed = seedParam !== null && seedParam !== '' ? Number(seedParam) : version?.seed ?? 1;
  return {
    artwork,
    version,
    seed: Number.isFinite(seed) ? seed : (version?.seed ?? 1),
    capture: params.get('capture') === '1',
    size: readSizeParams(params)
  };
}

function writeUrl(version, seed, { replace = true } = {}) {
  const params = new URLSearchParams(location.search);
  params.set('art', version.slug);
  params.set('seed', String(seed));
  // The latest version is the default, so it never needs to be spelled out.
  if (version.isLatest) params.delete('v');
  else params.set('v', String(version.version));
  // Only a resolved pixel size travels in the URL — never `aspect` — so a
  // shared link, the clean link and `npm run render --width/--height` all
  // describe the canvas the same way.
  params.delete('aspect');
  if (currentSize?.overridden) {
    params.set('w', String(currentSize.width));
    params.set('h', String(currentSize.height));
  } else {
    params.delete('w');
    params.delete('h');
  }
  const url = `${location.pathname}?${params}`;
  if (replace) history.replaceState({}, '', url);
  else history.pushState({}, '', url);
}

/* ------------------------------ mounting ----------------------------- */

async function mount(version, seed, capture) {
  unmount();
  currentVersion = version;

  // Clear the readiness signal synchronously, before awaiting the engine host.
  // Otherwise anything watching (the render script, a test) can observe the
  // previous artwork's stale `ready` while this one is still loading.
  if (version) beginArtwork({ slug: version.slug, seed, engine: version.engine });

  if (!version) {
    setStatus('No artworks found in src/artworks/.', 'error');
    return;
  }
  if (!version.load) {
    const file = version.engine === 'three' ? 'scene.three.js' : 'sketch.p5.js';
    const where = version.isLatest
      ? `src/artworks/${version.slug}/`
      : `src/artworks/${version.slug}/versions/v${version.version}/`;
    setStatus(
      `"${version.slug}" v${version.version} declares engine "${version.engine}" but has no ${where}${file}.`,
      'error'
    );
    return;
  }

  const label = version.isLatest ? version.title : `${version.title} v${version.version}`;
  document.title = capture ? label : `${label} — Generative Studio`;

  // The size override is applied here, on a copy: the registry entry keeps the
  // native size from meta.js, and the hosts (and so ctx.width / ctx.height)
  // only ever see the size actually being drawn.
  currentSize = resolveSize(version, sizeOverride);
  const framed = { ...version, width: currentSize.width, height: currentSize.height };
  el.root.style.aspectRatio = `${framed.width} / ${framed.height}`;
  if (!capture) fitStage();

  if (!capture) {
    pane = createPane();
    paneContainer.hidden = true;
  }

  const opts = {
    artwork: framed,
    container: el.root,
    seed,
    capture,
    pane,
    reload: () => mount(version, seed, capture)
  };

  try {
    setStatus(
      `Running ${version.slug} v${version.version}${version.isLatest ? ' (latest)' : ''}` +
        ` · seed ${seed} · ${formatSize(currentSize)}` +
        (currentSize.overridden ? ` (native ${formatSize(currentSize.native)})` : '')
    );
    // Hosts load on demand so a p5 session never downloads three, and vice versa.
    if (version.engine === 'three') {
      const { mountThree } = await import('./runtime/three-host.js');
      current = await mountThree(opts);
    } else {
      const { mountP5 } = await import('./runtime/p5-host.js');
      current = await mountP5(opts);
    }
    if (pane) paneContainer.hidden = pane.children.length === 0;
  } catch (err) {
    signalError(err);
    console.error(err);
    setStatus(`${version.slug} v${version.version} failed: ${err.message}`, 'error');
    return;
  }

  if (!capture) syncChrome(version, seed);
}

function unmount() {
  if (current) {
    current.destroy();
    current = null;
  }
  if (pane) {
    pane.dispose();
    pane = null;
  }
  if (paneContainer) {
    paneContainer.remove();
    paneContainer = null;
  }
  el.root.replaceChildren();
}

function createPane() {
  paneContainer = document.createElement('div');
  paneContainer.id = 'pane-container';
  el.stage.appendChild(paneContainer);
  return new Pane({ container: paneContainer, title: 'params' });
}

/* -------------------------------- chrome ------------------------------ */

/** Switch what is mounted, reset per-composition state, and push history. */
async function selectVersion(version, { push = true } = {}) {
  // Size is a property of one version's composition, not of the studio.
  sizeOverride = {};
  buildSidebar(version);
  await mount(version, version.seed, false);
  writeUrl(version, version.seed, { replace: !push });
}

function buildVersionDrawer(artwork, activeVersion) {
  const isActiveArtwork = activeVersion?.slug === artwork.slug;
  // Open when the user opened it, or automatically when they are looking at
  // something other than the latest — otherwise the selection would be hidden.
  const open = openDrawers.has(artwork.slug) || (isActiveArtwork && !activeVersion.isLatest);
  if (open) openDrawers.add(artwork.slug);

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'version-toggle';
  toggle.setAttribute('aria-expanded', String(open));
  toggle.innerHTML =
    `<span class="chev" aria-hidden="true">▸</span>` +
    `<span>${artwork.versions.length} versions</span>`;

  const drawer = document.createElement('div');
  drawer.className = 'version-drawer';
  drawer.hidden = !open;

  for (const version of artwork.versions) {
    const active = isActiveArtwork && version.version === activeVersion.version;
    const a = document.createElement('a');
    a.href = `?art=${artwork.slug}&seed=${version.seed}${versionQuery(version)}`;
    a.className = 'version-link' + (active ? ' active' : '');
    a.title = version.note || (version.isLatest ? 'current version' : `version ${version.version}`);
    a.innerHTML =
      `<span class="v">v${version.version}</span>` +
      (version.isLatest ? `<span class="tag">latest</span>` : '') +
      (version.note ? `<span class="note">${escapeHtml(version.note)}</span>` : '');
    a.addEventListener('click', (event) => {
      event.preventDefault();
      selectVersion(version);
    });
    drawer.appendChild(a);
  }

  toggle.addEventListener('click', () => {
    const nowOpen = drawer.hidden;
    drawer.hidden = !nowOpen;
    toggle.setAttribute('aria-expanded', String(nowOpen));
    if (nowOpen) openDrawers.add(artwork.slug);
    else openDrawers.delete(artwork.slug);
  });

  return [toggle, drawer];
}

function buildSidebar(activeVersion) {
  el.list.replaceChildren();
  const byEngine = { p5: [], three: [] };
  for (const art of artworks) (byEngine[art.engine] ?? (byEngine[art.engine] = [])).push(art);

  for (const [engine, items] of Object.entries(byEngine)) {
    if (!items.length) continue;
    const group = document.createElement('div');
    group.className = 'group';
    const label = document.createElement('div');
    label.className = 'group-label';
    label.textContent = engine;
    group.appendChild(label);

    for (const art of items) {
      const item = document.createElement('div');
      item.className = 'artwork-item';
      item.dataset.slug = art.slug;

      const a = document.createElement('a');
      a.href = `?art=${art.slug}&seed=${art.seed}`;
      a.className = 'artwork-link' + (art.slug === activeVersion?.slug ? ' active' : '');
      a.dataset.slug = art.slug;
      a.innerHTML = `<span class="name">${escapeHtml(art.title)}</span><span class="slug">${art.slug}</span>`;
      a.addEventListener('click', (event) => {
        event.preventDefault();
        // Clicking the artwork itself always means "the current version".
        selectVersion(art.latest);
      });
      item.appendChild(a);

      // A one-version artwork has no history worth a drawer.
      if (art.hasHistory) item.append(...buildVersionDrawer(art, activeVersion));
      group.appendChild(item);
    }
    el.list.appendChild(group);
  }
  el.count.textContent = `${artworks.length} artwork${artworks.length === 1 ? '' : 's'}`;
}

function syncChrome(version, seed) {
  el.title.textContent = version.title;
  el.badge.textContent = version.engine;
  el.badge.dataset.engine = version.engine;
  el.versionBadge.textContent = `v${version.version}`;
  el.versionBadge.dataset.latest = String(version.isLatest);
  el.versionBadge.title = version.isLatest
    ? `Latest version${version.note ? ` — ${version.note}` : ''}`
    : `Archived version ${version.version}${version.note ? ` — ${version.note}` : ''}` +
      (version.archivedAt ? ` (archived ${version.archivedAt.slice(0, 10)})` : '');
  el.seedInput.value = String(seed);
  const sizeQuery = currentSize?.overridden ? `&w=${currentSize.width}&h=${currentSize.height}` : '';
  el.cleanLink.href = `?art=${version.slug}&seed=${seed}${versionQuery(version)}${sizeQuery}&capture=1`;
  el.playpause.hidden = !version.animated;
  el.playpause.textContent = 'pause';
  syncSizeFields();
}

function escapeHtml(text) {
  return String(text).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}

/* -------------------------------- size -------------------------------- */

/**
 * Scale the canvas box down until the whole artwork fits inside the stage.
 * Never scales up: a small canvas stays at its real pixel size. The canvas
 * bitmap keeps the artwork's real dimensions — only its CSS size changes — so
 * the studio shows the same framing `npm run render` writes.
 */
function fitStage() {
  if (!currentSize || !el.stage) return;
  const style = getComputedStyle(el.stage);
  const availWidth =
    el.stage.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  const availHeight =
    el.stage.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
  if (!(availWidth > 0) || !(availHeight > 0)) return;
  const scale = Math.min(1, availWidth / currentSize.width, availHeight / currentSize.height);
  el.root.style.width = `${Math.round(currentSize.width * scale)}px`;
  el.root.style.height = `${Math.round(currentSize.height * scale)}px`;
}

function buildAspectOptions() {
  el.aspectSelect.replaceChildren();
  const add = (value, label, disabled = false) => {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = label;
    opt.disabled = disabled;
    el.aspectSelect.appendChild(opt);
  };
  add('native', 'native');
  for (const preset of ASPECT_PRESETS) add(preset.id, preset.label);
  // Only ever a readout: reached by typing pixel sizes, not by choosing it.
  add('custom', 'custom', true);
}

function syncSizeFields() {
  if (!currentSize) return;
  el.widthInput.value = String(currentSize.width);
  el.heightInput.value = String(currentSize.height);
  el.aspectSelect.value = currentSize.overridden
    ? (matchAspect(currentSize.width, currentSize.height) ?? 'custom')
    : 'native';
  el.sizeReset.disabled = !currentSize.overridden;
  el.aspectSelect.title = `native ${formatSize(currentSize.native)} — reshapes at roughly the same pixel count`;
}

function applySizeOverride(next) {
  sizeOverride = next;
  remount(currentSeed());
}

function setStatus(message, kind = 'info') {
  // The status bar is removed entirely in capture mode.
  if (!el.status?.isConnected) return;
  el.status.textContent = message;
  el.status.dataset.kind = kind;
}

function currentSeed() {
  const value = Number(el.seedInput.value);
  return Number.isFinite(value) ? Math.trunc(value) : 1;
}

/** Re-run the current version, then record seed and size in the URL. */
async function remount(seed) {
  if (!currentVersion) return;
  await mount(currentVersion, seed, false);
  writeUrl(currentVersion, seed);
}

function applySeed(seed) {
  remount(seed);
}

function wireToolbar() {
  buildAspectOptions();
  new ResizeObserver(() => fitStage()).observe(el.stage);

  el.aspectSelect.addEventListener('change', () => {
    const value = el.aspectSelect.value;
    if (value === 'custom') return syncSizeFields();
    if (value === 'native') return applySizeOverride({});
    // Reshape what is on screen now, at constant pixel area, so switching
    // aspect changes the framing without also changing the render cost.
    const reshaped = resolveSize(currentSize ?? currentVersion, { aspect: value });
    applySizeOverride({ width: reshaped.width, height: reshaped.height });
  });

  const applyTypedSize = () => {
    const width = Number(el.widthInput.value);
    const height = Number(el.heightInput.value);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      return syncSizeFields();
    }
    if (currentSize && width === currentSize.width && height === currentSize.height) return;
    applySizeOverride({ width, height });
  };
  el.widthInput.addEventListener('change', applyTypedSize);
  el.heightInput.addEventListener('change', applyTypedSize);
  el.sizeReset.addEventListener('click', () => applySizeOverride({}));

  el.seedRandom.addEventListener('click', () => applySeed(Math.floor(Math.random() * 1_000_000)));
  el.reload.addEventListener('click', () => applySeed(currentSeed()));
  el.seedInput.addEventListener('change', () => applySeed(currentSeed()));
  el.playpause.addEventListener('click', () => {
    if (!current) return;
    if (current.isPaused()) {
      current.play();
      el.playpause.textContent = 'pause';
    } else {
      current.pause();
      el.playpause.textContent = 'play';
    }
  });

  window.addEventListener('popstate', () => {
    const { version, seed, size } = readUrl();
    sizeOverride = size;
    buildSidebar(version);
    mount(version, seed, false);
  });

  window.addEventListener('keydown', (event) => {
    if (event.target instanceof HTMLInputElement) return;
    if (event.target instanceof HTMLSelectElement) return;
    if (event.key === 'r') applySeed(Math.floor(Math.random() * 1_000_000));
    if (event.key === 's' && currentVersion) saveArtwork(currentVersion.slug, currentSeed());
    if (event.key === ' ' && current?.isAnimated) {
      event.preventDefault();
      el.playpause.click();
    }
  });
}

/* -------------------------------- boot -------------------------------- */

const { version, seed, capture, size } = readUrl();
sizeOverride = size;

if (capture) {
  document.body.classList.add('capture');
  // Studio chrome must not exist at all during a capture, not merely be hidden.
  document.getElementById('sidebar')?.remove();
  document.getElementById('toolbar')?.remove();
  el.status?.remove();
  mount(version, seed, true);
} else {
  buildSidebar(version);
  wireToolbar();
  mount(version, seed, false).then(() => {
    if (version) writeUrl(version, seed);
  });
}

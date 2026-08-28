/**
 * Studio shell.
 *
 * This is development chrome, not artwork. It browses artworks, controls the
 * seed, and gets completely out of the way when ?capture=1 is set so that
 * automated renders contain nothing but the piece itself.
 */

import './style.css';
import { Pane } from 'tweakpane';
import { listArtworks, getArtwork, defaultArtwork } from './runtime/artwork-registry.js';
import { beginArtwork, signalError } from './runtime/ready.js';
import { saveArtwork } from './shared/export.js';

const el = {
  studio: document.getElementById('studio'),
  list: document.getElementById('artwork-list'),
  count: document.getElementById('artwork-count'),
  title: document.getElementById('artwork-title'),
  badge: document.getElementById('engine-badge'),
  seedInput: document.getElementById('seed-input'),
  seedRandom: document.getElementById('seed-random'),
  reload: document.getElementById('reload'),
  playpause: document.getElementById('playpause'),
  cleanLink: document.getElementById('clean-link'),
  stage: document.getElementById('stage'),
  root: document.getElementById('artwork-root'),
  status: document.getElementById('status')
};

const artworks = listArtworks();
let current = null; // mounted host handle
let currentArtwork = null;
let pane = null;
let paneContainer = null;

/* ----------------------------- URL state ----------------------------- */

function readUrl() {
  const params = new URLSearchParams(location.search);
  const slug = params.get('art');
  const artwork = (slug && getArtwork(slug)) || defaultArtwork();
  const seedParam = params.get('seed');
  const seed = seedParam !== null && seedParam !== '' ? Number(seedParam) : artwork?.seed ?? 1;
  return {
    artwork,
    seed: Number.isFinite(seed) ? seed : (artwork?.seed ?? 1),
    capture: params.get('capture') === '1'
  };
}

function writeUrl(slug, seed, { replace = true } = {}) {
  const params = new URLSearchParams(location.search);
  params.set('art', slug);
  params.set('seed', String(seed));
  const url = `${location.pathname}?${params}`;
  if (replace) history.replaceState({}, '', url);
  else history.pushState({}, '', url);
}

/* ------------------------------ mounting ----------------------------- */

async function mount(artwork, seed, capture) {
  unmount();
  currentArtwork = artwork;

  // Clear the readiness signal synchronously, before awaiting the engine host.
  // Otherwise anything watching (the render script, a test) can observe the
  // previous artwork's stale `ready` while this one is still loading.
  if (artwork) beginArtwork({ slug: artwork.slug, seed, engine: artwork.engine });

  if (!artwork) {
    setStatus('No artworks found in src/artworks/.', 'error');
    return;
  }
  if (!artwork.load) {
    setStatus(
      `"${artwork.slug}" declares engine "${artwork.engine}" but has no ${
        artwork.engine === 'three' ? 'scene.three.js' : 'sketch.p5.js'
      }.`,
      'error'
    );
    return;
  }

  document.title = capture ? artwork.title : `${artwork.title} — Generative Studio`;
  el.root.style.aspectRatio = `${artwork.width} / ${artwork.height}`;

  if (!capture) {
    pane = createPane();
    paneContainer.hidden = true;
  }

  const opts = {
    artwork,
    container: el.root,
    seed,
    capture,
    pane,
    reload: () => mount(artwork, seed, capture)
  };

  try {
    setStatus(`Running ${artwork.slug} · seed ${seed}`);
    // Hosts load on demand so a p5 session never downloads three, and vice versa.
    if (artwork.engine === 'three') {
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
    setStatus(`${artwork.slug} failed: ${err.message}`, 'error');
    return;
  }

  if (!capture) syncChrome(artwork, seed);
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

function buildSidebar(activeSlug) {
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
      const a = document.createElement('a');
      a.href = `?art=${art.slug}&seed=${art.seed}`;
      a.className = 'artwork-link' + (art.slug === activeSlug ? ' active' : '');
      a.dataset.slug = art.slug;
      a.innerHTML = `<span class="name">${art.title}</span><span class="slug">${art.slug}</span>`;
      a.addEventListener('click', (event) => {
        event.preventDefault();
        writeUrl(art.slug, art.seed, { replace: false });
        buildSidebar(art.slug);
        mount(art, art.seed, false);
      });
      group.appendChild(a);
    }
    el.list.appendChild(group);
  }
  el.count.textContent = `${artworks.length} artwork${artworks.length === 1 ? '' : 's'}`;
}

function syncChrome(artwork, seed) {
  el.title.textContent = artwork.title;
  el.badge.textContent = artwork.engine;
  el.badge.dataset.engine = artwork.engine;
  el.seedInput.value = String(seed);
  el.cleanLink.href = `?art=${artwork.slug}&seed=${seed}&capture=1`;
  el.playpause.hidden = !artwork.animated;
  el.playpause.textContent = 'pause';
  for (const a of el.list.querySelectorAll('.artwork-link')) {
    a.classList.toggle('active', a.dataset.slug === artwork.slug);
  }
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

function applySeed(seed) {
  if (!currentArtwork) return;
  writeUrl(currentArtwork.slug, seed);
  mount(currentArtwork, seed, false);
}

function wireToolbar() {
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
    const { artwork, seed } = readUrl();
    buildSidebar(artwork?.slug);
    mount(artwork, seed, false);
  });

  window.addEventListener('keydown', (event) => {
    if (event.target instanceof HTMLInputElement) return;
    if (event.key === 'r') applySeed(Math.floor(Math.random() * 1_000_000));
    if (event.key === 's' && currentArtwork) saveArtwork(currentArtwork.slug, currentSeed());
    if (event.key === ' ' && current?.isAnimated) {
      event.preventDefault();
      el.playpause.click();
    }
  });
}

/* -------------------------------- boot -------------------------------- */

const { artwork, seed, capture } = readUrl();

if (capture) {
  document.body.classList.add('capture');
  // Studio chrome must not exist at all during a capture, not merely be hidden.
  document.getElementById('sidebar')?.remove();
  document.getElementById('toolbar')?.remove();
  el.status?.remove();
  mount(artwork, seed, true);
} else {
  buildSidebar(artwork?.slug);
  wireToolbar();
  if (artwork) writeUrl(artwork.slug, seed);
  mount(artwork, seed, false);
}

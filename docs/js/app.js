import * as store from './store.js';
import { applyPieceStyle, applyBoardStyle } from './pieces.js';
import { setSound, unlockAudio } from './sound.js';
import { h, clear, ICONS } from './util.js';
import { isProvisional } from './glicko.js';

const routes = {
  home: () => import('./views/home.js'),
  play: () => import('./views/play.js'),
  practice: () => import('./views/practice.js'),
  review: () => import('./views/review.js'),
  puzzles: () => import('./views/puzzles.js'),
  drills: () => import('./views/drills.js'),
  editor: () => import('./views/editor.js'),
  profile: () => import('./views/profile.js'),
  settings: () => import('./views/settings.js'),
  login: () => import('./views/auth.js'),
  admin: () => import('./views/admin.js'),
};

let cleanup = null;
let routeToken = 0;

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, query] = raw.split('?');
  const parts = path.split('/').filter(Boolean);
  const params = Object.fromEntries(new URLSearchParams(query || ''));
  return { name: parts[0] || 'home', args: parts.slice(1), params };
}

async function route() {
  const token = ++routeToken;
  const r = parseHash();
  const loader = routes[r.name] || routes.home;
  if (cleanup) { try { cleanup(); } catch (e) { console.error(e); } cleanup = null; }
  const view = document.getElementById('view');
  clear(view);
  document.querySelectorAll('.modalbg').forEach((m) => m.remove());
  document.querySelectorAll('#mainnav a').forEach((a) => {
    const n = a.dataset.nav;
    a.classList.toggle('on', n === r.name || (n === 'home' && ['play', 'practice', 'review'].includes(r.name)));
  });
  try {
    const mod = await loader();
    if (token !== routeToken) return;
    const c = await mod.render(view, r);
    if (token !== routeToken) { if (typeof c === 'function') c(); return; }
    cleanup = typeof c === 'function' ? c : null;
  } catch (e) {
    console.error(e);
    view.appendChild(h('div', { class: 'card' }, h('h2', null, 'Something went wrong'), h('p', { class: 'muted' }, String(e && e.message || e))));
  }
  window.scrollTo(0, 0);
}

export function go(path) {
  if (location.hash === '#' + path) route();
  else location.hash = path;
}

function renderTopRight() {
  const box = document.getElementById('topright');
  clear(box);
  const g = store.state.ratings.game;
  if (g && g.n > 0) {
    box.appendChild(h('a', { class: 'chip', href: '#/profile', title: 'Your rating' }, Math.round(g.r) + (isProvisional(g) ? '?' : '')));
  }
  if (store.state.user) {
    box.appendChild(h('a', { class: 'muted small', href: '#/profile' }, store.state.user.username));
  } else {
    box.appendChild(h('a', { class: 'btn small', href: '#/login' }, 'Sign in'));
  }
  box.appendChild(h('a', { class: 'iconbtn', href: '#/settings', title: 'Settings', html: ICONS.gear }));
}

export function applyStyle() {
  const s = store.getStyle();
  applyBoardStyle(s);
  setSound(s.sound);
  return applyPieceStyle(s);
}

async function main() {
  await store.init();
  await applyStyle();
  renderTopRight();
  store.onChange((what) => {
    if (what === 'ratings' || what === 'auth' || what === 'refresh' || what === 'init') renderTopRight();
    if (what === 'data:style' || what === 'auth' || what === 'refresh') applyStyle();
    if (what === 'auth') route();
  });
  window.addEventListener('hashchange', route);
  document.addEventListener('pointerdown', unlockAudio, { once: true });
  route();
}

main();

// App data. Signed-in players keep everything on the server (ratings are computed there);
// guests keep it in this browser and can bring it along when they create an account.

import { api, getSession, setSession } from './api.js';
import { applyResult, newRating, MAX_RD } from './glicko.js';
import { botById, BOT_RD } from './bots.js';
import { uid, todayKey } from './util.js';

const GUEST_KEY = 'ct.guest';
const CACHE_PREFIX = 'ct.acct.';
export const PLACEMENT_GAMES = 5;

export const DEFAULT_STYLE = {
  set: 'cburnett',
  colors: null,
  images: {},
  useImages: false,
  board: 'brown',
  light: '#f0d9b5',
  dark: '#b58863',
  coords: true,
  dests: true,
  animation: true,
  sound: true,
  autoQueen: false,
  confirmResign: true,
};

export const state = {
  user: null,
  ratings: { game: null, puzzle: null },
  data: {},
  stamps: {},
  online: true,
};

const listeners = new Set();
export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit(what) { for (const fn of listeners) { try { fn(what); } catch (e) { console.error(e); } } }

function loadJSON(key, dflt) {
  try { const v = JSON.parse(localStorage.getItem(key)); return v == null ? dflt : v; } catch (_) { return dflt; }
}
function saveJSON(key, v) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) { console.warn('Storage full', e); }
}

export function isGuest() { return !state.user; }

function guest() {
  const g = loadJSON(GUEST_KEY, null) || {};
  g.ratings = g.ratings || { game: null, puzzle: null };
  g.games = g.games || [];
  g.puzzles = g.puzzles || [];
  g.data = g.data || {};
  g.stamps = g.stamps || {};
  return g;
}
function saveGuest(g) { saveJSON(GUEST_KEY, g); }

function cacheKey() { return CACHE_PREFIX + (state.user ? state.user.username.toLowerCase() : ''); }
function saveCache() {
  if (!state.user) return;
  saveJSON(cacheKey(), { user: state.user, ratings: state.ratings, data: state.data, stamps: state.stamps });
}

export async function init() {
  const s = getSession();
  if (s && s.token) {
    state.user = s.user || { username: s.username };
    const cached = loadJSON(cacheKey(), null);
    if (cached) Object.assign(state, { ratings: cached.ratings, data: cached.data || {}, stamps: cached.stamps || {} });
    try {
      await refresh();
    } catch (e) {
      if (e.status === 401) { signOutLocal(); }
      else state.online = false;
    }
  } else {
    loadGuestState();
  }
  emit('init');
}

function loadGuestState() {
  const g = guest();
  state.user = null;
  state.ratings = g.ratings;
  state.data = g.data;
  state.stamps = g.stamps;
}

export async function refresh() {
  const me = await api('GET', '/me');
  applyMe(me);
  state.online = true;
  emit('refresh');
  return me;
}

function applyMe(me) {
  state.user = me.user;
  state.ratings = me.ratings || { game: null, puzzle: null };
  const merged = { ...state.data };
  const stamps = { ...state.stamps };
  for (const [k, e] of Object.entries(me.data || {})) {
    if (!stamps[k] || e.t >= stamps[k]) { merged[k] = e.v; stamps[k] = e.t; }
  }
  state.data = merged;
  state.stamps = stamps;
  const s = getSession();
  if (s) setSession({ ...s, user: me.user });
  saveCache();
}

// ---- accounts ----

export async function signup(username, password, bringGuest) {
  const g = guest();
  const payload = { username, password };
  if (bringGuest) payload.guest = { ratings: g.ratings, games: g.games.slice(-300).map(stripGame), puzzles: g.puzzles.slice(-2000), data: wrapData(g.data, g.stamps) };
  const r = await api('POST', '/signup', payload);
  setSession({ token: r.token, user: r.user });
  if (bringGuest) localStorage.removeItem(GUEST_KEY);
  await refresh();
  emit('auth');
}

export async function login(username, password) {
  const r = await api('POST', '/login', { username, password });
  setSession({ token: r.token, user: r.user });
  state.data = {};
  state.stamps = {};
  await refresh();
  emit('auth');
}

export async function logout() {
  try { await api('POST', '/logout'); } catch (_) { /* ignore */ }
  signOutLocal();
}

export function signOutLocal() {
  setSession(null);
  loadGuestState();
  emit('auth');
}

window.addEventListener('ct-signed-out', () => { loadGuestState(); emit('auth'); });

function wrapData(data, stamps) {
  const out = {};
  for (const [k, v] of Object.entries(data || {})) out[k] = { v, t: stamps[k] || Date.now() };
  return out;
}

function stripGame(g) {
  const { id, ...rest } = g;
  return rest;
}

// ---- synced settings and small data ----

let pushTimer = null;
const dirty = new Set();

export function getData(key, dflt) {
  const v = state.data[key];
  return v === undefined ? dflt : v;
}

export function setData(key, value) {
  state.data[key] = value;
  state.stamps[key] = Date.now();
  if (state.user) {
    saveCache();
    dirty.add(key);
    clearTimeout(pushTimer);
    pushTimer = setTimeout(pushData, 800);
  } else {
    const g = guest();
    g.data[key] = value;
    g.stamps[key] = state.stamps[key];
    saveGuest(g);
  }
  emit('data:' + key);
}

async function pushData() {
  if (!state.user || !dirty.size) return;
  const keys = [...dirty];
  dirty.clear();
  const body = {};
  for (const k of keys) body[k] = { v: state.data[k], t: state.stamps[k] };
  try {
    await api('PUT', '/profile', { data: body });
  } catch (e) {
    keys.forEach((k) => dirty.add(k));
    if (e.status !== 401) { clearTimeout(pushTimer); pushTimer = setTimeout(pushData, 15000); }
  }
}
window.addEventListener('pagehide', () => { if (dirty.size) pushData(); });

export function getStyle() {
  return { ...DEFAULT_STYLE, ...(getData('style') || {}) };
}

export function setStyle(patch) {
  setData('style', { ...getStyle(), ...patch });
}

export function bumpDaily(field, n = 1) {
  const today = todayKey();
  const d = getData('daily');
  const cur = d && d.date === today ? { ...d } : { date: today, puzzles: 0, games: 0, drills: 0, reviews: 0 };
  cur[field] = (cur[field] || 0) + n;
  setData('daily', cur);
}

export function daily() {
  const d = getData('daily');
  return d && d.date === todayKey() ? d : { date: todayKey(), puzzles: 0, games: 0, drills: 0, reviews: 0 };
}

// ---- ratings ----

export async function initRating(startR) {
  if (state.user) {
    const r = await api('POST', '/rating/init', { r: startR });
    state.ratings = r.ratings;
    saveCache();
  } else {
    const g = guest();
    g.ratings.game = { ...newRating(startR, MAX_RD), w: 0, d: 0, l: 0 };
    saveGuest(g);
    state.ratings = g.ratings;
  }
  emit('ratings');
}

export function inPlacement() {
  const g = state.ratings.game;
  return !g || (g.n || 0) < PLACEMENT_GAMES;
}

// game: { mode, botId, color, result: 'win'|'loss'|'draw', reason, pgn, startFen, plies }
// Returns the saved record (with rBefore/rAfter when rated).
export async function recordGame(game) {
  const rated = game.mode === 'rated';
  if (state.user) {
    const r = await api('POST', '/games', game);
    if (r.ratings) state.ratings = r.ratings;
    saveCache();
    bumpDaily('games');
    emit('ratings');
    return r.game;
  }
  const g = guest();
  const bot = botById(game.botId);
  const rec = { ...game, id: 'g' + uid(), ts: Date.now(), rated, botRating: bot ? bot.rating : null, review: null };
  if (rated && bot && g.ratings.game) {
    const score = game.result === 'win' ? 1 : game.result === 'draw' ? 0.5 : 0;
    const before = g.ratings.game;
    const after = applyResult(before, { r: bot.rating, rd: BOT_RD }, score);
    after.w = (before.w || 0) + (score === 1 ? 1 : 0);
    after.d = (before.d || 0) + (score === 0.5 ? 1 : 0);
    after.l = (before.l || 0) + (score === 0 ? 1 : 0);
    rec.rBefore = before.r;
    rec.rAfter = after.r;
    rec.rdAfter = after.rd;
    g.ratings.game = after;
  }
  g.games.push(rec);
  if (g.games.length > 300) g.games = g.games.slice(-300);
  saveGuest(g);
  state.ratings = g.ratings;
  bumpDaily('games');
  emit('ratings');
  return rec;
}

export async function listGames(limit = 50) {
  if (state.user) {
    const r = await api('GET', '/games?limit=' + limit);
    return r.games;
  }
  return guest().games.slice().reverse().slice(0, limit).map((x) => ({ ...x, pgn: undefined }));
}

export async function getGame(id) {
  if (state.user && !String(id).startsWith('g')) {
    const r = await api('GET', '/games/' + id);
    return r.game;
  }
  return guest().games.find((x) => x.id === id) || null;
}

export async function saveReview(id, review) {
  if (state.user && !String(id).startsWith('g')) {
    try { await api('PATCH', '/games/' + id, { review }); } catch (e) { console.warn(e); }
    return;
  }
  const g = guest();
  const rec = g.games.find((x) => x.id === id);
  if (rec) { rec.review = review; saveGuest(g); }
}

export async function ratingHistory() {
  if (state.user) {
    const r = await api('GET', '/history');
    return r.points;
  }
  return guest().games.filter((x) => x.rated && x.rAfter != null).map((x) => ({ ts: x.ts, r: x.rAfter }));
}

export async function botRecords() {
  if (state.user) {
    const r = await api('GET', '/records');
    return r.records;
  }
  const rec = {};
  for (const x of guest().games) {
    if (!x.botId || x.mode !== 'rated') continue;
    const o = rec[x.botId] || (rec[x.botId] = { w: 0, d: 0, l: 0 });
    o[x.result === 'win' ? 'w' : x.result === 'draw' ? 'd' : 'l']++;
  }
  return rec;
}

// ---- puzzles ----

export function puzzleRating() {
  if (state.ratings.puzzle) return state.ratings.puzzle;
  const start = state.ratings.game ? Math.round(state.ratings.game.r) : 1000;
  return { ...newRating(start, MAX_RD), w: 0, l: 0 };
}

export async function recordPuzzle({ id, rating, solved }) {
  const seen = getData('pseen', []);
  if (!seen.includes(id)) setData('pseen', [...seen, id].slice(-3000));
  bumpDaily('puzzles');
  if (state.user) {
    const r = await api('POST', '/puzzles', { id, rating, solved });
    state.ratings = r.ratings;
    saveCache();
    emit('ratings');
    return r.ratings.puzzle;
  }
  const g = guest();
  const before = g.ratings.puzzle || puzzleRating();
  const after = applyResult(before, { r: rating, rd: 80 }, solved ? 1 : 0);
  after.w = (before.w || 0) + (solved ? 1 : 0);
  after.l = (before.l || 0) + (solved ? 0 : 1);
  g.ratings.puzzle = after;
  g.puzzles.push({ id, rating, solved, ts: Date.now(), r: after.r });
  if (g.puzzles.length > 3000) g.puzzles = g.puzzles.slice(-3000);
  saveGuest(g);
  state.ratings = g.ratings;
  emit('ratings');
  return after;
}

export function guestHasProgress() {
  const g = guest();
  return !!(g.games.length || g.puzzles.length || g.ratings.game || Object.keys(g.data).length);
}

// ---- in-progress game (survives reloads) ----

export function saveCurrent(cur) { saveJSON('ct.current', cur); }
export function loadCurrent() { return loadJSON('ct.current', null); }
export function clearCurrent() { localStorage.removeItem('ct.current'); }

// ---- account settings ----

export async function changePassword(oldPw, newPw) {
  await api('POST', '/password', { old: oldPw, password: newPw });
}

export async function deleteAccount(pw) {
  await api('POST', '/account/delete', { password: pw });
  signOutLocal();
}

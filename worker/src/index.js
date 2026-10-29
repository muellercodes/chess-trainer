// Chess Trainer API: accounts (username + password, no email), ratings, games, puzzles, settings.
// Cloudflare Worker + D1. Ratings are computed here with the same Glicko-2 code the site uses.

import { applyResult, newRating, MAX_RD } from '../../docs/js/glicko.js';
import { botById, BOT_RD } from '../../docs/js/bots.js';

const PBKDF2_ITER = 100000;
const SESSION_DAYS = 365;
const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;
const MAX_PROFILE_VALUE = 400000;
const MAX_PGN = 30000;
const MAX_REVIEW = 60000;

// Words a username may not contain (after undoing common look-alike swaps).
const BLOCKED = ['fuck', 'shit', 'cunt', 'bitch', 'nigg', 'fag', 'retard', 'whore', 'slut', 'rape', 'nazi', 'hitler', 'kkk', 'penis', 'vagina', 'dick', 'cock', 'pussy', 'porn', 'sex'];
const RESERVED = ['admin', 'administrator', 'moderator', 'mod', 'staff', 'support', 'system', 'root', 'official', 'stockfish', 'guest'];

// ---------- helpers ----------

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...headers } });
}

class HttpError extends Error {
  constructor(status, msg) { super(msg); this.status = status; }
}
const fail = (status, msg) => { throw new HttpError(status, msg); };

const enc = new TextEncoder();

function b64(buf) {
  let s = '';
  const a = new Uint8Array(buf);
  for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]);
  return btoa(s);
}
function b64url(buf) { return b64(buf).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function fromB64(s) { return Uint8Array.from(atob(s), (c) => c.charCodeAt(0)); }

async function sha256hex(s) {
  const d = await crypto.subtle.digest('SHA-256', enc.encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function hashPassword(pw, saltB64, iter) {
  const key = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: fromB64(saltB64), iterations: iter }, key, 256);
  return b64(bits);
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let x = 0;
  for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return x === 0;
}

function normalizeName(n) {
  return n.toLowerCase().replace(/_/g, '').replace(/0/g, 'o').replace(/1/g, 'i').replace(/3/g, 'e').replace(/4/g, 'a').replace(/5/g, 's').replace(/7/g, 't').replace(/8/g, 'b').replace(/9/g, 'g');
}

function nameProblem(name, env) {
  if (!USERNAME_RE.test(name)) return 'Usernames are 3 to 20 letters, numbers or underscores.';
  const n = normalizeName(name);
  if (BLOCKED.some((w) => n.includes(w))) return 'Please pick a different username.';
  const admins = adminList(env);
  if (RESERVED.includes(n) && !admins.includes(name.toLowerCase())) return 'That username is reserved.';
  return null;
}

function adminList(env) {
  return String(env.ADMINS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}

function passwordProblem(pw) {
  if (typeof pw !== 'string' || pw.length < 6) return 'Passwords need at least 6 characters.';
  if (pw.length > 200) return 'That password is too long.';
  return null;
}

async function body(req) {
  try { return await req.json(); } catch (_) { fail(400, 'Bad request'); }
}

async function clientKey(req) {
  const ip = req.headers.get('cf-connecting-ip') || 'local';
  return (await sha256hex('ct-ip:' + ip)).slice(0, 24);
}

// At most `max` events of this kind per IP in the last `windowMs`.
async function rateLimit(env, req, kind, max, windowMs) {
  const ip = await clientKey(req);
  const since = Date.now() - windowMs;
  const row = await env.DB.prepare('SELECT COUNT(*) AS c FROM hits WHERE ip = ? AND kind = ? AND ts > ?').bind(ip, kind, since).first();
  if (row && row.c >= max) fail(429, 'Too many tries. Wait a few minutes and try again.');
  await env.DB.prepare('INSERT INTO hits (ip, kind, ts) VALUES (?, ?, ?)').bind(ip, kind, Date.now()).run();
  if (Math.random() < 0.05) await env.DB.prepare('DELETE FROM hits WHERE ts < ?').bind(Date.now() - 86400000).run();
}

async function newSession(env, userId) {
  const raw = new Uint8Array(32);
  crypto.getRandomValues(raw);
  const token = b64url(raw);
  const now = Date.now();
  await env.DB.prepare('INSERT INTO sessions (token_hash, user_id, created_at, last_used) VALUES (?, ?, ?, ?)').bind(await sha256hex(token), userId, now, now).run();
  return token;
}

async function auth(env, req) {
  const h = req.headers.get('authorization') || '';
  const m = h.match(/^Bearer (.+)$/);
  if (!m) fail(401, 'Please sign in.');
  const th = await sha256hex(m[1]);
  const s = await env.DB.prepare('SELECT s.user_id, s.last_used, u.username, u.created_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?').bind(th).first();
  if (!s) fail(401, 'Your session ended. Please sign in again.');
  const now = Date.now();
  if (now - s.last_used > SESSION_DAYS * 86400000) {
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(th).run();
    fail(401, 'Your session ended. Please sign in again.');
  }
  if (now - s.last_used > 3600000) {
    await env.DB.batch([
      env.DB.prepare('UPDATE sessions SET last_used = ? WHERE token_hash = ?').bind(now, th),
      env.DB.prepare('UPDATE users SET last_seen = ? WHERE id = ?').bind(now, s.user_id),
    ]);
  }
  return { id: s.user_id, username: s.username, created_at: s.created_at, tokenHash: th, admin: adminList(env).includes(s.username.toLowerCase()) };
}

function publicUser(u) {
  return { id: u.id, username: u.username, admin: !!u.admin, created: u.created_at };
}

async function getRatings(env, userId) {
  const rows = (await env.DB.prepare('SELECT kind, r, rd, vol, n, w, d, l FROM ratings WHERE user_id = ?').bind(userId).all()).results;
  const out = { game: null, puzzle: null };
  for (const r of rows) out[r.kind] = { r: r.r, rd: r.rd, vol: r.vol, n: r.n, w: r.w, d: r.d, l: r.l };
  return out;
}

function putRating(env, userId, kind, r) {
  return env.DB.prepare(`INSERT INTO ratings (user_id, kind, r, rd, vol, n, w, d, l, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, kind) DO UPDATE SET r = excluded.r, rd = excluded.rd, vol = excluded.vol, n = excluded.n, w = excluded.w, d = excluded.d, l = excluded.l, updated_at = excluded.updated_at`)
    .bind(userId, kind, r.r, r.rd, r.vol, r.n || 0, r.w || 0, r.d || 0, r.l || 0, Date.now());
}

function num(x, lo, hi) { const n = Number(x); return Number.isFinite(n) && n >= lo && n <= hi ? n : null; }

function gameRow(g, full) {
  const out = {
    id: g.id, ts: g.created_at, mode: g.mode, botId: g.bot_id, botRating: g.bot_rating, color: g.color, result: g.result,
    reason: g.reason, rated: !!g.rated, rBefore: g.r_before, rAfter: g.r_after, rdAfter: g.rd_after, plies: g.plies, startFen: g.start_fen,
    review: g.summary ? JSON.parse(g.summary) : null,
  };
  if (full) {
    out.pgn = g.pgn;
    if (g.review) out.review = JSON.parse(g.review);
  }
  return out;
}

function profileStmt(env, userId, k, v, t) {
  return env.DB.prepare(`INSERT INTO profile (user_id, k, v, t) VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id, k) DO UPDATE SET v = excluded.v, t = excluded.t WHERE excluded.t >= profile.t`).bind(userId, k, v, t);
}

function cleanProfile(data) {
  const out = [];
  if (!data || typeof data !== 'object') return out;
  const keys = Object.keys(data);
  if (keys.length > 40) fail(400, 'Too many settings');
  for (const k of keys) {
    if (!/^[a-zA-Z0-9_]{1,30}$/.test(k)) continue;
    const e = data[k];
    if (!e || typeof e !== 'object') continue;
    const v = JSON.stringify(e.v === undefined ? null : e.v);
    if (v.length > MAX_PROFILE_VALUE) fail(413, 'That setting is too big. Try smaller pictures.');
    const t = num(e.t, 0, Date.now() + 86400000) || Date.now();
    out.push([k, v, t]);
  }
  return out;
}

// ---------- routes ----------

async function signup(env, req) {
  const b = await body(req);
  const username = String(b.username || '').trim();
  const np = nameProblem(username, env);
  if (np) fail(400, np);
  const pp = passwordProblem(b.password);
  if (pp) fail(400, pp);
  await rateLimit(env, req, 'signup', Number(env.SIGNUP_PER_HOUR) || 6, 3600000);
  const exists = await env.DB.prepare('SELECT id FROM users WHERE username_lc = ?').bind(username.toLowerCase()).first();
  if (exists) fail(409, 'That username is taken.');
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  const saltB64 = b64(salt);
  const hash = await hashPassword(b.password, saltB64, PBKDF2_ITER);
  const now = Date.now();
  let res;
  try {
    res = await env.DB.prepare('INSERT INTO users (username, username_lc, pw_hash, pw_salt, pw_iter, created_at, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(username, username.toLowerCase(), hash, saltB64, PBKDF2_ITER, now, now).run();
  } catch (e) {
    fail(409, 'That username is taken.');
  }
  const userId = res.meta.last_row_id;
  if (b.guest) await importGuest(env, userId, b.guest);
  const token = await newSession(env, userId);
  return json({ token, user: publicUser({ id: userId, username, created_at: now, admin: adminList(env).includes(username.toLowerCase()) }) });
}

async function importGuest(env, userId, g) {
  const stmts = [];
  const now = Date.now();
  const rt = g.ratings || {};
  for (const kind of ['game', 'puzzle']) {
    const r = rt[kind];
    if (!r) continue;
    const rr = num(r.r, 0, 3500); const rd = num(r.rd, 30, 350); const vol = num(r.vol, 0.01, 0.2);
    if (rr == null || rd == null || vol == null) continue;
    stmts.push(putRating(env, userId, kind, { r: rr, rd, vol, n: num(r.n, 0, 100000) || 0, w: num(r.w, 0, 100000) || 0, d: num(r.d, 0, 100000) || 0, l: num(r.l, 0, 100000) || 0 }));
  }
  for (const x of (Array.isArray(g.games) ? g.games : []).slice(-300)) {
    if (!['rated', 'practice'].includes(x.mode) || !['w', 'b'].includes(x.color) || !['win', 'loss', 'draw'].includes(x.result)) continue;
    const bot = botById(x.botId);
    const pgn = typeof x.pgn === 'string' ? x.pgn.slice(0, MAX_PGN) : null;
    const review = x.review ? JSON.stringify(x.review) : null;
    stmts.push(env.DB.prepare(`INSERT INTO games (user_id, created_at, mode, bot_id, bot_rating, color, result, reason, rated, r_before, r_after, rd_after, plies, start_fen, pgn, review, summary)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
      userId, num(x.ts, 0, now) || now, x.mode, bot ? bot.id : null, bot ? bot.rating : null, x.color, x.result, String(x.reason || '').slice(0, 40),
      x.mode === 'rated' && x.rAfter != null ? 1 : 0, num(x.rBefore, 0, 3500), num(x.rAfter, 0, 3500), num(x.rdAfter, 0, 400), num(x.plies, 0, 2000),
      typeof x.startFen === 'string' ? x.startFen.slice(0, 100) : null, pgn,
      review && review.length < MAX_REVIEW ? review : null, x.review ? JSON.stringify({ you: x.review.you, opp: x.review.opp }) : null));
  }
  for (const p of (Array.isArray(g.puzzles) ? g.puzzles : []).slice(-2000)) {
    if (typeof p.id !== 'string' || p.id.length > 10) continue;
    stmts.push(env.DB.prepare('INSERT INTO puzzle_log (user_id, created_at, puzzle_id, puzzle_rating, solved, r_after) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(userId, num(p.ts, 0, now) || now, p.id, num(p.rating, 0, 4000) || 0, p.solved ? 1 : 0, num(p.r, 0, 4000)));
  }
  for (const [k, v, t] of cleanProfile(g.data)) stmts.push(profileStmt(env, userId, k, v, t));
  for (let i = 0; i < stmts.length; i += 80) await env.DB.batch(stmts.slice(i, i + 80));
}

async function login(env, req) {
  const b = await body(req);
  const username = String(b.username || '').trim();
  await rateLimit(env, req, 'login', Number(env.LOGIN_PER_15MIN) || 30, 900000);
  const u = await env.DB.prepare('SELECT * FROM users WHERE username_lc = ?').bind(username.toLowerCase()).first();
  if (!u || typeof b.password !== 'string') fail(401, 'Wrong username or password.');
  const hash = await hashPassword(b.password, u.pw_salt, u.pw_iter);
  if (!safeEqual(hash, u.pw_hash)) fail(401, 'Wrong username or password.');
  const token = await newSession(env, u.id);
  await env.DB.prepare('UPDATE users SET last_seen = ? WHERE id = ?').bind(Date.now(), u.id).run();
  return json({ token, user: publicUser({ ...u, admin: adminList(env).includes(u.username.toLowerCase()) }) });
}

async function me(env, user) {
  const [ratings, prof] = await Promise.all([
    getRatings(env, user.id),
    env.DB.prepare('SELECT k, v, t FROM profile WHERE user_id = ?').bind(user.id).all(),
  ]);
  const data = {};
  for (const r of prof.results) data[r.k] = { v: JSON.parse(r.v), t: r.t };
  return json({ user: publicUser(user), ratings, data });
}

async function putProfile(env, req, user) {
  const b = await body(req);
  const rows = cleanProfile(b.data);
  if (rows.length) await env.DB.batch(rows.map(([k, v, t]) => profileStmt(env, user.id, k, v, t)));
  return json({ ok: true });
}

async function ratingInit(env, req, user) {
  const b = await body(req);
  const r = num(b.r, 100, 3000);
  if (r == null) fail(400, 'Bad rating');
  const cur = await getRatings(env, user.id);
  if (cur.game && cur.game.n > 0) fail(409, 'You already have a rating.');
  await putRating(env, user.id, 'game', { ...newRating(r, MAX_RD), w: 0, d: 0, l: 0 }).run();
  return json({ ratings: await getRatings(env, user.id) });
}

async function postGame(env, req, user) {
  const b = await body(req);
  if (!['rated', 'practice'].includes(b.mode)) fail(400, 'Bad mode');
  if (!['w', 'b'].includes(b.color)) fail(400, 'Bad color');
  if (!['win', 'loss', 'draw'].includes(b.result)) fail(400, 'Bad result');
  const bot = botById(b.botId);
  if (!bot) fail(400, 'Unknown opponent');
  const pgn = typeof b.pgn === 'string' ? b.pgn.slice(0, MAX_PGN) : null;
  const now = Date.now();
  let rBefore = null; let rAfter = null; let rdAfter = null;
  const stmts = [];
  let rated = 0;
  if (b.mode === 'rated' && bot.id !== 'max') {
    const last = await env.DB.prepare('SELECT created_at FROM games WHERE user_id = ? AND rated = 1 ORDER BY created_at DESC LIMIT 1').bind(user.id).first();
    if (last && now - last.created_at < 5000) fail(429, 'Slow down a little.');
    const ratings = await getRatings(env, user.id);
    const g = ratings.game || { ...newRating(800, MAX_RD), w: 0, d: 0, l: 0 };
    const score = b.result === 'win' ? 1 : b.result === 'draw' ? 0.5 : 0;
    const next = applyResult(g, { r: bot.rating, rd: BOT_RD }, score);
    next.w = (g.w || 0) + (score === 1 ? 1 : 0);
    next.d = (g.d || 0) + (score === 0.5 ? 1 : 0);
    next.l = (g.l || 0) + (score === 0 ? 1 : 0);
    rBefore = g.r; rAfter = next.r; rdAfter = next.rd;
    rated = 1;
    stmts.push(putRating(env, user.id, 'game', next));
  }
  stmts.push(env.DB.prepare(`INSERT INTO games (user_id, created_at, mode, bot_id, bot_rating, color, result, reason, rated, r_before, r_after, rd_after, plies, start_fen, pgn)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
    user.id, now, b.mode, bot.id, bot.rating, b.color, b.result, String(b.reason || '').slice(0, 40), rated, rBefore, rAfter, rdAfter,
    num(b.plies, 0, 2000), typeof b.startFen === 'string' ? b.startFen.slice(0, 100) : null, pgn));
  const res = await env.DB.batch(stmts);
  const id = res[res.length - 1].meta.last_row_id;
  const row = await env.DB.prepare('SELECT * FROM games WHERE id = ?').bind(id).first();
  return json({ game: gameRow(row, false), ratings: await getRatings(env, user.id) });
}

async function listGames(env, url, user) {
  const limit = Math.min(200, num(url.searchParams.get('limit'), 1, 200) || 50);
  const rows = (await env.DB.prepare(`SELECT id, created_at, mode, bot_id, bot_rating, color, result, reason, rated, r_before, r_after, rd_after, plies, start_fen, summary
    FROM games WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`).bind(user.id, limit).all()).results;
  return json({ games: rows.map((g) => gameRow(g, false)) });
}

async function getGame(env, id, user) {
  const g = await env.DB.prepare('SELECT * FROM games WHERE id = ? AND user_id = ?').bind(id, user.id).first();
  if (!g) fail(404, 'Game not found');
  return json({ game: gameRow(g, true) });
}

async function patchGame(env, req, id, user) {
  const b = await body(req);
  const review = JSON.stringify(b.review || null);
  if (review.length > MAX_REVIEW) fail(413, 'Review too large');
  const summary = b.review ? JSON.stringify({ you: b.review.you, opp: b.review.opp }) : null;
  const r = await env.DB.prepare('UPDATE games SET review = ?, summary = ? WHERE id = ? AND user_id = ?').bind(review, summary, id, user.id).run();
  if (!r.meta.changes) fail(404, 'Game not found');
  return json({ ok: true });
}

async function history(env, user) {
  const rows = (await env.DB.prepare('SELECT created_at, r_after FROM games WHERE user_id = ? AND rated = 1 AND r_after IS NOT NULL ORDER BY created_at').bind(user.id).all()).results;
  return json({ points: rows.map((r) => ({ ts: r.created_at, r: r.r_after })) });
}

async function records(env, user) {
  const rows = (await env.DB.prepare(`SELECT bot_id, result, COUNT(*) AS c FROM games WHERE user_id = ? AND mode = 'rated' GROUP BY bot_id, result`).bind(user.id).all()).results;
  const out = {};
  for (const r of rows) {
    const o = out[r.bot_id] || (out[r.bot_id] = { w: 0, d: 0, l: 0 });
    o[r.result === 'win' ? 'w' : r.result === 'draw' ? 'd' : 'l'] += r.c;
  }
  return json({ records: out });
}

async function postPuzzle(env, req, user) {
  const b = await body(req);
  const pr = num(b.rating, 300, 3500);
  if (pr == null || typeof b.id !== 'string' || b.id.length > 10) fail(400, 'Bad puzzle');
  const ratings = await getRatings(env, user.id);
  const start = ratings.game ? Math.round(ratings.game.r) : 1000;
  const cur = ratings.puzzle || { ...newRating(start, MAX_RD), w: 0, d: 0, l: 0 };
  const next = applyResult(cur, { r: pr, rd: 80 }, b.solved ? 1 : 0);
  next.w = (cur.w || 0) + (b.solved ? 1 : 0);
  next.l = (cur.l || 0) + (b.solved ? 0 : 1);
  next.d = 0;
  await env.DB.batch([
    putRating(env, user.id, 'puzzle', next),
    env.DB.prepare('INSERT INTO puzzle_log (user_id, created_at, puzzle_id, puzzle_rating, solved, r_after) VALUES (?, ?, ?, ?, ?, ?)').bind(user.id, Date.now(), b.id, pr, b.solved ? 1 : 0, next.r),
  ]);
  return json({ ratings: await getRatings(env, user.id) });
}

async function changePassword(env, req, user) {
  const b = await body(req);
  const u = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(user.id).first();
  if (!u || typeof b.old !== 'string' || !safeEqual(await hashPassword(b.old, u.pw_salt, u.pw_iter), u.pw_hash)) fail(403, 'Your current password is not right.');
  const pp = passwordProblem(b.password);
  if (pp) fail(400, pp);
  await setPassword(env, user.id, b.password, user.tokenHash);
  return json({ ok: true });
}

async function setPassword(env, userId, pw, keepTokenHash) {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  const saltB64 = b64(salt);
  const hash = await hashPassword(pw, saltB64, PBKDF2_ITER);
  await env.DB.batch([
    env.DB.prepare('UPDATE users SET pw_hash = ?, pw_salt = ?, pw_iter = ? WHERE id = ?').bind(hash, saltB64, PBKDF2_ITER, userId),
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').bind(userId, keepTokenHash || ''),
  ]);
}

function deleteUserStmts(env, userId) {
  return ['sessions', 'ratings', 'games', 'puzzle_log', 'profile'].map((t) => env.DB.prepare(`DELETE FROM ${t} WHERE user_id = ?`).bind(userId))
    .concat([env.DB.prepare('DELETE FROM users WHERE id = ?').bind(userId)]);
}

async function deleteAccount(env, req, user) {
  const b = await body(req);
  const u = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(user.id).first();
  if (!u || typeof b.password !== 'string' || !safeEqual(await hashPassword(b.password, u.pw_salt, u.pw_iter), u.pw_hash)) fail(403, 'Wrong password.');
  await env.DB.batch(deleteUserStmts(env, user.id));
  return json({ ok: true });
}

async function adminUsers(env) {
  const rows = (await env.DB.prepare(`SELECT u.id, u.username, u.created_at, u.last_seen, r.r, r.n AS games
    FROM users u LEFT JOIN ratings r ON r.user_id = u.id AND r.kind = 'game' ORDER BY u.created_at`).all()).results;
  const admins = adminList(env);
  return json({ users: rows.map((u) => ({ ...u, admin: admins.includes(u.username.toLowerCase()) })) });
}

// ---------- router ----------

function cors(env, req) {
  const origin = req.headers.get('origin');
  const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const h = { 'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS', 'access-control-allow-headers': 'content-type, authorization', 'access-control-max-age': '86400', vary: 'origin' };
  if (origin && allowed.includes(origin)) h['access-control-allow-origin'] = origin;
  return h;
}

async function handle(env, req) {
  const url = new URL(req.url);
  const p = url.pathname.replace(/\/+$/, '');
  const m = req.method;
  if (p === '/api/health') return json({ ok: true });
  if (p === '/api/signup' && m === 'POST') return signup(env, req);
  if (p === '/api/login' && m === 'POST') return login(env, req);
  if (!p.startsWith('/api/')) fail(404, 'Not found');
  const user = await auth(env, req);
  if (p === '/api/logout' && m === 'POST') {
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(user.tokenHash).run();
    return json({ ok: true });
  }
  if (p === '/api/me' && m === 'GET') return me(env, user);
  if (p === '/api/profile' && m === 'PUT') return putProfile(env, req, user);
  if (p === '/api/rating/init' && m === 'POST') return ratingInit(env, req, user);
  if (p === '/api/games' && m === 'POST') return postGame(env, req, user);
  if (p === '/api/games' && m === 'GET') return listGames(env, url, user);
  let mm = p.match(/^\/api\/games\/(\d+)$/);
  if (mm && m === 'GET') return getGame(env, +mm[1], user);
  if (mm && m === 'PATCH') return patchGame(env, req, +mm[1], user);
  if (p === '/api/history' && m === 'GET') return history(env, user);
  if (p === '/api/records' && m === 'GET') return records(env, user);
  if (p === '/api/puzzles' && m === 'POST') return postPuzzle(env, req, user);
  if (p === '/api/password' && m === 'POST') return changePassword(env, req, user);
  if (p === '/api/account/delete' && m === 'POST') return deleteAccount(env, req, user);
  if (p.startsWith('/api/admin/')) {
    if (!user.admin) fail(403, 'Admins only');
    if (p === '/api/admin/users' && m === 'GET') return adminUsers(env);
    mm = p.match(/^\/api\/admin\/users\/(\d+)\/password$/);
    if (mm && m === 'POST') {
      const b = await body(req);
      const pp = passwordProblem(b.password);
      if (pp) fail(400, pp);
      await setPassword(env, +mm[1], b.password, null);
      return json({ ok: true });
    }
    mm = p.match(/^\/api\/admin\/users\/(\d+)$/);
    if (mm && m === 'DELETE') {
      if (+mm[1] === user.id) fail(400, 'You cannot delete yourself here.');
      await env.DB.batch(deleteUserStmts(env, +mm[1]));
      return json({ ok: true });
    }
  }
  fail(404, 'Not found');
}

export default {
  async fetch(req, env) {
    const ch = cors(env, req);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: ch });
    try {
      const res = await handle(env, req);
      for (const [k, v] of Object.entries(ch)) res.headers.set(k, v);
      return res;
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status, ch);
      console.error(e);
      return json({ error: 'Server error' }, 500, ch);
    }
  },
};

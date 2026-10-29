// API tests against a local `wrangler dev` (default http://127.0.0.1:8787).
// Run: node tools/test-api.mjs [baseUrl]
const BASE = process.argv[2] || 'http://127.0.0.1:8787';
let fails = 0;
const ok = (cond, msg) => { if (cond) console.log('  ok  ' + msg); else { fails++; console.log('  FAIL ' + msg); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(method, path, body, token, origin) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = 'Bearer ' + token;
  if (origin) headers.origin = origin;
  const res = await fetch(BASE + '/api' + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let data = null;
  try { data = await res.json(); } catch (_) {}
  return { status: res.status, data, headers: res.headers };
}

const suffix = Date.now().toString(36).slice(-5);
const name = 'gus_' + suffix;

console.log('signup and login');
let r = await call('POST', '/signup', { username: 'ab', password: 'secret1' });
ok(r.status === 400, 'short username refused');
r = await call('POST', '/signup', { username: 'sh1t_' + suffix, password: 'secret1' });
ok(r.status === 400, 'blocked word refused (look-alike digits)');
r = await call('POST', '/signup', { username: name, password: '123' });
ok(r.status === 400, 'short password refused');
r = await call('POST', '/signup', { username: 'admin', password: 'secret12' });
ok(r.status === 400, 'reserved name refused');
r = await call('POST', '/signup', { username: name, password: 'secret12' });
ok(r.status === 200 && r.data.token, 'signup works');
const t1 = r.data.token;
r = await call('POST', '/signup', { username: name.toUpperCase(), password: 'secret12' });
ok(r.status === 409, 'duplicate (any case) refused');
r = await call('POST', '/login', { username: name, password: 'nope123' });
ok(r.status === 401, 'wrong password refused');
r = await call('POST', '/login', { username: name.toUpperCase(), password: 'secret12' });
ok(r.status === 200 && r.data.token, 'login works, case-insensitive');
const t2 = r.data.token;

console.log('me, rating init');
r = await call('GET', '/me', undefined, t1);
ok(r.status === 200 && r.data.user.username === name && r.data.ratings.game === null, 'me returns user, no rating yet');
r = await call('GET', '/me');
ok(r.status === 401, 'me without token is 401');
r = await call('POST', '/rating/init', { r: 800 }, t1);
ok(r.status === 200 && r.data.ratings.game.r === 800 && r.data.ratings.game.rd === 350, 'rating init 800 +/- 350');

console.log('games');
const pgn = '[Event "Rated game"]\n[Result "1-0"]\n\n1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# 1-0';
r = await call('POST', '/games', { mode: 'rated', botId: 'l5', color: 'w', result: 'win', reason: 'checkmate', pgn, plies: 7 }, t1);
ok(r.status === 200 && r.data.game.rated && r.data.game.rAfter > r.data.game.rBefore, 'rated win raises rating (' + Math.round(r.data.game?.rBefore) + ' -> ' + Math.round(r.data.game?.rAfter) + ')');
ok(r.data.ratings.game.n === 1 && r.data.ratings.game.w === 1, 'counts updated');
const gid = r.data.game.id;
r = await call('POST', '/games', { mode: 'rated', botId: 'l5', color: 'b', result: 'loss', reason: 'resignation', pgn, plies: 7 }, t1);
ok(r.status === 429, 'second rated game within 5 s refused');
await sleep(5200);
r = await call('POST', '/games', { mode: 'rated', botId: 'l9', color: 'b', result: 'loss', reason: 'resignation', pgn, plies: 7 }, t1);
ok(r.status === 200 && r.data.game.rAfter < r.data.game.rBefore, 'rated loss lowers rating');
r = await call('POST', '/games', { mode: 'practice', botId: 'max', color: 'w', result: 'draw', reason: 'stalemate', pgn, plies: 7 }, t1);
ok(r.status === 200 && !r.data.game.rated && r.data.ratings.game.n === 2, 'practice game saved, not rated');
r = await call('POST', '/games', { mode: 'rated', botId: 'zzz', color: 'w', result: 'win', pgn }, t1);
ok(r.status === 400, 'unknown bot refused');
r = await call('GET', '/games?limit=10', undefined, t1);
ok(r.status === 200 && r.data.games.length === 3 && !r.data.games[0].pgn, 'list games without PGN');
r = await call('GET', '/games/' + gid, undefined, t1);
ok(r.status === 200 && r.data.game.pgn === pgn, 'get game with PGN');
r = await call('GET', '/games/' + gid, undefined, (await call('POST', '/signup', { username: 'other_' + suffix, password: 'secret12' })).data.token);
ok(r.status === 404, 'other users cannot read it');
r = await call('PATCH', '/games/' + gid, { review: { v: 1, evals: [0, 20], best: ['e2e4'], you: { acc: 81.5, blunders: 1 }, opp: { acc: 60 } } }, t1);
ok(r.status === 200, 'save review');
r = await call('GET', '/games?limit=10', undefined, t1);
ok(r.data.games.find((g) => g.id === gid).review.you.acc === 81.5, 'review summary in list');
r = await call('GET', '/history', undefined, t1);
ok(r.status === 200 && r.data.points.length === 2, 'history has 2 rated points');
r = await call('GET', '/records', undefined, t1);
ok(r.data.records.l5.w === 1 && r.data.records.l9.l === 1, 'records by level');

console.log('puzzles and profile');
r = await call('POST', '/puzzles', { id: 'abc12', rating: 900, solved: true }, t1);
ok(r.status === 200 && r.data.ratings.puzzle.n === 1, 'puzzle rating created');
r = await call('PUT', '/profile', { data: { style: { v: { set: 'merida' }, t: 2000 } } }, t1);
ok(r.status === 200, 'profile write');
r = await call('PUT', '/profile', { data: { style: { v: { set: 'old' }, t: 1000 } } }, t2);
r = await call('GET', '/me', undefined, t2);
ok(r.data.data.style.v.set === 'merida', 'older write does not overwrite newer');

console.log('password and sessions');
r = await call('POST', '/password', { old: 'wrong1', password: 'newpass1' }, t1);
ok(r.status === 403, 'wrong current password refused');
r = await call('POST', '/password', { old: 'secret12', password: 'newpass1' }, t1);
ok(r.status === 200, 'password changed');
r = await call('GET', '/me', undefined, t2);
ok(r.status === 401, 'other session signed out');
r = await call('GET', '/me', undefined, t1);
ok(r.status === 200, 'current session kept');
r = await call('POST', '/login', { username: name, password: 'newpass1' });
ok(r.status === 200, 'login with new password');

console.log('guest import');
r = await call('POST', '/signup', {
  username: 'imp_' + suffix, password: 'secret12',
  guest: { ratings: { game: { r: 950, rd: 120, vol: 0.06, n: 6, w: 3, d: 1, l: 2 } }, games: [{ mode: 'rated', botId: 'l6', color: 'w', result: 'win', reason: 'checkmate', pgn, ts: Date.now() - 1000, rBefore: 900, rAfter: 950, plies: 7 }], puzzles: [{ id: 'zz1', rating: 800, solved: true, ts: Date.now() }], data: { style: { v: { set: 'chessnut' }, t: Date.now() } } },
});
ok(r.status === 200, 'signup with guest data');
const t3 = r.data.token;
r = await call('GET', '/me', undefined, t3);
ok(r.data.ratings.game.r === 950 && r.data.ratings.game.n === 6 && r.data.data.style.v.set === 'chessnut', 'guest rating and settings imported');
r = await call('GET', '/games', undefined, t3);
ok(r.data.games.length === 1 && r.data.games[0].rated, 'guest game imported');

console.log('admin');
const adminName = 'MuellerCodes';
r = await call('POST', '/signup', { username: adminName, password: 'adminpw1' });
let ta = r.data && r.data.token;
if (r.status === 409) ta = (await call('POST', '/login', { username: adminName, password: 'adminpw1' })).data.token;
ok(!!ta, 'admin account ready');
r = await call('GET', '/admin/users', undefined, t1);
ok(r.status === 403, 'non-admin blocked');
r = await call('GET', '/admin/users', undefined, ta);
ok(r.status === 200 && r.data.users.length >= 3, 'admin lists users');
const target = r.data.users.find((u) => u.username === name);
r = await call('POST', `/admin/users/${target.id}/password`, { password: 'reset123' }, ta);
ok(r.status === 200, 'admin sets password');
r = await call('GET', '/me', undefined, t1);
ok(r.status === 401, 'user sessions ended after admin reset');
r = await call('POST', '/login', { username: name, password: 'reset123' });
ok(r.status === 200, 'login with admin-set password');
const t4 = r.data.token;

console.log('cors');
r = await call('GET', '/me', undefined, t4, 'http://localhost:8000');
ok(r.headers.get('access-control-allow-origin') === 'http://localhost:8000', 'allowed origin echoed');
r = await call('GET', '/me', undefined, t4, 'https://evil.example');
ok(!r.headers.get('access-control-allow-origin'), 'other origin not allowed');

console.log('delete');
r = await call('POST', '/account/delete', { password: 'bad' }, t4);
ok(r.status === 403, 'delete needs password');
r = await call('POST', '/account/delete', { password: 'reset123' }, t4);
ok(r.status === 200, 'account deleted');
r = await call('POST', '/login', { username: name, password: 'reset123' });
ok(r.status === 401, 'deleted account cannot log in');

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);

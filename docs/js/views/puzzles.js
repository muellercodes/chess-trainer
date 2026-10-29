// Tactics puzzles from the Lichess puzzle database (CC0), rated with Glicko-2.

import { h, clear, sleep, signed, ICONS } from '../util.js';
import { Board } from '../board.js';
import { Chess, dests, checkSquare, playUci, sanOf } from '../chessutil.js';
import * as store from '../store.js';
import { playMove, playError } from '../sound.js';
import { isProvisional } from '../glicko.js';
import { startGame } from './play.js';
import { clearLiveGame } from './home.js';
import { go } from '../app.js';

const DATA = new URL('../../data/puzzles/', import.meta.url).href;

export const THEMES = [
  ['mateIn1', 'Mate in 1'], ['mateIn2', 'Mate in 2'], ['mateIn3', 'Mate in 3'],
  ['fork', 'Fork'], ['pin', 'Pin'], ['skewer', 'Skewer'], ['hangingPiece', 'Hanging piece'],
  ['discoveredAttack', 'Discovered attack'], ['doubleCheck', 'Double check'], ['backRankMate', 'Back rank mate'],
  ['sacrifice', 'Sacrifice'], ['deflection', 'Deflection'], ['attraction', 'Attraction'], ['trappedPiece', 'Trapped piece'],
  ['capturingDefender', 'Remove the defender'], ['intermezzo', 'In-between move'], ['promotion', 'Promotion'],
  ['defensiveMove', 'Defensive move'], ['quietMove', 'Quiet move'], ['zugzwang', 'Zugzwang'], ['xRayAttack', 'X-ray'],
  ['exposedKing', 'Exposed king'], ['kingsideAttack', 'Kingside attack'], ['endgame', 'Endgame'], ['opening', 'Opening'],
];
const THEME_NAME = Object.fromEntries(THEMES);

const bucketCache = {};
async function bucket(b) {
  if (!bucketCache[b]) {
    bucketCache[b] = fetch(DATA + 'p' + b + '.json').then((r) => (r.ok ? r.json() : [])).catch(() => []);
  }
  return bucketCache[b];
}

const MIN_B = 400;
const MAX_B = 2800;

async function pickPuzzle(target, theme, seen) {
  const center = Math.max(MIN_B, Math.min(MAX_B, Math.floor(target / 100) * 100));
  for (const spread of [150, 300, 600, 1500]) {
    const bs = [];
    for (let b = center - Math.ceil(spread / 100) * 100; b <= center + Math.ceil(spread / 100) * 100; b += 100) if (b >= MIN_B && b <= MAX_B) bs.push(b);
    const lists = await Promise.all(bs.map(bucket));
    const pool = lists.flat().filter((p) => Math.abs(p[3] - target) <= spread && !seen.has(p[0]) && (!theme || p[4].split(' ').includes(theme)));
    if (pool.length) return pool[Math.floor(Math.random() * pool.length)];
  }
  // Everything nearby has been seen: allow repeats.
  const lists = await Promise.all([center - 100, center, center + 100].filter((b) => b >= MIN_B && b <= MAX_B).map(bucket));
  const pool = lists.flat().filter((p) => !theme || p[4].split(' ').includes(theme));
  return pool[Math.floor(Math.random() * pool.length)] || null;
}

export async function render(view, route) {
  let theme = route.params.theme || null;
  const style = store.getStyle();
  let destroyed = false;
  let token = 0;
  let pz = null;
  let chess = null;
  let step = 0;
  let userColor = 'w';
  let state = 'idle';
  let recorded = false;

  const boardEl = h('div');
  const ratingBox = h('div', { class: 'card' });
  const status = h('div', { class: 'status' });
  const after = h('div', { class: 'stack' });
  const controls = h('div', { class: 'btnrow' });
  const themeSel = h('select', { onchange: (e) => { theme = e.target.value || null; history.replaceState(null, '', '#/puzzles' + (theme ? '?theme=' + theme : '')); drawRating(); next(); } },
    h('option', { value: '' }, 'Rated: mixed themes'),
    THEMES.map(([k, n]) => h('option', { value: k, selected: k === theme }, 'Practice: ' + n)));

  view.append(h('div', { class: 'play' },
    h('div', { class: 'boardwrap' }, boardEl),
    h('div', { class: 'side' },
      ratingBox,
      h('label', { class: 'field' }, h('span', null, 'Puzzle type'), themeSel),
      status, controls, after,
      h('p', { class: 'muted small' }, 'Puzzles come from the Lichess puzzle database (public domain).'))));

  const board = new Board(boardEl, {
    coords: style.coords, showDests: style.dests, autoQueen: style.autoQueen,
    onMove: (f, t, p) => onMove(f, t, p),
  });

  function drawRating(delta) {
    clear(ratingBox);
    const pr = store.puzzleRating();
    ratingBox.append(
      h('div', { class: 'muted small' }, theme ? 'Practice mode (does not change your rating)' : 'Puzzle rating'),
      h('div', { class: 'bignum' }, Math.round(pr.r) + (isProvisional(pr) ? '?' : ''),
        delta != null ? h('span', { class: delta >= 0 ? 'cls-best' : 'cls-blun', style: { fontSize: '1.1rem', marginLeft: '8px' } }, signed(delta)) : null),
      h('div', { class: 'muted small' }, `Today: ${store.daily().puzzles} solved or tried`));
  }

  function setControls(list) { clear(controls); controls.append(...list); }

  async function next() {
    const t = ++token;
    state = 'loading';
    recorded = false;
    clear(after);
    board.setArrows([]);
    board.setMarks({});
    setControls([]);
    status.textContent = 'Loading...';
    const pr = store.puzzleRating();
    const seen = new Set(store.getData('pseen', []));
    const p = await pickPuzzle(Math.round(pr.r), theme, seen);
    if (t !== token || destroyed) return;
    if (!p) { status.textContent = 'No puzzles found for that choice.'; return; }
    pz = { id: p[0], fen: p[1], moves: p[2].split(' '), rating: p[3], themes: p[4].split(' ') };
    chess = new Chess(pz.fen);
    userColor = chess.turn() === 'w' ? 'b' : 'w';
    board.setOrientation(userColor === 'w' ? 'white' : 'black');
    board.setPosition(pz.fen, { lastMove: null, check: checkSquare(chess), animate: false });
    board.setMovable(null);
    status.textContent = '';
    await sleep(500);
    if (t !== token || destroyed) return;
    const first = playUci(chess, pz.moves[0]);
    playMove(first.san);
    board.setPosition(chess.fen(), { lastMove: [first.from, first.to], check: checkSquare(chess) });
    step = 1;
    state = 'playing';
    status.textContent = `Your turn. Find the best move for ${userColor === 'w' ? 'White' : 'Black'}.`;
    board.setMovable({ color: userColor, dests: dests(chess) });
    setControls([
      h('button', { class: 'btn', onclick: showSolution }, 'View the solution'),
      h('button', { class: 'btn', title: 'Flip board', onclick: () => board.flip(), html: ICONS.flip }),
    ]);
  }

  async function record(solved) {
    if (recorded || !pz) return;
    recorded = true;
    if (theme) {
      const seen = store.getData('pseen', []);
      if (!seen.includes(pz.id)) store.setData('pseen', [...seen, pz.id].slice(-3000));
      store.bumpDaily('puzzles');
      drawRating();
      return;
    }
    const before = store.puzzleRating().r;
    try {
      const r = await store.recordPuzzle({ id: pz.id, rating: pz.rating, solved });
      if (!destroyed) drawRating(r.r - before);
    } catch (e) { status.textContent += ' (Could not save: ' + e.message + ')'; }
  }

  async function onMove(from, to, promo) {
    if (state !== 'playing') return;
    const expected = pz.moves[step];
    let mv;
    try { mv = chess.move({ from, to, promotion: promo }); } catch (_) { board.setPosition(chess.fen()); board.setMovable({ color: userColor, dests: dests(chess) }); return; }
    const ok = mv.lan === expected || chess.isCheckmate();
    if (!ok) {
      playError();
      state = 'failed';
      board.setPosition(chess.fen(), { lastMove: [mv.from, mv.to], check: checkSquare(chess) });
      board.setMarks({ [mv.to]: 'wrong' });
      status.textContent = `${mv.san} is not it.`;
      chess.undo();
      record(false);
      setControls([
        h('button', { class: 'btn', onclick: retry }, 'Try again'),
        h('button', { class: 'btn', onclick: showSolution }, 'View the solution'),
        h('button', { class: 'btn primary', onclick: next }, 'Next puzzle'),
      ]);
      showInfo();
      return;
    }
    playMove(mv.san);
    board.setPosition(chess.fen(), { lastMove: [mv.from, mv.to], check: checkSquare(chess) });
    board.setMarks({ [mv.to]: 'good' });
    step++;
    if (step >= pz.moves.length || chess.isCheckmate()) { solved(); return; }
    status.textContent = 'Correct. Keep going.';
    board.setMovable(null);
    const t = token;
    await sleep(450);
    if (t !== token || destroyed) return;
    const reply = playUci(chess, pz.moves[step]);
    playMove(reply.san);
    step++;
    board.setMarks({});
    board.setPosition(chess.fen(), { lastMove: [reply.from, reply.to], check: checkSquare(chess) });
    board.setMovable({ color: userColor, dests: dests(chess) });
    status.textContent = 'Your move.';
  }

  function retry() {
    // Unrated second try from where it went wrong.
    state = 'playing';
    board.setMarks({});
    board.setPosition(chess.fen(), { check: checkSquare(chess) });
    board.setMovable({ color: userColor, dests: dests(chess) });
    status.textContent = 'Try again (this one already counted).';
  }

  function solved() {
    state = 'done';
    board.setMovable(null);
    status.textContent = recorded ? 'Solved.' : 'Solved. Well done.';
    record(true);
    setControls([h('button', { class: 'btn primary', onclick: next }, 'Next puzzle'), h('button', { class: 'btn', onclick: analyse }, 'Analyze')]);
    showInfo();
  }

  async function showSolution() {
    if (!pz) return;
    record(false);
    state = 'solution';
    board.setMovable(null);
    board.setMarks({});
    const t = token;
    status.textContent = 'Solution:';
    const sans = [];
    while (step < pz.moves.length) {
      const u = pz.moves[step];
      board.setArrows([{ from: u.slice(0, 2), to: u.slice(2, 4) }]);
      await sleep(700);
      if (t !== token || destroyed) return;
      const m = playUci(chess, u);
      sans.push(m.san);
      playMove(m.san);
      board.setArrows([]);
      board.setPosition(chess.fen(), { lastMove: [m.from, m.to], check: checkSquare(chess) });
      status.textContent = 'Solution: ' + sans.join(' ');
      step++;
      await sleep(400);
    }
    setControls([h('button', { class: 'btn primary', onclick: next }, 'Next puzzle'), h('button', { class: 'btn', onclick: analyse }, 'Analyze')]);
    showInfo();
  }

  function showInfo() {
    clear(after);
    const names = pz.themes.map((t) => THEME_NAME[t]).filter(Boolean);
    after.append(h('div', { class: 'card small' },
      h('div', { class: 'kv' }, h('span', { class: 'muted' }, 'Puzzle rating'), h('span', null, pz.rating)),
      names.length ? h('div', { class: 'kv' }, h('span', { class: 'muted' }, 'Themes'), h('span', null, names.join(', '))) : null,
      h('div', { class: 'kv' }, h('span', { class: 'muted' }, 'Lichess'), h('a', { href: 'https://lichess.org/training/' + pz.id, target: '_blank', rel: 'noopener' }, '#' + pz.id))));
  }

  async function analyse() {
    if (!(await clearLiveGame())) return;
    const c = new Chess(pz.fen);
    playUci(c, pz.moves[0]);
    startGame({ mode: 'free', color: userColor, startFen: c.fen(), evalBar: true });
  }

  drawRating();
  next();

  return () => { destroyed = true; token++; board.destroy(); };
}

// Game review: engine analysis of every position, move classification, accuracy,
// an evaluation graph, and "retry" on your mistakes.

import { h, clear, toast, fmtDateTime, svgEl, ICONS } from '../util.js';
import { Board } from '../board.js';
import { Chess, dests, checkSquare, endInfo, sanOf, lineSan, START_FEN, playUci } from '../chessutil.js';
import { anaEngine, winPct, cpOf } from '../engine.js';
import { botById, botName } from '../bots.js';
import { analyseMoves, summarize, SYMBOL, CLS, ARROW, T_INACC } from '../analysis.js';
import * as store from '../store.js';
import { startGame } from './play.js';
import { clearLiveGame } from './home.js';
import { go } from '../app.js';

const DEPTH = 12;

export async function render(view, route) {
  const id = route.args[0];
  view.appendChild(h('p', { class: 'muted' }, 'Loading game...'));
  let game;
  try { game = await store.getGame(id); } catch (e) { clear(view).append(h('div', { class: 'card' }, h('p', null, e.message))); return; }
  if (!game || !game.pgn) { clear(view).append(h('div', { class: 'card' }, h('p', null, 'Game not found.'))); return; }
  clear(view);

  const c = new Chess();
  try { c.loadPgn(game.pgn); } catch (e) { view.append(h('div', { class: 'card' }, h('p', null, 'Could not read this game: ' + e.message))); return; }
  const moves = c.history({ verbose: true });
  const startFen = moves.length ? moves[0].before : (game.startFen || START_FEN);
  const fens = [startFen, ...moves.map((m) => m.after)];
  const you = game.color;
  const bot = botById(game.botId);

  let destroyed = false;
  let ply = moves.length;
  let review = game.review && game.review.evals && game.review.evals.length === fens.length ? game.review : null;
  let info = null;
  let retry = null;

  // ---- layout ----
  const boardEl = h('div');
  const progress = h('div', { class: 'progress' }, h('div'));
  const progressBox = h('div', { class: 'card' }, h('div', { class: 'small muted', style: { marginBottom: '6px' } }, 'Analyzing your game...'), progress);
  const graph = svgEl('svg', { class: 'graph', viewBox: '0 0 100 40', preserveAspectRatio: 'none' });
  const summaryBox = h('div', { class: 'card' });
  const comment = h('div', { class: 'status' });
  const movesEl = h('div', { class: 'moves' });
  const keyBox = h('div', { class: 'card' });
  const navEl = h('div', { class: 'navbtns' },
    h('button', { class: 'btn', onclick: () => goPly(0) }, '⏮'),
    h('button', { class: 'btn', onclick: () => goPly(ply - 1) }, '◀'),
    h('button', { class: 'btn', onclick: () => goPly(ply + 1) }, '▶'),
    h('button', { class: 'btn', onclick: () => goPly(moves.length) }, '⏭'));
  const tools = h('div', { class: 'btnrow' },
    h('button', { class: 'btn', title: 'Flip board', onclick: () => board.flip(), html: ICONS.flip }),
    h('button', { class: 'btn', onclick: copyPgn }, 'Copy PGN'),
    h('button', { class: 'btn', onclick: playFromHere }, 'Play from here'));

  const result = game.result === 'win' ? 'You won' : game.result === 'loss' ? 'You lost' : 'Draw';
  view.append(
    h('div', { style: { marginBottom: '12px' } },
      h('h1', { style: { marginBottom: '2px' } }, `${result} against ${botName(bot)}`),
      h('div', { class: 'muted small' }, `${fmtDateTime(game.ts)} · ${game.mode === 'rated' ? 'Rated' : 'Practice'} · you had ${you === 'w' ? 'white' : 'black'}${game.reason ? ' · ' + game.reason : ''}`)),
    h('div', { class: 'play' },
      h('div', { class: 'stack' }, h('div', { class: 'boardwrap' }, boardEl), graph),
      h('div', { class: 'side' }, review ? null : progressBox, summaryBox, comment, movesEl, navEl, tools, keyBox)));

  const style = store.getStyle();
  const board = new Board(boardEl, {
    orientation: you === 'b' ? 'black' : 'white',
    coords: style.coords, showDests: style.dests, autoQueen: style.autoQueen,
    onMove: (from, to, promo) => onRetryMove(from, to, promo),
  });
  graph.addEventListener('click', (e) => {
    const r = graph.getBoundingClientRect();
    goPly(Math.round(((e.clientX - r.left) / r.width) * moves.length));
  });

  function onKey(e) {
    if (e.key === 'ArrowLeft') { goPly(ply - 1); e.preventDefault(); }
    if (e.key === 'ArrowRight') { goPly(ply + 1); e.preventDefault(); }
  }
  document.addEventListener('keydown', onKey);

  // ---- analysis ----
  async function analyse() {
    const evals = [];
    const best = [];
    const eng = anaEngine();
    for (let i = 0; i < fens.length; i++) {
      if (destroyed) return null;
      const pos = new Chess(fens[i]);
      const e = endInfo(pos);
      if (e.over) {
        evals.push(e.result === '1-0' ? 10000 : e.result === '0-1' ? -10000 : 0);
        best.push(null);
      } else {
        const r = await eng.analyse(fens[i], { depth: DEPTH });
        if (r.cancelled) return null;
        const cp = r.lines[0] ? cpOf(r.lines[0].score) : 0;
        evals.push(pos.turn() === 'w' ? cp : -cp);
        best.push(r.bestmove);
      }
      progress.firstChild.style.width = Math.round(((i + 1) / fens.length) * 100) + '%';
    }
    const inf = analyseMoves(evals, moves, best);
    return { v: 1, depth: DEPTH, evals, best, you: summarize(inf, you), opp: summarize(inf, you === 'w' ? 'b' : 'w') };
  }

  function drawGraph() {
    while (graph.firstChild) graph.removeChild(graph.firstChild);
    graph.appendChild(svgEl('line', { x1: 0, y1: 20, x2: 100, y2: 20, stroke: '#555', 'stroke-width': 0.3 }));
    if (!review) return;
    const n = Math.max(1, review.evals.length - 1);
    const pts = review.evals.map((cp, i) => [(i / n) * 100, 40 - (winPct(cp) / 100) * 40]);
    const area = 'M0,40 ' + pts.map((p) => 'L' + p[0].toFixed(2) + ',' + p[1].toFixed(2)).join(' ') + ' L100,40 Z';
    graph.appendChild(svgEl('path', { d: area, fill: '#ddd', opacity: 0.85 }));
    info.forEach((m, i) => {
      if (m.color !== you || !m.cls || m.cls === 'inaccuracy') return;
      const p = pts[i + 1];
      graph.appendChild(svgEl('circle', { cx: p[0], cy: p[1], r: 1.2, fill: m.cls === 'blunder' ? '#d4564a' : '#e08a3a' }));
    });
    const x = (ply / n) * 100;
    graph.appendChild(svgEl('line', { x1: x, y1: 0, x2: x, y2: 40, stroke: '#7fa650', 'stroke-width': 0.6 }));
  }

  function drawSummary() {
    clear(summaryBox);
    if (!review) { summaryBox.append(h('p', { class: 'muted' }, 'Summary appears when the analysis finishes.')); return; }
    const row = (label, a, b, cls) => [h('div', { class: cls }, label), h('div', null, a), h('div', null, b)];
    summaryBox.append(h('div', { class: 'acc' },
      h('div'), h('b', null, 'You'), h('b', null, botName(bot)),
      row('Accuracy', review.you.acc + '%', review.opp.acc + '%'),
      row('Inaccuracies', review.you.inacc, review.opp.inacc, 'cls-inacc'),
      row('Mistakes', review.you.mistakes, review.opp.mistakes, 'cls-mist'),
      row('Blunders', review.you.blunders, review.opp.blunders, 'cls-blun')));
  }

  function drawMoves() {
    clear(movesEl);
    const startNum = +startFen.split(' ')[5] || 1;
    const blackFirst = startFen.split(' ')[1] === 'b';
    let row = null;
    moves.forEach((m, i) => {
      const isWhite = m.color === 'w';
      if (isWhite || !row) {
        row = h('div', { class: 'row' }, h('div', { class: 'num' }, startNum + Math.floor((i + (blackFirst ? 1 : 0)) / 2) + '.'));
        movesEl.appendChild(row);
        if (!isWhite) row.appendChild(h('div', { class: 'mv' }, '...'));
      }
      const mi = info && info[i];
      row.appendChild(h('div', { class: 'mv' + (i + 1 === ply ? ' cur' : ''), onclick: () => goPly(i + 1) },
        m.san, mi && mi.cls ? h('span', { class: 'sym ' + CLS[mi.cls] }, SYMBOL[mi.cls]) : null));
    });
    const cur = movesEl.querySelector('.cur');
    if (cur) cur.scrollIntoView({ block: 'nearest' });
  }

  function drawKey() {
    clear(keyBox);
    keyBox.append(h('h3', null, 'Your key moments'));
    if (!info) { keyBox.append(h('p', { class: 'muted small' }, 'Waiting for the analysis...')); return; }
    const list = info.map((m, i) => ({ ...m, i })).filter((m) => m.color === you && (m.cls === 'blunder' || m.cls === 'mistake'));
    if (!list.length) { keyBox.append(h('p', { class: 'muted' }, 'No mistakes or blunders. Nice game.')); return; }
    keyBox.append(h('p', { class: 'muted small' }, 'Click one to see it, then try to find the better move.'));
    for (const m of list) {
      const mv = moves[m.i];
      const num = Math.floor(m.i / 2) + 1;
      keyBox.append(h('div', { class: 'kv' },
        h('a', { href: 'javascript:void 0', onclick: () => goPly(m.i + 1) },
          `${num}${mv.color === 'w' ? '.' : '...'} ${mv.san}`, h('span', { class: 'sym ' + CLS[m.cls] }, SYMBOL[m.cls])),
        h('button', { class: 'btn small', onclick: () => startRetry(m.i) }, 'Retry')));
    }
  }

  function moveComment(i) {
    if (!info || i < 0) return '';
    const m = info[i];
    const mv = moves[i];
    const bestSan = m.best ? sanOf(mv.before, m.best) : null;
    const who = mv.color === you ? '' : botName(bot) + ': ';
    if (m.isBest) return who + mv.san + ' is the engine\'s top move.';
    if (!m.cls) return who + mv.san + ' is fine.' + (bestSan && m.loss >= T_INACC / 2 ? ' ' + bestSan + ' was a bit better.' : '');
    const word = m.cls === 'blunder' ? 'Blunder' : m.cls === 'mistake' ? 'Mistake' : 'Inaccuracy';
    const ev = review.evals[i + 1];
    return `${who}${word}. ${mv.san} drops the winning chances by ${Math.round(m.loss)}%. ${bestSan ? 'Best was ' + bestSan + '.' : ''}` + (Math.abs(ev) >= 9000 ? ' There is a forced mate now.' : '');
  }

  function evalText(i) {
    if (!review) return '';
    const cp = review.evals[i];
    if (Math.abs(cp) >= 9000) return cp > 0 ? 'White mates' : 'Black mates';
    return (cp > 0 ? '+' : '') + (cp / 100).toFixed(1);
  }

  function goPly(p) {
    retry = null;
    ply = Math.max(0, Math.min(moves.length, p));
    const fen = fens[ply];
    const pos = new Chess(fen);
    const last = ply ? [moves[ply - 1].from, moves[ply - 1].to] : null;
    board.setPosition(fen, { lastMove: last, check: checkSquare(pos) });
    board.setMovable(null);
    board.setMarks({});
    const arrows = [];
    if (info && ply > 0) {
      const m = info[ply - 1];
      if (m.cls) arrows.push({ from: moves[ply - 1].from, to: moves[ply - 1].to, color: ARROW[m.cls] });
      if (m.cls && m.best) arrows.push({ from: m.best.slice(0, 2), to: m.best.slice(2, 4) });
    }
    board.setArrows(arrows);
    comment.textContent = ply === 0 ? 'Start of the game.' : (info ? moveComment(ply - 1) + (review ? '  (' + evalText(ply) + ')' : '') : moves[ply - 1].san);
    drawMoves();
    drawGraph();
  }

  // ---- retry a mistake ----
  function startRetry(i) {
    goPly(i);
    const fen = fens[i];
    const pos = new Chess(fen);
    retry = { i, fen, tries: 0 };
    board.setArrows([]);
    board.setMovable({ color: pos.turn(), dests: dests(pos) });
    comment.textContent = `Your move. In the game you played ${moves[i].san}. Find something better.`;
  }

  async function onRetryMove(from, to, promo) {
    if (!retry) return;
    const pos = new Chess(retry.fen);
    let mv;
    try { mv = pos.move({ from, to, promotion: promo }); } catch (_) { board.setPosition(retry.fen); board.setMovable({ color: pos.turn(), dests: dests(pos) }); return; }
    board.setPosition(pos.fen(), { lastMove: [from, to], check: checkSquare(pos) });
    comment.textContent = 'Checking...';
    const best = review.best[retry.i];
    const sign = mv.color === 'w' ? 1 : -1;
    const before = winPct(sign * review.evals[retry.i]);
    let after;
    const e = endInfo(pos);
    if (e.over) after = e.result === '1/2-1/2' ? 50 : 100;
    else {
      const r = await anaEngine().analyse(pos.fen(), { depth: DEPTH });
      after = 100 - winPct(r.lines[0] ? cpOf(r.lines[0].score) : 0);
    }
    if (destroyed || !retry) return;
    const loss = mv.lan === best ? 0 : Math.max(0, before - after);
    retry.tries++;
    if (loss < T_INACC) {
      board.setMarks({ [to]: 'good' });
      comment.textContent = `${mv.san} works. ` + (mv.lan === best ? 'That is the engine\'s top move.' : 'The engine liked ' + sanOf(retry.fen, best) + ' a little more.');
      retry = null;
      return;
    }
    board.setMarks({ [to]: 'wrong' });
    if (retry.tries >= 2) {
      comment.textContent = `${mv.san} is not it either. The best move was ${sanOf(retry.fen, best)}.`;
      board.setArrows([{ from: best.slice(0, 2), to: best.slice(2, 4) }]);
      retry = null;
      return;
    }
    comment.textContent = `${mv.san} is not much better. Try once more.`;
    setTimeout(() => {
      if (!retry || destroyed) return;
      const p2 = new Chess(retry.fen);
      board.setPosition(retry.fen, { lastMove: null, check: checkSquare(p2) });
      board.setMarks({});
      board.setMovable({ color: p2.turn(), dests: dests(p2) });
    }, 1100);
  }

  async function copyPgn() {
    try { await navigator.clipboard.writeText(game.pgn); toast('PGN copied'); } catch (_) { toast('Could not copy'); }
  }

  async function playFromHere() {
    if (!(await clearLiveGame())) return;
    startGame({ mode: 'free', color: you, startFen: fens[ply] === START_FEN ? null : fens[ply], evalBar: true });
  }

  // ---- go ----
  if (review) info = analyseMoves(review.evals, moves, review.best);
  drawSummary();
  drawKey();
  goPly(review ? firstMistake() : moves.length);

  function firstMistake() {
    return moves.length;
  }

  if (!review) {
    analyse().then((r) => {
      if (!r || destroyed) return;
      review = r;
      info = analyseMoves(review.evals, moves, review.best);
      progressBox.remove();
      drawSummary();
      drawKey();
      if (!retry) goPly(ply);
      store.saveReview(id, review);
      store.bumpDaily('reviews');
    }).catch((e) => { console.error(e); comment.textContent = 'The analysis stopped: ' + e.message; });
  }

  function cleanup() {
    destroyed = true;
    document.removeEventListener('keydown', onKey);
    anaEngine().cancel();
    board.destroy();
  }
  return cleanup;
}

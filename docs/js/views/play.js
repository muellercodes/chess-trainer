// Playing a game: rated, practice (with coach), drills and the two-sided analysis board.

import { h, clear, sleep, modal, toast, signed, ICONS } from '../util.js';
import { Board } from '../board.js';
import { Chess, dests, legalUcis, checkSquare, playUci, endInfo, resultFor, START_FEN, sanOf, lineSan, sideName } from '../chessutil.js';
import { playEngine, anaEngine, winPct, cpOf } from '../engine.js';
import { botById, botName, chooseBotMove, botAcceptsDraw, MAX_BOT } from '../bots.js';
import * as store from '../store.js';
import { playMove, playEnd, playError } from '../sound.js';
import { go } from '../app.js';
import { isProvisional } from '../glicko.js';
import { T_MISTAKE, T_BLUNDER } from '../analysis.js';

const PIECE_NAME = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };

// cfg: { mode: 'rated'|'practice'|'drill'|'free', botId, color: 'w'|'b', startFen, coach, evalBar, drill, title }
export function startGame(cfg) {
  store.saveCurrent({ id: Date.now().toString(36), cfg, moves: [], startedAt: Date.now() });
  go('/play');
}

export function hasLiveGame() {
  const cur = store.loadCurrent();
  return !!(cur && !cur.over);
}

function pgnDate(ts) {
  const d = new Date(ts);
  return d.getFullYear() + '.' + String(d.getMonth() + 1).padStart(2, '0') + '.' + String(d.getDate()).padStart(2, '0');
}

export async function render(view) {
  let cur = store.loadCurrent();
  if (!cur) { go('/'); return; }
  const cfg = cur.cfg;
  const mode = cfg.mode;
  const bot = mode === 'free' ? null : (botById(cfg.botId) || MAX_BOT);
  const style = store.getStyle();
  const startFen = cfg.startFen || START_FEN;
  let chess;
  try {
    chess = new Chess(startFen);
    for (const u of cur.moves) playUci(chess, u);
  } catch (e) {
    store.clearCurrent();
    toast('That game could not be loaded.');
    go('/');
    return;
  }

  let destroyed = false;
  let token = 0;
  let thinking = false;
  let viewPly = null;
  let over = cur.over || null;
  let coachOn = mode === 'practice' ? cfg.coach !== false : false;
  let evalOn = (mode === 'practice' || mode === 'free') && !!cfg.evalBar;
  let hintStep = 0;
  let userMoves = cur.userMoves || 0;
  let pendingCoach = null;
  const anaCache = new Map();

  // ---------- layout ----------
  const oppCard = h('div', { class: 'player' });
  const youCard = h('div', { class: 'player' });
  const boardEl = h('div');
  const evalFill = h('div', { class: 'fill' });
  const evalTop = h('div', { class: 'lbl top' });
  const evalBot = h('div', { class: 'lbl bot' });
  const evalBar = h('div', { class: 'evalbar' + (evalOn ? '' : ' hidden') }, evalFill, evalTop, evalBot);
  const status = h('div', { class: 'status' });
  const coachBox = h('div', { class: 'coach hidden' });
  const movesEl = h('div', { class: 'moves' });
  const navEl = h('div', { class: 'navbtns' });
  const actions = h('div', { class: 'btnrow' });
  const toggles = h('div', { class: 'btnrow small' });
  const resultBox = h('div', { class: 'card hidden' });
  const titleEl = h('div', { class: 'muted small' }, cfg.title || modeTitle());

  const playGrid = h('div', { class: 'play' },
    h('div', { class: 'stack' },
      oppCard,
      h('div', { class: 'boardcol' }, evalBar, h('div', { class: 'boardwrap' }, boardEl)),
      youCard),
    h('div', { class: 'side' }, titleEl, resultBox, status, coachBox, movesEl, navEl, actions, toggles));
  view.appendChild(playGrid);

  const orientation = (mode === 'free' ? (cfg.color || 'w') : cfg.color) === 'b' ? 'black' : 'white';
  const board = new Board(boardEl, {
    orientation,
    coords: style.coords,
    showDests: style.dests,
    autoQueen: style.autoQueen,
    onMove: (from, to, promo) => onUserMove(from, to, promo),
  });

  function modeTitle() {
    if (mode === 'rated') return store.inPlacement() ? 'Rated game (placement)' : 'Rated game';
    if (mode === 'practice') return 'Practice game';
    if (mode === 'drill') return 'Drill';
    return 'Analysis board';
  }

  function userColor() { return mode === 'free' ? chess.turn() : cfg.color; }
  function isUserTurn() { return mode === 'free' || chess.turn() === cfg.color; }

  function hist() { return chess.history({ verbose: true }); }

  function positionAt(ply) {
    const hs = hist();
    if (ply === 0) return { fen: startFen, last: null };
    const m = hs[ply - 1];
    return { fen: m.after, last: [m.from, m.to] };
  }

  // ---------- rendering ----------
  function renderCards() {
    const r = store.state.ratings.game;
    clear(oppCard); clear(youCard);
    if (mode === 'free') {
      const top = orientation === 'white' ? 'b' : 'w';
      oppCard.append(h('div', null, h('span', { class: 'dot ' + top }), ' ', h('span', { class: 'name' }, sideName(top))));
      youCard.append(h('div', null, h('span', { class: 'dot ' + (top === 'w' ? 'b' : 'w') }), ' ', h('span', { class: 'name' }, sideName(top === 'w' ? 'b' : 'w'))));
      oppCard.classList.toggle('turn', !over && chess.turn() === top);
      youCard.classList.toggle('turn', !over && chess.turn() !== top);
      return;
    }
    const botColor = cfg.color === 'w' ? 'b' : 'w';
    oppCard.append(
      h('div', null,
        h('div', null, h('span', { class: 'dot ' + botColor }), ' ', h('span', { class: 'name' }, botName(bot))),
        h('div', { class: 'sub' }, bot.id === 'max' ? 'Full strength' : 'Rating ' + bot.rating)),
      thinking ? h('span', { class: 'muted small' }, 'thinking...') : null);
    const me = store.state.user ? store.state.user.username : 'You';
    youCard.append(
      h('div', null,
        h('div', null, h('span', { class: 'dot ' + cfg.color }), ' ', h('span', { class: 'name' }, me)),
        mode === 'rated' && r ? h('div', { class: 'sub' }, 'Rating ' + Math.round(r.r) + (isProvisional(r) ? '?' : '')) : null));
    oppCard.classList.toggle('turn', !over && chess.turn() === botColor);
    youCard.classList.toggle('turn', !over && chess.turn() === cfg.color);
  }

  function setStatus(text) { status.textContent = text; }

  function liveStatus() {
    if (over) return;
    if (viewPly != null) { setStatus('Looking at an earlier move. Press the last arrow to go back to the game.'); return; }
    if (mode === 'free') { setStatus(sideName(chess.turn()) + ' to move'); return; }
    if (thinking) setStatus(botName(bot) + ' is thinking...');
    else if (isUserTurn()) setStatus(chess.inCheck() ? 'You are in check. Your move.' : 'Your move');
    else setStatus('');
    if (mode === 'drill' && cfg.drill) {
      const left = cfg.drill.maxMoves - userMoves;
      setStatus(status.textContent + (cfg.drill.goal === 'draw' ? ` (hold for ${Math.max(0, left)} more moves)` : ` (${Math.max(0, left)} moves left)`));
    }
  }

  function sync(animate = true) {
    const live = viewPly == null;
    if (live) {
      const hs = hist();
      const last = hs.length ? [hs[hs.length - 1].from, hs[hs.length - 1].to] : null;
      board.setPosition(chess.fen(), { lastMove: last, check: checkSquare(chess), animate });
      const canMove = !over && !thinking && !pendingCoach && isUserTurn();
      board.setMovable(canMove ? { color: mode === 'free' ? 'both' : cfg.color, dests: dests(chess) } : null);
    } else {
      const p = positionAt(viewPly);
      const c = new Chess(p.fen);
      board.setPosition(p.fen, { lastMove: p.last, check: checkSquare(c), animate });
      board.setMovable(null);
    }
    renderCards();
    renderMoves();
    renderActions();
    liveStatus();
    if (evalOn) updateEval();
  }

  function renderMoves() {
    clear(movesEl);
    const hs = hist();
    if (!hs.length) { movesEl.appendChild(h('div', { class: 'empty' }, 'No moves yet')); return; }
    const startNum = +startFen.split(' ')[5] || 1;
    const blackFirst = startFen.split(' ')[1] === 'b';
    const cur = viewPly == null ? hs.length : viewPly;
    let row = null;
    hs.forEach((m, i) => {
      const ply = i + 1;
      const isWhite = m.color === 'w';
      if (isWhite || !row) {
        const num = startNum + Math.floor((i + (blackFirst ? 1 : 0)) / 2);
        row = h('div', { class: 'row' }, h('div', { class: 'num' }, num + '.'));
        movesEl.appendChild(row);
        if (!isWhite) row.appendChild(h('div', { class: 'mv' }, '...'));
      }
      row.appendChild(h('div', { class: 'mv' + (ply === cur ? ' cur' : ''), onclick: () => showPly(ply) }, m.san));
    });
    const curEl = movesEl.querySelector('.cur');
    if (curEl) curEl.scrollIntoView({ block: 'nearest' });
  }

  function showPly(ply) {
    const n = hist().length;
    ply = Math.max(0, Math.min(n, ply));
    viewPly = ply === n ? null : ply;
    board.setArrows([]);
    sync(true);
  }

  clear(navEl);
  navEl.append(
    h('button', { class: 'btn', title: 'First move', onclick: () => showPly(0) }, '⏮'),
    h('button', { class: 'btn', title: 'Back', onclick: () => showPly((viewPly == null ? hist().length : viewPly) - 1) }, '◀'),
    h('button', { class: 'btn', title: 'Forward', onclick: () => showPly((viewPly == null ? hist().length : viewPly) + 1) }, '▶'),
    h('button', { class: 'btn', title: 'Back to the game', onclick: () => showPly(hist().length) }, '⏭'));

  function onKey(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === 'ArrowLeft') { showPly((viewPly == null ? hist().length : viewPly) - 1); e.preventDefault(); }
    if (e.key === 'ArrowRight') { showPly((viewPly == null ? hist().length : viewPly) + 1); e.preventDefault(); }
    if (e.key === 'f') board.flip();
  }
  document.addEventListener('keydown', onKey);

  function renderActions() {
    clear(actions);
    clear(toggles);
    const flipBtn = h('button', { class: 'btn', title: 'Flip board', onclick: () => board.flip(), html: ICONS.flip });
    if (over) {
      actions.append(flipBtn);
      return;
    }
    if (mode === 'rated') {
      const canAbort = userMoves === 0;
      actions.append(
        canAbort ? h('button', { class: 'btn', onclick: abort }, 'Abort') : h('button', { class: 'btn', onclick: offerDraw, disabled: thinking }, 'Offer draw'),
        canAbort ? null : h('button', { class: 'btn danger', onclick: resign }, 'Resign'),
        flipBtn);
    } else if (mode === 'practice') {
      actions.append(
        h('button', { class: 'btn', onclick: hint, disabled: !isUserTurn() || thinking }, 'Hint'),
        h('button', { class: 'btn', onclick: takeBack, disabled: !userMoves }, 'Take back'),
        h('button', { class: 'btn', onclick: offerDraw, disabled: thinking || !isUserTurn() }, 'Offer draw'),
        h('button', { class: 'btn danger', onclick: resign }, 'Resign'),
        flipBtn);
      toggles.append(
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: coachOn, onchange: (e) => { coachOn = e.target.checked; } }), 'Coach warns me about blunders'),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: evalOn, onchange: (e) => { evalOn = e.target.checked; evalBar.classList.toggle('hidden', !evalOn); if (evalOn) updateEval(); } }), 'Show evaluation'));
    } else if (mode === 'drill') {
      actions.append(
        h('button', { class: 'btn', onclick: hint, disabled: !isUserTurn() || thinking }, 'Hint'),
        h('button', { class: 'btn', onclick: restartDrill }, 'Restart'),
        h('button', { class: 'btn danger', onclick: () => finishDrill(false, 'You gave up') }, 'Give up'),
        flipBtn);
    } else {
      actions.append(
        h('button', { class: 'btn', onclick: bestMoveArrow }, 'Best move'),
        h('button', { class: 'btn', onclick: takeBack, disabled: !hist().length }, 'Take back'),
        h('button', { class: 'btn', onclick: () => go('/editor?fen=' + encodeURIComponent(chess.fen())) }, 'Edit position'),
        flipBtn);
      toggles.append(
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: evalOn, onchange: (e) => { evalOn = e.target.checked; evalBar.classList.toggle('hidden', !evalOn); if (evalOn) updateEval(); } }), 'Show evaluation'),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', onchange: (e) => { cfg.vsBot = e.target.checked; if (cfg.vsBot) maybeBot(); } }), 'Engine plays the other side'));
    }
  }

  // ---------- analysis helpers ----------
  function ana(fen, depth = 13) {
    const key = fen + '|' + depth;
    if (!anaCache.has(key)) {
      anaCache.set(key, anaEngine().analyse(fen, { depth }).then((r) => {
        const l = r.lines[0];
        return { cp: l ? cpOf(l.score) : 0, score: l ? l.score : null, best: r.bestmove, pv: l ? l.pv : [] };
      }));
    }
    return anaCache.get(key);
  }

  let evalToken = 0;
  async function updateEval() {
    const t = ++evalToken;
    const fen = viewPly == null ? chess.fen() : positionAt(viewPly).fen;
    const c = new Chess(fen);
    const e = endInfo(c);
    let whiteCp;
    let label;
    if (e.over) {
      whiteCp = e.result === '1-0' ? 10000 : e.result === '0-1' ? -10000 : 0;
      label = e.result === '1/2-1/2' ? '0.0' : '#';
    } else {
      const a = await ana(fen);
      if (t !== evalToken || destroyed) return;
      whiteCp = c.turn() === 'w' ? a.cp : -a.cp;
      if (a.score && a.score.mate != null) label = 'M' + Math.abs(a.score.mate);
      else label = (Math.abs(whiteCp) / 100).toFixed(1);
    }
    const pct = winPct(whiteCp);
    const flipped = orientation === 'black';
    evalFill.style.height = (flipped ? 100 - pct : pct) + '%';
    evalFill.style.background = flipped ? '#333' : '#eee';
    evalBar.style.background = flipped ? '#eee' : '#333';
    const whiteAhead = whiteCp >= 0;
    evalTop.textContent = (whiteAhead !== !flipped) ? label : '';
    evalBot.textContent = (whiteAhead === !flipped) ? label : '';
    evalTop.style.color = flipped ? '#222' : '#eee';
    evalBot.style.color = flipped ? '#eee' : '#222';
  }

  // ---------- moves ----------
  async function onUserMove(from, to, promo) {
    if (over || viewPly != null) { sync(false); return; }
    const fenBefore = chess.fen();
    let mv;
    try { mv = chess.move({ from, to, promotion: promo }); } catch (_) { playError(); sync(false); return; }
    cur.moves.push(mv.lan);
    if (mode !== 'free') { userMoves++; cur.userMoves = userMoves; }
    store.saveCurrent(cur);
    playMove(mv.san);
    board.setArrows([]);
    hintStep = 0;
    hideCoach();
    sync(true);
    const e = endInfo(chess);
    if (e.over) { finish(e.result, e.reason); return; }
    if (mode === 'drill' && await checkDrillAfterUser(mv)) return;
    if (mode === 'practice' && coachOn) {
      const proceed = await coachCheck(fenBefore, mv);
      if (proceed === 'undo' || destroyed) return;
    }
    if (mode === 'free') { maybeBot(); return; }
    botTurn();
  }

  function maybeBot() {
    if (mode === 'free' && cfg.vsBot && !over) botTurn(MAX_BOT);
  }

  async function botTurn(useBot = bot) {
    if (over || destroyed) return;
    const t = ++token;
    thinking = true;
    sync(false);
    const t0 = Date.now();
    const fen = chess.fen();
    let uci;
    try {
      uci = await chooseBotMove(playEngine(), fen, legalUcis(chess), useBot);
    } catch (e) {
      console.error(e);
      thinking = false;
      setStatus('The engine stopped working. Reload the page to continue this game.');
      return;
    }
    const minWait = useBot.id === 'max' ? 150 : 350 + Math.random() * 450;
    const wait = minWait - (Date.now() - t0);
    if (wait > 0) await sleep(wait);
    if (t !== token || destroyed || over || chess.fen() !== fen) return;
    let mv;
    try { mv = playUci(chess, uci); } catch (e) { console.error('bad bot move', uci, e); thinking = false; sync(false); return; }
    cur.moves.push(mv.lan);
    store.saveCurrent(cur);
    thinking = false;
    playMove(mv.san);
    sync(true);
    const e = endInfo(chess);
    if (e.over) { finish(e.result, e.reason); return; }
    if (mode === 'drill' && checkDrillAfterBot(mv)) return;
    if ((mode === 'practice' && coachOn) || evalOn) ana(chess.fen());
  }

  // ---------- coach (practice) ----------
  function hideCoach() { coachBox.classList.add('hidden'); clear(coachBox); }

  function describeThreat(fenAfter, reply, replyScore) {
    if (replyScore && replyScore.mate != null && replyScore.mate > 0) return 'Your opponent has a checkmate coming.';
    try {
      const c = new Chess(fenAfter);
      const m = playUci(c, reply);
      if (m.captured) return `Your opponent can take your ${PIECE_NAME[m.captured]} on ${m.to}.`;
      if (m.san.includes('+')) return 'Your opponent gets a strong check.';
    } catch (_) { /* ignore */ }
    return 'Your opponent gets a strong reply.';
  }

  async function coachCheck(fenBefore, mv) {
    setStatus('Coach is looking at your move...');
    const t = token;
    const pre = await ana(fenBefore);
    const post = await ana(chess.fen());
    if (destroyed || t !== token) return 'undo';
    const before = winPct(pre.cp);
    const after = 100 - winPct(post.cp);
    const drop = before - after;
    if (mv.lan === pre.best || drop < T_MISTAKE) return true;
    const bestSan = sanOf(fenBefore, pre.best);
    if (drop < T_BLUNDER) {
      coachBox.className = 'coach';
      clear(coachBox).append(h('div', null, h('b', null, 'Inaccurate. '), `${bestSan} was better.`));
      return true;
    }
    coachBox.className = 'coach bad';
    clear(coachBox);
    pendingCoach = true;
    sync(false);
    setStatus('');
    return new Promise((resolve) => {
      const done = (v) => { pendingCoach = null; hideCoach(); board.setArrows([]); resolve(v); };
      coachBox.append(
        h('div', null, h('b', null, 'Careful, that looks like a blunder. '), describeThreat(chess.fen(), post.best, post.score)),
        h('div', { class: 'btnrow', style: { marginTop: '10px' } },
          h('button', { class: 'btn primary', onclick: () => {
            undoPlies(1);
            userMoves = Math.max(0, userMoves - 1);
            cur.userMoves = userMoves;
            store.saveCurrent(cur);
            done('undo');
            sync(false);
          } }, 'Take it back'),
          h('button', { class: 'btn', onclick: () => board.setArrows([{ from: post.best.slice(0, 2), to: post.best.slice(2, 4), color: 'rgba(200,40,30,.85)' }]) }, 'Show the threat'),
          h('button', { class: 'btn', onclick: (e) => { board.setArrows([{ from: pre.best.slice(0, 2), to: pre.best.slice(2, 4) }]); e.target.textContent = 'Better: ' + bestSan; } }, 'Show a better move'),
          h('button', { class: 'btn', onclick: () => { done(true); sync(false); } }, 'Play on')));
    });
  }

  async function hint() {
    if (!isUserTurn() || over) return;
    const a = await ana(chess.fen());
    if (!a.best) return;
    hintStep++;
    if (hintStep === 1) {
      board.setArrows([{ sq: a.best.slice(0, 2), color: 'rgba(21,120,27,.9)' }]);
      setStatus('Hint: look at this piece.');
    } else {
      board.setArrows([{ from: a.best.slice(0, 2), to: a.best.slice(2, 4) }]);
      setStatus('Hint: ' + sanOf(chess.fen(), a.best));
    }
  }

  async function bestMoveArrow() {
    const fen = viewPly == null ? chess.fen() : positionAt(viewPly).fen;
    if (endInfo(new Chess(fen)).over) return;
    setStatus('Thinking...');
    const a = await ana(fen, 16);
    if (destroyed || !a.best) return;
    board.setArrows([{ from: a.best.slice(0, 2), to: a.best.slice(2, 4) }]);
    const line = lineSan(fen, a.pv, 6).join(' ');
    const sc = a.score && a.score.mate != null ? 'mate in ' + Math.abs(a.score.mate) : ((new Chess(fen).turn() === 'w' ? a.cp : -a.cp) / 100).toFixed(2);
    setStatus('Best: ' + line + ' (' + sc + ')');
  }

  function undoPlies(n) {
    for (let i = 0; i < n && hist().length; i++) {
      chess.undo();
      cur.moves.pop();
    }
    store.saveCurrent(cur);
  }

  function takeBack() {
    if (over) return;
    token++;
    thinking = false;
    pendingCoach = null;
    hideCoach();
    board.setArrows([]);
    viewPly = null;
    if (mode === 'free') { undoPlies(1); sync(false); return; }
    // Undo back to the player's turn, removing at least one of the player's moves.
    if (!userMoves) return;
    if (chess.turn() === cfg.color) undoPlies(2); else undoPlies(1);
    userMoves = Math.max(0, userMoves - 1);
    cur.userMoves = userMoves;
    store.saveCurrent(cur);
    sync(false);
  }

  // ---------- endings ----------
  async function resign() {
    if (over) return;
    if (store.getStyle().confirmResign) {
      const ok = await modal({ title: 'Resign?', body: 'This ends the game as a loss.', buttons: [{ label: 'Cancel', value: false }, { label: 'Resign', value: true, danger: true }] });
      if (!ok) return;
    }
    finish(cfg.color === 'w' ? '0-1' : '1-0', 'resignation');
  }

  async function abort() {
    token++;
    store.clearCurrent();
    toast('Game aborted. It does not count.');
    go('/');
  }

  async function offerDraw() {
    if (over || thinking) return;
    setStatus(botName(bot) + ' is considering your offer...');
    const fen = chess.fen();
    const c = new Chess(fen);
    const a = await ana(fen, 12);
    if (destroyed || over) return;
    const forBot = c.turn() === cfg.color ? -a.cp : a.cp;
    if (botAcceptsDraw(forBot, hist().length)) finish('1/2-1/2', 'agreement');
    else { setStatus(botName(bot) + ' declines the draw.'); setTimeout(liveStatus, 2500); }
  }

  function reasonText(res, reason) {
    if (reason === 'checkmate') return res === 'win' ? 'You won by checkmate' : res === 'loss' ? 'Checkmated' : 'Checkmate';
    if (reason === 'resignation') return res === 'loss' ? 'You resigned' : 'Your opponent resigned';
    if (reason === 'agreement') return 'Draw by agreement';
    if (reason === 'abandoned') return 'Game abandoned';
    return 'Draw by ' + reason;
  }

  function makePgn(result) {
    const c = new Chess(startFen);
    for (const u of cur.moves) playUci(c, u);
    const me = store.state.user ? store.state.user.username : 'You';
    const opp = bot ? botName(bot) + (bot.id === 'max' ? '' : ' (' + bot.rating + ')') : '?';
    c.setHeader('Event', modeTitle());
    c.setHeader('Site', 'Chess Trainer');
    c.setHeader('Date', pgnDate(cur.startedAt));
    c.setHeader('White', cfg.color === 'w' ? me : opp);
    c.setHeader('Black', cfg.color === 'b' ? me : opp);
    c.setHeader('Result', result);
    if (cfg.startFen && cfg.startFen !== START_FEN) { c.setHeader('SetUp', '1'); c.setHeader('FEN', cfg.startFen); }
    return c.pgn();
  }

  async function finish(result, reason) {
    if (over && !cur.unsaved) return;
    token++;
    thinking = false;
    over = { result, reason };
    cur.over = over;
    store.saveCurrent(cur);
    playEnd();
    sync(false);
    if (mode === 'drill') { await drillGameEnded(result, reason); return; }
    if (mode === 'free') {
      showResult(result === '1/2-1/2' ? 'Draw' : (result === '1-0' ? 'White' : 'Black') + ' wins', reasonText(null, reason), null);
      store.clearCurrent();
      return;
    }
    const res = resultFor(result, cfg.color);
    let rec = null;
    try {
      rec = await store.recordGame({
        mode, botId: bot.id, color: cfg.color, result: res, reason,
        pgn: makePgn(result), startFen: cfg.startFen && cfg.startFen !== START_FEN ? cfg.startFen : null, plies: hist().length,
      });
      store.clearCurrent();
    } catch (e) {
      cur.unsaved = true;
      store.saveCurrent(cur);
      toast('Could not save the game yet: ' + e.message);
    }
    if (destroyed) return;
    const head = res === 'win' ? 'You won' : res === 'loss' ? 'You lost' : 'Draw';
    showResult(head, reasonText(res, reason), rec);
  }

  function showResult(head, sub, rec) {
    clear(resultBox);
    resultBox.classList.remove('hidden');
    resultBox.append(h('h2', null, head), h('p', { class: 'muted' }, sub));
    if (rec && rec.rAfter != null) {
      const d = rec.rAfter - rec.rBefore;
      const g = store.state.ratings.game;
      resultBox.append(h('p', null, 'Rating ', h('b', null, Math.round(rec.rAfter)), ' ', h('span', { class: d >= 0 ? 'cls-best' : 'cls-blun' }, signed(d))));
      if (g && g.n === store.PLACEMENT_GAMES) {
        resultBox.append(h('p', null, `That was your last placement game. Your starting rating is ${Math.round(g.r)}. It settles further as you play: right now it could be anywhere from ${Math.round(g.r - 2 * g.rd)} to ${Math.round(g.r + 2 * g.rd)}.`));
      } else if (g && g.n < store.PLACEMENT_GAMES) {
        resultBox.append(h('p', { class: 'muted small' }, `Placement game ${g.n} of ${store.PLACEMENT_GAMES}.`));
      }
    }
    const row = h('div', { class: 'btnrow' });
    if (rec && rec.id) row.append(h('a', { class: 'btn primary', href: '#/review/' + rec.id }, 'Review this game'));
    if (mode === 'rated') row.append(h('button', { class: 'btn', onclick: () => go('/?next=rated') }, 'Next rated game'));
    if (mode === 'practice') row.append(h('button', { class: 'btn', onclick: () => startGame({ ...cfg, color: cfg.color }) }, 'Play again'));
    row.append(h('a', { class: 'btn', href: '#/' }, 'Home'));
    resultBox.append(row);
  }

  // ---------- drills ----------
  async function checkDrillAfterUser(mv) {
    const d = cfg.drill;
    if (d.goal === 'promote' && mv.promotion) {
      const a = await ana(chess.fen(), 14);
      if (destroyed) return true;
      if (-a.cp >= 500) { finishDrill(true, 'You promoted and kept a winning position.'); return true; }
    }
    if (d.goal === 'draw' && userMoves >= d.maxMoves) { finishDrill(true, `You held the position for ${d.maxMoves} moves.`); return true; }
    if (d.goal !== 'draw' && userMoves >= d.maxMoves) { finishDrill(false, `Out of moves. The goal was ${d.goal === 'mate' ? 'checkmate' : 'to promote'} within ${d.maxMoves}.`); return true; }
    return false;
  }

  function checkDrillAfterBot(mv) {
    if (cfg.drill.goal === 'draw' && mv.promotion) { finishDrill(false, 'The pawn got through and promoted.'); return true; }
    liveStatus();
    return false;
  }

  async function drillGameEnded(result, reason) {
    const d = cfg.drill;
    const res = resultFor(result, cfg.color);
    if (d.goal === 'draw') { finishDrill(res !== 'loss', res === 'loss' ? 'You were checkmated.' : 'You held the draw by ' + reason + '.'); return; }
    if (res === 'win') finishDrill(true, 'Checkmate in ' + userMoves + ' moves.');
    else finishDrill(false, res === 'draw' ? 'The game was drawn by ' + reason + '.' : 'You lost this one.');
  }

  function finishDrill(ok, text) {
    token++;
    over = over || { result: null, reason: 'drill' };
    store.clearCurrent();
    const d = cfg.drill;
    if (ok) {
      const all = { ...store.getData('drills', {}) };
      const prev = all[d.id];
      all[d.id] = { done: true, best: prev && prev.best ? Math.min(prev.best, userMoves) : userMoves, ts: Date.now() };
      store.setData('drills', all);
      store.bumpDaily('drills');
    }
    sync(false);
    clear(resultBox);
    resultBox.classList.remove('hidden');
    resultBox.append(
      h('h2', null, ok ? 'Drill complete' : 'Not this time'),
      h('p', { class: 'muted' }, text),
      h('div', { class: 'btnrow' },
        h('button', { class: 'btn primary', onclick: restartDrill }, ok ? 'Try again' : 'Retry'),
        h('a', { class: 'btn', href: '#/drills' }, 'All drills')));
  }

  function restartDrill() { startGame({ ...cfg }); }

  // ---------- start ----------
  sync(false);
  if (over) {
    if (cur.unsaved) finish(over.result, over.reason);
    else { store.clearCurrent(); go('/'); }
  } else if (mode !== 'free' && !isUserTurn()) {
    botTurn();
  } else if (evalOn) updateEval();

  return () => {
    destroyed = true;
    token++;
    evalToken++;
    document.removeEventListener('keydown', onKey);
    board.destroy();
    playEngine().cancel();
    anaEngine().cancel();
  };
}

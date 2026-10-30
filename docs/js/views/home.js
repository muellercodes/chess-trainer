import { h, clear, modal, toast, ICONS } from '../util.js';
import * as store from '../store.js';
import { BOTS, MAX_BOT, botById, botName, nearestBot } from '../bots.js';
import { isProvisional } from '../glicko.js';
import { startGame } from './play.js';
import { Chess, replay, endInfo, checkSquare, START_FEN } from '../chessutil.js';
import { Board } from '../board.js';
import { go } from '../app.js';

function coin() { return Math.random() < 0.5 ? 'w' : 'b'; }

// If a game is in progress, ask what to do. Returns true when it is fine to start a new one.
export async function clearLiveGame() {
  const cur = store.loadCurrent();
  if (!cur) return true;
  if (cur.over) {
    if (cur.unsaved) { go('/play'); return false; }
    store.clearCurrent();
    return true;
  }
  const rated = cur.cfg.mode === 'rated' && (cur.userMoves || 0) > 0;
  const bot = botById(cur.cfg.botId);
  const choice = await modal({
    title: 'You have a game in progress',
    body: rated
      ? `Your rated game against ${botName(bot)} is still going. Starting a new game counts it as a loss.`
      : 'Starting a new game ends the one you have going.',
    buttons: [
      { label: 'Go to that game', value: 'continue', primary: true },
      { label: rated ? 'Resign it and start new' : 'End it and start new', value: 'end', danger: true },
    ],
  });
  if (choice === 'continue') { go('/play'); return false; }
  if (choice !== 'end') return false;
  if (rated) {
    try {
      const c = replay(cur.cfg.startFen, cur.moves);
      c.setHeader('Result', cur.cfg.color === 'w' ? '0-1' : '1-0');
      await store.recordGame({
        mode: 'rated', botId: cur.cfg.botId, color: cur.cfg.color, result: 'loss', reason: 'abandoned',
        pgn: c.pgn(), startFen: cur.cfg.startFen || null, plies: cur.moves.length,
      });
    } catch (e) { toast('Could not save that game: ' + e.message); return false; }
  }
  store.clearCurrent();
  return true;
}

export async function startRated(botId) {
  if (!(await clearLiveGame())) return;
  startGame({ mode: 'rated', botId, color: coin() });
}

// Landing page: the board first, with a small panel to start a rated or practice game.
const LEVELS = [
  { label: 'New', r: 400, title: 'I know how the pieces move' },
  { label: 'Casual', r: 800, title: 'I play now and then' },
  { label: 'Regular', r: 1200, title: 'I play a lot, online or with friends' },
  { label: 'Club', r: 1600, title: 'I play in a club or tournaments' },
];

export async function render(view, route) {
  const g = store.state.ratings.game;
  const cur = store.loadCurrent();

  if (route.params.next === 'rated' && g) {
    history.replaceState(null, '', '#/');
    const bot = store.inPlacement() ? nearestBot(g.r) : (botById(store.getData('lastBot')) || nearestBot(g.r));
    startRated(bot.id);
    return;
  }

  const style = store.getStyle();
  const oppCard = h('div', { class: 'player' });
  const youCard = h('div', { class: 'player' });
  const boardEl = h('div');
  const panel = h('div', { class: 'card stack' });
  view.append(h('div', { class: 'play' },
    h('div', { class: 'stack gamecol' }, oppCard, h('div', { class: 'boardwrap' }, boardEl), youCard),
    h('div', { class: 'side' }, panel)));

  const board = new Board(boardEl, { coords: style.coords });
  const me = store.state.user ? store.state.user.username : 'You';

  function cards(opp, sub, color) {
    clear(oppCard).append(h('div', null,
      h('div', null, h('span', { class: 'dot ' + (color === 'w' ? 'b' : 'w') }), ' ', h('span', { class: 'name' }, opp)),
      sub ? h('div', { class: 'sub' }, sub) : null));
    clear(youCard).append(h('div', null,
      h('div', null, h('span', { class: 'dot ' + color }), ' ', h('span', { class: 'name' }, me)),
      g && g.n ? h('div', { class: 'sub' }, 'Rating ' + Math.round(g.r) + (isProvisional(g) ? '?' : '')) : null));
  }

  // A game in progress: show it and offer to continue.
  if (cur && !cur.over) {
    let c;
    try { c = replay(cur.cfg.startFen, cur.moves); } catch (_) { c = new Chess(); }
    const bot = botById(cur.cfg.botId);
    board.setOrientation(cur.cfg.color === 'b' ? 'black' : 'white');
    board.setPosition(c.fen(), { animate: false, check: checkSquare(c) });
    cards(cur.cfg.mode === 'free' ? 'Analysis board' : botName(bot), bot && bot.id !== 'max' ? 'Rating ' + bot.rating : null, cur.cfg.color || 'w');
    panel.append(
      h('h2', null, cur.cfg.mode === 'rated' ? 'Rated game in progress' : 'Game in progress'),
      h('a', { class: 'btn primary big block', href: '#/play' }, 'Continue'),
      h('button', { class: 'btn block', onclick: async () => { if (await clearLiveGame()) go('/'); } }, cur.cfg.mode === 'rated' ? 'Resign and start over' : 'End it'));
    return () => board.destroy();
  }

  board.setPosition(START_FEN, { animate: false });
  let tab = route.name === 'practice' ? 'practice' : (store.getData('homeTab') || 'rated');
  const startFen = route.params.fen || null;
  const records = g && g.n ? await store.botRecords().catch(() => ({})) : {};

  function draw() {
    clear(panel);
    const seg = h('div', { class: 'seg', style: { width: '100%' } },
      [['rated', 'Rated'], ['practice', 'Practice']].map(([v, l]) => h('button', {
        style: { flex: 1 }, class: tab === v ? 'on' : '',
        onclick: () => { tab = v; store.setData('homeTab', v); draw(); },
      }, l)));
    panel.append(seg);
    if (tab === 'rated') drawRated(); else drawPractice();
  }

  function levelSelect(list, selected, onchange) {
    return h('select', { style: { width: '100%' }, onchange: (e) => onchange(e.target.value) },
      list.map((b) => {
        const rec = records[b.id];
        const label = botName(b) + (b.id === 'max' ? ' (full strength)' : ' · ' + b.rating) + (rec ? `  (${rec.w}-${rec.d}-${rec.l})` : '');
        return h('option', { value: b.id, selected: b.id === selected }, label);
      }));
  }

  function drawRated() {
    board.setOrientation('white');
    if (!g) {
      let pick = LEVELS[1];
      const opts = h('div', { class: 'seg', style: { width: '100%' } });
      const drawOpts = () => {
        clear(opts).append(LEVELS.map((l) => h('button', { style: { flex: 1 }, title: l.title, class: l === pick ? 'on' : '', onclick: () => { pick = l; drawOpts(); cards(botName(nearestBot(pick.r)), 'Rating ' + nearestBot(pick.r).rating, 'w'); } }, l.label)));
      };
      drawOpts();
      cards(botName(nearestBot(pick.r)), 'Rating ' + nearestBot(pick.r).rating, 'w');
      panel.append(
        h('div', { class: 'muted small' }, `Your experience (sets the first opponent). ${store.PLACEMENT_GAMES} placement games find your rating.`),
        opts,
        h('button', { class: 'btn primary big block', onclick: async () => {
          try { await store.initRating(pick.r); } catch (e) { toast(e.message); return; }
          startRated(nearestBot(pick.r).id);
        } }, 'Play'),
        h('div', { class: 'muted small' }, 'White or black is a coin flip.'));
      return;
    }
    if (store.inPlacement()) {
      const bot = nearestBot(g.r);
      cards(botName(bot), 'Rating ' + bot.rating, 'w');
      panel.append(
        h('div', null, h('b', null, `Placement game ${g.n + 1} of ${store.PLACEMENT_GAMES}`), h('span', { class: 'muted' }, ' · estimate ' + Math.round(g.r))),
        h('button', { class: 'btn primary big block', onclick: () => startRated(bot.id) }, 'Play'),
        h('div', { class: 'muted small' }, 'White or black is a coin flip.'));
      return;
    }
    let chosen = botById(store.getData('lastBot')) || nearestBot(g.r);
    const show = () => cards(botName(chosen), 'Rating ' + chosen.rating, 'w');
    show();
    panel.append(
      h('div', null, h('span', { class: 'bignum', style: { fontSize: '1.8rem' } }, Math.round(g.r) + (isProvisional(g) ? '?' : '')),
        h('span', { class: 'muted small' }, `  ${Math.round(g.r - 2 * g.rd)} to ${Math.round(g.r + 2 * g.rd)}`)),
      h('label', { class: 'field', style: { margin: 0 } }, h('span', null, 'Opponent'), levelSelect(BOTS, chosen.id, (id) => { chosen = botById(id); show(); })),
      h('button', { class: 'btn primary big block', onclick: () => { store.setData('lastBot', chosen.id); startRated(chosen.id); } }, 'Play'),
      h('div', { class: 'muted small' }, 'White or black is a coin flip.'));
  }

  function drawPractice() {
    let botId = store.getData('practiceBot') || (g ? nearestBot(g.r).id : 'l4');
    let color = store.getData('practiceColor') || 'random';
    let coach = store.getData('practiceCoach') !== false;
    let evalBar = !!store.getData('practiceEval');
    let fen = startFen || START_FEN;
    const scenarios = store.getData('scenarios', []);
    const show = () => {
      const b = botById(botId);
      const pos = new Chess(fen);
      board.setPosition(fen, { animate: false, check: checkSquare(pos) });
      board.setOrientation(color === 'b' ? 'black' : 'white');
      cards(botName(b), b.id === 'max' ? 'Full strength' : 'Rating ' + b.rating, color === 'b' ? 'b' : 'w');
    };
    show();
    const colorSeg = h('div', { class: 'seg', style: { width: '100%' } });
    const drawColor = () => clear(colorSeg).append([['w', 'White'], ['random', 'Random'], ['b', 'Black']].map(([v, l]) =>
      h('button', { style: { flex: 1 }, class: color === v ? 'on' : '', onclick: () => { color = v; store.setData('practiceColor', v); drawColor(); show(); } }, l)));
    drawColor();
    const posSel = h('select', { style: { width: '100%' }, onchange: (e) => { const s = scenarios.find((x) => x.id === e.target.value); fen = s ? s.fen : (startFen || START_FEN); show(); } },
      h('option', { value: '' }, startFen ? 'Position from the link' : 'Standard start'),
      scenarios.map((s) => h('option', { value: s.id }, s.name)));
    panel.append(
      h('label', { class: 'field', style: { margin: 0 } }, h('span', null, 'Opponent'), levelSelect([...BOTS, MAX_BOT], botId, (id) => { botId = id; store.setData('practiceBot', id); show(); })),
      colorSeg,
      h('label', { class: 'field', style: { margin: 0 } }, h('span', null, 'Start from'), posSel),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: coach, onchange: (e) => { coach = e.target.checked; store.setData('practiceCoach', coach); } }), 'Coach warns before blunders'),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: evalBar, onchange: (e) => { evalBar = e.target.checked; store.setData('practiceEval', evalBar); } }), 'Evaluation bar'),
      h('button', { class: 'btn primary big block', onclick: async () => {
        const c = new Chess(fen);
        if (endInfo(c).over) { toast('The game is already over in that position.'); return; }
        if (!(await clearLiveGame())) return;
        const col = color === 'random' ? coin() : color;
        startGame({ mode: 'practice', botId, color: col, startFen: fen === START_FEN ? null : fen, coach, evalBar });
      } }, 'Play'),
      h('div', { class: 'btnrow' },
        h('button', { class: 'btn small', onclick: async () => { if (await clearLiveGame()) startGame({ mode: 'free', color: 'w', startFen: fen === START_FEN ? null : fen, evalBar: false }); } }, 'Analysis board'),
        h('a', { class: 'btn small', href: '#/editor' }, 'Set up a position')));
  }

  draw();
  return () => board.destroy();
}

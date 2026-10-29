import { h, clear, modal, fmtDate, signed, toast } from '../util.js';
import * as store from '../store.js';
import { BOTS, botById, botName, nearestBot } from '../bots.js';
import { STARTS, isProvisional } from '../glicko.js';
import { startGame } from './play.js';
import { replay, START_FEN } from '../chessutil.js';
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

export async function render(view, route) {
  const cur = store.loadCurrent();
  const g = store.state.ratings.game;

  if (route.params.next === 'rated' && g) {
    history.replaceState(null, '', '#/');
    const bot = store.inPlacement() ? nearestBot(g.r) : (botById(store.getData('lastBot')) || nearestBot(g.r));
    startRated(bot.id);
    return;
  }

  const left = h('div', { class: 'stack' });
  const right = h('div', { class: 'stack' });

  if (cur && !cur.over) {
    const bot = botById(cur.cfg.botId);
    view.appendChild(h('div', { class: 'banner' },
      h('span', null, cur.cfg.mode === 'rated' ? `Rated game in progress against ${botName(bot)}.` : cur.cfg.mode === 'free' ? 'You have a board in progress.' : 'You have a game in progress.'),
      h('a', { class: 'btn primary small', href: '#/play' }, 'Continue')));
  }
  if (!store.state.user) {
    view.appendChild(h('div', { class: 'banner' },
      h('span', { class: 'muted' }, 'You are playing as a guest. Progress stays in this browser only.'),
      h('a', { class: 'btn small', href: '#/login' }, 'Sign in or create an account')));
  }

  view.appendChild(h('div', { class: 'home' }, left, right));

  // ---- rating card ----
  const rc = h('div', { class: 'card ratingcard' });
  left.appendChild(rc);
  if (!g) {
    rc.append(
      h('h2', null, 'Find your rating'),
      h('p', null, `Play ${store.PLACEMENT_GAMES} placement games against computer opponents. Each game picks an opponent near your current estimate, and your rating moves after every game. You get white or black by coin flip.`),
      h('p', { class: 'muted' }, 'How much chess have you played? This only sets the first opponent.'),
      h('div', { class: 'stack' }, STARTS.map((s) => h('button', {
        class: 'btn block', style: { justifyContent: 'flex-start' },
        onclick: async () => {
          try { await store.initRating(s.r); } catch (e) { toast(e.message); return; }
          startRated(nearestBot(s.r).id);
        },
      }, s.label))));
  } else if (store.inPlacement()) {
    const bot = nearestBot(g.r);
    rc.append(
      h('h2', null, 'Placement'),
      h('p', null, `Game ${g.n + 1} of ${store.PLACEMENT_GAMES}. Current estimate: `, h('b', null, Math.round(g.r))),
      h('p', { class: 'muted small' }, `Next opponent: ${botName(bot)} (rating ${bot.rating}). Colors are a coin flip.`),
      h('button', { class: 'btn primary big', onclick: () => startRated(bot.id) }, 'Play placement game'));
  } else {
    const prov = isProvisional(g);
    rc.append(
      h('div', { class: 'muted small' }, 'Your rating'),
      h('div', { class: 'bignum' }, Math.round(g.r) + (prov ? '?' : '')),
      h('p', { class: 'muted small' }, prov
        ? `Still settling. Likely between ${Math.round(g.r - 2 * g.rd)} and ${Math.round(g.r + 2 * g.rd)}. The ? goes away after a few more rated games.`
        : `Likely between ${Math.round(g.r - 2 * g.rd)} and ${Math.round(g.r + 2 * g.rd)}. ${g.n} rated games.`));
    const records = await store.botRecords().catch(() => ({}));
    let chosen = botById(store.getData('lastBot')) || nearestBot(g.r);
    const grid = h('div', { class: 'levels' });
    const drawGrid = () => {
      clear(grid);
      for (const b of BOTS) {
        const rec = records[b.id];
        grid.appendChild(h('button', { class: 'level' + (b.id === chosen.id ? ' on' : ''), onclick: () => { chosen = b; drawGrid(); } },
          h('div', { class: 'lv' }, botName(b)),
          h('div', { class: 'rt' }, 'Rating ' + b.rating),
          rec ? h('div', { class: 'rec' }, `${rec.w}W ${rec.d}D ${rec.l}L`) : null));
      }
    };
    drawGrid();
    rc.append(
      h('h3', { style: { marginTop: '14px' } }, 'Rated game'),
      h('p', { class: 'muted small' }, 'Pick an opponent. Beating stronger opponents moves your rating more. White or black is a coin flip.'),
      grid,
      h('div', { class: 'btnrow', style: { marginTop: '12px' } },
        h('button', { class: 'btn primary big', onclick: () => { store.setData('lastBot', chosen.id); startRated(chosen.id); } }, 'Play rated game')));
  }

  left.appendChild(h('div', { class: 'card' },
    h('h2', null, 'Practice'),
    h('p', { class: 'muted' }, 'Unrated games with hints, take-backs and a coach that stops you before blunders. You can also start from any position you set up in the board editor.'),
    h('div', { class: 'btnrow' },
      h('a', { class: 'btn', href: '#/practice' }, 'Practice game'),
      h('button', { class: 'btn', onclick: async () => { if (await clearLiveGame()) startGame({ mode: 'free', color: 'w', evalBar: false }); } }, 'Analysis board'))));

  // ---- training plan ----
  const plan = h('ol', { class: 'plan' });
  right.appendChild(h('div', { class: 'card' }, h('h2', null, 'Training plan'), plan));
  const recentBox = h('div', { class: 'card' }, h('h2', null, 'Recent games'), h('p', { class: 'muted' }, 'Loading...'));
  right.appendChild(recentBox);

  let games = [];
  try { games = await store.listGames(20); } catch (e) { recentBox.lastChild.textContent = e.message; }
  const d = store.daily();
  const items = [];
  if (!g) items.push(['Play your placement games to find your rating.', null]);
  else if (store.inPlacement()) items.push([`Finish your placement games (${g.n} of ${store.PLACEMENT_GAMES} done).`, null]);
  const last = games[0];
  if (last && !last.review) items.push([`Review your last game against ${botName(botById(last.botId))}. Look at the moves where the evaluation dropped.`, '#/review/' + last.id]);
  const reviewed = games.filter((x) => x.review && x.review.you).slice(0, 8);
  if (reviewed.length >= 2) {
    const avgBl = reviewed.reduce((a, x) => a + (x.review.you.blunders || 0), 0) / reviewed.length;
    const avgAcc = reviewed.reduce((a, x) => a + (x.review.you.acc || 0), 0) / reviewed.length;
    if (avgBl >= 1.5) items.push([`You average ${avgBl.toFixed(1)} blunders a game in your last ${reviewed.length} reviewed games. Before each move, ask: what does my opponent's last move attack, and is anything of mine undefended?`, '#/puzzles?theme=hangingPiece']);
    else items.push([`Your recent accuracy is ${Math.round(avgAcc)}%. Tactics puzzles are the fastest way to push it up.`, null]);
  }
  items.push([`Solve 10 puzzles today (${Math.min(d.puzzles, 10)}/10).`, '#/puzzles']);
  const drills = store.getData('drills', {});
  if (Object.keys(drills).length < 3) items.push(['Learn the basic checkmates with king and queen, and king and rook.', '#/drills']);
  if (g && !store.inPlacement()) {
    const next = BOTS.find((b) => b.rating > g.r + 50);
    if (next) items.push([`Next goal: beat ${botName(next)} (rating ${next.rating}) in a rated game.`, null]);
  }
  items.push([`Play at least one rated game today (${Math.min(d.games, 1)}/1).`, null]);
  for (const [text, href] of items) plan.appendChild(h('li', null, href ? h('a', { href }, text) : text));

  clear(recentBox).append(h('h2', null, 'Recent games'));
  if (!games.length) recentBox.append(h('p', { class: 'muted' }, 'No games yet.'));
  else {
    const t = h('table', { class: 'list' });
    for (const x of games.slice(0, 6)) {
      t.appendChild(h('tr', { class: 'click', onclick: () => go('/review/' + x.id) },
        h('td', null, fmtDate(x.ts)),
        h('td', null, botName(botById(x.botId))),
        h('td', null, h('span', { class: 'tag ' + (x.result === 'win' ? 'good' : x.result === 'loss' ? 'bad' : '') }, x.result)),
        h('td', null, x.rated && x.rAfter != null ? signed(x.rAfter - x.rBefore) : h('span', { class: 'muted small' }, x.mode)),
        h('td', { class: 'muted small' }, x.review && x.review.you ? Math.round(x.review.you.acc) + '%' : '')));
    }
    recentBox.append(t, h('p', { style: { marginTop: '8px' } }, h('a', { href: '#/profile' }, 'All games and stats')));
  }
}

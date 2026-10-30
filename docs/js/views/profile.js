import { h, clear, fmtDate, signed, svgEl } from '../util.js';
import * as store from '../store.js';
import { BOTS, botById, botName } from '../bots.js';
import { isProvisional } from '../glicko.js';
import { go } from '../app.js';

function chart(points) {
  const svg = svgEl('svg', { class: 'chart', viewBox: '0 0 600 180', preserveAspectRatio: 'none' });
  if (points.length < 2) return h('p', { class: 'muted' }, 'Play a few rated games to see your rating over time.');
  const rs = points.map((p) => p.r);
  let lo = Math.min(...rs);
  let hi = Math.max(...rs);
  const pad = Math.max(30, (hi - lo) * 0.15);
  lo = Math.floor((lo - pad) / 50) * 50;
  hi = Math.ceil((hi + pad) / 50) * 50;
  const x = (i) => 40 + (i / (points.length - 1)) * 550;
  const y = (r) => 170 - ((r - lo) / (hi - lo)) * 160;
  const step = hi - lo > 600 ? 200 : hi - lo > 300 ? 100 : 50;
  for (let v = lo; v <= hi; v += step) {
    svg.appendChild(svgEl('line', { x1: 40, x2: 590, y1: y(v), y2: y(v), stroke: '#383c43', 'stroke-width': 1 }));
    const t = svgEl('text', { x: 34, y: y(v) + 4, fill: '#9a9ea6', 'font-size': 11, 'text-anchor': 'end' });
    t.textContent = v;
    svg.appendChild(t);
  }
  const d = points.map((p, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ',' + y(p.r).toFixed(1)).join(' ');
  svg.appendChild(svgEl('path', { d, fill: 'none', stroke: '#93bb63', 'stroke-width': 2.2, 'vector-effect': 'non-scaling-stroke' }));
  return svg;
}

function planCard(g, games) {
  const d = store.daily();
  const items = [];
  if (!g) items.push(['Play your placement games to find your rating.', '#/']);
  else if (store.inPlacement()) items.push([`Finish your placement games (${g.n} of ${store.PLACEMENT_GAMES} done).`, '#/']);
  const last = games[0];
  if (last && !last.review) items.push([`Review your last game against ${botName(botById(last.botId))}.`, '#/review/' + last.id]);
  const reviewed = games.filter((x) => x.review && x.review.you).slice(0, 8);
  if (reviewed.length >= 2) {
    const avgBl = reviewed.reduce((a, x) => a + (x.review.you.blunders || 0), 0) / reviewed.length;
    const avgAcc = reviewed.reduce((a, x) => a + (x.review.you.acc || 0), 0) / reviewed.length;
    if (avgBl >= 1.5) items.push([`${avgBl.toFixed(1)} blunders a game lately. Before each move, check what the last move attacks and what you left undefended.`, '#/puzzles?theme=hangingPiece']);
    else items.push([`Recent accuracy ${Math.round(avgAcc)}%. Puzzles push it up fastest.`, '#/puzzles']);
  }
  items.push([`10 puzzles today (${Math.min(d.puzzles, 10)}/10).`, '#/puzzles']);
  if (Object.keys(store.getData('drills', {})).length < 3) items.push(['Learn the basic checkmates.', '#/drills']);
  if (g && !store.inPlacement()) {
    const next = BOTS.find((b) => b.rating > g.r + 50);
    if (next) items.push([`Next goal: beat ${botName(next)} (${next.rating}).`, '#/']);
  }
  return h('div', { class: 'card', style: { marginBottom: '14px' } }, h('h2', null, 'Training plan'),
    h('ol', { class: 'plan' }, items.map(([t, href]) => h('li', null, h('a', { href }, t)))));
}

export async function render(view) {
  const u = store.state.user;
  const g = store.state.ratings.game;
  const p = store.state.ratings.puzzle;

  view.append(h('h1', null, u ? u.username : 'Guest'),
    u ? null : h('div', { class: 'banner' }, h('span', { class: 'muted' }, 'Guest progress lives in this browser only.'), h('a', { class: 'btn small', href: '#/login' }, 'Create an account')));

  const top = h('div', { class: 'grid3' },
    h('div', { class: 'card' },
      h('div', { class: 'muted small' }, 'Game rating'),
      h('div', { class: 'bignum' }, g && g.n ? Math.round(g.r) + (isProvisional(g) ? '?' : '') : '-'),
      g && g.n ? h('div', { class: 'muted small' }, `Range ${Math.round(g.r - 2 * g.rd)} to ${Math.round(g.r + 2 * g.rd)}`) : h('div', { class: 'muted small' }, 'Play placement games to get one')),
    h('div', { class: 'card' },
      h('div', { class: 'muted small' }, 'Rated games'),
      h('div', { class: 'bignum' }, g ? g.n || 0 : 0),
      g && g.n ? h('div', { class: 'muted small' }, `${g.w || 0} won, ${g.d || 0} drawn, ${g.l || 0} lost`) : null),
    h('div', { class: 'card' },
      h('div', { class: 'muted small' }, 'Puzzle rating'),
      h('div', { class: 'bignum' }, p && p.n ? Math.round(p.r) + (isProvisional(p) ? '?' : '') : '-'),
      p && p.n ? h('div', { class: 'muted small' }, `${p.n} puzzles, ${p.w || 0} solved`) : null));
  view.append(top);

  const chartCard = h('div', { class: 'card', style: { marginTop: '14px' } }, h('h2', null, 'Rating history'), h('p', { class: 'muted' }, 'Loading...'));
  const recCard = h('div', { class: 'card' }, h('h2', null, 'Rated record by level'));
  const gamesCard = h('div', { class: 'card' }, h('h2', null, 'Games'));
  view.append(chartCard, h('div', { class: 'grid2', style: { marginTop: '14px' } }, recCard, gamesCard));

  const [points, records, games] = await Promise.all([
    store.ratingHistory().catch(() => []),
    store.botRecords().catch(() => ({})),
    store.listGames(100).catch(() => []),
  ]);

  chartCard.lastChild.replaceWith(chart(points));
  view.insertBefore(planCard(g, games), top);

  const t = h('table', { class: 'list' }, h('tr', null, h('th', null, 'Level'), h('th', null, 'Rating'), h('th', null, 'Won'), h('th', null, 'Drawn'), h('th', null, 'Lost')));
  let any = false;
  for (const b of BOTS) {
    const r = records[b.id];
    if (!r) continue;
    any = true;
    t.appendChild(h('tr', null, h('td', null, botName(b)), h('td', null, b.rating), h('td', null, r.w), h('td', null, r.d), h('td', null, r.l)));
  }
  recCard.append(any ? t : h('p', { class: 'muted' }, 'No rated games yet.'));

  view.append(h('div', { class: 'card', style: { marginTop: '14px' } },
    h('h2', null, 'About these ratings'),
    h('p', { class: 'muted small' }, 'Your game rating comes from rated games against the computer levels, using the Glicko-2 system. Every level has a fixed rating: levels 9 to 16 use Stockfish\'s own strength setting, and levels 1 to 8 were measured in hundreds of computer-vs-computer games against each other and against levels 9 to 12. A win against a level above you raises your rating more than a win against one below. The range shown is where your true rating most likely sits; it narrows as you play.'),
    h('p', { class: 'muted small' }, 'The scale is close to, but not the same as, chess.com or Lichess ratings, which also differ from each other. Use it to track your own progress.')));

  if (!games.length) gamesCard.append(h('p', { class: 'muted' }, 'No games yet.'));
  else {
    const gt = h('table', { class: 'list' }, h('tr', null, h('th', null, 'Date'), h('th', null, 'Opponent'), h('th', null, 'Result'), h('th', null, 'Rating'), h('th', null, 'Accuracy')));
    for (const x of games) {
      gt.appendChild(h('tr', { class: 'click', onclick: () => go('/review/' + x.id) },
        h('td', null, fmtDate(x.ts)),
        h('td', null, botName(botById(x.botId)), ' ', h('span', { class: 'dot ' + x.color, title: 'Your color' })),
        h('td', null, h('span', { class: 'tag ' + (x.result === 'win' ? 'good' : x.result === 'loss' ? 'bad' : '') }, x.result)),
        h('td', null, x.rated && x.rAfter != null ? Math.round(x.rAfter) + ' (' + signed(x.rAfter - x.rBefore) + ')' : h('span', { class: 'muted small' }, 'practice')),
        h('td', null, x.review && x.review.you ? Math.round(x.review.you.acc) + '%' : '')));
    }
    gamesCard.append(gt);
  }
}

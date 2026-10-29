import { h, clear, toast } from '../util.js';
import * as store from '../store.js';
import { BOTS, MAX_BOT, botName, nearestBot } from '../bots.js';
import { startGame } from './play.js';
import { clearLiveGame } from './home.js';
import { Chess, START_FEN, endInfo } from '../chessutil.js';

export async function render(view, route) {
  const g = store.state.ratings.game;
  let botId = store.getData('practiceBot') || (g ? nearestBot(g.r).id : 'l4');
  let color = 'random';
  let fen = route.params.fen || START_FEN;
  let coach = true;
  let evalBar = false;
  const scenarios = store.getData('scenarios', []);

  const grid = h('div', { class: 'levels' });
  const drawGrid = () => {
    clear(grid);
    for (const b of [...BOTS, MAX_BOT]) {
      grid.appendChild(h('button', { class: 'level' + (b.id === botId ? ' on' : ''), onclick: () => { botId = b.id; drawGrid(); } },
        h('div', { class: 'lv' }, botName(b)),
        h('div', { class: 'rt' }, b.id === 'max' ? 'Full strength' : 'Rating ' + b.rating)));
    }
  };
  drawGrid();

  const seg = (opts, get, set) => {
    const box = h('div', { class: 'seg' });
    const draw = () => {
      clear(box);
      for (const [v, label] of opts) box.appendChild(h('button', { class: get() === v ? 'on' : '', onclick: () => { set(v); draw(); } }, label));
    };
    draw();
    return box;
  };

  const fenInput = h('input', { type: 'text', class: 'fenbox', value: fen === START_FEN ? '' : fen, placeholder: 'Standard starting position, or paste a FEN' });
  const scenSel = h('select', { onchange: (e) => { const s = scenarios.find((x) => x.id === e.target.value); fenInput.value = s ? s.fen : ''; } },
    h('option', { value: '' }, 'Standard start'),
    scenarios.map((s) => h('option', { value: s.id, selected: s.fen === fen }, s.name)));
  const err = h('p', { class: 'err' });

  view.appendChild(h('div', { class: 'card', style: { maxWidth: '760px', margin: '0 auto' } },
    h('h1', null, 'Practice game'),
    h('p', { class: 'muted' }, 'Practice games do not change your rating. They are saved so you can review them.'),
    h('h3', null, 'Opponent'), grid,
    h('h3', { style: { marginTop: '16px' } }, 'Your color'),
    seg([['w', 'White'], ['random', 'Random'], ['b', 'Black']], () => color, (v) => { color = v; }),
    h('h3', { style: { marginTop: '16px' } }, 'Starting position'),
    h('div', { class: 'grid2' },
      h('label', { class: 'field' }, h('span', null, 'Saved positions'), scenSel),
      h('label', { class: 'field' }, h('span', null, 'FEN'), fenInput)),
    h('p', { class: 'small muted' }, 'Set up a position in the ', h('a', { href: '#/editor' }, 'board editor'), ' and save it to see it here.'),
    h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: coach, onchange: (e) => { coach = e.target.checked; } }), 'Coach warns me before blunders'),
    h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: evalBar, onchange: (e) => { evalBar = e.target.checked; } }), 'Show the evaluation bar'),
    err,
    h('div', { class: 'btnrow', style: { marginTop: '10px' } },
      h('button', { class: 'btn primary big', onclick: start }, 'Start game'))));

  async function start() {
    const f = fenInput.value.trim() || START_FEN;
    let c;
    try { c = new Chess(f); } catch (e) { err.textContent = 'That FEN is not a legal position: ' + e.message; return; }
    if (endInfo(c).over) { err.textContent = 'The game is already over in that position.'; return; }
    if (!(await clearLiveGame())) return;
    store.setData('practiceBot', botId);
    let col = color === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : color;
    startGame({ mode: 'practice', botId, color: col, startFen: f === START_FEN ? null : f, coach, evalBar });
  }
}

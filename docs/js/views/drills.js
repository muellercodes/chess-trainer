// Endgame drills against full-strength Stockfish.

import { h } from '../util.js';
import * as store from '../store.js';
import { startGame } from './play.js';
import { clearLiveGame } from './home.js';
import { Board } from '../board.js';

// goal: 'mate' = checkmate within maxMoves; 'promote' = promote and keep a winning position;
// 'draw' = do not lose and do not let the pawn promote for maxMoves moves.
export const DRILLS = [
  { id: 'kqk', group: 'Basic checkmates', title: 'King and queen', fen: '8/8/8/4k3/8/8/8/3QK3 w - - 0 1', color: 'w', goal: 'mate', maxMoves: 15,
    desc: 'Push the king to the edge with your queen a knight\'s jump away, bring your own king up, then mate. Watch out for stalemate.' },
  { id: 'krk', group: 'Basic checkmates', title: 'King and rook', fen: '8/8/8/4k3/8/8/8/R3K3 w - - 0 1', color: 'w', goal: 'mate', maxMoves: 30,
    desc: 'Use the rook to fence the king into a smaller and smaller box. Your king has to help.' },
  { id: 'krrk', group: 'Basic checkmates', title: 'Two rooks (the ladder)', fen: '8/8/8/4k3/8/8/8/R3K2R w - - 0 1', color: 'w', goal: 'mate', maxMoves: 12,
    desc: 'The rooks take turns checking and guarding the next rank. Keep them away from the enemy king.' },
  { id: 'kbbk', group: 'Basic checkmates', title: 'Two bishops', fen: '8/8/8/4k3/8/8/8/2B1KB2 w - - 0 1', color: 'w', goal: 'mate', maxMoves: 30,
    desc: 'Side by side, the bishops make a wall. Drive the king to a corner.' },
  { id: 'kbnk', group: 'Basic checkmates', title: 'Bishop and knight (hard)', fen: '8/8/8/4k3/8/8/8/1N2KB2 w - - 0 1', color: 'w', goal: 'mate', maxMoves: 50,
    desc: 'The hardest basic mate. You can only mate in a corner the same color as your bishop.' },
  { id: 'kpk6', group: 'Pawn endings', title: 'King in front of the pawn', fen: '4k3/8/3K4/3P4/8/8/8/8 w - - 0 1', color: 'w', goal: 'promote', maxMoves: 20,
    desc: 'Your king is on the sixth rank in front of its pawn. That always wins. Promote without allowing stalemate.' },
  { id: 'kpkopp', group: 'Pawn endings', title: 'Use the opposition', fen: '8/4k3/8/4K3/4P3/8/8/8 b - - 0 1', color: 'w', goal: 'promote', maxMoves: 25,
    desc: 'Black moves first and has to give way. Get your king to d6, e6 or f6 and the pawn goes through.' },
  { id: 'kpkdef', group: 'Pawn endings', title: 'Hold the draw', fen: '8/8/8/4k3/4P3/4K3/8/8 b - - 0 1', color: 'b', goal: 'draw', maxMoves: 25,
    desc: 'You have the king, they have king and pawn. Stay in front of the pawn and take the opposition when the king comes close.' },
];

export async function render(view) {
  const progress = store.getData('drills', {});
  const groups = [...new Set(DRILLS.map((d) => d.group))];
  view.append(h('h1', null, 'Drills'),
    h('p', { class: 'muted' }, 'Endings every player has to know, against Stockfish at full strength. It always defends as well as possible.'));
  for (const g of groups) {
    const card = h('div', { class: 'card' }, h('h2', null, g));
    const grid = h('div', { class: 'grid3' });
    for (const d of DRILLS.filter((x) => x.group === g)) {
      const p = progress[d.id];
      const mini = h('div', { style: { width: '120px' } });
      grid.append(h('div', { class: 'card', style: { display: 'flex', gap: '12px', alignItems: 'flex-start' } },
        mini,
        h('div', { style: { flex: 1 } },
          h('h3', { style: { marginBottom: '4px' } }, d.title, ' ', p && p.done ? h('span', { class: 'tag good' }, 'done') : null),
          h('p', { class: 'small muted' }, d.desc),
          h('p', { class: 'small' }, goalText(d), p && p.best ? h('span', { class: 'muted' }, ` Best: ${p.best} moves.`) : null),
          h('button', { class: 'btn primary small', onclick: () => start(d) }, p && p.done ? 'Play again' : 'Start'))));
      const b = new Board(mini, { orientation: d.color === 'b' ? 'black' : 'white', coords: false });
      b.setPosition(d.fen, { animate: false });
    }
    card.append(grid);
    view.append(card);
  }
}

function goalText(d) {
  if (d.goal === 'mate') return `Goal: checkmate within ${d.maxMoves} moves.`;
  if (d.goal === 'promote') return `Goal: promote and stay winning within ${d.maxMoves} moves.`;
  return `Goal: hold for ${d.maxMoves} moves.`;
}

async function start(d) {
  if (!(await clearLiveGame())) return;
  startGame({ mode: 'drill', botId: 'max', color: d.color, startFen: d.fen, drill: { id: d.id, goal: d.goal, maxMoves: d.maxMoves }, title: 'Drill: ' + d.title });
}

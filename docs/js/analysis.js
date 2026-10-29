// Move quality: win-chance loss, classification and accuracy (the Lichess formulas).

import { winPct } from './engine.js';

export const T_INACC = 7;
export const T_MISTAKE = 12;
export const T_BLUNDER = 20;

export function classify(loss) {
  if (loss >= T_BLUNDER) return 'blunder';
  if (loss >= T_MISTAKE) return 'mistake';
  if (loss >= T_INACC) return 'inaccuracy';
  return null;
}

export const SYMBOL = { blunder: '??', mistake: '?', inaccuracy: '?!' };
export const CLS = { blunder: 'cls-blun', mistake: 'cls-mist', inaccuracy: 'cls-inacc' };
export const ARROW = { blunder: 'rgba(200,40,30,.85)', mistake: 'rgba(230,130,40,.85)', inaccuracy: 'rgba(225,190,60,.85)' };

export function moveAccuracy(loss) {
  const a = 103.1668 * Math.exp(-0.04354 * Math.max(0, loss)) - 3.1669 + 1;
  return Math.max(0, Math.min(100, a));
}

// evals: white-perspective centipawns for each position (index 0 = before the first move).
// moves: verbose chess.js moves. best: engine best move (UCI) for each position.
export function analyseMoves(evals, moves, best) {
  const out = [];
  for (let i = 0; i < moves.length; i++) {
    const m = moves[i];
    const sign = m.color === 'w' ? 1 : -1;
    const before = winPct(sign * evals[i]);
    const after = winPct(sign * evals[i + 1]);
    const isBest = best[i] && m.lan === best[i];
    const loss = isBest ? 0 : Math.max(0, before - after);
    out.push({ loss, cls: isBest ? null : classify(loss), acc: moveAccuracy(loss), best: best[i], isBest, color: m.color });
  }
  return out;
}

export function summarize(info, color) {
  const mine = info.filter((x) => x.color === color);
  const n = mine.length || 1;
  return {
    acc: Math.round((mine.reduce((a, x) => a + x.acc, 0) / n) * 10) / 10,
    inacc: mine.filter((x) => x.cls === 'inaccuracy').length,
    mistakes: mine.filter((x) => x.cls === 'mistake').length,
    blunders: mine.filter((x) => x.cls === 'blunder').length,
    moves: mine.length,
  };
}

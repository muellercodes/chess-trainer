import { Chess } from '../vendor/chessjs/chess.js';

export { Chess };
export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export function dests(chess) {
  const m = new Map();
  for (const mv of chess.moves({ verbose: true })) {
    if (!m.has(mv.from)) m.set(mv.from, []);
    const arr = m.get(mv.from);
    if (!arr.includes(mv.to)) arr.push(mv.to);
  }
  return m;
}

export function legalUcis(chess) {
  return chess.moves({ verbose: true }).map((m) => m.lan);
}

export function checkSquare(chess) {
  if (!chess.inCheck()) return null;
  const sq = chess.findPiece({ type: 'k', color: chess.turn() });
  return sq && sq[0] ? sq[0] : null;
}

export function playUci(chess, uci) {
  return chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || undefined });
}

export function sanOf(fen, uci) {
  try { const c = new Chess(fen); return playUci(c, uci).san; } catch (_) { return uci; }
}

// Line of UCI moves to SAN from a position (stops at the first illegal move).
export function lineSan(fen, ucis, max = 8) {
  const c = new Chess(fen);
  const out = [];
  for (const u of ucis.slice(0, max)) {
    try { out.push(playUci(c, u).san); } catch (_) { break; }
  }
  return out;
}

// { over, result: '1-0'|'0-1'|'1/2-1/2'|null, reason }
export function endInfo(chess) {
  if (chess.isCheckmate()) return { over: true, result: chess.turn() === 'w' ? '0-1' : '1-0', reason: 'checkmate' };
  if (chess.isStalemate()) return { over: true, result: '1/2-1/2', reason: 'stalemate' };
  if (chess.isInsufficientMaterial()) return { over: true, result: '1/2-1/2', reason: 'insufficient material' };
  if (chess.isThreefoldRepetition()) return { over: true, result: '1/2-1/2', reason: 'threefold repetition' };
  if (chess.isDrawByFiftyMoves()) return { over: true, result: '1/2-1/2', reason: 'the 50-move rule' };
  return { over: false, result: null, reason: null };
}

export function resultFor(result, color) {
  if (result === '1/2-1/2') return 'draw';
  if ((result === '1-0' && color === 'w') || (result === '0-1' && color === 'b')) return 'win';
  return 'loss';
}

// Build a Chess instance from a start FEN and a list of UCI moves.
export function replay(startFen, ucis) {
  const c = new Chess(startFen || START_FEN);
  for (const u of ucis || []) playUci(c, u);
  return c;
}

export function sideName(c) { return c === 'w' ? 'White' : 'Black'; }

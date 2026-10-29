// The bot ladder. Shared by the browser, the calibration script and the Worker.
//
// Levels 1 to 8 sit below Stockfish's lowest calibrated strength (UCI_Elo 1320), so they
// are made weaker on purpose: Stockfish scores the candidate moves at a shallow depth and
// the bot picks among them with a softmax (temperature in centipawns), plus a share of
// purely random moves. Levels 9 and up use Stockfish's own UCI_LimitStrength / UCI_Elo.
//
// The ratings below come from self-play calibration (tools/calibrate), anchored to
// Stockfish's UCI_Elo scale. See README for what that scale means.

export const BOT_RD = 60; // how sure we are about each bot's rating

export const BOTS = [
  { id: 'l1', level: 1, rating: 250, weak: { depth: 1, random: 0.55, temp: 700 } },
  { id: 'l2', level: 2, rating: 400, weak: { depth: 2, random: 0.4, temp: 450 } },
  { id: 'l3', level: 3, rating: 550, weak: { depth: 3, random: 0.28, temp: 320 } },
  { id: 'l4', level: 4, rating: 700, weak: { depth: 4, random: 0.19, temp: 230 } },
  { id: 'l5', level: 5, rating: 850, weak: { depth: 5, random: 0.13, temp: 165 } },
  { id: 'l6', level: 6, rating: 1000, weak: { depth: 6, random: 0.08, temp: 115 } },
  { id: 'l7', level: 7, rating: 1150, weak: { depth: 7, random: 0.05, temp: 80 } },
  { id: 'l8', level: 8, rating: 1300, weak: { depth: 8, random: 0.03, temp: 55 } },
  { id: 'l9', level: 9, rating: 1450, sf: 1450 },
  { id: 'l10', level: 10, rating: 1600, sf: 1600 },
  { id: 'l11', level: 11, rating: 1750, sf: 1750 },
  { id: 'l12', level: 12, rating: 1900, sf: 1900 },
  { id: 'l13', level: 13, rating: 2050, sf: 2050 },
  { id: 'l14', level: 14, rating: 2200, sf: 2200 },
  { id: 'l15', level: 15, rating: 2350, sf: 2350 },
  { id: 'l16', level: 16, rating: 2500, sf: 2500 },
];

// Full strength, used to defend in drills and never rated.
export const MAX_BOT = { id: 'max', level: 0, rating: 3000, full: { depth: 16, movetime: 1500 } };

export function botById(id) {
  if (id === 'max') return MAX_BOT;
  return BOTS.find((b) => b.id === id) || null;
}

export function botName(bot) {
  if (!bot) return 'Unknown';
  if (bot.id === 'max') return 'Stockfish';
  return 'Level ' + bot.level;
}

export function nearestBot(r) {
  let best = BOTS[0];
  for (const b of BOTS) if (Math.abs(b.rating - r) < Math.abs(best.rating - r)) best = b;
  return best;
}

// Stockfish maps UCI_Elo to a fractional skill level and picks its move at depth 1 + level.
export function sfSkillLevel(elo) {
  return Math.max(0, Math.min(19, Math.pow((elo - 1346.6) / 143.4, 1 / 0.806)));
}

export function sfDepth(elo) {
  return Math.max(6, Math.min(22, Math.floor(sfSkillLevel(elo)) + 3));
}

// Engine scores are from the side to move. Turn them into one centipawn number.
export function scoreToCp(score, clip = 2000) {
  if (!score) return 0;
  if (score.mate != null) {
    const m = score.mate;
    if (m === 0) return -clip;
    return m > 0 ? clip + 100 - m : -clip - 100 - m;
  }
  return Math.max(-clip, Math.min(clip, score.cp));
}

// engine.analyse(fen, opts) -> { bestmove, lines: [{ multipv, uci, score: {cp}|{mate}, pv }] }
// legal: array of UCI strings for the side to move.
export async function chooseBotMove(engine, fen, legal, bot, rnd = Math.random) {
  if (legal.length === 1) return legal[0];
  if (bot.full) {
    const r = await engine.analyse(fen, { depth: bot.full.depth, movetime: bot.full.movetime });
    return r.bestmove;
  }
  if (bot.sf) {
    const r = await engine.analyse(fen, { depth: sfDepth(bot.sf), movetime: 5000, limitElo: bot.sf });
    return legal.includes(r.bestmove) ? r.bestmove : legal[Math.floor(rnd() * legal.length)];
  }
  const w = bot.weak;
  if (rnd() < w.random) return legal[Math.floor(rnd() * legal.length)];
  const r = await engine.analyse(fen, { depth: w.depth, multipv: Math.min(legal.length, 50) });
  const cands = r.lines.filter((l) => l.uci && legal.includes(l.uci));
  if (!cands.length) return r.bestmove && legal.includes(r.bestmove) ? r.bestmove : legal[0];
  const scores = cands.map((l) => scoreToCp(l.score, 1500));
  const top = Math.max(...scores);
  const weights = scores.map((s) => Math.exp((s - top) / w.temp));
  const sum = weights.reduce((a, b) => a + b, 0);
  let x = rnd() * sum;
  for (let i = 0; i < cands.length; i++) {
    x -= weights[i];
    if (x <= 0) return cands[i].uci;
  }
  return cands[0].uci;
}

// Does the bot take a draw offer? evalForBot in centipawns from the bot's side.
export function botAcceptsDraw(evalForBot, ply) {
  if (ply < 40) return false;
  return evalForBot <= 25;
}

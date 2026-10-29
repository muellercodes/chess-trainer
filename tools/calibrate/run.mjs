// Bot calibration by self-play.
//
//   node tools/calibrate/run.mjs play [games-per-pair] [workers]   -> appends results to tools/calibrate/results.jsonl
//   node tools/calibrate/run.mjs fit                               -> fits ratings and prints them
//
// Bots 9 to 16 use Stockfish's UCI_Elo and are held at those values (the anchor). Bots 1 to 8 get
// fitted ratings from games against their neighbours, by maximum likelihood on the Elo model.
// It uses the same engine build and the same move-choice code as the website.

import { spawn, fork } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Chess } from '../../docs/vendor/chessjs/chess.js';
import { BOTS, botById, chooseBotMove } from '../../docs/js/bots.js';
import { parseInfo } from '../../docs/js/engine.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ENGINE = path.join(here, '../../docs/vendor/stockfish/stockfish-19-lite-single.js');
const RESULTS = path.join(here, 'results.jsonl');

const OPENINGS = [
  '', 'e2e4 e7e5', 'e2e4 c7c5', 'd2d4 d7d5', 'd2d4 g8f6', 'c2c4 e7e5', 'g1f3 d7d5', 'e2e4 e7e6', 'e2e4 c7c6',
  'e2e4 e7e5 g1f3 b8c6', 'd2d4 d7d5 c2c4 e7e6', 'd2d4 g8f6 c2c4 g7g6', 'e2e4 c7c5 g1f3 d7d6', 'e2e4 d7d5',
  'e2e4 e7e5 f1c4', 'd2d4 d7d5 c1f4', 'b1c3 d7d5', 'e2e4 g7g6', 'c2c4 g8f6', 'g2g3 d7d5',
];

// Pairs to play: neighbours, plus one-apart, plus the weak top against the anchors.
const PAIRS = [
  ['l1', 'l2'], ['l2', 'l3'], ['l3', 'l4'], ['l4', 'l5'], ['l5', 'l6'], ['l6', 'l7'], ['l7', 'l8'],
  ['l1', 'l3'], ['l2', 'l4'], ['l3', 'l5'], ['l4', 'l6'], ['l5', 'l7'], ['l6', 'l8'],
  ['l8', 'l9'], ['l8', 'l10'], ['l7', 'l9'], ['l6', 'l9'],
];

class NodeEngine {
  constructor() {
    this.p = spawn(process.execPath, [ENGINE], { stdio: 'pipe' });
    this.buf = '';
    this.handler = null;
    this.opts = {};
    this.p.stdout.on('data', (d) => {
      this.buf += d;
      let i;
      while ((i = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, i).trim();
        this.buf = this.buf.slice(i + 1);
        if (this.handler) this.handler(line);
      }
    });
  }
  send(c) { this.p.stdin.write(c + '\n'); }
  wait(pred) { return new Promise((res) => { this.handler = (l) => { if (pred(l)) { this.handler = null; res(l); } }; }); }
  async init() { this.send('uci'); await this.wait((l) => l === 'uciok'); this.send('setoption name Hash value 16'); this.send('isready'); await this.wait((l) => l === 'readyok'); }
  setOption(n, v) { v = String(v); if (this.opts[n] === v) return; this.opts[n] = v; this.send(`setoption name ${n} value ${v}`); }
  async newGame() { this.send('ucinewgame'); this.send('isready'); await this.wait((l) => l === 'readyok'); }
  analyse(fen, o = {}) {
    this.setOption('MultiPV', o.multipv || 1);
    this.setOption('UCI_LimitStrength', o.limitElo ? 'true' : 'false');
    if (o.limitElo) this.setOption('UCI_Elo', o.limitElo);
    this.send('position fen ' + fen);
    let go = 'go';
    if (o.depth) go += ' depth ' + o.depth;
    if (o.movetime) go += ' movetime ' + o.movetime;
    if (go === 'go') go += ' depth 12';
    return new Promise((resolve) => {
      const lines = new Map();
      this.handler = (line) => {
        if (line.startsWith('info ')) { const inf = parseInfo(line); if (inf) lines.set(inf.multipv, inf); }
        else if (line.startsWith('bestmove')) {
          this.handler = null;
          const bm = line.split(' ')[1];
          resolve({ bestmove: bm && bm !== '(none)' ? bm : null, lines: [...lines.values()].sort((a, b) => a.multipv - b.multipv) });
        }
      };
      this.send(go);
    });
  }
  quit() { this.send('quit'); this.p.kill(); }
}

function outcome(c) {
  if (c.isCheckmate()) return c.turn() === 'w' ? 0 : 1; // score for white
  if (c.isDraw() || c.isGameOver()) return 0.5;
  return null;
}

async function playGame(eng, white, black, opening) {
  await eng.newGame();
  const c = new Chess();
  for (const u of opening.split(' ').filter(Boolean)) c.move({ from: u.slice(0, 2), to: u.slice(2, 4) });
  for (let ply = 0; ply < 400; ply++) {
    const r = outcome(c);
    if (r != null) return r;
    const bot = c.turn() === 'w' ? white : black;
    const legal = c.moves({ verbose: true }).map((m) => m.lan);
    const u = await chooseBotMove(eng, c.fen(), legal, bot);
    c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] || undefined });
  }
  return 0.5;
}

async function worker() {
  const eng = new NodeEngine();
  await eng.init();
  process.on('message', async (job) => {
    if (job === 'done') { eng.quit(); process.exit(0); }
    const a = botById(job.a); const b = botById(job.b);
    const white = job.aWhite ? a : b; const black = job.aWhite ? b : a;
    const t0 = Date.now();
    const s = await playGame(eng, white, black, job.opening);
    const scoreA = job.aWhite ? s : 1 - s;
    process.send({ a: job.a, b: job.b, aWhite: job.aWhite, scoreA, ms: Date.now() - t0 });
  });
  process.send({ ready: true });
}

async function play(perPair, nWorkers) {
  // Round-robin over pairs so a partial run is still balanced.
  const jobs = [];
  for (let i = 0; i < perPair; i++) {
    for (const [a, b] of PAIRS) jobs.push({ a, b, aWhite: i % 2 === 0, opening: OPENINGS[Math.floor(i / 2) % OPENINGS.length] });
  }
  let next = 0; let done = 0;
  const out = fs.createWriteStream(RESULTS, { flags: 'a' });
  await Promise.all(Array.from({ length: nWorkers }, () => new Promise((resolve) => {
    const w = fork(fileURLToPath(import.meta.url), ['worker']);
    const give = () => { if (next < jobs.length) w.send(jobs[next++]); else { w.send('done'); resolve(); } };
    w.on('message', (m) => {
      if (!m.ready) { out.write(JSON.stringify(m) + '\n'); done++; if (done % 10 === 0) console.log(`${done}/${jobs.length} games`); }
      give();
    });
  })));
  out.end();
}

function fit() {
  const games = fs.readFileSync(RESULTS, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const fixed = Object.fromEntries(BOTS.filter((b) => b.sf).map((b) => [b.id, b.sf]));
  const R = Object.fromEntries(BOTS.map((b) => [b.id, fixed[b.id] ?? b.rating]));
  const prior = Object.fromEntries(BOTS.map((b) => [b.id, b.rating]));
  const K = Math.log(10) / 400;
  for (let it = 0; it < 4000; it++) {
    const grad = {};
    for (const g of games) {
      const E = 1 / (1 + Math.pow(10, (R[g.b] - R[g.a]) / 400));
      const d = (g.scoreA - E) * K;
      grad[g.a] = (grad[g.a] || 0) + d;
      grad[g.b] = (grad[g.b] || 0) - d;
    }
    for (const id of Object.keys(R)) {
      if (id in fixed) continue;
      const gp = (grad[id] || 0) - (R[id] - prior[id]) / (400 * 400); // weak prior
      R[id] += 2000 * gp;
    }
  }
  const tally = {};
  for (const g of games) {
    const k = g.a + '-' + g.b;
    const t = tally[k] || (tally[k] = { n: 0, s: 0 });
    t.n++; t.s += g.scoreA;
  }
  console.log('pair results (score of first bot):');
  for (const [k, t] of Object.entries(tally)) console.log(`  ${k.padEnd(9)} ${t.s}/${t.n}  (${Math.round((100 * t.s) / t.n)}%)`);
  console.log('fitted ratings:');
  for (const b of BOTS) console.log(`  ${b.id.padEnd(4)} ${String(Math.round(R[b.id])).padStart(5)}${b.id in fixed ? '  (anchor)' : ''}`);
  console.log('games:', games.length, ' avg ms/game:', Math.round(games.reduce((a, g) => a + g.ms, 0) / games.length));
}

const cmd = process.argv[2];
if (cmd === 'worker') worker();
else if (cmd === 'play') play(+(process.argv[3] || 20), +(process.argv[4] || 2));
else if (cmd === 'fit') fit();
else console.log('usage: run.mjs play [perPair] [workers] | fit');

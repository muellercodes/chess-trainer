// Stockfish (lite, single-threaded WASM) in a Web Worker, speaking UCI.
// One search at a time per engine; calls queue up.

const ENGINE_URL = new URL('../vendor/stockfish/stockfish-19-lite-single.js', import.meta.url).href;

export function parseInfo(line) {
  if (!line.startsWith('info ') || line.includes(' lowerbound') || line.includes(' upperbound')) return null;
  const t = line.split(' ');
  const o = { multipv: 1 };
  for (let i = 1; i < t.length; i++) {
    const k = t[i];
    if (k === 'depth') o.depth = +t[++i];
    else if (k === 'multipv') o.multipv = +t[++i];
    else if (k === 'score') { const kind = t[++i]; const v = +t[++i]; o.score = kind === 'mate' ? { mate: v } : { cp: v }; }
    else if (k === 'nodes') o.nodes = +t[++i];
    else if (k === 'pv') { o.pv = t.slice(i + 1); break; }
  }
  if (!o.pv || !o.score) return null;
  o.uci = o.pv[0];
  return o;
}

export class Engine {
  constructor() {
    this.worker = null;
    this.ready = null;
    this.queue = Promise.resolve();
    this.opts = {};
    this.handler = null;
    this.generation = 0;
  }

  init() {
    if (this.ready) return this.ready;
    this.ready = new Promise((resolve, reject) => {
      let w;
      try { w = new Worker(ENGINE_URL); } catch (e) { reject(e); return; }
      this.worker = w;
      const timer = setTimeout(() => reject(new Error('Engine did not start')), 30000);
      w.onmessage = (e) => {
        const line = typeof e.data === 'string' ? e.data : String(e.data);
        if (line === 'uciok') { w.postMessage('setoption name Hash value 16'); w.postMessage('isready'); return; }
        if (line === 'readyok' && !this._started) { this._started = true; clearTimeout(timer); resolve(); return; }
        if (this.handler) this.handler(line);
      };
      w.onerror = (e) => { clearTimeout(timer); reject(e); };
      w.postMessage('uci');
    });
    return this.ready;
  }

  post(cmd) { this.worker.postMessage(cmd); }

  setOption(name, value) {
    value = String(value);
    if (this.opts[name] === value) return;
    this.opts[name] = value;
    this.post(`setoption name ${name} value ${value}`);
  }

  _enqueue(fn) {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => {});
    return run;
  }

  // opts: depth, movetime, nodes, multipv, limitElo, onInfo(info)
  analyse(fen, o = {}) {
    const gen = this.generation;
    return this._enqueue(async () => {
      await this.init();
      if (gen !== this.generation) return { bestmove: null, lines: [], cancelled: true };
      this.setOption('MultiPV', o.multipv || 1);
      this.setOption('UCI_LimitStrength', o.limitElo ? 'true' : 'false');
      if (o.limitElo) this.setOption('UCI_Elo', o.limitElo);
      this.post('position fen ' + fen);
      let go = 'go';
      if (o.depth) go += ' depth ' + o.depth;
      if (o.movetime) go += ' movetime ' + o.movetime;
      if (o.nodes) go += ' nodes ' + o.nodes;
      if (go === 'go') go += ' depth 12';
      return await new Promise((resolve) => {
        const lines = new Map();
        this.handler = (line) => {
          if (line.startsWith('info ')) {
            const info = parseInfo(line);
            if (info) {
              lines.set(info.multipv, info);
              if (o.onInfo && info.multipv === 1) o.onInfo(info);
            }
          } else if (line.startsWith('bestmove')) {
            this.handler = null;
            const bm = line.split(' ')[1];
            resolve({
              bestmove: bm && bm !== '(none)' ? bm : null,
              lines: [...lines.values()].sort((a, b) => a.multipv - b.multipv),
            });
          }
        };
        this.post(go);
      });
    });
  }

  // Stop the current search and drop anything queued.
  cancel() {
    this.generation++;
    if (this.handler) this.post('stop');
  }

  newGame() {
    return this._enqueue(async () => {
      await this.init();
      this.post('ucinewgame');
      this.post('isready');
      await new Promise((resolve) => {
        this.handler = (l) => { if (l === 'readyok') { this.handler = null; resolve(); } };
      });
    });
  }

  terminate() {
    if (this.worker) this.worker.terminate();
    this.worker = null;
    this.ready = null;
    this.opts = {};
    this.handler = null;
    this._started = false;
  }
}

let shared = null;
let sharedAna = null;
// One engine for bot moves and one for analysis (coach, review, hints).
export function playEngine() { return shared || (shared = new Engine()); }
export function anaEngine() { return sharedAna || (sharedAna = new Engine()); }

// Win chance (0-100) for the side whose score this is. Lichess formula.
export function winPct(cp) {
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
}

export function cpOf(score) {
  if (!score) return 0;
  if (score.mate != null) return score.mate > 0 ? 10000 - score.mate * 10 : score.mate < 0 ? -10000 - score.mate * 10 : -10000;
  return score.cp;
}

// Chessboard UI: rendering, drag and click moves, promotion picker, arrows, editor mode.
// The board never decides legality. It reports moves with onMove and shows what it is told.

import { h, svgEl } from './util.js';

const FILES = 'abcdefgh';

export function fenToPos(fen) {
  const pos = {};
  const rows = fen.split(' ')[0].split('/');
  for (let r = 0; r < 8; r++) {
    let f = 0;
    for (const ch of rows[r] || '') {
      if (/\d/.test(ch)) f += +ch;
      else {
        const color = ch === ch.toUpperCase() ? 'w' : 'b';
        if (f < 8) pos[FILES[f] + (8 - r)] = color + ch.toUpperCase();
        f++;
      }
    }
  }
  return pos;
}

export function posToBoardFen(pos) {
  const rows = [];
  for (let r = 8; r >= 1; r--) {
    let row = '';
    let empty = 0;
    for (let f = 0; f < 8; f++) {
      const code = pos[FILES[f] + r];
      if (!code) { empty++; continue; }
      if (empty) { row += empty; empty = 0; }
      row += code[0] === 'w' ? code[1] : code[1].toLowerCase();
    }
    if (empty) row += empty;
    rows.push(row);
  }
  return rows.join('/');
}

function sqXY(sq) { return [FILES.indexOf(sq[0]), +sq[1] - 1]; }

export class Board {
  constructor(el, opts = {}) {
    this.el = el;
    this.o = { orientation: 'white', coords: true, showDests: true, autoQueen: false, ...opts };
    el.classList.add('cb');
    el.innerHTML = '';
    this.sqLayer = h('div', { class: 'cb-sq' });
    this.pcLayer = h('div', { class: 'cb-pcs' });
    this.svg = svgEl('svg', { class: 'cb-arrows', viewBox: '0 0 8 8' });
    el.append(this.sqLayer, this.pcLayer, this.svg);
    this.squares = [];
    for (let i = 0; i < 64; i++) {
      const d = document.createElement('div');
      this.squares.push(d);
      this.sqLayer.appendChild(d);
    }
    this.pos = {};
    this.pieces = new Map();
    this.movable = null;
    this.selected = null;
    this.lastMove = null;
    this.check = null;
    this.marks = {};
    this.arrows = [];
    this.drag = null;
    this.layoutSquares();
    this._down = (e) => this.onDown(e);
    this._move = (e) => this.onMove(e);
    this._up = (e) => this.onUp(e);
    this._ctx = (e) => e.preventDefault();
    el.addEventListener('pointerdown', this._down);
    el.addEventListener('pointermove', this._move);
    el.addEventListener('pointerup', this._up);
    el.addEventListener('pointercancel', this._up);
    el.addEventListener('contextmenu', this._ctx);
  }

  destroy() {
    this.el.removeEventListener('pointerdown', this._down);
    this.el.removeEventListener('pointermove', this._move);
    this.el.removeEventListener('pointerup', this._up);
    this.el.removeEventListener('pointercancel', this._up);
    this.el.removeEventListener('contextmenu', this._ctx);
    this.el.innerHTML = '';
  }

  get white() { return this.o.orientation === 'white'; }

  // display coordinates (0..7, 0 = top/left) for a square
  disp(sq) {
    const [f, r] = sqXY(sq);
    return this.white ? [f, 7 - r] : [7 - f, r];
  }

  sqAt(x, y) {
    if (x < 0 || x > 7 || y < 0 || y > 7) return null;
    return this.white ? FILES[x] + (8 - y) : FILES[7 - x] + (y + 1);
  }

  sqFromPoint(cx, cy) {
    const r = this.el.getBoundingClientRect();
    const x = Math.floor(((cx - r.left) / r.width) * 8);
    const y = Math.floor(((cy - r.top) / r.height) * 8);
    return this.sqAt(x, y);
  }

  layoutSquares() {
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const sq = this.sqAt(x, y);
        const d = this.squares[y * 8 + x];
        d.dataset.sq = sq;
        d.innerHTML = '';
        if (this.o.coords) {
          if (y === 7) d.appendChild(h('span', { class: 'cb-coord f' }, sq[0]));
          if (x === 0) d.appendChild(h('span', { class: 'cb-coord r' }, sq[1]));
        }
      }
    }
    this.renderSquares();
  }

  setOrientation(o) {
    if (o === 'w') o = 'white';
    if (o === 'b') o = 'black';
    if (o === this.o.orientation) return;
    this.o.orientation = o;
    this.layoutSquares();
    for (const [sq, el] of this.pieces) this.place(el, sq, false);
    this.renderArrows();
  }

  flip() { this.setOrientation(this.white ? 'black' : 'white'); }

  setCoords(on) { this.o.coords = on; this.layoutSquares(); }

  renderSquares() {
    const dests = this.selected && this.movable && this.movable.dests ? this.movable.dests.get(this.selected) || [] : [];
    for (const d of this.squares) {
      const sq = d.dataset.sq;
      const [f, r] = sqXY(sq);
      let cls = (f + r) % 2 === 1 ? 'l' : 'd';
      if (this.lastMove && (this.lastMove[0] === sq || this.lastMove[1] === sq)) cls += ' last';
      if (this.selected === sq) cls += ' sel';
      if (this.check === sq) cls += ' check';
      if (this.o.showDests && dests.includes(sq)) cls += this.pos[sq] ? ' dest cap' : ' dest';
      if (this.marks[sq]) cls += ' ' + this.marks[sq];
      if (this.drag && this.drag.hover === sq) cls += ' hover';
      d.className = cls;
    }
  }

  makePiece(code) {
    const el = document.createElement('div');
    el.className = 'pc ' + code;
    el.dataset.code = code;
    this.pcLayer.appendChild(el);
    return el;
  }

  place(el, sq, animate) {
    const [x, y] = this.disp(sq);
    const t = `translate(${x * 100}%, ${y * 100}%)`;
    if (animate) {
      el.classList.add('anim');
      requestAnimationFrame(() => { el.style.transform = t; });
      clearTimeout(el._t);
      el._t = setTimeout(() => el.classList.remove('anim'), 400);
    } else {
      el.classList.remove('anim');
      el.style.transform = t;
    }
  }

  // p: FEN string or {square: code}. opts: lastMove [from,to], check square, animate
  setPosition(p, opts = {}) {
    const next = typeof p === 'string' ? fenToPos(p) : { ...p };
    const old = this.pos;
    this.pos = next;
    if ('lastMove' in opts) this.lastMove = opts.lastMove;
    if ('check' in opts) this.check = opts.check;
    const animate = opts.animate !== false;
    const unused = new Map(this.pieces);
    const out = new Map();
    for (const [sq, code] of Object.entries(next)) {
      if (old[sq] === code && unused.has(sq)) { out.set(sq, unused.get(sq)); unused.delete(sq); }
    }
    const todo = Object.entries(next).filter(([sq]) => !out.has(sq));
    const anim = animate && todo.length <= 3;
    for (const [sq, code] of todo) {
      let cand = null;
      let best = 1e9;
      for (const [osq, el] of unused) {
        if (el.dataset.code !== code) continue;
        const [a, b] = sqXY(osq);
        const [c, d] = sqXY(sq);
        let dist = Math.abs(a - c) + Math.abs(b - d);
        if (this.lastMove && osq === this.lastMove[0]) dist -= 100;
        if (dist < best) { best = dist; cand = osq; }
      }
      let el;
      if (cand && anim) { el = unused.get(cand); unused.delete(cand); this.place(el, sq, true); }
      else { el = this.makePiece(code); this.place(el, sq, false); }
      out.set(sq, el);
    }
    for (const el of unused.values()) el.remove();
    this.pieces = out;
    this.renderSquares();
  }

  // movable: { color: 'w'|'b'|'both'|null, dests: Map<from, to[]> }
  setMovable(m) {
    this.movable = m && m.color ? m : null;
    if (this.selected && !(this.movable && this.movable.dests && this.movable.dests.has(this.selected))) this.selected = null;
    this.renderSquares();
  }

  setMarks(marks) { this.marks = marks || {}; this.renderSquares(); }
  setCheck(sq) { this.check = sq; this.renderSquares(); }
  setLastMove(lm) { this.lastMove = lm; this.renderSquares(); }

  select(sq) { this.selected = sq; this.renderSquares(); }

  canPick(code) {
    if (this.o.editor) return true;
    if (!this.movable) return false;
    const c = this.movable.color;
    return c === 'both' || c === code[0];
  }

  isDest(from, to) {
    if (!this.movable || !this.movable.dests) return false;
    const d = this.movable.dests.get(from);
    return !!d && d.includes(to);
  }

  onDown(e) {
    if (this.promo) return;
    const sq = this.sqFromPoint(e.clientX, e.clientY);
    if (!sq) return;
    if (e.button === 2) {
      if (this.o.editor && this.pos[sq]) { delete this.pos[sq]; this.setPosition(this.pos, { animate: false }); this.o.onChange && this.o.onChange(this.pos); }
      return;
    }
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    e.preventDefault();
    const code = this.pos[sq];
    if (this.o.editor) {
      if (this.o.editorTool && this.o.editorTool() && this.o.onSquareClick) { this.o.onSquareClick(sq); return; }
      if (code) this.startDrag(sq, e, false);
      else if (this.o.onSquareClick) this.o.onSquareClick(sq);
      return;
    }
    if (this.selected && this.selected !== sq && this.isDest(this.selected, sq)) {
      this.tryMove(this.selected, sq, false);
      return;
    }
    if (code && this.canPick(code)) {
      const was = this.selected === sq;
      this.select(sq);
      this.startDrag(sq, e, was);
      return;
    }
    if (this.selected) this.select(null);
    if (this.o.onSquareClick) this.o.onSquareClick(sq);
  }

  startDrag(sq, e, wasSelected) {
    const el = this.pieces.get(sq);
    if (!el) return;
    this.drag = { sq, el, x: e.clientX, y: e.clientY, started: false, wasSelected, hover: null };
    try { this.el.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
  }

  onMove(e) {
    const d = this.drag;
    if (!d) return;
    if (!d.started) {
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 5) return;
      d.started = true;
      d.el.classList.remove('anim');
      d.el.classList.add('drag');
    }
    const r = this.el.getBoundingClientRect();
    const s = r.width / 8;
    d.el.style.transform = `translate(${e.clientX - r.left - s / 2}px, ${e.clientY - r.top - s / 2}px)`;
    const hov = this.sqFromPoint(e.clientX, e.clientY);
    if (hov !== d.hover) { d.hover = hov; this.renderSquares(); }
  }

  onUp(e) {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    const target = this.sqFromPoint(e.clientX, e.clientY);
    if (!d.started) {
      if (!this.o.editor && d.wasSelected) this.select(null);
      if (this.o.editor && this.o.onSquareClick) this.o.onSquareClick(d.sq);
      this.renderSquares();
      return;
    }
    d.el.classList.remove('drag');
    if (this.o.editor) {
      const code = this.pos[d.sq];
      if (!target) {
        delete this.pos[d.sq];
        d.el.remove();
        this.pieces.delete(d.sq);
      } else if (target !== d.sq) {
        delete this.pos[d.sq];
        this.pos[target] = code;
        this.setPosition(this.pos, { animate: false });
        this.place(this.pieces.get(target), target, false);
      } else this.place(d.el, d.sq, false);
      this.renderSquares();
      this.o.onChange && this.o.onChange(this.pos);
      return;
    }
    if (target && target !== d.sq && this.isDest(d.sq, target)) this.tryMove(d.sq, target, true);
    else { this.place(d.el, d.sq, false); this.renderSquares(); }
  }

  async tryMove(from, to, dropped) {
    const code = this.pos[from];
    let promo;
    if (code && code[1] === 'P' && (to[1] === '8' || to[1] === '1')) {
      if (!dropped) this.place(this.pieces.get(from), from, false);
      promo = this.o.autoQueen ? 'q' : await this.askPromotion(to, code[0]);
      if (!promo) { this.place(this.pieces.get(from), from, false); this.select(null); return; }
    }
    // Show the move right away; the owner will set the real position after it checks the move.
    const el = this.pieces.get(from);
    const victim = this.pieces.get(to);
    if (victim && victim !== el) victim.remove();
    this.pieces.delete(from);
    if (el) { this.pieces.set(to, el); this.place(el, to, !dropped); }
    this.pos = { ...this.pos };
    delete this.pos[from];
    this.pos[to] = promo ? code[0] + promo.toUpperCase() : code;
    if (promo && el) { el.className = 'pc ' + this.pos[to]; el.dataset.code = this.pos[to]; }
    this.lastMove = [from, to];
    this.selected = null;
    this.movable = null;
    this.renderSquares();
    if (this.o.onMove) this.o.onMove(from, to, promo);
  }

  askPromotion(to, color) {
    return new Promise((resolve) => {
      const [x, y] = this.disp(to);
      const dir = y === 0 ? 1 : -1;
      const ov = h('div', { class: 'cb-promo' });
      ['Q', 'N', 'R', 'B'].forEach((p, i) => {
        const opt = h('div', { class: 'opt pi ' + color + p, title: p });
        opt.style.left = x * 12.5 + '%';
        opt.style.top = (y + dir * i) * 12.5 + '%';
        opt.addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); done(p.toLowerCase()); });
        ov.appendChild(opt);
      });
      const done = (v) => { ov.remove(); this.promo = null; resolve(v); };
      ov.addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); done(null); });
      this.promo = ov;
      this.el.appendChild(ov);
    });
  }

  // arrows: [{from, to, color}], circles: [{sq, color}]
  setArrows(arrows) { this.arrows = arrows || []; this.renderArrows(); }

  renderArrows() {
    while (this.svg.firstChild) this.svg.removeChild(this.svg.firstChild);
    for (const a of this.arrows) {
      const color = a.color || 'rgba(21,120,27,.8)';
      if (a.sq) {
        const [x, y] = this.disp(a.sq);
        this.svg.appendChild(svgEl('circle', { cx: x + 0.5, cy: y + 0.5, r: 0.45, fill: 'none', stroke: color, 'stroke-width': 0.08 }));
        continue;
      }
      const [x1, y1] = this.disp(a.from);
      const [x2, y2] = this.disp(a.to);
      const sx = x1 + 0.5; const sy = y1 + 0.5; const ex = x2 + 0.5; const ey = y2 + 0.5;
      const len = Math.hypot(ex - sx, ey - sy);
      if (!len) continue;
      const ux = (ex - sx) / len; const uy = (ey - sy) / len;
      const px = -uy; const py = ux;
      const sw = a.width || 0.16; const hw = 0.42; const hl = 0.42;
      const end = len - 0.18;
      const bx = sx + ux * (end - hl); const by = sy + uy * (end - hl);
      const tx = sx + ux * end; const ty = sy + uy * end;
      const pts = [
        [sx + px * sw / 2, sy + py * sw / 2], [bx + px * sw / 2, by + py * sw / 2], [bx + px * hw / 2, by + py * hw / 2],
        [tx, ty], [bx - px * hw / 2, by - py * hw / 2], [bx - px * sw / 2, by - py * sw / 2], [sx - px * sw / 2, sy - py * sw / 2],
      ];
      this.svg.appendChild(svgEl('polygon', { points: pts.map((p) => p[0].toFixed(3) + ',' + p[1].toFixed(3)).join(' '), fill: color, opacity: a.opacity || 0.85 }));
    }
  }

  // Editor: drag a new piece in from a palette.
  dragNew(code, e) {
    const r = this.el.getBoundingClientRect();
    const s = r.width / 8;
    const ghost = h('div', { class: 'cb-ghost pi ' + code });
    ghost.style.width = ghost.style.height = s + 'px';
    const pos = (ev) => { ghost.style.left = ev.clientX - s / 2 + 'px'; ghost.style.top = ev.clientY - s / 2 + 'px'; };
    pos(e);
    document.body.appendChild(ghost);
    let moved = false;
    const mv = (ev) => { moved = true; pos(ev); };
    const up = (ev) => {
      document.removeEventListener('pointermove', mv);
      document.removeEventListener('pointerup', up);
      document.removeEventListener('pointercancel', up);
      ghost.remove();
      if (!moved) return;
      const sq = this.sqFromPoint(ev.clientX, ev.clientY);
      if (!sq) return;
      this.pos = { ...this.pos, [sq]: code };
      this.setPosition(this.pos, { animate: false });
      this.o.onChange && this.o.onChange(this.pos);
    };
    document.addEventListener('pointermove', mv);
    document.addEventListener('pointerup', up);
    document.addEventListener('pointercancel', up);
  }
}

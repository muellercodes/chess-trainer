// Board editor: set up any position, then play it against the computer, analyze it, or save it.

import { h, clear, toast, modal, uid, ICONS } from '../util.js';
import { Board, fenToPos, posToBoardFen } from '../board.js';
import { Chess, START_FEN, endInfo } from '../chessutil.js';
import { validateFen } from '../../vendor/chessjs/chess.js';
import { BOTS, MAX_BOT, botName, nearestBot } from '../bots.js';
import * as store from '../store.js';
import { startGame } from './play.js';
import { clearLiveGame } from './home.js';

const PALETTE = ['wK', 'wQ', 'wR', 'wB', 'wN', 'wP', null, 'bK', 'bQ', 'bR', 'bB', 'bN', 'bP', 'del'];

export async function render(view, route) {
  const style = store.getStyle();
  const startFen = route.params.fen || START_FEN;
  const parts = startFen.split(' ');
  let pos = fenToPos(startFen);
  let turn = parts[1] === 'b' ? 'b' : 'w';
  let castling = parts[2] && parts[2] !== '-' ? parts[2] : '';
  let ep = parts[3] && parts[3] !== '-' ? parts[3] : '';
  let tool = null;

  const boardEl = h('div');
  const palette = h('div', { class: 'palette' });
  const fenInput = h('input', { type: 'text', class: 'fenbox', spellcheck: false });
  const msg = h('div', { class: 'status' });
  const castleBox = h('div');
  const epSel = h('select', { onchange: (e) => { ep = e.target.value; update(); } });
  const turnSeg = h('div', { class: 'seg' });
  const savedBox = h('div', { class: 'card' });
  const g = store.state.ratings.game;
  const botSel = h('select', null, [...BOTS, MAX_BOT].map((b) => h('option', { value: b.id, selected: g ? b.id === nearestBot(g.r).id : b.id === 'l4' }, botName(b) + (b.id === 'max' ? ' (full strength)' : ' (' + b.rating + ')'))));
  const sideSel = h('select', null, h('option', { value: 'turn' }, 'The side to move'), h('option', { value: 'w' }, 'White'), h('option', { value: 'b' }, 'Black'));
  const playBtn = h('button', { class: 'btn primary', onclick: playIt }, 'Play this position');
  const anaBtn = h('button', { class: 'btn', onclick: analyseIt }, 'Analysis board');
  const saveBtn = h('button', { class: 'btn', onclick: saveIt }, 'Save position');

  view.append(h('div', { class: 'play' },
    h('div', { class: 'stack' }, h('div', { class: 'boardwrap editorwrap' }, boardEl), palette,
      h('p', { class: 'muted small' }, 'Drag pieces from the palette onto the board, or pick one and tap squares. Drag a piece off the board (or right-click it) to remove it.')),
    h('div', { class: 'side' },
      h('div', { class: 'card stack' },
        h('div', { class: 'btnrow' },
          h('button', { class: 'btn small', onclick: () => setFen(START_FEN) }, 'Starting position'),
          h('button', { class: 'btn small', onclick: () => { pos = {}; castling = 'KQkq'; ep = ''; board.setPosition(pos, { animate: false }); update(); } }, 'Clear board'),
          h('button', { class: 'btn small', title: 'Flip board', onclick: () => board.flip(), html: ICONS.flip })),
        h('div', null, h('div', { class: 'small muted', style: { marginBottom: '4px' } }, 'Side to move'), turnSeg),
        h('div', null, h('div', { class: 'small muted', style: { marginBottom: '4px' } }, 'Castling'), castleBox),
        h('label', { class: 'field' }, h('span', null, 'En passant square'), epSel),
        h('label', { class: 'field' }, h('span', null, 'FEN (paste one and press Enter)'), fenInput)),
      msg,
      h('div', { class: 'card stack' },
        h('h3', null, 'Use this position'),
        h('label', { class: 'field' }, h('span', null, 'Opponent'), botSel),
        h('label', { class: 'field' }, h('span', null, 'You play'), sideSel),
        h('div', { class: 'btnrow' }, playBtn, anaBtn, saveBtn)),
      savedBox)));

  const board = new Board(boardEl, {
    editor: true,
    coords: style.coords,
    editorTool: () => tool,
    onChange: (p) => { pos = { ...p }; update(); },
    onSquareClick: (sq) => {
      if (!tool) return;
      if (tool === 'del' || pos[sq] === tool) delete pos[sq];
      else pos[sq] = tool;
      board.setPosition(pos, { animate: false });
      update();
    },
  });
  board.setPosition(pos, { animate: false });

  function drawPalette() {
    clear(palette);
    for (const code of PALETTE) {
      if (!code) { palette.appendChild(h('div', { class: 'tool' + (tool === null ? ' on' : ''), onclick: () => { tool = null; drawPalette(); } }, 'Move')); continue; }
      if (code === 'del') { palette.appendChild(h('div', { class: 'tool' + (tool === 'del' ? ' on' : ''), onclick: () => { tool = tool === 'del' ? null : 'del'; drawPalette(); } }, 'Erase')); continue; }
      const el = h('div', { class: 'p pi ' + code + (tool === code ? ' on' : ''), title: code });
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        const sx = e.clientX; const sy = e.clientY;
        let dragging = false;
        const mv = (ev) => {
          if (!dragging && Math.hypot(ev.clientX - sx, ev.clientY - sy) > 6) {
            dragging = true;
            cleanupListeners();
            board.dragNew(code, ev);
          }
        };
        const up = () => {
          cleanupListeners();
          if (!dragging) { tool = tool === code ? null : code; drawPalette(); }
        };
        const cleanupListeners = () => { document.removeEventListener('pointermove', mv); document.removeEventListener('pointerup', up); };
        document.addEventListener('pointermove', mv);
        document.addEventListener('pointerup', up);
      });
      palette.appendChild(el);
    }
  }

  function setFen(fen) {
    const p = fen.trim().split(/\s+/);
    if (p.length < 1 || p[0].split('/').length !== 8) { msg.textContent = 'That does not look like a FEN.'; return; }
    pos = fenToPos(fen);
    turn = p[1] === 'b' ? 'b' : 'w';
    castling = p[2] && p[2] !== '-' ? p[2] : '';
    ep = p[3] && p[3] !== '-' ? p[3] : '';
    board.setPosition(pos, { animate: false });
    update();
  }

  fenInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') setFen(fenInput.value); });
  fenInput.addEventListener('change', () => setFen(fenInput.value));

  function castleOk(right) {
    const need = { K: ['e1', 'wK', 'h1', 'wR'], Q: ['e1', 'wK', 'a1', 'wR'], k: ['e8', 'bK', 'h8', 'bR'], q: ['e8', 'bK', 'a8', 'bR'] }[right];
    return pos[need[0]] === need[1] && pos[need[2]] === need[3];
  }

  function epOptions() {
    const out = [];
    const rank = turn === 'w' ? '5' : '4';
    const target = turn === 'w' ? '6' : '3';
    const from = turn === 'w' ? '7' : '2';
    const pawn = turn === 'w' ? 'bP' : 'wP';
    const mine = turn === 'w' ? 'wP' : 'bP';
    for (const f of 'abcdefgh') {
      if (pos[f + rank] !== pawn || pos[f + target] || pos[f + from]) continue;
      const left = String.fromCharCode(f.charCodeAt(0) - 1);
      const right = String.fromCharCode(f.charCodeAt(0) + 1);
      if (pos[left + rank] === mine || pos[right + rank] === mine) out.push(f + target);
    }
    return out;
  }

  function currentFen() {
    const c = ['K', 'Q', 'k', 'q'].filter((r) => castling.includes(r) && castleOk(r)).join('') || '-';
    const e = epOptions().includes(ep) ? ep : '-';
    return `${posToBoardFen(pos)} ${turn} ${c} ${e} 0 1`;
  }

  function problems(fen) {
    const list = [];
    const codes = Object.values(pos);
    const count = (c) => codes.filter((x) => x === c).length;
    if (count('wK') !== 1) list.push('White needs exactly one king.');
    if (count('bK') !== 1) list.push('Black needs exactly one king.');
    for (const [sq, code] of Object.entries(pos)) if (code[1] === 'P' && (sq[1] === '1' || sq[1] === '8')) { list.push('Pawns cannot stand on the first or last rank.'); break; }
    if (count('wP') > 8 || count('bP') > 8) list.push('A side cannot have more than 8 pawns.');
    if (list.length) return list;
    const v = validateFen(fen);
    if (!v.ok) { list.push(v.error); return list; }
    try {
      const flipped = fen.replace(/ [wb] /, turn === 'w' ? ' b ' : ' w ').replace(/ [a-h][36] /, ' - ');
      const c = new Chess(flipped);
      if (c.inCheck()) list.push(`${turn === 'w' ? 'Black' : 'White'} is in check but it is ${turn === 'w' ? 'White' : 'Black'}'s move.`);
    } catch (e) { list.push(e.message); }
    return list;
  }

  function update() {
    clear(turnSeg);
    for (const [v, label] of [['w', 'White'], ['b', 'Black']]) turnSeg.appendChild(h('button', { class: turn === v ? 'on' : '', onclick: () => { turn = v; update(); } }, label));
    clear(castleBox);
    for (const [r, label] of [['K', 'White O-O'], ['Q', 'White O-O-O'], ['k', 'Black O-O'], ['q', 'Black O-O-O']]) {
      const ok = castleOk(r);
      castleBox.appendChild(h('label', { class: 'check', style: { display: 'inline-flex', marginRight: '12px', opacity: ok ? 1 : 0.4 } },
        h('input', { type: 'checkbox', disabled: !ok, checked: ok && castling.includes(r), onchange: (e) => { castling = e.target.checked ? castling + r : castling.replace(r, ''); update(); } }), label));
    }
    const eps = epOptions();
    clear(epSel).append(h('option', { value: '' }, 'None'), eps.map((s) => h('option', { value: s, selected: s === ep }, s)));
    const fen = currentFen();
    fenInput.value = fen;
    const probs = problems(fen);
    let ok = !probs.length;
    if (ok) {
      const e = endInfo(new Chess(fen));
      if (e.over) { msg.textContent = 'Legal position, but the game is already over (' + e.reason + ').'; ok = false; }
      else msg.textContent = 'Legal position. ' + (turn === 'w' ? 'White' : 'Black') + ' to move.';
    } else msg.textContent = probs.join(' ');
    msg.className = 'status' + (ok ? '' : ' err');
    playBtn.disabled = !ok;
    anaBtn.disabled = !!probs.length;
    saveBtn.disabled = !!probs.length;
    history.replaceState(null, '', '#/editor?fen=' + encodeURIComponent(fen));
  }

  function drawSaved() {
    const list = store.getData('scenarios', []);
    clear(savedBox).append(h('h3', null, 'Saved positions'));
    if (!list.length) { savedBox.append(h('p', { class: 'muted small' }, 'Nothing saved yet.')); return; }
    for (const s of list) {
      savedBox.append(h('div', { class: 'kv' },
        h('a', { href: 'javascript:void 0', onclick: () => setFen(s.fen) }, s.name),
        h('span', null,
          h('button', { class: 'btn small', onclick: () => setFen(s.fen) }, 'Load'), ' ',
          h('button', { class: 'btn small danger', onclick: () => { store.setData('scenarios', store.getData('scenarios', []).filter((x) => x.id !== s.id)); drawSaved(); } }, 'Delete'))));
    }
  }

  async function saveIt() {
    const input = h('input', { type: 'text', placeholder: 'Name', maxLength: 60, style: { width: '100%' } });
    const name = await modal({ title: 'Save position', body: input, buttons: [{ label: 'Cancel', value: null }, { label: 'Save', value: () => input.value.trim(), primary: true }] });
    if (!name) return;
    const list = store.getData('scenarios', []);
    store.setData('scenarios', [{ id: uid(), name, fen: currentFen(), ts: Date.now() }, ...list].slice(0, 100));
    toast('Saved');
    drawSaved();
  }

  async function playIt() {
    if (!(await clearLiveGame())) return;
    const side = sideSel.value === 'turn' ? turn : sideSel.value;
    startGame({ mode: 'practice', botId: botSel.value, color: side, startFen: currentFen(), coach: true, title: 'Practice from a set-up position' });
  }

  async function analyseIt() {
    if (!(await clearLiveGame())) return;
    startGame({ mode: 'free', color: turn, startFen: currentFen(), evalBar: true });
  }

  drawPalette();
  update();
  drawSaved();
  return () => board.destroy();
}

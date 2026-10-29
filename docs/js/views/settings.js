import { h, clear, toast, modal } from '../util.js';
import * as store from '../store.js';
import { Board } from '../board.js';
import { SETS, CODES, NAMES, DEFAULT_COLORS, COLOR_PRESETS, BOARD_THEMES, setPreviewUrl, imageFileToDataUrl } from '../pieces.js';
import { START_FEN } from '../chessutil.js';

export async function render(view) {
  const previewEl = h('div');
  const setsBox = h('div', { class: 'sets' });
  const colorsBox = h('div');
  const imagesBox = h('div');
  const boardBox = h('div');
  const optsBox = h('div');
  const accountBox = h('div', { class: 'card' });

  view.append(h('h1', null, 'Settings'),
    h('div', { class: 'play' },
      h('div', { class: 'stack' },
        h('div', { class: 'card' }, h('h2', null, 'Piece set'), setsBox),
        h('div', { class: 'card' }, h('h2', null, 'Piece colors'), colorsBox),
        h('div', { class: 'card' }, h('h2', null, 'Your own pieces'), imagesBox),
        h('div', { class: 'card' }, h('h2', null, 'Board'), boardBox),
        h('div', { class: 'card' }, h('h2', null, 'Options'), optsBox),
        accountBox),
      h('div', { class: 'side', style: { position: 'sticky', top: '64px' } }, h('div', { class: 'boardwrap' }, previewEl), h('p', { class: 'muted small' }, 'Preview'))));

  const preview = new Board(previewEl, { coords: store.getStyle().coords });
  preview.setPosition(START_FEN, { animate: false });
  preview.setLastMove(['e2', 'e4']);

  function draw() {
    const s = store.getStyle();
    // sets
    clear(setsBox);
    for (const set of SETS) {
      setsBox.appendChild(h('div', { class: 'setopt' + (s.set === set.id ? ' on' : ''), onclick: () => store.setStyle({ set: set.id }) },
        h('div', { class: 'pv' }, ['wK', 'wN', 'bQ', 'bP'].map((c) => h('span', { style: { backgroundImage: `url("${setPreviewUrl(set.id, c)}")` } }))),
        h('div', { class: 'nm' }, set.name)));
    }
    // colors
    clear(colorsBox);
    const c = { ...DEFAULT_COLORS, ...(s.colors || {}) };
    const isClassic = s.set === 'cburnett';
    if (!isClassic) colorsBox.append(h('p', { class: 'muted small' }, 'Custom colors work with the Classic set. ', h('a', { href: 'javascript:void 0', onclick: () => store.setStyle({ set: 'cburnett' }) }, 'Switch to Classic')));
    const row = (label, key) => h('div', { class: 'colorrow' }, h('span', null, label),
      h('input', { type: 'color', value: c[key], disabled: !isClassic, onchange: (e) => store.setStyle({ colors: { ...c, [key]: e.target.value } }) }));
    colorsBox.append(
      row('White pieces', 'wBody'), row('White outline', 'wLine'), row('Black pieces', 'bBody'), row('Black details', 'bLine'),
      h('div', { class: 'btnrow', style: { marginTop: '8px' } }, COLOR_PRESETS.map((p) => h('button', { class: 'btn small', disabled: !isClassic, onclick: () => store.setStyle({ colors: { ...p.colors } }) }, p.name))));
    // images
    clear(imagesBox);
    const imgs = s.images || {};
    imagesBox.append(
      h('p', { class: 'muted small' }, 'Upload a picture for any piece. Pictures are cropped square and shrunk to fit. Pieces without a picture use your piece set.'),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !!s.useImages, onchange: (e) => store.setStyle({ useImages: e.target.checked }) }), 'Use my pictures'));
    const grid = h('div', { class: 'imgslots' });
    for (const code of CODES) {
      const file = h('input', { type: 'file', accept: 'image/*', class: 'hidden', onchange: async (e) => {
        const f = e.target.files[0];
        if (!f) return;
        try {
          const url = await imageFileToDataUrl(f);
          store.setStyle({ images: { ...(store.getStyle().images || {}), [code]: url }, useImages: true });
        } catch (err) { toast(err.message); }
      } });
      const slot = h('div', {
        class: 'imgslot' + (imgs[code] ? '' : ' pi ' + code),
        title: (code[0] === 'w' ? 'White ' : 'Black ') + NAMES[code[1]].toLowerCase(),
        style: imgs[code] ? { backgroundImage: `url("${imgs[code]}")`, backgroundSize: 'cover' } : { opacity: 0.55 },
        onclick: () => file.click(),
      }, imgs[code] ? h('span', { class: 'x', title: 'Remove', onclick: (e) => {
        e.stopPropagation();
        const next = { ...(store.getStyle().images || {}) };
        delete next[code];
        store.setStyle({ images: next });
      } }, '✕') : null, file);
      grid.append(slot);
    }
    imagesBox.append(grid, h('p', { class: 'muted small', style: { marginTop: '6px' } }, 'Top row white, bottom row black: king, queen, rook, bishop, knight, pawn.'));
    // board
    clear(boardBox);
    const sw = h('div', { class: 'themesw' });
    for (const t of BOARD_THEMES) {
      sw.appendChild(h('button', { class: s.board === t.id ? 'on' : '', title: t.name, onclick: () => store.setStyle({ board: t.id }) },
        h('span', { style: { background: t.light } }), h('span', { style: { background: t.dark } })));
    }
    sw.appendChild(h('button', { class: s.board === 'custom' ? 'on' : '', title: 'Custom', onclick: () => store.setStyle({ board: 'custom' }) },
      h('span', { style: { background: s.light } }), h('span', { style: { background: s.dark } })));
    boardBox.append(sw);
    if (s.board === 'custom') {
      boardBox.append(
        h('div', { class: 'colorrow' }, h('span', null, 'Light squares'), h('input', { type: 'color', value: s.light, onchange: (e) => store.setStyle({ light: e.target.value }) })),
        h('div', { class: 'colorrow' }, h('span', null, 'Dark squares'), h('input', { type: 'color', value: s.dark, onchange: (e) => store.setStyle({ dark: e.target.value }) })));
    }
    // options
    clear(optsBox);
    const opt = (key, label) => h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !!s[key], onchange: (e) => store.setStyle({ [key]: e.target.checked }) }), label);
    optsBox.append(
      opt('coords', 'Show coordinates'),
      opt('dests', 'Show legal moves'),
      opt('animation', 'Animate moves'),
      opt('sound', 'Move sounds'),
      opt('autoQueen', 'Always promote to a queen'),
      opt('confirmResign', 'Ask before resigning'));
    preview.setCoords(s.coords);
  }

  function drawAccount() {
    clear(accountBox).append(h('h2', null, 'Account'));
    const u = store.state.user;
    if (!u) {
      accountBox.append(h('p', { class: 'muted' }, 'Playing as a guest.'), h('a', { class: 'btn', href: '#/login' }, 'Sign in or create an account'));
      return;
    }
    const oldPw = h('input', { type: 'password', autocomplete: 'current-password' });
    const newPw = h('input', { type: 'password', autocomplete: 'new-password' });
    const msg = h('p', { class: 'small' });
    accountBox.append(
      h('p', null, 'Signed in as ', h('b', null, u.username), u.admin ? h('span', { class: 'tag', style: { marginLeft: '6px' } }, 'admin') : null),
      h('h3', null, 'Change password'),
      h('div', { class: 'grid2' },
        h('label', { class: 'field' }, h('span', null, 'Current password'), oldPw),
        h('label', { class: 'field' }, h('span', null, 'New password'), newPw)),
      msg,
      h('div', { class: 'btnrow' },
        h('button', { class: 'btn', onclick: async () => {
          msg.className = 'small';
          try { await store.changePassword(oldPw.value, newPw.value); msg.textContent = 'Password changed. Other devices were signed out.'; oldPw.value = newPw.value = ''; }
          catch (e) { msg.className = 'small err'; msg.textContent = e.message; }
        } }, 'Change password'),
        h('button', { class: 'btn', onclick: async () => { await store.logout(); location.hash = '#/'; } }, 'Sign out'),
        u.admin ? h('a', { class: 'btn', href: '#/admin' }, 'Admin') : null,
        h('button', { class: 'btn danger', onclick: deleteAcct }, 'Delete account')));
  }

  async function deleteAcct() {
    const pw = h('input', { type: 'password', placeholder: 'Password', style: { width: '100%' } });
    const ok = await modal({ title: 'Delete your account?', body: h('div', null, h('p', null, 'This removes your rating, games and settings for good.'), pw), buttons: [{ label: 'Cancel', value: null }, { label: 'Delete', value: () => pw.value, danger: true }] });
    if (!ok) return;
    try { await store.deleteAccount(ok); toast('Account deleted'); location.hash = '#/'; } catch (e) { toast(e.message); }
  }

  draw();
  drawAccount();
  const off = store.onChange((w) => { if (w === 'data:style') draw(); if (w === 'auth') drawAccount(); });
  return () => { off(); preview.destroy(); };
}

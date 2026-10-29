// Piece sets, recoloring of the classic set, and custom piece images.

export const CODES = ['wK', 'wQ', 'wR', 'wB', 'wN', 'wP', 'bK', 'bQ', 'bR', 'bB', 'bN', 'bP'];
export const NAMES = { K: 'King', Q: 'Queen', R: 'Rook', B: 'Bishop', N: 'Knight', P: 'Pawn' };

export const SETS = [
  { id: 'cburnett', name: 'Classic', recolor: true, credit: 'Colin M.L. Burnett, GPLv2+' },
  { id: 'merida', name: 'Merida', credit: 'Armando Hernandez Marroquin, GPLv2+' },
  { id: 'chessnut', name: 'Chessnut', credit: 'Alexis Luengas, Apache 2.0' },
  { id: 'mpchess', name: 'MP Chess', credit: 'Maxime Chupin, GPLv3+' },
  { id: 'spatial', name: 'Spatial', credit: 'Maurizio Monge, MIT' },
  { id: 'celtic', name: 'Celtic', credit: 'Maurizio Monge, MIT' },
  { id: 'fantasy', name: 'Fantasy', credit: 'Maurizio Monge, MIT' },
  { id: 'papercut', name: 'Papercut', credit: 'Nikolay Anzarov, CC BY 4.0' },
  { id: 'rhosgfx', name: 'Pixel', credit: 'RhosGFX, CC0' },
];

export const DEFAULT_COLORS = { wBody: '#ffffff', wLine: '#000000', bBody: '#000000', bLine: '#ececec' };

export const COLOR_PRESETS = [
  { name: 'Standard', colors: DEFAULT_COLORS },
  { name: 'Ivory and ebony', colors: { wBody: '#f3ead2', wLine: '#2b2118', bBody: '#2b2118', bLine: '#d9c9a3' } },
  { name: 'Red and blue', colors: { wBody: '#e8483b', wLine: '#2a0f0c', bBody: '#2f5fb0', bLine: '#dfe8f7' } },
  { name: 'Gold and silver', colors: { wBody: '#e9c35a', wLine: '#3d2c05', bBody: '#9aa3ad', bLine: '#1d2228' } },
  { name: 'Green and purple', colors: { wBody: '#7ccf6b', wLine: '#11300c', bBody: '#6d3fa0', bLine: '#eadcf7' } },
];

const base = new URL('../pieces/', import.meta.url).href;
const svgCache = {};

async function fetchSvg(set, code) {
  const key = set + '/' + code;
  if (!svgCache[key]) svgCache[key] = fetch(base + key + '.svg').then((r) => r.text());
  return svgCache[key];
}

function dataUri(svg) {
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

export function recolor(svg, code, c) {
  const white = code[0] === 'w';
  const map = (hex) => {
    hex = hex.toLowerCase();
    const light = hex === 'fff' || hex === 'ffffff';
    const dark = hex === '000' || hex === '000000';
    if (white) return light ? c.wBody : dark ? c.wLine : '#' + hex;
    return dark ? c.bBody : hex === 'ececec' ? c.bLine : '#' + hex;
  };
  let out = svg.replace(/"#(fff|ffffff|000|000000|ececec)"/gi, (m, hex) => '"' + map(hex) + '"');
  if (!white) out = out.replace('<svg ', '<svg fill="' + c.bBody + '" ');
  return out;
}

function isDefaultColors(c) {
  return !c || Object.keys(DEFAULT_COLORS).every((k) => (c[k] || '').toLowerCase() === DEFAULT_COLORS[k]);
}

// style: { set, colors, images: { wK: dataUrl, ... }, useImages }
export async function pieceUrls(style) {
  const set = SETS.find((s) => s.id === style.set) ? style.set : 'cburnett';
  const out = {};
  const recolorOn = set === 'cburnett' && !isDefaultColors(style.colors);
  await Promise.all(CODES.map(async (code) => {
    if (style.useImages && style.images && style.images[code]) { out[code] = style.images[code]; return; }
    if (recolorOn) out[code] = dataUri(recolor(await fetchSvg(set, code), code, { ...DEFAULT_COLORS, ...style.colors }));
    else out[code] = base + set + '/' + code + '.svg';
  }));
  return out;
}

export let currentUrls = {};

export async function applyPieceStyle(style) {
  const urls = await pieceUrls(style);
  currentUrls = urls;
  let css = '';
  for (const code of CODES) css += `.pc.${code},.pi.${code}{background-image:url("${urls[code]}")}\n`;
  document.getElementById('piece-css').textContent = css;
  return urls;
}

export function setPreviewUrl(setId, code) {
  return base + setId + '/' + code + '.svg';
}

// Resize an uploaded image to a small square PNG data URL.
export function imageFileToDataUrl(file, size = 96) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = c.height = size;
      const ctx = c.getContext('2d');
      const s = Math.min(img.width, img.height);
      ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
      URL.revokeObjectURL(url);
      let out = c.toDataURL('image/webp', 0.85);
      if (!out.startsWith('data:image/webp')) out = c.toDataURL('image/png');
      resolve(out);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that image')); };
    img.src = url;
  });
}

export const BOARD_THEMES = [
  { id: 'brown', name: 'Brown', light: '#f0d9b5', dark: '#b58863' },
  { id: 'green', name: 'Green', light: '#eeeed2', dark: '#769656' },
  { id: 'blue', name: 'Blue', light: '#dee3e6', dark: '#8ca2ad' },
  { id: 'gray', name: 'Gray', light: '#dcdcdc', dark: '#9a9a9a' },
  { id: 'wood', name: 'Walnut', light: '#e3c69c', dark: '#8b5a2b' },
  { id: 'purple', name: 'Purple', light: '#e6dff0', dark: '#8a76ab' },
  { id: 'coral', name: 'Coral', light: '#f1e4d8', dark: '#d08b6b' },
];

export function applyBoardStyle(style) {
  const t = BOARD_THEMES.find((x) => x.id === style.board) || BOARD_THEMES[0];
  const light = style.board === 'custom' ? style.light : t.light;
  const dark = style.board === 'custom' ? style.dark : t.dark;
  document.getElementById('board-css').textContent =
    `:root{--board-light:${light};--board-dark:${dark};--anim:${style.animation === false ? '0ms' : '180ms'}}`;
}

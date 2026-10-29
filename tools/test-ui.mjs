// UI smoke tests with Playwright. Needs the site on :8000 and `wrangler dev` on :8787.
// Run: node tools/test-ui.mjs [--engine]   (without --engine, requests for the engine are blocked)
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');

const SITE = 'http://127.0.0.1:8000/';
const API = 'http://127.0.0.1:8787';
const ENGINE = process.argv.includes('--engine');
const SHOTS = '/tmp/ct-shots/';
let fails = 0;
const ok = (c, m) => { if (c) console.log('  ok  ' + m); else { fails++; console.log('  FAIL ' + m); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
import fs from 'node:fs';
fs.mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
if (!ENGINE) await page.route(/vendor\/stockfish/, (r) => r.abort());

async function sqCenter(sq) {
  return page.evaluate((sq) => {
    const el = document.querySelector(`.cb-sq [data-sq="${sq}"]`);
    el.scrollIntoView({ block: 'nearest' });
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, sq);
}
async function clickSq(sq) { const p = await sqCenter(sq); await page.mouse.click(p.x, p.y); }

console.log('home');
await page.goto(SITE + '?api=' + encodeURIComponent(API) + '#/');
await page.waitForSelector('.ratingcard');
ok(await page.isVisible('text=Find your rating'), 'guest sees "Find your rating"');
await page.screenshot({ path: SHOTS + 'home.png' });

console.log('editor');
await page.goto(SITE + '#/editor');
await page.waitForSelector('.palette');
await page.click('text=Clear board');
ok((await page.$$('.cb-pcs .pc')).length === 0, 'board cleared');
await page.click('.palette .wK');
await clickSq('e1');
await page.click('.palette .bK');
await clickSq('e8');
await page.click('.palette .wQ');
await clickSq('d1');
await page.click('.palette .wR');
await clickSq('h1');
const fen = await page.inputValue('.fenbox');
ok(fen.startsWith('4k3/8/8/8/8/8/8/3QK2R w K -'), 'FEN built with castling right: ' + fen);
ok((await page.textContent('.status')).includes('Legal position'), 'legal position reported');
// drag the rook off the board removes it
const h1 = await sqCenter('h1');
await page.click('.palette .tool >> text=Move');
await page.mouse.move(h1.x, h1.y); await page.mouse.down(); await page.mouse.move(h1.x + 200, h1.y + 400, { steps: 8 }); await page.mouse.up();
ok(!(await page.inputValue('.fenbox')).includes('R'), 'dragging a piece off the board removes it');
// illegal: two white kings
await page.click('.palette .wK');
await clickSq('a1');
ok((await page.textContent('.status')).includes('exactly one king'), 'two kings flagged');
await clickSq('a1');
// drag palette piece onto the board
const pn = await page.$('.palette .bN');
const pb = await pn.boundingBox();
const c3 = await sqCenter('c3');
await page.mouse.move(pb.x + pb.width / 2, pb.y + pb.height / 2); await page.mouse.down(); await page.mouse.move(c3.x, c3.y, { steps: 10 }); await page.mouse.up();
ok((await page.inputValue('.fenbox')).includes('2n5'), 'dragged a knight from the palette to c3');
await page.screenshot({ path: SHOTS + 'editor.png' });
// paste a FEN
await page.fill('.fenbox', 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3');
await page.press('.fenbox', 'Enter');
ok((await page.$$('.cb-pcs .pc')).length === 32, 'FEN paste loads 32 pieces');
// save it
await page.click('text=Save position');
await page.fill('.modal input', 'Italian setup');
await page.click('.modal button.primary');
ok(await page.isVisible('text=Italian setup'), 'position saved and listed');

console.log('settings');
await page.goto(SITE + '#/settings');
await page.waitForSelector('.sets');
await page.click('.setopt >> text=Merida');
await sleep(300);
ok((await page.textContent('#piece-css')).includes('merida/wK.svg'), 'Merida set applied');
await page.click('.setopt >> text=Classic');
await page.click('text=Red and blue');
await sleep(400);
const css = await page.textContent('#piece-css');
ok(css.includes('data:image/svg+xml') && css.includes(encodeURIComponent('#e8483b')), 'Classic recolored to red and blue');
await page.click('.themesw button[title="Green"]');
ok((await page.textContent('#board-css')).includes('#769656'), 'green board applied');
await page.setInputFiles('.imgslot >> nth=0 >> input[type=file]', { name: 'k.png', mimeType: 'image/png', buffer: pngBuffer() });
await sleep(800);
ok((await page.textContent('#piece-css')).includes('data:image/'), 'uploaded picture used for a piece');
await page.screenshot({ path: SHOTS + 'settings.png', fullPage: true });

console.log('sign up');
const user = 'ui_' + Date.now().toString(36).slice(-5);
await page.goto(SITE + '#/login');
await page.click('.tabs >> text=Create account');
await page.fill('input[autocomplete=username]', user);
await page.fill('input[autocomplete=new-password] >> nth=0', 'secret12');
await page.fill('input[autocomplete=new-password] >> nth=1', 'secret12');
await page.click('form button[type=submit]');
await page.waitForSelector('#topright >> text=' + user, { timeout: 10000 });
ok(true, 'signed up and shown in the top bar');
await sleep(1500);
const me = await page.evaluate(async (api) => {
  const s = JSON.parse(localStorage.getItem('ct.session'));
  const r = await fetch(api + '/api/me', { headers: { authorization: 'Bearer ' + s.token } });
  return r.json();
}, API);
ok(me.data && me.data.style && me.data.style.v.set === 'cburnett' && me.data.style.v.images && me.data.style.v.images.wK, 'guest settings and pictures moved to the account');
ok(me.data && me.data.scenarios && me.data.scenarios.v[0].name === 'Italian setup', 'saved positions moved to the account');

console.log('puzzles');
await page.goto(SITE + '#/puzzles');
await page.waitForSelector('text=Your turn', { timeout: 15000 });
ok((await page.$$('.cb-pcs .pc')).length > 2, 'puzzle position shown');
// solve one for real by clicking the solution moves
async function clickMove(u) {
  await clickSq(u.slice(0, 2)); await sleep(80); await clickSq(u.slice(2, 4));
  if (u[4]) { await sleep(150); await page.click('.cb-promo .opt[title=' + u[4].toUpperCase() + ']'); }
}
let solvedOne = false;
for (let attempt = 0; attempt < 3 && !solvedOne; attempt++) {
  const pz = await page.evaluate(() => window.__ctPuzzle);
  for (let i = 1; i < pz.moves.length; i += 2) {
    await page.waitForFunction(() => document.querySelector('.status').textContent.match(/Your (turn|move)/));
    await clickMove(pz.moves[i]);
    await sleep(700);
  }
  solvedOne = (await page.textContent('.status')).startsWith('Solved');
}
ok(solvedOne, 'solved a puzzle by playing the moves');
await page.click('text=Next puzzle');
await page.waitForSelector('text=Your turn', { timeout: 15000 });
await page.click('text=View the solution');
await page.waitForSelector('text=Next puzzle', { timeout: 15000 });
ok((await page.textContent('.status')).startsWith('Solution:'), 'solution plays out');
await sleep(800);
ok(true, 'puzzle rating card: ' + (await page.textContent('.side .card .bignum')).trim());
await page.screenshot({ path: SHOTS + 'puzzles.png' });

console.log('profile');
await page.goto(SITE + '#/profile');
await page.waitForSelector('text=Rating history');
ok(true, 'profile renders');

console.log('mobile');
const m = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const mp = await m.newPage();
if (!ENGINE) await mp.route(/vendor\/stockfish/, (r) => r.abort());
mp.on('pageerror', (e) => errors.push('mobile: ' + e.message));
await mp.goto(SITE + '#/editor');
await mp.waitForSelector('.palette');
await mp.screenshot({ path: SHOTS + 'mobile-editor.png', fullPage: true });
await mp.goto(SITE + '#/');
await mp.waitForSelector('.ratingcard');
await mp.screenshot({ path: SHOTS + 'mobile-home.png', fullPage: true });

const real = errors.filter((e) => !/stockfish|Failed to load resource|ERR_FAILED/i.test(e));
ok(real.length === 0, 'no page errors' + (real.length ? ': ' + real.join(' | ') : ''));
await browser.close();
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);

function pngBuffer() {
  // 2x2 red PNG
  return Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==', 'base64');
}

// Browser tests that use the engine: placement game, review, coach, hints, drills,
// editor -> play, analysis board. Needs the site on :8000 and `wrangler dev` on :8787.
// Run: node tools/test-play.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
const { chromium } = createRequire(import.meta.url)('playwright');

const SITE = 'http://127.0.0.1:8000/';
const API = 'http://127.0.0.1:8787';
const SHOTS = '/tmp/ct-shots/';
fs.mkdirSync(SHOTS, { recursive: true });
let fails = 0;
const ok = (c, m) => { if (c) console.log('  ok  ' + m); else { fails++; console.log('  FAIL ' + m); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

async function sqCenter(sq) {
  return page.evaluate((sq) => {
    const el = document.querySelector(`.cb-sq [data-sq="${sq}"]`);
    el.scrollIntoView({ block: 'nearest' });
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, sq);
}
async function clickSq(sq) { const p = await sqCenter(sq); await page.mouse.click(p.x, p.y); }
async function dragMove(u) {
  const a = await sqCenter(u.slice(0, 2)); const b = await sqCenter(u.slice(2, 4));
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 6 }); await page.mouse.up();
}
const userTurn = () => page.waitForFunction(() => {
  const g = window.__ctGame; if (!g) return false;
  const st = document.querySelector('.status');
  return g.chess.turn() === g.cfg.color && st && /Your move|in check/.test(st.textContent);
}, null, { timeout: 60000 });

// Start clean, as a guest, with auto-queen on.
await page.goto(SITE + '?api=' + encodeURIComponent(API) + '#/');
await page.evaluate(() => { localStorage.clear(); localStorage.setItem('ct.api', 'http://127.0.0.1:8787'); localStorage.setItem('ct.guest', JSON.stringify({ data: { style: { autoQueen: true, confirmResign: false } }, stamps: {} })); });
await page.goto(SITE + '#/');
await page.waitForSelector('button >> text=Casual');

console.log('placement game');
const t0 = Date.now();
await page.click('button >> text=Casual');
await page.click('.side button.primary >> text=Play');
await page.waitForFunction(() => window.__ctGame && location.hash === '#/play');
const cfg = await page.evaluate(() => window.__ctGame.cfg);
ok(cfg.mode === 'rated' && ['w', 'b'].includes(cfg.color), `rated game started, you play ${cfg.color === 'w' ? 'white' : 'black'} against ${cfg.botId}`);
for (let i = 0; i < 6; i++) {
  await userTurn();
  if (i === 0) console.log('    first turn ready after', Date.now() - t0, 'ms');
  const u = await page.evaluate(() => {
    const ms = window.__ctGame.chess.moves({ verbose: true });
    const quiet = ms.filter((m) => !m.captured);
    const pick = (quiet.length ? quiet : ms)[Math.floor(Math.random() * (quiet.length ? quiet : ms).length)];
    return pick.lan;
  });
  if (i % 2) await dragMove(u); else { await clickSq(u.slice(0, 2)); await clickSq(u.slice(2, 4)); }
  await page.waitForFunction((n) => window.__ctGame.chess.history().length > n, await page.evaluate(() => window.__ctGame.chess.history().length));
}
await userTurn();
const plies = await page.evaluate(() => window.__ctGame.chess.history().length);
ok(plies >= 12, 'six moves each way played (' + plies + ' plies), by click and by drag');
await page.screenshot({ path: SHOTS + 'rated-game.png' });
await page.click('text=Resign');
await page.waitForSelector('text=You lost', { timeout: 15000 });
const resText = await page.textContent('.side .card');
ok(/Rating \d+/.test(resText) && /Placement game 1 of 5/.test(resText), 'result shows rating change and placement count');
await page.screenshot({ path: SHOTS + 'result.png' });

console.log('review');
await page.click('text=Review this game');
await page.waitForSelector('.acc', { timeout: 120000 });
const acc = await page.textContent('.acc');
ok(/Accuracy\d/.test(acc.replace(/\s/g, '')), 'review finished with accuracy: ' + acc.replace(/\s+/g, ' ').slice(0, 80));
const marks = await page.$$eval('.moves .sym', (els) => els.map((e) => e.textContent));
console.log('    move marks:', marks.join(' '));
const key = await page.$('text=Retry');
if (key) {
  await key.click();
  await page.waitForSelector('text=Find something better');
  const fen = await page.evaluate(() => null);
  ok(true, 'retry mode opened on a mistake');
} else ok(true, 'no mistakes to retry (fine)');
await page.screenshot({ path: SHOTS + 'review.png' });

console.log('practice with coach');
const blunderFen = 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3';
await page.goto(SITE + '#/practice?fen=' + encodeURIComponent(blunderFen));
await page.click('.seg button >> text=White');
await page.selectOption('.side select >> nth=0', 'l5');
await page.click('.side button.primary >> text=Play');
await userTurn();
// Qe2?? is fine, but Nxe5?? Nxe5 loses a knight. Play Nf3-g5?? no: use Ng5 which hangs nothing... choose Nxe5
await clickSq('f3'); await clickSq('e5');
await page.waitForSelector('.coach.bad', { timeout: 30000 });
ok((await page.textContent('.coach')).includes('blunder'), 'coach flags Nxe5 as a blunder: ' + (await page.textContent('.coach')).slice(0, 90));
await page.click('text=Show the threat');
ok((await page.$$('.cb-arrows polygon')).length === 1, 'threat arrow drawn');
await page.click('text=Take it back');
await userTurn();
ok(await page.evaluate((f) => window.__ctGame.chess.fen() === f, blunderFen), 'take it back restores the position');
await page.click('button >> text=Hint');
await sleep(2500);
ok((await page.$$('.cb-arrows circle')).length === 1, 'hint marks a piece');
await page.click('button >> text=Hint');
await sleep(500);
ok((await page.textContent('.status')).startsWith('Hint: '), 'second hint names the move: ' + (await page.textContent('.status')));
// play a normal move and let the bot answer
await clickSq('f1'); await clickSq('c4');
await userTurn();
ok(await page.evaluate(() => window.__ctGame.chess.history().length === 2), 'bot answered');
await page.click('button >> text=Take back');
ok(await page.evaluate((f) => window.__ctGame.chess.fen() === f, blunderFen), 'take back undoes both moves');
await page.screenshot({ path: SHOTS + 'practice.png' });
await page.click('text=Resign');
await page.waitForSelector('text=You lost');

console.log('drill');
await page.goto(SITE + '#/drills');
await page.click('.card:has-text("King and queen") >> text=Start');
await userTurn();
ok((await page.textContent('.status')).includes('15 moves left'), 'drill shows moves left');
await clickSq('d1'); await clickSq('d3');
await userTurn();
ok((await page.textContent('.status')).includes('14 moves left'), 'Stockfish defended, 14 left');
await page.click('text=Give up');
await page.waitForSelector('text=Not this time');

console.log('editor to game');
await page.goto(SITE + '#/editor?fen=' + encodeURIComponent('8/8/8/4k3/8/8/8/R3K3 b - - 0 1'));
await page.waitForSelector('text=Legal position');
await page.selectOption('select >> nth=2', 'w');
await page.click('text=Play this position');
await page.waitForFunction(() => window.__ctGame && window.__ctGame.chess.history().length >= 1, null, { timeout: 30000 });
ok(await page.evaluate(() => window.__ctGame.cfg.startFen.startsWith('8/8/8/4k3')), 'game started from the edited position, bot (black) moved first');
await page.click('text=Resign');
await page.waitForSelector('text=You lost');

console.log('analysis board');
await page.goto(SITE + '#/');
await page.click('.seg button >> text=Practice');
await page.click('text=Analysis board');
await page.waitForSelector('text=White to move');
await clickSq('e2'); await clickSq('e4');
await page.waitForSelector('text=Black to move');
await page.click('text=Best move');
await page.waitForFunction(() => document.querySelector('.status').textContent.startsWith('Best:'), null, { timeout: 30000 });
ok(true, 'best move shown: ' + (await page.textContent('.status')));
await page.check('text=Show evaluation');
await sleep(2500);
ok(/\d\.\d|M\d/.test(await page.textContent('.evalbar')), 'eval bar has a number: ' + (await page.textContent('.evalbar')));
await page.screenshot({ path: SHOTS + 'analysis.png' });

const real = errors.filter((e) => !/Failed to load resource/.test(e));
ok(real.length === 0, 'no page errors' + (real.length ? ': ' + real.join(' | ') : ''));
await browser.close();
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);

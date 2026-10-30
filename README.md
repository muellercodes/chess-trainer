# Chess Trainer

A chess trainer that finds your rating against calibrated computer opponents, then helps you raise it.

Live: https://muellercodes.github.io/chess-trainer/

## What it does

- **Find your rating.** Five placement games, each against the computer level closest to your current estimate. White or black is a coin flip every rated game. After that, pick any of the 16 levels for rated games. Leaving a rated game unfinished counts as a loss; aborting before your first move does not count.
- **Ratings** use Glicko-2, one game per rating period (the way Lichess does it). The rating shows a `?` while it is still uncertain (deviation above 110), and the site shows the likely range.
- **Practice games** with hints, take-backs, an evaluation bar and a coach that stops you before a blunder and shows the threat. Start from the normal position or any position you set up.
- **Game review** of every game: Stockfish analysis, accuracy, inaccuracies, mistakes and blunders, an evaluation graph, and a Retry button on each of your mistakes.
- **Puzzles** from the Lichess puzzle database, with their own Glicko-2 rating, plus practice by theme (forks, pins, mates in 1 to 3, and more).
- **Drills**: basic checkmates and pawn endings against full-strength Stockfish.
- **Board editor**: drag pieces to set up any position, set side to move, castling and en passant, paste or copy FEN, save positions, then play them against any level or analyze them.
- **Pieces and board**: nine piece sets, custom colors for the classic set, your own pictures for any piece, board color themes.
- **Accounts**: username and password only, no email. Everything syncs between devices. Guests can play too; their progress moves into a new account.

## The bot ladder

| Level | Rating | How it plays |
| --- | --- | --- |
| 1 | 220 | Shallow Stockfish search (depth 2), softmax pick at 450 cp temperature, 40% random moves |
| 2 | 430 | depth 3, 280 cp, 24% random |
| 3 | 500 | depth 4, 230 cp, 19% random |
| 4 | 620 | depth 5, 165 cp, 13% random |
| 5 | 850 | depth 6, 140 cp, 10% random |
| 6 | 950 | depth 6, 115 cp, 8% random |
| 7 | 1050 | depth 6, 95 cp, 6.5% random |
| 8 | 1240 | depth 7, 80 cp, 5% random |
| 9 to 16 | 1450 to 2500 | Stockfish `UCI_LimitStrength` with `UCI_Elo` = the rating, searched to a fixed depth so strength does not depend on device speed |

Levels 1 to 8 scan every legal move with Stockfish (MultiPV) and pick with a softmax over the scores, so they make human-looking mistakes rather than only random ones.

**Calibration.** Stockfish's strength setting stops at 1320, so levels 1 to 8 were measured: 760 bot-vs-bot games between neighbouring levels and against levels 9 to 12 (`tools/calibrate/run.mjs`, results in `tools/calibrate/results.jsonl`), fitted by maximum likelihood on the Elo model with the Stockfish levels as the anchor. Levels 9 to 12 came out within 20 points of their `UCI_Elo` values, so Stockfish's scale holds at these settings. Standard errors for levels 1 to 8 are about 35 to 50 points.

That scale is Stockfish's (anchored to CCRL engine ratings). It is close to, but not the same as, chess.com or Lichess ratings, which also differ from each other. Use it to track your own progress.

To recalibrate after changing a bot: `node tools/calibrate/run.mjs play 20 3` (appends games), then `node tools/calibrate/run.mjs fit`.

## Layout

```
docs/                 static site (GitHub Pages serves this folder)
  js/                 app code, plain ES modules, no build step
  js/views/           one module per screen
  vendor/             Stockfish (WASM) and chess.js
  pieces/             piece sets
  data/puzzles/       puzzle subset, bucketed by rating
worker/               Cloudflare Worker + D1 (accounts, ratings, games)
tools/                API and UI tests, bot calibration
```

The Worker imports `docs/js/glicko.js` and `docs/js/bots.js`, so ratings are computed with the same code in the browser (guests) and on the server (accounts).

## Run locally

```sh
cd worker && npm install
npx wrangler d1 migrations apply chess-trainer-db --local
npx wrangler dev --local --port 8787 --var SIGNUP_PER_HOUR:1000
# in another terminal
cd docs && python3 -m http.server 8000
# open http://localhost:8000/?api=http://127.0.0.1:8787   (?api=reset to go back to the live API)
node tools/test-api.mjs
```

## Deploy

```sh
cd worker
npx wrangler d1 create chess-trainer-db            # once; put the id in wrangler.toml
npx wrangler d1 execute chess-trainer-db --remote --command "$(grep -v '^--' migrations/0001_init.sql)"
npx wrangler deploy
```

GitHub Pages serves `docs/` from `main`.

## Admin

Usernames listed in `ADMINS` (worker/wrangler.toml) get an Admin page under Settings: list accounts, set a new password for anyone (there is no email, so this is how resets work), and delete accounts.

## License

MIT for this project's code. Stockfish is GPL v3 and the piece sets and puzzles have their own licenses; see [CREDITS.md](CREDITS.md).

# Chess Trainer

A chess trainer that finds your rating against calibrated computer opponents, then helps you raise it.

Live: https://muellercodes.github.io/chess-trainer/

## What it does

- **Find your rating.** Five placement games against computer opponents chosen near your current estimate. White or black is a coin flip every rated game. After that, pick any of the 16 levels for rated games.
- **Ratings** use Glicko-2, one game per rating period (the way Lichess does it). The rating shows a `?` while it is still uncertain (deviation above 110), and the site shows the likely range.
- **Practice games** with hints, take-backs, an evaluation bar and a coach that stops you before a blunder and shows the threat. Start from the normal position or any position you set up.
- **Game review** of every game: Stockfish analysis, accuracy, inaccuracies, mistakes and blunders, an evaluation graph, and a Retry button on each of your mistakes.
- **Puzzles** from the Lichess puzzle database, with their own Glicko-2 rating, plus practice by theme (forks, pins, mates in 1 to 3, and more).
- **Drills**: basic checkmates and pawn endings against full-strength Stockfish.
- **Board editor**: drag pieces to set up any position, set side to move, castling and en passant, paste or copy FEN, save positions, then play them against any level or analyze them.
- **Pieces and board**: nine piece sets, custom colors for the classic set, your own pictures for any piece, board color themes.
- **Accounts**: username and password only, no email. Everything syncs between devices. Guests can play too; their progress moves into a new account.

## The bot ladder

| Level | How it plays |
| --- | --- |
| 1 to 8 | Stockfish scores the candidate moves at a shallow depth (1 to 8) and the bot picks among them with a softmax over centipawns, plus a share of random moves. Lower levels have higher temperature and more random moves. |
| 9 to 16 | Stockfish's own `UCI_LimitStrength` with `UCI_Elo` 1450 to 2500, searched to a fixed depth so strength does not depend on how fast the device is. |

Ratings for levels 9 to 16 are Stockfish's `UCI_Elo` values. Levels 1 to 8 are calibrated by self-play against each other and against levels 9 and 10 (`tools/calibrate`), so the whole ladder sits on one scale anchored to Stockfish's. That scale is not the same as chess.com or Lichess ratings, which differ from each other too. Treat comparisons with those sites as rough.

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

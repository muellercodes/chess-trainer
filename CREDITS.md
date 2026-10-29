# Credits and licenses

Chess Trainer's own code is MIT licensed (see LICENSE). These bundled parts keep their own licenses.

## Engine

- **Stockfish 19** by the Stockfish developers, compiled to WebAssembly as **stockfish.js** by Nathan Rugg and contributors.
  GPL v3. Files: `docs/vendor/stockfish/` (license text in `docs/vendor/stockfish/COPYING.txt`).
  Source: https://github.com/official-stockfish/Stockfish and https://github.com/nmrugg/stockfish.js
  The engine runs as a separate program in a Web Worker and talks to the site only through UCI text messages.

## Rules

- **chess.js** by Jeff Hlywa. BSD 2-Clause. `docs/vendor/chessjs/` (license in that folder). https://github.com/jhlywa/chess.js

## Puzzles

- **Lichess puzzle database**, public domain (CC0). A subset of 9,633 puzzles is in `docs/data/puzzles/`. https://database.lichess.org/

## Piece sets (from the Lichess repository, `public/piece/`)

| Set | Author | License |
| --- | --- | --- |
| Classic (`cburnett`) | Colin M.L. Burnett | GPLv2+ (also offered by the author under GFDL and BSD on Wikimedia Commons) |
| Merida | Armando Hernandez Marroquin | GPLv2+ |
| Chessnut | Alexis Luengas | Apache 2.0 |
| MP Chess (`mpchess`) | Maxime Chupin | GPLv3+ |
| Spatial, Celtic, Fantasy | Maurizio Monge | MIT |
| Papercut | Nikolay Anzarov | CC BY 4.0 |
| Pixel (`rhosgfx`) | RhosGFX | CC0 1.0 |

-- Chess Trainer schema

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  username_lc TEXT NOT NULL UNIQUE,
  pw_hash TEXT NOT NULL,
  pw_salt TEXT NOT NULL,
  pw_iter INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen INTEGER
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  last_used INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS ratings (
  user_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  r REAL NOT NULL,
  rd REAL NOT NULL,
  vol REAL NOT NULL,
  n INTEGER NOT NULL DEFAULT 0,
  w INTEGER NOT NULL DEFAULT 0,
  d INTEGER NOT NULL DEFAULT 0,
  l INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, kind)
);

CREATE TABLE IF NOT EXISTS games (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  mode TEXT NOT NULL,
  bot_id TEXT,
  bot_rating INTEGER,
  color TEXT NOT NULL,
  result TEXT NOT NULL,
  reason TEXT,
  rated INTEGER NOT NULL DEFAULT 0,
  r_before REAL,
  r_after REAL,
  rd_after REAL,
  plies INTEGER,
  start_fen TEXT,
  pgn TEXT,
  review TEXT,
  summary TEXT
);
CREATE INDEX IF NOT EXISTS games_user ON games(user_id, created_at);

CREATE TABLE IF NOT EXISTS puzzle_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  puzzle_id TEXT NOT NULL,
  puzzle_rating INTEGER NOT NULL,
  solved INTEGER NOT NULL,
  r_after REAL
);
CREATE INDEX IF NOT EXISTS puzzle_user ON puzzle_log(user_id, created_at);

CREATE TABLE IF NOT EXISTS profile (
  user_id INTEGER NOT NULL,
  k TEXT NOT NULL,
  v TEXT NOT NULL,
  t INTEGER NOT NULL,
  PRIMARY KEY (user_id, k)
);

CREATE TABLE IF NOT EXISTS hits (
  ip TEXT NOT NULL,
  kind TEXT NOT NULL,
  ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS hits_ip ON hits(ip, kind, ts);

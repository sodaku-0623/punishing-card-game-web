-- Cloudflare D1 数据库结构 (与 src/lib/db-client.ts 中的 SCHEMA_STATEMENTS 保持一致)
-- rooms / game_records 为旧版表，已不再使用，可手动 DROP。

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  nickname TEXT NOT NULL,
  role TEXT DEFAULT 'USER',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS decks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  cards_json TEXT NOT NULL,
  is_valid INTEGER DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS lobby_rooms (
  room_id TEXT PRIMARY KEY,
  room_code TEXT NOT NULL,
  title TEXT NOT NULL,
  has_password INTEGER DEFAULT 0,
  creator_id TEXT NOT NULL,
  status TEXT NOT NULL,
  player_count INTEGER DEFAULT 0,
  players_json TEXT NOT NULL,
  current_game_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS matches (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  rng_seed TEXT NOT NULL,
  player1_id TEXT NOT NULL,
  player2_id TEXT NOT NULL,
  player1_deck_id TEXT NOT NULL,
  player2_deck_id TEXT NOT NULL,
  winner_id TEXT,
  is_draw INTEGER DEFAULT 0,
  finish_reason TEXT,
  turns INTEGER NOT NULL,
  started_at INTEGER NOT NULL,
  finished_at INTEGER NOT NULL,
  replay_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_matches_finished_at ON matches (finished_at DESC);

CREATE INDEX IF NOT EXISTS idx_lobby_rooms_updated_at ON lobby_rooms (updated_at DESC);

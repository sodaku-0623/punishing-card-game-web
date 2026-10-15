-- Cloudflare D1 数据库初始化结构
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

CREATE TABLE IF NOT EXISTS game_records (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  player1_id TEXT NOT NULL,
  player2_id TEXT NOT NULL,
  winner_id TEXT,
  turns INTEGER NOT NULL,
  replay_json TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS rooms (
  room_id TEXT PRIMARY KEY,
  room_code TEXT NOT NULL,
  title TEXT NOT NULL,
  has_password INTEGER DEFAULT 0,
  password_hash TEXT,
  creator_id TEXT NOT NULL,
  status TEXT NOT NULL,
  player_count INTEGER DEFAULT 1,
  players_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

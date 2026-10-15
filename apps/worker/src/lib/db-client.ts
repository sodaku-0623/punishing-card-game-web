import { hashPassword } from './crypto-auth.js';

export interface DbUser {
  id: string;
  username: string;
  password_hash: string;
  nickname: string;
  role: 'USER' | 'ADMIN';
  created_at: number;
}

export interface DbDeck {
  id: string;
  user_id: string;
  name: string;
  cards_json: string;
  is_valid: number;
  created_at: number;
  updated_at: number;
}

export interface DbRoom {
  room_id: string;
  room_code: string;
  title: string;
  has_password: number;
  creator_id: string;
  status: string;
  player_count: number;
  players_json: string;
  current_game_id: string | null;
  created_at: number;
  updated_at: number;
}

export interface DbMatch {
  id: string;
  room_id: string;
  rng_seed: string;
  player1_id: string;
  player2_id: string;
  player1_deck_id: string;
  player2_deck_id: string;
  winner_id: string | null;
  is_draw: number;
  finish_reason: string | null;
  turns: number;
  started_at: number;
  finished_at: number;
  replay_json: string | null;
}

/**
 * D1 表结构 (与 apps/worker/schema.sql 保持一致)。
 * rooms 仅作大厅展示用的只读投影，权威房间状态 (含密码摘要) 保存在各房间的 Durable Object 中。
 */
export const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    nickname TEXT NOT NULL,
    role TEXT DEFAULT 'USER',
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS decks (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    cards_json TEXT NOT NULL,
    is_valid INTEGER DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS lobby_rooms (
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
  )`,
  `CREATE TABLE IF NOT EXISTS matches (
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
  )`,
  `CREATE INDEX IF NOT EXISTS idx_matches_finished_at ON matches (finished_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_lobby_rooms_updated_at ON lobby_rooms (updated_at DESC)`,
];

const initializedDbs = new WeakSet<object>();

/**
 * 初始化 D1 表结构并预置管理员账号。
 * - 仅当配置了 ADMIN_PASSWORD 时才创建管理员，绝不使用默认密码；
 * - 不在公网部署中预置任何演示账号。
 * 每个 isolate 只执行一次。
 */
export async function initializeDatabase(db: D1Database, adminPassword?: string): Promise<void> {
  if (initializedDbs.has(db as object)) return;

  await db.batch(SCHEMA_STATEMENTS.map((sql) => db.prepare(sql)));

  const existingAdmin = await db.prepare('SELECT id FROM users WHERE username = ?').bind('admin').first<DbUser>();
  if (!existingAdmin) {
    const password = adminPassword?.trim();
    if (password && password.length >= 8) {
      await db
        .prepare('INSERT INTO users (id, username, password_hash, nickname, role, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .bind('user-admin-01', 'admin', await hashPassword(password), '总指挥·管理员', 'ADMIN', Date.now())
        .run();
    } else {
      console.warn('未配置 ADMIN_PASSWORD (至少 8 位)，已跳过创建管理员账号 admin');
    }
  }

  initializedDbs.add(db as object);
}

import { OFFICIAL_SEED_CARDS } from '@zhanshuang/database';
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

export interface DbCard {
  id: string;
  card_number: string;
  name: string;
  card_type: string;
  attribute?: string;
  cost: number;
  base_pp?: number;
  base_dp?: number;
  signal_orb?: string;
  traits_json?: string;
  is_instant: number;
  rules_text?: string;
  flavor_text?: string;
  data_json: string;
}

export interface DbGameRecord {
  id: string;
  room_id: string;
  player1_id: string;
  player2_id: string;
  winner_id?: string;
  turns: number;
  replay_json?: string;
  created_at: number;
}

export interface DbRoom {
  room_id: string;
  room_code: string;
  title: string;
  has_password: number;
  password_hash?: string;
  creator_id: string;
  status: string;
  player_count: number;
  players_json: string;
  created_at: number;
  updated_at: number;
}

/**
 * 初始化 D1 数据库数据表并自动填充官方卡牌与预组
 */
export async function initializeDatabase(db: D1Database, adminPassword?: string): Promise<void> {
  // 1. 初始化建表
  await db.exec(`
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

    CREATE TABLE IF NOT EXISTS cards (
      id TEXT PRIMARY KEY,
      card_number TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      card_type TEXT NOT NULL,
      attribute TEXT,
      cost INTEGER NOT NULL,
      base_pp INTEGER,
      base_dp INTEGER,
      signal_orb TEXT,
      traits_json TEXT,
      is_instant INTEGER DEFAULT 0,
      rules_text TEXT,
      flavor_text TEXT,
      data_json TEXT NOT NULL
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
  `);

  // 2. 检查并预置默认管理员账号 (admin)
  const existingAdmin = await db
    .prepare('SELECT id FROM users WHERE username = ?')
    .bind('admin')
    .first<DbUser>();

  if (!existingAdmin) {
    const pwd = adminPassword || 'admin888';
    const pwdHash = await hashPassword(pwd);
    await db
      .prepare('INSERT INTO users (id, username, password_hash, nickname, role, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind('user-admin-01', 'admin', pwdHash, '总指挥·管理员', 'ADMIN', Date.now())
      .run();
  }

  // 3. 检查并预置演示玩家账号 (player1)
  const existingPlayer = await db
    .prepare('SELECT id FROM users WHERE username = ?')
    .bind('player1')
    .first<DbUser>();

  if (!existingPlayer) {
    const playerPwdHash = await hashPassword('123456');
    await db
      .prepare('INSERT INTO users (id, username, password_hash, nickname, role, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind('user-player-01', 'player1', playerPwdHash, '灰鸦指挥官·爱丽丝', 'USER', Date.now())
      .run();
  }

  // 4. 检查是否已导入官方基础卡牌库
  const cardCountRow = await db
    .prepare('SELECT COUNT(*) as count FROM cards')
    .first<{ count: number }>();

  if (!cardCountRow || cardCountRow.count === 0) {
    // 批量导入种子卡牌
    const statements = OFFICIAL_SEED_CARDS.map((card) => {
      const id = (card as any).id || `card-${card.cardNumber.toLowerCase()}`;
      return db
        .prepare(`
          INSERT OR REPLACE INTO cards (
            id, card_number, name, card_type, attribute, cost,
            base_pp, base_dp, signal_orb, traits_json, is_instant,
            rules_text, flavor_text, data_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .bind(
          id,
          card.cardNumber,
          card.name,
          card.cardType,
          card.attribute ?? null,
          card.cost,
          card.basePP ?? null,
          card.baseDP ?? null,
          card.signalOrb ?? null,
          JSON.stringify(card.traits ?? []),
          card.isInstant ? 1 : 0,
          card.rulesText ?? '',
          card.flavorText ?? '',
          JSON.stringify(card)
        );
    });

    // 分批次执行防止超出单次 batch 上限
    for (let i = 0; i < statements.length; i += 50) {
      const chunk = statements.slice(i, i + 50);
      await db.batch(chunk);
    }
  }

  // 5. 检查并预置 ST01 官方灰鸦小队新手卡组 (deck-1791110685763)
  const existingDeck = await db
    .prepare('SELECT id FROM decks WHERE id = ?')
    .bind('deck-1791110685763')
    .first<DbDeck>();

  if (!existingDeck) {
    const st01CardNumbers = [
      'ST01-001', 'ST01-001',
      'ST01-002', 'ST01-002', 'ST01-002', 'ST01-002',
      'ST01-003', 'ST01-003', 'ST01-003', 'ST01-003',
      'ST01-004', 'ST01-004', 'ST01-004', 'ST01-004',
      'ST01-005', 'ST01-005', 'ST01-005', 'ST01-005',
      'ST01-006', 'ST01-006', 'ST01-006', 'ST01-006',
      'ST01-007', 'ST01-007', 'ST01-007', 'ST01-007',
      'ST01-008', 'ST01-008',
      'ST01-009', 'ST01-009',
      'ST01-010', 'ST01-010', 'ST01-010', 'ST01-010',
      'ST01-011', 'ST01-011', 'ST01-011', 'ST01-011',
      'ST01-012', 'ST01-012', 'ST01-012', 'ST01-012',
      'ST01-013', 'ST01-013', 'ST01-013', 'ST01-013',
      'ST01-014', 'ST01-014', 'ST01-014', 'ST01-014',
    ];

    const cardsArray = st01CardNumbers.map((cNum) => ({
      cardNumber: cNum,
      cardId: `card-${cNum.toLowerCase()}`,
      count: 1,
    }));

    await db
      .prepare(`
        INSERT INTO decks (id, user_id, name, cards_json, is_valid, created_at, updated_at)
        VALUES (?, ?, ?, ?, 1, ?, ?)
      `)
      .bind(
        'deck-1791110685763',
        'system',
        '灰鸦小队·官方预组 (ST01)',
        JSON.stringify(cardsArray),
        Date.now(),
        Date.now()
      )
      .run();
  }
}

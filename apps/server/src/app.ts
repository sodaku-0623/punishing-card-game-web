import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import fastifyJwt from '@fastify/jwt';
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { Server as SocketIOServer } from 'socket.io';
import { ClientToServerEvents, ServerToClientEvents } from '@zhanshuang/shared';
import {
  IRoomRepository,
  IDeckRepository,
  IGameRepository,
  ICardRepository,
  IUserRepository,
  MemoryRoomRepository,
  MemoryDeckRepository,
  MemoryGameRepository,
  MemoryCardRepository,
  MemoryUserRepository,
  OFFICIAL_SEED_CARDS,
  CardCreateInput,
  Role,
} from '@zhanshuang/database';
import { RoomManager } from './services/room-manager.js';
import { GameSessionManager } from './services/game-session-manager.js';
import { setupSocketGateway, MAX_SOCKET_BUFFER_BYTES } from './socket/gateway.js';
import {
  validateDeck,
  DeckCardInput,
  OFFICIAL_STARTER_DECKS,
  findOfficialStarterDeck,
} from '@zhanshuang/game-rules';
import { MetricsService } from './services/metrics-service.js';

const SCRYPT_PREFIX = 'scrypt';
const SCRYPT_KEY_LENGTH = 64;
const LEGACY_PASSWORD_SALT = 'zhanshuang_tcg_salt_2026';
const HEX_PATTERN = /^[0-9a-f]+$/i;

const scryptAsync = promisify(crypto.scrypt) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number
) => Promise<Buffer>;

function isValidEvenHex(value: string): boolean {
  return value.length > 0 && value.length % 2 === 0 && HEX_PATTERN.test(value);
}

/**
 * 使用异步 scrypt + 每用户随机盐生成密码摘要，格式: scrypt:<saltHex>:<hashHex>
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const hash = await scryptAsync(password, salt, SCRYPT_KEY_LENGTH);
  return `${SCRYPT_PREFIX}:${salt.toString('hex')}:${hash.toString('hex')}`;
}

function legacyHashPassword(password: string): string {
  return crypto.createHmac('sha256', LEGACY_PASSWORD_SALT).update(password).digest('hex');
}

function timingSafeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ab.length > 0 && ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

/**
 * 异步校验密码；校验 hex 格式与合理 keylen 防止畸形存储串抛异常，兼容旧版 HMAC 摘要
 */
export async function verifyPassword(
  password: string,
  stored: string
): Promise<{ ok: boolean; needsRehash: boolean }> {
  if (typeof password !== 'string' || typeof stored !== 'string' || !stored) {
    return { ok: false, needsRehash: false };
  }
  if (stored.startsWith(`${SCRYPT_PREFIX}:`)) {
    const parts = stored.split(':');
    if (parts.length !== 3) return { ok: false, needsRehash: false };
    const [, saltHex, hashHex] = parts;
    if (!saltHex || !hashHex || !isValidEvenHex(saltHex) || !isValidEvenHex(hashHex)) {
      return { ok: false, needsRehash: false };
    }
    const keylen = hashHex.length / 2;
    if (!Number.isInteger(keylen) || keylen < 16 || keylen > 128) {
      return { ok: false, needsRehash: false };
    }
    try {
      const hash = await scryptAsync(password, Buffer.from(saltHex, 'hex'), keylen);
      return { ok: timingSafeEqualHex(hash.toString('hex'), hashHex), needsRehash: false };
    } catch {
      return { ok: false, needsRehash: false };
    }
  }
  if (!isValidEvenHex(stored)) {
    return { ok: false, needsRehash: false };
  }
  const ok = timingSafeEqualHex(legacyHashPassword(password), stored);
  return { ok, needsRehash: ok };
}

/**
 * JWT 密钥：未显式配置时为每个进程生成随机密钥 (用户数据为内存存储，重启后本就需要重新登录)，
 * 杜绝使用源码中公开的默认密钥伪造管理员令牌。
 */
function resolveJwtSecret(explicit?: string): string {
  const configured = explicit || process.env.JWT_SECRET;
  if (configured) return configured;
  if (process.env.NODE_ENV !== 'test') {
    console.warn('⚠️  未配置 JWT_SECRET，已为本次进程生成随机密钥（重启后所有登录凭据将失效）。');
  }
  return crypto.randomBytes(32).toString('hex');
}

/**
 * 默认管理员密码：生产环境必须通过 ADMIN_PASSWORD 显式配置，否则生成随机密码并打印到控制台。
 */
function resolveDefaultAdminPassword(): string {
  if (process.env.ADMIN_PASSWORD) return process.env.ADMIN_PASSWORD;
  // 仅自动化测试使用固定密码；其余任何环境都不存在默认管理员密码
  // (经 index.ts 启动时，未配置的 ADMIN_PASSWORD 已被生成并持久化到 .env)
  if (process.env.NODE_ENV === 'test') return 'admin888';
  const generated = crypto.randomBytes(9).toString('base64url');
  console.warn(`⚠️  未配置 ADMIN_PASSWORD，已生成默认管理员 admin 的随机密码: ${generated}`);
  return generated;
}

const JWT_EXPIRES_IN = '7d';

/** 解析分页数量参数，限制在 [1, max] 区间，防止超大查询 */
function clampTake(raw: unknown, fallback: number, max = 1000): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, max);
}

function isPlainObject(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function getQueryString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function parseOptionalFiniteNumber(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const num = Number(trimmed);
  return Number.isFinite(num) ? num : undefined;
}

interface NormalizedDeckCardEntry {
  cardId?: string;
  cardNumber?: string;
  count: number;
  imageUrl?: string;
}

function validateDeckCardsPayload(
  cards: unknown
): { ok: true; items: NormalizedDeckCardEntry[] } | { ok: false; error: string } {
  if (!Array.isArray(cards) || cards.length > 200) {
    return { ok: false, error: '卡牌列表格式或条目数量非法' };
  }
  const items: NormalizedDeckCardEntry[] = [];
  for (const item of cards) {
    if (!isPlainObject(item)) {
      return { ok: false, error: '卡牌条目格式非法，必须为对象' };
    }
    if (typeof item.count !== 'number' || !Number.isInteger(item.count) || item.count <= 0) {
      return { ok: false, error: '卡牌数量必须为正整数' };
    }
    if (item.cardId !== undefined && typeof item.cardId !== 'string') {
      return { ok: false, error: '卡牌 ID 格式非法，必须为字符串' };
    }
    if (item.cardNumber !== undefined && typeof item.cardNumber !== 'string') {
      return { ok: false, error: '卡牌编号格式非法，必须为字符串' };
    }
    if (item.imageUrl !== undefined && typeof item.imageUrl !== 'string') {
      return { ok: false, error: '卡图地址格式非法，必须为字符串' };
    }
    items.push({
      cardId: item.cardId,
      cardNumber: item.cardNumber,
      count: item.count,
      imageUrl: item.imageUrl,
    });
  }
  return { ok: true, items };
}

async function resolveAndValidateDeckCards(
  cardRepo: ICardRepository,
  items: NormalizedDeckCardEntry[]
) {
  const populatedCards: DeckCardInput[] = [];
  const normalizedCards: { cardId: string; count: number; imageUrl?: string }[] = [];
  for (const item of items) {
    let c = item.cardId ? await cardRepo.findById(item.cardId) : null;
    if (!c && item.cardNumber) {
      c = await cardRepo.findByCardNumber(item.cardNumber);
    }
    if (!c && item.cardId) {
      const cleaned = item.cardId
        .replace(/^c-/, '')
        .replace(/-champion$/i, '【冠军】')
        .toUpperCase();
      c = await cardRepo.findByCardNumber(cleaned);
    }
    if (c) {
      normalizedCards.push({ cardId: c.id, count: item.count, imageUrl: item.imageUrl });
      populatedCards.push({
        cardId: c.id,
        cardNumber: c.cardNumber,
        name: c.name,
        signalOrb: c.signalOrb as any,
        count: item.count,
      });
    }
  }
  const valResult = validateDeck(populatedCards);
  return { normalizedCards, valResult };
}

function validateCardCreateInput(
  raw: unknown
): { ok: true; data: CardCreateInput } | { ok: false; error: string } {
  if (!isPlainObject(raw)) {
    return { ok: false, error: '卡牌数据格式非法，必须为对象' };
  }
  if (
    typeof raw.cardNumber !== 'string' ||
    !raw.cardNumber.trim() ||
    typeof raw.name !== 'string' ||
    !raw.name.trim() ||
    typeof raw.cardType !== 'string' ||
    !raw.cardType.trim()
  ) {
    return { ok: false, error: '缺少卡牌关键字段 (cardNumber, name, cardType)' };
  }
  if (raw.attribute !== undefined && typeof raw.attribute !== 'string') {
    return { ok: false, error: '卡牌属性 attribute 必须为字符串' };
  }
  if (raw.cost !== undefined && !isFiniteNumber(raw.cost)) {
    return { ok: false, error: '卡牌费用 cost 必须为有限数字' };
  }
  if (raw.basePP !== undefined && raw.basePP !== null && !isFiniteNumber(raw.basePP)) {
    return { ok: false, error: '卡牌基础 PP 必须为有限数字或 null' };
  }
  if (raw.baseDP !== undefined && raw.baseDP !== null && !isFiniteNumber(raw.baseDP)) {
    return { ok: false, error: '卡牌基础 DP 必须为有限数字或 null' };
  }
  if (raw.signalOrb !== undefined && raw.signalOrb !== null && typeof raw.signalOrb !== 'string') {
    return { ok: false, error: '信号球类型 signalOrb 必须为字符串或 null' };
  }
  if (raw.traits !== undefined && !isStringArray(raw.traits)) {
    return { ok: false, error: '卡牌特征 traits 必须为字符串数组' };
  }
  if (raw.isInstant !== undefined && typeof raw.isInstant !== 'boolean') {
    return { ok: false, error: 'isInstant 必须为布尔值' };
  }
  if (raw.imageUrl !== undefined && raw.imageUrl !== null && typeof raw.imageUrl !== 'string') {
    return { ok: false, error: 'imageUrl 必须为字符串或 null' };
  }
  if (raw.rulesText !== undefined && typeof raw.rulesText !== 'string') {
    return { ok: false, error: 'rulesText 必须为字符串' };
  }
  if (raw.flavorText !== undefined && raw.flavorText !== null && typeof raw.flavorText !== 'string') {
    return { ok: false, error: 'flavorText 必须为字符串或 null' };
  }

  return {
    ok: true,
    data: {
      cardNumber: raw.cardNumber.trim(),
      name: raw.name.trim(),
      cardType: raw.cardType as any,
      attribute: raw.attribute as any,
      cost: isFiniteNumber(raw.cost) ? raw.cost : 0,
      basePP: isFiniteNumber(raw.basePP) ? raw.basePP : null,
      baseDP: isFiniteNumber(raw.baseDP) ? raw.baseDP : null,
      signalOrb: (raw.signalOrb ?? null) as any,
      traits: Array.isArray(raw.traits) ? raw.traits : [],
      isInstant: typeof raw.isInstant === 'boolean' ? raw.isInstant : false,
      imageUrl: raw.imageUrl ?? null,
      rulesText: typeof raw.rulesText === 'string' ? raw.rulesText : '',
      flavorText: raw.flavorText ?? null,
    },
  };
}

function validateCardUpdateInput(
  raw: unknown
):
  | {
      ok: true;
      updateData: Partial<CardCreateInput> & { isActive?: boolean };
      errataReason?: string;
    }
  | { ok: false; error: string } {
  if (!isPlainObject(raw)) {
    return { ok: false, error: '请求体格式非法，必须为对象' };
  }
  if (raw.cardNumber !== undefined && (typeof raw.cardNumber !== 'string' || !raw.cardNumber.trim())) {
    return { ok: false, error: 'cardNumber 必须为非空字符串' };
  }
  if (raw.name !== undefined && (typeof raw.name !== 'string' || !raw.name.trim())) {
    return { ok: false, error: 'name 必须为非空字符串' };
  }
  if (raw.cardType !== undefined && (typeof raw.cardType !== 'string' || !raw.cardType.trim())) {
    return { ok: false, error: 'cardType 必须为非空字符串' };
  }
  if (raw.attribute !== undefined && typeof raw.attribute !== 'string') {
    return { ok: false, error: 'attribute 必须为字符串' };
  }
  if (raw.cost !== undefined && !isFiniteNumber(raw.cost)) {
    return { ok: false, error: 'cost 必须为有限数字' };
  }
  if (raw.basePP !== undefined && raw.basePP !== null && !isFiniteNumber(raw.basePP)) {
    return { ok: false, error: 'basePP 必须为有限数字或 null' };
  }
  if (raw.baseDP !== undefined && raw.baseDP !== null && !isFiniteNumber(raw.baseDP)) {
    return { ok: false, error: 'baseDP 必须为有限数字或 null' };
  }
  if (raw.signalOrb !== undefined && raw.signalOrb !== null && typeof raw.signalOrb !== 'string') {
    return { ok: false, error: 'signalOrb 必须为字符串或 null' };
  }
  if (raw.traits !== undefined && !isStringArray(raw.traits)) {
    return { ok: false, error: 'traits 必须为字符串数组' };
  }
  if (raw.isInstant !== undefined && typeof raw.isInstant !== 'boolean') {
    return { ok: false, error: 'isInstant 必须为布尔值' };
  }
  if (raw.isActive !== undefined && typeof raw.isActive !== 'boolean') {
    return { ok: false, error: 'isActive 必须为布尔值' };
  }
  if (raw.imageUrl !== undefined && raw.imageUrl !== null && typeof raw.imageUrl !== 'string') {
    return { ok: false, error: 'imageUrl 必须为字符串或 null' };
  }
  if (raw.rulesText !== undefined && typeof raw.rulesText !== 'string') {
    return { ok: false, error: 'rulesText 必须为字符串' };
  }
  if (raw.flavorText !== undefined && raw.flavorText !== null && typeof raw.flavorText !== 'string') {
    return { ok: false, error: 'flavorText 必须为字符串或 null' };
  }
  if (raw.errataReason !== undefined && typeof raw.errataReason !== 'string') {
    return { ok: false, error: 'errataReason 必须为字符串' };
  }

  // 字段白名单：禁止覆写 id / currentVersion 等系统受控字段
  const updateData: Partial<CardCreateInput> & { isActive?: boolean } = {};
  if (raw.cardNumber !== undefined) updateData.cardNumber = raw.cardNumber.trim();
  if (raw.name !== undefined) updateData.name = raw.name.trim();
  if (raw.cardType !== undefined) updateData.cardType = raw.cardType as any;
  if (raw.attribute !== undefined) updateData.attribute = raw.attribute as any;
  if (raw.cost !== undefined) updateData.cost = raw.cost;
  if (raw.basePP !== undefined) updateData.basePP = raw.basePP;
  if (raw.baseDP !== undefined) updateData.baseDP = raw.baseDP;
  if (raw.signalOrb !== undefined) updateData.signalOrb = raw.signalOrb as any;
  if (raw.traits !== undefined) updateData.traits = raw.traits;
  if (raw.isInstant !== undefined) updateData.isInstant = raw.isInstant;
  if (raw.isActive !== undefined) updateData.isActive = raw.isActive;
  if (raw.imageUrl !== undefined) updateData.imageUrl = raw.imageUrl;
  if (raw.rulesText !== undefined) updateData.rulesText = raw.rulesText;
  if (raw.flavorText !== undefined) updateData.flavorText = raw.flavorText;

  return {
    ok: true,
    updateData,
    errataReason: typeof raw.errataReason === 'string' ? raw.errataReason : undefined,
  };
}

export interface AppComponents {
  fastify: FastifyInstance;
  io: SocketIOServer<ClientToServerEvents, ServerToClientEvents>;
  roomMgr: RoomManager;
  gameSessionMgr: GameSessionManager;
  userRepo: IUserRepository;
}

export async function createServerApp(options?: {
  roomRepo?: IRoomRepository;
  cardRepo?: ICardRepository;
  deckRepo?: IDeckRepository;
  gameRepo?: IGameRepository;
  userRepo?: IUserRepository;
  corsOrigin?: string;
  jwtSecret?: string;
}): Promise<AppComponents> {
  const fastify = Fastify({ logger: false, bodyLimit: 256 * 1024 });

  fastify.setErrorHandler((err, _req, reply) => {
    const statusCode =
      typeof (err as { statusCode?: unknown }).statusCode === 'number'
        ? (err as { statusCode: number }).statusCode
        : 500;
    const code = (err as { code?: unknown }).code;
    if (statusCode === 413 || code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
      return reply.code(413).send({ success: false, error: '请求体超过大小限制' });
    }
    if (statusCode >= 400 && statusCode < 500) {
      return reply.code(statusCode).send({
        success: false,
        error: err instanceof Error ? err.message : '请求参数非法',
      });
    }
    console.error('Server Error:', err);
    return reply.code(statusCode >= 500 ? statusCode : 500).send({
      success: false,
      error: '服务端内部错误',
    });
  });

  // 按 IP 的认证端点内存限流器（放在闭包内以隔离各单测实例）
  const AUTH_RATE_LIMIT_WINDOW_MS = 60_000;
  const authRateLimits = new Map<string, number[]>();
  let rateLimitCleanupTicks = 0;

  function isAuthRateLimited(bucket: string, ip: string, maxRequests: number): boolean {
    const now = Date.now();
    const cutoff = now - AUTH_RATE_LIMIT_WINDOW_MS;
    rateLimitCleanupTicks++;
    if (rateLimitCleanupTicks >= 100 || authRateLimits.size > 500) {
      rateLimitCleanupTicks = 0;
      for (const [k, timestamps] of authRateLimits.entries()) {
        const active = timestamps.filter((t) => t > cutoff);
        if (active.length === 0) {
          authRateLimits.delete(k);
        } else {
          authRateLimits.set(k, active);
        }
      }
    }

    const key = `${bucket}:${ip || 'unknown'}`;
    const recent = (authRateLimits.get(key) ?? []).filter((t) => t > cutoff);
    if (recent.length >= maxRequests) {
      authRateLimits.set(key, recent);
      return true;
    }
    recent.push(now);
    authRateLimits.set(key, recent);
    return false;
  }

  await fastify.register(cors, {
    origin: (_origin, cb) => {
      // 允许任何源（本地、局域网、内网穿透外网域名等）正常跨域并支持 credentials
      cb(null, true);
    },
    credentials: true,
  });

  await fastify.register(fastifyJwt, {
    secret: resolveJwtSecret(options?.jwtSecret),
    sign: { expiresIn: JWT_EXPIRES_IN },
  });

  fastify.get('/health', async () => {
    return { status: 'ok', service: 'zhanshuang-server', timestamp: Date.now() };
  });

  const cardRepo = options?.cardRepo ?? new MemoryCardRepository();
  if (!options?.cardRepo) {
    await cardRepo.batchImport(OFFICIAL_SEED_CARDS);
  }

  const roomRepo = options?.roomRepo ?? new MemoryRoomRepository();
  const deckRepo = options?.deckRepo ?? new MemoryDeckRepository(cardRepo);
  const gameRepo = options?.gameRepo ?? new MemoryGameRepository();
  const userRepo = options?.userRepo ?? new MemoryUserRepository();

  // 预置默认管理员账号 (admin，密码见 ADMIN_PASSWORD) 与默认玩家账号
  const defaultAdmin = await userRepo.findByUsername('admin');
  if (!defaultAdmin) {
    await userRepo.create('admin', await hashPassword(resolveDefaultAdminPassword()), '总指挥·管理员', Role.ADMIN);
  }
  // 演示玩家账号仅在非生产环境预置
  const defaultPlayer = process.env.NODE_ENV === 'production' ? true : await userRepo.findByUsername('player1');
  if (!defaultPlayer) {
    await userRepo.create('player1', await hashPassword('123456'), '灰鸦指挥官·爱丽丝', Role.USER);
  }

  // 统一从 @zhanshuang/game-rules 的 OFFICIAL_STARTER_DECKS 种入官方预组卡组
  const allCards = await cardRepo.findMany({ take: 10000 });
  const cardMap: Record<string, string> = {};
  for (const c of allCards.cards) {
    cardMap[c.cardNumber] = c.id;
  }

  for (const starter of OFFICIAL_STARTER_DECKS) {
    const existing = await deckRepo.findById(starter.id);
    const deck = existing ?? (await deckRepo.create('system', starter.name, starter.description, starter.id));
    const seedCards = starter.cards
      .map((c) => {
        const resolvedCardId = cardMap[c.cardNumber];
        return resolvedCardId
          ? { cardId: resolvedCardId, count: c.count, imageUrl: c.imageUrl }
          : null;
      })
      .filter((c): c is { cardId: string; count: number; imageUrl: string } => c !== null);
    await deckRepo.setCards(deck.id, seedCards, true);
  }

  const roomMgr = new RoomManager(roomRepo, deckRepo, cardRepo);
  const gameSessionMgr = new GameSessionManager(gameRepo, deckRepo, cardRepo);

  // ==========================================
  // 鉴权中间件与身份校验 Hooks
  // ==========================================
  const verifyUser = async (req: any, reply: any) => {
    try {
      await req.jwtVerify();
      if (req.user?.role === 'GUEST' || req.user?.isGuest) {
        return reply.code(401).send({ success: false, error: '游客身份无权执行此操作，请先登录注册账号' });
      }
    } catch (err) {
      return reply.code(401).send({ success: false, error: '未登录或登录凭据已过期，请重新登录' });
    }
  };

  const verifyAdmin = async (req: any, reply: any) => {
    try {
      await req.jwtVerify();
      if (req.user?.role !== 'ADMIN') {
        return reply.code(403).send({ success: false, error: '权限不足：仅系统管理员账号可执行此操作' });
      }
    } catch (err) {
      return reply.code(401).send({ success: false, error: '未登录或登录凭据已过期，请以管理员身份登录' });
    }
  };

  // ==========================================
  // 用户身份认证与权限管理 (Auth APIs)
  // ==========================================
  fastify.post('/api/auth/register', async (req, reply) => {
    if (isAuthRateLimited('register', req.ip, 20)) {
      return reply.code(429).send({ success: false, error: '注册请求过于频繁，请稍后再试' });
    }
    if (!isPlainObject(req.body)) {
      return reply.code(400).send({ success: false, error: '请求体格式非法' });
    }
    const body = req.body;
    if (typeof body.username !== 'string' || typeof body.password !== 'string') {
      return reply.code(400).send({ success: false, error: '用户名和密码必须为字符串' });
    }
    if (body.nickname !== undefined && typeof body.nickname !== 'string') {
      return reply.code(400).send({ success: false, error: '昵称格式非法，必须为字符串' });
    }
    if (!body.username.trim() || !body.password) {
      return reply.code(400).send({ success: false, error: '用户名和密码不能为空' });
    }
    const trimmedUsername = body.username.trim();
    if (trimmedUsername.length < 3 || trimmedUsername.length > 32) {
      return reply.code(400).send({ success: false, error: '用户名长度需为 3~32 个字符' });
    }
    if (body.password.length < 6 || body.password.length > 128) {
      return reply.code(400).send({ success: false, error: '密码长度需为 6~128 个字符' });
    }
    const existing = await userRepo.findByUsername(trimmedUsername);
    if (existing) {
      return reply.code(409).send({ success: false, error: '用户名已被注册，请尝试其他名称' });
    }
    const nickname = ((typeof body.nickname === 'string' ? body.nickname.trim() : '') || trimmedUsername).slice(0, 32);
    const passwordHash = await hashPassword(body.password);
    const user = await userRepo.create(trimmedUsername, passwordHash, nickname, Role.USER);
    const token = fastify.jwt.sign({
      userId: user.id,
      username: user.username,
      nickname: user.nickname,
      role: user.role,
    });
    const userSummary = {
      id: user.id,
      username: user.username,
      nickname: user.nickname,
      role: user.role,
    };
    return {
      success: true,
      token,
      user: userSummary,
      data: {
        token,
        user: userSummary,
      },
    };
  });

  fastify.post('/api/auth/login', async (req, reply) => {
    if (isAuthRateLimited('login', req.ip, 20)) {
      return reply.code(429).send({ success: false, error: '登录尝试过于频繁，请稍后再试' });
    }
    if (!isPlainObject(req.body)) {
      return reply.code(400).send({ success: false, error: '请求体格式非法' });
    }
    const body = req.body;
    if (
      typeof body.username !== 'string' ||
      typeof body.password !== 'string' ||
      !body.username.trim() ||
      !body.password
    ) {
      return reply.code(400).send({ success: false, error: '请输入用户名和密码' });
    }
    if (body.password.length > 128) {
      return reply.code(400).send({ success: false, error: '密码长度不能超过 128 个字符' });
    }
    const user = await userRepo.findByUsername(body.username.trim());
    const verification = user
      ? await verifyPassword(body.password, user.passwordHash)
      : { ok: false, needsRehash: false };
    if (!user || !verification.ok) {
      return reply.code(401).send({ success: false, error: '用户名或密码错误' });
    }
    if (verification.needsRehash) {
      await userRepo.update(user.id, { passwordHash: await hashPassword(body.password) });
    }
    const token = fastify.jwt.sign({
      userId: user.id,
      username: user.username,
      nickname: user.nickname,
      role: user.role,
    });
    const userSummary = {
      id: user.id,
      username: user.username,
      nickname: user.nickname,
      role: user.role,
    };
    return {
      success: true,
      token,
      user: userSummary,
      data: {
        token,
        user: userSummary,
      },
    };
  });

  /**
   * 签发或刷新签名游客凭据：防止客户端自报伪造他人 guestId
   */
  fastify.post('/api/auth/guest', async (req, reply) => {
    if (isAuthRateLimited('guest', req.ip, 60)) {
      return reply.code(429).send({ success: false, error: '游客登录请求过于频繁，请稍后再试' });
    }
    const rawBody = isPlainObject(req.body) ? req.body : {};
    const authHeader = req.headers.authorization;
    const candidateToken =
      (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
        ? authHeader.substring(7).trim()
        : '') || (typeof rawBody.token === 'string' ? rawBody.token.trim() : '');

    let guestId: string | null = null;
    let existingNickname = '';
    if (candidateToken) {
      try {
        const payload = fastify.jwt.verify<{
          userId?: string;
          nickname?: string;
          role?: string;
          isGuest?: boolean;
        }>(candidateToken);
        if (
          payload?.userId &&
          payload.userId.startsWith('guest_') &&
          (payload.role === 'GUEST' || payload.isGuest)
        ) {
          const collision = await userRepo.findById(payload.userId);
          if (!collision) {
            guestId = payload.userId;
            existingNickname = payload.nickname || '';
          }
        }
      } catch {
        // 失效或不可信游客令牌，重新签发
      }
    }

    if (!guestId) {
      guestId = `guest_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
    }
    const requestedNickname =
      typeof rawBody.nickname === 'string' ? rawBody.nickname.trim().slice(0, 32) : '';
    const nickname = requestedNickname || existingNickname || `指挥官_${guestId.slice(0, 8)}`;

    const token = fastify.jwt.sign({
      userId: guestId,
      username: guestId,
      nickname,
      role: 'GUEST',
      isGuest: true,
    });
    const guestSummary = { id: guestId, username: guestId, nickname, role: 'GUEST' as const };
    return {
      success: true,
      token,
      user: guestSummary,
      data: {
        token,
        guest: { id: guestId, nickname },
      },
    };
  });

  fastify.get('/api/auth/me', { preHandler: [verifyUser] }, async (req: any, reply) => {
    const user = await userRepo.findById(req.user.userId);
    if (!user) {
      return reply.code(404).send({ success: false, error: '用户不存在' });
    }
    const userSummary = {
      id: user.id,
      username: user.username,
      nickname: user.nickname,
      role: user.role,
    };
    return {
      success: true,
      user: userSummary,
      data: {
        user: userSummary,
      },
    };
  });

  fastify.put('/api/auth/profile', { preHandler: [verifyUser] }, async (req: any, reply) => {
    if (!isPlainObject(req.body)) {
      return reply.code(400).send({ success: false, error: '请求体格式非法' });
    }
    const body = req.body;
    if (typeof body.nickname !== 'string' || !body.nickname.trim()) {
      return reply.code(400).send({ success: false, error: '昵称/指挥官名称不能为空' });
    }
    const updated = await userRepo.update(req.user.userId, { nickname: body.nickname.trim().slice(0, 32) });
    if (!updated) {
      return reply.code(404).send({ success: false, error: '用户不存在' });
    }
    const token = fastify.jwt.sign({
      userId: updated.id,
      username: updated.username,
      nickname: updated.nickname,
      role: updated.role,
    });
    const userSummary = {
      id: updated.id,
      username: updated.username,
      nickname: updated.nickname,
      role: updated.role,
    };
    return {
      success: true,
      token,
      user: userSummary,
      data: {
        token,
        user: userSummary,
        nickname: updated.nickname,
      },
    };
  });

  // REST API 路由
  fastify.get('/api/rooms', async () => {
    return { success: true, data: roomMgr.listRooms() };
  });

  fastify.post('/api/rooms', { preHandler: [verifyAdmin] }, async (req, reply) => {
    if (!isPlainObject(req.body)) {
      return reply.code(400).send({ success: false, error: '请求体格式非法' });
    }
    const body = req.body;
    if (body.password !== undefined && typeof body.password !== 'string') {
      return reply.code(400).send({ success: false, error: '房间密码格式非法，必须为字符串' });
    }
    const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim() : '空中花园特遣战术室';
    const creatorId = typeof body.creatorId === 'string' && body.creatorId.trim() ? body.creatorId.trim() : 'host';
    const creatorName = typeof body.creatorName === 'string' && body.creatorName.trim() ? body.creatorName.trim() : '指挥官';
    const customRoomId = typeof body.roomId === 'string' && body.roomId.trim() ? body.roomId.trim() : undefined;
    const res = await roomMgr.createRoom(creatorId, creatorName, title, body.password, customRoomId);
    return res;
  });

  fastify.get('/api/rooms/:idOrCode', async (req, reply) => {
    const { idOrCode } = req.params as { idOrCode: string };
    const room = roomMgr.findRoomByIdOrCode(idOrCode) || roomMgr.getRoom(idOrCode);
    if (!room) {
      return reply.code(404).send({ success: false, error: '指定 Room ID 或房间代码不存在' });
    }
    return { success: true, data: room };
  });

  fastify.delete('/api/rooms/:id', { preHandler: [verifyAdmin] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const ok = await roomMgr.closeRoom(id);
    if (!ok) {
      return reply.code(404).send({ success: false, error: '房间不存在或已关闭' });
    }
    return { success: true, message: '房间已关闭' };
  });

  fastify.get('/api/decks', async (req) => {
    const rawUserId = getQueryString((req.query as any)?.userId);
    const userId = rawUserId?.trim() || undefined;
    const systemDecks = await deckRepo.findByUserId('system');
    const userDecks = userId && userId !== 'system' ? await deckRepo.findByUserId(userId) : [];
    const seenIds = new Set<string>();
    const deduped = [];
    for (const d of [...systemDecks, ...userDecks]) {
      if (!seenIds.has(d.id)) {
        seenIds.add(d.id);
        deduped.push(d);
      }
    }
    return { success: true, data: deduped };
  });

  fastify.get('/api/decks/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const resolvedId = findOfficialStarterDeck(id)?.id ?? id;
    const deck = await deckRepo.findById(resolvedId);
    if (!deck) {
      return reply.code(404).send({ success: false, error: 'Deck not found' });
    }
    return { success: true, data: deck };
  });

  fastify.post('/api/decks', { preHandler: [verifyUser] }, async (req: any, reply) => {
    if (!isPlainObject(req.body)) {
      return reply.code(400).send({ success: false, error: '请求体格式非法' });
    }
    const body = req.body;
    if (body.id !== undefined && typeof body.id !== 'string') {
      return reply.code(400).send({ success: false, error: '卡组 ID 格式非法，必须为字符串' });
    }
    if (body.name !== undefined && typeof body.name !== 'string') {
      return reply.code(400).send({ success: false, error: '卡组名称格式非法，必须为字符串' });
    }
    if (body.description !== undefined && typeof body.description !== 'string') {
      return reply.code(400).send({ success: false, error: '卡组描述格式非法，必须为字符串' });
    }

    let validatedCards: NormalizedDeckCardEntry[] | undefined;
    if (body.cards !== undefined) {
      const check = validateDeckCardsPayload(body.cards);
      if (!check.ok) {
        return reply.code(400).send({ success: false, error: check.error });
      }
      validatedCards = check.items;
    }

    const userId = req.user.userId as string;
    const targetDeckId = typeof body.id === 'string' && body.id.trim() ? body.id.trim() : undefined;
    if (targetDeckId && findOfficialStarterDeck(targetDeckId)) {
      return reply.code(403).send({ success: false, error: '系统预组只读，不可修改' });
    }
    let deck = targetDeckId ? await deckRepo.findById(targetDeckId) : null;
    if (deck && (deck.userId === 'system' || deck.userId !== userId)) {
      return reply.code(403).send({ success: false, error: '无权修改系统预组或其他玩家的卡组' });
    }
    const deckName = typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 64) : '未命名卡组';

    if (!deck) {
      deck = await deckRepo.create(userId, deckName, body.description, targetDeckId);
    } else {
      deck = await deckRepo.update(deck.id, deckName, body.description);
    }
    let valResult: any = undefined;
    if (validatedCards !== undefined) {
      const resolved = await resolveAndValidateDeckCards(cardRepo, validatedCards);
      valResult = resolved.valResult;
      await deckRepo.setCards(
        deck.id,
        resolved.normalizedCards,
        valResult.isValid,
        valResult.errors.join('; ')
      );
    }
    const updated = await deckRepo.findById(deck.id);
    return { success: true, data: updated, validation: valResult };
  });

  fastify.put('/api/decks/:id', { preHandler: [verifyUser] }, async (req: any, reply) => {
    const { id } = req.params as { id: string };
    if (!isPlainObject(req.body)) {
      return reply.code(400).send({ success: false, error: '请求体格式非法' });
    }
    const body = req.body;
    if (body.name !== undefined && typeof body.name !== 'string') {
      return reply.code(400).send({ success: false, error: '卡组名称格式非法，必须为字符串' });
    }
    if (body.description !== undefined && typeof body.description !== 'string') {
      return reply.code(400).send({ success: false, error: '卡组描述格式非法，必须为字符串' });
    }

    let validatedCards: NormalizedDeckCardEntry[] | undefined;
    if (body.cards !== undefined) {
      const check = validateDeckCardsPayload(body.cards);
      if (!check.ok) {
        return reply.code(400).send({ success: false, error: check.error });
      }
      validatedCards = check.items;
    }

    if (findOfficialStarterDeck(id)) {
      return reply.code(403).send({ success: false, error: '系统预组不可修改' });
    }
    let deck = await deckRepo.findById(id);
    if (!deck) {
      return reply.code(404).send({ success: false, error: 'Deck not found' });
    }
    if (deck.userId === 'system' || deck.userId !== req.user.userId) {
      return reply.code(403).send({ success: false, error: deck.userId === 'system' ? '系统预组不可修改' : '无权修改其他玩家的卡组' });
    }

    if (body.name !== undefined || body.description !== undefined) {
      const nextName = typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 64) : undefined;
      deck = await deckRepo.update(id, nextName, body.description);
    }
    let valResult: any = undefined;
    if (validatedCards !== undefined) {
      const resolved = await resolveAndValidateDeckCards(cardRepo, validatedCards);
      valResult = resolved.valResult;
      deck = await deckRepo.setCards(
        id,
        resolved.normalizedCards,
        valResult.isValid,
        valResult.errors.join('; ')
      );
    }
    return { success: true, data: deck, validation: valResult };
  });

  fastify.delete('/api/decks/:id', { preHandler: [verifyUser] }, async (req: any, reply) => {
    const { id } = req.params as { id: string };
    if (findOfficialStarterDeck(id)) {
      return reply.code(403).send({ success: false, error: '系统预组不可删除' });
    }
    const existing = await deckRepo.findById(id);
    if (!existing) {
      return reply.code(404).send({ success: false, error: 'Deck not found' });
    }
    if (existing.userId === 'system' || existing.userId !== req.user.userId) {
      return reply.code(403).send({ success: false, error: existing.userId === 'system' ? '系统预组不可删除' : '无权删除其他玩家的卡组' });
    }
    const deleted = await deckRepo.delete(id);
    return { success: deleted };
  });

  fastify.get('/api/cards', async (req) => {
    const query = isPlainObject(req.query) ? req.query : {};
    const cards = await cardRepo.findMany({
      cardType: getQueryString(query.cardType) as any,
      attribute: getQueryString(query.attribute) as any,
      cost: parseOptionalFiniteNumber(query.cost),
      query: getQueryString(query.query),
      take: clampTake(query.take, 200),
    });
    return { success: true, data: cards.cards, total: cards.total };
  });

  fastify.get('/api/cards/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    let card = await cardRepo.findById(id);
    if (!card) {
      card = await cardRepo.findByCardNumber(id);
    }
    if (!card) {
      return reply.code(404).send({ success: false, error: 'Card not found' });
    }
    return { success: true, data: card };
  });

  // ==========================================
  // 管理控制台与运维接口 (Phase 9 Admin APIs, 需管理员身份)
  // ==========================================
  fastify.get('/api/admin/monitor', { preHandler: [verifyAdmin] }, async () => {
    const allRooms = roomMgr.listRooms();
    const activeSessions = gameSessionMgr.getActiveSessionCount();
    let connectedPlayers = 0;
    try {
      connectedPlayers = io.sockets.sockets.size;
    } catch {}

    const metrics = MetricsService.getInstance().getSummary({
      activeRooms: allRooms.length,
      activeGames: activeSessions,
      connectedPlayers,
    });

    return {
      success: true,
      data: metrics,
    };
  });

  fastify.get('/api/admin/stats', { preHandler: [verifyAdmin] }, async () => {
    const cardsRes = await cardRepo.findMany({ take: 1000, isActive: undefined });
    const activeCardsRes = await cardRepo.findMany({ take: 1000, isActive: true });
    const allRooms = roomMgr.listRooms();
    const activeSessions = gameSessionMgr.getActiveSessionCount();
    const mem = process.memoryUsage();

    return {
      success: true,
      data: {
        totalCards: cardsRes.total,
        activeCards: activeCardsRes.total,
        inactiveCards: cardsRes.total - activeCardsRes.total,
        activeRooms: allRooms.length,
        activeGames: activeSessions,
        uptimeSeconds: Math.floor(process.uptime()),
        memoryRssMb: Math.round(mem.rss / (1024 * 1024)),
        rulesEngineVersion: 'A0 First Edition (2025-11-14)',
        serverTimestamp: Date.now(),
      },
    };
  });

  fastify.get('/api/admin/cards', { preHandler: [verifyAdmin] }, async (req) => {
    const query = isPlainObject(req.query) ? req.query : {};
    const rawIsActive = getQueryString(query.isActive);
    let isActive: boolean | undefined = undefined;
    if (rawIsActive === 'true') isActive = true;
    if (rawIsActive === 'false') isActive = false;

    const cards = await cardRepo.findMany({
      cardType: getQueryString(query.cardType) as any,
      attribute: getQueryString(query.attribute) as any,
      cost: parseOptionalFiniteNumber(query.cost),
      query: getQueryString(query.query),
      take: clampTake(query.take, 500),
      isActive,
    });
    return { success: true, data: cards.cards, total: cards.total };
  });

  fastify.post('/api/admin/cards', { preHandler: [verifyAdmin] }, async (req, reply) => {
    const check = validateCardCreateInput(req.body);
    if (!check.ok) {
      return reply.code(400).send({ success: false, error: check.error });
    }
    const existing = await cardRepo.findByCardNumber(check.data.cardNumber);
    if (existing) {
      return reply.code(409).send({ success: false, error: `卡牌编号 [${check.data.cardNumber}] 已存在` });
    }
    const created = await cardRepo.create(check.data);
    return { success: true, data: created };
  });

  fastify.put('/api/admin/cards/:id', { preHandler: [verifyAdmin] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const check = validateCardUpdateInput(req.body);
    if (!check.ok) {
      return reply.code(400).send({ success: false, error: check.error });
    }
    let card = await cardRepo.findById(id);
    if (!card) {
      card = await cardRepo.findByCardNumber(id);
    }
    if (!card) {
      return reply.code(404).send({ success: false, error: 'Card not found' });
    }

    const snapshot = {
      ...card,
      ...check.updateData,
      errataReason:
        check.errataReason && check.errataReason.trim()
          ? check.errataReason
          : '管理员调整卡牌数值或效果文',
      updatedAt: new Date().toISOString(),
    };

    const updated = await cardRepo.update(card.id, check.updateData, snapshot);
    return { success: true, data: updated };
  });

  fastify.get('/api/admin/cards/:id/versions', { preHandler: [verifyAdmin] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    let card = await cardRepo.findById(id);
    if (!card) {
      card = await cardRepo.findByCardNumber(id);
    }
    if (!card) {
      return reply.code(404).send({ success: false, error: 'Card not found' });
    }
    const versions = await cardRepo.getVersions(card.id);
    return { success: true, data: versions };
  });

  fastify.post(
    '/api/admin/cards/batch',
    { preHandler: [verifyAdmin], bodyLimit: 2 * 1024 * 1024 },
    async (req, reply) => {
    if (!isPlainObject(req.body)) {
      return reply.code(400).send({ success: false, error: '请求体格式非法' });
    }
    const rawCards = req.body.cards;
    if (!Array.isArray(rawCards) || rawCards.length > 1000) {
      return reply.code(400).send({ success: false, error: '需提供 cards 数组且单次最多导入 1000 张' });
    }
    const normalizedCards: CardCreateInput[] = [];
    for (let i = 0; i < rawCards.length; i++) {
      const check = validateCardCreateInput(rawCards[i]);
      if (!check.ok) {
        return reply.code(400).send({ success: false, error: `第 ${i + 1} 张卡牌校验失败：${check.error}` });
      }
      normalizedCards.push(check.data);
    }
    const res = await cardRepo.batchImport(normalizedCards);
    return { success: true, data: res };
  });

  // ==========================================
  // 对局历史与回放接口 (Phase 10 Replay & History APIs)
  // ==========================================
  fastify.get('/api/history', async (req) => {
    const query = (req.query as any) || {};
    const limit = clampTake(query.limit, 50, 200);
    // 只列出已结束的对局：进行中对局的随机种子可用于复现洗牌、推算双方牌序与手牌 (与 Cloudflare 版一致)
    const games = (await gameRepo.listGames(limit)).filter((g) => g.finishedAt);
    return {
      success: true,
      data: games.map((g) => ({
        id: g.id,
        roomId: g.roomId,
        rngSeed: g.rngSeed.toString(),
        winnerUserId: g.winnerUserId,
        isDraw: g.isDraw,
        finishReason: g.finishReason,
        startedAt: g.startedAt,
        finishedAt: g.finishedAt,
      })),
    };
  });

  fastify.get('/api/replay/:gameId', async (req, reply) => {
    const { gameId } = req.params as { gameId: string };
    const replay = await gameRepo.getReplayData(gameId);
    // 进行中的对局不提供回放：种子与行动记录会泄露隐藏信息 (与 Cloudflare 版一致，按不存在处理)
    if (!replay || !replay.game.finishedAt) {
      return reply.code(404).send({ success: false, error: 'Replay not found' });
    }
    return {
      success: true,
      data: {
        game: {
          id: replay.game.id,
          roomId: replay.game.roomId,
          rngSeed: replay.game.rngSeed.toString(),
          winnerUserId: replay.game.winnerUserId,
          isDraw: replay.game.isDraw,
          finishReason: replay.game.finishReason,
          startedAt: replay.game.startedAt,
          finishedAt: replay.game.finishedAt,
        },
        players: replay.players || [],
        actions: replay.actions,
        events: replay.events,
      },
    };
  });

  const io = new SocketIOServer<ClientToServerEvents, ServerToClientEvents>(fastify.server, {
    cors: {
      origin: (_origin, callback) => callback(null, true),
      credentials: true,
    },
    maxHttpBufferSize: MAX_SOCKET_BUFFER_BYTES,
  });

  setupSocketGateway(io, roomMgr, gameSessionMgr, {
    resolveToken: async (token) => {
      try {
        const payload = fastify.jwt.verify<{
          userId: string;
          nickname?: string;
          role?: string;
          isGuest?: boolean;
        }>(token);
        if (!payload?.userId) return null;
        if (payload.role === 'GUEST' || payload.isGuest) {
          if (!payload.userId.startsWith('guest_')) return null;
          const collision = await userRepo.findById(payload.userId);
          if (collision) return null;
          return {
            userId: payload.userId,
            username: payload.nickname || `指挥官_${payload.userId.slice(0, 8)}`,
            isGuest: true,
          };
        }
        const user = await userRepo.findById(payload.userId);
        return user ? { userId: user.id, username: user.nickname || user.username, isGuest: false } : null;
      } catch {
        return null;
      }
    },
    isRegisteredUserId: async (id) => !!(await userRepo.findById(id)),
  });

  return { fastify, io, roomMgr, gameSessionMgr, userRepo };
}

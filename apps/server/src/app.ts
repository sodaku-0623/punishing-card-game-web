import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import fastifyJwt from '@fastify/jwt';
import crypto from 'node:crypto';
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
import { setupSocketGateway } from './socket/gateway.js';
import { validateDeck, DeckCardInput } from '@zhanshuang/game-rules';
import { MetricsService } from './services/metrics-service.js';

const SCRYPT_PREFIX = 'scrypt';
const SCRYPT_KEY_LENGTH = 64;
const LEGACY_PASSWORD_SALT = 'zhanshuang_tcg_salt_2026';

/**
 * 使用 scrypt + 每用户随机盐生成密码摘要，格式: scrypt:<saltHex>:<hashHex>
 */
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, SCRYPT_KEY_LENGTH);
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
 * 校验密码；兼容旧版固定盐 HMAC 摘要 (needsRehash=true 时调用方应升级存储格式)
 */
export function verifyPassword(password: string, stored: string): { ok: boolean; needsRehash: boolean } {
  if (stored.startsWith(`${SCRYPT_PREFIX}:`)) {
    const [, saltHex, hashHex] = stored.split(':');
    if (!saltHex || !hashHex) return { ok: false, needsRehash: false };
    const hash = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), hashHex.length / 2);
    return { ok: timingSafeEqualHex(hash.toString('hex'), hashHex), needsRehash: false };
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
  const fastify = Fastify({ logger: false });

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
    await userRepo.create('admin', hashPassword(resolveDefaultAdminPassword()), '总指挥·管理员', Role.ADMIN);
  }
  // 演示玩家账号仅在非生产环境预置
  const defaultPlayer = process.env.NODE_ENV === 'production' ? true : await userRepo.findByUsername('player1');
  if (!defaultPlayer) {
    await userRepo.create('player1', hashPassword('123456'), '灰鸦指挥官·爱丽丝', Role.USER);
  }

  // 预置官方新手标准50张卡组
  const allCards = await cardRepo.findMany({ take: 10000 });
  const cardMap: Record<string, string> = {};
  for (const c of allCards.cards) {
    cardMap[c.cardNumber] = c.id;
  }

  // 1. ST01 灰鸦小队官方预组 (50张)
  const st01Cards = [
    { cardId: cardMap['ST01-001']!, count: 1, imageUrl: '/cards/ST01-R_ST01-001R★★.png' },
    { cardId: cardMap['ST01-001']!, count: 1, imageUrl: '/cards/ST01-R_ST01-001R★.png' },
    { cardId: cardMap['ST01-002']!, count: 4, imageUrl: '/cards/ST01-R_ST01-002R★.png' },
    { cardId: cardMap['ST01-003']!, count: 4, imageUrl: '/cards/ST01-R_ST01-003R★.png' },
    { cardId: cardMap['ST01-004']!, count: 4, imageUrl: '/cards/ST01-ST_ST01-004ST.png' },
    { cardId: cardMap['ST01-005']!, count: 4, imageUrl: '/cards/ST01-ST_ST01-005ST.png' },
    { cardId: cardMap['ST01-006']!, count: 4, imageUrl: '/cards/ST01-ST_ST01-006ST.png' },
    { cardId: cardMap['ST01-007']!, count: 4, imageUrl: '/cards/ST01-ST_ST01-007ST.png' },
    { cardId: cardMap['ST01-008']!, count: 2, imageUrl: '/cards/ST01-ST_ST01-008ST.png' },
    { cardId: cardMap['ST01-009']!, count: 2, imageUrl: '/cards/ST01-ST_ST01-009ST.png' },
    { cardId: cardMap['ST01-010']!, count: 4, imageUrl: '/cards/ST01-ST_ST01-010ST.png' },
    { cardId: cardMap['ST01-011']!, count: 4, imageUrl: '/cards/ST01-ST_ST01-011ST.png' },
    { cardId: cardMap['ST01-012']!, count: 4, imageUrl: '/cards/ST01-ST_ST01-012ST.png' },
    { cardId: cardMap['ST01-013']!, count: 4, imageUrl: '/cards/ST01-ST_ST01-013ST.png' },
    { cardId: cardMap['ST01-014']!, count: 4, imageUrl: '/cards/ST01-ST_ST01-014ST.png' },
  ].filter((c) => !!c.cardId);

  const defaultDeck = await deckRepo.create('system', '灰鸦小队·官方预组 (ST01)', '以露西亚·红莲为核心的物理爆发与手牌检索战术构筑。', 'deck-1791110685763');
  const seededDeck1 = await deckRepo.setCards(defaultDeck.id, st01Cards, true);
  if ((deckRepo as any).decks) {
    (deckRepo as any).decks.set('deck-1791110685763', {
      ...seededDeck1,
      id: 'deck-1791110685763',
      name: '灰鸦小队·官方预组 (ST01)',
    });
    (deckRepo as any).decks.set('default-starter-deck', {
      ...seededDeck1,
      id: 'default-starter-deck',
      name: '灰鸦小队·官方预组 (ST01)',
    });
    (deckRepo as any).decks.set('deck-st01', {
      ...seededDeck1,
      id: 'deck-st01',
      name: '灰鸦小队·官方预组 (ST01)',
    });
  }

  // 2. ST02 升格者小队官方预组 (50张)
  const st02Cards = [
    { cardId: cardMap['ST02-011']!, count: 4, imageUrl: '/cards/ST02-R_ST02-011R★.png' },
    { cardId: cardMap['ST02-010']!, count: 4, imageUrl: '/cards/ST02-R_ST02-010R★.png' },
    { cardId: cardMap['ST02-005']!, count: 4, imageUrl: '/cards/ST02-ST_ST02-005ST.png' },
    { cardId: cardMap['ST02-004']!, count: 4, imageUrl: '/cards/ST02-ST_ST02-004ST.png' },
    { cardId: cardMap['ST02-001']!, count: 1, imageUrl: '/cards/ST02-R_ST02-001R★★.png' },
    { cardId: cardMap['ST02-001']!, count: 3, imageUrl: '/cards/ST02-R_ST02-001R★.png' },
    { cardId: cardMap['ST02-003']!, count: 4, imageUrl: '/cards/ST02-ST_ST02-003ST.png' },
    { cardId: cardMap['ST02-007']!, count: 4, imageUrl: '/cards/ST02-ST_ST02-007ST.png' },
    { cardId: cardMap['ST02-009']!, count: 2, imageUrl: '/cards/ST02-ST_ST02-009ST.png' },
    { cardId: cardMap['ST02-006']!, count: 4, imageUrl: '/cards/ST02-ST_ST02-006ST.png' },
    { cardId: cardMap['ST02-002']!, count: 2, imageUrl: '/cards/ST02-ST_ST02-002ST.png' },
    { cardId: cardMap['ST02-008']!, count: 2, imageUrl: '/cards/ST02-ST_ST02-008ST.png' },
    { cardId: cardMap['ST02-012']!, count: 4, imageUrl: '/cards/ST02-ST_ST02-012ST.png' },
    { cardId: cardMap['ST02-013']!, count: 4, imageUrl: '/cards/ST02-ST_ST02-013ST.png' },
    { cardId: cardMap['ST02-014']!, count: 4, imageUrl: '/cards/ST02-ST_ST02-014ST.png' },
  ].filter((c) => !!c.cardId);

  const st02Deck = await deckRepo.create('system', '升格者·官方预组 (ST02)', '以露娜·银冕为核心的暗属性墓地苏生与高侵蚀削减战术构筑。', 'deck-st02');
  const seededDeck2 = await deckRepo.setCards(st02Deck.id, st02Cards, true);
  if ((deckRepo as any).decks) {
    (deckRepo as any).decks.set('deck-st02', {
      ...seededDeck2,
      id: 'deck-st02',
      name: '升格者·官方预组 (ST02)',
    });
  }

  // 3. ST03 三头犬小队官方预组 (50张)
  const st03Cards = [
    { cardId: cardMap['ST03-001']!, count: 1, imageUrl: '/cards/ST03-R_ST03-001R★★.png' },
    { cardId: cardMap['ST03-001']!, count: 3, imageUrl: '/cards/ST03-R_ST03-001R★.png' },
    { cardId: cardMap['ST03-002']!, count: 4, imageUrl: '/cards/ST03-R_ST03-002R★.png' },
    { cardId: cardMap['ST03-003']!, count: 4, imageUrl: '/cards/ST03-ST_ST03-003ST.png' },
    { cardId: cardMap['ST03-004']!, count: 2, imageUrl: '/cards/ST03-ST_ST03-004ST.png' },
    { cardId: cardMap['ST03-005']!, count: 4, imageUrl: '/cards/ST03-ST_ST03-005ST.png' },
    { cardId: cardMap['ST03-006']!, count: 4, imageUrl: '/cards/ST03-ST_ST03-006ST.png' },
    { cardId: cardMap['ST03-007']!, count: 2, imageUrl: '/cards/ST03-ST_ST03-007ST.png' },
    { cardId: cardMap['ST03-008']!, count: 4, imageUrl: '/cards/ST03-R_ST03-008R★.png' },
    { cardId: cardMap['ST03-009']!, count: 4, imageUrl: '/cards/ST03-ST_ST03-009ST.png' },
    { cardId: cardMap['ST03-010']!, count: 2, imageUrl: '/cards/ST03-ST_ST03-010ST.png' },
    { cardId: cardMap['ST03-011']!, count: 4, imageUrl: '/cards/ST03-ST_ST03-011ST.png' },
    { cardId: cardMap['ST03-012']!, count: 4, imageUrl: '/cards/ST03-ST_ST03-012ST.png' },
    { cardId: cardMap['ST03-013']!, count: 4, imageUrl: '/cards/ST03-ST_ST03-013ST.png' },
    { cardId: cardMap['ST03-014']!, count: 4, imageUrl: '/cards/ST03-ST_ST03-014ST.png' },
  ].filter((c) => !!c.cardId);

  const st03Deck = await deckRepo.create(
    'system',
    '三头犬小队·官方预组 (ST03)',
    '以薇拉·瑰丽为统帅的三头犬协同连击与战术控场构筑。',
    'deck-st03'
  );
  const seededDeck3 = await deckRepo.setCards(st03Deck.id, st03Cards, true);
  if ((deckRepo as any).decks) {
    (deckRepo as any).decks.set('deck-st03', {
      ...seededDeck3,
      id: 'deck-st03',
      name: '三头犬小队·官方预组 (ST03)',
    });
  }

  const roomMgr = new RoomManager(roomRepo, deckRepo, cardRepo);
  const gameSessionMgr = new GameSessionManager(gameRepo, deckRepo, cardRepo);

  // ==========================================
  // 鉴权中间件与身份校验 Hooks
  // ==========================================
  const verifyUser = async (req: any, reply: any) => {
    try {
      await req.jwtVerify();
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
    const body = req.body as { username?: string; password?: string; nickname?: string };
    if (!body.username || !body.password) {
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
    const nickname = (body.nickname?.trim() || trimmedUsername).slice(0, 32);
    const user = await userRepo.create(trimmedUsername, hashPassword(body.password), nickname, Role.USER);
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
    const body = req.body as { username?: string; password?: string };
    if (!body.username || !body.password) {
      return reply.code(400).send({ success: false, error: '请输入用户名和密码' });
    }
    const user = await userRepo.findByUsername(body.username.trim());
    const verification = user ? verifyPassword(body.password, user.passwordHash) : { ok: false, needsRehash: false };
    if (!user || !verification.ok) {
      return reply.code(401).send({ success: false, error: '用户名或密码错误' });
    }
    if (verification.needsRehash) {
      await userRepo.update(user.id, { passwordHash: hashPassword(body.password) });
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
    const body = req.body as { nickname?: string };
    if (!body.nickname || !body.nickname.trim()) {
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

  fastify.post('/api/rooms', async (req) => {
    const body = (req.body as any) || {};
    const title = body.title?.trim() || '空中花园特遣战术室';
    const creatorId = body.creatorId || 'host';
    const creatorName = body.creatorName || '指挥官';
    const customRoomId = body.roomId?.trim() || undefined;
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

  fastify.delete('/api/rooms/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const ok = await roomMgr.closeRoom(id);
    if (!ok) {
      return reply.code(404).send({ success: false, error: '房间不存在或已关闭' });
    }
    return { success: true, message: '房间已关闭' };
  });

  fastify.get('/api/decks', async (req) => {
    const userId = (req.query as any)?.userId;
    const systemDecks = await deckRepo.findByUserId('system');
    const userDecks = userId ? await deckRepo.findByUserId(userId) : [];
    return { success: true, data: [...systemDecks, ...userDecks] };
  });

  fastify.get('/api/decks/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const deck = await deckRepo.findById(id);
    if (!deck) {
      return reply.code(404).send({ success: false, error: 'Deck not found' });
    }
    return { success: true, data: deck };
  });

  fastify.post('/api/decks', async (req, reply) => {
    const body = req.body as {
      id?: string;
      userId?: string;
      name: string;
      description?: string;
      cards?: { cardId?: string; cardNumber?: string; count: number; imageUrl?: string }[];
    };
    const userId = body.userId || 'user_default';
    let deck = body.id ? await deckRepo.findById(body.id) : null;
    if (deck && deck.userId !== userId) {
      return reply.code(403).send({ success: false, error: '无权修改系统预组或其他玩家的卡组' });
    }
    if (!deck) {
      deck = await deckRepo.create(userId, body.name, body.description, body.id);
    } else {
      deck = await deckRepo.update(deck.id, body.name, body.description);
    }
    let valResult: any = undefined;
    if (body.cards && body.cards.length > 0) {
      const populatedCards: DeckCardInput[] = [];
      const normalizedCards: { cardId: string; count: number; imageUrl?: string }[] = [];
      for (const item of body.cards) {
        let c = item.cardId ? await cardRepo.findById(item.cardId) : null;
        if (!c && item.cardNumber) {
          c = await cardRepo.findByCardNumber(item.cardNumber);
        }
        if (!c && item.cardId) {
          const cleaned = item.cardId.replace(/^c-/, '').toUpperCase();
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
      valResult = validateDeck(populatedCards);
      await deckRepo.setCards(deck.id, normalizedCards, valResult.isValid, valResult.errors.join('; '));
    }
    const updated = await deckRepo.findById(deck.id);
    return { success: true, data: updated, validation: valResult };
  });

  fastify.put('/api/decks/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as {
      name?: string;
      description?: string;
      cards?: { cardId?: string; cardNumber?: string; count: number; imageUrl?: string }[];
    };
    let deck = await deckRepo.findById(id);
    if (!deck) {
      return reply.code(404).send({ success: false, error: 'Deck not found' });
    }
    if (deck.userId === 'system') {
      return reply.code(403).send({ success: false, error: '系统预组不可修改' });
    }
    if (body.name || body.description !== undefined) {
      deck = await deckRepo.update(id, body.name, body.description);
    }
    let valResult: any = undefined;
    if (body.cards) {
      const populatedCards: DeckCardInput[] = [];
      const normalizedCards: { cardId: string; count: number; imageUrl?: string }[] = [];
      for (const item of body.cards) {
        let c = item.cardId ? await cardRepo.findById(item.cardId) : null;
        if (!c && item.cardNumber) {
          c = await cardRepo.findByCardNumber(item.cardNumber);
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
      valResult = validateDeck(populatedCards);
      deck = await deckRepo.setCards(id, normalizedCards, valResult.isValid, valResult.errors.join('; '));
    }
    return { success: true, data: deck, validation: valResult };
  });

  fastify.delete('/api/decks/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = await deckRepo.findById(id);
    if (existing?.userId === 'system') {
      return reply.code(403).send({ success: false, error: '系统预组不可删除' });
    }
    const deleted = await deckRepo.delete(id);
    return { success: deleted };
  });

  fastify.get('/api/cards', async (req) => {
    const query = (req.query as any) || {};
    const cards = await cardRepo.findMany({
      cardType: query.cardType,
      attribute: query.attribute,
      cost: query.cost !== undefined ? Number(query.cost) : undefined,
      query: query.query,
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
    const query = (req.query as any) || {};
    let isActive: boolean | undefined = undefined;
    if (query.isActive === 'true') isActive = true;
    if (query.isActive === 'false') isActive = false;

    const cards = await cardRepo.findMany({
      cardType: query.cardType,
      attribute: query.attribute,
      cost: query.cost !== undefined ? Number(query.cost) : undefined,
      query: query.query,
      take: clampTake(query.take, 500),
      isActive,
    });
    return { success: true, data: cards.cards, total: cards.total };
  });

  fastify.post('/api/admin/cards', { preHandler: [verifyAdmin] }, async (req, reply) => {
    const body = req.body as CardCreateInput;
    if (!body.cardNumber || !body.name || !body.cardType) {
      return reply.code(400).send({ success: false, error: '缺少卡牌关键字段 (cardNumber, name, cardType)' });
    }
    const existing = await cardRepo.findByCardNumber(body.cardNumber);
    if (existing) {
      return reply.code(409).send({ success: false, error: `卡牌编号 [${body.cardNumber}] 已存在` });
    }
    const created = await cardRepo.create({
      ...body,
      cost: Number(body.cost) || 0,
      basePP: body.basePP !== undefined && body.basePP !== null ? Number(body.basePP) : null,
      baseDP: body.baseDP !== undefined && body.baseDP !== null ? Number(body.baseDP) : null,
      traits: Array.isArray(body.traits) ? body.traits : [],
      isInstant: !!body.isInstant,
    });
    return { success: true, data: created };
  });

  fastify.put('/api/admin/cards/:id', { preHandler: [verifyAdmin] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as Partial<CardCreateInput> & { isActive?: boolean; errataReason?: string };
    let card = await cardRepo.findById(id);
    if (!card) {
      card = await cardRepo.findByCardNumber(id);
    }
    if (!card) {
      return reply.code(404).send({ success: false, error: 'Card not found' });
    }

    const snapshot = {
      ...card,
      ...body,
      errataReason: body.errataReason || '管理员调整卡牌数值或效果文',
      updatedAt: new Date().toISOString(),
    };

    const updated = await cardRepo.update(card.id, body, snapshot);
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

  fastify.post('/api/admin/cards/batch', { preHandler: [verifyAdmin] }, async (req, reply) => {
    const body = req.body as { cards: CardCreateInput[] };
    if (!body.cards || !Array.isArray(body.cards)) {
      return reply.code(400).send({ success: false, error: '需提供 cards 数组' });
    }
    const res = await cardRepo.batchImport(body.cards);
    return { success: true, data: res };
  });

  // ==========================================
  // 对局历史与回放接口 (Phase 10 Replay & History APIs)
  // ==========================================
  fastify.get('/api/history', async (req) => {
    const query = (req.query as any) || {};
    const limit = clampTake(query.limit, 50, 200);
    const games = await gameRepo.listGames(limit);
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
    if (!replay) {
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
  });

  setupSocketGateway(io, roomMgr, gameSessionMgr, {
    resolveToken: async (token) => {
      try {
        const payload = fastify.jwt.verify<{ userId: string }>(token);
        const user = payload?.userId ? await userRepo.findById(payload.userId) : null;
        return user ? { userId: user.id, username: user.nickname || user.username } : null;
      } catch {
        return null;
      }
    },
    isRegisteredUserId: async (id) => !!(await userRepo.findById(id)),
  });

  return { fastify, io, roomMgr, gameSessionMgr, userRepo };
}

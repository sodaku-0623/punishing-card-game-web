import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServerApp, AppComponents } from '../src/app.js';
import {
  MemoryDeckRepository,
  MemoryCardRepository,
  MemoryGameRepository,
  OFFICIAL_SEED_CARDS,
} from '@zhanshuang/database';

describe('Phase 10 Replay System & Audit Logs (对局历史与回放接口测试)', () => {
  let app: AppComponents;
  let gameRepo: MemoryGameRepository;
  let deckRepo: MemoryDeckRepository;
  let testGameId: string;

  beforeAll(async () => {
    const cardRepo = new MemoryCardRepository();
    await cardRepo.batchImport(OFFICIAL_SEED_CARDS);
    deckRepo = new MemoryDeckRepository(cardRepo);
    gameRepo = new MemoryGameRepository();

    app = await createServerApp({ cardRepo, deckRepo, gameRepo });

    // 预建两套卡组
    const d1 = await deckRepo.create('alice', '爱丽丝牌组');
    const d2 = await deckRepo.create('bob', '鲍勃牌组');

    // 启动一局真实对战并提交动作
    const session = await app.gameSessionMgr.startGameSession(
      'room-test-replay',
      'alice',
      'deck-st01',
      'bob',
      'deck-st02',
      123456
    );
    testGameId = session.gameId;

    // 模拟行动流水
    await app.gameSessionMgr.processAction(testGameId, {
      type: 'PASS_ACTION_TIMING',
      playerId: 'alice',
    } as any);
  });

  afterAll(async () => {
    app.io.close();
    await app.fastify.close();
  });

  it('1. 对局进行中：历史列表不包含该对局，回放接口按不存在处理 (防止泄露随机种子)', async () => {
    const history = await app.fastify.inject({ method: 'GET', url: '/api/history' });
    expect(history.statusCode).toBe(200);
    const historyBody = JSON.parse(history.payload);
    expect(historyBody.data.find((g: any) => g.id === testGameId)).toBeUndefined();

    const replay = await app.fastify.inject({ method: 'GET', url: `/api/replay/${testGameId}` });
    expect(replay.statusCode).toBe(404);
    expect(replay.payload).not.toContain('123456');
  });

  it('2. 对局结束后：GET /api/history 列出对局，GET /api/replay/:gameId 返回种子与完整行动、事件序列', async () => {
    await app.gameSessionMgr.processAction(testGameId, { type: 'SURRENDER', playerId: 'bob' } as any);

    const history = await app.fastify.inject({ method: 'GET', url: '/api/history' });
    expect(history.statusCode).toBe(200);
    const match = JSON.parse(history.payload).data.find((g: any) => g.id === testGameId);
    expect(match).toBeDefined();
    expect(match.rngSeed).toBe('123456');
    expect(match.roomId).toBe('room-test-replay');

    const res = await app.fastify.inject({ method: 'GET', url: `/api/replay/${testGameId}` });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.success).toBe(true);

    const { game, actions, events, players } = body.data;
    expect(game.id).toBe(testGameId);
    expect(game.rngSeed).toBe('123456');
    expect(players.length).toBe(2);
    expect(actions[0].actionType).toBe('PASS_ACTION_TIMING');
    expect(actions.at(-1).actionType).toBe('SURRENDER');
    expect(events.length).toBeGreaterThan(0);
  });

  it('3. GET /api/replay/:gameId - 查询不存在对局返回 404', async () => {
    const res = await app.fastify.inject({
      method: 'GET',
      url: '/api/replay/non-existent-game-id',
    });
    expect(res.statusCode).toBe(404);
  });
});

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

  it('1. GET /api/history - 查询全服对局历史列表', async () => {
    const res = await app.fastify.inject({
      method: 'GET',
      url: '/api/history',
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.success).toBe(true);
    expect(body.data.length).toBeGreaterThanOrEqual(1);

    const match = body.data.find((g: any) => g.id === testGameId);
    expect(match).toBeDefined();
    expect(match.rngSeed).toBe('123456');
    expect(match.roomId).toBe('room-test-replay');
  });

  it('2. GET /api/replay/:gameId - 获取确定性回放流与动作审计事件序列', async () => {
    const res = await app.fastify.inject({
      method: 'GET',
      url: `/api/replay/${testGameId}`,
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.success).toBe(true);

    const { game, actions, events, players } = body.data;
    expect(game.id).toBe(testGameId);
    expect(game.rngSeed).toBe('123456');
    expect(players.length).toBe(2);

    // 检验行动序列与事件序列
    expect(actions.length).toBeGreaterThanOrEqual(1);
    expect(actions[0].actionType).toBe('PASS_ACTION_TIMING');
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

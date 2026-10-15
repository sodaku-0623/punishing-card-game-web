import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServerApp, AppComponents } from '../src/app.js';
import { MemoryDeckRepository, MemoryCardRepository, OFFICIAL_SEED_CARDS } from '@zhanshuang/database';

describe('Phase 7 Deck Builder REST APIs (卡组管理与构筑验证接口)', () => {
  let app: AppComponents;

  beforeAll(async () => {
    const cardRepo = new MemoryCardRepository();
    await cardRepo.batchImport(OFFICIAL_SEED_CARDS);
    const deckRepo = new MemoryDeckRepository(cardRepo);
    app = await createServerApp({ deckRepo });
  });

  afterAll(async () => {
    app.io.close();
    await app.fastify.close();
  });

  it('1. GET /api/cards - 查询全量官方卡牌库与类型过滤', async () => {
    const res = await app.fastify.inject({
      method: 'GET',
      url: '/api/cards',
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.success).toBe(true);
    expect(body.data.length).toBeGreaterThan(40);

    // 过滤角色牌
    const roleRes = await app.fastify.inject({
      method: 'GET',
      url: '/api/cards?cardType=ROLE',
    });
    const roleBody = JSON.parse(roleRes.payload);
    expect(roleBody.data.every((c: any) => c.cardType === 'ROLE')).toBe(true);

    // 单卡查询 (通过 cardNumber)
    const singleRes = await app.fastify.inject({
      method: 'GET',
      url: '/api/cards/ST01-001',
    });
    expect(singleRes.statusCode).toBe(200);
    const singleBody = JSON.parse(singleRes.payload);
    expect(singleBody.success).toBe(true);
    expect(singleBody.data.name).toBe('露西亚·红莲');
    expect(singleBody.data.cost).toBe(5);

    // 404 处理
    const notFoundRes = await app.fastify.inject({
      method: 'GET',
      url: '/api/cards/NON-EXISTENT-CARD',
    });
    expect(notFoundRes.statusCode).toBe(404);
  });

  it('2. GET /api/decks - 查询系统内置预组与用户卡组', async () => {
    const res = await app.fastify.inject({
      method: 'GET',
      url: '/api/decks?userId=system',
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.success).toBe(true);
    expect(body.data.length).toBeGreaterThanOrEqual(3);

    const deckNames = body.data.map((d: any) => d.name);
    expect(deckNames.some((name: string) => name.includes('ST01'))).toBe(true);
    expect(deckNames.some((name: string) => name.includes('ST02'))).toBe(true);
    expect(deckNames.some((name: string) => name.includes('ST03'))).toBe(true);
  });

  it('3. POST & PUT & DELETE /api/decks - 构筑生命周期与规则校验', async () => {
    // 1. 创建新卡组
    const createRes = await app.fastify.inject({
      method: 'POST',
      url: '/api/decks',
      payload: {
        userId: 'commander-1',
        name: '自定义极速突击卡组',
        description: '测试自定义卡组',
      },
    });
    expect(createRes.statusCode).toBe(200);
    const created = JSON.parse(createRes.payload).data;
    expect(created.name).toBe('自定义极速突击卡组');
    expect(created.isValid).toBe(false);

    // 2. 保存非法张数卡组 (未满50张)
    const updateInvalidRes = await app.fastify.inject({
      method: 'PUT',
      url: `/api/decks/${created.id}`,
      payload: {
        name: '更新卡组名',
        cards: [
          { cardNumber: 'ST01-012', count: 4 },
          { cardNumber: 'ST01-013', count: 4 },
          { cardNumber: 'ST01-014', count: 4 },
        ],
      },
    });
    expect(updateInvalidRes.statusCode).toBe(200);
    const invalidResult = JSON.parse(updateInvalidRes.payload);
    expect(invalidResult.data.isValid).toBe(false);
    expect(invalidResult.validation.isValid).toBe(false);
    expect(invalidResult.validation.errors.length).toBeGreaterThan(0);

    // 3. 删除卡组
    const delRes = await app.fastify.inject({
      method: 'DELETE',
      url: `/api/decks/${created.id}`,
    });
    expect(delRes.statusCode).toBe(200);
    expect(JSON.parse(delRes.payload).success).toBe(true);
  });
});

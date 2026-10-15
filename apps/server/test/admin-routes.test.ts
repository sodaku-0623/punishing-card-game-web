import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServerApp, AppComponents } from '../src/app.js';
import { MemoryDeckRepository, MemoryCardRepository, OFFICIAL_SEED_CARDS } from '@zhanshuang/database';
import { CardTypeEnum, ElementAttributeEnum } from '@prisma/client';

describe('Phase 9 Admin Panel & Card Operations (管理控制台与运维接口)', () => {
  let app: AppComponents;
  let adminToken: string;
  let playerToken: string;

  beforeAll(async () => {
    const cardRepo = new MemoryCardRepository();
    await cardRepo.batchImport(OFFICIAL_SEED_CARDS);
    const deckRepo = new MemoryDeckRepository(cardRepo);
    app = await createServerApp({ deckRepo });

    // 管理员登录获取 JWT Token
    const adminLoginRes = await app.fastify.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'admin', password: 'admin888' },
    });
    expect(adminLoginRes.statusCode).toBe(200);
    adminToken = JSON.parse(adminLoginRes.payload).data.token;

    // 默认玩家登录获取 JWT Token
    const playerLoginRes = await app.fastify.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'player1', password: '123456' },
    });
    expect(playerLoginRes.statusCode).toBe(200);
    playerToken = JSON.parse(playerLoginRes.payload).data.token;
  });

  afterAll(async () => {
    app.io.close();
    await app.fastify.close();
  });

  it('0. 鉴权与 RBAC 拦截验证 (未授权 401 & 玩家越权 403)', async () => {
    // 未登录访问后台
    const unauthRes = await app.fastify.inject({
      method: 'GET',
      url: '/api/admin/stats',
    });
    expect(unauthRes.statusCode).toBe(401);

    // 普通玩家登录后越权访问后台 -> 403 Forbidden
    const forbiddenRes = await app.fastify.inject({
      method: 'GET',
      url: '/api/admin/stats',
      headers: { authorization: `Bearer ${playerToken}` },
    });
    expect(forbiddenRes.statusCode).toBe(403);
  });

  it('1. GET /api/admin/stats - 管理员授权后获取系统全局运行态势与负载指标', async () => {
    const res = await app.fastify.inject({
      method: 'GET',
      url: '/api/admin/stats',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.success).toBe(true);
    expect(body.data.totalCards).toBeGreaterThan(40);
    expect(body.data.rulesEngineVersion).toContain('A0 First Edition');
    expect(body.data.uptimeSeconds).toBeGreaterThanOrEqual(0);
  });

  it('2. POST /api/admin/cards - 新建卡牌与唯一编号校验', async () => {
    // 成功创建新卡
    const newCard = {
      cardNumber: 'TEST-ADMIN-001',
      name: '卡列尼娜·辉晓',
      cardType: CardTypeEnum.ROLE,
      attribute: ElementAttributeEnum.DARK,
      cost: 5,
      basePP: 5500,
      baseDP: 1,
      traits: ['卡列尼娜', '工程部队'],
      rulesText: '【出】：选择对方战场1张角色，造成2000点效果伤害。',
      flavorText: '重炮轰击，粉碎阻碍！',
    };

    const res = await app.fastify.inject({
      method: 'POST',
      url: '/api/admin/cards',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: newCard,
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.success).toBe(true);
    expect(body.data.cardNumber).toBe('TEST-ADMIN-001');
    expect(body.data.currentVersion).toBe(1);

    // 重复编号拦截 (409 Conflict)
    const duplicateRes = await app.fastify.inject({
      method: 'POST',
      url: '/api/admin/cards',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: newCard,
    });
    expect(duplicateRes.statusCode).toBe(409);
  });

  it('3. PUT /api/admin/cards/:id & GET versions - 卡牌调整与快照版本追踪', async () => {
    // 1. 修改数值并生成版本快照
    const updateRes = await app.fastify.inject({
      method: 'PUT',
      url: '/api/admin/cards/TEST-ADMIN-001',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        basePP: 6000,
        errataReason: '平衡性调整：基础 PP 由 5500 提高至 6000',
      },
    });
    expect(updateRes.statusCode).toBe(200);
    const updatedBody = JSON.parse(updateRes.payload);
    expect(updatedBody.success).toBe(true);
    expect(updatedBody.data.basePP).toBe(6000);
    expect(updatedBody.data.currentVersion).toBe(2);

    // 2. 查看历史版本链
    const versionsRes = await app.fastify.inject({
      method: 'GET',
      url: '/api/admin/cards/TEST-ADMIN-001/versions',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(versionsRes.statusCode).toBe(200);
    const vBody = JSON.parse(versionsRes.payload);
    expect(vBody.success).toBe(true);
    expect(vBody.data.length).toBeGreaterThanOrEqual(2);
    expect(vBody.data.some((v: any) => v.versionNumber === 2)).toBe(true);

    // 3. 上下架控制 (退环境 / 封禁)
    const disableRes = await app.fastify.inject({
      method: 'PUT',
      url: '/api/admin/cards/TEST-ADMIN-001',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        isActive: false,
        errataReason: '禁用卡牌测试',
      },
    });
    expect(disableRes.statusCode).toBe(200);
    expect(JSON.parse(disableRes.payload).data.isActive).toBe(false);
  });

  it('4. POST /api/admin/cards/batch - 批量导入扩展卡包数据', async () => {
    const batchCards = [
      {
        cardNumber: 'EX01-001',
        name: '罗兰·戏炎',
        cardType: CardTypeEnum.ROLE,
        attribute: ElementAttributeEnum.FIRE,
        cost: 4,
        basePP: 4500,
        baseDP: 1,
        traits: ['升格者', '罗兰'],
        rulesText: '【出】：抽1张牌。',
      },
      {
        cardNumber: 'EX01-002',
        name: '欺诈假面',
        cardType: CardTypeEnum.TACTICS,
        attribute: ElementAttributeEnum.FIRE,
        cost: 1,
        traits: ['战术'],
        rulesText: '本回合我方下次受到的侵蚀伤害减少1点。',
      },
    ];

    const res = await app.fastify.inject({
      method: 'POST',
      url: '/api/admin/cards/batch',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { cards: batchCards },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.success).toBe(true);
    expect(body.data.importedCount).toBe(2);

    // 验证新卡已可被检索
    const verifyRes = await app.fastify.inject({
      method: 'GET',
      url: '/api/cards/EX01-001',
    });
    expect(verifyRes.statusCode).toBe(200);
  });

  it('5. 玩家注册、登录、名称设置与个人信息查看', async () => {
    // 1. 注册新玩家账号
    const regRes = await app.fastify.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        username: 'new_commander',
        password: 'password123',
        nickname: '露西亚·深红之渊',
      },
    });
    expect(regRes.statusCode).toBe(200);
    const regBody = JSON.parse(regRes.payload);
    expect(regBody.success).toBe(true);
    expect(regBody.data.user.username).toBe('new_commander');
    expect(regBody.data.user.nickname).toBe('露西亚·深红之渊');
    expect(regBody.data.token).toBeDefined();

    const newPlayerToken = regBody.data.token;

    // 2. 查看个人资料 (GET /api/auth/me)
    const meRes = await app.fastify.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${newPlayerToken}` },
    });
    expect(meRes.statusCode).toBe(200);
    const meBody = JSON.parse(meRes.payload);
    expect(meBody.data.user.username).toBe('new_commander');
    expect(meBody.data.user.nickname).toBe('露西亚·深红之渊');

    // 3. 修改玩家自定义名称 (PUT /api/auth/profile)
    const profileRes = await app.fastify.inject({
      method: 'PUT',
      url: '/api/auth/profile',
      headers: { authorization: `Bearer ${newPlayerToken}` },
      payload: {
        nickname: '露西亚·誓焰',
      },
    });
    expect(profileRes.statusCode).toBe(200);
    const profileBody = JSON.parse(profileRes.payload);
    expect(profileBody.success).toBe(true);
    expect(profileBody.data.nickname).toBe('露西亚·誓焰');

    // 4. 重复注册拦截
    const duplicateReg = await app.fastify.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        username: 'new_commander',
        password: 'password456',
      },
    });
    expect(duplicateReg.statusCode).toBe(409);
  });
});

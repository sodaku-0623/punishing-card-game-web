import { describe, it, expect } from 'vitest';
import { CardType } from '@zhanshuang/shared';
import { EXACT_IMPLEMENTED_CARDS, OFFICIAL_STARTER_DECKS } from '@zhanshuang/game-rules';
import {
  CardEffectSpec,
  GameEngine,
  MemoryCardDatabase,
  OFFICIAL_CARDS_DATA,
  STARTER_DECK_EFFECT_SPECS,
  STARTER_DECK_SPEC_MAP,
  validateCardEffectRegistry,
  validateCardEffectSpec,
} from '../src/index.js';
import { fillCostZone } from './helpers.js';

const db = new MemoryCardDatabase(OFFICIAL_CARDS_DATA);

function expandDeck(presetId: 'ST01' | 'ST02' | 'ST03'): string[] {
  const deck = OFFICIAL_STARTER_DECKS.find((d) => d.name.includes(`(${presetId})`))!;
  const list: string[] = [];
  for (const entry of deck.cards) {
    for (let i = 0; i < entry.count; i++) list.push(entry.cardNumber);
  }
  return list;
}

describe('声明式卡牌效果描述与严格类型/结构校验 (docs/future-work.md §3.1~3.3)', () => {
  it('官方全卡表全部 490 张 (ST01~ST06 + BP01~BP04 + PR) 声明式描述全部通过官方卡表交叉校验，且与 @zhanshuang/game-rules EXACT_IMPLEMENTED_CARDS 一一对应', () => {
    const validated = validateCardEffectRegistry(STARTER_DECK_EFFECT_SPECS, db);
    expect(validated.size).toBe(490);
    expect(STARTER_DECK_SPEC_MAP.size).toBe(490);
    expect(OFFICIAL_CARDS_DATA.length).toBe(490);

    // 校验每张描述的卡号、卡名均与官方卡表一致
    for (const spec of STARTER_DECK_EFFECT_SPECS) {
      const def = db.getCard(spec.cardNumber);
      expect(def).toBeDefined();
      expect(spec.name).toBe(def!.name);
      expect(EXACT_IMPLEMENTED_CARDS.has(spec.cardNumber)).toBe(true);
    }

    // 反向校验 EXACT_IMPLEMENTED_CARDS 不存在未在声明式库中定义的卡号
    for (const num of EXACT_IMPLEMENTED_CARDS) {
      expect(STARTER_DECK_SPEC_MAP.has(num)).toBe(true);
    }
  });

  it('校验器直接拦截未定义变量引用，禁止静默执行错误效果', () => {
    const badSpec: CardEffectSpec = {
      cardNumber: 'TEST-001',
      name: '错误变量引用测试',
      tactics: [
        { op: 'REVEAL_TOP', count: 5, saveToVar: 'revealed' },
        {
          op: 'CHOOSE_FROM_VAR',
          varName: 'revlead', // 故意拼写错误
          prompt: '选一张',
          saveToVar: 'picked',
        },
      ],
    };
    expect(() => validateCardEffectSpec(badSpec)).toThrow(/未定义变量 "revlead"/);

    const badRestSpec: CardEffectSpec = {
      cardNumber: 'TEST-002',
      name: '错误剩余变量引用测试',
      tactics: [
        { op: 'REVEAL_TOP', count: 3, saveToVar: 'top' },
        { op: 'MOVE_CARDS', target: { kind: 'REST_OF_VAR', allVar: 'top', excludeVar: 'missing' }, toZone: 'GRAVEYARD' },
      ],
    };
    expect(() => validateCardEffectSpec(badRestSpec)).toThrow(/未定义变量 excludeVar "missing"/);
  });

  it('校验器拦截非法数量、空修改器、vanillaEntry 冲突、未知原语与重复注册', () => {
    expect(() =>
      validateCardEffectSpec({
        cardNumber: 'TEST-BAD-DRAW',
        name: '非法抽牌',
        tactics: [{ op: 'DRAW', count: 0 }],
      })
    ).toThrow(/正整数/);

    expect(() =>
      validateCardEffectSpec({
        cardNumber: 'TEST-BAD-RANGE',
        name: '非法区间',
        tactics: [
          {
            op: 'CHOOSE_ROLES',
            side: 'SELF',
            prompt: '选角色',
            min: 3,
            max: 1,
            saveToVar: 'x',
          },
        ],
      })
    ).toThrow(/不能大于 max/);

    expect(() =>
      validateCardEffectSpec({
        cardNumber: 'TEST-EMPTY-MOD',
        name: '空属性修改',
        tactics: [{ op: 'MODIFY_STATS', target: { kind: 'SELF' }, duration: 'END_OF_TURN' }],
      })
    ).toThrow(/至少须指定一项属性或能力修改/);

    expect(() =>
      validateCardEffectSpec({
        cardNumber: 'TEST-CONFLICT',
        name: '冲突标记',
        vanillaEntry: true,
        entry: { steps: [{ op: 'DRAW', count: 1 }] },
      })
    ).toThrow(/不能同时标记 vanillaEntry=true 与配置 entry/);

    expect(() =>
      validateCardEffectSpec({
        cardNumber: 'TEST-UNKNOWN-OP',
        name: '未知指令',
        tactics: [{ op: 'TELEPORT_MOON' } as unknown as NonNullable<CardEffectSpec['tactics']>[number]],
      })
    ).toThrow(/未知的操作原语/);

    expect(() =>
      validateCardEffectRegistry([
        { cardNumber: 'DUP-001', name: '卡A', tactics: [{ op: 'DRAW', count: 1 }] },
        { cardNumber: 'DUP-001', name: '卡B', tactics: [{ op: 'DRAW', count: 2 }] },
      ])
    ).toThrow(/重复注册了卡牌 DUP-001/);

    expect(() =>
      validateCardEffectSpec(
        { cardNumber: 'NOT-EXIST-999', name: '不存在的卡', tactics: [{ op: 'DRAW', count: 1 }] },
        db
      )
    ).toThrow(/不存在于官方卡表/);
  });

  it('声明式执行帧可随 Durable Object 快照在任意多步暂停点完整恢复 (ST01-001 丢弃代价 → 公开检索 → 出场 + 置底)', () => {
    const engine = new GameEngine(
      'game-dsl-snapshot',
      { playerId: 'p1', deckCardNumbers: expandDeck('ST01') },
      { playerId: 'p2', deckCardNumbers: expandDeck('ST02') },
      777,
      db,
      { skipMulligan: true }
    );
    const state = engine.getState();
    if (state.activePlayerId !== 'p1') {
      state.activePlayerId = 'p1';
      state.nonActivePlayerId = 'p2';
      state.priorityPlayerId = 'p1';
    }
    const p1 = 'p1';
    engine.dispatchAction({ type: 'PASS_ACTION_TIMING', playerId: p1 });
    fillCostZone(engine, p1, 10);

    // 准备手牌 ST01-001 + 1张丢弃手牌，牌组顶放 1 张费用<=3 的<灰鸦小队>角色 (ST01-005 费用3)
    const lucia = Object.values(engine.getState().cards).find(
      (c) => c.controllerPlayerId === p1 && c.cardNumber === 'ST01-001'
    )!;
    const fodder = Object.values(engine.getState().cards).find(
      (c) => c.controllerPlayerId === p1 && c.cardNumber === 'ST01-009' && c.instanceId !== lucia.instanceId
    )!;
    const cheapRole = Object.values(engine.getState().cards).find(
      (c) =>
        c.controllerPlayerId === p1 &&
        c.cardNumber === 'ST01-005' &&
        c.instanceId !== lucia.instanceId &&
        c.instanceId !== fodder.instanceId
    )!;
    engine.zoneMgr.moveCard(lucia.instanceId, 'HAND', { isFaceUp: true });
    engine.zoneMgr.moveCard(fodder.instanceId, 'HAND', { isFaceUp: true });
    engine.zoneMgr.moveCardToTopOfDeck(cheapRole.instanceId);

    // 第 1 步暂停：询问是否支付丢弃手牌代价
    expect(
      engine.dispatchAction({
        type: 'PLAY_CARD',
        playerId: p1,
        cardInstanceId: lucia.instanceId,
        targetSlotIndex: 0,
      }).success
    ).toBe(true);
    expect(engine.getState().currentPendingChoice?.effectType).toBe('PRESET_DISCARD_COST');

    // 第一次快照恢复 (模拟 Durable Object 休眠)
    const restored1 = GameEngine.fromSnapshot(engine.toSnapshot(), db);
    const costChoice = restored1.getState().currentPendingChoice!;
    expect(
      restored1.dispatchAction({
        type: 'SELECT_CHOICE_OPTION',
        playerId: p1,
        pendingChoiceId: costChoice.id,
        selectedIds: [fodder.instanceId],
      }).success
    ).toBe(true);

    // 第 2 步暂停：公开 5 张牌，等待玩家选出费用<=3 的<灰鸦小队>角色
    expect(restored1.getState().currentPendingChoice?.effectType).toBe('PRESET_ST01_001_PICK');
    expect(restored1.zoneMgr.getCardsInZone(p1, 'PROCESSING')).toHaveLength(5);

    // 第二次快照恢复 (模拟再次休眠后提交最终选择)
    const restored2 = GameEngine.fromSnapshot(restored1.toSnapshot(), db);
    const pickChoice = restored2.getState().currentPendingChoice!;
    expect(
      restored2.dispatchAction({
        type: 'SELECT_CHOICE_OPTION',
        playerId: p1,
        pendingChoiceId: pickChoice.id,
        selectedIds: [cheapRole.instanceId],
      }).success
    ).toBe(true);

    // 验证 ST01-005 已出场且剩余 4 张公开牌已离开处理区置底
    expect(restored2.getState().cards[cheapRole.instanceId]!.zone).toBe('BATTLEFIELD');
    expect(restored2.zoneMgr.getCardsInZone(p1, 'PROCESSING')).toHaveLength(0);
    // ST01-005 自身【出】会抽1弃1，产生 PRESET_DISCARD 决策
    expect(restored2.getState().currentPendingChoice?.effectType).toBe('PRESET_DISCARD');
  });

  it('校验器支持 CardFilter 的 minCost / maxCost 与 minEffectivePP / maxEffectivePP 合法性检查', () => {
    expect(() =>
      validateCardEffectSpec({
        cardNumber: 'TEST-COST-INV',
        name: '费用倒挂',
        tactics: [
          {
            op: 'CHOOSE_ZONE_CARDS',
            side: 'SELF',
            zone: 'HAND',
            prompt: '选牌',
            filter: { cardType: CardType.ROLE, minCost: 5, maxCost: 2 },
            saveToVar: 'c',
          },
        ],
      })
    ).toThrow(/minCost .* 不能大于 maxCost/);
  });

  it('校验器拦截 CHOOSE_MODE 重复 ID、越界 max、以及 ELIMINATE_ORB_COST 内部未定义变量引用', () => {
    expect(() =>
      validateCardEffectSpec({
        cardNumber: 'TEST-MODE-DUP',
        name: '重复模式ID',
        tactics: [
          {
            op: 'CHOOSE_MODE',
            prompt: '选择',
            modes: [
              { id: 'm1', label: '项1', steps: [{ op: 'DRAW', count: 1 }] },
              { id: 'm1', label: '项2', steps: [{ op: 'DRAW', count: 1 }] },
            ],
          },
        ],
      })
    ).toThrow(/重复 id/);

    expect(() =>
      validateCardEffectSpec({
        cardNumber: 'TEST-MODE-RANGE',
        name: '模式数量越界',
        tactics: [
          {
            op: 'CHOOSE_MODE',
            prompt: '选择',
            min: 1,
            max: 3,
            modes: [
              { id: 'm1', label: '项1', steps: [{ op: 'DRAW', count: 1 }] },
              { id: 'm2', label: '项2', steps: [{ op: 'DRAW', count: 1 }] },
            ],
          },
        ],
      })
    ).toThrow(/越界/);

    expect(() =>
      validateCardEffectSpec({
        cardNumber: 'TEST-ORB-STEP-VAR',
        name: '步内消球未定义变量',
        tactics: [
          {
            op: 'ELIMINATE_ORB_COST',
            filter: 'ANY',
            count: 1,
            savePaidToVar: 'paid',
            onPaid: [{ op: 'MOVE_CARDS', target: { kind: 'VAR', varName: 'wrongVar' }, toZone: 'HAND' }],
          },
        ],
      })
    ).toThrow(/未定义变量 "wrongVar"/);
  });
});

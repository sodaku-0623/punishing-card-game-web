import { describe, it, expect } from 'vitest';
import { GameEngine } from '../src/engine.js';
import { MemoryCardDatabase, OFFICIAL_CARDS_DATA } from '../src/database/card-registry.js';
import { parseAscensionConfig } from '../src/database/ascension-parser.js';
import { parseInherentKeywords } from '../src/rules/keywords.js';
import type { CardInstance } from '@zhanshuang/shared';
import { fillCostZone } from './helpers.js';

/**
 * 核心规则回归测试：区域与状态 (3.1.4 / 9.2 / 9.6 / 3.6)、升变 (8.11 / 10.12)、
 * 关键字能力 (10.5~10.7 / 10.14 / 10.16)、决策排队。
 */

const cardDb = new MemoryCardDatabase(OFFICIAL_CARDS_DATA);

/** 以 ST01 为主的 50 张牌组，额外放入测试所需的卡牌 */
function deck(extra: string[] = []): string[] {
  const base = [
    'ST01-012', 'ST01-012', 'ST01-012', 'ST01-012',
    'ST01-013', 'ST01-013', 'ST01-013', 'ST01-013',
    'ST01-014', 'ST01-014', 'ST01-014', 'ST01-014',
    'ST01-001', 'ST01-002', 'ST01-002', 'ST01-002', 'ST01-002',
    'ST01-003', 'ST01-003', 'ST01-003', 'ST01-003',
    'ST01-004', 'ST01-004', 'ST01-004', 'ST01-004',
    'ST01-005', 'ST01-005', 'ST01-005', 'ST01-005',
    'ST01-006', 'ST01-006', 'ST01-006', 'ST01-006',
    'ST01-007', 'ST01-007', 'ST01-007', 'ST01-007',
    'ST01-008', 'ST01-008', 'ST01-009', 'ST01-009',
    'ST01-010', 'ST01-010', 'ST01-011', 'ST01-011',
  ];
  return [...base, ...extra].slice(0, 50).concat(Array(Math.max(0, 50 - base.length - extra.length)).fill('ST01-007'));
}

function newEngine(extra: string[] = [], seed = 99): GameEngine {
  const engine = new GameEngine(
    `game-rules-core-${seed}`,
    { playerId: 'p1', deckCardNumbers: deck(extra) },
    { playerId: 'p2', deckCardNumbers: deck(extra) },
    seed,
    cardDb
  );
  engine.dispatchAction({ type: 'PASS_ACTION_TIMING', playerId: engine.getState().activePlayerId });
  expect(engine.getState().phase).toBe('MAIN_PHASE');
  return engine;
}

function take(engine: GameEngine, playerId: string, cardNumber: string): CardInstance {
  const card = Object.values(engine.getState().cards).find(
    (c) => c.controllerPlayerId === playerId && c.cardNumber === cardNumber && c.zone !== 'BATTLEFIELD'
  );
  if (!card) throw new Error(`找不到 ${playerId} 的 ${cardNumber}`);
  return card;
}

/** 放置到战场并视为已在场一回合以上 (可以攻击) */
function placeRole(engine: GameEngine, playerId: string, cardNumber: string, slot: number): CardInstance {
  const card = take(engine, playerId, cardNumber);
  expect(engine.fieldMgr.playRoleCard(playerId, card.instanceId, slot)).toBe(true);
  card.turnEnteredZone = 0;
  return card;
}

describe('区域与状态', () => {
  it('9.2 牌组更新：墓地洗切后成为新牌组，侵蚀计数 +1', () => {
    const engine = newEngine();
    const state = engine.getState();
    const p1 = state.activePlayerId;

    const gy = engine.zoneMgr.getCardsInZone(p1, 'DECK');
    for (const c of gy) engine.zoneMgr.moveCard(c.instanceId, 'GRAVEYARD', { isFaceUp: true });
    const graveyardOrder = engine.zoneMgr.getCardsInZone(p1, 'GRAVEYARD').map((c) => c.instanceId);
    const erosionBefore = state.players[p1]!.erosionCount;

    engine.zoneMgr.drawCards(p1, 1);

    expect(state.players[p1]!.erosionCount).toBe(erosionBefore + 1);
    const newDeckOrder = engine.zoneMgr.getCardsInZone(p1, 'DECK').map((c) => c.instanceId);
    expect(newDeckOrder.length).toBe(graveyardOrder.length - 1);
    // 洗切过：新牌组不是按原墓地顺序排列
    expect(newDeckOrder).not.toEqual(graveyardOrder.slice(1));
    expect(engine.getEvents().some((e) => e.type === 'CARDS_SHUFFLED' && e.playerId === p1)).toBe(true);
  });

  it('9.2 攻击充能时牌组为空也会先执行牌组更新', () => {
    const engine = newEngine();
    const state = engine.getState();
    const p1 = state.activePlayerId;
    const attacker = placeRole(engine, p1, 'ST01-006', 0);

    for (const c of engine.zoneMgr.getCardsInZone(p1, 'DECK')) {
      engine.zoneMgr.moveCard(c.instanceId, 'GRAVEYARD', { isFaceUp: true });
    }
    const erosionBefore = state.players[p1]!.erosionCount;
    engine.zoneMgr.performAttackCharge(attacker.instanceId, 1);
    expect(state.players[p1]!.erosionCount).toBe(erosionBefore + 1);
    expect(engine.getEvents().some((e) => e.type === 'ATTACK_CHARGE_PERFORMED')).toBe(true);
  });

  it('3.1.4 离开区域的卡牌不保留原区域的临时效果与赋予的能力', () => {
    const engine = newEngine();
    const p1 = engine.getState().activePlayerId;
    const role = placeRole(engine, p1, 'ST01-006', 0);
    role.tempPPBonus = 2000;
    role.grantedKeywords = ['速攻'];

    engine.zoneMgr.moveCard(role.instanceId, 'HAND', { isFaceUp: true });
    const inHand = engine.getState().cards[role.instanceId]!;
    expect(inHand.tempPPBonus).toBeUndefined();
    expect(inHand.grantedKeywords).toBeUndefined();
    expect(inHand.slotIndex).toBeUndefined();
    expect(engine.getState().battlefields[p1]![0]!.roleCardId).toBeUndefined();
  });

  it('9.6 升变角色以任何方式离开战场，其下方的牌和装备都放置到墓地', () => {
    const engine = newEngine(['ST02-009']);
    const state = engine.getState();
    const p1 = state.activePlayerId;
    const base = placeRole(engine, p1, 'ST01-004', 0);
    const equip = take(engine, p1, 'ST02-009');
    engine.fieldMgr.playStandaloneEquipment(p1, equip.instanceId, 1);
    expect(engine.fieldMgr.equipToRole(p1, equip.instanceId, base.instanceId)).toBe(true);

    const top = take(engine, p1, 'ST01-001');
    engine.zoneMgr.moveCard(top.instanceId, 'HAND', { isFaceUp: true });
    expect(engine.fieldMgr.playAscensionCard(p1, top.instanceId, base.instanceId)).toBe(true);
    expect(state.cards[top.instanceId]!.attachedEquipmentId).toBe(equip.instanceId);

    // 效果直接返回手牌 (不经过 handleCardLeaveField)
    engine.zoneMgr.moveCard(top.instanceId, 'HAND', { isFaceUp: true });
    expect(state.cards[base.instanceId]!.zone).toBe('GRAVEYARD');
    expect(state.cards[equip.instanceId]!.zone).toBe('GRAVEYARD');
    expect(state.battlefields[p1]![0]!.roleCardId).toBeUndefined();
  });

  it('3.6 费用统计由费用区实际卡牌派生；费用不足时不能支付', () => {
    const engine = newEngine();
    const state = engine.getState();
    const p1 = state.activePlayerId;
    const player = state.players[p1]!;

    // 篡改统计字段不会凭空产生费用
    player.availableOpenCostCount = 10;
    player.totalCostCount = 10;
    const realReady = engine.zoneMgr.getCardsInZone(p1, 'COST').filter((c) => c.isFaceUp && c.isReady).length;
    expect(engine.payCost(p1, realReady + 1)).toBe(false);

    const hidden = engine.zoneMgr.getCardsInZone(p1, 'DECK')[0]!;
    engine.zoneMgr.moveCard(hidden.instanceId, 'COST', { isFaceUp: false, isReady: true });
    expect(player.hiddenCostCount).toBe(1);
    expect(player.totalCostCount).toBe(engine.zoneMgr.getCardsInZone(p1, 'COST').length);
    expect(engine.payCost(p1, realReady + 1)).toBe(true);
    expect(player.availableOpenCostCount).toBe(0);
    expect(player.hiddenCostCount).toBe(0);
    expect(state.cards[hidden.instanceId]!.zone).toBe('GRAVEYARD');
  });
});

describe('升变 (8.11)', () => {
  it('解析升变条件：<特征> 与《卡名》区分，「X以下」为严格小于，「费用为X的」为恰好等于', () => {
    const st01 = parseAscensionConfig(OFFICIAL_CARDS_DATA.find((c) => c.cardNumber === 'ST01-001')!.rulesText)!;
    expect(st01.targetFilter).toMatchObject({ traits: ['露西亚'], maxCost: 4 });
    expect(st01.grantKeywords).toEqual(['速攻']);

    const st02 = parseAscensionConfig(OFFICIAL_CARDS_DATA.find((c) => c.cardNumber === 'ST02-001')!.rulesText)!;
    expect(st02.targetFilter).toMatchObject({ exactName: '露娜·银冕', maxCost: 5 });

    const liv = parseAscensionConfig(OFFICIAL_CARDS_DATA.find((c) => c.cardNumber === 'BP02-010')!.rulesText)!;
    expect(liv.targetFilter.exactCost).toBe(4);

    // BP03-003 的升变能力不赋予【速攻】，即使卡牌其他能力中出现了「获得【速攻】」
    const bp03003 = parseAscensionConfig(OFFICIAL_CARDS_DATA.find((c) => c.cardNumber === 'BP03-003')!.rulesText)!;
    expect(bp03003.grantKeywords).toEqual([]);
    expect(bp03003.restrictionFilter?.conditions).toEqual([{ kind: 'MAX_FIELD_ROLES', value: 3 }]);

    // BP03-012 的升变能力赋予【突进】
    const bp03012 = parseAscensionConfig(OFFICIAL_CARDS_DATA.find((c) => c.cardNumber === 'BP03-012')!.rulesText)!;
    expect(bp03012.grantKeywords).toEqual(['突进']);

    // 尚未支持的升变代价明确标记，而不是忽略
    const bp01040 = parseAscensionConfig(OFFICIAL_CARDS_DATA.find((c) => c.cardNumber === 'BP01-040')!.rulesText)!;
    expect(bp01040.unsupportedReason).toContain('额外行动');
  });

  it('升变限制条件「费用上限X及以上」不满足时不能升变，满足后可以', () => {
    const engine = newEngine();
    const state = engine.getState();
    const p1 = state.activePlayerId;
    const base = placeRole(engine, p1, 'ST01-004', 0);
    const asc = take(engine, p1, 'ST01-001');
    engine.zoneMgr.moveCard(asc.instanceId, 'HAND', { isFaceUp: true });

    // 费用区放入 1 张物理属性明费满足属性条件，共 3 张 (费用上限 3 < 5)
    const phys = take(engine, p1, 'ST01-005');
    engine.zoneMgr.moveCard(phys.instanceId, 'COST', { isFaceUp: true, isReady: true });
    expect(engine.zoneMgr.getCardsInZone(p1, 'COST').length).toBeLessThan(5);
    const play = () =>
      engine.dispatchAction({
        type: 'PLAY_CARD',
        playerId: p1,
        cardInstanceId: asc.instanceId,
        isAscension: true,
        targetAscensionCardId: base.instanceId,
      });
    const fail = play();
    expect(fail.success).toBe(false);
    expect(fail.error).toContain('费用上限');

    fillCostZone(engine, p1, 5);
    const ok = play();
    expect(ok.success).toBe(true);
    expect(state.cards[asc.instanceId]!.grantedKeywords).toContain('速攻');
  });

  it('升变对象的费用须小于「X以下」中的 X：费用 5 的<露西亚>不能作为 ST01-001 的升变对象', () => {
    const engine = newEngine(['ST01-001']);
    const p1 = engine.getState().activePlayerId;
    fillCostZone(engine, p1, 6);
    // 构造一个费用为 5 的露西亚：ST01-001 自身 (费用 5，<露西亚>)
    const base = placeRole(engine, p1, 'ST01-001', 0);
    const asc = Object.values(engine.getState().cards).find(
      (c) => c.controllerPlayerId === p1 && c.cardNumber === 'ST01-001' && c.instanceId !== base.instanceId
    );
    expect(asc).toBeDefined();
    if (!asc) return;
    engine.zoneMgr.moveCard(asc.instanceId, 'HAND', { isFaceUp: true });
    const res = engine.dispatchAction({
      type: 'PLAY_CARD',
      playerId: p1,
      cardInstanceId: asc.instanceId,
      isAscension: true,
      targetAscensionCardId: base.instanceId,
    });
    expect(res.success).toBe(false);
  });

  it('不再把出牌到有角色的卡位自动当成升变', () => {
    const engine = newEngine();
    const p1 = engine.getState().activePlayerId;
    fillCostZone(engine, p1, 6);
    placeRole(engine, p1, 'ST01-004', 0);
    const asc = take(engine, p1, 'ST01-001');
    engine.zoneMgr.moveCard(asc.instanceId, 'HAND', { isFaceUp: true });
    const res = engine.dispatchAction({ type: 'PLAY_CARD', playerId: p1, cardInstanceId: asc.instanceId, targetSlotIndex: 0 });
    expect(res.success).toBe(false);
    expect(engine.getState().cards[asc.instanceId]!.zone).toBe('HAND');
  });
});

describe('关键字能力', () => {
  it('只有「【永】：【关键字】」才视为自身持有；暮/晖形态单独标记', () => {
    const text = (n: string) => OFFICIAL_CARDS_DATA.find((c) => c.cardNumber === n)!.rulesText;
    expect(parseInherentKeywords(text('BP02-041')).map((k) => k.keyword)).toContain('速攻');
    // BP01-010 让《露娜·银冕》获得【贯通】，自身并不持有
    expect(parseInherentKeywords(text('BP01-010'))).toEqual([]);
    expect(parseInherentKeywords(text('ST01-004'))).toEqual([{ keyword: '充能0', form: undefined }]);
    expect(parseInherentKeywords(text('BP02-022'))).toEqual([{ keyword: '速攻', form: '暮' }]);
    expect(parseInherentKeywords(text('BP02-077')).map((k) => k.keyword)).toContain('同命');
  });

  it('10.14 暮形态的【速攻】只在信号球区最下方卡牌费用为偶数时有效', () => {
    const engine = newEngine(['BP02-022']);
    const state = engine.getState();
    const p1 = state.activePlayerId;
    const bianca = take(engine, p1, 'BP02-022');
    engine.fieldMgr.playRoleCard(p1, bianca.instanceId, 0); // 本回合出场

    expect(engine.combatMgr.hasKeyword(bianca.instanceId, '速攻')).toBe(false); // 信号球区为空

    const orb = take(engine, p1, 'ST01-012'); // 信号球费用 0 (偶数)
    engine.zoneMgr.moveCard(orb.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    expect(engine.combatMgr.hasKeyword(bianca.instanceId, '速攻')).toBe(true);
  });

  it('BP01-010 文本中提到【贯通】，但战斗破坏角色时不会给予贯通伤害', () => {
    const engine = newEngine(['BP01-010']);
    const state = engine.getState();
    const p1 = state.activePlayerId;
    const p2 = state.nonActivePlayerId;
    const roland = placeRole(engine, p1, 'BP01-010', 0); // PP 3500
    const target = placeRole(engine, p2, 'ST01-004', 0); // PP 3000
    target.isReady = false;
    const erosionBefore = state.players[p2]!.erosionCount;

    expect(
      engine.dispatchAction({
        type: 'DECLARE_ATTACK',
        playerId: p1,
        attackerCardId: roland.instanceId,
        targetType: 'CHARACTER',
        targetCardId: target.instanceId,
      }).success
    ).toBe(true);
    engine.dispatchAction({ type: 'DECLARE_BLOCK', playerId: p2 });
    // 攻击充能可能产生【充能自】决策，先全部跳过
    while (state.currentPendingChoice) {
      const ch = state.currentPendingChoice;
      const pick = ch.minSelections > 0 ? [ch.options.find((o) => (o.payload as any)?.eligible !== false)!.id] : [];
      engine.dispatchAction({ type: 'SELECT_CHOICE_OPTION', playerId: ch.playerId, pendingChoiceId: ch.id, selectedIds: pick });
    }

    expect(state.cards[target.instanceId]!.zone).toBe('GRAVEYARD');
    expect(state.players[p2]!.erosionCount).toBe(erosionBefore);
  });

  it('10.16 同命：持有者攻击结束时可以选择破坏自身与发生战斗的角色；被攻击时不发动', () => {
    const engine = newEngine(['BP02-078', 'BP02-078']);
    const state = engine.getState();
    const p1 = state.activePlayerId;
    const p2 = state.nonActivePlayerId;
    const sprayer = placeRole(engine, p1, 'BP02-078', 0); // 喷涂机械 PP 2000 【充能0】【同命】
    const target = placeRole(engine, p2, 'ST01-006', 0); // PP 8000
    target.isReady = false;

    engine.dispatchAction({
      type: 'DECLARE_ATTACK',
      playerId: p1,
      attackerCardId: sprayer.instanceId,
      targetType: 'CHARACTER',
      targetCardId: target.instanceId,
    });
    engine.dispatchAction({ type: 'DECLARE_BLOCK', playerId: p2 });

    // PP 2000 < 8000，无事发生；攻击结束时询问是否发动同命
    const choice = state.currentPendingChoice;
    expect(choice?.effectType).toBe('MUTUAL_DESTINY');
    expect(choice?.playerId).toBe(p1);
    expect(state.cards[target.instanceId]!.zone).toBe('BATTLEFIELD');

    engine.dispatchAction({ type: 'SELECT_CHOICE_OPTION', playerId: p1, pendingChoiceId: choice!.id, selectedIds: ['opt_yes'] });
    expect(state.cards[sprayer.instanceId]!.zone).toBe('GRAVEYARD');
    expect(state.cards[target.instanceId]!.zone).toBe('GRAVEYARD');
  });

  it('被攻击的角色持有同命时，不会带走攻击角色', () => {
    const engine = newEngine(['BP02-078']);
    const state = engine.getState();
    const p1 = state.activePlayerId;
    const p2 = state.nonActivePlayerId;
    const attacker = placeRole(engine, p1, 'ST01-006', 0); // PP 8000
    const sprayer = placeRole(engine, p2, 'BP02-078', 0);
    sprayer.isReady = false;

    engine.dispatchAction({
      type: 'DECLARE_ATTACK',
      playerId: p1,
      attackerCardId: attacker.instanceId,
      targetType: 'CHARACTER',
      targetCardId: sprayer.instanceId,
    });
    engine.dispatchAction({ type: 'DECLARE_BLOCK', playerId: p2 });
    while (state.currentPendingChoice) {
      const ch = state.currentPendingChoice;
      expect(ch.effectType).not.toBe('MUTUAL_DESTINY');
      engine.dispatchAction({
        type: 'SELECT_CHOICE_OPTION',
        playerId: ch.playerId,
        pendingChoiceId: ch.id,
        selectedIds: ch.minSelections > 0 ? [ch.options[ch.options.length - 1]!.id] : [],
      });
    }
    expect(state.cards[sprayer.instanceId]!.zone).toBe('GRAVEYARD');
    expect(state.cards[attacker.instanceId]!.zone).toBe('BATTLEFIELD');
  });
});

describe('卡牌效果的错误映射与决策排队', () => {
  it('BP01-008 露娜·银冕出场不会把对方角色送进费用区；BP01-013 终焉降临不会抽 2 张牌', () => {
    const engine = newEngine(['BP01-008', 'BP01-013']);
    const state = engine.getState();
    const p1 = state.activePlayerId;
    const p2 = state.nonActivePlayerId;
    const oppRole = placeRole(engine, p2, 'ST01-004', 0);

    const luna = take(engine, p1, 'BP01-008');
    engine.fieldMgr.playRoleCard(p1, luna.instanceId, 0);
    engine.effectEngine.handleRoleEntryEffect(p1, luna.instanceId, cardDb.getCard('BP01-008')!);
    expect(state.cards[oppRole.instanceId]!.zone).toBe('BATTLEFIELD');
    expect(state.currentPendingChoice?.effectType).not.toBe('SEND_ROLE_TO_COST');

    const handBefore = engine.zoneMgr.getCardsInZone(p1, 'HAND').length;
    const finale = take(engine, p1, 'BP01-013');
    engine.zoneMgr.moveCard(finale.instanceId, 'HAND', { isFaceUp: true });
    engine.effectEngine.handlePlayTactics(p1, finale.instanceId, cardDb.getCard('BP01-013')!);
    expect(engine.zoneMgr.getCardsInZone(p1, 'HAND').length).toBeLessThan(handBefore + 2);
  });

  it('同时产生多个决策时排队处理，不会互相覆盖', () => {
    const engine = newEngine();
    const state = engine.getState();
    const p1 = state.activePlayerId;
    const set = (engine.effectEngine as any).ctx.setPendingChoice as (c: any) => void;
    const mk = (id: string) => ({
      id,
      playerId: p1,
      choiceType: 'SELECT_OPTION',
      prompt: id,
      options: [{ id: 'ok', label: 'ok' }],
      effectType: 'TEST_ONLY',
      minSelections: 1,
      maxSelections: 1,
    });
    set(mk('first'));
    set(mk('second'));
    expect(state.currentPendingChoice?.id).toBe('first');

    engine.dispatchAction({ type: 'SELECT_CHOICE_OPTION', playerId: p1, pendingChoiceId: 'first', selectedIds: ['ok'] });
    expect(state.currentPendingChoice?.id).toBe('second');
    engine.dispatchAction({ type: 'SELECT_CHOICE_OPTION', playerId: p1, pendingChoiceId: 'second', selectedIds: ['ok'] });
    expect(state.currentPendingChoice).toBeUndefined();
  });
});

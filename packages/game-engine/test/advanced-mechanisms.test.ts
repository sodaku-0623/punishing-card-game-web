import { describe, it, expect } from 'vitest';
import {
  GameEngine,
  MemoryCardDatabase,
  OFFICIAL_CARDS_DATA,
  addCardModifier,
  parseAssistConfig,
  sanitizeGameStateForPlayer,
} from '../src/index.js';
import { OFFICIAL_STARTER_DECKS } from '@zhanshuang/game-rules';
import { endTurn, fillCostZone, passInstantWindows, resolvePendingChoices } from './helpers.js';

const db = new MemoryCardDatabase(OFFICIAL_CARDS_DATA);

function expandDeck(code: 'ST01' | 'ST02' | 'ST03', extras: string[] = []): string[] {
  const deckDef = OFFICIAL_STARTER_DECKS.find((d) => d.name.includes(`(${code})`))!;
  const cards: string[] = [];
  for (const item of deckDef.cards) {
    for (let i = 0; i < item.count; i++) cards.push(item.cardNumber);
  }
  for (let i = 0; i < extras.length && i < cards.length; i++) {
    cards[cards.length - 1 - i] = extras[i]!;
  }
  return cards;
}

function createEngine(p1Deck: string[], p2Deck: string[], seed = 20260723): GameEngine {
  const engine = new GameEngine(
    'adv-mech-test',
    { playerId: 'p1', deckCardNumbers: p1Deck },
    { playerId: 'p2', deckCardNumbers: p2Deck },
    seed,
    db,
    { skipMulligan: true }
  );
  const chargeIfNeeded = () => {
    const st = engine.getState();
    if (st.phase === 'DRAW_CHARGE_PHASE') {
      const hand = engine.zoneMgr.getCardsInZone(st.activePlayerId, 'HAND');
      engine.dispatchAction({
        type: 'CHARGE_COST_FROM_HAND',
        playerId: st.activePlayerId,
        cardInstanceId: hand[0]?.instanceId,
      });
    }
  };
  chargeIfNeeded();
  if (engine.getState().activePlayerId !== 'p1') {
    endTurn(engine);
    chargeIfNeeded();
  }
  return engine;
}

function findCard(engine: GameEngine, playerId: string, cardNumber: string) {
  const card = Object.values(engine.getState().cards).find(
    (c) => c.controllerPlayerId === playerId && c.cardNumber === cardNumber
  );
  if (!card) throw new Error(`未找到玩家 ${playerId} 的卡牌 ${cardNumber}`);
  return card;
}

function placeRole(
  engine: GameEngine,
  playerId: string,
  cardNumber: string,
  slotIndex: number,
  options?: { isReady?: boolean; enteredEarlier?: boolean }
) {
  const card = findCard(engine, playerId, cardNumber);
  engine.zoneMgr.moveCard(card.instanceId, 'HAND', { isFaceUp: true });
  engine.fieldMgr.playRoleCard(playerId, card.instanceId, slotIndex);
  if (options?.enteredEarlier !== false) {
    card.turnEnteredZone = 0;
  }
  if (options?.isReady !== undefined) {
    card.isReady = options.isReady;
  }
  return card;
}

function putNonOrbOnDeckTop(engine: GameEngine, playerId: string) {
  const nonOrb = engine.zoneMgr
    .getCardsInZone(playerId, 'DECK')
    .find((c) => !db.getCard(c.cardNumber)?.signalOrb && !db.getCard(c.cardNumber)?.rulesText.includes('充能自'));
  if (nonOrb) engine.zoneMgr.moveCardToTopOfDeck(nonOrb.instanceId);
}

describe('2.6 特殊升变条件完整支持 (BP01-040 & BP04-061 & 浮空对象)', () => {
  it('官方全卡表 490 张卡不再存在任何无法解析的升变配置 (unsupportedReason 全为空)', () => {
    const unsupported = OFFICIAL_CARDS_DATA.filter((c) => c.ascensionConfig?.unsupportedReason);
    expect(unsupported).toEqual([]);
  });

  it('BP01-040 七实·遥星之座：升变代价要求将战场1张《帕瓦》置入下方，缺少时拒绝，满足时一并垫底并获得【速攻】', () => {
    const engine = createEngine(
      expandDeck('ST01', ['BP01-040', 'BP01-041', 'BP01-049', 'BP01-049']),
      expandDeck('ST02')
    );
    const state = engine.getState();
    const active = state.activePlayerId;

    const targetNanami = placeRole(engine, active, 'BP01-041', 0);
    const bp01040 = findCard(engine, active, 'BP01-040');
    const pawas = Object.values(state.cards).filter(
      (c) => c.controllerPlayerId === active && c.cardNumber === 'BP01-049'
    );
    const fireCostCard = pawas[0]!;
    const pawaHand = pawas[1]!;
    // 先把升变卡和另一张《帕瓦》放进手牌，避免被 fillCostZone 抽进费用区；并放一张火属性《帕瓦》进明费区以满足火属性检查
    engine.zoneMgr.moveCard(bp01040.instanceId, 'HAND', { isFaceUp: true });
    engine.zoneMgr.moveCard(pawaHand.instanceId, 'HAND', { isFaceUp: true });
    engine.zoneMgr.moveCard(fireCostCard.instanceId, 'COST', { isFaceUp: true, isReady: true });
    fillCostZone(engine, active, 8);

    // 缺少战场《帕瓦》时必须拒绝
    const failRes = engine.dispatchAction({
      type: 'PLAY_CARD',
      playerId: active,
      cardInstanceId: bp01040.instanceId,
      isAscension: true,
      targetAscensionCardId: targetNanami.instanceId,
    });
    expect(failRes.success).toBe(false);

    // 在 1 号位放置《帕瓦》并作为升变额外代价置入下方
    engine.fieldMgr.playRoleCard(active, pawaHand.instanceId, 1);
    const okRes = engine.dispatchAction({
      type: 'PLAY_CARD',
      playerId: active,
      cardInstanceId: bp01040.instanceId,
      isAscension: true,
      targetAscensionCardId: targetNanami.instanceId,
      extraAscensionCostCardId: pawaHand.instanceId,
    });
    expect(okRes.success).toBe(true);
    expect(state.battlefields[active]![0]!.roleCardId).toBe(bp01040.instanceId);
    expect(state.battlefields[active]![1]!.roleCardId).toBeUndefined();
    expect(state.cards[bp01040.instanceId]!.underneathCardIds).toContain(targetNanami.instanceId);
    expect(state.cards[bp01040.instanceId]!.underneathCardIds).toContain(pawaHand.instanceId);
    expect(state.cards[bp01040.instanceId]!.effectiveKeywords).toContain('速攻');
  });

  it('BP04-061 比安卡·真理 & Q&A·10：可以以信号球区正面的<比安卡>为对象升变出场，但背面不能作为升变对象', () => {
    const engine2 = createEngine(
      expandDeck('ST01', ['BP04-061', 'BP04-062', 'BP04-062', 'BP04-065']),
      expandDeck('ST02')
    );
    const s2 = engine2.getState();
    const act2 = s2.activePlayerId;
    const bs = Object.values(s2.cards).filter((c) => c.controllerPlayerId === act2 && c.cardNumber === 'BP04-062');
    const fd = bs[0]!;
    const fu = bs[1]!;
    engine2.zoneMgr.moveCard(fd.instanceId, 'SIGNAL_ORB', { isFaceUp: false });
    engine2.zoneMgr.moveCard(fu.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    const equipLight = findCard(engine2, act2, 'BP04-065');
    engine2.zoneMgr.moveCard(equipLight.instanceId, 'COST', { isFaceUp: true, isReady: true });
    fillCostZone(engine2, act2, 4);
    const asc = findCard(engine2, act2, 'BP04-061');
    engine2.zoneMgr.moveCard(asc.instanceId, 'HAND', { isFaceUp: true });

    // Q&A·10 背面信号球区卡牌不能作为升变对象
    const badRes = engine2.dispatchAction({
      type: 'PLAY_CARD',
      playerId: act2,
      cardInstanceId: asc.instanceId,
      isAscension: true,
      targetAscensionCardId: fd.instanceId,
      targetSlotIndex: 0,
    });
    expect(badRes.success).toBe(false);
    expect(badRes.error).toContain('背面');

    // 正面信号球区 <比安卡> 升变出场成功
    const okRes = engine2.dispatchAction({
      type: 'PLAY_CARD',
      playerId: act2,
      cardInstanceId: asc.instanceId,
      isAscension: true,
      targetAscensionCardId: fu.instanceId,
      targetSlotIndex: 2,
    });
    expect(okRes.success).toBe(true);
    expect(s2.battlefields[act2]![2]!.roleCardId).toBe(asc.instanceId);
    expect(s2.cards[asc.instanceId]!.underneathCardIds).toEqual([fu.instanceId]);
    expect(s2.cards[fu.instanceId]!.zone).toBe('BATTLEFIELD');
    expect(s2.cards[asc.instanceId]!.effectiveKeywords).toContain('速攻');
  });
});

describe('2.5 玩家自选支付费用 (costCardInstanceIds)', () => {
  it('使用 costCardInstanceIds 精确横置指定明费与送墓指定暗费，非法的费用 ID 会整体验证失败并回滚', () => {
    const engine = createEngine(expandDeck('ST01'), expandDeck('ST02'));
    const state = engine.getState();
    const active = state.activePlayerId;

    // 清空现有费用区，手动放入 2 张物理明费 (open1, open2) 与 2 张暗费 (hidden1, hidden2)
    for (const c of engine.zoneMgr.getCardsInZone(active, 'COST')) {
      engine.zoneMgr.moveCard(c.instanceId, 'GRAVEYARD', { isFaceUp: true });
    }
    const roles = Object.values(state.cards).filter((c) => {
      const d = db.getCard(c.cardNumber);
      return c.controllerPlayerId === active && d?.cardType === 'ROLE' && d.attribute === 'PHYSICAL';
    });
    const playRole = roles.find((c) => (db.getCard(c.cardNumber)?.cost ?? 99) <= 4)!;
    const otherCosts = roles.filter((c) => c.instanceId !== playRole.instanceId);
    const open1 = otherCosts[0]!;
    const open2 = otherCosts[1]!;
    const deck = engine.zoneMgr.getCardsInZone(active, 'DECK');
    const hidden1 = deck[0]!;
    const hidden2 = deck[1]!;

    engine.zoneMgr.moveCard(open1.instanceId, 'COST', { isFaceUp: true, isReady: true });
    engine.zoneMgr.moveCard(open2.instanceId, 'COST', { isFaceUp: true, isReady: true });
    engine.zoneMgr.moveCard(hidden1.instanceId, 'COST', { isFaceUp: false, isReady: true });
    engine.zoneMgr.moveCard(hidden2.instanceId, 'COST', { isFaceUp: false, isReady: true });
    engine.zoneMgr.moveCard(playRole.instanceId, 'HAND', { isFaceUp: true });

    const targetCost = db.getCard(playRole.cardNumber)!.cost;
    expect(targetCost).toBeGreaterThanOrEqual(2);
    expect(targetCost).toBeLessThanOrEqual(4);

    // 传入非法数量或重复 ID → 拒绝并整体回滚
    const badRes = engine.dispatchAction({
      type: 'PLAY_CARD',
      playerId: active,
      cardInstanceId: playRole.instanceId,
      targetSlotIndex: 0,
      costCardInstanceIds: Array(targetCost).fill(open1.instanceId),
    });
    expect(badRes.success).toBe(false);
    expect(state.cards[playRole.instanceId]!.zone).toBe('HAND');

    // 指定消耗 open2 + hidden1 (+ 按需要补齐其余): 验证未选中的 open1 仍保持竖直
    const customPool = [open2.instanceId, hidden1.instanceId, hidden2.instanceId, open1.instanceId];
    const selected = customPool.slice(0, targetCost);
    const okRes = engine.dispatchAction({
      type: 'PLAY_CARD',
      playerId: active,
      cardInstanceId: playRole.instanceId,
      targetSlotIndex: 0,
      costCardInstanceIds: selected,
    });
    expect(okRes.success).toBe(true);
    expect(state.cards[open2.instanceId]!.isReady).toBe(false);
    expect(state.cards[hidden1.instanceId]!.zone).toBe('GRAVEYARD');
    if (targetCost < 4) {
      expect(state.cards[open1.instanceId]!.isReady).toBe(true);
    }
  });
});

describe('10.18 浮空与浮空模式', () => {
  it('浮空会连同下方垫牌与装备移入处理区并清除战场修饰符 (Q&A·6)，上限为 1 张 (10.18.2.a)，下回合开始自动回场且当回合不能普通攻击 (10.18.2.c/d)', () => {
    const engine = createEngine(expandDeck('ST01', ['BP03-001']), expandDeck('ST02'));
    const state = engine.getState();
    const active = state.activePlayerId;

    const host = placeRole(engine, active, 'ST01-004', 0);
    const extraRole = placeRole(engine, active, 'ST01-006', 1);
    const equip = findCard(engine, active, 'ST01-009');
    expect(engine.fieldMgr.equipToRole(active, equip.instanceId, host.instanceId)).toBe(true);
    host.isFrozen = true;
    addCardModifier(state, host, { pp: 1000, untilTurn: state.turnNumber, source: 'TEST' });

    // 将 host【浮空】到处理区
    expect(engine.fieldMgr.airborneRole(host.instanceId)).toBe(true);
    expect(state.cards[host.instanceId]!.zone).toBe('PROCESSING');
    expect(state.cards[host.instanceId]!.isAirborne).toBe(true);
    expect(state.cards[host.instanceId]!.modifiers).toBeUndefined();
    expect(state.cards[host.instanceId]!.isFrozen).toBeUndefined();
    expect(state.cards[equip.instanceId]!.zone).toBe('PROCESSING');
    expect(state.cards[equip.instanceId]!.isAirborne).toBeUndefined();

    // 10.18.2.a 处理区已有浮空模式卡牌时，第二张浮空不执行
    expect(engine.fieldMgr.airborneRole(extraRole.instanceId)).toBe(false);
    expect(state.cards[extraRole.instanceId]!.zone).toBe('BATTLEFIELD');

    // 回合结束 → 对手回合 → 回到自己回合的竖直阶段 (6.2.1.a) → 自动回场且连带装备恢复
    endTurn(engine);
    endTurn(engine);
    expect(state.activePlayerId).toBe(active);
    expect(state.cards[host.instanceId]!.zone).toBe('BATTLEFIELD');
    expect(state.cards[host.instanceId]!.isAirborne).toBeUndefined();
    expect(state.cards[host.instanceId]!.attachedEquipmentId).toBe(equip.instanceId);
    expect(state.cards[equip.instanceId]!.zone).toBe('BATTLEFIELD');

    // 10.18.2.d.1 回到战场的当回合不能攻击 (无速攻/突进)
    const hand = engine.zoneMgr.getCardsInZone(active, 'HAND');
    engine.dispatchAction({ type: 'CHARGE_COST_FROM_HAND', playerId: active, cardInstanceId: hand[0]?.instanceId });
    const atkRes = engine.dispatchAction({
      type: 'DECLARE_ATTACK',
      playerId: active,
      attackerCardId: host.instanceId,
      targetType: 'PLAYER',
    });
    expect(atkRes.success).toBe(false);

    // 10.18.2.e 回场时若战场 5 个卡位全部被占满，本体、下方牌与装备全部置入墓地
    expect(engine.fieldMgr.airborneRole(host.instanceId)).toBe(true);
    for (let s = 0; s < 5; s++) {
      if (!state.battlefields[active]![s]!.roleCardId) {
        const filler = engine.zoneMgr.getCardsInZone(active, 'DECK').find((c) => db.getCard(c.cardNumber)?.cardType === 'ROLE')!;
        engine.zoneMgr.moveCard(filler.instanceId, 'HAND', { isFaceUp: true });
        engine.fieldMgr.playRoleCard(active, filler.instanceId, s);
      }
    }
    endTurn(engine);
    endTurn(engine);
    expect(state.cards[host.instanceId]!.zone).toBe('GRAVEYARD');
    expect(state.cards[equip.instanceId]!.zone).toBe('GRAVEYARD');
  });
});

describe('8.13 协战机制与搭档管理', () => {
  it('协战文本解析：覆盖战场/手牌/墓地多种搭档代价 (parseAssistConfig)', () => {
    const bp04023 = parseAssistConfig(OFFICIAL_CARDS_DATA.find((c) => c.cardNumber === 'BP04-023')!.rulesText)!;
    expect(bp04023.partnerFilter).toEqual({ maxCost: 3, traits: ['遗忘者'] });
    expect(bp04023.costOptions).toEqual([{ zone: 'BATTLEFIELD', costAmount: 0 }]);

    const bp04034 = parseAssistConfig(OFFICIAL_CARDS_DATA.find((c) => c.cardNumber === 'BP04-034')!.rulesText)!;
    expect(bp04034.costOptions).toEqual([
      { zone: 'GRAVEYARD', costAmount: 0, eliminateOrbs: { filter: 'ANY', count: 3 } },
      { zone: 'BATTLEFIELD', costAmount: 0 },
    ]);

    const bp04045 = parseAssistConfig(OFFICIAL_CARDS_DATA.find((c) => c.cardNumber === 'BP04-045')!.rulesText)!;
    expect(bp04045.partnerFilter).toEqual({ traits: ['塞西莉'] });
    expect(bp04045.costOptions).toEqual([
      { zone: 'HAND', costAmount: 2 },
      { zone: 'BATTLEFIELD', costAmount: 0 },
    ]);
  });

  it('8.13.3 / 8.13.4 自由时点战场协战、基本值叠加、攻击中禁用、每回合1次及回合结束自动解除 (含隐藏信息脱敏)', () => {
    const engine = createEngine(
      expandDeck('ST01', ['BP04-023', 'BP04-029', 'BP04-030']),
      expandDeck('ST02')
    );
    const state = engine.getState();
    const active = state.activePlayerId;
    const opp = state.nonActivePlayerId;

    const attacker = placeRole(engine, active, 'ST01-005', 0, { isReady: true });
    const watanabe = placeRole(engine, active, 'BP04-023', 1, { isReady: true }); // PP 5000, Cost 5
    const backhaus = placeRole(engine, active, 'BP04-029', 2, { isReady: true }); // FIRE, PP 3000, Cost 3, <遗忘者>
    const bruce = placeRole(engine, active, 'BP04-030', 3, { isReady: true });

    // 给防守方 1 张可发动的瞬时，使得双方在自由时点不会直接全跳过；对方 pass 后即轮到 active
    fillCostZone(engine, opp, 10);
    const oppInstant = findCard(engine, opp, 'ST02-011');
    // ST02-011 需要场上存在《露娜·银冕》且被攻击，用无前置的 ST02-010 替代
    const oppAtkRole = findCard(engine, opp, 'ST02-010');
    engine.zoneMgr.moveCard(oppAtkRole.instanceId, 'HAND', { isFaceUp: true });
    void oppInstant;

    putNonOrbOnDeckTop(engine, active);
    putNonOrbOnDeckTop(engine, opp);
    expect(
      engine.dispatchAction({
        type: 'DECLARE_ATTACK',
        playerId: active,
        attackerCardId: attacker.instanceId,
        targetType: 'PLAYER',
      }).success
    ).toBe(true);

    // 因为 active 拥有可发动的 0 费战场协战，opp 自动 pass 瞬时后时机停留在 active 手中 (FREE_TIMING)
    expect(state.phase).toBe('COMBAT_FREE_TIMING');
    expect(state.timingWindow?.priorityPlayerId).toBe(active);

    // 执行协战：BP04-023 将战场 3 费的 BP04-029 作为搭档 (0 费)
    const assistRes = engine.dispatchAction({
      type: 'PERFORM_ASSIST',
      playerId: active,
      hostRoleCardId: watanabe.instanceId,
      partnerCardId: backhaus.instanceId,
    });
    expect(assistRes.success).toBe(true);
    expect(state.cards[watanabe.instanceId]!.partnerCardId).toBe(backhaus.instanceId);
    expect(state.cards[backhaus.instanceId]!.partnerOfCardId).toBe(watanabe.instanceId);
    expect(state.battlefields[active]![2]!.roleCardId).toBeUndefined();
    expect(engine.fieldMgr.isSlotRole(active, backhaus.instanceId)).toBe(false); // 8.13.4.a.1 搭档非角色牌

    // 8.13.4.b.1 协战角色基本 PP/费用叠加
    expect(engine.fieldMgr.calculateRoleEffectivePP(watanabe.instanceId)).toBe(8000); // 5000 + 3000
    expect(engine.continuousEffects.getEffectiveCardCost(watanabe.instanceId)).toBe(8); // 5 + 3

    // 8.13.3.b.1 同一回合每张角色通过协战最多获得 1 张搭档
    passInstantWindows(engine); // 完成本次攻击先回到 MAIN_PHASE，再看回合内二次协战被拒
    resolvePendingChoices(engine);
    expect(state.phase).toBe('MAIN_PHASE');

    const attacker2 = placeRole(engine, active, 'ST01-006', 4, { isReady: true });
    putNonOrbOnDeckTop(engine, active);
    putNonOrbOnDeckTop(engine, opp);
    expect(
      engine.dispatchAction({
        type: 'DECLARE_ATTACK',
        playerId: active,
        attackerCardId: attacker2.instanceId,
        targetType: 'PLAYER',
      }).success
    ).toBe(true);
    if (state.timingWindow?.priorityPlayerId === active) {
      const secondTry = engine.dispatchAction({
        type: 'PERFORM_ASSIST',
        playerId: active,
        hostRoleCardId: watanabe.instanceId,
        partnerCardId: bruce.instanceId,
      });
      expect(secondTry.success).toBe(false);
    }
    passInstantWindows(engine);
    resolvePendingChoices(engine);

    // 8.13.4.c.1 结束阶段自动解除协战状态并把搭档放置到墓地 (不视为离场)
    endTurn(engine);
    expect(state.cards[watanabe.instanceId]!.partnerCardId).toBeUndefined();
    expect(state.cards[backhaus.instanceId]!.zone).toBe('GRAVEYARD');
    expect(state.cards[backhaus.instanceId]!.partnerOfCardId).toBeUndefined();
    expect(engine.fieldMgr.calculateRoleEffectivePP(watanabe.instanceId)).toBe(5000);
    expect(sanitizeGameStateForPlayer(state, opp).publicCards[watanabe.instanceId]!.partnerCardId).toBeUndefined();
  });

  it('8.13.2.b.2 手牌/墓地协战与 8.13.4.a.3 宿主离场连带搭档送墓', () => {
    const engine = createEngine(
      expandDeck('ST01', ['BP04-045', 'BP04-046', 'BP04-034', 'BP04-042']),
      expandDeck('ST02')
    );
    const state = engine.getState();
    const active = state.activePlayerId;
    const opp = state.nonActivePlayerId;

    const attacker = placeRole(engine, active, 'ST01-005', 0, { isReady: true });
    const alisa = placeRole(engine, active, 'BP04-045', 1);
    const cecily = findCard(engine, active, 'BP04-046');
    engine.zoneMgr.moveCard(cecily.instanceId, 'HAND', { isFaceUp: true });
    fillCostZone(engine, active, 6);

    const karenina = placeRole(engine, active, 'BP04-034', 2);
    const teddy = findCard(engine, active, 'BP04-042');
    engine.zoneMgr.moveCard(teddy.instanceId, 'GRAVEYARD', { isFaceUp: true });
    const orbs = Object.values(state.cards)
      .filter((c) => c.controllerPlayerId === active && db.getCard(c.cardNumber)?.signalOrb)
      .slice(0, 3);
    for (const o of orbs) {
      engine.zoneMgr.moveCard(o.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    }

    putNonOrbOnDeckTop(engine, active);
    putNonOrbOnDeckTop(engine, opp);
    expect(
      engine.dispatchAction({
        type: 'DECLARE_ATTACK',
        playerId: active,
        attackerCardId: attacker.instanceId,
        targetType: 'PLAYER',
      }).success
    ).toBe(true);

    // 手牌 2 费协战 (BP04-045 + 塞西莉)
    expect(state.timingWindow?.priorityPlayerId).toBe(active);
    const handAssist = engine.dispatchAction({
      type: 'PERFORM_ASSIST',
      playerId: active,
      hostRoleCardId: alisa.instanceId,
      partnerCardId: cecily.instanceId,
    });
    expect(handAssist.success).toBe(true);
    expect(state.cards[alisa.instanceId]!.partnerCardId).toBe(cecily.instanceId);
    expect(state.cards[alisa.instanceId]!.effectivePP).toBe(10500); // 6500 + 4000
    expect(state.cards[alisa.instanceId]!.effectiveDP).toBe(2); // 1 + 1
    // BP04-046 成为协战搭档时触发可选消球能力：本测试选择不消球以保留后续 3 球供 BP04-042 墓地协战
    resolvePendingChoices(engine, 'skip');

    // 等回过优先权后再墓地消 3 球协战 (BP04-034 + BP04-042 具备<工程部队>的布偶熊·觅语)
    if (state.timingWindow && state.timingWindow.priorityPlayerId !== active) {
      engine.dispatchAction({ type: 'PASS_ACTION_TIMING', playerId: state.timingWindow.priorityPlayerId });
    }
    const gyAssist = engine.dispatchAction({
      type: 'PERFORM_ASSIST',
      playerId: active,
      hostRoleCardId: karenina.instanceId,
      partnerCardId: teddy.instanceId,
      orbCardInstanceIds: orbs.map((o) => o.instanceId),
    });
    expect(gyAssist.success).toBe(true);
    expect(state.cards[karenina.instanceId]!.partnerCardId).toBe(teddy.instanceId);
    expect(orbs.every((o) => state.cards[o.instanceId]!.zone === 'GRAVEYARD')).toBe(true);

    // 8.13.4.a.3 宿主离场时，其搭档连带置入墓地
    passInstantWindows(engine);
    resolvePendingChoices(engine);
    engine.zoneMgr.moveCard(alisa.instanceId, 'HAND', { isFaceUp: true });
    expect(state.cards[cecily.instanceId]!.zone).toBe('GRAVEYARD');
    expect(state.cards[cecily.instanceId]!.partnerOfCardId).toBeUndefined();
  });
});

describe('10.8 角色与装备【瞬时】能力 & 10.2.1.b 带条件/代价的【充能自】', () => {
  it('10.8 非战术牌【瞬时】：BP03-054 从费用区加攻后回牌组底，BP04-004 在对方回合从《露娜·终焉》下方以 3 费减费出场，BP04-028 破坏 3 火后消 2 球手牌出场', () => {
    const engine = createEngine(
      expandDeck('ST01', ['BP03-047', 'BP03-054', 'BP04-028', 'BP04-028', 'BP04-028']),
      expandDeck('ST02', ['BP04-001', 'BP04-004'])
    );
    const state = engine.getState();
    const active = state.activePlayerId;
    const opp = state.nonActivePlayerId;

    // 1. p1 费用区放 BP03-054 (艾拉·万华)，战场放 BP03-047 (<艺术协会>)，攻击角色准备攻击
    const attacker = placeRole(engine, active, 'ST01-005', 0, { isReady: true });
    const aylaHost = placeRole(engine, active, 'BP03-047', 1);
    const aylaCost = findCard(engine, active, 'BP03-054');
    engine.zoneMgr.moveCard(aylaCost.instanceId, 'COST', { isFaceUp: true, isReady: true });

    // 2. 对手 (opp) 场上放 BP04-001，把 BP04-004 垫在其下方，并正好放 3 费验证对方自由时点减费为 3 费
    const lunaHost = placeRole(engine, opp, 'BP04-001', 0);
    const lunaUnder = findCard(engine, opp, 'BP04-004');
    engine.zoneMgr.moveCard(lunaUnder.instanceId, 'BATTLEFIELD', { isFaceUp: true });
    lunaHost.underneathCardIds.push(lunaUnder.instanceId);
    fillCostZone(engine, opp, 3);

    putNonOrbOnDeckTop(engine, active);
    putNonOrbOnDeckTop(engine, opp);
    expect(
      engine.dispatchAction({
        type: 'DECLARE_ATTACK',
        playerId: active,
        attackerCardId: attacker.instanceId,
        targetType: 'PLAYER',
      }).success
    ).toBe(true);

    // 回合外 opp 先拥有自由时点优先权，用 3 费从下方瞬时出场 BP04-004
    expect(state.timingWindow?.priorityPlayerId).toBe(opp);
    const lunaRes = engine.dispatchAction({
      type: 'USE_INSTANT',
      playerId: opp,
      cardInstanceId: lunaUnder.instanceId,
    });
    expect(lunaRes.success).toBe(true);
    expect(state.cards[lunaUnder.instanceId]!.zone).toBe('BATTLEFIELD');
    expect(engine.fieldMgr.isSlotRole(opp, lunaUnder.instanceId)).toBe(true);
    expect(state.cards[lunaHost.instanceId]!.underneathCardIds).not.toContain(lunaUnder.instanceId);

    // 轮到 active：发动费用区 BP03-054【瞬时】，回到牌组底并使 BP03-047 PP+1000
    expect(state.timingWindow?.priorityPlayerId).toBe(active);
    const aylaBasePP = engine.fieldMgr.calculateRoleEffectivePP(aylaHost.instanceId);
    const aylaRes = engine.dispatchAction({
      type: 'USE_INSTANT',
      playerId: active,
      cardInstanceId: aylaCost.instanceId,
    });
    expect(aylaRes.success).toBe(true);
    expect(state.cards[aylaCost.instanceId]!.zone).toBe('DECK');
    expect(engine.fieldMgr.calculateRoleEffectivePP(aylaHost.instanceId)).toBe(aylaBasePP + 1000);

    // 战斗结束时清理 BP03-054 的攻击期 buff，恢复原有 PP (由于 opp 刚出场了竖直的 BP04-004，需显式放弃阻挡)
    passInstantWindows(engine);
    if (state.currentCombat?.step === 'BLOCK') {
      engine.dispatchAction({ type: 'DECLARE_BLOCK', playerId: opp });
    }
    passInstantWindows(engine);
    resolvePendingChoices(engine);
    expect(engine.fieldMgr.calculateRoleEffectivePP(aylaHost.instanceId)).toBe(aylaBasePP);

    // 3. BP04-028 渡边·尘铭：累计我方火属性角色被破坏 3 张 → 在攻击自由时点消 2 球手牌出场
    const wataHand = findCard(engine, active, 'BP04-028');
    engine.zoneMgr.moveCard(wataHand.instanceId, 'HAND', { isFaceUp: true });
    state.players[active]!.destroyedFireRoleCountThisTurn = 3;
    const redOrbs = Object.values(state.cards)
      .filter((c) => c.controllerPlayerId === active && db.getCard(c.cardNumber)?.signalOrb === 'RED')
      .slice(0, 2);
    for (const o of redOrbs) engine.zoneMgr.moveCard(o.instanceId, 'SIGNAL_ORB', { isFaceUp: true });

    const attacker2 = placeRole(engine, active, 'ST01-006', 2, { isReady: true });
    putNonOrbOnDeckTop(engine, active);
    putNonOrbOnDeckTop(engine, opp);
    expect(
      engine.dispatchAction({
        type: 'DECLARE_ATTACK',
        playerId: active,
        attackerCardId: attacker2.instanceId,
        targetType: 'PLAYER',
      }).success
    ).toBe(true);
    if (state.timingWindow && state.timingWindow.priorityPlayerId !== active) {
      engine.dispatchAction({ type: 'PASS_ACTION_TIMING', playerId: state.timingWindow.priorityPlayerId });
    }
    const wataRes = engine.dispatchAction({
      type: 'USE_INSTANT',
      playerId: active,
      cardInstanceId: wataHand.instanceId,
    });
    expect(wataRes.success).toBe(true);
    expect(engine.fieldMgr.isSlotRole(active, wataHand.instanceId)).toBe(true);
  });

  it('10.2.1.b 带条件/代价的【充能自】：BP04-020/021 仅伤害充能生效；BP03-023 攻击充能付 3 费从处理区无视费用上限升变出场并获【速攻】 (Q&A·6)', () => {
    const e2 = createEngine(
      expandDeck('ST01', ['BP03-023', 'BP03-027', 'ST01-001']),
      expandDeck('ST02', ['BP04-020', 'BP04-020', 'BP04-021'])
    );
    const s2 = e2.getState();
    const act = s2.activePlayerId;
    const op = s2.nonActivePlayerId;

    // 1. BP03-023 里·超刻：我方费用区仅 4 费 (< 9)，场上有费用 < 9 的 BP03-027 《里·超刻》
    const leeSmall = placeRole(e2, act, 'BP03-027', 0, { isReady: true });
    fillCostZone(e2, act, 4); // 只有 4 费，远远小于 BP03-023 正常的费用上限 9
    const bp03023 = findCard(e2, act, 'BP03-023');
    e2.zoneMgr.moveCardToTopOfDeck(bp03023.instanceId);
    putNonOrbOnDeckTop(e2, op);

    // 攻击玩家，攻击充能翻出 BP03-023
    expect(
      e2.dispatchAction({
        type: 'DECLARE_ATTACK',
        playerId: act,
        attackerCardId: leeSmall.instanceId,
        targetType: 'PLAYER',
      }).success
    ).toBe(true);
    passInstantWindows(e2);
    expect(s2.currentPendingChoice?.effectType).toBe('BP03_023_CHARGE_ASCEND');

    const pickRes = e2.dispatchAction({
      type: 'SELECT_CHOICE_OPTION',
      playerId: act,
      pendingChoiceId: s2.currentPendingChoice!.id,
      selectedIds: ['opt_yes'],
    });
    expect(pickRes.success).toBe(true);
    expect(s2.cards[bp03023.instanceId]!.zone).toBe('BATTLEFIELD');
    expect(s2.cards[bp03023.instanceId]!.underneathCardIds).toContain(leeSmall.instanceId);
    expect(s2.cards[bp03023.instanceId]!.effectiveKeywords).toContain('速攻');

    // 2. 对方 BP04-020 (伤害充能给场上《薇拉·灼惘》PP+2000) & BP04-021 (伤害充能且明费全火抽 1)
    const oppVeras = Object.values(s2.cards).filter(
      (c) => c.controllerPlayerId === op && c.cardNumber === 'BP04-020'
    );
    const oppVeraField = oppVeras[0]!;
    const oppVeraDeck = oppVeras[1]!;
    e2.zoneMgr.moveCard(oppVeraField.instanceId, 'HAND', { isFaceUp: true });
    e2.fieldMgr.playRoleCard(op, oppVeraField.instanceId, 0);

    const oppBp021 = findCard(e2, op, 'BP04-021');
    for (const c of e2.zoneMgr.getCardsInZone(op, 'COST')) {
      e2.zoneMgr.moveCard(c.instanceId, 'GRAVEYARD', { isFaceUp: true });
    }
    const basePP = e2.fieldMgr.calculateRoleEffectivePP(oppVeraField.instanceId);

    // ATTACK 充能时 BP04-020 / BP04-021 均不触发
    expect(e2.effectEngine.handleChargeAutoEffect(op, oppVeraDeck.instanceId, db.getCard('BP04-020')!, 'ATTACK')).toBe(false);
    expect(e2.effectEngine.handleChargeAutoEffect(op, oppBp021.instanceId, db.getCard('BP04-021')!, 'ATTACK')).toBe(false);

    // DAMAGE 充能翻出 BP04-021 且明费全火 → 抽 1 张牌 (先置于牌库顶再统计基准手牌数)
    e2.zoneMgr.moveCardToTopOfDeck(oppBp021.instanceId);
    const oppHandBefore = e2.zoneMgr.getCardsInZone(op, 'HAND').length;
    e2.zoneMgr.applyDamageToPlayer(op, 1);
    expect(e2.zoneMgr.getCardsInZone(op, 'HAND').length).toBe(oppHandBefore + 1);

    // DAMAGE 充能翻出 BP04-020 → 弹出选择我方《薇拉·灼惘》PP+2000
    e2.zoneMgr.moveCardToTopOfDeck(oppVeraDeck.instanceId);
    e2.zoneMgr.revealTopForCharge(op, 'DAMAGE');
    expect(s2.currentPendingChoice?.effectType).toBe('SELECT_ROLE_FOR_CHARGE_BUFF');
    expect(
      e2.dispatchAction({
        type: 'SELECT_CHOICE_OPTION',
        playerId: op,
        pendingChoiceId: s2.currentPendingChoice!.id,
        selectedIds: [oppVeraField.instanceId],
      }).success
    ).toBe(true);
    expect(e2.fieldMgr.calculateRoleEffectivePP(oppVeraField.instanceId)).toBe(basePP + 2000);
  });
});

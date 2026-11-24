import { describe, it, expect } from 'vitest';
import { CardType } from '@zhanshuang/shared';
import {
  GameEngine,
  MemoryCardDatabase,
  OFFICIAL_CARDS_DATA,
  addCardModifier,
  sanitizeGameStateForPlayer,
} from '../src/index.js';
import { OFFICIAL_STARTER_DECKS } from '@zhanshuang/game-rules';
import { endTurn, fillCostZone, passInstantWindows } from './helpers.js';

const db = new MemoryCardDatabase(OFFICIAL_CARDS_DATA);

function expandDeck(code: 'ST01' | 'ST02' | 'ST03', extras: string[] = []): string[] {
  const deckDef = OFFICIAL_STARTER_DECKS.find((d) => d.name.includes(`(${code})`))!;
  const cards: string[] = [];
  for (const item of deckDef.cards) {
    for (let i = 0; i < item.count; i++) cards.push(item.cardNumber);
  }
  // 用额外卡牌替换末尾等量卡牌以保持 50 张
  for (let i = 0; i < extras.length && i < cards.length; i++) {
    cards[cards.length - 1 - i] = extras[i]!;
  }
  return cards;
}

function createEngine(p1Deck: string[], p2Deck: string[], seed = 20260723): GameEngine {
  const engine = new GameEngine(
    'repl-prohib-test',
    { playerId: 'p1', deckCardNumbers: p1Deck },
    { playerId: 'p2', deckCardNumbers: p2Deck },
    seed,
    db,
    { skipMulligan: true }
  );
  const state = engine.getState();
  const active = state.activePlayerId;
  const hand = engine.zoneMgr.getCardsInZone(active, 'HAND');
  engine.dispatchAction({
    type: 'CHARGE_COST_FROM_HAND',
    playerId: active,
    cardInstanceId: hand[0]?.instanceId,
  });
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
    .find((c) => !db.getCard(c.cardNumber)?.signalOrb);
  if (nonOrb) engine.zoneMgr.moveCardToTopOfDeck(nonOrb.instanceId);
}

describe('8.2.1.c / 8.10 置换效果统一拦截引擎', () => {
  it('Q&A·2 (BP01-017/BP02-013 / 8.10.1.a)：战斗破坏被置换防止时，角色留在战场、不发射 CARD_DESTROYED 且不触发【贯通】', () => {
    const engine = createEngine(expandDeck('ST01'), expandDeck('ST02'));
    const state = engine.getState();
    const active = state.activePlayerId;
    const opp = state.nonActivePlayerId;

    // 攻击方放高 PP 角色并赋予【贯通】，防守方放横置低 PP 角色
    const attacker = placeRole(engine, active, 'ST01-001', 0, { isReady: true });
    addCardModifier(state, attacker, { keywords: ['贯通'], untilTurn: state.turnNumber, source: 'TEST' });
    const defender = placeRole(engine, opp, 'ST02-005', 0, { isReady: false });

    // 给防守方角色添加一次性战斗破坏防止置换
    engine.replacementEngine.addActiveReplacement({
      eventType: 'DESTROY_ROLE',
      controllerPlayerId: opp,
      targetCardInstanceId: defender.instanceId,
      destroyReason: 'BATTLE',
      action: { kind: 'PREVENT' },
      once: true,
      untilTurn: state.turnNumber,
      source: 'BP01-017',
    });

    putNonOrbOnDeckTop(engine, active);
    const erosionBefore = state.players[opp]!.erosionCount;

    const res = engine.dispatchAction({
      type: 'DECLARE_ATTACK',
      playerId: active,
      attackerCardId: attacker.instanceId,
      targetType: 'CHARACTER',
      targetCardId: defender.instanceId,
    });
    expect(res.success).toBe(true);
    passInstantWindows(engine);

    // 8.10.1.a 破坏被防止：角色留在战场，不发 CARD_DESTROYED，不触发贯通伤害，且一次性置换已消耗
    expect(state.cards[defender.instanceId]!.zone).toBe('BATTLEFIELD');
    expect(res.events.some((e) => e.type === 'CARD_DESTROYED')).toBe(false);
    expect(state.players[opp]!.erosionCount).toBe(erosionBefore);
    expect(state.activeReplacements).toBeUndefined();
  });

  it('8.10.1.a & 8.6.4：效果破坏被置换防止时，DSL DESTROY_ROLES 视为未破坏且不发射 CARD_DESTROYED', () => {
    const engine = createEngine(expandDeck('ST03'), expandDeck('ST01'));
    const state = engine.getState();
    const active = state.activePlayerId;
    const opp = state.nonActivePlayerId;

    // 防守方放 1 张费用 <= 4 的角色，加上效果破坏防止置换
    const target = placeRole(engine, opp, 'ST01-006', 0);
    engine.replacementEngine.addActiveReplacement({
      eventType: 'DESTROY_ROLE',
      controllerPlayerId: opp,
      targetCardInstanceId: target.instanceId,
      destroyReason: 'EFFECT',
      action: { kind: 'PREVENT' },
      once: true,
      untilTurn: state.turnNumber,
      source: 'TEST_SHIELD',
    });

    // ST03-010 (战术牌：破坏对方战场 1 张费用 4 及以下的角色)
    fillCostZone(engine, active, 10);
    const tactic = findCard(engine, active, 'ST03-010');
    engine.zoneMgr.moveCard(tactic.instanceId, 'HAND', { isFaceUp: true });
    // ST03-010 可能需要场上条件或直接可选对方 4 费以下角色
    placeRole(engine, active, 'ST03-004', 0);

    const playRes = engine.dispatchAction({
      type: 'PLAY_CARD',
      playerId: active,
      cardInstanceId: tactic.instanceId,
    });
    expect(playRes.success).toBe(true);

    if (state.currentPendingChoice) {
      const choiceRes = engine.dispatchAction({
        type: 'SELECT_CHOICE_OPTION',
        playerId: active,
        choiceId: state.currentPendingChoice.id,
        selectedOptionIds: [target.instanceId],
      });
      expect(choiceRes.success).toBe(true);
      expect(choiceRes.events.some((e) => e.type === 'CARD_DESTROYED')).toBe(false);
    }
    expect(state.cards[target.instanceId]!.zone).toBe('BATTLEFIELD');
  });

  it('3.6.4 / Q&A·5 (BP01-037)：DECK→PROCESSING 置换到费用区(横置)；费用区已满 10 张时自动改放墓地', () => {
    const engine = createEngine(expandDeck('ST01', ['BP01-037']), expandDeck('ST02'));
    const state = engine.getState();
    const active = state.activePlayerId;

    const card = findCard(engine, active, 'BP01-037');
    engine.zoneMgr.moveCardToTopOfDeck(card.instanceId);

    // 情况 1：费用区未满 → 改放费用区正面横置，且不滞留处理区
    engine.replacementEngine.addActiveReplacement({
      eventType: 'MOVE_CARD',
      controllerPlayerId: active,
      targetCardInstanceId: card.instanceId,
      fromZone: 'DECK',
      toZone: 'PROCESSING',
      action: { kind: 'REDIRECT_ZONE', zone: 'COST', isFaceUp: true, isReady: false },
      once: true,
      untilTurn: state.turnNumber,
      source: 'BP01-037',
    });

    engine.zoneMgr.revealTopForCharge(active, 'ATTACK');
    expect(state.cards[card.instanceId]!.zone).toBe('COST');
    expect(state.cards[card.instanceId]!.isFaceUp).toBe(true);
    expect(state.cards[card.instanceId]!.isReady).toBe(false);

    // 情况 2：费用区已满 10 张 → 3.6.4 / Q&A·5 自动改放墓地正面
    engine.zoneMgr.moveCard(card.instanceId, 'HAND', { isFaceUp: true });
    fillCostZone(engine, active, 10);
    engine.zoneMgr.moveCardToTopOfDeck(card.instanceId);
    expect(engine.zoneMgr.getCardsInZone(active, 'COST').length).toBe(10);
    engine.replacementEngine.addActiveReplacement({
      eventType: 'MOVE_CARD',
      controllerPlayerId: active,
      targetCardInstanceId: card.instanceId,
      fromZone: 'DECK',
      toZone: 'PROCESSING',
      action: { kind: 'REDIRECT_ZONE', zone: 'COST', isFaceUp: true, isReady: false },
      once: true,
      untilTurn: state.turnNumber,
      source: 'BP01-037',
    });

    engine.zoneMgr.revealTopForCharge(active, 'ATTACK');
    expect(state.cards[card.instanceId]!.zone).toBe('GRAVEYARD');
    expect(state.cards[card.instanceId]!.isFaceUp).toBe(true);
    expect(engine.zoneMgr.getCardsInZone(active, 'COST').length).toBe(10);
  });

  it('Q&A·9 (BP04-065 莱特宁)：装备给《比安卡·真理》离场时，先送宿主再强制置换莱特宁到信号球区最下方；装备给其他角色则正常送墓', () => {
    const engine = createEngine(
      expandDeck('ST01', ['BP04-061', 'BP04-065', 'BP04-065']),
      expandDeck('ST02')
    );
    const state = engine.getState();
    const active = state.activePlayerId;

    // 先在信号球区放一张已有信号球
    const existingOrb = findCard(engine, active, 'ST01-012');
    engine.zoneMgr.moveCard(existingOrb.instanceId, 'SIGNAL_ORB', { isFaceUp: true });

    // 将 BP04-065 装备给《比安卡·真理》(BP04-061)
    const bianca = placeRole(engine, active, 'BP04-061', 0);
    const allLightnings = Object.values(state.cards).filter(
      (c) => c.controllerPlayerId === active && c.cardNumber === 'BP04-065'
    );
    const lightning1 = allLightnings[0]!;
    const lightning2 = allLightnings[1]!;

    expect(engine.fieldMgr.equipToRole(active, lightning1.instanceId, bianca.instanceId)).toBe(true);

    const startIdx = engine.events.length;
    engine.zoneMgr.moveCard(bianca.instanceId, 'GRAVEYARD', { isFaceUp: true });
    const movedEvents = engine.events.slice(startIdx).filter((e) => e.type === 'CARD_MOVED');

    // Q&A·9 顺序固定：先放《比安卡·真理》，再放莱特宁到信号球区最下方 (index 0)
    expect(movedEvents[0]).toMatchObject({ cardInstanceId: bianca.instanceId, toZone: 'GRAVEYARD' });
    expect(movedEvents[1]).toMatchObject({ cardInstanceId: lightning1.instanceId, toZone: 'SIGNAL_ORB' });

    const orbZone = engine.zoneMgr.getCardsInZone(active, 'SIGNAL_ORB');
    expect(orbZone[0]!.instanceId).toBe(lightning1.instanceId);
    expect(orbZone[1]!.instanceId).toBe(existingOrb.instanceId);

    // 装备给非《比安卡·真理》的角色 (如 ST01-005 露西亚) 时，离场后正常送墓
    const otherRole = placeRole(engine, active, 'ST01-005', 1);
    expect(engine.fieldMgr.equipToRole(active, lightning2.instanceId, otherRole.instanceId)).toBe(true);
    engine.zoneMgr.moveCard(otherRole.instanceId, 'GRAVEYARD', { isFaceUp: true });
    expect(state.cards[lightning2.instanceId]!.zone).toBe('GRAVEYARD');
  });

  it('8.10.2.c 循环置换防护：两条互指的置换规则对同一事件各自最多适用一次，绝不陷入死循环', () => {
    const engine = createEngine(expandDeck('ST01'), expandDeck('ST02'));
    const state = engine.getState();
    const active = state.activePlayerId;

    const card = findCard(engine, active, 'ST01-005');
    engine.zoneMgr.moveCard(card.instanceId, 'PROCESSING', { isFaceUp: true });

    engine.replacementEngine.registerRule({
      id: 'test:gy-to-hand',
      eventTypes: ['MOVE_CARD'],
      apply: (ev) =>
        ev.type === 'MOVE_CARD' && ev.cardInstanceId === card.instanceId && ev.toZone === 'GRAVEYARD'
          ? { kind: 'REDIRECT_ZONE', zone: 'HAND', isFaceUp: true }
          : undefined,
    });
    engine.replacementEngine.registerRule({
      id: 'test:hand-to-gy',
      eventTypes: ['MOVE_CARD'],
      apply: (ev) =>
        ev.type === 'MOVE_CARD' && ev.cardInstanceId === card.instanceId && ev.toZone === 'HAND'
          ? { kind: 'REDIRECT_ZONE', zone: 'GRAVEYARD', isFaceUp: true }
          : undefined,
    });

    // PROCESSING → GRAVEYARD -(rule1)-> HAND -(rule2)-> GRAVEYARD (rule1 已适用过不再触发) → 稳定结束于 GRAVEYARD
    engine.zoneMgr.moveCard(card.instanceId, 'GRAVEYARD', { isFaceUp: true });
    expect(state.cards[card.instanceId]!.zone).toBe('GRAVEYARD');
  });

  it('快照恢复、期限清理与 1.2.4.a 弃权不可置换', () => {
    const engine = createEngine(expandDeck('ST01'), expandDeck('ST02'));
    const state = engine.getState();
    const active = state.activePlayerId;
    const opp = state.nonActivePlayerId;

    // 注册 1 条持续至本回合末的伤害置换 (减免全部伤害)
    engine.replacementEngine.addActiveReplacement({
      eventType: 'DEAL_DAMAGE',
      controllerPlayerId: opp,
      action: { kind: 'PREVENT' },
      untilTurn: state.turnNumber,
      source: 'TEST_NO_DMG',
    });

    // 经 toSnapshot / fromSnapshot 恢复后置换依然有效
    const restored = GameEngine.fromSnapshot(engine.toSnapshot(), db);
    const erosionBefore = restored.getState().players[opp]!.erosionCount;
    restored.zoneMgr.applyDamageToPlayer(opp, 2);
    expect(restored.getState().players[opp]!.erosionCount).toBe(erosionBefore);

    // 结束回合后 6.5.1.d 清理到期置换，之后伤害正常生效
    endTurn(restored);
    expect(restored.getState().activeReplacements).toBeUndefined();
    restored.zoneMgr.applyDamageToPlayer(opp, 1);
    expect(restored.getState().players[opp]!.erosionCount).toBe(erosionBefore + 1);

    // 1.2.4.a 弃权永远不可被置换，立即结束对局
    const surr = restored.dispatchAction({ type: 'SURRENDER', playerId: active });
    expect(surr.success).toBe(true);
    expect(restored.getState().status).toBe('FINISHED');
    expect(restored.getState().winnerId).toBe(opp);
  });
});

describe('1.3.3 禁止效果与 10.15 冰冻状态', () => {
  it('CANNOT_ATTACK：BP01-049 帕瓦固有不能攻击，失去能力 (8.3.4) 后解锁；临时禁止攻击同样拦截并在回合末解除', () => {
    const engine = createEngine(expandDeck('ST01', ['BP01-049', 'BP01-049']), expandDeck('ST02'));
    const state = engine.getState();
    const active = state.activePlayerId;

    const pawas = Object.values(state.cards).filter(
      (c) => c.controllerPlayerId === active && c.cardNumber === 'BP01-049'
    );
    const pawa = pawas[0]!;
    const fireCost = pawas[1]!;
    engine.zoneMgr.moveCard(pawa.instanceId, 'HAND', { isFaceUp: true });
    engine.zoneMgr.moveCard(fireCost.instanceId, 'COST', { isFaceUp: true, isReady: true });
    fillCostZone(engine, active, 6);
    expect(
      engine.dispatchAction({
        type: 'PLAY_CARD',
        playerId: active,
        cardInstanceId: pawa.instanceId,
        targetSlotIndex: 0,
      }).success
    ).toBe(true);
    state.cards[pawa.instanceId]!.turnEnteredZone = 0;

    // 固有禁止攻击已同步到 effectiveProhibitions，且宣告攻击被拒绝
    expect(state.cards[pawa.instanceId]!.effectiveProhibitions).toContain('CANNOT_ATTACK');
    const r1 = engine.dispatchAction({
      type: 'DECLARE_ATTACK',
      playerId: active,
      attackerCardId: pawa.instanceId,
      targetType: 'PLAYER',
    });
    expect(r1.success).toBe(false);

    // 8.3.4 失去能力后解除自身固有「不能攻击」
    addCardModifier(state, state.cards[pawa.instanceId]!, {
      loseAbilities: true,
      untilTurn: state.turnNumber,
      source: 'TEST',
    });
    putNonOrbOnDeckTop(engine, active);
    const r2 = engine.dispatchAction({
      type: 'DECLARE_ATTACK',
      playerId: active,
      attackerCardId: pawa.instanceId,
      targetType: 'PLAYER',
    });
    expect(r2.success).toBe(true);
    passInstantWindows(engine);

    // 效果赋予的临时 CANNOT_ATTACK 禁止普通角色攻击
    const normalRole = placeRole(engine, active, 'ST01-005', 1, { isReady: true });
    addCardModifier(state, normalRole, {
      prohibitions: ['CANNOT_ATTACK'],
      untilTurn: state.turnNumber,
      source: 'BP01-073',
    });
    const r3 = engine.dispatchAction({
      type: 'DECLARE_ATTACK',
      playerId: active,
      attackerCardId: normalRole.instanceId,
      targetType: 'PLAYER',
    });
    expect(r3.success).toBe(false);
  });

  it('CANNOT_BLOCK：禁止阻挡的角色无法宣告阻挡，且当防守方唯一竖直角色不能阻挡时自动跳过阻挡步骤', () => {
    const engine = createEngine(expandDeck('ST01'), expandDeck('ST02'));
    const state = engine.getState();
    const active = state.activePlayerId;
    const opp = state.nonActivePlayerId;

    const attacker1 = placeRole(engine, active, 'ST01-005', 0, { isReady: true });
    const blockerBlocked = placeRole(engine, opp, 'ST02-005', 0, { isReady: true });
    const blockerAllowed = placeRole(engine, opp, 'ST02-001', 1, { isReady: true });

    addCardModifier(state, blockerBlocked, {
      prohibitions: ['CANNOT_BLOCK'],
      untilTurn: state.turnNumber,
      source: 'BP01-025',
    });

    putNonOrbOnDeckTop(engine, active);
    expect(
      engine.dispatchAction({
        type: 'DECLARE_ATTACK',
        playerId: active,
        attackerCardId: attacker1.instanceId,
        targetType: 'PLAYER',
      }).success
    ).toBe(true);
    passInstantWindows(engine);
    expect(state.currentCombat?.step).toBe('BLOCK');

    // 用被禁止阻挡的角色阻挡失败
    expect(
      engine.dispatchAction({
        type: 'DECLARE_BLOCK',
        playerId: opp,
        blockerCardId: blockerBlocked.instanceId,
      }).success
    ).toBe(false);

    // 用允许阻挡的角色完成阻挡 (同时消耗 blockerAllowed 使其横置)
    expect(
      engine.dispatchAction({
        type: 'DECLARE_BLOCK',
        playerId: opp,
        blockerCardId: blockerAllowed.instanceId,
      }).success
    ).toBe(true);

    // 第二次攻击时，防守方唯一竖直角色已被禁止阻挡 → 自由时点结束后直接跳过 BLOCK 步骤完成攻击
    const attacker2 = placeRole(engine, active, 'ST01-006', 1, { isReady: true });
    putNonOrbOnDeckTop(engine, active);
    expect(
      engine.dispatchAction({
        type: 'DECLARE_ATTACK',
        playerId: active,
        attackerCardId: attacker2.instanceId,
        targetType: 'PLAYER',
      }).success
    ).toBe(true);
    passInstantWindows(engine);
    expect(state.currentCombat).toBeUndefined();
  });

  it('Q&A·7 (PR-034) CANNOT_DEAL_DAMAGE / combat.cannotDealDamage：不仅阻止直接伤害，亦阻止【贯通】伤害', () => {
    const engine = createEngine(expandDeck('ST01'), expandDeck('ST02'));
    const state = engine.getState();
    const active = state.activePlayerId;
    const opp = state.nonActivePlayerId;

    // 1. 直接攻击玩家：带 CANNOT_DEAL_DAMAGE 时伤害为 0
    const attacker1 = placeRole(engine, active, 'ST01-001', 0, { isReady: true });
    addCardModifier(state, attacker1, {
      prohibitions: ['CANNOT_DEAL_DAMAGE'],
      untilTurn: state.turnNumber,
      source: 'BP01-027',
    });
    putNonOrbOnDeckTop(engine, active);
    const erosion0 = state.players[opp]!.erosionCount;
    expect(
      engine.dispatchAction({
        type: 'DECLARE_ATTACK',
        playerId: active,
        attackerCardId: attacker1.instanceId,
        targetType: 'PLAYER',
      }).success
    ).toBe(true);
    passInstantWindows(engine);
    expect(state.players[opp]!.erosionCount).toBe(erosion0);

    // 2. 战斗破坏对方角色 + 【贯通】：带 CANNOT_DEAL_DAMAGE 时角色照常被破坏，但【贯通】伤害为 0 (Q&A·7)
    const attacker2 = placeRole(engine, active, 'ST01-002', 1, { isReady: true });
    addCardModifier(state, attacker2, {
      keywords: ['贯通'],
      prohibitions: ['CANNOT_DEAL_DAMAGE'],
      untilTurn: state.turnNumber,
      source: 'PR-034',
    });
    const defender = placeRole(engine, opp, 'ST02-005', 0, { isReady: false });
    putNonOrbOnDeckTop(engine, active);
    expect(
      engine.dispatchAction({
        type: 'DECLARE_ATTACK',
        playerId: active,
        attackerCardId: attacker2.instanceId,
        targetType: 'CHARACTER',
        targetCardId: defender.instanceId,
      }).success
    ).toBe(true);
    passInstantWindows(engine);
    expect(state.cards[defender.instanceId]!.zone).toBe('GRAVEYARD');
    expect(state.players[opp]!.erosionCount).toBe(erosion0);
  });

  it('Q&A·4 (BP02-058) CANNOT_GAIN_ABILITIES：阻止后赋予的关键字与回合结束送墓时限触发', () => {
    const engine = createEngine(expandDeck('ST01'), expandDeck('ST02'));
    const state = engine.getState();
    const active = state.activePlayerId;

    const role = placeRole(engine, active, 'ST01-005', 0);

    // 先赋予回合结束送墓的时限触发 (模拟 ST02-011)
    engine.triggerMgr.registerDelayedTrigger({
      eventType: 'END_PHASE_TRIGGERS',
      triggerTurn: state.turnNumber,
      sourceCardInstanceId: role.instanceId,
      sourceCardNumber: role.cardNumber,
      controllerPlayerId: active,
      abilityId: 'DELAYED_END_OF_TURN_TO_GRAVEYARD',
      label: '【测试】该回合结束时放置到墓地',
      once: true,
    });

    // 再施加 BP02-058 效果：失去能力 + 不能获得新能力
    addCardModifier(state, role, {
      loseAbilities: true,
      prohibitions: ['CANNOT_GAIN_ABILITIES'],
      untilTurn: state.turnNumber,
      source: 'BP02-058',
    });
    // 其后尝试赋予【速攻】应被拦截
    addCardModifier(state, role, {
      keywords: ['速攻'],
      untilTurn: state.turnNumber,
      source: 'TEST_BUFF',
    });

    expect(engine.continuousEffects.hasKeyword(role.instanceId, '速攻')).toBe(false);

    // 结束回合：6.5.1.b 结算时角色仍处于失去能力/不能获得新能力状态，不送墓 (Q&A·4)
    endTurn(engine);
    expect(state.cards[role.instanceId]!.zone).toBe('BATTLEFIELD');
  });

  it('Q&A·9 (BP04-016 薇拉·灼惘) CANNOT_MODIFY_PP_BY_OPPONENT：对方回合挡住对方 PP 增减，但挡不住「PP变为70」(setPP) 与己方增益', () => {
    const engine = createEngine(expandDeck('ST01'), expandDeck('ST02', ['BP04-016']));
    const state = engine.getState();
    const active = state.activePlayerId;
    const opp = state.nonActivePlayerId;

    // 对手场上的 BP04-016 (基础 PP 5000)，当前为 active 回合 (对 opp 而言是对方回合)
    const vera = placeRole(engine, opp, 'BP04-016', 0);
    expect(engine.continuousEffects.hasProhibition(vera.instanceId, 'CANNOT_MODIFY_PP_BY_OPPONENT')).toBe(true);

    // 1. 对方 (active) 施加 PP-4000 → 被拦截，仍为 5000
    addCardModifier(state, vera, {
      pp: -4000,
      untilTurn: state.turnNumber,
      source: 'OPP_DEBUFF',
      appliedByPlayerId: active,
    });
    expect(engine.fieldMgr.calculateRoleEffectivePP(vera.instanceId)).toBe(5000);

    // 2. 己方 (opp) 施加 PP+1000 → 正常生效，变为 6000
    addCardModifier(state, vera, {
      pp: 1000,
      untilTurn: state.turnNumber,
      source: 'SELF_BUFF',
      appliedByPlayerId: opp,
    });
    expect(engine.fieldMgr.calculateRoleEffectivePP(vera.instanceId)).toBe(6000);

    // 3. 对方 (active) 施加「PP 变为 70」(setPP: 70，如 BP03-012) → 不属于增减，正常生效 (Q&A·9)
    addCardModifier(state, vera, {
      setPP: 70,
      untilTurn: state.turnNumber,
      source: 'BP03-012',
      appliedByPlayerId: active,
    });
    expect(engine.fieldMgr.calculateRoleEffectivePP(vera.instanceId)).toBe(70);

    // 4. 切到 opp 自己的回合：不再处于对方回合，禁止标志消失
    endTurn(engine);
    expect(engine.continuousEffects.hasProhibition(vera.instanceId, 'CANNOT_MODIFY_PP_BY_OPPONENT')).toBe(false);
  });

  it('CANNOT_DISCARD_HIDDEN_COST_AT_END (BP03-079)：本回合结束时受保护的暗费留在费用区，下回合结束时恢复正常送墓', () => {
    const engine = createEngine(expandDeck('ST01'), expandDeck('ST02'));
    const state = engine.getState();
    const active = state.activePlayerId;

    // 放 2 张暗费到 active 费用区，保护其中第 1 张
    const deck = engine.zoneMgr.getCardsInZone(active, 'DECK');
    const protectedDark = deck[0]!;
    const normalDark = deck[1]!;
    engine.zoneMgr.moveCard(protectedDark.instanceId, 'COST', { isFaceUp: false, isReady: true });
    engine.zoneMgr.moveCard(normalDark.instanceId, 'COST', { isFaceUp: false, isReady: true });

    addCardModifier(state, protectedDark, {
      prohibitions: ['CANNOT_DISCARD_HIDDEN_COST_AT_END'],
      untilTurn: state.turnNumber,
      source: 'BP03-079',
    });

    // 结束 active 的回合：normalDark 送墓，protectedDark 留在费用区 (且保护 modifier 已到期清除)
    endTurn(engine);
    expect(state.cards[normalDark.instanceId]!.zone).toBe('GRAVEYARD');
    expect(state.cards[protectedDark.instanceId]!.zone).toBe('COST');
    expect(state.cards[protectedDark.instanceId]!.modifiers).toBeUndefined();

    // 经过对手回合回到 active 下一个回合再结束：protectedDark 正常送墓
    endTurn(engine);
    endTurn(engine);
    expect(state.cards[protectedDark.instanceId]!.zone).toBe('GRAVEYARD');
  });

  it('10.15 冰冻状态：横置冰冻角色在操控玩家下个竖直阶段不因规则竖直，竖直阶段结束时解除冰冻，再下回合正常竖直；离场时亦清除冰冻', () => {
    const engine = createEngine(expandDeck('ST01'), expandDeck('ST02'));
    const state = engine.getState();
    const active = state.activePlayerId;
    const opp = state.nonActivePlayerId;

    const oppRole1 = placeRole(engine, opp, 'ST02-001', 0, { isReady: false });
    const oppRole2 = placeRole(engine, opp, 'ST02-005', 1, { isReady: false });
    oppRole1.isFrozen = true;
    oppRole2.isFrozen = true;

    // oppRole2 离场时清除冰冻 (3.1.4)
    engine.zoneMgr.moveCard(oppRole2.instanceId, 'GRAVEYARD', { isFaceUp: true });
    expect(state.cards[oppRole2.instanceId]!.isFrozen).toBeUndefined();

    // 结束 active 回合 → 进入 opp 竖直阶段 → oppRole1 不竖直，但竖直阶段结束时解除冰冻 (10.15.3)
    endTurn(engine);
    expect(state.activePlayerId).toBe(opp);
    expect(state.cards[oppRole1.instanceId]!.isReady).toBe(false);
    expect(state.cards[oppRole1.instanceId]!.isFrozen).toBeUndefined();

    // 经过 opp 回合与 active 回合再次进入 opp 竖直阶段 → oppRole1 正常竖直
    endTurn(engine);
    endTurn(engine);
    expect(state.activePlayerId).toBe(opp);
    expect(state.cards[oppRole1.instanceId]!.isReady).toBe(true);
  });

  it('CANNOT_ELIMINATE (BP02-066)：被禁止消除的信号球不可被规则三消，也不可作为能力消除代价', () => {
    const engine = createEngine(expandDeck('ST03'), expandDeck('ST01'));
    const state = engine.getState();
    const active = state.activePlayerId;

    // 放 3 张红球到信号球区，给中间 1 张挂 CANNOT_ELIMINATE
    const redOrbs = Object.values(state.cards)
      .filter((c) => c.controllerPlayerId === active && db.getCard(c.cardNumber)?.signalOrb === 'RED')
      .slice(0, 3);
    expect(redOrbs.length).toBe(3);
    for (const o of redOrbs) {
      engine.zoneMgr.moveCard(o.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    }
    addCardModifier(state, redOrbs[1]!, {
      prohibitions: ['CANNOT_ELIMINATE'],
      untilTurn: state.turnNumber + 1,
      source: 'BP02-066',
    });

    const elimRes = engine.dispatchAction({
      type: 'ELIMINATE_3_ORBS',
      playerId: active,
      orbCardInstanceIds: redOrbs.map((o) => o.instanceId),
    });
    expect(elimRes.success).toBe(false);
    expect(elimRes.error).toContain('不能被消除');
  });
});

describe('「视为」持续效果 (信号球颜色 / 等效数量 / 卡牌名称) 与背面信号球脱敏', () => {
  it('BP04-032 炽能球：场上无《渡边·尘铭》时不能消除；场上存在《渡边·尘铭》时视为【红色信号球】并可参与三消与红球能力代价', () => {
    const engine = createEngine(
      expandDeck('ST03', ['BP04-032', 'BP04-023']),
      expandDeck('ST01')
    );
    const state = engine.getState();
    const active = state.activePlayerId;

    const blazingOrb = findCard(engine, active, 'BP04-032');
    const redOrbs = Object.values(state.cards)
      .filter((c) => c.controllerPlayerId === active && db.getCard(c.cardNumber)?.signalOrb === 'RED')
      .slice(0, 2);

    engine.zoneMgr.moveCard(redOrbs[0]!.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    engine.zoneMgr.moveCard(blazingOrb.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    engine.zoneMgr.moveCard(redOrbs[1]!.instanceId, 'SIGNAL_ORB', { isFaceUp: true });

    // 场上无《渡边·尘铭》：炽能球不视为信号球，三消失败
    expect(engine.continuousEffects.getEffectiveOrbInfo(blazingOrb.instanceId).isOrb).toBe(false);
    expect(
      engine.dispatchAction({
        type: 'ELIMINATE_3_ORBS',
        playerId: active,
        orbCardInstanceIds: [redOrbs[0]!.instanceId, blazingOrb.instanceId, redOrbs[1]!.instanceId],
      }).success
    ).toBe(false);

    // 场上放置《渡边·尘铭》(BP04-023) → 炽能球变为视为【红色信号球】
    placeRole(engine, active, 'BP04-023', 0);
    const info = engine.continuousEffects.getEffectiveOrbInfo(blazingOrb.instanceId);
    expect(info.isOrb).toBe(true);
    expect(info.colors).toEqual(['RED']);

    // 现在可以与另外 2 张红球一起三消抽牌！
    const handBefore = engine.zoneMgr.getCardsInZone(active, 'HAND').length;
    const okRes = engine.dispatchAction({
      type: 'ELIMINATE_3_ORBS',
      playerId: active,
      orbCardInstanceIds: [redOrbs[0]!.instanceId, blazingOrb.instanceId, redOrbs[1]!.instanceId],
    });
    expect(okRes.success).toBe(true);
    expect(state.cards[blazingOrb.instanceId]!.zone).toBe('GRAVEYARD');
    expect(engine.zoneMgr.getCardsInZone(active, 'HAND').length).toBe(handBefore + 1);
  });

  it('Q&A·1 (BP01-037 万世铭) orbValue=3：单张视为 3 个信号球可独自完成三消，但不能拆作 2 球支付 2 球代价', () => {
    const engine = createEngine(expandDeck('ST01'), expandDeck('ST02'));
    const state = engine.getState();
    const active = state.activePlayerId;

    // 放 1 张蓝球并施加 orbValue: 3
    const blueOrb = Object.values(state.cards).find(
      (c) => c.controllerPlayerId === active && db.getCard(c.cardNumber)?.signalOrb === 'BLUE'
    )!;
    engine.zoneMgr.moveCard(blueOrb.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    addCardModifier(state, blueOrb, { orbValue: 3, untilTurn: state.turnNumber, source: 'BP01-037' });

    // 1. 不能用于需要「消除 2 张蓝色信号球」的 ST01-001 (露西亚·红莲【起】) —— Q&A·1 不可拆作 2 球！
    const st01001 = placeRole(engine, active, 'ST01-001', 0);
    const actRes = engine.dispatchAction({
      type: 'ACTIVATE_ABILITY',
      playerId: active,
      cardInstanceId: st01001.instanceId,
    });
    expect(actRes.success).toBe(false);

    // 2. 单张即可精确满足三消抽牌 (总等效值 = 3)
    const handBefore = engine.zoneMgr.getCardsInZone(active, 'HAND').length;
    const elimRes = engine.dispatchAction({
      type: 'ELIMINATE_3_ORBS',
      playerId: active,
      orbCardInstanceIds: [blueOrb.instanceId],
    });
    expect(elimRes.success).toBe(true);
    expect(state.cards[blueOrb.instanceId]!.zone).toBe('GRAVEYARD');
    expect(engine.zoneMgr.getCardsInZone(active, 'HAND').length).toBe(handBefore + 1);
  });

  it('多色「视为」(BP01-014/BP01-022)：红黄双色信号球可与黄球构成 2 同色组合，触发 2 同色能力代价', () => {
    const engine = createEngine(expandDeck('ST03'), expandDeck('ST01'));
    const state = engine.getState();
    const active = state.activePlayerId;

    fillCostZone(engine, active, 10);
    const redOrb = Object.values(state.cards).find(
      (c) => c.controllerPlayerId === active && db.getCard(c.cardNumber)?.signalOrb === 'RED'
    )!;
    const yellowOrb = Object.values(state.cards).find(
      (c) => c.controllerPlayerId === active && db.getCard(c.cardNumber)?.signalOrb === 'YELLOW'
    )!;
    engine.zoneMgr.moveCard(redOrb.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    engine.zoneMgr.moveCard(yellowOrb.instanceId, 'SIGNAL_ORB', { isFaceUp: true });

    // ST03-001 薇拉·绯耀：【出】消除 2 同色信号球 (可选)
    const st03001s = Object.values(state.cards).filter(
      (c) => c.controllerPlayerId === active && c.cardNumber === 'ST03-001'
    );
    const first = st03001s[0]!;
    const second = st03001s[1]!;

    // 1. 未施加视为黄球前，红+黄不能满足 2 同色，登场后不会弹出消球选择
    engine.zoneMgr.moveCard(first.instanceId, 'HAND', { isFaceUp: true });
    expect(
      engine.dispatchAction({
        type: 'PLAY_CARD',
        playerId: active,
        cardInstanceId: first.instanceId,
        targetSlotIndex: 0,
      }).success
    ).toBe(true);
    expect(state.currentPendingChoice).toBeUndefined();

    // 2. 给红球增加 treatedAsOrbColors: ['YELLOW'] → 变为红/黄双色，与黄球构成 2 同色！
    addCardModifier(state, redOrb, {
      treatedAsOrbColors: ['YELLOW'],
      untilTurn: state.turnNumber,
      source: 'BP01-014',
    });
    fillCostZone(engine, active, 10);
    engine.zoneMgr.moveCard(second.instanceId, 'HAND', { isFaceUp: true });
    expect(
      engine.dispatchAction({
        type: 'PLAY_CARD',
        playerId: active,
        cardInstanceId: second.instanceId,
        targetSlotIndex: 1,
      }).success
    ).toBe(true);
    expect(state.currentPendingChoice?.effectType).toBe('PRESET_ORB_COST');
  });

  it('Q&A·4/5 (BP02-040 含英·檀心)：全区域卡名视为《飞叶点翠》，但卡牌类型仍为角色牌', () => {
    const engine = createEngine(expandDeck('ST01', ['BP02-040']), expandDeck('ST02'));
    const state = engine.getState();
    const active = state.activePlayerId;

    const hanying = findCard(engine, active, 'BP02-040');
    expect(db.getCard(hanying.cardNumber)?.cardType).toBe(CardType.ROLE);

    for (const zone of ['HAND', 'GRAVEYARD', 'DECK', 'SIGNAL_ORB'] as const) {
      engine.zoneMgr.moveCard(hanying.instanceId, zone, { isFaceUp: zone !== 'DECK' });
      expect(engine.continuousEffects.hasCardName(hanying.instanceId, '含英·檀心')).toBe(true);
      expect(engine.continuousEffects.hasCardName(hanying.instanceId, '飞叶点翠')).toBe(true);
    }
    placeRole(engine, active, 'BP02-040', 0);
    expect(engine.continuousEffects.hasCardName(hanying.instanceId, '飞叶点翠')).toBe(true);
  });

  it('12.2 / Q&A·6：信号球区的背面卡牌对双方均脱敏为 HIDDEN_ORB 且不能被消除', () => {
    const engine = createEngine(expandDeck('ST01'), expandDeck('ST02'));
    const state = engine.getState();
    const active = state.activePlayerId;
    const opp = state.nonActivePlayerId;

    const redOrb = Object.values(state.cards).find(
      (c) => c.controllerPlayerId === active && db.getCard(c.cardNumber)?.signalOrb === 'RED'
    )!;
    engine.zoneMgr.moveCard(redOrb.instanceId, 'SIGNAL_ORB', { isFaceUp: false });

    expect(engine.continuousEffects.getEffectiveOrbInfo(redOrb.instanceId).isOrb).toBe(false);
    for (const viewer of [active, opp]) {
      const pub = sanitizeGameStateForPlayer(state, viewer);
      expect(pub.publicCards[redOrb.instanceId]).toBeUndefined();
      const hiddenOrbs = Object.values(pub.publicCards).filter(
        (c) => c.zone === 'SIGNAL_ORB' && !c.isFaceUp
      );
      expect(hiddenOrbs.length).toBeGreaterThanOrEqual(1);
      expect(hiddenOrbs.every((c) => c.cardNumber === 'HIDDEN_ORB' && c.instanceId.startsWith('hidden-orb:'))).toBe(
        true
      );
    }
  });
});

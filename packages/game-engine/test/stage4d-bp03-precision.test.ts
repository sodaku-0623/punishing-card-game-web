import { describe, it, expect, vi } from 'vitest';
import { CardType } from '@zhanshuang/shared';
import { OFFICIAL_STARTER_DECKS } from '@zhanshuang/game-rules';
import {
  GameEngine,
  MemoryCardDatabase,
  OFFICIAL_CARDS_DATA,
  addCardModifier,
  getAttachedEquipmentIds,
  sanitizeGameStateForPlayer,
} from '../src/index.js';
import { endTurn, fillCostZone, passInstantWindows, resolvePendingChoices } from './helpers.js';

const db = new MemoryCardDatabase(OFFICIAL_CARDS_DATA);
const coveredCardNumbers = new Set<string>();

/** 专用于填充六属性明费的垫底卡：物理 / 冰 / 雷 / 暗 / 火 / 空 */
const ATTR_PADS = ['ST01-006', 'ST04-006', 'BP01-019', 'ST02-005', 'BP01-048', 'BP02-008'] as const;
const KNOWN_ATTR_KEYS = new Set(['FIRE', 'ICE', 'LIGHTNING', 'DARK', 'PHYSICAL', 'VOID']);

function buildDeck(
  extras: string[],
  basePack: 'ST01' | 'ST02' | 'ST03' = 'ST01'
): string[] {
  const deckDef = OFFICIAL_STARTER_DECKS.find((d) => d.name.includes(`(${basePack})`))!;
  const pool: string[] = [];
  for (const item of deckDef.cards) {
    for (let i = 0; i < item.count; i++) pool.push(item.cardNumber);
  }
  return [...extras, ...ATTR_PADS, ...pool].slice(0, 50);
}

function createEngine(p1Deck: string[], p2Deck: string[], seed = 20261127): GameEngine {
  const engine = new GameEngine(
    `stage4d-${seed}`,
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

function findCards(engine: GameEngine, playerId: string, cardNumber: string) {
  return Object.values(engine.getState().cards)
    .filter((c) => c.controllerPlayerId === playerId && c.cardNumber === cardNumber)
    .sort((a, b) => a.instanceId.localeCompare(b.instanceId, undefined, { numeric: true }));
}

function findCard(
  engine: GameEngine,
  playerId: string,
  cardNumber: string,
  index = 0,
  excludeIds: Set<string> = new Set()
) {
  const matches = findCards(engine, playerId, cardNumber).filter((c) => !excludeIds.has(c.instanceId));
  const card = matches[index];
  if (!card) throw new Error(`未找到卡牌 ${playerId}/${cardNumber}[${index}]`);
  return card;
}

function cardState(engine: GameEngine, instanceId: string) {
  const card = engine.getState().cards[instanceId];
  if (!card) throw new Error(`未找到卡牌实例 ${instanceId}`);
  return card;
}

function placeRole(
  engine: GameEngine,
  playerId: string,
  cardNumber: string,
  slotIndex: number,
  options?: { isReady?: boolean; enteredEarlier?: boolean; instanceIndex?: number; excludeIds?: Set<string> }
) {
  const card = findCard(engine, playerId, cardNumber, options?.instanceIndex ?? 0, options?.excludeIds);
  engine.zoneMgr.moveCard(card.instanceId, 'HAND', { isFaceUp: true });
  const ok = engine.fieldMgr.playRoleCard(playerId, card.instanceId, slotIndex, { suppressEntryTrigger: true });
  expect(ok).toBe(true);
  if (options?.enteredEarlier !== false) card.turnEnteredZone = 0;
  if (options?.isReady !== undefined) card.isReady = options.isReady;
  coveredCardNumbers.add(cardNumber);
  return card;
}

function setupOpenCost(
  engine: GameEngine,
  playerId: string,
  requiredAttrsOrNumbers: readonly string[],
  totalCount: number,
  reserveIds: Set<string> = new Set()
): void {
  for (const c of engine.zoneMgr.getCardsInZone(playerId, 'COST')) {
    engine.zoneMgr.moveCardToBottomOfDeck(c.instanceId);
  }
  const usedIds = new Set<string>();
  const padSet = new Set<string>(ATTR_PADS);
  for (const req of requiredAttrsOrNumbers) {
    let picked: ReturnType<typeof findCards>[number] | undefined;
    if (KNOWN_ATTR_KEYS.has(req)) {
      const candidates = Object.values(engine.getState().cards)
        .filter(
          (c) =>
            c.controllerPlayerId === playerId &&
            c.zone !== 'COST' &&
            c.zone !== 'BATTLEFIELD' &&
            !reserveIds.has(c.instanceId) &&
            !usedIds.has(c.instanceId) &&
            db.getCard(c.cardNumber)?.attribute === req
        )
        .sort((a, b) => Number(padSet.has(b.cardNumber)) - Number(padSet.has(a.cardNumber)));
      picked = candidates[0];
    } else {
      picked = findCards(engine, playerId, req).find(
        (x) =>
          x.zone !== 'COST' &&
          x.zone !== 'BATTLEFIELD' &&
          !reserveIds.has(x.instanceId) &&
          !usedIds.has(x.instanceId)
      );
    }
    if (!picked) {
      throw new Error(`setupOpenCost 未找到满足条件 ${req} 的可用费用卡 (${playerId})`);
    }
    usedIds.add(picked.instanceId);
    engine.zoneMgr.moveCard(picked.instanceId, 'COST', { isFaceUp: true, isReady: true });
  }
  let costCount = engine.zoneMgr.getCardsInZone(playerId, 'COST').filter((c) => c.isFaceUp).length;
  for (const deckCard of engine.zoneMgr.getCardsInZone(playerId, 'DECK')) {
    if (costCount >= totalCount) break;
    if (reserveIds.has(deckCard.instanceId) || usedIds.has(deckCard.instanceId)) continue;
    engine.zoneMgr.moveCard(deckCard.instanceId, 'COST', { isFaceUp: true, isReady: true });
    costCount++;
  }
  if (costCount < totalCount) {
    fillCostZone(engine, playerId, totalCount);
  }
  engine.zoneMgr.syncCostStats(playerId);
}

function readyAllOpenCosts(engine: GameEngine, playerId: string): void {
  for (const c of engine.zoneMgr.getCardsInZone(playerId, 'COST')) {
    if (c.isFaceUp) c.isReady = true;
  }
  engine.zoneMgr.syncCostStats(playerId);
}

function putNonOrbOnTop(engine: GameEngine, playerId: string, count = 3): void {
  const nonOrbs = engine.zoneMgr.getCardsInZone(playerId, 'DECK').filter((c) => {
    if (c.cardNumber === 'BP03-065' || c.cardNumber === 'BP03-066') return false;
    const def = db.getCard(c.cardNumber);
    return (
      !def?.signalOrb &&
      !def?.rulesText.includes('【充能自】：') &&
      !def?.traits?.includes('万世铭')
    );
  });
  for (const c of nonOrbs.slice(0, count).reverse()) {
    engine.zoneMgr.moveCardToTopOfDeck(c.instanceId);
  }
}

function advanceTurnTo(engine: GameEngine, targetPlayerId: string): void {
  for (let i = 0; i < 12; i++) {
    resolvePendingChoices(engine);
    const st = engine.getState();
    if (st.status === 'FINISHED') return;
    if (st.activePlayerId === targetPlayerId && st.phase === 'MAIN_PHASE') return;
    if (st.phase === 'DRAW_CHARGE_PHASE') {
      engine.dispatchAction({ type: 'PASS_ACTION_TIMING', playerId: st.activePlayerId });
    } else if (st.phase === 'END_PHASE') {
      if (st.timingWindow) passInstantWindows(engine);
      resolvePendingChoices(engine);
      if (st.phase === 'END_PHASE' && !st.currentPendingChoice && !st.timingWindow) {
        engine.dispatchAction({ type: 'PASS_ACTION_TIMING', playerId: st.activePlayerId });
      }
    } else {
      endTurn(engine);
    }
  }
  expect(engine.getState().activePlayerId).toBe(targetPlayerId);
}

/**
 * 推进回合至目标玩家（保留其回合开始/竖直阶段待处理的触发弹窗，不自动吞掉）
 */
function advanceTurnToExpectingTriggers(engine: GameEngine, targetPlayerId: string): void {
  for (let i = 0; i < 12; i++) {
    const st = engine.getState();
    if (st.status === 'FINISHED') return;
    if (st.activePlayerId === targetPlayerId) {
      if (st.currentPendingChoice || st.phase === 'MAIN_PHASE') return;
      if (st.phase === 'DRAW_CHARGE_PHASE') {
        engine.dispatchAction({ type: 'PASS_ACTION_TIMING', playerId: targetPlayerId });
        continue;
      }
    }
    resolvePendingChoices(engine);
    const cur = engine.getState();
    if (cur.phase === 'DRAW_CHARGE_PHASE') {
      engine.dispatchAction({ type: 'PASS_ACTION_TIMING', playerId: cur.activePlayerId });
    } else if (cur.phase === 'END_PHASE') {
      if (cur.timingWindow) passInstantWindows(engine);
      resolvePendingChoices(engine);
      if (cur.phase === 'END_PHASE' && !cur.currentPendingChoice && !cur.timingWindow) {
        engine.dispatchAction({ type: 'PASS_ACTION_TIMING', playerId: cur.activePlayerId });
      }
    } else {
      endTurn(engine);
    }
  }
  expect(engine.getState().activePlayerId).toBe(targetPlayerId);
}

function ensureMainPhase(engine: GameEngine): void {
  const st = engine.getState();
  if (st.phase === 'DRAW_CHARGE_PHASE') {
    const res = engine.dispatchAction({ type: 'PASS_ACTION_TIMING', playerId: st.activePlayerId });
    expect(res.success, res.error).toBe(true);
  }
  expect(engine.getState().phase).toBe('MAIN_PHASE');
}

function passToCharge(engine: GameEngine, defenderId = 'p2'): void {
  passInstantWindows(engine);
  if (engine.getState().currentCombat?.step === 'BLOCK') {
    const res = engine.dispatchAction({ type: 'PASS_ACTION_TIMING', playerId: defenderId });
    expect(res.success, res.error).toBe(true);
  }
}

function mustPlay(
  engine: GameEngine,
  playerId: string,
  cardInstanceId: string,
  extra: Partial<Extract<Parameters<GameEngine['dispatchAction']>[0], { type: 'PLAY_CARD' }>> = {}
) {
  const card = cardState(engine, cardInstanceId);
  if (card.zone !== 'HAND' && card.zone !== 'GRAVEYARD') {
    engine.zoneMgr.moveCard(cardInstanceId, 'HAND', { isFaceUp: true });
  }
  const res = engine.dispatchAction({
    type: 'PLAY_CARD',
    playerId,
    cardInstanceId,
    ...extra,
  });
  expect(res.success, `打出 ${card.cardNumber} 失败: ${res.error}`).toBe(true);
  coveredCardNumbers.add(card.cardNumber);
  return res;
}

function mustActivate(
  engine: GameEngine,
  playerId: string,
  sourceCardId: string,
  abilityIndex = 0
) {
  const card = cardState(engine, sourceCardId);
  const res = engine.dispatchAction({
    type: 'ACTIVATE_ABILITY',
    playerId,
    sourceCardId,
    abilityIndex,
  });
  expect(res.success, `发动 ${card.cardNumber}#${abilityIndex} 失败: ${res.error}`).toBe(true);
  coveredCardNumbers.add(card.cardNumber);
  return res;
}

function mustPick(engine: GameEngine, selectedIds: string[], playerId?: string) {
  const ch = engine.getState().currentPendingChoice;
  expect(ch, '预期存在待处理决策').toBeDefined();
  const res = engine.dispatchAction({
    type: 'SELECT_CHOICE_OPTION',
    playerId: playerId ?? ch!.playerId,
    pendingChoiceId: ch!.id,
    selectedIds,
  });
  expect(res.success, `决策 ${ch?.effectType} 选择失败: ${res.error}`).toBe(true);
  return res;
}

function finishCombat(engine: GameEngine, defenderId = 'p2'): void {
  for (let guard = 0; guard < 30; guard++) {
    resolvePendingChoices(engine);
    const st = engine.getState();
    if (st.status === 'FINISHED') return;
    if (!st.currentCombat && st.phase === 'MAIN_PHASE') return;
    if (st.timingWindow) {
      passInstantWindows(engine);
      continue;
    }
    if (st.currentCombat?.step === 'BLOCK') {
      const res = engine.dispatchAction({ type: 'PASS_ACTION_TIMING', playerId: defenderId });
      expect(res.success, res.error).toBe(true);
      continue;
    }
    break;
  }
}

// ============================================================================
// 一、露西亚·誓焰 浮空体系 (BP03-001 ~ BP03-011 + BP03-003【冠军】)
// ============================================================================

describe('Stage 4D BP03 露西亚·誓焰 浮空体系精确覆盖', () => {
  it('P1-1 & BP03-001/005/006/007/008/009：誓焰浮空监听精准度、001 第2项组合炸怪与浮空升变正反、009 非浮空反例', () => {
    // 1. BP03-005 监听其他《露西亚·誓焰》从处理区回场、浮空升变触发，且已从处理区出场的 005 不被普通手牌出场误触发
    {
      const engine = createEngine(
        buildDeck(['BP03-005', 'BP03-005', 'BP03-006', 'BP03-006', 'BP03-001', 'BP03-081', 'BP03-082']),
        buildDeck([])
      );
      const l005a = findCard(engine, 'p1', 'BP03-005', 0);
      const l005b = findCard(engine, 'p1', 'BP03-005', 1);
      const l006a = findCard(engine, 'p1', 'BP03-006', 0);
      const l006b = findCard(engine, 'p1', 'BP03-006', 1);
      const l001 = findCard(engine, 'p1', 'BP03-001');
      const r1 = findCard(engine, 'p1', 'BP03-081');
      const r2 = findCard(engine, 'p1', 'BP03-082');
      const reserve = new Set([
        l005a.instanceId,
        l005b.instanceId,
        l006a.instanceId,
        l006b.instanceId,
        l001.instanceId,
        r1.instanceId,
        r2.instanceId,
      ]);
      setupOpenCost(engine, 'p1', ['FIRE'], 10, reserve);
      engine.zoneMgr.moveCard(r1.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
      engine.zoneMgr.moveCard(r2.instanceId, 'SIGNAL_ORB', { isFaceUp: true });

      // l005a 从手牌普通出场在 0 号位；先放 l006a 在 1 号位再将其浮空
      placeRole(engine, 'p1', 'BP03-006', 1);
      mustPlay(engine, 'p1', l005a.instanceId, { targetSlotIndex: 0 });
      expect(engine.getState().currentPendingChoice?.effectType).toBe('DSL_BP03-005_AIRBORNE');
      mustPick(engine, [l006a.instanceId]); // BP03-005 【出】将 l006a 浮空
      expect(cardState(engine, l006a.instanceId).zone).toBe('PROCESSING');
      expect(cardState(engine, l006a.instanceId).isAirborne).toBe(true);

      // 推进到我方下回合：l006a 从处理区回场，监听中的 l005a 必须触发！
      advanceTurnTo(engine, 'p2');
      advanceTurnToExpectingTriggers(engine, 'p1');
      // l006a【出】与 l005a【自】同时进栈 -> 选择触发顺序先结算 l005a
      if (engine.getState().currentPendingChoice?.effectType === 'CHOOSE_TRIGGER_ORDER') {
        const opt005 = engine.getState().currentPendingChoice!.options.find(
          (o) => (o.payload as { sourceCardInstanceId?: string } | undefined)?.sourceCardInstanceId === l005a.instanceId
        )!;
        mustPick(engine, [opt005.id]);
      }
      expect(engine.getState().currentPendingChoice?.effectType).toBe('DSL_BP03-005_ORB_COST');
      const orbOpt = engine.getState().currentPendingChoice!.options.find((o) => o.id !== 'skip')!;
      mustPick(engine, [orbOpt.id]);
      resolvePendingChoices(engine); // 处理 l006a 的【出】丢1手牌
      ensureMainPhase(engine);
      expect(engine.fieldMgr.calculateRoleEffectivePP(l005a.instanceId)).toBe(6000);
      expect(engine.fieldMgr.evaluateRoleStats(l005a.instanceId).keywords).toContain('速攻');

      // 分支 B：清理回场并准备浮空 l006a，让 BP03-001 浮空升变触发 l005a（已跨回合恢复【回合1】）
      advanceTurnTo(engine, 'p2');
      advanceTurnToExpectingTriggers(engine, 'p1');
      ensureMainPhase(engine);
      engine.fieldMgr.handleCardLeaveField(l006a.instanceId);
      engine.zoneMgr.moveCard(l006a.instanceId, 'HAND', { isFaceUp: true });
      expect(engine.fieldMgr.airborneRole(l006a.instanceId)).toBe(true);
      engine.zoneMgr.moveCard(r1.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
      engine.zoneMgr.moveCard(r2.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
      engine.zoneMgr.moveCard(l001.instanceId, 'HAND', { isFaceUp: true });
      readyAllOpenCosts(engine, 'p1');
      mustPlay(engine, 'p1', l001.instanceId, {
        isAscension: true,
        targetAscensionCardId: l006a.instanceId,
      });
      // l001【出】与 l005a【自】同入栈
      if (engine.getState().currentPendingChoice?.effectType === 'CHOOSE_TRIGGER_ORDER') {
        const opt005 = engine.getState().currentPendingChoice!.options.find(
          (o) => (o.payload as { sourceCardInstanceId?: string } | undefined)?.sourceCardInstanceId === l005a.instanceId
        )!;
        mustPick(engine, [opt005.id]);
      }
      expect(engine.getState().currentPendingChoice?.effectType).toBe('DSL_BP03-005_ORB_COST');
      mustPick(engine, [engine.getState().currentPendingChoice!.options.find((o) => o.id !== 'skip')!.id]);
      resolvePendingChoices(engine);
      expect(engine.fieldMgr.calculateRoleEffectivePP(l005a.instanceId)).toBe(6000);

      // 分支 C 反例：让 l005b 从 PROCESSING 浮空回场，之后另一张 l006b 从 HAND 普通出场，l005b 绝不能被误触发！
      engine.fieldMgr.handleCardLeaveField(l005a.instanceId);
      engine.fieldMgr.handleCardLeaveField(l001.instanceId);
      engine.zoneMgr.moveCard(l005b.instanceId, 'HAND', { isFaceUp: true });
      expect(engine.fieldMgr.airborneRole(l005b.instanceId)).toBe(true);
      advanceTurnTo(engine, 'p2');
      advanceTurnToExpectingTriggers(engine, 'p1');
      // 跳过 l005b 自身处理区回场的【自】和【出】
      while (engine.getState().currentPendingChoice) {
        const ch = engine.getState().currentPendingChoice!;
        if (ch.effectType === 'CHOOSE_TRIGGER_ORDER') {
          mustPick(engine, [ch.options[0]!.id]);
        } else {
          mustPick(engine, []);
        }
      }
      ensureMainPhase(engine);
      engine.zoneMgr.moveCard(r1.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
      engine.zoneMgr.moveCard(r2.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
      readyAllOpenCosts(engine, 'p1');
      mustPlay(engine, 'p1', l006b.instanceId, { targetSlotIndex: 2 });
      expect(engine.getState().currentPendingChoice?.effectType).toBe('DSL_BP03-006_DISCARD');
      mustPick(engine, [engine.getState().currentPendingChoice!.options[0]!.id]);
      // 确认无 DSL_BP03-005_ORB_COST 误触发
      expect(engine.getState().currentPendingChoice).toBeUndefined();
      expect(engine.fieldMgr.calculateRoleEffectivePP(l005b.instanceId)).toBe(5000);
    }

    // 2. P1-2 BP03-009：处理区非浮空公开角色时不变为 DP=1；浮空角色在场变为 DP=1
    // 以及 BP03-001 第2项 orb_destroy 组合费用<=8破坏、普通非浮空升变不触发【出】、BP03-006/007/008
    {
      const engine = createEngine(
        buildDeck(['BP03-001', 'BP03-001', 'BP03-006', 'BP03-007', 'BP03-008', 'BP03-009', 'BP03-081', 'BP03-082']),
        buildDeck(['ST02-003', 'ST02-005', 'ST02-008'])
      );
      const l009 = placeRole(engine, 'p1', 'BP03-009', 0);
      expect(engine.fieldMgr.calculateRoleEffectiveDP(l009.instanceId)).toBe(0);

      // 将 1 张普通角色（非浮空）正面放入处理区 -> 009 依然 DP=0
      const l008 = findCard(engine, 'p1', 'BP03-008');
      engine.zoneMgr.moveCard(l008.instanceId, 'PROCESSING', { isFaceUp: true });
      expect(cardState(engine, l008.instanceId).isAirborne).toBeUndefined();
      expect(engine.fieldMgr.calculateRoleEffectiveDP(l009.instanceId)).toBe(0);

      // 移出普通角色，改为让 l007 以【浮空】进入处理区 -> 009 变为 DP=1
      engine.zoneMgr.moveCardToBottomOfDeck(l008.instanceId);
      const l007 = placeRole(engine, 'p1', 'BP03-007', 1);
      // 场上现在有 009 和 007 (均《露西亚·誓焰》)，l007 攻击结束时触发【自】浮空
      putNonOrbOnTop(engine, 'p1');
      putNonOrbOnTop(engine, 'p2');
      expect(
        engine.dispatchAction({
          type: 'DECLARE_ATTACK',
          playerId: 'p1',
          attackerCardId: l007.instanceId,
          targetType: 'PLAYER',
        }).success
      ).toBe(true);
      finishCombat(engine);
      expect(cardState(engine, l007.instanceId).isAirborne).toBe(true);
      expect(engine.fieldMgr.calculateRoleEffectiveDP(l009.instanceId)).toBe(1);

      // 测试 BP03-008【永】【充能0】与【起】1费浮空（须先清掉已有浮空卡）
      advanceTurnTo(engine, 'p2');
      advanceTurnTo(engine, 'p1');
      resolvePendingChoices(engine);
      engine.fieldMgr.handleCardLeaveField(l007.instanceId);
      engine.zoneMgr.moveCardToBottomOfDeck(l007.instanceId);
      engine.fieldMgr.handleCardLeaveField(l009.instanceId);
      engine.zoneMgr.moveCardToBottomOfDeck(l009.instanceId);

      placeRole(engine, 'p1', 'BP03-008', 0);
      expect(engine.combatMgr.calculateRoleChargeCount(l008.instanceId)).toBe(0);
      setupOpenCost(engine, 'p1', ['FIRE'], 10);
      mustActivate(engine, 'p1', l008.instanceId, 0);
      expect(cardState(engine, l008.instanceId).isAirborne).toBe(true);

      // BP03-006【起】1费浮空：已有浮空卡时被拒，清掉后成功
      const l006 = placeRole(engine, 'p1', 'BP03-006', 1);
      const fail006 = engine.dispatchAction({
        type: 'ACTIVATE_ABILITY',
        playerId: 'p1',
        sourceCardId: l006.instanceId,
        abilityIndex: 0,
      });
      expect(fail006.success).toBe(false);
      // 释放 l008 浮空并测试 BP03-001 浮空升变 + orb_destroy 组合破坏费用<=8
      engine.zoneMgr.moveCardToBottomOfDeck(l008.instanceId);
      mustActivate(engine, 'p1', l006.instanceId, 0);
      expect(cardState(engine, l006.instanceId).isAirborne).toBe(true);

      const opp4 = placeRole(engine, 'p2', 'ST02-003', 0); // cost 4
      const opp2 = placeRole(engine, 'p2', 'ST02-005', 1); // cost 2
      const opp5 = placeRole(engine, 'p2', 'ST02-008', 2); // cost 5
      const r1 = findCard(engine, 'p1', 'BP03-081');
      const r2 = findCard(engine, 'p1', 'BP03-082');
      engine.zoneMgr.moveCard(r1.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
      engine.zoneMgr.moveCard(r2.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
      engine.getState().players['p1']!.erosionCount = 4;

      const l001a = findCard(engine, 'p1', 'BP03-001', 0);
      engine.zoneMgr.moveCard(l001a.instanceId, 'HAND', { isFaceUp: true });
      mustPlay(engine, 'p1', l001a.instanceId, {
        isAscension: true,
        targetAscensionCardId: l006.instanceId,
      });
      expect(engine.getState().currentPendingChoice?.effectType).toBe('DSL_BP03-001_MODE_2');
      mustPick(engine, ['buff_self', 'orb_destroy']);
      expect(engine.getState().currentPendingChoice?.effectType).toBe('DSL_BP03-001_ORB_COST');
      mustPick(engine, [engine.getState().currentPendingChoice!.options.find((o) => o.id !== 'skip')!.id]);
      expect(engine.getState().currentPendingChoice?.effectType).toBe('DSL_BP03-001_DESTROY');

      // 费用合计 5 + 4 = 9 > 8 必须拒绝，然后选 4 + 2 = 6 <= 8 破坏！
      const overCostRes = engine.dispatchAction({
        type: 'SELECT_CHOICE_OPTION',
        playerId: 'p1',
        pendingChoiceId: engine.getState().currentPendingChoice!.id,
        selectedIds: [opp5.instanceId, opp4.instanceId],
      });
      expect(overCostRes.success).toBe(false);
      mustPick(engine, [opp4.instanceId, opp2.instanceId]);
      expect(cardState(engine, opp4.instanceId).zone).toBe('GRAVEYARD');
      expect(cardState(engine, opp2.instanceId).zone).toBe('GRAVEYARD');
      expect(cardState(engine, opp5.instanceId).zone).toBe('BATTLEFIELD');

      // 反例：普通场上角色（非浮空）作为升变对象，BP03-001 不触发【出】
      const l001b = findCard(engine, 'p1', 'BP03-001', 1);
      const normalBase = placeRole(engine, 'p1', 'BP03-009', 2);
      engine.zoneMgr.moveCard(l001b.instanceId, 'HAND', { isFaceUp: true });
      readyAllOpenCosts(engine, 'p1');
      mustPlay(engine, 'p1', l001b.instanceId, {
        isAscension: true,
        targetAscensionCardId: normalBase.instanceId,
      });
      expect(engine.getState().currentPendingChoice).toBeUndefined();
    }
  });

  it('BP03-002/003/003【冠军】/004/010/011：002 手牌浮空、003 与冠军异画、004 第2项炸PP<=4000、011 反例', () => {
    const engine = createEngine(
      buildDeck(['BP03-002', 'BP03-003', 'BP03-003【冠军】', 'BP03-004', 'BP03-006', 'BP03-010', 'BP03-011', 'BP03-081', 'BP03-082', 'BP01-044', 'BP01-045']),
      buildDeck(['ST02-003', 'ST02-008'])
    );
    setupOpenCost(engine, 'p1', ['FIRE'], 10);

    // 1. BP03-002 在手牌发动【起】5费直接浮空；有非誓焰角色时失败
    const nonLucia = placeRole(engine, 'p1', 'ST01-006', 0);
    const l002 = findCard(engine, 'p1', 'BP03-002');
    engine.zoneMgr.moveCard(l002.instanceId, 'HAND', { isFaceUp: true });
    expect(
      engine.dispatchAction({
        type: 'ACTIVATE_ABILITY',
        playerId: 'p1',
        sourceCardId: l002.instanceId,
        abilityIndex: 0,
      }).success
    ).toBe(false);
    engine.fieldMgr.handleCardLeaveField(nonLucia.instanceId);
    engine.zoneMgr.moveCardToBottomOfDeck(nonLucia.instanceId);

    // BP03-011【瞬时】：主要阶段直接打出被拒；我方结束阶段无法使用（仅对方回合有效）；对方回合瞬时窗口使用成功浮空
    const l004Field = placeRole(engine, 'p1', 'BP03-004', 0);
    const spell011 = findCard(engine, 'p1', 'BP03-011');
    engine.zoneMgr.moveCard(spell011.instanceId, 'HAND', { isFaceUp: true });
    expect(
      engine.dispatchAction({
        type: 'PLAY_CARD',
        playerId: 'p1',
        cardInstanceId: spell011.instanceId,
      }).success
    ).toBe(false);
    // 我方回合 END_PHASE 因「只能在对方回合使用」自动跳过瞬时窗口，直接交给 p2 且 l004Field 保留在战场
    expect(engine.dispatchAction({ type: 'PASS_ACTION_TIMING', playerId: 'p1' }).success).toBe(true);
    expect(engine.getState().activePlayerId).toBe('p2');
    expect(cardState(engine, l004Field.instanceId).zone).toBe('BATTLEFIELD');
    expect(cardState(engine, l004Field.instanceId).isAirborne).toBeUndefined();
    // 推进至 p2 攻击自由时点窗口，p1 使用 BP03-011 成功将场上仅有的《露西亚·誓焰》浮空
    const oppAtk011 = placeRole(engine, 'p2', 'ST02-003', 0, { isReady: true });
    if (engine.getState().phase === 'DRAW_CHARGE_PHASE') {
      engine.dispatchAction({ type: 'PASS_ACTION_TIMING', playerId: 'p2' });
    }
    putNonOrbOnTop(engine, 'p1');
    putNonOrbOnTop(engine, 'p2');
    expect(
      engine.dispatchAction({
        type: 'DECLARE_ATTACK',
        playerId: 'p2',
        attackerCardId: oppAtk011.instanceId,
        targetType: 'PLAYER',
      }).success
    ).toBe(true);
    expect(engine.getState().timingWindow?.priorityPlayerId).toBe('p1');
    expect(
      engine.dispatchAction({
        type: 'USE_INSTANT',
        playerId: 'p1',
        cardInstanceId: spell011.instanceId,
      }).success
    ).toBe(true);
    expect(engine.getState().currentPendingChoice?.effectType).toBe('DSL_BP03-011_AIRBORNE');
    mustPick(engine, [l004Field.instanceId]);
    expect(cardState(engine, l004Field.instanceId).zone).toBe('PROCESSING');
    expect(cardState(engine, l004Field.instanceId).isAirborne).toBe(true);
    coveredCardNumbers.add('BP03-011');
    finishCombat(engine, 'p1');
    engine.fieldMgr.handleCardLeaveField(oppAtk011.instanceId);
    engine.zoneMgr.moveCardToBottomOfDeck(oppAtk011.instanceId);
    // 回到 p1 回合（l004Field 从处理区返回战场后继续测 BP03-002/004/010）
    advanceTurnTo(engine, 'p1');
    expect(cardState(engine, l004Field.instanceId).zone).toBe('BATTLEFIELD');

    // 移走场上 role 后再测 BP03-002 正常空场? 需「只存在《露西亚·誓焰》」即至少 1 张《露西亚·誓焰》
    mustActivate(engine, 'p1', l002.instanceId, 0);
    expect(cardState(engine, l002.instanceId).zone).toBe('PROCESSING');
    expect(cardState(engine, l002.instanceId).isAirborne).toBe(true);

    // 2. BP03-004 在处理区存在浮空誓焰时出场，丢2火手牌选第2项炸 PP<=4000
    const opp4000 = placeRole(engine, 'p2', 'ST02-003', 0); // PP 4000
    const opp5000 = placeRole(engine, 'p2', 'ST02-008', 1); // PP 5000 (> 4000)
    engine.fieldMgr.handleCardLeaveField(l004Field.instanceId);
    const fire1 = findCard(engine, 'p1', 'BP01-044');
    const fire2 = findCard(engine, 'p1', 'BP01-045');
    engine.zoneMgr.moveCard(fire1.instanceId, 'HAND', { isFaceUp: true });
    engine.zoneMgr.moveCard(fire2.instanceId, 'HAND', { isFaceUp: true });
    engine.zoneMgr.moveCard(l004Field.instanceId, 'HAND', { isFaceUp: true });
    readyAllOpenCosts(engine, 'p1');
    mustPlay(engine, 'p1', l004Field.instanceId, { targetSlotIndex: 0 });
    expect(engine.getState().currentPendingChoice?.effectType).toBe('DSL_BP03-004_DISCARD');
    mustPick(engine, [fire1.instanceId, fire2.instanceId]);
    expect(engine.getState().currentPendingChoice?.effectType).toBe('DSL_BP03-004_MODE');
    mustPick(engine, ['destroy_4000']);
    expect(engine.getState().currentPendingChoice?.effectType).toBe('DSL_BP03-004_DESTROY');
    expect(engine.getState().currentPendingChoice!.options.map((o) => o.id)).toEqual([opp4000.instanceId]);
    mustPick(engine, [opp4000.instanceId]);
    expect(cardState(engine, opp4000.instanceId).zone).toBe('GRAVEYARD');
    expect(cardState(engine, opp5000.instanceId).zone).toBe('BATTLEFIELD');

    // 3. BP03-010【瞬时】在结束阶段瞬时窗口拉出浮空 l002 (此时双方均为1角色 -> 横置出场)
    const spell010 = findCard(engine, 'p1', 'BP03-010');
    engine.zoneMgr.moveCard(spell010.instanceId, 'HAND', { isFaceUp: true });
    expect(engine.dispatchAction({ type: 'PASS_ACTION_TIMING', playerId: 'p1' }).success).toBe(true);
    expect(engine.getState().timingWindow?.priorityPlayerId).toBe('p1');
    const res010 = engine.dispatchAction({
      type: 'USE_INSTANT',
      playerId: 'p1',
      cardInstanceId: spell010.instanceId,
    });
    expect(res010.success, res010.error).toBe(true);
    coveredCardNumbers.add('BP03-010');
    mustPick(engine, [l002.instanceId]);
    expect(cardState(engine, l002.instanceId).zone).toBe('BATTLEFIELD');
    expect(cardState(engine, l002.instanceId).isReady).toBe(false);
    expect(engine.fieldMgr.evaluateRoleStats(l002.instanceId).keywords).toContain('速攻');
    passInstantWindows(engine);
    advanceTurnTo(engine, 'p1');

    // 4. BP03-003 与 BP03-003【冠军】升变出场 & 竖直【起】
    const l003 = findCard(engine, 'p1', 'BP03-003');
    const l003Champ = findCard(engine, 'p1', 'BP03-003【冠军】');
    const l006Base = placeRole(engine, 'p1', 'BP03-006', 3); // cost 4 (< 6)
    const r1 = findCard(engine, 'p1', 'BP03-081');
    const r2 = findCard(engine, 'p1', 'BP03-082');
    engine.zoneMgr.moveCard(r1.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    engine.zoneMgr.moveCard(r2.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    readyAllOpenCosts(engine, 'p1');
    engine.zoneMgr.moveCard(l003.instanceId, 'HAND', { isFaceUp: true });
    mustPlay(engine, 'p1', l003.instanceId, {
      isAscension: true,
      targetAscensionCardId: l006Base.instanceId,
    });
    expect(engine.fieldMgr.evaluateRoleStats(l003.instanceId).canAttackPlayerOnEnterTurn).toBe(true);

    // 冠军版从手牌竖直出场并在只存在誓焰时发动【起】浮空
    engine.zoneMgr.moveCard(l003Champ.instanceId, 'HAND', { isFaceUp: true });
    readyAllOpenCosts(engine, 'p1');
    mustPlay(engine, 'p1', l003Champ.instanceId, { targetSlotIndex: 2 });
    mustActivate(engine, 'p1', l003Champ.instanceId, 0);
    expect(cardState(engine, l003Champ.instanceId).isAirborne).toBe(true);
    mustPick(engine, [engine.getState().currentPendingChoice!.options.find((o) => o.id !== 'skip')!.id]);
    mustPick(engine, [l003.instanceId]);
    expect(engine.fieldMgr.evaluateRoleStats(l003.instanceId).keywords).toContain('速攻');
    expect(engine.fieldMgr.calculateRoleEffectivePP(l003.instanceId)).toBe(6500);
  });
});

// ============================================================================
// 二、七实·芒星之迹 体系 (BP03-012 ~ BP03-022)
// ============================================================================

describe('Stage 4D BP03 七实·芒星之迹 体系精确覆盖', () => {
  it('P1-3 & P1-4 BP03-013/014/015/016/020/021：10.12.2「<7张」6满足7不满足 & ZONE_SLICE 仅取顶部N张置墓', () => {
    const engine = createEngine(
      buildDeck([
        'BP03-013',
        'BP03-014',
        'BP03-014',
        'BP03-015',
        'BP03-016',
        'BP03-020',
        'BP03-020',
        'BP03-021',
        'BP03-081',
        'BP03-082',
        'BP03-083',
        'BP03-084',
        'BP03-085',
        'BP03-086',
        'BP03-087',
      ]),
      buildDeck(['ST02-002'])
    );
    const orbs = ['BP03-081', 'BP03-082', 'BP03-083', 'BP03-084', 'BP03-085', 'BP03-086', 'BP03-087'].map((n) =>
      findCard(engine, 'p1', n)
    );
    // 先放 6 张信号球 (orbs[0] 在最底，orbs[5] 在最顶)
    for (const o of orbs.slice(0, 6)) engine.zoneMgr.moveCard(o.instanceId, 'SIGNAL_ORB', { isFaceUp: true });

    const reserveSet = new Set([
      ...orbs.map((o) => o.instanceId),
      findCard(engine, 'p1', 'BP03-013').instanceId,
      findCard(engine, 'p1', 'BP03-014', 0).instanceId,
      findCard(engine, 'p1', 'BP03-014', 1).instanceId,
      findCard(engine, 'p1', 'BP03-015').instanceId,
      findCard(engine, 'p1', 'BP03-016').instanceId,
      findCard(engine, 'p1', 'BP03-020', 0).instanceId,
      findCard(engine, 'p1', 'BP03-020', 1).instanceId,
      findCard(engine, 'p1', 'BP03-021').instanceId,
    ]);
    setupOpenCost(engine, 'p1', ['LIGHTNING'], 10, reserveSet);

    // 1. BP03-021 鮟棘：6 张球时成功发动，翻出非七实/鮟棘留牌组顶，再翻出七实则背面置球区底
    const anji = placeRole(engine, 'p1', 'BP03-021', 4);
    const nonNanami = findCard(engine, 'p1', 'ST01-006');
    engine.zoneMgr.moveCardToTopOfDeck(nonNanami.instanceId);
    mustActivate(engine, 'p1', anji.instanceId, 0);
    expect(engine.zoneMgr.getCardsInZone('p1', 'DECK')[0]!.instanceId).toBe(nonNanami.instanceId);
    expect(engine.zoneMgr.getCardsInZone('p1', 'SIGNAL_ORB')).toHaveLength(6);

    // 再置 1 张球达到恰好 7 张 -> BP03-021 不能发动（7张不满足 <7）
    engine.zoneMgr.moveCard(orbs[6]!.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    cardState(engine, anji.instanceId).isReady = true;
    expect(
      engine.dispatchAction({
        type: 'ACTIVATE_ABILITY',
        playerId: 'p1',
        sourceCardId: anji.instanceId,
        abilityIndex: 0,
      }).success
    ).toBe(false);

    // 移走 orbs[6] 回 6 张，测 BP03-021 翻出《七实·芒星之迹》背面放球区底
    engine.zoneMgr.moveCardToBottomOfDeck(orbs[6]!.instanceId);
    const nanamiDeck = findCard(engine, 'p1', 'BP03-016');
    engine.zoneMgr.moveCardToTopOfDeck(nanamiDeck.instanceId);
    mustActivate(engine, 'p1', anji.instanceId, 0);
    expect(cardState(engine, nanamiDeck.instanceId).zone).toBe('SIGNAL_ORB');
    expect(cardState(engine, nanamiDeck.instanceId).isFaceUp).toBe(false);
    expect(engine.zoneMgr.getCardsInZone('p1', 'SIGNAL_ORB')[0]!.instanceId).toBe(nanamiDeck.instanceId);
    // 清出 nanamiDeck 回到 6 张
    engine.zoneMgr.moveCardToBottomOfDeck(nanamiDeck.instanceId);

    // 2. BP03-014 边界：6 张球时选 mode 1 触发放置 2 张；7 张球时选 mode 1 不弹出放置确认
    const n014a = findCard(engine, 'p1', 'BP03-014', 0);
    engine.zoneMgr.moveCard(n014a.instanceId, 'HAND', { isFaceUp: true });
    // 先把占槽的 anji 移走保证只存在七实
    engine.fieldMgr.handleCardLeaveField(anji.instanceId);
    engine.zoneMgr.moveCardToBottomOfDeck(anji.instanceId);
    mustPlay(engine, 'p1', n014a.instanceId, { targetSlotIndex: 0 });
    expect(engine.getState().currentPendingChoice?.effectType).toBe('DSL_BP03-014_MODE');
    mustPick(engine, ['deck_to_orb_bottom']);
    expect(engine.getState().currentPendingChoice?.effectType).toBe('DSL_BP03-014_OPT1_CONFIRM');
    mustPick(engine, ['opt_yes']);
    expect(engine.zoneMgr.getCardsInZone('p1', 'SIGNAL_ORB')).toHaveLength(8);

    // 清掉新增2张并补到恰好 7 张球，测 n014b 选 deck_to_orb_bottom 不触发；再测 n014b 重试模式2 ZONE_SLICE 仅将顶部4张置墓
    for (const c of engine.zoneMgr.getCardsInZone('p1', 'SIGNAL_ORB')) {
      engine.zoneMgr.moveCardToBottomOfDeck(c.instanceId);
    }
    for (const o of orbs) engine.zoneMgr.moveCard(o.instanceId, 'SIGNAL_ORB', { isFaceUp: true }); // 正好 7 张: orbs[0..6]
    const n014b = findCard(engine, 'p1', 'BP03-014', 1);
    readyAllOpenCosts(engine, 'p1');
    engine.zoneMgr.moveCard(n014b.instanceId, 'HAND', { isFaceUp: true });
    mustPlay(engine, 'p1', n014b.instanceId, { targetSlotIndex: 1 });
    mustPick(engine, ['deck_to_orb_bottom']);
    expect(engine.getState().currentPendingChoice).toBeUndefined(); // 恰好7张不满足 <7

    // 再以 BP03-014#0 重新出场验证模式 2 (top4_to_gy) 通过 ZONE_SLICE 将顶部 4 张 orbs[3..6] 置墓，保留底部 orbs[0..2]
    engine.fieldMgr.handleCardLeaveField(n014a.instanceId);
    engine.zoneMgr.moveCard(n014a.instanceId, 'HAND', { isFaceUp: true });
    readyAllOpenCosts(engine, 'p1');
    mustPlay(engine, 'p1', n014a.instanceId, { targetSlotIndex: 0 });
    mustPick(engine, ['top4_to_gy']);
    expect(engine.getState().currentPendingChoice?.effectType).toBe('DSL_BP03-014_OPT2_CONFIRM');
    mustPick(engine, ['opt_yes']);
    expect(orbs.slice(3, 7).every((o) => cardState(engine, o.instanceId).zone === 'GRAVEYARD')).toBe(true);
    expect(orbs.slice(0, 3).every((o) => cardState(engine, o.instanceId).zone === 'SIGNAL_ORB')).toBe(true);
    expect(engine.fieldMgr.evaluateRoleStats(n014a.instanceId).keywords).toContain('突进');
    expect(engine.fieldMgr.evaluateRoleStats(n014a.instanceId).keywords).toContain('贯通');
    expect(engine.fieldMgr.calculateRoleEffectivePP(n014a.instanceId)).toBe(7777);

    // 3. BP03-016：<7张时不触发；补至7张时 ZONE_SLICE 仅将顶部 2 张置墓，底部 5 张保留
    engine.fieldMgr.handleCardLeaveField(n014a.instanceId);
    engine.fieldMgr.handleCardLeaveField(n014b.instanceId);
    // 现在球区 3 张，先测试 <7 不触发
    const n016 = findCard(engine, 'p1', 'BP03-016');
    engine.zoneMgr.moveCard(n016.instanceId, 'HAND', { isFaceUp: true });
    readyAllOpenCosts(engine, 'p1');
    mustPlay(engine, 'p1', n016.instanceId, { targetSlotIndex: 0 });
    expect(engine.getState().currentPendingChoice).toBeUndefined();
    expect(engine.fieldMgr.evaluateRoleStats(n016.instanceId).keywords).not.toContain('速攻');

    // 重新补 7 张球 (orbs[0..6])，再出 BP03-016
    engine.fieldMgr.handleCardLeaveField(n016.instanceId);
    for (const o of orbs) engine.zoneMgr.moveCard(o.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    engine.zoneMgr.moveCard(n016.instanceId, 'HAND', { isFaceUp: true });
    readyAllOpenCosts(engine, 'p1');
    mustPlay(engine, 'p1', n016.instanceId, { targetSlotIndex: 0 });
    expect(engine.getState().currentPendingChoice?.effectType).toBe('DSL_BP03-016_CONFIRM');
    mustPick(engine, ['opt_yes']);
    expect(orbs.slice(5, 7).every((o) => cardState(engine, o.instanceId).zone === 'GRAVEYARD')).toBe(true);
    expect(orbs.slice(0, 5).every((o) => cardState(engine, o.instanceId).zone === 'SIGNAL_ORB')).toBe(true);
    expect(engine.fieldMgr.evaluateRoleStats(n016.instanceId).keywords).toContain('速攻');

    // 4. BP03-013【起】：当前 5 张球 (orbs[0..4]) -> ZONE_SLICE 仅将顶部 3 张 (orbs[2..4]) 置墓，底部 2 张 (orbs[0..1]) 保留；<3 张时不弹确认
    const n013 = placeRole(engine, 'p1', 'BP03-013', 1);
    mustActivate(engine, 'p1', n013.instanceId, 0);
    expect(engine.getState().currentPendingChoice?.effectType).toBe('DSL_BP03-013_ACT_CONFIRM');
    mustPick(engine, ['opt_yes']);
    expect(engine.getState().currentPendingChoice?.effectType).toBe('DSL_BP03-013_RUSH');
    mustPick(engine, [n013.instanceId]);
    expect(orbs.slice(2, 5).every((o) => cardState(engine, o.instanceId).zone === 'GRAVEYARD')).toBe(true);
    expect(orbs.slice(0, 2).every((o) => cardState(engine, o.instanceId).zone === 'SIGNAL_ORB')).toBe(true);
    expect(engine.fieldMgr.evaluateRoleStats(n013.instanceId).keywords).toContain('速攻');

    // 5. BP03-015 攻击时 6 张触发 vs 7 张不触发；BP03-020 战斗破坏时 6 张进底 vs 7 张留墓地
    const n015 = placeRole(engine, 'p1', 'BP03-015', 2);
    const oppWall = placeRole(engine, 'p2', 'ST02-002', 0, { isReady: false }); // PP 8000
    // 补至 6 张球
    for (const o of orbs.slice(2, 6)) engine.zoneMgr.moveCard(o.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    expect(engine.zoneMgr.getCardsInZone('p1', 'SIGNAL_ORB')).toHaveLength(6);
    putNonOrbOnTop(engine, 'p1');
    putNonOrbOnTop(engine, 'p2');
    expect(
      engine.dispatchAction({
        type: 'DECLARE_ATTACK',
        playerId: 'p1',
        attackerCardId: n015.instanceId,
        targetType: 'PLAYER',
      }).success
    ).toBe(true);
    expect(engine.getState().currentPendingChoice?.effectType).toBe('DSL_BP03-015_CONFIRM');
    mustPick(engine, ['opt_no']); // 保持 6 张不加球以测下面 7 张反例
    finishCombat(engine);

    // 补 1 张达到 7 张，攻击不再弹出 DSL_BP03-015_CONFIRM
    engine.zoneMgr.moveCard(orbs[6]!.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    cardState(engine, n015.instanceId).isReady = true;
    putNonOrbOnTop(engine, 'p1');
    putNonOrbOnTop(engine, 'p2');
    expect(
      engine.dispatchAction({
        type: 'DECLARE_ATTACK',
        playerId: 'p1',
        attackerCardId: n015.instanceId,
        targetType: 'PLAYER',
      }).success
    ).toBe(true);
    expect(engine.getState().currentPendingChoice).toBeUndefined();
    finishCombat(engine);

    // BP03-020#0 在 7 张球时被 oppWall (PP 8000) 攻击破坏 -> 留墓地；移至 6 球后 BP03-020#1 被攻击破坏 -> 背面置球区底
    const n020a = placeRole(engine, 'p1', 'BP03-020', 3, { isReady: false }); // PP 2000 横置待攻
    advanceTurnTo(engine, 'p2');
    cardState(engine, oppWall.instanceId).isReady = true;
    putNonOrbOnTop(engine, 'p1');
    putNonOrbOnTop(engine, 'p2');
    expect(
      engine.dispatchAction({
        type: 'DECLARE_ATTACK',
        playerId: 'p2',
        attackerCardId: oppWall.instanceId,
        targetType: 'CHARACTER',
        targetCardId: n020a.instanceId,
      }).success
    ).toBe(true);
    finishCombat(engine, 'p1');
    expect(cardState(engine, n020a.instanceId).zone).toBe('GRAVEYARD');

    // 移走 1 张降至 6 张球，BP03-020#1 战败破坏 -> 弹出 DSL_BP03-020_CONFIRM 背面置球区底
    engine.zoneMgr.moveCardToBottomOfDeck(orbs[6]!.instanceId);
    const n020b = placeRole(engine, 'p1', 'BP03-020', 3, { isReady: false, instanceIndex: 1 });
    cardState(engine, oppWall.instanceId).isReady = true;
    putNonOrbOnTop(engine, 'p1');
    putNonOrbOnTop(engine, 'p2');
    expect(
      engine.dispatchAction({
        type: 'DECLARE_ATTACK',
        playerId: 'p2',
        attackerCardId: oppWall.instanceId,
        targetType: 'CHARACTER',
        targetCardId: n020b.instanceId,
      }).success
    ).toBe(true);
    passToCharge(engine, 'p1');
    expect(engine.getState().currentPendingChoice?.effectType).toBe('DSL_BP03-020_CONFIRM');
    mustPick(engine, ['opt_yes']);
    finishCombat(engine, 'p1');
    expect(cardState(engine, n020b.instanceId).zone).toBe('SIGNAL_ORB');
    expect(cardState(engine, n020b.instanceId).isFaceUp).toBe(false);
  });

  it('BP03-012/013(攻击)/017/018/019/022：013 攻击置雷球抽1+7777与<3球反例、019 选0/1、022 攻击4费竖直正例', () => {
    const engine = createEngine(
      buildDeck([
        'BP03-012',
        'BP03-013',
        'BP03-017',
        'BP03-018',
        'BP03-019',
        'BP03-019',
        'BP03-022',
        'BP03-081',
        'BP03-082',
        'BP03-083',
        'BP03-084',
        'BP03-085',
        'BP03-086',
        'BP03-087',
      ]),
      buildDeck(['ST02-003', 'ST02-002'])
    );
    const reserve = new Set([
      findCard(engine, 'p1', 'BP03-012').instanceId,
      findCard(engine, 'p1', 'BP03-013').instanceId,
      findCard(engine, 'p1', 'BP03-017').instanceId,
      findCard(engine, 'p1', 'BP03-018').instanceId,
      findCard(engine, 'p1', 'BP03-019', 0).instanceId,
      findCard(engine, 'p1', 'BP03-019', 1).instanceId,
      findCard(engine, 'p1', 'BP03-022').instanceId,
      findCard(engine, 'p1', 'BP03-081').instanceId,
      findCard(engine, 'p1', 'BP03-082').instanceId,
      findCard(engine, 'p1', 'BP03-083').instanceId,
      findCard(engine, 'p1', 'BP03-084').instanceId,
      findCard(engine, 'p1', 'BP03-085').instanceId,
      findCard(engine, 'p1', 'BP03-086').instanceId,
      findCard(engine, 'p1', 'BP03-087').instanceId,
    ]);
    setupOpenCost(engine, 'p1', ['LIGHTNING'], 10, reserve);

    // 1. BP03-019【永】【充能0】与【出】选0不抽 vs 选1背面置底抽1
    const n019b = findCard(engine, 'p1', 'BP03-019', 1);
    engine.zoneMgr.moveCard(n019b.instanceId, 'HAND', { isFaceUp: true });
    const handBefore19Zero = engine.zoneMgr.getCardsInZone('p1', 'HAND').length - 1;
    mustPlay(engine, 'p1', n019b.instanceId, { targetSlotIndex: 4 });
    mustPick(engine, []);
    expect(engine.zoneMgr.getCardsInZone('p1', 'HAND')).toHaveLength(handBefore19Zero);
    engine.fieldMgr.handleCardLeaveField(n019b.instanceId);
    engine.zoneMgr.moveCardToBottomOfDeck(n019b.instanceId);

    const n019 = findCard(engine, 'p1', 'BP03-019', 0);
    const pad = findCard(engine, 'p1', 'BP03-081');
    engine.zoneMgr.moveCard(pad.instanceId, 'HAND', { isFaceUp: true });
    engine.zoneMgr.moveCard(n019.instanceId, 'HAND', { isFaceUp: true });
    const handBefore19 = engine.zoneMgr.getCardsInZone('p1', 'HAND').length - 1;
    mustPlay(engine, 'p1', n019.instanceId, { targetSlotIndex: 0 });
    expect(engine.combatMgr.calculateRoleChargeCount(n019.instanceId)).toBe(0);
    mustPick(engine, [pad.instanceId]);
    expect(cardState(engine, pad.instanceId).zone).toBe('SIGNAL_ORB');
    expect(cardState(engine, pad.instanceId).isFaceUp).toBe(false);
    expect(engine.zoneMgr.getCardsInZone('p1', 'HAND')).toHaveLength(handBefore19); // -1(置球) +1(抽)

    // 2. BP03-018 攻击时：球<7不加，球>=7加2000PP
    const n018 = placeRole(engine, 'p1', 'BP03-018', 1);
    putNonOrbOnTop(engine, 'p1');
    putNonOrbOnTop(engine, 'p2');
    expect(
      engine.dispatchAction({
        type: 'DECLARE_ATTACK',
        playerId: 'p1',
        attackerCardId: n018.instanceId,
        targetType: 'PLAYER',
      }).success
    ).toBe(true);
    finishCombat(engine);
    expect(engine.fieldMgr.calculateRoleEffectivePP(n018.instanceId)).toBe(3000);

    // 补至 7 张球（注意之前已放 1 张 pad，另 6 张可从 DECK 或初始 HAND 取）
    const extraOrbs = [
      ...engine.zoneMgr.getCardsInZone('p1', 'DECK'),
      ...engine.zoneMgr.getCardsInZone('p1', 'HAND'),
    ]
      .filter((c) => db.getCard(c.cardNumber)?.signalOrb)
      .slice(0, 6);
    expect(extraOrbs).toHaveLength(6);
    for (const o of extraOrbs) engine.zoneMgr.moveCard(o.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    expect(engine.zoneMgr.getCardsInZone('p1', 'SIGNAL_ORB')).toHaveLength(7);
    cardState(engine, n018.instanceId).isReady = true;
    putNonOrbOnTop(engine, 'p1');
    putNonOrbOnTop(engine, 'p2');
    expect(
      engine.dispatchAction({
        type: 'DECLARE_ATTACK',
        playerId: 'p1',
        attackerCardId: n018.instanceId,
        targetType: 'PLAYER',
      }).success
    ).toBe(true);
    passInstantWindows(engine);
    expect(engine.fieldMgr.calculateRoleEffectivePP(n018.instanceId)).toBe(5000);
    finishCombat(engine);

    // 3. BP03-013 攻击置雷手牌抽1并变 7777；球<3时【起】不弹出确认（先放 p2 竖直阻挡者以在充能前检验手牌 -1 +1）
    const oppCost4 = placeRole(engine, 'p2', 'ST02-003', 0, { isReady: true });
    const n013 = placeRole(engine, 'p1', 'BP03-013', 2);
    const lightningHand = findCard(engine, 'p1', 'BP03-017');
    engine.zoneMgr.moveCard(lightningHand.instanceId, 'HAND', { isFaceUp: true });
    const handBefore13 = engine.zoneMgr.getCardsInZone('p1', 'HAND').length;
    putNonOrbOnTop(engine, 'p1');
    putNonOrbOnTop(engine, 'p2');
    expect(
      engine.dispatchAction({
        type: 'DECLARE_ATTACK',
        playerId: 'p1',
        attackerCardId: n013.instanceId,
        targetType: 'PLAYER',
      }).success
    ).toBe(true);
    mustPick(engine, [lightningHand.instanceId]);
    expect(cardState(engine, lightningHand.instanceId).zone).toBe('SIGNAL_ORB');
    expect(engine.zoneMgr.getCardsInZone('p1', 'HAND')).toHaveLength(handBefore13); // -1 +1（尚未进入充能）
    expect(engine.fieldMgr.calculateRoleEffectivePP(n013.instanceId)).toBe(7777);
    finishCombat(engine);

    // 清空球区至只剩 2 张，测 BP03-013【起】不弹出确认
    const allOrbs = engine.zoneMgr.getCardsInZone('p1', 'SIGNAL_ORB');
    for (const o of allOrbs.slice(2)) engine.zoneMgr.moveCardToBottomOfDeck(o.instanceId);
    mustActivate(engine, 'p1', n013.instanceId, 0);
    expect(engine.getState().currentPendingChoice).toBeUndefined();

    // 4. BP03-022 星芒构解：正例攻击费用<=4的竖直角色 (ST02-003 cost 4) 成功；费用>4 (ST02-002 cost 7) 失败
    cardState(engine, oppCost4.instanceId).isReady = true;
    const oppCost7 = placeRole(engine, 'p2', 'ST02-002', 1, { isReady: true });
    const spell022 = findCard(engine, 'p1', 'BP03-022');
    engine.zoneMgr.moveCard(spell022.instanceId, 'HAND', { isFaceUp: true });
    readyAllOpenCosts(engine, 'p1');
    mustPlay(engine, 'p1', spell022.instanceId);
    mustPick(engine, [n019.instanceId]);
    cardState(engine, n019.instanceId).turnEnteredZone = 0;

    expect(
      engine.dispatchAction({
        type: 'DECLARE_ATTACK',
        playerId: 'p1',
        attackerCardId: n019.instanceId,
        targetType: 'CHARACTER',
        targetCardId: oppCost7.instanceId,
      }).success
    ).toBe(false);

    expect(
      engine.dispatchAction({
        type: 'DECLARE_ATTACK',
        playerId: 'p1',
        attackerCardId: n019.instanceId,
        targetType: 'CHARACTER',
        targetCardId: oppCost4.instanceId,
      }).success
    ).toBe(true);
    finishCombat(engine);

    // 5. BP03-012 升变出场在 7 球时全置墓 + PP=7777 + 覆盖 oppCost7 PP=70
    const orbs7 = engine.zoneMgr.getCardsInZone('p1', 'DECK').filter((c) => db.getCard(c.cardNumber)?.signalOrb).slice(0, 5);
    for (const o of orbs7) engine.zoneMgr.moveCard(o.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    const n012 = findCard(engine, 'p1', 'BP03-012');
    engine.zoneMgr.moveCard(n012.instanceId, 'HAND', { isFaceUp: true });
    readyAllOpenCosts(engine, 'p1');
    mustPlay(engine, 'p1', n012.instanceId, {
      isAscension: true,
      targetAscensionCardId: n018.instanceId,
    });
    mustPick(engine, ['opt_yes']);
    mustPick(engine, [oppCost7.instanceId]);
    expect(engine.fieldMgr.calculateRoleEffectivePP(n012.instanceId)).toBe(7777);
    expect(engine.fieldMgr.calculateRoleEffectivePP(oppCost7.instanceId)).toBe(70);
  });

  it('P1-5 BP03-017/037/060/072/078：牌组底 chooseOrder 自选置底顺序精确断言', () => {
    // 1. BP03-017
    {
      const engine = createEngine(buildDeck(['BP03-017']), buildDeck([]));
      const c17 = findCard(engine, 'p1', 'BP03-017');
      const handPad = findCard(engine, 'p1', 'ST01-006');
      setupOpenCost(engine, 'p1', ['LIGHTNING'], 6, new Set([c17.instanceId, handPad.instanceId]));
      engine.zoneMgr.moveCard(handPad.instanceId, 'HAND', { isFaceUp: true });
      const top4 = engine.zoneMgr.getCardsInZone('p1', 'DECK').slice(0, 4).map((c) => c.instanceId);
      mustPlay(engine, 'p1', c17.instanceId, { targetSlotIndex: 0 });
      mustPick(engine, [handPad.instanceId]);
      mustPick(engine, []); // 选 0 张入手，剩 4 张选序置底
      const orderCh = engine.getState().currentPendingChoice!;
      expect(orderCh.effectType).toBe('DSL_ORDER_MOVE_BP03-017');
      expect(orderCh.options).toHaveLength(4);
      const customOrder = [...top4].reverse();
      mustPick(engine, customOrder);
      expect(engine.zoneMgr.getCardsInZone('p1', 'DECK').slice(-4).map((c) => c.instanceId)).toEqual(customOrder);
    }

    // 2. BP03-037
    {
      const engine = createEngine(buildDeck(['BP03-037']), buildDeck([]));
      const c37 = findCard(engine, 'p1', 'BP03-037');
      setupOpenCost(engine, 'p1', ['PHYSICAL'], 6, new Set([c37.instanceId]));
      const top4 = engine.zoneMgr.getCardsInZone('p1', 'DECK').slice(0, 4).map((c) => c.instanceId);
      mustPlay(engine, 'p1', c37.instanceId, { targetSlotIndex: 0 });
      mustPick(engine, []);
      const orderCh = engine.getState().currentPendingChoice!;
      expect(orderCh.effectType).toBe('DSL_ORDER_MOVE_BP03-037');
      const customOrder = [top4[2]!, top4[0]!, top4[3]!, top4[1]!];
      mustPick(engine, customOrder);
      expect(engine.zoneMgr.getCardsInZone('p1', 'DECK').slice(-4).map((c) => c.instanceId)).toEqual(customOrder);
    }

    // 3. BP03-060
    {
      const engine = createEngine(buildDeck(['BP03-060']), buildDeck([]));
      const c60 = findCard(engine, 'p1', 'BP03-060');
      setupOpenCost(engine, 'p1', ['DARK'], 6, new Set([c60.instanceId]));
      const top3 = engine.zoneMgr.getCardsInZone('p1', 'DECK').slice(0, 3).map((c) => c.instanceId);
      mustPlay(engine, 'p1', c60.instanceId, { targetSlotIndex: 0 });
      mustPick(engine, [c60.instanceId]);
      const orderCh = engine.getState().currentPendingChoice!;
      expect(orderCh.effectType).toBe('DSL_ORDER_MOVE_BP03-060');
      const customOrder = [top3[1]!, top3[2]!, top3[0]!];
      mustPick(engine, customOrder);
      expect(engine.zoneMgr.getCardsInZone('p1', 'DECK').slice(-3).map((c) => c.instanceId)).toEqual(customOrder);
    }

    // 4. BP03-072
    {
      const engine = createEngine(buildDeck(['BP03-072']), buildDeck([]));
      const c72 = findCard(engine, 'p1', 'BP03-072');
      setupOpenCost(engine, 'p1', ['LIGHTNING'], 6, new Set([c72.instanceId]));
      const top4 = engine.zoneMgr.getCardsInZone('p1', 'DECK').slice(0, 4).map((c) => c.instanceId);
      mustPlay(engine, 'p1', c72.instanceId, { targetSlotIndex: 0 });
      mustPick(engine, []);
      const orderCh = engine.getState().currentPendingChoice!;
      expect(orderCh.effectType).toBe('DSL_ORDER_MOVE_BP03-072');
      const customOrder = [...top4].reverse();
      mustPick(engine, customOrder);
      expect(engine.zoneMgr.getCardsInZone('p1', 'DECK').slice(-4).map((c) => c.instanceId)).toEqual(customOrder);
    }

    // 5. BP03-078
    {
      const engine = createEngine(buildDeck(['BP03-078', 'BP03-076', 'BP03-084']), buildDeck([]));
      const c78 = findCard(engine, 'p1', 'BP03-078');
      const alpha = findCard(engine, 'p1', 'BP03-076');
      const blueOrb = findCard(engine, 'p1', 'BP03-084');
      setupOpenCost(engine, 'p1', ['PHYSICAL'], 6, new Set([c78.instanceId, alpha.instanceId, blueOrb.instanceId]));
      const deckExtras = engine.zoneMgr.getCardsInZone('p1', 'DECK').filter(
        (c) => c.instanceId !== alpha.instanceId && c.instanceId !== blueOrb.instanceId && !db.getCard(c.cardNumber)?.signalOrb
      );
      const keepA = deckExtras[0]!;
      const keepB = deckExtras[1]!;
      engine.zoneMgr.moveCardToTopOfDeck(keepB.instanceId);
      engine.zoneMgr.moveCardToTopOfDeck(keepA.instanceId);
      engine.zoneMgr.moveCardToTopOfDeck(blueOrb.instanceId);
      engine.zoneMgr.moveCardToTopOfDeck(alpha.instanceId);

      mustPlay(engine, 'p1', c78.instanceId);
      mustPick(engine, ['search_alpha_blue']);
      mustPick(engine, [alpha.instanceId]); // 拿走 <阿尔法>
      mustPick(engine, []); // 不拿蓝球，剩余 3 张 (blueOrb, keepA, keepB) 选序置底
      const orderCh = engine.getState().currentPendingChoice!;
      expect(orderCh.effectType).toBe('DSL_ORDER_MOVE_BP03-078');
      expect(orderCh.options).toHaveLength(3);
      const customOrder = [keepB.instanceId, blueOrb.instanceId, keepA.instanceId];
      mustPick(engine, customOrder);
      expect(engine.zoneMgr.getCardsInZone('p1', 'DECK').slice(-3).map((c) => c.instanceId)).toEqual(customOrder);
    }
  });
});

// ============================================================================
// 三、里·超刻 & 充能自体系 (BP03-023 ~ BP03-033)
// ============================================================================

describe('Stage 4D BP03 里·超刻 体系精确覆盖', () => {
  it('P1-6/P1-7/P1-8：充能 BP03-026/027/030 不误判【充能自】、BP03-027/033 chargeIsAbility、BP03-028 自选非攻击者双分支', () => {
    const engine = createEngine(
      buildDeck([
        'BP03-023',
        'BP03-026',
        'BP03-026',
        'BP03-027',
        'BP03-027',
        'BP03-028',
        'BP03-028',
        'BP03-029',
        'BP03-030',
        'BP03-033',
        'BP03-081',
        'BP03-087',
        'BP03-088',
      ]),
      buildDeck([])
    );
    const lee023 = placeRole(engine, 'p1', 'BP03-023', 0, { isReady: true });
    const lee029 = placeRole(engine, 'p1', 'BP03-029', 1, { isReady: false });
    const c26Top = findCard(engine, 'p1', 'BP03-026', 0);
    const c26Hand = findCard(engine, 'p1', 'BP03-026', 1);
    const c27Top = findCard(engine, 'p1', 'BP03-027', 0);
    const c27Field = findCard(engine, 'p1', 'BP03-027', 1);
    const c30Top = findCard(engine, 'p1', 'BP03-030');
    const c28a = findCard(engine, 'p1', 'BP03-028', 0);
    const c28b = findCard(engine, 'p1', 'BP03-028', 1);
    const c33 = findCard(engine, 'p1', 'BP03-033');
    const realOrb = findCard(engine, 'p1', 'BP03-081');
    const y1 = findCard(engine, 'p1', 'BP03-087');
    const y2 = findCard(engine, 'p1', 'BP03-088');
    const reserve = new Set([
      lee023.instanceId,
      lee029.instanceId,
      c26Top.instanceId,
      c26Hand.instanceId,
      c27Top.instanceId,
      c27Field.instanceId,
      c30Top.instanceId,
      c28a.instanceId,
      c28b.instanceId,
      c33.instanceId,
      realOrb.instanceId,
      y1.instanceId,
      y2.instanceId,
    ]);
    setupOpenCost(engine, 'p1', ['FIRE'], 6, reserve);

    // 1. P1-6：攻击充能 BP03-026 / BP03-027 / BP03-030 后，chargedAutoByLeeThisTurn 与 attackChargedHasChargeAuto 均为 false
    for (const nonChargeAutoCard of [c26Top, c27Top, c30Top]) {
      cardState(engine, lee023.instanceId).isReady = true;
      engine.zoneMgr.moveCardToTopOfDeck(nonChargeAutoCard.instanceId);
      putNonOrbOnTop(engine, 'p2');
      expect(
        engine.dispatchAction({
          type: 'DECLARE_ATTACK',
          playerId: 'p1',
          attackerCardId: lee023.instanceId,
          targetType: 'PLAYER',
        }).success
      ).toBe(true);
      passInstantWindows(engine);
      expect(engine.getState().currentCombat?.attackChargedHasChargeAuto).toBeFalsy();
      expect(engine.getState().players['p1']!.chargedAutoByLeeThisTurn).toBeFalsy();
      finishCombat(engine);
      expect(engine.getState().currentPendingChoice).toBeUndefined(); // BP03-023 不炸怪
    }
    // BP03-026 未减费，仅 4 费时打出必须失败；充能真正【充能自】信号球 BP03-081 后减为 4 费成功打出！
    setupOpenCost(engine, 'p1', ['FIRE'], 4, reserve);
    engine.zoneMgr.moveCard(c26Hand.instanceId, 'HAND', { isFaceUp: true });
    expect(
      engine.dispatchAction({ type: 'PLAY_CARD', playerId: 'p1', cardInstanceId: c26Hand.instanceId }).success
    ).toBe(false);

    cardState(engine, lee023.instanceId).isReady = true;
    engine.zoneMgr.moveCardToTopOfDeck(realOrb.instanceId);
    putNonOrbOnTop(engine, 'p2');
    expect(
      engine.dispatchAction({
        type: 'DECLARE_ATTACK',
        playerId: 'p1',
        attackerCardId: lee023.instanceId,
        targetType: 'PLAYER',
      }).success
    ).toBe(true);
    passInstantWindows(engine);
    mustPick(engine, ['opt_pp_plus_2000']);
    mustPick(engine, [lee023.instanceId]);
    expect(engine.getState().players['p1']!.chargedAutoByLeeThisTurn).toBe(true);
    finishCombat(engine);
    // 清掉 BP03-023 的本次战斗充能自弹出（可选跳过）
    if (engine.getState().currentPendingChoice) mustPick(engine, []);
    readyAllOpenCosts(engine, 'p1');
    mustPlay(engine, 'p1', c26Hand.instanceId, { targetSlotIndex: 4 });
    expect(cardState(engine, c26Hand.instanceId).zone).toBe('BATTLEFIELD');
    engine.fieldMgr.handleCardLeaveField(c26Hand.instanceId);
    engine.zoneMgr.moveCardToBottomOfDeck(c26Hand.instanceId);

    // 2. P1-7：BP03-033 与 BP03-027 chargeIsAbility: true（失能 / CANNOT_GAIN_ABILITIES 验证）
    setupOpenCost(engine, 'p1', ['FIRE'], 8, reserve);
    engine.zoneMgr.moveCard(c33.instanceId, 'HAND', { isFaceUp: true });
    mustPlay(engine, 'p1', c33.instanceId, { targetEquipRoleId: lee029.instanceId });
    expect(engine.combatMgr.calculateRoleChargeCount(lee029.instanceId)).toBe(2);
    addCardModifier(engine.getState(), cardState(engine, lee029.instanceId), { loseAbilities: true, untilTurn: 99, source: 'TEST' });
    expect(engine.combatMgr.calculateRoleChargeCount(lee029.instanceId)).toBe(1);
    cardState(engine, lee029.instanceId).modifiers = [];

    // BP03-027【出】翻到非【充能自】不能攻击玩家，翻到【充能自】可攻击玩家
    engine.zoneMgr.moveCardToTopOfDeck(c26Top.instanceId);
    engine.zoneMgr.moveCard(c27Field.instanceId, 'HAND', { isFaceUp: true });
    mustPlay(engine, 'p1', c27Field.instanceId, { targetSlotIndex: 2 });
    expect(engine.fieldMgr.evaluateRoleStats(c27Field.instanceId).canAttackPlayerOnEnterTurn).toBe(false);
    // 发动 BP03-027【起】弃1《里·超刻》获 chargeIsAbility +1
    engine.zoneMgr.moveCard(c30Top.instanceId, 'HAND', { isFaceUp: true });
    mustActivate(engine, 'p1', c27Field.instanceId, 0);
    mustPick(engine, [c30Top.instanceId]);
    expect(engine.combatMgr.calculateRoleChargeCount(c27Field.instanceId)).toBe(2);
    addCardModifier(engine.getState(), cardState(engine, c27Field.instanceId), { loseAbilities: true, untilTurn: 99, source: 'TEST' });
    expect(engine.combatMgr.calculateRoleChargeCount(c27Field.instanceId)).toBe(1);
    cardState(engine, c27Field.instanceId).modifiers = [];

    // 3. P1-8：BP03-028 场上有多张《里·超刻》时，可自选非攻击者给【速攻】或回合末竖直（两项全测）
    engine.zoneMgr.moveCard(y1.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    engine.zoneMgr.moveCard(y2.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    // 第1次攻击：lee023 攻击，充能 c28a -> 选 opt_quick，自选非攻击者 c27Field 给【速攻】
    cardState(engine, lee023.instanceId).isReady = true;
    engine.zoneMgr.moveCardToTopOfDeck(c28a.instanceId);
    putNonOrbOnTop(engine, 'p2');
    expect(
      engine.dispatchAction({
        type: 'DECLARE_ATTACK',
        playerId: 'p1',
        attackerCardId: lee023.instanceId,
        targetType: 'PLAYER',
      }).success
    ).toBe(true);
    passInstantWindows(engine);
    expect(engine.getState().currentPendingChoice?.effectType).toBe('BP03_028_CHARGE_AUTO');
    mustPick(engine, [y1.instanceId]);
    expect(engine.getState().currentPendingChoice?.effectType).toBe('BP03_028_PICK_MODE');
    mustPick(engine, ['opt_quick']);
    expect(engine.getState().currentPendingChoice?.effectType).toBe('BP03_028_PICK_ROLE');
    mustPick(engine, [c27Field.instanceId]); // 非攻击者 c27Field
    coveredCardNumbers.add('BP03-028');
    expect(engine.fieldMgr.evaluateRoleStats(c27Field.instanceId).keywords).toContain('速攻');
    finishCombat(engine);

    // 第2次攻击：lee029（充能2）攻击，充能 c28b -> 选 opt_untap，自选横置中的 lee023 注册回合末竖直
    cardState(engine, lee029.instanceId).isReady = true;
    putNonOrbOnTop(engine, 'p1', 2);
    engine.zoneMgr.moveCardToTopOfDeck(c28b.instanceId);
    putNonOrbOnTop(engine, 'p2');
    expect(
      engine.dispatchAction({
        type: 'DECLARE_ATTACK',
        playerId: 'p1',
        attackerCardId: lee029.instanceId,
        targetType: 'PLAYER',
      }).success
    ).toBe(true);
    mustPick(engine, []); // BP03-029 攻击不放牌组顶
    passInstantWindows(engine);
    expect(engine.getState().currentPendingChoice?.effectType).toBe('BP03_028_CHARGE_AUTO');
    mustPick(engine, [y2.instanceId]);
    mustPick(engine, ['opt_untap']);
    mustPick(engine, [lee023.instanceId]);
    finishCombat(engine);
    expect(cardState(engine, lee023.instanceId).isReady).toBe(false);
    endTurn(engine);
    expect(cardState(engine, lee023.instanceId).isReady).toBe(true);
  });

  it('P2-1/2 & P2-4：BP03-024 离场再出场不被误置底、BP03-023 多对象选择与拒绝、BP03-025/029 revealPickedToProcessing、BP03-030/032', () => {
    const engine = createEngine(
      buildDeck([
        'BP03-023',
        'BP03-024',
        'BP03-025',
        'BP03-029',
        'BP03-030',
        'BP03-031',
        'BP03-031',
        'BP03-032',
        'BP03-032',
        'BP01-037',
      ]),
      buildDeck(['ST02-003', 'ST02-005'])
    );
    const lee025 = placeRole(engine, 'p1', 'BP03-025', 0, { isReady: true });
    const lee031 = placeRole(engine, 'p1', 'BP03-031', 1, { isReady: true });
    const oppRole1 = placeRole(engine, 'p2', 'ST02-003', 0);
    const oppRole2 = placeRole(engine, 'p2', 'ST02-005', 1);

    const c24 = findCard(engine, 'p1', 'BP03-024');
    const c23 = findCard(engine, 'p1', 'BP03-023');
    const c30 = findCard(engine, 'p1', 'BP03-030');
    const c32a = findCard(engine, 'p1', 'BP03-032', 0);
    const c32b = findCard(engine, 'p1', 'BP03-032', 1);
    const hLee1 = findCard(engine, 'p1', 'BP03-029');
    const hLee2 = findCard(engine, 'p1', 'BP03-031', 1);
    const wsm = findCard(engine, 'p1', 'BP01-037');
    const reserve = new Set([
      c24.instanceId,
      c23.instanceId,
      c30.instanceId,
      c32a.instanceId,
      c32b.instanceId,
      hLee1.instanceId,
      hLee2.instanceId,
      wsm.instanceId,
    ]);
    setupOpenCost(engine, 'p1', ['FIRE'], 10, reserve);

    // 1. BP03-030【出】翻到 BP03-032(充能自) 获得 PP+1500
    engine.zoneMgr.moveCardToTopOfDeck(c32a.instanceId);
    engine.zoneMgr.moveCard(c30.instanceId, 'HAND', { isFaceUp: true });
    mustPlay(engine, 'p1', c30.instanceId, { targetSlotIndex: 2 });
    expect(engine.fieldMgr.calculateRoleEffectivePP(c30.instanceId)).toBe(4500);
    engine.fieldMgr.handleCardLeaveField(c30.instanceId);
    engine.zoneMgr.moveCardToBottomOfDeck(c30.instanceId);

    // 2. BP03-024【充能自】丢弃 3 张《里·超刻》从处理区出场并允许直接攻击；离场再出场不被误置底
    engine.zoneMgr.moveCard(c30.instanceId, 'HAND', { isFaceUp: true });
    engine.zoneMgr.moveCard(hLee1.instanceId, 'HAND', { isFaceUp: true });
    engine.zoneMgr.moveCard(hLee2.instanceId, 'HAND', { isFaceUp: true });
    engine.zoneMgr.moveCardToTopOfDeck(c24.instanceId);
    putNonOrbOnTop(engine, 'p2');
    expect(
      engine.dispatchAction({
        type: 'DECLARE_ATTACK',
        playerId: 'p1',
        attackerCardId: lee025.instanceId,
        targetType: 'PLAYER',
      }).success
    ).toBe(true);
    mustPick(engine, ['opt_no']); // BP03-025 不看顶
    passToCharge(engine);
    expect(engine.getState().currentPendingChoice?.effectType).toBe('BP03_024_CHARGE_DEPLOY');
    mustPick(engine, [c30.instanceId, hLee1.instanceId, hLee2.instanceId]);
    coveredCardNumbers.add('BP03-024');
    expect(cardState(engine, c24.instanceId).zone).toBe('BATTLEFIELD');
    expect(engine.fieldMgr.evaluateRoleStats(c24.instanceId).canAttackPlayerOnEnterTurn).toBe(true);
    finishCombat(engine);

    // 模拟 c24 离场并从手牌重新出场（enteredZoneTimestamp 改变），回合末不应被旧 delayedTrigger 置底
    engine.fieldMgr.handleCardLeaveField(c24.instanceId);
    engine.zoneMgr.moveCard(c24.instanceId, 'HAND', { isFaceUp: true });
    expect(engine.fieldMgr.playRoleCard('p1', c24.instanceId, 2)).toBe(true);
    endTurn(engine);
    expect(cardState(engine, c24.instanceId).zone).toBe('BATTLEFIELD');
    advanceTurnTo(engine, 'p1');
    engine.fieldMgr.handleCardLeaveField(c24.instanceId);
    engine.zoneMgr.moveCardToBottomOfDeck(c24.instanceId);

    // 再测未离场的 BP03-024【充能自】出场并在回合末正常置入牌组底
    readyAllOpenCosts(engine, 'p1');
    engine.zoneMgr.moveCard(c30.instanceId, 'HAND', { isFaceUp: true });
    engine.zoneMgr.moveCard(hLee1.instanceId, 'HAND', { isFaceUp: true });
    engine.zoneMgr.moveCard(hLee2.instanceId, 'HAND', { isFaceUp: true });
    cardState(engine, lee025.instanceId).isReady = true;
    engine.zoneMgr.moveCardToTopOfDeck(c24.instanceId);
    putNonOrbOnTop(engine, 'p2');
    expect(
      engine.dispatchAction({
        type: 'DECLARE_ATTACK',
        playerId: 'p1',
        attackerCardId: lee025.instanceId,
        targetType: 'PLAYER',
      }).success
    ).toBe(true);
    mustPick(engine, ['opt_no']);
    passToCharge(engine);
    mustPick(engine, [c30.instanceId, hLee1.instanceId, hLee2.instanceId]);
    finishCombat(engine);
    endTurn(engine);
    expect(cardState(engine, c24.instanceId).zone).toBe('DECK');
    advanceTurnTo(engine, 'p1');

    // 3. BP03-023【充能自】多个《里·超刻》在场时先选 opt_no 放弃；再下一次攻击选 opt_yes 并自选 BP03_023_CHOOSE_ASCEND_TARGET
    readyAllOpenCosts(engine, 'p1');
    cardState(engine, lee031.instanceId).isReady = true;
    engine.zoneMgr.moveCardToTopOfDeck(c23.instanceId);
    putNonOrbOnTop(engine, 'p2');
    expect(
      engine.dispatchAction({
        type: 'DECLARE_ATTACK',
        playerId: 'p1',
        attackerCardId: lee031.instanceId,
        targetType: 'PLAYER',
      }).success
    ).toBe(true);
    passToCharge(engine);
    expect(engine.getState().currentPendingChoice?.effectType).toBe('BP03_023_CHARGE_ASCEND');
    mustPick(engine, ['opt_no']);
    finishCombat(engine);
    expect(cardState(engine, c23.instanceId).zone).toBe('HAND');

    // 再次用 lee025 攻击充能 c23 选 opt_yes，触发 BP03_023_CHOOSE_ASCEND_TARGET 选 lee031
    cardState(engine, lee025.instanceId).isReady = true;
    engine.zoneMgr.moveCardToTopOfDeck(c23.instanceId);
    putNonOrbOnTop(engine, 'p2');
    expect(
      engine.dispatchAction({
        type: 'DECLARE_ATTACK',
        playerId: 'p1',
        attackerCardId: lee025.instanceId,
        targetType: 'PLAYER',
      }).success
    ).toBe(true);
    mustPick(engine, ['opt_no']);
    passToCharge(engine);
    mustPick(engine, ['opt_yes']);
    expect(engine.getState().currentPendingChoice?.effectType).toBe('BP03_023_CHOOSE_ASCEND_TARGET');
    mustPick(engine, [lee031.instanceId]);
    expect(cardState(engine, c23.instanceId).zone).toBe('BATTLEFIELD');
    finishCombat(engine);

    // 4. BP03-032【充能自】付3费弹对方角色回牌组底 & 作为战术牌从手牌打出弹回另一角色
    engine.fieldMgr.handleCardLeaveField(lee025.instanceId);
    engine.zoneMgr.moveCardToBottomOfDeck(lee025.instanceId);
    readyAllOpenCosts(engine, 'p1');
    cardState(engine, c23.instanceId).isReady = true;
    engine.zoneMgr.moveCardToTopOfDeck(c32a.instanceId);
    putNonOrbOnTop(engine, 'p2');
    expect(
      engine.dispatchAction({
        type: 'DECLARE_ATTACK',
        playerId: 'p1',
        attackerCardId: c23.instanceId,
        targetType: 'PLAYER',
      }).success
    ).toBe(true);
    passToCharge(engine);
    expect(engine.getState().currentPendingChoice?.effectType).toBe('BP03_032_CHARGE_BOUNCE_BOTTOM');
    mustPick(engine, [oppRole1.instanceId]);
    expect(cardState(engine, oppRole1.instanceId).zone).toBe('DECK');
    finishCombat(engine);

    // 战术主体：只存在《里·超刻》时从手牌打出 BP03-032#1 弹 oppRole2 回牌组底
    readyAllOpenCosts(engine, 'p1');
    engine.zoneMgr.moveCard(c32b.instanceId, 'HAND', { isFaceUp: true });
    mustPlay(engine, 'p1', c32b.instanceId);
    mustPick(engine, [oppRole2.instanceId]);
    expect(cardState(engine, oppRole2.instanceId).zone).toBe('DECK');

    // 5. P2-4 BP03-025/029 revealPickedToProcessing + 脱敏校验
    // 准备 BP01-037 在手牌（带万世铭特征）不影响选《里·超刻》置顶，而选《里·超刻》时会经过 PROCESSING 再置顶
    engine.fieldMgr.handleCardLeaveField(c23.instanceId);
    engine.zoneMgr.moveCardToBottomOfDeck(c23.instanceId);
    engine.zoneMgr.moveCard(hLee1.instanceId, 'HAND', { isFaceUp: true });
    engine.zoneMgr.moveCard(hLee2.instanceId, 'HAND', { isFaceUp: true });
    engine.zoneMgr.moveCard(lee025.instanceId, 'HAND', { isFaceUp: true });
    readyAllOpenCosts(engine, 'p1');
    const evBefore = engine.events.length;
    mustPlay(engine, 'p1', lee025.instanceId, { targetSlotIndex: 0 });
    expect(engine.getState().currentPendingChoice?.effectType).toBe('DSL_BP03-025_HAND_TO_TOP');
    mustPick(engine, [hLee2.instanceId]);
    expect(engine.zoneMgr.getCardsInZone('p1', 'DECK')[0]!.instanceId).toBe(hLee2.instanceId);
    expect(
      engine.events
        .slice(evBefore)
        .some((e) => e.type === 'CARD_MOVED' && e.cardInstanceId === hLee2.instanceId && e.toZone === 'PROCESSING')
    ).toBe(true);

    // 脱敏校验：p2 看不到 p1 手牌和牌组顺序
    const sanitized = sanitizeGameStateForPlayer(engine.getState(), 'p2');
    expect(Object.values(sanitized.publicCards).some((c) => c.controllerPlayerId === 'p1' && c.zone === 'HAND')).toBe(
      false
    );
    expect(sanitized.opponentHandCount).toBe(engine.zoneMgr.getCardsInZone('p1', 'HAND').length);

    // BP03-029 攻击触发 revealPickedToProcessing（放 1 个 p2 竖直角色阻挡暂停，先校验 DECK[0] 再结束战斗）
    const oppBlocker29 = placeRole(engine, 'p2', 'ST02-003', 0, { isReady: true });
    cardState(engine, lee025.instanceId).turnEnteredZone = 0;
    engine.zoneMgr.moveCard(hLee1.instanceId, 'HAND', { isFaceUp: true });
    expect(engine.fieldMgr.playRoleCard('p1', hLee1.instanceId, 1)).toBe(true);
    hLee1.turnEnteredZone = 0;
    const hLeeExtra = findCard(engine, 'p1', 'BP03-030');
    engine.zoneMgr.moveCard(hLeeExtra.instanceId, 'HAND', { isFaceUp: true });
    const evBefore29 = engine.events.length;
    putNonOrbOnTop(engine, 'p1');
    putNonOrbOnTop(engine, 'p2');
    expect(
      engine.dispatchAction({
        type: 'DECLARE_ATTACK',
        playerId: 'p1',
        attackerCardId: hLee1.instanceId,
        targetType: 'PLAYER',
      }).success
    ).toBe(true);
    expect(engine.getState().currentPendingChoice?.effectType).toBe('DSL_BP03-029_HAND_TO_TOP');
    mustPick(engine, [hLeeExtra.instanceId]);
    expect(engine.zoneMgr.getCardsInZone('p1', 'DECK')[0]!.instanceId).toBe(hLeeExtra.instanceId);
    expect(
      engine.events
        .slice(evBefore29)
        .some((e) => e.type === 'CARD_MOVED' && e.cardInstanceId === hLeeExtra.instanceId && e.toZone === 'PROCESSING')
    ).toBe(true);
    finishCombat(engine);
    engine.fieldMgr.handleCardLeaveField(oppBlocker29.instanceId);
    engine.zoneMgr.moveCardToBottomOfDeck(oppBlocker29.instanceId);
  });
});

// ============================================================================
// 四、罗塞塔·凛冽 体系 (BP03-034 ~ BP03-044)
// ============================================================================

describe('Stage 4D BP03 罗塞塔·凛冽 体系精确覆盖', () => {
  it('P1-9 BP03-042 垫牌后 EQUIP_ITEM 装备到角色时原下方牌清理送墓 (Q&A·6) & 全体系正反分支', () => {
    const engine = createEngine(
      buildDeck([
        'BP03-034',
        'BP03-034',
        'BP03-035',
        'BP03-036',
        'BP03-037',
        'BP03-038',
        'BP03-039',
        'BP03-040',
        'BP03-041',
        'BP03-042',
        'BP03-043',
        'BP03-044',
        'BP03-081',
        'BP03-082',
      ]),
      buildDeck(['ST02-001', 'ST02-005'])
    );
    const gungnir = findCard(engine, 'p1', 'BP03-042');
    const r034a = findCard(engine, 'p1', 'BP03-034', 0);
    const r034b = findCard(engine, 'p1', 'BP03-034', 1);
    const r035 = findCard(engine, 'p1', 'BP03-035');
    const r036 = findCard(engine, 'p1', 'BP03-036');
    const r038 = findCard(engine, 'p1', 'BP03-038');
    const r039 = findCard(engine, 'p1', 'BP03-039');
    const r040 = findCard(engine, 'p1', 'BP03-040');
    const s043 = findCard(engine, 'p1', 'BP03-043');
    const s044 = findCard(engine, 'p1', 'BP03-044');
    const padPhy = findCard(engine, 'p1', 'ST01-006');
    const o1 = findCard(engine, 'p1', 'BP03-081');
    const o2 = findCard(engine, 'p1', 'BP03-082');
    const reserve = new Set([
      gungnir.instanceId,
      r034a.instanceId,
      r034b.instanceId,
      r035.instanceId,
      r036.instanceId,
      r038.instanceId,
      r039.instanceId,
      r040.instanceId,
      s043.instanceId,
      s044.instanceId,
      padPhy.instanceId,
      o1.instanceId,
      o2.instanceId,
    ]);
    setupOpenCost(engine, 'p1', ['PHYSICAL'], 10, reserve);

    // 1. 先测试 BP03-038 / BP03-039 / BP03-040 的非第3张反例，以及 BP03-035 出场+回合末只存在罗塞塔PP+1000
    // 第1张：r038 -> 非第3张不获突进也不+1500PP
    engine.zoneMgr.moveCard(r038.instanceId, 'HAND', { isFaceUp: true });
    mustPlay(engine, 'p1', r038.instanceId, { targetSlotIndex: 0 });
    expect(engine.fieldMgr.evaluateRoleStats(r038.instanceId).keywords).not.toContain('突进');
    expect(engine.fieldMgr.calculateRoleEffectivePP(r038.instanceId)).toBe(4000);

    // 第2张：r040 -> 攻击时计数!=3不触发+1000/+1DP
    engine.zoneMgr.moveCard(r040.instanceId, 'HAND', { isFaceUp: true });
    mustPlay(engine, 'p1', r040.instanceId, { targetSlotIndex: 1 });
    cardState(engine, r040.instanceId).turnEnteredZone = 0;
    putNonOrbOnTop(engine, 'p1');
    putNonOrbOnTop(engine, 'p2');
    expect(
      engine.dispatchAction({
        type: 'DECLARE_ATTACK',
        playerId: 'p1',
        attackerCardId: r040.instanceId,
        targetType: 'PLAYER',
      }).success
    ).toBe(true);
    finishCombat(engine);
    expect(engine.fieldMgr.calculateRoleEffectivePP(r040.instanceId)).toBe(2500);
    expect(engine.fieldMgr.calculateRoleEffectiveDP(r040.instanceId)).toBe(0);

    // 回合结束时：先打出 BP03-035 抽1且选+1计数(变4)，再打出 BP03-039(变5 != 3) 验证其回合结束不抽牌，而 BP03-035 只存在罗塞塔时 PP+1000
    readyAllOpenCosts(engine, 'p1');
    engine.zoneMgr.moveCard(r035.instanceId, 'HAND', { isFaceUp: true });
    mustPlay(engine, 'p1', r035.instanceId, { targetSlotIndex: 3 });
    mustPick(engine, ['opt_yes']);
    engine.zoneMgr.moveCard(r039.instanceId, 'HAND', { isFaceUp: true });
    mustPlay(engine, 'p1', r039.instanceId, { targetSlotIndex: 2 });
    expect(engine.combatMgr.calculateRoleChargeCount(r039.instanceId)).toBe(0);
    const handBeforeEnd = engine.zoneMgr.getCardsInZone('p1', 'HAND').length;
    endTurn(engine);
    expect(engine.zoneMgr.getCardsInZone('p1', 'HAND')).toHaveLength(handBeforeEnd);
    expect(engine.fieldMgr.calculateRoleEffectivePP(r035.instanceId)).toBe(6000);

    // 2. 回到我方回合，测 BP03-034 (1张垫牌 / 2张减费 / 3张消2球弹回) 与 BP03-042 垫牌后 EQUIP_ITEM 清理送墓
    advanceTurnTo(engine, 'p1');
    for (const r of [r038, r040, r039, r035]) {
      engine.fieldMgr.handleCardLeaveField(r.instanceId);
      engine.zoneMgr.moveCardToBottomOfDeck(r.instanceId);
    }
    readyAllOpenCosts(engine, 'p1');
    expect(engine.fieldMgr.playStandaloneEquipment('p1', gungnir.instanceId, 0)).toBe(true);

    // 第1张：r034a -> 选 gungnir 并垫 padPhy 至下方
    engine.zoneMgr.moveCard(padPhy.instanceId, 'HAND', { isFaceUp: true });
    engine.zoneMgr.moveCard(r034a.instanceId, 'HAND', { isFaceUp: true });
    mustPlay(engine, 'p1', r034a.instanceId, { targetSlotIndex: 1 });
    mustPick(engine, [gungnir.instanceId]);
    mustPick(engine, [padPhy.instanceId]);
    expect(cardState(engine, gungnir.instanceId).underneathCardIds).toContain(padPhy.instanceId);
    expect(engine.fieldMgr.evaluateRoleStats(r034a.instanceId).keywords).toContain('速攻'); // 只存在罗塞塔

    // P1-9 验证：以 EQUIP_ITEM 把 gungnir 装备到 r034a 上，原下方 padPhy 必须清理置入墓地 (Q&A·6) 且不误发 CARD_LEFT_FIELD (8.13.4.a.2)
    const emitSpy = vi.spyOn(engine.triggerMgr, 'emit');
    const equipRes = engine.dispatchAction({
      type: 'EQUIP_ITEM',
      playerId: 'p1',
      equipmentCardId: gungnir.instanceId,
      targetRoleCardId: r034a.instanceId,
    });
    const padLeftCalls = emitSpy.mock.calls.filter(
      ([ev]) =>
        (ev.type === 'CARD_LEFT_FIELD' || ev.type === 'CARD_SENT_FIELD_TO_GY_BY_EFFECT') &&
        ev.cardInstanceId === padPhy.instanceId
    );
    emitSpy.mockRestore();
    expect(padLeftCalls).toHaveLength(0);
    expect(equipRes.success, equipRes.error).toBe(true);
    expect(getAttachedEquipmentIds(cardState(engine, r034a.instanceId))).toContain(gungnir.instanceId);
    expect(cardState(engine, gungnir.instanceId).underneathCardIds).toHaveLength(0);
    expect(cardState(engine, padPhy.instanceId).zone).toBe('GRAVEYARD');

    // 第2张：r034b (cardsPlayedThisTurn = 2) -> 下 1 张《罗塞塔·凛冽》费用 -4；第3张：BP03-036 (5 - 4 - 2 = 0 费！)
    engine.zoneMgr.moveCard(r034b.instanceId, 'HAND', { isFaceUp: true });
    readyAllOpenCosts(engine, 'p1');
    mustPlay(engine, 'p1', r034b.instanceId, { targetSlotIndex: 2 });
    expect(engine.getState().players['p1']!.cardsPlayedThisTurn).toBe(2);
    for (const c of engine.zoneMgr.getCardsInZone('p1', 'COST')) c.isReady = false;
    engine.zoneMgr.syncCostStats('p1');
    engine.zoneMgr.moveCard(r036.instanceId, 'HAND', { isFaceUp: true });
    mustPlay(engine, 'p1', r036.instanceId, { targetSlotIndex: 3 });
    expect(cardState(engine, r036.instanceId).zone).toBe('BATTLEFIELD');

    // r039 在回合结束 cardsPlayedThisTurn == 3 时抽 1 张牌（保持手牌 <= 5 避免触发回合末7张上限弃牌）
    engine.zoneMgr.moveCard(r039.instanceId, 'HAND', { isFaceUp: true });
    expect(engine.fieldMgr.playRoleCard('p1', r039.instanceId, 4)).toBe(true);
    const keepHandIds = new Set([r034a.instanceId, r034b.instanceId, r036.instanceId, r039.instanceId]);
    for (const h of engine.zoneMgr.getCardsInZone('p1', 'HAND')) {
      if (engine.zoneMgr.getCardsInZone('p1', 'HAND').length <= 5) break;
      if (!keepHandIds.has(h.instanceId) && !h.cardNumber.startsWith('BP03-0')) {
        engine.zoneMgr.moveCardToBottomOfDeck(h.instanceId);
      }
    }
    while (engine.zoneMgr.getCardsInZone('p1', 'HAND').length > 5) {
      const drop = engine.zoneMgr.getCardsInZone('p1', 'HAND')[0]!;
      engine.zoneMgr.moveCardToBottomOfDeck(drop.instanceId);
    }
    const handEnd39 = engine.zoneMgr.getCardsInZone('p1', 'HAND').length;
    endTurn(engine);
    expect(engine.zoneMgr.getCardsInZone('p1', 'HAND')).toHaveLength(handEnd39 + 1);

    // 下一回合测 BP03-041 + BP03-042 垫物理牌 & 清下方全破横置 + BP03-038 第3张突进1500PP + BP03-040 第3张攻击+1000/+1DP + BP03-034 第3张消球弹回 + BP03-043/044
    advanceTurnTo(engine, 'p1');
    for (const r of [r034a, r034b, r036, r039]) {
      engine.fieldMgr.handleCardLeaveField(r.instanceId);
      engine.zoneMgr.moveCardToBottomOfDeck(r.instanceId);
    }
    const gungnir2 = findCard(engine, 'p1', 'BP03-042');
    engine.zoneMgr.moveCard(gungnir2.instanceId, 'HAND', { isFaceUp: true });
    expect(engine.fieldMgr.playStandaloneEquipment('p1', gungnir2.instanceId, 0)).toBe(true);
    const r041 = findCard(engine, 'p1', 'BP03-041');
    engine.zoneMgr.moveCard(r041.instanceId, 'HAND', { isFaceUp: true });
    readyAllOpenCosts(engine, 'p1');
    // 第1张：r041 并视为增加 1 张 -> 计数变 2
    mustPlay(engine, 'p1', r041.instanceId, { targetSlotIndex: 1 });
    mustPick(engine, ['opt_yes']);
    expect(engine.getState().players['p1']!.cardsPlayedThisTurn).toBe(2);

    // 第2张：BP03-043 弹回 oppTarget；若无罗塞塔先测不弹回，这里有 r041 在场 -> 弹回！
    const oppTarget = placeRole(engine, 'p2', 'ST02-001', 0, { isReady: false });
    const oppReady2 = placeRole(engine, 'p2', 'ST02-005', 1, { isReady: true });
    engine.zoneMgr.moveCard(s043.instanceId, 'HAND', { isFaceUp: true });
    // 把计数设为 2 测 BP03-043 作为第 3 张减 1 费 (4-1=3)
    setupOpenCost(engine, 'p1', ['PHYSICAL'], 3, reserve);
    mustPlay(engine, 'p1', s043.instanceId);
    mustPick(engine, [oppTarget.instanceId]);
    expect(cardState(engine, oppTarget.instanceId).zone).toBe('HAND');
    expect(engine.getState().players['p1']!.cardsPlayedThisTurn).toBe(3);

    // 计数为 3 时：先放 r040 攻击触发 +1000PP/+1DP，再用 BP03-042 第1项垫物理牌至下方、补足3张后第2项消2同色全破横置，再用 BP03-044 竖直
    engine.zoneMgr.moveCard(r040.instanceId, 'HAND', { isFaceUp: true });
    expect(engine.fieldMgr.playRoleCard('p1', r040.instanceId, 2)).toBe(true);
    r040.turnEnteredZone = 0;
    putNonOrbOnTop(engine, 'p1');
    putNonOrbOnTop(engine, 'p2');
    expect(
      engine.dispatchAction({
        type: 'DECLARE_ATTACK',
        playerId: 'p1',
        attackerCardId: r040.instanceId,
        targetType: 'PLAYER',
      }).success
    ).toBe(true);
    finishCombat(engine);
    expect(engine.fieldMgr.calculateRoleEffectivePP(r040.instanceId)).toBe(3500);
    expect(engine.fieldMgr.calculateRoleEffectiveDP(r040.instanceId)).toBe(1);

    // 清理 r041 保持只存在《罗塞塔·凛冽》测 BP03-042 第1项与第2项
    engine.fieldMgr.handleCardLeaveField(r041.instanceId);
    engine.zoneMgr.moveCardToBottomOfDeck(r041.instanceId);
    const matA = findCard(engine, 'p1', 'ST01-006');
    const matB = findCard(engine, 'p1', 'BP03-035');
    const matC = findCard(engine, 'p1', 'BP03-037');
    engine.zoneMgr.moveCard(matA.instanceId, 'HAND', { isFaceUp: true });
    mustActivate(engine, 'p1', gungnir2.instanceId, 0);
    mustPick(engine, ['put_physical_underneath']);
    mustPick(engine, [matA.instanceId]);
    expect(cardState(engine, gungnir2.instanceId).underneathCardIds).toContain(matA.instanceId);

    // 补足 3 张下方牌 + 2 同色红球，测 BP03-042 第2项全破横置 (oppTapped 进墓，oppReady2 保留)
    const oppTapped = placeRole(engine, 'p2', 'ST02-001', 0, { isReady: false });
    engine.getState().players['p1']!.turnAbilityUsage = {};
    engine.zoneMgr.moveCard(matB.instanceId, 'HAND', { isFaceUp: true });
    engine.zoneMgr.moveCard(matC.instanceId, 'HAND', { isFaceUp: true });
    engine.fieldMgr.placeCardUnderneath(matB.instanceId, gungnir2.instanceId);
    engine.fieldMgr.placeCardUnderneath(matC.instanceId, gungnir2.instanceId);
    engine.zoneMgr.moveCard(o1.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    engine.zoneMgr.moveCard(o2.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    mustActivate(engine, 'p1', gungnir2.instanceId, 0);
    mustPick(engine, ['clear_underneath_wipe']);
    mustPick(engine, [engine.getState().currentPendingChoice!.options.find((o) => o.id !== 'skip')!.id]);
    expect(cardState(engine, gungnir2.instanceId).underneathCardIds).toHaveLength(0);
    expect(cardState(engine, oppTapped.instanceId).zone).toBe('GRAVEYARD');
    expect(cardState(engine, oppReady2.instanceId).zone).toBe('BATTLEFIELD');

    // 下一回合测 BP03-038 第3张获得突进+1500PP、BP03-034 第3张消2球弹回 oppReady2、BP03-044 第3张竖直横置角色
    advanceTurnTo(engine, 'p2');
    advanceTurnTo(engine, 'p1');
    setupOpenCost(engine, 'p1', ['PHYSICAL'], 10, reserve);
    engine.zoneMgr.moveCard(o1.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    engine.zoneMgr.moveCard(o2.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    engine.getState().players['p1']!.cardsPlayedThisTurn = 2;
    engine.zoneMgr.moveCard(r038.instanceId, 'HAND', { isFaceUp: true });
    mustPlay(engine, 'p1', r038.instanceId, { targetSlotIndex: 1 });
    expect(engine.fieldMgr.evaluateRoleStats(r038.instanceId).keywords).toContain('突进');
    expect(engine.fieldMgr.calculateRoleEffectivePP(r038.instanceId)).toBe(5500);

    engine.getState().players['p1']!.cardsPlayedThisTurn = 2;
    engine.zoneMgr.moveCard(r034b.instanceId, 'HAND', { isFaceUp: true });
    mustPlay(engine, 'p1', r034b.instanceId, { targetSlotIndex: 3 });
    mustPick(engine, [engine.getState().currentPendingChoice!.options.find((o) => o.id !== 'skip')!.id]);
    mustPick(engine, [oppReady2.instanceId]);
    expect(cardState(engine, oppReady2.instanceId).zone).toBe('HAND');

    cardState(engine, r040.instanceId).isReady = false;
    readyAllOpenCosts(engine, 'p1');
    engine.getState().players['p1']!.cardsPlayedThisTurn = 2;
    engine.zoneMgr.moveCard(s044.instanceId, 'HAND', { isFaceUp: true });
    mustPlay(engine, 'p1', s044.instanceId);
    mustPick(engine, ['ready_rosetta']);
    mustPick(engine, [r040.instanceId]);
    expect(cardState(engine, r040.instanceId).isReady).toBe(true);
  });
});

// ============================================================================
// 五、艾拉·万华 & 艺术协会 体系 (BP03-045 ~ BP03-055, BP03-071 ~ BP03-074)
// ============================================================================

describe('Stage 4D BP03 艾拉·万华 & 艺术协会 体系精确覆盖', () => {
  it('P1-10/P2-3/P2-5：BP03-045/046 excludeCoreCardNumbers、046 3条能力、048/049/050/051/053/054/055、071/073/074', () => {
    const engine = createEngine(
      buildDeck([
        'BP03-045',
        'BP03-046',
        'BP03-046',
        'BP03-047',
        'BP03-048',
        'BP03-049',
        'BP03-050',
        'BP03-051',
        'BP03-052',
        'BP03-053',
        'BP03-054',
        'BP03-055',
        'BP03-071',
        'BP03-073',
        'BP03-074',
        'BP03-074',
        'BP03-077',
        'BP03-081',
        'BP03-082',
        'BP03-087',
        'BP01-037',
      ]),
      buildDeck(['ST02-003', 'ST02-004'])
    );
    // 1. P2-5：BP03-046 费用区 >= 7 张《艾拉·万华》时，无法弹同卡号 BP03-046，可弹不同卡号 BP03-045
    const aylaNums = ['BP03-045', 'BP03-046', 'BP03-047', 'BP03-048', 'BP03-049', 'BP03-050', 'BP03-052'];
    for (const num of aylaNums) {
      engine.zoneMgr.moveCard(findCard(engine, 'p1', num, 0).instanceId, 'COST', { isFaceUp: true, isReady: true });
    }
    engine.zoneMgr.syncCostStats('p1');
    const c046InCost = findCard(engine, 'p1', 'BP03-046', 0);
    const c046OnField = placeRole(engine, 'p1', 'BP03-046', 0, { instanceIndex: 1 });
    // 场上只有同卡号 BP03-046#1 -> 无法替换
    mustActivate(engine, 'p1', c046InCost.instanceId, 0);
    expect(cardState(engine, c046InCost.instanceId).zone).toBe('COST');
    expect(cardState(engine, c046OnField.instanceId).zone).toBe('BATTLEFIELD');

    // 换放不同卡号 BP03-045#0 上场后再由费用区 BP03-046#0 替换出场
    readyAllOpenCosts(engine, 'p1');
    const c045 = placeRole(engine, 'p1', 'BP03-045', 1);
    engine.zoneMgr.moveCard(findCard(engine, 'p1', 'BP03-051').instanceId, 'COST', { isFaceUp: true, isReady: true });
    engine.zoneMgr.syncCostStats('p1');
    // 让 BP03-045 在对方2个角色时攻击获【贯通】
    const oppA = placeRole(engine, 'p2', 'ST02-003', 0, { isReady: true });
    const oppB = placeRole(engine, 'p2', 'ST02-004', 1, { isReady: true }); // cost 2 <= 3
    // 现在 p1 2 角色，放1个让 p2 3 角色 -> 2 < 3 获【贯通】
    placeRole(engine, 'p2', 'ST02-005', 2, { isReady: true });
    cardState(engine, c045.instanceId).turnEnteredZone = 0;
    putNonOrbOnTop(engine, 'p1');
    putNonOrbOnTop(engine, 'p2');
    expect(
      engine.dispatchAction({
        type: 'DECLARE_ATTACK',
        playerId: 'p1',
        attackerCardId: c045.instanceId,
        targetType: 'PLAYER',
      }).success
    ).toBe(true);
    expect(engine.fieldMgr.evaluateRoleStats(c045.instanceId).keywords).toContain('贯通');
    finishCombat(engine);

    // 费用区 c046InCost 替换 c045 出场
    readyAllOpenCosts(engine, 'p1');
    mustActivate(engine, 'p1', c046InCost.instanceId, 0);
    expect(engine.getState().currentPendingChoice?.options.map((o) => o.id)).toEqual([c045.instanceId]);
    mustPick(engine, [c045.instanceId]);
    expect(cardState(engine, c045.instanceId).zone).toBe('DECK');
    expect(cardState(engine, c046InCost.instanceId).zone).toBe('BATTLEFIELD');

    // 2. P1-10：BP03-051 & BP03-053 PEEK_TOP 不进 PROCESSING (放 BP01-037 在顶也不触发万世铭弹窗！) + 暗费可回手 + >=threshold 可选
    // 先清理 COST 仅留 BP03-052，随后再补足 4 张基础费以便从干净状态测起
    for (const c of engine.zoneMgr.getCardsInZone('p1', 'COST')) {
      if (c.cardNumber !== 'BP03-052') engine.zoneMgr.moveCardToBottomOfDeck(c.instanceId);
    }
    const c51 = findCard(engine, 'p1', 'BP03-051');
    const c53 = findCard(engine, 'p1', 'BP03-053');
    const wsmTop = findCard(engine, 'p1', 'BP01-037');
    const ice1 = findCard(engine, 'p1', 'BP03-047');
    const ice2 = findCard(engine, 'p1', 'BP03-048');
    const hiddenCostCard = findCard(engine, 'p1', 'ST01-006');
    const reserve = new Set([
      c51.instanceId,
      c53.instanceId,
      wsmTop.instanceId,
      ice1.instanceId,
      ice2.instanceId,
      hiddenCostCard.instanceId,
    ]);
    setupOpenCost(engine, 'p1', ['ICE'], 4, reserve);
    engine.zoneMgr.moveCard(hiddenCostCard.instanceId, 'COST', { isFaceUp: false, isReady: true });
    engine.zoneMgr.syncCostStats('p1');

    // BP03-053 (<5 张艾拉在费用区 -> minSelections=1，可回收暗费且顶1张 wsmTop 不触发 PROCESSING)
    engine.zoneMgr.moveCardToTopOfDeck(wsmTop.instanceId);
    engine.zoneMgr.moveCard(ice1.instanceId, 'HAND', { isFaceUp: true });
    engine.zoneMgr.moveCard(c53.instanceId, 'HAND', { isFaceUp: true });
    const evBefore53 = engine.events.length;
    mustPlay(engine, 'p1', c53.instanceId, { targetSlotIndex: 2 });
    expect(engine.combatMgr.calculateRoleChargeCount(c53.instanceId)).toBe(0);
    expect(engine.getState().currentPendingChoice?.effectType).toBe('DSL_BP03-053_DISCARD');
    mustPick(engine, [ice1.instanceId]);
    // 直接弹出 DSL_BP03-053_SALVAGE_REQ (无 BP01_WANSHIMING_REVEAL_TO_COST！)
    expect(engine.getState().currentPendingChoice?.effectType).toBe('DSL_BP03-053_SALVAGE_REQ');
    expect(engine.getState().currentPendingChoice!.minSelections).toBe(1);
    expect(engine.getState().currentPendingChoice!.options.map((o) => o.id)).toContain(hiddenCostCard.instanceId);
    mustPick(engine, [hiddenCostCard.instanceId]);
    expect(cardState(engine, hiddenCostCard.instanceId).zone).toBe('HAND');
    expect(cardState(engine, wsmTop.instanceId).zone).toBe('COST');
    expect(cardState(engine, wsmTop.instanceId).isReady).toBe(false);
    expect(
      engine.events.slice(evBefore53).some((e) => e.type === 'CARD_MOVED' && e.toZone === 'PROCESSING')
    ).toBe(false);

    // 清空多余费用后放入 7 张《艾拉·万华》(045/046/047/048/049/050/053) + BP03-052 共 8 张 (验证 BP03-052 扩展至 11 张)
    engine.fieldMgr.handleCardLeaveField(c53.instanceId);
    for (const c of engine.zoneMgr.getCardsInZone('p1', 'COST')) {
      engine.zoneMgr.moveCardToBottomOfDeck(c.instanceId);
    }
    for (const num of ['BP03-045', 'BP03-046', 'BP03-047', 'BP03-048', 'BP03-049', 'BP03-050', 'BP03-053', 'BP03-052']) {
      const idx = num === 'BP03-046' ? 1 : 0; // 保留战场的 c046InCost (BP03-046#0)，放入 #1 凑7张艾拉
      engine.zoneMgr.moveCard(findCard(engine, 'p1', num, idx).instanceId, 'COST', { isFaceUp: true, isReady: true });
    }
    engine.zoneMgr.syncCostStats('p1');
    expect(engine.zoneMgr.getMaxCostZoneCapacity('p1')).toBe(11);
    expect(engine.zoneMgr.getCardsInZone('p1', 'COST')).toHaveLength(8);

    // BP03-051 (>=7费上限 -> 【突进】PP+1000；6张及以上艾拉验证 minSelections=0，且 wsmTop 落入费用区第8张不进处理区)
    engine.zoneMgr.moveCardToTopOfDeck(wsmTop.instanceId);
    engine.zoneMgr.moveCard(ice2.instanceId, 'HAND', { isFaceUp: true });
    engine.zoneMgr.moveCard(c51.instanceId, 'HAND', { isFaceUp: true });
    const evBefore51 = engine.events.length;
    mustPlay(engine, 'p1', c51.instanceId, { targetSlotIndex: 3 });
    mustPick(engine, [ice2.instanceId]);
    expect(engine.getState().currentPendingChoice?.effectType).toBe('DSL_BP03-051_SALVAGE_OPT');
    expect(engine.getState().currentPendingChoice!.minSelections).toBe(0);
    mustPick(engine, []);
    expect(cardState(engine, wsmTop.instanceId).zone).toBe('COST');
    expect(
      engine.events.slice(evBefore51).some((e) => e.type === 'CARD_MOVED' && e.toZone === 'PROCESSING')
    ).toBe(false);
    expect(engine.fieldMgr.evaluateRoleStats(c51.instanceId).keywords).toContain('突进');
    expect(engine.fieldMgr.calculateRoleEffectivePP(c51.instanceId)).toBe(4500);

    // 验证 BP03-052 允许费用区容纳 11 张且满 11 张后测试 BP03-047【起】
    fillCostZone(engine, 'p1', 11);
    expect(engine.getState().players['p1']!.totalCostCount).toBe(11);
    coveredCardNumbers.add('BP03-052');
    const r1 = findCard(engine, 'p1', 'BP03-081');
    const r2 = findCard(engine, 'p1', 'BP03-082');
    engine.zoneMgr.moveCard(r1.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    engine.zoneMgr.moveCard(r2.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    const c47InCost = findCard(engine, 'p1', 'BP03-047', 0);
    expect(
      engine.zoneMgr.getCardsInZone('p1', 'COST').filter((c) => c.isFaceUp && db.getCard(c.cardNumber)?.name === '艾拉·万华').length
    ).toBeGreaterThanOrEqual(7);
    mustActivate(engine, 'p1', c47InCost.instanceId, 0);
    mustPick(engine, [engine.getState().currentPendingChoice!.options.find((o) => o.id !== 'skip')!.id]);
    mustPick(engine, [oppB.instanceId]); // ST02-004 (cost 2 <= 3)
    expect(cardState(engine, c47InCost.instanceId).zone).toBe('DECK');
    expect(cardState(engine, oppB.instanceId).zone).toBe('COST');
    expect(cardState(engine, oppB.instanceId).isReady).toBe(false);

    // 3. BP03-048 攻击把手牌《艾拉·万华》横置放费用区；BP03-050 费用区>=6回底给+2000PP与可选消2球速攻
    // 先把 BP03-048 放进战场，并保证费用区不满 11 以便接纳手牌艾拉
    for (const c of engine.zoneMgr.getCardsInZone('p1', 'COST').filter((x) => x.cardNumber !== 'BP03-050' && !x.cardNumber.startsWith('BP03-04'))) {
      engine.zoneMgr.moveCardToBottomOfDeck(c.instanceId);
    }
    const c48 = placeRole(engine, 'p1', 'BP03-048', 4);
    const aylaHand48 = findCard(engine, 'p1', 'BP03-053');
    engine.zoneMgr.moveCard(aylaHand48.instanceId, 'HAND', { isFaceUp: true });
    putNonOrbOnTop(engine, 'p1');
    putNonOrbOnTop(engine, 'p2');
    expect(
      engine.dispatchAction({
        type: 'DECLARE_ATTACK',
        playerId: 'p1',
        attackerCardId: c48.instanceId,
        targetType: 'PLAYER',
      }).success
    ).toBe(true);
    mustPick(engine, [aylaHand48.instanceId]);
    expect(cardState(engine, aylaHand48.instanceId).zone).toBe('COST');
    expect(cardState(engine, aylaHand48.instanceId).isReady).toBe(false);
    finishCombat(engine);

    const c50InCost = findCard(engine, 'p1', 'BP03-050');
    engine.zoneMgr.moveCard(c47InCost.instanceId, 'COST', { isFaceUp: true, isReady: true });
    engine.zoneMgr.syncCostStats('p1');
    engine.zoneMgr.moveCard(r1.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    engine.zoneMgr.moveCard(r2.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    mustActivate(engine, 'p1', c50InCost.instanceId, 0);
    mustPick(engine, [c48.instanceId]);
    mustPick(engine, [engine.getState().currentPendingChoice!.options.find((o) => o.id !== 'skip')!.id]);
    expect(cardState(engine, c50InCost.instanceId).zone).toBe('DECK');
    expect(engine.fieldMgr.calculateRoleEffectivePP(c48.instanceId)).toBe(6500);
    expect(engine.fieldMgr.evaluateRoleStats(c48.instanceId).keywords).toContain('速攻');

    // 4. BP03-046 阻挡+3000PP & 对方回合离场从费用区出场<=5费《艾拉·万华》(不发动【出】) & BP03-054 对方攻击自由时点使用
    // 清理槽位留 c046InCost 在战场，放 BP03-054 在明费，放 c53 在费用区
    engine.fieldMgr.handleCardLeaveField(c51.instanceId);
    engine.fieldMgr.handleCardLeaveField(c48.instanceId);
    engine.zoneMgr.moveCard(c53.instanceId, 'COST', { isFaceUp: true, isReady: true });
    const c54 = findCard(engine, 'p1', 'BP03-054');
    engine.zoneMgr.moveCard(c54.instanceId, 'COST', { isFaceUp: true, isReady: true });
    engine.zoneMgr.syncCostStats('p1');

    // 确认 END_PHASE 不能用 BP03-054
    expect(engine.dispatchAction({ type: 'PASS_ACTION_TIMING', playerId: 'p1' }).success).toBe(true);
    expect(
      engine.dispatchAction({
        type: 'USE_INSTANT',
        playerId: 'p1',
        cardInstanceId: c54.instanceId,
      }).success
    ).toBe(false);
    passInstantWindows(engine);
    advanceTurnTo(engine, 'p2');

    // p2 用 oppA (4000PP) 攻击，p1 在自由时点用 BP03-054 给 c046InCost +1000PP，再用 c046InCost 阻挡 (+3000PP -> 10000PP!)
    expect(
      engine.dispatchAction({
        type: 'DECLARE_ATTACK',
        playerId: 'p2',
        attackerCardId: oppA.instanceId,
        targetType: 'PLAYER',
      }).success
    ).toBe(true);
    expect(engine.getState().timingWindow?.priorityPlayerId).toBe('p1');
    expect(
      engine.dispatchAction({
        type: 'USE_INSTANT',
        playerId: 'p1',
        cardInstanceId: c54.instanceId,
      }).success
    ).toBe(true);
    coveredCardNumbers.add('BP03-054');
    // 仅有 1 张<艺术协会>角色 c046InCost 时自动直接对其施加 PP+1000
    expect(cardState(engine, c54.instanceId).zone).toBe('DECK');
    expect(engine.fieldMgr.calculateRoleEffectivePP(c046InCost.instanceId)).toBe(7000);
    passInstantWindows(engine);
    expect(
      engine.dispatchAction({
        type: 'DECLARE_BLOCK',
        playerId: 'p1',
        blockerCardId: c046InCost.instanceId,
      }).success
    ).toBe(true);
    expect(engine.fieldMgr.calculateRoleEffectivePP(c046InCost.instanceId)).toBe(10000);
    finishCombat(engine, 'p1');
    expect(cardState(engine, c046InCost.instanceId).zone).toBe('BATTLEFIELD');
    expect(cardState(engine, oppA.instanceId).zone).toBe('BATTLEFIELD'); // 攻击方 PP<阻挡方时双方均存活 (7.6.1.b)

    // 对方回合内 c046InCost 离场触发【自】，从费用区出场 c53 (不发动【出】)
    engine.zoneMgr.moveCard(c046InCost.instanceId, 'GRAVEYARD', { isFaceUp: true });
    engine.checkTimingMgr.resolveCheckTiming();
    expect(engine.getState().currentPendingChoice?.effectType).toBe('DSL_BP03-046_LEAVE_DEPLOY');
    mustPick(engine, [c53.instanceId]);
    expect(cardState(engine, c53.instanceId).zone).toBe('BATTLEFIELD');
    expect(engine.getState().currentPendingChoice).toBeUndefined(); // 【出】未发动！
    expect(cardState(engine, oppB.instanceId).zone).toBe('COST'); // 之前已被 BP03-047 置入对方费用区

    // 5. 先测 BP03-073 首张艺术协会战术减1费，再测 BP03-049/055 满 10 费 3.6.4 溢出
    advanceTurnTo(engine, 'p1');
    engine.fieldMgr.handleCardLeaveField(c046OnField.instanceId);
    engine.fieldMgr.handleCardLeaveField(c53.instanceId);
    engine.fieldMgr.handleCardLeaveField(c045.instanceId);

    const s73 = placeRole(engine, 'p1', 'BP03-073', 0);
    expect(engine.combatMgr.calculateRoleChargeCount(s73.instanceId)).toBe(0);
    for (const c of engine.zoneMgr.getCardsInZone('p1', 'COST')) {
      engine.zoneMgr.moveCardToBottomOfDeck(c.instanceId);
    }
    // 放 1 张已横置的雷属性明费 (可用费用仍为 0，仅满足 8.6.2.a.1 雷属性条件)
    const tappedLightning = findCard(engine, 'p1', 'BP01-019');
    engine.zoneMgr.moveCard(tappedLightning.instanceId, 'COST', { isFaceUp: true, isReady: false });
    engine.zoneMgr.syncCostStats('p1');
    // 可用费用为 0 下，BP03-073 让首张 <艺术协会> 战术牌 BP03-074 (1费) 减为 0 费打出！第2张仍 1 费被打回！
    const t74a = findCard(engine, 'p1', 'BP03-074', 0);
    const t74b = findCard(engine, 'p1', 'BP03-074', 1);
    engine.zoneMgr.moveCard(t74a.instanceId, 'HAND', { isFaceUp: true });
    engine.zoneMgr.moveCard(t74b.instanceId, 'HAND', { isFaceUp: true });
    mustPlay(engine, 'p1', t74a.instanceId);
    mustPick(engine, ['skip']);
    expect(
      engine.dispatchAction({ type: 'PLAY_CARD', playerId: 'p1', cardInstanceId: t74b.instanceId }).success
    ).toBe(false);

    // BP03-055 虹霁正常交换 (<6 艾拉时必选1张明费回手)
    const hj = findCard(engine, 'p1', 'BP03-055');
    engine.zoneMgr.moveCard(hj.instanceId, 'HAND', { isFaceUp: true });
    expect(engine.fieldMgr.playAssistCard('p1', hj.instanceId, 1)).toBe(true);
    const costAyla55 = findCard(engine, 'p1', 'BP03-045');
    const handAyla55a = findCard(engine, 'p1', 'BP03-053');
    engine.zoneMgr.moveCard(costAyla55.instanceId, 'COST', { isFaceUp: true, isReady: true });
    engine.zoneMgr.syncCostStats('p1');
    engine.zoneMgr.moveCard(handAyla55a.instanceId, 'HAND', { isFaceUp: true });
    mustActivate(engine, 'p1', hj.instanceId, 0);
    mustPick(engine, [handAyla55a.instanceId]);
    expect(engine.getState().currentPendingChoice?.effectType).toBe('DSL_BP03-055_SALVAGE_REQ');
    mustPick(engine, [costAyla55.instanceId]);
    expect(cardState(engine, costAyla55.instanceId).zone).toBe('HAND');

    // BP03-049 满 10 费(不含 BP03-052) 消1种球自置费用区被 3.6.4 改放墓地 -> 不触发从费用区出场！
    for (const num of ['BP03-045', 'BP03-046', 'BP03-047', 'BP03-048', 'BP03-050', 'BP03-051']) {
      engine.zoneMgr.moveCard(findCard(engine, 'p1', num, 0).instanceId, 'COST', { isFaceUp: true, isReady: true });
    }
    fillCostZone(engine, 'p1', 10);
    expect(engine.zoneMgr.getCardsInZone('p1', 'COST')).toHaveLength(10);
    engine.zoneMgr.moveCard(r1.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    engine.zoneMgr.moveCard(r2.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    const c49 = placeRole(engine, 'p1', 'BP03-049', 2);
    mustActivate(engine, 'p1', c49.instanceId, 0);
    mustPick(engine, ['opt_yes']);
    expect(cardState(engine, c49.instanceId).zone).toBe('GRAVEYARD');
    expect(engine.getState().currentPendingChoice).toBeUndefined(); // 3.6.4 改送墓地后不拉人！

    // BP03-055 虹霁 10费满区同样被 3.6.4 改放墓地不回收
    cardState(engine, hj.instanceId).isReady = true;
    const handAyla55 = findCard(engine, 'p1', 'BP03-054');
    engine.zoneMgr.moveCard(handAyla55.instanceId, 'HAND', { isFaceUp: true });
    mustActivate(engine, 'p1', hj.instanceId, 0);
    mustPick(engine, [handAyla55.instanceId]);
    expect(cardState(engine, handAyla55.instanceId).zone).toBe('GRAVEYARD');
    expect(engine.getState().currentPendingChoice).toBeUndefined();
  });

  it('P2-3 & BP03-075/076/077/078：BP03-077 视为蓝色联动 049/071/074/075 与 077 无其他阿尔法反例', () => {
    const engine = createEngine(
      buildDeck([
        'BP03-049',
        'BP03-071',
        'BP03-072',
        'BP03-074',
        'BP03-075',
        'BP03-076',
        'BP03-077',
        'BP03-078',
        'BP03-081',
        'BP03-082',
        'BP03-083',
        'BP03-087',
        'BP03-088',
      ]),
      buildDeck([])
    );
    const a77 = placeRole(engine, 'p1', 'BP03-077', 0, { isReady: true });
    const red1 = findCard(engine, 'p1', 'BP03-081');
    const red2 = findCard(engine, 'p1', 'BP03-082');
    const red3 = findCard(engine, 'p1', 'BP03-083');
    const yel1 = findCard(engine, 'p1', 'BP03-087');
    const yel2 = findCard(engine, 'p1', 'BP03-088');
    engine.zoneMgr.moveCard(red1.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    engine.zoneMgr.moveCard(red2.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    engine.zoneMgr.moveCard(red3.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    engine.zoneMgr.moveCard(yel1.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    engine.zoneMgr.moveCard(yel2.instanceId, 'SIGNAL_ORB', { isFaceUp: true });

    // 1. 反例：场上没有其他<阿尔法>时，BP03-077 攻击不触发视为蓝色
    putNonOrbOnTop(engine, 'p1');
    putNonOrbOnTop(engine, 'p2');
    expect(
      engine.dispatchAction({
        type: 'DECLARE_ATTACK',
        playerId: 'p1',
        attackerCardId: a77.instanceId,
        targetType: 'PLAYER',
      }).success
    ).toBe(true);
    expect(engine.getState().currentPendingChoice).toBeUndefined();
    finishCombat(engine);

    // 2. 放置 BP03-076 在场，BP03-077 两次给 red1、red2 赋予 treatedAsOrbColors: ['BLUE']
    placeRole(engine, 'p1', 'BP03-076', 1);
    cardState(engine, a77.instanceId).isReady = true;
    putNonOrbOnTop(engine, 'p1');
    putNonOrbOnTop(engine, 'p2');
    expect(
      engine.dispatchAction({
        type: 'DECLARE_ATTACK',
        playerId: 'p1',
        attackerCardId: a77.instanceId,
        targetType: 'PLAYER',
      }).success
    ).toBe(true);
    mustPick(engine, [red1.instanceId]); // red1: RED + BLUE
    finishCombat(engine);

    cardState(engine, a77.instanceId).isReady = true;
    putNonOrbOnTop(engine, 'p1');
    putNonOrbOnTop(engine, 'p2');
    expect(
      engine.dispatchAction({
        type: 'DECLARE_ATTACK',
        playerId: 'p1',
        attackerCardId: a77.instanceId,
        targetType: 'PLAYER',
      }).success
    ).toBe(true);
    mustPick(engine, [red2.instanceId]); // red2: RED + BLUE
    finishCombat(engine);

    // 3. 测 BP03-074 消除相邻的 [red1(RED+BLUE), yel1(YELLOW)] -> 即使墓地只有 RED+YELLOW，ELIMINATED_ORB_COLOR_COUNT=3，触发「3种」竖直赛琳娜！
    // 调整顺序让 red1 与 yel1 相邻在顶部，red2 与 red3 相邻在中间
    for (const o of [red3, red2, yel2, red1, yel1]) {
      engine.zoneMgr.moveCard(o.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    }
    const selena72 = placeRole(engine, 'p1', 'BP03-072', 2, { isReady: false });
    setupOpenCost(engine, 'p1', ['LIGHTNING', 'ICE', 'PHYSICAL'], 8);
    const spell74 = findCard(engine, 'p1', 'BP03-074');
    engine.zoneMgr.moveCard(spell74.instanceId, 'HAND', { isFaceUp: true });
    mustPlay(engine, 'p1', spell74.instanceId);
    mustPick(engine, ['elim_2']);
    const pair74 = engine
      .getState()
      .currentPendingChoice!.options.find(
        (o) => o.id !== 'skip' && o.id.includes(red1.instanceId) && o.id.includes(yel1.instanceId)
      )!;
    expect(pair74).toBeDefined();
    mustPick(engine, [pair74.id]);
    expect(engine.getState().currentPendingChoice?.effectType).toBe('DSL_BP03-074_READY_ROLE');
    mustPick(engine, [selena72.instanceId]);
    expect(cardState(engine, selena72.instanceId).isReady).toBe(true);

    // 4. 测 BP03-071 消除相邻的 [yel2(YELLOW), red2(RED+BLUE)] -> 3种累积触发！
    const tappedCost = engine.zoneMgr.getCardsInZone('p1', 'COST').find((c) => c.isFaceUp)!;
    // 用 BP03-072#0 在费用区方便检验竖直
    const costArt = findCard(engine, 'p1', 'BP03-078');
    // selena72 在场，找场下另一张艺术协会或让 costArt 是 BP03-074 进费用区
    engine.zoneMgr.moveCard(spell74.instanceId, 'COST', { isFaceUp: true, isReady: false });
    engine.zoneMgr.syncCostStats('p1');
    expect(tappedCost).toBeDefined();
    const s71 = findCard(engine, 'p1', 'BP03-071');
    engine.zoneMgr.moveCard(s71.instanceId, 'HAND', { isFaceUp: true });
    readyAllOpenCosts(engine, 'p1');
    spell74.isReady = false;
    engine.zoneMgr.syncCostStats('p1');
    mustPlay(engine, 'p1', s71.instanceId, { targetSlotIndex: 3 });
    mustPick(engine, ['elim_2']);
    const pair71 = engine
      .getState()
      .currentPendingChoice!.options.find(
        (o) => o.id !== 'skip' && o.id.includes(yel2.instanceId) && o.id.includes(red2.instanceId)
      )!;
    mustPick(engine, [pair71.id]);
    expect(engine.getState().currentPendingChoice?.effectType).toBe('DSL_BP03-071_READY_COST');
    mustPick(engine, [spell74.instanceId]);
    expect(cardState(engine, spell74.instanceId).isReady).toBe(true);
    expect(engine.fieldMgr.evaluateRoleStats(s71.instanceId).keywords).toContain('速攻');
    expect(engine.fieldMgr.calculateRoleEffectivePP(s71.instanceId)).toBe(6500);

    // 5. 测 BP03-049 消除两张红球（red3(RED) + 给过蓝标记的... 重新用 a77 给 red3 上蓝标记）-> 2种颜色，直接获得【速攻】
    cardState(engine, a77.instanceId).isReady = true;
    putNonOrbOnTop(engine, 'p1');
    putNonOrbOnTop(engine, 'p2');
    expect(
      engine.dispatchAction({
        type: 'DECLARE_ATTACK',
        playerId: 'p1',
        attackerCardId: a77.instanceId,
        targetType: 'PLAYER',
      }).success
    ).toBe(true);
    mustPick(engine, [red3.instanceId]); // red3: RED + BLUE
    finishCombat(engine);

    // 放一张普通红球 BP03-081 在球区凑相邻 2 球 [red3(RED+BLUE), red1(RED)]
    engine.zoneMgr.moveCard(red1.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    const a49 = placeRole(engine, 'p1', 'BP03-049', 4);
    mustActivate(engine, 'p1', a49.instanceId, 0);
    if (engine.getState().currentPendingChoice?.effectType === 'DSL_BP03-049_ORB_COST') {
      mustPick(engine, [engine.getState().currentPendingChoice!.options[0]!.id]);
    }
    expect(engine.fieldMgr.evaluateRoleStats(a49.instanceId).keywords).toContain('速攻');

    // 6. 测 BP03-075 利用 BP03-077 赋予的「视为蓝色」送墓减费（且无《露西亚·鸦羽》时 BP03-078 最多选 1 项）
    engine.fieldMgr.handleCardLeaveField(s71.instanceId);
    engine.fieldMgr.handleCardLeaveField(a49.instanceId);
    engine.zoneMgr.moveCard(red3.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    cardState(engine, a77.instanceId).isReady = true;
    putNonOrbOnTop(engine, 'p1');
    putNonOrbOnTop(engine, 'p2');
    expect(
      engine.dispatchAction({
        type: 'DECLARE_ATTACK',
        playerId: 'p1',
        attackerCardId: a77.instanceId,
        targetType: 'PLAYER',
      }).success
    ).toBe(true);
    mustPick(engine, [red3.instanceId]); // 再次赋予球区中的 red3 视为【蓝色信号球】
    finishCombat(engine);
    setupOpenCost(engine, 'p1', ['PHYSICAL'], 6, new Set([red3.instanceId, costArt.instanceId])); // 6 费 -> 打 8 费 BP03-075 须送墓 red3 减 2 费
    const a75 = findCard(engine, 'p1', 'BP03-075');
    engine.zoneMgr.moveCard(a75.instanceId, 'HAND', { isFaceUp: true });
    mustPlay(engine, 'p1', a75.instanceId, { targetSlotIndex: 3 });
    expect(engine.getState().currentPendingChoice?.effectType).toBe('PLAY_CARD_DISCARD_DISCOUNT');
    mustPick(engine, [red3.instanceId]);
    expect(cardState(engine, a75.instanceId).zone).toBe('BATTLEFIELD');
    expect(cardState(engine, red3.instanceId).zone).toBe('GRAVEYARD');

    // 无鸦羽时 BP03-078 只能选 1 项
    readyAllOpenCosts(engine, 'p1');
    engine.zoneMgr.moveCard(costArt.instanceId, 'HAND', { isFaceUp: true });
    mustPlay(engine, 'p1', costArt.instanceId);
    expect(engine.getState().currentPendingChoice?.effectType).toBe('DSL_BP03-078_MODE_1');
    expect(engine.getState().currentPendingChoice!.maxSelections).toBe(1);
    mustPick(engine, ['buff_alpha']);
    mustPick(engine, [a75.instanceId]);
  });
});

// ============================================================================
// 六、莉莉丝·谬影 体系 (BP03-056 ~ BP03-066)
// ============================================================================

describe('Stage 4D BP03 莉莉丝·谬影 体系精确覆盖', () => {
  it('P1-11 & P1-14 BP03-056/060/062/066：056 复制 062 回收自身留手牌不撕回底、复制 057 放弃可选仍置底、060/062 翻出 065/066 声明费用', () => {
    const engine = createEngine(
      buildDeck([
        'BP03-056',
        'BP03-057',
        'BP03-060',
        'BP03-062',
        'BP03-065',
        'BP03-066',
        'BP03-081',
        'BP03-082',
        'BP03-083',
        'BP03-084',
      ]),
      buildDeck([])
    );
    const l56 = placeRole(engine, 'p1', 'BP03-056', 0);
    const l57 = findCard(engine, 'p1', 'BP03-057');
    const l60 = findCard(engine, 'p1', 'BP03-060');
    const l62 = findCard(engine, 'p1', 'BP03-062');
    const s65 = findCard(engine, 'p1', 'BP03-065');
    const e66 = findCard(engine, 'p1', 'BP03-066');
    const r1 = findCard(engine, 'p1', 'BP03-081');
    const r2 = findCard(engine, 'p1', 'BP03-082');
    const r3 = findCard(engine, 'p1', 'BP03-083');
    const r4 = findCard(engine, 'p1', 'BP03-084');
    const cCost0 = r3; // cost 0 (与球区用的 r1/r2 区分开)
    const cCost2 = findCard(engine, 'p1', 'ST01-006'); // cost 2
    const cCost3 = findCard(engine, 'p1', 'ST01-005'); // cost 3
    const reserve = new Set([
      l57.instanceId,
      l60.instanceId,
      l62.instanceId,
      s65.instanceId,
      e66.instanceId,
      r1.instanceId,
      r2.instanceId,
      r3.instanceId,
      r4.instanceId,
      cCost2.instanceId,
      cCost3.instanceId,
    ]);
    setupOpenCost(engine, 'p1', ['DARK'], 10, reserve);

    // 1. P1-14：BP03-060 翻出 BP03-065(宣言为8) + cost 0 + cost 2 -> 3 种不同费用 (+3000 PP)
    engine.zoneMgr.moveCardToTopOfDeck(cCost2.instanceId);
    engine.zoneMgr.moveCardToTopOfDeck(cCost0.instanceId);
    engine.zoneMgr.moveCardToTopOfDeck(s65.instanceId);
    engine.zoneMgr.moveCard(l60.instanceId, 'HAND', { isFaceUp: true });
    mustPlay(engine, 'p1', l60.instanceId, { targetSlotIndex: 1 });
    // 宣言 BP03-065 费用为 8
    expect(engine.getState().currentPendingChoice?.options.map((o) => o.id)).toEqual(['2', '4', '6', '8']);
    mustPick(engine, ['8']);
    expect(engine.getState().currentPendingChoice?.effectType).toBe('DSL_BP03-060_PICK');
    mustPick(engine, [l56.instanceId]);
    mustPick(engine, [cCost0.instanceId, cCost2.instanceId, s65.instanceId]); // chooseOrder
    expect(engine.fieldMgr.calculateRoleEffectivePP(l56.instanceId)).toBe(8500);

    // 2. P1-14：BP03-062 翻出 e66(宣言为3) + ST01-005(cost 3) + cCost0 -> 凑同费3回收墓地<莉莉丝>
    // 并测试 P1-11：BP03-056 复制墓地 BP03-062，当 BP03-062 回收自身进手牌时，留在手牌不被撕回牌组底！
    engine.zoneMgr.moveCard(l62.instanceId, 'GRAVEYARD', { isFaceUp: true });
    engine.zoneMgr.moveCard(r1.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    engine.zoneMgr.moveCard(r2.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    engine.zoneMgr.moveCardToTopOfDeck(cCost0.instanceId);
    engine.zoneMgr.moveCardToTopOfDeck(cCost3.instanceId);
    engine.zoneMgr.moveCardToTopOfDeck(e66.instanceId);

    mustActivate(engine, 'p1', l56.instanceId, 0);
    expect(engine.getState().currentPendingChoice?.effectType).toBe('DSL_CUSTOM_BP03_056_GY');
    mustPick(engine, [l62.instanceId]);
    expect(engine.getState().currentPendingChoice?.options.map((o) => o.id)).toEqual(['1', '3', '5', '7']);
    mustPick(engine, ['3']); // 宣言 e66 为 3，与 cCost3 (3) 相同！
    expect(engine.getState().currentPendingChoice?.effectType).toBe('DSL_BP03-062_RECOVER');
    mustPick(engine, [l62.instanceId]); // 回收被复制的 l62 自身加入手牌
    expect(cardState(engine, l62.instanceId).zone).toBe('HAND'); // 必须留在手牌，不能被撕回牌组底！

    // 3. P1-11 分支B：BP03-056 复制带可选动作/代价的 BP03-057【出】，放弃付费时仍将墓地 BP03-057 放置到牌组底
    advanceTurnTo(engine, 'p2');
    advanceTurnTo(engine, 'p1');
    engine.zoneMgr.moveCard(l57.instanceId, 'GRAVEYARD', { isFaceUp: true });
    engine.zoneMgr.moveCard(r3.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    engine.zoneMgr.moveCard(r4.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    mustActivate(engine, 'p1', l56.instanceId, 0);
    mustPick(engine, [l57.instanceId]);
    expect(engine.getState().currentPendingChoice?.effectType).toBe('DSL_CUSTOM_BP03_057_PICK_SELF');
    mustPick(engine, []); // 放弃公开/弃置手牌
    expect(cardState(engine, l57.instanceId).zone).toBe('DECK');

    // 4. BP03-066 装备加 500 PP
    engine.zoneMgr.moveCard(e66.instanceId, 'HAND', { isFaceUp: true });
    readyAllOpenCosts(engine, 'p1');
    const ppBeforeEquip = engine.fieldMgr.calculateRoleEffectivePP(l56.instanceId);
    mustPlay(engine, 'p1', e66.instanceId, { targetEquipRoleId: l56.instanceId });
    expect(engine.fieldMgr.calculateRoleEffectivePP(l56.instanceId)).toBe(ppBeforeEquip + 500);
  });

  it('P1-12 & P1-17：BP03-058 拒绝[0,2,4,6,8]/3张不刷新/混合手牌公开[0,1,2,3,4]/置换未满5入墓不拉人 & BP03-057 拦截/放弃/置换', () => {
    // 1. BP03-058 全 4 个子分支
    {
      const engine = createEngine(
        buildDeck(['BP03-058', 'BP03-058', 'BP03-064', 'BP03-066', 'BP03-081', 'ST02-003', 'ST02-005', 'ST01-002', 'ST01-008']),
        buildDeck([])
      );
      const l58a = findCard(engine, 'p1', 'BP03-058', 0);
      const l58b = findCard(engine, 'p1', 'BP03-058', 1);
      const c0 = findCard(engine, 'p1', 'BP03-081'); // cost 0
      const c1 = findCard(engine, 'p1', 'BP03-066'); // cost 1
      const c2 = findCard(engine, 'p1', 'BP03-064'); // cost 2 (莉莉丝<=4)
      const c2Alt = findCard(engine, 'p1', 'ST02-005'); // cost 2
      const c3 = findCard(engine, 'p1', 'ST01-005'); // cost 3
      const c4 = findCard(engine, 'p1', 'ST02-003'); // cost 4
      const c6 = findCard(engine, 'p1', 'ST01-002'); // cost 6
      const c8 = findCard(engine, 'p1', 'ST01-008'); // cost 8
      const reserve = new Set([
        l58a.instanceId,
        l58b.instanceId,
        c0.instanceId,
        c1.instanceId,
        c2.instanceId,
        c2Alt.instanceId,
        c3.instanceId,
        c4.instanceId,
        c6.instanceId,
        c8.instanceId,
      ]);
      setupOpenCost(engine, 'p1', ['DARK'], 10, reserve);

      // 将墓地放一张 <=4 的《莉莉丝·谬影》
      engine.zoneMgr.moveCard(c2.instanceId, 'GRAVEYARD', { isFaceUp: true });
      // 牌库顶放 c0, c2Alt(cost 2), c4(cost 4)
      const c3Alt = findCard(engine, 'p1', 'ST01-005', 1); // cost 3
      // 测试拒绝 [0,2,4,6,8] 并接受混合手牌+公开牌凑 [0,1,2,3,4]
      // 牌库只留 3 张牌 (c0, c2Alt, c4)，墓地已有其他牌 -> 检验牌库仅 3 张时不触发 3.3.3.c 刷新！
      for (const d of engine.zoneMgr.getCardsInZone('p1', 'DECK')) {
        if (d.instanceId !== c0.instanceId && d.instanceId !== c2Alt.instanceId && d.instanceId !== c4.instanceId) {
          engine.zoneMgr.moveCard(d.instanceId, 'GRAVEYARD', { isFaceUp: true });
        }
      }
      engine.zoneMgr.moveCardToTopOfDeck(c4.instanceId);
      engine.zoneMgr.moveCardToTopOfDeck(c2Alt.instanceId);
      engine.zoneMgr.moveCardToTopOfDeck(c0.instanceId);
      expect(engine.zoneMgr.getCardsInZone('p1', 'DECK')).toHaveLength(3);

      // 手牌放入 c1, c3Alt, c6, c8 方便凑 [0,2,4,6,8] 失败 & [0,1,2,3,4] 成功
      engine.zoneMgr.moveCard(c1.instanceId, 'HAND', { isFaceUp: true });
      engine.zoneMgr.moveCard(c3Alt.instanceId, 'HAND', { isFaceUp: true });
      engine.zoneMgr.moveCard(c6.instanceId, 'HAND', { isFaceUp: true });
      engine.zoneMgr.moveCard(c8.instanceId, 'HAND', { isFaceUp: true });
      engine.zoneMgr.moveCard(l58a.instanceId, 'HAND', { isFaceUp: true });
      const erosionBefore = engine.getState().players['p1']!.erosionCount;

      mustPlay(engine, 'p1', l58a.instanceId, { targetSlotIndex: 0 });
      // 牌库只有 3 张，不会刷新导致侵蚀+1
      expect(engine.getState().players['p1']!.erosionCount).toBe(erosionBefore);
      expect(engine.getState().currentPendingChoice?.effectType).toBe('DSL_CUSTOM_BP03_058_PICK5');

      // 拒绝非连续递增 [0, 2, 4, 6, 8]
      const badRes = engine.dispatchAction({
        type: 'SELECT_CHOICE_OPTION',
        playerId: 'p1',
        pendingChoiceId: engine.getState().currentPendingChoice!.id,
        selectedIds: [c0.instanceId, c2Alt.instanceId, c4.instanceId, c6.instanceId, c8.instanceId],
      });
      expect(badRes.success).toBe(false);

      // 接受混合公开 (c0, c2Alt, c4) + 手牌 (c1, c3Alt) 凑 [0,1,2,3,4] -> 成功从墓地拉起 c2！
      mustPick(engine, [c0.instanceId, c1.instanceId, c2Alt.instanceId, c3Alt.instanceId, c4.instanceId]);
      expect(engine.getState().currentPendingChoice?.effectType).toBe('DSL_CUSTOM_BP03_058_DEPLOY');
      mustPick(engine, [c2.instanceId]);
      expect(cardState(engine, c2.instanceId).zone).toBe('BATTLEFIELD');
      resolvePendingChoices(engine);

      // 分支 D：若所选 5 张中有 1 张进墓地被置换走（未满 5 张实际进墓），不拉墓地《莉莉丝·谬影》
      engine.fieldMgr.handleCardLeaveField(c2.instanceId);
      engine.zoneMgr.moveCard(c2.instanceId, 'GRAVEYARD', { isFaceUp: true });
      // 恢复牌库 5 张 [0,1,2,3,4]
      for (const card of [c4, c3Alt, c2Alt, c1, c0]) {
        engine.zoneMgr.moveCardToTopOfDeck(card.instanceId);
      }
      readyAllOpenCosts(engine, 'p1');
      engine.zoneMgr.moveCard(l58b.instanceId, 'HAND', { isFaceUp: true });
      mustPlay(engine, 'p1', l58b.instanceId, { targetSlotIndex: 2 });
      mustPick(engine, ['1']); // c1 (BP03-066) 声明为 1
      // 在 c4 已公开入处理区后挂接置换效果（3.1.4 规则下不会因 DECK->PROCESSING 离开原区被提前清理）
      engine.getState().activeReplacements = [
        ...(engine.getState().activeReplacements ?? []),
        {
          id: 'test-rep-058',
          eventType: 'MOVE_CARD',
          controllerPlayerId: 'p1',
          targetCardInstanceId: c4.instanceId,
          toZone: 'GRAVEYARD',
          action: { kind: 'REDIRECT_ZONE', zone: 'DECK', isFaceUp: false, toBottom: true },
          once: true,
        },
      ];
      mustPick(engine, [c0.instanceId, c1.instanceId, c2Alt.instanceId, c3Alt.instanceId, c4.instanceId]);
      expect(cardState(engine, c4.instanceId).zone).toBe('DECK');
      expect(engine.getState().currentPendingChoice).toBeUndefined(); // 实际只进墓4张，不弹出拉人！
      expect(cardState(engine, c2.instanceId).zone).toBe('GRAVEYARD');
    }

    // 2. P1-17 BP03-057：对手有更高费丢牌拦贯通 vs 放弃不丢仍获贯通 vs 被置换拦截仍获贯通
    {
      const engine = createEngine(
        buildDeck(['BP03-057', 'BP03-057', 'BP03-062', 'BP03-064']),
        buildDeck(['ST02-002', 'ST02-002', 'ST02-002'])
      );
      const l57a = findCard(engine, 'p1', 'BP03-057', 0);
      const l57b = findCard(engine, 'p1', 'BP03-057', 1);
      const handA = findCard(engine, 'p1', 'BP03-062'); // cost 3
      const handB = findCard(engine, 'p1', 'BP03-064'); // cost 2
      const oppHigh1 = findCard(engine, 'p2', 'ST02-002', 0); // cost 7
      const oppHigh2 = findCard(engine, 'p2', 'ST02-002', 1); // cost 7
      const oppHigh3 = findCard(engine, 'p2', 'ST02-002', 2); // cost 7
      setupOpenCost(engine, 'p1', ['DARK'], 10, new Set([l57a.instanceId, l57b.instanceId, handA.instanceId, handB.instanceId]));
      for (const c of engine.zoneMgr.getCardsInZone('p2', 'HAND')) engine.zoneMgr.moveCardToBottomOfDeck(c.instanceId);
      engine.zoneMgr.moveCard(oppHigh1.instanceId, 'HAND', { isFaceUp: true });
      engine.zoneMgr.moveCard(oppHigh2.instanceId, 'HAND', { isFaceUp: true });

      // A. 对手丢弃更高费 oppHigh1 -> 成功拦下【贯通】
      engine.zoneMgr.moveCard(handA.instanceId, 'HAND', { isFaceUp: true });
      engine.zoneMgr.moveCard(l57a.instanceId, 'HAND', { isFaceUp: true });
      mustPlay(engine, 'p1', l57a.instanceId, { targetSlotIndex: 0 });
      mustPick(engine, [handA.instanceId]);
      expect(engine.getState().currentPendingChoice?.effectType).toBe('DSL_CUSTOM_BP03_057_OPP_DISCARD');
      mustPick(engine, [oppHigh1.instanceId]);
      expect(cardState(engine, oppHigh1.instanceId).zone).toBe('GRAVEYARD');
      expect(engine.fieldMgr.evaluateRoleStats(l57a.instanceId).keywords).not.toContain('贯通');

      // B. 对手放弃不丢 -> 获【贯通】
      engine.zoneMgr.moveCard(handB.instanceId, 'HAND', { isFaceUp: true });
      engine.zoneMgr.moveCard(l57b.instanceId, 'HAND', { isFaceUp: true });
      readyAllOpenCosts(engine, 'p1');
      mustPlay(engine, 'p1', l57b.instanceId, { targetSlotIndex: 1 });
      mustPick(engine, [handB.instanceId]);
      mustPick(engine, []);
      expect(engine.fieldMgr.evaluateRoleStats(l57b.instanceId).keywords).toContain('贯通');

      // C. 对手选择弃置 oppHigh3 但被置换 PREVENT 未进墓地 -> 仍获【贯通】
      engine.fieldMgr.handleCardLeaveField(l57b.instanceId);
      engine.zoneMgr.moveCard(l57b.instanceId, 'HAND', { isFaceUp: true });
      engine.zoneMgr.moveCard(handB.instanceId, 'HAND', { isFaceUp: true });
      engine.zoneMgr.moveCard(oppHigh3.instanceId, 'HAND', { isFaceUp: true });
      engine.getState().activeReplacements = [
        ...(engine.getState().activeReplacements ?? []),
        {
          id: 'test-rep-057',
          eventType: 'MOVE_CARD',
          controllerPlayerId: 'p2',
          targetCardInstanceId: oppHigh3.instanceId,
          fromZone: 'HAND',
          toZone: 'GRAVEYARD',
          action: { kind: 'PREVENT' },
          once: true,
        },
      ];
      readyAllOpenCosts(engine, 'p1');
      mustPlay(engine, 'p1', l57b.instanceId, { targetSlotIndex: 1 });
      mustPick(engine, [handB.instanceId]);
      mustPick(engine, [oppHigh3.instanceId]);
      expect(cardState(engine, oppHigh3.instanceId).zone).toBe('HAND');
      expect(engine.fieldMgr.evaluateRoleStats(l57b.instanceId).keywords).toContain('贯通');
    }
  });

  it('P1-13/P1-15/P1-16 & BP03-061/063：059 空牌库刷新+19/20/爆点/不足、061/063 猜奇偶与三态拼点、064 抽空判负/空库刷新/双方同出球、065 isAttacking 与 dp_minus_1', () => {
    // 1. P1-13 BP03-059 空牌库先刷新继续翻 + 19点(-4000) + 爆点(>=22)/不足(<=18)不减
    {
      const engine = createEngine(
        buildDeck(['BP03-059', 'BP03-059', 'BP03-065', 'BP03-065', 'BP03-065', 'BP03-057', 'BP03-058', 'BP03-062']),
        buildDeck(['ST02-002'])
      );
      const l59a = findCard(engine, 'p1', 'BP03-059', 0);
      const l59b = findCard(engine, 'p1', 'BP03-059', 1);
      const s65a = findCard(engine, 'p1', 'BP03-065', 0);
      const s65b = findCard(engine, 'p1', 'BP03-065', 1);
      const s65c = findCard(engine, 'p1', 'BP03-065', 2);
      const l57 = findCard(engine, 'p1', 'BP03-057'); // cost 6
      const l58 = findCard(engine, 'p1', 'BP03-058'); // cost 5
      const l62 = findCard(engine, 'p1', 'BP03-062'); // cost 3
      const opp = placeRole(engine, 'p2', 'ST02-002', 0); // PP 8000
      setupOpenCost(
        engine,
        'p1',
        ['DARK'],
        10,
        new Set([l59a.instanceId, l59b.instanceId, s65a.instanceId, s65b.instanceId, s65c.instanceId, l57.instanceId, l58.instanceId, l62.instanceId])
      );

      // 把 DECK 全清空，只留 s65b/s65c (均 BP03-065 可宣言6) 在墓地等待刷新 -> 初始手牌公开 s65a(8) + l58(5) = 13，然后牌库为空先刷新再翻1张(宣言6) -> 13+6=19 点 (-4000)，且牌库尚余 1 张不触发抽空判负！
      for (const d of engine.zoneMgr.getCardsInZone('p1', 'DECK')) {
        engine.zoneMgr.moveCard(d.instanceId, 'HAND', { isFaceUp: true });
      }
      engine.zoneMgr.moveCard(s65b.instanceId, 'GRAVEYARD', { isFaceUp: true });
      engine.zoneMgr.moveCard(s65c.instanceId, 'GRAVEYARD', { isFaceUp: true });
      expect(engine.zoneMgr.getCardsInZone('p1', 'DECK')).toHaveLength(0);

      engine.zoneMgr.moveCard(s65a.instanceId, 'HAND', { isFaceUp: true });
      engine.zoneMgr.moveCard(l58.instanceId, 'HAND', { isFaceUp: true });
      engine.zoneMgr.moveCard(l59a.instanceId, 'HAND', { isFaceUp: true });
      const erosionBefore = engine.getState().players['p1']!.erosionCount;
      mustPlay(engine, 'p1', l59a.instanceId, { targetSlotIndex: 0 });
      mustPick(engine, [s65a.instanceId, l58.instanceId]);
      mustPick(engine, ['8']); // 8 + 5 = 13
      expect(engine.getState().currentPendingChoice?.effectType).toBe('DSL_CUSTOM_BP03_059_STEP');
      mustPick(engine, ['reveal_one']); // 空牌库先刷新出 s65b！
      expect(engine.getState().players['p1']!.erosionCount).toBe(erosionBefore + 1);
      mustPick(engine, ['6']); // 13 + 6 = 19!
      mustPick(engine, ['stop']);
      expect(engine.getState().currentPendingChoice?.effectType).toBe('DSL_CUSTOM_BP03_059_DEBUFF');
      mustPick(engine, [opp.instanceId]);
      expect(engine.fieldMgr.calculateRoleEffectivePP(opp.instanceId)).toBe(4000);

      // 爆点 (8 + 8 + 6 = 22) 不减 PP
      engine.zoneMgr.moveCard(s65a.instanceId, 'HAND', { isFaceUp: true });
      engine.zoneMgr.moveCard(s65b.instanceId, 'HAND', { isFaceUp: true });
      engine.zoneMgr.moveCardToTopOfDeck(l57.instanceId);
      engine.zoneMgr.moveCard(l59b.instanceId, 'HAND', { isFaceUp: true });
      readyAllOpenCosts(engine, 'p1');
      mustPlay(engine, 'p1', l59b.instanceId, { targetSlotIndex: 1 });
      mustPick(engine, [s65a.instanceId, s65b.instanceId]);
      mustPick(engine, ['8']);
      mustPick(engine, ['8']);
      mustPick(engine, ['reveal_one']);
      mustPick(engine, ['stop']);
      expect(engine.getState().currentPendingChoice).toBeUndefined();
      expect(engine.fieldMgr.calculateRoleEffectivePP(opp.instanceId)).toBe(4000);
    }

    // 2. BP03-061 对方猜中不竖直 vs 猜错竖直 & BP03-063 三态拼点 (我方大/对方大/平手)
    {
      const engine = createEngine(
        buildDeck(['BP03-061', 'BP03-063', 'BP03-063', 'ST02-005', 'ST02-005']),
        buildDeck(['ST02-001', 'ST02-004'])
      );
      const l61 = findCard(engine, 'p1', 'BP03-061');
      const l63a = findCard(engine, 'p1', 'BP03-063', 0);
      const l63b = findCard(engine, 'p1', 'BP03-063', 1);
      const cost2Top = findCard(engine, 'p1', 'ST02-005', 0); // cost 2 (even)
      const p1C2 = findCard(engine, 'p1', 'ST02-005', 1); // cost 2 (even)
      setupOpenCost(
        engine,
        'p1',
        ['DARK'],
        10,
        new Set([l61.instanceId, l63a.instanceId, l63b.instanceId, cost2Top.instanceId, p1C2.instanceId])
      );
      engine.zoneMgr.moveCardToTopOfDeck(cost2Top.instanceId);
      engine.zoneMgr.moveCard(l61.instanceId, 'HAND', { isFaceUp: true });
      mustPlay(engine, 'p1', l61.instanceId, { targetSlotIndex: 0 });
      mustPick(engine, [engine.getState().currentPendingChoice!.options[0]!.id]);
      mustPick(engine, []); // 第1【出】不置墓
      expect(engine.getState().currentPendingChoice?.effectType).toBe('DSL_CUSTOM_BP03_061_GUESS');
      mustPick(engine, ['even']); // 对方猜中偶数！不弹 PICK_UNTAP
      expect(engine.getState().currentPendingChoice).toBeUndefined();

      // BP03-063 拼点：对方大 -> 对方抽1；平手 -> 均不抽
      const p2C6 = findCard(engine, 'p2', 'ST02-001'); // cost 6
      const p2C2 = findCard(engine, 'p2', 'ST02-004'); // cost 2
      engine.zoneMgr.moveCardToTopOfDeck(p1C2.instanceId);
      engine.zoneMgr.moveCardToTopOfDeck(p2C6.instanceId);
      const p1HandBefore = engine.zoneMgr.getCardsInZone('p1', 'HAND').length;
      const p2HandBefore = engine.zoneMgr.getCardsInZone('p2', 'HAND').length;
      engine.zoneMgr.moveCard(l63a.instanceId, 'HAND', { isFaceUp: true });
      mustPlay(engine, 'p1', l63a.instanceId, { targetSlotIndex: 1 });
      mustPick(engine, [engine.getState().currentPendingChoice!.options[0]!.id]);
      mustPick(engine, []); // 不置墓
      expect(engine.zoneMgr.getCardsInZone('p1', 'HAND')).toHaveLength(p1HandBefore);
      expect(engine.zoneMgr.getCardsInZone('p2', 'HAND')).toHaveLength(p2HandBefore + 1);

      // 平手 (2 vs 2) -> 均不抽
      engine.zoneMgr.moveCardToTopOfDeck(p1C2.instanceId);
      engine.zoneMgr.moveCardToTopOfDeck(p2C2.instanceId);
      const p1HandTie = engine.zoneMgr.getCardsInZone('p1', 'HAND').length;
      const p2HandTie = engine.zoneMgr.getCardsInZone('p2', 'HAND').length;
      engine.zoneMgr.moveCard(l63b.instanceId, 'HAND', { isFaceUp: true });
      readyAllOpenCosts(engine, 'p1');
      mustPlay(engine, 'p1', l63b.instanceId, { targetSlotIndex: 2 });
      mustPick(engine, [engine.getState().currentPendingChoice!.options[0]!.id]);
      mustPick(engine, []);
      expect(engine.zoneMgr.getCardsInZone('p1', 'HAND')).toHaveLength(p1HandTie);
      expect(engine.zoneMgr.getCardsInZone('p2', 'HAND')).toHaveLength(p2HandTie);
    }

    // 3. P1-15 BP03-064 双方同出信号球双方抽2弃1 + 初始空牌库刷新 + 抽2张抽空判负不弹弃牌窗
    {
      const engine = createEngine(
        buildDeck(['BP03-064', 'BP03-064', 'BP03-064', 'BP03-081']),
        buildDeck(['BP03-084', 'BP03-085'])
      );
      setupOpenCost(engine, 'p1', ['DARK'], 10);
      const l64a = findCard(engine, 'p1', 'BP03-064', 0);
      const l64b = findCard(engine, 'p1', 'BP03-064', 1);
      const l64c = findCard(engine, 'p1', 'BP03-064', 2);
      const p1Orb = findCard(engine, 'p1', 'BP03-081');
      const p2Orb = findCard(engine, 'p2', 'BP03-084');
      const p2Orb2 = findCard(engine, 'p2', 'BP03-085');
      // 双方牌组顶放信号球 -> 同时命中，双方抽2弃1
      engine.zoneMgr.moveCardToTopOfDeck(p1Orb.instanceId);
      engine.zoneMgr.moveCardToTopOfDeck(p2Orb.instanceId);
      const p1HandBefore = engine.zoneMgr.getCardsInZone('p1', 'HAND').length;
      const p2HandBefore = engine.zoneMgr.getCardsInZone('p2', 'HAND').length;
      engine.zoneMgr.moveCard(l64a.instanceId, 'HAND', { isFaceUp: true });
      mustPlay(engine, 'p1', l64a.instanceId, { targetSlotIndex: 0 });
      expect(engine.getState().currentPendingChoice?.playerId).toBe('p1');
      mustPick(engine, [engine.getState().currentPendingChoice!.options[0]!.id]);
      expect(engine.getState().currentPendingChoice?.playerId).toBe('p2');
      mustPick(engine, [engine.getState().currentPendingChoice!.options[0]!.id]);
      expect(engine.zoneMgr.getCardsInZone('p1', 'HAND')).toHaveLength(p1HandBefore + 1);
      expect(engine.zoneMgr.getCardsInZone('p2', 'HAND')).toHaveLength(p2HandBefore + 1);

      // 初始空牌库刷新并正常抽2弃1 (DECK=0, GRAVEYARD 有 p1Orb + 3 张非信号球)
      const extrasForGy = engine.zoneMgr.getCardsInZone('p1', 'DECK').filter((c) => !db.getCard(c.cardNumber)?.signalOrb).slice(0, 3);
      for (const d of engine.zoneMgr.getCardsInZone('p1', 'DECK')) {
        engine.zoneMgr.moveCard(d.instanceId, 'HAND', { isFaceUp: true });
      }
      for (const g of extrasForGy) engine.zoneMgr.moveCard(g.instanceId, 'GRAVEYARD', { isFaceUp: true });
      engine.zoneMgr.moveCard(p1Orb.instanceId, 'GRAVEYARD', { isFaceUp: true });
      engine.zoneMgr.moveCardToTopOfDeck(p2Orb2.instanceId);
      const erosionBeforeRefresh = engine.getState().players['p1']!.erosionCount;
      engine.zoneMgr.moveCard(l64c.instanceId, 'HAND', { isFaceUp: true });
      readyAllOpenCosts(engine, 'p1');
      mustPlay(engine, 'p1', l64c.instanceId, { targetSlotIndex: 2 });
      expect(engine.getState().players['p1']!.erosionCount).toBe(erosionBeforeRefresh + 1);
      while (engine.getState().currentPendingChoice?.effectType === 'DSL_CUSTOM_BP03_064_DISCARD') {
        mustPick(engine, [engine.getState().currentPendingChoice!.options[0]!.id]);
      }

      // 初始空牌库刷新 + 牌库+墓地合计仅 1 张 (p1Orb) 导致抽 2 张时抽空判负，绝不能弹出弃牌窗
      for (const d of engine.zoneMgr.getCardsInZone('p1', 'DECK')) {
        engine.zoneMgr.moveCard(d.instanceId, 'HAND', { isFaceUp: true });
      }
      for (const g of engine.zoneMgr.getCardsInZone('p1', 'GRAVEYARD')) {
        engine.zoneMgr.moveCard(g.instanceId, 'HAND', { isFaceUp: true });
      }
      engine.zoneMgr.moveCard(p1Orb.instanceId, 'GRAVEYARD', { isFaceUp: true });
      engine.getState().players['p1']!.erosionCount = 5; // 刷新后变为 6，随后抽 2 张第 2 张抽空判负
      engine.zoneMgr.moveCard(l64b.instanceId, 'HAND', { isFaceUp: true });
      readyAllOpenCosts(engine, 'p1');
      mustPlay(engine, 'p1', l64b.instanceId, { targetSlotIndex: 1 });
      expect(engine.getState().status).toBe('FINISHED');
      expect(engine.getState().winnerId).toBe('p2');
      expect(engine.getState().currentPendingChoice).toBeUndefined();
    }

    // 4. P1-16 BP03-065 isAttacking 排除非攻击中角色 + 选 dp_minus_1
    {
      const engine = createEngine(
        buildDeck(['BP03-065', 'BP03-057', 'BP03-058', 'BP03-061', 'BP03-062', 'BP03-063', 'BP03-064']),
        buildDeck(['ST02-001'])
      );
      setupOpenCost(engine, 'p1', ['DARK'], 8);
      const atk62 = placeRole(engine, 'p1', 'BP03-062', 0, { isReady: true }); // DP 1
      const idleRole = placeRole(engine, 'p1', 'BP03-057', 1, { isReady: true });
      placeRole(engine, 'p2', 'ST02-001', 0, { isReady: true });
      const gy4 = ['BP03-058', 'BP03-061', 'BP03-063', 'BP03-064'].map((n) => findCard(engine, 'p1', n));
      for (const c of gy4) engine.zoneMgr.moveCard(c.instanceId, 'GRAVEYARD', { isFaceUp: true });
      void idleRole;

      const spell65 = findCard(engine, 'p1', 'BP03-065');
      engine.zoneMgr.moveCard(spell65.instanceId, 'HAND', { isFaceUp: true });
      putNonOrbOnTop(engine, 'p1');
      putNonOrbOnTop(engine, 'p2');
      expect(
        engine.dispatchAction({
          type: 'DECLARE_ATTACK',
          playerId: 'p1',
          attackerCardId: atk62.instanceId,
          targetType: 'PLAYER',
        }).success
      ).toBe(true);
      if (engine.getState().timingWindow?.priorityPlayerId === 'p2') {
        engine.dispatchAction({ type: 'PASS_ACTION_TIMING', playerId: 'p2' });
      }
      expect(engine.getState().timingWindow?.priorityPlayerId).toBe('p1');
      const res65 = engine.dispatchAction({
        type: 'USE_INSTANT',
        playerId: 'p1',
        cardInstanceId: spell65.instanceId,
      });
      expect(res65.success, res65.error).toBe(true);
      coveredCardNumbers.add('BP03-065');
      mustPick(engine, gy4.map((c) => c.instanceId));
      expect(engine.getState().currentPendingChoice?.effectType).toBe('DSL_BP03-065_ROLE');
      expect(engine.getState().currentPendingChoice!.options.map((o) => o.id)).toEqual([atk62.instanceId]);
      mustPick(engine, [atk62.instanceId]);
      mustPick(engine, ['dp_minus_1']);
      expect(engine.fieldMgr.calculateRoleEffectiveDP(atk62.instanceId)).toBe(0);
      finishCombat(engine);
    }
  });
});

// ============================================================================
// 七、罗兰·戏炎 / 暗费 / 全 9 张信号球 (BP03-067 ~ BP03-089) & 100% 完整性断言
// ============================================================================

describe('Stage 4D BP03 罗兰、暗费、全部9张信号球与全包完整性覆盖', () => {
  it('BP03-067/068/069/070/079/080：67 公开3不同属性获速攻与攻击复制PP、68 公开2非火抽1及反例、69 同属性反例、79/80 暗费规则', () => {
    const engine = createEngine(
      buildDeck([
        'BP03-067',
        'BP03-068',
        'BP03-069',
        'BP03-070',
        'BP03-076',
        'BP03-079',
        'BP03-080',
        'BP01-009',
        'BP03-081',
        'BP03-082',
      ]),
      buildDeck(['ST02-004'])
    );
    const r67 = findCard(engine, 'p1', 'BP03-067');
    const r68 = findCard(engine, 'p1', 'BP03-068');
    const r69 = findCard(engine, 'p1', 'BP03-069');
    const s70 = findCard(engine, 'p1', 'BP03-070');
    const phyAsc = findCard(engine, 'p1', 'BP03-076');
    const darkAsc = findCard(engine, 'p1', 'BP01-009'); // DARK 升格者 (cost 3)
    const k79 = findCard(engine, 'p1', 'BP03-079');
    const duo80 = findCard(engine, 'p1', 'BP03-080');
    const orb1 = findCard(engine, 'p1', 'BP03-081');
    const orb2 = findCard(engine, 'p1', 'BP03-082');
    setupOpenCost(
      engine,
      'p1',
      ['FIRE', 'PHYSICAL', 'DARK'],
      10,
      new Set([
        r67.instanceId,
        r68.instanceId,
        r69.instanceId,
        s70.instanceId,
        phyAsc.instanceId,
        darkAsc.instanceId,
        k79.instanceId,
        duo80.instanceId,
        orb1.instanceId,
        orb2.instanceId,
      ])
    );

    // 1. BP03-069 同属性(全FIRE) DP=0，放入不同属性<升格者>后 DP=1
    placeRole(engine, 'p1', 'BP03-069', 0);
    expect(engine.fieldMgr.calculateRoleEffectiveDP(r69.instanceId)).toBe(0);
    // 只有 1 张非火属性<升格者>时 BP03-068 不抽牌
    engine.zoneMgr.moveCard(phyAsc.instanceId, 'HAND', { isFaceUp: true });
    engine.zoneMgr.moveCard(r68.instanceId, 'HAND', { isFaceUp: true });
    const handBefore68a = engine.zoneMgr.getCardsInZone('p1', 'HAND').length - 1;
    mustPlay(engine, 'p1', r68.instanceId, { targetSlotIndex: 1 });
    mustPick(engine, [phyAsc.instanceId]); // 只选 1 张 -> 不抽牌
    expect(engine.zoneMgr.getCardsInZone('p1', 'HAND')).toHaveLength(handBefore68a);

    // 集齐 2 张不同非火<升格者> (PHYSICAL BP03-076 + DARK BP01-009) 重新打出 BP03-068 -> 抽 1 张！
    engine.fieldMgr.handleCardLeaveField(r68.instanceId);
    engine.zoneMgr.moveCard(darkAsc.instanceId, 'HAND', { isFaceUp: true });
    engine.zoneMgr.moveCard(r68.instanceId, 'HAND', { isFaceUp: true });
    readyAllOpenCosts(engine, 'p1');
    const handBefore68b = engine.zoneMgr.getCardsInZone('p1', 'HAND').length - 1;
    mustPlay(engine, 'p1', r68.instanceId, { targetSlotIndex: 1 });
    mustPick(engine, [phyAsc.instanceId, darkAsc.instanceId]);
    expect(engine.zoneMgr.getCardsInZone('p1', 'HAND')).toHaveLength(handBefore68b + 1);

    // 2. BP03-067【出】公开3种不同属性<升格者> (FIRE r68 + PHYSICAL BP03-076 + DARK BP01-009) -> 获得【速攻】
    engine.fieldMgr.handleCardLeaveField(r68.instanceId);
    engine.zoneMgr.moveCard(r68.instanceId, 'HAND', { isFaceUp: true });
    engine.zoneMgr.moveCard(r67.instanceId, 'HAND', { isFaceUp: true });
    readyAllOpenCosts(engine, 'p1');
    mustPlay(engine, 'p1', r67.instanceId, { targetSlotIndex: 2 });
    mustPick(engine, [r68.instanceId, phyAsc.instanceId, darkAsc.instanceId]);
    expect(engine.fieldMgr.evaluateRoleStats(r67.instanceId).keywords).toContain('速攻');

    // BP03-067【自】攻击时消2球丢弃 phyAsc 复制其基本PP (4000)
    engine.zoneMgr.moveCard(orb1.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    engine.zoneMgr.moveCard(orb2.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    putNonOrbOnTop(engine, 'p1');
    putNonOrbOnTop(engine, 'p2');
    expect(
      engine.dispatchAction({
        type: 'DECLARE_ATTACK',
        playerId: 'p1',
        attackerCardId: r67.instanceId,
        targetType: 'PLAYER',
      }).success
    ).toBe(true);
    mustPick(engine, [engine.getState().currentPendingChoice!.options.find((o) => o.id !== 'skip')!.id]);
    mustPick(engine, [phyAsc.instanceId]);
    expect(engine.fieldMgr.calculateRoleEffectivePP(r67.instanceId)).toBe(4000);
    finishCombat(engine);

    // 3. BP03-070 弃 darkAsc (PP 3000, DP 1) 复制至 BP03-069
    engine.zoneMgr.moveCard(s70.instanceId, 'HAND', { isFaceUp: true });
    readyAllOpenCosts(engine, 'p1');
    mustPlay(engine, 'p1', s70.instanceId);
    mustPick(engine, [r69.instanceId]);
    mustPick(engine, [darkAsc.instanceId]);
    expect(engine.fieldMgr.calculateRoleEffectivePP(r69.instanceId)).toBe(3000);
    expect(engine.fieldMgr.calculateRoleEffectiveDP(r69.instanceId)).toBe(1);

    // 4. BP03-079 保护1张暗费回合末不送墓 (另1张暗费送墓) & BP03-080 迫使对方回合优先支付暗费
    setupOpenCost(engine, 'p1', ['FIRE', 'PHYSICAL', 'DARK'], 8, new Set([k79.instanceId, duo80.instanceId]));
    const deckCands79 = engine.zoneMgr
      .getCardsInZone('p1', 'DECK')
      .filter((c) => c.instanceId !== k79.instanceId && c.instanceId !== duo80.instanceId);
    const hKeep = deckCands79[0]!;
    const hDrop = deckCands79[1]!;
    engine.zoneMgr.moveCard(hKeep.instanceId, 'COST', { isFaceUp: false, isReady: true });
    engine.zoneMgr.moveCard(hDrop.instanceId, 'COST', { isFaceUp: false, isReady: true });
    engine.zoneMgr.syncCostStats('p1');
    expect(cardState(engine, hDrop.instanceId).zone).toBe('COST');
    engine.zoneMgr.moveCard(k79.instanceId, 'HAND', { isFaceUp: true });
    readyAllOpenCosts(engine, 'p1');
    mustPlay(engine, 'p1', k79.instanceId, { targetSlotIndex: 3 });
    mustPick(engine, [hKeep.instanceId]);
    engine.zoneMgr.moveCard(duo80.instanceId, 'HAND', { isFaceUp: true });
    readyAllOpenCosts(engine, 'p1');
    mustPlay(engine, 'p1', duo80.instanceId, { targetSlotIndex: 4 });
    expect(cardState(engine, hDrop.instanceId).zone).toBe('COST');
    endTurn(engine);
    expect(cardState(engine, hKeep.instanceId).zone).toBe('COST');
    expect(cardState(engine, hDrop.instanceId).zone).toBe('GRAVEYARD');

    // 对方回合受 BP03-080 限制：只付明费打 ST02-004 失败，含暗费支付成功
    if (engine.getState().phase === 'DRAW_CHARGE_PHASE') {
      engine.dispatchAction({ type: 'PASS_ACTION_TIMING', playerId: 'p2' });
    }
    setupOpenCost(engine, 'p2', ['DARK'], 5);
    const p2Hidden = engine.zoneMgr.getCardsInZone('p2', 'DECK')[0]!;
    engine.zoneMgr.moveCard(p2Hidden.instanceId, 'COST', { isFaceUp: false, isReady: true });
    engine.zoneMgr.syncCostStats('p2');
    const p2Role = findCard(engine, 'p2', 'ST02-004');
    engine.zoneMgr.moveCard(p2Role.instanceId, 'HAND', { isFaceUp: true });
    const p2Open2 = engine.zoneMgr.getCardsInZone('p2', 'COST').filter((c) => c.isFaceUp).slice(0, 2);
    expect(
      engine.dispatchAction({
        type: 'PLAY_CARD',
        playerId: 'p2',
        cardInstanceId: p2Role.instanceId,
        costCardInstanceIds: p2Open2.map((c) => c.instanceId),
      }).success
    ).toBe(false);
    expect(
      engine.dispatchAction({
        type: 'PLAY_CARD',
        playerId: 'p2',
        cardInstanceId: p2Role.instanceId,
        costCardInstanceIds: [p2Hidden.instanceId, p2Open2[0]!.instanceId],
      }).success
    ).toBe(true);
    expect(cardState(engine, p2Hidden.instanceId).zone).toBe('GRAVEYARD');
  });

  it('BP03-081 ~ BP03-089：全部 9 张标准信号球牌手牌使用置顶抽 1 与攻击充能【充能自】全量覆盖', () => {
    const redOrbs = ['BP03-081', 'BP03-082', 'BP03-083'];
    const blueOrbs = ['BP03-084', 'BP03-085', 'BP03-086'];
    const yellowOrbs = ['BP03-087', 'BP03-088', 'BP03-089'];
    const orbEngine = createEngine(
      buildDeck([...redOrbs, ...blueOrbs, ...yellowOrbs, 'ST01-005']),
      buildDeck([])
    );
    const charger = placeRole(orbEngine, 'p1', 'ST01-005', 0, { isReady: true });

    for (const orbNo of [...redOrbs, ...blueOrbs, ...yellowOrbs]) {
      const orbCard = findCard(orbEngine, 'p1', orbNo);
      orbEngine.zoneMgr.moveCard(orbCard.instanceId, 'HAND', { isFaceUp: true });
      const handBefore = orbEngine.zoneMgr.getCardsInZone('p1', 'HAND').length;
      mustPlay(orbEngine, 'p1', orbCard.instanceId);
      expect(cardState(orbEngine, orbCard.instanceId).zone).toBe('SIGNAL_ORB');
      expect(orbEngine.zoneMgr.getCardsInZone('p1', 'HAND')).toHaveLength(handBefore);
    }

    // 逐张测试 9 张球的【充能自】
    for (let i = 0; i < redOrbs.length; i++) {
      const orbCard = findCard(orbEngine, 'p1', redOrbs[i]!);
      orbEngine.zoneMgr.moveCardToTopOfDeck(orbCard.instanceId);
      charger.isReady = true;
      putNonOrbOnTop(orbEngine, 'p2');
      expect(
        orbEngine.dispatchAction({
          type: 'DECLARE_ATTACK',
          playerId: 'p1',
          attackerCardId: charger.instanceId,
          targetType: 'PLAYER',
        }).success
      ).toBe(true);
      passInstantWindows(orbEngine);
      mustPick(orbEngine, [i === 0 ? 'opt_dp_plus_1' : 'opt_pp_plus_2000']);
      mustPick(orbEngine, [charger.instanceId]);
      finishCombat(orbEngine);
      expect(cardState(orbEngine, orbCard.instanceId).zone).toBe('SIGNAL_ORB');
    }

    for (let i = 0; i < blueOrbs.length; i++) {
      const orbCard = findCard(orbEngine, 'p1', blueOrbs[i]!);
      orbEngine.zoneMgr.moveCardToTopOfDeck(orbCard.instanceId);
      charger.isReady = true;
      putNonOrbOnTop(orbEngine, 'p2');
      const handBefore = orbEngine.zoneMgr.getCardsInZone('p1', 'HAND').length;
      expect(
        orbEngine.dispatchAction({
          type: 'DECLARE_ATTACK',
          playerId: 'p1',
          attackerCardId: charger.instanceId,
          targetType: 'PLAYER',
        }).success
      ).toBe(true);
      passInstantWindows(orbEngine);
      if (i === 0) {
        mustPick(orbEngine, ['opt_draw_1']);
        expect(orbEngine.zoneMgr.getCardsInZone('p1', 'HAND')).toHaveLength(handBefore + 1);
      } else {
        mustPick(orbEngine, ['opt_pp_plus_2000']);
        mustPick(orbEngine, [charger.instanceId]);
      }
      finishCombat(orbEngine);
      expect(cardState(orbEngine, orbCard.instanceId).zone).toBe('SIGNAL_ORB');
    }

    orbEngine.getState().players['p1']!.erosionCount = 3;
    orbEngine.getState().players['p2']!.erosionCount = 2;
    for (let i = 0; i < yellowOrbs.length; i++) {
      const orbCard = findCard(orbEngine, 'p1', yellowOrbs[i]!);
      orbEngine.zoneMgr.moveCardToTopOfDeck(orbCard.instanceId);
      charger.isReady = true;
      putNonOrbOnTop(orbEngine, 'p2');
      expect(
        orbEngine.dispatchAction({
          type: 'DECLARE_ATTACK',
          playerId: 'p1',
          attackerCardId: charger.instanceId,
          targetType: 'PLAYER',
        }).success
      ).toBe(true);
      passInstantWindows(orbEngine);
      if (i < 2) {
        mustPick(orbEngine, ['opt_erosion_minus_1']);
        if (i === 0) {
          expect(orbEngine.getState().players['p1']!.erosionCount).toBe(2);
          orbEngine.getState().players['p1']!.erosionCount = 1;
          orbEngine.getState().players['p2']!.erosionCount = 4;
        } else {
          expect(orbEngine.getState().players['p1']!.erosionCount).toBe(1);
        }
      } else {
        mustPick(orbEngine, ['opt_pp_plus_2000']);
        mustPick(orbEngine, [charger.instanceId]);
      }
      finishCombat(orbEngine);
      expect(cardState(orbEngine, orbCard.instanceId).zone).toBe('SIGNAL_ORB');
    }
  });

  it('BP03 全 90 张官方卡牌 100% 实战覆盖完整性断言（无遗漏）', () => {
    const allBp03 = OFFICIAL_CARDS_DATA.filter((c) => c.cardNumber.startsWith('BP03-')).map((c) => c.cardNumber);
    expect(allBp03).toHaveLength(90);
    const missing = allBp03.filter((num) => !coveredCardNumbers.has(num));
    expect(missing, `漏测 BP03 卡牌: ${missing.join(', ')}`).toEqual([]);
  });
});

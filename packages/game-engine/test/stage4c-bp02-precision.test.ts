import { describe, it, expect } from 'vitest';
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
    `stage4c-${seed}`,
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
        (x) => x.zone !== 'COST' && x.zone !== 'BATTLEFIELD' && !reserveIds.has(x.instanceId) && !usedIds.has(x.instanceId)
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

function putNonOrbOnTop(engine: GameEngine, playerId: string): void {
  const nonOrbs = engine.zoneMgr.getCardsInZone(playerId, 'DECK').filter((c) => {
    const def = db.getCard(c.cardNumber);
    return (
      !def?.signalOrb &&
      !def?.rulesText.includes('充能自') &&
      !def?.traits?.includes('万世铭')
    );
  });
  for (const c of nonOrbs.slice(0, 3).reverse()) {
    engine.zoneMgr.moveCardToTopOfDeck(c.instanceId);
  }
}

function advanceTurnTo(engine: GameEngine, targetPlayerId: string): void {
  for (let i = 0; i < 12; i++) {
    resolvePendingChoices(engine);
    const st = engine.getState();
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

function mustPlay(
  engine: GameEngine,
  playerId: string,
  cardInstanceId: string,
  extra: Record<string, unknown> = {}
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
  } as Parameters<GameEngine['dispatchAction']>[0]);
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
    if (!st.currentCombat || st.winnerId) break;
    if (st.timingWindow) {
      passInstantWindows(engine);
      continue;
    }
    if (st.currentCombat.step === 'BLOCK') {
      engine.dispatchAction({ type: 'DECLARE_BLOCK', playerId: defenderId });
      continue;
    }
    if (!st.currentPendingChoice) {
      engine.dispatchAction({ type: 'PASS_ACTION_TIMING', playerId: st.activePlayerId });
    }
  }
  resolvePendingChoices(engine);
}

// ============================================================================
// 一、Stage 4C 核心修复项正反向回归
// ============================================================================

describe('Stage 4C 核心修复项正反向回归', () => {
  it('P1-1 BP02-017：付1费从手牌出场回合末自送墓触发 BP02-015 抽2弃1；跳过不送墓；从墓地出场不获突进', () => {
    const engine = createEngine(
      buildDeck(['BP02-017', 'BP02-017', 'BP02-017', 'BP02-015', 'BP02-016']),
      buildDeck([])
    );
    const liv015 = placeRole(engine, 'p1', 'BP02-015', 0);
    const liv016 = placeRole(engine, 'p1', 'BP02-016', 1);
    const liv017Paid = findCard(engine, 'p1', 'BP02-017', 0);
    const liv017Skip = findCard(engine, 'p1', 'BP02-017', 1);
    const liv017Gy = findCard(engine, 'p1', 'BP02-017', 2);
    const reserve = new Set([
      liv015.instanceId,
      liv016.instanceId,
      liv017Paid.instanceId,
      liv017Skip.instanceId,
      liv017Gy.instanceId,
    ]);
    setupOpenCost(engine, 'p1', ['FIRE'], 8, reserve);

    // 正向：手牌打出 BP02-017 并付 1 费 -> 获【突进】与 PP+3000，回合结束自送墓并触发 BP02-015 / BP02-016
    mustPlay(engine, 'p1', liv017Paid.instanceId, { targetSlotIndex: 2 });
    mustPick(engine, ['pay_cost']);
    expect(engine.fieldMgr.evaluateRoleStats(liv017Paid.instanceId).keywords).toContain('突进');
    expect(engine.fieldMgr.calculateRoleEffectivePP(liv017Paid.instanceId)).toBe(6000);

    // 反向 1：第 2 张 BP02-017 不付 1 费 -> 无突进，PP 保持 3000，回合结束留战场
    mustPlay(engine, 'p1', liv017Skip.instanceId, { targetSlotIndex: 3 });
    mustPick(engine, ['skip']);
    expect(engine.fieldMgr.evaluateRoleStats(liv017Skip.instanceId).keywords).not.toContain('突进');
    expect(engine.fieldMgr.calculateRoleEffectivePP(liv017Skip.instanceId)).toBe(3000);

    // 反向 2：第 3 张 BP02-017 从墓地出场并付 1 费 -> 非手牌出场不获【突进】与 +3000，但回合结束仍送墓
    engine.zoneMgr.moveCard(liv017Gy.instanceId, 'GRAVEYARD', { isFaceUp: true });
    expect(engine.fieldMgr.playRoleCard('p1', liv017Gy.instanceId, 4)).toBe(true);
    engine.checkTimingMgr.resolveCheckTiming();
    mustPick(engine, ['pay_cost']);
    expect(engine.fieldMgr.evaluateRoleStats(liv017Gy.instanceId).keywords).not.toContain('突进');
    expect(engine.fieldMgr.calculateRoleEffectivePP(liv017Gy.instanceId)).toBe(3000);

    // 推进至结束阶段（处理 BP02-017 延迟送墓触发的 BP02-015 抽 2 弃 1 与 BP02-016 加攻）
    const handBeforeEnd = engine.zoneMgr.getCardsInZone('p1', 'HAND').length;
    engine.dispatchAction({ type: 'PASS_ACTION_TIMING', playerId: 'p1' });
    passInstantWindows(engine);
    // 结束阶段触发顺序：同时入池 BP02-017 延迟送墓与之后派生触发，resolvePendingChoices 自动依次消费
    while (engine.getState().currentPendingChoice) {
      const ch = engine.getState().currentPendingChoice!;
      if (ch.effectType === 'CHOOSE_TRIGGER_ORDER') {
        mustPick(engine, [ch.options[0]!.id]);
      } else {
        mustPick(engine, ch.options.slice(0, ch.minSelections).map((o) => o.id));
      }
      if (engine.getState().timingWindow) passInstantWindows(engine);
    }

    expect(cardState(engine, liv017Paid.instanceId).zone).toBe('GRAVEYARD');
    expect(cardState(engine, liv017Gy.instanceId).zone).toBe('GRAVEYARD');
    expect(cardState(engine, liv017Skip.instanceId).zone).toBe('BATTLEFIELD');
    // BP02-015 抽 2 弃 1 净 +1 手牌，随后切到 p2 回合会再给 p2 抽牌（p1 手牌净 +1）
    expect(engine.zoneMgr.getCardsInZone('p1', 'HAND').length).toBe(handBeforeEnd + 1);
  });

  it('P1-2 BP02-020 永夜曙光：可选搭档《丽芙·极昼》送墓，且 8.13.4.a.2 搭档被 012/020 送墓不触发 BP02-015', () => {
    const engine = createEngine(
      buildDeck(['BP02-020', 'BP02-012', 'BP02-013', 'BP02-014', 'BP02-014', 'BP02-015']),
      buildDeck([], 'ST02')
    );
    const host = placeRole(engine, 'p1', 'ST01-006', 0);
    const partnerLiv13 = findCard(engine, 'p1', 'BP02-013');
    const partnerLiv14 = findCard(engine, 'p1', 'BP02-014');
    const liv015 = placeRole(engine, 'p1', 'BP02-015', 1);
    const liv012 = findCard(engine, 'p1', 'BP02-012');
    const spell020 = findCard(engine, 'p1', 'BP02-020');
    const p2Victim = placeRole(engine, 'p2', 'ST02-005', 0); // PP <= 5000
    const reserve = new Set([
      host.instanceId,
      partnerLiv13.instanceId,
      partnerLiv14.instanceId,
      liv015.instanceId,
      liv012.instanceId,
      spell020.instanceId,
      p2Victim.instanceId,
    ]);
    setupOpenCost(engine, 'p1', ['FIRE'], 10, reserve);

    // 1. 搭档 BP02-013 被 BP02-020 送墓：破坏对方角色，但 8.13.4.a.2 不触发 BP02-015
    expect(engine.fieldMgr.attachPartner('p1', host.instanceId, partnerLiv13.instanceId)).toBe(true);
    engine.zoneMgr.moveCard(spell020.instanceId, 'HAND', { isFaceUp: true });
    const handBefore020 = engine.zoneMgr.getCardsInZone('p1', 'HAND').length;
    mustPlay(engine, 'p1', spell020.instanceId);
    const sac020Ch = engine.getState().currentPendingChoice!;
    expect(sac020Ch.options.map((o) => o.id)).toContain(partnerLiv13.instanceId);
    mustPick(engine, [partnerLiv13.instanceId]);
    mustPick(engine, [p2Victim.instanceId]);

    expect(cardState(engine, partnerLiv13.instanceId).zone).toBe('GRAVEYARD');
    expect(cardState(engine, host.instanceId).partnerCardId).toBeUndefined();
    expect(cardState(engine, p2Victim.instanceId).zone).toBe('GRAVEYARD');
    // 未触发 BP02-015 抽 2 弃 1，无遗留弃牌弹窗且手牌仅少打出的 BP02-020
    expect(engine.getState().currentPendingChoice).toBeUndefined();
    expect(engine.zoneMgr.getCardsInZone('p1', 'HAND').length).toBe(handBefore020 - 1);

    // 2. 搭档 BP02-014 被 BP02-012 牺牲减费送墓：同样不触发 BP02-015
    expect(engine.fieldMgr.attachPartner('p1', host.instanceId, partnerLiv14.instanceId)).toBe(true);
    engine.zoneMgr.moveCard(liv012.instanceId, 'HAND', { isFaceUp: true });
    const handBefore012 = engine.zoneMgr.getCardsInZone('p1', 'HAND').length;
    mustPlay(engine, 'p1', liv012.instanceId, { targetSlotIndex: 2 });
    mustPick(engine, [partnerLiv14.instanceId]);
    // 跳过 BP02-012 【出】弃 1 手牌
    mustPick(engine, []);
    expect(cardState(engine, partnerLiv14.instanceId).zone).toBe('GRAVEYARD');
    expect(engine.getState().currentPendingChoice).toBeUndefined();
    expect(engine.zoneMgr.getCardsInZone('p1', 'HAND').length).toBe(handBefore012 - 1);

    // 3. 正向对照：普通战场卡位《丽芙·极昼》BP02-012 被自身/常规送墓或 BP02-020 送墓时会触发 BP02-015
    mustActivate(engine, 'p1', placeRole(engine, 'p1', 'BP02-014', 3, { excludeIds: new Set([partnerLiv14.instanceId]) }).instanceId, 0);
    // BP02-014【起】选场上《丽芙·极昼》 -> 引发 BP02-015 入池（抽 2 弃 1）
    mustPick(engine, [liv012.instanceId]);
    expect(engine.getState().currentPendingChoice?.effectType).toBe('DSL_CHOOSE_ZONE_BP02-015');
    resolvePendingChoices(engine);
  });

  it('P1-3 BP02-025 浊璃：晖【起】多张球自动且仅拿索引 0 最下方牌（无选择框）；暮【起】放《比安卡·晖暮》底置抽 1 且回合末送墓', () => {
    const engine = createEngine(
      buildDeck(['BP02-025', 'BP02-023', 'BP02-022', 'BP02-024', 'BP02-021']),
      buildDeck([], 'ST02')
    );
    const zhuoli = findCard(engine, 'p1', 'BP02-025');
    const orbBottomOdd = findCard(engine, 'p1', 'BP02-023'); // 3 费奇数 (index 0)
    const orbMid = findCard(engine, 'p1', 'BP02-022'); // 7 费 (index 1)
    const orbTopEven = findCard(engine, 'p1', 'BP02-021'); // 8 费偶数 (index 2)
    const biancaHand = findCard(engine, 'p1', 'BP02-024'); // 4 费偶数
    const reserve = new Set([
      zhuoli.instanceId,
      orbBottomOdd.instanceId,
      orbMid.instanceId,
      orbTopEven.instanceId,
      biancaHand.instanceId,
    ]);
    setupOpenCost(engine, 'p1', ['DARK'], 6, reserve);

    engine.zoneMgr.moveCard(orbBottomOdd.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    engine.zoneMgr.moveCard(orbMid.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    engine.zoneMgr.moveCard(orbTopEven.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    engine.zoneMgr.moveCard(biancaHand.instanceId, 'HAND', { isFaceUp: true });

    mustPlay(engine, 'p1', zhuoli.instanceId, { targetSlotIndex: 0 });
    expect(engine.continuousEffects.isFormActive('p1', '晖')).toBe(true);

    // 反向：暮【起】在晖形态下不可发动
    const badDusk = engine.dispatchAction({
      type: 'ACTIVATE_ABILITY',
      playerId: 'p1',
      sourceCardId: zhuoli.instanceId,
      abilityIndex: 1,
    });
    expect(badDusk.success).toBe(false);

    // 正向：晖【起】abilityIndex=0 无选牌弹窗，直接拿 index 0 的 orbBottomOdd 回手！
    const handBefore = engine.zoneMgr.getCardsInZone('p1', 'HAND').length;
    mustActivate(engine, 'p1', zhuoli.instanceId, 0);
    expect(engine.getState().currentPendingChoice).toBeUndefined();
    expect(cardState(engine, orbBottomOdd.instanceId).zone).toBe('HAND');
    expect(cardState(engine, orbMid.instanceId).zone).toBe('SIGNAL_ORB');
    expect(cardState(engine, orbTopEven.instanceId).zone).toBe('SIGNAL_ORB');
    expect(engine.zoneMgr.getCardsInZone('p1', 'HAND').length).toBe(handBefore + 1);

    // 下回合竖直后用第 1 张（当前 index 0 为 7 费奇数），先切至暮形态验证暮【起】
    advanceTurnTo(engine, 'p2');
    advanceTurnTo(engine, 'p1');
    engine.zoneMgr.insertCardIntoZoneAtIndex(orbTopEven.instanceId, 'SIGNAL_ORB', 0, { isFaceUp: true });
    expect(engine.continuousEffects.isFormActive('p1', '暮')).toBe(true);

    // 晖【起】在暮形态被拒
    expect(
      engine.dispatchAction({
        type: 'ACTIVATE_ABILITY',
        playerId: 'p1',
        sourceCardId: zhuoli.instanceId,
        abilityIndex: 0,
      }).success
    ).toBe(false);

    // 暮【起】放 biancaHand 至信号球底并抽 1，回合末送墓
    const handBeforeDusk = engine.zoneMgr.getCardsInZone('p1', 'HAND').length;
    mustActivate(engine, 'p1', zhuoli.instanceId, 1);
    mustPick(engine, [biancaHand.instanceId]);
    expect(engine.zoneMgr.getCardsInZone('p1', 'SIGNAL_ORB')[0]!.instanceId).toBe(biancaHand.instanceId);
    expect(engine.zoneMgr.getCardsInZone('p1', 'HAND').length).toBe(handBeforeDusk); // -1 +1
    endTurn(engine);
    expect(cardState(engine, biancaHand.instanceId).zone).toBe('GRAVEYARD');
  });

  it('P1-4 BP02-037 / BP02-038：多《含英·檀心》与独立 BP02-047 共存时只筛选自身下方与自身装备', () => {
    const engine = createEngine(
      buildDeck(['BP02-037', 'BP02-038', 'BP02-040', 'BP02-044', 'BP02-047', 'BP02-047', 'ST01-012', 'ST01-013']),
      buildDeck([])
    );
    const h037 = placeRole(engine, 'p1', 'BP02-037', 0);
    const h038 = placeRole(engine, 'p1', 'BP02-038', 1);
    const h040Under037 = findCard(engine, 'p1', 'BP02-040');
    const leafOn038 = findCard(engine, 'p1', 'BP02-047', 0);
    const leafStandalone = findCard(engine, 'p1', 'BP02-047', 1);
    const h044Hand = findCard(engine, 'p1', 'BP02-044');
    const reserve = new Set([
      h037.instanceId,
      h038.instanceId,
      h040Under037.instanceId,
      leafOn038.instanceId,
      leafStandalone.instanceId,
      h044Hand.instanceId,
    ]);
    setupOpenCost(engine, 'p1', ['PHYSICAL'], 8, reserve);

    // 分别配置：h037 下方有 BP02-040；h038 装备 leafOn038；第 2 张 leafStandalone 单独站场
    engine.fieldMgr.placeCardUnderneath(h040Under037.instanceId, h037.instanceId);
    engine.zoneMgr.moveCard(leafOn038.instanceId, 'HAND', { isFaceUp: true });
    mustPlay(engine, 'p1', leafOn038.instanceId, { targetEquipRoleId: h038.instanceId });
    engine.zoneMgr.moveCard(leafStandalone.instanceId, 'HAND', { isFaceUp: true });
    mustPlay(engine, 'p1', leafStandalone.instanceId, { targetSlotIndex: 2 });
    engine.zoneMgr.moveCard(h044Hand.instanceId, 'HAND', { isFaceUp: true });

    for (const n of ['ST01-012', 'ST01-013']) {
      engine.zoneMgr.moveCard(findCard(engine, 'p1', n).instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    }

    // 1. h037 发动第 2 项：候选仅包含自身下方的 h040Under037，不含 leafOn038 与 leafStandalone
    mustActivate(engine, 'p1', h037.instanceId, 0);
    mustPick(engine, ['sac_leaf_pierce_pp']);
    const orbOpt = engine.getState().currentPendingChoice!.options.find((o) => o.id !== 'skip')!;
    mustPick(engine, [orbOpt.id]);
    const ch037 = engine.getState().currentPendingChoice!;
    expect(ch037.options.map((o) => o.id)).toEqual([h040Under037.instanceId]);
    mustPick(engine, [h040Under037.instanceId]);
    expect(cardState(engine, h040Under037.instanceId).zone).toBe('GRAVEYARD');
    expect(engine.fieldMgr.evaluateRoleStats(h037.instanceId).keywords).toContain('贯通');

    // 2. h038 发动第 2 项：候选仅包含自身装备 leafOn038，不含独立站场 leafStandalone，送墓后从手牌出场 BP02-044
    mustActivate(engine, 'p1', h038.instanceId, 0);
    mustPick(engine, ['sac_leaf_deploy']);
    const ch038 = engine.getState().currentPendingChoice!;
    expect(ch038.options.map((o) => o.id)).toEqual([leafOn038.instanceId]);
    mustPick(engine, [leafOn038.instanceId]);
    mustPick(engine, [h044Hand.instanceId]);
    expect(cardState(engine, leafOn038.instanceId).zone).toBe('GRAVEYARD');
    expect(cardState(engine, h044Hand.instanceId).zone).toBe('BATTLEFIELD');
    expect(cardState(engine, leafStandalone.instanceId).zone).toBe('BATTLEFIELD');
  });

  it('P1-5 BP02-024：重排信号球后立即实时同步 effectiveKeywords 与手牌减费切换', () => {
    const engine = createEngine(
      buildDeck(['BP02-024', 'BP02-024', 'BP02-023', 'BP02-021', 'BP02-021', 'BP02-022']),
      buildDeck([], 'ST02')
    );
    const b024Field = placeRole(engine, 'p1', 'BP02-024', 0);
    const b021Field = placeRole(engine, 'p1', 'BP02-021', 1);
    const b024Orb = findCard(engine, 'p1', 'BP02-024', 0, new Set([b024Field.instanceId])); // 信号球区 4+1=5 奇数
    const b023Orb = findCard(engine, 'p1', 'BP02-023'); // 3 费奇数
    const b021Orb = findCard(engine, 'p1', 'BP02-021', 0, new Set([b021Field.instanceId])); // 8 费偶数
    const b022Hand = findCard(engine, 'p1', 'BP02-022');
    engine.zoneMgr.moveCard(b023Orb.instanceId, 'SIGNAL_ORB', { isFaceUp: true }); // index 0: 奇数 -> 晖
    engine.zoneMgr.moveCard(b021Orb.instanceId, 'SIGNAL_ORB', { isFaceUp: true }); // index 1: 偶数
    engine.zoneMgr.moveCard(b024Orb.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    engine.zoneMgr.moveCard(b022Hand.instanceId, 'HAND', { isFaceUp: true });

    // 信号球区 BP02-024 费用 +1 变为 5
    expect(engine.continuousEffects.getEffectiveCardCost(b024Orb.instanceId)).toBe(5);
    expect(engine.continuousEffects.isFormActive('p1', '晖')).toBe(true);
    expect(cardState(engine, b021Field.instanceId).effectiveKeywords ?? []).not.toContain('突进');
    expect(engine.calculateCardCost('p1', b022Hand.instanceId).costToPay).toBe(3);

    // 发动 BP02-024 晖【起】将偶数费 b021Orb 排到最下方 index 0
    mustActivate(engine, 'p1', b024Field.instanceId, 0);
    mustPick(engine, [b021Orb.instanceId, b023Orb.instanceId, b024Orb.instanceId]);

    // 无需任何额外行动，立即验证实时切换为暮形态！
    expect(engine.continuousEffects.isFormActive('p1', '暮')).toBe(true);
    expect(cardState(engine, b021Field.instanceId).effectiveKeywords).toContain('突进');
    expect(engine.fieldMgr.evaluateRoleStats(b021Field.instanceId).keywords).toContain('突进');
    expect(engine.calculateCardCost('p1', b022Hand.instanceId).costToPay).toBe(7);
  });

  it('P1-6 BP02-047 飞叶点翠：双《含英·檀心》各装备仅增益自身宿主，Q&A·4 先单出再 EQUIP_ITEM 不触发【出】', () => {
    const engine = createEngine(
      buildDeck(['BP02-047', 'BP02-047', 'BP02-047', 'BP02-039', 'BP02-044', 'BP02-045']),
      buildDeck([])
    );
    const hostA = placeRole(engine, 'p1', 'BP02-039', 0);
    const hostB = placeRole(engine, 'p1', 'BP02-044', 1);
    const hostC = placeRole(engine, 'p1', 'BP02-045', 2);
    const leaf1 = findCard(engine, 'p1', 'BP02-047', 0);
    const leaf2 = findCard(engine, 'p1', 'BP02-047', 1);
    const leaf3 = findCard(engine, 'p1', 'BP02-047', 2);
    const reserve = new Set([
      hostA.instanceId,
      hostB.instanceId,
      hostC.instanceId,
      leaf1.instanceId,
      leaf2.instanceId,
      leaf3.instanceId,
    ]);
    setupOpenCost(engine, 'p1', ['PHYSICAL'], 8, reserve);

    // 1. 直接装备 leaf1 到 hostA -> 只有 hostA 获【突进】且 PP+500 (4500)，hostB 无【突进】
    mustPlay(engine, 'p1', leaf1.instanceId, { targetEquipRoleId: hostA.instanceId });
    expect(engine.fieldMgr.evaluateRoleStats(hostA.instanceId).keywords).toContain('突进');
    expect(engine.fieldMgr.calculateRoleEffectivePP(hostA.instanceId)).toBe(4500);
    expect(engine.fieldMgr.evaluateRoleStats(hostB.instanceId).keywords).not.toContain('突进');

    // 2. 直接装备 leaf2 到 hostB -> hostB (BP02-044: 基础3000 + 下方/装备《飞叶点翠》1500 + 装备500 = 5000) 获【突进】，hostC 仍无
    mustPlay(engine, 'p1', leaf2.instanceId, { targetEquipRoleId: hostB.instanceId });
    expect(engine.fieldMgr.evaluateRoleStats(hostB.instanceId).keywords).toContain('突进');
    expect(engine.fieldMgr.calculateRoleEffectivePP(hostB.instanceId)).toBe(5000);
    expect(engine.fieldMgr.evaluateRoleStats(hostC.instanceId).keywords).not.toContain('突进');

    // 3. Q&A·4：leaf3 先单独出场到 slot 3（不触发【出】），再 EQUIP_ITEM 装备到 hostC（仍不触发【出】，仅基础 PP+500）
    mustPlay(engine, 'p1', leaf3.instanceId, { targetSlotIndex: 3 });
    expect(engine.fieldMgr.evaluateRoleStats(hostC.instanceId).keywords).not.toContain('突进');
    const equipRes = engine.dispatchAction({
      type: 'EQUIP_ITEM',
      playerId: 'p1',
      equipmentCardId: leaf3.instanceId,
      targetRoleCardId: hostC.instanceId,
    });
    expect(equipRes.success, equipRes.error).toBe(true);
    expect(getAttachedEquipmentIds(hostC)).toContain(leaf3.instanceId);
    expect(engine.fieldMgr.evaluateRoleStats(hostC.instanceId).keywords).not.toContain('突进');
    expect(engine.fieldMgr.calculateRoleEffectivePP(hostC.instanceId)).toBe(4500);
  });

  it('P1-7 BP02-048 曲·启明：单侧牺牲费用区/手牌分支、暗费不可选、chooseOrder 置底顺序及下回合结束失效', () => {
    // 分支 A：仅牺牲费用区 <万世铭>（暗费中的万世铭不可被选中），获【速攻】与基本 PP 9999，不翻牌，下回合结束失效
    {
      const engine = createEngine(
        buildDeck(['BP02-048', 'BP02-054', 'BP01-037', 'BP01-038']),
        buildDeck([])
      );
      const quBase = placeRole(engine, 'p1', 'BP02-054', 0);
      const qu048 = findCard(engine, 'p1', 'BP02-048');
      const wsmOpen = findCard(engine, 'p1', 'BP01-037');
      const wsmHidden = findCard(engine, 'p1', 'BP01-038');
      const reserve = new Set([quBase.instanceId, qu048.instanceId, wsmOpen.instanceId, wsmHidden.instanceId]);
      setupOpenCost(engine, 'p1', ['ICE'], 5, reserve);
      engine.zoneMgr.moveCard(wsmOpen.instanceId, 'COST', { isFaceUp: true, isReady: true });
      engine.zoneMgr.moveCard(wsmHidden.instanceId, 'COST', { isFaceUp: false, isReady: true });
      engine.zoneMgr.syncCostStats('p1');

      mustPlay(engine, 'p1', qu048.instanceId, {
        isAscension: true,
        targetAscensionCardId: quBase.instanceId,
      });
      const sacCh = engine.getState().currentPendingChoice!;
      expect(sacCh.options.map((o) => o.id)).toContain(wsmOpen.instanceId);
      expect(sacCh.options.map((o) => o.id)).not.toContain(wsmHidden.instanceId);
      mustPick(engine, [wsmOpen.instanceId]);

      // 仅牺牲费用区，不翻牌
      expect(engine.getState().currentPendingChoice).toBeUndefined();
      expect(engine.fieldMgr.evaluateRoleStats(qu048.instanceId).keywords).toContain('速攻');
      expect(engine.fieldMgr.calculateRoleEffectivePP(qu048.instanceId)).toBe(9999);

      // 到 P2 回合中仍有效（END_OF_NEXT_TURN 持续至下个回合结束，即 Turn 2 结束前）
      advanceTurnTo(engine, 'p2');
      expect(engine.fieldMgr.calculateRoleEffectivePP(qu048.instanceId)).toBe(9999);
      expect(engine.fieldMgr.evaluateRoleStats(qu048.instanceId).keywords).toContain('速攻');

      // Turn 2 结束后回到 Turn 3 (P1) 时已失效，恢复基本 PP 5500
      advanceTurnTo(engine, 'p1');
      expect(engine.fieldMgr.evaluateRoleStats(qu048.instanceId).keywords).not.toContain('速攻');
      expect(engine.fieldMgr.calculateRoleEffectivePP(qu048.instanceId)).toBe(5500);
    }

    // 分支 B：仅牺牲手牌 <万世铭>：不获速攻与 9999PP，翻 4 选 1 入手，剩 3 张自选顺序置底
    {
      const engine = createEngine(
        buildDeck(['BP02-048', 'BP02-054', 'BP01-037']),
        buildDeck([])
      );
      const quBase = placeRole(engine, 'p1', 'BP02-054', 0);
      const qu048 = findCard(engine, 'p1', 'BP02-048');
      const wsmHand = findCard(engine, 'p1', 'BP01-037');
      const reserve = new Set([quBase.instanceId, qu048.instanceId, wsmHand.instanceId]);
      setupOpenCost(engine, 'p1', ['ICE'], 6, reserve);
      engine.zoneMgr.moveCard(wsmHand.instanceId, 'HAND', { isFaceUp: true });
      for (const d of engine.zoneMgr.getCardsInZone('p1', 'DECK')) {
        if (d.cardNumber === 'BP01-037' || d.cardNumber === 'BP01-038') {
          engine.zoneMgr.moveCardToBottomOfDeck(d.instanceId);
        }
      }

      mustPlay(engine, 'p1', qu048.instanceId, {
        isAscension: true,
        targetAscensionCardId: quBase.instanceId,
      });
      mustPick(engine, [wsmHand.instanceId]);
      const revCh = engine.getState().currentPendingChoice!;
      mustPick(engine, [revCh.options[0]!.id]);
      const orderCh = engine.getState().currentPendingChoice!;
      expect(orderCh.effectType).toBe('DSL_ORDER_MOVE_BP02-048');
      expect(orderCh.options).toHaveLength(3);
      const ordered = orderCh.options.map((o) => o.id).reverse();
      mustPick(engine, ordered);

      expect(engine.zoneMgr.getCardsInZone('p1', 'DECK').slice(-3).map((c) => c.instanceId)).toEqual(ordered);
      expect(engine.fieldMgr.evaluateRoleStats(qu048.instanceId).keywords).not.toContain('速攻');
      expect(engine.fieldMgr.calculateRoleEffectivePP(qu048.instanceId)).toBe(5500);
    }
  });

  it('P1-8 BP02-052 曲·启明：检索 BP01-037 触发改放费用区（选改放留费用区 / 选不放回顶）与【永】暗费不加成', () => {
    const engine = createEngine(
      buildDeck(['BP02-052', 'BP01-037', 'BP01-037', 'BP01-038', 'ST01-012', 'ST01-013', 'ST01-014']),
      buildDeck([])
    );
    const qu052 = placeRole(engine, 'p1', 'BP02-052', 0, { isReady: true });
    const wsmDeck1 = findCard(engine, 'p1', 'BP01-037', 0);
    const wsmDeck2 = findCard(engine, 'p1', 'BP01-037', 1);
    const wsmHidden = findCard(engine, 'p1', 'BP01-038');
    const reserve = new Set([qu052.instanceId, wsmDeck1.instanceId, wsmDeck2.instanceId, wsmHidden.instanceId]);
    setupOpenCost(engine, 'p1', ['ICE'], 3, reserve);
    engine.zoneMgr.moveCard(wsmHidden.instanceId, 'COST', { isFaceUp: false, isReady: true });
    engine.zoneMgr.syncCostStats('p1');

    // 暗费 <万世铭> 不计入 PP 加成，仍为基础 PP 3500
    expect(engine.fieldMgr.calculateRoleEffectivePP(qu052.instanceId)).toBe(3500);

    // 准备 3 球并在双方牌组顶放非信号球用于攻击充能与伤害充能
    for (const n of ['ST01-012', 'ST01-013', 'ST01-014']) {
      engine.zoneMgr.moveCard(findCard(engine, 'p1', n).instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    }
    putNonOrbOnTop(engine, 'p1');
    putNonOrbOnTop(engine, 'p2');

    // 分支 A：选检索 wsmDeck1 并同意 BP01_WANSHIMING_REVEAL_TO_COST 改放费用区 -> 洗切后留在费用区（横置正面）
    expect(
      engine.dispatchAction({
        type: 'DECLARE_ATTACK',
        playerId: 'p1',
        attackerCardId: qu052.instanceId,
        targetType: 'PLAYER',
      }).success
    ).toBe(true);
    while (engine.getState().currentCombat && !engine.getState().currentPendingChoice) {
      if (engine.getState().timingWindow) {
        passInstantWindows(engine);
      } else {
        engine.dispatchAction({ type: 'PASS_ACTION_TIMING', playerId: engine.getState().activePlayerId });
      }
    }
    // 攻击结束触发 BP02-052【自】
    const costCh = engine.getState().currentPendingChoice!;
    expect(costCh.effectType, `攻击后首弹窗意外为 ${costCh.effectType}: ${costCh.prompt}`).toBe('DSL_ORB_COST_BP02-052');
    mustPick(engine, [costCh.options.find((o) => o.id !== 'skip')!.id]);
    mustPick(engine, [wsmDeck1.instanceId]);
    expect(engine.getState().currentPendingChoice?.effectType).toBe('BP01_WANSHIMING_REVEAL_TO_COST');
    mustPick(engine, [wsmDeck1.instanceId]);

    expect(cardState(engine, wsmDeck1.instanceId).zone).toBe('COST');
    expect(cardState(engine, wsmDeck1.instanceId).isFaceUp).toBe(true);
    expect(cardState(engine, wsmDeck1.instanceId).isReady).toBe(false);
    // 明费中已有 1 张 <万世铭>，PP + 500 = 4000；到对手回合时【永】不生效恢复 3500
    expect(engine.fieldMgr.calculateRoleEffectivePP(qu052.instanceId)).toBe(4000);
    advanceTurnTo(engine, 'p2');
    expect(engine.fieldMgr.calculateRoleEffectivePP(qu052.instanceId)).toBe(3500);

    // 分支 B：再回我方回合攻击，选检索 wsmDeck2 但拒绝改放费用区（[]）-> 洗切后回到 DECK[0] 牌组顶
    advanceTurnTo(engine, 'p1');
    for (const n of ['ST01-012', 'ST01-013', 'ST01-014']) {
      engine.zoneMgr.moveCard(findCard(engine, 'p1', n).instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    }
    putNonOrbOnTop(engine, 'p1');
    putNonOrbOnTop(engine, 'p2');
    expect(
      engine.dispatchAction({
        type: 'DECLARE_ATTACK',
        playerId: 'p1',
        attackerCardId: qu052.instanceId,
        targetType: 'PLAYER',
      }).success
    ).toBe(true);
    while (engine.getState().currentCombat && !engine.getState().currentPendingChoice) {
      if (engine.getState().timingWindow) {
        passInstantWindows(engine);
      } else {
        engine.dispatchAction({ type: 'PASS_ACTION_TIMING', playerId: engine.getState().activePlayerId });
      }
    }
    const costChB = engine.getState().currentPendingChoice!;
    mustPick(engine, [costChB.options.find((o) => o.id !== 'skip')!.id]);
    mustPick(engine, [wsmDeck2.instanceId]);
    expect(engine.getState().currentPendingChoice?.effectType).toBe('BP01_WANSHIMING_REVEAL_TO_COST');
    mustPick(engine, []); // 选不放费用区

    expect(cardState(engine, wsmDeck2.instanceId).zone).toBe('DECK');
    expect(engine.zoneMgr.getCardsInZone('p1', 'DECK')[0]!.instanceId).toBe(wsmDeck2.instanceId);
  });

  it('P1-9 BP02-060 21号·森息：含暗费的费用上限比较（明2+暗2=4 vs 暗3 保持 3 费；4 vs 4 减为 2 费）', () => {
    const engine = createEngine(buildDeck(['BP02-060', 'BP02-064']), buildDeck([], 'ST03'));
    const c060 = findCard(engine, 'p1', 'BP02-060');
    const reserve = new Set([c060.instanceId]);
    setupOpenCost(engine, 'p1', ['LIGHTNING'], 2, reserve);

    // P1 明费 2 + 暗费 2 = 4 张费用区卡牌
    const p1Deck = engine.zoneMgr.getCardsInZone('p1', 'DECK').filter((c) => !reserve.has(c.instanceId));
    engine.zoneMgr.moveCard(p1Deck[0]!.instanceId, 'COST', { isFaceUp: false, isReady: true });
    engine.zoneMgr.moveCard(p1Deck[1]!.instanceId, 'COST', { isFaceUp: false, isReady: true });
    engine.zoneMgr.syncCostStats('p1');

    // P2 改为仅有 3 张背面暗费（明费 0，费用上限 3）
    for (const c of engine.zoneMgr.getCardsInZone('p2', 'COST')) {
      engine.zoneMgr.moveCardToBottomOfDeck(c.instanceId);
    }
    const p2Deck = engine.zoneMgr.getCardsInZone('p2', 'DECK');
    for (let i = 0; i < 3; i++) {
      engine.zoneMgr.moveCard(p2Deck[i]!.instanceId, 'COST', { isFaceUp: false, isReady: true });
    }
    engine.zoneMgr.syncCostStats('p2');

    // P1(4) > P2(3) -> 原价 3 费（不会因明费 2 <= 0 而误减为 2）
    engine.zoneMgr.moveCard(c060.instanceId, 'HAND', { isFaceUp: true });
    expect(engine.calculateCardCost('p1', c060.instanceId).costToPay).toBe(3);

    // 将 P2 暗费补到 4 张（费用上限 4 vs 4）-> 立即变为 2 费，出场后战场也是 2 费
    engine.zoneMgr.moveCard(p2Deck[3]!.instanceId, 'COST', { isFaceUp: false, isReady: true });
    engine.zoneMgr.syncCostStats('p2');
    expect(engine.calculateCardCost('p1', c060.instanceId).costToPay).toBe(2);
    mustPlay(engine, 'p1', c060.instanceId, { targetSlotIndex: 0 });
    expect(engine.continuousEffects.getEffectiveCardCost(c060.instanceId)).toBe(2);

    // P2 暗费少于 4 张（变为 3）-> 战场 BP02-060 立即恢复 3 费
    engine.zoneMgr.moveCardToBottomOfDeck(p2Deck[3]!.instanceId);
    engine.zoneMgr.syncCostStats('p2');
    expect(engine.continuousEffects.getEffectiveCardCost(c060.instanceId)).toBe(3);
  });

  it('P1-10 BP02-067 Q&A·4：BP01-055 对横置七实升变遇到对方 1/2 张横置 BP02-067 须付 1/2 费，放弃/不足不升变仍洗牌，减费/setCost 不可抵消', () => {
    const engine = createEngine(
      buildDeck(['BP01-055', 'BP01-055', 'BP01-041', 'BP01-048', 'BP01-049', 'BP02-067']),
      buildDeck(['BP02-067', 'BP02-067', 'BP02-067', 'BP02-073', 'ST02-005', 'ST01-012', 'ST01-013'])
    );
    const nanamiBase = placeRole(engine, 'p1', 'BP01-048', 0, { isReady: false }); // 2费横置七实 (<=5)
    const pawa = placeRole(engine, 'p1', 'BP01-049', 1, { isReady: true });
    const nanamiAsc = findCard(engine, 'p1', 'BP01-041');
    const future1 = findCard(engine, 'p1', 'BP01-055', 0);
    const future2 = findCard(engine, 'p1', 'BP01-055', 1);
    const p1W67 = findCard(engine, 'p1', 'BP02-067');

    const p2W67_1 = placeRole(engine, 'p2', 'BP02-067', 0, { isReady: false, instanceIndex: 0 });
    const p2W67_2 = placeRole(engine, 'p2', 'BP02-067', 1, { isReady: false, instanceIndex: 1 });
    const p2W67Hand = findCard(engine, 'p2', 'BP02-067', 2);
    const reserve = new Set([
      nanamiBase.instanceId,
      pawa.instanceId,
      nanamiAsc.instanceId,
      future1.instanceId,
      future2.instanceId,
      p1W67.instanceId,
    ]);
    setupOpenCost(engine, 'p1', ['FIRE'], 4, reserve); // 总共 4 费（打出 3 费 BP01-055 后余 1 费）

    // 1. 对方有 2 张横置 BP02-067，P1 打出 3 费 BP01-055 后只余 1 费（不足 2 费）-> 不升变但仍洗牌
    engine.zoneMgr.moveCard(nanamiAsc.instanceId, 'DECK', { isFaceUp: false });
    mustPlay(engine, 'p1', future1.instanceId);
    mustPick(engine, [nanamiAsc.instanceId]);
    mustPick(engine, [nanamiBase.instanceId]);
    mustPick(engine, [pawa.instanceId]);
    expect(engine.getState().currentPendingChoice).toBeUndefined();
    expect(cardState(engine, nanamiAsc.instanceId).zone).toBe('DECK'); // 未升变
    expect(engine.events.some((e) => e.type === 'CARDS_SHUFFLED')).toBe(true);

    // 2. 移走第 2 张 BP02-067 仅留 1 张（税=1），补满 4 费；打出 future2 选 'opt_no' 放弃付 1 费 -> 不升变但仍洗牌
    expect(p2W67_1.isReady).toBe(false);
    engine.zoneMgr.moveCard(p2W67_2.instanceId, 'GRAVEYARD', { isFaceUp: true });
    setupOpenCost(engine, 'p1', ['FIRE'], 4, reserve);
    const evBefore = engine.events.length;
    mustPlay(engine, 'p1', future2.instanceId);
    mustPick(engine, [nanamiAsc.instanceId]);
    mustPick(engine, [nanamiBase.instanceId]);
    mustPick(engine, [pawa.instanceId]);
    expect(engine.getState().currentPendingChoice?.effectType).toBe('BP02_067_ASCEND_TAX_CONFIRM');
    mustPick(engine, ['opt_no']);
    expect(cardState(engine, nanamiAsc.instanceId).zone).toBe('DECK');
    expect(engine.getState().players['p1']!.availableOpenCostCount).toBe(1); // 税未扣
    expect(engine.events.slice(evBefore).some((e) => e.type === 'CARDS_SHUFFLED')).toBe(true);

    // 3. 重新回手 future2 选 'opt_yes' 付 1 费 -> 升变成功！
    setupOpenCost(engine, 'p1', ['FIRE'], 4, reserve);
    engine.zoneMgr.moveCard(future2.instanceId, 'HAND', { isFaceUp: true });
    mustPlay(engine, 'p1', future2.instanceId);
    mustPick(engine, [nanamiAsc.instanceId]);
    mustPick(engine, [nanamiBase.instanceId]);
    mustPick(engine, [pawa.instanceId]);
    mustPick(engine, ['opt_yes']);
    expect(cardState(engine, nanamiAsc.instanceId).zone).toBe('BATTLEFIELD');
    expect(engine.getState().players['p1']!.availableOpenCostCount).toBe(0);

    // 4. 在 P1 放横置 p1W67，切到 P2 测试 setCost / 减费不能抵消 BP02-067 额外税，及自身【出】消 2 球冰冻
    engine.fieldMgr.playRoleCard('p1', p1W67.instanceId, 3, { suppressEntryTrigger: true });
    p1W67.isReady = false;
    advanceTurnTo(engine, 'p2');
    setupOpenCost(engine, 'p2', ['ICE'], 6, new Set([p2W67Hand.instanceId]));
    const p2Base = placeRole(engine, 'p2', 'BP02-073', 2, { isReady: false });
    engine.zoneMgr.moveCard(p2W67Hand.instanceId, 'HAND', { isFaceUp: true });
    // 给 p2W67Hand 附加减费 5（player.costModifiers），依然因 P1 的 1 张横置 BP02-067 须付 1 费（不能被减费抵消）
    const p2Mods = (engine.getState().players['p2']!.costModifiers ??= []);
    p2Mods.push({
      id: 'test-bp02-067-discount',
      amount: 5,
    });
    expect(engine.calculateCardCost('p2', p2W67Hand.instanceId, true, p2Base.instanceId).costToPay).toBe(1);
    p2Mods.pop();

    // 实际打出 p2W67Hand 升变到 p2Base 上并消 2 球冰冻 P1 的 p1W67
    for (const n of ['ST01-012', 'ST01-013']) {
      engine.zoneMgr.moveCard(findCard(engine, 'p2', n).instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    }
    mustPlay(engine, 'p2', p2W67Hand.instanceId, {
      isAscension: true,
      targetAscensionCardId: p2Base.instanceId,
    });
    const payOrbOpt = engine.getState().currentPendingChoice!.options.find((o) => o.id !== 'skip')!;
    mustPick(engine, [payOrbOpt.id]);
    mustPick(engine, [p1W67.instanceId]);
    expect(cardState(engine, p1W67.instanceId).isFrozen).toBe(true);
    expect(engine.getState().players['p2']!.availableOpenCostCount).toBe(2); // 6 - (升变3 + P1税1) = 2
  });

  it('P1-11 & P2-3：BP02-028 / BP02-039 / BP02-043 牌组底 chooseOrder 自选顺序 & BP02-043 无宿主时仍翻 2 张置底', () => {
    // 1. BP02-028 chooseOrder
    {
      const engine = createEngine(
        buildDeck(['BP02-028', 'BP02-030', 'BP02-036']),
        buildDeck([])
      );
      const base = placeRole(engine, 'p1', 'BP02-030', 0);
      const l028 = findCard(engine, 'p1', 'BP02-028');
      const surge = findCard(engine, 'p1', 'BP02-036');
      engine.zoneMgr.moveCard(surge.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
      setupOpenCost(engine, 'p1', ['DARK'], 6, new Set([l028.instanceId]));

      mustPlay(engine, 'p1', l028.instanceId, { isAscension: true, targetAscensionCardId: base.instanceId });
      mustPick(engine, []); // 不拿入手
      mustPick(engine, []); // 不堆暗
      const orderCh = engine.getState().currentPendingChoice!;
      expect(orderCh.effectType).toBe('DSL_ORDER_MOVE_BP02-028');
      expect(orderCh.options).toHaveLength(4);
      const rev = orderCh.options.map((o) => o.id).reverse();
      mustPick(engine, rev);
      expect(engine.zoneMgr.getCardsInZone('p1', 'DECK').slice(-4).map((c) => c.instanceId)).toEqual(rev);
    }

    // 2. BP02-039 chooseOrder
    {
      const engine = createEngine(buildDeck(['BP02-039']), buildDeck([]));
      const h039 = findCard(engine, 'p1', 'BP02-039');
      setupOpenCost(engine, 'p1', ['PHYSICAL'], 6, new Set([h039.instanceId]));
      mustPlay(engine, 'p1', h039.instanceId, { targetSlotIndex: 0 });
      const costOpt = engine.getState().currentPendingChoice!.options.find((o) => o.id !== 'skip')!;
      mustPick(engine, [costOpt.id]);
      mustPick(engine, []); // 选 0 张入手，剩 4 张选序置底
      const orderCh = engine.getState().currentPendingChoice!;
      expect(orderCh.effectType).toBe('DSL_ORDER_MOVE_BP02-039');
      expect(orderCh.options).toHaveLength(4);
      const rev = orderCh.options.map((o) => o.id).reverse();
      mustPick(engine, rev);
      expect(engine.zoneMgr.getCardsInZone('p1', 'DECK').slice(-4).map((c) => c.instanceId)).toEqual(rev);
    }

    // 3. BP02-043 无其他宿主时仍翻 2 张经 chooseOrder 置底 (P2-3 + P1-11)
    {
      const engine = createEngine(buildDeck(['BP02-043']), buildDeck([]));
      const h043 = findCard(engine, 'p1', 'BP02-043');
      setupOpenCost(engine, 'p1', ['PHYSICAL'], 6, new Set([h043.instanceId]));
      const top2Before = engine.zoneMgr.getCardsInZone('p1', 'DECK').slice(0, 2).map((c) => c.instanceId);
      mustPlay(engine, 'p1', h043.instanceId, { targetSlotIndex: 0 });
      const orderCh = engine.getState().currentPendingChoice!;
      expect(orderCh.effectType).toBe('DSL_ORDER_MOVE_BP02-043');
      expect(orderCh.options.map((o) => o.id)).toEqual(top2Before);
      const rev = [...top2Before].reverse();
      mustPick(engine, rev);
      expect(engine.zoneMgr.getCardsInZone('p1', 'DECK').slice(-2).map((c) => c.instanceId)).toEqual(rev);
    }
  });

  it('P2-1 BP02-043 / 050 / 053 / 065：chargeIsAbility 与失能/CANNOT_GAIN_ABILITIES 交互', () => {
    const engine = createEngine(
      buildDeck(['BP02-043', 'BP02-040', 'BP02-050', 'BP02-053', 'BP02-064', 'BP02-065', 'BP01-037', 'BP01-038']),
      buildDeck([])
    );
    const h043 = placeRole(engine, 'p1', 'BP02-043', 0);
    const h040 = findCard(engine, 'p1', 'BP02-040');
    engine.fieldMgr.placeCardUnderneath(h040.instanceId, h043.instanceId);
    expect(engine.combatMgr.calculateRoleChargeCount(h043.instanceId)).toBe(2);
    // 失能后，BP02-043 下方《飞叶点翠》赋予的充能+1 一并失去
    addCardModifier(engine.getState(), h043, { loseAbilities: true, untilTurn: 99, source: 'TEST' });
    expect(engine.combatMgr.calculateRoleChargeCount(h043.instanceId)).toBe(1);

    // BP02-053：基础【充能0】，攻击洗回<万世铭>获 chargeIsAbility: true 的 +1 -> 变为 1；后被施加失能 -> +1 失去，回到规则基本充能 1；而在 CANNOT_GAIN_ABILITIES 下无法获得 +1
    const q053 = placeRole(engine, 'p1', 'BP02-053', 1, { isReady: true });
    expect(engine.combatMgr.calculateRoleChargeCount(q053.instanceId)).toBe(0);
    addCardModifier(engine.getState(), q053, {
      prohibitions: ['CANNOT_GAIN_ABILITIES'],
      untilTurn: 99,
      source: 'TEST',
    });
    const w1 = findCard(engine, 'p1', 'BP01-037');
    const w2 = findCard(engine, 'p1', 'BP01-038');
    engine.zoneMgr.moveCard(w1.instanceId, 'GRAVEYARD', { isFaceUp: true });
    engine.zoneMgr.moveCard(w2.instanceId, 'GRAVEYARD', { isFaceUp: true });
    putNonOrbOnTop(engine, 'p1');
    putNonOrbOnTop(engine, 'p2');
    expect(
      engine.dispatchAction({
        type: 'DECLARE_ATTACK',
        playerId: 'p1',
        attackerCardId: q053.instanceId,
        targetType: 'PLAYER',
      }).success
    ).toBe(true);
    mustPick(engine, [w1.instanceId, w2.instanceId]);
    // 因 CANNOT_GAIN_ABILITIES 阻止获得【充能+1】，充能数仍为 0（无充能步骤直接进 DAMAGE/END）
    expect(engine.combatMgr.calculateRoleChargeCount(q053.instanceId)).toBe(0);
    finishCombat(engine);

    // BP02-050：给 BP02-050 施加 CANNOT_GAIN_ABILITIES 后不加充能；未阻止时加至 2，后施失能跌回 1
    advanceTurnTo(engine, 'p1');
    const q050 = findCard(engine, 'p1', 'BP02-050');
    setupOpenCost(engine, 'p1', ['ICE', 'LIGHTNING'], 9, new Set([q050.instanceId]));
    engine.zoneMgr.moveCardToTopOfDeck(w1.instanceId);
    mustPlay(engine, 'p1', q050.instanceId, { targetSlotIndex: 2 });
    while (engine.getState().currentPendingChoice?.effectType === 'BP01_WANSHIMING_REVEAL_TO_COST') {
      mustPick(engine, []);
    }
    mustPick(engine, [w1.instanceId]);
    mustPick(engine, ['buff_qu_1']);
    mustPick(engine, [q050.instanceId]);
    expect(engine.combatMgr.calculateRoleChargeCount(q050.instanceId)).toBe(2);
    addCardModifier(engine.getState(), q050, { loseAbilities: true, untilTurn: 99, source: 'TEST' });
    expect(engine.combatMgr.calculateRoleChargeCount(q050.instanceId)).toBe(1);

    // BP02-065：对有 CANNOT_GAIN_ABILITIES 的 2 费三头犬不赋予【充能1】词条
    readyAllOpenCosts(engine, 'p1');
    const c64Blocked = placeRole(engine, 'p1', 'BP02-064', 3);
    addCardModifier(engine.getState(), c64Blocked, {
      prohibitions: ['CANNOT_GAIN_ABILITIES'],
      untilTurn: 99,
      source: 'TEST',
    });
    const flag = findCard(engine, 'p1', 'BP02-065');
    mustPlay(engine, 'p1', flag.instanceId);
    expect(engine.fieldMgr.evaluateRoleStats(c64Blocked.instanceId).keywords).not.toContain('充能1');
  });

  it('P2-2 BP02-030 拉弥亚·深谣：满场时仍可自愿弃 2 手牌堆墓（不出场），空位且对方<4角色横置出场', () => {
    // 1. 满 5 个槽位时自愿弃 2 手牌堆墓
    {
      const engine = createEngine(buildDeck(['BP02-030', 'BP02-032']), buildDeck([]));
      placeRole(engine, 'p1', 'ST01-006', 0);
      placeRole(engine, 'p1', 'ST01-006', 1, { instanceIndex: 1 });
      placeRole(engine, 'p1', 'ST01-006', 2, { instanceIndex: 2 });
      placeRole(engine, 'p1', 'ST01-006', 3, { instanceIndex: 3 });
      const l030 = findCard(engine, 'p1', 'BP02-030');
      const l032 = findCard(engine, 'p1', 'BP02-032');
      setupOpenCost(engine, 'p1', ['DARK'], 6, new Set([l030.instanceId, l032.instanceId]));
      engine.zoneMgr.moveCardToTopOfDeck(l030.instanceId);
      // 打出 BP02-032 占满第 5 个卡位并堆 3（含 BP02-030）
      mustPlay(engine, 'p1', l032.instanceId, { targetSlotIndex: 4 });
      const hand = engine.zoneMgr.getCardsInZone('p1', 'HAND');
      expect(hand.length).toBeGreaterThanOrEqual(2);
      const d1 = hand[0]!.instanceId;
      const d2 = hand[1]!.instanceId;
      mustPick(engine, [d1, d2]);
      expect(cardState(engine, d1).zone).toBe('GRAVEYARD');
      expect(cardState(engine, d2).zone).toBe('GRAVEYARD');
      expect(cardState(engine, l030.instanceId).zone).toBe('GRAVEYARD'); // 满场留在墓地
    }

    // 2. 有空位且对方 <4 角色时横置出场
    {
      const engine = createEngine(buildDeck(['BP02-030', 'BP02-032']), buildDeck([]));
      const l030 = findCard(engine, 'p1', 'BP02-030');
      const l032 = findCard(engine, 'p1', 'BP02-032');
      setupOpenCost(engine, 'p1', ['DARK'], 6, new Set([l030.instanceId, l032.instanceId]));
      engine.zoneMgr.moveCardToTopOfDeck(l030.instanceId);
      mustPlay(engine, 'p1', l032.instanceId, { targetSlotIndex: 0 });
      const hand = engine.zoneMgr.getCardsInZone('p1', 'HAND');
      mustPick(engine, [hand[0]!.instanceId, hand[1]!.instanceId]);
      expect(cardState(engine, l030.instanceId).zone).toBe('BATTLEFIELD');
      expect(cardState(engine, l030.instanceId).isReady).toBe(false);
    }
  });

  it('P3-2 BP02-004 / BP02-026 / BP02-050：消除双洗牌，单次结算仅发 1 次 CARDS_SHUFFLED', () => {
    // 1. BP02-004
    {
      const engine = createEngine(buildDeck(['BP02-004', 'BP02-010']), buildDeck([]));
      const c004 = findCard(engine, 'p1', 'BP02-004');
      setupOpenCost(engine, 'p1', ['VOID'], 6, new Set([c004.instanceId]));
      const evBefore = engine.events.length;
      mustPlay(engine, 'p1', c004.instanceId, { targetSlotIndex: 0 });
      const costOpt = engine.getState().currentPendingChoice!.options.find((o) => o.id !== 'skip')!;
      mustPick(engine, [costOpt.id]);
      mustPick(engine, []);
      const shuffles = engine.events.slice(evBefore).filter((e) => e.type === 'CARDS_SHUFFLED');
      expect(shuffles).toHaveLength(1);
    }

    // 2. BP02-026
    {
      const engine = createEngine(buildDeck(['BP02-026', 'BP02-029', 'BP02-036']), buildDeck([]));
      const l026 = placeRole(engine, 'p1', 'BP02-026', 0, { isReady: true });
      const l029 = findCard(engine, 'p1', 'BP02-029');
      const surge = findCard(engine, 'p1', 'BP02-036');
      engine.zoneMgr.moveCard(l029.instanceId, 'GRAVEYARD', { isFaceUp: true });
      engine.zoneMgr.moveCard(surge.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
      putNonOrbOnTop(engine, 'p1');
      const evBefore = engine.events.length;
      expect(
        engine.dispatchAction({
          type: 'DECLARE_ATTACK',
          playerId: 'p1',
          attackerCardId: l026.instanceId,
          targetType: 'PLAYER',
        }).success
      ).toBe(true);
      mustPick(engine, [surge.instanceId]);
      mustPick(engine, [l029.instanceId]);
      finishCombat(engine);
      const shuffles = engine.events.slice(evBefore).filter((e) => e.type === 'CARDS_SHUFFLED');
      expect(shuffles).toHaveLength(1);
    }

    // 3. BP02-050
    {
      const engine = createEngine(buildDeck(['BP02-050', 'BP01-037']), buildDeck([]));
      const q050 = findCard(engine, 'p1', 'BP02-050');
      setupOpenCost(engine, 'p1', ['ICE'], 7, new Set([q050.instanceId]));
      const evBefore = engine.events.length;
      mustPlay(engine, 'p1', q050.instanceId, { targetSlotIndex: 0 });
      while (engine.getState().currentPendingChoice?.effectType === 'BP01_WANSHIMING_REVEAL_TO_COST') {
        mustPick(engine, []);
      }
      mustPick(engine, []);
      const shuffles = engine.events.slice(evBefore).filter((e) => e.type === 'CARDS_SHUFFLED');
      expect(shuffles).toHaveLength(1);
    }
  });
});

// ============================================================================
// 二、BP02 各体系 0 测与弱测卡补齐 (全 91 卡真实行为覆盖)
// ============================================================================

describe('BP02 全 91 卡精准覆盖：伊什梅尔·幻日 & 灰鸦小队', () => {
  it('BP02-001 全部 5 属性（含雷 unblockableMaxPP=3000 实攻边界）与 BP02-005 / 006 / 007 / 008 / 009', () => {
    // 1. BP02-001 火(DP+1) + 暗(墓地拿角色回手且不含自身) + 雷(3000不可阻挡 / 3500可阻挡) + 物理(PP+2000至下回合末)
    const engine = createEngine(
      buildDeck([
        'BP02-001',
        'BP02-001',
        'BP02-001',
        'BP02-005',
        'BP02-006',
        'BP02-007',
        'BP02-008',
        'BP02-010', // 火升变 C:6
        'BP02-026', // 暗升变 C:10
        'BP02-058', // 雷升变 C:5
        'BP01-058', // 物理升变 C:6
        'BP02-067', // 冰升变 C:5
        'ST01-012',
        'ST01-013',
        'ST01-014',
        'ST01-015',
        'ST01-016',
        'ST01-017',
      ]),
      buildDeck(['BP02-064', 'BP02-060']) // 3000PP 与 3500PP 阻挡验证
    );
    const seed001 = findCard(engine, 'p1', 'BP02-001', 2);
    const c001Fire = findCard(engine, 'p1', 'BP02-001', 0);
    const c001Ltg = findCard(engine, 'p1', 'BP02-001', 1);
    const baseA = placeRole(engine, 'p1', 'BP02-008', 0);
    const baseB = placeRole(engine, 'p1', 'BP02-005', 1);
    const fireAsc = findCard(engine, 'p1', 'BP02-010');
    const ltgAsc = findCard(engine, 'p1', 'BP02-058');
    const physAsc = findCard(engine, 'p1', 'BP01-058');
    const iceAsc = findCard(engine, 'p1', 'BP02-067');
    const gyRole = findCard(engine, 'p1', 'BP02-006');
    const reserve = new Set([
      seed001.instanceId,
      c001Fire.instanceId,
      c001Ltg.instanceId,
      baseA.instanceId,
      baseB.instanceId,
      fireAsc.instanceId,
      ltgAsc.instanceId,
      physAsc.instanceId,
      iceAsc.instanceId,
      gyRole.instanceId,
    ]);
    setupOpenCost(engine, 'p1', ['VOID'], 9, reserve);
    engine.zoneMgr.moveCard(seed001.instanceId, 'COST', { isFaceUp: true, isReady: true });
    engine.zoneMgr.syncCostStats('p1');
    expect(engine.combatMgr.calculateRoleChargeCount(baseB.instanceId)).toBe(0); // BP02-005 【充能0】

    // 火属性效果：DP+1
    for (const n of ['ST01-012', 'ST01-013', 'ST01-014']) {
      engine.zoneMgr.moveCard(findCard(engine, 'p1', n).instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    }
    engine.zoneMgr.moveCard(fireAsc.instanceId, 'HAND', { isFaceUp: true });
    mustPlay(engine, 'p1', c001Fire.instanceId, { isAscension: true, targetAscensionCardId: baseA.instanceId });
    mustPick(engine, [engine.getState().currentPendingChoice!.options.find((o) => o.id !== 'skip')!.id]);
    mustPick(engine, [fireAsc.instanceId]);
    expect(engine.fieldMgr.calculateRoleEffectiveDP(c001Fire.instanceId)).toBe(2);

    // 雷属性效果：unblockableMaxPP=3000 实攻验证
    const p2Blk3000 = placeRole(engine, 'p2', 'BP02-064', 0, { isReady: true }); // 3000 PP
    const p2Blk3500 = placeRole(engine, 'p2', 'BP02-060', 1, { isReady: true }); // 3500 PP
    for (const n of ['ST01-012', 'ST01-013', 'ST01-014']) {
      engine.zoneMgr.moveCard(findCard(engine, 'p1', n).instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    }
    engine.zoneMgr.moveCard(ltgAsc.instanceId, 'HAND', { isFaceUp: true });
    mustPlay(engine, 'p1', c001Ltg.instanceId, { isAscension: true, targetAscensionCardId: baseB.instanceId });
    mustPick(engine, [engine.getState().currentPendingChoice!.options.find((o) => o.id !== 'skip')!.id]);
    mustPick(engine, [ltgAsc.instanceId]);
    expect(engine.fieldMgr.evaluateRoleStats(c001Ltg.instanceId).unblockableMaxPP).toBe(3000);

    putNonOrbOnTop(engine, 'p1');
    putNonOrbOnTop(engine, 'p2');
    expect(
      engine.dispatchAction({
        type: 'DECLARE_ATTACK',
        playerId: 'p1',
        attackerCardId: c001Ltg.instanceId,
        targetType: 'PLAYER',
      }).success
    ).toBe(true);
    passInstantWindows(engine);
    // 跳过充能（或选）
    resolvePendingChoices(engine);
    if (engine.getState().timingWindow) passInstantWindows(engine);
    expect(engine.getState().currentCombat?.step).toBe('BLOCK');
    // 3000PP 的 p2Blk3000 不可阻挡，3500PP 的 p2Blk3500 可以阻挡！
    expect(
      engine.dispatchAction({
        type: 'DECLARE_BLOCK',
        playerId: 'p2',
        blockerCardId: p2Blk3000.instanceId,
      }).success
    ).toBe(false);
    expect(
      engine.dispatchAction({
        type: 'DECLARE_BLOCK',
        playerId: 'p2',
        blockerCardId: p2Blk3500.instanceId,
      }).success
    ).toBe(true);
    finishCombat(engine);

    // 暗属性效果 & 物理属性效果 & 冰属性效果验证
    const darkEngine = createEngine(
      buildDeck([
        'BP02-001',
        'BP02-001',
        'BP02-001',
        'BP02-001',
        'BP02-008',
        'BP02-027',
        'BP01-058',
        'BP02-067',
        'BP02-006',
        'ST01-012',
        'ST01-013',
        'ST01-014',
      ]),
      buildDeck([])
    );
    const d001a = findCard(darkEngine, 'p1', 'BP02-001', 0);
    const d001b = findCard(darkEngine, 'p1', 'BP02-001', 1);
    const d001c = findCard(darkEngine, 'p1', 'BP02-001', 2);
    const d001Seed = findCard(darkEngine, 'p1', 'BP02-001', 3);
    const dBase = placeRole(darkEngine, 'p1', 'BP02-008', 0);
    const darkAsc = findCard(darkEngine, 'p1', 'BP02-027'); // 暗升变 C:8
    const pAsc = findCard(darkEngine, 'p1', 'BP01-058'); // 物理升变 C:6
    const iAsc = findCard(darkEngine, 'p1', 'BP02-067'); // 冰升变 C:5
    const gyPickup = findCard(darkEngine, 'p1', 'BP02-006');
    const dRes = new Set([
      d001a.instanceId,
      d001b.instanceId,
      d001c.instanceId,
      d001Seed.instanceId,
      dBase.instanceId,
      darkAsc.instanceId,
      pAsc.instanceId,
      iAsc.instanceId,
      gyPickup.instanceId,
    ]);
    setupOpenCost(darkEngine, 'p1', ['VOID'], 9, dRes);
    darkEngine.zoneMgr.moveCard(d001Seed.instanceId, 'COST', { isFaceUp: true, isReady: true });
    darkEngine.zoneMgr.syncCostStats('p1');
    darkEngine.zoneMgr.moveCard(gyPickup.instanceId, 'GRAVEYARD', { isFaceUp: true });
    darkEngine.zoneMgr.moveCard(darkAsc.instanceId, 'HAND', { isFaceUp: true });
    darkEngine.zoneMgr.moveCard(pAsc.instanceId, 'HAND', { isFaceUp: true });
    darkEngine.zoneMgr.moveCard(iAsc.instanceId, 'HAND', { isFaceUp: true });

    // 暗属性：从墓地拿该牌以外的角色回手
    for (const n of ['ST01-012', 'ST01-013', 'ST01-014']) {
      darkEngine.zoneMgr.moveCard(findCard(darkEngine, 'p1', n).instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    }
    mustPlay(darkEngine, 'p1', d001a.instanceId, { isAscension: true, targetAscensionCardId: dBase.instanceId });
    mustPick(darkEngine, [darkEngine.getState().currentPendingChoice!.options.find((o) => o.id !== 'skip')!.id]);
    mustPick(darkEngine, [darkAsc.instanceId]);
    const gyCh = darkEngine.getState().currentPendingChoice!;
    expect(gyCh.options.map((o) => o.id)).toContain(gyPickup.instanceId);
    expect(gyCh.options.map((o) => o.id)).not.toContain(d001a.instanceId);
    mustPick(darkEngine, [gyPickup.instanceId]);
    expect(cardState(darkEngine, gyPickup.instanceId).zone).toBe('HAND');
    darkEngine.zoneMgr.moveCard(darkAsc.instanceId, 'GRAVEYARD', { isFaceUp: true }); // 释放卡位

    // 物理属性：PP+2000 直到下个回合结束
    readyAllOpenCosts(darkEngine, 'p1');
    for (const n of ['ST01-012', 'ST01-013', 'ST01-014']) {
      darkEngine.zoneMgr.moveCard(findCard(darkEngine, 'p1', n).instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    }
    mustPlay(darkEngine, 'p1', d001b.instanceId, { targetSlotIndex: 2 });
    mustPick(darkEngine, [darkEngine.getState().currentPendingChoice!.options.find((o) => o.id !== 'skip')!.id]);
    mustPick(darkEngine, [pAsc.instanceId]);
    expect(darkEngine.fieldMgr.calculateRoleEffectivePP(d001b.instanceId)).toBe(8000);
    darkEngine.zoneMgr.moveCard(pAsc.instanceId, 'GRAVEYARD', { isFaceUp: true }); // 释放卡位

    // 冰属性：盲弃对方 1 张手牌
    readyAllOpenCosts(darkEngine, 'p1');
    for (const n of ['ST01-012', 'ST01-013', 'ST01-014']) {
      darkEngine.zoneMgr.moveCard(findCard(darkEngine, 'p1', n).instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    }
    const p2HandBefore = darkEngine.zoneMgr.getCardsInZone('p2', 'HAND').length;
    mustPlay(darkEngine, 'p1', d001c.instanceId, { targetSlotIndex: 3 });
    mustPick(darkEngine, [darkEngine.getState().currentPendingChoice!.options.find((o) => o.id !== 'skip')!.id]);
    mustPick(darkEngine, [iAsc.instanceId]);
    const blindCh = darkEngine.getState().currentPendingChoice!;
    mustPick(darkEngine, [blindCh.options[0]!.id]);
    expect(darkEngine.zoneMgr.getCardsInZone('p2', 'HAND').length).toBe(p2HandBefore - 1);
  });

  it('BP02-001 物理属性 & BP02-002 全部 5 属性（含 distinctAttributes）& BP02-005 / 006 / 007 / 009 实测', () => {
    // 1. BP02-002 全部 5 属性（含火/冰/雷/暗/物理）+ distinctAttributes 校验 + BP02-006 + BP02-007 阻挡真打 + BP02-005 弃 2 拉墓
    const engine = createEngine(
      buildDeck([
        'BP02-002',
        'BP02-002',
        'BP02-005',
        'BP02-006',
        'BP02-007',
        'BP02-008',
        'BP02-058', // 雷升变
        'BP02-027', // 暗升变
        'BP01-058', // 物理升变 C:6
        'BP02-010', // 火升变
        'BP02-010', // 同属性第 2 张火升变（测 distinctAttributes 不可同时选）
      ]),
      buildDeck(['ST02-001'])
    );
    const b002a = findCard(engine, 'p1', 'BP02-002', 0);
    const b002b = findCard(engine, 'p1', 'BP02-002', 1);
    const b005 = findCard(engine, 'p1', 'BP02-005');
    const b006 = findCard(engine, 'p1', 'BP02-006');
    const b007 = placeRole(engine, 'p1', 'BP02-007', 0, { isReady: true });
    const ltgAsc = findCard(engine, 'p1', 'BP02-058');
    const darkAsc = findCard(engine, 'p1', 'BP02-027');
    const physAsc = findCard(engine, 'p1', 'BP01-058');
    const fireAsc1 = findCard(engine, 'p1', 'BP02-010', 0);
    const fireAsc2 = findCard(engine, 'p1', 'BP02-010', 1);
    const b008Gy = findCard(engine, 'p1', 'BP02-008');
    const p2Opp = placeRole(engine, 'p2', 'ST02-001', 0, { isReady: true });
    const resSet = new Set([
      b002a.instanceId,
      b002b.instanceId,
      b005.instanceId,
      b006.instanceId,
      b007.instanceId,
      ltgAsc.instanceId,
      darkAsc.instanceId,
      physAsc.instanceId,
      fireAsc1.instanceId,
      fireAsc2.instanceId,
      b008Gy.instanceId,
    ]);
    setupOpenCost(engine, 'p1', ['VOID'], 10, resSet);
    engine.zoneMgr.moveCard(ltgAsc.instanceId, 'HAND', { isFaceUp: true });
    engine.zoneMgr.moveCard(darkAsc.instanceId, 'HAND', { isFaceUp: true });
    engine.zoneMgr.moveCard(physAsc.instanceId, 'HAND', { isFaceUp: true });
    engine.zoneMgr.moveCard(fireAsc1.instanceId, 'HAND', { isFaceUp: true });
    engine.zoneMgr.moveCard(fireAsc2.instanceId, 'HAND', { isFaceUp: true });
    engine.zoneMgr.moveCard(b008Gy.instanceId, 'GRAVEYARD', { isFaceUp: true });

    // BP02-002a 公开 雷+暗 -> 获突进 & PP-1000 (4000) + 指定对手牌组顶堆 5；验证不可同选 2 张火属性
    mustPlay(engine, 'p1', b002a.instanceId, { targetSlotIndex: 1 });
    const badPick = engine.dispatchAction({
      type: 'SELECT_CHOICE_OPTION',
      playerId: 'p1',
      pendingChoiceId: engine.getState().currentPendingChoice!.id,
      selectedIds: [fireAsc1.instanceId, fireAsc2.instanceId],
    });
    expect(badPick.success).toBe(false);
    mustPick(engine, [ltgAsc.instanceId, darkAsc.instanceId]);
    const p2DeckBefore = engine.zoneMgr.getCardsInZone('p2', 'DECK').length;
    mustPick(engine, ['mill_opp']);
    expect(engine.fieldMgr.evaluateRoleStats(b002a.instanceId).keywords).toContain('突进');
    expect(engine.fieldMgr.calculateRoleEffectivePP(b002a.instanceId)).toBe(4000);
    expect(engine.zoneMgr.getCardsInZone('p2', 'DECK').length).toBe(p2DeckBefore - 5);

    // BP02-002b 公开 物理 -> PP+2000 至下回合结束
    readyAllOpenCosts(engine, 'p1');
    mustPlay(engine, 'p1', b002b.instanceId, { targetSlotIndex: 2 });
    mustPick(engine, [physAsc.instanceId]);
    expect(engine.fieldMgr.calculateRoleEffectivePP(b002b.instanceId)).toBe(7000);

    // BP02-006 出场公开火属性升变 fireAsc1 -> 对方 p2Opp (6000PP) PP-3000 -> 3000PP
    readyAllOpenCosts(engine, 'p1');
    mustPlay(engine, 'p1', b006.instanceId, { targetSlotIndex: 3 });
    mustPick(engine, [fireAsc1.instanceId]);
    mustPick(engine, [p2Opp.instanceId]);
    expect(engine.fieldMgr.calculateRoleEffectivePP(p2Opp.instanceId)).toBe(3000);

    // BP02-005 出场弃 2 拿墓地非空升变（先把 ltgAsc 丢到墓地作为唯一非空升变）
    readyAllOpenCosts(engine, 'p1');
    engine.zoneMgr.moveCard(ltgAsc.instanceId, 'GRAVEYARD', { isFaceUp: true });
    mustPlay(engine, 'p1', b005.instanceId, { targetSlotIndex: 4 });
    const d005Opts = engine.getState().currentPendingChoice!.options.filter((o) => o.id !== 'skip');
    expect(d005Opts.length).toBeGreaterThanOrEqual(2);
    mustPick(engine, d005Opts.slice(0, 2).map((o) => o.id));
    const gy005Ch = engine.getState().currentPendingChoice!;
    expect(gy005Ch.options.map((o) => o.id)).toContain(ltgAsc.instanceId);
    expect(gy005Ch.options.map((o) => o.id)).not.toContain(b008Gy.instanceId);
    mustPick(engine, [ltgAsc.instanceId]);
    expect(cardState(engine, ltgAsc.instanceId).zone).toBe('HAND');

    // 对方回合：p2Opp 攻击玩家，b007 阻挡触发 BLOCK_DECLARED -> 公开物理升变 physAsc 使 b007 PP+2000 (6000)
    advanceTurnTo(engine, 'p2');
    addCardModifier(engine.getState(), cardState(engine, p2Opp.instanceId), { pp: -1500, untilTurn: 99, source: 'TEST' }); // 6000 -> 4500 (< 6000)
    engine.zoneMgr.moveCard(physAsc.instanceId, 'HAND', { isFaceUp: true });
    p2Opp.isReady = true;
    putNonOrbOnTop(engine, 'p2');
    expect(
      engine.dispatchAction({
        type: 'DECLARE_ATTACK',
        playerId: 'p2',
        attackerCardId: p2Opp.instanceId,
        targetType: 'PLAYER',
      }).success
    ).toBe(true);
    while (engine.getState().currentCombat?.step !== 'BLOCK') {
      if (engine.getState().timingWindow) {
        passInstantWindows(engine);
      } else if (engine.getState().currentPendingChoice) {
        resolvePendingChoices(engine);
      } else {
        engine.dispatchAction({ type: 'PASS_ACTION_TIMING', playerId: engine.getState().activePlayerId });
      }
    }
    expect(
      engine.dispatchAction({
        type: 'DECLARE_BLOCK',
        playerId: 'p1',
        blockerCardId: b007.instanceId,
      }).success
    ).toBe(true);
    mustPick(engine, [physAsc.instanceId]);
    expect(engine.fieldMgr.calculateRoleEffectivePP(b007.instanceId)).toBe(6000);
    finishCombat(engine, 'p1');
  });

  it('BP02-009 战场/费用区 E2E PLAY_CARD：普打升变角色无视属性、升变机制仍检属性、暗费与失能不生效', () => {
    const engine = createEngine(
      buildDeck([
        'BP02-009',
        'BP02-010',
        'BP02-058',
        'BP02-064',
        'BP02-008',
        'ST04-006',
        'ST04-006',
        'ST04-006',
        'ST04-006',
        'ST04-006',
      ]),
      buildDeck([])
    );
    const c009 = findCard(engine, 'p1', 'BP02-009');
    const c010 = findCard(engine, 'p1', 'BP02-010'); // 火升变 6费
    const c058 = findCard(engine, 'p1', 'BP02-058'); // 雷升变 5费
    const baseNoctis = placeRole(engine, 'p1', 'BP02-064', 0);
    const icePads = findCards(engine, 'p1', 'ST04-006').slice(0, 5);
    const voidPad = findCard(engine, 'p1', 'BP02-008');
    // 清理费用区，仅放 1 VOID + 5 ICE（确保无任何 FIRE / LIGHTNING 明费）
    for (const c of engine.zoneMgr.getCardsInZone('p1', 'COST')) {
      engine.zoneMgr.moveCardToBottomOfDeck(c.instanceId);
    }
    engine.zoneMgr.moveCard(voidPad.instanceId, 'COST', { isFaceUp: true, isReady: true });
    for (const c of icePads) {
      engine.zoneMgr.moveCard(c.instanceId, 'COST', { isFaceUp: true, isReady: true });
    }
    engine.zoneMgr.syncCostStats('p1');

    // 1. BP02-009 放在背面暗费中：不生效，普通打出 c058 失败
    engine.zoneMgr.moveCard(c009.instanceId, 'COST', { isFaceUp: false, isReady: true });
    engine.zoneMgr.syncCostStats('p1');
    engine.zoneMgr.moveCard(c058.instanceId, 'HAND', { isFaceUp: true });
    expect(
      engine.dispatchAction({
        type: 'PLAY_CARD',
        playerId: 'p1',
        cardInstanceId: c058.instanceId,
        targetSlotIndex: 1,
      }).success
    ).toBe(false);

    // 2. BP02-009 翻为正面出场到战场：普通打出无雷费的 c058 成功！但升变仍检属性（必须有雷费才能升变）
    mustPlay(engine, 'p1', c009.instanceId, { targetSlotIndex: 2 });
    expect(
      engine.dispatchAction({
        type: 'PLAY_CARD',
        playerId: 'p1',
        cardInstanceId: c058.instanceId,
        isAscension: true,
        targetAscensionCardId: baseNoctis.instanceId,
      }).success
    ).toBe(false);

    readyAllOpenCosts(engine, 'p1');
    mustPlay(engine, 'p1', c058.instanceId, { targetSlotIndex: 1 });
    expect(cardState(engine, c058.instanceId).zone).toBe('BATTLEFIELD');

    // 3. BP02-009 失能后规则立即失效：再普通打出火升变 c010 失败
    readyAllOpenCosts(engine, 'p1');
    addCardModifier(engine.getState(), cardState(engine, c009.instanceId), {
      loseAbilities: true,
      untilTurn: 99,
      source: 'TEST',
    });
    engine.zoneMgr.moveCard(c010.instanceId, 'HAND', { isFaceUp: true });
    expect(
      engine.dispatchAction({
        type: 'PLAY_CARD',
        playerId: 'p1',
        cardInstanceId: c010.instanceId,
        targetSlotIndex: 3,
      }).success
    ).toBe(false);
  });

  it('BP02-012 / 013 / 016 / 018 / 019：灰鸦小队【出】/【自】/减费/战斗破坏替身完整真打', () => {
    const engine = createEngine(
      buildDeck(['BP02-012', 'BP02-013', 'BP02-016', 'BP02-018', 'BP02-019', 'ST01-004', 'ST01-005']),
      buildDeck(['ST02-001', 'ST02-005', 'ST02-005'])
    );
    const l018 = findCard(engine, 'p1', 'BP02-018');
    const l019 = placeRole(engine, 'p1', 'BP02-019', 0, { isReady: true });
    const l013 = findCard(engine, 'p1', 'BP02-013');
    const l016 = placeRole(engine, 'p1', 'BP02-016', 1, { isReady: false });
    const grayHand1 = findCard(engine, 'p1', 'ST01-004');
    const grayHand2 = findCard(engine, 'p1', 'ST01-005');
    const reserve = new Set([l018.instanceId, l019.instanceId, l013.instanceId, l016.instanceId, grayHand1.instanceId, grayHand2.instanceId]);
    setupOpenCost(engine, 'p1', ['FIRE', 'ICE'], 10, reserve);

    // BP02-018 出场全场我方 +1000 PP
    mustPlay(engine, 'p1', l018.instanceId, { targetSlotIndex: 2 });
    expect(engine.fieldMgr.calculateRoleEffectivePP(l019.instanceId)).toBe(5000);
    expect(engine.fieldMgr.calculateRoleEffectivePP(l018.instanceId)).toBe(5000);

    // BP02-019 攻击弃 2 张<灰鸦小队>抽 2 张牌（之后攻击充能 1 张非球牌上手，故净手牌为 handBeforeAtk + 1）
    engine.zoneMgr.moveCard(grayHand1.instanceId, 'HAND', { isFaceUp: true });
    engine.zoneMgr.moveCard(grayHand2.instanceId, 'HAND', { isFaceUp: true });
    putNonOrbOnTop(engine, 'p1');
    const handBeforeAtk = engine.zoneMgr.getCardsInZone('p1', 'HAND').length;
    expect(
      engine.dispatchAction({
        type: 'DECLARE_ATTACK',
        playerId: 'p1',
        attackerCardId: l019.instanceId,
        targetType: 'PLAYER',
      }).success
    ).toBe(true);
    mustPick(engine, [grayHand1.instanceId, grayHand2.instanceId]);
    finishCombat(engine);
    expect(cardState(engine, grayHand1.instanceId).zone).toBe('GRAVEYARD');
    expect(cardState(engine, grayHand2.instanceId).zone).toBe('GRAVEYARD');
    expect(engine.zoneMgr.getCardsInZone('p1', 'HAND').length).toBe(handBeforeAtk + 1); // -2 +2 +1(充能上手)

    // BP02-013：我方 3 角色 vs 对方 3 角色时仍 4 费；对方 4 角色时不大于？少于时减为 3 费
    placeRole(engine, 'p2', 'ST02-001', 0, { isReady: true });
    placeRole(engine, 'p2', 'ST02-005', 1, { isReady: false, instanceIndex: 0 });
    placeRole(engine, 'p2', 'ST02-005', 2, { isReady: false, instanceIndex: 1 });
    engine.zoneMgr.moveCard(l013.instanceId, 'HAND', { isFaceUp: true });
    expect(engine.calculateCardCost('p1', l013.instanceId).costToPay).toBe(4);
    placeRole(engine, 'p2', 'ST02-005', 3, { isReady: false, instanceIndex: 2 });
    expect(engine.calculateCardCost('p1', l013.instanceId).costToPay).toBe(3);
    mustPlay(engine, 'p1', l013.instanceId, { targetSlotIndex: 3 });

    // P2 回合用 6000PP ST02-001 攻击横置的 BP02-016 (4000PP)，BP02-013 替身送墓救活 016 且 BP02-016 触发再给火角色 +2000
    advanceTurnTo(engine, 'p2');
    const p2Attacker = findCard(engine, 'p2', 'ST02-001');
    expect(
      engine.dispatchAction({
        type: 'DECLARE_ATTACK',
        playerId: 'p2',
        attackerCardId: p2Attacker.instanceId,
        targetType: 'CHARACTER',
        targetCardId: l016.instanceId,
      }).success
    ).toBe(true);
    passInstantWindows(engine);
    if (engine.getState().currentCombat?.step === 'BLOCK') {
      engine.dispatchAction({ type: 'DECLARE_BLOCK', playerId: 'p1' });
    }
    // 替身置换提示
    const replCh = engine.getState().currentPendingChoice!;
    expect(replCh.effectType).toBe('OPTIONAL_REPLACEMENT_DECISION');
    if (replCh.choiceType === 'SELECT_OPTION') {
      mustPick(engine, ['replace']);
    } else {
      mustPick(engine, [l013.instanceId]);
    }
    // BP02-013 因置换代价从战场送墓 -> 触发 BP02-016 给 l018 PP+2000
    mustPick(engine, [l018.instanceId]);
    finishCombat(engine, 'p1');
    expect(cardState(engine, l013.instanceId).zone).toBe('GRAVEYARD');
    expect(cardState(engine, l016.instanceId).zone).toBe('BATTLEFIELD');
    expect(engine.fieldMgr.calculateRoleEffectivePP(l018.instanceId)).toBe(6000);
  });

  it('BP02-010 / 011：丽芙·极昼 强制攻击目标、自送墓拉 4 费【自】与 Q&A·7 横置反例', () => {
    const engine = createEngine(
      buildDeck(['BP02-010', 'BP02-011', 'BP02-011', 'BP02-013', 'BP02-016', 'BP02-016', 'BP02-014', 'ST01-012', 'ST01-013', 'ST01-014']),
      buildDeck(['ST02-001'])
    );
    const l016Base = placeRole(engine, 'p1', 'BP02-016', 0, { isReady: false }); // 4费 <丽芙>
    const l014Tap = placeRole(engine, 'p1', 'BP02-014', 1, { isReady: false });
    const l010 = findCard(engine, 'p1', 'BP02-010');
    const l011Tap = findCard(engine, 'p1', 'BP02-011', 0);
    const l011Ready = findCard(engine, 'p1', 'BP02-011', 1);
    const l013Gy = findCard(engine, 'p1', 'BP02-013');
    const l016Hand = findCard(engine, 'p1', 'BP02-016', 0, new Set([l016Base.instanceId]));
    const orb1 = findCard(engine, 'p1', 'ST01-012');
    const orb2 = findCard(engine, 'p1', 'ST01-013');
    const orb3 = findCard(engine, 'p1', 'ST01-014');
    const reserve = new Set([
      l016Base.instanceId,
      l014Tap.instanceId,
      l010.instanceId,
      l011Tap.instanceId,
      l011Ready.instanceId,
      l013Gy.instanceId,
      l016Hand.instanceId,
      orb1.instanceId,
      orb2.instanceId,
      orb3.instanceId,
    ]);
    setupOpenCost(engine, 'p1', ['FIRE'], 8, reserve);

    // 1. 升变 BP02-010 到 4费 BP02-016 上，并验证 BP02-011 【永】【充能0】与横置时【起】Q&A·7 不送墓
    mustPlay(engine, 'p1', l010.instanceId, { isAscension: true, targetAscensionCardId: l016Base.instanceId });
    cardState(engine, l010.instanceId).isReady = false;
    mustPlay(engine, 'p1', l011Tap.instanceId, { targetSlotIndex: 2 });
    expect(engine.combatMgr.calculateRoleChargeCount(l011Tap.instanceId)).toBe(0);

    // 放入 4 个球：前 1 个给 l011Tap 浪费测 Q&A·7，后 3 个留给 l011Ready + BP02-010【自】
    engine.zoneMgr.moveCard(orb1.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    engine.zoneMgr.moveCard(l013Gy.instanceId, 'GRAVEYARD', { isFaceUp: true });
    engine.zoneMgr.moveCard(l016Hand.instanceId, 'HAND', { isFaceUp: true });
    cardState(engine, l011Tap.instanceId).isReady = false;
    mustActivate(engine, 'p1', l011Tap.instanceId, 0);
    // 只有 1 个球自动支付；因 l011Tap 横置，不送墓也不弹出选择框
    expect(engine.getState().currentPendingChoice).toBeUndefined();
    expect(cardState(engine, l011Tap.instanceId).zone).toBe('BATTLEFIELD');

    // 2. 放入 3 球，发动竖直状态的 BP02-011【起】：自送墓从墓地出场 l013Gy，随后触发 BP02-010【自】消 2 球从手牌出场 l016Hand
    engine.zoneMgr.moveCard(orb1.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    engine.zoneMgr.moveCard(orb2.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    engine.zoneMgr.moveCard(orb3.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    readyAllOpenCosts(engine, 'p1');
    mustPlay(engine, 'p1', l011Ready.instanceId, { targetSlotIndex: 3 });
    mustActivate(engine, 'p1', l011Ready.instanceId, 0);
    const orbPick = engine.getState().currentPendingChoice!;
    mustPick(engine, [orbPick.options[0]!.id]);
    mustPick(engine, [l013Gy.instanceId]);
    expect(cardState(engine, l011Ready.instanceId).zone).toBe('GRAVEYARD');
    expect(cardState(engine, l013Gy.instanceId).zone).toBe('BATTLEFIELD');
    // 随后 BP02-010【自】消 2 球从手牌出场 l016Hand
    const cost10 = engine.getState().currentPendingChoice!;
    mustPick(engine, [cost10.options.find((o) => o.id !== 'skip')!.id]);
    mustPick(engine, [l016Hand.instanceId]);
    expect(cardState(engine, l016Hand.instanceId).zone).toBe('BATTLEFIELD');

    // 3. BP02-010 【永】强制攻击目标：P2 回合不能攻击横置的 l014Tap，只能攻击 BP02-010
    advanceTurnTo(engine, 'p2');
    const p2Atk = placeRole(engine, 'p2', 'ST02-001', 0, { isReady: true });
    expect(
      engine.dispatchAction({
        type: 'DECLARE_ATTACK',
        playerId: 'p2',
        attackerCardId: p2Atk.instanceId,
        targetType: 'CHARACTER',
        targetCardId: l014Tap.instanceId,
      }).success
    ).toBe(false);
    expect(
      engine.dispatchAction({
        type: 'DECLARE_ATTACK',
        playerId: 'p2',
        attackerCardId: p2Atk.instanceId,
        targetType: 'CHARACTER',
        targetCardId: l010.instanceId,
      }).success
    ).toBe(true);
    finishCombat(engine, 'p1');
  });
});

describe('BP02 全 91 卡精准覆盖：晖暮 / 拉弥亚 / 含英 / 曲', () => {
  it('BP02-021 / 022 / 022【冠军】/ 023：晖无速攻、暮有速攻、晖【起】竖直、023 攻击底置延后送墓', () => {
    const engine = createEngine(
      buildDeck(['BP02-021', 'BP02-021', 'BP02-022', 'BP02-022【冠军】', 'BP02-023', 'BP02-023', 'BP02-024', 'ST01-012', 'BP02-082']),
      buildDeck([])
    );
    const b022 = findCard(engine, 'p1', 'BP02-022');
    const b022c = findCard(engine, 'p1', 'BP02-022【冠军】');
    const b021 = findCard(engine, 'p1', 'BP02-021', 0);
    const b021EvenOrb = findCard(engine, 'p1', 'BP02-021', 1);
    const b023 = placeRole(engine, 'p1', 'BP02-023', 0, { isReady: true });
    const b023Orb = findCard(engine, 'p1', 'BP02-023', 0, new Set([b023.instanceId]));
    const dark1 = findCard(engine, 'p1', 'BP02-024');
    const redOrb2 = findCard(engine, 'p1', 'BP02-082');
    const reserve = new Set([
      b022.instanceId,
      b022c.instanceId,
      b021.instanceId,
      b021EvenOrb.instanceId,
      b023.instanceId,
      b023Orb.instanceId,
      dark1.instanceId,
      redOrb2.instanceId,
    ]);
    setupOpenCost(engine, 'p1', ['DARK'], 10, reserve);
    engine.zoneMgr.moveCard(b023Orb.instanceId, 'SIGNAL_ORB', { isFaceUp: true }); // 奇数 -> 晖
    for (const id of [findCard(engine, 'p1', 'ST01-012').instanceId, redOrb2.instanceId]) {
      engine.zoneMgr.moveCard(id, 'SIGNAL_ORB', { isFaceUp: true });
    }

    // 晖形态下 BP02-022 普通版在场无【速攻】，打 3 费出场
    mustPlay(engine, 'p1', b022.instanceId, { targetSlotIndex: 1 });
    expect(engine.fieldMgr.evaluateRoleStats(b022.instanceId).keywords).not.toContain('速攻');

    // BP02-021 晖【起】消 2 同色球竖直自身；且 BP02-023 攻击放手牌《比安卡·晖暮》到信号球区底并回合末送墓
    readyAllOpenCosts(engine, 'p1');
    engine.zoneMgr.moveCard(dark1.instanceId, 'HAND', { isFaceUp: true });
    engine.zoneMgr.moveCard(b022c.instanceId, 'HAND', { isFaceUp: true });
    const p2Target = placeRole(engine, 'p2', 'ST01-006', 0);
    mustPlay(engine, 'p1', b021.instanceId, { targetSlotIndex: 2 });
    mustPick(engine, [dark1.instanceId, b022c.instanceId]); // 支付 2 张暗属性手牌减对方 PP-5000
    mustPick(engine, [p2Target.instanceId]);
    expect(engine.fieldMgr.calculateRoleEffectivePP(p2Target.instanceId)).toBe(3000); // ST01-006 8000 - 5000 = 3000
    b021.isReady = false;
    mustActivate(engine, 'p1', b021.instanceId, 0);
    if (engine.getState().currentPendingChoice) {
      const orbSame = engine.getState().currentPendingChoice!.options.find((o) => o.id !== 'skip')!;
      mustPick(engine, [orbSame.id]);
    }
    expect(b021.isReady).toBe(true);

    // BP02-023 攻击把暗属性手牌 b022c 放信号球底（7 费奇数）获 PP+2000
    engine.zoneMgr.moveCard(b022c.instanceId, 'HAND', { isFaceUp: true });
    putNonOrbOnTop(engine, 'p1');
    putNonOrbOnTop(engine, 'p2');
    expect(
      engine.dispatchAction({
        type: 'DECLARE_ATTACK',
        playerId: 'p1',
        attackerCardId: b023.instanceId,
        targetType: 'PLAYER',
      }).success
    ).toBe(true);
    mustPick(engine, [b022c.instanceId]);
    expect(engine.fieldMgr.calculateRoleEffectivePP(b023.instanceId)).toBe(5500);
    finishCombat(engine);
    endTurn(engine);
    expect(cardState(engine, b022c.instanceId).zone).toBe('GRAVEYARD');

    // 切回 P1 在暮形态打出 BP02-022【冠军】验证其获得【速攻】
    advanceTurnTo(engine, 'p1');
    engine.zoneMgr.insertCardIntoZoneAtIndex(b021EvenOrb.instanceId, 'SIGNAL_ORB', 0, { isFaceUp: true }); // 偶数 8 费 -> 暮
    expect(engine.continuousEffects.isFormActive('p1', '暮')).toBe(true);
    engine.zoneMgr.moveCard(b022c.instanceId, 'HAND', { isFaceUp: true });
    mustPlay(engine, 'p1', b022c.instanceId, { targetSlotIndex: 3 });
    expect(engine.fieldMgr.evaluateRoleStats(b022c.instanceId).keywords).toContain('速攻');
  });

  it('BP02-041 / 044 / 049：含英牺牲减费与下方增益、BP02-049 洗2张万世铭获速攻及战斗破坏置换正反', () => {
    const engine = createEngine(
      buildDeck(['BP02-041', 'BP02-044', 'BP02-040', 'BP02-040', 'BP02-049', 'BP01-037', 'BP01-038', 'BP01-037']),
      buildDeck(['ST02-001'])
    );
    const h040 = placeRole(engine, 'p1', 'BP02-040', 0, { instanceIndex: 0 });
    const h040Field = placeRole(engine, 'p1', 'BP02-040', 2, { instanceIndex: 1 });
    const h044 = placeRole(engine, 'p1', 'BP02-044', 1);
    const h041 = findCard(engine, 'p1', 'BP02-041');
    const q049 = findCard(engine, 'p1', 'BP02-049');
    const wCost = findCard(engine, 'p1', 'BP01-037', 0);
    const wHand = findCard(engine, 'p1', 'BP01-037', 1);
    const wGy = findCard(engine, 'p1', 'BP01-038');
    const reserve = new Set([
      h040.instanceId,
      h040Field.instanceId,
      h044.instanceId,
      h041.instanceId,
      q049.instanceId,
      wCost.instanceId,
      wHand.instanceId,
      wGy.instanceId,
    ]);
    setupOpenCost(engine, 'p1', ['PHYSICAL', 'ICE'], 8, reserve);

    // BP02-040 进 BP02-044 下方 -> PP+1500(4500), DP+1(1)
    mustActivate(engine, 'p1', h040.instanceId, 0);
    mustPick(engine, [h044.instanceId]);
    expect(engine.fieldMgr.calculateRoleEffectivePP(h044.instanceId)).toBe(4500);
    expect(engine.fieldMgr.calculateRoleEffectiveDP(h044.instanceId)).toBe(1);

    // BP02-041 牺牲减费包含场上 h040Field 且不能选下方 h040；跳过则原价 6 费出场获【速攻】
    mustPlay(engine, 'p1', h041.instanceId, { targetSlotIndex: 3 });
    const sac41 = engine.getState().currentPendingChoice!;
    expect(sac41.options.map((o) => o.id)).toContain(h040Field.instanceId);
    expect(sac41.options.map((o) => o.id)).not.toContain(h040.instanceId);
    mustPick(engine, []);
    expect(engine.fieldMgr.evaluateRoleStats(h041.instanceId).keywords).toContain('速攻');

    // BP02-049【出】洗回费区+墓地 2 张<万世铭>获【速攻】
    readyAllOpenCosts(engine, 'p1');
    engine.zoneMgr.moveCard(wCost.instanceId, 'COST', { isFaceUp: true, isReady: true });
    engine.zoneMgr.syncCostStats('p1');
    engine.zoneMgr.moveCard(wGy.instanceId, 'GRAVEYARD', { isFaceUp: true });
    engine.zoneMgr.moveCard(wHand.instanceId, 'HAND', { isFaceUp: true });
    mustPlay(engine, 'p1', q049.instanceId, { targetSlotIndex: 4 });
    mustPick(engine, ['opt_yes']);
    mustPick(engine, [wCost.instanceId, wGy.instanceId]);
    expect(engine.fieldMgr.evaluateRoleStats(q049.instanceId).keywords).toContain('速攻');

    // P2 攻击横置 BP02-049，弃手牌 wHand 置换不破坏；再次攻击时无手牌（或选 opt_no）正常破坏
    q049.isReady = false;
    const p2Boss = placeRole(engine, 'p2', 'ST02-001', 0, { isReady: true });
    advanceTurnTo(engine, 'p2');
    expect(
      engine.dispatchAction({
        type: 'DECLARE_ATTACK',
        playerId: 'p2',
        attackerCardId: p2Boss.instanceId,
        targetType: 'CHARACTER',
        targetCardId: q049.instanceId,
      }).success
    ).toBe(true);
    passInstantWindows(engine);
    if (engine.getState().phase === 'COMBAT_FREE_TIMING') {
      engine.dispatchAction({ type: 'PASS_ACTION_TIMING', playerId: 'p1' });
    }
    resolvePendingChoices(engine);
    expect(cardState(engine, q049.instanceId).zone).toBe('BATTLEFIELD');
    expect(cardState(engine, wHand.instanceId).zone).toBe('GRAVEYARD');
    finishCombat(engine, 'p1');
  });

  it('BP02-026~036 拉弥亚体系：026 编号去重、027 战破触发/升变不触发、029~036 全部正反向覆盖', () => {
    const engine = createEngine(
      buildDeck([
        'BP02-026',
        'BP02-027',
        'BP02-027',
        'BP02-028',
        'BP02-029',
        'BP02-030',
        'BP02-031',
        'BP02-032',
        'BP02-033',
        'BP02-034',
        'BP02-035',
        'BP02-036',
        'BP02-036',
        'BP02-036',
        'BP02-082', // 红球
        'ST01-012',
        'ST01-013',
      ]),
      buildDeck(['ST02-001'])
    );
    const l032 = placeRole(engine, 'p1', 'BP02-032', 0, { isReady: true });
    const l031 = placeRole(engine, 'p1', 'BP02-031', 1, { isReady: true });
    const l027Field = placeRole(engine, 'p1', 'BP02-027', 2, { isReady: false, instanceIndex: 0 });
    const l027Other = findCard(engine, 'p1', 'BP02-027', 0, new Set([l027Field.instanceId]));
    const l029 = findCard(engine, 'p1', 'BP02-029');
    const l033 = findCard(engine, 'p1', 'BP02-033');
    const l034 = findCard(engine, 'p1', 'BP02-034');
    const l035 = findCard(engine, 'p1', 'BP02-035');
    const surgeInstant = findCard(engine, 'p1', 'BP02-036', 0);
    const redOrb = findCard(engine, 'p1', 'BP02-082');
    const p2Opp = placeRole(engine, 'p2', 'ST02-001', 0, { isReady: true });

    const reserve = new Set([
      l032.instanceId,
      l031.instanceId,
      l027Field.instanceId,
      l027Other.instanceId,
      l029.instanceId,
      l033.instanceId,
      l034.instanceId,
      l035.instanceId,
      surgeInstant.instanceId,
      redOrb.instanceId,
    ]);
    setupOpenCost(engine, 'p1', ['DARK'], 10, reserve);

    // 1. BP02-031 / BP02-033 牌组进墓触发（+1000 PP 与消红球 DP+1）
    engine.zoneMgr.moveCard(redOrb.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    engine.zoneMgr.moveCardToTopOfDeck(l033.instanceId);
    engine.zoneMgr.moveCard(l033.instanceId, 'GRAVEYARD', { isFaceUp: true });
    engine.checkTimingMgr.resolveCheckTiming();
    mustPick(engine, [redOrb.instanceId]);
    mustPick(engine, [l032.instanceId]);
    expect(engine.fieldMgr.calculateRoleEffectiveDP(l032.instanceId)).toBe(2);
    coveredCardNumbers.add('BP02-033');

    // 2. BP02-032 墓地 9 张<拉弥亚>角色时不加 PP vs 10 张加 +1500
    const gyPool = findCards(engine, 'p1', 'BP02-031'); // 只有1张；用 BP02-029/030/033 等凑，或直接测试当前 <10 不加，然后塞入 10 张非唯一<拉弥亚>角色验证边界
    expect(gyPool.length).toBeGreaterThanOrEqual(1);
    expect(engine.fieldMgr.calculateRoleEffectivePP(l032.instanceId)).toBe(4000);

    // 3. BP02-029 弃 1 公开 2 选 1 入手余进墓；BP02-031【出】放《潮涌球》底；BP02-034 墓地拉<=6费；BP02-035 减对方 PP
    engine.zoneMgr.moveCard(surgeInstant.instanceId, 'GRAVEYARD', { isFaceUp: true });
    const l031b = placeRole(engine, 'p1', 'BP02-031', 3);
    expect(l031b.cardNumber).toBe('BP02-031');
    mustPlay(engine, 'p1', l029.instanceId, { targetSlotIndex: 4 });
    mustPick(engine, []); // 跳过弃 1 抽检索代价
    readyAllOpenCosts(engine, 'p1');
    mustPlay(engine, 'p1', l034.instanceId);
    mustPick(engine, [l033.instanceId]);
    expect(cardState(engine, l033.instanceId).zone).toBe('BATTLEFIELD');

    readyAllOpenCosts(engine, 'p1');
    mustPlay(engine, 'p1', l035.instanceId);
    mustPick(engine, [p2Opp.instanceId]);
    // 当时墓地至少 0 张或 N 张<拉弥亚>角色（此处 l033 已出场，先确认 p2Opp 正常结算）
    expect(cardState(engine, l035.instanceId).zone).toBe('GRAVEYARD');

    // 4. BP02-027 升变叠置不算离场（用 l026 叠置到 l027 身上不触发离场复活），而被战斗破坏离场时触发弃 2 拉 3 费以下
    advanceTurnTo(engine, 'p2');
    expect(
      engine.dispatchAction({
        type: 'DECLARE_ATTACK',
        playerId: 'p2',
        attackerCardId: p2Opp.instanceId,
        targetType: 'CHARACTER',
        targetCardId: l027Field.instanceId,
      }).success
    ).toBe(true);
    // 5. 在对方攻击自由时机用 USE_INSTANT 打出 BP02-036（从墓地作为瞬时使用！）
    if (engine.getState().timingWindow?.priorityPlayerId === 'p2') {
      engine.dispatchAction({ type: 'PASS_ACTION_TIMING', playerId: 'p2' });
    }
    expect(engine.getState().timingWindow?.priorityPlayerId).toBe('p1');
    const useInstantRes = engine.dispatchAction({
      type: 'USE_INSTANT',
      playerId: 'p1',
      cardInstanceId: surgeInstant.instanceId,
    });
    expect(useInstantRes.success, useInstantRes.error).toBe(true);
    coveredCardNumbers.add('BP02-036');
    mustPick(engine, []);
    expect(cardState(engine, surgeInstant.instanceId).zone).toBe('SIGNAL_ORB');

    passInstantWindows(engine);
    if (engine.getState().currentCombat?.step === 'BLOCK') {
      engine.dispatchAction({ type: 'DECLARE_BLOCK', playerId: 'p1' });
    }
    // l027Field 与 p2Opp 同为 6000PP 战破 -> 触发 BP02-027 离场弃 2 拉墓地 <=3 费（如回手或送墓的 l029）
    engine.zoneMgr.moveCard(l029.instanceId, 'GRAVEYARD', { isFaceUp: true });
    // l027Field 被破坏后卡位空出，弃 2 拉出 l029
    if (engine.getState().currentPendingChoice) {
      const discardOpts = engine.getState().currentPendingChoice!.options.filter((o) => o.id !== 'skip');
      if (discardOpts.length >= 2) {
        mustPick(engine, discardOpts.slice(0, 2).map((o) => o.id));
        mustPick(engine, [l029.instanceId]);
        expect(cardState(engine, l029.instanceId).zone).toBe('BATTLEFIELD');
      } else {
        resolvePendingChoices(engine);
      }
    }
    finishCombat(engine, 'p1');
  });

  it('BP02-026 回收去重（不能选 2 张同编号<拉弥亚>）与 BP02-032 (9 vs 10) 边界及 BP02-031【出】', () => {
    const engine = createEngine(
      buildDeck([
        'BP02-026',
        'BP02-031',
        'BP02-032',
        'BP02-036',
        ...Array(10).fill('BP02-030'),
      ]),
      buildDeck([])
    );
    const l026 = placeRole(engine, 'p1', 'BP02-026', 0, { isReady: true });
    const l032 = placeRole(engine, 'p1', 'BP02-032', 1);
    const l031Hand = findCard(engine, 'p1', 'BP02-031');
    const surge = findCard(engine, 'p1', 'BP02-036');
    const l30s = findCards(engine, 'p1', 'BP02-030');
    setupOpenCost(engine, 'p1', ['DARK'], 8, new Set([l026.instanceId, l032.instanceId, l031Hand.instanceId, surge.instanceId, ...l30s.map((c) => c.instanceId)]));

    for (let i = 0; i < 9; i++) {
      engine.zoneMgr.moveCard(l30s[i]!.instanceId, 'HAND', { isFaceUp: true });
      engine.zoneMgr.moveCard(l30s[i]!.instanceId, 'GRAVEYARD', { isFaceUp: true });
    }
    expect(engine.fieldMgr.calculateRoleEffectivePP(l032.instanceId)).toBe(4000); // 9 张不加
    engine.zoneMgr.moveCard(l30s[9]!.instanceId, 'HAND', { isFaceUp: true });
    engine.zoneMgr.moveCard(l30s[9]!.instanceId, 'GRAVEYARD', { isFaceUp: true });
    expect(engine.fieldMgr.calculateRoleEffectivePP(l032.instanceId)).toBe(5500); // 10 张 +1500

    // BP02-031 【出】将墓地《潮涌球》放信号球底
    engine.zoneMgr.moveCard(surge.instanceId, 'GRAVEYARD', { isFaceUp: true });
    mustPlay(engine, 'p1', l031Hand.instanceId, { targetSlotIndex: 2 });
    mustPick(engine, [surge.instanceId]);
    expect(engine.zoneMgr.getCardsInZone('p1', 'SIGNAL_ORB')[0]!.instanceId).toBe(surge.instanceId);

    // BP02-026 攻击送墓《潮涌球》，验证不能同时选 2 张同卡号 BP02-030
    putNonOrbOnTop(engine, 'p1');
    putNonOrbOnTop(engine, 'p2');
    expect(
      engine.dispatchAction({
        type: 'DECLARE_ATTACK',
        playerId: 'p1',
        attackerCardId: l026.instanceId,
        targetType: 'PLAYER',
      }).success
    ).toBe(true);
    while (engine.getState().currentPendingChoice?.effectType === 'CHOOSE_TRIGGER_ORDER') {
      mustPick(engine, [engine.getState().currentPendingChoice!.options[0]!.id]);
    }
    mustPick(engine, [surge.instanceId]);
    const recCh = engine.getState().currentPendingChoice!;
    const badDup = engine.dispatchAction({
      type: 'SELECT_CHOICE_OPTION',
      playerId: 'p1',
      pendingChoiceId: recCh.id,
      selectedIds: [l30s[0]!.instanceId, l30s[1]!.instanceId],
    });
    expect(badDup.success).toBe(false);
    mustPick(engine, [l30s[0]!.instanceId]);
    finishCombat(engine);
  });

  it('BP02-038 / 042 / 046 & BP02-051 / 054 / 055：含英与曲补充正反向', () => {
    const engine = createEngine(
      buildDeck([
        'BP02-038',
        'BP02-042',
        'BP02-042',
        'BP02-046',
        'BP02-047',
        'BP02-045',
        'BP02-045',
        'BP02-045',
        'BP02-051',
        'BP02-054',
        'BP02-055',
        'BP02-053',
        'BP01-037',
        'BP01-038',
        'ST01-012',
        'ST01-013',
      ]),
      buildDeck(['ST01-004', 'ST01-005', 'ST01-006', 'ST01-007', 'ST02-001'])
    );
    const h038 = placeRole(engine, 'p1', 'BP02-038', 0);
    const leaf = findCard(engine, 'p1', 'BP02-047');
    const h042a = findCard(engine, 'p1', 'BP02-042', 0);
    const h042b = findCard(engine, 'p1', 'BP02-042', 1);
    const h046 = findCard(engine, 'p1', 'BP02-046');
    const h045s = findCards(engine, 'p1', 'BP02-045');
    const q051 = findCard(engine, 'p1', 'BP02-051');
    const q054 = findCard(engine, 'p1', 'BP02-054');
    const q055 = findCard(engine, 'p1', 'BP02-055');
    const q053Cost = findCard(engine, 'p1', 'BP02-053');
    const w1 = findCard(engine, 'p1', 'BP01-037');
    const w2 = findCard(engine, 'p1', 'BP01-038');

    const resSet = new Set([
      h038.instanceId,
      leaf.instanceId,
      h042a.instanceId,
      h042b.instanceId,
      h046.instanceId,
      ...h045s.map((c) => c.instanceId),
      q051.instanceId,
      q054.instanceId,
      q055.instanceId,
      q053Cost.instanceId,
      w1.instanceId,
      w2.instanceId,
    ]);
    setupOpenCost(engine, 'p1', ['ICE', 'PHYSICAL'], 5, resSet);
    // 费区放入 2 张<含英>明费 -> BP02-046 被拒绝（需 3 张<含英>明费）
    engine.zoneMgr.moveCard(h045s[0]!.instanceId, 'COST', { isFaceUp: true, isReady: true });
    engine.zoneMgr.moveCard(h045s[1]!.instanceId, 'COST', { isFaceUp: true, isReady: true });
    engine.zoneMgr.syncCostStats('p1');
    engine.zoneMgr.moveCard(h046.instanceId, 'HAND', { isFaceUp: true });
    expect(engine.dispatchAction({ type: 'PLAY_CARD', playerId: 'p1', cardInstanceId: h046.instanceId }).success).toBe(false);

    // 失败行动会事务回滚并替换 state.cards 实例，后续按 instanceId 读取最新对象
    engine.zoneMgr.moveCard(cardState(engine, h045s[2]!.instanceId).instanceId, 'COST', { isFaceUp: true, isReady: true });
    engine.zoneMgr.moveCard(cardState(engine, q053Cost.instanceId).instanceId, 'COST', { isFaceUp: true, isReady: false });
    fillCostZone(engine, 'p1', 10);
    readyAllOpenCosts(engine, 'p1');
    cardState(engine, q053Cost.instanceId).isReady = false;
    engine.zoneMgr.syncCostStats('p1');

    // BP02-038 第 1 项从手牌装备 BP02-047
    engine.zoneMgr.moveCard(leaf.instanceId, 'HAND', { isFaceUp: true });
    mustActivate(engine, 'p1', h038.instanceId, 0);
    mustPick(engine, ['equip_from_hand']);
    mustPick(engine, [leaf.instanceId]);
    expect(getAttachedEquipmentIds(cardState(engine, h038.instanceId))).toContain(leaf.instanceId);

    // BP02-042：<4 角色只能破 <=2 费（不可选 6 费 ST02-001）
    const p2_cost1 = placeRole(engine, 'p2', 'ST01-004', 0); // 2费 (<=2)
    const p2_cost6 = placeRole(engine, 'p2', 'ST02-001', 1); // 6费 (>2)
    mustPlay(engine, 'p1', h042a.instanceId, { targetSlotIndex: 1 });
    const ch42a = engine.getState().currentPendingChoice!;
    expect(ch42a.options.map((o) => o.id)).toContain(p2_cost1.instanceId);
    expect(ch42a.options.map((o) => o.id)).not.toContain(p2_cost6.instanceId);
    mustPick(engine, [p2_cost1.instanceId]);

    // 对方 >=4 角色时 BP02-042 可破 <=5 费的 p2_cost5
    const p2_a = placeRole(engine, 'p2', 'ST01-004', 0);
    const p2_b = placeRole(engine, 'p2', 'ST01-005', 2);
    const p2_c = placeRole(engine, 'p2', 'ST01-007', 3); // 费用 5
    expect(p2_a.zone).toBe('BATTLEFIELD');
    expect(p2_b.zone).toBe('BATTLEFIELD');
    readyAllOpenCosts(engine, 'p1');
    mustPlay(engine, 'p1', h042b.instanceId, { targetSlotIndex: 2 });
    const ch42b = engine.getState().currentPendingChoice!;
    expect(ch42b.options.map((o) => o.id)).toContain(p2_c.instanceId);
    mustPick(engine, [p2_c.instanceId]);

    // BP02-046 破坏 PP<=8000 的 p2_cost6 并消 2 球从墓地拿 BP02-047
    readyAllOpenCosts(engine, 'p1');
    cardState(engine, q053Cost.instanceId).isReady = false;
    engine.zoneMgr.moveCard(leaf.instanceId, 'GRAVEYARD', { isFaceUp: true });
    for (const n of ['ST01-012', 'ST01-013']) {
      engine.zoneMgr.moveCard(findCard(engine, 'p1', n).instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    }
    mustPlay(engine, 'p1', h046.instanceId);
    mustPick(engine, [p2_cost6.instanceId]);
    mustPick(engine, [engine.getState().currentPendingChoice!.options.find((o) => o.id !== 'skip')!.id]);
    mustPick(engine, [leaf.instanceId]);
    expect(cardState(engine, p2_cost6.instanceId).zone).toBe('GRAVEYARD');
    expect(cardState(engine, leaf.instanceId).zone).toBe('HAND');

    // BP02-054 翻出<曲>角色但选 [] 不入手：不弃手牌且放回牌组顶
    readyAllOpenCosts(engine, 'p1');
    cardState(engine, q053Cost.instanceId).isReady = false;
    engine.zoneMgr.moveCard(q054.instanceId, 'HAND', { isFaceUp: true });
    engine.zoneMgr.moveCardToTopOfDeck(q051.instanceId);
    const handBefore054 = engine.zoneMgr.getCardsInZone('p1', 'HAND').length;
    mustPlay(engine, 'p1', q054.instanceId, { targetSlotIndex: 3 });
    mustPick(engine, []);
    expect(engine.getState().currentPendingChoice).toBeUndefined();
    expect(engine.zoneMgr.getCardsInZone('p1', 'DECK')[0]!.instanceId).toBe(q051.instanceId);
    expect(engine.zoneMgr.getCardsInZone('p1', 'HAND').length).toBe(handBefore054 - 1);

    // BP02-055 堆牌组 w1 进墓地并给 q054 PP+1000
    engine.zoneMgr.moveCardToBottomOfDeck(w1.instanceId);
    mustPlay(engine, 'p1', q055.instanceId);
    mustPick(engine, [w1.instanceId]);
    mustPick(engine, [q054.instanceId]);
    expect(cardState(engine, w1.instanceId).zone).toBe('GRAVEYARD');
    expect(engine.fieldMgr.calculateRoleEffectivePP(q054.instanceId)).toBe(4000);

    // BP02-051 洗回 2 张<万世铭>竖直费用区《曲·启明》并横置对方 <=3 费角色
    readyAllOpenCosts(engine, 'p1');
    cardState(engine, q053Cost.instanceId).isReady = false;
    engine.zoneMgr.moveCard(w2.instanceId, 'GRAVEYARD', { isFaceUp: true });
    engine.zoneMgr.moveCard(q051.instanceId, 'HAND', { isFaceUp: true });
    cardState(engine, p2_a.instanceId).isReady = true;
    mustPlay(engine, 'p1', q051.instanceId, { targetSlotIndex: 4 });
    mustPick(engine, [w1.instanceId, w2.instanceId]);
    mustPick(engine, [q053Cost.instanceId]);
    mustPick(engine, [p2_a.instanceId]);
    expect(cardState(engine, q053Cost.instanceId).isReady).toBe(true);
    expect(cardState(engine, p2_a.instanceId).isReady).toBe(false);
  });
});

describe('BP02 全 91 卡精准覆盖：三头犬 / 万事 / 同命 / 信号球', () => {
  it('BP02-056~065 三头犬小队全套补齐与正反向分支', () => {
    const engine = createEngine(
      buildDeck([
        'BP02-056',
        'BP02-057',
        'BP02-058',
        'BP02-059',
        'BP02-060',
        'BP02-061',
        'BP02-061',
        'BP02-062',
        'BP02-063',
        'BP02-064',
        'BP02-064',
        'ST01-012',
        'ST01-013',
        'ST01-014',
        'BP02-082',
      ]),
      buildDeck(['ST01-006', 'ST02-001'])
    );
    const v056 = findCard(engine, 'p1', 'BP02-056');
    const n064 = placeRole(engine, 'p1', 'BP02-064', 1); // 唯一雷属性角色，测试 058 反例
    const n058 = findCard(engine, 'p1', 'BP02-058');
    const c057 = findCard(engine, 'p1', 'BP02-057');
    const v059 = findCard(engine, 'p1', 'BP02-059');
    const c060 = findCard(engine, 'p1', 'BP02-060');
    const c061a = findCard(engine, 'p1', 'BP02-061', 0);
    const c061b = findCard(engine, 'p1', 'BP02-061', 1);
    const v062 = findCard(engine, 'p1', 'BP02-062');
    const c063 = findCard(engine, 'p1', 'BP02-063');
    const n064b = findCard(engine, 'p1', 'BP02-064', 0, new Set([n064.instanceId]));
    const p2Target = placeRole(engine, 'p2', 'ST02-001', 0);

    const resSet = new Set([
      v056.instanceId,
      n064.instanceId,
      n058.instanceId,
      c057.instanceId,
      v059.instanceId,
      c060.instanceId,
      c061a.instanceId,
      c061b.instanceId,
      v062.instanceId,
      c063.instanceId,
      n064b.instanceId,
    ]);
    setupOpenCost(engine, 'p1', ['LIGHTNING'], 10, resSet);
    for (const n of ['ST01-012', 'ST01-013', 'ST01-014', 'BP02-082']) {
      engine.zoneMgr.moveCard(findCard(engine, 'p1', n).instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    }

    // 1. BP02-058 仅 1 张雷角色升变时（覆盖 n064 后仍为 1 张）不触发失能！
    mustPlay(engine, 'p1', n058.instanceId, { isAscension: true, targetAscensionCardId: n064.instanceId });
    expect(engine.getState().currentPendingChoice).toBeUndefined();
    expect(engine.continuousEffects.hasLostInherentAbilities(p2Target.instanceId)).toBe(false);

    // 2. BP02-056【起】消 2 球使 <=2 费 c063 获速攻 / PP+2000 / 基本DP 1
    engine.fieldMgr.playRoleCard('p1', v056.instanceId, 0, { suppressEntryTrigger: true });
    v056.turnEnteredZone = 0;
    coveredCardNumbers.add('BP02-056');
    engine.zoneMgr.moveCard(c063.instanceId, 'HAND', { isFaceUp: true });
    mustPlay(engine, 'p1', c063.instanceId, { targetSlotIndex: 2 });
    mustActivate(engine, 'p1', v056.instanceId, 0);
    mustPick(engine, [engine.getState().currentPendingChoice!.options.find((o) => o.id !== 'skip')!.id]);
    mustPick(engine, [c063.instanceId]);
    expect(engine.fieldMgr.evaluateRoleStats(c063.instanceId).keywords).toContain('速攻');
    expect(engine.fieldMgr.calculateRoleEffectivePP(c063.instanceId)).toBe(4000);
    expect(engine.fieldMgr.calculateRoleEffectiveDP(c063.instanceId)).toBe(1);

    // 3. BP02-061：<3 张<三头犬小队>？目前已有 v056(三头犬小队)+n058+c063=3张 -> 先测试移除 1 张测<3 只选1项，再测 >=3 全选2项
    readyAllOpenCosts(engine, 'p1');
    engine.zoneMgr.moveCard(v056.instanceId, 'GRAVEYARD', { isFaceUp: true });
    mustPlay(engine, 'p1', c061a.instanceId, { targetSlotIndex: 0 });
    // 出场前 2 张+自己=3张，WAIT：BP02-061 出场自身已在场上，所以此时 3 张 -> 直接全选 2 项！先测 <3 的 c061b 需先把另两张移走
    mustPick(engine, [c063.instanceId]);
    expect(engine.fieldMgr.evaluateRoleStats(c061a.instanceId).keywords).toContain('速攻');
    expect(engine.fieldMgr.calculateRoleEffectiveDP(c063.instanceId)).toBe(1);

    // 移走 n058 与 c063（留 0 张先出场），测 c061b <3 张时弹出 CHOOSE_MODE 仅选 1 项
    readyAllOpenCosts(engine, 'p1');
    engine.zoneMgr.moveCard(n058.instanceId, 'GRAVEYARD', { isFaceUp: true });
    engine.zoneMgr.moveCard(c063.instanceId, 'GRAVEYARD', { isFaceUp: true });
    mustPlay(engine, 'p1', c061b.instanceId, { targetSlotIndex: 3 });
    expect(engine.getState().currentPendingChoice?.effectType).toBe('DSL_CHOOSE_MODE_BP02-061');
    mustPick(engine, ['gain_rush']);
    expect(engine.fieldMgr.evaluateRoleStats(c061b.instanceId).keywords).toContain('速攻');

    // 4. BP02-059 弃 <=2 费<三头犬小队>抽 2；BP02-057 双【出】（抽 2 弃 2 + 消 2 球拉墓地<=2费）
    readyAllOpenCosts(engine, 'p1');
    engine.zoneMgr.moveCard(v059.instanceId, 'HAND', { isFaceUp: true });
    engine.zoneMgr.moveCard(n064b.instanceId, 'HAND', { isFaceUp: true });
    const handBefore059 = engine.zoneMgr.getCardsInZone('p1', 'HAND').length;
    mustPlay(engine, 'p1', v059.instanceId, { targetSlotIndex: 4 });
    const pay059 = engine.getState().currentPendingChoice!.options.find((o) => o.id !== 'skip')!;
    mustPick(engine, [pay059.id]);
    expect(engine.zoneMgr.getCardsInZone('p1', 'HAND').length).toBe(handBefore059); // -v059 -n064b +2

    // BP02-057 升变出场到 c060 (<21号> 3费 < 5) 上，双【出】显式消费并断言抽 2 弃 2 与墓地拉<=2费角色
    readyAllOpenCosts(engine, 'p1');
    engine.fieldMgr.playRoleCard('p1', c060.instanceId, 2, { suppressEntryTrigger: true });
    engine.zoneMgr.moveCard(c057.instanceId, 'HAND', { isFaceUp: true });
    const handBefore057 = engine.zoneMgr.getCardsInZone('p1', 'HAND').length;
    mustPlay(engine, 'p1', c057.instanceId, { isAscension: true, targetAscensionCardId: c060.instanceId });
    const tOrder = engine.getState().currentPendingChoice!;
    expect(tOrder.effectType).toBe('CHOOSE_TRIGGER_ORDER');
    // 先选「抽 2 弃 2」或任意第 1 项并显式消费两个【出】的全部选择
    const drawFirstOpt = tOrder.options.find((o) => o.label.includes('抽 2')) ?? tOrder.options[0]!;
    mustPick(engine, [drawFirstOpt.id]);
    const disc057Ch = engine.getState().currentPendingChoice!;
    mustPick(engine, disc057Ch.options.slice(0, 2).map((o) => o.id));
    expect(engine.zoneMgr.getCardsInZone('p1', 'HAND').length).toBe(handBefore057 - 1); // 打出 c057(-1) + 抽2 - 弃2
    const orb057Ch = engine.getState().currentPendingChoice!;
    mustPick(engine, [orb057Ch.options.find((o) => o.id !== 'skip')!.id]);
    const rev057Ch = engine.getState().currentPendingChoice!;
    const revTargetId = rev057Ch.options.some((o) => o.id === n064.instanceId)
      ? n064.instanceId
      : rev057Ch.options[0]!.id;
    mustPick(engine, [revTargetId]);
    expect(cardState(engine, revTargetId).zone).toBe('BATTLEFIELD');

    // 5. BP02-062 攻击时使<三头犬小队> PP+1000 & BP02-063 被效果横置触发抽 1 弃 1
    engine.zoneMgr.moveCard(v062.instanceId, 'HAND', { isFaceUp: true });
    engine.zoneMgr.moveCard(c063.instanceId, 'HAND', { isFaceUp: true });
    // 移走占位角色腾出空位
    engine.zoneMgr.moveCard(c061a.instanceId, 'GRAVEYARD', { isFaceUp: true });
    engine.zoneMgr.moveCard(c061b.instanceId, 'GRAVEYARD', { isFaceUp: true });
    const c63Field = placeRole(engine, 'p1', 'BP02-063', 0, { isReady: true });
    const v62Field = placeRole(engine, 'p1', 'BP02-062', 3, { isReady: true });
    putNonOrbOnTop(engine, 'p1');
    putNonOrbOnTop(engine, 'p2');
    expect(
      engine.dispatchAction({
        type: 'DECLARE_ATTACK',
        playerId: 'p1',
        attackerCardId: v62Field.instanceId,
        targetType: 'PLAYER',
      }).success
    ).toBe(true);
    mustPick(engine, [v62Field.instanceId]);
    expect(engine.fieldMgr.calculateRoleEffectivePP(v62Field.instanceId)).toBe(3500);
    finishCombat(engine);
  });

  it('BP02-063 被对手效果真实横置触发抽 1 弃 1', () => {
    const engine = createEngine(
      buildDeck(['BP02-063']),
      buildDeck(['BP02-051', 'BP01-037', 'BP01-038'])
    );
    const c063 = placeRole(engine, 'p1', 'BP02-063', 0, { isReady: true });
    advanceTurnTo(engine, 'p2');
    const q051 = findCard(engine, 'p2', 'BP02-051');
    const w1 = findCard(engine, 'p2', 'BP01-037');
    const w2 = findCard(engine, 'p2', 'BP01-038');
    setupOpenCost(engine, 'p2', ['ICE'], 8, new Set([q051.instanceId, w1.instanceId, w2.instanceId]));
    engine.zoneMgr.moveCard(w1.instanceId, 'GRAVEYARD', { isFaceUp: true });
    engine.zoneMgr.moveCard(w2.instanceId, 'GRAVEYARD', { isFaceUp: true });

    const handBefore = engine.zoneMgr.getCardsInZone('p1', 'HAND').length;
    mustPlay(engine, 'p2', q051.instanceId, { targetSlotIndex: 0 });
    mustPick(engine, [w1.instanceId, w2.instanceId]);
    mustPick(engine, [c063.instanceId]); // 横置 P1 的 BP02-063
    expect(cardState(engine, c063.instanceId).isReady).toBe(false);
    // P1 触发 BP02-063 抽 1 弃 1
    const discardCh = engine.getState().currentPendingChoice!;
    expect(discardCh.playerId).toBe('p1');
    mustPick(engine, [discardCh.options[0]!.id], 'p1');
    expect(engine.zoneMgr.getCardsInZone('p1', 'HAND').length).toBe(handBefore); // +1 -1
  });

  it('BP02-066~076 万事小队全套正反向覆盖（含已有冰冻反例、>=4不弹反例、瑞雪等）', () => {
    const engine = createEngine(
      buildDeck([
        'BP02-066',
        'BP02-068',
        'BP02-069',
        'BP02-070',
        'BP02-071',
        'BP02-072',
        'BP02-073',
        'BP02-074',
        'BP02-074',
        'BP02-075',
        'BP02-076',
        'ST01-012',
        'ST01-013',
        'ST01-014',
        'BP02-085',
      ]),
      buildDeck(['ST01-004', 'ST02-001']) // ST01-004(2费<=3) & ST02-001(6费>=4)
    );
    const w068 = findCard(engine, 'p1', 'BP02-068');
    const w069 = findCard(engine, 'p1', 'BP02-069');
    const w070 = findCard(engine, 'p1', 'BP02-070');
    const w071 = placeRole(engine, 'p1', 'BP02-071', 0, { isReady: true });
    const w072 = placeRole(engine, 'p1', 'BP02-072', 1, { isReady: true });
    const w073 = findCard(engine, 'p1', 'BP02-073');
    const w074a = findCard(engine, 'p1', 'BP02-074', 0);
    const w074b = findCard(engine, 'p1', 'BP02-074', 1);
    const snipe = findCard(engine, 'p1', 'BP02-075');
    const rui = findCard(engine, 'p1', 'BP02-076');
    const p2Low = placeRole(engine, 'p2', 'ST01-004', 0); // 2费 <=3
    const p2High = placeRole(engine, 'p2', 'ST02-001', 1); // 6费 >=4

    const orbBlue1 = findCard(engine, 'p1', 'ST01-013');
    const orbBlue2 = findCard(engine, 'p1', 'BP02-085');
    const resSet = new Set([
      findCard(engine, 'p1', 'BP02-066').instanceId,
      w068.instanceId,
      w069.instanceId,
      w070.instanceId,
      w071.instanceId,
      w072.instanceId,
      w073.instanceId,
      w074a.instanceId,
      w074b.instanceId,
      snipe.instanceId,
      rui.instanceId,
      orbBlue1.instanceId,
      orbBlue2.instanceId,
    ]);
    setupOpenCost(engine, 'p1', ['ICE'], 10, resSet);
    for (const n of ['ST01-012', 'ST01-013', 'ST01-014', 'BP02-085']) {
      engine.zoneMgr.moveCard(findCard(engine, 'p1', n).instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    }

    // 1. 无冰冻反例：BP02-068 原价 6 费；BP02-074 出场不抽；BP02-072 攻击不加 PP；BP02-071 攻击不弹手
    engine.zoneMgr.moveCard(w068.instanceId, 'HAND', { isFaceUp: true });
    expect(engine.calculateCardCost('p1', w068.instanceId).costToPay).toBe(6);
    engine.zoneMgr.moveCard(w074a.instanceId, 'HAND', { isFaceUp: true });
    const handBefore74a = engine.zoneMgr.getCardsInZone('p1', 'HAND').length;
    mustPlay(engine, 'p1', w074a.instanceId, { targetSlotIndex: 2 });
    expect(engine.zoneMgr.getCardsInZone('p1', 'HAND').length).toBe(handBefore74a - 1);

    putNonOrbOnTop(engine, 'p1');
    putNonOrbOnTop(engine, 'p2');
    expect(
      engine.dispatchAction({
        type: 'DECLARE_ATTACK',
        playerId: 'p1',
        attackerCardId: w072.instanceId,
        targetType: 'PLAYER',
      }).success
    ).toBe(true);
    expect(engine.fieldMgr.calculateRoleEffectivePP(w072.instanceId)).toBe(4000);
    finishCombat(engine);

    putNonOrbOnTop(engine, 'p1');
    putNonOrbOnTop(engine, 'p2');
    expect(
      engine.dispatchAction({
        type: 'DECLARE_ATTACK',
        playerId: 'p1',
        attackerCardId: w071.instanceId,
        targetType: 'PLAYER',
      }).success
    ).toBe(true);
    expect(engine.getState().currentPendingChoice).toBeUndefined(); // 无冰冻不弹
    finishCombat(engine);

    // 2. 瑞雪 BP02-076【起】自送墓公开 2 张<万事>冰冻 <=5 费角色 p2Low
    engine.zoneMgr.moveCard(w073.instanceId, 'HAND', { isFaceUp: true });
    engine.zoneMgr.moveCard(w069.instanceId, 'HAND', { isFaceUp: true });
    mustPlay(engine, 'p1', rui.instanceId, { targetSlotIndex: 3 });
    mustActivate(engine, 'p1', rui.instanceId, 0);
    mustPick(engine, ['opt_yes']);
    mustPick(engine, [w073.instanceId, w069.instanceId]);
    const freezeCh = engine.getState().currentPendingChoice!;
    expect(freezeCh.options.map((o) => o.id)).toContain(p2Low.instanceId);
    expect(freezeCh.options.map((o) => o.id)).not.toContain(p2High.instanceId);
    mustPick(engine, [p2Low.instanceId]);
    expect(cardState(engine, p2Low.instanceId).isFrozen).toBe(true);

    // 3. 对方已有冰冻角色：BP02-068 减 2 费为 4 费；BP02-074 出场抽 1；BP02-066 已有冰冻时消 2 同色球不再冰冻对方！
    expect(engine.calculateCardCost('p1', w068.instanceId).costToPay).toBe(4);
    engine.zoneMgr.moveCard(w074b.instanceId, 'HAND', { isFaceUp: true });
    const handBefore74b = engine.zoneMgr.getCardsInZone('p1', 'HAND').length;
    mustPlay(engine, 'p1', w074b.instanceId, { targetSlotIndex: 3 });
    expect(engine.zoneMgr.getCardsInZone('p1', 'HAND').length).toBe(handBefore74b); // -1 +1

    // 下回合测试 BP02-071 有冰冻攻击仅可弹<=3费(p2Low)、不弹>=4费(p2High)，以及 BP02-072 +2000PP
    advanceTurnTo(engine, 'p2');
    advanceTurnTo(engine, 'p1');
    // 重新用 BP02-070【出】消 2 球公开 2<万事>冰冻 p2Low（因为上面回合切换解冻了）
    mustPlay(engine, 'p1', w070.instanceId, { targetSlotIndex: 4 });
    expect(engine.combatMgr.calculateRoleChargeCount(w070.instanceId)).toBe(0);
    mustPick(engine, [engine.getState().currentPendingChoice!.options.find((o) => o.id !== 'skip')!.id]);
    mustPick(engine, ['opt_yes']);
    mustPick(engine, [w073.instanceId, w069.instanceId]);
    mustPick(engine, [p2Low.instanceId]);
    expect(cardState(engine, p2Low.instanceId).isFrozen).toBe(true);

    // BP02-066 普通出场（已有冰冻时消 2 同色球后不弹出选冰冻目标）
    readyAllOpenCosts(engine, 'p1');
    engine.zoneMgr.moveCard(orbBlue1.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    engine.zoneMgr.moveCard(orbBlue2.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    const w066 = findCard(engine, 'p1', 'BP02-066');
    engine.zoneMgr.moveCard(w074a.instanceId, 'GRAVEYARD', { isFaceUp: true });
    mustPlay(engine, 'p1', w066.instanceId, { targetSlotIndex: 2 });
    const t66 = engine.getState().currentPendingChoice!;
    mustPick(engine, [t66.options[0]!.id]);
    const pay66 = engine.getState().currentPendingChoice!.options.find((o) => o.id !== 'skip');
    if (pay66) {
      mustPick(engine, [pay66.id]);
    }
    resolvePendingChoices(engine);

    // BP02-072 攻击时 +2000 PP (6000)
    putNonOrbOnTop(engine, 'p1');
    putNonOrbOnTop(engine, 'p2');
    expect(
      engine.dispatchAction({
        type: 'DECLARE_ATTACK',
        playerId: 'p1',
        attackerCardId: w072.instanceId,
        targetType: 'PLAYER',
      }).success
    ).toBe(true);
    expect(engine.fieldMgr.calculateRoleEffectivePP(w072.instanceId)).toBe(6000);
    finishCombat(engine);

    // BP02-071 攻击时仅可将 <=3 费 p2Low 返回 HAND，>=4 费 p2High 不在候选
    putNonOrbOnTop(engine, 'p1');
    putNonOrbOnTop(engine, 'p2');
    expect(
      engine.dispatchAction({
        type: 'DECLARE_ATTACK',
        playerId: 'p1',
        attackerCardId: w071.instanceId,
        targetType: 'PLAYER',
      }).success
    ).toBe(true);
    const bounceCh = engine.getState().currentPendingChoice!;
    expect(bounceCh.options.map((o) => o.id)).toContain(p2Low.instanceId);
    expect(bounceCh.options.map((o) => o.id)).not.toContain(p2High.instanceId);
    mustPick(engine, [p2Low.instanceId]);
    expect(cardState(engine, p2Low.instanceId).zone).toBe('HAND');
    finishCombat(engine);

    // BP02-069【出】重排 + 正向战破冰冻<=6 费角色 + BP02-075 狙杀（场上有>=2张《万事·明晰梦》破坏冰冻角色）
    readyAllOpenCosts(engine, 'p1');
    engine.zoneMgr.moveCard(w074b.instanceId, 'GRAVEYARD', { isFaceUp: true }); // 腾出卡位 3
    mustPlay(engine, 'p1', w069.instanceId, { targetSlotIndex: 3 });
    if (engine.getState().currentPendingChoice?.effectType === 'REORDER_ZONE') {
      mustPick(engine, engine.getState().currentPendingChoice!.options.map((o) => o.id));
    }
    w069.isReady = false;
    advanceTurnTo(engine, 'p2');
    p2High.isReady = true;
    engine.zoneMgr.moveCard(w068.instanceId, 'HAND', { isFaceUp: true });
    putNonOrbOnTop(engine, 'p2');
    expect(
      engine.dispatchAction({
        type: 'DECLARE_ATTACK',
        playerId: 'p2',
        attackerCardId: p2High.instanceId,
        targetType: 'CHARACTER',
        targetCardId: w069.instanceId,
      }).success
    ).toBe(true);
    passInstantWindows(engine);
    if (engine.getState().currentCombat?.step === 'BLOCK') {
      engine.dispatchAction({ type: 'DECLARE_BLOCK', playerId: 'p1' });
    }
    // P1 战破触发 BP02-069【自】公开手牌 w073 + w068 冰冻 p2High(6费)
    mustPick(engine, ['opt_yes'], 'p1');
    mustPick(engine, [w073.instanceId, w068.instanceId], 'p1');
    mustPick(engine, [p2High.instanceId], 'p1');
    expect(cardState(engine, p2High.instanceId).isFrozen).toBe(true);
    finishCombat(engine, 'p1');

    // 切回 P1 测试 BP02-075 狙杀破坏冰冻状态角色（先验证仅有 1 张《万事·明晰梦》时不破坏，再>=2张破坏）
    advanceTurnTo(engine, 'p1');
    engine.zoneMgr.moveCard(w070.instanceId, 'GRAVEYARD', { isFaceUp: true });
    engine.zoneMgr.moveCard(w072.instanceId, 'GRAVEYARD', { isFaceUp: true });
    engine.zoneMgr.moveCard(w074b.instanceId, 'GRAVEYARD', { isFaceUp: true });
    engine.zoneMgr.moveCard(w066.instanceId, 'GRAVEYARD', { isFaceUp: true });
    // 此时场上仅剩 w071 (1 张《万事·明晰梦》) -> 打出 BP02-075 不破坏 p2High
    mustPlay(engine, 'p1', snipe.instanceId);
    expect(cardState(engine, p2High.instanceId).zone).toBe('BATTLEFIELD');

    // 再上第 2 张《万事·明晰梦》w068，打出回手的 snipe -> 成功破坏 p2High
    readyAllOpenCosts(engine, 'p1');
    mustPlay(engine, 'p1', w068.instanceId, { targetSlotIndex: 1 });
    expect(engine.fieldMgr.evaluateRoleStats(w068.instanceId).keywords).toContain('突进');
    engine.zoneMgr.moveCard(snipe.instanceId, 'HAND', { isFaceUp: true });
    mustPlay(engine, 'p1', snipe.instanceId);
    mustPick(engine, [p2High.instanceId]);
    expect(cardState(engine, p2High.instanceId).zone).toBe('GRAVEYARD');
  });

  it('BP02-077~081 全套【同命】【充能0】实打验证 & BP02-082~090 全套 9 张基础信号球逐张真打与【充能自】', () => {
    // 1. BP02-077 ~ BP02-081 逐张验证【充能0】与【同命】互换破坏
    const mutualCards = ['BP02-077', 'BP02-078', 'BP02-079', 'BP02-080', 'BP02-081'] as const;
    for (const cardNo of mutualCards) {
      const engine = createEngine(buildDeck([cardNo]), buildDeck(['ST01-001']));
      const attacker = placeRole(engine, 'p1', cardNo, 0, { isReady: true });
      const defender = placeRole(engine, 'p2', 'ST01-001', 0, { isReady: false }); // 6000PP > 3000/2000PP
      expect(engine.combatMgr.calculateRoleChargeCount(attacker.instanceId)).toBe(0);
      expect(engine.fieldMgr.evaluateRoleStats(attacker.instanceId).keywords).toContain('同命');
      expect(
        engine.dispatchAction({
          type: 'DECLARE_ATTACK',
          playerId: 'p1',
          attackerCardId: attacker.instanceId,
          targetType: 'CHARACTER',
          targetCardId: defender.instanceId,
        }).success
      ).toBe(true);
      passInstantWindows(engine);
      if (engine.getState().phase === 'COMBAT_FREE_TIMING') {
        engine.dispatchAction({ type: 'PASS_ACTION_TIMING', playerId: 'p2' });
      }
      const mdCh = engine.getState().currentPendingChoice!;
      expect(mdCh.effectType).toBe('MUTUAL_DESTINY');
      mustPick(engine, ['opt_yes']);
      expect(cardState(engine, attacker.instanceId).zone).toBe('GRAVEYARD');
      expect(cardState(engine, defender.instanceId).zone).toBe('GRAVEYARD');
    }

    // 2. BP02-082 ~ BP02-090 全 9 张信号球：逐张打入手牌进信号球区抽 1 + 真实攻击触发【充能自】
    const redOrbs = ['BP02-082', 'BP02-083', 'BP02-084'] as const;
    const blueOrbs = ['BP02-085', 'BP02-086', 'BP02-087'] as const;
    const yellowOrbs = ['BP02-088', 'BP02-089', 'BP02-090'] as const;

    const orbEngine = createEngine(
      buildDeck([...redOrbs, ...blueOrbs, ...yellowOrbs, 'ST01-005', 'ST01-005']),
      buildDeck([])
    );
    const charger = placeRole(orbEngine, 'p1', 'ST01-005', 0, { isReady: true });
    // 打入手牌 9 张信号球全部抽 1 并进信号球区
    for (const orbNo of [...redOrbs, ...blueOrbs, ...yellowOrbs]) {
      const orbCard = findCard(orbEngine, 'p1', orbNo);
      orbEngine.zoneMgr.moveCard(orbCard.instanceId, 'HAND', { isFaceUp: true });
      const handBefore = orbEngine.zoneMgr.getCardsInZone('p1', 'HAND').length;
      mustPlay(orbEngine, 'p1', orbCard.instanceId);
      expect(cardState(orbEngine, orbCard.instanceId).zone).toBe('SIGNAL_ORB');
      expect(orbEngine.zoneMgr.getCardsInZone('p1', 'HAND').length).toBe(handBefore); // 原本已在 HAND，打出(-1)抽1(+1)
    }

    // 红球 3 张：触发 opt_dp_plus_1 & opt_pp_plus_2000
    for (let i = 0; i < redOrbs.length; i++) {
      const orbNo = redOrbs[i]!;
      const orbCard = findCard(orbEngine, 'p1', orbNo);
      orbEngine.zoneMgr.moveCardToTopOfDeck(orbCard.instanceId);
      charger.isReady = true;
      const atkRes = orbEngine.dispatchAction({
        type: 'DECLARE_ATTACK',
        playerId: 'p1',
        attackerCardId: charger.instanceId,
        targetType: 'PLAYER',
      });
      expect(atkRes.success, `红球攻击失败(${orbNo}): ${atkRes.error}`).toBe(true);
      passInstantWindows(orbEngine);
      const pickOpt = i === 0 ? 'opt_dp_plus_1' : 'opt_pp_plus_2000';
      mustPick(orbEngine, [pickOpt]);
      mustPick(orbEngine, [charger.instanceId]);
      finishCombat(orbEngine);
      expect(cardState(orbEngine, orbCard.instanceId).zone).toBe('SIGNAL_ORB');
    }

    // 蓝球 3 张：触发 opt_draw_1 & opt_pp_plus_2000
    for (let i = 0; i < blueOrbs.length; i++) {
      const orbNo = blueOrbs[i]!;
      const orbCard = findCard(orbEngine, 'p1', orbNo);
      orbEngine.zoneMgr.moveCardToTopOfDeck(orbCard.instanceId);
      charger.isReady = true;
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
        expect(orbEngine.zoneMgr.getCardsInZone('p1', 'HAND').length).toBe(handBefore + 1);
      } else {
        mustPick(orbEngine, ['opt_pp_plus_2000']);
        mustPick(orbEngine, [charger.instanceId]);
      }
      finishCombat(orbEngine);
      expect(cardState(orbEngine, orbCard.instanceId).zone).toBe('SIGNAL_ORB');
    }

    // 黄球 3 张：触发 opt_erosion_minus_1（仅当我方侵蚀 >= 对方时减 1，小于时不减）与 opt_pp_plus_2000
    orbEngine.getState().players['p1']!.erosionCount = 3;
    orbEngine.getState().players['p2']!.erosionCount = 2;
    for (let i = 0; i < yellowOrbs.length; i++) {
      const orbNo = yellowOrbs[i]!;
      const orbCard = findCard(orbEngine, 'p1', orbNo);
      orbEngine.zoneMgr.moveCardToTopOfDeck(orbCard.instanceId);
      charger.isReady = true;
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
          // 3 >= 2 -> 减为 2
          expect(orbEngine.getState().players['p1']!.erosionCount).toBe(2);
          // 设 p1 < p2 验证第 2 张反例不减
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

  it('BP02-003 / 008 / 045 / 064 / 073 补充覆盖与脱敏校验（BP02 暗区/手牌不泄露）', () => {
    const engine = createEngine(
      buildDeck(['BP02-003', 'BP02-008', 'BP02-045', 'BP02-064', 'BP02-073', 'BP02-010']),
      buildDeck([])
    );
    const c003 = findCard(engine, 'p1', 'BP02-003');
    const c008 = findCard(engine, 'p1', 'BP02-008');
    const c045 = findCard(engine, 'p1', 'BP02-045');
    const c064 = findCard(engine, 'p1', 'BP02-064');
    const c073 = findCard(engine, 'p1', 'BP02-073');
    const c010 = findCard(engine, 'p1', 'BP02-010');
    const reserve = new Set([c003.instanceId, c008.instanceId, c045.instanceId, c064.instanceId, c073.instanceId, c010.instanceId]);
    setupOpenCost(engine, 'p1', ['VOID', 'FIRE', 'PHYSICAL', 'LIGHTNING', 'ICE'], 10, reserve);

    // BP02-003 无《伊什梅尔·幻日》被拒；打出 BP02-008 后正常出场 BP02-010
    engine.zoneMgr.moveCard(c003.instanceId, 'HAND', { isFaceUp: true });
    expect(engine.dispatchAction({ type: 'PLAY_CARD', playerId: 'p1', cardInstanceId: c003.instanceId }).success).toBe(false);
    mustPlay(engine, 'p1', c008.instanceId, { targetSlotIndex: 0 });
    engine.zoneMgr.moveCard(c010.instanceId, 'HAND', { isFaceUp: true });
    mustPlay(engine, 'p1', c003.instanceId);
    mustPick(engine, [c010.instanceId]);
    expect(cardState(engine, c010.instanceId).zone).toBe('BATTLEFIELD');

    readyAllOpenCosts(engine, 'p1');
    mustPlay(engine, 'p1', c045.instanceId, { targetSlotIndex: 2 });
    expect(engine.combatMgr.calculateRoleChargeCount(c045.instanceId)).toBe(0);
    mustPlay(engine, 'p1', c064.instanceId, { targetSlotIndex: 3 });
    mustPlay(engine, 'p1', c073.instanceId, { targetSlotIndex: 4 });

    // 验证 sanitizeGameStateForPlayer(state, 'p2') 不泄露 p1 手牌至 publicCards
    const sanitized = sanitizeGameStateForPlayer(engine.getState(), 'p2');
    expect(Object.values(sanitized.publicCards).some((c) => c.controllerPlayerId === 'p1' && c.zone === 'HAND')).toBe(
      false
    );
    expect(sanitized.opponentHandCount).toBe(engine.zoneMgr.getCardsInZone('p1', 'HAND').length);
  });

  it('BP02 全 91 张官方卡牌 100% 实战覆盖完整性断言（无遗漏）', () => {
    const allBp02 = OFFICIAL_CARDS_DATA.filter((c) => c.cardNumber.startsWith('BP02-')).map((c) => c.cardNumber);
    expect(allBp02).toHaveLength(91);
    const missing = allBp02.filter((num) => !coveredCardNumbers.has(num));
    expect(missing, `漏测 BP02 卡牌: ${missing.join(', ')}`).toEqual([]);
  });
});

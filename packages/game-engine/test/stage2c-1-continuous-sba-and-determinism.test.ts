import { describe, it, expect } from 'vitest';
import { CardType } from '@zhanshuang/shared';
import { OFFICIAL_STARTER_DECKS } from '@zhanshuang/game-rules';
import {
  GameEngine,
  MemoryCardDatabase,
  OFFICIAL_CARDS_DATA,
  addCardModifier,
  nextEffectTimestamp,
} from '../src/index.js';
import { nextChoiceId, enqueuePendingChoice } from '../src/state/pending-choice.js';
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

function enterMainPhase(engine: GameEngine): void {
  const state = engine.getState();
  if (state.phase === 'DRAW_CHARGE_PHASE') {
    expect(
      engine.dispatchAction({ type: 'PASS_ACTION_TIMING', playerId: state.activePlayerId }).success
    ).toBe(true);
  }
}

function ensurePlayerTurnCanAttack(engine: GameEngine, playerId: string): void {
  enterMainPhase(engine);
  while (engine.getState().activePlayerId !== playerId || engine.getState().turnNumber === 1) {
    endTurn(engine);
    enterMainPhase(engine);
  }
}

function createEngine(p1Deck: string[], p2Deck: string[], seed = 20261124): GameEngine {
  const engine = new GameEngine(
    'stage2c1-test',
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

function findCard(engine: GameEngine, playerId: string, cardNumber: string, instanceIndex = 0) {
  const matches = Object.values(engine.getState().cards).filter(
    (c) => c.controllerPlayerId === playerId && c.cardNumber === cardNumber
  );
  const card = matches[instanceIndex];
  if (!card) throw new Error(`未找到玩家 ${playerId} 的第 ${instanceIndex} 张 ${cardNumber}`);
  return card;
}

function placeRole(
  engine: GameEngine,
  playerId: string,
  cardNumber: string,
  slotIndex: number,
  options?: { isReady?: boolean; enteredEarlier?: boolean; instanceIndex?: number }
) {
  const card = findCard(engine, playerId, cardNumber, options?.instanceIndex ?? 0);
  engine.zoneMgr.moveCard(card.instanceId, 'HAND', { isFaceUp: true });
  expect(engine.fieldMgr.playRoleCard(playerId, card.instanceId, slotIndex, { suppressEntryTrigger: true })).toBe(true);
  if (options?.enteredEarlier !== false) {
    card.turnEnteredZone = Math.max(0, engine.getState().turnNumber - 1);
  }
  if (options?.isReady !== undefined) {
    card.isReady = options.isReady;
  }
  return card;
}

describe('Stage 2C-1: 8.9 持续效果层、8.3.4/9.5 规则、6.5.1.d 顺序与确定性 ID', () => {
  describe('1. 8.9.1.d/e Layer 1 两阶段依赖、严格弱序与全附着区特征扫描', () => {
    it('providesTraits 即使时间戳更晚也先于 dependsOnTraits 适用，且非依赖 op 严格按时间戳排序', () => {
      const engine = createEngine(expandDeck('ST01'), expandDeck('ST02'));
      const state = engine.getState();
      const target = placeRole(engine, 'p1', 'ST01-001', 0);
      const lateTraitProvider = placeRole(engine, 'p1', 'ST01-003', 1);
      const earlyDepSource = placeRole(engine, 'p1', 'ST01-005', 2);

      earlyDepSource.enteredZoneTimestamp = 5;
      lateTraitProvider.enteredZoneTimestamp = 200;

      engine.continuousEffects.registerStaticRule({
        id: 'test:late-trait-provider',
        layer: 'NON_STAT',
        providesTraits: true,
        matchSource: (src) => src.instanceId === lateTraitProvider.instanceId,
        evaluate: (_src, t) =>
          t.instanceId === target.instanceId ? { addTraits: ['测试依赖盟约'] } : undefined,
      });

      engine.continuousEffects.registerStaticRule({
        id: 'test:early-dep-rule',
        layer: 'NON_STAT',
        dependsOnTraits: true,
        matchSource: (src) => src.instanceId === earlyDepSource.instanceId,
        evaluate: (_src, t, ctx) =>
          t.instanceId === target.instanceId && ctx.hasCardTrait(t.instanceId, '测试依赖盟约')
            ? { keywords: ['贯通'] }
            : undefined,
      });

      addCardModifier(state, target, {
        timestamp: 20,
        keywords: ['阻挡'],
        untilTurn: state.turnNumber,
      });
      addCardModifier(state, target, {
        timestamp: 30,
        loseAbilities: true,
        untilTurn: state.turnNumber,
      });
      addCardModifier(state, target, {
        timestamp: 40,
        keywords: ['突进'],
        untilTurn: state.turnNumber,
      });

      const stats = engine.continuousEffects.evaluateCard(target.instanceId);
      expect(stats.traits).toContain('测试依赖盟约');
      expect(stats.keywords).not.toContain('贯通');
      expect(stats.keywords).not.toContain('阻挡');
      expect(stats.keywords).toContain('突进');

      target.modifiers = (target.modifiers ?? []).filter((m) => !m.loseAbilities);
      const restored = engine.continuousEffects.evaluateCard(target.instanceId);
      expect(restored.keywords).toContain('贯通');
      expect(restored.keywords).toContain('阻挡');
      expect(restored.keywords).toContain('突进');
    });

    it('evaluateLayer1Traits 覆盖 PARTNER / UNDERNEATH / EQUIPPED 来源的特征赋予', () => {
      const engine = createEngine(expandDeck('ST01', ['BP01-020', 'BP01-050']), expandDeck('ST02'));
      const state = engine.getState();
      const host = placeRole(engine, 'p1', 'ST01-001', 0);
      const partner = findCard(engine, 'p1', 'ST01-003');
      const underCard = findCard(engine, 'p1', 'BP01-050');
      const equipCard = findCard(engine, 'p1', 'BP01-020');

      const hostSlot = state.battlefields['p1']![0]!;
      engine.zoneMgr.moveCard(partner.instanceId, 'BATTLEFIELD', { isFaceUp: true, isReady: true });
      partner.partnerOfCardId = host.instanceId;
      host.partnerCardId = partner.instanceId;
      hostSlot.partnerCardId = partner.instanceId;

      engine.zoneMgr.moveCard(underCard.instanceId, 'BATTLEFIELD', { isFaceUp: true, isReady: true });
      host.underneathCardIds = [underCard.instanceId];

      engine.zoneMgr.moveCard(equipCard.instanceId, 'BATTLEFIELD', { isFaceUp: true, isReady: true });
      equipCard.attachedToCardId = host.instanceId;
      host.attachedEquipmentId = equipCard.instanceId;

      engine.continuousEffects.registerStaticRule({
        id: 'test:partner-trait',
        layer: 'NON_STAT',
        sourceKind: 'PARTNER',
        providesTraits: true,
        matchSource: (src) => src.instanceId === partner.instanceId,
        evaluate: (_src, t) => (t.instanceId === host.instanceId ? { addTraits: ['搭档附体'] } : undefined),
      });
      engine.continuousEffects.registerStaticRule({
        id: 'test:under-trait',
        layer: 'NON_STAT',
        sourceKind: 'UNDERNEATH',
        providesTraits: true,
        matchSource: (src) => src.instanceId === underCard.instanceId,
        evaluate: (_src, t) => (t.instanceId === host.instanceId ? { addTraits: ['垫底共鸣'] } : undefined),
      });
      engine.continuousEffects.registerStaticRule({
        id: 'test:equip-trait',
        layer: 'NON_STAT',
        sourceKind: 'EQUIPPED',
        providesTraits: true,
        matchSource: (src) => src.instanceId === equipCard.instanceId,
        evaluate: (_src, t) => (t.instanceId === host.instanceId ? { addTraits: ['装备印记'] } : undefined),
      });

      expect(engine.continuousEffects.hasTrait(host.instanceId, '搭档附体')).toBe(true);
      expect(engine.continuousEffects.hasTrait(host.instanceId, '垫底共鸣')).toBe(true);
      expect(engine.continuousEffects.hasTrait(host.instanceId, '装备印记')).toBe(true);
    });
  });

  describe('2. 8.3.4 / Q&A·1 / Q&A·3 失去能力与后获能力保留', () => {
    it('先失去能力再通过 ST04-001 赋予触发器/关键字应保留；再吃第二次失能则清空', () => {
      const engine = createEngine(
        expandDeck('ST01', ['ST04-001', 'ST04-002', 'ST04-005']),
        expandDeck('ST02')
      );
      const state = engine.getState();
      const target = placeRole(engine, 'p1', 'ST04-002', 0, { isReady: false });

      // 切换成 p2 回合并进入可攻击主要阶段，以满足 ST04-001「只能在对方回合使用」与 p2 攻击
      ensurePlayerTurnCanAttack(engine, 'p2');
      const stateAfter = engine.getState();
      const targetNow = stateAfter.cards[target.instanceId]!;
      const iceCost = findCard(engine, 'p1', 'ST04-005');
      engine.zoneMgr.moveCard(iceCost.instanceId, 'COST', { isFaceUp: true, isReady: true });
      fillCostZone(engine, 'p1', 6);
      const shield = findCard(engine, 'p1', 'ST04-001');
      engine.zoneMgr.moveCard(shield.instanceId, 'HAND', { isFaceUp: true });

      // 对 target 先施加失能
      addCardModifier(stateAfter, targetNow, {
        loseAbilities: true,
        untilTurn: stateAfter.turnNumber,
      });
      expect(engine.continuousEffects.hasLostInherentAbilities(target.instanceId)).toBe(true);

      // 让 p2 宣告攻击使 p1 获得自由瞬时时机使用 ST04-001
      const oppAttacker = placeRole(engine, 'p2', 'ST02-001', 0, { isReady: true });
      expect(
        engine.dispatchAction({
          type: 'DECLARE_ATTACK',
          playerId: 'p2',
          attackerCardId: oppAttacker.instanceId,
          targetType: 'PLAYER',
        }).success
      ).toBe(true);
      if (engine.getState().timingWindow?.priorityPlayerId === 'p2') {
        expect(engine.dispatchAction({ type: 'PASS_ACTION_TIMING', playerId: 'p2' }).success).toBe(true);
      }
      expect(
        engine.dispatchAction({
          type: 'PLAY_CARD',
          playerId: 'p1',
          cardInstanceId: shield.instanceId,
        }).success
      ).toBe(true);
      resolvePendingChoices(engine);

      // Q&A·3：在 loseAbilities 之后使用 ST04-001 赋予的自动能力必须保留
      expect(
        engine.continuousEffects.hasGrantedTrigger(target.instanceId, 'ST04_001_GRANTED_BLOCK_END_DESTROY')
      ).toBe(true);
      expect(
        engine.continuousEffects.getGrantedTriggerKeys(target.instanceId, 'ST04_001_GRANTED_BLOCK_END_DESTROY').length
      ).toBe(1);

      // 若再施加一次更新时间戳的 loseAbilities，此前补获的触发器也被清除
      addCardModifier(engine.getState(), engine.getState().cards[target.instanceId]!, {
        loseAbilities: true,
        untilTurn: engine.getState().turnNumber,
      });
      expect(
        engine.continuousEffects.hasGrantedTrigger(target.instanceId, 'ST04_001_GRANTED_BLOCK_END_DESTROY')
      ).toBe(false);
    });

    it('静态 NON_STAT 规则 providesLoseAbilities: true 可通过 hasLostInherentAbilities 抑制目标自身【永】能力', () => {
      const engine = createEngine(expandDeck('ST01', ['BP04-001']), expandDeck('ST02'));
      const state = engine.getState();
      const luna = placeRole(engine, 'p1', 'BP04-001', 0);
      const suppressor = placeRole(engine, 'p2', 'ST02-001', 0);
      const underCard = findCard(engine, 'p1', 'ST01-002');
      engine.zoneMgr.moveCard(underCard.instanceId, 'BATTLEFIELD', { isFaceUp: true, isReady: true });
      luna.underneathCardIds = [underCard.instanceId];

      const lunaBasePP = db.getCard('BP04-001')!.basePP ?? 0;
      expect(engine.continuousEffects.evaluateCard(luna.instanceId).pp).toBe(lunaBasePP + 1000);

      engine.continuousEffects.registerStaticRule({
        id: 'test:static-silence',
        layer: 'NON_STAT',
        providesLoseAbilities: true,
        matchSource: (src) => src.instanceId === suppressor.instanceId,
        evaluate: (_src, t) => (t.instanceId === luna.instanceId ? { loseAbilities: true } : undefined),
      });

      expect(engine.continuousEffects.hasLostInherentAbilities(luna.instanceId)).toBe(true);
      expect(engine.continuousEffects.evaluateCard(luna.instanceId).pp).toBe(lunaBasePP);

      engine.zoneMgr.moveCard(suppressor.instanceId, 'GRAVEYARD', { isFaceUp: true });
      delete state.battlefields['p2']![0]!.roleCardId;
      expect(engine.continuousEffects.hasLostInherentAbilities(luna.instanceId)).toBe(false);
      expect(engine.continuousEffects.evaluateCard(luna.instanceId).pp).toBe(lunaBasePP + 1000);
    });

    it('BP01-050 失去能力解除固有「不能攻击」，但保留外部赋予的 CANNOT_ATTACK', () => {
      const engine = createEngine(expandDeck('ST01', ['BP01-050']), expandDeck('ST02'));
      const state = engine.getState();
      const pawa = placeRole(engine, 'p1', 'BP01-050', 0);

      expect(engine.continuousEffects.hasProhibition(pawa.instanceId, 'CANNOT_ATTACK')).toBe(true);

      addCardModifier(state, pawa, { loseAbilities: true, untilTurn: state.turnNumber });
      expect(engine.continuousEffects.hasProhibition(pawa.instanceId, 'CANNOT_ATTACK')).toBe(false);

      addCardModifier(state, pawa, {
        prohibitions: ['CANNOT_ATTACK'],
        untilTurn: state.turnNumber,
      });
      expect(engine.continuousEffects.hasProhibition(pawa.instanceId, 'CANNOT_ATTACK')).toBe(true);
    });

    it('Q&A·1 / Q&A·3：chargeIsAbility: true 在失能前丢失，失能后新赋予的保留', () => {
      const engine = createEngine(expandDeck('ST01', ['BP01-040', 'BP01-050']), expandDeck('ST02'));
      const state = engine.getState();
      const nanami = placeRole(engine, 'p1', 'BP01-040', 0);
      const pawa = findCard(engine, 'p1', 'BP01-050');
      engine.zoneMgr.moveCard(pawa.instanceId, 'BATTLEFIELD', { isFaceUp: true, isReady: true });
      nanami.underneathCardIds = [pawa.instanceId];

      expect(engine.continuousEffects.evaluateCard(nanami.instanceId).charge).toBe(2);

      addCardModifier(state, nanami, { loseAbilities: true, untilTurn: state.turnNumber });
      expect(engine.continuousEffects.evaluateCard(nanami.instanceId).charge).toBe(1);

      addCardModifier(state, nanami, {
        charge: 1,
        chargeIsAbility: true,
        untilTurn: state.turnNumber,
      });
      expect(engine.continuousEffects.evaluateCard(nanami.instanceId).charge).toBe(2);
    });
  });

  describe('3. 4.18.2 / 8.13.4.b / Q&A·6 / Q&A·10 / 6.5.1.d 与 appliedByPlayerId', () => {
    it('Q&A·6：装备 +500 PP 后被覆写 setPP: 70 为 70，卸装后 PP 跌至 -430 触发 SBA 9.4 破坏', () => {
      const engine = createEngine(expandDeck('ST02', ['ST02-009']), expandDeck('ST01'));
      const state = engine.getState();
      const target = placeRole(engine, 'p1', 'ST02-001', 0);
      const equip = findCard(engine, 'p1', 'ST02-009');
      fillCostZone(engine, 'p1', 5);
      engine.zoneMgr.moveCard(equip.instanceId, 'HAND', { isFaceUp: true });
      expect(
        engine.dispatchAction({
          type: 'PLAY_CARD',
          playerId: 'p1',
          cardInstanceId: equip.instanceId,
          targetEquipRoleId: target.instanceId,
        }).success
      ).toBe(true);
      resolvePendingChoices(engine);

      const equipBasePP = db.getCard('ST02-009')!.basePP ?? 0;
      expect(equipBasePP).toBe(500);

      addCardModifier(state, target, { setPP: 70, untilTurn: state.turnNumber });
      expect(engine.continuousEffects.evaluateCard(target.instanceId).pp).toBe(70);

      target.attachedEquipmentId = undefined;
      equip.attachedToCardId = undefined;
      engine.zoneMgr.moveCard(equip.instanceId, 'GRAVEYARD', { isFaceUp: true });
      expect(engine.continuousEffects.evaluateCard(target.instanceId).pp).toBe(-430);

      engine.checkTimingMgr.resolveCheckTiming();
      expect(target.zone).toBe('GRAVEYARD');
    });

    it('Q&A·10 & 6.5.1.d：协战+3000 后 setPP:70，回合结束先解除协战并在 CLEANUP_EXPIRE 检查 SBA(-2930破坏)，再过期 modifier；先 setPP:70 后协战则为 3070', () => {
      // 场景 A：先 setPP: 70 再协战 BP04-029 (basePP 3000) => 70 + 3000 = 3070
      {
        const engine = createEngine(
          expandDeck('ST01', ['BP04-023', 'BP04-029']),
          expandDeck('ST02')
        );
        ensurePlayerTurnCanAttack(engine, 'p1');
        const state = engine.getState();
        const host = placeRole(engine, 'p1', 'BP04-023', 0, { isReady: true });
        const attacker = placeRole(engine, 'p1', 'ST01-003', 1, { isReady: true });
        const partner = placeRole(engine, 'p1', 'BP04-029', 2, { isReady: true });
        fillCostZone(engine, 'p1', 5);

        addCardModifier(state, host, { setPP: 70, untilTurn: state.turnNumber });
        expect(engine.continuousEffects.evaluateCard(host.instanceId).pp).toBe(70);

        expect(
          engine.dispatchAction({
            type: 'DECLARE_ATTACK',
            playerId: 'p1',
            attackerCardId: attacker.instanceId,
            targetType: 'PLAYER',
          }).success
        ).toBe(true);
        expect(
          engine.dispatchAction({
            type: 'PERFORM_ASSIST',
            playerId: 'p1',
            hostRoleCardId: host.instanceId,
            partnerCardId: partner.instanceId,
          }).success
        ).toBe(true);
        expect(engine.continuousEffects.evaluateCard(host.instanceId).pp).toBe(3070);
      }

      // 场景 B：先协战 +3000，再 setPP: 70(untilTurn)，回合结束 6.5.1.d 先解协战后跑检查时机(PP=-2930 破坏)，再过期 setPP
      {
        const engine = createEngine(
          expandDeck('ST01', ['BP04-023', 'BP04-029']),
          expandDeck('ST02')
        );
        ensurePlayerTurnCanAttack(engine, 'p1');
        const state = engine.getState();
        const host = placeRole(engine, 'p1', 'BP04-023', 0, { isReady: true });
        const attacker = placeRole(engine, 'p1', 'ST01-003', 1, { isReady: true });
        const partner = placeRole(engine, 'p1', 'BP04-029', 2, { isReady: true });
        fillCostZone(engine, 'p1', 5);

        expect(
          engine.dispatchAction({
            type: 'DECLARE_ATTACK',
            playerId: 'p1',
            attackerCardId: attacker.instanceId,
            targetType: 'PLAYER',
          }).success
        ).toBe(true);
        expect(
          engine.dispatchAction({
            type: 'PERFORM_ASSIST',
            playerId: 'p1',
            hostRoleCardId: host.instanceId,
            partnerCardId: partner.instanceId,
          }).success
        ).toBe(true);
        passInstantWindows(engine);
        resolvePendingChoices(engine);

        addCardModifier(state, host, { setPP: 70, untilTurn: state.turnNumber });
        expect(engine.continuousEffects.evaluateCard(host.instanceId).pp).toBe(70);

        endTurn(engine);
        expect(partner.zone).toBe('GRAVEYARD');
        expect(host.zone).toBe('GRAVEYARD');
      }
    });

    it('Q&A·9：BP04-016 在对方回合仅屏蔽对方 appliedByPlayerId 施加的 PP 增减，允许己方增减', () => {
      const engine = createEngine(expandDeck('ST01', ['BP04-016']), expandDeck('ST02'));
      const vera = placeRole(engine, 'p1', 'BP04-016', 0);
      const basePP = db.getCard('BP04-016')!.basePP ?? 0;

      endTurn(engine);
      const state = engine.getState();
      expect(state.activePlayerId).toBe('p2');
      expect(engine.continuousEffects.hasProhibition(vera.instanceId, 'CANNOT_MODIFY_PP_BY_OPPONENT')).toBe(true);

      addCardModifier(state, vera, {
        pp: -2000,
        appliedByPlayerId: 'p2',
        untilTurn: state.turnNumber,
      });
      expect(engine.continuousEffects.evaluateCard(vera.instanceId).pp).toBe(basePP);

      addCardModifier(state, vera, {
        pp: 1000,
        appliedByPlayerId: 'p1',
        untilTurn: state.turnNumber,
      });
      expect(engine.continuousEffects.evaluateCard(vera.instanceId).pp).toBe(basePP + 1000);
    });
  });

  describe('4. SBA 9.5.2 / 9.5.3、ENG-H10 与 ENG-H11', () => {
    it('9.5.2：顶层非法战术牌被 SBA 送墓，而角色下方或搭档区同卡不受影响', () => {
      const engine = createEngine(expandDeck('ST01'), expandDeck('ST02'));
      const state = engine.getState();
      const illegalTop = findCard(engine, 'p1', 'ST01-012', 0);
      const legalUnder = findCard(engine, 'p1', 'ST01-013', 0);
      const host = placeRole(engine, 'p1', 'ST01-001', 0);

      expect(db.getCard('ST01-012')?.cardType).toBe(CardType.TACTICS);

      engine.zoneMgr.moveCard(illegalTop.instanceId, 'BATTLEFIELD', { isFaceUp: true, isReady: true });
      state.battlefields['p1']![1]!.roleCardId = illegalTop.instanceId;

      engine.zoneMgr.moveCard(legalUnder.instanceId, 'BATTLEFIELD', { isFaceUp: true, isReady: true });
      host.underneathCardIds = [legalUnder.instanceId];

      engine.checkTimingMgr.resolveCheckTiming();

      expect(illegalTop.zone).toBe('GRAVEYARD');
      expect(state.battlefields['p1']![1]!.roleCardId).toBeUndefined();
      expect(host.underneathCardIds).toContain(legalUnder.instanceId);
      expect(legalUnder.zone).toBe('BATTLEFIELD');
    });

    it('9.5.3：BP01-017 双持 <小太刀>+<大太刀> 失去能力后仅保留第1张装备，多余装备被 SBA 送墓', () => {
      const engine = createEngine(
        expandDeck('ST01', ['BP01-017', 'BP01-018', 'BP01-020', 'BP01-021']),
        expandDeck('ST02')
      );
      const state = engine.getState();
      const alpha = placeRole(engine, 'p1', 'BP01-017', 0);
      const lightningCost = findCard(engine, 'p1', 'BP01-018');
      const sword1 = findCard(engine, 'p1', 'BP01-020');
      const sword2 = findCard(engine, 'p1', 'BP01-021');
      engine.zoneMgr.moveCard(lightningCost.instanceId, 'COST', { isFaceUp: true, isReady: true });
      fillCostZone(engine, 'p1', 6);

      engine.zoneMgr.moveCard(sword1.instanceId, 'HAND', { isFaceUp: true });
      engine.zoneMgr.moveCard(sword2.instanceId, 'HAND', { isFaceUp: true });
      expect(
        engine.dispatchAction({
          type: 'PLAY_CARD',
          playerId: 'p1',
          cardInstanceId: sword1.instanceId,
          targetEquipRoleId: alpha.instanceId,
        }).success
      ).toBe(true);
      expect(
        engine.dispatchAction({
          type: 'PLAY_CARD',
          playerId: 'p1',
          cardInstanceId: sword2.instanceId,
          targetEquipRoleId: alpha.instanceId,
        }).success
      ).toBe(true);
      expect(alpha.attachedEquipmentId).toBe(sword1.instanceId);
      expect(alpha.extraAttachedEquipmentIds).toEqual([sword2.instanceId]);

      addCardModifier(state, alpha, { loseAbilities: true, untilTurn: state.turnNumber });
      engine.checkTimingMgr.resolveCheckTiming();

      expect(engine.getState().cards[alpha.instanceId]!.attachedEquipmentId).toBe(sword1.instanceId);
      expect(engine.getState().cards[sword1.instanceId]!.zone).toBe('BATTLEFIELD');
      expect(engine.getState().cards[alpha.instanceId]!.extraAttachedEquipmentIds ?? []).toEqual([]);
      expect(engine.getState().cards[sword2.instanceId]!.zone).toBe('GRAVEYARD');
    });

    it('ENG-H10：宿主带有 CANNOT_GAIN_ABILITIES 时，BP01-022 赋予的【起】能力不可发动', () => {
      const engine = createEngine(
        expandDeck('ST01', ['BP01-017', 'BP01-022']),
        expandDeck('ST02')
      );
      ensurePlayerTurnCanAttack(engine, 'p1');
      const state = engine.getState();
      const host = placeRole(engine, 'p1', 'BP01-017', 0);
      const eq = findCard(engine, 'p1', 'BP01-022');
      const orb = findCard(engine, 'p1', 'ST01-012');
      engine.zoneMgr.moveCard(orb.instanceId, 'SIGNAL_ORB', { isFaceUp: true, isReady: true });
      expect(engine.fieldMgr.equipToRole('p1', eq.instanceId, host.instanceId)).toBe(true);

      addCardModifier(state, engine.getState().cards[host.instanceId]!, {
        prohibitions: ['CANNOT_GAIN_ABILITIES'],
        untilTurn: state.turnNumber,
      });
      const blocked = engine.dispatchAction({
        type: 'ACTIVATE_ABILITY',
        playerId: 'p1',
        sourceCardId: host.instanceId,
        abilityIndex: 0,
      });
      expect(blocked.success).toBe(false);

      // 失败回滚会替换状态对象，必须按 ID 重新取 state.cards[host.instanceId]
      engine.getState().cards[host.instanceId]!.modifiers = [];
      const allowed = engine.dispatchAction({
        type: 'ACTIVATE_ABILITY',
        playerId: 'p1',
        sourceCardId: host.instanceId,
        abilityIndex: 0,
      });
      expect(allowed.success, allowed.error).toBe(true);
    });

    it('ENG-H11：PR-030 充能自消球路径会向 TriggerManager 发出 ORBS_ELIMINATED 事件', () => {
      const engine = createEngine(
        expandDeck('ST01', ['BP03-023', 'PR-030', 'PR-030']),
        expandDeck('ST02')
      );
      ensurePlayerTurnCanAttack(engine, 'p1');

      const attacker = placeRole(engine, 'p1', 'BP03-023', 0, { isReady: true });
      const pr030Top = findCard(engine, 'p1', 'PR-030', 0);
      const handLee = findCard(engine, 'p1', 'PR-030', 1); // 里·超刻 2费 <= 3
      const blueOrb = findCard(engine, 'p1', 'ST01-013');
      engine.zoneMgr.moveCard(handLee.instanceId, 'HAND', { isFaceUp: true });
      engine.zoneMgr.moveCard(blueOrb.instanceId, 'SIGNAL_ORB', { isFaceUp: true, isReady: true });
      engine.zoneMgr.moveCardToTopOfDeck(pr030Top.instanceId);

      const observedOrbEvents: string[][] = [];
      engine.triggerMgr.registerTrigger({
        abilityId: 'test:observe-orbs-eliminated',
        eventTypes: ['ORBS_ELIMINATED'],
        collect: (ctx) => [
          {
            sourceCardInstanceId: attacker.instanceId,
            sourceCardNumber: attacker.cardNumber,
            controllerPlayerId: 'p1',
            label: '观察 ORBS_ELIMINATED',
            triggerContext: { orbIds: ctx.event.orbCardIds ?? [] },
          },
        ],
        execute: (trigger) => {
          observedOrbEvents.push((trigger.triggerContext['orbIds'] as string[]) ?? []);
        },
      });

      expect(
        engine.dispatchAction({
          type: 'DECLARE_ATTACK',
          playerId: 'p1',
          attackerCardId: attacker.instanceId,
          targetType: 'PLAYER',
        }).success
      ).toBe(true);
      passInstantWindows(engine);

      const choice = engine.getState().currentPendingChoice;
      expect(choice?.effectType).toBe('PR030_CHARGE_AUTO_ORB');
      const pickRes = engine.dispatchAction({
        type: 'SELECT_CHOICE_OPTION',
        playerId: 'p1',
        pendingChoiceId: choice!.id,
        selectedIds: [blueOrb.instanceId],
      });
      expect(pickRes.success, pickRes.error).toBe(true);
      resolvePendingChoices(engine);

      expect(observedOrbEvents.some((ids) => ids.includes(blueOrb.instanceId))).toBe(true);
    });
  });

  describe('5. choiceIdSeq 确定性与快照恢复', () => {
    it('相同 (seed, actions) 产生完全一致的 choice.id 与 modifier.id，快照恢复后继续严格递增无碰撞', () => {
      const runSequence = () => {
        const eng = createEngine(
          expandDeck('ST01', ['BP03-023', 'PR-030', 'PR-030']),
          expandDeck('ST02'),
          778899
        );
        ensurePlayerTurnCanAttack(eng, 'p1');
        const atk = placeRole(eng, 'p1', 'BP03-023', 0, { isReady: true });
        const pr030Top = findCard(eng, 'p1', 'PR-030', 0);
        const handLee = findCard(eng, 'p1', 'PR-030', 1);
        const blueOrb = findCard(eng, 'p1', 'ST01-013');
        eng.zoneMgr.moveCard(handLee.instanceId, 'HAND', { isFaceUp: true });
        eng.zoneMgr.moveCard(blueOrb.instanceId, 'SIGNAL_ORB', { isFaceUp: true, isReady: true });
        eng.zoneMgr.moveCardToTopOfDeck(pr030Top.instanceId);
        nextEffectTimestamp(eng.getState());
        const mod = addCardModifier(eng.getState(), atk, { pp: 500, untilTurn: eng.getState().turnNumber });

        eng.dispatchAction({
          type: 'DECLARE_ATTACK',
          playerId: 'p1',
          attackerCardId: atk.instanceId,
          targetType: 'PLAYER',
        });
        passInstantWindows(eng);
        const c1 = eng.getState().currentPendingChoice!;
        return {
          engine: eng,
          firstChoiceId: c1.id,
          firstChoiceSeq: eng.getState().choiceIdSeq,
          modId: mod.id,
        };
      };

      const runA = runSequence();
      const runB = runSequence();

      expect(runA.firstChoiceId).toBe(runB.firstChoiceId);
      expect(runA.firstChoiceId).toMatch(/^choice-/);
      expect(runA.firstChoiceSeq).toBe(runB.firstChoiceSeq);
      expect(runA.modId).toBe(runB.modId);

      const snapshot = runA.engine.toSnapshot();
      const restored = GameEngine.fromSnapshot(snapshot, db);
      expect(restored.getState().choiceIdSeq).toBe(runA.firstChoiceSeq);

      const postId1 = nextChoiceId(restored.getState(), 'effect');
      enqueuePendingChoice(restored.getState(), {
        id: nextChoiceId(restored.getState(), 'test'),
        playerId: 'p1',
        choiceType: 'CONFIRM',
        prompt: '快照后确认',
        options: [{ id: 'ok', label: '确定' }],
        effectType: 'TEST_AFTER_SNAPSHOT',
        minSelections: 1,
        maxSelections: 1,
      });

      expect(postId1).not.toBe(runA.firstChoiceId);
      expect(restored.getState().choiceIdSeq).toBe((runA.firstChoiceSeq ?? 0) + 2);
    });
  });
});

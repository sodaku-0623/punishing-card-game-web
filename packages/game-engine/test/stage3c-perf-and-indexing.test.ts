import { describe, it, expect, vi } from 'vitest';
import { CardType } from '@zhanshuang/shared';
import { OFFICIAL_STARTER_DECKS } from '@zhanshuang/game-rules';
import {
  GameEngine,
  MemoryCardDatabase,
  OFFICIAL_CARDS_DATA,
  addCardModifier,
  fastDeepClone,
} from '../src/index.js';
import { fillCostZone, passInstantWindows } from './helpers.js';

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

function createEngine(p1Deck: string[], p2Deck: string[], seed = 20261125): GameEngine {
  const engine = new GameEngine(
    'stage3c-test',
    { playerId: 'p1', deckCardNumbers: p1Deck },
    { playerId: 'p2', deckCardNumbers: p2Deck },
    seed,
    db,
    { skipMulligan: true }
  );
  const state = engine.getState();
  if (state.phase === 'DRAW_CHARGE_PHASE') {
    expect(
      engine.dispatchAction({ type: 'PASS_ACTION_TIMING', playerId: state.activePlayerId }).success
    ).toBe(true);
  }
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
  options?: { isReady?: boolean; instanceIndex?: number }
) {
  const card = findCard(engine, playerId, cardNumber, options?.instanceIndex ?? 0);
  engine.zoneMgr.moveCard(card.instanceId, 'HAND', { isFaceUp: true });
  expect(engine.fieldMgr.playRoleCard(playerId, card.instanceId, slotIndex, { suppressEntryTrigger: true })).toBe(true);
  card.turnEnteredZone = Math.max(0, engine.getState().turnNumber - 1);
  if (options?.isReady !== undefined) {
    card.isReady = options.isReady;
  }
  return card;
}

describe('Stage 3C: 引擎性能优化与索引语义等价验证', () => {
  describe('1. ContinuousEffectEngine 规则索引等价、动态 wildcard 规则与帧缓存失效', () => {
    it('动态 wildcard 规则 (NON_STAT / STAT / providesTraits / providesLoseAbilities) 正确生效，且 registerStaticRule 自动失效帧缓存', () => {
      const engine = createEngine(expandDeck('ST01'), expandDeck('ST02'));
      const host = placeRole(engine, 'p1', 'ST01-001', 0);
      const source = placeRole(engine, 'p1', 'ST01-003', 1);
      const hiddenCost = findCard(engine, 'p1', 'ST01-012');
      engine.zoneMgr.moveCard(hiddenCost.instanceId, 'COST', { isFaceUp: false, isReady: true });

      const basePP = db.getCard('ST01-001')!.basePP ?? 0;

      // 生产默认无作用于费用区的静态禁止规则，快路径直接返回 false
      expect(
        engine.continuousEffects.hasProhibition(hiddenCost.instanceId, 'CANNOT_DISCARD_HIDDEN_COST_AT_END')
      ).toBe(false);

      // 1) 注册无 sourceCardNumber 的 wildcard STAT / NON_STAT 规则，并在同一帧内校验与重注册失效
      engine.continuousEffects.withEvalFrame(() => {
        expect(engine.continuousEffects.evaluateCard(host.instanceId).pp).toBe(basePP);

        engine.continuousEffects.registerStaticRule({
          id: 'test:wc:pp-and-trait',
          layer: 'NON_STAT',
          providesTraits: true,
          matchSource: (src) => src.instanceId === source.instanceId,
          evaluate: (_src, target) =>
            target.instanceId === host.instanceId
              ? { addTraits: ['通配测试特征'], keywords: ['贯通'] }
              : undefined,
        });
        // registerStaticRule 应已调用 invalidateEvalFrame()
        expect(engine.continuousEffects.hasTrait(host.instanceId, '通配测试特征')).toBe(true);
        expect(engine.continuousEffects.hasKeyword(host.instanceId, '贯通')).toBe(true);

        engine.continuousEffects.registerStaticRule({
          id: 'test:wc:stat',
          layer: 'STAT',
          matchSource: (src) => src.instanceId === source.instanceId,
          evaluate: (_src, target) =>
            target.instanceId === host.instanceId ? { pp: 1500 } : undefined,
        });
        expect(engine.continuousEffects.evaluateCard(host.instanceId).pp).toBe(basePP + 1500);
      });

      // 2) 动态注册 providesLoseAbilities: true 的 wildcard 规则可抑制来源/目标固有能力
      engine.continuousEffects.registerStaticRule({
        id: 'test:wc:silence',
        layer: 'NON_STAT',
        providesLoseAbilities: true,
        matchSource: (src) => src.instanceId === host.instanceId,
        evaluate: (_src, target) =>
          target.instanceId === source.instanceId ? { loseAbilities: true } : undefined,
      });
      expect(engine.continuousEffects.hasLostInherentAbilities(source.instanceId)).toBe(true);
      expect(engine.continuousEffects.evaluateCard(host.instanceId).pp).toBe(basePP);
      expect(engine.continuousEffects.hasTrait(host.instanceId, '通配测试特征')).toBe(false);

      // 3) 动态注册未声明 providesProhibitions 的 wildcard 规则后，hasCostZoneProhibitionRules 自动放行完整判定
      engine.continuousEffects.registerStaticRule({
        id: 'test:wc:cost-prohibition',
        layer: 'NON_STAT',
        matchSource: (src) => src.instanceId === host.instanceId,
        evaluate: (_src, target) =>
          target.instanceId === hiddenCost.instanceId
            ? { prohibitions: ['CANNOT_DISCARD_HIDDEN_COST_AT_END'] }
            : undefined,
      });
      expect(
        engine.continuousEffects.hasProhibition(hiddenCost.instanceId, 'CANNOT_DISCARD_HIDDEN_COST_AT_END')
      ).toBe(true);
    });

    it('递归防环降级结果绝不写入帧缓存', () => {
      const engine = createEngine(expandDeck('ST01'), expandDeck('ST02'));
      const a = placeRole(engine, 'p1', 'ST01-001', 0);
      const b = placeRole(engine, 'p1', 'ST01-003', 1);

      // 构造 A <-> B 的失能递归环，并在其中查询 evaluateCard(a)
      engine.continuousEffects.registerStaticRule({
        id: 'test:cycle:a',
        layer: 'NON_STAT',
        providesLoseAbilities: true,
        matchSource: (src) => src.instanceId === b.instanceId,
        evaluate: (src, target) => {
          if (target.instanceId !== a.instanceId) return undefined;
          // 递归检查 A 自身状态触发防环降级
          const inner = engine.continuousEffects.evaluateCard(a.instanceId);
          return inner.pp > 0 ? { loseAbilities: true } : undefined;
        },
      });
      engine.continuousEffects.registerStaticRule({
        id: 'test:cycle:b',
        layer: 'NON_STAT',
        providesLoseAbilities: true,
        matchSource: (src) => src.instanceId === a.instanceId,
        evaluate: (_src, target) =>
          target.instanceId === b.instanceId ? { loseAbilities: true } : undefined,
      });

      engine.continuousEffects.withEvalFrame(() => {
        // 首次求值 a 时内部触发防环，不应污染帧缓存
        const lostA = engine.continuousEffects.hasLostInherentAbilities(a.instanceId);
        expect(typeof lostA).toBe('boolean');
        // 解除循环依赖后重新求值在同一帧内仍能正确反映未失能结果
        engine.continuousEffects.registerStaticRule({
          id: 'test:cycle:a',
          layer: 'NON_STAT',
          providesLoseAbilities: true,
          matchSource: () => false,
          evaluate: () => undefined,
        });
        expect(engine.continuousEffects.hasLostInherentAbilities(a.instanceId)).toBe(false);
      });
    });

    it('内置 4 条静态规则 (BP04-001 / BP04-016 / BP04-032 / BP02-040) 索引查找完全等价', () => {
      const engine = createEngine(
        expandDeck('ST01', ['BP04-001', 'BP04-032', 'BP04-028', 'BP02-040']),
        expandDeck('ST02', ['BP04-016'])
      );
      const state = engine.getState();

      // BP04-001: 下方 10 张牌 PP+10000 & DP+1
      const luna = placeRole(engine, 'p1', 'BP04-001', 0);
      const deckCards = engine.zoneMgr.getCardsInZone('p1', 'DECK').slice(0, 10);
      for (const dc of deckCards) {
        engine.zoneMgr.moveCard(dc.instanceId, 'BATTLEFIELD', { isFaceUp: true, isReady: true });
      }
      luna.underneathCardIds = deckCards.map((c) => c.instanceId);
      const lunaDef = db.getCard('BP04-001')!;
      const lunaStats = engine.continuousEffects.evaluateCard(luna.instanceId);
      expect(lunaStats.pp).toBe((lunaDef.basePP ?? 0) + 10000);
      expect(lunaStats.dp).toBe((lunaDef.baseDP ?? 0) + 1);

      // BP04-016: 对方回合获得 CANNOT_MODIFY_PP_BY_OPPONENT
      const vera = placeRole(engine, 'p2', 'BP04-016', 0);
      // 当前是 p1 回合，对 p2 而言是对方回合
      expect(engine.continuousEffects.hasProhibition(vera.instanceId, 'CANNOT_MODIFY_PP_BY_OPPONENT')).toBe(true);
      const veraBasePP = db.getCard('BP04-016')!.basePP ?? 0;
      addCardModifier(state, vera, { pp: -2000, appliedByPlayerId: 'p1', untilTurn: state.turnNumber });
      expect(engine.continuousEffects.evaluateCard(vera.instanceId).pp).toBe(veraBasePP);

      // BP04-032: 我方战场存在《渡边·尘铭》时信号球区正面《炽能球》视为 RED 信号球
      const fireOrb = findCard(engine, 'p1', 'BP04-032');
      engine.zoneMgr.moveCard(fireOrb.instanceId, 'SIGNAL_ORB', { isFaceUp: true, isReady: true });
      expect(engine.continuousEffects.getEffectiveOrbInfo(fireOrb.instanceId).isOrb).toBe(false);
      placeRole(engine, 'p1', 'BP04-028', 1);
      const orbInfo = engine.continuousEffects.getEffectiveOrbInfo(fireOrb.instanceId);
      expect(orbInfo.isOrb).toBe(true);
      expect(orbInfo.colors).toContain('RED');

      // BP02-040: 所有区域视为《飞叶点翠》
      const hanying = findCard(engine, 'p1', 'BP02-040');
      expect(engine.continuousEffects.hasCardName(hanying.instanceId, '飞叶点翠')).toBe(true);
    });
  });

  describe('2. DSL 小索引与快路径 + TriggerManager 事件桶索引', () => {
    it('BP02-009 / BP04-059 fieldIgnoreAttributeRule 小索引判定准确', () => {
      const shinenDef = OFFICIAL_CARDS_DATA.find(
        (c) => c.cardType === CardType.ROLE && (c.traits.includes('神寂启示录') || c.traits.includes('异聚体'))
      )!;
      const engine = createEngine(
        expandDeck('ST01', ['BP02-009', 'BP02-010', 'BP04-059', shinenDef.cardNumber]),
        expandDeck('ST02')
      );
      const bp02009 = findCard(engine, 'p1', 'BP02-009');
      const bp02010 = findCard(engine, 'p1', 'BP02-010');
      const bp02010Def = db.getCard('BP02-010')!;
      engine.zoneMgr.moveCard(bp02010.instanceId, 'HAND', { isFaceUp: true });
      expect(
        engine.effectEngine.presets.interpreter.canPlayerIgnoreAttributeForPlay('p1', bp02010.instanceId, bp02010Def, false)
      ).toBe(false);

      // BP02-009 放到正面费用区后生效
      engine.zoneMgr.moveCard(bp02009.instanceId, 'COST', { isFaceUp: true, isReady: true });
      expect(
        engine.effectEngine.presets.interpreter.canPlayerIgnoreAttributeForPlay('p1', bp02010.instanceId, bp02010Def, false)
      ).toBe(true);

      // BP04-059 放到战场后使<神寂启示录>角色无视属性条件
      const shinenCard = findCard(engine, 'p1', shinenDef.cardNumber);
      engine.zoneMgr.moveCard(shinenCard.instanceId, 'HAND', { isFaceUp: true });
      expect(
        engine.effectEngine.presets.interpreter.canPlayerIgnoreAttributeForPlay('p1', shinenCard.instanceId, shinenDef, false)
      ).toBe(false);
      const bp04059 = findCard(engine, 'p1', 'BP04-059');
      engine.zoneMgr.moveCard(bp04059.instanceId, 'HAND', { isFaceUp: true });
      expect(engine.fieldMgr.playRoleCard('p1', bp04059.instanceId, 0, { suppressEntryTrigger: true })).toBe(true);
      expect(
        engine.effectEngine.presets.interpreter.canPlayerIgnoreAttributeForPlay('p1', shinenCard.instanceId, shinenDef, false)
      ).toBe(true);
    });

    it('BP01-077 / BP01-015 / BP03-073 fieldCardCostRule 先查规格再判失能', () => {
      const engine = createEngine(
        expandDeck('ST01', ['BP01-077', 'BP01-015', 'BP03-073', 'ST04-001', 'BP01-020', 'BP03-074']),
        expandDeck('ST02')
      );
      const state = engine.getState();
      const r1 = placeRole(engine, 'p1', 'BP01-077', 0);
      placeRole(engine, 'p1', 'BP01-015', 1);
      placeRole(engine, 'p1', 'BP03-073', 2);

      const shieldAdj = engine.effectEngine.presets.interpreter.calculateFieldHandCostAdjustment(
        'p1',
        db.getCard('ST04-001')!,
        false
      );
      expect(shieldAdj.setCost).toBe(1);

      const eqAdj = engine.effectEngine.presets.interpreter.calculateFieldHandCostAdjustment(
        'p1',
        db.getCard('BP01-020')!,
        false
      );
      expect(eqAdj.discount).toBe(1);

      const artAdj = engine.effectEngine.presets.interpreter.calculateFieldHandCostAdjustment(
        'p1',
        db.getCard('BP03-074')!,
        false
      );
      expect(artAdj.discount).toBe(1);

      // 失能后不再提供减费/改费
      addCardModifier(state, r1, { loseAbilities: true, untilTurn: state.turnNumber });
      const shieldAfterSilence = engine.effectEngine.presets.interpreter.calculateFieldHandCostAdjustment(
        'p1',
        db.getCard('ST04-001')!,
        false
      );
      expect(shieldAfterSilence.setCost).toBeUndefined();
    });

    it('TriggerManager 按 eventType 分桶索引与重注册去重顺序一致', () => {
      const engine = createEngine(expandDeck('ST01'), expandDeck('ST02'));
      const logs: string[] = [];
      const card = placeRole(engine, 'p1', 'ST01-001', 0);

      engine.triggerMgr.registerTrigger({
        abilityId: 'test:trig:dup',
        eventTypes: ['CARD_TAPPED', 'CARD_TAPPED'],
        collect: () => [
          {
            sourceCardInstanceId: card.instanceId,
            sourceCardNumber: card.cardNumber,
            controllerPlayerId: 'p1',
            label: '测试横置触发',
            triggerContext: {},
          },
        ],
        execute: () => {
          logs.push('first');
        },
      });
      engine.triggerMgr.emit({ type: 'CARD_TAPPED', playerId: 'p1', cardInstanceId: card.instanceId });
      expect(engine.getState().pendingTriggers.filter((t) => t.abilityId === 'test:trig:dup').length).toBe(1);
      engine.checkTimingMgr.resolveCheckTiming();
      expect(logs).toEqual(['first']);

      // 重注册将 eventTypes 改为 CARD_DESTROYED，旧事件 CARD_TAPPED 不应再触发
      engine.triggerMgr.registerTrigger({
        abilityId: 'test:trig:dup',
        eventTypes: ['CARD_DESTROYED'],
        collect: () => [
          {
            sourceCardInstanceId: card.instanceId,
            sourceCardNumber: card.cardNumber,
            controllerPlayerId: 'p1',
            label: '测试破坏触发',
            triggerContext: {},
          },
        ],
        execute: () => {
          logs.push('second');
        },
      });
      engine.triggerMgr.emit({ type: 'CARD_TAPPED', playerId: 'p1', cardInstanceId: card.instanceId });
      expect(engine.getState().pendingTriggers.filter((t) => t.abilityId === 'test:trig:dup').length).toBe(0);
      engine.triggerMgr.emit({ type: 'CARD_DESTROYED', playerId: 'p1', cardInstanceId: card.instanceId });
      expect(engine.getState().pendingTriggers.filter((t) => t.abilityId === 'test:trig:dup').length).toBe(1);
    });
  });

  describe('3. fastDeepClone、事务回滚、只读守卫前置、refreshDisplayedStats 与 ZoneManager 缓存', () => {
    it('fastDeepClone 保持对象键序与数组/Date/原始值隔离', () => {
      const sampleDate = new Date('2026-11-25T00:00:00.000Z');
      const orig = {
        num: 42,
        str: '战双',
        nil: null,
        undef: undefined,
        createdAt: sampleDate,
        orderedMap: { c3: { v: 3 }, c1: { v: 1 }, c2: { v: 2 } },
        arr: [{ nested: [1, 2] }],
      };
      const cloned = fastDeepClone(orig);
      expect(cloned).toEqual(orig);
      expect(Object.keys(cloned.orderedMap)).toEqual(['c3', 'c1', 'c2']);
      expect(cloned.createdAt).not.toBe(orig.createdAt);
      expect(cloned.createdAt.getTime()).toBe(orig.createdAt.getTime());
      cloned.arr[0]!.nested.push(99);
      expect(orig.arr[0]!.nested).toEqual([1, 2]);
    });

    it('dispatchAction 只读守卫前置且失败行动原地恢复 state 引用与清空缓存', () => {
      const engine = createEngine(expandDeck('ST01'), expandDeck('ST02'));
      const stateRef = engine.getState();

      // 非法 action 对象守卫
      const badRes = engine.dispatchAction(null as unknown as Parameters<GameEngine['dispatchAction']>[0]);
      expect(badRes.success).toBe(false);
      expect(badRes.error).toBe('无效的行动请求');
      expect(engine.getState()).toBe(stateRef);

      // 非本局玩家守卫
      const guestRes = engine.dispatchAction({ type: 'PASS_ACTION_TIMING', playerId: 'intruder' });
      expect(guestRes.success).toBe(false);
      expect(guestRes.error).toBe('非本局玩家，无法执行该行动');

      // 费用不足的 PLAY_CARD 失败回滚：原地恢复同一 stateRef，且区缓存/帧缓存一致
      const highCostCard = Object.values(stateRef.cards).find(
        (c) => c.controllerPlayerId === stateRef.activePlayerId && (db.getCard(c.cardNumber)?.cost ?? 0) >= 5
      )!;
      engine.zoneMgr.moveCard(highCostCard.instanceId, 'HAND', { isFaceUp: true });
      const snapBefore = JSON.stringify(stateRef);
      const failPlay = engine.dispatchAction({
        type: 'PLAY_CARD',
        playerId: stateRef.activePlayerId,
        cardInstanceId: highCostCard.instanceId,
      });
      expect(failPlay.success).toBe(false);
      expect(engine.getState()).toBe(stateRef);
      expect(JSON.stringify(engine.getState())).toBe(snapBefore);
    });

    it('refreshDisplayedStats 精准标注受保护暗费并清理离场角色残留 effective* 字段', () => {
      const engine = createEngine(expandDeck('ST01', ['BP03-079']), expandDeck('ST02'));
      const state = engine.getState();
      const hiddenCost = findCard(engine, 'p1', 'ST01-012');
      engine.zoneMgr.moveCard(hiddenCost.instanceId, 'COST', { isFaceUp: false, isReady: true });
      const normalHidden = findCard(engine, 'p1', 'ST01-013');
      engine.zoneMgr.moveCard(normalHidden.instanceId, 'COST', { isFaceUp: false, isReady: true });

      addCardModifier(state, hiddenCost, {
        prohibitions: ['CANNOT_DISCARD_HIDDEN_COST_AT_END'],
        untilTurn: state.turnNumber,
      });
      const role = placeRole(engine, 'p1', 'ST01-001', 0, { isReady: true });
      const role2 = placeRole(engine, 'p1', 'ST01-003', 1, { isReady: true });
      // 通过主要阶段内合法行动 (DECLARE_ATTACK) 触发 refreshDisplayedStats，保持当前回合与暗费未结算
      expect(
        engine.dispatchAction({
          type: 'DECLARE_ATTACK',
          playerId: state.activePlayerId,
          attackerCardId: role.instanceId,
          targetType: 'PLAYER',
        }).success
      ).toBe(true);
      expect(state.cards[hiddenCost.instanceId]!.effectiveProhibitions).toEqual([
        'CANNOT_DISCARD_HIDDEN_COST_AT_END',
      ]);
      expect(state.cards[normalHidden.instanceId]!.effectiveProhibitions).toBeUndefined();
      expect(state.cards[role.instanceId]!.effectivePP).toBeGreaterThan(0);
      expect(state.cards[role2.instanceId]!.effectivePP).toBeGreaterThan(0);

      // 角色通过 moveCard 离场时立即清空 effectivePP / effectiveDP / effectiveKeywords / effectiveTraits
      engine.zoneMgr.moveCard(role.instanceId, 'GRAVEYARD', { isFaceUp: true });
      expect(role.effectivePP).toBeUndefined();
      expect(role.effectiveDP).toBeUndefined();
      expect(role.effectiveKeywords).toBeUndefined();
      expect(role.effectiveTraits).toBeUndefined();

      // 非正常路径直接篡改槽位/区域（未经过 moveCard）后，下一次行动的 refreshDisplayedStats 仍应安全清理残留 effective*
      delete state.battlefields['p1']![1]!.roleCardId;
      role2.zone = 'GRAVEYARD';
      const winPlayer = state.timingWindow?.priorityPlayerId ?? state.activePlayerId;
      expect(engine.dispatchAction({ type: 'PASS_ACTION_TIMING', playerId: winPlayer }).success).toBe(true);
      expect(role2.effectivePP).toBeUndefined();
      expect(role2.effectiveDP).toBeUndefined();
      expect(role2.effectiveKeywords).toBeUndefined();
      expect(role2.effectiveTraits).toBeUndefined();
    });

    it('ZoneManager 保持牌组顶/底物理顺序，并在外部直接篡改 state.cards 时不返回过期缓存', () => {
      const engine = createEngine(expandDeck('ST01'), expandDeck('ST02'));
      const state = engine.getState();
      const handCard = engine.zoneMgr.getCardsInZone('p1', 'HAND')[0]!;
      const handCard2 = engine.zoneMgr.getCardsInZone('p1', 'HAND')[1]!;

      expect(engine.zoneMgr.moveCardToTopOfDeck(handCard.instanceId)).toBe(true);
      expect(engine.zoneMgr.getCardsInZone('p1', 'DECK')[0]!.instanceId).toBe(handCard.instanceId);

      expect(engine.zoneMgr.moveCardToBottomOfDeck(handCard2.instanceId)).toBe(true);
      const deckAfterBottom = engine.zoneMgr.getCardsInZone('p1', 'DECK');
      expect(deckAfterBottom[deckAfterBottom.length - 1]!.instanceId).toBe(handCard2.instanceId);

      // 模拟单测直接重排 state.cards 键序：在 dispatchAction 外不命中过期缓存
      const all = { ...state.cards };
      for (const k of Object.keys(state.cards)) delete state.cards[k];
      state.cards[handCard2.instanceId] = all[handCard2.instanceId]!;
      for (const [k, v] of Object.entries(all)) {
        if (k !== handCard2.instanceId) state.cards[k] = v;
      }
      expect(engine.zoneMgr.getCardsInZone('p1', 'DECK')[0]!.instanceId).toBe(handCard2.instanceId);
    });

    it('hasUsableInstant 在存在明费 BP03-054 且战场有<艺术协会>角色时不会误自动跳过瞬时窗', () => {
      const engine = createEngine(expandDeck('ST01', ['BP03-054', 'BP03-073']), expandDeck('ST02'));
      const state = engine.getState();
      const p1Attacker = placeRole(engine, 'p1', 'ST01-001', 0, { isReady: true });
      placeRole(engine, 'p1', 'BP03-073', 1, { isReady: true });
      const aylaCost = findCard(engine, 'p1', 'BP03-054');
      engine.zoneMgr.moveCard(aylaCost.instanceId, 'COST', { isFaceUp: true, isReady: true });
      // 先让 p1 攻击，p1 优先权窗口应保留（因为可发动 BP03-054）
      const atkRes = engine.dispatchAction({
        type: 'DECLARE_ATTACK',
        playerId: state.activePlayerId,
        attackerCardId: p1Attacker.instanceId,
        targetType: 'PLAYER',
      });
      expect(atkRes.success).toBe(true);
      expect(engine.getState().timingWindow?.priorityPlayerId).toBe('p1');
    });
  });

  describe('4. 满场（10 角色 + 12 球 + 16 费用卡）性能基准测试', () => {
    function setupFullBoardEngine(): GameEngine {
      const p1Deck = expandDeck('ST01', [
        'BP04-001',
        'BP04-028',
        'BP01-016',
        'BP01-077',
        'BP03-073',
        'BP04-032',
        'BP04-032',
        'BP01-020',
      ]);
      const p2Deck = expandDeck('ST02', [
        'BP04-016',
        'BP02-010',
        'BP01-015',
        'BP02-040',
        'BP03-079',
      ]);
      const engine = createEngine(p1Deck, p2Deck, 303030);

      // 1) 双方各铺 5 张战场角色（合计 10 角色），并附着装备与下方牌
      const p1RoleNums = ['BP04-001', 'BP04-028', 'BP01-016', 'BP01-077', 'BP03-073'];
      const p2RoleNums = ['BP04-016', 'BP02-010', 'BP01-015', 'BP02-040', 'BP03-079'];
      p1RoleNums.forEach((cn, idx) => placeRole(engine, 'p1', cn, idx, { isReady: true }));
      p2RoleNums.forEach((cn, idx) => placeRole(engine, 'p2', cn, idx, { isReady: true }));

      // 为 BP04-001 垫 3 张下方牌 + 1 张装备
      const luna = findCard(engine, 'p1', 'BP04-001');
      const eq = findCard(engine, 'p1', 'BP01-020');
      engine.zoneMgr.moveCard(eq.instanceId, 'HAND', { isFaceUp: true });
      expect(engine.fieldMgr.equipToRole('p1', eq.instanceId, luna.instanceId, { suppressEntryTrigger: true })).toBe(true);
      const underList = engine.zoneMgr.getCardsInZone('p1', 'DECK').slice(0, 3);
      for (const u of underList) {
        engine.zoneMgr.moveCard(u.instanceId, 'BATTLEFIELD', { isFaceUp: true, isReady: true });
      }
      luna.underneathCardIds = underList.map((u) => u.instanceId);

      // 2) 双方各铺 6 张正面信号球（合计 12 球）
      for (const pid of ['p1', 'p2']) {
        const deck = engine.zoneMgr.getCardsInZone(pid, 'DECK').slice(0, 6);
        for (const c of deck) {
          engine.zoneMgr.moveCard(c.instanceId, 'SIGNAL_ORB', { isFaceUp: true, isReady: true });
        }
      }

      // 3) 双方各铺 8 张费用卡（合计 16 费用卡，含明费与暗费）
      fillCostZone(engine, 'p1', 6);
      fillCostZone(engine, 'p2', 6);
      for (const pid of ['p1', 'p2']) {
        const extraHidden = engine.zoneMgr.getCardsInZone(pid, 'DECK').slice(0, 2);
        for (const c of extraHidden) {
          engine.zoneMgr.moveCard(c.instanceId, 'COST', { isFaceUp: false, isReady: true });
        }
        engine.zoneMgr.syncCostStats(pid);
      }

      return engine;
    }

    it('确定性算法不变量：满场单次 refreshDisplayedStats 不扫描费用/手牌/牌组，hasUsableInstant 零额外 evaluateCard', () => {
      const engine = setupFullBoardEngine();
      const state = engine.getState();
      const internal = engine as unknown as {
        refreshDisplayedStats: () => void;
        hasUsableInstant: (playerId: string) => boolean;
      };

      // 先执行一次确保 rescan 标记归零，再监控稳态单次调用的算法复杂度
      internal.refreshDisplayedStats();

      const evalSpy = vi.spyOn(engine.continuousEffects, 'evaluateCard');
      internal.refreshDisplayedStats();
      const calledZones = evalSpy.mock.calls.map(([id]) => state.cards[id]?.zone);
      expect(calledZones.length).toBeLessThanOrEqual(24);
      for (const z of calledZones) {
        expect(z === 'BATTLEFIELD' || z === 'SIGNAL_ORB').toBe(true);
      }

      evalSpy.mockClear();
      expect(internal.hasUsableInstant('p1')).toBe(false);
      // 白名单过滤非战术瞬时 + 仅判定战场槽位是否为《露娜·终焉》，最多触发 <= 5 次战场卡位 evaluateCard，绝不扫 100 卡
      expect(evalSpy.mock.calls.length).toBeLessThanOrEqual(5);
      for (const [id] of evalSpy.mock.calls) {
        expect(state.cards[id]?.zone).toBe('BATTLEFIELD');
      }
      evalSpy.mockRestore();
    });

    it('满场状态下 refreshDisplayedStats / hasUsableInstant / 典型行动与阶段推进性能基准', () => {
      const engine = setupFullBoardEngine();
      const internal = engine as unknown as {
        refreshDisplayedStats: () => void;
        hasUsableInstant: (playerId: string) => boolean;
      };

      const stepAction = (targetEngine: GameEngine): number => {
        const st = targetEngine.getState();
        if (st.status === 'FINISHED') return 0;
        if (st.currentPendingChoice) {
          const ch = st.currentPendingChoice;
          const eligible = ch.options.filter(
            (o) => (o.payload as { eligible?: boolean } | undefined)?.eligible !== false
          );
          const s0 = performance.now();
          targetEngine.dispatchAction({
            type: 'SELECT_CHOICE_OPTION',
            playerId: ch.playerId,
            pendingChoiceId: ch.id,
            selectedIds: eligible.slice(0, ch.minSelections).map((o) => o.id),
          });
          return performance.now() - s0;
        }
        if (st.timingWindow) {
          const s0 = performance.now();
          targetEngine.dispatchAction({
            type: 'PASS_ACTION_TIMING',
            playerId: st.timingWindow.priorityPlayerId,
          });
          return performance.now() - s0;
        }
        const s0 = performance.now();
        targetEngine.dispatchAction({ type: 'PASS_ACTION_TIMING', playerId: st.activePlayerId });
        return performance.now() - s0;
      };

      // 预热 JIT（含 1~2 次 dispatchAction 预热，降低冷加载与 V8 编译抖动）
      for (let i = 0; i < 10; i++) {
        internal.refreshDisplayedStats();
        internal.hasUsableInstant('p1');
      }
      const warmupEngine = setupFullBoardEngine();
      stepAction(warmupEngine);
      stepAction(warmupEngine);

      // 1) refreshDisplayedStats 基准 (50 次平均)
      const refreshRounds = 50;
      const t0 = performance.now();
      for (let i = 0; i < refreshRounds; i++) {
        internal.refreshDisplayedStats();
      }
      const refreshAvgMs = (performance.now() - t0) / refreshRounds;

      // 2) hasUsableInstant 基准 (50 次平均)
      const instantRounds = 50;
      const t1 = performance.now();
      for (let i = 0; i < instantRounds; i++) {
        internal.hasUsableInstant('p1');
      }
      const instantAvgMs = (performance.now() - t1) / instantRounds;

      // 3) 典型行动与阶段推进 (多次结束主要阶段并自动完成结束阶段→下回合竖直→抽牌)
      const state = engine.getState();
      const actionTimes: number[] = [];
      for (let step = 0; step < 6; step++) {
        if (state.status === 'FINISHED') break;
        actionTimes.push(stepAction(engine));
      }
      const actionAvgMs =
        actionTimes.reduce((sum, v) => sum + v, 0) / Math.max(1, actionTimes.length);

      console.log(
        `[Stage 3C 满场性能基准] refreshDisplayedStats=${refreshAvgMs.toFixed(3)}ms, ` +
          `hasUsableInstant=${instantAvgMs.toFixed(3)}ms, dispatchAction=${actionAvgMs.toFixed(3)}ms`
      );

      // 抗并发 CI 抖动的安全阈度
      expect(refreshAvgMs).toBeLessThan(10);
      expect(instantAvgMs).toBeLessThan(5);
      expect(actionAvgMs).toBeLessThan(50);
    });
  });
});

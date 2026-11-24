import { describe, it, expect } from 'vitest';
import { OFFICIAL_STARTER_DECKS } from '@zhanshuang/game-rules';
import {
  GameEngine,
  MemoryCardDatabase,
  OFFICIAL_CARDS_DATA,
  addCardModifier,
} from '../src/index.js';
import { enqueuePendingChoice } from '../src/state/pending-choice.js';
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

function createEngine(p1Deck: string[], p2Deck: string[], seed = 20261124): GameEngine {
  const engine = new GameEngine(
    'stage2b-test',
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
    card.turnEnteredZone = 0;
  }
  if (options?.isReady !== undefined) {
    card.isReady = options.isReady;
  }
  return card;
}

function putNonChargeAutoOnDeckTop(engine: GameEngine, playerId: string, count = 3) {
  const nonAuto = engine.zoneMgr
    .getCardsInZone(playerId, 'DECK')
    .filter((c) => !db.getCard(c.cardNumber)?.signalOrb && !db.getCard(c.cardNumber)?.rulesText.includes('充能自'))
    .slice(0, count);
  for (const c of nonAuto) {
    engine.zoneMgr.moveCardToTopOfDeck(c.instanceId);
  }
}

describe('Stage 2B 状态机安全、置换收口与【出】能力统一触发', () => {
  // =========================================================================
  // 1. CheckTiming SBA 安全
  // =========================================================================
  describe('1. CheckTimingManager SBA 安全防护 (8.5.1.a)', () => {
    it('SBA 死循环超过 MAX_SBA_ITERATIONS=100 时抛出熔断异常，而非静默吞错或无限循环', () => {
      const engine = createEngine(expandDeck('ST01'), expandDeck('ST02'));
      engine.sbaEngine.runCheckTimingSba = () => true;

      expect(() => engine.checkTimingMgr.resolveCheckTiming()).toThrow(
        '规则处理 (SBA) 超过安全循环上限 (8.5.1.a)'
      );
    });

    it('SBA 产生 PendingChoice (BP01-017 PP=0 离场置换) 时立即挂起，不抢跑执行同批待机自动能力', () => {
      const engine = createEngine(
        expandDeck('ST01'),
        expandDeck('ST02', ['BP01-017', 'BP01-020', 'BP01-021'])
      );
      const state = engine.getState();

      const alpha17 = placeRole(engine, 'p2', 'BP01-017', 0, { isReady: true });
      const small = findCard(engine, 'p2', 'BP01-020');
      const big = findCard(engine, 'p2', 'BP01-021');
      expect(engine.fieldMgr.equipToRole('p2', small.instanceId, alpha17.instanceId, { suppressEntryTrigger: true })).toBe(true);
      expect(engine.fieldMgr.equipToRole('p2', big.instanceId, alpha17.instanceId, { suppressEntryTrigger: true })).toBe(true);

      let queuedTriggerRan = false;
      engine.triggerMgr.registerTrigger({
        abilityId: 'TEST_AFTER_SBA_CHOICE',
        eventTypes: ['TURN_STARTED'],
        collect: () => [
          {
            sourceCardInstanceId: alpha17.instanceId,
            sourceCardNumber: alpha17.cardNumber,
            controllerPlayerId: state.activePlayerId,
            label: '测试延迟自动能力',
            triggerContext: {},
          },
        ],
        execute: () => {
          queuedTriggerRan = true;
        },
      });
      engine.triggerMgr.emit({ type: 'TURN_STARTED', playerId: state.activePlayerId });

      // 使 BP01-017 有效 PP <= 0，在检查时机触发 PP_ZERO SBA
      addCardModifier(state, alpha17, { pp: -10000, untilTurn: state.turnNumber, source: 'TEST_ZERO' });

      expect(engine.checkTimingMgr.resolveCheckTiming()).toBe(false);
      expect(state.currentPendingChoice?.effectType).toBe('BP01_017_OPTIONAL_LEAVE_REPLACEMENT');
      // SBA 决策未完成前，待机中的自动能力绝不能抢跑执行
      expect(queuedTriggerRan).toBe(false);

      // 选择送双刀入墓留场（移除 PP_ZERO 状态修饰符使其恢复正 PP，防止继续触发 PP_ZERO）
      alpha17.modifiers = undefined;
      const pickRes = engine.dispatchAction({
        type: 'SELECT_CHOICE_OPTION',
        playerId: 'p2',
        pendingChoiceId: state.currentPendingChoice!.id,
        selectedIds: ['replace'],
      });
      expect(pickRes.success, pickRes.error).toBe(true);
      expect(state.cards[alpha17.instanceId]!.zone).toBe('BATTLEFIELD');
      expect(state.cards[small.instanceId]!.zone).toBe('GRAVEYARD');
      expect(state.cards[big.instanceId]!.zone).toBe('GRAVEYARD');
      expect(queuedTriggerRan).toBe(true);
      expect(state.currentPendingChoice).toBeUndefined();
    });
  });

  // =========================================================================
  // 2. PhaseMachine 阶段可挂起与 TURN_STARTED 时点
  // =========================================================================
  describe('2. PhaseMachine 可挂起推进、TURN_STARTED 时点与结束清理挂起', () => {
    it('TURN_STARTED 在 6.2.1.b 竖直前触发；挂起并从快照恢复后，继续完成竖直与抽牌阶段', () => {
      const engine = createEngine(expandDeck('ST01'), expandDeck('ST02'));
      const state = engine.getState();
      const active = state.activePlayerId;
      const opp = state.nonActivePlayerId;

      const oppRole = placeRole(engine, opp, opp === 'p2' ? 'ST02-001' : 'ST01-005', 0, { isReady: false });
      const drawDeckSizeBefore = engine.zoneMgr.getCardsInZone(opp, 'DECK').length;
      let observedIsReadyOnTurnStarted: boolean | undefined;

      engine.triggerMgr.registerTrigger({
        abilityId: 'TEST_STAND_START_CHOICE',
        eventTypes: ['TURN_STARTED'],
        collect: ({ event }) =>
          event.playerId === opp
            ? [
                {
                  sourceCardInstanceId: oppRole.instanceId,
                  sourceCardNumber: oppRole.cardNumber,
                  controllerPlayerId: opp,
                  label: '回合开始时挂起测试',
                  triggerContext: {},
                },
              ]
            : [],
        execute: () => {
          observedIsReadyOnTurnStarted = state.cards[oppRole.instanceId]!.isReady;
          enqueuePendingChoice(state, {
            id: `choice-stand-pause-${state.turnNumber}`,
            playerId: opp,
            choiceType: 'SELECT_OPTION',
            prompt: '回合开始时检查时机挂起：是否确认继续？',
            options: [
              { id: 'opt_yes', label: '确认抽1' },
              { id: 'opt_no', label: '确认不抽' },
            ],
            effectType: 'DSL_TEST_STAND_PAUSE',
            sourceCardInstanceId: oppRole.instanceId,
            minSelections: 1,
            maxSelections: 1,
            metadata: {
              __dsl: {
                cardNumber: oppRole.cardNumber,
                sourceCardInstanceId: oppRole.instanceId,
                playerId: opp,
                vars: {},
                remainingSteps: [],
                pendingAction: {
                  kind: 'CONFIRM_YES_NO',
                  onYes: [{ op: 'DRAW', count: 1 }],
                },
              },
            },
          });
        },
      });

      // active 结束回合，进入 opp 的 STAND_PHASE，在 START_TRIGGERS 检查时机停下
      expect(engine.dispatchAction({ type: 'PASS_ACTION_TIMING', playerId: active }).success).toBe(true);
      passInstantWindows(engine);

      expect(observedIsReadyOnTurnStarted).toBe(false);
      expect(state.phase).toBe('STAND_PHASE');
      expect(state.standPhaseStep).toBe('START_TRIGGERS');
      expect(state.cards[oppRole.instanceId]!.isReady).toBe(false);
      expect(state.currentPendingChoice?.effectType).toBe('DSL_TEST_STAND_PAUSE');

      // 导出快照并恢复至全新引擎实例，提交决策后应完成竖直并自动抽 2 张进入 DRAW_CHARGE_PHASE
      const snapshot = engine.toSnapshot();
      const restored = GameEngine.fromSnapshot(snapshot);
      const rState = restored.getState();
      const res = restored.dispatchAction({
        type: 'SELECT_CHOICE_OPTION',
        playerId: opp,
        pendingChoiceId: rState.currentPendingChoice!.id,
        selectedIds: ['opt_no'],
      });
      expect(res.success, res.error).toBe(true);
      expect(rState.cards[oppRole.instanceId]!.isReady).toBe(true);
      expect(rState.phase).toBe('DRAW_CHARGE_PHASE');
      expect(rState.drawChargePhaseStep).toBe('AWAIT_CHARGE');
      expect(restored.zoneMgr.getCardsInZone(opp, 'DECK').length).toBe(drawDeckSizeBefore - 2);
    });

    it('牌库与墓地耗尽进入 FINISHED 时立即停机，不再推进充能与主要阶段', () => {
      const engine = createEngine(expandDeck('ST01'), expandDeck('ST02'));
      const state = engine.getState();
      const active = state.activePlayerId;
      const opp = state.nonActivePlayerId;

      for (const c of engine.zoneMgr.getCardsInZone(opp, 'DECK').slice(1)) {
        engine.zoneMgr.moveCard(c.instanceId, 'HAND', { isFaceUp: false });
      }
      for (const c of engine.zoneMgr.getCardsInZone(opp, 'GRAVEYARD')) {
        engine.zoneMgr.moveCard(c.instanceId, 'HAND', { isFaceUp: false });
      }
      expect(engine.zoneMgr.getCardsInZone(opp, 'DECK')).toHaveLength(1);
      expect(engine.zoneMgr.getCardsInZone(opp, 'GRAVEYARD')).toHaveLength(0);

      expect(engine.dispatchAction({ type: 'PASS_ACTION_TIMING', playerId: active }).success).toBe(true);
      while (state.timingWindow && state.status !== 'FINISHED') {
        engine.dispatchAction({ type: 'PASS_ACTION_TIMING', playerId: state.timingWindow.priorityPlayerId });
      }

      expect(state.status).toBe('FINISHED');
      expect(state.winnerId).toBe(active);
      expect(state.phase).toBe('DRAW_CHARGE_PHASE');
      expect(engine.dispatchAction({ type: 'PASS_ACTION_TIMING', playerId: opp }).success).toBe(false);
    });

    it('结束阶段 CLEANUP/CLEANUP_POST 触发带 PendingChoice 的事件时暂停交棒，决策完成后才切换回合', () => {
      const engine = createEngine(expandDeck('ST01'), expandDeck('ST02'));
      const state = engine.getState();
      const active = state.activePlayerId;
      const opp = state.nonActivePlayerId;

      // 在 active 场上放置主将并绑定一个协战搭档，CLEANUP 解除搭档时发射 PARTNER_RELEASED / CARD_LEFT_FIELD
      const role = placeRole(engine, active, active === 'p1' ? 'ST01-005' : 'ST02-004', 0);
      const partner = findCard(engine, active, active === 'p1' ? 'ST01-012' : 'ST02-012');
      engine.zoneMgr.moveCard(partner.instanceId, 'BATTLEFIELD', { isFaceUp: true, isReady: true });
      partner.partnerOfCardId = role.instanceId;
      role.partnerCardId = partner.instanceId;

      engine.triggerMgr.registerTrigger({
        abilityId: 'TEST_CLEANUP_POST_PAUSE',
        eventTypes: ['PARTNER_RELEASED'],
        collect: ({ event }) =>
          event.targetCardId === partner.instanceId && state.phase === 'END_PHASE'
            ? [
                {
                  sourceCardInstanceId: role.instanceId,
                  sourceCardNumber: role.cardNumber,
                  controllerPlayerId: active,
                  label: '结束清理期挂起测试',
                  triggerContext: {},
                },
              ]
            : [],
        execute: () => {
          enqueuePendingChoice(state, {
            id: `choice-cleanup-post-${state.turnNumber}`,
            playerId: active,
            choiceType: 'SELECT_OPTION',
            prompt: '结束清理期间自动能力挂起：',
            options: [{ id: 'opt_no', label: '确认交棒' }],
            effectType: 'DSL_TEST_CLEANUP_POST',
            sourceCardInstanceId: role.instanceId,
            minSelections: 1,
            maxSelections: 1,
            metadata: {
              __dsl: {
                cardNumber: role.cardNumber,
                sourceCardInstanceId: role.instanceId,
                playerId: active,
                vars: {},
                remainingSteps: [],
                pendingAction: { kind: 'CONFIRM_YES_NO' },
              },
            },
          });
        },
      });

      expect(engine.dispatchAction({ type: 'PASS_ACTION_TIMING', playerId: active }).success).toBe(true);
      passInstantWindows(engine);

      expect(state.phase).toBe('END_PHASE');
      expect(state.endPhaseStep).toBe('CLEANUP_POST');
      expect(state.activePlayerId).toBe(active);
      expect(state.turnNumber).toBe(1);
      expect(state.currentPendingChoice?.effectType).toBe('DSL_TEST_CLEANUP_POST');

      const res = engine.dispatchAction({
        type: 'SELECT_CHOICE_OPTION',
        playerId: active,
        pendingChoiceId: state.currentPendingChoice!.id,
        selectedIds: ['opt_no'],
      });
      expect(res.success, res.error).toBe(true);
      expect(state.activePlayerId).toBe(opp);
      expect(state.turnNumber).toBe(2);
      expect(state.phase).toBe('DRAW_CHARGE_PHASE');
    });
  });

  // =========================================================================
  // 3. CombatManager endCombat() 与 ATTACK_ENDED 时序
  // =========================================================================
  describe('3. CombatManager endCombat() 与战斗破坏置换协同', () => {
    it('ATTACK_ENDED 触发与 PendingChoice 结算期间保持 currentCombat 与 combat-* 修饰符完整，结算完毕再清空', () => {
      const engine = createEngine(expandDeck('ST01'), expandDeck('ST02'));
      const state = engine.getState();
      const active = state.activePlayerId;
      const opp = state.nonActivePlayerId;

      const attacker = placeRole(engine, active, active === 'p1' ? 'ST01-001' : 'ST02-001', 0);
      addCardModifier(state, attacker, {
        id: 'combat-test-buff',
        pp: 1000,
        untilTurn: state.turnNumber,
        source: 'combat-test-buff',
      });

      // 防止攻击方充能与被攻击方受伤翻出【充能自】干扰本用例
      putNonChargeAutoOnDeckTop(engine, active, 3);
      putNonChargeAutoOnDeckTop(engine, opp, 3);

      let sawCombatIntactDuringAttackEnd = false;
      let sawCombatModDuringAttackEnd = false;
      engine.triggerMgr.registerTrigger({
        abilityId: 'TEST_ATTACK_ENDED_ORDER',
        eventTypes: ['ATTACK_ENDED'],
        collect: () => [
          {
            sourceCardInstanceId: attacker.instanceId,
            sourceCardNumber: attacker.cardNumber,
            controllerPlayerId: active,
            label: '攻击结束检查',
            triggerContext: {},
          },
        ],
        execute: () => {
          sawCombatIntactDuringAttackEnd = Boolean(state.currentCombat);
          sawCombatModDuringAttackEnd = Boolean(attacker.modifiers?.some((m) => m.id?.startsWith('combat-')));
          enqueuePendingChoice(state, {
            id: `choice-attack-end-${state.turnNumber}`,
            playerId: active,
            choiceType: 'SELECT_OPTION',
            prompt: '攻击结束时点确认：',
            options: [{ id: 'opt_no', label: '结束攻击' }],
            effectType: 'DSL_TEST_ATTACK_ENDED',
            sourceCardInstanceId: attacker.instanceId,
            minSelections: 1,
            maxSelections: 1,
            metadata: {
              __dsl: {
                cardNumber: attacker.cardNumber,
                sourceCardInstanceId: attacker.instanceId,
                playerId: active,
                vars: {},
                remainingSteps: [],
                pendingAction: { kind: 'CONFIRM_YES_NO' },
              },
            },
          });
        },
      });

      expect(
        engine.dispatchAction({
          type: 'DECLARE_ATTACK',
          playerId: active,
          attackerCardId: attacker.instanceId,
          targetType: 'PLAYER',
        }).success
      ).toBe(true);
      passInstantWindows(engine);

      expect(sawCombatIntactDuringAttackEnd).toBe(true);
      expect(sawCombatModDuringAttackEnd).toBe(true);
      expect(state.currentCombat).toBeDefined();
      expect(attacker.modifiers?.some((m) => m.id === 'combat-test-buff')).toBe(true);
      expect(state.currentPendingChoice?.effectType).toBe('DSL_TEST_ATTACK_ENDED');

      const done = engine.dispatchAction({
        type: 'SELECT_CHOICE_OPTION',
        playerId: active,
        pendingChoiceId: state.currentPendingChoice!.id,
        selectedIds: ['opt_no'],
      });
      expect(done.success, done.error).toBe(true);
      expect(state.currentCombat).toBeUndefined();
      expect(attacker.modifiers?.some((m) => m.id?.startsWith('combat-'))).toBeFalsy();
      expect(state.phase).toBe('MAIN_PHASE');
    });

    it('战斗破坏被 MOVE_CARD 置换阻止（保留战场）时，不发射 CARD_DESTROYED 也不造成【贯通】伤害', () => {
      const engine = createEngine(expandDeck('ST01'), expandDeck('ST02'));
      const state = engine.getState();
      const active = state.activePlayerId;
      const opp = state.nonActivePlayerId;

      putNonChargeAutoOnDeckTop(engine, active, 3);
      putNonChargeAutoOnDeckTop(engine, opp, 3);

      const attacker = placeRole(engine, active, active === 'p1' ? 'ST01-001' : 'ST02-001', 0);
      addCardModifier(state, attacker, { pp: 6000, keywords: ['贯通'], untilTurn: state.turnNumber, source: 'TEST' });
      const defender = placeRole(engine, opp, opp === 'p2' ? 'ST02-004' : 'ST01-005', 0, { isReady: false });

      state.activeReplacements = [
        {
          id: 'test-prevent-leave-gy',
          controllerPlayerId: opp,
          source: '防离场测试',
          eventType: 'MOVE_CARD',
          targetCardInstanceId: defender.instanceId,
          fromZone: 'BATTLEFIELD',
          toZone: 'GRAVEYARD',
          action: { kind: 'PREVENT' },
          once: true,
        },
      ];

      let destroyedTriggered = false;
      engine.triggerMgr.registerTrigger({
        abilityId: 'TEST_WATCH_DESTROYED',
        eventTypes: ['CARD_DESTROYED'],
        collect: ({ event }) => {
          if (event.cardInstanceId === defender.instanceId) destroyedTriggered = true;
          return [];
        },
        execute: () => {},
      });

      const eventsBefore = engine.events.length;
      const oppErosionBefore = state.players[opp]!.erosionCount;
      expect(
        engine.dispatchAction({
          type: 'DECLARE_ATTACK',
          playerId: active,
          attackerCardId: attacker.instanceId,
          targetType: 'CHARACTER',
          targetCardId: defender.instanceId,
        }).success
      ).toBe(true);
      passInstantWindows(engine);

      expect(state.cards[defender.instanceId]!.zone).toBe('BATTLEFIELD');
      expect(destroyedTriggered).toBe(false);
      expect(
        engine.events.slice(eventsBefore).some((e) => e.type === 'CARD_DESTROYED' && e.cardInstanceId === defender.instanceId)
      ).toBe(false);
      expect(state.players[opp]!.erosionCount).toBe(oppErosionBefore);
    });
  });

  // =========================================================================
  // 4. ReplacementEngine 8.10.2 多置换排序、MODIFY_DAMAGE 与 3.6.4 二次置换链
  // =========================================================================
  describe('4. ReplacementEngine 8.10.2 多置换排序、MODIFY_DAMAGE、3.6.4 链与防偷跑', () => {
    it('DEAL_DAMAGE 多置换顺序敏感 + 快照恢复：先 maxAmount(2) 再 delta(-1) = 1 伤；先 delta(-1) 再 maxAmount(2) = 2 伤', () => {
      const engine = createEngine(expandDeck('ST01'), expandDeck('ST02'));
      const state = engine.getState();

      putNonChargeAutoOnDeckTop(engine, 'p2', 3);

      state.activeReplacements = [
        {
          id: 'repl-delta-minus-1',
          controllerPlayerId: 'p2',
          source: '减伤1',
          label: '受到伤害 -1',
          eventType: 'DEAL_DAMAGE',
          action: { kind: 'MODIFY_DAMAGE', delta: -1 },
          once: true,
        },
        {
          id: 'repl-cap-max-2',
          controllerPlayerId: 'p2',
          source: '上限2',
          label: '受到伤害上限改为 2',
          eventType: 'DEAL_DAMAGE',
          action: { kind: 'MODIFY_DAMAGE', maxAmount: 2 },
          once: true,
        },
      ];

      const erosionBefore = state.players.p2!.erosionCount;
      engine.zoneMgr.applyDamageToPlayer('p2', 3, undefined);

      expect(state.currentPendingChoice?.effectType).toBe('CHOOSE_REPLACEMENT_ORDER');
      expect(state.currentPendingChoice?.playerId).toBe('p2');
      expect(state.currentPendingChoice?.options).toHaveLength(2);

      const snapshotAtChoice = engine.toSnapshot();

      // 分支 A：先适用「上限改为 2」(3 -> 2)，再适用「-1」(2 -> 1)
      const resA = engine.dispatchAction({
        type: 'SELECT_CHOICE_OPTION',
        playerId: 'p2',
        pendingChoiceId: state.currentPendingChoice!.id,
        selectedIds: ['repl-cap-max-2'],
      });
      expect(resA.success, resA.error).toBe(true);
      expect(state.players.p2!.erosionCount).toBe(erosionBefore + 1);
      expect(state.activeReplacements).toBeUndefined();

      // 分支 B（从同一快照恢复）：先适用「-1」(3 -> 2)，再适用「上限改为 2」(min(2,2) -> 2)
      const engineB = GameEngine.fromSnapshot(snapshotAtChoice);
      const stateB = engineB.getState();
      const resB = engineB.dispatchAction({
        type: 'SELECT_CHOICE_OPTION',
        playerId: 'p2',
        pendingChoiceId: stateB.currentPendingChoice!.id,
        selectedIds: ['repl-delta-minus-1'],
      });
      expect(resB.success, resB.error).toBe(true);
      expect(stateB.players.p2!.erosionCount).toBe(erosionBefore + 2);
      expect(stateB.activeReplacements).toBeUndefined();
    });

    it('MOVE_CARD 与 DESTROY_ROLE 同时存在多个置换效果时弹出 CHOOSE_REPLACEMENT_ORDER 且遵守单事件防循环 (8.10.2.c)', () => {
      const engine = createEngine(expandDeck('ST01'), expandDeck('ST02'));
      const state = engine.getState();

      const role = placeRole(engine, 'p2', 'ST02-004', 0);

      state.activeReplacements = [
        {
          id: 'repl-destroy-hand',
          controllerPlayerId: 'p2',
          label: '破坏改为回手',
          eventType: 'DESTROY_ROLE',
          targetCardInstanceId: role.instanceId,
          action: { kind: 'REDIRECT_ZONE', zone: 'HAND', isFaceUp: true },
          once: true,
        },
        {
          id: 'repl-destroy-deck-bottom',
          controllerPlayerId: 'p2',
          label: '破坏改为置底',
          eventType: 'DESTROY_ROLE',
          targetCardInstanceId: role.instanceId,
          action: { kind: 'REDIRECT_ZONE', zone: 'DECK', toBottom: true, isFaceUp: false },
          once: true,
        },
      ];

      addCardModifier(state, role, { pp: -9999, untilTurn: state.turnNumber, source: 'TEST_KILL' });
      expect(engine.checkTimingMgr.resolveCheckTiming()).toBe(false);
      expect(state.currentPendingChoice?.effectType).toBe('CHOOSE_REPLACEMENT_ORDER');
      expect(state.currentPendingChoice?.options).toHaveLength(2);

      role.modifiers = undefined;
      expect(
        engine.dispatchAction({
          type: 'SELECT_CHOICE_OPTION',
          playerId: 'p2',
          pendingChoiceId: state.currentPendingChoice!.id,
          selectedIds: ['repl-destroy-deck-bottom'],
        }).success
      ).toBe(true);
      expect(state.cards[role.instanceId]!.zone).toBe('DECK');

      // 重新上场测试 MOVE_CARD 多置换 + 8.10.2.c 单事件防循环
      engine.zoneMgr.moveCard(role.instanceId, 'HAND', { isFaceUp: true });
      expect(engine.fieldMgr.playRoleCard('p2', role.instanceId, 0, { suppressEntryTrigger: true })).toBe(true);

      state.activeReplacements = [
        {
          id: 'repl-move-gy-to-hand',
          controllerPlayerId: 'p2',
          label: '入墓改为回手',
          eventType: 'MOVE_CARD',
          targetCardInstanceId: role.instanceId,
          toZone: 'GRAVEYARD',
          action: { kind: 'REDIRECT_ZONE', zone: 'HAND', isFaceUp: true },
          once: true,
        },
        {
          id: 'repl-move-gy-prevent',
          controllerPlayerId: 'p2',
          label: '入墓改为留场',
          eventType: 'MOVE_CARD',
          targetCardInstanceId: role.instanceId,
          toZone: 'GRAVEYARD',
          action: { kind: 'PREVENT' },
          once: true,
        },
      ];
      engine.replacementEngine.registerRule({
        id: 'test-hand-back-to-gy',
        label: '回手改为置墓',
        eventTypes: ['MOVE_CARD'],
        matches: (ev) => ev.type === 'MOVE_CARD' && ev.cardInstanceId === role.instanceId && ev.toZone === 'HAND',
        apply: () => ({ kind: 'REDIRECT_ZONE', zone: 'GRAVEYARD', isFaceUp: true }),
      });

      const moved = engine.zoneMgr.moveCard(role.instanceId, 'GRAVEYARD', { isFaceUp: true });
      expect(moved).toBe(false);
      expect(state.currentPendingChoice?.effectType).toBe('CHOOSE_REPLACEMENT_ORDER');
      expect(
        engine.dispatchAction({
          type: 'SELECT_CHOICE_OPTION',
          playerId: 'p2',
          pendingChoiceId: state.currentPendingChoice!.id,
          selectedIds: ['repl-move-gy-to-hand'],
        }).success
      ).toBe(true);
      // GRAVEYARD -> HAND (repl-move-gy-to-hand) -> GRAVEYARD (test-hand-back-to-gy) -> PREVENT (repl-move-gy-prevent) -> 留场
      expect(state.cards[role.instanceId]!.zone).toBe('BATTLEFIELD');
    });

    it('3.6.4 费用区满 10 张改放墓地时可继续触发针对 GRAVEYARD 的二次置换链', () => {
      const engine = createEngine(expandDeck('ST01'), expandDeck('ST02'));
      const state = engine.getState();

      fillCostZone(engine, 'p1', 10);
      expect(engine.zoneMgr.getCardsInZone('p1', 'COST')).toHaveLength(10);

      const candidate = findCard(engine, 'p1', 'ST01-012');
      engine.zoneMgr.moveCard(candidate.instanceId, 'HAND', { isFaceUp: true });

      state.activeReplacements = [
        {
          id: 'repl-gy-to-deck-bottom',
          controllerPlayerId: 'p1',
          label: '入墓改为放回牌组底',
          eventType: 'MOVE_CARD',
          targetCardInstanceId: candidate.instanceId,
          toZone: 'GRAVEYARD',
          action: { kind: 'REDIRECT_ZONE', zone: 'DECK', toBottom: true, isFaceUp: false },
          once: true,
        },
      ];

      expect(engine.zoneMgr.moveCard(candidate.instanceId, 'COST', { isFaceUp: true })).toBe(true);
      const deckCards = engine.zoneMgr.getCardsInZone('p1', 'DECK');
      expect(state.cards[candidate.instanceId]!.zone).toBe('DECK');
      expect(deckCards[deckCards.length - 1]!.instanceId).toBe(candidate.instanceId);
    });

    it('BP01-017 装备双刀时拦截 placeCardUnderneath 与回手（不提前送刀入墓），选留场保本体、选离开按原去向执行', () => {
      const engine = createEngine(
        expandDeck('ST01', ['BP01-017', 'BP01-020', 'BP01-021']),
        expandDeck('ST02')
      );
      const state = engine.getState();

      const alpha17 = placeRole(engine, 'p1', 'BP01-017', 0);
      const host = placeRole(engine, 'p1', 'ST01-005', 1);
      const small = findCard(engine, 'p1', 'BP01-020');
      const big = findCard(engine, 'p1', 'BP01-021');
      expect(engine.fieldMgr.equipToRole('p1', small.instanceId, alpha17.instanceId, { suppressEntryTrigger: true })).toBe(true);
      expect(engine.fieldMgr.equipToRole('p1', big.instanceId, alpha17.instanceId, { suppressEntryTrigger: true })).toBe(true);

      expect(engine.fieldMgr.placeCardUnderneath(alpha17.instanceId, host.instanceId)).toBe(false);
      expect(state.currentPendingChoice?.effectType).toBe('BP01_017_OPTIONAL_LEAVE_REPLACEMENT');
      expect(state.cards[small.instanceId]!.zone).toBe('BATTLEFIELD');
      expect(state.cards[big.instanceId]!.zone).toBe('BATTLEFIELD');

      expect(
        engine.dispatchAction({
          type: 'SELECT_CHOICE_OPTION',
          playerId: 'p1',
          pendingChoiceId: state.currentPendingChoice!.id,
          selectedIds: ['replace'],
        }).success
      ).toBe(true);
      expect(state.cards[alpha17.instanceId]!.zone).toBe('BATTLEFIELD');
      expect(state.cards[small.instanceId]!.zone).toBe('GRAVEYARD');
      expect(state.cards[big.instanceId]!.zone).toBe('GRAVEYARD');
      expect(host.underneathCardIds).not.toContain(alpha17.instanceId);

      // 重新装配双刀后再次置入下方，这次选 'leave'
      expect(engine.fieldMgr.equipToRole('p1', small.instanceId, alpha17.instanceId, { suppressEntryTrigger: true })).toBe(true);
      expect(engine.fieldMgr.equipToRole('p1', big.instanceId, alpha17.instanceId, { suppressEntryTrigger: true })).toBe(true);
      expect(engine.fieldMgr.placeCardUnderneath(alpha17.instanceId, host.instanceId)).toBe(false);
      expect(state.currentPendingChoice?.effectType).toBe('BP01_017_OPTIONAL_LEAVE_REPLACEMENT');
      expect(
        engine.dispatchAction({
          type: 'SELECT_CHOICE_OPTION',
          playerId: 'p1',
          pendingChoiceId: state.currentPendingChoice!.id,
          selectedIds: ['leave'],
        }).success
      ).toBe(true);
      expect(host.underneathCardIds).toContain(alpha17.instanceId);
      expect(state.cards[small.instanceId]!.zone).toBe('GRAVEYARD');
      expect(state.cards[big.instanceId]!.zone).toBe('GRAVEYARD');
    });

    it('MOVE_CARDS 被置换阻止时，后续依赖 saveMovedToVar 的「若如此做」分支（如 BP01-027）不得生效', () => {
      const engine = createEngine(
        expandDeck('ST01', ['BP01-020', 'BP01-020', 'BP01-027']),
        expandDeck('ST02', ['BP01-020', 'BP01-020', 'BP01-027'])
      );
      const state = engine.getState();
      const active = state.activePlayerId;
      const opp = state.nonActivePlayerId;

      putNonChargeAutoOnDeckTop(engine, active, 3);
      putNonChargeAutoOnDeckTop(engine, opp, 3);

      const attacker = placeRole(engine, active, active === 'p1' ? 'ST01-001' : 'ST02-001', 0);
      const defRole = placeRole(engine, opp, opp === 'p2' ? 'ST02-004' : 'ST01-005', 0);
      const defEquip = findCard(engine, opp, 'BP01-020', 0);
      const costFire = findCard(engine, opp, 'BP01-020', 1);
      expect(defEquip.instanceId).not.toBe(costFire.instanceId);
      expect(engine.fieldMgr.equipToRole(opp, defEquip.instanceId, defRole.instanceId, { suppressEntryTrigger: true })).toBe(true);

      const rain = findCard(engine, opp, 'BP01-027');
      engine.zoneMgr.moveCard(rain.instanceId, 'HAND', { isFaceUp: true });
      engine.zoneMgr.moveCard(costFire.instanceId, 'COST', { isFaceUp: true, isReady: true });
      fillCostZone(engine, opp, 4);

      state.activeReplacements = [
        {
          id: 'repl-block-equip-gy',
          controllerPlayerId: opp,
          label: '装备防止送墓',
          eventType: 'MOVE_CARD',
          targetCardInstanceId: defEquip.instanceId,
          fromZone: 'BATTLEFIELD',
          toZone: 'GRAVEYARD',
          action: { kind: 'PREVENT' },
          once: true,
        },
      ];

      const oppErosionBefore = state.players[opp]!.erosionCount;
      expect(
        engine.dispatchAction({
          type: 'DECLARE_ATTACK',
          playerId: active,
          attackerCardId: attacker.instanceId,
          targetType: 'PLAYER',
        }).success
      ).toBe(true);
      if (state.timingWindow?.priorityPlayerId === active) {
        expect(engine.dispatchAction({ type: 'PASS_ACTION_TIMING', playerId: active }).success).toBe(true);
      }

      // opp 使用 BP01-027 并选择 defEquip，但其入墓被置换 PREVENT -> sent 为空 -> 不能防止本次战斗伤害
      const useRain = engine.dispatchAction({ type: 'USE_INSTANT', playerId: opp, cardInstanceId: rain.instanceId });
      expect(useRain.success, useRain.error).toBe(true);
      expect(state.currentPendingChoice).toBeDefined();
      expect(
        engine.dispatchAction({
          type: 'SELECT_CHOICE_OPTION',
          playerId: opp,
          pendingChoiceId: state.currentPendingChoice!.id,
          selectedIds: [defEquip.instanceId],
        }).success
      ).toBe(true);
      expect(state.cards[defEquip.instanceId]!.zone).toBe('BATTLEFIELD');
      expect(state.currentCombat?.cannotDealDamage).toBeFalsy();

      passInstantWindows(engine);
      if (state.currentCombat?.step === 'BLOCK') {
        expect(
          engine.dispatchAction({ type: 'DECLARE_BLOCK', playerId: opp, blockerCardId: undefined }).success
        ).toBe(true);
      }
      expect(state.players[opp]!.erosionCount).toBe(oppErosionBefore + 1);
    });
  });

  // =========================================================================
  // 5. 【出】能力统一迁入 TriggerManager (CARD_ENTERED_FIELD)
  // =========================================================================
  describe('5. 【出】能力统一迁入 TriggerManager (CARD_ENTERED_FIELD)', () => {
    it('消除子角色抢跑：ST01-001 拉出 ST01-005 时，先完成剩余 4 张牌置底再结算 ST01-005 【出】', () => {
      const engine = createEngine(
        expandDeck('ST01', ['ST01-001', 'ST01-005']),
        expandDeck('ST02')
      );
      const state = engine.getState();

      fillCostZone(engine, 'p1', 8);
      const st01001 = findCard(engine, 'p1', 'ST01-001');
      const st01005 = findCard(engine, 'p1', 'ST01-005');
      const handFiller = findCard(engine, 'p1', 'ST01-012');
      engine.zoneMgr.moveCard(st01001.instanceId, 'HAND', { isFaceUp: true });
      engine.zoneMgr.moveCard(handFiller.instanceId, 'HAND', { isFaceUp: true });
      engine.zoneMgr.moveCardToTopOfDeck(st01005.instanceId);

      const deckBeforeIds = engine.zoneMgr.getCardsInZone('p1', 'DECK').map((c) => c.instanceId);
      expect(deckBeforeIds[0]).toBe(st01005.instanceId);
      const expectedBottom4 = deckBeforeIds.slice(1, 5);

      expect(
        engine.dispatchAction({
          type: 'PLAY_CARD',
          playerId: 'p1',
          cardInstanceId: st01001.instanceId,
          targetSlotIndex: 0,
        }).success
      ).toBe(true);

      // 支付 ST01-001 【出】丢弃 1 张手牌
      expect(state.currentPendingChoice?.effectType).toBe('PRESET_DISCARD_COST');
      expect(
        engine.dispatchAction({
          type: 'SELECT_CHOICE_OPTION',
          playerId: 'p1',
          pendingChoiceId: state.currentPendingChoice!.id,
          selectedIds: [handFiller.instanceId],
        }).success
      ).toBe(true);

      // 选择 ST01-005 (cost 3 <= 3) 出场
      expect(state.currentPendingChoice?.effectType).toBe('PRESET_ST01_001_PICK');
      expect(
        engine.dispatchAction({
          type: 'SELECT_CHOICE_OPTION',
          playerId: 'p1',
          pendingChoiceId: state.currentPendingChoice!.id,
          selectedIds: [st01005.instanceId],
        }).success
      ).toBe(true);

      // ST01-005 已进入战场且进入其【出】丢牌决策，但在此之前剩余 4 张牌必须已经被置入牌组底！
      expect(state.cards[st01005.instanceId]!.zone).toBe('BATTLEFIELD');
      expect(state.currentPendingChoice).toBeDefined();
      expect(state.currentPendingChoice!.prompt).toContain('露西亚');
      const deckBottom4Now = engine.zoneMgr.getCardsInZone('p1', 'DECK').slice(-4).map((c) => c.instanceId);
      expect(new Set(deckBottom4Now)).toEqual(new Set(expectedBottom4));
    });

    it('BP01-058 双【出】自由排序：可先结算【出1】从墓地凑齐第 2 张《梦赴光寥之乡》，再结算【出2】将对方<=3费角色置底', () => {
      const engine = createEngine(
        expandDeck('ST01', ['BP01-058', 'BP01-056', 'BP01-056', 'ST01-012', 'ST01-013']),
        expandDeck('ST02')
      );
      const state = engine.getState();

      const oppTarget = placeRole(engine, 'p2', 'ST02-004', 0);
      const selena58 = findCard(engine, 'p1', 'BP01-058');
      const dream1 = findCard(engine, 'p1', 'BP01-056', 0);
      const dream2 = findCard(engine, 'p1', 'BP01-056', 1);
      const filler1 = findCard(engine, 'p1', 'ST01-012');
      const filler2 = findCard(engine, 'p1', 'ST01-013');

      engine.zoneMgr.moveCard(selena58.instanceId, 'HAND', { isFaceUp: true });
      engine.zoneMgr.moveCard(dream1.instanceId, 'HAND', { isFaceUp: true });
      engine.zoneMgr.moveCard(dream2.instanceId, 'GRAVEYARD', { isFaceUp: true });
      engine.zoneMgr.moveCard(filler1.instanceId, 'HAND', { isFaceUp: true });
      engine.zoneMgr.moveCard(filler2.instanceId, 'HAND', { isFaceUp: true });
      fillCostZone(engine, 'p1', 8);

      expect(
        engine.dispatchAction({
          type: 'PLAY_CARD',
          playerId: 'p1',
          cardInstanceId: selena58.instanceId,
          targetSlotIndex: 0,
        }).success
      ).toBe(true);

      // 1) 两条独立【出】进入待机：先选择【出1】回收墓地 dream2
      expect(state.currentPendingChoice?.effectType).toBe('CHOOSE_TRIGGER_ORDER');
      const opt1 = state.currentPendingChoice!.options.find((o) => o.label.includes('丢弃 2 张手牌'))!;
      expect(
        engine.dispatchAction({
          type: 'SELECT_CHOICE_OPTION',
          playerId: 'p1',
          pendingChoiceId: state.currentPendingChoice!.id,
          selectedIds: [opt1.id],
        }).success
      ).toBe(true);

      // 弃掉 filler1 & filler2，收回 dream2
      expect(
        engine.dispatchAction({
          type: 'SELECT_CHOICE_OPTION',
          playerId: 'p1',
          pendingChoiceId: state.currentPendingChoice!.id,
          selectedIds: [filler1.instanceId, filler2.instanceId],
        }).success
      ).toBe(true);
      expect(
        engine.dispatchAction({
          type: 'SELECT_CHOICE_OPTION',
          playerId: 'p1',
          pendingChoiceId: state.currentPendingChoice!.id,
          selectedIds: [dream2.instanceId],
        }).success
      ).toBe(true);

      // 2) 自动继续第 2 条【出2】：丢弃刚凑齐的 2 张《梦赴光寥之乡》，将对方 oppTarget 放回牌组底
      expect(
        engine.dispatchAction({
          type: 'SELECT_CHOICE_OPTION',
          playerId: 'p1',
          pendingChoiceId: state.currentPendingChoice!.id,
          selectedIds: [dream1.instanceId, dream2.instanceId],
        }).success
      ).toBe(true);
      expect(
        engine.dispatchAction({
          type: 'SELECT_CHOICE_OPTION',
          playerId: 'p1',
          pendingChoiceId: state.currentPendingChoice!.id,
          selectedIds: [oppTarget.instanceId],
        }).success
      ).toBe(true);

      expect(state.cards[oppTarget.instanceId]!.zone).toBe('DECK');
      expect(state.cards[dream1.instanceId]!.zone).toBe('GRAVEYARD');
      expect(state.cards[dream2.instanceId]!.zone).toBe('GRAVEYARD');
      expect(state.currentPendingChoice).toBeUndefined();
    });

    it('ST05-002 Q&A·5：暮形态下出场同时待机暮【出】+晖【出】与切形态触发，可先暮抽1 → 切奇费底球 → 再晖横置复活，两项全生效', () => {
      const engine = createEngine(
        expandDeck('ST02', ['ST05-002', 'ST05-005', 'ST05-005', 'ST05-011']),
        expandDeck('ST01')
      );
      const state = engine.getState();

      const orbEven = findCard(engine, 'p1', 'ST05-011');
      const oddRoleGy = findCard(engine, 'p1', 'ST05-005', 0);
      const oddToBottom = findCard(engine, 'p1', 'ST05-005', 1);
      const st05002 = findCard(engine, 'p1', 'ST05-002');

      engine.zoneMgr.moveCard(orbEven.instanceId, 'SIGNAL_ORB', { isFaceUp: true, toBottom: true });
      engine.zoneMgr.moveCard(oddRoleGy.instanceId, 'GRAVEYARD', { isFaceUp: true });
      engine.zoneMgr.moveCard(st05002.instanceId, 'HAND', { isFaceUp: true });
      fillCostZone(engine, 'p1', 8);

      engine.triggerMgr.registerTrigger({
        abilityId: 'TEST_SWITCH_TO_RADIANCE',
        eventTypes: ['CARD_ENTERED_FIELD'],
        collect: ({ event }) =>
          event.cardInstanceId === st05002.instanceId
            ? [
                {
                  sourceCardInstanceId: st05002.instanceId,
                  sourceCardNumber: st05002.cardNumber,
                  controllerPlayerId: 'p1',
                  label: '切换奇费信号球 (暮->晖)',
                  triggerContext: {},
                },
              ]
            : [],
        execute: () => {
          engine.zoneMgr.moveCard(oddToBottom.instanceId, 'SIGNAL_ORB', { isFaceUp: true, toBottom: true });
        },
      });

      const handBefore = engine.zoneMgr.getCardsInZone('p1', 'HAND').length - 1;
      expect(
        engine.dispatchAction({
          type: 'PLAY_CARD',
          playerId: 'p1',
          cardInstanceId: st05002.instanceId,
          targetSlotIndex: 0,
        }).success
      ).toBe(true);

      // 待机池应有 3 项：暮【出】、晖【出】、切换信号球
      expect(state.currentPendingChoice?.effectType).toBe('CHOOSE_TRIGGER_ORDER');
      expect(state.currentPendingChoice!.options).toHaveLength(3);

      // 第 1 步：选暮【出】-> 抽 1 张
      const duskOpt = state.currentPendingChoice!.options.find((o) => o.label.includes('暮【出】'))!;
      expect(
        engine.dispatchAction({
          type: 'SELECT_CHOICE_OPTION',
          playerId: 'p1',
          pendingChoiceId: state.currentPendingChoice!.id,
          selectedIds: [duskOpt.id],
        }).success
      ).toBe(true);
      expect(engine.zoneMgr.getCardsInZone('p1', 'HAND')).toHaveLength(handBefore + 1);

      // 第 2 步：选切换信号球 -> 变为晖形态
      expect(state.currentPendingChoice?.effectType).toBe('CHOOSE_TRIGGER_ORDER');
      const switchOpt = state.currentPendingChoice!.options.find((o) => o.label.includes('切换奇费信号球'))!;
      expect(
        engine.dispatchAction({
          type: 'SELECT_CHOICE_OPTION',
          playerId: 'p1',
          pendingChoiceId: state.currentPendingChoice!.id,
          selectedIds: [switchOpt.id],
        }).success
      ).toBe(true);

      // 第 3 步：自动结算剩余最后 1 项晖【出】 -> 从墓地横置复活 oddRoleGy
      expect(state.currentPendingChoice?.effectType).toBe('PRESET_ST05_002_REVIVE');
      expect(
        engine.dispatchAction({
          type: 'SELECT_CHOICE_OPTION',
          playerId: 'p1',
          pendingChoiceId: state.currentPendingChoice!.id,
          selectedIds: [oddRoleGy.instanceId],
        }).success
      ).toBe(true);

      expect(state.cards[oddRoleGy.instanceId]!.zone).toBe('BATTLEFIELD');
      expect(state.cards[oddRoleGy.instanceId]!.isReady).toBe(false);
    });

    it('Q&A·4 装备非角色进场时点区分：从手牌装备触发【出】，而战场独立装备转移到角色身上不再重复触发【出】', () => {
      const engine = createEngine(
        expandDeck('ST01', ['BP01-011', 'BP01-011', 'ST01-005']),
        expandDeck('ST02')
      );
      const state = engine.getState();

      const host = placeRole(engine, 'p1', 'ST01-005', 0, { instanceIndex: 0 });
      const host2 = placeRole(engine, 'p1', 'ST01-005', 2, { instanceIndex: 1 });
      const eqFromHand = findCard(engine, 'p1', 'BP01-011', 0);
      const eqStandalone = findCard(engine, 'p1', 'BP01-011', 1);

      state.players.p1!.erosionChangedThisTurn = true;

      // 1) 从 HAND 通过 equipToRole 装备 BP01-011 (<冕饵>) -> 触发其【出】抽 1 张牌
      const handBefore1 = engine.zoneMgr.getCardsInZone('p1', 'HAND').length;
      engine.zoneMgr.moveCard(eqFromHand.instanceId, 'HAND', { isFaceUp: true });
      expect(engine.fieldMgr.equipToRole('p1', eqFromHand.instanceId, host.instanceId)).toBe(true);
      expect(engine.checkTimingMgr.resolveCheckTiming()).toBe(true);
      expect(engine.zoneMgr.getCardsInZone('p1', 'HAND')).toHaveLength(handBefore1 + 1);

      // 2) 另一张 BP01-011 先从 HAND 作为独立装备出场并结算【出】抽 1 张，再转移附着到空装角色 host2 -> prevZone === 'BATTLEFIELD' 不重复触发【出】
      const handBefore2 = engine.zoneMgr.getCardsInZone('p1', 'HAND').length;
      engine.zoneMgr.moveCard(eqStandalone.instanceId, 'HAND', { isFaceUp: true });
      expect(engine.fieldMgr.playStandaloneEquipment('p1', eqStandalone.instanceId, 1)).toBe(true);
      expect(engine.checkTimingMgr.resolveCheckTiming()).toBe(true);
      expect(engine.zoneMgr.getCardsInZone('p1', 'HAND')).toHaveLength(handBefore2 + 1);

      let entryEventCountAfterStandaloneMove = 0;
      engine.triggerMgr.registerTrigger({
        abilityId: 'TEST_WATCH_EQUIP_REATTACH',
        eventTypes: ['CARD_ENTERED_FIELD'],
        collect: ({ event }) => {
          if (event.cardInstanceId === eqStandalone.instanceId) {
            entryEventCountAfterStandaloneMove += 1;
          }
          return [];
        },
        execute: () => {},
      });

      const handBeforeAttach = engine.zoneMgr.getCardsInZone('p1', 'HAND').length;
      expect(engine.fieldMgr.equipToRole('p1', eqStandalone.instanceId, host2.instanceId)).toBe(true);
      expect(engine.checkTimingMgr.resolveCheckTiming()).toBe(true);
      expect(entryEventCountAfterStandaloneMove).toBe(0);
      expect(engine.zoneMgr.getCardsInZone('p1', 'HAND')).toHaveLength(handBeforeAttach);
    });

    it('suppressEntryTrigger=true (对应 BP03-046 triggerEntry:false) 仅抑制自身【出】，不阻断其他 CARD_ENTERED_FIELD 监听者', () => {
      const engine = createEngine(
        expandDeck('ST01', ['BP03-046']),
        expandDeck('ST02')
      );
      const state = engine.getState();

      const ayla = findCard(engine, 'p1', 'BP03-046');
      engine.zoneMgr.moveCard(ayla.instanceId, 'HAND', { isFaceUp: true });

      let otherWatcherCount = 0;
      engine.triggerMgr.registerTrigger({
        abilityId: 'TEST_OTHER_ENTERED_WATCHER',
        eventTypes: ['CARD_ENTERED_FIELD'],
        collect: ({ event }) =>
          event.cardInstanceId === ayla.instanceId
            ? [
                {
                  sourceCardInstanceId: ayla.instanceId,
                  sourceCardNumber: ayla.cardNumber,
                  controllerPlayerId: 'p1',
                  label: '第三方入场监听',
                  triggerContext: {},
                },
              ]
            : [],
        execute: () => {
          otherWatcherCount += 1;
        },
      });

      expect(engine.fieldMgr.playRoleCard('p1', ayla.instanceId, 0, { suppressEntryTrigger: true })).toBe(true);
      expect(engine.checkTimingMgr.resolveCheckTiming()).toBe(true);
      expect(state.currentPendingChoice).toBeUndefined();
      expect(otherWatcherCount).toBe(1);
    });
  });
});

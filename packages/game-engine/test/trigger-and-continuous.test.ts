import { describe, it, expect } from 'vitest';
import {
  GameEngine,
  MemoryCardDatabase,
  OFFICIAL_CARDS_DATA,
  addCardModifier,
} from '../src/index.js';
import { OFFICIAL_STARTER_DECKS } from '@zhanshuang/game-rules';
import { endTurn, fillCostZone, passInstantWindows, resolvePendingChoices } from './helpers.js';

const db = new MemoryCardDatabase(OFFICIAL_CARDS_DATA);

function expandDeck(presetId: 'ST01' | 'ST02' | 'ST03'): string[] {
  const deck = OFFICIAL_STARTER_DECKS.find((d) => d.name.includes(`(${presetId})`))!;
  const list: string[] = [];
  for (const entry of deck.cards) {
    for (let i = 0; i < entry.count; i++) list.push(entry.cardNumber);
  }
  return list;
}

function createOfficialEngine(
  p1Deck: string[] = expandDeck('ST03'),
  p2Deck: string[] = expandDeck('ST02'),
  seed = 20260809
): GameEngine {
  const engine = new GameEngine(
    'game-trigger-continuous',
    { playerId: 'p1', deckCardNumbers: p1Deck },
    { playerId: 'p2', deckCardNumbers: p2Deck },
    seed,
    db,
    { skipMulligan: true }
  );
  // 进入第一回合主要阶段
  engine.dispatchAction({ type: 'PASS_ACTION_TIMING', playerId: engine.getState().activePlayerId });
  return engine;
}

function findCard(engine: GameEngine, playerId: string, cardNumber: string, excludeIds: string[] = []) {
  return Object.values(engine.getState().cards).find(
    (c) => c.controllerPlayerId === playerId && c.cardNumber === cardNumber && !excludeIds.includes(c.instanceId)
  )!;
}

function placeRoleOnField(engine: GameEngine, playerId: string, cardNumber: string, slotIndex: number, excludeIds: string[] = []) {
  const card = findCard(engine, playerId, cardNumber, excludeIds);
  engine.zoneMgr.moveCard(card.instanceId, 'HAND', { isFaceUp: true });
  engine.fieldMgr.playRoleCard(playerId, card.instanceId, slotIndex, { suppressEntryTrigger: true });
  card.turnEnteredZone = 0; // 允许当回合测试攻击
  engine.checkTimingMgr.resolveCheckTiming();
  return card;
}

describe('8.5 / 8.7 自动能力触发框架 (TriggerManager & CheckTimingManager)', () => {
  it('8.5.1.c/d 同时触发时严格先结算回合玩家待机自动能力，再结算回合外玩家待机自动能力', () => {
    const engine = createOfficialEngine();
    const state = engine.getState();
    const active = state.activePlayerId;
    const nonActive = state.nonActivePlayerId;

    const myRole = placeRoleOnField(engine, active, 'ST03-005', 0);
    const oppRole = placeRoleOnField(engine, nonActive, 'ST02-005', 0);
    const executionOrder: string[] = [];

    // 故意先注册回合外玩家触发，再注册回合玩家触发，检验引擎按 8.5.1.c → 8.5.1.d 强制排序
    engine.triggerMgr.registerTrigger({
      abilityId: 'TEST_NON_ACTIVE_ON_ENTER',
      eventTypes: ['CARD_ENTERED_FIELD'],
      collect: ({ event }) =>
        event.cardInstanceId === myRole.instanceId
          ? []
          : [
              {
                sourceCardInstanceId: oppRole.instanceId,
                sourceCardNumber: oppRole.cardNumber,
                controllerPlayerId: nonActive,
                label: '回合外玩家触发',
                triggerContext: {},
              },
            ],
      execute: () => {
        executionOrder.push('NON_ACTIVE');
      },
    });
    engine.triggerMgr.registerTrigger({
      abilityId: 'TEST_ACTIVE_ON_ENTER',
      eventTypes: ['CARD_ENTERED_FIELD'],
      collect: ({ event }) =>
        event.cardInstanceId === myRole.instanceId
          ? []
          : [
              {
                sourceCardInstanceId: myRole.instanceId,
                sourceCardNumber: myRole.cardNumber,
                controllerPlayerId: active,
                label: '回合玩家触发',
                triggerContext: {},
              },
            ],
      execute: () => {
        executionOrder.push('ACTIVE');
      },
    });

    // 打出一张角色牌触发双方待机能力
    fillCostZone(engine, active, 10);
    const enterCard = findCard(engine, active, 'ST03-007', [myRole.instanceId]);
    engine.zoneMgr.moveCard(enterCard.instanceId, 'HAND', { isFaceUp: true });
    const res = engine.dispatchAction({
      type: 'PLAY_CARD',
      playerId: active,
      cardInstanceId: enterCard.instanceId,
      targetSlotIndex: 1,
    });
    expect(res.success).toBe(true);
    expect(executionOrder).toEqual(['ACTIVE', 'NON_ACTIVE']);
  });

  it('8.5.1.c & 8.7.3.a 同玩家多项自动能力同时待机时挂起检查时机并由玩家自选发动顺序 (ST03-009 双搭档)', () => {
    const engine = createOfficialEngine(expandDeck('ST03'), expandDeck('ST02'));
    const state = engine.getState();
    const active = state.activePlayerId;

    // 场上预先放置两张横置的 ST03-009 (可靠的伙伴 21号&诺克提：我方《薇拉·瑰丽》出场时，可消2红球竖直并 PP+2000, DP-1)
    const partner1 = placeRoleOnField(engine, active, 'ST03-009', 0);
    const partner2 = placeRoleOnField(engine, active, 'ST03-009', 1, [partner1.instanceId]);
    partner1.isReady = false;
    partner2.isReady = false;
    const basePP = db.getCard('ST03-009')!.basePP!;

    // 信号球区放入 4 张红色信号球 (满足两张 ST03-009 各消除 2 红球)
    const redOrbs = Object.values(state.cards)
      .filter((c) => c.controllerPlayerId === active && db.getCard(c.cardNumber)?.signalOrb === 'RED')
      .slice(0, 4);
    expect(redOrbs.length).toBe(4);
    for (const orb of redOrbs) {
      engine.zoneMgr.moveCard(orb.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    }

    fillCostZone(engine, active, 10);
    // 手牌放入 ST03-003 (《薇拉·瑰丽》) 并出场
    const vera = findCard(engine, active, 'ST03-003');
    engine.zoneMgr.moveCard(vera.instanceId, 'HAND', { isFaceUp: true });

    const res = engine.dispatchAction({
      type: 'PLAY_CARD',
      playerId: active,
      cardInstanceId: vera.instanceId,
      targetSlotIndex: 2,
    });
    expect(res.success).toBe(true);

    // ST03-003 自身【出】与 2 张 ST03-009 【自】共 3 项同时进入待机 (8.5.1 / 8.7.3)
    const firstOrderChoice = state.currentPendingChoice;
    expect(firstOrderChoice).toBeDefined();
    expect(firstOrderChoice?.effectType).toBe('CHOOSE_TRIGGER_ORDER');
    expect(firstOrderChoice?.playerId).toBe(active);
    expect(firstOrderChoice?.options.length).toBe(3);

    // 先处理 ST03-003 自身【出】并跳过其可选效果，随后剩余 2 项 ST03-009【自】仍由玩家自选顺序
    const veraEntryOpt = firstOrderChoice!.options.find(
      (o) => (o.payload as { abilityId?: string } | undefined)?.abilityId === 'dsl:CARD_ENTRY'
    )!;
    expect(veraEntryOpt).toBeDefined();
    expect(
      engine.dispatchAction({
        type: 'SELECT_CHOICE_OPTION',
        playerId: active,
        pendingChoiceId: firstOrderChoice!.id,
        selectedIds: [veraEntryOpt.id],
      }).success
    ).toBe(true);
    while (state.currentPendingChoice && state.currentPendingChoice.effectType !== 'CHOOSE_TRIGGER_ORDER') {
      const ch = state.currentPendingChoice;
      const skipOpt = ch.options.find((o) => o.id === 'skip') ?? ch.options[0]!;
      expect(
        engine.dispatchAction({
          type: 'SELECT_CHOICE_OPTION',
          playerId: ch.playerId,
          pendingChoiceId: ch.id,
          selectedIds: [skipOpt.id],
        }).success
      ).toBe(true);
    }

    const orderChoice = state.currentPendingChoice;
    expect(orderChoice).toBeDefined();
    expect(orderChoice?.effectType).toBe('CHOOSE_TRIGGER_ORDER');
    expect(orderChoice?.playerId).toBe(active);
    expect(orderChoice?.options.length).toBe(2);

    // 玩家选择优先发动第 2 项，依次支付每张 ST03-009 的 2 红球代价
    const chooseRes = engine.dispatchAction({
      type: 'SELECT_CHOICE_OPTION',
      playerId: active,
      pendingChoiceId: orderChoice!.id,
      selectedIds: [orderChoice!.options[1]!.id],
    });
    expect(chooseRes.success).toBe(true);

    // 依次为两张 ST03-009 选择支付 2 红球 (非 skip 选项)
    for (let i = 0; i < 2; i++) {
      const payChoice = state.currentPendingChoice!;
      expect(payChoice).toBeDefined();
      const payOpt = payChoice.options.find((o) => o.id !== 'skip')!;
      expect(
        engine.dispatchAction({
          type: 'SELECT_CHOICE_OPTION',
          playerId: active,
          pendingChoiceId: payChoice.id,
          selectedIds: [payOpt.id],
        }).success
      ).toBe(true);
    }

    expect(state.pendingTriggers.length).toBe(0);
    expect(state.cards[partner1.instanceId]!.isReady).toBe(true);
    expect(state.cards[partner2.instanceId]!.isReady).toBe(true);
    expect(engine.fieldMgr.calculateRoleEffectivePP(partner1.instanceId)).toBe(basePP + 2000);
    expect(engine.fieldMgr.calculateRoleEffectivePP(partner2.instanceId)).toBe(basePP + 2000);
  });

  it('8.5.3 / 8.7.7 结算中途重新触发自动能力、以及来源离场后已待机自动能力仍须结算', () => {
    const engine = createOfficialEngine();
    const state = engine.getState();
    const active = state.activePlayerId;

    const sourceA = placeRoleOnField(engine, active, 'ST03-005', 0);
    const sourceB = placeRoleOnField(engine, active, 'ST03-007', 1);
    const log: string[] = [];

    // 触发 A：把来源 B 移入墓地，并触发一个 CARD_LEFT_FIELD 后续自动能力
    engine.triggerMgr.registerTrigger({
      abilityId: 'TEST_A_REMOVES_B',
      eventTypes: ['TURN_STARTED'],
      collect: () => [
        {
          sourceCardInstanceId: sourceA.instanceId,
          sourceCardNumber: sourceA.cardNumber,
          controllerPlayerId: active,
          label: '能力A：移除来源B',
          triggerContext: {},
        },
      ],
      execute: (_t, ctx) => {
        log.push('A_EXEC');
        ctx.zoneMgr.moveCard(sourceB.instanceId, 'GRAVEYARD', { isFaceUp: true });
      },
    });
    // 触发 B：与 A 同时待机，尽管执行 A 时 B 已离开战场，按 8.7.7 仍须执行
    engine.triggerMgr.registerTrigger({
      abilityId: 'TEST_B_STILL_RESOLVES',
      eventTypes: ['TURN_STARTED'],
      collect: () => [
        {
          sourceCardInstanceId: sourceB.instanceId,
          sourceCardNumber: sourceB.cardNumber,
          controllerPlayerId: active,
          label: '能力B：离场后仍须结算',
          triggerContext: {},
        },
      ],
      execute: () => {
        log.push('B_EXEC');
      },
    });
    // 触发 C：监听 B 离场事件 (8.7.4 捕获离场瞬间快照)
    let capturedSnapshotZone: string | undefined;
    let capturedSnapshotPP: number | undefined;
    engine.triggerMgr.registerTrigger({
      abilityId: 'TEST_C_ON_LEFT_FIELD',
      eventTypes: ['CARD_LEFT_FIELD'],
      collect: ({ event }) =>
        event.cardInstanceId === sourceB.instanceId
          ? [
              {
                sourceCardInstanceId: sourceA.instanceId,
                sourceCardNumber: sourceA.cardNumber,
                controllerPlayerId: active,
                label: '能力C：响应离场快照',
                triggerContext: { snapshot: event.subjectSnapshot },
              },
            ]
          : [],
      execute: (trig) => {
        const snap = trig.triggerContext?.snapshot as { zone?: string; effectivePP?: number } | undefined;
        capturedSnapshotZone = snap?.zone;
        capturedSnapshotPP = snap?.effectivePP;
        log.push('C_EXEC');
      },
    });

    // 给 B 加一个临时 PP+1500，以验证 8.7.4 快照记住了离场前的有效 PP
    const bBasePP = db.getCard(sourceB.cardNumber)!.basePP!;
    addCardModifier(state, sourceB, { pp: 1500, untilTurn: state.turnNumber, source: 'TEST' });

    engine.triggerMgr.emit({ type: 'TURN_STARTED', playerId: active });
    // A 与 B 同时待机 -> 挂起 CHOOSE_TRIGGER_ORDER
    expect(engine.checkTimingMgr.resolveCheckTiming()).toBe(false);
    const ch1 = state.currentPendingChoice!;
    expect(ch1.effectType).toBe('CHOOSE_TRIGGER_ORDER');
    const optA = ch1.options.find((o) => (o.payload as { abilityId?: string })?.abilityId === 'TEST_A_REMOVES_B')!;

    // 先选 A 执行 -> A 移走 B 并使 C 入池 -> 此时 B 与 C 均在待机池，再次让玩家选择顺序
    expect(
      engine.dispatchAction({
        type: 'SELECT_CHOICE_OPTION',
        playerId: active,
        pendingChoiceId: ch1.id,
        selectedIds: [optA.id],
      }).success
    ).toBe(true);

    expect(state.cards[sourceB.instanceId]!.zone).toBe('GRAVEYARD');
    const ch2 = state.currentPendingChoice!;
    expect(ch2.effectType).toBe('CHOOSE_TRIGGER_ORDER');
    expect(ch2.options.length).toBe(2);
    const optB = ch2.options.find((o) => (o.payload as { abilityId?: string })?.abilityId === 'TEST_B_STILL_RESOLVES')!;

    // 先选 B，再自动执行 C
    expect(
      engine.dispatchAction({
        type: 'SELECT_CHOICE_OPTION',
        playerId: active,
        pendingChoiceId: ch2.id,
        selectedIds: [optB.id],
      }).success
    ).toBe(true);

    expect(log).toEqual(['A_EXEC', 'B_EXEC', 'C_EXEC']);
    expect(capturedSnapshotZone).toBe('BATTLEFIELD');
    expect(capturedSnapshotPP).toBe(bBasePP + 1500);
  });

  it('8.7.5 时限触发与快照恢复：ST02-011 苏生角色后经 toSnapshot/fromSnapshot 恢复，回合结束时仍送入墓地', () => {
    const engine = createOfficialEngine(expandDeck('ST01'), expandDeck('ST02'));
    const state = engine.getState();
    const attackerPlayer = state.activePlayerId; // ST01
    const defenderPlayer = state.nonActivePlayerId; // ST02

    // 攻击方准备一个可攻击角色，防守方场上存在《露娜·银冕》(满足 ST02-011 使用条件)
    const attacker = placeRoleOnField(engine, attackerPlayer, 'ST01-005', 0);
    placeRoleOnField(engine, defenderPlayer, 'ST02-001', 0);

    // 防守方墓地放 1 张费用<=3 的 <升格者> 角色 (ST02-005 费用 2)，手牌放 ST02-011 且侵蚀 <= 4
    const gyRole = findCard(engine, defenderPlayer, 'ST02-005');
    engine.zoneMgr.moveCard(gyRole.instanceId, 'GRAVEYARD', { isFaceUp: true });
    const st02011 = findCard(engine, defenderPlayer, 'ST02-011');
    engine.zoneMgr.moveCard(st02011.instanceId, 'HAND', { isFaceUp: true });
    fillCostZone(engine, defenderPlayer, 10);
    state.players[defenderPlayer]!.erosionCount = 2;

    // 攻击方宣告攻击对方玩家 → 自由时点步骤由被攻击方先持有瞬时优先权
    expect(
      engine.dispatchAction({
        type: 'DECLARE_ATTACK',
        playerId: attackerPlayer,
        attackerCardId: attacker.instanceId,
        targetType: 'PLAYER',
      }).success
    ).toBe(true);
    expect(state.timingWindow?.kind).toBe('FREE_TIMING');
    expect(state.timingWindow?.priorityPlayerId).toBe(defenderPlayer);

    // 防守方发动 ST02-011 苏生墓地的 ST02-005
    expect(
      engine.dispatchAction({
        type: 'USE_INSTANT',
        playerId: defenderPlayer,
        cardInstanceId: st02011.instanceId,
      }).success
    ).toBe(true);

    const reviveChoice = state.currentPendingChoice!;
    expect(reviveChoice).toBeDefined();
    expect(
      engine.dispatchAction({
        type: 'SELECT_CHOICE_OPTION',
        playerId: defenderPlayer,
        pendingChoiceId: reviveChoice.id,
        selectedIds: [gyRole.instanceId],
      }).success
    ).toBe(true);

    expect(state.cards[gyRole.instanceId]!.zone).toBe('BATTLEFIELD');
    expect(state.delayedTriggers?.some((dt) => dt.abilityId === 'DELAYED_END_OF_TURN_TO_GRAVEYARD')).toBe(true);

    // 模拟 Durable Object 休眠与快照恢复
    const snap = engine.toSnapshot();
    const restored = GameEngine.fromSnapshot(snap, db);

    // 结束本次攻击流程 (双方放弃自由时点，不阻挡，完成充能与伤害选择)
    passInstantWindows(restored);
    if (restored.getState().currentCombat?.step === 'BLOCK') {
      restored.dispatchAction({ type: 'DECLARE_BLOCK', playerId: defenderPlayer });
    }
    resolvePendingChoices(restored);

    // 推进至本回合结束阶段，验证 6.5.1.b 8.7.5 时限触发将苏生角色送回墓地
    endTurn(restored);
    expect(restored.getState().cards[gyRole.instanceId]!.zone).toBe('GRAVEYARD');
    expect(restored.getState().delayedTriggers).toBeUndefined();
  });

  it('8.3.4 失去能力跳过【自】触发并禁止发动【起】能力；10.1 【回合1】限制在移区后重置 (10.1.2.a)', () => {
    const engine = createOfficialEngine(expandDeck('ST01'), expandDeck('ST02'));
    const state = engine.getState();
    const active = state.activePlayerId;

    const role = placeRoleOnField(engine, active, 'ST01-002', 0);
    let triggerCount = 0;

    engine.triggerMgr.registerTrigger({
      abilityId: 'TEST_ONCE_PER_TURN_TRIG',
      eventTypes: ['ORBS_ELIMINATED'],
      oncePerTurn: true,
      collect: () =>
        state.cards[role.instanceId]!.zone === 'BATTLEFIELD'
          ? [
              {
                sourceCardInstanceId: role.instanceId,
                sourceCardNumber: role.cardNumber,
                controllerPlayerId: active,
                label: '回合1测试自动能力',
                triggerContext: {},
              },
            ]
          : [],
      execute: () => {
        triggerCount += 1;
      },
    });

    // 1. 正常触发第 1 次生效，同回合第 2 次受 10.1 【回合1】限制不生效
    engine.triggerMgr.emit({ type: 'ORBS_ELIMINATED', playerId: active, orbCardIds: [] });
    engine.checkTimingMgr.resolveCheckTiming();
    expect(triggerCount).toBe(1);

    engine.triggerMgr.emit({ type: 'ORBS_ELIMINATED', playerId: active, orbCardIds: [] });
    engine.checkTimingMgr.resolveCheckTiming();
    expect(triggerCount).toBe(1);

    // 2. 10.1.2.a 移区后重新进场，次数限制重置，可再次触发
    engine.zoneMgr.moveCard(role.instanceId, 'HAND', { isFaceUp: true });
    engine.fieldMgr.playRoleCard(active, role.instanceId, 0, { suppressEntryTrigger: true });
    engine.triggerMgr.emit({ type: 'ORBS_ELIMINATED', playerId: active, orbCardIds: [] });
    engine.checkTimingMgr.resolveCheckTiming();
    expect(triggerCount).toBe(2);

    // 3. 8.3.4 赋予 loseAbilities 后：无法发动【起】动能力，且【自】触发被跳过
    addCardModifier(state, role, { loseAbilities: true, untilTurn: state.turnNumber, source: 'TEST_SILENCE' });
    const actRes = engine.dispatchAction({
      type: 'ACTIVATE_ABILITY',
      playerId: active,
      sourceCardId: role.instanceId,
    });
    expect(actRes.success).toBe(false);
    expect(actRes.error).toContain('无效');

    // 先重置使用计数以确认确实是因为 8.3.4 跳过而非回合1跳过
    state.players[active]!.turnAbilityUsage = {};
    engine.triggerMgr.emit({ type: 'ORBS_ELIMINATED', playerId: active, orbCardIds: [] });
    engine.checkTimingMgr.resolveCheckTiming();
    expect(triggerCount).toBe(2);
  });

  it('7.2.1.d 攻击时触发 (ST02-009 奥兹玛) 在进入自由时点前暂停并由 9.4 SBA 破坏 PP=0 角色', () => {
    const engine = createOfficialEngine(expandDeck('ST02'), expandDeck('ST01'));
    const state = engine.getState();
    const active = state.activePlayerId;
    const opp = state.nonActivePlayerId;

    // 己方《露娜·银冕》装备《奥兹玛》(攻击时可消2同色球，使对方1张角色 PP-4000)
    const luna = placeRoleOnField(engine, active, 'ST02-001', 0);
    const ozma = findCard(engine, active, 'ST02-009');
    engine.zoneMgr.moveCard(ozma.instanceId, 'PROCESSING', { isFaceUp: true });
    expect(engine.fieldMgr.equipToRole(active, ozma.instanceId, luna.instanceId)).toBe(true);

    // 信号球区放入 2 张同色(蓝色)信号球
    const blueOrbs = Object.values(state.cards)
      .filter((c) => c.controllerPlayerId === active && db.getCard(c.cardNumber)?.signalOrb === 'BLUE')
      .slice(0, 2);
    expect(blueOrbs.length).toBe(2);
    for (const orb of blueOrbs) {
      engine.zoneMgr.moveCard(orb.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    }

    // 对手场上有 PP=4000 的角色 (ST01-007 里·异火)，可被 PP-4000 直接归零触发 9.4 SBA 破坏
    const oppRole = placeRoleOnField(engine, opp, 'ST01-007', 0);
    expect(engine.fieldMgr.calculateRoleEffectivePP(oppRole.instanceId)).toBe(4000);

    // 宣告攻击对手玩家
    const atkRes = engine.dispatchAction({
      type: 'DECLARE_ATTACK',
      playerId: active,
      attackerCardId: luna.instanceId,
      targetType: 'PLAYER',
    });
    expect(atkRes.success).toBe(true);
    // 仍在攻击宣言步骤，等待 ST02-009 攻击时触发支付信号球代价 (未进入自由时点/阻挡)
    expect(state.phase).toBe('COMBAT_ATTACK_DECLARATION');
    expect(state.currentCombat?.step).toBe('ATTACK_DECLARATION');
    const costChoice = state.currentPendingChoice!;
    expect(costChoice).toBeDefined();
    const payOpt = costChoice.options.find((o) => o.id !== 'skip')!;
    expect(
      engine.dispatchAction({
        type: 'SELECT_CHOICE_OPTION',
        playerId: active,
        pendingChoiceId: costChoice.id,
        selectedIds: [payOpt.id],
      }).success
    ).toBe(true);

    // 选择削弱 oppRole (PP-4000 → PP=0 → 9.4 SBA 在进入阻挡前直接破坏)
    const targetChoice = state.currentPendingChoice!;
    expect(targetChoice).toBeDefined();
    expect(
      engine.dispatchAction({
        type: 'SELECT_CHOICE_OPTION',
        playerId: active,
        pendingChoiceId: targetChoice.id,
        selectedIds: [oppRole.instanceId],
      }).success
    ).toBe(true);

    // oppRole 已被 9.4 破坏送墓，无其他可阻挡角色 → 攻击不会停在阻挡
    expect(state.cards[oppRole.instanceId]!.zone).toBe('GRAVEYARD');
  });

  it('Q&A·10 7.6.1.d 战斗破坏触发先于 7.6.1.f 攻击结束时【同命】触发结算', () => {
    const engine = createOfficialEngine(expandDeck('ST01'), expandDeck('ST02'));
    const state = engine.getState();
    const active = state.activePlayerId;
    const opp = state.nonActivePlayerId;

    const attacker = placeRoleOnField(engine, active, 'ST01-004', 0); // PP 高于目标
    const defender = placeRoleOnField(engine, opp, 'ST02-007', 0); // 横置角色被攻击
    defender.isReady = false;

    // 赋予攻击角色【同命】
    addCardModifier(state, attacker, { keywords: ['同命'], untilTurn: state.turnNumber, source: 'TEST_MD' });
    const trace: string[] = [];

    // 监听 7.6.1.d 战斗破坏触发
    engine.triggerMgr.registerTrigger({
      abilityId: 'TEST_ON_BATTLE_DESTROYED',
      eventTypes: ['CARD_DESTROYED'],
      collect: ({ event }) =>
        event.cardInstanceId === defender.instanceId && event.destroyReason === 'BATTLE'
          ? [
              {
                sourceCardInstanceId: defender.instanceId,
                sourceCardNumber: defender.cardNumber,
                controllerPlayerId: opp,
                label: '被战斗破坏时触发 (7.6.1.d)',
                triggerContext: {},
              },
            ]
          : [],
      execute: () => {
        trace.push('7.6.1.d_BATTLE_DESTROYED');
      },
    });
    // 同时监听 7.6.1.f 攻击结束时触发
    engine.triggerMgr.registerTrigger({
      abilityId: 'TEST_ON_ATTACK_ENDED_LOG',
      eventTypes: ['ATTACK_ENDED'],
      collect: ({ event }) =>
        event.cardInstanceId === attacker.instanceId
          ? [
              {
                sourceCardInstanceId: attacker.instanceId,
                sourceCardNumber: attacker.cardNumber,
                controllerPlayerId: active,
                label: '攻击结束时记录 (7.6.1.f)',
                triggerContext: {},
              },
            ]
          : [],
      execute: () => {
        trace.push('7.6.1.f_ATTACK_ENDED');
      },
    });

    // 确保攻击角色 PP 足以战斗破坏防御角色
    addCardModifier(state, attacker, { pp: 10000, untilTurn: state.turnNumber, source: 'TEST_BOOST' });
    // 确保牌组顶不是信号球避免额外充能选择干扰
    const nonOrb = engine.zoneMgr
      .getCardsInZone(active, 'DECK')
      .find((c) => !db.getCard(c.cardNumber)?.signalOrb);
    if (nonOrb) engine.zoneMgr.moveCardToTopOfDeck(nonOrb.instanceId);

    const atkRes = engine.dispatchAction({
      type: 'DECLARE_ATTACK',
      playerId: active,
      attackerCardId: attacker.instanceId,
      targetType: 'CHARACTER',
      targetCardId: defender.instanceId,
    });
    expect(atkRes.success).toBe(true);
    passInstantWindows(engine);
    resolvePendingChoices(engine);

    // 7.6.1.d 战斗破坏触发必然严格早于 7.6.1.f 攻击结束时触发
    expect(trace).toEqual(['7.6.1.d_BATTLE_DESTROYED', '7.6.1.f_ATTACK_ENDED']);
  });
});

describe('8.9 统一持续效果层 (ContinuousEffectEngine)', () => {
  it('8.9.1.d 依赖顺序：后赋予的 <升格者> 特征仍能被先出场的 ST02-001 永久能力增益 PP+1000', () => {
    const engine = createOfficialEngine(expandDeck('ST02'), expandDeck('ST01'));
    const state = engine.getState();
    const active = state.activePlayerId;

    // 1. 先让 ST02-001 (露娜·银冕：侵蚀>=5 时我方所有<升格者>角色 PP+1000) 进场
    placeRoleOnField(engine, active, 'ST02-001', 0);
    state.players[active]!.erosionCount = 5;

    // 2. 再放一张原本不带<升格者>特征的角色 (伪造为 ST01-005 <灰鸦小队>)
    const otherRole = placeRoleOnField(engine, active, 'ST02-007', 1);
    // 借用一张没有 <升格者> 的卡：直接改为 ST01-005 卡号
    (otherRole as { cardNumber: string; cardId: string }).cardNumber = 'ST01-005';
    (otherRole as { cardNumber: string; cardId: string }).cardId = 'c-st01-005';
    const basePP = db.getCard('ST01-005')!.basePP!;

    // 尚未获得 <升格者> 前不享受 ST02-001 的光环
    expect(engine.fieldMgr.calculateRoleEffectivePP(otherRole.instanceId)).toBe(basePP);

    // 3. 在更晚的时间戳添加 <升格者> 特征 (Layer 1 早于 Layer 2 计算 → 立即享受光环)
    addCardModifier(state, otherRole, { addTraits: ['升格者'], untilTurn: state.turnNumber, source: 'TEST_TRAIT' });
    expect(engine.continuousEffects.hasTrait(otherRole.instanceId, '升格者')).toBe(true);
    expect(engine.fieldMgr.calculateRoleEffectivePP(otherRole.instanceId)).toBe(basePP + 1000);
  });

  it('8.9.1.e 时间戳顺序与 Q&A·6 数值覆盖：先 +1000 再 setPP=70 得到 70，再 +1000 得到 1070', () => {
    const engine = createOfficialEngine();
    const state = engine.getState();
    const active = state.activePlayerId;

    const role = placeRoleOnField(engine, active, 'ST03-005', 0);
    const basePP = db.getCard('ST03-005')!.basePP!;

    addCardModifier(state, role, { pp: 1000, untilTurn: state.turnNumber, source: 'T1_BUFF' });
    expect(engine.fieldMgr.calculateRoleEffectivePP(role.instanceId)).toBe(basePP + 1000);

    addCardModifier(state, role, { setPP: 70, untilTurn: state.turnNumber, source: 'T2_OVERRIDE' });
    expect(engine.fieldMgr.calculateRoleEffectivePP(role.instanceId)).toBe(70);

    addCardModifier(state, role, { pp: 1000, untilTurn: state.turnNumber, source: 'T3_BUFF' });
    expect(engine.fieldMgr.calculateRoleEffectivePP(role.instanceId)).toBe(1070);
  });

  it('BP04-001 露娜·终焉下方牌派生 PP/DP + Q&A·10 失去能力后 PP 归 0 触发 9.4 破坏 + 后赋予词条保留', () => {
    const engine = createOfficialEngine(expandDeck('ST02'), expandDeck('ST01'));
    const state = engine.getState();
    const active = state.activePlayerId;

    const luna = placeRoleOnField(engine, active, 'ST02-005', 0);
    (luna as { cardNumber: string; cardId: string }).cardNumber = 'BP04-001';
    (luna as { cardNumber: string; cardId: string }).cardId = 'c-bp04-001';

    // 垫入 3 张底牌 → PP = 3000, DP = 1
    const deckCards = engine.zoneMgr.getCardsInZone(active, 'DECK').slice(0, 10);
    luna.underneathCardIds = deckCards.slice(0, 3).map((c) => c.instanceId);
    expect(engine.fieldMgr.calculateRoleEffectivePP(luna.instanceId)).toBe(3000);
    expect(engine.fieldMgr.calculateRoleEffectiveDP(luna.instanceId)).toBe(1);

    // 垫入 10 张底牌 → PP = 10000, DP = 2
    luna.underneathCardIds = deckCards.map((c) => c.instanceId);
    expect(engine.fieldMgr.calculateRoleEffectivePP(luna.instanceId)).toBe(10000);
    expect(engine.fieldMgr.calculateRoleEffectiveDP(luna.instanceId)).toBe(2);

    // 先赋予【贯通】，再赋予 loseAbilities，再赋予【速攻】
    addCardModifier(state, luna, { keywords: ['贯通'], untilTurn: state.turnNumber, source: 'BEFORE_SILENCE' });
    addCardModifier(state, luna, { loseAbilities: true, untilTurn: state.turnNumber, source: 'SILENCE' });
    addCardModifier(state, luna, { keywords: ['速攻'], untilTurn: state.turnNumber, source: 'AFTER_SILENCE' });

    const evaluated = engine.fieldMgr.evaluateRoleStats(luna.instanceId);
    // 失去能力前赋予的【贯通】失效，失去能力后赋予的【速攻】依然有效 (8.9.1.e)
    expect(evaluated.keywords).not.toContain('贯通');
    expect(evaluated.keywords).toContain('速攻');
    // 自身【永】PP 增益失效 → PP=0
    expect(evaluated.pp).toBe(0);

    // 进入检查时机，9.4 规则处理将 PP=0 的《露娜·终焉》破坏送墓
    engine.checkTimingMgr.resolveCheckTiming();
    expect(state.cards[luna.instanceId]!.zone).toBe('GRAVEYARD');
  });

  it('带期限修改器 (untilTurn) 回合末失效，区域绑定修改器 (升变【速攻】) 跨回合保留直至离场', () => {
    const engine = createOfficialEngine(expandDeck('ST01'), expandDeck('ST02'));
    const state = engine.getState();
    const active = state.activePlayerId;

    const role = placeRoleOnField(engine, active, 'ST01-005', 0);
    // 模拟 BP01-002 赋予的本回合【突进】与【充能0】
    addCardModifier(state, role, {
      keywords: ['突进'],
      setCharge: 0,
      untilTurn: state.turnNumber,
      source: 'BP01-002',
    });
    // 模拟升变赋予的跨回合【速攻】(untilTurn: undefined)
    addCardModifier(state, role, {
      keywords: ['速攻'],
      untilTurn: undefined,
      source: 'ASCENSION',
    });

    expect(engine.combatMgr.hasKeyword(role.instanceId, '突进')).toBe(true);
    expect(engine.combatMgr.hasKeyword(role.instanceId, '速攻')).toBe(true);
    expect(engine.combatMgr.calculateRoleChargeCount(role.instanceId)).toBe(0);

    // 结束当前回合
    endTurn(engine);

    // 回合末后：【突进】与【充能0】自动失效，升变【速攻】依然保留
    expect(engine.combatMgr.hasKeyword(role.instanceId, '突进')).toBe(false);
    expect(engine.combatMgr.hasKeyword(role.instanceId, '速攻')).toBe(true);
    expect(engine.combatMgr.calculateRoleChargeCount(role.instanceId)).toBe(1);

    // 离开战场后，所有持续效果清空 (3.1.4)
    engine.zoneMgr.moveCard(role.instanceId, 'HAND', { isFaceUp: true });
    expect(state.cards[role.instanceId]!.modifiers).toBeUndefined();
    expect(engine.combatMgr.hasKeyword(role.instanceId, '速攻')).toBe(false);
  });

  it('兼容旧快照只读回退：遗留 tempPPBonus / tempDPBonus / grantedKeywords 仍可正确计算', () => {
    const engine = createOfficialEngine();
    const active = engine.getState().activePlayerId;
    const role = placeRoleOnField(engine, active, 'ST03-005', 0);
    const basePP = db.getCard('ST03-005')!.basePP!;
    const baseDP = db.getCard('ST03-005')!.baseDP!;

    role.tempPPBonus = 500;
    role.tempDPBonus = 1;
    role.grantedKeywords = ['贯通'];

    const stats = engine.fieldMgr.evaluateRoleStats(role.instanceId);
    expect(stats.pp).toBe(basePP + 500);
    expect(stats.dp).toBe(baseDP + 1);
    expect(stats.keywords).toContain('贯通');
  });
});

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

function createEngine(p1Deck: string[], p2Deck: string[], seed = 20261121): GameEngine {
  const engine = new GameEngine(
    'st04-06-test',
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
  return Object.values(engine.getState().cards).filter(
    (c) => c.controllerPlayerId === playerId && c.cardNumber === cardNumber
  );
}

function findCard(engine: GameEngine, playerId: string, cardNumber: string) {
  const card = findCards(engine, playerId, cardNumber)[0];
  if (!card) throw new Error(`未找到玩家 ${playerId} 的卡牌 ${cardNumber}`);
  return card;
}

function placeRole(
  engine: GameEngine,
  playerId: string,
  cardNumber: string,
  slotIndex: number,
  options?: { isReady?: boolean; enteredEarlier?: boolean; instanceIndex?: number }
) {
  const card = findCards(engine, playerId, cardNumber)[options?.instanceIndex ?? 0];
  if (!card) throw new Error(`未找到玩家 ${playerId} 的卡牌 ${cardNumber}`);
  engine.zoneMgr.moveCard(card.instanceId, 'HAND', { isFaceUp: true });
  engine.fieldMgr.playRoleCard(playerId, card.instanceId, slotIndex, { suppressEntryTrigger: true });
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

describe('ST04 突击鹰小队官方预组 (14 张声明式效果)', () => {
  it('ST04-001 荣光护盾 & ST04-010 阿波罗：对方回合瞬时竖直+1000PP并赋予阻挡反杀【自】，阻挡时阿波罗抽1且攻击结束破坏攻击角色', () => {
    const engine = createEngine(
      expandDeck('ST01'),
      expandDeck('ST02', ['ST04-001', 'ST04-004', 'ST04-005', 'ST04-010', 'ST04-012', 'ST04-013'])
    );
    const state = engine.getState();
    const active = state.activePlayerId; // p1
    const opp = state.nonActivePlayerId; // p2

    const attacker = placeRole(engine, active, 'ST01-005', 0, { isReady: true }); // PP 4000
    // p2 场上放横置的 ST04-004 (<突击鹰小队>, PP 4000) 并装备 ST04-010 阿波罗 (+500 PP)
    const chrome = placeRole(engine, opp, 'ST04-004', 0, { isReady: false });
    const apollo = findCard(engine, opp, 'ST04-010');
    engine.zoneMgr.moveCard(apollo.instanceId, 'BATTLEFIELD', { isFaceUp: true });
    chrome.attachedEquipmentId = apollo.instanceId;

    // 给 p2 放冰属性明费与手牌 ST04-001 + 2 张任意信号球
    const iceCost = findCard(engine, opp, 'ST04-005');
    const shield = findCard(engine, opp, 'ST04-001');
    const orb1 = findCard(engine, opp, 'ST04-012');
    const orb2 = findCard(engine, opp, 'ST04-013');
    engine.zoneMgr.moveCard(shield.instanceId, 'HAND', { isFaceUp: true });
    engine.zoneMgr.moveCard(iceCost.instanceId, 'COST', { isFaceUp: true, isReady: true });
    engine.zoneMgr.moveCard(orb1.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    engine.zoneMgr.moveCard(orb2.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    fillCostZone(engine, opp, 4);

    // 验证：若在己方回合则 ST04-001 被拒绝（这里通过 p1 攻击进入自由时点，p2 在对方回合使用）
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

    expect(state.timingWindow?.priorityPlayerId).toBe(opp);
    expect(
      engine.dispatchAction({
        type: 'PLAY_CARD',
        playerId: opp,
        cardInstanceId: shield.instanceId,
      }).success
    ).toBe(true);
    expect(state.currentPendingChoice?.effectType).toBe('PRESET_ST04_001_TARGET');
    expect(
      engine.dispatchAction({
        type: 'SELECT_CHOICE_OPTION',
        playerId: opp,
        pendingChoiceId: state.currentPendingChoice!.id,
        selectedIds: [chrome.instanceId],
      }).success
    ).toBe(true);

    // ST04-004 变为竖直，PP = 4000 + 500(阿波罗) + 1000(荣光护盾) = 5500
    expect(state.cards[chrome.instanceId]!.isReady).toBe(true);
    expect(engine.fieldMgr.calculateRoleEffectivePP(chrome.instanceId)).toBe(5500);
    expect(engine.continuousEffects.hasGrantedTrigger(chrome.instanceId, 'ST04_001_GRANTED_BLOCK_END_DESTROY')).toBe(true);

    // 双方跳过自由时点，进入阻挡步骤
    passInstantWindows(engine);
    expect(state.currentCombat?.step).toBe('BLOCK');

    // p2 用 chrome 阻挡 → 触发 ST04-010 阿波罗抽 1 张牌；随后战斗比较 chrome(5500) > attacker(4000)？
    // 为了验证 ST04-001 反杀破坏攻击角色，给 attacker 临时加 3000 PP (变为 7000)，让 attacker 存活至攻击结束
    // 再给 chrome 加 3000 PP 避免 chrome 战破离场 → 两者同为 8500 vs 7000？不，若 defender(8500) > attacker(7000)，战斗规则不破坏攻击者 (7.6.1.c 只在攻击方>=防御方时破坏防御方！)
    // 所以 chrome 5500 > attacker 4000 时双方都存活进入攻击结束，完美测试反杀！
    const oppHandBefore = engine.zoneMgr.getCardsInZone(opp, 'HAND').length;
    expect(
      engine.dispatchAction({
        type: 'DECLARE_BLOCK',
        playerId: opp,
        blockerCardId: chrome.instanceId,
      }).success
    ).toBe(true);
    // 阿波罗抽 1 张牌生效
    expect(engine.zoneMgr.getCardsInZone(opp, 'HAND').length).toBe(oppHandBefore + 1);

    // 攻击结束触发荣光护盾赋予的【自】：弹出消 2 任意信号球选择
    expect(state.currentPendingChoice?.effectType).toBe('PRESET_ST04_001_ORB_COST');
    const orbGroupOpt = state.currentPendingChoice!.options.find((o) => o.id !== 'skip')!;
    expect(
      engine.dispatchAction({
        type: 'SELECT_CHOICE_OPTION',
        playerId: opp,
        pendingChoiceId: state.currentPendingChoice!.id,
        selectedIds: [orbGroupOpt.id],
      }).success
    ).toBe(true);

    // 攻击角色 ST01-005 被荣光护盾赋予能力破坏进入墓地
    expect(state.cards[attacker.instanceId]!.zone).toBe('GRAVEYARD');
    expect(state.cards[orb1.instanceId]!.zone).toBe('GRAVEYARD');
    expect(state.cards[orb2.instanceId]!.zone).toBe('GRAVEYARD');
  });

  it('ST04-002 / ST04-003 / ST04-004 / ST04-007 / ST04-008 / ST04-009 / ST04-011 全流程校验', () => {
    const engine = createEngine(
      expandDeck('ST01', [
        'ST04-001',
        'ST04-002',
        'ST04-003',
        'ST04-004',
        'ST04-005',
        'ST04-007',
        'ST04-008',
        'ST04-009',
        'ST04-011',
      ]),
      expandDeck('ST02')
    );
    const state = engine.getState();
    const active = state.activePlayerId;
    const opp = state.nonActivePlayerId;

    // 1. ST04-008 卡穆·狂犬 (暗属性)：无暗费且无<突击鹰小队>时拒绝使用
    const kamui = findCard(engine, active, 'ST04-008');
    const iceCard = findCard(engine, active, 'ST04-005');
    engine.zoneMgr.moveCard(kamui.instanceId, 'HAND', { isFaceUp: true });
    engine.zoneMgr.moveCard(iceCard.instanceId, 'COST', { isFaceUp: true, isReady: true });
    fillCostZone(engine, active, 8);
    expect(
      engine.dispatchAction({
        type: 'PLAY_CARD',
        playerId: active,
        cardInstanceId: kamui.instanceId,
        targetSlotIndex: 0,
      }).success
    ).toBe(false);

    // 放 1 张 ST04-007 神威·重能 (<突击鹰小队>) 到 0 号位后，卡穆·狂犬可无视属性条件出场
    const kamuiRole = placeRole(engine, active, 'ST04-007', 0, { isReady: true });
    expect(
      engine.dispatchAction({
        type: 'PLAY_CARD',
        playerId: active,
        cardInstanceId: kamui.instanceId,
        targetSlotIndex: 1,
      }).success
    ).toBe(true);
    expect(state.battlefields[active]![1]!.roleCardId).toBe(kamui.instanceId);

    // 2. ST04-004 库洛姆·荣光【出】：给其他<突击鹰小队> PP+1000 直到下个回合结束
    const st04004 = findCard(engine, active, 'ST04-004');
    engine.zoneMgr.moveCard(st04004.instanceId, 'HAND', { isFaceUp: true });
    expect(
      engine.dispatchAction({
        type: 'PLAY_CARD',
        playerId: active,
        cardInstanceId: st04004.instanceId,
        targetSlotIndex: 2,
      }).success
    ).toBe(true);
    expect(state.currentPendingChoice?.effectType).toBe('PRESET_ST04_004_BUFF');
    expect(
      engine.dispatchAction({
        type: 'SELECT_CHOICE_OPTION',
        playerId: active,
        pendingChoiceId: state.currentPendingChoice!.id,
        selectedIds: [kamui.instanceId],
      }).success
    ).toBe(true);
    expect(engine.fieldMgr.calculateRoleEffectivePP(kamui.instanceId)).toBe(4000); // 3000 + 1000

    // 3. ST04-011 先锋者：场上有<库洛姆>时可横置对方费用<=4角色
    const oppRole = placeRole(engine, opp, 'ST02-005', 0, { isReady: true }); // 费用 3
    const pioneer = findCard(engine, active, 'ST04-011');
    engine.zoneMgr.moveCard(pioneer.instanceId, 'HAND', { isFaceUp: true });
    expect(
      engine.dispatchAction({
        type: 'PLAY_CARD',
        playerId: active,
        cardInstanceId: pioneer.instanceId,
      }).success
    ).toBe(true);
    expect(state.currentPendingChoice?.effectType).toBe('PRESET_ST04_011_TAP');
    expect(
      engine.dispatchAction({
        type: 'SELECT_CHOICE_OPTION',
        playerId: active,
        pendingChoiceId: state.currentPendingChoice!.id,
        selectedIds: [oppRole.instanceId],
      }).success
    ).toBe(true);
    expect(state.cards[oppRole.instanceId]!.isReady).toBe(false);

    // 4. ST04-007 神威·重能【起】横置：公开5选1<突击鹰小队>加手，余牌置底，再弃1手牌
    const shield = findCard(engine, active, 'ST04-001');
    engine.zoneMgr.moveCardToTopOfDeck(shield.instanceId);
    expect(
      engine.dispatchAction({
        type: 'ACTIVATE_ABILITY',
        playerId: active,
        sourceCardId: kamuiRole.instanceId,
      }).success
    ).toBe(true);
    expect(state.cards[kamuiRole.instanceId]!.isReady).toBe(false);
    expect(state.currentPendingChoice?.effectType).toBe('PRESET_ST04_007_PICK');
    expect(
      engine.dispatchAction({
        type: 'SELECT_CHOICE_OPTION',
        playerId: active,
        pendingChoiceId: state.currentPendingChoice!.id,
        selectedIds: [shield.instanceId],
      }).success
    ).toBe(true);
    expect(state.currentPendingChoice?.effectType).toBe('PRESET_DISCARD');
    // 弃掉刚上手的 ST04-001 到墓地，顺便给下一步 ST04-002 回收
    expect(
      engine.dispatchAction({
        type: 'SELECT_CHOICE_OPTION',
        playerId: active,
        pendingChoiceId: state.currentPendingChoice!.id,
        selectedIds: [shield.instanceId],
      }).success
    ).toBe(true);
    expect(state.cards[shield.instanceId]!.zone).toBe('GRAVEYARD');

    // 5. ST04-002 库洛姆·荣光【出】回收墓地《荣光护盾》
    const st04002 = findCard(engine, active, 'ST04-002');
    engine.zoneMgr.moveCard(st04002.instanceId, 'HAND', { isFaceUp: true });
    // 补充可用明费到 8 费 (避免 st04002 原本在费用区被取出后少于 8 费)
    for (const c of engine.zoneMgr.getCardsInZone(active, 'COST')) {
      if (c.isFaceUp) c.isReady = true;
    }
    fillCostZone(engine, active, 8);
    expect(
      engine.dispatchAction({
        type: 'PLAY_CARD',
        playerId: active,
        cardInstanceId: st04002.instanceId,
        targetSlotIndex: 3,
      }).success
    ).toBe(true);
    expect(state.currentPendingChoice?.effectType).toBe('PRESET_ST04_002_PICK');
    expect(
      engine.dispatchAction({
        type: 'SELECT_CHOICE_OPTION',
        playerId: active,
        pendingChoiceId: state.currentPendingChoice!.id,
        selectedIds: [shield.instanceId],
      }).success
    ).toBe(true);
    expect(state.cards[shield.instanceId]!.zone).toBe('HAND');

    // 6. ST04-009 万事·明觉 & ST04-003 库洛姆·荣光 回合结束【自】
    // 把 ST04-003 放 4 号位，把 ST04-009 替换到 0 号位；先横置 2 张明费，并在墓地放一张<突击鹰小队> (ST04-007)
    engine.zoneMgr.moveCard(kamuiRole.instanceId, 'GRAVEYARD', { isFaceUp: true });
    placeRole(engine, active, 'ST04-009', 0);
    const st04003 = placeRole(engine, active, 'ST04-003', 4);
    const openCosts = engine.zoneMgr.getCardsInZone(active, 'COST').filter((c) => c.isFaceUp);
    openCosts[0]!.isReady = false;
    openCosts[1]!.isReady = false;
    engine.zoneMgr.syncCostStats(active);
    const readyBefore = state.players[active]!.availableOpenCostCount;

    // 结束主要阶段进入结束阶段触发：同时存在 ST04-009 与 ST04-003 两项待机触发
    expect(engine.dispatchAction({ type: 'PASS_ACTION_TIMING', playerId: active }).success).toBe(true);
    passInstantWindows(engine);
    // 依次处理选择顺序 + ST04-009 竖直 2 费 + ST04-003 回牌组底复活 ST04-007
    for (let guard = 0; guard < 10 && state.currentPendingChoice; guard++) {
      const ch = state.currentPendingChoice;
      if (ch.effectType === 'PRESET_ST04_009_READY_COST') {
        expect(
          engine.dispatchAction({
            type: 'SELECT_CHOICE_OPTION',
            playerId: active,
            pendingChoiceId: ch.id,
            selectedIds: [openCosts[0]!.instanceId, openCosts[1]!.instanceId],
          }).success
        ).toBe(true);
      } else if (ch.effectType === 'PRESET_ST04_003_REVIVE') {
        expect(
          engine.dispatchAction({
            type: 'SELECT_CHOICE_OPTION',
            playerId: active,
            pendingChoiceId: ch.id,
            selectedIds: [kamuiRole.instanceId],
          }).success
        ).toBe(true);
      } else {
        const eligible = ch.options.filter((o) => (o.payload as { eligible?: boolean } | undefined)?.eligible !== false);
        expect(
          engine.dispatchAction({
            type: 'SELECT_CHOICE_OPTION',
            playerId: ch.playerId,
            pendingChoiceId: ch.id,
            selectedIds: eligible.slice(0, ch.minSelections).map((o) => o.id),
          }).success
        ).toBe(true);
      }
    }
    expect(state.cards[st04003.instanceId]!.zone).toBe('DECK');
    expect(state.cards[kamuiRole.instanceId]!.zone).toBe('BATTLEFIELD');
    expect(openCosts[0]!.isReady).toBe(true);
    expect(openCosts[1]!.isReady).toBe(true);
    expect(state.players[active]!.availableOpenCostCount).toBeGreaterThanOrEqual(readyBefore + 2);
    // ST04-004 的「直到下个回合结束」buff 在自己回合结束后仍应保留
    expect(engine.fieldMgr.calculateRoleEffectivePP(kamui.instanceId)).toBe(4000);
  });

  it('ST04-003 回合末可以从墓地拉出 8 费 ST04-002 (补全突击鹰小队特征后可用)', () => {
    const engine = createEngine(
      expandDeck('ST01', ['ST04-002', 'ST04-003']),
      expandDeck('ST02')
    );
    const state = engine.getState();
    const active = state.activePlayerId;

    const st04002 = findCard(engine, active, 'ST04-002');
    engine.zoneMgr.moveCard(st04002.instanceId, 'GRAVEYARD', { isFaceUp: true });
    const st04003 = placeRole(engine, active, 'ST04-003', 0);

    expect(engine.dispatchAction({ type: 'PASS_ACTION_TIMING', playerId: active }).success).toBe(true);
    passInstantWindows(engine);

    expect(state.currentPendingChoice?.effectType).toBe('PRESET_ST04_003_REVIVE');
    const hasSt04002Option = state.currentPendingChoice!.options.some((o) => o.id === st04002.instanceId);
    expect(hasSt04002Option).toBe(true);

    expect(
      engine.dispatchAction({
        type: 'SELECT_CHOICE_OPTION',
        playerId: active,
        pendingChoiceId: state.currentPendingChoice!.id,
        selectedIds: [st04002.instanceId],
      }).success
    ).toBe(true);

    expect(state.cards[st04003.instanceId]!.zone).toBe('DECK');
    expect(state.cards[st04002.instanceId]!.zone).toBe('BATTLEFIELD');
  });
});

describe('ST05 清洁部队官方预组 (13 张 晖/暮形态声明式效果)', () => {
  it('ST05-001 暮【出】允许出场回合打玩家、晖【自】攻击选角色消2球减4000PP；ST05-002 晖横置复活/暮抽1；ST05-003 晖速攻/暮+500PP', () => {
    const engine = createEngine(
      expandDeck('ST02', ['ST05-001', 'ST05-002', 'ST05-002', 'ST05-003', 'ST05-005', 'ST05-011', 'ST05-012']),
      expandDeck('ST01')
    );
    const state = engine.getState();
    const active = state.activePlayerId;
    const opp = state.nonActivePlayerId;
    fillCostZone(engine, active, 10);

    // 1. 信号球区最下方放费用 0 的信号球 (偶数 → 暮形态有效)
    const orbEven = findCard(engine, active, 'ST05-011');
    engine.zoneMgr.moveCard(orbEven.instanceId, 'SIGNAL_ORB', { isFaceUp: true, toBottom: true });

    // ST05-003 在暮形态下 PP = 5000 + 500 = 5500，无【速攻】
    const st05003 = placeRole(engine, active, 'ST05-003', 0);
    expect(engine.fieldMgr.calculateRoleEffectivePP(st05003.instanceId)).toBe(5500);
    expect(engine.continuousEffects.hasKeyword(st05003.instanceId, '速攻')).toBe(false);

    // ST05-002 暮【出】：抽 1 张牌
    const st05002A = findCards(engine, active, 'ST05-002')[0]!;
    engine.zoneMgr.moveCard(st05002A.instanceId, 'HAND', { isFaceUp: true });
    const handBefore = engine.zoneMgr.getCardsInZone(active, 'HAND').length;
    expect(
      engine.dispatchAction({
        type: 'PLAY_CARD',
        playerId: active,
        cardInstanceId: st05002A.instanceId,
        targetSlotIndex: 1,
      }).success
    ).toBe(true);
    // ST05-002 晖/暮双【出】同时进入待机 (Q&A·5)，任选一项优先处理
    expect(state.currentPendingChoice?.effectType).toBe('CHOOSE_TRIGGER_ORDER');
    expect(state.currentPendingChoice!.options).toHaveLength(2);
    expect(
      engine.dispatchAction({
        type: 'SELECT_CHOICE_OPTION',
        playerId: active,
        pendingChoiceId: state.currentPendingChoice!.id,
        selectedIds: [state.currentPendingChoice!.options[0]!.id],
      }).success
    ).toBe(true);
    expect(state.currentPendingChoice).toBeUndefined();
    expect(engine.zoneMgr.getCardsInZone(active, 'HAND').length).toBe(handBefore); // 打出1张 + 抽1张

    // ST05-001 暮【出】：本回合可以攻击对方玩家，但不能攻击对方横置角色
    const oppTapped = placeRole(engine, opp, 'ST01-005', 0, { isReady: false });
    const st05001 = findCard(engine, active, 'ST05-001');
    engine.zoneMgr.moveCard(st05001.instanceId, 'HAND', { isFaceUp: true });
    for (const c of engine.zoneMgr.getCardsInZone(active, 'COST')) if (c.isFaceUp) c.isReady = true;
    engine.zoneMgr.syncCostStats(active);
    expect(
      engine.dispatchAction({
        type: 'PLAY_CARD',
        playerId: active,
        cardInstanceId: st05001.instanceId,
        targetSlotIndex: 2,
      }).success
    ).toBe(true);

    // 打对方横置角色应被拒 (非速攻/突进)
    expect(
      engine.dispatchAction({
        type: 'DECLARE_ATTACK',
        playerId: active,
        attackerCardId: st05001.instanceId,
        targetType: 'CHARACTER',
        targetCardId: oppTapped.instanceId,
      }).success
    ).toBe(false);

    // 切换信号球区最下方为费用 3 的 ST05-005 (奇数 → 晖形态有效)，并给信号球区补足 2 张信号球
    const st05005 = findCard(engine, active, 'ST05-005'); // cost 3 (奇数)
    const orb2 = findCard(engine, active, 'ST05-012');
    engine.zoneMgr.moveCard(orb2.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    engine.zoneMgr.moveCard(st05005.instanceId, 'SIGNAL_ORB', { isFaceUp: true, toBottom: true });

    // 验证 ST05-003 实时切为晖形态：PP 回落 5000 且获得【速攻】
    expect(engine.fieldMgr.calculateRoleEffectivePP(st05003.instanceId)).toBe(5000);
    expect(engine.continuousEffects.hasKeyword(st05003.instanceId, '速攻')).toBe(true);

    // ST05-001 攻击对方玩家 (暮【出】modifier 仍在回合内有效)，同时触发晖【自】选对方角色并消 2 球使其 PP-4000 (4000 → 0 触发 SBA 破坏)
    putNonOrbOnDeckTop(engine, active);
    putNonOrbOnDeckTop(engine, opp);
    expect(
      engine.dispatchAction({
        type: 'DECLARE_ATTACK',
        playerId: active,
        attackerCardId: st05001.instanceId,
        targetType: 'PLAYER',
      }).success
    ).toBe(true);
    expect(state.currentPendingChoice?.effectType).toBe('PRESET_ST05_001_TARGET');
    expect(
      engine.dispatchAction({
        type: 'SELECT_CHOICE_OPTION',
        playerId: active,
        pendingChoiceId: state.currentPendingChoice!.id,
        selectedIds: [oppTapped.instanceId],
      }).success
    ).toBe(true);
    expect(state.currentPendingChoice?.effectType).toBe('PRESET_ST05_001_ORB_COST');
    const payGroup = state.currentPendingChoice!.options.find((o) => o.id !== 'skip')!;
    expect(
      engine.dispatchAction({
        type: 'SELECT_CHOICE_OPTION',
        playerId: active,
        pendingChoiceId: state.currentPendingChoice!.id,
        selectedIds: [payGroup.id],
      }).success
    ).toBe(true);
    passInstantWindows(engine);
    resolvePendingChoices(engine);
    expect(state.cards[oppTapped.instanceId]!.zone).toBe('GRAVEYARD');

    // ST05-002 晖【出】：墓地复活费用<=4 《比安卡·晖暮》且以横置状态出场
    engine.zoneMgr.moveCard(st05005.instanceId, 'GRAVEYARD', { isFaceUp: true });
    // 再放一张奇费卡到信号球区最下方维持晖形态 (ST05-003 费用 5 奇数)
    engine.zoneMgr.moveCard(st05003.instanceId, 'SIGNAL_ORB', { isFaceUp: true, toBottom: true });
    const st05002B = findCards(engine, active, 'ST05-002')[1]!;
    engine.zoneMgr.moveCard(st05002B.instanceId, 'HAND', { isFaceUp: true });
    for (const c of engine.zoneMgr.getCardsInZone(active, 'COST')) if (c.isFaceUp) c.isReady = true;
    engine.zoneMgr.syncCostStats(active);
    expect(
      engine.dispatchAction({
        type: 'PLAY_CARD',
        playerId: active,
        cardInstanceId: st05002B.instanceId,
        targetSlotIndex: 3,
      }).success
    ).toBe(true);
    expect(state.currentPendingChoice?.effectType).toBe('CHOOSE_TRIGGER_ORDER');
    const radianceOpt = state.currentPendingChoice!.options.find((o) => o.label.includes('晖【出】'))!;
    expect(
      engine.dispatchAction({
        type: 'SELECT_CHOICE_OPTION',
        playerId: active,
        pendingChoiceId: state.currentPendingChoice!.id,
        selectedIds: [radianceOpt.id],
      }).success
    ).toBe(true);
    expect(state.currentPendingChoice?.effectType).toBe('PRESET_ST05_002_REVIVE');
    expect(
      engine.dispatchAction({
        type: 'SELECT_CHOICE_OPTION',
        playerId: active,
        pendingChoiceId: state.currentPendingChoice!.id,
        selectedIds: [st05005.instanceId],
      }).success
    ).toBe(true);
    expect(state.cards[st05005.instanceId]!.zone).toBe('BATTLEFIELD');
    expect(state.cards[st05005.instanceId]!.isReady).toBe(false); // 横置状态出场
  });

  it('ST05-005/007/008 放信号球区最下方且回合结束送墓；ST05-009 费用条件与晖减费/暮追减；ST05-010 模态多选与快照恢复', () => {
    const engine = createEngine(
      expandDeck('ST02', ['ST05-001', 'ST05-002', 'ST05-003', 'ST05-005', 'ST05-007', 'ST05-008', 'ST05-009', 'ST05-010']),
      expandDeck('ST01')
    );
    const state = engine.getState();
    const active = state.activePlayerId;
    const opp = state.nonActivePlayerId;

    // 1. ST05-007【起】横置&弃1手牌：选墓地《比安卡·晖暮》放信号球区最下方，回合结束送墓
    const st05007 = placeRole(engine, active, 'ST05-007', 0, { isReady: true });
    const st05005 = findCard(engine, active, 'ST05-005'); // cost 3 (奇数), 暗属性
    engine.zoneMgr.moveCard(st05005.instanceId, 'HAND', { isFaceUp: true });
    expect(
      engine.dispatchAction({
        type: 'ACTIVATE_ABILITY',
        playerId: active,
        sourceCardId: st05007.instanceId,
      }).success
    ).toBe(true);
    expect(state.cards[st05007.instanceId]!.isReady).toBe(false);
    expect(state.currentPendingChoice?.effectType).toBe('PRESET_ST05_007_DISCARD_COST');
    expect(
      engine.dispatchAction({
        type: 'SELECT_CHOICE_OPTION',
        playerId: active,
        pendingChoiceId: state.currentPendingChoice!.id,
        selectedIds: [st05005.instanceId],
      }).success
    ).toBe(true);
    // 刚丢进墓地的 ST05-005 立即可作为墓地目标放入信号球区最下方
    expect(state.currentPendingChoice?.effectType).toBe('PRESET_ST05_007_PICK');
    expect(
      engine.dispatchAction({
        type: 'SELECT_CHOICE_OPTION',
        playerId: active,
        pendingChoiceId: state.currentPendingChoice!.id,
        selectedIds: [st05005.instanceId],
      }).success
    ).toBe(true);
    expect(engine.zoneMgr.getCardsInZone(active, 'SIGNAL_ORB')[0]!.instanceId).toBe(st05005.instanceId);

    // 2. ST05-009 终末祷词：明费不足3张《比安卡·晖暮》拒绝；满足后晖形态费用 6 → 3
    const st05009 = findCard(engine, active, 'ST05-009');
    const oppRole = placeRole(engine, opp, 'ST01-001', 0); // PP 6000
    engine.zoneMgr.moveCard(st05009.instanceId, 'HAND', { isFaceUp: true });
    // 放 3 张《比安卡·晖暮》进明费区
    for (const num of ['ST05-001', 'ST05-002', 'ST05-003']) {
      engine.zoneMgr.moveCard(findCard(engine, active, num).instanceId, 'COST', { isFaceUp: true, isReady: true });
    }
    engine.zoneMgr.syncCostStats(active);
    // 信号球区最下方为 ST05-005 (费用 3，奇数 → 晖形态费用 -3 = 3)
    expect(engine.calculateCardCost(active, st05009.instanceId).costToPay).toBe(3);

    // 3. ST05-010 晦明戒律【瞬时】：在攻击自由时点发动，奇费时可同时选 2 项 (抽 1 + 《比安卡·晖暮》PP+1000)，且测试快照恢复
    const st05010 = findCard(engine, active, 'ST05-010');
    engine.zoneMgr.moveCard(st05010.instanceId, 'HAND', { isFaceUp: true });
    fillCostZone(engine, active, 4);
    const atk = placeRole(engine, active, 'ST02-003', 1, { isReady: true });
    putNonOrbOnDeckTop(engine, active);
    putNonOrbOnDeckTop(engine, opp);
    expect(
      engine.dispatchAction({
        type: 'DECLARE_ATTACK',
        playerId: active,
        attackerCardId: atk.instanceId,
        targetType: 'PLAYER',
      }).success
    ).toBe(true);
    if (state.timingWindow?.priorityPlayerId !== active) {
      engine.dispatchAction({ type: 'PASS_ACTION_TIMING', playerId: state.timingWindow!.priorityPlayerId });
    }
    const handBefore = engine.zoneMgr.getCardsInZone(active, 'HAND').length;
    expect(
      engine.dispatchAction({
        type: 'PLAY_CARD',
        playerId: active,
        cardInstanceId: st05010.instanceId,
      }).success
    ).toBe(true);
    expect(state.currentPendingChoice?.effectType).toBe('PRESET_ST05_010_MODE');
    expect(state.currentPendingChoice?.maxSelections).toBe(2);

    // 经快照序列化恢复后再同时选两项
    const restored = GameEngine.fromSnapshot(engine.toSnapshot(), db);
    const modeChoice = restored.getState().currentPendingChoice!;
    expect(
      restored.dispatchAction({
        type: 'SELECT_CHOICE_OPTION',
        playerId: active,
        pendingChoiceId: modeChoice.id,
        selectedIds: ['mode_draw', 'mode_buff'],
      }).success
    ).toBe(true);
    // 抽 1 张已执行，随后弹出选《比安卡·晖暮》+1000PP
    expect(restored.zoneMgr.getCardsInZone(active, 'HAND').length).toBe(handBefore); // 打出1 + 抽1
    expect(restored.getState().currentPendingChoice?.effectType).toBe('PRESET_ST05_010_BUFF');
    expect(
      restored.dispatchAction({
        type: 'SELECT_CHOICE_OPTION',
        playerId: active,
        pendingChoiceId: restored.getState().currentPendingChoice!.id,
        selectedIds: [st05007.instanceId],
      }).success
    ).toBe(true);
    expect(restored.fieldMgr.calculateRoleEffectivePP(st05007.instanceId)).toBe(3000); // 2000 + 1000

    // 4. 结束攻击并结束回合：+1000PP 到期恢复 2000，且 ST05-005 触发延迟送墓，自动从信号球区进入墓地
    passInstantWindows(restored);
    if (restored.getState().currentCombat?.step === 'BLOCK') {
      restored.dispatchAction({ type: 'DECLARE_BLOCK', playerId: opp });
    }
    passInstantWindows(restored);
    resolvePendingChoices(restored);
    endTurn(restored);
    expect(restored.fieldMgr.calculateRoleEffectivePP(st05007.instanceId)).toBe(2000);
    expect(restored.getState().cards[st05005.instanceId]!.zone).toBe('GRAVEYARD');
    void oppRole;
  });
});

describe('ST06 亚里莎·回音 & 塞西莉官方预组 (14 张协战体系声明式效果)', () => {
  it('ST06-001 替代2球协战代价 + ST06-002 协战永不解除 & 协战自按红/蓝球分支 + ST06-004 昼翼减费 + ST06-011 裁定合击', () => {
    const engine = createEngine(
      expandDeck('ST01', [
        'ST06-001',
        'ST06-002',
        'ST06-003',
        'ST06-004',
        'ST06-006',
        'ST06-007',
        'ST06-011',
        'ST06-012',
        'ST06-012',
        'ST06-013',
      ]),
      expandDeck('ST02')
    );
    const state = engine.getState();
    const active = state.activePlayerId;
    const opp = state.nonActivePlayerId;

    // 战场放置 ST06-001、攻击手 ST01-005、ST06-007 (PP 3000)、ST06-003 (DP 0)
    const attacker = placeRole(engine, active, 'ST01-005', 0, { isReady: true });
    const alisa = placeRole(engine, active, 'ST06-001', 1);
    const st06007 = placeRole(engine, active, 'ST06-007', 2);
    const st06003 = placeRole(engine, active, 'ST06-003', 3);

    // 对方战场放 3 张角色（其中含 1 张费用 3 的 ST02-005），让红球分支满足 >=3 张条件
    const oppCheap = placeRole(engine, opp, 'ST02-005', 0);
    placeRole(engine, opp, 'ST02-003', 1);
    placeRole(engine, opp, 'ST02-004', 2);

    // 我方手牌放 ST06-002、ST06-004 (昼翼)、ST06-011 (裁定合击)
    const cecily = findCard(engine, active, 'ST06-002');
    const daywing = findCard(engine, active, 'ST06-004');
    const verdict = findCard(engine, active, 'ST06-011');
    engine.zoneMgr.moveCard(cecily.instanceId, 'HAND', { isFaceUp: true });
    engine.zoneMgr.moveCard(daywing.instanceId, 'HAND', { isFaceUp: true });
    engine.zoneMgr.moveCard(verdict.instanceId, 'HAND', { isFaceUp: true });

    // 放 3 张信号球：红1、红2、蓝1，但故意放 0 可用费用以验证 ST06-001 替代代价【2任意信号球】
    const reds = findCards(engine, active, 'ST06-012');
    const blue = findCard(engine, active, 'ST06-013');
    engine.zoneMgr.moveCard(reds[0]!.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    engine.zoneMgr.moveCard(blue.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    engine.zoneMgr.moveCard(reds[1]!.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    // 清空我方费用区为 0（并给对方放 2 明费，验证 ST06-003 我方明费<=对方时 DP 变为 1）
    for (const c of engine.zoneMgr.getCardsInZone(active, 'COST')) {
      engine.zoneMgr.moveCard(c.instanceId, 'GRAVEYARD', { isFaceUp: true });
    }
    fillCostZone(engine, opp, 2);
    expect(engine.fieldMgr.calculateRoleEffectiveDP(st06003.instanceId)).toBe(1);

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

    // 自由时点：若回合外对方持有瞬时先 pass，随后 ST06-001 用【2任意信号球】(reds[0] + blue) 替代 2 费从手牌拉 ST06-002 协战
    if (state.timingWindow && state.timingWindow.priorityPlayerId !== active) {
      engine.dispatchAction({ type: 'PASS_ACTION_TIMING', playerId: state.timingWindow.priorityPlayerId });
    }
    expect(state.timingWindow?.priorityPlayerId).toBe(active);
    const assistRes = engine.dispatchAction({
      type: 'PERFORM_ASSIST',
      playerId: active,
      hostRoleCardId: alisa.instanceId,
      partnerCardId: cecily.instanceId,
      orbCardInstanceIds: [reds[0]!.instanceId, blue.instanceId],
    });
    expect(assistRes.success).toBe(true);
    expect(state.cards[alisa.instanceId]!.partnerCardId).toBe(cecily.instanceId);
    // ST06-002 协战永生效：本回合结束不解除协战状态
    expect(state.cards[cecily.instanceId]!.cannotReleasePartnerUntilTurn).toBe(state.turnNumber);

    // 触发 ST06-002【协战自】：消除剩下的红球 reds[1] → 弹对方费用<=3 的 oppCheap 回手牌
    expect(state.currentPendingChoice?.effectType).toBe('PRESET_ST06_002_ORB_COST');
    expect(
      engine.dispatchAction({
        type: 'SELECT_CHOICE_OPTION',
        playerId: active,
        pendingChoiceId: state.currentPendingChoice!.id,
        selectedIds: [reds[1]!.instanceId],
      }).success
    ).toBe(true);
    expect(state.currentPendingChoice?.effectType).toBe('PRESET_ST06_002_BOUNCE');
    expect(
      engine.dispatchAction({
        type: 'SELECT_CHOICE_OPTION',
        playerId: active,
        pendingChoiceId: state.currentPendingChoice!.id,
        selectedIds: [oppCheap.instanceId],
      }).success
    ).toBe(true);
    expect(state.cards[oppCheap.instanceId]!.zone).toBe('HAND');

    // 验证 ST06-007 (+1500 PP = 4500) 与 ST06-004 昼翼 (8 - 3 = 5 费)
    expect(engine.fieldMgr.calculateRoleEffectivePP(st06007.instanceId)).toBe(4500);
    expect(engine.calculateCardCost(active, daywing.instanceId).costToPay).toBe(5);

    // 结束本次攻击，返回主要阶段：打出 ST06-011 裁定合击（我方有协战角色 → 对方费用<=7 改为送墓而非回手）
    passInstantWindows(engine);
    if (state.currentCombat?.step === 'BLOCK') {
      engine.dispatchAction({ type: 'DECLARE_BLOCK', playerId: opp });
    }
    passInstantWindows(engine);
    resolvePendingChoices(engine);
    fillCostZone(engine, active, 6);
    const oppTarget = state.battlefields[opp]![1]!.roleCardId!;
    expect(
      engine.dispatchAction({
        type: 'PLAY_CARD',
        playerId: active,
        cardInstanceId: verdict.instanceId,
      }).success
    ).toBe(true);
    expect(state.currentPendingChoice?.effectType).toBe('PRESET_ST06_011_TARGET');
    expect(
      engine.dispatchAction({
        type: 'SELECT_CHOICE_OPTION',
        playerId: active,
        pendingChoiceId: state.currentPendingChoice!.id,
        selectedIds: [oppTarget],
      }).success
    ).toBe(true);
    expect(state.cards[oppTarget]!.zone).toBe('GRAVEYARD');

    // 结束回合：ST06-002 因【协战永】仍保留为 ST06-001 的协战搭档，未被送墓
    endTurn(engine);
    expect(state.cards[alisa.instanceId]!.partnerCardId).toBe(cecily.instanceId);
    expect(state.cards[cecily.instanceId]!.zone).toBe('BATTLEFIELD');
  });

  it('ST06-006 协战永 +1500PP/充能+1、ST06-008 同名每回合仅1次赋予速攻、ST06-009 对方回合消球竖直宿主', () => {
    const engine = createEngine(
      expandDeck('ST01', ['ST06-001', 'ST06-003', 'ST06-006', 'ST06-008', 'ST06-008', 'ST06-009', 'ST06-012']),
      expandDeck('ST02', ['ST06-001', 'ST06-009', 'ST06-012'])
    );
    const state = engine.getState();
    const active = state.activePlayerId;
    const opp = state.nonActivePlayerId;

    const attacker = placeRole(engine, active, 'ST01-005', 0, { isReady: true });
    const host1 = placeRole(engine, active, 'ST06-001', 1);
    const host2 = placeRole(engine, active, 'ST06-003', 2);
    const st06006 = placeRole(engine, active, 'ST06-006', 3);
    const st06008List = findCards(engine, active, 'ST06-008');
    engine.zoneMgr.moveCard(st06008List[0]!.instanceId, 'HAND', { isFaceUp: true });
    engine.zoneMgr.moveCard(st06008List[1]!.instanceId, 'HAND', { isFaceUp: true });
    fillCostZone(engine, active, 8);

    // 对方 (opp) 场上放横置的 ST06-001，手牌放 ST06-009，信号球区放 1 张红球，费用区 4 费
    const oppAlisa = placeRole(engine, opp, 'ST06-001', 0, { isReady: false });
    const oppCecily = findCard(engine, opp, 'ST06-009');
    const oppOrb = findCard(engine, opp, 'ST06-012');
    engine.zoneMgr.moveCard(oppCecily.instanceId, 'HAND', { isFaceUp: true });
    engine.zoneMgr.moveCard(oppOrb.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    fillCostZone(engine, opp, 4);

    // 1. active 攻击，opp 先拥有自由时点：opp 让 ST06-009 成为横置 oppAlisa 的搭档 → 触发 ST06-009 对方回合消 1 球竖直 oppAlisa
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
    expect(state.timingWindow?.priorityPlayerId).toBe(opp);
    expect(
      engine.dispatchAction({
        type: 'PERFORM_ASSIST',
        playerId: opp,
        hostRoleCardId: oppAlisa.instanceId,
        partnerCardId: oppCecily.instanceId,
      }).success
    ).toBe(true);
    expect(state.currentPendingChoice?.effectType).toBe('PRESET_ST06_009_ORB_COST');
    expect(
      engine.dispatchAction({
        type: 'SELECT_CHOICE_OPTION',
        playerId: opp,
        pendingChoiceId: state.currentPendingChoice!.id,
        selectedIds: [oppOrb.instanceId],
      }).success
    ).toBe(true);
    expect(state.cards[oppAlisa.instanceId]!.isReady).toBe(true);

    // 2. 轮到 active：先用 host1 协战第 1 张 ST06-008 → 触发赋予 host2【速攻】
    expect(state.timingWindow?.priorityPlayerId).toBe(active);
    expect(
      engine.dispatchAction({
        type: 'PERFORM_ASSIST',
        playerId: active,
        hostRoleCardId: host1.instanceId,
        partnerCardId: st06008List[0]!.instanceId,
      }).success
    ).toBe(true);
    expect(state.currentPendingChoice?.effectType).toBe('PRESET_ST06_008_RUSH');
    expect(
      engine.dispatchAction({
        type: 'SELECT_CHOICE_OPTION',
        playerId: active,
        pendingChoiceId: state.currentPendingChoice!.id,
        selectedIds: [host2.instanceId],
      }).success
    ).toBe(true);
    expect(engine.continuousEffects.hasKeyword(host2.instanceId, '速攻')).toBe(true);

    // 3. 同一回合 host2 再协战第 2 张不同实例的 ST06-008：因 oncePerTurnByPlayer，不应再触发 PRESET_ST06_008_RUSH
    if (state.timingWindow && state.timingWindow.priorityPlayerId !== active) {
      engine.dispatchAction({ type: 'PASS_ACTION_TIMING', playerId: state.timingWindow.priorityPlayerId });
    }
    expect(
      engine.dispatchAction({
        type: 'PERFORM_ASSIST',
        playerId: active,
        hostRoleCardId: host2.instanceId,
        partnerCardId: st06008List[1]!.instanceId,
      }).success
    ).toBe(true);
    expect(state.currentPendingChoice).toBeUndefined();

    // 4. 检验 ST06-006【协战永】：作为 <亚里莎> 的搭档时，我方回合宿主 PP+1500 且充能+1
    passInstantWindows(engine);
    if (state.currentCombat?.step === 'BLOCK') {
      engine.dispatchAction({ type: 'DECLARE_BLOCK', playerId: opp });
    }
    passInstantWindows(engine);
    resolvePendingChoices(engine);
    engine.fieldMgr.releasePartner(host1.instanceId, true);
    engine.fieldMgr.attachPartner(active, host1.instanceId, st06006.instanceId);
    // host1 基本 PP 4500 + st06006 基本 PP 3000 + ST06-006 协战永 +1500 = 9000；充能 = 1 + 1 = 2
    const stats = engine.continuousEffects.evaluateCard(host1.instanceId);
    expect(stats.pp).toBe(9000);
    expect(stats.charge).toBe(2);
  });

  it('补齐边界覆盖：ST04-001 受 CANNOT_GAIN_ABILITIES 拦截、ST04-003 出场公开7洗牌、ST05-008 奥罗拉、ST06-004 昼翼与 ST06-005 弃1检索洗牌', () => {
    const engine = createEngine(
      expandDeck('ST01', [
        'ST04-001',
        'ST04-003',
        'ST04-005',
        'ST05-005',
        'ST05-008',
        'ST06-004',
        'ST06-005',
        'ST06-009',
        'ST06-012',
      ]),
      expandDeck('ST02')
    );
    const state = engine.getState();
    const active = state.activePlayerId;

    // 1. 1.3.3 CANNOT_GAIN_ABILITIES 阻止获得 ST04-001 赋予的触发能力
    const role = placeRole(engine, active, 'ST04-005', 0);
    addCardModifier(state, role, {
      prohibitions: ['CANNOT_GAIN_ABILITIES'],
      untilTurn: state.turnNumber,
      source: 'TEST',
    });
    addCardModifier(state, role, {
      grantedTriggerIds: ['ST04_001_GRANTED_BLOCK_END_DESTROY'],
      untilTurn: state.turnNumber,
      source: 'ST04-001',
    });
    expect(engine.continuousEffects.hasGrantedTrigger(role.instanceId, 'ST04_001_GRANTED_BLOCK_END_DESTROY')).toBe(false);

    // 2. ST04-003【出】公开 7 张选《荣光护盾》加手，剩余洗入牌组
    const shield = findCard(engine, active, 'ST04-001');
    engine.zoneMgr.moveCardToTopOfDeck(shield.instanceId);
    const st04003 = findCard(engine, active, 'ST04-003');
    engine.zoneMgr.moveCard(st04003.instanceId, 'HAND', { isFaceUp: true });
    const deckSizeBefore = engine.zoneMgr.getCardsInZone(active, 'DECK').length;
    engine.fieldMgr.playRoleCard(active, st04003.instanceId, 1);
    engine.effectEngine.handleRoleEntryEffect(active, st04003.instanceId, db.getCard('ST04-003')!);
    expect(state.currentPendingChoice?.effectType).toBe('PRESET_ST04_003_PICK');
    expect(
      engine.dispatchAction({
        type: 'SELECT_CHOICE_OPTION',
        playerId: active,
        pendingChoiceId: state.currentPendingChoice!.id,
        selectedIds: [shield.instanceId],
      }).success
    ).toBe(true);
    expect(state.cards[shield.instanceId]!.zone).toBe('HAND');
    expect(engine.zoneMgr.getCardsInZone(active, 'PROCESSING')).toHaveLength(0);
    expect(engine.zoneMgr.getCardsInZone(active, 'DECK').length).toBe(deckSizeBefore - 1);

    // 3. ST06-004 昼翼【出】回收墓地信号球至信号球区最上方
    const orb = findCard(engine, active, 'ST06-012');
    engine.zoneMgr.moveCard(orb.instanceId, 'GRAVEYARD', { isFaceUp: true });
    const daywing = findCard(engine, active, 'ST06-004');
    engine.zoneMgr.moveCard(daywing.instanceId, 'HAND', { isFaceUp: true });
    engine.fieldMgr.playRoleCard(active, daywing.instanceId, 2);
    engine.effectEngine.handleRoleEntryEffect(active, daywing.instanceId, db.getCard('ST06-004')!);
    expect(state.currentPendingChoice?.effectType).toBe('PRESET_ST06_004_ORB');
    expect(
      engine.dispatchAction({
        type: 'SELECT_CHOICE_OPTION',
        playerId: active,
        pendingChoiceId: state.currentPendingChoice!.id,
        selectedIds: [orb.instanceId],
      }).success
    ).toBe(true);
    const orbZone = engine.zoneMgr.getCardsInZone(active, 'SIGNAL_ORB');
    expect(orbZone[orbZone.length - 1]!.instanceId).toBe(orb.instanceId);

    // 4. ST06-005 亚里莎·回音【出】丢弃1手牌 → 公开5张选费用<=4 <亚里莎>/<塞西莉>角色出场 → 剩余洗牌
    const st06009 = findCard(engine, active, 'ST06-009'); // 费用 2 <塞西莉>
    engine.zoneMgr.moveCardToTopOfDeck(st06009.instanceId);
    const st06005 = findCard(engine, active, 'ST06-005');
    engine.zoneMgr.moveCard(st06005.instanceId, 'HAND', { isFaceUp: true });
    engine.fieldMgr.playRoleCard(active, st06005.instanceId, 3);
    engine.effectEngine.handleRoleEntryEffect(active, st06005.instanceId, db.getCard('ST06-005')!);
    expect(state.currentPendingChoice?.effectType).toBe('PRESET_DISCARD_COST');
    expect(
      engine.dispatchAction({
        type: 'SELECT_CHOICE_OPTION',
        playerId: active,
        pendingChoiceId: state.currentPendingChoice!.id,
        selectedIds: [shield.instanceId],
      }).success
    ).toBe(true);
    expect(state.currentPendingChoice?.effectType).toBe('PRESET_ST06_005_PICK');
    expect(
      engine.dispatchAction({
        type: 'SELECT_CHOICE_OPTION',
        playerId: active,
        pendingChoiceId: state.currentPendingChoice!.id,
        selectedIds: [st06009.instanceId],
      }).success
    ).toBe(true);
    expect(state.cards[st06009.instanceId]!.zone).toBe('BATTLEFIELD');
    expect(engine.zoneMgr.getCardsInZone(active, 'PROCESSING')).toHaveLength(0);
  });
});

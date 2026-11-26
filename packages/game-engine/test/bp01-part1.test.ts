import { describe, it, expect } from 'vitest';
import { GameEngine, MemoryCardDatabase, OFFICIAL_CARDS_DATA } from '../src/index.js';
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

function createEngine(p1Deck: string[], p2Deck: string[], seed = 20261122): GameEngine {
  const engine = new GameEngine(
    'bp01-p1-test',
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
  const c = findCards(engine, playerId, cardNumber)[0];
  if (!c) throw new Error(`未找到玩家 ${playerId} 的卡牌 ${cardNumber}`);
  return c;
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
  if (options?.enteredEarlier !== false) card.turnEnteredZone = 0;
  if (options?.isReady !== undefined) card.isReady = options.isReady;
  return card;
}

function putNonOrbOnDeckTop(engine: GameEngine, playerId: string) {
  const nonOrb = engine.zoneMgr
    .getCardsInZone(playerId, 'DECK')
    .find((c) => !db.getCard(c.cardNumber)?.signalOrb && !db.getCard(c.cardNumber)?.rulesText.includes('充能自'));
  if (nonOrb) engine.zoneMgr.moveCardToTopOfDeck(nonOrb.instanceId);
}

describe('BP01 第一批：灰鸦小队 (BP01-001 ~ BP01-007)', () => {
  it('BP01-001 露西亚·鸦羽：墓地洗回10张<灰鸦小队>无视费用上限8升变 + 消2同色球公开5张多选费用合计<=6出场', () => {
    const engine = createEngine(
      expandDeck('ST01', ['BP01-001', 'BP01-004', 'BP01-005', 'BP01-006', 'BP01-078', 'BP01-079']),
      expandDeck('ST02')
    );
    const state = engine.getState();
    const active = state.activePlayerId;

    // 场上放升变对象 ST01-005 (<露西亚>, cost 3)；费用区仅放 4 张明费 (含 1 张冰属性 BP01-005，远低于费用上限 8)
    const targetLucia = placeRole(engine, active, 'ST01-005', 0);
    const iceCost = findCard(engine, active, 'BP01-005');
    const bp01001 = findCard(engine, active, 'BP01-001');
    const bp01004 = findCard(engine, active, 'BP01-004'); // cost 3 灰鸦小队
    const bp01006 = findCard(engine, active, 'BP01-006'); // cost 2 灰鸦小队
    const st01002 = findCard(engine, active, 'ST01-002'); // cost 4 灰鸦小队

    engine.zoneMgr.moveCard(bp01001.instanceId, 'HAND', { isFaceUp: true });
    engine.zoneMgr.moveCard(iceCost.instanceId, 'COST', { isFaceUp: true, isReady: true });
    fillCostZone(engine, active, 4);
    expect(state.players[active]!.totalCostCount).toBeLessThan(8);

    // 墓地先只有 0 张<灰鸦小队>时，升变被拒绝
    expect(
      engine.dispatchAction({
        type: 'PLAY_CARD',
        playerId: active,
        cardInstanceId: bp01001.instanceId,
        isAscension: true,
        targetAscensionCardId: targetLucia.instanceId,
      }).success
    ).toBe(false);

    // 放入 10 张<灰鸦小队>牌进入墓地，同时放 2 张红球至信号球区，并置顶 3 张灰鸦小队角色 (3费+2费=5<=6，若选3+4=7应被拒)
    const gyFodders = Object.values(state.cards)
      .filter(
        (c) =>
          c.controllerPlayerId === active &&
          c.zone === 'DECK' &&
          db.getCard(c.cardNumber)?.traits.includes('灰鸦小队') &&
          ![bp01004.instanceId, bp01006.instanceId, st01002.instanceId].includes(c.instanceId)
      )
      .slice(0, 10);
    expect(gyFodders.length).toBe(10);
    for (const c of gyFodders) engine.zoneMgr.moveCard(c.instanceId, 'GRAVEYARD', { isFaceUp: true });

    const r1 = findCard(engine, active, 'BP01-078');
    const r2 = findCard(engine, active, 'BP01-079');
    engine.zoneMgr.moveCard(r1.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    engine.zoneMgr.moveCard(r2.instanceId, 'SIGNAL_ORB', { isFaceUp: true });

    // 升变成功：自动洗回 10 张墓地<灰鸦小队>进牌组，然后弹出【出】消2同色信号球选择
    expect(
      engine.dispatchAction({
        type: 'PLAY_CARD',
        playerId: active,
        cardInstanceId: bp01001.instanceId,
        isAscension: true,
        targetAscensionCardId: targetLucia.instanceId,
      }).success
    ).toBe(true);
    expect(engine.zoneMgr.getCardsInZone(active, 'GRAVEYARD').length).toBe(0);
    expect(state.currentPendingChoice?.effectType).toBe('PRESET_BP01_001_ORB_COST');

    // 在选消球前把目标 3 张角色放牌组顶，验证公开 5 张后的多选费用合计校验
    engine.zoneMgr.moveCardToTopOfDeck(st01002.instanceId);
    engine.zoneMgr.moveCardToTopOfDeck(bp01006.instanceId);
    engine.zoneMgr.moveCardToTopOfDeck(bp01004.instanceId);

    const orbOpt = state.currentPendingChoice!.options.find((o) => o.id !== 'skip')!;
    expect(
      engine.dispatchAction({
        type: 'SELECT_CHOICE_OPTION',
        playerId: active,
        pendingChoiceId: state.currentPendingChoice!.id,
        selectedIds: [orbOpt.id],
      }).success
    ).toBe(true);
    expect(state.currentPendingChoice?.effectType).toBe('PRESET_BP01_001_PICK');

    // 选择 bp01004 (3费) + st01002 (4费) = 7 > 6 → 必须拒绝并回滚保持弹窗
    const overCost = engine.dispatchAction({
      type: 'SELECT_CHOICE_OPTION',
      playerId: active,
      pendingChoiceId: state.currentPendingChoice!.id,
      selectedIds: [bp01004.instanceId, st01002.instanceId],
    });
    expect(overCost.success).toBe(false);

    // 选择 bp01004 (3费) + bp01006 (2费) = 5 <= 6 → 成功出场，并按选定顺序将剩余 3 张牌置底！
    expect(
      engine.dispatchAction({
        type: 'SELECT_CHOICE_OPTION',
        playerId: active,
        pendingChoiceId: state.currentPendingChoice!.id,
        selectedIds: [bp01004.instanceId, bp01006.instanceId],
      }).success
    ).toBe(true);
    expect(state.currentPendingChoice?.effectType).toBe('DSL_ORDER_MOVE_BP01-001');
    const bp01001Order = state.currentPendingChoice!.options.map((o) => o.id).reverse();
    expect(
      engine.dispatchAction({
        type: 'SELECT_CHOICE_OPTION',
        playerId: active,
        pendingChoiceId: state.currentPendingChoice!.id,
        selectedIds: bp01001Order,
      }).success
    ).toBe(true);
    expect(
      engine.zoneMgr.getCardsInZone(active, 'DECK').slice(-3).map((c) => c.instanceId)
    ).toEqual(bp01001Order);
    expect(state.cards[bp01004.instanceId]!.zone).toBe('BATTLEFIELD');
    expect(state.cards[bp01006.instanceId]!.zone).toBe('BATTLEFIELD');
  });

  it('BP01-002 场上有<里>和<丽芙>手牌费用-3、BP01-004 弃1拿费用区回手、BP01-007 刹那冰华弃任意手牌按张数+1000PP', () => {
    const engine = createEngine(
      expandDeck('ST01', ['BP01-002', 'BP01-004', 'BP01-005', 'BP01-007']),
      expandDeck('ST02')
    );
    const state = engine.getState();
    const active = state.activePlayerId;

    // 场上放 <里> (ST01-002) 和 <丽芙> (ST01-003) → BP01-002 (原7费) 减为 4 费
    const lee = placeRole(engine, active, 'ST01-002', 0, { isReady: true });
    placeRole(engine, active, 'ST01-003', 1);
    const bp01002 = findCard(engine, active, 'BP01-002');
    engine.zoneMgr.moveCard(bp01002.instanceId, 'HAND', { isFaceUp: true });
    expect(engine.calculateCardCost(active, bp01002.instanceId).costToPay).toBe(4);

    // BP01-007 刹那冰华 (0费瞬时)：给 lee (PP 5000) +1500，再追加丢弃 2 张手牌 +2000 → 8500
    const iceCost = findCard(engine, active, 'BP01-005');
    const bp01007 = findCard(engine, active, 'BP01-007');
    engine.zoneMgr.moveCard(iceCost.instanceId, 'COST', { isFaceUp: true, isReady: true });
    engine.zoneMgr.moveCard(bp01007.instanceId, 'HAND', { isFaceUp: true });
    fillCostZone(engine, active, 4);

    putNonOrbOnDeckTop(engine, active);
    putNonOrbOnDeckTop(engine, state.nonActivePlayerId);
    expect(
      engine.dispatchAction({
        type: 'DECLARE_ATTACK',
        playerId: active,
        attackerCardId: lee.instanceId,
        targetType: 'PLAYER',
      }).success
    ).toBe(true);
    if (state.timingWindow && state.timingWindow.priorityPlayerId !== active) {
      engine.dispatchAction({ type: 'PASS_ACTION_TIMING', playerId: state.timingWindow.priorityPlayerId });
    }
    const basePP = engine.fieldMgr.calculateRoleEffectivePP(lee.instanceId);
    expect(
      engine.dispatchAction({
        type: 'PLAY_CARD',
        playerId: active,
        cardInstanceId: bp01007.instanceId,
      }).success
    ).toBe(true);
    expect(state.currentPendingChoice?.effectType).toBe('PRESET_BP01_007_TARGET');
    expect(
      engine.dispatchAction({
        type: 'SELECT_CHOICE_OPTION',
        playerId: active,
        pendingChoiceId: state.currentPendingChoice!.id,
        selectedIds: [lee.instanceId],
      }).success
    ).toBe(true);
    expect(state.currentPendingChoice?.effectType).toBe('PRESET_BP01_007_DISCARD');
    const discardIds = engine.zoneMgr.getCardsInZone(active, 'HAND').slice(0, 2).map((c) => c.instanceId);
    expect(discardIds.length).toBe(2);
    expect(
      engine.dispatchAction({
        type: 'SELECT_CHOICE_OPTION',
        playerId: active,
        pendingChoiceId: state.currentPendingChoice!.id,
        selectedIds: discardIds,
      }).success
    ).toBe(true);
    expect(engine.fieldMgr.calculateRoleEffectivePP(lee.instanceId)).toBe(basePP + 1500 + 2000);
  });
});

describe('BP01 第一批：升格者补充 (BP01-008 ~ BP01-013)', () => {
  it('BP01-008/009/011/012/013：侵蚀变动驱动冕饵抽1、沃托丢2角色回球、露娜全体+1000PP与终焉降临减侵蚀', () => {
    const engine = createEngine(
      expandDeck('ST02', ['BP01-008', 'BP01-009', 'BP01-011', 'BP01-012', 'BP01-013', 'BP01-084', 'BP01-085']),
      expandDeck('ST01')
    );
    const state = engine.getState();
    const active = state.activePlayerId;

    // 放 1 张物理明费以便使用物理装备 BP01-011 和辅助机 BP01-012
    const physCost = findCard(engine, active, 'BP01-012');
    engine.zoneMgr.moveCard(physCost.instanceId, 'COST', { isFaceUp: true, isReady: true });
    fillCostZone(engine, active, 8);

    // 1. BP01-009 露娜·银冕【出】：侵蚀<=3 时 +1 侵蚀抽 2 张，同时置 erosionChangedThisTurn = true
    state.players[active]!.erosionCount = 2;
    const bp01009 = findCard(engine, active, 'BP01-009');
    engine.zoneMgr.moveCard(bp01009.instanceId, 'HAND', { isFaceUp: true });
    const handBefore = engine.zoneMgr.getCardsInZone(active, 'HAND').length;
    expect(
      engine.dispatchAction({
        type: 'PLAY_CARD',
        playerId: active,
        cardInstanceId: bp01009.instanceId,
        targetSlotIndex: 0,
      }).success
    ).toBe(true);
    expect(state.currentPendingChoice?.effectType).toBe('PRESET_BP01_009_CONFIRM');
    expect(
      engine.dispatchAction({
        type: 'SELECT_CHOICE_OPTION',
        playerId: active,
        pendingChoiceId: state.currentPendingChoice!.id,
        selectedIds: ['opt_yes'],
      }).success
    ).toBe(true);
    expect(state.players[active]!.erosionCount).toBe(3);
    expect(state.players[active]!.erosionChangedThisTurn).toBe(true);
    expect(engine.zoneMgr.getCardsInZone(active, 'HAND').length).toBe(handBefore + 1); // -1打出 +2抽

    // 2. BP01-011 冕饵装备出场：因本回合侵蚀变化过 → 抽 1 张牌
    const bp01011 = findCard(engine, active, 'BP01-011');
    engine.zoneMgr.moveCard(bp01011.instanceId, 'HAND', { isFaceUp: true });
    const handBeforeEquip = engine.zoneMgr.getCardsInZone(active, 'HAND').length;
    expect(
      engine.dispatchAction({
        type: 'PLAY_CARD',
        playerId: active,
        cardInstanceId: bp01011.instanceId,
        targetEquipRoleId: bp01009.instanceId,
      }).success
    ).toBe(true);
    expect(engine.zoneMgr.getCardsInZone(active, 'HAND').length).toBe(handBeforeEquip); // -1打出 +1抽

    // 3. BP01-008 侵蚀>=5 时我方所有<升格者>+1000PP；BP01-013 终焉降临瞬时消2黄球使侵蚀-1
    const bp01008 = placeRole(engine, active, 'BP01-008', 1, { isReady: true });
    state.players[active]!.erosionCount = 5;
    // bp01009 基本3000 + 冕饵1000 + BP01-008 全体+1000 = 5000
    expect(engine.fieldMgr.calculateRoleEffectivePP(bp01009.instanceId)).toBe(5000);

    const bp01013 = findCard(engine, active, 'BP01-013');
    const y1 = findCard(engine, active, 'BP01-084');
    const y2 = findCard(engine, active, 'BP01-085');
    engine.zoneMgr.moveCard(bp01013.instanceId, 'HAND', { isFaceUp: true });
    engine.zoneMgr.moveCard(y1.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    engine.zoneMgr.moveCard(y2.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    for (const c of engine.zoneMgr.getCardsInZone(active, 'COST')) if (c.isFaceUp) c.isReady = true;
    engine.zoneMgr.syncCostStats(active);

    putNonOrbOnDeckTop(engine, active);
    putNonOrbOnDeckTop(engine, state.nonActivePlayerId);
    expect(
      engine.dispatchAction({
        type: 'DECLARE_ATTACK',
        playerId: active,
        attackerCardId: bp01008.instanceId,
        targetType: 'PLAYER',
      }).success
    ).toBe(true);
    // 跳过 BP01-008 攻击自消红球 (无红球不弹)，进入自由时点发动 BP01-013
    if (state.timingWindow && state.timingWindow.priorityPlayerId !== active) {
      engine.dispatchAction({ type: 'PASS_ACTION_TIMING', playerId: state.timingWindow.priorityPlayerId });
    }
    expect(
      engine.dispatchAction({
        type: 'PLAY_CARD',
        playerId: active,
        cardInstanceId: bp01013.instanceId,
      }).success
    ).toBe(true);
    expect(state.currentPendingChoice?.effectType).toBe('PRESET_BP01_013_ORB_COST');
    const yellowOpt = state.currentPendingChoice!.options.find((o) => o.id !== 'skip')!;
    expect(
      engine.dispatchAction({
        type: 'SELECT_CHOICE_OPTION',
        playerId: active,
        pendingChoiceId: state.currentPendingChoice!.id,
        selectedIds: [yellowOpt.id],
      }).success
    ).toBe(true);
    expect(state.players[active]!.erosionCount).toBe(4);
  });
});

describe('BP01 第一批：七实·遥星之座 & 帕瓦叠置体系 (BP01-040 ~ BP01-055)', () => {
  it('BP01-049/050/051 帕瓦【起】叠入下方赋予 PP/充能/DP，BP01-040 下方>=4防低PP阻挡 & 下方>=7【游戏1】直伤', () => {
    const engine = createEngine(
      expandDeck('ST01', [
        'BP01-040',
        'BP01-041',
        'BP01-049',
        'BP01-050',
        'BP01-051',
        'BP01-052',
        'BP01-078',
        'BP01-084',
        'BP01-085',
      ]),
      expandDeck('ST02')
    );
    const state = engine.getState();
    const active = state.activePlayerId;
    const opp = state.nonActivePlayerId;

    const nanami40 = placeRole(engine, active, 'BP01-040', 0, { isReady: true }); // basePP 8000, baseDP 1
    const pawa49 = placeRole(engine, active, 'BP01-049', 1, { isReady: true });
    const pawa50 = findCard(engine, active, 'BP01-050');
    const pawa51 = findCard(engine, active, 'BP01-051');
    const pawa52 = findCard(engine, active, 'BP01-052');
    const redOrb = findCard(engine, active, 'BP01-078');
    engine.zoneMgr.moveCard(redOrb.instanceId, 'SIGNAL_ORB', { isFaceUp: true });

    // 1. 帕瓦 BP01-049 发动【起】消1球将竖直的自身置入 nanami40 下方 → nanami40 PP +1000 (= 9000)
    expect(
      engine.dispatchAction({
        type: 'ACTIVATE_ABILITY',
        playerId: active,
        sourceCardId: pawa49.instanceId,
      }).success
    ).toBe(true);
    expect(state.currentPendingChoice?.effectType).toBe('PRESET_PAWA_HOST');
    expect(
      engine.dispatchAction({
        type: 'SELECT_CHOICE_OPTION',
        playerId: active,
        pendingChoiceId: state.currentPendingChoice!.id,
        selectedIds: [nanami40.instanceId],
      }).success
    ).toBe(true);
    expect(nanami40.underneathCardIds).toContain(pawa49.instanceId);
    expect(state.battlefields[active]![1]!.roleCardId).toBeUndefined();
    expect(engine.fieldMgr.calculateRoleEffectivePP(nanami40.instanceId)).toBe(9000);

    // 2. 再垫入 BP01-050 (充能+1)、BP01-051 (基本DP<=1时DP+1)、BP01-052，总共 4 张下方牌 → 触发不可被 PP<=5000 阻挡
    for (const u of [pawa50, pawa51, pawa52]) {
      engine.zoneMgr.moveCard(u.instanceId, 'BATTLEFIELD', { isFaceUp: true });
      nanami40.underneathCardIds.push(u.instanceId);
    }
    const eval4 = engine.continuousEffects.evaluateCard(nanami40.instanceId);
    // BP01-040 基本 PP 8000 + BP01-049(+1000) + BP01-040 自身「下方>=2张时我方回合<机械教会>/<火花>角色PP+1000」= 10000
    expect(eval4.pp).toBe(10000);
    expect(eval4.charge).toBe(2); // 1 + 1 (BP01-050)
    expect(eval4.dp).toBe(2); // 1 + 1 (BP01-051)
    expect(eval4.unblockableMaxPP).toBe(5000);

    // 对方仅有一张 PP 4000 竖直角色时，无法阻挡 BP01-040 的攻击 (自动跳过阻挡步骤或阻挡被拒)
    const oppWeak = placeRole(engine, opp, 'ST02-004', 0, { isReady: true }); // PP 4000
    putNonOrbOnDeckTop(engine, active);
    putNonOrbOnDeckTop(engine, opp);
    expect(
      engine.dispatchAction({
        type: 'DECLARE_ATTACK',
        playerId: active,
        attackerCardId: nanami40.instanceId,
        targetType: 'PLAYER',
      }).success
    ).toBe(true);
    passInstantWindows(engine);
    resolvePendingChoices(engine);
    // 不可被 PP<=5000 阻挡，oppWeak 未横置且攻击已结算完毕回到 MAIN_PHASE
    expect(state.cards[oppWeak.instanceId]!.isReady).toBe(true);
    expect(state.phase).toBe('MAIN_PHASE');

    // 3. 垫够 7 张下方牌 + 2 张黄球 → 发动 BP01-040【起】选择【游戏1】给予对方 1 点伤害
    const extraUnder = engine.zoneMgr.getCardsInZone(active, 'DECK').slice(0, 3);
    for (const u of extraUnder) {
      engine.zoneMgr.moveCard(u.instanceId, 'BATTLEFIELD', { isFaceUp: true });
      nanami40.underneathCardIds.push(u.instanceId);
    }
    expect(nanami40.underneathCardIds.length).toBe(7);
    const y1 = findCard(engine, active, 'BP01-084');
    const y2 = findCard(engine, active, 'BP01-085');
    engine.zoneMgr.moveCard(y1.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    engine.zoneMgr.moveCard(y2.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    const oppErosionBefore = state.players[opp]!.erosionCount;
    putNonOrbOnDeckTop(engine, opp);

    expect(
      engine.dispatchAction({
        type: 'ACTIVATE_ABILITY',
        playerId: active,
        sourceCardId: nanami40.instanceId,
      }).success
    ).toBe(true);
    expect(state.currentPendingChoice?.effectType).toBe('DSL_CHOOSE_ACTIVATED_ABILITY');
    expect(
      engine.dispatchAction({
        type: 'SELECT_CHOICE_OPTION',
        playerId: active,
        pendingChoiceId: state.currentPendingChoice!.id,
        selectedIds: ['mode_damage'],
      }).success
    ).toBe(true);
    expect(state.players[opp]!.erosionCount).toBe(oppErosionBefore + 1);
    expect(state.players[active]!.gameAbilityUsage['BP01-040-DAMAGE']).toBe(1);
  });

  it('BP01-054 万兆创星 & BP01-055 七实-未来：无视升变条件从牌组直接升变出场并叠置帕瓦', () => {
    const engine = createEngine(
      expandDeck('ST01', ['BP01-040', 'BP01-042', 'BP01-049', 'BP01-054', 'BP01-055']),
      expandDeck('ST02')
    );
    const state = engine.getState();
    const active = state.activePlayerId;
    const opp = state.nonActivePlayerId;

    // 放 1 张火属性明费 + 4 费 (不足 8 费)，场上放费用 4 (<6) 的 BP01-042 与 帕瓦 BP01-049，牌组里有 BP01-040 (8费升变)
    const fireCost = findCard(engine, active, 'BP01-054');
    const bp01055 = findCard(engine, active, 'BP01-055');
    const bp01040 = findCard(engine, active, 'BP01-040');
    const baseNanami = placeRole(engine, active, 'BP01-042', 0);
    const pawa = placeRole(engine, active, 'BP01-049', 1);
    engine.zoneMgr.moveCard(bp01040.instanceId, 'DECK', { isFaceUp: false });
    engine.zoneMgr.moveCard(bp01055.instanceId, 'HAND', { isFaceUp: true });
    engine.zoneMgr.moveCard(fireCost.instanceId, 'COST', { isFaceUp: true, isReady: true });
    fillCostZone(engine, active, 4);

    // 打出 BP01-055 七实-未来：选牌组 BP01-040 → 选场上 BP01-042 → 选场上 BP01-049 → 无视费用上限8与升变代价直接升变！
    expect(
      engine.dispatchAction({
        type: 'PLAY_CARD',
        playerId: active,
        cardInstanceId: bp01055.instanceId,
      }).success
    ).toBe(true);
    expect(state.currentPendingChoice?.effectType).toBe('PRESET_BP01_055_DECK');
    expect(
      engine.dispatchAction({
        type: 'SELECT_CHOICE_OPTION',
        playerId: active,
        pendingChoiceId: state.currentPendingChoice!.id,
        selectedIds: [bp01040.instanceId],
      }).success
    ).toBe(true);
    expect(state.currentPendingChoice?.effectType).toBe('PRESET_BP01_055_BASE');
    expect(
      engine.dispatchAction({
        type: 'SELECT_CHOICE_OPTION',
        playerId: active,
        pendingChoiceId: state.currentPendingChoice!.id,
        selectedIds: [baseNanami.instanceId],
      }).success
    ).toBe(true);
    expect(state.currentPendingChoice?.effectType).toBe('PRESET_BP01_055_PAWA');
    expect(
      engine.dispatchAction({
        type: 'SELECT_CHOICE_OPTION',
        playerId: active,
        pendingChoiceId: state.currentPendingChoice!.id,
        selectedIds: [pawa.instanceId],
      }).success
    ).toBe(true);
    expect(state.battlefields[active]![0]!.roleCardId).toBe(bp01040.instanceId);
    expect(state.cards[bp01040.instanceId]!.underneathCardIds).toContain(baseNanami.instanceId);
    expect(state.cards[bp01040.instanceId]!.underneathCardIds).toContain(pawa.instanceId);

    // BP01-054 万兆创星：我方存在《七实·遥星之座》升变角色 → 可直接破坏对方 PP > 6000 的角色 (ST02-001 PP 7000)
    const oppBig = placeRole(engine, opp, 'ST02-001', 0);
    engine.zoneMgr.moveCard(fireCost.instanceId, 'HAND', { isFaceUp: true });
    engine.zoneMgr.moveCard(bp01055.instanceId, 'COST', { isFaceUp: true, isReady: true });
    for (const c of engine.zoneMgr.getCardsInZone(active, 'COST')) if (c.isFaceUp) c.isReady = true;
    fillCostZone(engine, active, 5);
    expect(
      engine.dispatchAction({
        type: 'PLAY_CARD',
        playerId: active,
        cardInstanceId: fireCost.instanceId,
      }).success
    ).toBe(true);
    expect(state.currentPendingChoice?.effectType).toBe('PRESET_BP01_054_DESTROY');
    expect(
      engine.dispatchAction({
        type: 'SELECT_CHOICE_OPTION',
        playerId: active,
        pendingChoiceId: state.currentPendingChoice!.id,
        selectedIds: [oppBig.instanceId],
      }).success
    ).toBe(true);
    expect(state.cards[oppBig.instanceId]!.zone).toBe('GRAVEYARD');
  });
});

describe('BP01 第一批：三头犬 & 突击鹰补充 (BP01-069 ~ BP01-077)', () => {
  it('BP01-070 诺克提无视属性、BP01-073 阻挡+1000PP & 消2球出明费上限内角色不能攻击、BP01-076 回底回收、BP01-077 首张《荣光护盾》变1费', () => {
    const engine = createEngine(
      expandDeck('ST03', ['BP01-069', 'BP01-070', 'BP01-073', 'BP01-076', 'BP01-077', 'ST04-001', 'ST04-001', 'ST04-004']),
      expandDeck('ST02')
    );
    const state = engine.getState();
    const active = state.activePlayerId;

    // 1. BP01-070 诺克提·擎驱 (雷属性)：场上有<薇拉>时无视雷属性直接出场
    const vera = placeRole(engine, active, 'ST03-001', 0);
    const noctis = findCard(engine, active, 'BP01-070');
    engine.zoneMgr.moveCard(noctis.instanceId, 'HAND', { isFaceUp: true });
    fillCostZone(engine, active, 4);
    expect(
      engine.dispatchAction({
        type: 'PLAY_CARD',
        playerId: active,
        cardInstanceId: noctis.instanceId,
        targetSlotIndex: 1,
      }).success
    ).toBe(true);

    // 2. BP01-077 万事·明觉：我方每回合第1张《荣光护盾》(原2费) 费用变为 1，第2张恢复 2 费
    placeRole(engine, active, 'BP01-077', 2);
    const shields = findCards(engine, active, 'ST04-001');
    engine.zoneMgr.moveCard(shields[0]!.instanceId, 'HAND', { isFaceUp: true });
    engine.zoneMgr.moveCard(shields[1]!.instanceId, 'HAND', { isFaceUp: true });
    expect(engine.calculateCardCost(active, shields[0]!.instanceId).costToPay).toBe(1);
    // 模拟本回合已使用过 1 张《荣光护盾》→ 第二张恢复 2 费
    state.players[active]!.turnCardPlayedCountByName = { 荣光护盾: 1 };
    expect(engine.calculateCardCost(active, shields[1]!.instanceId).costToPay).toBe(2);

    // 3. BP01-076 卡穆·狂犬【起】将自身放回牌组底 → 回收墓地 1 张<突击鹰小队>角色
    const kamui = placeRole(engine, active, 'BP01-076', 3);
    const eagleGy = findCard(engine, active, 'ST04-004');
    engine.zoneMgr.moveCard(eagleGy.instanceId, 'GRAVEYARD', { isFaceUp: true });
    expect(
      engine.dispatchAction({
        type: 'ACTIVATE_ABILITY',
        playerId: active,
        sourceCardId: kamui.instanceId,
      }).success
    ).toBe(true);
    expect(state.cards[kamui.instanceId]!.zone).toBe('DECK');
    expect(state.currentPendingChoice?.effectType).toBe('PRESET_BP01_076_PICK');
    expect(
      engine.dispatchAction({
        type: 'SELECT_CHOICE_OPTION',
        playerId: active,
        pendingChoiceId: state.currentPendingChoice!.id,
        selectedIds: [eagleGy.instanceId],
      }).success
    ).toBe(true);
    expect(state.cards[eagleGy.instanceId]!.zone).toBe('HAND');

    // 4. BP01-073 库洛姆·荣光【起】消2同色球从手牌出场费用<=明费上限的<突击鹰小队>角色且本回合不能攻击
    const chrome73 = placeRole(engine, active, 'BP01-073', 4);
    const orbs = Object.values(state.cards)
      .filter((c) => c.controllerPlayerId === active && db.getCard(c.cardNumber)?.signalOrb === 'RED')
      .slice(0, 2);
    for (const o of orbs) engine.zoneMgr.moveCard(o.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    expect(
      engine.dispatchAction({
        type: 'ACTIVATE_ABILITY',
        playerId: active,
        sourceCardId: chrome73.instanceId,
      }).success
    ).toBe(true);
    expect(state.currentPendingChoice?.effectType).toBe('PRESET_BP01_073_DEPLOY');
    expect(
      engine.dispatchAction({
        type: 'SELECT_CHOICE_OPTION',
        playerId: active,
        pendingChoiceId: state.currentPendingChoice!.id,
        selectedIds: [eagleGy.instanceId],
      }).success
    ).toBe(true);
    // ST04-004 出场会弹出给其他<突击鹰小队>+1000PP 的选择，先选 chrome73
    resolvePendingChoices(engine);
    expect(state.cards[eagleGy.instanceId]!.zone).toBe('BATTLEFIELD');
    expect(engine.continuousEffects.hasProhibition(eagleGy.instanceId, 'CANNOT_ATTACK')).toBe(true);

    // 回合结束重置后，新回合第一张《荣光护盾》再次变为 1 费
    endTurn(engine);
    expect(state.players[active]!.turnCardPlayedCountByName).toBeUndefined();
    expect(engine.calculateCardCost(active, shields[1]!.instanceId).costToPay).toBe(1);
    void vera;
  });
});

import { describe, it, expect } from 'vitest';
import { CardInstance } from '@zhanshuang/shared';
import {
  GameEngine,
  MemoryCardDatabase,
  OFFICIAL_CARDS_DATA,
  getAttachedEquipmentIds,
} from '../src/index.js';
import { OFFICIAL_STARTER_DECKS } from '@zhanshuang/game-rules';
import {
  fillCostZone,
  passInstantWindows,
  endTurn,
} from './helpers.js';

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

function addCostWithCard(engine: GameEngine, playerId: string, cardInstanceId: string): void {
  engine.zoneMgr.moveCard(cardInstanceId, 'COST', { isFaceUp: true, isReady: true });
  engine.zoneMgr.syncCostStats(playerId);
}

function createEngine(p1Deck: string[], p2Deck: string[], seed = 20261124): GameEngine {
  const engine = new GameEngine(
    'test-stage1b',
    { playerId: 'p1', deckCardNumbers: p1Deck },
    { playerId: 'p2', deckCardNumbers: p2Deck },
    seed,
    db,
    { skipMulligan: true }
  );
  const chargeIfNeeded = () => {
    const st = engine.getState();
    if (st.phase === 'DRAW_CHARGE_PHASE') {
      engine.dispatchAction({
        type: 'PASS_ACTION_TIMING',
        playerId: st.activePlayerId,
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

function findCards(engine: GameEngine, playerId: string, cardNumber: string): CardInstance[] {
  return Object.values(engine.getState().cards).filter(
    (c) => c.ownerPlayerId === playerId && c.cardNumber === cardNumber
  );
}

describe('Stage 1B-1 (§2.4) 越权抢发、暗区泄密、白嫖与 ST04/BP01 关键规则回归', () => {
  it('1. USE_INSTANT 禁止跨优先权抢发非战术瞬时 (BP03-054)', () => {
    const engine = createEngine(
      expandDeck('ST01', ['ST01-001', 'BP03-054', 'BP01-058']),
      expandDeck('ST02', ['BP03-054', 'BP01-058'])
    );
    const state = engine.getState();
    expect(state.activePlayerId).toBe('p1');

    const attacker = findCards(engine, 'p1', 'ST01-001')[0]!;
    const p1Bp03054 = findCards(engine, 'p1', 'BP03-054')[0]!;
    const p1Art = findCards(engine, 'p1', 'BP01-058')[0]!;
    engine.fieldMgr.playRoleCard('p1', attacker.instanceId, 0, { suppressEntryTrigger: true });
    engine.fieldMgr.playRoleCard('p1', p1Art.instanceId, 1, { suppressEntryTrigger: true });
    state.cards[attacker.instanceId]!.turnEnteredZone = 0;
    addCostWithCard(engine, 'p1', p1Bp03054.instanceId);

    const defBp03054 = findCards(engine, 'p2', 'BP03-054')[0]!;
    const defArt = findCards(engine, 'p2', 'BP01-058')[0]!;
    engine.fieldMgr.playRoleCard('p2', defArt.instanceId, 0, { suppressEntryTrigger: true });
    addCostWithCard(engine, 'p2', defBp03054.instanceId);

    const atkRes = engine.dispatchAction({
      type: 'DECLARE_ATTACK',
      playerId: 'p1',
      attackerCardId: attacker.instanceId,
      targetType: 'PLAYER',
    });
    expect(atkRes.success, atkRes.error).toBe(true);
    // 7.3.1.b：攻击自由时点由非回合方 (p2) 优先获得优先权
    expect(state.timingWindow?.kind).toBe('FREE_TIMING');
    expect(state.timingWindow?.priorityPlayerId).toBe('p2');

    // 自由时点优先权在 p2 时，p1 强行跨优先权发动 BP03-054 必须被拒
    const hijackRes = engine.dispatchAction({
      type: 'USE_INSTANT',
      playerId: 'p1',
      cardInstanceId: p1Bp03054.instanceId,
    });
    expect(hijackRes.success).toBe(false);
    expect(state.cards[p1Bp03054.instanceId]!.zone).toBe('COST');

    // p2 让出优先权后，p1 持有优先权即可正常发动 BP03-054
    engine.dispatchAction({ type: 'PASS_ACTION_TIMING', playerId: 'p2' });
    expect(state.timingWindow?.priorityPlayerId).toBe('p1');
    const validRes = engine.dispatchAction({
      type: 'USE_INSTANT',
      playerId: 'p1',
      cardInstanceId: p1Bp03054.instanceId,
    });
    expect(validRes.success, validRes.error).toBe(true);
    expect(state.cards[p1Bp03054.instanceId]!.zone).toBe('DECK');
  });

  it('2. BP01-039 / BP02-048 检索 COST 区强制排除背面暗费 (3.6.3.b.2)', () => {
    const engine = createEngine(
      expandDeck('ST01', ['BP01-039', 'BP01-037', 'BP02-048', 'ST04-004']),
      expandDeck('ST02', ['ST02-001'])
    );
    const state = engine.getState();

    const hiddenWanshiming = findCards(engine, 'p1', 'BP01-037')[0]!;
    const bp01039 = findCards(engine, 'p1', 'BP01-039')[0]!;
    const bp02048 = findCards(engine, 'p1', 'BP02-048')[0]!;
    const iceCost = findCards(engine, 'p1', 'ST04-004')[0]!;

    // 先将手牌/暗费/冰费就位，再补足明费
    engine.zoneMgr.moveCard(bp01039.instanceId, 'HAND');
    engine.zoneMgr.moveCard(bp02048.instanceId, 'HAND');
    addCostWithCard(engine, 'p1', iceCost.instanceId);
    fillCostZone(engine, 'p1', 8);
    engine.zoneMgr.moveCard(hiddenWanshiming.instanceId, 'COST', { isFaceUp: false, isReady: false });
    engine.zoneMgr.syncCostStats('p1');

    const oppRole = findCards(engine, 'p2', 'ST02-001')[0]!;
    engine.fieldMgr.playRoleCard('p2', oppRole.instanceId, 0);

    // 打出 BP01-039《自由》：第 2 段仅检索明费<万世铭>，背面暗费 BP01-037 不可被选中或竖直
    const playRes = engine.dispatchAction({
      type: 'PLAY_CARD',
      playerId: 'p1',
      cardInstanceId: bp01039.instanceId,
    });
    expect(playRes.success, playRes.error).toBe(true);
    expect(state.currentPendingChoice).toBeDefined();
    engine.dispatchAction({
      type: 'SELECT_CHOICE_OPTION',
      playerId: 'p1',
      pendingChoiceId: state.currentPendingChoice!.id,
      selectedIds: [oppRole.instanceId],
    });

    expect(state.currentPendingChoice).toBeUndefined();
    expect(state.cards[hiddenWanshiming.instanceId]!.isFaceUp).toBe(false);
    expect(state.cards[hiddenWanshiming.instanceId]!.isReady).toBe(false);

    // 竖直费用后打出 BP02-048：暗费中的<万世铭>严禁出现在牺牲选项中
    fillCostZone(engine, 'p1', 8);
    const play048 = engine.dispatchAction({
      type: 'PLAY_CARD',
      playerId: 'p1',
      cardInstanceId: bp02048.instanceId,
      targetSlotIndex: 0,
    });
    expect(play048.success, play048.error).toBe(true);
    if (state.currentPendingChoice) {
      const optionIds = state.currentPendingChoice.options.map((o) => o.id);
      expect(optionIds).not.toContain(hiddenWanshiming.instanceId);
    }
  });

  it('3. SIGNAL_ORB 背面球在 REORDER_ZONE 与 signalOrbColor 中不泄露卡名与印刷颜色', () => {
    const engine = createEngine(
      expandDeck('ST02', ['BP02-024', 'ST01-012', 'BP01-009']),
      expandDeck('ST01')
    );
    const state = engine.getState();

    const bp02024 = findCards(engine, 'p1', 'BP02-024')[0]!;
    const faceDownRedOrb = findCards(engine, 'p1', 'ST01-012')[0]!;
    const oddCostOrb = findCards(engine, 'p1', 'BP01-009')[0]!; // 费用 3（奇数，触发晖形态）

    engine.fieldMgr.playRoleCard('p1', bp02024.instanceId, 0);
    // 先清掉初始信号球以便精准验证
    for (const c of engine.zoneMgr.getCardsInZone('p1', 'SIGNAL_ORB')) {
      engine.zoneMgr.moveCard(c.instanceId, 'DECK', { isFaceUp: false });
    }
    // 底部为奇数费用正面球，上方为背面红球 ST01-012
    engine.zoneMgr.moveCard(oddCostOrb.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    engine.zoneMgr.moveCard(faceDownRedOrb.instanceId, 'SIGNAL_ORB', { isFaceUp: false });

    // 验证 signalOrbColor 过滤不会匹配背面球（印刷为 RED，但背面球不得暴露颜色）
    const matchesRed = (engine.effectEngine.presets.interpreter as any).matchesFilter(
      faceDownRedOrb,
      { signalOrbColor: 'RED' },
      'p1'
    );
    expect(matchesRed).toBe(false);

    // 发动 BP02-024 晖【起】重排信号球区，验证背面球选项不泄露卡名/卡号
    const act = engine.dispatchAction({
      type: 'ACTIVATE_ABILITY',
      playerId: 'p1',
      sourceCardId: bp02024.instanceId,
      abilityIndex: 0,
    });
    expect(act.success, act.error).toBe(true);
    expect(state.currentPendingChoice).toBeDefined();
    const fdOpt = state.currentPendingChoice!.options.find((o) => o.id === faceDownRedOrb.instanceId);
    expect(fdOpt).toBeDefined();
    expect(fdOpt!.label).toContain('背面信号球');
    expect(JSON.stringify(fdOpt)).not.toContain('ST01-012');
    expect(JSON.stringify(fdOpt)).not.toContain('红莲-起手式');
  });

  it('4. BP03-059 公开手牌移入公开区且结算后与牌组顶公开牌一并洗回牌组', () => {
    const engine = createEngine(
      expandDeck('ST02', ['BP03-059', 'BP03-061']),
      expandDeck('ST01')
    );
    const state = engine.getState();

    const bp03059 = findCards(engine, 'p1', 'BP03-059')[0]!;
    const handLilith = findCards(engine, 'p1', 'BP03-061')[0]!;

    engine.zoneMgr.moveCard(bp03059.instanceId, 'HAND');
    engine.zoneMgr.moveCard(handLilith.instanceId, 'HAND');
    fillCostZone(engine, 'p1', 6);

    const play = engine.dispatchAction({
      type: 'PLAY_CARD',
      playerId: 'p1',
      cardInstanceId: bp03059.instanceId,
      targetSlotIndex: 0,
    });
    expect(play.success, play.error).toBe(true);

    const handChoice = state.currentPendingChoice!;
    expect(handChoice.effectType).toBe('DSL_CUSTOM_BP03_059_HAND');
    engine.dispatchAction({
      type: 'SELECT_CHOICE_OPTION',
      playerId: 'p1',
      pendingChoiceId: handChoice.id,
      selectedIds: [handLilith.instanceId],
    });

    // 公开瞬间必须已移入 PROCESSING 且正面可见
    expect(state.cards[handLilith.instanceId]!.zone).toBe('PROCESSING');
    expect(state.cards[handLilith.instanceId]!.isFaceUp).toBe(true);

    // 选择停止翻牌，手牌公开的 handLilith 也必须洗回牌组
    const askChoice = state.currentPendingChoice!;
    engine.dispatchAction({
      type: 'SELECT_CHOICE_OPTION',
      playerId: 'p1',
      pendingChoiceId: askChoice.id,
      selectedIds: ['stop'],
    });
    expect(state.cards[handLilith.instanceId]!.zone).toBe('DECK');
    expect(state.cards[handLilith.instanceId]!.isFaceUp).toBe(false);
  });

  it('5. BP01-058 2张可选弃牌代价提交1张被拒（禁止1换2白嫖）', () => {
    const engine = createEngine(
      expandDeck('ST01', ['BP01-058', 'BP01-056', 'ST01-012', 'ST01-013']),
      expandDeck('ST02')
    );
    const state = engine.getState();

    const selena58 = findCards(engine, 'p1', 'BP01-058')[0]!;
    const dreamGy = findCards(engine, 'p1', 'BP01-056')[0]!;
    const filler1 = findCards(engine, 'p1', 'ST01-012')[0]!;
    const filler2 = findCards(engine, 'p1', 'ST01-013')[0]!;

    // 先将手牌与墓地牌移出牌组，再补充 6 费
    engine.zoneMgr.moveCard(dreamGy.instanceId, 'GRAVEYARD', { isFaceUp: true });
    engine.zoneMgr.moveCard(selena58.instanceId, 'HAND');
    engine.zoneMgr.moveCard(filler1.instanceId, 'HAND');
    engine.zoneMgr.moveCard(filler2.instanceId, 'HAND');
    fillCostZone(engine, 'p1', 6);

    const play = engine.dispatchAction({
      type: 'PLAY_CARD',
      playerId: 'p1',
      cardInstanceId: selena58.instanceId,
      targetSlotIndex: 0,
    });
    expect(play.success, play.error).toBe(true);

    // BP01-058 两条独立【出】同时进入待机，先选择【出1】(丢弃 2 张手牌)
    const orderChoice = state.currentPendingChoice!;
    expect(orderChoice?.effectType).toBe('CHOOSE_TRIGGER_ORDER');
    expect(orderChoice.options).toHaveLength(2);
    const entry1Opt = orderChoice.options.find((o) => o.label.includes('丢弃 2 张手牌'))!;
    expect(
      engine.dispatchAction({
        type: 'SELECT_CHOICE_OPTION',
        playerId: 'p1',
        pendingChoiceId: orderChoice.id,
        selectedIds: [entry1Opt.id],
      }).success
    ).toBe(true);

    const discardChoice = state.currentPendingChoice!;
    expect(discardChoice.minSelections).toBe(0);
    expect(discardChoice.maxSelections).toBe(2);

    // 尝试只丢 1 张白嫖必须被拒绝
    const cheatRes = engine.dispatchAction({
      type: 'SELECT_CHOICE_OPTION',
      playerId: 'p1',
      pendingChoiceId: discardChoice.id,
      selectedIds: [filler1.instanceId],
    });
    expect(cheatRes.success).toBe(false);
    expect(state.cards[filler1.instanceId]!.zone).toBe('HAND');

    // 提交 0 张正常跳过不发动
    const skipRes = engine.dispatchAction({
      type: 'SELECT_CHOICE_OPTION',
      playerId: 'p1',
      pendingChoiceId: discardChoice.id,
      selectedIds: [],
    });
    expect(skipRes.success, skipRes.error).toBe(true);
    expect(state.cards[dreamGy.instanceId]!.zone).toBe('GRAVEYARD');
  });

  it('6. ST04-001 双《荣光护盾》独立追踪 (Q&A·7) 且 ST04-002 不付代价不耗回合1 (10.1.2.b)', () => {
    const engine = createEngine(
      expandDeck('ST01', ['ST01-001', 'ST01-002']),
      expandDeck('ST01', ['ST04-001', 'ST04-001', 'ST04-002', 'ST04-004'])
    );
    const state = engine.getState();

    const shields = findCards(engine, 'p2', 'ST04-001');
    const st04002 = findCards(engine, 'p2', 'ST04-002')[0]!;
    const p2IceCost = findCards(engine, 'p2', 'ST04-004')[0]!;
    expect(shields.length).toBeGreaterThanOrEqual(2);

    const atk1 = findCards(engine, 'p1', 'ST01-001')[0]!;
    engine.fieldMgr.playRoleCard('p1', atk1.instanceId, 0, { suppressEntryTrigger: true });
    state.cards[atk1.instanceId]!.turnEnteredZone = 0;

    engine.fieldMgr.playRoleCard('p2', st04002.instanceId, 0, { suppressEntryTrigger: true });
    for (const sh of shields.slice(0, 2)) engine.zoneMgr.moveCard(sh.instanceId, 'HAND');
    const defOrbs = Object.values(state.cards)
      .filter((c) => c.ownerPlayerId === 'p2' && db.getCard(c.cardNumber)?.signalOrb === 'RED')
      .slice(0, 4);
    for (const o of defOrbs) engine.zoneMgr.moveCard(o.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    addCostWithCard(engine, 'p2', p2IceCost.instanceId);
    fillCostZone(engine, 'p2', 6);

    engine.dispatchAction({ type: 'DECLARE_ATTACK', playerId: 'p1', attackerCardId: atk1.instanceId, targetType: 'PLAYER' });
    if (state.timingWindow?.priorityPlayerId === 'p1') {
      engine.dispatchAction({ type: 'PASS_ACTION_TIMING', playerId: 'p1' });
    }
    const use1 = engine.dispatchAction({ type: 'USE_INSTANT', playerId: 'p2', cardInstanceId: shields[0]!.instanceId });
    expect(use1.success, use1.error).toBe(true);
    engine.dispatchAction({
      type: 'SELECT_CHOICE_OPTION',
      playerId: 'p2',
      pendingChoiceId: state.currentPendingChoice!.id,
      selectedIds: [st04002.instanceId],
    });
    if (state.timingWindow?.priorityPlayerId === 'p1') {
      engine.dispatchAction({ type: 'PASS_ACTION_TIMING', playerId: 'p1' });
    }
    const use2 = engine.dispatchAction({ type: 'USE_INSTANT', playerId: 'p2', cardInstanceId: shields[1]!.instanceId });
    expect(use2.success, use2.error).toBe(true);
    engine.dispatchAction({
      type: 'SELECT_CHOICE_OPTION',
      playerId: 'p2',
      pendingChoiceId: state.currentPendingChoice!.id,
      selectedIds: [st04002.instanceId],
    });

    // Q&A·7：2 张《荣光护盾》产生 2 个独立赋予触发键
    const keys = engine.continuousEffects.getGrantedTriggerKeys(
      st04002.instanceId,
      'ST04_001_GRANTED_BLOCK_END_DESTROY'
    );
    expect(keys).toHaveLength(2);
    expect(new Set(keys).size).toBe(2);

    passInstantWindows(engine);
    engine.dispatchAction({ type: 'DECLARE_BLOCK', playerId: 'p2', blockerCardId: st04002.instanceId });

    // 攻击结束时：触发 3 次（自身 ST04-002 + 2 张独立荣光护盾），全部选择 skip
    let skipCount = 0;
    let guard = 0;
    while (state.currentPendingChoice && guard++ < 12) {
      const ch = state.currentPendingChoice;
      const pick = ch.effectType === 'CHOOSE_TRIGGER_ORDER' ? [ch.options[0]!.id] : ['skip'];
      if (pick[0] === 'skip') skipCount++;
      engine.dispatchAction({
        type: 'SELECT_CHOICE_OPTION',
        playerId: ch.playerId,
        pendingChoiceId: ch.id,
        selectedIds: pick,
      });
    }
    expect(skipCount).toBe(3);

    // 10.1.2.b：全部放弃付代价，三者的【回合1】计次均不应消耗
    const consumedKeys = Object.entries(state.players['p2']!.turnAbilityUsage).filter(([, v]) => v > 0);
    expect(consumedKeys).toHaveLength(0);
  });

  it('7. ST04-003 触发结算时已离场则不从墓地置底、不拉人', () => {
    const engine = createEngine(
      expandDeck('ST01', ['ST04-003', 'ST04-002']),
      expandDeck('ST02')
    );
    const state = engine.getState();

    const st04003 = findCards(engine, 'p1', 'ST04-003')[0]!;
    const st04002 = findCards(engine, 'p1', 'ST04-002')[0]!;
    engine.fieldMgr.playRoleCard('p1', st04003.instanceId, 0, { suppressEntryTrigger: true });
    engine.zoneMgr.moveCard(st04002.instanceId, 'GRAVEYARD', { isFaceUp: true });

    engine.triggerMgr.emit({ type: 'END_PHASE_TRIGGERS', playerId: 'p1' });
    expect(state.pendingTriggers.some((t) => t.abilityId === 'ST04_003_END_TURN_SWAP')).toBe(true);
    engine.zoneMgr.moveCard(st04003.instanceId, 'GRAVEYARD', { isFaceUp: true });

    engine.checkTimingMgr.resolveCheckTiming();
    expect(state.cards[st04003.instanceId]!.zone).toBe('GRAVEYARD');
    expect(state.currentPendingChoice).toBeUndefined();
  });

  it('8. BP01-007 无<灰鸦小队>时仍可弃牌 (Q&A·7)，BP01-052 无七实时仍可消球发动【起】(Q&A·2)', () => {
    const engine = createEngine(
      expandDeck('ST01', ['BP01-007', 'BP01-052', 'ST04-004', 'ST01-012', 'ST01-013']),
      expandDeck('ST02')
    );
    const state = engine.getState();

    const bp01007 = findCards(engine, 'p1', 'BP01-007')[0]!;
    const bp01052 = findCards(engine, 'p1', 'BP01-052')[0]!;
    const p1IceCost = findCards(engine, 'p1', 'ST04-004')[0]!;
    const orbCard = findCards(engine, 'p1', 'ST01-012')[0]!;
    const discardCard = findCards(engine, 'p1', 'ST01-013')[0]!;

    engine.fieldMgr.playRoleCard('p1', bp01052.instanceId, 0);
    engine.zoneMgr.moveCard(orbCard.instanceId, 'SIGNAL_ORB', { isFaceUp: true });

    // Q&A·2：无《七实·遥星之座》时 BP01-052 仍可发动【起】消除 1 球
    const actRes = engine.dispatchAction({
      type: 'ACTIVATE_ABILITY',
      playerId: 'p1',
      sourceCardId: bp01052.instanceId,
      abilityIndex: 0,
    });
    expect(actRes.success, actRes.error).toBe(true);
    if (state.currentPendingChoice) {
      engine.dispatchAction({
        type: 'SELECT_CHOICE_OPTION',
        playerId: 'p1',
        pendingChoiceId: state.currentPendingChoice.id,
        selectedIds: [state.currentPendingChoice.options[0]!.id],
      });
    }
    expect(state.cards[orbCard.instanceId]!.zone).toBe('GRAVEYARD');
    expect(state.cards[bp01052.instanceId]!.zone).toBe('BATTLEFIELD');

    // Q&A·7：进入结束阶段瞬时窗使用 BP01-007（场上无<灰鸦小队>），仍可追加丢弃手牌
    engine.zoneMgr.moveCard(bp01007.instanceId, 'HAND');
    engine.zoneMgr.moveCard(discardCard.instanceId, 'HAND');
    addCostWithCard(engine, 'p1', p1IceCost.instanceId);
    fillCostZone(engine, 'p1', 2);
    engine.dispatchAction({ type: 'PASS_ACTION_TIMING', playerId: 'p1' });
    const use007 = engine.dispatchAction({
      type: 'USE_INSTANT',
      playerId: 'p1',
      cardInstanceId: bp01007.instanceId,
    });
    expect(use007.success, use007.error).toBe(true);
    expect(state.currentPendingChoice?.effectType).toBe('PRESET_BP01_007_DISCARD');
    const disRes = engine.dispatchAction({
      type: 'SELECT_CHOICE_OPTION',
      playerId: 'p1',
      pendingChoiceId: state.currentPendingChoice!.id,
      selectedIds: [discardCard.instanceId],
    });
    expect(disRes.success, disRes.error).toBe(true);
    expect(state.cards[discardCard.instanceId]!.zone).toBe('GRAVEYARD');
  });

  it('9. BP01-025 令垫有帕瓦的七实失去能力：PP+1000/DP+1 保留，BP01-050 赋予的【充能+1】失去 (Q&A·1)', () => {
    const engine = createEngine(
      expandDeck('ST01', ['BP01-040', 'BP01-049', 'BP01-050', 'BP01-051']),
      expandDeck('ST02', ['BP01-025'])
    );
    const state = engine.getState();

    const nanami = findCards(engine, 'p1', 'BP01-040')[0]!;
    const p49 = findCards(engine, 'p1', 'BP01-049')[0]!;
    const p50 = findCards(engine, 'p1', 'BP01-050')[0]!;
    const p51 = findCards(engine, 'p1', 'BP01-051')[0]!;

    engine.fieldMgr.playRoleCard('p1', nanami.instanceId, 0);
    state.cards[nanami.instanceId]!.underneathCardIds = [p49.instanceId, p50.instanceId, p51.instanceId];
    for (const p of [p49, p50, p51]) {
      engine.zoneMgr.moveCard(p.instanceId, 'BATTLEFIELD', { isFaceUp: true });
    }

    const before = engine.continuousEffects.evaluateCard(nanami.instanceId);
    expect(before.charge).toBe(2);
    expect(before.dp).toBe(2);
    expect(before.pp).toBeGreaterThanOrEqual(9000);

    state.cards[nanami.instanceId]!.modifiers = [
      { loseAbilities: true, prohibitions: ['CANNOT_BLOCK'], untilTurn: state.turnNumber, source: 'BP01-025', timestamp: 999 },
    ];
    const after = engine.continuousEffects.evaluateCard(nanami.instanceId);
    expect(after.abilitiesLost).toBe(true);
    expect(after.pp).toBe(9000);
    expect(after.dp).toBe(2);
    expect(after.charge).toBe(1);
  });

  it('10. BP01-017 可选离场置换：选择不发动置换时正常破坏且触发对手【贯通】伤害', () => {
    const engine = createEngine(
      expandDeck('ST01', ['ST01-001']),
      expandDeck('ST02', ['BP01-017', 'BP01-020', 'BP01-021'])
    );
    const state = engine.getState();

    const alpha17 = findCards(engine, 'p2', 'BP01-017')[0]!;
    const small = findCards(engine, 'p2', 'BP01-020')[0]!;
    const big = findCards(engine, 'p2', 'BP01-021')[0]!;

    const attacker = findCards(engine, 'p1', 'ST01-001')[0]!;
    engine.fieldMgr.playRoleCard('p1', attacker.instanceId, 0, { suppressEntryTrigger: true });
    state.cards[attacker.instanceId]!.turnEnteredZone = 0;
    state.cards[attacker.instanceId]!.modifiers = [
      { pp: 8000, keywords: ['贯通'], untilTurn: state.turnNumber, source: 'TEST' },
    ];

    engine.fieldMgr.playRoleCard('p2', alpha17.instanceId, 0, { suppressEntryTrigger: true });
    state.cards[alpha17.instanceId]!.isReady = false;
    expect(engine.fieldMgr.equipToRole('p2', small.instanceId, alpha17.instanceId, { suppressEntryTrigger: true })).toBe(true);
    expect(engine.fieldMgr.equipToRole('p2', big.instanceId, alpha17.instanceId, { suppressEntryTrigger: true })).toBe(true);
    expect(getAttachedEquipmentIds(state.cards[alpha17.instanceId]!)).toHaveLength(2);

    const erosionBefore = state.players['p2']!.erosionCount;
    engine.dispatchAction({
      type: 'DECLARE_ATTACK',
      playerId: 'p1',
      attackerCardId: attacker.instanceId,
      targetType: 'CHARACTER',
      targetCardId: alpha17.instanceId,
    });
    passInstantWindows(engine);

    const replChoice = state.currentPendingChoice;
    expect(replChoice?.effectType).toBe('BP01_017_OPTIONAL_LEAVE_REPLACEMENT');
    const declRes = engine.dispatchAction({
      type: 'SELECT_CHOICE_OPTION',
      playerId: 'p2',
      pendingChoiceId: replChoice!.id,
      selectedIds: ['leave'],
    });
    expect(declRes.success, declRes.error).toBe(true);

    expect(state.cards[alpha17.instanceId]!.zone).toBe('GRAVEYARD');
    expect(state.cards[small.instanceId]!.zone).toBe('GRAVEYARD');
    expect(state.cards[big.instanceId]!.zone).toBe('GRAVEYARD');
    expect(state.players['p2']!.erosionCount).toBe(erosionBefore + 1);
  });
});

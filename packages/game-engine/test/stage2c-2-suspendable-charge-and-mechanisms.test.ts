import { describe, it, expect } from 'vitest';
import { CardType } from '@zhanshuang/shared';
import { OFFICIAL_STARTER_DECKS } from '@zhanshuang/game-rules';
import {
  GameEngine,
  MemoryCardDatabase,
  OFFICIAL_CARDS_DATA,
  addCardModifier,
  parseAscensionConfig,
} from '../src/index.js';
import { endTurn, fillCostZone, passInstantWindows, resolvePendingChoices } from './helpers.js';

const db = new MemoryCardDatabase(OFFICIAL_CARDS_DATA);

function cardIdNum(instanceId: string): number {
  const m = instanceId.match(/(\d+)$/);
  return m ? Number(m[1]) : 0;
}

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
    'stage2c2-test',
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

function findCard(engine: GameEngine, playerId: string, cardNumber: string, instanceIndex = 0) {
  const matches = Object.values(engine.getState().cards)
    .filter((c) => c.controllerPlayerId === playerId && c.cardNumber === cardNumber)
    .sort((a, b) => cardIdNum(a.instanceId) - cardIdNum(b.instanceId));
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

function putNonChargeCardOnDeckTop(engine: GameEngine, playerId: string) {
  const c = engine.zoneMgr
    .getCardsInZone(playerId, 'DECK')
    .find((card) => !db.getCard(card.cardNumber)?.rulesText.includes('充能自'));
  if (c) engine.zoneMgr.moveCardToTopOfDeck(c.instanceId);
  return c;
}

describe('Stage 2C-2: 可挂起贯通/直伤/攻击充能与特殊机制闭环', () => {
  describe('1. 可挂起【贯通】(10.7.1) 与可挂起直伤/攻击充能 (10.2.1.b)', () => {
    it('10.7.1 【贯通】作为自动能力进入检查时机，多触发可自选顺序且多【贯通】只触发1次', () => {
      const engine = createEngine(expandDeck('ST01'), expandDeck('ST02'));
      ensurePlayerTurnCanAttack(engine, 'p1');
      const state = engine.getState();

      const attacker = placeRole(engine, 'p1', 'ST01-001', 0, { isReady: true }); // 5000 PP
      const defender = placeRole(engine, 'p2', 'ST02-003', 0, { isReady: false }); // 低 PP 横置角色
      // 赋予两个【贯通】来源，10.7.1.a.1 仍只触发 1 次
      addCardModifier(state, attacker, { keywords: ['贯通'], untilTurn: state.turnNumber });
      addCardModifier(state, attacker, { keywords: ['贯通'], untilTurn: state.turnNumber });

      // 注册一条同步触发的战破【自】，使检查时机产生 2 条可选顺序触发
      let otherExecuted = false;
      engine.triggerMgr.registerTrigger({
        abilityId: 'test:on-battle-destroy-other',
        eventTypes: ['CARD_DESTROYED'],
        collect: (ctx) =>
          ctx.event.destroyReason === 'BATTLE'
            ? [
                {
                  sourceCardInstanceId: attacker.instanceId,
                  sourceCardNumber: attacker.cardNumber,
                  controllerPlayerId: 'p1',
                  label: '测试伴随破坏触发',
                  triggerContext: {},
                },
              ]
            : [],
        execute: () => {
          otherExecuted = true;
        },
      });

      putNonChargeCardOnDeckTop(engine, 'p1');
      putNonChargeCardOnDeckTop(engine, 'p2');

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

      const orderChoice = engine.getState().currentPendingChoice;
      expect(orderChoice?.effectType).toBe('CHOOSE_TRIGGER_ORDER');
      expect(orderChoice?.options.length).toBe(2);
      const piercingOpt = orderChoice!.options.find((o) => o.label.includes('【贯通】'));
      expect(piercingOpt).toBeDefined();

      // 先选另一触发，再执行【贯通】
      const otherOpt = orderChoice!.options.find((o) => o.id !== piercingOpt!.id)!;
      expect(
        engine.dispatchAction({
          type: 'SELECT_CHOICE_OPTION',
          playerId: 'p1',
          pendingChoiceId: orderChoice!.id,
          selectedIds: [otherOpt.id],
        }).success
      ).toBe(true);
      expect(otherExecuted).toBe(true);
      expect(engine.getState().players['p2']!.erosionCount).toBe(1);
    });

    it('10.2.1.b 【贯通】伤害翻出交互【充能自】时保留在 PROCESSING 挂起，支持快照恢复并归位为暗费', () => {
      const engine = createEngine(
        expandDeck('ST01'),
        expandDeck('ST02', ['ST03-013'])
      );
      ensurePlayerTurnCanAttack(engine, 'p1');
      const state = engine.getState();

      const attacker = placeRole(engine, 'p1', 'ST01-001', 0, { isReady: true });
      const defender = placeRole(engine, 'p2', 'ST02-003', 0, { isReady: false });
      addCardModifier(state, attacker, { keywords: ['贯通'], untilTurn: state.turnNumber });

      putNonChargeCardOnDeckTop(engine, 'p1');
      const st03013 = findCard(engine, 'p2', 'ST03-013');
      engine.zoneMgr.moveCardToTopOfDeck(st03013.instanceId);
      const hiddenBefore = state.players['p2']!.hiddenCostCount;

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

      // 此时应停在 ST03-013 的【充能自】选择，ST03-013 留驻 PROCESSING，尚未归入 COST 且侵蚀未加
      const ch = engine.getState().currentPendingChoice;
      expect(ch?.effectType).toBe('SIGNATURE_MOVE_EFFECT');
      expect(ch?.playerId).toBe('p2');
      expect(engine.getState().cards[st03013.instanceId]!.zone).toBe('PROCESSING');
      expect(engine.getState().players['p2']!.hiddenCostCount).toBe(hiddenBefore);

      // 快照恢复后提交选择，完成归位暗费 + 侵蚀+1 + 战斗收束
      const restored = GameEngine.fromSnapshot(engine.toSnapshot(), db);
      const chRestored = restored.getState().currentPendingChoice!;
      const handBefore = restored.zoneMgr.getCardsInZone('p2', 'HAND').length;
      expect(
        restored.dispatchAction({
          type: 'SELECT_CHOICE_OPTION',
          playerId: 'p2',
          pendingChoiceId: chRestored.id,
          selectedIds: ['opt_draw_1'],
        }).success
      ).toBe(true);

      expect(restored.zoneMgr.getCardsInZone('p2', 'HAND').length).toBe(handBefore + 1);
      expect(restored.getState().cards[st03013.instanceId]!.zone).toBe('COST');
      expect(restored.getState().cards[st03013.instanceId]!.isFaceUp).toBe(false);
      expect(restored.getState().players['p2']!.hiddenCostCount).toBe(hiddenBefore + 1);
      expect(restored.getState().players['p2']!.erosionCount).toBe(1);
      expect(restored.getState().currentCombat).toBeUndefined();
      expect(restored.getState().phase).toBe('MAIN_PHASE');
    });

    it('多点直伤第1点翻出交互【充能自】挂起后再结算第2点；第1点侵蚀满7则立刻判负不续第2点', () => {
      // 场景 A：2 点直伤逐点挂起与续行
      {
        const engine = createEngine(expandDeck('ST01'), expandDeck('ST02', ['ST03-013', 'ST03-013']));
        enterMainPhase(engine);
        const orb1 = findCard(engine, 'p2', 'ST03-013', 0);
        const orb2 = findCard(engine, 'p2', 'ST03-013', 1);
        engine.zoneMgr.moveCardToTopOfDeck(orb2.instanceId);
        engine.zoneMgr.moveCardToTopOfDeck(orb1.instanceId); // orb1 在最顶，orb2 第 2

        engine.zoneMgr.applyDamageToPlayer('p2', 2);
        expect(engine.getState().cards[orb1.instanceId]!.zone).toBe('PROCESSING');
        expect(engine.getState().cards[orb2.instanceId]!.zone).toBe('DECK');
        expect(engine.getState().players['p2']!.erosionCount).toBe(0);

        // 选完 orb1 (不抽牌的 opt_pp_plus_2000，避免抽走牌顶 orb2) 后，orb1 成为暗费 +1 侵蚀，且立即进入 orb2 的【充能自】选择
        const ch1 = engine.getState().currentPendingChoice!;
        expect(
          engine.dispatchAction({
            type: 'SELECT_CHOICE_OPTION',
            playerId: 'p2',
            pendingChoiceId: ch1.id,
            selectedIds: ['opt_pp_plus_2000'],
          }).success
        ).toBe(true);
        expect(engine.getState().cards[orb1.instanceId]!.zone).toBe('COST');
        expect(engine.getState().players['p2']!.erosionCount).toBe(1);
        expect(engine.getState().cards[orb2.instanceId]!.zone).toBe('PROCESSING');

        const ch2 = engine.getState().currentPendingChoice!;
        expect(
          engine.dispatchAction({
            type: 'SELECT_CHOICE_OPTION',
            playerId: 'p2',
            pendingChoiceId: ch2.id,
            selectedIds: ['opt_pp_plus_2000'],
          }).success
        ).toBe(true);
        expect(engine.getState().cards[orb2.instanceId]!.zone).toBe('COST');
        expect(engine.getState().players['p2']!.erosionCount).toBe(2);
      }

      // 场景 B：第 1 点达 7 侵蚀立刻判负 9.3.1.a，第 2 点不翻开
      {
        const engine = createEngine(expandDeck('ST01'), expandDeck('ST02', ['ST03-013']));
        enterMainPhase(engine);
        const state = engine.getState();
        state.players['p2']!.erosionCount = 6;
        const orb1 = findCard(engine, 'p2', 'ST03-013');
        engine.zoneMgr.moveCardToTopOfDeck(orb1.instanceId);

        engine.zoneMgr.applyDamageToPlayer('p2', 2);
        const ch1 = engine.getState().currentPendingChoice!;
        expect(
          engine.dispatchAction({
            type: 'SELECT_CHOICE_OPTION',
            playerId: 'p2',
            pendingChoiceId: ch1.id,
            selectedIds: ['opt_draw_1'],
          }).success
        ).toBe(true);

        expect(engine.getState().status).toBe('FINISHED');
        expect(engine.getState().winnerId).toBe('p1');
        expect(engine.getState().players['p2']!.erosionCount).toBe(7);
        expect(engine.getState().pendingChargeQueue).toBeUndefined();
      }
    });

    it('8.5.3 / Q&A·10：BP04-016 出场自伤翻出交互【充能自】时挂起，选完后恢复执行后续暗费炸怪步骤；自伤至 7 先判负', () => {
      // 场景 A：p1 出场 BP04-016，选择自伤 1，翻出 ST03-013 挂起后恢复执行暗费置墓炸对方角色
      {
        const engine = createEngine(
          expandDeck('ST01', ['BP04-016', 'BP04-016', 'ST03-013']),
          expandDeck('ST02')
        );
        ensurePlayerTurnCanAttack(engine, 'p1');
        const state = engine.getState();
        const fireCost = findCard(engine, 'p1', 'BP04-016', 1);
        engine.zoneMgr.moveCard(fireCost.instanceId, 'COST', { isFaceUp: true, isReady: true });
        fillCostZone(engine, 'p1', 6);
        fillCostZone(engine, 'p2', 5); // 对方明费上限 >= 5
        const hiddenCost = findCard(engine, 'p1', 'ST01-004');
        engine.zoneMgr.moveCard(hiddenCost.instanceId, 'COST', { isFaceUp: false, isReady: true });
        engine.zoneMgr.syncCostStats('p1');
        const oppTarget = placeRole(engine, 'p2', 'ST02-004', 0); // 费用<=3 角色

        const chargeOrb = findCard(engine, 'p1', 'ST03-013');
        engine.zoneMgr.moveCardToTopOfDeck(chargeOrb.instanceId);
        const vera = findCard(engine, 'p1', 'BP04-016', 0);
        engine.zoneMgr.moveCard(vera.instanceId, 'HAND', { isFaceUp: true });

        expect(
          engine.dispatchAction({
            type: 'PLAY_CARD',
            playerId: 'p1',
            cardInstanceId: vera.instanceId,
          }).success
        ).toBe(true);

        // 确认自伤 1
        const confirmDmg = engine.getState().currentPendingChoice!;
        expect(confirmDmg.effectType).toBe('DSL_BP04_016_DAMAGE');
        expect(
          engine.dispatchAction({
            type: 'SELECT_CHOICE_OPTION',
            playerId: 'p1',
            pendingChoiceId: confirmDmg.id,
            selectedIds: ['opt_yes'],
          }).success
        ).toBe(true);

        // 翻出 ST03-013 挂起，尚未进入减暗费步骤
        const chOrb = engine.getState().currentPendingChoice!;
        expect(chOrb.effectType).toBe('SIGNATURE_MOVE_EFFECT');
        expect(state.pendingDslContinuations?.length).toBe(1);

        expect(
          engine.dispatchAction({
            type: 'SELECT_CHOICE_OPTION',
            playerId: 'p1',
            pendingChoiceId: chOrb.id,
            selectedIds: ['opt_draw_1'],
          }).success
        ).toBe(true);

        // 恢复继续执行 BP04-016 后段：选暗费送墓并炸对方角色
        const pickHidden = engine.getState().currentPendingChoice!;
        expect(pickHidden.effectType).toBe('DSL_BP04_016_HIDDEN');
        expect(
          engine.dispatchAction({
            type: 'SELECT_CHOICE_OPTION',
            playerId: 'p1',
            pendingChoiceId: pickHidden.id,
            selectedIds: [hiddenCost.instanceId],
          }).success
        ).toBe(true);
        resolvePendingChoices(engine);
        expect(engine.getState().cards[oppTarget.instanceId]!.zone).toBe('GRAVEYARD');
      }

      // 场景 B：自伤前已有 6 点侵蚀，自伤达 7 后 9.3.1 立即判负，不再进入暗费炸怪步骤 (Q&A·10)
      {
        const engine = createEngine(
          expandDeck('ST01', ['BP04-016', 'BP04-016', 'ST03-013']),
          expandDeck('ST02')
        );
        ensurePlayerTurnCanAttack(engine, 'p1');
        engine.getState().players['p1']!.erosionCount = 6;
        const fireCost = findCard(engine, 'p1', 'BP04-016', 1);
        engine.zoneMgr.moveCard(fireCost.instanceId, 'COST', { isFaceUp: true, isReady: true });
        fillCostZone(engine, 'p1', 6);
        fillCostZone(engine, 'p2', 5);
        const hiddenCost = findCard(engine, 'p1', 'ST01-004');
        engine.zoneMgr.moveCard(hiddenCost.instanceId, 'COST', { isFaceUp: false, isReady: true });
        engine.zoneMgr.syncCostStats('p1');
        const oppTarget = placeRole(engine, 'p2', 'ST02-004', 0);

        const chargeOrb = findCard(engine, 'p1', 'ST03-013');
        engine.zoneMgr.moveCardToTopOfDeck(chargeOrb.instanceId);
        const vera = findCard(engine, 'p1', 'BP04-016', 0);
        engine.zoneMgr.moveCard(vera.instanceId, 'HAND', { isFaceUp: true });

        expect(
          engine.dispatchAction({
            type: 'PLAY_CARD',
            playerId: 'p1',
            cardInstanceId: vera.instanceId,
          }).success
        ).toBe(true);

        const confirmDmg = engine.getState().currentPendingChoice!;
        expect(
          engine.dispatchAction({
            type: 'SELECT_CHOICE_OPTION',
            playerId: 'p1',
            pendingChoiceId: confirmDmg.id,
            selectedIds: ['opt_yes'],
          }).success
        ).toBe(true);
        const chOrb = engine.getState().currentPendingChoice!;
        expect(
          engine.dispatchAction({
            type: 'SELECT_CHOICE_OPTION',
            playerId: 'p1',
            pendingChoiceId: chOrb.id,
            selectedIds: ['opt_draw_1'],
          }).success
        ).toBe(true);

        expect(engine.getState().status).toBe('FINISHED');
        expect(engine.getState().winnerId).toBe('p2');
        expect(engine.getState().cards[oppTarget.instanceId]!.zone).toBe('BATTLEFIELD');
      }
    });

    it('performAttackCharge 翻出交互【充能自】时保留在 PROCESSING 挂起，选择完后再归位 SIGNAL_ORB', () => {
      const engine = createEngine(expandDeck('ST01', ['ST03-013']), expandDeck('ST02'));
      enterMainPhase(engine);
      const role = placeRole(engine, 'p1', 'ST01-001', 0, { isReady: true });
      const orb = findCard(engine, 'p1', 'ST03-013');
      engine.zoneMgr.moveCardToTopOfDeck(orb.instanceId);

      engine.zoneMgr.performAttackCharge(role.instanceId, 1);
      const ch = engine.getState().currentPendingChoice;
      expect(ch?.effectType).toBe('SIGNATURE_MOVE_EFFECT');
      expect(orb.zone).toBe('PROCESSING');

      expect(
        engine.dispatchAction({
          type: 'SELECT_CHOICE_OPTION',
          playerId: 'p1',
          pendingChoiceId: ch!.id,
          selectedIds: ['opt_draw_1'],
        }).success
      ).toBe(true);
      expect(engine.getState().cards[orb.instanceId]!.zone).toBe('SIGNAL_ORB');
    });
  });

  describe('2. BP04-001 多对象升变与 BP02-067 多对象税计次 (Q&A·4)', () => {
    it('parseAscensionConfig 解析 BP04-001 为 allowMultiple/minCount=1，并支持同时重叠多张<露娜>', () => {
      const lunaDef = db.getCard('BP04-001')!;
      const parsed = parseAscensionConfig(lunaDef.rulesText);
      expect(parsed?.targetFilter.allowMultiple).toBe(true);
      expect(parsed?.targetFilter.minCount).toBe(1);

      const engine = createEngine(
        expandDeck('ST01', ['BP04-001', 'BP04-002', 'BP01-009', 'BP01-008', 'ST01-004']),
        expandDeck('ST02')
      );
      enterMainPhase(engine);
      const luna1 = placeRole(engine, 'p1', 'BP01-009', 0, { isReady: true });
      const luna2 = placeRole(engine, 'p1', 'BP01-008', 2, { isReady: true });
      const extraUnder = findCard(engine, 'p1', 'ST01-004');
      engine.zoneMgr.moveCard(extraUnder.instanceId, 'BATTLEFIELD', { isFaceUp: true, isReady: true });
      luna2.underneathCardIds = [extraUnder.instanceId];

      // VOID 属性明费 + 总 3 费
      const voidCost = findCard(engine, 'p1', 'BP04-002');
      engine.zoneMgr.moveCard(voidCost.instanceId, 'COST', { isFaceUp: true, isReady: true });
      fillCostZone(engine, 'p1', 4);

      const luna001 = findCard(engine, 'p1', 'BP04-001');
      engine.zoneMgr.moveCard(luna001.instanceId, 'HAND', { isFaceUp: true });

      expect(
        engine.dispatchAction({
          type: 'PLAY_CARD',
          playerId: 'p1',
          cardInstanceId: luna001.instanceId,
          isAscension: true,
          targetAscensionCardIds: [luna1.instanceId, luna2.instanceId],
        }).success
      ).toBe(true);

      const state = engine.getState();
      expect(state.battlefields['p1']![0]!.roleCardId).toBe(luna001.instanceId);
      expect(state.battlefields['p1']![2]!.roleCardId).toBeUndefined();
      expect(state.cards[luna001.instanceId]!.underneathCardIds).toEqual([
        luna1.instanceId,
        extraUnder.instanceId,
        luna2.instanceId,
      ]);
      expect(luna001.effectivePP).toBe(lunaDef.basePP! + 3000);
    });

    it('单对象升变传多目标被拒；对方 2 张横置 BP02-067 对多对象横置升变仅加 2 费 (Q&A·4)', () => {
      const engine = createEngine(
        expandDeck('ST01', ['BP04-001', 'BP04-002', 'BP01-009', 'BP01-008', 'ST01-001']),
        expandDeck('ST02', ['BP02-067', 'BP02-067'])
      );
      enterMainPhase(engine);
      const luna1 = placeRole(engine, 'p1', 'BP01-009', 0, { isReady: false });
      const luna2 = placeRole(engine, 'p1', 'BP01-008', 1, { isReady: false });
      placeRole(engine, 'p2', 'BP02-067', 0, { isReady: false });
      placeRole(engine, 'p2', 'BP02-067', 1, { isReady: false, instanceIndex: 1 });

      const luna001 = findCard(engine, 'p1', 'BP04-001');
      expect(
        engine.calculateCardCost('p1', luna001.instanceId, true, [luna1.instanceId, luna2.instanceId]).costToPay
      ).toBe(5); // 升变3费 + 2张横置 BP02-067 各+1 = 5（不随 2 个对象翻倍）

      // 单对象升变卡 BP01-008 传 2 个对象被拒
      const singleAsc = luna2;
      fillCostZone(engine, 'p1', 8);
      const st01 = findCard(engine, 'p1', 'ST01-001');
      engine.zoneMgr.moveCard(singleAsc.instanceId, 'HAND', { isFaceUp: true });
      const bad = engine.dispatchAction({
        type: 'PLAY_CARD',
        playerId: 'p1',
        cardInstanceId: singleAsc.instanceId,
        isAscension: true,
        targetAscensionCardIds: [luna1.instanceId, st01.instanceId],
      });
      expect(bad.success).toBe(false);
    });
  });

  describe('3. 8.6.2.a 墓地使用免除属性检查 & 浮空升变卡位校验', () => {
    it('费用区全为纯物理属性明费时，墓地的 BP02-036 与 BP02-026 可免属性使用；手牌暗属性卡仍受 8.6.2.a.1 拦截', () => {
      const engine = createEngine(
        expandDeck('ST01', ['BP02-036', 'BP02-036', 'BP02-036', 'BP02-027', 'BP02-026', 'BP02-028']),
        expandDeck('ST02')
      );
      ensurePlayerTurnCanAttack(engine, 'p1');
      // 显式先移走非 PHYSICAL 的费用并放入 6 张 ST01-007 (PHYSICAL)，保证无任何 DARK 明费
      for (const c of [...engine.zoneMgr.getCardsInZone('p1', 'COST')]) {
        engine.zoneMgr.moveCard(c.instanceId, 'DECK', { isFaceUp: false });
      }
      const phyCards = Object.values(engine.getState().cards).filter(
        (c) => c.controllerPlayerId === 'p1' && c.cardNumber === 'ST01-007' && c.zone === 'DECK'
      );
      for (const pc of phyCards.slice(0, 6)) {
        engine.zoneMgr.moveCard(pc.instanceId, 'COST', { isFaceUp: true, isReady: true });
      }
      engine.zoneMgr.syncCostStats('p1');

      const handDark = findCard(engine, 'p1', 'BP02-028');
      engine.zoneMgr.moveCard(handDark.instanceId, 'HAND', { isFaceUp: true });
      const handBlocked = engine.dispatchAction({
        type: 'PLAY_CARD',
        playerId: 'p1',
        cardInstanceId: handDark.instanceId,
      });
      expect(handBlocked.success).toBe(false);
      expect(handBlocked.error).toContain('8.6.2.a.1');

      // 墓地的暗属性潮涌球 BP02-036 免除属性条件，可在主要阶段使用
      const surge1 = findCard(engine, 'p1', 'BP02-036', 0);
      const surge2 = findCard(engine, 'p1', 'BP02-036', 1);
      const surge3 = findCard(engine, 'p1', 'BP02-036', 2);
      engine.zoneMgr.moveCard(surge1.instanceId, 'SIGNAL_ORB', { isFaceUp: true, isReady: true });
      engine.zoneMgr.moveCard(surge2.instanceId, 'SIGNAL_ORB', { isFaceUp: true, isReady: true });
      engine.zoneMgr.moveCard(surge3.instanceId, 'GRAVEYARD', { isFaceUp: true });

      expect(
        engine.dispatchAction({
          type: 'PLAY_CARD',
          playerId: 'p1',
          cardInstanceId: surge3.instanceId,
        }).success
      ).toBe(true);
      resolvePendingChoices(engine);
      expect(engine.getState().cards[surge3.instanceId]!.zone).toBe('SIGNAL_ORB');

      // 此时信号球区共有 3 张《潮涌球》，可免属性从墓地升变 暗属性 BP02-026
      const target27 = placeRole(engine, 'p1', 'BP02-027', 0, { isReady: true });
      const lamia026 = findCard(engine, 'p1', 'BP02-026');
      engine.zoneMgr.moveCard(lamia026.instanceId, 'GRAVEYARD', { isFaceUp: true });

      const ascRes = engine.dispatchAction({
        type: 'PLAY_CARD',
        playerId: 'p1',
        cardInstanceId: lamia026.instanceId,
        isAscension: true,
        targetAscensionCardId: target27.instanceId,
      });
      expect(ascRes.success, ascRes.error).toBe(true);
    });

    it('浮空模式对象升变指定已占用 targetSlotIndex 时被前置拦截，不扣除任何费用', () => {
      const engine = createEngine(
        expandDeck('ST01', ['BP03-001', 'BP03-006']),
        expandDeck('ST02')
      );
      enterMainPhase(engine);
      fillCostZone(engine, 'p1', 6);
      const occupied = placeRole(engine, 'p1', 'ST01-001', 0);
      const airborneRoleCard = placeRole(engine, 'p1', 'BP03-006', 1);
      expect(engine.fieldMgr.airborneRole(airborneRoleCard.instanceId)).toBe(true);
      expect(occupied.zone).toBe('BATTLEFIELD');

      const bp03001 = findCard(engine, 'p1', 'BP03-001');
      engine.zoneMgr.moveCard(bp03001.instanceId, 'HAND', { isFaceUp: true });
      const availBefore = engine.getState().players['p1']!.availableOpenCostCount;

      const res = engine.dispatchAction({
        type: 'PLAY_CARD',
        playerId: 'p1',
        cardInstanceId: bp03001.instanceId,
        isAscension: true,
        targetAscensionCardId: airborneRoleCard.instanceId,
        targetSlotIndex: 0,
      });
      expect(res.success).toBe(false);
      expect(engine.getState().players['p1']!.availableOpenCostCount).toBe(availBefore);
    });
  });

  describe('4. 牺牲减费全扫描、8.6.2.b 防腾位与 costCardInstanceIds 全路径透传', () => {
    it('BP02-041 可牺牲角色上装备的 BP02-047，BP04-060 可牺牲辅助机位 BP04-059', () => {
      // 1. BP02-041 牺牲宿主身上的装备 BP02-047 减 2 费
      {
        const engine = createEngine(
          expandDeck('ST01', ['BP02-041', 'BP02-047']),
          expandDeck('ST02')
        );
        enterMainPhase(engine);
        const host = placeRole(engine, 'p1', 'ST01-001', 0);
        const eq47 = findCard(engine, 'p1', 'BP02-047');
        expect(engine.fieldMgr.equipToRole('p1', eq47.instanceId, host.instanceId)).toBe(true);
        // 物理明费 + 共 4 费 (BP02-041 原 6 费，牺牲 BP02-047 减为 4 费)
        engine.zoneMgr.moveCard(findCard(engine, 'p1', 'BP02-041').instanceId, 'HAND', { isFaceUp: true });
        const phyCost = findCard(engine, 'p1', 'ST01-004'); // 临时先放入物理牌作为明费？用 BP02-047 不行，拿 2 张 BP02-047 中的另一张或者借 ST02 物理牌
        expect(phyCost).toBeDefined();
      }

      // 重新使用带 ST02 物理明费的卡组测试 BP02-041 牺牲独立/附着 BP02-047 与 BP04-060 牺牲辅助机 BP04-059
      {
        const engine = createEngine(
          expandDeck('ST02', ['BP02-041', 'BP02-047', 'BP04-059', 'BP04-060']),
          expandDeck('ST01')
        );
        enterMainPhase(engine);
        const state = engine.getState();
        const host = placeRole(engine, 'p1', 'ST02-001', 0);
        const eq47 = findCard(engine, 'p1', 'BP02-047');
        expect(engine.fieldMgr.equipToRole('p1', eq47.instanceId, host.instanceId)).toBe(true);
        fillCostZone(engine, 'p1', 4);

        const h041 = findCard(engine, 'p1', 'BP02-041');
        engine.zoneMgr.moveCard(h041.instanceId, 'HAND', { isFaceUp: true });
        expect(
          engine.dispatchAction({
            type: 'PLAY_CARD',
            playerId: 'p1',
            cardInstanceId: h041.instanceId,
          }).success
        ).toBe(true);
        const sacEqChoice = engine.getState().currentPendingChoice!;
        expect(sacEqChoice.effectType).toBe('PLAY_CARD_SACRIFICE_DISCOUNT');
        expect(sacEqChoice.options.map((o) => o.id)).toContain(eq47.instanceId);
        expect(
          engine.dispatchAction({
            type: 'SELECT_CHOICE_OPTION',
            playerId: 'p1',
            pendingChoiceId: sacEqChoice.id,
            selectedIds: [eq47.instanceId],
          }).success
        ).toBe(true);
        expect(state.cards[eq47.instanceId]!.zone).toBe('GRAVEYARD');
        expect(state.cards[h041.instanceId]!.zone).toBe('BATTLEFIELD');
      }

      // 2. BP04-060 牺牲辅助机位 BP04-059 (<神寂启示录>)
      {
        const engine = createEngine(
          expandDeck('ST02', ['BP04-059', 'BP04-060']),
          expandDeck('ST01')
        );
        enterMainPhase(engine);
        const assist59 = findCard(engine, 'p1', 'BP04-059');
        expect(engine.fieldMgr.playAssistCard('p1', assist59.instanceId, 1)).toBe(true);
        const darkCost = findCard(engine, 'p1', 'BP04-059'); // assist 在场，用 ignore 或找一张 DARK 放到 cost
        expect(darkCost.zone).toBe('BATTLEFIELD');

        // 再加一张 BP04-059(DARK) 或直接把 BP04-060 另放一张进 COST，这里直接新开一局带两张 BP04-059
        const eng2 = createEngine(
          expandDeck('ST02', ['BP04-059', 'BP04-059', 'BP04-060']),
          expandDeck('ST01')
        );
        enterMainPhase(eng2);
        const assistOnField = findCard(eng2, 'p1', 'BP04-059', 0);
        const darkCostCard = findCard(eng2, 'p1', 'BP04-059', 1);
        expect(eng2.fieldMgr.playAssistCard('p1', assistOnField.instanceId, 1)).toBe(true);
        eng2.zoneMgr.moveCard(darkCostCard.instanceId, 'COST', { isFaceUp: true, isReady: false }); // 横置无可用费用
        eng2.zoneMgr.syncCostStats('p1');

        const bloodTax = findCard(eng2, 'p1', 'BP04-060');
        eng2.zoneMgr.moveCard(bloodTax.instanceId, 'HAND', { isFaceUp: true });
        expect(
          eng2.dispatchAction({
            type: 'PLAY_CARD',
            playerId: 'p1',
            cardInstanceId: bloodTax.instanceId,
          }).success
        ).toBe(true);
        const ch = eng2.getState().currentPendingChoice!;
        expect(ch.effectType).toBe('PLAY_CARD_SACRIFICE_DISCOUNT');
        expect(ch.options.map((o) => o.id)).toContain(assistOnField.instanceId);
      }
    });

    it('BP02-012 可牺牲作为搭档的《丽芙·极昼》，满 5 槽拒绝牺牲腾位 (8.6.2.b / Q&A·7)，并精确透传 costCardInstanceIds', () => {
      // 1. 牺牲作为搭档的《丽芙·极昼》且精确扣指定的 costCardInstanceIds
      {
        const engine = createEngine(
          expandDeck('ST01', ['BP02-012', 'BP02-012', 'BP02-013', 'BP02-014']),
          expandDeck('ST02')
        );
        enterMainPhase(engine);
        const host = placeRole(engine, 'p1', 'ST01-001', 0);
        const partnerLiv = findCard(engine, 'p1', 'BP02-013');
        expect(engine.fieldMgr.attachPartner('p1', host.instanceId, partnerLiv.instanceId)).toBe(true);
        const fireCost = findCard(engine, 'p1', 'BP02-012', 1); // FIRE 明费
        engine.zoneMgr.moveCard(fireCost.instanceId, 'COST', { isFaceUp: true, isReady: true });
        fillCostZone(engine, 'p1', 6);
        const readyCosts = engine.zoneMgr.getCardsInZone('p1', 'COST').filter((c) => c.isFaceUp && c.isReady);
        const designatedCosts = readyCosts.slice(2, 6).map((c) => c.instanceId); // 精确指定末尾 4 张

        const liv012 = findCard(engine, 'p1', 'BP02-012', 0);
        engine.zoneMgr.moveCard(liv012.instanceId, 'HAND', { isFaceUp: true });
        expect(
          engine.dispatchAction({
            type: 'PLAY_CARD',
            playerId: 'p1',
            cardInstanceId: liv012.instanceId,
            costCardInstanceIds: designatedCosts,
          }).success
        ).toBe(true);

        const ch = engine.getState().currentPendingChoice!;
        expect(ch.effectType).toBe('PLAY_CARD_SACRIFICE_DISCOUNT');
        expect(ch.options.map((o) => o.id)).toContain(partnerLiv.instanceId);
        expect(
          engine.dispatchAction({
            type: 'SELECT_CHOICE_OPTION',
            playerId: 'p1',
            pendingChoiceId: ch.id,
            selectedIds: [partnerLiv.instanceId],
          }).success
        ).toBe(true);

        for (const id of designatedCosts) {
          expect(engine.getState().cards[id]!.isReady).toBe(false);
        }
        expect(readyCosts[0]!.isReady).toBe(true);
        expect(readyCosts[1]!.isReady).toBe(true);
      }

      // 2. 满 5 个卡位时使用 BP02-012 在付代价前直接被 8.6.2.b.1 拒绝
      {
        const engine = createEngine(
          expandDeck('ST01', ['BP02-012', 'BP02-012', 'BP02-013']),
          expandDeck('ST02')
        );
        enterMainPhase(engine);
        placeRole(engine, 'p1', 'BP02-013', 0);
        placeRole(engine, 'p1', 'ST01-002', 1);
        placeRole(engine, 'p1', 'ST01-003', 2);
        placeRole(engine, 'p1', 'ST01-004', 3);
        placeRole(engine, 'p1', 'ST01-005', 4);
        const fireCost = findCard(engine, 'p1', 'BP02-012', 1);
        engine.zoneMgr.moveCard(fireCost.instanceId, 'COST', { isFaceUp: true, isReady: true });
        fillCostZone(engine, 'p1', 6);

        const liv012 = findCard(engine, 'p1', 'BP02-012', 0);
        engine.zoneMgr.moveCard(liv012.instanceId, 'HAND', { isFaceUp: true });
        const blocked = engine.dispatchAction({
          type: 'PLAY_CARD',
          playerId: 'p1',
          cardInstanceId: liv012.instanceId,
        });
        expect(blocked.success).toBe(false);
        expect(blocked.error).toContain('8.6.2.b.1');
      }

      // 3. 弃牌减费 BP01-067 与声明式 ACTIVATE_ABILITY (BP04-071 2费手牌浮空) 均精确透传 costCardInstanceIds
      {
        const engine = createEngine(
          expandDeck('ST02', ['BP01-067', 'BP01-056', 'BP04-071']),
          expandDeck('ST01')
        );
        enterMainPhase(engine);
        placeRole(engine, 'p2', 'ST01-001', 0);

        // 先将实验用卡移入手牌，避免 fillCostZone 从牌库抽到它们导致手牌与费用列表错位
        const dream = findCard(engine, 'p1', 'BP01-056');
        engine.zoneMgr.moveCard(dream.instanceId, 'HAND', { isFaceUp: true });
        const bp01067 = findCard(engine, 'p1', 'BP01-067');
        engine.zoneMgr.moveCard(bp01067.instanceId, 'HAND', { isFaceUp: true });
        const liv071 = findCard(engine, 'p1', 'BP04-071');
        engine.zoneMgr.moveCard(liv071.instanceId, 'HAND', { isFaceUp: true });

        fillCostZone(engine, 'p1', 8);
        const costs = engine.zoneMgr.getCardsInZone('p1', 'COST').filter((c) => c.isFaceUp && c.isReady);
        const pickedFor67 = costs.slice(3, 8).map((c) => c.instanceId);

        expect(
          engine.dispatchAction({
            type: 'PLAY_CARD',
            playerId: 'p1',
            cardInstanceId: bp01067.instanceId,
            costCardInstanceIds: pickedFor67,
          }).success
        ).toBe(true);
        const ch = engine.getState().currentPendingChoice!;
        expect(
          engine.dispatchAction({
            type: 'SELECT_CHOICE_OPTION',
            playerId: 'p1',
            pendingChoiceId: ch.id,
            selectedIds: [dream.instanceId],
          }).success
        ).toBe(true);
        resolvePendingChoices(engine);
        for (const id of pickedFor67) {
          expect(engine.getState().cards[id]!.isReady).toBe(false);
        }
        expect(engine.getState().cards[costs[0]!.instanceId]!.isReady).toBe(true);

        // 声明式 ACTIVATE_ABILITY 精确传剩下一张与指定费用
        const pickedForAct = [costs[1]!.instanceId, costs[2]!.instanceId];
        expect(
          engine.dispatchAction({
            type: 'ACTIVATE_ABILITY',
            playerId: 'p1',
            sourceCardId: liv071.instanceId,
            abilityIndex: 0,
            costCardInstanceIds: pickedForAct,
          }).success
        ).toBe(true);
        expect(engine.getState().cards[costs[1]!.instanceId]!.isReady).toBe(false);
        expect(engine.getState().cards[costs[2]!.instanceId]!.isReady).toBe(false);
        expect(engine.getState().cards[costs[0]!.instanceId]!.isReady).toBe(true);
      }
    });
  });

  describe('5. 10.18.3.b 浮空下方牌不污染 PROCESSING & Q&A·8 attachPartner 防解除', () => {
    it('10.18.3.b：带下方牌与装备浮空时，getCardsInZone(p1, PROCESSING) 仅返回浮空模式本体', () => {
      const engine = createEngine(expandDeck('ST01', ['ST01-011']), expandDeck('ST02'));
      enterMainPhase(engine);
      const host = placeRole(engine, 'p1', 'ST01-001', 0);
      const under = findCard(engine, 'p1', 'ST01-003');
      const eq = findCard(engine, 'p1', 'ST01-011');
      engine.zoneMgr.moveCard(under.instanceId, 'BATTLEFIELD', { isFaceUp: true, isReady: true });
      host.underneathCardIds = [under.instanceId];
      expect(engine.fieldMgr.equipToRole('p1', eq.instanceId, host.instanceId)).toBe(true);

      expect(engine.fieldMgr.airborneRole(host.instanceId)).toBe(true);
      const proc = engine.zoneMgr.getCardsInZone('p1', 'PROCESSING');
      expect(proc.map((c) => c.instanceId)).toEqual([host.instanceId]);
      expect(under.zone).toBe('PROCESSING');
      expect(eq.zone).toBe('PROCESSING');
    });

    it('Q&A·8 / Q&A·9：ST06-002 从手牌绑定 ST06-001 后，通过 attachPartner / BP04-049 换搭档被拒且原搭档保留', () => {
      const engine = createEngine(
        expandDeck('ST02', ['ST06-001', 'ST06-002', 'ST06-006', 'BP04-049', 'BP04-049']),
        expandDeck('ST02')
      );
      ensurePlayerTurnCanAttack(engine, 'p2');
      const state = engine.getState();
      fillCostZone(engine, 'p1', 6);
      const arisa001 = placeRole(engine, 'p1', 'ST06-001', 0, { isReady: false }); // 坠落与新生 亚里莎·回音
      const cecili002 = findCard(engine, 'p1', 'ST06-002'); // 坠落与新生 塞西莉
      const altCecili = findCard(engine, 'p1', 'ST06-006'); // 另一张塞西莉
      engine.zoneMgr.moveCard(cecili002.instanceId, 'HAND', { isFaceUp: true });
      engine.zoneMgr.moveCard(altCecili.instanceId, 'HAND', { isFaceUp: true });

      // 先由对方回合 BP04-049 将手牌 ST06-002 设为 ST06-001 搭档 -> 自动触发防解除保护
      expect(engine.fieldMgr.attachPartner('p1', arisa001.instanceId, cecili002.instanceId)).toBe(true);
      expect(engine.fieldMgr.isPartnerProtectedFromRelease(arisa001.instanceId)).toBe(true);

      // 直接调用 attachPartner 试图替换新搭档应返回 false，altCecili 留手牌，ST06-002 保持协战
      expect(engine.fieldMgr.attachPartner('p1', arisa001.instanceId, altCecili.instanceId)).toBe(false);
      expect(altCecili.zone).toBe('HAND');
      expect(arisa001.partnerCardId).toBe(cecili002.instanceId);
      expect(cecili002.zone).toBe('BATTLEFIELD');

      // Q&A·9：用 BP04-049 在对方回合试图改挂 altCecili，防解除保护使换搭档不执行，但「那之后，若其为协战状态，可以将其竖直」仍照常执行！
      const oppAtk = placeRole(engine, 'p2', 'ST02-001', 0, { isReady: true });
      const b49 = findCard(engine, 'p1', 'BP04-049');
      engine.zoneMgr.moveCard(b49.instanceId, 'HAND', { isFaceUp: true });
      expect(
        engine.dispatchAction({
          type: 'DECLARE_ATTACK',
          playerId: 'p2',
          attackerCardId: oppAtk.instanceId,
          targetType: 'PLAYER',
        }).success
      ).toBe(true);
      if (state.timingWindow?.priorityPlayerId === 'p2') {
        expect(engine.dispatchAction({ type: 'PASS_ACTION_TIMING', playerId: 'p2' }).success).toBe(true);
      }
      expect(
        engine.dispatchAction({
          type: 'PLAY_CARD',
          playerId: 'p1',
          cardInstanceId: b49.instanceId,
        }).success
      ).toBe(true);
      // 选模式 1 (<亚里莎>选<塞西莉>) -> 选 arisa001 -> 选 altCecili -> 确认竖直 arisa001
      const mCh = engine.getState().currentPendingChoice!;
      expect(
        engine.dispatchAction({
          type: 'SELECT_CHOICE_OPTION',
          playerId: 'p1',
          pendingChoiceId: mCh.id,
          selectedIds: [mCh.options[0]!.id],
        }).success
      ).toBe(true);
      const hCh = engine.getState().currentPendingChoice!;
      expect(
        engine.dispatchAction({
          type: 'SELECT_CHOICE_OPTION',
          playerId: 'p1',
          pendingChoiceId: hCh.id,
          selectedIds: [arisa001.instanceId],
        }).success
      ).toBe(true);
      const pCh = engine.getState().currentPendingChoice!;
      expect(
        engine.dispatchAction({
          type: 'SELECT_CHOICE_OPTION',
          playerId: 'p1',
          pendingChoiceId: pCh.id,
          selectedIds: [altCecili.instanceId],
        }).success
      ).toBe(true);
      const readyCh = engine.getState().currentPendingChoice;
      expect(readyCh?.effectType).toBe('DSL_BP04_049_UNTAP_arisa_host');
      expect(
        engine.dispatchAction({
          type: 'SELECT_CHOICE_OPTION',
          playerId: 'p1',
          pendingChoiceId: readyCh!.id,
          selectedIds: ['opt_yes'],
        }).success
      ).toBe(true);

      expect(engine.getState().cards[altCecili.instanceId]!.zone).toBe('HAND');
      expect(engine.getState().cards[arisa001.instanceId]!.partnerCardId).toBe(cecili002.instanceId);
      expect(engine.getState().cards[arisa001.instanceId]!.isReady).toBe(true);
    });
  });

  describe('6. hasUsableInstant 实时费用同步与减费同步', () => {
    it('行动内触发效果竖直费用区后立即进入瞬时窗时，continueFlow 先同步费用且保留优先权', () => {
      const engine = createEngine(
        expandDeck('ST01', ['ST05-010', 'ST05-010']),
        expandDeck('ST02')
      );
      ensurePlayerTurnCanAttack(engine, 'p1');
      const state = engine.getState();

      // 让 p1 明费全部置为横置 (初始可用费用 0)，并在费用区放 1 张横置暗属性牌，手牌保有 1 费暗属性瞬时 ST05-010
      const atk = placeRole(engine, 'p1', 'ST01-001', 0, { isReady: true });
      for (const c of [...engine.zoneMgr.getCardsInZone('p1', 'COST')]) {
        engine.zoneMgr.setCardReady(c.instanceId, false);
      }
      const tappedCost = findCard(engine, 'p1', 'ST05-010', 0);
      engine.zoneMgr.moveCard(tappedCost.instanceId, 'COST', { isFaceUp: true, isReady: false });
      engine.zoneMgr.syncCostStats('p1');
      expect(state.players['p1']!.availableOpenCostCount).toBe(0);

      const instant510 = findCard(engine, 'p1', 'ST05-010', 1);
      engine.zoneMgr.moveCard(instant510.instanceId, 'HAND', { isFaceUp: true });

      // 攻击时触发不主动调 syncCostStats 直接把 tappedCost.isReady 设回 true，验证 continueFlow 先 sync 再判 hasUsableInstant
      engine.triggerMgr.registerTrigger({
        abilityId: 'test:ready-cost-on-attack',
        eventTypes: ['ATTACK_DECLARED'],
        collect: () => [
          {
            sourceCardInstanceId: atk.instanceId,
            sourceCardNumber: atk.cardNumber,
            controllerPlayerId: 'p1',
            label: '攻击时直接竖直1张费用区卡牌',
            triggerContext: {},
          },
        ],
        execute: () => {
          tappedCost.isReady = true;
        },
      });

      expect(
        engine.dispatchAction({
          type: 'DECLARE_ATTACK',
          playerId: 'p1',
          attackerCardId: atk.instanceId,
          targetType: 'PLAYER',
        }).success
      ).toBe(true);

      // 若未提前 syncCostStats，p1 会被误判 0 费自动跳过；修复后 p1 正确保留瞬时窗优先权
      expect(engine.getState().timingWindow?.kind).toBe('FREE_TIMING');
      expect(engine.getState().timingWindow?.priorityPlayerId).toBe('p1');
      expect(engine.getState().players['p1']!.availableOpenCostCount).toBe(1);
    });
  });
});

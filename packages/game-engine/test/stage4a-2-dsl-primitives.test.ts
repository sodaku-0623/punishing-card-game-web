import { describe, expect, it } from 'vitest';
import { CardType } from '@zhanshuang/shared';
import { OFFICIAL_STARTER_DECKS } from '@zhanshuang/game-rules';
import {
  CardEffectSpec,
  DeclarativeEffectInterpreter,
  GameEngine,
  MemoryCardDatabase,
  OFFICIAL_CARDS_DATA,
  addCardModifier,
  advancePendingChoice,
  enqueuePendingChoice,
  sanitizeGameStateForPlayer,
  validateCardEffectRegistry,
  validateCardEffectSpec,
} from '../src/index.js';
import { endTurn, fillCostZone, passInstantWindows, resolvePendingChoices } from './helpers.js';

const db = new MemoryCardDatabase(OFFICIAL_CARDS_DATA);

function expandDeck(code: 'ST01' | 'ST02' | 'ST03' = 'ST01', extras: string[] = []): string[] {
  const deck = OFFICIAL_STARTER_DECKS.find((d) => d.name.includes(`(${code})`));
  if (!deck) {
    throw new Error(`未找到预组 ${code}`);
  }
  const base = deck.cards.flatMap((entry) => Array.from({ length: entry.count }, () => entry.cardNumber));
  const out = [...base];
  for (let i = 0; i < extras.length && i < out.length; i++) {
    out[out.length - 1 - i] = extras[i]!;
  }
  return out;
}

function createEngine(p1Deck: string[], p2Deck: string[], seed = 20261126): GameEngine {
  const engine = new GameEngine(
    'stage4a-2-test',
    { playerId: 'p1', deckCardNumbers: p1Deck },
    { playerId: 'p2', deckCardNumbers: p2Deck },
    seed,
    db,
    { skipMulligan: true }
  );
  const state = engine.getState();
  if (state.phase === 'DRAW_CHARGE_PHASE') {
    engine.dispatchAction({ type: 'PASS_ACTION_TIMING', playerId: state.activePlayerId });
  }
  return engine;
}

function advanceToP1AttackableMainPhase(engine: GameEngine): void {
  for (let i = 0; i < 6; i++) {
    const s = engine.getState();
    if (s.turnNumber >= 2 && s.activePlayerId === 'p1' && s.phase === 'MAIN_PHASE') return;
    endTurn(engine);
    resolvePendingChoices(engine);
    if (engine.getState().phase === 'DRAW_CHARGE_PHASE') {
      engine.dispatchAction({
        type: 'PASS_ACTION_TIMING',
        playerId: engine.getState().activePlayerId,
      });
    }
    resolvePendingChoices(engine);
  }
  throw new Error('未能推进到 p1 可攻击主要阶段');
}

function findCard(engine: GameEngine, playerId: string, cardNumber: string, index = 0) {
  const list = Object.values(engine.getState().cards).filter(
    (c) => c.controllerPlayerId === playerId && c.cardNumber === cardNumber
  );
  const card = list[index];
  if (!card) throw new Error(`未找到玩家 ${playerId} 的第 ${index} 张 ${cardNumber}`);
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
  expect(
    engine.fieldMgr.playRoleCard(playerId, card.instanceId, slotIndex, { suppressEntryTrigger: true })
  ).toBe(true);
  if (options?.enteredEarlier !== false) {
    card.turnEnteredZone = 0;
  }
  if (options?.isReady !== undefined) {
    card.isReady = options.isReady;
  }
  return card;
}

function putNonChargeAutoOnDeckTop(engine: GameEngine, playerId: string, count = 3): void {
  const nonOrbs = engine.zoneMgr
    .getCardsInZone(playerId, 'DECK')
    .filter((c) => !db.getCard(c.cardNumber)?.signalOrb)
    .slice(0, count);
  for (const c of nonOrbs) {
    engine.zoneMgr.moveCardToTopOfDeck(c.instanceId);
  }
}

function createCustomInterpreter(
  engine: GameEngine,
  specs: CardEffectSpec[]
): DeclarativeEffectInterpreter {
  const state = engine.getState();
  const registry = validateCardEffectRegistry(specs);
  return new DeclarativeEffectInterpreter(
    {
      state,
      zoneMgr: engine.zoneMgr,
      fieldMgr: engine.fieldMgr,
      cardDb: db,
      events: engine.events,
      continuousEffects: engine.continuousEffects,
      triggerMgr: engine.triggerMgr,
      replacementEngine: engine.replacementEngine,
      payCost: (p, c, sel) => engine.payCost(p, c, sel),
      setPendingChoice: (ch) => {
        if (ch) enqueuePendingChoice(state, ch);
        else advancePendingChoice(state);
      },
    },
    engine.effectEngine,
    registry
  );
}

function makeBaseSpec(overrides: Partial<CardEffectSpec> = {}): CardEffectSpec {
  return {
    cardNumber: 'TEST-4A2-001',
    name: '测试卡',
    ...overrides,
  };
}

describe('Stage 4A-2: 缺失通用原语、可挂起通用置换与战斗破坏暂停', () => {
  describe('1. 战斗状态、升变与协战来源筛选器', () => {
    it('isAttacking / isBeingAttacked / isInCombat 在攻击阶段准确命中攻击者与被攻击者并排除旁观角色', () => {
      const engine = createEngine(
        expandDeck('ST01', ['ST01-001', 'ST01-002', 'ST01-008']),
        expandDeck('ST02', ['ST02-001', 'ST02-004'])
      );
      const state = engine.getState();
      const attacker = placeRole(engine, 'p1', 'ST01-001', 0, { isReady: true });
      const bystanderP1 = placeRole(engine, 'p1', 'ST01-002', 1, { isReady: true });
      const defender = placeRole(engine, 'p2', 'ST02-001', 0, { isReady: false });
      const bystanderP2 = placeRole(engine, 'p2', 'ST02-004', 1, { isReady: false });

      const interp = createCustomInterpreter(engine, [
        makeBaseSpec({
          cardNumber: 'ST01-008',
          name: '战斗状态查询测试',
          tactics: [
            {
              op: 'MODIFY_STATS',
              target: { kind: 'ALL_MATCHING_ROLES', side: 'SELF', filter: { isAttacking: true } },
              pp: 1000,
              duration: 'END_OF_TURN',
            },
            {
              op: 'MODIFY_STATS',
              target: { kind: 'ALL_MATCHING_ROLES', side: 'OPPONENT', filter: { isBeingAttacked: true } },
              pp: -500,
              duration: 'END_OF_TURN',
            },
            {
              op: 'MODIFY_STATS',
              target: { kind: 'ALL_MATCHING_ROLES', side: 'SELF', filter: { isInCombat: true } },
              dp: 1,
              duration: 'END_OF_TURN',
            },
            {
              op: 'MODIFY_STATS',
              target: { kind: 'ALL_MATCHING_ROLES', side: 'OPPONENT', filter: { isInCombat: true } },
              dp: 1,
              duration: 'END_OF_TURN',
            },
            {
              op: 'MODIFY_STATS',
              target: { kind: 'ALL_MATCHING_ROLES', side: 'SELF', filter: { isInCombat: false } },
              pp: 200,
              duration: 'END_OF_TURN',
            },
            {
              op: 'MODIFY_STATS',
              target: { kind: 'ALL_MATCHING_ROLES', side: 'OPPONENT', filter: { isInCombat: false } },
              pp: 200,
              duration: 'END_OF_TURN',
            },
          ],
        }),
      ]);

      advanceToP1AttackableMainPhase(engine);
      expect(
        engine.dispatchAction({
          type: 'DECLARE_ATTACK',
          playerId: 'p1',
          attackerCardId: attacker.instanceId,
          targetType: 'CHARACTER',
          targetCardId: defender.instanceId,
        }).success
      ).toBe(true);
      expect(state.currentCombat).toBeDefined();

      const tac = findCard(engine, 'p1', 'ST01-008');
      const res = interp.playTactics('p1', tac.instanceId, db.getCard('ST01-008')!);
      expect(res.success, res.error).toBe(true);

      // 攻击者命中 isAttacking + isInCombat
      expect(attacker.modifiers?.some((m) => m.pp === 1000)).toBe(true);
      expect(attacker.modifiers?.some((m) => m.dp === 1)).toBe(true);
      expect(attacker.modifiers?.some((m) => m.pp === 200)).toBe(false);

      // 被攻击者命中 isBeingAttacked + isInCombat
      expect(defender.modifiers?.some((m) => m.pp === -500)).toBe(true);
      expect(defender.modifiers?.some((m) => m.dp === 1)).toBe(true);
      expect(defender.modifiers?.some((m) => m.pp === 200)).toBe(false);

      // 旁观角色仅命中 isInCombat: false
      expect(bystanderP1.modifiers?.some((m) => m.pp === 200)).toBe(true);
      expect(bystanderP1.modifiers?.some((m) => m.pp === 1000 || m.dp === 1)).toBe(false);
      expect(bystanderP2.modifiers?.some((m) => m.pp === 200)).toBe(true);
      expect(bystanderP2.modifiers?.some((m) => m.pp === -500 || m.dp === 1)).toBe(false);
    });

    it('wasAscendedPlay / enteredFromZones / ascendedFromAirborne 区分真升变、来源区域与浮空升变', () => {
      const engine = createEngine(
        expandDeck('ST01', ['BP01-015', 'BP01-017', 'BP03-002', 'BP03-001', 'BP01-018', 'BP03-003', 'ST01-008']),
        expandDeck('ST02')
      );
      const state = engine.getState();
      const lightningCost = findCard(engine, 'p1', 'BP01-018');
      const fireCost = findCard(engine, 'p1', 'BP03-003');
      engine.zoneMgr.moveCard(lightningCost.instanceId, 'COST', { isFaceUp: true, isReady: true });
      engine.zoneMgr.moveCard(fireCost.instanceId, 'COST', { isFaceUp: true, isReady: true });
      fillCostZone(engine, 'p1', 10);

      // 1) 普通手牌出场 BP01-015：wasAscendedPlay=false, enteredFromZones=['HAND']
      const lucia15 = findCard(engine, 'p1', 'BP01-015');
      engine.zoneMgr.moveCard(lucia15.instanceId, 'HAND', { isFaceUp: true });
      if (state.activePlayerId !== 'p1') {
        advanceToP1AttackableMainPhase(engine);
      }
      const play15Res = engine.dispatchAction({
        type: 'PLAY_CARD',
        playerId: 'p1',
        cardInstanceId: lucia15.instanceId,
      });
      expect(play15Res.success, play15Res.error).toBe(true);
      resolvePendingChoices(engine);
      expect(Boolean(lucia15.wasAscendedPlay)).toBe(false);
      expect(lucia15.enteredFromZone).toBe('HAND');

      // 2) 手牌升变 BP01-017 到 BP01-015 上：wasAscendedPlay=true, enteredFromZones=['HAND'], ascendedFromAirborne=false
      const lucia17 = findCard(engine, 'p1', 'BP01-017');
      engine.zoneMgr.moveCard(lucia17.instanceId, 'HAND', { isFaceUp: true });
      const asc17Res = engine.dispatchAction({
        type: 'PLAY_CARD',
        playerId: 'p1',
        cardInstanceId: lucia17.instanceId,
        isAscension: true,
        targetAscensionCardId: lucia15.instanceId,
      });
      expect(asc17Res.success, asc17Res.error).toBe(true);
      resolvePendingChoices(engine);
      expect(lucia17.wasAscendedPlay).toBe(true);
      expect(lucia17.enteredFromZone).toBe('HAND');
      expect(Boolean(lucia17.ascendedFromAirborne)).toBe(false);

      // 3) 浮空状态角色上直接升变 BP03-001 -> BP03-002：wasAscendedPlay=true, ascendedFromAirborne=true
      const lucia002 = findCard(engine, 'p1', 'BP03-002');
      engine.zoneMgr.moveCard(lucia002.instanceId, 'PROCESSING', { isFaceUp: true });
      lucia002.isAirborne = true;
      const lucia001 = findCard(engine, 'p1', 'BP03-001');
      engine.zoneMgr.moveCard(lucia001.instanceId, 'HAND', { isFaceUp: true });
      // 补足竖直明费以便支付升变费用
      for (const c of engine.zoneMgr.getCardsInZone('p1', 'COST')) {
        if (c.isFaceUp) c.isReady = true;
      }
      engine.zoneMgr.syncCostStats('p1');
      const asc001Res = engine.dispatchAction({
        type: 'PLAY_CARD',
        playerId: 'p1',
        cardInstanceId: lucia001.instanceId,
        isAscension: true,
        targetAscensionCardId: lucia002.instanceId,
      });
      expect(asc001Res.success, asc001Res.error).toBe(true);
      resolvePendingChoices(engine);
      expect(lucia001.wasAscendedPlay).toBe(true);
      expect(lucia001.ascendedFromAirborne).toBe(true);

      const interp = createCustomInterpreter(engine, [
        makeBaseSpec({
          cardNumber: 'ST01-008',
          name: '升变筛选测试',
          tactics: [
            {
              op: 'MODIFY_STATS',
              target: { kind: 'ALL_MATCHING_ROLES', side: 'SELF', filter: { wasAscendedPlay: true } },
              pp: 500,
              duration: 'END_OF_TURN',
            },
            {
              op: 'MODIFY_STATS',
              target: { kind: 'ALL_MATCHING_ROLES', side: 'SELF', filter: { ascendedFromAirborne: true } },
              pp: 1500,
              duration: 'END_OF_TURN',
            },
            {
              op: 'MODIFY_STATS',
              target: { kind: 'ALL_MATCHING_ROLES', side: 'SELF', filter: { enteredFromZones: ['HAND'] } },
              dp: 1,
              duration: 'END_OF_TURN',
            },
          ],
        }),
      ]);
      const tac = findCard(engine, 'p1', 'ST01-008');
      expect(interp.playTactics('p1', tac.instanceId, db.getCard('ST01-008')!).success).toBe(true);

      expect(lucia17.modifiers?.some((m) => m.pp === 500)).toBe(true);
      expect(lucia17.modifiers?.some((m) => m.pp === 1500)).toBe(false);
      expect(lucia17.modifiers?.some((m) => m.dp === 1)).toBe(true);

      expect(lucia001.modifiers?.some((m) => m.pp === 500)).toBe(true);
      expect(lucia001.modifiers?.some((m) => m.pp === 1500)).toBe(true);
      expect(state.cards[lucia001.instanceId]?.zone).toBe('BATTLEFIELD');
    });

    it('SELF_BECAME_PARTNER / SELF_GAINED_PARTNER fromZones 与 PARTNER_FROM_ZONE 精确区分 HAND 与 GRAVEYARD 来源', () => {
      const engine = createEngine(
        expandDeck('ST01', ['ST06-001', 'ST06-004', 'ST06-005']),
        expandDeck('ST01')
      );
      const state = engine.getState();

      const interp = createCustomInterpreter(engine, [
        makeBaseSpec({
          cardNumber: 'ST06-004',
          name: '搭档来源测试',
          triggers: [
            {
              abilityId: 'test:became_partner_from_hand',
              eventType: 'PARTNER_GAINED',
              matcher: { kind: 'SELF_BECAME_PARTNER', fromZones: ['HAND'] },
              label: '仅手牌成为搭档抽1',
              steps: [{ op: 'DRAW', count: 1 }],
            },
          ],
        }),
        makeBaseSpec({
          cardNumber: 'ST06-001',
          name: '宿主来源测试',
          triggers: [
            {
              abilityId: 'test:gained_partner_from_hand',
              eventType: 'PARTNER_GAINED',
              matcher: { kind: 'SELF_GAINED_PARTNER', fromZones: ['HAND'] },
              label: '宿主仅手牌获得搭档时加攻',
              steps: [
                {
                  op: 'IF',
                  condition: { kind: 'PARTNER_FROM_ZONE', zones: ['HAND'] },
                  then: [
                    {
                      op: 'MODIFY_STATS',
                      target: { kind: 'SELF' },
                      pp: 2000,
                      duration: 'END_OF_TURN',
                    },
                  ],
                },
              ],
            },
          ],
        }),
      ]);
      interp.registerTriggers(engine.triggerMgr);

      const host = placeRole(engine, 'p1', 'ST06-001', 0, { isReady: true });
      const partnerFromGy = findCard(engine, 'p1', 'ST06-004');
      const partnerFromHand = findCard(engine, 'p1', 'ST06-005');

      // 先测试从 GRAVEYARD 成为搭档：不得触发 fromZones=['HAND'] 的触发器
      engine.zoneMgr.moveCard(partnerFromGy.instanceId, 'GRAVEYARD', { isFaceUp: true });
      const handCountBefore = engine.zoneMgr.getCardsInZone('p1', 'HAND').length;
      state.pendingTriggers = [];
      expect(engine.fieldMgr.attachPartner('p1', host.instanceId, partnerFromGy.instanceId)).toBe(true);
      engine.triggerMgr.emit({
        type: 'PARTNER_GAINED',
        playerId: 'p1',
        cardInstanceId: host.instanceId,
        targetCardId: partnerFromGy.instanceId,
        fromZone: 'GRAVEYARD',
      });
      expect(state.pendingTriggers.some((t) => t.abilityId === 'test:became_partner_from_hand')).toBe(false);
      expect(state.pendingTriggers.some((t) => t.abilityId === 'test:gained_partner_from_hand')).toBe(false);
      engine.checkTimingMgr.resolveCheckTiming();
      expect(engine.zoneMgr.getCardsInZone('p1', 'HAND').length).toBe(handCountBefore);
      expect(host.modifiers?.some((m) => m.pp === 2000)).toBeFalsy();

      // 解除后改用从 HAND 成为 ST06-004 搭档：应触发 SELF_BECAME_PARTNER 与 SELF_GAINED_PARTNER
      engine.fieldMgr.releasePartner(host.instanceId, false);
      engine.zoneMgr.moveCard(partnerFromGy.instanceId, 'HAND', { isFaceUp: true });
      expect(engine.fieldMgr.attachPartner('p1', host.instanceId, partnerFromGy.instanceId)).toBe(true);
      engine.triggerMgr.emit({
        type: 'PARTNER_GAINED',
        playerId: 'p1',
        cardInstanceId: host.instanceId,
        targetCardId: partnerFromGy.instanceId,
        fromZone: 'HAND',
      });
      expect(state.pendingTriggers.some((t) => t.abilityId === 'test:became_partner_from_hand')).toBe(true);
      expect(state.pendingTriggers.some((t) => t.abilityId === 'test:gained_partner_from_hand')).toBe(true);
      engine.checkTimingMgr.resolveCheckTiming();
      resolvePendingChoices(engine);
      expect(engine.zoneMgr.getCardsInZone('p1', 'HAND').length).toBe(handCountBefore + 1); // moveCard进手牌+1、成搭档-1、抽1+1
      expect(host.modifiers?.some((m) => m.pp === 2000)).toBe(true);
      expect(partnerFromHand.zone).toBe('DECK');
    });
  });

  describe('2. uniqueCardNumbers + extractCoreCardNumber 去重校验', () => {
    it('CHOOSE_ROLES / CHOOSE_ZONE_CARDS / UNDERNEATH_COUNT_MULT 拒绝同核心卡号异画或【冠军】', () => {
      const engine = createEngine(
        expandDeck('ST01', ['BP02-022', 'BP02-022【冠军】', 'ST01-002', 'ST01-008', 'ST01-009']),
        expandDeck('ST02')
      );
      const state = engine.getState();

      const b022 = findCard(engine, 'p1', 'BP02-022');
      const b022Champ = findCard(engine, 'p1', 'BP02-022【冠军】');
      const otherRole = findCard(engine, 'p1', 'ST01-002');
      const host = placeRole(engine, 'p1', 'ST01-001', 0, { isReady: true });

      const interp = createCustomInterpreter(engine, [
        makeBaseSpec({
          cardNumber: 'ST01-008',
          name: '不同编号角色多选测试',
          tactics: [
            {
              op: 'CHOOSE_ROLES',
              side: 'SELF',
              prompt: '请选择 2 张核心卡号不同的角色',
              min: 2,
              max: 2,
              uniqueCardNumbers: true,
              saveToVar: 'picked',
            },
            {
              op: 'MODIFY_STATS',
              target: { kind: 'VAR', varName: 'picked' },
              pp: 1000,
              duration: 'END_OF_TURN',
            },
          ],
        }),
        makeBaseSpec({
          cardNumber: 'ST01-009',
          name: '不同编号墓地多选测试',
          tactics: [
            {
              op: 'CHOOSE_ZONE_CARDS',
              side: 'SELF',
              zone: 'GRAVEYARD',
              prompt: '请选择 2 张核心卡号不同的墓地牌',
              min: 2,
              max: 2,
              uniqueCardNumbers: true,
              saveToVar: 'gyPicked',
            },
            {
              op: 'MOVE_CARDS',
              target: { kind: 'VAR', varName: 'gyPicked' },
              toZone: 'HAND',
              isFaceUp: true,
            },
          ],
        }),
      ]);

      // 1) CHOOSE_ROLES: 场上放 BP02-022、BP02-022【冠军】、ST01-002
      engine.zoneMgr.moveCard(b022.instanceId, 'HAND', { isFaceUp: true });
      engine.fieldMgr.playRoleCard('p1', b022.instanceId, 1, { suppressEntryTrigger: true });
      engine.zoneMgr.moveCard(b022Champ.instanceId, 'HAND', { isFaceUp: true });
      engine.fieldMgr.playRoleCard('p1', b022Champ.instanceId, 2, { suppressEntryTrigger: true });
      engine.zoneMgr.moveCard(otherRole.instanceId, 'HAND', { isFaceUp: true });
      engine.fieldMgr.playRoleCard('p1', otherRole.instanceId, 3, { suppressEntryTrigger: true });

      const tac1 = findCard(engine, 'p1', 'ST01-008');
      expect(interp.playTactics('p1', tac1.instanceId, db.getCard('ST01-008')!).success).toBe(true);
      const ch1 = state.currentPendingChoice!;
      expect(ch1).toBeDefined();

      // 选同核心编号 BP02-022 + BP02-022【冠军】必须被拒绝
      const badPick1 = engine.dispatchAction({
        type: 'SELECT_CHOICE_OPTION',
        playerId: 'p1',
        pendingChoiceId: ch1.id,
        selectedIds: [b022.instanceId, b022Champ.instanceId],
      });
      expect(badPick1.success).toBe(false);

      // 选不同核心编号 BP02-022 + ST01-002 成功（注意 badPick1 回滚后须按 ID 重新取 state.cards 引用）
      const goodPick1 = engine.dispatchAction({
        type: 'SELECT_CHOICE_OPTION',
        playerId: 'p1',
        pendingChoiceId: ch1.id,
        selectedIds: [b022.instanceId, otherRole.instanceId],
      });
      expect(goodPick1.success, goodPick1.error).toBe(true);
      expect(engine.getState().cards[b022.instanceId]!.modifiers?.some((m) => m.pp === 1000)).toBe(true);

      // 2) CHOOSE_ZONE_CARDS (GRAVEYARD) + uniqueCardNumbers
      engine.zoneMgr.moveCard(b022.instanceId, 'GRAVEYARD', { isFaceUp: true });
      engine.zoneMgr.moveCard(b022Champ.instanceId, 'GRAVEYARD', { isFaceUp: true });
      engine.zoneMgr.moveCard(otherRole.instanceId, 'GRAVEYARD', { isFaceUp: true });

      const tac2 = findCard(engine, 'p1', 'ST01-009');
      expect(interp.playTactics('p1', tac2.instanceId, db.getCard('ST01-009')!).success).toBe(true);
      const ch2 = engine.getState().currentPendingChoice!;
      expect(ch2).toBeDefined();

      const badPick2 = engine.dispatchAction({
        type: 'SELECT_CHOICE_OPTION',
        playerId: 'p1',
        pendingChoiceId: ch2.id,
        selectedIds: [b022.instanceId, b022Champ.instanceId],
      });
      expect(badPick2.success).toBe(false);

      const goodPick2 = engine.dispatchAction({
        type: 'SELECT_CHOICE_OPTION',
        playerId: 'p1',
        pendingChoiceId: ch2.id,
        selectedIds: [b022Champ.instanceId, otherRole.instanceId],
      });
      expect(goodPick2.success, goodPick2.error).toBe(true);
      expect(engine.getState().cards[b022Champ.instanceId]!.zone).toBe('HAND');
      expect(engine.getState().cards[otherRole.instanceId]!.zone).toBe('HAND');

      // 3) UNDERNEATH_COUNT_MULT + uniqueCardNumbers：下方置入 BP02-022、BP02-022【冠军】、ST01-002 共 3 张，按核心卡号去重后为 2
      expect(engine.fieldMgr.placeCardUnderneath(b022.instanceId, host.instanceId)).toBe(true);
      expect(engine.fieldMgr.placeCardUnderneath(b022Champ.instanceId, host.instanceId)).toBe(true);
      expect(engine.fieldMgr.placeCardUnderneath(otherRole.instanceId, host.instanceId)).toBe(true);
      const latestHost = engine.getState().cards[host.instanceId]!;
      expect(latestHost.underneathCardIds).toHaveLength(3);

      const multSpec: CardEffectSpec = makeBaseSpec({
        cardNumber: 'ST01-008',
        name: '下方去重乘数测试',
        tactics: [
          {
            op: 'MODIFY_STATS',
            target: { kind: 'SELF' },
            pp: { kind: 'UNDERNEATH_COUNT_MULT', multiplier: 1000, uniqueCardNumbers: true },
            duration: 'END_OF_TURN',
          },
        ],
      });
      const interp3 = createCustomInterpreter(engine, [multSpec]);
      (interp3 as unknown as { stepRunner: { runSteps: Function } }).stepRunner.runSteps(
        'ST01-008',
        latestHost.instanceId,
        'p1',
        {},
        multSpec.tactics!
      );
      expect(latestHost.modifiers?.some((m) => m.pp === 2000)).toBe(true);
    });
  });

  describe('3. PEEK_ZONE + CHOOSE_FROM_VAR 私密查看背面信号球', () => {
    it('自己看到背面信号球真身且不合条件项 eligible=false，经 sanitizeGameStateForPlayer 后对手不可见', () => {
      const engine = createEngine(
        expandDeck('ST01', ['ST01-001', 'ST01-012', 'ST01-008']),
        expandDeck('ST02')
      );
      const state = engine.getState();

      // p1 信号球区放 1 张角色(ST01-001) 和 1 张非角色球(ST01-012)，均为背面表示
      const roleInOrb = findCard(engine, 'p1', 'ST01-001');
      const orbCard = findCard(engine, 'p1', 'ST01-012');
      engine.zoneMgr.moveCard(roleInOrb.instanceId, 'SIGNAL_ORB', { isFaceUp: false });
      engine.zoneMgr.moveCard(orbCard.instanceId, 'SIGNAL_ORB', { isFaceUp: false });

      const interp = createCustomInterpreter(engine, [
        makeBaseSpec({
          cardNumber: 'ST01-008',
          name: '私密查看信号球测试',
          tactics: [
            { op: 'PEEK_ZONE', side: 'SELF', zone: 'SIGNAL_ORB', saveToVar: 'peekedOrbs' },
            {
              op: 'CHOOSE_FROM_VAR',
              varName: 'peekedOrbs',
              prompt: '请选择 1 张角色卡牌',
              filter: { cardType: CardType.ROLE },
              min: 0,
              max: 1,
              alwaysShow: true,
              saveToVar: 'picked',
            },
            {
              op: 'MOVE_CARDS',
              target: { kind: 'VAR', varName: 'picked' },
              toZone: 'HAND',
              isFaceUp: true,
            },
          ],
        }),
      ]);

      const tac = findCard(engine, 'p1', 'ST01-008');
      expect(interp.playTactics('p1', tac.instanceId, db.getCard('ST01-008')!).success).toBe(true);

      const ch = state.currentPendingChoice!;
      expect(ch).toBeDefined();
      expect(ch.playerId).toBe('p1');
      // 自己可以看到背面信号球区卡牌真身，且不满足 cardType=ROLE 的项 eligible=false
      const matchOpt = ch.options.find((o) => o.id === roleInOrb.instanceId);
      const nonMatchOpt = ch.options.find((o) => o.id === orbCard.instanceId);
      expect(matchOpt).toBeDefined();
      expect((matchOpt?.payload as { eligible?: boolean; cardNumber?: string } | undefined)?.eligible).toBe(true);
      expect((matchOpt?.payload as { cardNumber?: string } | undefined)?.cardNumber).toBe('ST01-001');
      expect(nonMatchOpt).toBeDefined();
      expect((nonMatchOpt?.payload as { eligible?: boolean } | undefined)?.eligible).toBe(false);

      // 脱敏给对手 p2：不得泄露 p1 背面信号球与待决策真身选项
      const p2View = sanitizeGameStateForPlayer(state, 'p2');
      expect(p2View.currentPendingChoice).toBeUndefined();
      expect(p2View.opponentPendingChoice).toBeDefined();
      const p2OrbCards = Object.values(p2View.publicCards).filter(
        (c) => c.controllerPlayerId === 'p1' && c.zone === 'SIGNAL_ORB'
      );
      expect(p2OrbCards.every((c) => !c.cardNumber || c.cardNumber === 'HIDDEN_ORB')).toBe(true);

      // 选不合条件项 nonMatchOpt 必须被拒绝
      expect(
        engine.dispatchAction({
          type: 'SELECT_CHOICE_OPTION',
          playerId: 'p1',
          pendingChoiceId: ch.id,
          selectedIds: [orbCard.instanceId],
        }).success
      ).toBe(false);

      // 选符合条件的角色卡成功回到手牌
      expect(
        engine.dispatchAction({
          type: 'SELECT_CHOICE_OPTION',
          playerId: 'p1',
          pendingChoiceId: ch.id,
          selectedIds: [roleInOrb.instanceId],
        }).success
      ).toBe(true);
      expect(engine.getState().cards[roleInOrb.instanceId]!.zone).toBe('HAND');
    });
  });

  describe('4. ZONE_SLICE 与修正后的 ZONE_BOTTOM_CARD', () => {
    it('SIGNAL_ORB 取 index 0 为底、末位为顶；DECK 取 index 0 为顶、末位为底', () => {
      const engine = createEngine(expandDeck('ST01', ['ST01-008']), expandDeck('ST02'));
      const state = engine.getState();

      // 信号球区放入 3 张：orb0(index 0 最下), orb1(index 1), orb2(index 2 最上)
      const orbCards = Object.values(state.cards)
        .filter((c) => c.controllerPlayerId === 'p1' && c.zone === 'DECK' && db.getCard(c.cardNumber)?.signalOrb)
        .slice(0, 3);
      expect(orbCards).toHaveLength(3);
      for (const c of orbCards) {
        engine.zoneMgr.moveCard(c.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
      }
      const orbZone = engine.zoneMgr.getCardsInZone('p1', 'SIGNAL_ORB');
      const [orb0, orb1, orb2] = [orbZone[0]!, orbZone[1]!, orbZone[2]!];

      const deckZone = engine.zoneMgr.getCardsInZone('p1', 'DECK');
      const deckTop0 = deckZone[0]!;
      const deckTop1 = deckZone[1]!;
      const deckBotLast = deckZone[deckZone.length - 1]!;
      const deckBotPrev = deckZone[deckZone.length - 2]!;

      const interp = createCustomInterpreter(engine, [makeBaseSpec({ cardNumber: 'ST01-008' })]);
      const ev = (interp as unknown as { evaluator: { resolveTargetIds: Function } }).evaluator;

      expect(ev.resolveTargetIds({ kind: 'ZONE_BOTTOM_CARD', side: 'SELF', zone: 'SIGNAL_ORB' }, 'p1', '', {})).toEqual([
        orb0.instanceId,
      ]);
      expect(
        ev.resolveTargetIds(
          { kind: 'ZONE_SLICE', side: 'SELF', zone: 'SIGNAL_ORB', edge: 'BOTTOM', count: 2 },
          'p1',
          '',
          {}
        )
      ).toEqual([orb0.instanceId, orb1.instanceId]);
      expect(
        ev.resolveTargetIds(
          { kind: 'ZONE_SLICE', side: 'SELF', zone: 'SIGNAL_ORB', edge: 'TOP', count: 2 },
          'p1',
          '',
          {}
        )
      ).toEqual([orb2.instanceId, orb1.instanceId]);

      expect(ev.resolveTargetIds({ kind: 'ZONE_BOTTOM_CARD', side: 'SELF', zone: 'DECK' }, 'p1', '', {})).toEqual([
        deckBotLast.instanceId,
      ]);
      expect(
        ev.resolveTargetIds(
          { kind: 'ZONE_SLICE', side: 'SELF', zone: 'DECK', edge: 'TOP', count: 2 },
          'p1',
          '',
          {}
        )
      ).toEqual([deckTop0.instanceId, deckTop1.instanceId]);
      expect(
        ev.resolveTargetIds(
          { kind: 'ZONE_SLICE', side: 'SELF', zone: 'DECK', edge: 'BOTTOM', count: 2 },
          'p1',
          '',
          {}
        )
      ).toEqual([deckBotLast.instanceId, deckBotPrev.instanceId]);
    });
  });

  describe('5. EQUIPPED_HOST 双同名宿主精准命中与 ZONE_CARDS(GRAVEYARD)', () => {
    it('两张同名宿主仅装备目标被 EQUIPPED_HOST 命中；ZONE_CARDS(GRAVEYARD) 批量获取满足条件的墓地卡', () => {
      const engine = createEngine(
        expandDeck('ST01', ['ST01-005', 'ST01-005', 'ST01-009', 'ST01-008']),
        expandDeck('ST02')
      );
      const state = engine.getState();

      const hostA = placeRole(engine, 'p1', 'ST01-005', 0, { isReady: true, instanceIndex: 0 });
      const hostB = placeRole(engine, 'p1', 'ST01-005', 1, { isReady: true, instanceIndex: 1 });
      const eq = findCard(engine, 'p1', 'ST01-009');
      expect(engine.fieldMgr.equipToRole('p1', eq.instanceId, hostB.instanceId, { suppressEntryTrigger: true })).toBe(true);

      const interp = createCustomInterpreter(engine, [
        makeBaseSpec({
          cardNumber: 'ST01-009',
          name: '装备宿主精准测试',
          staticEffects: [
            {
              id: 'test:equipped_host_pp',
              scope: 'EQUIPPED_HOST',
              pp: 1200,
            },
          ],
          triggers: [
            {
              abilityId: 'test:equipped_host_trigger',
              eventType: 'CARD_EQUIPPED',
              matcher: { kind: 'SELF_EQUIPPED' },
              label: '给装备宿主加攻',
              steps: [
                {
                  op: 'MODIFY_STATS',
                  target: { kind: 'EQUIPPED_HOST' },
                  pp: 2500,
                  duration: 'END_OF_TURN',
                },
              ],
            },
          ],
        }),
        makeBaseSpec({
          cardNumber: 'ST01-008',
          name: '墓地全选测试',
          tactics: [
            {
              op: 'MOVE_CARDS',
              target: { kind: 'ZONE_CARDS', side: 'SELF', zone: 'GRAVEYARD', filter: { cardType: CardType.ROLE } },
              toZone: 'HAND',
              isFaceUp: true,
            },
          ],
        }),
      ]);
      interp.registerStaticEffects(engine.continuousEffects);

      // 验证 EQUIPPED_HOST（含 staticEffects 与 step target）仅命中 hostB，不命中同名 hostA
      expect(engine.fieldMgr.calculateRoleEffectivePP(hostB.instanceId)).toBe(
        (db.getCard('ST01-005')!.basePP ?? 0) + (db.getCard('ST01-009')!.basePP ?? 0) + 1200
      );
      expect(engine.fieldMgr.calculateRoleEffectivePP(hostA.instanceId)).toBe(db.getCard('ST01-005')!.basePP);

      const sr = (interp as unknown as { stepRunner: { runSteps: Function } }).stepRunner;
      sr.runSteps('ST01-009', eq.instanceId, 'p1', {}, interp.getSpec('ST01-009')!.triggers![0]!.steps);
      expect(hostB.modifiers?.some((m) => m.pp === 2500)).toBe(true);
      expect(hostA.modifiers?.some((m) => m.pp === 2500)).toBeFalsy();

      // 验证 ZONE_CARDS('GRAVEYARD') 批量获取（仅回收角色卡，保留非角色卡在墓地）
      const gyRole1 = findCard(engine, 'p1', 'ST01-001');
      const gyRole2 = findCard(engine, 'p1', 'ST01-002');
      const gyOrb = Object.values(state.cards).find(
        (c) => c.controllerPlayerId === 'p1' && c.zone === 'DECK' && db.getCard(c.cardNumber)?.signalOrb
      )!;
      engine.zoneMgr.moveCard(gyRole1.instanceId, 'GRAVEYARD', { isFaceUp: true });
      engine.zoneMgr.moveCard(gyRole2.instanceId, 'GRAVEYARD', { isFaceUp: true });
      engine.zoneMgr.moveCard(gyOrb.instanceId, 'GRAVEYARD', { isFaceUp: true });

      const tac = findCard(engine, 'p1', 'ST01-008');
      expect(interp.playTactics('p1', tac.instanceId, db.getCard('ST01-008')!).success).toBe(true);
      expect(gyRole1.zone).toBe('HAND');
      expect(gyRole2.zone).toBe('HAND');
      expect(gyOrb.zone).toBe('GRAVEYARD');
    });
  });

  describe('6. MOVE_CARDS.chooseOrder 置底任意排序与隐私保护', () => {
    it('>= 2 张挂起全排列置底并续行后续步骤、拒绝残缺排列、<= 1 张跳过弹窗、DECK 源不泄密', () => {
      const engine = createEngine(
        expandDeck('ST01', ['ST01-008', 'ST01-009']),
        expandDeck('ST02')
      );
      const state = engine.getState();
      const deckBefore = engine.zoneMgr.getCardsInZone('p1', 'DECK');
      const d0 = deckBefore[0]!;
      const d1 = deckBefore[1]!;

      const interp = createCustomInterpreter(engine, [
        makeBaseSpec({
          cardNumber: 'ST01-008',
          name: '多张置底重排测试',
          tactics: [
            {
              op: 'PEEK_TOP',
              side: 'SELF',
              count: 2,
              saveToVar: 'top2',
            },
            {
              op: 'MOVE_CARDS',
              target: { kind: 'VAR', varName: 'top2' },
              toZone: 'DECK_BOTTOM',
              chooseOrder: true,
              orderPrompt: '请按顺序将这 2 张牌放回牌组底',
            },
            { op: 'DRAW', count: 1 },
          ],
        }),
        makeBaseSpec({
          cardNumber: 'ST01-009',
          name: '单张跳过重排测试',
          tactics: [
            { op: 'PEEK_TOP', side: 'SELF', count: 1, saveToVar: 'top1' },
            {
              op: 'MOVE_CARDS',
              target: { kind: 'VAR', varName: 'top1' },
              toZone: 'DECK_BOTTOM',
              chooseOrder: true,
            },
            { op: 'DRAW', count: 1 },
          ],
        }),
      ]);

      // 1) >= 2 张从 DECK 置底：挂起排列弹窗且不向对手泄密
      const handCountBefore = engine.zoneMgr.getCardsInZone('p1', 'HAND').length;
      const tac1 = findCard(engine, 'p1', 'ST01-008');
      expect(interp.playTactics('p1', tac1.instanceId, db.getCard('ST01-008')!).success).toBe(true);
      const ch = state.currentPendingChoice!;
      expect(ch).toBeDefined();
      expect(ch.minSelections).toBe(2);
      expect(ch.maxSelections).toBe(2);

      // DECK 源脱敏：对手不可看到选项真实卡号，且 opponentPendingChoice 无 options
      const oppView = sanitizeGameStateForPlayer(state, 'p2');
      expect(oppView.currentPendingChoice).toBeUndefined();
      expect('options' in (oppView.opponentPendingChoice ?? {})).toBe(false);
      expect((ch.metadata as { revealed?: unknown } | undefined)?.revealed).toBeUndefined();

      // 拒绝残缺排列（只提交 1 张）
      expect(
        engine.dispatchAction({
          type: 'SELECT_CHOICE_OPTION',
          playerId: 'p1',
          pendingChoiceId: ch.id,
          selectedIds: [d0.instanceId],
        }).success
      ).toBe(false);

      // 提交完整排列 [d1, d0]（d1 先置底、d0 后置底）并继续执行 DRAW(1)
      expect(
        engine.dispatchAction({
          type: 'SELECT_CHOICE_OPTION',
          playerId: 'p1',
          pendingChoiceId: ch.id,
          selectedIds: [d1.instanceId, d0.instanceId],
        }).success
      ).toBe(true);

      const deckAfter = engine.zoneMgr.getCardsInZone('p1', 'DECK');
      expect(deckAfter.slice(-2).map((c) => c.instanceId)).toEqual([d1.instanceId, d0.instanceId]);
      expect(engine.zoneMgr.getCardsInZone('p1', 'HAND').length).toBe(handCountBefore + 1);

      // 2) <= 1 张时跳过重排弹窗，直接置底并抽牌
      const topSingle = deckAfter[0]!;
      const handBefore2 = engine.zoneMgr.getCardsInZone('p1', 'HAND').length;
      const tac2 = findCard(engine, 'p1', 'ST01-009');
      expect(interp.playTactics('p1', tac2.instanceId, db.getCard('ST01-009')!).success).toBe(true);
      expect(state.currentPendingChoice).toBeUndefined();
      const deckAfter2 = engine.zoneMgr.getCardsInZone('p1', 'DECK');
      expect(deckAfter2[deckAfter2.length - 1]!.instanceId).toBe(topSingle.instanceId);
      expect(engine.zoneMgr.getCardsInZone('p1', 'HAND').length).toBe(handBefore2 + 1);
    });
  });

  describe('7. 可挂起通用 REPLACEMENT 原语、战斗破坏暂停与校验', () => {
    it('REGISTER_REPLACEMENT MODIFY_DAMAGE { maxAmount: 1 } + sourceCardInstanceId + END_OF_COMBAT 自动清理', () => {
      const engine = createEngine(
        expandDeck('ST01', ['ST01-001', 'ST01-002']),
        expandDeck('ST02', ['ST01-008', 'ST02-004'])
      );
      const state = engine.getState();
      const atkA = placeRole(engine, 'p1', 'ST01-001', 0, { isReady: true });
      const atkB = placeRole(engine, 'p1', 'ST01-002', 1, { isReady: true });
      // 在 p2 场放 1 张竖直角色，让攻击停在 BLOCK 步骤以便在伤害步骤前注册战斗中置换
      placeRole(engine, 'p2', 'ST02-004', 0, { isReady: true });
      addCardModifier(state, atkA, { dp: 3, untilTurn: state.turnNumber + 3, source: 'TEST' });

      const interp = createCustomInterpreter(engine, [
        makeBaseSpec({
          cardNumber: 'ST01-008',
          name: '战斗限定减伤测试',
          tactics: [
            {
              op: 'REGISTER_REPLACEMENT',
              eventType: 'DEAL_DAMAGE',
              targetSide: 'SELF',
              target: { kind: 'TRIGGER_ATTACKER' },
              action: { kind: 'MODIFY_DAMAGE', maxAmount: 1 },
              duration: 'END_OF_COMBAT',
              label: '本次攻击来自指定攻击者的伤害至多为1',
            },
          ],
        }),
      ]);

      putNonChargeAutoOnDeckTop(engine, 'p1', 3);
      putNonChargeAutoOnDeckTop(engine, 'p2', 6);
      advanceToP1AttackableMainPhase(engine);

      // atkA (DP=4) 攻击 p2
      expect(
        engine.dispatchAction({
          type: 'DECLARE_ATTACK',
          playerId: 'p1',
          attackerCardId: atkA.instanceId,
          targetType: 'PLAYER',
        }).success
      ).toBe(true);

      // 通过 DSL REGISTER_REPLACEMENT 在战斗中为 p2 注册限定 source=atkA、END_OF_COMBAT 失效的伤害上限置换
      const tac = findCard(engine, 'p1', 'ST01-008');
      const sr = (interp as unknown as { stepRunner: { runSteps: Function } }).stepRunner;
      sr.runSteps(
        'ST01-008',
        tac.instanceId,
        'p2',
        { __triggerAttacker: [atkA.instanceId] },
        interp.getSpec('ST01-008')!.tactics!
      );

      expect(state.activeReplacements?.some((r) => r.expiresAtCombatEnd === true)).toBe(true);

      // 非目标来源 atkB 造成的伤害不得被限制
      expect(engine.replacementEngine.interceptDealDamage('p2', 3, atkB.instanceId)).toBe(3);

      // 推进完成 atkA 本次攻击：p2 仅受 1 点伤害而非 4 点，且攻击结束后 END_OF_COMBAT 置换已清理
      const erosionBefore = state.players['p2']!.erosionCount;
      passInstantWindows(engine);
      if (state.currentCombat?.step === 'BLOCK') {
        expect(engine.dispatchAction({ type: 'DECLARE_BLOCK', playerId: 'p2' }).success).toBe(true);
      }
      resolvePendingChoices(engine);
      expect(state.players['p2']!.erosionCount).toBe(erosionBefore + 1);
      expect(state.currentCombat).toBeUndefined();
      expect(state.activeReplacements).toBeUndefined();
    });

    it('BP02-013 可选挂起：实时减费至<=6可救；选放弃不牺牲极昼且正常破坏；2张极昼1步自选或0张放弃', () => {
      // 场景 A：原价 7 费火属性角色（如 BP02-012）经持续减费降至 6 费后被破坏，场上 1 张 BP02-013 弹出 SELECT_OPTION
      {
        const engine = createEngine(
          expandDeck('ST01', ['ST01-001']),
          expandDeck('ST02', ['BP02-012', 'BP02-013'])
        );
        const state = engine.getState();
        const attacker = placeRole(engine, 'p1', 'ST01-001', 0, { isReady: true });
        addCardModifier(state, attacker, { pp: 6000, keywords: ['贯通'], untilTurn: state.turnNumber + 5, source: 'TEST' });

        const fireCost7 = placeRole(engine, 'p2', 'BP02-012', 0, { isReady: false });
        const liv013 = placeRole(engine, 'p2', 'BP02-013', 1, { isReady: false });
        // 实时减费 1 -> 有效费用 6，符合 BP02-013 <= 6 条件
        addCardModifier(state, fireCost7, { costDelta: -1, untilTurn: state.turnNumber + 5, source: 'TEST' });
        expect(engine.continuousEffects.getEffectiveCardCost(fireCost7.instanceId)).toBe(6);

        putNonChargeAutoOnDeckTop(engine, 'p1', 3);
        advanceToP1AttackableMainPhase(engine);
        const p2ErosionBefore = state.players['p2']!.erosionCount;

        expect(
          engine.dispatchAction({
            type: 'DECLARE_ATTACK',
            playerId: 'p1',
            attackerCardId: attacker.instanceId,
            targetType: 'CHARACTER',
            targetCardId: fireCost7.instanceId,
          }).success
        ).toBe(true);
        passInstantWindows(engine);

        // 弹窗期间战斗比拼被挂起：BATTLE_COMPARED 未提前发射，贯通尚未结算
        const ch = state.currentPendingChoice!;
        expect(ch?.effectType).toBe('OPTIONAL_REPLACEMENT_DECISION');
        expect(ch.choiceType).toBe('SELECT_OPTION');
        expect(state.currentCombat?.pendingBattleCompare).toBeDefined();
        expect(engine.getEvents().some((e) => e.type === 'BATTLE_COMPARED')).toBe(false);
        expect(state.players['p2']!.erosionCount).toBe(p2ErosionBefore);

        // 选择放弃置换：不牺牲 BP02-013，火角色正常破坏并补发 BATTLE_COMPARED + 【贯通】伤害
        expect(
          engine.dispatchAction({
            type: 'SELECT_CHOICE_OPTION',
            playerId: 'p2',
            pendingChoiceId: ch.id,
            selectedIds: ['decline'],
          }).success
        ).toBe(true);
        expect(liv013.zone).toBe('BATTLEFIELD');
        expect(fireCost7.zone).toBe('GRAVEYARD');
        expect(
          engine.getEvents().some((e) => e.type === 'BATTLE_COMPARED' && e.destroyedDefenderCardId === fireCost7.instanceId)
        ).toBe(true);
        expect(state.players['p2']!.erosionCount).toBe(p2ErosionBefore + 1);
      }

      // 场景 B：场上 2 张 BP02-013，弹出 1 步 SELECT_CARDS（min=0, max=1），可自选牺牲指定一张或选 0 张放弃
      {
        const engine = createEngine(
          expandDeck('ST01', ['ST01-001']),
          expandDeck('ST02', ['BP02-014', 'BP02-013', 'BP02-013'])
        );
        const state = engine.getState();
        const attacker = placeRole(engine, 'p1', 'ST01-001', 0, { isReady: true });
        addCardModifier(state, attacker, { pp: 6000, untilTurn: state.turnNumber + 5, source: 'TEST' });

        const fire4 = placeRole(engine, 'p2', 'BP02-014', 0, { isReady: false });
        const livs = Object.values(state.cards).filter(
          (c) => c.controllerPlayerId === 'p2' && c.cardNumber === 'BP02-013'
        );
        expect(livs).toHaveLength(2);
        const [livA, livB] = [livs[0]!, livs[1]!];
        engine.zoneMgr.moveCard(livA.instanceId, 'HAND', { isFaceUp: true });
        expect(engine.fieldMgr.playRoleCard('p2', livA.instanceId, 1, { suppressEntryTrigger: true })).toBe(true);
        livA.isReady = false;
        livA.turnEnteredZone = 0;
        engine.zoneMgr.moveCard(livB.instanceId, 'HAND', { isFaceUp: true });
        expect(engine.fieldMgr.playRoleCard('p2', livB.instanceId, 2, { suppressEntryTrigger: true })).toBe(true);
        livB.isReady = false;
        livB.turnEnteredZone = 0;
        expect(livA.instanceId).not.toBe(livB.instanceId);
        expect(livA.zone).toBe('BATTLEFIELD');
        expect(livB.zone).toBe('BATTLEFIELD');

        putNonChargeAutoOnDeckTop(engine, 'p1', 3);
        advanceToP1AttackableMainPhase(engine);
        expect(livA.zone).toBe('BATTLEFIELD');
        expect(livB.zone).toBe('BATTLEFIELD');
        expect(
          engine.zoneMgr.getCardsInZone('p2', 'BATTLEFIELD').filter((c) => c.cardNumber === 'BP02-013')
        ).toHaveLength(2);
        expect(state.battlefields['p2']!.filter((s) => s.roleCardId && state.cards[s.roleCardId]?.cardNumber === 'BP02-013')).toHaveLength(2);

        expect(
          engine.dispatchAction({
            type: 'DECLARE_ATTACK',
            playerId: 'p1',
            attackerCardId: attacker.instanceId,
            targetType: 'CHARACTER',
            targetCardId: fire4.instanceId,
          }).success
        ).toBe(true);
        passInstantWindows(engine);

        const ch = state.currentPendingChoice!;
        expect(ch?.effectType).toBe('OPTIONAL_REPLACEMENT_DECISION');
        expect(ch.choiceType).toBe('SELECT_CARDS');
        expect(ch.minSelections).toBe(0);
        expect(ch.maxSelections).toBe(1);
        expect(ch.options.map((o) => o.id).sort()).toEqual([livA.instanceId, livB.instanceId].sort());

        // 自选牺牲第 2 张 livB 挽救 fire4
        expect(
          engine.dispatchAction({
            type: 'SELECT_CHOICE_OPTION',
            playerId: 'p2',
            pendingChoiceId: ch.id,
            selectedIds: [livB.instanceId],
          }).success
        ).toBe(true);
        expect(fire4.zone).toBe('BATTLEFIELD');
        expect(livA.zone).toBe('BATTLEFIELD');
        expect(livB.zone).toBe('GRAVEYARD');
      }

      // 场景 C：场上 2 张 BP02-013 时选择 0 张放弃置换，两张极昼均留在战场，fire4 正常被破坏
      {
        const engine = createEngine(
          expandDeck('ST01', ['ST01-001']),
          expandDeck('ST02', ['BP02-014', 'BP02-013', 'BP02-013'])
        );
        const state = engine.getState();
        const attacker = placeRole(engine, 'p1', 'ST01-001', 0, { isReady: true });
        addCardModifier(state, attacker, { pp: 6000, untilTurn: state.turnNumber + 5, source: 'TEST' });

        const fire4 = placeRole(engine, 'p2', 'BP02-014', 0, { isReady: false });
        const livs = Object.values(state.cards).filter(
          (c) => c.controllerPlayerId === 'p2' && c.cardNumber === 'BP02-013'
        );
        const [livA, livB] = [livs[0]!, livs[1]!];
        engine.zoneMgr.moveCard(livA.instanceId, 'HAND', { isFaceUp: true });
        expect(engine.fieldMgr.playRoleCard('p2', livA.instanceId, 1, { suppressEntryTrigger: true })).toBe(true);
        livA.isReady = false;
        livA.turnEnteredZone = 0;
        engine.zoneMgr.moveCard(livB.instanceId, 'HAND', { isFaceUp: true });
        expect(engine.fieldMgr.playRoleCard('p2', livB.instanceId, 2, { suppressEntryTrigger: true })).toBe(true);
        livB.isReady = false;
        livB.turnEnteredZone = 0;

        putNonChargeAutoOnDeckTop(engine, 'p1', 3);
        advanceToP1AttackableMainPhase(engine);

        expect(
          engine.dispatchAction({
            type: 'DECLARE_ATTACK',
            playerId: 'p1',
            attackerCardId: attacker.instanceId,
            targetType: 'CHARACTER',
            targetCardId: fire4.instanceId,
          }).success
        ).toBe(true);
        passInstantWindows(engine);

        const ch = state.currentPendingChoice!;
        expect(ch?.effectType).toBe('OPTIONAL_REPLACEMENT_DECISION');
        expect(ch.choiceType).toBe('SELECT_CARDS');
        expect(
          engine.dispatchAction({
            type: 'SELECT_CHOICE_OPTION',
            playerId: 'p2',
            pendingChoiceId: ch.id,
            selectedIds: [],
          }).success
        ).toBe(true);
        expect(fire4.zone).toBe('GRAVEYARD');
        expect(livA.zone).toBe('BATTLEFIELD');
        expect(livB.zone).toBe('BATTLEFIELD');
      }
    });

    it('BP02-049 可选挂起：手牌 2 张<万世铭>时 1 步自选弃置或选 0 张放弃，且放弃不消耗【回合1】', () => {
      const engine = createEngine(
        expandDeck('ST01', ['ST01-001', 'ST01-002']),
        expandDeck('ST02', ['BP02-049', 'BP01-037', 'BP01-038'])
      );
      const state = engine.getState();
      const atk1 = placeRole(engine, 'p1', 'ST01-001', 0, { isReady: true });
      const atk2 = placeRole(engine, 'p1', 'ST01-002', 1, { isReady: true });
      addCardModifier(state, atk1, { pp: 6000, untilTurn: state.turnNumber + 5, source: 'TEST' });
      addCardModifier(state, atk2, { pp: 6000, untilTurn: state.turnNumber + 5, source: 'TEST' });

      const qu049 = placeRole(engine, 'p2', 'BP02-049', 0, { isReady: false });
      const w1 = findCard(engine, 'p2', 'BP01-037');
      const w2 = findCard(engine, 'p2', 'BP01-038');
      engine.zoneMgr.moveCard(w1.instanceId, 'HAND', { isFaceUp: true });
      engine.zoneMgr.moveCard(w2.instanceId, 'HAND', { isFaceUp: true });

      // 再给 p2 额外注册一个一次性的默认保护置换，用来测试第一次选 [] 放弃 BP02-049 后同回合第二次战斗破坏仍可发动 BP02-049
      engine.replacementEngine.addActiveReplacement({
        eventType: 'DESTROY_ROLE',
        controllerPlayerId: 'p2',
        targetCardInstanceId: qu049.instanceId,
        destroyReason: 'BATTLE',
        action: { kind: 'PREVENT' },
        once: true,
        untilTurn: state.turnNumber + 5,
        source: 'SECOND_CHANCE',
      });

      putNonChargeAutoOnDeckTop(engine, 'p1', 6);
      advanceToP1AttackableMainPhase(engine);

      // 第一次攻击：先选 BP02-049 优先处理，然后选 [] 放弃（由一次性置换保住不死，检验放弃不消耗 BP02-049【回合1】）
      expect(
        engine.dispatchAction({
          type: 'DECLARE_ATTACK',
          playerId: 'p1',
          attackerCardId: atk1.instanceId,
          targetType: 'CHARACTER',
          targetCardId: qu049.instanceId,
        }).success
      ).toBe(true);
      passInstantWindows(engine);

      const orderChoice = state.currentPendingChoice!;
      expect(orderChoice?.effectType).toBe('CHOOSE_REPLACEMENT_ORDER');
      expect(
        engine.dispatchAction({
          type: 'SELECT_CHOICE_OPTION',
          playerId: 'p2',
          pendingChoiceId: orderChoice.id,
          selectedIds: ['builtin:BP02-049_BATTLE_SAVE'],
        }).success
      ).toBe(true);

      const optChoice1 = state.currentPendingChoice!;
      expect(optChoice1?.effectType).toBe('OPTIONAL_REPLACEMENT_DECISION');
      expect(optChoice1.choiceType).toBe('SELECT_CARDS');
      expect(optChoice1.options.map((o) => o.id).sort()).toEqual([w1.instanceId, w2.instanceId].sort());

      // 选 0 张放弃置换
      expect(
        engine.dispatchAction({
          type: 'SELECT_CHOICE_OPTION',
          playerId: 'p2',
          pendingChoiceId: optChoice1.id,
          selectedIds: [],
        }).success
      ).toBe(true);
      expect(w1.zone).toBe('HAND');
      expect(w2.zone).toBe('HAND');
      expect(qu049.zone).toBe('BATTLEFIELD');
      expect(state.players['p2']!.turnAbilityUsage[`${qu049.instanceId}:BP02-049_BATTLE_SAVE`] ?? 0).toBe(0);

      // 同回合第二次攻击：由于上次放弃未消耗【回合1】，这次仍弹出 2 张<万世铭>可选置换，且自选弃置 w2 保住 BP02-049
      expect(
        engine.dispatchAction({
          type: 'DECLARE_ATTACK',
          playerId: 'p1',
          attackerCardId: atk2.instanceId,
          targetType: 'CHARACTER',
          targetCardId: qu049.instanceId,
        }).success
      ).toBe(true);
      passInstantWindows(engine);

      const optChoice2 = state.currentPendingChoice!;
      expect(optChoice2?.effectType).toBe('OPTIONAL_REPLACEMENT_DECISION');
      expect(optChoice2.choiceType).toBe('SELECT_CARDS');
      expect(
        engine.dispatchAction({
          type: 'SELECT_CHOICE_OPTION',
          playerId: 'p2',
          pendingChoiceId: optChoice2.id,
          selectedIds: [w2.instanceId],
        }).success
      ).toBe(true);

      expect(w2.zone).toBe('GRAVEYARD');
      expect(w1.zone).toBe('HAND');
      expect(qu049.zone).toBe('BATTLEFIELD');
      expect(state.players['p2']!.turnAbilityUsage[`${qu049.instanceId}:BP02-049_BATTLE_SAVE`]).toBe(1);
    });

    it('DSL DESTROY_ROLES 遇可选置换挂起暂停 pendingDslContinuations 后续步骤，决定后恢复续行', () => {
      const engine = createEngine(
        expandDeck('ST01', ['ST01-008']),
        expandDeck('ST02', ['BP01-017', 'BP01-020', 'BP01-021'])
      );
      const state = engine.getState();

      const alpha17 = placeRole(engine, 'p2', 'BP01-017', 0, { isReady: true });
      const small = findCard(engine, 'p2', 'BP01-020');
      const big = findCard(engine, 'p2', 'BP01-021');
      expect(engine.fieldMgr.equipToRole('p2', small.instanceId, alpha17.instanceId, { suppressEntryTrigger: true })).toBe(true);
      expect(engine.fieldMgr.equipToRole('p2', big.instanceId, alpha17.instanceId, { suppressEntryTrigger: true })).toBe(true);

      const interp = createCustomInterpreter(engine, [
        makeBaseSpec({
          cardNumber: 'ST01-008',
          name: 'DESTROY_ROLES 挂起续行测试',
          tactics: [
            { op: 'CHOOSE_ROLES', side: 'OPPONENT', prompt: '选1张对方角色破坏', min: 1, max: 1, saveToVar: 'victim' },
            { op: 'DESTROY_ROLES', target: { kind: 'VAR', varName: 'victim' } },
            { op: 'DRAW', count: 1 },
          ],
        }),
      ]);

      const handBefore = engine.zoneMgr.getCardsInZone('p1', 'HAND').length;
      const tac = findCard(engine, 'p1', 'ST01-008');
      expect(interp.playTactics('p1', tac.instanceId, db.getCard('ST01-008')!).success).toBe(true);

      const pickTarget = state.currentPendingChoice!;
      expect(
        engine.dispatchAction({
          type: 'SELECT_CHOICE_OPTION',
          playerId: 'p1',
          pendingChoiceId: pickTarget.id,
          selectedIds: [alpha17.instanceId],
        }).success
      ).toBe(true);

      // DESTROY_ROLES 遇到 BP01-017 可选离场置换时挂起，DRAW(1) 必须暂存在 pendingDslContinuations 而非抢先抽牌
      expect(state.currentPendingChoice?.effectType).toBe('BP01_017_OPTIONAL_LEAVE_REPLACEMENT');
      expect(state.pendingDslContinuations?.length).toBeGreaterThan(0);
      expect(engine.zoneMgr.getCardsInZone('p1', 'HAND').length).toBe(handBefore);

      // p2 选择送双刀留场后，DRAW(1) 续行帧自动恢复执行
      expect(
        engine.dispatchAction({
          type: 'SELECT_CHOICE_OPTION',
          playerId: 'p2',
          pendingChoiceId: state.currentPendingChoice!.id,
          selectedIds: ['replace'],
        }).success
      ).toBe(true);

      expect(alpha17.zone).toBe('BATTLEFIELD');
      expect(small.zone).toBe('GRAVEYARD');
      expect(big.zone).toBe('GRAVEYARD');
      expect(state.pendingDslContinuations).toBeUndefined();
      expect(engine.zoneMgr.getCardsInZone('p1', 'HAND').length).toBe(handBefore + 1);
    });

    it('多目标 DESTROY_ROLES 遇首个目标置换挂起时暂停余目标并在放弃置换后保留 saveDestroyedToVar (8.6.4)', () => {
      const engine = createEngine(
        expandDeck('ST01', ['ST01-008']),
        expandDeck('ST02', ['BP01-017', 'BP01-020', 'BP01-021', 'ST02-003'])
      );
      const state = engine.getState();

      const alpha17 = placeRole(engine, 'p2', 'BP01-017', 0, { isReady: true });
      const ally = placeRole(engine, 'p2', 'ST02-003', 1, { isReady: true });
      const small = findCard(engine, 'p2', 'BP01-020');
      const big = findCard(engine, 'p2', 'BP01-021');
      expect(engine.fieldMgr.equipToRole('p2', small.instanceId, alpha17.instanceId, { suppressEntryTrigger: true })).toBe(true);
      expect(engine.fieldMgr.equipToRole('p2', big.instanceId, alpha17.instanceId, { suppressEntryTrigger: true })).toBe(true);

      const interp = createCustomInterpreter(engine, [
        makeBaseSpec({
          cardNumber: 'ST01-008',
          name: '多目标DESTROY_ROLES暂停与8.6.4追踪测试',
          tactics: [
            {
              op: 'DESTROY_ROLES',
              target: { kind: 'ALL_MATCHING_ROLES', side: 'OPPONENT' },
              saveDestroyedToVar: 'killed',
            },
            {
              op: 'IF',
              condition: { kind: 'VAR_COUNT_COMPARE', varName: 'killed', op: '>=', value: 2 },
              then: [{ op: 'DRAW', count: 2 }],
            },
          ],
        }),
      ]);

      const handBefore = engine.zoneMgr.getCardsInZone('p1', 'HAND').length;
      const tac = findCard(engine, 'p1', 'ST01-008');
      expect(interp.playTactics('p1', tac.instanceId, db.getCard('ST01-008')!).success).toBe(true);

      // 首个目标 alpha17 挂起可选置换时，第二个目标 ally 必须仍留在战场且尚未抽牌
      expect(state.currentPendingChoice?.effectType).toBe('BP01_017_OPTIONAL_LEAVE_REPLACEMENT');
      expect(ally.zone).toBe('BATTLEFIELD');
      expect(engine.zoneMgr.getCardsInZone('p1', 'HAND').length).toBe(handBefore);

      // p2 选择不发动置换让 alpha17 被破坏 -> ally 紧接着被破坏 -> killed 精确收集 2 张 -> 触发 DRAW(2)
      expect(
        engine.dispatchAction({
          type: 'SELECT_CHOICE_OPTION',
          playerId: 'p2',
          pendingChoiceId: state.currentPendingChoice!.id,
          selectedIds: ['leave'],
        }).success
      ).toBe(true);

      expect(alpha17.zone).toBe('GRAVEYARD');
      expect(ally.zone).toBe('GRAVEYARD');
      expect(engine.zoneMgr.getCardsInZone('p1', 'HAND').length).toBe(handBefore + 2);
      expect(state.pendingDslContinuations).toBeUndefined();
    });

    it('MOVE_CARDS.chooseOrder 对未窥视的背面信号球保持脱敏标签，且 snapshotCard 保留 4 个瞬态字段', () => {
      const engine = createEngine(
        expandDeck('ST01', ['ST01-008', 'ST01-009', 'ST01-010', 'BP03-001']),
        expandDeck('ST02')
      );
      const state = engine.getState();
      const orbA = findCard(engine, 'p1', 'ST01-009');
      const orbB = findCard(engine, 'p1', 'ST01-010');
      engine.zoneMgr.moveCard(orbA.instanceId, 'SIGNAL_ORB', { isFaceUp: false, isReady: true });
      engine.zoneMgr.moveCard(orbB.instanceId, 'SIGNAL_ORB', { isFaceUp: false, isReady: true });
      const faceDownOrbs = engine.zoneMgr.getCardsInZone('p1', 'SIGNAL_ORB').slice(0, 2);
      expect(faceDownOrbs).toHaveLength(2);
      for (const orb of faceDownOrbs) {
        orb.isFaceUp = false;
      }

      const interp = createCustomInterpreter(engine, [
        makeBaseSpec({
          cardNumber: 'ST01-008',
          name: '未窥视背面球重排脱敏',
          tactics: [
            {
              op: 'MOVE_CARDS',
              target: { kind: 'ZONE_SLICE', side: 'SELF', zone: 'SIGNAL_ORB', edge: 'BOTTOM', count: 2 },
              toZone: 'DECK_BOTTOM',
              chooseOrder: true,
            },
          ],
        }),
      ]);

      const tac = findCard(engine, 'p1', 'ST01-008');
      expect(interp.playTactics('p1', tac.instanceId, db.getCard('ST01-008')!).success).toBe(true);
      const ch = state.currentPendingChoice!;
      expect(ch.options.map((o) => o.label)).toEqual(['背面信号球 #1', '背面信号球 #2']);
      expect((ch.metadata as { revealed?: unknown } | undefined)?.revealed).toBeUndefined();

      // 验证 TriggerManager.snapshotCard 采集 isAirborne / wasAscendedPlay / enteredFromZone / ascendedFromAirborne
      const role = findCard(engine, 'p1', 'BP03-001');
      role.zone = 'PROCESSING';
      role.isAirborne = true;
      role.wasAscendedPlay = true;
      role.enteredFromZone = 'HAND';
      role.ascendedFromAirborne = true;
      const snap = engine.triggerMgr.snapshotCard(role.instanceId)!;
      expect(snap.isAirborne).toBe(true);
      expect(snap.wasAscendedPlay).toBe(true);
      expect(snap.enteredFromZone).toBe('HAND');
      expect(snap.ascendedFromAirborne).toBe(true);
    });

    it('DeclarativeReplacementSpec 注册至 ReplacementEngine 与 validator 负例校验', () => {
      // 1) 正例：合法 DeclarativeReplacementSpec 通过校验并可通过 registerReplacements 注册生效
      const validSpec = makeBaseSpec({
        cardNumber: 'ST01-001',
        name: '声明式置换测试',
        replacements: [
          {
            id: 'test:decl_repl_valid',
            label: '【测试】场上有该牌时可防止效果破坏',
            eventTypes: ['DESTROY_ROLE'],
            sourceZones: ['BATTLEFIELD'],
            subjectScope: 'SELF',
            destroyReason: 'EFFECT',
            oncePerTurn: true,
            optional: true,
            action: { kind: 'PREVENT' },
          },
        ],
      });
      expect(() => validateCardEffectSpec(validSpec)).not.toThrow();

      const engine = createEngine(expandDeck('ST01'), expandDeck('ST02'));
      const role = placeRole(engine, 'p1', 'ST01-001', 0, { isReady: true });
      const interp = createCustomInterpreter(engine, [validSpec]);
      (interp as unknown as { registerReplacements?: (r: typeof engine.replacementEngine) => void }).registerReplacements?.(
        engine.replacementEngine
      );

      const intercept = engine.replacementEngine.interceptDestroyRole(role.instanceId, 'EFFECT');
      expect(intercept.replaced).toBe(true);
      expect(intercept.pendingChoice).toBe(true);
      expect(engine.getState().currentPendingChoice?.effectType).toBe('OPTIONAL_REPLACEMENT_DECISION');

      // 2) 负例：非法 DeclarativeReplacementSpec（空 ID / 空 eventTypes / 非法 action）均抛错
      expect(() =>
        validateCardEffectSpec(
          makeBaseSpec({
            replacements: [
              {
                id: '',
                label: '空id',
                eventTypes: ['DESTROY_ROLE'],
                subjectScope: 'SELF',
                action: { kind: 'PREVENT' },
              },
            ],
          })
        )
      ).toThrow();

      expect(() =>
        validateCardEffectSpec(
          makeBaseSpec({
            replacements: [
              {
                id: 'bad-events',
                label: '空事件列表',
                eventTypes: [],
                subjectScope: 'SELF',
                action: { kind: 'PREVENT' },
              },
            ],
          })
        )
      ).toThrow();

      expect(() =>
        validateCardEffectSpec(
          makeBaseSpec({
            replacements: [
              {
                id: 'bad-action',
                label: '破坏事件用MODIFY_DAMAGE',
                eventTypes: ['DESTROY_ROLE'],
                subjectScope: 'SELF',
                action: { kind: 'MODIFY_DAMAGE', maxAmount: 1 },
              },
            ],
          })
        )
      ).toThrow();
    });
  });
});

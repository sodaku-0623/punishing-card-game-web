import { describe, it, expect } from 'vitest';
import { CardType, ElementAttribute, GameAction, GameState, PublicGameState } from '@zhanshuang/shared';
import { OFFICIAL_STARTER_DECKS } from '@zhanshuang/game-rules';
import { GameEngine, MemoryCardDatabase, OFFICIAL_CARDS_DATA, SeedRng } from '../src/index.js';

const db = new MemoryCardDatabase(OFFICIAL_CARDS_DATA);

function expandDeck(presetId: 'ST01' | 'ST02' | 'ST03'): string[] {
  const deck = OFFICIAL_STARTER_DECKS.find((d) => d.name.includes(`(${presetId})`))!;
  const list: string[] = [];
  for (const entry of deck.cards) {
    for (let i = 0; i < entry.count; i++) list.push(entry.cardNumber);
  }
  return list;
}

/**
 * 4.3 不变量校验：每一步行动后校验全量卡牌守恒、费用区派生一致、卡位合法性、无死循环
 */
function assertGameInvariants(engine: GameEngine, expectedTotalCards = 100): void {
  const state = engine.getState();
  const allCards = Object.values(state.cards);

  // 1. 卡牌守恒 (每方 50 张，合计 100 张)
  expect(allCards.length).toBe(expectedTotalCards);
  for (const pid of Object.keys(state.players)) {
    const owned = allCards.filter((c) => c.ownerPlayerId === pid);
    expect(owned.length).toBe(50);

    // 2. 费用统计与实际 COST 区域严格一致 (3.6)
    const costCards = engine.zoneMgr.getCardsInZone(pid, 'COST');
    const openCards = costCards.filter((c) => c.isFaceUp);
    const readyOpen = openCards.filter((c) => c.isReady);
    const hiddenCards = costCards.filter((c) => !c.isFaceUp);
    const player = state.players[pid]!;
    expect(player.openCostCount).toBe(openCards.length);
    expect(player.availableOpenCostCount).toBe(readyOpen.length);
    expect(player.hiddenCostCount).toBe(hiddenCards.length);
    expect(player.totalCostCount).toBe(costCards.length);

    // 3. 战场卡位合法：无重复引用、且指向 BATTLEFIELD 中的己方卡牌
    const slots = state.battlefields[pid] ?? [];
    const seen = new Set<string>();
    for (const slot of slots) {
      for (const cid of [slot.roleCardId, slot.standaloneEquipmentId, slot.assistCardId]) {
        if (!cid) continue;
        expect(seen.has(cid)).toBe(false);
        seen.add(cid);
        const card = state.cards[cid];
        expect(card).toBeDefined();
        expect(card!.zone).toBe('BATTLEFIELD');
        expect(card!.controllerPlayerId).toBe(pid);
      }
    }
  }
}

/**
 * 4.5 隐藏信息防泄漏校验：对手手牌、牌库、背面暗费/背面信号球、对手私有决策绝不泄露给己方视角
 */
function assertNoHiddenInfoLeak(engine: GameEngine): void {
  const state: GameState = engine.getState();
  const playerIds = Object.keys(state.players);

  for (const viewerId of playerIds) {
    const opponentId = playerIds.find((id) => id !== viewerId)!;
    const pub: PublicGameState = engine.getPublicState(viewerId);

    // 1. publicCards 绝不包含对手的 HAND / DECK 卡牌，也不包含对手暗费或双方背面信号球的真实 instanceId
    const secretIds = new Set(
      Object.values(state.cards)
        .filter(
          (c) =>
            (c.zone === 'COST' && !c.isFaceUp && c.controllerPlayerId === opponentId) ||
            (c.zone === 'SIGNAL_ORB' && !c.isFaceUp)
        )
        .map((c) => c.instanceId)
    );
    for (const [key, card] of Object.entries(pub.publicCards)) {
      expect(secretIds.has(key)).toBe(false);
      expect(secretIds.has(card.instanceId)).toBe(false);
      if (card.controllerPlayerId === opponentId) {
        expect(card.zone).not.toBe('HAND');
        expect(card.zone).not.toBe('DECK');

        // 2. 对手背面暗费彻底脱敏 (含 instanceId / cardNumber / cardId / imageUrl / modifiers / effectiveStats)
        if (card.zone === 'COST' && !card.isFaceUp) {
          expect(card.instanceId.startsWith('hidden-cost:')).toBe(true);
          expect(card.cardNumber).toBe('HIDDEN_COST');
          expect(card.cardId).toBe('HIDDEN_COST');
          expect(card.imageUrl).toBeUndefined();
          expect(card.modifiers).toBeUndefined();
          expect(card.effectivePP).toBeUndefined();
          expect(card.effectiveDP).toBeUndefined();
          expect(card.effectiveKeywords).toBeUndefined();
          expect(card.effectiveTraits).toBeUndefined();
        }

        // 3. 对手背面信号球彻底脱敏
        if (card.zone === 'SIGNAL_ORB' && !card.isFaceUp) {
          expect(card.instanceId.startsWith('hidden-orb:')).toBe(true);
          expect(card.cardNumber).toBe('HIDDEN_ORB');
          expect(card.cardId).toBe('HIDDEN_ORB');
          expect(card.imageUrl).toBeUndefined();
        }
      }
    }

    // 4. 对手未公开的手牌与牌库 ID 不出现在己方 myHandCards
    const oppSecretIds = new Set(
      Object.values(state.cards)
        .filter((c) => c.controllerPlayerId === opponentId && (c.zone === 'HAND' || c.zone === 'DECK'))
        .map((c) => c.instanceId)
    );
    for (const card of pub.myHandCards ?? []) {
      expect(oppSecretIds.has(card.instanceId)).toBe(false);
    }

    // 5. 待处理决策若属于对手，则不暴露给己方
    if (state.currentPendingChoice && state.currentPendingChoice.playerId !== viewerId) {
      expect(pub.currentPendingChoice).toBeUndefined();
    }

    // 6. 事件脱敏绝不泄露 PRNG seed、对手 drawnCardIds 或对手私有 CHOICE_REQUIRED
    const sanitizedEvents = engine.getSanitizedEvents(engine.getEvents(), viewerId);
    for (const evt of sanitizedEvents) {
      if (evt.type === 'GAME_STARTED') {
        expect(evt.seed).toBe(0);
      } else if (evt.type === 'CARDS_DRAWN' && evt.playerId === opponentId) {
        expect(evt.drawnCardIds).toBeUndefined();
      } else if (evt.type === 'CHOICE_REQUIRED') {
        expect(evt.pendingChoice.playerId).toBe(viewerId);
      }
    }
  }
}

/**
 * 枚举并随机挑选一个合法动作以推进对局
 */
function pickNextAction(engine: GameEngine, rng: SeedRng): GameAction | undefined {
  const state = engine.getState();
  if (state.status === 'FINISHED') return undefined;

  // 1. 优先响应当前待处理的玩家决策
  const choice = state.currentPendingChoice;
  if (choice) {
    const eligible = choice.options.filter(
      (o) => (o.payload as { eligible?: boolean } | undefined)?.eligible !== false
    );
    const minReq = Math.min(choice.minSelections, eligible.length);
    const maxReq = Math.min(choice.maxSelections, eligible.length);
    const pickCount =
      maxReq > minReq ? minReq + Math.floor(rng.next() * (maxReq - minReq + 1)) : minReq;
    const pool = [...eligible];
    const selectedIds: string[] = [];
    for (let i = 0; i < pickCount && pool.length > 0; i++) {
      const idx = Math.floor(rng.next() * pool.length);
      selectedIds.push(pool.splice(idx, 1)[0]!.id);
    }
    return {
      type: 'SELECT_CHOICE_OPTION',
      playerId: choice.playerId,
      pendingChoiceId: choice.id,
      selectedIds,
    };
  }

  // 2. 调度阶段
  if (state.phase === 'MULLIGAN_PHASE') {
    const pendingPlayer = Object.values(state.players).find((p) => !p.hasMulliganed);
    if (!pendingPlayer) return undefined;
    const hand = engine.zoneMgr.getCardsInZone(pendingPlayer.playerId, 'HAND');
    const bottom = rng.next() < 0.5 && hand.length > 0 ? [hand[0]!.instanceId] : [];
    return {
      type: 'RESOLVE_MULLIGAN',
      playerId: pendingPlayer.playerId,
      cardInstanceIdsToBottom: bottom,
    };
  }

  // 3. 瞬时轮流时机
  if (state.timingWindow) {
    const pid = state.timingWindow.priorityPlayerId;
    if (rng.next() < 0.35) {
      const hand = engine.zoneMgr.getCardsInZone(pid, 'HAND');
      for (const c of hand) {
        const def = db.getCard(c.cardNumber);
        if (def && def.cardType === CardType.TACTICS && def.isInstant) {
          return { type: 'USE_INSTANT', playerId: pid, cardInstanceId: c.instanceId };
        }
      }
    }
    return { type: 'PASS_ACTION_TIMING', playerId: pid };
  }

  // 4. 阻挡宣言步骤
  if (state.phase === 'COMBAT_FREE_TIMING' && state.currentCombat?.step === 'BLOCK') {
    const defId = state.nonActivePlayerId;
    const readyBlockers = engine.fieldMgr
      .getSlots(defId)
      .map((s) => (s.roleCardId ? state.cards[s.roleCardId] : undefined))
      .filter((c) => !!c && c.isReady);
    if (readyBlockers.length > 0 && rng.next() < 0.5) {
      const chosen = readyBlockers[Math.floor(rng.next() * readyBlockers.length)]!;
      return { type: 'DECLARE_BLOCK', playerId: defId, blockerCardId: chosen.instanceId };
    }
    return { type: 'DECLARE_BLOCK', playerId: defId };
  }

  const active = state.activePlayerId;

  // 5. 抽牌填充阶段：随机填充 1 张手牌为明费或跳过
  if (state.phase === 'DRAW_CHARGE_PHASE') {
    const hand = engine.zoneMgr.getCardsInZone(active, 'HAND');
    if (hand.length > 0 && state.players[active]!.totalCostCount < 10) {
      const chosen = hand[Math.floor(rng.next() * hand.length)]!;
      return { type: 'CHARGE_COST_FROM_HAND', playerId: active, cardInstanceId: chosen.instanceId };
    }
    return { type: 'PASS_ACTION_TIMING', playerId: active };
  }

  // 6. 主要阶段：收集候选动作 (出角色/战术/装备/辅助机、消球、攻击、起动、结束回合)
  if (state.phase === 'MAIN_PHASE' && !state.currentCombat) {
    const candidates: GameAction[] = [];
    const player = state.players[active]!;
    const payable = player.availableOpenCostCount + player.hiddenCostCount;
    const openAttrs = new Set(
      engine.zoneMgr
        .getCardsInZone(active, 'COST')
        .filter((c) => c.isFaceUp)
        .map((c) => db.getCard(c.cardNumber)?.attribute)
    );

    const hand = engine.zoneMgr.getCardsInZone(active, 'HAND');
    const emptySlot = engine.fieldMgr.findFirstEmptySlot(active);
    for (const card of hand) {
      const def = db.getCard(card.cardNumber);
      if (!def) continue;
      if (def.isInstant && !def.rulesText.includes('主要阶段也可以发动')) continue;
      if (def.attribute !== ElementAttribute.NONE && !openAttrs.has(def.attribute)) continue;
      const { costToPay } = engine.calculateCardCost(active, card.instanceId, false);
      if (costToPay <= payable) {
        if (def.cardType === CardType.ROLE && emptySlot !== undefined) {
          candidates.push({
            type: 'PLAY_CARD',
            playerId: active,
            cardInstanceId: card.instanceId,
            targetSlotIndex: emptySlot,
          });
        } else if (def.cardType === CardType.TACTICS) {
          candidates.push({
            type: 'PLAY_CARD',
            playerId: active,
            cardInstanceId: card.instanceId,
          });
        } else if (def.cardType === CardType.EQUIPMENT && emptySlot !== undefined) {
          candidates.push({
            type: 'PLAY_CARD',
            playerId: active,
            cardInstanceId: card.instanceId,
            targetSlotIndex: emptySlot,
          });
        }
      }
    }

    // 3 消信号球
    const orbs = engine.zoneMgr.getCardsInZone(active, 'SIGNAL_ORB');
    if (orbs.length >= 3) {
      const slice = orbs.slice(0, 3);
      if (slice.every((o) => o.isFaceUp && db.getCard(o.cardNumber)?.signalOrb)) {
        candidates.push({
          type: 'ELIMINATE_3_ORBS',
          playerId: active,
          orbCardInstanceIds: slice.map((o) => o.instanceId),
        });
      }
    }

    // 可攻击角色
    const opp = state.nonActivePlayerId;
    const oppTappedRoles = engine.fieldMgr
      .getSlots(opp)
      .map((s) => (s.roleCardId ? state.cards[s.roleCardId] : undefined))
      .filter((c) => !!c && !c.isReady);

    for (const slot of engine.fieldMgr.getSlots(active)) {
      if (!slot.roleCardId) continue;
      const role = state.cards[slot.roleCardId]!;
      if (!role.isReady) continue;
      const canEnterAtk =
        role.turnEnteredZone < state.turnNumber ||
        engine.combatMgr.hasKeyword(role.instanceId, '速攻');
      if (canEnterAtk) {
        candidates.push({
          type: 'DECLARE_ATTACK',
          playerId: active,
          attackerCardId: role.instanceId,
          targetType: 'PLAYER',
        });
      }
      if ((canEnterAtk || engine.combatMgr.hasKeyword(role.instanceId, '突进')) && oppTappedRoles.length > 0) {
        candidates.push({
          type: 'DECLARE_ATTACK',
          playerId: active,
          attackerCardId: role.instanceId,
          targetType: 'CHARACTER',
          targetCardId: oppTappedRoles[0]!.instanceId,
        });
      }
    }

    if (candidates.length > 0 && rng.next() < 0.85) {
      return candidates[Math.floor(rng.next() * candidates.length)]!;
    }
    return { type: 'PASS_ACTION_TIMING', playerId: active };
  }

  return { type: 'PASS_ACTION_TIMING', playerId: active };
}

describe('4.3 & 4.5 随机化对局不变量、事务回滚与隐藏信息防泄漏测试', () => {
  const matchups: Array<['ST01' | 'ST02' | 'ST03', 'ST01' | 'ST02' | 'ST03', number]> = [
    ['ST01', 'ST02', 1001],
    ['ST02', 'ST03', 2002],
    ['ST03', 'ST01', 3003],
    ['ST01', 'ST03', 4004],
  ];

  for (const [d1, d2, seed] of matchups) {
    it(`完整随机对局不变量与脱敏校验 (${d1} vs ${d2}, seed=${seed})`, () => {
      let engine = new GameEngine(
        `fuzz-${d1}-${d2}-${seed}`,
        { playerId: 'p1', deckCardNumbers: expandDeck(d1) },
        { playerId: 'p2', deckCardNumbers: expandDeck(d2) },
        seed,
        db,
        { skipMulligan: false }
      );
      const rng = new SeedRng(seed ^ 0x9e3779b9);

      assertGameInvariants(engine);
      assertNoHiddenInfoLeak(engine);

      let steps = 0;
      const maxSteps = 220;
      while (engine.getState().status !== 'FINISHED' && steps < maxSteps) {
        steps++;
        const action = pickNextAction(engine, rng);
        if (!action) break;

        const res = engine.dispatchAction(action);
        if (!res.success) {
          // 若随机挑选的卡牌因特殊条件失败，退回安全放弃/推进，确保测试不误卡
          const st = engine.getState();
          const fallbackPid =
            st.currentPendingChoice?.playerId ??
            st.timingWindow?.priorityPlayerId ??
            (st.currentCombat?.step === 'BLOCK' ? st.nonActivePlayerId : st.activePlayerId);
          if (st.currentPendingChoice) {
            const ch = st.currentPendingChoice;
            const eligible = ch.options.filter((o) => (o.payload as { eligible?: boolean } | undefined)?.eligible !== false);
            engine.dispatchAction({
              type: 'SELECT_CHOICE_OPTION',
              playerId: ch.playerId,
              pendingChoiceId: ch.id,
              selectedIds: eligible.slice(0, ch.minSelections).map((o) => o.id),
            });
          } else {
            engine.dispatchAction({ type: 'PASS_ACTION_TIMING', playerId: fallbackPid });
          }
        }

        assertGameInvariants(engine);
        assertNoHiddenInfoLeak(engine);

        // 每 25 步验证一次事务失败回滚不变性与快照往返一致性
        if (steps % 25 === 0 && engine.getState().status !== 'FINISHED') {
          const beforeJson = JSON.stringify(engine.getState());
          const beforeEventCount = engine.getEvents().length;
          const illegalRes = engine.dispatchAction({
            type: 'PLAY_CARD',
            playerId: 'p1',
            cardInstanceId: 'non-existent-card-id',
          });
          expect(illegalRes.success).toBe(false);
          expect(JSON.stringify(engine.getState())).toBe(beforeJson);
          expect(engine.getEvents().length).toBe(beforeEventCount);

          // 快照往返还原后双方公开状态必须与原引擎完全一致
          const pub1Before = JSON.stringify(engine.getPublicState('p1'));
          const pub2Before = JSON.stringify(engine.getPublicState('p2'));
          const restored = GameEngine.fromSnapshot(engine.toSnapshot(), db);
          expect(JSON.stringify(restored.getPublicState('p1'))).toBe(pub1Before);
          expect(JSON.stringify(restored.getPublicState('p2'))).toBe(pub2Before);
          engine = restored;
        }
      }

      // 确认对局真实推进了多个回合
      expect(engine.getState().turnNumber).toBeGreaterThanOrEqual(2);
    });
  }
});

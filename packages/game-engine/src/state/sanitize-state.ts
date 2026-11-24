import { GameEvent, GameState, PublicGameState, CardInstance, PublicPendingTrigger } from '@zhanshuang/shared';

/**
 * 判断卡牌当前所在区域及正背面状态对指定玩家是否可见 (12. 隐藏信息)
 */
export function isCardVisibleToPlayer(card: CardInstance | undefined, forPlayerId: string): boolean {
  if (!card) return false;
  switch (card.zone) {
    case 'DECK':
      return false;
    case 'HAND':
      return card.controllerPlayerId === forPlayerId;
    case 'COST':
      return Boolean(card.isFaceUp) || card.controllerPlayerId === forPlayerId;
    case 'SIGNAL_ORB':
      return Boolean(card.isFaceUp);
    case 'BATTLEFIELD':
    case 'GRAVEYARD':
    case 'PROCESSING':
    default:
      return true;
  }
}

function redactHiddenCard(
  card: CardInstance,
  maskedNumber: string,
  maskedInstanceId: string
): CardInstance {
  return {
    ...card,
    instanceId: maskedInstanceId,
    cardNumber: maskedNumber,
    cardId: maskedNumber,
    imageUrl: undefined,
    turnEnteredZone: 0,
    enteredZoneTimestamp: undefined,
    enteredFromZone: undefined,
    underneathCardIds: [],
    attachedEquipmentId: undefined,
    extraAttachedEquipmentIds: undefined,
    endOfTurnToGraveyard: undefined,
    wasAscendedPlay: undefined,
    ascendedFromAirborne: undefined,
    paidHiddenCostOnPlay: undefined,
    releasePartnerToDeckBottom: undefined,
    modifiers: undefined,
    tempPPBonus: undefined,
    tempDPBonus: undefined,
    grantedKeywords: undefined,
    isFrozen: undefined,
    isAirborne: undefined,
    partnerCardId: undefined,
    partnerOfCardId: undefined,
    cannotReleasePartnerUntilTurn: undefined,
    effectivePP: undefined,
    effectiveDP: undefined,
    effectiveKeywords: undefined,
    effectiveTraits: undefined,
    effectiveProhibitions: undefined,
    effectiveOrbColors: undefined,
    effectiveOrbValue: undefined,
  };
}

/**
 * 隐藏信息脱敏 (12. 隐藏信息)
 * 根据接收玩家视角生成安全的 PublicGameState
 */
export function sanitizeGameStateForPlayer(state: GameState, forPlayerId: string): PublicGameState {
  const publicCards: Record<string, CardInstance> = {};
  const myHandCards: CardInstance[] = [];
  let opponentHandCount = 0;
  let myDeckCount = 0;
  let opponentDeckCount = 0;
  const hiddenCostCountByPlayer: Record<string, number> = {};
  const hiddenOrbCountByPlayer: Record<string, number> = {};

  for (const card of Object.values(state.cards)) {
    if (card.zone === 'HAND') {
      if (card.controllerPlayerId === forPlayerId) {
        myHandCards.push(card);
      } else {
        opponentHandCount++;
      }
    } else if (card.zone === 'DECK') {
      if (card.ownerPlayerId === forPlayerId) {
        myDeckCount++;
      } else {
        opponentDeckCount++;
      }
    } else if (card.zone === 'COST') {
      // 3.6.3.b.2 暗费只有操控玩家能够自由查看其暗费内容，对对手不保留持久 instanceId 与历史元数据
      if (!card.isFaceUp && card.controllerPlayerId !== forPlayerId) {
        const idx = hiddenCostCountByPlayer[card.controllerPlayerId] ?? 0;
        hiddenCostCountByPlayer[card.controllerPlayerId] = idx + 1;
        const maskedId = `hidden-cost:${card.controllerPlayerId}:${idx}`;
        publicCards[maskedId] = redactHiddenCard(card, 'HIDDEN_COST', maskedId);
      } else {
        publicCards[card.instanceId] = card;
      }
    } else if (card.zone === 'SIGNAL_ORB' && !card.isFaceUp) {
      // 信号球区背面放置的卡牌对双方均不可见，不保留持久 instanceId，且保持物理相对顺序 (Q&A·6 / 12.2)
      const idx = hiddenOrbCountByPlayer[card.controllerPlayerId] ?? 0;
      hiddenOrbCountByPlayer[card.controllerPlayerId] = idx + 1;
      const maskedId = `hidden-orb:${card.controllerPlayerId}:${idx}`;
      publicCards[maskedId] = redactHiddenCard(card, 'HIDDEN_ORB', maskedId);
    } else {
      // 战场、墓地、正面信号球区、处理区均为公开区域 (3.1.3)
      publicCards[card.instanceId] = card;
    }
  }

  const publicPendingTriggers: PublicPendingTrigger[] | undefined =
    state.pendingTriggers && state.pendingTriggers.length > 0
      ? state.pendingTriggers.map((t, idx) => {
          const src = state.cards[t.sourceCardInstanceId];
          if (src && !isCardVisibleToPlayer(src, forPlayerId)) {
            return {
              id: t.id,
              sourceCardInstanceId: `hidden-trigger:${idx}`,
              sourceCardNumber: 'HIDDEN_CARD',
              controllerPlayerId: t.controllerPlayerId,
              label: '隐藏区域的自动能力',
            };
          }
          return {
            id: t.id,
            sourceCardInstanceId: t.sourceCardInstanceId,
            sourceCardNumber: t.sourceCardNumber ?? src?.cardNumber ?? '',
            controllerPlayerId: t.controllerPlayerId,
            label: t.label ?? `${t.sourceCardNumber ?? t.abilityId} 自动能力`,
          };
        })
      : undefined;

  const opponentPendingChoice =
    state.currentPendingChoice && state.currentPendingChoice.playerId !== forPlayerId
      ? (() => {
          const srcId = state.currentPendingChoice!.sourceCardInstanceId;
          const src = srcId ? state.cards[srcId] : undefined;
          const hiddenSource = Boolean(src && !isCardVisibleToPlayer(src, forPlayerId));
          return {
            playerId: state.currentPendingChoice!.playerId,
            prompt: hiddenSource ? '对方正在处理决策...' : state.currentPendingChoice!.prompt,
            effectType: state.currentPendingChoice!.effectType,
          };
        })()
      : undefined;

  return {
    gameId: state.gameId,
    status: state.status,
    turnNumber: state.turnNumber,
    activePlayerId: state.activePlayerId,
    nonActivePlayerId: state.nonActivePlayerId,
    phase: state.phase,
    priorityPlayerId: state.priorityPlayerId,
    players: state.players,
    battlefields: state.battlefields,
    currentCombat: state.currentCombat,
    timingWindow: state.timingWindow,
    endPhaseStep: state.endPhaseStep,
    pendingTriggers: publicPendingTriggers,
    currentPendingChoice:
      state.currentPendingChoice?.playerId === forPlayerId
        ? state.currentPendingChoice
        : undefined,
    opponentPendingChoice,
    winnerId: state.winnerId,
    isDraw: state.isDraw,
    finishReason: state.finishReason,
    publicCards,
    myHandCards,
    opponentHandCount,
    myDeckCount,
    opponentDeckCount,
  };
}

/**
 * 增量游戏事件脱敏 (12. 隐藏信息)：
 * 对下发给特定玩家的 GameEvent 列表剥离 PRNG 种子、对手抽牌明细、隐藏区移动标识、
 * 对手私有决策内容与非公开区选项 ID，原始事件仍保留于服务端供赛后回放。
 */
export function sanitizeGameEventsForPlayer(
  events: GameEvent[],
  state: GameState,
  forPlayerId: string
): GameEvent[] {
  const result: GameEvent[] = [];

  for (const evt of events) {
    switch (evt.type) {
      case 'GAME_STARTED': {
        result.push({ ...evt, seed: 0 });
        break;
      }
      case 'CARDS_DRAWN': {
        if (evt.playerId !== forPlayerId) {
          const { drawnCardIds: _omitted, ...rest } = evt;
          result.push(rest);
        } else {
          result.push(evt);
        }
        break;
      }
      case 'CARD_MOVED': {
        const card = state.cards[evt.cardInstanceId];
        const fromVisible =
          evt.fromZone === 'BATTLEFIELD' ||
          evt.fromZone === 'GRAVEYARD' ||
          evt.fromZone === 'PROCESSING';
        const toVisible =
          evt.toZone === 'BATTLEFIELD' ||
          evt.toZone === 'GRAVEYARD' ||
          evt.toZone === 'PROCESSING' ||
          (evt.toZone === 'SIGNAL_ORB' && evt.isFaceUp) ||
          (evt.toZone === 'COST' && (evt.isFaceUp || card?.controllerPlayerId === forPlayerId)) ||
          (evt.toZone === 'HAND' && card?.controllerPlayerId === forPlayerId);
        if (!fromVisible && !toVisible) {
          result.push({ ...evt, cardInstanceId: 'HIDDEN_CARD' });
        } else {
          result.push(evt);
        }
        break;
      }
      case 'CHOICE_REQUIRED': {
        if (evt.pendingChoice.playerId === forPlayerId) {
          result.push(evt);
        }
        break;
      }
      case 'CHOICE_RESOLVED': {
        if (evt.playerId !== forPlayerId) {
          result.push({
            ...evt,
            selectedIds: evt.selectedIds.map((id) =>
              state.cards[id] && isCardVisibleToPlayer(state.cards[id], forPlayerId) ? id : 'REDACTED'
            ),
          });
        } else {
          result.push(evt);
        }
        break;
      }
      case 'COST_PAID': {
        const redactIds = (ids: string[]) =>
          ids.map((id) => {
            const c = state.cards[id];
            return c && !isCardVisibleToPlayer(c, forPlayerId) ? 'HIDDEN_CARD' : id;
          });
        result.push({
          ...evt,
          openCostTappedIds: redactIds(evt.openCostTappedIds),
          hiddenCostDiscardedIds: redactIds(evt.hiddenCostDiscardedIds),
        });
        break;
      }
      case 'ABILITY_ACTIVATED': {
        const src = state.cards[evt.cardInstanceId];
        if (src && !isCardVisibleToPlayer(src, forPlayerId)) {
          result.push({
            ...evt,
            cardInstanceId: 'HIDDEN_CARD',
            abilityName: '隐藏区域能力',
            rulesText: '',
          });
        } else {
          result.push(evt);
        }
        break;
      }
      default: {
        result.push(evt);
        break;
      }
    }
  }

  return result;
}

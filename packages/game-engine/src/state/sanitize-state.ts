import { GameState, PublicGameState, CardInstance, PublicPendingTrigger } from '@zhanshuang/shared';

function redactHiddenCard(card: CardInstance, maskedNumber: string): CardInstance {
  return {
    ...card,
    cardNumber: maskedNumber,
    cardId: maskedNumber,
    imageUrl: undefined,
    modifiers: undefined,
    tempPPBonus: undefined,
    tempDPBonus: undefined,
    grantedKeywords: undefined,
    isFrozen: undefined,
    effectivePP: undefined,
    effectiveDP: undefined,
    effectiveKeywords: undefined,
    effectiveTraits: undefined,
    effectiveProhibitions: undefined,
    effectiveOrbColors: undefined,
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
      // 3.6.3.b.2 暗费只有操控玩家能够自由查看其暗费内容 (同时剥离 imageUrl 等元数据防泄露)
      if (!card.isFaceUp && card.controllerPlayerId !== forPlayerId) {
        publicCards[card.instanceId] = redactHiddenCard(card, 'HIDDEN_COST');
      } else {
        publicCards[card.instanceId] = card;
      }
    } else if (card.zone === 'SIGNAL_ORB' && !card.isFaceUp) {
      // 信号球区背面放置的卡牌对双方均不可见 (Q&A·6 / 12.2)
      publicCards[card.instanceId] = redactHiddenCard(card, 'HIDDEN_ORB');
    } else {
      // 战场、墓地、正面信号球区、处理区均为公开区域 (3.1.3)
      publicCards[card.instanceId] = card;
    }
  }

  const publicPendingTriggers: PublicPendingTrigger[] | undefined =
    state.pendingTriggers && state.pendingTriggers.length > 0
      ? state.pendingTriggers.map((t) => ({
          id: t.id,
          sourceCardInstanceId: t.sourceCardInstanceId,
          sourceCardNumber: t.sourceCardNumber ?? state.cards[t.sourceCardInstanceId]?.cardNumber ?? '',
          controllerPlayerId: t.controllerPlayerId,
          label: t.label ?? `${t.sourceCardNumber ?? t.abilityId} 自动能力`,
        }))
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
    opponentPendingChoice:
      state.currentPendingChoice && state.currentPendingChoice.playerId !== forPlayerId
        ? {
            playerId: state.currentPendingChoice.playerId,
            prompt: state.currentPendingChoice.prompt,
            effectType: state.currentPendingChoice.effectType,
          }
        : undefined,
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

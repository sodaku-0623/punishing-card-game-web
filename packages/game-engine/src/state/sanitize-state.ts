import { GameState, PublicGameState, CardInstance } from '@zhanshuang/shared';

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
      // 3.6.3.b.2 暗费只有操控玩家能够自由查看其暗费内容
      if (!card.isFaceUp && card.controllerPlayerId !== forPlayerId) {
        publicCards[card.instanceId] = {
          ...card,
          cardNumber: 'HIDDEN_COST',
          cardId: 'HIDDEN_COST',
        };
      } else {
        publicCards[card.instanceId] = card;
      }
    } else {
      // 战场、墓地、信号球区、处理区均为公开区域 (3.1.3)
      publicCards[card.instanceId] = card;
    }
  }

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

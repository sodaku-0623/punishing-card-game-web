/**
 * 《战双帕弥什 卡牌对战》游戏事件模型 (Server -> Client Events)
 */

import { GamePhase, ZoneId, PendingChoice } from './game.js';

export type GameEvent =
  | { type: 'GAME_STARTED'; firstPlayerId: string; seed: number }
  | { type: 'TURN_STARTED'; turnNumber: number; activePlayerId: string }
  | { type: 'PHASE_CHANGED'; fromPhase: GamePhase; toPhase: GamePhase }
  | { type: 'CARDS_DRAWN'; playerId: string; count: number; drawnCardIds?: string[] }
  | { type: 'MULLIGAN_COMPLETED'; playerId: string; bottomCount: number; redrawCount: number }
  | { 
      type: 'CARD_MOVED'; 
      cardInstanceId: string; 
      fromZone: ZoneId; 
      toZone: ZoneId; 
      fromSlot?: number; 
      toSlot?: number; 
      isFaceUp: boolean; 
      isReady: boolean; 
    }
  | { type: 'CARDS_SHUFFLED'; playerId: string; zone: ZoneId }
  | { type: 'COST_PAID'; playerId: string; openCostTappedIds: string[]; hiddenCostDiscardedIds: string[] }
  | { type: 'CARD_PLAYED'; playerId: string; cardInstanceId: string; slotIndex: number; isAscension: boolean }
  | { type: 'CARD_ASCENDED'; parentCardId: string; underneathCardIds: string[] }
  | { type: 'CARD_EQUIPPED'; equipmentCardId: string; roleCardId: string }
  | { type: 'ORBS_ELIMINATED'; playerId: string; orbCardIds: string[]; cardDrawnCount: number }
  | { type: 'ATTACK_DECLARED'; attackerCardId: string; targetType: 'PLAYER' | 'CHARACTER'; targetCardId?: string }
  | { type: 'BLOCK_DECLARED'; blockerCardId?: string; isBlocked: boolean }
  | { 
      type: 'ATTACK_CHARGE_PERFORMED'; 
      attackerCardId: string; 
      chargeIndex: number; 
      revealedCardId: string; 
      resultDestination: 'SIGNAL_ORB' | 'HAND'; 
    }
  | { 
      type: 'DAMAGE_CHARGE_PERFORMED'; 
      defenderPlayerId: string; 
      revealedCardId: string; 
      placedToCostFaceDown: boolean; 
    }
  | { 
      type: 'EROSION_INCREASED'; 
      playerId: string; 
      previousValue: number; 
      newValue: number; 
      reason: 'DAMAGE' | 'DECK_REFRESH' | 'EFFECT'; 
    }
  | { 
      type: 'BATTLE_COMPARED'; 
      attackerCardId: string; 
      attackerPP: number; 
      defenderCardId: string; 
      defenderPP: number; 
      destroyedDefenderCardId?: string; 
    }
  | { type: 'CARD_DESTROYED'; cardInstanceId: string; reason: 'BATTLE' | 'PP_ZERO' | 'EFFECT' }
  | { type: 'DECK_REFRESHED'; playerId: string; cardsShuffledCount: number; newErosionCount: number }
  | { type: 'CHOICE_REQUIRED'; pendingChoice: PendingChoice }
  | { type: 'ABILITY_ACTIVATED'; playerId: string; cardInstanceId: string; abilityName: string; rulesText: string }
  | { type: 'CHOICE_RESOLVED'; playerId: string; pendingChoiceId: string; selectedIds: string[] }
  | { type: 'PLAYER_DISCONNECTED'; playerId: string; message: string }
  | { type: 'PLAYER_RECONNECTED'; playerId: string; message: string }
  | { type: 'GAME_OVER'; winnerPlayerId?: string; isDraw: boolean; reason: string };

export interface LoggedGameEvent {
  seq: number;
  gameId: string;
  event: GameEvent;
  timestamp: number;
}

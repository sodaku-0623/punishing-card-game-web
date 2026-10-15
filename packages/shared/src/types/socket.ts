/**
 * WebSocket 双向消息协议 (Client <-> Server)
 */

import { GameAction } from './actions.js';
import { GameEvent } from './events.js';
import { PublicGameState, PendingChoice } from './game.js';
import { PublicRoomState } from './room.js';

export interface ClientToServerEvents {
  /** userId 字段已废弃：服务端仅以握手阶段认证的身份为准 */
  'room:join': (payload: { roomId: string; title?: string; password?: string; userId?: string; username?: string }) => void;
  'room:leave': (payload?: { roomId?: string }) => void;
  'room:ready': (payload: { isReady: boolean; deckId: string; roomId?: string; customDeck?: any }) => void;
  'room:select_deck': (payload: { roomId?: string; deckId: string; customDeck?: any }) => void;
  'room:start': (payload?: { roomId?: string }) => void;
  'game:action': (payload: { gameId: string; action: GameAction }) => void;
  'game:choice': (payload: { gameId: string; pendingChoiceId: string; selectedIds: string[] }) => void;
  /** userId 字段已废弃：服务端仅以握手阶段认证的身份为准 */
  'game:reconnect': (payload: { gameId: string; userId?: string }) => void;
  'game:leave': (payload: { gameId: string; isSurrender?: boolean }) => void;
}

export interface ServerToClientEvents {
  'room:state_updated': (room: PublicRoomState) => void;
  'room:closed': (payload: { roomId: string; reason?: string }) => void;
  'room:deleted': (payload: { roomId: string }) => void;
  'game:sync_state': (state: PublicGameState) => void;
  'game:events': (events: GameEvent[]) => void;
  'game:choice_required': (choice: PendingChoice) => void;
  'game:player_disconnected': (payload: { userId: string; message?: string }) => void;
  'game:player_reconnected': (payload: { userId: string; message?: string }) => void;
  'game:error': (error: { code: string; message: string; details?: unknown }) => void;
  'game:ended': (result: { winnerId?: string; isDraw: boolean; reason: string }) => void;
}

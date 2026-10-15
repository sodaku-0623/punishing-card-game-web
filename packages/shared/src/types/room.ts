/**
 * 房间与对局大厅状态模型 (第20章 Room System)
 */

export enum RoomStatus {
  WAITING = 'WAITING',
  READY = 'READY',
  PLAYING = 'PLAYING',
  FINISHED = 'FINISHED',
  CLOSED = 'CLOSED',
}

export interface RoomPlayerDto {
  userId: string;
  username: string;
  nickname: string;
  avatarUrl?: string;
  seatIndex: number; // 0 或 1
  isReady: boolean;
  deckId?: string;
  deckName?: string;
  isOnline: boolean;
}

export interface PublicRoomState {
  roomId: string;
  roomCode: string;
  title: string;
  hasPassword: boolean;
  creatorId: string;
  status: RoomStatus;
  players: RoomPlayerDto[];
  currentGameId?: string;
  createdAt: number;
}

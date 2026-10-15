import { RoomStatus, PublicRoomState, RoomPlayerDto, ErrorCode } from '@zhanshuang/shared';
import { IRoomRepository, IDeckRepository, ICardRepository } from '@zhanshuang/database';

export interface RoomOperationResult<T = unknown> {
  success: boolean;
  data?: T;
  closed?: boolean;
  errorCode?: ErrorCode;
  errorMessage?: string;
}

export class RoomManager {
  private activeRooms: Map<string, PublicRoomState> = new Map();

  constructor(
    private roomRepo: IRoomRepository,
    private deckRepo: IDeckRepository,
    private cardRepo?: ICardRepository
  ) {}

  async createRoom(
    creatorId: string,
    creatorName: string,
    title: string,
    password?: string,
    customRoomId?: string
  ): Promise<RoomOperationResult<PublicRoomState>> {
    const roomId = customRoomId || `room-${Date.now()}`;
    const roomCode = Math.random().toString(36).substring(2, 8).toUpperCase();

    // 若房主先前有残留的未开战旧房间或已完赛房间，先行清理旧房间
    for (const r of this.activeRooms.values()) {
      if (r.players.some((p) => p.userId === creatorId)) {
        if (r.status !== RoomStatus.PLAYING) {
          r.players = r.players.filter((p) => p.userId !== creatorId);
          if (r.players.length === 0) {
            r.status = RoomStatus.CLOSED;
            this.activeRooms.delete(r.roomId);
            try {
              await this.roomRepo.updateStatus(r.roomId, RoomStatus.CLOSED as any);
            } catch {}
          }
        }
      }
    }

    try {
      await this.roomRepo.create(creatorId, title, roomCode, password, roomId);
    } catch {}

    const publicRoom: PublicRoomState = {
      roomId,
      roomCode,
      title,
      hasPassword: !!password,
      creatorId,
      status: RoomStatus.WAITING,
      players: [
        {
          userId: creatorId,
          username: `user_${creatorId}`,
          nickname: creatorName,
          seatIndex: 0,
          isReady: false,
          isOnline: true,
        },
      ],
      createdAt: Date.now(),
    };

    this.activeRooms.set(roomId, publicRoom);
    return { success: true, data: publicRoom };
  }

  async joinRoom(
    roomId: string,
    userId: string,
    userName: string,
    title?: string,
    password?: string
  ): Promise<RoomOperationResult<PublicRoomState>> {
    let room = this.activeRooms.get(roomId);
    if (!room) {
      const repoRoom = await this.roomRepo.findById(roomId);
      if (repoRoom) {
        room = {
          roomId: repoRoom.id,
          roomCode: repoRoom.roomCode,
          title: title?.trim() || repoRoom.title,
          hasPassword: !!repoRoom.passwordHash,
          creatorId: repoRoom.creatorId,
          status: RoomStatus.WAITING,
          players: repoRoom.players.map((p) => ({
            userId: p.userId,
            username: p.username,
            nickname: p.nickname,
            seatIndex: p.seatIndex,
            isReady: p.isReady,
            isOnline: true,
          })),
          createdAt: repoRoom.createdAt.getTime(),
        };
        this.activeRooms.set(roomId, room);
      } else {
        const roomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
        room = {
          roomId,
          roomCode,
          title: title?.trim() || `作战推演室 #${roomId}`,
          hasPassword: !!password,
          creatorId: userId,
          status: RoomStatus.WAITING,
          players: [
            {
              userId,
              username: `user_${userId}`,
              nickname: userName,
              seatIndex: 0,
              isReady: false,
              isOnline: true,
            },
          ],
          createdAt: Date.now(),
        };
        this.activeRooms.set(roomId, room);
        try {
          await this.roomRepo.create(userId, room.title, roomCode, password, roomId);
        } catch {}
        return { success: true, data: room };
      }
    } else {
      if (title?.trim() && room.creatorId === userId) {
        room.title = title.trim();
      }
    }

    // 若该玩家先前有残留的未开战旧房间或已完赛房间，先行清理旧房间
    for (const r of this.activeRooms.values()) {
      if (r.roomId !== roomId && r.players.some((p) => p.userId === userId)) {
        if (r.status !== RoomStatus.PLAYING) {
          r.players = r.players.filter((p) => p.userId !== userId);
          if (r.players.length === 0) {
            r.status = RoomStatus.CLOSED;
            this.activeRooms.delete(r.roomId);
            try {
              await this.roomRepo.updateStatus(r.roomId, RoomStatus.CLOSED as any);
            } catch {}
          }
        }
      }
    }

    if (room.players.some((p) => p.userId === userId)) {
      const p = room.players.find((item) => item.userId === userId)!;
      p.nickname = userName;
      p.isOnline = true;
      return { success: true, data: room }; // 已在房间中，同步名称与在线态
    }

    if (room.status === RoomStatus.PLAYING) {
      return {
        success: false,
        errorCode: ErrorCode.ACTION_NOT_ALLOWED,
        errorMessage: '作战推演进行中，非本局玩家无法加入',
      };
    }

    if (room.players.length >= 2) {
      return { success: false, errorCode: ErrorCode.ROOM_FULL, errorMessage: '房间人数已满' };
    }

    const seatIndex = room.players.some((p) => p.seatIndex === 0) ? 1 : 0;
    const newPlayer: RoomPlayerDto = {
      userId,
      username: `user_${userId}`,
      nickname: userName,
      seatIndex,
      isReady: false,
      isOnline: true,
    };

    room.players.push(newPlayer);
    try {
      await this.roomRepo.addPlayer(roomId, userId, seatIndex);
    } catch {}

    return { success: true, data: room };
  }

  async leaveRoom(roomId: string, userId: string): Promise<RoomOperationResult<PublicRoomState>> {
    const room = this.activeRooms.get(roomId);
    if (!room) return { success: false, errorCode: ErrorCode.ROOM_NOT_FOUND, errorMessage: '房间不存在' };

    // 核心规则：若对战正在进行中 (PLAYING)，某一方因掉线或退出绝不立即关闭房间，保留席位供其重连！
    if (room.status === RoomStatus.PLAYING) {
      const player = room.players.find((p) => p.userId === userId);
      if (player) {
        player.isOnline = false;
      }
      const onlinePlayers = room.players.filter((p) => p.isOnline);
      // 仅当对局中双方均已离线离开时，才自动彻底关闭房间
      if (onlinePlayers.length === 0) {
        room.status = RoomStatus.CLOSED;
        this.activeRooms.delete(roomId);
        try {
          await this.roomRepo.updateStatus(roomId, RoomStatus.CLOSED as any);
        } catch {}
        return { success: true, closed: true, data: { ...room, status: RoomStatus.CLOSED, players: [] } };
      }
      // 仍有一方在线等待，房间继续维持 PLAYING 状态
      return { success: true, closed: false, data: room };
    }

    // 若对局已完赛 (FINISHED) 或等待中，离开直接移除席位
    if (room.status === RoomStatus.FINISHED) {
      room.players = room.players.filter((p) => p.userId !== userId);
      try {
        await this.roomRepo.removePlayer(roomId, userId);
      } catch {}
      if (room.players.length === 0) {
        room.status = RoomStatus.CLOSED;
        this.activeRooms.delete(roomId);
        try {
          await this.roomRepo.updateStatus(roomId, RoomStatus.CLOSED as any);
        } catch {}
        return { success: true, closed: true, data: { ...room, status: RoomStatus.CLOSED, players: [] } };
      }
      return { success: true, closed: false, data: room };
    }

    room.players = room.players.filter((p) => p.userId !== userId);
    try {
      await this.roomRepo.removePlayer(roomId, userId);
    } catch {}

    // 房间规则核心：当所有玩家（两人，或仅有的单人）都退出房间时，自动关闭该房间
    if (room.players.length === 0) {
      room.status = RoomStatus.CLOSED;
      this.activeRooms.delete(roomId);
      try {
        await this.roomRepo.updateStatus(roomId, RoomStatus.CLOSED as any);
      } catch {}
      return { success: true, closed: true, data: { ...room, status: RoomStatus.CLOSED, players: [] } };
    }

    // 仍有 1 名玩家留在房间中
    // 若原房主离开，自动移交房主权限给剩余玩家
    if (room.creatorId === userId && room.players.length > 0) {
      room.creatorId = room.players[0]!.userId;
    }

    // 状态回归为等待中，重置准备状态
    room.status = RoomStatus.WAITING;
    for (const p of room.players) {
      p.isReady = false;
    }

    return { success: true, closed: false, data: room };
  }

  async closeRoom(roomId: string): Promise<boolean> {
    const room = this.activeRooms.get(roomId);
    if (!room) return false;
    room.status = RoomStatus.CLOSED;
    room.players = [];
    this.activeRooms.delete(roomId);
    try {
      await this.roomRepo.updateStatus(roomId, RoomStatus.CLOSED as any);
    } catch {}
    return true;
  }

  getRoomByUserId(userId: string): PublicRoomState | undefined {
    for (const r of this.activeRooms.values()) {
      if (r.players.some((p) => p.userId === userId)) {
        return r;
      }
    }
    return undefined;
  }

  getRoomByGameId(gameId: string): PublicRoomState | undefined {
    for (const r of this.activeRooms.values()) {
      if (r.currentGameId === gameId) {
        return r;
      }
    }
    return undefined;
  }

  markPlayerOnline(roomId: string, userId: string, isOnline: boolean): PublicRoomState | undefined {
    const room = this.activeRooms.get(roomId);
    if (!room) return undefined;
    const player = room.players.find((p) => p.userId === userId);
    if (player) {
      player.isOnline = isOnline;
    }
    return room;
  }

  private async resolveOrSyncDeck(userId: string, deckId: string, customDeck?: any) {
    let deck = await this.deckRepo.findById(deckId);

    // 如果客户端传入了前端自定义卡组结构，立即同步到服务端的 DeckRepo
    if (customDeck && customDeck.cards && customDeck.cards.length > 0) {
      const effectiveDeckId = customDeck.id || deckId;
      const deckName = customDeck.name || '自定义构筑卡组';
      const deckDesc = customDeck.description || '';

      if (!deck) {
        try {
          deck = await this.deckRepo.create(userId, deckName, deckDesc, effectiveDeckId);
        } catch {
          deck = await this.deckRepo.findById(effectiveDeckId);
        }
      } else {
        try {
          await this.deckRepo.update(deck.id, deckName, deckDesc);
        } catch {}
      }

      if (deck) {
        const normalizedCards: { cardId: string; count: number; imageUrl?: string }[] = [];
        for (const item of customDeck.cards) {
          let c = null;
          if (this.cardRepo) {
            if (item.cardId) c = await this.cardRepo.findById(item.cardId);
            if (!c && item.cardNumber) c = await this.cardRepo.findByCardNumber(item.cardNumber);
            if (!c && item.cardId) {
              const cleaned = item.cardId.replace(/^c-/, '').toUpperCase();
              c = await this.cardRepo.findByCardNumber(cleaned);
            }
          }
          if (c) {
            normalizedCards.push({
              cardId: c.id,
              count: Number(item.count) || 1,
              imageUrl: item.imageUrl || c.imageUrl,
            });
          } else if (item.cardId || item.cardNumber) {
            normalizedCards.push({
              cardId: item.cardId || item.cardNumber,
              count: Number(item.count) || 1,
              imageUrl: item.imageUrl,
            });
          }
        }

        if (normalizedCards.length > 0) {
          try {
            await this.deckRepo.setCards(deck.id, normalizedCards, true);
            deck = await this.deckRepo.findById(deck.id);
          } catch {}
        }
      }
    }

    if (!deck) {
      if (deckId.includes('st02')) {
        deck = await this.deckRepo.findById('deck-st02');
      } else if (deckId.includes('st03')) {
        deck = await this.deckRepo.findById('deck-st03');
      } else if (deckId.includes('1791110685763') || deckId === 'deck-st01' || deckId === 'default-starter-deck') {
        deck = (await this.deckRepo.findById('deck-1791110685763')) || (await this.deckRepo.findById('default-starter-deck')) || (await this.deckRepo.findById('deck-st01'));
      }
    }

    if (!deck) {
      const sysDecks = await this.deckRepo.findByUserId('system');
      deck = sysDecks[0] || null;
    }

    return deck;
  }

  async setReady(
    roomId: string,
    userId: string,
    isReady: boolean,
    deckId: string,
    customDeck?: any
  ): Promise<RoomOperationResult<PublicRoomState>> {
    const room = this.activeRooms.get(roomId);
    if (!room) return { success: false, errorCode: ErrorCode.ROOM_NOT_FOUND, errorMessage: '房间不存在' };

    const player = room.players.find((p) => p.userId === userId);
    if (!player) return { success: false, errorCode: ErrorCode.UNAUTHORIZED, errorMessage: '非房间内玩家' };

    if (isReady) {
      const deck = await this.resolveOrSyncDeck(userId, deckId, customDeck);
      if (deck) {
        player.deckId = deck.id;
        player.deckName = deck.name;
      } else {
        player.deckId = deckId;
        player.deckName = customDeck?.name || '自定义构筑卡组';
      }
      player.isReady = true;
    } else {
      player.isReady = false;
    }

    const allReady = room.players.length === 2 && room.players.every((p) => p.isReady);
    room.status = allReady ? RoomStatus.READY : RoomStatus.WAITING;
    try {
      await this.roomRepo.setPlayerReady(roomId, userId, isReady);
    } catch {}

    return { success: true, data: room };
  }

  async setPlayerDeck(
    roomId: string,
    userId: string,
    deckId: string,
    customDeck?: any
  ): Promise<RoomOperationResult<PublicRoomState>> {
    const room = this.activeRooms.get(roomId);
    if (!room) return { success: false, errorCode: ErrorCode.ROOM_NOT_FOUND, errorMessage: '房间不存在' };

    const player = room.players.find((p) => p.userId === userId);
    if (!player) return { success: false, errorCode: ErrorCode.UNAUTHORIZED, errorMessage: '非房间内玩家' };

    const deck = await this.resolveOrSyncDeck(userId, deckId, customDeck);
    if (deck) {
      player.deckId = deck.id;
      player.deckName = deck.name;
    } else {
      player.deckId = deckId;
      player.deckName = customDeck?.name || '自定义构筑卡组';
    }

    return { success: true, data: room };
  }

  findRoomByIdOrCode(query: string): PublicRoomState | undefined {
    if (!query) return undefined;
    const q = query.trim().toUpperCase();
    for (const [id, r] of this.activeRooms.entries()) {
      if (id.toUpperCase() === q || r.roomCode.toUpperCase() === q) {
        return r;
      }
    }
    return undefined;
  }

  getRoom(roomId: string): PublicRoomState | undefined {
    return this.activeRooms.get(roomId);
  }

  listRooms(): PublicRoomState[] {
    return Array.from(this.activeRooms.values()).filter(
      (r) => r.status !== RoomStatus.CLOSED && r.players.length > 0
    );
  }
}

import crypto from 'node:crypto';
import { RoomStatus, PublicRoomState, RoomPlayerDto, ErrorCode } from '@zhanshuang/shared';
import { IRoomRepository, IDeckRepository, ICardRepository, DeckEntity } from '@zhanshuang/database';
import { validateDeck, DeckCardInput } from '@zhanshuang/game-rules';

/** 官方预组的历史别名 (客户端可能使用任一 ID 引用同一套系统卡组) */
const ST01_DECK_ALIASES = ['deck-1791110685763', 'default-starter-deck', 'deck-st01'];
const MAX_CUSTOM_DECK_ENTRIES = 200;

function hashRoomPassword(password: string): string {
  return crypto.createHash('sha256').update(password).digest('hex');
}

/** 仓储中仅保存密码摘要，绝不保存明文 */
function digestOrUndefined(password?: string): string | undefined {
  const trimmed = password?.trim();
  return trimmed ? hashRoomPassword(trimmed) : undefined;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

export interface RoomOperationResult<T = unknown> {
  success: boolean;
  data?: T;
  closed?: boolean;
  errorCode?: ErrorCode;
  errorMessage?: string;
}

export class RoomManager {
  private activeRooms: Map<string, PublicRoomState> = new Map();
  /** roomId -> 房间密码摘要 (仅服务端持有，绝不随 PublicRoomState 下发) */
  private roomPasswords: Map<string, string> = new Map();

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
            this.forgetRoom(r.roomId);
            try {
              await this.roomRepo.updateStatus(r.roomId, RoomStatus.CLOSED as any);
            } catch {}
          }
        }
      }
    }

    try {
      await this.roomRepo.create(creatorId, title, roomCode, digestOrUndefined(password), roomId);
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
    this.setRoomPassword(roomId, password);
    return { success: true, data: publicRoom };
  }

  private setRoomPassword(roomId: string, password?: string): void {
    const trimmed = password?.trim();
    if (trimmed) {
      this.roomPasswords.set(roomId, hashRoomPassword(trimmed));
    } else {
      this.roomPasswords.delete(roomId);
    }
  }

  /** 校验房间密码；未设置密码的房间始终通过 */
  checkRoomPassword(roomId: string, password?: string): boolean {
    const expected = this.roomPasswords.get(roomId);
    if (!expected) return true;
    if (!password) return false;
    return safeEqual(expected, hashRoomPassword(password.trim()));
  }

  private forgetRoom(roomId: string): void {
    this.activeRooms.delete(roomId);
    this.roomPasswords.delete(roomId);
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
      // 已关闭的历史房间不再恢复，按新房间处理 (避免沿用旧成员与旧密码状态)
      if (repoRoom && repoRoom.status !== (RoomStatus.CLOSED as any)) {
        // 恢复房间时同步恢复密码摘要，否则「有密码」的房间会变为任何人可进入
        if (repoRoom.passwordHash) {
          this.roomPasswords.set(roomId, repoRoom.passwordHash);
        }
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
        this.setRoomPassword(roomId, password);
        try {
          await this.roomRepo.create(userId, room.title, roomCode, digestOrUndefined(password), roomId);
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
            this.forgetRoom(r.roomId);
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

    if (!this.checkRoomPassword(roomId, password)) {
      return {
        success: false,
        errorCode: password ? ErrorCode.ROOM_PASSWORD_INVALID : ErrorCode.ROOM_PASSWORD_REQUIRED,
        errorMessage: password ? '房间密码错误，请重新输入' : '该房间已设置密码，请输入房间密码',
      };
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

    // 非房间成员的离开请求 (如未成功加入的访客离开页面) 不得影响房间状态与他人准备状态
    if (!room.players.some((p) => p.userId === userId)) {
      return { success: true, closed: false, data: room };
    }

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
        this.forgetRoom(roomId);
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
        this.forgetRoom(roomId);
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
      this.forgetRoom(roomId);
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
    this.forgetRoom(roomId);
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

  /**
   * 解析玩家出战卡组。
   * - 系统预组始终使用服务端权威数据，忽略客户端上传的卡表；
   * - 客户端自定义卡组必须通过 5.1 构筑规则校验，且只能写入该玩家自己名下的卡组，绝不覆盖系统或他人卡组。
   */
  private async resolveOrSyncDeck(
    userId: string,
    deckId: string,
    customDeck?: any
  ): Promise<{ deck: DeckEntity | null; error?: string }> {
    const deck = deckId ? await this.deckRepo.findById(deckId) : null;
    if (deck && deck.userId === 'system') {
      return { deck };
    }

    if (customDeck && Array.isArray(customDeck.cards) && customDeck.cards.length > 0) {
      if (!this.cardRepo) {
        return { deck: null, error: '服务端卡牌数据库未就绪，暂无法使用自定义卡组' };
      }
      if (customDeck.cards.length > MAX_CUSTOM_DECK_ENTRIES) {
        return { deck: null, error: '自定义卡组条目数量异常' };
      }

      const normalizedCards: { cardId: string; count: number; imageUrl?: string }[] = [];
      const validationInput: DeckCardInput[] = [];
      for (const item of customDeck.cards) {
        const rawCardId = typeof item?.cardId === 'string' ? item.cardId : undefined;
        const rawCardNumber = typeof item?.cardNumber === 'string' ? item.cardNumber : undefined;
        let c = rawCardId ? await this.cardRepo.findById(rawCardId) : null;
        if (!c && rawCardNumber) c = await this.cardRepo.findByCardNumber(rawCardNumber);
        if (!c && rawCardId) {
          c = await this.cardRepo.findByCardNumber(rawCardId.replace(/^c-/, '').toUpperCase());
        }
        if (!c) {
          return { deck: null, error: `自定义卡组包含未知卡牌: ${rawCardNumber || rawCardId || '(空)'}` };
        }
        const count = Math.floor(Number(item.count));
        if (!Number.isFinite(count) || count <= 0) {
          return { deck: null, error: `卡牌 ${c.name} (${c.cardNumber}) 数量非法` };
        }
        normalizedCards.push({
          cardId: c.id,
          count,
          imageUrl: typeof item.imageUrl === 'string' ? item.imageUrl : c.imageUrl ?? undefined,
        });
        validationInput.push({
          cardId: c.id,
          cardNumber: c.cardNumber,
          name: c.name,
          signalOrb: c.signalOrb as any,
          count,
        });
      }

      const validation = validateDeck(validationInput);
      if (!validation.isValid) {
        return { deck: null, error: `卡组不符合构筑规则：${validation.errors.join('；')}` };
      }

      // 客户端卡组 ID 仅在本人名下有效；与系统或他人卡组重名时，落入该玩家私有命名空间
      const requestedId = String(customDeck.id || deckId || '').slice(0, 128);
      let targetId = requestedId || undefined;
      let target = targetId ? await this.deckRepo.findById(targetId) : null;
      if (target && target.userId !== userId) {
        targetId = `${userId}:${requestedId}`;
        target = await this.deckRepo.findById(targetId);
      }

      const deckName = String(customDeck.name || '自定义构筑卡组').slice(0, 64);
      const deckDesc = String(customDeck.description || '').slice(0, 500);
      if (!target) {
        target = await this.deckRepo.create(userId, deckName, deckDesc, targetId);
      } else {
        target = await this.deckRepo.update(target.id, deckName, deckDesc);
      }
      const saved = await this.deckRepo.setCards(target.id, normalizedCards, true);
      return { deck: saved };
    }

    if (deck) {
      return { deck };
    }

    // 兼容旧版客户端的预组别名
    let fallback: DeckEntity | null = null;
    if (deckId?.includes('st02')) {
      fallback = await this.deckRepo.findById('deck-st02');
    } else if (deckId?.includes('st03')) {
      fallback = await this.deckRepo.findById('deck-st03');
    } else if (deckId && (deckId.includes('1791110685763') || ST01_DECK_ALIASES.includes(deckId))) {
      for (const alias of ST01_DECK_ALIASES) {
        fallback = await this.deckRepo.findById(alias);
        if (fallback) break;
      }
    }
    if (!fallback) {
      const sysDecks = await this.deckRepo.findByUserId('system');
      fallback = sysDecks[0] || null;
    }
    return { deck: fallback };
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
      const { deck, error } = await this.resolveOrSyncDeck(userId, deckId, customDeck);
      if (error || !deck) {
        return {
          success: false,
          errorCode: ErrorCode.INVALID_DECK,
          errorMessage: error ?? '找不到可用的出战卡组',
        };
      }
      player.deckId = deck.id;
      player.deckName = deck.name;
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

    const { deck, error } = await this.resolveOrSyncDeck(userId, deckId, customDeck);
    if (error || !deck) {
      return {
        success: false,
        errorCode: ErrorCode.INVALID_DECK,
        errorMessage: error ?? '找不到可用的出战卡组',
      };
    }
    player.deckId = deck.id;
    player.deckName = deck.name;

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

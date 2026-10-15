import {
  ICardRepository,
  IDeckRepository,
  IRoomRepository,
  IGameRepository,
  IUserRepository,
  CardEntity,
  CardVersionEntity,
  CardCreateInput,
  CardFilterOptions,
  DeckEntity,
  RoomEntity,
  GameEntity,
  UserEntity,
} from './interfaces.js';
import { Role, RoomStatus } from '@prisma/client';

export class MemoryUserRepository implements IUserRepository {
  private users: Map<string, UserEntity> = new Map();

  async findById(id: string): Promise<UserEntity | null> {
    return this.users.get(id) ?? null;
  }

  async findByUsername(username: string): Promise<UserEntity | null> {
    for (const u of this.users.values()) {
      if (u.username === username) return u;
    }
    return null;
  }

  async create(username: string, passwordHash: string, nickname: string, role: Role = Role.USER): Promise<UserEntity> {
    const id = `user-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const user: UserEntity = {
      id,
      username,
      passwordHash,
      nickname,
      role,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.users.set(id, user);
    return user;
  }

  async update(id: string, data: Partial<{ nickname: string; passwordHash: string; role: Role }>): Promise<UserEntity | null> {
    const user = this.users.get(id);
    if (!user) return null;
    if (data.nickname !== undefined) user.nickname = data.nickname;
    if (data.passwordHash !== undefined) user.passwordHash = data.passwordHash;
    if (data.role !== undefined) user.role = data.role;
    user.updatedAt = new Date();
    return user;
  }
}

export class MemoryCardRepository implements ICardRepository {
  private cards: Map<string, CardEntity> = new Map();
  private versions: Map<string, any[]> = new Map();

  async findById(id: string): Promise<CardEntity | null> {
    return this.cards.get(id) ?? null;
  }

  async findByCardNumber(cardNumber: string): Promise<CardEntity | null> {
    for (const c of this.cards.values()) {
      if (c.cardNumber === cardNumber) return c;
    }
    return null;
  }

  async findMany(filters?: CardFilterOptions): Promise<{ cards: CardEntity[]; total: number }> {
    let result = Array.from(this.cards.values());
    if (filters?.isActive !== undefined) {
      result = result.filter((c) => c.isActive === filters.isActive);
    } else {
      result = result.filter((c) => c.isActive);
    }

    if (filters?.cardType) {
      result = result.filter((c) => c.cardType === filters.cardType);
    }
    if (filters?.attribute) {
      result = result.filter((c) => c.attribute === filters.attribute);
    }
    if (filters?.cost !== undefined) {
      result = result.filter((c) => c.cost === filters.cost);
    }
    if (filters?.query) {
      const q = filters.query.toLowerCase();
      result = result.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.cardNumber.toLowerCase().includes(q) ||
          c.rulesText.toLowerCase().includes(q)
      );
    }

    const total = result.length;
    const skip = filters?.skip ?? 0;
    const take = filters?.take ?? 200;
    return { cards: result.slice(skip, skip + take), total };
  }

  async create(input: CardCreateInput): Promise<CardEntity> {
    const id = `card-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const card: CardEntity = {
      ...input,
      id,
      isActive: true,
      currentVersion: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.cards.set(id, card);
    this.versions.set(id, [
      {
        id: `v-1-${id}`,
        cardId: id,
        versionNumber: 1,
        snapshotData: input,
        createdAt: new Date(),
      },
    ]);
    return card;
  }

  async update(
    id: string,
    input: Partial<CardCreateInput> & { isActive?: boolean },
    newVersionSnapshot?: Record<string, unknown>
  ): Promise<CardEntity> {
    const card = this.cards.get(id);
    if (!card) throw new Error('Card not found');

    const nextVersion = newVersionSnapshot ? card.currentVersion + 1 : card.currentVersion;
    const updated: CardEntity = {
      ...card,
      ...input,
      currentVersion: nextVersion,
      updatedAt: new Date(),
    };
    this.cards.set(id, updated);

    if (newVersionSnapshot) {
      const list = this.versions.get(id) ?? [];
      list.push({
        id: `v-${nextVersion}-${id}`,
        cardId: id,
        versionNumber: nextVersion,
        snapshotData: newVersionSnapshot,
        createdAt: new Date(),
      });
      this.versions.set(id, list);
    }

    return updated;
  }

  async getVersions(cardId: string): Promise<CardVersionEntity[]> {
    return this.versions.get(cardId) ?? [];
  }

  async batchImport(cards: CardCreateInput[]): Promise<{ importedCount: number; updatedCount: number }> {
    let imported = 0;
    let updated = 0;
    for (const item of cards) {
      const existing = await this.findByCardNumber(item.cardNumber);
      if (existing) {
        await this.update(existing.id, item, item as unknown as Record<string, unknown>);
        updated++;
      } else {
        await this.create(item);
        imported++;
      }
    }
    return { importedCount: imported, updatedCount: updated };
  }
}

export class MemoryDeckRepository implements IDeckRepository {
  private decks: Map<string, DeckEntity> = new Map();

  constructor(private cardRepo: ICardRepository) {}

  async findById(id: string): Promise<DeckEntity | null> {
    return this.decks.get(id) ?? null;
  }

  async findByUserId(userId: string): Promise<DeckEntity[]> {
    return Array.from(this.decks.values()).filter((d) => d.userId === userId);
  }

  async create(userId: string, name: string, description?: string, customId?: string): Promise<DeckEntity> {
    const id = customId || `deck-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const deck: DeckEntity = {
      id,
      userId,
      name,
      description,
      isValid: false,
      cards: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.decks.set(id, deck);
    return deck;
  }

  async update(id: string, name?: string, description?: string): Promise<DeckEntity> {
    const deck = this.decks.get(id);
    if (!deck) throw new Error('Deck not found');
    if (name) deck.name = name;
    if (description !== undefined) deck.description = description;
    deck.updatedAt = new Date();
    return deck;
  }

  async setCards(
    deckId: string,
    cards: { cardId: string; count: number; imageUrl?: string }[],
    isValid: boolean,
    log?: string
  ): Promise<DeckEntity> {
    const deck = this.decks.get(deckId);
    if (!deck) throw new Error('Deck not found');

    const populatedCards = [];
    for (const c of cards) {
      let cardEntity = await this.cardRepo.findById(c.cardId);
      if (!cardEntity && (this.cardRepo as any).findByCardNumber) {
        if ((c as any).cardNumber) {
          cardEntity = await (this.cardRepo as any).findByCardNumber((c as any).cardNumber);
        }
        if (!cardEntity && typeof c.cardId === 'string') {
          const match = c.cardId.match(/([A-Z]{2,}\d*-\d+)/i);
          if (match && match[1]) {
            cardEntity = await (this.cardRepo as any).findByCardNumber(match[1].toUpperCase());
          }
        }
      }
      if (cardEntity) {
        populatedCards.push({
          cardId: cardEntity.id,
          count: c.count,
          imageUrl: c.imageUrl || cardEntity.imageUrl || undefined,
          card: cardEntity,
        });
      }
    }

    deck.cards = populatedCards;
    deck.isValid = isValid;
    deck.validationLog = log;
    deck.updatedAt = new Date();
    return deck;
  }

  async delete(id: string): Promise<boolean> {
    return this.decks.delete(id);
  }
}

export class MemoryRoomRepository implements IRoomRepository {
  private rooms: Map<string, RoomEntity> = new Map();

  async findById(id: string): Promise<RoomEntity | null> {
    return this.rooms.get(id) ?? null;
  }

  async findByCode(code: string): Promise<RoomEntity | null> {
    for (const r of this.rooms.values()) {
      if (r.roomCode === code) return r;
    }
    return null;
  }

  async listWaitingRooms(): Promise<RoomEntity[]> {
    return Array.from(this.rooms.values()).filter(
      (r) => r.status === RoomStatus.WAITING || r.status === RoomStatus.READY
    );
  }

  async create(
    creatorId: string,
    title: string,
    roomCode: string,
    passwordHash?: string,
    customId?: string
  ): Promise<RoomEntity> {
    const id = customId || `room-${Date.now()}`;
    const room: RoomEntity = {
      id,
      roomCode,
      title,
      passwordHash,
      creatorId,
      status: RoomStatus.WAITING,
      players: [
        {
          id: `rp-${Date.now()}-1`,
          roomId: id,
          userId: creatorId,
          username: `user_${creatorId}`,
          nickname: `指挥官_${creatorId}`,
          seatIndex: 0,
          isReady: false,
          joinedAt: new Date(),
        },
      ],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.rooms.set(id, room);
    return room;
  }

  async addPlayer(roomId: string, userId: string, seatIndex: number): Promise<RoomEntity> {
    let room = this.rooms.get(roomId);
    if (!room) {
      room = {
        id: roomId,
        roomCode: roomId,
        title: '作战房间',
        creatorId: userId,
        status: RoomStatus.WAITING,
        players: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      this.rooms.set(roomId, room);
    }

    if (!room.players.some((p) => p.userId === userId)) {
      room.players.push({
        id: `rp-${Date.now()}-${room.players.length + 1}`,
        roomId,
        userId,
        username: `user_${userId}`,
        nickname: `指挥官_${userId}`,
        seatIndex,
        isReady: false,
        joinedAt: new Date(),
      });
    }
    room.updatedAt = new Date();
    return room;
  }

  async removePlayer(roomId: string, userId: string): Promise<RoomEntity> {
    let room = this.rooms.get(roomId);
    if (!room) {
      return {
        id: roomId,
        roomCode: roomId,
        title: '作战房间',
        creatorId: userId,
        status: RoomStatus.WAITING,
        players: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    }

    room.players = room.players.filter((p) => p.userId !== userId);
    room.updatedAt = new Date();
    return room;
  }

  async setPlayerReady(roomId: string, userId: string, isReady: boolean): Promise<RoomEntity> {
    let room = this.rooms.get(roomId);
    if (!room) {
      room = {
        id: roomId,
        roomCode: roomId,
        title: '作战房间',
        creatorId: userId,
        status: RoomStatus.WAITING,
        players: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      this.rooms.set(roomId, room);
    }

    const p = room.players.find((item) => item.userId === userId);
    if (p) p.isReady = isReady;

    const allReady = room.players.length === 2 && room.players.every((item) => item.isReady);
    room.status = allReady ? RoomStatus.READY : RoomStatus.WAITING;
    room.updatedAt = new Date();
    return room;
  }

  async updateStatus(roomId: string, status: RoomStatus): Promise<RoomEntity> {
    let room = this.rooms.get(roomId);
    if (!room) {
      room = {
        id: roomId,
        roomCode: roomId,
        title: '作战房间',
        creatorId: 'system',
        status,
        players: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      this.rooms.set(roomId, room);
    }
    room.status = status;
    room.updatedAt = new Date();
    return room;
  }
}

export class MemoryGameRepository implements IGameRepository {
  private games: Map<string, GameEntity> = new Map();
  private players: Map<string, { userId: string; deckId: string; seatOrder: number }[]> = new Map();
  private actions: Map<string, any[]> = new Map();
  private events: Map<string, any[]> = new Map();

  async createGame(
    roomId: string,
    rngSeed: bigint,
    playersList: { userId: string; deckId: string; seatOrder: number }[],
    customId?: string
  ): Promise<GameEntity> {
    const id = customId || `game-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const game: GameEntity = {
      id,
      roomId,
      rngSeed,
      isDraw: false,
      startedAt: new Date(),
    };
    this.games.set(id, game);
    this.players.set(id, playersList);
    this.actions.set(id, []);
    this.events.set(id, []);
    return game;
  }

  async recordAction(
    gameId: string,
    seq: number,
    playerId: string,
    actionType: string,
    payload: unknown
  ): Promise<void> {
    const list = this.actions.get(gameId) ?? [];
    list.push({ seq, playerId, actionType, payload, timestamp: new Date() });
    this.actions.set(gameId, list);
  }

  async recordEvent(gameId: string, seq: number, eventType: string, payload: unknown): Promise<void> {
    const list = this.events.get(gameId) ?? [];
    list.push({ seq, eventType, payload, timestamp: new Date() });
    this.events.set(gameId, list);
  }

  async finishGame(gameId: string, winnerUserId?: string, isDraw: boolean = false, reason?: string): Promise<GameEntity> {
    const game = this.games.get(gameId);
    if (!game) throw new Error('Game not found');

    game.winnerUserId = winnerUserId;
    game.isDraw = isDraw;
    game.finishReason = reason;
    game.finishedAt = new Date();
    return game;
  }

  async getGameById(gameId: string): Promise<GameEntity | null> {
    return this.games.get(gameId) ?? null;
  }

  async listGames(limit: number = 50): Promise<GameEntity[]> {
    return Array.from(this.games.values())
      .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
      .slice(0, limit);
  }

  async getReplayData(gameId: string) {
    const game = this.games.get(gameId);
    if (!game) return null;

    return {
      game,
      players: this.players.get(gameId) ?? [],
      actions: this.actions.get(gameId) ?? [],
      events: this.events.get(gameId) ?? [],
    };
  }
}

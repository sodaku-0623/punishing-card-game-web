import { PrismaClient, Role, RoomStatus } from '@prisma/client';
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

export class PrismaUserRepository implements IUserRepository {
  constructor(private prisma: PrismaClient) {}

  async findById(id: string): Promise<UserEntity | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  async findByUsername(username: string): Promise<UserEntity | null> {
    return this.prisma.user.findUnique({ where: { username } });
  }

  async create(username: string, passwordHash: string, nickname: string, role: Role = Role.USER): Promise<UserEntity> {
    return this.prisma.user.create({
      data: { username, passwordHash, nickname, role },
    });
  }

  async update(id: string, data: Partial<{ nickname: string; passwordHash: string; role: Role }>): Promise<UserEntity | null> {
    return this.prisma.user.update({
      where: { id },
      data,
    });
  }
}

export class PrismaCardRepository implements ICardRepository {
  constructor(private prisma: PrismaClient) {}

  async findById(id: string): Promise<CardEntity | null> {
    return this.prisma.card.findUnique({ where: { id } });
  }

  async findByCardNumber(cardNumber: string): Promise<CardEntity | null> {
    return this.prisma.card.findUnique({ where: { cardNumber } });
  }

  async findMany(filters?: CardFilterOptions): Promise<{ cards: CardEntity[]; total: number }> {
    const where: Record<string, unknown> = {};
    if (filters?.isActive !== undefined) {
      where['isActive'] = filters.isActive;
    } else {
      where['isActive'] = true;
    }
    if (filters?.cardType) where['cardType'] = filters.cardType;
    if (filters?.attribute) where['attribute'] = filters.attribute;
    if (filters?.cost !== undefined) where['cost'] = filters.cost;
    if (filters?.query) {
      where['OR'] = [
        { name: { contains: filters.query, mode: 'insensitive' } },
        { cardNumber: { contains: filters.query, mode: 'insensitive' } },
        { rulesText: { contains: filters.query, mode: 'insensitive' } },
      ];
    }

    const [cards, total] = await Promise.all([
      this.prisma.card.findMany({
        where,
        skip: filters?.skip ?? 0,
        take: filters?.take ?? 200,
        orderBy: { cardNumber: 'asc' },
      }),
      this.prisma.card.count({ where }),
    ]);

    return { cards, total };
  }

  async create(input: CardCreateInput): Promise<CardEntity> {
    return this.prisma.$transaction(async (tx) => {
      const card = await tx.card.create({
        data: {
          ...input,
          currentVersion: 1,
        },
      });

      await tx.cardVersion.create({
        data: {
          cardId: card.id,
          versionNumber: 1,
          snapshotData: input as unknown as object,
        },
      });

      return card;
    });
  }

  async update(id: string, input: Partial<CardCreateInput> & { isActive?: boolean }, newVersionSnapshot?: Record<string, unknown>): Promise<CardEntity> {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.card.findUniqueOrThrow({ where: { id } });
      const nextVersion = newVersionSnapshot ? current.currentVersion + 1 : current.currentVersion;

      const updated = await tx.card.update({
        where: { id },
        data: {
          ...input,
          currentVersion: nextVersion,
        },
      });

      if (newVersionSnapshot) {
        await tx.cardVersion.create({
          data: {
            cardId: id,
            versionNumber: nextVersion,
            snapshotData: newVersionSnapshot as unknown as object,
          },
        });
      }

      return updated;
    });
  }

  async getVersions(cardId: string): Promise<CardVersionEntity[]> {
    const list = await this.prisma.cardVersion.findMany({
      where: { cardId },
      orderBy: { versionNumber: 'desc' },
    });
    return list.map((v) => ({
      id: v.id,
      cardId: v.cardId,
      versionNumber: v.versionNumber,
      snapshotData: v.snapshotData as Record<string, unknown>,
      createdAt: v.createdAt,
    }));
  }

  async batchImport(cards: CardCreateInput[]): Promise<{ importedCount: number; updatedCount: number }> {
    let imported = 0;
    let updated = 0;

    for (const cardInput of cards) {
      const existing = await this.prisma.card.findUnique({
        where: { cardNumber: cardInput.cardNumber },
      });

      if (existing) {
        await this.update(existing.id, cardInput, cardInput as unknown as Record<string, unknown>);
        updated++;
      } else {
        await this.create(cardInput);
        imported++;
      }
    }

    return { importedCount: imported, updatedCount: updated };
  }
}

export class PrismaDeckRepository implements IDeckRepository {
  constructor(private prisma: PrismaClient) {}

  async findById(id: string): Promise<DeckEntity | null> {
    return this.prisma.deck.findUnique({
      where: { id },
      include: {
        cards: {
          include: { card: true },
        },
      },
    }) as unknown as Promise<DeckEntity | null>;
  }

  async findByUserId(userId: string): Promise<DeckEntity[]> {
    return this.prisma.deck.findMany({
      where: { userId },
      include: {
        cards: {
          include: { card: true },
        },
      },
      orderBy: { updatedAt: 'desc' },
    }) as unknown as Promise<DeckEntity[]>;
  }

  async create(userId: string, name: string, description?: string, customId?: string): Promise<DeckEntity> {
    return this.prisma.deck.create({
      data: { id: customId || undefined, userId, name, description },
      include: { cards: { include: { card: true } } },
    }) as unknown as Promise<DeckEntity>;
  }

  async update(id: string, name?: string, description?: string): Promise<DeckEntity> {
    return this.prisma.deck.update({
      where: { id },
      data: { name, description },
      include: { cards: { include: { card: true } } },
    }) as unknown as Promise<DeckEntity>;
  }

  async setCards(
    deckId: string,
    cards: { cardId: string; count: number }[],
    isValid: boolean,
    log?: string
  ): Promise<DeckEntity> {
    return this.prisma.$transaction(async (tx) => {
      // 清理旧卡牌
      await tx.deckCard.deleteMany({ where: { deckId } });

      // 批量创建新卡牌关联
      for (const item of cards) {
        await tx.deckCard.create({
          data: {
            deckId,
            cardId: item.cardId,
            count: item.count,
          },
        });
      }

      return tx.deck.update({
        where: { id: deckId },
        data: { isValid, validationLog: log },
        include: { cards: { include: { card: true } } },
      });
    }) as unknown as Promise<DeckEntity>;
  }

  async delete(id: string): Promise<boolean> {
    await this.prisma.deck.delete({ where: { id } });
    return true;
  }
}

export class PrismaRoomRepository implements IRoomRepository {
  constructor(private prisma: PrismaClient) {}

  async findById(id: string): Promise<RoomEntity | null> {
    const room = await this.prisma.room.findUnique({
      where: { id },
      include: {
        players: {
          include: { user: true },
        },
      },
    });
    if (!room) return null;
    return this.formatRoom(room);
  }

  async findByCode(code: string): Promise<RoomEntity | null> {
    const room = await this.prisma.room.findUnique({
      where: { roomCode: code },
      include: {
        players: {
          include: { user: true },
        },
      },
    });
    if (!room) return null;
    return this.formatRoom(room);
  }

  async listWaitingRooms(): Promise<RoomEntity[]> {
    const rooms = await this.prisma.room.findMany({
      where: { status: { in: [RoomStatus.WAITING, RoomStatus.READY] } },
      include: {
        players: {
          include: { user: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return rooms.map((r) => this.formatRoom(r));
  }

  async create(creatorId: string, title: string, roomCode: string, passwordHash?: string): Promise<RoomEntity> {
    const room = await this.prisma.room.create({
      data: {
        creatorId,
        title,
        roomCode,
        passwordHash,
        status: RoomStatus.WAITING,
        players: {
          create: {
            userId: creatorId,
            seatIndex: 0,
            isReady: false,
          },
        },
      },
      include: {
        players: {
          include: { user: true },
        },
      },
    });
    return this.formatRoom(room);
  }

  async addPlayer(roomId: string, userId: string, seatIndex: number): Promise<RoomEntity> {
    await this.prisma.roomPlayer.create({
      data: { roomId, userId, seatIndex },
    });
    return (await this.findById(roomId))!;
  }

  async removePlayer(roomId: string, userId: string): Promise<RoomEntity> {
    await this.prisma.roomPlayer.deleteMany({
      where: { roomId, userId },
    });
    return (await this.findById(roomId))!;
  }

  async setPlayerReady(roomId: string, userId: string, isReady: boolean): Promise<RoomEntity> {
    await this.prisma.roomPlayer.updateMany({
      where: { roomId, userId },
      data: { isReady },
    });
    return (await this.findById(roomId))!;
  }

  async updateStatus(roomId: string, status: RoomStatus): Promise<RoomEntity> {
    const room = await this.prisma.room.update({
      where: { id: roomId },
      data: { status },
      include: {
        players: {
          include: { user: true },
        },
      },
    });
    return this.formatRoom(room);
  }

  private formatRoom(room: any): RoomEntity {
    return {
      id: room.id,
      roomCode: room.roomCode,
      title: room.title,
      passwordHash: room.passwordHash,
      creatorId: room.creatorId,
      status: room.status,
      createdAt: room.createdAt,
      updatedAt: room.updatedAt,
      players: (room.players || []).map((p: any) => ({
        id: p.id,
        roomId: p.roomId,
        userId: p.userId,
        username: p.user?.username ?? '',
        nickname: p.user?.nickname ?? '',
        avatarUrl: p.user?.avatarUrl,
        seatIndex: p.seatIndex,
        isReady: p.isReady,
        joinedAt: p.joinedAt,
      })),
    };
  }
}

export class PrismaGameRepository implements IGameRepository {
  constructor(private prisma: PrismaClient) {}

  async createGame(
    roomId: string,
    rngSeed: bigint,
    players: { userId: string; deckId: string; seatOrder: number }[],
    customId?: string
  ): Promise<GameEntity> {
    return this.prisma.game.create({
      data: {
        ...(customId ? { id: customId } : {}),
        roomId,
        rngSeed,
        players: {
          createMany: {
            data: players,
          },
        },
      },
    });
  }

  async recordAction(
    gameId: string,
    seq: number,
    playerId: string,
    actionType: string,
    payload: unknown
  ): Promise<void> {
    await this.prisma.gameActionRecord.create({
      data: {
        gameId,
        seq,
        playerId,
        actionType,
        payload: payload as object,
      },
    });
  }

  async recordEvent(gameId: string, seq: number, eventType: string, payload: unknown): Promise<void> {
    await this.prisma.gameEventRecord.create({
      data: {
        gameId,
        seq,
        eventType,
        payload: payload as object,
      },
    });
  }

  async finishGame(gameId: string, winnerUserId?: string, isDraw: boolean = false, reason?: string): Promise<GameEntity> {
    return this.prisma.game.update({
      where: { id: gameId },
      data: {
        winnerUserId,
        isDraw,
        finishReason: reason,
        finishedAt: new Date(),
      },
    });
  }

  async getGameById(gameId: string): Promise<GameEntity | null> {
    return this.prisma.game.findUnique({ where: { id: gameId } });
  }

  async listGames(limit: number = 50): Promise<GameEntity[]> {
    return this.prisma.game.findMany({
      take: limit,
      orderBy: { startedAt: 'desc' },
    });
  }

  async getReplayData(gameId: string) {
    const game = await this.prisma.game.findUnique({
      where: { id: gameId },
      include: {
        players: true,
      },
    });
    if (!game) return null;

    const [actions, events] = await Promise.all([
      this.prisma.gameActionRecord.findMany({
        where: { gameId },
        orderBy: { seq: 'asc' },
      }),
      this.prisma.gameEventRecord.findMany({
        where: { gameId },
        orderBy: { seq: 'asc' },
      }),
    ]);

    return { game, players: game.players, actions, events };
  }
}

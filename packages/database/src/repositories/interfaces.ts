import {
  CardTypeEnum,
  ElementAttributeEnum,
  SignalOrbTypeEnum,
  RoomStatus,
  Role,
} from '@prisma/client';

export interface CardFilterOptions {
  cardType?: CardTypeEnum;
  attribute?: ElementAttributeEnum;
  cost?: number;
  query?: string;
  skip?: number;
  take?: number;
  isActive?: boolean;
}

export interface CardCreateInput {
  cardNumber: string;
  name: string;
  cardType: CardTypeEnum;
  attribute: ElementAttributeEnum;
  cost: number;
  basePP?: number | null;
  baseDP?: number | null;
  signalOrb?: SignalOrbTypeEnum | null;
  traits: string[];
  isInstant?: boolean;
  imageUrl?: string | null;
  rulesText: string;
  flavorText?: string | null;
}

export interface CardEntity extends CardCreateInput {
  id: string;
  isActive: boolean;
  currentVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CardVersionEntity {
  id: string;
  cardId: string;
  versionNumber: number;
  snapshotData: Record<string, unknown>;
  createdAt: Date;
}

export interface ICardRepository {
  findById(id: string): Promise<CardEntity | null>;
  findByCardNumber(cardNumber: string): Promise<CardEntity | null>;
  findMany(filters?: CardFilterOptions): Promise<{ cards: CardEntity[]; total: number }>;
  create(input: CardCreateInput): Promise<CardEntity>;
  update(id: string, input: Partial<CardCreateInput> & { isActive?: boolean }, newVersionSnapshot?: Record<string, unknown>): Promise<CardEntity>;
  batchImport(cards: CardCreateInput[]): Promise<{ importedCount: number; updatedCount: number }>;
  getVersions(cardId: string): Promise<CardVersionEntity[]>;
}

export interface DeckCardEntity {
  cardId: string;
  count: number;
  imageUrl?: string;
  card: CardEntity;
}

export interface DeckEntity {
  id: string;
  userId: string;
  name: string;
  description?: string | null;
  isValid: boolean;
  validationLog?: string | null;
  cards: DeckCardEntity[];
  createdAt: Date;
  updatedAt: Date;
}

export interface IDeckRepository {
  findById(id: string): Promise<DeckEntity | null>;
  findByUserId(userId: string): Promise<DeckEntity[]>;
  create(userId: string, name: string, description?: string, customId?: string): Promise<DeckEntity>;
  update(id: string, name?: string, description?: string): Promise<DeckEntity>;
  setCards(deckId: string, cards: { cardId: string; count: number; imageUrl?: string }[], isValid: boolean, log?: string): Promise<DeckEntity>;
  delete(id: string): Promise<boolean>;
}

export interface RoomPlayerEntity {
  id: string;
  roomId: string;
  userId: string;
  username: string;
  nickname: string;
  avatarUrl?: string | null;
  seatIndex: number;
  isReady: boolean;
  joinedAt: Date;
}

export interface RoomEntity {
  id: string;
  roomCode: string;
  title: string;
  passwordHash?: string | null;
  creatorId: string;
  status: RoomStatus;
  players: RoomPlayerEntity[];
  createdAt: Date;
  updatedAt: Date;
}

export interface IRoomRepository {
  findById(id: string): Promise<RoomEntity | null>;
  findByCode(code: string): Promise<RoomEntity | null>;
  listWaitingRooms(): Promise<RoomEntity[]>;
  create(creatorId: string, title: string, roomCode: string, passwordHash?: string, customId?: string): Promise<RoomEntity>;
  addPlayer(roomId: string, userId: string, seatIndex: number): Promise<RoomEntity>;
  removePlayer(roomId: string, userId: string): Promise<RoomEntity>;
  setPlayerReady(roomId: string, userId: string, isReady: boolean): Promise<RoomEntity>;
  updateStatus(roomId: string, status: RoomStatus): Promise<RoomEntity>;
}

export interface GameEntity {
  id: string;
  roomId: string;
  rngSeed: bigint;
  winnerUserId?: string | null;
  isDraw: boolean;
  finishReason?: string | null;
  startedAt: Date;
  finishedAt?: Date | null;
}

export interface IGameRepository {
  createGame(roomId: string, rngSeed: bigint, players: { userId: string; deckId: string; seatOrder: number }[], customId?: string): Promise<GameEntity>;
  recordAction(gameId: string, seq: number, playerId: string, actionType: string, payload: unknown): Promise<void>;
  recordEvent(gameId: string, seq: number, eventType: string, payload: unknown): Promise<void>;
  finishGame(gameId: string, winnerUserId?: string, isDraw?: boolean, reason?: string): Promise<GameEntity>;
  getGameById(gameId: string): Promise<GameEntity | null>;
  listGames(limit?: number): Promise<GameEntity[]>;
  getReplayData(gameId: string): Promise<{
    game: GameEntity;
    players?: { userId: string; deckId: string; seatOrder: number }[];
    actions: { seq: number; playerId: string; actionType: string; payload: unknown; timestamp: Date }[];
    events: { seq: number; eventType: string; payload: unknown; timestamp: Date }[];
  } | null>;
}

export interface UserEntity {
  id: string;
  username: string;
  passwordHash: string;
  nickname: string;
  avatarUrl?: string | null;
  role: Role;
  createdAt: Date;
  updatedAt: Date;
}

export interface IUserRepository {
  findById(id: string): Promise<UserEntity | null>;
  findByUsername(username: string): Promise<UserEntity | null>;
  create(username: string, passwordHash: string, nickname: string, role?: Role): Promise<UserEntity>;
  update(id: string, data: Partial<{ nickname: string; passwordHash: string; role: Role }>): Promise<UserEntity | null>;
}

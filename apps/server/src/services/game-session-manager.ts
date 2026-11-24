import {
  GameAction,
  GameEvent,
  PublicGameState,
  ErrorCode,
} from '@zhanshuang/shared';
import {
  GameEngine,
  PlayerInitConfig,
  MemoryCardDatabase,
  parseAscensionConfig,
  parseAssistConfig,
} from '@zhanshuang/game-engine';
import { IGameRepository, IDeckRepository, ICardRepository, DeckEntity } from '@zhanshuang/database';
import { OFFICIAL_STARTER_DECKS, findOfficialStarterDeck } from '@zhanshuang/game-rules';
import { MetricsService } from './metrics-service.js';

export interface GameSession {
  gameId: string;
  roomId: string;
  engine: GameEngine;
  playerIds: [string, string];
  actionSequence: number;
  eventSequence: number;
  stateVersion: number;
}

export class GameSessionManager {
  private sessions: Map<string, GameSession> = new Map();
  private userToGameMap: Map<string, string> = new Map();
  private cardDb = new MemoryCardDatabase();

  constructor(
    private gameRepo: IGameRepository,
    private deckRepo: IDeckRepository,
    private cardRepo?: ICardRepository
  ) {
    this.initCardDb();
  }

  private async initCardDb() {
    if (this.cardRepo) {
      try {
        const { cards } = await this.cardRepo.findMany({ take: 1000 });
        for (const card of cards) {
          this.registerCardEntity(card);
        }
      } catch (err) {
        // Fallback to built-in official cards
      }
    }
  }

  private registerCardEntity(card: any) {
    if (!card || !card.cardNumber) return;
    this.cardDb.registerCard({
      id: card.id || `c-${card.cardNumber.toLowerCase()}`,
      cardNumber: card.cardNumber,
      name: card.name,
      cardType: card.cardType,
      attribute: card.attribute,
      cost: card.cost,
      basePP: card.basePP ?? undefined,
      baseDP: card.baseDP ?? undefined,
      signalOrb: card.signalOrb ?? undefined,
      traits: card.traits || [],
      isInstant: !!card.isInstant,
      ascensionConfig: card.ascensionConfig ?? parseAscensionConfig(card.rulesText || ''),
      assistConfig: card.assistConfig ?? parseAssistConfig(card.rulesText || ''),
      imageUrl: card.imageUrl ?? undefined,
      abilities: [],
      rulesText: card.rulesText || '',
      flavorText: card.flavorText ?? undefined,
    });
  }

  private async resolveSessionDeck(deckId: string): Promise<DeckEntity | null> {
    const starter = findOfficialStarterDeck(deckId);
    if (starter) {
      const starterDeck = await this.deckRepo.findById(starter.id);
      if (starterDeck) return starterDeck;
    }
    if (deckId) {
      const existing = await this.deckRepo.findById(deckId);
      if (existing) return existing;
    }
    const defaultStarter = OFFICIAL_STARTER_DECKS[0];
    if (defaultStarter) {
      const fallback = await this.deckRepo.findById(defaultStarter.id);
      if (fallback) return fallback;
    }
    const sysDecks = await this.deckRepo.findByUserId('system');
    return sysDecks[0] ?? null;
  }

  /**
   * 启动对局会话并保存至数据库 (5.2 开局)
   */
  async startGameSession(
    roomId: string,
    player1Id: string,
    player1DeckId: string,
    player2Id: string,
    player2DeckId: string,
    seed: number = Date.now(),
    options?: { skipMulligan?: boolean }
  ): Promise<GameSession> {
    const gameId = `game-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;

    // 读取双方卡组并展开 50 张卡号序列 (预组别名统一经 findOfficialStarterDeck 解析)
    const [d1, d2] = await Promise.all([
      this.resolveSessionDeck(player1DeckId),
      this.resolveSessionDeck(player2DeckId),
    ]);

    if (!d1 || !d2) {
      throw new Error('找不到玩家卡组');
    }

    // 确保对局涉及的所有双方卡牌均注册至规则引擎的卡牌数据库中
    for (const c of [...d1.cards, ...d2.cards]) {
      if (c.card) {
        this.registerCardEntity(c.card);
      }
    }

    const p1CardNumbers: string[] = [];
    const p1CardImageUrls: string[] = [];
    for (const c of d1.cards) {
      const cardNum = c.card?.cardNumber || c.cardId;
      const img = c.imageUrl || c.card?.imageUrl || `/cards/${cardNum}.png`;
      for (let i = 0; i < c.count; i++) {
        p1CardNumbers.push(cardNum);
        p1CardImageUrls.push(img);
      }
    }

    const p2CardNumbers: string[] = [];
    const p2CardImageUrls: string[] = [];
    for (const c of d2.cards) {
      const cardNum = c.card?.cardNumber || c.cardId;
      const img = c.imageUrl || c.card?.imageUrl || `/cards/${cardNum}.png`;
      for (let i = 0; i < c.count; i++) {
        p2CardNumbers.push(cardNum);
        p2CardImageUrls.push(img);
      }
    }

    const p1Config: PlayerInitConfig = {
      playerId: player1Id,
      deckCardNumbers: p1CardNumbers,
      deckCardImageUrls: p1CardImageUrls,
    };
    const p2Config: PlayerInitConfig = {
      playerId: player2Id,
      deckCardNumbers: p2CardNumbers,
      deckCardImageUrls: p2CardImageUrls,
    };

    const engine = new GameEngine(gameId, p1Config, p2Config, seed, this.cardDb, {
      skipMulligan: options?.skipMulligan ?? false,
    });

    const session: GameSession = {
      gameId,
      roomId,
      engine,
      playerIds: [player1Id, player2Id],
      actionSequence: 0,
      eventSequence: 0,
      stateVersion: 1,
    };

    // 若任一玩家存在上局残留的会话映射，先行清理旧会话
    const oldGame1 = this.userToGameMap.get(player1Id);
    if (oldGame1) {
      this.closeSession(oldGame1);
    }
    const oldGame2 = this.userToGameMap.get(player2Id);
    if (oldGame2) {
      this.closeSession(oldGame2);
    }

    this.sessions.set(gameId, session);
    this.userToGameMap.set(player1Id, gameId);
    this.userToGameMap.set(player2Id, gameId);

    // 持久化创建对局记录
    await this.gameRepo.createGame(
      roomId,
      BigInt(seed),
      [
        { userId: player1Id, deckId: player1DeckId, seatOrder: 0 },
        { userId: player2Id, deckId: player2DeckId, seatOrder: 1 },
      ],
      gameId
    );

    // 记录初始化的游戏事件
    for (const evt of engine.getEvents()) {
      session.eventSequence++;
      await this.gameRepo.recordEvent(gameId, session.eventSequence, evt.type, evt);
    }

    return session;
  }

  getSession(gameId: string): GameSession | undefined {
    return this.sessions.get(gameId);
  }

  getGameIdByUserId(userId: string): string | undefined {
    return this.userToGameMap.get(userId);
  }

  /**
   * 权威处理玩家提交的行动 (4. 权威服务器)
   */
  async processAction(
    gameId: string,
    action: GameAction
  ): Promise<{
    success: boolean;
    error?: { code: ErrorCode; message: string };
    events: GameEvent[];
  }> {
    const session = this.sessions.get(gameId);
    if (!session) {
      return {
        success: false,
        error: { code: ErrorCode.GAME_NOT_FOUND, message: '未找到对局会话' },
        events: [],
      };
    }

    // 引擎执行权威校验与结算
    const engineStart = Date.now();
    const result = session.engine.dispatchAction(action);
    const engineDuration = Date.now() - engineStart;
    MetricsService.getInstance().recordEngineResolution(engineDuration);

    if (!result.success) {
      return {
        success: false,
        error: {
          code: ErrorCode.ACTION_NOT_ALLOWED,
          message: result.error ?? '行动被规则引擎拒绝',
        },
        events: [],
      };
    }

    // 仅在引擎成功结算后，才递增序号、状态版本号并持久化回放记录
    session.actionSequence++;
    const currentSeq = session.actionSequence;
    this.gameRepo.recordAction(gameId, currentSeq, action.playerId, action.type, action).catch(() => {});
    session.stateVersion = (session.stateVersion || 0) + 1;

    // 持久化产出的事件
    for (const evt of result.events) {
      session.eventSequence++;
      this.gameRepo.recordEvent(gameId, session.eventSequence, evt.type, evt).catch(() => {});
    }

    // 若对局已结束，归档对局结果
    const state = session.engine.getState();
    if (state.status === 'FINISHED') {
      await this.gameRepo.finishGame(gameId, state.winnerId, state.isDraw, state.finishReason);
      this.userToGameMap.delete(session.playerIds[0]);
      this.userToGameMap.delete(session.playerIds[1]);
    }

    return {
      success: true,
      events: result.events,
    };
  }

  /**
   * 获取针对特定玩家脱敏后的公开状态 (12. 隐藏信息)
   */
  getPublicGameState(gameId: string, forPlayerId: string): PublicGameState | null {
    const session = this.sessions.get(gameId);
    if (!session) return null;
    const pub = session.engine.getPublicState(forPlayerId);
    if (!pub) return null;
    return {
      ...pub,
      roomId: session.roomId,
      stateVersion: session.stateVersion || 1,
    };
  }

  /**
   * 获取针对特定玩家脱敏后的增量游戏事件 (12. 隐藏信息)
   */
  getSanitizedGameEvents(gameId: string, events: GameEvent[], forPlayerId: string): GameEvent[] {
    const session = this.sessions.get(gameId);
    if (!session || events.length === 0) return [];
    return session.engine.getSanitizedEvents(events, forPlayerId);
  }

  getSessionByRoomId(roomId: string): GameSession | undefined {
    for (const session of this.sessions.values()) {
      if (session.roomId === roomId) return session;
    }
    return undefined;
  }

  closeSession(gameId: string): void {
    const session = this.sessions.get(gameId);
    if (session) {
      this.userToGameMap.delete(session.playerIds[0]);
      this.userToGameMap.delete(session.playerIds[1]);
      this.sessions.delete(gameId);
    }
  }

  getActiveSessionCount(): number {
    return this.sessions.size;
  }
}

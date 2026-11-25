import { describe, it, expect } from 'vitest';
import {
  MemoryUserRepository,
  MemoryCardRepository,
  MemoryDeckRepository,
  MemoryRoomRepository,
  MemoryGameRepository,
} from '../src/repositories/memory-repos.js';
import { OFFICIAL_SEED_CARDS } from '../src/seed/official-cards.js';
import { CardTypeEnum, ElementAttributeEnum, Role, RoomStatus } from '@prisma/client';

describe('Database Repositories & Data Persistence (Phase 4 数据持久化测试)', () => {
  it('1. 卡牌批量导入、多维筛选与版本演进 (Card & CardVersion)', async () => {
    const cardRepo = new MemoryCardRepository();

    // 批量导入规则书全量官方卡牌
    const importRes = await cardRepo.batchImport(OFFICIAL_SEED_CARDS);
    expect(importRes.importedCount).toBe(OFFICIAL_SEED_CARDS.length);

    // 关键词全文检索
    const searchRes = await cardRepo.findMany({ query: '露西亚' });
    expect(searchRes.cards.length).toBeGreaterThanOrEqual(2);
    expect(searchRes.cards.some((c) => c.name === '露西亚·红莲')).toBe(true);
    expect(searchRes.cards.some((c) => c.name === '露西亚·鸦羽')).toBe(true);

    // 类型与属性组合筛选
    const fireRoles = await cardRepo.findMany({
      cardType: CardTypeEnum.ROLE,
      attribute: ElementAttributeEnum.FIRE,
    });
    expect(fireRoles.cards.every((c) => c.attribute === ElementAttributeEnum.FIRE)).toBe(true);
    expect(fireRoles.cards.every((c) => c.cardType === CardTypeEnum.ROLE)).toBe(true);

    // 卡牌版本演进与快照测试 (CardVersion 增量)
    const lucia = await cardRepo.findByCardNumber('BP01-001');
    expect(lucia).not.toBeNull();
    expect(lucia!.currentVersion).toBe(1);

    // 更新卡牌能力描述并保存新版本快照
    const updated = await cardRepo.update(
      lucia!.id,
      { rulesText: '【平衡性调整】出场时我方费用区有2张以上明费即可触发。' },
      { changeLog: '降低触发门槛至2明费' }
    );
    expect(updated.currentVersion).toBe(2);
    expect(updated.rulesText).toContain('平衡性调整');
  });

  it('2. 玩家卡组管理与合规性标记 (Deck & DeckCard)', async () => {
    const cardRepo = new MemoryCardRepository();
    await cardRepo.batchImport(OFFICIAL_SEED_CARDS);
    const deckRepo = new MemoryDeckRepository(cardRepo);

    // 创建新卡组
    const deck = await deckRepo.create('user-1001', '灰鸦战术编队', '以露西亚与丽芙为核心');
    expect(deck.name).toBe('灰鸦战术编队');
    expect(deck.isValid).toBe(false);

    // 注入卡组卡牌数据
    const luciaCard = (await cardRepo.findByCardNumber('BP01-001'))!;
    const redOrb = (await cardRepo.findByCardNumber('ST01-012'))!;

    const updatedDeck = await deckRepo.setCards(
      deck.id,
      [
        { cardId: luciaCard.id, count: 4 },
        { cardId: redOrb.id, count: 4 },
      ],
      true,
      '卡组校验通过'
    );

    expect(updatedDeck.isValid).toBe(true);
    expect(updatedDeck.cards).toHaveLength(2);
    expect(updatedDeck.cards[0]!.card.name).toBe('露西亚·鸦羽');
  });

  it('3. 房间匹配、入座与准备状态流转 (Room & RoomPlayer)', async () => {
    const roomRepo = new MemoryRoomRepository();

    // 玩家1创建房间
    const room = await roomRepo.create('user-1', '高手速来', 'ROOM-888');
    expect(room.status).toBe(RoomStatus.WAITING);
    expect(room.players).toHaveLength(1);
    expect(room.players[0]!.userId).toBe('user-1');

    // 玩家2加入房间，分配至卡座1
    const joinedRoom = await roomRepo.addPlayer(room.id, 'user-2', 1);
    expect(joinedRoom.players).toHaveLength(2);
    expect(joinedRoom.status).toBe(RoomStatus.WAITING);

    // 双方准备就绪后，房间状态自动变更为 READY
    await roomRepo.setPlayerReady(room.id, 'user-1', true);
    const readyRoom = await roomRepo.setPlayerReady(room.id, 'user-2', true);
    expect(readyRoom.status).toBe(RoomStatus.READY);
  });

  it('4. 对局记录、Action/Event 流水日志与 Replay 抓取 (Game, Action & Event)', async () => {
    const gameRepo = new MemoryGameRepository();

    // 创建对局会话
    const game = await gameRepo.createGame('room-123', BigInt(987654321), [
      { userId: 'alice', deckId: 'd-alice', seatOrder: 0 },
      { userId: 'bob', deckId: 'd-bob', seatOrder: 1 },
    ]);
    expect(game.rngSeed).toBe(BigInt(987654321));

    // 模拟服务端记录有序 Action 流水 (seq 1..2)
    await gameRepo.recordAction(game.id, 1, 'alice', 'PLAY_CARD', { cardInstanceId: 'inst-1' });
    await gameRepo.recordAction(game.id, 2, 'alice', 'DECLARE_ATTACK', { attackerCardId: 'inst-1' });

    // 模拟服务端记录有序 Event 流水 (seq 1..2)
    await gameRepo.recordEvent(game.id, 1, 'CARD_PLAYED', { playerId: 'alice', slotIndex: 0 });
    await gameRepo.recordEvent(game.id, 2, 'ATTACK_DECLARED', { attackerCardId: 'inst-1' });

    // 完成对局
    await gameRepo.finishGame(game.id, 'alice', false, '对手侵蚀计数达到7 (9.3.1.a)');

    // 验证回放数据拉取 (Replay Data Fetch)
    const replay = await gameRepo.getReplayData(game.id);
    expect(replay).not.toBeNull();
    expect(replay!.game.winnerUserId).toBe('alice');
    expect(replay!.actions).toHaveLength(2);
    expect(replay!.events).toHaveLength(2);
    expect(replay!.actions[0]!.seq).toBe(1);
    expect(replay!.actions[1]!.seq).toBe(2);
    expect(replay!.events[0]!.eventType).toBe('CARD_PLAYED');
  });

  it('5. 内存仓储容量上限与 FIFO 淘汰（保留活跃对局/活跃房间/系统预组/管理员）', async () => {
    // 5.1 MemoryGameRepository: 仅 FIFO 淘汰已结束对局，绝不淘汰活跃对局，且单局 Action/Event 受限
    const gameRepo = new MemoryGameRepository({
      maxFinishedGames: 2,
      maxActionsPerGame: 2,
      maxEventsPerGame: 2,
    });
    const activeGame = await gameRepo.createGame('room-active', BigInt(1), [], 'g-active');
    await gameRepo.recordAction(activeGame.id, 1, 'p1', 'A1', {});
    await gameRepo.recordAction(activeGame.id, 2, 'p1', 'A2', {});
    await gameRepo.recordAction(activeGame.id, 3, 'p1', 'A3', {}); // 超出单局上限 2
    await gameRepo.recordEvent(activeGame.id, 1, 'E1', {});
    await gameRepo.recordEvent(activeGame.id, 2, 'E2', {});
    await gameRepo.recordEvent(activeGame.id, 3, 'E3', {}); // 超出单局上限 2
    await gameRepo.recordAction('non-existent-game', 1, 'p1', 'A1', {});
    await gameRepo.recordEvent('non-existent-game', 1, 'E1', {});

    const activeReplay = await gameRepo.getReplayData(activeGame.id);
    expect(activeReplay!.actions).toHaveLength(2);
    expect(activeReplay!.events).toHaveLength(2);
    expect(await gameRepo.getReplayData('non-existent-game')).toBeNull();

    for (const gid of ['g-fin-1', 'g-fin-2', 'g-fin-3']) {
      await gameRepo.createGame(`room-${gid}`, BigInt(2), [], gid);
      await gameRepo.recordAction(gid, 1, 'p1', 'SURRENDER', {});
      await gameRepo.finishGame(gid, 'p2', false, '测试结束');
    }
    expect(await gameRepo.getGameById('g-fin-1')).toBeNull();
    expect(await gameRepo.getReplayData('g-fin-1')).toBeNull();
    expect(await gameRepo.getGameById('g-fin-2')).not.toBeNull();
    expect(await gameRepo.getGameById('g-fin-3')).not.toBeNull();
    expect(await gameRepo.getGameById('g-active')).not.toBeNull();

    // 5.2 MemoryRoomRepository: 仅 FIFO 淘汰 CLOSED 房间，绝不淘汰活跃/进行中房间
    const roomRepo = new MemoryRoomRepository({ maxClosedRooms: 2 });
    const waitingRoom = await roomRepo.create('u1', '等待房', 'WAIT01', undefined, 'r-waiting');
    const playingRoom = await roomRepo.create('u2', '对战房', 'PLAY01', undefined, 'r-playing');
    await roomRepo.updateStatus(playingRoom.id, RoomStatus.PLAYING);

    for (const rid of ['r-closed-1', 'r-closed-2', 'r-closed-3']) {
      await roomRepo.create('u3', rid, rid.toUpperCase(), undefined, rid);
      await roomRepo.updateStatus(rid, RoomStatus.CLOSED);
    }
    expect(await roomRepo.findById('r-closed-1')).toBeNull();
    expect(await roomRepo.findById('r-closed-2')).not.toBeNull();
    expect(await roomRepo.findById('r-closed-3')).not.toBeNull();
    expect((await roomRepo.findById(waitingRoom.id))?.status).toBe(RoomStatus.WAITING);
    expect((await roomRepo.findById(playingRoom.id))?.status).toBe(RoomStatus.PLAYING);

    // 5.3 MemoryDeckRepository: 淘汰最旧用户卡组，硬保护 userId === 'system' 官方预组
    const cardRepo = new MemoryCardRepository({ maxVersionsPerCard: 3 });
    const deckRepo = new MemoryDeckRepository(cardRepo, { maxUserDecks: 2 });
    await deckRepo.create('system', '官方预组1', undefined, 'deck-sys-1');
    await deckRepo.create('system', '官方预组2', undefined, 'deck-sys-2');
    await deckRepo.create('u1', '用户卡组1', undefined, 'deck-u1');
    await deckRepo.create('u1', '用户卡组2', undefined, 'deck-u2');
    await deckRepo.create('u2', '用户卡组3', undefined, 'deck-u3');

    expect(await deckRepo.findById('deck-u1')).toBeNull();
    expect(await deckRepo.findById('deck-u2')).not.toBeNull();
    expect(await deckRepo.findById('deck-u3')).not.toBeNull();
    expect(await deckRepo.findById('deck-sys-1')).not.toBeNull();
    expect(await deckRepo.findById('deck-sys-2')).not.toBeNull();

    // 5.4 MemoryCardRepository: 单卡版本快照裁剪保留最新 N 条
    const card = await cardRepo.create(OFFICIAL_SEED_CARDS[0]!);
    await cardRepo.update(card.id, { rulesText: 'v2' }, { v: 2 });
    await cardRepo.update(card.id, { rulesText: 'v3' }, { v: 3 });
    await cardRepo.update(card.id, { rulesText: 'v4' }, { v: 4 });
    const versions = await cardRepo.getVersions(card.id);
    expect(versions).toHaveLength(3);
    expect(versions.map((v) => v.versionNumber)).toEqual([2, 3, 4]);

    // 5.5 MemoryUserRepository: FIFO 淘汰最旧 Role.USER，绝不淘汰 Role.ADMIN
    const userRepo = new MemoryUserRepository({ maxUsers: 2 });
    const admin = await userRepo.create('admin', 'hash', '管理员', Role.ADMIN);
    const u1 = await userRepo.create('user1', 'hash', '玩家1', Role.USER);
    const u2 = await userRepo.create('user2', 'hash', '玩家2', Role.USER);
    const u3 = await userRepo.create('user3', 'hash', '玩家3', Role.USER);

    expect(await userRepo.findById(admin.id)).not.toBeNull();
    expect(await userRepo.findById(u1.id)).toBeNull();
    expect(await userRepo.findById(u2.id)).toBeNull();
    expect(await userRepo.findById(u3.id)).not.toBeNull();
  });
});

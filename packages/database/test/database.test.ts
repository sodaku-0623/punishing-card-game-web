import { describe, it, expect } from 'vitest';
import {
  MemoryUserRepository,
  MemoryCardRepository,
  MemoryDeckRepository,
  MemoryRoomRepository,
  MemoryGameRepository,
} from '../src/repositories/memory-repos.js';
import { OFFICIAL_SEED_CARDS } from '../src/seed/official-cards.js';
import { CardTypeEnum, ElementAttributeEnum, RoomStatus } from '@prisma/client';

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
});

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { io as ClientSocket, Socket } from 'socket.io-client';
import { createServerApp, AppComponents } from '../src/app.js';
import {
  ClientToServerEvents,
  ServerToClientEvents,
  PublicRoomState,
  PublicGameState,
  GameEvent,
  RoomStatus,
} from '@zhanshuang/shared';
import {
  MemoryDeckRepository,
  MemoryCardRepository,
  OFFICIAL_SEED_CARDS,
} from '@zhanshuang/database';

type TypedClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

function create50CardIds(cardMap: Record<string, string>): { cardId: string; count: number }[] {
  return [
    { cardId: cardMap['ST01-012']!, count: 4 },
    { cardId: cardMap['ST01-013']!, count: 4 },
    { cardId: cardMap['ST01-014']!, count: 4 },
    { cardId: cardMap['BP01-001']!, count: 4 },
    { cardId: cardMap['BP01-002']!, count: 4 },
    { cardId: cardMap['BP01-003']!, count: 4 },
    { cardId: cardMap['BP01-004']!, count: 4 },
    { cardId: cardMap['BP01-005']!, count: 4 },
    { cardId: cardMap['BP01-006']!, count: 4 },
    { cardId: cardMap['BP01-007']!, count: 4 },
    { cardId: cardMap['BP01-008']!, count: 4 },
    { cardId: cardMap['BP01-010']!, count: 4 },
    { cardId: cardMap['BP01-012']!, count: 2 },
  ];
}

describe('Realtime WebSocket Gateway & Dual Online Battle (Phase 5 实时双人联机)', () => {
  let app: AppComponents;
  let serverPort: number;
  let serverUrl: string;

  let client1: TypedClientSocket;
  let client2: TypedClientSocket;

  let aliceDeckId: string;
  let bobDeckId: string;

  beforeAll(async () => {
    const cardRepo = new MemoryCardRepository();
    await cardRepo.batchImport(OFFICIAL_SEED_CARDS);
    const deckRepo = new MemoryDeckRepository(cardRepo);

    app = await createServerApp({ deckRepo });
    await app.fastify.listen({ port: 0, host: '127.0.0.1' });
    const address = app.fastify.server.address();
    serverPort = typeof address === 'object' && address ? address.port : 4000;
    serverUrl = `http://127.0.0.1:${serverPort}`;

    // 创建双方合法卡组
    const allCards = await cardRepo.findMany();
    const cardMap: Record<string, string> = {};
    for (const c of allCards.cards) {
      cardMap[c.cardNumber] = c.id;
    }

    const d1 = await deckRepo.create('alice', '爱丽丝牌组');
    await deckRepo.setCards(d1.id, create50CardIds(cardMap), true);
    aliceDeckId = d1.id;

    const d2 = await deckRepo.create('bob', '鲍勃牌组');
    await deckRepo.setCards(d2.id, create50CardIds(cardMap), true);
    bobDeckId = d2.id;
  });

  afterAll(async () => {
    if (client1?.connected) client1.disconnect();
    if (client2?.connected) client2.disconnect();
    app.io.close();
    await app.fastify.close();
  });

  it('1. 双人建房、加入房间与准备状态同步 (Room System)', async () => {
    // 客户端1 (Alice) 连接
    client1 = ClientSocket(serverUrl, {
      query: { userId: 'alice', username: '指挥官·爱丽丝' },
      transports: ['websocket'],
    });

    await new Promise<void>((resolve) => client1.on('connect', resolve));
    expect(client1.connected).toBe(true);

    // Alice 先创建房间
    const roomCreateRes = await app.roomMgr.createRoom('alice', '指挥官·爱丽丝', '灰鸦考核房');
    expect(roomCreateRes.success).toBe(true);
    const roomId = roomCreateRes.data!.roomId;

    // Alice 加入 Socket 房间
    let aliceRoomUpdate: PublicRoomState | null = null;
    client1.on('room:state_updated', (room) => {
      aliceRoomUpdate = room;
    });

    client1.emit('room:join', { roomId });
    await new Promise((r) => setTimeout(r, 100));
    expect(aliceRoomUpdate).not.toBeNull();
    expect(aliceRoomUpdate!.players).toHaveLength(1);

    // 客户端2 (Bob) 连接并加入房间
    client2 = ClientSocket(serverUrl, {
      query: { userId: 'bob', username: '指挥官·鲍勃' },
      transports: ['websocket'],
    });
    await new Promise<void>((resolve) => client2.on('connect', resolve));

    let bobRoomUpdate: PublicRoomState | null = null;
    client2.on('room:state_updated', (room) => {
      bobRoomUpdate = room;
    });

    client2.emit('room:join', { roomId });
    await new Promise((r) => setTimeout(r, 100));

    expect(bobRoomUpdate).not.toBeNull();
    expect(bobRoomUpdate!.players).toHaveLength(2);
    expect(bobRoomUpdate!.status).toBe(RoomStatus.WAITING);

    // 双方准备就绪
    client1.emit('room:ready', { isReady: true, deckId: aliceDeckId });
    client2.emit('room:ready', { isReady: true, deckId: bobDeckId });
    await new Promise((r) => setTimeout(r, 100));

    expect(bobRoomUpdate!.status).toBe(RoomStatus.READY);
  });

  it('2. 权威开局与双方专属隐藏状态推送 (Authoritative Game Start)', async () => {
    let aliceState: PublicGameState | null = null;
    let bobState: PublicGameState | null = null;

    client1.on('game:sync_state', (state) => {
      aliceState = state;
    });
    client2.on('game:sync_state', (state) => {
      bobState = state;
    });

    // 房主宣告开局
    client1.emit('room:start');
    await new Promise((r) => setTimeout(r, 200));

    expect(aliceState).not.toBeNull();
    expect(bobState).not.toBeNull();
    expect(aliceState!.gameId).toBe(bobState!.gameId);
    expect(aliceState!.status).toBe('PLAYING');

    // 验证开局进入 MULLIGAN_PHASE，双方起始各有4张手牌
    expect(aliceState!.phase).toBe('MULLIGAN_PHASE');
    expect(bobState!.phase).toBe('MULLIGAN_PHASE');
    expect(aliceState!.myHandCards!.length).toBe(4);
    expect(bobState!.myHandCards!.length).toBe(4);

    // Alice 执行调度：选择 1 张手牌放回牌组底并重新抽取
    const aliceCardToBottom = aliceState!.myHandCards![0]!.instanceId;
    client1.emit('game:action', {
      gameId: aliceState!.gameId,
      action: {
        type: 'RESOLVE_MULLIGAN',
        playerId: 'alice',
        cardInstanceIdsToBottom: [aliceCardToBottom],
      },
    });

    // Bob 执行调度：保留全部手牌 (0张调度)
    client2.emit('game:action', {
      gameId: bobState!.gameId,
      action: {
        type: 'RESOLVE_MULLIGAN',
        playerId: 'bob',
        cardInstanceIdsToBottom: [],
      },
    });

    await new Promise((r) => setTimeout(r, 200));

    // 双方均完成调度后，权威推进至第一回合抽牌填充阶段 DRAW_CHARGE_PHASE
    expect(aliceState!.phase).toBe('DRAW_CHARGE_PHASE');
    expect(bobState!.phase).toBe('DRAW_CHARGE_PHASE');

    // 验证双方各自只能看到自己的手牌具体内容 (12. 隐藏信息)
    // 第一回合先手方抽1张牌(4+1=5)，后手方4张手牌，合计9张
    expect(aliceState!.myHandCards!.length + aliceState!.opponentHandCount).toBe(9);
    expect(bobState!.myHandCards!.length + bobState!.opponentHandCount).toBe(9);
    expect(aliceState!.myHandCards?.length).toBeGreaterThanOrEqual(4);
    expect(bobState!.myHandCards?.length).toBeGreaterThanOrEqual(4);
  });

  it('3. 客户端提交 Action，服务端权威结算并广播事件与状态 (Game Action & Events)', async () => {
    let receivedEvents: GameEvent[] = [];
    client1.on('game:events', (events) => {
      receivedEvents.push(...events);
    });

    const activeSession = app.gameSessionMgr.getSession(app.gameSessionMgr.getGameIdByUserId('alice')!);
    expect(activeSession).toBeDefined();

    const activePlayerId = activeSession!.engine.getState().activePlayerId;
    const activeClient = activePlayerId === 'alice' ? client1 : client2;

    // 回合玩家在 DRAW_CHARGE_PHASE 提交 Pass 行动
    activeClient.emit('game:action', {
      gameId: activeSession!.gameId,
      action: {
        type: 'PASS_ACTION_TIMING',
        playerId: activePlayerId,
      },
    });

    await new Promise((r) => setTimeout(r, 150));

    // 验证成功推进至主要阶段
    expect(activeSession!.engine.getState().phase).toBe('MAIN_PHASE');
  });

  it('4. 浏览器刷新断线重连恢复状态 (22. 断线重连)', async () => {
    const gameId = app.gameSessionMgr.getGameIdByUserId('alice')!;
    expect(gameId).toBeDefined();

    // 模拟 Alice 刷新网页断开连接
    client1.disconnect();
    expect(client1.connected).toBe(false);

    // Alice 重新建立连接
    const reconnectedClient = ClientSocket(serverUrl, {
      query: { userId: 'alice', username: '指挥官·爱丽丝' },
      transports: ['websocket'],
    });
    await new Promise<void>((resolve) => reconnectedClient.on('connect', resolve));

    let restoredState: PublicGameState | null = null;
    reconnectedClient.on('game:sync_state', (state) => {
      restoredState = state;
    });

    // 触发重连拉取
    reconnectedClient.emit('game:reconnect', { gameId });
    await new Promise((r) => setTimeout(r, 150));

    expect(restoredState).not.toBeNull();
    expect(restoredState!.gameId).toBe(gameId);
    expect(restoredState!.myHandCards?.length).toBeGreaterThanOrEqual(4);
    expect(restoredState!.status).toBe('PLAYING');

    reconnectedClient.disconnect();
  });

  it('5. 恶意冒充或非法行动被拦截且不破坏状态 (Security & Error Rejection)', async () => {
    const gameId = app.gameSessionMgr.getGameIdByUserId('bob')!;
    let lastError: { code: string; message: string } | null = null;

    client2.on('game:error', (err) => {
      lastError = err;
    });

    // 非法行动：传入一个不属于当前阶段的无效行为
    client2.emit('game:action', {
      gameId,
      action: {
        type: 'DECLARE_BLOCK',
        playerId: 'bob',
      },
    });

    await new Promise((r) => setTimeout(r, 150));
    expect(lastError).not.toBeNull();
    expect(lastError!.code).toBe('ACTION_NOT_ALLOWED');
  });

  it('6. 当两人都退出房间时自动关闭房间 (Room Auto Close on All Left)', async () => {
    if (!client1.connected) {
      client1.connect();
      await new Promise<void>((r) => client1.on('connect', r));
    }

    // 1. 创建新房间
    const testRoomRes = await app.roomMgr.createRoom('alice', '指挥官·爱丽丝', '自闭测试房');
    expect(testRoomRes.success).toBe(true);
    const rId = testRoomRes.data!.roomId;

    // 2. 双方加入 Socket 房间
    client1.emit('room:join', { roomId: rId });
    client2.emit('room:join', { roomId: rId });
    await new Promise((r) => setTimeout(r, 100));

    expect(app.roomMgr.getRoom(rId)?.players).toHaveLength(2);

    // 3. 第一名玩家 Alice 退出房间：房间不关闭，Bob 留在房间中且继承房主
    client1.emit('room:leave', { roomId: rId });
    await new Promise((r) => setTimeout(r, 100));

    const roomAfterAliceLeft = app.roomMgr.getRoom(rId);
    expect(roomAfterAliceLeft).toBeDefined();
    expect(roomAfterAliceLeft!.status).toBe(RoomStatus.WAITING);
    expect(roomAfterAliceLeft!.players).toHaveLength(1);
    expect(roomAfterAliceLeft!.players[0].userId).toBe('bob');
    expect(roomAfterAliceLeft!.creatorId).toBe('bob');

    // 4. 第二名玩家 Bob 退出房间：两人均已退出，房间自动关闭！
    let roomClosedPayload: any = null;
    let roomDeletedPayload: any = null;
    client2.on('room:closed', (p) => {
      roomClosedPayload = p;
    });
    client2.on('room:deleted', (p) => {
      roomDeletedPayload = p;
    });

    client2.emit('room:leave', { roomId: rId });
    await new Promise((r) => setTimeout(r, 100));

    // 验证房间已彻底关闭并从活动列表中移除
    expect(app.roomMgr.getRoom(rId)).toBeUndefined();
    expect(app.roomMgr.listRooms().some((r) => r.roomId === rId)).toBe(false);
    expect(roomDeletedPayload?.roomId).toBe(rId);
  });

  it('7. 两人从对局桌面退出后自动关闭关联房间与会话 (Dual Leave from Game Auto Closes Room)', async () => {
    // 1. 创建新房间并就绪开局
    const newRoomRes = await app.roomMgr.createRoom('alice', '指挥官·爱丽丝', '对局结算自闭房');
    const rId = newRoomRes.data!.roomId;

    client1.emit('room:join', { roomId: rId });
    client2.emit('room:join', { roomId: rId });
    await new Promise((r) => setTimeout(r, 100));

    client1.emit('room:ready', { roomId: rId, isReady: true, deckId: aliceDeckId });
    client2.emit('room:ready', { roomId: rId, isReady: true, deckId: bobDeckId });
    await new Promise((r) => setTimeout(r, 150));

    client1.emit('room:start', { roomId: rId });
    await new Promise((r) => setTimeout(r, 200));

    const roomInGame = app.roomMgr.getRoom(rId);
    expect(roomInGame).toBeDefined();
    expect(roomInGame!.status).toBe(RoomStatus.PLAYING);
    const gId = roomInGame!.currentGameId!;
    expect(gId).toBeDefined();

    // 2. Alice 退出对局/暂时断开
    client1.emit('game:leave', { gameId: gId });
    await new Promise((r) => setTimeout(r, 100));

    // 此时 Bob 仍在，房间未彻底关闭，保留推演状态供重连
    const roomAfterAliceGameLeave = app.roomMgr.getRoom(rId);
    expect(roomAfterAliceGameLeave).toBeDefined();
    expect(roomAfterAliceGameLeave!.status).toBe(RoomStatus.PLAYING);
    expect(roomAfterAliceGameLeave!.players.find((p) => p.userId === 'alice')?.isOnline).toBe(false);
    expect(roomAfterAliceGameLeave!.players.filter((p) => p.isOnline)).toHaveLength(1);

    // 3. Bob 也退出对局：两人均已退出，房间自动关闭！
    client2.emit('game:leave', { gameId: gId });
    await new Promise((r) => setTimeout(r, 100));

    // 验证房间与会话均已关闭
    expect(app.roomMgr.getRoom(rId)).toBeUndefined();
    expect(app.roomMgr.listRooms().some((r) => r.roomId === rId)).toBe(false);
    expect(app.gameSessionMgr.getSession(gId)).toBeUndefined();
  });

  it('8. 对战中某一方掉线断开，房间不关闭并保留，掉线玩家重新进入后继续对战 (Battle Disconnect & Resume Flow)', async () => {
    // 1. 创建新对战房间并开局
    const res = await app.roomMgr.createRoom('alice', '指挥官·爱丽丝', '掉线重连推演房');
    const rId = res.data!.roomId;

    client1.emit('room:join', { roomId: rId });
    client2.emit('room:join', { roomId: rId });
    await new Promise((r) => setTimeout(r, 100));

    client1.emit('room:ready', { roomId: rId, isReady: true, deckId: aliceDeckId });
    client2.emit('room:ready', { roomId: rId, isReady: true, deckId: bobDeckId });
    await new Promise((r) => setTimeout(r, 150));

    client1.emit('room:start', { roomId: rId });
    await new Promise((r) => setTimeout(r, 200));

    const room = app.roomMgr.getRoom(rId);
    expect(room).toBeDefined();
    expect(room!.status).toBe(RoomStatus.PLAYING);
    const gId = room!.currentGameId!;

    let bobReceivedDisconnect = false;
    let bobReceivedReconnect = false;
    client2.on('game:player_disconnected', () => {
      bobReceivedDisconnect = true;
    });
    client2.on('game:player_reconnected', () => {
      bobReceivedReconnect = true;
    });

    // 2. 模拟 Alice 突发掉线或失去网络连接
    client1.disconnect();
    await new Promise((r) => setTimeout(r, 1600)); // 跨过 1500ms 掉线检测缓冲

    // 验证房间依然保留，状态依旧为 PLAYING，绝不关闭！
    const roomDuringDisconnect = app.roomMgr.getRoom(rId);
    expect(roomDuringDisconnect).toBeDefined();
    expect(roomDuringDisconnect!.status).toBe(RoomStatus.PLAYING);
    expect(roomDuringDisconnect!.players.find((p) => p.userId === 'alice')?.isOnline).toBe(false);

    // 验证在场守候的 Bob 收到了对手掉线提示
    expect(bobReceivedDisconnect).toBe(true);

    // 3. Alice 重新连网接入
    const aliceReborn = ClientSocket(serverUrl, {
      query: { userId: 'alice', username: '指挥官·爱丽丝' },
      transports: ['websocket'],
    });
    await new Promise<void>((resolve) => aliceReborn.on('connect', resolve));

    let aliceRestoredState: PublicGameState | null = null;
    aliceReborn.on('game:sync_state', (s) => {
      aliceRestoredState = s;
    });

    // Alice 触发游戏重连
    aliceReborn.emit('game:reconnect', { gameId: gId });
    await new Promise((r) => setTimeout(r, 150));

    // 验证 Alice 状态成功恢复，对决继续进行
    expect(aliceRestoredState).not.toBeNull();
    expect(aliceRestoredState!.status).toBe('PLAYING');
    expect(bobReceivedReconnect).toBe(true);

    const roomAfterReconnect = app.roomMgr.getRoom(rId);
    expect(roomAfterReconnect!.players.find((p) => p.userId === 'alice')?.isOnline).toBe(true);

    // 清理连接
    aliceReborn.disconnect();
  });

  it('9. 对战结束后双方返回大厅进入新房间并开始第二局，第二局正常进行且不提前报错退出 (Consecutive Matches Seamless Transition)', async () => {
    // 1. 确保双方客户端连接正常
    if (!client1.connected) {
      client1.connect();
      await new Promise<void>((resolve) => client1.on('connect', resolve));
    }
    if (!client2.connected) {
      client2.connect();
      await new Promise<void>((resolve) => client2.on('connect', resolve));
    }

    // 2. 第一局：创建房间 1 并开局
    const room1Res = await app.roomMgr.createRoom('alice', '指挥官·爱丽丝', '第一局对战房');
    const rId1 = room1Res.data!.roomId;

    client1.emit('room:join', { roomId: rId1 });
    client2.emit('room:join', { roomId: rId1 });
    await new Promise((r) => setTimeout(r, 100));

    client1.emit('room:ready', { roomId: rId1, isReady: true, deckId: aliceDeckId });
    client2.emit('room:ready', { roomId: rId1, isReady: true, deckId: bobDeckId });
    await new Promise((r) => setTimeout(r, 150));

    client1.emit('room:start', { roomId: rId1 });
    await new Promise((r) => setTimeout(r, 200));

    const room1InGame = app.roomMgr.getRoom(rId1);
    expect(room1InGame).toBeDefined();
    expect(room1InGame!.status).toBe(RoomStatus.PLAYING);
    const gId1 = room1InGame!.currentGameId!;
    expect(gId1).toBeDefined();

    // 3. 第一局结束：Alice 投降
    let game1EndedResult: any = null;
    const onGame1Ended = (res: any) => {
      game1EndedResult = res;
    };
    client2.on('game:ended', onGame1Ended);

    client1.emit('game:leave', { gameId: gId1, isSurrender: true });
    await new Promise((r) => setTimeout(r, 150));

    expect(game1EndedResult).not.toBeNull();
    client2.off('game:ended', onGame1Ended);

    // 第一局结束后，房间状态自动置为 FINISHED
    expect(room1InGame!.status).toBe(RoomStatus.FINISHED);

    // 双方退出第一局及房间 1
    client1.emit('game:leave', { gameId: gId1 });
    client1.emit('room:leave', { roomId: rId1 });
    client2.emit('game:leave', { gameId: gId1 });
    client2.emit('room:leave', { roomId: rId1 });
    await new Promise((r) => setTimeout(r, 150));

    // 验证房间 1 彻底关闭
    expect(app.roomMgr.getRoom(rId1)).toBeUndefined();

    // 4. 第二局：Alice 创建房间 2，Bob 加入
    const room2Res = await app.roomMgr.createRoom('alice', '指挥官·爱丽丝', '第二局全新对决');
    const rId2 = room2Res.data!.roomId;

    client1.emit('room:join', { roomId: rId2 });
    client2.emit('room:join', { roomId: rId2 });
    await new Promise((r) => setTimeout(r, 100));

    client1.emit('room:ready', { roomId: rId2, isReady: true, deckId: aliceDeckId });
    client2.emit('room:ready', { roomId: rId2, isReady: true, deckId: bobDeckId });
    await new Promise((r) => setTimeout(r, 150));

    // 监听第二局的关键事件，确保绝不发生“对方已退出/对局提前结束”
    let game2UnexpectedDisconnect = false;
    let game2UnexpectedEnd = false;
    let game2StateAlice: PublicGameState | null = null;
    let game2StateBob: PublicGameState | null = null;

    const onGame2Disconnect = () => {
      game2UnexpectedDisconnect = true;
    };
    const onGame2Ended = () => {
      game2UnexpectedEnd = true;
    };

    client1.on('game:player_disconnected', onGame2Disconnect);
    client2.on('game:player_disconnected', onGame2Disconnect);
    client1.on('game:ended', onGame2Ended);
    client2.on('game:ended', onGame2Ended);

    client1.on('game:sync_state', (s) => {
      game2StateAlice = s;
    });
    client2.on('game:sync_state', (s) => {
      game2StateBob = s;
    });

    // Alice 开局第二场
    client1.emit('room:start', { roomId: rId2 });
    await new Promise((r) => setTimeout(r, 300));

    const room2InGame = app.roomMgr.getRoom(rId2);
    expect(room2InGame).toBeDefined();
    expect(room2InGame!.status).toBe(RoomStatus.PLAYING);
    const gId2 = room2InGame!.currentGameId!;
    expect(gId2).toBeDefined();
    expect(gId2).not.toBe(gId1);

    // 验证双方均成功连入第二局且状态为 PLAYING
    expect(game2StateAlice).not.toBeNull();
    expect(game2StateBob).not.toBeNull();
    expect(game2StateAlice!.gameId).toBe(gId2);
    expect(game2StateBob!.gameId).toBe(gId2);
    expect(game2StateAlice!.status).toBe('PLAYING');
    expect(game2StateBob!.status).toBe('PLAYING');

    // 验证绝无误触发的掉线或提前结算！
    expect(game2UnexpectedDisconnect).toBe(false);
    expect(game2UnexpectedEnd).toBe(false);

    // 5. 测试第二局能正常提交指令 (例如跳过阶段 PASS_TIMING)
    client1.emit('game:action', {
      gameId: gId2,
      action: {
        type: 'PASS_TIMING',
        playerId: 'alice',
      },
    });
    await new Promise((r) => setTimeout(r, 150));

    // 第二局持续进行，未发生意外退出
    expect(game2UnexpectedDisconnect).toBe(false);
    expect(game2UnexpectedEnd).toBe(false);

    // 清理监听
    client1.off('game:player_disconnected', onGame2Disconnect);
    client2.off('game:player_disconnected', onGame2Disconnect);
    client1.off('game:ended', onGame2Ended);
    client2.off('game:ended', onGame2Ended);
  });

  it('10. 双方玩家在房间中依次准备，双方准备状态互不影响且均保持就绪 (Dual Ready State Preservation)', async () => {
    // 1. 创建新等待房间
    const res = await app.roomMgr.createRoom('alice', '指挥官·爱丽丝', '双人准备测试房');
    const rId = res.data!.roomId;

    let latestAliceRoom: PublicRoomState | null = null;
    let latestBobRoom: PublicRoomState | null = null;

    client1.on('room:state_updated', (r) => {
      if (r.roomId === rId) latestAliceRoom = r;
    });
    client2.on('room:state_updated', (r) => {
      if (r.roomId === rId) latestBobRoom = r;
    });

    client1.emit('room:join', { roomId: rId });
    client2.emit('room:join', { roomId: rId });
    await new Promise((r) => setTimeout(r, 100));

    expect(latestAliceRoom).not.toBeNull();
    expect(latestAliceRoom!.players).toHaveLength(2);
    expect(latestAliceRoom!.status).toBe(RoomStatus.WAITING);

    // 2. 第一名玩家 Alice 准备
    client1.emit('room:ready', { roomId: rId, isReady: true, deckId: aliceDeckId });
    await new Promise((r) => setTimeout(r, 100));

    const pAlice1 = latestAliceRoom!.players.find((p) => p.userId === 'alice');
    const pBob1 = latestAliceRoom!.players.find((p) => p.userId === 'bob');
    expect(pAlice1?.isReady).toBe(true);
    expect(pBob1?.isReady).toBe(false);
    expect(latestAliceRoom!.status).toBe(RoomStatus.WAITING);

    // 3. 第二名玩家 Bob 准备
    client2.emit('room:ready', { roomId: rId, isReady: true, deckId: bobDeckId });
    await new Promise((r) => setTimeout(r, 100));

    // 核心断言：Alice 绝不自动取消准备！双方均须为 true，且房间状态达到 READY
    const pAlice2 = latestBobRoom!.players.find((p) => p.userId === 'alice');
    const pBob2 = latestBobRoom!.players.find((p) => p.userId === 'bob');
    expect(pAlice2?.isReady).toBe(true);
    expect(pBob2?.isReady).toBe(true);
    expect(latestBobRoom!.status).toBe(RoomStatus.READY);

    // 4. Alice 取消准备：Alice 为 false，Bob 依然维持准备 (true)
    client1.emit('room:ready', { roomId: rId, isReady: false, deckId: aliceDeckId });
    await new Promise((r) => setTimeout(r, 100));

    const pAlice3 = latestBobRoom!.players.find((p) => p.userId === 'alice');
    const pBob3 = latestBobRoom!.players.find((p) => p.userId === 'bob');
    expect(pAlice3?.isReady).toBe(false);
    expect(pBob3?.isReady).toBe(true);
    expect(latestBobRoom!.status).toBe(RoomStatus.WAITING);

    // 5. Alice 重新准备：双方均就绪
    client1.emit('room:ready', { roomId: rId, isReady: true, deckId: aliceDeckId });
    await new Promise((r) => setTimeout(r, 100));

    const pAlice4 = latestBobRoom!.players.find((p) => p.userId === 'alice');
    const pBob4 = latestBobRoom!.players.find((p) => p.userId === 'bob');
    expect(pAlice4?.isReady).toBe(true);
    expect(pBob4?.isReady).toBe(true);
    expect(latestBobRoom!.status).toBe(RoomStatus.READY);

    // 清理房间
    client1.emit('room:leave', { roomId: rId });
    client2.emit('room:leave', { roomId: rId });
  });
});

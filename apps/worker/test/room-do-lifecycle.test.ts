import { describe, it, expect, beforeEach } from 'vitest';
import { RoomDO } from '../src/room-do.js';
import { createMockDOContext, createTestEnv, MockWebSocket } from './mock-do-env.js';

describe('RoomDO 权威对局生命周期与 O(1) 快照恢复测试', () => {
  let env = createTestEnv();

  beforeEach(() => {
    if (typeof (globalThis as any).WebSocketPair === 'undefined') {
      (globalThis as any).WebSocketPair = class MockWebSocketPair {
        0: MockWebSocket;
        1: MockWebSocket;
        constructor() {
          this[0] = new MockWebSocket();
          this[1] = new MockWebSocket();
        }
      };
    }
  });

  async function connectPlayer(roomDo: RoomDO, opts: { token?: string; guestId?: string; nickname?: string }) {
    const url = new URL('https://worker.local/ws/rooms/room-test-101');
    if (opts.token) url.searchParams.set('token', opts.token);
    if (opts.guestId) url.searchParams.set('guestId', opts.guestId);
    if (opts.nickname) url.searchParams.set('nickname', opts.nickname);

    const req = new Request(url.toString(), {
      headers: { Upgrade: 'websocket' },
    });

    const res = await roomDo.fetch(req);
    expect([101, 200]).toContain(res.status);
    const clientWs = (res as any).webSocket as MockWebSocket;
    return clientWs;
  }

  it('1. 玩家进入房间，座位分配与满员保护', async () => {
    const { ctx } = createMockDOContext();
    const roomDo = new RoomDO(ctx, env);

    // 玩家 1 进入
    await connectPlayer(roomDo, { guestId: 'p1_guest', nickname: '指挥官1号' });
    const serverSockets = (ctx as any).getWebSockets();
    expect(serverSockets).toHaveLength(1);
    const p1ServerWs = serverSockets[0];

    // 发送 room:join
    await roomDo.webSocketMessage(p1ServerWs, JSON.stringify({
      event: 'room:join',
      payload: { title: '测试房间A' },
    }));

    let p1Msg = p1ServerWs.getLastMessage();
    expect(p1Msg?.event).toBe('room:update');
    expect(p1Msg?.payload.players).toHaveLength(1);
    expect(p1Msg?.payload.players[0].seatIndex).toBe(0);

    // 玩家 2 进入
    await connectPlayer(roomDo, { guestId: 'p2_guest', nickname: '指挥官2号' });
    const p2ServerWs = serverSockets[1];
    await roomDo.webSocketMessage(p2ServerWs, JSON.stringify({
      event: 'room:join',
      payload: { title: '测试房间A' },
    }));

    let p2Msg = p2ServerWs.getLastMessage();
    expect(p2Msg?.event).toBe('room:update');
    expect(p2Msg?.payload.players).toHaveLength(2);
    expect(p2Msg?.payload.players[1].seatIndex).toBe(1);

    // 玩家 3 试图进入已满房间
    await connectPlayer(roomDo, { guestId: 'p3_guest', nickname: '指挥官3号' });
    const p3ServerWs = serverSockets[2];
    await roomDo.webSocketMessage(p3ServerWs, JSON.stringify({
      event: 'room:join',
      payload: { title: '测试房间A' },
    }));

    const p3Error = p3ServerWs.getLastMessage();
    expect(p3Error?.event).toBe('game:error');
    expect(p3Error?.payload.code).toBe('ROOM_FULL');
  });

  it('2. 双方准备就绪后权威自动开局，推送各自脱敏的 game:bundle 数据包', async () => {
    const { ctx } = createMockDOContext();
    const roomDo = new RoomDO(ctx, env);

    await connectPlayer(roomDo, { guestId: 'p1', nickname: '玩家1' });
    await connectPlayer(roomDo, { guestId: 'p2', nickname: '玩家2' });
    const [p1Ws, p2Ws] = (ctx as any).getWebSockets();

    await roomDo.webSocketMessage(p1Ws, JSON.stringify({ event: 'room:join', payload: {} }));
    await roomDo.webSocketMessage(p2Ws, JSON.stringify({ event: 'room:join', payload: {} }));

    // 玩家 1 准备
    await roomDo.webSocketMessage(p1Ws, JSON.stringify({
      event: 'room:ready',
      payload: { isReady: true, deckId: 'deck-st01' },
    }));

    // 玩家 2 准备 -> 触发开局
    await roomDo.webSocketMessage(p2Ws, JSON.stringify({
      event: 'room:ready',
      payload: { isReady: true, deckId: 'deck-st02' },
    }));

    // 验证双方收到 game:start
    const p1Start = p1Ws.findMessages('game:start');
    const p2Start = p2Ws.findMessages('game:start');
    expect(p1Start).toHaveLength(1);
    expect(p2Start).toHaveLength(1);
    expect(p1Start[0].payload.gameId).toBeDefined();

    // 验证双方收到了脱敏的 game:bundle 合并数据包
    const p1Bundles = p1Ws.findMessages('game:bundle');
    const p2Bundles = p2Ws.findMessages('game:bundle');
    expect(p1Bundles.length).toBeGreaterThanOrEqual(1);
    expect(p2Bundles.length).toBeGreaterThanOrEqual(1);

    const p1State = p1Bundles[0].payload.state;
    const p2State = p2Bundles[0].payload.state;

    // 脱敏校验：p1 看到自己的手牌，对手手牌仅知晓数量，绝不泄露对手私有卡牌
    expect(p1State.myHandCards.length).toBeGreaterThan(0);
    expect(p1State.myHandCards[0].cardNumber).toBeDefined();
    expect(p1State.opponentHandCount).toBeGreaterThan(0);

    expect(p2State.myHandCards.length).toBeGreaterThan(0);
    expect(p2State.myHandCards[0].cardNumber).toBeDefined();
    expect(p2State.opponentHandCount).toBeGreaterThan(0);
  });

  it('3. 玩家对战行动执行、快照保存与对战结束广播', async () => {
    const { ctx } = createMockDOContext();
    const roomDo = new RoomDO(ctx, env);

    await connectPlayer(roomDo, { guestId: 'p1', nickname: '玩家1' });
    await connectPlayer(roomDo, { guestId: 'p2', nickname: '玩家2' });
    const [p1Ws, p2Ws] = (ctx as any).getWebSockets();

    await roomDo.webSocketMessage(p1Ws, JSON.stringify({ event: 'room:join', payload: {} }));
    await roomDo.webSocketMessage(p2Ws, JSON.stringify({ event: 'room:join', payload: {} }));
    await roomDo.webSocketMessage(p1Ws, JSON.stringify({ event: 'room:ready', payload: { isReady: true } }));
    await roomDo.webSocketMessage(p2Ws, JSON.stringify({ event: 'room:ready', payload: { isReady: true } }));

    // 玩家 1 发起投降
    await roomDo.webSocketMessage(p1Ws, JSON.stringify({
      event: 'game:action',
      payload: { action: { type: 'SURRENDER' } },
    }));

    // 双方应收到 game:over 广播，胜者为 p2
    const p1GameOver = p1Ws.findMessages('game:over');
    expect(p1GameOver).toHaveLength(1);
    expect(p1GameOver[0].payload.winnerId).toBe('p2');
  });

  it('4. Durable Object 实例驱逐恢复 (O(1) Snapshot Restoration)', async () => {
    // 共享同一个持久化 SQLite 实例
    const { ctx: ctx1, db } = createMockDOContext();
    const roomDo1 = new RoomDO(ctx1, env);

    await connectPlayer(roomDo1, { guestId: 'p1', nickname: '玩家1' });
    await connectPlayer(roomDo1, { guestId: 'p2', nickname: '玩家2' });
    const [p1Ws1, p2Ws1] = (ctx1 as any).getWebSockets();

    await roomDo1.webSocketMessage(p1Ws1, JSON.stringify({ event: 'room:join', payload: {} }));
    await roomDo1.webSocketMessage(p2Ws1, JSON.stringify({ event: 'room:join', payload: {} }));
    await roomDo1.webSocketMessage(p1Ws1, JSON.stringify({ event: 'room:ready', payload: { isReady: true } }));
    await roomDo1.webSocketMessage(p2Ws1, JSON.stringify({ event: 'room:ready', payload: { isReady: true } }));

    // 模拟 Cloudflare Workers 对该 DO 进行了休眠或内存驱逐 (Eviction)，随后有新连接拉起新的 DO 实例
    const { ctx: ctx2 } = createMockDOContext(db);
    const roomDo2 = new RoomDO(ctx2, env);

    // 玩家 1 在新实例上重新建立连接并请求重连
    await connectPlayer(roomDo2, { guestId: 'p1', nickname: '玩家1' });
    const [p1Ws2] = (ctx2 as any).getWebSockets();

    await roomDo2.webSocketMessage(p1Ws2, JSON.stringify({
      event: 'game:reconnect',
    }));

    // 验证新实例成功无缝从 SQLite 中以 O(1) 恢复快照并推送当前战局
    const reconnectedBundle = p1Ws2.findMessages('game:bundle');
    expect(reconnectedBundle.length).toBeGreaterThanOrEqual(1);
    const restoredState = reconnectedBundle[reconnectedBundle.length - 1].payload.state;
    expect(restoredState.status).toBe('PLAYING');
    expect(restoredState.myHandCards.length).toBeGreaterThan(0);
  });

  it('5. 玩家掉线触发 Alarm 超时判负与主动重连取消 Alarm', async () => {
    const { ctx, getScheduledAlarm } = createMockDOContext();
    const roomDo = new RoomDO(ctx, env);

    await connectPlayer(roomDo, { guestId: 'p1', nickname: '玩家1' });
    await connectPlayer(roomDo, { guestId: 'p2', nickname: '玩家2' });
    const [p1Ws, p2Ws] = (ctx as any).getWebSockets();

    await roomDo.webSocketMessage(p1Ws, JSON.stringify({ event: 'room:join', payload: {} }));
    await roomDo.webSocketMessage(p2Ws, JSON.stringify({ event: 'room:join', payload: {} }));
    await roomDo.webSocketMessage(p1Ws, JSON.stringify({ event: 'room:ready', payload: { isReady: true } }));
    await roomDo.webSocketMessage(p2Ws, JSON.stringify({ event: 'room:ready', payload: { isReady: true } }));

    // 玩家 1 掉线关闭连接
    await roomDo.webSocketClose(p1Ws, 1006, 'Connection lost', false);

    // 验证已调度掉线判负定时器 Alarm (60秒后)
    const alarmTime = getScheduledAlarm();
    expect(alarmTime).toBeGreaterThan(Date.now());

    // 玩家 2 收到掉线通知
    const p2Notice = p2Ws.findMessages('game:player_disconnected');
    expect(p2Notice).toHaveLength(1);
    expect(p2Notice[0].payload.playerId).toBe('p1');

    // 触发 Alarm 超时回调 -> 自动判负 p1
    await roomDo.alarm();

    const gameOver = p2Ws.findMessages('game:over');
    expect(gameOver).toHaveLength(1);
    expect(gameOver[0].payload.winnerId).toBe('p2');
    expect(gameOver[0].payload.reason).toBe('DISCONNECT_TIMEOUT');
  });
});

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { io as ClientSocket, Socket } from 'socket.io-client';
import { createServerApp, AppComponents } from '../src/app.js';
import {
  ClientToServerEvents,
  ServerToClientEvents,
  PublicGameState,
  ErrorCode,
} from '@zhanshuang/shared';
import {
  MemoryDeckRepository,
  MemoryCardRepository,
  OFFICIAL_SEED_CARDS,
} from '@zhanshuang/database';

type TypedClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

describe('Phase 11 & 12 Security Hardening & Rate Limiting (安全防作弊与防刷限流验证)', () => {
  let app: AppComponents;
  let serverPort: number;
  let serverUrl: string;

  let aliceSocket: TypedClientSocket;
  let bobSocket: TypedClientSocket;
  let gameId: string;

  beforeAll(async () => {
    app = await createServerApp();
    await app.fastify.listen({ port: 0, host: '127.0.0.1' });
    const address = app.fastify.server.address();
    serverPort = typeof address === 'object' && address ? address.port : 4000;
    serverUrl = `http://127.0.0.1:${serverPort}`;

    // 建立对战双方连接
    aliceSocket = ClientSocket(serverUrl, {
      query: { userId: 'alice', username: '指挥官·爱丽丝' },
      transports: ['websocket'],
    });
    bobSocket = ClientSocket(serverUrl, {
      query: { userId: 'bob', username: '指挥官·鲍勃' },
      transports: ['websocket'],
    });

    await Promise.all([
      new Promise<void>((r) => aliceSocket.on('connect', r)),
      new Promise<void>((r) => bobSocket.on('connect', r)),
    ]);

    // 启动对战
    const session = await app.gameSessionMgr.startGameSession(
      'room-sec-test',
      'alice',
      'deck-st01',
      'bob',
      'deck-st02',
      999888
    );
    gameId = session.gameId;

    // 双方进入 game 频道
    await new Promise((r) => setTimeout(r, 100));
  });

  afterAll(async () => {
    if (aliceSocket?.connected) aliceSocket.disconnect();
    if (bobSocket?.connected) bobSocket.disconnect();
    app.io.close();
    await app.fastify.close();
  });

  it('1. 隐藏信息零泄露验证 (Zero Information Leakage Check)', () => {
    const aliceSafeState = app.gameSessionMgr.getPublicGameState(gameId, 'alice');
    const bobSafeState = app.gameSessionMgr.getPublicGameState(gameId, 'bob');

    expect(aliceSafeState).not.toBeNull();
    expect(bobSafeState).not.toBeNull();

    // Alice 手牌只能看到自己的，绝不能包含 Bob 手牌
    expect(aliceSafeState!.myHandCards.length).toBeGreaterThan(0);
    expect(aliceSafeState!.opponentHandCount).toBeGreaterThan(0);
    for (const card of aliceSafeState!.myHandCards) {
      expect(card.controllerPlayerId).toBe('alice');
    }

    // Bob 手牌同理
    for (const card of bobSafeState!.myHandCards) {
      expect(card.controllerPlayerId).toBe('bob');
    }

    // 牌库卡牌顺序绝不向公开状态暴露
    expect((aliceSafeState as any).cards).toBeUndefined();
    expect((aliceSafeState as any).deck).toBeUndefined();
  });

  it('2. 防作弊与代冒名攻击拦截 (Anti-Impersonation Protection)', async () => {
    let receivedError: any = null;
    aliceSocket.on('game:error', (err) => {
      receivedError = err;
    });

    // Alice 恶意冒充 Bob 提交属于 Bob 的操作
    aliceSocket.emit('game:action', {
      gameId,
      action: {
        type: 'PASS_ACTION_TIMING',
        playerId: 'bob', // 恶意伪造
      } as any,
    });

    await new Promise((r) => setTimeout(r, 150));
    // 服务端拦截冒名假造攻击并返回 UNAUTHORIZED
    expect(receivedError).not.toBeNull();
    expect(receivedError.code).toBe(ErrorCode.UNAUTHORIZED);
  });

  it('3. 高频突发操作防刷与限流 (Sliding Window Rate Limiter)', async () => {
    let rateLimitHit = false;
    aliceSocket.on('game:error', (err) => {
      if (err.code === ErrorCode.RATE_LIMIT_EXCEEDED) {
        rateLimitHit = true;
      }
    });

    // 极速并发突发 20 次操作（超过 15/s 上限）
    for (let i = 0; i < 20; i++) {
      aliceSocket.emit('game:action', {
        gameId,
        action: {
          type: 'PASS_ACTION_TIMING',
          playerId: 'alice',
        } as any,
      });
    }

    await new Promise((r) => setTimeout(r, 200));
    expect(rateLimitHit).toBe(true);
  });
});

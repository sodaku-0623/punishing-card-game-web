import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NativeWebSocketClient, getSocket, resetSocket } from '../src/lib/socket';

class MockNativeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: MockNativeWebSocket[] = [];
  url: string;
  readyState = 0; // CONNECTING
  sent: string[] = [];

  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((err: any) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockNativeWebSocket.instances.push(this);
    setTimeout(() => {
      this.readyState = 1; // OPEN
      this.onopen?.();
    }, 5);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = 3; // CLOSED
    this.onclose?.();
  }

  receiveMessage(event: string, payload: any) {
    this.onmessage?.({ data: JSON.stringify({ event, payload }) });
  }
}

describe('NativeWebSocketClient 原生 WebSocket 兼容客户端测试', () => {
  beforeEach(() => {
    resetSocket();
    MockNativeWebSocket.instances = [];
    (globalThis as any).WebSocket = MockNativeWebSocket;
  });

  afterEach(() => {
    resetSocket();
  });

  it('1. 正常建立连接并触发 connect 回调', async () => {
    const client = new NativeWebSocketClient('wss://test.worker/ws/rooms/room-1', 'user-1');
    const connectSpy = vi.fn();
    client.on('connect', connectSpy);

    await new Promise((r) => setTimeout(r, 15));
    expect(connectSpy).toHaveBeenCalled();
    expect(client.connected).toBe(true);
  });

  it('2. 消息发送与队列打包', async () => {
    const client = new NativeWebSocketClient('wss://test.worker/ws/rooms/room-1', 'user-1');
    client.emit('room:join', { title: '测试房间' });

    await new Promise((r) => setTimeout(r, 15));
    const ws = MockNativeWebSocket.instances[0];
    expect(ws.sent).toHaveLength(1);
    expect(JSON.parse(ws.sent[0])).toEqual({
      event: 'room:join',
      payload: { title: '测试房间' },
    });
  });

  it('3. 收到 game:bundle 自动解包并多路复用广播', async () => {
    const client = new NativeWebSocketClient('wss://test.worker/ws/rooms/room-1', 'user-1');
    const bundleSpy = vi.fn();
    const syncStateSpy = vi.fn();
    const eventsSpy = vi.fn();
    const choiceSpy = vi.fn();

    client.on('game:bundle', bundleSpy);
    client.on('game:sync_state', syncStateSpy);
    client.on('game:events', eventsSpy);
    client.on('game:choice_required', choiceSpy);

    await new Promise((r) => setTimeout(r, 15));
    const ws = MockNativeWebSocket.instances[0];

    const mockBundle = {
      events: [{ type: 'CARD_PLAYED', id: 'e1' }],
      state: {
        gameId: 'g1',
        currentPendingChoice: { id: 'c1', prompt: '请选择攻击目标' },
      },
    };

    ws.receiveMessage('game:bundle', mockBundle);

    expect(bundleSpy).toHaveBeenCalledWith(mockBundle);
    expect(syncStateSpy).toHaveBeenCalledWith(mockBundle.state);
    expect(eventsSpy).toHaveBeenCalledWith(mockBundle.events);
    expect(choiceSpy).toHaveBeenCalledWith(mockBundle.state.currentPendingChoice);
  });

  it('4. 连接按房间路由：大厅不建连接，加入房间时连接对应房间，同房间的对局重连复用连接', async () => {
    const client = new NativeWebSocketClient(null, 'user-1', (path) => `wss://test.worker${path}?guestId=user-1`);
    expect(MockNativeWebSocket.instances).toHaveLength(0);

    client.emit('room:join', { roomId: '123456' });
    await new Promise((r) => setTimeout(r, 15));
    expect(MockNativeWebSocket.instances).toHaveLength(1);
    expect(MockNativeWebSocket.instances[0]!.url).toBe('wss://test.worker/ws/rooms/123456?guestId=user-1');
    expect(MockNativeWebSocket.instances[0]!.sent[0]).toContain('room:join');

    // 同一房间的对局：不重建连接
    client.emit('game:reconnect', { gameId: 'game~123456~1700000000000' });
    await new Promise((r) => setTimeout(r, 15));
    expect(MockNativeWebSocket.instances).toHaveLength(1);

    // 换到另一个房间：关闭旧连接并连接新房间，排队的消息发往新连接
    client.emit('room:join', { roomId: '654321' });
    await new Promise((r) => setTimeout(r, 15));
    expect(MockNativeWebSocket.instances).toHaveLength(2);
    expect(MockNativeWebSocket.instances[1]!.url).toBe('wss://test.worker/ws/rooms/654321?guestId=user-1');
    expect(MockNativeWebSocket.instances[1]!.sent[0]).toContain('654321');
  });

  it('4b. 未设置 NEXT_PUBLIC_WS_TRANSPORT=native 时默认使用 Socket.IO (自建部署)', () => {
    const socket = getSocket('guest_default_check', '测试');
    expect(socket).not.toBeInstanceOf(NativeWebSocketClient);
    resetSocket();
  });

  it('5. 断线触发 disconnect 事件', async () => {
    const client = new NativeWebSocketClient('wss://test.worker/ws/rooms/room-1', 'user-1');
    const disconnectSpy = vi.fn();
    client.on('disconnect', disconnectSpy);

    await new Promise((r) => setTimeout(r, 15));
    client.disconnect();

    expect(disconnectSpy).toHaveBeenCalled();
    expect(client.connected).toBe(false);
  });
});

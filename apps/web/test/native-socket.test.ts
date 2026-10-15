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

  it('4. room:update 与 room:state_updated 互通触发', async () => {
    const client = new NativeWebSocketClient('wss://test.worker/ws/rooms/room-1', 'user-1');
    const updateSpy = vi.fn();
    const stateUpdatedSpy = vi.fn();

    client.on('room:update', updateSpy);
    client.on('room:state_updated', stateUpdatedSpy);

    await new Promise((r) => setTimeout(r, 15));
    const ws = MockNativeWebSocket.instances[0];

    const roomPayload = { roomId: 'r1', title: '测试房' };
    ws.receiveMessage('room:update', roomPayload);

    expect(updateSpy).toHaveBeenCalledWith(roomPayload);
    expect(stateUpdatedSpy).toHaveBeenCalledWith(roomPayload);
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

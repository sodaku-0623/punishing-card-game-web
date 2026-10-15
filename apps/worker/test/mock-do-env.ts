import { createRequire } from 'node:module';
import { Env, WsClientAttachment } from '../src/types.js';
import { createMockD1Database } from './mock-d1.js';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite');

export class MockWebSocket {
  sent: string[] = [];
  attachment: WsClientAttachment | null = null;
  tags: string[] = [];
  readyState = 1; // OPEN

  send(data: string | ArrayBuffer) {
    this.sent.push(typeof data === 'string' ? data : new TextDecoder().decode(data));
  }

  serializeAttachment(att: WsClientAttachment) {
    this.attachment = att;
  }

  deserializeAttachment(): WsClientAttachment | null {
    return this.attachment;
  }

  close() {
    this.readyState = 3; // CLOSED
  }

  getParsedMessages(): { event: string; payload: any }[] {
    return this.sent.map((s) => {
      try {
        return JSON.parse(s);
      } catch {
        return { event: 'raw', payload: s };
      }
    });
  }

  getLastMessage(): { event: string; payload: any } | null {
    const msgs = this.getParsedMessages();
    return msgs[msgs.length - 1] || null;
  }

  findMessages(event: string): { event: string; payload: any }[] {
    return this.getParsedMessages().filter((m) => m.event === event);
  }
}

export function createMockDOContext(sharedDb?: any) {
  const db = sharedDb || new DatabaseSync(':memory:');
  const acceptedSockets: MockWebSocket[] = [];
  let scheduledAlarm: number | null = null;

  const storage = {
    sql: {
      exec: (sql: string, ...params: any[]) => {
        const trimmed = sql.trim();
        // 如果包含多条语句且不带参数
        if (params.length === 0 && (trimmed.includes(';') || trimmed.toUpperCase().startsWith('CREATE'))) {
          db.exec(trimmed);
          return [];
        }

        const normParams = params.map((p) => {
          if (typeof p === 'boolean') return p ? 1 : 0;
          if (p === undefined) return null;
          return p;
        });

        if (trimmed.toUpperCase().startsWith('SELECT')) {
          const stmt = db.prepare(trimmed);
          return stmt.all(...normParams);
        } else {
          const stmt = db.prepare(trimmed);
          stmt.run(...normParams);
          return [];
        }
      },
    },
    setAlarm: async (time: number) => {
      scheduledAlarm = time;
    },
    deleteAlarm: async () => {
      scheduledAlarm = null;
    },
    getAlarm: async () => scheduledAlarm,
  };

  const ctx = {
    id: { toString: () => 'room-do-test-id' },
    storage,
    acceptWebSocket: (serverSocket: MockWebSocket, tags?: string[]) => {
      serverSocket.tags = tags || [];
      acceptedSockets.push(serverSocket);
    },
    getWebSockets: (tag?: string) => {
      if (!tag) return acceptedSockets;
      return acceptedSockets.filter((s) => s.tags.includes(tag));
    },
  } as unknown as DurableObjectState;

  return { ctx, db, acceptedSockets, getScheduledAlarm: () => scheduledAlarm };
}

export function createTestEnv(): Env {
  return {
    DB: createMockD1Database(),
    JWT_SECRET: 'test_super_secret_jwt_key_2026',
    ADMIN_PASSWORD: 'test_admin_pwd_secret',
    ECHO_DO: {} as any,
    ROOM_DO: {} as any,
  };
}

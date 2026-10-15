import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite');

/**
 * 基于 Node.js 内置原生 SQLite 实现的高保真 Cloudflare D1 测试桩
 */
export function createMockD1Database(): D1Database {
  const db = new DatabaseSync(':memory:');

  return {
    prepare: (query: string) => {
      let boundParams: any[] = [];
      const stmt = {
        bind: (...params: any[]) => {
          boundParams = params.map((p) => (typeof p === 'boolean' ? (p ? 1 : 0) : p));
          return stmt;
        },
        first: async <T = unknown>(colName?: string) => {
          try {
            const prepared = db.prepare(query);
            const row = prepared.get(...boundParams) as any;
            if (!row) return null;
            if (colName) return row[colName];
            return row as T;
          } catch (err) {
            return null;
          }
        },
        all: async <T = unknown>() => {
          try {
            const prepared = db.prepare(query);
            const results = prepared.all(...boundParams) as T[];
            return { results, success: true, meta: {} };
          } catch (err) {
            return { results: [], success: false, meta: {} };
          }
        },
        run: async () => {
          const prepared = db.prepare(query);
          const info = prepared.run(...boundParams);
          return {
            success: true,
            meta: {
              changes: Number(info.changes),
              last_row_id: Number(info.lastInsertRowid),
            },
          };
        },
      } as unknown as D1PreparedStatement;
      return stmt;
    },
    batch: async (statements: any[]) => {
      const results = [];
      for (const s of statements) {
        results.push(await s.run());
      }
      return results;
    },
    exec: async (sqlString: string) => {
      db.exec(sqlString);
      return { count: 0, duration: 0 };
    },
    dump: async () => new ArrayBuffer(0),
  } as unknown as D1Database;
}

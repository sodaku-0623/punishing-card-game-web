import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  test: {
    environment: 'node',
    // 端到端测试需要启动本地 workerd 运行时
    testTimeout: 60_000,
    hookTimeout: 120_000,
    alias: {
      'cloudflare:workers': path.resolve(__dirname, 'test/cloudflare-workers-mock.ts'),
    },
  },
});

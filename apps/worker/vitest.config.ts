import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  test: {
    environment: 'node',
    alias: {
      'cloudflare:workers': path.resolve(__dirname, 'test/cloudflare-workers-mock.ts'),
    },
  },
});

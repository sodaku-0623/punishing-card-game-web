import * as dotenv from 'dotenv';
import { createServerApp } from './app.js';

dotenv.config();

const port = Number(process.env.PORT) || 4000;
const host = process.env.HOST || '0.0.0.0';

async function bootstrap() {
  const { fastify } = await createServerApp({
    corsOrigin: process.env.CORS_ORIGIN || '*',
  });

  await fastify.listen({ port, host });
  console.log(`🚀 《战双帕弥什 卡牌对战》权威游戏服务器运行在 http://${host}:${port}`);
}

bootstrap().catch((err) => {
  console.error('服务端启动失败:', err);
  process.exit(1);
});

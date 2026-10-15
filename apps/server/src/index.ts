import * as dotenv from 'dotenv';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createServerApp } from './app.js';

/**
 * 环境变量解析与持久化加载器：
 * 1. 按优先级搜索当前目录、父级目录及项目根目录下的 .env；
 * 2. 若未找到 .env，优先检测 .env.example 并自动初始化为 .env；
 * 3. 严格遵循 AGENTS.md 规范：禁止在源码中硬编码默认密钥；
 *    若环境变量中未配置 JWT_SECRET 或其值为空字符串，自动动态生成 256 位安全随机密钥
 *    并持久化写入 .env 文件，彻底杜绝重启后登录凭据失效与未配置警告。
 */
function loadEnvironment(): void {
  const currentDir = typeof __dirname !== 'undefined' ? __dirname : process.cwd();

  const candidateEnvPaths = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), '../../.env'),
    path.resolve(process.cwd(), '../.env'),
    path.resolve(currentDir, '.env'),
    path.resolve(currentDir, '../.env'),
    path.resolve(currentDir, '../../.env'),
    path.resolve(currentDir, '../../../.env'),
  ];

  let loadedEnvPath: string | null = null;
  for (const envPath of candidateEnvPaths) {
    if (fs.existsSync(envPath)) {
      dotenv.config({ path: envPath });
      loadedEnvPath = envPath;
      break;
    }
  }

  // 若均未找到 .env，尝试依据 .env.example 自动创建 .env 或直接加载 .env.example
  if (!loadedEnvPath) {
    const candidateExamples = [
      path.resolve(process.cwd(), '.env.example'),
      path.resolve(process.cwd(), '../../.env.example'),
      path.resolve(currentDir, '../../../.env.example'),
      path.resolve(currentDir, '../../.env.example'),
      path.resolve(currentDir, '.env.example'),
    ];

    for (const examplePath of candidateExamples) {
      if (fs.existsSync(examplePath)) {
        const targetEnv = path.join(path.dirname(examplePath), '.env');
        try {
          fs.copyFileSync(examplePath, targetEnv);
          dotenv.config({ path: targetEnv });
          loadedEnvPath = targetEnv;
        } catch {
          dotenv.config({ path: examplePath });
          loadedEnvPath = examplePath;
        }
        break;
      }
    }
  }

  if (!loadedEnvPath) {
    dotenv.config();
  }

  // 校验并确保 JWT_SECRET 的有效性与持久性（依据 AGENTS.md 规范安全生成并注入）
  const configuredSecret = process.env.JWT_SECRET?.trim();
  if (!configuredSecret) {
    const autoSecret = crypto.randomBytes(32).toString('hex');
    process.env.JWT_SECRET = autoSecret;

    if (loadedEnvPath && fs.existsSync(loadedEnvPath)) {
      try {
        let content = fs.readFileSync(loadedEnvPath, 'utf8');
        if (/^JWT_SECRET=.*$/m.test(content)) {
          content = content.replace(/^JWT_SECRET=.*$/m, `JWT_SECRET="${autoSecret}"`);
        } else {
          content += `\nJWT_SECRET="${autoSecret}"\n`;
        }
        fs.writeFileSync(loadedEnvPath, content, 'utf8');
        console.log(`ℹ️  检测到 JWT_SECRET 未配置，已自动生成安全密钥并持久化至 ${loadedEnvPath}`);
      } catch {
        // 忽略写入异常，确保进程能基于内存生成的密钥安全运行
      }
    }
  }
}

loadEnvironment();

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

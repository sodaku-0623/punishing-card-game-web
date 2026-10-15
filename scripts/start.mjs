import { spawn, exec, execSync } from 'node:child_process';
import http from 'node:http';
import readline from 'node:readline';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const envPath = path.join(rootDir, '.env');
const envExamplePath = path.join(rootDir, '.env.example');

// 自动检测并初始化 .env 配置文件
if (!fs.existsSync(envPath) && fs.existsSync(envExamplePath)) {
  fs.copyFileSync(envExamplePath, envPath);
  console.log('\x1b[33m%s\x1b[0m', '>>> [配置检测] 未检测到 .env 配置文件，已自动根据 .env.example 生成 .env');
}

// 解析 .env 注入 process.env，确保子进程完整继承环境变量
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  for (const line of envContent.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([^=]+)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      let val = match[2].trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      // 本地启动器中前端与后端同源访问 (经 Next.js /api 反代与 4000 端口直连)，
      // 不注入 NEXT_PUBLIC_*：否则外网穿透访问的玩家会被指向他们自己电脑上的 localhost
      if (key.startsWith('NEXT_PUBLIC_')) continue;
      if (!process.env[key]) {
        process.env[key] = val;
      }
    }
  }
}

// 严格遵循 AGENTS.md 规范：若 JWT_SECRET 未配置或为空，自动生成高强度安全随机密钥并持久化保存
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.trim() === '') {
  const generatedSecret = crypto.randomBytes(32).toString('hex');
  process.env.JWT_SECRET = generatedSecret;
  if (fs.existsSync(envPath)) {
    try {
      let content = fs.readFileSync(envPath, 'utf8');
      if (/^JWT_SECRET=.*$/m.test(content)) {
        content = content.replace(/^JWT_SECRET=.*$/m, `JWT_SECRET="${generatedSecret}"`);
      } else {
        content += `\nJWT_SECRET="${generatedSecret}"\n`;
      }
      fs.writeFileSync(envPath, content, 'utf8');
      console.log('\x1b[32m%s\x1b[0m', '>>> [安全配置] 已自动生成高强度随机 JWT_SECRET 并持久化保存至 .env 配置文件');
    } catch {}
  }
}

const SERVER_PORT = 4000;
const WEB_PORT = 3000;
const HEALTH_URL = `http://127.0.0.1:${SERVER_PORT}/health`;
const WEB_URL = `http://127.0.0.1:${WEB_PORT}`;

console.log('\x1b[36m%s\x1b[0m', '======================================================================');
console.log('\x1b[36m%s\x1b[0m', '   《战双帕弥什 卡牌对战》 权威在线对战平台 - 一键启动器');
console.log('\x1b[36m%s\x1b[0m', '======================================================================');

const isWin = process.platform === 'win32';
const npmCmd = isWin ? 'npm.cmd' : 'npm';

let serverProc = null;
let webProc = null;
let isShuttingDown = false;
let browserOpened = false;

function killProcess(proc) {
  if (!proc || !proc.pid) return;
  try {
    if (isWin) {
      execSync(`taskkill /pid ${proc.pid} /T /F`, { stdio: 'ignore' });
    } else {
      process.kill(-proc.pid, 'SIGTERM');
    }
  } catch (err) {
    // Process already exited or cannot be killed
  }
}

function cleanup() {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log('\n\x1b[33m%s\x1b[0m', '>>> 正在安全停止所有服务，释放端口...');
  killProcess(serverProc);
  killProcess(webProc);
  console.log('\x1b[32m%s\x1b[0m', '>>> 服务已全部安全关闭。再见，指挥官！');
  process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
process.on('exit', () => {
  killProcess(serverProc);
  killProcess(webProc);
});

// 检查 HTTP 服务是否可用
function checkHttpReady(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      if (res.statusCode && res.statusCode >= 200 && res.statusCode < 400) {
        resolve(true);
      } else {
        resolve(false);
      }
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

// 自动打开浏览器
function openBrowser(url) {
  if (browserOpened) return;
  browserOpened = true;
  console.log('\x1b[32m%s\x1b[0m', `>>> [自动打开浏览器] 正在为您打开对战平台: ${url}`);
  try {
    if (isWin) {
      exec(`start ${url}`);
    } else if (process.platform === 'darwin') {
      exec(`open ${url}`);
    } else {
      exec(`xdg-open ${url}`);
    }
  } catch (err) {
    console.warn('打开浏览器失败，请手动在浏览器输入访问:', url);
  }
}

// 1. 启动后端权威服务器
console.log('\x1b[34m%s\x1b[0m', `[1/3] 正在启动后端权威服务器 (端口: ${SERVER_PORT})...`);
serverProc = spawn(npmCmd, ['run', 'dev:server'], {
  stdio: ['inherit', 'pipe', 'pipe'],
  shell: isWin,
  env: { ...process.env },
});

const rlServer = readline.createInterface({ input: serverProc.stdout });
rlServer.on('line', (line) => {
  console.log('\x1b[35m[后端]\x1b[0m', line);
});

const rlServerErr = readline.createInterface({ input: serverProc.stderr });
rlServerErr.on('line', (line) => {
  console.error('\x1b[31m[后端错误]\x1b[0m', line);
});

// 2. 启动前端 Next.js 平台
console.log('\x1b[34m%s\x1b[0m', `[2/3] 正在启动前端 Next.js 平台 (端口: ${WEB_PORT})...`);
webProc = spawn(npmCmd, ['run', 'dev:web'], {
  stdio: ['inherit', 'pipe', 'pipe'],
  shell: isWin,
  env: { ...process.env },
});

const rlWeb = readline.createInterface({ input: webProc.stdout });
rlWeb.on('line', (line) => {
  console.log('\x1b[36m[前端]\x1b[0m', line);
});

const rlWebErr = readline.createInterface({ input: webProc.stderr });
rlWebErr.on('line', (line) => {
  console.error('\x1b[33m[前端提示]\x1b[0m', line);
});

// 3. 轮询健康检测并在就绪后打开页面
console.log('\x1b[34m%s\x1b[0m', `[3/3] 正在等待服务端与前端页面编译就绪...`);

let attempts = 0;
const maxAttempts = 60; // 最多轮询 60 秒
let serverReady = false;
let webReady = false;

const timer = setInterval(async () => {
  attempts++;
  if (!serverReady) {
    serverReady = await checkHttpReady(HEALTH_URL);
    if (serverReady) {
      console.log('\x1b[32m%s\x1b[0m', `>>> [就绪] 权威对战服务器运行正常 (http://localhost:${SERVER_PORT})`);
    }
  }

  if (!webReady) {
    webReady = await checkHttpReady(WEB_URL);
    if (webReady) {
      console.log('\x1b[32m%s\x1b[0m', `>>> [就绪] Next.js 前端平台已就绪 (http://localhost:${WEB_PORT})`);
    }
  }

  if (serverReady && webReady) {
    clearInterval(timer);
    console.log('\n\x1b[32m%s\x1b[0m', '======================================================================');
    console.log('\x1b[32m%s\x1b[0m', '   🎉 《战双帕弥什 卡牌对战》全平台已成功启动！');
    console.log('\x1b[32m%s\x1b[0m', `   🌐 前端对战地址: http://localhost:${WEB_PORT}`);
    console.log('\x1b[32m%s\x1b[0m', `   ⚡ 权威后端地址: http://localhost:${SERVER_PORT}`);
    console.log('\x1b[32m%s\x1b[0m', '   💡 按 Ctrl+C 即可一键安全停止所有服务并释放端口');
    console.log('\x1b[32m%s\x1b[0m', '======================================================================\n');
    openBrowser(`http://localhost:${WEB_PORT}`);
  } else if (attempts >= maxAttempts) {
    clearInterval(timer);
    console.warn('\x1b[33m%s\x1b[0m', '服务启动检测超时，请检查控制台上方输出是否有报错。');
  }
}, 1000);

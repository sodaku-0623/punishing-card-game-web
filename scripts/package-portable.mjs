import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const ROOT_DIR = process.cwd();
const RELEASE_BASE = path.join(ROOT_DIR, 'release');
const DIST_FOLDER_NAME = '战双帕弥什-卡牌对战-Windows便携版';
const TARGET_DIR = path.join(RELEASE_BASE, DIST_FOLDER_NAME);
const ZIP_FILE_NAME = `${DIST_FOLDER_NAME}.zip`;
const ZIP_PATH = path.join(RELEASE_BASE, ZIP_FILE_NAME);

console.log('======================================================================');
console.log('  正在打包《战双帕弥什 卡牌对战》Windows 便携免安装版...');
console.log('======================================================================');

// 1. 构建后端单文件 Bundle
console.log('\n[1/6] 正在通过 esbuild 打包后端权威服务器为独立单文件 (server.bundle.cjs)...');
fs.mkdirSync(path.join(ROOT_DIR, 'apps/server/dist'), { recursive: true });
execSync(
  'npx esbuild apps/server/src/index.ts --bundle --platform=node --target=node20 --outfile=apps/server/dist/server.bundle.cjs',
  { cwd: ROOT_DIR, stdio: 'inherit' }
);

// 确保卡牌轻量缩略图已生成
const thumbsDir = path.join(ROOT_DIR, 'apps/web/public/cards/thumbs');
if (!fs.existsSync(thumbsDir) || fs.readdirSync(thumbsDir).length < 100) {
  console.log('\n[*] 正在批量生成轻量化卡牌缩略图以优化弱网环境访问体验...');
  try {
    execSync('powershell -ExecutionPolicy Bypass -File scripts/generate-thumbnails.ps1', {
      cwd: ROOT_DIR,
      stdio: 'inherit',
    });
  } catch (err) {
    console.warn('! 缩略图生成提示:', err.message);
  }
}

// 2. 准备 Next.js Standalone 静态资源与卡图扫描件
console.log('\n[2/6] 正在拷贝前端静态资源、编译代码与高清卡图到 Standalone 目录...');
const standaloneAppDir = path.join(ROOT_DIR, 'apps/web/.next/standalone/apps/web');
fs.mkdirSync(standaloneAppDir, { recursive: true });
fs.cpSync(path.join(ROOT_DIR, 'apps/web/public'), path.join(standaloneAppDir, 'public'), { recursive: true });
fs.cpSync(path.join(ROOT_DIR, 'apps/web/.next/static'), path.join(standaloneAppDir, '.next/static'), { recursive: true });

// 3. 创建发布输出目录结构
console.log('\n[3/6] 正在创建便携发布包目录结构...');
if (fs.existsSync(TARGET_DIR)) {
  fs.rmSync(TARGET_DIR, { recursive: true, force: true });
}
fs.mkdirSync(path.join(TARGET_DIR, 'server'), { recursive: true });
fs.mkdirSync(path.join(TARGET_DIR, 'runtime'), { recursive: true });

// 4. 拷贝组件与便携运行时
console.log('\n[4/6] 正在复制后端、前端独立包及 Node.js 便携运行时...');
// 复制后端
fs.copyFileSync(
  path.join(ROOT_DIR, 'apps/server/dist/server.bundle.cjs'),
  path.join(TARGET_DIR, 'server/server.bundle.cjs')
);

// 复制前端 Standalone
fs.cpSync(path.join(ROOT_DIR, 'apps/web/.next/standalone'), path.join(TARGET_DIR, 'web'), { recursive: true });

// 复制环境配置文件
const rootEnvPath = path.join(ROOT_DIR, '.env');
const rootEnvExamplePath = path.join(ROOT_DIR, '.env.example');
if (fs.existsSync(rootEnvPath)) {
  fs.copyFileSync(rootEnvPath, path.join(TARGET_DIR, '.env'));
} else if (fs.existsSync(rootEnvExamplePath)) {
  fs.copyFileSync(rootEnvExamplePath, path.join(TARGET_DIR, '.env'));
}
if (fs.existsSync(rootEnvExamplePath)) {
  fs.copyFileSync(rootEnvExamplePath, path.join(TARGET_DIR, '.env.example'));
}

// 拷贝 Node.js 便携式主执行文件 (保证解压机无需安装 Node 环境)
const systemNodePath = 'C:\\Program Files\\nodejs\\node.exe';
if (fs.existsSync(systemNodePath)) {
  fs.copyFileSync(systemNodePath, path.join(TARGET_DIR, 'runtime/node.exe'));
  console.log('✓ 成功嵌入 Node.js 便携执行环境 (runtime/node.exe)');
} else {
  console.warn('! 未找到 C:\\Program Files\\nodejs\\node.exe，将依赖解压机自身的 node 环境');
}

// 5. 生成启动控制脚本与批处理文件
console.log('\n[5/6] 正在生成一键启动批处理与进程调度程序...');

// 便携版 start.js
const portableStartJs = `const { spawn, exec, execSync } = require('child_process');
const http = require('http');
const net = require('net');
const path = require('path');
const readline = require('readline');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');

// 读取并注入 .env 环境变量，保证 JWT_SECRET 等关键配置稳定持久生效
const envFile = path.join(__dirname, '.env');
const envExampleFile = path.join(__dirname, '.env.example');
if (!fs.existsSync(envFile) && fs.existsSync(envExampleFile)) {
  try { fs.copyFileSync(envExampleFile, envFile); } catch (e) {}
}
if (fs.existsSync(envFile)) {
  try {
    const envLines = fs.readFileSync(envFile, 'utf8').split(/\\r?\\n/);
    for (const line of envLines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const match = trimmed.match(/^([^=]+)=(.*)$/);
      if (match) {
        const key = match[1].trim();
        let val = match[2].trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  } catch (e) {}
}

// 确保 JWT_SECRET 存在且有效，若未配置则自动生成随机密钥并持久化保存
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.trim() === '') {
  const generatedSecret = crypto.randomBytes(32).toString('hex');
  process.env.JWT_SECRET = generatedSecret;
  if (fs.existsSync(envFile)) {
    try {
      let content = fs.readFileSync(envFile, 'utf8');
      if (/^JWT_SECRET=.*$/m.test(content)) {
        content = content.replace(/^JWT_SECRET=.*$/m, 'JWT_SECRET="' + generatedSecret + '"');
      } else {
        content += '\\nJWT_SECRET="' + generatedSecret + '"\\n';
      }
      fs.writeFileSync(envFile, content, 'utf8');
    } catch (e) {}
  }
}

// 统一对外网关端口 (默认 3000，所有外网穿透、局域网、本机访问均连接此单一端口)
const GATEWAY_PORT = parseInt(process.env.PORT, 10) || 3000;
// Next.js 内部独立服务端口
const WEB_INTERNAL_PORT = 3001;
// 权威后端与实时对战服务端口
const SERVER_PORT = 4000;

const HEALTH_URL = 'http://127.0.0.1:' + SERVER_PORT + '/health';
const WEB_URL = 'http://127.0.0.1:' + WEB_INTERNAL_PORT;

console.log('\\x1b[36m%s\\x1b[0m', '======================================================================');
console.log('\\x1b[36m%s\\x1b[0m', '   《战双帕弥什 卡牌对战》 Windows 便携免安装版 - 一键启动器');
console.log('\\x1b[36m%s\\x1b[0m', '======================================================================');

const isWin = process.platform === 'win32';
const runtimeNode = path.join(__dirname, 'runtime', 'node.exe');
const nodeBin = fs.existsSync(runtimeNode) ? runtimeNode : 'node';

let serverProc = null;
let webProc = null;
let gatewayServer = null;
let isShuttingDown = false;
let browserOpened = false;

function killProcess(proc) {
  if (!proc || !proc.pid) return;
  try {
    if (isWin) {
      execSync('taskkill /pid ' + proc.pid + ' /T /F', { stdio: 'ignore' });
    } else {
      process.kill(-proc.pid, 'SIGTERM');
    }
  } catch (err) {}
}

function cleanup() {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log('\\n\\x1b[33m%s\\x1b[0m', '>>> 正在安全停止对战平台服务...');
  if (gatewayServer) {
    try { gatewayServer.close(); } catch (e) {}
  }
  killProcess(serverProc);
  killProcess(webProc);
  console.log('\\x1b[32m%s\\x1b[0m', '>>> 服务已全部安全停止。再见，指挥官！');
  process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
process.on('exit', () => {
  if (gatewayServer) {
    try { gatewayServer.close(); } catch (e) {}
  }
  killProcess(serverProc);
  killProcess(webProc);
});

function getLocalIps() {
  const interfaces = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        ips.push(iface.address);
      }
    }
  }
  return ips;
}

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

function openBrowser(url) {
  if (browserOpened) return;
  browserOpened = true;
  console.log('\\x1b[32m%s\\x1b[0m', '>>> [自动打开浏览器] 正在为您打开对战平台: ' + url);
  try {
    if (isWin) {
      exec('start ' + url);
    } else if (process.platform === 'darwin') {
      exec('open ' + url);
    } else {
      exec('xdg-open ' + url);
    }
  } catch (err) {
    console.warn('打开浏览器失败，请手动在浏览器访问:', url);
  }
}

// 统一 HTTP + WebSocket 网关 (使外部访问、穿透仅需暴露单端口)
function startGateway() {
  gatewayServer = http.createServer((clientReq, clientRes) => {
    const url = clientReq.url || '/';
    const isBackend = url.startsWith('/api/') || url.startsWith('/socket.io/');
    const targetPort = isBackend ? SERVER_PORT : WEB_INTERNAL_PORT;

    const proxyReq = http.request({
      hostname: '127.0.0.1',
      port: targetPort,
      path: url,
      method: clientReq.method,
      headers: {
        ...clientReq.headers,
        'x-forwarded-for': clientReq.socket.remoteAddress || '',
        'x-forwarded-host': clientReq.headers.host || '',
        'x-forwarded-proto': clientReq.headers['x-forwarded-proto'] || 'http',
      },
    }, (proxyRes) => {
      clientRes.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(clientRes);
    });

    proxyReq.on('error', () => {
      if (!clientRes.headersSent) {
        clientRes.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
        clientRes.end(JSON.stringify({
          success: false,
          error: '服务网关正在启动或内部服务暂未就绪，请稍后刷新重试',
        }));
      }
    });

    clientReq.pipe(proxyReq);
  });

  // 处理 WebSocket 协议升级 (支持实时对战长连接)
  gatewayServer.on('upgrade', (clientReq, clientSocket, clientHead) => {
    const url = clientReq.url || '/';
    const isBackend = url.startsWith('/socket.io/') || url.startsWith('/api/');
    const targetPort = isBackend ? SERVER_PORT : WEB_INTERNAL_PORT;

    const proxySocket = net.connect(targetPort, '127.0.0.1', () => {
      let rawHeaders = clientReq.method + ' ' + clientReq.url + ' HTTP/' + clientReq.httpVersion + '\\r\\n';
      for (let i = 0; i < clientReq.rawHeaders.length; i += 2) {
        rawHeaders += clientReq.rawHeaders[i] + ': ' + clientReq.rawHeaders[i + 1] + '\\r\\n';
      }
      rawHeaders += '\\r\\n';

      proxySocket.write(rawHeaders);
      if (clientHead && clientHead.length > 0) {
        proxySocket.write(clientHead);
      }
      clientSocket.pipe(proxySocket);
      proxySocket.pipe(clientSocket);
    });

    proxySocket.on('error', () => {
      clientSocket.destroy();
    });
    clientSocket.on('error', () => {
      proxySocket.destroy();
    });
  });

  gatewayServer.listen(GATEWAY_PORT, '0.0.0.0', () => {
    console.log('\\x1b[32m%s\\x1b[0m', '>>> [网关就绪] 统一流量调度网关已监听 0.0.0.0:' + GATEWAY_PORT);
  });
}

// 1. 启动权威服务器 (端口: 4000)
console.log('\\x1b[34m%s\\x1b[0m', '[1/3] 正在启动后端权威对战服务器 (端口: ' + SERVER_PORT + ')...');
serverProc = spawn(nodeBin, [path.join(__dirname, 'server', 'server.bundle.cjs')], {
  cwd: __dirname,
  env: Object.assign({}, process.env),
  stdio: ['inherit', 'pipe', 'pipe'],
});

readline.createInterface({ input: serverProc.stdout }).on('line', (line) => {
  console.log('\\x1b[35m[后端]\\x1b[0m', line);
});
readline.createInterface({ input: serverProc.stderr }).on('line', (line) => {
  console.error('\\x1b[31m[后端错误]\\x1b[0m', line);
});

// 2. 启动前端平台 (内部端口: 3001)
console.log('\\x1b[34m%s\\x1b[0m', '[2/3] 正在启动 Next.js 前端平台 (内部端口: ' + WEB_INTERNAL_PORT + ')...');
webProc = spawn(nodeBin, [path.join(__dirname, 'web', 'apps', 'web', 'server.js')], {
  cwd: path.join(__dirname, 'web'),
  env: Object.assign({}, process.env, { PORT: String(WEB_INTERNAL_PORT), HOSTNAME: '127.0.0.1' }),
  stdio: ['inherit', 'pipe', 'pipe'],
});

readline.createInterface({ input: webProc.stdout }).on('line', (line) => {
  console.log('\\x1b[36m[前端]\\x1b[0m', line);
});
readline.createInterface({ input: webProc.stderr }).on('line', (line) => {
  console.error('\\x1b[33m[前端提示]\\x1b[0m', line);
});

// 3. 轮询健康检测并在就绪后启动网关与自动打开页面
console.log('\\x1b[34m%s\\x1b[0m', '[3/3] 正在等待内部服务就绪...');

let attempts = 0;
const maxAttempts = 60;
let serverReady = false;
let webReady = false;

const timer = setInterval(async () => {
  attempts++;
  if (!serverReady) {
    serverReady = await checkHttpReady(HEALTH_URL);
    if (serverReady) {
      console.log('\\x1b[32m%s\\x1b[0m', '>>> [就绪] 权威对战服务器运行正常 (http://127.0.0.1:' + SERVER_PORT + ')');
    }
  }

  if (!webReady) {
    webReady = await checkHttpReady(WEB_URL);
    if (webReady) {
      console.log('\\x1b[32m%s\\x1b[0m', '>>> [就绪] Next.js 前端平台已就绪 (http://127.0.0.1:' + WEB_INTERNAL_PORT + ')');
    }
  }

  if (serverReady && webReady) {
    clearInterval(timer);
    startGateway();
    const localIps = getLocalIps();
    console.log('\\n\\x1b[32m%s\\x1b[0m', '======================================================================');
    console.log('\\x1b[32m%s\\x1b[0m', '   🎉 《战双帕弥什 卡牌对战》便携版已成功启动！');
    console.log('\\x1b[32m%s\\x1b[0m', '   🌐 本机访问地址: http://localhost:' + GATEWAY_PORT);
    if (localIps.length > 0) {
      console.log('\\x1b[32m%s\\x1b[0m', '   🏠 局域网访问地址: ' + localIps.map(ip => 'http://' + ip + ':' + GATEWAY_PORT).join('  |  '));
    }
    console.log('\\x1b[36m%s\\x1b[0m', '   🚀 外网穿透联机说明:');
    console.log('\\x1b[36m%s\\x1b[0m', '      只需将穿透工具（如 cpolar / frp / ngrok 等）的目标端口映射至 ' + GATEWAY_PORT);
    console.log('\\x1b[36m%s\\x1b[0m', '      外网用户直接访问获得的网址即可游玩，无需额外映射 4000 端口！');
    console.log('\\x1b[32m%s\\x1b[0m', '   💡 按 Ctrl+C 即可一键安全停止所有服务并释放端口');
    console.log('\\x1b[32m%s\\x1b[0m', '======================================================================\\n');
    openBrowser('http://localhost:' + GATEWAY_PORT);
  } else if (attempts >= maxAttempts) {
    clearInterval(timer);
    console.warn('\\x1b[33m%s\\x1b[0m', '服务启动检测超时，请检查控制台是否有报错。');
  }
}, 1000);
`;

fs.writeFileSync(path.join(TARGET_DIR, 'start.js'), portableStartJs, 'utf8');

// 批处理文件 (严格 CRLF 与纯 ASCII 命令防解析闪退)
const batContent = `@echo off
cd /d "%~dp0"
title 《战双帕弥什 卡牌对战》便携免安装版

if exist "%~dp0runtime\\node.exe" (
    set "NODE_BIN=%~dp0runtime\\node.exe"
) else (
    set "NODE_BIN=node"
)

"%NODE_BIN%" "%~dp0start.js"

if %errorlevel% neq 0 (
    echo.
    echo [提示] 对战平台已退出 (代码: %errorlevel%)。
    pause
)
`;
fs.writeFileSync(path.join(TARGET_DIR, '双击启动对战平台.bat'), batContent.replace(/\r?\n/g, '\r\n'), 'ascii');

// 使用说明文档
const readmeContent = `======================================================================
  《战双帕弥什 卡牌对战》 Windows 便携免安装版 - 使用说明
======================================================================

【版本特性】
1. 本程序已内置便携运行时环境与官方全套扫描卡图（54张高清单卡）。
2. 解压即可直接运行，无需安装 Node.js、无需运行 npm、无需安装数据库！
3. 内置统一流量网关，完美支持局域网联机与外网穿透：其他访问者直接打开网址即可流畅注册、登录并实时对战！
4. 全新身份认证与指挥官个人档案系统：支持玩家注册登录、自定义代号、管理员后台鉴权防护！

【外网穿透与跨端联机说明】
- 服务电脑部署与外网穿透：
  * 只需将穿透工具（如 cpolar / frp / ngrok / natfrp / cloudflared 等）的目标端口映射至【3000】端口！
  * 启动器已内置统一流量调度网关，自动在 3000 端口上整合网页界面、REST API 认证接口与 WebSocket 实时长连接。
  * 外网用户（工作电脑、手机、好友电脑等）直接访问穿透获得的网址即可，无需额外暴露或映射 4000 端口！
- 局域网联机：
  * 同一局域网内的设备直接在浏览器输入控制台打印的局域网 IP（例如 http://192.168.x.x:3000）即可直接加入对战。

【账号与登录说明】
- 平台已开启身份验证与权限分级体系，杜绝了后台无密直入的安全风险：
  * 普通玩家：随时可点击【指挥官登录 / 注册】注册全新作战档案，亦可一键填入预设账号 (账号: player1 / 密码: 123456)。
  * 指挥官代号：登录后在首页随时点击昵称旁的编辑按钮，即可自定义个性化指挥官名称并在全服对战中向所有对手展示。
  * 管理员后台：使用系统管理员账号 (账号: admin / 密码: admin888) 登录后，顶部导航自动开启【管理控制台】入口，并授予卡牌全量运维编辑权限。

【启动方法】
- 直接双击文件夹内的【双击启动对战平台.bat】。
- 启动器将自动启动权威后端、前端与网关，并在服务就绪后自动为您弹出浏览器打开对战主页。

【退出方法】
- 在弹出的控制台窗口中按下【Ctrl + C】，系统将自动级联释放所有端口并安全退出。

【主要功能模块】
1. 身份认证与个人档案 (/login): 注册、登录、自定义战术昵称、JWT 安全鉴权。
2. 对战大厅 (/rooms): 随机 6 位 Room ID、按 ID 搜房加入、双人准备室、选择官方预组。
3. 实时对战 (/game/[id]): 权威服务器全仲裁、抽牌、信号球多消三消、攻防结算、时机让出与胜负判定。
4. 卡组构筑 (/decks): 5.1 规则实时合法性校验、50张卡牌与12颗信号球配额、费用曲线、上下滚动卡牌列表、边框贴合卡图。
5. 卡牌图鉴 (/cards): 官方高清原画展示、R1/R2 烫金形态切换、全屏放大检视、同名机体晋升链。
6. 对局回放 (/history & /replay/[id]): 历史对战记录审计、确定性步进回放、播放速度调节。
7. 后台管理与运维 (/admin & /admin/cards): RBAC 权限隔离、全量卡牌在线修改与勘误、版本快照追踪。

祝您对战愉快，指挥官！
`;
fs.writeFileSync(path.join(TARGET_DIR, '使用说明.txt'), readmeContent.replace(/\r?\n/g, '\r\n'), 'utf8');

// 6. 打包为 ZIP 压缩文件
console.log('\n[6/6] 正在压缩为免安装绿色 ZIP 归档包 (这可能需要十几秒，请稍候)...');
if (fs.existsSync(ZIP_PATH)) {
  fs.rmSync(ZIP_PATH);
}

try {
  execSync('tar -a -cf "' + ZIP_FILE_NAME + '" "' + DIST_FOLDER_NAME + '"', {
    cwd: RELEASE_BASE,
    stdio: 'inherit',
  });
  const zipStats = fs.statSync(ZIP_PATH);
  console.log('\\n======================================================================');
  console.log('  🎉 便携免安装版打包圆满成功！');
  console.log('  📦 输出文件: ' + ZIP_PATH);
  console.log('  📊 压缩包体积: ' + (zipStats.size / 1024 / 1024).toFixed(2) + ' MB');
  console.log('  📁 便携目录: ' + TARGET_DIR);
  console.log('======================================================================\\n');
} catch (err) {
  console.error('ZIP 压缩失败，但便携目录已经生成就绪:', TARGET_DIR, err);
}

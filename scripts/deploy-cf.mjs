/**
 * Cloudflare 版一键部署 (可重复执行：首次部署与日常更新都用它)。
 *
 * 用法 (仓库根目录，Windows / macOS / Linux 通用)：
 *   npx wrangler login                                   # 首次使用前登录一次 Cloudflare
 *   npm run deploy:cf -- --card-cdn https://cards.example.com
 *
 * 可选参数：
 *   --card-cdn <url>   R2 卡图公开域名 (也可用环境变量 NEXT_PUBLIC_CARD_CDN)，必填
 *   --domain <host>    已绑定的自定义域名，部署后用它做健康检查 (如 game.example.com)
 *   --skip-build       跳过构建，直接发布上一次的构建产物
 *   --dry-run          只构建并检查打包结果，不修改 Cloudflare 上的任何资源
 *
 * 脚本会依次：检查登录 → 确保 D1 数据库存在并与 wrangler.toml 一致 → 建表 (幂等) →
 * 构建前端与各包 → 确保 JWT_SECRET / ADMIN_PASSWORD 已配置 (缺失时随机生成) → 发布 Worker → 健康检查。
 */
import { execSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workerDir = path.join(repoRoot, 'apps/worker');
const wranglerToml = path.join(workerDir, 'wrangler.toml');
const DB_NAME = 'zhanshuang_tcg';

// ---------------- 参数 ----------------
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : undefined;
};
const dryRun = flag('dry-run');
const skipBuild = flag('skip-build');
const domain = option('domain')?.replace(/^https?:\/\//, '').replace(/\/$/, '');
const cardCdn = (option('card-cdn') || process.env.NEXT_PUBLIC_CARD_CDN || '').trim().replace(/\/$/, '');

// ---------------- 工具 ----------------
const step = (n, text) => console.log(`\n\x1b[36m[${n}] ${text}\x1b[0m`);
const ok = (text) => console.log(`\x1b[32m  ✔ ${text}\x1b[0m`);
const warn = (text) => console.log(`\x1b[33m  ⚠ ${text}\x1b[0m`);
function fail(text) {
  console.error(`\n\x1b[31m✘ ${text}\x1b[0m`);
  process.exit(1);
}

/** 在 apps/worker 下执行 wrangler，返回 stdout；失败时返回 null (quiet) 或直接退出 */
function wrangler(cmd, { quiet = false, input } = {}) {
  try {
    return execSync(`npx wrangler ${cmd}`, {
      cwd: workerDir,
      encoding: 'utf8',
      input,
      stdio: [input === undefined ? 'inherit' : 'pipe', 'pipe', quiet ? 'pipe' : 'inherit'],
      env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
    });
  } catch (err) {
    if (quiet) return null;
    fail(`命令执行失败: wrangler ${cmd}\n${err.stdout || ''}`);
  }
}

function run(cmd, env = {}) {
  execSync(cmd, { cwd: repoRoot, stdio: 'inherit', env: { ...process.env, ...env } });
}

function parseJson(text) {
  if (!text) return null;
  const start = text.search(/[[{]/);
  try {
    return start >= 0 ? JSON.parse(text.slice(start)) : null;
  } catch {
    return null;
  }
}

/** 把 wrangler.toml 中 zhanshuang_tcg 的 database_id 更新为指定值 */
function setDatabaseId(toml, id) {
  return toml.replace(
    /(database_name\s*=\s*"zhanshuang_tcg"\s*\r?\n\s*database_id\s*=\s*")[^"]*(")/,
    `$1${id}$2`
  );
}

// ---------------- 0. 前置检查 ----------------
console.log('\x1b[36m%s\x1b[0m', '=== 《战双帕弥什 卡牌对战》Cloudflare 一键部署 ===');
if (dryRun) warn('dry-run 模式：只构建与检查，不修改 Cloudflare 上的任何资源');
if (!cardCdn) {
  fail('请通过 --card-cdn 指定 R2 卡图公开域名 (例如 --card-cdn https://cards.example.com)。\n  卡图约 3GB，不应随 Worker 一起上传。');
}

if (!dryRun) {
  step(1, '检查 Cloudflare 登录状态');
  const who = parseJson(wrangler('whoami --json', { quiet: true }));
  if (!who) fail('尚未登录 Cloudflare，请先运行: npx wrangler login');
  ok(`已登录: ${who.email || who.accounts?.[0]?.name || 'Cloudflare 账号'}`);

  // ---------------- 2. D1 数据库 ----------------
  step(2, `确保 D1 数据库 ${DB_NAME} 存在`);
  const list = parseJson(wrangler('d1 list --json', { quiet: true })) || [];
  let db = list.find((d) => d.name === DB_NAME);
  if (!db) {
    console.log(`  未找到 ${DB_NAME}，正在创建…`);
    const out = wrangler(`d1 create ${DB_NAME}`, { quiet: true }) || '';
    const id = out.match(/"?database_id"?\s*[:=]\s*"([0-9a-f-]{36})"/i)?.[1];
    if (!id) fail(`创建 D1 数据库失败，wrangler 输出：\n${out}`);
    db = { uuid: id, name: DB_NAME };
    ok(`已创建 D1 数据库 (${id})`);
  } else {
    ok(`已存在 (${db.uuid})`);
  }
  const toml = fs.readFileSync(wranglerToml, 'utf8');
  if (!toml.includes(db.uuid)) {
    fs.writeFileSync(wranglerToml, setDatabaseId(toml, db.uuid));
    warn(`已把 apps/worker/wrangler.toml 中的 database_id 更新为 ${db.uuid}，请把这处改动提交到仓库`);
  }

  step(3, '初始化 D1 表结构 (CREATE TABLE IF NOT EXISTS，可重复执行)');
  wrangler(`d1 execute ${DB_NAME} --remote --file=schema.sql`, { input: '' });
  ok('表结构已就绪');
}

// ---------------- 4. 构建 ----------------
if (!skipBuild) {
  step(4, '构建各包与前端静态资源');
  run('npm run build');
  run('npm run build:cf-static', { NEXT_PUBLIC_CARD_CDN: cardCdn });
  ok('构建完成');
} else {
  warn('已跳过构建，将发布 apps/worker/static 中上一次的产物');
}

if (dryRun) {
  step(5, '检查 Worker 打包结果 (wrangler deploy --dry-run)');
  process.stdout.write(wrangler('deploy --dry-run --outdir .wrangler/dry-run') || '');
  ok('dry-run 完成，未上传任何内容');
  process.exit(0);
}

// ---------------- 5. 密钥 ----------------
step(5, '检查 JWT_SECRET / ADMIN_PASSWORD');
const secretNames = new Set(
  (parseJson(wrangler('secret list --format json', { quiet: true })) || []).map((s) => s.name)
);
const workerExists = secretNames.size > 0 || wrangler('deployments list', { quiet: true }) !== null;
let generatedAdminPassword = null;

function putSecret(name, value) {
  wrangler(`secret put ${name}`, { input: `${value}\n` });
  ok(`${name} 已写入`);
}

function ensureSecrets() {
  if (secretNames.has('JWT_SECRET')) ok('JWT_SECRET 已配置');
  else putSecret('JWT_SECRET', crypto.randomBytes(32).toString('hex'));
  if (secretNames.has('ADMIN_PASSWORD')) ok('ADMIN_PASSWORD 已配置');
  else {
    generatedAdminPassword = crypto.randomBytes(12).toString('base64url');
    putSecret('ADMIN_PASSWORD', generatedAdminPassword);
  }
}

// Worker 已存在时先写密钥再发布，避免新版本在没有密钥的情况下上线
if (workerExists) ensureSecrets();

// ---------------- 6. 发布 ----------------
step(6, '发布 Worker (前端静态资源 + API + Durable Objects)');
const deployOut = wrangler('deploy', { input: '' }) || '';
process.stdout.write(deployOut);
const workersDevUrl = deployOut.match(/https:\/\/[\w.-]+\.workers\.dev/)?.[0];
ok('发布完成');

if (!workerExists) ensureSecrets();

// ---------------- 7. 健康检查 ----------------
step(7, '健康检查');
const base = domain ? `https://${domain}` : workersDevUrl;
if (!base) {
  warn('未能获取访问地址，请在 Cloudflare 控制台确认部署状态');
} else {
  try {
    const health = await fetch(`${base}/health`).then((r) => r.json());
    const cards = await fetch(`${base}/api/cards?take=1`).then((r) => r.json());
    if (health.status === 'ok' && cards.success) ok(`${base} 运行正常 (卡牌总数 ${cards.total})`);
    else warn(`${base} 返回异常，请检查 Worker 日志: npx wrangler tail`);
  } catch (err) {
    warn(`无法访问 ${base}：${err.message}。若在国内网络下访问 workers.dev，失败属正常现象，请用自定义域名检查。`);
  }
}

console.log('\n\x1b[32m=== 部署完成 ===\x1b[0m');
if (generatedAdminPassword) {
  console.log('\n\x1b[33m管理员账号已生成，请立即妥善保存 (只显示这一次)：\x1b[0m');
  console.log(`  用户名: admin\n  密码:   ${generatedAdminPassword}`);
}
if (!domain) {
  console.log('\n下一步：在 Cloudflare 控制台为 Worker 绑定自定义域名 (国内无法稳定访问 workers.dev)：');
  console.log('  Workers & Pages → zhanshuang-worker → 设置 → 域与路由 → 添加 → 自定义域');
  console.log('  绑定后可用 --domain <域名> 重新运行本脚本做健康检查。');
}

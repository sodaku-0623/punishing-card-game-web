#!/usr/bin/env node
/**
 * 从 R2 / CDN 批量下载卡图资源到本地 apps/web/public/cards。
 * 供自建部署 (Node 版) 或新克隆的本地环境初始化卡图使用，使 Git 仓库不再依赖二进制大文件。
 *
 * 用法：
 *   npm run cards:download -- --card-cdn https://card.ikemiyasouta.site
 *
 * 参数与环境变量：
 *   --card-cdn <url>    卡图 CDN 根地址 (例如 https://card.ikemiyasouta.site)，也可由环境变量 CARD_CDN 指定
 *   --force             强制重新下载所有文件 (即使本地已有且 sha256 一致)
 *   --dry-run           预检模式：仅检查统计需要下载的文件，不实际写入磁盘
 *   --concurrency <n>   并发下载数，默认 16
 *   --target-dir <path> 自定义保存目录，默认 apps/web/public/cards
 *   --manifest <path>   自定义清单文件路径，默认 scripts/card-manifest.json
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const DEFAULT_TARGET_DIR = path.resolve(ROOT_DIR, 'apps/web/public/cards');
const DEFAULT_MANIFEST_PATH = path.resolve(__dirname, 'card-manifest.json');

// 命令行参数解析
const args = process.argv.slice(2);
function getArg(flag, defaultValue) {
  const idx = args.indexOf(flag);
  if (idx !== -1 && idx + 1 < args.length) return args[idx + 1];
  return defaultValue;
}

const isForce = args.includes('--force');
const isDryRun = args.includes('--dry-run');
const concurrency = Math.max(1, parseInt(getArg('--concurrency', '16'), 10) || 16);
const targetDir = path.resolve(getArg('--target-dir', DEFAULT_TARGET_DIR));
const manifestPath = path.resolve(getArg('--manifest', DEFAULT_MANIFEST_PATH));

// 注意：严格按约定只读取 CARD_CDN，绝不读取 NEXT_PUBLIC_CARD_CDN
const rawCdn = (getArg('--card-cdn') || process.env.CARD_CDN || '').trim().replace(/\/+$/, '');

if (!rawCdn && !isDryRun) {
  console.error('\x1b[31m%s\x1b[0m', '错误: 请通过 --card-cdn <url> 或环境变量 CARD_CDN 提供卡图 CDN 根地址。');
  console.error('示例:');
  console.error('  npm run cards:download -- --card-cdn https://card.ikemiyasouta.site');
  process.exit(1);
}

// 规范化 CDN 地址：若未以 /cards 结尾，则补全 /cards 前缀
const baseCdn = rawCdn ? (rawCdn.endsWith('/cards') ? rawCdn : `${rawCdn}/cards`) : '';

if (!fs.existsSync(manifestPath)) {
  console.error('\x1b[31m%s\x1b[0m', `错误: 未找到卡图清单文件: ${manifestPath}`);
  console.error('请先运行 node scripts/generate-card-manifest.mjs 生成清单。');
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
if (!Array.isArray(manifest) || manifest.length === 0) {
  console.error('\x1b[31m%s\x1b[0m', `错误: 清单文件内容无效或为空: ${manifestPath}`);
  process.exit(1);
}

console.log('\x1b[36m%s\x1b[0m', '=== 《战双帕弥什 卡牌对战》卡图同步下载器 ===');
console.log(`  清单文件: ${path.relative(ROOT_DIR, manifestPath)} (${manifest.length} 个文件)`);
console.log(`  目标目录: ${path.relative(ROOT_DIR, targetDir)}`);
if (baseCdn) console.log(`  卡图 CDN: ${baseCdn}`);
console.log(`  下载并发: ${concurrency}`);
if (isForce) console.log('  模式: 强制重新下载 (--force)');
if (isDryRun) console.log('  模式: 预检演练 (--dry-run，不写磁盘)');
console.log('');

// 校验本地文件是否已存在且匹配
function isFileValid(localPath, expectedSize, expectedSha256) {
  if (!fs.existsSync(localPath)) return false;
  try {
    const stat = fs.statSync(localPath);
    if (stat.size !== expectedSize) return false;
    const buf = fs.readFileSync(localPath);
    const hash = crypto.createHash('sha256').update(buf).digest('hex');
    return hash === expectedSha256;
  } catch {
    return false;
  }
}

// 编码路径，处理包含 '★' 等特殊 Unicode 字符
function encodeRelPath(relPath) {
  return relPath
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');
}

// 带自动重试与完整性校验的单文件下载
async function downloadFileWithRetry(url, localPath, expectedSha256, maxRetries = 3) {
  let lastError = null;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'zhanshuang-card-downloader/1.0',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      if (expectedSha256) {
        const hash = crypto.createHash('sha256').update(buffer).digest('hex');
        if (hash !== expectedSha256) {
          throw new Error(`SHA256 校验失败 (期望: ${expectedSha256}, 实际: ${hash})`);
        }
      }

      // 原子写入：先写入临时文件，再移动覆盖，防止中断造成损坏卡图
      const tempPath = `${localPath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
      fs.mkdirSync(path.dirname(localPath), { recursive: true });
      fs.writeFileSync(tempPath, buffer);
      fs.renameSync(tempPath, localPath);
      return;
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 400 * attempt));
      }
    }
  }
  throw lastError;
}

// 主逻辑
async function main() {
  const toDownload = [];
  let alreadyValidCount = 0;
  let alreadyValidBytes = 0;

  process.stdout.write('正在对比本地已有卡图...\r');
  for (const item of manifest) {
    const localFilePath = path.join(targetDir, ...item.path.split('/'));
    if (!isForce && isFileValid(localFilePath, item.size, item.sha256)) {
      alreadyValidCount++;
      alreadyValidBytes += item.size;
    } else {
      toDownload.push({
        ...item,
        localPath: localFilePath,
        url: `${baseCdn}/${encodeRelPath(item.path)}`,
      });
    }
  }

  const toDownloadBytes = toDownload.reduce((acc, cur) => acc + cur.size, 0);

  console.log(`对比完成：`);
  console.log(`  ✔ 本地已存在且校验通过: ${alreadyValidCount} 个文件 (~${(alreadyValidBytes / 1024 / 1024).toFixed(2)} MB)`);
  console.log(`  ⬇ 需要下载: ${toDownload.length} 个文件 (~${(toDownloadBytes / 1024 / 1024).toFixed(2)} MB)`);

  if (isDryRun) {
    console.log('\n\x1b[33m[dry-run] 预检结束，未进行任何下载或磁盘写入。\x1b[0m');
    process.exit(0);
  }

  if (toDownload.length === 0) {
    console.log('\n\x1b[32m✔ 全部卡图均已就绪且 SHA-256 校验通过，无需下载！\x1b[0m');
    process.exit(0);
  }

  console.log(`\n开始并发下载 (${concurrency} 并发)...`);

  const startTime = Date.now();
  let completed = 0;
  let downloadedBytes = 0;
  const failures = [];

  const updateProgress = (lastCompletedItem) => {
    const percent = ((completed / toDownload.length) * 100).toFixed(1);
    const downloadedMB = (downloadedBytes / 1024 / 1024).toFixed(1);
    const totalMB = (toDownloadBytes / 1024 / 1024).toFixed(1);
    const name = lastCompletedItem ? path.basename(lastCompletedItem.path) : '';
    process.stdout.write(
      `  [${completed}/${toDownload.length}] (${percent}%) ${downloadedMB}/${totalMB} MB | 失败: ${failures.length} | ${name.padEnd(25)}\r`
    );
  };

  // 并发任务池执行
  let cursor = 0;
  async function worker() {
    while (cursor < toDownload.length) {
      const idx = cursor++;
      const item = toDownload[idx];
      try {
        await downloadFileWithRetry(item.url, item.localPath, item.sha256, 3);
        downloadedBytes += item.size;
      } catch (err) {
        failures.push({
          path: item.path,
          url: item.url,
          error: err.message,
        });
      } finally {
        completed++;
        updateProgress(item);
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, toDownload.length) }, () => worker());
  await Promise.all(workers);

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('\n');

  if (failures.length > 0) {
    console.error(`\x1b[31m✘ 下载完成，但有 ${failures.length} 个文件下载失败：\x1b[0m`);
    failures.slice(0, 20).forEach((f) => {
      console.error(`  - ${f.path}: ${f.error} (${f.url})`);
    });
    if (failures.length > 20) {
      console.error(`  ... 另有 ${failures.length - 20} 个文件失败`);
    }
    console.error('\n请检查网络连接或 CDN 配置后重新运行。');
    process.exit(1);
  }

  console.log(`\x1b[32m✔ 全部卡图下载并校验完成！耗时: ${durationSec} 秒\x1b[0m`);
  console.log(`  成功下载: ${toDownload.length} 个文件`);
  console.log(`  保存路径: ${targetDir}`);
}

main().catch((err) => {
  console.error('\n\x1b[31m下载器异常崩溃:\x1b[0m', err);
  process.exit(1);
});

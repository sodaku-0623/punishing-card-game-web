#!/usr/bin/env node
/**
 * 战双卡牌资源 Cloudflare R2 批量同步与上传脚本
 *
 * 功能特性：
 * 1. 递归扫描 apps/web/public/cards (包含 thumbs/ 缩略图与高清原图)
 * 2. 自动计算 MIME 类型与 URL 规范化，完美支持包含 '★' 等特殊 Unicode 字符的文件名
 * 3. 自动注入长期不可变强缓存响应头：Cache-Control: public, max-age=31536000, immutable
 * 4. 内置零依赖轻量 AWS S3 SigV4 签名客户端，支持多连接高并发上传 (默认 16 并发，数分钟内同步完数千张卡图)
 * 5. 支持降级至 Wrangler CLI 模式 (未配置 S3 Token 时可用)
 * 6. 支持 --dry-run 预检模式、--skip-existing 增量去重、--thumbs-only 仅上传缩略图
 *
 * 使用方法：
 *   # 预检演练 (不产生网络请求)
 *   node scripts/upload-cards-to-r2.mjs --dry-run
 *
 *   # 通过 S3 凭据极速上传 (推荐，最快)
 *   R2_ACCOUNT_ID=xxx R2_ACCESS_KEY_ID=xxx R2_SECRET_ACCESS_KEY=xxx node scripts/upload-cards-to-r2.mjs --bucket zhanshuang-cards
 *
 *   # 使用 Wrangler CLI 模式上传
 *   node scripts/upload-cards-to-r2.mjs --bucket zhanshuang-cards --cli
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const CARDS_DIR = path.resolve(ROOT_DIR, 'apps/web/public/cards');
const PUBLIC_DIR = path.resolve(ROOT_DIR, 'apps/web/public');

// 读取环境变量（尝试加载 .dev.vars 或 .env）
function loadEnvFile(filePath) {
  if (fs.existsSync(filePath)) {
    const lines = fs.readFileSync(filePath, 'utf8').split('\n');
    for (const line of lines) {
      const match = line.trim().match(/^([A-Za-z0-9_]+)=(.*)$/);
      if (match && !process.env[match[1]]) {
        process.env[match[1]] = match[2].trim().replace(/^['"](.*)['"]$/, '$1');
      }
    }
  }
}
loadEnvFile(path.resolve(ROOT_DIR, '.env'));
loadEnvFile(path.resolve(ROOT_DIR, 'apps/worker/.dev.vars'));

// 解析命令行参数
const args = process.argv.slice(2);
function getArg(flag, defaultValue) {
  const idx = args.indexOf(flag);
  if (idx !== -1 && idx + 1 < args.length) return args[idx + 1];
  return defaultValue;
}
const isDryRun = args.includes('--dry-run');
const isThumbsOnly = args.includes('--thumbs-only');
const isSkipExisting = args.includes('--skip-existing');
const forceCli = args.includes('--cli');
const bucketName = getArg('--bucket', process.env.R2_BUCKET_NAME || 'zhanshuang-cards');
const concurrency = parseInt(getArg('--concurrency', '16'), 10);

const accountId = process.env.R2_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID;
const accessKeyId = process.env.R2_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY;

// MIME 类型字典
const MIME_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
};

// 辅助：获取 MIME 类型
function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] || 'application/octet-stream';
}

// 递归遍历文件
function scanFiles(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...scanFiles(fullPath));
    } else if (entry.isFile()) {
      results.push(fullPath);
    }
  }
  return results;
}

// RFC 3986 安全 URI 编码
function rfc3986Encode(str) {
  return encodeURIComponent(str).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

// ==================== AWS S3 SigV4 原生实现 ====================
function hmacSha256(key, data) {
  return crypto.createHmac('sha256', key).update(data).digest();
}

function sha256Hex(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function getSignatureKey(key, dateStamp, regionName, serviceName) {
  const kDate = hmacSha256('AWS4' + key, dateStamp);
  const kRegion = hmacSha256(kDate, regionName);
  const kService = hmacSha256(kRegion, serviceName);
  return hmacSha256(kService, 'aws4_request');
}

/**
 * 原生 S3 API 上传单个文件至 R2
 */
async function uploadViaS3Api({ filePath, objectKey, contentType, cacheControl }) {
  const host = `${accountId}.r2.cloudflarestorage.com`;
  const region = 'auto';
  const service = 's3';
  const method = 'PUT';

  const fileBuffer = fs.readFileSync(filePath);
  const payloadHash = sha256Hex(fileBuffer);

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.substring(0, 8);

  // 规范化 URI 路径：/bucket/key
  const pathSegments = [bucketName, ...objectKey.split('/')];
  const canonicalUri = '/' + pathSegments.map(rfc3986Encode).join('/');

  const headers = {
    'cache-control': cacheControl,
    'content-type': contentType,
    host: host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };

  const sortedHeaderKeys = Object.keys(headers).sort();
  const canonicalHeaders = sortedHeaderKeys.map((k) => `${k}:${headers[k]}`).join('\n') + '\n';
  const signedHeaders = sortedHeaderKeys.join(';');

  const canonicalRequest = [method, canonicalUri, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, `${dateStamp}/${region}/${service}/aws4_request`, sha256Hex(canonicalRequest)].join('\n');

  const signingKey = getSignatureKey(secretAccessKey, dateStamp, region, service);
  const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex');

  const authHeader = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${dateStamp}/${region}/${service}/aws4_request, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const url = `https://${host}${canonicalUri}`;

  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      ...headers,
      Authorization: authHeader,
    },
    body: fileBuffer,
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`S3 API 返回状态码 ${res.status}: ${errText}`);
  }
}

/**
 * 检查对象在 S3 R2 中是否存在
 */
async function checkExistsViaS3Api(objectKey) {
  const host = `${accountId}.r2.cloudflarestorage.com`;
  const region = 'auto';
  const service = 's3';
  const method = 'HEAD';

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.substring(0, 8);
  const payloadHash = sha256Hex('');

  const pathSegments = [bucketName, ...objectKey.split('/')];
  const canonicalUri = '/' + pathSegments.map(rfc3986Encode).join('/');

  const headers = {
    host: host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };

  const sortedHeaderKeys = Object.keys(headers).sort();
  const canonicalHeaders = sortedHeaderKeys.map((k) => `${k}:${headers[k]}`).join('\n') + '\n';
  const signedHeaders = sortedHeaderKeys.join(';');

  const canonicalRequest = [method, canonicalUri, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, `${dateStamp}/${region}/${service}/aws4_request`, sha256Hex(canonicalRequest)].join('\n');

  const signingKey = getSignatureKey(secretAccessKey, dateStamp, region, service);
  const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex');
  const authHeader = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${dateStamp}/${region}/${service}/aws4_request, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const url = `https://${host}${canonicalUri}`;
  try {
    const res = await fetch(url, {
      method: 'HEAD',
      headers: { ...headers, Authorization: authHeader },
    });
    return res.status === 200;
  } catch {
    return false;
  }
}

// ==================== Wrangler CLI 降级实现 ====================
const WRANGLER_SCRIPT = path.resolve(ROOT_DIR, 'node_modules/wrangler/bin/wrangler.js');

function uploadViaWranglerCli({ filePath, objectKey, contentType, cacheControl }) {
  return new Promise((resolve, reject) => {
    const destination = `${bucketName}/${objectKey}`;
    const hasLocalWrangler = fs.existsSync(WRANGLER_SCRIPT);
    const isWin = process.platform === 'win32';

    let execFile = process.execPath;
    let execArgs = [];

    if (hasLocalWrangler) {
      execFile = process.execPath;
      execArgs = [
        WRANGLER_SCRIPT,
        'r2',
        'object',
        'put',
        destination,
        '--file',
        filePath,
        '--content-type',
        contentType,
        '--cache-control',
        cacheControl,
        '--remote',
      ];
    } else {
      execFile = isWin ? 'npx.cmd' : 'npx';
      execArgs = [
        'wrangler',
        'r2',
        'object',
        'put',
        destination,
        '--file',
        filePath,
        '--content-type',
        contentType,
        '--cache-control',
        cacheControl,
        '--remote',
      ];
    }

    const child = spawn(execFile, execArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: !hasLocalWrangler && isWin,
    });

    let stderr = '';
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Wrangler CLI 退出码 ${code}: ${stderr.trim()}`));
    });
  });
}

// ==================== 主任务流 ====================
async function main() {
  console.log('====================================================');
  console.log(' 《战双帕弥什》Cloudflare R2 卡图同步与上传工具');
  console.log('====================================================');

  if (!fs.existsSync(CARDS_DIR)) {
    console.error(`❌ 未找到卡图目录: ${CARDS_DIR}`);
    process.exit(1);
  }

  // 1. 扫描文件
  console.log(`🔍 正在扫描本地卡牌资源...`);
  const scanTargetDir = isThumbsOnly ? path.join(CARDS_DIR, 'thumbs') : CARDS_DIR;
  const allFiles = scanFiles(scanTargetDir);

  const tasks = allFiles.map((fullPath) => {
    // 相对路径，如 cards/BP01-001.png 或 cards/thumbs/BP01-001.jpg
    const relPath = path.relative(PUBLIC_DIR, fullPath).replace(/\\/g, '/');
    const stats = fs.statSync(fullPath);
    const mime = getMimeType(fullPath);
    return {
      filePath: fullPath,
      objectKey: relPath,
      size: stats.size,
      contentType: mime,
      cacheControl: 'public, max-age=31536000, immutable',
    };
  });

  const totalBytes = tasks.reduce((sum, t) => sum + t.size, 0);
  const totalMB = (totalBytes / (1024 * 1024)).toFixed(2);
  const hasSpecialChars = tasks.filter((t) => /[^\x00-\x7F]/.test(t.objectKey));

  console.log(`📦 共发现 ${tasks.length} 个资源文件 (总大小: ${totalMB} MB)`);
  console.log(`   - 缩略图数量: ${tasks.filter((t) => t.objectKey.includes('/thumbs/')).length}`);
  console.log(`   - 原图数量:   ${tasks.filter((t) => !t.objectKey.includes('/thumbs/')).length}`);
  console.log(`   - 含特殊字符(如★)的文件: ${hasSpecialChars.length} 个`);
  console.log(`🎯 目标 R2 存储桶: ${bucketName}`);
  console.log(`⚙️ 强缓存策略: Cache-Control: public, max-age=31536000, immutable`);

  // 2. 检查模式与凭据
  let useS3Api = false;
  if (!forceCli && accountId && accessKeyId && secretAccessKey) {
    useS3Api = true;
    console.log(`🚀 传输模式: 原生 AWS S3 SigV4 直传 (并发数: ${concurrency})`);
  } else {
    console.log(`⚠️ 传输模式: Wrangler CLI 子进程调起 (未检测到完整的 R2 S3 凭据)`);
    if (!forceCli) {
      console.log(`   提示: 可通过环境变量配置 R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY 开启极速直传。`);
    }
  }

  // 3. 演练模式直接退出
  if (isDryRun) {
    console.log('\n================== 预检报告 (Dry-Run) ==================');
    console.log('前 5 个待上传对象样例:');
    for (const t of tasks.slice(0, 5)) {
      console.log(`  • Key: ${t.objectKey} [${t.contentType}] (${(t.size / 1024).toFixed(1)} KB)`);
    }
    if (hasSpecialChars.length > 0) {
      console.log('特殊符号对象样例 (已做 URL 安全兼容处理):');
      for (const t of hasSpecialChars.slice(0, 3)) {
        console.log(`  • Key: ${t.objectKey} -> URL安全编码: ${t.objectKey.split('/').map(rfc3986Encode).join('/')}`);
      }
    }
    console.log('========================================================');
    console.log('✅ 预检完成！所有本地文件均正常，未实际上传任何文件。');
    return;
  }

  // 4. 执行上传
  const startTime = Date.now();
  let completed = 0;
  let skipped = 0;
  let failed = 0;
  const errors = [];

  // 任务队列调度器
  let taskIndex = 0;
  async function worker() {
    while (taskIndex < tasks.length) {
      const currentTask = tasks[taskIndex++];
      try {
        if (isSkipExisting && useS3Api) {
          const exists = await checkExistsViaS3Api(currentTask.objectKey);
          if (exists) {
            skipped++;
            completed++;
            continue;
          }
        }

        if (useS3Api) {
          await uploadViaS3Api(currentTask);
        } else {
          await uploadViaWranglerCli(currentTask);
        }
        completed++;
      } catch (err) {
        failed++;
        completed++;
        errors.push({ key: currentTask.objectKey, error: err.message });
      }

      // 控制台单行刷新输出进度
      if (completed % 10 === 0 || completed === tasks.length) {
        const percent = ((completed / tasks.length) * 100).toFixed(1);
        const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
        const speed = (completed / (Math.max(1, Date.now() - startTime) / 1000)).toFixed(1);
        process.stdout.write(
          `\r⏳ 进度: ${completed}/${tasks.length} (${percent}%) | 速度: ${speed} 个/s | 耗时: ${elapsedSec}s | 跳过: ${skipped} | 失败: ${failed}`
        );
      }
    }
  }

  console.log(`\n🚀 开始上传任务...`);
  const activeWorkers = [];
  const actualConcurrency = useS3Api ? concurrency : Math.min(4, concurrency);
  for (let i = 0; i < actualConcurrency; i++) {
    activeWorkers.push(worker());
  }

  await Promise.all(activeWorkers);
  console.log('\n');

  // 5. 汇总
  const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('================== 同步完成统计 ==================');
  console.log(`⏱️ 总耗时:     ${totalElapsed} 秒`);
  console.log(`✅ 成功上传:   ${completed - skipped - failed} 个`);
  console.log(`⏭️ 已存在跳过: ${skipped} 个`);
  console.log(`❌ 失败对象:   ${failed} 个`);

  if (errors.length > 0) {
    console.log('\n⚠️ 部分对象上传失败记录 (前 10 个):');
    for (const err of errors.slice(0, 10)) {
      console.log(`  - [${err.key}]: ${err.error}`);
    }
  }

  console.log('\n📌 后续配置提醒：');
  console.log(`1. 在 Cloudflare 控制台进入 R2 -> 存储桶 [${bucketName}] -> 设置 (Settings)`);
  console.log(`2. 开启 "公开访问 (R2.dev 子域)" 或绑定 "自定义网域" (如 cards.example.com)`);
  console.log(`3. 在前端环境变量设置: NEXT_PUBLIC_CARD_CDN=https://<你的R2访问域名>`);
  console.log('==================================================');
}

main().catch((err) => {
  console.error('\n❌ 执行异常中断:', err);
  process.exit(1);
});

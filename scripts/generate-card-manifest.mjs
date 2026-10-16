#!/usr/bin/env node
/**
 * 扫描 apps/web/public/cards 目录，生成卡图文件清单 (scripts/card-manifest.json)。
 *
 * 清单包含：
 * - path: 相对 apps/web/public/cards 的路径 (以 '/' 分隔，保留原始 Unicode 文件名)
 * - size: 文件字节大小
 * - sha256: SHA-256 校验和
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const CARDS_DIR = path.resolve(ROOT_DIR, 'apps/web/public/cards');
const MANIFEST_PATH = path.resolve(__dirname, 'card-manifest.json');

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);

function scanFiles(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...scanFiles(fullPath));
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (IMAGE_EXTENSIONS.has(ext)) {
        results.push(fullPath);
      }
    }
  }
  return results;
}

console.log('正在扫描卡图目录:', CARDS_DIR);
const files = scanFiles(CARDS_DIR);

if (files.length === 0) {
  console.error('错误: 未在卡图目录中找到任何图片文件:', CARDS_DIR);
  process.exit(1);
}

let totalBytes = 0;
const manifest = files.map((file, index) => {
  const relPath = path.relative(CARDS_DIR, file).replace(/\\/g, '/');
  const buffer = fs.readFileSync(file);
  const size = buffer.length;
  totalBytes += size;
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');

  if ((index + 1) % 500 === 0 || index + 1 === files.length) {
    process.stdout.write(`  已处理 ${index + 1} / ${files.length} 个文件...\r`);
  }

  return {
    path: relPath,
    size,
    sha256,
  };
});

// 按路径字典序升序排序，确保跨平台生成的一致性
manifest.sort((a, b) => a.path.localeCompare(b.path, 'en'));

fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

console.log(`\n✔ 成功生成卡图清单: ${MANIFEST_PATH}`);
console.log(`  文件数量: ${manifest.length} 个`);
console.log(`  总字节数: ${totalBytes} 字节 (~${(totalBytes / 1024 / 1024).toFixed(2)} MB)`);

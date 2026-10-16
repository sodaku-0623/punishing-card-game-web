/**
 * 构建 Cloudflare 版前端：Next.js 静态导出 → apps/worker/static (由同一个 Worker 托管)。
 *
 * 用法 (仓库根目录)：
 *   NEXT_PUBLIC_CARD_CDN=https://cards.example.com npm run build:cf-static
 *
 * - 前端与 API / WebSocket 同域，因此无需设置 NEXT_PUBLIC_SERVER_URL；
 * - 设置了 NEXT_PUBLIC_CARD_CDN 时，卡图由 R2 提供，不复制到静态资源中。
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const webDir = path.join(repoRoot, 'apps/web');
const outDir = path.join(webDir, 'out');
const staticDir = path.join(repoRoot, 'apps/worker/static');
const KEEP_FILES = new Set(['.gitkeep', '.assetsignore']);
const cardCdn = (process.env.NEXT_PUBLIC_CARD_CDN || 'https://card.ikemiyasouta.site').trim();

execSync('npx next build', {
  cwd: webDir,
  stdio: 'inherit',
  env: { ...process.env, OUTPUT_EXPORT: 'true', NEXT_PUBLIC_WS_TRANSPORT: 'native', NEXT_PUBLIC_CARD_CDN: cardCdn },
});

for (const entry of fs.readdirSync(staticDir)) {
  if (!KEEP_FILES.has(entry)) fs.rmSync(path.join(staticDir, entry), { recursive: true, force: true });
}

const isCardImage = (rel) => /^cards\//.test(rel) && /\.(png|jpe?g|webp)$/i.test(rel);
let copied = 0;
let skippedImages = 0;
function copyDir(src, rel = '') {
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const relPath = rel ? `${rel}/${entry.name}` : entry.name;
    const from = path.join(src, entry.name);
    if (entry.isDirectory()) {
      copyDir(from, relPath);
    } else if (cardCdn && isCardImage(relPath)) {
      // 注意只跳过图片：/cards/[id] 的占位页面 (cards/BP01-001.html) 也在 cards/ 目录下
      skippedImages++;
    } else {
      const to = path.join(staticDir, relPath);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to);
      copied++;
    }
  }
}
copyDir(outDir);

console.log(`\n✅ 已生成 apps/worker/static：${copied} 个文件${cardCdn ? `，跳过 ${skippedImages} 张卡图 (由 ${cardCdn} 提供)` : ''}`);
if (!cardCdn) {
  console.warn('⚠️  未设置 NEXT_PUBLIC_CARD_CDN，约 3GB 卡图会随 Worker 一起上传，建议先将卡图上传到 R2。');
}
console.log('下一步：npm run deploy -w @zhanshuang/worker');

/**
 * 在仓库根目录生成一份 wrangler.toml，内容取自 apps/worker/wrangler.toml，
 * 只把相对路径改写成「从仓库根目录出发」的路径。
 *
 * 为什么需要它：Cloudflare Workers Builds 在**仓库根目录**执行构建与部署命令，
 * 而权威配置在 apps/worker 下。控制台里若把部署/预览命令配成裸的
 * `npx wrangler deploy` / `npx wrangler preview`，wrangler 在根目录读不到配置：
 * deploy 会报「application detection logic ... root of a workspace」，
 * preview 会退化成一份空配置并误报「missing a `previews` block」——分支预览构建
 * 因此全部失败（2026-10-18、10-21 各发生过一次）。
 *
 * 生成根配置后，这两种裸命令在根目录都能跑通，不再依赖控制台是否写了 `-c`。
 * 生成物在 .gitignore 中，权威配置始终只有 apps/worker/wrangler.toml 一份。
 *
 * 用法 (仓库根目录)：node scripts/generate-root-wrangler.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = path.join(repoRoot, 'apps/worker/wrangler.toml');
const targetPath = path.join(repoRoot, 'wrangler.toml');

const source = fs.readFileSync(sourcePath, 'utf8');

/** 替换一处路径，找不到就报错退出，避免配置改动后静默生成错误的根配置 */
function rewrite(text, from, to, label) {
  if (!text.includes(from)) {
    console.error(
      `❌ 未在 apps/worker/wrangler.toml 找到 ${label}（期望出现 ${from}）。\n` +
        '   请同步更新 scripts/generate-root-wrangler.mjs 的路径改写规则，否则根目录的 wrangler 命令会指向错误的文件。',
    );
    process.exit(1);
  }
  return text.replace(from, to);
}

let toml = source;
toml = rewrite(toml, 'main = "src/index.ts"', 'main = "apps/worker/src/index.ts"', 'main');
toml = rewrite(toml, 'directory = "./static"', 'directory = "apps/worker/static"', 'assets.directory');

const header = `# ⚠️ 本文件由 scripts/generate-root-wrangler.mjs 自动生成，请勿手动编辑，也不要提交到 Git。
# 权威配置：apps/worker/wrangler.toml。根目录这份的存在只是为了：
#   在仓库根目录运行 \`npx wrangler deploy\` / \`npx wrangler preview\` 时能读到同一份配置。
`;

fs.writeFileSync(targetPath, `${header}\n${toml}`, 'utf8');
console.log('✅ 已生成仓库根目录 wrangler.toml（路径已改写为 apps/worker/…），供在根目录运行的 wrangler 命令使用');

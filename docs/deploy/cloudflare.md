# 《战双帕弥什 卡牌对战》Cloudflare 生产环境部署与运维手册

本文档提供将《战双帕弥什 卡牌对战》在线对战平台部署至 **Cloudflare 免费套餐（Workers + Durable Objects + D1 + R2）** 的全流程实战指南，涵盖云端资源初始化、安全凭据配置、自动化部署、运维监控与紧急灾备回滚方案。

---

## 目录

- [一、目标架构与免费额度保障](#一目标架构与免费额度保障)
- [二、部署前准备](#二部署前准备)
- [三、D1 关系型数据库初始化](#三d1-关系型数据库初始化)
- [四、R2 卡牌资产存储与 CDN 配置](#四r2-卡牌资产存储与-cdn-配置)
- [五、安全凭据（Secrets）配置与管理员初始化](#五安全凭据secrets配置与管理员初始化)
- [六、构建前端并发布 Worker](#六构建前端并发布-worker)
- [七、发布前在本地完整验证](#七发布前在本地完整验证)
- [八、日常运维与版本迭代流程](#八日常运维与版本迭代流程)
- [九、应急切换与回滚方案（灾备至本机 Node 服务）](#九应急切换与回滚方案灾备至本机-node-服务)

---

## 一、目标架构与免费额度保障

平台采用现代化云原生无服务器设计，彻底脱离个人电脑 24 小时开机与内网穿透限制：

```mermaid
flowchart TD
    Player["玩家客户端 (浏览器 / 移动端)"]

    subgraph Cloudflare["Cloudflare 免费套餐"]
        Worker["单个 Worker (game.example.com)<br/>静态前端 + Hono REST + WebSocket 路由"]
        DO["Durable Objects (RoomDO)<br/>每个房间一个实例：权威规则仲裁、断线重连"]
        D1[("D1 数据库<br/>账号 / 卡组 / 大厅投影 / 战绩回放")]
        R2["R2 对象存储 (cards.example.com)<br/>卡图与缩略图"]
    end

    Player -->|网页与静态资源、/api、/ws| Worker
    Player -->|卡图 (长期缓存)| R2
    Worker -->|/ws/rooms/:id 转发| DO
    Worker -->|读写| D1
    DO -->|大厅投影 / 结算归档| D1
```

### 免费套餐额度保障设计
1. **前端与后端同一个 Worker**：前端以 Next.js 静态导出的形式作为 Worker 的静态资源 (Workers Static Assets) 发布，前端、REST、WebSocket 同域，只需一个自定义域名、无跨域问题。命中静态文件的请求不计入 Workers 每天 10 万次请求的额度；只有 5 个动态路由页面 (`/rooms/:id`、`/game/:id`、`/cards/:id`、`/decks/:id`、`/replay/:id`) 需要 Worker 改写到占位页面，每次打开或跳转计一次请求。
2. **极速卡牌内存直出**：490 张官方基础卡牌在 Worker 启动时驻留静态内存，卡牌查询开销 <1ms，彻底规避 D1 批量读写和 CPU 运算超时。
3. **合并推送与休眠**：战斗中每次操作通过 `game:bundle` 单包下发状态与事件，对局无活动时 DO 自动休眠（WebSocket Hibernation），单日万次对局亦不会超标。
4. **全量卡图 1 年强缓存**：卡图打上 `Cache-Control: public, max-age=31536000, immutable`，首访后全由浏览器与 Cloudflare 边缘节点缓存，R2 读操作几乎为 0。

---

## 二、部署前准备

### 1. 账号与域名
- **Cloudflare 账号**：拥有一个普通的 Cloudflare 账号（Free Plan 免费套餐即可）。
- **已托管的自定义域名**：
  - 国内运营商对 Cloudflare 官方赠送的 `*.workers.dev` 存在较严重的 DNS 阻断与污染，**必须准备一个已接入 Cloudflare 的域名**（例如 `example.com`）。
  - 建议规划以下二级子域名：
    - `game.example.com`（Worker：网页、REST API 与 WebSocket 共用）
    - `cards.example.com`（R2 卡图域名；`r2.dev` 公开子域有访问频率限制，仅适合测试）

### 2. 本地开发环境
- 已安装 **Node.js >= 18.0.0** 与 **npm >= 9.0.0**。
- 本地终端登录 Cloudflare 认证：
  ```bash
  npx wrangler login
  ```
  在弹出的浏览器窗口中点击授权即可。
- **获取卡牌素材（自建部署 / 本地运行必备）**：
  新克隆的代码仓库如需进行自建 Node 部署或本地预览，需先运行卡图同步脚本（通过 R2 CDN 下载官方卡图与缩略图到本地）：
  ```bash
  npm run cards:download -- --card-cdn https://card.ikemiyasouta.site
  ```

---

## 三、D1 关系型数据库初始化

Cloudflare D1 为全球无服务器 SQLite 数据库，用于存储玩家账号、自定义卡组、对战记录与房间元数据。

### 1. 创建 D1 数据库
在项目根目录下执行：
```bash
npx wrangler d1 create zhanshuang_tcg
```
终端将输出类似如下信息：
```text
[[d1_databases]]
binding = "DB"
database_name = "zhanshuang_tcg"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

### 2. 配置 wrangler.toml
检查并确保 `apps/worker/wrangler.toml` 中的 `database_id` 与上述创建的 ID 一致：
```toml
[[d1_databases]]
binding = "DB"
database_name = "zhanshuang_tcg"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

### 3. 执行建表架构初始化（远端云端执行）
运行数据库建表迁移脚本：
```bash
npx wrangler d1 execute zhanshuang_tcg --remote --file=apps/worker/schema.sql
```
该脚本创建以下表（Worker 首次处理请求时也会自动执行同样的 `CREATE TABLE IF NOT EXISTS`）：
- `users`：玩家账户（PBKDF2 加盐密码哈希、角色）
- `decks`：玩家同步到服务器的自定义卡组（需登录，只能写入本人名下；官方预组不入库，由代码内置）
- `lobby_rooms`：大厅房间列表的只读投影，由各房间的 Durable Object 在状态变化时同步写入。房间的权威状态（成员、密码摘要、对局）只保存在 Durable Object 中，D1 中不保存房间密码
- `matches`：对局结果与回放（行动流 + 事件流），对局结束时写入

> 早期版本创建的 `rooms`、`game_records` 两张表已不再使用，可以手动 `DROP TABLE`。

---

## 四、R2 卡牌资产存储与 CDN 配置

本项目包含 1,262 张高清原图与 1,262 张优化缩略图（总容量约 3.01 GB），全部交由 R2 长期持久化分发。

### 1. 开通 R2 服务并创建存储桶
1. 登录 [Cloudflare 控制台](https://dash.cloudflare.com/) ➔ 进入 **存储与数据库 (Storage & Databases)** ➔ **R2**。
2. 若首次使用，点击开通/启用 R2（Free Tier 免费套餐）。
3. 点击 **创建存储桶 (Create Bucket)**：
   - 存储桶名称：`zhanshuang-cards`
   - 存储位置：选择 `自动 (Automatic)`
   - 点击 **创建存储桶**。

### 2. 开启公开访问与 CDN 域名
1. 点击进入刚创建的 `zhanshuang-cards` 存储桶 ➔ 切换到 **设置 (Settings)** 选项卡。
2. **公开访问方式（二选一）**：
   - **方式 A（免自定义域名，快速）**：在 **R2.dev 子域** 区域点击 **允许访问 (Allow Access)**，记录生成的公开地址，例如：
     ```text
     https://pub-xxxxxxxxxxxxxxxxxxxxxxxx.r2.dev
     ```
   - **方式 B（绑定自定义域名，推荐）**：在 **自定义域 (Custom Domains)** 区域点击 **连接域**，输入例如 `cards.yourdomain.com`，点击继续并确认绑定。
3. **跨域策略配置 (CORS)**：
   在存储桶设置页面的 **CORS 策略** 中，点击添加规则并保存：
   ```json
   [
     {
       "AllowedOrigins": ["*"],
       "AllowedMethods": ["GET", "HEAD"],
       "AllowedHeaders": ["*"],
       "MaxAgeSeconds": 86400
     }
   ]
   ```

### 3. 获取 R2 密钥并批量同步卡图
1. 在 R2 控制台右侧点击 **管理 R2 API 令牌 (Manage R2 API Tokens)** ➔ 点击 **创建 API 令牌**。
2. 权限选择 **对象读写 (Object Read & Write)**，应用于存储桶 `zhanshuang-cards`，点击创建。
3. 记录生成的 `Access Key ID`、`Secret Access Key` 和 `Account ID`（即当前 Cloudflare 账号 ID）。
4. 在本地终端执行极速批量同步脚本：
   - **Windows PowerShell**:
     ```powershell
     $env:R2_ACCOUNT_ID="<您的CloudflareAccountID>"
     $env:R2_ACCESS_KEY_ID="<您的R2AccessKeyID>"
     $env:R2_SECRET_ACCESS_KEY="<您的R2SecretAccessKey>"
     node scripts/upload-cards-to-r2.mjs --bucket zhanshuang-cards
     ```
   - **Linux / macOS**:
     ```bash
     R2_ACCOUNT_ID="<ID>" R2_ACCESS_KEY_ID="<Key>" R2_SECRET_ACCESS_KEY="<Secret>" node scripts/upload-cards-to-r2.mjs --bucket zhanshuang-cards
     ```
   脚本将通过内置的高并发 AWS S3 SigV4 引擎自动同步所有缩略图与高清原图，并在 1~2 分钟内完成 2,524 张卡图的入库与强缓存头打标。

---

## 五、安全凭据（Secrets）配置与管理员初始化

出于最高级别安全要求，**敏感密码与 JWT 签名密钥绝不提交代码仓库或硬编码**，一律由 Cloudflare 强加密 Secrets 管理。

### 1. 生成高强度安全随机密钥
在终端运行 Node.js 随机生成工具：
```bash
node -e "console.log('JWT_SECRET:     ' + require('crypto').randomBytes(32).toString('hex')); console.log('ADMIN_PASSWORD: ' + require('crypto').randomBytes(16).toString('hex'));"
```

### 2. 注入云端 Worker 密钥
在项目根目录运行以下命令依次写入：

```bash
# 写入 JWT 签名密钥
npx wrangler secret put JWT_SECRET --name zhanshuang-worker

# 写入管理员初始密码（请填入上一步生成的随机密码，例如 a9f2...）
npx wrangler secret put ADMIN_PASSWORD --name zhanshuang-worker
```

> **两个 secret 都是必需的。** 未配置 `JWT_SECRET`（或少于 16 个字符）时，注册与登录接口返回 503，所有 WebSocket 连接都按游客处理——代码中不存在任何默认密钥。

### 3. 管理员初始化与登录说明
- **自动化安全落库**：Worker 首次处理请求时会检测 D1 中是否存在 `admin` 用户。若不存在且配置了 `ADMIN_PASSWORD`（至少 8 位），则以 PBKDF2-SHA256 加盐哈希创建管理员；**未配置时不创建管理员，也不会使用任何默认密码**。公网部署不预置演示账号。
- **管理员登录**：
  - 访问前端页面 `/login`，用户名输入 `admin`，密码输入您在 secret 中配置的 `ADMIN_PASSWORD`。
  - 登录成功后进入 `/admin` 管理后台，可查看活跃房间、进行中对局与卡牌数据。
  - Cloudflare 版的卡表随代码部署，**不支持在后台在线新增或修改卡牌**（相关接口返回 501）；运行时长、内存等进程级指标在无服务器环境中不存在，监控页显示为 0。

---

## 六、构建前端并发布 Worker

前端以静态导出的方式打包进 Worker 的静态资源目录 `apps/worker/static`，与后端一起发布。

### 1. 一键部署 (推荐)
首次部署与日常更新都只需在项目根目录运行 (Windows / macOS / Linux 通用，可重复执行)：
```bash
npx wrangler login                                          # 首次使用前登录一次
npm ci
npm run deploy:cf -- --card-cdn https://cards.example.com   # 卡图所在的 R2 公开域名
```
`scripts/deploy-cf.mjs` 会依次：检查登录 → 确保 D1 数据库存在并与 `wrangler.toml` 一致 → 建表 (幂等) → 构建 → 缺失时随机生成并写入 `JWT_SECRET` / `ADMIN_PASSWORD` (管理员密码只在终端显示一次，请立即保存) → 发布 → 健康检查。
- 先用 `--dry-run` 试一遍：只构建并检查打包结果，不修改 Cloudflare 上的任何资源。
- 绑定自定义域名后可加 `--domain game.example.com`，用域名做健康检查。
- 若脚本更新了 `wrangler.toml` 中的 `database_id`，请把这处改动提交到仓库。

### 2. 手动构建与发布
如需逐步执行 (D1 与密钥需先按第三、五节手动配置)，在项目根目录运行：
```bash
npm ci && npm run build

# 静态导出前端并复制到 apps/worker/static (卡图由 R2 提供，不会被复制)
NEXT_PUBLIC_CARD_CDN=https://cards.example.com npm run build:cf-static

# 发布 Worker、Durable Objects 与前端静态资源
npm run deploy -w @zhanshuang/worker
```

说明：
- 前端与 API 同域，**不需要**设置 `NEXT_PUBLIC_SERVER_URL`；构建脚本会自动设置 `NEXT_PUBLIC_WS_TRANSPORT=native`。
- `NEXT_PUBLIC_*` 在构建时写入前端代码，修改后必须重新执行 `build:cf-static` 并发布。
- 动态路由只生成一个占位页面 (`/rooms/lobby`、`/game/room`、`/cards/BP01-001`、`/decks/default`、`/replay/demo`)，其余 ID 由 Worker 改写到占位页面 (`apps/worker/src/index.ts` 的 `DYNAMIC_ROUTE_PLACEHOLDERS`)，页面再从地址栏读取真实 ID (`apps/web/src/lib/route-id.tsx`)。修改占位 ID 时两边必须同步。

### 3. 控制台自动构建（Worker Builds）与分支预览（Worker Previews）

线上 Worker 由 Cloudflare 控制台绑定本仓库自动构建，仓库里没有部署工作流。生产分支与预览分支走的是**两条不同的命令**，配置错任何一条都会出现「生产能发、预览必失败」。

控制台 **Workers & Pages ➔ zhanshuang-worker ➔ Settings ➔ Build** 应配置为：

| 配置项 | 值 |
| --- | --- |
| 根目录 (Root directory) | `/`（仓库根目录，不要填 `apps/worker`） |
| 构建命令 (Build command) | `npm run build:worker` |
| 部署命令 (Deploy command) | `npm run deploy -w @zhanshuang/worker` |
| 预览命令 (Preview command) | `npm run preview:worker` |
| 生产分支 (Production branch) | `main`；并勾选 **Enable Preview Builds** |

说明：
- **仓库根目录没有 `wrangler.toml`**，配置只在 `apps/worker/wrangler.toml`。控制台里的部署/预览命令必须指到子包，否则 wrangler 读不到配置：
  - 在根目录直接跑 `npx wrangler deploy` 会报 `The Cloudflare application detection logic has been run in the root of a workspace instead of targeting a specific project...`；
  - 在根目录直接跑 `npx wrangler preview` 会退化成一份空配置，报下面这句——**这个报错有误导性，它不代表 `[previews]` 没写，而是根本没读到 `apps/worker/wrangler.toml`**：

  ```text
  ✘ [ERROR] Your Wrangler configuration is missing a `previews` block to run this command.
  ```

  等价写法：`npx wrangler deploy -c apps/worker/wrangler.toml`、`npx wrangler preview -c apps/worker/wrangler.toml`（`npm run deploy -w @zhanshuang/worker` 与 `npm run preview:worker` 内部已经这样做了）。
  2026-10-18 三个分支（`feat/cf-stage-3-frontend-r2`、`chore/cf-native-build-setup`、`refactor/web-design-tokens`）的预览构建失败，以及 10-21 的复现构建，都是这一个原因：控制台预览命令是裸的 `npx wrangler preview`。**看到上面这句报错，先查预览命令有没有带 `-c`，再去查 `[previews]` 块。**
- `apps/worker/wrangler.toml` **仍然必须**有 `[previews]` 块（可以是空的 `[previews]`），否则构建命令正确时同样会报上一句。新建分支只要从 `main` 拉出就会自带这段配置。
- 预览不继承生产配置。`[previews]` 里目前显式声明了两类绑定：D1 指向独立的预览库 `zhanshuang_tcg_preview`（`f9edd7b8-…`），Durable Objects 按绑定名声明（每个预览自动获得自己的命名空间与存储）。`assets`、`compatibility_date`、`migrations` 仍然留在顶层，不要复制进 `[previews]`。
- 预览库与生产库是两套数据，预览库上也要建表，否则预览站点能打开但注册/登录会报 D1 错误：
  `npx wrangler d1 execute zhanshuang_tcg_preview --remote --file apps/worker/schema.sql`（脚本幂等）。
- 本地预演预览构建（会用当前分支名作为预览名，可加 `--name` 覆盖）：
  ```bash
  npm run build:worker
  npm run preview:worker     # 等价于 wrangler preview -c apps/worker/wrangler.toml
  ```
  成功时打印 `Preview: <分支名> (new)`、预览 URL 与 Unique Deployment URL。
- 排错顺序：先看 `Deploy` 步骤的报错原文。若是上面那句 `missing a previews block`，先确认预览命令带了 `-c apps/worker/wrangler.toml`（最常见），再确认 `[previews]` 块存在；若报的是认证/权限类错误（`Authentication error`、`code: 10000`），则是构建令牌没有 Worker Previews 权限，需要在控制台的 Worker Previews 设置里完成一次性切换或重新生成构建令牌。

### 4. 绑定自定义域名（国内访问的关键步骤）
1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/) ➔ **Workers & Pages** ➔ 点击 **zhanshuang-worker**。
2. **设置 (Settings)** ➔ **域与路由 (Domains & Routes)** ➔ **添加 (Add)** ➔ **自定义域 (Custom Domain)**。
3. 输入 `game.example.com` 并添加，Cloudflare 会自动配置 DNS 与 TLS 证书。
4. 验证：打开 `https://game.example.com/` 应显示游戏首页；`https://game.example.com/api/cards` 应返回 490 张卡牌；`https://game.example.com/__connectivity` 为连通性测速页。

---

## 七、发布前在本地完整验证

不需要 Cloudflare 账号即可在本地真实运行时（workerd + Durable Objects + 本地 D1）中验证与线上一致的整套服务：

```bash
npm ci && npm run build
NEXT_PUBLIC_CARD_CDN=https://cards.example.com npm run build:cf-static   # 卡图可指向已上传的 R2

cd apps/worker
printf 'JWT_SECRET="local-dev-secret-0123456789"\nADMIN_PASSWORD="local-admin-pass"\n' > .dev.vars
npx wrangler dev --port 8787
```

然后用两个独立浏览器会话（如普通窗口 + 无痕窗口）打开 `http://127.0.0.1:8787/rooms`，完整打一局：建房（可带密码）→ 另一方加入 → 双方准备 → 开局 → 调度 → 对战，并在对局中刷新页面确认能恢复。`npm test` 中的 `apps/worker/test/e2e.workerd.test.ts` 也会在本地 workerd 中自动跑一遍核心流程。

### 掉线规则（与 Node 版的差异）
- 等待阶段掉线：保留席位 15 秒（刷新页面不丢座位），之后移出房间。
- 对战中单方掉线：对手收到提示；**3 分钟内未重连判负**（Node 版会无限期保留）。
- 对战中双方均掉线超过 1 分钟：关闭房间，对局不计战绩。

---

## 八、日常运维与版本迭代流程

### 1. 日常代码更新与修复发布
当修复了游戏引擎规则、卡牌效果或服务端逻辑时：
```bash
# 1. 运行本地自动化测试保障质量
npm run build && npm run lint && npm test

# 2. 前端有改动时重新生成静态资源
NEXT_PUBLIC_CARD_CDN=https://cards.example.com npm run build:cf-static

# 3. 发布 Worker (后端与前端一起更新)
npm run deploy -w @zhanshuang/worker
```

### 2. 数据库备份与还原 (D1 运维)
若需导出备份云端数据或进行本地调试分析：
```bash
# 导出云端数据库至本地 SQL 文件
npx wrangler d1 export zhanshuang_tcg --remote --output=./backup_$(date +%Y%m%d).sql

# 本地调试或数据恢复
npx wrangler d1 execute zhanshuang_tcg --remote --file=./backup.sql
```

### 3. 新增卡牌与素材更新
当后续官方推出新弹扩展包（如 BP05）时：
1. 运行卡表生成脚本更新数据与代码。
2. 运行缩略图生成脚本 `scripts/generate-thumbnails.ps1`。
3. 运行增量上传命令同步新卡图：
   ```bash
   node scripts/upload-cards-to-r2.mjs --bucket zhanshuang-cards --skip-existing
   ```
4. 部署 Worker 与前端即可同步生效。

---

## 九、应急切换与回滚方案（灾备至本机 Node 服务）

由于本项目在架构迁移全流程中严格遵循了**零侵入解耦**原则，保留了原有全部 `apps/server` 代码与构建管线，因此具备 **100% 极速回滚能力**。

若 Cloudflare 遭遇大规模不可抗力网络阻断或云端服务故障，可通过以下简易步骤在 2 分钟内切换回原有运行模式：

### 1. 启动本机 Node 权威服务器
在 sodaku 本地电脑直接双击根目录下的 `start.bat`（或运行 `npm start`、便携版启动器），原有的 Fastify + Socket.IO 后端（4000 端口）与统一前端网关（3000 端口）将立刻在本地接管所有联机功能。

### 2. 客户端连接回滚
若部署了公网反向代理（如 cpolar / frp / 自建 Nginx）：
- 将域名（如 `game.example.com`）解析切回个人电脑公网 IP 或穿透地址。
- 自建部署的前端**不要设置** `NEXT_PUBLIC_WS_TRANSPORT` 与 `NEXT_PUBLIC_SERVER_URL`：默认即使用 Socket.IO 并连接当前访问地址；未设置 `NEXT_PUBLIC_CARD_CDN` 时使用本地 `/cards` 卡图。
- 启动器不会把 `.env` 中的 `NEXT_PUBLIC_*` 注入前端，旧版 `.env` 中残留的 `NEXT_PUBLIC_SERVER_URL="http://localhost:4000"` 不会再导致外网玩家连到自己电脑。
- 注意：Node 版为内存存储，D1 中的账号、卡组与战绩不会带过去，回滚期间玩家需要重新注册。

---

至此，《战双帕弥什 卡牌对战》已具备完整的云原生高可用运行能力与完备的灾备兜底保障！

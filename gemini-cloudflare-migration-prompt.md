# 任务：将《战双帕弥什 卡牌对战》在线对战平台迁移到 Cloudflare 免费套餐

你是一名资深全栈工程师，负责把仓库 `sodaku-0623/zhanshuang-pamishi-official-card-game-web-platform` 从「sodaku 个人电脑 + 内网穿透」的部署方式，迁移到 Cloudflare 免费套餐（Workers、Durable Objects、D1、R2）上运行。请严格按下文的阶段推进，**每个阶段结束都要停下来汇报，等人确认后再进入下一阶段**。

## 0. 开始前必读

1. **先读仓库根目录的 `AGENTS.md`，其中的约定全部适用于本任务**（尤其是「Socket 身份」「房间与卡组」「鉴权与密钥」三节的安全约定，迁移后必须保持同等安全性）。
2. 再读：`docs/review/2026-10-comprehensive-review.md`、`apps/server/src/app.ts`、`apps/server/src/socket/gateway.ts`、`apps/server/src/services/room-manager.ts`、`apps/server/src/services/game-session-manager.ts`、`apps/server/test/security-hardening.test.ts`、`apps/web/src/lib/socket.ts`、`apps/web/src/lib/card-image.ts`、`packages/game-engine/src/engine.ts`、`packages/shared/src/types/socket.ts`。
3. 前置条件：PR #1（全面审查修复）必须已合并到 `main`。若未合并，停下来告知，不要自行合并。
4. **Cloudflare 的限额和 API 变化很快，下文给出的数字仅供参考。动手前请查阅 developers.cloudflare.com 的最新文档核实**，与本文不一致时以官方文档为准，并在汇报中注明。截至撰写时的参考值：
   - Workers 免费版：每天 10 万次请求，每次请求 10ms CPU（等待 I/O 不计）；代码包上限 64 MiB（未压缩）。
   - Durable Objects 免费版：只能用 SQLite 存储后端；每天 10 万次请求（WebSocket 消息计入）、13,000 GB·秒运行时长、500 万行读、10 万行写；总存储 5GB。超额后当天相应操作直接报错，不扣费。
   - R2 免费版：10 GB 存储、每月 100 万次 A 类操作、1000 万次 B 类操作，出站流量免费。

## 1. 现有架构（你需要理解的事实）

- npm Workspaces Monorepo，工作区按依赖顺序显式列出：`shared → game-rules → game-engine → database → server → web`。不要改成通配符。
- `packages/game-engine`：纯 TypeScript 权威规则引擎，没有 Node 专属依赖，可直接在 Workers 中运行。入口是 `GameEngine.dispatchAction(action)`。
  - **限制：** 引擎只能通过构造函数从开局状态创建，没有「从存档恢复」的入口。随机数 `SeedRng` 的内部状态是私有的（`getSeed()` 实际返回当前内部状态）。Durable Object 可能被休眠或驱逐，你必须实现对局恢复（见阶段 2）。
- `apps/server`：Fastify REST 加 Socket.IO，长驻 Node 进程，对局与房间状态全部在内存中；用户、卡组、对局记录用 `Memory*Repository`，重启即丢失。**Socket.IO 与 Fastify 不能直接在 Workers 上运行。**
- `apps/web`：Next.js 14 App Router，页面基本是客户端组件。实时通信通过 `apps/web/src/lib/socket.ts` 的 `getSocket()`，各页面调用 `socket.on/off/emit`。事件名与负载定义在 `packages/shared/src/types/socket.ts`。
- 卡图约 3GB：`apps/web/public/cards/*.png`（原图，平均约 2MB）与 `apps/web/public/cards/thumbs/*.jpg`（缩略图，约 45KB）。

## 2. 目标架构

| 组件 | 方案 |
| --- | --- |
| 实时对战 | 每个房间一个 Durable Object（`RoomDO`，用 `idFromName(roomId)`），持有房间状态、密码摘要、玩家列表、`GameEngine` 会话与所有 WebSocket 连接，使用 WebSocket Hibernation API |
| REST API | 同一个 Worker 内的路由（推荐 Hono），覆盖 `apps/server/src/app.ts` 的全部接口 |
| 用户、卡组、对局记录、卡牌数据 | D1（或你论证更合适的 DO SQLite），**真正持久化** |
| 前端 | `@opennextjs/cloudflare` 部署到 Workers；若你论证纯静态导出更省请求额度且改动可控，可以改用静态导出，但须说明理由 |
| 卡图 | R2（绑定自定义域名），通过环境变量 `NEXT_PUBLIC_CARD_CDN` 配置前缀；未设置时回退本地 `/cards` |
| 密钥 | `JWT_SECRET`、`ADMIN_PASSWORD` 用 `wrangler secret` 配置，绝不提交到仓库 |

新增工作区 `apps/worker`（Worker 加 Durable Objects，使用 wrangler），在根 `package.json` 的 `workspaces` 中插在 `apps/server` 之后、`apps/web` 之前。**保留 `apps/server` 不删除**，正式切换前 sodaku 仍在用它。

## 3. 分阶段执行

### 阶段 1：连通性验证（必须先做，做完停下）

国内玩家能否稳定访问 Cloudflare 是整个迁移的前提。据了解，`*.workers.dev` 在国内经常无法直接访问。

- 在 `apps/worker` 里写一个最小的 Worker 加 Durable Object：WebSocket 回声服务，外加一个返回服务端时间的 HTTP 接口，以及一个静态测试页面（显示连接状态、往返延迟 ping/pong 的中位数和 P95、断线次数）。
- 写清楚部署步骤（包括绑定自定义域名），让人工去部署，并请国内玩家分别用电信、联通、移动和手机网络测试。
- **到这里停止，提交 PR，等人工反馈测试结果后再继续。** 如果国内连接质量不可接受，整个迁移应当中止。

### 阶段 2：后端迁移（Durable Objects 加 D1）

1. **协议保持不变：** 沿用 `packages/shared/src/types/socket.ts` 中的事件名和负载结构，传输层换成原生 WebSocket，消息格式统一为 `{ "event": string, "payload": unknown }`。
2. **路由设计：** 浏览器连接 `wss://<域名>/ws/rooms/<roomId>`，由 Worker 转发给对应的 `RoomDO`。对局 ID 要能反推出所属房间（例如 `game:<roomId>:<序号>`），这样重连对局时 Worker 也能找到正确的 DO。大厅不需要 WebSocket，继续沿用 `GET /api/rooms` 轮询。
3. **身份（与现有安全约定一致）：**
   - 在 WebSocket 升级请求中校验 JWT（例如通过查询参数或子协议传递，选一种并说明理由；不要把 token 写进日志）。
   - 没有有效 JWT 时作为游客；游客 ID 必须是浏览器生成的唯一 ID，且不得等于任何已注册用户的 ID。
   - 身份在连接建立时确定，并用 `serializeAttachment` 跟随连接持久化。**事件负载中的 `userId` / `playerId` 一律忽略。**
4. **业务逻辑与现有 Node 版行为一致：** 房间密码只存摘要；系统预组只读；自定义卡组必须通过 `validateDeck` 且只写入本人名下；对局操作必须校验发起者属于本局玩家；限流（每用户每秒 15 次）；每个消息处理器都要 `try/catch` 并回报 `game:error`。可以把 `room-manager.ts`、`game-session-manager.ts` 中的纯逻辑抽到可复用的位置，避免 Node 版和 Worker 版各写一份。
5. **对局恢复：** DO 被驱逐后必须能恢复进行中的对局。二选一并说明理由：
   - (a) 给 `GameEngine` 增加 `toSnapshot()` / `static fromSnapshot()`（包含完整 `state` 与 RNG 内部状态），每次结算后把快照写入 DO SQLite；
   - (b) 持久化开局种子与按序的行动日志，恢复时重放（引擎是确定性的）。

   无论选哪种，都要写测试证明：恢复后的状态与恢复前完全一致，并且后续行动结果也一致。
6. **免费额度控制：** 每次行动给每位玩家只推送一条合并消息（事件加脱敏后的状态），不要像现在这样拆成 `game:events`、`game:sync_state`、`game:choice_required` 三条；空闲连接要能进入休眠；DO 内不要用 `setTimeout` 做掉线判定，改用 Alarm。估算「每局对战消耗的请求数和行读写数」，写进汇报。
7. **密码哈希与 CPU 限制：** Workers 免费版每次请求只有 10ms CPU，scrypt 或高迭代次数的 PBKDF2 可能超限。请实测，然后选择可行方案（例如把注册和登录放在 DO 内执行，或在可接受的安全强度内调整参数），并在汇报中说明取舍。不要为了省 CPU 退回到无盐或固定盐哈希。
8. **REST 迁移：** 把 `app.ts` 中所有接口迁移到 Worker（认证、房间、卡组、卡牌、历史与回放、管理后台）。`/api/admin/*` 必须要求管理员身份。
9. **测试：** 用 `@cloudflare/vitest-pool-workers`（或 Miniflare）把 `apps/server/test` 中的关键场景移植过来，至少包括 `security-hardening.test.ts` 的全部场景、双人建房到开局再到断线重连的完整流程，以及对局恢复测试。

### 阶段 3：前端与卡图

1. 改造 `apps/web/src/lib/socket.ts`：基于原生 WebSocket 实现一个与当前用法兼容的客户端（提供 `on` / `off` / `emit` / `connected` / `connect` / `disconnect`，支持自动重连和 `connect` / `disconnect` 事件），尽量让各页面不需要改动。用环境变量切换传输层，旧的 Socket.IO 路径在切换前继续可用。
2. 卡图地址统一经 `getCardThumbnailUrl()` / `getCardFullImageUrl()` 加上 `NEXT_PUBLIC_CARD_CDN` 前缀；用 `grep -rn "imageUrl" apps/web/src` 找出绕过这两个函数直接使用 `imageUrl` 的地方，一并改掉。
3. 写一个上传脚本，把 `public/cards`（含 `thumbs/`）上传到 R2。设置长期缓存头；文件名含 `★` 等非 ASCII 字符，注意 URL 编码。
4. 用 OpenNext（或静态导出）部署前端，并写清楚部署步骤。

### 阶段 4：部署文档与切换方案

- 在 `docs/deploy/cloudflare.md` 写完整的部署手册：账号准备、自定义域名、D1 与 R2 创建、secrets 配置、首次部署、更新流程、回滚到 sodaku 电脑的方法。
- 写管理员账号初始化方式（不得硬编码默认密码）。
- 更新 `AGENTS.md` 与 `README.md` 中的架构、命令与「数据持久化现状」说明。

## 4. 工程要求

- 每个阶段单独提一个 PR，基于最新的 `main`，不要直接推送到 `main`，不要 `--force`。
- 提交信息、代码注释、用户可见文案使用简体中文。
- 每个 PR 提交前必须通过：`npm run build && npm run lint && npm test`（新增的 worker 测试要纳入 `npm test`）。CI 配置 `.github/workflows/ci.yml` 也要同步更新。
- 不要提交任何密钥、`.dev.vars`、wrangler 账号 ID 以外的敏感信息；`.gitignore` 加上 `.dev.vars` 与 `.wrangler/`。
- 不要往仓库提交新的大型二进制文件。
- 不要为了让测试通过而跳过、禁用或删除测试。
- 遇到文档与本说明冲突、免费额度明显不够、或需要改动 `apps/server` 现有行为的情况，**停下来说明情况和你的建议，不要自行决定**。

## 5. 每个阶段的汇报格式

1. 做了什么（文件清单与关键设计决定，以及理由）
2. 如何验证（命令与结果，未能验证的部分明确说明）
3. 免费额度估算（阶段 2 起必填）
4. 已知问题与风险
5. 需要人工做的事（部署、配置、测试）

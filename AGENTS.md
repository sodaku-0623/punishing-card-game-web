# AGENTS.md

面向 AI 编码代理与新协作者的项目工作指南。改代码前请先读完本文件；用户可见文案、注释与提交信息均使用简体中文。

## 项目概览

《战双帕弥什 卡牌对战》在线对战平台，npm Workspaces Monorepo：

| 包 | 路径 | 说明 |
| --- | --- | --- |
| `@zhanshuang/shared` | `packages/shared` | 类型、Action/Event 协议、Socket 事件契约、`ErrorCode` |
| `@zhanshuang/game-rules` | `packages/game-rules` | 规则常量、卡组构筑校验 `validateDeck` (5.1)、官方预组权威卡表 |
| `@zhanshuang/game-engine` | `packages/game-engine` | 纯 TypeScript 权威规则引擎 (`GameEngine.dispatchAction`)、官方卡牌全集 `OFFICIAL_CARDS_DATA` |
| `@zhanshuang/database` | `packages/database` | Prisma schema、仓储接口与内存/Prisma 实现 (仅 Node 版使用) |
| `@zhanshuang/server` | `apps/server` | **Node 版后端**：Fastify REST + Socket.IO (端口 4000) |
| `@zhanshuang/worker` | `apps/worker` | **Cloudflare 版后端**：Workers (Hono REST) + Durable Objects (原生 WebSocket) + D1 |
| `@zhanshuang/web` | `apps/web` | Next.js 14 App Router 前端 (端口 3000)，两种后端共用 |

规则依据：`docs/rules/rule-specification.md`（按官方《综合规则》V1.4 与规则 Q&A 第 1~10 期整理，条款编号与官方一致）。引擎与测试中的 `(5.2.1.e)`、`(7.3.1)` 等编号均指向该文档条款，修改规则逻辑时保留并更新这些引用。官方规则以 B 站「集卡社对战卡牌」发布的为准，官方更新后同步更新该文档。

### 两种部署方式

| | 自建部署 (Node 版) | Cloudflare 版 |
| --- | --- | --- |
| 后端 | `apps/server` | `apps/worker` |
| 启动 / 发布 | `start.bat`、`npm start`、便携版 (`npm run package:portable`) | `npm run deploy:cf -- --card-cdn <R2 域名>` (一键部署，可重复执行；详见 `docs/deploy/cloudflare.md`) |
| 前端托管 | Next.js 服务 (`next start` / `next dev`) | Next.js 静态导出，作为同一个 Worker 的静态资源 (前端、API、WebSocket 同域) |
| 前端传输层 | Socket.IO (默认，不设置任何 `NEXT_PUBLIC_*`) | 原生 WebSocket (`build:cf-static` 自动设置 `NEXT_PUBLIC_WS_TRANSPORT=native`) |
| 数据 | 内存存储，重启清空 | D1 持久化 |
| 卡图 | 本地 `public/cards` | R2 (`NEXT_PUBLIC_CARD_CDN`) |

**目前对外服务的是 sodaku 电脑上的自建部署 (经内网穿透)。任何改动都不能破坏自建部署**，切换到 Cloudflare 前两种方式都必须可用。

## 常用命令 (均在仓库根目录执行)

```bash
npm ci               # 安装依赖 (严格按 package-lock.json)
npm run build        # 按依赖顺序编译全部包 (database 的 prebuild 会执行 prisma generate)
npm test             # 全工作区测试；依赖各包 dist，需先 build
npm run lint         # 前端 next lint
npm run typecheck    # 前端与 worker tsc --noEmit
npm start            # 自建部署本地开发：同时启动 server (tsx watch) 与 web (next dev)
```

Cloudflare 版本地运行 (无需 Cloudflare 账号，与线上一致，详见 `docs/deploy/cloudflare.md` 第七节)：

```bash
npm run build:cf-static                                # 静态导出前端到 apps/worker/static
cd apps/worker && npx wrangler dev --port 8787         # 需要 apps/worker/.dev.vars 中配置 JWT_SECRET / ADMIN_PASSWORD
# 浏览器打开 http://127.0.0.1:8787/rooms
```

单包操作：`npm run build -w @zhanshuang/server`、`npm test -w @zhanshuang/game-engine`、`npm test -w @zhanshuang/worker`、`cd apps/web && npx vitest run`。

提交前至少确保：`npm run build && npm run lint && npm test` 全部通过。CI (`.github/workflows/ci.yml`) 执行同样的步骤。

## Git 与协作规范

### 分支
- 一律从最新的 `main` 拉分支，一个分支只做一件事。命名：`feat/…`、`fix/…`、`docs/…`、`chore/…`、`refactor/…`、`test/…`，例如 `fix/portable-gateway-port`。
- **禁止直接推送 `main`**，所有改动通过 PR 合并。
- 禁止对共享分支 (`main` 及他人的分支) 使用 `git push --force` 或改写历史。只有自己独占的分支可以 `--force-with-lease`。
- PR 合并后删除分支；后续改动从最新 `main` 重新拉分支，不要在已合并的分支上继续提交。

### 提交
- 提交信息使用简体中文，格式 `类型: 摘要`，类型与分支前缀一致，例如 `fix: 修复便携版网关与后端抢占 4000 端口`。正文说明「为什么改」，而不只是「改了什么」。
- 不要提交：密钥与本地配置 (`.env`、`.dev.vars`)、构建产物 (`dist/`、`.next/`、`.vercel/`、`.wrangler/`)、大型二进制文件、AI 提示词与草稿文件、含个人本地绝对路径 (如 `C:\Users\…`、`file:///f:/…`) 的内容。
- `package-lock.json` 只在依赖确实变化时提交。`npx` 或部分构建工具会顺带改写锁文件，提交前用 `git diff package-lock.json` 检查，与本次改动无关的变化用 `git checkout package-lock.json` 还原。

### Pull Request
- PR 描述写清：改了什么、为什么改、**如何验证** (运行了哪些命令、在什么环境实际打了一局)、已知风险与未完成项。
- 合并条件：CI 全绿；**至少一名作者以外的人评审通过**；涉及联机流程的改动，评审人或作者须在真实运行时里实际完成过一局 (见下文「验证要求」)。
- **不要在创建 PR 后几分钟内自行合并**，AI 生成的 PR 尤其如此——必须先有人在本地跑起来确认。
- 合并方式统一使用 Squash，合并提交标题沿用 PR 标题 (中文、带类型前缀)。
- 大改动 (如迁移、重写某一层) 拆成可独立评审、可独立回滚的多个 PR，每个 PR 合并后自建部署都必须仍然可用。

### 验证要求
单元测试与 mock 测试**不足以**证明联机功能可用。以下改动合并前必须在真实运行时里验证：

| 改动范围 | 最低验证 |
| --- | --- |
| `apps/server`、Socket.IO 协议、启动脚本 | `npm start` 后用两个独立浏览器会话 (普通窗口 + 无痕窗口) 完成建房 → 加入 → 准备 → 开局 → 对战 |
| `apps/worker`、`scripts/build-cf-static.mjs` | `npm test -w @zhanshuang/worker` (含 workerd 端到端测试)，并按上文命令在本地 Cloudflare 版完成一局 (含对局中刷新页面) |
| `apps/web` 的连接、房间、对局页面 | 两种部署方式各完成一局 |
| `scripts/package-portable.mjs` | 至少确认生成的启动器能启动且网关监听 3000 端口 |

## 关键约定

### 构建顺序
根 `package.json` 的 `workspaces` 按依赖顺序显式列出 (shared → game-rules → game-engine → database → server → worker → web)。**不要改回 `packages/*` 通配**，否则 npm 按字母序构建，干净克隆时 `game-engine` 会先于 `shared` 编译而失败。新增包时按依赖关系插入到正确位置。

### 服务端是唯一权威
- 一切对局状态变更必须经过 `GameEngine.dispatchAction`；前端只发送意图 (`game:action` / `game:choice`)，不做最终裁定。
- 下发给客户端的对局状态必须经 `sanitizeGameStateForPlayer` 脱敏 (对手手牌、牌库顺序、对手暗费不可泄露)。新增 `GameState` 字段时同步检查脱敏逻辑。
- 开局卡表以服务端为准：官方预组用 `@zhanshuang/game-rules` 的 `OFFICIAL_STARTER_DECKS`，卡牌定义用引擎的 `OFFICIAL_CARDS_DATA`；**绝不使用引擎的 `BASE_TEST_CARDS` 或任何占位卡组开局**。

### 规则引擎结构 (`packages/game-engine`)
- **事务性行动**：`dispatchAction` 在执行前备份状态与随机数状态，行动失败时整体回滚 (`restoreState` 原地恢复，卡牌对象会被替换，测试中断言失败行动之后的状态要按 ID 重新读取)。处理器返回 `{ success: false }` 即可，不需要手动撤销已做的修改。
- **可挂起的流程**：攻击流程由 `CombatState.step` (FREE_TIMING → BLOCK → CHARGE → DAMAGE/BATTLE → END) 驱动，结束阶段由 `endPhaseStep` 驱动；`state.timingWindow` 表示轮流使用【瞬时】的时机 (7.3.1.b / 6.5.1.a)。每个行动后 `continueFlow()` 推进不需要玩家行动的步骤，遇到待决策 (`currentPendingChoice`) 或需要玩家选择时停下。没有可用瞬时的玩家自动放弃 (`hasUsableInstant`)。
- **决策队列**：效果通过 `setPendingChoice` 排队 (`state/pending-choice.ts`)，不会覆盖尚未处理的决策。决策结算后续步骤所需的数据放在 `metadata` 中且必须可 JSON 序列化 (不能放函数)，以便随快照恢复。提交的选择由 `validateChoiceSelection` 校验 (数量、选项 ID、`payload.eligible`)。
- **派生数据**：费用区统计 (`openCostCount` 等) 由 `syncCostStats` 从实际卡牌派生，不要直接改写；战场角色的 `effectivePP` / `effectiveDP` 在每次行动后由引擎写入，前端直接展示 (`apps/web/src/lib/card-stats.ts`)，不要在前端重复实现 PP 计算。
- **持续效果**：「直到回合结束为止」等带期限的效果用 `CardInstance.modifiers` (`CardModifier.untilTurn`) 表示，结束阶段与卡牌移动区域时自动消失；不要再新增 `tempPPBonus` 式的字段。永久能力 (【永】) 经 `BattlefieldManager.setStaticPPProvider` 计入 PP。
- **卡牌效果**：官方预组 ST01~ST03 在 `effects/preset-cards.ts` 中按卡牌文本逐卡精确实现，优先于 `card-effects.ts` 中按关键字匹配的通用解析。**其余卡包的效果仍是近似实现**，修改或新增卡牌效果时参照预组模块的写法逐卡实现并补测试。升变条件由 `database/ascension-parser.ts` 解析 (无法解析的设置 `unsupportedReason` 并拒绝升变)，固有词条由 `rules/keywords.ts` 解析。
- **尚未实现**：协战、浮空、通用的自动能力触发框架 (`pendingTriggers` 未使用)、非战术牌上的【瞬时】能力、带条件或代价的【充能自】(BP03/BP04 部分卡牌)、玩家自选支付费用的卡牌。详见 `docs/review/` 下的审查报告。

### 两套后端必须保持协议一致
前端同一套代码对接两种后端，因此：
- WebSocket 事件名与负载以 `packages/shared/src/types/socket.ts` 为准，`apps/server/src/socket/gateway.ts` 与 `apps/worker/src/room-do.ts` 必须同步实现。修改协议时两边一起改，并同时更新两边的测试。
- Cloudflare 版为节省额度把对局状态合并成一条 `game:bundle` ({ events, state })，由前端 `NativeWebSocketClient` 拆回 `game:events` / `game:sync_state` / `game:choice_required`。除此之外不要引入只有一边才有的事件名。
- REST 接口统一返回 `{ success, data }` (认证接口另在顶层提供 `token` / `user`)，错误返回 `{ success: false, error }`。
- 房间由玩家通过 WebSocket 的 `room:join` 首次加入时创建，开局由 `room:start` 触发 (不要在双方准备后自动开局)。

### Socket 身份
- 连接身份在握手时一次性确定：Node 版在 `gateway.ts` 的 `io.use` 中 (JWT 放在 `auth.token`)，Cloudflare 版在 `RoomDO.fetch` 中 (JWT 放在 `?token=`)。携带有效 JWT 即为登录用户；否则为游客，游客不得冒用已注册账号的 userId。
- **事件处理器一律使用握手确定的 `userId`，绝不信任事件负载中的 `userId` / `playerId` / `roomId`。** Cloudflare 版的房间 ID 由 Worker 路由经 `x-room-id` 请求头传给 Durable Object。
- 对局类事件必须校验发起者属于本局玩家；引擎层 `dispatchAction` 也会拒绝非本局玩家。
- 每个消息处理器都要 `try/catch` 并以 `game:error` 回报，未捕获的异步异常会导致进程崩溃。
- 前端游客 ID 由 `getGuestUserId()` 为每个浏览器生成唯一值，不要再引入 `'guest'` 之类的共享占位 ID。

### 房间与卡组
- 房间密码只以摘要形式保存在服务端 (Node 版 `RoomManager.roomPasswords`，Cloudflare 版房间 Durable Object 内)，绝不放进 `PublicRoomState`、D1 大厅表或 URL。新建房间时密码经 `sessionStorage` (`src/lib/room-password.ts`) 从大厅传给等待室。
- 系统预组只读：REST 与 Socket 都不得修改或删除。客户端上传的自定义卡组必须通过 `validateDeck` (校验前用官方卡表补全信号球等字段)，且只能写入该玩家自己名下。

### 鉴权与密钥
- Node 版密码使用 scrypt + 随机盐；Cloudflare 版使用 PBKDF2-SHA256 + 随机盐 (受 Workers CPU 限制)。两者都兼容旧版 HMAC 摘要并在登录时自动升级。
- `JWT_SECRET`、`ADMIN_PASSWORD` 通过环境变量或 Cloudflare Secrets 配置。**代码中不得出现任何默认密钥或默认管理员密码作为兜底**；未配置时应拒绝服务 (Cloudflare 版) 或随机生成 (Node 版)。
- `/api/admin/*` 一律要求管理员身份。

### 数据持久化现状
- **Node 版 (`apps/server`)**：固定使用 `Memory*Repository`，服务重启后账号、卡组、对局记录全部清空；`docker-compose.yml` 中的 PostgreSQL 尚未接入。
- **Cloudflare 版 (`apps/worker`)**：账号、同步到服务器的卡组、对局记录与回放保存在 D1；房间的权威状态在各自的 Durable Object 中，D1 的 `lobby_rooms` 只是大厅展示用的投影。

### Cloudflare 版注意事项
- 免费额度：Workers 每天 10 万次请求 (命中静态资源的请求不计入，动态路由页面与 API 计入)；Durable Objects 每天 10 万次请求 (WebSocket 消息计入) 与 10 万行写入。**不要在每条消息上写存储** (例如限流计数放内存)，对局快照不要包含不断增长的事件历史。
- Durable Object 可能随时休眠或被驱逐，内存中的状态只能当缓存，需要的数据必须能从 DO SQLite 恢复。修改 DO 内表结构时使用新表名 (现为 `_v2` 后缀)，避免与已部署的旧表冲突。
- 各类 ID 只用 URL 安全字符 (对局 ID 为 `game~<roomId>~<timestamp>`)。
- 国内访问必须绑定自定义域名，`*.workers.dev` 在国内经常无法访问。
- Cloudflare 版卡表随代码部署，管理后台不支持在线编辑卡牌。

## 前端约定

- **`NEXT_PUBLIC_*` 在构建时写入前端代码**，运行时修改无效。自建部署不应设置任何 `NEXT_PUBLIC_*` (前端自动连接当前访问地址)；启动脚本 (`scripts/start.mjs`、便携版启动器) 不得把 `.env` 中的 `NEXT_PUBLIC_*` 注入前端进程，否则外网穿透访问的玩家会被指向自己电脑上的 `localhost`。
- `getSocket()` 默认使用 Socket.IO，只有 `NEXT_PUBLIC_WS_TRANSPORT=native` 时才使用原生 WebSocket。原生客户端按房间建立连接 (每个房间是一个 Durable Object)，`room:join` / `game:reconnect` 会自动切换到对应房间的连接。
- **动态路由 (`[id]` 目录) 不要用 `useParams()` 读 ID**。Cloudflare 版静态导出时每个动态路由只生成一个占位页面 (由 `generateStaticParams` 返回的 `lobby`、`room` 等)，Worker 把其余 ID 改写到占位页面，此时 `useParams()` 拿到的是占位 ID。页面一律用 `src/lib/route-id.tsx` 的 `useRouteId()` 读取 (已解码)，并在 `page.tsx` 中用 `RouteIdProvider` 包裹客户端组件。新增或修改动态路由时，同步更新 `apps/worker/src/index.ts` 的 `DYNAMIC_ROUTE_PLACEHOLDERS`。
- 卡图：小尺寸展示 (≤ 约 250px) 一律用 `getCardThumbnailUrl()` 加载缩略图 (约 45 KB)，并以 `handleThumbnailError()` 回退原图；原图 PNG 平均约 2 MB，仅用于大图检视。卡图地址统一经 `src/lib/card-image.ts` 生成 (会自动加上 `NEXT_PUBLIC_CARD_CDN` 前缀)。新增卡图须同时生成缩略图 (`scripts/generate-thumbnails.ps1`) 并上传 R2 (`scripts/upload-cards-to-r2.mjs`)。
- 对局页 `src/app/game/[id]/page.tsx` 体量很大，避免在其中新增高频 `setState` (如全局 `mousemove`)，高频状态放进叶子组件内部并用 `requestAnimationFrame` 节流。
- Hooks 必须在任何提前 `return` 之前调用 (`next lint` 会以 `react-hooks/rules-of-hooks` 报错)。
- Tailwind v3：入场动画类 (`animate-in`、`fade-in`、`zoom-in-95`、`slide-in-from-*`) 由 `tailwindcss-animate` 插件提供；非默认尺寸 (`w-26`、`h-22`、`rounded-xs`、`shadow-xs`) 已在 `tailwind.config.ts` 扩展。使用其他非默认工具类前先确认其存在，否则会静默失效。
- 剪贴板使用 `src/lib/clipboard.ts` 的 `copyText()`：局域网 http 访问时 `navigator.clipboard` 不可用。
- 图标按钮需提供 `aria-label`；弹窗使用 `role="dialog"` + `aria-modal="true"`。
- 全局 `user-select: none`，表单控件已在 `globals.css` 中单独放开，不要移除该规则 (会导致 iOS Safari 输入框无法使用)。

## 测试

- 引擎规则：`packages/game-engine/test`，新增卡牌效果或规则分支时补充用例。用 `test/helpers.ts` 的 `fillCostZone` (费用区放真实卡牌)、`passInstantWindows`、`endTurn`、`resolvePendingChoices` 推进流程，不要直接改写派生字段；预组卡牌的逐卡用例见 `test/preset-cards.test.ts`。
- Node 版服务端：`apps/server/test`，使用 `createServerApp()` + `fastify.inject` / `socket.io-client`；安全相关回归见 `security-hardening.test.ts`。
- Cloudflare 版：`apps/worker/test/e2e.workerd.test.ts` 通过 wrangler 的 `unstable_dev` 在本地真实 workerd 运行时 (含 Durable Objects 与本地 D1) 中按前端协议跑完整流程。**新增或修改 Worker 行为时在这里补测试，不要只写 mock 测试。**
- 前端：`apps/web/test` 使用 `react-dom/server` 的 `renderToString` 做渲染冒烟测试。zustand v5 在服务端渲染时读取 store 的初始状态，需要注入状态时参考 `game-page.test.tsx` 中 `vi.doMock` 的写法。

## 仓库注意事项

- `apps/worker/static/` 是 `build:cf-static` 生成的前端产物，不要提交 (只保留 `.gitkeep` 与 `.assetsignore`)。卡图在 `cards/` 目录下与 `/cards/[id]` 的占位页面混在一起，排除卡图时只能删图片文件，不能删整个目录。
- `apps/web/public/cards` 约 3 GB 卡图直接存于 Git 中，克隆很慢。CI 使用 blob-less + 稀疏检出跳过卡图。不要再向仓库提交大型二进制文件，新增素材应考虑 Git LFS 或对象存储。
- `scripts/` 根目录为正式流程脚本 (启动、打包、压测、卡表生成、R2 上传)；`scripts/dev/` 为一次性排查脚本，不参与构建。脚本中不要硬编码个人本地路径，改用命令行参数或环境变量。
- 便携版启动器的网关端口只读 `GATEWAY_PORT` (默认 3000)，不要读 `PORT`——`.env` 里的 `PORT` 是后端端口 4000。
- 卡牌插画与商标权利归库洛游戏所有，本项目仅限非商业交流用途。

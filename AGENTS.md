# AGENTS.md

面向 AI 编码代理与新协作者的项目工作指南。改代码前请先读完本文件；用户可见文案、注释与提交信息均使用简体中文。

## 项目概览

《战双帕弥什 卡牌对战》在线对战平台，npm Workspaces Monorepo：

| 包 | 路径 | 说明 |
| --- | --- | --- |
| `@zhanshuang/shared` | `packages/shared` | 类型、Action/Event 协议、Socket 事件契约、`ErrorCode` |
| `@zhanshuang/game-rules` | `packages/game-rules` | 规则常量、卡组构筑校验 `validateDeck` (5.1) |
| `@zhanshuang/game-engine` | `packages/game-engine` | 纯 TypeScript 权威规则引擎 (`GameEngine.dispatchAction`) |
| `@zhanshuang/database` | `packages/database` | Prisma schema、仓储接口与内存/Prisma 实现、官方卡牌种子数据 |
| `@zhanshuang/server` | `apps/server` | Fastify REST + Socket.IO 本地权威服务器 (端口 4000) |
| `@zhanshuang/worker` | `apps/worker` | Cloudflare Workers + Durable Objects 生产权威服务器 (REST API + 原生 WebSocket) |
| `@zhanshuang/web` | `apps/web` | Next.js 14 App Router 前端 (端口 3000) |

规则依据：`docs/rules/rule-specification.md`。引擎与测试中的 `(5.2.1.e)`、`(7.3.1)` 等编号均指向该文档条款，修改规则逻辑时保留并更新这些引用。

## 常用命令 (均在仓库根目录执行)

```bash
npm install          # 安装依赖
npm run build        # 按依赖顺序编译全部包 (database 的 prebuild 会执行 prisma generate)
npm test             # 全工作区测试；依赖各包 dist，需先 build
npm run lint         # 前端 next lint
npm run typecheck    # 前端与 worker tsc --noEmit
npm start            # 本地开发：同时启动 server (tsx watch) 与 web (next dev)
```

单包操作：`npm run build -w @zhanshuang/server`、`npm test -w @zhanshuang/game-engine`、`npm test -w @zhanshuang/worker`、`npm run deploy -w @zhanshuang/worker`、`cd apps/web && npx vitest run`。

提交前至少确保：`npm run build && npm run lint && npm test` 全部通过。CI (`.github/workflows/ci.yml`) 执行同样的步骤。

## 关键约定

### 构建顺序
根 `package.json` 的 `workspaces` 按依赖顺序显式列出 (shared → game-rules → game-engine → database → server → worker → web)。**不要改回 `packages/*` 通配**，否则 npm 按字母序构建，干净克隆时 `game-engine` 会先于 `shared` 编译而失败。新增包时按依赖关系插入到正确位置。

### 服务端是唯一权威
- 一切对局状态变更必须经过 `GameEngine.dispatchAction`；前端只发送意图 (`game:action` / `game:choice`)，不做最终裁定。
- 下发给客户端的对局状态必须经 `sanitizeGameStateForPlayer` 脱敏 (对手手牌、牌库顺序、对手暗费不可泄露)。新增 `GameState` 字段时同步检查脱敏逻辑。

### Socket 身份
- 连接身份在握手中间件 (`apps/server/src/socket/gateway.ts` 的 `io.use` 或 Worker WebSocket 升级鉴权) 中一次性确定：携带有效 JWT (`auth.token` 或 `?token=...`) 即为登录用户；否则为游客，游客不得冒用已注册账号的 userId。
- **事件处理器一律使用握手确定的 `userId`，绝不信任事件负载中的 `userId` / `playerId`。**
- 对局类事件必须校验发起者属于 `session.playerIds`；引擎层 `dispatchAction` 也会拒绝非本局玩家。
- 每个 `socket.on` 处理器都要 `try/catch` 并以 `game:error` 回报，未捕获的异步异常会导致进程崩溃。
- 前端游客 ID 由 `getGuestUserId()` 为每个浏览器生成唯一值，不要再引入 `'guest'` 之类的共享占位 ID。

### 房间与卡组
- 房间密码只以摘要形式保存在 `RoomManager.roomPasswords` 与仓储中，绝不放进 `PublicRoomState` 或 URL。新建房间时密码经 `sessionStorage` (`src/lib/room-password.ts`) 从大厅传给等待室。
- 系统预组 (`userId === 'system'`) 只读：REST 与 Socket 都不得修改或删除。客户端上传的自定义卡组必须通过 `validateDeck`，且只能写入该玩家自己名下。

### 鉴权与密钥
- 密码使用 `hashPassword` (scrypt + 随机盐) 或 Worker 端 PBKDF2-SHA256 (兼顾 10ms CPU 限制与安全性)，校验使用 `verifyPassword`。
- `JWT_SECRET`、`ADMIN_PASSWORD` 通过环境变量或 Cloudflare Secrets 配置，绝不在代码中硬编码默认密钥或密码。
- `/api/admin/*` 一律挂 `verifyAdmin`。

### 数据持久化现状
- **本地/便携 Node 服务 (`apps/server`)**：目前固定使用 `Memory*Repository`，服务重启后账号、卡组、对局记录清空。
- **云端生产环境 (`apps/worker`)**：已正式接入 Cloudflare D1 关系型数据库，用户账号、自定义卡组、对战记录与房间元数据均**真正持久化保存**；卡图由 Cloudflare R2 对象存储托管并支持 1 年强缓存。详细部署与运维见 `docs/deploy/cloudflare.md`。

## 前端约定

- 卡图：小尺寸展示 (≤ 约 250px) 一律用 `getCardThumbnailUrl()` 加载 `public/cards/thumbs/*.jpg` (约 45 KB)，并以 `handleThumbnailError()` 回退原图；原图 PNG 平均约 2 MB，仅用于大图检视。新增卡图须同时生成缩略图 (`scripts/generate-thumbnails.ps1`)。
- 对局页 `src/app/game/[id]/page.tsx` 体量很大，避免在其中新增高频 `setState` (如全局 `mousemove`)，高频状态放进叶子组件内部并用 `requestAnimationFrame` 节流。
- Hooks 必须在任何提前 `return` 之前调用 (`next lint` 会以 `react-hooks/rules-of-hooks` 报错)。
- Tailwind v3：入场动画类 (`animate-in`、`fade-in`、`zoom-in-95`、`slide-in-from-*`) 由 `tailwindcss-animate` 插件提供；非默认尺寸 (`w-26`、`h-22`、`rounded-xs`、`shadow-xs`) 已在 `tailwind.config.ts` 扩展。使用其他非默认工具类前先确认其存在，否则会静默失效。
- 剪贴板使用 `src/lib/clipboard.ts` 的 `copyText()`：局域网 http 访问时 `navigator.clipboard` 不可用。
- 图标按钮需提供 `aria-label`；弹窗使用 `role="dialog"` + `aria-modal="true"`。
- 全局 `user-select: none`，表单控件已在 `globals.css` 中单独放开，不要移除该规则 (会导致 iOS Safari 输入框无法使用)。

## 测试

- 引擎规则：`packages/game-engine/test`，新增卡牌效果或规则分支时补充用例。
- 服务端：`apps/server/test`，使用 `createServerApp()` + `fastify.inject` / `socket.io-client`；安全相关回归见 `security-hardening.test.ts`。
- 前端：`apps/web/test` 使用 `react-dom/server` 的 `renderToString` 做渲染冒烟测试。zustand v5 在服务端渲染时读取 store 的初始状态，需要注入状态时参考 `game-page.test.tsx` 中 `vi.doMock` 的写法。
- 联机流程手动验证：`npm start` 后用两个独立浏览器会话 (或一个普通窗口 + 一个无痕窗口) 进入同一房间。

## 仓库注意事项

- `apps/web/public/cards` 约 3 GB 卡图直接存于 Git 中，克隆很慢。CI 使用 blob-less + 稀疏检出跳过卡图。不要再向仓库提交大型二进制文件，新增素材应考虑 Git LFS 或对象存储。
- `scripts/` 根目录为正式流程脚本 (启动、打包、压测、卡表生成)；`scripts/dev/` 为一次性排查脚本，不参与构建。脚本中不要硬编码个人本地路径，改用命令行参数或环境变量。
- `push-to-github.bat` 不会强制推送；不要在脚本中加入 `--force`。
- 卡牌插画与商标权利归库洛游戏所有，本项目仅限非商业交流用途。

# 《战双帕弥什 卡牌对战》全项目深度审计报告

> 审计日期：2026-11-23
> 审计范围：安全与双后端、规则引擎内核（含 PR #33 增量）、官方全表 490 张声明式卡牌（ST01~ST06、BP01~BP04、PR）、前端交互接线与 UI 规范、测试与 CI 体系
> 审计基线：`main` 分支 `70d157c`（PR #33 已合并，官方全表 **490 / 490** 张卡均已迁入声明式 DSL 注册表）
> 规则依据：[规则整理](../rules/rule-specification.md)（官方《综合规则》V1.4 及官方 Q&A 第 1~10 期）

---

## 一、审计总览与核心结论

### 1.1 基线构建与测试实况 (`70d157c`)

- **`npm run build` / `npm run typecheck` / `npm run lint`**：全工作区均 **0 错误通过**（`apps/web` 仅余 2 条既有 `react-hooks/exhaustive-deps` 警告）。
- **`npm test`**：
  - `@zhanshuang/game-rules`：2 files / **9 tests 通过**；
  - `@zhanshuang/game-engine`：24 files / **265 tests 通过**（含 `bp02.test.ts` 23、`bp03.test.ts` 24、`bp04.test.ts` 16、`pr.test.ts` 18）；
  - `@zhanshuang/database`：1 file / **4 tests 通过**；
  - `@zhanshuang/server`：6 files / **35 tests 通过**；
  - `@zhanshuang/web`：3 files / **19 tests 通过**；
  - `@zhanshuang/worker`：前 3 个单测文件（16 tests）通过，第 4 个文件 `e2e.workerd.test.ts` 在 Windows 本地触发 `workerd` / libuv 断言崩溃（`src\win\fs-event.c, line 72`）。
- 工作区另存有 3 个未跟踪文件（`docs/review/playtest-discrepancies.md`、`wrangler.toml`、`卡牌效果差异报告.md`）。

### 1.2 五维度审计总评

| 审计维度 | 核心问题回答 | 严重问题计数 | 综合评估 |
| --- | --- | --- | --- |
| **安全与双后端协议** | 是否存在高危漏洞与双端分歧？ | **3 Critical / 9 High / 8 Medium / 4 Low** | PR #33 未改 `apps/server` 与 `apps/worker`；游客冒充窃取手牌/代投降、Node REST 篡改系统预组、Socket 单包崩服、Node 全服 8.13 协战失效、便携版打包 `.env`、`NativeWebSocketClient` 断线失灵等全部仍在 |
| **规则引擎内核** | 引擎是否优化完整？ | **8 Critical / 12 High / 9 Medium / 5 Low** *(含 PR #33 增量)* | 490 卡全量注册已成形（`staticRules` 64 条、自动触发 112 个），但整体完整度约 **75%~80%**、稳定性约 **70%**；仍存调度刷牌、事件流泄密、SBA 死循环、阶段机穿透、8.9/8.10 违背多项 Q&A，且 PR #33 新增 `USE_INSTANT` 越权、`MOVE_CARDS` 忽略返回值、`SIGNAL_ORB` 背面泄密与 490 卡无缓存 CPU 风险 |
| **已迁移 490 张声明式卡** | 490 卡是否都能正常发动与结算？ | **ST01~BP01：10C/10H；BP02~PR：17C/26H** | 490/490 已全部注册且不再触发旧 `card-effects.ts` 角色自爆/双倍扣费，但并非全部可用：全表存在十余张**完全白板/空桩/必败/反向违背规则卡**（如 `BP03-010`/`BP04-015`/`PR-015`/`BP03-002`/`BP04-071`/`BP04-012`/`BP04-035`/`BP04-047`/`BP04-059`/`PR-020`/`PR-028` 等），且仍存冠军卡 8 张构筑漏洞、ST04 缺特征、暗费泄露等 |
| **前端交互接线与 UI 规范** | 真实玩家在 UI 中能否操作引擎机制？ | **9 Critical / 8 High / 6 Medium / 2 Low** | **交互层严重滞后于 #26~#33**：`PERFORM_ASSIST`、`USE_INSTANT`、`EQUIP_ITEM`、`costCardInstanceIds` 出现 0 次，辅助机/单独装备隐身、非战场（手牌/墓地/费用区/下方）及信号球区升变无入口、三消规则写反、连续弹窗死锁 |
| **测试、验证与 CI 体系** | 测试全绿是否代表真实可用？ | **多处覆盖盲区与假阳性** | `bp02~pr` 测试共漏测 **70 张**独立卡号，部分用例避开 Bug 或缺断言；71 条 Q&A 仅覆盖 ~32%；Fuzz 仅跑 ST01~ST03（8.6% 卡池）且 0 次测及【起】/升变/装备/协战；回放回归 0%；CI 漏跑 `typecheck` 与 `build:cf-static` |

---

## 二、安全漏洞、双后端协议一致性与部署风险

> 注：PR #33 未修改 `apps/server` 与 `apps/worker`，且对 `apps/web` 仅修改了 `card-stats.ts`（+2 行）与 `ui-components.test.tsx`，本章节发现 100% 适用于当前 `main`（`70d157c`）。

### 2.1 Critical（严重漏洞）

#### [SEC-C1] 双后端游客身份可任意冒充：对手手牌窃取、代为投降与密码房绕过
- **文件与行号**：
  - Node 握手：`apps/server/src/socket/gateway.ts:131-136`
  - Node 房间免密重入：`apps/server/src/services/room-manager.ts:206-211`
  - Node 公开房间列表（暴露 `userId` / `currentGameId`）：`apps/server/src/app.ts:425-446`
  - CF 握手：`apps/worker/src/room-do.ts:154-168`
  - CF 房间免密重入：`apps/worker/src/room-do.ts:246-258`
  - CF 公开房间列表与 DO HTTP 接口：`apps/worker/src/routes/api.ts:209-227`、`apps/worker/src/room-do.ts:127-129`
- **复现机制**：双端握手在无 JWT 时接受客户端自报 `query.userId`（Node）或 `?guestId=`（CF），仅检查是否撞名已注册用户而不校验所有权；无鉴权 `GET /api/rooms` 直接返回房内玩家真实 `userId`（如 `guest_xxx`）。攻击者获取任意房内游客 ID 后，携带该 ID 重连即可通过 `game:reconnect` 窃取对手 `myHandCards`/暗费明文、`SURRENDER`/`game:leave` 强行代投降，或跳过密码房与人数上限重入房间。
- **修复方向**：新增服务端签名的游客凭据接口（如 `/api/auth/guest` 签发短期 HMAC/JWT 游客令牌），握手只信任验签后的登录 JWT 或游客 JWT，彻底废弃明文自报 ID。

#### [SEC-C2] Node 版 REST 卡组与房间接口无鉴权：可篡改官方预组、改删他人卡组与强关任意房间
- **文件与行号**：
  - `POST /api/decks`：`apps/server/src/app.ts:473-520`（L481-485）
  - `PUT /api/decks/:id` & `DELETE /api/decks/:id`：`apps/server/src/app.ts:522-573`
  - `POST /api/rooms` & `DELETE /api/rooms/:id`：`apps/server/src/app.ts:429-455`、`apps/server/src/services/room-manager.ts:56-69,95`
- **复现机制**：`POST /api/decks` 未挂载 `verifyUser` 且信任 `body.userId`，请求 `{ "id": "deck-st01", "userId": "system", ... }` 因 `deck.userId === userId` 绕过 403 直接改写全服官方预组；`PUT/DELETE /api/decks/:id` 无 JWT 校验可改删他人卡组；`POST/DELETE /api/rooms` 无鉴权可强关任意房间、覆盖 `roomId` 或踢出指定 `creatorId`。
- **修复方向**：对齐 Cloudflare 版，`/api/decks` 写操作强制 `verifyUser`、以 `req.user.userId` 为唯一归属并无条件拒绝系统预组；移除或管理员锁定 `POST/DELETE /api/rooms`（压测脚本改走 Socket 建房）。

#### [SEC-C3] Node 版 5 个 Socket.IO 处理器在 `try` 外解构参数：单包触发进程崩溃（1-Packet DoS）
- **文件与行号**：`apps/server/src/socket/gateway.ts:169,238,268,353,420`；同类隐患（CF 版）：`apps/worker/src/room-do.ts:181-187`
- **复现机制**：函数签名 `async ({ gameId, action }) => { try { ... } }` 在 `try` 块外解构，发送 `null`/`undefined` 直接抛出未捕获 rejected Promise 击溃 Node 进程；CF 版收到 JSON `"null"` 时 `L185 const payload = parsed.payload ?? {}` 位于 `try` 外同样抛出异常。
- **修复方向**：统一接收 `(rawPayload?: unknown)` 并在 `try` 内校验非空 plain object。

### 2.2 High（高危缺陷与双后端同步断点）

| 编号 | 缺陷描述 | 精确位置 | 影响与修复要点 |
| --- | --- | --- | --- |
| **SEC-H1** | Node 版 `registerCardEntity` 覆盖默认 `cardDb` 时漏传 `assistConfig` 与 `imageUrl` | `apps/server/src/services/game-session-manager.ts:24,34-66,101-106` | **导致 Node 后端全服 8.13 协战 (`PERFORM_ASSIST`) 100% 失效**；需补齐 `parseAssistConfig(card.rulesText || '')` 与 `imageUrl` |
| **SEC-H2** | 便携版打包脚本将开发者本机 `.env` 打入公开发布 ZIP | `scripts/package-portable.mjs:65-71` | 泄露本机 `JWT_SECRET`/`ADMIN_PASSWORD` 且全用户共用密钥；改为仅拷贝 `.env.example` 并在首次启动随机生成 |
| **SEC-H3** | CF 版 `RoomDO` 向未通过密码校验/未加入房间的全部 WS 连接广播 | `apps/worker/src/room-do.ts:127-129,826-853` | 连上 `wss://.../ws/rooms/<密码房>` 即可旁听房间状态与 `game:bundle`，HTTP GET 亦暴露 `roomCode`/`userId`；仅向已认证成员推送 |
| **SEC-H4** | Node `room:ready` 未拦截 `PLAYING`；CF `room:select_deck` 对局中可改卡组 | `apps/server/src/services/room-manager.ts:469-531`、`apps/worker/src/room-do.ts:346-352` | Node 劣势方取消准备重开可洗白败绩；CF 对局中可篡改 D1 `matches` 战绩卡组。双端在 `PLAYING` 时一律拒绝 |
| **SEC-H5** | 双后端 `game:events` 广播未经玩家视角脱敏 | `apps/server/src/socket/gateway.ts:404-406,452-454`、`apps/worker/src/room-do.ts:826-844` | 暴露 `CARDS_DRAWN.drawnCardIds`、`CARD_MOVED.cardInstanceId`、`CHOICE_RESOLVED.selectedIds`；需接入 `sanitizeGameEventsForPlayer` |
| **SEC-H6** | CF 版 `EchoDO` 每条公开 `ping` 写 SQLite；`RoomDO` 房间事件无限流 | `apps/worker/src/echo-do.ts:50-54,92-96`、`apps/worker/src/room-do.ts:187-217,250-258,346-373` | 公开 `/ws/echo` 高频 ping 可百秒打光 CF 免费版 10 万行 DO 写入额度；改为内存计数并统一 WS 限流 |
| **SEC-H7** | 登录接口无限流与密码长度上限；Node 同步 `scryptSync` 阻塞事件循环 | `apps/server/src/app.ts:35-60,294-370`、`apps/worker/src/routes/api.ts:161-180` | 超长密码并发请求可卡死 Node 主线程；改为异步 `crypto.scrypt`、限制 `password.length <= 128` 并接入登录限流 |
| **SEC-H8** | Node REST 卡组接口与 `validateDeck` 未校验整数 `count` | `packages/game-rules/src/validators/deck.ts:41-47`、`apps/server/src/app.ts:495-516` | 传 `count: 2.5` 可通过校验并在开局 `for` 循环展开突破 50 张与 4 张上限；需校验 `Number.isInteger(card.count)` |
| **SEC-H9** | 前端 `NativeWebSocketClient` 断线不触发 `disconnect`；`DeckDetailClient` 保存无鉴权 | `apps/web/src/lib/socket.ts:65-67,196-205`、`apps/web/src/app/decks/[id]/DeckDetailClient.tsx:855-877` | `ws.onclose` 时 `readyState` 已为 `CLOSED(3)` 致 `wasConnected` 恒为 `false`（CF 断网提示永不触发）；卡组同步未走 `authFetch` 在 CF 恒 401 |

### 2.3 Medium & Low（中低危缺陷、双端协议与部署偏差）

- **Medium**：Node `room:start` 并发竞态 & 双端房主开局校验缺失（`gateway.ts:286-319`、`room-do.ts:375-383`）；CF `RoomDO.alarm()` 在会话丢失或结束时未清 `offlineSince` 导致 100ms 死循环唤醒（`room-do.ts:598-657`）；双端分歧（Node 失败行动污染回放、CF `resolveDeck` 不查 D1、Node 硬编码预组未复用 `OFFICIAL_STARTER_DECKS`、CF `/api/admin/cards` 忽略筛选与 `take`）；`build-cf-static.mjs` 硬编码个人域名且未剥离 `NEXT_PUBLIC_SERVER_URL`；`package-portable.mjs` 中文 `.bat` 以 `'ascii'` 写入破坏字节、硬编码 Node 路径、网关漏 `/health` 与 WS `upgrade` 双向清理；自建未设 `NODE_ENV=production` 暴露 `player1/123456` 及内存仓储无淘汰 OOM；REST 请求体缺基础类型检查报 500；DO 休眠清空 `events` 与重置内存 `choiceSeq` 引发决策 ID 碰撞与非确定性。
- **Low**：`scripts/generate-cards.mjs` / `gen-engine-cards.mjs` / `sync-card-table.mjs` / `generate-dual-mat.mjs` 含个人本地绝对路径且旧模板会抹掉 `assistConfig`；`scripts/stress-test.mjs:52` 硬编码 `'admin888'`；`docker-compose.yml` 与 `apps/web/Dockerfile` 的 `standalone` 与环境变量失配；WS query 传 JWT、`CORS_ORIGIN` 未生效、CF JWT 未显式检查 `alg/exp` 类型。
- **动态路由核验**：`apps/worker/src/index.ts:16-22` 的 `DYNAMIC_ROUTE_PLACEHOLDERS`（`cards/decks/game/replay/rooms`）与前端 5 个 `[id]/page.tsx` 完全一致。

---

## 三、规则引擎内核完整度与缺陷审计 (`packages/game-engine`)

### 3.1 PR #33 增量与旧审计项对照实况

1. **490 卡全量注册实测**：注入全套 490 张官方卡牌后，DSL 规格库注册 **490** 张（100% 覆盖；全部 `ROLE` 已配 `entry`/`entries`/`vanillaEntry`，全部含【起】卡已配 `activate`/`activates`，仅 61 张信号球战术由 `handlePlayTactics` 分支 A/B 处理），自动触发定义 **112** 个，静态持续规则 **64** 条（`NON_STAT` 28、`STAT` 36）。
2. **`card-effects.ts`（3,266 行）现状**：通用回退（`resolveUniversalTacticsEffect` / `resolveUniversalEntryEffect` / `resolveUniversalActivatedEffect`）及旧 171 卡特判（约 **1,500+ 行**）已变为不可达死代码；当前真实可达路径收敛为 5 类：选项构造辅助、61 张信号球战术、全部【充能自】、4 张非战术【瞬时】、及 ~14 个具体 `PendingChoice` 回流分支。
3. **PR #33 修复与未修对照**：PR #33 新增了 `expandBaseTraits`（兼容 `机械教会↔火花`、`神寂启示录↔异聚体`、`太刀→封刃太刀`）、`normalizeCardName`（兼容 `卡列尼娜· 辉晓`）及 `SbaEngine` 9.5.4 辅助机超限与多《血契者》清理；但下方列出的 **ENG-C1 ~ ENG-C5、ENG-H1 ~ ENG-H7** 等既有内核级缺陷在 `70d157c` 中**全部依然存在**，且 PR #33 新增代码又引入了 **ENG-C6 ~ ENG-C8 与 ENG-H8 ~ ENG-H12**。

### 3.2 Critical（严重级别，含既有与 PR #33 新增）

| 编号 | 缺陷描述 | 精确位置 | 根因与影响 |
| --- | --- | --- | --- |
| **ENG-C1** | `RESOLVE_MULLIGAN` 未校验重复卡牌 ID（作弊漏洞） | `packages/game-engine/src/engine.ts:2406-2427` | 未检查 `new Set(toBottom).size === toBottom.length`，传入同一张手牌 ID 重复 40 次可实际放回 1 张却抽空 40 张牌库 |
| **ENG-C2** | 隐藏信息经未脱敏 `GameEvent`、持久 `instanceId`、非公开触发源与牌组序泄露 | `state/sanitize-state.ts:3-25,51-76,92-103`、`zone-manager.ts:207-216,572-577`、`create-game.ts:165-169` | 事件流广播 `drawnCardIds`/`cardInstanceId`/`selectedIds`；暗费/背面球保留 `instanceId`；`publicPendingTriggers` 暴露手牌/牌组触发源；扫描 `DECK` 按物理序下发选项；`GAME_STARTED` 含明文 `seed` |
| **ENG-C3** | `CheckTimingManager` 内层 SBA `do...while` 无迭代上限 | `packages/game-engine/src/priority/check-timing.ts:39-42` | 内层循环不递减 `loopLimit`，遇反复触发的规则处理会死循环卡死进程 |
| **ENG-C4** | 8.10 置换前置破坏、`moveCard` 返回值忽略与直写 `card.zone` 后门（**PR #33 扩大**） | `card-effects.ts:76-91,852-853...,3186`、`sba-engine.ts:112`、`combat-manager.ts:511`、`battlefield-manager.ts:239,515,681` | `card-effects.ts` 7 处前置 `handleCardLeaveField` 破坏不离场置换与 Q&A·9 顺序；破坏路径忽略 `moveCard` 返回值仍发 `CARD_DESTROYED` 与【贯通】；`card-effects.ts:3186`（非战术瞬时）等直写 `card.zone` |
| **ENG-C5** | `PhaseMachine` 无视 `currentPendingChoice` 与 `FINISHED` 强行同步推进 | `packages/game-engine/src/phases/phase-machine.ts:59-105,131-156,192-263` | 竖直/抽牌/结束阶段遇挂起决策或败北仍同步抽牌、清修饰器、暗费送墓（且 `TURN_STARTED` 错放竖直之后，违背 6.2.1.a） |
| **ENG-C6** | **【PR #33 新增】** `USE_INSTANT` 缺失优先权校验，可跨优先权抢发 | `packages/game-engine/src/engine.ts:479-493`、`card-effects.ts:3046-3049` | 仅校验 `if (!window)` 而未校验 `timingWindow.priorityPlayerId === action.playerId`，任意瞬时窗开启期间非优先权方均可抢发 `BP03-054`/`BP04-004`/`007`/`028` 并翻转优先权 |
| **ENG-C7** | **【PR #33 新增】** `MOVE_CARDS` 全线忽略 `moveCard` 返回值，`UNDERNEATH` 直写状态绕过 8.10 置换 | `packages/game-engine/src/effects/dsl/interpreter.ts:2851-2968` | 非战场分支忽略 `moveCard` `false` 返回值仍记入 `moved` 误触发「若如此做」(8.6.4)；`UNDERNEATH` 对战场卡前置 `handleCardLeaveField`、对非战场卡忽略返回值、对搭档卡直接清指针绕过 `PARTNER_RELEASED` 与防解除保护 |
| **ENG-C8** | **【PR #33 新增】** `SIGNAL_ORB` 背面牌、`DECK` 物理序、`COST` 暗费与手牌未公开泄露 | `interpreter.ts:2381-2420,2762-2771,2803-2818,3908-3914`、`custom-handlers.ts:187-190,259-272,832-842` | `matchesFilterSafe(signalOrbColor)` 未判 `isFaceUp`，`CHOOSE_ZONE_CARDS`/`REORDER_ZONE`/`PLACE_ORB_AT_POSITION` 直接把背面信号球真身发进 `options`；`BP02_048` 扫描 `COST` 未过滤 `c.isFaceUp` 泄露并可牺牲暗费；`BP03_059` 公开手牌不移入公开区也不发公开事件 |

### 3.3 High（高级别内核缺口）

1. **[ENG-H1] 8.9 持续效果层 5 项规则偏差（违背 Q&A·1/3/6/10）**：`continuous-effects.ts` Layer 1 依赖顺序 (8.9.1.d) 先取基础特征且三元组排序违反严格弱序；`evaluateLayer1Traits` 漏 `PARTNER`/`UNDERNEATH`/`EQUIPPED`；8.3.4 误杀先失能后获能力（Q&A·3），漏判静态失能且失能时误删外部 `CANNOT_ATTACK`；装备/协战基本 PP 放 Layer 0 被 Layer 2 `setPP` 覆写（违背 Q&A·6/10）；`BP01-050` 对失能宿主仍加【充能+1】（违背 Q&A·1）；`phase-machine.ts:212-221` 先清期限后解协战违背 Q&A·10；`BUFF_ROLE_PP` 多处漏传 `appliedByPlayerId`。
2. **[ENG-H2] `endCombat()` 先清空 `currentCombat` 与 `combat-*` 再发 `ATTACK_ENDED`**：`combat-manager.ts:661-691` 顺序倒置（PR #33 仅借事件附加字段绕过 `BP03-023`）。
3. **[ENG-H3] 墓地/手牌/协战机制未闭环**：`ascensionConfig.sourceZones` 死字段与非手牌未豁免属性检查（`engine.ts:836-855`，影响 `BP02-026`/`BP02-036`）；浮空升变未校验目标卡位空闲；`battlefield-manager.ts:536-544` 不支持手牌【浮空】(`BP03-002`/`BP04-071`) 且下方牌改 `'PROCESSING'` 违反 10.18.3.b/Q&A·7；`attachPartner` 传 `force=true` 违背 Q&A·8 且漏时间戳/次数清理。
4. **[ENG-H4] 【贯通】与直伤 `applyDamageToPlayer` / `performAttackCharge` 同步执行未挂起**：`zone-manager.ts` 与 `combat-manager.ts`，翻出带决策的【充能自】(`10.2.1.b`) 前已被移出 `PROCESSING` 致失效，且【贯通】(`10.7.1`) 未进检查时机。
5. **[ENG-H5] 触发与 SBA 9.5 缺失**：装备/辅助机出场未发 `CARD_ENTERED_FIELD`；`SbaEngine` 缺失 9.5.2/9.5.3（双持失能卸装）；双《荣光护盾》同目标被 `Set` 去重（Q&A·7）且 `ST04-001/002` 漏 `deferOncePerTurnUntilCostPaid`（10.1.2.b）。
6. **[ENG-H6] `hasUsableInstant` 读取时机与减费不同步**：`dispatchAction:518-524` 中 `syncCostStats` 仍在 `continueFlow` 之后，且 `hasUsableInstant` 未算 `playDiscardDiscount`/`playSacrificeDiscount`。
7. **[ENG-H7] 内存 `choiceSeq` 与 `Date.now()/Math.random()`（PR #33 新增 5 处）**：`interpreter.ts:94`、`preset-cards.ts:21`、`card-effects.ts` 40+ 处破坏 DO 快照恢复与重放确定性。
8. **[ENG-H8]【PR #33 新增】`PLAY_CARD_SACRIFICE_DISCOUNT` & `DISCARD_DISCOUNT` 丢弃 `costCardInstanceIds`、漏部署参数且忽略牺牲返回值**（`engine.ts:890-1024,1574-1694`）。
9. **[ENG-H9]【PR #33 新增】`PR-041`/`BP04-001` `setCardType` 身份分裂**：`playAssistCard` 无条件销毁 `slot.assistCardId` 误杀变为角色的 `PR-041`（`battlefield-manager.ts:458-464`）；`sba-engine.ts:187` 漏调 `getEffectiveCardType`；`card-effects.ts:94-99` 漏扫辅助区；`engine.ts:96-114` `getFieldRoles` 过滤掉变为辅助机的 `BP04-001` 致其自身【永】PP/DP 失效。
10. **[ENG-H10]【PR #33 新增】`getEquipmentGrantedActivates`（`interpreter.ts:225-248`）未校验宿主 `CANNOT_GAIN_ABILITIES`**，且 `sharedTurnKey` 未加 `player:` 前缀。
11. **[ENG-H11]【PR #33 新增】`PR030_CHARGE_AUTO_ORB` 与 `BP04_028_INSTANT_ELIM`（`card-effects.ts:1937,2074,3224`）消球漏发 `ORBS_ELIMINATED` 触发事件与回合计数**。
12. **[ENG-H12] 490 卡基线下的性能与 Cloudflare 10ms CPU 风险**：本机 V8 实测满场 `refreshDisplayedStats` 平均 **1.549 ms / 次**、`dispatchAction` 平均 **0.821 ms / 次**；由于 `ContinuousEffectEngine` 无单帧缓存且每次遍历 64 条静态规则 + 候选源、`refreshDisplayedStats` 扫全量 100 卡、`canPlayerIgnoreAttributeForPlay` 线性扫描全部 **490** 条 DSL 规格（`interpreter.ts:174`）、`dispatchAction` 守卫前全量 `JSON.stringify`，在弱算力的 CF Workers 遇到连环触发与 DO 反序列化时极易逼近 **10ms CPU** 硬限。

### 3.4 Medium（含 PR #33 新增）

- `ReplacementEngine` 缺 8.10.2 多置换排序、`MODIFY_DAMAGE` 可序列化状态、3.6.4 二次置换链；
- `validator.ts:466-947` 漏检 `CHOOSE_ROLES.maxTotalCost`、`REGISTER_REPLACEMENT`、`orbValue >= 1`、`setCardType`、`treatedAsOrbColors`、`fieldIgnoreAttributeRule`、`playFromZones`、`playSacrificeDiscount.zones` 及 `entry/entries`、`activate/activates` 互斥；
- `REDIRECT_ATTACK`（`interpreter.ts:3082`）缺对方战场在场校验；`DETACH_AND_MOVE_PARTNER`（L3145）快照时机错位；
- `eliminatedOrbsByKareninaCountThisTurn` 在 `interpreter.ts:4191`（+1 次）与 `engine.ts:2271`（+count 张）口径分裂；
- `calculateFieldHandCostAdjustment` 键未调 `normalizeCardName` 且 `firstPerTurnOnly` 泛化缺失；`DISCARD_HAND_OVERFLOW` 死协议、`validateChoiceSelection` 缺「0 或精确 N」校验、默认 `skipMulligan=true`/`BASE_TEST_CARDS`、`BP02-089` 洗牌未发 `CARDS_SHUFFLED`。

---

## 四、全表 490 张官方卡表与声明式卡牌全量体检

### 4.1 官方卡表与基础解析器残余数据缺陷

1. **特征与卡名残余断裂**：`ST04-002/005/006/009` 仍缺 `"突击鹰小队"` 特征（`expandBaseTraits` 未覆盖，ST04 联动大面积断裂）；`BP02-028` `name` 含连续双空格 `"拉弥亚·深谣  强压层流"`（`normalizeCardName` 仅替换 `·\s+` 未处理双空格）；26 张卡规则文本仍残留 35 处爬虫 `icon` 字样（其中 `BP03` 占 24 张，如 `【3费 icon】` 破坏正则）；`PR-041/044`（`牌牌`）、`BP02-033`（`《红色信号球》`）、`BP02-048`（`<费用区>`/`<手牌>`）、`BP04-023`（`【0费 】`）文本错漏。
2. **`【冠军】` 异画 8 张构筑漏洞与非 URL 安全 ID**：`BP02-022【冠军】` 与 `BP03-003【冠军】` 虽已独立注册规格，但 `packages/game-rules/src/validators/deck.ts:26-28` 的 `extractCoreCardNumber` 仅剥离末尾 `[a-z]+$`，未剥离 `【冠军】`，玩家可合法投入 **4+4=8 张**同名卡（违反 5.1.2.b），且卡表生成非 URL 安全 ID `c-bp02-022【冠军】`。
3. **解析器缺口**：`ascension-parser.ts:50-55` 对 `BP04-001`「`1张及以上`」多对象升变降级为单选；`assist-parser.ts` 未区分精确费用且 BP04 墓地动态协战未接入 `resolveAssistCostOptions`。

### 4.2 先行迁移 171 张卡（ST01~ST06 & BP01）审计结果

> PR #33 新增的 `expandBaseTraits` 已缓解 `BP01-040`/`046` `<机械教会>` 0 匹配问题，但以下 Critical/High 级缺陷依然全部存在：

- **Critical**：`ST04-002/005/006/009` 缺 `突击鹰小队` 特征；`BP01-057/058` 2 张可选弃牌代价可只丢 1 张白嫖（`COST_DISCARD` 仅查 `=== 0` 未校验 `requiredMin`）；`BP01-028/030/039` 检索 `COST` 区漏 `isFaceUp: true` 泄露并操作暗费；`ST01-001` 等 11 卡效果出场【出】抢跑于放牌组底/后续步骤前，且 `ST05-002` 晖/暮双【出】顺序写死违背 Q&A·5；`BP01-025` 对下方 `BP01-050`【充能+1】不失效违背 Q&A·1；`ST04-001` 双贴去重违背 Q&A·7 与 `ST04-001/002` 不付代价仍耗【回合1】违背 10.1.2.b；`BP01-007`（Q&A·7）与 `BP01-049~052`（Q&A·2）前置条件过严；`BP01-017` 离场置换强制发动违背「可以」。
- **High / Medium**：`BP01-002` 手牌减费未接入 `matchesFilterSafe`；`BP01-040` 双【起】空手牌空发不报错；`ST03-003` 消球无视 `CANNOT_ELIMINATE` 与 `orbValue=3`；`ST04-003` 墓地诈尸；`BP01-058` 两条独立【出】顺序写死；`BP01-037` 锁死 3 球不能按 1 球用且漏伤害充能与非 DSL 公开；`BP01-031` 公开顶未按 9.2 更新牌库且空公开池弹空弹窗；`BP01-056` 非 DSL 消球漏触发且次数满仍弹顺序框；`ST05-008` 错挂宿主失能连坐；`ST03-008` 多加 `excludeAscension`；`BP01-051` 基本 DP+1 叠多层失真；`BP01-061` 借公开区暴露牌顶；`ST05-010` 奇数模式禁选 0 项。

### 4.3 PR #33 新增 319 张卡（BP02 / BP03 / BP04 / PR + `custom-handlers.ts`）深度补审结果

#### 统计总表

| 卡包 | 总张数 | 引擎层基本可用 | 轻中度/边缘偏差 | 核心失效 / 空桩 / 必败 / 严重偏差 | 单测完全未覆盖 |
| --- | ---: | ---: | ---: | ---: | ---: |
| **BP02** | 91 | 76 (83.5%) | 8 | **7** (`BP02-012/013/026/036/048/049/067`) | 30 |
| **BP03** | 90 | 57 (63.3%) | 12 | **13** (`BP03-002/004/005/010/028/042/045/046/057/058/059/060/062/075` 含交叉) | 13 |
| **BP04** | 89 | 65 (73.0%) | 18 | **6** (`BP04-012` 改红球 / `015` / `035` / `047` / `059` / `071`) | 24 |
| **PR** | 49 | 38 (77.6%) | 7 | **4** (`PR-015` / `PR-020` / `PR-028` / `PR-041` 转移) | 3 |
| **合计** | **319** | **236 (74.0%)** | **45 (14.1%)** | **30 (9.4%)** *(此外多张受前端 0 接线阻塞)* | **70** |

#### 分包核心 Critical / High 缺陷汇总

- **BP02（91 张）**：
  - `BP02-048`（`custom-handlers.ts:187-190`）扫描 `COST` 漏 `isFaceUp` 暴露并可牺牲暗费（Critical）；
  - `BP02-025`/`024`/`069` 暴露信号球区背面牌，`025` 任选而非取最下方且第 2【起】前端不可点；
  - `BP02-026`/`036` 墓地使用违背 8.6.2.a 强制查暗属性明费且前端无墓地入口；
  - `BP02-012`/`041` `playSacrificeDiscount` 仅扫描 `s.roleCardId`（漏掉装备 `BP02-047` 与搭档 `丽芙·极昼`），传 `costCardInstanceIds` 跳过减费，且 `BP02-012` 满 5 槽牺牲搭档违规腾位违背 Q&A·7；
  - `BP02-013`/`049` 战斗破坏置换无可选开关且 `013` 查印刷费非实时费；`BP02-067` 升变附加税用 `.some` 不叠加（违背 Q&A·4）；`BP02-052` 漏钩入《万世铭》置换（Q&A·5）；`BP02-060` 仅比明费漏算暗费；`BP02-037`/`047` 多张在场时跨宿主误选/误加。
- **BP03（90 张）**：
  - **空桩/必败/完全失效（Critical）**：`BP03-002` 手牌【起】浮空调 `airborneRole` 必败；`BP03-004` 第 1 项丢 2 火手牌后 `steps: []` 空操作；`BP03-010` 完整空壳 `tactics: []`；`BP03-042` 第 2 项 `then: []` 空壳且第 1 项未排除自身；`BP03-075` 仅【速攻】，蓝球送墓减费完全缺失；`BP03-057` 有手牌永不给【贯通】；`BP03-060` 选目标后缺 `MODIFY_STATS` 加 PP；`BP03-062` 缺同费判定与墓地回收；
  - **莉莉丝与核心体制（High）**：`BP03-005` 触发条件误查监听者自身而非进场卡；`BP03-058` 误用严格递增（非 Q&A·6 相邻 +1）且先拉人后洗牌；`BP03-059` 不洗回公开手牌、不发公开事件且牌库空不刷新；`BP03-064` 牌库空不刷新且抽空判负后仍派发弃牌抉择；`BP03-045`/`046` 排除了同卡号角色；`BP03-056` 复制墓地后移出墓地仍强塞回底且放弃可选代价吞掉置底；`BP03-013/014/016` 任选信号球且泄露背面牌、`014/015/025/061/063` 借 `REVEAL_TOP` 暴露牌库顶；`BP03-028` 消球漏触发且不让选多张《里·超刻》；`BP03-065` 缺 `isAttacking` 过滤且常规公开未钩入改费。
- **BP04（89 张）**：
  - **白板/死分支/必败（Critical）**：`BP04-012` 侵蚀 ≥ 6 改红球【充能自】选项文本虚构且派发不存在的 `CHARGE_AUTO_SELECT` 死分支（`card-effects.ts:1988-2019`）；`BP04-015` 仅 `vanillaEntry: true` 白板；`BP04-035` 支付 3 球仅记已用无任何出场与速攻；`BP04-047` 墓地【游戏1】替身抗攻完全缺失；`BP04-059` 墓地回底叠牌触发缺失且统计未过滤 `<神寂启示录>`；`BP04-071` 手牌 2 费浮空必败；
  - **规则与联动偏差（High/Medium）**：`BP04-001` 升变降级单选且变辅助机期间 `getFieldRoles` 过滤致自身 PP/DP 失效；`BP04-009` 只加宿主漏加其他 `<升格者>`；`BP04-011` 缺「我方玩家被攻击时」校验；`BP04-030` 缺 `fromZone` 必双触发；`BP04-034` 缺墓地搭档 PP-2000；`BP04-040` 因卡名规范化**反向违背规则**错误计入消球次数；`BP04-046` 缺第 1 项；`BP04-060` 牺牲减费漏扫 `assistCardId`；`BP04-070` 选错同名卡与升变重置回合1；`BP04-075` 无宿主名限制且缺第 2 项；`BP04-013/016/017/019/022/054` 自伤后用 `EROSION_COMPARE < 7` 阻断后续减侵蚀；`BP04-022` 用点数替代次数；`BP04-027` 不吃 `CANNOT_GAIN_ABILITIES`；`BP04-052` 仅后置 SBA 未防进场。
- **PR（49 张）**：
  - **白板/半残/空桩（Critical）**：`PR-015` 全卡白板；`PR-020` 第 2 项白杀己方升变角色不从下方拉人（注释误判 `HOST_UNDERNEATH`）；`PR-028` 第 2 项 `steps: []` 空桩且缺 `isAirborne` 过滤；
  - **偏差（High/Medium）**：`PR-041` 变角色卡槽分裂误杀（见 ENG-H9）且第 2 项置入《露娜·终焉》下方时把原下方空属性牌送墓；`PR-014` 缺被攻击目标与真升变校验；`PR-018/021/034/042` 缺 `isAttacking`/`isBeingAttacked` 过滤且 `PR-021` 漏搭档位《丽芙·极昼》；`PR-031` `<=7` 边界错误（应 `<7`）；`PR-046` 无条件获 `<万世铭>`；`PR-048` 仅显示雷属性背面球；`PR-036` 用 `min/max: 999` 替代全选；`PR-019/024/039` 多张置底缺重排。

---

## 五、前端交互断链、UI 性能与设计规范审计 (`apps/web`)

### 5.1 Critical（前端阻断级断链与弹窗死锁）

1. **`PERFORM_ASSIST` (8.13 协战) 0 接线**：`apps/web/src` 出现 0 次，ST06 及 BP04 全部协战卡在真实 UI 不可发动且自由时点空卡窗口。
2. **`USE_INSTANT` (10.8 非战术瞬时) 0 接线**：`BP03-054`、`BP04-004`、`BP04-007`、`BP04-028` 全部无法发动且自由时点空卡窗口。
3. **`PendingChoiceModal` 连续弹窗不重置 `selectedIds`**（`GameClient.tsx:1764-1770`、`PendingChoiceModal.tsx:251-289`）：未传 `key={activePendingChoice.id}` 且无状态重置，连续两步弹窗直接残留旧 ID 致死锁。
4. **`PendingChoiceModal` 违反 8.6.3 尽可能选择**（`PendingChoiceModal.tsx:291-294,514`）：`eligibleOptions.length < minSelections` 且 `> 0` 时禁用确认按钮，直接卡死对局。
5. **`PendingChoiceModal` 横向画廊 `justify-center` + `overflow-x-auto` 裁切左侧卡牌**（`PendingChoiceModal.tsx:409`）：全牌组检索时左半部分溢出负坐标无法滚动选中。
6. **`BattlefieldArenaView` 不渲染 `assistCardId` 与 `standaloneEquipmentId`，`EQUIP_ITEM` 0 接线**（`BattlefieldArenaView.tsx:269`、`GameClient.tsx:828-850,1282-1351`）：辅助机与单独占位装备在战场上隐身。
7. **特殊升变 0 入口 + 常规快捷升变错误硬编码**（`GameClient.tsx:1309-1340`、`CardContextMenu.tsx:131-149`）：信号球区正面升变 (`BP04-061`)、浮空升变、墓地升变 (`BP02-026`)、`extraAscensionCostCardId` 均无入口；快捷升变硬编码匹配露西亚或 `<=5` 费。
8. **`SignalOrbQueueView` 三消规则写反 + 不支持《万世铭》单张 3 球 + 忽略持续/禁止/背面字段**（`SignalOrbQueueView.tsx:12,39-178`）：允许非相邻三消、禁用 1 张 `orbValue=3` 消除、忽略 `effectiveOrbColors`/`CANNOT_ELIMINATE`/背面球。
9. **非战场、多【起】与装备赋予【起】入口缺失**（`BattlefieldArenaView.tsx:273-277`、`GameClient.tsx:777,1549,1658`、`GraveyardModal.tsx`、`CostZoneModal.tsx`）：仅检查宿主自身 `rulesText`（不查装备赋予）；手牌（`BP03-002`）、墓地（`BP02-036`）、费用区（`BP03-045/046/047/050`）、角色下方（`BP04-011/077~079`）均无发动入口；`abilityIndex` 写死 `0` 导致 `BP02-025` 等双【起】卡无法点第 2 项。

### 5.2 High / Medium / Low 汇总

- **High**：`END_PHASE` 瞬时窗口缺中央提示且窄屏/折叠 HUD 隐藏按钮；全局错误横幅 `z-50` 被弹窗遮挡；`PendingChoiceModal` 缺 `maxTotalCost` 实时合计/`distinctTraits`/`eligible===false` 禁用态；双持 `extraAttachedEquipmentIds` / `underneathCardIds` / 搭档明细不可见，且 `CardView` 与 `BattlefieldSlotView` 角标重叠；`CardDetailPanel`/`CardDetailModal` 不显示实时有效属性/修饰器/禁止（移动端盲打）；`getCardEffectiveCost` 本地减费缺失；`NativeWebSocketClient` 断线事件永不触发；`costCardInstanceIds` 前端 0 接线。
- **Medium**：`ProcessingZoneView` 混显双方且掩盖浮空卡；攻击/阻挡提示不准确（未拦截竖直目标、未校验 `isAttackTargeting`、缺 `unblockableMaxPP`、`isLegalPlay` 未传）；全局快捷键未排除弹窗；**6 类静默失效的 Tailwind v3 工具类**（`-top-8.5`、`z-15`、`bg-ink-900/98`、`backdrop-blur-xs`、`bg-ink-950/92`、`via-fg/12`、`brightness-60`）；`GameClient.tsx`（1910 行）触控拖拽无 rAF 节流 + 内联回调破坏 `React.memo` + `AuthProvider` 后台刷新重置对局/`RoomClient` 漏 `user` 依赖；`ReplayClient` 写死假沙盘与假数据兜底。
- **Low & 规范残留**：旧 Token 已在 #25 清除；剩余 12 处裸色/阴影（`BattlefieldArenaView.tsx:434-435`、`TargetingArrowOverlay.tsx:174-221`）、缺竖屏横屏提示、信号球紧凑计数栏缺色弱形状/字母、未配置 ESLint 防回潮、3 处「近似效果」提示仍过时写着「ST01~ST03」、`combatLogs` 事件覆盖不全。

---

## 六、历史文档核验（旧 `future-work.md` & `playtest-discrepancies.md`）

1. **PR #33 更新后的 `docs/future-work.md` 核验**：虽将 PR #33 写为「全表 490/490 完成」，但仍保留了大量过时项：§1 实测验收仍停留在 #14~#18、§2.3/§2.4/§2.6 夸大前端完成度、§5.5 远端旧历史分支实测仅剩 1 个 (`origin/feat/cf-stage-3-frontend-r2`)，另存 11 个已合并未删分支、§6 旧 Token 已清理完毕但仍挂未勾、「建议顺序」与真实阻塞脱节。
2. **`docs/review/playtest-discrepancies.md` 核验**：第 1 节 18 条差异中，`BP01-013`/`BP01-019`/`BP04-034` 存在早期误读；`BP01-003/029/039/066`、`ST05-006`、`BP02-034/051`、`BP04-015/067` 底层框架已修复或接入（但 `BP04-015` 退化为白板）；`BP02-089` 未发 `CARDS_SHUFFLED` 仍未修；`BP03-008`、`BP03-023`、`BP04-001` 仍存具体偏差。

---

## 七、测试体系、CI 与工程健康度审计

1. **新增卡包测试覆盖真实度**：`bp02.test.ts` 漏测 **30** 张（且多处测试主动避开同卡号、`fromZone`、暗费过滤）；`bp03.test.ts` 漏测 **13** 张（且 `BP03-058` 迎合错误递增、`BP03-005` 仅测自身）；`bp04.test.ts`（含全仓）漏测 **24** 张（含 `BP04-015/035/040/060/075` 等严重缺陷卡）；`pr.test.ts` 漏测 **3** 张（恰好是白板/半残的 `PR-015/020/028`，且 `PR-036` 存在重言式弱断言、`PR-041` 未查原下方牌）。
2. **规则条款与 Q&A 覆盖**：§9.5 违规卡牌中 9.5.2/9.5.3 仍 0 覆盖，§1.2.3 平局、§2.7.3 冠军卡限 4 仍缺测试；§11 71 条官方 Q&A 仅覆盖约 **32%** 且部分靠手工 `addCardModifier` 伪造。
3. **随机压测 (`fuzz-invariants.test.ts`)**：仍仅跑 `ST01~ST03`（8.6% 卡池）4 个种子，0 次测及 `ACTIVATE_ABILITY`/升变/`EQUIP_ITEM`/`PERFORM_ASSIST`/非战术瞬时/深层回滚，脱敏未查己方背面球、`opponentPendingChoice.prompt` 与 `GameEvent[]`。
4. **回放、前端与 CI**：回放回归为 **0%**；前端仅 3 个 SSR 冒烟测试、0 交互行为测试；`.github/workflows/ci.yml` 漏跑 `typecheck` 与 `build:cf-static`；Windows 本地 `workerd` 测试存在 `src\win\fs-event.c` 崩溃。

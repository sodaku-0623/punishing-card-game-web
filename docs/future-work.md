# 后续工作 (Future Work)

> 更新于 2026-11-23，基于 [2026-11 全项目深度审计报告](review/2026-11-full-audit.md) 整合重构，承接 [规则引擎内核审查报告](review/2026-10-engine-review.md) 与 [综合审查报告](review/2026-10-comprehensive-review.md)。
> 规则条款编号均指向 [规则整理](rules/rule-specification.md)。

---

## 一、当前进度基线与客观现状

### 1.1 已交付里程碑

| 项目 | PR |
| --- | --- |
| 回放接口不再暴露进行中对局的随机种子 | #13 |
| 决策校验、失败行动整体回滚、行动合法性检查 | #14 |
| 攻击与结束阶段可挂起的步骤流程，轮流使用【瞬时】 | #16 |
| 官方预组 ST01~ST03 全部 42 张卡按卡牌文本实现 | #17 |
| 区域状态、费用统计、升变条件、关键字词条 | #18 |
| 前端 PGR 未来科幻视觉重构 (组件体系、页面与对局界面迁移) | #25 |
| 自动能力触发框架 (8.5/8.7)、统一持续效果层 (8.9)、随机压测与隐藏信息防泄漏、决策多选顺位与待机触发展示 | #26 |
| 声明式效果原语 + 运行时校验器、ST01~ST03 全量迁移、近似效果前端标记、官方 Q&A 用例首版 | #27 |
| 替代效果与禁止效果统一引擎 (8.10 / 1.3.3)、10.15 冰冻状态与「视为」持续效果 | #28 |
| 8.13 协战、10.18 浮空、10.8 非战术瞬时、10.2.1.b 条件充能自、自选费用与 490 卡升变补全 | #29 |
| 490 张卡高频声明式原语补齐与官方预组 ST04~ST06 全部 41 张卡迁移 (ST01~ST06 共 83 张) | #30 |
| BP01 第一批 47 张卡声明式迁移 (灰鸦小队/升格者/七实与帕瓦/三头犬与突击鹰/全部信号球，累计 130 张) | #31 |
| BP01 第二批剩余 41 张卡声明式迁移 (深红囚影双太刀/曲·雀翎与万世铭/赛琳娜与梦赴光寥之乡，BP01 88/88 完成，累计 171 张) | #32 |
| 剩余 4 包共 319 张卡声明式注册 (`BP02` 91 / `BP03` 90 / `BP04` 89 / `PR` 49) 与莉莉丝自定义处理器接入，全表 490/490 完成注册 | #33 |

### 1.2 当前真实成熟度

- **规则引擎内核**：490 张卡已全部完成声明式注册（静态规则 64 条、自动触发 112 个），旧 `card-effects.ts` 通用回退（角色自爆、通用横置/双倍扣费等）已被接管。内核框架完整度约 **75%~80%**，稳定性与安全加固度约 **70%**（仍存在调度刷牌作弊、事件流与暗区泄密、SBA 内层死循环、阶段机穿透、8.9/8.10 违背多项 Q&A，以及 PR #33 新增的 `USE_INSTANT` 越权、`MOVE_CARDS` 忽略返回值与 490 卡无缓存 CPU 风险）。
- **卡牌效果精准度**：全表 490 张虽已全部注册，但距离「100% 按卡面与 Q&A 正常发动结算」仍有明确缺口：
  - `ST01~ST06` + `BP01`（171 张）存在 `ST04` 4 卡缺特征、2 张弃牌可 1 张白嫖、暗费检索泄露、11 卡【出】抢跑、Q&A·1/2/5/7 与 10.1.2.b 偏差；
  - `BP02~BP04` + `PR`（319 张）经审计约 **236 张 (74.0%)** 在引擎层基本可用、**45 张 (14.1%)** 存在轻中度偏差、**30 张 (9.4%)** 存在白板/空桩/必败/核心能力失效，且仍有 **70 张**独立卡号未进单测。
- **前端交互接线**：视觉重构 (#25) 已完成，但交互层滞后于 #26~#33 的引擎能力，协战、非战术瞬时、辅助机、单独装备、特殊升变、非战场/多【起】、单张 3 球三消均未接入 UI，且存在连续决策弹窗死锁与 Cloudflare 断线事件永不触发的严重缺陷。

---

## 二、P0 阻断级止血项（对外发布/后续迭代前必须优先完成）

### 2.1 安全与作弊漏洞止血（建议 1~2 个 PR）

- [x] **双后端游客签名凭据防冒充**（`apps/server/src/socket/gateway.ts`、`apps/worker/src/room-do.ts`、新增 `/api/auth/guest`）：由服务端签发短期游客 JWT，握手只信任验签后的登录/游客 JWT，彻底废弃明文自报 `userId`/`guestId`，堵住通过 `/api/rooms` 获取他人 ID 后偷看手牌、代投降及绕过密码房的漏洞。（已在 `fix/stage0-security-and-card-data` 完成）
- [x] **Node 版卡组与房间 REST 强鉴权**（`apps/server/src/app.ts`）：`POST/PUT/DELETE /api/decks` 强制挂载 `verifyUser`，以 `req.user.userId` 为唯一归属并硬拦截系统预组；移除或管理员锁定 `POST/DELETE /api/rooms`（压测脚本改走 Socket 建房）。（已在 `fix/stage0-security-and-card-data` 完成）
- [x] **Socket / WS 入口参数解构移入 `try` 块**（`apps/server/src/socket/gateway.ts:169,238,268,353,420`、`apps/worker/src/room-do.ts:181-187`）：统一接收 `unknown` 负载并在 `try` 内校验非空 plain object，消除单包 `null`/`undefined` 远程击溃进程风险。（已在 `fix/stage0-security-and-card-data` 完成）
- [x] **开局调度重复 ID 校验防抽空牌库**（`packages/game-engine/src/engine.ts:2406-2427`）：校验 `new Set(toBottom).size === toBottom.length`，堵住传入重复 ID 一次抽空牌库的作弊漏洞。（已在 `fix/stage0-security-and-card-data` 完成）
- [x] **Node 版恢复 8.13 协战能力**（`apps/server/src/services/game-session-manager.ts:49-65`）：`registerCardEntity` 补传 `assistConfig: parseAssistConfig(card.rulesText || '')` 与 `imageUrl`。（已在 `fix/stage0-security-and-card-data` 完成）
- [x] **便携版打包禁用本地 `.env`**（`scripts/package-portable.mjs:65-71`）：严禁将本机 `.env` 打入发布压缩包，改为复制 `.env.example` 并在首次启动时随机生成实例独立的 `JWT_SECRET` 与 `ADMIN_PASSWORD`。（已在 `fix/stage0-security-and-card-data` 完成）

### 2.2 官方卡表数据残余缺陷与构筑漏洞修复（建议 1 个 PR）

- [x] **修复卡表特征缺失与命名/文本污染**（`packages/game-engine/src/database/official-cards-data.ts`、`effects/continuous-effects.ts`、`scripts/generate-cards.mjs`）：（已在 `fix/stage0-security-and-card-data` 修复三处卡表数据源与 `normalizeCardName`）
  - 补全 `ST04-002/005/006/009` 的 `"突击鹰小队"` 特征，恢复 ST04 整套检索与护盾联动；
  - 扩展 `normalizeCardName` 支持连续空白（修复 `BP02-028` `"拉弥亚·深谣  强压层流"` 双空格断裂）；
  - 清理 26 张卡规则文本残留的 35 处爬虫 `icon` 字样（含 `BP03` 24 张卡），修正 `PR-041/044`、`BP02-033`、`BP02-048`、`BP04-023`、`BP04-061`、`ST05-011` 文本错漏。
- [x] **修复 `【冠军】` 异画 8 张同名构筑漏洞与 URL 安全 ID**（`packages/game-rules/src/validators/deck.ts:26-28`、`implementation-status.ts:195`、`official-cards-data.ts`）：`extractCoreCardNumber` 同步剥离 `【冠军】` 后缀防止 4+4=8 张违规构筑，将 `c-bp02-022【冠军】` 等卡 ID 规范为纯 URL 安全字符。（已在 `fix/stage0-security-and-card-data` 完成）
- [x] **启用注册表与官方卡表构建期交叉校验**（`packages/game-engine/src/effects/dsl/specs/starter-decks.ts`、`validator.ts`）：校验时传入 `cardDb` 并补齐新增字段校验。（已在 `fix/stage0-security-and-card-data` 完成）

### 2.3 前端致命交互断链与弹窗死锁修复（建议 2~3 个 PR）

- [x] **修复 `PendingChoiceModal` 三大卡死/裁切 Bug 与层级遮挡**（`apps/web/src/components/game/PendingChoiceModal.tsx`、`GameClient.tsx`）：传 `key={activePendingChoice.id}` 并监听重置 `selectedIds`；遵循 8.6.3 `minRequired = Math.min(minSelections, eligibleOptions.length)`；横向画廊改 `justify-start` 消除全牌组检索左侧裁切；错误横幅从 `z-50` 提至 `z-toast` (60)。（已在 `fix/stage1-frontend-interactive-bugs` 完成）
- [x] **接入 `PERFORM_ASSIST`（8.13 协战）与 `USE_INSTANT`（10.8 非战术瞬时）**（`GameClient.tsx`、`CardContextMenu.tsx`、`BattlefieldArenaView.tsx`、`AssistModal.tsx`、`CostZoneModal.tsx`、`battle-actions.ts`）：恢复 ST06/BP04 协战与 `BP03-054`/`BP04-004`/`007`/`028` 的网页端可操作性。（已在 `fix/stage1-frontend-interactive-bugs` 完成）
- [x] **渲染战场辅助机 (`assistCardId`) 与单独占位装备 (`standaloneEquipmentId`) 并接入 `EQUIP_ITEM`**（`BattlefieldArenaView.tsx`、`BattlefieldSlotView.tsx`、`GameClient.tsx`、`CardContextMenu.tsx`）。（已在 `fix/stage1-frontend-interactive-bugs` 完成）
- [x] **重构信号球区 `SignalOrbQueueView` 交互与规则**：严格校验物理相邻（4.16.2）；同步 `effectiveOrbValue` 并支持 Q&A·1 `orbValue === 3` 单张《万世铭》三消；读取 `effectiveOrbColors`、`effectiveProhibitions` (`CANNOT_ELIMINATE`) 并排除背面信号球 (`!isFaceUp`)。（已在 `fix/stage1-frontend-interactive-bugs` 完成）
- [x] **修复 `NativeWebSocketClient` 断线事件永不触发与卡组保存无鉴权**（`apps/web/src/lib/socket.ts`、`apps/web/src/app/decks/[id]/DeckDetailClient.tsx`）：引入 `hasOpened` 布尔字段恢复 Cloudflare 版断网重连提示；卡组保存改走 `authFetch`（已于 PR #34 与 `fix/stage1-frontend-interactive-bugs` 完成）。

### 2.4 全表关键卡牌致命失效、作弊与暗区泄密止血（建议 2 个 PR）

- [x] **PR #33 新增越权与暗区泄密止血**（已在 `fix/stage1b-instant-hidden-and-bp01-st04` 完成）：
  - `engine.ts` 与 `card-effects.ts` 为 `USE_INSTANT` 补齐 `timingWindow.priorityPlayerId === action.playerId` 校验，禁止跨优先权抢发非战术瞬时；
  - `BP01-028/030/039`（`bp01-part2.ts`）与 `BP02_048`（`custom-handlers.ts`）检索 `COST` 区强制加 `isFaceUp: true`，严禁暴露或牺牲背面暗费（3.6.3.b.2）；
  - `interpreter.ts` 修复 `SIGNAL_ORB` 背面球在 `CHOOSE_ZONE_CARDS` / `REORDER_ZONE` / `PLACE_ORB_AT_POSITION` / `signalOrbColor` 中的明文泄漏，以及 `BP03_059` 公开手牌移入公开区并与牌组顶公开牌一并洗回牌组。
- [x] **修复既有与新迁移卡的关键白嫖/空壳/必败 Bug**：
  - [x] `BP01-057/058`：保存并校验 `requiredMin`，禁止 2 张可选弃牌代价只丢 1 张白嫖（`interpreter.ts`，已在 PR #36 完成）；
  - [x] `ST04-001/002`（多张《荣光护盾》独立追踪 Q&A·7 & `deferOncePerTurnUntilCostPaid` 10.1.2.b）、`ST04-003`（限定在战场才置底）、`BP01-007`（Q&A·7）、`BP01-049~052`（Q&A·2）、`BP01-017`（可选离场）、`BP01-025/050`（Q&A·1）（已在 PR #36 完成）；
  - [x] 修复全表 **白板/空桩/死分支/必败卡**（Stage 1B-2，已在 `fix/stage1b-bp03-bp04-pr-cards` 完成）：`BP03-002` & `BP04-071`（支持手牌【起】直接浮空至 `PROCESSING`）、`BP03-004`（第 1 项从处理区拉出浮空誓焰）、`BP03-010`（补全战术 steps）、`BP03-042`（第 2 项清下方全破横置 & 第 1 项排除自身）、`BP03-075`（蓝球送墓减费）、`BP03-057`/`060`/`062`、`BP04-012`（修复虚构选项并改为标准红球【充能自】派发 `SIGNATURE_MOVE_EFFECT`）、`BP04-015`（补全【回合2】自伤抽牌/3选1触发器）、`BP04-035`（补全攻击结束拉搭档与墓地赋速攻）、`BP04-040`（禁止自身消球代价计入卡列尼娜次数）、`BP04-047`（补全墓地【游戏1】替身抗攻）、`BP04-059`（补全墓地回底叠牌触发器与统计过滤）、`PR-015`（补全下方赋予宿主离场【自】）、`PR-020`（补齐第 2 项从《杼菱》下方拉出升变角色）、`PR-028`（补全第 2 项回手并过滤 `isAirborne`）、`PR-041`（辅助机变角色卡槽防误杀与入露娜下方同步转移原下方牌）。

---

## 三、P1 引擎内核闭环、双后端加固与前端体验补齐

### 3.1 规则引擎内核闭环（对应 `2026-11-full-audit.md` 第 3 章）

- [x] **隐藏信息全链路脱敏**（已在 `fix/stage2a-hidden-info-sanitization` 完成）：新增 `sanitizeGameEventsForPlayer`（脱敏 `drawnCardIds`、秘密区 `cardInstanceId`、`CHOICE_RESOLVED.selectedIds`、`GAME_STARTED.seed`、`COST_PAID`、`ABILITY_ACTIVATED` 与对手 `CHOICE_REQUIRED`）并接入 Node/CF 双后端；隐藏区脱敏不保留跨区持久 `instanceId`（`hidden-cost:*`/`hidden-orb:*`）；`publicPendingTriggers` 与 `opponentPendingChoice` 隐藏非公开区触发源；扫描 `DECK` 不按物理序下发选项；新增 `PEEK_TOP` 私密查看原语并迁移 `BP01-061`、`BP03-014/015/025/061/063`。
- [x] **状态机安全与置换收口**（已在 `fix/stage2b-state-machine-and-replacement` 完成）：
  - `CheckTimingManager` 内层 SBA `do...while` 增加硬性熔断上限；
  - `PhaseMachine` 在竖直/抽牌/结束阶段遇 `currentPendingChoice` 或 `FINISHED` 立即挂起停止，修正 `TURN_STARTED` 至 6.2.1.a 竖直前；
  - `endCombat()` 在发射并结算完 `ATTACK_ENDED` 后再清空 `currentCombat` 与 `combat-*`；
  - 消除 `card-effects.ts` 7 处前置 `handleCardLeaveField`、`MOVE_CARDS` 校验 `moveCard` 返回值、清理所有直写 `card.zone` 后门（含 `card-effects.ts:3186` 与 `UNDERNEATH`）、补齐 `ReplacementEngine` 多置换排序、`MODIFY_DAMAGE` 与 3.6.4 二次置换链；
  - 将【出】能力统一迁入 `TriggerManager` (`CARD_ENTERED_FIELD`)，解决 11 张卡子角色抢跑、`BP01-058`/`ST05-002` 双【出】顺序与同时出场排序。
- [x] **8.9 持续效果层、8.3.4/9.5 规则、6.5.1.d 顺序与确定性 ID 收口（Stage 2C-1）**：
  - 已修正 8.9 Layer 1 两阶段依赖 (`providesTraits` → 非特征严格时间戳弱序) 与递归守卫、8.3.4 保留后获能力（Q&A·3，含词条/触发器/`chargeIsAbility`）与静态 `loseAbilities` 判定、装备/协战基本 PP/DP 按 4.18.2/8.13.4.b/Q&A·6/10 叠加在 `setPP`/`setDP` 之上、6.5.1.d 先解协战后运行检查时机再清期限（`CLEANUP` → `CLEANUP_EXPIRE` → `CLEANUP_POST`，Q&A·10）、`evaluateLayer1Traits` 覆盖全附着区 (`PARTNER`/`UNDERNEATH`/`EQUIPPED`)、补全 `appliedByPlayerId`、修复装备赋予【起】能力受 `CANNOT_GAIN_ABILITIES` 拦截及 `PR-030`/`BP04-028` 消球事件发射；
  - 已补全 `SbaEngine` 9.5.2（顶层非法非角色/装备/辅助机牌置墓）/9.5.3（双持失能卸装）、`getModifierEffectiveCardType`/`getEffectiveCardType` 统一调用、`BP04-052` 进场前阻止超限；
  - 已以持久化 `GameState.choiceIdSeq` (`nextChoiceId`) 彻底替换内存 `choiceSeq` 与 `card-effects.ts` 全部 `Date.now()/Math.random()` 生成逻辑（`stage2c-1-continuous-sba-and-determinism.test.ts` 14 项回归测试验证）。
- [x] **可挂起【贯通】/直伤/攻击充能与特殊机制闭环（Stage 2C-2）**：
  - 将【贯通】(`10.7.1`) 与直伤/攻击充能 (`10.2.1.b`) 接入可挂起流程与检查时机；
  - 补齐 `BP04-001` 多对象升变、`BP02-026`/`036` 墓地使用免除属性检查（8.6.2.a）、`BP02-012`/`041`/`BP04-060` 牺牲减费扫描装备与搭档及腾位后验、10.18.3.b 浮空下方牌不污染 `PROCESSING`、Q&A·8 `attachPartner` 尊重防解除、`costCardInstanceIds` 全路径透传、`hasUsableInstant` 实时费用同步（已由 `packages/game-engine/test/stage2c-2-suspendable-charge-and-mechanisms.test.ts` 14 项回归用例覆盖）。

### 3.2 双后端安全加固与协议对齐

- [ ] **Cloudflare `RoomDO` 加固**：仅向已通过认证/密码的房间成员广播、收紧非 Upgrade HTTP GET；`EchoDO` 停写 SQLite；`RoomDO.webSocketMessage` 全事件限流并清理过期连接记录；`RoomDO.alarm()` 兜底清理异常 `offlineSince` 防止 100ms 死循环唤醒。
- [ ] **认证、校验与双端一致化**：Node 改为异步 `crypto.scrypt`；双端登录限流并限制 `password.length <= 128`；双端在 `PLAYING` 时拒绝 `room:ready`/`room:select_deck`；Node `room:start` 加锁并双端校验房主；Node 失败行动不污染回放；Node 预组统一源自 `OFFICIAL_STARTER_DECKS`；CF `resolveDeck` 回退查 D1；CF `/api/admin/cards` 补齐筛选与 `take`；REST 请求体强类型校验。

### 3.3 前端交互补齐与视觉瑕疵修复

- [ ] **全区域【起】与特殊升变 UI**：支持装备赋予【起】检测、多【起】选单（`abilityIndex`）、手牌（`BP03-002`）/墓地（`BP02-036`/`026`）/费用区（`BP03-045~050`/`054`）/角色下方（`BP04-011`/`077~079`）发动入口；接入信号球区正面升变 (`BP04-061`)、浮空升变与 `extraAscensionCostCardId` 自选，淘汰快捷升变错误硬编码；兼容 `PR-041` 变身角色渲染与点击。
- [ ] **战场提示、详情面板与视觉修复**：在 `END_PHASE` `timingWindow` 中央显示醒目操作条并确保窄屏/折叠 HUD 不隐藏关键按钮；`CardDetailPanel` 与 `CardDetailModal` 展示实时有效数值、持续修改器、禁止/冰冻及双持/下方牌/搭档明细（消除与 `CardView` 角标重叠）；同步 `getCardEffectiveCost` 全量减费；修复 6 类静默失效 Tailwind v3 工具类（`-top-8.5`、`z-15`、`bg-ink-900/98`、`backdrop-blur-xs`、`bg-ink-950/92`、`via-fg/12`、`brightness-60`）；全局快捷键排除弹窗；修正攻击竖直目标/对手侵蚀条/`unblockableMaxPP`/`isLegalPlay`；`PendingChoiceModal` 展示 `maxTotalCost` 实时合计/`distinctTraits`/`eligible: false`；更新 3 处过时「ST01~ST03」近似文案。

---

## 四、P2 全表 490 卡精度收尾、受限点清零与原语重构

> 全部 490 张卡已完成声明式注册，后续按卡包专项 PR 逐一清零审计发现的结算偏差、剩余受限点与过时注释，同步补全缺失原语与单元测试：

- [ ] **DSL 基础设施精简与校验加固**（1 个 PR）：抽出单一参数化条件/筛选求值器消除 `evalCondition`/`evalStaticCondition` 漂移；补齐 `getEquipmentGrantedActivates` 宿主 `CANNOT_GAIN_ABILITIES` 检查、`sharedTurnKey` 玩家隔离与 `validator.ts` 遗漏校验（含 `entry/entries`、`activate/activates` 互斥）；清理 `card-effects.ts` 1,500+ 行不可达死代码，并将 4,445 行 `interpreter.ts` 拆分为 `evaluator.ts`、`cost-handler.ts`、`step-runner.ts`、`trigger-adapter.ts`。
- [ ] **补全缺失通用原语**：`isAirborne`、`isAttacking`、`isBeingAttacked`、`fromZone`（成为搭档来源判断）、`wasAscendedPlay`（真升变判断）、`distinctCardNumbers`（不同编号多选）、`PEEK_TOP`（私密查看，不走 `REVEAL_TOP`）、顶部固定截取（替代 `BP03-013/014/016` 全区选）、信号球第 0 位/底位精准选择、`SELF_UNDERNEATH` / `EQUIPPED_HOST` / `ZONE_CARDS('GRAVEYARD')` 批量全选、多张置底重排、可挂起通用 `REPLACEMENT` 原语（服务 `BP01-017`/`BP02-013`/`BP02-049`/`PR-018`/`PR-021`）。
- [ ] **分包精准度清零（每包 1 个专项 PR + 补齐单测覆盖率至 100%）**：
  1. `ST01~ST06 & BP01`：收尾 `BP01-037` 可选 1 球或 3 球及非 DSL 公开/伤害充能、`BP01-058` 双【出】自选顺序、`ST03-003` 代价校验、`ST03-008`、`ST05-008/010`、`BP01-051`、`BP01-061` 等；
  2. `BP02`：修复 `BP02-012/013/024/025/026/036/037/041/047/048/049/052/060/067` 并在 `bp02.test.ts` 补测缺失的 30 张卡与反向分支；
  3. `BP03`：修复 `BP03-002/004/005/010/013/014/016/025/028/042/045/046/056/057/058/059/060/062/064/065/075` 与 `custom-handlers.ts` `interceptMoveCard` 绕过，在 `bp03.test.ts` 补测缺失的 13 张卡及同卡号/递增+1 反向断言；
  4. `BP04 & PR`：修复 `BP04-001/009/011/012/013~022(自伤时序)/027/030/034/035/040/046/047/052/059/060/065/070/071/075` 与 `PR-014/015/018/020/021/028/031/033/034/035/041/042/046/048`，清零过时注释，在 `bp04.test.ts` 与 `pr.test.ts` 补全漏测的 24 张 BP04 + 3 张 PR 与强断言。

---

## 五、P3 性能优化、验证体系与工程债务

### 5.1 性能与架构可扩展性

- [ ] **持续效果层与 490 卡查找性能优化（守住 CF Worker 10ms CPU 红线）**：在 `ContinuousEffectEngine` 按 `cardNumber` 建索引并增加同行动版本号缓存；为 `canPlayerIgnoreAttributeForPlay` 等构建索引避免每次遍历 490 条规格；仅在存在对应光环时扫费用区；`dispatchAction` 将只读守卫提至快照备份前，将全量 `JSON.stringify` 替换为 `structuredClone` 或增量日志；`ZoneManager` 引入 `zoneOrder` 数组消除键删插重建。
- [ ] **服务端资源保护**：CF `RoomDO.syncLobby` 仅在公开摘要变更时写 D1；限制 WS/HTTP 单包体上限；Node `Memory*Repository` 增加淘汰上限或补齐 Prisma 接口（`PrismaRoomRepository.create` / `PrismaDeckRepository.setCards` 异画）并接入持久化。
- [ ] **前端架构拆分与重渲染治理**：拆分 1910 行 `GameClient.tsx`（`useGameSocket`、`useGameHotkeys`、`HandTrayView` 触控拖拽下沉并做 rAF 节流）；补齐 `useMemo`/`useCallback` 恢复 `React.memo`；修复 `AuthProvider` 刷新清空状态及 `RoomClient` 漏 `user` 依赖；修复 `TargetingArrowOverlay` 无效重排与 `useLongPress` 定时器泄漏。

### 5.2 前端增值功能与视觉收尾

- [ ] 接入 `costCardInstanceIds` 费用区点选支付 UI；`ReplayClient.tsx` 接入真实 `GameEngine` 事件重演替换假沙盘；对局页补充「报告规则问题」入口；补全 `combatLogs` 事件类型。
- [ ] 清除最后 12 处裸色/阴影；按 `design-spec.md` 补全竖屏手机横屏提示；校色 `orb-*` 三色并补全紧凑计数栏色弱标记；在 ESLint/单测加入裸色值与非法 Tailwind 类回归拦截。

### 5.3 验证体系与 CI 加固

- [ ] 补全规则条款（9.5.2/9.5.3、1.2.3、2.7.3、3.2.4）与剩余 ~47 条官方 Q&A（全量 71 条真打用例化，淘汰手工 `addCardModifier` 伪造用例）。
- [ ] 升级 `fuzz-invariants.test.ts` 至全 490 卡池抽样对抗，补齐 `ACTIVATE_ABILITY`/升变/`EQUIP_ITEM`/`PERFORM_ASSIST`/非战术瞬时/自选费用与深层中途失败回滚，脱敏校验覆盖己方背面球、`opponentPendingChoice.prompt` 与 `GameEvent[]`。
- [ ] 新建真实对局 `(seed, decks, actions[])` 回放回归测试；补充前端交互单测（弹窗连续切换、三消、断线重连、快捷键互斥）。
- [ ] `.github/workflows/ci.yml` 补跑 `npm run typecheck` 与 `npm run build:cf-static`；排查修复 Windows 本地 `apps/worker` `workerd` `src\win\fs-event.c` 崩溃；同步清理旧测试虚标表述。

### 5.4 部署脚本与仓库卫生

- [ ] 清理 `scripts/build-cf-static.mjs` 个人 CDN 硬编码与 `NEXT_PUBLIC_SERVER_URL` 污染风险；修复 `scripts/package-portable.mjs` 中文 `.bat` `'ascii'` 乱码、硬编码 Node 路径与网关 `/health`/WS `upgrade` 双向清理；自建正式启动设置 `NODE_ENV=production`。
- [ ] 移除 `scripts/generate-cards.mjs` 等脚本个人路径并更新生成模板；移除 `scripts/stress-test.mjs:52` 的 `'admin888'`；修复 `docker-compose.yml` 与 `apps/web/Dockerfile` `standalone` 失配。
- [ ] 仓库管理员删除远端残留的 1 个旧历史分支 (`origin/feat/cf-stage-3-frontend-r2`) 与 11 个已合并未删分支；归档或清理工作区未跟踪的实战差异文档；建立官方规则/Q&A 更新同步流程（§13 记录）。

---

## 六、合并与发布前的双端真机联机验收清单（更新版）

自建部署拉取 `main` 更新线上服务或发布 Cloudflare 线上版本前，必须完成真实双人全流程验证：

- [ ] **自建部署（Node 版，普通窗口 + 无痕窗口）**：
  - 验证游客签名凭据与登录账号隔离、密码房拦截与大厅不泄露可冒充 ID；
  - 完整打完至少 2 局，覆盖：调度、攻防/阻挡/充能决策、非战术瞬时 (`BP03-054`/`BP04-028`)、结束阶段瞬时窗与双方提示可读性；
  - 实测关键体系卡：`ST04` 突击鹰与双《荣光护盾》、《ST06》协战 (`PERFORM_ASSIST`)、《BP01》辅助机/单独装备 (`EQUIP_ITEM`)/帕瓦叠置/单张万世铭三消/赛琳娜连续弹窗、《BP02》墓地升变与替身、《BP03》誓焰浮空与万华费用区起动、《BP04》终焉与信号球升变。
- [ ] **Cloudflare 版（`wrangler dev` 本地实测）**：
  - 完成 1 局完整对战，验证对局中刷新页面后从 DO SQLite 完整恢复 `modifiers`、`timingWindow`、`endPhaseStep`、`pendingTriggers`、`activeReplacements`；
  - 实测中途断网触发「与服务器的连接已断开」横幅与自动重连恢复；
  - 验证已登录玩家在卡组页保存卡组成功同步至 D1。

---

## 七、推荐执行顺序（Stage 0 → Stage 5）

1. **Stage 0（安全止血与卡表地基）**：完成 2.1（安全/作弊止血）与 2.2（`ST04` 特征、`icon`、`BP02-028` 双空格、`【冠军】` 构筑漏洞与校验启用）。
2. **Stage 1（前端致命断链与全表关键卡止血）**：完成 2.3（弹窗死锁、协战/非战术瞬时/辅助机/装备/三消、CF 断线修复）与 2.4（跨优先权抢发、暗区泄密、白板/空桩/必败卡止血）。
3. **Stage 2（引擎内核闭环、双端加固与真机验收）**：完成 3.1（触发/置换/持续层/阶段机/脱敏/确定性闭环）与 3.2（双后端一致化与防 DoS），随后执行第六节双端真机联机验收。
4. **Stage 3（前端完善、性能守门与测试加固）**：完成 3.3（全区域【起】、特殊升变、移动端详情）、5.1（持续层索引缓存保 CF 10ms CPU）与 5.3（CI 加固、全池 Fuzz、回放回归与前端单测）。
5. **Stage 4（全表 490 卡精度清零与原语重构）**：完成第四节基础设施拆分、缺失原语补齐及 `ST01~BP01`、`BP02`、`BP03`、`BP04 & PR` 分包精准度收尾与 71 条 Q&A 覆盖。
6. **Stage 5（工程收尾与仓库卫生）**：完成 5.1/5.2 前端拆分与视觉无障碍收尾，以及 5.4 部署脚本、Docker 与远端分支清理。

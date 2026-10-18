# 前端设计规范 (Design Spec)

本文件是 `apps/web` 视觉与交互的唯一依据，前端重构与新增页面都按此执行。规范中的 Token 落地在 `tailwind.config.ts` 与 `src/app/globals.css`，组件中**只使用 Token，不写裸色值与随意尺寸**。

## 0. 参考来源

| 来源 | 地址 | 取用内容 |
| --- | --- | --- |
| 《战双帕弥什》国服官网 | https://pns.kurogames.com/ | 主视觉语言：黑底、白字、绯红点缀、直角、细线、HUD 装饰 |
| 集卡社对战卡牌 (B 站官方号) | https://space.bilibili.com/3546953889614145 | 卡牌对战子品牌物料：钢灰蓝底、网格、方角括号、斜线条纹、斜体粗标题 |

官网实测数据 (2026-10 采集)：

- 全站 `border-radius` 全部为 `0`；
- 文字色只有白 `#FFFFFF`、浅灰 `#C7C5C5`、60% 白，以及点缀用的纯红；
- 面板底色用 `rgba(255,255,255,0.10)` / `0.18` 叠在黑底上，不用有色面板；
- 唯一的强调色是绯红 (`#ED1212` / `#FF0000`)，用于当前导航指示条、页码、标题下划线；暖金 `rgba(255,204,131,.6)` 极少量出现；
- 过渡以 `0.3s ~ 0.5s` 的 `transform` / `opacity` 为主，没有弹跳动效；
- 版式装饰：超大半透明英文底字 (`PUNISHING`)、`EVENT 01`、`PAGE 02 / 07`、`CAUTION` 倒三角、`▸▸▸ PUNISHING FORCE`、斜线阴影条纹、中文标题配英文小副标题 (`新闻资讯 / NEWS`)。

卡牌对战物料补充：底色是偏冷的钢灰蓝 (而不是纯黑)，带细网格；角落用 `⌐ ¬` 形方角括号框住内容；标题是白色粗斜体，下面叠一层蓝色错位投影。

> 卡图、Logo、角色立绘与 KV 的权利归库洛游戏 / 集卡社所有，界面里**只借用风格，不搬运官方素材**。官网的 RuiXian、KV-AvantGarde 是商用字体，不使用。

## 1. 设计原则

1. **黑白为骨，红为刃**：画面的 90% 是黑、灰、白，绯红只用在「当前 / 危险 / 主要行动」上。同一屏里红色元素越少，信息越清楚。
2. **直角与细线**：不用圆角卡片和粗边框，层级靠 1px 细线、明度差和留白区分。
3. **HUD 是点缀，不是内容**：编号、刻度、斜线条纹这些装饰只出现在页头、页脚和面板角落，不出现在需要阅读的正文里，也不干扰卡面。
4. **卡面优先**：对局页里卡牌是主角，界面框架要压暗、压细，避免和卡面颜色抢眼。
5. **克制的动效**：位移和淡入淡出要短且线性，不用弹跳和持续闪烁；遵守 `prefers-reduced-motion`。

## 2. 颜色

### 2.1 中性色 (Ink)

| Token | 值 | 用途 |
| --- | --- | --- |
| `ink-950` | `#050506` | 页面底色 |
| `ink-900` | `#0B0B0D` | 页头、页脚、侧栏 |
| `ink-850` | `#121215` | 面板 / 卡片底 |
| `ink-800` | `#1A1A1E` | 悬停、斑马纹、输入框底 |
| `ink-700` | `#26262B` | 按下、选中行 |
| `ink-600` | `#3A3A40` | 禁用底、分隔块 |
| `line` | `rgba(255,255,255,0.12)` | 默认 1px 分割线、面板边框 |
| `line-strong` | `rgba(255,255,255,0.28)` | 悬停边框、强调分割线 |
| `overlay` | `rgba(0,0,0,0.72)` | 弹窗遮罩 |

### 2.2 文字

| Token | 值 | 对比度 (对 `ink-950`) | 用途 |
| --- | --- | --- | --- |
| `fg` | `#FFFFFF` | 20:1 | 标题、主要文字 |
| `fg-secondary` | `#C7C5C5` | 12:1 | 正文、次要信息 (官网实测色) |
| `fg-muted` | `rgba(255,255,255,0.60)` | 7.5:1 | 说明、时间、标签 |
| `fg-disabled` | `rgba(255,255,255,0.36)` | 3.4:1 | 禁用 (不承载必须读到的信息) |

### 2.3 品牌与语义色

| Token | 值 | 用途 |
| --- | --- | --- |
| `crimson-500` | `#ED1212` | **主强调色**：主按钮、当前导航指示条、页码高亮、侵蚀值、攻击目标 |
| `crimson-400` | `#FF4D4D` | 深底上的**小号**红色文字 (`#ED1212` 小字对比度不足，只用于 ≥18px 或非文字元素) |
| `crimson-700` | `#8F0B0B` | 按下态、红色区块底 |
| `crimson-glow` | `rgba(237,18,18,0.45)` | 红色光晕，只用于攻击 / 受击瞬间 |
| `steel-700` | `#2E3644` | 卡牌对战子品牌底色：对局桌面、卡组构筑页背景 |
| `steel-500` | `#5B6B86` | 网格线、次级装饰 |
| `steel-300` | `#A9BBD8` | 钢蓝强调、标题错位投影 |
| `teal-400` | `#34C3C8` | **信息 / 己方 / 可放置**：拖拽可落点、己方回合提示、链接 |
| `gold-300` | `#FFCC83` | **高亮 / 费用 / 提示**：费用数字、可用瞬时提示、警告 |
| `success` | `#4ADE80` | 操作成功、准备完毕 |

规则：

- 同一组件里最多出现**一种**彩色强调；红与青不并列作为同级按钮。
- 红 = 破坏性 / 攻击 / 对手侵蚀，青 = 己方可操作，金 = 需要注意的数值。不要互换。
- 旧的霓虹青 `#00F0FF` 退役，不再作为主色。

### 2.4 游戏领域色

| Token | 值 | 用途 |
| --- | --- | --- |
| `orb-red` | `#E5484D` | 信号球·红 (`SignalColor.RED`) |
| `orb-blue` | `#3E8ED0` | 信号球·蓝 |
| `orb-yellow` | `#F2C94C` | 信号球·黄 |
| `side-self` | `teal-400` | 己方区域标识 |
| `side-opponent` | `crimson-500` | 对方区域标识 |

信号球颜色以实际卡面为准，落地时对照 `public/cards` 中的卡图取样校正，三色保持同等明度，保证色弱用户也能靠图标形状区分 (球内加 `R / B / Y` 或形状标记)。

## 3. 字体

| 角色 | 字体栈 | 说明 |
| --- | --- | --- |
| 正文 (`font-sans`) | 系统西文字体 → `"Noto Sans SC", "Source Han Sans SC", "PingFang SC", "Microsoft YaHei"` | 官网正文用思源黑体；中文字体体积太大，不打包，使用系统已安装的黑体 |
| 英文展示 (`font-display`) | `"Montserrat Variable", Avenir, "Helvetica Neue", Arial, sans-serif` | 几何无衬线，替代官网的 Avenir / AvantGarde，用于英文副标题、HUD 文字，全大写 + 字距 |
| 数字 / 数据 (`font-num`) | `"JetBrains Mono Variable", ui-monospace, Consolas, monospace` | PP、DP、费用、计时、ID，必须 `tabular-nums` |

Montserrat 与 JetBrains Mono 通过 `@fontsource-variable/*` 依赖随前端打包 (在 `layout.tsx` 引入)，**不要用 `next/font/google` 或 Google Fonts 链接**：便携版和内网环境可能连不上 Google。

### 字号阶梯

只使用以下 Token，禁止 `text-[13px]` 这种任意值 (现有 337 处要逐步收敛)：

| Token | 字号 / 行高 | 用途 |
| --- | --- | --- |
| `text-hud` | 10px / 12px，大写，字距 `0.16em` | HUD 装饰文字 (`EVENT 01`、`PAGE`) |
| `text-caption` | 12px / 16px | 标签、时间、卡牌角标 |
| `text-body-sm` | 13px / 20px | 列表、表格、侧栏 |
| `text-body` | 14px / 22px | 默认正文 |
| `text-title-sm` | 16px / 24px | 面板标题 |
| `text-title` | 20px / 28px | 页面区块标题 |
| `text-display` | 32px / 40px | 页面大标题 |
| `text-banner` | 56px / 1 | 阶段切换横幅 |

字重：正文 400，标题 500 / 700。中文标题不加粗到 900，粗斜体只用于子品牌样式的大标题 (见 5.3)。

## 4. 空间、形状、层级

- **间距**：4px 基准，常用 `4 / 8 / 12 / 16 / 24 / 32 / 48`。面板内边距 16，区块之间 32。
- **圆角**：默认 `0`。只有两处例外：头像与信号球 (`rounded-full`)，卡牌实体 (`2px`，模拟实体卡切角)。`rounded-lg` / `rounded-xl` 全部去掉。
- **切角**：需要强调的面板和按钮用 45° 切角代替圆角，统一工具类 `clip-corner-sm` (6px) / `clip-corner-md` (12px)，只切右上和左下两个角。
- **边框**：一律 1px，颜色用 `line` / `line-strong`；选中态用左侧 2px 绯红指示条 (官网导航同款)，而不是整圈彩色边框。
- **阴影**：深色界面不用投影区分层级。层级 = 明度 (`ink-950 → 900 → 850 → 800`)。只保留两种效果：
  - `shadow-overlay`: `0 16px 48px rgba(0,0,0,0.6)`，弹窗与浮层；
  - `glow-crimson` / `glow-teal`: 仅用于攻击、可落点等瞬时状态，不常驻。
- **毛玻璃**：只用于浮在卡牌上方的浮层 (`backdrop-blur-md`)，页面级面板不用。
- **z-index**：`base 0` / `sticky 10` / `dropdown 20` / `overlay 40` / `modal 50` / `toast 60` / `banner 70`。

## 5. 组件规范

### 5.1 按钮

| 变体 | 外观 | 场景 |
| --- | --- | --- |
| `primary` | `crimson-500` 底 + 白字，切角 `sm`，悬停变亮 `#FF2B2B`，按下 `crimson-700` | 每屏最多一个：开局、确认、结束回合 |
| `secondary` | 透明底 + 1px `line-strong` 边框 + 白字，悬停底 `ink-800` | 普通操作 |
| `ghost` | 无边框，`fg-secondary`，悬停 `fg` | 工具栏、次要入口 |
| `danger` | 透明底 + `crimson-400` 字 + 红边框 | 删除、投降 |
| `icon` | 32×32 / 40×40 方形，必须有 `aria-label` | 图标按钮 |

高度：`sm 28px` / `md 36px` / `lg 44px` (触屏主操作至少 44px)。禁用：`ink-600` 底 + `fg-disabled`，不降透明度整体。

官网下载按钮样式 (透明底、细白边框、左侧图标、中英文双行) 可用于大厅入口卡等「入口型」按钮。

### 5.2 面板 / 卡片

- 底 `ink-850`，1px `line` 边框，直角；标题栏下方一条 `line` 分隔。
- 可选 HUD 角标：面板四角用 `⌐ ¬` 方角括号 (`steel-500`，8px 臂长) 代替整圈边框。
- 列表行：高 44px，斑马纹用 `ink-800`，悬停 `ink-700`，左侧标签 `【最新】` 风格用 `fg-muted`。

### 5.3 区块标题 (Section Header)

官网标志性样式，用于页面一级区块：

```
──────────── · EVENT 01 ╲  新闻资讯  ╱ EVENT 01 · ──────────── PAGE - 02 / 07 ─
                         ━━━ NEWS ━━━
```

- 中文标题 `text-title` 白字居中；下方英文副标题 `text-hud`，左右各一段 `crimson-500` 细线；
- 两侧细线 `line`，可选 `EVENT` / `PAGE` 编号装饰；
- 背后可选超大半透明英文底字 (`fg` 4% 不透明度，`text-[160px]` 量级，`aria-hidden`)。

子品牌变体 (卡组构筑、对局结算等「卡牌」相关页面)：白色粗斜体标题 + `steel-300` 向右下 2px 错位投影，背景 `steel-700` + 24px 网格线 (`steel-500` 15% 不透明度)。

### 5.4 导航

- 顶栏高 56px，`ink-900` 底，底部 1px `line`；
- 当前项：白字 + 左侧 (竖向导航) 或下方 (横向导航) 2px `crimson-500` 指示条，附英文小副标题；
- 非当前项：`fg-secondary`，悬停 `fg`，过渡 `color 0.3s`。

### 5.5 标签页 (Tabs)

官网新闻区样式：文字标签横排，当前项白字 + 下方 24px 宽红色短线 + 左上角红色序号 (`01`)；其他项 `fg-muted`。

### 5.6 表单

- 输入框高 36px，`ink-800` 底，1px `line` 边框，直角；聚焦时边框 `teal-400`，不加光晕；
- 错误：边框和提示文字用 `crimson-400`；
- 标签在上方，`text-caption` + `fg-muted`。

### 5.7 弹窗

- 遮罩 `overlay`；弹窗 `ink-900` 底 + 1px `line-strong`，切角 `md`，`shadow-overlay`；
- 标题栏左侧 2px 红色竖条 + 标题，右侧关闭按钮；
- `role="dialog"` + `aria-modal="true"`，`Esc` 关闭，焦点锁定在弹窗内。

### 5.8 标签 / 徽标

直角小块，高 20px，`text-caption`：中性 (`ink-700` 底 + `fg-secondary`)、强调 (`crimson-500` 底白字)、信息 (`teal-400` 边框 + 字)。

### 5.9 HUD 装饰件

统一做成组件 (`src/components/ui/hud/`)，页面里不要手写：

| 组件 | 样式 | 位置 |
| --- | --- | --- |
| `HudRule` | 细线 + 两端小点 + 可选编号 | 区块标题两侧、页脚 |
| `HudStripes` | 45° 斜线条纹 (`repeating-linear-gradient`) | 页脚右侧、面板角落 |
| `HudCaution` | 倒三角 + `CAUTION` | 页脚中间、危险操作提示 |
| `HudBrackets` | 四角方角括号 | 面板、卡牌选中框 |
| `HudCounter` | `01 / 05` 页码，当前数字 `crimson-500` | 轮播、分页 |

全部 `aria-hidden="true"`，不放可交互内容。

## 6. 对局界面

- **桌面**：底色 `steel-700` 向 `ink-950` 的纵向渐变 + 网格；己方半场底部 1px `teal-400` 20% 细线，对方半场顶部 1px `crimson-500` 20% 细线。
- **卡牌**：卡图为主，外框 1px `line`，2px 圆角；数值角标 (PP / DP / 费用) 用 `JetBrains Mono` + 深色半透明底块，不加彩色描边。
- **状态**：

| 状态 | 表现 |
| --- | --- |
| 可操作 (可打出 / 可攻击) | 底部 2px `teal-400` 条 |
| 选中 | `HudBrackets` 白色四角框 |
| 拖拽可落点 | 区域填充 `teal-400` 12% + 1px `teal-400` 虚线 |
| 攻击目标 | 1px `crimson-500` + `glow-crimson`，只在拖拽 / 选择目标期间显示 |
| 横置 | 旋转 90°，亮度降至 80%，不改透明度 |
| 不可用 | 灰度 60% + 亮度 60% |

- **阶段横幅**：白色 `text-banner`，左右各一段红色细线和英文副标题 (`MAIN PHASE`)，水平滑入 → 停留 → 滑出，总时长 ≤ 1.2s，没有霓虹 `text-shadow`。
- **侵蚀条**：`crimson-500` 实心分段条，每段之间 2px 间隔。
- 对局页的高频状态遵守 AGENTS.md「前端约定」：放在叶子组件内部并用 `requestAnimationFrame` 节流。

## 7. 动效

| Token | 值 | 用途 |
| --- | --- | --- |
| `duration-fast` | 150ms | 悬停、颜色变化 |
| `duration-base` | 300ms | 展开、切换标签、卡牌移动 |
| `duration-slow` | 500ms | 区块入场、横幅 |
| `ease-out` | `cubic-bezier(0.2, 0.8, 0.2, 1)` | 进入 |
| `ease-in` | `cubic-bezier(0.4, 0, 1, 1)` | 退出 |

- 允许：淡入淡出、水平 / 垂直位移 ≤ 16px、轻微缩放 (0.96 → 1)、扫光线 (一次性)。
- 禁止：弹跳、持续闪烁、常驻呼吸光晕、旋转 loading 以外的无限循环动画。
- `prefers-reduced-motion: reduce` 时全部降为瞬时 (已在 `globals.css` 实现，保留)。

## 8. 可访问性

- 正文对比度 ≥ 4.5:1，大号文字和图标 ≥ 3:1；红色小字用 `crimson-400`。
- 状态不能只靠颜色区分：攻击目标、可操作、信号球颜色都要配合形状、图标或文字。
- 焦点样式：`:focus-visible` 2px `teal-400` 外框 + 2px 偏移 (替换现有的霓虹青)。
- 图标按钮必须有 `aria-label`；HUD 装饰一律 `aria-hidden`。
- 保留全局 `user-select: none` 与表单控件放开规则 (iOS Safari)。

## 9. 响应式

| 断点 | 宽度 | 布局 |
| --- | --- | --- |
| 默认 | < 640px | 单列，导航收进汉堡菜单，页面两侧留 16px |
| `sm` | ≥ 640px | |
| `md` | ≥ 768px | 大厅 / 卡库两列 |
| `lg` | ≥ 1024px | 竖向侧边导航出现 (官网样式) |
| `xl` | ≥ 1280px | 内容最大宽度 1200px 居中 |

对局页在竖屏手机上提示横屏，横屏最小支持 667×375。

## 10. 从现有样式迁移

| 现有 | 替换为 | 现用量 |
| --- | --- | --- |
| `terminalCyan` / `cyan-*` (`#00F0FF`) | 交互提示 → `teal-400`；装饰 → `line` / `fg-muted`；主按钮 → `crimson-500` | 821 + 54 |
| `erosionRed` (`#FF2A5F`) | `crimson-500` / `crimson-400` | 185 |
| `terminalGold` / `amber-*` | `gold-300` | 179 + 103 |
| `purple-*` | 按语义并入以上颜色，不保留紫色 | 86 |
| `background` / `surface` / `surfaceHover` | `ink-950` / `ink-850` / `ink-800` | |
| `rounded-sm/md/lg/xl/2xl` | 直角或 `clip-corner-*` | 549 |
| `text-[Npx]` | 第 3 节字号 Token | 337 |
| `shadow-[...]` 霓虹光晕 | 删除，或改用 `glow-*` 仅限瞬时状态 | 108 |
| `font-mono` 用于中文或正文 | 只保留在数字与 ID 上 | 535 |
| `.terminal-glow-*`、`.hud-panel`、`.corner-*` | 删除，改用 5.9 的 HUD 组件 | |

### 落地步骤 (每一步一个 PR，合并后自建部署与 Cloudflare 版都要能正常使用)

1. **Token 层**：在 `tailwind.config.ts` 与 `globals.css` 中加入本规范的 Token (新旧并存)，自托管字体。
2. **基础组件**：新建 `src/components/ui/` (Button、Panel、SectionHeader、Tabs、Input、Dialog、Badge、HUD 系列)，补渲染冒烟测试。
3. **外围页面**：首页、登录、大厅、等待室、卡库、卡组、历史、回放、指南、管理后台依次迁移。
4. **对局页**：`GameClient.tsx` 及 `components/game/*` 迁移，按第 6 节调整卡牌状态与横幅；两种部署方式各实际打一局验证。
5. **清理**：删除旧 Token 与 `.terminal-*` 等旧工具类，在 `next lint` 中禁止任意值字号与裸色值 (可选)。

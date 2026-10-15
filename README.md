# 《战双帕弥什 卡牌对战》在线对战平台
> **Punishing: Gray Raven TCG Online Battle Platform**  
> 基于《战双帕弥什 卡牌对战 综合规则》研发的全功能开源在线集换式卡牌对战系统。

---

## 📖 项目简介

本项目是为《战双帕弥什》（Punishing: Gray Raven）实体集换式卡牌游戏打造的**全功能在线对战平台**。采用现代化 Monorepo 架构与权威服务器（Authoritative Server）设计，100% 忠实还原官方综合规则体系与卡牌效果。

无论是局域网联机对战、跨网穿透远程切磋，还是牌组构筑与官方高清图鉴赏析，均能提供流畅、沉浸与严谨的对战体验。

---

## ✨ 核心特性

- ⚔️ **全规则仲裁引擎（Pure TypeScript Engine）**
  - 严谨的阶段状态机：准备阶段、调度阶段（Mulligan）、充能阶段、主要阶段、战斗阶段（攻击声明 ➔ 攻击充能 ➔ 阻挡声明 ➔ 伤害充能 ➔ 伤害结算）、结束阶段。
  - 侵蚀计数系统：0~7 点侵蚀动态判定，暗费即时入墓与明暗费上限管理。
  - 特殊机制深度建模：同名机体升变（Ascension）、信号球三消与消除自、辅助机与装备系统、公开检视双方确认流（`OPPONENT_CONFIRM_REVEAL`）。
  - 覆盖 ST01~ST06 预组、BP01~BP04 补充包与 PR 特典卡牌，内置 55+ 自动化测试用例，全分支 100% 覆盖。

- 🌐 **双人实时联机（Real-time Multiplayer）**
  - WebSocket 双向长连接，权威服务端全局校验，防作弊与客户端动作鉴权。
  - 便捷房间系统：6 位房间号极速匹配、双人准备室、自由选择预组或自定义卡组。
  - 断线续玩（Reconnection Flow）：对局中意外刷新或掉线自动保留战局，重连无缝同步。

- 🎴 **合规牌组构筑器（Deck Builder）**
  - 实时官方规则合法性校验（50 张牌组限制、同名卡最多 4 张、红/黄/蓝信号球各 4 张配额强制检查）。
  - 直观的可视化费用曲线图表、卡牌类型与阵营分布统计。

- 🛡️ **官方场地纸高拟真 HUD（Cyberpunk Arena）**
  - 1:1 还原官方双人对战场地 HUD，支持全屏展开与视口缩放适配。
  - 常驻战斗行动栏（攻击/阻挡/发动），具备无缝鼠标触控桥，杜绝交互误触与死区消失。
  - 卡牌悬停即时画廊小窗检视，支持高清单卡细节与效果解析。

- 🎬 **确定性对局回放（Deterministic Replay）**
  - 全对局 Action/Event 完整事件流持久化。
  - 支持单步前进、倒退与倍速播放，便于战术复盘与赛事裁判。

- 📦 **免安装绿色便携发布（Portable Release）**
  - 内置 Node.js 便携运行时与统一流量网关，打包一键压缩为绿色发布包。
  - 解压后双击即可启动，无需安装外部运行环境或配置数据库。

---

## 🏗️ 架构设计 (Monorepo Layout)

本项目基于 npm Workspaces 构建标准 Monorepo 架构：

```text
zhanshuang-tcg/
├── apps/
│   ├── web/              # 前端对战界面 (Next.js 14 App Router, TailwindCSS, Lucide Icons)
│   └── server/           # 权威对战服务器 (Fastify, Socket.IO, JWT 身份认证)
├── packages/
│   ├── game-engine/      # 核心规则仲裁引擎、阶段状态机与卡牌效果解析机
│   ├── game-rules/       # 卡组构筑合法性验证规则与常量定义
│   ├── database/         # Prisma ORM 数据库层、卡牌全量种子数据与对局归档
│   └── shared/           # 全局类型定义、Action/Event 协议与 DTO 模型
├── docs/                 # 官方规则规格书、架构图解与协议说明文档
├── scripts/              # 启动网关、高清卡图导入、数据校验与便携打包脚本
├── start.bat             # Windows 一键启动脚本
└── .env.example          # 环境变量配置模板
```

---

## 🚀 快速上手

### 环境准备
- **Node.js**：`>= 18.0.0`（推荐 LTS 20 或以上）
- **npm**：`>= 9.0.0`

### 1. 克隆代码仓库
```bash
git clone https://github.com/sodaku-0623/zhanshuang-pamishi-official-card-game-web-platform.git
cd zhanshuang-pamishi-official-card-game-web-platform
```

### 2. 安装依赖
```bash
npm install
```

### 3. 配置环境变量
复制环境配置模板：
```bash
cp .env.example .env
```
（本地开发默认无需修改配置，开箱即用 SQLite 与内存模式）

### 4. 启动对战平台
- **Windows 用户**：直接双击根目录下的 [`start.bat`](start.bat) 即可一键启动前端、后端与调度网关。
- **命令行方式**：
  ```bash
  npm start
  ```
启动成功后，浏览器自动打开：`http://localhost:3000`

---

## 🧪 测试与构建

全工程配备严格的代码规范与自动化测试套件：

```bash
# 运行全工作区单元测试（含 55 项引擎规则测试）
npm test

# 全工作区 TypeScript 强类型检查与生产编译
npm run build

# 自动打包 Windows 便携免安装版 ZIP 归档包
npm run package:portable
```

---

## 📡 端口与联机网络说明

- **3000 端口**：统一流量网关与前端 UI（局域网好友或外网穿透直接访问此端口即可）。
- **4000 端口**：后端权威 REST API 与 WebSocket 实时长连接服务。

> **提示**：若使用 cpolar / frp / ngrok / cloudflared 等内网穿透工具与外部好友联机，只需将目标端口映射至 **`3000`** 端口即可，平台已内置流量网关自动路由前端、API 与 WebSocket 连接。

---

## 📄 开源许可与免责声明

本项目采用 [MIT License](LICENSE) 开源许可协议。

**特别声明**：
1. 本项目为《战双帕弥什》（Punishing: Gray Raven）官方正版实体集换式卡牌游戏（TCG）的**非盈利性开源同好对战平台**。
2. 《战双帕弥什》卡牌设计、卡面插画、角色形象、背景设定及相关商标的一切权利均归属于**广州库洛科技有限公司（Kuro Games）**所有。
3. 本项目仅供技术学习交流与卡牌对战研究使用，严禁将本项目或其衍生制品用于任何商业营利活动。

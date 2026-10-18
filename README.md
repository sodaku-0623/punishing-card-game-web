# 战双帕弥什 卡牌对战 · 在线对战平台

[![CI](https://github.com/sodaku-0623/zhanshuang-pamishi-official-card-game-web-platform/actions/workflows/ci.yml/badge.svg)](https://github.com/sodaku-0623/zhanshuang-pamishi-official-card-game-web-platform/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

《战双帕弥什 卡牌对战》（Punishing: Gray Raven TCG）的非官方在线对战平台。在浏览器里建房、选择卡组，与朋友实时对战。

> [!IMPORTANT]
> 本项目由玩家社区制作，非官方、非商业，与库洛游戏无关。卡牌相关内容的权利归广州库洛科技有限公司所有，详见[许可协议](#许可协议)。

## 功能

- 在线对战：通过 6 位房间号建房与加入，支持房间密码；对局中刷新页面或断线后可以重连。
- 服务端裁定：所有对局操作由服务端的规则引擎校验与结算，客户端只提交操作意图；对手的手牌、牌组顺序与暗费不会下发给客户端。
- 卡组构筑：按官方构筑规则实时校验（50 张、同编号至多 4 张、信号球配额等），并提供费用曲线与类型统计。
- 卡牌图鉴与对局回放。
- 两种部署方式：在本机运行（可配合内网穿透与朋友对战），或一键部署到 Cloudflare。

## 规则实现进度

规则依据为官方《综合规则 V1.4》与官方规则 Q&A，整理见 [规则整理](docs/rules/rule-specification.md)。

| 范围 | 状态 |
| --- | --- |
| 对局流程（调度、竖直、抽牌填充、主要阶段、攻击各步骤、结束阶段）、轮流使用【瞬时】、费用与侵蚀、升变 | 已实现 |
| 官方预组 ST01 灰鸦小队、ST02 升格者、ST03 三头犬小队（共 42 张） | 已按卡牌文本逐张实现，并有逐张测试 |
| 其余卡包（约 450 张） | 近似实现：根据卡牌文本中的关键字推断效果，可能与官方效果不一致 |
| 自动能力的待机与处理顺序、协战、浮空等 | 尚未实现 |

除三套预组外，也可以使用自行构筑并通过校验的卡组，但其中预组以外的卡牌属于近似实现。已知问题与后续计划见 [后续工作](docs/future-work.md)。发现规则问题时，欢迎附上对局回放提交 Issue。

## 快速开始

环境要求：Node.js 18.17 及以上（推荐 20 LTS）。

```bash
git clone https://github.com/sodaku-0623/zhanshuang-pamishi-official-card-game-web-platform.git
cd zhanshuang-pamishi-official-card-game-web-platform
npm ci
npm run cards:download -- --card-cdn https://card.ikemiyasouta.site   # 补齐卡图，已存在且完整的文件会跳过
npm start                                                             # 启动后端（4000）与前端（3000）
```

启动后浏览器会自动打开 `http://localhost:3000`。Windows 用户也可以直接双击 `start.bat`。

### 说明

- 首次启动会生成 `.env`，其中的 `JWT_SECRET` 与管理员账号 `admin` 的初始密码 `ADMIN_PASSWORD` 均为随机生成，初始密码会打印在控制台。
- 本机运行时，账号、卡组与对局记录保存在内存中，重启后清空。需要持久化存储时请使用 Cloudflare 部署。
- 卡图不在仓库中（`apps/web/public/cards` 已加入 `.gitignore`），新克隆后需要先通过上述下载脚本获取卡图，否则界面没有卡面。
- 想在本机体验一局：分别用普通窗口与无痕窗口打开 `http://localhost:3000`，两个窗口是不同的游客身份，可以互相对战。

### 与朋友联机

`npm start` 以开发模式运行，前端与后端分别监听 3000 与 4000 端口，仅适用于本机开发与体验。与局域网或外网的朋友对战时，请使用便携版：

```bash
npm run package:portable
```

便携版解压即可运行，无需安装 Node.js，并内置网关，所有请求统一经由 3000 端口。使用 frp、cpolar、cloudflared 等内网穿透工具时，只需映射这一个端口。

无需为联机设置任何 `NEXT_PUBLIC_*` 环境变量。前端会自动连接当前访问的地址，设置这些变量反而会使外网玩家连接到其本机的 `localhost`。

## 部署到 Cloudflare

前端、API 与 WebSocket 由同一个 Worker 提供；对局状态保存在 Durable Objects，账号、卡组与对局记录保存在 D1，卡图托管在 R2。免费额度可满足小规模使用。部署命令如下，可重复执行：

```bash
npm run deploy:cf -- --card-cdn <R2 卡图域名>
```

线上 Worker 由 Cloudflare 控制台直接绑定本仓库自动构建：推送到 `main` 后自动构建并部署，构建命令为 `npm run build:worker`。卡图 CDN 由构建环境变量 `NEXT_PUBLIC_CARD_CDN` 指定，未设置时使用 `scripts/build-cf-static.mjs` 中的默认域名。

完整步骤、在本地以 Cloudflare 运行时调试的方法及注意事项，见 [Cloudflare 部署指南](docs/deploy/cloudflare.md)。在中国大陆访问需要绑定自定义域名。

## 项目结构

本项目为 npm Workspaces 单仓库，各包按依赖顺序如下：

| 包 | 说明 |
| --- | --- |
| `packages/shared` | 类型定义、对局 Action/Event 协议、WebSocket 事件约定 |
| `packages/game-rules` | 构筑规则校验、官方预组卡表 |
| `packages/game-engine` | 纯 TypeScript 规则引擎（`GameEngine.dispatchAction`）与全部卡牌数据 |
| `packages/database` | 数据仓储接口与实现，供本机部署使用 |
| `apps/server` | 本机部署后端：Fastify REST + Socket.IO |
| `apps/worker` | Cloudflare 后端：Workers + Durable Objects + D1 |
| `apps/web` | Next.js 14 前端，两种后端共用 |

`docs/` 存放规则整理、部署指南与审查报告，`scripts/` 存放启动、打包、部署与卡图相关脚本。

## 参与贡献

```bash
npm run build       # 按依赖顺序编译全部包；测试依赖编译产物，请先执行一次
npm test            # 规则引擎、本机后端、Cloudflare 后端（本地 workerd 端到端）与前端测试
npm run lint
npm run typecheck
```

提交代码前请阅读 [AGENTS.md](AGENTS.md)，其中包含分支与 PR 规范、合并前的实测要求、两套后端的协议一致性等约定。修改规则逻辑时，请以规则整理中的条款编号为依据，并补充相应测试。

## 许可协议

- 本项目的原创源代码以 [MIT License](LICENSE) 授权。
- 《战双帕弥什》相关的卡牌插画、卡牌名称与效果文本、角色形象、背景设定、标识及商标等，其一切权利归广州库洛科技有限公司（Kuro Games）所有，不在 MIT 许可范围之内。
- 上述内容仅限用于非商业性的交流、学习与研究，不得用于任何商业用途。MIT 许可中「销售」等权利仅适用于不含上述内容的原创代码。
- 如权利方认为本项目存在不当之处，请通过 Issue 联系，我们将及时处理。

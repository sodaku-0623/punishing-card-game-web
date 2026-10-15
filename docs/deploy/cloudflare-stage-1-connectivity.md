# Cloudflare 迁移阶段 1：国内多网络连通性验证与测速指南

本文档指导如何部署 `apps/worker` 最小连通性验证服务，并组织国内多网络环境玩家开展连通性与往返延迟实测。

> [!IMPORTANT]
> **前置决策依据**：国内三大运营商（电信、联通、移动）对 Cloudflare 官方赠送的 `*.workers.dev` 域名存在普遍的 DNS 污染与 SNI 阻断。因此**必须为 Worker 绑定自定义域名（Custom Domain）进行测试**，才能真实反映 Cloudflare 边缘节点在国内的网络表现。

---

## 一、部署前准备

1. **Cloudflare 账号**：拥有一个正常的 Cloudflare 账号（免费版计划即可）。
2. **已接入 Cloudflare 的域名**：
   - 在 Cloudflare 控制台中已托管的一个域名（例如 `example.com`）；
   - 或者通过 NS/CNAME 接入 Cloudflare 的二级域名。
3. **本地开发环境**：
   - 已安装 Node.js >= 18；
   - 处于本仓库根目录，且已完成 `npm install`。

---

## 二、部署步骤

### 1. 登录 Cloudflare 账号

在项目根目录下执行：

```bash
npx wrangler login
```

浏览器将自动弹出 Cloudflare 授权页面，登录并确认授权即可。

### 2. 执行部署

进入 worker 目录或直接通过 monorepo 运行部署命令：

```bash
npm run deploy -w @zhanshuang/worker
```

命令执行完毕后，wrangler 会在 Cloudflare 上创建 `zhanshuang-worker`，并输出默认的测试地址（如 `https://zhanshuang-worker.<your-subdomain>.workers.dev`）。

### 3. 绑定自定义域名（必须操作）

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)；
2. 进入 **Workers & Pages** -> 点击 **zhanshuang-worker**；
3. 切换到 **Settings（设置）** -> **Domains & Routes（域与路由）**；
4. 点击 **Add（添加）** -> 选择 **Custom Domain（自定义网域）**；
5. 输入一个专用于本次连通性测试的二级域名，例如：
   ```
   cf-test.yourdomain.com
   ```
6. 点击 **Add Custom Domain**，Cloudflare 会自动完成 DNS 记录添加并签发 SSL 证书（通常耗时 1~3 分钟生效）。
7. 确保该域名的 SSL/TLS 加密模式设置为 **Full** 或 **Strict**。

---

## 三、测试方法与玩家操作指引

将绑定好的自定义域名（例如 `https://cf-test.yourdomain.com`）分享给协作者及测试玩家。

### 1. 目标覆盖网络
请至少寻找以下 4 类典型国内网络环境的玩家进行测试：
- **中国电信（China Telecom）**：家用有线宽带 / Wi-Fi
- **中国联通（China Unicom）**：家用有线宽带 / Wi-Fi
- **中国移动（China Mobile）**：家用有线宽带 / Wi-Fi
- **手机蜂窝移动网络（4G / 5G）**：移动、联通或电信数据流量

### 2. 玩家测试步骤
1. 用手机或电脑浏览器打开测试链接（如 `https://cf-test.yourdomain.com`）；
2. 页面会自动建立 WebSocket 连接至 Durable Object，并开始按 1000ms 频率发包探测；
3. 在「测试人员网络环境备注」输入框中输入自己所在省市和运营商（如：`广东广州电信 1000M`）；
4. 保持页面运行 **至少 1~2 分钟（发包采样达到 60~120 次以上）**；
5. 点击绿色的 **「📋 一键复制 Markdown 测速报告」** 按钮；
6. 将剪贴板中的内容回复至 GitHub PR 评论区或讨论群中。

---

## 四、质量评价与迁移推进判定阈值

| 指标项 | 优秀（极佳） | 良好（可接受） | 临界警告（勉强） | 不可接受（建议中止迁移） |
| :--- | :--- | :--- | :--- | :--- |
| **P50 延迟** | ≤ 80 ms | 80 ~ 140 ms | 140 ~ 220 ms | **> 250 ms** |
| **P95 延迟** | ≤ 120 ms | 120 ~ 200 ms | 200 ~ 300 ms | **> 350 ms** |
| **丢包率** | 0% | < 1.0% | 1.0% ~ 3.0% | **≥ 5.0%** |
| **异常断线** | 0 次 | ≤ 1 次 | 2 ~ 3 次 | **频繁断线无法保持** |

- **通过标准**：若三大运营商有线与 5G 网络的 P50 延迟普遍在 150ms 以内，丢包率 < 2%，则具备实时卡牌对战的可用性，确认后即可推进**阶段 2（后端迁移）**。
- **中止标准**：若出现大面积完全无法连通、握手失败、丢包率高于 10% 或延迟突破 300ms，则说明 Cloudflare 免费套餐在国内无法支撑稳定对战，应停止后续阶段迁移，保留原 Node 架构。

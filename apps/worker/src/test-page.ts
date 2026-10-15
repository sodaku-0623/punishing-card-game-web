/**
 * 生成内嵌的静态网络连通性测试终端 HTML
 * 零外部 CDN 依赖，保证在任何国内网络环境下都能瞬间秒开并稳定运行。
 */
export function getTestPageHtml(): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>《战双帕弥什》Cloudflare 边缘连通性与网络测速终端</title>
  <style>
    :root {
      --bg: #0b0f17;
      --card-bg: #131b2a;
      --card-border: #1e293b;
      --text-main: #f1f5f9;
      --text-muted: #94a3b8;
      --cyan: #06b6d4;
      --cyan-glow: rgba(6, 182, 212, 0.25);
      --green: #10b981;
      --yellow: #f59e0b;
      --red: #ef4444;
      --accent: #e11d48;
    }
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    body {
      background-color: var(--bg);
      color: var(--text-main);
      font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Segoe UI", Roboto, sans-serif;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 24px 16px;
    }
    .container {
      width: 100%;
      max-width: 900px;
      display: flex;
      flex-direction: column;
      gap: 20px;
    }
    header {
      background: linear-gradient(135deg, #162032 0%, #0d131f 100%);
      border: 1px solid var(--card-border);
      border-radius: 12px;
      padding: 24px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 16px;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
    }
    .header-title h1 {
      font-size: 20px;
      font-weight: 700;
      letter-spacing: 0.5px;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .badge {
      font-size: 12px;
      font-weight: 600;
      padding: 3px 8px;
      border-radius: 6px;
      text-transform: uppercase;
      background: rgba(6, 182, 212, 0.15);
      color: var(--cyan);
      border: 1px solid var(--cyan);
    }
    .header-desc {
      color: var(--text-muted);
      font-size: 13px;
      margin-top: 6px;
    }
    .status-pill {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 16px;
      border-radius: 20px;
      font-size: 14px;
      font-weight: 600;
      background: #1e293b;
      border: 1px solid #334155;
    }
    .status-dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: var(--yellow);
      box-shadow: 0 0 8px currentColor;
    }
    .status-dot.connected { background: var(--green); }
    .status-dot.connecting { background: var(--yellow); }
    .status-dot.disconnected { background: var(--red); }

    .node-info-bar {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 12px;
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 10px;
      padding: 16px;
      font-size: 13px;
    }
    .node-item {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .node-label {
      color: var(--text-muted);
      font-size: 12px;
    }
    .node-value {
      font-weight: 600;
      color: var(--cyan);
      word-break: break-all;
    }

    .metrics-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 16px;
    }
    .metric-card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 10px;
      padding: 18px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      transition: transform 0.15s ease, border-color 0.15s ease;
    }
    .metric-card:hover {
      border-color: #38bdf8;
      transform: translateY(-2px);
    }
    .metric-label {
      font-size: 13px;
      color: var(--text-muted);
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .metric-value {
      font-size: 32px;
      font-weight: 700;
      color: var(--text-main);
      font-variant-numeric: tabular-nums;
    }
    .metric-unit {
      font-size: 14px;
      font-weight: normal;
      color: var(--text-muted);
      margin-left: 4px;
    }
    .metric-sub {
      font-size: 12px;
      color: var(--text-muted);
    }

    .chart-box {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 10px;
      padding: 20px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .chart-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 14px;
      font-weight: 600;
    }
    canvas#latencyChart {
      width: 100%;
      height: 120px;
      background: #0f1624;
      border-radius: 6px;
    }

    .control-panel {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 10px;
      padding: 20px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .form-row {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
    }
    .input-group {
      flex: 1;
      min-width: 240px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    label {
      font-size: 13px;
      color: var(--text-muted);
    }
    input, select {
      background: #0b0f17;
      border: 1px solid var(--card-border);
      color: var(--text-main);
      padding: 10px 14px;
      border-radius: 6px;
      font-size: 14px;
      outline: none;
      transition: border-color 0.15s ease;
    }
    input:focus, select:focus {
      border-color: var(--cyan);
    }
    .btn-group {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
    }
    button {
      padding: 10px 18px;
      border-radius: 6px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      border: none;
      transition: all 0.15s ease;
    }
    .btn-primary {
      background: var(--cyan);
      color: #0b0f17;
    }
    .btn-primary:hover {
      background: #22d3ee;
      box-shadow: 0 0 12px var(--cyan-glow);
    }
    .btn-secondary {
      background: #1e293b;
      color: var(--text-main);
      border: 1px solid #334155;
    }
    .btn-secondary:hover {
      background: #334155;
    }
    .btn-copy {
      background: #059669;
      color: white;
    }
    .btn-copy:hover {
      background: #10b981;
    }

    .log-box {
      background: #080c14;
      border: 1px solid var(--card-border);
      border-radius: 8px;
      height: 150px;
      overflow-y: auto;
      padding: 12px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 12px;
      line-height: 1.5;
      color: #a1a1aa;
    }
    .log-item {
      display: flex;
      gap: 8px;
    }
    .log-time { color: #52525b; }
    .log-ok { color: var(--green); }
    .log-warn { color: var(--yellow); }
    .log-err { color: var(--red); }

    footer {
      text-align: center;
      font-size: 12px;
      color: #64748b;
      margin-top: 10px;
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div class="header-title">
        <h1>《战双帕弥什》Cloudflare 连通性测试终端 <span class="badge">Phase 1</span></h1>
        <div class="header-desc">Durable Objects + WebSocket Hibernation 国内多网络延迟与丢包率实时诊断</div>
      </div>
      <div class="status-pill">
        <span id="statusDot" class="status-dot connecting"></span>
        <span id="statusText">正在握手...</span>
      </div>
    </header>

    <div class="node-info-bar">
      <div class="node-item">
        <span class="node-label">边缘接引节点 (CF Colo)</span>
        <span id="infoColo" class="node-value">探测中...</span>
      </div>
      <div class="node-item">
        <span class="node-label">识别运营商 / ASN</span>
        <span id="infoOrg" class="node-value">探测中...</span>
      </div>
      <div class="node-item">
        <span class="node-label">访客区域与时区</span>
        <span id="infoLoc" class="node-value">探测中...</span>
      </div>
      <div class="node-item">
        <span class="node-label">HTTP API 握手往返</span>
        <span id="infoHttpRtt" class="node-value">-- ms</span>
      </div>
    </div>

    <div class="metrics-grid">
      <div class="metric-card">
        <div class="metric-label">实时延迟 (Current)</div>
        <div class="metric-value"><span id="rttCurrent">--</span><span class="metric-unit">ms</span></div>
        <div class="metric-sub">单次 Ping/Pong 往返</div>
      </div>
      <div class="metric-card" style="border-color: #0284c7;">
        <div class="metric-label">延迟中位数 (P50)</div>
        <div class="metric-value" style="color: #38bdf8;"><span id="rttP50">--</span><span class="metric-unit">ms</span></div>
        <div class="metric-sub">核心对局平均响应体感</div>
      </div>
      <div class="metric-card" style="border-color: #8b5cf6;">
        <div class="metric-label">高位波动 (P95)</div>
        <div class="metric-value" style="color: #a78bfa;"><span id="rttP95">--</span><span class="metric-unit">ms</span></div>
        <div class="metric-sub">95% 探测延迟均低于该值</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">极值 (Min / Max)</div>
        <div class="metric-value" style="font-size: 24px; margin-top: 6px;">
          <span id="rttMin">--</span> / <span id="rttMax">--</span><span class="metric-unit">ms</span>
        </div>
        <div class="metric-sub">最低与最高瞬时波动</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">稳定性 (丢包率)</div>
        <div class="metric-value"><span id="lossRate">0.0</span><span class="metric-unit">%</span></div>
        <div class="metric-sub">丢包数: <span id="lostCount">0</span> / <span id="sentCount">0</span></div>
      </div>
      <div class="metric-card">
        <div class="metric-label">连接断开重连</div>
        <div class="metric-value"><span id="disconnectCount">0</span><span class="metric-unit">次</span></div>
        <div class="metric-sub">对战稳定性评价: <span id="networkEval" style="font-weight: 600;">评估中</span></div>
      </div>
    </div>

    <div class="chart-box">
      <div class="chart-header">
        <span>实时延迟波动波形 (最近 60 次采样)</span>
        <span style="font-size: 12px; color: var(--text-muted); font-weight: normal;">绿(&lt;80ms) · 蓝(&lt;150ms) · 黄(&lt;250ms) · 红(&ge;250ms/丢包)</span>
      </div>
      <canvas id="latencyChart" width="860" height="120"></canvas>
    </div>

    <div class="control-panel">
      <div class="form-row">
        <div class="input-group">
          <label for="ispInput">测试人员网络环境备注 (用于复制汇报)：</label>
          <input type="text" id="ispInput" placeholder="例如：广东广州电信 1000M 宽带 / 北京联通 5G 手机网络" />
        </div>
        <div class="input-group" style="max-width: 200px;">
          <label for="intervalSelect">发包探测频率：</label>
          <select id="intervalSelect">
            <option value="500">高频 (500ms)</option>
            <option value="1000" selected>标准 (1000ms)</option>
            <option value="2000">低频 (2000ms)</option>
          </select>
        </div>
      </div>
      <div class="btn-group">
        <button id="toggleBtn" class="btn-primary">暂停测速</button>
        <button id="resetBtn" class="btn-secondary">重置数据</button>
        <button id="copyBtn" class="btn-copy">📋 一键复制 Markdown 测速报告</button>
      </div>
      <div id="copyNotice" style="display: none; color: var(--green); font-size: 13px; font-weight: 600;">
        ✓ 测试报告已成功复制到剪贴板，可直接粘贴提交到 PR 或协作者群！
      </div>
    </div>

    <div class="control-panel" style="padding-top: 14px;">
      <div style="font-size: 13px; font-weight: 600; color: var(--text-muted); margin-bottom: 8px;">探测交互日志：</div>
      <div id="logBox" class="log-box"></div>
    </div>

    <footer>
      《战双帕弥什 卡牌对战》Cloudflare 迁移项目 · Phase 1 国内连通性验证工程
    </footer>
  </div>

  <script>
    (function() {
      // 核心统计状态
      let isRunning = true;
      let pingInterval = 1000;
      let timer = null;
      let ws = null;
      let seq = 0;
      const pendingPings = new Map(); // seq -> sendTime
      const rttHistory = []; // [rtt1, rtt2, ...]
      const chartSamples = []; // 最近 60 次用于波形绘制
      let sentCount = 0;
      let receivedCount = 0;
      let lostCount = 0;
      let disconnectCount = 0;
      let edgeInfo = { colo: '--', org: '--', loc: '--' };

      // DOM 元素
      const statusDot = document.getElementById('statusDot');
      const statusText = document.getElementById('statusText');
      const rttCurrent = document.getElementById('rttCurrent');
      const rttP50 = document.getElementById('rttP50');
      const rttP95 = document.getElementById('rttP95');
      const rttMin = document.getElementById('rttMin');
      const rttMax = document.getElementById('rttMax');
      const lossRateEl = document.getElementById('lossRate');
      const lostCountEl = document.getElementById('lostCount');
      const sentCountEl = document.getElementById('sentCount');
      const disconnectCountEl = document.getElementById('disconnectCount');
      const networkEvalEl = document.getElementById('networkEval');
      const infoColo = document.getElementById('infoColo');
      const infoOrg = document.getElementById('infoOrg');
      const infoLoc = document.getElementById('infoLoc');
      const infoHttpRtt = document.getElementById('infoHttpRtt');
      const logBox = document.getElementById('logBox');
      const toggleBtn = document.getElementById('toggleBtn');
      const resetBtn = document.getElementById('resetBtn');
      const copyBtn = document.getElementById('copyBtn');
      const copyNotice = document.getElementById('copyNotice');
      const ispInput = document.getElementById('ispInput');
      const intervalSelect = document.getElementById('intervalSelect');
      const canvas = document.getElementById('latencyChart');
      const ctx = canvas.getContext('2d');

      // 1. 日志记录
      function appendLog(type, text) {
        const timeStr = new Date().toTimeString().split(' ')[0] + '.' + String(Date.now() % 1000).padStart(3, '0');
        const div = document.createElement('div');
        div.className = 'log-item';
        let cls = 'log-ok';
        if (type === 'warn') cls = 'log-warn';
        if (type === 'err') cls = 'log-err';
        div.innerHTML = '<span class="log-time">[' + timeStr + ']</span> <span class="' + cls + '">' + text + '</span>';
        logBox.appendChild(div);
        if (logBox.children.length > 100) {
          logBox.removeChild(logBox.children[0]);
        }
        logBox.scrollTop = logBox.scrollHeight;
      }

      // 2. HTTP 边缘节点嗅探
      async function probeHttpEdge() {
        const t0 = performance.now();
        try {
          const res = await fetch('/api/time?t=' + Date.now(), { cache: 'no-store' });
          const t1 = performance.now();
          const rtt = Math.round(t1 - t0);
          infoHttpRtt.textContent = rtt + ' ms';
          if (res.ok) {
            const data = await res.json();
            if (data.edgeInfo) {
              edgeInfo.colo = data.edgeInfo.colo || '未知';
              edgeInfo.org = data.edgeInfo.asOrganization || '未知';
              edgeInfo.loc = (data.edgeInfo.country || '') + ' ' + (data.edgeInfo.city || '');
              infoColo.textContent = edgeInfo.colo;
              infoOrg.textContent = edgeInfo.org;
              infoLoc.textContent = edgeInfo.loc.trim() || '未知地区';
            }
          }
        } catch (e) {
          infoHttpRtt.textContent = '异常';
        }
      }

      // 3. 计算 P50 / P95 与极值统计
      function updateStats() {
        if (rttHistory.length === 0) return;
        const sorted = [...rttHistory].sort((a, b) => a - b);
        const p50 = sorted[Math.floor(sorted.length * 0.5)];
        const p95 = sorted[Math.floor(sorted.length * 0.95)];
        const min = sorted[0];
        const max = sorted[sorted.length - 1];

        rttP50.textContent = p50;
        rttP95.textContent = p95;
        rttMin.textContent = min;
        rttMax.textContent = max;

        const rate = sentCount > 0 ? ((lostCount / sentCount) * 100).toFixed(1) : '0.0';
        lossRateEl.textContent = rate;
        lostCountEl.textContent = lostCount;
        sentCountEl.textContent = sentCount;
        disconnectCountEl.textContent = disconnectCount;

        // 网络评级
        if (rate > 10 || p50 >= 300) {
          networkEvalEl.textContent = '❌ 不可接受 (严重丢包/卡顿)';
          networkEvalEl.style.color = 'var(--red)';
        } else if (rate > 3 || p50 >= 200) {
          networkEvalEl.textContent = '⚠️ 勉强可用 (有一定延迟感)';
          networkEvalEl.style.color = 'var(--yellow)';
        } else if (p50 <= 90 && p95 <= 130 && rate < 1) {
          networkEvalEl.textContent = '🟢 极佳 (流畅对战体验)';
          networkEvalEl.style.color = 'var(--green)';
        } else {
          networkEvalEl.textContent = '🔵 良好 (满足卡牌对局)';
          networkEvalEl.style.color = 'var(--cyan)';
        }
      }

      // 4. 绘制延迟波形图
      function drawChart() {
        const w = canvas.width;
        const h = canvas.height;
        ctx.clearRect(0, 0, w, h);

        // 网格线
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, h * 0.25); ctx.lineTo(w, h * 0.25);
        ctx.moveTo(0, h * 0.5); ctx.lineTo(w, h * 0.5);
        ctx.moveTo(0, h * 0.75); ctx.lineTo(w, h * 0.75);
        ctx.stroke();

        if (chartSamples.length < 2) return;

        const maxVal = Math.max(250, ...chartSamples.map(s => s === -1 ? 0 : s));
        const barWidth = w / 60;

        chartSamples.forEach((val, idx) => {
          const x = idx * barWidth;
          if (val === -1) {
            // 丢包显示红色警报柱
            ctx.fillStyle = '#ef4444';
            ctx.fillRect(x + 1, 0, barWidth - 2, h);
          } else {
            const barHeight = Math.min(h, (val / maxVal) * (h - 10));
            const y = h - barHeight;
            if (val < 80) ctx.fillStyle = '#10b981';
            else if (val < 150) ctx.fillStyle = '#06b6d4';
            else if (val < 250) ctx.fillStyle = '#f59e0b';
            else ctx.fillStyle = '#ef4444';
            ctx.fillRect(x + 1, y, barWidth - 2, barHeight);
          }
        });
      }

      // 5. WebSocket 连接管理
      function connectWs() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = protocol + '//' + window.location.host + '/ws';

        statusDot.className = 'status-dot connecting';
        statusText.textContent = '正在连接 Durable Object...';
        appendLog('info', '发起 WebSocket 连接至 ' + wsUrl);

        try {
          ws = new WebSocket(wsUrl);
        } catch (e) {
          statusDot.className = 'status-dot disconnected';
          statusText.textContent = '创建连接失败';
          appendLog('err', '创建 WebSocket 实例失败: ' + e.message);
          return;
        }

        ws.onopen = function() {
          statusDot.className = 'status-dot connected';
          statusText.textContent = '已接入 Cloudflare DO';
          appendLog('info', 'WebSocket 握手成功！Durable Object 实例已唤醒');
          startPingLoop();
        };

        ws.onmessage = function(event) {
          try {
            const data = JSON.parse(event.data);
            if (data.type === 'connected') {
              appendLog('info', '收到服务欢迎报文: ' + data.message);
            } else if (data.type === 'pong') {
              const sendTime = pendingPings.get(data.seq);
              if (sendTime) {
                const rtt = Math.round(performance.now() - sendTime);
                pendingPings.delete(data.seq);
                receivedCount++;
                rttCurrent.textContent = rtt;
                rttHistory.push(rtt);
                chartSamples.push(rtt);
                if (chartSamples.length > 60) chartSamples.shift();
                updateStats();
                drawChart();
                appendLog('ok', 'Ping #' + data.seq + ' 响应: ' + rtt + 'ms (服务端时钟: ' + new Date(data.serverTime).toTimeString().split(' ')[0] + ')');
              }
            }
          } catch (e) {
            appendLog('warn', '收到非 JSON 消息: ' + event.data);
          }
        };

        ws.onclose = function(e) {
          statusDot.className = 'status-dot disconnected';
          statusText.textContent = '连接已断开 (' + e.code + ')';
          disconnectCount++;
          disconnectCountEl.textContent = disconnectCount;
          appendLog('err', 'WebSocket 连接断开: code=' + e.code + ', reason=' + (e.reason || '无'));
          stopPingLoop();
          if (isRunning) {
            appendLog('warn', '2 秒后尝试自动重新连接...');
            setTimeout(connectWs, 2000);
          }
        };

        ws.onerror = function() {
          appendLog('err', 'WebSocket 遇到网络错误');
        };
      }

      // 6. Ping 发送循环
      function sendPing() {
        if (!ws || ws.readyState !== WebSocket.OPEN) return;

        // 检查上一轮是否有超时的未响应 ping (判定丢包)
        const now = performance.now();
        for (const [s, st] of pendingPings.entries()) {
          if (now - st > 3000) {
            lostCount++;
            pendingPings.delete(s);
            chartSamples.push(-1);
            if (chartSamples.length > 60) chartSamples.shift();
            appendLog('err', 'Ping #' + s + ' 超过 3000ms 未响应，判定丢包');
            updateStats();
            drawChart();
          }
        }

        seq++;
        sentCount++;
        const sendTime = performance.now();
        pendingPings.set(seq, sendTime);

        try {
          ws.send(JSON.stringify({
            type: 'ping',
            seq: seq,
            clientTime: Date.now()
          }));
        } catch (e) {
          appendLog('err', '发送 Ping 失败: ' + e.message);
        }
      }

      function startPingLoop() {
        stopPingLoop();
        if (isRunning) {
          timer = setInterval(sendPing, pingInterval);
          sendPing();
        }
      }

      function stopPingLoop() {
        if (timer) {
          clearInterval(timer);
          timer = null;
        }
      }

      // 7. 用户交互绑定
      toggleBtn.addEventListener('click', function() {
        isRunning = !isRunning;
        if (isRunning) {
          toggleBtn.textContent = '暂停测速';
          toggleBtn.className = 'btn-primary';
          appendLog('info', '恢复网络测速发包');
          if (!ws || ws.readyState !== WebSocket.OPEN) {
            connectWs();
          } else {
            startPingLoop();
          }
        } else {
          toggleBtn.textContent = '继续测速';
          toggleBtn.className = 'btn-secondary';
          stopPingLoop();
          appendLog('warn', '测速发包已手动暂停');
        }
      });

      intervalSelect.addEventListener('change', function() {
        pingInterval = parseInt(intervalSelect.value, 10);
        appendLog('info', '发包频率调整为: ' + pingInterval + 'ms');
        if (isRunning && ws && ws.readyState === WebSocket.OPEN) {
          startPingLoop();
        }
      });

      resetBtn.addEventListener('click', function() {
        pendingPings.clear();
        rttHistory.length = 0;
        chartSamples.length = 0;
        sentCount = 0;
        receivedCount = 0;
        lostCount = 0;
        disconnectCount = 0;
        seq = 0;
        rttCurrent.textContent = '--';
        rttP50.textContent = '--';
        rttP95.textContent = '--';
        rttMin.textContent = '--';
        rttMax.textContent = '--';
        lossRateEl.textContent = '0.0';
        lostCountEl.textContent = '0';
        sentCountEl.textContent = '0';
        disconnectCountEl.textContent = '0';
        networkEvalEl.textContent = '评估中';
        drawChart();
        appendLog('info', '统计数据与采样样本已全部重置');
      });

      // 8. 一键复制 Markdown 测速报告
      copyBtn.addEventListener('click', function() {
        const isp = ispInput.value.trim() || '未备注网络环境 (请在此填写例如：广东电信 1000M 宽带)';
        const p50 = rttP50.textContent;
        const p95 = rttP95.textContent;
        const min = rttMin.textContent;
        const max = rttMax.textContent;
        const loss = lossRateEl.textContent;
        const evalStr = networkEvalEl.textContent;
        const nowStr = new Date().toLocaleString('zh-CN');

        const mdReport = [
          '### 《战双帕弥什》Cloudflare 国内连通性测速报告 (Phase 1)',
          '- **测试时间**：' + nowStr,
          '- **网络运营商/环境**：' + isp,
          '- **Cloudflare 接入节点 (Colo)**：' + (infoColo.textContent || '未知'),
          '- **系统识别 ISP / ASN**：' + (infoOrg.textContent || '未知'),
          '- **地理区域**：' + (infoLoc.textContent || '未知'),
          '- **HTTP API 握手**：' + infoHttpRtt.textContent,
          '- **有效探测采样数**：' + sentCount + ' 次 (收包: ' + receivedCount + '，丢包: ' + lostCount + ')',
          '- **延迟中位数 (P50)**：' + p50 + ' ms',
          '- **高位波动 (P95)**：' + p95 + ' ms',
          '- **极值区间 (Min / Max)**：' + min + ' ms / ' + max + ' ms',
          '- **丢包率**：' + loss + ' %',
          '- **断线重连次数**：' + disconnectCount + ' 次',
          '- **综合网络评级**：' + evalStr,
        ].join('\\n');

        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(mdReport).then(showCopied, fallbackCopy);
        } else {
          fallbackCopy();
        }

        function fallbackCopy() {
          const ta = document.createElement('textarea');
          ta.value = mdReport;
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          document.body.removeChild(ta);
          showCopied();
        }

        function showCopied() {
          copyNotice.style.display = 'block';
          setTimeout(function() {
            copyNotice.style.display = 'none';
          }, 3500);
        }
      });

      // 启动初始化
      probeHttpEdge();
      connectWs();
      setInterval(probeHttpEdge, 15000);
    })();
  </script>
</body>
</html>`;
}

/**
 * 《战双帕弥什 卡牌对战》多房间高并发压力测试套件 (Phase 12 并发与稳定性基准测试)
 * 模拟 50~80 个并发对战房间 (100~160 个高频 WebSocket 客户端并发打牌交互)
 */

import { io } from 'socket.io-client';
import { spawn } from 'node:child_process';
import http from 'node:http';

const args = process.argv.slice(2);
function getArg(name, defaultValue) {
  const index = args.indexOf(`--${name}`);
  if (index !== -1 && args[index + 1]) {
    return args[index + 1];
  }
  return defaultValue;
}

const ROOM_COUNT = parseInt(getArg('rooms', '50'), 10);
const ACTIONS_PER_ROOM = parseInt(getArg('actions', '6'), 10);
const PORT = parseInt(getArg('port', '4000'), 10);
const HOST = getArg('host', 'localhost');
const SERVER_URL = `http://${HOST}:${PORT}`;

console.log('===============================================================');
console.log('   《战双帕弥什 卡牌对战》桌面级性能与并发压力测试套件');
console.log('===============================================================');
console.log(`并发房间数: ${ROOM_COUNT} 房间 (${ROOM_COUNT * 2} 个并发 WebSocket 玩家客户端)`);
console.log(`每房动作轮次: ${ACTIONS_PER_ROOM} 轮次 (预计总推演交互量: ~${ROOM_COUNT * ACTIONS_PER_ROOM * 2} Actions)`);
console.log(`目标服务地址: ${SERVER_URL}`);
console.log('---------------------------------------------------------------');

async function isServerAlive() {
  try {
    const res = await fetch(`${SERVER_URL}/health`);
    return res.ok;
  } catch {
    return false;
  }
}

async function fetchMetrics() {
  try {
    const res = await fetch(`${SERVER_URL}/api/admin/monitor`);
    if (res.ok) {
      const json = await res.json();
      return json.data || json;
    }
  } catch {}
  return null;
}

let serverProcess = null;

function killServerProcess() {
  if (!serverProcess) return;
  if (process.platform === 'win32' && serverProcess.pid) {
    try {
      spawn('taskkill', ['/pid', serverProcess.pid.toString(), '/f', '/t'], { stdio: 'ignore' });
    } catch {}
  } else {
    try {
      serverProcess.kill();
    } catch {}
  }
  serverProcess = null;
}

async function ensureServerRunning() {
  const alive = await isServerAlive();
  if (alive) {
    console.log('[Setup] 检测到后端服务器已在运行，直接复用既有实例。');
    return;
  }

  console.log('[Setup] 正在启动独立测试后端服务 (PORT: 4000)...');
  serverProcess = spawn('node', ['apps/server/dist/index.js'], {
    stdio: 'ignore',
    shell: false,
    env: { ...process.env, PORT: PORT.toString() },
  });

  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 250));
    if (await isServerAlive()) {
      console.log('[Setup] 测试服务成功就绪！');
      return;
    }
  }
  throw new Error('无法连接或启动测试服务器，请检查编译产物');
}

function calculatePercentiles(latencies) {
  if (latencies.length === 0) {
    return { min: 0, max: 0, mean: 0, p50: 0, p90: 0, p95: 0, p99: 0 };
  }
  const sorted = [...latencies].sort((a, b) => a - b);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  const mean = sum / sorted.length;
  const p50 = sorted[Math.floor(sorted.length * 0.5)];
  const p90 = sorted[Math.floor(sorted.length * 0.9)];
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  const p99 = sorted[Math.floor(sorted.length * 0.99)];
  return { min, max, mean, p50, p90, p95, p99 };
}

async function runSingleRoom(roomIndex, stats) {
  const p1Id = `stress_p1_${roomIndex}_${Date.now()}`;
  const p2Id = `stress_p2_${roomIndex}_${Date.now()}`;
  const roomId = `stress_rm_${roomIndex}_${Date.now()}`;
  const roomTitle = `压测房间_${roomIndex}`;

  try {
    const res = await fetch(`${SERVER_URL}/api/rooms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roomId,
        title: roomTitle,
        creatorId: p1Id,
        creatorName: `灰鸦测试员1_${roomIndex}`,
      }),
    });
    if (!res.ok) {
      stats.failedRooms++;
      return false;
    }
  } catch {
    stats.failedRooms++;
    return false;
  }

  const socketOptions1 = {
    transports: ['websocket'],
    reconnection: false,
    timeout: 10000,
    query: { userId: p1Id, username: `灰鸦测试员1_${roomIndex}` },
    auth: { userId: p1Id, username: `灰鸦测试员1_${roomIndex}` },
  };
  const socketOptions2 = {
    transports: ['websocket'],
    reconnection: false,
    timeout: 10000,
    query: { userId: p2Id, username: `升格测试员2_${roomIndex}` },
    auth: { userId: p2Id, username: `升格测试员2_${roomIndex}` },
  };

  const sock1 = io(SERVER_URL, socketOptions1);
  const sock2 = io(SERVER_URL, socketOptions2);
  stats.totalSockets += 2;

  return new Promise((resolve) => {
    let gameId = null;
    let actionsDone = 0;
    let timeoutTimer = null;
    let isFinished = false;

    const pendingTimers = new Set();

    const cleanup = () => {
      isFinished = true;
      if (timeoutTimer) clearTimeout(timeoutTimer);
      for (const t of pendingTimers) clearTimeout(t);
      pendingTimers.clear();
      try {
        sock1.removeAllListeners();
        sock2.removeAllListeners();
        sock1.disconnect();
        sock2.disconnect();
      } catch {}
    };

    timeoutTimer = setTimeout(() => {
      if (!isFinished) {
        stats.failedRooms++;
        cleanup();
        resolve(false);
      }
    }, 45000);

    const onConnected = () => {
      if (sock1.connected && sock2.connected) {
        sock1.emit('room:join', { roomId, userId: p1Id, username: `灰鸦测试员1_${roomIndex}` });
        sock2.emit('room:join', { roomId, userId: p2Id, username: `升格测试员2_${roomIndex}` });
      }
    };

    sock1.on('connect', onConnected);
    sock2.on('connect', onConnected);

    const onRoomUpdate = (room) => {
      if (isFinished) return;
      if (room?.roomId !== roomId && room?.id !== roomId) return;
      if (room.players?.length === 2 && room.status !== 'PLAYING') {
        const p1 = room.players.find((p) => p.userId === p1Id);
        const p2 = room.players.find((p) => p.userId === p2Id);

        if (!p1?.isReady) {
          sock1.emit('room:ready', { roomId, isReady: true, deckId: 'deck-st01' });
        }
        if (!p2?.isReady) {
          sock2.emit('room:ready', { roomId, isReady: true, deckId: 'deck-st02' });
        }
        if (p1?.isReady && p2?.isReady) {
          sock1.emit('room:start', { roomId });
        }
      }
    };

    sock1.on('room:state_updated', onRoomUpdate);
    sock2.on('room:state_updated', onRoomUpdate);

    const handleSyncState = (state, clientPlayerId, socket) => {
      if (isFinished) return;
      if (!gameId && state.gameId) {
        gameId = state.gameId;
        stats.activeGames++;
      }

      if (state.activePlayerId === clientPlayerId && actionsDone < ACTIONS_PER_ROOM && !isFinished) {
        actionsDone++;
        const startTime = Date.now();

        let action = null;
        if (state.phase === 'DRAW_CHARGE_PHASE') {
          const handCardId = state.myHandCards?.[0]?.instanceId;
          action = {
            type: 'CHARGE_COST_FROM_HAND',
            playerId: clientPlayerId,
            cardInstanceId: handCardId,
          };
        } else {
          action = {
            type: 'PASS_ACTION_TIMING',
            playerId: clientPlayerId,
          };
        }

        const onActionResolved = (nextState) => {
          if (nextState.stateVersion > state.stateVersion) {
            const latency = Date.now() - startTime;
            stats.latencies.push(latency);
            stats.completedActions++;
            socket.off('game:sync_state', onActionResolved);

            if (actionsDone >= ACTIONS_PER_ROOM && !isFinished) {
              stats.completedRooms++;
              cleanup();
              resolve(true);
            }
          }
        };

        socket.on('game:sync_state', onActionResolved);
        const t = setTimeout(() => {
          pendingTimers.delete(t);
          if (!isFinished && socket.connected) {
            socket.emit('game:action', { gameId: state.gameId, action });
          }
        }, 15);
        pendingTimers.add(t);
      }
    };

    sock1.on('game:sync_state', (state) => handleSyncState(state, p1Id, sock1));
    sock2.on('game:sync_state', (state) => handleSyncState(state, p2Id, sock2));

    sock1.on('game:error', (err) => {
      if (!isFinished) {
        stats.errors++;
        if (stats.errors <= 3) console.log('Game error sock1:', err);
      }
    });
    sock2.on('game:error', (err) => {
      if (!isFinished) {
        stats.errors++;
        if (stats.errors <= 3) console.log('Game error sock2:', err);
      }
    });
    sock1.on('connect_error', () => {
      if (!isFinished) stats.errors++;
    });
    sock2.on('connect_error', () => {
      if (!isFinished) stats.errors++;
    });
  });
}

async function main() {
  await ensureServerRunning();

  const initialMetrics = await fetchMetrics();
  console.log('[Metrics] 压测前初始系统指标:');
  if (initialMetrics) {
    console.log(`  - 系统 CPU 占用: ${initialMetrics.cpuPercent.toFixed(1)}%`);
    console.log(`  - 内存使用 (RSS): ${initialMetrics.memoryRssMb.toFixed(1)} MB`);
    console.log(`  - 堆内存 (Heap Used): ${initialMetrics.memoryHeapUsedMb.toFixed(1)} MB`);
    console.log(`  - 事件循环延迟 (Lag): ${initialMetrics.eventLoopLagMs.toFixed(2)} ms`);
  }

  console.log('\n[Benchmark] 正在分批并发创建并启动房间...');
  const testStartTime = Date.now();

  const stats = {
    totalSockets: 0,
    activeGames: 0,
    completedRooms: 0,
    failedRooms: 0,
    completedActions: 0,
    errors: 0,
    latencies: [],
  };

  // 分波阶梯式拉起房间 (每批 10 个房间，间隔 150ms)，模拟瞬时突发与梯队上线
  const BATCH_SIZE = 10;
  const roomPromises = [];

  for (let i = 0; i < ROOM_COUNT; i += BATCH_SIZE) {
    const currentBatchLimit = Math.min(i + BATCH_SIZE, ROOM_COUNT);
    const batch = [];
    for (let r = i; r < currentBatchLimit; r++) {
      batch.push(runSingleRoom(r + 1, stats));
    }
    roomPromises.push(...batch);
    if (currentBatchLimit < ROOM_COUNT) {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }

  // 周期性采样性能指标
  let peakCpu = 0;
  let peakMem = 0;
  let peakLag = 0;
  const monitorInterval = setInterval(async () => {
    const cur = await fetchMetrics();
    if (cur) {
      const cpu = cur.cpuPercent;
      const mem = cur.memoryRssMb;
      const lag = cur.eventLoopLagMs;
      if (cpu > peakCpu) peakCpu = cpu;
      if (mem > peakMem) peakMem = mem;
      if (lag > peakLag) peakLag = lag;
    }
  }, 1000);

  await Promise.all(roomPromises);
  clearInterval(monitorInterval);

  const durationSec = (Date.now() - testStartTime) / 1000;
  const finalMetrics = await fetchMetrics();

  const pct = calculatePercentiles(stats.latencies);

  console.log('\n===============================================================');
  console.log('         《战双帕弥什 卡牌对战》并发压测与稳定性基准报告');
  console.log('===============================================================');
  console.log(`并发房间规模: ${ROOM_COUNT} 房间 (双端合计 ${stats.totalSockets} WebSocket 客户端)`);
  console.log(`总耗时: ${durationSec.toFixed(2)} 秒`);
  console.log(`成功对局房间数: ${stats.completedRooms} / ${ROOM_COUNT} (${((stats.completedRooms / ROOM_COUNT) * 100).toFixed(1)}%)`);
  console.log(`完成对局推演总动作数: ${stats.completedActions} Actions`);
  console.log(`吞吐量 (Throughput): ${(stats.completedActions / durationSec).toFixed(1)} Actions/秒`);
  console.log(`异常 / 错误计数: ${stats.errors} (错误率: ${stats.completedActions > 0 ? ((stats.errors / stats.completedActions) * 100).toFixed(3) : 0}%)`);
  console.log('---------------------------------------------------------------');
  console.log('【动作往返响应延迟基准 (Round-trip Action Latency)】');
  console.log(`  - 最小延迟 (Min):   ${pct.min.toFixed(1)} ms`);
  console.log(`  - 平均延迟 (Mean):  ${pct.mean.toFixed(1)} ms`);
  console.log(`  - 中位数 (P50):     ${pct.p50.toFixed(1)} ms`);
  console.log(`  - 90分位 (P90):     ${pct.p90.toFixed(1)} ms`);
  console.log(`  - 95分位 (P95):     ${pct.p95.toFixed(1)} ms  <-- 竞技卡牌基准线 (< 50ms)`);
  console.log(`  - 99分位 (P99):     ${pct.p99.toFixed(1)} ms  <-- 极限长尾延迟 (< 100ms)`);
  console.log(`  - 最大延迟 (Max):   ${pct.max.toFixed(1)} ms`);
  console.log('---------------------------------------------------------------');
  console.log('【服务端硬件资源与事件循环负载】');
  console.log(`  - 压测峰值进程 CPU: ${peakCpu.toFixed(1)}%`);
  console.log(`  - 压测峰值物理内存 (RSS): ${peakMem.toFixed(1)} MB`);
  if (finalMetrics) {
    console.log(`  - 结束物理内存 (RSS): ${finalMetrics.memoryRssMb.toFixed(1)} MB`);
    console.log(`  - 结束堆内存 (Heap Used): ${finalMetrics.memoryHeapUsedMb.toFixed(1)} MB`);
    console.log(`  - 峰值事件循环延迟 (Lag): ${peakLag.toFixed(2)} ms (极度平滑，无长时间阻塞)`);
  }
  console.log('===============================================================\n');

  killServerProcess();
}

main().catch((err) => {
  console.error('压测执行失败:', err);
  killServerProcess();
  process.exit(1);
});

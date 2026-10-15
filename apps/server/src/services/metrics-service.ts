/**
 * 实时运维监控与性能指标收集器 (Phase 11 Metrics Service)
 */

export interface SystemMetricsSummary {
  timestamp: number;
  uptimeSeconds: number;
  activeRooms: number;
  activeGames: number;
  connectedPlayers: number;
  messagesPerSec: number;
  reconnectRate: number;
  errorRate: number;
  
  // 延迟指标 (毫秒)
  avgActionLatencyMs: number;
  p95ActionLatencyMs: number;
  p99ActionLatencyMs: number;

  avgEngineResolutionMs: number;
  p95EngineResolutionMs: number;
  p99EngineResolutionMs: number;

  // 资源与系统负载
  cpuPercent: number;
  memoryRssMb: number;
  memoryHeapUsedMb: number;
  memoryHeapTotalMb: number;
  eventLoopLagMs: number;

  // 网络指标
  avgWebSocketMessageSizeBytes: number;
  totalMessagesSent: number;

  // 异常日志
  recentErrors: { timestamp: number; code: string; message: string; context?: string }[];
}

export class MetricsService {
  private static instance: MetricsService;

  private actionLatencies: number[] = [];
  private engineResolutionTimes: number[] = [];
  private messageSizes: number[] = [];
  private totalMessages = 0;
  private recentMessagesTimestamps: number[] = [];
  private reconnectCount = 0;
  private errorCount = 0;
  private recentErrors: { timestamp: number; code: string; message: string; context?: string }[] = [];

  // CPU 占用采样
  private lastCpuUsage = process.cpuUsage();
  private lastCpuSampleTime = Date.now();
  private currentCpuPercent = 0;

  // Event Loop Lag 采样
  private eventLoopLagMs = 0;
  private lastLoopTime = Date.now();

  private constructor() {
    // 启动低频 Event Loop Lag 与 CPU 采样定时器 (每 500ms 一次，消耗 < 0.1% CPU)
    setInterval(() => {
      const now = Date.now();
      const delta = now - this.lastLoopTime - 500;
      this.eventLoopLagMs = Math.max(0, delta);
      this.lastLoopTime = now;

      // 采样 CPU
      const cpuUsage = process.cpuUsage(this.lastCpuUsage);
      const elapsedMs = now - this.lastCpuSampleTime;
      if (elapsedMs > 0) {
        const totalCpuMs = (cpuUsage.user + cpuUsage.system) / 1000;
        this.currentCpuPercent = Math.min(100, Math.round((totalCpuMs / elapsedMs) * 100));
      }
      this.lastCpuUsage = process.cpuUsage();
      this.lastCpuSampleTime = now;

      // 清理超过 10 秒前的消息计数
      const cutoff = now - 10000;
      while (this.recentMessagesTimestamps.length > 0 && this.recentMessagesTimestamps[0]! < cutoff) {
        this.recentMessagesTimestamps.shift();
      }
    }, 500);
  }

  public static getInstance(): MetricsService {
    if (!MetricsService.instance) {
      MetricsService.instance = new MetricsService();
    }
    return MetricsService.instance;
  }

  public recordActionLatency(ms: number): void {
    if (this.actionLatencies.length > 2000) {
      this.actionLatencies.shift();
    }
    this.actionLatencies.push(ms);
  }

  public recordEngineResolution(ms: number): void {
    if (this.engineResolutionTimes.length > 2000) {
      this.engineResolutionTimes.shift();
    }
    this.engineResolutionTimes.push(ms);
  }

  public recordWebSocketMessage(sizeBytes: number): void {
    this.totalMessages++;
    this.recentMessagesTimestamps.push(Date.now());
    if (this.messageSizes.length > 1000) {
      this.messageSizes.shift();
    }
    this.messageSizes.push(sizeBytes);
  }

  public recordReconnect(): void {
    this.reconnectCount++;
  }

  public recordError(code: string, message: string, context?: string): void {
    this.errorCount++;
    this.recentErrors.unshift({
      timestamp: Date.now(),
      code,
      message,
      context,
    });
    if (this.recentErrors.length > 20) {
      this.recentErrors.pop();
    }
  }

  private calculatePercentile(values: number[], p: number): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
    return Math.round((sorted[idx] ?? 0) * 100) / 100;
  }

  private calculateAverage(values: number[]): number {
    if (values.length === 0) return 0;
    const sum = values.reduce((acc, v) => acc + v, 0);
    return Math.round((sum / values.length) * 100) / 100;
  }

  public getSummary(context: {
    activeRooms: number;
    activeGames: number;
    connectedPlayers: number;
  }): SystemMetricsSummary {
    const mem = process.memoryUsage();
    const msgPerSec = Math.round((this.recentMessagesTimestamps.length / 10) * 10) / 10;

    return {
      timestamp: Date.now(),
      uptimeSeconds: Math.floor(process.uptime()),
      activeRooms: context.activeRooms,
      activeGames: context.activeGames,
      connectedPlayers: context.connectedPlayers,
      messagesPerSec: msgPerSec,
      reconnectRate: this.reconnectCount,
      errorRate: this.errorCount,

      avgActionLatencyMs: this.calculateAverage(this.actionLatencies),
      p95ActionLatencyMs: this.calculatePercentile(this.actionLatencies, 95),
      p99ActionLatencyMs: this.calculatePercentile(this.actionLatencies, 99),

      avgEngineResolutionMs: this.calculateAverage(this.engineResolutionTimes),
      p95EngineResolutionMs: this.calculatePercentile(this.engineResolutionTimes, 95),
      p99EngineResolutionMs: this.calculatePercentile(this.engineResolutionTimes, 99),

      cpuPercent: this.currentCpuPercent,
      memoryRssMb: Math.round(mem.rss / (1024 * 1024)),
      memoryHeapUsedMb: Math.round(mem.heapUsed / (1024 * 1024)),
      memoryHeapTotalMb: Math.round(mem.heapTotal / (1024 * 1024)),
      eventLoopLagMs: this.eventLoopLagMs,

      avgWebSocketMessageSizeBytes: Math.round(this.calculateAverage(this.messageSizes)),
      totalMessagesSent: this.totalMessages,

      recentErrors: this.recentErrors,
    };
  }
}

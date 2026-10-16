/**
 * 确定性随机数生成器 (PCG/Mulberry32 PRNG)
 * 满足【13. 随机系统】与【23. Replay】对于可预测、可复现随机性的严苛要求
 */

export class SeedRng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /**
   * 生成 [0, 1) 浮点数
   */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /**
   * 生成 [min, max] 之间的整数
   */
  nextInt(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  /**
   * 确定性洗牌 (Fisher-Yates)
   */
  shuffle<T>(array: T[]): T[] {
    const copy = [...array];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = this.nextInt(0, i);
      const temp = copy[i]!;
      copy[i] = copy[j]!;
      copy[j] = temp;
    }
    return copy;
  }

  getSeed(): number {
    return this.state;
  }

  /**
   * 恢复到 getSeed() 返回的内部状态 (行动失败回滚时使用)
   */
  setState(state: number): void {
    this.state = state >>> 0;
  }
}

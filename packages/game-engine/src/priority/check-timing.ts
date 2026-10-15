import { GameState } from '@zhanshuang/shared';
import { SbaEngine } from '../sba/sba-engine.js';

export class CheckTimingManager {
  constructor(
    private state: GameState,
    private sbaEngine: SbaEngine
  ) {}

  /**
   * 8.5.1 检查时机处理主循环 (Priority Loop)
   * 按照 8.5.1.a ~ 8.5.1.e 严格推进
   */
  resolveCheckTiming(): void {
    if ((this.state.status as string) === 'FINISHED') return;

    let loopLimit = 100; // 防止恶意死循环保护

    while (loopLimit > 0) {
      loopLimit--;

      // 8.5.1.a & 8.5.1.b 执行所有待处理的规则处理 SBA
      let sbaExecuted = false;
      do {
        sbaExecuted = this.sbaEngine.runCheckTimingSba();
        if ((this.state.status as string) === 'FINISHED') return;
      } while (sbaExecuted);

      // 8.5.1.c 回合玩家存在触发条件生效的自动能力
      const activePlayerTriggers = this.state.pendingTriggers.filter(
        (t) => t.controllerPlayerId === this.state.activePlayerId
      );

      if (activePlayerTriggers.length > 0) {
        // 取出1个自动能力发动并执行 (8.5.1.c)
        const trigger = activePlayerTriggers[0]!;
        const index = this.state.pendingTriggers.indexOf(trigger);
        this.state.pendingTriggers.splice(index, 1);

        // 结算该自动能力
        this.executeTriggerAbility(trigger);

        // 8.5.1.c 执行完毕后返回 8.5.1.a 重新检查规则处理
        continue;
      }

      // 8.5.1.d 回合外玩家存在触发条件生效的自动能力
      const nonActivePlayerTriggers = this.state.pendingTriggers.filter(
        (t) => t.controllerPlayerId === this.state.nonActivePlayerId
      );

      if (nonActivePlayerTriggers.length > 0) {
        const trigger = nonActivePlayerTriggers[0]!;
        const index = this.state.pendingTriggers.indexOf(trigger);
        this.state.pendingTriggers.splice(index, 1);

        this.executeTriggerAbility(trigger);

        // 8.5.1.d 执行完毕后返回 8.5.1.a 重新检查规则处理
        continue;
      }

      // 8.5.1.e 双方均无待机能力且规则处理清零，检查时机结束
      break;
    }
  }

  private executeTriggerAbility(_trigger: unknown): void {
    // 自动能力结算钩子 (可在后续卡牌扩展中注入具体 Effect 结算)
  }
}

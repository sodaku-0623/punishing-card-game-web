import { GameState, PendingChoice, PendingTrigger } from '@zhanshuang/shared';
import { SbaEngine } from '../sba/sba-engine.js';
import { TriggerManager } from './trigger-system.js';
import { enqueuePendingChoice } from '../state/pending-choice.js';

export class CheckTimingManager {
  private triggerMgr?: TriggerManager;

  constructor(
    private state: GameState,
    private sbaEngine: SbaEngine
  ) {}

  setTriggerManager(triggerMgr: TriggerManager): void {
    this.triggerMgr = triggerMgr;
  }

  /**
   * 8.5.1 检查时机处理主循环 (Priority Loop)
   * 按照 8.5.1.a ~ 8.5.1.e 严格推进：
   * - a/b: 反复执行双方所有规则处理 (SBA) 直至清零
   * - c: 回合玩家存在待机自动能力时选择 1 项发动 (1 项直接执行，多项由玩家自选顺序)，然后返回 a
   * - d: 回合外玩家存在待机自动能力时选择 1 项发动 (1 项直接执行，多项由玩家自选顺序)，然后返回 a
   * - e: 双方无待机能力且规则处理清零，检查时机结束
   *
   * 返回 true 表示检查时机已全部完成；返回 false 表示因产生玩家决策 (触发顺序选择或效果选择) 而暂停，
   * 待玩家提交选择后引擎会在 continueFlow() 中再次进入本方法继续推进。
   */
  resolveCheckTiming(): boolean {
    if ((this.state.status as string) === 'FINISHED') return true;

    let loopLimit = 200; // 防止恶意死循环保护

    while (loopLimit > 0) {
      loopLimit--;

      // 8.5.1.a & 8.5.1.b 执行所有待处理的规则处理 SBA，直至不再产生新的规则处理
      const MAX_SBA_ITERATIONS = 100;
      let sbaIterations = 0;
      let sbaExecuted = false;
      do {
        sbaIterations += 1;
        if (sbaIterations > MAX_SBA_ITERATIONS) {
          throw new Error('规则处理 (SBA) 超过安全循环上限 (8.5.1.a)');
        }
        sbaExecuted = this.sbaEngine.runCheckTimingSba();
        if ((this.state.status as string) === 'FINISHED') return true;
        if (this.state.currentPendingChoice) return false;
      } while (sbaExecuted);

      // 若存在尚未完成的玩家决策，在执行任何待机自动能力前暂停检查时机
      if (this.state.currentPendingChoice) return false;

      // 8.5.1.c 回合玩家存在触发条件生效的待机自动能力
      const activePlayerTriggers = this.state.pendingTriggers.filter(
        (t) => t.controllerPlayerId === this.state.activePlayerId
      );

      if (activePlayerTriggers.length === 1) {
        const trigger = activePlayerTriggers[0]!;
        this.removePendingTrigger(trigger.id);
        this.executeTriggerAbility(trigger);
        if ((this.state.status as string) === 'FINISHED') return true;
        if (this.state.currentPendingChoice) return false;
        // 8.5.1.c 执行完毕后返回 8.5.1.a 重新检查规则处理
        continue;
      }
      if (activePlayerTriggers.length > 1) {
        // 8.7.3.a 回合玩家存在多项待机能力：挂起检查时机由玩家自选优先发动哪一项
        this.promptTriggerOrder(this.state.activePlayerId, activePlayerTriggers);
        return false;
      }

      // 8.5.1.d 回合外玩家存在触发条件生效的待机自动能力
      const nonActivePlayerTriggers = this.state.pendingTriggers.filter(
        (t) => t.controllerPlayerId === this.state.nonActivePlayerId
      );

      if (nonActivePlayerTriggers.length === 1) {
        const trigger = nonActivePlayerTriggers[0]!;
        this.removePendingTrigger(trigger.id);
        this.executeTriggerAbility(trigger);
        if ((this.state.status as string) === 'FINISHED') return true;
        if (this.state.currentPendingChoice) return false;
        // 8.5.1.d 执行完毕后返回 8.5.1.a 重新检查规则处理
        continue;
      }
      if (nonActivePlayerTriggers.length > 1) {
        this.promptTriggerOrder(this.state.nonActivePlayerId, nonActivePlayerTriggers);
        return false;
      }

      // 8.5.1.e 双方均无待机能力且规则处理清零，检查时机结束
      return true;
    }

    throw new Error('检查时机处理超过安全循环上限 (8.5.1)');
  }

  /**
   * 处理玩家对 CHOOSE_TRIGGER_ORDER 的选择：摘下选定待机触发并执行，随后由 continueFlow 回到 8.5.1.a
   */
  resolveTriggerOrderChoice(playerId: string, selectedTriggerId: string): { success: boolean; error?: string } {
    const idx = this.state.pendingTriggers.findIndex(
      (t) => t.id === selectedTriggerId && t.controllerPlayerId === playerId
    );
    if (idx === -1) {
      return { success: false, error: '所选待机自动能力已不存在或不属于当前玩家' };
    }
    const [trigger] = this.state.pendingTriggers.splice(idx, 1);
    if (trigger) {
      this.executeTriggerAbility(trigger);
    }
    return { success: true };
  }

  private removePendingTrigger(triggerId: string): void {
    const idx = this.state.pendingTriggers.findIndex((t) => t.id === triggerId);
    if (idx >= 0) {
      this.state.pendingTriggers.splice(idx, 1);
    }
  }

  private promptTriggerOrder(playerId: string, triggers: PendingTrigger[]): void {
    const choice: PendingChoice = {
      id: `choice-trigger-order-${this.state.turnNumber}-${triggers.map((t) => t.id).join('_')}`,
      playerId,
      choiceType: 'SELECT_OPTION',
      prompt: `共有 ${triggers.length} 项自动能力同时处于待机状态 (8.5.1 / 8.7.3)，请选择优先发动哪一项：`,
      options: triggers.map((t) => ({
        id: t.id,
        label: t.label ?? `${t.sourceCardNumber ?? t.sourceCardInstanceId} 自动能力`,
        payload: {
          sourceCardInstanceId: t.sourceCardInstanceId,
          cardNumber: t.sourceCardNumber,
          abilityId: t.abilityId,
          eligible: true,
        },
      })),
      effectType: 'CHOOSE_TRIGGER_ORDER',
      minSelections: 1,
      maxSelections: 1,
      metadata: {
        triggerIds: triggers.map((t) => t.id),
      },
    };
    enqueuePendingChoice(this.state, choice);
  }

  private executeTriggerAbility(trigger: PendingTrigger): void {
    this.triggerMgr?.executeTrigger(trigger);
  }
}

import { GameState, PendingChoice } from '@zhanshuang/shared';

/**
 * 分配可随快照持久化与恢复的确定性决策 ID（消除 Date.now / Math.random / 内存序列）
 */
export function nextChoiceId(state: GameState, tag: string = 'choice'): string {
  const seq = (state.choiceIdSeq ?? 0) + 1;
  state.choiceIdSeq = seq;
  return `choice-${tag}-${state.turnNumber}-${seq}`;
}

/**
 * 加入一个玩家决策：当前没有待处理的决策时立即成为当前决策，否则排队，
 * 避免后产生的决策覆盖尚未处理的决策、导致其效果丢失。
 */
export function enqueuePendingChoice(state: GameState, choice: PendingChoice): void {
  if (!state.currentPendingChoice) {
    state.currentPendingChoice = choice;
    return;
  }
  state.pendingChoiceQueue = [...(state.pendingChoiceQueue ?? []), choice];
}

/**
 * 当前决策处理完毕：取出排队中的下一个决策 (没有则清空)
 */
export function advancePendingChoice(state: GameState): void {
  const [next, ...rest] = state.pendingChoiceQueue ?? [];
  state.currentPendingChoice = next;
  state.pendingChoiceQueue = rest.length > 0 ? rest : undefined;
}

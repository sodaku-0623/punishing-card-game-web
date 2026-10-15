import { create } from 'zustand';
import { PublicGameState, GameEvent, PendingChoice } from '@zhanshuang/shared';

export interface GameStoreState {
  gameState: PublicGameState | null;
  myUserId: string;
  selectedHandCardId: string | null;
  selectedSlotIndex: number | null;
  selectedOrbIds: string[];
  pendingChoice: PendingChoice | null;
  combatLogs: string[];
  lastError: string | null;
  gameOverResult: { winnerId?: string; isDraw: boolean; reason: string } | null;

  setMyUserId: (id: string) => void;
  updateGameState: (state: PublicGameState) => void;
  appendEvents: (events: GameEvent[]) => void;
  setSelectedHandCard: (cardId: string | null) => void;
  setSelectedSlotIndex: (slotIndex: number | null) => void;
  toggleOrbSelection: (orbId: string) => void;
  clearOrbSelection: () => void;
  setPendingChoice: (choice: PendingChoice | null) => void;
  setLastError: (err: string | null) => void;
  setGameOverResult: (res: { winnerId?: string; isDraw: boolean; reason: string } | null) => void;
  reset: () => void;
}

export const useGameStore = create<GameStoreState>((set) => ({
  gameState: null,
  myUserId: '',
  selectedHandCardId: null,
  selectedSlotIndex: null,
  selectedOrbIds: [],
  pendingChoice: null,
  combatLogs: [],
  lastError: null,
  gameOverResult: null,

  setMyUserId: (id) => set({ myUserId: id }),

  updateGameState: (state) => set({ gameState: state, lastError: null }),

  appendEvents: (events) => {
    const newLogs: string[] = [];
    for (const evt of events) {
      switch (evt.type) {
        case 'CARD_PLAYED':
          newLogs.push(`[出牌] 玩家出场了卡牌，占据卡位 ${evt.slotIndex}`);
          break;
        case 'CARD_ASCENDED':
          newLogs.push(`[升变] 角色执行了升变出场，重叠垫层: ${evt.underneathCardIds.length} 张`);
          break;
        case 'ATTACK_DECLARED':
          newLogs.push(`[攻击] 角色宣告对 ${evt.targetType === 'PLAYER' ? '对方玩家' : '对方角色'} 发动进攻`);
          break;
        case 'BLOCK_DECLARED':
          newLogs.push(evt.isBlocked ? `[阻挡] 守方宣告阻挡！` : `[阻挡] 守方放弃阻挡`);
          break;
        case 'BATTLE_COMPARED':
          newLogs.push(
            `[战斗] PP对决: 攻方 ${evt.attackerPP} vs 守方 ${evt.defenderPP}${
              evt.destroyedDefenderCardId ? ' -> 守方角色被战斗破坏！' : ' -> 双方角色均未被破坏 (7.6.1.b)'
            }`
          );
          break;
        case 'EROSION_INCREASED':
          newLogs.push(`[侵蚀] 玩家 ${evt.playerId} 侵蚀计数上升为 ${evt.newValue}/7 (${evt.reason})`);
          break;
        case 'ORBS_ELIMINATED':
          newLogs.push(`[信号球] 消除 3 张相邻信号球，抽 ${evt.cardDrawnCount} 张牌！`);
          break;
        case 'DECK_REFRESHED':
          newLogs.push(`[牌组更新] 牌组耗尽，墓地洗回牌组并侵蚀+1 (9.2)`);
          break;
      }
    }

    set((prev) => ({
      combatLogs: [...prev.combatLogs, ...newLogs].slice(-50), // 保留最近50条日志
    }));
  },

  setSelectedHandCard: (cardId) =>
    set((prev) => ({
      selectedHandCardId: prev.selectedHandCardId === cardId ? null : cardId,
      selectedSlotIndex: null,
    })),

  setSelectedSlotIndex: (slotIndex) => set({ selectedSlotIndex: slotIndex }),

  toggleOrbSelection: (orbId) =>
    set((prev) => {
      if (prev.selectedOrbIds.includes(orbId)) {
        return { selectedOrbIds: prev.selectedOrbIds.filter((id) => id !== orbId) };
      }
      if (prev.selectedOrbIds.length >= 3) {
        return { selectedOrbIds: [orbId] }; // 重新选起
      }
      return { selectedOrbIds: [...prev.selectedOrbIds, orbId] };
    }),

  clearOrbSelection: () => set({ selectedOrbIds: [] }),

  setPendingChoice: (choice) => set({ pendingChoice: choice }),

  setLastError: (err) => set({ lastError: err }),

  setGameOverResult: (res) => set({ gameOverResult: res }),

  reset: () =>
    set({
      gameState: null,
      selectedHandCardId: null,
      selectedSlotIndex: null,
      selectedOrbIds: [],
      pendingChoice: null,
      combatLogs: [],
      lastError: null,
      gameOverResult: null,
    }),
}));

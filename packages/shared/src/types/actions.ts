/**
 * 《战双帕弥什 卡牌对战》客户端行为模型 (Client -> Server Actions)
 */

export type GameAction =
  | { type: 'SURRENDER'; playerId: string } // 1.2.4 弃权
  | { type: 'RESOLVE_MULLIGAN'; playerId: string; cardInstanceIdsToBottom: string[] } // 5.2.1.e 调度
  | { type: 'CHARGE_COST_FROM_HAND'; playerId: string; cardInstanceId?: string } // 6.3.1.c 抽牌填充阶段充明费(0或1张)
  | { 
      type: 'PLAY_CARD'; 
      playerId: string; 
      cardInstanceId: string; 
      targetSlotIndex?: number; 
      targetAscensionCardId?: string; // 8.11 升变对象
      targetEquipRoleId?: string; // 4.18 装备对象
      isAscension?: boolean;
    } // 6.4.1.b.1 / 8.6 使用手牌卡牌
  | { type: 'EQUIP_ITEM'; playerId: string; equipmentCardId: string; targetRoleCardId: string } // 6.4.1.b.4 战场装备
  | { type: 'ELIMINATE_3_ORBS'; playerId: string; orbCardInstanceIds: [string, string, string] } // 6.4.1.b.5 消3球抽1
  | { type: 'ACTIVATE_ABILITY'; playerId: string; sourceCardId: string; abilityIndex: number } // 6.4.1.b.3 发动起动能力
  | { 
      type: 'DECLARE_ATTACK'; 
      playerId: string; 
      attackerCardId: string; 
      targetType: 'PLAYER' | 'CHARACTER'; 
      targetCardId?: string; 
    } // 7.2 攻击宣言
  | { type: 'DECLARE_BLOCK'; playerId: string; blockerCardId?: string } // 7.3.1.c 阻挡宣言(空则不阻挡)
  | { type: 'USE_INSTANT'; playerId: string; cardInstanceId?: string; abilityIndex?: number; pass?: boolean } // 7.3.1.b / 6.5.1.a 瞬时使用或Pass
  | { type: 'DISCARD_HAND_OVERFLOW'; playerId: string; cardInstanceIds: string[] } // 6.5.1.c 结束阶段超上限弃牌
  | { type: 'SELECT_CHOICE_OPTION'; playerId: string; pendingChoiceId: string; selectedIds: string[] } // 8.6.3 玩家决策提交
  | { type: 'PASS_ACTION_TIMING'; playerId: string }; // 4.5.3.b 放弃行动时机

export interface SignedAction {
  id: string;
  gameId: string;
  playerId: string;
  action: GameAction;
  timestamp: number;
  seq: number;
}

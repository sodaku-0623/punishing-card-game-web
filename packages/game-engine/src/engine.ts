import {
  GameState,
  GameAction,
  GameEvent,
  PublicGameState,
  CardType,
  ElementAttribute,
  CardInstance,
  CostModifier,
  PendingChoice,
} from '@zhanshuang/shared';
import { SeedRng } from './rng/seed-rng.js';
import { ICardDatabase, BASE_TEST_CARDS, MemoryCardDatabase } from './database/card-registry.js';
import { createInitialGameState, PlayerInitConfig } from './state/create-game.js';
import { sanitizeGameStateForPlayer } from './state/sanitize-state.js';
import { ZoneManager } from './zone/zone-manager.js';
import { BattlefieldManager } from './zone/battlefield-manager.js';
import { SbaEngine } from './sba/sba-engine.js';
import { CheckTimingManager } from './priority/check-timing.js';
import { CombatManager } from './combat/combat-manager.js';
import { PhaseMachine } from './phases/phase-machine.js';
import { CardEffectEngine } from './effects/card-effects.js';

export interface ActionResult {
  success: boolean;
  error?: string;
  events: GameEvent[];
  state: GameState;
}

export interface GameEngineOptions {
  skipMulligan?: boolean;
}

export interface GameEngineSnapshot {
  state: GameState;
  rngState: number;
  events?: GameEvent[];
}

export class GameEngine {
  state!: GameState;
  rng!: SeedRng;
  cardDb!: ICardDatabase;
  events: GameEvent[] = [];

  zoneMgr!: ZoneManager;
  fieldMgr!: BattlefieldManager;
  sbaEngine!: SbaEngine;
  checkTimingMgr!: CheckTimingManager;
  combatMgr!: CombatManager;
  phaseMachine!: PhaseMachine;
  effectEngine!: CardEffectEngine;

  constructor(
    gameId: string,
    player1: PlayerInitConfig,
    player2: PlayerInitConfig,
    seed: number = Date.now(),
    cardDb?: ICardDatabase,
    options?: GameEngineOptions
  ) {
    this.cardDb = cardDb ?? new MemoryCardDatabase(BASE_TEST_CARDS);

    const skipMulligan = options?.skipMulligan ?? true;
    const init = createInitialGameState(gameId, player1, player2, seed, this.cardDb, { skipMulligan });
    this.rng = new SeedRng(init.rngState);
    this.state = init.state;
    this.events.push(...init.events);

    this.initManagers();

    if (skipMulligan) {
      // 5.2.1.g 跳过调度直接开局，执行第一回合竖直阶段与抽牌填充阶段
      this.phaseMachine.startStandPhase();
    }
  }

  private initManagers(): void {
    this.zoneMgr = new ZoneManager(this.state, this.rng, this.cardDb, this.events);
    this.fieldMgr = new BattlefieldManager(this.state, this.zoneMgr, this.cardDb, this.events);
    this.sbaEngine = new SbaEngine(this.state, this.zoneMgr, this.fieldMgr, this.events);
    this.checkTimingMgr = new CheckTimingManager(this.state, this.sbaEngine);
    this.combatMgr = new CombatManager(
      this.state,
      this.zoneMgr,
      this.fieldMgr,
      this.cardDb,
      this.checkTimingMgr,
      this.events
    );
    this.phaseMachine = new PhaseMachine(
      this.state,
      this.zoneMgr,
      this.checkTimingMgr,
      this.events
    );
    this.effectEngine = new CardEffectEngine({
      state: this.state,
      zoneMgr: this.zoneMgr,
      fieldMgr: this.fieldMgr,
      cardDb: this.cardDb,
      events: this.events,
      payCost: (p, c) => this.payCost(p, c),
      setPendingChoice: (ch) => {
        this.state.currentPendingChoice = ch;
      },
    });

    this.zoneMgr.setChargeAutoHandler((playerId, cardInstanceId, cardDef) => {
      this.effectEngine.handleChargeAutoEffect(playerId, cardInstanceId, cardDef);
    });
  }

  /**
   * 导出当前引擎的完整快照，包含游戏状态与伪随机数生成器的内部状态 (满足 Durable Object 状态恢复要求)
   */
  toSnapshot(): GameEngineSnapshot {
    return {
      state: JSON.parse(JSON.stringify(this.state)),
      rngState: this.rng.getSeed(),
      events: [...this.events],
    };
  }

  /**
   * 从快照完整恢复对局引擎 (O(1) 恢复进行中的对战会话)
   */
  static fromSnapshot(snapshot: GameEngineSnapshot, cardDb?: ICardDatabase): GameEngine {
    const engine = Object.create(GameEngine.prototype) as GameEngine;
    engine.state = JSON.parse(JSON.stringify(snapshot.state));
    engine.rng = new SeedRng(snapshot.rngState);
    engine.cardDb = cardDb ?? new MemoryCardDatabase(BASE_TEST_CARDS);
    engine.events = snapshot.events ? [...snapshot.events] : [];
    engine.initManagers();
    return engine;
  }

  getState(): GameState {
    return this.state;
  }

  getPublicState(playerId: string): PublicGameState {
    return sanitizeGameStateForPlayer(this.state, playerId);
  }

  getEvents(): GameEvent[] {
    return this.events;
  }

  /**
   * 权威 Action 调度器 (Validate -> Apply -> Check SBA -> Emit Events)
   * 行动以事务方式执行：失败或抛出异常时，游戏状态、随机数与事件全部回滚到执行前，
   * 避免出现「费用已支付但出牌失败」之类的半完成状态。
   */
  dispatchAction(action: GameAction): ActionResult {
    const startEventIndex = this.events.length;
    const stateBackup = JSON.stringify(this.state);
    const rngBackup = this.rng.getSeed();

    let result: ActionResult;
    try {
      result = this.applyActionUnsafe(action, startEventIndex);
    } catch (err) {
      result = {
        success: false,
        error: `行动处理失败：${err instanceof Error ? err.message : String(err)}`,
        events: [],
        state: this.state,
      };
    }

    if (!result.success) {
      this.restoreState(stateBackup);
      this.rng.setState(rngBackup);
      this.events.length = startEventIndex;
      return { success: false, error: result.error, events: [], state: this.state };
    }
    return result;
  }

  /**
   * 原地恢复状态对象：各管理器持有的是同一个 state 引用，不能直接替换引用
   */
  private restoreState(serialized: string): void {
    const restored = JSON.parse(serialized) as GameState;
    const target = this.state as unknown as Record<string, unknown>;
    for (const key of Object.keys(target)) {
      delete target[key];
    }
    Object.assign(target, restored);
  }

  private applyActionUnsafe(action: GameAction, startEventIndex: number): ActionResult {

    if (this.state.status === 'FINISHED') {
      return {
        success: false,
        error: '游戏已经结束',
        events: [],
        state: this.state,
      };
    }

    // 仅本局玩家可提交行动 (防止旁观者或伪造身份发起投降等操作)
    if (!action?.playerId || !this.state.players[action.playerId]) {
      return {
        success: false,
        error: '非本局玩家，无法执行该行动',
        events: [],
        state: this.state,
      };
    }

    // 存在待处理的玩家决策时，只能提交该决策或弃权；否则旧决策会被新行动覆盖、对应效果丢失
    if (
      this.state.currentPendingChoice &&
      action.type !== 'SELECT_CHOICE_OPTION' &&
      action.type !== 'SURRENDER'
    ) {
      const waitingForSelf = this.state.currentPendingChoice.playerId === action.playerId;
      return {
        success: false,
        error: waitingForSelf ? '请先完成当前的效果选择' : '请等待对方完成效果选择',
        events: [],
        state: this.state,
      };
    }

    let success = false;
    let error: string | undefined;

    switch (action.type) {
      case 'SURRENDER': {
        // 1.2.4 弃权立即判负
        const winnerId =
          this.state.activePlayerId === action.playerId
            ? this.state.nonActivePlayerId
            : this.state.activePlayerId;
        this.state.status = 'FINISHED';
        this.state.winnerId = winnerId;
        this.state.finishReason = `玩家 ${action.playerId} 宣布弃权 (1.2.4)`;
        this.events.push({
          type: 'GAME_OVER',
          winnerPlayerId: winnerId,
          isDraw: false,
          reason: this.state.finishReason,
        });
        success = true;
        break;
      }

      case 'RESOLVE_MULLIGAN': {
        const res = this.handleResolveMulligan(action);
        success = res.success;
        error = res.error;
        break;
      }

      case 'CHARGE_COST_FROM_HAND': {
        success = this.phaseMachine.chargeCostFromHand(action.playerId, action.cardInstanceId);
        if (!success) {
          error = '非法明费充能操作';
        }
        break;
      }

      case 'PLAY_CARD': {
        const res = this.handlePlayCard(action);
        success = res.success;
        error = res.error;
        break;
      }

      case 'EQUIP_ITEM': {
        const res = this.handleEquipItem(action);
        success = res.success;
        error = res.error;
        break;
      }

      case 'ELIMINATE_3_ORBS': {
        const turnError = this.checkMainPhaseAction(action.playerId);
        if (turnError) {
          error = turnError;
          break;
        }
        const res = this.zoneMgr.eliminateThreeOrbs(action.playerId, action.orbCardInstanceIds);
        success = res.success;
        error = res.error;
        break;
      }

      case 'DECLARE_ATTACK': {
        const res = this.combatMgr.declareAttack(
          action.playerId,
          action.attackerCardId,
          action.targetType,
          action.targetCardId
        );
        success = res.success;
        error = res.error;
        break;
      }

      case 'DECLARE_BLOCK': {
        const res = this.combatMgr.declareBlock(action.playerId, action.blockerCardId);
        success = res.success;
        error = res.error;
        break;
      }

      case 'ACTIVATE_ABILITY': {
        const res = this.handleActivateAbility(action);
        success = res.success;
        error = res.error;
        break;
      }

      case 'SELECT_CHOICE_OPTION': {
        const res = this.handleSelectChoice(action);
        success = res.success;
        error = res.error;
        break;
      }

      case 'PASS_ACTION_TIMING': {
        if (this.state.phase === 'MULLIGAN_PHASE') {
          // 5.2.1.e 在调度阶段 Pass 等同于保留全部手牌
          const res = this.handleResolveMulligan({
            type: 'RESOLVE_MULLIGAN',
            playerId: action.playerId,
            cardInstanceIdsToBottom: [],
          });
          success = res.success;
          error = res.error;
        } else if (this.state.phase === 'MAIN_PHASE') {
          // 6.4.1.c 回合玩家选择不再执行行动，进入结束阶段
          this.phaseMachine.startEndPhase();
          success = true;
        } else if (this.state.phase === 'COMBAT_FREE_TIMING') {
          // 7.3.1 自由时点必须由被攻击玩家选择是否阻挡，回合方玩家不得单方面跳过结算
          if (action.playerId !== this.state.nonActivePlayerId) {
            error = '当前处于战斗阻挡确认时点，必须等待被攻击玩家选择是否阻挡';
            success = false;
          } else {
            // 被攻击玩家选择不进行阻挡，正常推进后续战斗充能与伤害/战斗结算 (7.3.1.d)
            const res = this.combatMgr.declareBlock(this.state.nonActivePlayerId, undefined);
            success = res.success;
            error = res.error;
          }
        } else if (this.state.phase === 'DRAW_CHARGE_PHASE') {
          // 放弃放置明费，进入主要阶段
          this.phaseMachine.chargeCostFromHand(this.state.activePlayerId, undefined);
          success = true;
        }
        break;
      }

      default:
        error = `未支持的行动类型: ${(action as { type: string }).type}`;
        success = false;
    }

    // 执行规则处理确认
    this.checkTimingMgr.resolveCheckTiming();

    const newEvents = this.events.slice(startEventIndex);
    return {
      success,
      error,
      events: newEvents,
      state: this.state,
    };
  }

  applyAction(action: GameAction): ActionResult {
    return this.dispatchAction(action);
  }

  /**
   * 通用扣除费用逻辑
   */
  payCost(playerId: string, costToPay: number): boolean {
    const player = this.state.players[playerId];
    if (!player) return false;
    if (costToPay <= 0) return true;
    const available = player.availableOpenCostCount + player.hiddenCostCount;
    if (available < costToPay) return false;

    let costRemaining = costToPay;
    const tappedOpenIds: string[] = [];
    const discardedHiddenIds: string[] = [];

    const costZoneCards = this.zoneMgr.getCardsInZone(playerId, 'COST');
    for (const c of costZoneCards) {
      if (costRemaining <= 0) break;
      if (c.isFaceUp && c.isReady) {
        c.isReady = false;
        player.availableOpenCostCount--;
        player.exhaustedOpenCostCount++;
        tappedOpenIds.push(c.instanceId);
        costRemaining--;
      }
    }

    for (const c of costZoneCards) {
      if (costRemaining <= 0) break;
      if (!c.isFaceUp) {
        this.zoneMgr.moveCard(c.instanceId, 'GRAVEYARD', { isFaceUp: true });
        player.hiddenCostCount--;
        player.totalCostCount--;
        discardedHiddenIds.push(c.instanceId);
        costRemaining--;
      }
    }

    this.events.push({
      type: 'COST_PAID',
      playerId,
      openCostTappedIds: tappedOpenIds,
      hiddenCostDiscardedIds: discardedHiddenIds,
    });

    return true;
  }


  /**
   * 8.6.2.c 计算卡牌使用的实际费用 (包含动态修改器与卡牌固有静态减费能力)
   */
  public calculateCardCost(
    playerId: string,
    cardInstanceId: string,
    isAscension?: boolean
  ): { costToPay: number; appliedModifiers: CostModifier[] } {
    const card = this.state.cards[cardInstanceId];
    if (!card) return { costToPay: 0, appliedModifiers: [] };
    const cardDef = this.cardDb.getCard(card.cardNumber) || (card.cardId ? this.cardDb.getCard(card.cardId) : undefined);
    if (!cardDef) return { costToPay: 0, appliedModifiers: [] };

    const player = this.state.players[playerId];
    const isAscensionPlay = !!(isAscension && cardDef.ascensionConfig);
    const baseCost = isAscensionPlay
      ? cardDef.ascensionConfig!.ascensionCost
      : cardDef.cost;

    let discount = 0;
    const appliedModifiers: CostModifier[] = [];

    // 1. 玩家当前挂载的动态费用修改器 (如卡牌【起】动能力减费)
    if (player?.costModifiers && player.costModifiers.length > 0) {
      for (const mod of player.costModifiers) {
        if (mod.excludeAscension && isAscensionPlay) continue;
        if (mod.cardType && mod.cardType !== cardDef.cardType) continue;
        if (mod.targetTrait) {
          const matchTrait = cardDef.traits?.some((t) => t.includes(mod.targetTrait!));
          const matchName = cardDef.name.includes(mod.targetTrait);
          if (!matchTrait && !matchName) continue;
        }
        if (mod.targetName && !cardDef.name.includes(mod.targetName)) continue;

        discount += mod.amount;
        appliedModifiers.push(mod);
      }
    }

    // 2. 卡牌自身静态能力减费 (8.6.2.c)
    // 2.1 ST03-011 (三头犬出击): 【永】：我方战场每有1张<三头犬小队>角色，手牌的该牌的费用-1。
    if (
      cardDef.cardNumber === 'ST03-011' ||
      cardDef.rulesText.includes('我方战场每有1张<三头犬小队>角色，手牌的该牌的费用-1')
    ) {
      const myBattlefieldSlots = this.state.battlefields[playerId] || [];
      const cerberusRoleCount = myBattlefieldSlots.filter((s) => {
        if (!s.roleCardId) return false;
        const roleCard = this.state.cards[s.roleCardId];
        if (!roleCard) return false;
        const rDef = this.cardDb.getCard(roleCard.cardNumber) || (roleCard.cardId ? this.cardDb.getCard(roleCard.cardId) : undefined);
        if (!rDef || rDef.cardType !== CardType.ROLE) return false;
        return (
          rDef.traits?.some((t) => t.includes('三头犬小队')) ||
          rDef.name.includes('三头犬小队')
        );
      }).length;
      discount += cerberusRoleCount;
    }

    // 2.2 BP01-016: 我方战场存在《露西亚》角色或《阿尔法》角色时，手牌和墓地的该牌的费用-3
    if (
      cardDef.cardNumber === 'BP01-016' ||
      cardDef.rulesText.includes('我方战场存在《露西亚》角色或《阿尔法》角色时，手牌和墓地的该牌的费用-3')
    ) {
      const myBattlefieldSlots = this.state.battlefields[playerId] || [];
      const hasLuciaOrAlpha = myBattlefieldSlots.some((s) => {
        if (!s.roleCardId) return false;
        const roleCard = this.state.cards[s.roleCardId];
        if (!roleCard) return false;
        const rDef = this.cardDb.getCard(roleCard.cardNumber) || (roleCard.cardId ? this.cardDb.getCard(roleCard.cardId) : undefined);
        return rDef && (rDef.name.includes('露西亚') || rDef.name.includes('阿尔法') || rDef.traits?.some((t) => t.includes('露西亚') || t.includes('阿尔法')));
      });
      if (hasLuciaOrAlpha) {
        discount += 3;
      }
    }

    const costToPay = Math.max(0, baseCost - discount);
    return { costToPay, appliedModifiers };
  }

  /**
   * 8.6.2 打出卡牌 (PLAY_CARD)
   */
  private handlePlayCard(action: Extract<GameAction, { type: 'PLAY_CARD' }>): {
    success: boolean;
    error?: string;
  } {
    if (this.state.phase !== 'MAIN_PHASE') {
      return { success: false, error: '只能在主要阶段使用手牌 (8.6.2)' };
    }
    if (this.state.activePlayerId !== action.playerId) {
      return { success: false, error: '只能在自己回合的主要阶段使用手牌' };
    }

    const card = this.state.cards[action.cardInstanceId];
    if (!card || card.controllerPlayerId !== action.playerId || card.zone !== 'HAND') {
      return { success: false, error: '手牌中不存在该卡牌' };
    }

    const cardDef = this.cardDb.getCard(card.cardNumber) || (card.cardId ? this.cardDb.getCard(card.cardId) : undefined);
    if (!cardDef) {
      return { success: false, error: `未找到卡牌规则定义 (卡号: ${card.cardNumber || card.cardId})` };
    }

    const player = this.state.players[action.playerId]!;

    // 8.6.2.a.1 卡牌属性条件：属性需与自身费用区中任意一张明费属性相同
    // 信号球牌无属性，可无视卡牌属性条件 (4.16.1.a)
    if (cardDef.attribute !== ElementAttribute.NONE) {
      const openCostCards = this.zoneMgr.getCardsInZone(action.playerId, 'COST').filter((c) => c.isFaceUp);
      const hasMatchingAttribute = openCostCards.some((c) => {
        const def = this.cardDb.getCard(c.cardNumber) || (c.cardId ? this.cardDb.getCard(c.cardId) : undefined);
        return def?.attribute === cardDef.attribute;
      });

      if (!hasMatchingAttribute) {
        return { success: false, error: `费用区没有与【${cardDef.attribute}】属性匹配的明费 (8.6.2.a.1)` };
      }
    }

    // 智能识别升变目标 (若指定的目标卡位已有角色且卡牌具备升变能力，或己方仅有单一合法升变角色)
    if (cardDef.ascensionConfig) {
      if (!action.isAscension && action.targetSlotIndex !== undefined) {
        const targetSlot = this.fieldMgr.getSlots(action.playerId)[action.targetSlotIndex];
        if (targetSlot && targetSlot.roleCardId) {
          action.isAscension = true;
          action.targetAscensionCardId = targetSlot.roleCardId;
        }
      }
      if (action.isAscension && !action.targetAscensionCardId) {
        const friendlyRoles = this.fieldMgr
          .getSlots(action.playerId)
          .map((s) => (s.roleCardId ? this.state.cards[s.roleCardId] : null))
          .filter(Boolean) as CardInstance[];
        const matchingRoles = friendlyRoles.filter((r) => {
          const rDef = this.cardDb.getCard(r.cardNumber) || (r.cardId ? this.cardDb.getCard(r.cardId) : undefined);
          const tf = cardDef.ascensionConfig!.targetFilter;
          if (tf.nameIncludes && !rDef?.name.includes(tf.nameIncludes)) return false;
          if (tf.maxCost && (rDef?.cost ?? 0) > tf.maxCost) return false;
          return true;
        });
        if (matchingRoles.length === 1 && matchingRoles[0]) {
          action.targetAscensionCardId = matchingRoles[0].instanceId;
        }
      }
    }

    // 预检升变合法性 (8.11)
    if (action.isAscension && action.targetAscensionCardId) {
      const targetCard = this.state.cards[action.targetAscensionCardId];
      if (!targetCard || targetCard.controllerPlayerId !== action.playerId || targetCard.zone !== 'BATTLEFIELD') {
        return { success: false, error: '升变目标角色不存在或不在己方战场' };
      }
      const targetDef = this.cardDb.getCard(targetCard.cardNumber) || (targetCard.cardId ? this.cardDb.getCard(targetCard.cardId) : undefined);
      if (cardDef.ascensionConfig?.targetFilter) {
        const tf = cardDef.ascensionConfig.targetFilter;
        if (tf.nameIncludes && !targetDef?.name.includes(tf.nameIncludes)) {
          return { success: false, error: `升变目标必须包含【${tf.nameIncludes}】(当前目标: ${targetDef?.name})` };
        }
        if (tf.maxCost && (targetDef?.cost ?? 0) > tf.maxCost) {
          return { success: false, error: `升变目标费用不能超过 ${tf.maxCost} (当前目标: ${targetDef?.cost}费)` };
        }
      }
    }

    // 8.6.2.c 支付费用 (计算动态费用减免与固有静态减费)
    const { costToPay, appliedModifiers } = this.calculateCardCost(
      action.playerId,
      action.cardInstanceId,
      action.isAscension
    );

    if (!this.payCost(action.playerId, costToPay)) {
      const avail = player.availableOpenCostCount + player.hiddenCostCount;
      return { success: false, error: `费用不足，需要 ${costToPay} 费，当前可用 ${avail}` };
    }

    // 扣减已适用的修改器使用次数 (如“下1张”)
    if (appliedModifiers.length > 0 && player.costModifiers) {
      for (const mod of appliedModifiers) {
        if (mod.remainingCount !== undefined) {
          mod.remainingCount--;
        }
      }
      player.costModifiers = player.costModifiers.filter(
        (m) => m.remainingCount === undefined || m.remainingCount > 0
      );
    }

    // 8.6.2.e 结算卡牌进入区域并自动触发效果处理
    if (action.isAscension && action.targetAscensionCardId) {
      // 8.11 升变出场
      const ok = this.fieldMgr.playAscensionCard(
        action.playerId,
        action.cardInstanceId,
        action.targetAscensionCardId
      );
      if (!ok) return { success: false, error: '升变出场失败' };

      // 升变出场自动触发登场效果
      this.effectEngine.handleRoleEntryEffect(action.playerId, action.cardInstanceId, cardDef);
    } else if (cardDef.cardType === CardType.ROLE) {
      const slotIndex = action.targetSlotIndex ?? this.fieldMgr.findFirstEmptySlot(action.playerId);
      if (slotIndex === undefined) {
        return { success: false, error: '战场没有空余卡位 (8.6.2.b.1)' };
      }
      if (!this.fieldMgr.playRoleCard(action.playerId, action.cardInstanceId, slotIndex)) {
        return { success: false, error: '所选卡位已被占用 (8.6.2.b.1)' };
      }

      // 角色出场自动触发【出】/【自】登场效果
      this.effectEngine.handleRoleEntryEffect(action.playerId, action.cardInstanceId, cardDef);
    } else if (cardDef.cardType === CardType.EQUIPMENT) {
      const roleCards = this.fieldMgr
        .getSlots(action.playerId)
        .map((s) => (s.roleCardId ? this.state.cards[s.roleCardId] : null))
        .filter((c): c is CardInstance => !!c && !c.attachedEquipmentId);

      if (action.targetEquipRoleId) {
        // 8.6.2.e.2 放置到可以装备该牌的自身战场角色下方进行装备
        this.zoneMgr.moveCard(action.cardInstanceId, 'PROCESSING', { isFaceUp: true });
        if (!this.fieldMgr.equipToRole(action.playerId, action.cardInstanceId, action.targetEquipRoleId)) {
          return { success: false, error: '装备对象必须是自身战场上未装备装备牌的角色 (4.18.3)' };
        }
        this.effectEngine.handleEquipmentBuff(action.targetEquipRoleId, cardDef);
      } else if (action.targetSlotIndex !== undefined || roleCards.length === 0) {
        // 8.6.2.e.2 以正面竖直状态放置到自身战场空余卡位
        const slotIndex = action.targetSlotIndex ?? this.fieldMgr.findFirstEmptySlot(action.playerId);
        if (slotIndex === undefined) return { success: false, error: '战场没有空余卡位 (8.6.2.b.3)' };
        if (!this.fieldMgr.playStandaloneEquipment(action.playerId, action.cardInstanceId, slotIndex)) {
          return { success: false, error: '所选卡位已被占用 (8.6.2.b.3)' };
        }
      } else {
        // 未指定放置方式：移动到处理区，由玩家选择要装备的角色
        this.zoneMgr.moveCard(action.cardInstanceId, 'PROCESSING', { isFaceUp: true });
        this.state.currentPendingChoice = {
          id: `choice-equip-${action.cardInstanceId}-${this.events.length}`,
          playerId: action.playerId,
          choiceType: 'SELECT_CARDS',
          prompt: `装备卡【${cardDef.name}】已进入处理区，请选择要装备的角色：`,
          options: roleCards.map((c) => this.effectEngine.createRoleChoiceOption(c)),
          effectType: 'EQUIP_FROM_PROCESSING',
          sourceCardInstanceId: action.cardInstanceId,
          minSelections: 1,
          maxSelections: 1,
        };
      }
    } else if (cardDef.cardType === CardType.ASSIST) {
      // 8.6.2.b.2 需要存在空余卡位或已有辅助机 (替换其所占卡位)
      const slotIndex =
        action.targetSlotIndex ??
        this.fieldMgr.findFirstEmptySlot(action.playerId) ??
        this.fieldMgr.getSlots(action.playerId).find((s) => s.assistCardId)?.slotIndex;
      if (slotIndex === undefined) {
        return { success: false, error: '战场没有空余卡位，也没有可替换的辅助机 (8.6.2.b.2)' };
      }
      if (!this.fieldMgr.playAssistCard(action.playerId, action.cardInstanceId, slotIndex)) {
        return { success: false, error: '辅助机只能放置到空余卡位或替换原有辅助机 (8.6.2.e.3)' };
      }
      this.effectEngine.handleAssistBuff(action.playerId, cardDef);
    } else if (cardDef.cardType === CardType.TACTICS) {
      // 战术牌打出：自动执行其效果处理 (8.6.2.e.4)
      const res = this.effectEngine.handlePlayTactics(action.playerId, action.cardInstanceId, cardDef);
      if (!res.success) return res;
    }

    return { success: true };
  }

  /**
   * 6.4.1.b.3 发动起动能力 (ACTIVATE_ABILITY)
   */
  private handleActivateAbility(action: Extract<GameAction, { type: 'ACTIVATE_ABILITY' }>): {
    success: boolean;
    error?: string;
  } {
    // 8.1.1.c / 6.4.1.b.3 起动能力只能由回合玩家在自己的主要阶段发动
    const turnError = this.checkMainPhaseAction(action.playerId);
    if (turnError) {
      return { success: false, error: turnError };
    }

    const card = this.state.cards[action.sourceCardId];
    if (!card || card.controllerPlayerId !== action.playerId) {
      return { success: false, error: '未找到指定能力的来源卡牌' };
    }

    const cardDef = this.cardDb.getCard(card.cardNumber) || (card.cardId ? this.cardDb.getCard(card.cardId) : undefined);
    if (!cardDef) {
      return { success: false, error: `未找到卡牌规则定义 (${card.cardNumber})` };
    }

    // 2.5.2 卡牌文本若无特殊记述只在战场生效；起动能力只能由战场上的卡牌（角色、辅助机、单独占位的装备）发动，
    // 文本明确允许在其他区域发动的除外
    const isTopLevelOnField = this.fieldMgr.isTopLevelFieldCard(action.playerId, card.instanceId);
    const usableFromZone =
      (card.zone === 'HAND' && cardDef.rulesText.includes('丢弃手牌中的该牌')) ||
      (card.zone === 'GRAVEYARD' && cardDef.rulesText.includes('若该牌存在于墓地')) ||
      (card.zone === 'COST' && card.isFaceUp && cardDef.rulesText.includes('若该牌存在于费用区'));
    if (!isTopLevelOnField && !usableFromZone) {
      return { success: false, error: '该卡牌当前所在区域不能发动起动能力 (2.5.2)' };
    }

    const player = this.state.players[action.playerId]!;

    // 检查是否有【起】动能力
    if (!cardDef.rulesText.includes('【起】')) {
      return { success: false, error: `卡牌【${cardDef.name}】没有起动能力` };
    }

    // 检查【回合1】每回合发动次数限制 (10.1)
    if (cardDef.rulesText.includes('【回合1】') && (player.turnAbilityUsage[card.instanceId] || 0) > 0) {
      return { success: false, error: '该角色的【起】动能力本回合已发动过 (【回合1】限制)' };
    }

    // 解析【起】能力费用：如【起】[费用2] 或 【起】[费用1] 或 【起】横置该牌
    let cost = 0;
    const costMatch = cardDef.rulesText.match(/【起】.*?\[费用(\d+)\]|【起】.*?【(\d+)费】/);
    if (costMatch) {
      cost = parseInt(costMatch[1] || costMatch[2] || '0', 10);
    }

    if (cost > 0) {
      const ok = this.payCost(action.playerId, cost);
      if (!ok) {
        return { success: false, error: `费用不足，需要 ${cost} 费` };
      }
    }

    // 检查是否需要横置自身
    if (
      cardDef.rulesText.includes('【起】横置') ||
      cardDef.rulesText.includes('横置此卡') ||
      cardDef.rulesText.includes('横置该牌')
    ) {
      if (!card.isReady) {
        return { success: false, error: '该角色已横置，无法发动需要横置的能力' };
      }
      card.isReady = false;
    }

    // 记录每回合发动次数 (10.1)
    player.turnAbilityUsage[card.instanceId] = (player.turnAbilityUsage[card.instanceId] || 0) + 1;

    // 触发效果广播
    this.events.push({
      type: 'ABILITY_ACTIVATED',
      playerId: action.playerId,
      cardInstanceId: card.instanceId,
      abilityName: `${cardDef.name}【起】动能力`,
      rulesText: cardDef.rulesText,
    });

    // 效果解析与执行
    return this.effectEngine.handleActivateAbility(action.playerId, card.instanceId, cardDef);
  }

  /**
   * 8.6.3 玩家决策提交与结算 (SELECT_CHOICE_OPTION)
   */
  private handleSelectChoice(action: Extract<GameAction, { type: 'SELECT_CHOICE_OPTION' }>): {
    success: boolean;
    error?: string;
  } {
    const choice = this.state.currentPendingChoice;
    if (!choice || choice.id !== action.pendingChoiceId) {
      return { success: false, error: '当前没有待处理的决策，或决策ID已过期' };
    }
    if (choice.playerId !== action.playerId) {
      return { success: false, error: '非当前做决定的玩家' };
    }

    const validationError = validateChoiceSelection(choice, action.selectedIds);
    if (validationError) {
      return { success: false, error: validationError };
    }

    return this.effectEngine.handleChoiceResolution(action, choice);
  }

  /**
   * 回合玩家在主要阶段的行动时机才能执行的行动 (6.4.1.b) 的公共前置检查
   */
  private checkMainPhaseAction(playerId: string): string | undefined {
    if (this.state.activePlayerId !== playerId) {
      return '只能在自己回合的主要阶段执行该行动 (6.4.1.b)';
    }
    if (this.state.phase !== 'MAIN_PHASE' || this.state.currentCombat) {
      return '只能在主要阶段的行动时机执行该行动 (6.4.1.b)';
    }
    return undefined;
  }

  /**
   * 6.4.1.b.4 将自身战场未被装备的装备牌装备给自身战场的角色
   */
  private handleEquipItem(action: Extract<GameAction, { type: 'EQUIP_ITEM' }>): {
    success: boolean;
    error?: string;
  } {
    const turnError = this.checkMainPhaseAction(action.playerId);
    if (turnError) return { success: false, error: turnError };

    const equipCard = this.state.cards[action.equipmentCardId];
    const equipDef = equipCard
      ? this.cardDb.getCard(equipCard.cardNumber) || (equipCard.cardId ? this.cardDb.getCard(equipCard.cardId) : undefined)
      : undefined;
    if (
      !equipCard ||
      equipDef?.cardType !== CardType.EQUIPMENT ||
      !this.fieldMgr.isStandaloneEquipment(action.playerId, equipCard.instanceId)
    ) {
      return { success: false, error: '只能装备自身战场上未被装备的装备牌 (6.4.1.b.4)' };
    }
    if (!this.fieldMgr.isSlotRole(action.playerId, action.targetRoleCardId)) {
      return { success: false, error: '装备对象必须是自身战场上的角色 (4.18.1)' };
    }

    const ok = this.fieldMgr.equipToRole(action.playerId, action.equipmentCardId, action.targetRoleCardId);
    return ok ? { success: true } : { success: false, error: '装备失败：该角色已装备了装备牌 (4.18.3)' };
  }

  /**
   * 5.2.1.e 开局手牌调度处理
   */
  private handleResolveMulligan(action: {
    type: 'RESOLVE_MULLIGAN';
    playerId: string;
    cardInstanceIdsToBottom: string[];
  }): { success: boolean; error?: string } {
    if (this.state.phase !== 'MULLIGAN_PHASE') {
      return { success: false, error: '当前不在开局调度阶段 (5.2.1.e)' };
    }

    const player = this.state.players[action.playerId];
    if (!player) {
      return { success: false, error: '玩家不存在' };
    }

    if (player.hasMulliganed) {
      return { success: false, error: '每位玩家在对局开局仅有一次手牌调度机会 (5.2.1.e)' };
    }

    const toBottom = action.cardInstanceIdsToBottom ?? [];

    // 验证所有待放回的卡牌是否均在手牌中且属于该玩家
    for (const cardId of toBottom) {
      const card = this.state.cards[cardId];
      if (!card || card.controllerPlayerId !== action.playerId || card.zone !== 'HAND') {
        return { success: false, error: `卡牌 ${cardId} 不在手牌中，无法调度` };
      }
    }

    // 1. 将选中的卡牌放回牌组底 (5.2.1.e)
    for (const cardId of toBottom) {
      this.zoneMgr.moveCardToBottomOfDeck(cardId);
    }

    // 2. 从牌组顶抽取相同数量的卡牌
    const count = toBottom.length;
    if (count > 0) {
      this.zoneMgr.drawCards(action.playerId, count);
      // 3. 将牌组充分洗切
      this.zoneMgr.shuffleDeck(action.playerId);
    }

    // 4. 标记该玩家已完成调度
    player.hasMulliganed = true;

    this.events.push({
      type: 'MULLIGAN_COMPLETED',
      playerId: action.playerId,
      bottomCount: count,
      redrawCount: count,
    });

    // 5. 检查是否双方均已完成调度
    const allMulliganed = Object.values(this.state.players).every((p) => p.hasMulliganed);
    if (allMulliganed) {
      // 5.2.1.f 双方调度完成并充分洗切后，从各自牌组顶将 2 张卡牌以正面竖直状态放置在费用区作为起始明费
      for (const p of Object.values(this.state.players)) {
        this.zoneMgr.placeInitialOpenCosts(p.playerId);
      }

      // 5.2.1.g 双方调度与明费填充完毕，正式进入第一回合竖直阶段与抽牌填充阶段
      this.phaseMachine.startStandPhase();
    }

    return { success: true };
  }
}

/**
 * 8.6.3 校验玩家提交的决策：只能选择该决策给出的、可选择的选项，且数量在规定范围内。
 * 可选选项少于最少选择数时，按「尽可能选择」(8.6.3.a.2/a.3) 降低下限。
 */
export function validateChoiceSelection(choice: PendingChoice, selectedIds: unknown): string | undefined {
  if (!Array.isArray(selectedIds) || selectedIds.some((id) => typeof id !== 'string')) {
    return '提交的选择格式不正确';
  }
  if (new Set(selectedIds).size !== selectedIds.length) {
    return '不能重复选择同一个选项';
  }

  const eligibleIds = new Set(
    choice.options
      .filter((opt) => (opt.payload as { eligible?: boolean } | undefined)?.eligible !== false)
      .map((opt) => opt.id)
  );
  for (const id of selectedIds as string[]) {
    if (!choice.options.some((opt) => opt.id === id)) {
      return '所选内容不在本次可选范围内';
    }
    if (!eligibleIds.has(id)) {
      return '所选卡牌不符合本次选择的条件';
    }
  }

  const minRequired = Math.min(choice.minSelections, eligibleIds.size);
  if (selectedIds.length < minRequired) {
    return `至少需要选择 ${minRequired} 项`;
  }
  if (selectedIds.length > choice.maxSelections) {
    return `最多只能选择 ${choice.maxSelections} 项`;
  }
  return undefined;
}

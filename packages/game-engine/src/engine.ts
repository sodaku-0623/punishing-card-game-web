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
  CardVersionData,
  AscensionRestriction,
} from '@zhanshuang/shared';
import { SeedRng } from './rng/seed-rng.js';
import { ICardDatabase, BASE_TEST_CARDS, MemoryCardDatabase } from './database/card-registry.js';
import { RULE_CONSTANTS } from '@zhanshuang/game-rules';
import { createInitialGameState, PlayerInitConfig } from './state/create-game.js';
import { sanitizeGameStateForPlayer } from './state/sanitize-state.js';
import { ZoneManager } from './zone/zone-manager.js';
import { BattlefieldManager, getAttachedEquipmentIds } from './zone/battlefield-manager.js';
import { SbaEngine } from './sba/sba-engine.js';
import { CheckTimingManager } from './priority/check-timing.js';
import { TriggerManager } from './priority/trigger-system.js';
import { CombatManager } from './combat/combat-manager.js';
import { PhaseMachine } from './phases/phase-machine.js';
import { ContinuousEffectEngine, expandBaseTraits, normalizeCardName } from './effects/continuous-effects.js';
import { ReplacementEngine } from './effects/replacement-engine.js';
import { CardEffectEngine } from './effects/card-effects.js';
import { advancePendingChoice, enqueuePendingChoice } from './state/pending-choice.js';

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
  continuousEffects!: ContinuousEffectEngine;
  replacementEngine!: ReplacementEngine;
  triggerMgr!: TriggerManager;
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
    this.continuousEffects = new ContinuousEffectEngine(
      this.state,
      this.cardDb,
      (playerId, zone) => this.zoneMgr.getCardsInZone(playerId, zone),
      (playerId) =>
        this.fieldMgr
          .getSlots(playerId)
          .map((s) => {
            if (s.roleCardId) {
              const rc = this.state.cards[s.roleCardId];
              if (rc && !rc.modifiers?.some((m) => m.setCardType === CardType.ASSIST)) {
                return rc;
              }
            }
            if (
              s.assistCardId &&
              this.state.cards[s.assistCardId]?.modifiers?.some((m) => m.setCardType === CardType.ROLE)
            ) {
              return this.state.cards[s.assistCardId];
            }
            return undefined;
          })
          .filter((c): c is CardInstance => !!c)
    );
    this.fieldMgr.setContinuousEffectEngine(this.continuousEffects);
    this.zoneMgr.setContinuousEffectEngine(this.continuousEffects);

    this.replacementEngine = new ReplacementEngine(
      this.state,
      this.cardDb,
      (playerId, zone) => this.zoneMgr.getCardsInZone(playerId, zone),
      (cardId) => this.continuousEffects.hasLostInherentAbilities(cardId),
      (cardId, name) => this.continuousEffects.hasCardName(cardId, name),
      (cardId, trait) => this.continuousEffects.hasTrait(cardId, trait)
    );
    this.replacementEngine.setMaxCostCapacityProvider((pid) => this.zoneMgr.getMaxCostZoneCapacity(pid));
    this.zoneMgr.setReplacementEngine(this.replacementEngine);
    this.replacementEngine.setSendCardToGraveyardHandler((cid, sentByEffectOrCost) => {
      this.zoneMgr.moveCard(cid, 'GRAVEYARD', { isFaceUp: true, sentByEffectOrCost });
    });
    this.replacementEngine.setChoiceEnqueuer((ch) => enqueuePendingChoice(this.state, ch));
    this.zoneMgr.setWanshimingChargeHandler((playerId, cardInstanceId, attackerCardId) => {
      const card = this.state.cards[cardInstanceId];
      const def = card ? this.cardDb.getCard(card.cardNumber) : undefined;
      enqueuePendingChoice(this.state, {
        id: `choice-wanshiming-charge-${this.state.turnNumber}-${this.events.length}`,
        playerId,
        choiceType: 'SELECT_OPTION',
        prompt: `【${def?.name ?? '万世铭'}】因<曲>角色攻击充能进入处理区，是否改为以横置状态放置到费用区（满10张时改放墓地）？`,
        options: [
          { id: 'to_cost', label: '改为横置放置到费用区 (8.10 置换)' },
          { id: 'keep', label: '保持原处理 (正常充能加入手牌)' },
        ],
        effectType: 'BP01_WANSHIMING_TO_COST',
        sourceCardInstanceId: cardInstanceId,
        minSelections: 1,
        maxSelections: 1,
        metadata: { cardInstanceId, attackerCardId },
      });
      return true;
    });

    this.triggerMgr = new TriggerManager(
      this.state,
      this.cardDb,
      this.zoneMgr,
      this.fieldMgr,
      this.continuousEffects,
      this.events,
      (ch) => enqueuePendingChoice(this.state, ch)
    );

    const emitTrigger = (ev: Parameters<TriggerManager['emit']>[0]) => this.triggerMgr.emit(ev);
    const snapshotCard = (id: string) => this.triggerMgr.snapshotCard(id);

    this.zoneMgr.setTriggerEventHandler(emitTrigger, snapshotCard);
    this.fieldMgr.setTriggerEventHandler(emitTrigger, snapshotCard);

    this.sbaEngine = new SbaEngine(this.state, this.zoneMgr, this.fieldMgr, this.events);
    this.sbaEngine.setTriggerEventHandler(emitTrigger, snapshotCard);
    this.sbaEngine.setReplacementEngine(this.replacementEngine);
    this.sbaEngine.setContinuousEffectEngine(this.continuousEffects);

    this.checkTimingMgr = new CheckTimingManager(this.state, this.sbaEngine);
    this.checkTimingMgr.setTriggerManager(this.triggerMgr);

    this.combatMgr = new CombatManager(
      this.state,
      this.zoneMgr,
      this.fieldMgr,
      this.cardDb,
      this.checkTimingMgr,
      this.events
    );
    this.combatMgr.setTriggerEventHandler(emitTrigger, snapshotCard);
    this.combatMgr.setReplacementEngine(this.replacementEngine);
    this.combatMgr.setContinuousEffectEngine(this.continuousEffects);

    this.phaseMachine = new PhaseMachine(
      this.state,
      this.zoneMgr,
      this.checkTimingMgr,
      this.events
    );
    this.phaseMachine.setTriggerEventHandler(emitTrigger);
    this.phaseMachine.setContinuousEffectEngine(this.continuousEffects);
    this.phaseMachine.setReplacementEngine(this.replacementEngine);
    this.phaseMachine.setTurnStartAirborneReturnHandler((pid) => {
      const returnedId = this.fieldMgr.returnAirborneRoleAtTurnStart(pid);
      if (returnedId) {
        const returnedCard = this.state.cards[returnedId];
        const def = returnedCard ? this.cardDb.getCard(returnedCard.cardNumber) : undefined;
        if (def) this.effectEngine.handleRoleEntryEffect(pid, returnedId, def);
      }
    });
    this.phaseMachine.setEndPhaseReleasePartnersHandler(() => {
      for (const pid of Object.keys(this.state.players)) {
        const p = this.state.players[pid];
        if (p) p.destroyedFireRoleCountThisTurn = 0;
        for (const slot of this.fieldMgr.getSlots(pid)) {
          if (slot.roleCardId) {
            this.fieldMgr.releasePartner(slot.roleCardId, false);
          }
        }
      }
    });

    this.effectEngine = new CardEffectEngine({
      state: this.state,
      zoneMgr: this.zoneMgr,
      fieldMgr: this.fieldMgr,
      continuousEffects: this.continuousEffects,
      replacementEngine: this.replacementEngine,
      triggerMgr: this.triggerMgr,
      cardDb: this.cardDb,
      events: this.events,
      payCost: (p, c, sel) => this.payCost(p, c, sel),
      // 设置决策时排队，避免覆盖尚未处理的决策；传入 undefined 表示当前决策处理完毕，进入下一个
      setPendingChoice: (ch) => {
        if (ch) enqueuePendingChoice(this.state, ch);
        else advancePendingChoice(this.state);
      },
    });

    this.zoneMgr.setChargeAutoHandler((playerId, cardInstanceId, cardDef, chargeKind, attackerCardId) => {
      this.effectEngine.handleChargeAutoEffect(playerId, cardInstanceId, cardDef, chargeKind, attackerCardId);
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
        const res = this.handlePass(action.playerId);
        success = res.success;
        error = res.error;
        break;
      }

      case 'USE_INSTANT': {
        if (action.pass || !action.cardInstanceId) {
          const res = this.handlePass(action.playerId);
          success = res.success;
          error = res.error;
        } else {
          const targetCard = this.state.cards[action.cardInstanceId];
          const targetDef = targetCard
            ? this.cardDb.getCard(targetCard.cardNumber) ||
              (targetCard.cardId ? this.cardDb.getCard(targetCard.cardId) : undefined)
            : undefined;
          if (targetCard && targetDef && isInstantTactics(targetDef)) {
            const res = this.handlePlayCard({
              type: 'PLAY_CARD',
              playerId: action.playerId,
              cardInstanceId: action.cardInstanceId,
              costCardInstanceIds: action.costCardInstanceIds,
            });
            success = res.success;
            error = res.error;
          } else if (targetCard && targetDef) {
            if (!this.state.timingWindow || this.state.timingWindow.priorityPlayerId !== action.playerId) {
              success = false;
              error = '当前不在您的【瞬时】优先权时机 (7.3.1.b / 10.8)';
            } else {
              const res = this.effectEngine.handleUseNonTacticsInstant(
                action.playerId,
                targetCard,
                targetDef,
                action.costCardInstanceIds
              );
              success = res.success;
              error = res.error;
              if (success && this.state.timingWindow) {
                this.state.timingWindow.consecutivePasses = 0;
                this.state.timingWindow.priorityPlayerId = this.getOpponentId(action.playerId);
                this.state.priorityPlayerId = this.state.timingWindow.priorityPlayerId;
              }
            }
          } else {
            success = false;
            error = '未找到指定的【瞬时】卡牌';
          }
        }
        break;
      }

      case 'PERFORM_ASSIST': {
        const res = this.handlePerformAssist(action);
        success = res.success;
        error = res.error;
        break;
      }

      default:
        error = `未支持的行动类型: ${(action as { type: string }).type}`;
        success = false;
    }

    // 推进无需玩家行动的流程，再执行规则处理确认
    if (success) {
      this.continueFlow();
      this.sweepResolvedTactics();
    }
    this.checkTimingMgr.resolveCheckTiming();

    // 卡牌效果可能直接改变费用区卡牌的竖直/横置状态，统一从实际卡牌重新统计费用
    for (const pid of Object.keys(this.state.players)) {
      this.zoneMgr.syncCostStats(pid);
    }
    this.refreshDisplayedStats();

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

  /** 最近一次 payCost 成功支付中消耗的暗费张数 (供 BP03-015 判定是否支付过暗费) */
  private lastPayCostHiddenCount = 0;

  /**
   * 通用扣除费用逻辑 (3.6.5.a；2.5 支持玩家自选；含 BP03-080 对方回合必须优先支付暗费)
   */
  payCost(playerId: string, costToPay: number, selectedCostCardIds?: string[]): boolean {
    const player = this.state.players[playerId];
    if (!player) return false;
    this.lastPayCostHiddenCount = 0;
    if (costToPay <= 0) {
      return !selectedCostCardIds || selectedCostCardIds.length === 0;
    }

    const costZoneCards = this.zoneMgr.getCardsInZone(playerId, 'COST');
    const oppId = this.getOpponentId(playerId);
    const mustPayHiddenFirst =
      this.state.activePlayerId === playerId &&
      this.fieldMgr.getSlots(oppId).some((s) => {
        const rid = s.roleCardId ?? (s.assistCardId && this.fieldMgr.isSlotRole(oppId, s.assistCardId) ? s.assistCardId : undefined);
        const rc = rid ? this.state.cards[rid] : undefined;
        return Boolean(
          rc &&
            rc.cardNumber === 'BP03-080' &&
            !this.continuousEffects.hasLostInherentAbilities(rc.instanceId)
        );
      });

    if (selectedCostCardIds !== undefined) {
      if (selectedCostCardIds.length !== costToPay || new Set(selectedCostCardIds).size !== costToPay) {
        return false;
      }
      const chosenCards: CardInstance[] = [];
      for (const id of selectedCostCardIds) {
        const c = this.state.cards[id];
        if (!c || c.controllerPlayerId !== playerId || c.zone !== 'COST') return false;
        if (c.isFaceUp && !c.isReady) return false;
        chosenCards.push(c);
      }
      if (mustPayHiddenFirst) {
        const availHidden = costZoneCards.filter((c) => !c.isFaceUp).length;
        const chosenHidden = chosenCards.filter((c) => !c.isFaceUp).length;
        if (chosenHidden < Math.min(costToPay, availHidden)) {
          return false;
        }
      }
      const tappedOpenIds: string[] = [];
      const discardedHiddenIds: string[] = [];
      for (const c of chosenCards) {
        if (c.isFaceUp) {
          c.isReady = false;
          tappedOpenIds.push(c.instanceId);
        } else {
          this.zoneMgr.moveCard(c.instanceId, 'GRAVEYARD', { isFaceUp: true });
          discardedHiddenIds.push(c.instanceId);
        }
      }
      this.lastPayCostHiddenCount = discardedHiddenIds.length;
      this.zoneMgr.syncCostStats(playerId);
      this.events.push({
        type: 'COST_PAID',
        playerId,
        openCostTappedIds: tappedOpenIds,
        hiddenCostDiscardedIds: discardedHiddenIds,
      });
      return true;
    }

    // 未指定时默认策略：若受 BP03-080 约束则先付暗费再横置明费；否则先横置竖直明费再付暗费
    const readyOpenCosts = costZoneCards.filter((c) => c.isFaceUp && c.isReady);
    const hiddenCosts = costZoneCards.filter((c) => !c.isFaceUp);
    if (readyOpenCosts.length + hiddenCosts.length < costToPay) return false;

    let costRemaining = costToPay;
    const tappedOpenIds: string[] = [];
    const discardedHiddenIds: string[] = [];

    if (mustPayHiddenFirst) {
      for (const c of hiddenCosts) {
        if (costRemaining <= 0) break;
        this.zoneMgr.moveCard(c.instanceId, 'GRAVEYARD', { isFaceUp: true });
        discardedHiddenIds.push(c.instanceId);
        costRemaining--;
      }
      for (const c of readyOpenCosts) {
        if (costRemaining <= 0) break;
        c.isReady = false;
        tappedOpenIds.push(c.instanceId);
        costRemaining--;
      }
    } else {
      for (const c of readyOpenCosts) {
        if (costRemaining <= 0) break;
        c.isReady = false; // 3.6.5.a.1 横置明费
        tappedOpenIds.push(c.instanceId);
        costRemaining--;
      }

      for (const c of hiddenCosts) {
        if (costRemaining <= 0) break;
        this.zoneMgr.moveCard(c.instanceId, 'GRAVEYARD', { isFaceUp: true }); // 3.6.5.a.2 暗费正面放置到墓地
        discardedHiddenIds.push(c.instanceId);
        costRemaining--;
      }
    }
    this.lastPayCostHiddenCount = discardedHiddenIds.length;
    this.zoneMgr.syncCostStats(playerId);

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
    isAscension?: boolean,
    targetAscensionCardId?: string
  ): { costToPay: number; appliedModifiers: CostModifier[] } {
    const card = this.state.cards[cardInstanceId];
    if (!card) return { costToPay: 0, appliedModifiers: [] };
    const cardDef = this.cardDb.getCard(card.cardNumber) || (card.cardId ? this.cardDb.getCard(card.cardId) : undefined);
    if (!cardDef) return { costToPay: 0, appliedModifiers: [] };

    const player = this.state.players[playerId];
    const isAscensionPlay = !!(isAscension && cardDef.ascensionConfig);
    let baseCost = isAscensionPlay
      ? cardDef.ascensionConfig!.ascensionCost
      : cardDef.cost;

    // BP02-067 万事·明晰梦【永】：若横置状态在对方战场，对方在横置状态角色上方升变须额外支付【1费】
    if (isAscensionPlay && targetAscensionCardId) {
      const targetAsc = this.state.cards[targetAscensionCardId];
      if (targetAsc && !targetAsc.isReady) {
        const oppId = this.getOpponentId(playerId);
        const hasTappedWanshiTax = this.fieldMgr.getSlots(oppId).some((s) => {
          const r = s.roleCardId ? this.state.cards[s.roleCardId] : undefined;
          return Boolean(
            r &&
              r.cardNumber === 'BP02-067' &&
              !r.isReady &&
              !this.continuousEffects.hasLostInherentAbilities(r.instanceId)
          );
        });
        if (hasTappedWanshiTax) {
          baseCost += 1;
        }
      }
    }

    let discount = 0;
    const appliedModifiers: CostModifier[] = [];

    // 1. 玩家当前挂载的动态费用修改器 (如卡牌【起】动能力减费)
    if (player?.costModifiers && player.costModifiers.length > 0) {
      for (const mod of player.costModifiers) {
        if (mod.excludeAscension && isAscensionPlay) continue;
        if (mod.cardType && mod.cardType !== cardDef.cardType) continue;
        if (mod.targetTrait) {
          const cardTraits = expandBaseTraits(cardDef.traits);
          const matchTrait =
            cardTraits.has(mod.targetTrait) ||
            cardDef.traits?.some((t) => t.includes(mod.targetTrait!));
          const matchName = normalizeCardName(cardDef.name).includes(normalizeCardName(mod.targetTrait));
          if (!matchTrait && !matchName) continue;
        }
        if (mod.targetName && !normalizeCardName(cardDef.name).includes(normalizeCardName(mod.targetName))) continue;

        discount += mod.amount;
        appliedModifiers.push(mod);
      }
    }

    // 2. 卡牌自身静态能力减费 (8.6.2.c)：优先走声明式效果库 (如 ST03-011 三头犬出击)
    const dslDiscount = this.effectEngine.presets.calculateHandCostDiscount(playerId, cardDef.cardNumber);
    if (dslDiscount > 0) {
      discount += dslDiscount;
    } else if (cardDef.rulesText.includes('我方战场每有1张<三头犬小队>角色，手牌的该牌的费用-1')) {
      const myBattlefieldSlots = this.state.battlefields[playerId] || [];
      const cerberusRoleCount = myBattlefieldSlots.filter((s) => {
        if (!s.roleCardId) return false;
        const roleCard = this.state.cards[s.roleCardId];
        if (!roleCard) return false;
        const rDef = this.cardDb.getCard(roleCard.cardNumber) || (roleCard.cardId ? this.cardDb.getCard(roleCard.cardId) : undefined);
        if (!rDef || rDef.cardType !== CardType.ROLE) return false;
        return (
          this.continuousEffects.hasTrait(roleCard.instanceId, '三头犬小队') ||
          rDef.name.includes('三头犬小队')
        );
      }).length;
      discount += cerberusRoleCount;
    }

      // 战场卡牌【永】带来的手牌费用覆写/减免 (如 BP01-077 首张《荣光护盾》变1费、BP01-015 首张装备-1费)
      const fieldAdj = this.effectEngine.presets.calculateFieldHandCostAdjustment(playerId, cardDef, isAscensionPlay);
      let effectiveBase = baseCost;
      if (fieldAdj.setCost !== undefined) {
        effectiveBase = fieldAdj.setCost;
      }
      discount += fieldAdj.discount;

      const costToPay = Math.max(0, effectiveBase - discount);
      return { costToPay, appliedModifiers };
  }

  /**
   * 8.6.2 打出卡牌 (PLAY_CARD)
   */
  private handlePlayCard(action: Extract<GameAction, { type: 'PLAY_CARD' }>): {
    success: boolean;
    error?: string;
  } {
    const card = this.state.cards[action.cardInstanceId];
    if (!card || card.controllerPlayerId !== action.playerId) {
      return { success: false, error: '不存在该卡牌' };
    }

    const cardDef = this.cardDb.getCard(card.cardNumber) || (card.cardId ? this.cardDb.getCard(card.cardId) : undefined);
    if (!cardDef) {
      return { success: false, error: `未找到卡牌规则定义 (卡号: ${card.cardNumber || card.cardId})` };
    }

    const spec = this.effectEngine.presets.getSpec(cardDef.cardNumber);
    const inHand = card.zone === 'HAND';
    const canPlayFromGraveyard =
      card.zone === 'GRAVEYARD' &&
      ((Boolean(action.isAscension) && Boolean(cardDef.ascensionConfig?.sourceZones?.includes('GRAVEYARD'))) ||
        Boolean(spec?.playFromZones?.includes('GRAVEYARD')));
    const lunaUnderneathHost =
      spec?.playFromZones?.includes('UNDERNEATH')
        ? this.fieldMgr
            .getSlots(action.playerId)
            .map((s) => (s.roleCardId ? this.state.cards[s.roleCardId] : undefined))
            .find(
              (r): r is CardInstance =>
                Boolean(r) &&
                this.continuousEffects.hasCardName(r!.instanceId, '露娜·终焉') &&
                r!.underneathCardIds.includes(card.instanceId)
            )
        : undefined;
    if (!inHand && !canPlayFromGraveyard && !lunaUnderneathHost) {
      return { success: false, error: '当前区域中不存在可使用的该卡牌' };
    }

    // 10.8 【瞬时】只能在轮流使用瞬时的时机 (自由时点步骤 / 结束阶段) 使用，由持有优先权的玩家使用；
    // 其他卡牌只能由回合玩家在主要阶段的行动时机使用 (6.4.1.b)
    const timingWindow = this.state.timingWindow;
    const isInstant = isInstantTactics(cardDef);
    if (timingWindow) {
      if (timingWindow.priorityPlayerId !== action.playerId) {
        return { success: false, error: '现在不是你使用【瞬时】的时机' };
      }
      if (!isInstant) {
        return { success: false, error: '此时只能使用【瞬时】卡牌 (10.8)' };
      }
      const timingError = this.checkInstantTiming(action.playerId, cardDef);
      if (timingError) return { success: false, error: timingError };
    } else {
      const turnError = this.checkMainPhaseAction(action.playerId);
      if (turnError) return { success: false, error: turnError };
      if (
        isInstant &&
        !spec?.allowInstantInMainPhase &&
        !cardDef.rulesText.includes('主要阶段也可以发动')
      ) {
        return { success: false, error: '【瞬时】只能在自由时点步骤或结束阶段使用 (10.8)' };
      }
      if (isInstant) {
        const timingError = this.checkInstantTiming(action.playerId, cardDef);
        if (timingError) return { success: false, error: timingError };
      }
    }

    const player = this.state.players[action.playerId]!;

    // PR-014 银晕辉光：每位玩家每回合最多使用 N 张同名卡牌
    if (
      spec?.maxPlaysPerTurnByName !== undefined &&
      (player.turnCardPlayedCountByName?.[cardDef.name] ?? 0) >= spec.maxPlaysPerTurnByName
    ) {
      return {
        success: false,
        error: `《${cardDef.name}》每回合最多只能使用 ${spec.maxPlaysPerTurnByName} 张`,
      };
    }

    // 8.6.2.a.1 卡牌属性条件：属性需与自身费用区中任意一张明费属性相同
    // 信号球牌无属性 (4.16.1.a) 或满足「无视属性条件」(ST04-008 / PR-010 / BP02-009 / BP04-059) 时跳过检查
    if (
      cardDef.attribute !== ElementAttribute.NONE &&
      !this.effectEngine.presets.canIgnoreAttributeCondition(action.playerId, cardDef.cardNumber) &&
      !this.effectEngine.presets.canPlayerIgnoreAttributeForPlay(
        action.playerId,
        card.instanceId,
        cardDef,
        Boolean(action.isAscension)
      )
    ) {
      const openCostCards = this.zoneMgr.getCardsInZone(action.playerId, 'COST').filter((c) => c.isFaceUp);
      const hasMatchingAttribute = openCostCards.some((c) => {
        const def = this.cardDb.getCard(c.cardNumber) || (c.cardId ? this.cardDb.getCard(c.cardId) : undefined);
        return def?.attribute === cardDef.attribute;
      });

      if (!hasMatchingAttribute) {
        return { success: false, error: `费用区没有与【${cardDef.attribute}】属性匹配的明费 (8.6.2.a.1)` };
      }
    }

    // 若从《露娜·终焉》下方使用战术牌，先行解绑并进入处理区 (8.6.2)
    if (lunaUnderneathHost) {
      lunaUnderneathHost.underneathCardIds = lunaUnderneathHost.underneathCardIds.filter(
        (id) => id !== card.instanceId
      );
      this.zoneMgr.moveCard(card.instanceId, 'PROCESSING', { isFaceUp: true });
    }

    // 8.11 升变：检查升变对象、限制条件 (8.11.3.b~d)，升变代价在下方与费用一并支付 (8.11.3.e)
    let extraStackRoleCardId: string | undefined;
    let bp01001GraveyardShuffleIds: string[] | undefined;
    if (action.isAscension) {
      const ascensionCheck = this.validateAscensionPlan(
        action.playerId,
        cardDef,
        action.targetAscensionCardId,
        action.targetSlotIndex,
        action.extraAscensionCostCardId
      );
      if (ascensionCheck.error) return { success: false, error: ascensionCheck.error };
      extraStackRoleCardId = ascensionCheck.extraStackRoleCardId;
      bp01001GraveyardShuffleIds = ascensionCheck.bp01001GraveyardShuffleIds;
    }

    // 8.6.2.c 支付费用 (计算动态费用减免与固有静态减费，2.5 支持自选明费/暗费)
    const { costToPay, appliedModifiers } = this.calculateCardCost(
      action.playerId,
      action.cardInstanceId,
      action.isAscension,
      action.targetAscensionCardId
    );

    // BP02-012 丽芙·极昼 / BP04-060 血税：使用时可选将战场/手牌指定卡牌放置到墓地以减费或改写费用
    const playSacrificeRule = spec?.playSacrificeDiscount;
    if (playSacrificeRule && !action.costCardInstanceIds) {
      const sacrificeCandidates: CardInstance[] = [];
      for (const z of playSacrificeRule.zones) {
        const rawList =
          z === 'BATTLEFIELD'
            ? this.fieldMgr
                .getSlots(action.playerId)
                .map((s) => (s.roleCardId ? this.state.cards[s.roleCardId] : undefined))
                .filter((c): c is CardInstance => Boolean(c))
            : this.zoneMgr.getCardsInZone(action.playerId, z);
        for (const c of rawList) {
          if (c.instanceId === action.cardInstanceId) continue;
          const d = this.cardDb.getCard(c.cardNumber) || (c.cardId ? this.cardDb.getCard(c.cardId) : undefined);
          if (!d) continue;
          if (
            playSacrificeRule.filter.exactName &&
            d.name !== playSacrificeRule.filter.exactName &&
            !this.continuousEffects.hasCardName(c.instanceId, playSacrificeRule.filter.exactName)
          ) {
            continue;
          }
          if (
            playSacrificeRule.filter.trait &&
            !this.continuousEffects.hasTrait(c.instanceId, playSacrificeRule.filter.trait)
          ) {
            continue;
          }
          if (playSacrificeRule.filter.cardType && d.cardType !== playSacrificeRule.filter.cardType) {
            continue;
          }
          sacrificeCandidates.push(c);
        }
      }
      if (sacrificeCandidates.length > 0) {
        const avail = player.availableOpenCostCount + player.hiddenCostCount;
        const discountedCost =
          playSacrificeRule.setCost !== undefined
            ? Math.max(0, playSacrificeRule.setCost)
            : Math.max(0, costToPay - (playSacrificeRule.discount ?? 0));
        if (discountedCost < costToPay) {
          if (avail < discountedCost) {
            return {
              success: false,
              error: `费用不足，需要至少 ${discountedCost} 费，当前可用 ${avail}`,
            };
          }
          const minSacrifice = avail < costToPay ? 1 : 0;
          enqueuePendingChoice(this.state, {
            id: `choice-play-sacrifice-${action.cardInstanceId}-${this.events.length}`,
            playerId: action.playerId,
            choiceType: 'SELECT_CARDS',
            prompt:
              playSacrificeRule.prompt ??
              `【${cardDef.name}】可选择将 1 张符合条件的卡牌放置到墓地，使该牌费用变为 ${discountedCost}：`,
            options: sacrificeCandidates.map((c) => this.effectEngine.createGeneralCardChoiceOption(c)),
            effectType: 'PLAY_CARD_SACRIFICE_DISCOUNT',
            sourceCardInstanceId: action.cardInstanceId,
            minSelections: minSacrifice,
            maxSelections: 1,
            metadata: {
              cardInstanceId: action.cardInstanceId,
              baseCostToPay: costToPay,
              sacrificedCostMode: playSacrificeRule.setCost !== undefined ? 'SET' : 'DELTA',
              sacrificedCostValue:
                playSacrificeRule.setCost !== undefined
                  ? playSacrificeRule.setCost
                  : (playSacrificeRule.discount ?? 0),
              isAscension: action.isAscension,
              targetAscensionCardId: action.targetAscensionCardId,
              targetSlotIndex: action.targetSlotIndex,
              extraStackRoleCardId,
              bp01001GraveyardShuffleIds,
              appliedModifierIds: appliedModifiers.map((m) => m.id),
              isTimingWindow: Boolean(timingWindow),
            },
          });
          return { success: true };
        }
      }
    }

    // BP01-067 最后的晚空：使用时可丢弃手牌任意张符合条件的卡牌来减费
    const playDiscardRule = !action.isAscension
      ? this.effectEngine.presets.getSpec(cardDef.cardNumber)?.playDiscardDiscount
      : undefined;
    if (playDiscardRule) {
      const handCandidates = this.zoneMgr
        .getCardsInZone(action.playerId, 'HAND')
        .filter((c) => {
          if (c.instanceId === action.cardInstanceId) return false;
          const d = this.cardDb.getCard(c.cardNumber) || (c.cardId ? this.cardDb.getCard(c.cardId) : undefined);
          if (!d) return false;
          if (playDiscardRule.filter.exactName && d.name !== playDiscardRule.filter.exactName) return false;
          if (playDiscardRule.filter.trait && !this.continuousEffects.hasTrait(c.instanceId, playDiscardRule.filter.trait)) {
            return false;
          }
          if (playDiscardRule.filter.cardType && d.cardType !== playDiscardRule.filter.cardType) return false;
          return true;
        });
      if (handCandidates.length > 0) {
        const avail = player.availableOpenCostCount + player.hiddenCostCount;
        const maxDiscount = handCandidates.length * playDiscardRule.discountPerCard;
        if (avail < Math.max(0, costToPay - maxDiscount)) {
          return {
            success: false,
            error: `费用不足，需要至少 ${Math.max(0, costToPay - maxDiscount)} 费，当前可用 ${avail}`,
          };
        }
        const minDiscard =
          costToPay > avail ? Math.ceil((costToPay - avail) / playDiscardRule.discountPerCard) : 0;
        this.zoneMgr.moveCard(action.cardInstanceId, 'PROCESSING', { isFaceUp: true });
        enqueuePendingChoice(this.state, {
          id: `choice-play-discard-${action.cardInstanceId}-${this.events.length}`,
          playerId: action.playerId,
          choiceType: 'SELECT_CARDS',
          prompt:
            playDiscardRule.prompt ??
            `【${cardDef.name}】可选择丢弃手牌中任意数量的指定卡牌来减费（当前基础费用 ${costToPay}，每弃1张费用-${playDiscardRule.discountPerCard}）：`,
          options: handCandidates.map((c) => this.effectEngine.createGeneralCardChoiceOption(c)),
          effectType: 'PLAY_CARD_DISCARD_DISCOUNT',
          sourceCardInstanceId: action.cardInstanceId,
          minSelections: minDiscard,
          maxSelections: handCandidates.length,
          metadata: {
            cardInstanceId: action.cardInstanceId,
            baseCostToPay: costToPay,
            discountPerCard: playDiscardRule.discountPerCard,
            appliedModifierIds: appliedModifiers.map((m) => m.id),
            isTimingWindow: Boolean(timingWindow),
          },
        });
        return { success: true };
      }
    }

    if (!this.payCost(action.playerId, costToPay, action.costCardInstanceIds)) {
      const avail = player.availableOpenCostCount + player.hiddenCostCount;
      return { success: false, error: `费用不足或自选支付无效，需要 ${costToPay} 费，当前可用 ${avail}` };
    }
    return this.completePlayCardDeployment(action, card, cardDef, {
      appliedModifiers,
      paidHiddenCost: this.lastPayCostHiddenCount > 0,
      extraStackRoleCardId,
      bp01001GraveyardShuffleIds,
      isTimingWindow: Boolean(timingWindow),
    });
  }

  /**
   * 8.6.2.e 支付费用完成后统一结算卡牌使用计数、部署入场与【瞬时】窗口移交
   */
  private completePlayCardDeployment(
    action: Extract<GameAction, { type: 'PLAY_CARD' }>,
    card: CardInstance,
    cardDef: CardVersionData,
    options: {
      appliedModifiers: CostModifier[];
      paidHiddenCost: boolean;
      extraStackRoleCardId?: string;
      bp01001GraveyardShuffleIds?: string[];
      isTimingWindow: boolean;
    }
  ): { success: boolean; error?: string } {
    const player = this.state.players[action.playerId]!;

    // BP01-001 露西亚·鸦羽【永】：将墓地 10 张<灰鸦小队>加入牌组并洗切以无视「费用上限8及以上」升变条件
    if (options.bp01001GraveyardShuffleIds && options.bp01001GraveyardShuffleIds.length >= 10) {
      for (const gid of options.bp01001GraveyardShuffleIds) {
        this.zoneMgr.moveCard(gid, 'DECK', { isFaceUp: false });
      }
      this.zoneMgr.shuffleDeck(action.playerId);
    }

    // 记录本回合卡牌使用计数 (含 Q&A·8《罗塞塔·凛冽》已使用张数及《神曲》艺术协会战术数)
    player.turnCardPlayedCountByName = player.turnCardPlayedCountByName ?? {};
    player.turnCardPlayedCountByName[cardDef.name] = (player.turnCardPlayedCountByName[cardDef.name] ?? 0) + 1;
    player.cardsPlayedThisTurn = (player.cardsPlayedThisTurn ?? 0) + 1;
    if (cardDef.cardType === CardType.EQUIPMENT) {
      player.turnEquipmentPlayedCount = (player.turnEquipmentPlayedCount ?? 0) + 1;
    }
    if (
      cardDef.cardType === CardType.TACTICS &&
      this.continuousEffects.hasTrait(card.instanceId, '艺术协会')
    ) {
      player.turnArtAssocTacticsPlayedCount = (player.turnArtAssocTacticsPlayedCount ?? 0) + 1;
    }

    // 扣减已适用的修改器使用次数 (如“下1张”)
    if (options.appliedModifiers.length > 0 && player.costModifiers) {
      const idSet = new Set(options.appliedModifiers.map((m) => m.id));
      for (const mod of player.costModifiers) {
        if (idSet.has(mod.id) && mod.remainingCount !== undefined) {
          mod.remainingCount--;
        }
      }
      player.costModifiers = player.costModifiers.filter(
        (m) => m.remainingCount === undefined || m.remainingCount > 0
      );
    }

    card.paidHiddenCostOnPlay = options.paidHiddenCost || undefined;

    // 8.6.2.e 结算卡牌进入区域并自动触发效果处理
    if (action.isAscension && action.targetAscensionCardId) {
      // 8.11 升变出场 (含信号球区/浮空区升变对象与 BP01-040 额外叠放《帕瓦》)
      const ok = this.fieldMgr.playAscensionCard(
        action.playerId,
        action.cardInstanceId,
        action.targetAscensionCardId,
        {
          targetSlotIndex: action.targetSlotIndex,
          extraStackRoleCardId: options.extraStackRoleCardId,
        }
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
        .filter((c): c is CardInstance => !!c && this.fieldMgr.canEquipToRole(action.playerId, action.cardInstanceId, c.instanceId));

      if (action.targetEquipRoleId) {
        // 8.6.2.e.2 放置到可以装备该牌的自身战场角色下方进行装备
        this.zoneMgr.moveCard(action.cardInstanceId, 'PROCESSING', { isFaceUp: true });
        if (!this.fieldMgr.equipToRole(action.playerId, action.cardInstanceId, action.targetEquipRoleId)) {
          return { success: false, error: '装备对象必须是自身战场上未装备装备牌的角色 (4.18.3)' };
        }
        this.effectEngine.handleEquipmentBuff(action.targetEquipRoleId, cardDef);
        if (this.effectEngine.presets.handlesEntry(cardDef.cardNumber)) {
          this.effectEngine.presets.enter(action.playerId, action.cardInstanceId, cardDef);
        }
      } else if (action.targetSlotIndex !== undefined || roleCards.length === 0) {
        // 8.6.2.e.2 以正面竖直状态放置到自身战场空余卡位
        const slotIndex = action.targetSlotIndex ?? this.fieldMgr.findFirstEmptySlot(action.playerId);
        if (slotIndex === undefined) return { success: false, error: '战场没有空余卡位 (8.6.2.b.3)' };
        if (!this.fieldMgr.playStandaloneEquipment(action.playerId, action.cardInstanceId, slotIndex)) {
          return { success: false, error: '所选卡位已被占用 (8.6.2.b.3)' };
        }
        if (this.effectEngine.presets.handlesEntry(cardDef.cardNumber)) {
          this.effectEngine.presets.enter(action.playerId, action.cardInstanceId, cardDef);
        }
      } else {
        // 未指定放置方式：移动到处理区，由玩家选择要装备的角色
        this.zoneMgr.moveCard(action.cardInstanceId, 'PROCESSING', { isFaceUp: true });
        enqueuePendingChoice(this.state, {
          id: `choice-equip-${action.cardInstanceId}-${this.events.length}`,
          playerId: action.playerId,
          choiceType: 'SELECT_CARDS',
          prompt: `装备卡【${cardDef.name}】已进入处理区，请选择要装备的角色：`,
          options: roleCards.map((c) => this.effectEngine.createRoleChoiceOption(c)),
          effectType: 'EQUIP_FROM_PROCESSING',
          sourceCardInstanceId: action.cardInstanceId,
          minSelections: 1,
          maxSelections: 1,
        });
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

    // 7.3.1.b / 6.5.1.a 轮流使用：使用【瞬时】后轮到另一位玩家，连续放弃计数重新开始
    if (options.isTimingWindow && this.state.timingWindow) {
      this.state.timingWindow.consecutivePasses = 0;
      this.state.timingWindow.priorityPlayerId = this.getOpponentId(action.playerId);
      this.state.priorityPlayerId = this.state.timingWindow.priorityPlayerId;
    }

    return { success: true };
  }

  /**
   * 8.11.3 检查能否以升变机制使用该卡牌 (支持战场 / 信号球区正面 / 浮空模式对象，及 BP01-040 额外叠放代价)
   */
  private validateAscensionPlan(
    playerId: string,
    cardDef: CardVersionData,
    targetCardId: string | undefined,
    targetSlotIndex?: number,
    extraAscensionCostCardId?: string
  ): { error?: string; extraStackRoleCardId?: string; bp01001GraveyardShuffleIds?: string[] } {
    const config = cardDef.ascensionConfig;
    if (!config) return { error: `【${cardDef.name}】没有升变机制 (8.11.1.a)` };
    if (config.unsupportedReason) return { error: `【${cardDef.name}】的升变机制${config.unsupportedReason}` };

    const target = targetCardId ? this.state.cards[targetCardId] : undefined;
    if (!target || target.controllerPlayerId !== playerId) {
      return { error: '升变对象不存在或不属于己方 (8.11.2.a.1)' };
    }

    const allowedZones = config.targetFilter.targetZones ?? ['BATTLEFIELD'];
    const inField = target.zone === 'BATTLEFIELD' && this.fieldMgr.isSlotRole(playerId, target.instanceId);
    const inOrbZone = target.zone === 'SIGNAL_ORB';
    const inAirborne = target.zone === 'PROCESSING' && target.isAirborne === true;

    let zoneValid = false;
    if (allowedZones.includes('BATTLEFIELD') && inField) {
      zoneValid = true;
    } else if (allowedZones.includes('SIGNAL_ORB') && inOrbZone) {
      if (!target.isFaceUp) {
        return { error: '信号球区中背面的卡牌不能作为升变对象 (Q&A·10)' };
      }
      if (
        (targetSlotIndex !== undefined &&
          (() => {
            const s = this.fieldMgr.getSlots(playerId)[targetSlotIndex];
            return !s || Boolean(s.roleCardId || s.standaloneEquipmentId || s.assistCardId);
          })()) ||
        (targetSlotIndex === undefined && this.fieldMgr.findFirstEmptySlot(playerId) === undefined)
      ) {
        return { error: '战场没有空余卡位供信号球区升变对象出场' };
      }
      zoneValid = true;
    } else if (allowedZones.includes('AIRBORNE') && inAirborne) {
      if (this.fieldMgr.findFirstEmptySlot(playerId) === undefined) {
        return { error: '战场没有空余卡位供浮空模式升变对象出场' };
      }
      zoneValid = true;
    }

    if (!zoneValid) {
      return { error: '升变对象不在合法的升变区域 (8.11.2.a.1)' };
    }

    const targetDef =
      this.cardDb.getCard(target.cardNumber) || (target.cardId ? this.cardDb.getCard(target.cardId) : undefined);
    if (!targetDef) return { error: '升变对象的卡牌数据不存在' };

    const tf = config.targetFilter;
    const normalize = (name: string) => name.replace(/\s+/g, '');
    if (
      tf.exactName &&
      normalize(targetDef.name) !== normalize(tf.exactName) &&
      !this.continuousEffects.hasCardName(target.instanceId, tf.exactName)
    ) {
      return { error: `升变对象必须是《${tf.exactName}》 (8.11.2.a.1)` };
    }
    if (tf.traits && !tf.traits.every((t) => this.continuousEffects.hasTrait(target.instanceId, t))) {
      return { error: `升变对象必须是<${tf.traits.join('、')}> (8.11.2.a.1)` };
    }
    if (tf.exactCost !== undefined && targetDef.cost !== tf.exactCost) {
      return { error: `升变对象的费用必须为 ${tf.exactCost} (8.11.2.a.1)` };
    }
    if (tf.maxCost !== undefined && targetDef.cost > tf.maxCost) {
      return { error: `升变对象的费用必须小于 ${tf.maxCost + 1} (8.11.2.a.1、10.12)` };
    }
    if (tf.requireReady && !target.isReady) {
      return { error: '升变对象必须为竖直状态 (8.11.2.a.1)' };
    }

    // 8.11.2.a.2 / 8.11.3.d 限制条件 (含 BP01-001 露西亚·鸦羽：墓地 10 张<灰鸦小队>洗回牌组可无视「费用上限8及以上」)
    let bp01001GraveyardShuffleIds: string[] | undefined;
    for (const condition of config.restrictionFilter?.conditions ?? []) {
      const error = this.checkAscensionRestriction(playerId, condition);
      if (error) {
        if (cardDef.cardNumber === 'BP01-001' && condition.kind === 'MIN_COST_LIMIT') {
          const grayRavensInGy = this.zoneMgr
            .getCardsInZone(playerId, 'GRAVEYARD')
            .filter((c) => this.continuousEffects.hasTrait(c.instanceId, '灰鸦小队'));
          if (grayRavensInGy.length >= 10) {
            bp01001GraveyardShuffleIds = grayRavensInGy.slice(0, 10).map((c) => c.instanceId);
            continue;
          }
        }
        return { error };
      }
    }

    // 8.11.3.c 额外升变代价 (如 BP01-040「将我方战场1张《帕瓦》放置到该牌下方」)
    let extraStackRoleCardId: string | undefined;
    if (config.extraCost?.kind === 'STACK_FIELD_ROLE_UNDERNEATH') {
      const reqName = config.extraCost.exactName;
      const candidates = this.fieldMgr
        .getSlots(playerId)
        .map((s) => (s.roleCardId ? this.state.cards[s.roleCardId] : undefined))
        .filter(
          (r): r is CardInstance =>
            Boolean(r) &&
            r!.instanceId !== target.instanceId &&
            this.continuousEffects.hasCardName(r!.instanceId, reqName)
        );
      if (extraAscensionCostCardId) {
        const explicit = candidates.find((c) => c.instanceId === extraAscensionCostCardId);
        if (!explicit) {
          return { error: `指定的额外升变代价卡牌不是我方战场可放置的《${reqName}》` };
        }
        extraStackRoleCardId = explicit.instanceId;
      } else {
        if (candidates.length === 0) {
          return { error: `升变代价不足：我方战场不存在可放置到下方的《${reqName}》` };
        }
        extraStackRoleCardId = candidates[0]!.instanceId;
      }
    }

    return { extraStackRoleCardId, bp01001GraveyardShuffleIds };
  }

  private checkAscensionRestriction(playerId: string, condition: AscensionRestriction): string | undefined {
    const costCards = this.zoneMgr.getCardsInZone(playerId, 'COST');
    switch (condition.kind) {
      case 'MIN_COST_LIMIT':
        return costCards.length >= condition.value
          ? undefined
          : `升变限制条件：费用上限需达到 ${condition.value} (当前 ${costCards.length}) (3.6.6)`;
      case 'MIN_OPEN_COST_LIMIT': {
        const openCount = costCards.filter((c) => c.isFaceUp).length;
        return openCount >= condition.value
          ? undefined
          : `升变限制条件：明费上限需达到 ${condition.value} (当前 ${openCount}) (3.6.6.a)`;
      }
      case 'MIN_ORB_ZONE_CARDS': {
        const orbZone = this.zoneMgr.getCardsInZone(playerId, 'SIGNAL_ORB').filter((c) => {
          if (!condition.cardName) return true;
          if (!c.isFaceUp) return false;
          const def = this.cardDb.getCard(c.cardNumber);
          return def?.name.replace(/\s+/g, '') === condition.cardName.replace(/\s+/g, '');
        });
        return orbZone.length >= condition.value
          ? undefined
          : `升变限制条件：信号球区的${condition.cardName ? `《${condition.cardName}》` : '牌'}需达到 ${condition.value} 张`;
      }
      case 'MAX_FIELD_ROLES': {
        const roleCount = this.fieldMgr.getSlots(playerId).filter((s) => s.roleCardId).length;
        return roleCount <= condition.value
          ? undefined
          : `升变限制条件：我方战场的角色需为 ${condition.value} 张及以下`;
      }
      case 'COST_ZONE_ROLES_ATTRIBUTE': {
        // 3.6.3.b.2 暗费不能被参照，只检查明费中的角色牌
        const allMatch = costCards
          .filter((c) => c.isFaceUp)
          .every((c) => {
            const def = this.cardDb.getCard(c.cardNumber);
            return def?.cardType !== CardType.ROLE || def.attribute === condition.attribute;
          });
        return allMatch ? undefined : '升变限制条件：费用区所有角色牌的属性不满足要求';
      }
    }
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

    // 2.5.2 卡牌文本若无特殊记述只在战场生效；支持声明式 usableZones (HAND/GRAVEYARD/COST/SIGNAL_ORB/UNDERNEATH)
    const isTopLevelOnField = this.fieldMgr.isTopLevelFieldCard(action.playerId, card.instanceId);
    const usableBySpec = this.effectEngine.presets.isCardInUsableZoneForActivation(
      action.playerId,
      card.instanceId,
      cardDef
    );
    const usableFromZone =
      usableBySpec ||
      (card.zone === 'HAND' && cardDef.rulesText.includes('丢弃手牌中的该牌')) ||
      (card.zone === 'GRAVEYARD' && cardDef.rulesText.includes('若该牌存在于墓地')) ||
      (card.zone === 'COST' && card.isFaceUp && cardDef.rulesText.includes('若该牌存在于费用区'));
    if (!isTopLevelOnField && !usableFromZone) {
      return { success: false, error: '该卡牌当前所在区域不能发动起动能力 (2.5.2)' };
    }
    if (isTopLevelOnField && this.continuousEffects.hasLostInherentAbilities(card.instanceId)) {
      return { success: false, error: `【${cardDef.name}】的能力当前处于无效状态，无法发动起动能力 (8.3.4)` };
    }

    const player = this.state.players[action.playerId]!;

    // 声明式起动能力：包含卡牌自身【起】及附着装备赋予的【起】(如 BP01-022 夜煌—小太刀)
    if (this.effectEngine.presets.handlesActivationForCard(action.playerId, card.instanceId, cardDef)) {
      const res = this.effectEngine.presets.activate(action.playerId, card.instanceId, cardDef, action.abilityIndex);
      if (res.success) {
        this.events.push({
          type: 'ABILITY_ACTIVATED',
          playerId: action.playerId,
          cardInstanceId: card.instanceId,
          abilityName: `${cardDef.name}【起】动能力`,
          rulesText: cardDef.rulesText,
        });
      }
      return res;
    }

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
      const ok = this.payCost(action.playerId, cost, action.costCardInstanceIds);
      if (!ok) {
        return { success: false, error: `费用不足或自选支付无效，需要 ${cost} 费` };
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
      this.zoneMgr.setCardReady(card.instanceId, false);
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

    // 8.5.1.c/d & 8.7.3.a 玩家自选待机自动能力的发动顺序
    if (choice.effectType === 'CHOOSE_TRIGGER_ORDER') {
      this.state.currentPendingChoice = undefined;
      const res = this.checkTimingMgr.resolveTriggerOrderChoice(action.playerId, action.selectedIds[0]!);
      if (res.success && !this.state.currentPendingChoice) {
        advancePendingChoice(this.state);
      }
      return res;
    }

    // 6.5.1.c 结束阶段弃牌
    if (choice.effectType === 'END_PHASE_DISCARD') {
      for (const id of action.selectedIds) {
        const card = this.state.cards[id];
        if (!card || card.zone !== 'HAND' || card.controllerPlayerId !== action.playerId) {
          return { success: false, error: '只能选择自己的手牌' };
        }
        this.zoneMgr.moveCard(id, 'GRAVEYARD', { isFaceUp: true });
      }
      this.state.endPhaseStep = 'CLEANUP';
      this.state.currentPendingChoice = undefined;
      advancePendingChoice(this.state);
      return { success: true };
    }

    // BP01-017 露西亚·深红囚影：可选离场置换（送墓<小太刀>和<大太刀>改为不离场，或放弃置换让其离场）
    if (choice.effectType === 'BP01_017_OPTIONAL_LEAVE_REPLACEMENT') {
      const meta = (choice.metadata ?? {}) as {
        cardInstanceId?: string;
        smallId?: string;
        largeId?: string;
        originalEvent?:
          | {
              type: 'DESTROY_ROLE';
              reason: 'BATTLE' | 'EFFECT' | 'PP_ZERO';
              attackerCardId?: string;
              combatCannotDealDamage?: boolean;
            }
          | {
              type: 'MOVE_CARD';
              toZone: CardInstance['zone'];
              isFaceUp?: boolean;
              isReady?: boolean;
              toBottom?: boolean;
              sentByEffectOrCost?: boolean;
            };
      };
      this.state.currentPendingChoice = undefined;
      const picked = action.selectedIds[0];
      const card = meta.cardInstanceId ? this.state.cards[meta.cardInstanceId] : undefined;
      if (card && card.zone === 'BATTLEFIELD') {
        if (picked === 'replace' && meta.smallId && meta.largeId) {
          const eqIds = getAttachedEquipmentIds(card);
          if (eqIds.includes(meta.smallId) && eqIds.includes(meta.largeId)) {
            const remain = eqIds.filter((id) => id !== meta.smallId && id !== meta.largeId);
            card.attachedEquipmentId = remain[0];
            card.extraAttachedEquipmentIds = remain.length > 1 ? remain.slice(1) : undefined;
            this.zoneMgr.moveCard(meta.smallId, 'GRAVEYARD', { isFaceUp: true });
            this.zoneMgr.moveCard(meta.largeId, 'GRAVEYARD', { isFaceUp: true });
          }
        } else if (meta.originalEvent) {
          const skipSelf = new Set<string>(['builtin:BP01-017_LEAVE_REPLACEMENT']);
          if (meta.originalEvent.type === 'DESTROY_ROLE') {
            const snapshot = this.triggerMgr.snapshotCard(card.instanceId);
            const moved = this.zoneMgr.moveCard(card.instanceId, 'GRAVEYARD', {
              isFaceUp: true,
              appliedReplacementIds: skipSelf,
            });
            if (moved) {
              this.events.push({
                type: 'CARD_DESTROYED',
                cardInstanceId: card.instanceId,
                reason: meta.originalEvent.reason,
              });
              this.triggerMgr.emit({
                type: 'CARD_DESTROYED',
                playerId: card.controllerPlayerId,
                cardInstanceId: card.instanceId,
                destroyReason: meta.originalEvent.reason,
                subjectSnapshot: snapshot,
              });
              if (
                meta.originalEvent.reason === 'BATTLE' &&
                meta.originalEvent.attackerCardId &&
                !meta.originalEvent.combatCannotDealDamage
              ) {
                const atkId = meta.originalEvent.attackerCardId;
                const cannotDeal = this.continuousEffects.hasProhibition(atkId, 'CANNOT_DEAL_DAMAGE');
                if (!cannotDeal && this.continuousEffects.hasKeyword(atkId, '贯通')) {
                  this.zoneMgr.applyDamageToPlayer(
                    card.controllerPlayerId,
                    RULE_CONSTANTS.PIERCING_DAMAGE_VALUE,
                    atkId
                  );
                }
              }
            }
          } else {
            this.zoneMgr.moveCard(card.instanceId, meta.originalEvent.toZone, {
              isFaceUp: meta.originalEvent.isFaceUp,
              isReady: meta.originalEvent.isReady,
              toBottom: meta.originalEvent.toBottom,
              sentByEffectOrCost: meta.originalEvent.sentByEffectOrCost,
              appliedReplacementIds: skipSelf,
            });
          }
        }
      }
      if (!this.state.currentPendingChoice) {
        advancePendingChoice(this.state);
      }
      return { success: true };
    }

    // BP01-037 万世铭 / BP01-038 万世铭·重铸：因<曲>角色攻击充能进入处理区时的可选置换
    if (choice.effectType === 'BP01_WANSHIMING_TO_COST') {
      const meta = (choice.metadata ?? {}) as { cardInstanceId?: string; attackerCardId?: string };
      this.state.currentPendingChoice = undefined;
      const picked = action.selectedIds[0];
      if (meta.cardInstanceId) {
        const card = this.state.cards[meta.cardInstanceId];
        if (picked === 'to_cost' && card && card.zone === 'PROCESSING') {
          // 8.10.1.a / 3.6.4：改为以横置状态放置到费用区（费用区满 10 张时自动改放墓地）
          this.zoneMgr.moveCard(card.instanceId, 'COST', { isFaceUp: true, isReady: false });
          this.zoneMgr.syncCostStats(card.controllerPlayerId);
        } else if (card && card.zone === 'PROCESSING') {
          // 选择不置换：发出正常攻击充能事件 (供 BP01-028 模式3 等触发)
          this.triggerMgr.emit({
            type: 'CARD_CHARGED',
            playerId: action.playerId,
            cardInstanceId: card.instanceId,
            targetCardId: meta.attackerCardId,
            chargeKind: 'ATTACK',
            subjectSnapshot: this.triggerMgr.snapshotCard(card.instanceId),
          });
        }
      }
      if (!this.state.currentPendingChoice) {
        advancePendingChoice(this.state);
      }
      return { success: true };
    }

    // BP01-067 / PR-031 / BP02-012 / BP04-060 等使用卡牌附加代价与特异减费结算
    if (choice.effectType === 'PR031_ATTACK_PAY_ORB') {
      const meta = (choice.metadata ?? {}) as {
        attackerCardId: string;
        targetType: 'PLAYER' | 'CHARACTER';
        targetCardId?: string;
      };
      const pickedOrbId = action.selectedIds[0];
      const pickedCard = pickedOrbId ? this.state.cards[pickedOrbId] : undefined;
      if (!pickedCard || pickedCard.zone !== 'HAND' || pickedCard.controllerPlayerId !== action.playerId) {
        return { success: false, error: '所选雷属性卡牌已不在手牌中' };
      }
      this.zoneMgr.insertCardIntoZoneAtIndex(pickedOrbId!, 'SIGNAL_ORB', 0, {
        isFaceUp: false,
        isReady: true,
      });
      this.state.currentPendingChoice = undefined;
      const res = this.combatMgr.finalizeDeclaredAttack(
        action.playerId,
        meta.attackerCardId,
        meta.targetType,
        meta.targetCardId
      );
      if (res.success && !this.state.currentPendingChoice) {
        advancePendingChoice(this.state);
      }
      return res;
    }

    if (choice.effectType === 'PLAY_CARD_SACRIFICE_DISCOUNT') {
      const meta = (choice.metadata ?? {}) as {
        cardInstanceId: string;
        baseCostToPay: number;
        sacrificedCostMode: 'SET' | 'DELTA';
        sacrificedCostValue: number;
        isAscension?: boolean;
        targetAscensionCardId?: string;
        targetSlotIndex?: number;
        extraStackRoleCardId?: string;
        bp01001GraveyardShuffleIds?: string[];
        appliedModifierIds?: string[];
        isTimingWindow?: boolean;
      };
      const player = this.state.players[action.playerId]!;
      const card = this.state.cards[meta.cardInstanceId];
      const cardDef = card
        ? this.cardDb.getCard(card.cardNumber) || (card.cardId ? this.cardDb.getCard(card.cardId) : undefined)
        : undefined;
      if (!card || !cardDef) {
        return { success: false, error: '待使用的卡牌不存在' };
      }
      let finalCost = meta.baseCostToPay;
      if (action.selectedIds.length > 0) {
        for (const sid of action.selectedIds) {
          const sc = this.state.cards[sid];
          if (sc) {
            const fromField = sc.zone === 'BATTLEFIELD';
            this.zoneMgr.moveCard(sid, 'GRAVEYARD', {
              isFaceUp: true,
              sentByEffectOrCost: fromField,
            });
          }
        }
        finalCost =
          meta.sacrificedCostMode === 'SET'
            ? Math.max(0, meta.sacrificedCostValue)
            : Math.max(0, meta.baseCostToPay - meta.sacrificedCostValue);
      }
      if (!this.payCost(action.playerId, finalCost)) {
        const avail = player.availableOpenCostCount + player.hiddenCostCount;
        return { success: false, error: `费用不足，需要 ${finalCost} 费，当前可用 ${avail}` };
      }
      const paidHidden = this.lastPayCostHiddenCount > 0;
      const appliedModifiers = (player.costModifiers ?? []).filter((m) =>
        (meta.appliedModifierIds ?? []).includes(m.id)
      );
      this.state.currentPendingChoice = undefined;
      const res = this.completePlayCardDeployment(
        {
          type: 'PLAY_CARD',
          playerId: action.playerId,
          cardInstanceId: meta.cardInstanceId,
          isAscension: meta.isAscension,
          targetAscensionCardId: meta.targetAscensionCardId,
          targetSlotIndex: meta.targetSlotIndex,
        },
        card,
        cardDef,
        {
          appliedModifiers,
          paidHiddenCost: paidHidden,
          extraStackRoleCardId: meta.extraStackRoleCardId,
          bp01001GraveyardShuffleIds: meta.bp01001GraveyardShuffleIds,
          isTimingWindow: Boolean(meta.isTimingWindow),
        }
      );
      if (res.success && !this.state.currentPendingChoice) {
        advancePendingChoice(this.state);
      }
      return res;
    }

    if (choice.effectType === 'PLAY_CARD_DISCARD_DISCOUNT') {
      const meta = (choice.metadata ?? {}) as {
        cardInstanceId: string;
        baseCostToPay: number;
        discountPerCard: number;
        appliedModifierIds?: string[];
        isTimingWindow?: boolean;
      };
      const player = this.state.players[action.playerId]!;
      const card = this.state.cards[meta.cardInstanceId];
      const cardDef = card
        ? this.cardDb.getCard(card.cardNumber) || (card.cardId ? this.cardDb.getCard(card.cardId) : undefined)
        : undefined;
      if (!card || !cardDef) {
        return { success: false, error: '待使用的卡牌不存在' };
      }
      for (const id of action.selectedIds) {
        this.zoneMgr.moveCard(id, 'GRAVEYARD', { isFaceUp: true });
      }
      const finalCost = Math.max(0, meta.baseCostToPay - action.selectedIds.length * meta.discountPerCard);
      if (!this.payCost(action.playerId, finalCost)) {
        const avail = player.availableOpenCostCount + player.hiddenCostCount;
        return { success: false, error: `费用不足，需要 ${finalCost} 费，当前可用 ${avail}` };
      }
      const paidHidden = this.lastPayCostHiddenCount > 0;
      const appliedModifiers = (player.costModifiers ?? []).filter((m) =>
        (meta.appliedModifierIds ?? []).includes(m.id)
      );
      this.state.currentPendingChoice = undefined;
      const res = this.completePlayCardDeployment(
        {
          type: 'PLAY_CARD',
          playerId: action.playerId,
          cardInstanceId: meta.cardInstanceId,
        },
        card,
        cardDef,
        {
          appliedModifiers,
          paidHiddenCost: paidHidden,
          isTimingWindow: Boolean(meta.isTimingWindow),
        }
      );
      if (res.success && !this.state.currentPendingChoice) {
        advancePendingChoice(this.state);
      }
      return res;
    }

    // 先摘下当前决策再结算：结算中产生的后续决策直接成为当前决策，排队中的决策随后进行
    this.state.currentPendingChoice = undefined;
    const result = this.effectEngine.handleChoiceResolution(action, choice);
    if (result.success && !this.state.currentPendingChoice) {
      advancePendingChoice(this.state);
    }
    return result;
  }

  /**
   * 选择不行动 (4.5.3.b)：含义取决于当前时机
   */
  private handlePass(playerId: string): { success: boolean; error?: string } {
    const state = this.state;
    if (state.phase === 'MULLIGAN_PHASE') {
      // 5.2.1.e 在调度阶段 Pass 等同于保留全部手牌
      return this.handleResolveMulligan({ type: 'RESOLVE_MULLIGAN', playerId, cardInstanceIdsToBottom: [] });
    }
    if (state.timingWindow) {
      // 7.3.1.b / 6.5.1.a 选择不使用【瞬时】
      if (state.timingWindow.priorityPlayerId !== playerId) {
        return { success: false, error: '现在轮到对方选择是否使用【瞬时】' };
      }
      this.passTimingWindow();
      return { success: true };
    }
    if (state.phase === 'COMBAT_FREE_TIMING' && state.currentCombat?.step === 'BLOCK') {
      // 7.3.1.c 被攻击玩家选择不阻挡
      if (playerId !== state.nonActivePlayerId) {
        return { success: false, error: '必须等待被攻击玩家选择是否阻挡 (7.3.1.c)' };
      }
      return this.combatMgr.declareBlock(playerId, undefined);
    }
    if (playerId !== state.activePlayerId) {
      return { success: false, error: '现在不是你的行动时机' };
    }
    if (state.phase === 'MAIN_PHASE' && !state.currentCombat) {
      // 6.4.1.c 回合玩家选择不再执行行动，进入结束阶段
      this.phaseMachine.startEndPhase();
      return { success: true };
    }
    if (state.phase === 'DRAW_CHARGE_PHASE') {
      // 6.3.1.c 不放置明费，进入主要阶段
      this.phaseMachine.chargeCostFromHand(playerId, undefined);
      return { success: true };
    }
    return { success: false, error: '当前时机不能选择不行动' };
  }

  /**
   * 持有优先权的玩家选择不使用【瞬时】：轮到另一位玩家；双方连续不使用时结束该时机
   */
  private passTimingWindow(): void {
    const window = this.state.timingWindow;
    if (!window) return;
    window.consecutivePasses += 1;
    if (window.consecutivePasses >= 2) {
      this.state.timingWindow = undefined;
      return;
    }
    window.priorityPlayerId = this.getOpponentId(window.priorityPlayerId);
    this.state.priorityPlayerId = window.priorityPlayerId;
  }

  /**
   * 8.6.2.e.3 战术牌的效果处理完毕后放置到所属玩家的墓地。没有待处理的决策、也没有正在充能的卡牌时，
   * 处理区中不应残留战术牌 (兜底，避免个别效果分支遗漏送墓)
   */
  private sweepResolvedTactics(): void {
    if (this.state.currentPendingChoice) return;
    const combat = this.state.currentCombat;
    for (const card of Object.values(this.state.cards)) {
      if (card.zone !== 'PROCESSING') continue;
      if (card.isAirborne) continue; // 10.18.2 浮空模式卡牌驻留处理区直到下回合开始
      if (
        Object.values(this.state.cards).some(
          (host) =>
            host.isAirborne &&
            (host.underneathCardIds.includes(card.instanceId) || getAttachedEquipmentIds(host).includes(card.instanceId))
        )
      ) {
        continue;
      }
      if (card.instanceId === combat?.pendingChargeCardId || card.instanceId === combat?.pendingDamageCardId) continue;
      const def = this.cardDb.getCard(card.cardNumber);
      if (def?.cardType === CardType.TACTICS) {
        this.zoneMgr.moveCard(card.instanceId, 'GRAVEYARD', { isFaceUp: true });
      }
    }
  }

  /**
   * 将战场角色当前的 PP/DP、关键字、特征、禁止标志与信号球有效颜色写入状态，供前端直接展示
   * (前端不重复实现装备、8.9 持续效果层与永久能力的计算)
   */
  private refreshDisplayedStats(): void {
    for (const card of Object.values(this.state.cards)) {
      if (card.zone === 'BATTLEFIELD' && this.fieldMgr.isSlotRole(card.controllerPlayerId, card.instanceId)) {
        const evaluated = this.fieldMgr.evaluateRoleStats(card.instanceId);
        card.effectivePP = evaluated.pp;
        card.effectiveDP = evaluated.dp;
        card.effectiveKeywords = evaluated.keywords;
        card.effectiveTraits = evaluated.traits;
        if (evaluated.prohibitions.length > 0) {
          card.effectiveProhibitions = evaluated.prohibitions;
        } else {
          delete card.effectiveProhibitions;
        }
        delete card.effectiveOrbColors;
        delete card.effectiveOrbValue;
      } else if (card.zone === 'SIGNAL_ORB' && card.isFaceUp) {
        delete card.effectivePP;
        delete card.effectiveDP;
        delete card.effectiveKeywords;
        delete card.effectiveTraits;
        const orbInfo = this.continuousEffects.getEffectiveOrbInfo(card.instanceId);
        if (orbInfo.colors.length > 0) {
          card.effectiveOrbColors = orbInfo.colors;
        } else {
          delete card.effectiveOrbColors;
        }
        if (orbInfo.isOrb && orbInfo.orbValue > 0) {
          card.effectiveOrbValue = orbInfo.orbValue;
        } else {
          delete card.effectiveOrbValue;
        }
        if (orbInfo.cannotEliminate) {
          card.effectiveProhibitions = ['CANNOT_ELIMINATE'];
        } else {
          delete card.effectiveProhibitions;
        }
      } else {
        if (card.effectivePP !== undefined) delete card.effectivePP;
        if (card.effectiveDP !== undefined) delete card.effectiveDP;
        if (card.effectiveKeywords !== undefined) delete card.effectiveKeywords;
        if (card.effectiveTraits !== undefined) delete card.effectiveTraits;
        if (card.effectiveOrbColors !== undefined) delete card.effectiveOrbColors;
        if (card.effectiveOrbValue !== undefined) delete card.effectiveOrbValue;
        if (
          card.zone === 'COST' &&
          this.continuousEffects.hasProhibition(card.instanceId, 'CANNOT_DISCARD_HIDDEN_COST_AT_END')
        ) {
          card.effectiveProhibitions = ['CANNOT_DISCARD_HIDDEN_COST_AT_END'];
        } else if (card.effectiveProhibitions !== undefined) {
          delete card.effectiveProhibitions;
        }
      }
    }
  }

  private getOpponentId(playerId: string): string {
    return playerId === this.state.activePlayerId ? this.state.nonActivePlayerId : this.state.activePlayerId;
  }

  /**
   * 推进不需要玩家行动的流程 (检查时机、攻击流程各步骤、结束阶段各步骤、无可用瞬时时自动放弃)，
   * 直到需要玩家行动或决策为止
   */
  private continueFlow(): void {
    for (let guard = 0; guard < 1000; guard++) {
      if (this.state.status === 'FINISHED' || this.state.currentPendingChoice) return;

      // 8.6.2.e.4 战术牌结算完毕送入墓地后再进入检查时机
      this.sweepResolvedTactics();

      // 8.5.1 推进检查时机 (SBA + 待机自动能力队列)；若产生待机顺序或效果选择则暂停
      if (!this.checkTimingMgr.resolveCheckTiming()) return;
      if ((this.state.status as string) === 'FINISHED' || this.state.currentPendingChoice) return;

      const window = this.state.timingWindow;
      if (window) {
        if (this.hasUsableInstant(window.priorityPlayerId)) return;
        // 没有任何可以使用的【瞬时】时自动选择不使用
        this.passTimingWindow();
        continue;
      }

      if (this.state.currentCombat) {
        if (!this.combatMgr.advance()) return;
        continue;
      }

      if (this.state.phase === 'END_PHASE') {
        if (!this.advanceEndPhase()) return;
        continue;
      }
      return;
    }
    throw new Error('流程推进超过上限，可能存在循环');
  }

  /**
   * 6.5.1 结束阶段：瞬时 (6.5.1.a) → 回合结束时 (6.5.1.b) → 手牌弃至上限 (6.5.1.c) → 清理与回合交接 (6.5.1.d/e)
   */
  private advanceEndPhase(): boolean {
    switch (this.state.endPhaseStep) {
      case 'INSTANTS':
        // 6.5.1.b「回合结束时」的触发条件生效 (含 8.7.5 时限触发)，进入检查时机
        this.state.endPhaseStep = 'TRIGGERS';
        this.triggerMgr.emit({
          type: 'END_PHASE_TRIGGERS',
          playerId: this.state.activePlayerId,
        });
        this.checkTimingMgr.resolveCheckTiming();
        return true;
      case 'TRIGGERS': {
        this.state.endPhaseStep = 'DISCARD';
        const overflow = this.phaseMachine.getHandOverflow();
        if (overflow > 0) {
          const hand = this.zoneMgr.getCardsInZone(this.state.activePlayerId, 'HAND');
          enqueuePendingChoice(this.state, {
            id: `choice-end-discard-${this.state.turnNumber}`,
            playerId: this.state.activePlayerId,
            choiceType: 'SELECT_CARDS',
            prompt: `回合结束：手牌超过上限 ${RULE_CONSTANTS.MAX_HAND_SIZE_END_PHASE} 张，请选择 ${overflow} 张手牌放置到墓地 (6.5.1.c)`,
            options: hand.map((c) => this.effectEngine.createGeneralCardChoiceOption(c)),
            effectType: 'END_PHASE_DISCARD',
            minSelections: overflow,
            maxSelections: overflow,
          });
        } else {
          this.state.endPhaseStep = 'CLEANUP';
        }
        return true;
      }
      case 'DISCARD':
        return false; // 等待回合玩家选择弃掉的手牌
      case 'CLEANUP':
        this.phaseMachine.finishEndPhase();
        return true;
      default:
        return false;
    }
  }

  /**
   * 玩家当前是否持有可以使用的【瞬时】、非战术【瞬时】能力或 8.13 协战能力
   */
  private hasUsableInstant(playerId: string): boolean {
    const player = this.state.players[playerId];
    const costCards = this.zoneMgr.getCardsInZone(playerId, 'COST');
    const payable = costCards.filter((c) => !c.isFaceUp || c.isReady).length;
    const openAttributes = new Set(
      costCards.filter((c) => c.isFaceUp).map((c) => this.cardDb.getCard(c.cardNumber)?.attribute)
    );
    const canUseInstantTacticsCard = (card: CardInstance): boolean => {
      const def = this.cardDb.getCard(card.cardNumber);
      if (!def || !isInstantTactics(def)) return false;
      const spec = this.effectEngine.presets.getSpec(def.cardNumber);
      if (
        spec?.maxPlaysPerTurnByName !== undefined &&
        (player?.turnCardPlayedCountByName?.[def.name] ?? 0) >= spec.maxPlaysPerTurnByName
      ) {
        return false;
      }
      if (
        def.attribute !== ElementAttribute.NONE &&
        !openAttributes.has(def.attribute) &&
        !this.effectEngine.presets.canIgnoreAttributeCondition(playerId, def.cardNumber) &&
        !this.effectEngine.presets.canPlayerIgnoreAttributeForPlay(playerId, card.instanceId, def, false)
      ) {
        return false;
      }
      if (this.calculateCardCost(playerId, card.instanceId).costToPay > payable) return false;
      return !this.checkInstantTiming(playerId, def);
    };
    const hasHandInstantTactics = this.zoneMgr
      .getCardsInZone(playerId, 'HAND')
      .some(canUseInstantTacticsCard);
    if (hasHandInstantTactics) return true;

    const hasGraveyardInstantTactics = this.zoneMgr
      .getCardsInZone(playerId, 'GRAVEYARD')
      .some(
        (c) =>
          Boolean(this.effectEngine.presets.getSpec(c.cardNumber)?.playFromZones?.includes('GRAVEYARD')) &&
          canUseInstantTacticsCard(c)
      );
    if (hasGraveyardInstantTactics) return true;

    const hasUnderneathInstantTactics = this.fieldMgr.getSlots(playerId).some((s) => {
      const role = s.roleCardId ? this.state.cards[s.roleCardId] : undefined;
      if (!role || !this.continuousEffects.hasCardName(role.instanceId, '露娜·终焉')) return false;
      return role.underneathCardIds.some((uid) => {
        const uCard = this.state.cards[uid];
        return (
          Boolean(uCard) &&
          Boolean(this.effectEngine.presets.getSpec(uCard!.cardNumber)?.playFromZones?.includes('UNDERNEATH')) &&
          canUseInstantTacticsCard(uCard!)
        );
      });
    });
    if (hasUnderneathInstantTactics) return true;

    // 10.8 角色与装备上的【瞬时】能力 (COST / BATTLEFIELD 下方 / HAND)
    const hasNonTacticsInstant = Object.values(this.state.cards).some((card) => {
      if (card.controllerPlayerId !== playerId) return false;
      const def = this.cardDb.getCard(card.cardNumber);
      if (!def || def.cardType === CardType.TACTICS) return false;
      return this.effectEngine.canUseNonTacticsInstant(playerId, card, def).usable;
    });
    if (hasNonTacticsInstant) return true;

    // 8.13.3.a 自由时点步骤检查是否可发动协战
    if (this.state.phase === 'COMBAT_FREE_TIMING' && this.state.timingWindow?.kind === 'FREE_TIMING') {
      return this.hasUsableAssist(playerId);
    }
    return false;
  }

  private resolveAssistCostOptions(
    host: CardInstance,
    hostDef: CardVersionData,
    partner: CardInstance
  ) {
    const partnerZone = partner.zone;
    const options = (hostDef.assistConfig?.costOptions ?? []).filter((o) => o.zone === partnerZone);
    // ST06-010 阿斯特莉亚：装备给《亚里莎·回音》时允许从墓地支付 2 费选择协战搭档
    if (
      partnerZone === 'GRAVEYARD' &&
      host.attachedEquipmentId &&
      this.state.cards[host.attachedEquipmentId]?.cardNumber === 'ST06-010' &&
      !this.continuousEffects.hasLostInherentAbilities(host.attachedEquipmentId) &&
      !this.continuousEffects.hasProhibition(host.instanceId, 'CANNOT_GAIN_ABILITIES') &&
      this.continuousEffects.hasCardName(host.instanceId, '亚里莎·回音') &&
      !options.some((o) => o.zone === 'GRAVEYARD')
    ) {
      options.push({ zone: 'GRAVEYARD', costAmount: 2 });
    }
    // ST06-001 坠落与新生 亚里莎·回音【永】：我方回合选择手牌《坠落与新生 塞西莉》时，协战代价可变为【2任意信号球】
    if (
      partnerZone === 'HAND' &&
      host.cardNumber === 'ST06-001' &&
      this.state.activePlayerId === host.controllerPlayerId &&
      !this.continuousEffects.hasLostInherentAbilities(host.instanceId) &&
      this.continuousEffects.hasCardName(partner.instanceId, '坠落与新生 塞西莉')
    ) {
      options.push({ zone: 'HAND', costAmount: 0, eliminateOrbs: { filter: 'ANY', count: 2 } });
    }
    // BP04-023 / BP04-024 / BP04-025 渡边·尘铭【永】：若该回合中我方角色被破坏，可从墓地协战搭档 (解除时置牌组底)
    if (
      partnerZone === 'GRAVEYARD' &&
      (host.cardNumber === 'BP04-023' || host.cardNumber === 'BP04-024' || host.cardNumber === 'BP04-025') &&
      !this.continuousEffects.hasLostInherentAbilities(host.instanceId) &&
      (this.state.players[host.controllerPlayerId]?.destroyedFriendlyRoleCountThisTurn ?? 0) > 0
    ) {
      if (host.cardNumber === 'BP04-023') {
        options.push({ zone: 'GRAVEYARD', costAmount: 0 });
      } else {
        options.push({ zone: 'GRAVEYARD', costAmount: 0, eliminateOrbs: { filter: 'ANY', count: 1 } });
      }
    }
    return options;
  }

  private findEligibleAssistOrbIds(
    playerId: string,
    req: { filter: 'ANY' | 'SAME' | 'RED' | 'BLUE' | 'YELLOW'; count: number }
  ): string[] | undefined {
    const orbs = this.zoneMgr.getCardsInZone(playerId, 'SIGNAL_ORB');
    const infos = orbs.map((c) => this.continuousEffects.getEffectiveOrbInfo(c.instanceId));
    for (let start = 0; start < orbs.length; start++) {
      let sum = 0;
      let commonColors: string[] | undefined;
      const ids: string[] = [];
      for (let end = start; end < orbs.length; end++) {
        const info = infos[end]!;
        if (!info.isOrb || info.cannotEliminate || info.orbValue <= 0) break;
        if (req.filter !== 'ANY' && req.filter !== 'SAME' && !info.colors.includes(req.filter)) break;
        if (req.filter === 'SAME') {
          commonColors =
            commonColors === undefined
              ? [...info.colors]
              : commonColors.filter((col) => info.colors.includes(col as 'RED' | 'BLUE' | 'YELLOW'));
          if (commonColors.length === 0) break;
        }
        sum += info.orbValue;
        ids.push(orbs[end]!.instanceId);
        if (sum === req.count) return ids;
        if (sum > req.count) break;
      }
    }
    return undefined;
  }

  private matchesAssistPartnerFilter(
    playerId: string,
    host: CardInstance,
    hostDef: CardVersionData,
    partner: CardInstance
  ): boolean {
    if (partner.controllerPlayerId !== playerId || partner.instanceId === host.instanceId) return false;
    if (partner.partnerOfCardId) return false;
    const combat = this.state.currentCombat;
    if (partner.zone === 'BATTLEFIELD') {
      if (!this.fieldMgr.isSlotRole(playerId, partner.instanceId)) return false;
      // 8.13.3.b.4 不能选择攻击中或被攻击/阻挡中的角色
      if (
        combat &&
        (partner.instanceId === combat.attackerCardId ||
          partner.instanceId === combat.targetCardId ||
          partner.instanceId === combat.blockerCardId)
      ) {
        return false;
      }
    }
    const filter = hostDef.assistConfig?.partnerFilter;
    if (!filter) return false;
    const partnerDef = this.cardDb.getCard(partner.cardNumber);
    if (!partnerDef) return false;
    if (filter.traits && filter.traits.length > 0) {
      const hasAnyTrait = filter.traits.some((t) => this.continuousEffects.hasTrait(partner.instanceId, t));
      if (!hasAnyTrait) return false;
    }
    if (filter.maxCost !== undefined) {
      const effCost =
        partner.zone === 'BATTLEFIELD' && partner.partnerCardId
          ? this.continuousEffects.getEffectiveCardCost(partner.instanceId)
          : partnerDef.cost;
      if (effCost > filter.maxCost) return false;
    }
    return this.resolveAssistCostOptions(host, hostDef, partner).length > 0;
  }

  private hasUsableAssist(playerId: string): boolean {
    const player = this.state.players[playerId];
    if (!player) return false;
    const availCost = player.availableOpenCostCount + player.hiddenCostCount;
    for (const slot of this.fieldMgr.getSlots(playerId)) {
      if (!slot.roleCardId) continue;
      const host = this.state.cards[slot.roleCardId];
      const hostDef = host ? this.cardDb.getCard(host.cardNumber) : undefined;
      if (!host || !hostDef?.assistConfig) continue;
      if ((player.turnAbilityUsage[`${host.instanceId}:ASSIST`] ?? 0) > 0) continue;
      for (const candidate of Object.values(this.state.cards)) {
        if (!this.matchesAssistPartnerFilter(playerId, host, hostDef, candidate)) continue;
        const costOpts = this.resolveAssistCostOptions(host, hostDef, candidate);
        const anyPayable = costOpts.some(
          (opt) =>
            opt.costAmount <= availCost &&
            (!opt.eliminateOrbs || Boolean(this.findEligibleAssistOrbIds(playerId, opt.eliminateOrbs)))
        );
        if (anyPayable) return true;
      }
    }
    return false;
  }

  /**
   * 8.13.3 自由时点步骤执行协战机制 (PERFORM_ASSIST)
   */
  private handlePerformAssist(action: Extract<GameAction, { type: 'PERFORM_ASSIST' }>): {
    success: boolean;
    error?: string;
  } {
    const window = this.state.timingWindow;
    if (
      this.state.phase !== 'COMBAT_FREE_TIMING' ||
      !window ||
      window.kind !== 'FREE_TIMING' ||
      window.priorityPlayerId !== action.playerId
    ) {
      return { success: false, error: '只能在自由时点步骤且持有优先权时使用协战机制 (8.13.3.a)' };
    }

    const host = this.state.cards[action.hostRoleCardId];
    const partner = this.state.cards[action.partnerCardId];
    const hostDef = host ? this.cardDb.getCard(host.cardNumber) : undefined;
    if (!host || !this.fieldMgr.isSlotRole(action.playerId, host.instanceId) || !hostDef?.assistConfig) {
      return { success: false, error: '指定角色不具备协战机制 (8.13.1)' };
    }

    const player = this.state.players[action.playerId]!;
    if ((player.turnAbilityUsage[`${host.instanceId}:ASSIST`] ?? 0) > 0) {
      return { success: false, error: '每个回合中每张角色通过协战机制最多获得 1 张搭档 (8.13.3.b.1)' };
    }
    if (!partner || !this.matchesAssistPartnerFilter(action.playerId, host, hostDef, partner)) {
      return { success: false, error: '指定的卡牌不满足协战搭档条件或处于交战中 (8.13.2.a / 8.13.3.b.4)' };
    }

    const costOpts = this.resolveAssistCostOptions(host, hostDef, partner);
    if (costOpts.length === 0) {
      return { success: false, error: '搭档所在区域不符合协战代价要求 (8.13.2.b.2)' };
    }

    const availCost = player.availableOpenCostCount + player.hiddenCostCount;
    let costOpt = costOpts[0]!;
    if (costOpts.length > 1) {
      if (action.orbCardInstanceIds && action.orbCardInstanceIds.length > 0) {
        costOpt = costOpts.find((o) => Boolean(o.eliminateOrbs)) ?? costOpt;
      } else if (action.costCardInstanceIds && action.costCardInstanceIds.length > 0) {
        costOpt = costOpts.find((o) => o.costAmount > 0) ?? costOpt;
      } else {
        costOpt =
          costOpts.find(
            (o) =>
              o.costAmount <= availCost &&
              (!o.eliminateOrbs || Boolean(this.findEligibleAssistOrbIds(action.playerId, o.eliminateOrbs)))
          ) ?? costOpt;
      }
    }

    const partnerFromZone = partner.zone;

    // 8.13.3.c 支付协战代价 (费用 / 信号球消除)
    if (costOpt.costAmount > 0) {
      if (!this.payCost(action.playerId, costOpt.costAmount, action.costCardInstanceIds)) {
        return { success: false, error: `协战代价不足，需要 ${costOpt.costAmount} 费 (8.13.3.c)` };
      }
    }
    if (costOpt.eliminateOrbs) {
      const req = costOpt.eliminateOrbs;
      let orbIds: string[] | undefined;
      if (action.orbCardInstanceIds && action.orbCardInstanceIds.length > 0) {
        const zoneOrbs = this.zoneMgr.getCardsInZone(action.playerId, 'SIGNAL_ORB').map((c) => c.instanceId);
        const positions = action.orbCardInstanceIds.map((id) => zoneOrbs.indexOf(id)).sort((a, b) => a - b);
        const adjacent = positions.every((p, idx) => p >= 0 && (idx === 0 || p === positions[idx - 1]! + 1));
        if (!adjacent || new Set(action.orbCardInstanceIds).size !== action.orbCardInstanceIds.length) {
          return { success: false, error: '协战消球代价必须选择自身信号球区相邻的不同信号球' };
        }
        let sum = 0;
        const colors: string[] = [];
        for (const oid of action.orbCardInstanceIds) {
          const info = this.continuousEffects.getEffectiveOrbInfo(oid);
          if (!info.isOrb || info.cannotEliminate) {
            return { success: false, error: '所选信号球无法被消除' };
          }
          if (req.filter !== 'ANY' && req.filter !== 'SAME' && !info.colors.includes(req.filter)) {
            return { success: false, error: '所选信号球颜色不符合协战代价要求' };
          }
          sum += info.orbValue;
          colors.push(...info.colors);
        }
        if (sum !== req.count) {
          return { success: false, error: `协战代价需要消除等效 ${req.count} 个信号球` };
        }
        if (req.filter === 'SAME') {
          const perCardSets = action.orbCardInstanceIds.map((oid) => this.continuousEffects.getEffectiveOrbInfo(oid).colors);
          const hasCommon = perCardSets[0]?.some((col) => perCardSets.every((s) => s.includes(col)));
          if (!hasCommon) {
            return { success: false, error: '协战代价要求消除同色信号球' };
          }
        }
        orbIds = positions.map((p) => zoneOrbs[p]!);
      } else {
        orbIds = this.findEligibleAssistOrbIds(action.playerId, req);
      }
      if (!orbIds) {
        return { success: false, error: '信号球区不满足协战消球代价 (8.13.3.c)' };
      }
      const orbColors = orbIds.map((oid) => this.continuousEffects.getEffectiveOrbInfo(oid).colors[0] ?? 'UNKNOWN');
      for (const oid of orbIds) {
        this.zoneMgr.moveCard(oid, 'GRAVEYARD', { isFaceUp: true });
      }
      this.events.push({ type: 'ORBS_ELIMINATED', playerId: action.playerId, orbCardIds: orbIds, cardDrawnCount: 0 });
      this.triggerMgr.emit({
        type: 'ORBS_ELIMINATED',
        playerId: action.playerId,
        orbCardIds: orbIds,
        orbColors,
      });
    }

    const isWatanabeGyAssist =
      partner.zone === 'GRAVEYARD' &&
      (host.cardNumber === 'BP04-023' || host.cardNumber === 'BP04-024' || host.cardNumber === 'BP04-025');
    if (
      !this.fieldMgr.attachPartner(action.playerId, host.instanceId, partner.instanceId, {
        releaseToDeckBottom: isWatanabeGyAssist,
      })
    ) {
      return { success: false, error: '绑定协战搭档失败' };
    }
    // BP04-038 布偶熊·觅语【协战永】：记录因《卡列尼娜·辉晓》协战代价消除信号球
    if (costOpt.eliminateOrbs) {
      const p = this.state.players[action.playerId];
      if (p) {
        if (costOpt.eliminateOrbs.count >= 3) {
          p.eliminatedThreeOrbsThisTurn = true;
        }
        if (this.continuousEffects.hasCardName(host.instanceId, '卡列尼娜·辉晓')) {
          p.eliminatedOrbsByKareninaCountThisTurn =
            (p.eliminatedOrbsByKareninaCountThisTurn ?? 0) + costOpt.eliminateOrbs.count;
        }
      }
    }
    // ST06-002 坠落与新生 塞西莉【协战永】：从手牌成为《坠落与新生 亚里莎·回音》协战搭档的回合中，不会解除协战状态
    if (
      partnerFromZone === 'HAND' &&
      partner.cardNumber === 'ST06-002' &&
      !this.continuousEffects.hasLostInherentAbilities(partner.instanceId) &&
      this.continuousEffects.hasCardName(host.instanceId, '坠落与新生 亚里莎·回音')
    ) {
      partner.cannotReleasePartnerUntilTurn = this.state.turnNumber;
    }
    player.turnAbilityUsage[`${host.instanceId}:ASSIST`] = 1;

    this.events.push({
      type: 'ABILITY_ACTIVATED',
      playerId: action.playerId,
      cardInstanceId: host.instanceId,
      abilityName: `${hostDef.name}【协战】`,
      rulesText: `获得协战搭档《${this.cardDb.getCard(partner.cardNumber)?.name ?? partner.cardNumber}》`,
    });
    this.triggerMgr.emit({
      type: 'PARTNER_GAINED',
      playerId: action.playerId,
      cardInstanceId: host.instanceId,
      targetCardId: partner.instanceId,
    });

    // 轮流优先权移交对方
    window.consecutivePasses = 0;
    window.priorityPlayerId = this.getOpponentId(action.playerId);
    this.state.priorityPlayerId = window.priorityPlayerId;
    return { success: true };
  }

  /**
   * 【瞬时】卡牌文本中记述的使用时机限制
   */
  private checkInstantTiming(playerId: string, def: CardVersionData): string | undefined {
    const text = def.rulesText;
    const window = this.state.timingWindow;
    const combat = this.state.currentCombat;
    const isOpponentTurn = playerId !== this.state.activePlayerId;

    if ((text.includes('该牌只能在对方回合使用') || /【瞬时】[:：]\s*对方回合中/.test(text)) && !isOpponentTurn) {
      return '该牌只能在对方回合使用';
    }
    if (text.includes('我方玩家被攻击时才能发动')) {
      const attacked = window?.kind === 'FREE_TIMING' && combat?.targetType === 'PLAYER' && isOpponentTurn;
      if (!attacked) return '只能在我方玩家被攻击时使用';
    }
    if ((text.includes('角色攻击时才能发动') || text.includes('该牌只能在自由时点步骤发动')) && window?.kind !== 'FREE_TIMING') {
      return '只能在角色攻击的自由时点步骤使用';
    }
    const fieldRequirement = text.match(/该牌只能在我方战场存在([《<])([^》>]+)[》>](?:角色)?时才能使用/);
    if (fieldRequirement) {
      const bracket = fieldRequirement[1]!;
      const subject = fieldRequirement[2]!;
      const exists = this.fieldMgr.getSlots(playerId).some((s) => {
        const role = s.roleCardId ? this.state.cards[s.roleCardId] : undefined;
        const roleDef = role ? this.cardDb.getCard(role.cardNumber) : undefined;
        if (!roleDef) return false;
        return bracket === '《' ? roleDef.name === subject : this.continuousEffects.hasTrait(role!.instanceId, subject);
      });
      if (!exists) {
        return `该牌只能在我方战场存在${bracket === '《' ? `《${subject}》` : `<${subject}>`}时才能使用`;
      }
    }
    return undefined;
  }

  /**
   * 回合玩家在主要阶段的行动时机才能执行的行动 (6.4.1.b) 的公共前置检查
   */
  private checkMainPhaseAction(playerId: string): string | undefined {
    if (this.state.activePlayerId !== playerId) {
      return '只能在自己回合的主要阶段执行该行动 (6.4.1.b)';
    }
    if (this.state.phase !== 'MAIN_PHASE' || this.state.currentCombat || this.state.timingWindow) {
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
    if (!Array.isArray(toBottom)) {
      return { success: false, error: '调度参数格式非法 (5.2.1.e)' };
    }
    if (new Set(toBottom).size !== toBottom.length) {
      return { success: false, error: '调度放回的卡牌存在重复 ID，操作非法 (5.2.1.e)' };
    }

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

/**
 * 是否为瞬时战术牌 (2.2.2.b.2)
 */
export function isInstantTactics(def: CardVersionData): boolean {
  return def.cardType === CardType.TACTICS && (def.isInstant || /【瞬时(?:战术牌)?】/.test(def.rulesText));
}

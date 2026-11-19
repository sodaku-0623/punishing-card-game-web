import { CardInstance, CardModifier, GameState } from '@zhanshuang/shared';
import { ICardDatabase } from '../database/card-registry.js';
import { parseInherentChargeCount, parseInherentKeywords } from '../rules/keywords.js';

/**
 * 8.9.1.e 分配单调递增的持续效果时间戳 (保存在 GameState 中以随快照恢复)
 */
export function nextEffectTimestamp(state: GameState): number {
  const next = (state.effectTimestampSeq ?? 0) + 1;
  state.effectTimestampSeq = next;
  return next;
}

/**
 * 8.2.1.b / 8.9.2 向卡牌挂载一条带时间戳与期限的持续效果 (CardModifier)
 */
export function addCardModifier(
  state: GameState,
  card: CardInstance,
  modifier: Omit<CardModifier, 'timestamp' | 'id'> & { id?: string; timestamp?: number }
): CardModifier {
  const ts = modifier.timestamp ?? nextEffectTimestamp(state);
  const full: CardModifier = {
    ...modifier,
    id: modifier.id ?? `mod-${card.instanceId}-${ts}`,
    timestamp: ts,
  };
  card.modifiers = [...(card.modifiers ?? []), full];
  return full;
}

/**
 * 8.9.1.b / 8.9.1.c 持续判定型永久能力规则 (【永】)
 */
export interface StaticContinuousRule {
  id: string;
  /** 匹配产生该永久能力的战场来源卡 */
  matchSource: (source: CardInstance, ctx: StaticRuleContext) => boolean;
  /** 层级：NON_STAT = 8.9.1.b (特征/词条/失去能力)，STAT = 8.9.1.c (PP/DP/充能数) */
  layer: 'NON_STAT' | 'STAT';
  /** 8.9.1.d 依赖标注：若会赋予特征，将在同一层内先于依赖特征的规则适用 */
  providesTraits?: boolean;
  dependsOnTraits?: boolean;
  /** 对目标卡牌计算本次持续效果贡献；返回 undefined 表示不作用于该目标 */
  evaluate: (
    source: CardInstance,
    target: CardInstance,
    ctx: StaticRuleEvaluationContext
  ) => StaticContribution | undefined;
}

export interface StaticRuleContext {
  state: GameState;
  cardDb: ICardDatabase;
  getCardsInZone: (playerId: string, zone: CardInstance['zone']) => CardInstance[];
  getFieldRoles: (playerId: string) => CardInstance[];
}

export interface StaticRuleEvaluationContext extends StaticRuleContext {
  /** 经过 8.9.1.b Layer 1 处理后的目标特征集合 */
  targetTraits: ReadonlySet<string>;
  /** 经过 8.9.1.b Layer 1 处理后的目标词条集合 */
  targetKeywords: ReadonlySet<string>;
  /** 目标所属方处于对方回合 */
  isOpponentTurnForSource: boolean;
}

export interface StaticContribution {
  pp?: number;
  setPP?: number;
  dp?: number;
  setDP?: number;
  charge?: number;
  setCharge?: number;
  keywords?: string[];
  removeKeywords?: string[];
  addTraits?: string[];
  loseAbilities?: boolean;
}

export interface EvaluatedCardStats {
  pp: number;
  dp: number;
  charge: number;
  keywords: string[];
  traits: string[];
  abilitiesLost: boolean;
}

interface TimestampedNonStat {
  timestamp: number;
  providesTraits?: boolean;
  dependsOnTraits?: boolean;
  addTraits?: string[];
  keywords?: string[];
  removeKeywords?: string[];
  loseAbilities?: boolean;
}

interface TimestampedStat {
  timestamp: number;
  pp?: number;
  setPP?: number;
  dp?: number;
  setDP?: number;
  charge?: number;
  setCharge?: number;
}

/**
 * 8.9 统一持续效果引擎：
 * 严格按 8.9.1.a (基本值 + 装备 4.18.2) → 8.9.1.b (非 PP/DP/充能数) → 8.9.1.c (PP/DP/充能数)
 * 以及 8.9.1.d (依赖顺序) 与 8.9.1.e (时间戳顺序) 计算任意卡牌的实时属性与能力。
 */
export class ContinuousEffectEngine {
  private staticRules: StaticContinuousRule[] = [];

  constructor(
    private state: GameState,
    private cardDb: ICardDatabase,
    private getCardsInZone: (playerId: string, zone: CardInstance['zone']) => CardInstance[],
    private getFieldRoles: (playerId: string) => CardInstance[]
  ) {
    this.registerBuiltinStaticRules();
  }

  /** 注册自定义持续判定型永久能力 (便于卡牌包扩展与规则测试) */
  registerStaticRule(rule: StaticContinuousRule): void {
    const idx = this.staticRules.findIndex((r) => r.id === rule.id);
    if (idx >= 0) {
      this.staticRules[idx] = rule;
    } else {
      this.staticRules.push(rule);
    }
  }

  private getDef(card: CardInstance) {
    return this.cardDb.getCard(card.cardNumber) || (card.cardId ? this.cardDb.getCard(card.cardId) : undefined);
  }

  /**
   * 10.14 暮形态 / 晖形态是否有效：操控玩家信号球区最下方卡牌费用为偶数 / 奇数
   */
  isFormActive(playerId: string, form: '暮' | '晖'): boolean {
    const bottom = this.getCardsInZone(playerId, 'SIGNAL_ORB')[0];
    if (!bottom || !bottom.isFaceUp) return false;
    const cost = this.getDef(bottom)?.cost;
    if (cost === undefined) return false;
    return form === '暮' ? cost % 2 === 0 : cost % 2 === 1;
  }

  /**
   * 8.3.4 检查卡牌自身固有能力是否因持续效果而处于「失去能力 / 效果无效」状态
   */
  hasLostInherentAbilities(cardInstanceId: string): boolean {
    const card = this.state.cards[cardInstanceId];
    if (!card) return false;
    return (card.modifiers ?? []).some((m) => m.loseAbilities === true);
  }

  /**
   * 8.9.1 完整分层计算一张卡牌的实时情报 (PP / DP / 充能数 / 词条 / 特征 / 能力状态)
   */
  evaluateCard(cardInstanceId: string): EvaluatedCardStats {
    const card = this.state.cards[cardInstanceId];
    if (!card) {
      return { pp: 0, dp: 0, charge: 0, keywords: [], traits: [], abilitiesLost: false };
    }

    const cardDef = this.getDef(card);

    // ==================== Layer 0: 8.9.1.a 卡牌基本情报 ====================
    let pp = cardDef?.basePP ?? 0;
    let dp = cardDef?.baseDP ?? 0;

    // 4.18.2 装备角色的 PP 会增加其装备牌的基本 PP 数值
    if (card.attachedEquipmentId) {
      const eqCard = this.state.cards[card.attachedEquipmentId];
      if (eqCard) {
        const eqDef = this.getDef(eqCard);
        pp += eqDef?.basePP ?? 0;
      }
    }

    const parsedInherent = parseInherentKeywords(cardDef?.rulesText);
    const inherentCharge = parseInherentChargeCount(parsedInherent);
    const baseKeywords = parsedInherent
      .filter((k) => !k.form || this.isFormActive(card.controllerPlayerId, k.form))
      .map((k) => k.keyword);

    const traitsSet = new Set<string>(cardDef?.traits ?? []);
    const keywordsSet = new Set<string>(baseKeywords);

    const baseCtx: StaticRuleContext = {
      state: this.state,
      cardDb: this.cardDb,
      getCardsInZone: this.getCardsInZone,
      getFieldRoles: this.getFieldRoles,
    };

    // ==================== Layer 1: 8.9.1.b 非 PP/DP/充能数的持续效果 ====================
    // 先收集卡牌上直接挂载的锁定型持续效果 (CardModifier) 与兼容旧快照的 grantedKeywords
    const nonStatOps: TimestampedNonStat[] = [];

    if (card.grantedKeywords && card.grantedKeywords.length > 0) {
      nonStatOps.push({ timestamp: 0, keywords: card.grantedKeywords });
    }
    for (const m of card.modifiers ?? []) {
      if (m.addTraits?.length || m.keywords?.length || m.removeKeywords?.length || m.loseAbilities) {
        nonStatOps.push({
          timestamp: m.timestamp ?? 0,
          providesTraits: !!m.addTraits?.length,
          addTraits: m.addTraits,
          keywords: m.keywords,
          removeKeywords: m.removeKeywords,
          loseAbilities: m.loseAbilities,
        });
      }
    }

    // 收集战场上所有未失去能力的来源卡产生的 Layer 1 永久能力 (8.9.1.b / 8.9.1.e.1)
    const allFieldRoles = [
      ...this.getFieldRoles(this.state.activePlayerId),
      ...this.getFieldRoles(this.state.nonActivePlayerId),
    ];

    const layer1StaticRules = this.staticRules
      .filter((r) => r.layer === 'NON_STAT')
      .sort((a, b) => Number(!!b.providesTraits) - Number(!!a.providesTraits));

    for (const rule of layer1StaticRules) {
      for (const source of allFieldRoles) {
        if (this.hasLostInherentAbilities(source.instanceId)) continue;
        if (!rule.matchSource(source, baseCtx)) continue;
        const evalCtx: StaticRuleEvaluationContext = {
          ...baseCtx,
          targetTraits: traitsSet,
          targetKeywords: keywordsSet,
          isOpponentTurnForSource: this.state.activePlayerId !== source.controllerPlayerId,
        };
        const contrib = rule.evaluate(source, card, evalCtx);
        if (!contrib) continue;
        nonStatOps.push({
          timestamp: source.enteredZoneTimestamp ?? 0,
          providesTraits: rule.providesTraits,
          dependsOnTraits: rule.dependsOnTraits,
          addTraits: contrib.addTraits,
          keywords: contrib.keywords,
          removeKeywords: contrib.removeKeywords,
          loseAbilities: contrib.loseAbilities,
        });
      }
    }

    // 8.9.1.d 依赖排序 (提供特征的优先于依赖特征的) + 8.9.1.e 时间戳顺序
    nonStatOps.sort((a, b) => {
      if (a.providesTraits && b.dependsOnTraits) return -1;
      if (b.providesTraits && a.dependsOnTraits) return 1;
      return a.timestamp - b.timestamp;
    });

    let abilitiesLost = false;
    for (const op of nonStatOps) {
      if (op.loseAbilities) {
        abilitiesLost = true;
        // 8.3.4 / Q&A·4：失去能力清空当前已有的固有与早先赋予的关键字；之后时间戳新获得的能力有效
        keywordsSet.clear();
      }
      if (op.addTraits) {
        for (const t of op.addTraits) traitsSet.add(t);
      }
      if (op.keywords) {
        for (const kw of op.keywords) keywordsSet.add(kw);
      }
      if (op.removeKeywords) {
        for (const kw of op.removeKeywords) keywordsSet.delete(kw);
      }
    }

    // 8.3.4 若卡牌自身失去能力，固有【充能X】亦不再生效，回到规则基本充能数 1
    let charge = abilitiesLost ? 1 : (inherentCharge ?? 1);

    // ==================== Layer 2: 8.9.1.c 改变 PP / DP / 充能数的持续效果 ====================
    const statOps: TimestampedStat[] = [];

    // 兼容旧快照残留字段 (只读回退)
    if (card.tempPPBonus) {
      statOps.push({ timestamp: 0, pp: card.tempPPBonus });
    }
    if (card.tempDPBonus) {
      statOps.push({ timestamp: 0, dp: card.tempDPBonus });
    }

    for (const m of card.modifiers ?? []) {
      if (
        m.pp !== undefined ||
        m.setPP !== undefined ||
        m.dp !== undefined ||
        m.setDP !== undefined ||
        m.charge !== undefined ||
        m.setCharge !== undefined
      ) {
        statOps.push({
          timestamp: m.timestamp ?? 0,
          pp: m.pp,
          setPP: m.setPP,
          dp: m.dp,
          setDP: m.setDP,
          charge: m.charge,
          setCharge: m.setCharge,
        });
      }
    }

    const layer2StaticRules = this.staticRules.filter((r) => r.layer === 'STAT');
    for (const rule of layer2StaticRules) {
      for (const source of allFieldRoles) {
        // 8.3.4 失去能力的来源卡其【永】不产生效果 (Q&A·10 BP04-001 失去永久能力时 PP 变为 0)
        const sourceLost =
          source.instanceId === card.instanceId ? abilitiesLost : this.hasLostInherentAbilities(source.instanceId);
        if (sourceLost) continue;
        if (!rule.matchSource(source, baseCtx)) continue;
        const evalCtx: StaticRuleEvaluationContext = {
          ...baseCtx,
          targetTraits: traitsSet,
          targetKeywords: keywordsSet,
          isOpponentTurnForSource: this.state.activePlayerId !== source.controllerPlayerId,
        };
        const contrib = rule.evaluate(source, card, evalCtx);
        if (!contrib) continue;
        statOps.push({
          timestamp: source.enteredZoneTimestamp ?? 0,
          pp: contrib.pp,
          setPP: contrib.setPP,
          dp: contrib.dp,
          setDP: contrib.setDP,
          charge: contrib.charge,
          setCharge: contrib.setCharge,
        });
      }
    }

    // 8.9.1.e 按时间戳升序依次适用 (支持「PP 变为 X」覆盖此前增减，Q&A·6)
    statOps.sort((a, b) => a.timestamp - b.timestamp);

    for (const op of statOps) {
      if (op.setPP !== undefined) pp = op.setPP;
      if (op.pp !== undefined) pp += op.pp;
      if (op.setDP !== undefined) dp = op.setDP;
      if (op.dp !== undefined) dp += op.dp;
      if (op.setCharge !== undefined) charge = op.setCharge;
      if (op.charge !== undefined) charge += op.charge;
    }

    return {
      pp,
      dp: Math.max(0, dp),
      charge: Math.max(0, charge),
      keywords: Array.from(keywordsSet),
      traits: Array.from(traitsSet),
      abilitiesLost,
    };
  }

  hasKeyword(cardInstanceId: string, keyword: string): boolean {
    return this.evaluateCard(cardInstanceId).keywords.includes(keyword);
  }

  hasTrait(cardInstanceId: string, trait: string): boolean {
    return this.evaluateLayer1Traits(cardInstanceId).has(trait);
  }

  /**
   * 仅计算 Layer 0 + Layer 1 (8.9.1.a/b) 的有效特征集合，避免 Layer 2 规则互相引用时产生递归
   */
  private evaluateLayer1Traits(cardInstanceId: string): Set<string> {
    const card = this.state.cards[cardInstanceId];
    if (!card) return new Set();
    const cardDef = this.getDef(card);
    const traitsSet = new Set<string>(cardDef?.traits ?? []);
    for (const m of card.modifiers ?? []) {
      if (m.addTraits) {
        for (const t of m.addTraits) traitsSet.add(t);
      }
    }
    const baseCtx: StaticRuleContext = {
      state: this.state,
      cardDb: this.cardDb,
      getCardsInZone: this.getCardsInZone,
      getFieldRoles: this.getFieldRoles,
    };
    const allFieldRoles = [
      ...this.getFieldRoles(this.state.activePlayerId),
      ...this.getFieldRoles(this.state.nonActivePlayerId),
    ];
    for (const rule of this.staticRules) {
      if (rule.layer !== 'NON_STAT' || !rule.providesTraits) continue;
      for (const source of allFieldRoles) {
        if (this.hasLostInherentAbilities(source.instanceId)) continue;
        if (!rule.matchSource(source, baseCtx)) continue;
        const contrib = rule.evaluate(source, card, {
          ...baseCtx,
          targetTraits: traitsSet,
          targetKeywords: new Set(),
          isOpponentTurnForSource: this.state.activePlayerId !== source.controllerPlayerId,
        });
        if (contrib?.addTraits) {
          for (const t of contrib.addTraits) traitsSet.add(t);
        }
      }
    }
    return traitsSet;
  }

  // ===================================================================
  // 内置官方永久能力持续效果 (8.9.1.e.1)
  // ===================================================================

  private registerBuiltinStaticRules(): void {
    // ST02-004 露娜·银冕：【永】若我方墓地的牌为10张及以上，该牌PP+1500
    this.registerStaticRule({
      id: 'static:ST02-004',
      layer: 'STAT',
      matchSource: (src) => src.cardNumber === 'ST02-004',
      evaluate: (src, target, ctx) => {
        if (src.instanceId !== target.instanceId) return undefined;
        return ctx.getCardsInZone(src.controllerPlayerId, 'GRAVEYARD').length >= 10
          ? { pp: 1500 }
          : undefined;
      },
    });

    // ST02-006 露娜·银冕：【永】若我方的侵蚀计数为4及以上，该牌PP+1000
    this.registerStaticRule({
      id: 'static:ST02-006',
      layer: 'STAT',
      matchSource: (src) => src.cardNumber === 'ST02-006',
      evaluate: (src, target, ctx) => {
        if (src.instanceId !== target.instanceId) return undefined;
        const erosion = ctx.state.players[src.controllerPlayerId]?.erosionCount ?? 0;
        return erosion >= 4 ? { pp: 1000 } : undefined;
      },
    });

    // ST02-008 苦刑之女：【永】若我方战场存在<升格者>角色，该牌PP+1000
    this.registerStaticRule({
      id: 'static:ST02-008',
      layer: 'STAT',
      dependsOnTraits: true,
      matchSource: (src) => src.cardNumber === 'ST02-008',
      evaluate: (src, target, ctx) => {
        if (src.instanceId !== target.instanceId) return undefined;
        const hasAscendant = ctx.getFieldRoles(src.controllerPlayerId).some((r) => {
          if (r.instanceId === target.instanceId) return ctx.targetTraits.has('升格者');
          return this.evaluateLayer1Traits(r.instanceId).has('升格者');
        });
        return hasAscendant ? { pp: 1000 } : undefined;
      },
    });

    // ST03-004 诺克提·擎驱：【永】对方回合中，横置状态的该牌PP+1000
    this.registerStaticRule({
      id: 'static:ST03-004',
      layer: 'STAT',
      matchSource: (src) => src.cardNumber === 'ST03-004',
      evaluate: (src, target, ctx) => {
        if (src.instanceId !== target.instanceId) return undefined;
        return ctx.isOpponentTurnForSource && !target.isReady ? { pp: 1000 } : undefined;
      },
    });

    // ST02-001 露娜·银冕：【永】若我方侵蚀计数为5及以上，我方战场所有<升格者>角色PP+1000
    this.registerStaticRule({
      id: 'static:ST02-001',
      layer: 'STAT',
      dependsOnTraits: true,
      matchSource: (src) => src.cardNumber === 'ST02-001',
      evaluate: (src, target, ctx) => {
        if (target.controllerPlayerId !== src.controllerPlayerId) return undefined;
        const erosion = ctx.state.players[src.controllerPlayerId]?.erosionCount ?? 0;
        if (erosion < 5) return undefined;
        return ctx.targetTraits.has('升格者') ? { pp: 1000 } : undefined;
      },
    });

    // ST03-002 薇拉·瑰丽：【永】对方回合中，我方战场所有横置状态的<三头犬小队>角色PP+1000
    this.registerStaticRule({
      id: 'static:ST03-002',
      layer: 'STAT',
      dependsOnTraits: true,
      matchSource: (src) => src.cardNumber === 'ST03-002',
      evaluate: (src, target, ctx) => {
        if (target.controllerPlayerId !== src.controllerPlayerId) return undefined;
        if (!ctx.isOpponentTurnForSource || target.isReady) return undefined;
        return ctx.targetTraits.has('三头犬小队') ? { pp: 1000 } : undefined;
      },
    });

    // BP04-001 露娜·终焉：【永】该牌下方的牌每有1张，该牌PP+1000。若该牌下方的牌为10张及以上，该牌DP+1。(Q&A·10)
    this.registerStaticRule({
      id: 'static:BP04-001',
      layer: 'STAT',
      matchSource: (src) => src.cardNumber === 'BP04-001',
      evaluate: (src, target) => {
        if (src.instanceId !== target.instanceId) return undefined;
        const underCount = target.underneathCardIds?.length ?? 0;
        if (underCount <= 0) return undefined;
        return {
          pp: underCount * 1000,
          dp: underCount >= 10 ? 1 : undefined,
        };
      },
    });
  }
}

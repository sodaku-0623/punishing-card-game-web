import {
  CardInstance,
  CardModifier,
  GameState,
  ProhibitionFlag,
  SignalOrbColor,
} from '@zhanshuang/shared';
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
  /** 允许生效的来源卡区域 (默认为仅战场 ['BATTLEFIELD']；如 BP04-032 炽能球在 SIGNAL_ORB，BP02-040 在所有区域) */
  sourceZones?: CardInstance['zone'][];
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
  /** 8.9.1.d 无递归特征查询：目标卡直读 Layer 1 结果，其余卡独立计算 Layer 1 特征 */
  hasCardTrait: (cardInstanceId: string, trait: string) => boolean;
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
  prohibitions?: ProhibitionFlag[];
  treatedAsOrbColors?: SignalOrbColor[];
  orbValue?: number;
  treatedAsNames?: string[];
  appliedByPlayerId?: string;
}

export interface EvaluatedCardStats {
  pp: number;
  dp: number;
  charge: number;
  keywords: string[];
  traits: string[];
  abilitiesLost: boolean;
  prohibitions: ProhibitionFlag[];
  treatedAsNames: string[];
  treatedAsOrbColors: SignalOrbColor[];
  orbValue: number;
}

export interface EffectiveOrbInfo {
  isOrb: boolean;
  colors: SignalOrbColor[];
  orbValue: number;
  cannotEliminate: boolean;
}

interface TimestampedNonStat {
  timestamp: number;
  providesTraits?: boolean;
  dependsOnTraits?: boolean;
  addTraits?: string[];
  keywords?: string[];
  removeKeywords?: string[];
  loseAbilities?: boolean;
  prohibitions?: ProhibitionFlag[];
  treatedAsOrbColors?: SignalOrbColor[];
  orbValue?: number;
  treatedAsNames?: string[];
}

interface TimestampedStat {
  timestamp: number;
  pp?: number;
  setPP?: number;
  dp?: number;
  setDP?: number;
  charge?: number;
  setCharge?: number;
  appliedByPlayerId?: string;
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
      return {
        pp: 0,
        dp: 0,
        charge: 0,
        keywords: [],
        traits: [],
        abilitiesLost: false,
        prohibitions: [],
        treatedAsNames: [],
        treatedAsOrbColors: [],
        orbValue: 0,
      };
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

    // 8.13.4.b 协战角色的基本 PP、基本 DP 增加其协战搭档对应的印刷基本数值
    // (8.13.4.b.2 只参考搭档印刷基本数值，不参考搭档自身的持续效果或状态)
    if (card.zone === 'BATTLEFIELD' && card.partnerCardId) {
      const partnerCard = this.state.cards[card.partnerCardId];
      if (partnerCard) {
        const partnerDef = this.getDef(partnerCard);
        pp += partnerDef?.basePP ?? 0;
        dp += partnerDef?.baseDP ?? 0;
      }
    }

    const parsedInherent = parseInherentKeywords(cardDef?.rulesText);
    const inherentCharge = parseInherentChargeCount(parsedInherent);
    const baseKeywords = parsedInherent
      .filter((k) => !k.form || this.isFormActive(card.controllerPlayerId, k.form))
      .map((k) => k.keyword);

    const traitsSet = new Set<string>(cardDef?.traits ?? []);
    const keywordsSet = new Set<string>(baseKeywords);
    const prohibitionsSet = new Set<ProhibitionFlag>();
    const treatedAsNamesSet = new Set<string>();
    const orbColorsSet = new Set<SignalOrbColor>();
    if (cardDef?.signalOrb) {
      orbColorsSet.add(cardDef.signalOrb as SignalOrbColor);
    }
    let orbValue = cardDef?.signalOrb ? 1 : 0;

    // 固有禁止能力：【永】：该牌不能攻击 (帕瓦、库洛洛；若失去能力 8.3.4 则在下方清除)
    const hasInherentCannotAttack = Boolean(cardDef?.rulesText?.includes('【永】：该牌不能攻击'));
    if (hasInherentCannotAttack) {
      prohibitionsSet.add('CANNOT_ATTACK');
    }

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
      if (
        m.addTraits?.length ||
        m.keywords?.length ||
        m.removeKeywords?.length ||
        m.loseAbilities ||
        m.prohibitions?.length ||
        m.treatedAsOrbColors?.length ||
        m.orbValue !== undefined ||
        m.treatedAsNames?.length
      ) {
        nonStatOps.push({
          timestamp: m.timestamp ?? 0,
          providesTraits: !!m.addTraits?.length,
          addTraits: m.addTraits,
          keywords: m.keywords,
          removeKeywords: m.removeKeywords,
          loseAbilities: m.loseAbilities,
          prohibitions: m.prohibitions,
          treatedAsOrbColors: m.treatedAsOrbColors,
          orbValue: m.orbValue,
          treatedAsNames: m.treatedAsNames,
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
      const candidateSources = rule.sourceZones
        ? rule.sourceZones.includes(card.zone)
          ? [card]
          : []
        : allFieldRoles;
      for (const source of candidateSources) {
        if (this.hasLostInherentAbilities(source.instanceId)) continue;
        if (!rule.matchSource(source, baseCtx)) continue;
        const evalCtx: StaticRuleEvaluationContext = {
          ...baseCtx,
          targetTraits: traitsSet,
          targetKeywords: keywordsSet,
          isOpponentTurnForSource: this.state.activePlayerId !== source.controllerPlayerId,
          hasCardTrait: (id, trait) =>
            id === card.instanceId ? traitsSet.has(trait) : this.evaluateLayer1Traits(id).has(trait),
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
          prohibitions: contrib.prohibitions,
          treatedAsOrbColors: contrib.treatedAsOrbColors,
          orbValue: contrib.orbValue,
          treatedAsNames: contrib.treatedAsNames,
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
    let cannotGainAbilities = false;
    for (const op of nonStatOps) {
      if (op.loseAbilities) {
        abilitiesLost = true;
        // 8.3.4 / Q&A·4：失去能力清空当前已有的固有与早先赋予的关键字，并解除自身固有「不能攻击」
        keywordsSet.clear();
        if (hasInherentCannotAttack) {
          prohibitionsSet.delete('CANNOT_ATTACK');
        }
      }
      if (op.prohibitions) {
        for (const p of op.prohibitions) {
          prohibitionsSet.add(p);
          if (p === 'CANNOT_GAIN_ABILITIES') cannotGainAbilities = true;
        }
      }
      if (op.addTraits) {
        for (const t of op.addTraits) traitsSet.add(t);
      }
      if (op.keywords && !cannotGainAbilities) {
        for (const kw of op.keywords) keywordsSet.add(kw);
      }
      if (op.removeKeywords) {
        for (const kw of op.removeKeywords) keywordsSet.delete(kw);
      }
      if (op.treatedAsNames) {
        for (const n of op.treatedAsNames) treatedAsNamesSet.add(n);
      }
      if (op.treatedAsOrbColors) {
        for (const col of op.treatedAsOrbColors) orbColorsSet.add(col);
        if (orbValue === 0 && op.treatedAsOrbColors.length > 0) orbValue = 1;
      }
      if (op.orbValue !== undefined) {
        orbValue = op.orbValue;
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
          appliedByPlayerId: m.appliedByPlayerId,
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
          hasCardTrait: (id, trait) =>
            id === card.instanceId ? traitsSet.has(trait) : this.evaluateLayer1Traits(id).has(trait),
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
          appliedByPlayerId: contrib.appliedByPlayerId ?? source.controllerPlayerId,
        });
      }
    }

    // 8.9.1.e 按时间戳升序依次适用 (支持「PP 变为 X」覆盖此前增减，Q&A·6)
    statOps.sort((a, b) => a.timestamp - b.timestamp);

    const preventOppPPDelta = prohibitionsSet.has('CANNOT_MODIFY_PP_BY_OPPONENT');
    for (const op of statOps) {
      // Q&A·9 BP04-016: 「PP 不会因对方效果增减」挡住对方的 pp +/-，但挡不住「PP 变为 X」(setPP)
      if (op.setPP !== undefined) pp = op.setPP;
      if (op.pp !== undefined) {
        const isFromOpponent =
          op.appliedByPlayerId !== undefined && op.appliedByPlayerId !== card.controllerPlayerId;
        if (!(preventOppPPDelta && isFromOpponent)) {
          pp += op.pp;
        }
      }
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
      prohibitions: Array.from(prohibitionsSet),
      treatedAsNames: Array.from(treatedAsNamesSet),
      treatedAsOrbColors: Array.from(orbColorsSet),
      orbValue,
    };
  }

  hasKeyword(cardInstanceId: string, keyword: string): boolean {
    return this.evaluateCard(cardInstanceId).keywords.includes(keyword);
  }

  /**
   * 8.13.4.b.1 计算卡牌当前有效费用 (协战角色在战场时费用增加其搭档的基本费用)
   */
  getEffectiveCardCost(cardInstanceId: string): number {
    const card = this.state.cards[cardInstanceId];
    if (!card) return 0;
    const def = this.getDef(card);
    let cost = def?.cost ?? 0;
    if (card.zone === 'BATTLEFIELD' && card.partnerCardId) {
      const partner = this.state.cards[card.partnerCardId];
      if (partner) {
        cost += this.getDef(partner)?.cost ?? 0;
      }
    }
    return cost;
  }

  hasTrait(cardInstanceId: string, trait: string): boolean {
    return this.evaluateLayer1Traits(cardInstanceId).has(trait);
  }

  /**
   * 1.3.3 查询卡牌当前生效的禁止效果标志
   */
  hasProhibition(cardInstanceId: string, flag: ProhibitionFlag): boolean {
    return this.evaluateCard(cardInstanceId).prohibitions.includes(flag);
  }

  /**
   * 查询卡牌当前是否视为具有指定卡牌名称 (含原卡名与「视为」效果，如 Q&A·4/5 BP02-040)
   */
  hasCardName(cardInstanceId: string, name: string): boolean {
    const card = this.state.cards[cardInstanceId];
    if (!card) return false;
    const def = this.getDef(card);
    if (def?.name === name) return true;
    return this.evaluateCard(cardInstanceId).treatedAsNames.includes(name);
  }

  /**
   * 计算信号球区卡牌的有效信号球颜色、等效个数 (Q&A·1 BP01-037) 与是否禁止消除 (BP02-066)
   */
  getEffectiveOrbInfo(cardInstanceId: string): EffectiveOrbInfo {
    const card = this.state.cards[cardInstanceId];
    if (!card || !card.isFaceUp) {
      return { isOrb: false, colors: [], orbValue: 0, cannotEliminate: true };
    }
    const evaluated = this.evaluateCard(cardInstanceId);
    const colors = evaluated.treatedAsOrbColors;
    const isOrb = colors.length > 0 && evaluated.orbValue > 0;
    return {
      isOrb,
      colors,
      orbValue: isOrb ? evaluated.orbValue : 0,
      cannotEliminate: evaluated.prohibitions.includes('CANNOT_ELIMINATE'),
    };
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
          hasCardTrait: (id, trait) =>
            id === card.instanceId
              ? traitsSet.has(trait)
              : Boolean(this.state.cards[id] && this.getDef(this.state.cards[id]!)?.traits.includes(trait)),
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
    // 注：官方预组 ST01~ST03 的【永】静态规则由声明式效果库 (effects/dsl/specs/starter-decks.ts) 统一注册。
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

    // BP04-032 炽能球：【永】若我方战场存在《渡边·尘铭》，我方信号球区的该牌可以视为【红色信号球】（视为【红色信号球】时可以被消除）
    this.registerStaticRule({
      id: 'static:BP04-032',
      layer: 'NON_STAT',
      sourceZones: ['SIGNAL_ORB'],
      matchSource: (src) => src.cardNumber === 'BP04-032' && src.isFaceUp,
      evaluate: (src, target, ctx) => {
        if (src.instanceId !== target.instanceId) return undefined;
        const hasWatanabe = ctx.getFieldRoles(src.controllerPlayerId).some((role) => {
          const def = ctx.cardDb.getCard(role.cardNumber || role.cardId);
          if (def?.name === '渡边·尘铭') return true;
          return Boolean(role.modifiers?.some((m) => m.treatedAsNames?.includes('渡边·尘铭')));
        });
        if (!hasWatanabe) return undefined;
        return { treatedAsOrbColors: ['RED'] };
      },
    });

    // BP02-040 含英·檀心：【永】该牌的卡牌名称在所有区域可以视为《飞叶点翠》。(Q&A·4/5)
    this.registerStaticRule({
      id: 'static:BP02-040',
      layer: 'NON_STAT',
      sourceZones: ['BATTLEFIELD', 'HAND', 'GRAVEYARD', 'SIGNAL_ORB', 'COST', 'PROCESSING', 'DECK'],
      matchSource: (src) => src.cardNumber === 'BP02-040',
      evaluate: (src, target) => {
        if (src.instanceId !== target.instanceId) return undefined;
        return { treatedAsNames: ['飞叶点翠'] };
      },
    });

    // BP04-016 薇拉·灼惘：【永】对方回合中，该牌的PP不会因对方的效果增减。(Q&A·9)
    this.registerStaticRule({
      id: 'static:BP04-016',
      layer: 'NON_STAT',
      matchSource: (src) => src.cardNumber === 'BP04-016',
      evaluate: (src, target, ctx) => {
        if (src.instanceId !== target.instanceId) return undefined;
        if (!ctx.isOpponentTurnForSource) return undefined;
        return { prohibitions: ['CANNOT_MODIFY_PP_BY_OPPONENT'] };
      },
    });
  }
}

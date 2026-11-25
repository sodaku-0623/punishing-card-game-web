import {
  CardInstance,
  CardModifier,
  CardType,
  GameState,
  ProhibitionFlag,
  SignalOrbColor,
} from '@zhanshuang/shared';
import { ICardDatabase } from '../database/card-registry.js';
import { parseInherentChargeCount, parseInherentKeywords } from '../rules/keywords.js';

/** 规范化官方卡表名称中 `· ` 与 `·` 的排版空格及连续多空格差异（如「卡列尼娜· 辉晓」≡「卡列尼娜·辉晓」） */
export function normalizeCardName(name: string): string {
  return name.replace(/·\s+/g, '·').replace(/\s+/g, ' ').trim();
}

/** 展开官方卡表与卡面规则文本之间的同义特征名称 (异聚体<->神寂启示录、火花<->机械教会、太刀类->封刃太刀) */
export function expandBaseTraits(rawTraits?: string[]): Set<string> {
  const traits = new Set<string>(rawTraits ?? []);
  if (traits.has('异聚体')) traits.add('神寂启示录');
  if (traits.has('神寂启示录')) traits.add('异聚体');
  if (traits.has('火花')) traits.add('机械教会');
  if (traits.has('机械教会')) traits.add('火花');
  if (traits.has('太刀') || traits.has('小太刀') || traits.has('大太刀')) {
    traits.add('封刃太刀');
  }
  return traits;
}

/**
 * 纯无递归读取卡牌经 `CardModifier.setCardType` 覆写后的当前有效卡牌类型
 * (按时间戳升序取最后生效值；兼容 BP04-001 变为辅助机、PR-041 变为角色)
 */
export function getModifierEffectiveCardType(
  card: CardInstance | undefined,
  cardDef?: { cardType?: CardType }
): CardType | undefined {
  if (!card) return cardDef?.cardType;
  let effective = cardDef?.cardType;
  const rawMods = card.modifiers;
  if (!rawMods || rawMods.length === 0) return effective;
  let mods: CardModifier[] | undefined;
  for (let i = 0; i < rawMods.length; i++) {
    const m = rawMods[i]!;
    if (m.setCardType !== undefined) {
      if (!mods) mods = [m];
      else mods.push(m);
    }
  }
  if (mods) {
    if (mods.length > 1) {
      mods.sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
    }
    for (const m of mods) {
      effective = m.setCardType;
    }
  }
  return effective;
}

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
  if (full.setPP !== undefined && full.baselineRuleCardIds === undefined) {
    const baselineIds: string[] = [];
    if (card.attachedEquipmentId) baselineIds.push(card.attachedEquipmentId);
    if (card.extraAttachedEquipmentIds?.length) baselineIds.push(...card.extraAttachedEquipmentIds);
    if (card.partnerCardId) baselineIds.push(card.partnerCardId);
    full.baselineRuleCardIds = baselineIds;
  }
  if (full.setDP !== undefined && full.baselinePartnerCardId === undefined) {
    full.baselinePartnerCardId = card.partnerCardId ?? '';
  }
  card.modifiers = [...(card.modifiers ?? []), full];
  return full;
}

/**
 * 8.9.1.b / 8.9.1.c 持续判定型永久能力规则 (【永】)
 */
export interface StaticContinuousRule {
  id: string;
  /** 可选来源卡牌编号索引：填写后引擎将按来源卡编号 O(1) 分桶查找，未填则作为通配规则兜底匹配 */
  sourceCardNumber?: string;
  /** 匹配产生该永久能力的战场来源卡 */
  matchSource: (source: CardInstance, ctx: StaticRuleContext) => boolean;
  /** 层级：NON_STAT = 8.9.1.b (特征/词条/失去能力)，STAT = 8.9.1.c (PP/DP/充能数) */
  layer: 'NON_STAT' | 'STAT';
  /** 允许生效的来源卡区域 (默认为仅战场 ['BATTLEFIELD']；如 BP04-032 炽能球在 SIGNAL_ORB，BP02-040 在所有区域) */
  sourceZones?: CardInstance['zone'][];
  /** 来源卡类别：默认 FIELD_ROLE (战场卡位角色)；PARTNER 表示协战搭档的【协战永】；UNDERNEATH 表示角色下方牌的【永】；EQUIPPED 表示附着装备赋予宿主的【永】 */
  sourceKind?: 'FIELD_ROLE' | 'PARTNER' | 'UNDERNEATH' | 'EQUIPPED';
  /** 8.9.1.d 依赖标注：若会赋予特征，将在同一层内先于依赖特征的规则适用 */
  providesTraits?: boolean;
  /** 若该规则可能返回 loseAbilities: true，须显式声明以便 8.3.4 失能预筛跳过无关规则 */
  providesLoseAbilities?: boolean;
  /** 声明该规则可能赋予的禁止标志；未显式声明的动态规则将保守视为可能作用于费用区 */
  providesProhibitions?: ProhibitionFlag[];
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
  setBaseDP?: number;
  charge?: number;
  chargeIsAbility?: boolean;
  setCharge?: number;
  keywords?: string[];
  removeKeywords?: string[];
  addTraits?: string[];
  clearBaseTraits?: boolean;
  loseAbilities?: boolean;
  setCardType?: CardType;
  costDelta?: number;
  setCost?: number;
  canAttackReadyRolesMaxCost?: number;
  mustBeAttackTarget?: boolean;
  prohibitions?: ProhibitionFlag[];
  treatedAsOrbColors?: SignalOrbColor[];
  orbValue?: number;
  treatedAsNames?: string[];
  grantedTriggerIds?: string[];
  grantKey?: string;
  canAttackPlayerOnEnterTurn?: boolean;
  unblockableMaxPP?: number;
  /** 允许同时装备 2 张<封刃太刀>装备 (BP01-014 / BP01-016 / BP01-017) */
  canDualEquipFengren?: boolean;
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
  grantedTriggerIds: string[];
  grantedTriggerEntries?: Array<{ triggerId: string; grantKey: string }>;
  canAttackPlayerOnEnterTurn: boolean;
  unblockableMaxPP?: number;
  canDualEquipFengren?: boolean;
  cardType?: CardType;
  costDelta?: number;
  setCost?: number;
  canAttackReadyRolesMaxCost?: number;
  mustBeAttackTarget?: boolean;
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
  clearBaseTraits?: boolean;
  keywords?: string[];
  removeKeywords?: string[];
  loseAbilities?: boolean;
  setCardType?: CardType;
  costDelta?: number;
  setCost?: number;
  canAttackReadyRolesMaxCost?: number;
  mustBeAttackTarget?: boolean;
  prohibitions?: ProhibitionFlag[];
  treatedAsOrbColors?: SignalOrbColor[];
  orbValue?: number;
  treatedAsNames?: string[];
  grantedTriggerIds?: string[];
  grantKey?: string;
  canAttackPlayerOnEnterTurn?: boolean;
  unblockableMaxPP?: number;
  canDualEquipFengren?: boolean;
}

interface TimestampedStat {
  timestamp: number;
  pp?: number;
  setPP?: number;
  baselineRuleCardIds?: string[];
  dp?: number;
  setDP?: number;
  baselinePartnerCardId?: string;
  setBaseDP?: number;
  charge?: number;
  chargeIsAbility?: boolean;
  setCharge?: number;
  appliedByPlayerId?: string;
}

interface RuleGroup {
  byCardNumber: Map<string, StaticContinuousRule[]>;
  wildcard: StaticContinuousRule[];
}

interface RuleBuckets {
  fieldRole: RuleGroup;
  partner: RuleGroup;
  underneath: RuleGroup;
  equipped: RuleGroup;
  sourceZones: RuleGroup;
  hasAny: boolean;
}

interface FieldSources {
  allFieldTopCards: CardInstance[];
  allActivePartners: CardInstance[];
  allActiveUnderneath: CardInstance[];
  allAttachedEquipment: CardInstance[];
}

function createEmptyRuleGroup(): RuleGroup {
  return { byCardNumber: new Map(), wildcard: [] };
}

function createEmptyRuleBuckets(): RuleBuckets {
  return {
    fieldRole: createEmptyRuleGroup(),
    partner: createEmptyRuleGroup(),
    underneath: createEmptyRuleGroup(),
    equipped: createEmptyRuleGroup(),
    sourceZones: createEmptyRuleGroup(),
    hasAny: false,
  };
}

function addRuleToGroup(group: RuleGroup, rule: StaticContinuousRule): void {
  if (rule.sourceCardNumber) {
    let list = group.byCardNumber.get(rule.sourceCardNumber);
    if (!list) {
      list = [rule];
      group.byCardNumber.set(rule.sourceCardNumber, list);
    } else {
      list.push(rule);
    }
  } else {
    group.wildcard.push(rule);
  }
}

function addRuleToBuckets(buckets: RuleBuckets, rule: StaticContinuousRule): void {
  buckets.hasAny = true;
  if (rule.sourceZones) {
    addRuleToGroup(buckets.sourceZones, rule);
  } else if (rule.sourceKind === 'PARTNER') {
    addRuleToGroup(buckets.partner, rule);
  } else if (rule.sourceKind === 'UNDERNEATH') {
    addRuleToGroup(buckets.underneath, rule);
  } else if (rule.sourceKind === 'EQUIPPED') {
    addRuleToGroup(buckets.equipped, rule);
  } else {
    addRuleToGroup(buckets.fieldRole, rule);
  }
}

const EMPTY_STRING_SET: ReadonlySet<string> = new Set();

/**
 * 8.9 统一持续效果引擎：
 * 严格按 8.9.1.a (基本值 + 装备 4.18.2) → 8.9.1.b (非 PP/DP/充能数) → 8.9.1.c (PP/DP/充能数)
 * 以及 8.9.1.d (依赖顺序) 与 8.9.1.e (时间戳顺序) 计算任意卡牌的实时属性与能力。
 */
export class ContinuousEffectEngine {
  private staticRules: StaticContinuousRule[] = [];
  private traitBuckets: RuleBuckets = createEmptyRuleBuckets();
  private loseAbilitiesBuckets: RuleBuckets = createEmptyRuleBuckets();
  private layer1Buckets: RuleBuckets = createEmptyRuleBuckets();
  private layer2Buckets: RuleBuckets = createEmptyRuleBuckets();
  private hasCostZoneProhibitionRules = false;
  private activeLoseAbilitiesIds: Set<string> = new Set();
  private evaluatingCardIds: Set<string> = new Set();

  /** 帧级作用域缓存：通过引用计数确保仅在单次批量求值/单次查询周期内有效 */
  private evalFrameDepth = 0;
  private frameFieldSources: FieldSources | undefined;
  private frameEvalCard: Map<string, EvaluatedCardStats> = new Map();
  private frameLayer1Traits: Map<string, Set<string>> = new Map();
  private frameLoseAbilities: Map<string, boolean> = new Map();
  /** 记录是否发生过递归防环降级；命中防环的降级结果绝不写入帧缓存 */
  private cycleFallbackCount = 0;

  constructor(
    private state: GameState,
    private cardDb: ICardDatabase,
    private getCardsInZone: (playerId: string, zone: CardInstance['zone']) => CardInstance[],
    private getFieldRoles: (playerId: string) => CardInstance[]
  ) {
    this.registerBuiltinStaticRules();
  }

  /** 开启一个帧级求值缓存作用域 (支持嵌套引用计数) */
  beginEvalFrame(): void {
    this.evalFrameDepth += 1;
  }

  /** 结束一个帧级求值缓存作用域；计数归零时清空全部帧缓存 */
  endEvalFrame(): void {
    if (this.evalFrameDepth > 0) {
      this.evalFrameDepth -= 1;
      if (this.evalFrameDepth === 0) {
        this.invalidateEvalFrame();
      }
    }
  }

  /** 在帧级求值缓存作用域内执行回调，异常安全自动清理 */
  withEvalFrame<T>(fn: () => T): T {
    this.beginEvalFrame();
    try {
      return fn();
    } finally {
      this.endEvalFrame();
    }
  }

  /** 主动使当前帧级缓存失效 (用于状态回滚或动态规则变更) */
  invalidateEvalFrame(): void {
    this.frameFieldSources = undefined;
    this.frameEvalCard.clear();
    this.frameLayer1Traits.clear();
    this.frameLoseAbilities.clear();
  }

  /** 注册自定义持续判定型永久能力 (便于卡牌包扩展与规则测试) */
  registerStaticRule(rule: StaticContinuousRule): void {
    const idx = this.staticRules.findIndex((r) => r.id === rule.id);
    if (idx >= 0) {
      this.staticRules[idx] = rule;
    } else {
      this.staticRules.push(rule);
    }
    this.rebuildRuleBuckets();
    this.invalidateEvalFrame();
  }

  private rebuildRuleBuckets(): void {
    const traitBuckets = createEmptyRuleBuckets();
    const loseAbilitiesBuckets = createEmptyRuleBuckets();
    const layer1Buckets = createEmptyRuleBuckets();
    const layer2Buckets = createEmptyRuleBuckets();
    let hasCostZoneProhibitionRules = false;

    for (let i = 0; i < this.staticRules.length; i++) {
      const rule = this.staticRules[i]!;
      if (rule.layer === 'NON_STAT') {
        addRuleToBuckets(layer1Buckets, rule);
        if (rule.providesTraits) {
          addRuleToBuckets(traitBuckets, rule);
        }
        if (rule.providesLoseAbilities) {
          addRuleToBuckets(loseAbilitiesBuckets, rule);
        }
        if (
          (!rule.sourceZones || rule.sourceZones.includes('COST')) &&
          (rule.providesProhibitions === undefined ||
            rule.providesProhibitions.includes('CANNOT_DISCARD_HIDDEN_COST_AT_END'))
        ) {
          hasCostZoneProhibitionRules = true;
        }
      } else {
        addRuleToBuckets(layer2Buckets, rule);
      }
    }

    this.traitBuckets = traitBuckets;
    this.loseAbilitiesBuckets = loseAbilitiesBuckets;
    this.layer1Buckets = layer1Buckets;
    this.layer2Buckets = layer2Buckets;
    this.hasCostZoneProhibitionRules = hasCostZoneProhibitionRules;
  }

  private visitCandidateRules(
    buckets: RuleBuckets,
    targetCard: CardInstance,
    sources: FieldSources,
    visitor: (rule: StaticContinuousRule, source: CardInstance) => boolean | void
  ): boolean {
    if (!buckets.hasAny) return false;

    if (buckets.sourceZones.byCardNumber.size > 0 || buckets.sourceZones.wildcard.length > 0) {
      const byNum = buckets.sourceZones.byCardNumber.get(targetCard.cardNumber);
      if (byNum) {
        for (let i = 0; i < byNum.length; i++) {
          const rule = byNum[i]!;
          if (rule.sourceZones!.includes(targetCard.zone)) {
            if (visitor(rule, targetCard) === true) return true;
          }
        }
      }
      const wc = buckets.sourceZones.wildcard;
      for (let i = 0; i < wc.length; i++) {
        const rule = wc[i]!;
        if (rule.sourceZones!.includes(targetCard.zone)) {
          if (visitor(rule, targetCard) === true) return true;
        }
      }
    }

    if (this.visitGroupSources(buckets.fieldRole, sources.allFieldTopCards, visitor)) return true;
    if (this.visitGroupSources(buckets.partner, sources.allActivePartners, visitor)) return true;
    if (this.visitGroupSources(buckets.underneath, sources.allActiveUnderneath, visitor)) return true;
    if (this.visitGroupSources(buckets.equipped, sources.allAttachedEquipment, visitor)) return true;
    return false;
  }

  private visitGroupSources(
    group: RuleGroup,
    sources: CardInstance[],
    visitor: (rule: StaticContinuousRule, source: CardInstance) => boolean | void
  ): boolean {
    if (sources.length === 0) return false;
    const hasWildcard = group.wildcard.length > 0;
    if (group.byCardNumber.size === 0 && !hasWildcard) return false;
    for (let s = 0; s < sources.length; s++) {
      const source = sources[s]!;
      const byNum = group.byCardNumber.get(source.cardNumber);
      if (byNum) {
        for (let i = 0; i < byNum.length; i++) {
          if (visitor(byNum[i]!, source) === true) return true;
        }
      }
      if (hasWildcard) {
        const wc = group.wildcard;
        for (let i = 0; i < wc.length; i++) {
          if (visitor(wc[i]!, source) === true) return true;
        }
      }
    }
    return false;
  }

  private getDef(card: CardInstance) {
    return this.cardDb.getCard(card.cardNumber) || (card.cardId ? this.cardDb.getCard(card.cardId) : undefined);
  }

  /**
   * 10.14 暮形态 / 晖形态是否有效：操控玩家信号球区最下方卡牌的实时费用为偶数 / 奇数 (BP02-024 +1 后生效)
   */
  isFormActive(playerId: string, form: '暮' | '晖'): boolean {
    if (this.evalFrameDepth === 0) {
      return this.withEvalFrame(() => this.isFormActive(playerId, form));
    }
    const bottom = this.getCardsInZone(playerId, 'SIGNAL_ORB')[0];
    if (!bottom || !bottom.isFaceUp) return false;
    const def = this.getDef(bottom);
    if (!def) return false;
    const cost = this.getEffectiveCardCost(bottom.instanceId);
    return form === '暮' ? cost % 2 === 0 : cost % 2 === 1;
  }

  /** 获取卡牌自身基本 PP (含 8.9.1.a setBasePP 覆写，供 4.18.2 / 8.13.4.b / Q&A·8 统一使用) */
  private getCardBasePP(card: CardInstance | undefined): number {
    if (!card) return 0;
    const def = this.getDef(card);
    let basePP = def?.basePP ?? 0;
    const rawMods = card.modifiers;
    if (!rawMods || rawMods.length === 0) return basePP;
    let overrides: CardModifier[] | undefined;
    for (let i = 0; i < rawMods.length; i++) {
      const m = rawMods[i]!;
      if (m.setBasePP !== undefined) {
        if (!overrides) overrides = [m];
        else overrides.push(m);
      }
    }
    if (overrides) {
      if (overrides.length > 1) {
        overrides.sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
      }
      for (const m of overrides) {
        basePP = m.setBasePP!;
      }
    }
    return basePP;
  }

  /** 获取卡牌自身基本 DP (含 setBaseDP 覆写，供 8.13.4.b / Q&A·8 统一使用) */
  private getCardBaseDP(card: CardInstance | undefined): number {
    if (!card) return 0;
    const def = this.getDef(card);
    let baseDP = def?.baseDP ?? 0;
    const rawMods = card.modifiers;
    if (!rawMods || rawMods.length === 0) return baseDP;
    let overrides: CardModifier[] | undefined;
    for (let i = 0; i < rawMods.length; i++) {
      const m = rawMods[i]!;
      if (m.setBaseDP !== undefined) {
        if (!overrides) overrides = [m];
        else overrides.push(m);
      }
    }
    if (overrides) {
      if (overrides.length > 1) {
        overrides.sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
      }
      for (const m of overrides) {
        baseDP = m.setBaseDP!;
      }
    }
    return baseDP;
  }

  /** 收集战场各位置上的永久能力来源集合 (含顶层角色/辅助机/独立装备，以及搭档/下方/附着装备) */
  private collectFieldSources(): FieldSources {
    if (this.evalFrameDepth > 0 && this.frameFieldSources) {
      return this.frameFieldSources;
    }
    const allFieldTopCards: CardInstance[] = [];
    const seenTopIds = new Set<string>();
    for (const pid of [this.state.activePlayerId, this.state.nonActivePlayerId]) {
      for (const slot of this.state.battlefields[pid] ?? []) {
        for (const id of [slot.roleCardId, slot.assistCardId, slot.standaloneEquipmentId]) {
          if (!id || seenTopIds.has(id)) continue;
          const c = this.state.cards[id];
          if (c) {
            seenTopIds.add(id);
            allFieldTopCards.push(c);
          }
        }
      }
    }
    const allActivePartners: CardInstance[] = [];
    const allActiveUnderneath: CardInstance[] = [];
    const allAttachedEquipment: CardInstance[] = [];
    for (let i = 0; i < allFieldTopCards.length; i++) {
      const r = allFieldTopCards[i]!;
      if (r.partnerCardId) {
        const p = this.state.cards[r.partnerCardId];
        if (p && p.zone === 'BATTLEFIELD') {
          allActivePartners.push(p);
        }
      }
      const underIds = r.underneathCardIds;
      if (underIds && underIds.length > 0) {
        for (let j = 0; j < underIds.length; j++) {
          const uCard = this.state.cards[underIds[j]!];
          if (uCard) allActiveUnderneath.push(uCard);
        }
      }
      if (r.attachedEquipmentId) {
        const eq = this.state.cards[r.attachedEquipmentId];
        if (eq) allAttachedEquipment.push(eq);
      }
      const extraEqIds = r.extraAttachedEquipmentIds;
      if (extraEqIds && extraEqIds.length > 0) {
        for (let j = 0; j < extraEqIds.length; j++) {
          const eq = this.state.cards[extraEqIds[j]!];
          if (eq) allAttachedEquipment.push(eq);
        }
      }
    }
    const result: FieldSources = {
      allFieldTopCards,
      allActivePartners,
      allActiveUnderneath,
      allAttachedEquipment,
    };
    if (this.evalFrameDepth > 0) {
      this.frameFieldSources = result;
    }
    return result;
  }

  /**
   * 8.3.4 检查卡牌自身固有能力是否因持续效果而处于「失去能力 / 效果无效」状态 (含静态永久能力导致的失能)
   */
  hasLostInherentAbilities(cardInstanceId: string, visited: Set<string> = new Set()): boolean {
    if (this.evalFrameDepth === 0) {
      return this.withEvalFrame(() => this.hasLostInherentAbilities(cardInstanceId, visited));
    }
    const card = this.state.cards[cardInstanceId];
    if (!card) return false;
    const mods = card.modifiers;
    if (mods) {
      for (let i = 0; i < mods.length; i++) {
        if (mods[i]!.loseAbilities === true) return true;
      }
    }
    if (!this.loseAbilitiesBuckets.hasAny) return false;
    if (visited.has(cardInstanceId) || this.activeLoseAbilitiesIds.has(cardInstanceId)) {
      this.cycleFallbackCount += 1;
      return false;
    }

    const isTopLevelCall = visited.size === 0;
    if (isTopLevelCall && this.frameLoseAbilities.has(cardInstanceId)) {
      return this.frameLoseAbilities.get(cardInstanceId)!;
    }

    const prevCycleCount = this.cycleFallbackCount;
    visited.add(cardInstanceId);
    this.activeLoseAbilitiesIds.add(cardInstanceId);
    try {
      const fieldSources = this.collectFieldSources();
      const baseCtx: StaticRuleContext = {
        state: this.state,
        cardDb: this.cardDb,
        getCardsInZone: this.getCardsInZone,
        getFieldRoles: this.getFieldRoles,
      };
      let cachedTraits: Set<string> | undefined;
      const getTargetTraits = (): Set<string> => {
        if (!cachedTraits) {
          cachedTraits = this.evaluateLayer1Traits(cardInstanceId, visited);
        }
        return cachedTraits;
      };

      const lost = this.visitCandidateRules(
        this.loseAbilitiesBuckets,
        card,
        fieldSources,
        (rule, source): boolean => {
          if (!rule.matchSource(source, baseCtx)) return false;
          if (source.instanceId !== cardInstanceId && this.hasLostInherentAbilities(source.instanceId, visited)) {
            return false;
          }
          const finalTraits = getTargetTraits();
          const evalCtx: StaticRuleEvaluationContext = {
            ...baseCtx,
            targetTraits: finalTraits,
            targetKeywords: EMPTY_STRING_SET,
            isOpponentTurnForSource: this.state.activePlayerId !== source.controllerPlayerId,
            hasCardTrait: (id, trait) =>
              id === cardInstanceId ? finalTraits.has(trait) : this.evaluateLayer1Traits(id, visited).has(trait),
          };
          const contrib = rule.evaluate(source, card, evalCtx);
          return Boolean(contrib?.loseAbilities);
        }
      );

      if (isTopLevelCall && this.cycleFallbackCount === prevCycleCount) {
        this.frameLoseAbilities.set(cardInstanceId, lost);
      }
      return lost;
    } finally {
      this.activeLoseAbilitiesIds.delete(cardInstanceId);
    }
  }

  /**
   * 8.9.1 完整分层计算一张卡牌的实时情报 (PP / DP / 充能数 / 词条 / 特征 / 能力状态)
   */
  evaluateCard(cardInstanceId: string): EvaluatedCardStats {
    if (this.evalFrameDepth === 0) {
      return this.withEvalFrame(() => this.evaluateCard(cardInstanceId));
    }
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
        grantedTriggerIds: [],
        grantedTriggerEntries: [],
        canAttackPlayerOnEnterTurn: false,
      };
    }

    if (this.evaluatingCardIds.has(cardInstanceId)) {
      this.cycleFallbackCount += 1;
      const cardDef = this.getDef(card);
      const parsedFallback = card.zone === 'BATTLEFIELD' ? parseInherentKeywords(cardDef?.rulesText) : [];
      const fallbackCharge = parseInherentChargeCount(parsedFallback);
      return {
        pp: this.getCardBasePP(card),
        dp: this.getCardBaseDP(card),
        charge: fallbackCharge ?? 1,
        keywords: [],
        traits: Array.from(expandBaseTraits(cardDef?.traits)),
        abilitiesLost: false,
        prohibitions: [],
        treatedAsNames: [],
        treatedAsOrbColors: cardDef?.signalOrb ? [cardDef.signalOrb as SignalOrbColor] : [],
        orbValue: cardDef?.signalOrb ? 1 : 0,
        grantedTriggerIds: [],
        grantedTriggerEntries: [],
        canAttackPlayerOnEnterTurn: false,
        cardType: getModifierEffectiveCardType(card, cardDef),
      };
    }

    const cached = this.frameEvalCard.get(cardInstanceId);
    if (cached) {
      return cached;
    }

    const prevCycleCount = this.cycleFallbackCount;
    const cardDef = this.getDef(card);
    this.evaluatingCardIds.add(cardInstanceId);
    try {

    // ==================== Layer 0: 8.9.1.a 卡牌基本情报 ====================
    let pp = this.getCardBasePP(card);
    let baseDPValue = cardDef?.baseDP ?? 0;

    // 4.18.2 装备牌基本 PP (支持双持装备) 与 8.13.4.b 协战搭档基本 PP/DP 为规则加成，
    // 按 Q&A·6 / Q&A·10 在「PP/DP 变为 X」之后按当前附着变化实时净增减
    let currentEquipPP = 0;
    if (card.attachedEquipmentId) {
      currentEquipPP += this.getCardBasePP(this.state.cards[card.attachedEquipmentId]);
    }
    if (card.extraAttachedEquipmentIds && card.extraAttachedEquipmentIds.length > 0) {
      for (const eqId of card.extraAttachedEquipmentIds) {
        currentEquipPP += this.getCardBasePP(this.state.cards[eqId]);
      }
    }
    let currentPartnerPP = 0;
    let currentPartnerDP = 0;
    if (card.zone === 'BATTLEFIELD' && card.partnerCardId) {
      const partnerCard = this.state.cards[card.partnerCardId];
      if (partnerCard) {
        currentPartnerPP += this.getCardBasePP(partnerCard);
        currentPartnerDP += this.getCardBaseDP(partnerCard);
      }
    }
    const currentRulePP = currentEquipPP + currentPartnerPP;

    const parsedInherent = card.zone === 'BATTLEFIELD' ? parseInherentKeywords(cardDef?.rulesText) : [];
    const inherentCharge = parseInherentChargeCount(parsedInherent);
    const baseKeywords = parsedInherent
      .filter((k) => !k.form || this.isFormActive(card.controllerPlayerId, k.form))
      .map((k) => k.keyword);

    const traitsSet = expandBaseTraits(cardDef?.traits);
    const keywordsSet = new Set<string>(baseKeywords);
    const prohibitionsSet = new Set<ProhibitionFlag>();
    const treatedAsNamesSet = new Set<string>();
    const grantedTriggersSet = new Set<string>();
    const grantedTriggerEntries: Array<{ triggerId: string; grantKey: string }> = [];
    let canAttackPlayerOnEnterTurn = false;
    let unblockableMaxPP: number | undefined;
    let canDualEquipFengren = false;
    let effectiveCardType = cardDef?.cardType;
    let costDeltaTotal = 0;
    let setCostOverride: number | undefined;
    let canAttackReadyRolesMaxCost: number | undefined;
    let mustBeAttackTarget = false;
    const orbColorsSet = new Set<SignalOrbColor>();
    if (cardDef?.signalOrb) {
      orbColorsSet.add(cardDef.signalOrb as SignalOrbColor);
    }
    let orbValue = cardDef?.signalOrb ? 1 : 0;

    // 固有禁止能力：【永】：该牌不能攻击 (帕瓦、库洛洛；若失去能力 8.3.4 则在下方清除)
    const hasInherentCannotAttack = Boolean(cardDef?.rulesText?.includes('【永】：该牌不能攻击'));
    let inherentCannotAttackActive = hasInherentCannotAttack;

    const baseCtx: StaticRuleContext = {
      state: this.state,
      cardDb: this.cardDb,
      getCardsInZone: this.getCardsInZone,
      getFieldRoles: this.getFieldRoles,
    };

    const fieldSources = this.collectFieldSources();

    // ==================== Layer 1 (8.9.1.b / 8.9.1.d) 两阶段计算 ====================
    // Phase 1A：先行结算全部提供/清除特征的效果 (含 modifiers 与 providesTraits 静态规则)，严格按时间戳排序
    const traitOps: TimestampedNonStat[] = [];
    for (const m of card.modifiers ?? []) {
      if (m.addTraits?.length || m.clearBaseTraits) {
        traitOps.push({
          timestamp: m.timestamp ?? 0,
          addTraits: m.addTraits,
          clearBaseTraits: m.clearBaseTraits,
        });
      }
    }
    if (this.traitBuckets.hasAny) {
      this.visitCandidateRules(this.traitBuckets, card, fieldSources, (rule, source) => {
        if (!rule.matchSource(source, baseCtx)) return;
        if (this.hasLostInherentAbilities(source.instanceId)) return;
        const evalCtx: StaticRuleEvaluationContext = {
          ...baseCtx,
          targetTraits: traitsSet,
          targetKeywords: keywordsSet,
          isOpponentTurnForSource: this.state.activePlayerId !== source.controllerPlayerId,
          hasCardTrait: (id, trait) =>
            id === card.instanceId ? traitsSet.has(trait) : this.evaluateLayer1Traits(id).has(trait),
        };
        const contrib = rule.evaluate(source, card, evalCtx);
        if (!contrib || (!contrib.clearBaseTraits && !contrib.addTraits?.length)) return;
        traitOps.push({
          timestamp: source.enteredZoneTimestamp ?? 0,
          addTraits: contrib.addTraits,
          clearBaseTraits: contrib.clearBaseTraits,
        });
      });
    }
    if (traitOps.length > 1) {
      traitOps.sort((a, b) => a.timestamp - b.timestamp);
    }
    for (const op of traitOps) {
      if (op.clearBaseTraits) traitsSet.clear();
      if (op.addTraits) {
        for (const t of op.addTraits) traitsSet.add(t);
      }
    }

    // Phase 1B：特征最终确定后，再收集并应用所有非特征的 Layer 1 效果，纯粹按时间戳升序 (严格弱序)
    const nonStatOps: TimestampedNonStat[] = [];
    if (card.grantedKeywords && card.grantedKeywords.length > 0) {
      nonStatOps.push({ timestamp: 0, keywords: card.grantedKeywords });
    }
    for (const m of card.modifiers ?? []) {
      if (
        m.keywords?.length ||
        m.removeKeywords?.length ||
        m.loseAbilities ||
        m.setCardType !== undefined ||
        m.costDelta !== undefined ||
        m.setCost !== undefined ||
        m.canAttackReadyRolesMaxCost !== undefined ||
        m.mustBeAttackTarget ||
        m.prohibitions?.length ||
        m.treatedAsOrbColors?.length ||
        m.orbValue !== undefined ||
        m.treatedAsNames?.length ||
        m.grantedTriggerIds?.length ||
        m.canAttackPlayerOnEnterTurn ||
        m.unblockableMaxPP !== undefined
      ) {
        nonStatOps.push({
          timestamp: m.timestamp ?? 0,
          keywords: m.keywords,
          removeKeywords: m.removeKeywords,
          loseAbilities: m.loseAbilities,
          setCardType: m.setCardType,
          costDelta: m.costDelta,
          setCost: m.setCost,
          canAttackReadyRolesMaxCost: m.canAttackReadyRolesMaxCost,
          mustBeAttackTarget: m.mustBeAttackTarget,
          prohibitions: m.prohibitions,
          treatedAsOrbColors: m.treatedAsOrbColors,
          orbValue: m.orbValue,
          treatedAsNames: m.treatedAsNames,
          grantedTriggerIds: m.grantedTriggerIds,
          grantKey: m.id ?? `mod:${m.timestamp ?? 0}`,
          canAttackPlayerOnEnterTurn: m.canAttackPlayerOnEnterTurn,
          unblockableMaxPP: m.unblockableMaxPP,
        });
      }
    }

    if (this.layer1Buckets.hasAny) {
      this.visitCandidateRules(this.layer1Buckets, card, fieldSources, (rule, source) => {
        if (!rule.matchSource(source, baseCtx)) return;
        if (this.hasLostInherentAbilities(source.instanceId)) return;
        const evalCtx: StaticRuleEvaluationContext = {
          ...baseCtx,
          targetTraits: traitsSet,
          targetKeywords: keywordsSet,
          isOpponentTurnForSource: this.state.activePlayerId !== source.controllerPlayerId,
          hasCardTrait: (id, trait) =>
            id === card.instanceId ? traitsSet.has(trait) : this.evaluateLayer1Traits(id).has(trait),
        };
        const contrib = rule.evaluate(source, card, evalCtx);
        if (!contrib) return;
        const hasPhase1BFields = Boolean(
          contrib.keywords?.length ||
            contrib.removeKeywords?.length ||
            contrib.loseAbilities ||
            contrib.setCardType !== undefined ||
            contrib.costDelta !== undefined ||
            contrib.setCost !== undefined ||
            contrib.canAttackReadyRolesMaxCost !== undefined ||
            contrib.mustBeAttackTarget ||
            contrib.prohibitions?.length ||
            contrib.treatedAsOrbColors?.length ||
            contrib.orbValue !== undefined ||
            contrib.treatedAsNames?.length ||
            contrib.grantedTriggerIds?.length ||
            contrib.canAttackPlayerOnEnterTurn ||
            contrib.unblockableMaxPP !== undefined ||
            contrib.canDualEquipFengren
        );
        if (!hasPhase1BFields) return;
        nonStatOps.push({
          timestamp: source.enteredZoneTimestamp ?? 0,
          keywords: contrib.keywords,
          removeKeywords: contrib.removeKeywords,
          loseAbilities: contrib.loseAbilities,
          setCardType: contrib.setCardType,
          costDelta: contrib.costDelta,
          setCost: contrib.setCost,
          canAttackReadyRolesMaxCost: contrib.canAttackReadyRolesMaxCost,
          mustBeAttackTarget: contrib.mustBeAttackTarget,
          prohibitions: contrib.prohibitions,
          treatedAsOrbColors: contrib.treatedAsOrbColors,
          orbValue: contrib.orbValue,
          treatedAsNames: contrib.treatedAsNames,
          grantedTriggerIds: contrib.grantedTriggerIds,
          grantKey: `${rule.id}:${source.instanceId}`,
          canAttackPlayerOnEnterTurn: contrib.canAttackPlayerOnEnterTurn,
          unblockableMaxPP: contrib.unblockableMaxPP,
          canDualEquipFengren: contrib.canDualEquipFengren,
        });
      });
    }

    // 8.9.1.e 纯时间戳严格弱序排序（确保失能前后赋予的能力严格按获得/失能时间顺序生效）
    if (nonStatOps.length > 1) {
      nonStatOps.sort((a, b) => a.timestamp - b.timestamp);
    }

    let abilitiesLost = false;
    let latestLoseAbilitiesTs = -1;
    let cannotGainAbilities = false;
    for (const op of nonStatOps) {
      if (op.loseAbilities) {
        abilitiesLost = true;
        latestLoseAbilitiesTs = Math.max(latestLoseAbilitiesTs, op.timestamp);
        // 8.3.4 / Q&A·3 / Q&A·4：失去能力清空当前已有的固有与早先赋予的关键字/赋予触发，并解除自身固有「不能攻击」
        // 后续时间戳晚于 loseAbilities 的效果若未被 CANNOT_GAIN_ABILITIES 阻止则可生效
        keywordsSet.clear();
        grantedTriggersSet.clear();
        grantedTriggerEntries.length = 0;
        unblockableMaxPP = undefined;
        canDualEquipFengren = false;
        canAttackReadyRolesMaxCost = undefined;
        mustBeAttackTarget = false;
        inherentCannotAttackActive = false;
      }
      if (op.prohibitions) {
        for (const p of op.prohibitions) {
          prohibitionsSet.add(p);
          if (p === 'CANNOT_GAIN_ABILITIES') cannotGainAbilities = true;
        }
      }
      if (op.setCardType !== undefined) {
        effectiveCardType = op.setCardType;
      }
      if (op.costDelta !== undefined) {
        costDeltaTotal += op.costDelta;
      }
      if (op.setCost !== undefined) {
        setCostOverride = op.setCost;
      }
      if (op.canAttackReadyRolesMaxCost !== undefined && !cannotGainAbilities) {
        canAttackReadyRolesMaxCost =
          canAttackReadyRolesMaxCost === undefined
            ? op.canAttackReadyRolesMaxCost
            : Math.max(canAttackReadyRolesMaxCost, op.canAttackReadyRolesMaxCost);
      }
      if (op.mustBeAttackTarget) {
        mustBeAttackTarget = true;
      }
      if (op.keywords && !cannotGainAbilities) {
        for (const kw of op.keywords) keywordsSet.add(kw);
      }
      if (op.grantedTriggerIds && !cannotGainAbilities) {
        const gKey = op.grantKey ?? String(op.timestamp);
        for (const tid of op.grantedTriggerIds) {
          grantedTriggersSet.add(tid);
          grantedTriggerEntries.push({ triggerId: tid, grantKey: gKey });
        }
      }
      if (op.canAttackPlayerOnEnterTurn) {
        canAttackPlayerOnEnterTurn = true;
      }
      if (op.unblockableMaxPP !== undefined) {
        unblockableMaxPP =
          unblockableMaxPP === undefined ? op.unblockableMaxPP : Math.max(unblockableMaxPP, op.unblockableMaxPP);
      }
      if (op.canDualEquipFengren) {
        canDualEquipFengren = true;
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
    if (inherentCannotAttackActive) {
      prohibitionsSet.add('CANNOT_ATTACK');
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
        m.setBaseDP !== undefined ||
        m.charge !== undefined ||
        m.setCharge !== undefined
      ) {
        statOps.push({
          timestamp: m.timestamp ?? 0,
          pp: m.pp,
          setPP: m.setPP,
          baselineRuleCardIds: m.baselineRuleCardIds,
          dp: m.dp,
          setDP: m.setDP,
          baselinePartnerCardId: m.baselinePartnerCardId,
          setBaseDP: m.setBaseDP,
          charge: m.charge,
          chargeIsAbility: m.chargeIsAbility,
          setCharge: m.setCharge,
          appliedByPlayerId: m.appliedByPlayerId,
        });
      }
    }

    if (this.layer2Buckets.hasAny) {
      this.visitCandidateRules(this.layer2Buckets, card, fieldSources, (rule, source) => {
        if (!rule.matchSource(source, baseCtx)) return;
        // 8.3.4 失去能力的来源卡其【永】不产生效果 (Q&A·10 BP04-001 失去永久能力时 PP 变为 0)
        const sourceLost =
          source.instanceId === card.instanceId ? abilitiesLost : this.hasLostInherentAbilities(source.instanceId);
        if (sourceLost) return;
        const evalCtx: StaticRuleEvaluationContext = {
          ...baseCtx,
          targetTraits: traitsSet,
          targetKeywords: keywordsSet,
          isOpponentTurnForSource: this.state.activePlayerId !== source.controllerPlayerId,
          hasCardTrait: (id, trait) =>
            id === card.instanceId ? traitsSet.has(trait) : this.evaluateLayer1Traits(id).has(trait),
        };
        const contrib = rule.evaluate(source, card, evalCtx);
        if (!contrib) return;
        statOps.push({
          timestamp: source.enteredZoneTimestamp ?? 0,
          pp: contrib.pp,
          setPP: contrib.setPP,
          dp: contrib.dp,
          setDP: contrib.setDP,
          setBaseDP: contrib.setBaseDP,
          charge: contrib.charge,
          chargeIsAbility: contrib.chargeIsAbility,
          setCharge: contrib.setCharge,
          appliedByPlayerId: contrib.appliedByPlayerId ?? source.controllerPlayerId,
        });
      });
    }

    // 8.9.1.e 按时间戳升序依次适用 (支持「基本DP变为 X」先覆盖基值，「PP/DP 变为 X」覆盖此前增减)
    if (statOps.length > 1) {
      statOps.sort((a, b) => a.timestamp - b.timestamp);
    }
    for (const op of statOps) {
      if (op.setBaseDP !== undefined) baseDPValue = op.setBaseDP;
    }
    let dp = baseDPValue;

    const preventOppPPDelta = prohibitionsSet.has('CANNOT_MODIFY_PP_BY_OPPONENT');
    for (const op of statOps) {
      // Q&A·9 BP04-016: 「PP 不会因对方效果增减」挡住对方的 pp +/-，但挡不住「PP 变为 X」(setPP)
      // Q&A·6 / Q&A·10: setPP 覆盖当前含装备与搭档在内总 PP，故减去施加瞬间的规则加成基线，并在 Layer 2 末尾加回当前规则加成
      if (op.setPP !== undefined) {
        const baselineRulePP = (op.baselineRuleCardIds ?? []).reduce(
          (sum, id) => sum + this.getCardBasePP(this.state.cards[id]),
          0
        );
        pp = op.setPP - baselineRulePP;
      }
      if (op.pp !== undefined) {
        const isFromOpponent =
          op.appliedByPlayerId !== undefined && op.appliedByPlayerId !== card.controllerPlayerId;
        if (!(preventOppPPDelta && isFromOpponent)) {
          pp += op.pp;
        }
      }
      if (op.setDP !== undefined) {
        const baselinePartnerDP = op.baselinePartnerCardId
          ? this.getCardBaseDP(this.state.cards[op.baselinePartnerCardId])
          : 0;
        dp = op.setDP - baselinePartnerDP;
      }
      if (op.dp !== undefined) dp += op.dp;
      if (op.setCharge !== undefined) charge = op.setCharge;
      if (op.charge !== undefined) {
        // Q&A·1 / Q&A·3 (BP01-025/BP01-050)：以「获得【充能+X】能力」形式赋予的充能，
        // 在宿主失去能力时丢失先获部分，但在失能之后新获得的若未受 CANNOT_GAIN_ABILITIES 阻止则保留
        if (!op.chargeIsAbility || (!cannotGainAbilities && (latestLoseAbilitiesTs < 0 || op.timestamp > latestLoseAbilitiesTs))) {
          charge += op.charge;
        }
      }
    }

    // 4.18.2 / 8.13.4.b 规则加成的装备基本 PP 与协战搭档基本 PP/DP 在最后统一叠加，满足卸装/解协战按规则扣减 (Q&A·6/10)
    pp += currentRulePP;
    dp += currentPartnerDP;

    const evaluated: EvaluatedCardStats = {
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
      grantedTriggerIds: Array.from(grantedTriggersSet),
      grantedTriggerEntries,
      canAttackPlayerOnEnterTurn,
      unblockableMaxPP,
      canDualEquipFengren,
      cardType: effectiveCardType,
      costDelta: costDeltaTotal !== 0 ? costDeltaTotal : undefined,
      setCost: setCostOverride,
      canAttackReadyRolesMaxCost,
      mustBeAttackTarget,
    };
    if (this.cycleFallbackCount === prevCycleCount) {
      this.frameEvalCard.set(cardInstanceId, evaluated);
    }
    return evaluated;
    } finally {
      this.evaluatingCardIds.delete(cardInstanceId);
    }
  }

  hasKeyword(cardInstanceId: string, keyword: string): boolean {
    return this.evaluateCard(cardInstanceId).keywords.includes(keyword);
  }

  hasGrantedTrigger(cardInstanceId: string, triggerId: string): boolean {
    return this.evaluateCard(cardInstanceId).grantedTriggerIds.includes(triggerId);
  }

  /**
   * Q&A·7：返回当前卡牌上某一被赋予自动能力的全部独立实例键（两张《荣光护盾》产生两条独立键）
   */
  getGrantedTriggerKeys(cardInstanceId: string, triggerId: string): string[] {
    return (this.evaluateCard(cardInstanceId).grantedTriggerEntries ?? [])
      .filter((e) => e.triggerId === triggerId)
      .map((e) => e.grantKey);
  }

  /**
   * 8.13.4.b.1 / 8.9 计算卡牌当前实时有效费用 (协战角色在战场时费用增加其搭档的基本费用，信号球区等适用 costDelta / setCost)
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
    const evaluated = this.evaluateCard(cardInstanceId);
    if (evaluated.setCost !== undefined) {
      return Math.max(0, evaluated.setCost);
    }
    cost += evaluated.costDelta ?? 0;
    return Math.max(0, cost);
  }

  /** 获取卡牌当前有效卡牌类型 (兼容 PR-041 辅助机变为角色牌) */
  getEffectiveCardType(cardInstanceId: string): CardType | undefined {
    const card = this.state.cards[cardInstanceId];
    if (!card) return undefined;
    return this.evaluateCard(cardInstanceId).cardType ?? this.getDef(card)?.cardType;
  }

  hasTrait(cardInstanceId: string, trait: string): boolean {
    return this.evaluateLayer1Traits(cardInstanceId).has(trait);
  }

  /**
   * 1.3.3 查询卡牌当前生效的禁止效果标志
   */
  hasProhibition(cardInstanceId: string, flag: ProhibitionFlag): boolean {
    if (flag === 'CANNOT_DISCARD_HIDDEN_COST_AT_END' && !this.hasCostZoneProhibitionRules) {
      const card = this.state.cards[cardInstanceId];
      if (!card) return false;
      const mods = card.modifiers;
      if (!mods || !mods.some((m) => m.prohibitions?.includes('CANNOT_DISCARD_HIDDEN_COST_AT_END'))) {
        return false;
      }
    }
    return this.evaluateCard(cardInstanceId).prohibitions.includes(flag);
  }

  /**
   * 查询卡牌当前是否视为具有指定卡牌名称 (含原卡名与「视为」效果，如 Q&A·4/5 BP02-040)
   */
  hasCardName(cardInstanceId: string, name: string): boolean {
    const card = this.state.cards[cardInstanceId];
    if (!card) return false;
    const def = this.getDef(card);
    const targetName = normalizeCardName(name);
    if (def && normalizeCardName(def.name) === targetName) return true;
    return this.evaluateCard(cardInstanceId).treatedAsNames.some((n) => normalizeCardName(n) === targetName);
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
  private evaluateLayer1Traits(cardInstanceId: string, visited: Set<string> = new Set()): Set<string> {
    if (this.evalFrameDepth === 0) {
      return this.withEvalFrame(() => this.evaluateLayer1Traits(cardInstanceId, visited));
    }
    const card = this.state.cards[cardInstanceId];
    if (!card) return new Set();

    const isTopLevelCall = visited.size === 0;
    if (isTopLevelCall && this.frameLayer1Traits.has(cardInstanceId)) {
      return this.frameLayer1Traits.get(cardInstanceId)!;
    }

    const prevCycleCount = this.cycleFallbackCount;
    const cardDef = this.getDef(card);
    const traitsSet = expandBaseTraits(cardDef?.traits);
    const ops: Array<{ timestamp: number; clearBaseTraits?: boolean; addTraits?: string[] }> = [];
    for (const m of card.modifiers ?? []) {
      if (m.clearBaseTraits || m.addTraits?.length) {
        ops.push({ timestamp: m.timestamp ?? 0, clearBaseTraits: m.clearBaseTraits, addTraits: m.addTraits });
      }
    }
    if (this.traitBuckets.hasAny) {
      const baseCtx: StaticRuleContext = {
        state: this.state,
        cardDb: this.cardDb,
        getCardsInZone: this.getCardsInZone,
        getFieldRoles: this.getFieldRoles,
      };
      const fieldSources = this.collectFieldSources();
      this.visitCandidateRules(this.traitBuckets, card, fieldSources, (rule, source) => {
        if (!rule.matchSource(source, baseCtx)) return;
        if (visited.has(source.instanceId)) {
          this.cycleFallbackCount += 1;
          return;
        }
        if (source.instanceId !== cardInstanceId && this.hasLostInherentAbilities(source.instanceId, visited)) {
          return;
        }
        const contrib = rule.evaluate(source, card, {
          ...baseCtx,
          targetTraits: traitsSet,
          targetKeywords: EMPTY_STRING_SET,
          isOpponentTurnForSource: this.state.activePlayerId !== source.controllerPlayerId,
          hasCardTrait: (id, trait) =>
            id === card.instanceId
              ? traitsSet.has(trait)
              : Boolean(this.state.cards[id] && expandBaseTraits(this.getDef(this.state.cards[id]!)?.traits).has(trait)),
        });
        if (contrib?.clearBaseTraits || contrib?.addTraits?.length) {
          ops.push({
            timestamp: source.enteredZoneTimestamp ?? 0,
            clearBaseTraits: contrib.clearBaseTraits,
            addTraits: contrib.addTraits,
          });
        }
      });
    }
    if (ops.length > 1) {
      ops.sort((a, b) => a.timestamp - b.timestamp);
    }
    for (const op of ops) {
      if (op.clearBaseTraits) traitsSet.clear();
      if (op.addTraits) {
        for (const t of op.addTraits) traitsSet.add(t);
      }
    }
    if (isTopLevelCall && this.cycleFallbackCount === prevCycleCount) {
      this.frameLayer1Traits.set(cardInstanceId, traitsSet);
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
      sourceCardNumber: 'BP04-001',
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
      sourceCardNumber: 'BP04-032',
      layer: 'NON_STAT',
      sourceZones: ['SIGNAL_ORB'],
      providesProhibitions: [],
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
      sourceCardNumber: 'BP02-040',
      layer: 'NON_STAT',
      sourceZones: ['BATTLEFIELD', 'HAND', 'GRAVEYARD', 'SIGNAL_ORB', 'COST', 'PROCESSING', 'DECK'],
      providesProhibitions: [],
      matchSource: (src) => src.cardNumber === 'BP02-040',
      evaluate: (src, target) => {
        if (src.instanceId !== target.instanceId) return undefined;
        return { treatedAsNames: ['飞叶点翠'] };
      },
    });

    // BP04-016 薇拉·灼惘：【永】对方回合中，该牌的PP不会因对方的效果增减。(Q&A·9)
    this.registerStaticRule({
      id: 'static:BP04-016',
      sourceCardNumber: 'BP04-016',
      layer: 'NON_STAT',
      providesProhibitions: ['CANNOT_MODIFY_PP_BY_OPPONENT'],
      matchSource: (src) => src.cardNumber === 'BP04-016',
      evaluate: (src, target, ctx) => {
        if (src.instanceId !== target.instanceId) return undefined;
        if (!ctx.isOpponentTurnForSource) return undefined;
        return { prohibitions: ['CANNOT_MODIFY_PP_BY_OPPONENT'] };
      },
    });
  }
}

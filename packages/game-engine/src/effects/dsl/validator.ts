import type { TriggerEventType } from '@zhanshuang/shared';
import type { ICardDatabase } from '../../database/card-registry.js';
import type {
  AbilityCost,
  CardEffectSpec,
  CardFilter,
  CardTargetRef,
  CompareOp,
  ConditionExpr,
  DeclarativeStaticEffectSpec,
  DeclarativeTriggerMatcher,
  DeclarativeTriggerSpec,
  EffectStep,
  ModifierDuration,
  NumberExpr,
  OrbColorFilter,
  PlayerSide,
} from './types.js';

const VALID_SIDES = new Set<PlayerSide>(['SELF', 'OPPONENT']);
const VALID_ORB_FILTERS = new Set<OrbColorFilter>(['ANY', 'SAME', 'RED', 'BLUE', 'YELLOW']);
const VALID_DURATIONS = new Set<ModifierDuration>([
  'END_OF_TURN',
  'END_OF_NEXT_TURN',
  'END_OF_COMBAT',
  'UNTIL_LEAVE_ZONE',
]);
const VALID_COMPARE_OPS = new Set<CompareOp>(['>=', '<=', '==', '>', '<']);
const VALID_CARD_TYPES = new Set<string>(['ROLE', 'TACTICS', 'EQUIPMENT', 'ASSIST', 'SIGNAL_ORB']);
const VALID_ATTRIBUTES = new Set<string>(['FIRE', 'LIGHTNING', 'DARK', 'ICE', 'PHYSICAL', 'NONE', 'VOID']);
const VALID_CHOOSE_ZONES = new Set([
  'HAND',
  'GRAVEYARD',
  'SIGNAL_ORB',
  'COST',
  'DECK',
  'BATTLEFIELD',
  'PROCESSING',
  'HOST_UNDERNEATH',
  'SELF_UNDERNEATH',
  'OPPONENT_HAND_BLIND',
]);
const VALID_MULTI_CHOOSE_ZONES = new Set([
  'HAND',
  'GRAVEYARD',
  'SIGNAL_ORB',
  'COST',
  'DECK',
  'BATTLEFIELD',
  'PROCESSING',
  'HOST_UNDERNEATH',
  'SELF_UNDERNEATH',
]);
const VALID_USABLE_ZONES = new Set(['BATTLEFIELD', 'HAND', 'GRAVEYARD', 'SIGNAL_ORB', 'COST', 'UNDERNEATH']);
const VALID_CUSTOM_HANDLERS = new Set([
  'BP02_048_WANSHIMING_SACRIFICE',
  'BP03_056_COPY_GY_ENTRY',
  'BP03_057_LILITH_CHALLENGE',
  'BP03_058_ASCENDING_COST_5',
  'BP03_059_BLACKJACK_21',
  'BP03_061_GUESS_PARITY',
  'BP03_063_CLASH_TOP',
  'BP03_064_SIMULTANEOUS_REVEAL_ORB',
]);
const VALID_DELAYED_ABILITIES = new Set([
  'DELAYED_END_OF_TURN_TO_GRAVEYARD',
  'DELAYED_END_OF_TURN_TO_DECK_BOTTOM',
  'DELAYED_END_OF_TURN_UNTAP',
  'DELAYED_END_OF_TURN_DRAW',
  'DELAYED_ATTACK_END_TO_SIGNAL_ORB_BOTTOM',
  'DELAYED_ATTACK_END_DEPLOY_PARTNER',
]);
const VALID_MOVE_ZONES = new Set([
  'HAND',
  'GRAVEYARD',
  'SIGNAL_ORB',
  'SIGNAL_ORB_BOTTOM',
  'DECK_TOP',
  'DECK_BOTTOM',
  'DECK_SHUFFLE',
  'COST',
  'UNDERNEATH',
  'BATTLEFIELD',
]);
const VALID_ZONES = new Set(['DECK', 'HAND', 'BATTLEFIELD', 'COST', 'SIGNAL_ORB', 'GRAVEYARD', 'PROCESSING']);
const VALID_PLAY_FROM_ZONES = new Set(['HAND', 'GRAVEYARD', 'UNDERNEATH']);
const VALID_PLAY_SACRIFICE_ZONES = new Set(['HAND', 'BATTLEFIELD']);
const VALID_FIELD_IGNORE_ATTR_ZONES = new Set(['BATTLEFIELD', 'COST']);
const VALID_REPLACEMENT_EVENTS = new Set(['DESTROY_ROLE', 'MOVE_CARD', 'DEAL_DAMAGE']);
const VALID_ORB_COLORS = new Set(['RED', 'BLUE', 'YELLOW']);
const VALID_TRIGGER_EVENT_TYPES = new Set<TriggerEventType>([
  'CARD_ENTERED_FIELD',
  'CARD_LEFT_FIELD',
  'CARD_DESTROYED',
  'ATTACK_DECLARED',
  'FREE_TIMING_STARTED',
  'BLOCK_DECLARED',
  'ATTACK_CHARGE_STARTED',
  'DAMAGE_STEP_STARTED',
  'CHARACTER_BATTLE_STARTED',
  'ATTACK_ENDED',
  'TURN_STARTED',
  'END_PHASE_TRIGGERS',
  'ORBS_ELIMINATED',
  'DAMAGE_DEALT',
  'CARD_CHARGED',
  'PARTNER_GAINED',
  'PARTNER_RELEASED',
  'CARD_TAPPED',
  'CARD_MOVED_DECK_TO_GY',
  'CARD_SENT_FIELD_TO_GY_BY_EFFECT',
  'CARD_MOVED_GY_TO_DECK_BOTTOM',
  'ATTACK_DEALT_PLAYER_DAMAGE',
  'CARD_EQUIPPED',
]);
const VALID_TRIGGER_MATCHERS = new Set([
  'EQUIPPED_ROLE_ATTACKING',
  'OTHER_FRIENDLY_ROLE_ENTERED',
  'SELF_IN_SIGNAL_ORB_ON_FRIENDLY_ROLE_ENTERED',
  'SELF_IN_UNDERNEATH_ON_FRIENDLY_DEPLOY_FROM_UNDERNEATH',
  'ANY_CARD_SENT_FIELD_TO_GY_BY_EFFECT',
  'SELF_MOVED_DECK_TO_GY',
  'FRIENDLY_CARD_MOVED_DECK_TO_GY',
  'FRIENDLY_CARD_MOVED_GY_TO_DECK_BOTTOM',
  'SELF_TAPPED',
  'SELF_DESTROYED',
  'SELF_ATTACKING',
  'SELF_ATTACKING_OR_BLOCKING',
  'SELF_ATTACK_END',
  'SELF_DEALT_PLAYER_DAMAGE',
  'SELF_EQUIPPED',
  'PARTNER_HOST_ATTACKING',
  'GRANTED_ATTACK_CHARGE_CARD',
  'SELF_IN_GRAVEYARD_ON_SELF_ORBS_ELIMINATED',
  'SELF_ORBS_ELIMINATED',
  'SELF_BLOCKED_ATTACK_END',
  'GRANTED_BLOCKED_ATTACK_END',
  'FRIENDLY_ROLE_BLOCKING',
  'SELF_TURN_END',
  'SELF_BECAME_PARTNER',
  'SELF_GAINED_PARTNER',
  'SELF_LEFT_FIELD',
  'GRANTED_SELF_LEFT_FIELD',
  'SELF_PLAYER_DAMAGED',
  'SELF_IN_GRAVEYARD_ON_FRIENDLY_ROLE_ATTACKED',
]);
const VALID_PROHIBITIONS = new Set([
  'CANNOT_ATTACK',
  'CANNOT_BLOCK',
  'CANNOT_DEAL_DAMAGE',
  'CANNOT_GAIN_ABILITIES',
  'CANNOT_ELIMINATE',
  'CANNOT_MODIFY_PP_BY_OPPONENT',
  'CANNOT_DISCARD_HIDDEN_COST_AT_END',
  'CANNOT_BE_PLACED_UNDERNEATH',
  'CANNOT_BE_PLACED_UNDERNEATH_BY_SELF',
]);

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`卡牌声明式效果校验失败：${message}`);
  }
}

function assertPositiveInt(value: unknown, label: string): void {
  assert(
    typeof value === 'number' && Number.isInteger(value) && value >= 1,
    `${label} 必须是 >= 1 的正整数，收到 ${String(value)}`
  );
}

function assertNonNegativeInt(value: unknown, label: string): void {
  assert(
    typeof value === 'number' && Number.isInteger(value) && value >= 0,
    `${label} 必须是 >= 0 的整数，收到 ${String(value)}`
  );
}

function assertNonEmptyStringArray(value: unknown, label: string): void {
  assert(Array.isArray(value) && value.length > 0, `${label} 必须是非空字符串数组`);
  for (let i = 0; i < value.length; i++) {
    const item = value[i];
    assert(typeof item === 'string' && item.trim().length > 0, `${label}[${i}] 必须是非空字符串`);
  }
}

interface GrantedTriggerRef {
  id: string;
  path: string;
}

function validateSharedTurnKey(
  spec: { sharedTurnKey?: string; oncePerTurnByPlayer?: boolean; maxPerTurnByPlayer?: number },
  path: string
): void {
  if (spec.sharedTurnKey === undefined) return;
  assert(
    typeof spec.sharedTurnKey === 'string' && spec.sharedTurnKey.trim().length > 0,
    `${path}.sharedTurnKey 必须是非空字符串`
  );
  assert(
    spec.oncePerTurnByPlayer === true || spec.maxPerTurnByPlayer !== undefined,
    `${path} 配置了 sharedTurnKey 时必须同时配置 oncePerTurnByPlayer 或 maxPerTurnByPlayer`
  );
}

function validateCommonStatModFields(
  mod: {
    setCardType?: string;
    prohibitions?: string[];
    treatedAsOrbColors?: string[];
    orbValue?: number;
    treatedAsNames?: string[];
    keywords?: string[];
    addTraits?: string[];
    grantedTriggerIds?: string[];
    unblockableMaxPP?: number;
    canAttackReadyRolesMaxCost?: number;
  },
  path: string,
  grantedTriggerRefs?: GrantedTriggerRef[]
): void {
  if (mod.setCardType !== undefined) {
    assert(VALID_CARD_TYPES.has(mod.setCardType), `${path}.setCardType 非法: ${String(mod.setCardType)}`);
  }
  if (mod.prohibitions !== undefined) {
    assert(Array.isArray(mod.prohibitions) && mod.prohibitions.length > 0, `${path}.prohibitions 必须是非空数组`);
    for (const p of mod.prohibitions) {
      assert(VALID_PROHIBITIONS.has(p), `${path}.prohibitions 非法值: ${String(p)}`);
    }
  }
  if (mod.treatedAsOrbColors !== undefined) {
    assert(
      Array.isArray(mod.treatedAsOrbColors) && mod.treatedAsOrbColors.length > 0,
      `${path}.treatedAsOrbColors 必须是非空数组`
    );
    for (const c of mod.treatedAsOrbColors) {
      assert(VALID_ORB_COLORS.has(c), `${path}.treatedAsOrbColors 非法颜色: ${String(c)}`);
    }
  }
  if (mod.orbValue !== undefined) {
    assertPositiveInt(mod.orbValue, `${path}.orbValue`);
  }
  if (mod.treatedAsNames !== undefined) {
    assertNonEmptyStringArray(mod.treatedAsNames, `${path}.treatedAsNames`);
  }
  if (mod.keywords !== undefined) {
    assertNonEmptyStringArray(mod.keywords, `${path}.keywords`);
  }
  if (mod.addTraits !== undefined) {
    assertNonEmptyStringArray(mod.addTraits, `${path}.addTraits`);
  }
  if (mod.grantedTriggerIds !== undefined) {
    assertNonEmptyStringArray(mod.grantedTriggerIds, `${path}.grantedTriggerIds`);
    if (grantedTriggerRefs) {
      mod.grantedTriggerIds.forEach((id, i) => {
        grantedTriggerRefs.push({ id, path: `${path}.grantedTriggerIds[${i}]` });
      });
    }
  }
  if (mod.unblockableMaxPP !== undefined) {
    assertNonNegativeInt(mod.unblockableMaxPP, `${path}.unblockableMaxPP`);
  }
  if (mod.canAttackReadyRolesMaxCost !== undefined) {
    assertNonNegativeInt(mod.canAttackReadyRolesMaxCost, `${path}.canAttackReadyRolesMaxCost`);
  }
}

function validateFilter(filter: CardFilter | undefined, path: string): void {
  if (!filter) return;
  if (filter.cardType !== undefined) {
    assert(VALID_CARD_TYPES.has(filter.cardType), `${path}.cardType 非法: ${String(filter.cardType)}`);
  }
  if (filter.attribute !== undefined) {
    assert(VALID_ATTRIBUTES.has(filter.attribute), `${path}.attribute 非法: ${String(filter.attribute)}`);
  }
  if (filter.excludeAttribute !== undefined) {
    assert(
      VALID_ATTRIBUTES.has(filter.excludeAttribute),
      `${path}.excludeAttribute 非法: ${String(filter.excludeAttribute)}`
    );
  }
  if (filter.signalOrbColor !== undefined) {
    assert(
      VALID_ORB_COLORS.has(filter.signalOrbColor),
      `${path}.signalOrbColor 非法: ${String(filter.signalOrbColor)}`
    );
  }
  if (filter.inZone !== undefined) {
    assert(VALID_ZONES.has(filter.inZone), `${path}.inZone 非法: ${String(filter.inZone)}`);
  }
  if (filter.anyTraits !== undefined) {
    assert(Array.isArray(filter.anyTraits) && filter.anyTraits.length > 0, `${path}.anyTraits 不能为空数组`);
  }
  if (filter.anyFilters !== undefined) {
    assert(Array.isArray(filter.anyFilters) && filter.anyFilters.length > 0, `${path}.anyFilters 不能为空数组`);
    filter.anyFilters.forEach((f, i) => validateFilter(f, `${path}.anyFilters[${i}]`));
  }
  if (filter.cardNumbers !== undefined) {
    assert(Array.isArray(filter.cardNumbers) && filter.cardNumbers.length > 0, `${path}.cardNumbers 不能为空数组`);
  }
  if (filter.hasUnderneathOrEquipMatching !== undefined) {
    validateFilter(filter.hasUnderneathOrEquipMatching, `${path}.hasUnderneathOrEquipMatching`);
  }
  if (filter.minUnderneathCount !== undefined) {
    assertNonNegativeInt(filter.minUnderneathCount, `${path}.minUnderneathCount`);
  }
  if (filter.minCost !== undefined) {
    assertNonNegativeInt(filter.minCost, `${path}.minCost`);
  }
  if (filter.maxCost !== undefined) {
    assertNonNegativeInt(filter.maxCost, `${path}.maxCost`);
  }
  if (filter.exactCost !== undefined) {
    assertNonNegativeInt(filter.exactCost, `${path}.exactCost`);
  }
  if (filter.maxBaseDP !== undefined) {
    assertNonNegativeInt(filter.maxBaseDP, `${path}.maxBaseDP`);
  }
  if (filter.minEffectivePP !== undefined) {
    assertNonNegativeInt(filter.minEffectivePP, `${path}.minEffectivePP`);
  }
  if (filter.maxEffectivePP !== undefined) {
    assertNonNegativeInt(filter.maxEffectivePP, `${path}.maxEffectivePP`);
  }
  if (filter.minCost !== undefined && filter.maxCost !== undefined) {
    assert(filter.minCost <= filter.maxCost, `${path} minCost (${filter.minCost}) 不能大于 maxCost (${filter.maxCost})`);
  }
  if (filter.minEffectivePP !== undefined && filter.maxEffectivePP !== undefined) {
    assert(
      filter.minEffectivePP <= filter.maxEffectivePP,
      `${path} minEffectivePP (${filter.minEffectivePP}) 不能大于 maxEffectivePP (${filter.maxEffectivePP})`
    );
  }
}

function validateNumberExpr(
  expr: NumberExpr | undefined,
  path: string,
  definedVars?: ReadonlySet<string>
): void {
  if (expr === undefined) return;
  if (typeof expr === 'number') {
    assert(Number.isFinite(expr), `${path} 必须是有限数字`);
    return;
  }
  assert(typeof expr === 'object' && expr !== null, `${path} 必须是数字或数值表达式对象`);
  switch (expr.kind) {
    case 'EROSION_MULT':
      assert(VALID_SIDES.has(expr.side), `${path}.side 非法: ${String(expr.side)}`);
      assert(Number.isFinite(expr.multiplier), `${path}.multiplier 必须是有限数字`);
      return;
    case 'ROLE_COUNT_MULT':
      assert(VALID_SIDES.has(expr.side), `${path}.side 非法: ${String(expr.side)}`);
      assert(Number.isFinite(expr.multiplier), `${path}.multiplier 必须是有限数字`);
      validateFilter(expr.filter, `${path}.filter`);
      return;
    case 'UNDERNEATH_COUNT_MULT':
      assert(Number.isFinite(expr.multiplier), `${path}.multiplier 必须是有限数字`);
      validateFilter(expr.filter, `${path}.filter`);
      return;
    case 'SUM_UNDERNEATH_COUNT':
      assert(VALID_SIDES.has(expr.side), `${path}.side 非法: ${String(expr.side)}`);
      validateFilter(expr.roleFilter, `${path}.roleFilter`);
      validateFilter(expr.filter, `${path}.filter`);
      if (expr.multiplier !== undefined) assert(Number.isFinite(expr.multiplier), `${path}.multiplier 必须是有限数字`);
      return;
    case 'ORB_ZONE_COUNT_MULT':
      assert(VALID_SIDES.has(expr.side), `${path}.side 非法: ${String(expr.side)}`);
      assert(Number.isFinite(expr.multiplier), `${path}.multiplier 必须是有限数字`);
      validateFilter(expr.filter, `${path}.filter`);
      return;
    case 'ZONE_COUNT_MULT':
      assert(VALID_SIDES.has(expr.side), `${path}.side 非法: ${String(expr.side)}`);
      assert(VALID_ZONES.has(expr.zone), `${path}.zone 非法: ${String(expr.zone)}`);
      assert(Number.isFinite(expr.multiplier), `${path}.multiplier 必须是有限数字`);
      validateFilter(expr.filter, `${path}.filter`);
      return;
    case 'VAR_COUNT_MULT':
    case 'VAR_DISTINCT_COST_MULT':
      assert(typeof expr.varName === 'string' && expr.varName.length > 0, `${path}.varName 不能为空`);
      if (definedVars) assert(definedVars.has(expr.varName), `${path} 引用了未定义变量 "${expr.varName}"`);
      assert(Number.isFinite(expr.multiplier), `${path}.multiplier 必须是有限数字`);
      return;
    case 'FLOOR_DIV':
      validateNumberExpr(expr.expr, `${path}.expr`, definedVars);
      assertPositiveInt(expr.divisor, `${path}.divisor`);
      return;
    case 'ADD':
      validateNumberExpr(expr.left, `${path}.left`, definedVars);
      validateNumberExpr(expr.right, `${path}.right`, definedVars);
      return;
    default:
      throw new Error(`卡牌声明式效果校验失败：${path} 未知的数值表达式类型 ${(expr as { kind?: unknown }).kind}`);
  }
}

function validateCondition(cond: ConditionExpr, definedVars: ReadonlySet<string>, path: string): void {
  assert(typeof cond === 'object' && cond !== null, `${path} 必须是条件对象`);
  switch (cond.kind) {
    case 'HAS_ROLE':
      assert(VALID_SIDES.has(cond.side), `${path}.side 非法`);
      if (cond.minCount !== undefined) assertPositiveInt(cond.minCount, `${path}.minCount`);
      validateFilter(cond.filter, `${path}.filter`);
      return;
    case 'EROSION_COMPARE':
      assert(VALID_SIDES.has(cond.side), `${path}.side 非法`);
      assert(VALID_COMPARE_OPS.has(cond.op), `${path}.op 非法: ${String(cond.op)}`);
      assertNonNegativeInt(cond.value, `${path}.value`);
      return;
    case 'EROSION_CHANGED_THIS_TURN':
      assert(VALID_SIDES.has(cond.side), `${path}.side 非法`);
      return;
    case 'OPEN_COST_COMPARE_OPPONENT':
    case 'FRIENDLY_ROLE_COUNT_COMPARE_OPPONENT':
      assert(VALID_COMPARE_OPS.has(cond.op), `${path}.op 非法: ${String(cond.op)}`);
      return;
    case 'SIGNAL_ORB_BOTTOM_COST_PARITY':
      assert(cond.parity === 'ODD' || cond.parity === 'EVEN', `${path}.parity 非法: ${String(cond.parity)}`);
      return;
    case 'SELF_UNDERNEATH_COUNT':
      assert(VALID_COMPARE_OPS.has(cond.op), `${path}.op 非法: ${String(cond.op)}`);
      assertNonNegativeInt(cond.value, `${path}.value`);
      validateFilter(cond.filter, `${path}.filter`);
      return;
    case 'TOTAL_UNDERNEATH_COUNT':
      assert(VALID_SIDES.has(cond.side), `${path}.side 非法`);
      assert(VALID_COMPARE_OPS.has(cond.op), `${path}.op 非法: ${String(cond.op)}`);
      assertNonNegativeInt(cond.value, `${path}.value`);
      validateFilter(cond.roleFilter, `${path}.roleFilter`);
      validateFilter(cond.filter, `${path}.filter`);
      return;
    case 'ANY_HOST_UNDERNEATH_CONTAINS':
      assert(VALID_SIDES.has(cond.side), `${path}.side 非法`);
      validateFilter(cond.roleFilter, `${path}.roleFilter`);
      validateFilter(cond.cardFilter, `${path}.cardFilter`);
      return;
    case 'SELF_MATCHES_FILTER':
      validateFilter(cond.filter, `${path}.filter`);
      return;
    case 'GAME_ABILITY_UNUSED':
    case 'TURN_ABILITY_UNUSED':
      assert(typeof cond.abilityKey === 'string' && cond.abilityKey.length > 0, `${path}.abilityKey 不能为空`);
      return;
    case 'ZONE_COUNT':
      assert(VALID_SIDES.has(cond.side), `${path}.side 非法`);
      assert(VALID_ZONES.has(cond.zone), `${path}.zone 非法: ${String(cond.zone)}`);
      assert(VALID_COMPARE_OPS.has(cond.op), `${path}.op 非法`);
      assertNonNegativeInt(cond.value, `${path}.value`);
      validateFilter(cond.filter, `${path}.filter`);
      return;
    case 'ALL_ZONE_CARDS_MATCH':
      assert(VALID_SIDES.has(cond.side), `${path}.side 非法`);
      assert(VALID_ZONES.has(cond.zone), `${path}.zone 非法: ${String(cond.zone)}`);
      validateFilter(cond.preFilter, `${path}.preFilter`);
      validateFilter(cond.matchFilter, `${path}.matchFilter`);
      return;
    case 'ALL_ROLES_MATCH':
      assert(VALID_SIDES.has(cond.side), `${path}.side 非法`);
      validateFilter(cond.filter, `${path}.filter`);
      return;
    case 'ROLE_ATTRIBUTE_DIVERSITY':
      assert(VALID_SIDES.has(cond.side), `${path}.side 非法`);
      validateFilter(cond.filter, `${path}.filter`);
      assertPositiveInt(cond.minDistinct, `${path}.minDistinct`);
      return;
    case 'HAS_EMPTY_SLOT':
      assert(VALID_SIDES.has(cond.side), `${path}.side 非法`);
      return;
    case 'TURN_OWNER':
      assert(typeof cond.isSelfTurn === 'boolean', `${path}.isSelfTurn 必须是布尔值`);
      return;
    case 'CURRENT_COMBAT_EXISTS':
    case 'IS_ENTER_TURN':
    case 'IS_DEPLOYED_FROM_PROCESSING_TURN':
    case 'CARD_WAS_ASCENDED_PLAY':
    case 'CARD_WAS_ASCENDED_FROM_AIRBORNE':
    case 'CARD_PAID_HIDDEN_COST_ON_PLAY':
    case 'COMBAT_CHARGED_AUTO':
    case 'CHARGED_AUTO_BY_LEE_THIS_TURN':
      return;
    case 'CARD_ENTERED_FROM_ZONE':
      assert(Array.isArray(cond.zones) && cond.zones.length > 0, `${path}.zones 不能为空`);
      cond.zones.forEach((z) => assert(VALID_ZONES.has(z), `${path}.zones 非法元素: ${String(z)}`));
      return;
    case 'ELIMINATED_THREE_ORBS_THIS_TURN':
      assert(VALID_SIDES.has(cond.side), `${path}.side 非法`);
      return;
    case 'DESTROYED_FRIENDLY_ROLES_THIS_TURN':
    case 'ELIMINATED_ORBS_BY_KARENINA_THIS_TURN':
      assert(VALID_COMPARE_OPS.has(cond.op), `${path}.op 非法`);
      assertNonNegativeInt(cond.value, `${path}.value`);
      return;
    case 'DAMAGE_TAKEN_THIS_TURN':
    case 'CARDS_PLAYED_THIS_TURN':
    case 'ART_ASSOC_TACTICS_PLAYED_THIS_TURN':
      assert(VALID_SIDES.has(cond.side), `${path}.side 非法`);
      assert(VALID_COMPARE_OPS.has(cond.op), `${path}.op 非法`);
      assertNonNegativeInt(cond.value, `${path}.value`);
      return;
    case 'VAR_NON_EMPTY':
      assert(definedVars.has(cond.varName), `${path} 引用了未定义变量 "${cond.varName}"`);
      return;
    case 'VAR_COUNT_COMPARE':
      assert(definedVars.has(cond.varName), `${path} 引用了未定义变量 "${cond.varName}"`);
      assert(VALID_COMPARE_OPS.has(cond.op), `${path}.op 非法`);
      assertNonNegativeInt(cond.value, `${path}.value`);
      return;
    case 'VAR_HAS_CARD_MATCHING':
      assert(definedVars.has(cond.varName), `${path} 引用了未定义变量 "${cond.varName}"`);
      validateFilter(cond.filter, `${path}.filter`);
      return;
    case 'VAR_HAS_DUPLICATE_COST':
      assert(definedVars.has(cond.varName), `${path} 引用了未定义变量 "${cond.varName}"`);
      return;
    case 'HAS_ELIMINABLE_ORBS':
      assert(VALID_ORB_FILTERS.has(cond.filter), `${path}.filter 非法`);
      assertPositiveInt(cond.count, `${path}.count`);
      return;
    case 'IS_STANDALONE_EQUIPMENT':
      return;
    case 'ALL':
    case 'ANY':
      assert(Array.isArray(cond.conditions) && cond.conditions.length > 0, `${path}.conditions 不能为空`);
      cond.conditions.forEach((c, i) => validateCondition(c, definedVars, `${path}.conditions[${i}]`));
      return;
    case 'NOT':
      validateCondition(cond.condition, definedVars, `${path}.condition`);
      return;
    default:
      throw new Error(`卡牌声明式效果校验失败：${path} 未知的条件类型 ${(cond as { kind?: unknown }).kind}`);
  }
}

function validateTarget(target: CardTargetRef, definedVars: ReadonlySet<string>, path: string): void {
  assert(typeof target === 'object' && target !== null, `${path} 必须是目标对象`);
  switch (target.kind) {
    case 'SELF':
    case 'SELF_PARTNER':
    case 'TRIGGER_ATTACKER':
    case 'TRIGGER_BLOCKER':
    case 'TRIGGER_HOST':
    case 'TRIGGER_TARGET':
      return;
    case 'SELF_UNDERNEATH':
      validateFilter(target.filter, `${path}.filter`);
      return;
    case 'ZONE_BOTTOM_CARD':
      assert(VALID_SIDES.has(target.side), `${path}.side 非法`);
      assert(VALID_ZONES.has(target.zone), `${path}.zone 非法`);
      return;
    case 'HOST_UNDERNEATH_MATCHING':
      assert(VALID_SIDES.has(target.side), `${path}.side 非法`);
      validateFilter(target.roleFilter, `${path}.roleFilter`);
      validateFilter(target.cardFilter, `${path}.cardFilter`);
      return;
    case 'VAR':
      assert(definedVars.has(target.varName), `${path} 引用了未定义变量 "${target.varName}"`);
      return;
    case 'REST_OF_VAR':
      assert(definedVars.has(target.allVar), `${path} 引用了未定义变量 allVar "${target.allVar}"`);
      assert(definedVars.has(target.excludeVar), `${path} 引用了未定义变量 excludeVar "${target.excludeVar}"`);
      return;
    case 'ALL_MATCHING_ROLES':
      assert(VALID_SIDES.has(target.side), `${path}.side 非法`);
      validateFilter(target.filter, `${path}.filter`);
      return;
    case 'ZONE_CARDS':
      assert(VALID_SIDES.has(target.side), `${path}.side 非法`);
      assert(target.zone === 'SIGNAL_ORB' || target.zone === 'BATTLEFIELD', `${path}.zone 非法: ${String(target.zone)}`);
      validateFilter(target.filter, `${path}.filter`);
      return;
    default:
      throw new Error(`卡牌声明式效果校验失败：${path} 未知的目标类型 ${(target as { kind?: unknown }).kind}`);
  }
}

function validateCost(cost: AbilityCost | undefined, path: string): Set<string> {
  const vars = new Set<string>();
  if (!cost) return vars;
  switch (cost.kind) {
    case 'DISCARD_HAND':
      assertPositiveInt(cost.count, `${path}.count`);
      validateFilter(cost.filter, `${path}.filter`);
      return vars;
    case 'ELIMINATE_ORBS':
      assert(VALID_ORB_FILTERS.has(cost.filter), `${path}.filter 非法: ${String(cost.filter)}`);
      assertPositiveInt(cost.count, `${path}.count`);
      if (cost.savePaidToVar) vars.add(cost.savePaidToVar);
      return vars;
    case 'ELIMINATE_ORB_OR_DISCARD_HAND':
    case 'TAP_SELF':
    case 'SELF_TO_DECK_BOTTOM':
    case 'SELF_TO_GRAVEYARD':
    case 'SELF_AIRBORNE':
    case 'DISCARD_SELF_FROM_HAND':
      return vars;
    case 'DEAL_SELF_DAMAGE':
      assertPositiveInt(cost.amount, `${path}.amount`);
      return vars;
    case 'COMPOSITE':
      assert(Array.isArray(cost.costs) && cost.costs.length > 0, `${path}.costs 不能为空`);
      cost.costs.forEach((c, idx) => {
        for (const v of validateCost(c, `${path}.costs[${idx}]`)) vars.add(v);
      });
      return vars;
    case 'TAP_SELF_AND_DISCARD_HAND':
      assertPositiveInt(cost.count, `${path}.count`);
      validateFilter(cost.filter, `${path}.filter`);
      return vars;
    case 'TAP_SELF_AND_ELIMINATE_ORBS':
      assert(VALID_ORB_FILTERS.has(cost.filter), `${path}.filter 非法: ${String(cost.filter)}`);
      assertPositiveInt(cost.count, `${path}.count`);
      return vars;
    case 'PAY_COST':
      assertPositiveInt(cost.amount, `${path}.amount`);
      return vars;
    default:
      throw new Error(`卡牌声明式效果校验失败：${path} 未知的代价类型 ${(cost as { kind?: unknown }).kind}`);
  }
}

function validateSteps(
  steps: EffectStep[],
  parentVars: ReadonlySet<string>,
  path: string,
  grantedTriggerRefs?: GrantedTriggerRef[]
): Set<string> {
  assert(Array.isArray(steps), `${path} 必须是步骤数组`);
  const vars = new Set(parentVars);

  steps.forEach((step, idx) => {
    const sp = `${path}[${idx}]`;
    assert(typeof step === 'object' && step !== null, `${sp} 必须是对象`);

    switch (step.op) {
      case 'DRAW':
        assertPositiveInt(step.count, `${sp}.count`);
        if (step.side !== undefined) assert(VALID_SIDES.has(step.side), `${sp}.side 非法`);
        break;
      case 'MILL':
        assertPositiveInt(step.count, `${sp}.count`);
        if (step.side !== undefined) assert(VALID_SIDES.has(step.side), `${sp}.side 非法`);
        if (step.saveToVar) vars.add(step.saveToVar);
        break;
      case 'REVEAL_TOP':
      case 'PEEK_TOP':
        assertPositiveInt(step.count, `${sp}.count`);
        if (step.side !== undefined) assert(VALID_SIDES.has(step.side), `${sp}.side 非法`);
        assert(typeof step.saveToVar === 'string' && step.saveToVar.length > 0, `${sp}.saveToVar 不能为空`);
        vars.add(step.saveToVar);
        break;
      case 'DISCARD_OPPONENT_RANDOM_HAND':
        assertPositiveInt(step.count, `${sp}.count`);
        break;
      case 'CONFIRM_YES_NO':
        assert(step.prompt.length > 0 && step.yesLabel.length > 0 && step.noLabel.length > 0, `${sp} 提示文案不能为空`);
        assert(step.onYes.length > 0, `${sp}.onYes 不能为空`);
        validateSteps(step.onYes, vars, `${sp}.onYes`, grantedTriggerRefs);
        if (step.onNo) validateSteps(step.onNo, vars, `${sp}.onNo`, grantedTriggerRefs);
        break;
      case 'CHOOSE_ROLES': {
        assert(VALID_SIDES.has(step.side as PlayerSide) || step.side === 'ANY', `${sp}.side 非法`);
        assert(step.prompt.length > 0, `${sp}.prompt 不能为空`);
        const min = step.min ?? 1;
        const max = step.max ?? 1;
        assertNonNegativeInt(min, `${sp}.min`);
        assertPositiveInt(max, `${sp}.max`);
        assert(min <= max, `${sp}.min (${min}) 不能大于 max (${max})`);
        if (step.maxTotalCost !== undefined) assertNonNegativeInt(step.maxTotalCost, `${sp}.maxTotalCost`);
        validateFilter(step.filter, `${sp}.filter`);
        validateFilter(step.eligibilityFilter, `${sp}.eligibilityFilter`);
        assert(step.saveToVar.length > 0, `${sp}.saveToVar 不能为空`);
        vars.add(step.saveToVar);
        break;
      }
      case 'CHOOSE_ZONE_CARDS': {
        assert(VALID_SIDES.has(step.side), `${sp}.side 非法`);
        assert(VALID_CHOOSE_ZONES.has(step.zone), `${sp}.zone 非法: ${String(step.zone)}`);
        if (step.zones !== undefined) {
          assert(Array.isArray(step.zones) && step.zones.length > 0, `${sp}.zones 不能为空数组`);
          for (const z of step.zones) {
            assert(VALID_MULTI_CHOOSE_ZONES.has(z), `${sp}.zones 非法元素: ${String(z)}`);
          }
        }
        assert(step.prompt.length > 0, `${sp}.prompt 不能为空`);
        const min = step.min ?? 1;
        const max = step.max ?? 1;
        assertNonNegativeInt(min, `${sp}.min`);
        assertPositiveInt(max, `${sp}.max`);
        assert(min <= max, `${sp}.min (${min}) 不能大于 max (${max})`);
        if (step.maxTotalCost !== undefined) assertNonNegativeInt(step.maxTotalCost, `${sp}.maxTotalCost`);
        if (step.dynamicMin !== undefined) validateNumberExpr(step.dynamicMin, `${sp}.dynamicMin`, vars);
        if (step.dynamicMax !== undefined) validateNumberExpr(step.dynamicMax, `${sp}.dynamicMax`, vars);
        validateFilter(step.hostFilter, `${sp}.hostFilter`);
        validateFilter(step.filter, `${sp}.filter`);
        assert(step.saveToVar.length > 0, `${sp}.saveToVar 不能为空`);
        vars.add(step.saveToVar);
        break;
      }
      case 'CHOOSE_FROM_VAR': {
        assert(vars.has(step.varName), `${sp} 引用了未定义变量 "${step.varName}"`);
        assert(step.prompt.length > 0, `${sp}.prompt 不能为空`);
        const min = step.min ?? 1;
        const max = step.max ?? 1;
        assertNonNegativeInt(min, `${sp}.min`);
        assertPositiveInt(max, `${sp}.max`);
        assert(min <= max, `${sp}.min (${min}) 不能大于 max (${max})`);
        if (step.maxTotalCost !== undefined) assertNonNegativeInt(step.maxTotalCost, `${sp}.maxTotalCost`);
        validateFilter(step.filter, `${sp}.filter`);
        if (step.distinctTraits !== undefined) {
          assert(
            Array.isArray(step.distinctTraits) && step.distinctTraits.length >= 2,
            `${sp}.distinctTraits 至少需要 2 个特征`
          );
        }
        assert(step.saveToVar.length > 0, `${sp}.saveToVar 不能为空`);
        vars.add(step.saveToVar);
        break;
      }
      case 'CHOOSE_MODE': {
        assert(step.prompt.length > 0, `${sp}.prompt 不能为空`);
        assert(Array.isArray(step.modes) && step.modes.length >= 2, `${sp}.modes 至少需要 2 个选项`);
        if (step.pickCountExpr !== undefined) {
          validateNumberExpr(step.pickCountExpr, `${sp}.pickCountExpr`, vars);
        } else {
          const min = step.min ?? 1;
          const max = step.max ?? 1;
          assertNonNegativeInt(min, `${sp}.min`);
          assertPositiveInt(max, `${sp}.max`);
          assert(min <= max && max <= step.modes.length, `${sp} min/max (${min}/${max}) 越界`);
        }
        const modeIds = new Set<string>();
        step.modes.forEach((m, mi) => {
          assert(m.id.length > 0 && m.label.length > 0, `${sp}.modes[${mi}] id 与 label 不能为空`);
          assert(!modeIds.has(m.id), `${sp}.modes 存在重复 id "${m.id}"`);
          modeIds.add(m.id);
          validateSteps(m.steps, vars, `${sp}.modes[${mi}].steps`, grantedTriggerRefs);
        });
        break;
      }
      case 'ELIMINATE_ORB_COST': {
        assert(VALID_ORB_FILTERS.has(step.filter), `${sp}.filter 非法: ${String(step.filter)}`);
        assertPositiveInt(step.count, `${sp}.count`);
        assert(step.onPaid.length > 0, `${sp}.onPaid 不能为空`);
        const innerVars = new Set(vars);
        if (step.savePaidToVar) innerVars.add(step.savePaidToVar);
        validateSteps(step.onPaid, innerVars, `${sp}.onPaid`, grantedTriggerRefs);
        break;
      }
      case 'DISCARD_COST_STEP': {
        assertPositiveInt(step.count, `${sp}.count`);
        if (step.minCount !== undefined) {
          assertNonNegativeInt(step.minCount, `${sp}.minCount`);
          assert(step.minCount <= step.count, `${sp}.minCount 不能大于 count`);
        }
        validateFilter(step.filter, `${sp}.filter`);
        assert(step.onPaid.length > 0, `${sp}.onPaid 不能为空`);
        const innerVars = new Set(vars);
        if (step.savePaidToVar) innerVars.add(step.savePaidToVar);
        validateSteps(step.onPaid, innerVars, `${sp}.onPaid`, grantedTriggerRefs);
        break;
      }
      case 'PAY_COST_STEP': {
        validateNumberExpr(step.amount, `${sp}.amount`, vars);
        assert(step.onPaid.length > 0, `${sp}.onPaid 不能为空`);
        validateSteps(step.onPaid, vars, `${sp}.onPaid`, grantedTriggerRefs);
        break;
      }
      case 'TAP_FIELD_CARD_COST_STEP': {
        assert(step.onPaid.length > 0, `${sp}.onPaid 不能为空`);
        validateSteps(step.onPaid, vars, `${sp}.onPaid`, grantedTriggerRefs);
        break;
      }
      case 'EQUIP_FROM_VAR': {
        assert(vars.has(step.varName), `${sp} 引用了未定义变量 "${step.varName}"`);
        validateTarget(step.host, vars, `${sp}.host`);
        break;
      }
      case 'PLACE_ORB_AT_POSITION': {
        assert(vars.has(step.varName), `${sp} 引用了未定义变量 "${step.varName}"`);
        break;
      }
      case 'SHUFFLE_DECK':
        if (step.side !== undefined) assert(VALID_SIDES.has(step.side), `${sp}.side 非法`);
        break;
      case 'REORDER_ZONE':
        assert(step.zone === 'SIGNAL_ORB', `${sp}.zone 当前只支持 SIGNAL_ORB`);
        assert(step.prompt.length > 0, `${sp}.prompt 不能为空`);
        break;
      case 'MOVE_CARDS':
        validateTarget(step.target, vars, `${sp}.target`);
        assert(VALID_MOVE_ZONES.has(step.toZone), `${sp}.toZone 非法: ${String(step.toZone)}`);
        if (step.toZone === 'UNDERNEATH') {
          assert(step.underneathHost !== undefined, `${sp} toZone=UNDERNEATH 必须指定 underneathHost`);
          validateTarget(step.underneathHost, vars, `${sp}.underneathHost`);
        }
        if (step.saveMovedToVar) vars.add(step.saveMovedToVar);
        break;
      case 'ASCEND_FROM_VAR':
        assert(vars.has(step.cardVar), `${sp} 引用了未定义变量 cardVar "${step.cardVar}"`);
        assert(vars.has(step.targetVar), `${sp} 引用了未定义变量 targetVar "${step.targetVar}"`);
        if (step.extraStackVar) assert(vars.has(step.extraStackVar), `${sp} 引用了未定义变量 extraStackVar "${step.extraStackVar}"`);
        break;
      case 'DEAL_DAMAGE':
        assert(VALID_SIDES.has(step.side), `${sp}.side 非法`);
        assertPositiveInt(step.amount, `${sp}.amount`);
        break;
      case 'MARK_GAME_ABILITY_USED':
      case 'MARK_TURN_ABILITY_USED':
        assert(typeof step.abilityKey === 'string' && step.abilityKey.length > 0, `${sp}.abilityKey 不能为空`);
        break;
      case 'DESTROY_ROLES':
        validateTarget(step.target, vars, `${sp}.target`);
        if (step.saveDestroyedToVar) vars.add(step.saveDestroyedToVar);
        break;
      case 'SET_READY':
        validateTarget(step.target, vars, `${sp}.target`);
        assert(typeof step.isReady === 'boolean', `${sp}.isReady 必须是布尔值`);
        break;
      case 'SET_FROZEN':
        validateTarget(step.target, vars, `${sp}.target`);
        assert(typeof step.isFrozen === 'boolean', `${sp}.isFrozen 必须是布尔值`);
        break;
      case 'PREVENT_COMBAT_DAMAGE':
        break;
      case 'SET_COMBAT_MAX_DAMAGE':
        assertNonNegativeInt(step.maxDamage, `${sp}.maxDamage`);
        break;
      case 'REDIRECT_ATTACK':
        if (step.targetType === 'CHARACTER') {
          validateTarget(step.target, vars, `${sp}.target`);
        } else {
          assert(step.targetType === 'PLAYER', `${sp}.targetType 非法`);
        }
        break;
      case 'AIRBORNE':
        validateTarget(step.target, vars, `${sp}.target`);
        if (step.saveAirborneToVar) vars.add(step.saveAirborneToVar);
        break;
      case 'ATTACH_PARTNER':
        validateTarget(step.host, vars, `${sp}.host`);
        validateTarget(step.partner, vars, `${sp}.partner`);
        break;
      case 'DETACH_AND_MOVE_PARTNER':
        validateTarget(step.host, vars, `${sp}.host`);
        assert(
          step.toZone === 'HAND' ||
            step.toZone === 'BATTLEFIELD' ||
            step.toZone === 'GRAVEYARD' ||
            step.toZone === 'DECK_BOTTOM',
          `${sp}.toZone 非法`
        );
        break;
      case 'COPY_STATS_FROM_VAR':
        validateTarget(step.target, vars, `${sp}.target`);
        assert(vars.has(step.fromVar), `${sp} 引用了未定义变量 fromVar "${step.fromVar}"`);
        assert(VALID_DURATIONS.has(step.duration), `${sp}.duration 非法`);
        assert(step.copyBasePP === true || step.copyBaseDP === true, `${sp} 必须至少复制 basePP 或 baseDP 之一`);
        break;
      case 'INCREMENT_CARDS_PLAYED_THIS_TURN':
        if (step.amount !== undefined) assertPositiveInt(step.amount, `${sp}.amount`);
        break;
      case 'REGISTER_REPLACEMENT':
        assert(VALID_REPLACEMENT_EVENTS.has(step.eventType), `${sp}.eventType 非法: ${String(step.eventType)}`);
        validateTarget(step.target, vars, `${sp}.target`);
        assert(
          step.action && (step.action.kind === 'PREVENT' || step.action.kind === 'REDIRECT_ZONE'),
          `${sp}.action.kind 非法`
        );
        if (step.action.kind === 'REDIRECT_ZONE') {
          assert(VALID_ZONES.has(step.action.zone), `${sp}.action.zone 非法: ${String(step.action.zone)}`);
        }
        assert(VALID_DURATIONS.has(step.duration), `${sp}.duration 非法`);
        break;
      case 'MODIFY_STATS': {
        validateTarget(step.target, vars, `${sp}.target`);
        assert(VALID_DURATIONS.has(step.duration), `${sp}.duration 非法: ${String(step.duration)}`);
        validateNumberExpr(step.pp, `${sp}.pp`, vars);
        validateNumberExpr(step.dp, `${sp}.dp`, vars);
        validateNumberExpr(step.setBasePP, `${sp}.setBasePP`, vars);
        validateNumberExpr(step.setBaseDP, `${sp}.setBaseDP`, vars);
        validateNumberExpr(step.setPP, `${sp}.setPP`, vars);
        validateNumberExpr(step.setDP, `${sp}.setDP`, vars);
        validateNumberExpr(step.charge, `${sp}.charge`, vars);
        validateNumberExpr(step.setCharge, `${sp}.setCharge`, vars);
        validateNumberExpr(step.costDelta, `${sp}.costDelta`, vars);
        validateNumberExpr(step.setCost, `${sp}.setCost`, vars);
        validateCommonStatModFields(step, sp, grantedTriggerRefs);
        if (step.removeKeywords !== undefined) {
          assertNonEmptyStringArray(step.removeKeywords, `${sp}.removeKeywords`);
        }
        const hasAnyMod =
          step.pp !== undefined ||
          step.dp !== undefined ||
          step.setBasePP !== undefined ||
          step.setBaseDP !== undefined ||
          step.setPP !== undefined ||
          step.setDP !== undefined ||
          step.charge !== undefined ||
          step.setCharge !== undefined ||
          step.costDelta !== undefined ||
          step.setCost !== undefined ||
          (step.keywords && step.keywords.length > 0) ||
          (step.removeKeywords && step.removeKeywords.length > 0) ||
          (step.addTraits && step.addTraits.length > 0) ||
          step.clearBaseTraits === true ||
          step.setCardType !== undefined ||
          step.canAttackReadyRolesMaxCost !== undefined ||
          step.mustBeAttackTarget === true ||
          step.loseAbilities === true ||
          (step.prohibitions && step.prohibitions.length > 0) ||
          (step.treatedAsOrbColors && step.treatedAsOrbColors.length > 0) ||
          step.orbValue !== undefined ||
          (step.treatedAsNames && step.treatedAsNames.length > 0) ||
          (step.grantedTriggerIds && step.grantedTriggerIds.length > 0) ||
          step.canAttackPlayerOnEnterTurn === true ||
          step.unblockableMaxPP !== undefined;
        assert(hasAnyMod, `${sp} 至少须指定一项属性或能力修改`);
        break;
      }
      case 'ADD_COST_MODIFIER':
        validateNumberExpr(step.amount, `${sp}.amount`, vars);
        if (step.cardType !== undefined) {
          assert(VALID_CARD_TYPES.has(step.cardType), `${sp}.cardType 非法: ${String(step.cardType)}`);
        }
        if (step.remainingCount !== undefined) assertPositiveInt(step.remainingCount, `${sp}.remainingCount`);
        break;
      case 'CHANGE_EROSION':
        assert(typeof step.delta === 'number' && Number.isInteger(step.delta) && step.delta !== 0, `${sp}.delta 必须是非零整数`);
        if (step.side !== undefined) assert(VALID_SIDES.has(step.side), `${sp}.side 非法`);
        break;
      case 'REGISTER_DELAYED_TRIGGER':
        validateTarget(step.target, vars, `${sp}.target`);
        assert(step.eventType === 'END_PHASE_TRIGGERS' || step.eventType === 'ATTACK_ENDED', `${sp}.eventType 非法`);
        assert(VALID_DELAYED_ABILITIES.has(step.abilityId), `${sp}.abilityId 非法: ${String(step.abilityId)}`);
        if (step.expectedZone !== undefined) {
          assert(VALID_ZONES.has(step.expectedZone), `${sp}.expectedZone 非法: ${String(step.expectedZone)}`);
        }
        if (step.grantRushIfPartnerFromZone !== undefined) {
          assert(
            VALID_ZONES.has(step.grantRushIfPartnerFromZone),
            `${sp}.grantRushIfPartnerFromZone 非法: ${String(step.grantRushIfPartnerFromZone)}`
          );
        }
        if (step.targetSide !== undefined) {
          assert(VALID_SIDES.has(step.targetSide), `${sp}.targetSide 非法: ${String(step.targetSide)}`);
        }
        if (step.turnOffset !== undefined) assertNonNegativeInt(step.turnOffset, `${sp}.turnOffset`);
        if (step.drawCount !== undefined) assertPositiveInt(step.drawCount, `${sp}.drawCount`);
        break;
      case 'IF':
        validateCondition(step.condition, vars, `${sp}.condition`);
        validateSteps(step.then, vars, `${sp}.then`, grantedTriggerRefs);
        if (step.else) validateSteps(step.else, vars, `${sp}.else`, grantedTriggerRefs);
        break;
      case 'CUSTOM_HANDLER':
        assert(VALID_CUSTOM_HANDLERS.has(step.handlerId), `${sp}.handlerId 非法: ${String(step.handlerId)}`);
        break;
      default:
        throw new Error(`卡牌声明式效果校验失败：${sp} 未知的操作原语 ${(step as { op?: unknown }).op}`);
    }
  });

  return vars;
}

function validateTriggerMatcher(matcher: DeclarativeTriggerMatcher, path: string): void {
  assert(matcher && VALID_TRIGGER_MATCHERS.has(matcher.kind), `${path}.kind 非法`);
  switch (matcher.kind) {
    case 'OTHER_FRIENDLY_ROLE_ENTERED':
    case 'SELF_IN_SIGNAL_ORB_ON_FRIENDLY_ROLE_ENTERED':
      validateFilter(matcher.enteredFilter, `${path}.enteredFilter`);
      break;
    case 'ANY_CARD_SENT_FIELD_TO_GY_BY_EFFECT':
      assert(VALID_SIDES.has(matcher.side), `${path}.side 非法: ${String(matcher.side)}`);
      validateFilter(matcher.filter, `${path}.filter`);
      break;
    case 'FRIENDLY_CARD_MOVED_DECK_TO_GY':
    case 'FRIENDLY_CARD_MOVED_GY_TO_DECK_BOTTOM':
      validateFilter(matcher.filter, `${path}.filter`);
      break;
    case 'SELF_DESTROYED':
      if (matcher.destroyReason !== undefined) {
        assert(
          matcher.destroyReason === 'BATTLE' ||
            matcher.destroyReason === 'EFFECT' ||
            matcher.destroyReason === 'ANY',
          `${path}.destroyReason 非法: ${String(matcher.destroyReason)}`
        );
      }
      break;
    case 'GRANTED_ATTACK_CHARGE_CARD':
      validateFilter(matcher.chargedCardFilter, `${path}.chargedCardFilter`);
      break;
    case 'FRIENDLY_ROLE_BLOCKING':
      if (matcher.sourceKind !== undefined) {
        assert(
          matcher.sourceKind === 'ROLE' || matcher.sourceKind === 'EQUIPMENT',
          `${path}.sourceKind 非法: ${String(matcher.sourceKind)}`
        );
      }
      break;
    case 'SELF_TURN_END':
      assert(typeof matcher.isSelfTurn === 'boolean', `${path}.isSelfTurn 必须是布尔值`);
      break;
    case 'SELF_IN_GRAVEYARD_ON_FRIENDLY_ROLE_ATTACKED':
      validateFilter(matcher.targetFilter, `${path}.targetFilter`);
      break;
    default:
      break;
  }
}

function validateTrigger(
  trig: DeclarativeTriggerSpec,
  path: string,
  grantedTriggerRefs?: GrantedTriggerRef[]
): void {
  assert(typeof trig.abilityId === 'string' && trig.abilityId.length > 0, `${path}.abilityId 不能为空`);
  assert(typeof trig.label === 'string' && trig.label.length > 0, `${path}.label 不能为空`);
  assert(
    VALID_TRIGGER_EVENT_TYPES.has(trig.eventType),
    `${path}.eventType 非法: ${String(trig.eventType)}`
  );
  if (trig.eventTypes !== undefined) {
    assert(Array.isArray(trig.eventTypes) && trig.eventTypes.length > 0, `${path}.eventTypes 不能为空数组`);
    trig.eventTypes.forEach((ev, i) =>
      assert(VALID_TRIGGER_EVENT_TYPES.has(ev), `${path}.eventTypes[${i}] 非法: ${String(ev)}`)
    );
  }
  if (trig.maxPerTurn !== undefined) assertPositiveInt(trig.maxPerTurn, `${path}.maxPerTurn`);
  if (trig.maxPerTurnByPlayer !== undefined) {
    assertPositiveInt(trig.maxPerTurnByPlayer, `${path}.maxPerTurnByPlayer`);
  }
  validateSharedTurnKey(trig, path);
  validateTriggerMatcher(trig.matcher, `${path}.matcher`);
  if (trig.condition) validateCondition(trig.condition, new Set(), `${path}.condition`);
  const costVars = validateCost(trig.cost, `${path}.cost`);
  validateSteps(trig.steps, costVars, `${path}.steps`, grantedTriggerRefs);
}

function validateStaticEffect(
  eff: DeclarativeStaticEffectSpec,
  path: string,
  grantedTriggerRefs?: GrantedTriggerRef[]
): void {
  assert(typeof eff.id === 'string' && eff.id.length > 0, `${path}.id 不能为空`);
  assert(
    eff.scope === 'SELF' ||
      eff.scope === 'ALL_FRIENDLY_ROLES' ||
      eff.scope === 'PARTNER_HOST' ||
      eff.scope === 'UNDERNEATH_HOST' ||
      eff.scope === 'EQUIPPED_HOST',
    `${path}.scope 非法`
  );
  if (eff.sourceZones !== undefined) {
    assert(Array.isArray(eff.sourceZones) && eff.sourceZones.length > 0, `${path}.sourceZones 不能为空`);
    eff.sourceZones.forEach((z) => assert(VALID_ZONES.has(z), `${path}.sourceZones 非法区域: ${String(z)}`));
  }
  validateFilter(eff.selfFilter, `${path}.selfFilter`);
  validateFilter(eff.targetFilter, `${path}.targetFilter`);
  if (eff.condition) validateCondition(eff.condition, new Set(), `${path}.condition`);
  validateNumberExpr(eff.pp, `${path}.pp`);
  validateNumberExpr(eff.setPP, `${path}.setPP`);
  validateNumberExpr(eff.dp, `${path}.dp`);
  validateNumberExpr(eff.setDP, `${path}.setDP`);
  validateNumberExpr(eff.setBaseDP, `${path}.setBaseDP`);
  validateNumberExpr(eff.charge, `${path}.charge`);
  validateNumberExpr(eff.setCharge, `${path}.setCharge`);
  validateNumberExpr(eff.costDelta, `${path}.costDelta`);
  validateNumberExpr(eff.setCost, `${path}.setCost`);
  validateCommonStatModFields(eff, path, grantedTriggerRefs);
  const hasAnyEffect =
    eff.pp !== undefined ||
    eff.setPP !== undefined ||
    eff.dp !== undefined ||
    eff.setDP !== undefined ||
    eff.setBaseDP !== undefined ||
    eff.charge !== undefined ||
    eff.setCharge !== undefined ||
    eff.costDelta !== undefined ||
    eff.setCost !== undefined ||
    (eff.keywords && eff.keywords.length > 0) ||
    (eff.addTraits && eff.addTraits.length > 0) ||
    eff.clearBaseTraits === true ||
    eff.setCardType !== undefined ||
    eff.canAttackReadyRolesMaxCost !== undefined ||
    eff.mustBeAttackTarget === true ||
    (eff.prohibitions && eff.prohibitions.length > 0) ||
    (eff.treatedAsOrbColors && eff.treatedAsOrbColors.length > 0) ||
    eff.orbValue !== undefined ||
    (eff.treatedAsNames && eff.treatedAsNames.length > 0) ||
    (eff.grantedTriggerIds && eff.grantedTriggerIds.length > 0) ||
    eff.unblockableMaxPP !== undefined ||
    eff.canDualEquipFengren === true;
  assert(hasAnyEffect, `${path} 至少须指定一项静态增益`);
}

function validateActivateSpec(
  act: NonNullable<CardEffectSpec['activate']>,
  path: string,
  grantedTriggerRefs?: GrantedTriggerRef[]
): void {
  if (act.usableZones !== undefined) {
    assert(Array.isArray(act.usableZones) && act.usableZones.length > 0, `${path}.usableZones 不能为空`);
    act.usableZones.forEach((z) => assert(VALID_USABLE_ZONES.has(z), `${path}.usableZones 非法值: ${String(z)}`));
  }
  validateSharedTurnKey(act, path);
  if (act.condition) {
    validateCondition(act.condition, new Set(), `${path}.condition`);
  }
  const costVars = validateCost(act.cost, `${path}.cost`);
  validateSteps(act.steps, costVars, `${path}.steps`, grantedTriggerRefs);
}

function validateCardEffectSpecInternal(
  spec: CardEffectSpec,
  cardDb?: ICardDatabase,
  grantedTriggerRefs?: GrantedTriggerRef[]
): void {
  assert(typeof spec.cardNumber === 'string' && spec.cardNumber.trim().length > 0, 'cardNumber 不能为空');
  assert(typeof spec.name === 'string' && spec.name.trim().length > 0, `${spec.cardNumber}.name 不能为空`);

  if (cardDb) {
    const cardDef = cardDb.getCard(spec.cardNumber);
    assert(cardDef !== undefined, `卡牌编号 ${spec.cardNumber} 不存在于官方卡表`);
  }

  if (spec.vanillaEntry && (spec.entry !== undefined || spec.entries !== undefined)) {
    throw new Error(`卡牌声明式效果校验失败：${spec.cardNumber} 不能同时标记 vanillaEntry=true 与配置 entry`);
  }
  if (spec.entry !== undefined && spec.entries !== undefined) {
    throw new Error(`卡牌声明式效果校验失败：${spec.cardNumber} 不能同时配置 entry 与 entries`);
  }
  if (spec.activate !== undefined && spec.activates !== undefined) {
    throw new Error(`卡牌声明式效果校验失败：${spec.cardNumber} 不能同时配置 activate 与 activates`);
  }

  if (spec.ignoreAttributeCondition) {
    validateCondition(spec.ignoreAttributeCondition, new Set(), `${spec.cardNumber}.ignoreAttributeCondition`);
  }
  if (spec.fieldIgnoreAttributeRule) {
    const rule = spec.fieldIgnoreAttributeRule;
    assert(
      Array.isArray(rule.zones) && rule.zones.length > 0,
      `${spec.cardNumber}.fieldIgnoreAttributeRule.zones 不能为空`
    );
    rule.zones.forEach((z) =>
      assert(VALID_FIELD_IGNORE_ATTR_ZONES.has(z), `${spec.cardNumber}.fieldIgnoreAttributeRule.zones 非法值: ${String(z)}`)
    );
    if (rule.targetTrait !== undefined) {
      assert(
        typeof rule.targetTrait === 'string' && rule.targetTrait.trim().length > 0,
        `${spec.cardNumber}.fieldIgnoreAttributeRule.targetTrait 必须是非空字符串`
      );
    }
    if (rule.onlyAscensionRoles !== undefined) {
      assert(
        typeof rule.onlyAscensionRoles === 'boolean',
        `${spec.cardNumber}.fieldIgnoreAttributeRule.onlyAscensionRoles 必须是布尔值`
      );
    }
  }
  if (spec.playFromZones !== undefined) {
    assert(Array.isArray(spec.playFromZones) && spec.playFromZones.length > 0, `${spec.cardNumber}.playFromZones 不能为空`);
    spec.playFromZones.forEach((z) =>
      assert(VALID_PLAY_FROM_ZONES.has(z), `${spec.cardNumber}.playFromZones 非法值: ${String(z)}`)
    );
  }
  if (spec.usableZones !== undefined) {
    assert(Array.isArray(spec.usableZones) && spec.usableZones.length > 0, `${spec.cardNumber}.usableZones 不能为空`);
    spec.usableZones.forEach((z) => assert(VALID_USABLE_ZONES.has(z), `${spec.cardNumber}.usableZones 非法值: ${String(z)}`));
  }
  if (spec.maxPlaysPerTurnByName !== undefined) {
    assertPositiveInt(spec.maxPlaysPerTurnByName, `${spec.cardNumber}.maxPlaysPerTurnByName`);
  }
  if (spec.playPrecondition) {
    assert(spec.playPrecondition.errorMessage.length > 0, `${spec.cardNumber}.playPrecondition.errorMessage 不能为空`);
    validateCondition(spec.playPrecondition.condition, new Set(), `${spec.cardNumber}.playPrecondition.condition`);
  }
  if (spec.tactics) {
    validateSteps(spec.tactics, new Set(), `${spec.cardNumber}.tactics`, grantedTriggerRefs);
  }
  if (spec.entry) {
    const costVars = validateCost(spec.entry.cost, `${spec.cardNumber}.entry.cost`);
    validateSteps(spec.entry.steps, costVars, `${spec.cardNumber}.entry.steps`, grantedTriggerRefs);
  }
  if (spec.entries !== undefined) {
    assert(Array.isArray(spec.entries) && spec.entries.length > 0, `${spec.cardNumber}.entries 不能为空`);
    spec.entries.forEach((entry, i) => {
      const costVars = validateCost(entry.cost, `${spec.cardNumber}.entries[${i}].cost`);
      validateSteps(entry.steps, costVars, `${spec.cardNumber}.entries[${i}].steps`, grantedTriggerRefs);
    });
  }
  if (spec.activate) {
    validateActivateSpec(spec.activate, `${spec.cardNumber}.activate`, grantedTriggerRefs);
  }
  if (spec.activates !== undefined) {
    assert(Array.isArray(spec.activates) && spec.activates.length > 0, `${spec.cardNumber}.activates 不能为空`);
    spec.activates.forEach((act, i) =>
      validateActivateSpec(act, `${spec.cardNumber}.activates[${i}]`, grantedTriggerRefs)
    );
  }
  if (spec.triggers) {
    spec.triggers.forEach((t, i) => validateTrigger(t, `${spec.cardNumber}.triggers[${i}]`, grantedTriggerRefs));
  }
  if (spec.staticEffects) {
    spec.staticEffects.forEach((s, i) =>
      validateStaticEffect(s, `${spec.cardNumber}.staticEffects[${i}]`, grantedTriggerRefs)
    );
  }
  if (spec.fieldCardCostRule) {
    const rule = spec.fieldCardCostRule;
    if (rule.setCost !== undefined) assertNonNegativeInt(rule.setCost, `${spec.cardNumber}.fieldCardCostRule.setCost`);
    if (rule.discount !== undefined) assertPositiveInt(rule.discount, `${spec.cardNumber}.fieldCardCostRule.discount`);
    if (rule.cardType !== undefined) {
      assert(VALID_CARD_TYPES.has(rule.cardType), `${spec.cardNumber}.fieldCardCostRule.cardType 非法: ${String(rule.cardType)}`);
    }
    assert(
      rule.setCost !== undefined || rule.discount !== undefined,
      `${spec.cardNumber}.fieldCardCostRule 必须指定 setCost 或 discount`
    );
  }
  if (spec.equipmentGrantedActivate) {
    assert(spec.equipmentGrantedActivate.label.length > 0, `${spec.cardNumber}.equipmentGrantedActivate.label 不能为空`);
    validateActivateSpec(
      spec.equipmentGrantedActivate.activate,
      `${spec.cardNumber}.equipmentGrantedActivate.activate`,
      grantedTriggerRefs
    );
  }
  if (spec.playDiscardDiscount) {
    const disc = spec.playDiscardDiscount;
    if (disc.sourceZone !== undefined) {
      assert(
        disc.sourceZone === 'HAND' || disc.sourceZone === 'SIGNAL_ORB',
        `${spec.cardNumber}.playDiscardDiscount.sourceZone 非法: ${String(disc.sourceZone)}`
      );
    }
    if (disc.signalOrbColor !== undefined) {
      assert(
        VALID_ORB_COLORS.has(disc.signalOrbColor),
        `${spec.cardNumber}.playDiscardDiscount.signalOrbColor 非法: ${String(disc.signalOrbColor)}`
      );
    }
    validateFilter(disc.filter, `${spec.cardNumber}.playDiscardDiscount.filter`);
    assertPositiveInt(disc.discountPerCard, `${spec.cardNumber}.playDiscardDiscount.discountPerCard`);
  }
  if (spec.playSacrificeDiscount) {
    const sac = spec.playSacrificeDiscount;
    assert(Array.isArray(sac.zones) && sac.zones.length > 0, `${spec.cardNumber}.playSacrificeDiscount.zones 不能为空`);
    sac.zones.forEach((z) =>
      assert(VALID_PLAY_SACRIFICE_ZONES.has(z), `${spec.cardNumber}.playSacrificeDiscount.zones 非法值: ${String(z)}`)
    );
    if (sac.setCost !== undefined) assertNonNegativeInt(sac.setCost, `${spec.cardNumber}.playSacrificeDiscount.setCost`);
    if (sac.discount !== undefined) assertPositiveInt(sac.discount, `${spec.cardNumber}.playSacrificeDiscount.discount`);
    validateFilter(sac.filter, `${spec.cardNumber}.playSacrificeDiscount.filter`);
    assert(
      sac.setCost !== undefined || sac.discount !== undefined,
      `${spec.cardNumber}.playSacrificeDiscount 必须指定 setCost 或 discount`
    );
  }
  if (spec.handCostDiscount) {
    if ('condition' in spec.handCostDiscount) {
      validateCondition(spec.handCostDiscount.condition, new Set(), `${spec.cardNumber}.handCostDiscount.condition`);
      assertPositiveInt(spec.handCostDiscount.flatDiscount, `${spec.cardNumber}.handCostDiscount.flatDiscount`);
    } else if ('zone' in spec.handCostDiscount) {
      assert(VALID_ZONES.has(spec.handCostDiscount.zone), `${spec.cardNumber}.handCostDiscount.zone 非法`);
      validateFilter(spec.handCostDiscount.filter, `${spec.cardNumber}.handCostDiscount.filter`);
      assertPositiveInt(spec.handCostDiscount.discountPerCard, `${spec.cardNumber}.handCostDiscount.discountPerCard`);
    } else {
      validateFilter(spec.handCostDiscount.filter, `${spec.cardNumber}.handCostDiscount.filter`);
      assertPositiveInt(spec.handCostDiscount.discountPerRole, `${spec.cardNumber}.handCostDiscount.discountPerRole`);
    }
  }
}

/**
 * 校验单张卡牌的声明式效果描述，任何配置错误立即抛出明确异常 (docs/future-work.md §3.2)
 */
export function validateCardEffectSpec(spec: CardEffectSpec, cardDb?: ICardDatabase): void {
  validateCardEffectSpecInternal(spec, cardDb);
}

/**
 * 校验整份声明式效果注册表 (去重 + 逐卡结构校验 + 触发/静态 ID 唯一性及 grantedTriggerIds 交叉校验)
 */
export function validateCardEffectRegistry(
  specs: readonly CardEffectSpec[],
  cardDb?: ICardDatabase
): Map<string, CardEffectSpec> {
  const map = new Map<string, CardEffectSpec>();
  const triggerIds = new Set<string>();
  const staticIds = new Set<string>();
  const grantedTriggerRefs: GrantedTriggerRef[] = [];

  for (const spec of specs) {
    validateCardEffectSpecInternal(spec, cardDb, grantedTriggerRefs);
    assert(!map.has(spec.cardNumber), `重复注册了卡牌 ${spec.cardNumber} 的声明式效果`);
    map.set(spec.cardNumber, spec);

    for (const t of spec.triggers ?? []) {
      assert(!triggerIds.has(t.abilityId), `重复注册了自动能力 ID: ${t.abilityId}`);
      triggerIds.add(t.abilityId);
    }
    for (const s of spec.staticEffects ?? []) {
      assert(!staticIds.has(s.id), `重复注册了静态效果 ID: ${s.id}`);
      staticIds.add(s.id);
    }
  }

  for (const ref of grantedTriggerRefs) {
    assert(triggerIds.has(ref.id), `${ref.path} 引用了未注册的自动能力 ID: "${ref.id}"`);
  }

  return map;
}

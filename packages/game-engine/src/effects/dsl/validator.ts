import type { ICardDatabase } from '../../database/card-registry.js';
import type {
  AbilityCost,
  CardEffectSpec,
  CardFilter,
  CardTargetRef,
  CompareOp,
  ConditionExpr,
  DeclarativeStaticEffectSpec,
  DeclarativeTriggerSpec,
  EffectStep,
  ModifierDuration,
  NumberExpr,
  OrbColorFilter,
  PlayerSide,
} from './types.js';

const VALID_SIDES = new Set<PlayerSide>(['SELF', 'OPPONENT']);
const VALID_ORB_FILTERS = new Set<OrbColorFilter>(['ANY', 'SAME', 'RED', 'BLUE', 'YELLOW']);
const VALID_DURATIONS = new Set<ModifierDuration>(['END_OF_TURN', 'END_OF_NEXT_TURN', 'UNTIL_LEAVE_ZONE']);
const VALID_COMPARE_OPS = new Set<CompareOp>(['>=', '<=', '==', '>', '<']);
const VALID_CHOOSE_ZONES = new Set(['HAND', 'GRAVEYARD', 'SIGNAL_ORB', 'COST', 'DECK']);
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
const VALID_ORB_COLORS = new Set(['RED', 'BLUE', 'YELLOW']);
const VALID_TRIGGER_MATCHERS = new Set([
  'EQUIPPED_ROLE_ATTACKING',
  'OTHER_FRIENDLY_ROLE_ENTERED',
  'SELF_ATTACKING',
  'SELF_BLOCKED_ATTACK_END',
  'GRANTED_BLOCKED_ATTACK_END',
  'FRIENDLY_ROLE_BLOCKING',
  'SELF_TURN_END',
  'SELF_BECAME_PARTNER',
]);
const VALID_PROHIBITIONS = new Set([
  'CANNOT_ATTACK',
  'CANNOT_BLOCK',
  'CANNOT_DEAL_DAMAGE',
  'CANNOT_GAIN_ABILITIES',
  'CANNOT_ELIMINATE',
  'CANNOT_MODIFY_PP_BY_OPPONENT',
  'CANNOT_DISCARD_HIDDEN_COST_AT_END',
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

function validateFilter(filter: CardFilter | undefined, path: string): void {
  if (!filter) return;
  if (filter.anyTraits !== undefined) {
    assert(Array.isArray(filter.anyTraits) && filter.anyTraits.length > 0, `${path}.anyTraits 不能为空数组`);
  }
  if (filter.anyFilters !== undefined) {
    assert(Array.isArray(filter.anyFilters) && filter.anyFilters.length > 0, `${path}.anyFilters 不能为空数组`);
    filter.anyFilters.forEach((f, i) => validateFilter(f, `${path}.anyFilters[${i}]`));
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
      return;
    case 'VAR_COUNT_MULT':
      assert(typeof expr.varName === 'string' && expr.varName.length > 0, `${path}.varName 不能为空`);
      if (definedVars) assert(definedVars.has(expr.varName), `${path} 引用了未定义变量 "${expr.varName}"`);
      assert(Number.isFinite(expr.multiplier), `${path}.multiplier 必须是有限数字`);
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
    case 'HAS_EMPTY_SLOT':
      assert(VALID_SIDES.has(cond.side), `${path}.side 非法`);
      return;
    case 'TURN_OWNER':
      assert(typeof cond.isSelfTurn === 'boolean', `${path}.isSelfTurn 必须是布尔值`);
      return;
    case 'VAR_NON_EMPTY':
      assert(definedVars.has(cond.varName), `${path} 引用了未定义变量 "${cond.varName}"`);
      return;
    case 'VAR_HAS_CARD_MATCHING':
      assert(definedVars.has(cond.varName), `${path} 引用了未定义变量 "${cond.varName}"`);
      validateFilter(cond.filter, `${path}.filter`);
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
    case 'TRIGGER_ATTACKER':
    case 'TRIGGER_BLOCKER':
    case 'TRIGGER_HOST':
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
      return vars;
    case 'TAP_SELF_AND_DISCARD_HAND':
      assertPositiveInt(cost.count, `${path}.count`);
      validateFilter(cost.filter, `${path}.filter`);
      return vars;
    case 'PAY_COST':
      assertPositiveInt(cost.amount, `${path}.amount`);
      return vars;
    default:
      throw new Error(`卡牌声明式效果校验失败：${path} 未知的代价类型 ${(cost as { kind?: unknown }).kind}`);
  }
}

function validateSteps(steps: EffectStep[], parentVars: ReadonlySet<string>, path: string): Set<string> {
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
        assertPositiveInt(step.count, `${sp}.count`);
        if (step.side !== undefined) assert(VALID_SIDES.has(step.side), `${sp}.side 非法`);
        assert(typeof step.saveToVar === 'string' && step.saveToVar.length > 0, `${sp}.saveToVar 不能为空`);
        vars.add(step.saveToVar);
        break;
      case 'CONFIRM_YES_NO':
        assert(step.prompt.length > 0 && step.yesLabel.length > 0 && step.noLabel.length > 0, `${sp} 提示文案不能为空`);
        assert(step.onYes.length > 0, `${sp}.onYes 不能为空`);
        validateSteps(step.onYes, vars, `${sp}.onYes`);
        if (step.onNo) validateSteps(step.onNo, vars, `${sp}.onNo`);
        break;
      case 'CHOOSE_ROLES': {
        assert(VALID_SIDES.has(step.side as PlayerSide) || step.side === 'ANY', `${sp}.side 非法`);
        assert(step.prompt.length > 0, `${sp}.prompt 不能为空`);
        const min = step.min ?? 1;
        const max = step.max ?? 1;
        assertNonNegativeInt(min, `${sp}.min`);
        assertPositiveInt(max, `${sp}.max`);
        assert(min <= max, `${sp}.min (${min}) 不能大于 max (${max})`);
        validateFilter(step.filter, `${sp}.filter`);
        validateFilter(step.eligibilityFilter, `${sp}.eligibilityFilter`);
        assert(step.saveToVar.length > 0, `${sp}.saveToVar 不能为空`);
        vars.add(step.saveToVar);
        break;
      }
      case 'CHOOSE_ZONE_CARDS': {
        assert(VALID_SIDES.has(step.side), `${sp}.side 非法`);
        assert(VALID_CHOOSE_ZONES.has(step.zone), `${sp}.zone 非法: ${String(step.zone)}`);
        assert(step.prompt.length > 0, `${sp}.prompt 不能为空`);
        const min = step.min ?? 1;
        const max = step.max ?? 1;
        assertNonNegativeInt(min, `${sp}.min`);
        assertPositiveInt(max, `${sp}.max`);
        assert(min <= max, `${sp}.min (${min}) 不能大于 max (${max})`);
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
        const min = step.min ?? 1;
        const max = step.max ?? 1;
        assertNonNegativeInt(min, `${sp}.min`);
        assertPositiveInt(max, `${sp}.max`);
        assert(min <= max && max <= step.modes.length, `${sp} min/max (${min}/${max}) 越界`);
        const modeIds = new Set<string>();
        step.modes.forEach((m, mi) => {
          assert(m.id.length > 0 && m.label.length > 0, `${sp}.modes[${mi}] id 与 label 不能为空`);
          assert(!modeIds.has(m.id), `${sp}.modes 存在重复 id "${m.id}"`);
          modeIds.add(m.id);
          validateSteps(m.steps, vars, `${sp}.modes[${mi}].steps`);
        });
        break;
      }
      case 'ELIMINATE_ORB_COST': {
        assert(VALID_ORB_FILTERS.has(step.filter), `${sp}.filter 非法: ${String(step.filter)}`);
        assertPositiveInt(step.count, `${sp}.count`);
        assert(step.onPaid.length > 0, `${sp}.onPaid 不能为空`);
        const innerVars = new Set(vars);
        if (step.savePaidToVar) innerVars.add(step.savePaidToVar);
        validateSteps(step.onPaid, innerVars, `${sp}.onPaid`);
        break;
      }
      case 'DISCARD_COST_STEP': {
        assertPositiveInt(step.count, `${sp}.count`);
        validateFilter(step.filter, `${sp}.filter`);
        assert(step.onPaid.length > 0, `${sp}.onPaid 不能为空`);
        const innerVars = new Set(vars);
        if (step.savePaidToVar) innerVars.add(step.savePaidToVar);
        validateSteps(step.onPaid, innerVars, `${sp}.onPaid`);
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
      case 'AIRBORNE':
        validateTarget(step.target, vars, `${sp}.target`);
        if (step.saveAirborneToVar) vars.add(step.saveAirborneToVar);
        break;
      case 'ATTACH_PARTNER':
        validateTarget(step.host, vars, `${sp}.host`);
        validateTarget(step.partner, vars, `${sp}.partner`);
        break;
      case 'MODIFY_STATS': {
        validateTarget(step.target, vars, `${sp}.target`);
        assert(VALID_DURATIONS.has(step.duration), `${sp}.duration 非法: ${String(step.duration)}`);
        validateNumberExpr(step.pp, `${sp}.pp`, vars);
        validateNumberExpr(step.dp, `${sp}.dp`, vars);
        validateNumberExpr(step.setPP, `${sp}.setPP`, vars);
        validateNumberExpr(step.setDP, `${sp}.setDP`, vars);
        validateNumberExpr(step.charge, `${sp}.charge`, vars);
        validateNumberExpr(step.setCharge, `${sp}.setCharge`, vars);
        if (step.prohibitions !== undefined) {
          assert(Array.isArray(step.prohibitions), `${sp}.prohibitions 必须是数组`);
          for (const p of step.prohibitions) {
            assert(VALID_PROHIBITIONS.has(p), `${sp}.prohibitions 非法值: ${String(p)}`);
          }
        }
        if (step.treatedAsOrbColors !== undefined) {
          assert(Array.isArray(step.treatedAsOrbColors), `${sp}.treatedAsOrbColors 必须是数组`);
          for (const c of step.treatedAsOrbColors) {
            assert(VALID_ORB_COLORS.has(c), `${sp}.treatedAsOrbColors 非法颜色: ${String(c)}`);
          }
        }
        if (step.orbValue !== undefined) {
          assertPositiveInt(step.orbValue, `${sp}.orbValue`);
        }
        if (step.treatedAsNames !== undefined) {
          assert(Array.isArray(step.treatedAsNames), `${sp}.treatedAsNames 必须是数组`);
        }
        if (step.unblockableMaxPP !== undefined) {
          assertNonNegativeInt(step.unblockableMaxPP, `${sp}.unblockableMaxPP`);
        }
        const hasAnyMod =
          step.pp !== undefined ||
          step.dp !== undefined ||
          step.setPP !== undefined ||
          step.setDP !== undefined ||
          step.charge !== undefined ||
          step.setCharge !== undefined ||
          (step.keywords && step.keywords.length > 0) ||
          (step.removeKeywords && step.removeKeywords.length > 0) ||
          (step.addTraits && step.addTraits.length > 0) ||
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
        assertPositiveInt(step.amount, `${sp}.amount`);
        if (step.remainingCount !== undefined) assertPositiveInt(step.remainingCount, `${sp}.remainingCount`);
        break;
      case 'CHANGE_EROSION':
        assert(typeof step.delta === 'number' && Number.isInteger(step.delta) && step.delta !== 0, `${sp}.delta 必须是非零整数`);
        if (step.side !== undefined) assert(VALID_SIDES.has(step.side), `${sp}.side 非法`);
        break;
      case 'REGISTER_DELAYED_TRIGGER':
        validateTarget(step.target, vars, `${sp}.target`);
        assert(step.eventType === 'END_PHASE_TRIGGERS', `${sp}.eventType 非法`);
        assert(step.abilityId === 'DELAYED_END_OF_TURN_TO_GRAVEYARD', `${sp}.abilityId 非法`);
        if (step.expectedZone !== undefined) {
          assert(VALID_ZONES.has(step.expectedZone), `${sp}.expectedZone 非法: ${String(step.expectedZone)}`);
        }
        if (step.turnOffset !== undefined) assertNonNegativeInt(step.turnOffset, `${sp}.turnOffset`);
        break;
      case 'IF':
        validateCondition(step.condition, vars, `${sp}.condition`);
        validateSteps(step.then, vars, `${sp}.then`);
        if (step.else) validateSteps(step.else, vars, `${sp}.else`);
        break;
      default:
        throw new Error(`卡牌声明式效果校验失败：${sp} 未知的操作原语 ${(step as { op?: unknown }).op}`);
    }
  });

  return vars;
}

function validateTrigger(trig: DeclarativeTriggerSpec, path: string): void {
  assert(typeof trig.abilityId === 'string' && trig.abilityId.length > 0, `${path}.abilityId 不能为空`);
  assert(typeof trig.label === 'string' && trig.label.length > 0, `${path}.label 不能为空`);
  assert(
    trig.matcher && VALID_TRIGGER_MATCHERS.has(trig.matcher.kind),
    `${path}.matcher.kind 非法`
  );
  if (trig.condition) validateCondition(trig.condition, new Set(), `${path}.condition`);
  const costVars = validateCost(trig.cost, `${path}.cost`);
  validateSteps(trig.steps, costVars, `${path}.steps`);
}

function validateStaticEffect(eff: DeclarativeStaticEffectSpec, path: string): void {
  assert(typeof eff.id === 'string' && eff.id.length > 0, `${path}.id 不能为空`);
  assert(
    eff.scope === 'SELF' ||
      eff.scope === 'ALL_FRIENDLY_ROLES' ||
      eff.scope === 'PARTNER_HOST' ||
      eff.scope === 'UNDERNEATH_HOST',
    `${path}.scope 非法`
  );
  validateFilter(eff.selfFilter, `${path}.selfFilter`);
  validateFilter(eff.targetFilter, `${path}.targetFilter`);
  if (eff.condition) validateCondition(eff.condition, new Set(), `${path}.condition`);
  validateNumberExpr(eff.pp, `${path}.pp`);
  validateNumberExpr(eff.setPP, `${path}.setPP`);
  validateNumberExpr(eff.dp, `${path}.dp`);
  validateNumberExpr(eff.setDP, `${path}.setDP`);
  validateNumberExpr(eff.charge, `${path}.charge`);
  validateNumberExpr(eff.setCharge, `${path}.setCharge`);
  if (eff.unblockableMaxPP !== undefined) assertNonNegativeInt(eff.unblockableMaxPP, `${path}.unblockableMaxPP`);
  const hasAnyEffect =
    eff.pp !== undefined ||
    eff.setPP !== undefined ||
    eff.dp !== undefined ||
    eff.setDP !== undefined ||
    eff.charge !== undefined ||
    eff.setCharge !== undefined ||
    (eff.keywords && eff.keywords.length > 0) ||
    (eff.addTraits && eff.addTraits.length > 0) ||
    (eff.prohibitions && eff.prohibitions.length > 0) ||
    (eff.treatedAsOrbColors && eff.treatedAsOrbColors.length > 0) ||
    eff.orbValue !== undefined ||
    (eff.treatedAsNames && eff.treatedAsNames.length > 0) ||
    eff.unblockableMaxPP !== undefined;
  assert(hasAnyEffect, `${path} 至少须指定一项静态增益`);
}

/**
 * 校验单张卡牌的声明式效果描述，任何配置错误立即抛出明确异常 (docs/future-work.md §3.2)
 */
export function validateCardEffectSpec(spec: CardEffectSpec, cardDb?: ICardDatabase): void {
  assert(typeof spec.cardNumber === 'string' && spec.cardNumber.trim().length > 0, 'cardNumber 不能为空');
  assert(typeof spec.name === 'string' && spec.name.trim().length > 0, `${spec.cardNumber}.name 不能为空`);

  if (cardDb) {
    const cardDef = cardDb.getCard(spec.cardNumber);
    assert(cardDef !== undefined, `卡牌编号 ${spec.cardNumber} 不存在于官方卡表`);
  }

  if (spec.vanillaEntry && spec.entry) {
    throw new Error(`卡牌声明式效果校验失败：${spec.cardNumber} 不能同时标记 vanillaEntry=true 与配置 entry`);
  }

  if (spec.ignoreAttributeCondition) {
    validateCondition(spec.ignoreAttributeCondition, new Set(), `${spec.cardNumber}.ignoreAttributeCondition`);
  }
  if (spec.playPrecondition) {
    assert(spec.playPrecondition.errorMessage.length > 0, `${spec.cardNumber}.playPrecondition.errorMessage 不能为空`);
    validateCondition(spec.playPrecondition.condition, new Set(), `${spec.cardNumber}.playPrecondition.condition`);
  }
  if (spec.tactics) {
    validateSteps(spec.tactics, new Set(), `${spec.cardNumber}.tactics`);
  }
  if (spec.entry) {
    const costVars = validateCost(spec.entry.cost, `${spec.cardNumber}.entry.cost`);
    validateSteps(spec.entry.steps, costVars, `${spec.cardNumber}.entry.steps`);
  }
  if (spec.activate) {
    if (spec.activate.condition) {
      validateCondition(spec.activate.condition, new Set(), `${spec.cardNumber}.activate.condition`);
    }
    const costVars = validateCost(spec.activate.cost, `${spec.cardNumber}.activate.cost`);
    validateSteps(spec.activate.steps, costVars, `${spec.cardNumber}.activate.steps`);
  }
  if (spec.triggers) {
    spec.triggers.forEach((t, i) => validateTrigger(t, `${spec.cardNumber}.triggers[${i}]`));
  }
  if (spec.staticEffects) {
    spec.staticEffects.forEach((s, i) => validateStaticEffect(s, `${spec.cardNumber}.staticEffects[${i}]`));
  }
  if (spec.fieldCardCostRule) {
    assert(
      spec.fieldCardCostRule.setCost !== undefined || spec.fieldCardCostRule.discount !== undefined,
      `${spec.cardNumber}.fieldCardCostRule 必须指定 setCost 或 discount`
    );
  }
  if (spec.handCostDiscount) {
    if ('condition' in spec.handCostDiscount) {
      validateCondition(spec.handCostDiscount.condition, new Set(), `${spec.cardNumber}.handCostDiscount.condition`);
      assertPositiveInt(spec.handCostDiscount.flatDiscount, `${spec.cardNumber}.handCostDiscount.flatDiscount`);
    } else {
      validateFilter(spec.handCostDiscount.filter, `${spec.cardNumber}.handCostDiscount.filter`);
      assertPositiveInt(spec.handCostDiscount.discountPerRole, `${spec.cardNumber}.handCostDiscount.discountPerRole`);
    }
  }
}

/**
 * 校验整份声明式效果注册表 (去重 + 逐卡结构校验 + 触发/静态 ID 唯一性校验)
 */
export function validateCardEffectRegistry(
  specs: readonly CardEffectSpec[],
  cardDb?: ICardDatabase
): Map<string, CardEffectSpec> {
  const map = new Map<string, CardEffectSpec>();
  const triggerIds = new Set<string>();
  const staticIds = new Set<string>();

  for (const spec of specs) {
    validateCardEffectSpec(spec, cardDb);
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
  return map;
}

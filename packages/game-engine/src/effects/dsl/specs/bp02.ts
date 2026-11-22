import { CardType, ElementAttribute } from '@zhanshuang/shared';
import type { CardEffectSpec, CardFilter, EffectStep } from '../types.js';

/** <封刃太刀>/<机械教会> 等由连续效果层 expandBaseTraits 自动展开 */

/** BP02-010 / BP02-015 / BP02-016 共用的「我方<丽芙>角色因效果或代价从战场送墓」触发配置 */
function createLivSentToGyTrigger(
  abilityId: string,
  label: string,
  steps: EffectStep[],
  extra?: {
    cost?: NonNullable<CardEffectSpec['triggers']>[number]['cost'];
    deferOncePerTurnUntilCostPaid?: boolean;
  }
): NonNullable<CardEffectSpec['triggers']>[number] {
  return {
    abilityId,
    eventType: 'CARD_SENT_FIELD_TO_GY_BY_EFFECT',
    oncePerTurn: true,
    ...(extra?.deferOncePerTurnUntilCostPaid ? { deferOncePerTurnUntilCostPaid: true } : {}),
    matcher: {
      kind: 'ANY_CARD_SENT_FIELD_TO_GY_BY_EFFECT',
      side: 'SELF',
      filter: { cardType: CardType.ROLE, trait: '丽芙' },
      includeSelf: true,
    },
    label,
    ...(extra?.cost ? { cost: extra.cost } : {}),
    steps,
  };
}

/** BP02-013 / BP02-014 共用的手牌减费规则（我方角色少于对方时费用 -1） */
const LIV_LESS_ROLES_HAND_DISCOUNT: NonNullable<CardEffectSpec['handCostDiscount']> = {
  condition: { kind: 'FRIENDLY_ROLE_COUNT_COMPARE_OPPONENT', op: '<' },
  flatDiscount: 1,
};

/** BP02-022 与异画 BP02-022【冠军】共用构造器，确保 staticEffects.id 全局唯一 */
function createBianca022Spec(cardNumber: 'BP02-022' | 'BP02-022【冠军】'): CardEffectSpec {
  return {
    cardNumber,
    name: '比安卡·晖暮',
    vanillaEntry: true,
    // 晖【永】：手牌的该牌的费用-4
    handCostDiscount: {
      condition: { kind: 'SIGNAL_ORB_BOTTOM_COST_PARITY', parity: 'ODD' },
      flatDiscount: 4,
    },
    // 暮【永】：【速攻】（同步由 keywords.ts 与声明式静态规则双重保证）
    staticEffects: [
      {
        id: `dsl:${cardNumber}:dusk_rush`,
        scope: 'SELF',
        condition: { kind: 'SIGNAL_ORB_BOTTOM_COST_PARITY', parity: 'EVEN' },
        keywords: ['速攻'],
      },
    ],
  };
}

/** BP02-050 每送墓 1 张<万世铭>时从 2 项中选最多 1 项的通用步骤 */
function createBp02050ModeStep(suffix: string): EffectStep {
  return {
    op: 'CHOOSE_MODE',
    prompt: '【曲·启明】【出】请从以下 2 项选择最多 1 项：',
    min: 0,
    max: 1,
    choiceEffectType: `DSL_BP02_050_MODE_${suffix}`,
    modes: [
      {
        id: `rush_${suffix}`,
        label: '直到回合结束为止，该牌获得【速攻】',
        steps: [
          {
            op: 'MODIFY_STATS',
            target: { kind: 'SELF' },
            keywords: ['速攻'],
            duration: 'END_OF_TURN',
          },
        ],
      },
      {
        id: `buff_qu_${suffix}`,
        label: '选择我方战场 1 张《曲·启明》，直到回合结束获得【充能+1】，PP+1000',
        steps: [
          {
            op: 'CHOOSE_ROLES',
            side: 'SELF',
            filter: { exactName: '曲·启明' },
            prompt: '【曲·启明】请选择我方战场 1 张《曲·启明》，直到回合结束【充能+1】、PP+1000：',
            min: 1,
            max: 1,
            saveToVar: `buffTarget_${suffix}`,
          },
          {
            op: 'MODIFY_STATS',
            target: { kind: 'VAR', varName: `buffTarget_${suffix}` },
            charge: 1,
            pp: 1000,
            duration: 'END_OF_TURN',
          },
        ],
      },
    ],
  };
}

/** BP02-069 / BP02-070 / BP02-076 共用「可公开手牌 2 张<万事>，选择对方费用 <= N 角色冰冻」步骤 */
function createWanshiRevealFreezeSteps(
  maxCost: number,
  sourceLabel: string,
  tag: string
): EffectStep[] {
  return [
    {
      op: 'IF',
      condition: {
        kind: 'ZONE_COUNT',
        side: 'SELF',
        zone: 'HAND',
        filter: { trait: '万事' },
        op: '>=',
        value: 2,
      },
      then: [
        {
          op: 'CONFIRM_YES_NO',
          prompt: `【${sourceLabel}】是否公开我方手牌 2 张<万事>，选择对方战场 1 张费用为 ${maxCost} 及以下的角色冰冻？`,
          yesLabel: '公开 2 张<万事>',
          noLabel: '不发动',
          choiceEffectType: `DSL_${tag}_CONFIRM`,
          onYes: [
            {
              op: 'CHOOSE_ZONE_CARDS',
              side: 'SELF',
              zone: 'HAND',
              filter: { trait: '万事' },
              prompt: `【${sourceLabel}】请选择要公开的 2 张<万事>手牌：`,
              min: 2,
              max: 2,
              saveToVar: 'revealedWanshi',
              choiceEffectType: `DSL_${tag}_REVEAL`,
            },
            {
              op: 'IF',
              condition: { kind: 'VAR_COUNT_COMPARE', varName: 'revealedWanshi', op: '==', value: 2 },
              then: [
                {
                  op: 'CHOOSE_ROLES',
                  side: 'OPPONENT',
                  filter: { maxCost },
                  prompt: `【${sourceLabel}】请选择对方战场 1 张费用为 ${maxCost} 及以下的角色将其冰冻：`,
                  min: 1,
                  max: 1,
                  saveToVar: 'freezeTarget',
                  choiceEffectType: `DSL_${tag}_TARGET`,
                },
                {
                  op: 'SET_FROZEN',
                  target: { kind: 'VAR', varName: 'freezeTarget' },
                  isFrozen: true,
                },
              ],
            },
          ],
        },
      ],
    },
  ];
}

/** 含英·檀心 BP02-037 / BP02-038 共用筛选：该牌下方叠置或装备中存在《飞叶点翠》 */
const SELF_HAS_LEAF_FILTER: CardFilter = {
  hasUnderneathOrEquipMatching: { exactName: '飞叶点翠' },
};

/** BP02-049 / BP02-051 共用的费用区（仅明费 3.6.3.b.2）与墓地<万世铭>联合筛选 */
const COST_OR_GY_WANSHIMING_FILTER: CardFilter = {
  anyFilters: [
    { inZone: 'COST', isFaceUp: true, trait: '万世铭' },
    { inZone: 'GRAVEYARD', trait: '万世铭' },
  ],
};

/**
 * 补充包 BP02《重返极夜》全套 91 张卡牌声明式效果集合（含异画 BP02-022【冠军】）。
 *
 * 说明：
 * - BP02-013 与 BP02-049 的战斗破坏置换能力已内置于 replacement-engine.ts，此处勿重复注册触发器。
 * - BP02-040 的「所有区域视为《飞叶点翠》」已内置于 continuous-effects.ts (static:BP02-040)，此处勿重复注册。
 * - BP02-067 的「横置状态下对方在横置角色上升变额外支付 1 费」已内置于 engine.ts，此处仅声明其【出】能力。
 * - BP02-077 ~ BP02-081 的【充能0】【同命】由 rules/keywords.ts 与 preset-cards.ts 统一驱动。
 * - BP02-082 ~ BP02-090 为标准信号球牌，【充能自】由 card-effects.ts 统一处理。
 */
export const BP02_EFFECT_SPECS: readonly CardEffectSpec[] = [
  // =========================================================================
  // 1. 伊什梅尔·幻日体系 (BP02-001 ~ BP02-009)
  // =========================================================================

  // BP02-001 伊什梅尔·幻日 (7费 升变)
  {
    cardNumber: 'BP02-001',
    name: '伊什梅尔·幻日',
    entry: {
      cost: {
        kind: 'ELIMINATE_ORBS',
        filter: 'ANY',
        count: 3,
        optional: true,
        prompt: '【伊什梅尔·幻日】【出】是否消除【3任意信号球】将手牌 1 张升变角色效果无效出场并触发属性效果？',
      },
      steps: [
        {
          op: 'CHOOSE_ZONE_CARDS',
          side: 'SELF',
          zone: 'HAND',
          filter: {
            cardType: CardType.ROLE,
            isAscended: true,
            excludeAttribute: ElementAttribute.VOID,
            maxCostOpenCostLimit: true,
          },
          requireEmptySlot: true,
          prompt: '【伊什梅尔·幻日】【出】请选择手牌 1 张费用不大于我方明费上限的非空属性升变角色效果无效出场：',
          min: 1,
          max: 1,
          saveToVar: 'pickedAsc',
        },
        {
          op: 'MOVE_CARDS',
          target: { kind: 'VAR', varName: 'pickedAsc' },
          toZone: 'BATTLEFIELD',
          loseAbilities: true,
          triggerEntry: false,
          saveMovedToVar: 'deployed',
        },
        // Q&A·4/5：没有卡位出场或未能出场时，后段属性效果不执行
        {
          op: 'IF',
          condition: { kind: 'VAR_NON_EMPTY', varName: 'deployed' },
          then: [
            {
              op: 'IF',
              condition: { kind: 'VAR_HAS_CARD_MATCHING', varName: 'deployed', filter: { attribute: ElementAttribute.FIRE } },
              then: [{ op: 'MODIFY_STATS', target: { kind: 'SELF' }, dp: 1, duration: 'END_OF_TURN' }],
            },
            {
              op: 'IF',
              condition: { kind: 'VAR_HAS_CARD_MATCHING', varName: 'deployed', filter: { attribute: ElementAttribute.LIGHTNING } },
              then: [{ op: 'MODIFY_STATS', target: { kind: 'SELF' }, unblockableMaxPP: 3000, duration: 'END_OF_TURN' }],
            },
            {
              op: 'IF',
              condition: { kind: 'VAR_HAS_CARD_MATCHING', varName: 'deployed', filter: { attribute: ElementAttribute.DARK } },
              then: [
                {
                  op: 'CHOOSE_ZONE_CARDS',
                  side: 'SELF',
                  zone: 'GRAVEYARD',
                  filter: { cardType: CardType.ROLE, excludeSelf: true },
                  prompt: '【伊什梅尔·幻日】暗属性效果：请选择我方墓地 1 张该牌以外的角色加入手牌：',
                  min: 1,
                  max: 1,
                  saveToVar: 'gyRole',
                },
                { op: 'MOVE_CARDS', target: { kind: 'VAR', varName: 'gyRole' }, toZone: 'HAND', isFaceUp: true },
              ],
            },
            {
              op: 'IF',
              condition: { kind: 'VAR_HAS_CARD_MATCHING', varName: 'deployed', filter: { attribute: ElementAttribute.ICE } },
              then: [
                {
                  op: 'CHOOSE_ZONE_CARDS',
                  side: 'OPPONENT',
                  zone: 'OPPONENT_HAND_BLIND',
                  prompt: '【伊什梅尔·幻日】冰属性效果：在不查看的情况下选择对方 1 张手牌，对方将其丢弃：',
                  min: 1,
                  max: 1,
                  saveToVar: 'oppDiscard',
                },
                { op: 'MOVE_CARDS', target: { kind: 'VAR', varName: 'oppDiscard' }, toZone: 'GRAVEYARD', isFaceUp: true },
              ],
            },
            {
              op: 'IF',
              condition: { kind: 'VAR_HAS_CARD_MATCHING', varName: 'deployed', filter: { attribute: ElementAttribute.PHYSICAL } },
              then: [{ op: 'MODIFY_STATS', target: { kind: 'SELF' }, pp: 2000, duration: 'END_OF_NEXT_TURN' }],
            },
          ],
        },
      ],
    },
  },

  // BP02-002 伊什梅尔·幻日 (5费)
  {
    cardNumber: 'BP02-002',
    name: '伊什梅尔·幻日',
    entry: {
      steps: [
        {
          op: 'CHOOSE_ZONE_CARDS',
          side: 'SELF',
          zone: 'HAND',
          filter: { cardType: CardType.ROLE, isAscended: true },
          distinctAttributes: true,
          prompt: '【伊什梅尔·幻日】【出】可公开我方手牌最多 2 张属性不同的升变角色：',
          min: 0,
          max: 2,
          saveToVar: 'revealed',
        },
        {
          op: 'IF',
          condition: { kind: 'VAR_HAS_CARD_MATCHING', varName: 'revealed', filter: { attribute: ElementAttribute.FIRE } },
          then: [
            { op: 'MODIFY_STATS', target: { kind: 'SELF' }, canAttackPlayerOnEnterTurn: true, duration: 'END_OF_TURN' },
          ],
        },
        {
          op: 'IF',
          condition: { kind: 'VAR_HAS_CARD_MATCHING', varName: 'revealed', filter: { attribute: ElementAttribute.LIGHTNING } },
          then: [
            {
              op: 'MODIFY_STATS',
              target: { kind: 'SELF' },
              keywords: ['突进'],
              pp: -1000,
              duration: 'END_OF_NEXT_TURN',
            },
          ],
        },
        {
          op: 'IF',
          condition: { kind: 'VAR_HAS_CARD_MATCHING', varName: 'revealed', filter: { attribute: ElementAttribute.DARK } },
          then: [
            {
              op: 'CHOOSE_MODE',
              prompt: '【伊什梅尔·幻日】暗属性效果：选择 1 位玩家将其牌组顶 5 张牌放置到墓地：',
              modes: [
                { id: 'mill_self', label: '我方牌组顶 5 张放置到墓地', steps: [{ op: 'MILL', count: 5, side: 'SELF' }] },
                { id: 'mill_opp', label: '对方牌组顶 5 张放置到墓地', steps: [{ op: 'MILL', count: 5, side: 'OPPONENT' }] },
              ],
            },
          ],
        },
        {
          op: 'IF',
          condition: { kind: 'VAR_HAS_CARD_MATCHING', varName: 'revealed', filter: { attribute: ElementAttribute.ICE } },
          then: [{ op: 'DRAW', count: 1 }],
        },
        {
          op: 'IF',
          condition: { kind: 'VAR_HAS_CARD_MATCHING', varName: 'revealed', filter: { attribute: ElementAttribute.PHYSICAL } },
          then: [{ op: 'MODIFY_STATS', target: { kind: 'SELF' }, pp: 2000, duration: 'END_OF_NEXT_TURN' }],
        },
      ],
    },
  },

  // BP02-003 观测纪行 (4费 战术)
  {
    cardNumber: 'BP02-003',
    name: '观测纪行',
    playPrecondition: {
      condition: { kind: 'HAS_ROLE', side: 'SELF', filter: { exactName: '伊什梅尔·幻日' } },
      errorMessage: '该牌只能在我方战场存在《伊什梅尔·幻日》时才能使用',
    },
    tactics: [
      {
        op: 'CHOOSE_ZONE_CARDS',
        side: 'SELF',
        zone: 'HAND',
        filter: {
          cardType: CardType.ROLE,
          isAscended: true,
          excludeAttribute: ElementAttribute.VOID,
          maxCostOpenCostLimit: true,
        },
        requireEmptySlot: true,
        prompt: '【观测纪行】请选择我方手牌 1 张费用不大于明费上限的非空属性升变角色效果无效出场：',
        min: 1,
        max: 1,
        saveToVar: 'picked',
      },
      {
        op: 'MOVE_CARDS',
        target: { kind: 'VAR', varName: 'picked' },
        toZone: 'BATTLEFIELD',
        loseAbilities: true,
        triggerEntry: false,
      },
    ],
  },

  // BP02-004 伊什梅尔·幻日 (4费)
  {
    cardNumber: 'BP02-004',
    name: '伊什梅尔·幻日',
    entry: {
      cost: {
        kind: 'DISCARD_HAND',
        count: 1,
        optional: true,
        prompt: '【伊什梅尔·幻日】【出】是否丢弃 1 张手牌：公开牌组顶 5 张并检索任意数量属性各异的升变角色？',
      },
      steps: [
        { op: 'REVEAL_TOP', count: 5, saveToVar: 'revealed' },
        {
          op: 'CHOOSE_FROM_VAR',
          varName: 'revealed',
          filter: { cardType: CardType.ROLE, isAscended: true },
          distinctAttributes: true,
          alwaysShow: true,
          prompt: '【伊什梅尔·幻日】【出】选择任意数量属性各不相同的升变角色加入手牌（其余洗回牌组）：',
          min: 0,
          max: 5,
          saveToVar: 'kept',
        },
        { op: 'MOVE_CARDS', target: { kind: 'VAR', varName: 'kept' }, toZone: 'HAND', isFaceUp: true },
        {
          op: 'MOVE_CARDS',
          target: { kind: 'REST_OF_VAR', allVar: 'revealed', excludeVar: 'kept' },
          toZone: 'DECK_SHUFFLE',
        },
        { op: 'SHUFFLE_DECK', side: 'SELF' },
      ],
    },
  },

  // BP02-005 伊什梅尔·幻日 (3费 【永】：【充能0】)
  {
    cardNumber: 'BP02-005',
    name: '伊什梅尔·幻日',
    entry: {
      cost: {
        kind: 'DISCARD_HAND',
        count: 2,
        optional: true,
        prompt: '【伊什梅尔·幻日】【出】是否丢弃 2 张手牌：选择我方墓地 1 张非空属性升变角色加入手牌？',
      },
      steps: [
        {
          op: 'CHOOSE_ZONE_CARDS',
          side: 'SELF',
          zone: 'GRAVEYARD',
          filter: { cardType: CardType.ROLE, isAscended: true, excludeAttribute: ElementAttribute.VOID },
          prompt: '【伊什梅尔·幻日】【出】请选择我方墓地 1 张不为空属性的升变角色加入手牌：',
          min: 1,
          max: 1,
          saveToVar: 'picked',
        },
        { op: 'MOVE_CARDS', target: { kind: 'VAR', varName: 'picked' }, toZone: 'HAND', isFaceUp: true },
      ],
    },
  },

  // BP02-006 伊什梅尔·幻日 (5费)
  {
    cardNumber: 'BP02-006',
    name: '伊什梅尔·幻日',
    entry: {
      steps: [
        {
          op: 'CHOOSE_ZONE_CARDS',
          side: 'SELF',
          zone: 'HAND',
          filter: {
            anyFilters: [
              { cardType: CardType.ROLE, isAscended: true, attribute: ElementAttribute.FIRE },
              { cardType: CardType.ROLE, isAscended: true, attribute: ElementAttribute.DARK },
            ],
          },
          prompt: '【伊什梅尔·幻日】【出】可公开手牌 1 张火属性或暗属性升变角色，使对方 1 张角色 PP-3000：',
          min: 0,
          max: 1,
          saveToVar: 'revealed',
        },
        {
          op: 'IF',
          condition: { kind: 'VAR_NON_EMPTY', varName: 'revealed' },
          then: [
            {
              op: 'CHOOSE_ROLES',
              side: 'OPPONENT',
              prompt: '【伊什梅尔·幻日】【出】请选择对方战场 1 张角色，直到回合结束 PP-3000：',
              min: 1,
              max: 1,
              saveToVar: 'target',
            },
            { op: 'MODIFY_STATS', target: { kind: 'VAR', varName: 'target' }, pp: -3000, duration: 'END_OF_TURN' },
          ],
        },
      ],
    },
  },

  // BP02-007 伊什梅尔·幻日 (4费 阻挡触发)
  {
    cardNumber: 'BP02-007',
    name: '伊什梅尔·幻日',
    vanillaEntry: true,
    triggers: [
      {
        abilityId: 'dsl:BP02-007:block_reveal_pp',
        eventType: 'BLOCK_DECLARED',
        matcher: { kind: 'SELF_ATTACKING_OR_BLOCKING' },
        label: '【伊什梅尔·幻日】【自】阻挡时可公开雷/冰/物理升变角色，该牌 PP+2000',
        steps: [
          {
            op: 'CHOOSE_ZONE_CARDS',
            side: 'SELF',
            zone: 'HAND',
            filter: {
              anyFilters: [
                { cardType: CardType.ROLE, isAscended: true, attribute: ElementAttribute.LIGHTNING },
                { cardType: CardType.ROLE, isAscended: true, attribute: ElementAttribute.ICE },
                { cardType: CardType.ROLE, isAscended: true, attribute: ElementAttribute.PHYSICAL },
              ],
            },
            prompt: '【伊什梅尔·幻日】【自】可公开手牌 1 张雷/冰/物理属性升变角色，使该牌 PP+2000：',
            min: 0,
            max: 1,
            saveToVar: 'revealed',
          },
          {
            op: 'IF',
            condition: { kind: 'VAR_NON_EMPTY', varName: 'revealed' },
            then: [{ op: 'MODIFY_STATS', target: { kind: 'SELF' }, pp: 2000, duration: 'END_OF_TURN' }],
          },
        ],
      },
    ],
  },

  // BP02-008 伊什梅尔·幻日 (3费 白板)
  { cardNumber: 'BP02-008', name: '伊什梅尔·幻日', vanillaEntry: true },

  // BP02-009 伊什梅尔·幻日 (2费 【永】：战场或费用区无视属性条件使用升变角色)
  // 注：interpreter.ts canPlayerIgnoreAttributeForPlay 中 onlyAscensionRoles 目前以 !isAscension 判断（与「普通使用升变角色无视属性，使用升变机制仍需遵循」语义相反），受限点在汇报中单列说明。
  {
    cardNumber: 'BP02-009',
    name: '伊什梅尔·幻日',
    vanillaEntry: true,
    fieldIgnoreAttributeRule: {
      zones: ['BATTLEFIELD', 'COST'],
      onlyAscensionRoles: true,
    },
  },

  // =========================================================================
  // 2. 丽芙·极昼 & 灰鸦小队补充 (BP02-010 ~ BP02-020)
  // =========================================================================

  // BP02-010 丽芙·极昼 (6费 升变)
  {
    cardNumber: 'BP02-010',
    name: '丽芙·极昼',
    vanillaEntry: true,
    staticEffects: [
      {
        id: 'dsl:BP02-010:must_be_attack_target',
        scope: 'SELF',
        condition: { kind: 'TURN_OWNER', isSelfTurn: false },
        mustBeAttackTarget: true,
      },
    ],
    triggers: [
      createLivSentToGyTrigger(
        'dsl:BP02-010:liv_sent_gy',
        '【丽芙·极昼】【自】【回合1】我方<丽芙>因效果/代价从战场送墓时可消 2 球出场手牌 4 费《丽芙·极昼》',
        [
          {
            op: 'ELIMINATE_ORB_COST',
            filter: 'ANY',
            count: 2,
            optional: true,
            prompt: '【丽芙·极昼】【自】是否消除【2任意信号球】将手牌 1 张费用为 4 的《丽芙·极昼》出场？',
            onPaid: [
              { op: 'MARK_TURN_ABILITY_USED', abilityKey: '__TRIGGER_ONCE_KEY__' },
              {
                op: 'CHOOSE_ZONE_CARDS',
                side: 'SELF',
                zone: 'HAND',
                filter: { cardType: CardType.ROLE, exactName: '丽芙·极昼', exactCost: 4 },
                requireEmptySlot: true,
                prompt: '【丽芙·极昼】请选择我方手牌 1 张费用为 4 的《丽芙·极昼》出场：',
                min: 1,
                max: 1,
                saveToVar: 'picked',
              },
              { op: 'MOVE_CARDS', target: { kind: 'VAR', varName: 'picked' }, toZone: 'BATTLEFIELD', triggerEntry: true },
            ],
          },
        ],
        { deferOncePerTurnUntilCostPaid: true }
      ),
    ],
  },

  // BP02-011 丽芙·极昼 (3费 【永】：【充能0】)
  {
    cardNumber: 'BP02-011',
    name: '丽芙·极昼',
    vanillaEntry: true,
    activate: {
      cost: {
        kind: 'ELIMINATE_ORBS',
        filter: 'ANY',
        count: 1,
        prompt: '【丽芙·极昼】【起】消除【任意信号球】1 张，将竖直状态的该牌送墓并出场 4 费《丽芙·极昼》',
      },
      steps: [
        // Q&A·7：横置时无法把自身送墓，后续不执行
        {
          op: 'IF',
          condition: { kind: 'SELF_MATCHES_FILTER', filter: { isReady: true, inZone: 'BATTLEFIELD' } },
          then: [
            {
              op: 'MOVE_CARDS',
              target: { kind: 'SELF' },
              toZone: 'GRAVEYARD',
              sentByEffectOrCost: true,
              saveMovedToVar: 'sacrificed',
            },
            {
              op: 'IF',
              condition: { kind: 'VAR_NON_EMPTY', varName: 'sacrificed' },
              then: [
                {
                  op: 'CHOOSE_ZONE_CARDS',
                  side: 'SELF',
                  zone: 'HAND',
                  zones: ['HAND', 'GRAVEYARD'],
                  filter: { cardType: CardType.ROLE, exactName: '丽芙·极昼', exactCost: 4 },
                  requireEmptySlot: true,
                  prompt: '【丽芙·极昼】【起】请选择手牌或墓地 1 张费用为 4 的《丽芙·极昼》出场：',
                  min: 1,
                  max: 1,
                  saveToVar: 'picked',
                },
                { op: 'MOVE_CARDS', target: { kind: 'VAR', varName: 'picked' }, toZone: 'BATTLEFIELD', triggerEntry: true },
              ],
            },
          ],
        },
      ],
    },
  },

  // BP02-012 丽芙·极昼 (7费)
  {
    cardNumber: 'BP02-012',
    name: '丽芙·极昼',
    playSacrificeDiscount: {
      zones: ['BATTLEFIELD'],
      filter: { cardType: CardType.ROLE, exactName: '丽芙·极昼' },
      setCost: 4,
      prompt: '【丽芙·极昼】使用该牌时，可选择将我方战场 1 张《丽芙·极昼》放置到墓地，使该牌费用变为 4：',
    },
    entry: {
      cost: {
        kind: 'DISCARD_HAND',
        count: 1,
        optional: true,
        prompt: '【丽芙·极昼】【出】是否丢弃 1 张手牌：直到回合结束为止，该牌可以攻击对方玩家？',
      },
      steps: [
        { op: 'MODIFY_STATS', target: { kind: 'SELF' }, canAttackPlayerOnEnterTurn: true, duration: 'END_OF_TURN' },
      ],
    },
  },

  // BP02-013 丽芙·极昼 (4费；战斗破坏代替已内置于 replacement-engine.ts builtin:BP02-013_BATTLE_SAVE)
  {
    cardNumber: 'BP02-013',
    name: '丽芙·极昼',
    vanillaEntry: true,
    handCostDiscount: LIV_LESS_ROLES_HAND_DISCOUNT,
  },

  // BP02-014 丽芙·极昼 (4费)
  {
    cardNumber: 'BP02-014',
    name: '丽芙·极昼',
    vanillaEntry: true,
    handCostDiscount: LIV_LESS_ROLES_HAND_DISCOUNT,
    activate: {
      cost: { kind: 'SELF_TO_GRAVEYARD', sentByEffectOrCost: true },
      steps: [
        {
          op: 'CHOOSE_ROLES',
          side: 'SELF',
          filter: { exactName: '丽芙·极昼' },
          prompt: '【丽芙·极昼】【起】请选择我方战场 1 张《丽芙·极昼》，该回合结束时将其竖直：',
          min: 1,
          max: 1,
          saveToVar: 'picked',
        },
        {
          op: 'REGISTER_DELAYED_TRIGGER',
          target: { kind: 'VAR', varName: 'picked' },
          eventType: 'END_PHASE_TRIGGERS',
          abilityId: 'DELAYED_END_OF_TURN_UNTAP',
        },
      ],
    },
  },

  // BP02-015 丽芙·极昼 (4费)
  {
    cardNumber: 'BP02-015',
    name: '丽芙·极昼',
    vanillaEntry: true,
    triggers: [
      createLivSentToGyTrigger(
        'dsl:BP02-015:liv_sent_gy',
        '【丽芙·极昼】【自】【回合1】我方<丽芙>因效果/代价从战场送墓时抽 2 弃 1',
        [
          { op: 'DRAW', count: 2 },
          {
            op: 'CHOOSE_ZONE_CARDS',
            side: 'SELF',
            zone: 'HAND',
            prompt: '【丽芙·极昼】【自】请选择 1 张手牌丢弃：',
            min: 1,
            max: 1,
            saveToVar: 'discarded',
          },
          { op: 'MOVE_CARDS', target: { kind: 'VAR', varName: 'discarded' }, toZone: 'GRAVEYARD', isFaceUp: true },
        ]
      ),
    ],
  },

  // BP02-016 丽芙·极昼 (4费)
  {
    cardNumber: 'BP02-016',
    name: '丽芙·极昼',
    vanillaEntry: true,
    triggers: [
      createLivSentToGyTrigger(
        'dsl:BP02-016:liv_sent_gy',
        '【丽芙·极昼】【自】【回合1】我方<丽芙>因效果/代价从战场送墓时选火属性角色 PP+2000',
        [
          {
            op: 'CHOOSE_ROLES',
            side: 'SELF',
            filter: { attribute: ElementAttribute.FIRE },
            prompt: '【丽芙·极昼】【自】请选择我方战场 1 张火属性角色，直到回合结束 PP+2000：',
            min: 1,
            max: 1,
            saveToVar: 'target',
          },
          { op: 'MODIFY_STATS', target: { kind: 'VAR', varName: 'target' }, pp: 2000, duration: 'END_OF_TURN' },
        ]
      ),
    ],
  },

  // BP02-017 丽芙·极昼 (3费)
  {
    cardNumber: 'BP02-017',
    name: '丽芙·极昼',
    entry: {
      steps: [
        {
          op: 'PAY_COST_STEP',
          amount: 1,
          optional: true,
          prompt: '【丽芙·极昼】【出】是否支付【1费】：若从手牌出场则获得【突进】与 PP+3000，回合结束时送墓？',
          onPaid: [
            {
              op: 'IF',
              condition: { kind: 'CARD_ENTERED_FROM_ZONE', zones: ['HAND'] },
              then: [
                {
                  op: 'MODIFY_STATS',
                  target: { kind: 'SELF' },
                  keywords: ['突进'],
                  pp: 3000,
                  duration: 'END_OF_TURN',
                },
              ],
            },
            {
              op: 'REGISTER_DELAYED_TRIGGER',
              target: { kind: 'SELF' },
              eventType: 'END_PHASE_TRIGGERS',
              abilityId: 'DELAYED_END_OF_TURN_TO_GRAVEYARD',
              labelSuffix: '该回合结束时从战场放置到墓地',
              markLegacyEndOfTurnToGraveyard: true,
            },
          ],
        },
      ],
    },
  },

  // BP02-018 里·异火 (4费)
  {
    cardNumber: 'BP02-018',
    name: '里·异火',
    entry: {
      steps: [
        {
          op: 'MODIFY_STATS',
          target: { kind: 'ALL_MATCHING_ROLES', side: 'SELF' },
          pp: 1000,
          duration: 'END_OF_TURN',
        },
      ],
    },
  },

  // BP02-019 露西亚·鸦羽 (4费)
  {
    cardNumber: 'BP02-019',
    name: '露西亚·鸦羽',
    vanillaEntry: true,
    triggers: [
      {
        abilityId: 'dsl:BP02-019:attack_discard_draw',
        eventType: 'ATTACK_DECLARED',
        matcher: { kind: 'SELF_ATTACKING' },
        label: '【露西亚·鸦羽】【自】攻击时可丢弃最多 2 张<灰鸦小队>，每弃 1 张抽 1 张牌',
        steps: [
          {
            op: 'DISCARD_COST_STEP',
            minCount: 1,
            count: 2,
            filter: { trait: '灰鸦小队' },
            optional: true,
            prompt: '【露西亚·鸦羽】【自】可丢弃手牌最多 2 张<灰鸦小队>（每丢弃 1 张抽 1 张牌）：',
            savePaidToVar: 'discarded',
            onPaid: [
              {
                op: 'IF',
                condition: { kind: 'VAR_COUNT_COMPARE', varName: 'discarded', op: '==', value: 2 },
                then: [{ op: 'DRAW', count: 2 }],
                else: [{ op: 'DRAW', count: 1 }],
              },
            ],
          },
        ],
      },
    ],
  },

  // BP02-020 永夜曙光 (2费 战术)
  {
    cardNumber: 'BP02-020',
    name: '永夜曙光',
    tactics: [
      {
        op: 'CHOOSE_ROLES',
        side: 'SELF',
        filter: { exactName: '丽芙·极昼' },
        prompt: '【永夜曙光】可将我方战场 1 张《丽芙·极昼》放置到墓地以破坏对方 PP<=5000 角色（不选则跳过）：',
        min: 0,
        max: 1,
        saveToVar: 'sac',
      },
      {
        op: 'IF',
        condition: { kind: 'VAR_NON_EMPTY', varName: 'sac' },
        then: [
          {
            op: 'MOVE_CARDS',
            target: { kind: 'VAR', varName: 'sac' },
            toZone: 'GRAVEYARD',
            sentByEffectOrCost: true,
            saveMovedToVar: 'moved',
          },
          {
            op: 'IF',
            condition: { kind: 'VAR_NON_EMPTY', varName: 'moved' },
            then: [
              {
                op: 'CHOOSE_ROLES',
                side: 'OPPONENT',
                filter: { maxEffectivePP: 5000 },
                prompt: '【永夜曙光】请选择对方战场 1 张 PP 为 5000 及以下的角色将其破坏：',
                min: 1,
                max: 1,
                saveToVar: 'victim',
              },
              { op: 'DESTROY_ROLES', target: { kind: 'VAR', varName: 'victim' } },
            ],
          },
        ],
      },
    ],
  },

  // =========================================================================
  // 3. 比安卡·晖暮体系 (BP02-021 ~ BP02-025，含 BP02-022【冠军】)
  // =========================================================================

  // BP02-021 比安卡·晖暮 (8费)
  {
    cardNumber: 'BP02-021',
    name: '比安卡·晖暮',
    entry: {
      cost: {
        kind: 'DISCARD_HAND',
        count: 2,
        filter: { attribute: ElementAttribute.DARK },
        optional: true,
        prompt: '【比安卡·晖暮】【出】是否丢弃 2 张暗属性手牌：使对方战场 1 张角色 PP-5000？',
      },
      steps: [
        {
          op: 'CHOOSE_ROLES',
          side: 'OPPONENT',
          prompt: '【比安卡·晖暮】【出】请选择对方战场 1 张角色，直到回合结束 PP-5000：',
          min: 1,
          max: 1,
          saveToVar: 'target',
        },
        { op: 'MODIFY_STATS', target: { kind: 'VAR', varName: 'target' }, pp: -5000, duration: 'END_OF_TURN' },
      ],
    },
    activate: {
      oncePerTurn: true,
      condition: { kind: 'SIGNAL_ORB_BOTTOM_COST_PARITY', parity: 'ODD' },
      conditionError: '需要处于晖形态（信号球区最下方卡牌费用为奇数）才能发动',
      cost: {
        kind: 'ELIMINATE_ORBS',
        filter: 'SAME',
        count: 2,
        prompt: '【比安卡·晖暮】晖【起】【回合1】消除 2 同色信号球，将该牌竖直',
      },
      steps: [{ op: 'SET_READY', target: { kind: 'SELF' }, isReady: true }],
    },
    staticEffects: [
      {
        id: 'dsl:BP02-021:dusk_assault',
        scope: 'SELF',
        condition: { kind: 'SIGNAL_ORB_BOTTOM_COST_PARITY', parity: 'EVEN' },
        keywords: ['突进'],
      },
    ],
  },

  // BP02-022 & BP02-022【冠军】 比安卡·晖暮 (7费)
  createBianca022Spec('BP02-022'),
  createBianca022Spec('BP02-022【冠军】'),

  // BP02-023 比安卡·晖暮 (3费)
  {
    cardNumber: 'BP02-023',
    name: '比安卡·晖暮',
    vanillaEntry: true,
    triggers: [
      {
        abilityId: 'dsl:BP02-023:attack_orb_bottom',
        eventType: 'ATTACK_DECLARED',
        matcher: { kind: 'SELF_ATTACKING' },
        label: '【比安卡·晖暮】【自】攻击时可将手牌 1 张《比安卡·晖暮》放到信号球区最下方，该牌 PP+2000',
        steps: [
          {
            op: 'CHOOSE_ZONE_CARDS',
            side: 'SELF',
            zone: 'HAND',
            filter: { exactName: '比安卡·晖暮' },
            prompt: '【比安卡·晖暮】【自】可选择我方手牌 1 张《比安卡·晖暮》放置到信号球区最下方（不选则跳过）：',
            min: 0,
            max: 1,
            saveToVar: 'picked',
          },
          {
            op: 'IF',
            condition: { kind: 'VAR_NON_EMPTY', varName: 'picked' },
            then: [
              {
                op: 'MOVE_CARDS',
                target: { kind: 'VAR', varName: 'picked' },
                toZone: 'SIGNAL_ORB_BOTTOM',
                isFaceUp: true,
                saveMovedToVar: 'placed',
              },
              {
                op: 'IF',
                condition: { kind: 'VAR_NON_EMPTY', varName: 'placed' },
                then: [
                  { op: 'MODIFY_STATS', target: { kind: 'SELF' }, pp: 2000, duration: 'END_OF_TURN' },
                  {
                    op: 'REGISTER_DELAYED_TRIGGER',
                    target: { kind: 'VAR', varName: 'placed' },
                    eventType: 'END_PHASE_TRIGGERS',
                    abilityId: 'DELAYED_END_OF_TURN_TO_GRAVEYARD',
                    expectedZone: 'SIGNAL_ORB',
                    labelSuffix: '该回合结束时从信号球区放置到墓地',
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  },

  // BP02-024 比安卡·晖暮 (4费)
  {
    cardNumber: 'BP02-024',
    name: '比安卡·晖暮',
    vanillaEntry: true,
    staticEffects: [
      {
        id: 'dsl:BP02-024:orb_zone_cost_plus_1',
        scope: 'SELF',
        sourceZones: ['SIGNAL_ORB'],
        selfFilter: { isFaceUp: true },
        costDelta: 1,
      },
    ],
    activate: {
      oncePerTurn: true,
      condition: { kind: 'SIGNAL_ORB_BOTTOM_COST_PARITY', parity: 'ODD' },
      conditionError: '需要处于晖形态（信号球区最下方卡牌费用为奇数）才能发动',
      steps: [
        {
          op: 'REORDER_ZONE',
          zone: 'SIGNAL_ORB',
          prompt: '【比安卡·晖暮】晖【起】按从下到上的顺序依次点选信号球区的全部 {orbCount} 张牌以重新排列',
        },
      ],
    },
  },

  // BP02-025 浊璃 (3费 辅助机)
  // 受限点：晖【起】文本为「选择我方信号球区最下方的牌，将其加入手牌」，当前 CHOOSE_ZONE_CARDS 尚无仅限信号球区第 0 位的筛选器，多张信号球时将弹出信号球区供点选。
  {
    cardNumber: 'BP02-025',
    name: '浊璃',
    vanillaEntry: true,
    activates: [
      {
        id: 'radiance_bottom_orb_to_hand',
        label: '晖【起】【回合1】横置该牌：选择我方信号球区最下方的牌加入手牌',
        oncePerTurn: true,
        condition: { kind: 'SIGNAL_ORB_BOTTOM_COST_PARITY', parity: 'ODD' },
        conditionError: '需要处于晖形态（信号球区最下方卡牌费用为奇数）才能发动',
        cost: { kind: 'TAP_SELF' },
        steps: [
          {
            op: 'CHOOSE_ZONE_CARDS',
            side: 'SELF',
            zone: 'SIGNAL_ORB',
            prompt: '【浊璃】晖【起】：请选择我方信号球区最下方的牌加入手牌：',
            min: 1,
            max: 1,
            saveToVar: 'bottomOrb',
          },
          { op: 'MOVE_CARDS', target: { kind: 'VAR', varName: 'bottomOrb' }, toZone: 'HAND', isFaceUp: true },
        ],
      },
      {
        id: 'dusk_place_bianca_orb_bottom',
        label: '暮【起】【回合1】横置该牌：可将手牌 1 张《比安卡·晖暮》放到信号球区最下方并抽 1 牌',
        oncePerTurn: true,
        condition: { kind: 'SIGNAL_ORB_BOTTOM_COST_PARITY', parity: 'EVEN' },
        conditionError: '需要处于暮形态（信号球区最下方卡牌费用为偶数）才能发动',
        cost: { kind: 'TAP_SELF' },
        steps: [
          {
            op: 'CHOOSE_ZONE_CARDS',
            side: 'SELF',
            zone: 'HAND',
            filter: { exactName: '比安卡·晖暮' },
            prompt: '【浊璃】暮【起】：可选择我方手牌 1 张《比安卡·晖暮》放置到信号球区最下方并抽 1 张牌：',
            min: 0,
            max: 1,
            saveToVar: 'picked',
          },
          {
            op: 'IF',
            condition: { kind: 'VAR_NON_EMPTY', varName: 'picked' },
            then: [
              {
                op: 'MOVE_CARDS',
                target: { kind: 'VAR', varName: 'picked' },
                toZone: 'SIGNAL_ORB_BOTTOM',
                isFaceUp: true,
                saveMovedToVar: 'placed',
              },
              {
                op: 'IF',
                condition: { kind: 'VAR_NON_EMPTY', varName: 'placed' },
                then: [
                  { op: 'DRAW', count: 1 },
                  {
                    op: 'REGISTER_DELAYED_TRIGGER',
                    target: { kind: 'VAR', varName: 'placed' },
                    eventType: 'END_PHASE_TRIGGERS',
                    abilityId: 'DELAYED_END_OF_TURN_TO_GRAVEYARD',
                    expectedZone: 'SIGNAL_ORB',
                    labelSuffix: '该回合结束时从信号球区放置到墓地',
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  },

  // =========================================================================
  // 4. 拉弥亚·深谣体系 (BP02-026 ~ BP02-036)
  // =========================================================================

  // BP02-026 拉弥亚·深谣 沉渊终局 (10费；墓地升变已由 ascension-parser 与 engine.ts 处理)
  {
    cardNumber: 'BP02-026',
    name: '拉弥亚·深谣 沉渊终局',
    entry: {
      steps: [
        {
          op: 'CHOOSE_ZONE_CARDS',
          side: 'SELF',
          zone: 'GRAVEYARD',
          filter: { cardType: CardType.ROLE, exactName: '拉弥亚·深谣', maxCost: 4 },
          requireEmptySlot: true,
          prompt: '【拉弥亚·深谣 沉渊终局】【出】选择我方墓地最多 1 张费用为 4 及以下的《拉弥亚·深谣》出场：',
          min: 0,
          max: 1,
          saveToVar: 'revived',
        },
        { op: 'MOVE_CARDS', target: { kind: 'VAR', varName: 'revived' }, toZone: 'BATTLEFIELD', triggerEntry: true },
      ],
    },
    triggers: [
      {
        abilityId: 'dsl:BP02-026:attack_recycle_mill',
        eventType: 'ATTACK_DECLARED',
        matcher: { kind: 'SELF_ATTACKING' },
        label: '【拉弥亚·深谣 沉渊终局】【自】攻击时可将信号球区 1 张《潮涌球》送墓，回收最多 5 张不同卡号<拉弥亚>并双方堆 5',
        steps: [
          {
            op: 'CHOOSE_ZONE_CARDS',
            side: 'SELF',
            zone: 'SIGNAL_ORB',
            filter: { exactName: '潮涌球', isFaceUp: true },
            prompt: '【拉弥亚·深谣 沉渊终局】【自】可选择我方信号球区 1 张《潮涌球》放置到墓地（不选则跳过）：',
            min: 0,
            max: 1,
            saveToVar: 'surgeOrb',
          },
          {
            op: 'IF',
            condition: { kind: 'VAR_NON_EMPTY', varName: 'surgeOrb' },
            then: [
              {
                op: 'MOVE_CARDS',
                target: { kind: 'VAR', varName: 'surgeOrb' },
                toZone: 'GRAVEYARD',
                isFaceUp: true,
                saveMovedToVar: 'movedOrb',
              },
              {
                op: 'IF',
                condition: { kind: 'VAR_NON_EMPTY', varName: 'movedOrb' },
                then: [
                  {
                    op: 'CHOOSE_ZONE_CARDS',
                    side: 'SELF',
                    zone: 'GRAVEYARD',
                    filter: { cardType: CardType.ROLE, trait: '拉弥亚' },
                    uniqueCardNumbers: true,
                    prompt: '【拉弥亚·深谣 沉渊终局】【自】请选择我方墓地最多 5 张各不相同的<拉弥亚>角色加入牌组并洗切：',
                    min: 0,
                    max: 5,
                    saveToVar: 'recycled',
                  },
                  {
                    op: 'MOVE_CARDS',
                    target: { kind: 'VAR', varName: 'recycled' },
                    toZone: 'DECK_SHUFFLE',
                  },
                  // Q&A·4：选 0 张也要洗切，随后双方牌组顶 5 张放置到墓地
                  { op: 'SHUFFLE_DECK', side: 'SELF' },
                  { op: 'MILL', count: 5, side: 'SELF' },
                  { op: 'MILL', count: 5, side: 'OPPONENT' },
                ],
              },
            ],
          },
        ],
      },
    ],
  },

  // BP02-027 拉弥亚·深谣 狂涛肇始 (8费 升变)
  {
    cardNumber: 'BP02-027',
    name: '拉弥亚·深谣 狂涛肇始',
    entry: {
      cost: {
        kind: 'ELIMINATE_ORBS',
        filter: 'ANY',
        count: 2,
        optional: true,
        prompt: '【拉弥亚·深谣 狂涛肇始】【出】是否消除【2任意信号球】：使对方战场 1 张角色 PP-5000？',
      },
      steps: [
        {
          op: 'CHOOSE_ROLES',
          side: 'OPPONENT',
          prompt: '【拉弥亚·深谣 狂涛肇始】【出】请选择对方战场 1 张角色，直到回合结束 PP-5000：',
          min: 1,
          max: 1,
          saveToVar: 'target',
        },
        { op: 'MODIFY_STATS', target: { kind: 'VAR', varName: 'target' }, pp: -5000, duration: 'END_OF_TURN' },
      ],
    },
    triggers: [
      {
        abilityId: 'dsl:BP02-027:left_field_revive',
        eventType: 'CARD_LEFT_FIELD',
        matcher: { kind: 'SELF_LEFT_FIELD' },
        label: '【拉弥亚·深谣 狂涛肇始】【自】离场时可弃 2 张手牌，墓地出场 1 张费用<=3 的《拉弥亚·深谣》',
        steps: [
          {
            op: 'DISCARD_COST_STEP',
            count: 2,
            optional: true,
            prompt: '【拉弥亚·深谣 狂涛肇始】【自】离场时是否丢弃 2 张手牌，从墓地出场 1 张费用<=3 的《拉弥亚·深谣》？',
            onPaid: [
              {
                op: 'CHOOSE_ZONE_CARDS',
                side: 'SELF',
                zone: 'GRAVEYARD',
                filter: { cardType: CardType.ROLE, exactName: '拉弥亚·深谣', maxCost: 3 },
                requireEmptySlot: true,
                prompt: '【拉弥亚·深谣 狂涛肇始】请选择我方墓地 1 张费用为 3 及以下的《拉弥亚·深谣》出场：',
                min: 1,
                max: 1,
                saveToVar: 'revived',
              },
              { op: 'MOVE_CARDS', target: { kind: 'VAR', varName: 'revived' }, toZone: 'BATTLEFIELD', triggerEntry: true },
            ],
          },
        ],
      },
    ],
  },

  // BP02-028 拉弥亚·深谣  强压层流 (6费 升变；官方数据卡名含两个空格)
  {
    cardNumber: 'BP02-028',
    name: '拉弥亚·深谣  强压层流',
    entry: {
      steps: [
        { op: 'REVEAL_TOP', count: 4, saveToVar: 'revealed' },
        {
          op: 'CHOOSE_FROM_VAR',
          varName: 'revealed',
          filter: { cardType: CardType.ROLE, trait: '拉弥亚', inZone: 'PROCESSING' },
          alwaysShow: true,
          prompt: '【拉弥亚·深谣 强压层流】【出】选择其中最多 1 张<拉弥亚>角色加入手牌：',
          min: 0,
          max: 1,
          saveToVar: 'toHand',
        },
        { op: 'MOVE_CARDS', target: { kind: 'VAR', varName: 'toHand' }, toZone: 'HAND', isFaceUp: true },
        {
          op: 'CHOOSE_FROM_VAR',
          varName: 'revealed',
          filter: { attribute: ElementAttribute.DARK, inZone: 'PROCESSING' },
          alwaysShow: true,
          prompt: '【拉弥亚·深谣 强压层流】【出】选择剩余公开牌中最多 1 张暗属性卡牌放置到墓地（其余放牌组底）：',
          min: 0,
          max: 1,
          saveToVar: 'toGy',
        },
        { op: 'MOVE_CARDS', target: { kind: 'VAR', varName: 'toGy' }, toZone: 'GRAVEYARD', isFaceUp: true },
        // MOVE_CARDS 对 REST_OF_VAR 只移动仍在 PROCESSING 的剩余牌，因此可安全跳过已去手牌的牌
        {
          op: 'MOVE_CARDS',
          target: { kind: 'REST_OF_VAR', allVar: 'revealed', excludeVar: 'toGy' },
          toZone: 'DECK_BOTTOM',
        },
      ],
    },
  },

  // BP02-029 拉弥亚·深谣 (3费 【永】：【充能0】)
  {
    cardNumber: 'BP02-029',
    name: '拉弥亚·深谣',
    entry: {
      cost: {
        kind: 'DISCARD_HAND',
        count: 1,
        optional: true,
        prompt: '【拉弥亚·深谣】【出】是否丢弃 1 张手牌：公开牌组顶 2 张检索<拉弥亚>角色或《最终棋盘》？',
      },
      steps: [
        { op: 'REVEAL_TOP', count: 2, saveToVar: 'revealed' },
        {
          op: 'CHOOSE_FROM_VAR',
          varName: 'revealed',
          filter: { anyFilters: [{ cardType: CardType.ROLE, trait: '拉弥亚' }, { exactName: '最终棋盘' }] },
          alwaysShow: true,
          prompt: '【拉弥亚·深谣】【出】选择其中最多 1 张<拉弥亚>角色或《最终棋盘》加入手牌（其余放置到墓地）：',
          min: 0,
          max: 1,
          saveToVar: 'kept',
        },
        { op: 'MOVE_CARDS', target: { kind: 'VAR', varName: 'kept' }, toZone: 'HAND', isFaceUp: true },
        {
          op: 'MOVE_CARDS',
          target: { kind: 'REST_OF_VAR', allVar: 'revealed', excludeVar: 'kept' },
          toZone: 'GRAVEYARD',
          isFaceUp: true,
        },
      ],
    },
  },

  // BP02-030 拉弥亚·深谣 (2费)
  {
    cardNumber: 'BP02-030',
    name: '拉弥亚·深谣',
    vanillaEntry: true,
    triggers: [
      {
        abilityId: 'dsl:BP02-030:deck_to_gy_revive',
        eventType: 'CARD_MOVED_DECK_TO_GY',
        matcher: { kind: 'SELF_MOVED_DECK_TO_GY' },
        label: '【拉弥亚·深谣】【自】从牌组放置到墓地时可弃 2 手牌从墓地出场',
        steps: [
          {
            op: 'IF',
            condition: {
              kind: 'ALL',
              conditions: [
                { kind: 'SELF_MATCHES_FILTER', filter: { inZone: 'GRAVEYARD' } },
                { kind: 'HAS_EMPTY_SLOT', side: 'SELF' },
              ],
            },
            then: [
              {
                op: 'DISCARD_COST_STEP',
                count: 2,
                optional: true,
                prompt: '【拉弥亚·深谣】【自】是否丢弃 2 张手牌，将该牌从墓地出场？',
                onPaid: [
                  {
                    op: 'IF',
                    condition: { kind: 'SELF_MATCHES_FILTER', filter: { inZone: 'GRAVEYARD' } },
                    then: [
                      {
                        op: 'IF',
                        condition: { kind: 'HAS_ROLE', side: 'OPPONENT', minCount: 4 },
                        then: [
                          {
                            op: 'MOVE_CARDS',
                            target: { kind: 'SELF' },
                            toZone: 'BATTLEFIELD',
                            enterTapped: false,
                            triggerEntry: true,
                          },
                        ],
                        else: [
                          {
                            op: 'MOVE_CARDS',
                            target: { kind: 'SELF' },
                            toZone: 'BATTLEFIELD',
                            enterTapped: true,
                            triggerEntry: true,
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  },

  // BP02-031 拉弥亚·深谣 (5费)
  {
    cardNumber: 'BP02-031',
    name: '拉弥亚·深谣',
    entry: {
      steps: [
        {
          op: 'CHOOSE_ZONE_CARDS',
          side: 'SELF',
          zone: 'COST',
          zones: ['COST', 'GRAVEYARD'],
          filter: {
            anyFilters: [
              { inZone: 'COST', isFaceUp: true, exactName: '潮涌球' },
              { inZone: 'GRAVEYARD', exactName: '潮涌球' },
            ],
          },
          prompt: '【拉弥亚·深谣】【出】选择我方费用区（明费）或墓地最多 1 张《潮涌球》，放置到信号球区最下方：',
          min: 0,
          max: 1,
          saveToVar: 'surgeOrb',
        },
        { op: 'MOVE_CARDS', target: { kind: 'VAR', varName: 'surgeOrb' }, toZone: 'SIGNAL_ORB_BOTTOM', isFaceUp: true },
      ],
    },
    triggers: [
      {
        abilityId: 'dsl:BP02-031:deck_to_gy_buff',
        eventType: 'CARD_MOVED_DECK_TO_GY',
        matcher: { kind: 'SELF_MOVED_DECK_TO_GY' },
        label: '【拉弥亚·深谣】【自】从牌组放置到墓地时选<拉弥亚>角色直到下个回合结束 PP+1000',
        steps: [
          {
            op: 'CHOOSE_ROLES',
            side: 'SELF',
            filter: { trait: '拉弥亚' },
            prompt: '【拉弥亚·深谣】【自】选择我方战场最多 1 张<拉弥亚>角色，直到下个回合结束 PP+1000：',
            min: 0,
            max: 1,
            saveToVar: 'target',
          },
          { op: 'MODIFY_STATS', target: { kind: 'VAR', varName: 'target' }, pp: 1000, duration: 'END_OF_NEXT_TURN' },
        ],
      },
    ],
  },

  // BP02-032 拉弥亚·深谣 (4费)
  {
    cardNumber: 'BP02-032',
    name: '拉弥亚·深谣',
    staticEffects: [
      {
        id: 'dsl:BP02-032:gy_lamia_10_pp',
        scope: 'SELF',
        condition: {
          kind: 'ZONE_COUNT',
          side: 'SELF',
          zone: 'GRAVEYARD',
          filter: { cardType: CardType.ROLE, trait: '拉弥亚' },
          op: '>=',
          value: 10,
        },
        pp: 1500,
        dependsOnTraits: true,
      },
    ],
    entry: {
      steps: [{ op: 'MILL', count: 3, side: 'SELF' }],
    },
  },

  // BP02-033 拉弥亚·深谣 (3费)
  {
    cardNumber: 'BP02-033',
    name: '拉弥亚·深谣',
    vanillaEntry: true,
    triggers: [
      {
        abilityId: 'dsl:BP02-033:deck_to_gy_dp',
        eventType: 'CARD_MOVED_DECK_TO_GY',
        matcher: { kind: 'SELF_MOVED_DECK_TO_GY' },
        label: '【拉弥亚·深谣】【自】从牌组放置到墓地时可消红球使<拉弥亚>DP+1',
        cost: {
          kind: 'ELIMINATE_ORBS',
          filter: 'RED',
          count: 1,
          optional: true,
          prompt: '【拉弥亚·深谣】【自】是否消除《红色信号球》，使我方战场最多 1 张<拉弥亚>角色 DP+1？',
        },
        steps: [
          {
            op: 'CHOOSE_ROLES',
            side: 'SELF',
            filter: { trait: '拉弥亚' },
            prompt: '【拉弥亚·深谣】【自】选择我方战场最多 1 张<拉弥亚>角色，直到回合结束 DP+1：',
            min: 0,
            max: 1,
            saveToVar: 'target',
          },
          { op: 'MODIFY_STATS', target: { kind: 'VAR', varName: 'target' }, dp: 1, duration: 'END_OF_TURN' },
        ],
      },
    ],
  },

  // BP02-034 最终棋盘 (5费 战术)
  {
    cardNumber: 'BP02-034',
    name: '最终棋盘',
    tactics: [
      {
        op: 'CHOOSE_ZONE_CARDS',
        side: 'SELF',
        zone: 'GRAVEYARD',
        filter: { cardType: CardType.ROLE, trait: '拉弥亚', maxCost: 6 },
        requireEmptySlot: true,
        prompt: '【最终棋盘】请选择我方墓地 1 张费用为 6 及以下的<拉弥亚>角色出场：',
        min: 1,
        max: 1,
        saveToVar: 'revived',
      },
      { op: 'MOVE_CARDS', target: { kind: 'VAR', varName: 'revived' }, toZone: 'BATTLEFIELD', triggerEntry: true },
    ],
  },

  // BP02-035 暗潮波动 (4费 战术)
  {
    cardNumber: 'BP02-035',
    name: '暗潮波动',
    playPrecondition: {
      condition: { kind: 'HAS_ROLE', side: 'SELF', filter: { trait: '拉弥亚' } },
      errorMessage: '该牌只能在我方战场存在<拉弥亚>角色时才能使用',
    },
    tactics: [
      {
        op: 'CHOOSE_ROLES',
        side: 'OPPONENT',
        prompt: '【暗潮波动】请选择对方战场 1 张角色，根据我方墓地<拉弥亚>角色数量降低其 PP：',
        min: 1,
        max: 1,
        saveToVar: 'target',
      },
      {
        op: 'MODIFY_STATS',
        target: { kind: 'VAR', varName: 'target' },
        pp: {
          kind: 'ZONE_COUNT_MULT',
          side: 'SELF',
          zone: 'GRAVEYARD',
          filter: { cardType: CardType.ROLE, trait: '拉弥亚' },
          multiplier: -1000,
        },
        duration: 'END_OF_TURN',
      },
    ],
  },

  // BP02-036 潮涌球 (2费 瞬时战术，可墓地及主要阶段使用)
  {
    cardNumber: 'BP02-036',
    name: '潮涌球',
    playFromZones: ['HAND', 'GRAVEYARD'],
    allowInstantInMainPhase: true,
    tactics: [
      { op: 'REVEAL_TOP', count: 3, saveToVar: 'revealed' },
      {
        op: 'CHOOSE_FROM_VAR',
        varName: 'revealed',
        filter: { cardType: CardType.ROLE, trait: '拉弥亚' },
        alwaysShow: true,
        prompt: '【潮涌球】选择其中最多 1 张<拉弥亚>角色加入手牌（剩余放置到墓地）：',
        min: 0,
        max: 1,
        saveToVar: 'kept',
      },
      { op: 'MOVE_CARDS', target: { kind: 'VAR', varName: 'kept' }, toZone: 'HAND', isFaceUp: true },
      {
        op: 'MOVE_CARDS',
        target: { kind: 'REST_OF_VAR', allVar: 'revealed', excludeVar: 'kept' },
        toZone: 'GRAVEYARD',
        isFaceUp: true,
      },
      { op: 'MOVE_CARDS', target: { kind: 'SELF' }, toZone: 'SIGNAL_ORB_BOTTOM', isFaceUp: true },
    ],
  },

  // =========================================================================
  // 5. 含英·檀心 & 飞叶点翠体系 (BP02-037 ~ BP02-047)
  // =========================================================================

  // BP02-037 含英·檀心 (7费)
  // 受限点：第 2 项「将该牌下方的 1 张《飞叶点翠》放置到墓地」需同时兼容附着装备 BP02-047 与下方叠置的 BP02-040；
  // 当前 CHOOSE_ZONE_CARDS 的 HOST_UNDERNEATH 仅遍历所有角色 underneathCardIds，故联合 BATTLEFIELD 扫描附着装备，存在场上其余《飞叶点翠》也会入列的风险。
  {
    cardNumber: 'BP02-037',
    name: '含英·檀心',
    vanillaEntry: true,
    activate: {
      oncePerTurn: true,
      steps: [
        {
          op: 'CHOOSE_MODE',
          prompt: '【含英·檀心】【起】【回合1】请从以下 2 项选择 1 项：',
          modes: [
            {
              id: 'equip_and_untap',
              label: '若为出场回合，手牌/墓地装备《飞叶点翠》并竖直费用区最多 3 张<含英>角色',
              steps: [
                {
                  op: 'IF',
                  condition: {
                    kind: 'ALL',
                    conditions: [
                      { kind: 'IS_ENTER_TURN' },
                      { kind: 'NOT', condition: { kind: 'SELF_MATCHES_FILTER', filter: { hasEquipment: true } } },
                    ],
                  },
                  then: [
                    {
                      op: 'CHOOSE_ZONE_CARDS',
                      side: 'SELF',
                      zone: 'HAND',
                      zones: ['HAND', 'GRAVEYARD'],
                      // Q&A·4：视为《飞叶点翠》的 BP02-040 仍是角色牌，不能被装备
                      filter: { cardType: CardType.EQUIPMENT, exactName: '飞叶点翠' },
                      prompt: '【含英·檀心】请选择我方手牌或墓地 1 张《飞叶点翠》装备到该牌：',
                      min: 1,
                      max: 1,
                      saveToVar: 'pickedEq',
                    },
                    {
                      op: 'IF',
                      condition: { kind: 'VAR_NON_EMPTY', varName: 'pickedEq' },
                      then: [
                        { op: 'EQUIP_FROM_VAR', varName: 'pickedEq', host: { kind: 'SELF' } },
                        {
                          op: 'CHOOSE_ZONE_CARDS',
                          side: 'SELF',
                          zone: 'COST',
                          filter: { isFaceUp: true, isReady: false, cardType: CardType.ROLE, trait: '含英' },
                          prompt: '【含英·檀心】请选择我方费用区最多 3 张<含英>角色将其竖直：',
                          min: 0,
                          max: 3,
                          saveToVar: 'readyCosts',
                        },
                        { op: 'SET_READY', target: { kind: 'VAR', varName: 'readyCosts' }, isReady: true },
                      ],
                    },
                  ],
                },
              ],
            },
            {
              id: 'sac_leaf_pierce_pp',
              label: '将该牌下方 1 张《飞叶点翠》送墓并消【2任意信号球】：下回合结束前获得【贯通】、PP+1000',
              steps: [
                {
                  op: 'IF',
                  condition: { kind: 'SELF_MATCHES_FILTER', filter: SELF_HAS_LEAF_FILTER },
                  then: [
                    {
                      op: 'ELIMINATE_ORB_COST',
                      filter: 'ANY',
                      count: 2,
                      optional: true,
                      prompt: '【含英·檀心】是否消除【2任意信号球】并将该牌下方 1 张《飞叶点翠》送墓？',
                      onPaid: [
                        {
                          op: 'CHOOSE_ZONE_CARDS',
                          side: 'SELF',
                          zone: 'HOST_UNDERNEATH',
                          zones: ['HOST_UNDERNEATH', 'BATTLEFIELD'],
                          hostFilter: { exactName: '含英·檀心' },
                          filter: { exactName: '飞叶点翠', excludeSelf: true },
                          prompt: '【含英·檀心】请选择该牌下方 1 张《飞叶点翠》放置到墓地：',
                          min: 1,
                          max: 1,
                          saveToVar: 'pickedLeaf',
                        },
                        {
                          op: 'MOVE_CARDS',
                          target: { kind: 'VAR', varName: 'pickedLeaf' },
                          toZone: 'GRAVEYARD',
                          isFaceUp: true,
                          saveMovedToVar: 'movedLeaf',
                        },
                        {
                          op: 'IF',
                          condition: { kind: 'VAR_NON_EMPTY', varName: 'movedLeaf' },
                          then: [
                            {
                              op: 'MODIFY_STATS',
                              target: { kind: 'SELF' },
                              keywords: ['贯通'],
                              pp: 1000,
                              duration: 'END_OF_NEXT_TURN',
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  },

  // BP02-038 含英·檀心 (5费)
  {
    cardNumber: 'BP02-038',
    name: '含英·檀心',
    vanillaEntry: true,
    activate: {
      oncePerTurn: true,
      steps: [
        {
          op: 'CHOOSE_MODE',
          prompt: '【含英·檀心】【起】【回合1】请从以下 2 项选择 1 项：',
          modes: [
            {
              id: 'equip_from_hand',
              label: '选择我方手牌 1 张《飞叶点翠》，将其装备',
              steps: [
                {
                  op: 'IF',
                  condition: {
                    kind: 'NOT',
                    condition: { kind: 'SELF_MATCHES_FILTER', filter: { hasEquipment: true } },
                  },
                  then: [
                    {
                      op: 'CHOOSE_ZONE_CARDS',
                      side: 'SELF',
                      zone: 'HAND',
                      filter: { cardType: CardType.EQUIPMENT, exactName: '飞叶点翠' },
                      prompt: '【含英·檀心】请选择我方手牌 1 张《飞叶点翠》装备到该牌：',
                      min: 1,
                      max: 1,
                      saveToVar: 'pickedEq',
                    },
                    { op: 'EQUIP_FROM_VAR', varName: 'pickedEq', host: { kind: 'SELF' } },
                  ],
                },
              ],
            },
            {
              id: 'sac_leaf_deploy',
              label: '可将该牌下方 1 张《飞叶点翠》送墓，从手牌出场 1 张费用<=3 的<含英>角色',
              steps: [
                {
                  op: 'IF',
                  condition: { kind: 'SELF_MATCHES_FILTER', filter: SELF_HAS_LEAF_FILTER },
                  then: [
                    {
                      op: 'CHOOSE_ZONE_CARDS',
                      side: 'SELF',
                      zone: 'HOST_UNDERNEATH',
                      zones: ['HOST_UNDERNEATH', 'BATTLEFIELD'],
                      hostFilter: { exactName: '含英·檀心' },
                      filter: { exactName: '飞叶点翠', excludeSelf: true },
                      prompt: '【含英·檀心】可选择该牌下方 1 张《飞叶点翠》放置到墓地（不选则不发动）：',
                      min: 0,
                      max: 1,
                      saveToVar: 'pickedLeaf',
                    },
                    {
                      op: 'IF',
                      condition: { kind: 'VAR_NON_EMPTY', varName: 'pickedLeaf' },
                      then: [
                        {
                          op: 'MOVE_CARDS',
                          target: { kind: 'VAR', varName: 'pickedLeaf' },
                          toZone: 'GRAVEYARD',
                          isFaceUp: true,
                          saveMovedToVar: 'movedLeaf',
                        },
                        {
                          op: 'IF',
                          condition: { kind: 'VAR_NON_EMPTY', varName: 'movedLeaf' },
                          then: [
                            {
                              op: 'CHOOSE_ZONE_CARDS',
                              side: 'SELF',
                              zone: 'HAND',
                              filter: { cardType: CardType.ROLE, trait: '含英', maxCost: 3 },
                              requireEmptySlot: true,
                              prompt: '【含英·檀心】请选择我方手牌 1 张费用为 3 及以下的<含英>角色出场：',
                              min: 1,
                              max: 1,
                              saveToVar: 'deployRole',
                            },
                            {
                              op: 'MOVE_CARDS',
                              target: { kind: 'VAR', varName: 'deployRole' },
                              toZone: 'BATTLEFIELD',
                              triggerEntry: true,
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  },

  // BP02-039 含英·檀心 (4费)
  {
    cardNumber: 'BP02-039',
    name: '含英·檀心',
    entry: {
      cost: {
        kind: 'DISCARD_HAND',
        count: 1,
        optional: true,
        prompt: '【含英·檀心】【出】是否丢弃 1 张手牌：公开牌组顶 4 张检索<含英>角色或《飞叶点翠》？',
      },
      steps: [
        { op: 'REVEAL_TOP', count: 4, saveToVar: 'revealed' },
        {
          op: 'CHOOSE_FROM_VAR',
          varName: 'revealed',
          filter: { anyFilters: [{ cardType: CardType.ROLE, trait: '含英' }, { exactName: '飞叶点翠' }] },
          alwaysShow: true,
          prompt: '【含英·檀心】【出】选择其中最多 1 张<含英>角色或《飞叶点翠》加入手牌（其余放牌组底）：',
          min: 0,
          max: 1,
          saveToVar: 'kept',
        },
        { op: 'MOVE_CARDS', target: { kind: 'VAR', varName: 'kept' }, toZone: 'HAND', isFaceUp: true },
        {
          op: 'MOVE_CARDS',
          target: { kind: 'REST_OF_VAR', allVar: 'revealed', excludeVar: 'kept' },
          toZone: 'DECK_BOTTOM',
        },
      ],
    },
  },

  // BP02-040 含英·檀心 (2费)
  // 注：【永】「该牌的卡牌名称在所有区域可以视为《飞叶点翠》」已内置于 continuous-effects.ts (static:BP02-040)，切勿重复注册！
  {
    cardNumber: 'BP02-040',
    name: '含英·檀心',
    vanillaEntry: true,
    activate: {
      condition: {
        kind: 'ALL',
        conditions: [
          { kind: 'SELF_MATCHES_FILTER', filter: { isReady: true, inZone: 'BATTLEFIELD' } },
          { kind: 'HAS_ROLE', side: 'SELF', filter: { exactName: '含英·檀心', excludeSelf: true } },
        ],
      },
      conditionError: '需要该牌处于竖直状态且我方战场存在其他《含英·檀心》',
      steps: [
        {
          op: 'CHOOSE_ROLES',
          side: 'SELF',
          filter: { exactName: '含英·檀心', excludeSelf: true },
          prompt: '【含英·檀心】【起】选择我方战场其他 1 张《含英·檀心》，将该牌放置到其下方：',
          min: 1,
          max: 1,
          saveToVar: 'host',
        },
        {
          op: 'MOVE_CARDS',
          target: { kind: 'SELF' },
          toZone: 'UNDERNEATH',
          underneathHost: { kind: 'VAR', varName: 'host' },
        },
      ],
    },
  },

  // BP02-041 含英·檀心 (6费 【永】：【速攻】)
  // 受限点：engine.ts playSacrificeDiscount 目前在 BATTLEFIELD 仅扫描 s.roleCardId，可正确选中场上的 BP02-040 且不选下方牌(Q&A·5)，但暂未扫入装备中/独立的 BP02-047。
  {
    cardNumber: 'BP02-041',
    name: '含英·檀心',
    vanillaEntry: true,
    playSacrificeDiscount: {
      zones: ['BATTLEFIELD'],
      filter: { exactName: '飞叶点翠' },
      discount: 2,
      prompt: '【含英·檀心】使用该牌时，可选择将我方战场 1 张《飞叶点翠》放置到墓地，使该牌费用-2：',
    },
  },

  // BP02-042 含英·檀心 (5费)
  {
    cardNumber: 'BP02-042',
    name: '含英·檀心',
    entry: {
      steps: [
        {
          op: 'IF',
          condition: { kind: 'HAS_ROLE', side: 'OPPONENT', minCount: 4 },
          then: [
            {
              op: 'CHOOSE_ROLES',
              side: 'OPPONENT',
              filter: { maxCost: 5 },
              prompt: '【含英·檀心】【出】对方角色>=4张，请选择对方战场 1 张费用为 5 及以下的角色破坏：',
              min: 1,
              max: 1,
              saveToVar: 'victim',
            },
            { op: 'DESTROY_ROLES', target: { kind: 'VAR', varName: 'victim' } },
          ],
          else: [
            {
              op: 'CHOOSE_ROLES',
              side: 'OPPONENT',
              filter: { maxCost: 2 },
              prompt: '【含英·檀心】【出】请选择对方战场 1 张费用为 2 及以下的角色破坏：',
              min: 1,
              max: 1,
              saveToVar: 'victim',
            },
            { op: 'DESTROY_ROLES', target: { kind: 'VAR', varName: 'victim' } },
          ],
        },
      ],
    },
  },

  // BP02-043 含英·檀心 (4费)
  {
    cardNumber: 'BP02-043',
    name: '含英·檀心',
    staticEffects: [
      {
        id: 'dsl:BP02-043:leaf_charge_plus_1',
        scope: 'SELF',
        condition: { kind: 'SELF_MATCHES_FILTER', filter: SELF_HAS_LEAF_FILTER },
        charge: 1,
      },
    ],
    entry: {
      steps: [
        {
          op: 'CHOOSE_ROLES',
          side: 'SELF',
          filter: { anyTraits: ['九龙商会', '机械教会'], excludeSelf: true },
          prompt: '【含英·檀心】【出】请选择我方战场其他 1 张<九龙商会>或<机械教会>角色：',
          min: 1,
          max: 1,
          saveToVar: 'host',
        },
        {
          op: 'IF',
          condition: { kind: 'VAR_NON_EMPTY', varName: 'host' },
          then: [
            { op: 'REVEAL_TOP', count: 2, saveToVar: 'revealed' },
            {
              op: 'CHOOSE_FROM_VAR',
              varName: 'revealed',
              filter: { cardType: CardType.ROLE },
              alwaysShow: true,
              prompt: '【含英·檀心】【出】选择其中最多 1 张角色牌放置到所选角色下方（其余放牌组底）：',
              min: 0,
              max: 1,
              saveToVar: 'picked',
            },
            {
              op: 'MOVE_CARDS',
              target: { kind: 'VAR', varName: 'picked' },
              toZone: 'UNDERNEATH',
              underneathHost: { kind: 'VAR', varName: 'host' },
            },
            {
              op: 'MOVE_CARDS',
              target: { kind: 'REST_OF_VAR', allVar: 'revealed', excludeVar: 'picked' },
              toZone: 'DECK_BOTTOM',
            },
          ],
        },
      ],
    },
  },

  // BP02-044 含英·檀心 (3费)
  {
    cardNumber: 'BP02-044',
    name: '含英·檀心',
    vanillaEntry: true,
    staticEffects: [
      {
        id: 'dsl:BP02-044:leaf_pp_dp',
        scope: 'SELF',
        condition: { kind: 'SELF_MATCHES_FILTER', filter: SELF_HAS_LEAF_FILTER },
        pp: 1500,
        dp: 1,
      },
    ],
  },

  // BP02-045 含英·檀心 (3费 【永】：【充能0】)
  { cardNumber: 'BP02-045', name: '含英·檀心', vanillaEntry: true },

  // BP02-046 月寒一声 (4费 战术)
  {
    cardNumber: 'BP02-046',
    name: '月寒一声',
    playPrecondition: {
      condition: {
        kind: 'ZONE_COUNT',
        side: 'SELF',
        zone: 'COST',
        filter: { trait: '含英', isFaceUp: true },
        op: '>=',
        value: 3,
      },
      errorMessage: '该牌只能在我方费用区的<含英>明费为 3 张及以上时才能使用',
    },
    tactics: [
      {
        op: 'CHOOSE_ROLES',
        side: 'OPPONENT',
        filter: { maxEffectivePP: 8000 },
        prompt: '【月寒一声】请选择对方战场 1 张 PP 为 8000 及以下的角色将其破坏：',
        min: 1,
        max: 1,
        saveToVar: 'victim',
      },
      { op: 'DESTROY_ROLES', target: { kind: 'VAR', varName: 'victim' } },
      {
        op: 'ELIMINATE_ORB_COST',
        filter: 'ANY',
        count: 2,
        optional: true,
        prompt: '【月寒一声】是否追加消除【2任意信号球】，将我方墓地 1 张《飞叶点翠》加入手牌？',
        onPaid: [
          {
            op: 'CHOOSE_ZONE_CARDS',
            side: 'SELF',
            zone: 'GRAVEYARD',
            filter: { exactName: '飞叶点翠' },
            prompt: '【月寒一声】请选择我方墓地 1 张《飞叶点翠》加入手牌：',
            min: 1,
            max: 1,
            saveToVar: 'leaf',
          },
          { op: 'MOVE_CARDS', target: { kind: 'VAR', varName: 'leaf' }, toZone: 'HAND', isFaceUp: true },
        ],
      },
    ],
  },

  // BP02-047 飞叶点翠 (2费 装备 PP+500)
  // Q&A·4：单独出场时未装备任何角色不执行；作为装备出场时使装备对象《含英·檀心》获得【突进】。
  // 受限点：CardTargetRef 暂无 strictly-self 的 EQUIPPED_HOST，当场上仅 1 张《含英·檀心》装备 BP02-047 时精准生效；多张各装备 BP02-047 时会一并匹配。
  {
    cardNumber: 'BP02-047',
    name: '飞叶点翠',
    entry: {
      steps: [
        {
          op: 'MODIFY_STATS',
          target: {
            kind: 'ALL_MATCHING_ROLES',
            side: 'SELF',
            filter: {
              exactName: '含英·檀心',
              hasUnderneathOrEquipMatching: { cardNumbers: ['BP02-047'] },
            },
          },
          keywords: ['突进'],
          duration: 'END_OF_TURN',
        },
      ],
    },
  },

  // =========================================================================
  // 6. 曲·启明 & 万世铭体系 (BP02-048 ~ BP02-055)
  // =========================================================================

  // BP02-048 曲·启明 (7费 升变)
  {
    cardNumber: 'BP02-048',
    name: '曲·启明',
    entry: {
      steps: [{ op: 'CUSTOM_HANDLER', handlerId: 'BP02_048_WANSHIMING_SACRIFICE' }],
    },
  },

  // BP02-049 曲·启明 (4费；战斗破坏代替已内置于 replacement-engine.ts builtin:BP02-049_BATTLE_SAVE)
  {
    cardNumber: 'BP02-049',
    name: '曲·启明',
    entry: {
      steps: [
        {
          op: 'IF',
          condition: {
            kind: 'ANY',
            conditions: [
              { kind: 'ZONE_COUNT', side: 'SELF', zone: 'COST', filter: { trait: '万世铭', isFaceUp: true }, op: '>=', value: 2 },
              { kind: 'ZONE_COUNT', side: 'SELF', zone: 'GRAVEYARD', filter: { trait: '万世铭' }, op: '>=', value: 2 },
              {
                kind: 'ALL',
                conditions: [
                  { kind: 'ZONE_COUNT', side: 'SELF', zone: 'COST', filter: { trait: '万世铭', isFaceUp: true }, op: '>=', value: 1 },
                  { kind: 'ZONE_COUNT', side: 'SELF', zone: 'GRAVEYARD', filter: { trait: '万世铭' }, op: '>=', value: 1 },
                ],
              },
            ],
          },
          then: [
            {
              op: 'CONFIRM_YES_NO',
              prompt: '【曲·启明】【出】是否将我方费用区（明费）和墓地合计 2 张<万世铭>加入牌组并洗切，直到回合结束获得【速攻】？',
              yesLabel: '洗回 2 张<万世铭>',
              noLabel: '不发动',
              onYes: [
                {
                  op: 'CHOOSE_ZONE_CARDS',
                  side: 'SELF',
                  zone: 'COST',
                  zones: ['COST', 'GRAVEYARD'],
                  filter: COST_OR_GY_WANSHIMING_FILTER,
                  prompt: '【曲·启明】【出】请选择费用区（明费）和墓地合计 2 张<万世铭>加入牌组并洗切：',
                  min: 2,
                  max: 2,
                  saveToVar: 'picked',
                },
                {
                  op: 'MOVE_CARDS',
                  target: { kind: 'VAR', varName: 'picked' },
                  toZone: 'DECK_SHUFFLE',
                  saveMovedToVar: 'returned',
                },
                {
                  op: 'IF',
                  condition: { kind: 'VAR_COUNT_COMPARE', varName: 'returned', op: '==', value: 2 },
                  then: [{ op: 'MODIFY_STATS', target: { kind: 'SELF' }, keywords: ['速攻'], duration: 'END_OF_TURN' }],
                },
              ],
            },
          ],
        },
      ],
    },
  },

  // BP02-050 曲·启明 (6费)
  {
    cardNumber: 'BP02-050',
    name: '曲·启明',
    entry: {
      steps: [
        { op: 'REVEAL_TOP', count: 5, saveToVar: 'revealed' },
        {
          op: 'CHOOSE_FROM_VAR',
          varName: 'revealed',
          filter: { trait: '万世铭', inZone: 'PROCESSING' },
          alwaysShow: true,
          prompt: '【曲·启明】【出】选择其中最多 2 张<万世铭>放置到墓地（其余放回牌组并洗切）：',
          min: 0,
          max: 2,
          saveToVar: 'toGy',
        },
        {
          op: 'MOVE_CARDS',
          target: { kind: 'VAR', varName: 'toGy' },
          toZone: 'GRAVEYARD',
          isFaceUp: true,
          saveMovedToVar: 'milledWsm',
        },
        {
          op: 'MOVE_CARDS',
          target: { kind: 'REST_OF_VAR', allVar: 'revealed', excludeVar: 'toGy' },
          toZone: 'DECK_SHUFFLE',
        },
        { op: 'SHUFFLE_DECK', side: 'SELF' },
        {
          op: 'IF',
          condition: { kind: 'VAR_COUNT_COMPARE', varName: 'milledWsm', op: '>=', value: 1 },
          then: [createBp02050ModeStep('1')],
        },
        {
          op: 'IF',
          condition: { kind: 'VAR_COUNT_COMPARE', varName: 'milledWsm', op: '>=', value: 2 },
          then: [createBp02050ModeStep('2')],
        },
      ],
    },
  },

  // BP02-051 曲·启明 (5费)
  {
    cardNumber: 'BP02-051',
    name: '曲·启明',
    entry: {
      steps: [
        {
          op: 'CHOOSE_ZONE_CARDS',
          side: 'SELF',
          zone: 'COST',
          zones: ['COST', 'GRAVEYARD'],
          filter: COST_OR_GY_WANSHIMING_FILTER,
          prompt: '【曲·启明】【出】可将费用区（明费）和墓地最少 1 张<万世铭>加入牌组并洗切（不选则跳过）：',
          min: 0,
          max: 50,
          saveToVar: 'picked',
        },
        {
          op: 'IF',
          condition: { kind: 'VAR_NON_EMPTY', varName: 'picked' },
          then: [
            {
              op: 'MOVE_CARDS',
              target: { kind: 'VAR', varName: 'picked' },
              toZone: 'DECK_SHUFFLE',
              saveMovedToVar: 'returned',
            },
            {
              op: 'IF',
              condition: { kind: 'VAR_NON_EMPTY', varName: 'returned' },
              then: [
                {
                  op: 'CHOOSE_ZONE_CARDS',
                  side: 'SELF',
                  zone: 'COST',
                  filter: { isFaceUp: true, isReady: false, exactName: '曲·启明' },
                  prompt: '【曲·启明】【出】选择我方费用区最多 2 张《曲·启明》将其竖直：',
                  min: 0,
                  max: 2,
                  saveToVar: 'readyQu',
                },
                { op: 'SET_READY', target: { kind: 'VAR', varName: 'readyQu' }, isReady: true },
                {
                  op: 'IF',
                  condition: { kind: 'VAR_COUNT_COMPARE', varName: 'returned', op: '>=', value: 2 },
                  then: [
                    {
                      op: 'CHOOSE_ROLES',
                      side: 'OPPONENT',
                      filter: { maxCost: 3 },
                      prompt: '【曲·启明】【出】加入牌组>=2张，选择对方战场 1 张费用为 3 及以下的角色将其横置：',
                      min: 1,
                      max: 1,
                      saveToVar: 'tapTarget',
                    },
                    { op: 'SET_READY', target: { kind: 'VAR', varName: 'tapTarget' }, isReady: false },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  },

  // BP02-052 曲·启明 (4费)
  // 受限点：Q&A·5 指出被 BP02-052 公开的《万世铭》也可触发改放费用区；当前只有 REVEAL_TOP 钩入了 BP01_WANSHIMING_REVEAL_TO_COST，全牌组检索 CHOOSE_ZONE_CARDS(DECK) 尚不触发该置换。
  {
    cardNumber: 'BP02-052',
    name: '曲·启明',
    vanillaEntry: true,
    staticEffects: [
      {
        id: 'dsl:BP02-052:turn_cost_wanshiming_pp',
        scope: 'SELF',
        condition: { kind: 'TURN_OWNER', isSelfTurn: true },
        pp: {
          kind: 'ZONE_COUNT_MULT',
          side: 'SELF',
          zone: 'COST',
          filter: { trait: '万世铭', isFaceUp: true },
          multiplier: 500,
        },
        dependsOnTraits: true,
      },
    ],
    triggers: [
      {
        abilityId: 'dsl:BP02-052:attack_end_top_deck',
        eventType: 'ATTACK_ENDED',
        matcher: { kind: 'SELF_ATTACK_END' },
        label: '【曲·启明】【自】攻击结束时可消 3 球检索 1 张《曲·启明》或<万世铭>洗切后置顶',
        steps: [
          {
            op: 'ELIMINATE_ORB_COST',
            filter: 'ANY',
            count: 3,
            optional: true,
            prompt: '【曲·启明】【自】是否消除【3任意信号球】：从牌组公开 1 张《曲·启明》或<万世铭>，洗切后置顶？',
            onPaid: [
              {
                op: 'CHOOSE_ZONE_CARDS',
                side: 'SELF',
                zone: 'DECK',
                filter: { anyFilters: [{ exactName: '曲·启明' }, { trait: '万世铭' }] },
                prompt: '【曲·启明】【自】请选择我方牌组 1 张《曲·启明》或<万世铭>（洗切牌组后放置到牌组顶）：',
                min: 1,
                max: 1,
                saveToVar: 'picked',
              },
              { op: 'SHUFFLE_DECK', side: 'SELF' },
              { op: 'MOVE_CARDS', target: { kind: 'VAR', varName: 'picked' }, toZone: 'DECK_TOP' },
            ],
          },
        ],
      },
    ],
  },

  // BP02-053 曲·启明 (3费 【永】：【充能0】)
  {
    cardNumber: 'BP02-053',
    name: '曲·启明',
    vanillaEntry: true,
    triggers: [
      {
        abilityId: 'dsl:BP02-053:attack_recycle_wsm',
        eventType: 'ATTACK_DECLARED',
        matcher: { kind: 'SELF_ATTACKING' },
        label: '【曲·启明】【自】攻击时可洗回墓地<万世铭>，获得【充能+1】，>=2张时下回合结束前 PP+2000',
        steps: [
          {
            op: 'CHOOSE_ZONE_CARDS',
            side: 'SELF',
            zone: 'GRAVEYARD',
            filter: { trait: '万世铭' },
            prompt: '【曲·启明】【自】可选择我方墓地最少 1 张<万世铭>加入牌组并洗切（不选则跳过）：',
            min: 0,
            max: 50,
            saveToVar: 'picked',
          },
          {
            op: 'IF',
            condition: { kind: 'VAR_NON_EMPTY', varName: 'picked' },
            then: [
              {
                op: 'MOVE_CARDS',
                target: { kind: 'VAR', varName: 'picked' },
                toZone: 'DECK_SHUFFLE',
                saveMovedToVar: 'returned',
              },
              {
                op: 'IF',
                condition: { kind: 'VAR_NON_EMPTY', varName: 'returned' },
                then: [
                  { op: 'MODIFY_STATS', target: { kind: 'SELF' }, charge: 1, duration: 'END_OF_TURN' },
                  {
                    op: 'IF',
                    condition: { kind: 'VAR_COUNT_COMPARE', varName: 'returned', op: '>=', value: 2 },
                    then: [
                      { op: 'MODIFY_STATS', target: { kind: 'SELF' }, pp: 2000, duration: 'END_OF_NEXT_TURN' },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  },

  // BP02-054 曲·启明 (3费)
  {
    cardNumber: 'BP02-054',
    name: '曲·启明',
    entry: {
      steps: [
        { op: 'REVEAL_TOP', count: 1, saveToVar: 'revealed' },
        {
          op: 'IF',
          condition: {
            kind: 'VAR_HAS_CARD_MATCHING',
            varName: 'revealed',
            filter: { cardType: CardType.ROLE, trait: '曲', inZone: 'PROCESSING' },
          },
          then: [
            {
              op: 'CHOOSE_FROM_VAR',
              varName: 'revealed',
              filter: { cardType: CardType.ROLE, trait: '曲', inZone: 'PROCESSING' },
              alwaysShow: true,
              prompt: '【曲·启明】【出】公开的牌为<曲>角色，是否加入手牌？（若加入手牌须丢弃 1 张手牌）',
              min: 0,
              max: 1,
              saveToVar: 'picked',
            },
            {
              op: 'IF',
              condition: { kind: 'VAR_NON_EMPTY', varName: 'picked' },
              then: [
                {
                  op: 'MOVE_CARDS',
                  target: { kind: 'VAR', varName: 'picked' },
                  toZone: 'HAND',
                  isFaceUp: true,
                  saveMovedToVar: 'added',
                },
                {
                  op: 'IF',
                  condition: { kind: 'VAR_NON_EMPTY', varName: 'added' },
                  then: [
                    {
                      op: 'CHOOSE_ZONE_CARDS',
                      side: 'SELF',
                      zone: 'HAND',
                      prompt: '【曲·启明】【出】请选择 1 张手牌丢弃：',
                      min: 1,
                      max: 1,
                      saveToVar: 'discarded',
                    },
                    { op: 'MOVE_CARDS', target: { kind: 'VAR', varName: 'discarded' }, toZone: 'GRAVEYARD', isFaceUp: true },
                  ],
                },
              ],
              else: [
                {
                  op: 'MOVE_CARDS',
                  target: { kind: 'REST_OF_VAR', allVar: 'revealed', excludeVar: 'picked' },
                  toZone: 'DECK_TOP',
                },
              ],
            },
          ],
          else: [
            {
              op: 'IF',
              condition: { kind: 'VAR_HAS_CARD_MATCHING', varName: 'revealed', filter: { inZone: 'PROCESSING' } },
              then: [{ op: 'MOVE_CARDS', target: { kind: 'VAR', varName: 'revealed' }, toZone: 'DECK_TOP' }],
            },
          ],
        },
      ],
    },
  },

  // BP02-055 启星册魂 (1费 战术)
  {
    cardNumber: 'BP02-055',
    name: '启星册魂',
    playPrecondition: {
      condition: { kind: 'HAS_ROLE', side: 'SELF', filter: { exactName: '曲·启明' } },
      errorMessage: '该牌只能在我方战场存在《曲·启明》时才能使用',
    },
    tactics: [
      {
        op: 'CHOOSE_ZONE_CARDS',
        side: 'SELF',
        zone: 'DECK',
        filter: { trait: '万世铭' },
        prompt: '【启星册魂】请选择我方牌组 1 张<万世铭>放置到墓地：',
        min: 1,
        max: 1,
        saveToVar: 'pickedWsm',
      },
      { op: 'MOVE_CARDS', target: { kind: 'VAR', varName: 'pickedWsm' }, toZone: 'GRAVEYARD', isFaceUp: true },
      { op: 'SHUFFLE_DECK', side: 'SELF' },
      {
        op: 'CHOOSE_ROLES',
        side: 'SELF',
        filter: { exactName: '曲·启明' },
        prompt: '【启星册魂】请选择我方战场 1 张《曲·启明》，直到下个回合结束 PP+1000：',
        min: 1,
        max: 1,
        saveToVar: 'targetQu',
      },
      { op: 'MODIFY_STATS', target: { kind: 'VAR', varName: 'targetQu' }, pp: 1000, duration: 'END_OF_NEXT_TURN' },
    ],
  },

  // =========================================================================
  // 7. 三头犬小队体系 (BP02-056 ~ BP02-065)
  // =========================================================================

  // BP02-056 薇拉·绯耀 (6费 升变)
  {
    cardNumber: 'BP02-056',
    name: '薇拉·绯耀',
    vanillaEntry: true,
    activate: {
      oncePerTurn: true,
      cost: {
        kind: 'ELIMINATE_ORBS',
        filter: 'ANY',
        count: 2,
        prompt: '【薇拉·绯耀】【起】【回合1】消除【2任意信号球】强化 1 张费用<=2 的<三头犬小队>角色',
      },
      steps: [
        {
          op: 'CHOOSE_ROLES',
          side: 'SELF',
          filter: { trait: '三头犬小队', maxCost: 2 },
          prompt: '【薇拉·绯耀】【起】请选择我方战场 1 张费用为 2 及以下的<三头犬小队>角色：',
          min: 1,
          max: 1,
          saveToVar: 'target',
        },
        {
          op: 'MODIFY_STATS',
          target: { kind: 'VAR', varName: 'target' },
          keywords: ['速攻'],
          pp: 2000,
          setBaseDP: 1,
          duration: 'END_OF_TURN',
        },
      ],
    },
  },

  // BP02-057 21号·森息 (5费 升变)
  {
    cardNumber: 'BP02-057',
    name: '21号·森息',
    entries: [
      {
        id: 'draw_discard',
        label: '【出】：抽 2 张牌，丢弃 2 张手牌',
        steps: [
          { op: 'DRAW', count: 2 },
          {
            op: 'CHOOSE_ZONE_CARDS',
            side: 'SELF',
            zone: 'HAND',
            prompt: '【21号·森息】【出】请选择 2 张手牌丢弃：',
            min: 2,
            max: 2,
            saveToVar: 'discarded',
          },
          { op: 'MOVE_CARDS', target: { kind: 'VAR', varName: 'discarded' }, toZone: 'GRAVEYARD', isFaceUp: true },
        ],
      },
      {
        id: 'orb_revive',
        label: '【出】【2任意信号球】：从墓地出场 1 张费用<=2 的<薇拉>或<诺克提>角色',
        cost: {
          kind: 'ELIMINATE_ORBS',
          filter: 'ANY',
          count: 2,
          optional: true,
          prompt: '【21号·森息】【出】是否消除【2任意信号球】，从墓地出场 1 张费用<=2 的<薇拉>或<诺克提>角色？',
        },
        steps: [
          {
            op: 'CHOOSE_ZONE_CARDS',
            side: 'SELF',
            zone: 'GRAVEYARD',
            filter: { cardType: CardType.ROLE, anyTraits: ['薇拉', '诺克提'], maxCost: 2 },
            requireEmptySlot: true,
            prompt: '【21号·森息】【出】请选择我方墓地 1 张费用为 2 及以下的<薇拉>或<诺克提>角色出场：',
            min: 1,
            max: 1,
            saveToVar: 'revived',
          },
          { op: 'MOVE_CARDS', target: { kind: 'VAR', varName: 'revived' }, toZone: 'BATTLEFIELD', triggerEntry: true },
        ],
      },
    ],
  },

  // BP02-058 诺克提·擎驱 (5费 升变)
  {
    cardNumber: 'BP02-058',
    name: '诺克提·擎驱',
    entry: {
      steps: [
        {
          op: 'IF',
          condition: { kind: 'HAS_ROLE', side: 'SELF', filter: { attribute: ElementAttribute.LIGHTNING }, minCount: 2 },
          then: [
            {
              op: 'CHOOSE_ROLES',
              side: 'OPPONENT',
              prompt: '【诺克提·擎驱】【出】请选择对方战场 1 张角色，直到回合结束失去能力且不能获得新能力：',
              min: 1,
              max: 1,
              saveToVar: 'target',
            },
            {
              op: 'MODIFY_STATS',
              target: { kind: 'VAR', varName: 'target' },
              loseAbilities: true,
              prohibitions: ['CANNOT_GAIN_ABILITIES'],
              duration: 'END_OF_TURN',
            },
          ],
        },
      ],
    },
  },

  // BP02-059 薇拉·绯耀 (4费)
  {
    cardNumber: 'BP02-059',
    name: '薇拉·绯耀',
    entry: {
      cost: {
        kind: 'DISCARD_HAND',
        count: 1,
        filter: { cardType: CardType.ROLE, trait: '三头犬小队', maxCost: 2 },
        optional: true,
        prompt: '【薇拉·绯耀】【出】是否丢弃手牌 1 张费用<=2 的<三头犬小队>角色，抽 2 张牌？',
      },
      steps: [{ op: 'DRAW', count: 2 }],
    },
  },

  // BP02-060 21号·森息 (3费)
  // 受限点：文本为「若我方费用上限不大于对方」（总费用区张数 3.6.6），ConditionExpr 当前仅提供比较明费上限的 OPEN_COST_COMPARE_OPPONENT（无暗费时等价，存在暗费时存在差异）。
  {
    cardNumber: 'BP02-060',
    name: '21号·森息',
    vanillaEntry: true,
    handCostDiscount: {
      condition: { kind: 'OPEN_COST_COMPARE_OPPONENT', op: '<=' },
      flatDiscount: 1,
    },
    staticEffects: [
      {
        id: 'dsl:BP02-060:field_cost_minus_1',
        scope: 'SELF',
        condition: { kind: 'OPEN_COST_COMPARE_OPPONENT', op: '<=' },
        costDelta: -1,
      },
    ],
  },

  // BP02-061 21号·森息 (6费)
  {
    cardNumber: 'BP02-061',
    name: '21号·森息',
    entry: {
      steps: [
        {
          op: 'IF',
          condition: { kind: 'HAS_ROLE', side: 'SELF', filter: { trait: '三头犬小队' }, minCount: 3 },
          then: [
            { op: 'MODIFY_STATS', target: { kind: 'SELF' }, keywords: ['速攻'], duration: 'END_OF_TURN' },
            {
              op: 'CHOOSE_ROLES',
              side: 'SELF',
              filter: { trait: '三头犬小队' },
              prompt: '【21号·森息】【出】请选择我方战场 1 张<三头犬小队>角色，直到回合结束基本 DP 变为 1：',
              min: 1,
              max: 1,
              saveToVar: 'dpTarget',
            },
            { op: 'MODIFY_STATS', target: { kind: 'VAR', varName: 'dpTarget' }, setBaseDP: 1, duration: 'END_OF_TURN' },
          ],
          else: [
            {
              op: 'CHOOSE_MODE',
              prompt: '【21号·森息】【出】请从以下 2 项选择 1 项：',
              modes: [
                {
                  id: 'gain_rush',
                  label: '直到回合结束为止，该牌获得【速攻】',
                  steps: [{ op: 'MODIFY_STATS', target: { kind: 'SELF' }, keywords: ['速攻'], duration: 'END_OF_TURN' }],
                },
                {
                  id: 'set_base_dp_1',
                  label: '选择我方战场 1 张<三头犬小队>角色，直到回合结束基本 DP 变为 1',
                  steps: [
                    {
                      op: 'CHOOSE_ROLES',
                      side: 'SELF',
                      filter: { trait: '三头犬小队' },
                      prompt: '【21号·森息】【出】请选择我方战场 1 张<三头犬小队>角色，直到回合结束基本 DP 变为 1：',
                      min: 1,
                      max: 1,
                      saveToVar: 'dpTarget',
                    },
                    { op: 'MODIFY_STATS', target: { kind: 'VAR', varName: 'dpTarget' }, setBaseDP: 1, duration: 'END_OF_TURN' },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  },

  // BP02-062 薇拉·绯耀 (2费)
  {
    cardNumber: 'BP02-062',
    name: '薇拉·绯耀',
    vanillaEntry: true,
    triggers: [
      {
        abilityId: 'dsl:BP02-062:attack_buff',
        eventType: 'ATTACK_DECLARED',
        matcher: { kind: 'SELF_ATTACKING' },
        label: '【薇拉·绯耀】【自】攻击时选择我方战场 1 张<三头犬小队>角色 PP+1000',
        steps: [
          {
            op: 'CHOOSE_ROLES',
            side: 'SELF',
            filter: { trait: '三头犬小队' },
            prompt: '【薇拉·绯耀】【自】请选择我方战场 1 张<三头犬小队>角色，直到回合结束 PP+1000：',
            min: 1,
            max: 1,
            saveToVar: 'target',
          },
          { op: 'MODIFY_STATS', target: { kind: 'VAR', varName: 'target' }, pp: 1000, duration: 'END_OF_TURN' },
        ],
      },
    ],
  },

  // BP02-063 21号·森息 (2费)
  {
    cardNumber: 'BP02-063',
    name: '21号·森息',
    vanillaEntry: true,
    triggers: [
      {
        abilityId: 'dsl:BP02-063:tapped_loot',
        eventType: 'CARD_TAPPED',
        matcher: { kind: 'SELF_TAPPED' },
        label: '【21号·森息】【自】横置时抽 1 张牌，丢弃 1 张手牌',
        steps: [
          { op: 'DRAW', count: 1 },
          {
            op: 'CHOOSE_ZONE_CARDS',
            side: 'SELF',
            zone: 'HAND',
            prompt: '【21号·森息】【自】请选择 1 张手牌丢弃：',
            min: 1,
            max: 1,
            saveToVar: 'discarded',
          },
          { op: 'MOVE_CARDS', target: { kind: 'VAR', varName: 'discarded' }, toZone: 'GRAVEYARD', isFaceUp: true },
        ],
      },
    ],
  },

  // BP02-064 诺克提·擎驱 (2费 白板)
  { cardNumber: 'BP02-064', name: '诺克提·擎驱', vanillaEntry: true },

  // BP02-065 胜光战旗 (4费 战术)
  {
    cardNumber: 'BP02-065',
    name: '胜光战旗',
    tactics: [
      {
        op: 'MODIFY_STATS',
        target: {
          kind: 'ALL_MATCHING_ROLES',
          side: 'SELF',
          filter: { trait: '三头犬小队', maxCost: 2 },
        },
        // Q&A·4：【充能1】不增加基本充能数已为 1 的角色（用 setCharge: 1 而非 charge: 1），且不影响之后出场的角色
        keywords: ['充能1'],
        setCharge: 1,
        pp: 2000,
        setBaseDP: 1,
        duration: 'END_OF_TURN',
      },
    ],
  },

  // =========================================================================
  // 8. 万事·明晰梦 & 突击鹰小队体系 (BP02-066 ~ BP02-076)
  // =========================================================================

  // BP02-066 万事·明晰梦 (9费 升变)
  {
    cardNumber: 'BP02-066',
    name: '万事·明晰梦',
    entries: [
      {
        id: 'orb_tap_freeze',
        label: '【出】消除2同色信号球：若对方无冰冻角色，横置并冰冻对方 1 张角色',
        cost: {
          kind: 'ELIMINATE_ORBS',
          filter: 'SAME',
          count: 2,
          optional: true,
          prompt: '【万事·明晰梦】【出】是否消除 2 同色信号球，横置并冰冻对方 1 张角色？',
        },
        steps: [
          {
            op: 'IF',
            condition: { kind: 'NOT', condition: { kind: 'HAS_ROLE', side: 'OPPONENT', filter: { isFrozen: true } } },
            then: [
              {
                op: 'CHOOSE_ROLES',
                side: 'OPPONENT',
                prompt: '【万事·明晰梦】【出】请选择对方战场 1 张角色将其横置并冰冻：',
                min: 1,
                max: 1,
                saveToVar: 'target',
              },
              { op: 'SET_READY', target: { kind: 'VAR', varName: 'target' }, isReady: false },
              { op: 'SET_FROZEN', target: { kind: 'VAR', varName: 'target' }, isFrozen: true },
            ],
          },
        ],
      },
      {
        id: 'asc_lock_opp_orb',
        label: '【出】：若为升变出场，封锁对方信号球区最多 1 张信号球直到下个回合结束',
        steps: [
          {
            op: 'IF',
            condition: { kind: 'CARD_WAS_ASCENDED_PLAY' },
            then: [
              {
                op: 'CHOOSE_ZONE_CARDS',
                side: 'OPPONENT',
                zone: 'SIGNAL_ORB',
                filter: { isSignalOrb: true },
                prompt: '【万事·明晰梦】【出】请选择对方信号球区最多 1 张信号球，直到下个回合结束不能被消除：',
                min: 0,
                max: 1,
                saveToVar: 'oppOrb',
              },
              {
                op: 'MODIFY_STATS',
                target: { kind: 'VAR', varName: 'oppOrb' },
                prohibitions: ['CANNOT_ELIMINATE'],
                duration: 'END_OF_NEXT_TURN',
              },
            ],
          },
        ],
      },
    ],
  },

  // BP02-067 万事·明晰梦 (5费 升变；【永】横置状态下对方在横置角色上升变额外+1费已内置于 engine.ts)
  {
    cardNumber: 'BP02-067',
    name: '万事·明晰梦',
    entry: {
      cost: {
        kind: 'ELIMINATE_ORBS',
        filter: 'ANY',
        count: 2,
        optional: true,
        prompt: '【万事·明晰梦】【出】是否消除【2任意信号球】：若对方无冰冻角色，冰冻对方 1 张角色？',
      },
      steps: [
        {
          op: 'IF',
          condition: { kind: 'NOT', condition: { kind: 'HAS_ROLE', side: 'OPPONENT', filter: { isFrozen: true } } },
          then: [
            {
              op: 'CHOOSE_ROLES',
              side: 'OPPONENT',
              prompt: '【万事·明晰梦】【出】请选择对方战场 1 张角色将其冰冻：',
              min: 1,
              max: 1,
              saveToVar: 'target',
            },
            { op: 'SET_FROZEN', target: { kind: 'VAR', varName: 'target' }, isFrozen: true },
          ],
        },
      ],
    },
  },

  // BP02-068 万事·明晰梦 (6费 【永】：【突进】)
  {
    cardNumber: 'BP02-068',
    name: '万事·明晰梦',
    vanillaEntry: true,
    handCostDiscount: {
      condition: { kind: 'HAS_ROLE', side: 'OPPONENT', filter: { isFrozen: true } },
      flatDiscount: 2,
    },
  },

  // BP02-069 万事·明晰梦 (4费)
  {
    cardNumber: 'BP02-069',
    name: '万事·明晰梦',
    entry: {
      steps: [
        {
          op: 'REORDER_ZONE',
          zone: 'SIGNAL_ORB',
          prompt: '【万事·明晰梦】【出】按从下到上的顺序依次点选信号球区的全部 {orbCount} 张牌以重新排列',
        },
      ],
    },
    triggers: [
      {
        abilityId: 'dsl:BP02-069:battle_destroyed_freeze',
        eventType: 'CARD_DESTROYED',
        matcher: { kind: 'SELF_DESTROYED', destroyReason: 'BATTLE' },
        label: '【万事·明晰梦】【自】因战斗被破坏时可公开 2 张<万事>冰冻对方费用<=6 角色',
        steps: createWanshiRevealFreezeSteps(6, '万事·明晰梦', 'BP02_069'),
      },
    ],
  },

  // BP02-070 万事·明晰梦 (3费 【永】：【充能0】)
  {
    cardNumber: 'BP02-070',
    name: '万事·明晰梦',
    entry: {
      cost: {
        kind: 'ELIMINATE_ORBS',
        filter: 'ANY',
        count: 2,
        optional: true,
        prompt: '【万事·明晰梦】【出】是否消除【2任意信号球】并可公开 2 张<万事>冰冻对方费用<=5 角色？',
      },
      steps: createWanshiRevealFreezeSteps(5, '万事·明晰梦', 'BP02_070'),
    },
  },

  // BP02-071 万事·明晰梦 (5费)
  {
    cardNumber: 'BP02-071',
    name: '万事·明晰梦',
    vanillaEntry: true,
    triggers: [
      {
        abilityId: 'dsl:BP02-071:attack_bounce',
        eventType: 'ATTACK_DECLARED',
        matcher: { kind: 'SELF_ATTACKING' },
        condition: { kind: 'HAS_ROLE', side: 'OPPONENT', filter: { isFrozen: true } },
        label: '【万事·明晰梦】【自】攻击时若对方存在冰冻角色，将对方 1 张费用<=3 角色返回手牌',
        steps: [
          {
            op: 'CHOOSE_ROLES',
            side: 'OPPONENT',
            filter: { maxCost: 3 },
            prompt: '【万事·明晰梦】【自】请选择对方战场 1 张费用为 3 及以下的角色返回手牌：',
            min: 1,
            max: 1,
            saveToVar: 'target',
          },
          { op: 'MOVE_CARDS', target: { kind: 'VAR', varName: 'target' }, toZone: 'HAND', isFaceUp: true },
        ],
      },
    ],
  },

  // BP02-072 万事·明晰梦 (4费)
  {
    cardNumber: 'BP02-072',
    name: '万事·明晰梦',
    vanillaEntry: true,
    triggers: [
      {
        abilityId: 'dsl:BP02-072:attack_pp',
        eventType: 'ATTACK_DECLARED',
        matcher: { kind: 'SELF_ATTACKING' },
        condition: { kind: 'HAS_ROLE', side: 'OPPONENT', filter: { isFrozen: true } },
        label: '【万事·明晰梦】【自】攻击时若对方存在冰冻角色，该牌 PP+2000',
        steps: [{ op: 'MODIFY_STATS', target: { kind: 'SELF' }, pp: 2000, duration: 'END_OF_TURN' }],
      },
    ],
  },

  // BP02-073 万事·明晰梦 (3费 白板)
  { cardNumber: 'BP02-073', name: '万事·明晰梦', vanillaEntry: true },

  // BP02-074 万事·明晰梦 (2费)
  {
    cardNumber: 'BP02-074',
    name: '万事·明晰梦',
    entry: {
      steps: [
        {
          op: 'IF',
          condition: { kind: 'HAS_ROLE', side: 'OPPONENT', filter: { isFrozen: true } },
          then: [{ op: 'DRAW', count: 1 }],
        },
      ],
    },
  },

  // BP02-075 狙杀 (3费 战术)
  {
    cardNumber: 'BP02-075',
    name: '狙杀',
    tactics: [
      {
        op: 'IF',
        condition: { kind: 'HAS_ROLE', side: 'SELF', filter: { exactName: '万事·明晰梦' }, minCount: 2 },
        then: [
          {
            op: 'CHOOSE_ROLES',
            side: 'OPPONENT',
            filter: { isFrozen: true },
            prompt: '【狙杀】请选择对方战场 1 张冰冻状态的角色将其破坏：',
            min: 1,
            max: 1,
            saveToVar: 'victim',
          },
          { op: 'DESTROY_ROLES', target: { kind: 'VAR', varName: 'victim' } },
        ],
      },
    ],
  },

  // BP02-076 瑞雪 (2费 辅助机)
  {
    cardNumber: 'BP02-076',
    name: '瑞雪',
    vanillaEntry: true,
    activate: {
      cost: { kind: 'SELF_TO_GRAVEYARD', sentByEffectOrCost: true },
      steps: createWanshiRevealFreezeSteps(5, '瑞雪', 'BP02_076'),
    },
  },

  // =========================================================================
  // 9. 中立/通用【充能0】【同命】角色 (BP02-077 ~ BP02-081)
  // =========================================================================
  { cardNumber: 'BP02-077', name: '塞壬', vanillaEntry: true },
  { cardNumber: 'BP02-078', name: '喷涂机械', vanillaEntry: true },
  { cardNumber: 'BP02-079', name: '武藏玖型', vanillaEntry: true },
  { cardNumber: 'BP02-080', name: '华胥', vanillaEntry: true },
  { cardNumber: 'BP02-081', name: '光辉行进者', vanillaEntry: true },

  // =========================================================================
  // 10. BP02 全部信号球 (BP02-082 ~ BP02-090)
  // =========================================================================
  { cardNumber: 'BP02-082', name: '落木惊堂', isSignalOrbCard: true },
  { cardNumber: 'BP02-083', name: '纯白的救赎', isSignalOrbCard: true },
  { cardNumber: 'BP02-084', name: '黑与白', isSignalOrbCard: true },
  { cardNumber: 'BP02-085', name: '折影虚暮', isSignalOrbCard: true },
  { cardNumber: 'BP02-086', name: '灯塔', isSignalOrbCard: true },
  { cardNumber: 'BP02-087', name: '写给繁星的情书', isSignalOrbCard: true },
  { cardNumber: 'BP02-088', name: '琥珀', isSignalOrbCard: true },
  { cardNumber: 'BP02-089', name: '过往与未来', isSignalOrbCard: true },
  { cardNumber: 'BP02-090', name: '午后休憩', isSignalOrbCard: true },
];

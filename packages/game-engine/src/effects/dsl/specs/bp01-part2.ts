import { CardType } from '@zhanshuang/shared';
import type { CardEffectSpec, CardFilter } from '../types.js';

/** <封刃太刀> 装备筛选条件 (官方数据特征为 小太刀/大太刀/太刀) */
const FENGREN_TACHI_EQUIP_FILTER: CardFilter = {
  cardType: CardType.EQUIPMENT,
  anyTraits: ['封刃太刀', '太刀', '小太刀', '大太刀'],
};

/** 构造《梦赴光寥之乡》同编号异画共享规格 (BP01-056 / BP01-056a / BP01-056b，Q&A·7 同编号共享每回合2次上限) */
function createDreamLandSpec(cardNumber: 'BP01-056' | 'BP01-056a' | 'BP01-056b'): CardEffectSpec {
  return {
    cardNumber,
    name: '梦赴光寥之乡',
    tactics: [
      { op: 'DRAW', count: 1 },
      {
        op: 'CHOOSE_ZONE_CARDS',
        side: 'SELF',
        zone: 'HAND',
        prompt: '【梦赴光寥之乡】请选择丢弃 1 张手牌：',
        min: 1,
        max: 1,
        saveToVar: 'discarded',
      },
      {
        op: 'MOVE_CARDS',
        target: { kind: 'VAR', varName: 'discarded' },
        toZone: 'GRAVEYARD',
      },
    ],
    triggers: [
      {
        abilityId: `dsl:${cardNumber}:gy_return_on_orb`,
        eventType: 'ORBS_ELIMINATED',
        maxPerTurnByPlayer: 2,
        sharedTurnKey: 'BP01-056:ORB_RETURN',
        matcher: { kind: 'SELF_IN_GRAVEYARD_ON_SELF_ORBS_ELIMINATED' },
        label: `【${cardNumber} 梦赴光寥之乡】消除信号球时可将墓地的该牌加入手牌 (每回合最多2次)`,
        steps: [
          {
            // Q&A·7：进入结算已消耗次数；若此时因牌组更新已不在墓地则不再回手
            op: 'IF',
            condition: { kind: 'SELF_MATCHES_FILTER', filter: { inZone: 'GRAVEYARD' } },
            then: [
              {
                op: 'CONFIRM_YES_NO',
                prompt: '【梦赴光寥之乡】是否将墓地的该牌加入手牌？',
                yesLabel: '加入手牌',
                noLabel: '留在墓地',
                onYes: [
                  {
                    op: 'MOVE_CARDS',
                    target: { kind: 'SELF' },
                    toZone: 'HAND',
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

/**
 * 第一弹补充包 BP01 第二批 41 张卡牌声明式效果定义 (补齐 BP01 全部 88 张)：
 * - 露西亚·深红囚影 / 封刃太刀体系 (BP01-014 ~ BP01-027, 14 张)
 * - 曲·雀翎 / 万世铭体系 (BP01-028 ~ BP01-039, 12 张)
 * - 赛琳娜·希声 / 梦赴光寥之乡体系 (BP01-056 / 056a / 056b / BP01-057 ~ BP01-068, 15 张)
 */
export const BP01_PART2_SPECS: readonly CardEffectSpec[] = [
  // =========================================================================
  // 露西亚·深红囚影 / 封刃太刀体系 (BP01-014 ~ BP01-027)
  // =========================================================================

  // BP01-014 露西亚·深红囚影 (8费 升变)
  {
    cardNumber: 'BP01-014',
    name: '露西亚·深红囚影',
    vanillaEntry: true,
    staticEffects: [
      {
        id: 'dsl:BP01-014:dual_equip_fengren',
        scope: 'SELF',
        canDualEquipFengren: true,
      },
    ],
    activate: {
      oncePerTurn: true,
      cost: {
        kind: 'ELIMINATE_ORBS',
        filter: 'BLUE',
        count: 2,
        prompt: '【露西亚·深红囚影】消除 2 蓝色信号球：从墓地装备 1 张<大太刀>并使蓝球视为红/黄球',
      },
      steps: [
        // Q&A·7：即使墓地无<大太刀>或无法再装备，后段蓝球改色仍照常执行，且仅影响当时在信号球区的蓝球
        {
          op: 'CHOOSE_ZONE_CARDS',
          side: 'SELF',
          zone: 'GRAVEYARD',
          filter: { cardType: CardType.EQUIPMENT, trait: '大太刀' },
          prompt: '【露西亚·深红囚影】请选择我方墓地 1 张<大太刀>装备附着到该牌：',
          min: 1,
          max: 1,
          saveToVar: 'pickedEq',
        },
        {
          op: 'EQUIP_FROM_VAR',
          varName: 'pickedEq',
          host: { kind: 'SELF' },
        },
        {
          op: 'MODIFY_STATS',
          target: {
            kind: 'ZONE_CARDS',
            side: 'SELF',
            zone: 'SIGNAL_ORB',
            filter: { signalOrbColor: 'BLUE' },
          },
          treatedAsOrbColors: ['RED', 'YELLOW'],
          duration: 'END_OF_TURN',
        },
      ],
    },
    triggers: [
      {
        abilityId: 'dsl:BP01-014:attack_untap',
        eventType: 'ATTACK_DECLARED',
        oncePerTurn: true,
        deferOncePerTurnUntilCostPaid: true,
        matcher: { kind: 'SELF_ATTACKING' },
        label: '【露西亚·深红囚影】攻击时可消除 2 黄色信号球：竖直自身、充能+1、PP+1000',
        steps: [
          {
            op: 'ELIMINATE_ORB_COST',
            filter: 'YELLOW',
            count: 2,
            optional: true,
            prompt: '【露西亚·深红囚影】是否消除 2 黄色信号球以竖直自身并获得【充能+1】与 PP+1000？',
            onPaid: [
              { op: 'MARK_TURN_ABILITY_USED', abilityKey: '__TRIGGER_ONCE_KEY__' },
              { op: 'SET_READY', target: { kind: 'SELF' }, isReady: true },
              {
                op: 'MODIFY_STATS',
                target: { kind: 'SELF' },
                charge: 1,
                pp: 1000,
                duration: 'END_OF_TURN',
              },
            ],
          },
        ],
      },
    ],
  },

  // BP01-015 露西亚·深红囚影 (3费)：我方每回合使用的第1张装备的费用-1
  {
    cardNumber: 'BP01-015',
    name: '露西亚·深红囚影',
    vanillaEntry: true,
    fieldCardCostRule: {
      cardType: CardType.EQUIPMENT,
      firstPerTurnOnly: true,
      discount: 1,
    },
  },

  // BP01-016 露西亚·深红囚影 (5费)
  {
    cardNumber: 'BP01-016',
    name: '露西亚·深红囚影',
    vanillaEntry: true,
    staticEffects: [
      {
        id: 'dsl:BP01-016:dual_equip_fengren',
        scope: 'SELF',
        canDualEquipFengren: true,
      },
    ],
    activate: {
      oncePerTurn: true,
      cost: {
        kind: 'ELIMINATE_ORBS',
        filter: 'BLUE',
        count: 1,
        prompt: '【露西亚·深红囚影】消除 1 蓝色信号球：从墓地装备 1 张<封刃太刀>',
      },
      steps: [
        {
          op: 'CHOOSE_ZONE_CARDS',
          side: 'SELF',
          zone: 'GRAVEYARD',
          filter: FENGREN_TACHI_EQUIP_FILTER,
          prompt: '【露西亚·深红囚影】请选择我方墓地 1 张<封刃太刀>装备附着到该牌：',
          min: 1,
          max: 1,
          saveToVar: 'pickedEq',
        },
        {
          op: 'EQUIP_FROM_VAR',
          varName: 'pickedEq',
          host: { kind: 'SELF' },
        },
      ],
    },
  },

  // BP01-017 露西亚·深红囚影 (6费 升变；离场置换由 ReplacementEngine builtin:BP01-017_LEAVE_REPLACEMENT 执行)
  {
    cardNumber: 'BP01-017',
    name: '露西亚·深红囚影',
    vanillaEntry: true,
    staticEffects: [
      {
        id: 'dsl:BP01-017:dual_equip_fengren',
        scope: 'SELF',
        canDualEquipFengren: true,
      },
    ],
  },

  // BP01-018 露西亚·深红囚影 (4费)
  {
    cardNumber: 'BP01-018',
    name: '露西亚·深红囚影',
    entry: {
      steps: [
        {
          op: 'DISCARD_COST_STEP',
          count: 1,
          optional: true,
          prompt: '【露西亚·深红囚影】丢弃 1 张手牌：抽 1 张牌（丢弃装备或信号球改为抽 2 张）',
          savePaidToVar: 'discarded',
          onPaid: [
            {
              op: 'IF',
              condition: {
                kind: 'VAR_HAS_CARD_MATCHING',
                varName: 'discarded',
                filter: {
                  anyFilters: [{ cardType: CardType.EQUIPMENT }, { isSignalOrb: true }],
                },
              },
              then: [{ op: 'DRAW', count: 2 }],
              else: [{ op: 'DRAW', count: 1 }],
            },
          ],
        },
      ],
    },
  },

  // BP01-019 露西亚·深红囚影 (3费 白板)
  { cardNumber: 'BP01-019', name: '露西亚·深红囚影', vanillaEntry: true },

  // BP01-020 绯霆—小太刀 (白板装备 PP+1000)
  { cardNumber: 'BP01-020', name: '绯霆—小太刀', vanillaEntry: true },

  // BP01-021 绯霆—大太刀 (白板装备 PP+1500)
  { cardNumber: 'BP01-021', name: '绯霆—大太刀', vanillaEntry: true },

  // BP01-022 夜煌—小太刀 (装备赋予《露西亚·深红囚影》【起】【回合1】)
  {
    cardNumber: 'BP01-022',
    name: '夜煌—小太刀',
    vanillaEntry: true,
    equipmentGrantedActivate: {
      requiredHostName: '露西亚·深红囚影',
      label: '【夜煌—小太刀】选择我方信号球区 1 张信号球视为【蓝色信号球】',
      activate: {
        oncePerTurn: true,
        condition: {
          kind: 'ZONE_COUNT',
          side: 'SELF',
          zone: 'SIGNAL_ORB',
          filter: { isSignalOrb: true },
          op: '>=',
          value: 1,
        },
        conditionError: '我方信号球区没有可选择的信号球',
        steps: [
          {
            op: 'CHOOSE_ZONE_CARDS',
            side: 'SELF',
            zone: 'SIGNAL_ORB',
            filter: { isSignalOrb: true },
            prompt: '【夜煌—小太刀】请选择我方信号球区 1 张信号球，直到回合结束为止视为【蓝色信号球】：',
            min: 1,
            max: 1,
            saveToVar: 'orb',
          },
          {
            op: 'MODIFY_STATS',
            target: { kind: 'VAR', varName: 'orb' },
            treatedAsOrbColors: ['BLUE'],
            duration: 'END_OF_TURN',
          },
        ],
      },
    },
  },

  // BP01-023 夜煌—大太刀 (装备赋予《露西亚·深红囚影》【自】【回合1】；Q&A·2/7 不付代价不计回合1，不能横置下方/装备中牌)
  {
    cardNumber: 'BP01-023',
    name: '夜煌—大太刀',
    vanillaEntry: true,
    triggers: [
      {
        abilityId: 'dsl:BP01-023:equip_attack_unblockable',
        eventType: 'ATTACK_DECLARED',
        oncePerTurn: true,
        deferOncePerTurnUntilCostPaid: true,
        matcher: {
          kind: 'EQUIPPED_ROLE_ATTACKING',
          requiredHostName: '露西亚·深红囚影',
        },
        label: '【夜煌—大太刀】攻击时可横置我方战场 1 张牌：本次攻击不被 PP<=5000 阻挡',
        steps: [
          {
            op: 'TAP_FIELD_CARD_COST_STEP',
            optional: true,
            prompt: '【夜煌—大太刀】是否横置我方战场 1 张竖直卡牌，使本次攻击不会被 PP 5000 及以下的角色阻挡？',
            onPaid: [
              { op: 'MARK_TURN_ABILITY_USED', abilityKey: '__TRIGGER_ONCE_KEY__' },
              {
                op: 'MODIFY_STATS',
                target: { kind: 'SELF' },
                unblockableMaxPP: 5000,
                duration: 'END_OF_COMBAT',
              },
            ],
          },
        ],
      },
    ],
  },

  // BP01-024 坼霆 (辅助机)
  {
    cardNumber: 'BP01-024',
    name: '坼霆',
    vanillaEntry: true,
    activate: {
      cost: {
        kind: 'TAP_SELF_AND_ELIMINATE_ORBS',
        filter: 'ANY',
        count: 1,
        prompt: '【坼霆】选择消除 1 个任意信号球并横置自身以公开牌组顶 5 张检索装备',
      },
      steps: [
        { op: 'REVEAL_TOP', count: 5, saveToVar: 'revealed' },
        {
          op: 'CHOOSE_FROM_VAR',
          varName: 'revealed',
          filter: { cardType: CardType.EQUIPMENT },
          prompt: '【坼霆】请选择最多 1 张装备加入手牌：',
          alwaysShow: true,
          min: 0,
          max: 1,
          saveToVar: 'picked',
        },
        { op: 'MOVE_CARDS', target: { kind: 'VAR', varName: 'picked' }, toZone: 'HAND' },
        {
          op: 'MOVE_CARDS',
          target: { kind: 'REST_OF_VAR', allVar: 'revealed', excludeVar: 'picked' },
          toZone: 'DECK_BOTTOM',
        },
      ],
    },
  },

  // BP01-025 归途伴风雪
  {
    cardNumber: 'BP01-025',
    name: '归途伴风雪',
    playPrecondition: {
      condition: {
        kind: 'HAS_ROLE',
        side: 'SELF',
        filter: { exactName: '露西亚·深红囚影' },
      },
      errorMessage: '该牌只能在我方战场存在《露西亚·深红囚影》时才能使用',
    },
    tactics: [
      {
        op: 'CHOOSE_ROLES',
        side: 'OPPONENT',
        prompt: '【归途伴风雪】请选择对方战场 1 张角色，直到回合结束为止使其失去能力且不能阻挡：',
        min: 1,
        max: 1,
        saveToVar: 'target',
      },
      {
        op: 'MODIFY_STATS',
        target: { kind: 'VAR', varName: 'target' },
        loseAbilities: true,
        prohibitions: ['CANNOT_BLOCK'],
        duration: 'END_OF_TURN',
      },
      {
        op: 'ELIMINATE_ORB_COST',
        filter: 'RED',
        count: 2,
        optional: true,
        prompt: '【归途伴风雪】是否追加消除 2 红色信号球，竖直我方战场 1 张《露西亚·深红囚影》？',
        onPaid: [
          {
            op: 'CHOOSE_ROLES',
            side: 'SELF',
            filter: { exactName: '露西亚·深红囚影' },
            prompt: '【归途伴风雪】请选择我方战场 1 张《露西亚·深红囚影》竖直：',
            min: 1,
            max: 1,
            saveToVar: 'untapTarget',
          },
          { op: 'SET_READY', target: { kind: 'VAR', varName: 'untapTarget' }, isReady: true },
        ],
      },
    ],
  },

  // BP01-026 凛冬
  {
    cardNumber: 'BP01-026',
    name: '凛冬',
    tactics: [
      { op: 'REVEAL_TOP', count: 7, saveToVar: 'revealed' },
      {
        op: 'CHOOSE_FROM_VAR',
        varName: 'revealed',
        filter: { exactName: '露西亚·深红囚影' },
        prompt: '【凛冬】请选择最多 1 张《露西亚·深红囚影》加入手牌：',
        alwaysShow: true,
        min: 0,
        max: 1,
        saveToVar: 'pickRole',
      },
      { op: 'MOVE_CARDS', target: { kind: 'VAR', varName: 'pickRole' }, toZone: 'HAND' },
      {
        op: 'CHOOSE_FROM_VAR',
        varName: 'revealed',
        filter: FENGREN_TACHI_EQUIP_FILTER,
        prompt: '【凛冬】请选择最多 1 张<封刃太刀>装备加入手牌：',
        alwaysShow: true,
        min: 0,
        max: 1,
        saveToVar: 'pickEquip',
      },
      { op: 'MOVE_CARDS', target: { kind: 'VAR', varName: 'pickEquip' }, toZone: 'HAND' },
      {
        op: 'MOVE_CARDS',
        target: { kind: 'REST_OF_VAR', allVar: 'revealed', excludeVar: 'pickEquip' },
        toZone: 'DECK_BOTTOM',
      },
    ],
  },

  // BP01-027 枪林弹雨 (瞬时)
  {
    cardNumber: 'BP01-027',
    name: '枪林弹雨',
    tactics: [
      {
        op: 'CHOOSE_ZONE_CARDS',
        side: 'SELF',
        zone: 'BATTLEFIELD',
        filter: { cardType: CardType.EQUIPMENT },
        prompt: '【枪林弹雨】可选择我方战场 1 张装备放置到墓地，使本次攻击不能造成伤害：',
        min: 0,
        max: 1,
        saveToVar: 'eq',
      },
      {
        op: 'IF',
        condition: { kind: 'VAR_NON_EMPTY', varName: 'eq' },
        then: [
          {
            op: 'MOVE_CARDS',
            target: { kind: 'VAR', varName: 'eq' },
            toZone: 'GRAVEYARD',
            saveMovedToVar: 'sent',
          },
          {
            op: 'IF',
            condition: { kind: 'VAR_NON_EMPTY', varName: 'sent' },
            then: [{ op: 'PREVENT_COMBAT_DAMAGE' }],
          },
        ],
      },
    ],
  },

  // =========================================================================
  // 曲·雀翎 / 万世铭体系 (BP01-028 ~ BP01-039)
  // =========================================================================

  // BP01-028 曲·雀翎 (8费 升变)
  {
    cardNumber: 'BP01-028',
    name: '曲·雀翎',
    entry: {
      steps: [
        {
          op: 'CHOOSE_ZONE_CARDS',
          side: 'SELF',
          zone: 'GRAVEYARD',
          zones: ['GRAVEYARD', 'COST'],
          filter: { trait: '万世铭' },
          prompt: '【曲·雀翎】可选择我方墓地、费用区合计最多 6 张<万世铭>加入牌组并洗切（每 2 张选择 1 项效果）：',
          min: 0,
          max: 6,
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
              op: 'CHOOSE_MODE',
              prompt: '【曲·雀翎】请从以下 3 项中选择 {pickCount} 项（不可重复）：',
              pickCountExpr: {
                kind: 'FLOOR_DIV',
                expr: { kind: 'VAR_COUNT_MULT', varName: 'returned', multiplier: 1 },
                divisor: 2,
              },
              modes: [
                {
                  id: 'charge_and_9999',
                  label: '直到回合结束为止，该牌获得【充能+1】，基本 PP 变为 9999',
                  steps: [
                    {
                      op: 'MODIFY_STATS',
                      target: { kind: 'SELF' },
                      charge: 1,
                      setBasePP: 9999,
                      duration: 'END_OF_TURN',
                    },
                  ],
                },
                {
                  id: 'dp_plus_1',
                  label: '直到回合结束为止，该牌 DP+1',
                  steps: [
                    {
                      op: 'MODIFY_STATS',
                      target: { kind: 'SELF' },
                      dp: 1,
                      duration: 'END_OF_TURN',
                    },
                  ],
                },
                {
                  id: 'grant_charge_untap',
                  label: '直到回合结束为止，获得【自】【回合1】攻击充能<万世铭>时竖直自身',
                  steps: [
                    {
                      op: 'MODIFY_STATS',
                      target: { kind: 'SELF' },
                      grantedTriggerIds: ['dsl:BP01-028:charge_wanshiming_untap'],
                      duration: 'END_OF_TURN',
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
    triggers: [
      {
        abilityId: 'dsl:BP01-028:charge_wanshiming_untap',
        eventType: 'CARD_CHARGED',
        oncePerTurn: true,
        matcher: {
          kind: 'GRANTED_ATTACK_CHARGE_CARD',
          chargedCardFilter: { trait: '万世铭' },
        },
        label: '【曲·雀翎】攻击充能<万世铭>时竖直自身 (【回合1】)',
        steps: [{ op: 'SET_READY', target: { kind: 'SELF' }, isReady: true }],
      },
    ],
  },

  // BP01-029 曲·雀翎 (5费)
  {
    cardNumber: 'BP01-029',
    name: '曲·雀翎',
    entry: {
      cost: {
        kind: 'DISCARD_HAND',
        count: 1,
        optional: true,
        prompt: '【曲·雀翎】丢弃 1 张手牌：从牌组检索 1 张<万世铭>加入手牌',
      },
      steps: [
        {
          op: 'CHOOSE_ZONE_CARDS',
          side: 'SELF',
          zone: 'DECK',
          filter: { trait: '万世铭' },
          prompt: '【曲·雀翎】请选择我方牌组 1 张<万世铭>加入手牌：',
          min: 0,
          max: 1,
          saveToVar: 'picked',
        },
        { op: 'MOVE_CARDS', target: { kind: 'VAR', varName: 'picked' }, toZone: 'HAND' },
        { op: 'SHUFFLE_DECK', side: 'SELF' },
      ],
    },
    triggers: [
      {
        abilityId: 'dsl:BP01-029:attack_or_block_recover',
        eventType: 'ATTACK_DECLARED',
        eventTypes: ['ATTACK_DECLARED', 'BLOCK_DECLARED'],
        oncePerTurn: true,
        deferOncePerTurnUntilCostPaid: true,
        matcher: { kind: 'SELF_ATTACKING_OR_BLOCKING' },
        label: '【曲·雀翎】攻击或阻挡时可消除 3 任意信号球：从墓地回收最多 2 张<万世铭>（1张回手，其余竖直放费用区顶）',
        steps: [
          {
            op: 'ELIMINATE_ORB_COST',
            filter: 'ANY',
            count: 3,
            optional: true,
            prompt: '【曲·雀翎】是否消除 3 任意信号球，选择我方墓地最多 2 张<万世铭>？',
            onPaid: [
              { op: 'MARK_TURN_ABILITY_USED', abilityKey: '__TRIGGER_ONCE_KEY__' },
              {
                op: 'CHOOSE_ZONE_CARDS',
                side: 'SELF',
                zone: 'GRAVEYARD',
                filter: { trait: '万世铭' },
                prompt: '【曲·雀翎】请选择我方墓地最多 2 张<万世铭>：',
                min: 0,
                max: 2,
                saveToVar: 'gyPicked',
              },
              {
                op: 'IF',
                condition: { kind: 'VAR_NON_EMPTY', varName: 'gyPicked' },
                then: [
                  {
                    op: 'CHOOSE_FROM_VAR',
                    varName: 'gyPicked',
                    prompt: '【曲·雀翎】请选择其中 1 张加入手牌（剩余的牌以竖直状态放置到费用区最上方）：',
                    min: 1,
                    max: 1,
                    saveToVar: 'toHand',
                  },
                  { op: 'MOVE_CARDS', target: { kind: 'VAR', varName: 'toHand' }, toZone: 'HAND' },
                  {
                    op: 'MOVE_CARDS',
                    target: { kind: 'REST_OF_VAR', allVar: 'gyPicked', excludeVar: 'toHand' },
                    toZone: 'COST',
                    isFaceUp: true,
                    isReady: true,
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  },

  // BP01-030 曲·雀翎 (6费 升变)
  {
    cardNumber: 'BP01-030',
    name: '曲·雀翎',
    entry: {
      cost: {
        kind: 'ELIMINATE_ORBS',
        filter: 'SAME',
        count: 3,
        optional: true,
        prompt: '【曲·雀翎】消除 3 同色信号球：将费用区 1 张<万世铭>送墓并从手牌出场 1 张费用<=5 的《曲·雀翎》',
      },
      steps: [
        {
          op: 'CHOOSE_ZONE_CARDS',
          side: 'SELF',
          zone: 'COST',
          filter: { trait: '万世铭' },
          prompt: '【曲·雀翎】可选择我方费用区 1 张<万世铭>放置到墓地：',
          min: 0,
          max: 1,
          saveToVar: 'costCard',
        },
        {
          op: 'IF',
          condition: { kind: 'VAR_NON_EMPTY', varName: 'costCard' },
          then: [
            {
              op: 'MOVE_CARDS',
              target: { kind: 'VAR', varName: 'costCard' },
              toZone: 'GRAVEYARD',
              saveMovedToVar: 'sent',
            },
            {
              op: 'IF',
              condition: { kind: 'VAR_NON_EMPTY', varName: 'sent' },
              then: [
                {
                  op: 'CHOOSE_ZONE_CARDS',
                  side: 'SELF',
                  zone: 'HAND',
                  filter: { exactName: '曲·雀翎', cardType: CardType.ROLE, maxCost: 5 },
                  requireEmptySlot: true,
                  prompt: '【曲·雀翎】请选择我方手牌 1 张费用 5 及以下的《曲·雀翎》出场：',
                  min: 0,
                  max: 1,
                  saveToVar: 'playRole',
                },
                {
                  op: 'MOVE_CARDS',
                  target: { kind: 'VAR', varName: 'playRole' },
                  toZone: 'BATTLEFIELD',
                },
              ],
            },
          ],
        },
      ],
    },
  },

  // BP01-031 曲·雀翎 (3费)
  {
    cardNumber: 'BP01-031',
    name: '曲·雀翎',
    entry: {
      steps: [
        { op: 'REVEAL_TOP', count: 2, saveToVar: 'revealed' },
        {
          op: 'CHOOSE_FROM_VAR',
          varName: 'revealed',
          prompt: '【曲·雀翎】请选择其中最多 1 张放置到牌组顶或墓地（其余放牌组底）：',
          alwaysShow: true,
          min: 0,
          max: 1,
          saveToVar: 'picked',
        },
        {
          op: 'IF',
          condition: { kind: 'VAR_NON_EMPTY', varName: 'picked' },
          then: [
            {
              op: 'CHOOSE_MODE',
              prompt: '【曲·雀翎】请选择所选卡牌的放置位置：',
              modes: [
                {
                  id: 'deck_top',
                  label: '放置到牌组顶',
                  steps: [{ op: 'MOVE_CARDS', target: { kind: 'VAR', varName: 'picked' }, toZone: 'DECK_TOP' }],
                },
                {
                  id: 'graveyard',
                  label: '放置到墓地',
                  steps: [{ op: 'MOVE_CARDS', target: { kind: 'VAR', varName: 'picked' }, toZone: 'GRAVEYARD' }],
                },
              ],
            },
          ],
        },
        {
          op: 'MOVE_CARDS',
          target: { kind: 'REST_OF_VAR', allVar: 'revealed', excludeVar: 'picked' },
          toZone: 'DECK_BOTTOM',
        },
      ],
    },
  },

  // BP01-032 曲·雀翎 (3费 白板)
  { cardNumber: 'BP01-032', name: '曲·雀翎', vanillaEntry: true },

  // BP01-033 曲·雀翎 (2费 【永】：【充能0】)
  { cardNumber: 'BP01-033', name: '曲·雀翎', vanillaEntry: true },

  // BP01-034 曲·雀翎 (4费)
  {
    cardNumber: 'BP01-034',
    name: '曲·雀翎',
    entry: {
      cost: {
        kind: 'DISCARD_HAND',
        count: 1,
        optional: true,
        prompt: '【曲·雀翎】丢弃 1 张手牌：公开牌组顶 3 张检索《曲·雀翎》',
      },
      steps: [
        { op: 'REVEAL_TOP', count: 3, saveToVar: 'revealed' },
        {
          op: 'CHOOSE_FROM_VAR',
          varName: 'revealed',
          filter: { exactName: '曲·雀翎' },
          prompt: '【曲·雀翎】请选择 1 张《曲·雀翎》加入手牌：',
          alwaysShow: true,
          min: 1,
          max: 1,
          saveToVar: 'picked',
        },
        { op: 'MOVE_CARDS', target: { kind: 'VAR', varName: 'picked' }, toZone: 'HAND' },
        {
          op: 'MOVE_CARDS',
          target: { kind: 'REST_OF_VAR', allVar: 'revealed', excludeVar: 'picked' },
          toZone: 'DECK_BOTTOM',
        },
      ],
    },
  },

  // BP01-035 曲·雀翎 (4费 【起】【回合1】)
  {
    cardNumber: 'BP01-035',
    name: '曲·雀翎',
    vanillaEntry: true,
    activate: {
      oncePerTurn: true,
      cost: {
        kind: 'DISCARD_HAND',
        count: 1,
        filter: { trait: '万世铭' },
        prompt: '【曲·雀翎】请选择丢弃手牌 1 张<万世铭>：',
      },
      steps: [
        {
          op: 'CHOOSE_MODE',
          prompt: '【曲·雀翎】请从以下 2 项选择 1 项：',
          modes: [
            {
              id: 'charge_plus_1',
              label: '直到回合结束为止，该牌获得【充能+1】',
              steps: [{ op: 'MODIFY_STATS', target: { kind: 'SELF' }, charge: 1, duration: 'END_OF_TURN' }],
            },
            {
              id: 'pp_plus_2000',
              label: '直到回合结束为止，该牌 PP+2000',
              steps: [{ op: 'MODIFY_STATS', target: { kind: 'SELF' }, pp: 2000, duration: 'END_OF_TURN' }],
            },
          ],
        },
      ],
    },
  },

  // BP01-036 青赫 (装备赋予《曲·雀翎》【自】【回合1】)
  {
    cardNumber: 'BP01-036',
    name: '青赫',
    vanillaEntry: true,
    triggers: [
      {
        abilityId: 'dsl:BP01-036:equip_attack_scry3',
        eventType: 'ATTACK_DECLARED',
        oncePerTurn: true,
        deferOncePerTurnUntilCostPaid: true,
        matcher: {
          kind: 'EQUIPPED_ROLE_ATTACKING',
          requiredHostName: '曲·雀翎',
        },
        label: '【青赫】攻击时可弃 1 牌：公开牌组顶 3 张选最多 1 张置顶或送墓，其余置底',
        steps: [
          {
            op: 'DISCARD_COST_STEP',
            count: 1,
            optional: true,
            prompt: '【青赫】是否丢弃 1 张手牌以公开我方牌组顶 3 张牌？',
            onPaid: [
              { op: 'MARK_TURN_ABILITY_USED', abilityKey: '__TRIGGER_ONCE_KEY__' },
              { op: 'REVEAL_TOP', count: 3, saveToVar: 'revealed' },
              {
                op: 'CHOOSE_FROM_VAR',
                varName: 'revealed',
                prompt: '【青赫】请选择其中最多 1 张放置到牌组顶或墓地（其余放牌组底）：',
                alwaysShow: true,
                min: 0,
                max: 1,
                saveToVar: 'picked',
              },
              {
                op: 'IF',
                condition: { kind: 'VAR_NON_EMPTY', varName: 'picked' },
                then: [
                  {
                    op: 'CHOOSE_MODE',
                    prompt: '【青赫】请选择所选卡牌的放置位置：',
                    modes: [
                      {
                        id: 'deck_top',
                        label: '放置到牌组顶',
                        steps: [{ op: 'MOVE_CARDS', target: { kind: 'VAR', varName: 'picked' }, toZone: 'DECK_TOP' }],
                      },
                      {
                        id: 'graveyard',
                        label: '放置到墓地',
                        steps: [{ op: 'MOVE_CARDS', target: { kind: 'VAR', varName: 'picked' }, toZone: 'GRAVEYARD' }],
                      },
                    ],
                  },
                ],
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
    ],
  },

  // BP01-037 万世铭 (1费 战术；因<曲>入处理区改放横置费用区由 ZoneManager + Interpreter 统一处理)
  {
    cardNumber: 'BP01-037',
    name: '万世铭',
    playPrecondition: {
      condition: { kind: 'HAS_ROLE', side: 'SELF', filter: { trait: '曲' } },
      errorMessage: '该牌只能在我方战场存在<曲>角色时才能使用',
    },
    tactics: [
      {
        op: 'CHOOSE_ZONE_CARDS',
        side: 'SELF',
        zone: 'SIGNAL_ORB',
        filter: { isSignalOrb: true },
        prompt: '【万世铭】请选择我方信号球区 1 张信号球，直到回合结束为止视为 3 个相同信号球：',
        min: 1,
        max: 1,
        saveToVar: 'orb',
      },
      {
        op: 'MODIFY_STATS',
        target: { kind: 'VAR', varName: 'orb' },
        orbValue: 3,
        duration: 'END_OF_TURN',
      },
    ],
  },

  // BP01-038 万世铭·重铸 (1费 战术；同享<曲>入处理区置换)
  {
    cardNumber: 'BP01-038',
    name: '万世铭·重铸',
    playPrecondition: {
      condition: { kind: 'HAS_ROLE', side: 'SELF', filter: { trait: '曲' } },
      errorMessage: '该牌只能在我方战场存在<曲>角色时才能使用',
    },
    tactics: [
      {
        op: 'CHOOSE_ZONE_CARDS',
        side: 'SELF',
        zone: 'GRAVEYARD',
        filter: { isSignalOrb: true },
        prompt: '【万世铭·重铸】请选择我方墓地 1 张信号球放置到我方信号球区任意位置：',
        min: 1,
        max: 1,
        saveToVar: 'orb',
      },
      {
        op: 'PLACE_ORB_AT_POSITION',
        varName: 'orb',
        prompt: '【万世铭·重铸】请选择将该信号球放置到信号球区的哪个位置：',
      },
    ],
  },

  // BP01-039 自由 (4费 战术)
  {
    cardNumber: 'BP01-039',
    name: '自由',
    tactics: [
      {
        op: 'CHOOSE_ROLES',
        side: 'OPPONENT',
        prompt: '【自由】请选择对方战场 1 张角色，将其以横置状态放置到对方费用区：',
        min: 1,
        max: 1,
        saveToVar: 'oppRole',
      },
      {
        op: 'MOVE_CARDS',
        target: { kind: 'VAR', varName: 'oppRole' },
        toZone: 'COST',
        isFaceUp: true,
        isReady: false,
      },
      {
        op: 'CHOOSE_ZONE_CARDS',
        side: 'SELF',
        zone: 'COST',
        filter: { trait: '万世铭' },
        prompt: '【自由】请选择我方费用区 1 张<万世铭>竖直：',
        min: 1,
        max: 1,
        saveToVar: 'costCard',
      },
      {
        op: 'SET_READY',
        target: { kind: 'VAR', varName: 'costCard' },
        isReady: true,
      },
    ],
  },

  // =========================================================================
  // 赛琳娜·希声 / 梦赴光寥之乡体系 (BP01-056 / 056a / 056b / BP01-057 ~ BP01-068)
  // =========================================================================

  createDreamLandSpec('BP01-056'),
  createDreamLandSpec('BP01-056a'),
  createDreamLandSpec('BP01-056b'),

  // BP01-057 赛琳娜·希声 (8费 升变)
  {
    cardNumber: 'BP01-057',
    name: '赛琳娜·希声',
    vanillaEntry: true,
    triggers: [
      {
        abilityId: 'dsl:BP01-057:attack_end_untap',
        eventType: 'ATTACK_ENDED',
        oncePerTurn: true,
        deferOncePerTurnUntilCostPaid: true,
        matcher: { kind: 'SELF_ATTACK_END' },
        label: '【赛琳娜·希声】攻击结束时可丢弃 2 张《梦赴光寥之乡》：竖直自身、PP+2000、DP+1',
        steps: [
          {
            op: 'DISCARD_COST_STEP',
            count: 2,
            filter: { exactName: '梦赴光寥之乡' },
            optional: true,
            prompt: '【赛琳娜·希声】是否丢弃手牌 2 张《梦赴光寥之乡》，使该牌竖直并 PP+2000、DP+1？',
            onPaid: [
              { op: 'MARK_TURN_ABILITY_USED', abilityKey: '__TRIGGER_ONCE_KEY__' },
              { op: 'SET_READY', target: { kind: 'SELF' }, isReady: true },
              {
                op: 'MODIFY_STATS',
                target: { kind: 'SELF' },
                pp: 2000,
                dp: 1,
                duration: 'END_OF_TURN',
              },
            ],
          },
        ],
      },
    ],
  },

  // BP01-058 赛琳娜·希声 (6费 升变；两条独立【出】能力依次询问)
  {
    cardNumber: 'BP01-058',
    name: '赛琳娜·希声',
    entry: {
      steps: [
        {
          op: 'DISCARD_COST_STEP',
          count: 2,
          optional: true,
          prompt: '【赛琳娜·希声】【出1】丢弃 2 张手牌：从墓地回收 1 张《梦赴光寥之乡》',
          onPaid: [
            {
              op: 'CHOOSE_ZONE_CARDS',
              side: 'SELF',
              zone: 'GRAVEYARD',
              filter: { exactName: '梦赴光寥之乡' },
              prompt: '【赛琳娜·希声】请选择我方墓地 1 张《梦赴光寥之乡》加入手牌：',
              min: 1,
              max: 1,
              saveToVar: 'gyDream',
            },
            { op: 'MOVE_CARDS', target: { kind: 'VAR', varName: 'gyDream' }, toZone: 'HAND' },
          ],
        },
        {
          op: 'DISCARD_COST_STEP',
          count: 2,
          filter: { exactName: '梦赴光寥之乡' },
          optional: true,
          prompt: '【赛琳娜·希声】【出2】丢弃 2 张《梦赴光寥之乡》：将对方战场 1 张费用<=3 的角色放回牌组底',
          onPaid: [
            {
              op: 'CHOOSE_ROLES',
              side: 'OPPONENT',
              filter: { maxCost: 3 },
              prompt: '【赛琳娜·希声】请选择对方战场 1 张费用 3 及以下的角色放置到对方牌组底：',
              min: 1,
              max: 1,
              saveToVar: 'oppBottom',
            },
            { op: 'MOVE_CARDS', target: { kind: 'VAR', varName: 'oppBottom' }, toZone: 'DECK_BOTTOM' },
          ],
        },
      ],
    },
  },

  // BP01-059 赛琳娜·希声 (7费)
  {
    cardNumber: 'BP01-059',
    name: '赛琳娜·希声',
    vanillaEntry: true,
    handCostDiscount: {
      zone: 'GRAVEYARD',
      filter: { exactName: '梦赴光寥之乡' },
      discountPerCard: 1,
    },
    activate: {
      oncePerTurn: true,
      condition: {
        kind: 'ZONE_COUNT',
        side: 'SELF',
        zone: 'HAND',
        filter: { exactName: '梦赴光寥之乡' },
        op: '>=',
        value: 1,
      },
      conditionError: '手牌中没有《梦赴光寥之乡》，无法发动起动能力',
      steps: [
        {
          op: 'DISCARD_COST_STEP',
          minCount: 1,
          count: 2,
          filter: { exactName: '梦赴光寥之乡' },
          optional: false,
          prompt: '【赛琳娜·希声】请选择丢弃手牌 1~2 张《梦赴光寥之乡》（每丢弃 1 张从 2 项中选 1 项）：',
          savePaidToVar: 'discarded',
          onPaid: [
            {
              op: 'CHOOSE_MODE',
              prompt: '【赛琳娜·希声】请从以下 2 项中选择 {pickCount} 项（不可重复）：',
              pickCountExpr: { kind: 'VAR_COUNT_MULT', varName: 'discarded', multiplier: 1 },
              modes: [
                {
                  id: 'pierce',
                  label: '直到回合结束为止，该牌获得【贯通】',
                  steps: [{ op: 'MODIFY_STATS', target: { kind: 'SELF' }, keywords: ['贯通'], duration: 'END_OF_TURN' }],
                },
                {
                  id: 'pp_plus_2000',
                  label: '直到回合结束为止，该牌 PP+2000',
                  steps: [{ op: 'MODIFY_STATS', target: { kind: 'SELF' }, pp: 2000, duration: 'END_OF_TURN' }],
                },
              ],
            },
          ],
        },
      ],
    },
  },

  // BP01-060 赛琳娜·希声 (3费)
  {
    cardNumber: 'BP01-060',
    name: '赛琳娜·希声',
    entry: {
      steps: [
        {
          op: 'CHOOSE_ZONE_CARDS',
          side: 'SELF',
          zone: 'DECK',
          filter: { exactName: '梦赴光寥之乡' },
          prompt: '【赛琳娜·希声】请选择我方牌组最多 1 张《梦赴光寥之乡》放置到墓地：',
          min: 0,
          max: 1,
          saveToVar: 'picked',
        },
        { op: 'MOVE_CARDS', target: { kind: 'VAR', varName: 'picked' }, toZone: 'GRAVEYARD' },
        { op: 'SHUFFLE_DECK', side: 'SELF' },
      ],
    },
  },

  // BP01-061 赛琳娜·希声 (4费)
  {
    cardNumber: 'BP01-061',
    name: '赛琳娜·希声',
    vanillaEntry: true,
    triggers: [
      {
        abilityId: 'dsl:BP01-061:attack_scry2',
        eventType: 'ATTACK_DECLARED',
        condition: {
          kind: 'ZONE_COUNT',
          side: 'SELF',
          zone: 'GRAVEYARD',
          filter: { exactName: '梦赴光寥之乡' },
          op: '>=',
          value: 1,
        },
        matcher: { kind: 'SELF_ATTACKING' },
        label: '【赛琳娜·希声】攻击时可查看牌组顶最多 2 张，选最多 1 张置顶，其余置底',
        steps: [
          {
            op: 'CONFIRM_YES_NO',
            prompt: '【赛琳娜·希声】是否查看我方牌组顶最多 2 张牌？',
            yesLabel: '查看牌组顶 2 张',
            noLabel: '不查看',
            onYes: [
              { op: 'REVEAL_TOP', count: 2, saveToVar: 'topCards' },
              {
                op: 'CHOOSE_FROM_VAR',
                varName: 'topCards',
                prompt: '【赛琳娜·希声】请选择最多 1 张放置到牌组顶（其余放置到牌组底）：',
                alwaysShow: true,
                min: 0,
                max: 1,
                saveToVar: 'keepTop',
              },
              { op: 'MOVE_CARDS', target: { kind: 'VAR', varName: 'keepTop' }, toZone: 'DECK_TOP' },
              {
                op: 'MOVE_CARDS',
                target: { kind: 'REST_OF_VAR', allVar: 'topCards', excludeVar: 'keepTop' },
                toZone: 'DECK_BOTTOM',
              },
            ],
          },
        ],
      },
    ],
  },

  // BP01-062 赛琳娜·希声 (5费 【起】【回合1】)
  {
    cardNumber: 'BP01-062',
    name: '赛琳娜·希声',
    vanillaEntry: true,
    activate: {
      oncePerTurn: true,
      condition: {
        kind: 'ZONE_COUNT',
        side: 'SELF',
        zone: 'HAND',
        op: '>=',
        value: 1,
      },
      conditionError: '手牌不足 1 张，无法支付丢弃代价',
      steps: [
        {
          op: 'DISCARD_COST_STEP',
          count: 1,
          optional: false,
          prompt: '【赛琳娜·希声】请选择丢弃 1 张手牌（丢弃《梦赴光寥之乡》改为获得【突进】且 PP-1000）：',
          savePaidToVar: 'discarded',
          onPaid: [
            {
              op: 'IF',
              condition: {
                kind: 'VAR_HAS_CARD_MATCHING',
                varName: 'discarded',
                filter: { exactName: '梦赴光寥之乡' },
              },
              then: [
                {
                  op: 'MODIFY_STATS',
                  target: { kind: 'SELF' },
                  keywords: ['突进'],
                  pp: -1000,
                  duration: 'END_OF_TURN',
                },
              ],
              else: [
                {
                  op: 'MODIFY_STATS',
                  target: { kind: 'SELF' },
                  pp: 1000,
                  duration: 'END_OF_TURN',
                },
              ],
            },
          ],
        },
      ],
    },
  },

  // BP01-063 赛琳娜·希声 (2费 白板)
  { cardNumber: 'BP01-063', name: '赛琳娜·希声', vanillaEntry: true },

  // BP01-064 赛琳娜·希声 (4费 白板)
  { cardNumber: 'BP01-064', name: '赛琳娜·希声', vanillaEntry: true },

  // BP01-065 一碰即碎的花火 (瞬时)
  {
    cardNumber: 'BP01-065',
    name: '一碰即碎的花火',
    tactics: [
      {
        op: 'IF',
        condition: {
          kind: 'ZONE_COUNT',
          side: 'SELF',
          zone: 'GRAVEYARD',
          filter: { exactName: '梦赴光寥之乡' },
          op: '>=',
          value: 2,
        },
        then: [
          {
            op: 'CONFIRM_YES_NO',
            prompt: '【一碰即碎的花火】是否将我方墓地 2 张《梦赴光寥之乡》加入牌组并洗切，使那次攻击不能造成伤害？',
            yesLabel: '洗回 2 张并防止伤害',
            noLabel: '不洗回',
            onYes: [
              {
                op: 'CHOOSE_ZONE_CARDS',
                side: 'SELF',
                zone: 'GRAVEYARD',
                filter: { exactName: '梦赴光寥之乡' },
                prompt: '【一碰即碎的花火】请选择我方墓地 2 张《梦赴光寥之乡》加入牌组并洗切：',
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
                condition: { kind: 'VAR_NON_EMPTY', varName: 'returned' },
                then: [{ op: 'PREVENT_COMBAT_DAMAGE' }],
              },
            ],
          },
        ],
      },
    ],
  },

  // BP01-066 独奏领域 (2费 战术)
  {
    cardNumber: 'BP01-066',
    name: '独奏领域',
    tactics: [
      {
        op: 'IF',
        condition: {
          kind: 'ZONE_COUNT',
          side: 'SELF',
          zone: 'GRAVEYARD',
          filter: {
            anyFilters: [{ exactName: '赛琳娜·希声' }, { exactName: '梦赴光寥之乡' }],
          },
          op: '>=',
          value: 4,
        },
        then: [
          {
            op: 'CONFIRM_YES_NO',
            prompt: '【独奏领域】是否将我方墓地合计 4 张《赛琳娜·希声》或《梦赴光寥之乡》加入牌组并洗切以抽 2 张牌？',
            yesLabel: '洗回 4 张并抽 2 牌',
            noLabel: '不洗回',
            onYes: [
              {
                op: 'CHOOSE_ZONE_CARDS',
                side: 'SELF',
                zone: 'GRAVEYARD',
                filter: {
                  anyFilters: [{ exactName: '赛琳娜·希声' }, { exactName: '梦赴光寥之乡' }],
                },
                prompt: '【独奏领域】请选择我方墓地合计 4 张《赛琳娜·希声》或《梦赴光寥之乡》加入牌组并洗切：',
                min: 4,
                max: 4,
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
                condition: { kind: 'VAR_NON_EMPTY', varName: 'returned' },
                then: [{ op: 'DRAW', count: 2 }],
              },
            ],
          },
        ],
      },
    ],
  },

  // BP01-067 最后的晚空 (6费 战术；使用时丢弃手牌《梦赴光寥之乡》减费由 engine.ts PLAY_CARD_DISCARD_DISCOUNT 结算)
  {
    cardNumber: 'BP01-067',
    name: '最后的晚空',
    playDiscardDiscount: {
      filter: { exactName: '梦赴光寥之乡' },
      discountPerCard: 1,
      prompt: '【最后的晚空】可丢弃手牌任意数量的《梦赴光寥之乡》，每丢弃 1 张该牌费用-1：',
    },
    tactics: [
      {
        op: 'CHOOSE_ROLES',
        side: 'OPPONENT',
        prompt: '【最后的晚空】请选择对方战场 1 张角色放置到对方牌组底：',
        min: 1,
        max: 1,
        saveToVar: 'opp',
      },
      { op: 'MOVE_CARDS', target: { kind: 'VAR', varName: 'opp' }, toZone: 'DECK_BOTTOM' },
    ],
  },

  // BP01-068 奥菲厄斯的摇篮 (3费 装备 PP+1000)
  {
    cardNumber: 'BP01-068',
    name: '奥菲厄斯的摇篮',
    entry: {
      steps: [
        {
          op: 'CHOOSE_ZONE_CARDS',
          side: 'SELF',
          zone: 'GRAVEYARD',
          filter: { exactName: '梦赴光寥之乡' },
          prompt: '【奥菲厄斯的摇篮】请选择我方墓地 1 张《梦赴光寥之乡》加入手牌：',
          min: 1,
          max: 1,
          saveToVar: 'picked',
        },
        { op: 'MOVE_CARDS', target: { kind: 'VAR', varName: 'picked' }, toZone: 'HAND' },
      ],
    },
  },
];

import { CardType } from '@zhanshuang/shared';
import type { CardEffectSpec } from '../types.js';

/**
 * ST02 升格者官方预组 (14 张) 声明式效果描述
 */
export const ST02_EFFECT_SPECS: readonly CardEffectSpec[] = [
  {
    cardNumber: 'ST02-001',
    name: '露娜·银冕',
    vanillaEntry: true,
    // 【永】：若我方侵蚀计数为5及以上，我方战场所有<升格者>角色PP+1000。
    staticEffects: [
      {
        id: 'ST02-001_EROSION5_AURA',
        scope: 'ALL_FRIENDLY_ROLES',
        targetFilter: { trait: '升格者' },
        condition: { kind: 'EROSION_COMPARE', side: 'SELF', op: '>=', value: 5 },
        pp: 1000,
        dependsOnTraits: true,
      },
    ],
    // 【起】【回合1】消除【2蓝色信号球】：选择我方墓地1张费用为4及以下的<升格者>角色，将其出场。
    activate: {
      oncePerTurn: true,
      cost: {
        kind: 'ELIMINATE_ORBS',
        filter: 'BLUE',
        count: 2,
        optional: false,
        choiceEffectType: 'PRESET_ORB_COST',
      },
      steps: [
        {
          op: 'CHOOSE_ZONE_CARDS',
          side: 'SELF',
          zone: 'GRAVEYARD',
          prompt: '【露娜·银冕】选择我方墓地1张费用为4及以下的<升格者>角色出场',
          filter: { cardType: CardType.ROLE, trait: '升格者', maxCost: 4 },
          requireEmptySlot: true,
          ineligibleReason: '战场没有空余卡位',
          saveToVar: 'revive',
          choiceEffectType: 'PRESET_DEPLOY',
        },
        { op: 'MOVE_CARDS', target: { kind: 'VAR', varName: 'revive' }, toZone: 'BATTLEFIELD', triggerEntry: true },
      ],
    },
  },
  { cardNumber: 'ST02-002', name: '露娜·银冕', vanillaEntry: true },
  {
    cardNumber: 'ST02-003',
    name: '露娜·银冕',
    // 【出】丢弃1张手牌：公开我方牌组顶3张牌，选择其中1张<升格者>角色加入手牌，将剩余的牌放置到墓地。
    entry: {
      cost: {
        kind: 'DISCARD_HAND',
        count: 1,
        optional: true,
        prompt: '【露娜·银冕】【出】是否丢弃1张手牌：公开牌组顶3张，选择其中1张<升格者>角色加入手牌？',
        choiceEffectType: 'PRESET_DISCARD_COST',
      },
      steps: [
        { op: 'REVEAL_TOP', count: 3, saveToVar: 'revealed' },
        {
          op: 'CHOOSE_FROM_VAR',
          varName: 'revealed',
          prompt: '【露娜·银冕】选择其中1张<升格者>角色加入手牌 (剩余的牌放置到墓地)',
          filter: { cardType: CardType.ROLE, trait: '升格者' },
          alwaysShow: true,
          min: 1,
          max: 1,
          saveToVar: 'picked',
          choiceEffectType: 'PRESET_ST02_003_PICK',
        },
        { op: 'MOVE_CARDS', target: { kind: 'VAR', varName: 'picked' }, toZone: 'HAND' },
        { op: 'MOVE_CARDS', target: { kind: 'REST_OF_VAR', allVar: 'revealed', excludeVar: 'picked' }, toZone: 'GRAVEYARD' },
      ],
    },
  },
  {
    cardNumber: 'ST02-004',
    name: '露娜·银冕',
    vanillaEntry: true,
    // 【永】：若我方墓地为10张及以上，该牌PP+1500。
    staticEffects: [
      {
        id: 'ST02-004_GRAVEYARD10_PP',
        scope: 'SELF',
        condition: { kind: 'ZONE_COUNT', side: 'SELF', zone: 'GRAVEYARD', op: '>=', value: 10 },
        pp: 1500,
      },
    ],
  },
  { cardNumber: 'ST02-005', name: '露娜·银冕', vanillaEntry: true },
  {
    cardNumber: 'ST02-006',
    name: '露娜·银冕',
    // 【永】：若我方侵蚀计数为4及以上，该牌PP+1000。
    staticEffects: [
      {
        id: 'ST02-006_EROSION4_PP',
        scope: 'SELF',
        condition: { kind: 'EROSION_COMPARE', side: 'SELF', op: '>=', value: 4 },
        pp: 1000,
      },
    ],
    // 【出】：将我方信号球区的牌按任意顺序排列。
    entry: {
      steps: [
        {
          op: 'REORDER_ZONE',
          zone: 'SIGNAL_ORB',
          prompt: '【露娜·银冕】【出】按从下到上的顺序依次点选信号球区的全部 {orbCount} 张牌，以重新排列',
          choiceEffectType: 'PRESET_ST02_006_ORDER',
        },
      ],
    },
  },
  {
    cardNumber: 'ST02-007',
    name: '不明构造体α',
    // 【出】丢弃1张手牌：选择我方墓地1张<升格者>角色，将其加入手牌。
    entry: {
      cost: {
        kind: 'DISCARD_HAND',
        count: 1,
        optional: true,
        prompt: '【不明构造体α】【出】是否丢弃1张手牌：选择墓地1张<升格者>角色加入手牌？',
        choiceEffectType: 'PRESET_DISCARD_COST',
      },
      steps: [
        {
          op: 'CHOOSE_ZONE_CARDS',
          side: 'SELF',
          zone: 'GRAVEYARD',
          prompt: '【不明构造体α】选择我方墓地1张<升格者>角色加入手牌',
          filter: { cardType: CardType.ROLE, trait: '升格者' },
          saveToVar: 'picked',
          choiceEffectType: 'PRESET_TO_HAND',
        },
        { op: 'MOVE_CARDS', target: { kind: 'VAR', varName: 'picked' }, toZone: 'HAND' },
      ],
    },
  },
  {
    cardNumber: 'ST02-008',
    name: '苦刑之女',
    vanillaEntry: true,
    // 【永】：若我方战场存在<升格者>角色，该牌PP+1000。
    staticEffects: [
      {
        id: 'ST02-008_ASCENDANT_PP',
        scope: 'SELF',
        condition: { kind: 'HAS_ROLE', side: 'SELF', filter: { trait: '升格者' } },
        pp: 1000,
        dependsOnTraits: true,
      },
    ],
    // 【起】【回合1】消除【任意信号球】：可以将我方侵蚀计数+1。若如此做，直到回合结束为止，该牌DP+1。
    activate: {
      oncePerTurn: true,
      cost: {
        kind: 'ELIMINATE_ORBS',
        filter: 'ANY',
        count: 1,
        optional: false,
        choiceEffectType: 'PRESET_ORB_COST',
      },
      steps: [
        {
          op: 'CONFIRM_YES_NO',
          prompt: '【苦刑之女】是否将我方侵蚀计数+1？若如此做，直到回合结束为止，该牌 DP+1',
          yesLabel: '侵蚀计数+1，DP+1',
          noLabel: '不执行',
          choiceEffectType: 'PRESET_ST02_008_EROSION',
          onYes: [
            { op: 'CHANGE_EROSION', side: 'SELF', delta: 1 },
            { op: 'MODIFY_STATS', target: { kind: 'SELF' }, dp: 1, duration: 'END_OF_TURN' },
          ],
        },
      ],
    },
  },
  {
    cardNumber: 'ST02-009',
    name: '奥兹玛',
    // 【永】：若装备角色为《露娜·银冕》，则其获得“【自】：该牌攻击时，可以消除2同色信号球。若如此做，选择对方战场1张角色，直到回合结束为止，其PP-4000。”
    triggers: [
      {
        abilityId: 'ST02_009_OZMA_ON_ATTACK',
        eventType: 'ATTACK_DECLARED',
        matcher: { kind: 'EQUIPPED_ROLE_ATTACKING', requiredHostName: '露娜·银冕' },
        label: '【奥兹玛】攻击时：消除2张同色信号球，对方1张角色PP-4000',
        cost: {
          kind: 'ELIMINATE_ORBS',
          filter: 'SAME',
          count: 2,
          optional: true,
          prompt: '【奥兹玛】攻击时，是否消除2张相邻的同色信号球：选择对方战场1张角色 PP-4000？',
          choiceEffectType: 'PRESET_ORB_COST',
        },
        steps: [
          {
            op: 'CHOOSE_ROLES',
            side: 'OPPONENT',
            prompt: '【奥兹玛】选择对方战场1张角色，直到回合结束为止 PP-4000',
            saveToVar: 'target',
            choiceEffectType: 'PRESET_ST02_009_TARGET',
          },
          {
            op: 'MODIFY_STATS',
            target: { kind: 'VAR', varName: 'target' },
            pp: -4000,
            duration: 'END_OF_TURN',
            source: 'ST02-009',
          },
        ],
      },
    ],
  },
  {
    cardNumber: 'ST02-010',
    name: '刹那制裁',
    // 该牌只能在我方战场存在《露娜·银冕》时才能使用。选择对方战场1张角色，直到回合结束为止，我方侵蚀计数每有1，其PP-2000。
    playPrecondition: {
      condition: { kind: 'HAS_ROLE', side: 'SELF', filter: { exactName: '露娜·银冕' } },
      errorMessage: '该牌只能在我方战场存在《露娜·银冕》时才能使用',
    },
    tactics: [
      {
        op: 'CHOOSE_ROLES',
        side: 'OPPONENT',
        prompt: '【刹那制裁】选择对方战场1张角色，直到回合结束为止 PP-{erosion*2000}',
        saveToVar: 'target',
        choiceEffectType: 'PRESET_PP_DOWN',
      },
      {
        op: 'MODIFY_STATS',
        target: { kind: 'VAR', varName: 'target' },
        pp: { kind: 'EROSION_MULT', side: 'SELF', multiplier: -2000 },
        duration: 'END_OF_TURN',
      },
    ],
  },
  {
    cardNumber: 'ST02-011',
    name: '筛选开始',
    // 该牌只能在我方战场存在《露娜·银冕》时才能使用。【瞬时】：我方玩家被攻击时才能发动。
    // 选择我方墓地1张费用为3及以下的<升格者>角色，将其出场。若我方侵蚀计数为4及以下，则其获得“【自】：该回合结束时，将该牌放置到墓地。”
    playPrecondition: {
      condition: { kind: 'HAS_ROLE', side: 'SELF', filter: { exactName: '露娜·银冕' } },
      errorMessage: '该牌只能在我方战场存在《露娜·银冕》时才能使用',
    },
    tactics: [
      {
        op: 'CHOOSE_ZONE_CARDS',
        side: 'SELF',
        zone: 'GRAVEYARD',
        prompt: '【筛选开始】选择我方墓地1张费用为3及以下的<升格者>角色出场',
        filter: { cardType: CardType.ROLE, trait: '升格者', maxCost: 3 },
        requireEmptySlot: true,
        ineligibleReason: '战场没有空余卡位',
        saveToVar: 'revived',
        choiceEffectType: 'PRESET_ST02_011_REVIVE',
      },
      {
        op: 'MOVE_CARDS',
        target: { kind: 'VAR', varName: 'revived' },
        toZone: 'BATTLEFIELD',
        triggerEntry: true,
        saveMovedToVar: 'deployed',
      },
      {
        op: 'IF',
        condition: {
          kind: 'ALL',
          conditions: [
            { kind: 'VAR_NON_EMPTY', varName: 'deployed' },
            { kind: 'EROSION_COMPARE', side: 'SELF', op: '<=', value: 4 },
          ],
        },
        then: [
          {
            op: 'REGISTER_DELAYED_TRIGGER',
            target: { kind: 'VAR', varName: 'deployed' },
            eventType: 'END_PHASE_TRIGGERS',
            turnOffset: 0,
            abilityId: 'DELAYED_END_OF_TURN_TO_GRAVEYARD',
            labelSuffix: '该回合结束时放置到墓地 (ST02-011)',
            markLegacyEndOfTurnToGraveyard: true,
          },
        ],
      },
    ],
  },
  { cardNumber: 'ST02-012', name: '涡旋极星', isSignalOrbCard: true },
  { cardNumber: 'ST02-013', name: '南十字星', isSignalOrbCard: true },
  { cardNumber: 'ST02-014', name: '苦难咫尺', isSignalOrbCard: true },
];

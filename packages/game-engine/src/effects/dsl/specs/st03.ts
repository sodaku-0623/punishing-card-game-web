import { CardType } from '@zhanshuang/shared';
import type { CardEffectSpec } from '../types.js';

/**
 * ST03 三头犬小队官方预组 (14 张) 声明式效果描述
 */
export const ST03_EFFECT_SPECS: readonly CardEffectSpec[] = [
  {
    cardNumber: 'ST03-001',
    name: '薇拉·瑰丽',
    // 【出】消除2同色信号球：选择我方战场1张<三头犬小队>角色，将其竖直。直到回合结束为止，我方战场所有<三头犬小队>角色PP+2000。
    entry: {
      cost: {
        kind: 'ELIMINATE_ORBS',
        filter: 'SAME',
        count: 2,
        optional: true,
        prompt: '【薇拉·瑰丽】【出】是否消除2张相邻的同色信号球：竖直1张<三头犬小队>角色，所有<三头犬小队>角色 PP+2000？',
        choiceEffectType: 'PRESET_ORB_COST',
      },
      steps: [
        {
          op: 'CHOOSE_ROLES',
          side: 'SELF',
          prompt: '【薇拉·瑰丽】选择我方战场1张<三头犬小队>角色竖直',
          filter: { trait: '三头犬小队' },
          saveToVar: 'readyTarget',
          choiceEffectType: 'PRESET_ST03_001_READY',
        },
        { op: 'SET_READY', target: { kind: 'VAR', varName: 'readyTarget' }, isReady: true },
        {
          op: 'MODIFY_STATS',
          target: { kind: 'ALL_MATCHING_ROLES', side: 'SELF', filter: { trait: '三头犬小队' } },
          pp: 2000,
          duration: 'END_OF_TURN',
        },
      ],
    },
  },
  {
    cardNumber: 'ST03-002',
    name: '薇拉·瑰丽',
    vanillaEntry: true,
    // 【永】：对方回合中，我方战场所有横置状态的<三头犬小队>角色PP+1000。
    staticEffects: [
      {
        id: 'ST03-002_OPP_TURN_TAPPED_AURA',
        scope: 'ALL_FRIENDLY_ROLES',
        targetFilter: { trait: '三头犬小队', isReady: false },
        condition: { kind: 'TURN_OWNER', isSelfTurn: false },
        pp: 1000,
        dependsOnTraits: true,
      },
    ],
    // 【起】横置该牌：直到回合结束为止，我方使用的下1张<三头犬小队>角色的费用-2 (不包含升变费用)
    activate: {
      cost: { kind: 'TAP_SELF' },
      steps: [
        {
          op: 'ADD_COST_MODIFIER',
          amount: 2,
          targetTrait: '三头犬小队',
          cardType: CardType.ROLE,
          excludeAscension: true,
          remainingCount: 1,
          logText: '横置该牌：下1张<三头犬小队>角色费用-2',
        },
      ],
    },
  },
  {
    cardNumber: 'ST03-003',
    name: '薇拉·瑰丽',
    // 【出】消除【任意信号球】或丢弃1张手牌：公开我方牌组顶5张牌。选择其中最多1张<21号>和最多1张<诺克提>加入手牌，将剩余的牌放置到墓地。
    entry: {
      cost: {
        kind: 'ELIMINATE_ORB_OR_DISCARD_HAND',
        optional: true,
        prompt: '【薇拉·瑰丽】【出】是否消除1张信号球或丢弃1张手牌：公开牌组顶5张，选择最多1张<21号>和最多1张<诺克提>加入手牌？',
        choiceEffectType: 'PRESET_ST03_003_COST',
      },
      steps: [
        { op: 'REVEAL_TOP', count: 5, saveToVar: 'revealed' },
        {
          op: 'CHOOSE_FROM_VAR',
          varName: 'revealed',
          prompt: '【薇拉·瑰丽】选择其中最多1张<21号>和最多1张<诺克提>加入手牌 (剩余的牌放置到墓地)',
          filter: { anyTraits: ['21号', '诺克提'] },
          distinctTraits: ['21号', '诺克提'],
          distinctTraitsError: '只能选择最多1张<21号>和最多1张<诺克提>',
          alwaysShow: true,
          min: 0,
          max: 2,
          saveToVar: 'picked',
          choiceEffectType: 'PRESET_ST03_003_PICK',
        },
        { op: 'MOVE_CARDS', target: { kind: 'VAR', varName: 'picked' }, toZone: 'HAND' },
        { op: 'MOVE_CARDS', target: { kind: 'REST_OF_VAR', allVar: 'revealed', excludeVar: 'picked' }, toZone: 'GRAVEYARD' },
      ],
    },
  },
  {
    cardNumber: 'ST03-004',
    name: '薇拉·瑰丽',
    vanillaEntry: true,
    // 【永】：对方回合中，横置状态的该牌PP+1000。
    staticEffects: [
      {
        id: 'ST03-004_OPP_TURN_TAPPED_PP',
        scope: 'SELF',
        selfFilter: { isReady: false },
        condition: { kind: 'TURN_OWNER', isSelfTurn: false },
        pp: 1000,
      },
    ],
  },
  { cardNumber: 'ST03-005', name: '薇拉·瑰丽', vanillaEntry: true },
  {
    cardNumber: 'ST03-006',
    name: '21号·XXI',
    // 【出】丢弃1张手牌：若我方战场的<三头犬小队>角色为3张及以上，选择我方墓地1张信号球，将其放置到我方信号球区最上方。
    entry: {
      cost: {
        kind: 'DISCARD_HAND',
        count: 1,
        optional: true,
        prompt: '【21号·XXI】【出】是否丢弃1张手牌：若我方战场<三头犬小队>角色为3张及以上，将墓地1张信号球放置到信号球区最上方？',
        choiceEffectType: 'PRESET_DISCARD_COST',
      },
      steps: [
        {
          op: 'IF',
          condition: { kind: 'HAS_ROLE', side: 'SELF', filter: { trait: '三头犬小队' }, minCount: 3 },
          then: [
            {
              op: 'CHOOSE_ZONE_CARDS',
              side: 'SELF',
              zone: 'GRAVEYARD',
              prompt: '【21号·XXI】选择我方墓地1张信号球放置到信号球区最上方',
              filter: { isSignalOrb: true },
              saveToVar: 'orb',
              choiceEffectType: 'PRESET_ORB_FROM_GRAVEYARD',
            },
            { op: 'MOVE_CARDS', target: { kind: 'VAR', varName: 'orb' }, toZone: 'SIGNAL_ORB' },
          ],
        },
      ],
    },
  },
  { cardNumber: 'ST03-007', name: '21号·XXI', vanillaEntry: true },
  {
    cardNumber: 'ST03-008',
    name: '21号·XXI',
    vanillaEntry: true,
    // 【起】横置该牌：直到回合结束为止，我方使用的下1张<薇拉>角色的费用-1 (不包含升变费用)
    activate: {
      cost: { kind: 'TAP_SELF' },
      steps: [
        {
          op: 'ADD_COST_MODIFIER',
          amount: 1,
          targetTrait: '薇拉',
          cardType: CardType.ROLE,
          excludeAscension: true,
          remainingCount: 1,
          logText: '横置该牌：下1张<薇拉>角色费用-1',
        },
      ],
    },
  },
  {
    cardNumber: 'ST03-009',
    name: '可靠的伙伴 21号&诺克提',
    vanillaEntry: true,
    // 【自】：我方1张《薇拉·瑰丽》出场时，可以消除【2红色信号球】。若如此做，将该牌竖直。直到回合结束为止，该牌PP+2000，DP-1。
    triggers: [
      {
        abilityId: 'ST03_009_PARTNER_ON_VERA_ENTER',
        eventType: 'CARD_ENTERED_FIELD',
        matcher: { kind: 'OTHER_FRIENDLY_ROLE_ENTERED', enteredName: '薇拉·瑰丽' },
        label: '【可靠的伙伴 21号&诺克提】(卡位 {slot})：《薇拉·瑰丽》出场时可消2红球竖直并PP+2000/DP-1',
        cost: {
          kind: 'ELIMINATE_ORBS',
          filter: 'RED',
          count: 2,
          optional: true,
          prompt: '【可靠的伙伴 21号&诺克提】《薇拉·瑰丽》出场，是否消除2张相邻的红色信号球：竖直该牌，PP+2000，DP-1？',
          choiceEffectType: 'PRESET_ORB_COST',
        },
        steps: [
          { op: 'SET_READY', target: { kind: 'SELF' }, isReady: true },
          { op: 'MODIFY_STATS', target: { kind: 'SELF' }, pp: 2000, dp: -1, duration: 'END_OF_TURN' },
        ],
      },
    ],
  },
  {
    cardNumber: 'ST03-010',
    name: '暗域力场',
    // 抽2张牌。直到下个回合结束为止，我方战场所有横置状态的<三头犬小队>角色PP+1000。(8.9.2 只作用于此时符合条件的角色)
    tactics: [
      { op: 'DRAW', count: 2 },
      {
        op: 'MODIFY_STATS',
        target: { kind: 'ALL_MATCHING_ROLES', side: 'SELF', filter: { trait: '三头犬小队', isReady: false } },
        pp: 1000,
        duration: 'END_OF_NEXT_TURN',
      },
    ],
  },
  {
    cardNumber: 'ST03-011',
    name: '三头犬出击',
    // 【永】：我方战场每有1张<三头犬小队>角色，手牌的该牌的费用-1。
    handCostDiscount: {
      filter: { cardType: CardType.ROLE, trait: '三头犬小队' },
      discountPerRole: 1,
    },
    // 选择对方战场1张角色，将其破坏。
    tactics: [
      {
        op: 'CHOOSE_ROLES',
        side: 'OPPONENT',
        prompt: '【三头犬出击】选择对方战场1张角色破坏',
        saveToVar: 'target',
        choiceEffectType: 'PRESET_DESTROY',
      },
      { op: 'DESTROY_ROLES', target: { kind: 'VAR', varName: 'target' } },
    ],
  },
  { cardNumber: 'ST03-012', name: '猩红连斩', isSignalOrbCard: true },
  { cardNumber: 'ST03-013', name: '侵蚀烙印', isSignalOrbCard: true },
  { cardNumber: 'ST03-014', name: '赤影突击', isSignalOrbCard: true },
];

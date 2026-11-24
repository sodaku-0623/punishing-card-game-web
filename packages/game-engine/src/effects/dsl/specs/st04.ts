import { CardType } from '@zhanshuang/shared';
import type { CardEffectSpec } from '../types.js';

/**
 * ST04 突击鹰小队官方预组 (14 张) 声明式效果描述
 */
export const ST04_EFFECT_SPECS: readonly CardEffectSpec[] = [
  {
    cardNumber: 'ST04-001',
    name: '荣光护盾',
    // 该牌只能在对方回合使用。
    // 【瞬时】：选择我方战场1张<突击鹰小队>角色，将其竖直。直到回合结束为止，其PP+1000，
    // 获得“【自】【回合1】：该牌阻挡的攻击结束时，可以消除【2任意信号球】。若如此做，将攻击角色破坏”。
    playPrecondition: {
      condition: { kind: 'TURN_OWNER', isSelfTurn: false },
      errorMessage: '该牌只能在对方回合使用',
    },
    tactics: [
      {
        op: 'CHOOSE_ROLES',
        side: 'SELF',
        prompt: '【荣光护盾】选择我方战场1张<突击鹰小队>角色，将其竖直并直到回合结束 PP+1000 且获得阻挡反杀能力',
        filter: { trait: '突击鹰小队' },
        min: 1,
        max: 1,
        saveToVar: 'target',
        choiceEffectType: 'PRESET_ST04_001_TARGET',
      },
      { op: 'SET_READY', target: { kind: 'VAR', varName: 'target' }, isReady: true },
      {
        op: 'MODIFY_STATS',
        target: { kind: 'VAR', varName: 'target' },
        pp: 1000,
        grantedTriggerIds: ['ST04_001_GRANTED_BLOCK_END_DESTROY'],
        duration: 'END_OF_TURN',
      },
    ],
    triggers: [
      {
        abilityId: 'ST04_001_GRANTED_BLOCK_END_DESTROY',
        eventType: 'ATTACK_ENDED',
        oncePerTurn: true,
        deferOncePerTurnUntilCostPaid: true,
        matcher: { kind: 'GRANTED_BLOCKED_ATTACK_END' },
        label: '【荣光护盾】赋予：阻挡的攻击结束时可消2任意信号球破坏攻击角色',
        cost: {
          kind: 'ELIMINATE_ORBS',
          filter: 'ANY',
          count: 2,
          optional: true,
          prompt: '【荣光护盾】赋予【自】：是否消除【2任意信号球】以破坏攻击角色？',
          choiceEffectType: 'PRESET_ST04_001_ORB_COST',
        },
        steps: [
          { op: 'MARK_TURN_ABILITY_USED', abilityKey: '__TRIGGER_ONCE_KEY__' },
          { op: 'DESTROY_ROLES', target: { kind: 'TRIGGER_ATTACKER' } },
        ],
      },
    ],
  },
  {
    cardNumber: 'ST04-002',
    name: '库洛姆·荣光',
    // 【出】：选择我方墓地1张《荣光护盾》，将其加入手牌。
    entry: {
      steps: [
        {
          op: 'CHOOSE_ZONE_CARDS',
          side: 'SELF',
          zone: 'GRAVEYARD',
          prompt: '【库洛姆·荣光】【出】选择我方墓地1张《荣光护盾》加入手牌',
          filter: { exactName: '荣光护盾' },
          min: 1,
          max: 1,
          saveToVar: 'picked',
          choiceEffectType: 'PRESET_ST04_002_PICK',
        },
        { op: 'MOVE_CARDS', target: { kind: 'VAR', varName: 'picked' }, toZone: 'HAND', isFaceUp: true },
      ],
    },
    // 【自】【回合1】：该牌阻挡的攻击结束时，可以消除2同色信号球。若如此做，将攻击角色破坏。
    triggers: [
      {
        abilityId: 'ST04_002_BLOCK_END_DESTROY',
        eventType: 'ATTACK_ENDED',
        oncePerTurn: true,
        deferOncePerTurnUntilCostPaid: true,
        matcher: { kind: 'SELF_BLOCKED_ATTACK_END' },
        label: '【库洛姆·荣光】【自】阻挡的攻击结束时可消2同色信号球破坏攻击角色',
        cost: {
          kind: 'ELIMINATE_ORBS',
          filter: 'SAME',
          count: 2,
          optional: true,
          prompt: '【库洛姆·荣光】【自】：是否消除2同色信号球以破坏攻击角色？',
          choiceEffectType: 'PRESET_ST04_002_ORB_COST',
        },
        steps: [
          { op: 'MARK_TURN_ABILITY_USED', abilityKey: '__TRIGGER_ONCE_KEY__' },
          { op: 'DESTROY_ROLES', target: { kind: 'TRIGGER_ATTACKER' } },
        ],
      },
    ],
  },
  {
    cardNumber: 'ST04-003',
    name: '库洛姆·荣光',
    // 【出】：公开我方牌组顶7张牌，选择其中最多1张《荣光护盾》加入手牌，将剩余的牌加入牌组并洗切。
    entry: {
      steps: [
        { op: 'REVEAL_TOP', count: 7, saveToVar: 'revealed' },
        {
          op: 'CHOOSE_FROM_VAR',
          varName: 'revealed',
          prompt: '【库洛姆·荣光】【出】选择其中最多1张《荣光护盾》加入手牌 (剩余的牌加入牌组并洗切)',
          filter: { exactName: '荣光护盾' },
          alwaysShow: true,
          min: 0,
          max: 1,
          saveToVar: 'picked',
          choiceEffectType: 'PRESET_ST04_003_PICK',
        },
        { op: 'MOVE_CARDS', target: { kind: 'VAR', varName: 'picked' }, toZone: 'HAND', isFaceUp: true },
        {
          op: 'MOVE_CARDS',
          target: { kind: 'REST_OF_VAR', allVar: 'revealed', excludeVar: 'picked' },
          toZone: 'DECK_SHUFFLE',
        },
      ],
    },
    // 【自】：我方回合结束时，将该牌从战场放置到牌组底，选择我方墓地1张费用为8及以下的<突击鹰小队>角色，将其出场。
    triggers: [
      {
        abilityId: 'ST04_003_END_TURN_SWAP',
        eventType: 'END_PHASE_TRIGGERS',
        matcher: { kind: 'SELF_TURN_END', isSelfTurn: true },
        label: '【库洛姆·荣光】【自】我方回合结束时放回牌组底并从墓地出场费用<=8的<突击鹰小队>角色',
        steps: [
          {
            op: 'IF',
            condition: { kind: 'SELF_MATCHES_FILTER', filter: { inZone: 'BATTLEFIELD' } },
            then: [
              { op: 'MOVE_CARDS', target: { kind: 'SELF' }, toZone: 'DECK_BOTTOM', saveMovedToVar: 'bounced' },
              {
                op: 'IF',
                condition: { kind: 'VAR_NON_EMPTY', varName: 'bounced' },
                then: [
                  {
                    op: 'CHOOSE_ZONE_CARDS',
                    side: 'SELF',
                    zone: 'GRAVEYARD',
                    prompt: '【库洛姆·荣光】【自】选择我方墓地1张费用为8及以下的<突击鹰小队>角色出场',
                    filter: { cardType: CardType.ROLE, trait: '突击鹰小队', maxCost: 8 },
                    requireEmptySlot: true,
                    min: 1,
                    max: 1,
                    saveToVar: 'revived',
                    choiceEffectType: 'PRESET_ST04_003_REVIVE',
                  },
                  {
                    op: 'MOVE_CARDS',
                    target: { kind: 'VAR', varName: 'revived' },
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
  {
    cardNumber: 'ST04-004',
    name: '库洛姆·荣光',
    // 【出】：选择我方战场其他1张<突击鹰小队>角色，直到下个回合结束为止，其PP+1000。
    entry: {
      steps: [
        {
          op: 'CHOOSE_ROLES',
          side: 'SELF',
          prompt: '【库洛姆·荣光】【出】选择我方战场其他1张<突击鹰小队>角色，直到下个回合结束 PP+1000',
          filter: { trait: '突击鹰小队', excludeSelf: true },
          min: 1,
          max: 1,
          saveToVar: 'target',
          choiceEffectType: 'PRESET_ST04_004_BUFF',
        },
        { op: 'MODIFY_STATS', target: { kind: 'VAR', varName: 'target' }, pp: 1000, duration: 'END_OF_NEXT_TURN' },
      ],
    },
  },
  {
    cardNumber: 'ST04-005',
    name: '库洛姆·荣光',
    // 【永】：【充能0】。
    vanillaEntry: true,
  },
  {
    cardNumber: 'ST04-006',
    name: '库洛姆·荣光',
    // 白板
    vanillaEntry: true,
  },
  {
    cardNumber: 'ST04-007',
    name: '神威·重能',
    // 【起】横置该牌：公开我方牌组顶5张牌，选择1张<突击鹰小队>加入手牌，将剩余的牌按任意顺序放置到牌组底。那之后，丢弃1张手牌。
    vanillaEntry: true,
    activate: {
      cost: { kind: 'TAP_SELF' },
      steps: [
        { op: 'REVEAL_TOP', count: 5, saveToVar: 'revealed' },
        {
          op: 'CHOOSE_FROM_VAR',
          varName: 'revealed',
          prompt: '【神威·重能】【起】选择1张<突击鹰小队>加入手牌 (剩余的牌放置到牌组底)',
          filter: { trait: '突击鹰小队' },
          alwaysShow: true,
          min: 1,
          max: 1,
          saveToVar: 'picked',
          choiceEffectType: 'PRESET_ST04_007_PICK',
        },
        { op: 'MOVE_CARDS', target: { kind: 'VAR', varName: 'picked' }, toZone: 'HAND', isFaceUp: true },
        {
          op: 'MOVE_CARDS',
          target: { kind: 'REST_OF_VAR', allVar: 'revealed', excludeVar: 'picked' },
          toZone: 'DECK_BOTTOM',
        },
        {
          op: 'CHOOSE_ZONE_CARDS',
          side: 'SELF',
          zone: 'HAND',
          prompt: '【神威·重能】【起】那之后，选择1张手牌丢弃',
          min: 1,
          max: 1,
          saveToVar: 'discarded',
          choiceEffectType: 'PRESET_DISCARD',
        },
        { op: 'MOVE_CARDS', target: { kind: 'VAR', varName: 'discarded' }, toZone: 'GRAVEYARD', isFaceUp: true },
      ],
    },
  },
  {
    cardNumber: 'ST04-008',
    name: '卡穆·狂犬',
    // 【永】：若我方战场存在<突击鹰小队>角色，该牌可以无视属性条件使用。
    vanillaEntry: true,
    ignoreAttributeCondition: {
      kind: 'HAS_ROLE',
      side: 'SELF',
      filter: { trait: '突击鹰小队' },
    },
  },
  {
    cardNumber: 'ST04-009',
    name: '万事·明觉',
    // 【自】：我方回合结束时，若我方战场存在<库洛姆>角色，则选择我方费用区最多2张牌，将其竖直。
    vanillaEntry: true,
    triggers: [
      {
        abilityId: 'ST04_009_END_TURN_READY_COST',
        eventType: 'END_PHASE_TRIGGERS',
        matcher: { kind: 'SELF_TURN_END', isSelfTurn: true },
        condition: { kind: 'HAS_ROLE', side: 'SELF', filter: { trait: '库洛姆' } },
        label: '【万事·明觉】【自】我方回合结束时竖直我方费用区最多2张牌',
        steps: [
          {
            op: 'CHOOSE_ZONE_CARDS',
            side: 'SELF',
            zone: 'COST',
            prompt: '【万事·明觉】【自】选择我方费用区最多2张横置的明费牌，将其竖直',
            filter: { isFaceUp: true, isReady: false },
            min: 0,
            max: 2,
            saveToVar: 'costs',
            choiceEffectType: 'PRESET_ST04_009_READY_COST',
          },
          { op: 'SET_READY', target: { kind: 'VAR', varName: 'costs' }, isReady: true },
        ],
      },
    ],
  },
  {
    cardNumber: 'ST04-010',
    name: '阿波罗',
    // 【自】【回合1】：我方战场1张<突击鹰小队>角色阻挡时，抽1张牌。
    vanillaEntry: true,
    triggers: [
      {
        abilityId: 'ST04_010_BLOCK_DRAW',
        eventType: 'BLOCK_DECLARED',
        oncePerTurn: true,
        matcher: { kind: 'FRIENDLY_ROLE_BLOCKING', blockerTrait: '突击鹰小队', sourceKind: 'EQUIPMENT' },
        label: '【阿波罗】【自】我方<突击鹰小队>角色阻挡时抽1张牌',
        steps: [{ op: 'DRAW', count: 1 }],
      },
    ],
  },
  {
    cardNumber: 'ST04-011',
    name: '先锋者',
    // 该牌只能在我方战场存在<库洛姆>角色时才能使用。
    // 选择对方战场1张费用为4及以下的角色，将其横置。
    playPrecondition: {
      condition: { kind: 'HAS_ROLE', side: 'SELF', filter: { trait: '库洛姆' } },
      errorMessage: '该牌只能在我方战场存在<库洛姆>角色时才能使用',
    },
    tactics: [
      {
        op: 'CHOOSE_ROLES',
        side: 'OPPONENT',
        prompt: '【先锋者】选择对方战场1张费用为4及以下的角色，将其横置',
        filter: { maxCost: 4 },
        min: 1,
        max: 1,
        saveToVar: 'target',
        choiceEffectType: 'PRESET_ST04_011_TAP',
      },
      { op: 'SET_READY', target: { kind: 'VAR', varName: 'target' }, isReady: false },
    ],
  },
  { cardNumber: 'ST04-012', name: '逆源极光', isSignalOrbCard: true },
  { cardNumber: 'ST04-013', name: '暴冰亟斩', isSignalOrbCard: true },
  { cardNumber: 'ST04-014', name: '冰澈引流', isSignalOrbCard: true },
];

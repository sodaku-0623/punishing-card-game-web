import { CardType } from '@zhanshuang/shared';
import type { CardEffectSpec } from '../types.js';

/**
 * ST01 灰鸦小队官方预组 (14 张) 声明式效果描述
 */
export const ST01_EFFECT_SPECS: readonly CardEffectSpec[] = [
  {
    cardNumber: 'ST01-001',
    name: '露西亚·红莲',
    // 【出】丢弃1张手牌：公开我方牌组顶5张牌，选择其中1张费用为3及以下的<灰鸦小队>角色出场，将剩余的牌按任意顺序放置到牌组底。
    entry: {
      cost: {
        kind: 'DISCARD_HAND',
        count: 1,
        optional: true,
        prompt: '【露西亚·红莲】【出】是否丢弃1张手牌：公开牌组顶5张，选择其中1张费用3及以下的<灰鸦小队>角色出场？',
        choiceEffectType: 'PRESET_DISCARD_COST',
      },
      steps: [
        { op: 'REVEAL_TOP', count: 5, saveToVar: 'revealed' },
        {
          op: 'CHOOSE_FROM_VAR',
          varName: 'revealed',
          prompt: '【露西亚·红莲】选择其中1张费用为3及以下的<灰鸦小队>角色出场 (剩余的牌放置到牌组底)',
          filter: { cardType: CardType.ROLE, trait: '灰鸦小队', maxCost: 3 },
          requireEmptySlot: true,
          alwaysShow: true,
          min: 1,
          max: 1,
          saveToVar: 'picked',
          choiceEffectType: 'PRESET_ST01_001_PICK',
        },
        { op: 'MOVE_CARDS', target: { kind: 'VAR', varName: 'picked' }, toZone: 'BATTLEFIELD', triggerEntry: true },
        { op: 'MOVE_CARDS', target: { kind: 'REST_OF_VAR', allVar: 'revealed', excludeVar: 'picked' }, toZone: 'DECK_BOTTOM' },
      ],
    },
    // 【起】消除【2蓝色信号球】：选择我方战场1张角色返回手牌。若如此做，选择我方手牌1张费用为4及以下的<灰鸦小队>角色出场。
    activate: {
      cost: {
        kind: 'ELIMINATE_ORBS',
        filter: 'BLUE',
        count: 2,
        optional: false,
        choiceEffectType: 'PRESET_ORB_COST',
      },
      steps: [
        {
          op: 'CHOOSE_ROLES',
          side: 'SELF',
          prompt: '【露西亚·红莲】选择我方战场1张角色返回手牌',
          saveToVar: 'bounced',
          choiceEffectType: 'PRESET_ST01_001_BOUNCE',
        },
        {
          op: 'MOVE_CARDS',
          target: { kind: 'VAR', varName: 'bounced' },
          toZone: 'HAND',
          saveMovedToVar: 'actuallyBounced',
        },
        {
          op: 'IF',
          condition: { kind: 'VAR_NON_EMPTY', varName: 'actuallyBounced' },
          then: [
            {
              op: 'CHOOSE_ZONE_CARDS',
              side: 'SELF',
              zone: 'HAND',
              prompt: '【露西亚·红莲】选择我方手牌1张费用为4及以下的<灰鸦小队>角色出场',
              filter: { cardType: CardType.ROLE, trait: '灰鸦小队', maxCost: 4 },
              requireEmptySlot: true,
              ineligibleReason: '战场没有空余卡位',
              saveToVar: 'deploy',
              choiceEffectType: 'PRESET_DEPLOY',
            },
            { op: 'MOVE_CARDS', target: { kind: 'VAR', varName: 'deploy' }, toZone: 'BATTLEFIELD', triggerEntry: true },
          ],
        },
      ],
    },
  },
  {
    cardNumber: 'ST01-002',
    name: '里·异火',
    // 【出】：可以将我方牌组顶3张牌放置到墓地。若其中有信号球，选择我方战场1张<灰鸦小队>角色，直到回合结束为止，其获得【充能+1】。
    entry: {
      steps: [
        {
          op: 'CONFIRM_YES_NO',
          prompt: '【里·异火】【出】是否将牌组顶3张牌放置到墓地？(若其中有信号球，选择1张<灰鸦小队>角色获得【充能+1】)',
          yesLabel: '放置到墓地',
          noLabel: '不放置',
          choiceEffectType: 'PRESET_ST01_002_MILL',
          onYes: [
            { op: 'MILL', count: 3, saveToVar: 'milled' },
            {
              op: 'IF',
              condition: { kind: 'VAR_HAS_CARD_MATCHING', varName: 'milled', filter: { isSignalOrb: true } },
              then: [
                {
                  op: 'CHOOSE_ROLES',
                  side: 'SELF',
                  prompt: '【里·异火】翻出了信号球：选择我方战场1张<灰鸦小队>角色，直到回合结束为止获得【充能+1】',
                  filter: { trait: '灰鸦小队' },
                  saveToVar: 'target',
                  choiceEffectType: 'PRESET_ST01_002_CHARGE',
                },
                {
                  op: 'MODIFY_STATS',
                  target: { kind: 'VAR', varName: 'target' },
                  charge: 1,
                  duration: 'END_OF_TURN',
                },
              ],
            },
          ],
        },
      ],
    },
  },
  {
    cardNumber: 'ST01-003',
    name: '丽芙·蚀暗',
    // 【出】：选择我方墓地1张信号球，将其放置到我方信号球区最上方。
    entry: {
      steps: [
        {
          op: 'CHOOSE_ZONE_CARDS',
          side: 'SELF',
          zone: 'GRAVEYARD',
          prompt: '【丽芙·蚀暗】选择我方墓地1张信号球放置到信号球区最上方',
          filter: { isSignalOrb: true },
          saveToVar: 'orb',
          choiceEffectType: 'PRESET_ORB_FROM_GRAVEYARD',
        },
        { op: 'MOVE_CARDS', target: { kind: 'VAR', varName: 'orb' }, toZone: 'SIGNAL_ORB' },
      ],
    },
  },
  { cardNumber: 'ST01-004', name: '露西亚·红莲', vanillaEntry: true },
  {
    cardNumber: 'ST01-005',
    name: '露西亚·红莲',
    // 【出】：抽1张牌，丢弃1张手牌。
    entry: {
      steps: [
        { op: 'DRAW', count: 1 },
        {
          op: 'CHOOSE_ZONE_CARDS',
          side: 'SELF',
          zone: 'HAND',
          prompt: '【露西亚·红莲】选择1张手牌丢弃',
          saveToVar: 'discarded',
          choiceEffectType: 'PRESET_DISCARD',
        },
        { op: 'MOVE_CARDS', target: { kind: 'VAR', varName: 'discarded' }, toZone: 'GRAVEYARD' },
      ],
    },
  },
  { cardNumber: 'ST01-006', name: '露西亚·红莲', vanillaEntry: true },
  { cardNumber: 'ST01-007', name: '里·异火', vanillaEntry: true },
  { cardNumber: 'ST01-008', name: '丽芙·蚀暗', vanillaEntry: true },
  {
    cardNumber: 'ST01-009',
    name: '阿呆蛙与铃铛羊',
    // 抽1张牌。选择我方战场1张<灰鸦小队>角色，直到回合结束为止，其PP+2000。
    tactics: [
      { op: 'DRAW', count: 1 },
      {
        op: 'CHOOSE_ROLES',
        side: 'SELF',
        prompt: '【阿呆蛙与铃铛羊】选择我方战场1张<灰鸦小队>角色，直到回合结束为止 PP+2000',
        filter: { trait: '灰鸦小队' },
        saveToVar: 'target',
        choiceEffectType: 'PRESET_ST01_009_BUFF',
      },
      {
        op: 'MODIFY_STATS',
        target: { kind: 'VAR', varName: 'target' },
        pp: 2000,
        duration: 'END_OF_TURN',
      },
    ],
  },
  {
    cardNumber: 'ST01-010',
    name: '灰鸦小队，集合！',
    // 公开我方牌组顶5张牌，选择其中1张<灰鸦小队>角色加入手牌，将剩余的牌按任意顺序放置到牌组底。
    tactics: [
      { op: 'REVEAL_TOP', count: 5, saveToVar: 'revealed' },
      {
        op: 'CHOOSE_FROM_VAR',
        varName: 'revealed',
        prompt: '【灰鸦小队，集合！】选择其中1张<灰鸦小队>角色加入手牌 (剩余的牌放置到牌组底)',
        filter: { cardType: CardType.ROLE, trait: '灰鸦小队' },
        alwaysShow: true,
        min: 1,
        max: 1,
        saveToVar: 'picked',
        choiceEffectType: 'PRESET_ST01_010_PICK',
      },
      { op: 'MOVE_CARDS', target: { kind: 'VAR', varName: 'picked' }, toZone: 'HAND' },
      { op: 'MOVE_CARDS', target: { kind: 'REST_OF_VAR', allVar: 'revealed', excludeVar: 'picked' }, toZone: 'DECK_BOTTOM' },
    ],
  },
  {
    cardNumber: 'ST01-011',
    name: '重逢',
    // 该牌只能在我方战场存在<露西亚>角色时才能使用。选择对方战场1张PP为8000及以下的角色，将其破坏。
    playPrecondition: {
      condition: { kind: 'HAS_ROLE', side: 'SELF', filter: { trait: '露西亚' } },
      errorMessage: '该牌只能在我方战场存在<露西亚>角色时才能使用',
    },
    tactics: [
      {
        op: 'CHOOSE_ROLES',
        side: 'OPPONENT',
        prompt: '【重逢】选择对方战场1张PP为8000及以下的角色破坏',
        eligibilityFilter: { maxEffectivePP: 8000 },
        ineligibleReason: 'PP 超过 8000',
        saveToVar: 'target',
        choiceEffectType: 'PRESET_DESTROY',
      },
      { op: 'DESTROY_ROLES', target: { kind: 'VAR', varName: 'target' } },
    ],
  },
  { cardNumber: 'ST01-012', name: '红莲-起手式', isSignalOrbCard: true },
  { cardNumber: 'ST01-013', name: '红莲-波动斩', isSignalOrbCard: true },
  { cardNumber: 'ST01-014', name: '红莲-闪击', isSignalOrbCard: true },
];

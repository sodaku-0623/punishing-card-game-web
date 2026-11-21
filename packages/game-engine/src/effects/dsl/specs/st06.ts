import { CardType } from '@zhanshuang/shared';
import type { CardEffectSpec } from '../types.js';

/**
 * ST06 亚里莎·回音 & 塞西莉官方预组 (14 张，8.13 协战体系) 声明式效果描述
 */
export const ST06_EFFECT_SPECS: readonly CardEffectSpec[] = [
  {
    cardNumber: 'ST06-001',
    name: '坠落与新生 亚里莎·回音',
    // 【永】：我方回合中，该牌选择手牌的《坠落与新生 塞西莉》作为协战搭档时，协战代价可以变为【2任意信号球】。(由 engine.ts resolveAssistCostOptions 实现)
    // 【出】：若我方战场存在协战状态的角色，直到回合结束为止，该牌获得【速攻】。
    entry: {
      steps: [
        {
          op: 'IF',
          condition: { kind: 'HAS_ROLE', side: 'SELF', filter: { hasPartner: true } },
          then: [
            {
              op: 'MODIFY_STATS',
              target: { kind: 'SELF' },
              keywords: ['速攻'],
              duration: 'END_OF_TURN',
            },
          ],
        },
      ],
    },
  },
  {
    cardNumber: 'ST06-002',
    name: '坠落与新生 塞西莉',
    // 【协战永】：该牌从手牌成为《坠落与新生 亚里莎·回音》的协战搭档的回合中，该牌不会解除协战状态。(由 engine.ts handlePerformAssist 设置 cannotReleasePartnerUntilTurn)
    // 【协战自】：该牌成为<亚里莎>角色的协战搭档时，可以消除【任意信号球】。根据因此方法消除的信号球牌，执行以下行动。
    // ·<信号球·红> 若为我方回合且对方战场的角色为3张及以上，选择对方战场1张费用为3及以下的角色，将其返回手牌。
    // ·<信号球·蓝> 选择我方费用区最多2张<亚里莎>或<塞西莉>，将其竖直。
    vanillaEntry: true,
    triggers: [
      {
        abilityId: 'ST06_002_ASSIST_AUTO',
        eventType: 'PARTNER_GAINED',
        matcher: { kind: 'SELF_BECAME_PARTNER', requiredHostTrait: '亚里莎' },
        label: '【坠落与新生 塞西莉】【协战自】可消任意1球并按球色触发回手或竖直费用',
        cost: {
          kind: 'ELIMINATE_ORBS',
          filter: 'ANY',
          count: 1,
          optional: true,
          savePaidToVar: 'paidOrb',
          prompt: '【坠落与新生 塞西莉】【协战自】：是否消除【任意信号球】1张？(红球可弹对方费用<=3角色；蓝球可竖直最多2张<亚里莎>/<塞西莉>明费)',
          choiceEffectType: 'PRESET_ST06_002_ORB_COST',
        },
        steps: [
          {
            op: 'IF',
            condition: {
              kind: 'ALL',
              conditions: [
                { kind: 'VAR_HAS_CARD_MATCHING', varName: 'paidOrb', filter: { signalOrbColor: 'RED' } },
                { kind: 'TURN_OWNER', isSelfTurn: true },
                { kind: 'HAS_ROLE', side: 'OPPONENT', minCount: 3 },
              ],
            },
            then: [
              {
                op: 'CHOOSE_ROLES',
                side: 'OPPONENT',
                prompt: '【坠落与新生 塞西莉】<信号球·红>：选择对方战场1张费用为3及以下的角色，将其返回手牌',
                filter: { maxCost: 3 },
                min: 1,
                max: 1,
                saveToVar: 'bounceTarget',
                choiceEffectType: 'PRESET_ST06_002_BOUNCE',
              },
              { op: 'MOVE_CARDS', target: { kind: 'VAR', varName: 'bounceTarget' }, toZone: 'HAND', isFaceUp: true },
            ],
          },
          {
            op: 'IF',
            condition: { kind: 'VAR_HAS_CARD_MATCHING', varName: 'paidOrb', filter: { signalOrbColor: 'BLUE' } },
            then: [
              {
                op: 'CHOOSE_ZONE_CARDS',
                side: 'SELF',
                zone: 'COST',
                prompt: '【坠落与新生 塞西莉】<信号球·蓝>：选择我方费用区最多2张<亚里莎>或<塞西莉>，将其竖直',
                filter: { isFaceUp: true, isReady: false, anyTraits: ['亚里莎', '塞西莉'] },
                min: 0,
                max: 2,
                saveToVar: 'readyCosts',
                choiceEffectType: 'PRESET_ST06_002_READY_COST',
              },
              { op: 'SET_READY', target: { kind: 'VAR', varName: 'readyCosts' }, isReady: true },
            ],
          },
        ],
      },
    ],
  },
  {
    cardNumber: 'ST06-003',
    name: '亚里莎·回音',
    // 【永】：若我方明费上限不大于对方，战场的该牌的基本DP变为1。(该牌印刷基本DP为0，+1确保不覆盖搭档叠加的基本DP 8.13.4.b)
    vanillaEntry: true,
    staticEffects: [
      {
        id: 'ST06_003_BASE_DP_ONE',
        scope: 'SELF',
        condition: { kind: 'OPEN_COST_COMPARE_OPPONENT', op: '<=' },
        dp: 1,
      },
    ],
  },
  {
    cardNumber: 'ST06-004',
    name: '昼翼',
    // 【永】：我方战场协战状态的<亚里莎>角色每有1张，手牌的该牌的费用-3。（费用最低为0）
    // 【出】：选择我方墓地1张信号球，将其放置到我方信号球区最上方。
    handCostDiscount: {
      filter: { trait: '亚里莎', hasPartner: true },
      discountPerRole: 3,
    },
    entry: {
      steps: [
        {
          op: 'CHOOSE_ZONE_CARDS',
          side: 'SELF',
          zone: 'GRAVEYARD',
          prompt: '【昼翼】【出】选择我方墓地1张信号球，放置到我方信号球区最上方',
          filter: { isSignalOrb: true },
          min: 1,
          max: 1,
          saveToVar: 'picked',
          choiceEffectType: 'PRESET_ST06_004_ORB',
        },
        { op: 'MOVE_CARDS', target: { kind: 'VAR', varName: 'picked' }, toZone: 'SIGNAL_ORB', isFaceUp: true },
      ],
    },
  },
  {
    cardNumber: 'ST06-005',
    name: '亚里莎·回音',
    // 【出】丢弃1张手牌：公开我方牌组顶5张牌，选择其中1张费用为4及以下的<亚里莎>角色或<塞西莉>角色出场，将剩余的牌加入牌组并洗切。
    entry: {
      cost: {
        kind: 'DISCARD_HAND',
        count: 1,
        optional: true,
        prompt: '【亚里莎·回音】【出】是否丢弃1张手牌：公开牌组顶5张，选择1张费用4及以下的<亚里莎>或<塞西莉>角色出场？',
        choiceEffectType: 'PRESET_DISCARD_COST',
      },
      steps: [
        { op: 'REVEAL_TOP', count: 5, saveToVar: 'revealed' },
        {
          op: 'CHOOSE_FROM_VAR',
          varName: 'revealed',
          prompt: '【亚里莎·回音】【出】选择其中1张费用为4及以下的<亚里莎>或<塞西莉>角色出场 (剩余加入牌组洗切)',
          filter: { cardType: CardType.ROLE, anyTraits: ['亚里莎', '塞西莉'], maxCost: 4 },
          requireEmptySlot: true,
          alwaysShow: true,
          min: 1,
          max: 1,
          saveToVar: 'picked',
          choiceEffectType: 'PRESET_ST06_005_PICK',
        },
        { op: 'MOVE_CARDS', target: { kind: 'VAR', varName: 'picked' }, toZone: 'BATTLEFIELD', triggerEntry: true },
        {
          op: 'MOVE_CARDS',
          target: { kind: 'REST_OF_VAR', allVar: 'revealed', excludeVar: 'picked' },
          toZone: 'DECK_SHUFFLE',
        },
      ],
    },
  },
  {
    cardNumber: 'ST06-006',
    name: '塞西莉',
    // 【协战永】：我方回合中，将该牌作为协战搭档的<亚里莎>角色获得【充能+1】，PP+1500。
    vanillaEntry: true,
    staticEffects: [
      {
        id: 'ST06_006_PARTNER_HOST_BUFF',
        scope: 'PARTNER_HOST',
        condition: { kind: 'TURN_OWNER', isSelfTurn: true },
        targetFilter: { trait: '亚里莎' },
        pp: 1500,
        charge: 1,
        dependsOnTraits: true,
      },
    ],
  },
  {
    cardNumber: 'ST06-007',
    name: '亚里莎·回音',
    // 【永】：【充能0】。
    // 【永】：若我方战场存在协战状态的角色，该牌PP+1500。
    vanillaEntry: true,
    staticEffects: [
      {
        id: 'ST06_007_ASSIST_FIELD_PP',
        scope: 'SELF',
        condition: { kind: 'HAS_ROLE', side: 'SELF', filter: { hasPartner: true } },
        pp: 1500,
      },
    ],
  },
  {
    cardNumber: 'ST06-008',
    name: '塞西莉',
    // 【永】：【充能0】。
    // 【协战自】：《塞西莉》的该能力每回合最多发动1次。该牌成为<亚里莎>角色的协战搭档时，
    // 选择我方战场最多1张<亚里莎>角色或<塞西莉>角色，直到回合结束为止，其获得【速攻】。
    vanillaEntry: true,
    triggers: [
      {
        abilityId: 'ST06_008_ASSIST_GRANT_RUSH',
        eventType: 'PARTNER_GAINED',
        oncePerTurnByPlayer: true,
        matcher: { kind: 'SELF_BECAME_PARTNER', requiredHostTrait: '亚里莎' },
        label: '【塞西莉】【协战自】选择我方最多1张<亚里莎>或<塞西莉>角色获得【速攻】',
        steps: [
          {
            op: 'CHOOSE_ROLES',
            side: 'SELF',
            prompt: '【塞西莉】【协战自】选择我方战场最多1张<亚里莎>或<塞西莉>角色，直到回合结束获得【速攻】',
            filter: { anyTraits: ['亚里莎', '塞西莉'] },
            min: 0,
            max: 1,
            saveToVar: 'target',
            choiceEffectType: 'PRESET_ST06_008_RUSH',
          },
          {
            op: 'MODIFY_STATS',
            target: { kind: 'VAR', varName: 'target' },
            keywords: ['速攻'],
            duration: 'END_OF_TURN',
          },
        ],
      },
    ],
  },
  {
    cardNumber: 'ST06-009',
    name: '塞西莉',
    // 【协战自】：对方回合中，该牌成为<亚里莎>角色的协战搭档时，可以消除【任意信号球】。若如此做，将那张<亚里莎>角色竖直。
    vanillaEntry: true,
    triggers: [
      {
        abilityId: 'ST06_009_OPP_TURN_READY_HOST',
        eventType: 'PARTNER_GAINED',
        matcher: { kind: 'SELF_BECAME_PARTNER', requiredHostTrait: '亚里莎', onlyOpponentTurn: true },
        label: '【塞西莉】【协战自】对方回合成为<亚里莎>搭档时可消任意1球将宿主竖直',
        cost: {
          kind: 'ELIMINATE_ORBS',
          filter: 'ANY',
          count: 1,
          optional: true,
          prompt: '【塞西莉】【协战自】：是否消除【任意信号球】1张以将宿主<亚里莎>角色竖直？',
          choiceEffectType: 'PRESET_ST06_009_ORB_COST',
        },
        steps: [{ op: 'SET_READY', target: { kind: 'TRIGGER_HOST' }, isReady: true }],
      },
    ],
  },
  {
    cardNumber: 'ST06-010',
    name: '阿斯特莉亚',
    // 【永】：装备该牌的《亚里莎·回音》获得“【永】：该牌可以支付【2费】作为协战代价从墓地选择协战搭档。”(由 engine.ts resolveAssistCostOptions 实现)
    vanillaEntry: true,
  },
  {
    cardNumber: 'ST06-011',
    name: '裁定合击',
    // 该牌只能在我方战场存在<亚里莎>角色或<塞西莉>角色时才能使用。
    // 选择对方战场1张费用为7及以下的角色，将其返回手牌。若我方战场存在协战状态的角色，改为将其放置到墓地。
    playPrecondition: {
      condition: { kind: 'HAS_ROLE', side: 'SELF', filter: { anyTraits: ['亚里莎', '塞西莉'] } },
      errorMessage: '该牌只能在我方战场存在<亚里莎>角色或<塞西莉>角色时才能使用',
    },
    tactics: [
      {
        op: 'CHOOSE_ROLES',
        side: 'OPPONENT',
        prompt: '【裁定合击】选择对方战场1张费用为7及以下的角色 (若我方存在协战状态角色改为放置到墓地)',
        filter: { maxCost: 7 },
        min: 1,
        max: 1,
        saveToVar: 'target',
        choiceEffectType: 'PRESET_ST06_011_TARGET',
      },
      {
        op: 'IF',
        condition: { kind: 'HAS_ROLE', side: 'SELF', filter: { hasPartner: true } },
        then: [{ op: 'MOVE_CARDS', target: { kind: 'VAR', varName: 'target' }, toZone: 'GRAVEYARD', isFaceUp: true }],
        else: [{ op: 'MOVE_CARDS', target: { kind: 'VAR', varName: 'target' }, toZone: 'HAND', isFaceUp: true }],
      },
    ],
  },
  { cardNumber: 'ST06-012', name: '秩序虹光', isSignalOrbCard: true },
  { cardNumber: 'ST06-013', name: '骤羽裁决', isSignalOrbCard: true },
  { cardNumber: 'ST06-014', name: '星穹坠闪', isSignalOrbCard: true },
];

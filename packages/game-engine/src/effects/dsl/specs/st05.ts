import { CardType, ElementAttribute } from '@zhanshuang/shared';
import type { CardEffectSpec } from '../types.js';

/**
 * ST05 清洁部队官方预组 (13 张，比安卡·晖暮 晖/暮形态体系) 声明式效果描述
 */
export const ST05_EFFECT_SPECS: readonly CardEffectSpec[] = [
  {
    cardNumber: 'ST05-001',
    name: '比安卡·晖暮',
    // 暮【出】：直到回合结束为止，该牌可以攻击对方玩家。（信号球区最下方牌费用为偶数时有效）
    entry: {
      steps: [
        {
          op: 'IF',
          condition: { kind: 'SIGNAL_ORB_BOTTOM_COST_PARITY', parity: 'EVEN' },
          then: [
            {
              op: 'MODIFY_STATS',
              target: { kind: 'SELF' },
              canAttackPlayerOnEnterTurn: true,
              duration: 'END_OF_TURN',
            },
          ],
        },
      ],
    },
    // 晖【自】：该牌攻击时，选择对方战场1张角色，可以消除【2任意信号球】。若如此做，直到回合结束为止，其PP-4000。
    triggers: [
      {
        abilityId: 'ST05_001_RADIANCE_ATTACK',
        eventType: 'ATTACK_DECLARED',
        matcher: { kind: 'SELF_ATTACKING' },
        condition: { kind: 'SIGNAL_ORB_BOTTOM_COST_PARITY', parity: 'ODD' },
        label: '【比安卡·晖暮】晖【自】攻击时选对方1角色，可消2任意信号球使其PP-4000',
        steps: [
          {
            op: 'CHOOSE_ROLES',
            side: 'OPPONENT',
            prompt: '【比安卡·晖暮】晖【自】：选择对方战场1张角色 (可消除2任意信号球使其PP-4000)',
            min: 1,
            max: 1,
            saveToVar: 'target',
            choiceEffectType: 'PRESET_ST05_001_TARGET',
          },
          {
            op: 'IF',
            condition: { kind: 'VAR_NON_EMPTY', varName: 'target' },
            then: [
              {
                op: 'ELIMINATE_ORB_COST',
                filter: 'ANY',
                count: 2,
                optional: true,
                prompt: '【比安卡·晖暮】晖【自】：是否消除【2任意信号球】使所选角色 PP-4000？',
                choiceEffectType: 'PRESET_ST05_001_ORB_COST',
                onPaid: [
                  {
                    op: 'MODIFY_STATS',
                    target: { kind: 'VAR', varName: 'target' },
                    pp: -4000,
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
  {
    cardNumber: 'ST05-002',
    name: '比安卡·晖暮',
    // 晖【出】：选择我方墓地1张费用为4及以下的《比安卡·晖暮》，将其以横置状态出场。
    // 暮【出】：抽1张牌。
    entry: {
      steps: [
        {
          op: 'IF',
          condition: { kind: 'SIGNAL_ORB_BOTTOM_COST_PARITY', parity: 'ODD' },
          then: [
            {
              op: 'CHOOSE_ZONE_CARDS',
              side: 'SELF',
              zone: 'GRAVEYARD',
              prompt: '【比安卡·晖暮】晖【出】：选择我方墓地1张费用为4及以下的《比安卡·晖暮》以横置状态出场',
              filter: { cardType: CardType.ROLE, exactName: '比安卡·晖暮', maxCost: 4 },
              requireEmptySlot: true,
              min: 1,
              max: 1,
              saveToVar: 'revived',
              choiceEffectType: 'PRESET_ST05_002_REVIVE',
            },
            {
              op: 'MOVE_CARDS',
              target: { kind: 'VAR', varName: 'revived' },
              toZone: 'BATTLEFIELD',
              enterTapped: true,
              triggerEntry: true,
            },
          ],
        },
        {
          op: 'IF',
          condition: { kind: 'SIGNAL_ORB_BOTTOM_COST_PARITY', parity: 'EVEN' },
          then: [{ op: 'DRAW', count: 1 }],
        },
      ],
    },
  },
  {
    cardNumber: 'ST05-003',
    name: '比安卡·晖暮',
    // 晖【永】：【速攻】。（同步由 keywords.ts 与声明式静态规则双重保证）
    // 暮【永】：该牌PP+500。
    vanillaEntry: true,
    staticEffects: [
      {
        id: 'ST05_003_RADIANCE_RUSH',
        scope: 'SELF',
        condition: { kind: 'SIGNAL_ORB_BOTTOM_COST_PARITY', parity: 'ODD' },
        keywords: ['速攻'],
      },
      {
        id: 'ST05_003_DUSK_PP',
        scope: 'SELF',
        condition: { kind: 'SIGNAL_ORB_BOTTOM_COST_PARITY', parity: 'EVEN' },
        pp: 500,
      },
    ],
  },
  {
    cardNumber: 'ST05-004',
    name: '比安卡·晖暮',
    // 【自】：该牌攻击时，可以公开我方牌组顶4张牌。若如此做，选择其中最多1张《比安卡·晖暮》放置到我方信号球区最下方，
    // 将剩余的牌按任意顺序放置到牌组底。该回合结束时，将因此方法放置到信号球区最下方的牌放置到墓地。
    vanillaEntry: true,
    triggers: [
      {
        abilityId: 'ST05_004_ATTACK_REVEAL',
        eventType: 'ATTACK_DECLARED',
        matcher: { kind: 'SELF_ATTACKING' },
        label: '【比安卡·晖暮】【自】攻击时可公开牌组顶4张并放1张《比安卡·晖暮》到信号球区最下方',
        steps: [
          {
            op: 'CONFIRM_YES_NO',
            prompt: '【比安卡·晖暮】【自】攻击时：是否公开我方牌组顶4张牌，将最多1张《比安卡·晖暮》放置到信号球区最下方？',
            yesLabel: '公开4张',
            noLabel: '不发动',
            choiceEffectType: 'PRESET_ST05_004_CONFIRM',
            onYes: [
              { op: 'REVEAL_TOP', count: 4, saveToVar: 'revealed' },
              {
                op: 'CHOOSE_FROM_VAR',
                varName: 'revealed',
                prompt: '【比安卡·晖暮】选择最多1张《比安卡·晖暮》放置到信号球区最下方 (剩余放置到牌组底)',
                filter: { exactName: '比安卡·晖暮' },
                alwaysShow: true,
                min: 0,
                max: 1,
                saveToVar: 'picked',
                choiceEffectType: 'PRESET_ST05_004_PICK',
              },
              {
                op: 'MOVE_CARDS',
                target: { kind: 'VAR', varName: 'picked' },
                toZone: 'SIGNAL_ORB_BOTTOM',
                isFaceUp: true,
                saveMovedToVar: 'placed',
              },
              {
                op: 'REGISTER_DELAYED_TRIGGER',
                target: { kind: 'VAR', varName: 'placed' },
                eventType: 'END_PHASE_TRIGGERS',
                abilityId: 'DELAYED_END_OF_TURN_TO_GRAVEYARD',
                expectedZone: 'SIGNAL_ORB',
                labelSuffix: '该回合结束时从信号球区放置到墓地',
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
  {
    cardNumber: 'ST05-005',
    name: '比安卡·晖暮',
    // 【出】：可以将我方手牌1张暗属性的牌放置到我方信号球区最下方。若如此做，抽1张牌。该回合结束时，将因此方法放置到信号球区最下方的牌放置到墓地。
    entry: {
      steps: [
        {
          op: 'CHOOSE_ZONE_CARDS',
          side: 'SELF',
          zone: 'HAND',
          prompt: '【比安卡·晖暮】【出】可以将我方手牌1张暗属性的牌放置到信号球区最下方并抽1张牌 (不选则不发动)',
          filter: { attribute: ElementAttribute.DARK },
          min: 0,
          max: 1,
          saveToVar: 'picked',
          choiceEffectType: 'PRESET_ST05_005_PLACE_ORB',
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
  },
  {
    cardNumber: 'ST05-006',
    name: '比安卡·晖暮',
    // 【永】：【充能0】。
    vanillaEntry: true,
  },
  {
    cardNumber: 'ST05-007',
    name: '比安卡·晖暮',
    // 【起】横置该牌&丢弃1张手牌：选择我方墓地1张《比安卡·晖暮》，将其放置到我方信号球区最下方。该回合结束时，将因此方法放置到信号球区最下方的牌放置到墓地。
    vanillaEntry: true,
    activate: {
      cost: {
        kind: 'TAP_SELF_AND_DISCARD_HAND',
        count: 1,
        prompt: '【比安卡·晖暮】【起】横置该牌并丢弃1张手牌作为代价',
        choiceEffectType: 'PRESET_ST05_007_DISCARD_COST',
      },
      steps: [
        {
          op: 'CHOOSE_ZONE_CARDS',
          side: 'SELF',
          zone: 'GRAVEYARD',
          prompt: '【比安卡·晖暮】【起】选择我方墓地1张《比安卡·晖暮》放置到信号球区最下方',
          filter: { exactName: '比安卡·晖暮' },
          min: 1,
          max: 1,
          saveToVar: 'picked',
          choiceEffectType: 'PRESET_ST05_007_PICK',
        },
        {
          op: 'MOVE_CARDS',
          target: { kind: 'VAR', varName: 'picked' },
          toZone: 'SIGNAL_ORB_BOTTOM',
          isFaceUp: true,
          saveMovedToVar: 'placed',
        },
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
  },
  {
    cardNumber: 'ST05-008',
    name: '奥罗拉',
    // 【自】【回合1】：装备该牌的《比安卡·晖暮》攻击时，可以将我方手牌1张暗属性的牌放置到我方信号球区最下方。若如此做，抽1张牌。该回合结束时，将因此方法放置到信号球区最下方的牌放置到墓地。
    vanillaEntry: true,
    triggers: [
      {
        abilityId: 'ST05_008_EQUIP_ATTACK',
        eventType: 'ATTACK_DECLARED',
        oncePerTurn: true,
        matcher: { kind: 'EQUIPPED_ROLE_ATTACKING', requiredHostName: '比安卡·晖暮' },
        label: '【奥罗拉】【自】装备的《比安卡·晖暮》攻击时可将手牌1张暗属性牌放到信号球区最下方并抽1张',
        steps: [
          {
            op: 'CHOOSE_ZONE_CARDS',
            side: 'SELF',
            zone: 'HAND',
            prompt: '【奥罗拉】【自】可以将我方手牌1张暗属性的牌放置到信号球区最下方并抽1张牌 (不选则不发动)',
            filter: { attribute: ElementAttribute.DARK },
            min: 0,
            max: 1,
            saveToVar: 'picked',
            choiceEffectType: 'PRESET_ST05_008_PLACE_ORB',
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
  {
    cardNumber: 'ST05-009',
    name: '终末祷词',
    // 该牌只能在我方费用区的《比安卡·晖暮》为3张及以上时才能使用。
    // 选择对方战场1张角色，直到回合结束为止，其PP-6000。
    // 晖 手牌的该牌的费用-3。
    // 暮 追加选择对方战场1张角色，直到回合结束为止，其PP-3000。
    playPrecondition: {
      condition: {
        kind: 'ZONE_COUNT',
        side: 'SELF',
        zone: 'COST',
        filter: { isFaceUp: true, exactName: '比安卡·晖暮' },
        op: '>=',
        value: 3,
      },
      errorMessage: '该牌只能在我方费用区的《比安卡·晖暮》为3张及以上时才能使用',
    },
    handCostDiscount: {
      condition: { kind: 'SIGNAL_ORB_BOTTOM_COST_PARITY', parity: 'ODD' },
      flatDiscount: 3,
    },
    tactics: [
      {
        op: 'CHOOSE_ROLES',
        side: 'OPPONENT',
        prompt: '【终末祷词】选择对方战场1张角色，直到回合结束 PP-6000',
        min: 1,
        max: 1,
        saveToVar: 'first',
        choiceEffectType: 'PRESET_ST05_009_FIRST',
      },
      { op: 'MODIFY_STATS', target: { kind: 'VAR', varName: 'first' }, pp: -6000, duration: 'END_OF_TURN' },
      {
        op: 'IF',
        condition: { kind: 'SIGNAL_ORB_BOTTOM_COST_PARITY', parity: 'EVEN' },
        then: [
          {
            op: 'CHOOSE_ROLES',
            side: 'OPPONENT',
            prompt: '【终末祷词】暮形态：追加选择对方战场1张角色，直到回合结束 PP-3000',
            min: 1,
            max: 1,
            saveToVar: 'second',
            choiceEffectType: 'PRESET_ST05_009_SECOND',
          },
          { op: 'MODIFY_STATS', target: { kind: 'VAR', varName: 'second' }, pp: -3000, duration: 'END_OF_TURN' },
        ],
      },
    ],
  },
  {
    cardNumber: 'ST05-010',
    name: '晦明戒律',
    // 【瞬时】：从以下2项选择1项。若我方信号球区最下方的牌的费用为奇数，改为选择最多2项。
    // ·抽1张牌。
    // ·选择我方战场1张《比安卡·晖暮》，直到回合结束为止，其PP+1000。
    tactics: [
      {
        op: 'IF',
        condition: { kind: 'SIGNAL_ORB_BOTTOM_COST_PARITY', parity: 'ODD' },
        then: [
          {
            op: 'CHOOSE_MODE',
            prompt: '【晦明戒律】信号球区最下方牌费用为奇数，可选择最多2项',
            min: 1,
            max: 2,
            choiceEffectType: 'PRESET_ST05_010_MODE',
            modes: [
              { id: 'mode_draw', label: '抽1张牌', steps: [{ op: 'DRAW', count: 1 }] },
              {
                id: 'mode_buff',
                label: '选择我方战场1张《比安卡·晖暮》，直到回合结束 PP+1000',
                steps: [
                  {
                    op: 'CHOOSE_ROLES',
                    side: 'SELF',
                    prompt: '【晦明戒律】选择我方战场1张《比安卡·晖暮》，直到回合结束 PP+1000',
                    filter: { exactName: '比安卡·晖暮' },
                    min: 1,
                    max: 1,
                    saveToVar: 'buffTarget',
                    choiceEffectType: 'PRESET_ST05_010_BUFF',
                  },
                  {
                    op: 'MODIFY_STATS',
                    target: { kind: 'VAR', varName: 'buffTarget' },
                    pp: 1000,
                    duration: 'END_OF_TURN',
                  },
                ],
              },
            ],
          },
        ],
        else: [
          {
            op: 'CHOOSE_MODE',
            prompt: '【晦明戒律】从以下2项选择1项',
            min: 1,
            max: 1,
            choiceEffectType: 'PRESET_ST05_010_MODE',
            modes: [
              { id: 'mode_draw', label: '抽1张牌', steps: [{ op: 'DRAW', count: 1 }] },
              {
                id: 'mode_buff',
                label: '选择我方战场1张《比安卡·晖暮》，直到回合结束 PP+1000',
                steps: [
                  {
                    op: 'CHOOSE_ROLES',
                    side: 'SELF',
                    prompt: '【晦明戒律】选择我方战场1张《比安卡·晖暮》，直到回合结束 PP+1000',
                    filter: { exactName: '比安卡·晖暮' },
                    min: 1,
                    max: 1,
                    saveToVar: 'buffTarget',
                    choiceEffectType: 'PRESET_ST05_010_BUFF',
                  },
                  {
                    op: 'MODIFY_STATS',
                    target: { kind: 'VAR', varName: 'buffTarget' },
                    pp: 1000,
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
  { cardNumber: 'ST05-011', name: '裁暮', isSignalOrbCard: true },
  { cardNumber: 'ST05-012', name: '断海', isSignalOrbCard: true },
  { cardNumber: 'ST05-013', name: '刑晖', isSignalOrbCard: true },
];

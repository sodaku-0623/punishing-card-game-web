import { CardType, ElementAttribute } from '@zhanshuang/shared';
import type { CardEffectSpec } from '../types.js';

/**
 * PR《特典推广卡》全套 49 张卡牌声明式效果集合
 *
 * 说明：
 * - PR-001/002/003/012/013/022/049 与 PR-030 的【充能自】及标准信号球牌出牌流程已内置于 card-effects.ts，
 *   此处仅标记 isSignalOrbCard: true (PR-030 额外标记 vanillaEntry: true)，切勿重复注册触发器。
 * - PR-031 的攻击时放置雷属性牌逻辑已通过 PR031_ATTACK_PAY_ORB 内置于 combat-manager.ts / engine.ts。
 * - 若个别条款受限于当前共享层 DSL / 引擎钩子而无法精确表达，均已在对应卡号注释中标明受限点并实现当前可表达部分。
 */
export const PR_EFFECT_SPECS: readonly CardEffectSpec[] = [
  // PR-001 阿呆蛙主题乐园：标准信号球战术牌 (内置信号球逻辑处理)
  {
    cardNumber: 'PR-001',
    name: '阿呆蛙主题乐园',
    isSignalOrbCard: true,
  },

  // PR-002 带上这只小丽芙：标准信号球战术牌
  {
    cardNumber: 'PR-002',
    name: '带上这只小丽芙',
    isSignalOrbCard: true,
  },

  // PR-003 里的路线规划：标准信号球战术牌
  {
    cardNumber: 'PR-003',
    name: '里的路线规划',
    isSignalOrbCard: true,
  },

  // PR-004 露西亚·鸦羽
  // 【永】：若我方战场存在<里>角色和<丽芙>角色，该牌PP+1000。
  // 【出】：将我方信号球区的牌按任意顺序排列。
  {
    cardNumber: 'PR-004',
    name: '露西亚·鸦羽',
    staticEffects: [
      {
        id: 'PR-004_LEE_LIV_PP',
        scope: 'SELF',
        condition: {
          kind: 'ALL',
          conditions: [
            { kind: 'HAS_ROLE', side: 'SELF', filter: { trait: '里' } },
            { kind: 'HAS_ROLE', side: 'SELF', filter: { trait: '丽芙' } },
          ],
        },
        pp: 1000,
        dependsOnTraits: true,
      },
    ],
    entry: {
      steps: [
        {
          op: 'REORDER_ZONE',
          zone: 'SIGNAL_ORB',
          prompt: '【露西亚·鸦羽】【出】按从下到上的顺序依次点选信号球区的全部 {orbCount} 张牌，以重新排列',
          choiceEffectType: 'PRESET_PR_004_ORDER',
        },
      ],
    },
  },

  // PR-005 露娜·银冕
  // 【永】：【充能0】 (由 rules/keywords.ts 解析)
  // 【出】：抽1张牌，丢弃1张手牌。
  {
    cardNumber: 'PR-005',
    name: '露娜·银冕',
    entry: {
      steps: [
        { op: 'DRAW', count: 1 },
        {
          op: 'CHOOSE_ZONE_CARDS',
          side: 'SELF',
          zone: 'HAND',
          prompt: '【露娜·银冕】【出】选择1张手牌丢弃',
          min: 1,
          max: 1,
          saveToVar: 'discarded',
          choiceEffectType: 'PRESET_DISCARD',
        },
        { op: 'MOVE_CARDS', target: { kind: 'VAR', varName: 'discarded' }, toZone: 'GRAVEYARD', isFaceUp: true },
      ],
    },
  },

  // PR-006 露西亚·深红之渊
  // 【出】丢弃1张手牌：选择我方费用区1张明费，将其加入手牌。若如此做，将我方牌组顶1张牌以横置状态放置到费用区。
  {
    cardNumber: 'PR-006',
    name: '露西亚·深红之渊',
    entry: {
      cost: {
        kind: 'DISCARD_HAND',
        count: 1,
        optional: true,
        prompt: '【露西亚·深红之渊】【出】是否丢弃1张手牌：选择费用区1张明费加入手牌，并将牌组顶1张牌横置放置到费用区？',
        choiceEffectType: 'PRESET_DISCARD_COST',
      },
      steps: [
        {
          op: 'CHOOSE_ZONE_CARDS',
          side: 'SELF',
          zone: 'COST',
          prompt: '【露西亚·深红之渊】选择我方费用区1张明费加入手牌',
          filter: { isFaceUp: true },
          min: 1,
          max: 1,
          saveToVar: 'pickedCost',
          choiceEffectType: 'PRESET_PR_006_COST',
        },
        {
          op: 'MOVE_CARDS',
          target: { kind: 'VAR', varName: 'pickedCost' },
          toZone: 'HAND',
          isFaceUp: true,
          saveMovedToVar: 'pickedMoved',
        },
        {
          op: 'IF',
          condition: { kind: 'VAR_NON_EMPTY', varName: 'pickedMoved' },
          then: [
            { op: 'REVEAL_TOP', count: 1, saveToVar: 'topDeck' },
            { op: 'MOVE_CARDS', target: { kind: 'VAR', varName: 'topDeck' }, toZone: 'COST', isFaceUp: true, isReady: false },
          ],
        },
      ],
    },
  },

  // PR-007 曲·雀翎
  // 【永】：若我方费用区的<万世铭>为2张及以上，该牌PP+1000。若为4张及以上，追加该牌DP+1。
  // (3.6.3.b.2) 仅参照正面表示的明费。
  {
    cardNumber: 'PR-007',
    name: '曲·雀翎',
    vanillaEntry: true,
    staticEffects: [
      {
        id: 'PR-007_WANSHIMING2_PP',
        scope: 'SELF',
        condition: {
          kind: 'ZONE_COUNT',
          side: 'SELF',
          zone: 'COST',
          filter: { trait: '万世铭', isFaceUp: true },
          op: '>=',
          value: 2,
        },
        pp: 1000,
        dependsOnTraits: true,
      },
      {
        id: 'PR-007_WANSHIMING4_DP',
        scope: 'SELF',
        condition: {
          kind: 'ZONE_COUNT',
          side: 'SELF',
          zone: 'COST',
          filter: { trait: '万世铭', isFaceUp: true },
          op: '>=',
          value: 4,
        },
        dp: 1,
        dependsOnTraits: true,
      },
    ],
  },

  // PR-008 七实·遥星之座
  // 【出】丢弃1张手牌：选择我方费用区1张明费，将其加入手牌。若如此做，将我方牌组顶1张牌以横置状态放置到费用区。
  {
    cardNumber: 'PR-008',
    name: '七实·遥星之座',
    entry: {
      cost: {
        kind: 'DISCARD_HAND',
        count: 1,
        optional: true,
        prompt: '【七实·遥星之座】【出】是否丢弃1张手牌：选择费用区1张明费加入手牌，并将牌组顶1张牌横置放置到费用区？',
        choiceEffectType: 'PRESET_DISCARD_COST',
      },
      steps: [
        {
          op: 'CHOOSE_ZONE_CARDS',
          side: 'SELF',
          zone: 'COST',
          prompt: '【七实·遥星之座】选择我方费用区1张明费加入手牌',
          filter: { isFaceUp: true },
          min: 1,
          max: 1,
          saveToVar: 'pickedCost',
          choiceEffectType: 'PRESET_PR_008_COST',
        },
        {
          op: 'MOVE_CARDS',
          target: { kind: 'VAR', varName: 'pickedCost' },
          toZone: 'HAND',
          isFaceUp: true,
          saveMovedToVar: 'pickedMoved',
        },
        {
          op: 'IF',
          condition: { kind: 'VAR_NON_EMPTY', varName: 'pickedMoved' },
          then: [
            { op: 'REVEAL_TOP', count: 1, saveToVar: 'topDeck' },
            { op: 'MOVE_CARDS', target: { kind: 'VAR', varName: 'topDeck' }, toZone: 'COST', isFaceUp: true, isReady: false },
          ],
        },
      ],
    },
  },

  // PR-009 赛琳娜·希声
  // 【出】：选择我方墓地1张信号球，将其放置到我方信号球区最上方。
  {
    cardNumber: 'PR-009',
    name: '赛琳娜·希声',
    entry: {
      steps: [
        {
          op: 'CHOOSE_ZONE_CARDS',
          side: 'SELF',
          zone: 'GRAVEYARD',
          prompt: '【赛琳娜·希声】【出】选择我方墓地1张信号球放置到信号球区最上方',
          filter: { isSignalOrb: true },
          min: 1,
          max: 1,
          saveToVar: 'orb',
          choiceEffectType: 'PRESET_ORB_FROM_GRAVEYARD',
        },
        { op: 'MOVE_CARDS', target: { kind: 'VAR', varName: 'orb' }, toZone: 'SIGNAL_ORB', isFaceUp: true },
      ],
    },
  },

  // PR-010 医疗兵
  // 【永】：该牌可以无视属性条件使用。
  // 选择我方费用区1张明费，将其加入手牌。若如此做，将该牌以横置状态放置到费用区。
  {
    cardNumber: 'PR-010',
    name: '医疗兵',
    ignoreAttributeCondition: { kind: 'EROSION_COMPARE', side: 'SELF', op: '>=', value: 0 },
    tactics: [
      {
        op: 'CHOOSE_ZONE_CARDS',
        side: 'SELF',
        zone: 'COST',
        prompt: '【医疗兵】选择我方费用区1张明费加入手牌',
        filter: { isFaceUp: true },
        min: 1,
        max: 1,
        saveToVar: 'pickedCost',
        choiceEffectType: 'PRESET_PR_010_COST',
      },
      {
        op: 'MOVE_CARDS',
        target: { kind: 'VAR', varName: 'pickedCost' },
        toZone: 'HAND',
        isFaceUp: true,
        saveMovedToVar: 'pickedMoved',
      },
      {
        op: 'IF',
        condition: { kind: 'VAR_NON_EMPTY', varName: 'pickedMoved' },
        then: [
          { op: 'MOVE_CARDS', target: { kind: 'SELF' }, toZone: 'COST', isFaceUp: true, isReady: false },
        ],
      },
    ],
  },

  // PR-011 史密斯
  // 【永】：该牌的【瞬时】在主要阶段也可以发动。
  // 【瞬时】：抽2张牌，丢弃1张手牌。选择我方战场1张<突击鹰小队>角色，直到回合结束为止，其PP+1000。
  {
    cardNumber: 'PR-011',
    name: '史密斯',
    allowInstantInMainPhase: true,
    tactics: [
      { op: 'DRAW', count: 2 },
      {
        op: 'CHOOSE_ZONE_CARDS',
        side: 'SELF',
        zone: 'HAND',
        prompt: '【史密斯】选择1张手牌丢弃',
        min: 1,
        max: 1,
        saveToVar: 'discarded',
        choiceEffectType: 'PRESET_DISCARD',
      },
      { op: 'MOVE_CARDS', target: { kind: 'VAR', varName: 'discarded' }, toZone: 'GRAVEYARD', isFaceUp: true },
      {
        op: 'CHOOSE_ROLES',
        side: 'SELF',
        prompt: '【史密斯】选择我方战场1张<突击鹰小队>角色，直到回合结束为止 PP+1000',
        filter: { trait: '突击鹰小队' },
        min: 1,
        max: 1,
        saveToVar: 'target',
        choiceEffectType: 'PRESET_PR_011_PP',
      },
      { op: 'MODIFY_STATS', target: { kind: 'VAR', varName: 'target' }, pp: 1000, duration: 'END_OF_TURN' },
    ],
  },

  // PR-012 出游：标准信号球战术牌
  {
    cardNumber: 'PR-012',
    name: '出游',
    isSignalOrbCard: true,
  },

  // PR-013 初见：标准信号球战术牌
  {
    cardNumber: 'PR-013',
    name: '初见',
    isSignalOrbCard: true,
  },

  // PR-014 银晕辉光
  // 【永】：所有玩家每回合各能使用最多1张《银晕辉光》。
  // 【瞬时】：我方战场1张《露娜·银冕》升变角色被攻击时才能发动。可以将那次攻击的对象变为我方玩家。
  // 受限点：ConditionExpr 尚缺少精确校验 state.currentCombat.targetType === 'CHARACTER' 且
  // targetCardId 具体为我方战场《露娜·银冕》升变角色（且 CardFilter.isAscended 校验的是升变定义而非 wasAscendedPlay）。
  {
    cardNumber: 'PR-014',
    name: '银晕辉光',
    maxPlaysPerTurnByName: 1,
    playPrecondition: {
      condition: {
        kind: 'ALL',
        conditions: [
          { kind: 'CURRENT_COMBAT_EXISTS' },
          { kind: 'TURN_OWNER', isSelfTurn: false },
          { kind: 'HAS_ROLE', side: 'SELF', filter: { exactName: '露娜·银冕', isAscended: true } },
        ],
      },
      errorMessage: '我方战场存在《露娜·银冕》升变角色被攻击时才能发动',
    },
    tactics: [
      {
        op: 'CONFIRM_YES_NO',
        prompt: '【银晕辉光】是否将那次攻击的对象变为我方玩家？',
        yesLabel: '攻击对象改为我方玩家',
        noLabel: '不改变',
        choiceEffectType: 'PRESET_PR_014_REDIRECT',
        onYes: [{ op: 'REDIRECT_ATTACK', targetType: 'PLAYER' }],
      },
    ],
  },

  // PR-015 七实·遥星之座
  // 【永】：若该牌存在于《七实·遥星之座》下方，其获得“【自】：该牌离场时，可以消除【2任意信号球】。
  // 若如此做，选择我方墓地1张费用为3及以下的《七实·遥星之座》或《帕瓦》，将其出场。”
  // 受限点：
  // 1. DeclarativeStaticEffectSpec (scope: 'UNDERNEATH_HOST') 尚未支持通过 grantedTriggerIds 动态赋予宿主【自】能力；
  // 2. DeclarativeTriggerMatcher 与 TriggerManager.snapshotCard 尚未支持从角色下方赋予宿主的离场触发器 (GRANTED_LEFT_FIELD)。
  {
    cardNumber: 'PR-015',
    name: '七实·遥星之座',
    vanillaEntry: true,
  },

  // PR-016 露西亚·深红囚影
  // 【永】：若该牌下方存在<封刃太刀>，该牌获得【速攻】。
  // 【自】：该牌离场时，若该牌装备<封刃太刀>，可以消除【任意信号球】。若如此做，选择我方墓地1张<封刃太刀>，将其出场。
  // 注：bringToField 当前将 MOVE_CARDS(toZone: 'BATTLEFIELD') 统一走 playRoleCard，尚未对装备牌分支调用 playStandaloneEquipment (Q&A·7)。
  {
    cardNumber: 'PR-016',
    name: '露西亚·深红囚影',
    vanillaEntry: true,
    staticEffects: [
      {
        id: 'PR-016_FENGREN_HASTE',
        scope: 'SELF',
        condition: {
          kind: 'SELF_MATCHES_FILTER',
          filter: {
            hasUnderneathOrEquipMatching: { anyTraits: ['封刃太刀', '太刀', '小太刀', '大太刀'] },
          },
        },
        keywords: ['速攻'],
        dependsOnTraits: true,
      },
    ],
    triggers: [
      {
        abilityId: 'PR_016_LEFT_FIELD_REVIVE_FENGREN',
        eventType: 'CARD_LEFT_FIELD',
        matcher: { kind: 'SELF_LEFT_FIELD', requiredEquipTrait: '封刃太刀' },
        label: '【露西亚·深红囚影】【自】离场时若装备<封刃太刀>，可消除【任意信号球】并从墓地出场1张<封刃太刀>',
        cost: {
          kind: 'ELIMINATE_ORBS',
          filter: 'ANY',
          count: 1,
          optional: true,
          prompt: '【露西亚·深红囚影】【自】是否消除【任意信号球】，选择我方墓地1张<封刃太刀>出场？',
          choiceEffectType: 'PRESET_PR_016_ORB_COST',
        },
        steps: [
          {
            op: 'CHOOSE_ZONE_CARDS',
            side: 'SELF',
            zone: 'GRAVEYARD',
            prompt: '【露西亚·深红囚影】【自】选择我方墓地1张<封刃太刀>出场',
            filter: { anyTraits: ['封刃太刀', '太刀', '小太刀', '大太刀'] },
            requireEmptySlot: true,
            ineligibleReason: '战场没有空余卡位',
            min: 1,
            max: 1,
            saveToVar: 'tachi',
            choiceEffectType: 'PRESET_PR_016_REVIVE',
          },
          {
            op: 'MOVE_CARDS',
            target: { kind: 'VAR', varName: 'tachi' },
            toZone: 'BATTLEFIELD',
            triggerEntry: true,
          },
        ],
      },
    ],
  },

  // PR-017 雪歌
  // 【起】【回合1】【2任意信号球】：选择我方战场1张《赛琳娜·希声》，直到回合结束为止，其PP+1500。
  // 若我方费用区的<艺术协会>为3张及以上，追加直到回合结束为止，其获得【速攻】。
  {
    cardNumber: 'PR-017',
    name: '雪歌',
    vanillaEntry: true,
    activate: {
      oncePerTurn: true,
      cost: {
        kind: 'ELIMINATE_ORBS',
        filter: 'ANY',
        count: 2,
        optional: false,
        choiceEffectType: 'PRESET_ORB_COST',
      },
      steps: [
        {
          op: 'CHOOSE_ROLES',
          side: 'SELF',
          prompt: '【雪歌】选择我方战场1张《赛琳娜·希声》PP+1500',
          filter: { exactName: '赛琳娜·希声' },
          min: 1,
          max: 1,
          saveToVar: 'selena',
          choiceEffectType: 'PRESET_PR_017_TARGET',
        },
        { op: 'MODIFY_STATS', target: { kind: 'VAR', varName: 'selena' }, pp: 1500, duration: 'END_OF_TURN' },
        {
          op: 'IF',
          condition: {
            kind: 'ZONE_COUNT',
            side: 'SELF',
            zone: 'COST',
            filter: { trait: '艺术协会', isFaceUp: true },
            op: '>=',
            value: 3,
          },
          then: [
            {
              op: 'MODIFY_STATS',
              target: { kind: 'VAR', varName: 'selena' },
              keywords: ['速攻'],
              duration: 'END_OF_TURN',
            },
          ],
        },
      ],
    },
  },

  // PR-018 决意
  // 【瞬时】：可以将我方墓地2张《飞叶点翠》加入牌组并洗切。若如此做，从以下2项选择1项。
  // ·选择我方战场1张攻击中的或被攻击的《含英·檀心》，直到那次攻击结束为止，其PP+2000。
  // ·选择对方战场1张攻击中的角色，该角色的那次攻击在伤害步骤只能造成最多1点伤害。
  // 受限点：CardFilter 缺少战斗中状态过滤字段 (isAttacking / isBeingAttacked)。
  {
    cardNumber: 'PR-018',
    name: '决意',
    tactics: [
      {
        op: 'IF',
        condition: {
          kind: 'ZONE_COUNT',
          side: 'SELF',
          zone: 'GRAVEYARD',
          filter: { exactName: '飞叶点翠' },
          op: '>=',
          value: 2,
        },
        then: [
          {
            op: 'CONFIRM_YES_NO',
            prompt: '【决意】是否将我方墓地2张《飞叶点翠》加入牌组并洗切？',
            yesLabel: '加入牌组并洗切',
            noLabel: '不执行',
            choiceEffectType: 'PRESET_PR_018_CONFIRM',
            onYes: [
              {
                op: 'CHOOSE_ZONE_CARDS',
                side: 'SELF',
                zone: 'GRAVEYARD',
                prompt: '【决意】选择我方墓地2张《飞叶点翠》加入牌组并洗切',
                filter: { exactName: '飞叶点翠' },
                min: 2,
                max: 2,
                saveToVar: 'returned',
                choiceEffectType: 'PRESET_PR_018_RETURN',
              },
              {
                op: 'MOVE_CARDS',
                target: { kind: 'VAR', varName: 'returned' },
                toZone: 'DECK_SHUFFLE',
                saveMovedToVar: 'returnedMoved',
              },
              {
                op: 'IF',
                condition: { kind: 'VAR_COUNT_COMPARE', varName: 'returnedMoved', op: '>=', value: 2 },
                then: [
                  {
                    op: 'CHOOSE_MODE',
                    prompt: '【决意】从以下2项选择1项',
                    choiceEffectType: 'PRESET_PR_018_MODE',
                    modes: [
                      {
                        id: 'buff_hanying',
                        label: '选择我方战场1张攻击中/被攻击的《含英·檀心》PP+2000 (直到该次攻击结束)',
                        steps: [
                          {
                            op: 'CHOOSE_ROLES',
                            side: 'SELF',
                            prompt: '【决意】选择我方战场1张《含英·檀心》PP+2000',
                            filter: { exactName: '含英·檀心' },
                            min: 1,
                            max: 1,
                            saveToVar: 'hanying',
                            choiceEffectType: 'PRESET_PR_018_BUFF',
                          },
                          {
                            op: 'MODIFY_STATS',
                            target: { kind: 'VAR', varName: 'hanying' },
                            pp: 2000,
                            duration: 'END_OF_COMBAT',
                          },
                        ],
                      },
                      {
                        id: 'cap_damage_1',
                        label: '选择对方战场1张攻击中的角色，该次攻击在伤害步骤最多造成1点伤害',
                        steps: [
                          {
                            op: 'CHOOSE_ROLES',
                            side: 'OPPONENT',
                            prompt: '【决意】选择对方战场1张攻击中的角色',
                            min: 1,
                            max: 1,
                            saveToVar: 'oppAttacker',
                            choiceEffectType: 'PRESET_PR_018_CAP',
                          },
                          {
                            op: 'IF',
                            condition: { kind: 'VAR_NON_EMPTY', varName: 'oppAttacker' },
                            then: [{ op: 'SET_COMBAT_MAX_DAMAGE', maxDamage: 1 }],
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

  // PR-019 徽羽
  // 【起】横置该牌&丢弃1张手牌：公开我方牌组顶4张牌。选择其中最多1张<万世铭>和最多1张《曲·启明》加入手牌，将剩余的牌按任意顺序放置到牌组底。
  // 受限点：MOVE_CARDS (toZone: 'DECK_BOTTOM') 按传入顺序置底，尚无按任意顺序手动排列余牌的独立步骤。
  {
    cardNumber: 'PR-019',
    name: '徽羽',
    vanillaEntry: true,
    activate: {
      cost: {
        kind: 'TAP_SELF_AND_DISCARD_HAND',
        count: 1,
        choiceEffectType: 'PRESET_DISCARD_COST',
      },
      steps: [
        { op: 'REVEAL_TOP', count: 4, saveToVar: 'revealed' },
        {
          op: 'CHOOSE_FROM_VAR',
          varName: 'revealed',
          prompt: '【徽羽】选择其中最多1张<万世铭>加入手牌',
          filter: { trait: '万世铭' },
          alwaysShow: true,
          min: 0,
          max: 1,
          saveToVar: 'pickWanshiming',
          choiceEffectType: 'PRESET_PR_019_PICK1',
        },
        { op: 'MOVE_CARDS', target: { kind: 'VAR', varName: 'pickWanshiming' }, toZone: 'HAND', isFaceUp: true },
        {
          op: 'CHOOSE_FROM_VAR',
          varName: 'revealed',
          prompt: '【徽羽】选择其中最多1张《曲·启明》加入手牌 (剩余的牌放置到牌组底)',
          filter: { exactName: '曲·启明', inZone: 'PROCESSING' },
          alwaysShow: true,
          min: 0,
          max: 1,
          saveToVar: 'pickQu',
          choiceEffectType: 'PRESET_PR_019_PICK2',
        },
        { op: 'MOVE_CARDS', target: { kind: 'VAR', varName: 'pickQu' }, toZone: 'HAND', isFaceUp: true },
        {
          op: 'MOVE_CARDS',
          target: { kind: 'REST_OF_VAR', allVar: 'revealed', excludeVar: 'pickQu' },
          toZone: 'DECK_BOTTOM',
        },
      ],
    },
  },

  // PR-020 杼菱
  // 【起】横置该牌：若我方战场存在《伊什梅尔·幻日》，从以下2项选择1项。
  // ·若该牌下方不存在卡牌，选择我方手牌或墓地1张不为空属性的升变角色，将其以正面表示放置到该牌下方。
  // ·选择我方战场1张不为空属性的升变角色放置到墓地。若如此做，选择该牌下方1张费用不大于我方明费上限的升变角色，将其效果无效出场。
  // 受限点 (第 2 项)：
  // CHOOSE_ZONE_CARDS (zone: 'HOST_UNDERNEATH') 仅遍历 roles()，尚无法检索辅助机牌 (ASSIST)《杼菱》下方的卡牌
  // (注：maxCostOpenCostLimit: true 与 MOVE_CARDS.loseAbilities: true 原语已就绪)。
  {
    cardNumber: 'PR-020',
    name: '杼菱',
    vanillaEntry: true,
    activate: {
      cost: { kind: 'TAP_SELF' },
      condition: { kind: 'HAS_ROLE', side: 'SELF', filter: { exactName: '伊什梅尔·幻日' } },
      conditionError: '我方战场不存在《伊什梅尔·幻日》',
      steps: [
        {
          op: 'CHOOSE_MODE',
          prompt: '【杼菱】从以下2项选择1项',
          choiceEffectType: 'PRESET_PR_020_MODE',
          modes: [
            {
              id: 'tuck_non_void_asc',
              label: '若该牌下方不存在卡牌，将手牌或墓地1张非空属性升变角色正面置入该牌下方',
              steps: [
                {
                  op: 'IF',
                  condition: { kind: 'SELF_UNDERNEATH_COUNT', op: '==', value: 0 },
                  then: [
                    {
                      op: 'CHOOSE_ZONE_CARDS',
                      side: 'SELF',
                      zone: 'HAND',
                      zones: ['HAND', 'GRAVEYARD'],
                      prompt: '【杼菱】选择手牌或墓地1张不为空属性的升变角色置入该牌下方',
                      filter: { cardType: CardType.ROLE, isAscended: true, excludeAttribute: ElementAttribute.VOID },
                      min: 1,
                      max: 1,
                      saveToVar: 'tuckCard',
                      choiceEffectType: 'PRESET_PR_020_TUCK',
                    },
                    {
                      op: 'MOVE_CARDS',
                      target: { kind: 'VAR', varName: 'tuckCard' },
                      toZone: 'UNDERNEATH',
                      underneathHost: { kind: 'SELF' },
                      isFaceUp: true,
                    },
                  ],
                },
              ],
            },
            {
              id: 'swap_asc_from_underneath',
              label: '将我方战场1张非空属性升变角色送墓，从该牌下方效果无效出场升变角色 (尚缺辅助机下方区域检索)',
              steps: [
                {
                  op: 'CHOOSE_ROLES',
                  side: 'SELF',
                  prompt: '【杼菱】选择我方战场1张不为空属性的升变角色放置到墓地',
                  filter: { isAscended: true, excludeAttribute: ElementAttribute.VOID },
                  min: 1,
                  max: 1,
                  saveToVar: 'sacRole',
                  choiceEffectType: 'PRESET_PR_020_SAC',
                },
                {
                  op: 'MOVE_CARDS',
                  target: { kind: 'VAR', varName: 'sacRole' },
                  toZone: 'GRAVEYARD',
                  isFaceUp: true,
                  saveMovedToVar: 'sacMoved',
                },
              ],
            },
          ],
        },
      ],
    },
  },

  // PR-021 心象边境
  // 【瞬时】：可以将我方1张《丽芙·极昼》从战场放置到墓地。若如此做，从以下2项选择1项。
  // ·选择我方战场1张攻击中的或被攻击的《丽芙·极昼》，直到那次攻击结束为止，其PP+2000。
  // ·选择对方战场1张攻击中的角色，该角色的那次攻击在伤害步骤只能造成最多1点伤害。
  // 受限点：
  // 1. CHOOSE_ZONE_CARDS (zone: 'BATTLEFIELD') / CHOOSE_ROLES 未涵盖处于协战搭档位 (partnerCardId) 的《丽芙·极昼》；
  // 2. CardFilter 缺少战斗中状态过滤字段 (isAttacking / isBeingAttacked)。
  {
    cardNumber: 'PR-021',
    name: '心象边境',
    tactics: [
      {
        op: 'IF',
        condition: {
          kind: 'HAS_ROLE',
          side: 'SELF',
          filter: { exactName: '丽芙·极昼' },
        },
        then: [
          {
            op: 'CONFIRM_YES_NO',
            prompt: '【心象边境】是否将我方1张《丽芙·极昼》从战场放置到墓地？',
            yesLabel: '放置到墓地',
            noLabel: '不执行',
            choiceEffectType: 'PRESET_PR_021_CONFIRM',
            onYes: [
              {
                op: 'CHOOSE_ROLES',
                side: 'SELF',
                prompt: '【心象边境】选择我方战场1张《丽芙·极昼》放置到墓地',
                filter: { exactName: '丽芙·极昼' },
                min: 1,
                max: 1,
                saveToVar: 'sentLiv',
                choiceEffectType: 'PRESET_PR_021_SAC',
              },
              {
                op: 'MOVE_CARDS',
                target: { kind: 'VAR', varName: 'sentLiv' },
                toZone: 'GRAVEYARD',
                isFaceUp: true,
                saveMovedToVar: 'movedLiv',
              },
              {
                op: 'IF',
                condition: { kind: 'VAR_NON_EMPTY', varName: 'movedLiv' },
                then: [
                  {
                    op: 'CHOOSE_MODE',
                    prompt: '【心象边境】从以下2项选择1项',
                    choiceEffectType: 'PRESET_PR_021_MODE',
                    modes: [
                      {
                        id: 'buff_liv',
                        label: '选择我方战场1张攻击中/被攻击的《丽芙·极昼》PP+2000 (直到该次攻击结束)',
                        steps: [
                          {
                            op: 'CHOOSE_ROLES',
                            side: 'SELF',
                            prompt: '【心象边境】选择我方战场1张《丽芙·极昼》PP+2000',
                            filter: { exactName: '丽芙·极昼' },
                            min: 1,
                            max: 1,
                            saveToVar: 'targetLiv',
                            choiceEffectType: 'PRESET_PR_021_BUFF',
                          },
                          {
                            op: 'MODIFY_STATS',
                            target: { kind: 'VAR', varName: 'targetLiv' },
                            pp: 2000,
                            duration: 'END_OF_COMBAT',
                          },
                        ],
                      },
                      {
                        id: 'cap_damage_1',
                        label: '选择对方战场1张攻击中的角色，该次攻击在伤害步骤最多造成1点伤害',
                        steps: [
                          {
                            op: 'CHOOSE_ROLES',
                            side: 'OPPONENT',
                            prompt: '【心象边境】选择对方战场1张攻击中的角色',
                            min: 1,
                            max: 1,
                            saveToVar: 'oppAttacker',
                            choiceEffectType: 'PRESET_PR_021_CAP',
                          },
                          {
                            op: 'IF',
                            condition: { kind: 'VAR_NON_EMPTY', varName: 'oppAttacker' },
                            then: [{ op: 'SET_COMBAT_MAX_DAMAGE', maxDamage: 1 }],
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

  // PR-022 干杯：标准信号球战术牌
  {
    cardNumber: 'PR-022',
    name: '干杯',
    isSignalOrbCard: true,
  },

  // PR-023 瘟疫骑士
  // 【起】丢弃手牌中的该牌：选择对方战场1张费用为3及以下的角色，可以丢弃手牌1张<万事>或<神寂启示录>。若如此做，将其冰冻。
  // 【起】【3费】：若该牌存在于墓地，可以将我方墓地1张<神寂启示录>角色放置到牌组底。若如此做，将该牌从墓地出场。
  {
    cardNumber: 'PR-023',
    name: '瘟疫骑士',
    vanillaEntry: true,
    activates: [
      {
        id: 'hand_freeze',
        usableZones: ['HAND'],
        cost: { kind: 'DISCARD_SELF_FROM_HAND' },
        steps: [
          {
            op: 'CHOOSE_ROLES',
            side: 'OPPONENT',
            prompt: '【瘟疫骑士】选择对方战场1张费用为3及以下的角色',
            filter: { maxCost: 3 },
            min: 1,
            max: 1,
            saveToVar: 'target',
            choiceEffectType: 'PRESET_PR_023_TARGET',
          },
          {
            op: 'IF',
            condition: {
              kind: 'ALL',
              conditions: [
                { kind: 'VAR_NON_EMPTY', varName: 'target' },
                { kind: 'ZONE_COUNT', side: 'SELF', zone: 'HAND', filter: { anyTraits: ['万事', '神寂启示录'] }, op: '>=', value: 1 },
              ],
            },
            then: [
              {
                op: 'CONFIRM_YES_NO',
                prompt: '【瘟疫骑士】是否丢弃手牌1张<万事>或<神寂启示录>，将所选角色冰冻？',
                yesLabel: '丢弃并冰冻',
                noLabel: '不丢弃',
                choiceEffectType: 'PRESET_PR_023_CONFIRM',
                onYes: [
                  {
                    op: 'CHOOSE_ZONE_CARDS',
                    side: 'SELF',
                    zone: 'HAND',
                    prompt: '【瘟疫骑士】选择手牌1张<万事>或<神寂启示录>丢弃',
                    filter: { anyTraits: ['万事', '神寂启示录'] },
                    min: 1,
                    max: 1,
                    saveToVar: 'disc',
                    choiceEffectType: 'PRESET_DISCARD',
                  },
                  {
                    op: 'MOVE_CARDS',
                    target: { kind: 'VAR', varName: 'disc' },
                    toZone: 'GRAVEYARD',
                    isFaceUp: true,
                    saveMovedToVar: 'discMoved',
                  },
                  {
                    op: 'IF',
                    condition: { kind: 'VAR_NON_EMPTY', varName: 'discMoved' },
                    then: [{ op: 'SET_FROZEN', target: { kind: 'VAR', varName: 'target' }, isFrozen: true }],
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        id: 'gy_revive',
        usableZones: ['GRAVEYARD'],
        cost: { kind: 'PAY_COST', amount: 3 },
        steps: [
          {
            op: 'IF',
            condition: {
              kind: 'ZONE_COUNT',
              side: 'SELF',
              zone: 'GRAVEYARD',
              filter: { cardType: CardType.ROLE, trait: '神寂启示录' },
              op: '>=',
              value: 1,
            },
            then: [
              {
                op: 'CONFIRM_YES_NO',
                prompt: '【瘟疫骑士】是否将我方墓地1张<神寂启示录>角色放置到牌组底，将该牌从墓地出场？',
                yesLabel: '置底并出场',
                noLabel: '不执行',
                choiceEffectType: 'PRESET_PR_023_REVIVE_CONFIRM',
                onYes: [
                  {
                    op: 'CHOOSE_ZONE_CARDS',
                    side: 'SELF',
                    zone: 'GRAVEYARD',
                    prompt: '【瘟疫骑士】选择我方墓地1张<神寂启示录>角色放置到牌组底',
                    filter: { cardType: CardType.ROLE, trait: '神寂启示录' },
                    min: 1,
                    max: 1,
                    saveToVar: 'bot',
                    choiceEffectType: 'PRESET_PR_023_BOTTOM',
                  },
                  {
                    op: 'MOVE_CARDS',
                    target: { kind: 'VAR', varName: 'bot' },
                    toZone: 'DECK_BOTTOM',
                    saveMovedToVar: 'botMoved',
                  },
                  {
                    op: 'IF',
                    condition: {
                      kind: 'ALL',
                      conditions: [
                        { kind: 'VAR_NON_EMPTY', varName: 'botMoved' },
                        { kind: 'SELF_MATCHES_FILTER', filter: { inZone: 'GRAVEYARD' } },
                        { kind: 'HAS_EMPTY_SLOT', side: 'SELF' },
                      ],
                    },
                    then: [
                      { op: 'MOVE_CARDS', target: { kind: 'SELF' }, toZone: 'BATTLEFIELD', triggerEntry: true },
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

  // PR-024 海妲魔女
  // 【起】丢弃手牌中的该牌：《海妲魔女》的该【起】能力每回合最多发动1次。
  // 公开我方牌组顶4张牌，选择其中最多1张<拉弥亚>角色或<神寂启示录>角色或《潮涌球》放置到墓地，将剩余的牌按任意顺序放置到牌组底。
  // 受限点：MOVE_CARDS (toZone: 'DECK_BOTTOM') 尚不支持手动指定余牌的任意顺序。
  {
    cardNumber: 'PR-024',
    name: '海妲魔女',
    vanillaEntry: true,
    activates: [
      {
        id: 'hand_mill_top4',
        usableZones: ['HAND'],
        oncePerTurnByPlayer: true,
        cost: { kind: 'DISCARD_SELF_FROM_HAND' },
        steps: [
          { op: 'REVEAL_TOP', count: 4, saveToVar: 'revealed' },
          {
            op: 'CHOOSE_FROM_VAR',
            varName: 'revealed',
            prompt: '【海妲魔女】选择其中最多1张<拉弥亚>角色、<神寂启示录>角色或《潮涌球》放置到墓地',
            filter: {
              anyFilters: [
                { cardType: CardType.ROLE, trait: '拉弥亚' },
                { cardType: CardType.ROLE, trait: '神寂启示录' },
                { exactName: '潮涌球' },
              ],
            },
            alwaysShow: true,
            min: 0,
            max: 1,
            saveToVar: 'picked',
            choiceEffectType: 'PRESET_PR_024_PICK',
          },
          { op: 'MOVE_CARDS', target: { kind: 'VAR', varName: 'picked' }, toZone: 'GRAVEYARD', isFaceUp: true },
          {
            op: 'MOVE_CARDS',
            target: { kind: 'REST_OF_VAR', allVar: 'revealed', excludeVar: 'picked' },
            toZone: 'DECK_BOTTOM',
          },
        ],
      },
    ],
  },

  // PR-025 混沌门使
  // 【起】丢弃手牌中的该牌：选择我方战场1张费用为2的角色或<神寂启示录>角色，可以丢弃手牌1张<21号>或<神寂启示录>。若如此做，直到回合结束为止，其PP+2000。
  {
    cardNumber: 'PR-025',
    name: '混沌门使',
    vanillaEntry: true,
    activates: [
      {
        id: 'hand_buff_role',
        usableZones: ['HAND'],
        cost: { kind: 'DISCARD_SELF_FROM_HAND' },
        steps: [
          {
            op: 'CHOOSE_ROLES',
            side: 'SELF',
            prompt: '【混沌门使】选择我方战场1张费用为2的角色或<神寂启示录>角色',
            filter: {
              anyFilters: [
                { minCost: 2, maxCost: 2 },
                { trait: '神寂启示录' },
              ],
            },
            min: 1,
            max: 1,
            saveToVar: 'target',
            choiceEffectType: 'PRESET_PR_025_TARGET',
          },
          {
            op: 'IF',
            condition: {
              kind: 'ALL',
              conditions: [
                { kind: 'VAR_NON_EMPTY', varName: 'target' },
                { kind: 'ZONE_COUNT', side: 'SELF', zone: 'HAND', filter: { anyTraits: ['21号', '神寂启示录'] }, op: '>=', value: 1 },
              ],
            },
            then: [
              {
                op: 'CONFIRM_YES_NO',
                prompt: '【混沌门使】是否丢弃手牌1张<21号>或<神寂启示录>，使所选角色 PP+2000？',
                yesLabel: '丢弃并 PP+2000',
                noLabel: '不丢弃',
                choiceEffectType: 'PRESET_PR_025_CONFIRM',
                onYes: [
                  {
                    op: 'CHOOSE_ZONE_CARDS',
                    side: 'SELF',
                    zone: 'HAND',
                    prompt: '【混沌门使】选择手牌1张<21号>或<神寂启示录>丢弃',
                    filter: { anyTraits: ['21号', '神寂启示录'] },
                    min: 1,
                    max: 1,
                    saveToVar: 'disc',
                    choiceEffectType: 'PRESET_DISCARD',
                  },
                  {
                    op: 'MOVE_CARDS',
                    target: { kind: 'VAR', varName: 'disc' },
                    toZone: 'GRAVEYARD',
                    isFaceUp: true,
                    saveMovedToVar: 'discMoved',
                  },
                  {
                    op: 'IF',
                    condition: { kind: 'VAR_NON_EMPTY', varName: 'discMoved' },
                    then: [
                      {
                        op: 'MODIFY_STATS',
                        target: { kind: 'VAR', varName: 'target' },
                        pp: 2000,
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
    ],
  },

  // PR-026 刻耳柏洛斯
  // 【出】：可以将我方墓地1张<神寂启示录>角色放置到牌组底。若如此做，选择我方墓地1张费用为2的<神寂启示录>角色，将其出场。
  {
    cardNumber: 'PR-026',
    name: '刻耳柏洛斯',
    entry: {
      steps: [
        {
          op: 'IF',
          condition: {
            kind: 'ZONE_COUNT',
            side: 'SELF',
            zone: 'GRAVEYARD',
            filter: { cardType: CardType.ROLE, trait: '神寂启示录' },
            op: '>=',
            value: 1,
          },
          then: [
            {
              op: 'CONFIRM_YES_NO',
              prompt: '【刻耳柏洛斯】【出】是否将我方墓地1张<神寂启示录>角色放置到牌组底？',
              yesLabel: '置底并复活费用2角色',
              noLabel: '不执行',
              choiceEffectType: 'PRESET_PR_026_CONFIRM',
              onYes: [
                {
                  op: 'CHOOSE_ZONE_CARDS',
                  side: 'SELF',
                  zone: 'GRAVEYARD',
                  prompt: '【刻耳柏洛斯】选择我方墓地1张<神寂启示录>角色放置到牌组底',
                  filter: { cardType: CardType.ROLE, trait: '神寂启示录' },
                  min: 1,
                  max: 1,
                  saveToVar: 'bot',
                  choiceEffectType: 'PRESET_PR_026_BOTTOM',
                },
                {
                  op: 'MOVE_CARDS',
                  target: { kind: 'VAR', varName: 'bot' },
                  toZone: 'DECK_BOTTOM',
                  saveMovedToVar: 'botMoved',
                },
                {
                  op: 'IF',
                  condition: { kind: 'VAR_NON_EMPTY', varName: 'botMoved' },
                  then: [
                    {
                      op: 'CHOOSE_ZONE_CARDS',
                      side: 'SELF',
                      zone: 'GRAVEYARD',
                      prompt: '【刻耳柏洛斯】选择我方墓地1张费用为2的<神寂启示录>角色出场',
                      filter: { cardType: CardType.ROLE, trait: '神寂启示录', minCost: 2, maxCost: 2 },
                      requireEmptySlot: true,
                      ineligibleReason: '战场没有空余卡位',
                      min: 1,
                      max: 1,
                      saveToVar: 'revive',
                      choiceEffectType: 'PRESET_DEPLOY',
                    },
                    {
                      op: 'MOVE_CARDS',
                      target: { kind: 'VAR', varName: 'revive' },
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
  },

  // PR-027 乌列尔
  // 【永】：【充能0】。 (由 rules/keywords.ts 解析)
  // 【出】：可以将我方墓地1张<神寂启示录>角色放置到牌组底。若如此做，抽1张牌。
  {
    cardNumber: 'PR-027',
    name: '乌列尔',
    entry: {
      steps: [
        {
          op: 'IF',
          condition: {
            kind: 'ZONE_COUNT',
            side: 'SELF',
            zone: 'GRAVEYARD',
            filter: { cardType: CardType.ROLE, trait: '神寂启示录' },
            op: '>=',
            value: 1,
          },
          then: [
            {
              op: 'CONFIRM_YES_NO',
              prompt: '【乌列尔】【出】是否将我方墓地1张<神寂启示录>角色放置到牌组底，抽1张牌？',
              yesLabel: '置底并抽1张牌',
              noLabel: '不执行',
              choiceEffectType: 'PRESET_PR_027_CONFIRM',
              onYes: [
                {
                  op: 'CHOOSE_ZONE_CARDS',
                  side: 'SELF',
                  zone: 'GRAVEYARD',
                  prompt: '【乌列尔】选择我方墓地1张<神寂启示录>角色放置到牌组底',
                  filter: { cardType: CardType.ROLE, trait: '神寂启示录' },
                  min: 1,
                  max: 1,
                  saveToVar: 'bot',
                  choiceEffectType: 'PRESET_PR_027_BOTTOM',
                },
                {
                  op: 'MOVE_CARDS',
                  target: { kind: 'VAR', varName: 'bot' },
                  toZone: 'DECK_BOTTOM',
                  saveMovedToVar: 'botMoved',
                },
                {
                  op: 'IF',
                  condition: { kind: 'VAR_NON_EMPTY', varName: 'botMoved' },
                  then: [{ op: 'DRAW', count: 1 }],
                },
              ],
            },
          ],
        },
      ],
    },
  },

  // PR-028 熠空
  // 【起】横置该牌：从以下2项选择1项。
  // ·若我方处理区存在浮空模式的《露西亚·誓焰》，抽1张牌。
  // ·选择我方处理区1张浮空模式的《露西亚·誓焰》，将其加入手牌。
  // 受限点：
  // 1. CardFilter 缺少 isAirborne (浮空模式) 过滤字段，无法区分处理区的浮空/非浮空《露西亚·誓焰》；
  // 2. CHOOSE_ZONE_CARDS 的有效区域不含 'PROCESSING'，且 ZoneManager.moveCard 尚无处理区浮空牌离场时将其下方/装备送墓的清理 (Q&A·7)。
  {
    cardNumber: 'PR-028',
    name: '熠空',
    vanillaEntry: true,
    activate: {
      cost: { kind: 'TAP_SELF' },
      steps: [
        {
          op: 'CHOOSE_MODE',
          prompt: '【熠空】从以下2项选择1项',
          choiceEffectType: 'PRESET_PR_028_MODE',
          modes: [
            {
              id: 'draw_if_airborne',
              label: '若我方处理区存在浮空模式的《露西亚·誓焰》，抽1张牌',
              steps: [
                {
                  op: 'IF',
                  condition: {
                    kind: 'ZONE_COUNT',
                    side: 'SELF',
                    zone: 'PROCESSING',
                    filter: { exactName: '露西亚·誓焰' },
                    op: '>=',
                    value: 1,
                  },
                  then: [{ op: 'DRAW', count: 1 }],
                },
              ],
            },
            {
              id: 'return_airborne_to_hand',
              label: '选择我方处理区1张浮空模式的《露西亚·誓焰》加入手牌 (尚缺 PROCESSING 区域选择与 isAirborne 过滤)',
              steps: [],
            },
          ],
        },
      ],
    },
  },

  // PR-029 丽芙·极昼
  // 【出】：若我方牌组为10张及以下，将我方墓地所有信号球牌以外的牌加入牌组并洗切。
  // 受限点：ZONE_CARDS 目标暂不支持 'GRAVEYARD' 批量全选，暂以 CHOOSE_ZONE_CARDS(min/max 999) 实现墓地非信号球全选回收并洗切。
  {
    cardNumber: 'PR-029',
    name: '丽芙·极昼',
    entry: {
      steps: [
        {
          op: 'IF',
          condition: { kind: 'ZONE_COUNT', side: 'SELF', zone: 'DECK', op: '<=', value: 10 },
          then: [
            {
              op: 'CHOOSE_ZONE_CARDS',
              side: 'SELF',
              zone: 'GRAVEYARD',
              prompt: '【丽芙·极昼】【出】将我方墓地所有信号球牌以外的牌加入牌组并洗切',
              filter: { isSignalOrb: false },
              min: 999,
              max: 999,
              saveToVar: 'nonOrbs',
              choiceEffectType: 'PRESET_PR_029_SHUFFLE_GY',
            },
            { op: 'MOVE_CARDS', target: { kind: 'VAR', varName: 'nonOrbs' }, toZone: 'DECK_SHUFFLE' },
          ],
        },
      ],
    },
  },

  // PR-030 里·超刻
  // 【充能自】及标准信号球特性由 card-effects.ts 内置 PR030_CHARGE_AUTO_ORB 处理；无其余【出】/【永】能力。
  {
    cardNumber: 'PR-030',
    name: '里·超刻',
    vanillaEntry: true,
    isSignalOrbCard: true,
  },

  // PR-031 七实·芒星之迹
  // 【永】：攻击时支付费用/置雷属性手牌至信号球区底的完整逻辑已由 combat-manager.ts & engine.ts (PR031_ATTACK_PAY_ORB) 内置处置。
  {
    cardNumber: 'PR-031',
    name: '七实·芒星之迹',
    vanillaEntry: true,
  },

  // PR-032 倚靠
  // 【瞬时】：该牌只能在自由时点步骤发动。可以将我方战场1张《罗塞塔·凛冽》返回手牌。若如此做，选择我方战场1张《罗塞塔·凛冽》，直到那次攻击结束为止，其PP+1500。
  // 注：engine.ts checkInstantTiming 已精确校验 window?.kind === 'FREE_TIMING'。
  {
    cardNumber: 'PR-032',
    name: '倚靠',
    playPrecondition: {
      condition: { kind: 'CURRENT_COMBAT_EXISTS' },
      errorMessage: '只能在战斗自由时点步骤发动',
    },
    tactics: [
      {
        op: 'IF',
        condition: { kind: 'HAS_ROLE', side: 'SELF', filter: { exactName: '罗塞塔·凛冽' } },
        then: [
          {
            op: 'CONFIRM_YES_NO',
            prompt: '【倚靠】是否将我方战场1张《罗塞塔·凛冽》返回手牌？',
            yesLabel: '返回手牌并增益另一张',
            noLabel: '不执行',
            choiceEffectType: 'PRESET_PR_032_CONFIRM',
            onYes: [
              {
                op: 'CHOOSE_ROLES',
                side: 'SELF',
                prompt: '【倚靠】选择我方战场1张《罗塞塔·凛冽》返回手牌',
                filter: { exactName: '罗塞塔·凛冽' },
                min: 1,
                max: 1,
                saveToVar: 'bounced',
                choiceEffectType: 'PRESET_PR_032_BOUNCE',
              },
              {
                op: 'MOVE_CARDS',
                target: { kind: 'VAR', varName: 'bounced' },
                toZone: 'HAND',
                isFaceUp: true,
                saveMovedToVar: 'bouncedMoved',
              },
              {
                op: 'IF',
                condition: { kind: 'VAR_NON_EMPTY', varName: 'bouncedMoved' },
                then: [
                  {
                    op: 'CHOOSE_ROLES',
                    side: 'SELF',
                    prompt: '【倚靠】选择我方战场1张《罗塞塔·凛冽》PP+1500 (直到那次攻击结束)',
                    filter: { exactName: '罗塞塔·凛冽' },
                    min: 1,
                    max: 1,
                    saveToVar: 'buffTarget',
                    choiceEffectType: 'PRESET_PR_032_BUFF',
                  },
                  {
                    op: 'MODIFY_STATS',
                    target: { kind: 'VAR', varName: 'buffTarget' },
                    pp: 1500,
                    duration: 'END_OF_COMBAT',
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  },

  // PR-033 绚烂即兴秀
  // 若我方费用区的《艾拉·万华》为5张及以上，选择我方费用区最多2张卡牌编号不同的冰属性角色，将其出场。下个对方回合结束时，将其从战场放置到牌组底。
  // (3.6.3.b.2) 仅参照正面表示的明费。
  {
    cardNumber: 'PR-033',
    name: '绚烂即兴秀',
    tactics: [
      {
        op: 'IF',
        condition: {
          kind: 'ZONE_COUNT',
          side: 'SELF',
          zone: 'COST',
          filter: { exactName: '艾拉·万华', isFaceUp: true },
          op: '>=',
          value: 5,
        },
        then: [
          {
            op: 'CHOOSE_ZONE_CARDS',
            side: 'SELF',
            zone: 'COST',
            prompt: '【绚烂即兴秀】选择我方费用区最多2张卡牌编号不同的冰属性角色出场',
            filter: { cardType: CardType.ROLE, attribute: ElementAttribute.ICE, isFaceUp: true },
            uniqueCardNumbers: true,
            requireEmptySlot: true,
            ineligibleReason: '战场没有空余卡位',
            min: 0,
            max: 2,
            saveToVar: 'pickedRoles',
            choiceEffectType: 'PRESET_PR_033_DEPLOY',
          },
          {
            op: 'MOVE_CARDS',
            target: { kind: 'VAR', varName: 'pickedRoles' },
            toZone: 'BATTLEFIELD',
            triggerEntry: true,
            saveMovedToVar: 'deployed',
          },
          {
            op: 'IF',
            condition: { kind: 'VAR_NON_EMPTY', varName: 'deployed' },
            then: [
              {
                op: 'REGISTER_DELAYED_TRIGGER',
                target: { kind: 'VAR', varName: 'deployed' },
                eventType: 'END_PHASE_TRIGGERS',
                turnOffset: 1,
                abilityId: 'DELAYED_END_OF_TURN_TO_DECK_BOTTOM',
                expectedZone: 'BATTLEFIELD',
                labelSuffix: '下个对方回合结束时从战场放置到牌组底 (PR-033)',
              },
            ],
          },
        ],
      },
    ],
  },

  // PR-034 另一人
  // 该牌只能在我方战场存在<艺术协会>时才能使用。
  // 【瞬时】：从以下2项选择1项。
  // ·抽1张牌。
  // ·若该回合中我方已受到的伤害为3及以上，选择对方战场1张攻击中的角色，直到那次攻击结束为止，其不能造成伤害。
  // 受限点：CardFilter 缺少 isAttacking 过滤条件，且 PREVENT_COMBAT_DAMAGE 直接作用于当前战斗。
  {
    cardNumber: 'PR-034',
    name: '另一人',
    playPrecondition: {
      condition: {
        kind: 'ZONE_COUNT',
        side: 'SELF',
        zone: 'BATTLEFIELD',
        filter: { trait: '艺术协会' },
        op: '>=',
        value: 1,
      },
      errorMessage: '该牌只能在我方战场存在<艺术协会>时才能使用',
    },
    tactics: [
      {
        op: 'CHOOSE_MODE',
        prompt: '【另一人】从以下2项选择1项',
        choiceEffectType: 'PRESET_PR_034_MODE',
        modes: [
          {
            id: 'draw_1',
            label: '抽1张牌',
            steps: [{ op: 'DRAW', count: 1 }],
          },
          {
            id: 'prevent_damage',
            label: '若本回合已受伤害>=3，选择对方攻击中角色，本次攻击不能造成伤害',
            steps: [
              {
                op: 'IF',
                condition: { kind: 'DAMAGE_TAKEN_THIS_TURN', side: 'SELF', op: '>=', value: 3 },
                then: [
                  {
                    op: 'CHOOSE_ROLES',
                    side: 'OPPONENT',
                    prompt: '【另一人】选择对方战场1张攻击中的角色',
                    min: 1,
                    max: 1,
                    saveToVar: 'oppAttacker',
                    choiceEffectType: 'PRESET_PR_034_TARGET',
                  },
                  {
                    op: 'IF',
                    condition: { kind: 'VAR_NON_EMPTY', varName: 'oppAttacker' },
                    then: [{ op: 'PREVENT_COMBAT_DAMAGE' }],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  },

  // PR-035 升格
  // 该牌只能在我方战场存在<升格者>角色时才能使用。
  // 【瞬时】：选择我方或对方战场1张不为<升格者>的角色，直到下个回合结束为止，其失去原本的卡牌特征，获得<升格者>。
  {
    cardNumber: 'PR-035',
    name: '升格',
    playPrecondition: {
      condition: { kind: 'HAS_ROLE', side: 'SELF', filter: { trait: '升格者' } },
      errorMessage: '该牌只能在我方战场存在<升格者>角色时才能使用',
    },
    tactics: [
      {
        op: 'CHOOSE_ROLES',
        side: 'ANY',
        prompt: '【升格】选择我方或对方战场1张不为<升格者>的角色',
        filter: { excludeTrait: '升格者' },
        min: 1,
        max: 1,
        saveToVar: 'target',
        choiceEffectType: 'PRESET_PR_035_TARGET',
      },
      {
        op: 'MODIFY_STATS',
        target: { kind: 'VAR', varName: 'target' },
        clearBaseTraits: true,
        addTraits: ['升格者'],
        duration: 'END_OF_NEXT_TURN',
      },
    ],
  },

  // PR-036 饥荒骑士
  // 【起】丢弃手牌中的该牌：可以丢弃手牌1张<莉莉丝>或<神寂启示录>。若如此做，该回合结束时，抽2张牌。
  // 【起】【3费】：若该牌存在于墓地，可以将我方墓地1张<神寂启示录>角色放置到牌组底。若如此做，将该牌从墓地出场。
  {
    cardNumber: 'PR-036',
    name: '饥荒骑士',
    vanillaEntry: true,
    activates: [
      {
        id: 'hand_delayed_draw',
        usableZones: ['HAND'],
        cost: { kind: 'DISCARD_SELF_FROM_HAND' },
        steps: [
          {
            op: 'IF',
            condition: {
              kind: 'ZONE_COUNT',
              side: 'SELF',
              zone: 'HAND',
              filter: { anyTraits: ['莉莉丝', '神寂启示录'] },
              op: '>=',
              value: 1,
            },
            then: [
              {
                op: 'CONFIRM_YES_NO',
                prompt: '【饥荒骑士】是否丢弃手牌1张<莉莉丝>或<神寂启示录>？若如此做，该回合结束时抽2张牌',
                yesLabel: '丢弃并预约回合结束抽2张',
                noLabel: '不丢弃',
                choiceEffectType: 'PRESET_PR_036_CONFIRM',
                onYes: [
                  {
                    op: 'CHOOSE_ZONE_CARDS',
                    side: 'SELF',
                    zone: 'HAND',
                    prompt: '【饥荒骑士】选择手牌1张<莉莉丝>或<神寂启示录>丢弃',
                    filter: { anyTraits: ['莉莉丝', '神寂启示录'] },
                    min: 1,
                    max: 1,
                    saveToVar: 'disc',
                    choiceEffectType: 'PRESET_DISCARD',
                  },
                  {
                    op: 'MOVE_CARDS',
                    target: { kind: 'VAR', varName: 'disc' },
                    toZone: 'GRAVEYARD',
                    isFaceUp: true,
                    saveMovedToVar: 'discMoved',
                  },
                  {
                    op: 'IF',
                    condition: { kind: 'VAR_NON_EMPTY', varName: 'discMoved' },
                    then: [
                      {
                        op: 'REGISTER_DELAYED_TRIGGER',
                        target: { kind: 'SELF' },
                        eventType: 'END_PHASE_TRIGGERS',
                        turnOffset: 0,
                        abilityId: 'DELAYED_END_OF_TURN_DRAW',
                        drawCount: 2,
                        labelSuffix: '该回合结束时抽2张牌 (PR-036)',
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
        id: 'gy_revive',
        usableZones: ['GRAVEYARD'],
        cost: { kind: 'PAY_COST', amount: 3 },
        steps: [
          {
            op: 'IF',
            condition: {
              kind: 'ZONE_COUNT',
              side: 'SELF',
              zone: 'GRAVEYARD',
              filter: { cardType: CardType.ROLE, trait: '神寂启示录' },
              op: '>=',
              value: 1,
            },
            then: [
              {
                op: 'CONFIRM_YES_NO',
                prompt: '【饥荒骑士】是否将我方墓地1张<神寂启示录>角色放置到牌组底，将该牌从墓地出场？',
                yesLabel: '置底并出场',
                noLabel: '不执行',
                choiceEffectType: 'PRESET_PR_036_REVIVE_CONFIRM',
                onYes: [
                  {
                    op: 'CHOOSE_ZONE_CARDS',
                    side: 'SELF',
                    zone: 'GRAVEYARD',
                    prompt: '【饥荒骑士】选择我方墓地1张<神寂启示录>角色放置到牌组底',
                    filter: { cardType: CardType.ROLE, trait: '神寂启示录' },
                    min: 1,
                    max: 1,
                    saveToVar: 'bot',
                    choiceEffectType: 'PRESET_PR_036_BOTTOM',
                  },
                  {
                    op: 'MOVE_CARDS',
                    target: { kind: 'VAR', varName: 'bot' },
                    toZone: 'DECK_BOTTOM',
                    saveMovedToVar: 'botMoved',
                  },
                  {
                    op: 'IF',
                    condition: {
                      kind: 'ALL',
                      conditions: [
                        { kind: 'VAR_NON_EMPTY', varName: 'botMoved' },
                        { kind: 'SELF_MATCHES_FILTER', filter: { inZone: 'GRAVEYARD' } },
                        { kind: 'HAS_EMPTY_SLOT', side: 'SELF' },
                      ],
                    },
                    then: [
                      { op: 'MOVE_CARDS', target: { kind: 'SELF' }, toZone: 'BATTLEFIELD', triggerEntry: true },
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

  // PR-037 拉斐尔夫人
  // 【起】【回合1】丢弃手牌1张<神寂启示录>：直到回合结束为止，该牌获得【充能+1】。
  {
    cardNumber: 'PR-037',
    name: '拉斐尔夫人',
    vanillaEntry: true,
    activate: {
      oncePerTurn: true,
      cost: {
        kind: 'DISCARD_HAND',
        count: 1,
        filter: { trait: '神寂启示录' },
        optional: false,
        prompt: '【拉斐尔夫人】丢弃手牌1张<神寂启示录>：获得【充能+1】',
        choiceEffectType: 'PRESET_DISCARD_COST',
      },
      steps: [
        {
          op: 'MODIFY_STATS',
          target: { kind: 'SELF' },
          charge: 1,
          duration: 'END_OF_TURN',
        },
      ],
    },
  },

  // PR-038 前任玛门
  // 【自】：该牌攻击时，可以将我方墓地1张<神寂启示录>角色放置到牌组底。若如此做，直到回合结束为止，该牌DP+1。
  {
    cardNumber: 'PR-038',
    name: '前任玛门',
    vanillaEntry: true,
    triggers: [
      {
        abilityId: 'PR_038_ON_ATTACK',
        eventType: 'ATTACK_DECLARED',
        matcher: { kind: 'SELF_ATTACKING' },
        label: '【前任玛门】攻击时：可将墓地1张<神寂启示录>角色置底，该牌 DP+1',
        steps: [
          {
            op: 'IF',
            condition: {
              kind: 'ZONE_COUNT',
              side: 'SELF',
              zone: 'GRAVEYARD',
              filter: { cardType: CardType.ROLE, trait: '神寂启示录' },
              op: '>=',
              value: 1,
            },
            then: [
              {
                op: 'CONFIRM_YES_NO',
                prompt: '【前任玛门】是否将我方墓地1张<神寂启示录>角色放置到牌组底？若如此做，直到回合结束为止该牌 DP+1',
                yesLabel: '置底并 DP+1',
                noLabel: '不执行',
                choiceEffectType: 'PRESET_PR_038_CONFIRM',
                onYes: [
                  {
                    op: 'CHOOSE_ZONE_CARDS',
                    side: 'SELF',
                    zone: 'GRAVEYARD',
                    prompt: '【前任玛门】选择我方墓地1张<神寂启示录>角色放置到牌组底',
                    filter: { cardType: CardType.ROLE, trait: '神寂启示录' },
                    min: 1,
                    max: 1,
                    saveToVar: 'bot',
                    choiceEffectType: 'PRESET_PR_038_BOTTOM',
                  },
                  {
                    op: 'MOVE_CARDS',
                    target: { kind: 'VAR', varName: 'bot' },
                    toZone: 'DECK_BOTTOM',
                    saveMovedToVar: 'botMoved',
                  },
                  {
                    op: 'IF',
                    condition: { kind: 'VAR_NON_EMPTY', varName: 'botMoved' },
                    then: [
                      {
                        op: 'MODIFY_STATS',
                        target: { kind: 'SELF' },
                        dp: 1,
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
    ],
  },

  // PR-039 加百列
  // 【起】：《加百列》的该能力每回合最多发动1次。若该牌存在于墓地，可以将该牌以外的我方墓地3张<神寂启示录>角色按任意顺序放置到牌组底
  // 并将我方2张《加百列》以外的<神寂启示录>角色从战场放置到墓地。若如此做，将该牌从墓地出场。
  // 受限点：MOVE_CARDS (toZone: 'DECK_BOTTOM') 按选中顺序置底，若无交互重排步骤则无法在多张同时置底时单独调序。
  {
    cardNumber: 'PR-039',
    name: '加百列',
    vanillaEntry: true,
    activates: [
      {
        id: 'gy_revive_gabriel',
        usableZones: ['GRAVEYARD'],
        oncePerTurnByPlayer: true,
        condition: {
          kind: 'ALL',
          conditions: [
            {
              kind: 'ZONE_COUNT',
              side: 'SELF',
              zone: 'GRAVEYARD',
              filter: { cardType: CardType.ROLE, trait: '神寂启示录', excludeSelf: true },
              op: '>=',
              value: 3,
            },
            {
              kind: 'HAS_ROLE',
              side: 'SELF',
              filter: { trait: '神寂启示录', excludeName: '加百列' },
              minCount: 2,
            },
          ],
        },
        conditionError: '需要墓地有3张其他<神寂启示录>角色且战场有2张《加百列》以外的<神寂启示录>角色',
        steps: [
          {
            op: 'CHOOSE_ZONE_CARDS',
            side: 'SELF',
            zone: 'GRAVEYARD',
            prompt: '【加百列】选择该牌以外的我方墓地3张<神寂启示录>角色放置到牌组底',
            filter: { cardType: CardType.ROLE, trait: '神寂启示录', excludeSelf: true },
            min: 3,
            max: 3,
            saveToVar: 'bot3',
            choiceEffectType: 'PRESET_PR_039_BOTTOM',
          },
          {
            op: 'CHOOSE_ROLES',
            side: 'SELF',
            prompt: '【加百列】选择我方战场2张《加百列》以外的<神寂启示录>角色放置到墓地',
            filter: { trait: '神寂启示录', excludeName: '加百列' },
            min: 2,
            max: 2,
            saveToVar: 'sac2',
            choiceEffectType: 'PRESET_PR_039_SAC',
          },
          {
            op: 'IF',
            condition: {
              kind: 'ALL',
              conditions: [
                { kind: 'VAR_COUNT_COMPARE', varName: 'bot3', op: '>=', value: 3 },
                { kind: 'VAR_COUNT_COMPARE', varName: 'sac2', op: '>=', value: 2 },
              ],
            },
            then: [
              {
                op: 'MOVE_CARDS',
                target: { kind: 'VAR', varName: 'bot3' },
                toZone: 'DECK_BOTTOM',
                saveMovedToVar: 'botMoved',
              },
              {
                op: 'MOVE_CARDS',
                target: { kind: 'VAR', varName: 'sac2' },
                toZone: 'GRAVEYARD',
                isFaceUp: true,
                saveMovedToVar: 'sacMoved',
              },
              {
                op: 'IF',
                condition: {
                  kind: 'ALL',
                  conditions: [
                    { kind: 'VAR_COUNT_COMPARE', varName: 'botMoved', op: '>=', value: 3 },
                    { kind: 'VAR_COUNT_COMPARE', varName: 'sacMoved', op: '>=', value: 2 },
                    { kind: 'HAS_EMPTY_SLOT', side: 'SELF' },
                  ],
                },
                then: [{ op: 'MOVE_CARDS', target: { kind: 'SELF' }, toZone: 'BATTLEFIELD', triggerEntry: true }],
              },
            ],
          },
        ],
      },
    ],
  },

  // PR-040 天幕的光明永不褪色
  // 【瞬时】：我方玩家被攻击时才能发动。将我方牌组顶3张牌放置到墓地，若因此方法将<神寂启示录>放置到墓地，那次攻击不能造成伤害。
  // 注：engine.ts checkInstantTiming 已精确校验 combat?.targetType === 'PLAYER' 且在对方回合自由时点。
  {
    cardNumber: 'PR-040',
    name: '天幕的光明永不褪色',
    playPrecondition: {
      condition: {
        kind: 'ALL',
        conditions: [
          { kind: 'CURRENT_COMBAT_EXISTS' },
          { kind: 'TURN_OWNER', isSelfTurn: false },
        ],
      },
      errorMessage: '我方玩家被攻击时才能发动',
    },
    tactics: [
      { op: 'MILL', count: 3, side: 'SELF', saveToVar: 'milled' },
      {
        op: 'IF',
        condition: {
          kind: 'VAR_HAS_CARD_MATCHING',
          varName: 'milled',
          filter: { trait: '神寂启示录' },
        },
        then: [{ op: 'PREVENT_COMBAT_DAMAGE' }],
      },
    ],
  },

  // PR-041 肃噩
  // 【自】：我方回合结束时，可以将我方手牌或墓地1张空属性的牌放置到该牌下方。若如此做，直到下个回合结束为止，
  // 战场的该牌的卡牌类型变为角色牌牌，PP变为4000，DP变为0。直到回合结束为止，该牌不会因效果放置到角色牌下方。
  // 【起】横置该牌：选择我方战场1张《露娜·终焉》，将该牌以及该牌下方的所有牌放置到其下方。
  // 注：MODIFY_STATS 对 { kind: 'SELF' } 会跳过非角色牌 (isSlotRole 为 false)，因此使用 ZONE_CARDS(BATTLEFIELD) 精确定位战场上的《肃噩》。
  // 受限点 (第 2 项【起】)：MOVE_CARDS 将该牌置入《露娜·终焉》下方时会触发 handleCardLeaveField 将该牌原本下方的牌送墓，
  // 且 CardTargetRef / ZONE_CARDS 尚不支持 'SELF_UNDERNEATH' 批量获取辅助机下方所有卡牌一起转移。
  {
    cardNumber: 'PR-041',
    name: '肃噩',
    vanillaEntry: true,
    triggers: [
      {
        abilityId: 'PR_041_END_TURN_MORPH',
        eventType: 'END_PHASE_TRIGGERS',
        matcher: { kind: 'SELF_TURN_END', isSelfTurn: true },
        label: '【肃噩】我方回合结束时：可置入空属性牌至下方并变为 PP4000/DP0 角色牌',
        steps: [
          {
            op: 'IF',
            condition: {
              kind: 'ANY',
              conditions: [
                { kind: 'ZONE_COUNT', side: 'SELF', zone: 'HAND', filter: { attribute: ElementAttribute.VOID }, op: '>=', value: 1 },
                { kind: 'ZONE_COUNT', side: 'SELF', zone: 'GRAVEYARD', filter: { attribute: ElementAttribute.VOID }, op: '>=', value: 1 },
              ],
            },
            then: [
              {
                op: 'CONFIRM_YES_NO',
                prompt: '【肃噩】是否将手牌或墓地1张空属性的牌放置到该牌下方，并使其变为 PP4000/DP0 角色牌？',
                yesLabel: '置入并变为角色牌',
                noLabel: '不执行',
                choiceEffectType: 'PRESET_PR_041_CONFIRM',
                onYes: [
                  {
                    op: 'CHOOSE_ZONE_CARDS',
                    side: 'SELF',
                    zone: 'HAND',
                    zones: ['HAND', 'GRAVEYARD'],
                    prompt: '【肃噩】选择手牌或墓地1张空属性的牌放置到该牌下方',
                    filter: { attribute: ElementAttribute.VOID },
                    min: 1,
                    max: 1,
                    saveToVar: 'voidCard',
                    choiceEffectType: 'PRESET_PR_041_TUCK',
                  },
                  {
                    op: 'MOVE_CARDS',
                    target: { kind: 'VAR', varName: 'voidCard' },
                    toZone: 'UNDERNEATH',
                    underneathHost: { kind: 'SELF' },
                    isFaceUp: true,
                    saveMovedToVar: 'placed',
                  },
                  {
                    op: 'IF',
                    condition: { kind: 'VAR_NON_EMPTY', varName: 'placed' },
                    then: [
                      {
                        op: 'MODIFY_STATS',
                        target: { kind: 'ZONE_CARDS', side: 'SELF', zone: 'BATTLEFIELD', filter: { exactName: '肃噩' } },
                        setCardType: CardType.ROLE,
                        setPP: 4000,
                        setDP: 0,
                        duration: 'END_OF_NEXT_TURN',
                      },
                      {
                        op: 'MODIFY_STATS',
                        target: { kind: 'ZONE_CARDS', side: 'SELF', zone: 'BATTLEFIELD', filter: { exactName: '肃噩' } },
                        prohibitions: ['CANNOT_BE_PLACED_UNDERNEATH'],
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
    ],
    activate: {
      cost: { kind: 'TAP_SELF' },
      condition: { kind: 'HAS_ROLE', side: 'SELF', filter: { exactName: '露娜·终焉' } },
      conditionError: '我方战场不存在《露娜·终焉》',
      steps: [
        {
          op: 'CHOOSE_ROLES',
          side: 'SELF',
          prompt: '【肃噩】选择我方战场1张《露娜·终焉》，将该牌及其下方牌放置到其下方',
          filter: { exactName: '露娜·终焉' },
          min: 1,
          max: 1,
          saveToVar: 'luna',
          choiceEffectType: 'PRESET_PR_041_LUNA',
        },
        {
          op: 'MOVE_CARDS',
          target: { kind: 'SELF' },
          toZone: 'UNDERNEATH',
          underneathHost: { kind: 'VAR', varName: 'luna' },
          isFaceUp: true,
        },
      ],
    },
  },

  // PR-042 聚焰淬夜
  // 【瞬时战术牌】：选择我方战场1张攻击中的或被攻击的《薇拉·灼惘》，直到那次攻击结束为止，其PP+2000。
  // 若该回合中我方已受到的伤害为1点及以上，改为直到下个回合结束为止，其PP+2000。
  // 受限点：CardFilter 缺少战斗中状态过滤字段 (isAttacking / isBeingAttacked)。
  {
    cardNumber: 'PR-042',
    name: '聚焰淬夜',
    tactics: [
      {
        op: 'CHOOSE_ROLES',
        side: 'SELF',
        prompt: '【聚焰淬夜】选择我方战场1张《薇拉·灼惘》PP+2000',
        filter: { exactName: '薇拉·灼惘' },
        min: 1,
        max: 1,
        saveToVar: 'target',
        choiceEffectType: 'PRESET_PR_042_BUFF',
      },
      {
        op: 'IF',
        condition: { kind: 'DAMAGE_TAKEN_THIS_TURN', side: 'SELF', op: '>=', value: 1 },
        then: [
          {
            op: 'MODIFY_STATS',
            target: { kind: 'VAR', varName: 'target' },
            pp: 2000,
            duration: 'END_OF_NEXT_TURN',
          },
        ],
        else: [
          {
            op: 'MODIFY_STATS',
            target: { kind: 'VAR', varName: 'target' },
            pp: 2000,
            duration: 'END_OF_COMBAT',
          },
        ],
      },
    ],
  },

  // PR-043 夜蝠
  // 【起】横置该牌：选择我方战场1张<遗忘者>角色牌破坏。若如此做，选择我方墓地1张《炽能球》，将其放置到我方信号球区最上方。
  {
    cardNumber: 'PR-043',
    name: '夜蝠',
    vanillaEntry: true,
    activate: {
      cost: { kind: 'TAP_SELF' },
      steps: [
        {
          op: 'CHOOSE_ROLES',
          side: 'SELF',
          prompt: '【夜蝠】选择我方战场1张<遗忘者>角色破坏',
          filter: { trait: '遗忘者' },
          min: 1,
          max: 1,
          saveToVar: 'sacTarget',
          choiceEffectType: 'PRESET_PR_043_SAC',
        },
        {
          op: 'DESTROY_ROLES',
          target: { kind: 'VAR', varName: 'sacTarget' },
          saveDestroyedToVar: 'destroyed',
        },
        {
          op: 'IF',
          condition: { kind: 'VAR_NON_EMPTY', varName: 'destroyed' },
          then: [
            {
              op: 'CHOOSE_ZONE_CARDS',
              side: 'SELF',
              zone: 'GRAVEYARD',
              prompt: '【夜蝠】选择我方墓地1张《炽能球》放置到信号球区最上方',
              filter: { exactName: '炽能球' },
              min: 1,
              max: 1,
              saveToVar: 'orb',
              choiceEffectType: 'PRESET_PR_043_ORB',
            },
            { op: 'MOVE_CARDS', target: { kind: 'VAR', varName: 'orb' }, toZone: 'SIGNAL_ORB', isFaceUp: true },
          ],
        },
      ],
    },
  },

  // PR-044 卡列尼娜· 辉晓 (注意卡表中点号后含一个空格)
  // 【永】：【充能0】。 (由 rules/keywords.ts 解析)
  // 【自】：该牌攻击时，可以丢弃1张手牌。若如此做，选择我方墓地1张暗属性协战角色牌，将其加入手牌。
  {
    cardNumber: 'PR-044',
    name: '卡列尼娜· 辉晓',
    vanillaEntry: true,
    triggers: [
      {
        abilityId: 'PR_044_ON_ATTACK',
        eventType: 'ATTACK_DECLARED',
        matcher: { kind: 'SELF_ATTACKING' },
        label: '【卡列尼娜· 辉晓】攻击时：可丢弃1张手牌，回收墓地暗属性协战角色',
        cost: {
          kind: 'DISCARD_HAND',
          count: 1,
          optional: true,
          prompt: '【卡列尼娜· 辉晓】攻击时是否丢弃1张手牌：从墓地回收1张暗属性协战角色？',
          choiceEffectType: 'PRESET_DISCARD_COST',
        },
        steps: [
          {
            op: 'CHOOSE_ZONE_CARDS',
            side: 'SELF',
            zone: 'GRAVEYARD',
            prompt: '【卡列尼娜· 辉晓】选择我方墓地1张暗属性协战角色加入手牌',
            filter: { cardType: CardType.ROLE, attribute: ElementAttribute.DARK, hasAssistConfig: true },
            min: 1,
            max: 1,
            saveToVar: 'picked',
            choiceEffectType: 'PRESET_TO_HAND',
          },
          { op: 'MOVE_CARDS', target: { kind: 'VAR', varName: 'picked' }, toZone: 'HAND', isFaceUp: true },
        ],
      },
    ],
  },

  // PR-045 决行预兆 亚里莎&塞西莉
  // 【协战搭档】费用4及以下的<亚里莎>或<塞西莉>
  // 【协战代价】手牌【2费】/战场【0费】
  // 【自】：该牌获得协战搭档或成为协战搭档时，选择我方战场1张<亚里莎>角色牌或<塞西莉>角色牌，直到回合结束为止，其PP+1000。
  {
    cardNumber: 'PR-045',
    name: '决行预兆 亚里莎&塞西莉',
    vanillaEntry: true,
    triggers: [
      {
        abilityId: 'PR_045_ON_GAINED_PARTNER',
        eventType: 'PARTNER_GAINED',
        matcher: { kind: 'SELF_GAINED_PARTNER' },
        label: '【决行预兆 亚里莎&塞西莉】获得搭档时：<亚里莎>或<塞西莉>角色 PP+1000',
        steps: [
          {
            op: 'CHOOSE_ROLES',
            side: 'SELF',
            prompt: '【决行预兆 亚里莎&塞西莉】选择我方战场1张<亚里莎>或<塞西莉>角色 PP+1000',
            filter: { anyTraits: ['亚里莎', '塞西莉'] },
            min: 1,
            max: 1,
            saveToVar: 'target',
            choiceEffectType: 'PRESET_PR_045_PP',
          },
          { op: 'MODIFY_STATS', target: { kind: 'VAR', varName: 'target' }, pp: 1000, duration: 'END_OF_TURN' },
        ],
      },
      {
        abilityId: 'PR_045_ON_BECAME_PARTNER',
        eventType: 'PARTNER_GAINED',
        matcher: { kind: 'SELF_BECAME_PARTNER' },
        label: '【决行预兆 亚里莎&塞西莉】成为搭档时：<亚里莎>或<塞西莉>角色 PP+1000',
        steps: [
          {
            op: 'CHOOSE_ROLES',
            side: 'SELF',
            prompt: '【决行预兆 亚里莎&塞西莉】选择我方战场1张<亚里莎>或<塞西莉>角色 PP+1000',
            filter: { anyTraits: ['亚里莎', '塞西莉'] },
            min: 1,
            max: 1,
            saveToVar: 'target',
            choiceEffectType: 'PRESET_PR_045_PP',
          },
          { op: 'MODIFY_STATS', target: { kind: 'VAR', varName: 'target' }, pp: 1000, duration: 'END_OF_TURN' },
        ],
      },
    ],
  },

  // PR-046 执铭化刃
  // 【永】：该牌的卡牌情报因冰属性卡牌的能力被参照时，卡牌特征获得<万世铭>。
  // 可以将我方费用区或墓地共计1张《万世铭》和共计1张《万世铭·重铸》加入牌组并洗切。若如此做，选择我方战场1张《曲·启明》，将其竖直。
  // 若此回合中我方消除过【3任意信号球】，追加将该牌以横置状态放置到费用区。
  // (3.6.3.b.2) 仅参照费用区正面表示的明费；(Q&A·9) 在所有区域均视为<万世铭>。
  {
    cardNumber: 'PR-046',
    name: '执铭化刃',
    staticEffects: [
      {
        id: 'PR-046_STATIC_WANSHIMING_TRAIT',
        scope: 'SELF',
        sourceZones: ['BATTLEFIELD', 'HAND', 'GRAVEYARD', 'SIGNAL_ORB', 'COST', 'PROCESSING', 'DECK'],
        addTraits: ['万世铭'],
      },
    ],
    tactics: [
      {
        op: 'IF',
        condition: {
          kind: 'ALL',
          conditions: [
            {
              kind: 'ANY',
              conditions: [
                { kind: 'ZONE_COUNT', side: 'SELF', zone: 'COST', filter: { exactName: '万世铭', isFaceUp: true }, op: '>=', value: 1 },
                { kind: 'ZONE_COUNT', side: 'SELF', zone: 'GRAVEYARD', filter: { exactName: '万世铭' }, op: '>=', value: 1 },
              ],
            },
            {
              kind: 'ANY',
              conditions: [
                { kind: 'ZONE_COUNT', side: 'SELF', zone: 'COST', filter: { exactName: '万世铭·重铸', isFaceUp: true }, op: '>=', value: 1 },
                { kind: 'ZONE_COUNT', side: 'SELF', zone: 'GRAVEYARD', filter: { exactName: '万世铭·重铸' }, op: '>=', value: 1 },
              ],
            },
          ],
        },
        then: [
          {
            op: 'CONFIRM_YES_NO',
            prompt: '【执铭化刃】是否将我方费用区或墓地1张《万世铭》和1张《万世铭·重铸》加入牌组并洗切？',
            yesLabel: '洗回并竖直《曲·启明》',
            noLabel: '不执行',
            choiceEffectType: 'PRESET_PR_046_CONFIRM',
            onYes: [
              {
                op: 'CHOOSE_ZONE_CARDS',
                side: 'SELF',
                zone: 'COST',
                zones: ['COST', 'GRAVEYARD'],
                prompt: '【执铭化刃】选择1张《万世铭》加入牌组并洗切',
                filter: {
                  anyFilters: [
                    { inZone: 'COST', exactName: '万世铭', isFaceUp: true },
                    { inZone: 'GRAVEYARD', exactName: '万世铭' },
                  ],
                },
                min: 1,
                max: 1,
                saveToVar: 'wsm',
                choiceEffectType: 'PRESET_PR_046_WSM',
              },
              {
                op: 'CHOOSE_ZONE_CARDS',
                side: 'SELF',
                zone: 'COST',
                zones: ['COST', 'GRAVEYARD'],
                prompt: '【执铭化刃】选择1张《万世铭·重铸》加入牌组并洗切',
                filter: {
                  anyFilters: [
                    { inZone: 'COST', exactName: '万世铭·重铸', isFaceUp: true },
                    { inZone: 'GRAVEYARD', exactName: '万世铭·重铸' },
                  ],
                },
                min: 1,
                max: 1,
                saveToVar: 'wsmr',
                choiceEffectType: 'PRESET_PR_046_WSMR',
              },
              {
                op: 'MOVE_CARDS',
                target: { kind: 'VAR', varName: 'wsm' },
                toZone: 'DECK_SHUFFLE',
                saveMovedToVar: 'movedWsm',
              },
              {
                op: 'MOVE_CARDS',
                target: { kind: 'VAR', varName: 'wsmr' },
                toZone: 'DECK_SHUFFLE',
                saveMovedToVar: 'movedWsmr',
              },
              {
                op: 'IF',
                condition: {
                  kind: 'ALL',
                  conditions: [
                    { kind: 'VAR_NON_EMPTY', varName: 'movedWsm' },
                    { kind: 'VAR_NON_EMPTY', varName: 'movedWsmr' },
                  ],
                },
                then: [
                  {
                    op: 'CHOOSE_ROLES',
                    side: 'SELF',
                    prompt: '【执铭化刃】选择我方战场1张《曲·启明》将其竖直',
                    filter: { exactName: '曲·启明' },
                    min: 1,
                    max: 1,
                    saveToVar: 'qu',
                    choiceEffectType: 'PRESET_PR_046_READY',
                  },
                  { op: 'SET_READY', target: { kind: 'VAR', varName: 'qu' }, isReady: true },
                  {
                    op: 'IF',
                    condition: { kind: 'ELIMINATED_THREE_ORBS_THIS_TURN', side: 'SELF' },
                    then: [
                      { op: 'MOVE_CARDS', target: { kind: 'SELF' }, toZone: 'COST', isFaceUp: true, isReady: false },
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

  // PR-047 罗塞塔·凛冽
  // 【永】：若我方战场存在《冈格尼尔》，该牌获得【速攻】。
  // 【起】丢弃手牌中的该牌：从以下2项选择1项。
  // ·选择我方牌组1张《冈格尼尔》加入手牌，洗切牌组。
  // ·若我方战场存在《冈格尼尔》，将我方信号球区的牌按任意顺序排列，可以将该回合中我方已使用的卡牌的张数视为增加1张。
  {
    cardNumber: 'PR-047',
    name: '罗塞塔·凛冽',
    vanillaEntry: true,
    staticEffects: [
      {
        id: 'PR-047_GUNGNIR_HASTE',
        scope: 'SELF',
        condition: {
          kind: 'ZONE_COUNT',
          side: 'SELF',
          zone: 'BATTLEFIELD',
          filter: { exactName: '冈格尼尔' },
          op: '>=',
          value: 1,
        },
        keywords: ['速攻'],
      },
    ],
    activates: [
      {
        id: 'hand_rosetta_activate',
        usableZones: ['HAND'],
        cost: { kind: 'DISCARD_SELF_FROM_HAND' },
        steps: [
          {
            op: 'CHOOSE_MODE',
            prompt: '【罗塞塔·凛冽】从以下2项选择1项',
            choiceEffectType: 'PRESET_PR_047_MODE',
            modes: [
              {
                id: 'search_gungnir',
                label: '选择我方牌组1张《冈格尼尔》加入手牌，洗切牌组',
                steps: [
                  {
                    op: 'CHOOSE_ZONE_CARDS',
                    side: 'SELF',
                    zone: 'DECK',
                    prompt: '【罗塞塔·凛冽】选择我方牌组1张《冈格尼尔》加入手牌',
                    filter: { exactName: '冈格尼尔' },
                    min: 1,
                    max: 1,
                    saveToVar: 'gungnir',
                    choiceEffectType: 'PRESET_PR_047_SEARCH',
                  },
                  { op: 'MOVE_CARDS', target: { kind: 'VAR', varName: 'gungnir' }, toZone: 'HAND', isFaceUp: true },
                  { op: 'SHUFFLE_DECK', side: 'SELF' },
                ],
              },
              {
                id: 'reorder_and_inc_plays',
                label: '若我方战场存在《冈格尼尔》，重排信号球区并可使本回合已使用卡牌张数+1',
                steps: [
                  {
                    op: 'IF',
                    condition: {
                      kind: 'ZONE_COUNT',
                      side: 'SELF',
                      zone: 'BATTLEFIELD',
                      filter: { exactName: '冈格尼尔' },
                      op: '>=',
                      value: 1,
                    },
                    then: [
                      {
                        op: 'REORDER_ZONE',
                        zone: 'SIGNAL_ORB',
                        prompt: '【罗塞塔·凛冽】按从下到上的顺序依次点选信号球区的全部 {orbCount} 张牌，以重新排列',
                        choiceEffectType: 'PRESET_PR_047_ORDER',
                      },
                      {
                        op: 'CONFIRM_YES_NO',
                        prompt: '【罗塞塔·凛冽】是否将该回合中我方已使用的卡牌的张数视为增加1张？',
                        yesLabel: '已使用张数+1',
                        noLabel: '不增加',
                        choiceEffectType: 'PRESET_PR_047_INC_PLAYS',
                        onYes: [{ op: 'INCREMENT_CARDS_PLAYED_THIS_TURN', amount: 1 }],
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

  // PR-048 一切终将汇聚此刻
  // 将该牌放置到信号球区最下方。从以下2项选择1项。
  // ·查看我方信号球区所有背面表示的牌，选择其中最多1张雷属性的牌加入手牌。
  // ·选择我方战场1张《七实·芒星之迹》，直到回合结束为止，其获得【充能+1】，PP+1000。
  {
    cardNumber: 'PR-048',
    name: '一切终将汇聚此刻',
    tactics: [
      { op: 'MOVE_CARDS', target: { kind: 'SELF' }, toZone: 'SIGNAL_ORB_BOTTOM', isFaceUp: true },
      {
        op: 'CHOOSE_MODE',
        prompt: '【一切终将汇聚此刻】从以下2项选择1项',
        choiceEffectType: 'PRESET_PR_048_MODE',
        modes: [
          {
            id: 'pick_facedown_lightning',
            label: '查看我方信号球区背面表示的牌，选择最多1张雷属性牌加入手牌',
            steps: [
              {
                op: 'CHOOSE_ZONE_CARDS',
                side: 'SELF',
                zone: 'SIGNAL_ORB',
                prompt: '【一切终将汇聚此刻】从信号球区背面表示的牌中选择最多1张雷属性牌加入手牌',
                filter: { isFaceUp: false, attribute: ElementAttribute.LIGHTNING },
                min: 0,
                max: 1,
                saveToVar: 'picked',
                choiceEffectType: 'PRESET_PR_048_ORB_PICK',
              },
              { op: 'MOVE_CARDS', target: { kind: 'VAR', varName: 'picked' }, toZone: 'HAND', isFaceUp: true },
            ],
          },
          {
            id: 'buff_nanami',
            label: '选择我方战场1张《七实·芒星之迹》，直到回合结束为止获得【充能+1】且 PP+1000',
            steps: [
              {
                op: 'CHOOSE_ROLES',
                side: 'SELF',
                prompt: '【一切终将汇聚此刻】选择我方战场1张《七实·芒星之迹》',
                filter: { exactName: '七实·芒星之迹' },
                min: 1,
                max: 1,
                saveToVar: 'nanami',
                choiceEffectType: 'PRESET_PR_048_NANAMI',
              },
              {
                op: 'MODIFY_STATS',
                target: { kind: 'VAR', varName: 'nanami' },
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

  // PR-049 篝火：标准信号球战术牌
  {
    cardNumber: 'PR-049',
    name: '篝火',
    isSignalOrbCard: true,
  },
];

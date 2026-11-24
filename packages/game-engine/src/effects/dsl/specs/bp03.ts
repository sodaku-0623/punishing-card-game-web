import { CardType, ElementAttribute } from '@zhanshuang/shared';
import type { CardEffectSpec, CardFilter, ConditionExpr, DeclarativeEntrySpec, EffectStep } from '../types.js';

/**
 * 共享条件：我方战场存在角色且所有角色均为指定卡名 (「只存在《XXX》」)
 */
function onlyFieldRoleName(exactName: string): ConditionExpr {
  return {
    kind: 'ALL_ROLES_MATCH',
    side: 'SELF',
    filter: { exactName },
    requireAtLeastOne: true,
  };
}

/**
 * 共享条件：判定已消除的信号球变量中至少包含 2 种不同信号球颜色
 * (注：若使用了在信号球区时「视为多色」的卡牌，移入墓地后仅保留自身原色标记)
 */
function hasAtLeastTwoOrbColors(varName: string): ConditionExpr {
  const hasRed: ConditionExpr = { kind: 'VAR_HAS_CARD_MATCHING', varName, filter: { signalOrbColor: 'RED' } };
  const hasBlue: ConditionExpr = { kind: 'VAR_HAS_CARD_MATCHING', varName, filter: { signalOrbColor: 'BLUE' } };
  const hasYellow: ConditionExpr = { kind: 'VAR_HAS_CARD_MATCHING', varName, filter: { signalOrbColor: 'YELLOW' } };
  return {
    kind: 'ANY',
    conditions: [
      { kind: 'ALL', conditions: [hasRed, hasBlue] },
      { kind: 'ALL', conditions: [hasRed, hasYellow] },
      { kind: 'ALL', conditions: [hasBlue, hasYellow] },
    ],
  };
}

/**
 * 共享条件：判定已消除的信号球变量中包含红/蓝/黄全部 3 种信号球颜色
 */
function hasThreeOrbColors(varName: string): ConditionExpr {
  return {
    kind: 'ALL',
    conditions: [
      { kind: 'VAR_HAS_CARD_MATCHING', varName, filter: { signalOrbColor: 'RED' } },
      { kind: 'VAR_HAS_CARD_MATCHING', varName, filter: { signalOrbColor: 'BLUE' } },
      { kind: 'VAR_HAS_CARD_MATCHING', varName, filter: { signalOrbColor: 'YELLOW' } },
    ],
  };
}

/**
 * 全卡表范围内「持有【充能自】的卡牌」精确过滤：
 * 包含所有标准信号球牌，以及官方卡表中具备【充能自】能力的非信号球牌 (10.2.1.b)
 * (注：CardFilter 尚缺通用的 hasChargeAuto 标记，当前以白名单精准覆盖)
 */
const CARD_HAS_CHARGE_AUTO_FILTER: CardFilter = {
  anyFilters: [
    { isSignalOrb: true },
    { cardNumbers: ['BP03-023', 'BP03-024', 'BP03-028', 'BP03-032', 'BP04-020', 'BP04-021', 'PR-030'] },
  ],
};

/**
 * 全卡表中《艾拉·万华》的完整卡号集合 (供 Q&A·6「该牌以外 = 编号不同」精确排除自身卡号)
 */
const ALL_AYLA_CARD_NUMBERS = [
  'BP03-045',
  'BP03-046',
  'BP03-047',
  'BP03-048',
  'BP03-049',
  'BP03-050',
  'BP03-051',
  'BP03-052',
  'BP03-053',
  'BP03-054',
] as const;

function otherAylaCardNumbers(selfCardNumber: string): string[] {
  return ALL_AYLA_CARD_NUMBERS.filter((num) => num !== selfCardNumber);
}

/**
 * 复用：露西亚·誓焰【起】【1费】：只存在《露西亚·誓焰》时将自身【浮空】
 */
function makeOnlyLuciaAirborneActivate(costAmount: number): NonNullable<CardEffectSpec['activate']> {
  return {
    condition: onlyFieldRoleName('露西亚·誓焰'),
    conditionError: '需要我方战场的角色只存在《露西亚·誓焰》',
    cost: {
      kind: 'COMPOSITE',
      costs: [{ kind: 'PAY_COST', amount: costAmount }, { kind: 'SELF_AIRBORNE' }],
    },
    steps: [],
  };
}

/**
 * 复用：公开我方牌组顶 N 张，选最多 1 张满足条件加入手牌，其余放牌组底
 */
function makeRevealTopPickOneToHandSteps(
  cardNumber: string,
  count: number,
  filter: CardFilter,
  prompt: string
): EffectStep[] {
  return [
    { op: 'REVEAL_TOP', count, saveToVar: 'rev' },
    {
      op: 'CHOOSE_FROM_VAR',
      varName: 'rev',
      prompt,
      filter,
      min: 0,
      max: 1,
      alwaysShow: true,
      saveToVar: 'kept',
      choiceEffectType: `DSL_PICK_${cardNumber}`,
    },
    { op: 'MOVE_CARDS', target: { kind: 'VAR', varName: 'kept' }, toZone: 'HAND', isFaceUp: true },
    {
      op: 'MOVE_CARDS',
      target: { kind: 'REST_OF_VAR', allVar: 'rev', excludeVar: 'kept' },
      toZone: 'DECK_BOTTOM',
    },
  ];
}

/**
 * 复用：将我方牌组顶 N 张牌经处理区以背面表示放置到信号球区最下方
 * (注：DSL 暂缺不公开直接移动牌组顶的 MOVE_TOP_DECK，借由 REVEAL_TOP + 背面置底实现)
 */
function makeDeckTopToOrbBottomSteps(count: number): EffectStep[] {
  const steps: EffectStep[] = [];
  for (let i = 0; i < count; i++) {
    steps.push(
      { op: 'PEEK_TOP', count: 1, saveToVar: `topCard_${i}` },
      {
        op: 'MOVE_CARDS',
        target: { kind: 'VAR', varName: `topCard_${i}` },
        toZone: 'SIGNAL_ORB_BOTTOM',
        isFaceUp: false,
      }
    );
  }
  return steps;
}

/**
 * 复用：BP03-003 与 BP03-003【冠军】完整规格工厂
 */
function createBp03003Spec(cardNumber: string): CardEffectSpec {
  return {
    cardNumber,
    name: '露西亚·誓焰',
    // 【升变条件】费用6以下的《露西亚·誓焰》＆「我方战场的角色为3张及以下」 【升变费用】3费
    // 【出】：直到回合结束为止，该牌可以攻击对方玩家。
    entry: {
      steps: [
        {
          op: 'MODIFY_STATS',
          target: { kind: 'SELF' },
          canAttackPlayerOnEnterTurn: true,
          duration: 'END_OF_TURN',
        },
      ],
    },
    // 【起】【回合1】：若我方战场的角色只存在《露西亚·誓焰》，将竖直状态的该牌【浮空】。
    // 可以追加消除【2任意信号球】。若如此做，选择我方战场1张《露西亚·誓焰》，直到回合结束为止，其获得【速攻】，PP+1000。
    activate: {
      id: `${cardNumber}_airborne`,
      oncePerTurn: true,
      condition: {
        kind: 'ALL',
        conditions: [{ kind: 'SELF_MATCHES_FILTER', filter: { isReady: true } }, onlyFieldRoleName('露西亚·誓焰')],
      },
      conditionError: '需要该牌处于竖直状态且我方战场的角色只存在《露西亚·誓焰》',
      cost: { kind: 'SELF_AIRBORNE' },
      steps: [
        {
          op: 'ELIMINATE_ORB_COST',
          filter: 'ANY',
          count: 2,
          optional: true,
          prompt: '【露西亚·誓焰】【起】是否追加消除【2任意信号球】使我方1张《露西亚·誓焰》获得【速攻】、PP+1000？',
          choiceEffectType: `DSL_${cardNumber}_ORB_COST`,
          onPaid: [
            {
              op: 'CHOOSE_ROLES',
              side: 'SELF',
              prompt: '【露西亚·誓焰】选择我方战场1张《露西亚·誓焰》，直到回合结束获得【速攻】、PP+1000',
              filter: { exactName: '露西亚·誓焰' },
              min: 1,
              max: 1,
              saveToVar: 'buffTarget',
              choiceEffectType: `DSL_${cardNumber}_BUFF`,
            },
            {
              op: 'MODIFY_STATS',
              target: { kind: 'VAR', varName: 'buffTarget' },
              keywords: ['速攻'],
              pp: 1000,
              duration: 'END_OF_TURN',
            },
          ],
        },
      ],
    },
  };
}

/**
 * 复用：BP03-045 / BP03-046 费用区【起】【5费】《艾拉·万华》>=7张时换人出场
 */
function makeAylaCostDeployActivate(cardNumber: string): NonNullable<CardEffectSpec['activate']> {
  const otherNumbers = otherAylaCardNumbers(cardNumber);
  return {
    usableZones: ['COST'],
    condition: {
      kind: 'ZONE_COUNT',
      side: 'SELF',
      zone: 'COST',
      filter: { isFaceUp: true, exactName: '艾拉·万华' },
      op: '>=',
      value: 7,
    },
    conditionError: '需要该牌存在于我方明费且我方费用区的《艾拉·万华》为 7 张及以上',
    cost: { kind: 'PAY_COST', amount: 5 },
    steps: [
      {
        op: 'CHOOSE_ROLES',
        side: 'SELF',
        prompt: '【艾拉·万华】【起】选择我方战场1张该牌以外(不同卡号)的《艾拉·万华》放置到牌组底',
        filter: { exactName: '艾拉·万华', cardNumbers: otherNumbers },
        min: 1,
        max: 1,
        saveToVar: 'bounceTarget',
        choiceEffectType: `DSL_${cardNumber}_BOUNCE`,
      },
      {
        op: 'MOVE_CARDS',
        target: { kind: 'VAR', varName: 'bounceTarget' },
        toZone: 'DECK_BOTTOM',
        saveMovedToVar: 'movedBounce',
      },
      {
        op: 'IF',
        condition: { kind: 'VAR_COUNT_COMPARE', varName: 'movedBounce', op: '>=', value: 1 },
        then: [
          {
            op: 'MOVE_CARDS',
            target: { kind: 'SELF' },
            toZone: 'BATTLEFIELD',
            triggerEntry: true,
          },
        ],
      },
    ],
  };
}

/**
 * 复用：BP03-051 / BP03-053【出】丢1张冰属性手牌：牌组顶1张横置放费用区，拿费用区1张（或最多1张）牌回手
 */
function makeAylaCostSwapEntry(cardNumber: string, aylaThreshold: number): NonNullable<CardEffectSpec['entry']> {
  return {
    cost: {
      kind: 'DISCARD_HAND',
      count: 1,
      filter: { attribute: ElementAttribute.ICE },
      optional: true,
      prompt: '【艾拉·万华】【出】是否丢弃手牌 1 张冰属性的牌：将牌组顶 1 张横置放费用区并回收费用区卡牌？',
      choiceEffectType: `DSL_${cardNumber}_DISCARD`,
    },
    steps: [
      { op: 'REVEAL_TOP', count: 1, saveToVar: 'top1' },
      {
        op: 'MOVE_CARDS',
        target: { kind: 'VAR', varName: 'top1' },
        toZone: 'COST',
        isFaceUp: true,
        isReady: false,
      },
      {
        op: 'IF',
        condition: {
          kind: 'ZONE_COUNT',
          side: 'SELF',
          zone: 'COST',
          filter: { isFaceUp: true, exactName: '艾拉·万华' },
          op: '>=',
          value: aylaThreshold,
        },
        then: [
          {
            op: 'CHOOSE_ZONE_CARDS',
            side: 'SELF',
            zone: 'COST',
            prompt: '【艾拉·万华】【出】费用区《艾拉·万华》已达阈值，可选择我方费用区最多 1 张牌加入手牌',
            min: 0,
            max: 1,
            saveToVar: 'salvage',
            choiceEffectType: `DSL_${cardNumber}_SALVAGE_OPT`,
          },
          { op: 'MOVE_CARDS', target: { kind: 'VAR', varName: 'salvage' }, toZone: 'HAND', isFaceUp: true },
        ],
        else: [
          {
            op: 'CHOOSE_ZONE_CARDS',
            side: 'SELF',
            zone: 'COST',
            prompt: '【艾拉·万华】【出】选择我方费用区 1 张牌加入手牌',
            min: 1,
            max: 1,
            saveToVar: 'salvage',
            choiceEffectType: `DSL_${cardNumber}_SALVAGE_REQ`,
          },
          { op: 'MOVE_CARDS', target: { kind: 'VAR', varName: 'salvage' }, toZone: 'HAND', isFaceUp: true },
        ],
      },
    ],
  };
}

/**
 * 复用：BP03-061 / BP03-063 的第 1 个【出】能力：查看我方牌组顶 1 张牌，可以将其放置到墓地
 */
function makePeekTopMillEntry(cardNumber: string): DeclarativeEntrySpec {
  return {
    id: `${cardNumber}_peek_mill`,
    label: '【出】查看我方牌组顶1张牌，可以将其放置到墓地',
    steps: [
      { op: 'PEEK_TOP', count: 1, saveToVar: 'top1' },
      {
        op: 'CHOOSE_FROM_VAR',
        varName: 'top1',
        prompt: '【莉莉丝·谬影】【出】查看了我方牌组顶 1 张牌，可选择将其放置到墓地（不选则保留在牌组顶）：',
        alwaysShow: true,
        min: 0,
        max: 1,
        saveToVar: 'millPick',
        choiceEffectType: `DSL_${cardNumber}_PEEK_MILL`,
      },
      { op: 'MOVE_CARDS', target: { kind: 'VAR', varName: 'millPick' }, toZone: 'GRAVEYARD', isFaceUp: true },
    ],
  };
}

/**
 * 复用：BP03-071 赛琳娜·岚音 消除信号球后的颜色种类分支执行步骤 (「X种及以上」累积执行)
 */
const BP03_071_OUTCOME_STEPS: EffectStep[] = [
  {
    op: 'IF',
    condition: { kind: 'VAR_NON_EMPTY', varName: 'paidOrbs' },
    then: [
      {
        op: 'MODIFY_STATS',
        target: { kind: 'SELF' },
        pp: 1000,
        duration: 'END_OF_NEXT_TURN',
      },
    ],
  },
  {
    op: 'IF',
    condition: hasAtLeastTwoOrbColors('paidOrbs'),
    then: [
      {
        op: 'MODIFY_STATS',
        target: { kind: 'SELF' },
        keywords: ['速攻'],
        duration: 'END_OF_TURN',
      },
    ],
  },
  {
    op: 'IF',
    condition: hasThreeOrbColors('paidOrbs'),
    then: [
      {
        op: 'CHOOSE_ZONE_CARDS',
        side: 'SELF',
        zone: 'COST',
        prompt: '【赛琳娜·岚音】已消除 3 种信号球标记：选择我方费用区最多 2 张<艺术协会>，将其竖直',
        filter: { isFaceUp: true, trait: '艺术协会' },
        min: 0,
        max: 2,
        saveToVar: 'readyCosts',
        choiceEffectType: 'DSL_BP03-071_READY_COST',
      },
      { op: 'SET_READY', target: { kind: 'VAR', varName: 'readyCosts' }, isReady: true },
    ],
  },
];

/**
 * 复用：BP03-074 风暴终曲 消除信号球后的颜色种类分支执行步骤 (「X种」只执行对应一项)
 */
const BP03_074_OUTCOME_STEPS: EffectStep[] = [
  {
    op: 'IF',
    condition: hasThreeOrbColors('paidOrbs'),
    then: [
      {
        op: 'CHOOSE_ROLES',
        side: 'SELF',
        prompt: '【风暴终曲】3种信号球：选择我方战场 1 张费用为 5 及以下的<赛琳娜>角色，将其竖直',
        filter: { trait: '赛琳娜', maxCost: 5 },
        min: 1,
        max: 1,
        saveToVar: 'readySelena',
        choiceEffectType: 'DSL_BP03-074_READY_ROLE',
      },
      { op: 'SET_READY', target: { kind: 'VAR', varName: 'readySelena' }, isReady: true },
    ],
    else: [
      {
        op: 'IF',
        condition: hasAtLeastTwoOrbColors('paidOrbs'),
        then: [
          {
            op: 'CHOOSE_ZONE_CARDS',
            side: 'SELF',
            zone: 'COST',
            prompt: '【风暴终曲】2种信号球：选择我方费用区最多 2 张<艺术协会>，将其竖直',
            filter: { isFaceUp: true, trait: '艺术协会' },
            min: 0,
            max: 2,
            saveToVar: 'readyCosts',
            choiceEffectType: 'DSL_BP03-074_READY_COST',
          },
          { op: 'SET_READY', target: { kind: 'VAR', varName: 'readyCosts' }, isReady: true },
        ],
        else: [{ op: 'DRAW', count: 1 }],
      },
    ],
  },
];

/**
 * 复用：BP03-078 命定之战选项列表 (避免 1 项与 2 项分支重复定义 modes)
 */
function makeBp03078Modes(suffix: string): { id: string; label: string; steps: EffectStep[] }[] {
  return [
    {
      id: 'search_alpha_blue',
      label: '公开牌组顶4张，选最多1张<阿尔法>角色和最多1张【蓝色信号球】加入手牌，其余放牌组底',
      steps: [
        { op: 'REVEAL_TOP', count: 4, saveToVar: 'rev' },
        {
          op: 'CHOOSE_FROM_VAR',
          varName: 'rev',
          prompt: '【命定之战】从公开的 4 张牌中选择最多 1 张<阿尔法>角色加入手牌',
          filter: { cardType: CardType.ROLE, trait: '阿尔法' },
          min: 0,
          max: 1,
          alwaysShow: true,
          saveToVar: 'pickedAlpha',
          choiceEffectType: `DSL_BP03-078_ALPHA_${suffix}`,
        },
        {
          op: 'MOVE_CARDS',
          target: { kind: 'VAR', varName: 'pickedAlpha' },
          toZone: 'HAND',
          isFaceUp: true,
        },
        {
          op: 'CHOOSE_FROM_VAR',
          varName: 'rev',
          prompt: '【命定之战】从剩余公开牌中选择最多 1 张【蓝色信号球】加入手牌',
          filter: { inZone: 'PROCESSING', signalOrbColor: 'BLUE' },
          min: 0,
          max: 1,
          alwaysShow: true,
          saveToVar: 'pickedBlue',
          choiceEffectType: `DSL_BP03-078_BLUE_${suffix}`,
        },
        {
          op: 'MOVE_CARDS',
          target: { kind: 'VAR', varName: 'pickedBlue' },
          toZone: 'HAND',
          isFaceUp: true,
        },
        {
          op: 'MOVE_CARDS',
          target: { kind: 'REST_OF_VAR', allVar: 'rev', excludeVar: 'pickedBlue' },
          toZone: 'DECK_BOTTOM',
        },
      ],
    },
    {
      id: 'buff_alpha',
      label: '选择我方战场1张<阿尔法>角色，直到回合结束获得【速攻】、PP+1000',
      steps: [
        {
          op: 'CHOOSE_ROLES',
          side: 'SELF',
          prompt: '【命定之战】选择我方战场 1 张<阿尔法>角色获得【速攻】、PP+1000',
          filter: { trait: '阿尔法' },
          min: 1,
          max: 1,
          saveToVar: 'alphaRole',
          choiceEffectType: `DSL_BP03-078_BUFF_${suffix}`,
        },
        {
          op: 'MODIFY_STATS',
          target: { kind: 'VAR', varName: 'alphaRole' },
          keywords: ['速攻'],
          pp: 1000,
          duration: 'END_OF_TURN',
        },
      ],
    },
  ];
}

const BP03_001_MODES: { id: string; label: string; steps: EffectStep[] }[] = [
  {
    id: 'buff_self',
    label: '直到下个回合结束为止，该牌PP+1000，DP+1',
    steps: [
      {
        op: 'MODIFY_STATS',
        target: { kind: 'SELF' },
        pp: 1000,
        dp: 1,
        duration: 'END_OF_NEXT_TURN',
      },
    ],
  },
  {
    id: 'orb_destroy',
    label: '若为升变出场且我方角色少于对方，可消2同色球破坏对方费用合计<=8的角色',
    steps: [
      {
        op: 'IF',
        condition: {
          kind: 'ALL',
          conditions: [
            { kind: 'CARD_WAS_ASCENDED_PLAY' },
            { kind: 'FRIENDLY_ROLE_COUNT_COMPARE_OPPONENT', op: '<' },
          ],
        },
        then: [
          {
            op: 'ELIMINATE_ORB_COST',
            filter: 'SAME',
            count: 2,
            optional: true,
            prompt: '【露西亚·誓焰】是否消除 2 同色信号球，选择对方战场任意数量费用合计 <= 8 的角色破坏？',
            choiceEffectType: 'DSL_BP03-001_ORB_COST',
            onPaid: [
              {
                op: 'CHOOSE_ROLES',
                side: 'OPPONENT',
                prompt: '【露西亚·誓焰】选择对方战场任意数量的费用合计为 8 及以下的角色，将其破坏',
                min: 0,
                max: 6,
                maxTotalCost: 8,
                saveToVar: 'destroyTargets',
                choiceEffectType: 'DSL_BP03-001_DESTROY',
              },
              { op: 'DESTROY_ROLES', target: { kind: 'VAR', varName: 'destroyTargets' } },
            ],
          },
        ],
      },
    ],
  },
];

/**
 * BP03《超刻溯梦》全部 90 张卡牌 (BP03-001 ~ BP03-089 + BP03-003【冠军】) 精确声明式效果描述集合
 */
export const BP03_EFFECT_SPECS: readonly CardEffectSpec[] = [
  // ==================== 1. 露西亚·誓焰 体系 (BP03-001 ~ BP03-011 + 冠军异画) ====================
  {
    cardNumber: 'BP03-001',
    name: '露西亚·誓焰',
    // 【起】：若我方战场的角色只存在《露西亚·誓焰》，将该牌【浮空】。
    activate: {
      condition: onlyFieldRoleName('露西亚·誓焰'),
      conditionError: '需要我方战场的角色只存在《露西亚·誓焰》',
      cost: { kind: 'SELF_AIRBORNE' },
      steps: [],
    },
    // 【出】：该牌从处理区出场或将浮空模式的角色作为升变对象升变出场时，从以下2项选择最多1项。若我方侵蚀计数为4及以上，改为选择最多2项。
    entry: {
      steps: [
        {
          op: 'IF',
          condition: {
            kind: 'ANY',
            conditions: [
              { kind: 'CARD_ENTERED_FROM_ZONE', zones: ['PROCESSING'] },
              { kind: 'CARD_WAS_ASCENDED_FROM_AIRBORNE' },
            ],
          },
          then: [
            {
              op: 'IF',
              condition: { kind: 'EROSION_COMPARE', side: 'SELF', op: '>=', value: 4 },
              then: [
                {
                  op: 'CHOOSE_MODE',
                  prompt: '【露西亚·誓焰】【出】侵蚀计数>=4，可从以下2项选择最多 2 项',
                  min: 0,
                  max: 2,
                  modes: BP03_001_MODES,
                  choiceEffectType: 'DSL_BP03-001_MODE_2',
                },
              ],
              else: [
                {
                  op: 'CHOOSE_MODE',
                  prompt: '【露西亚·誓焰】【出】可从以下2项选择最多 1 项',
                  min: 0,
                  max: 1,
                  modes: BP03_001_MODES,
                  choiceEffectType: 'DSL_BP03-001_MODE_1',
                },
              ],
            },
          ],
        },
      ],
    },
  },

  // 受限点：battlefield-manager.ts airborneRole 目前仅允许战场角色位 (isSlotRole) 浮空，尚不支持从 HAND 直接【浮空】至处理区。
  {
    cardNumber: 'BP03-002',
    name: '露西亚·誓焰',
    vanillaEntry: true,
    activate: {
      usableZones: ['HAND'],
      condition: onlyFieldRoleName('露西亚·誓焰'),
      conditionError: '需要我方战场的角色只存在《露西亚·誓焰》',
      cost: { kind: 'PAY_COST', amount: 5 },
      steps: [{ op: 'AIRBORNE', target: { kind: 'SELF' } }],
    },
  },

  createBp03003Spec('BP03-003'),
  createBp03003Spec('BP03-003【冠军】'),

  // 受限点：CardFilter 缺少 isAirborne 且 CHOOSE_ZONE_CARDS 暂不支持 'PROCESSING' 区域；
  // 前置判定仅能检查处理区存在《露西亚·誓焰》，第 1 项从处理区直接出场浮空角色待扩展 PROCESSING 选择后接入。
  {
    cardNumber: 'BP03-004',
    name: '露西亚·誓焰',
    handCostDiscount: {
      condition: { kind: 'ZONE_COUNT', side: 'SELF', zone: 'COST', filter: { isFaceUp: false }, op: '>=', value: 1 },
      flatDiscount: 2,
    },
    entry: {
      steps: [
        {
          op: 'IF',
          condition: {
            kind: 'ZONE_COUNT',
            side: 'SELF',
            zone: 'PROCESSING',
            filter: { exactName: '露西亚·誓焰', isAirborne: true },
            op: '>=',
            value: 1,
          },
          then: [
            {
              op: 'DISCARD_COST_STEP',
              count: 2,
              filter: { attribute: ElementAttribute.FIRE },
              optional: true,
              prompt: '【露西亚·誓焰】【出】处理区存在浮空《露西亚·誓焰》，是否丢弃手牌 2 张火属性的牌？',
              choiceEffectType: 'DSL_BP03-004_DISCARD',
              onPaid: [
                {
                  op: 'CHOOSE_MODE',
                  prompt: '【露西亚·誓焰】【出】请选择 1 项执行',
                  min: 1,
                  max: 1,
                  choiceEffectType: 'DSL_BP03-004_MODE',
                  modes: [
                    {
                      id: 'deploy_airborne',
                      label: '选择我方处理区1张浮空模式的《露西亚·誓焰》，将其出场',
                      steps: [
                        {
                          op: 'CHOOSE_ZONE_CARDS',
                          side: 'SELF',
                          zone: 'PROCESSING',
                          prompt: '【露西亚·誓焰】选择我方处理区 1 张浮空模式的《露西亚·誓焰》，将其出场',
                          filter: { exactName: '露西亚·誓焰', isAirborne: true },
                          requireEmptySlot: true,
                          min: 1,
                          max: 1,
                          saveToVar: 'airborneFire',
                          choiceEffectType: 'DSL_BP03-004_DEPLOY',
                        },
                        {
                          op: 'MOVE_CARDS',
                          target: { kind: 'VAR', varName: 'airborneFire' },
                          toZone: 'BATTLEFIELD',
                          triggerEntry: true,
                        },
                      ],
                    },
                    {
                      id: 'destroy_4000',
                      label: '选择对方战场1张PP为4000及以下的角色，将其破坏',
                      steps: [
                        {
                          op: 'CHOOSE_ROLES',
                          side: 'OPPONENT',
                          prompt: '【露西亚·誓焰】选择对方战场 1 张 PP 为 4000 及以下的角色，将其破坏',
                          filter: { maxEffectivePP: 4000 },
                          min: 1,
                          max: 1,
                          saveToVar: 'victim',
                          choiceEffectType: 'DSL_BP03-004_DESTROY',
                        },
                        { op: 'DESTROY_ROLES', target: { kind: 'VAR', varName: 'victim' } },
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

  // 受限点：CardFilter / OTHER_FRIENDLY_ROLE_ENTERED 尚缺少 enteredFromZones 与 wasAscendedFromAirborne 匹配；
  // 当前 condition 校验监听者自身从处理区出场或从浮空升变 (覆盖 Q&A·6 自身浮空回场触发，避免普通手牌出场误触发)。
  {
    cardNumber: 'BP03-005',
    name: '露西亚·誓焰',
    entry: {
      steps: [
        {
          op: 'CHOOSE_ROLES',
          side: 'SELF',
          prompt: '【露西亚·誓焰】【出】可选择我方战场其他 1 张《露西亚·誓焰》将其【浮空】',
          filter: { exactName: '露西亚·誓焰', excludeSelf: true },
          min: 0,
          max: 1,
          saveToVar: 'airTarget',
          choiceEffectType: 'DSL_BP03-005_AIRBORNE',
        },
        { op: 'AIRBORNE', target: { kind: 'VAR', varName: 'airTarget' } },
      ],
    },
    triggers: [
      {
        abilityId: 'dsl:BP03-005:processing_or_airborne_entry',
        eventType: 'CARD_ENTERED_FIELD',
        oncePerTurn: true,
        deferOncePerTurnUntilCostPaid: true,
        matcher: {
          kind: 'OTHER_FRIENDLY_ROLE_ENTERED',
          enteredName: '露西亚·誓焰',
          includeSelf: true,
        },
        condition: {
          kind: 'ANY',
          conditions: [
            { kind: 'CARD_ENTERED_FROM_ZONE', zones: ['PROCESSING'] },
            { kind: 'CARD_WAS_ASCENDED_FROM_AIRBORNE' },
          ],
        },
        label: '【露西亚·誓焰】【自】【回合1】从处理区出场或从浮空升变出场时可消2任意球获【速攻】PP+1000',
        cost: {
          kind: 'ELIMINATE_ORBS',
          filter: 'ANY',
          count: 2,
          optional: true,
          prompt: '【露西亚·誓焰】【自】是否消除【2任意信号球】使该牌获得【速攻】、PP+1000？',
          choiceEffectType: 'DSL_BP03-005_ORB_COST',
        },
        steps: [
          {
            op: 'MODIFY_STATS',
            target: { kind: 'SELF' },
            keywords: ['速攻'],
            pp: 1000,
            duration: 'END_OF_TURN',
          },
        ],
      },
    ],
  },

  {
    cardNumber: 'BP03-006',
    name: '露西亚·誓焰',
    activate: makeOnlyLuciaAirborneActivate(1),
    entry: {
      steps: [
        { op: 'DRAW', count: 1 },
        {
          op: 'CHOOSE_ZONE_CARDS',
          side: 'SELF',
          zone: 'HAND',
          prompt: '【露西亚·誓焰】【出】请选择 1 张手牌丢弃',
          min: 1,
          max: 1,
          saveToVar: 'discarded',
          choiceEffectType: 'DSL_BP03-006_DISCARD',
        },
        { op: 'MOVE_CARDS', target: { kind: 'VAR', varName: 'discarded' }, toZone: 'GRAVEYARD', isFaceUp: true },
      ],
    },
  },

  {
    cardNumber: 'BP03-007',
    name: '露西亚·誓焰',
    vanillaEntry: true,
    triggers: [
      {
        abilityId: 'dsl:BP03-007:attack_end_airborne',
        eventType: 'ATTACK_ENDED',
        matcher: { kind: 'SELF_ATTACK_END' },
        condition: onlyFieldRoleName('露西亚·誓焰'),
        label: '【露西亚·誓焰】【自】攻击结束时若只存在《露西亚·誓焰》，可将该牌【浮空】',
        steps: [
          {
            op: 'CONFIRM_YES_NO',
            prompt: '【露西亚·誓焰】【自】攻击结束，是否将该牌【浮空】？',
            yesLabel: '【浮空】该牌',
            noLabel: '留在战场',
            choiceEffectType: 'DSL_BP03-007_AIRBORNE_CONFIRM',
            onYes: [{ op: 'AIRBORNE', target: { kind: 'SELF' } }],
          },
        ],
      },
    ],
  },

  {
    cardNumber: 'BP03-008',
    name: '露西亚·誓焰',
    vanillaEntry: true,
    // 【永】：【充能0】由 rules/keywords.ts 自动解析
    activate: makeOnlyLuciaAirborneActivate(1),
  },

  // 受限点：CardFilter 尚缺 isAirborne 字段，当前条件近似检查我方处理区存在角色牌
  {
    cardNumber: 'BP03-009',
    name: '露西亚·誓焰',
    vanillaEntry: true,
    staticEffects: [
      {
        id: 'dsl:BP03-009:airborne_base_dp_1',
        scope: 'SELF',
        condition: {
          kind: 'ZONE_COUNT',
          side: 'SELF',
          zone: 'PROCESSING',
          filter: { cardType: CardType.ROLE },
          op: '>=',
          value: 1,
        },
        setBaseDP: 1,
      },
    ],
  },

  // 受限点：CHOOSE_ZONE_CARDS 尚不支持 'PROCESSING' 区域且 CardFilter 缺少 isAirborne，
  // 暂无法从处理区选择浮空模式的《露西亚·誓焰》出场 (Q&A·6 置换判定亦需依赖该选牌目标)。
  {
    cardNumber: 'BP03-010',
    name: '旋光灿昼',
    tactics: [
      {
        op: 'CHOOSE_ZONE_CARDS',
        side: 'SELF',
        zone: 'PROCESSING',
        prompt: '【旋光灿昼】选择我方处理区 1 张浮空模式的《露西亚·誓焰》，将其出场',
        filter: { exactName: '露西亚·誓焰', isAirborne: true },
        requireEmptySlot: true,
        min: 1,
        max: 1,
        saveToVar: 'airborneFire',
        choiceEffectType: 'DSL_BP03-010_DEPLOY',
      },
      {
        op: 'IF',
        condition: { kind: 'FRIENDLY_ROLE_COUNT_COMPARE_OPPONENT', op: '<' },
        then: [
          {
            op: 'MOVE_CARDS',
            target: { kind: 'VAR', varName: 'airborneFire' },
            toZone: 'BATTLEFIELD',
            enterTapped: false,
            triggerEntry: true,
          },
        ],
        else: [
          {
            op: 'MOVE_CARDS',
            target: { kind: 'VAR', varName: 'airborneFire' },
            toZone: 'BATTLEFIELD',
            enterTapped: true,
            triggerEntry: true,
          },
        ],
      },
    ],
  },

  {
    cardNumber: 'BP03-011',
    name: '烈羽扬锋',
    tactics: [
      {
        op: 'IF',
        condition: {
          kind: 'ALL',
          conditions: [{ kind: 'TURN_OWNER', isSelfTurn: false }, onlyFieldRoleName('露西亚·誓焰')],
        },
        then: [
          {
            op: 'CHOOSE_ROLES',
            side: 'SELF',
            prompt: '【烈羽扬锋】选择我方战场 1 张《露西亚·誓焰》，将其【浮空】',
            filter: { exactName: '露西亚·誓焰' },
            min: 1,
            max: 1,
            saveToVar: 'airTarget',
            choiceEffectType: 'DSL_BP03-011_AIRBORNE',
          },
          { op: 'AIRBORNE', target: { kind: 'VAR', varName: 'airTarget' } },
        ],
      },
    ],
  },

  // ==================== 2. 七实·芒星之迹 体系 (BP03-012 ~ BP03-022) ====================
  {
    cardNumber: 'BP03-012',
    name: '七实·芒星之迹',
    entry: {
      steps: [
        {
          op: 'IF',
          condition: { kind: 'ZONE_COUNT', side: 'SELF', zone: 'SIGNAL_ORB', op: '>=', value: 1 },
          then: [
            {
              op: 'CONFIRM_YES_NO',
              prompt: '【七实·芒星之迹】【出】是否将我方信号球区所有牌放置到墓地？（7张及以上时强化自身并令对方1角色PP变为70）',
              yesLabel: '全部放置到墓地',
              noLabel: '不放置',
              choiceEffectType: 'DSL_BP03-012_CONFIRM',
              onYes: [
                {
                  op: 'MOVE_CARDS',
                  target: { kind: 'ZONE_CARDS', side: 'SELF', zone: 'SIGNAL_ORB' },
                  toZone: 'GRAVEYARD',
                  isFaceUp: true,
                  saveMovedToVar: 'movedOrbs',
                },
                {
                  op: 'IF',
                  condition: { kind: 'VAR_COUNT_COMPARE', varName: 'movedOrbs', op: '>=', value: 7 },
                  then: [
                    {
                      op: 'MODIFY_STATS',
                      target: { kind: 'SELF' },
                      setBasePP: 7777,
                      canAttackReadyRolesMaxCost: 99,
                      keywords: ['贯通'],
                      duration: 'END_OF_TURN',
                    },
                    {
                      op: 'CHOOSE_ROLES',
                      side: 'OPPONENT',
                      prompt: '【七实·芒星之迹】选择对方战场最多 1 张角色，直到回合结束为止其 PP 变为 70',
                      min: 0,
                      max: 1,
                      saveToVar: 'oppTarget',
                      choiceEffectType: 'DSL_BP03-012_SET_PP_70',
                    },
                    {
                      op: 'MODIFY_STATS',
                      target: { kind: 'VAR', varName: 'oppTarget' },
                      setPP: 70,
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
  },

  // 受限点：【起】要求「将信号球区最上方 3 张牌放置到墓地」，当前 DSL 缺按顶位截取原语，
  // 暂以 CHOOSE_ZONE_CARDS(min/max 3) 提示按信号球区最上方 3 张选取。
  {
    cardNumber: 'BP03-013',
    name: '七实·芒星之迹',
    vanillaEntry: true,
    triggers: [
      {
        abilityId: 'dsl:BP03-013:attack_place_lightning',
        eventType: 'ATTACK_DECLARED',
        matcher: { kind: 'SELF_ATTACKING' },
        label: '【七实·芒星之迹】【自】攻击时可将手牌最多2张雷属性牌背面置球区底，若如此做抽1且基本PP变为7777',
        steps: [
          {
            op: 'CHOOSE_ZONE_CARDS',
            side: 'SELF',
            zone: 'HAND',
            prompt: '【七实·芒星之迹】【自】可选择我方手牌最多 2 张雷属性牌背面放置到信号球区最下方 (选0张则不触发后续)',
            filter: { attribute: ElementAttribute.LIGHTNING },
            min: 0,
            max: 2,
            saveToVar: 'picked',
            choiceEffectType: 'DSL_BP03-013_HAND_TO_ORB',
          },
          {
            op: 'MOVE_CARDS',
            target: { kind: 'VAR', varName: 'picked' },
            toZone: 'SIGNAL_ORB_BOTTOM',
            isFaceUp: false,
            saveMovedToVar: 'placed',
          },
          {
            op: 'IF',
            condition: { kind: 'VAR_COUNT_COMPARE', varName: 'placed', op: '>=', value: 1 },
            then: [
              { op: 'DRAW', count: 1 },
              {
                op: 'MODIFY_STATS',
                target: { kind: 'SELF' },
                setBasePP: 7777,
                duration: 'END_OF_TURN',
              },
            ],
          },
        ],
      },
    ],
    activate: {
      oncePerTurn: true,
      steps: [
        {
          op: 'IF',
          condition: { kind: 'ZONE_COUNT', side: 'SELF', zone: 'SIGNAL_ORB', op: '>=', value: 3 },
          then: [
            {
              op: 'CONFIRM_YES_NO',
              prompt: '【七实·芒星之迹】【起】是否将信号球区最上方 3 张牌放置到墓地？',
              yesLabel: '最上方 3 张置墓',
              noLabel: '不放置',
              choiceEffectType: 'DSL_BP03-013_ACT_CONFIRM',
              onYes: [
                {
                  op: 'CHOOSE_ZONE_CARDS',
                  side: 'SELF',
                  zone: 'SIGNAL_ORB',
                  prompt: '【七实·芒星之迹】请选择我方信号球区最上方 3 张牌放置到墓地',
                  min: 3,
                  max: 3,
                  saveToVar: 'topOrbs',
                  choiceEffectType: 'DSL_BP03-013_TOP_ORBS',
                },
                {
                  op: 'MOVE_CARDS',
                  target: { kind: 'VAR', varName: 'topOrbs' },
                  toZone: 'GRAVEYARD',
                  isFaceUp: true,
                  saveMovedToVar: 'movedOrbs',
                },
                {
                  op: 'IF',
                  condition: { kind: 'VAR_COUNT_COMPARE', varName: 'movedOrbs', op: '>=', value: 3 },
                  then: [
                    {
                      op: 'CHOOSE_ROLES',
                      side: 'SELF',
                      prompt: '【七实·芒星之迹】选择我方战场 1 张《七实·芒星之迹》获得【速攻】',
                      filter: { exactName: '七实·芒星之迹' },
                      min: 1,
                      max: 1,
                      saveToVar: 'nanami',
                      choiceEffectType: 'DSL_BP03-013_RUSH',
                    },
                    {
                      op: 'MODIFY_STATS',
                      target: { kind: 'VAR', varName: 'nanami' },
                      keywords: ['速攻'],
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
  },

  // 受限点：第 2 项「信号球区最上方 4 张牌」暂由 CHOOSE_ZONE_CARDS(min/max 4) 替代顶部截取原语。
  {
    cardNumber: 'BP03-014',
    name: '七实·芒星之迹',
    entry: {
      steps: [
        {
          op: 'IF',
          condition: onlyFieldRoleName('七实·芒星之迹'),
          then: [
            {
              op: 'CHOOSE_MODE',
              prompt: '【七实·芒星之迹】【出】从以下 2 项选择 1 项',
              min: 1,
              max: 1,
              choiceEffectType: 'DSL_BP03-014_MODE',
              modes: [
                {
                  id: 'deck_to_orb_bottom',
                  label: '若信号球区<=7张，可将牌组顶2张背面放信号球区最下方',
                  steps: [
                    {
                      op: 'IF',
                      condition: { kind: 'ZONE_COUNT', side: 'SELF', zone: 'SIGNAL_ORB', op: '<=', value: 7 },
                      then: [
                        {
                          op: 'CONFIRM_YES_NO',
                          prompt: '是否将我方牌组顶 2 张牌以背面表示放置到信号球区最下方？',
                          yesLabel: '放置 2 张',
                          noLabel: '不放置',
                          choiceEffectType: 'DSL_BP03-014_OPT1_CONFIRM',
                          onYes: makeDeckTopToOrbBottomSteps(2),
                        },
                      ],
                    },
                  ],
                },
                {
                  id: 'top4_to_gy',
                  label: '若信号球区>=7张，可将最上方4张置墓并获【突进】【贯通】、基本PP变为7777',
                  steps: [
                    {
                      op: 'IF',
                      condition: { kind: 'ZONE_COUNT', side: 'SELF', zone: 'SIGNAL_ORB', op: '>=', value: 7 },
                      then: [
                        {
                          op: 'CONFIRM_YES_NO',
                          prompt: '是否将信号球区最上方 4 张牌放置到墓地？',
                          yesLabel: '最上方 4 张置墓',
                          noLabel: '不放置',
                          choiceEffectType: 'DSL_BP03-014_OPT2_CONFIRM',
                          onYes: [
                            {
                              op: 'CHOOSE_ZONE_CARDS',
                              side: 'SELF',
                              zone: 'SIGNAL_ORB',
                              prompt: '【七实·芒星之迹】请选择我方信号球区最上方 4 张牌放置到墓地',
                              min: 4,
                              max: 4,
                              saveToVar: 'top4',
                              choiceEffectType: 'DSL_BP03-014_TOP4',
                            },
                            {
                              op: 'MOVE_CARDS',
                              target: { kind: 'VAR', varName: 'top4' },
                              toZone: 'GRAVEYARD',
                              isFaceUp: true,
                              saveMovedToVar: 'moved4',
                            },
                            {
                              op: 'IF',
                              condition: { kind: 'VAR_COUNT_COMPARE', varName: 'moved4', op: '>=', value: 4 },
                              then: [
                                {
                                  op: 'MODIFY_STATS',
                                  target: { kind: 'SELF' },
                                  keywords: ['突进', '贯通'],
                                  setBasePP: 7777,
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
          ],
        },
      ],
    },
  },

  {
    cardNumber: 'BP03-015',
    name: '七实·芒星之迹',
    entry: {
      steps: [
        {
          op: 'IF',
          condition: { kind: 'CARD_PAID_HIDDEN_COST_ON_PLAY' },
          then: [
            {
              op: 'MODIFY_STATS',
              target: { kind: 'SELF' },
              keywords: ['突进'],
              duration: 'END_OF_TURN',
            },
          ],
        },
      ],
    },
    triggers: [
      {
        abilityId: 'dsl:BP03-015:attack_deck_to_orb_bottom',
        eventType: 'ATTACK_DECLARED',
        matcher: { kind: 'SELF_ATTACKING' },
        condition: { kind: 'ZONE_COUNT', side: 'SELF', zone: 'SIGNAL_ORB', op: '<=', value: 7 },
        label: '【七实·芒星之迹】【自】攻击时若信号球区<=7张，可将牌组顶2张背面放信号球区最下方',
        steps: [
          {
            op: 'CONFIRM_YES_NO',
            prompt: '【七实·芒星之迹】【自】是否将我方牌组顶 2 张牌以背面表示放置到信号球区最下方？',
            yesLabel: '放置 2 张',
            noLabel: '不放置',
            choiceEffectType: 'DSL_BP03-015_CONFIRM',
            onYes: makeDeckTopToOrbBottomSteps(2),
          },
        ],
      },
    ],
  },

  // 受限点：「信号球区最上方 2 张牌」暂由 CHOOSE_ZONE_CARDS(min/max 2) 替代顶部截取原语。
  {
    cardNumber: 'BP03-016',
    name: '七实·芒星之迹',
    entry: {
      steps: [
        {
          op: 'IF',
          condition: { kind: 'ZONE_COUNT', side: 'SELF', zone: 'SIGNAL_ORB', op: '>=', value: 7 },
          then: [
            {
              op: 'CONFIRM_YES_NO',
              prompt: '【七实·芒星之迹】【出】是否将信号球区最上方 2 张牌放置到墓地以获得【速攻】？',
              yesLabel: '最上方 2 张置墓',
              noLabel: '不放置',
              choiceEffectType: 'DSL_BP03-016_CONFIRM',
              onYes: [
                {
                  op: 'CHOOSE_ZONE_CARDS',
                  side: 'SELF',
                  zone: 'SIGNAL_ORB',
                  prompt: '【七实·芒星之迹】请选择我方信号球区最上方 2 张牌放置到墓地',
                  min: 2,
                  max: 2,
                  saveToVar: 'top2',
                  choiceEffectType: 'DSL_BP03-016_TOP2',
                },
                {
                  op: 'MOVE_CARDS',
                  target: { kind: 'VAR', varName: 'top2' },
                  toZone: 'GRAVEYARD',
                  isFaceUp: true,
                  saveMovedToVar: 'moved2',
                },
                {
                  op: 'IF',
                  condition: { kind: 'VAR_COUNT_COMPARE', varName: 'moved2', op: '>=', value: 2 },
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
          ],
        },
      ],
    },
  },

  {
    cardNumber: 'BP03-017',
    name: '七实·芒星之迹',
    entry: {
      steps: [
        {
          op: 'CHOOSE_ZONE_CARDS',
          side: 'SELF',
          zone: 'HAND',
          prompt: '【七实·芒星之迹】【出】可将最多 1 张手牌背面放置到信号球区最下方 (选0张则不公开牌组)',
          min: 0,
          max: 1,
          saveToVar: 'picked',
          choiceEffectType: 'DSL_BP03-017_HAND_TO_ORB',
        },
        {
          op: 'MOVE_CARDS',
          target: { kind: 'VAR', varName: 'picked' },
          toZone: 'SIGNAL_ORB_BOTTOM',
          isFaceUp: false,
          saveMovedToVar: 'placed',
        },
        {
          op: 'IF',
          condition: { kind: 'VAR_COUNT_COMPARE', varName: 'placed', op: '>=', value: 1 },
          then: makeRevealTopPickOneToHandSteps(
            'BP03-017',
            4,
            { exactName: '七实·芒星之迹' },
            '【七实·芒星之迹】【出】从公开的 4 张牌中选择最多 1 张《七实·芒星之迹》加入手牌'
          ),
        },
      ],
    },
  },

  {
    cardNumber: 'BP03-018',
    name: '七实·芒星之迹',
    vanillaEntry: true,
    triggers: [
      {
        abilityId: 'dsl:BP03-018:attack_pp_2000',
        eventType: 'ATTACK_DECLARED',
        matcher: { kind: 'SELF_ATTACKING' },
        condition: { kind: 'ZONE_COUNT', side: 'SELF', zone: 'SIGNAL_ORB', op: '>=', value: 7 },
        label: '【七实·芒星之迹】【自】攻击时若信号球区>=7张，PP+2000',
        steps: [
          {
            op: 'MODIFY_STATS',
            target: { kind: 'SELF' },
            pp: 2000,
            duration: 'END_OF_TURN',
          },
        ],
      },
    ],
  },

  {
    cardNumber: 'BP03-019',
    name: '七实·芒星之迹',
    // 【永】：【充能0】由 rules/keywords.ts 自动解析
    entry: {
      steps: [
        {
          op: 'CHOOSE_ZONE_CARDS',
          side: 'SELF',
          zone: 'HAND',
          prompt: '【七实·芒星之迹】【出】可将最多 1 张手牌背面放置到信号球区最下方 (选0张则不抽牌)',
          min: 0,
          max: 1,
          saveToVar: 'picked',
          choiceEffectType: 'DSL_BP03-019_HAND_TO_ORB',
        },
        {
          op: 'MOVE_CARDS',
          target: { kind: 'VAR', varName: 'picked' },
          toZone: 'SIGNAL_ORB_BOTTOM',
          isFaceUp: false,
          saveMovedToVar: 'placed',
        },
        {
          op: 'IF',
          condition: { kind: 'VAR_COUNT_COMPARE', varName: 'placed', op: '>=', value: 1 },
          then: [{ op: 'DRAW', count: 1 }],
        },
      ],
    },
  },

  {
    cardNumber: 'BP03-020',
    name: '七实·芒星之迹',
    vanillaEntry: true,
    triggers: [
      {
        abilityId: 'dsl:BP03-020:battle_destroy_to_orb_bottom',
        eventType: 'CARD_DESTROYED',
        matcher: { kind: 'SELF_DESTROYED', destroyReason: 'BATTLE' },
        condition: { kind: 'ZONE_COUNT', side: 'SELF', zone: 'SIGNAL_ORB', op: '<=', value: 7 },
        label: '【七实·芒星之迹】【自】因战斗被破坏时若信号球区<=7张，可背面放置到信号球区最下方',
        steps: [
          {
            op: 'IF',
            condition: { kind: 'SELF_MATCHES_FILTER', filter: { inZone: 'GRAVEYARD' } },
            then: [
              {
                op: 'CONFIRM_YES_NO',
                prompt: '【七实·芒星之迹】【自】是否将该牌以背面表示放置到信号球区最下方？',
                yesLabel: '放置到信号球区最下方',
                noLabel: '留在墓地',
                choiceEffectType: 'DSL_BP03-020_CONFIRM',
                onYes: [
                  {
                    op: 'MOVE_CARDS',
                    target: { kind: 'SELF' },
                    toZone: 'SIGNAL_ORB_BOTTOM',
                    isFaceUp: false,
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
    cardNumber: 'BP03-021',
    name: '鮟棘',
    vanillaEntry: true,
    activate: {
      condition: { kind: 'ZONE_COUNT', side: 'SELF', zone: 'SIGNAL_ORB', op: '<=', value: 7 },
      conditionError: '需要我方信号球区的牌为 7 张及以下',
      cost: { kind: 'TAP_SELF' },
      steps: [
        { op: 'REVEAL_TOP', count: 1, saveToVar: 'top1' },
        {
          op: 'IF',
          condition: {
            kind: 'VAR_HAS_CARD_MATCHING',
            varName: 'top1',
            filter: { anyFilters: [{ exactName: '七实·芒星之迹' }, { exactName: '鮟棘' }] },
          },
          then: [
            {
              op: 'MOVE_CARDS',
              target: { kind: 'VAR', varName: 'top1' },
              toZone: 'SIGNAL_ORB_BOTTOM',
              isFaceUp: false,
            },
          ],
          else: [
            {
              op: 'MOVE_CARDS',
              target: { kind: 'VAR', varName: 'top1' },
              toZone: 'DECK_TOP',
              isFaceUp: false,
            },
          ],
        },
      ],
    },
  },

  {
    cardNumber: 'BP03-022',
    name: '星芒构解',
    tactics: [
      {
        op: 'CHOOSE_ROLES',
        side: 'SELF',
        prompt: '【星芒构解】选择我方战场 1 张《七实·芒星之迹》，直到回合结束可攻击费用<=4的竖直角色',
        filter: { exactName: '七实·芒星之迹' },
        min: 1,
        max: 1,
        saveToVar: 'nanami',
        choiceEffectType: 'DSL_BP03-022_PICK',
      },
      {
        op: 'MODIFY_STATS',
        target: { kind: 'VAR', varName: 'nanami' },
        canAttackReadyRolesMaxCost: 4,
        duration: 'END_OF_TURN',
      },
    ],
  },

  // ==================== 3. 里·超刻 体系 (BP03-023 ~ BP03-033) ====================
  // 【充能自】已内置于 card-effects.ts (BP03_023_CHARGE_ASCEND)，切勿重复注册至 triggers。
  {
    cardNumber: 'BP03-023',
    name: '里·超刻',
    vanillaEntry: true,
    isSignalOrbCard: true,
    triggers: [
      {
        abilityId: 'dsl:BP03-023:attack_end_destroy',
        eventType: 'ATTACK_ENDED',
        matcher: { kind: 'SELF_ATTACK_END' },
        condition: { kind: 'COMBAT_CHARGED_AUTO' },
        label: '【里·超刻】【自】攻击结束时若充能过【充能自】牌，可消2任意球破坏对方PP<=5000角色',
        cost: {
          kind: 'ELIMINATE_ORBS',
          filter: 'ANY',
          count: 2,
          optional: true,
          prompt: '【里·超刻】【自】是否消除【2任意信号球】破坏对方战场 1 张 PP<=5000 的角色？',
          choiceEffectType: 'DSL_BP03-023_ORB_COST',
        },
        steps: [
          {
            op: 'CHOOSE_ROLES',
            side: 'OPPONENT',
            prompt: '【里·超刻】选择对方战场 1 张 PP 为 5000 及以下的角色，将其破坏',
            filter: { maxEffectivePP: 5000 },
            min: 1,
            max: 1,
            saveToVar: 'victim',
            choiceEffectType: 'DSL_BP03-023_DESTROY',
          },
          { op: 'DESTROY_ROLES', target: { kind: 'VAR', varName: 'victim' } },
        ],
      },
    ],
  },

  // 【充能自】已内置于 card-effects.ts (BP03_024_CHARGE_DEPLOY)，切勿重复注册至 triggers。
  {
    cardNumber: 'BP03-024',
    name: '里·超刻',
    isSignalOrbCard: true,
    entry: {
      steps: [
        {
          op: 'MODIFY_STATS',
          target: { kind: 'SELF' },
          canAttackPlayerOnEnterTurn: true,
          duration: 'END_OF_TURN',
        },
      ],
    },
  },

  {
    cardNumber: 'BP03-025',
    name: '里·超刻',
    entry: {
      steps: [
        { op: 'DRAW', count: 1 },
        {
          op: 'CHOOSE_ZONE_CARDS',
          side: 'SELF',
          zone: 'HAND',
          prompt: '【里·超刻】【出】可公开手牌最多 1 张《里·超刻》放置到牌组顶',
          filter: { exactName: '里·超刻' },
          min: 0,
          max: 1,
          saveToVar: 'putTop',
          choiceEffectType: 'DSL_BP03-025_HAND_TO_TOP',
        },
        { op: 'MOVE_CARDS', target: { kind: 'VAR', varName: 'putTop' }, toZone: 'DECK_TOP', isFaceUp: false },
      ],
    },
    triggers: [
      {
        abilityId: 'dsl:BP03-025:attack_scry_top',
        eventType: 'ATTACK_DECLARED',
        matcher: { kind: 'SELF_ATTACKING' },
        label: '【里·超刻】【自】攻击时可查看牌组顶最多1张，选放牌组顶或牌组底',
        steps: [
          {
            op: 'CONFIRM_YES_NO',
            prompt: '【里·超刻】【自】是否查看我方牌组顶 1 张牌？',
            yesLabel: '查看牌组顶',
            noLabel: '不查看',
            choiceEffectType: 'DSL_BP03-025_SCRY_CONFIRM',
            onYes: [
              { op: 'PEEK_TOP', count: 1, saveToVar: 'top1' },
              {
                op: 'CHOOSE_FROM_VAR',
                varName: 'top1',
                prompt: '【里·超刻】请选择最多 1 张放回牌组顶 (不选则放置到牌组底)',
                min: 0,
                max: 1,
                alwaysShow: true,
                saveToVar: 'keepTop',
                choiceEffectType: 'DSL_BP03-025_SCRY_PICK',
              },
              { op: 'MOVE_CARDS', target: { kind: 'VAR', varName: 'keepTop' }, toZone: 'DECK_TOP', isFaceUp: false },
              {
                op: 'MOVE_CARDS',
                target: { kind: 'REST_OF_VAR', allVar: 'top1', excludeVar: 'keepTop' },
                toZone: 'DECK_BOTTOM',
              },
            ],
          },
        ],
      },
    ],
  },

  {
    cardNumber: 'BP03-026',
    name: '里·超刻',
    vanillaEntry: true,
    // 【永】：【速攻】由 rules/keywords.ts 自动解析
    handCostDiscount: {
      condition: { kind: 'CHARGED_AUTO_BY_LEE_THIS_TURN' },
      flatDiscount: 2,
    },
  },

  {
    cardNumber: 'BP03-027',
    name: '里·超刻',
    entry: {
      steps: [
        { op: 'REVEAL_TOP', count: 1, saveToVar: 'top1' },
        {
          op: 'IF',
          condition: { kind: 'VAR_HAS_CARD_MATCHING', varName: 'top1', filter: CARD_HAS_CHARGE_AUTO_FILTER },
          then: [
            {
              op: 'MODIFY_STATS',
              target: { kind: 'SELF' },
              canAttackPlayerOnEnterTurn: true,
              duration: 'END_OF_TURN',
            },
          ],
        },
        { op: 'MOVE_CARDS', target: { kind: 'VAR', varName: 'top1' }, toZone: 'DECK_TOP', isFaceUp: false },
      ],
    },
    activate: {
      oncePerTurn: true,
      cost: {
        kind: 'DISCARD_HAND',
        count: 1,
        filter: { exactName: '里·超刻' },
        prompt: '【里·超刻】【起】丢弃手牌 1 张《里·超刻》：直到回合结束获得【充能+1】',
        choiceEffectType: 'DSL_BP03-027_DISCARD',
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

  // 【充能自】已内置于 card-effects.ts (BP03_028_CHARGE_AUTO)，切勿重复注册至 triggers。
  {
    cardNumber: 'BP03-028',
    name: '里·超刻',
    vanillaEntry: true,
    isSignalOrbCard: true,
  },

  {
    cardNumber: 'BP03-029',
    name: '里·超刻',
    vanillaEntry: true,
    triggers: [
      {
        abilityId: 'dsl:BP03-029:attack_put_top',
        eventType: 'ATTACK_DECLARED',
        matcher: { kind: 'SELF_ATTACKING' },
        label: '【里·超刻】【自】攻击时可公开手牌最多1张《里·超刻》放置到牌组顶',
        steps: [
          {
            op: 'CHOOSE_ZONE_CARDS',
            side: 'SELF',
            zone: 'HAND',
            prompt: '【里·超刻】【自】可选择我方手牌最多 1 张《里·超刻》放置到牌组顶',
            filter: { exactName: '里·超刻' },
            min: 0,
            max: 1,
            saveToVar: 'putTop',
            choiceEffectType: 'DSL_BP03-029_HAND_TO_TOP',
          },
          { op: 'MOVE_CARDS', target: { kind: 'VAR', varName: 'putTop' }, toZone: 'DECK_TOP', isFaceUp: false },
        ],
      },
    ],
  },

  {
    cardNumber: 'BP03-030',
    name: '里·超刻',
    entry: {
      steps: [
        { op: 'REVEAL_TOP', count: 1, saveToVar: 'top1' },
        {
          op: 'IF',
          condition: { kind: 'VAR_HAS_CARD_MATCHING', varName: 'top1', filter: CARD_HAS_CHARGE_AUTO_FILTER },
          then: [
            {
              op: 'MODIFY_STATS',
              target: { kind: 'SELF' },
              pp: 1500,
              duration: 'END_OF_NEXT_TURN',
            },
          ],
        },
        { op: 'MOVE_CARDS', target: { kind: 'VAR', varName: 'top1' }, toZone: 'DECK_TOP', isFaceUp: false },
      ],
    },
  },

  {
    cardNumber: 'BP03-031',
    name: '里·超刻',
    vanillaEntry: true,
    staticEffects: [
      {
        id: 'dsl:BP03-031:only_lee_dp_1',
        scope: 'SELF',
        condition: onlyFieldRoleName('里·超刻'),
        setBaseDP: 1,
      },
    ],
  },

  // 【充能自】已内置于 card-effects.ts (BP03_032_CHARGE_BOUNCE_BOTTOM)，此处仅配置战术主体并标记 isSignalOrbCard。
  {
    cardNumber: 'BP03-032',
    name: '超宏爆发',
    isSignalOrbCard: true,
    tactics: [
      {
        op: 'IF',
        condition: onlyFieldRoleName('里·超刻'),
        then: [
          {
            op: 'CHOOSE_ROLES',
            side: 'OPPONENT',
            prompt: '【超宏爆发】选择对方战场 1 张 PP 为 7000 及以下的角色，放置到对方牌组底',
            filter: { maxEffectivePP: 7000 },
            min: 1,
            max: 1,
            saveToVar: 'target',
            choiceEffectType: 'DSL_BP03-032_BOUNCE',
          },
          { op: 'MOVE_CARDS', target: { kind: 'VAR', varName: 'target' }, toZone: 'DECK_BOTTOM' },
        ],
      },
    ],
  },

  {
    cardNumber: 'BP03-033',
    name: '时隧之钥-斯托克斯',
    vanillaEntry: true,
    staticEffects: [
      {
        id: 'dsl:BP03-033:equip_lee_charge_1',
        scope: 'EQUIPPED_HOST',
        targetFilter: { exactName: '里·超刻' },
        charge: 1,
      },
    ],
  },

  // ==================== 4. 罗塞塔·凛冽 体系 (BP03-034 ~ BP03-044) ====================
  {
    cardNumber: 'BP03-034',
    name: '罗塞塔·凛冽',
    staticEffects: [
      {
        id: 'dsl:BP03-034:only_rosetta_rush',
        scope: 'SELF',
        condition: onlyFieldRoleName('罗塞塔·凛冽'),
        keywords: ['速攻'],
      },
    ],
    entry: {
      steps: [
        {
          op: 'IF',
          condition: { kind: 'CARDS_PLAYED_THIS_TURN', side: 'SELF', op: '==', value: 1 },
          then: [
            {
              op: 'CHOOSE_ZONE_CARDS',
              side: 'SELF',
              zone: 'BATTLEFIELD',
              prompt: '【罗塞塔·凛冽】【出】(1张)：选择我方战场 1 张《冈格尼尔》',
              filter: { exactName: '冈格尼尔' },
              min: 1,
              max: 1,
              saveToVar: 'gungnir',
              choiceEffectType: 'DSL_BP03-034_PICK_GUNGNIR',
            },
            {
              op: 'IF',
              condition: { kind: 'VAR_NON_EMPTY', varName: 'gungnir' },
              then: [
                {
                  op: 'CHOOSE_ZONE_CARDS',
                  side: 'SELF',
                  zone: 'HAND',
                  prompt: '【罗塞塔·凛冽】选择我方最多 1 张手牌放置到该《冈格尼尔》下方',
                  min: 0,
                  max: 1,
                  saveToVar: 'handCard',
                  choiceEffectType: 'DSL_BP03-034_PICK_HAND',
                },
                {
                  op: 'MOVE_CARDS',
                  target: { kind: 'VAR', varName: 'handCard' },
                  toZone: 'UNDERNEATH',
                  underneathHost: { kind: 'VAR', varName: 'gungnir' },
                },
              ],
            },
          ],
        },
        {
          op: 'IF',
          condition: { kind: 'CARDS_PLAYED_THIS_TURN', side: 'SELF', op: '==', value: 2 },
          then: [
            {
              op: 'ADD_COST_MODIFIER',
              amount: 4,
              targetName: '罗塞塔·凛冽',
              remainingCount: 1,
              logText: '直到回合结束为止，下 1 张《罗塞塔·凛冽》费用 -4',
            },
          ],
        },
        {
          op: 'IF',
          condition: { kind: 'CARDS_PLAYED_THIS_TURN', side: 'SELF', op: '==', value: 3 },
          then: [
            {
              op: 'ELIMINATE_ORB_COST',
              filter: 'ANY',
              count: 2,
              optional: true,
              prompt: '【罗塞塔·凛冽】【出】(3张)：是否消除【2任意信号球】将对方 1 张角色返回手牌？',
              choiceEffectType: 'DSL_BP03-034_ORB_COST',
              onPaid: [
                {
                  op: 'CHOOSE_ROLES',
                  side: 'OPPONENT',
                  prompt: '【罗塞塔·凛冽】选择对方战场 1 张角色，将其返回手牌',
                  min: 1,
                  max: 1,
                  saveToVar: 'bounceTarget',
                  choiceEffectType: 'DSL_BP03-034_BOUNCE',
                },
                {
                  op: 'MOVE_CARDS',
                  target: { kind: 'VAR', varName: 'bounceTarget' },
                  toZone: 'HAND',
                  isFaceUp: true,
                },
              ],
            },
          ],
        },
      ],
    },
  },

  {
    cardNumber: 'BP03-035',
    name: '罗塞塔·凛冽',
    entry: {
      steps: [
        { op: 'DRAW', count: 1 },
        {
          op: 'CONFIRM_YES_NO',
          prompt: '【罗塞塔·凛冽】【出】是否将该回合中我方已使用的卡牌张数视为增加 1 张？',
          yesLabel: '视为增加 1 张',
          noLabel: '不增加',
          choiceEffectType: 'DSL_BP03-035_INC_COUNT',
          onYes: [{ op: 'INCREMENT_CARDS_PLAYED_THIS_TURN', amount: 1 }],
        },
      ],
    },
    triggers: [
      {
        abilityId: 'dsl:BP03-035:self_turn_end_pp',
        eventType: 'END_PHASE_TRIGGERS',
        matcher: { kind: 'SELF_TURN_END', isSelfTurn: true },
        condition: onlyFieldRoleName('罗塞塔·凛冽'),
        label: '【罗塞塔·凛冽】【自】我方回合结束时若只存在《罗塞塔·凛冽》，直到下回合结束PP+1000',
        steps: [
          {
            op: 'MODIFY_STATS',
            target: { kind: 'SELF' },
            pp: 1000,
            duration: 'END_OF_NEXT_TURN',
          },
        ],
      },
    ],
  },

  {
    cardNumber: 'BP03-036',
    name: '罗塞塔·凛冽',
    vanillaEntry: true,
    // 计算出牌费用时自身尚未计入 cardsPlayedThisTurn，故前已使用 2 张时正在使用的是第 3 张
    handCostDiscount: {
      condition: { kind: 'CARDS_PLAYED_THIS_TURN', side: 'SELF', op: '==', value: 2 },
      flatDiscount: 2,
    },
  },

  {
    cardNumber: 'BP03-037',
    name: '罗塞塔·凛冽',
    entry: {
      steps: makeRevealTopPickOneToHandSteps(
        'BP03-037',
        4,
        { anyFilters: [{ exactName: '罗塞塔·凛冽' }, { exactName: '冈格尼尔' }] },
        '【罗塞塔·凛冽】【出】从公开的 4 张牌中选择最多 1 张《罗塞塔·凛冽》或《冈格尼尔》加入手牌'
      ),
    },
  },

  {
    cardNumber: 'BP03-038',
    name: '罗塞塔·凛冽',
    entry: {
      steps: [
        {
          op: 'IF',
          condition: { kind: 'CARDS_PLAYED_THIS_TURN', side: 'SELF', op: '==', value: 3 },
          then: [
            {
              op: 'MODIFY_STATS',
              target: { kind: 'SELF' },
              keywords: ['突进'],
              pp: 1500,
              duration: 'END_OF_NEXT_TURN',
            },
          ],
        },
      ],
    },
  },

  {
    cardNumber: 'BP03-039',
    name: '罗塞塔·凛冽',
    vanillaEntry: true,
    // 【永】：【充能0】由 rules/keywords.ts 自动解析
    triggers: [
      {
        abilityId: 'dsl:BP03-039:turn_end_draw',
        eventType: 'END_PHASE_TRIGGERS',
        matcher: { kind: 'SELF_TURN_END', isSelfTurn: true },
        condition: { kind: 'CARDS_PLAYED_THIS_TURN', side: 'SELF', op: '==', value: 3 },
        label: '【罗塞塔·凛冽】【自】我方回合结束时若已使用卡牌张数为3张，抽1张牌',
        steps: [{ op: 'DRAW', count: 1 }],
      },
    ],
  },

  {
    cardNumber: 'BP03-040',
    name: '罗塞塔·凛冽',
    vanillaEntry: true,
    triggers: [
      {
        abilityId: 'dsl:BP03-040:attack_buff',
        eventType: 'ATTACK_DECLARED',
        matcher: { kind: 'SELF_ATTACKING' },
        condition: { kind: 'CARDS_PLAYED_THIS_TURN', side: 'SELF', op: '==', value: 3 },
        label: '【罗塞塔·凛冽】【自】攻击时若已使用卡牌张数为3张，直到下回合结束PP+1000、DP+1',
        steps: [
          {
            op: 'MODIFY_STATS',
            target: { kind: 'SELF' },
            pp: 1000,
            dp: 1,
            duration: 'END_OF_NEXT_TURN',
          },
        ],
      },
    ],
  },

  {
    cardNumber: 'BP03-041',
    name: '罗塞塔·凛冽',
    entry: {
      steps: [
        {
          op: 'CONFIRM_YES_NO',
          prompt: '【罗塞塔·凛冽】【出】是否将该回合中我方已使用的卡牌张数视为增加 1 张？',
          yesLabel: '视为增加 1 张',
          noLabel: '不增加',
          choiceEffectType: 'DSL_BP03-041_INC_COUNT',
          onYes: [{ op: 'INCREMENT_CARDS_PLAYED_THIS_TURN', amount: 1 }],
        },
      ],
    },
  },

  // 受限点：第 2 项「将该牌下方的所有牌放置到墓地并消除2同色信号球」中，
  // CardTargetRef 缺少 { kind: 'SELF_UNDERNEATH' } (且 HOST_UNDERNEATH_MATCHING 仅遍历角色位而不含独立装备)，
  // 暂无法把独立《冈格尼尔》下方所有卡牌移入墓地；待补充 SELF_UNDERNEATH 原语后接入。
  {
    cardNumber: 'BP03-042',
    name: '冈格尼尔',
    vanillaEntry: true,
    activate: {
      oncePerTurn: true,
      condition: {
        kind: 'ALL',
        conditions: [
          { kind: 'IS_STANDALONE_EQUIPMENT' },
          { kind: 'CARDS_PLAYED_THIS_TURN', side: 'SELF', op: '==', value: 3 },
        ],
      },
      conditionError: '需要该牌未被装备且该回合中我方已使用卡牌的张数为 3 张',
      steps: [
        {
          op: 'CHOOSE_MODE',
          prompt: '【冈格尼尔】【起】从以下 2 项选择 1 项',
          min: 1,
          max: 1,
          choiceEffectType: 'DSL_BP03-042_MODE',
          modes: [
            {
              id: 'put_physical_underneath',
              label: '若只存在《罗塞塔·凛冽》，选择手牌或战场1张物理属性牌置入该牌下方',
              steps: [
                {
                  op: 'IF',
                  condition: onlyFieldRoleName('罗塞塔·凛冽'),
                  then: [
                    {
                      op: 'CHOOSE_ZONE_CARDS',
                      side: 'SELF',
                      zone: 'HAND',
                      zones: ['HAND', 'BATTLEFIELD'],
                      topLevelOnly: true,
                      prompt: '【冈格尼尔】选择我方手牌或战场 1 张物理属性的牌放置到该牌下方',
                      filter: { attribute: ElementAttribute.PHYSICAL, excludeSelf: true },
                      min: 1,
                      max: 1,
                      saveToVar: 'mat',
                      choiceEffectType: 'DSL_BP03-042_PICK_MAT',
                    },
                    {
                      op: 'MOVE_CARDS',
                      target: { kind: 'VAR', varName: 'mat' },
                      toZone: 'UNDERNEATH',
                      underneathHost: { kind: 'SELF' },
                    },
                  ],
                },
              ],
            },
            {
              id: 'clear_underneath_wipe',
              label: '若下方>=3张，将该牌下方所有牌置入墓地并消除2同色信号球，破坏对方所有横置角色',
              steps: [
                {
                  op: 'IF',
                  condition: {
                    kind: 'ALL',
                    conditions: [
                      { kind: 'SELF_UNDERNEATH_COUNT', op: '>=', value: 3 },
                      { kind: 'HAS_ELIMINABLE_ORBS', filter: 'SAME', count: 2 },
                    ],
                  },
                  then: [
                    {
                      op: 'ELIMINATE_ORB_COST',
                      filter: 'SAME',
                      count: 2,
                      optional: true,
                      prompt: '【冈格尼尔】是否将该牌下方所有牌置入墓地并消除 2 同色信号球，破坏对方战场所有横置角色？',
                      choiceEffectType: 'DSL_BP03-042_ORBS',
                      onPaid: [
                        {
                          op: 'MOVE_CARDS',
                          target: { kind: 'SELF_UNDERNEATH' },
                          toZone: 'GRAVEYARD',
                          isFaceUp: true,
                          sentByEffectOrCost: true,
                        },
                        {
                          op: 'DESTROY_ROLES',
                          target: { kind: 'ALL_MATCHING_ROLES', side: 'OPPONENT', filter: { isReady: false } },
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

  {
    cardNumber: 'BP03-043',
    name: '涤罪之枪',
    handCostDiscount: {
      condition: { kind: 'CARDS_PLAYED_THIS_TURN', side: 'SELF', op: '==', value: 2 },
      flatDiscount: 1,
    },
    tactics: [
      {
        op: 'IF',
        condition: { kind: 'HAS_ROLE', side: 'SELF', filter: { exactName: '罗塞塔·凛冽' } },
        then: [
          {
            op: 'CHOOSE_ROLES',
            side: 'OPPONENT',
            prompt: '【涤罪之枪】选择对方战场 1 张 PP 为 7000 及以下的角色，将其返回手牌',
            filter: { maxEffectivePP: 7000 },
            min: 1,
            max: 1,
            saveToVar: 'target',
            choiceEffectType: 'DSL_BP03-043_BOUNCE',
          },
          { op: 'MOVE_CARDS', target: { kind: 'VAR', varName: 'target' }, toZone: 'HAND', isFaceUp: true },
        ],
      },
    ],
  },

  {
    cardNumber: 'BP03-044',
    name: '凛冽之心',
    tactics: [
      { op: 'DRAW', count: 1 },
      {
        op: 'CHOOSE_MODE',
        prompt: '【凛冽之心】从以下 2 项选择 1 项',
        min: 1,
        max: 1,
        choiceEffectType: 'DSL_BP03-044_MODE',
        modes: [
          {
            id: 'inc_count',
            label: '可以将该回合中我方已使用的卡牌的张数视为增加1张',
            steps: [
              {
                op: 'CONFIRM_YES_NO',
                prompt: '是否将该回合中我方已使用的卡牌张数视为增加 1 张？',
                yesLabel: '视为增加 1 张',
                noLabel: '不增加',
                choiceEffectType: 'DSL_BP03-044_INC_CONFIRM',
                onYes: [{ op: 'INCREMENT_CARDS_PLAYED_THIS_TURN', amount: 1 }],
              },
            ],
          },
          {
            id: 'ready_rosetta',
            label: '若该牌为该回合第3张牌，选择我方战场1张《罗塞塔·凛冽》将其竖直',
            steps: [
              {
                op: 'IF',
                condition: { kind: 'CARDS_PLAYED_THIS_TURN', side: 'SELF', op: '==', value: 3 },
                then: [
                  {
                    op: 'CHOOSE_ROLES',
                    side: 'SELF',
                    prompt: '【凛冽之心】选择我方战场 1 张《罗塞塔·凛冽》，将其竖直',
                    filter: { exactName: '罗塞塔·凛冽' },
                    min: 1,
                    max: 1,
                    saveToVar: 'rosetta',
                    choiceEffectType: 'DSL_BP03-044_READY',
                  },
                  { op: 'SET_READY', target: { kind: 'VAR', varName: 'rosetta' }, isReady: true },
                ],
              },
            ],
          },
        ],
      },
    ],
  },

  // ==================== 5. 艾拉·万华 & 艺术协会 体系 (BP03-045 ~ BP03-055) ====================
  {
    cardNumber: 'BP03-045',
    name: '艾拉·万华',
    vanillaEntry: true,
    // 【永】：【速攻】由 rules/keywords.ts 自动解析
    triggers: [
      {
        abilityId: 'dsl:BP03-045:attack_pierce',
        eventType: 'ATTACK_DECLARED',
        matcher: { kind: 'SELF_ATTACKING' },
        condition: { kind: 'FRIENDLY_ROLE_COUNT_COMPARE_OPPONENT', op: '<' },
        label: '【艾拉·万华】【自】攻击时若我方角色少于对方，获得【贯通】',
        steps: [
          {
            op: 'MODIFY_STATS',
            target: { kind: 'SELF' },
            keywords: ['贯通'],
            duration: 'END_OF_TURN',
          },
        ],
      },
    ],
    activate: makeAylaCostDeployActivate('BP03-045'),
  },

  {
    cardNumber: 'BP03-046',
    name: '艾拉·万华',
    vanillaEntry: true,
    triggers: [
      {
        abilityId: 'dsl:BP03-046:block_pp_3000',
        eventType: 'BLOCK_DECLARED',
        // 使用 SELF_ATTACKING_OR_BLOCKING + 仅监听 BLOCK_DECLARED，精确限定为该牌自身作为阻挡者
        matcher: { kind: 'SELF_ATTACKING_OR_BLOCKING' },
        label: '【艾拉·万华】【自】该牌阻挡时，直到回合结束PP+3000',
        steps: [
          {
            op: 'MODIFY_STATS',
            target: { kind: 'SELF' },
            pp: 3000,
            duration: 'END_OF_TURN',
          },
        ],
      },
      {
        abilityId: 'dsl:BP03-046:opp_turn_leave_deploy',
        eventType: 'CARD_LEFT_FIELD',
        matcher: { kind: 'SELF_LEFT_FIELD' },
        condition: { kind: 'TURN_OWNER', isSelfTurn: false },
        label: '【艾拉·万华】【自】对方回合离场时可从我方费用区出场1张费用<=5《艾拉·万华》(【出】不发动)',
        steps: [
          {
            op: 'CHOOSE_ZONE_CARDS',
            side: 'SELF',
            zone: 'COST',
            prompt: '【艾拉·万华】【自】可选择我方费用区 1 张费用<=5的《艾拉·万华》出场 (不选则放弃)',
            filter: { isFaceUp: true, exactName: '艾拉·万华', maxCost: 5 },
            requireEmptySlot: true,
            min: 0,
            max: 1,
            saveToVar: 'ayla',
            choiceEffectType: 'DSL_BP03-046_LEAVE_DEPLOY',
          },
          {
            op: 'MOVE_CARDS',
            target: { kind: 'VAR', varName: 'ayla' },
            toZone: 'BATTLEFIELD',
            triggerEntry: false,
          },
        ],
      },
    ],
    activate: makeAylaCostDeployActivate('BP03-046'),
  },

  {
    cardNumber: 'BP03-047',
    name: '艾拉·万华',
    vanillaEntry: true,
    // 【永】：【速攻】由 rules/keywords.ts 自动解析
    activate: {
      usableZones: ['COST'],
      condition: {
        kind: 'ZONE_COUNT',
        side: 'SELF',
        zone: 'COST',
        filter: { isFaceUp: true, exactName: '艾拉·万华' },
        op: '>=',
        value: 7,
      },
      conditionError: '需要该牌存在于我方明费且我方费用区的《艾拉·万华》为 7 张及以上',
      steps: [
        {
          op: 'ELIMINATE_ORB_COST',
          filter: 'ANY',
          count: 2,
          optional: true,
          prompt: '【艾拉·万华】【起】是否将该牌放回牌组底并消除【2任意信号球】将对方<=3费角色横置放费用区？',
          choiceEffectType: 'DSL_BP03-047_ORB_COST',
          onPaid: [
            { op: 'MOVE_CARDS', target: { kind: 'SELF' }, toZone: 'DECK_BOTTOM', saveMovedToVar: 'movedSelf' },
            {
              op: 'IF',
              condition: { kind: 'VAR_COUNT_COMPARE', varName: 'movedSelf', op: '>=', value: 1 },
              then: [
                {
                  op: 'CHOOSE_ROLES',
                  side: 'OPPONENT',
                  prompt: '【艾拉·万华】选择对方战场 1 张费用为 3 及以下的角色，以横置状态放置到对方费用区',
                  filter: { maxCost: 3 },
                  min: 1,
                  max: 1,
                  saveToVar: 'oppRole',
                  choiceEffectType: 'DSL_BP03-047_TO_OPP_COST',
                },
                {
                  op: 'MOVE_CARDS',
                  target: { kind: 'VAR', varName: 'oppRole' },
                  toZone: 'COST',
                  isFaceUp: true,
                  isReady: false,
                },
              ],
            },
          ],
        },
      ],
    },
  },

  {
    cardNumber: 'BP03-048',
    name: '艾拉·万华',
    vanillaEntry: true,
    // 【永】：【突进】由 rules/keywords.ts 自动解析
    triggers: [
      {
        abilityId: 'dsl:BP03-048:attack_hand_to_cost',
        eventType: 'ATTACK_DECLARED',
        matcher: { kind: 'SELF_ATTACKING' },
        label: '【艾拉·万华】【自】攻击时选择我方手牌最多1张《艾拉·万华》以横置状态放置到费用区',
        steps: [
          {
            op: 'CHOOSE_ZONE_CARDS',
            side: 'SELF',
            zone: 'HAND',
            prompt: '【艾拉·万华】【自】选择我方手牌最多 1 张《艾拉·万华》以横置状态放置到费用区',
            filter: { exactName: '艾拉·万华' },
            min: 0,
            max: 1,
            saveToVar: 'ayla',
            choiceEffectType: 'DSL_BP03-048_HAND_TO_COST',
          },
          {
            op: 'MOVE_CARDS',
            target: { kind: 'VAR', varName: 'ayla' },
            toZone: 'COST',
            isFaceUp: true,
            isReady: false,
          },
        ],
      },
    ],
  },

  {
    cardNumber: 'BP03-049',
    name: '艾拉·万华',
    vanillaEntry: true,
    activate: {
      oncePerTurn: true,
      cost: {
        kind: 'ELIMINATE_ORBS',
        filter: 'ANY',
        count: 2,
        savePaidToVar: 'paidOrbs',
        prompt: '【艾拉·万华】【起】选择消除【2任意信号球】',
        choiceEffectType: 'DSL_BP03-049_ORB_COST',
      },
      steps: [
        {
          op: 'IF',
          condition: hasAtLeastTwoOrbColors('paidOrbs'),
          then: [
            {
              op: 'MODIFY_STATS',
              target: { kind: 'SELF' },
              keywords: ['速攻'],
              duration: 'END_OF_TURN',
            },
          ],
          else: [
            {
              op: 'IF',
              condition: {
                kind: 'ZONE_COUNT',
                side: 'SELF',
                zone: 'COST',
                filter: { isFaceUp: true, exactName: '艾拉·万华' },
                op: '>=',
                value: 6,
              },
              then: [
                {
                  op: 'CONFIRM_YES_NO',
                  prompt: '【艾拉·万华】【起】(1种信号球)是否将该牌横置放费用区，并从费用区出场 1 张《艾拉·万华》？',
                  yesLabel: '放费用区并出场',
                  noLabel: '不移动',
                  choiceEffectType: 'DSL_BP03-049_SWAP_CONFIRM',
                  onYes: [
                    {
                      op: 'MOVE_CARDS',
                      target: { kind: 'SELF' },
                      toZone: 'COST',
                      isFaceUp: true,
                      isReady: false,
                      saveMovedToVar: 'movedSelf',
                    },
                    {
                      op: 'IF',
                      // 若费用区已达上限被 3.6.4 改放墓地，则不满足「若如此做」
                      condition: { kind: 'VAR_HAS_CARD_MATCHING', varName: 'movedSelf', filter: { inZone: 'COST' } },
                      then: [
                        {
                          op: 'CHOOSE_ZONE_CARDS',
                          side: 'SELF',
                          zone: 'COST',
                          prompt: '【艾拉·万华】选择我方费用区 1 张《艾拉·万华》出场',
                          filter: { isFaceUp: true, exactName: '艾拉·万华' },
                          requireEmptySlot: true,
                          min: 1,
                          max: 1,
                          saveToVar: 'deployAyla',
                          choiceEffectType: 'DSL_BP03-049_DEPLOY',
                        },
                        {
                          op: 'MOVE_CARDS',
                          target: { kind: 'VAR', varName: 'deployAyla' },
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
  },

  {
    cardNumber: 'BP03-050',
    name: '艾拉·万华',
    vanillaEntry: true,
    activate: {
      usableZones: ['COST'],
      condition: {
        kind: 'ZONE_COUNT',
        side: 'SELF',
        zone: 'COST',
        filter: { isFaceUp: true, exactName: '艾拉·万华' },
        op: '>=',
        value: 6,
      },
      conditionError: '需要该牌存在于我方明费且我方费用区的《艾拉·万华》为 6 张及以上',
      steps: [
        { op: 'MOVE_CARDS', target: { kind: 'SELF' }, toZone: 'DECK_BOTTOM', saveMovedToVar: 'movedSelf' },
        {
          op: 'IF',
          condition: { kind: 'VAR_COUNT_COMPARE', varName: 'movedSelf', op: '>=', value: 1 },
          then: [
            {
              op: 'CHOOSE_ROLES',
              side: 'SELF',
              prompt: '【艾拉·万华】【起】选择我方战场 1 张《艾拉·万华》，直到回合结束其 PP+2000',
              filter: { exactName: '艾拉·万华' },
              min: 1,
              max: 1,
              saveToVar: 'ayla',
              choiceEffectType: 'DSL_BP03-050_BUFF',
            },
            {
              op: 'IF',
              condition: { kind: 'VAR_NON_EMPTY', varName: 'ayla' },
              then: [
                {
                  op: 'MODIFY_STATS',
                  target: { kind: 'VAR', varName: 'ayla' },
                  pp: 2000,
                  duration: 'END_OF_TURN',
                },
                {
                  op: 'ELIMINATE_ORB_COST',
                  filter: 'ANY',
                  count: 2,
                  optional: true,
                  prompt: '【艾拉·万华】是否追加消除【2任意信号球】使所选《艾拉·万华》获得【速攻】？',
                  choiceEffectType: 'DSL_BP03-050_ORB_COST',
                  onPaid: [
                    {
                      op: 'MODIFY_STATS',
                      target: { kind: 'VAR', varName: 'ayla' },
                      keywords: ['速攻'],
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
  },

  {
    cardNumber: 'BP03-051',
    name: '艾拉·万华',
    staticEffects: [
      {
        id: 'dsl:BP03-051:cost_limit_7_buff',
        scope: 'SELF',
        condition: { kind: 'ZONE_COUNT', side: 'SELF', zone: 'COST', op: '>=', value: 7 },
        keywords: ['突进'],
        pp: 1000,
      },
    ],
    entry: makeAylaCostSwapEntry('BP03-051', 6),
  },

  // 费用区 >= 5 张《艾拉·万华》时费用上限变为 11 的规则已内置于 ZoneManager.getMaxCostZoneCapacity
  {
    cardNumber: 'BP03-052',
    name: '艾拉·万华',
    vanillaEntry: true,
  },

  {
    cardNumber: 'BP03-053',
    name: '艾拉·万华',
    // 【永】：【充能0】由 rules/keywords.ts 自动解析
    entry: makeAylaCostSwapEntry('BP03-053', 5),
  },

  // 非战术【瞬时】能力已内置于 card-effects.ts (BP03_054_BUFF_ROLE)，切勿在 activate 中重复注册。
  {
    cardNumber: 'BP03-054',
    name: '艾拉·万华',
    vanillaEntry: true,
  },

  {
    cardNumber: 'BP03-055',
    name: '虹霁',
    vanillaEntry: true,
    activate: {
      cost: { kind: 'TAP_SELF' },
      steps: [
        {
          op: 'CHOOSE_ZONE_CARDS',
          side: 'SELF',
          zone: 'HAND',
          prompt: '【虹霁】【起】可将我方手牌 1 张《艾拉·万华》以横置状态放置到费用区',
          filter: { exactName: '艾拉·万华' },
          min: 0,
          max: 1,
          saveToVar: 'ayla',
          choiceEffectType: 'DSL_BP03-055_HAND_TO_COST',
        },
        {
          op: 'MOVE_CARDS',
          target: { kind: 'VAR', varName: 'ayla' },
          toZone: 'COST',
          isFaceUp: true,
          isReady: false,
          saveMovedToVar: 'moved',
        },
        {
          op: 'IF',
          condition: { kind: 'VAR_HAS_CARD_MATCHING', varName: 'moved', filter: { inZone: 'COST' } },
          then: [
            {
              op: 'IF',
              condition: {
                kind: 'ZONE_COUNT',
                side: 'SELF',
                zone: 'COST',
                filter: { isFaceUp: true, exactName: '艾拉·万华' },
                op: '>=',
                value: 6,
              },
              then: [
                {
                  op: 'CHOOSE_ZONE_CARDS',
                  side: 'SELF',
                  zone: 'COST',
                  prompt: '【虹霁】费用区《艾拉·万华》>=6张，可选择我方费用区最多 1 张明费加入手牌',
                  filter: { isFaceUp: true },
                  min: 0,
                  max: 1,
                  saveToVar: 'openCost',
                  choiceEffectType: 'DSL_BP03-055_SALVAGE_OPT',
                },
                { op: 'MOVE_CARDS', target: { kind: 'VAR', varName: 'openCost' }, toZone: 'HAND', isFaceUp: true },
              ],
              else: [
                {
                  op: 'CHOOSE_ZONE_CARDS',
                  side: 'SELF',
                  zone: 'COST',
                  prompt: '【虹霁】选择我方费用区 1 张明费加入手牌',
                  filter: { isFaceUp: true },
                  min: 1,
                  max: 1,
                  saveToVar: 'openCost',
                  choiceEffectType: 'DSL_BP03-055_SALVAGE_REQ',
                },
                { op: 'MOVE_CARDS', target: { kind: 'VAR', varName: 'openCost' }, toZone: 'HAND', isFaceUp: true },
              ],
            },
          ],
        },
      ],
    },
  },

  // ==================== 6. 莉莉丝·谬影 体系 (BP03-056 ~ BP03-066) ====================
  {
    cardNumber: 'BP03-056',
    name: '莉莉丝·谬影 纸牌屋',
    entry: {
      steps: [
        { op: 'DRAW', count: 1 },
        {
          op: 'CHOOSE_ZONE_CARDS',
          side: 'SELF',
          zone: 'HAND',
          prompt: '【莉莉丝·谬影 纸牌屋】【出】请选择 1 张手牌丢弃',
          min: 1,
          max: 1,
          saveToVar: 'discarded',
          choiceEffectType: 'DSL_BP03-056_DISCARD',
        },
        { op: 'MOVE_CARDS', target: { kind: 'VAR', varName: 'discarded' }, toZone: 'GRAVEYARD', isFaceUp: true },
      ],
    },
    activate: {
      oncePerTurn: true,
      cost: {
        kind: 'ELIMINATE_ORBS',
        filter: 'ANY',
        count: 2,
        prompt: '【莉莉丝·谬影 纸牌屋】【起】消除【2任意信号球】，复制墓地 1 张《莉莉丝·谬影》的【出】能力',
        choiceEffectType: 'DSL_BP03-056_ORB_COST',
      },
      steps: [{ op: 'CUSTOM_HANDLER', handlerId: 'BP03_056_COPY_GY_ENTRY' }],
    },
  },

  // 受限点：缺少让「对方」玩家自选丢弃 1 张费用严格高于我方公开牌的手牌交互与动态费用比较过滤
  // (CHOOSE_ZONE_CARDS 只能由控制者选择)，且普通手牌选择尚无 BP03-065/066 公开声明费用钩子；
  // 当前支持公开并丢弃我方手牌 1 张<莉莉丝>，对方无手牌时直接赋予【贯通】，有手牌时需补充自定义处理器交互。
  {
    cardNumber: 'BP03-057',
    name: '莉莉丝·谬影',
    // 【永】：【突进】由 rules/keywords.ts 自动解析
    entry: {
      steps: [{ op: 'CUSTOM_HANDLER', handlerId: 'BP03_057_LILITH_CHALLENGE' }],
    },
  },

  {
    cardNumber: 'BP03-058',
    name: '莉莉丝·谬影',
    entry: {
      steps: [{ op: 'CUSTOM_HANDLER', handlerId: 'BP03_058_ASCENDING_COST_5' }],
    },
  },

  {
    cardNumber: 'BP03-059',
    name: '莉莉丝·谬影',
    entry: {
      steps: [{ op: 'CUSTOM_HANDLER', handlerId: 'BP03_059_BLACKJACK_21' }],
    },
  },

  // 受限点：当前 NumberExpr 尚无统计公开卡牌「费用各不相同的牌张数 (DISTINCT_COST_COUNT)」表达式，
  // 且普通 REVEAL_TOP 未接入 BP03-065/066 公开费用宣言；当前先执行公开 3 张、选目标并将公开牌放回牌组底。
  {
    cardNumber: 'BP03-060',
    name: '莉莉丝·谬影',
    entry: {
      steps: [
        { op: 'REVEAL_TOP', count: 3, saveToVar: 'rev' },
        {
          op: 'CHOOSE_ROLES',
          side: 'SELF',
          prompt: '【莉莉丝·谬影】【出】选择我方战场 1 张<莉莉丝>角色，按公开牌不同费用数每有 1 张 PP+1000',
          filter: { trait: '莉莉丝' },
          min: 1,
          max: 1,
          saveToVar: 'lilithTarget',
          choiceEffectType: 'DSL_BP03-060_PICK',
        },
        {
          op: 'MODIFY_STATS',
          target: { kind: 'VAR', varName: 'lilithTarget' },
          pp: { kind: 'VAR_DISTINCT_COST_MULT', varName: 'rev', multiplier: 1000 },
          duration: 'END_OF_NEXT_TURN',
        },
        { op: 'MOVE_CARDS', target: { kind: 'VAR', varName: 'rev' }, toZone: 'DECK_BOTTOM' },
      ],
    },
  },

  {
    cardNumber: 'BP03-061',
    name: '莉莉丝·谬影',
    entries: [
      makePeekTopMillEntry('BP03-061'),
      {
        id: 'BP03-061_guess_parity',
        label: '【出】对方宣言奇偶，公开牌组顶1张，若费用奇偶不同则使1张<莉莉丝>回合结束竖直',
        steps: [{ op: 'CUSTOM_HANDLER', handlerId: 'BP03_061_GUESS_PARITY' }],
      },
    ],
  },

  // 受限点：ConditionExpr 尚无检测公开卡牌中「存在费用相同的牌 (VAR_HAS_DUPLICATE_COST)」条件，
  // 且普通 REVEAL_TOP 未接入 BP03-065/066 公开费用宣言；当前先完成公开顶 3 张牌并放置到墓地。
  {
    cardNumber: 'BP03-062',
    name: '莉莉丝·谬影',
    // 【永】：【充能0】由 rules/keywords.ts 自动解析
    entry: {
      steps: [
        { op: 'REVEAL_TOP', count: 3, saveToVar: 'rev' },
        { op: 'MOVE_CARDS', target: { kind: 'VAR', varName: 'rev' }, toZone: 'GRAVEYARD', isFaceUp: true },
        {
          op: 'IF',
          condition: { kind: 'VAR_HAS_DUPLICATE_COST', varName: 'rev' },
          then: [
            {
              op: 'CHOOSE_ZONE_CARDS',
              side: 'SELF',
              zone: 'GRAVEYARD',
              prompt: '【莉莉丝·谬影】【出】公开了费用相同的牌，可选择我方墓地最多 1 张<莉莉丝>加入手牌',
              filter: { trait: '莉莉丝' },
              min: 0,
              max: 1,
              saveToVar: 'recovered',
              choiceEffectType: 'DSL_BP03-062_RECOVER',
            },
            { op: 'MOVE_CARDS', target: { kind: 'VAR', varName: 'recovered' }, toZone: 'HAND', isFaceUp: true },
          ],
        },
      ],
    },
  },

  {
    cardNumber: 'BP03-063',
    name: '莉莉丝·谬影',
    entries: [
      makePeekTopMillEntry('BP03-063'),
      {
        id: 'BP03-063_clash_top',
        label: '【出】所有玩家公开牌组顶1张牌比较费用，费用更大的一方抽1张牌',
        steps: [{ op: 'CUSTOM_HANDLER', handlerId: 'BP03_063_CLASH_TOP' }],
      },
    ],
  },

  {
    cardNumber: 'BP03-064',
    name: '莉莉丝·谬影',
    entry: {
      steps: [{ op: 'CUSTOM_HANDLER', handlerId: 'BP03_064_SIMULTANEOUS_REVEAL_ORB' }],
    },
  },

  // 公开时的费用视为 2/4/6/8 宣言已在 custom-handlers.ts (LILITH_COST_DECL_CARDS) 中内置支持；
  // 受限点：CardFilter 缺少 isAttacking 战斗中状态过滤字段，暂以 CHOOSE_ROLES(side: 'ANY') 配合提示实现。
  {
    cardNumber: 'BP03-065',
    name: '血色醍醐',
    playPrecondition: {
      condition: { kind: 'CURRENT_COMBAT_EXISTS' },
      errorMessage: '【血色醍醐】只能在角色攻击时才能发动',
    },
    tactics: [
      {
        op: 'IF',
        condition: {
          kind: 'ZONE_COUNT',
          side: 'SELF',
          zone: 'GRAVEYARD',
          filter: { exactName: '莉莉丝·谬影' },
          op: '>=',
          value: 4,
        },
        then: [
          {
            op: 'CHOOSE_ZONE_CARDS',
            side: 'SELF',
            zone: 'GRAVEYARD',
            prompt: '【血色醍醐】选择我方墓地 4 张《莉莉丝·谬影》加入牌组并洗切',
            filter: { exactName: '莉莉丝·谬影' },
            min: 4,
            max: 4,
            saveToVar: 'gyLilith',
            choiceEffectType: 'DSL_BP03-065_GY_SHUFFLE',
          },
          {
            op: 'MOVE_CARDS',
            target: { kind: 'VAR', varName: 'gyLilith' },
            toZone: 'DECK_SHUFFLE',
            saveMovedToVar: 'shuffled',
          },
          {
            op: 'IF',
            condition: { kind: 'VAR_COUNT_COMPARE', varName: 'shuffled', op: '==', value: 4 },
            then: [
              {
                op: 'CHOOSE_ROLES',
                side: 'ANY',
                prompt: '【血色醍醐】选择我方或对方战场 1 张攻击中的角色',
                min: 1,
                max: 1,
                saveToVar: 'combatRole',
                choiceEffectType: 'DSL_BP03-065_ROLE',
              },
              {
                op: 'IF',
                condition: { kind: 'VAR_NON_EMPTY', varName: 'combatRole' },
                then: [
                  {
                    op: 'CHOOSE_MODE',
                    prompt: '【血色醍醐】选择直到那次攻击结束为止令该角色 DP+1 或 DP-1',
                    min: 1,
                    max: 1,
                    choiceEffectType: 'DSL_BP03-065_DP_MODE',
                    modes: [
                      {
                        id: 'dp_plus_1',
                        label: 'DP+1',
                        steps: [
                          {
                            op: 'MODIFY_STATS',
                            target: { kind: 'VAR', varName: 'combatRole' },
                            dp: 1,
                            duration: 'END_OF_COMBAT',
                          },
                        ],
                      },
                      {
                        id: 'dp_minus_1',
                        label: 'DP-1',
                        steps: [
                          {
                            op: 'MODIFY_STATS',
                            target: { kind: 'VAR', varName: 'combatRole' },
                            dp: -1,
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
        ],
      },
    ],
  },

  // 公开时的费用视为 1/3/5/7 宣言已在 custom-handlers.ts (LILITH_COST_DECL_CARDS) 中内置支持。
  {
    cardNumber: 'BP03-066',
    name: '繁宵蜃景之哀',
    vanillaEntry: true,
  },

  // ==================== 7. 罗兰·戏炎 体系 (BP03-067 ~ BP03-070) ====================
  {
    cardNumber: 'BP03-067',
    name: '罗兰·戏炎',
    entry: {
      steps: [
        {
          op: 'CHOOSE_ZONE_CARDS',
          side: 'SELF',
          zone: 'HAND',
          prompt: '【罗兰·戏炎】【出】可公开我方手牌 3 张属性各不相同的<升格者>以获得【速攻】 (选0张跳过)',
          filter: { trait: '升格者' },
          distinctAttributes: true,
          min: 0,
          max: 3,
          saveToVar: 'rev',
          choiceEffectType: 'DSL_BP03-067_REVEAL',
        },
        {
          op: 'IF',
          condition: { kind: 'VAR_COUNT_COMPARE', varName: 'rev', op: '==', value: 3 },
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
    triggers: [
      {
        abilityId: 'dsl:BP03-067:attack_copy_pp',
        eventType: 'ATTACK_DECLARED',
        matcher: { kind: 'SELF_ATTACKING' },
        label: '【罗兰·戏炎】【自】攻击时可弃1张<升格者>角色并消2球，直到下回合结束基本PP变为该角色基本PP',
        steps: [
          {
            op: 'IF',
            condition: {
              kind: 'ZONE_COUNT',
              side: 'SELF',
              zone: 'HAND',
              filter: { cardType: CardType.ROLE, trait: '升格者' },
              op: '>=',
              value: 1,
            },
            then: [
              {
                op: 'ELIMINATE_ORB_COST',
                filter: 'ANY',
                count: 2,
                optional: true,
                prompt: '【罗兰·戏炎】【自】是否消除【2任意信号球】并丢弃手牌 1 张<升格者>角色来复制其基本 PP？',
                choiceEffectType: 'DSL_BP03-067_ORB_COST',
                onPaid: [
                  {
                    op: 'DISCARD_COST_STEP',
                    count: 1,
                    filter: { cardType: CardType.ROLE, trait: '升格者' },
                    optional: false,
                    prompt: '【罗兰·戏炎】请选择手牌 1 张<升格者>角色丢弃',
                    choiceEffectType: 'DSL_BP03-067_DISCARD',
                    savePaidToVar: 'discRole',
                    onPaid: [
                      {
                        op: 'COPY_STATS_FROM_VAR',
                        target: { kind: 'SELF' },
                        fromVar: 'discRole',
                        copyBasePP: true,
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

  {
    cardNumber: 'BP03-068',
    name: '罗兰·戏炎',
    entry: {
      steps: [
        {
          op: 'CHOOSE_ZONE_CARDS',
          side: 'SELF',
          zone: 'HAND',
          prompt: '【罗兰·戏炎】【出】可公开手牌 2 张不为火属性且属性不同的<升格者>抽 1 张牌 (选0张跳过)',
          filter: { trait: '升格者', excludeAttribute: ElementAttribute.FIRE },
          distinctAttributes: true,
          min: 0,
          max: 2,
          saveToVar: 'rev',
          choiceEffectType: 'DSL_BP03-068_REVEAL',
        },
        {
          op: 'IF',
          condition: { kind: 'VAR_COUNT_COMPARE', varName: 'rev', op: '==', value: 2 },
          then: [{ op: 'DRAW', count: 1 }],
        },
      ],
    },
  },

  {
    cardNumber: 'BP03-069',
    name: '罗兰·戏炎',
    vanillaEntry: true,
    staticEffects: [
      {
        id: 'dsl:BP03-069:ascendant_diversity_dp_1',
        scope: 'SELF',
        condition: { kind: 'ROLE_ATTRIBUTE_DIVERSITY', side: 'SELF', filter: { trait: '升格者' }, minDistinct: 2 },
        setBaseDP: 1,
      },
    ],
  },

  {
    cardNumber: 'BP03-070',
    name: '虚缪赝戏',
    tactics: [
      {
        op: 'CHOOSE_ROLES',
        side: 'SELF',
        prompt: '【虚缪赝戏】选择我方战场 1 张《罗兰·戏炎》',
        filter: { exactName: '罗兰·戏炎' },
        min: 1,
        max: 1,
        saveToVar: 'roland',
        choiceEffectType: 'DSL_BP03-070_PICK_ROLAND',
      },
      {
        op: 'IF',
        condition: { kind: 'VAR_NON_EMPTY', varName: 'roland' },
        then: [
          {
            op: 'DISCARD_COST_STEP',
            count: 1,
            filter: { cardType: CardType.ROLE, trait: '升格者' },
            optional: true,
            prompt: '【虚缪赝戏】是否丢弃手牌 1 张<升格者>角色，令所选《罗兰·戏炎》基本PP和基本DP变为与其相同？',
            choiceEffectType: 'DSL_BP03-070_DISCARD',
            savePaidToVar: 'discRole',
            onPaid: [
              {
                op: 'COPY_STATS_FROM_VAR',
                target: { kind: 'VAR', varName: 'roland' },
                fromVar: 'discRole',
                copyBasePP: true,
                copyBaseDP: true,
                duration: 'END_OF_TURN',
              },
            ],
          },
        ],
      },
    ],
  },

  // ==================== 8. 赛琳娜·岚音 / 露西亚·深红之渊 / 暗费体系 (BP03-071 ~ BP03-080) ====================
  {
    cardNumber: 'BP03-071',
    name: '赛琳娜·岚音',
    entry: {
      steps: [
        {
          op: 'CHOOSE_MODE',
          prompt: '【赛琳娜·岚音】【出】是否消除【2任意信号球】或【3任意信号球】？',
          min: 1,
          max: 1,
          choiceEffectType: 'DSL_BP03-071_MODE',
          modes: [
            {
              id: 'elim_2',
              label: '消除【2任意信号球】',
              steps: [
                {
                  op: 'ELIMINATE_ORB_COST',
                  filter: 'ANY',
                  count: 2,
                  optional: true,
                  savePaidToVar: 'paidOrbs',
                  prompt: '【赛琳娜·岚音】请选择要消除的【2任意信号球】',
                  choiceEffectType: 'DSL_BP03-071_ORB_2',
                  onPaid: BP03_071_OUTCOME_STEPS,
                },
              ],
            },
            {
              id: 'elim_3',
              label: '消除【3任意信号球】',
              steps: [
                {
                  op: 'ELIMINATE_ORB_COST',
                  filter: 'ANY',
                  count: 3,
                  optional: true,
                  savePaidToVar: 'paidOrbs',
                  prompt: '【赛琳娜·岚音】请选择要消除的【3任意信号球】',
                  choiceEffectType: 'DSL_BP03-071_ORB_3',
                  onPaid: BP03_071_OUTCOME_STEPS,
                },
              ],
            },
            {
              id: 'skip',
              label: '不消除信号球',
              steps: [],
            },
          ],
        },
      ],
    },
  },

  {
    cardNumber: 'BP03-072',
    name: '赛琳娜·岚音',
    entry: {
      steps: makeRevealTopPickOneToHandSteps(
        'BP03-072',
        4,
        { cardType: CardType.TACTICS, trait: '艺术协会' },
        '【赛琳娜·岚音】【出】从公开的 4 张牌中选择最多 1 张<艺术协会>战术牌加入手牌'
      ),
    },
  },

  // 受限点：fieldCardCostRule 目前仅支持 targetName 与 cardType (且 firstPerTurnOnly 仅判定同名卡与 EQUIPMENT)，
  // 尚缺 targetTrait?: string 及联动 player.turnArtAssocTacticsPlayedCount 的首次判断支持。
  {
    cardNumber: 'BP03-073',
    name: '赛琳娜·岚音',
    vanillaEntry: true,
    // 【永】：【充能0】由 rules/keywords.ts 自动解析
    fieldCardCostRule: {
      targetTrait: '艺术协会',
      cardType: CardType.TACTICS,
      firstPerTurnOnly: true,
      discount: 1,
    },
  },

  {
    cardNumber: 'BP03-074',
    name: '风暴终曲',
    tactics: [
      {
        op: 'CHOOSE_MODE',
        prompt: '【风暴终曲】是否消除【1/2/3任意信号球】？',
        min: 1,
        max: 1,
        choiceEffectType: 'DSL_BP03-074_MODE',
        modes: [
          {
            id: 'elim_1',
            label: '消除【1任意信号球】',
            steps: [
              {
                op: 'ELIMINATE_ORB_COST',
                filter: 'ANY',
                count: 1,
                optional: true,
                savePaidToVar: 'paidOrbs',
                prompt: '【风暴终曲】请选择要消除的【1任意信号球】',
                choiceEffectType: 'DSL_BP03-074_ORB_1',
                onPaid: BP03_074_OUTCOME_STEPS,
              },
            ],
          },
          {
            id: 'elim_2',
            label: '消除【2任意信号球】',
            steps: [
              {
                op: 'ELIMINATE_ORB_COST',
                filter: 'ANY',
                count: 2,
                optional: true,
                savePaidToVar: 'paidOrbs',
                prompt: '【风暴终曲】请选择要消除的【2任意信号球】',
                choiceEffectType: 'DSL_BP03-074_ORB_2',
                onPaid: BP03_074_OUTCOME_STEPS,
              },
            ],
          },
          {
            id: 'elim_3',
            label: '消除【3任意信号球】',
            steps: [
              {
                op: 'ELIMINATE_ORB_COST',
                filter: 'ANY',
                count: 3,
                optional: true,
                savePaidToVar: 'paidOrbs',
                prompt: '【风暴终曲】请选择要消除的【3任意信号球】',
                choiceEffectType: 'DSL_BP03-074_ORB_3',
                onPaid: BP03_074_OUTCOME_STEPS,
              },
            ],
          },
          {
            id: 'skip',
            label: '不消除信号球',
            steps: [],
          },
        ],
      },
    ],
  },

  // 受限点：使用该牌时将信号球区任意张【蓝色信号球】(非消除、可不相邻、含「视为蓝色」) 置墓每张费用 -2；
  // playDiscardDiscount 当前仅支持 HAND 丢弃减费，尚缺支持 SIGNAL_ORB 区域移动减费的钩子。
  {
    cardNumber: 'BP03-075',
    name: '露西亚·深红之渊',
    vanillaEntry: true,
    // 【永】：【速攻】由 rules/keywords.ts 自动解析
    playDiscardDiscount: {
      sourceZone: 'SIGNAL_ORB',
      signalOrbColor: 'BLUE',
      filter: {},
      discountPerCard: 2,
      prompt: '【露西亚·深红之渊】可将我方信号球区任意张【蓝色信号球】放置到墓地，每放置 1 张该牌费用-2：',
    },
  },

  {
    cardNumber: 'BP03-076',
    name: '露西亚·深红之渊',
    entry: {
      steps: [
        {
          op: 'CHOOSE_ZONE_CARDS',
          side: 'SELF',
          zone: 'GRAVEYARD',
          prompt: '【露西亚·深红之渊】【出】选择我方墓地 1 张【蓝色信号球】，放置到我方信号球区最上方',
          filter: { signalOrbColor: 'BLUE' },
          min: 1,
          max: 1,
          saveToVar: 'blueOrb',
          choiceEffectType: 'DSL_BP03-076_GY_BLUE',
        },
        { op: 'MOVE_CARDS', target: { kind: 'VAR', varName: 'blueOrb' }, toZone: 'SIGNAL_ORB', isFaceUp: true },
      ],
    },
  },

  {
    cardNumber: 'BP03-077',
    name: '露西亚·深红之渊',
    vanillaEntry: true,
    triggers: [
      {
        abilityId: 'dsl:BP03-077:attack_treat_blue',
        eventType: 'ATTACK_DECLARED',
        matcher: { kind: 'SELF_ATTACKING' },
        condition: { kind: 'HAS_ROLE', side: 'SELF', filter: { trait: '阿尔法', excludeSelf: true } },
        label: '【露西亚·深红之渊】【自】攻击时若存在其他<阿尔法>角色，选1张信号球直到回合结束视为【蓝色信号球】',
        steps: [
          {
            op: 'CHOOSE_ZONE_CARDS',
            side: 'SELF',
            zone: 'SIGNAL_ORB',
            prompt: '【露西亚·深红之渊】【自】选择我方信号球区 1 张信号球，直到回合结束其视为【蓝色信号球】',
            filter: { isSignalOrb: true },
            min: 1,
            max: 1,
            saveToVar: 'orb',
            choiceEffectType: 'DSL_BP03-077_PICK_ORB',
          },
          {
            op: 'MODIFY_STATS',
            target: { kind: 'VAR', varName: 'orb' },
            treatedAsOrbColors: ['BLUE'],
            duration: 'END_OF_TURN',
          },
        ],
      },
    ],
  },

  {
    cardNumber: 'BP03-078',
    name: '命定之战',
    tactics: [
      {
        op: 'IF',
        condition: {
          kind: 'ANY',
          conditions: [
            { kind: 'HAS_ROLE', side: 'SELF', filter: { exactName: '露西亚·鸦羽' } },
            { kind: 'HAS_ROLE', side: 'OPPONENT', filter: { exactName: '露西亚·鸦羽' } },
          ],
        },
        then: [
          {
            op: 'CHOOSE_MODE',
            prompt: '【命定之战】战场存在《露西亚·鸦羽》，可从以下 2 项选择最多 2 项',
            min: 0,
            max: 2,
            choiceEffectType: 'DSL_BP03-078_MODE_2',
            modes: makeBp03078Modes('2'),
          },
        ],
        else: [
          {
            op: 'CHOOSE_MODE',
            prompt: '【命定之战】可从以下 2 项选择最多 1 项',
            min: 0,
            max: 1,
            choiceEffectType: 'DSL_BP03-078_MODE_1',
            modes: makeBp03078Modes('1'),
          },
        ],
      },
    ],
  },

  {
    cardNumber: 'BP03-079',
    name: '库洛洛',
    staticEffects: [
      {
        id: 'dsl:BP03-079:cannot_attack',
        scope: 'SELF',
        prohibitions: ['CANNOT_ATTACK'],
      },
    ],
    entry: {
      steps: [
        {
          op: 'CHOOSE_ZONE_CARDS',
          side: 'SELF',
          zone: 'COST',
          prompt: '【库洛洛】【出】选择我方费用区最多 1 张暗费，本回合结束时不因规则放置到墓地',
          filter: { isFaceUp: false },
          min: 0,
          max: 1,
          saveToVar: 'hiddenCost',
          choiceEffectType: 'DSL_BP03-079_PICK_HIDDEN',
        },
        {
          op: 'MODIFY_STATS',
          target: { kind: 'VAR', varName: 'hiddenCost' },
          prohibitions: ['CANNOT_DISCARD_HIDDEN_COST_AT_END'],
          duration: 'END_OF_TURN',
        },
      ],
    },
  },

  // 【永】：对方回合中对方支付费用时若可支付暗费必须支付暗费，已内置于 engine.ts payCost (mustPayHiddenFirst)。
  {
    cardNumber: 'BP03-080',
    name: '人型生物体：男&女',
    vanillaEntry: true,
  },

  // ==================== 9. 标准信号球战术牌 (BP03-081 ~ BP03-089) ====================
  // 【充能自】及使用置顶抽1逻辑已内置于 card-effects.ts，切勿重复注册至 triggers 或 tactics。
  { cardNumber: 'BP03-081', name: '“镜”中的真实', isSignalOrbCard: true },
  { cardNumber: 'BP03-082', name: '破晓之前', isSignalOrbCard: true },
  { cardNumber: 'BP03-083', name: '憧憬之光', isSignalOrbCard: true },
  { cardNumber: 'BP03-084', name: '我回来了', isSignalOrbCard: true },
  { cardNumber: 'BP03-085', name: '画中自我', isSignalOrbCard: true },
  { cardNumber: 'BP03-086', name: '缄默', isSignalOrbCard: true },
  { cardNumber: 'BP03-087', name: '黄金与人马', isSignalOrbCard: true },
  { cardNumber: 'BP03-088', name: '分晓子午线', isSignalOrbCard: true },
  { cardNumber: 'BP03-089', name: '盛放着鲜花的河流', isSignalOrbCard: true },
];

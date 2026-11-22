import { CardType, ElementAttribute } from '@zhanshuang/shared';
import type { CardEffectSpec, CardFilter, DeclarativeActivateSpec, DeclarativeTriggerSpec, EffectStep } from '../types.js';

/**
 * 兼容 official-cards-data.ts 中「卡列尼娜· 辉晓」带半角空格与卡面文本「卡列尼娜·辉晓」无空格两种写法
 */
const KARENINA_NAME_FILTER: CardFilter = {
  anyFilters: [{ exactName: '卡列尼娜· 辉晓' }, { exactName: '卡列尼娜·辉晓' }],
};

/** BP04-012 / BP04-013 / BP04-014 共用的「攻击对玩家造成伤害时，侵蚀>=5可弃1暗费使侵蚀-1」触发构造器 */
function createVeraPlayerDamageTrigger(cardNumber: string, abilityId: string): DeclarativeTriggerSpec {
  return {
    abilityId,
    eventType: 'ATTACK_DEALT_PLAYER_DAMAGE',
    matcher: { kind: 'SELF_DEALT_PLAYER_DAMAGE' },
    condition: { kind: 'EROSION_COMPARE', side: 'SELF', op: '>=', value: 5 },
    label: `【${cardNumber} 薇拉·灼惘】【自】对玩家造成伤害且侵蚀>=5时，可将1张暗费送墓使侵蚀-1`,
    steps: [
      {
        op: 'IF',
        condition: {
          kind: 'ZONE_COUNT',
          side: 'SELF',
          zone: 'COST',
          filter: { isFaceUp: false },
          op: '>=',
          value: 1,
        },
        then: [
          {
            op: 'CHOOSE_ZONE_CARDS',
            side: 'SELF',
            zone: 'COST',
            prompt: '【薇拉·灼惘】【自】可将我方费用区 1 张暗费放置到墓地使侵蚀计数-1（不选则跳过）',
            filter: { isFaceUp: false },
            min: 0,
            max: 1,
            saveToVar: 'hiddenCost',
            choiceEffectType: `DSL_${cardNumber}_HIDDEN_COST`,
          },
          {
            op: 'MOVE_CARDS',
            target: { kind: 'VAR', varName: 'hiddenCost' },
            toZone: 'GRAVEYARD',
            isFaceUp: true,
            saveMovedToVar: 'moved',
          },
          {
            op: 'IF',
            condition: { kind: 'VAR_NON_EMPTY', varName: 'moved' },
            then: [{ op: 'CHANGE_EROSION', side: 'SELF', delta: -1 }],
          },
        ],
      },
    ],
  };
}

/** BP04-010 红月临空：每有 2 张《露娜·终焉》下方牌使目标 PP-1000 (以阶梯条件规避负数整除舍入偏差) */
function buildRedMoonDebuffSteps(targetVar: string): EffectStep[] {
  const steps: EffectStep[] = [];
  for (let threshold = 2; threshold <= 40; threshold += 2) {
    steps.push({
      op: 'IF',
      condition: {
        kind: 'TOTAL_UNDERNEATH_COUNT',
        side: 'SELF',
        roleFilter: { exactName: '露娜·终焉' },
        op: '>=',
        value: threshold,
      },
      then: [
        {
          op: 'MODIFY_STATS',
          target: { kind: 'VAR', varName: targetVar },
          pp: -1000,
          duration: 'END_OF_TURN',
        },
      ],
    });
  }
  return steps;
}

/** BP04-050 / BP04-051 共用的墓地回手起动能力构造器 */
function createKnightGyToHandActivate(
  cardNumber: string,
  name: string,
  maxSelfCost: number
): DeclarativeActivateSpec {
  return {
    id: 'gy_to_hand',
    label: `【${name}】【起】墓地 1 张《血契者》或费用<=${maxSelfCost}《${name}》置牌组底，将该牌加入手牌`,
    usableZones: ['GRAVEYARD'],
    oncePerTurnByPlayer: true,
    condition: {
      kind: 'ZONE_COUNT',
      side: 'SELF',
      zone: 'GRAVEYARD',
      filter: {
        anyFilters: [
          { exactName: '血契者' },
          { exactName: name, maxCost: maxSelfCost },
        ],
      },
      op: '>=',
      value: 1,
    },
    conditionError: `墓地没有《血契者》或费用为 ${maxSelfCost} 及以下的《${name}》`,
    steps: [
      {
        op: 'CHOOSE_ZONE_CARDS',
        side: 'SELF',
        zone: 'GRAVEYARD',
        prompt: `【${name}】【起】选择我方墓地 1 张《血契者》或费用为 ${maxSelfCost} 及以下的《${name}》放置到牌组底：`,
        filter: {
          anyFilters: [
            { exactName: '血契者' },
            { exactName: name, maxCost: maxSelfCost },
          ],
        },
        min: 0,
        max: 1,
        saveToVar: 'botCard',
        choiceEffectType: `DSL_${cardNumber}_GY_BOT`,
      },
      {
        op: 'MOVE_CARDS',
        target: { kind: 'VAR', varName: 'botCard' },
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
          ],
        },
        then: [{ op: 'MOVE_CARDS', target: { kind: 'SELF' }, toZone: 'HAND', isFaceUp: true }],
      },
    ],
  };
}

/** BP04-053 / BP04-054 共用的墓地【4费】置底出场起动能力构造器 */
function createKnightGyReviveActivate(cardNumber: string, name: string): DeclarativeActivateSpec {
  return {
    id: 'gy_revive',
    label: `【${name}】【起】【4费】墓地 1 张<神寂启示录>角色置牌组底，将该牌从墓地出场`,
    usableZones: ['GRAVEYARD'],
    cost: { kind: 'PAY_COST', amount: 4 },
    condition: {
      kind: 'ALL',
      conditions: [
        { kind: 'HAS_EMPTY_SLOT', side: 'SELF' },
        {
          kind: 'ZONE_COUNT',
          side: 'SELF',
          zone: 'GRAVEYARD',
          filter: { cardType: CardType.ROLE, trait: '神寂启示录', excludeSelf: true },
          op: '>=',
          value: 1,
        },
      ],
    },
    conditionError: '需要战场有空余卡位且墓地存在其他<神寂启示录>角色',
    steps: [
      {
        op: 'CHOOSE_ZONE_CARDS',
        side: 'SELF',
        zone: 'GRAVEYARD',
        prompt: `【${name}】【起】选择我方墓地 1 张<神寂启示录>角色放置到牌组底：`,
        filter: { cardType: CardType.ROLE, trait: '神寂启示录', excludeSelf: true },
        min: 0,
        max: 1,
        saveToVar: 'bot',
        choiceEffectType: `DSL_${cardNumber}_REVIVE_BOT`,
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
        then: [{ op: 'MOVE_CARDS', target: { kind: 'SELF' }, toZone: 'BATTLEFIELD', triggerEntry: true }],
      },
    ],
  };
}

/** BP04-077 / BP04-078 / BP04-079 含英·清商共用构造器 (Q&A·10 不同编号各自独立计次) */
function createHanyingClearSongSpec(config: {
  cardNumber: 'BP04-077' | 'BP04-078' | 'BP04-079';
  orbColor: 'RED' | 'YELLOW' | 'BLUE';
  deployPayCost: number;
  deployLabel: string;
  tuckLabel: string;
  buffStep: (hostVar: string) => EffectStep;
}): CardEffectSpec {
  const { cardNumber, orbColor, deployPayCost, deployLabel, tuckLabel, buffStep } = config;
  const tuckIntoHostSteps = (hostVar: string): EffectStep[] => [
    {
      op: 'MOVE_CARDS',
      target: { kind: 'SELF' },
      toZone: 'UNDERNEATH',
      underneathHost: { kind: 'VAR', varName: hostVar },
      isFaceUp: true,
      saveMovedToVar: 'tucked',
    },
    {
      op: 'IF',
      condition: { kind: 'VAR_NON_EMPTY', varName: 'tucked' },
      then: [buffStep(hostVar)],
    },
  ];

  return {
    cardNumber,
    name: '含英·清商',
    vanillaEntry: true,
    activates: [
      {
        id: 'deploy_from_underneath',
        label: deployLabel,
        usableZones: ['UNDERNEATH'],
        condition: {
          kind: 'ALL',
          conditions: [
            { kind: 'HAS_EMPTY_SLOT', side: 'SELF' },
            {
              kind: 'ANY_HOST_UNDERNEATH_CONTAINS',
              side: 'SELF',
              roleFilter: { trait: '九龙商会' },
              cardFilter: { cardNumbers: [cardNumber] },
            },
          ],
        },
        conditionError: '需要该牌存在于我方<九龙商会>角色下方且战场有空余卡位',
        cost:
          deployPayCost > 0
            ? {
                kind: 'COMPOSITE',
                costs: [
                  {
                    kind: 'ELIMINATE_ORBS',
                    filter: orbColor,
                    count: 1,
                    prompt: `【含英·清商】选择消除【${orbColor === 'RED' ? '红色' : '黄色'}信号球】作为出场代价`,
                    choiceEffectType: `DSL_${cardNumber}_ORB_DEPLOY`,
                  },
                  { kind: 'PAY_COST', amount: deployPayCost },
                ],
              }
            : {
                kind: 'ELIMINATE_ORBS',
                filter: orbColor,
                count: 1,
                prompt: '【含英·清商】选择消除【蓝色信号球】作为出场代价',
                choiceEffectType: `DSL_${cardNumber}_ORB_DEPLOY`,
              },
        steps: [{ op: 'MOVE_CARDS', target: { kind: 'SELF' }, toZone: 'BATTLEFIELD', triggerEntry: true }],
      },
      {
        id: 'tuck_grant_buff',
        label: tuckLabel,
        usableZones: ['HAND', 'BATTLEFIELD'],
        oncePerTurnByPlayer: true,
        sharedTurnKey: `${cardNumber}:act:tuck`,
        condition: {
          kind: 'HAS_ROLE',
          side: 'SELF',
          filter: { trait: '九龙商会', excludeSelf: true },
        },
        conditionError: '我方战场没有其他<九龙商会>角色',
        steps: [
          {
            op: 'CHOOSE_ROLES',
            side: 'SELF',
            prompt: '【含英·清商】【起】选择我方战场 1 张<九龙商会>角色（将本牌放置到其下方）：',
            filter: { trait: '九龙商会', excludeSelf: true },
            min: 1,
            max: 1,
            saveToVar: 'host',
            choiceEffectType: `DSL_${cardNumber}_PICK_HOST`,
          },
          {
            op: 'IF',
            condition: {
              kind: 'VAR_HAS_CARD_MATCHING',
              varName: 'host',
              filter: { hasUnderneathOrEquipMatching: { exactName: '飞叶点翠' } },
            },
            then: [
              {
                op: 'CONFIRM_YES_NO',
                prompt: '所选<九龙商会>角色下方存在《飞叶点翠》，可支付【0费】将该牌放置到其下方，是否执行？',
                yesLabel: '支付 0 费置入下方',
                noLabel: '不执行',
                choiceEffectType: `DSL_${cardNumber}_FREE_TUCK`,
                onYes: tuckIntoHostSteps('host'),
              },
            ],
            else: [
              {
                op: 'PAY_COST_STEP',
                amount: 2,
                optional: true,
                prompt: '是否支付【2费】将该牌放置到所选<九龙商会>角色下方？',
                choiceEffectType: `DSL_${cardNumber}_PAY_TUCK`,
                onPaid: tuckIntoHostSteps('host'),
              },
            ],
          },
        ],
      },
    ],
  };
}

/**
 * BP04《终焉圣歌》全套 89 张卡牌精确声明式效果集合
 *
 * 说明：
 * - 以下永久/内置机制已由共享层引擎实现，切勿重复注册：
 *   1. continuous-effects.ts: static:BP04-001 (露娜·终焉下方牌 PP/DP)、static:BP04-016 (薇拉·灼惘对方回合 PP 防增减)、static:BP04-032 (炽能球视为红球)；
 *   2. replacement-engine.ts: builtin:BP04-065_ORPHAN_TO_ORB_BOTTOM (莱特宁无所属送墓强制置换至信号球区最下方)；
 *   3. card-effects.ts: BP04-004 / BP04-007 / BP04-028 非战术【瞬时】能力；BP04-020 / BP04-021 特殊【充能自】及 BP04-081~089 标准信号球【充能自】；
 *   4. engine.ts / battlefield-manager.ts / sba-engine.ts: BP04-011 下方使用战术、BP04-023~025 墓地协战与置底、BP04-038 辉晓消球不解除协战、BP04-052 血契者同场上限 1、BP04-061 信号球区正面升变。
 * - 个别受限于共享层 DSL 原语或引擎钩子的条款已在对应卡牌注释标明受限点。
 */
export const BP04_EFFECT_SPECS: readonly CardEffectSpec[] = [
  // ==================== 1. 露娜·终焉体系 (BP04-001 ~ BP04-011) ====================

  // BP04-001 露娜·终焉 (99费 升变)
  // 注：【永】下方每1张PP+1000、>=10张DP+1 已由 continuous-effects.ts (static:BP04-001) 实现，切勿重复注册！
  // 受限点：变为辅助机牌 (setCardType: ASSIST) 期间，interpreter.ts HOST_UNDERNEATH 经由 isSlotRole 扫描会跳过 BP04-001。
  {
    cardNumber: 'BP04-001',
    name: '露娜·终焉',
    vanillaEntry: true,
    triggers: [
      {
        abilityId: 'dsl:BP04-001:end_turn_tuck',
        eventType: 'END_PHASE_TRIGGERS',
        matcher: { kind: 'SELF_TURN_END', isSelfTurn: true },
        label: '【露娜·终焉】【自】我方回合结束时将1张手牌置入下方，随后选变辅助机或消3球竖直',
        steps: [
          {
            op: 'CHOOSE_ZONE_CARDS',
            side: 'SELF',
            zone: 'HAND',
            prompt: '【露娜·终焉】【自】将我方 1 张手牌放置到该牌下方：',
            min: 1,
            max: 1,
            saveToVar: 'handCard',
            choiceEffectType: 'DSL_BP04_001_HAND',
          },
          {
            op: 'MOVE_CARDS',
            target: { kind: 'VAR', varName: 'handCard' },
            toZone: 'UNDERNEATH',
            underneathHost: { kind: 'SELF' },
            isFaceUp: true,
          },
          {
            op: 'CHOOSE_MODE',
            prompt: '【露娜·终焉】【自】请从以下 2 项选择 1 项：',
            choiceEffectType: 'DSL_BP04_001_MODE',
            modes: [
              {
                id: 'tuck_all_become_assist',
                label: '将我方战场其他所有角色放置到该牌下方，直到下回合结束该牌变为辅助机牌',
                steps: [
                  {
                    op: 'MOVE_CARDS',
                    target: { kind: 'ALL_MATCHING_ROLES', side: 'SELF', filter: { excludeSelf: true } },
                    toZone: 'UNDERNEATH',
                    underneathHost: { kind: 'SELF' },
                    isFaceUp: true,
                  },
                  {
                    op: 'MODIFY_STATS',
                    target: { kind: 'SELF' },
                    setCardType: CardType.ASSIST,
                    duration: 'END_OF_NEXT_TURN',
                  },
                ],
              },
              {
                id: 'elim3_untap',
                label: '消除【3任意信号球】。若如此做，将该牌竖直',
                steps: [
                  {
                    op: 'ELIMINATE_ORB_COST',
                    filter: 'ANY',
                    count: 3,
                    optional: false,
                    prompt: '【露娜·终焉】【自】选择消除【3任意信号球】以将该牌竖直：',
                    choiceEffectType: 'DSL_BP04_001_ORB',
                    onPaid: [{ op: 'SET_READY', target: { kind: 'SELF' }, isReady: true }],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  },

  // BP04-002 露娜·终焉 (6费)
  {
    cardNumber: 'BP04-002',
    name: '露娜·终焉',
    entry: {
      cost: {
        kind: 'ELIMINATE_ORBS',
        filter: 'ANY',
        count: 2,
        optional: true,
        prompt: '【露娜·终焉】【出】是否消除【2任意信号球】？（若为我方回合可从以下 3 项选择，下方每有 4 张追加选 1 项）',
        choiceEffectType: 'DSL_BP04_002_ORB_COST',
      },
      steps: [
        {
          op: 'IF',
          condition: { kind: 'TURN_OWNER', isSelfTurn: true },
          then: [
            {
              op: 'CHOOSE_MODE',
              prompt: '【露娜·终焉】【出】请从以下 3 项选择 {pickCount} 项（不能重复选择）：',
              choiceEffectType: 'DSL_BP04_002_MODE',
              pickCountExpr: {
                kind: 'ADD',
                left: 1,
                right: {
                  kind: 'FLOOR_DIV',
                  expr: { kind: 'SUM_UNDERNEATH_COUNT', side: 'SELF', roleFilter: { exactName: '露娜·终焉' } },
                  divisor: 4,
                },
              },
              modes: [
                {
                  id: 'protect_pp',
                  label: '直到下个回合结束为止，该牌不会因效果放置到角色下方，PP+1000',
                  steps: [
                    {
                      op: 'MODIFY_STATS',
                      target: { kind: 'SELF' },
                      prohibitions: ['CANNOT_BE_PLACED_UNDERNEATH'],
                      pp: 1000,
                      duration: 'END_OF_NEXT_TURN',
                    },
                  ],
                },
                {
                  id: 'debuff_opp',
                  label: '选择对方战场 1 张角色，直到回合结束为止，其 PP-3000',
                  steps: [
                    {
                      op: 'CHOOSE_ROLES',
                      side: 'OPPONENT',
                      prompt: '【露娜·终焉】选择对方战场 1 张角色，直到回合结束 PP-3000：',
                      min: 1,
                      max: 1,
                      saveToVar: 'oppTarget',
                      choiceEffectType: 'DSL_BP04_002_DEBUFF',
                    },
                    {
                      op: 'MODIFY_STATS',
                      target: { kind: 'VAR', varName: 'oppTarget' },
                      pp: -3000,
                      duration: 'END_OF_TURN',
                    },
                  ],
                },
                {
                  id: 'untap_luna',
                  label: '选择我方战场 1 张《露娜·终焉》，将其竖直',
                  steps: [
                    {
                      op: 'CHOOSE_ROLES',
                      side: 'SELF',
                      prompt: '【露娜·终焉】选择我方战场 1 张《露娜·终焉》，将其竖直：',
                      filter: { exactName: '露娜·终焉' },
                      min: 1,
                      max: 1,
                      saveToVar: 'lunaTarget',
                      choiceEffectType: 'DSL_BP04_002_UNTAP',
                    },
                    { op: 'SET_READY', target: { kind: 'VAR', varName: 'lunaTarget' }, isReady: true },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  },

  // BP04-003 露娜·终焉 (4费)
  {
    cardNumber: 'BP04-003',
    name: '露娜·终焉',
    entry: {
      steps: [
        {
          op: 'CHOOSE_MODE',
          prompt: '【露娜·终焉】【出】请从以下 2 项选择 1 项：',
          choiceEffectType: 'DSL_BP04_003_MODE',
          modes: [
            {
              id: 'search_top4',
              label: '公开牌组顶 4 张，选最多 1 张《露娜·终焉》/《月冕权能》/《红月临空》加入手牌，其余放牌组底',
              steps: [
                { op: 'REVEAL_TOP', count: 4, saveToVar: 'revealed' },
                {
                  op: 'CHOOSE_FROM_VAR',
                  varName: 'revealed',
                  prompt: '【露娜·终焉】【出】选择其中最多 1 张《露娜·终焉》/《月冕权能》/《红月临空》加入手牌（其余放牌组底）：',
                  filter: {
                    anyFilters: [
                      { exactName: '露娜·终焉' },
                      { exactName: '月冕权能' },
                      { exactName: '红月临空' },
                    ],
                  },
                  alwaysShow: true,
                  min: 0,
                  max: 1,
                  saveToVar: 'kept',
                  choiceEffectType: 'DSL_BP04_003_PICK',
                },
                { op: 'MOVE_CARDS', target: { kind: 'VAR', varName: 'kept' }, toZone: 'HAND', isFaceUp: true },
                {
                  op: 'MOVE_CARDS',
                  target: { kind: 'REST_OF_VAR', allVar: 'revealed', excludeVar: 'kept' },
                  toZone: 'DECK_BOTTOM',
                },
              ],
            },
            {
              id: 'underneath7_rush',
              label: '若我方战场《露娜·终焉》下方合计 >=7 张，本回合不会因效果置入下方并获得【速攻】',
              steps: [
                {
                  op: 'IF',
                  condition: {
                    kind: 'TOTAL_UNDERNEATH_COUNT',
                    side: 'SELF',
                    roleFilter: { exactName: '露娜·终焉' },
                    op: '>=',
                    value: 7,
                  },
                  then: [
                    {
                      op: 'MODIFY_STATS',
                      target: { kind: 'SELF' },
                      prohibitions: ['CANNOT_BE_PLACED_UNDERNEATH'],
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

  // BP04-004 露娜·终焉 (5费 突进 + 非战术【瞬时】已内置于 card-effects.ts)
  {
    cardNumber: 'BP04-004',
    name: '露娜·终焉',
    vanillaEntry: true,
  },

  // BP04-005 露娜·终焉 (5费)
  {
    cardNumber: 'BP04-005',
    name: '露娜·终焉',
    entry: {
      steps: [
        {
          op: 'CHOOSE_MODE',
          prompt: '【露娜·终焉】【出】请从以下 2 项选择 1 项：',
          choiceEffectType: 'DSL_BP04_005_MODE',
          modes: [
            {
              id: 'tuck_void_protect',
              label: '选我方 1 张《露娜·终焉》，将手牌或墓地最多 1 张空属性角色置其下方；本回合该牌不会因效果置入下方',
              steps: [
                {
                  op: 'CHOOSE_ROLES',
                  side: 'SELF',
                  prompt: '【露娜·终焉】选择我方战场 1 张《露娜·终焉》：',
                  filter: { exactName: '露娜·终焉' },
                  min: 1,
                  max: 1,
                  saveToVar: 'hostLuna',
                  choiceEffectType: 'DSL_BP04_005_HOST',
                },
                {
                  op: 'IF',
                  condition: { kind: 'VAR_NON_EMPTY', varName: 'hostLuna' },
                  then: [
                    {
                      op: 'CHOOSE_ZONE_CARDS',
                      side: 'SELF',
                      zone: 'HAND',
                      zones: ['HAND', 'GRAVEYARD'],
                      prompt: '【露娜·终焉】选择我方手牌或墓地最多 1 张空属性角色牌放置到其下方：',
                      filter: { cardType: CardType.ROLE, attribute: ElementAttribute.VOID },
                      min: 0,
                      max: 1,
                      saveToVar: 'voidRole',
                      choiceEffectType: 'DSL_BP04_005_VOID_ROLE',
                    },
                    {
                      op: 'MOVE_CARDS',
                      target: { kind: 'VAR', varName: 'voidRole' },
                      toZone: 'UNDERNEATH',
                      underneathHost: { kind: 'VAR', varName: 'hostLuna' },
                      isFaceUp: true,
                    },
                  ],
                },
                {
                  op: 'MODIFY_STATS',
                  target: { kind: 'SELF' },
                  prohibitions: ['CANNOT_BE_PLACED_UNDERNEATH'],
                  duration: 'END_OF_TURN',
                },
              ],
            },
            {
              id: 'elim2_deploy_underneath',
              label: '若为我方回合，可消除【2任意信号球】将《露娜·终焉》下方 1 张费用<=4的<升格者>角色出场',
              steps: [
                {
                  op: 'IF',
                  condition: { kind: 'TURN_OWNER', isSelfTurn: true },
                  then: [
                    {
                      op: 'ELIMINATE_ORB_COST',
                      filter: 'ANY',
                      count: 2,
                      optional: true,
                      prompt: '【露娜·终焉】是否消除【2任意信号球】，从《露娜·终焉》下方出场 1 张费用<=4<升格者>角色？',
                      choiceEffectType: 'DSL_BP04_005_ORB',
                      onPaid: [
                        {
                          op: 'CHOOSE_ZONE_CARDS',
                          side: 'SELF',
                          zone: 'HOST_UNDERNEATH',
                          hostFilter: { exactName: '露娜·终焉' },
                          prompt: '【露娜·终焉】选择《露娜·终焉》下方 1 张费用为 4 及以下的<升格者>角色出场：',
                          filter: { cardType: CardType.ROLE, trait: '升格者', maxCost: 4 },
                          requireEmptySlot: true,
                          min: 1,
                          max: 1,
                          saveToVar: 'deployCard',
                          choiceEffectType: 'DSL_BP04_005_DEPLOY',
                        },
                        {
                          op: 'MOVE_CARDS',
                          target: { kind: 'VAR', varName: 'deployCard' },
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

  // BP04-006 露娜·终焉 (3费 充能0)
  {
    cardNumber: 'BP04-006',
    name: '露娜·终焉',
    entry: {
      steps: [
        {
          op: 'CHOOSE_ROLES',
          side: 'SELF',
          prompt: '【露娜·终焉】【出】选择我方战场 1 张《露娜·终焉》：',
          filter: { exactName: '露娜·终焉' },
          min: 1,
          max: 1,
          saveToVar: 'hostLuna',
          choiceEffectType: 'DSL_BP04_006_HOST',
        },
        {
          op: 'IF',
          condition: {
            kind: 'ALL',
            conditions: [
              { kind: 'VAR_NON_EMPTY', varName: 'hostLuna' },
              {
                kind: 'ZONE_COUNT',
                side: 'SELF',
                zone: 'HAND',
                filter: { attribute: ElementAttribute.VOID },
                op: '>=',
                value: 1,
              },
            ],
          },
          then: [
            {
              op: 'CHOOSE_ZONE_CARDS',
              side: 'SELF',
              zone: 'HAND',
              prompt: '【露娜·终焉】可将我方手牌 1 张空属性的牌放置到其下方并抽 1 张牌（不选则跳过）：',
              filter: { attribute: ElementAttribute.VOID },
              min: 0,
              max: 1,
              saveToVar: 'voidCard',
              choiceEffectType: 'DSL_BP04_006_HAND',
            },
            {
              op: 'MOVE_CARDS',
              target: { kind: 'VAR', varName: 'voidCard' },
              toZone: 'UNDERNEATH',
              underneathHost: { kind: 'VAR', varName: 'hostLuna' },
              isFaceUp: true,
              saveMovedToVar: 'moved',
            },
            {
              op: 'IF',
              condition: { kind: 'VAR_NON_EMPTY', varName: 'moved' },
              then: [{ op: 'DRAW', count: 1 }],
            },
          ],
        },
      ],
    },
  },

  // BP04-007 露娜·终焉 (3费；非战术【瞬时】已内置于 card-effects.ts)
  // Q&A·10：两张《露娜·终焉》下方分别存在《月冕权能》《红月临空》时也满足。
  {
    cardNumber: 'BP04-007',
    name: '露娜·终焉',
    vanillaEntry: true,
    staticEffects: [
      {
        id: 'dsl:BP04-007:base_dp_one',
        scope: 'SELF',
        condition: {
          kind: 'ALL',
          conditions: [
            {
              kind: 'ANY_HOST_UNDERNEATH_CONTAINS',
              side: 'SELF',
              roleFilter: { exactName: '露娜·终焉' },
              cardFilter: { exactName: '月冕权能' },
            },
            {
              kind: 'ANY_HOST_UNDERNEATH_CONTAINS',
              side: 'SELF',
              roleFilter: { exactName: '露娜·终焉' },
              cardFilter: { exactName: '红月临空' },
            },
          ],
        },
        setBaseDP: 1,
      },
    ],
  },

  // BP04-008 露娜·终焉 (2费)
  {
    cardNumber: 'BP04-008',
    name: '露娜·终焉',
    vanillaEntry: true,
    staticEffects: [
      {
        id: 'dsl:BP04-008:no_self_underneath',
        scope: 'SELF',
        prohibitions: ['CANNOT_BE_PLACED_UNDERNEATH_BY_SELF'],
      },
    ],
  },

  // BP04-009 月冕权能 (3费 战术)
  // 受限点：continuous-effects.ts 中 scope: 'ALL_FRIENDLY_ROLES' 仅扫描顶层角色而不扫描 underneathCardIds，
  // 当前先以 scope: 'UNDERNEATH_HOST' 为宿主《露娜·终焉》提供我方回合 PP+1000（其余<升格者>角色光环需共享层扩展下方来源）。
  {
    cardNumber: 'BP04-009',
    name: '月冕权能',
    tactics: [
      {
        op: 'CHOOSE_ROLES',
        side: 'SELF',
        prompt: '【月冕权能】选择我方战场 1 张《露娜·终焉》：',
        filter: { exactName: '露娜·终焉' },
        min: 1,
        max: 1,
        saveToVar: 'luna',
        choiceEffectType: 'DSL_BP04_009_LUNA',
      },
      {
        op: 'IF',
        condition: { kind: 'VAR_NON_EMPTY', varName: 'luna' },
        then: [
          {
            op: 'CONFIRM_YES_NO',
            prompt: '【月冕权能】是否将该牌放置到所选《露娜·终焉》下方并将其竖直？',
            yesLabel: '置入下方并竖直',
            noLabel: '不放置',
            choiceEffectType: 'DSL_BP04_009_CONFIRM',
            onYes: [
              {
                op: 'MOVE_CARDS',
                target: { kind: 'SELF' },
                toZone: 'UNDERNEATH',
                underneathHost: { kind: 'VAR', varName: 'luna' },
                isFaceUp: true,
                saveMovedToVar: 'moved',
              },
              {
                op: 'IF',
                condition: { kind: 'VAR_NON_EMPTY', varName: 'moved' },
                then: [{ op: 'SET_READY', target: { kind: 'VAR', varName: 'luna' }, isReady: true }],
              },
            ],
          },
        ],
      },
    ],
    staticEffects: [
      {
        id: 'dsl:BP04-009:host_ascendant_pp',
        scope: 'UNDERNEATH_HOST',
        condition: { kind: 'TURN_OWNER', isSelfTurn: true },
        targetFilter: { exactName: '露娜·终焉', trait: '升格者' },
        pp: 1000,
        dependsOnTraits: true,
      },
    ],
  },

  // BP04-010 红月临空 (4费 战术)
  // 注：NumberExpr 尚无外层乘法 MUL，故使用 TOTAL_UNDERNEATH_COUNT 阶梯条件精确计算 floor(count/2) * (-1000)。
  {
    cardNumber: 'BP04-010',
    name: '红月临空',
    tactics: [
      {
        op: 'CHOOSE_ROLES',
        side: 'SELF',
        prompt: '【红月临空】选择我方战场 1 张《露娜·终焉》：',
        filter: { exactName: '露娜·终焉' },
        min: 1,
        max: 1,
        saveToVar: 'luna',
        choiceEffectType: 'DSL_BP04_010_LUNA',
      },
      {
        op: 'IF',
        condition: { kind: 'VAR_NON_EMPTY', varName: 'luna' },
        then: [
          {
            op: 'CONFIRM_YES_NO',
            prompt: '【红月临空】是否将该牌放置到所选《露娜·终焉》下方？',
            yesLabel: '放置到下方',
            noLabel: '不放置',
            choiceEffectType: 'DSL_BP04_010_CONFIRM',
            onYes: [
              {
                op: 'MOVE_CARDS',
                target: { kind: 'SELF' },
                toZone: 'UNDERNEATH',
                underneathHost: { kind: 'VAR', varName: 'luna' },
                isFaceUp: true,
              },
            ],
          },
        ],
      },
      {
        op: 'CHOOSE_ROLES',
        side: 'OPPONENT',
        prompt: '【红月临空】选择对方战场 1 张角色（《露娜·终焉》下方合计每有 2 张牌 PP-1000）：',
        min: 1,
        max: 1,
        saveToVar: 'oppTarget',
        choiceEffectType: 'DSL_BP04_010_DEBUFF',
      },
      {
        op: 'IF',
        condition: { kind: 'VAR_NON_EMPTY', varName: 'oppTarget' },
        then: buildRedMoonDebuffSteps('oppTarget'),
      },
    ],
    triggers: [
      {
        abilityId: 'dsl:BP04-010:underneath_deploy_buff',
        eventType: 'CARD_ENTERED_FIELD',
        matcher: {
          kind: 'SELF_IN_UNDERNEATH_ON_FRIENDLY_DEPLOY_FROM_UNDERNEATH',
          hostName: '露娜·终焉',
        },
        label: '【红月临空】【自】从《露娜·终焉》下方出场时，该角色 PP+1000',
        steps: [
          {
            op: 'MODIFY_STATS',
            target: { kind: 'TRIGGER_TARGET' },
            pp: 1000,
            duration: 'END_OF_TURN',
          },
        ],
      },
    ],
  },

  // BP04-011 升空凌视 (2费 瞬时战术)
  // 受限点：若《露娜·终焉》处于 BP04-001 变为辅助机期间，CHOOSE_ZONE_CARDS(HOST_UNDERNEATH) 依赖 isSlotRole 尚无法遍历其下方卡牌。
  {
    cardNumber: 'BP04-011',
    name: '升空凌视',
    playFromZones: ['HAND', 'UNDERNEATH'],
    tactics: [
      {
        op: 'CHOOSE_ZONE_CARDS',
        side: 'SELF',
        zone: 'HOST_UNDERNEATH',
        hostFilter: { exactName: '露娜·终焉' },
        prompt: '【升空凌视】【瞬时】选择我方《露娜·终焉》下方 1 张费用为 5 及以下的《露娜·终焉》出场：',
        filter: { cardType: CardType.ROLE, exactName: '露娜·终焉', maxCost: 5 },
        requireEmptySlot: true,
        min: 1,
        max: 1,
        saveToVar: 'lunaDeploy',
        choiceEffectType: 'DSL_BP04_011_DEPLOY',
      },
      {
        op: 'MOVE_CARDS',
        target: { kind: 'VAR', varName: 'lunaDeploy' },
        toZone: 'BATTLEFIELD',
        triggerEntry: true,
      },
    ],
  },

  // ==================== 2. 薇拉·灼惘体系 (BP04-012 ~ BP04-022) ====================

  // BP04-012 薇拉·灼惘 (8费 升变；侵蚀>=6 蓝/黄球充能自视作红球已内置于 card-effects.ts)
  {
    cardNumber: 'BP04-012',
    name: '薇拉·灼惘',
    vanillaEntry: true,
    staticEffects: [
      {
        id: 'dsl:BP04-012:erosion5_rush_pp',
        scope: 'SELF',
        condition: { kind: 'EROSION_COMPARE', side: 'SELF', op: '>=', value: 5 },
        keywords: ['速攻'],
        pp: 2000,
      },
    ],
    activate: {
      oncePerTurnByPlayer: true,
      cost: { kind: 'DEAL_SELF_DAMAGE', amount: 1 },
      steps: [
        {
          op: 'CHOOSE_ROLES',
          side: 'SELF',
          prompt: '【薇拉·灼惘】【起】选择我方战场 1 张《薇拉·灼惘》，直到回合结束获得【速攻】：',
          filter: { exactName: '薇拉·灼惘' },
          min: 1,
          max: 1,
          saveToVar: 'vera',
          choiceEffectType: 'DSL_BP04_012_RUSH',
        },
        {
          op: 'MODIFY_STATS',
          target: { kind: 'VAR', varName: 'vera' },
          keywords: ['速攻'],
          duration: 'END_OF_TURN',
        },
      ],
    },
    triggers: [createVeraPlayerDamageTrigger('BP04-012', 'dsl:BP04-012:player_dmg_reduce_erosion')],
  },

  // BP04-013 薇拉·灼惘 (7费 升变)
  // 注：AbilityCost 尚无 OR 消球原语，故通过 activate.condition + IF/CHOOSE_MODE 实现【蓝色信号球】或【2任意信号球】二选一。
  {
    cardNumber: 'BP04-013',
    name: '薇拉·灼惘',
    vanillaEntry: true,
    activate: {
      oncePerTurn: true,
      condition: {
        kind: 'ANY',
        conditions: [
          {
            kind: 'ZONE_COUNT',
            side: 'SELF',
            zone: 'SIGNAL_ORB',
            filter: { signalOrbColor: 'BLUE' },
            op: '>=',
            value: 1,
          },
          {
            kind: 'ZONE_COUNT',
            side: 'SELF',
            zone: 'SIGNAL_ORB',
            filter: { isSignalOrb: true },
            op: '>=',
            value: 2,
          },
        ],
      },
      conditionError: '需要信号球区存在【蓝色信号球】或【2任意信号球】',
      steps: [
        (() => {
          const askSelfDamageSteps: EffectStep[] = [
            {
              op: 'CONFIRM_YES_NO',
              prompt: '【薇拉·灼惘】【起】是否给予我方 1 点伤害使该牌直到回合结束获得【充能+2】？',
              yesLabel: '给予 1 点伤害',
              noLabel: '不执行',
              choiceEffectType: 'DSL_BP04_013_DAMAGE',
              onYes: [
                { op: 'DEAL_DAMAGE', side: 'SELF', amount: 1 },
                {
                  op: 'IF',
                  condition: { kind: 'EROSION_COMPARE', side: 'SELF', op: '<', value: 7 },
                  then: [
                    {
                      op: 'MODIFY_STATS',
                      target: { kind: 'SELF' },
                      charge: 2,
                      duration: 'END_OF_TURN',
                    },
                  ],
                },
              ],
            },
          ];
          const payBlue: EffectStep = {
            op: 'ELIMINATE_ORB_COST',
            filter: 'BLUE',
            count: 1,
            optional: false,
            prompt: '【薇拉·灼惘】选择消除【蓝色信号球】1 张：',
            choiceEffectType: 'DSL_BP04_013_BLUE_ORB',
            onPaid: askSelfDamageSteps,
          };
          const payAny2: EffectStep = {
            op: 'ELIMINATE_ORB_COST',
            filter: 'ANY',
            count: 2,
            optional: false,
            prompt: '【薇拉·灼惘】选择消除【2任意信号球】：',
            choiceEffectType: 'DSL_BP04_013_ANY2_ORB',
            onPaid: askSelfDamageSteps,
          };
          return {
            op: 'IF',
            condition: {
              kind: 'ALL',
              conditions: [
                {
                  kind: 'ZONE_COUNT',
                  side: 'SELF',
                  zone: 'SIGNAL_ORB',
                  filter: { signalOrbColor: 'BLUE' },
                  op: '>=',
                  value: 1,
                },
                {
                  kind: 'ZONE_COUNT',
                  side: 'SELF',
                  zone: 'SIGNAL_ORB',
                  filter: { isSignalOrb: true },
                  op: '>=',
                  value: 2,
                },
              ],
            },
            then: [
              {
                op: 'CHOOSE_MODE',
                prompt: '【薇拉·灼惘】【起】请选择作为代价消除的信号球组合：',
                choiceEffectType: 'DSL_BP04_013_COST_MODE',
                modes: [
                  { id: 'blue1', label: '消除【蓝色信号球】1 张', steps: [payBlue] },
                  { id: 'any2', label: '消除【2任意信号球】', steps: [payAny2] },
                ],
              },
            ],
            else: [
              {
                op: 'IF',
                condition: {
                  kind: 'ZONE_COUNT',
                  side: 'SELF',
                  zone: 'SIGNAL_ORB',
                  filter: { signalOrbColor: 'BLUE' },
                  op: '>=',
                  value: 1,
                },
                then: [payBlue],
                else: [payAny2],
              },
            ],
          };
        })(),
      ],
    },
    triggers: [createVeraPlayerDamageTrigger('BP04-013', 'dsl:BP04-013:player_dmg_reduce_erosion')],
  },

  // BP04-014 薇拉·灼惘 (6费)
  {
    cardNumber: 'BP04-014',
    name: '薇拉·灼惘',
    vanillaEntry: true,
    handCostDiscount: {
      condition: { kind: 'DAMAGE_TAKEN_THIS_TURN', side: 'SELF', op: '>=', value: 1 },
      flatDiscount: 2,
    },
    staticEffects: [
      {
        id: 'dsl:BP04-014:dmg2_rush',
        scope: 'SELF',
        condition: { kind: 'DAMAGE_TAKEN_THIS_TURN', side: 'SELF', op: '>=', value: 2 },
        keywords: ['速攻'],
      },
    ],
    triggers: [createVeraPlayerDamageTrigger('BP04-014', 'dsl:BP04-014:player_dmg_reduce_erosion')],
  },

  // BP04-015 薇拉·灼惘 (5费)
  // 受限点：【自】【回合2】：我方回合中，我方受到伤害时...
  // 1. DeclarativeTriggerMatcher 尚缺少监听 DAMAGE_DEALT 的匹配器；
  // 2. DeclarativeTriggerSpec 尚缺少按实例每回合 N 次上限 (maxPerTurn: 2) 与 OR 消球可选代价；
  // 需待共享层补充 PLAYER_DAMAGE_DEALT 匹配器与 maxPerTurn 支持后接入 triggers。
  {
    cardNumber: 'BP04-015',
    name: '薇拉·灼惘',
    vanillaEntry: true,
  },

  // BP04-016 薇拉·灼惘 (5费)
  // 注：【永】「对方回合中，该牌的PP不会因对方的效果增减」已由 continuous-effects.ts (static:BP04-016) 实现，切勿重复注册！
  {
    cardNumber: 'BP04-016',
    name: '薇拉·灼惘',
    entry: {
      steps: [
        {
          op: 'IF',
          condition: {
            kind: 'ZONE_COUNT',
            side: 'OPPONENT',
            zone: 'COST',
            filter: { isFaceUp: true },
            op: '>=',
            value: 5,
          },
          then: [
            {
              op: 'CONFIRM_YES_NO',
              prompt: '【薇拉·灼惘】【出】对方明费上限 >= 5，是否给予我方 1 点伤害？',
              yesLabel: '给予 1 点伤害',
              noLabel: '不执行',
              choiceEffectType: 'DSL_BP04_016_DAMAGE',
              onYes: [{ op: 'DEAL_DAMAGE', side: 'SELF', amount: 1 }],
            },
            {
              op: 'IF',
              condition: {
                kind: 'ALL',
                conditions: [
                  { kind: 'EROSION_COMPARE', side: 'SELF', op: '<', value: 7 },
                  {
                    kind: 'ZONE_COUNT',
                    side: 'SELF',
                    zone: 'COST',
                    filter: { isFaceUp: false },
                    op: '>=',
                    value: 1,
                  },
                ],
              },
              then: [
                {
                  op: 'CHOOSE_ZONE_CARDS',
                  side: 'SELF',
                  zone: 'COST',
                  prompt: '【薇拉·灼惘】可将我方费用区 1 张暗费放置到墓地，破坏对方 1 张费用<=3角色（不选则跳过）：',
                  filter: { isFaceUp: false },
                  min: 0,
                  max: 1,
                  saveToVar: 'hiddenCost',
                  choiceEffectType: 'DSL_BP04_016_HIDDEN',
                },
                {
                  op: 'MOVE_CARDS',
                  target: { kind: 'VAR', varName: 'hiddenCost' },
                  toZone: 'GRAVEYARD',
                  isFaceUp: true,
                  saveMovedToVar: 'moved',
                },
                {
                  op: 'IF',
                  condition: { kind: 'VAR_NON_EMPTY', varName: 'moved' },
                  then: [
                    {
                      op: 'CHOOSE_ROLES',
                      side: 'OPPONENT',
                      prompt: '【薇拉·灼惘】选择对方战场 1 张费用为 3 及以下的角色，将其破坏：',
                      filter: { maxCost: 3 },
                      min: 1,
                      max: 1,
                      saveToVar: 'oppTarget',
                      choiceEffectType: 'DSL_BP04_016_DESTROY',
                    },
                    { op: 'DESTROY_ROLES', target: { kind: 'VAR', varName: 'oppTarget' } },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  },

  // BP04-017 薇拉·灼惘 (4费)
  {
    cardNumber: 'BP04-017',
    name: '薇拉·灼惘',
    vanillaEntry: true,
    triggers: [
      {
        abilityId: 'dsl:BP04-017:attack_end_untap',
        eventType: 'ATTACK_DECLARED',
        oncePerTurn: true,
        matcher: { kind: 'SELF_ATTACKING' },
        condition: {
          kind: 'ALL_ZONE_CARDS_MATCH',
          side: 'SELF',
          zone: 'COST',
          preFilter: { isFaceUp: true, cardType: CardType.ROLE },
          matchFilter: { attribute: ElementAttribute.FIRE },
        },
        label: '【薇拉·灼惘】【自】【回合1】攻击时若明费角色均为火属性，可自伤 1 点于回合结束竖直',
        steps: [
          {
            op: 'CONFIRM_YES_NO',
            prompt: '【薇拉·灼惘】【自】是否给予我方 1 点伤害，并于该回合结束时将该牌竖直？',
            yesLabel: '给予 1 点伤害',
            noLabel: '不执行',
            choiceEffectType: 'DSL_BP04_017_DAMAGE',
            onYes: [
              { op: 'DEAL_DAMAGE', side: 'SELF', amount: 1 },
              {
                op: 'IF',
                condition: { kind: 'EROSION_COMPARE', side: 'SELF', op: '<', value: 7 },
                then: [
                  {
                    op: 'REGISTER_DELAYED_TRIGGER',
                    target: { kind: 'SELF' },
                    eventType: 'END_PHASE_TRIGGERS',
                    turnOffset: 0,
                    abilityId: 'DELAYED_END_OF_TURN_UNTAP',
                    expectedZone: 'BATTLEFIELD',
                    labelSuffix: '该回合结束时将其竖直 (BP04-017)',
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  },

  // BP04-018 薇拉·灼惘 (4费)
  {
    cardNumber: 'BP04-018',
    name: '薇拉·灼惘',
    entry: {
      steps: [
        {
          op: 'IF',
          condition: { kind: 'DAMAGE_TAKEN_THIS_TURN', side: 'SELF', op: '>=', value: 2 },
          then: [
            {
              op: 'CHOOSE_ZONE_CARDS',
              side: 'SELF',
              zone: 'HAND',
              prompt: '【薇拉·灼惘】【出】选择我方手牌 1 张费用为 3 及以下的《薇拉·灼惘》出场：',
              filter: { cardType: CardType.ROLE, exactName: '薇拉·灼惘', maxCost: 3 },
              requireEmptySlot: true,
              min: 1,
              max: 1,
              saveToVar: 'picked',
              choiceEffectType: 'DSL_BP04_018_DEPLOY',
            },
            {
              op: 'MOVE_CARDS',
              target: { kind: 'VAR', varName: 'picked' },
              toZone: 'BATTLEFIELD',
              triggerEntry: true,
            },
          ],
        },
      ],
    },
  },

  // BP04-019 薇拉·灼惘 (3费)
  {
    cardNumber: 'BP04-019',
    name: '薇拉·灼惘',
    vanillaEntry: true,
    triggers: [
      {
        abilityId: 'dsl:BP04-019:attack_dp_boost',
        eventType: 'ATTACK_DECLARED',
        matcher: { kind: 'SELF_ATTACKING' },
        condition: {
          kind: 'ALL_ZONE_CARDS_MATCH',
          side: 'SELF',
          zone: 'COST',
          preFilter: { isFaceUp: true, cardType: CardType.ROLE },
          matchFilter: { attribute: ElementAttribute.FIRE },
        },
        label: '【薇拉·灼惘】【自】攻击时若明费角色均为火属性，可自伤 1 点使本回合 DP+1',
        steps: [
          {
            op: 'CONFIRM_YES_NO',
            prompt: '【薇拉·灼惘】【自】是否给予我方 1 点伤害，使该牌直到回合结束 DP+1？',
            yesLabel: '给予 1 点伤害',
            noLabel: '不执行',
            choiceEffectType: 'DSL_BP04_019_DAMAGE',
            onYes: [
              { op: 'DEAL_DAMAGE', side: 'SELF', amount: 1 },
              {
                op: 'IF',
                condition: { kind: 'EROSION_COMPARE', side: 'SELF', op: '<', value: 7 },
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

  // BP04-020 薇拉·灼惘 (3费 特殊【充能自】已内置于 card-effects.ts)
  {
    cardNumber: 'BP04-020',
    name: '薇拉·灼惘',
    vanillaEntry: true,
    isSignalOrbCard: true,
  },

  // BP04-021 薇拉·灼惘 (2费 特殊【充能自】已内置于 card-effects.ts)
  {
    cardNumber: 'BP04-021',
    name: '薇拉·灼惘',
    vanillaEntry: true,
    isSignalOrbCard: true,
  },

  // BP04-022 破曙疾行 (2费 战术)
  {
    cardNumber: 'BP04-022',
    name: '破曙疾行',
    playPrecondition: {
      condition: { kind: 'HAS_ROLE', side: 'SELF', filter: { exactName: '薇拉·灼惘' } },
      errorMessage: '该牌只能在我方战场存在《薇拉·灼惘》时才能使用',
    },
    tactics: [
      {
        op: 'CONFIRM_YES_NO',
        prompt: '【破曙疾行】是否给予我方 1 点伤害？',
        yesLabel: '给予 1 点伤害',
        noLabel: '不执行',
        choiceEffectType: 'DSL_BP04_022_DAMAGE',
        onYes: [{ op: 'DEAL_DAMAGE', side: 'SELF', amount: 1 }],
      },
      {
        op: 'IF',
        condition: {
          kind: 'ALL',
          conditions: [
            { kind: 'EROSION_COMPARE', side: 'SELF', op: '<', value: 7 },
            { kind: 'DAMAGE_TAKEN_THIS_TURN', side: 'SELF', op: '>=', value: 1 },
            { kind: 'EROSION_COMPARE', side: 'SELF', op: '>=', value: 5 },
            {
              kind: 'ZONE_COUNT',
              side: 'SELF',
              zone: 'COST',
              filter: { isFaceUp: false },
              op: '>=',
              value: 1,
            },
          ],
        },
        then: [
          {
            op: 'CHOOSE_ZONE_CARDS',
            side: 'SELF',
            zone: 'COST',
            prompt: '【破曙疾行】可将我方费用区 1 张暗费放置到墓地使侵蚀计数-1（不选则跳过）：',
            filter: { isFaceUp: false },
            min: 0,
            max: 1,
            saveToVar: 'hiddenCost',
            choiceEffectType: 'DSL_BP04_022_HIDDEN',
          },
          {
            op: 'MOVE_CARDS',
            target: { kind: 'VAR', varName: 'hiddenCost' },
            toZone: 'GRAVEYARD',
            isFaceUp: true,
            saveMovedToVar: 'moved',
          },
          {
            op: 'IF',
            condition: { kind: 'VAR_NON_EMPTY', varName: 'moved' },
            then: [{ op: 'CHANGE_EROSION', side: 'SELF', delta: -1 }],
          },
        ],
      },
      {
        op: 'IF',
        condition: {
          kind: 'ALL',
          conditions: [
            { kind: 'EROSION_COMPARE', side: 'SELF', op: '<', value: 7 },
            { kind: 'DAMAGE_TAKEN_THIS_TURN', side: 'SELF', op: '>=', value: 2 },
          ],
        },
        then: [
          {
            op: 'CHOOSE_ROLES',
            side: 'OPPONENT',
            prompt: '【破曙疾行】选择对方战场 1 张横置状态的费用为 6 及以下的角色，将其破坏：',
            filter: { isReady: false, maxCost: 6 },
            min: 1,
            max: 1,
            saveToVar: 'oppTarget',
            choiceEffectType: 'DSL_BP04_022_DESTROY',
          },
          { op: 'DESTROY_ROLES', target: { kind: 'VAR', varName: 'oppTarget' } },
        ],
      },
    ],
  },

  // ==================== 3. 渡边·尘铭体系 (BP04-023 ~ BP04-033) ====================

  // BP04-023 渡边·尘铭 (5费 协战)
  {
    cardNumber: 'BP04-023',
    name: '渡边·尘铭',
    vanillaEntry: true,
    triggers: [
      {
        abilityId: 'dsl:BP04-023:assist_attack_end_destroy',
        eventType: 'ATTACK_ENDED',
        matcher: { kind: 'SELF_ATTACK_END' },
        condition: {
          kind: 'ALL',
          conditions: [
            { kind: 'SELF_MATCHES_FILTER', filter: { hasPartner: true } },
            {
              kind: 'ZONE_COUNT',
              side: 'OPPONENT',
              zone: 'COST',
              filter: { isFaceUp: true },
              op: '>=',
              value: 5,
            },
          ],
        },
        label: '【渡边·尘铭】【协战自】攻击结束时可消红球破坏对方 PP<=4000 角色（消《炽能球》改为不大于自身PP）',
        cost: {
          kind: 'ELIMINATE_ORBS',
          filter: 'RED',
          count: 1,
          optional: true,
          savePaidToVar: 'paidOrb',
          prompt: '【渡边·尘铭】【协战自】是否消除【红色信号球】1 张？（消除《炽能球》可破坏 PP 不大于该牌的角色）',
          choiceEffectType: 'DSL_BP04_023_ORB_COST',
        },
        steps: [
          {
            op: 'IF',
            condition: {
              kind: 'VAR_HAS_CARD_MATCHING',
              varName: 'paidOrb',
              filter: { exactName: '炽能球' },
            },
            then: [
              {
                op: 'CHOOSE_ROLES',
                side: 'OPPONENT',
                prompt: '【渡边·尘铭】消除《炽能球》！选择对方战场 1 张 PP 不大于该牌的角色，将其破坏：',
                filter: { maxEffectivePPSourceSelf: true },
                min: 1,
                max: 1,
                saveToVar: 'oppTarget',
                choiceEffectType: 'DSL_BP04_023_DESTROY_SELF_PP',
              },
              { op: 'DESTROY_ROLES', target: { kind: 'VAR', varName: 'oppTarget' } },
            ],
            else: [
              {
                op: 'CHOOSE_ROLES',
                side: 'OPPONENT',
                prompt: '【渡边·尘铭】选择对方战场 1 张 PP 为 4000 及以下的角色，将其破坏：',
                filter: { maxEffectivePP: 4000 },
                min: 1,
                max: 1,
                saveToVar: 'oppTarget',
                choiceEffectType: 'DSL_BP04_023_DESTROY_4000',
              },
              { op: 'DESTROY_ROLES', target: { kind: 'VAR', varName: 'oppTarget' } },
            ],
          },
        ],
      },
    ],
  },

  // BP04-024 渡边·尘铭 (4费 协战)
  {
    cardNumber: 'BP04-024',
    name: '渡边·尘铭',
    vanillaEntry: true,
    triggers: [
      {
        abilityId: 'dsl:BP04-024:assist_attack_end_partner_move',
        eventType: 'ATTACK_ENDED',
        matcher: { kind: 'SELF_ATTACK_END' },
        condition: { kind: 'SELF_MATCHES_FILTER', filter: { hasPartner: true } },
        label: '【渡边·尘铭】【协战自】攻击结束时可消任意1球将搭档回手（消《炽能球》改为出场）',
        cost: {
          kind: 'ELIMINATE_ORBS',
          filter: 'ANY',
          count: 1,
          optional: true,
          savePaidToVar: 'paidOrb',
          prompt: '【渡边·尘铭】【协战自】是否消除【任意信号球】1 张？（将搭档回手，消除《炽能球》改为出场）',
          choiceEffectType: 'DSL_BP04_024_ORB_COST',
        },
        steps: [
          {
            op: 'IF',
            condition: {
              kind: 'VAR_HAS_CARD_MATCHING',
              varName: 'paidOrb',
              filter: { exactName: '炽能球' },
            },
            then: [
              {
                op: 'DETACH_AND_MOVE_PARTNER',
                host: { kind: 'SELF' },
                toZone: 'BATTLEFIELD',
                triggerEntry: true,
              },
            ],
            else: [
              {
                op: 'DETACH_AND_MOVE_PARTNER',
                host: { kind: 'SELF' },
                toZone: 'HAND',
              },
            ],
          },
        ],
      },
    ],
  },

  // BP04-025 渡边·尘铭 (3费 协战；墓地协战已内置于 engine.ts)
  {
    cardNumber: 'BP04-025',
    name: '渡边·尘铭',
    vanillaEntry: true,
  },

  // BP04-026 渡边·尘铭 (3费 充能0)
  {
    cardNumber: 'BP04-026',
    name: '渡边·尘铭',
    vanillaEntry: true,
    triggers: [
      {
        abilityId: 'dsl:BP04-026:attack_end_sac_rush',
        eventType: 'ATTACK_ENDED',
        oncePerTurnByPlayer: true,
        matcher: { kind: 'SELF_ATTACK_END' },
        label: '【渡边·尘铭】【自】攻击结束时可将自身破坏使1张费用<=5<遗忘者>获得【速攻】',
        steps: [
          {
            op: 'CONFIRM_YES_NO',
            prompt: '【渡边·尘铭】【自】是否将该牌破坏，使我方战场 1 张费用<=5的<遗忘者>角色获得【速攻】？',
            yesLabel: '破坏自身',
            noLabel: '不破坏',
            choiceEffectType: 'DSL_BP04_026_CONFIRM',
            onYes: [
              { op: 'DESTROY_ROLES', target: { kind: 'SELF' }, saveDestroyedToVar: 'destroyedSelf' },
              {
                op: 'IF',
                condition: { kind: 'VAR_NON_EMPTY', varName: 'destroyedSelf' },
                then: [
                  {
                    op: 'CHOOSE_ROLES',
                    side: 'SELF',
                    prompt: '【渡边·尘铭】选择我方战场 1 张费用为 5 及以下的<遗忘者>角色获得【速攻】：',
                    filter: { trait: '遗忘者', maxCost: 5 },
                    min: 1,
                    max: 1,
                    saveToVar: 'target',
                    choiceEffectType: 'DSL_BP04_026_RUSH',
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
        ],
      },
    ],
  },

  // BP04-027 渡边·尘铭 (3费)
  // 受限点：当前 DeclarativeTriggerMatcher 尚无 GRANTED_SELF_ATTACK_END / GRANTED_SELF_TURN_END，
  // 暂用 MARK_TURN_ABILITY_USED + NOT(TURN_ABILITY_UNUSED) 在本牌自身触发器上控制发动；若后续需受 CANNOT_GAIN_ABILITIES 限制需补齐动态赋予触发器。
  {
    cardNumber: 'BP04-027',
    name: '渡边·尘铭',
    vanillaEntry: true,
    activate: {
      oncePerTurn: true,
      steps: [
        { op: 'MARK_TURN_ABILITY_USED', abilityKey: 'BP04_027_SELF_DESTRUCT_ARMED' },
        {
          op: 'MODIFY_STATS',
          target: { kind: 'SELF' },
          charge: 1,
          pp: 1500,
          dp: 1,
          duration: 'END_OF_TURN',
        },
      ],
    },
    triggers: [
      {
        abilityId: 'dsl:BP04-027:granted_attack_end_destroy',
        eventType: 'ATTACK_ENDED',
        matcher: { kind: 'SELF_ATTACK_END' },
        condition: {
          kind: 'NOT',
          condition: { kind: 'TURN_ABILITY_UNUSED', abilityKey: 'BP04_027_SELF_DESTRUCT_ARMED' },
        },
        label: '【渡边·尘铭】【自】攻击结束时将该牌破坏',
        steps: [{ op: 'DESTROY_ROLES', target: { kind: 'SELF' } }],
      },
      {
        abilityId: 'dsl:BP04-027:granted_turn_end_destroy',
        eventType: 'END_PHASE_TRIGGERS',
        matcher: { kind: 'SELF_TURN_END', isSelfTurn: true },
        condition: {
          kind: 'NOT',
          condition: { kind: 'TURN_ABILITY_UNUSED', abilityKey: 'BP04_027_SELF_DESTRUCT_ARMED' },
        },
        label: '【渡边·尘铭】【自】我方回合结束时将该牌破坏',
        steps: [{ op: 'DESTROY_ROLES', target: { kind: 'SELF' } }],
      },
    ],
  },

  // BP04-028 渡边·尘铭 (3费；非战术【瞬时】已内置于 card-effects.ts)
  {
    cardNumber: 'BP04-028',
    name: '渡边·尘铭',
    entry: {
      steps: [
        {
          op: 'CHOOSE_ZONE_CARDS',
          side: 'SELF',
          zone: 'GRAVEYARD',
          prompt: '【渡边·尘铭】【出】选择我方墓地 1 张《炽能球》加入手牌：',
          filter: { exactName: '炽能球' },
          min: 1,
          max: 1,
          saveToVar: 'blazingOrb',
          choiceEffectType: 'DSL_BP04_028_PICK_ORB',
        },
        { op: 'MOVE_CARDS', target: { kind: 'VAR', varName: 'blazingOrb' }, toZone: 'HAND', isFaceUp: true },
      ],
    },
  },

  // BP04-029 巴克豪斯 (3费)
  {
    cardNumber: 'BP04-029',
    name: '巴克豪斯',
    vanillaEntry: true,
    staticEffects: [
      {
        id: 'dsl:BP04-029:base_dp_one',
        scope: 'SELF',
        condition: {
          kind: 'HAS_ROLE',
          side: 'SELF',
          filter: { trait: '遗忘者', excludeSelf: true },
          minCount: 2,
        },
        setBaseDP: 1,
        dependsOnTraits: true,
      },
    ],
    triggers: [
      {
        abilityId: 'dsl:BP04-029:destroyed_tap_opp',
        eventType: 'CARD_DESTROYED',
        matcher: { kind: 'SELF_DESTROYED', destroyReason: 'ANY' },
        condition: {
          kind: 'HAS_ROLE',
          side: 'SELF',
          filter: { trait: '遗忘者', excludeSelf: true },
        },
        label: '【巴克豪斯】【自】被破坏时可消黄球横置对方 PP<=3000 角色',
        cost: {
          kind: 'ELIMINATE_ORBS',
          filter: 'YELLOW',
          count: 1,
          optional: true,
          prompt: '【巴克豪斯】【自】是否消除【黄色信号球】横置对方战场 1 张 PP<=3000 的角色？',
          choiceEffectType: 'DSL_BP04_029_YELLOW_1',
        },
        steps: [
          {
            op: 'CHOOSE_ROLES',
            side: 'OPPONENT',
            prompt: '【巴克豪斯】选择对方战场 1 张 PP 为 3000 及以下的角色，将其横置：',
            filter: { maxEffectivePP: 3000 },
            min: 1,
            max: 1,
            saveToVar: 'oppTarget',
            choiceEffectType: 'DSL_BP04_029_TAP_1',
          },
          { op: 'SET_READY', target: { kind: 'VAR', varName: 'oppTarget' }, isReady: false },
        ],
      },
      {
        abilityId: 'dsl:BP04-029:partner_tap_opp',
        eventType: 'PARTNER_GAINED',
        matcher: { kind: 'SELF_BECAME_PARTNER' },
        condition: {
          kind: 'HAS_ROLE',
          side: 'SELF',
          filter: { trait: '遗忘者', excludeSelf: true },
        },
        label: '【巴克豪斯】【自】成为协战搭档时可消黄球横置对方 PP<=3000 角色',
        cost: {
          kind: 'ELIMINATE_ORBS',
          filter: 'YELLOW',
          count: 1,
          optional: true,
          prompt: '【巴克豪斯】【自】是否消除【黄色信号球】横置对方战场 1 张 PP<=3000 的角色？',
          choiceEffectType: 'DSL_BP04_029_YELLOW_2',
        },
        steps: [
          {
            op: 'CHOOSE_ROLES',
            side: 'OPPONENT',
            prompt: '【巴克豪斯】选择对方战场 1 张 PP 为 3000 及以下的角色，将其横置：',
            filter: { maxEffectivePP: 3000 },
            min: 1,
            max: 1,
            saveToVar: 'oppTarget',
            choiceEffectType: 'DSL_BP04_029_TAP_2',
          },
          { op: 'SET_READY', target: { kind: 'VAR', varName: 'oppTarget' }, isReady: false },
        ],
      },
    ],
  },

  // BP04-030 布鲁斯 (3费)
  // 受限点：PARTNER_GAINED 事件与 SELF_BECAME_PARTNER 尚无 fromZone 区分「战场成为搭档」与「墓地成为搭档」，
  // 当前两项 PARTNER_GAINED 触发均按条件注册，需待共享层补充 fromZone 过滤。
  {
    cardNumber: 'BP04-030',
    name: '布鲁斯',
    vanillaEntry: true,
    triggers: [
      {
        abilityId: 'dsl:BP04-030:destroyed_draw2_discard1',
        eventType: 'CARD_DESTROYED',
        matcher: { kind: 'SELF_DESTROYED', destroyReason: 'ANY' },
        condition: {
          kind: 'HAS_ROLE',
          side: 'SELF',
          filter: { trait: '遗忘者', excludeSelf: true },
        },
        label: '【布鲁斯】【自】被破坏时若战场存在其他<遗忘者>，抽2弃1',
        steps: [
          { op: 'DRAW', count: 2 },
          {
            op: 'CHOOSE_ZONE_CARDS',
            side: 'SELF',
            zone: 'HAND',
            prompt: '【布鲁斯】请选择 1 张手牌丢弃：',
            min: 1,
            max: 1,
            saveToVar: 'disc',
            choiceEffectType: 'DSL_BP04_030_DISCARD_1',
          },
          { op: 'MOVE_CARDS', target: { kind: 'VAR', varName: 'disc' }, toZone: 'GRAVEYARD', isFaceUp: true },
        ],
      },
      {
        abilityId: 'dsl:BP04-030:field_partner_draw2_discard1',
        eventType: 'PARTNER_GAINED',
        matcher: { kind: 'SELF_BECAME_PARTNER' },
        condition: {
          kind: 'HAS_ROLE',
          side: 'SELF',
          filter: { trait: '遗忘者', excludeSelf: true },
        },
        label: '【布鲁斯】【自】战场成为搭档时若战场存在其他<遗忘者>，抽2弃1',
        steps: [
          { op: 'DRAW', count: 2 },
          {
            op: 'CHOOSE_ZONE_CARDS',
            side: 'SELF',
            zone: 'HAND',
            prompt: '【布鲁斯】请选择 1 张手牌丢弃：',
            min: 1,
            max: 1,
            saveToVar: 'disc',
            choiceEffectType: 'DSL_BP04_030_DISCARD_2',
          },
          { op: 'MOVE_CARDS', target: { kind: 'VAR', varName: 'disc' }, toZone: 'GRAVEYARD', isFaceUp: true },
        ],
      },
      {
        abilityId: 'dsl:BP04-030:gy_partner_blue_draw1',
        eventType: 'PARTNER_GAINED',
        matcher: { kind: 'SELF_BECAME_PARTNER' },
        label: '【布鲁斯】【协战自】墓地成为搭档时可消蓝球抽1张牌',
        cost: {
          kind: 'ELIMINATE_ORBS',
          filter: 'BLUE',
          count: 1,
          optional: true,
          prompt: '【布鲁斯】【协战自】是否消除【蓝色信号球】抽 1 张牌？',
          choiceEffectType: 'DSL_BP04_030_BLUE_ORB',
        },
        steps: [{ op: 'DRAW', count: 1 }],
      },
    ],
  },

  // BP04-031 渡边·尘铭 (2费)
  {
    cardNumber: 'BP04-031',
    name: '渡边·尘铭',
    entry: {
      steps: [
        { op: 'REVEAL_TOP', count: 3, saveToVar: 'revealed' },
        {
          op: 'CHOOSE_FROM_VAR',
          varName: 'revealed',
          prompt: '【渡边·尘铭】【出】选择其中最多 1 张<遗忘者>角色或《炽能球》加入手牌（其余放牌组底）：',
          filter: {
            anyFilters: [
              { cardType: CardType.ROLE, trait: '遗忘者' },
              { exactName: '炽能球' },
            ],
          },
          alwaysShow: true,
          min: 0,
          max: 1,
          saveToVar: 'kept',
          choiceEffectType: 'DSL_BP04_031_PICK',
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

  // BP04-032 炽能球 (2费 瞬时战术；信号球区有《渡边·尘铭》视为红球已内置于 continuous-effects.ts static:BP04-032)
  {
    cardNumber: 'BP04-032',
    name: '炽能球',
    tactics: [
      {
        op: 'CHOOSE_ZONE_CARDS',
        side: 'SELF',
        zone: 'HAND',
        prompt: '【炽能球】【瞬时】选择我方手牌 1 张费用为 3 及以下的<遗忘者>角色出场：',
        filter: { cardType: CardType.ROLE, trait: '遗忘者', maxCost: 3 },
        requireEmptySlot: true,
        min: 1,
        max: 1,
        saveToVar: 'forgotten',
        choiceEffectType: 'DSL_BP04_032_DEPLOY',
      },
      {
        op: 'MOVE_CARDS',
        target: { kind: 'VAR', varName: 'forgotten' },
        toZone: 'BATTLEFIELD',
        triggerEntry: true,
      },
      {
        op: 'MOVE_CARDS',
        target: { kind: 'SELF' },
        toZone: 'SIGNAL_ORB',
        isFaceUp: true,
      },
    ],
  },

  // BP04-033 葬火于碑 (3费 战术)
  {
    cardNumber: 'BP04-033',
    name: '葬火于碑',
    tactics: [
      {
        op: 'CHOOSE_ROLES',
        side: 'SELF',
        prompt: '【葬火于碑】可将我方战场 1 张<遗忘者>角色破坏（不选则跳过）：',
        filter: { trait: '遗忘者' },
        min: 0,
        max: 1,
        saveToVar: 'sacRole',
        choiceEffectType: 'DSL_BP04_033_SAC',
      },
      {
        op: 'IF',
        condition: { kind: 'VAR_NON_EMPTY', varName: 'sacRole' },
        then: [
          { op: 'DESTROY_ROLES', target: { kind: 'VAR', varName: 'sacRole' }, saveDestroyedToVar: 'destroyedSelf' },
          {
            op: 'IF',
            condition: { kind: 'VAR_NON_EMPTY', varName: 'destroyedSelf' },
            then: [
              {
                op: 'CHOOSE_ROLES',
                side: 'OPPONENT',
                prompt: '【葬火于碑】选择对方战场 1 张 PP 为 8000 及以下的角色，将其破坏：',
                filter: { maxEffectivePP: 8000 },
                min: 1,
                max: 1,
                saveToVar: 'oppTarget',
                choiceEffectType: 'DSL_BP04_033_DESTROY',
              },
              { op: 'DESTROY_ROLES', target: { kind: 'VAR', varName: 'oppTarget' } },
            ],
          },
        ],
      },
    ],
  },

  // ==================== 4. 卡列尼娜·辉晓 & 布偶熊·觅语体系 (BP04-034 ~ BP04-044) ====================

  // BP04-034 卡列尼娜· 辉晓 (7费 协战)
  // 受限点：
  // 1. PARTNER_GAINED 缺少 fromZone，无法判定「若该牌从墓地选择协战搭档」以追加使对方 1 张角色 PP-2000；
  // 2. official-cards-data.ts 卡名含半角空格 "卡列尼娜· 辉晓"，shared hasCardName('卡列尼娜·辉晓') 需规范化空格后才可累计消球计数。
  {
    cardNumber: 'BP04-034',
    name: '卡列尼娜· 辉晓',
    vanillaEntry: true,
    staticEffects: [
      {
        id: 'dsl:BP04-034:dark_eng_rush',
        scope: 'SELF',
        condition: {
          kind: 'ALL_ROLES_MATCH',
          side: 'SELF',
          filter: { attribute: ElementAttribute.DARK, trait: '工程部队' },
          requireAtLeastOne: true,
        },
        keywords: ['速攻'],
        dependsOnTraits: true,
      },
    ],
    triggers: [
      {
        abilityId: 'dsl:BP04-034:assist_elim3_debuff',
        eventType: 'PARTNER_GAINED',
        oncePerTurn: true,
        deferOncePerTurnUntilCostPaid: true,
        matcher: { kind: 'SELF_GAINED_PARTNER' },
        condition: { kind: 'TURN_OWNER', isSelfTurn: true },
        label: '【卡列尼娜·辉晓】【协战自】【回合1】可消【3任意信号球】使对方全员 PP-3000',
        steps: [
          {
            op: 'ELIMINATE_ORB_COST',
            filter: 'ANY',
            count: 3,
            optional: true,
            prompt: '【卡列尼娜·辉晓】【协战自】是否消除【3任意信号球】，使对方战场所有角色 PP-3000？',
            choiceEffectType: 'DSL_BP04_034_ORB_COST',
            onPaid: [
              { op: 'MARK_TURN_ABILITY_USED', abilityKey: '__TRIGGER_ONCE_KEY__' },
              {
                op: 'MODIFY_STATS',
                target: { kind: 'ALL_MATCHING_ROLES', side: 'OPPONENT' },
                pp: -3000,
                duration: 'END_OF_TURN',
              },
            ],
          },
        ],
      },
    ],
  },

  // BP04-035 卡列尼娜· 辉晓 (4费 协战)
  // 受限点：
  // 1. REGISTER_DELAYED_TRIGGER 缺少 'DELAYED_ATTACK_END_DEPLOY_PARTNER'，无法在任意角色攻击结束时将搭档出场；
  // 2. PARTNER_GAINED 缺少 fromZone，无法判定「从墓地选择协战搭档」以赋予【速攻】。
  {
    cardNumber: 'BP04-035',
    name: '卡列尼娜· 辉晓',
    vanillaEntry: true,
    staticEffects: [
      {
        id: 'dsl:BP04-035:teddy_assault',
        scope: 'SELF',
        condition: { kind: 'HAS_ROLE', side: 'SELF', filter: { exactName: '布偶熊·觅语' } },
        keywords: ['突进'],
      },
    ],
    triggers: [
      {
        abilityId: 'dsl:BP04-035:assist_elim3_deploy_partner',
        eventType: 'PARTNER_GAINED',
        oncePerTurn: true,
        deferOncePerTurnUntilCostPaid: true,
        matcher: { kind: 'SELF_GAINED_PARTNER' },
        condition: { kind: 'CURRENT_COMBAT_EXISTS' },
        label: '【卡列尼娜·辉晓】【协战自】【回合1】可消【3任意信号球】于该次攻击结束时将搭档出场',
        steps: [
          {
            op: 'ELIMINATE_ORB_COST',
            filter: 'ANY',
            count: 3,
            optional: true,
            prompt: '【卡列尼娜·辉晓】【协战自】是否消除【3任意信号球】？（于那次攻击结束时将搭档出场；待共享层补齐时限出场原语）',
            choiceEffectType: 'DSL_BP04_035_ORB_COST',
            onPaid: [{ op: 'MARK_TURN_ABILITY_USED', abilityKey: '__TRIGGER_ONCE_KEY__' }],
          },
        ],
      },
    ],
  },

  // BP04-036 布偶熊·觅语 (4费)
  {
    cardNumber: 'BP04-036',
    name: '布偶熊·觅语',
    vanillaEntry: true,
    triggers: [
      {
        abilityId: 'dsl:BP04-036:attack_discard_karenina_charge',
        eventType: 'ATTACK_DECLARED',
        matcher: { kind: 'SELF_ATTACKING' },
        label: '【布偶熊·觅语】【自】攻击时可弃 1 张《卡列尼娜·辉晓》获得【充能+1】',
        cost: {
          kind: 'DISCARD_HAND',
          count: 1,
          optional: true,
          filter: KARENINA_NAME_FILTER,
          prompt: '【布偶熊·觅语】【自】是否丢弃手牌 1 张《卡列尼娜·辉晓》使该牌获得【充能+1】？',
          choiceEffectType: 'DSL_BP04_036_DISCARD',
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
      {
        abilityId: 'dsl:BP04-036:partner_blue_orb_triple',
        eventType: 'PARTNER_GAINED',
        oncePerTurnByPlayer: true,
        matcher: { kind: 'SELF_BECAME_PARTNER' },
        label: '【布偶熊·觅语】【协战自】成为协战搭档时使 1 张【蓝色信号球】本回合视为 3 个',
        steps: [
          {
            op: 'CHOOSE_ZONE_CARDS',
            side: 'SELF',
            zone: 'SIGNAL_ORB',
            prompt: '【布偶熊·觅语】【协战自】选择我方信号球区最多 1 张【蓝色信号球】视为 3 个同色信号球：',
            filter: { signalOrbColor: 'BLUE' },
            min: 0,
            max: 1,
            saveToVar: 'blueOrb',
            choiceEffectType: 'DSL_BP04_036_ORB_TRIPLE',
          },
          {
            op: 'MODIFY_STATS',
            target: { kind: 'VAR', varName: 'blueOrb' },
            orbValue: 3,
            duration: 'END_OF_TURN',
          },
        ],
      },
    ],
  },

  // BP04-037 布偶熊·觅语 (4费)
  {
    cardNumber: 'BP04-037',
    name: '布偶熊·觅语',
    entry: {
      cost: {
        kind: 'DISCARD_HAND',
        count: 1,
        optional: true,
        filter: { trait: '工程部队' },
        prompt: '【布偶熊·觅语】【出】是否丢弃手牌 1 张<工程部队>：从牌组或墓地选 1 张【蓝色信号球】放信号球区最上方？',
        choiceEffectType: 'DSL_BP04_037_DISCARD',
      },
      steps: [
        {
          op: 'CHOOSE_ZONE_CARDS',
          side: 'SELF',
          zone: 'DECK',
          zones: ['DECK', 'GRAVEYARD'],
          prompt: '【布偶熊·觅语】【出】选择我方牌组或墓地 1 张【蓝色信号球】放置到信号球区最上方：',
          filter: { signalOrbColor: 'BLUE' },
          min: 1,
          max: 1,
          saveToVar: 'blueOrb',
          choiceEffectType: 'DSL_BP04_037_PICK_ORB',
        },
        {
          op: 'IF',
          condition: {
            kind: 'VAR_HAS_CARD_MATCHING',
            varName: 'blueOrb',
            filter: { inZone: 'DECK' },
          },
          then: [
            { op: 'MOVE_CARDS', target: { kind: 'VAR', varName: 'blueOrb' }, toZone: 'SIGNAL_ORB', isFaceUp: true },
            { op: 'SHUFFLE_DECK', side: 'SELF' },
          ],
          else: [
            { op: 'MOVE_CARDS', target: { kind: 'VAR', varName: 'blueOrb' }, toZone: 'SIGNAL_ORB', isFaceUp: true },
          ],
        },
      ],
    },
    triggers: [
      {
        abilityId: 'dsl:BP04-037:attack_blue_orb_triple',
        eventType: 'ATTACK_DECLARED',
        matcher: { kind: 'SELF_ATTACKING' },
        label: '【布偶熊·觅语】【自】攻击时使 1 张【蓝色信号球】本回合视为 3 个',
        steps: [
          {
            op: 'CHOOSE_ZONE_CARDS',
            side: 'SELF',
            zone: 'SIGNAL_ORB',
            prompt: '【布偶熊·觅语】【自】选择我方信号球区最多 1 张【蓝色信号球】视为 3 个同色信号球：',
            filter: { signalOrbColor: 'BLUE' },
            min: 0,
            max: 1,
            saveToVar: 'blueOrb',
            choiceEffectType: 'DSL_BP04_037_ORB_TRIPLE',
          },
          {
            op: 'MODIFY_STATS',
            target: { kind: 'VAR', varName: 'blueOrb' },
            orbValue: 3,
            duration: 'END_OF_TURN',
          },
        ],
      },
    ],
  },

  // BP04-038 布偶熊·觅语 (4费；【协战永】不解除协战状态已内置于 battlefield-manager.ts)
  {
    cardNumber: 'BP04-038',
    name: '布偶熊·觅语',
    vanillaEntry: true,
    triggers: [
      {
        abilityId: 'dsl:BP04-038:redirect_attack_to_karenina',
        eventType: 'PARTNER_GAINED',
        matcher: { kind: 'SELF_BECAME_PARTNER', requiredHostName: '卡列尼娜· 辉晓' },
        condition: {
          kind: 'ALL',
          conditions: [
            { kind: 'CURRENT_COMBAT_EXISTS' },
            { kind: 'TURN_OWNER', isSelfTurn: false },
          ],
        },
        label: '【布偶熊·觅语】【协战自】可将对方攻击中的角色攻击对象变为《卡列尼娜·辉晓》',
        steps: [
          {
            op: 'CONFIRM_YES_NO',
            prompt: '【布偶熊·觅语】【协战自】是否将本次攻击的对象变更为那张《卡列尼娜·辉晓》？',
            yesLabel: '变更攻击对象',
            noLabel: '不变更',
            choiceEffectType: 'DSL_BP04_038_REDIRECT',
            onYes: [{ op: 'REDIRECT_ATTACK', targetType: 'CHARACTER', target: { kind: 'TRIGGER_HOST' } }],
          },
        ],
      },
    ],
  },

  // BP04-039 卡列尼娜· 辉晓 (3费 协战)
  {
    cardNumber: 'BP04-039',
    name: '卡列尼娜· 辉晓',
    entry: {
      steps: [
        {
          op: 'DISCARD_COST_STEP',
          count: 2,
          optional: true,
          filter: { trait: '工程部队' },
          savePaidToVar: 'paidCards',
          prompt: '【卡列尼娜·辉晓】【出】是否丢弃手牌 2 张<工程部队>抽 2 张（弃到《布偶熊·觅语》改为抽 3 张）？',
          choiceEffectType: 'DSL_BP04_039_DISCARD',
          onPaid: [
            {
              op: 'IF',
              condition: {
                kind: 'VAR_HAS_CARD_MATCHING',
                varName: 'paidCards',
                filter: { exactName: '布偶熊·觅语' },
              },
              then: [{ op: 'DRAW', count: 3 }],
              else: [{ op: 'DRAW', count: 2 }],
            },
          ],
        },
      ],
    },
  },

  // BP04-040 卡列尼娜· 辉晓 (5费)
  // 注：规则注明「因该能力的代价消除信号球不视为因能力消除信号球」，当前 ELIMINATE_ORB_COST 未配置跳过计数标志（暂受半角空格未累加影响等价）。
  {
    cardNumber: 'BP04-040',
    name: '卡列尼娜· 辉晓',
    entry: {
      steps: [
        (() => {
          const reviveSteps: EffectStep[] = [
            {
              op: 'CHOOSE_ZONE_CARDS',
              side: 'SELF',
              zone: 'GRAVEYARD',
              prompt: '【卡列尼娜·辉晓】【出】选择我方墓地 1 张费用为 4 及以下的<工程部队>角色出场：',
              filter: { cardType: CardType.ROLE, trait: '工程部队', maxCost: 4 },
              requireEmptySlot: true,
              min: 1,
              max: 1,
              saveToVar: 'revived',
              choiceEffectType: 'DSL_BP04_040_REVIVE',
            },
            {
              op: 'MOVE_CARDS',
              target: { kind: 'VAR', varName: 'revived' },
              toZone: 'BATTLEFIELD',
              triggerEntry: true,
            },
          ];
          const payDiscard: EffectStep = {
            op: 'DISCARD_COST_STEP',
            count: 2,
            optional: true,
            prompt: '【卡列尼娜·辉晓】【出】是否丢弃 2 张手牌，从墓地出场 1 张费用<=4的<工程部队>角色？',
            choiceEffectType: 'DSL_BP04_040_DISCARD',
            onPaid: reviveSteps,
          };
          const payOrbs: EffectStep = {
            op: 'ELIMINATE_ORB_COST',
            filter: 'ANY',
            count: 3,
            optional: true,
            prompt: '【卡列尼娜·辉晓】【出】是否消除【3任意信号球】，从墓地出场 1 张费用<=4的<工程部队>角色？',
            choiceEffectType: 'DSL_BP04_040_ORB',
            onPaid: reviveSteps,
          };
          return {
            op: 'IF',
            condition: {
              kind: 'ALL',
              conditions: [
                { kind: 'ZONE_COUNT', side: 'SELF', zone: 'HAND', op: '>=', value: 2 },
                { kind: 'ZONE_COUNT', side: 'SELF', zone: 'SIGNAL_ORB', filter: { isSignalOrb: true }, op: '>=', value: 3 },
              ],
            },
            then: [
              {
                op: 'CHOOSE_MODE',
                prompt: '【卡列尼娜·辉晓】【出】选择支付的代价（可不支付）：',
                choiceEffectType: 'DSL_BP04_040_COST_MODE',
                modes: [
                  {
                    id: 'discard2',
                    label: '丢弃 2 张手牌',
                    steps: [
                      {
                        op: 'DISCARD_COST_STEP',
                        count: 2,
                        optional: false,
                        prompt: '【卡列尼娜·辉晓】请选择 2 张手牌丢弃：',
                        choiceEffectType: 'DSL_BP04_040_DISCARD_FORCED',
                        onPaid: reviveSteps,
                      },
                    ],
                  },
                  {
                    id: 'orbs3',
                    label: '消除【3任意信号球】',
                    steps: [
                      {
                        op: 'ELIMINATE_ORB_COST',
                        filter: 'ANY',
                        count: 3,
                        optional: false,
                        prompt: '【卡列尼娜·辉晓】请选择消除【3任意信号球】：',
                        choiceEffectType: 'DSL_BP04_040_ORB_FORCED',
                        onPaid: reviveSteps,
                      },
                    ],
                  },
                  { id: 'skip', label: '不支付代价', steps: [] },
                ],
              },
            ],
            else: [
              {
                op: 'IF',
                condition: { kind: 'ZONE_COUNT', side: 'SELF', zone: 'HAND', op: '>=', value: 2 },
                then: [payDiscard],
                else: [payOrbs],
              },
            ],
          };
        })(),
      ],
    },
  },

  // BP04-041 卡列尼娜· 辉晓 (3费)
  {
    cardNumber: 'BP04-041',
    name: '卡列尼娜· 辉晓',
    vanillaEntry: true,
    staticEffects: [
      {
        id: 'dsl:BP04-041:dp_plus1',
        scope: 'SELF',
        condition: { kind: 'ELIMINATED_ORBS_BY_KARENINA_THIS_TURN', op: '>=', value: 1 },
        dp: 1,
      },
      {
        id: 'dsl:BP04-041:charge_plus1',
        scope: 'SELF',
        condition: { kind: 'ELIMINATED_ORBS_BY_KARENINA_THIS_TURN', op: '>=', value: 2 },
        charge: 1,
      },
    ],
  },

  // BP04-042 布偶熊·觅语 (2费)
  {
    cardNumber: 'BP04-042',
    name: '布偶熊·觅语',
    vanillaEntry: true,
    triggers: [
      {
        abilityId: 'dsl:BP04-042:destroyed_recover_blue_orbs',
        eventType: 'CARD_DESTROYED',
        matcher: { kind: 'SELF_DESTROYED', destroyReason: 'ANY' },
        label: '【布偶熊·觅语】【自】被破坏时可弃 1 张<工程部队>，从墓地回收最多 2 张<信号球·蓝>',
        cost: {
          kind: 'DISCARD_HAND',
          count: 1,
          optional: true,
          filter: { trait: '工程部队' },
          prompt: '【布偶熊·觅语】【自】是否丢弃手牌 1 张<工程部队>回收墓地最多 2 张<信号球·蓝>？',
          choiceEffectType: 'DSL_BP04_042_DISCARD',
        },
        steps: [
          {
            op: 'CHOOSE_ZONE_CARDS',
            side: 'SELF',
            zone: 'GRAVEYARD',
            prompt: '【布偶熊·觅语】选择我方墓地最多 2 张<信号球·蓝>，按顺序放置到我方信号球区最上方：',
            filter: { trait: '信号球·蓝' },
            min: 0,
            max: 2,
            saveToVar: 'blueOrbs',
            choiceEffectType: 'DSL_BP04_042_PICK_ORBS',
          },
          { op: 'MOVE_CARDS', target: { kind: 'VAR', varName: 'blueOrbs' }, toZone: 'SIGNAL_ORB', isFaceUp: true },
        ],
      },
    ],
  },

  // BP04-043 重力过载 (3费 战术)
  {
    cardNumber: 'BP04-043',
    name: '重力过载',
    playPrecondition: {
      condition: { kind: 'HAS_ROLE', side: 'SELF', filter: KARENINA_NAME_FILTER },
      errorMessage: '该牌只能在我方战场存在《卡列尼娜· 辉晓》时才能使用',
    },
    tactics: [
      {
        op: 'CHOOSE_ROLES',
        side: 'OPPONENT',
        prompt: '【重力过载】选择对方战场 1 张角色使其 PP 降低：',
        min: 1,
        max: 1,
        saveToVar: 'oppTarget',
        choiceEffectType: 'DSL_BP04_043_DEBUFF',
      },
      {
        op: 'IF',
        condition: { kind: 'ELIMINATED_ORBS_BY_KARENINA_THIS_TURN', op: '>=', value: 1 },
        then: [
          {
            op: 'MODIFY_STATS',
            target: { kind: 'VAR', varName: 'oppTarget' },
            pp: -7000,
            duration: 'END_OF_TURN',
          },
        ],
        else: [
          {
            op: 'MODIFY_STATS',
            target: { kind: 'VAR', varName: 'oppTarget' },
            pp: -3500,
            duration: 'END_OF_TURN',
          },
        ],
      },
    ],
  },

  // BP04-044 开端 (2费 瞬时战术)
  // 受限点：trigger-system.ts DELAYED_END_OF_TURN_TO_GRAVEYARD 尚未跳过 partnerOfCardId 处于协战状态的搭档卡牌。
  {
    cardNumber: 'BP04-044',
    name: '开端',
    tactics: [
      {
        op: 'IF',
        condition: {
          kind: 'ALL_ROLES_MATCH',
          side: 'SELF',
          filter: { trait: '工程部队' },
          requireAtLeastOne: true,
        },
        then: [
          {
            op: 'CHOOSE_ZONE_CARDS',
            side: 'SELF',
            zone: 'GRAVEYARD',
            prompt: '【开端】【瞬时】选择我方墓地 1 张费用为 4 及以下的《布偶熊·觅语》以横置状态出场：',
            filter: { cardType: CardType.ROLE, exactName: '布偶熊·觅语', maxCost: 4 },
            requireEmptySlot: true,
            min: 1,
            max: 1,
            saveToVar: 'teddy',
            choiceEffectType: 'DSL_BP04_044_REVIVE',
          },
          {
            op: 'MOVE_CARDS',
            target: { kind: 'VAR', varName: 'teddy' },
            toZone: 'BATTLEFIELD',
            enterTapped: true,
            triggerEntry: true,
            saveMovedToVar: 'deployed',
          },
          {
            op: 'REGISTER_DELAYED_TRIGGER',
            target: { kind: 'VAR', varName: 'deployed' },
            eventType: 'END_PHASE_TRIGGERS',
            turnOffset: 0,
            abilityId: 'DELAYED_END_OF_TURN_TO_GRAVEYARD',
            expectedZone: 'BATTLEFIELD',
            markLegacyEndOfTurnToGraveyard: true,
            labelSuffix: '该回合结束时从战场放置到墓地 (BP04-044)',
          },
        ],
      },
    ],
  },

  // ==================== 5. 亚里莎·回音 & 塞西莉体系 (BP04-045 ~ BP04-049) ====================

  // BP04-045 理想的彼岸 亚里莎·回音 (7费 协战)
  {
    cardNumber: 'BP04-045',
    name: '理想的彼岸 亚里莎·回音',
    staticEffects: [
      {
        id: 'dsl:BP04-045:assist_rush',
        scope: 'SELF',
        selfFilter: { hasPartner: true },
        keywords: ['速攻'],
      },
    ],
    entry: {
      cost: {
        kind: 'DISCARD_HAND',
        count: 1,
        optional: true,
        filter: { attribute: ElementAttribute.PHYSICAL },
        prompt: '【理想的彼岸 亚里莎·回音】【出】是否丢弃手牌 1 张物理属性的牌：使手牌 1 张<塞西莉>出场或成为协战搭档？',
        choiceEffectType: 'DSL_BP04_045_DISCARD',
      },
      steps: [
        {
          op: 'CHOOSE_ZONE_CARDS',
          side: 'SELF',
          zone: 'HAND',
          prompt: '【理想的彼岸 亚里莎·回音】选择我方手牌 1 张<塞西莉>角色：',
          filter: { cardType: CardType.ROLE, trait: '塞西莉' },
          min: 1,
          max: 1,
          saveToVar: 'cecily',
          choiceEffectType: 'DSL_BP04_045_CECILY',
        },
        {
          op: 'IF',
          condition: { kind: 'VAR_NON_EMPTY', varName: 'cecily' },
          then: [
            {
              op: 'CHOOSE_MODE',
              prompt: '【理想的彼岸 亚里莎·回音】请选择对所选<塞西莉>角色执行的操作：',
              choiceEffectType: 'DSL_BP04_045_MODE',
              modes: [
                {
                  id: 'deploy_cecily',
                  label: '将该<塞西莉>角色出场',
                  steps: [
                    {
                      op: 'IF',
                      condition: { kind: 'HAS_EMPTY_SLOT', side: 'SELF' },
                      then: [
                        {
                          op: 'MOVE_CARDS',
                          target: { kind: 'VAR', varName: 'cecily' },
                          toZone: 'BATTLEFIELD',
                          triggerEntry: true,
                        },
                      ],
                    },
                  ],
                },
                {
                  id: 'attach_to_arisa',
                  label: '成为我方战场 1 张<亚里莎>角色的协战搭档',
                  steps: [
                    {
                      op: 'CHOOSE_ROLES',
                      side: 'SELF',
                      prompt: '【理想的彼岸 亚里莎·回音】选择我方战场 1 张<亚里莎>角色作为协战宿主：',
                      filter: { trait: '亚里莎' },
                      min: 1,
                      max: 1,
                      saveToVar: 'arisaHost',
                      choiceEffectType: 'DSL_BP04_045_HOST',
                    },
                    {
                      op: 'ATTACH_PARTNER',
                      host: { kind: 'VAR', varName: 'arisaHost' },
                      partner: { kind: 'VAR', varName: 'cecily' },
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

  // BP04-046 理想的彼岸 塞西莉 (5费)
  // 受限点：第 1 项【协战自】「从手牌成为<亚里莎>搭档的回合中解除协战时从墓地出场」需共享层补充 PARTNER_GAINED.fromZone 与 PARTNER_RELEASED 触发匹配器。
  {
    cardNumber: 'BP04-046',
    name: '理想的彼岸 塞西莉',
    vanillaEntry: true,
    triggers: [
      {
        abilityId: 'dsl:BP04-046:partner_elim2_same',
        eventType: 'PARTNER_GAINED',
        matcher: { kind: 'SELF_BECAME_PARTNER', requiredHostName: '理想的彼岸 亚里莎·回音' },
        label: '【理想的彼岸 塞西莉】【协战自】成为《理想的彼岸 亚里莎·回音》搭档时可消 2 同色球',
        cost: {
          kind: 'ELIMINATE_ORBS',
          filter: 'SAME',
          count: 2,
          optional: true,
          savePaidToVar: 'paidOrbs',
          prompt: '【理想的彼岸 塞西莉】【协战自】是否消除 2 同色信号球？（红球赐【贯通】；蓝球复活<=5<亚里莎>/<塞西莉>）',
          choiceEffectType: 'DSL_BP04_046_ORB_COST',
        },
        steps: [
          {
            op: 'IF',
            condition: {
              kind: 'VAR_HAS_CARD_MATCHING',
              varName: 'paidOrbs',
              filter: { trait: '信号球·红' },
            },
            then: [
              {
                op: 'MODIFY_STATS',
                target: { kind: 'TRIGGER_HOST' },
                keywords: ['贯通'],
                duration: 'END_OF_TURN',
              },
            ],
          },
          {
            op: 'IF',
            condition: {
              kind: 'VAR_HAS_CARD_MATCHING',
              varName: 'paidOrbs',
              filter: { trait: '信号球·蓝' },
            },
            then: [
              {
                op: 'CHOOSE_ZONE_CARDS',
                side: 'SELF',
                zone: 'GRAVEYARD',
                prompt: '【理想的彼岸 塞西莉】<信号球·蓝>：选择我方墓地 1 张费用为 5 及以下的<亚里莎>或<塞西莉>角色出场：',
                filter: { cardType: CardType.ROLE, anyTraits: ['亚里莎', '塞西莉'], maxCost: 5 },
                requireEmptySlot: true,
                min: 1,
                max: 1,
                saveToVar: 'revived',
                choiceEffectType: 'DSL_BP04_046_REVIVE',
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

  // BP04-047 塞西莉 (4费)
  // 受限点：【自】【游戏1】「我方战场不为协战状态的《亚里莎·回音》被攻击时，若该牌在墓地且战场无<塞西莉>...」
  // 缺少在墓地监听 ATTACK_DECLARED 被攻击目标的匹配器、游戏1触发计数与 OR 消球代价。
  {
    cardNumber: 'BP04-047',
    name: '塞西莉',
    vanillaEntry: true,
    handCostDiscount: {
      condition: {
        kind: 'HAS_ROLE',
        side: 'SELF',
        filter: { exactName: '亚里莎·回音', hasPartner: false },
      },
      flatDiscount: 1,
    },
  },

  // BP04-048 亚里莎·回音 (4费 协战)
  {
    cardNumber: 'BP04-048',
    name: '亚里莎·回音',
    entry: {
      cost: {
        kind: 'DISCARD_HAND',
        count: 1,
        optional: true,
        prompt: '【亚里莎·回音】【出】是否丢弃 1 张手牌：公开牌组顶 3 张，选 1 张<亚里莎>或<塞西莉>角色加入手牌？',
        choiceEffectType: 'DSL_BP04_048_DISCARD',
      },
      steps: [
        { op: 'REVEAL_TOP', count: 3, saveToVar: 'revealed' },
        {
          op: 'CHOOSE_FROM_VAR',
          varName: 'revealed',
          prompt: '【亚里莎·回音】【出】选择其中 1 张<亚里莎>或<塞西莉>角色加入手牌（其余放牌组底）：',
          filter: { cardType: CardType.ROLE, anyTraits: ['亚里莎', '塞西莉'] },
          alwaysShow: true,
          min: 1,
          max: 1,
          saveToVar: 'kept',
          choiceEffectType: 'DSL_BP04_048_PICK',
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

  // BP04-049 双生回响 (2费 瞬时战术)
  {
    cardNumber: 'BP04-049',
    name: '双生回响',
    playPrecondition: {
      condition: { kind: 'TURN_OWNER', isSelfTurn: false },
      errorMessage: '该牌只能在对方回合使用',
    },
    tactics: [
      (() => {
        const makeAssistUntapMode = (
          id: string,
          label: string,
          hostTrait: '亚里莎' | '塞西莉',
          partnerTrait: '塞西莉' | '亚里莎'
        ) => ({
          id,
          label,
          steps: [
            {
              op: 'CHOOSE_ROLES' as const,
              side: 'SELF' as const,
              prompt: `【双生回响】选择我方战场 1 张<${hostTrait}>角色：`,
              filter: { trait: hostTrait },
              min: 1,
              max: 1,
              saveToVar: 'host',
              choiceEffectType: `DSL_BP04_049_HOST_${id}`,
            },
            {
              op: 'IF' as const,
              condition: { kind: 'VAR_NON_EMPTY' as const, varName: 'host' },
              then: [
                {
                  op: 'CHOOSE_ZONE_CARDS' as const,
                  side: 'SELF' as const,
                  zone: 'HAND' as const,
                  prompt: `【双生回响】选择我方手牌 1 张<${partnerTrait}>角色成为其协战搭档：`,
                  filter: { cardType: CardType.ROLE, trait: partnerTrait },
                  min: 1,
                  max: 1,
                  saveToVar: 'partner',
                  choiceEffectType: `DSL_BP04_049_PARTNER_${id}`,
                },
                {
                  op: 'ATTACH_PARTNER' as const,
                  host: { kind: 'VAR' as const, varName: 'host' },
                  partner: { kind: 'VAR' as const, varName: 'partner' },
                },
                {
                  op: 'IF' as const,
                  condition: {
                    kind: 'VAR_HAS_CARD_MATCHING' as const,
                    varName: 'host',
                    filter: { hasPartner: true },
                  },
                  then: [
                    {
                      op: 'CONFIRM_YES_NO' as const,
                      prompt: `【双生回响】所选<${hostTrait}>角色处于协战状态，是否将其竖直？`,
                      yesLabel: '竖直该角色',
                      noLabel: '保持横置/现状',
                      choiceEffectType: `DSL_BP04_049_UNTAP_${id}`,
                      onYes: [{ op: 'SET_READY' as const, target: { kind: 'VAR' as const, varName: 'host' }, isReady: true }],
                    },
                  ],
                },
              ],
            },
          ],
        });
        return {
          op: 'CHOOSE_MODE',
          prompt: '【双生回响】【瞬时】请从以下 2 项选择 1 项：',
          choiceEffectType: 'DSL_BP04_049_MODE',
          modes: [
            makeAssistUntapMode(
              'arisa_host',
              '选战场 1 张<亚里莎>角色，手牌 1 张<塞西莉>成为搭档；若为协战状态可将其竖直',
              '亚里莎',
              '塞西莉'
            ),
            makeAssistUntapMode(
              'cecily_host',
              '选战场 1 张<塞西莉>角色，手牌 1 张<亚里莎>成为搭档；若为协战状态可将其竖直',
              '塞西莉',
              '亚里莎'
            ),
          ],
        };
      })(),
    ],
  },

  // ==================== 6. 神寂启示录 / 异聚体体系 (BP04-050 ~ BP04-060) ====================

  // BP04-050 瘟疫骑士 (6费)
  {
    cardNumber: 'BP04-050',
    name: '瘟疫骑士',
    activate: createKnightGyToHandActivate('BP04-050', '瘟疫骑士', 6),
    entries: [
      {
        id: 'freeze_or_destroy',
        label: '选择对方战场 1 张费用<=7的角色冰冻（已冰冻改为破坏）',
        steps: [
          {
            op: 'CHOOSE_ROLES',
            side: 'OPPONENT',
            prompt: '【瘟疫骑士】【出】选择对方战场 1 张费用为 7 及以下的角色（未冰冻则冰冻，已冰冻则破坏）：',
            filter: { maxCost: 7 },
            min: 1,
            max: 1,
            saveToVar: 'oppTarget',
            choiceEffectType: 'DSL_BP04_050_FREEZE',
          },
          {
            op: 'IF',
            condition: { kind: 'VAR_NON_EMPTY', varName: 'oppTarget' },
            then: [
              {
                op: 'IF',
                condition: {
                  kind: 'VAR_HAS_CARD_MATCHING',
                  varName: 'oppTarget',
                  filter: { isFrozen: true },
                },
                then: [{ op: 'DESTROY_ROLES', target: { kind: 'VAR', varName: 'oppTarget' } }],
                else: [{ op: 'SET_FROZEN', target: { kind: 'VAR', varName: 'oppTarget' }, isFrozen: true }],
              },
            ],
          },
        ],
      },
      {
        id: 'bounce_apocalypse_assault',
        label: '可将我方 1 张<神寂启示录>角色返回手牌使该牌获得【突进】',
        steps: [
          {
            op: 'CHOOSE_ROLES',
            side: 'SELF',
            prompt: '【瘟疫骑士】【出】可将我方 1 张<神寂启示录>角色返回手牌使该牌获得【突进】（不选则跳过）：',
            filter: { trait: '神寂启示录' },
            min: 0,
            max: 1,
            saveToVar: 'bounce',
            choiceEffectType: 'DSL_BP04_050_BOUNCE',
          },
          {
            op: 'MOVE_CARDS',
            target: { kind: 'VAR', varName: 'bounce' },
            toZone: 'HAND',
            isFaceUp: true,
            saveMovedToVar: 'bounced',
          },
          {
            op: 'IF',
            condition: { kind: 'VAR_NON_EMPTY', varName: 'bounced' },
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
    ],
  },

  // BP04-051 饥荒骑士 (5费)
  // 受限点：
  // 1. 第 2 项【出】「若我方战场的《神寂启示录》下方的牌为 3 张及以上」，TOTAL_UNDERNEATH_COUNT 仅遍历 roleCardId 跳过辅助机 BP04-059；
  // 2. 第 1 项【出】剩余公开牌移至墓地未标记 countAsDeckToGy: true。
  {
    cardNumber: 'BP04-051',
    name: '饥荒骑士',
    activate: createKnightGyToHandActivate('BP04-051', '饥荒骑士', 5),
    entries: [
      {
        id: 'reveal3_lilith_or_orb',
        label: '公开牌组顶 3 张选最多 1 张<莉莉丝>或信号球加手其余送墓（公开<信号球·红>可全加手）',
        steps: [
          { op: 'REVEAL_TOP', count: 3, saveToVar: 'revealed' },
          (() => {
            const normalPickSteps: EffectStep[] = [
              {
                op: 'CHOOSE_FROM_VAR',
                varName: 'revealed',
                prompt: '【饥荒骑士】【出】选择其中最多 1 张<莉莉丝>或信号球牌加入手牌（其余放墓地）：',
                filter: { anyFilters: [{ trait: '莉莉丝' }, { isSignalOrb: true }] },
                alwaysShow: true,
                min: 0,
                max: 1,
                saveToVar: 'kept',
                choiceEffectType: 'DSL_BP04_051_PICK',
              },
              { op: 'MOVE_CARDS', target: { kind: 'VAR', varName: 'kept' }, toZone: 'HAND', isFaceUp: true },
              {
                op: 'MOVE_CARDS',
                target: { kind: 'REST_OF_VAR', allVar: 'revealed', excludeVar: 'kept' },
                toZone: 'GRAVEYARD',
                isFaceUp: true,
              },
            ];
            return {
              op: 'IF',
              condition: {
                kind: 'VAR_HAS_CARD_MATCHING',
                varName: 'revealed',
                filter: { trait: '信号球·红' },
              },
              then: [
                {
                  op: 'CONFIRM_YES_NO',
                  prompt: '【饥荒骑士】【出】公开了<信号球·红>，是否将所有公开的牌加入手牌？',
                  yesLabel: '全部加入手牌',
                  noLabel: '仅选最多 1 张',
                  choiceEffectType: 'DSL_BP04_051_TAKE_ALL',
                  onYes: [{ op: 'MOVE_CARDS', target: { kind: 'VAR', varName: 'revealed' }, toZone: 'HAND', isFaceUp: true }],
                  onNo: normalPickSteps,
                },
              ],
              else: normalPickSteps,
            };
          })(),
        ],
      },
      {
        id: 'discard_debuff_3000',
        label: '丢弃 1 张手牌：若《神寂启示录》下方 >=3 张，对方 1 张角色 PP-3000',
        cost: {
          kind: 'DISCARD_HAND',
          count: 1,
          optional: true,
          prompt: '【饥荒骑士】【出】是否丢弃 1 张手牌，检查《神寂启示录》下方牌数使对方 1 张角色 PP-3000？',
          choiceEffectType: 'DSL_BP04_051_DISCARD',
        },
        steps: [
          {
            op: 'IF',
            condition: {
              kind: 'TOTAL_UNDERNEATH_COUNT',
              side: 'SELF',
              roleFilter: { exactName: '神寂启示录' },
              op: '>=',
              value: 3,
            },
            then: [
              {
                op: 'CHOOSE_ROLES',
                side: 'OPPONENT',
                prompt: '【饥荒骑士】【出】选择对方战场 1 张角色，直到回合结束 PP-3000：',
                min: 1,
                max: 1,
                saveToVar: 'oppTarget',
                choiceEffectType: 'DSL_BP04_051_DEBUFF',
              },
              {
                op: 'MODIFY_STATS',
                target: { kind: 'VAR', varName: 'oppTarget' },
                pp: -3000,
                duration: 'END_OF_TURN',
              },
            ],
          },
        ],
      },
    ],
  },

  // BP04-052 血契者 (10费；同场最多存在1张由 sba-engine.ts 执行)
  // 受限点：interpreter.ts bringToField 目前仅调用 playRoleCard 而未对 ASSIST 卡牌调用 playAssistCard，从牌组将《神寂启示录》出场需共享层修复。
  {
    cardNumber: 'BP04-052',
    name: '血契者',
    vanillaEntry: true,
    activate: {
      usableZones: ['HAND'],
      cost: { kind: 'DISCARD_SELF_FROM_HAND' },
      steps: [
        {
          op: 'IF',
          condition: {
            kind: 'ZONE_COUNT',
            side: 'SELF',
            zone: 'BATTLEFIELD',
            filter: { cardType: CardType.ASSIST, exactName: '神寂启示录' },
            op: '==',
            value: 0,
          },
          then: [
            {
              op: 'CHOOSE_ZONE_CARDS',
              side: 'SELF',
              zone: 'DECK',
              prompt: '【血契者】【起】选择我方牌组 1 张《神寂启示录》出场并洗切牌组：',
              filter: { exactName: '神寂启示录' },
              requireEmptySlot: true,
              min: 1,
              max: 1,
              saveToVar: 'apoc',
              choiceEffectType: 'DSL_BP04_052_PICK_APOC',
            },
            {
              op: 'MOVE_CARDS',
              target: { kind: 'VAR', varName: 'apoc' },
              toZone: 'BATTLEFIELD',
              triggerEntry: true,
            },
            { op: 'SHUFFLE_DECK', side: 'SELF' },
          ],
          else: [{ op: 'DRAW', count: 1 }],
        },
      ],
    },
  },

  // BP04-053 战争骑士 (4费)
  {
    cardNumber: 'BP04-053',
    name: '战争骑士',
    vanillaEntry: true,
    activates: [
      {
        id: 'hand_sac_rush',
        label: '【战争骑士】【起】丢弃手牌中的该牌：破坏战场 1 张<神寂启示录>或<=3<遗忘者>，赋予 1 张角色【速攻】',
        usableZones: ['HAND'],
        oncePerTurnByPlayer: true,
        cost: { kind: 'DISCARD_SELF_FROM_HAND' },
        steps: [
          {
            op: 'CHOOSE_ROLES',
            side: 'SELF',
            prompt: '【战争骑士】【起】选择我方战场 1 张<遗忘者>或<神寂启示录>角色（获得【速攻】）：',
            filter: { anyTraits: ['遗忘者', '神寂启示录'] },
            min: 1,
            max: 1,
            saveToVar: 'buffTarget',
            choiceEffectType: 'DSL_BP04_053_BUFF_TARGET',
          },
          {
            op: 'IF',
            condition: { kind: 'VAR_NON_EMPTY', varName: 'buffTarget' },
            then: [
              {
                op: 'CHOOSE_ROLES',
                side: 'SELF',
                prompt: '【战争骑士】【起】可将我方战场 1 张<神寂启示录>角色或费用<=3<遗忘者>角色破坏（不选则跳过）：',
                filter: {
                  anyFilters: [{ trait: '神寂启示录' }, { trait: '遗忘者', maxCost: 3 }],
                },
                min: 0,
                max: 1,
                saveToVar: 'sacTarget',
                choiceEffectType: 'DSL_BP04_053_SAC',
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
                    op: 'MODIFY_STATS',
                    target: { kind: 'VAR', varName: 'buffTarget' },
                    keywords: ['速攻'],
                    duration: 'END_OF_TURN',
                  },
                ],
              },
            ],
          },
        ],
      },
      createKnightGyReviveActivate('BP04-053', '战争骑士'),
    ],
  },

  // BP04-054 死亡骑士 (4费)
  {
    cardNumber: 'BP04-054',
    name: '死亡骑士',
    vanillaEntry: true,
    activates: [
      {
        id: 'hand_self_damage_charge',
        label: '【死亡骑士】【起】丢弃手牌中的该牌：费用区角色均为《薇拉·灼惘》与<神寂启示录>时自伤 1 使 1 张角色【充能+1】',
        usableZones: ['HAND'],
        oncePerTurnByPlayer: true,
        cost: { kind: 'DISCARD_SELF_FROM_HAND' },
        steps: [
          {
            op: 'IF',
            condition: {
              kind: 'ALL_ZONE_CARDS_MATCH',
              side: 'SELF',
              zone: 'COST',
              preFilter: { isFaceUp: true, cardType: CardType.ROLE },
              matchFilter: {
                anyFilters: [{ exactName: '薇拉·灼惘' }, { trait: '神寂启示录' }],
              },
            },
            then: [
              { op: 'DEAL_DAMAGE', side: 'SELF', amount: 1 },
              {
                op: 'IF',
                condition: { kind: 'EROSION_COMPARE', side: 'SELF', op: '<', value: 7 },
                then: [
                  {
                    op: 'CHOOSE_ROLES',
                    side: 'SELF',
                    prompt: '【死亡骑士】【起】选择我方战场 1 张角色，直到回合结束获得【充能+1】：',
                    min: 1,
                    max: 1,
                    saveToVar: 'target',
                    choiceEffectType: 'DSL_BP04_054_CHARGE',
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
      createKnightGyReviveActivate('BP04-054', '死亡骑士'),
    ],
  },

  // BP04-055 钢铁军团领主 (3费 充能0)
  {
    cardNumber: 'BP04-055',
    name: '钢铁军团领主',
    entry: {
      steps: [
        {
          op: 'IF',
          condition: {
            kind: 'ZONE_COUNT',
            side: 'SELF',
            zone: 'GRAVEYARD',
            filter: { cardType: CardType.ROLE, anyTraits: ['神寂启示录', '遗忘者'] },
            op: '>=',
            value: 2,
          },
          then: [
            {
              op: 'CONFIRM_YES_NO',
              prompt: '【钢铁军团领主】【出】是否将墓地合计 2 张<神寂启示录>或<遗忘者>角色放置到牌组底，使该牌获得【速攻】？',
              yesLabel: '置底 2 张并获得【速攻】',
              noLabel: '不执行',
              choiceEffectType: 'DSL_BP04_055_CONFIRM',
              onYes: [
                {
                  op: 'CHOOSE_ZONE_CARDS',
                  side: 'SELF',
                  zone: 'GRAVEYARD',
                  prompt: '【钢铁军团领主】选择我方墓地合计 2 张<神寂启示录>或<遗忘者>角色放置到牌组底：',
                  filter: { cardType: CardType.ROLE, anyTraits: ['神寂启示录', '遗忘者'] },
                  min: 2,
                  max: 2,
                  saveToVar: 'bot2',
                  choiceEffectType: 'DSL_BP04_055_BOT2',
                },
                {
                  op: 'MOVE_CARDS',
                  target: { kind: 'VAR', varName: 'bot2' },
                  toZone: 'DECK_BOTTOM',
                  saveMovedToVar: 'moved2',
                },
                {
                  op: 'IF',
                  condition: { kind: 'VAR_COUNT_COMPARE', varName: 'moved2', op: '==', value: 2 },
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

  // BP04-056 活死人 (3费)
  {
    cardNumber: 'BP04-056',
    name: '活死人',
    vanillaEntry: true,
    activate: {
      oncePerTurn: true,
      steps: [
        {
          op: 'IF',
          condition: {
            kind: 'ALL',
            conditions: [
              {
                kind: 'ZONE_COUNT',
                side: 'SELF',
                zone: 'GRAVEYARD',
                filter: { cardType: CardType.ROLE, trait: '神寂启示录' },
                op: '>=',
                value: 1,
              },
              {
                kind: 'HAS_ROLE',
                side: 'SELF',
                filter: { trait: '神寂启示录', excludeSelf: true },
              },
            ],
          },
          then: [
            {
              op: 'CONFIRM_YES_NO',
              prompt: '【活死人】【起】是否将墓地 1 张<神寂启示录>置牌组底并将战场其他 1 张<神寂启示录>送墓，获得【突进】【同命】？',
              yesLabel: '执行并获得【突进】【同命】',
              noLabel: '不执行',
              choiceEffectType: 'DSL_BP04_056_CONFIRM',
              onYes: [
                {
                  op: 'CHOOSE_ZONE_CARDS',
                  side: 'SELF',
                  zone: 'GRAVEYARD',
                  prompt: '【活死人】选择我方墓地 1 张<神寂启示录>角色放置到牌组底：',
                  filter: { cardType: CardType.ROLE, trait: '神寂启示录' },
                  min: 1,
                  max: 1,
                  saveToVar: 'gyBot',
                  choiceEffectType: 'DSL_BP04_056_GY',
                },
                {
                  op: 'CHOOSE_ROLES',
                  side: 'SELF',
                  prompt: '【活死人】选择我方战场其他 1 张<神寂启示录>角色放置到墓地：',
                  filter: { trait: '神寂启示录', excludeSelf: true },
                  min: 1,
                  max: 1,
                  saveToVar: 'fieldSac',
                  choiceEffectType: 'DSL_BP04_056_FIELD',
                },
                {
                  op: 'MOVE_CARDS',
                  target: { kind: 'VAR', varName: 'gyBot' },
                  toZone: 'DECK_BOTTOM',
                  saveMovedToVar: 'movedBot',
                },
                {
                  op: 'MOVE_CARDS',
                  target: { kind: 'VAR', varName: 'fieldSac' },
                  toZone: 'GRAVEYARD',
                  isFaceUp: true,
                  sentByEffectOrCost: true,
                  saveMovedToVar: 'movedSac',
                },
                {
                  op: 'IF',
                  condition: {
                    kind: 'ALL',
                    conditions: [
                      { kind: 'VAR_NON_EMPTY', varName: 'movedBot' },
                      { kind: 'VAR_NON_EMPTY', varName: 'movedSac' },
                    ],
                  },
                  then: [
                    {
                      op: 'MODIFY_STATS',
                      target: { kind: 'SELF' },
                      keywords: ['突进', '同命'],
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

  // BP04-057 矛隼 (2费)
  {
    cardNumber: 'BP04-057',
    name: '矛隼',
    vanillaEntry: true,
    triggers: [
      {
        abilityId: 'dsl:BP04-057:destroyed_bot_draw',
        eventType: 'CARD_DESTROYED',
        matcher: { kind: 'SELF_DESTROYED', destroyReason: 'ANY' },
        condition: { kind: 'SELF_MATCHES_FILTER', filter: { inZone: 'GRAVEYARD' } },
        label: '【矛隼】【自】被破坏时可将自身从墓地置牌组底并抽 1 张牌',
        steps: [
          {
            op: 'CONFIRM_YES_NO',
            prompt: '【矛隼】【自】是否将该牌从墓地放置到牌组底并抽 1 张牌？',
            yesLabel: '置牌组底并抽 1 张',
            noLabel: '留在墓地',
            choiceEffectType: 'DSL_BP04_057_CONFIRM',
            onYes: [
              {
                op: 'MOVE_CARDS',
                target: { kind: 'SELF' },
                toZone: 'DECK_BOTTOM',
                saveMovedToVar: 'moved',
              },
              {
                op: 'IF',
                condition: { kind: 'VAR_NON_EMPTY', varName: 'moved' },
                then: [{ op: 'DRAW', count: 1 }],
              },
            ],
          },
        ],
      },
    ],
  },

  // BP04-058 摩利甘 (2费 装备)
  {
    cardNumber: 'BP04-058',
    name: '摩利甘',
    vanillaEntry: true,
    triggers: [
      {
        abilityId: 'dsl:BP04-058:equipped_attack_bot3_pp',
        eventType: 'ATTACK_DECLARED',
        matcher: { kind: 'EQUIPPED_ROLE_ATTACKING', requiredHostTrait: '神寂启示录' },
        label: '【摩利甘】【自】装备角色攻击时可将墓地最多 3 张<神寂启示录>角色置底，每张 PP+1000',
        steps: [
          {
            op: 'CHOOSE_ZONE_CARDS',
            side: 'SELF',
            zone: 'GRAVEYARD',
            prompt: '【摩利甘】【自】可将我方墓地最多 3 张<神寂启示录>角色放置到牌组底（每张本次攻击 PP+1000）：',
            filter: { cardType: CardType.ROLE, trait: '神寂启示录' },
            min: 0,
            max: 3,
            saveToVar: 'botCards',
            choiceEffectType: 'DSL_BP04_058_PICK',
          },
          {
            op: 'IF',
            condition: { kind: 'VAR_NON_EMPTY', varName: 'botCards' },
            then: [
              {
                op: 'MOVE_CARDS',
                target: { kind: 'VAR', varName: 'botCards' },
                toZone: 'DECK_BOTTOM',
                saveMovedToVar: 'moved',
              },
              {
                op: 'MODIFY_STATS',
                target: { kind: 'TRIGGER_ATTACKER' },
                pp: { kind: 'VAR_COUNT_MULT', varName: 'moved', multiplier: 1000 },
                duration: 'END_OF_COMBAT',
              },
            ],
          },
        ],
      },
    ],
  },

  // BP04-059 神寂启示录 (0费 辅助机)
  // 受限点：
  // 1. 【自】【回合1】「将我方牌组底 1 张牌以正面放置到该牌下方」缺少取牌组底牌 (DECK_BOTTOM_CARD / REVEAL_BOTTOM) 的 DSL 原语；
  // 2. UNDERNEATH_COUNT_MULT 尚缺少 filter 限制仅统计<神寂启示录>角色牌；
  // 3. engine.ts CostModifier.targetTrait 未调用 expandBaseTraits，故当前 ADD_COST_MODIFIER 使用 '异聚体' 兼容匹配。
  {
    cardNumber: 'BP04-059',
    name: '神寂启示录',
    vanillaEntry: true,
    ignoreAttributeCondition: { kind: 'ZONE_COUNT', side: 'SELF', zone: 'HAND', op: '>=', value: 0 },
    fieldIgnoreAttributeRule: {
      zones: ['BATTLEFIELD'],
      targetTrait: '神寂启示录',
    },
    activate: {
      cost: {
        kind: 'TAP_SELF_AND_ELIMINATE_ORBS',
        filter: 'ANY',
        count: 2,
        prompt: '【神寂启示录】【起】请选择消除【2任意信号球】作为减费代价：',
        choiceEffectType: 'DSL_BP04_059_ORB_COST',
      },
      steps: [
        {
          op: 'ADD_COST_MODIFIER',
          amount: { kind: 'UNDERNEATH_COUNT_MULT', multiplier: 1, uniqueNames: true },
          targetTrait: '异聚体',
          cardType: CardType.ROLE,
          remainingCount: 1,
          logText: '下1张<神寂启示录>角色费用减少',
        },
      ],
    },
  },

  // BP04-060 血税 (2费 战术)
  // 受限点：公开置墓未设置 countAsDeckToGy；playSacrificeDiscount 战场扫描未含 slot.assistCardId。
  {
    cardNumber: 'BP04-060',
    name: '血税',
    playSacrificeDiscount: {
      zones: ['HAND', 'BATTLEFIELD'],
      filter: { trait: '神寂启示录' },
      discount: 2,
      prompt: '【血税】是否将我方手牌或战场 1 张<神寂启示录>放置到墓地，使该牌费用-2？',
    },
    tactics: [
      { op: 'REVEAL_TOP', count: 5, saveToVar: 'revealed' },
      {
        op: 'CHOOSE_FROM_VAR',
        varName: 'revealed',
        prompt: '【血税】选择其中 1 张<神寂启示录>角色加入手牌：',
        filter: { cardType: CardType.ROLE, trait: '神寂启示录' },
        alwaysShow: true,
        min: 1,
        max: 1,
        saveToVar: 'toHand',
        choiceEffectType: 'DSL_BP04_060_HAND',
      },
      { op: 'MOVE_CARDS', target: { kind: 'VAR', varName: 'toHand' }, toZone: 'HAND', isFaceUp: true },
      {
        op: 'CHOOSE_FROM_VAR',
        varName: 'revealed',
        prompt: '【血税】选择其中 1 张<神寂启示录>角色放置到墓地（其余洗回牌组）：',
        filter: { inZone: 'PROCESSING', cardType: CardType.ROLE, trait: '神寂启示录' },
        alwaysShow: true,
        min: 1,
        max: 1,
        saveToVar: 'toGy',
        choiceEffectType: 'DSL_BP04_060_GY',
      },
      { op: 'MOVE_CARDS', target: { kind: 'VAR', varName: 'toGy' }, toZone: 'GRAVEYARD', isFaceUp: true },
      {
        op: 'MOVE_CARDS',
        target: { kind: 'REST_OF_VAR', allVar: 'revealed', excludeVar: 'toGy' },
        toZone: 'DECK_SHUFFLE',
      },
    ],
  },

  // ==================== 7. 比安卡·真理 & 莱特宁体系 (BP04-061 ~ BP04-065) ====================

  // BP04-061 比安卡·真理 (8费 升变对象：信号球区正面<比安卡>)
  {
    cardNumber: 'BP04-061',
    name: '比安卡·真理',
    vanillaEntry: true,
    activate: {
      usableZones: ['SIGNAL_ORB'],
      oncePerTurnByPlayer: true,
      cost: {
        kind: 'ELIMINATE_ORBS',
        filter: 'BLUE',
        count: 1,
        prompt: '【比安卡·真理】【起】选择消除【蓝色信号球】将信号球区的该牌加入手牌：',
        choiceEffectType: 'DSL_BP04_061_ORB_COST',
      },
      steps: [
        {
          op: 'IF',
          condition: { kind: 'SELF_MATCHES_FILTER', filter: { inZone: 'SIGNAL_ORB', isFaceUp: true } },
          then: [{ op: 'MOVE_CARDS', target: { kind: 'SELF' }, toZone: 'HAND', isFaceUp: true }],
        },
      ],
    },
    triggers: [
      {
        abilityId: 'dsl:BP04-061:attack_end_to_orb_bottom',
        eventType: 'ATTACK_ENDED',
        matcher: { kind: 'SELF_ATTACK_END' },
        label: '【比安卡·真理】【自】攻击结束时放置到我方信号球区最下方',
        steps: [
          {
            op: 'MOVE_CARDS',
            target: { kind: 'SELF' },
            toZone: 'SIGNAL_ORB_BOTTOM',
            isFaceUp: true,
          },
        ],
      },
      {
        abilityId: 'dsl:BP04-061:block_end_to_orb_bottom',
        eventType: 'ATTACK_ENDED',
        matcher: { kind: 'SELF_BLOCKED_ATTACK_END' },
        label: '【比安卡·真理】【自】阻挡战斗结束时放置到我方信号球区最下方',
        steps: [
          {
            op: 'MOVE_CARDS',
            target: { kind: 'SELF' },
            toZone: 'SIGNAL_ORB_BOTTOM',
            isFaceUp: true,
          },
        ],
      },
    ],
  },

  // BP04-062 比安卡·真理 (6费)
  {
    cardNumber: 'BP04-062',
    name: '比安卡·真理',
    entry: {
      steps: [
        {
          op: 'CHOOSE_ZONE_CARDS',
          side: 'SELF',
          zone: 'SIGNAL_ORB',
          prompt: '【比安卡·真理】【出】选择我方信号球区 1 张费用为 6 及以下的<比安卡>出场：',
          filter: { isFaceUp: true, cardType: CardType.ROLE, trait: '比安卡', maxCost: 6 },
          requireEmptySlot: true,
          min: 1,
          max: 1,
          saveToVar: 'bianca',
          choiceEffectType: 'DSL_BP04_062_DEPLOY',
        },
        {
          op: 'MOVE_CARDS',
          target: { kind: 'VAR', varName: 'bianca' },
          toZone: 'BATTLEFIELD',
          triggerEntry: true,
        },
      ],
    },
    triggers: [
      {
        abilityId: 'dsl:BP04-062:attack_pierce_pp3000_to_orb',
        eventType: 'ATTACK_DECLARED',
        matcher: { kind: 'SELF_ATTACKING' },
        label: '【比安卡·真理】【自】攻击时可消 2 球获【贯通】、PP+3000，攻击结束置信号球区最下方',
        cost: {
          kind: 'ELIMINATE_ORBS',
          filter: 'ANY',
          count: 2,
          optional: true,
          prompt: '【比安卡·真理】【自】是否消除【2任意信号球】获得【贯通】、PP+3000（攻击结束置信号球区最下方）？',
          choiceEffectType: 'DSL_BP04_062_ORB_COST',
        },
        steps: [
          {
            op: 'MODIFY_STATS',
            target: { kind: 'SELF' },
            keywords: ['贯通'],
            pp: 3000,
            duration: 'END_OF_TURN',
          },
          {
            op: 'REGISTER_DELAYED_TRIGGER',
            target: { kind: 'SELF' },
            eventType: 'ATTACK_ENDED',
            abilityId: 'DELAYED_ATTACK_END_TO_SIGNAL_ORB_BOTTOM',
            expectedZone: 'BATTLEFIELD',
            labelSuffix: '那次攻击结束时放置到我方信号球区最下方 (BP04-062)',
          },
        ],
      },
    ],
  },

  // BP04-063 比安卡·真理 (4费)
  {
    cardNumber: 'BP04-063',
    name: '比安卡·真理',
    entry: {
      steps: [
        { op: 'REVEAL_TOP', count: 5, saveToVar: 'revealed' },
        {
          op: 'CHOOSE_FROM_VAR',
          varName: 'revealed',
          prompt: '【比安卡·真理】【出】选择其中最多 1 张牌放置到我方信号球区最下方（其余洗回牌组）：',
          alwaysShow: true,
          min: 0,
          max: 1,
          saveToVar: 'picked',
          choiceEffectType: 'DSL_BP04_063_PICK',
        },
        {
          op: 'MOVE_CARDS',
          target: { kind: 'VAR', varName: 'picked' },
          toZone: 'SIGNAL_ORB_BOTTOM',
          isFaceUp: true,
          saveMovedToVar: 'movedOrb',
        },
        {
          op: 'MOVE_CARDS',
          target: { kind: 'REST_OF_VAR', allVar: 'revealed', excludeVar: 'picked' },
          toZone: 'DECK_SHUFFLE',
        },
        {
          op: 'IF',
          condition: {
            kind: 'ALL',
            conditions: [
              { kind: 'VAR_NON_EMPTY', varName: 'movedOrb' },
              {
                kind: 'NOT',
                condition: {
                  kind: 'VAR_HAS_CARD_MATCHING',
                  varName: 'movedOrb',
                  filter: { anyFilters: [{ exactName: '比安卡·真理' }, { exactName: '莱特宁' }] },
                },
              },
            ],
          },
          then: [
            {
              op: 'REGISTER_DELAYED_TRIGGER',
              target: { kind: 'VAR', varName: 'movedOrb' },
              eventType: 'END_PHASE_TRIGGERS',
              turnOffset: 0,
              abilityId: 'DELAYED_END_OF_TURN_TO_GRAVEYARD',
              expectedZone: 'SIGNAL_ORB',
              labelSuffix: '该回合结束时从信号球区放置到墓地 (BP04-063)',
            },
          ],
        },
      ],
    },
  },

  // BP04-064 比安卡·真理 (2费)
  {
    cardNumber: 'BP04-064',
    name: '比安卡·真理',
    vanillaEntry: true,
    triggers: [
      {
        abilityId: 'dsl:BP04-064:attack_end_to_orb_bottom',
        eventType: 'ATTACK_ENDED',
        matcher: { kind: 'SELF_ATTACK_END' },
        label: '【比安卡·真理】【自】攻击结束时放置到我方信号球区最下方',
        steps: [
          {
            op: 'MOVE_CARDS',
            target: { kind: 'SELF' },
            toZone: 'SIGNAL_ORB_BOTTOM',
            isFaceUp: true,
          },
        ],
      },
    ],
  },

  // BP04-065 莱特宁 (3费 装备；离场置换至信号球区最下方已内置于 replacement-engine.ts)
  // 受限点：EQUIP_FROM_VAR 仅支持变量，多张《莱特宁》同时在信号球区时需点选 1 张。
  {
    cardNumber: 'BP04-065',
    name: '莱特宁',
    vanillaEntry: true,
    triggers: [
      {
        abilityId: 'dsl:BP04-065:equip_on_bianca_enter',
        eventType: 'CARD_ENTERED_FIELD',
        matcher: {
          kind: 'SELF_IN_SIGNAL_ORB_ON_FRIENDLY_ROLE_ENTERED',
          enteredFilter: { trait: '比安卡' },
        },
        condition: { kind: 'SELF_MATCHES_FILTER', filter: { inZone: 'SIGNAL_ORB', isFaceUp: true } },
        label: '【莱特宁】【自】我方<比安卡>角色出场时，将该牌从信号球区装备给那张角色',
        steps: [
          {
            op: 'CHOOSE_ZONE_CARDS',
            side: 'SELF',
            zone: 'SIGNAL_ORB',
            prompt: '【莱特宁】【自】确认将信号球区的《莱特宁》装备给刚出场的<比安卡>角色：',
            filter: { cardNumbers: ['BP04-065'], isFaceUp: true },
            min: 1,
            max: 1,
            saveToVar: 'lightning',
            choiceEffectType: 'DSL_BP04_065_EQUIP',
          },
          {
            op: 'EQUIP_FROM_VAR',
            varName: 'lightning',
            host: { kind: 'TRIGGER_TARGET' },
          },
        ],
      },
    ],
  },

  // ==================== 8. 拉弥亚·深谣 & 墨提斯体系 (BP04-066 ~ BP04-070) ====================

  // BP04-066 拉弥亚·深谣 (6费 协战；10.12「费用为6以下」=严格小于6即 maxCost: 5，Q&A·9 牌组费用减免仅在手牌/墓地生效)
  {
    cardNumber: 'BP04-066',
    name: '拉弥亚·深谣',
    vanillaEntry: true,
    handCostDiscount: {
      zone: 'SIGNAL_ORB',
      filter: { exactName: '潮涌球', isFaceUp: true },
      discountPerCard: 1,
    },
    staticEffects: [
      {
        id: 'dsl:BP04-066:gy_surge_cost_discount',
        scope: 'SELF',
        sourceZones: ['GRAVEYARD'],
        costDelta: {
          kind: 'ORB_ZONE_COUNT_MULT',
          side: 'SELF',
          filter: { exactName: '潮涌球', isFaceUp: true },
          multiplier: -1,
        },
      },
    ],
    triggers: [
      {
        abilityId: 'dsl:BP04-066:deck_to_gy_attach_partner',
        eventType: 'CARD_MOVED_DECK_TO_GY',
        oncePerTurn: true,
        deferOncePerTurnUntilCostPaid: true,
        matcher: {
          kind: 'FRIENDLY_CARD_MOVED_DECK_TO_GY',
          filter: { cardType: CardType.ROLE, trait: '升格者', maxCost: 5 },
        },
        label: '【拉弥亚·深谣】【自】【回合1】费用<=6<升格者>角色从牌组进墓地时可消任意1球绑定为搭档',
        steps: [
          {
            op: 'ELIMINATE_ORB_COST',
            filter: 'ANY',
            count: 1,
            optional: true,
            prompt: '【拉弥亚·深谣】【自】是否消除【任意信号球】1 张，将刚进墓地的<升格者>角色成为协战搭档？',
            choiceEffectType: 'DSL_BP04_066_ORB_COST',
            onPaid: [
              { op: 'MARK_TURN_ABILITY_USED', abilityKey: '__TRIGGER_ONCE_KEY__' },
              {
                op: 'ATTACH_PARTNER',
                host: { kind: 'SELF' },
                partner: { kind: 'TRIGGER_TARGET' },
              },
            ],
          },
        ],
      },
    ],
  },

  // BP04-067 拉弥亚·深谣 (3费 协战)
  {
    cardNumber: 'BP04-067',
    name: '拉弥亚·深谣',
    entry: {
      steps: [
        {
          op: 'CHOOSE_ZONE_CARDS',
          side: 'SELF',
          zone: 'COST',
          prompt: '【拉弥亚·深谣】【出】选择我方费用区 1 张《潮涌球》（明费）加入手牌：',
          filter: { isFaceUp: true, exactName: '潮涌球' },
          min: 1,
          max: 1,
          saveToVar: 'surgeOrb',
          choiceEffectType: 'DSL_BP04_067_COST',
        },
        {
          op: 'MOVE_CARDS',
          target: { kind: 'VAR', varName: 'surgeOrb' },
          toZone: 'HAND',
          isFaceUp: true,
          saveMovedToVar: 'moved',
        },
        {
          op: 'IF',
          condition: { kind: 'VAR_NON_EMPTY', varName: 'moved' },
          then: [
            { op: 'REVEAL_TOP', count: 1, saveToVar: 'top1' },
            {
              op: 'MOVE_CARDS',
              target: { kind: 'VAR', varName: 'top1' },
              toZone: 'COST',
              isFaceUp: true,
              isReady: false,
            },
          ],
        },
      ],
    },
  },

  // BP04-068 拉弥亚·深谣 (4费)
  {
    cardNumber: 'BP04-068',
    name: '拉弥亚·深谣',
    vanillaEntry: true,
    triggers: [
      {
        abilityId: 'dsl:BP04-068:deck_to_gy_recover_lamia',
        eventType: 'CARD_MOVED_DECK_TO_GY',
        matcher: { kind: 'SELF_MOVED_DECK_TO_GY' },
        label: '【拉弥亚·深谣】【自】从牌组置入墓地时可弃 2 张手牌回收墓地 1 张<拉弥亚>',
        cost: {
          kind: 'DISCARD_HAND',
          count: 2,
          optional: true,
          prompt: '【拉弥亚·深谣】【自】是否丢弃 2 张手牌，选择墓地 1 张<拉弥亚>加入手牌？',
          choiceEffectType: 'DSL_BP04_068_DISCARD',
        },
        steps: [
          {
            op: 'CHOOSE_ZONE_CARDS',
            side: 'SELF',
            zone: 'GRAVEYARD',
            prompt: '【拉弥亚·深谣】选择我方墓地 1 张<拉弥亚>加入手牌：',
            filter: { trait: '拉弥亚' },
            min: 1,
            max: 1,
            saveToVar: 'lamia',
            choiceEffectType: 'DSL_BP04_068_RECOVER',
          },
          { op: 'MOVE_CARDS', target: { kind: 'VAR', varName: 'lamia' }, toZone: 'HAND', isFaceUp: true },
        ],
      },
    ],
  },

  // BP04-069 拉弥亚·深谣 (3费)
  // 受限点：选择 1 张暗属性置入墓地时未设置 countAsDeckToGy: true。
  {
    cardNumber: 'BP04-069',
    name: '拉弥亚·深谣',
    vanillaEntry: true,
    triggers: [
      {
        abilityId: 'dsl:BP04-069:assist_reveal4_filter',
        eventType: 'PARTNER_GAINED',
        matcher: { kind: 'SELF_BECAME_PARTNER' },
        label: '【拉弥亚·深谣】【协战自】公开牌组顶 4 张选最多 1 <升格者>加手、最多 1 暗属性进墓',
        steps: [
          { op: 'REVEAL_TOP', count: 4, saveToVar: 'revealed' },
          {
            op: 'CHOOSE_FROM_VAR',
            varName: 'revealed',
            prompt: '【拉弥亚·深谣】【协战自】选择其中最多 1 张<升格者>加入手牌：',
            filter: { trait: '升格者' },
            alwaysShow: true,
            min: 0,
            max: 1,
            saveToVar: 'toHand',
            choiceEffectType: 'DSL_BP04_069_HAND',
          },
          { op: 'MOVE_CARDS', target: { kind: 'VAR', varName: 'toHand' }, toZone: 'HAND', isFaceUp: true },
          {
            op: 'CHOOSE_FROM_VAR',
            varName: 'revealed',
            prompt: '【拉弥亚·深谣】【协战自】选择其中最多 1 张暗属性的牌放置到墓地（其余洗回牌组）：',
            filter: { inZone: 'PROCESSING', attribute: ElementAttribute.DARK },
            alwaysShow: true,
            min: 0,
            max: 1,
            saveToVar: 'toGy',
            choiceEffectType: 'DSL_BP04_069_GY',
          },
          { op: 'MOVE_CARDS', target: { kind: 'VAR', varName: 'toGy' }, toZone: 'GRAVEYARD', isFaceUp: true },
          {
            op: 'MOVE_CARDS',
            target: { kind: 'REST_OF_VAR', allVar: 'revealed', excludeVar: 'toGy' },
            toZone: 'DECK_SHUFFLE',
          },
        ],
      },
    ],
  },

  // BP04-070 墨提斯 (2费 装备)
  // 受限点：
  // 1. EQUIP_FROM_VAR 仅支持变量（多张《墨提斯》在墓地时需选择 1 张）；
  // 2. Q&A·9：墨提斯自身【自】【回合1】在宿主升变后仍算已使用，而 EQUIPPED_ROLE_ATTACKING 的 onceKey 绑定了宿主 instanceId。
  {
    cardNumber: 'BP04-070',
    name: '墨提斯',
    vanillaEntry: true,
    triggers: [
      {
        abilityId: 'dsl:BP04-070:deck_to_gy_equip_lamia',
        eventType: 'CARD_MOVED_DECK_TO_GY',
        matcher: { kind: 'SELF_MOVED_DECK_TO_GY' },
        condition: { kind: 'SELF_MATCHES_FILTER', filter: { inZone: 'GRAVEYARD' } },
        label: '【墨提斯】【自】从牌组置入墓地时选择最多 1 张<拉弥亚>角色装备',
        steps: [
          {
            op: 'CHOOSE_ROLES',
            side: 'SELF',
            prompt: '【墨提斯】【自】选择我方战场最多 1 张<拉弥亚>角色装备该牌：',
            filter: { trait: '拉弥亚', hasEquipment: false },
            min: 0,
            max: 1,
            saveToVar: 'lamiaHost',
            choiceEffectType: 'DSL_BP04_070_HOST',
          },
          {
            op: 'IF',
            condition: { kind: 'VAR_NON_EMPTY', varName: 'lamiaHost' },
            then: [
              {
                op: 'CHOOSE_ZONE_CARDS',
                side: 'SELF',
                zone: 'GRAVEYARD',
                prompt: '【墨提斯】确认从墓地装备《墨提斯》：',
                filter: { cardNumbers: ['BP04-070'] },
                min: 1,
                max: 1,
                saveToVar: 'metis',
                choiceEffectType: 'DSL_BP04_070_PICK',
              },
              { op: 'EQUIP_FROM_VAR', varName: 'metis', host: { kind: 'VAR', varName: 'lamiaHost' } },
            ],
          },
        ],
      },
      {
        abilityId: 'dsl:BP04-070:equipped_attack_both_mill3',
        eventType: 'ATTACK_DECLARED',
        oncePerTurn: true,
        matcher: { kind: 'EQUIPPED_ROLE_ATTACKING', requiredHostTrait: '拉弥亚' },
        label: '【墨提斯】【自】【回合1】装备的<拉弥亚>角色攻击时，双方牌组顶 3 张送墓',
        steps: [
          { op: 'MILL', count: 3, side: 'SELF' },
          { op: 'MILL', count: 3, side: 'OPPONENT' },
        ],
      },
    ],
  },

  // ==================== 9. 丽芙·极昼 & 赫斯提亚体系 (BP04-071 ~ BP04-075) ====================

  // BP04-071 丽芙·极昼 (4费)
  // 受限点：battlefield-manager.ts airborneRole 与 interpreter.ts SELF_AIRBORNE 当前限制卡牌须在战场，尚不支持手牌【浮空】。
  {
    cardNumber: 'BP04-071',
    name: '丽芙·极昼',
    vanillaEntry: true,
    activates: [
      {
        id: 'hand_airborne',
        label: '【丽芙·极昼】【起】【2费】将手牌的该牌【浮空】',
        usableZones: ['HAND'],
        cost: {
          kind: 'COMPOSITE',
          costs: [{ kind: 'PAY_COST', amount: 2 }, { kind: 'SELF_AIRBORNE' }],
        },
        steps: [],
      },
      {
        id: 'sac_liv_rush',
        label: '【丽芙·极昼】【起】【回合1】可将其他 1 张《丽芙·极昼》送墓，获【速攻】PP+2000（从处理区出场再+2000）',
        usableZones: ['BATTLEFIELD'],
        oncePerTurn: true,
        steps: [
          {
            op: 'CHOOSE_ROLES',
            side: 'SELF',
            prompt: '【丽芙·极昼】【起】可将我方其他 1 张《丽芙·极昼》从战场放置到墓地（不选则不执行）：',
            filter: { exactName: '丽芙·极昼', excludeSelf: true },
            min: 0,
            max: 1,
            saveToVar: 'sacLiv',
            choiceEffectType: 'DSL_BP04_071_SAC',
          },
          {
            op: 'IF',
            condition: { kind: 'VAR_NON_EMPTY', varName: 'sacLiv' },
            then: [
              {
                op: 'MOVE_CARDS',
                target: { kind: 'VAR', varName: 'sacLiv' },
                toZone: 'GRAVEYARD',
                isFaceUp: true,
                sentByEffectOrCost: true,
                saveMovedToVar: 'moved',
              },
              {
                op: 'IF',
                condition: { kind: 'VAR_NON_EMPTY', varName: 'moved' },
                then: [
                  {
                    op: 'MODIFY_STATS',
                    target: { kind: 'SELF' },
                    keywords: ['速攻'],
                    pp: 2000,
                    duration: 'END_OF_TURN',
                  },
                  {
                    op: 'IF',
                    condition: { kind: 'IS_DEPLOYED_FROM_PROCESSING_TURN' },
                    then: [
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
            ],
          },
        ],
      },
    ],
  },

  // BP04-072 丽芙·极昼 (4费)
  {
    cardNumber: 'BP04-072',
    name: '丽芙·极昼',
    vanillaEntry: true,
    handCostDiscount: {
      condition: { kind: 'FRIENDLY_ROLE_COUNT_COMPARE_OPPONENT', op: '<' },
      flatDiscount: 1,
    },
    activate: {
      usableZones: ['BATTLEFIELD'],
      cost: { kind: 'SELF_TO_GRAVEYARD', sentByEffectOrCost: true },
      steps: [
        {
          op: 'CHOOSE_ROLES',
          side: 'SELF',
          prompt: '【丽芙·极昼】【起】选择我方战场 1 张《丽芙·极昼》，直到回合结束获得【贯通】：',
          filter: { exactName: '丽芙·极昼' },
          min: 1,
          max: 1,
          saveToVar: 'liv',
          choiceEffectType: 'DSL_BP04_072_PIERCE',
        },
        {
          op: 'MODIFY_STATS',
          target: { kind: 'VAR', varName: 'liv' },
          keywords: ['贯通'],
          duration: 'END_OF_TURN',
        },
      ],
    },
  },

  // BP04-073 丽芙·极昼 (3费；Q&A·10 仅在战场生效)
  {
    cardNumber: 'BP04-073',
    name: '丽芙·极昼',
    vanillaEntry: true,
    triggers: [
      {
        abilityId: 'dsl:BP04-073:liv_sent_gy_buff',
        eventType: 'CARD_SENT_FIELD_TO_GY_BY_EFFECT',
        oncePerTurn: true,
        matcher: {
          kind: 'ANY_CARD_SENT_FIELD_TO_GY_BY_EFFECT',
          side: 'SELF',
          filter: { cardType: CardType.ROLE, exactName: '丽芙·极昼' },
          includeSelf: false,
        },
        label: '【丽芙·极昼】【自】【回合1】我方《丽芙·极昼》因效果/代价送墓时费用变4、PP+1000、DP+1',
        steps: [
          {
            op: 'MODIFY_STATS',
            target: { kind: 'SELF' },
            setCost: 4,
            pp: 1000,
            dp: 1,
            duration: 'END_OF_TURN',
          },
        ],
      },
    ],
  },

  // BP04-074 丽芙·极昼 (2费)
  {
    cardNumber: 'BP04-074',
    name: '丽芙·极昼',
    vanillaEntry: true,
    activate: {
      usableZones: ['BATTLEFIELD'],
      cost: { kind: 'SELF_TO_GRAVEYARD', sentByEffectOrCost: true },
      steps: [
        { op: 'REVEAL_TOP', count: 4, saveToVar: 'revealed' },
        {
          op: 'CHOOSE_FROM_VAR',
          varName: 'revealed',
          prompt: '【丽芙·极昼】【起】选择其中最多 1 张<灰鸦小队·高级>角色加入手牌（其余放牌组底）：',
          filter: { cardType: CardType.ROLE, trait: '灰鸦小队·高级' },
          alwaysShow: true,
          min: 0,
          max: 1,
          saveToVar: 'kept',
          choiceEffectType: 'DSL_BP04_074_PICK',
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

  // BP04-075 赫斯提亚 (2费 装备)
  // 受限点：
  // 1. SELF_EQUIPPED 缺少 requiredHostName（若场上已存在其他已装备《丽芙·极昼》，非《丽芙·极昼》装备该牌也会触发）；
  // 2. 第 2 项【自】「装备该牌的《丽芙·极昼》因效果或代价从战场送墓时将该牌从墓地出场」需 CardTriggerSnapshot 记录附着装备 ID 及 bringToField 支持 CardType.EQUIPMENT 单独占位出场。
  {
    cardNumber: 'BP04-075',
    name: '赫斯提亚',
    vanillaEntry: true,
    triggers: [
      {
        abilityId: 'dsl:BP04-075:equipped_attack_player',
        eventType: 'CARD_EQUIPPED',
        oncePerTurnByPlayer: true,
        matcher: { kind: 'SELF_EQUIPPED' },
        condition: {
          kind: 'HAS_ROLE',
          side: 'SELF',
          filter: { exactName: '丽芙·极昼', hasEquipment: true },
        },
        label: '【赫斯提亚】【自】《丽芙·极昼》装备该牌时本回合可攻击对方玩家',
        steps: [
          {
            op: 'MODIFY_STATS',
            target: { kind: 'TRIGGER_HOST' },
            canAttackPlayerOnEnterTurn: true,
            duration: 'END_OF_TURN',
          },
        ],
      },
    ],
  },

  // ==================== 10. 含英·清商 & 苍山悠梦境体系 (BP04-076 ~ BP04-080) ====================

  // BP04-076 含英·清商 (6费)
  {
    cardNumber: 'BP04-076',
    name: '含英·清商',
    vanillaEntry: true,
    activate: {
      oncePerTurn: true,
      steps: [
        {
          op: 'CHOOSE_MODE',
          prompt: '【含英·清商】【起】【回合1】请从以下 2 项选择 1 项：',
          choiceEffectType: 'DSL_BP04_076_MODE',
          modes: [
            {
              id: 'equip_leaf_tuck_hanying',
              label: '若为出场回合，手牌/墓地装备《飞叶点翠》，牌组选最多 1 <含英>置<九龙商会>下方，获【速攻】',
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
                      prompt: '【含英·清商】选择我方手牌或墓地 1 张《飞叶点翠》装备到该牌：',
                      filter: { cardType: CardType.EQUIPMENT, exactName: '飞叶点翠' },
                      min: 1,
                      max: 1,
                      saveToVar: 'pickedEq',
                      choiceEffectType: 'DSL_BP04_076_PICK_EQ',
                    },
                    {
                      op: 'IF',
                      condition: { kind: 'VAR_NON_EMPTY', varName: 'pickedEq' },
                      then: [
                        { op: 'EQUIP_FROM_VAR', varName: 'pickedEq', host: { kind: 'SELF' } },
                        {
                          op: 'IF',
                          condition: { kind: 'SELF_MATCHES_FILTER', filter: { hasEquipment: true } },
                          then: [
                            {
                              op: 'CHOOSE_ZONE_CARDS',
                              side: 'SELF',
                              zone: 'DECK',
                              prompt: '【含英·清商】选择我方牌组最多 1 张<含英>角色放置到<九龙商会>角色下方：',
                              filter: { cardType: CardType.ROLE, trait: '含英' },
                              min: 0,
                              max: 1,
                              saveToVar: 'hanying',
                              choiceEffectType: 'DSL_BP04_076_PICK_DECK',
                            },
                            {
                              op: 'IF',
                              condition: { kind: 'VAR_NON_EMPTY', varName: 'hanying' },
                              then: [
                                {
                                  op: 'CHOOSE_ROLES',
                                  side: 'SELF',
                                  prompt: '【含英·清商】选择我方战场 1 张<九龙商会>角色作为宿主：',
                                  filter: { trait: '九龙商会' },
                                  min: 1,
                                  max: 1,
                                  saveToVar: 'host',
                                  choiceEffectType: 'DSL_BP04_076_PICK_HOST',
                                },
                                {
                                  op: 'MOVE_CARDS',
                                  target: { kind: 'VAR', varName: 'hanying' },
                                  toZone: 'UNDERNEATH',
                                  underneathHost: { kind: 'VAR', varName: 'host' },
                                  isFaceUp: true,
                                },
                              ],
                            },
                            { op: 'SHUFFLE_DECK', side: 'SELF' },
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
            {
              id: 'sac_leaf_tap_opp',
              label: '将该牌下方 1 张《飞叶点翠》置墓并消【2任意信号球】：横置对方战场 1 张角色',
              steps: [
                {
                  op: 'IF',
                  condition: {
                    kind: 'SELF_MATCHES_FILTER',
                    filter: { hasUnderneathOrEquipMatching: { exactName: '飞叶点翠' } },
                  },
                  then: [
                    {
                      op: 'ELIMINATE_ORB_COST',
                      filter: 'ANY',
                      count: 2,
                      optional: true,
                      prompt: '【含英·清商】是否消除【2任意信号球】并将下方 1 张《飞叶点翠》置墓，横置对方 1 张角色？',
                      choiceEffectType: 'DSL_BP04_076_ORB_COST',
                      onPaid: [
                        {
                          op: 'CHOOSE_ZONE_CARDS',
                          side: 'SELF',
                          zone: 'HOST_UNDERNEATH',
                          zones: ['HOST_UNDERNEATH', 'BATTLEFIELD'],
                          hostFilter: { exactName: '含英·清商' },
                          prompt: '【含英·清商】选择该牌下方/装备的 1 张《飞叶点翠》放置到墓地：',
                          filter: { exactName: '飞叶点翠', excludeSelf: true },
                          min: 1,
                          max: 1,
                          saveToVar: 'pickedLeaf',
                          choiceEffectType: 'DSL_BP04_076_PICK_LEAF',
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
                              op: 'CHOOSE_ROLES',
                              side: 'OPPONENT',
                              prompt: '【含英·清商】选择对方战场 1 张角色，将其横置：',
                              min: 1,
                              max: 1,
                              saveToVar: 'oppTarget',
                              choiceEffectType: 'DSL_BP04_076_TAP',
                            },
                            { op: 'SET_READY', target: { kind: 'VAR', varName: 'oppTarget' }, isReady: false },
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

  // BP04-077 含英·清商 (4费)
  createHanyingClearSongSpec({
    cardNumber: 'BP04-077',
    orbColor: 'RED',
    deployPayCost: 2,
    deployLabel: '【含英·清商】【起】【红球+2费】从<九龙商会>角色下方出场',
    tuckLabel: '【含英·清商】【起】置入<九龙商会>下方并使宿主本回合获得【贯通】',
    buffStep: (hostVar) => ({
      op: 'MODIFY_STATS',
      target: { kind: 'VAR', varName: hostVar },
      keywords: ['贯通'],
      duration: 'END_OF_TURN',
    }),
  }),

  // BP04-078 含英·清商 (3费)
  createHanyingClearSongSpec({
    cardNumber: 'BP04-078',
    orbColor: 'YELLOW',
    deployPayCost: 1,
    deployLabel: '【含英·清商】【起】【黄球+1费】从<九龙商会>角色下方出场',
    tuckLabel: '【含英·清商】【起】置入<九龙商会>下方并使宿主下回合结束前 PP+2000',
    buffStep: (hostVar) => ({
      op: 'MODIFY_STATS',
      target: { kind: 'VAR', varName: hostVar },
      pp: 2000,
      duration: 'END_OF_NEXT_TURN',
    }),
  }),

  // BP04-079 含英·清商 (2费)
  createHanyingClearSongSpec({
    cardNumber: 'BP04-079',
    orbColor: 'BLUE',
    deployPayCost: 0,
    deployLabel: '【含英·清商】【起】【蓝球】从<九龙商会>角色下方出场',
    tuckLabel: '【含英·清商】【起】置入<九龙商会>下方并使宿主本回合获得【充能+1】',
    buffStep: (hostVar) => ({
      op: 'MODIFY_STATS',
      target: { kind: 'VAR', varName: hostVar },
      charge: 1,
      duration: 'END_OF_TURN',
    }),
  }),

  // BP04-080 苍山悠梦境 (2费 战术)
  {
    cardNumber: 'BP04-080',
    name: '苍山悠梦境',
    tactics: [
      {
        op: 'CHOOSE_ZONE_CARDS',
        side: 'SELF',
        zone: 'HAND',
        zones: ['HAND', 'BATTLEFIELD'],
        prompt: '【苍山悠梦境】可将我方手牌或战场 1 张《飞叶点翠》放置到墓地（不选则不执行）：',
        filter: { exactName: '飞叶点翠' },
        min: 0,
        max: 1,
        saveToVar: 'sacLeaf',
        choiceEffectType: 'DSL_BP04_080_SAC',
      },
      {
        op: 'IF',
        condition: { kind: 'VAR_NON_EMPTY', varName: 'sacLeaf' },
        then: [
          {
            op: 'MOVE_CARDS',
            target: { kind: 'VAR', varName: 'sacLeaf' },
            toZone: 'GRAVEYARD',
            isFaceUp: true,
            sentByEffectOrCost: true,
            saveMovedToVar: 'movedLeaf',
          },
          {
            op: 'IF',
            condition: { kind: 'VAR_NON_EMPTY', varName: 'movedLeaf' },
            then: [
              {
                op: 'CHOOSE_ROLES',
                side: 'SELF',
                prompt: '【苍山悠梦境】选择我方战场 1 张<九龙商会>角色作为宿主：',
                filter: { trait: '九龙商会' },
                min: 1,
                max: 1,
                saveToVar: 'host',
                choiceEffectType: 'DSL_BP04_080_HOST',
              },
              {
                op: 'IF',
                condition: { kind: 'VAR_NON_EMPTY', varName: 'host' },
                then: [
                  {
                    op: 'CHOOSE_ZONE_CARDS',
                    side: 'SELF',
                    zone: 'DECK',
                    prompt: '【苍山悠梦境】选择我方牌组最多 2 张<含英>角色放置到所选<九龙商会>角色下方：',
                    filter: { cardType: CardType.ROLE, trait: '含英' },
                    min: 0,
                    max: 2,
                    saveToVar: 'hanyings',
                    choiceEffectType: 'DSL_BP04_080_PICK',
                  },
                  {
                    op: 'MOVE_CARDS',
                    target: { kind: 'VAR', varName: 'hanyings' },
                    toZone: 'UNDERNEATH',
                    underneathHost: { kind: 'VAR', varName: 'host' },
                    isFaceUp: true,
                  },
                ],
              },
              { op: 'SHUFFLE_DECK', side: 'SELF' },
            ],
          },
        ],
      },
    ],
  },

  // ==================== 11. 信号球战术牌 (BP04-081 ~ BP04-089) ====================
  { cardNumber: 'BP04-081', name: '因果厮杀', isSignalOrbCard: true },
  { cardNumber: 'BP04-082', name: '模仿', isSignalOrbCard: true },
  { cardNumber: 'BP04-083', name: '伟大的爆炸', isSignalOrbCard: true },
  { cardNumber: 'BP04-084', name: '葬礼与动员', isSignalOrbCard: true },
  { cardNumber: 'BP04-085', name: '滚雪', isSignalOrbCard: true },
  { cardNumber: 'BP04-086', name: '站在风吹来的方向', isSignalOrbCard: true },
  { cardNumber: 'BP04-087', name: '遥远的故乡', isSignalOrbCard: true },
  { cardNumber: 'BP04-088', name: '沉默审判', isSignalOrbCard: true },
  { cardNumber: 'BP04-089', name: '三只小熊', isSignalOrbCard: true },
];

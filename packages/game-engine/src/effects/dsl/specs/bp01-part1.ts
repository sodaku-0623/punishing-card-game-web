import { CardType } from '@zhanshuang/shared';
import type { CardEffectSpec, EffectStep } from '../types.js';

const BP01_040_STACK_PAWA_STEPS: EffectStep[] = [
  {
    op: 'DISCARD_COST_STEP',
    count: 1,
    optional: false,
    prompt: '【七实·遥星之座】【起】【回合1】请选择1张手牌丢弃作为代价，将墓地1张《帕瓦》置入该牌下方',
    choiceEffectType: 'PRESET_BP01_040_DISCARD',
    onPaid: [
      { op: 'MARK_TURN_ABILITY_USED', abilityKey: 'BP01_040_STACK' },
      {
        op: 'CHOOSE_ZONE_CARDS',
        side: 'SELF',
        zone: 'GRAVEYARD',
        prompt: '【七实·遥星之座】选择我方墓地1张《帕瓦》，放置到该牌下方',
        filter: { exactName: '帕瓦' },
        min: 1,
        max: 1,
        saveToVar: 'pawa',
        choiceEffectType: 'PRESET_BP01_040_PICK_PAWA',
      },
      {
        op: 'MOVE_CARDS',
        target: { kind: 'VAR', varName: 'pawa' },
        toZone: 'UNDERNEATH',
        underneathHost: { kind: 'SELF' },
      },
    ],
  },
];

const BP01_040_GAME1_DAMAGE_STEPS: EffectStep[] = [
  {
    op: 'ELIMINATE_ORB_COST',
    filter: 'YELLOW',
    count: 2,
    optional: false,
    prompt: '【七实·遥星之座】【起】【游戏1】消除【2黄色信号球】，给予对方1点伤害',
    choiceEffectType: 'PRESET_BP01_040_ORB_COST',
    onPaid: [
      { op: 'MARK_GAME_ABILITY_USED', abilityKey: 'BP01-040-DAMAGE' },
      { op: 'DEAL_DAMAGE', side: 'OPPONENT', amount: 1 },
    ],
  },
];

function makePawaStackActivate(orbCount: 1 | 2): NonNullable<CardEffectSpec['activate']> {
  return {
    condition: {
      kind: 'ALL',
      conditions: [
        { kind: 'SELF_MATCHES_FILTER', filter: { isReady: true } },
        { kind: 'HAS_ROLE', side: 'SELF', filter: { exactName: '七实·遥星之座' } },
      ],
    },
    conditionError: '需要该牌处于竖直状态且我方战场存在《七实·遥星之座》',
    cost: {
      kind: 'ELIMINATE_ORBS',
      filter: 'ANY',
      count: orbCount,
      optional: false,
      prompt: `【帕瓦】【起】选择消除【${orbCount}任意信号球】将自身置入《七实·遥星之座》下方`,
      choiceEffectType: 'PRESET_PAWA_ORB_COST',
    },
    steps: [
      {
        op: 'CHOOSE_ROLES',
        side: 'SELF',
        prompt: '【帕瓦】【起】选择我方战场1张《七实·遥星之座》，将竖直状态的该牌放置到其下方',
        filter: { exactName: '七实·遥星之座' },
        min: 1,
        max: 1,
        saveToVar: 'host',
        choiceEffectType: 'PRESET_PAWA_HOST',
      },
      {
        op: 'MOVE_CARDS',
        target: { kind: 'SELF' },
        toZone: 'UNDERNEATH',
        underneathHost: { kind: 'VAR', varName: 'host' },
      },
    ],
  };
}

/**
 * BP01 第一弹补充包 — 第一批 (47 张)：
 * - 灰鸦小队 (BP01-001 ~ BP01-007, 7 张)
 * - 升格者补充 (BP01-008 ~ BP01-013, 6 张)
 * - 七实·遥星之座 & 帕瓦体系 (BP01-040 ~ BP01-055, 16 张)
 * - 三头犬 & 突击鹰补充 (BP01-069 ~ BP01-077, 9 张)
 * - BP01 全部信号球 (BP01-078 ~ BP01-086, 9 张)
 */
export const BP01_PART1_EFFECT_SPECS: readonly CardEffectSpec[] = [
  // ==================== 1. 灰鸦小队 (BP01-001 ~ BP01-007) ====================
  {
    cardNumber: 'BP01-001',
    name: '露西亚·鸦羽',
    // 【永】：使用该牌时，可以将我方墓地10张<灰鸦小队>加入牌组并洗切。若如此做，该牌可以无视【升变条件「费用上限8及以上」】出场。(由 engine.ts validateAscensionPlan 实现)
    // 【出】消除2同色信号球：公开我方牌组顶5张牌，选择其中任意数量的费用合计为6及以下的<灰鸦小队>角色出场，将剩余的牌按任意顺序放置到牌组底。
    entry: {
      cost: {
        kind: 'ELIMINATE_ORBS',
        filter: 'SAME',
        count: 2,
        optional: true,
        prompt: '【露西亚·鸦羽】【出】是否消除2同色信号球：公开牌组顶5张，选任意数量费用合计<=6的<灰鸦小队>角色出场？',
        choiceEffectType: 'PRESET_BP01_001_ORB_COST',
      },
      steps: [
        { op: 'REVEAL_TOP', count: 5, saveToVar: 'revealed' },
        {
          op: 'CHOOSE_FROM_VAR',
          varName: 'revealed',
          prompt: '【露西亚·鸦羽】【出】选择任意数量费用合计为6及以下的<灰鸦小队>角色出场 (剩余放置到牌组底)',
          filter: { cardType: CardType.ROLE, trait: '灰鸦小队' },
          requireEmptySlot: true,
          maxTotalCost: 6,
          alwaysShow: true,
          min: 0,
          max: 5,
          saveToVar: 'picked',
          choiceEffectType: 'PRESET_BP01_001_PICK',
        },
        { op: 'MOVE_CARDS', target: { kind: 'VAR', varName: 'picked' }, toZone: 'BATTLEFIELD', triggerEntry: true },
        {
          op: 'MOVE_CARDS',
          target: { kind: 'REST_OF_VAR', allVar: 'revealed', excludeVar: 'picked' },
          toZone: 'DECK_BOTTOM',
        },
      ],
    },
  },
  {
    cardNumber: 'BP01-002',
    name: '露西亚·鸦羽',
    // 【永】：若我方战场存在<里>角色和<丽芙>角色，手牌和牌组的该牌的费用-3。
    // 【出】消除2同色信号球：直到回合结束为止，该牌获得【突进】及【充能0】。
    handCostDiscount: {
      condition: {
        kind: 'ALL',
        conditions: [
          { kind: 'HAS_ROLE', side: 'SELF', filter: { trait: '里' } },
          { kind: 'HAS_ROLE', side: 'SELF', filter: { trait: '丽芙' } },
        ],
      },
      flatDiscount: 3,
    },
    entry: {
      cost: {
        kind: 'ELIMINATE_ORBS',
        filter: 'SAME',
        count: 2,
        optional: true,
        prompt: '【露西亚·鸦羽】【出】是否消除2同色信号球：直到回合结束获得【突进】及【充能0】？',
        choiceEffectType: 'PRESET_BP01_002_ORB_COST',
      },
      steps: [
        {
          op: 'MODIFY_STATS',
          target: { kind: 'SELF' },
          keywords: ['突进'],
          setCharge: 0,
          duration: 'END_OF_TURN',
        },
      ],
    },
  },
  {
    cardNumber: 'BP01-003',
    name: '露西亚·鸦羽',
    // 【出】：可以将我方战场1张<灰鸦小队>角色返回手牌。若如此做，选择战场1张费用为5及以下的角色，将其返回手牌。
    entry: {
      steps: [
        {
          op: 'CHOOSE_ROLES',
          side: 'SELF',
          prompt: '【露西亚·鸦羽】【出】可以将我方战场1张<灰鸦小队>角色返回手牌 (不选则不发动)',
          filter: { trait: '灰鸦小队' },
          min: 0,
          max: 1,
          saveToVar: 'selfBounce',
          choiceEffectType: 'BP01_003_BOUNCE_STEP1',
        },
        {
          op: 'MOVE_CARDS',
          target: { kind: 'VAR', varName: 'selfBounce' },
          toZone: 'HAND',
          isFaceUp: true,
          saveMovedToVar: 'actuallyBounced',
        },
        {
          op: 'IF',
          condition: { kind: 'VAR_NON_EMPTY', varName: 'actuallyBounced' },
          then: [
            {
              op: 'CHOOSE_ROLES',
              side: 'ANY',
              prompt: '【露西亚·鸦羽】【出】选择战场1张费用为5及以下的角色，将其返回手牌',
              filter: { maxCost: 5 },
              min: 1,
              max: 1,
              saveToVar: 'anyBounce',
              choiceEffectType: 'BOUNCE_ROLE',
            },
            { op: 'MOVE_CARDS', target: { kind: 'VAR', varName: 'anyBounce' }, toZone: 'HAND', isFaceUp: true },
          ],
        },
      ],
    },
  },
  {
    cardNumber: 'BP01-004',
    name: '露西亚·鸦羽',
    // 【出】丢弃1张手牌：选择我方费用区1张牌，将其加入手牌。
    entry: {
      cost: {
        kind: 'DISCARD_HAND',
        count: 1,
        optional: true,
        prompt: '【露西亚·鸦羽】【出】是否丢弃1张手牌：选择我方费用区1张牌加入手牌？',
        choiceEffectType: 'PRESET_DISCARD_COST',
      },
      steps: [
        {
          op: 'CHOOSE_ZONE_CARDS',
          side: 'SELF',
          zone: 'COST',
          prompt: '【露西亚·鸦羽】【出】选择我方费用区1张牌加入手牌',
          min: 1,
          max: 1,
          saveToVar: 'picked',
          choiceEffectType: 'PRESET_BP01_004_COST',
        },
        { op: 'MOVE_CARDS', target: { kind: 'VAR', varName: 'picked' }, toZone: 'HAND', isFaceUp: true },
      ],
    },
  },
  { cardNumber: 'BP01-005', name: '露西亚·鸦羽', vanillaEntry: true },
  { cardNumber: 'BP01-006', name: '露西亚·鸦羽', vanillaEntry: true },
  {
    cardNumber: 'BP01-007',
    name: '刹那冰华',
    // 【瞬时】：选择我方战场1张<灰鸦小队>角色，直到回合结束为止，其PP+1500。可以追加丢弃任意数量的手牌，每丢弃1张，直到回合结束为止，其PP+1000。
    tactics: [
      {
        op: 'CHOOSE_ROLES',
        side: 'SELF',
        prompt: '【刹那冰华】选择我方战场1张<灰鸦小队>角色，直到回合结束 PP+1500',
        filter: { trait: '灰鸦小队' },
        min: 1,
        max: 1,
        saveToVar: 'target',
        choiceEffectType: 'PRESET_BP01_007_TARGET',
      },
      { op: 'MODIFY_STATS', target: { kind: 'VAR', varName: 'target' }, pp: 1500, duration: 'END_OF_TURN' },
      {
        op: 'IF',
        condition: { kind: 'VAR_NON_EMPTY', varName: 'target' },
        then: [
          {
            op: 'CHOOSE_ZONE_CARDS',
            side: 'SELF',
            zone: 'HAND',
            prompt: '【刹那冰华】可以追加丢弃任意数量手牌，每丢弃1张所选角色再 PP+1000 (不选则不丢弃)',
            min: 0,
            max: 50,
            saveToVar: 'discards',
            choiceEffectType: 'PRESET_BP01_007_DISCARD',
          },
          {
            op: 'MOVE_CARDS',
            target: { kind: 'VAR', varName: 'discards' },
            toZone: 'GRAVEYARD',
            isFaceUp: true,
            saveMovedToVar: 'actuallyDiscarded',
          },
          {
            op: 'IF',
            condition: { kind: 'VAR_NON_EMPTY', varName: 'actuallyDiscarded' },
            then: [
              {
                op: 'MODIFY_STATS',
                target: { kind: 'VAR', varName: 'target' },
                pp: { kind: 'VAR_COUNT_MULT', varName: 'actuallyDiscarded', multiplier: 1000 },
                duration: 'END_OF_TURN',
              },
            ],
          },
        ],
      },
    ],
  },

  // ==================== 2. 升格者补充 (BP01-008 ~ BP01-013) ====================
  {
    cardNumber: 'BP01-008',
    name: '露娜·银冕',
    // 【永】：若我方侵蚀计数为5及以上，我方战场所有<升格者>角色PP+1000。
    // 【自】：该牌攻击时，可以消除【2红色信号球】。若如此做，选择我方战场1张<升格者>角色，直到下个回合结束为止，其获得【充能+1】，PP+2000。
    vanillaEntry: true,
    staticEffects: [
      {
        id: 'BP01_008_ASCENDANT_PP',
        scope: 'ALL_FRIENDLY_ROLES',
        targetFilter: { trait: '升格者' },
        condition: { kind: 'EROSION_COMPARE', side: 'SELF', op: '>=', value: 5 },
        pp: 1000,
        dependsOnTraits: true,
      },
    ],
    triggers: [
      {
        abilityId: 'BP01_008_ATTACK_BUFF',
        eventType: 'ATTACK_DECLARED',
        matcher: { kind: 'SELF_ATTACKING' },
        label: '【露娜·银冕】【自】攻击时可消2红球，使我方1张<升格者>直到下回合结束充能+1且PP+2000',
        cost: {
          kind: 'ELIMINATE_ORBS',
          filter: 'RED',
          count: 2,
          optional: true,
          prompt: '【露娜·银冕】【自】是否消除【2红色信号球】使我方1张<升格者>角色直到下个回合结束充能+1且PP+2000？',
          choiceEffectType: 'PRESET_BP01_008_ORB_COST',
        },
        steps: [
          {
            op: 'CHOOSE_ROLES',
            side: 'SELF',
            prompt: '【露娜·银冕】【自】选择我方战场1张<升格者>角色，直到下个回合结束获得【充能+1】且PP+2000',
            filter: { trait: '升格者' },
            min: 1,
            max: 1,
            saveToVar: 'target',
            choiceEffectType: 'PRESET_BP01_008_TARGET',
          },
          {
            op: 'MODIFY_STATS',
            target: { kind: 'VAR', varName: 'target' },
            pp: 2000,
            charge: 1,
            duration: 'END_OF_NEXT_TURN',
          },
        ],
      },
    ],
  },
  {
    cardNumber: 'BP01-009',
    name: '露娜·银冕',
    // 【永】：【充能0】。
    // 【出】：若我方侵蚀计数为3及以下，可以将我方侵蚀计数+1。若如此做，抽2张牌。
    entry: {
      steps: [
        {
          op: 'IF',
          condition: { kind: 'EROSION_COMPARE', side: 'SELF', op: '<=', value: 3 },
          then: [
            {
              op: 'CONFIRM_YES_NO',
              prompt: '【露娜·银冕】【出】我方侵蚀计数为3及以下：是否将我方侵蚀计数+1并抽2张牌？',
              yesLabel: '侵蚀+1并抽2张',
              noLabel: '不发动',
              choiceEffectType: 'PRESET_BP01_009_CONFIRM',
              onYes: [
                { op: 'CHANGE_EROSION', side: 'SELF', delta: 1 },
                { op: 'DRAW', count: 2 },
              ],
            },
          ],
        },
      ],
    },
  },
  {
    cardNumber: 'BP01-010',
    name: '罗兰·戏炎',
    // 【出】：将我方信号球区的牌按任意顺序排列。
    // 【出】消除2同色信号球：若我方侵蚀计数为4及以上，选择我方战场1张《露娜·银冕》，直到回合结束为止，其获得【贯通】。
    entry: {
      steps: [
        {
          op: 'REORDER_ZONE',
          zone: 'SIGNAL_ORB',
          prompt: '【罗兰·戏炎】【出】请依次点击重新排列我方信号球区（共 {orbCount} 张）',
          choiceEffectType: 'PRESET_BP01_010_REORDER',
        },
        {
          op: 'IF',
          condition: { kind: 'EROSION_COMPARE', side: 'SELF', op: '>=', value: 4 },
          then: [
            {
              op: 'ELIMINATE_ORB_COST',
              filter: 'SAME',
              count: 2,
              optional: true,
              prompt: '【罗兰·戏炎】【出】是否消除2同色信号球，使我方战场1张《露娜·银冕》直到回合结束获得【贯通】？',
              choiceEffectType: 'PRESET_BP01_010_ORB_COST',
              onPaid: [
                {
                  op: 'CHOOSE_ROLES',
                  side: 'SELF',
                  prompt: '【罗兰·戏炎】【出】选择我方战场1张《露娜·银冕》，直到回合结束获得【贯通】',
                  filter: { exactName: '露娜·银冕' },
                  min: 1,
                  max: 1,
                  saveToVar: 'luna',
                  choiceEffectType: 'PRESET_BP01_010_LUNA',
                },
                {
                  op: 'MODIFY_STATS',
                  target: { kind: 'VAR', varName: 'luna' },
                  keywords: ['贯通'],
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
    cardNumber: 'BP01-011',
    name: '冕饵',
    // 【出】：若该回合中我方的侵蚀计数发生过变化，抽1张牌。
    entry: {
      steps: [
        {
          op: 'IF',
          condition: { kind: 'EROSION_CHANGED_THIS_TURN', side: 'SELF' },
          then: [{ op: 'DRAW', count: 1 }],
        },
      ],
    },
  },
  {
    cardNumber: 'BP01-012',
    name: '沃托',
    // 【起】丢弃2张角色&横置该牌：选择我方墓地1张信号球，将其放置到我方信号球区最上方。
    vanillaEntry: true,
    activate: {
      cost: {
        kind: 'TAP_SELF_AND_DISCARD_HAND',
        count: 2,
        filter: { cardType: CardType.ROLE },
        prompt: '【沃托】【起】横置该牌并丢弃2张角色手牌作为代价',
        choiceEffectType: 'PRESET_BP01_012_DISCARD',
      },
      steps: [
        {
          op: 'CHOOSE_ZONE_CARDS',
          side: 'SELF',
          zone: 'GRAVEYARD',
          prompt: '【沃托】【起】选择我方墓地1张信号球，放置到我方信号球区最上方',
          filter: { isSignalOrb: true },
          min: 1,
          max: 1,
          saveToVar: 'orb',
          choiceEffectType: 'PRESET_BP01_012_ORB',
        },
        { op: 'MOVE_CARDS', target: { kind: 'VAR', varName: 'orb' }, toZone: 'SIGNAL_ORB', isFaceUp: true },
      ],
    },
  },
  {
    cardNumber: 'BP01-013',
    name: '终焉降临',
    // 该牌只能在我方战场存在《露娜·银冕》时才能使用。
    // 【瞬时】：若我方侵蚀计数为5及以上，可以消除【2黄色信号球】。若如此做，我方侵蚀计数-1。
    playPrecondition: {
      condition: { kind: 'HAS_ROLE', side: 'SELF', filter: { exactName: '露娜·银冕' } },
      errorMessage: '该牌只能在我方战场存在《露娜·银冕》时才能使用',
    },
    tactics: [
      {
        op: 'IF',
        condition: { kind: 'EROSION_COMPARE', side: 'SELF', op: '>=', value: 5 },
        then: [
          {
            op: 'ELIMINATE_ORB_COST',
            filter: 'YELLOW',
            count: 2,
            optional: true,
            prompt: '【终焉降临】【瞬时】是否消除【2黄色信号球】使我方侵蚀计数-1？',
            choiceEffectType: 'PRESET_BP01_013_ORB_COST',
            onPaid: [{ op: 'CHANGE_EROSION', side: 'SELF', delta: -1 }],
          },
        ],
      },
    ],
  },

  // ==================== 3. 七实·遥星之座 & 帕瓦体系 (BP01-040 ~ BP01-055) ====================
  {
    cardNumber: 'BP01-040',
    name: '七实·遥星之座',
    // 【起】【回合1】丢弃1张手牌：选择我方墓地1张《帕瓦》，将其放置到该牌下方。
    // 【永】：根据该牌下方的牌的数量，该牌获得以下效果。
    // ·2张及以上 【永】：我方回合中，我方战场所有<机械教会>角色PP+1000。
    // ·4张及以上 【永】：该牌的攻击不会被PP为5000及以下的角色阻挡。
    // ·7张及以上 【起】【游戏1】消除【2黄色信号球】：给予对方1点伤害。
    vanillaEntry: true,
    staticEffects: [
      {
        id: 'BP01_040_UNDER2_CHURCH_PP',
        scope: 'ALL_FRIENDLY_ROLES',
        targetFilter: { trait: '机械教会' },
        condition: {
          kind: 'ALL',
          conditions: [
            { kind: 'TURN_OWNER', isSelfTurn: true },
            { kind: 'SELF_UNDERNEATH_COUNT', op: '>=', value: 2 },
          ],
        },
        pp: 1000,
        dependsOnTraits: true,
      },
      {
        id: 'BP01_040_UNDER4_UNBLOCKABLE',
        scope: 'SELF',
        condition: { kind: 'SELF_UNDERNEATH_COUNT', op: '>=', value: 4 },
        unblockableMaxPP: 5000,
      },
    ],
    activate: {
      condition: {
        kind: 'ANY',
        conditions: [
          { kind: 'TURN_ABILITY_UNUSED', abilityKey: 'BP01_040_STACK' },
          {
            kind: 'ALL',
            conditions: [
              { kind: 'SELF_UNDERNEATH_COUNT', op: '>=', value: 7 },
              { kind: 'GAME_ABILITY_UNUSED', abilityKey: 'BP01-040-DAMAGE' },
            ],
          },
        ],
      },
      conditionError: '【七实·遥星之座】当前没有可发动的起动能力',
      steps: [
        {
          op: 'IF',
          condition: {
            kind: 'ALL',
            conditions: [
              { kind: 'TURN_ABILITY_UNUSED', abilityKey: 'BP01_040_STACK' },
              { kind: 'SELF_UNDERNEATH_COUNT', op: '>=', value: 7 },
              { kind: 'GAME_ABILITY_UNUSED', abilityKey: 'BP01-040-DAMAGE' },
            ],
          },
          then: [
            {
              op: 'CHOOSE_MODE',
              prompt: '【七实·遥星之座】选择要发动的起动能力',
              min: 1,
              max: 1,
              choiceEffectType: 'PRESET_BP01_040_MODE',
              modes: [
                {
                  id: 'mode_stack',
                  label: '【回合1】丢弃1张手牌：将墓地1张《帕瓦》置入该牌下方',
                  steps: BP01_040_STACK_PAWA_STEPS,
                },
                {
                  id: 'mode_damage',
                  label: '【游戏1】消除【2黄色信号球】：给予对方1点伤害',
                  steps: BP01_040_GAME1_DAMAGE_STEPS,
                },
              ],
            },
          ],
          else: [
            {
              op: 'IF',
              condition: { kind: 'TURN_ABILITY_UNUSED', abilityKey: 'BP01_040_STACK' },
              then: BP01_040_STACK_PAWA_STEPS,
              else: BP01_040_GAME1_DAMAGE_STEPS,
            },
          ],
        },
      ],
    },
  },
  {
    cardNumber: 'BP01-041',
    name: '七实·遥星之座',
    // 【永】：若该牌下方存在《帕瓦》，则该牌PP+2000。
    // 【出】丢弃1张手牌：选择我方墓地1张费用为3及以下的《帕瓦》，将其出场。
    staticEffects: [
      {
        id: 'BP01_041_UNDER_PAWA_PP',
        scope: 'SELF',
        condition: { kind: 'SELF_UNDERNEATH_COUNT', op: '>=', value: 1, filter: { exactName: '帕瓦' } },
        pp: 2000,
      },
    ],
    entry: {
      cost: {
        kind: 'DISCARD_HAND',
        count: 1,
        optional: true,
        prompt: '【七实·遥星之座】【出】是否丢弃1张手牌：从我方墓地出场1张费用<=3的《帕瓦》？',
        choiceEffectType: 'PRESET_DISCARD_COST',
      },
      steps: [
        {
          op: 'CHOOSE_ZONE_CARDS',
          side: 'SELF',
          zone: 'GRAVEYARD',
          prompt: '【七实·遥星之座】【出】选择我方墓地1张费用为3及以下的《帕瓦》出场',
          filter: { cardType: CardType.ROLE, exactName: '帕瓦', maxCost: 3 },
          requireEmptySlot: true,
          min: 1,
          max: 1,
          saveToVar: 'pawa',
          choiceEffectType: 'PRESET_BP01_041_PAWA',
        },
        { op: 'MOVE_CARDS', target: { kind: 'VAR', varName: 'pawa' }, toZone: 'BATTLEFIELD', triggerEntry: true },
      ],
    },
  },
  {
    cardNumber: 'BP01-042',
    name: '七实·遥星之座',
    // 【永】：若该牌下方存在《帕瓦》，则该牌获得【速攻】。
    vanillaEntry: true,
    staticEffects: [
      {
        id: 'BP01_042_UNDER_PAWA_RUSH',
        scope: 'SELF',
        condition: { kind: 'SELF_UNDERNEATH_COUNT', op: '>=', value: 1, filter: { exactName: '帕瓦' } },
        keywords: ['速攻'],
      },
    ],
  },
  {
    cardNumber: 'BP01-043',
    name: '七实·遥星之座',
    // 【出】：可以将我方战场1张《帕瓦》放置到墓地。若如此做，选择对方战场1张PP为6000及以下的角色，将其破坏。
    entry: {
      steps: [
        {
          op: 'CHOOSE_ROLES',
          side: 'SELF',
          prompt: '【七实·遥星之座】【出】可以将我方战场1张《帕瓦》放置到墓地 (不选则不发动)',
          filter: { exactName: '帕瓦' },
          min: 0,
          max: 1,
          saveToVar: 'sac',
          choiceEffectType: 'PRESET_BP01_043_SAC',
        },
        {
          op: 'MOVE_CARDS',
          target: { kind: 'VAR', varName: 'sac' },
          toZone: 'GRAVEYARD',
          isFaceUp: true,
          saveMovedToVar: 'actuallySac',
        },
        {
          op: 'IF',
          condition: { kind: 'VAR_NON_EMPTY', varName: 'actuallySac' },
          then: [
            {
              op: 'CHOOSE_ROLES',
              side: 'OPPONENT',
              prompt: '【七实·遥星之座】【出】选择对方战场1张PP为6000及以下的角色，将其破坏',
              eligibilityFilter: { maxEffectivePP: 6000 },
              ineligibleReason: 'PP 超过 6000',
              min: 1,
              max: 1,
              saveToVar: 'target',
              choiceEffectType: 'PRESET_BP01_043_DESTROY',
            },
            { op: 'DESTROY_ROLES', target: { kind: 'VAR', varName: 'target' } },
          ],
        },
      ],
    },
  },
  {
    cardNumber: 'BP01-044',
    name: '七实·遥星之座',
    // 【出】丢弃手牌1张《帕瓦》：抽2张牌。
    entry: {
      cost: {
        kind: 'DISCARD_HAND',
        count: 1,
        filter: { exactName: '帕瓦' },
        optional: true,
        prompt: '【七实·遥星之座】【出】是否丢弃手牌1张《帕瓦》以抽2张牌？',
        choiceEffectType: 'PRESET_BP01_044_DISCARD',
      },
      steps: [{ op: 'DRAW', count: 2 }],
    },
  },
  { cardNumber: 'BP01-045', name: '七实·遥星之座', vanillaEntry: true },
  {
    cardNumber: 'BP01-046',
    name: '七实·遥星之座',
    // 【出】：公开我方牌组顶5张牌，选择其中1张《帕瓦》或<机械教会>角色加入手牌，将剩余的牌按任意顺序放置到牌组底。
    entry: {
      steps: [
        { op: 'REVEAL_TOP', count: 5, saveToVar: 'revealed' },
        {
          op: 'CHOOSE_FROM_VAR',
          varName: 'revealed',
          prompt: '【七实·遥星之座】【出】选择其中1张《帕瓦》或<机械教会>角色加入手牌 (剩余放置到牌组底)',
          filter: {
            anyFilters: [{ exactName: '帕瓦' }, { cardType: CardType.ROLE, trait: '机械教会' }],
          },
          alwaysShow: true,
          min: 1,
          max: 1,
          saveToVar: 'picked',
          choiceEffectType: 'PRESET_BP01_046_PICK',
        },
        { op: 'MOVE_CARDS', target: { kind: 'VAR', varName: 'picked' }, toZone: 'HAND', isFaceUp: true },
        {
          op: 'MOVE_CARDS',
          target: { kind: 'REST_OF_VAR', allVar: 'revealed', excludeVar: 'picked' },
          toZone: 'DECK_BOTTOM',
        },
      ],
    },
  },
  { cardNumber: 'BP01-047', name: '七实·遥星之座', vanillaEntry: true },
  { cardNumber: 'BP01-048', name: '七实·遥星之座', vanillaEntry: true },
  {
    cardNumber: 'BP01-049',
    name: '帕瓦',
    // 【永】：该牌不能攻击。
    // 【起】【任意信号球】：选择我方战场1张《七实·遥星之座》，将竖直状态的该牌放置到其下方。
    // 【永】：若该牌存在于《七实·遥星之座》下方，其PP+1000。
    vanillaEntry: true,
    activate: makePawaStackActivate(1),
    staticEffects: [
      {
        id: 'BP01_049_UNDER_NANAMI_PP',
        scope: 'UNDERNEATH_HOST',
        targetFilter: { exactName: '七实·遥星之座' },
        pp: 1000,
      },
    ],
  },
  {
    cardNumber: 'BP01-050',
    name: '帕瓦',
    // 【永】：该牌不能攻击。
    // 【起】【任意信号球】：选择我方战场1张《七实·遥星之座》，将竖直状态的该牌放置到其下方。
    // 【永】：若该牌存在于《七实·遥星之座》下方，其获得【充能+1】。
    vanillaEntry: true,
    activate: makePawaStackActivate(1),
    staticEffects: [
      {
        id: 'BP01_050_UNDER_NANAMI_CHARGE',
        scope: 'UNDERNEATH_HOST',
        targetFilter: { exactName: '七实·遥星之座' },
        charge: 1,
      },
    ],
  },
  {
    cardNumber: 'BP01-051',
    name: '帕瓦',
    // 【永】：该牌不能攻击。
    // 【起】【2任意信号球】：选择我方战场1张《七实·遥星之座》，将竖直状态的该牌放置到其下方。
    // 【永】：若该牌存在于基本DP为1及以下的《七实·遥星之座》下方，其基本DP+1。
    vanillaEntry: true,
    activate: makePawaStackActivate(2),
    staticEffects: [
      {
        id: 'BP01_051_UNDER_NANAMI_DP',
        scope: 'UNDERNEATH_HOST',
        targetFilter: { exactName: '七实·遥星之座', maxBaseDP: 1 },
        dp: 1,
      },
    ],
  },
  {
    cardNumber: 'BP01-052',
    name: '帕瓦',
    // 【永】：【充能0】。
    // 【起】【任意信号球】：选择我方战场1张《七实·遥星之座》，将竖直状态的该牌放置到其下方。
    vanillaEntry: true,
    activate: makePawaStackActivate(1),
  },
  {
    cardNumber: 'BP01-053',
    name: '七实·遥星之座',
    // 【出】：选择我方墓地1张信号球，将其放置到我方信号球区最上方。
    entry: {
      steps: [
        {
          op: 'CHOOSE_ZONE_CARDS',
          side: 'SELF',
          zone: 'GRAVEYARD',
          prompt: '【七实·遥星之座】【出】选择我方墓地1张信号球，放置到我方信号球区最上方',
          filter: { isSignalOrb: true },
          min: 1,
          max: 1,
          saveToVar: 'orb',
          choiceEffectType: 'PRESET_BP01_053_ORB',
        },
        { op: 'MOVE_CARDS', target: { kind: 'VAR', varName: 'orb' }, toZone: 'SIGNAL_ORB', isFaceUp: true },
      ],
    },
  },
  {
    cardNumber: 'BP01-054',
    name: '万兆创星',
    // 选择对方战场1张PP为6000及以下的角色，将其破坏。若我方战场存在《七实·遥星之座》升变角色，改为选择对方战场1张角色，将其破坏。
    tactics: [
      {
        op: 'IF',
        condition: {
          kind: 'HAS_ROLE',
          side: 'SELF',
          filter: { exactName: '七实·遥星之座', isAscended: true },
        },
        then: [
          {
            op: 'CHOOSE_ROLES',
            side: 'OPPONENT',
            prompt: '【万兆创星】存在《七实·遥星之座》升变角色：选择对方战场1张角色，将其破坏',
            min: 1,
            max: 1,
            saveToVar: 'target',
            choiceEffectType: 'PRESET_BP01_054_DESTROY',
          },
          { op: 'DESTROY_ROLES', target: { kind: 'VAR', varName: 'target' } },
        ],
        else: [
          {
            op: 'CHOOSE_ROLES',
            side: 'OPPONENT',
            prompt: '【万兆创星】选择对方战场1张PP为6000及以下的角色，将其破坏',
            eligibilityFilter: { maxEffectivePP: 6000 },
            ineligibleReason: 'PP 超过 6000',
            min: 1,
            max: 1,
            saveToVar: 'target',
            choiceEffectType: 'PRESET_BP01_054_DESTROY',
          },
          { op: 'DESTROY_ROLES', target: { kind: 'VAR', varName: 'target' } },
        ],
      },
    ],
  },
  {
    cardNumber: 'BP01-055',
    name: '七实-未来',
    // 公开我方牌组1张费用为6及以上的《七实·遥星之座》升变角色。选择我方战场1张费用为6以下的《七实·遥星之座》和1张《帕瓦》。
    // 我方可以无视【升变条件】，不支付【升变代价】在其上方升变出场因此方法公开的升变角色。
    tactics: [
      {
        op: 'CHOOSE_ZONE_CARDS',
        side: 'SELF',
        zone: 'DECK',
        prompt: '【七实-未来】从我方牌组选择1张费用为6及以上的《七实·遥星之座》升变角色',
        filter: { cardType: CardType.ROLE, exactName: '七实·遥星之座', minCost: 6, isAscended: true },
        min: 0,
        max: 1,
        saveToVar: 'ascCard',
        choiceEffectType: 'PRESET_BP01_055_DECK',
      },
      {
        op: 'IF',
        condition: { kind: 'VAR_NON_EMPTY', varName: 'ascCard' },
        then: [
          {
            op: 'CHOOSE_ROLES',
            side: 'SELF',
            prompt: '【七实-未来】选择我方战场1张费用为6以下的《七实·遥星之座》作为升变对象',
            filter: { exactName: '七实·遥星之座', maxCost: 5 },
            min: 1,
            max: 1,
            saveToVar: 'baseRole',
            choiceEffectType: 'PRESET_BP01_055_BASE',
          },
          {
            op: 'CHOOSE_ROLES',
            side: 'SELF',
            prompt: '【七实-未来】选择我方战场1张《帕瓦》一并叠置到下方',
            filter: { exactName: '帕瓦' },
            min: 1,
            max: 1,
            saveToVar: 'pawaRole',
            choiceEffectType: 'PRESET_BP01_055_PAWA',
          },
          {
            op: 'IF',
            condition: {
              kind: 'ALL',
              conditions: [
                { kind: 'VAR_NON_EMPTY', varName: 'baseRole' },
                { kind: 'VAR_NON_EMPTY', varName: 'pawaRole' },
              ],
            },
            then: [
              {
                op: 'ASCEND_FROM_VAR',
                cardVar: 'ascCard',
                targetVar: 'baseRole',
                extraStackVar: 'pawaRole',
                shuffleDeckAfter: true,
              },
            ],
            else: [{ op: 'SHUFFLE_DECK', side: 'SELF' }],
          },
        ],
        else: [{ op: 'SHUFFLE_DECK', side: 'SELF' }],
      },
    ],
  },

  // ==================== 4. 三头犬 & 突击鹰补充 (BP01-069 ~ BP01-077) ====================
  {
    cardNumber: 'BP01-069',
    name: '薇拉·瑰丽',
    // 【永】：若我方战场存在<21号>角色或<诺克提>角色，该牌PP+2000。
    // 【出】横置我方战场1张<21号>角色或<诺克提>角色：直到回合结束为止，该牌获得【速攻】。
    staticEffects: [
      {
        id: 'BP01_069_CERBERUS_PP',
        scope: 'SELF',
        condition: { kind: 'HAS_ROLE', side: 'SELF', filter: { anyTraits: ['21号', '诺克提'] } },
        pp: 2000,
        dependsOnTraits: true,
      },
    ],
    entry: {
      steps: [
        {
          op: 'CHOOSE_ROLES',
          side: 'SELF',
          prompt: '【薇拉·瑰丽】【出】可以横置我方战场1张竖直的<21号>或<诺克提>角色以获得【速攻】 (不选则不发动)',
          filter: { anyTraits: ['21号', '诺克提'], isReady: true },
          min: 0,
          max: 1,
          saveToVar: 'tapped',
          choiceEffectType: 'PRESET_BP01_069_TAP',
        },
        {
          op: 'IF',
          condition: { kind: 'VAR_NON_EMPTY', varName: 'tapped' },
          then: [
            { op: 'SET_READY', target: { kind: 'VAR', varName: 'tapped' }, isReady: false },
            { op: 'MODIFY_STATS', target: { kind: 'SELF' }, keywords: ['速攻'], duration: 'END_OF_TURN' },
          ],
        },
      ],
    },
  },
  {
    cardNumber: 'BP01-070',
    name: '诺克提·擎驱',
    // 【永】：若我方战场存在<薇拉>角色或<21号>角色，该牌可以无视属性条件使用。
    // 【起】【回合1】【1费】：若我方战场的<三头犬小队>角色为3张及以上，将我方信号球区的牌按任意顺序排列。
    vanillaEntry: true,
    ignoreAttributeCondition: {
      kind: 'HAS_ROLE',
      side: 'SELF',
      filter: { anyTraits: ['薇拉', '21号'] },
    },
    activate: {
      oncePerTurn: true,
      condition: { kind: 'HAS_ROLE', side: 'SELF', filter: { trait: '三头犬小队' }, minCount: 3 },
      conditionError: '需要我方战场存在3张及以上<三头犬小队>角色才能发动',
      cost: { kind: 'PAY_COST', amount: 1 },
      steps: [
        {
          op: 'REORDER_ZONE',
          zone: 'SIGNAL_ORB',
          prompt: '【诺克提·擎驱】【起】请依次点击重新排列我方信号球区（共 {orbCount} 张）',
          choiceEffectType: 'PRESET_BP01_070_REORDER',
        },
      ],
    },
  },
  {
    cardNumber: 'BP01-071',
    name: '死神与无色',
    // 【瞬时】：我方玩家被攻击时才能发动。若我方战场存在横置状态的<三头犬小队>角色，那次攻击不能造成伤害。
    tactics: [
      {
        op: 'IF',
        condition: { kind: 'HAS_ROLE', side: 'SELF', filter: { trait: '三头犬小队', isReady: false } },
        then: [{ op: 'PREVENT_COMBAT_DAMAGE' }],
      },
    ],
  },
  { cardNumber: 'BP01-072', name: '沙利叶', vanillaEntry: true },
  {
    cardNumber: 'BP01-073',
    name: '库洛姆·荣光',
    // 【自】【回合1】：我方战场1张角色阻挡时，直到回合结束为止，其PP+1000。
    // 【起】【回合1】消除2同色信号球：选择我方手牌1张费用不大于我方明费上限的<突击鹰小队>角色，将其出场。直到回合结束为止，其获得“【永】：不能攻击”。
    vanillaEntry: true,
    triggers: [
      {
        abilityId: 'BP01_073_BLOCK_PP',
        eventType: 'BLOCK_DECLARED',
        oncePerTurn: true,
        matcher: { kind: 'FRIENDLY_ROLE_BLOCKING', sourceKind: 'ROLE' },
        label: '【库洛姆·荣光】【自】我方角色阻挡时直到回合结束 PP+1000',
        steps: [
          {
            op: 'MODIFY_STATS',
            target: { kind: 'TRIGGER_BLOCKER' },
            pp: 1000,
            duration: 'END_OF_TURN',
          },
        ],
      },
    ],
    activate: {
      oncePerTurn: true,
      cost: {
        kind: 'ELIMINATE_ORBS',
        filter: 'SAME',
        count: 2,
        optional: false,
        prompt: '【库洛姆·荣光】【起】选择消除2同色信号球，从手牌出场费用<=明费上限的<突击鹰小队>角色',
        choiceEffectType: 'PRESET_BP01_073_ORB_COST',
      },
      steps: [
        {
          op: 'CHOOSE_ZONE_CARDS',
          side: 'SELF',
          zone: 'HAND',
          prompt: '【库洛姆·荣光】【起】选择我方手牌1张费用不大于明费上限的<突击鹰小队>角色出场 (本回合不能攻击)',
          filter: { cardType: CardType.ROLE, trait: '突击鹰小队', maxCostOpenCostLimit: true },
          requireEmptySlot: true,
          min: 1,
          max: 1,
          saveToVar: 'deployed',
          choiceEffectType: 'PRESET_BP01_073_DEPLOY',
        },
        {
          op: 'MOVE_CARDS',
          target: { kind: 'VAR', varName: 'deployed' },
          toZone: 'BATTLEFIELD',
          triggerEntry: true,
          saveMovedToVar: 'actuallyDeployed',
        },
        {
          op: 'MODIFY_STATS',
          target: { kind: 'VAR', varName: 'actuallyDeployed' },
          prohibitions: ['CANNOT_ATTACK'],
          duration: 'END_OF_TURN',
        },
      ],
    },
  },
  { cardNumber: 'BP01-074', name: '库洛姆·荣光', vanillaEntry: true },
  {
    cardNumber: 'BP01-075',
    name: '神威·重能',
    // 【出】【2任意信号球】：选择对方战场1张费用为3及以下的角色，将其横置。
    entry: {
      cost: {
        kind: 'ELIMINATE_ORBS',
        filter: 'ANY',
        count: 2,
        optional: true,
        prompt: '【神威·重能】【出】是否消除【2任意信号球】将对方战场1张费用为3及以下的角色横置？',
        choiceEffectType: 'PRESET_BP01_075_ORB_COST',
      },
      steps: [
        {
          op: 'CHOOSE_ROLES',
          side: 'OPPONENT',
          prompt: '【神威·重能】【出】选择对方战场1张费用为3及以下的角色，将其横置',
          filter: { maxCost: 3 },
          min: 1,
          max: 1,
          saveToVar: 'target',
          choiceEffectType: 'PRESET_BP01_075_TAP',
        },
        { op: 'SET_READY', target: { kind: 'VAR', varName: 'target' }, isReady: false },
      ],
    },
  },
  {
    cardNumber: 'BP01-076',
    name: '卡穆·狂犬',
    // 【永】：【充能0】。
    // 【永】：若我方战场存在<突击鹰小队>角色，该牌可以无视属性条件使用。
    // 【起】将该牌从战场放置到牌组底：选择我方墓地1张<突击鹰小队>角色，将其加入手牌。
    vanillaEntry: true,
    ignoreAttributeCondition: {
      kind: 'HAS_ROLE',
      side: 'SELF',
      filter: { trait: '突击鹰小队' },
    },
    activate: {
      cost: { kind: 'SELF_TO_DECK_BOTTOM' },
      steps: [
        {
          op: 'CHOOSE_ZONE_CARDS',
          side: 'SELF',
          zone: 'GRAVEYARD',
          prompt: '【卡穆·狂犬】【起】选择我方墓地1张<突击鹰小队>角色加入手牌',
          filter: { cardType: CardType.ROLE, trait: '突击鹰小队' },
          min: 1,
          max: 1,
          saveToVar: 'picked',
          choiceEffectType: 'PRESET_BP01_076_PICK',
        },
        { op: 'MOVE_CARDS', target: { kind: 'VAR', varName: 'picked' }, toZone: 'HAND', isFaceUp: true },
      ],
    },
  },
  {
    cardNumber: 'BP01-077',
    name: '万事·明觉',
    // 【永】：我方每回合使用的第1张《荣光护盾》的费用变为1。
    vanillaEntry: true,
    fieldCardCostRule: {
      targetName: '荣光护盾',
      firstPerTurnOnly: true,
      setCost: 1,
    },
  },

  // ==================== 5. BP01 全部 9 张信号球 (BP01-078 ~ BP01-086) ====================
  { cardNumber: 'BP01-078', name: '星际中的思考', isSignalOrbCard: true },
  { cardNumber: 'BP01-079', name: '第五次交锋', isSignalOrbCard: true },
  { cardNumber: 'BP01-080', name: '无忧无虑大作战', isSignalOrbCard: true },
  { cardNumber: 'BP01-081', name: '桎梏与囚笼', isSignalOrbCard: true },
  { cardNumber: 'BP01-082', name: '漫长的电话', isSignalOrbCard: true },
  { cardNumber: 'BP01-083', name: '无人观看的斯丁格', isSignalOrbCard: true },
  { cardNumber: 'BP01-084', name: '解开项圈', isSignalOrbCard: true },
  { cardNumber: 'BP01-085', name: '医鸮', isSignalOrbCard: true },
  { cardNumber: 'BP01-086', name: '如你', isSignalOrbCard: true },
];

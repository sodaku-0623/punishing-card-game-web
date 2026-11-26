import { describe, expect, it } from 'vitest';
import { CardType, ElementAttribute, TriggerEventType } from '@zhanshuang/shared';
import { OFFICIAL_STARTER_DECKS } from '@zhanshuang/game-rules';
import {
  BP04_EFFECT_SPECS,
  CardEffectSpec,
  DeclarativeEffectInterpreter,
  GameEngine,
  MemoryCardDatabase,
  OFFICIAL_CARDS_DATA,
  STARTER_DECK_EFFECT_SPECS,
  addCardModifier,
  validateCardEffectRegistry,
  validateCardEffectSpec,
} from '../src/index.js';
import { endTurn, fillCostZone, passInstantWindows, resolvePendingChoices } from './helpers.js';

const db = new MemoryCardDatabase(OFFICIAL_CARDS_DATA);

function expandDeck(code: 'ST01' | 'ST02' | 'ST03' = 'ST01', extras: string[] = []): string[] {
  const deck = OFFICIAL_STARTER_DECKS.find((d) => d.name.includes(code));
  if (!deck) {
    throw new Error(`未找到预组 ${code}`);
  }
  const base = deck.cards.flatMap((entry) => Array.from({ length: entry.count }, () => entry.cardNumber));
  return [...extras, ...base.slice(0, Math.max(0, 50 - extras.length))];
}

function createEngine(p1Deck: string[], p2Deck: string[], seed = 20261125): GameEngine {
  const engine = new GameEngine(
    'stage4a-test',
    { playerId: 'p1', deckCardNumbers: p1Deck },
    { playerId: 'p2', deckCardNumbers: p2Deck },
    seed,
    db
  );
  const state = engine.getState();
  if (state.phase === 'DRAW_CHARGE_PHASE') {
    engine.dispatchAction({ type: 'PASS_ACTION_TIMING', playerId: state.activePlayerId });
  }
  return engine;
}

/** 推进至第 3 回合（先攻 p1 的第二个主要阶段），绕过 7.1.1 首回合不可攻击与出场当回合限制 */
function advanceToP1AttackableMainPhase(engine: GameEngine): void {
  endTurn(engine); // p1 T1 -> p2 T2
  endTurn(engine); // p2 T2 -> p1 T3
  resolvePendingChoices(engine);
  const state = engine.getState();
  if (state.phase === 'DRAW_CHARGE_PHASE') {
    engine.dispatchAction({ type: 'PASS_ACTION_TIMING', playerId: state.activePlayerId });
  }
  resolvePendingChoices(engine);
}

function makeBaseSpec(overrides: Partial<CardEffectSpec> = {}): CardEffectSpec {
  return {
    cardNumber: 'TEST-001',
    name: '测试卡',
    ...overrides,
  };
}

describe('Stage 4A-1: DSL 校验加固、死代码清理与引擎修复', () => {
  it('1. validateCardEffectRegistry 全表 490 卡 0 错误（含 4 张 activate.steps=[] 浮空卡）', () => {
    expect(STARTER_DECK_EFFECT_SPECS.length).toBe(490);
    const registry = validateCardEffectRegistry(STARTER_DECK_EFFECT_SPECS, db);
    expect(registry.size).toBe(490);

    for (const cardNum of ['BP03-001', 'BP03-006', 'BP03-008']) {
      const spec = registry.get(cardNum);
      expect(spec).toBeDefined();
      expect(spec?.activate?.steps).toEqual([]);
    }
    const bp04071 = registry.get('BP04-071');
    expect(bp04071).toBeDefined();
    expect(bp04071?.activates?.[0]?.steps).toEqual([]);
  });

  describe('2. 校验器负例：每项新增校验均准确抛错', () => {
    it('setCardType 枚举校验 (MODIFY_STATS 与 staticEffects)', () => {
      expect(() =>
        validateCardEffectSpec(
          makeBaseSpec({
            tactics: [
              {
                op: 'MODIFY_STATS',
                target: { kind: 'SELF' },
                setCardType: 'INVALID_TYPE' as unknown as CardType,
                duration: 'END_OF_TURN',
              },
            ],
          })
        )
      ).toThrow(/setCardType 非法/);

      expect(() =>
        validateCardEffectSpec(
          makeBaseSpec({
            staticEffects: [
              {
                id: 'test:static:bad_type',
                scope: 'SELF',
                setCardType: 'BAD_TYPE' as unknown as CardType,
              },
            ],
          })
        )
      ).toThrow(/setCardType 非法/);
    });

    it('treatedAsOrbColors / prohibitions / treatedAsNames / keywords / addTraits / grantedTriggerIds', () => {
      expect(() =>
        validateCardEffectSpec(
          makeBaseSpec({
            staticEffects: [{ id: 's1', scope: 'SELF', treatedAsOrbColors: [] }],
          })
        )
      ).toThrow(/treatedAsOrbColors 必须是非空数组/);

      expect(() =>
        validateCardEffectSpec(
          makeBaseSpec({
            tactics: [
              {
                op: 'MODIFY_STATS',
                target: { kind: 'SELF' },
                treatedAsOrbColors: ['GREEN' as unknown as 'RED'],
                duration: 'END_OF_TURN',
              },
            ],
          })
        )
      ).toThrow(/treatedAsOrbColors 非法颜色/);

      expect(() =>
        validateCardEffectSpec(
          makeBaseSpec({
            staticEffects: [{ id: 's2', scope: 'SELF', prohibitions: [] }],
          })
        )
      ).toThrow(/prohibitions 必须是非空数组/);

      expect(() =>
        validateCardEffectSpec(
          makeBaseSpec({
            tactics: [
              {
                op: 'MODIFY_STATS',
                target: { kind: 'SELF' },
                prohibitions: ['CANNOT_WIN' as unknown as 'CANNOT_ATTACK'],
                duration: 'END_OF_TURN',
              },
            ],
          })
        )
      ).toThrow(/prohibitions 非法值/);

      for (const field of ['treatedAsNames', 'keywords', 'addTraits', 'grantedTriggerIds'] as const) {
        expect(() =>
          validateCardEffectSpec(
            makeBaseSpec({
              staticEffects: [{ id: `s-${field}-empty`, scope: 'SELF', [field]: [] }],
            })
          )
        ).toThrow(new RegExp(`${field} 必须是非空字符串数组`));

        expect(() =>
          validateCardEffectSpec(
            makeBaseSpec({
              tactics: [
                {
                  op: 'MODIFY_STATS',
                  target: { kind: 'SELF' },
                  [field]: [''],
                  duration: 'END_OF_TURN',
                },
              ],
            })
          )
        ).toThrow(new RegExp(`${field}\\[0\\] 必须是非空字符串`));
      }
    });

    it('validateCardEffectRegistry 交叉校验未注册的 grantedTriggerIds', () => {
      expect(() =>
        validateCardEffectRegistry([
          makeBaseSpec({
            cardNumber: 'TEST-STATIC-GRANT',
            staticEffects: [
              {
                id: 's-missing-trig',
                scope: 'EQUIPPED_HOST',
                grantedTriggerIds: ['NON_EXISTENT_TRIGGER'],
              },
            ],
          }),
        ])
      ).toThrow(/引用了未注册的自动能力 ID: "NON_EXISTENT_TRIGGER"/);

      expect(() =>
        validateCardEffectRegistry([
          makeBaseSpec({
            cardNumber: 'TEST-STEP-GRANT',
            entry: {
              steps: [
                {
                  op: 'IF',
                  condition: { kind: 'IS_ENTER_TURN' },
                  then: [
                    {
                      op: 'MODIFY_STATS',
                      target: { kind: 'SELF' },
                      grantedTriggerIds: ['NON_EXISTENT_STEP_TRIGGER'],
                      duration: 'END_OF_TURN',
                    },
                  ],
                },
              ],
            },
          }),
        ])
      ).toThrow(/引用了未注册的自动能力 ID: "NON_EXISTENT_STEP_TRIGGER"/);
    });

    it('fieldIgnoreAttributeRule / playSacrificeDiscount / fieldCardCostRule / playDiscardDiscount', () => {
      expect(() =>
        validateCardEffectSpec(
          makeBaseSpec({
            fieldIgnoreAttributeRule: { zones: [] },
          })
        )
      ).toThrow(/fieldIgnoreAttributeRule\.zones 不能为空/);

      expect(() =>
        validateCardEffectSpec(
          makeBaseSpec({
            fieldIgnoreAttributeRule: { zones: ['HAND' as unknown as 'BATTLEFIELD'] },
          })
        )
      ).toThrow(/fieldIgnoreAttributeRule\.zones 非法值/);

      expect(() =>
        validateCardEffectSpec(
          makeBaseSpec({
            fieldIgnoreAttributeRule: { zones: ['BATTLEFIELD'], targetTrait: '  ' },
          })
        )
      ).toThrow(/targetTrait 必须是非空字符串/);

      expect(() =>
        validateCardEffectSpec(
          makeBaseSpec({
            fieldIgnoreAttributeRule: {
              zones: ['COST'],
              onlyAscensionRoles: 'true' as unknown as boolean,
            },
          })
        )
      ).toThrow(/onlyAscensionRoles 必须是布尔值/);

      // playSacrificeDiscount 收紧至 HAND | BATTLEFIELD
      expect(() =>
        validateCardEffectSpec(
          makeBaseSpec({
            playSacrificeDiscount: {
              zones: [],
              filter: { cardType: CardType.ROLE },
              discount: 2,
            },
          })
        )
      ).toThrow(/playSacrificeDiscount\.zones 不能为空/);

      expect(() =>
        validateCardEffectSpec(
          makeBaseSpec({
            playSacrificeDiscount: {
              zones: ['GRAVEYARD' as unknown as 'HAND'],
              filter: { cardType: CardType.ROLE },
              discount: 2,
            },
          })
        )
      ).toThrow(/playSacrificeDiscount\.zones 非法值/);

      expect(() =>
        validateCardEffectSpec(
          makeBaseSpec({
            playSacrificeDiscount: {
              zones: ['HAND'],
              filter: { cardType: CardType.ROLE },
              setCost: -1,
            },
          })
        )
      ).toThrow(/playSacrificeDiscount\.setCost/);

      expect(() =>
        validateCardEffectSpec(
          makeBaseSpec({
            playSacrificeDiscount: {
              zones: ['BATTLEFIELD'],
              filter: { cardType: CardType.ROLE },
              discount: 0,
            },
          })
        )
      ).toThrow(/playSacrificeDiscount\.discount/);

      // fieldCardCostRule
      expect(() =>
        validateCardEffectSpec(
          makeBaseSpec({
            fieldCardCostRule: { setCost: -1 },
          })
        )
      ).toThrow(/fieldCardCostRule\.setCost/);

      expect(() =>
        validateCardEffectSpec(
          makeBaseSpec({
            fieldCardCostRule: { discount: 0 },
          })
        )
      ).toThrow(/fieldCardCostRule\.discount/);

      expect(() =>
        validateCardEffectSpec(
          makeBaseSpec({
            fieldCardCostRule: { cardType: 'BOGUS' as unknown as CardType, discount: 1 },
          })
        )
      ).toThrow(/fieldCardCostRule\.cardType 非法/);

      // playDiscardDiscount
      expect(() =>
        validateCardEffectSpec(
          makeBaseSpec({
            playDiscardDiscount: {
              sourceZone: 'GRAVEYARD' as unknown as 'HAND',
              filter: {},
              discountPerCard: 1,
            },
          })
        )
      ).toThrow(/playDiscardDiscount\.sourceZone 非法/);

      expect(() =>
        validateCardEffectSpec(
          makeBaseSpec({
            playDiscardDiscount: {
              sourceZone: 'SIGNAL_ORB',
              signalOrbColor: 'GREEN' as unknown as 'RED',
              filter: {},
              discountPerCard: 1,
            },
          })
        )
      ).toThrow(/playDiscardDiscount\.signalOrbColor 非法/);
    });

    it('entry/entries 与 activate/activates 互斥及空数组校验', () => {
      expect(() =>
        validateCardEffectSpec(
          makeBaseSpec({
            entry: { steps: [{ op: 'DRAW', count: 1 }] },
            entries: [],
          })
        )
      ).toThrow(/不能同时配置 entry 与 entries/);

      expect(() =>
        validateCardEffectSpec(
          makeBaseSpec({
            entries: [],
          })
        )
      ).toThrow(/entries 不能为空/);

      expect(() =>
        validateCardEffectSpec(
          makeBaseSpec({
            activate: { steps: [] },
            activates: [],
          })
        )
      ).toThrow(/不能同时配置 activate 与 activates/);
    });

    it('validateFilter 枚举与非负整数边界校验', () => {
      expect(() =>
        validateCardEffectSpec(
          makeBaseSpec({
            tactics: [
              {
                op: 'CHOOSE_ROLES',
                side: 'OPPONENT',
                prompt: '选1张',
                filter: { cardType: 'BOGUS' as unknown as CardType },
                saveToVar: 't',
              },
            ],
          })
        )
      ).toThrow(/cardType 非法/);

      expect(() =>
        validateCardEffectSpec(
          makeBaseSpec({
            tactics: [
              {
                op: 'CHOOSE_ROLES',
                side: 'OPPONENT',
                prompt: '选1张',
                filter: { attribute: 'WIND' as unknown as ElementAttribute },
                saveToVar: 't',
              },
            ],
          })
        )
      ).toThrow(/attribute 非法/);

      expect(() =>
        validateCardEffectSpec(
          makeBaseSpec({
            tactics: [
              {
                op: 'CHOOSE_ROLES',
                side: 'OPPONENT',
                prompt: '选1张',
                filter: { excludeAttribute: 'WIND' as unknown as ElementAttribute },
                saveToVar: 't',
              },
            ],
          })
        )
      ).toThrow(/excludeAttribute 非法/);

      expect(() =>
        validateCardEffectSpec(
          makeBaseSpec({
            tactics: [
              {
                op: 'CHOOSE_ZONE_CARDS',
                side: 'SELF',
                zone: 'SIGNAL_ORB',
                prompt: '选1张',
                filter: { signalOrbColor: 'PURPLE' as unknown as 'RED' },
                saveToVar: 'o',
              },
            ],
          })
        )
      ).toThrow(/signalOrbColor 非法/);

      expect(() =>
        validateCardEffectSpec(
          makeBaseSpec({
            tactics: [
              {
                op: 'CHOOSE_ROLES',
                side: 'SELF',
                prompt: '选1张',
                filter: { inZone: 'NOWHERE' as unknown as 'BATTLEFIELD' },
                saveToVar: 't',
              },
            ],
          })
        )
      ).toThrow(/inZone 非法/);

      for (const numField of [
        'minCost',
        'maxCost',
        'exactCost',
        'maxBaseDP',
        'minEffectivePP',
        'maxEffectivePP',
      ] as const) {
        expect(() =>
          validateCardEffectSpec(
            makeBaseSpec({
              tactics: [
                {
                  op: 'CHOOSE_ROLES',
                  side: 'SELF',
                  prompt: '选1张',
                  filter: { [numField]: -1 },
                  saveToVar: 't',
                },
              ],
            })
          )
        ).toThrow(new RegExp(`${numField} 必须是 >= 0 的整数`));
      }
    });

    it('validateTrigger 深度校验 & 其余小漏检', () => {
      expect(() =>
        validateCardEffectSpec(
          makeBaseSpec({
            triggers: [
              {
                abilityId: 't:bad_ev',
                eventType: 'UNKNOWN_EVENT' as unknown as TriggerEventType,
                matcher: { kind: 'SELF_ATTACKING' },
                label: 'bad',
                steps: [{ op: 'DRAW', count: 1 }],
              },
            ],
          })
        )
      ).toThrow(/eventType 非法/);

      expect(() =>
        validateCardEffectSpec(
          makeBaseSpec({
            triggers: [
              {
                abilityId: 't:bad_evs',
                eventType: 'ATTACK_DECLARED',
                eventTypes: ['BOGUS_EVENT' as unknown as TriggerEventType],
                matcher: { kind: 'SELF_ATTACKING' },
                label: 'bad',
                steps: [{ op: 'DRAW', count: 1 }],
              },
            ],
          })
        )
      ).toThrow(/eventTypes\[0\] 非法/);

      expect(() =>
        validateCardEffectSpec(
          makeBaseSpec({
            triggers: [
              {
                abilityId: 't:zero_max',
                eventType: 'ATTACK_DECLARED',
                maxPerTurn: 0,
                matcher: { kind: 'SELF_ATTACKING' },
                label: 'bad',
                steps: [{ op: 'DRAW', count: 1 }],
              },
            ],
          })
        )
      ).toThrow(/maxPerTurn 必须是 >= 1 的正整数/);

      expect(() =>
        validateCardEffectSpec(
          makeBaseSpec({
            triggers: [
              {
                abilityId: 't:zero_max_player',
                eventType: 'ATTACK_DECLARED',
                maxPerTurnByPlayer: 0,
                matcher: { kind: 'SELF_ATTACKING' },
                label: 'bad',
                steps: [{ op: 'DRAW', count: 1 }],
              },
            ],
          })
        )
      ).toThrow(/maxPerTurnByPlayer 必须是 >= 1 的正整数/);

      expect(() =>
        validateCardEffectSpec(
          makeBaseSpec({
            triggers: [
              {
                abilityId: 't:bad_matcher_side',
                eventType: 'CARD_SENT_FIELD_TO_GY_BY_EFFECT',
                matcher: {
                  kind: 'ANY_CARD_SENT_FIELD_TO_GY_BY_EFFECT',
                  side: 'BOTH' as unknown as 'SELF',
                },
                label: 'bad',
                steps: [{ op: 'DRAW', count: 1 }],
              },
            ],
          })
        )
      ).toThrow(/matcher\.side 非法/);

      expect(() =>
        validateCardEffectSpec(
          makeBaseSpec({
            triggers: [
              {
                abilityId: 't:bad_matcher_reason',
                eventType: 'CARD_DESTROYED',
                matcher: {
                  kind: 'SELF_DESTROYED',
                  destroyReason: 'SACRIFICE' as unknown as 'ANY',
                },
                label: 'bad',
                steps: [{ op: 'DRAW', count: 1 }],
              },
            ],
          })
        )
      ).toThrow(/matcher\.destroyReason 非法/);

      expect(() =>
        validateCardEffectSpec(
          makeBaseSpec({
            triggers: [
              {
                abilityId: 't:bad_matcher_sourcekind',
                eventType: 'BLOCK_DECLARED',
                matcher: {
                  kind: 'FRIENDLY_ROLE_BLOCKING',
                  sourceKind: 'ASSIST' as unknown as 'ROLE',
                },
                label: 'bad',
                steps: [{ op: 'DRAW', count: 1 }],
              },
            ],
          })
        )
      ).toThrow(/matcher\.sourceKind 非法/);

      expect(() =>
        validateCardEffectSpec(
          makeBaseSpec({
            triggers: [
              {
                abilityId: 't:bad_matcher_turnend',
                eventType: 'END_PHASE_TRIGGERS',
                matcher: {
                  kind: 'SELF_TURN_END',
                  isSelfTurn: 'yes' as unknown as boolean,
                },
                label: 'bad',
                steps: [{ op: 'DRAW', count: 1 }],
              },
            ],
          })
        )
      ).toThrow(/matcher\.isSelfTurn 必须是布尔值/);

      expect(() =>
        validateCardEffectSpec(
          makeBaseSpec({
            triggers: [
              {
                abilityId: 't:bad_matcher_filter',
                eventType: 'CARD_ENTERED_FIELD',
                matcher: {
                  kind: 'OTHER_FRIENDLY_ROLE_ENTERED',
                  enteredFilter: { maxCost: -2 },
                },
                label: 'bad',
                steps: [{ op: 'DRAW', count: 1 }],
              },
            ],
          })
        )
      ).toThrow(/enteredFilter\.maxCost/);

      // sharedTurnKey 缺失限次配置
      expect(() =>
        validateCardEffectSpec(
          makeBaseSpec({
            activate: {
              sharedTurnKey: 'TEST:SHARED',
              steps: [{ op: 'DRAW', count: 1 }],
            },
          })
        )
      ).toThrow(/sharedTurnKey 时必须同时配置 oncePerTurnByPlayer 或 maxPerTurnByPlayer/);

      expect(() =>
        validateCardEffectSpec(
          makeBaseSpec({
            triggers: [
              {
                abilityId: 't:bad_shared_key',
                eventType: 'ATTACK_DECLARED',
                sharedTurnKey: '   ',
                oncePerTurnByPlayer: true,
                matcher: { kind: 'SELF_ATTACKING' },
                label: 'bad',
                steps: [{ op: 'DRAW', count: 1 }],
              },
            ],
          })
        )
      ).toThrow(/sharedTurnKey 必须是非空字符串/);

      // ADD_COST_MODIFIER.cardType / REGISTER_DELAYED_TRIGGER / CHOOSE_ROLES.maxTotalCost
      expect(() =>
        validateCardEffectSpec(
          makeBaseSpec({
            tactics: [{ op: 'ADD_COST_MODIFIER', amount: -1, cardType: 'ORB' as unknown as CardType }],
          })
        )
      ).toThrow(/cardType 非法/);

      expect(() =>
        validateCardEffectSpec(
          makeBaseSpec({
            tactics: [
              {
                op: 'REGISTER_DELAYED_TRIGGER',
                target: { kind: 'SELF' },
                eventType: 'ATTACK_ENDED',
                abilityId: 'DELAYED_ATTACK_END_DEPLOY_PARTNER',
                grantRushIfPartnerFromZone: 'UNKNOWN' as unknown as 'GRAVEYARD',
              },
            ],
          })
        )
      ).toThrow(/grantRushIfPartnerFromZone 非法/);

      expect(() =>
        validateCardEffectSpec(
          makeBaseSpec({
            tactics: [
              {
                op: 'REGISTER_DELAYED_TRIGGER',
                target: { kind: 'SELF' },
                eventType: 'END_PHASE_TRIGGERS',
                abilityId: 'DELAYED_END_OF_TURN_DRAW',
                targetSide: 'BOTH' as unknown as 'SELF',
              },
            ],
          })
        )
      ).toThrow(/targetSide 非法/);

      expect(() =>
        validateCardEffectSpec(
          makeBaseSpec({
            tactics: [
              {
                op: 'CHOOSE_ROLES',
                side: 'SELF',
                prompt: '选角色',
                maxTotalCost: -1,
                saveToVar: 'r',
              },
            ],
          })
        )
      ).toThrow(/maxTotalCost 必须是 >= 0 的整数/);
    });
  });

  it('3. eliminatedOrbsByKareninaCountThisTurn 按次数 (+1) 而非张数 (+count) 累计', () => {
    const engine = createEngine(
      expandDeck('ST01', ['BP04-039', 'BP04-039', 'BP04-041', 'BP04-037', 'BP04-042']),
      expandDeck('ST01')
    );
    const state = engine.getState();
    const p1 = state.activePlayerId;

    const p1Deck = engine.zoneMgr.getCardsInZone(p1, 'DECK');
    const karenina1 = p1Deck.find((c) => c.cardNumber === 'BP04-039')!;
    const karenina2 = p1Deck.find((c) => c.cardNumber === 'BP04-039' && c.instanceId !== karenina1.instanceId)!;
    const karenina041 = p1Deck.find((c) => c.cardNumber === 'BP04-041')!;
    const teddy37 = p1Deck.find((c) => c.cardNumber === 'BP04-037')!;
    const teddy42 = p1Deck.find((c) => c.cardNumber === 'BP04-042')!;

    engine.fieldMgr.playRoleCard(p1, karenina1.instanceId, 0, { suppressEntryTrigger: true });
    engine.fieldMgr.playRoleCard(p1, karenina2.instanceId, 1, { suppressEntryTrigger: true });
    engine.fieldMgr.playRoleCard(p1, karenina041.instanceId, 2, { suppressEntryTrigger: true });
    engine.zoneMgr.moveCard(teddy37.instanceId, 'GRAVEYARD', { isFaceUp: true });
    engine.zoneMgr.moveCard(teddy42.instanceId, 'GRAVEYARD', { isFaceUp: true });

    // 放入 6 张红色信号球，使 2 次墓地协战（每次 3 球）均可支付
    const addedOrbs: string[] = [];
    for (let i = 0; i < 6; i++) {
      const orb = engine.zoneMgr.getCardsInZone(p1, 'DECK').find((c) => db.getCard(c.cardNumber)?.signalOrb);
      if (!orb) throw new Error('测试牌组缺少信号球');
      engine.zoneMgr.moveCard(orb.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
      addedOrbs.push(orb.instanceId);
    }

    advanceToP1AttackableMainPhase(engine);
    resolvePendingChoices(engine);

    // 攻击宣言进入 FREE_TIMING 瞬时窗口以执行【协战】
    const atkRes = engine.dispatchAction({
      type: 'DECLARE_ATTACK',
      playerId: p1,
      attackerCardId: karenina041.instanceId,
      targetType: 'PLAYER',
    });
    expect(atkRes.success).toBe(true);
    expect(state.timingWindow?.kind).toBe('FREE_TIMING');

    // 第 1 次消耗 3 球的卡列尼娜协战
    const assist1 = engine.dispatchAction({
      type: 'PERFORM_ASSIST',
      playerId: p1,
      hostRoleCardId: karenina1.instanceId,
      partnerCardId: teddy37.instanceId,
      orbCardInstanceIds: addedOrbs.slice(0, 3),
    });
    expect(assist1.success, assist1.error).toBe(true);
    expect(state.players[p1]!.eliminatedOrbsByKareninaCountThisTurn).toBe(1);
    expect(engine.fieldMgr.calculateRoleEffectiveDP(karenina041.instanceId)).toBe(1);
    expect(engine.continuousEffects.evaluateCard(karenina041.instanceId).charge).toBe(1);

    // 对手放弃瞬时，优先权回到 p1 执行第 2 次协战
    if (state.timingWindow?.priorityPlayerId === state.nonActivePlayerId) {
      expect(engine.dispatchAction({ type: 'PASS_ACTION_TIMING', playerId: state.nonActivePlayerId }).success).toBe(true);
    }
    const assist2 = engine.dispatchAction({
      type: 'PERFORM_ASSIST',
      playerId: p1,
      hostRoleCardId: karenina2.instanceId,
      partnerCardId: teddy42.instanceId,
      orbCardInstanceIds: addedOrbs.slice(3, 6),
    });
    expect(assist2.success).toBe(true);
    expect(state.players[p1]!.eliminatedOrbsByKareninaCountThisTurn).toBe(2);
    expect(engine.fieldMgr.calculateRoleEffectiveDP(karenina041.instanceId)).toBe(1);
    expect(engine.continuousEffects.evaluateCard(karenina041.instanceId).charge).toBe(2);
  });

  it('4. REDIRECT_ATTACK 对已离场目标忽略、对合法对方战场顶层角色正确重定向', () => {
    // 子用例 A：BP04-038【协战自】触发时若目标《卡列尼娜·辉晓》已不在对方战场顶层，忽略重定向
    const engineA = createEngine(
      expandDeck('ST01'),
      expandDeck('ST01', ['BP04-039', 'BP04-038'])
    );
    const stateA = engineA.getState();
    const p1 = stateA.activePlayerId;
    const p2 = stateA.nonActivePlayerId;

    const p1Attacker = engineA.zoneMgr.getCardsInZone(p1, 'DECK').find((c) => db.getCard(c.cardNumber)?.cardType === CardType.ROLE)!;
    const p2Karenina = engineA.zoneMgr.getCardsInZone(p2, 'DECK').find((c) => c.cardNumber === 'BP04-039')!;
    const p2Teddy = engineA.zoneMgr.getCardsInZone(p2, 'DECK').find((c) => c.cardNumber === 'BP04-038')!;
    engineA.fieldMgr.playRoleCard(p1, p1Attacker.instanceId, 0, { suppressEntryTrigger: true });
    engineA.fieldMgr.playRoleCard(p2, p2Karenina.instanceId, 0, { suppressEntryTrigger: true });
    engineA.zoneMgr.moveCard(p2Teddy.instanceId, 'HAND', { isFaceUp: true });

    advanceToP1AttackableMainPhase(engineA);

    expect(
      engineA.dispatchAction({
        type: 'DECLARE_ATTACK',
        playerId: p1,
        attackerCardId: p1Attacker.instanceId,
        targetType: 'PLAYER',
      }).success
    ).toBe(true);

    expect(engineA.fieldMgr.attachPartner(p2, p2Karenina.instanceId, p2Teddy.instanceId)).toBe(true);
    engineA.triggerMgr.emit({
      type: 'PARTNER_GAINED',
      playerId: p2,
      cardInstanceId: p2Karenina.instanceId,
      targetCardId: p2Teddy.instanceId,
    });
    engineA.checkTimingMgr.resolveCheckTiming(stateA.events);

    const redirectPrompt = stateA.currentPendingChoice;
    expect(redirectPrompt?.effectType).toBe('DSL_BP04_038_REDIRECT');

    // 在结算确认前将宿主移出战场
    engineA.zoneMgr.moveCard(p2Karenina.instanceId, 'GRAVEYARD', { isFaceUp: true });
    expect(
      engineA.dispatchAction({
        type: 'SELECT_CHOICE_OPTION',
        playerId: p2,
        pendingChoiceId: redirectPrompt!.id,
        selectedIds: ['opt_yes'],
      }).success
    ).toBe(true);
    expect(stateA.currentCombat?.targetType).toBe('PLAYER');
    expect(stateA.currentCombat?.targetCardId).toBeUndefined();

    // 子用例 B：目标仍在对方战场顶层角色位时（BP04-047 塞西莉），攻击正确重定向至该角色
    const engineB = createEngine(
      expandDeck('ST01'),
      expandDeck('ST03', ['ST06-005', 'BP04-047'])
    );
    const stateB = engineB.getState();
    const bP1 = stateB.activePlayerId;
    const bP2 = stateB.nonActivePlayerId;

    const atk = engineB.zoneMgr.getCardsInZone(bP1, 'DECK').find((c) => c.cardNumber === 'ST01-002')!;
    const alisa = engineB.zoneMgr.getCardsInZone(bP2, 'DECK').find((c) => c.cardNumber === 'ST06-005')!;
    const cecily = engineB.zoneMgr.getCardsInZone(bP2, 'DECK').find((c) => c.cardNumber === 'BP04-047')!;
    const yellowOrb = engineB.zoneMgr.getCardsInZone(bP2, 'DECK').find((c) => db.getCard(c.cardNumber)?.signalOrb === 'YELLOW')!;
    engineB.fieldMgr.playRoleCard(bP1, atk.instanceId, 0, { suppressEntryTrigger: true });
    engineB.fieldMgr.playRoleCard(bP2, alisa.instanceId, 0, { suppressEntryTrigger: true });
    engineB.zoneMgr.moveCard(cecily.instanceId, 'GRAVEYARD', { isFaceUp: true });
    engineB.zoneMgr.moveCard(yellowOrb.instanceId, 'SIGNAL_ORB', { isFaceUp: true });

    advanceToP1AttackableMainPhase(engineB);
    alisa.isReady = false;

    const atkResB = engineB.dispatchAction({
      type: 'DECLARE_ATTACK',
      playerId: bP1,
      attackerCardId: atk.instanceId,
      targetType: 'CHARACTER',
      targetCardId: alisa.instanceId,
    });
    expect(atkResB.success, atkResB.error).toBe(true);

    // 支付 1 黄球将塞西莉从墓地出场并重定向攻击
    for (let guard = 0; guard < 10 && stateB.currentPendingChoice; guard++) {
      const ch = stateB.currentPendingChoice;
      if (ch.options.some((o) => o.id === yellowOrb.instanceId)) {
        expect(
          engineB.dispatchAction({
            type: 'SELECT_CHOICE_OPTION',
            playerId: bP2,
            pendingChoiceId: ch.id,
            selectedIds: [yellowOrb.instanceId],
          }).success
        ).toBe(true);
      } else {
        resolvePendingChoices(engineB);
      }
    }
    expect(cecily.zone).toBe('BATTLEFIELD');
    expect(stateB.currentCombat?.targetType).toBe('CHARACTER');
    expect(stateB.currentCombat?.targetCardId).toBe(cecily.instanceId);
  });

  it('5. DETACH_AND_MOVE_PARTNER 触发 PARTNER_RELEASED 时采集移动前 subjectSnapshot.zone === "BATTLEFIELD"', () => {
    const engine = createEngine(
      expandDeck('ST01', ['BP04-024', 'BP04-025']),
      expandDeck('ST01')
    );
    const state = engine.getState();
    const p1 = state.activePlayerId;

    const capturedSnapshots: Array<{ zone?: string; cardInstanceId?: string }> = [];
    engine.triggerMgr.registerTrigger({
      abilityId: 'test:capture_partner_released',
      eventTypes: ['PARTNER_RELEASED'],
      collect: ({ event }) => {
        if (event.subjectSnapshot) {
          capturedSnapshots.push({
            zone: event.subjectSnapshot.zone,
            cardInstanceId: event.subjectSnapshot.cardInstanceId,
          });
        }
        return [];
      },
      execute: () => {},
    });

    const watanabe = engine.zoneMgr.getCardsInZone(p1, 'DECK').find((c) => c.cardNumber === 'BP04-024')!;
    const partner = engine.zoneMgr.getCardsInZone(p1, 'DECK').find((c) => c.cardNumber === 'BP04-025')!;
    const redOrb = engine.zoneMgr.getCardsInZone(p1, 'DECK').find((c) => db.getCard(c.cardNumber)?.signalOrb === 'RED')!;

    engine.fieldMgr.playRoleCard(p1, watanabe.instanceId, 0, { suppressEntryTrigger: true });
    engine.zoneMgr.moveCard(partner.instanceId, 'HAND', { isFaceUp: true });
    engine.zoneMgr.moveCard(redOrb.instanceId, 'SIGNAL_ORB', { isFaceUp: true });

    advanceToP1AttackableMainPhase(engine);
    resolvePendingChoices(engine);
    // 在可攻击回合的主要阶段绑定搭档（避免回合结束 8.13.4.a 自动解除协战）
    expect(engine.fieldMgr.attachPartner(p1, watanabe.instanceId, partner.instanceId)).toBe(true);

    expect(
      engine.dispatchAction({
        type: 'DECLARE_ATTACK',
        playerId: p1,
        attackerCardId: watanabe.instanceId,
        targetType: 'PLAYER',
      }).success
    ).toBe(true);

    passInstantWindows(engine);
    if (state.currentCombat?.step === 'BLOCK') {
      expect(engine.dispatchAction({ type: 'DECLARE_BLOCK', playerId: state.nonActivePlayerId }).success).toBe(true);
    }
    // 完成伤害充能；攻击结束触发 DSL_BP04_024_ORB_COST 时选择支付 1 个信号球以将搭档回手
    for (let guard = 0; guard < 20 && (state.currentPendingChoice || state.timingWindow); guard++) {
      if (state.timingWindow) {
        passInstantWindows(engine);
        continue;
      }
      const ch = state.currentPendingChoice!;
      if (ch.effectType === 'DSL_BP04_024_ORB_COST') {
        expect(
          engine.dispatchAction({
            type: 'SELECT_CHOICE_OPTION',
            playerId: p1,
            pendingChoiceId: ch.id,
            selectedIds: [redOrb.instanceId],
          }).success
        ).toBe(true);
      } else {
        resolvePendingChoices(engine);
      }
    }

    // 确认已执行 DETACH_AND_MOVE_PARTNER 将搭档移回手牌，且移动前快照记录所在区域为 BATTLEFIELD（非移动后的 HAND）
    expect(partner.zone).toBe('HAND');
    expect(watanabe.partnerCardId).toBeUndefined();
    expect(capturedSnapshots.some((s) => s.cardInstanceId === partner.instanceId && s.zone === 'BATTLEFIELD')).toBe(true);
  });

  it('6. EQUIPPED_ROLE_ATTACKING 在宿主具备 CANNOT_GAIN_ABILITIES 时不触发装备赋予的【自】', () => {
    // 6a. 对照组：不具备 CANNOT_GAIN_ABILITIES 时，攻击正常触发装备 BP01-023 赋予的【自】
    const baseEngine = createEngine(
      expandDeck('ST01', ['BP01-017', 'BP01-023', 'ST01-005']),
      expandDeck('ST01')
    );
    const baseState = baseEngine.getState();
    const baseP1 = baseState.activePlayerId;
    const baseLucia = baseEngine.zoneMgr.getCardsInZone(baseP1, 'DECK').find((c) => c.cardNumber === 'BP01-017')!;
    const baseOdachi = baseEngine.zoneMgr.getCardsInZone(baseP1, 'DECK').find((c) => c.cardNumber === 'BP01-023')!;
    const baseAlly = baseEngine.zoneMgr.getCardsInZone(baseP1, 'DECK').find((c) => c.cardNumber === 'ST01-005')!;
    baseEngine.fieldMgr.playRoleCard(baseP1, baseLucia.instanceId, 0, { suppressEntryTrigger: true });
    baseEngine.fieldMgr.playRoleCard(baseP1, baseAlly.instanceId, 1, { suppressEntryTrigger: true });
    baseEngine.zoneMgr.moveCard(baseOdachi.instanceId, 'PROCESSING', { isFaceUp: true });
    expect(baseEngine.fieldMgr.equipToRole(baseP1, baseOdachi.instanceId, baseLucia.instanceId)).toBe(true);
    advanceToP1AttackableMainPhase(baseEngine);
    expect(
      baseEngine.dispatchAction({
        type: 'DECLARE_ATTACK',
        playerId: baseP1,
        attackerCardId: baseLucia.instanceId,
        targetType: 'PLAYER',
      }).success
    ).toBe(true);
    expect(baseState.currentPendingChoice?.prompt).toContain('夜煌—大太刀');

    // 6b. 实验组：宿主具备 CANNOT_GAIN_ABILITIES 时，不触发装备赋予的【自】
    const engine = createEngine(
      expandDeck('ST01', ['BP01-017', 'BP01-023', 'ST01-005']),
      expandDeck('ST01')
    );
    const state = engine.getState();
    const p1 = state.activePlayerId;

    const lucia = engine.zoneMgr.getCardsInZone(p1, 'DECK').find((c) => c.cardNumber === 'BP01-017')!;
    const odachi = engine.zoneMgr.getCardsInZone(p1, 'DECK').find((c) => c.cardNumber === 'BP01-023')!;
    const ally = engine.zoneMgr.getCardsInZone(p1, 'DECK').find((c) => c.cardNumber === 'ST01-005')!;

    engine.fieldMgr.playRoleCard(p1, lucia.instanceId, 0, { suppressEntryTrigger: true });
    engine.fieldMgr.playRoleCard(p1, ally.instanceId, 1, { suppressEntryTrigger: true });
    engine.zoneMgr.moveCard(odachi.instanceId, 'PROCESSING', { isFaceUp: true });
    expect(engine.fieldMgr.equipToRole(p1, odachi.instanceId, lucia.instanceId)).toBe(true);

    advanceToP1AttackableMainPhase(engine);
    resolvePendingChoices(engine);

    // 为宿主施加 CANNOT_GAIN_ABILITIES 禁止标志
    addCardModifier(state, lucia, {
      prohibitions: ['CANNOT_GAIN_ABILITIES'],
      untilTurn: state.turnNumber,
      source: 'TEST_CANNOT_GAIN',
      appliedByPlayerId: state.nonActivePlayerId,
    });

    expect(
      engine.dispatchAction({
        type: 'DECLARE_ATTACK',
        playerId: p1,
        attackerCardId: lucia.instanceId,
        targetType: 'PLAYER',
      }).success
    ).toBe(true);

    // 宿主无法获得装备赋予的【自】，不应触发 BP01-023 弹窗
    expect(state.currentPendingChoice).toBeUndefined();
    expect(state.pendingTriggers.some((t) => t.abilityId === 'dsl:BP01-023:equip_attack_unblockable')).toBe(false);
  });

  it('7. matchesFilter / matchesFilterWithSnapshot 快照与特征过滤行为验证', () => {
    // 7a. isFrozen & isAirborne & hasPartner & setCardType 通过真实官方卡牌 DSL 条件/触发验证
    const engine = createEngine(
      expandDeck('ST01', ['BP02-071', 'BP03-001', 'BP03-004', 'PR-041', 'BP01-044', 'BP01-044', 'BP01-044']),
      expandDeck('ST03', ['ST03-005', 'ST06-005', 'BP04-047', 'ST03-014'])
    );
    const state = engine.getState();
    const p1 = state.activePlayerId;
    const p2 = state.nonActivePlayerId;

    const findP1 = (num: string) =>
      Object.values(state.cards).find((c) => c.controllerPlayerId === p1 && c.cardNumber === num)!;
    const findP2 = (num: string) =>
      Object.values(state.cards).find((c) => c.controllerPlayerId === p2 && c.cardNumber === num)!;

    const wanshi = findP1('BP02-071');
    const airborneFire = findP1('BP03-001');
    const lucia004 = findP1('BP03-004');
    const suE = findP1('PR-041');
    const oppFrozen = findP2('ST03-005');
    const alisa = findP2('ST06-005');
    const cecily = findP2('BP04-047');

    engine.fieldMgr.playRoleCard(p1, wanshi.instanceId, 0, { suppressEntryTrigger: true });
    engine.fieldMgr.playRoleCard(p1, airborneFire.instanceId, 1, { suppressEntryTrigger: true });
    expect(engine.fieldMgr.airborneRole(airborneFire.instanceId)).toBe(true);
    expect(airborneFire.isAirborne).toBe(true);

    // BP03-004 出场检查 PROCESSING 中存在 isAirborne: true 的《露西亚·誓焰》
    const fireCards = Object.values(state.cards).filter(
      (c) =>
        c.controllerPlayerId === p1 &&
        (c.zone === 'DECK' || c.zone === 'HAND') &&
        db.getCard(c.cardNumber)?.attribute === ElementAttribute.FIRE &&
        c.instanceId !== lucia004.instanceId &&
        c.instanceId !== wanshi.instanceId &&
        c.instanceId !== airborneFire.instanceId
    );
    const fireCostCard = fireCards[0]!;
    engine.zoneMgr.moveCard(fireCostCard.instanceId, 'COST', { isFaceUp: true, isReady: true });
    for (const fc of fireCards.slice(1, 3)) {
      engine.zoneMgr.moveCard(fc.instanceId, 'HAND', { isFaceUp: true });
    }
    engine.zoneMgr.moveCard(lucia004.instanceId, 'HAND', { isFaceUp: true });
    fillCostZone(engine, p1, 8);
    const play004 = engine.dispatchAction({
      type: 'PLAY_CARD',
      playerId: p1,
      cardInstanceId: lucia004.instanceId,
      targetSlotIndex: 1,
    });
    expect(play004.success, play004.error).toBe(true);
    expect(state.currentPendingChoice?.effectType).toBe('DSL_BP03-004_DISCARD');
    // 跳过 BP03-004 弃牌
    resolvePendingChoices(engine);

    advanceToP1AttackableMainPhase(engine);
    resolvePendingChoices(engine);

    // isFrozen: 对方无冰冻角色时 BP02-071 攻击不触发，有冰冻角色时触发
    engine.fieldMgr.playRoleCard(p2, oppFrozen.instanceId, 0, { suppressEntryTrigger: true });
    oppFrozen.isReady = false;
    oppFrozen.isFrozen = true;
    expect(state.currentPendingChoice).toBeUndefined();
    const wanshiAtk = engine.dispatchAction({
      type: 'DECLARE_ATTACK',
      playerId: p1,
      attackerCardId: wanshi.instanceId,
      targetType: 'PLAYER',
    });
    expect(wanshiAtk.success, wanshiAtk.error).toBe(true);
    expect(state.currentPendingChoice?.prompt).toContain('万事·明晰梦');
    resolvePendingChoices(engine);
    passInstantWindows(engine);
    resolvePendingChoices(engine);
    passInstantWindows(engine);

    // hasPartner: 已有搭档的《亚里莎·回音》被攻击时不触发 BP04-047 (targetFilter.hasPartner === false)
    engine.fieldMgr.playRoleCard(p2, alisa.instanceId, 1, { suppressEntryTrigger: true });
    alisa.isReady = false;
    const alisaPartner = Object.values(state.cards).find(
      (c) =>
        c.controllerPlayerId === p2 &&
        (c.zone === 'DECK' || c.zone === 'HAND') &&
        db.getCard(c.cardNumber)?.cardType === CardType.ROLE &&
        c.instanceId !== alisa.instanceId &&
        c.instanceId !== cecily.instanceId
    )!;
    engine.zoneMgr.moveCard(alisaPartner.instanceId, 'HAND', { isFaceUp: true });
    expect(engine.fieldMgr.attachPartner(p2, alisa.instanceId, alisaPartner.instanceId)).toBe(true);
    engine.zoneMgr.moveCard(cecily.instanceId, 'GRAVEYARD', { isFaceUp: true });
    const yellowOrb = Object.values(state.cards).find(
      (c) =>
        c.controllerPlayerId === p2 &&
        (c.zone === 'DECK' || c.zone === 'HAND') &&
        db.getCard(c.cardNumber)?.signalOrb === 'YELLOW'
    )!;
    engine.zoneMgr.moveCard(yellowOrb.instanceId, 'SIGNAL_ORB', { isFaceUp: true });

    expect(
      engine.dispatchAction({
        type: 'DECLARE_ATTACK',
        playerId: p1,
        attackerCardId: lucia004.instanceId,
        targetType: 'CHARACTER',
        targetCardId: alisa.instanceId,
      }).success
    ).toBe(true);
    expect(state.pendingTriggers.some((t) => t.abilityId === 'dsl:BP04-047:gy_bodyguard_redirect')).toBe(false);
    passInstantWindows(engine);
    resolvePendingChoices(engine);
    passInstantWindows(engine);

    // 7b. 通过公开 DeclarativeEffectInterpreter + validateCardEffectRegistry 测试 minUnderneathCount / setCardType / abilitiesLost 过滤与快照行为
    const customSpecs: CardEffectSpec[] = [
      {
        cardNumber: 'ST01-005',
        name: '露西亚·红莲',
        triggers: [
          {
            abilityId: 'test:snapshot_sent_gy',
            eventType: 'CARD_SENT_FIELD_TO_GY_BY_EFFECT',
            matcher: {
              kind: 'ANY_CARD_SENT_FIELD_TO_GY_BY_EFFECT',
              side: 'SELF',
              filter: { cardType: CardType.ROLE, exactName: '万事·明晰梦' },
              includeSelf: false,
            },
            condition: {
              kind: 'HAS_ROLE',
              side: 'SELF',
              filter: { cardType: CardType.ROLE, minUnderneathCount: 1 },
            },
            label: '测试快照与 minUnderneathCount + setCardType 过滤',
            steps: [{ op: 'DRAW', count: 1 }],
          },
        ],
      },
    ];
    const customRegistry = validateCardEffectRegistry(customSpecs);
    const customInterpreter = new DeclarativeEffectInterpreter(
      {
        state,
        zoneMgr: engine.zoneMgr,
        fieldMgr: engine.fieldMgr,
        cardDb: db,
        events: state.events,
        continuousEffects: engine.continuousEffects,
        triggerMgr: engine.triggerMgr,
        replacementEngine: engine.replacementEngine,
        payCost: () => true,
        setPendingChoice: (c) => {
          state.currentPendingChoice = c;
        },
      },
      engine.effectEngine,
      customRegistry
    );
    customInterpreter.registerTriggers(engine.triggerMgr);

    // 1) 将一张原本为 ASSIST 的卡牌变为 setCardType=ROLE 并下方垫 1 张牌，满足 HAS_ROLE(cardType=ROLE, minUnderneathCount=1)
    const emptySlots = engine.fieldMgr
      .getSlots(p1)
      .filter((s) => !s.roleCardId && !s.standaloneEquipmentId && !s.assistCardId)
      .map((s) => s.slotIndex);
    const slotWatcher = emptySlots[0]!;
    const slotSubject = emptySlots[1]!;
    const underneath = engine.zoneMgr.getCardsInZone(p1, 'DECK')[0]!;
    const transformedAssist = engine.zoneMgr.getCardsInZone(p1, 'DECK')[1]!;
    expect(engine.fieldMgr.playAssistCard(p1, transformedAssist.instanceId, slotSubject, { suppressEntryTrigger: true })).toBe(true);
    addCardModifier(state, transformedAssist, {
      setCardType: CardType.ROLE,
      untilTurn: state.turnNumber,
      source: 'TEST_MOD',
    });
    expect(engine.fieldMgr.placeCardUnderneath(underneath.instanceId, transformedAssist.instanceId, { actorPlayerId: p1 })).toBe(true);
    expect(transformedAssist.underneathCardIds.length).toBe(1);

    // 2) 出场 ST01-005 作为监听源，并将已在场的《万事·明晰梦》设为失能后因效果送墓
    const watcher = Object.values(state.cards).find(
      (c) =>
        c.controllerPlayerId === p1 &&
        (c.zone === 'DECK' || c.zone === 'HAND') &&
        c.cardNumber === 'ST01-005'
    )!;
    expect(engine.fieldMgr.playRoleCard(p1, watcher.instanceId, slotWatcher, { suppressEntryTrigger: true })).toBe(true);
    expect(suE.zone).toBe('DECK');
    const sacrificed = wanshi;
    addCardModifier(state, sacrificed, {
      loseAbilities: true,
      untilTurn: state.turnNumber,
      source: 'TEST_MOD',
    });
    expect(engine.continuousEffects.hasLostInherentAbilities(sacrificed.instanceId)).toBe(true);

    // 验证 snapshotCard 保留 abilitiesLost 与离场前状态，且送墓后 matchesFilterWithSnapshot 仍能匹配并满足 HAS_ROLE(minUnderneathCount=1)
    const snap = engine.triggerMgr.snapshotCard(sacrificed.instanceId);
    expect(snap?.abilitiesLost).toBe(true);
    expect(watcher.zone).toBe('BATTLEFIELD');

    const handBefore = engine.zoneMgr.getCardsInZone(p1, 'HAND').length;
    state.pendingTriggers = [];
    engine.zoneMgr.moveCard(sacrificed.instanceId, 'GRAVEYARD', { isFaceUp: true, sentByEffectOrCost: true });
    expect(state.pendingTriggers.some((t) => t.abilityId === 'test:snapshot_sent_gy')).toBe(true);
    engine.checkTimingMgr.resolveCheckTiming(state.events);
    resolvePendingChoices(engine);
    expect(engine.zoneMgr.getCardsInZone(p1, 'HAND').length).toBe(handBefore + 1);

    // 确认 BP04_EFFECT_SPECS 导出正常
    expect(BP04_EFFECT_SPECS.length).toBeGreaterThan(0);
  });
});

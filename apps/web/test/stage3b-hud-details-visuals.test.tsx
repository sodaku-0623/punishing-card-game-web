import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import {
  CardInstance,
  CardType,
  PendingChoice,
  PublicGameState,
} from '@zhanshuang/shared';
import {
  getCardEffectiveCostInfo,
  getAttackerCapabilities,
  isLegalRoleAttackTarget,
  canRoleBlockAttacker,
  isHandCardLegalToPlay,
} from '../src/lib/battle-actions';
import { getTimingStatus } from '../src/lib/timing';
import { getCardUnblockableMaxPP } from '../src/lib/card-stats';
import { ErosionBar } from '../src/components/game/ErosionBar';
import { CardView } from '../src/components/game/CardView';
import { CardDetailPanel } from '../src/components/game/CardDetailPanel';
import { CardDetailModal } from '../src/components/game/CardDetailModal';
import { PendingChoiceModal } from '../src/components/game/PendingChoiceModal';

function makeCard(
  overrides: Partial<CardInstance> & { instanceId: string; cardNumber: string }
): CardInstance {
  return {
    cardId: `c-${overrides.cardNumber.toLowerCase()}`,
    ownerPlayerId: 'p1',
    controllerPlayerId: 'p1',
    zone: 'BATTLEFIELD',
    underneathCardIds: [],
    isFaceUp: true,
    isReady: true,
    turnEnteredZone: 1,
    ...overrides,
  };
}

function makeBaseGameState(overrides?: Partial<PublicGameState>): PublicGameState {
  return {
    gameId: 'g-stage3b',
    status: 'PLAYING',
    isDraw: false,
    turnNumber: 4,
    activePlayerId: 'p1',
    nonActivePlayerId: 'p2',
    phase: 'MAIN_PHASE',
    priorityPlayerId: 'p1',
    players: {
      p1: {
        playerId: 'p1',
        seatOrder: 0,
        isFirstPlayer: true,
        erosionCount: 0,
        hasMulliganed: true,
        surrendered: false,
        totalCostCount: 8,
        openCostCount: 8,
        availableOpenCostCount: 8,
        exhaustedOpenCostCount: 0,
        hiddenCostCount: 0,
        turnAbilityUsage: {},
        gameAbilityUsage: {},
      },
      p2: {
        playerId: 'p2',
        seatOrder: 1,
        isFirstPlayer: false,
        erosionCount: 0,
        hasMulliganed: true,
        surrendered: false,
        totalCostCount: 8,
        openCostCount: 8,
        availableOpenCostCount: 8,
        exhaustedOpenCostCount: 0,
        hiddenCostCount: 0,
        turnAbilityUsage: {},
        gameAbilityUsage: {},
      },
    },
    battlefields: {
      p1: [0, 1, 2, 3, 4].map((slotIndex) => ({ slotIndex })),
      p2: [0, 1, 2, 3, 4].map((slotIndex) => ({ slotIndex })),
    },
    myHandCards: [],
    opponentHandCount: 4,
    myDeckCount: 30,
    opponentDeckCount: 30,
    publicCards: {},
    ...overrides,
  };
}

function collectSourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectSourceFiles(full, acc);
    } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
      acc.push(full);
    }
  }
  return acc;
}

describe('Stage 3B (§3.3.2) 战场提示、详情面板、费用/攻防校验与视觉修复', () => {
  it('timing.ts：清晰区分 END_PHASE 与 FREE_TIMING【瞬时】窗口标题与等待文案', () => {
    const endWindowState = makeBaseGameState({
      phase: 'END_PHASE',
      timingWindow: { kind: 'END_PHASE', priorityPlayerId: 'p1', consecutivePasses: 0 },
    });
    const tSelfEnd = getTimingStatus(endWindowState, 'p1');
    expect(tSelfEnd.hasInstantPriority).toBe(true);
    expect(tSelfEnd.timingWindowKind).toBe('END_PHASE');
    expect(tSelfEnd.windowTitle).toContain('结束阶段');

    const tWaitEnd = getTimingStatus(endWindowState, 'p2');
    expect(tWaitEnd.hasInstantPriority).toBe(false);
    expect(tWaitEnd.waitingHint).toContain('结束阶段');

    const freeWindowState = makeBaseGameState({
      phase: 'COMBAT_FREE_TIMING',
      timingWindow: { kind: 'FREE_TIMING', priorityPlayerId: 'p2', consecutivePasses: 0 },
    });
    const tFree = getTimingStatus(freeWindowState, 'p2');
    expect(tFree.timingWindowKind).toBe('FREE_TIMING');
    expect(tFree.windowTitle).toContain('自由时点');
  });

  it('全量费用与减费计算：覆盖 ST05-009+BP02-024 奇偶、BP01-002、战场光环、可选减费与 BP02-067 升变税', () => {
    // ST05-009 (6费)：最底球为 BP02-024 (原2费 + 球区自身+1 => 3奇数，触发晖形态 -3 => 3费)
    const st05009 = makeCard({ instanceId: 'h-009', cardNumber: 'ST05-009', zone: 'HAND' });
    const bp02024Orb = makeCard({
      instanceId: 'orb-bottom',
      cardNumber: 'BP02-024',
      zone: 'SIGNAL_ORB',
      isFaceUp: true,
    });
    // BP01-002 (7费)：战场同时有 <里> ST01-002 与 <丽芙> ST01-003 => -3 => 4费
    const bp01002 = makeCard({ instanceId: 'h-002', cardNumber: 'BP01-002', zone: 'HAND' });
    const leeRole = makeCard({ instanceId: 'my-lee', cardNumber: 'ST01-002', zone: 'BATTLEFIELD', slotIndex: 0 });
    const livRole = makeCard({ instanceId: 'my-liv', cardNumber: 'ST01-003', zone: 'BATTLEFIELD', slotIndex: 1 });
    // BP01-077 战场光环使手牌首张《荣光护盾》(ST04-010, 4费) 基础费变为 1
    const bp01077 = makeCard({ instanceId: 'my-077', cardNumber: 'BP01-077', zone: 'BATTLEFIELD', slotIndex: 2 });
    const gloryShield = makeCard({ instanceId: 'h-shield', cardNumber: 'ST04-010', zone: 'HAND' });
    // BP01-015 战场光环使手牌首张装备 (BP01-022, 2费) -1 => 1
    const bp01015 = makeCard({ instanceId: 'my-015', cardNumber: 'BP01-015', zone: 'BATTLEFIELD', slotIndex: 3 });
    const weapon = makeCard({ instanceId: 'h-eq', cardNumber: 'BP01-022', zone: 'HAND' });
    // BP04-060 血税 (战术2费)：战场有 <神寂启示录>/<异聚体> 时可选牺牲减费 -2 => minPayableCost 0
    const bp04060 = makeCard({ instanceId: 'h-460', cardNumber: 'BP04-060', zone: 'HAND' });
    const ascenderSac = makeCard({ instanceId: 'my-450', cardNumber: 'BP04-050', zone: 'BATTLEFIELD', slotIndex: 4 });
    // 升变：ST01-002 (2费) 与对手横置 BP02-067 (万事·明晰梦) + excludeAscension costModifier
    const bp01001 = makeCard({ instanceId: 'h-001', cardNumber: 'BP01-001', zone: 'HAND' });
    const oppWanshi = makeCard({
      instanceId: 'opp-67',
      cardNumber: 'BP02-067',
      ownerPlayerId: 'p2',
      controllerPlayerId: 'p2',
      zone: 'BATTLEFIELD',
      slotIndex: 0,
      isReady: false,
    });

    const state = makeBaseGameState({
      players: {
        ...makeBaseGameState().players,
        p1: {
          ...makeBaseGameState().players.p1!,
          costModifiers: [
            {
              id: 'cm-no-asc',
              cardType: CardType.ROLE,
              amount: 2,
              excludeAscension: true,
            },
          ],
        },
      },
      battlefields: {
        p1: [
          { slotIndex: 0, roleCardId: 'my-lee' },
          { slotIndex: 1, roleCardId: 'my-liv' },
          { slotIndex: 2, roleCardId: 'my-077' },
          { slotIndex: 3, roleCardId: 'my-015' },
          { slotIndex: 4, roleCardId: 'my-450' },
        ],
        p2: [{ slotIndex: 0, roleCardId: 'opp-67' }, ...[1, 2, 3, 4].map((slotIndex) => ({ slotIndex }))],
      },
      myHandCards: [st05009, bp01002, gloryShield, weapon, bp04060, bp01001],
      publicCards: {
        'orb-bottom': bp02024Orb,
        'my-lee': leeRole,
        'my-liv': livRole,
        'my-077': bp01077,
        'my-015': bp01015,
        'my-450': ascenderSac,
        'opp-67': oppWanshi,
      },
    });

    expect(getCardEffectiveCostInfo(state, 'p1', st05009).effectiveCost).toBe(3);
    expect(getCardEffectiveCostInfo(state, 'p1', bp01002).effectiveCost).toBe(2); // 7 - 3(自身) - 2(costModifier)
    expect(getCardEffectiveCostInfo(state, 'p1', gloryShield).effectiveCost).toBe(1);
    expect(getCardEffectiveCostInfo(state, 'p1', weapon).effectiveCost).toBe(1);

    const bp04060Cost = getCardEffectiveCostInfo(state, 'p1', bp04060);
    expect(bp04060Cost.effectiveCost).toBe(2); // 血税原2费（TACTICS 不吃 ROLE 修改器）
    expect(bp04060Cost.minPayableCost).toBe(0); // 再选牺牲减 2
    expect(bp04060Cost.hasOptionalDiscount).toBe(true);

    // 升变：BP01-001 升变费 3 + 对方横置 BP02-067 加 1（excludeAscension 的 -2 不生效）=> 4
    const restedTarget = makeCard({ instanceId: 't-rest', cardNumber: 'ST01-002', isReady: false });
    const ascInfo = getCardEffectiveCostInfo(state, 'p1', bp01001, {
      isAscension: true,
      targetAscensionCards: [restedTarget],
    });
    expect(ascInfo.effectiveCost).toBe(4);
  });

  it('攻防与合法出牌判定：拦竖直目标、支持 BP03-012/BP02-010 嘲讽、出场突进仅打怪、unblockableMaxPP、isHandCardLegalToPlay', () => {
    // 1. 出场回合【突进】只能打角色不能打玩家；出场带 canAttackPlayerOnEnterTurn 只能打玩家
    const rushFresh = makeCard({
      instanceId: 'my-rush',
      cardNumber: 'ST01-003',
      turnEnteredZone: 4,
      effectiveKeywords: ['突进'],
    });
    const playerEnter = makeCard({
      instanceId: 'my-st05001',
      cardNumber: 'ST05-001',
      turnEnteredZone: 4,
      modifiers: [{ canAttackPlayerOnEnterTurn: true, untilTurn: 4 }],
    });
    const normalVeteran = makeCard({
      instanceId: 'my-vet',
      cardNumber: 'ST01-001',
      turnEnteredZone: 1,
    });
    const readyBypass = makeCard({
      instanceId: 'my-bp03012',
      cardNumber: 'BP03-012',
      turnEnteredZone: 1,
      modifiers: [{ canAttackReadyRolesMaxCost: 99, untilTurn: 4 }],
    });

    const oppReadyNormal = makeCard({
      instanceId: 'opp-ready',
      cardNumber: 'ST02-001',
      ownerPlayerId: 'p2',
      controllerPlayerId: 'p2',
      isReady: true,
    });
    const oppRested = makeCard({
      instanceId: 'opp-rested',
      cardNumber: 'ST02-002',
      ownerPlayerId: 'p2',
      controllerPlayerId: 'p2',
      isReady: false,
    });
    const oppTaunt = makeCard({
      instanceId: 'opp-taunt',
      cardNumber: 'BP02-010',
      ownerPlayerId: 'p2',
      controllerPlayerId: 'p2',
      isReady: false,
    });

    const atkState = makeBaseGameState({
      battlefields: {
        p1: [
          { slotIndex: 0, roleCardId: 'my-rush' },
          { slotIndex: 1, roleCardId: 'my-st05001' },
          { slotIndex: 2, roleCardId: 'my-vet' },
          { slotIndex: 3, roleCardId: 'my-bp03012' },
          { slotIndex: 4 },
        ],
        p2: [
          { slotIndex: 0, roleCardId: 'opp-ready' },
          { slotIndex: 1, roleCardId: 'opp-rested' },
          { slotIndex: 2, roleCardId: 'opp-taunt' },
          { slotIndex: 3 },
          { slotIndex: 4 },
        ],
      },
      publicCards: {
        'my-rush': rushFresh,
        'my-st05001': playerEnter,
        'my-vet': normalVeteran,
        'my-bp03012': readyBypass,
        'opp-ready': oppReadyNormal,
        'opp-rested': oppRested,
        'opp-taunt': oppTaunt,
      },
    });

    expect(getAttackerCapabilities(atkState, 'p1', rushFresh)).toMatchObject({
      canAttack: true,
      canAttackCharacter: true,
      canAttackPlayer: false,
    });
    expect(getAttackerCapabilities(atkState, 'p1', playerEnter)).toMatchObject({
      canAttack: true,
      canAttackPlayer: true,
      canAttackCharacter: false,
    });

    // 对手场上有横置 BP02-010 时，普通攻击方不能打竖直或另一张横置，只能打 BP02-010
    expect(isLegalRoleAttackTarget(atkState, 'p1', normalVeteran, oppReadyNormal)).toBe(false);
    expect(isLegalRoleAttackTarget(atkState, 'p1', normalVeteran, oppRested)).toBe(false);
    expect(isLegalRoleAttackTarget(atkState, 'p1', normalVeteran, oppTaunt)).toBe(true);

    // 移除嘲讽后：普通攻击方仍不可打竖直 oppReadyNormal，而持有 canAttackReadyRolesMaxCost 的 BP03-012 可以
    const noTauntState = makeBaseGameState({
      ...atkState,
      battlefields: {
        p1: atkState.battlefields.p1,
        p2: [
          { slotIndex: 0, roleCardId: 'opp-ready' },
          { slotIndex: 1, roleCardId: 'opp-rested' },
          { slotIndex: 2 },
          { slotIndex: 3 },
          { slotIndex: 4 },
        ],
      },
    });
    expect(isLegalRoleAttackTarget(noTauntState, 'p1', normalVeteran, oppReadyNormal)).toBe(false);
    expect(isLegalRoleAttackTarget(noTauntState, 'p1', normalVeteran, oppRested)).toBe(true);
    expect(isLegalRoleAttackTarget(noTauntState, 'p1', readyBypass, oppReadyNormal)).toBe(true);

    // 2. unblockableMaxPP：modifier 与 BP01-040 4张下方牌静态规则
    const oppNanami = makeCard({
      instanceId: 'opp-040',
      cardNumber: 'BP01-040',
      ownerPlayerId: 'p2',
      controllerPlayerId: 'p2',
      underneathCardIds: ['u1', 'u2', 'u3', 'u4'],
    });
    expect(getCardUnblockableMaxPP(oppNanami, 4)).toBe(5000);

    const lowBlocker = makeCard({
      instanceId: 'blk-low',
      cardNumber: 'ST01-003',
      effectivePP: 4500,
    });
    const highBlocker = makeCard({
      instanceId: 'blk-high',
      cardNumber: 'ST01-001',
      effectivePP: 6000,
    });
    const blockState = makeBaseGameState({
      activePlayerId: 'p2',
      nonActivePlayerId: 'p1',
      priorityPlayerId: 'p1',
      phase: 'COMBAT_FREE_TIMING',
      currentCombat: {
        attackerCardId: 'opp-040',
        targetType: 'PLAYER',
        step: 'BLOCK',
        freeTimingPassCount: 0,
      },
      battlefields: {
        p1: [
          { slotIndex: 0, roleCardId: 'blk-low' },
          { slotIndex: 1, roleCardId: 'blk-high' },
          { slotIndex: 2 },
          { slotIndex: 3 },
          { slotIndex: 4 },
        ],
        p2: [
          { slotIndex: 0, roleCardId: 'opp-040' },
          ...[1, 2, 3, 4].map((slotIndex) => ({ slotIndex })),
        ],
      },
      publicCards: {
        'blk-low': lowBlocker,
        'blk-high': highBlocker,
        'opp-040': oppNanami,
      },
    });
    expect(canRoleBlockAttacker(blockState, 'p1', lowBlocker)).toBe(false);
    expect(canRoleBlockAttacker(blockState, 'p1', highBlocker)).toBe(true);

    // 3. 手牌 isHandCardLegalToPlay：明费物理卡放 COST，ST01-004 (物理2费) 可打出；ST02-001 (暗6费) 因缺暗属性且费高不可打出
    const physCost = makeCard({ instanceId: 'c-phys', cardNumber: 'ST01-004', zone: 'COST', isFaceUp: true });
    const handLegal = makeCard({ instanceId: 'h-phys', cardNumber: 'ST01-004', zone: 'HAND' });
    const handIllegal = makeCard({ instanceId: 'h-dark', cardNumber: 'ST02-001', zone: 'HAND' });
    const playState = makeBaseGameState({
      players: {
        ...makeBaseGameState().players,
        p1: {
          ...makeBaseGameState().players.p1!,
          availableOpenCostCount: 3,
        },
      },
      myHandCards: [handLegal, handIllegal],
      publicCards: { 'c-phys': physCost },
    });
    expect(isHandCardLegalToPlay(playState, 'p1', handLegal)).toBe(true);
    expect(isHandCardLegalToPlay(playState, 'p1', handIllegal)).toBe(false);
  });

  it('UI 渲染：ErosionBar 标签无重复、CardView hideStatusBadges、详情面板与弹窗展示实时数据及更新后的近似文案', () => {
    // 1. ErosionBar compact 模式不再显示「我方 我方」
    const selfErosionHtml = renderToString(
      <ErosionBar current={2} playerName="我方" compact={true} />
    ).replace(/<!-- -->/g, '');
    expect(selfErosionHtml).toContain('我方');
    expect(selfErosionHtml).toContain('侵蚀');
    expect(selfErosionHtml).not.toContain('我方我方');
    expect(selfErosionHtml).not.toContain('data-opponent-player-target');

    const oppErosionHtml = renderToString(
      <ErosionBar current={3} playerName="对手" isOpponent={true} compact={true} isAttackTargetable={true} />
    ).replace(/<!-- -->/g, '');
    expect(oppErosionHtml).toContain('data-opponent-player-target="true"');

    // 2. CardView hideStatusBadges 隐去随卡旋转的横置与 Sparkles 下方角标
    const restedUnderCard = makeCard({
      instanceId: 'cv-1',
      cardNumber: 'ST01-001',
      isReady: false,
      underneathCardIds: ['u-1', 'u-2'],
    });
    const hiddenBadgesHtml = renderToString(
      <CardView card={restedUnderCard} hideStatusBadges={true} size="full" />
    ).replace(/<!-- -->/g, '');
    expect(hiddenBadgesHtml).not.toContain('横置');

    // 3. CardDetailPanel 与 CardDetailModal 展示实时 PP/DP、修改器、禁止、冰冻、双持装备/下方/搭档及最新近似文案
    const eq1 = makeCard({ instanceId: 'eq-1', cardNumber: 'BP01-022', zone: 'BATTLEFIELD' });
    const eq2 = makeCard({ instanceId: 'eq-2', cardNumber: 'ST01-011', zone: 'BATTLEFIELD' });
    const underCard = makeCard({ instanceId: 'under-1', cardNumber: 'BP04-004', zone: 'BATTLEFIELD' });
    const partnerCard = makeCard({ instanceId: 'part-1', cardNumber: 'ST06-002', zone: 'BATTLEFIELD' });
    const richCard = makeCard({
      instanceId: 'rich-1',
      cardNumber: 'BP99-001', // 未登记卡号 => 展示更新后的近似提示文案
      isReady: false,
      isFrozen: true,
      effectivePP: 6500,
      effectiveDP: 3,
      effectiveProhibitions: ['CANNOT_ATTACK'],
      attachedEquipmentId: 'eq-1',
      extraAttachedEquipmentIds: ['eq-2'],
      underneathCardIds: ['under-1'],
      partnerCardId: 'part-1',
      modifiers: [{ pp: 1500, untilTurn: 5, source: 'BP04测试增益' }],
    });
    const publicCards = {
      'eq-1': eq1,
      'eq-2': eq2,
      'under-1': underCard,
      'part-1': partnerCard,
      'rich-1': richCard,
    };

    const richCardForRender = { ...richCard, rulesText: '【出】测试未登记效果' };

    const panelHtml = renderToString(
      <CardDetailPanel card={richCardForRender} publicCards={publicCards} effectiveCost={2} />
    ).replace(/<!-- -->/g, '');
    expect(panelHtml).toContain('横置');
    expect(panelHtml).toContain('冰冻');
    expect(panelHtml).toContain('不能攻击');
    expect(panelHtml).toContain('BP01-022');
    expect(panelHtml).toContain('ST01-011');
    expect(panelHtml).toContain('BP04-004');
    expect(panelHtml).toContain('ST06-002');
    expect(panelHtml).toContain('近似效果');
    expect(panelHtml).not.toContain('ST01~ST03');

    const modalHtml = renderToString(
      <CardDetailModal
        card={richCardForRender}
        isOpen={true}
        onClose={() => {}}
        publicCards={publicCards}
        effectiveCost={2}
      />
    ).replace(/<!-- -->/g, '');
    expect(modalHtml).toContain('冰冻');
    expect(modalHtml).toContain('不能攻击');
    expect(modalHtml).toContain('BP01-022');
    expect(modalHtml).toContain('ST01-011');
    expect(modalHtml).toContain('BP04-004');
    expect(modalHtml).toContain('ST06-002');
    expect(modalHtml).not.toContain('ST01~ST03');
  });

  it('PendingChoiceModal：渲染 maxTotalCost 费用合计、distinctTraits 特征要求及画廊/列表不可选原因', () => {
    const galleryChoice: PendingChoice = {
      id: 'pc-gallery',
      playerId: 'p1',
      choiceType: 'SELECT_OPTION',
      effectType: 'DSL_SEARCH',
      prompt: '选择费用合计不超过 6 且包含指定特征的角色：',
      minSelections: 1,
      maxSelections: 2,
      options: [
        {
          id: 'opt-ok',
          label: '露西亚·红莲',
          payload: {
            cardNumber: 'ST01-001',
            name: '露西亚·红莲',
            cost: 5,
            traits: ['灰鸦小队', '露西亚'],
            eligible: true,
          },
        },
        {
          id: 'opt-no',
          label: '露西亚·黎明',
          payload: {
            cardNumber: 'ST01-002',
            name: '露西亚·黎明',
            cost: 2,
            traits: ['灰鸦小队'],
            eligible: false,
            ineligibleReason: '同卡名已上限',
          },
        },
      ],
      metadata: {
        __dsl: {
          pendingAction: {
            maxTotalCost: 6,
            distinctTraits: ['21号', '诺克提'],
          },
        },
      },
    };
    const galleryHtml = renderToString(
      <PendingChoiceModal choice={galleryChoice} onConfirm={() => {}} />
    ).replace(/<!-- -->/g, '');
    expect(galleryHtml).toContain('费用合计：0 / 6');
    expect(galleryHtml).toContain('特征要求：&lt;21号&gt; + &lt;诺克提&gt;');
    expect(galleryHtml).toContain('同卡名已上限');

    const listChoice: PendingChoice = {
      id: 'pc-list',
      playerId: 'p1',
      choiceType: 'SELECT_OPTION',
      effectType: 'CHOOSE_OPTION',
      prompt: '选择效果：',
      minSelections: 1,
      maxSelections: 1,
      options: [
        { id: 'o1', label: '抽取1张牌' },
        {
          id: 'o2',
          label: '破坏对方角色',
          payload: { eligible: false, ineligibleReason: '对方战场无合法目标' },
        },
      ],
    };
    const listHtml = renderToString(
      <PendingChoiceModal choice={listChoice} onConfirm={() => {}} />
    ).replace(/<!-- -->/g, '');
    expect(listHtml).toContain('对方战场无合法目标');
  });

  it('静态回归扫描：apps/web/src 全仓不存在静默失效的 Tailwind v3 工具类，且无 ST01~ST03 过时文案', () => {
    const srcRoot = path.resolve(__dirname, '../src');
    const files = collectSourceFiles(srcRoot);
    const forbiddenClasses = [
      '-top-8.5',
      'z-15',
      'bg-ink-900/98',
      'backdrop-blur-xs',
      'bg-ink-950/92',
      'via-fg/12',
      'brightness-60',
      'border-line/',
    ];
    for (const file of files) {
      const content = fs.readFileSync(file, 'utf8');
      for (const badClass of forbiddenClasses) {
        expect(content, `${path.basename(file)} 仍含失效类名 ${badClass}`).not.toContain(badClass);
      }
      expect(content, `${path.basename(file)} 仍含过时 ST01~ST03 文案`).not.toContain('ST01~ST03');
    }
  });
});

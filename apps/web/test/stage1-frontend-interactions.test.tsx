import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import { CardInstance, PendingChoice, PublicGameState } from '@zhanshuang/shared';
import {
  resolveOrbDisplayInfo,
  validateOrbElimination,
  findAvailableOrbTriple,
} from '../src/lib/signal-orbs';
import {
  getUsableNonTacticsInstants,
  canRolePerformAssist,
  getAssistPartnerCandidates,
  isBattlefieldSlotEmpty,
} from '../src/lib/battle-actions';
import { SignalOrbQueueView } from '../src/components/game/SignalOrbQueueView';
import { PendingChoiceModal } from '../src/components/game/PendingChoiceModal';
import { BattlefieldArenaView } from '../src/components/game/BattlefieldArenaView';
import { CostZoneModal } from '../src/components/game/CostZoneModal';
import { CardContextMenu } from '../src/components/game/CardContextMenu';

function makeCard(overrides: Partial<CardInstance> & { instanceId: string; cardNumber: string }): CardInstance {
  return {
    cardId: `c-${overrides.cardNumber.toLowerCase()}`,
    ownerPlayerId: 'p1',
    controllerPlayerId: 'p1',
    zone: 'SIGNAL_ORB',
    underneathCardIds: [],
    isFaceUp: true,
    isReady: true,
    turnEnteredZone: 1,
    ...overrides,
  };
}

function makeBaseGameState(overrides?: Partial<PublicGameState>): PublicGameState {
  return {
    gameId: 'g-stage1',
    status: 'PLAYING',
    isDraw: false,
    turnNumber: 3,
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
        totalCostCount: 5,
        openCostCount: 5,
        availableOpenCostCount: 5,
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
        totalCostCount: 5,
        openCostCount: 5,
        availableOpenCostCount: 5,
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

describe('Stage 1A (§2.3) 前端规则与交互回归测试', () => {
  describe('信号球区规则重构 (4.16.2 & Q&A·1)', () => {
    it('禁止非相邻同色三消，仅允许物理相邻组合', () => {
      const orbs: CardInstance[] = [
        makeCard({ instanceId: 'o1', cardNumber: 'ST01-012', effectiveOrbColors: ['RED'], effectiveOrbValue: 1 }),
        makeCard({ instanceId: 'o2', cardNumber: 'ST01-013', effectiveOrbColors: ['BLUE'], effectiveOrbValue: 1 }),
        makeCard({ instanceId: 'o3', cardNumber: 'ST01-012', effectiveOrbColors: ['RED'], effectiveOrbValue: 1 }),
        makeCard({ instanceId: 'o4', cardNumber: 'ST01-012', effectiveOrbColors: ['RED'], effectiveOrbValue: 1 }),
      ];

      // 非相邻同色 [o1, o3, o4] 必须被拒
      expect(validateOrbElimination(orbs, ['o1', 'o3', 'o4']).valid).toBe(false);
      // 物理相邻 [o2, o3, o4] 合法
      const ok = validateOrbElimination(orbs, ['o4', 'o2', 'o3']);
      expect(ok.valid).toBe(true);
      expect(ok.sortedIds).toEqual(['o2', 'o3', 'o4']);

      // 一键三消不得挑非相邻的 [o1, o3, o4]
      const triple = findAvailableOrbTriple(orbs);
      expect(triple?.orbIds).toEqual(['o1', 'o2', 'o3']);
    });

    it('支持 Q&A·1 单张 effectiveOrbValue === 3 三消，并屏蔽背面球与 CANNOT_ELIMINATE', () => {
      const orbs: CardInstance[] = [
        makeCard({ instanceId: 'face-down', cardNumber: 'HIDDEN', isFaceUp: false }),
        makeCard({
          instanceId: 'locked',
          cardNumber: 'ST01-012',
          effectiveOrbColors: ['RED'],
          effectiveOrbValue: 1,
          effectiveProhibitions: ['CANNOT_ELIMINATE'],
        }),
        makeCard({
          instanceId: 'wanshiming',
          cardNumber: 'BP01-037',
          effectiveOrbColors: ['BLUE'],
          effectiveOrbValue: 3,
        }),
      ];

      expect(resolveOrbDisplayInfo(orbs[0]!, 0).isEliminatable).toBe(false);
      expect(resolveOrbDisplayInfo(orbs[0]!, 0).label).toBe('暗');
      expect(resolveOrbDisplayInfo(orbs[1]!, 1).isEliminatable).toBe(false);
      expect(validateOrbElimination(orbs, ['wanshiming']).valid).toBe(true);
      expect(findAvailableOrbTriple(orbs)?.orbIds).toEqual(['wanshiming']);

      const html = renderToString(
        <SignalOrbQueueView
          orbs={orbs}
          selectedOrbIds={['wanshiming']}
          onEliminate={() => {}}
        />
      );
      expect(html).toContain('暗');
      expect(html).toContain('x3');
      expect(html).toContain('三消抽牌 [X]');
    });
  });

  describe('PendingChoiceModal 8.6.3 与横向滚动修复', () => {
    it('合法目标少于 minSelections 时按 8.6.3 提示可用上限，且画廊使用 justify-start', () => {
      const choice: PendingChoice = {
        id: 'choice-863',
        playerId: 'p1',
        choiceType: 'SELECT_CARDS',
        effectType: 'SEARCH_TOP_CARDS',
        prompt: '请选择最多2张角色',
        minSelections: 2,
        maxSelections: 2,
        options: [
          { id: 'c1', label: '可选卡', payload: { cardNumber: 'ST01-001', eligible: true } },
          { id: 'c2', label: '不可选卡', payload: { cardNumber: 'ST01-002', eligible: false } },
        ],
      };

      const html = renderToString(
        <PendingChoiceModal choice={choice} onConfirm={() => {}} />
      ).replace(/<!-- -->/g, '');
      expect(html).toContain('justify-start');
      expect(html).toContain('选满 1 张即可');
      expect(html).toContain('0 / 1 已选');
    });
  });

  describe('战场辅助机 / 独立装备渲染与 PERFORM_ASSIST / USE_INSTANT 接线', () => {
    it('渲染战场辅助机、单独占位装备，并展示协战与非战术瞬时入口', () => {
      const st06Host = makeCard({
        instanceId: 'role-st06',
        cardNumber: 'ST06-001',
        zone: 'BATTLEFIELD',
        slotIndex: 0,
      });
      const lunaHost = makeCard({
        instanceId: 'role-luna',
        cardNumber: 'BP04-001',
        zone: 'BATTLEFIELD',
        slotIndex: 1,
        underneathCardIds: ['u-bp04-007'],
      });
      const underneath007 = makeCard({
        instanceId: 'u-bp04-007',
        cardNumber: 'BP04-007',
        zone: 'BATTLEFIELD',
      });
      const standaloneEquip = makeCard({
        instanceId: 'eq-1',
        cardNumber: 'ST01-011',
        zone: 'BATTLEFIELD',
        slotIndex: 2,
      });
      const assistCub = makeCard({
        instanceId: 'assist-1',
        cardNumber: 'BP01-046',
        zone: 'BATTLEFIELD',
        slotIndex: 3,
      });
      const cost054 = makeCard({
        instanceId: 'cost-054',
        cardNumber: 'BP03-054',
        zone: 'COST',
        isFaceUp: true,
      });
      const artRole = makeCard({
        instanceId: 'role-art',
        cardNumber: 'BP01-075',
        zone: 'BATTLEFIELD',
        slotIndex: 0,
        effectiveTraits: ['艺术协会'],
      });
      const handPartner = makeCard({
        instanceId: 'hand-cecil',
        cardNumber: 'ST06-002',
        zone: 'HAND',
      });

      const state = makeBaseGameState({
        phase: 'COMBAT_FREE_TIMING',
        timingWindow: { kind: 'FREE_TIMING', priorityPlayerId: 'p1', consecutivePasses: 0 },
        currentCombat: {
          step: 'FREE_TIMING',
          attackerCardId: 'opp-atk',
          targetType: 'PLAYER',
          freeTimingPassCount: 0,
        },
        myHandCards: [handPartner],
        battlefields: {
          p1: [
            { slotIndex: 0, roleCardId: 'role-st06' },
            { slotIndex: 1, roleCardId: 'role-luna' },
            { slotIndex: 2, standaloneEquipmentId: 'eq-1' },
            { slotIndex: 3, assistCardId: 'assist-1' },
            { slotIndex: 4 },
          ],
          p2: [
            { slotIndex: 0, roleCardId: 'role-art' },
            { slotIndex: 1 },
            { slotIndex: 2 },
            { slotIndex: 3 },
            { slotIndex: 4 },
          ],
        },
        publicCards: {
          'role-st06': st06Host,
          'role-luna': lunaHost,
          'u-bp04-007': underneath007,
          'eq-1': standaloneEquip,
          'assist-1': assistCub,
          'cost-054': cost054,
          'role-art': artRole,
        },
      });

      // Slot 空闲判定不把 assist/standaloneEquipment 误判为空
      expect(isBattlefieldSlotEmpty(state.battlefields.p1[2]!)).toBe(false);
      expect(isBattlefieldSlotEmpty(state.battlefields.p1[3]!)).toBe(false);
      expect(isBattlefieldSlotEmpty(state.battlefields.p1[4]!)).toBe(true);

      // 8.13 协战检测
      expect(canRolePerformAssist(state, 'p1', st06Host)).toBe(true);
      const partners = getAssistPartnerCandidates(state, 'p1', st06Host);
      expect(partners.some((p) => p.card.instanceId === 'hand-cecil' && p.matchesFilter)).toBe(true);

      // 10.8 非战术瞬时检测（露娜下方 BP04-007；给 role-st06 临时赋予艺术协会特征以测 BP03-054）
      st06Host.effectiveTraits = ['艺术协会'];
      const instants = getUsableNonTacticsInstants(state, 'p1');
      expect(instants.map((i) => i.card.instanceId)).toEqual(
        expect.arrayContaining(['cost-054', 'u-bp04-007'])
      );

      // BattlefieldArenaView 渲染辅助机、独立装备、协战按钮与非战术瞬时快捷按钮
      const arenaHtml = renderToString(
        <BattlefieldArenaView
          gameState={state}
          resolvedMyUserId="p1"
          opponentUserId="p2"
          isMyTurn={true}
          selectedHandCardId={null}
          selectedBattlefieldCardId={null}
          attackAnim={null}
          myGraveyardCards={[]}
          opponentGraveyardCards={[]}
          usableNonTacticsInstants={instants}
          onRoleClick={() => {}}
          onRoleDoubleClick={() => {}}
          onRoleContextMenu={() => {}}
          onRoleLongPress={() => {}}
          onRoleHover={() => {}}
          onSlotClick={() => {}}
          onActivateAbility={() => {}}
          onAttackClick={() => {}}
          onBlockClick={() => {}}
          onEquipStartClick={() => {}}
          onPerformAssistClick={() => {}}
          onUseInstant={() => {}}
          onPassTiming={() => {}}
          onDropCardToSlot={() => {}}
          onDropAttackTarget={() => {}}
          onDropEquipToRole={() => {}}
          onInspectCard={() => {}}
          onOpenGraveyard={() => {}}
        />
      ).replace(/<!-- -->/g, '');
      expect(arenaHtml).toContain('辅助机');
      expect(arenaHtml).toContain('独立装备');
      expect(arenaHtml).toContain('协战');
      expect(arenaHtml).toContain('明费区·');
      expect(arenaHtml).toContain('露娜下方·');

      // CostZoneModal 为可用非战术瞬时明费卡提供发动按钮
      const costHtml = renderToString(
        <CostZoneModal
          isOpen={true}
          onClose={() => {}}
          cards={[cost054]}
          availableCount={5}
          totalCount={5}
          hiddenCount={0}
          usableInstantCardIds={new Set(['cost-054'])}
          onUseInstant={() => {}}
        />
      );
      expect(costHtml).toContain('发动【瞬时】');

      // CardContextMenu 为独立装备提供「装备给己方角色」入口
      const menuHtml = renderToString(
        <CardContextMenu
          x={100}
          y={100}
          card={standaloneEquip}
          isMyTurn={true}
          phase="MAIN_PHASE"
          myAvailableCost={5}
          isFriendlyRole={true}
          isOpponentRole={false}
          isStandaloneEquipment={true}
          isHandCard={false}
          canActivateAbility={false}
          canAttack={false}
          canBlock={false}
          canEquipStandalone={true}
          hasEmptySlot={true}
          hasSelectedAttacker={false}
          onStartEquipStandalone={() => {}}
          onClose={() => {}}
        />
      );
      expect(menuHtml).toContain('装备给己方角色');
    });
  });
});

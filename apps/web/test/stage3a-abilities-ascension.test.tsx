import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import { CardInstance, CardType, PublicGameState } from '@zhanshuang/shared';
import { parseAscensionConfig } from '@zhanshuang/game-rules';
import {
  getSlotOccupancy,
  isSlotEffectiveRoleCard,
  canPlayAssistOnSlot,
  getCardActivatedAbilityOptions,
  getZoneActivatedAbilityCardMap,
  getNonHandPlayAction,
  getAscensionPlan,
} from '../src/lib/battle-actions';
import { AscensionModal } from '../src/components/game/AscensionModal';
import { UnderneathCardsModal } from '../src/components/game/UnderneathCardsModal';
import { CardContextMenu } from '../src/components/game/CardContextMenu';
import { BattlefieldArenaView } from '../src/components/game/BattlefieldArenaView';
import { GraveyardModal } from '../src/components/game/GraveyardModal';
import { CostZoneModal } from '../src/components/game/CostZoneModal';
import { SignalOrbQueueView } from '../src/components/game/SignalOrbQueueView';
import { ProcessingZoneView } from '../src/components/game/ProcessingZoneView';

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
    gameId: 'g-stage3a',
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

describe('Stage 3A (§3.3.1) 全区域【起】与特殊升变 UI 回归测试', () => {
  it('共享导出 parseAscensionConfig 可正确解析多种升变规则', () => {
    const cfgMulti = parseAscensionConfig(
      '【升变条件】 费用为99以下的<露娜>角色1张及以上\n【升变代价】【3费】'
    );
    expect(cfgMulti?.targetFilter.allowMultiple).toBe(true);
    expect(cfgMulti?.targetFilter.minCount).toBe(1);
    expect(cfgMulti?.ascensionCost).toBe(3);

    const cfgOrb = parseAscensionConfig(
      '【升变对象】信号球区中费用为8以下的<比安卡>\n【升变费用】【2费】'
    );
    expect(cfgOrb?.targetFilter.targetZones).toEqual(['SIGNAL_ORB']);
    expect(cfgOrb?.ascensionCost).toBe(2);
  });

  describe('PR-041 / BP04-001 变身有效卡类与战场渲染', () => {
    it('PR-041 变为角色渲染「变身角色」徽章与 PP/DP 并允许攻击/作为敌方攻击目标；BP04-001 变为辅助机显示「变身辅助机」', () => {
      const pr041Self = makeCard({
        instanceId: 'my-pr041',
        cardNumber: 'PR-041',
        zone: 'BATTLEFIELD',
        slotIndex: 0,
        effectivePP: 5500,
        effectiveDP: 2,
        modifiers: [{ setCardType: CardType.ROLE, timestamp: 10 }],
      });
      const bp04001Self = makeCard({
        instanceId: 'my-luna-assist',
        cardNumber: 'BP04-001',
        zone: 'BATTLEFIELD',
        slotIndex: 1,
        modifiers: [{ setCardType: CardType.ASSIST, timestamp: 11 }],
      });
      const pr041Opp = makeCard({
        instanceId: 'opp-pr041',
        cardNumber: 'PR-041',
        ownerPlayerId: 'p2',
        controllerPlayerId: 'p2',
        zone: 'BATTLEFIELD',
        slotIndex: 0,
        effectivePP: 5000,
        effectiveDP: 1,
        modifiers: [{ setCardType: CardType.ROLE, timestamp: 12 }],
      });

      const state = makeBaseGameState({
        battlefields: {
          p1: [
            { slotIndex: 0, assistCardId: 'my-pr041' },
            { slotIndex: 1, roleCardId: 'my-luna-assist' },
            { slotIndex: 2 },
            { slotIndex: 3 },
            { slotIndex: 4 },
          ],
          p2: [
            { slotIndex: 0, assistCardId: 'opp-pr041' },
            { slotIndex: 1 },
            { slotIndex: 2 },
            { slotIndex: 3 },
            { slotIndex: 4 },
          ],
        },
        publicCards: {
          'my-pr041': pr041Self,
          'my-luna-assist': bp04001Self,
          'opp-pr041': pr041Opp,
        },
      });

      expect(getSlotOccupancy(state.battlefields.p1[0]!, state.publicCards).kind).toBe('ROLE');
      expect(getSlotOccupancy(state.battlefields.p1[0]!, state.publicCards).isTransformed).toBe(true);
      expect(isSlotEffectiveRoleCard(state.battlefields.p1[0]!, state.publicCards, 'my-pr041')).toBe(true);

      expect(getSlotOccupancy(state.battlefields.p1[1]!, state.publicCards).kind).toBe('ASSIST');
      expect(getSlotOccupancy(state.battlefields.p1[1]!, state.publicCards).isTransformed).toBe(true);
      expect(isSlotEffectiveRoleCard(state.battlefields.p1[1]!, state.publicCards, 'my-luna-assist')).toBe(false);

      // 8.6.2.b.2 辅助机槽位判定：普通辅助机槽位为 true；PR-041 变身角色与占 roleCardId 的 BP04-001 变身辅助机均为 false
      const normalAssist = makeCard({
        instanceId: 'my-normal-assist',
        cardNumber: 'BP01-046',
        zone: 'BATTLEFIELD',
        slotIndex: 2,
      });
      const bp03042Standalone = makeCard({
        instanceId: 'my-gungnir',
        cardNumber: 'BP03-042',
        zone: 'BATTLEFIELD',
        slotIndex: 3,
      });
      const stateWithAssistAndStandalone = makeBaseGameState({
        battlefields: {
          p1: [
            { slotIndex: 0, assistCardId: 'my-pr041' },
            { slotIndex: 1, roleCardId: 'my-luna-assist' },
            { slotIndex: 2, assistCardId: 'my-normal-assist' },
            { slotIndex: 3, standaloneEquipmentId: 'my-gungnir' },
            { slotIndex: 4 },
          ],
          p2: state.battlefields.p2,
        },
        publicCards: {
          ...state.publicCards,
          'my-normal-assist': normalAssist,
          'my-gungnir': bp03042Standalone,
        },
      });
      expect(canPlayAssistOnSlot(stateWithAssistAndStandalone.battlefields.p1[0]!, stateWithAssistAndStandalone.publicCards)).toBe(false);
      expect(canPlayAssistOnSlot(stateWithAssistAndStandalone.battlefields.p1[1]!, stateWithAssistAndStandalone.publicCards)).toBe(false);
      expect(canPlayAssistOnSlot(stateWithAssistAndStandalone.battlefields.p1[2]!, stateWithAssistAndStandalone.publicCards)).toBe(true);

      const arenaHtml = renderToString(
        <BattlefieldArenaView
          gameState={stateWithAssistAndStandalone}
          resolvedMyUserId="p1"
          opponentUserId="p2"
          isMyTurn={true}
          selectedHandCardId={null}
          selectedBattlefieldCardId="my-pr041"
          attackAnim={null}
          myGraveyardCards={[]}
          opponentGraveyardCards={[]}
          onRoleClick={() => {}}
          onRoleDoubleClick={() => {}}
          onRoleContextMenu={() => {}}
          onRoleLongPress={() => {}}
          onRoleHover={() => {}}
          onSlotClick={() => {}}
          onActivateAbility={() => {}}
          onAttackClick={() => {}}
          onBlockClick={() => {}}
          onPassTiming={() => {}}
          onDropCardToSlot={() => {}}
          onDropAttackTarget={() => {}}
          onInspectCard={() => {}}
          onOpenGraveyard={() => {}}
        />
      ).replace(/<!-- -->/g, '');

      expect(arenaHtml).toContain('变身角色');
      expect(arenaHtml).toContain('5500/2');
      expect(arenaHtml).toContain('变身辅助机');
      expect(arenaHtml).toContain('data-opponent-role-id="opp-pr041"');
      expect(arenaHtml).toContain('攻击');
      expect(arenaHtml).toContain('独立装备');
      expect(arenaHtml).toContain('发动效果');
    });
  });

  describe('全区域【起】检测与 UI 渲染（含多【起】/装备【起】/失能/非战场隔离）', () => {
    it('准确解析手牌、墓地、明费、信号球、下方、战场多【起】及装备赋予【起】，并过滤失能与非战场【起】', () => {
      const hand002 = makeCard({ instanceId: 'hand-002', cardNumber: 'BP03-002', zone: 'HAND' });
      const field002 = makeCard({ instanceId: 'field-002', cardNumber: 'BP03-002', zone: 'BATTLEFIELD', slotIndex: 4 });
      const gy050 = makeCard({ instanceId: 'gy-050', cardNumber: 'BP04-050', zone: 'GRAVEYARD' });
      const cost045 = makeCard({ instanceId: 'cost-045', cardNumber: 'BP03-045', zone: 'COST', isFaceUp: true });
      const costHidden = makeCard({ instanceId: 'cost-hid', cardNumber: 'BP03-047', zone: 'COST', isFaceUp: false });
      const orb061 = makeCard({ instanceId: 'orb-061', cardNumber: 'BP04-061', zone: 'SIGNAL_ORB', isFaceUp: true });
      const jiulongHost = makeCard({
        instanceId: 'host-jiulong',
        cardNumber: 'BP04-077',
        zone: 'BATTLEFIELD',
        slotIndex: 0,
        effectiveTraits: ['九龙商会', '含英'],
        underneathCardIds: ['u-077'],
      });
      const under077 = makeCard({ instanceId: 'u-077', cardNumber: 'BP04-077', zone: 'BATTLEFIELD' });
      const multi025 = makeCard({ instanceId: 'assist-025', cardNumber: 'BP02-025', zone: 'BATTLEFIELD', slotIndex: 1 });
      const crimsonWeave = makeCard({
        instanceId: 'role-cw',
        cardNumber: 'BP01-016',
        zone: 'BATTLEFIELD',
        slotIndex: 2,
        attachedEquipmentId: 'eq-1',
        extraAttachedEquipmentIds: ['eq-2'],
      });
      const eq1 = makeCard({ instanceId: 'eq-1', cardNumber: 'BP01-022', zone: 'BATTLEFIELD' });
      const eq2 = makeCard({ instanceId: 'eq-2', cardNumber: 'BP01-022', zone: 'BATTLEFIELD' });
      const disabledRole = makeCard({
        instanceId: 'role-disabled',
        cardNumber: 'BP02-025',
        zone: 'BATTLEFIELD',
        slotIndex: 3,
        modifiers: [{ loseAbilities: true, untilTurn: 4 }],
      });

      const state = makeBaseGameState({
        myHandCards: [hand002],
        battlefields: {
          p1: [
            { slotIndex: 0, roleCardId: 'host-jiulong' },
            { slotIndex: 1, assistCardId: 'assist-025' },
            { slotIndex: 2, roleCardId: 'role-cw' },
            { slotIndex: 3, roleCardId: 'role-disabled' },
            { slotIndex: 4, roleCardId: 'field-002' },
          ],
          p2: [0, 1, 2, 3, 4].map((slotIndex) => ({ slotIndex })),
        },
        publicCards: {
          'field-002': field002,
          'gy-050': gy050,
          'cost-045': cost045,
          'cost-hid': costHidden,
          'orb-061': orb061,
          'host-jiulong': jiulongHost,
          'u-077': under077,
          'assist-025': multi025,
          'role-cw': crimsonWeave,
          'eq-1': eq1,
          'eq-2': eq2,
          'role-disabled': disabledRole,
        },
      });

      const map = getZoneActivatedAbilityCardMap(state, 'p1');
      expect(map['hand-002']?.[0]?.zone).toBe('HAND');
      expect(map['hand-002']?.[0]?.abilityIndex).toBe(0);
      expect(map['gy-050']?.[0]?.zone).toBe('GRAVEYARD');
      expect(map['gy-050']?.[0]?.abilityIndex).toBe(0);
      expect(map['cost-045']?.[0]?.zone).toBe('COST');
      expect(map['cost-045']?.[0]?.abilityIndex).toBe(0);
      expect(map['cost-hid']).toBeUndefined();
      expect(map['orb-061']?.[0]?.zone).toBe('SIGNAL_ORB');
      expect(map['orb-061']?.[0]?.abilityIndex).toBe(0);
      expect(map['u-077']?.[0]?.zone).toBe('UNDERNEATH');
      expect(map['u-077']?.[0]?.abilityIndex).toBe(0);

      // 非战场专属【起】在战场不误亮
      expect(map['field-002']).toBeUndefined();
      // 8.3.4 失能屏蔽
      expect(map['role-disabled']).toBeUndefined();

      // BP02-025 多【起】精确索引 0 / 1
      expect(map['assist-025']?.map((o) => o.abilityIndex)).toEqual([0, 1]);

      // 露西亚·深红囚影 + 双持 BP01-022 装备赋予【起】
      const cwOpts = getCardActivatedAbilityOptions(state, 'p1', crimsonWeave, 'BATTLEFIELD');
      expect(cwOpts.filter((o) => Boolean(o.grantedByEquipmentId)).length).toBe(2);
      expect(cwOpts.map((o) => o.abilityIndex)).toEqual([0, 1, 2]);

      // 渲染验证：双持数量、多【起】按钮、下方 N 按钮
      const arenaHtml = renderToString(
        <BattlefieldArenaView
          gameState={state}
          resolvedMyUserId="p1"
          opponentUserId="p2"
          isMyTurn={true}
          selectedHandCardId={null}
          selectedBattlefieldCardId={null}
          attackAnim={null}
          myGraveyardCards={[gy050]}
          opponentGraveyardCards={[]}
          onRoleClick={() => {}}
          onRoleDoubleClick={() => {}}
          onRoleContextMenu={() => {}}
          onRoleLongPress={() => {}}
          onRoleHover={() => {}}
          onSlotClick={() => {}}
          onActivateAbility={() => {}}
          onOpenUnderneath={() => {}}
          onAttackClick={() => {}}
          onBlockClick={() => {}}
          onPassTiming={() => {}}
          onDropCardToSlot={() => {}}
          onDropAttackTarget={() => {}}
          onInspectCard={() => {}}
          onOpenGraveyard={() => {}}
        />
      ).replace(/<!-- -->/g, '');
      expect(arenaHtml).toContain('装备×2');
      expect(arenaHtml).toContain('发动效果 (2)');
      expect(arenaHtml).toContain('下方 1');

      // CardContextMenu：多【起】 + [装备] 标签 + 查看下方牌
      const cwMenuHtml = renderToString(
        <CardContextMenu
          x={50}
          y={50}
          card={crimsonWeave}
          isMyTurn={true}
          phase="MAIN_PHASE"
          myAvailableCost={8}
          isFriendlyRole={true}
          isOpponentRole={false}
          isHandCard={false}
          activateOptions={cwOpts}
          underneathCardsCount={0}
          canAttack={false}
          canBlock={false}
          hasEmptySlot={false}
          hasSelectedAttacker={false}
          onOpenUnderneath={() => {}}
          onClose={() => {}}
        />
      );
      expect(cwMenuHtml).toContain('[装备]');

      const hostMenuHtml = renderToString(
        <CardContextMenu
          x={50}
          y={50}
          card={jiulongHost}
          isMyTurn={true}
          phase="MAIN_PHASE"
          myAvailableCost={8}
          isFriendlyRole={true}
          isOpponentRole={false}
          isHandCard={false}
          activateOptions={map['host-jiulong']}
          underneathCardsCount={1}
          canAttack={false}
          canBlock={false}
          hasEmptySlot={false}
          hasSelectedAttacker={false}
          onOpenUnderneath={() => {}}
          onClose={() => {}}
        />
      ).replace(/<!-- -->/g, '');
      expect(hostMenuHtml).toContain('查看下方牌 (1)');

      // Hand CardContextMenu: HAND【起】
      const handMenuHtml = renderToString(
        <CardContextMenu
          x={50}
          y={50}
          card={hand002}
          isMyTurn={true}
          phase="MAIN_PHASE"
          myAvailableCost={8}
          isFriendlyRole={false}
          isOpponentRole={false}
          isHandCard={true}
          activateOptions={map['hand-002']}
          handAscensionPlan={null}
          canAttack={false}
          canBlock={false}
          hasEmptySlot={true}
          hasSelectedAttacker={false}
          onClose={() => {}}
        />
      );
      expect(handMenuHtml).toContain('直接【浮空】');

      // GraveyardModal / CostZoneModal / SignalOrbQueueView
      const gyHtml = renderToString(
        <GraveyardModal
          isOpen={true}
          onClose={() => {}}
          cards={[gy050]}
          isFriendly={true}
          abilityOptionsByCardId={map}
          onActivateAbility={() => {}}
        />
      );
      expect(gyHtml).toContain('发动【起】');

      const costHtml = renderToString(
        <CostZoneModal
          isOpen={true}
          onClose={() => {}}
          cards={[cost045]}
          availableCount={8}
          totalCount={8}
          hiddenCount={0}
          abilityOptionsByCardId={map}
          onActivateAbility={() => {}}
        />
      );
      expect(costHtml).toContain('发动【起】');

      const orbHtml = renderToString(
        <SignalOrbQueueView
          orbs={[orb061]}
          selectedOrbIds={[]}
          abilityOptionsByCardId={map}
          onActivateAbility={() => {}}
        />
      ).replace(/<!-- -->/g, '');
      expect(orbHtml).toContain('信号球【起】');
    });
  });

  describe('非手牌区出牌与 UnderneathCardsModal', () => {
    it('支持 BP02-026 墓地升变、BP02-036 墓地使用战术、BP04-011 下方使用战术及 UnderneathCardsModal 渲染', () => {
      const gy026 = makeCard({ instanceId: 'gy-026', cardNumber: 'BP02-026', zone: 'GRAVEYARD' });
      const gy036 = makeCard({ instanceId: 'gy-036', cardNumber: 'BP02-036', zone: 'GRAVEYARD' });
      const lunaHost = makeCard({
        instanceId: 'host-luna',
        cardNumber: 'BP04-001',
        zone: 'BATTLEFIELD',
        slotIndex: 0,
        underneathCardIds: ['u-011', 'u-007'],
      });
      const under011 = makeCard({ instanceId: 'u-011', cardNumber: 'BP04-011', zone: 'BATTLEFIELD' });
      const under007 = makeCard({ instanceId: 'u-007', cardNumber: 'BP04-007', zone: 'BATTLEFIELD' });

      const mainState = makeBaseGameState({
        battlefields: {
          p1: [{ slotIndex: 0, roleCardId: 'host-luna' }, 1, 2, 3, 4].map((v, i) =>
            typeof v === 'number' ? { slotIndex: i } : v
          ),
          p2: [0, 1, 2, 3, 4].map((slotIndex) => ({ slotIndex })),
        },
        publicCards: {
          'gy-026': gy026,
          'gy-036': gy036,
          'host-luna': lunaHost,
          'u-011': under011,
          'u-007': under007,
        },
      });

      const act026 = getNonHandPlayAction(mainState, 'p1', gy026);
      const act036 = getNonHandPlayAction(mainState, 'p1', gy036);
      expect(act026?.kind).toBe('ASCEND_FROM_GRAVEYARD');
      expect(act036?.kind).toBe('PLAY_TACTICS_FROM_GRAVEYARD');

      const gyHtml = renderToString(
        <GraveyardModal
          isOpen={true}
          onClose={() => {}}
          cards={[gy026, gy036]}
          isFriendly={true}
          nonHandActionsByCardId={{
            'gy-026': act026!,
            'gy-036': act036!,
          }}
          onNonHandPlay={() => {}}
        />
      );
      expect(gyHtml).toContain('墓地升变');
      expect(gyHtml).toContain('墓地使用战术');

      // 敌方攻击玩家自由时点：BP04-011 与 BP04-007
      const freeTimingState = makeBaseGameState({
        activePlayerId: 'p2',
        nonActivePlayerId: 'p1',
        phase: 'COMBAT_FREE_TIMING',
        timingWindow: { kind: 'FREE_TIMING', priorityPlayerId: 'p1', consecutivePasses: 0 },
        currentCombat: {
          step: 'FREE_TIMING',
          attackerCardId: 'opp-1',
          targetType: 'PLAYER',
          freeTimingPassCount: 0,
        },
        battlefields: mainState.battlefields,
        publicCards: mainState.publicCards,
      });

      const act011 = getNonHandPlayAction(freeTimingState, 'p1', under011, lunaHost);
      expect(act011?.kind).toBe('PLAY_TACTICS_FROM_UNDERNEATH');

      const friendlyUnderHtml = renderToString(
        <UnderneathCardsModal
          isOpen={true}
          onClose={() => {}}
          hostCard={lunaHost}
          gameState={freeTimingState}
          myUserId="p1"
          isFriendly={true}
          onActivateAbility={() => {}}
          onUseInstant={() => {}}
          onNonHandPlay={() => {}}
        />
      );
      expect(friendlyUnderHtml).toContain('role="dialog"');
      expect(friendlyUnderHtml).toContain('aria-modal="true"');
      expect(friendlyUnderHtml).toContain('使用《升空凌视》');
      expect(friendlyUnderHtml).toContain('发动非战术【瞬时】');

      // 敌方检视模式不渲染己方操作按钮
      const oppUnderHtml = renderToString(
        <UnderneathCardsModal
          isOpen={true}
          onClose={() => {}}
          hostCard={lunaHost}
          gameState={freeTimingState}
          myUserId="p1"
          isFriendly={false}
        />
      );
      expect(oppUnderHtml).not.toContain('使用《升空凌视》');
      expect(oppUnderHtml).not.toContain('发动非战术【瞬时】');
    });
  });

  describe('特殊升变计划与 AscensionModal（多选 / 帕瓦额外代价 / 信号球正面 / 浮空 / 增费）', () => {
    it('BP04-001 多选升变渲染有序提示；BP01-040 展示帕瓦额外代价与排除逻辑', () => {
      const handLuna = makeCard({ instanceId: 'h-bp04-001', cardNumber: 'BP04-001', zone: 'HAND' });
      const lunaTarget1 = makeCard({ instanceId: 'f-luna-1', cardNumber: 'BP04-002', zone: 'BATTLEFIELD', slotIndex: 0 });
      const lunaTarget2 = makeCard({ instanceId: 'f-luna-2', cardNumber: 'BP01-009', zone: 'BATTLEFIELD', slotIndex: 1, isReady: false });
      const oppWanshi = makeCard({
        instanceId: 'opp-wanshi',
        cardNumber: 'BP02-067',
        ownerPlayerId: 'p2',
        controllerPlayerId: 'p2',
        zone: 'BATTLEFIELD',
        slotIndex: 0,
        isReady: false,
      });

      const lunaState = makeBaseGameState({
        myHandCards: [handLuna],
        battlefields: {
          p1: [
            { slotIndex: 0, roleCardId: 'f-luna-1' },
            { slotIndex: 1, roleCardId: 'f-luna-2' },
            { slotIndex: 2 },
            { slotIndex: 3 },
            { slotIndex: 4 },
          ],
          p2: [
            { slotIndex: 0, roleCardId: 'opp-wanshi' },
            { slotIndex: 1 },
            { slotIndex: 2 },
            { slotIndex: 3 },
            { slotIndex: 4 },
          ],
        },
        publicCards: {
          'f-luna-1': lunaTarget1,
          'f-luna-2': lunaTarget2,
          'opp-wanshi': oppWanshi,
        },
      });

      const lunaPlan = getAscensionPlan(lunaState, 'p1', handLuna)!;
      expect(lunaPlan.allowMultiple).toBe(true);
      expect(lunaPlan.tappedOpponentTaxCount).toBe(1);

      const lunaModalHtml = renderToString(
        <AscensionModal
          isOpen={true}
          plan={lunaPlan}
          initialTargetCardId="f-luna-2"
          onConfirm={() => {}}
          onClose={() => {}}
        />
      ).replace(/<!-- -->/g, '');
      expect(lunaModalHtml).toContain('role="dialog"');
      expect(lunaModalHtml).toContain('aria-modal="true"');
      expect(lunaModalHtml).toContain('第 1 张决定落位与继承装备');
      expect(lunaModalHtml).toContain('#1');
      expect(lunaModalHtml).toContain('对手横置《万事·明晰梦》增费 +1');

      // BP01-040 帕瓦额外代价与受限条件
      const handNanami = makeCard({ instanceId: 'h-bp01-040', cardNumber: 'BP01-040', zone: 'HAND' });
      const nanamiField = makeCard({ instanceId: 'f-nanami', cardNumber: 'BP01-041', zone: 'BATTLEFIELD', slotIndex: 0 });
      const pavaField = makeCard({ instanceId: 'f-pava', cardNumber: 'BP01-049', zone: 'BATTLEFIELD', slotIndex: 1 });
      const nanamiState = makeBaseGameState({
        players: {
          p1: { ...makeBaseGameState().players.p1!, totalCostCount: 6 },
          p2: makeBaseGameState().players.p2!,
        },
        myHandCards: [handNanami],
        battlefields: {
          p1: [
            { slotIndex: 0, roleCardId: 'f-nanami' },
            { slotIndex: 1, roleCardId: 'f-pava' },
            { slotIndex: 2 },
            { slotIndex: 3 },
            { slotIndex: 4 },
          ],
          p2: [0, 1, 2, 3, 4].map((slotIndex) => ({ slotIndex })),
        },
        publicCards: {
          'f-nanami': nanamiField,
          'f-pava': pavaField,
        },
      });
      const nanamiPlan = getAscensionPlan(nanamiState, 'p1', handNanami)!;
      expect(nanamiPlan.restrictionError).toContain('费用上限需达到 8');
      expect(nanamiPlan.extraCostCandidates.map((c) => c.card.instanceId)).toEqual(['f-pava']);

      const nanamiModalHtml = renderToString(
        <AscensionModal
          isOpen={true}
          plan={nanamiPlan}
          onConfirm={() => {}}
          onClose={() => {}}
        />
      ).replace(/<!-- -->/g, '');
      expect(nanamiModalHtml).toContain('额外升变代价');
      expect(nanamiModalHtml).toContain('帕瓦');
      expect(nanamiModalHtml).toContain('费用上限需达到 8');
    });

    it('BP04-061 信号球区正面升变与 BP03-001 浮空模式升变渲染空卡位选择器', () => {
      const handBianca = makeCard({ instanceId: 'h-bp04-061', cardNumber: 'BP04-061', zone: 'HAND' });
      const orbBianca = makeCard({ instanceId: 'orb-bianca', cardNumber: 'BP02-022', zone: 'SIGNAL_ORB', isFaceUp: true });
      const handLucia = makeCard({ instanceId: 'h-bp03-001', cardNumber: 'BP03-001', zone: 'HAND' });
      const airborneLucia = makeCard({
        instanceId: 'air-lucia',
        cardNumber: 'BP03-002',
        zone: 'PROCESSING',
        isAirborne: true,
      });

      const state = makeBaseGameState({
        myHandCards: [handBianca, handLucia],
        battlefields: {
          p1: [
            { slotIndex: 0 },
            { slotIndex: 1 },
            { slotIndex: 2 },
            { slotIndex: 3 },
            { slotIndex: 4 },
          ],
          p2: [0, 1, 2, 3, 4].map((slotIndex) => ({ slotIndex })),
        },
        publicCards: {
          'orb-bianca': orbBianca,
          'air-lucia': airborneLucia,
        },
      });

      const biancaPlan = getAscensionPlan(state, 'p1', handBianca)!;
      expect(biancaPlan.targets[0]?.zone).toBe('SIGNAL_ORB');
      expect(biancaPlan.targets[0]?.requiresEmptySlot).toBe(true);

      const biancaHtml = renderToString(
        <AscensionModal
          isOpen={true}
          plan={biancaPlan}
          onConfirm={() => {}}
          onClose={() => {}}
        />
      ).replace(/<!-- -->/g, '');
      expect(biancaHtml).toContain('信号球区正面');
      expect(biancaHtml).toContain('卡位 1');

      const luciaPlan = getAscensionPlan(state, 'p1', handLucia)!;
      expect(luciaPlan.targets[0]?.zone).toBe('AIRBORNE');
      expect(luciaPlan.targets[0]?.requiresEmptySlot).toBe(true);

      const luciaHtml = renderToString(
        <AscensionModal
          isOpen={true}
          plan={luciaPlan}
          onConfirm={() => {}}
          onClose={() => {}}
        />
      ).replace(/<!-- -->/g, '');
      expect(luciaHtml).toContain('浮空模式');
      expect(luciaHtml).toContain('卡位 1');

      // 信号球正面升变无空余卡位时禁用确认并提示
      const fullSlotsState = makeBaseGameState({
        myHandCards: [handBianca],
        battlefields: {
          p1: [0, 1, 2, 3, 4].map((slotIndex) => ({
            slotIndex,
            roleCardId: `filler-${slotIndex}`,
          })),
          p2: [0, 1, 2, 3, 4].map((slotIndex) => ({ slotIndex })),
        },
        publicCards: {
          'orb-bianca': orbBianca,
          'filler-0': makeCard({ instanceId: 'filler-0', cardNumber: 'ST01-001', slotIndex: 0 }),
          'filler-1': makeCard({ instanceId: 'filler-1', cardNumber: 'ST01-002', slotIndex: 1 }),
          'filler-2': makeCard({ instanceId: 'filler-2', cardNumber: 'ST01-003', slotIndex: 2 }),
          'filler-3': makeCard({ instanceId: 'filler-3', cardNumber: 'ST01-004', slotIndex: 3 }),
          'filler-4': makeCard({ instanceId: 'filler-4', cardNumber: 'ST01-005', slotIndex: 4 }),
        },
      });
      const fullPlan = getAscensionPlan(fullSlotsState, 'p1', handBianca)!;
      expect(fullPlan.canAscend).toBe(false);
      const fullHtml = renderToString(
        <AscensionModal
          isOpen={true}
          plan={fullPlan}
          onConfirm={() => {}}
          onClose={() => {}}
        />
      ).replace(/<!-- -->/g, '');
      expect(fullHtml).toContain('我方战场当前没有空余卡位');
    });
  });

  describe('ProcessingZoneView 按 controllerPlayerId 隔离与多浮空卡渲染', () => {
    it('不混显对手处理区卡牌，并将全部浮空模式卡牌一一渲染', () => {
      const air1 = makeCard({
        instanceId: 'p1-air-1',
        cardNumber: 'BP03-002',
        controllerPlayerId: 'p1',
        zone: 'PROCESSING',
        isAirborne: true,
      });
      const air2 = makeCard({
        instanceId: 'p1-air-2',
        cardNumber: 'BP04-071',
        controllerPlayerId: 'p1',
        zone: 'PROCESSING',
        isAirborne: true,
      });
      const oppProc = makeCard({
        instanceId: 'p2-proc',
        cardNumber: 'BP02-036',
        ownerPlayerId: 'p2',
        controllerPlayerId: 'p2',
        zone: 'PROCESSING',
        isAirborne: false,
      });

      const state = makeBaseGameState({
        publicCards: {
          'p1-air-1': air1,
          'p1-air-2': air2,
          'p2-proc': oppProc,
        },
      });

      const html = renderToString(
        <ProcessingZoneView
          gameState={state}
          playerId="p1"
          isMyZone={true}
          compact={false}
        />
      );
      expect(html).toContain('露西亚·誓焰');
      expect(html).toContain('丽芙·极昼');
      expect(html).toContain('浮空');
      expect(html).not.toContain('潮涌球');
    });
  });
});

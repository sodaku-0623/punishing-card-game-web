import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { BattlefieldArenaView } from '../src/components/game/BattlefieldArenaView';
import { PhaseBannerView } from '../src/components/game/PhaseBannerView';
import { PublicGameState } from '@zhanshuang/shared';
import GameTabletopPage from '@/app/game/[id]/GameClient';
import { useGameStore } from '@/stores/game-store';

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'game-123' }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ user: { id: 'p1', username: 'player1', nickname: '指挥官' } }),
}));

vi.mock('@/lib/socket', () => ({
  getSocket: () => ({
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
    connected: true,
  }),
  getSocketUserId: () => 'p1',
  getSocketUsername: () => '指挥官',
}));

describe('Game Tabletop Render Test', () => {
  const mockState: PublicGameState = {
    gameId: 'game-123',
    status: 'PLAYING',
    turnNumber: 1,
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
        totalCostCount: 2,
        openCostCount: 2,
        availableOpenCostCount: 2,
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
        totalCostCount: 2,
        openCostCount: 2,
        availableOpenCostCount: 2,
        exhaustedOpenCostCount: 0,
        hiddenCostCount: 0,
        turnAbilityUsage: {},
        gameAbilityUsage: {},
      },
    },
    battlefields: {
      p1: [{ slotIndex: 0 }, { slotIndex: 1 }, { slotIndex: 2 }, { slotIndex: 3 }, { slotIndex: 4 }],
      p2: [{ slotIndex: 0 }, { slotIndex: 1 }, { slotIndex: 2 }, { slotIndex: 3 }, { slotIndex: 4 }],
    },
    publicCards: {},
    myHandCards: [],
    opponentHandCount: 5,
    myDeckCount: 45,
    opponentDeckCount: 45,
    isDraw: false,
  };

  it('renders BattlefieldArenaView without throwing', () => {
    const html = renderToString(
      <BattlefieldArenaView
        gameState={mockState}
        resolvedMyUserId="p1"
        opponentUserId="p2"
        isMyTurn={true}
        selectedHandCardId={null}
        selectedBattlefieldCardId={null}
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
    );
    expect(html).toBeDefined();
  });

  it('renders PhaseBannerView without throwing', () => {
    const html = renderToString(
      <PhaseBannerView
        phase="MAIN_PHASE"
        turnNumber={1}
        activePlayerId="p1"
        myUserId="p1"
      />
    );
    expect(html).toBeDefined();
  });

  it('renders GameTabletopPage with null gameState (loading state)', () => {
    useGameStore.setState({ gameState: null });
    const html = renderToString(<GameTabletopPage />);
    expect(html).toContain('正在连接作战终端');
  });

  it('renders GameTabletopPage with active gameState', async () => {
    // zustand v5 服务端渲染时以 store 的初始状态作为快照，因此为该用例注入一个以对局状态初始化的 store
    vi.resetModules();
    vi.doMock('@/stores/game-store', async () => {
      const actual = await vi.importActual<typeof import('@/stores/game-store')>('@/stores/game-store');
      const { create } = await import('zustand');
      const seeded = { ...actual.useGameStore.getState(), gameState: mockState, myUserId: 'p1' };
      return { ...actual, useGameStore: create(() => seeded) };
    });
    try {
      const { default: Page } = await import('@/app/game/[id]/GameClient');
      const html = renderToString(<Page />);
      expect(html).toContain('战术交战区');
    } finally {
      vi.doUnmock('@/stores/game-store');
    }
  });
});

'use client';

import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useRouteId } from '@/lib/route-id';
import { getTimingStatus } from '@/lib/timing';
import { useGameStore } from '@/stores/game-store';
import { useAuth } from '@/lib/auth-context';
import { getSocket, getSocketUserId, getSocketUsername } from '@/lib/socket';
import { ErosionBar } from '@/components/game/ErosionBar';
import { BattlefieldArenaView, AttackAnimInfo } from '@/components/game/BattlefieldArenaView';
import { TargetingArrowOverlay } from '@/components/game/TargetingArrowOverlay';
import { PhaseBannerView } from '@/components/game/PhaseBannerView';
import { CostZoneView } from '@/components/game/CostZoneView';
import { CostZoneModal } from '@/components/game/CostZoneModal';
import { SignalOrbQueueView } from '@/components/game/SignalOrbQueueView';
import { CardView } from '@/components/game/CardView';
import { CardDetailPanel } from '@/components/game/CardDetailPanel';
import { CardDetailModal } from '@/components/game/CardDetailModal';
import { CardContextMenu } from '@/components/game/CardContextMenu';
import { CardHoverTooltip } from '@/components/game/CardHoverTooltip';
import { KeyboardShortcutsModal } from '@/components/game/KeyboardShortcutsModal';
import { PendingChoiceModal } from '@/components/game/PendingChoiceModal';
import { MulliganModal } from '@/components/game/MulliganModal';
import { GraveyardModal } from '@/components/game/GraveyardModal';
import { AssistModal } from '@/components/game/AssistModal';
import { AscensionModal } from '@/components/game/AscensionModal';
import { UnderneathCardsModal } from '@/components/game/UnderneathCardsModal';
import { TurnFlowView } from '@/components/game/TurnFlowView';
import { RuleGuideModal } from '@/components/game/RuleGuideModal';
import { Button, HudBrackets } from '@/components/ui';
import { findCardByNumberOrId, formatCardType } from '@/lib/cards-data';
import { resolveOrbDisplayInfo, validateOrbElimination } from '@/lib/signal-orbs';
import {
  isBattlefieldSlotEmpty,
  getSlotOccupancy,
  isSlotEffectiveRoleCard,
  canPlayAssistOnSlot,
  getUsableNonTacticsInstants,
  canRolePerformAssist,
  getAssistPartnerCandidates,
  getCardActivatedAbilityOptions,
  getZoneActivatedAbilityCardMap,
  getNonHandPlayAction,
  getAscensionPlan,
  getAttackerCapabilities,
  isLegalRoleAttackTarget,
  canRoleBlockAttacker,
  getCardEffectiveCostInfo,
  getCardEffectiveCost,
  isHandCardLegalToPlay,
  type AscensionPlan,
  type NonHandPlayAction,
} from '@/lib/battle-actions';
import { sfx } from '@/lib/audio';
import {
  CardInstance,
  GameAction,
  CardType,
  PendingChoice,
} from '@zhanshuang/shared';
import {
  Swords,
  Clock,
  RefreshCw,
  LogOut,
  AlertCircle,
  Trophy,
  Shield,
  Layers,
  Zap,
  Info,
  Volume2,
  VolumeX,
  Keyboard as KeyboardIcon,
  ChevronRight,
  PanelRightClose,
  PanelRightOpen,
  ArrowUpRight,
  BookOpen,
  Cpu,
  Play,
} from 'lucide-react';

export default function GameTabletopPage() {
  const router = useRouter();
  // 真实对局 ID (已解码；静态导出部署时从地址栏读取，见 src/lib/route-id.tsx)
  const gameId = useRouteId();
  const { user, isLoading: authLoading = false } = useAuth();

  const {
    gameState,
    myUserId,
    selectedHandCardId,
    selectedSlotIndex,
    selectedOrbIds,
    pendingChoice,
    combatLogs,
    lastError,
    gameOverResult,
    setMyUserId,
    updateGameState,
    appendEvents,
    setSelectedHandCard,
    setSelectedSlotIndex,
    toggleOrbSelection,
    clearOrbSelection,
    setPendingChoice,
    setLastError,
    setGameOverResult,
  } = useGameStore();

  const [socketConnected, setSocketConnected] = useState(false);
  // 当前鼠标悬停的卡牌
  const [hoveredCard, setHoveredCard] = useState<CardInstance | null>(null);
  // 当前固定选中的卡牌
  const [inspectedCard, setInspectedCard] = useState<CardInstance | null>(null);
  // 是否打开长按/放大查看大图弹窗
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  // 是否打开快捷键帮助弹窗
  const [isShortcutsModalOpen, setIsShortcutsModalOpen] = useState(false);
  // 是否打开官方规则手册/新手指南弹窗
  const [isRuleGuideModalOpen, setIsRuleGuideModalOpen] = useState(false);
  // 墓地检视弹窗控制（实时从 gameState 派生，避免操作后快照陈旧）
  const [graveyardOwner, setGraveyardOwner] = useState<'MY' | 'OPPONENT' | null>(null);
  // 下方牌检视弹窗宿主卡牌 ID
  const [underneathHostCardId, setUnderneathHostCardId] = useState<string | null>(null);
  // 统一升变确认弹窗状态
  const [ascensionModalState, setAscensionModalState] = useState<{
    card: CardInstance;
    initialTargetCardId?: string | null;
    initialSlotIndex?: number | null;
  } | null>(null);
  // 对手掉线或失去连接状态
  const [isOpponentDisconnected, setIsOpponentDisconnected] = useState(false);
  // 当前战场选中的角色/独立装备卡 (点击后展开操作按钮或目标高亮)
  const [selectedBattlefieldCardId, setSelectedBattlefieldCardId] = useState<string | null>(null);
  // 8.13 协战弹窗宿主角色 ID
  const [assistHostCardId, setAssistHostCardId] = useState<string | null>(null);
  // 右键上下文菜单状态
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    card: CardInstance;
  } | null>(null);
  // 右侧战术终端 HUD 折叠状态 (桌面端自适应展开，移动端默认折叠为抽屉)
  const [isHudOpen, setIsHudOpen] = useState(false);
  // 双方费用区卡牌全息检视弹窗控制 (明费公开透明，暗费保密)
  const [costModalState, setCostModalState] = useState<{
    isOpen: boolean;
    isOpponent: boolean;
  }>({
    isOpen: false,
    isOpponent: false,
  });

  const openCostModal = useCallback((isOpponent: boolean) => {
    sfx.playClick();
    setCostModalState({ isOpen: true, isOpponent });
  }, []);

  // 移动端手牌触控拖拽放置状态与坐标
  const [touchDragInfo, setTouchDragInfo] = useState<{
    cardId: string;
    x: number;
    y: number;
    isDragging: boolean;
  } | null>(null);
  const touchStartPosRef = useRef<{ x: number; y: number } | null>(null);

  // 音效静音状态
  const [isMuted, setIsMuted] = useState(false);

  // 攻击冲锋与碰撞闪光动画状态 (YGOPro 风格)
  const [attackAnim, setAttackAnim] = useState<AttackAnimInfo | null>(null);
  const attackAnimTimerRef = useRef<NodeJS.Timeout | null>(null);
  const attackClashTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastCombatKeyRef = useRef<string | null>(null);

  const triggerAttackAnimation = useCallback(
    (
      attackerCardId: string,
      targetCardId?: string,
      targetType: 'PLAYER' | 'CHARACTER' = 'CHARACTER',
      direction: 'UP' | 'DOWN' = 'UP'
    ) => {
      if (attackAnimTimerRef.current) clearTimeout(attackAnimTimerRef.current);
      if (attackClashTimerRef.current) clearTimeout(attackClashTimerRef.current);

      sfx.playAttack();

      // 1. 发起冲锋
      setAttackAnim({
        attackerCardId,
        targetCardId,
        targetType,
        direction,
        isClashing: false,
      });

      // 2. 冲锋到达碰撞点 (300ms) 触发爆破耀斑与目标震颤
      attackClashTimerRef.current = setTimeout(() => {
        setAttackAnim((prev) => (prev ? { ...prev, isClashing: true } : null));
      }, 300);

      // 3. 归位并清理
      attackAnimTimerRef.current = setTimeout(() => {
        setAttackAnim(null);
      }, 700);
    },
    []
  );

  useEffect(() => {
    setIsMuted(sfx.getMuted());
    if (typeof window !== 'undefined' && window.innerWidth >= 1024) {
      setIsHudOpen(true);
    }
  }, []);

  const toggleSound = useCallback(() => {
    setIsMuted((prev) => {
      const next = !prev;
      sfx.setMuted(next);
      return next;
    });
  }, []);

  // 初始化 Socket 连接并同步重连状态
  useEffect(() => {
    if (authLoading) return;
    useGameStore.getState().reset();
    setIsOpponentDisconnected(false);
    setSelectedBattlefieldCardId(null);
    setHoveredCard(null);
    setInspectedCard(null);
    setIsDetailModalOpen(false);
    setGraveyardOwner(null);
    setUnderneathHostCardId(null);
    setAscensionModalState(null);
    setContextMenu(null);

    const authId = user?.id || getSocketUserId();
    const authName = user?.nickname || user?.username || getSocketUsername();
    const socket = getSocket(authId, authName);

    setMyUserId(authId);

    let errorTimer: ReturnType<typeof setTimeout> | null = null;
    const handleConnect = () => {
      setSocketConnected(true);
      socket.emit('game:reconnect', { gameId });
    };
    const handleDisconnect = () => setSocketConnected(false);
    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);

    socket.on('game:sync_state', (state) => {
      updateGameState(state);
      setIsOpponentDisconnected(false);
    });

    socket.on('game:choice_required', (choice: PendingChoice) => {
      setPendingChoice(choice);
      sfx.playPhaseChange();
    });

    socket.on('game:events', (events) => {
      appendEvents(events);
    });

    socket.on('game:player_disconnected', (payload) => {
      if (payload.userId !== authId) {
        setIsOpponentDisconnected(true);
      }
    });

    socket.on('game:player_reconnected', (payload) => {
      if (payload.userId !== authId) {
        setIsOpponentDisconnected(false);
      }
    });

    socket.on('game:error', (err) => {
      setLastError(err.message || err.code);
      sfx.playClick();
      if (errorTimer) clearTimeout(errorTimer);
      errorTimer = setTimeout(() => setLastError(null), 4000);
    });

    socket.on('game:ended', (result) => {
      setGameOverResult(result);
      if (result.winnerId === authId) {
        sfx.playCardPlay();
      } else {
        sfx.playClick();
      }
    });

    if (socket.connected) {
      handleConnect();
    }

    return () => {
      useGameStore.getState().reset();
      if (errorTimer) clearTimeout(errorTimer);
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off('game:sync_state');
      socket.off('game:choice_required');
      socket.off('game:events');
      socket.off('game:player_disconnected');
      socket.off('game:player_reconnected');
      socket.off('game:error');
      socket.off('game:ended');
    };
  }, [gameId, user, authLoading, setMyUserId, updateGameState, setPendingChoice, appendEvents, setLastError, setGameOverResult]);

  const handleExitGame = (isSurrender = false) => {
    const authId = user?.id || getSocketUserId();
    const authName = user?.nickname || user?.username || getSocketUsername();
    const socket = getSocket(authId, authName);
    socket.emit('game:leave', { gameId, isSurrender });
    if (gameState?.roomId) {
      socket.emit('room:leave', { roomId: gameState.roomId });
    }
    useGameStore.getState().reset();
    router.push('/rooms');
  };

  // 稳定解析玩家角色与阵营
  const effectiveUserId = user?.id || getSocketUserId();
  const playerIds = useMemo(() => (gameState ? Object.keys(gameState.players) : []), [gameState]);
  const myHandCards = useMemo(() => gameState?.myHandCards || [], [gameState]);
  const deducedFromHand = myHandCards.length > 0 ? myHandCards[0].controllerPlayerId : undefined;

  const resolvedMyUserId = useMemo(() => {
    if (!gameState) return effectiveUserId;
    if (gameState.players[effectiveUserId]) return effectiveUserId;
    if (myUserId && gameState.players[myUserId]) return myUserId;
    if (deducedFromHand && gameState.players[deducedFromHand]) return deducedFromHand;
    return playerIds[0] || effectiveUserId || 'player_1';
  }, [gameState, effectiveUserId, myUserId, deducedFromHand, playerIds]);

  const opponentUserId = useMemo(() => {
    if (!gameState) return '';
    const other = playerIds.find((id) => id !== resolvedMyUserId);
    return other || playerIds.find((id) => id !== effectiveUserId) || '';
  }, [gameState, playerIds, resolvedMyUserId, effectiveUserId]);

  const isMyTurn = gameState ? gameState.activePlayerId === resolvedMyUserId : false;
  // 当前时机下己方可执行的操作 (瞬时轮流 / 阻挡宣言 / 主要阶段行动)
  const timing = useMemo(
    () => (gameState ? getTimingStatus(gameState, resolvedMyUserId) : null),
    [gameState, resolvedMyUserId]
  );

  // 当前优先权瞬时窗口内可用的 10.8 非战术【瞬时】卡牌 (明费 / 露娜下方 / 手牌)
  const usableNonTacticsInstants = useMemo(
    () => (gameState ? getUsableNonTacticsInstants(gameState, resolvedMyUserId) : []),
    [gameState, resolvedMyUserId]
  );
  const usableInstantCardIds = useMemo(
    () => new Set(usableNonTacticsInstants.map((item) => item.card.instanceId)),
    [usableNonTacticsInstants]
  );

  // 全区域【起】动能力映射（手牌 / 战场 / 下方 / 墓地 / 明费 / 正面信号球）
  const zoneAbilityMap = useMemo(
    () => (gameState ? getZoneActivatedAbilityCardMap(gameState, resolvedMyUserId) : {}),
    [gameState, resolvedMyUserId]
  );

  // 墓地非手牌区出牌映射（BP02-026 墓地升变 / BP02-036 墓地使用战术）
  const graveyardNonHandActions = useMemo(() => {
    const map: Record<string, NonHandPlayAction> = {};
    if (!gameState) return map;
    for (const card of Object.values(gameState.publicCards || {})) {
      if (card.controllerPlayerId === resolvedMyUserId && card.zone === 'GRAVEYARD') {
        const act = getNonHandPlayAction(gameState, resolvedMyUserId, card);
        if (act) map[card.instanceId] = act;
      }
    }
    return map;
  }, [gameState, resolvedMyUserId]);

  // 当前打开的升变弹窗的实时升变计划
  const activeAscensionPlan = useMemo(() => {
    if (!gameState || !ascensionModalState) return null;
    const freshCard =
      gameState.myHandCards?.find((c) => c.instanceId === ascensionModalState.card.instanceId) ??
      gameState.publicCards?.[ascensionModalState.card.instanceId] ??
      ascensionModalState.card;
    return getAscensionPlan(gameState, resolvedMyUserId, freshCard);
  }, [gameState, resolvedMyUserId, ascensionModalState]);

  // 当前选中手牌的升变计划与手牌【起】列表
  const selectedHandAscensionPlan = useMemo(() => {
    if (!gameState || !selectedHandCardId) return null;
    const handCard = myHandCards.find((c) => c.instanceId === selectedHandCardId);
    return handCard ? getAscensionPlan(gameState, resolvedMyUserId, handCard) : null;
  }, [gameState, resolvedMyUserId, selectedHandCardId, myHandCards]);

  const selectedHandActivateOptions = useMemo(() => {
    if (!gameState || !selectedHandCardId) return [];
    const handCard = myHandCards.find((c) => c.instanceId === selectedHandCardId);
    return handCard ? getCardActivatedAbilityOptions(gameState, resolvedMyUserId, handCard, 'HAND') : [];
  }, [gameState, resolvedMyUserId, selectedHandCardId, myHandCards]);

  // 攻击者能力与合法目标状态 (7.2.1，兼容 PR-041 变身角色与【突进】/【速攻】)
  const selectedAttackerCard = useMemo(() => {
    if (!selectedBattlefieldCardId || !gameState || !isMyTurn || gameState.phase !== 'MAIN_PHASE') {
      return undefined;
    }
    const myFieldSlots = gameState.battlefields?.[resolvedMyUserId] || [];
    if (
      !myFieldSlots.some((s) =>
        isSlotEffectiveRoleCard(s, gameState.publicCards, selectedBattlefieldCardId)
      )
    ) {
      return undefined;
    }
    return gameState.publicCards?.[selectedBattlefieldCardId];
  }, [selectedBattlefieldCardId, gameState, isMyTurn, resolvedMyUserId]);

  const selectedAttackerCaps = useMemo(
    () =>
      selectedAttackerCard && gameState
        ? getAttackerCapabilities(gameState, resolvedMyUserId, selectedAttackerCard)
        : { canAttack: false, canAttackPlayer: false, canAttackCharacter: false },
    [selectedAttackerCard, gameState, resolvedMyUserId]
  );

  const isAttackTargeting = selectedAttackerCaps.canAttack;

  const activePendingChoice = gameState?.currentPendingChoice || pendingChoice;
  const hasBlockingOverlay = useMemo(() => {
    const isMulliganOpen = Boolean(
      gameState &&
        gameState.phase === 'MULLIGAN_PHASE' &&
        !Boolean(gameState.players?.[resolvedMyUserId]?.hasMulliganed)
    );
    const isPendingChoiceOpen = Boolean(
      activePendingChoice && activePendingChoice.playerId === resolvedMyUserId
    );
    return Boolean(
      isMulliganOpen ||
        isPendingChoiceOpen ||
        ascensionModalState ||
        underneathHostCardId ||
        graveyardOwner !== null ||
        costModalState.isOpen ||
        assistHostCardId ||
        isShortcutsModalOpen ||
        isDetailModalOpen ||
        isRuleGuideModalOpen ||
        contextMenu ||
        gameOverResult
    );
  }, [
    gameState,
    resolvedMyUserId,
    activePendingChoice,
    ascensionModalState,
    underneathHostCardId,
    graveyardOwner,
    costModalState.isOpen,
    assistHostCardId,
    isShortcutsModalOpen,
    isDetailModalOpen,
    isRuleGuideModalOpen,
    contextMenu,
    gameOverResult,
  ]);

  useEffect(() => {
    if (resolvedMyUserId && myUserId !== resolvedMyUserId) {
      setMyUserId(resolvedMyUserId);
    }
  }, [resolvedMyUserId, myUserId, setMyUserId]);

  // 监听敌方或网络端发起交战并触发对应方向的冲锋攻击动画 (遵守 Rules of Hooks，必须置于条件返回之前)
  useEffect(() => {
    if (gameState?.currentCombat) {
      const combat = gameState.currentCombat;
      const combatKey = `${combat.attackerCardId}-${combat.targetCardId || combat.targetType}-${gameState.turnNumber}-${gameState.phase}`;
      if (lastCombatKeyRef.current !== combatKey) {
        lastCombatKeyRef.current = combatKey;
        const attacker = gameState.publicCards?.[combat.attackerCardId];
        if (attacker) {
          const isMyAttacker = attacker.controllerPlayerId === resolvedMyUserId;
          triggerAttackAnimation(
            combat.attackerCardId,
            combat.targetCardId,
            combat.targetType,
            isMyAttacker ? 'UP' : 'DOWN'
          );
        }
      }
    } else {
      lastCombatKeyRef.current = null;
    }
  }, [
    gameState?.currentCombat,
    gameState?.turnNumber,
    gameState?.phase,
    gameState?.publicCards,
    resolvedMyUserId,
    triggerAttackAnimation,
  ]);

  // 组件卸载时安全清理所有动画定时器
  useEffect(() => {
    return () => {
      if (attackAnimTimerRef.current) clearTimeout(attackAnimTimerRef.current);
      if (attackClashTimerRef.current) clearTimeout(attackClashTimerRef.current);
    };
  }, []);

  // 发送操作到服务器
  const sendAction = useCallback(
    (action: GameAction) => {
      const socket = getSocket();
      socket.emit('game:action', { gameId, action });
    },
    [gameId]
  );

  // 时点让渡 / 阶段推进 / 放弃阻挡
  const handlePassTiming = useCallback(() => {
    if (!gameState || !timing?.canPass) return;
    sfx.playPhaseChange();
    if (timing.canDeclareBlock) {
      // 7.3.1.c 放弃阻挡
      sendAction({
        type: 'DECLARE_BLOCK',
        playerId: resolvedMyUserId,
        blockerCardId: undefined,
      });
    } else {
      // 不使用【瞬时】(7.3.1.b / 6.5.1.a) 或结束主要阶段 (6.4.1.c)
      sendAction({
        type: 'PASS_ACTION_TIMING',
        playerId: resolvedMyUserId,
      });
    }
  }, [gameState, timing, resolvedMyUserId, sendAction]);

  // 充能为明费 (6.3.1.c)
  const handleChargeCostFromHand = useCallback(
    (cardId?: string) => {
      const targetCardId = cardId || selectedHandCardId;
      sfx.playCardPlay();
      sendAction({
        type: 'CHARGE_COST_FROM_HAND',
        playerId: resolvedMyUserId,
        cardInstanceId: targetCardId ?? undefined,
      });
      setSelectedHandCard(null);
    },
    [selectedHandCardId, resolvedMyUserId, sendAction, setSelectedHandCard]
  );

  // 键盘快捷键监听 (Space/Enter, Esc, F/Tab, 1~7, ?, M)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 屏蔽表单元素与组合键
      const target = e.target as HTMLElement | null;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target?.isContentEditable
      ) {
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) {
        return;
      }

      // 只要有任一弹窗/菜单开启即直接退出，杜绝快捷键穿透并与弹窗自身 Esc 冲突
      const hasDomOverlay =
        typeof document !== 'undefined' &&
        Boolean(document.querySelector('[role="dialog"][aria-modal="true"], [role="menu"]'));
      if (hasBlockingOverlay || hasDomOverlay) {
        return;
      }

      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        handlePassTiming();
      } else if (e.key === 'Escape') {
        setSelectedHandCard(null);
        setSelectedBattlefieldCardId(null);
        setHoveredCard(null);
        setInspectedCard(null);
        clearOrbSelection();
        setContextMenu(null);
        setAssistHostCardId(null);
        setGraveyardOwner(null);
        setUnderneathHostCardId(null);
        setAscensionModalState(null);
        setCostModalState({ isOpen: false, isOpponent: false });
        setIsShortcutsModalOpen(false);
        setIsRuleGuideModalOpen(false);
        setIsDetailModalOpen(false);
      } else if (e.key === 'Tab') {
        e.preventDefault();
        setIsHudOpen((prev) => !prev);
      } else if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        if (hoveredCard || inspectedCard) {
          setIsDetailModalOpen((prev) => !prev);
        }
      } else if (e.key === 'h' || e.key === 'H') {
        e.preventDefault();
        setIsRuleGuideModalOpen((prev) => !prev);
      } else if (e.key === '?' || (e.shiftKey && e.key === '/')) {
        e.preventDefault();
        setIsShortcutsModalOpen((prev) => !prev);
      } else if (e.key === 'm' || e.key === 'M') {
        toggleSound();
      } else if (e.key >= '1' && e.key <= '7') {
        const index = parseInt(e.key, 10) - 1;
        if (myHandCards[index]) {
          const card = myHandCards[index];
          setSelectedHandCard(card.instanceId);
          setInspectedCard(card);
          sfx.playClick();
        }
      } else if (['q', 'w', 'e', 'r', 't', 'y'].includes(e.key.toLowerCase()) && gameState?.publicCards) {
        const orbKeys = ['q', 'w', 'e', 'r', 't', 'y'];
        const orbIdx = orbKeys.indexOf(e.key.toLowerCase());
        const curOrbs = Object.values(gameState.publicCards).filter(
          (c) => c.controllerPlayerId === resolvedMyUserId && c.zone === 'SIGNAL_ORB'
        );
        const targetOrb = curOrbs[orbIdx];
        if (targetOrb && resolveOrbDisplayInfo(targetOrb, orbIdx).isEliminatable) {
          toggleOrbSelection(targetOrb.instanceId);
          sfx.playClick();
        }
      } else if ((e.key === 'x' || e.key === 'X') && selectedOrbIds.length > 0 && gameState?.publicCards) {
        const curOrbs = Object.values(gameState.publicCards).filter(
          (c) => c.controllerPlayerId === resolvedMyUserId && c.zone === 'SIGNAL_ORB'
        );
        const check = validateOrbElimination(curOrbs, selectedOrbIds);
        if (check.valid) {
          sfx.playOrbTriple();
          sendAction({
            type: 'ELIMINATE_3_ORBS',
            playerId: resolvedMyUserId,
            orbCardInstanceIds: check.sortedIds,
          });
          clearOrbSelection();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    hasBlockingOverlay,
    handlePassTiming,
    hoveredCard,
    inspectedCard,
    myHandCards,
    gameState,
    resolvedMyUserId,
    selectedOrbIds,
    sendAction,
    setSelectedHandCard,
    toggleOrbSelection,
    clearOrbSelection,
    toggleSound,
  ]);

  if (!gameState) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-ink-950 bg-tactical-grid text-fg-secondary p-4">
        <div className="relative flex flex-col items-center gap-4 max-w-md w-full text-center p-8 bg-ink-900 border border-line-strong clip-corner-md shadow-overlay">
          <HudBrackets size="sm" color={lastError ? 'crimson' : 'teal'} />
          {lastError ? (
            <>
              <div className="w-12 h-12 bg-crimson-500/15 border border-crimson-500/60 flex items-center justify-center text-crimson-400">
                <AlertCircle className="w-6 h-6" />
              </div>
              <div className="text-fg font-bold text-title-sm">未能连入对局作战终端</div>
              <div className="text-caption text-crimson-400 bg-crimson-500/10 border border-crimson-500/40 px-3 py-2 w-full">
                {lastError}
              </div>
              <div className="text-caption text-fg-muted">
                对局可能已结束或您未参与此对局。
              </div>
              <Button variant="primary" size="md" onClick={() => router.push('/rooms')} className="mt-2">
                返回房间大厅
              </Button>
            </>
          ) : (
            <>
              <Clock className="w-8 h-8 text-teal-400 animate-spin" />
              <div className="text-body-sm text-fg font-medium">
                正在连接作战终端并同步游戏状态...
              </div>
              <div className="text-hud font-num text-fg-muted">
                GAME ID · {gameId}
              </div>
              <button
                type="button"
                onClick={() => router.push('/rooms')}
                className="mt-2 text-caption text-fg-muted hover:text-teal-400 underline cursor-pointer transition-colors"
              >
                连接超时？点击返回大厅
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  const myPlayerState = gameState.players?.[resolvedMyUserId] || {
    erosionCount: 0,
    availableOpenCostCount: 2,
    totalCostCount: 2,
    hiddenCostCount: 0,
  };
  const opponentPlayerState = gameState.players?.[opponentUserId] || {
    erosionCount: 0,
    availableOpenCostCount: 2,
    totalCostCount: 2,
    hiddenCostCount: 0,
  };

  const mySlots = gameState.battlefields?.[resolvedMyUserId] || [];
  const opponentSlots = gameState.battlefields?.[opponentUserId] || [];

  const allCards = gameState.publicCards ? Object.values(gameState.publicCards) : [];

  const myCostCards = allCards.filter(
    (c) => c.controllerPlayerId === resolvedMyUserId && c.zone === 'COST'
  );
  const opponentCostCards = allCards.filter(
    (c) => c.controllerPlayerId === opponentUserId && c.zone === 'COST'
  );

  const myOrbs = allCards.filter(
    (c) => c.controllerPlayerId === resolvedMyUserId && c.zone === 'SIGNAL_ORB'
  );
  const opponentOrbs = allCards.filter(
    (c) => c.controllerPlayerId === opponentUserId && c.zone === 'SIGNAL_ORB'
  );

  const myGraveyardCards = allCards.filter(
    (c) => c.controllerPlayerId === resolvedMyUserId && c.zone === 'GRAVEYARD'
  );
  const opponentGraveyardCards = allCards.filter(
    (c) => c.controllerPlayerId === opponentUserId && c.zone === 'GRAVEYARD'
  );

  // 长按任意卡牌检视大图
  const handleCardLongPress = (card: any) => {
    if (!card) return;
    setInspectedCard(card);
    setIsDetailModalOpen(true);
  };

  // 打开墓地弹窗（记录所属方，从最新 gameState 实时派生列表）
  const openGraveyardModal = (_cards: CardInstance[], title: string) => {
    setGraveyardOwner(title.includes('敌方') ? 'OPPONENT' : 'MY');
  };

  // 触发指定战场目标角色的升变：若含多选 / 额外代价 / 受限阻断则打开 AscensionModal 确认，否则直接发送
  const triggerAscensionForTarget = (
    card: CardInstance,
    plan: AscensionPlan,
    targetCardId: string
  ) => {
    if (
      plan.allowMultiple ||
      plan.config.extraCost ||
      plan.extraCostCandidates.length > 0 ||
      !plan.canAscend
    ) {
      sfx.playClick();
      setAscensionModalState({ card, initialTargetCardId: targetCardId });
      return;
    }
    sfx.playCardPlay();
    sendAction({
      type: 'PLAY_CARD',
      playerId: resolvedMyUserId,
      cardInstanceId: card.instanceId,
      isAscension: true,
      targetAscensionCardId: targetCardId,
    });
    setSelectedHandCard(null);
    setSelectedBattlefieldCardId(null);
  };

  // 点击卡位逻辑 (出牌或选目标)
  const handleSlotClick = (slotIndex: number) => {
    if (selectedHandCardId) {
      const handCard = myHandCards.find((c) => c.instanceId === selectedHandCardId);
      const def = handCard ? findCardByNumberOrId(handCard.cardNumber || handCard.cardId) : null;
      const targetSlot = mySlots.find((s) => s.slotIndex === slotIndex);
      const occ = targetSlot ? getSlotOccupancy(targetSlot, gameState.publicCards) : undefined;
      const existingRoleCard = occ?.kind === 'ROLE' ? occ.card : undefined;
      const ascPlan = handCard ? getAscensionPlan(gameState, resolvedMyUserId, handCard) : null;

      if (
        handCard &&
        existingRoleCard &&
        ascPlan?.targets.some(
          (t) => t.zone === 'BATTLEFIELD' && t.card.instanceId === existingRoleCard.instanceId
        )
      ) {
        triggerAscensionForTarget(handCard, ascPlan, existingRoleCard.instanceId);
        return;
      }

      sfx.playCardPlay();
      if (existingRoleCard && def?.cardType === CardType.EQUIPMENT) {
        sendAction({
          type: 'PLAY_CARD',
          playerId: resolvedMyUserId,
          cardInstanceId: selectedHandCardId,
          targetEquipRoleId: existingRoleCard.instanceId,
          targetSlotIndex: slotIndex,
        });
      } else {
        sendAction({
          type: 'PLAY_CARD',
          playerId: resolvedMyUserId,
          cardInstanceId: selectedHandCardId,
          targetSlotIndex: slotIndex,
        });
      }
      setSelectedHandCard(null);
    }
    setSelectedBattlefieldCardId(null);
  };

  // 拖拽卡牌到卡位
  const handleDropCardToSlot = (slotIndex: number, cardInstanceId: string) => {
    const handCard = myHandCards.find((c) => c.instanceId === cardInstanceId);
    const def = handCard ? findCardByNumberOrId(handCard.cardNumber || handCard.cardId) : null;
    const targetSlot = mySlots.find((s) => s.slotIndex === slotIndex);
    const occ = targetSlot ? getSlotOccupancy(targetSlot, gameState.publicCards) : undefined;
    const existingRoleCard = occ?.kind === 'ROLE' ? occ.card : undefined;
    const ascPlan = handCard ? getAscensionPlan(gameState, resolvedMyUserId, handCard) : null;

    if (
      handCard &&
      existingRoleCard &&
      ascPlan?.targets.some(
        (t) => t.zone === 'BATTLEFIELD' && t.card.instanceId === existingRoleCard.instanceId
      )
    ) {
      triggerAscensionForTarget(handCard, ascPlan, existingRoleCard.instanceId);
      return;
    }

    sfx.playCardPlay();
    if (existingRoleCard && def?.cardType === CardType.EQUIPMENT) {
      sendAction({
        type: 'PLAY_CARD',
        playerId: resolvedMyUserId,
        cardInstanceId,
        targetEquipRoleId: existingRoleCard.instanceId,
        targetSlotIndex: slotIndex,
      });
    } else {
      sendAction({
        type: 'PLAY_CARD',
        playerId: resolvedMyUserId,
        cardInstanceId,
        targetSlotIndex: slotIndex,
      });
    }
    setSelectedHandCard(null);
  };

  // 拖拽攻击目标指定
  const handleDropAttackTarget = (targetCardId: string, attackerCardId: string) => {
    triggerAttackAnimation(attackerCardId, targetCardId, 'CHARACTER', 'UP');
    sendAction({
      type: 'DECLARE_ATTACK',
      playerId: resolvedMyUserId,
      attackerCardId,
      targetType: 'CHARACTER',
      targetCardId,
    });
    setSelectedBattlefieldCardId(null);
  };

  // 点击角色/辅助机/独立装备卡逻辑
  const handleRoleClick = (cardId: string) => {
    if (!gameState) return;
    const card = gameState.publicCards[cardId];
    if (!card) return;

    setInspectedCard(card);
    sfx.playClick();

    if (card.controllerPlayerId === resolvedMyUserId) {
      // 若当前已选中我方战场单独占位装备，再点击我方角色卡 -> 触发 EQUIP_ITEM (6.4.1.b.4)
      const isSelectedStandaloneEquip = Boolean(
        selectedBattlefieldCardId &&
          mySlots.some((s) => s.standaloneEquipmentId === selectedBattlefieldCardId)
      );
      const isClickedFriendlyRole = mySlots.some((s) =>
        isSlotEffectiveRoleCard(s, gameState.publicCards, cardId)
      );
      if (isSelectedStandaloneEquip && isClickedFriendlyRole && selectedBattlefieldCardId) {
        handleEquipItem(selectedBattlefieldCardId, cardId);
        return;
      }

      if (selectedHandCardId) {
        const handCard = myHandCards.find((c) => c.instanceId === selectedHandCardId);
        const def = handCard ? findCardByNumberOrId(handCard.cardNumber || handCard.cardId) : null;
        const ascPlan = handCard ? getAscensionPlan(gameState, resolvedMyUserId, handCard) : null;

        if (isClickedFriendlyRole && def?.cardType === CardType.EQUIPMENT) {
          sfx.playCardPlay();
          sendAction({
            type: 'PLAY_CARD',
            playerId: resolvedMyUserId,
            cardInstanceId: selectedHandCardId,
            targetEquipRoleId: cardId,
            targetSlotIndex: card.slotIndex,
          });
          setSelectedHandCard(null);
          setSelectedBattlefieldCardId(null);
        } else if (
          handCard &&
          isClickedFriendlyRole &&
          ascPlan?.targets.some((t) => t.zone === 'BATTLEFIELD' && t.card.instanceId === cardId)
        ) {
          triggerAscensionForTarget(handCard, ascPlan, cardId);
        } else if (
          def?.cardType === CardType.ASSIST &&
          mySlots.some((s) => canPlayAssistOnSlot(s, gameState.publicCards) && s.assistCardId === cardId) &&
          card.slotIndex !== undefined
        ) {
          // 8.6.2.e.3 使用新辅助机替换原有辅助机卡位
          sfx.playCardPlay();
          sendAction({
            type: 'PLAY_CARD',
            playerId: resolvedMyUserId,
            cardInstanceId: selectedHandCardId,
            targetSlotIndex: card.slotIndex,
          });
          setSelectedHandCard(null);
          setSelectedBattlefieldCardId(null);
        } else {
          setSelectedHandCard(null);
          setSelectedBattlefieldCardId((prev) => (prev === cardId ? null : cardId));
        }
      } else {
        setSelectedBattlefieldCardId((prev) => (prev === cardId ? null : cardId));
      }
    } else {
      // 点击对手角色卡：宣告攻击（严格校验攻击者能力、敌方横竖直状态与嘲讽约束）
      if (isMyTurn && gameState.phase === 'MAIN_PHASE' && selectedAttackerCard) {
        if (isLegalRoleAttackTarget(gameState, resolvedMyUserId, selectedAttackerCard, card)) {
          triggerAttackAnimation(selectedAttackerCard.instanceId, cardId, 'CHARACTER', 'UP');
          sendAction({
            type: 'DECLARE_ATTACK',
            playerId: resolvedMyUserId,
            attackerCardId: selectedAttackerCard.instanceId,
            targetType: 'CHARACTER',
            targetCardId: cardId,
          });
          setSelectedBattlefieldCardId(null);
        }
      }
    }
  };

  // 发动卡牌【起】动能力 (8.1.1.c，支持全区域与精确 abilityIndex)
  const handleActivateAbility = (cardId: string, abilityIndex = 0) => {
    sfx.playClick();
    sendAction({
      type: 'ACTIVATE_ABILITY',
      playerId: resolvedMyUserId,
      sourceCardId: cardId,
      abilityIndex,
    });
    setSelectedBattlefieldCardId(null);
  };

  // 非手牌区出牌（墓地升变 / 墓地使用战术 / 露娜下方使用战术）
  const handleNonHandPlay = (card: CardInstance, action: NonHandPlayAction) => {
    if (action.kind === 'ASCEND_FROM_GRAVEYARD') {
      setGraveyardOwner(null);
      setAscensionModalState({ card });
      sfx.playClick();
      return;
    }
    sfx.playCardPlay();
    sendAction({
      type: 'PLAY_CARD',
      playerId: resolvedMyUserId,
      cardInstanceId: card.instanceId,
    });
    setGraveyardOwner(null);
    setUnderneathHostCardId(null);
  };

  // 角色发起进攻对手玩家 (7.2)
  const handleAttackClick = (cardId: string) => {
    triggerAttackAnimation(cardId, undefined, 'PLAYER', 'UP');
    sendAction({
      type: 'DECLARE_ATTACK',
      playerId: resolvedMyUserId,
      attackerCardId: cardId,
      targetType: 'PLAYER',
    });
    setSelectedBattlefieldCardId(null);
  };

  // 发动战术卡
  const handlePlayTactics = (cardInstanceId: string) => {
    sfx.playCardPlay();
    sendAction({
      type: 'PLAY_CARD',
      playerId: resolvedMyUserId,
      cardInstanceId,
    });
    setSelectedHandCard(null);
  };

  // 使用装备卡
  const handlePlayEquipment = (cardInstanceId: string) => {
    sfx.playCardPlay();
    sendAction({
      type: 'PLAY_CARD',
      playerId: resolvedMyUserId,
      cardInstanceId,
    });
    setSelectedHandCard(null);
  };

  // 部署辅助机卡 (2.2.2.c.2 / 8.6.2.e.3)
  const handlePlayAssist = (cardInstanceId: string) => {
    const emptySlot = mySlots.find(isBattlefieldSlotEmpty);
    const replaceSlot = mySlots.find((s) => canPlayAssistOnSlot(s, gameState.publicCards));
    const target = emptySlot ?? replaceSlot;
    if (!target) return;
    sfx.playCardPlay();
    sendAction({
      type: 'PLAY_CARD',
      playerId: resolvedMyUserId,
      cardInstanceId,
      targetSlotIndex: target.slotIndex,
    });
    setSelectedHandCard(null);
  };

  // 6.4.1.b.4 将战场单独占位装备装备给己方角色
  const handleEquipItem = (equipmentCardId: string, targetRoleCardId: string) => {
    sfx.playCardPlay();
    sendAction({
      type: 'EQUIP_ITEM',
      playerId: resolvedMyUserId,
      equipmentCardId,
      targetRoleCardId,
    });
    setSelectedBattlefieldCardId(null);
  };

  // 8.13.3 自由时点执行协战
  const handlePerformAssist = (
    hostRoleCardId: string,
    partnerCardId: string,
    orbCardInstanceIds?: string[]
  ) => {
    sfx.playCardPlay();
    sendAction({
      type: 'PERFORM_ASSIST',
      playerId: resolvedMyUserId,
      hostRoleCardId,
      partnerCardId,
      orbCardInstanceIds,
    });
    setAssistHostCardId(null);
    setSelectedBattlefieldCardId(null);
  };

  // 10.8 发动非战术【瞬时】能力
  const handleUseInstant = (cardInstanceId: string) => {
    sfx.playCardPlay();
    sendAction({
      type: 'USE_INSTANT',
      playerId: resolvedMyUserId,
      cardInstanceId,
    });
    setSelectedHandCard(null);
    setSelectedBattlefieldCardId(null);
  };

  // 防守方宣告阻挡 (7.3.1.c)
  const handleBlockClick = (blockerCardId: string) => {
    sfx.playClick();
    sendAction({
      type: 'DECLARE_BLOCK',
      playerId: resolvedMyUserId,
      blockerCardId,
    });
    setSelectedBattlefieldCardId(null);
  };

  // 双击手牌快速出牌/使用
  const handleHandCardDoubleClick = (card: CardInstance) => {
    const def = findCardByNumberOrId(card.cardNumber || card.cardId);
    if (!def) return;

    if (usableInstantCardIds.has(card.instanceId)) {
      handleUseInstant(card.instanceId);
      return;
    }

    if (def.cardType === CardType.TACTICS) {
      handlePlayTactics(card.instanceId);
    } else if (def.cardType === CardType.EQUIPMENT) {
      handlePlayEquipment(card.instanceId);
    } else if (def.cardType === CardType.ASSIST) {
      handlePlayAssist(card.instanceId);
    } else if (def.cardType === CardType.ROLE) {
      // 寻找第一个完全空闲的卡位
      const emptySlot = mySlots.find(isBattlefieldSlotEmpty);
      if (emptySlot !== undefined) {
        sfx.playCardPlay();
        sendAction({
          type: 'PLAY_CARD',
          playerId: resolvedMyUserId,
          cardInstanceId: card.instanceId,
          targetSlotIndex: emptySlot.slotIndex,
        });
        setSelectedHandCard(null);
      }
    }
  };

  // 双击战场角色快速宣告攻击（仅可攻击玩家时执行，防止出场【突进】误发起直攻玩家）
  const handleBattlefieldRoleDoubleClick = (cardId: string) => {
    if (!mySlots.some((s) => isSlotEffectiveRoleCard(s, gameState.publicCards, cardId))) return;
    const card = gameState.publicCards[cardId];
    if (card && getAttackerCapabilities(gameState, resolvedMyUserId, card).canAttackPlayer) {
      handleAttackClick(cardId);
    }
  };

  // 右键呼出操作上下文菜单
  const handleOpenContextMenu = (e: React.MouseEvent, card: CardInstance) => {
    e.preventDefault();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      card,
    });
    setInspectedCard(card);
    sfx.playClick();
  };

  // 确认效果处理窗口的决策选项
  const handleChoiceConfirm = (selectedIds: string[]) => {
    if (!activePendingChoice) return;
    const socket = getSocket();
    sfx.playClick();
    socket.emit('game:choice', {
      gameId,
      pendingChoiceId: activePendingChoice.id,
      selectedIds,
    });
    setPendingChoice(null);
  };

  // 取消或跳过效果处理
  const handleChoiceCancel = () => {
    if (!activePendingChoice) return;
    const socket = getSocket();
    sfx.playClick();
    socket.emit('game:choice', {
      gameId,
      pendingChoiceId: activePendingChoice.id,
      selectedIds: [],
    });
    setPendingChoice(null);
  };

  const selectedHandCard = myHandCards.find((c) => c.instanceId === selectedHandCardId);
  const selectedHandCardDef = selectedHandCard
    ? findCardByNumberOrId(selectedHandCard.cardNumber || selectedHandCard.cardId)
    : null;

  // 当前浮动卡牌预览以 hoveredCard 优先，其次为 inspectedCard，并实时从最新状态派生
  const activePreviewCard = hoveredCard || inspectedCard;
  const freshInspectedCard = inspectedCard
    ? gameState.publicCards?.[inspectedCard.instanceId] ??
      myHandCards.find((c) => c.instanceId === inspectedCard.instanceId) ??
      inspectedCard
    : null;
  const freshDetailCard = (() => {
    const base = inspectedCard || activePreviewCard;
    if (!base) return null;
    return (
      gameState.publicCards?.[base.instanceId] ??
      myHandCards.find((c) => c.instanceId === base.instanceId) ??
      base
    );
  })();


  return (
    <div
      className="flex h-screen w-screen overflow-hidden bg-ink-950 text-fg font-sans relative select-none"
      onClick={() => {
        if (contextMenu) setContextMenu(null);
      }}
      onContextMenu={(e) => {
        // 全局右键取消 / 撤回
        if (contextMenu) {
          e.preventDefault();
          setContextMenu(null);
          return;
        }
        if (selectedHandCardId || selectedBattlefieldCardId || selectedOrbIds.length > 0) {
          e.preventDefault();
          setSelectedHandCard(null);
          setSelectedBattlefieldCardId(null);
          clearOrbSelection();
          sfx.playClick();
          return;
        }
      }}
    >
      {/* 战术交战弹道指示线 */}
      {isAttackTargeting && (
        <TargetingArrowOverlay
          attackerCardId={selectedBattlefieldCardId}
          onTargetSelected={(targetCardId, targetType) => {
            if (targetType === 'PLAYER') {
              handleAttackClick(selectedBattlefieldCardId!);
            } else if (targetCardId) {
              handleDropAttackTarget(targetCardId, selectedBattlefieldCardId!);
            }
          }}
          onCancel={() => setSelectedBattlefieldCardId(null)}
        />
      )}

      {/* 顶部全局错误通知 */}
      {lastError && (
        <div
          role="alert"
          className="fixed top-4 left-1/2 -translate-x-1/2 z-toast px-4 py-2 bg-crimson-500 text-fg text-caption font-medium flex items-center gap-2 shadow-overlay border border-fg/20 clip-corner-sm animate-in fade-in slide-in-from-top-2 duration-fast"
        >
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{lastError}</span>
        </div>
      )}

      {/* 本机网络断开提示 */}
      {!socketConnected && (
        <div
          role="status"
          className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 px-5 py-2.5 bg-ink-950/95 border border-crimson-500/80 text-crimson-400 shadow-overlay flex items-center gap-2 text-caption"
        >
          <RefreshCw className="w-4 h-4 animate-spin" />
          <span>与服务器的连接已断开，正在自动重连…</span>
        </div>
      )}

      {/* 对手掉线提示浮条 */}
      {isOpponentDisconnected && (
        <div className="fixed top-5 left-1/2 -translate-x-1/2 z-50 px-5 py-3 bg-ink-950/95 border border-gold-300 text-gold-300 shadow-overlay flex items-center gap-3 clip-corner-sm">
          <AlertCircle className="w-5 h-5 text-gold-300 flex-shrink-0" />
          <div>
            <div className="font-semibold text-fg text-body-sm">对手已暂时掉线 / 失去连接</div>
            <div className="text-fg-secondary text-caption mt-0.5">
              对战房间已保留，正在等待对手重新接入... 对手重连后将无缝继续推演
            </div>
          </div>
        </div>
      )}

      {/* 鼠标悬停卡牌实时详情浮窗 */}
      <CardHoverTooltip card={hoveredCard} />

      {/* 主对战桌面区域 (100vh 零滚动布局) */}
      <div className="flex-1 flex flex-col justify-between p-2 lg:p-2.5 overflow-hidden h-screen relative">
        {/* ================= 顶部控制条 ================= */}
        <header className="flex items-center justify-between px-3 py-1.5 bg-ink-900/90 border border-line backdrop-blur-sm z-20 flex-shrink-0 text-caption">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => {
                if (gameState?.status === 'PLAYING') {
                  const choice = confirm(
                    '您正在对战中：\n【确定】投降认输并结束推演对决\n【取消】留在战场继续对战\n\n提示：若因网络异常断开或临时离开，房间将持续为您保留，随时可重新接入。'
                  );
                  if (choice) {
                    handleExitGame(true);
                  }
                } else {
                  handleExitGame(false);
                }
              }}
              className="py-1 px-2 bg-ink-950 hover:bg-crimson-500/15 text-fg-muted hover:text-crimson-400 transition-colors border border-line hover:border-crimson-500/50 flex items-center gap-1 cursor-pointer"
              title="投降或返回大厅"
              aria-label="投降或返回大厅"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">退出/投降</span>
            </button>

            <div className="flex items-center gap-2 font-num tabular-nums">
              <span className="text-fg-muted font-sans">房间</span>
              <span className="text-fg font-semibold">{gameId.slice(0, 8)}</span>
              <span className="text-line-strong">/</span>
              <span className="text-fg-muted font-sans">回合</span>
              <span className="text-teal-400 font-bold">{gameState.turnNumber}</span>
            </div>
          </div>

          {/* 中央阶段标签与快捷操作 */}
          <div className="flex items-center gap-2 flex-wrap justify-center">
            {(() => {
              const phaseLabel = timing?.hasInstantPriority
                ? timing.timingWindowKind === 'END_PHASE'
                  ? '结束阶段·瞬时优先权'
                  : '自由时点·瞬时优先权'
                : timing?.canDeclareBlock
                ? '阻挡宣言阶段'
                : isMyTurn
                ? '我方行动阶段'
                : '对手行动中';
              const phaseBadgeClass = timing?.hasInstantPriority
                ? timing.timingWindowKind === 'END_PHASE'
                  ? 'bg-gold-300/20 text-gold-300 border-gold-300/70'
                  : 'bg-crimson-500/20 text-crimson-400 border-crimson-500/70'
                : isMyTurn || timing?.canDeclareBlock
                ? 'bg-teal-400/15 text-teal-400 border-teal-400/60'
                : 'bg-ink-850 text-fg-muted border-line';
              return (
                <span className={`px-3 py-0.5 text-caption font-semibold flex items-center gap-1.5 border ${phaseBadgeClass}`}>
                  <Clock className="w-3.5 h-3.5" />
                  <span>{phaseLabel}</span>
                </span>
              );
            })()}

            {timing?.canPass && (
              <button
                type="button"
                onClick={handlePassTiming}
                className="pgr-sweep flex items-center gap-1 px-2.5 py-0.5 clip-corner-sm bg-teal-400/15 hover:bg-teal-400/25 border border-teal-400/60 text-teal-400 text-hud font-semibold transition-colors cursor-pointer active:scale-95"
                title="推进阶段或让渡时点 (快捷键: Space)"
              >
                <span>{timing.passLabel} [Space]</span>
                <ChevronRight className="w-3 h-3" />
              </button>
            )}

            {gameState.phase === 'DRAW_CHARGE_PHASE' && isMyTurn && (
              <button
                type="button"
                onClick={() => handleChargeCostFromHand()}
                className={`${
                  !isHudOpen ? 'flex' : 'flex lg:hidden'
                } items-center gap-1 px-2.5 py-0.5 clip-corner-sm bg-gold-300 hover:bg-gold-300/90 text-ink-950 text-hud font-semibold transition-colors cursor-pointer active:scale-95`}
                title="跳过放置明费并进入主要阶段"
              >
                <Layers className="w-3 h-3" />
                <span>跳过放置明费</span>
              </button>
            )}
          </div>

          {/* 右侧工具栏按钮 */}
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={toggleSound}
              className={`p-1.5 border transition-colors cursor-pointer ${
                isMuted
                  ? 'border-line text-fg-muted bg-ink-950'
                  : 'border-teal-400/50 text-teal-400 bg-teal-400/10'
              }`}
              title={isMuted ? '取消静音 (快捷键: M)' : '静音 (快捷键: M)'}
              aria-label={isMuted ? '取消静音' : '静音'}
              aria-pressed={isMuted}
            >
              {isMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
            </button>

            <button
              type="button"
              onClick={() => setIsShortcutsModalOpen(true)}
              className="p-1.5 border border-line hover:border-teal-400/60 text-fg-secondary hover:text-fg bg-ink-950 transition-colors cursor-pointer"
              title="查看桌面快捷键指南 (快捷键: ?)"
              aria-label="查看桌面快捷键指南"
            >
              <KeyboardIcon className="w-3.5 h-3.5" />
            </button>

            <button
              type="button"
              onClick={() => setIsRuleGuideModalOpen(true)}
              className="p-1.5 px-2 border border-line hover:border-gold-300/60 text-fg-secondary hover:text-fg bg-ink-950 transition-colors flex items-center gap-1 text-hud cursor-pointer"
              title="官方规则手册 / 新手指南 (快捷键: H)"
              aria-label="打开官方规则手册"
            >
              <BookOpen className="w-3.5 h-3.5 text-gold-300" />
              <span className="hidden sm:inline text-gold-300 font-semibold">规则手册 [H]</span>
            </button>

            <button
              type="button"
              onClick={() => setIsHudOpen((prev) => !prev)}
              className="p-1.5 px-2 border border-line hover:border-teal-400/60 text-fg-secondary hover:text-fg bg-ink-950 transition-colors flex items-center gap-1 text-hud cursor-pointer"
              title="折叠 / 展开右侧战术终端 HUD (Tab)"
              aria-label={isHudOpen ? '折叠战术终端' : '展开战术终端'}
              aria-expanded={isHudOpen}
            >
              {isHudOpen ? <PanelRightClose className="w-3.5 h-3.5" /> : <PanelRightOpen className="w-3.5 h-3.5" />}
              <span className="hidden lg:inline">{isHudOpen ? '折叠终端' : '战术终端'}</span>
            </button>
          </div>
        </header>

        {/* ================= 对手区域 ================= */}
        <div className="flex items-center justify-between gap-3 px-2 py-0.5 max-w-5xl mx-auto w-full flex-shrink-0 z-20">
          <div
            onClick={() => {
              if (
                isAttackTargeting &&
                selectedAttackerCaps.canAttackPlayer &&
                selectedBattlefieldCardId
              ) {
                handleAttackClick(selectedBattlefieldCardId);
              }
            }}
            onDragOver={(e) => {
              if (!e.dataTransfer.types.includes('text/attacker-instance-id')) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
            }}
            onDrop={(e) => {
              e.preventDefault();
              const attackerId = e.dataTransfer.getData('text/attacker-instance-id');
              if (!attackerId) return;
              const attacker = gameState.publicCards?.[attackerId];
              if (!attacker) return;
              if (getAttackerCapabilities(gameState, resolvedMyUserId, attacker).canAttackPlayer) {
                handleAttackClick(attackerId);
              }
            }}
            className={`w-52 sm:w-56 lg:w-60 flex-shrink-0 transition-all duration-fast ${
              isAttackTargeting && selectedAttackerCaps.canAttackPlayer
                ? 'cursor-crosshair ring-1 ring-crimson-500 shadow-glow-crimson'
                : ''
            }`}
            title={
              isAttackTargeting && selectedAttackerCaps.canAttackPlayer
                ? '点击或拖拽攻击敌方玩家'
                : undefined
            }
          >
            <ErosionBar
              current={opponentPlayerState.erosionCount}
              playerName="对手"
              isOpponent
              compact={true}
              isAttackTargetable={isAttackTargeting && selectedAttackerCaps.canAttackPlayer}
            />
          </div>

          {/* 对手手牌背面阵列与紧凑信号球 */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 bg-ink-900/90 px-2.5 py-1 border border-line text-caption">
              <div className="flex items-center gap-1">
                {Array.from({ length: Math.min(gameState.opponentHandCount, 7) }, (_, i) => (
                  <div
                    key={i}
                    className="w-3.5 h-5 rounded-card bg-ink-850 border border-line-strong"
                  />
                ))}
              </div>
              <span className="text-fg-secondary font-num tabular-nums font-semibold text-hud ml-0.5">
                手牌 {gameState.opponentHandCount}
              </span>
            </div>

            {opponentOrbs.length > 0 && (
              <SignalOrbQueueView orbs={opponentOrbs} selectedOrbIds={[]} isOpponent compact={true} />
            )}
          </div>

          <div className="w-48 lg:w-52 flex-shrink-0">
            <CostZoneView
              cards={opponentCostCards}
              availableCount={opponentPlayerState.availableOpenCostCount}
              totalCount={opponentPlayerState.totalCostCount}
              hiddenCount={opponentPlayerState.hiddenCostCount}
              isOpponent
              compact={true}
              onOpenModal={() => openCostModal(true)}
            />
          </div>
        </div>

        {/* ================= 瞬时窗口独立流内操作条 (不被 7% 中线裁切) ================= */}
        {gameState.timingWindow && timing && (
          <div
            role="region"
            aria-label={timing.windowTitle || '瞬时窗口'}
            className={`flex items-center justify-between gap-2 px-3 py-1.5 mx-auto w-full max-w-5xl border flex-shrink-0 z-20 text-caption flex-wrap ${
              timing.timingWindowKind === 'END_PHASE'
                ? 'bg-ink-900/95 border-gold-300/70'
                : 'bg-ink-900/95 border-crimson-500/70'
            }`}
          >
            <div className="flex items-center gap-2 min-w-0">
              <Zap
                className={`w-4 h-4 shrink-0 ${
                  timing.timingWindowKind === 'END_PHASE' ? 'text-gold-300' : 'text-crimson-400'
                }`}
              />
              <span
                className={`font-semibold tracking-wide ${
                  timing.timingWindowKind === 'END_PHASE' ? 'text-gold-300' : 'text-crimson-400'
                }`}
              >
                {timing.windowTitle}
              </span>
            </div>

            <div className="flex items-center gap-1.5 flex-wrap">
              {timing.hasInstantPriority ? (
                <>
                  {usableNonTacticsInstants.map((inst) => (
                    <button
                      key={`bar-inst-${inst.card.instanceId}`}
                      type="button"
                      onClick={() => handleUseInstant(inst.card.instanceId)}
                      className="px-2.5 py-1 clip-corner-sm bg-teal-400 hover:bg-teal-400/90 text-ink-950 font-semibold text-hud flex items-center gap-1 cursor-pointer transition-colors"
                      title={`从${inst.sourceLabel}发动非战术【瞬时】(${inst.costLabel})`}
                    >
                      <Zap className="w-3 h-3 fill-current" />
                      <span>
                        {inst.sourceLabel}·{inst.name} ({inst.costLabel})
                      </span>
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={handlePassTiming}
                    className="px-2.5 py-1 clip-corner-sm bg-gold-300 hover:bg-gold-300/90 text-ink-950 font-semibold text-hud cursor-pointer transition-colors"
                  >
                    不使用【瞬时】 [Space]
                  </button>
                </>
              ) : (
                <span className="text-hud text-gold-300 flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5" />
                  <span>{timing.waitingHint}</span>
                </span>
              )}
            </div>
          </div>
        )}

        {/* ================= 中央大战场 (1064:600 锁定比例零变形自适应容器) ================= */}
        <div className="flex-1 min-h-0 min-w-0 w-full flex items-center justify-center p-0.5 overflow-hidden my-auto">
          <BattlefieldArenaView
            gameState={gameState}
            resolvedMyUserId={resolvedMyUserId}
            opponentUserId={opponentUserId}
            isMyTurn={isMyTurn}
            selectedHandCardId={selectedHandCardId}
            selectedBattlefieldCardId={selectedBattlefieldCardId}
            attackAnim={attackAnim}
            myGraveyardCards={myGraveyardCards}
            opponentGraveyardCards={opponentGraveyardCards}
            usableNonTacticsInstants={usableNonTacticsInstants}
            onRoleClick={handleRoleClick}
            onRoleDoubleClick={handleBattlefieldRoleDoubleClick}
            onRoleContextMenu={handleOpenContextMenu}
            onRoleLongPress={handleCardLongPress}
            onRoleHover={setHoveredCard}
            onSlotClick={handleSlotClick}
            onActivateAbility={handleActivateAbility}
            onOpenUnderneath={(hostCard) => setUnderneathHostCardId(hostCard.instanceId)}
            onAttackClick={handleAttackClick}
            onBlockClick={handleBlockClick}
            onEquipStartClick={(equipId) => setSelectedBattlefieldCardId(equipId)}
            onPerformAssistClick={(hostId) => setAssistHostCardId(hostId)}
            onUseInstant={handleUseInstant}
            onPassTiming={handlePassTiming}
            onDropCardToSlot={handleDropCardToSlot}
            onDropAttackTarget={handleDropAttackTarget}
            onDropEquipToRole={(targetRoleId, equipId) => handleEquipItem(equipId, targetRoleId)}
            onInspectCard={(card) => {
              setInspectedCard(card);
              sfx.playClick();
            }}
            onOpenGraveyard={openGraveyardModal}
          />
        </div>

        {/* ================= 己方操作与手牌区 ================= */}
        <div className="flex flex-col gap-1 flex-shrink-0 pt-0.5 border-t border-line">
          {/* 己方资源紧凑栏 */}
          <div className="flex items-center justify-between gap-3 px-2 py-0.5 max-w-5xl mx-auto w-full">
            <div className="w-52 sm:w-56 lg:w-60 flex-shrink-0">
              <ErosionBar current={myPlayerState.erosionCount} playerName="我方" compact={true} />
            </div>

            <div className="flex-1 max-w-xl mx-auto">
              <SignalOrbQueueView
                orbs={myOrbs}
                selectedOrbIds={selectedOrbIds}
                compact={true}
                abilityOptionsByCardId={zoneAbilityMap}
                onActivateAbility={(c, abilityIndex) => handleActivateAbility(c.instanceId, abilityIndex)}
                onInspectCard={(c) => {
                  setInspectedCard(c);
                  sfx.playClick();
                }}
                onContextMenu={(c, e) => handleOpenContextMenu(e, c)}
                onToggleSelectOrb={toggleOrbSelection}
                onEliminate={(orbIds) => {
                  sfx.playOrbTriple();
                  sendAction({
                    type: 'ELIMINATE_3_ORBS',
                    playerId: resolvedMyUserId,
                    orbCardInstanceIds: orbIds,
                  });
                  clearOrbSelection();
                }}
              />
            </div>

            <div className="w-48 lg:w-52 flex-shrink-0">
              <CostZoneView
                cards={myCostCards}
                availableCount={myPlayerState.availableOpenCostCount}
                totalCount={myPlayerState.totalCostCount}
                hiddenCount={myPlayerState.hiddenCostCount}
                compact={true}
                onOpenModal={() => openCostModal(false)}
              />
            </div>
          </div>

          {/* 手牌快捷操作提示与行动栏 */}
          {selectedHandCard && (
            <div className="flex items-center justify-between px-3 py-1 bg-ink-900 border border-teal-400/50 text-caption">
              <div className="flex items-center gap-2 min-w-0">
                <Info className="w-3.5 h-3.5 text-teal-400 shrink-0" />
                <span className="text-fg-secondary text-hud truncate">
                  选中：<strong className="text-fg">【{selectedHandCardDef?.name || selectedHandCard.cardNumber}】</strong>
                  {selectedHandCardDef && (() => {
                    const costInfo = getCardEffectiveCostInfo(gameState, resolvedMyUserId, selectedHandCard);
                    const costText =
                      costInfo.effectiveCost < costInfo.baseCost
                        ? `${costInfo.effectiveCost} (原${costInfo.baseCost})`
                        : `${costInfo.effectiveCost}`;
                    const optHint = costInfo.hasOptionalDiscount && costInfo.optionalDiscountLabel
                      ? ` · ${costInfo.optionalDiscountLabel}`
                      : '';
                    return ` (${formatCardType(selectedHandCardDef.cardType, selectedHandCardDef.isInstant)} · 费用 ${costText}${optHint})`;
                  })()}
                </span>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {selectedHandCardDef?.cardType === CardType.TACTICS && (
                  <button
                    type="button"
                    onClick={() => handlePlayTactics(selectedHandCard.instanceId)}
                    className="pgr-sweep px-2.5 py-0.5 clip-corner-sm bg-teal-400 hover:bg-teal-400/90 text-ink-950 font-semibold text-hud flex items-center gap-1 cursor-pointer transition-colors"
                  >
                    <Zap className="w-3 h-3 fill-current" />
                    <span>
                      {selectedHandCardDef.signalOrb || selectedHandCard.cardNumber?.startsWith('ORB-')
                        ? '放置信号球'
                        : '发动战术卡'}
                    </span>
                  </button>
                )}

                {selectedHandCardDef?.cardType === CardType.EQUIPMENT && (
                  <button
                    type="button"
                    onClick={() => handlePlayEquipment(selectedHandCard.instanceId)}
                    className="px-2.5 py-0.5 clip-corner-sm bg-gold-300 hover:bg-gold-300/90 text-ink-950 font-semibold text-hud flex items-center gap-1 cursor-pointer transition-colors"
                  >
                    <Shield className="w-3 h-3" />
                    <span>使用装备卡</span>
                  </button>
                )}

                {selectedHandCardDef?.cardType === CardType.ASSIST && (
                  <button
                    type="button"
                    onClick={() => handlePlayAssist(selectedHandCard.instanceId)}
                    className="px-2.5 py-0.5 clip-corner-sm bg-teal-400 hover:bg-teal-400/90 text-ink-950 font-semibold text-hud flex items-center gap-1 cursor-pointer transition-colors"
                  >
                    <Cpu className="w-3 h-3" />
                    <span>部署辅助机</span>
                  </button>
                )}

                {selectedHandActivateOptions.map((opt) => (
                  <button
                    key={`hand-act-${opt.abilityIndex}`}
                    type="button"
                    disabled={opt.disabled}
                    onClick={() => handleActivateAbility(selectedHandCard.instanceId, opt.abilityIndex)}
                    title={opt.disabled ? opt.reason : opt.label}
                    className="px-2.5 py-0.5 clip-corner-sm bg-gold-300 hover:bg-gold-300/90 text-ink-950 font-semibold text-hud flex items-center gap-1 cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed max-w-[200px]"
                  >
                    <Zap className="w-3 h-3 fill-current shrink-0" />
                    <span className="truncate">{opt.label}</span>
                  </button>
                ))}

                {usableInstantCardIds.has(selectedHandCard.instanceId) && (
                  <button
                    type="button"
                    onClick={() => handleUseInstant(selectedHandCard.instanceId)}
                    className="pgr-sweep px-2.5 py-0.5 clip-corner-sm bg-gold-300 hover:bg-gold-300/90 text-ink-950 font-semibold text-hud flex items-center gap-1 cursor-pointer transition-colors"
                  >
                    <Zap className="w-3 h-3 fill-current" />
                    <span>发动非战术【瞬时】</span>
                  </button>
                )}

                {selectedHandAscensionPlan && (
                  <button
                    type="button"
                    onClick={() => {
                      sfx.playClick();
                      setAscensionModalState({ card: selectedHandCard });
                    }}
                    className="pgr-sweep px-2.5 py-0.5 clip-corner-sm bg-gold-300 hover:bg-gold-300/90 text-ink-950 font-semibold text-hud flex items-center gap-1 cursor-pointer transition-colors"
                  >
                    <ArrowUpRight className="w-3 h-3" />
                    <span>升变出场</span>
                  </button>
                )}

                {gameState.phase === 'DRAW_CHARGE_PHASE' && isMyTurn && (
                  <button
                    type="button"
                    onClick={() => handleChargeCostFromHand()}
                    className="px-2.5 py-0.5 clip-corner-sm bg-gold-300 hover:bg-gold-300/90 text-ink-950 font-semibold text-hud flex items-center gap-1 cursor-pointer transition-colors"
                  >
                    <Layers className="w-3 h-3" />
                    <span>充为明费</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => setSelectedHandCard(null)}
                  className="px-2 py-0.5 bg-ink-850 hover:bg-ink-700 border border-line text-fg-muted hover:text-fg text-hud cursor-pointer transition-colors"
                >
                  取消 [Esc]
                </button>
              </div>
            </div>
          )}

          {/* 己方手牌行 */}
          <div className="flex flex-col gap-0.5">
            <div className="flex justify-between items-center text-hud text-fg-muted px-3">
              <span>我方手牌 · 1~7 选择 / 右键菜单 / 双击或拖拽出牌</span>
              <span className="font-num tabular-nums">手牌 {myHandCards.length} / 7</span>
            </div>

            <div className="flex gap-2.5 overflow-x-auto py-1 px-3 bg-ink-900/75 border border-line min-h-[120px] max-h-[128px] items-center touch-pan-x">
              {myHandCards.map((card, idx) => {
                const isSelected = selectedHandCardId === card.instanceId;
                const isLegalHandPlay = isHandCardLegalToPlay(
                  gameState,
                  resolvedMyUserId,
                  card,
                  usableInstantCardIds,
                  zoneAbilityMap
                );
                return (
                  <div
                    key={card.instanceId}
                    className="relative group transition-transform duration-fast ease-enter hover:-translate-y-2.5 hover:scale-105 hover:z-30 card-interactive select-none flex-shrink-0"
                    onTouchStart={(e) => {
                      const t = e.touches[0];
                      touchStartPosRef.current = { x: t.clientX, y: t.clientY };
                    }}
                    onTouchMove={(e) => {
                      if (!touchStartPosRef.current) return;
                      const t = e.touches[0];
                      const dy = t.clientY - touchStartPosRef.current.y;
                      const dx = t.clientX - touchStartPosRef.current.x;
                      if (dy < -18 && Math.abs(dy) > Math.abs(dx)) {
                        if (e.cancelable) e.preventDefault();
                        setTouchDragInfo({
                          cardId: card.instanceId,
                          x: t.clientX,
                          y: t.clientY,
                          isDragging: true,
                        });
                      }
                    }}
                    onTouchEnd={(e) => {
                      if (touchDragInfo?.isDragging) {
                        const t = e.changedTouches[0];
                        const elem = document.elementFromPoint(t.clientX, t.clientY);
                        const slotEl = elem?.closest('[data-slot-index]');
                        if (slotEl) {
                          const sIndex = Number(slotEl.getAttribute('data-slot-index'));
                          handleDropCardToSlot(sIndex, card.instanceId);
                        } else {
                          const arenaEl = elem?.closest('.ygo-battlefield-mat');
                          if (arenaEl) {
                            const emptySlot = mySlots.find(isBattlefieldSlotEmpty);
                            if (emptySlot !== undefined) {
                              handleDropCardToSlot(emptySlot.slotIndex, card.instanceId);
                            }
                          }
                        }
                      }
                      setTouchDragInfo(null);
                      touchStartPosRef.current = null;
                    }}
                  >
                    {/* 数字键序号提示角标 */}
                    <div className="absolute -top-2 left-1.5 z-20 px-1 py-px bg-ink-950 border border-line text-hud font-num text-fg-muted group-hover:text-teal-400 group-hover:border-teal-400/60 transition-colors">
                      {idx + 1}
                    </div>

                    <CardView
                      card={card}
                      isSelected={isSelected}
                      isLegalPlay={isLegalHandPlay}
                      isDraggable={isLegalHandPlay}
                      onClick={() => {
                        setSelectedHandCard(card.instanceId);
                        setInspectedCard(card);
                        sfx.playClick();
                      }}
                      onDoubleClick={() => handleHandCardDoubleClick(card)}
                      onContextMenu={(e) => handleOpenContextMenu(e, card)}
                      onMouseEnter={() => {
                        setHoveredCard(card);
                        sfx.playHover();
                      }}
                      onMouseLeave={() => setHoveredCard(null)}
                      onLongPress={() => handleCardLongPress(card)}
                      size="sm"
                    />
                  </div>
                );
              })}
            </div>

            {/* 移动端手牌触控拖拽光标跟随预览 */}
            {touchDragInfo?.isDragging && (
              <div
                className="fixed pointer-events-none z-50 -translate-x-1/2 -translate-y-1/2 opacity-95 scale-110 shadow-glow-teal"
                style={{ left: touchDragInfo.x, top: touchDragInfo.y }}
              >
                <CardView
                  card={myHandCards.find((c) => c.instanceId === touchDragInfo.cardId)}
                  size="sm"
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ================= 右侧战术终端面板 ================= */}
      {isHudOpen && (
        <div className="fixed inset-0 z-50 lg:static lg:z-30 flex justify-end">
          <div
            className="fixed inset-0 bg-ink-950/75 backdrop-blur-sm lg:hidden"
            onClick={() => setIsHudOpen(false)}
          />
          <aside className="relative z-10 w-[85vw] max-w-sm lg:w-[340px] h-full border-l border-line-strong bg-ink-900/95 flex flex-col justify-between p-3.5 backdrop-blur-md overflow-y-auto flex-shrink-0 animate-in slide-in-from-right duration-fast">
            <div className="absolute inset-x-0 top-0 h-[2px] bg-crimson-500" />
            <div className="flex flex-col gap-3">
              {/* 终端头部 */}
              <div className="flex justify-between items-center border-b border-line pb-2.5">
                <div>
                  <div className="text-hud font-display text-fg-muted uppercase tracking-widest">
                    COMMAND HUD
                  </div>
                  <div className="text-body-sm font-bold text-fg flex items-center gap-2 font-num tabular-nums mt-0.5">
                    <span>回合 {gameState.turnNumber}</span>
                    <span
                      className={`text-hud px-1.5 py-px font-sans font-semibold border ${
                        isMyTurn
                          ? 'bg-teal-400/15 text-teal-400 border-teal-400/50'
                          : 'bg-ink-850 text-fg-muted border-line'
                      }`}
                    >
                      {isMyTurn ? '我方' : '对手'}
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setIsHudOpen(false)}
                  aria-label="收起终端"
                  className="p-1.5 border border-line text-fg-muted hover:text-fg hover:border-teal-400 transition-colors cursor-pointer"
                  title="收起终端 (Tab)"
                >
                  <PanelRightClose className="w-4 h-4" />
                </button>
              </div>

              {/* 回合流程指南 */}
              <TurnFlowView
                currentPhase={gameState.phase}
                isMyTurn={isMyTurn}
                canPassTiming={!!timing?.canPass}
                passLabel={timing?.passLabel}
                waitingHint={timing?.waitingHint}
                pendingTriggers={gameState.pendingTriggers}
                onPassTiming={handlePassTiming}
              />

              {/* 抽牌阶段快速跳过明费按钮 */}
              {gameState.phase === 'DRAW_CHARGE_PHASE' && isMyTurn && !selectedHandCardId && (
                <button
                  type="button"
                  onClick={() => handleChargeCostFromHand()}
                  className="w-full py-2 clip-corner-sm bg-gold-300 hover:bg-gold-300/90 text-ink-950 font-semibold text-caption flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
                >
                  <Layers className="w-3.5 h-3.5" />
                  <span>跳过明费填充进入主要阶段</span>
                </button>
              )}

              {/* 战术卡牌详情检视面板 */}
              <div className="flex flex-col gap-1.5">
                <span className="text-caption text-fg-secondary font-semibold flex items-center justify-between">
                  <span>卡牌战术详情</span>
                  {inspectedCard && (
                    <button
                      type="button"
                      onClick={() => setIsDetailModalOpen(true)}
                      className="text-hud text-teal-400 hover:underline font-medium cursor-pointer"
                    >
                      放大大图 [F]
                    </button>
                  )}
                </span>
                <CardDetailPanel
                  card={freshInspectedCard}
                  publicCards={gameState.publicCards}
                  effectiveCost={
                    freshInspectedCard && freshInspectedCard.zone === 'HAND'
                      ? getCardEffectiveCost(gameState, resolvedMyUserId, freshInspectedCard)
                      : undefined
                  }
                  onOpenModal={() => setIsDetailModalOpen(true)}
                  customAction={(() => {
                    if (
                      !freshInspectedCard ||
                      freshInspectedCard.controllerPlayerId !== resolvedMyUserId
                    ) {
                      return undefined;
                    }
                    const abilityOpts = getCardActivatedAbilityOptions(
                      gameState,
                      resolvedMyUserId,
                      freshInspectedCard
                    );
                    const nonHandAction = getNonHandPlayAction(
                      gameState,
                      resolvedMyUserId,
                      freshInspectedCard
                    );
                    const isInstantUsable = usableInstantCardIds.has(freshInspectedCard.instanceId);
                    const handAscPlan =
                      freshInspectedCard.zone === 'HAND' &&
                      isMyTurn &&
                      gameState.phase === 'MAIN_PHASE'
                        ? getAscensionPlan(gameState, resolvedMyUserId, freshInspectedCard)
                        : null;
                    const isEffectiveRole =
                      freshInspectedCard.zone === 'BATTLEFIELD' &&
                      mySlots.some((s) =>
                        isSlotEffectiveRoleCard(
                          s,
                          gameState.publicCards,
                          freshInspectedCard.instanceId
                        )
                      );
                    const canAttack =
                      isEffectiveRole &&
                      getAttackerCapabilities(gameState, resolvedMyUserId, freshInspectedCard).canAttackPlayer;

                    if (
                      abilityOpts.length === 0 &&
                      !nonHandAction &&
                      !isInstantUsable &&
                      !handAscPlan &&
                      !canAttack
                    ) {
                      return undefined;
                    }

                    return (
                      <div className="flex flex-wrap items-center gap-1.5">
                        {abilityOpts.map((opt) => (
                          <button
                            key={`detail-act-${opt.abilityIndex}-${opt.grantedByEquipmentId || 'own'}`}
                            type="button"
                            disabled={opt.disabled}
                            onClick={() => {
                              handleActivateAbility(
                                freshInspectedCard.instanceId,
                                opt.abilityIndex
                              );
                              setSelectedBattlefieldCardId(null);
                            }}
                            className="px-2 py-0.5 clip-corner-sm bg-gold-300 hover:bg-gold-300/90 text-ink-950 font-semibold text-hud flex items-center gap-1 cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed max-w-[180px]"
                            title={opt.disabled ? opt.reason : opt.label}
                          >
                            <Zap className="w-3 h-3 fill-current shrink-0" />
                            <span className="truncate">
                              {opt.grantedByEquipmentId && !opt.label.includes('[装备]')
                                ? `[装备] ${opt.label}`
                                : abilityOpts.length > 1 || opt.zone !== 'BATTLEFIELD'
                                ? opt.label
                                : '发动【起】'}
                            </span>
                          </button>
                        ))}

                        {nonHandAction && (
                          <button
                            type="button"
                            onClick={() => handleNonHandPlay(freshInspectedCard, nonHandAction)}
                            className="px-2 py-0.5 clip-corner-sm bg-teal-400 hover:bg-teal-400/90 text-ink-950 font-semibold text-hud flex items-center gap-1 cursor-pointer transition-colors"
                          >
                            <Play className="w-3 h-3 shrink-0" />
                            <span>{nonHandAction.label}</span>
                          </button>
                        )}

                        {isInstantUsable && (
                          <button
                            type="button"
                            onClick={() => handleUseInstant(freshInspectedCard.instanceId)}
                            className="px-2 py-0.5 clip-corner-sm bg-teal-400 hover:bg-teal-400/90 text-ink-950 font-semibold text-hud flex items-center gap-1 cursor-pointer transition-colors"
                          >
                            <Zap className="w-3 h-3 fill-current shrink-0" />
                            <span>发动【瞬时】</span>
                          </button>
                        )}

                        {handAscPlan && (
                          <button
                            type="button"
                            onClick={() => {
                              sfx.playClick();
                              setAscensionModalState({ card: freshInspectedCard });
                            }}
                            className="px-2 py-0.5 clip-corner-sm bg-gold-300 hover:bg-gold-300/90 text-ink-950 font-semibold text-hud flex items-center gap-1 cursor-pointer transition-colors"
                          >
                            <ArrowUpRight className="w-3 h-3 shrink-0" />
                            <span>升变</span>
                          </button>
                        )}

                        {canAttack && (
                          <button
                            type="button"
                            onClick={() => {
                              handleAttackClick(freshInspectedCard.instanceId);
                              setSelectedBattlefieldCardId(null);
                            }}
                            className="px-2 py-0.5 clip-corner-sm bg-crimson-500 hover:bg-crimson-400 text-fg font-semibold text-hud flex items-center gap-1 cursor-pointer transition-colors"
                            title="宣告攻击对方玩家"
                          >
                            <Swords className="w-3 h-3" />
                            <span>宣告攻击</span>
                          </button>
                        )}
                      </div>
                    );
                  })()}
                />
              </div>

              {/* 实时战斗事件流日志 */}
              <div className="flex flex-col gap-1.5 flex-1 overflow-hidden mt-1">
                <span className="text-hud font-display uppercase tracking-widest text-fg-muted">
                  COMBAT LOG · 对局事件流
                </span>
                <div className="h-32 lg:h-40 overflow-y-auto bg-ink-950 p-2.5 border border-line text-hud leading-relaxed flex flex-col gap-1 text-fg-secondary font-num">
                  {combatLogs.length === 0 ? (
                    <span className="text-fg-disabled font-sans">等待战术行动中...</span>
                  ) : (
                    combatLogs.map((log, index) => (
                      <div key={index} className="border-b border-line pb-1 font-sans">
                        {log}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </aside>
        </div>
      )}

      {/* ================= 浮层与交互弹窗组件 ================= */}

      {/* 1. 右键动态操作上下文菜单 (CardContextMenu) */}
      {contextMenu && (() => {
        const ctxCard =
          gameState.publicCards?.[contextMenu.card.instanceId] ??
          myHandCards.find((c) => c.instanceId === contextMenu.card.instanceId) ??
          contextMenu.card;
        const isFriendlyFieldRole = mySlots.some((s) =>
          isSlotEffectiveRoleCard(s, gameState.publicCards, ctxCard.instanceId)
        );
        const isFriendlyStandaloneEquip = mySlots.some(
          (s) => s.standaloneEquipmentId === ctxCard.instanceId
        );
        const ctxUnderneathInstants =
          isFriendlyFieldRole && ctxCard.underneathCardIds?.length
            ? usableNonTacticsInstants.filter((inst) =>
                ctxCard.underneathCardIds.includes(inst.card.instanceId)
              )
            : [];
        const ctxActivateOptions =
          ctxCard.controllerPlayerId === resolvedMyUserId
            ? getCardActivatedAbilityOptions(gameState, resolvedMyUserId, ctxCard)
            : [];
        const ctxHandAscensionPlan =
          ctxCard.controllerPlayerId === resolvedMyUserId && ctxCard.zone === 'HAND'
            ? getAscensionPlan(gameState, resolvedMyUserId, ctxCard)
            : null;
        const ctxNonHandPlayAction =
          ctxCard.controllerPlayerId === resolvedMyUserId
            ? getNonHandPlayAction(gameState, resolvedMyUserId, ctxCard)
            : null;

        return (
          <CardContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            card={ctxCard}
            gameState={gameState}
            myUserId={resolvedMyUserId}
            isMyTurn={isMyTurn}
            phase={gameState.phase}
            myAvailableCost={myPlayerState.availableOpenCostCount + myPlayerState.hiddenCostCount}
            canUseInstant={!!timing?.hasInstantPriority}
            effectiveCost={
              ctxCard.zone === 'HAND'
                ? getCardEffectiveCost(gameState, resolvedMyUserId, ctxCard)
                : undefined
            }
            isFriendlyRole={
              ctxCard.controllerPlayerId === resolvedMyUserId &&
              ctxCard.zone === 'BATTLEFIELD'
            }
            isOpponentRole={
              ctxCard.controllerPlayerId === opponentUserId &&
              ctxCard.zone === 'BATTLEFIELD' &&
              opponentSlots.some((s) =>
                isSlotEffectiveRoleCard(s, gameState.publicCards, ctxCard.instanceId)
              )
            }
            isStandaloneEquipment={isFriendlyStandaloneEquip}
            isHandCard={
              ctxCard.controllerPlayerId === resolvedMyUserId &&
              ctxCard.zone === 'HAND'
            }
            activateOptions={ctxActivateOptions}
            handAscensionPlan={ctxHandAscensionPlan}
            nonHandPlayAction={ctxNonHandPlayAction}
            underneathCardsCount={ctxCard.underneathCardIds?.length ?? 0}
            canAttack={
              isFriendlyFieldRole &&
              getAttackerCapabilities(gameState, resolvedMyUserId, ctxCard).canAttackPlayer
            }
            canBlock={
              isFriendlyFieldRole && canRoleBlockAttacker(gameState, resolvedMyUserId, ctxCard)
            }
            canPerformAssist={
              isFriendlyFieldRole && canRolePerformAssist(gameState, resolvedMyUserId, ctxCard)
            }
            canEquipStandalone={
              isMyTurn &&
              gameState.phase === 'MAIN_PHASE' &&
              !gameState.currentCombat &&
              isFriendlyStandaloneEquip &&
              mySlots.some((s) => getSlotOccupancy(s, gameState.publicCards).kind === 'ROLE')
            }
            canUseHandInstant={
              ctxCard.zone === 'HAND' && usableInstantCardIds.has(ctxCard.instanceId)
            }
            underneathInstants={ctxUnderneathInstants}
            hasEmptySlot={mySlots.some(isBattlefieldSlotEmpty)}
            hasAssistSlot={mySlots.some((s) => canPlayAssistOnSlot(s, gameState.publicCards))}
            hasSelectedAttacker={Boolean(selectedAttackerCard)}
            canAttackThisOpponentRole={Boolean(
              selectedAttackerCard &&
                isLegalRoleAttackTarget(gameState, resolvedMyUserId, selectedAttackerCard, ctxCard)
            )}
            onPlayCard={(card) => {
              const def = findCardByNumberOrId(card.cardNumber || card.cardId);
              if (def?.cardType === CardType.TACTICS) {
                handlePlayTactics(card.instanceId);
              } else if (def?.cardType === CardType.EQUIPMENT) {
                handlePlayEquipment(card.instanceId);
              } else if (def?.cardType === CardType.ASSIST) {
                handlePlayAssist(card.instanceId);
              } else {
                const emptySlot = mySlots.find(isBattlefieldSlotEmpty);
                if (emptySlot !== undefined) {
                  handleDropCardToSlot(emptySlot.slotIndex, card.instanceId);
                }
              }
            }}
            onAscendCard={(card) => {
              sfx.playClick();
              setAscensionModalState({ card });
            }}
            onActivateAbility={(card, abilityIndex = 0) =>
              handleActivateAbility(card.instanceId, abilityIndex)
            }
            onOpenUnderneath={(card) => setUnderneathHostCardId(card.instanceId)}
            onNonHandPlay={handleNonHandPlay}
            onAttackPlayer={(card) => handleAttackClick(card.instanceId)}
            onAttackRole={(card) => {
              if (selectedBattlefieldCardId) {
                handleDropAttackTarget(card.instanceId, selectedBattlefieldCardId);
              }
            }}
            onBlock={(card) => handleBlockClick(card.instanceId)}
            onPerformAssist={(card) => setAssistHostCardId(card.instanceId)}
            onStartEquipStandalone={(card) => setSelectedBattlefieldCardId(card.instanceId)}
            onUseInstant={handleUseInstant}
            onChargeCost={(card) => handleChargeCostFromHand(card.instanceId)}
            onInspectCard={(card) => {
              setInspectedCard(card);
              setIsDetailModalOpen(true);
            }}
            onClose={() => setContextMenu(null)}
          />
        );
      })()}

      {/* 0. YGOPro 风格全屏阶段切换横幅 (BATTLE PHASE / MAIN PHASE 飞入动画等) */}
      <PhaseBannerView
        phase={gameState.phase}
        turnNumber={gameState.turnNumber}
        activePlayerId={gameState.activePlayerId}
        myUserId={resolvedMyUserId}
      />

      {/* 1.5 开局手牌调度弹窗 (MulliganModal) */}
      <MulliganModal
        isOpen={gameState.phase === 'MULLIGAN_PHASE' && !Boolean(myPlayerState.hasMulliganed)}
        handCards={myHandCards}
        onConfirm={(cardInstanceIdsToBottom) => {
          sendAction({
            type: 'RESOLVE_MULLIGAN',
            playerId: resolvedMyUserId,
            cardInstanceIdsToBottom,
          });
        }}
        isOpponentReady={Boolean(opponentPlayerState.hasMulliganed)}
      />

      {/* 调度完成等待对手提示条 */}
      {gameState.phase === 'MULLIGAN_PHASE' && Boolean(myPlayerState.hasMulliganed) && (
        <div className="fixed top-5 left-1/2 -translate-x-1/2 z-50 px-5 py-2.5 clip-corner-sm bg-ink-950/95 border border-teal-400/70 text-teal-400 text-caption flex items-center gap-3 shadow-overlay">
          <RefreshCw className="w-4 h-4 animate-spin text-teal-400" />
          <span>手牌调度已确认！正在等待对手确认调度，稍后将自动开局...</span>
        </div>
      )}

      {/* 2. 效果处理决策窗口 */}
      {activePendingChoice && activePendingChoice.playerId === resolvedMyUserId && (
        <PendingChoiceModal
          key={activePendingChoice.id}
          choice={activePendingChoice}
          gameState={gameState}
          myUserId={resolvedMyUserId}
          onConfirm={handleChoiceConfirm}
          onCancel={handleChoiceCancel}
        />
      )}

      {/* 对手处理决策中的状态条 */}
      {Boolean(
        (activePendingChoice && activePendingChoice.playerId !== resolvedMyUserId) ||
        gameState.opponentPendingChoice
      ) && (
        <div className="fixed top-5 left-1/2 -translate-x-1/2 z-50 px-5 py-2.5 clip-corner-sm bg-ink-950/95 border border-gold-300/80 text-gold-300 text-caption flex items-center gap-2.5 shadow-overlay">
          <Clock className="w-4 h-4 text-gold-300" />
          <span>
            {gameState.opponentPendingChoice?.effectType === 'OPPONENT_CONFIRM_REVEAL'
              ? '已公开卡牌！正在等待对手查阅确认，稍后将继续处理...'
              : '对手正在处理效果结算选择中，请稍候...'}
          </span>
        </div>
      )}

      {/* 3. 墓地卡牌清单弹窗（实时读取最新 gameState） */}
      <GraveyardModal
        isOpen={graveyardOwner !== null}
        onClose={() => setGraveyardOwner(null)}
        cards={graveyardOwner === 'OPPONENT' ? opponentGraveyardCards : myGraveyardCards}
        title={graveyardOwner === 'OPPONENT' ? '敌方墓地' : '我方墓地'}
        isFriendly={graveyardOwner === 'MY'}
        abilityOptionsByCardId={graveyardOwner === 'MY' ? zoneAbilityMap : undefined}
        nonHandActionsByCardId={graveyardOwner === 'MY' ? graveyardNonHandActions : undefined}
        onActivateAbility={(c, abilityIndex) => handleActivateAbility(c.instanceId, abilityIndex)}
        onNonHandPlay={handleNonHandPlay}
        onSelectCard={(c) => {
          setInspectedCard(c);
          setGraveyardOwner(null);
        }}
        onLongPress={(c) => {
          setInspectedCard(c);
          setIsDetailModalOpen(true);
        }}
      />

      {/* 4. 高清卡牌大图与完整效果检视弹窗 */}
      <CardDetailModal
        card={freshDetailCard}
        publicCards={gameState.publicCards}
        effectiveCost={
          freshDetailCard && freshDetailCard.zone === 'HAND'
            ? getCardEffectiveCost(gameState, resolvedMyUserId, freshDetailCard)
            : undefined
        }
        isOpen={isDetailModalOpen}
        onClose={() => setIsDetailModalOpen(false)}
      />

      {/* 5. 键盘快捷键帮助指南弹窗 */}
      <KeyboardShortcutsModal
        isOpen={isShortcutsModalOpen}
        onClose={() => setIsShortcutsModalOpen(false)}
      />

      {/* 5.1 官方规则手册与新手指南弹窗 */}
      <RuleGuideModal
        isOpen={isRuleGuideModalOpen}
        onClose={() => setIsRuleGuideModalOpen(false)}
      />

      {/* 6. 双方费用区卡牌检视弹窗 */}
      <CostZoneModal
        isOpen={costModalState.isOpen}
        onClose={() => setCostModalState({ isOpen: false, isOpponent: false })}
        cards={costModalState.isOpponent ? opponentCostCards : myCostCards}
        availableCount={
          costModalState.isOpponent
            ? opponentPlayerState.availableOpenCostCount
            : myPlayerState.availableOpenCostCount
        }
        totalCount={
          costModalState.isOpponent
            ? opponentPlayerState.totalCostCount
            : myPlayerState.totalCostCount
        }
        hiddenCount={
          costModalState.isOpponent
            ? opponentPlayerState.hiddenCostCount
            : myPlayerState.hiddenCostCount
        }
        isOpponent={costModalState.isOpponent}
        usableInstantCardIds={costModalState.isOpponent ? undefined : usableInstantCardIds}
        abilityOptionsByCardId={costModalState.isOpponent ? undefined : zoneAbilityMap}
        onUseInstant={costModalState.isOpponent ? undefined : handleUseInstant}
        onActivateAbility={
          costModalState.isOpponent
            ? undefined
            : (c, abilityIndex) => handleActivateAbility(c.instanceId, abilityIndex)
        }
        onInspectCard={(c) => {
          setInspectedCard(c);
        }}
      />

      {/* 6.4 角色/辅助机下方卡牌检视与操作弹窗 */}
      {(() => {
        const underneathHost = underneathHostCardId
          ? gameState.publicCards?.[underneathHostCardId] ?? null
          : null;
        return (
          <UnderneathCardsModal
            isOpen={Boolean(underneathHost)}
            onClose={() => setUnderneathHostCardId(null)}
            hostCard={underneathHost}
            gameState={gameState}
            myUserId={resolvedMyUserId}
            isFriendly={underneathHost?.controllerPlayerId === resolvedMyUserId}
            usableInstantCardIds={usableInstantCardIds}
            onActivateAbility={(c, abilityIndex) => handleActivateAbility(c.instanceId, abilityIndex)}
            onUseInstant={handleUseInstant}
            onNonHandPlay={handleNonHandPlay}
            onInspectCard={(c) => {
              setInspectedCard(c);
              setIsDetailModalOpen(true);
            }}
          />
        );
      })()}

      {/* 6.5 自由时点协战搭档选择弹窗 (8.13) */}
      {(() => {
        const assistHost = assistHostCardId ? gameState.publicCards?.[assistHostCardId] ?? null : null;
        return (
          <AssistModal
            isOpen={Boolean(assistHost)}
            hostRole={assistHost}
            candidates={assistHost ? getAssistPartnerCandidates(gameState, resolvedMyUserId, assistHost) : []}
            myOrbs={myOrbs}
            onConfirm={handlePerformAssist}
            onClose={() => setAssistHostCardId(null)}
          />
        );
      })()}

      {/* 6.6 统一升变确认弹窗 (8.11) */}
      <AscensionModal
        isOpen={Boolean(ascensionModalState && activeAscensionPlan)}
        plan={activeAscensionPlan}
        gameState={gameState}
        myUserId={resolvedMyUserId}
        myAvailableCost={myPlayerState.availableOpenCostCount + myPlayerState.hiddenCostCount}
        initialTargetCardId={ascensionModalState?.initialTargetCardId}
        initialSlotIndex={ascensionModalState?.initialSlotIndex}
        onConfirm={(payload) => {
          if (!ascensionModalState) return;
          sfx.playCardPlay();
          sendAction({
            type: 'PLAY_CARD',
            playerId: resolvedMyUserId,
            cardInstanceId: ascensionModalState.card.instanceId,
            isAscension: true,
            ...payload,
          });
          setAscensionModalState(null);
          setSelectedHandCard(null);
          setSelectedBattlefieldCardId(null);
        }}
        onClose={() => setAscensionModalState(null)}
      />

      {/* 7. 胜负公布结算弹窗 */}
      {gameOverResult && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="对局结算"
          className="fixed inset-0 bg-ink-950/85 backdrop-blur-md flex items-center justify-center z-50 p-4 animate-in fade-in duration-base"
        >
          <div className="relative max-w-md w-full p-8 clip-corner-md border border-line-strong bg-ink-900 flex flex-col items-center text-center shadow-overlay animate-in zoom-in-95 duration-fast">
            <div
              className={`absolute inset-x-0 top-0 h-[2px] ${
                gameOverResult.winnerId === resolvedMyUserId ? 'bg-gold-300' : 'bg-crimson-500'
              }`}
            />
            <HudBrackets
              size="md"
              color={gameOverResult.winnerId === resolvedMyUserId ? 'teal' : 'crimson'}
            />

            <div
              className={`w-16 h-16 flex items-center justify-center mb-4 border ${
                gameOverResult.winnerId === resolvedMyUserId
                  ? 'bg-gold-300/15 text-gold-300 border-gold-300/60'
                  : 'bg-crimson-500/15 text-crimson-400 border-crimson-500/60'
              }`}
            >
              <Trophy className="w-8 h-8" />
            </div>

            <div className="text-hud font-display uppercase tracking-widest text-fg-muted mb-1">
              {gameOverResult.isDraw
                ? 'OPERATION DRAW'
                : gameOverResult.winnerId === resolvedMyUserId
                ? 'MISSION ACCOMPLISHED'
                : 'CONNECTION TERMINATED'}
            </div>

            <h2 className="text-title font-bold text-fg mb-2">
              {gameOverResult.isDraw
                ? '对局平局 (1.2.3)'
                : gameOverResult.winnerId === resolvedMyUserId
                ? '作战胜利'
                : '作战失败'}
            </h2>

            <p className="text-caption text-fg-muted mb-6 leading-relaxed">
              {gameOverResult.reason}
            </p>

            <Button
              variant="primary"
              size="lg"
              onClick={() => handleExitGame(false)}
              className="w-full"
            >
              返回房间大厅
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

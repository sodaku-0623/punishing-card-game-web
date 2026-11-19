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
import { TurnFlowView } from '@/components/game/TurnFlowView';
import { RuleGuideModal } from '@/components/game/RuleGuideModal';
import { Button, HudBrackets } from '@/components/ui';
import { findCardByNumberOrId, formatCardType } from '@/lib/cards-data';
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
} from 'lucide-react';

export default function GameTabletopPage() {
  const router = useRouter();
  // 真实对局 ID (已解码；静态导出部署时从地址栏读取，见 src/lib/route-id.tsx)
  const gameId = useRouteId();
  const { user } = useAuth();

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
  // 墓地检视弹窗控制
  const [isGraveyardOpen, setIsGraveyardOpen] = useState(false);
  const [graveyardCards, setGraveyardCards] = useState<CardInstance[]>([]);
  const [graveyardTitle, setGraveyardTitle] = useState('我方墓地');
  // 对手掉线或失去连接状态
  const [isOpponentDisconnected, setIsOpponentDisconnected] = useState(false);
  // 当前战场选中的角色卡 (点击后展开【起】发动或攻击按钮)
  const [selectedBattlefieldCardId, setSelectedBattlefieldCardId] = useState<string | null>(null);
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
    useGameStore.getState().reset();
    setIsOpponentDisconnected(false);
    setSelectedBattlefieldCardId(null);
    setHoveredCard(null);
    setInspectedCard(null);
    setIsDetailModalOpen(false);
    setIsGraveyardOpen(false);
    setGraveyardCards([]);
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
  }, [gameId, user, setMyUserId, updateGameState, setPendingChoice, appendEvents, setLastError, setGameOverResult]);

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

  // 是否正在拉取攻击指示箭头 (我方准备就绪的角色被选中且处于主要阶段)
  const isAttackTargeting = useMemo(() => {
    if (!selectedBattlefieldCardId || !gameState || !isMyTurn || gameState.phase !== 'MAIN_PHASE') {
      return false;
    }
    const card = gameState.publicCards?.[selectedBattlefieldCardId];
    if (!card || card.controllerPlayerId !== resolvedMyUserId || !card.isReady) {
      return false;
    }
    const cardDef = findCardByNumberOrId(card.cardNumber || card.cardId);
    const hasRush = Boolean(cardDef?.rulesText?.includes('速攻') || card.grantedKeywords?.includes('速攻'));
    return (
      card.turnEnteredZone < gameState.turnNumber ||
      hasRush
    );
  }, [selectedBattlefieldCardId, gameState, isMyTurn, resolvedMyUserId]);

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
      // 忽略在输入框内的按键
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
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
        if (curOrbs[orbIdx]) {
          toggleOrbSelection(curOrbs[orbIdx].instanceId);
          sfx.playClick();
        }
      } else if ((e.key === 'x' || e.key === 'X') && selectedOrbIds.length === 3) {
        sfx.playOrbTriple();
        sendAction({
          type: 'ELIMINATE_3_ORBS',
          playerId: resolvedMyUserId,
          orbCardInstanceIds: [selectedOrbIds[0], selectedOrbIds[1], selectedOrbIds[2]],
        });
        clearOrbSelection();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
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

  const activePendingChoice = gameState.currentPendingChoice || pendingChoice;

  // 长按任意卡牌检视大图
  const handleCardLongPress = (card: any) => {
    if (!card) return;
    setInspectedCard(card);
    setIsDetailModalOpen(true);
  };

  // 打开墓地弹窗
  const openGraveyardModal = (cards: CardInstance[], title: string) => {
    setGraveyardCards(cards);
    setGraveyardTitle(title);
    setIsGraveyardOpen(true);
  };

  // 点击卡位逻辑 (出牌或选目标)
  const handleSlotClick = (slotIndex: number) => {
    if (selectedHandCardId) {
      const handCard = myHandCards.find((c) => c.instanceId === selectedHandCardId);
      const def = handCard ? findCardByNumberOrId(handCard.cardNumber || handCard.cardId) : null;
      const targetSlot = mySlots.find((s) => s.slotIndex === slotIndex);
      const existingRoleId = targetSlot?.roleCardId;

      sfx.playCardPlay();

      if (existingRoleId && def?.rulesText?.includes('升变')) {
        // 卡位已有角色且所选卡牌具备升变能力 -> 触发升变出场
        sendAction({
          type: 'PLAY_CARD',
          playerId: resolvedMyUserId,
          cardInstanceId: selectedHandCardId,
          isAscension: true,
          targetAscensionCardId: existingRoleId,
        });
      } else if (existingRoleId && def?.cardType === CardType.EQUIPMENT) {
        sendAction({
          type: 'PLAY_CARD',
          playerId: resolvedMyUserId,
          cardInstanceId: selectedHandCardId,
          targetEquipRoleId: existingRoleId,
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
    const existingRoleId = targetSlot?.roleCardId;

    sfx.playCardPlay();

    if (existingRoleId && def?.rulesText?.includes('升变')) {
      // 拖拽至已有角色卡位 -> 升变出场
      sendAction({
        type: 'PLAY_CARD',
        playerId: resolvedMyUserId,
        cardInstanceId,
        isAscension: true,
        targetAscensionCardId: existingRoleId,
      });
    } else if (existingRoleId && def?.cardType === CardType.EQUIPMENT) {
      sendAction({
        type: 'PLAY_CARD',
        playerId: resolvedMyUserId,
        cardInstanceId,
        targetEquipRoleId: existingRoleId,
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

  // 点击角色卡逻辑
  const handleRoleClick = (cardId: string) => {
    if (!gameState) return;
    const card = gameState.publicCards[cardId];
    if (!card) return;

    setInspectedCard(card);
    sfx.playClick();

    if (card.controllerPlayerId === resolvedMyUserId) {
      if (selectedHandCardId) {
        const handCard = myHandCards.find((c) => c.instanceId === selectedHandCardId);
        const def = handCard ? findCardByNumberOrId(handCard.cardNumber || handCard.cardId) : null;

        if (def?.cardType === CardType.EQUIPMENT) {
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
        } else if (def?.rulesText?.includes('升变')) {
          sfx.playCardPlay();
          sendAction({
            type: 'PLAY_CARD',
            playerId: resolvedMyUserId,
            cardInstanceId: selectedHandCardId,
            isAscension: true,
            targetAscensionCardId: cardId,
          });
          setSelectedHandCard(null);
          setSelectedBattlefieldCardId(null);
        } else {
          setSelectedHandCard(null);
          setSelectedBattlefieldCardId((prev) => (prev === cardId ? null : cardId));
        }
      }
    } else {
      // 点击对手角色卡：宣告攻击
      if (isMyTurn && gameState.phase === 'MAIN_PHASE') {
        if (selectedBattlefieldCardId) {
          const attacker = gameState.publicCards[selectedBattlefieldCardId];
          if (attacker && attacker.controllerPlayerId === resolvedMyUserId && attacker.isReady) {
            triggerAttackAnimation(selectedBattlefieldCardId, cardId, 'CHARACTER', 'UP');
            sendAction({
              type: 'DECLARE_ATTACK',
              playerId: resolvedMyUserId,
              attackerCardId: selectedBattlefieldCardId,
              targetType: 'CHARACTER',
              targetCardId: cardId,
            });
            setSelectedBattlefieldCardId(null);
          }
        }
      }
    }
  };


  // 发动角色卡【起】动能力 (8.1.1.c)
  const handleActivateAbility = (cardId: string) => {
    sfx.playClick();
    sendAction({
      type: 'ACTIVATE_ABILITY',
      playerId: resolvedMyUserId,
      sourceCardId: cardId,
      abilityIndex: 0,
    });
    setSelectedBattlefieldCardId(null);
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

    if (def.cardType === CardType.TACTICS) {
      handlePlayTactics(card.instanceId);
    } else if (def.cardType === CardType.EQUIPMENT) {
      handlePlayEquipment(card.instanceId);
    } else if (def.cardType === CardType.ROLE) {
      // 寻找第一个可用空卡位
      const emptySlot = mySlots.find((s) => !s.roleCardId);
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

  // 双击战场角色快速宣告攻击
  const handleBattlefieldRoleDoubleClick = (cardId: string) => {
    const card = gameState.publicCards[cardId];
    if (
      card &&
      card.controllerPlayerId === resolvedMyUserId &&
      card.isReady &&
      isMyTurn &&
      gameState.phase === 'MAIN_PHASE'
    ) {
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

  // 计算手牌卡牌的实际使用费用 (含动态费用修改器与 ST03-011 等静态减费)
  const getCardEffectiveCost = (card: CardInstance): number => {
    const def = findCardByNumberOrId(card.cardNumber || card.cardId);
    if (!def) return 0;
    const baseCost = def.cost ?? 0;
    let discount = 0;

    // 1. 动态费用修改器
    if (myPlayerState.costModifiers && myPlayerState.costModifiers.length > 0) {
      for (const mod of myPlayerState.costModifiers) {
        if (mod.cardType && mod.cardType !== def.cardType) continue;
        if (mod.targetTrait) {
          const matchTrait = def.traits?.some((t) => t.includes(mod.targetTrait!));
          const matchName = def.name.includes(mod.targetTrait);
          if (!matchTrait && !matchName) continue;
        }
        if (mod.targetName && !def.name.includes(mod.targetName)) continue;
        discount += mod.amount;
      }
    }

    // 2. 静态减费能力 (ST03-011 三头犬出击: 我方战场每有1张<三头犬小队>角色，手牌的该牌费用-1)
    if (
      def.cardNumber === 'ST03-011' ||
      def.rulesText?.includes('我方战场每有1张<三头犬小队>角色，手牌的该牌的费用-1')
    ) {
      const cerberusCount = mySlots.filter((s) => {
        if (!s.roleCardId) return false;
        const rCard = gameState.publicCards[s.roleCardId];
        if (!rCard) return false;
        const rDef = findCardByNumberOrId(rCard.cardNumber || rCard.cardId);
        if (!rDef || rDef.cardType !== CardType.ROLE) return false;
        return (
          rDef.traits?.some((t) => t.includes('三头犬小队')) ||
          rDef.name.includes('三头犬小队')
        );
      }).length;
      discount += cerberusCount;
    }

    return Math.max(0, baseCost - discount);
  };

  const selectedHandCard = myHandCards.find((c) => c.instanceId === selectedHandCardId);
  const selectedHandCardDef = selectedHandCard
    ? findCardByNumberOrId(selectedHandCard.cardNumber || selectedHandCard.cardId)
    : null;

  // 当前浮动卡牌预览以 hoveredCard 优先，其次为 inspectedCard
  const activePreviewCard = hoveredCard || inspectedCard;


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
          className="absolute top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 bg-crimson-500 text-fg text-caption font-medium flex items-center gap-2 shadow-overlay border border-fg/20 clip-corner-sm animate-in fade-in slide-in-from-top-2 duration-fast"
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

          {/* 中央阶段标签 */}
          <div className="flex items-center gap-2">
            <span
              className={`px-3 py-0.5 text-caption font-semibold flex items-center gap-1.5 border ${
                isMyTurn
                  ? 'bg-teal-400/15 text-teal-400 border-teal-400/60'
                  : 'bg-ink-850 text-fg-muted border-line'
              }`}
            >
              <Clock className="w-3.5 h-3.5" />
              <span>{isMyTurn ? '我方行动阶段' : '对手行动中'}</span>
            </span>

            {timing?.canPass && (
              <button
                type="button"
                onClick={handlePassTiming}
                className="pgr-sweep hidden md:flex items-center gap-1 px-2.5 py-0.5 clip-corner-sm bg-teal-400/15 hover:bg-teal-400/25 border border-teal-400/60 text-teal-400 text-hud font-semibold transition-colors cursor-pointer active:scale-95"
                title="推进阶段或让渡时点 (快捷键: Space)"
              >
                <span>{timing.passLabel} [Space]</span>
                <ChevronRight className="w-3 h-3" />
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
              if (selectedBattlefieldCardId && isMyTurn && gameState.phase === 'MAIN_PHASE') {
                handleAttackClick(selectedBattlefieldCardId);
              }
            }}
            className={`w-44 lg:w-48 flex-shrink-0 transition-all duration-fast ${
              selectedBattlefieldCardId && isMyTurn && gameState.phase === 'MAIN_PHASE'
                ? 'cursor-crosshair ring-1 ring-crimson-500 shadow-glow-crimson'
                : ''
            }`}
            title={selectedBattlefieldCardId ? '点击选定攻击敌方玩家' : undefined}
          >
            <ErosionBar current={opponentPlayerState.erosionCount} playerName="对手" isOpponent compact={true} />
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
            onRoleClick={handleRoleClick}
            onRoleDoubleClick={handleBattlefieldRoleDoubleClick}
            onRoleContextMenu={handleOpenContextMenu}
            onRoleLongPress={handleCardLongPress}
            onRoleHover={setHoveredCard}
            onSlotClick={handleSlotClick}
            onActivateAbility={handleActivateAbility}
            onAttackClick={handleAttackClick}
            onBlockClick={handleBlockClick}
            onPassTiming={handlePassTiming}
            onDropCardToSlot={handleDropCardToSlot}
            onDropAttackTarget={handleDropAttackTarget}
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
            <div className="w-44 lg:w-48 flex-shrink-0">
              <ErosionBar current={myPlayerState.erosionCount} playerName="我方" compact={true} />
            </div>

            <div className="flex-1 max-w-xl mx-auto">
              <SignalOrbQueueView
                orbs={myOrbs}
                selectedOrbIds={selectedOrbIds}
                compact={true}
                onToggleSelectOrb={toggleOrbSelection}
                onEliminate={(orbIds) => {
                  sfx.playOrbTriple();
                  sendAction({
                    type: 'ELIMINATE_3_ORBS',
                    playerId: resolvedMyUserId,
                    orbCardInstanceIds: orbIds,
                  });
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
                    const effCost = getCardEffectiveCost(selectedHandCard);
                    const costText = effCost < selectedHandCardDef.cost ? `${effCost} (原${selectedHandCardDef.cost})` : `${effCost}`;
                    return ` (${formatCardType(selectedHandCardDef.cardType, selectedHandCardDef.isInstant)} · 费用 ${costText})`;
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

                {selectedHandCardDef?.rulesText?.includes('升变') && (
                  <button
                    type="button"
                    onClick={() => {
                      const targetRole = mySlots
                        .map((s) => (s.roleCardId ? gameState?.publicCards[s.roleCardId] : null))
                        .filter(Boolean)
                        .find((r) => {
                          const rDef = r ? findCardByNumberOrId(r.cardNumber || r.cardId) : null;
                          return (
                            (selectedHandCardDef.name.includes('露西亚') && rDef?.name.includes('露西亚')) ||
                            (rDef?.cost ?? 0) <= 5
                          );
                        });
                      if (targetRole) {
                        sfx.playCardPlay();
                        sendAction({
                          type: 'PLAY_CARD',
                          playerId: resolvedMyUserId,
                          cardInstanceId: selectedHandCard.instanceId,
                          isAscension: true,
                          targetAscensionCardId: targetRole.instanceId,
                        });
                        setSelectedHandCard(null);
                      }
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
                            const emptySlot = mySlots.find((s) => !s.roleCardId);
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
                      isDraggable={true}
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
            className="fixed inset-0 bg-ink-950/75 backdrop-blur-xs lg:hidden"
            onClick={() => setIsHudOpen(false)}
          />
          <aside className="relative z-10 w-[85vw] max-w-sm lg:w-[340px] h-full border-l border-line-strong bg-ink-900/98 flex flex-col justify-between p-3.5 backdrop-blur-md overflow-y-auto flex-shrink-0 animate-in slide-in-from-right duration-fast">
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
                  card={inspectedCard}
                  onOpenModal={() => setIsDetailModalOpen(true)}
                  customAction={(() => {
                    if (
                      !inspectedCard ||
                      inspectedCard.controllerPlayerId !== resolvedMyUserId ||
                      inspectedCard.zone !== 'BATTLEFIELD'
                    ) {
                      return undefined;
                    }
                    const inspectedDef = findCardByNumberOrId(
                      inspectedCard.cardNumber || inspectedCard.cardId
                    );
                    const hasAbility = !!(
                      inspectedDef?.rulesText?.includes('【起】') ||
                      inspectedDef?.rulesText?.includes('起动')
                    );
                    const canActivate = isMyTurn && gameState.phase === 'MAIN_PHASE' && hasAbility;
                    const hasRush = Boolean(
                      inspectedDef?.rulesText?.includes('速攻') ||
                      inspectedCard.grantedKeywords?.includes('速攻')
                    );
                    const canAttack =
                      isMyTurn &&
                      gameState.phase === 'MAIN_PHASE' &&
                      !!inspectedCard.isReady &&
                      (inspectedCard.turnEnteredZone < gameState.turnNumber || hasRush);

                    if (!canActivate && !canAttack) return undefined;

                    return (
                      <div className="flex items-center gap-1.5">
                        {canActivate && (
                          <button
                            type="button"
                            onClick={() => {
                              handleActivateAbility(inspectedCard.instanceId);
                              setSelectedBattlefieldCardId(null);
                            }}
                            className="px-2 py-0.5 clip-corner-sm bg-gold-300 hover:bg-gold-300/90 text-ink-950 font-semibold text-hud flex items-center gap-1 cursor-pointer transition-colors"
                            title="点击发动角色的【起】动能力"
                          >
                            <Zap className="w-3 h-3 fill-current" />
                            <span>发动【起】</span>
                          </button>
                        )}
                        {canAttack && (
                          <button
                            type="button"
                            onClick={() => {
                              handleAttackClick(inspectedCard.instanceId);
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
                      <div key={index} className="border-b border-line/50 pb-1 font-sans">
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
      {contextMenu && (
        <CardContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          card={contextMenu.card}
          isMyTurn={isMyTurn}
          phase={gameState.phase}
          myAvailableCost={myPlayerState.availableOpenCostCount + myPlayerState.hiddenCostCount}
          canUseInstant={!!timing?.hasInstantPriority}
          effectiveCost={contextMenu.card.zone === 'HAND' ? getCardEffectiveCost(contextMenu.card) : undefined}
          isFriendlyRole={
            contextMenu.card.controllerPlayerId === resolvedMyUserId &&
            contextMenu.card.zone === 'BATTLEFIELD'
          }
          isOpponentRole={
            contextMenu.card.controllerPlayerId === opponentUserId &&
            contextMenu.card.zone === 'BATTLEFIELD'
          }
          isHandCard={
            contextMenu.card.controllerPlayerId === resolvedMyUserId &&
            contextMenu.card.zone === 'HAND'
          }
          canActivateAbility={
            isMyTurn &&
            gameState.phase === 'MAIN_PHASE' &&
            contextMenu.card.controllerPlayerId === resolvedMyUserId &&
            contextMenu.card.zone === 'BATTLEFIELD'
          }
          canAttack={
            isMyTurn &&
            gameState.phase === 'MAIN_PHASE' &&
            contextMenu.card.controllerPlayerId === resolvedMyUserId &&
            contextMenu.card.zone === 'BATTLEFIELD' &&
            !!contextMenu.card.isReady &&
            (contextMenu.card.turnEnteredZone < gameState.turnNumber ||
              Boolean(
                findCardByNumberOrId(contextMenu.card.cardNumber || contextMenu.card.cardId)?.rulesText?.includes('速攻') ||
                contextMenu.card.grantedKeywords?.includes('速攻')
              ))
          }
          canBlock={
            !!timing?.canDeclareBlock &&
            contextMenu.card.controllerPlayerId === resolvedMyUserId &&
            contextMenu.card.zone === 'BATTLEFIELD' &&
            !!contextMenu.card.isReady
          }
          hasEmptySlot={mySlots.some((s) => !s.roleCardId)}
          hasSelectedAttacker={!!selectedBattlefieldCardId}
          onPlayCard={(card) => {
            const def = findCardByNumberOrId(card.cardNumber || card.cardId);
            if (def?.cardType === CardType.TACTICS) {
              handlePlayTactics(card.instanceId);
            } else if (def?.cardType === CardType.EQUIPMENT) {
              handlePlayEquipment(card.instanceId);
            } else {
              const emptySlot = mySlots.find((s) => !s.roleCardId);
              if (emptySlot !== undefined) {
                handleDropCardToSlot(emptySlot.slotIndex, card.instanceId);
              }
            }
          }}
          onAscendCard={(card) => {
            const def = findCardByNumberOrId(card.cardNumber || card.cardId);
            const targetRole = mySlots
              .map((s) => (s.roleCardId ? gameState?.publicCards[s.roleCardId] : null))
              .filter(Boolean)
              .find((r) => {
                const rDef = r ? findCardByNumberOrId(r.cardNumber || r.cardId) : null;
                return (
                  (def?.name.includes('露西亚') && rDef?.name.includes('露西亚')) ||
                  (rDef?.cost ?? 0) <= 5
                );
              });
            sfx.playCardPlay();
            sendAction({
              type: 'PLAY_CARD',
              playerId: resolvedMyUserId,
              cardInstanceId: card.instanceId,
              isAscension: true,
              targetAscensionCardId: targetRole?.instanceId,
            });
          }}
          onActivateAbility={(card) => handleActivateAbility(card.instanceId)}
          onAttackPlayer={(card) => handleAttackClick(card.instanceId)}
          onAttackRole={(card) => {
            if (selectedBattlefieldCardId) {
              handleDropAttackTarget(card.instanceId, selectedBattlefieldCardId);
            }
          }}
          onBlock={(card) => handleBlockClick(card.instanceId)}
          onChargeCost={(card) => handleChargeCostFromHand(card.instanceId)}
          onInspectCard={(card) => {
            setInspectedCard(card);
            setIsDetailModalOpen(true);
          }}
          onClose={() => setContextMenu(null)}
        />
      )}

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
          choice={activePendingChoice}
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

      {/* 3. 墓地卡牌清单弹窗 */}
      <GraveyardModal
        isOpen={isGraveyardOpen}
        onClose={() => setIsGraveyardOpen(false)}
        cards={graveyardCards}
        title={graveyardTitle}
        onSelectCard={(c) => {
          setInspectedCard(c);
          setIsGraveyardOpen(false);
        }}
        onLongPress={(c) => {
          setInspectedCard(c);
          setIsDetailModalOpen(true);
        }}
      />

      {/* 4. 高清卡牌大图与完整效果检视弹窗 */}
      <CardDetailModal
        card={inspectedCard || activePreviewCard}
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
        onInspectCard={(c) => {
          setInspectedCard(c);
        }}
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

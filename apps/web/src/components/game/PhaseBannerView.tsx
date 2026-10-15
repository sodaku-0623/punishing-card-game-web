'use client';

import React, { useEffect, useState, useRef } from 'react';
import { GamePhase } from '@zhanshuang/shared';
import { sfx } from '@/lib/audio';
import { Swords, Zap, RefreshCw, Layers, ShieldAlert, Flag } from 'lucide-react';

interface PhaseBannerViewProps {
  phase: GamePhase;
  turnNumber: number;
  activePlayerId: string;
  myUserId: string;
}

interface BannerData {
  id: string;
  title: string;
  subtitle: string;
  theme: 'cyan' | 'red' | 'gold' | 'purple';
  icon: React.ReactNode;
}

export const PhaseBannerView: React.FC<PhaseBannerViewProps> = React.memo(({
  phase,
  turnNumber,
  activePlayerId,
  myUserId,
}) => {
  const [currentBanner, setCurrentBanner] = useState<BannerData | null>(null);
  const prevPhaseRef = useRef<GamePhase | null>(null);
  const prevTurnRef = useRef<number | null>(null);
  const prevActivePlayerRef = useRef<string | null>(null);
  const bannerTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    // 首次载入初始化，不触发刷屏动画
    if (prevPhaseRef.current === null && prevTurnRef.current === null) {
      prevPhaseRef.current = phase;
      prevTurnRef.current = turnNumber;
      prevActivePlayerRef.current = activePlayerId;
      return;
    }

    const isNewTurn =
      prevTurnRef.current !== turnNumber ||
      (prevActivePlayerRef.current !== activePlayerId && activePlayerId !== '');
    const isNewPhase = prevPhaseRef.current !== phase;

    let nextBanner: BannerData | null = null;

    if (isNewTurn) {
      const isMyTurn = activePlayerId === myUserId;
      nextBanner = {
        id: `turn-${turnNumber}-${activePlayerId}-${Date.now()}`,
        title: isMyTurn ? 'YOUR TURN' : "OPPONENT'S TURN",
        subtitle: isMyTurn ? '我方指挥回合 // COMMAND READY' : '对方回合 // DEFENSIVE STANCE',
        theme: isMyTurn ? 'gold' : 'purple',
        icon: isMyTurn ? <Zap className="w-12 h-12 text-terminalGold" /> : <ShieldAlert className="w-12 h-12 text-purple-400" />,
      };
    } else if (isNewPhase) {
      switch (phase) {
        case 'MULLIGAN_PHASE':
          nextBanner = {
            id: `phase-mulligan-${Date.now()}`,
            title: 'MULLIGAN PHASE',
            subtitle: '开局手牌调度 // TACTICAL RESHUFFLE',
            theme: 'cyan',
            icon: <RefreshCw className="w-12 h-12 text-terminalCyan animate-spin-slow" />,
          };
          break;
        case 'STAND_PHASE':
          nextBanner = {
            id: `phase-stand-${Date.now()}`,
            title: 'STAND PHASE',
            subtitle: '竖直重置阶段 // SYSTEMS RECHARGED',
            theme: 'cyan',
            icon: <RefreshCw className="w-12 h-12 text-terminalCyan" />,
          };
          break;
        case 'DRAW_CHARGE_PHASE':
          nextBanner = {
            id: `phase-draw-${Date.now()}`,
            title: 'DRAW & CHARGE',
            subtitle: '抽牌充能阶段 // TACTICAL DRAW',
            theme: 'gold',
            icon: <Layers className="w-12 h-12 text-terminalGold" />,
          };
          break;
        case 'MAIN_PHASE':
          nextBanner = {
            id: `phase-main-${Date.now()}`,
            title: 'MAIN PHASE',
            subtitle: '主要行动阶段 // MAIN TACTICAL PHASE',
            theme: 'cyan',
            icon: <Zap className="w-12 h-12 text-terminalCyan" />,
          };
          break;
        case 'COMBAT_ATTACK_DECLARATION':
        case 'COMBAT_FREE_TIMING':
        case 'COMBAT_CHARGE':
        case 'COMBAT_DAMAGE':
        case 'COMBAT_BATTLE':
          // 仅在首次切入战斗时触发 BATTLE PHASE 横幅
          if (
            prevPhaseRef.current !== 'COMBAT_ATTACK_DECLARATION' &&
            prevPhaseRef.current !== 'COMBAT_FREE_TIMING' &&
            prevPhaseRef.current !== 'COMBAT_CHARGE' &&
            prevPhaseRef.current !== 'COMBAT_DAMAGE' &&
            prevPhaseRef.current !== 'COMBAT_BATTLE'
          ) {
            nextBanner = {
              id: `phase-battle-${Date.now()}`,
              title: 'BATTLE PHASE',
              subtitle: '战斗阶段 // COMBAT ENGAGED',
              theme: 'red',
              icon: <Swords className="w-12 h-12 text-erosionRed" />,
            };
          }
          break;
        case 'END_PHASE':
          nextBanner = {
            id: `phase-end-${Date.now()}`,
            title: 'END PHASE',
            subtitle: '结束阶段 // TURN COMPLETED',
            theme: 'cyan',
            icon: <Flag className="w-12 h-12 text-neutral-300" />,
          };
          break;
        default:
          break;
      }
    }

    prevPhaseRef.current = phase;
    prevTurnRef.current = turnNumber;
    prevActivePlayerRef.current = activePlayerId;

    if (nextBanner) {
      if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current);
      setCurrentBanner(nextBanner);

      if (nextBanner.theme === 'red') {
        sfx.playAttack();
      } else {
        sfx.playPhaseChange();
      }

      // 横幅动画持续 1.2s，在 1.25s 后自动卸载
      bannerTimerRef.current = setTimeout(() => {
        setCurrentBanner(null);
      }, 1250);
    }

    return () => {
      if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current);
    };
  }, [phase, turnNumber, activePlayerId, myUserId]);

  if (!currentBanner) return null;

  const themeClasses = {
    cyan: 'border-terminalCyan/40 text-terminalCyan',
    red: 'border-erosionRed/60 text-erosionRed phase-banner-red',
    gold: 'border-terminalGold/50 text-terminalGold phase-banner-gold',
    purple: 'border-purple-500/50 text-purple-400',
  }[currentBanner.theme];

  const barBgClasses = {
    cyan: 'from-cyan-950/80 via-black/90 to-cyan-950/80',
    red: 'from-red-950/85 via-black/95 to-red-950/85',
    gold: 'from-amber-950/85 via-black/95 to-amber-950/85',
    purple: 'from-purple-950/85 via-black/95 to-purple-950/85',
  }[currentBanner.theme];

  return (
    <div
      key={currentBanner.id}
      className={`phase-banner ${themeClasses} flex items-center justify-center pointer-events-none select-none`}
    >
      {/* 赛博宽屏能量光束背景与切线 */}
      <div className={`relative px-16 py-4 flex items-center gap-6 bg-gradient-to-r ${barBgClasses} border-y-2 backdrop-blur-lg shadow-2xl`}>
        <div className="absolute inset-x-0 -top-1 h-0.5 bg-gradient-to-r from-transparent via-white/80 to-transparent" />
        <div className="absolute inset-x-0 -bottom-1 h-0.5 bg-gradient-to-r from-transparent via-white/80 to-transparent" />

        {/* 阶段大图标 */}
        <div className="flex-shrink-0 animate-pulse">
          {currentBanner.icon}
        </div>

        {/* 阶段名称与副标题 */}
        <div className="flex flex-col items-start tracking-wider font-mono">
          <span className="text-4xl sm:text-5xl lg:text-6xl font-black italic tracking-widest drop-shadow-md">
            {currentBanner.title}
          </span>
          <span className="text-xs sm:text-sm font-bold tracking-widest text-neutral-300 opacity-90 -mt-1 font-mono uppercase">
            {currentBanner.subtitle}
          </span>
        </div>
      </div>
    </div>
  );
});

PhaseBannerView.displayName = 'PhaseBannerView';

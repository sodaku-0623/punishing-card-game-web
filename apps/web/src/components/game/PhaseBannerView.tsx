'use client';

import React, { useEffect, useState, useRef } from 'react';
import { GamePhase } from '@zhanshuang/shared';
import { sfx } from '@/lib/audio';

interface PhaseBannerViewProps {
  phase: GamePhase;
  turnNumber: number;
  activePlayerId: string;
  myUserId: string;
}

interface BannerData {
  id: string;
  title: string;
  en: string;
  accent: 'teal' | 'crimson' | 'gold';
}

/**
 * 战双风格阶段切换横幅 (docs/design/design-spec.md 6. 对局界面)
 * 白色 text-banner，左右各一段细线和英文副标题，水平滑入 -> 停留 -> 滑出，总时长 <= 1.2s，无霓虹 text-shadow
 */
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
        title: isMyTurn ? '我方回合' : '对手回合',
        en: isMyTurn ? `TURN ${turnNumber} // YOUR TURN` : `TURN ${turnNumber} // OPPONENT TURN`,
        accent: isMyTurn ? 'teal' : 'crimson',
      };
    } else if (isNewPhase) {
      switch (phase) {
        case 'MULLIGAN_PHASE':
          nextBanner = {
            id: `phase-mulligan-${Date.now()}`,
            title: '手牌调度',
            en: 'MULLIGAN PHASE',
            accent: 'teal',
          };
          break;
        case 'STAND_PHASE':
          nextBanner = {
            id: `phase-stand-${Date.now()}`,
            title: '竖直阶段',
            en: 'STAND PHASE',
            accent: 'teal',
          };
          break;
        case 'DRAW_CHARGE_PHASE':
          nextBanner = {
            id: `phase-draw-${Date.now()}`,
            title: '抽牌充能',
            en: 'DRAW & CHARGE PHASE',
            accent: 'gold',
          };
          break;
        case 'MAIN_PHASE':
          nextBanner = {
            id: `phase-main-${Date.now()}`,
            title: '主要阶段',
            en: 'MAIN PHASE',
            accent: 'teal',
          };
          break;
        case 'COMBAT_ATTACK_DECLARATION':
        case 'COMBAT_FREE_TIMING':
        case 'COMBAT_CHARGE':
        case 'COMBAT_DAMAGE':
        case 'COMBAT_BATTLE':
          if (
            prevPhaseRef.current !== 'COMBAT_ATTACK_DECLARATION' &&
            prevPhaseRef.current !== 'COMBAT_FREE_TIMING' &&
            prevPhaseRef.current !== 'COMBAT_CHARGE' &&
            prevPhaseRef.current !== 'COMBAT_DAMAGE' &&
            prevPhaseRef.current !== 'COMBAT_BATTLE'
          ) {
            nextBanner = {
              id: `phase-battle-${Date.now()}`,
              title: '战斗阶段',
              en: 'BATTLE PHASE',
              accent: 'crimson',
            };
          }
          break;
        case 'END_PHASE':
          nextBanner = {
            id: `phase-end-${Date.now()}`,
            title: '结束阶段',
            en: 'END PHASE',
            accent: 'crimson',
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

      if (nextBanner.accent === 'crimson') {
        sfx.playAttack();
      } else {
        sfx.playPhaseChange();
      }

      bannerTimerRef.current = setTimeout(() => {
        setCurrentBanner(null);
      }, 1180);
    }

    return () => {
      if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current);
    };
  }, [phase, turnNumber, activePlayerId, myUserId]);

  if (!currentBanner) return null;

  const lineColor =
    currentBanner.accent === 'crimson'
      ? 'bg-crimson-500'
      : currentBanner.accent === 'gold'
        ? 'bg-gold-300'
        : 'bg-teal-400';

  const subColor =
    currentBanner.accent === 'crimson'
      ? 'text-crimson-400'
      : currentBanner.accent === 'gold'
        ? 'text-gold-300'
        : 'text-teal-400';

  return (
    <div
      key={currentBanner.id}
      aria-live="polite"
      className="fixed inset-x-0 top-1/2 -translate-y-1/2 z-banner pointer-events-none select-none flex justify-center"
    >
      <div className="pgr-phase-banner relative w-full max-w-3xl bg-ink-950/95 backdrop-blur-md border-y border-line-strong py-5 px-8 overflow-hidden shadow-overlay">
        {/* 一次性高速扫光线 */}
        <div
          aria-hidden="true"
          className="pgr-phase-scan pointer-events-none absolute inset-0 bg-gradient-to-r from-transparent via-fg/15 to-transparent"
        />

        <div className="relative z-10 flex flex-col items-center gap-2">
          <div className="flex items-center justify-center gap-4 w-full">
            <span aria-hidden="true" className={`h-0.5 flex-1 max-w-28 ${lineColor}`} />
            <span className="text-display sm:text-banner font-bold tracking-widest text-fg whitespace-nowrap">
              {currentBanner.title}
            </span>
            <span aria-hidden="true" className={`h-0.5 flex-1 max-w-28 ${lineColor}`} />
          </div>

          <div className="flex items-center gap-3">
            <span aria-hidden="true" className="h-px w-8 bg-line-strong" />
            <span className={`font-display text-hud uppercase font-semibold ${subColor}`}>
              {currentBanner.en}
            </span>
            <span aria-hidden="true" className="h-px w-8 bg-line-strong" />
          </div>
        </div>
      </div>
    </div>
  );
});

PhaseBannerView.displayName = 'PhaseBannerView';

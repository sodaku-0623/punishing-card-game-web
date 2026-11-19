'use client';

import React, { useEffect, useRef, useState } from 'react';
import { HudBrackets } from '@/components/ui';

interface TargetingArrowOverlayProps {
  attackerCardId: string | null;
  onTargetSelected?: (targetCardId?: string, targetType?: 'PLAYER' | 'CHARACTER') => void;
  onCancel?: () => void;
}

interface Point {
  x: number;
  y: number;
}

interface HoveredTarget {
  type: 'PLAYER' | 'CHARACTER';
  cardId?: string;
  center: Point;
}

export const TargetingArrowOverlay: React.FC<TargetingArrowOverlayProps> = ({
  attackerCardId,
  onCancel,
}) => {
  const [attackerCenter, setAttackerCenter] = useState<Point | null>(null);
  const [mousePos, setMousePos] = useState<Point | null>(null);
  const [hoveredTarget, setHoveredTarget] = useState<HoveredTarget | null>(null);
  const rafRef = useRef<number | null>(null);
  const pendingCoordsRef = useRef<Point | null>(null);

  // 监听全局鼠标移动 (使用 requestAnimationFrame 节流) 并检测合法攻击目标
  useEffect(() => {
    if (!attackerCardId) {
      setAttackerCenter(null);
      setMousePos(null);
      setHoveredTarget(null);
      return;
    }

    const measureAttacker = (): Point | null => {
      const el = document.querySelector(`[data-card-instance-id="${attackerCardId}"]`);
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      return {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      };
    };

    setAttackerCenter(measureAttacker());

    const flushFrame = () => {
      rafRef.current = null;
      const coords = pendingCoordsRef.current;
      if (!coords) return;

      setMousePos(coords);
      setAttackerCenter(measureAttacker());

      const targetElement = document.elementFromPoint(coords.x, coords.y);
      if (!targetElement) {
        setHoveredTarget(null);
        return;
      }

      // 1. 检查是否悬停在敌方角色卡上
      const oppRoleEl = targetElement.closest('[data-opponent-role-id]');
      if (oppRoleEl) {
        const cardId = oppRoleEl.getAttribute('data-opponent-role-id');
        if (cardId) {
          const rect = oppRoleEl.getBoundingClientRect();
          setHoveredTarget({
            type: 'CHARACTER',
            cardId,
            center: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
          });
          return;
        }
      }

      // 2. 检查是否悬停在敌方领袖/侵蚀区 (对手玩家)
      const oppPlayerEl = targetElement.closest('[data-opponent-player-target]');
      if (oppPlayerEl) {
        const rect = oppPlayerEl.getBoundingClientRect();
        setHoveredTarget({
          type: 'PLAYER',
          center: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
        });
        return;
      }

      setHoveredTarget(null);
    };

    const handleMouseMove = (e: MouseEvent) => {
      pendingCoordsRef.current = { x: e.clientX, y: e.clientY };
      if (rafRef.current === null) {
        rafRef.current = window.requestAnimationFrame(flushFrame);
      }
    };

    // 右键取消指示线
    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      onCancel?.();
    };

    // Esc 键快速取消
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCancel?.();
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('contextmenu', handleContextMenu);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('contextmenu', handleContextMenu);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [attackerCardId, onCancel]);

  if (!attackerCardId || !attackerCenter || !mousePos) {
    return null;
  }

  const endX = hoveredTarget ? hoveredTarget.center.x : mousePos.x;
  const endY = hoveredTarget ? hoveredTarget.center.y : mousePos.y;
  const startX = attackerCenter.x;
  const startY = attackerCenter.y;

  const dx = endX - startX;
  const dy = endY - startY;
  const distance = Math.hypot(dx, dy);

  const curvature = Math.min(Math.max(distance * 0.25, 40), 160);
  const cp1X = startX + dx * 0.25;
  const cp1Y = startY + dy * 0.25 - curvature;
  const cp2X = startX + dx * 0.75;
  const cp2Y = startY + dy * 0.75 - curvature;

  const pathD = `M ${startX} ${startY} C ${cp1X} ${cp1Y}, ${cp2X} ${cp2Y}, ${endX} ${endY}`;

  const angleRad = Math.atan2(endY - cp2Y, endX - cp2X);
  const angleDeg = (angleRad * 180) / Math.PI;

  const isLocked = !!hoveredTarget;

  return (
    <div
      className="fixed inset-0 pointer-events-none z-50 overflow-hidden"
      style={{ width: '100vw', height: '100vh' }}
    >
      <svg className="w-full h-full">
        <defs>
          <filter id="pgr-glow-crimson" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

          <linearGradient id="pgr-laser-gradient" x1="0%" y1="100%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#ED1212" stopOpacity="0.45" />
            <stop offset="55%" stopColor="#FF4D4D" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#FFFFFF" stopOpacity="1" />
          </linearGradient>
        </defs>

        {/* 底层赤红弹道 */}
        <path
          d={pathD}
          fill="none"
          stroke={isLocked ? '#ED1212' : '#FF4D4D'}
          strokeWidth={isLocked ? 7 : 5}
          strokeOpacity={isLocked ? 0.55 : 0.3}
          strokeLinecap="square"
          filter="url(#pgr-glow-crimson)"
        />

        {/* 核心流光虚线 */}
        <path
          d={pathD}
          fill="none"
          stroke="url(#pgr-laser-gradient)"
          strokeWidth={isLocked ? 3.5 : 2.5}
          strokeLinecap="square"
          strokeDasharray={isLocked ? '8, 4' : '10, 5'}
          className="targeting-arrow-pulse"
        />

        {/* 起始锚点 */}
        <rect
          x={startX - 5}
          y={startY - 5}
          width="10"
          height="10"
          fill="#ED1212"
          fillOpacity="0.35"
          stroke="#FFFFFF"
          strokeWidth="1.5"
          transform={`rotate(45 ${startX} ${startY})`}
        />
        <circle cx={startX} cy={startY} r="2.5" fill="#FFFFFF" />

        {/* 终点尖锐箭头 */}
        <g transform={`translate(${endX}, ${endY}) rotate(${angleDeg})`}>
          <path
            d="M -18 -9 L 0 0 L -18 9 L -12 0 Z"
            fill={isLocked ? '#FFFFFF' : '#ED1212'}
            stroke="#ED1212"
            strokeWidth="1.5"
            filter="url(#pgr-glow-crimson)"
          />
        </g>
      </svg>

      {/* 目标锁定方框准星 */}
      {isLocked && (
        <div
          className="fixed -translate-x-1/2 -translate-y-1/2 pointer-events-none flex flex-col items-center gap-1.5 z-50"
          style={{ left: endX, top: endY }}
        >
          <div className="relative w-20 h-20 sm:w-24 sm:h-24 flex items-center justify-center">
            <HudBrackets size="md" color="crimson" />
            <div className="absolute inset-3 border border-crimson-500/70 rotate-45" />
            <div className="w-2 h-2 bg-crimson-500 shadow-glow-crimson" />
          </div>

          <div className="px-2.5 py-0.5 clip-corner-sm bg-ink-950/95 border border-crimson-500 text-crimson-400 font-sans text-hud font-semibold uppercase tracking-wider">
            {hoveredTarget.type === 'PLAYER' ? '锁定 · 对手玩家（点击攻击）' : '锁定 · 目标角色（点击攻击）'}
          </div>
        </div>
      )}
    </div>
  );
};

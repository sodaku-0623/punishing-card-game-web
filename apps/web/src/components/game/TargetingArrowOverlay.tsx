'use client';

import React, { useEffect, useState, useMemo } from 'react';

interface TargetingArrowOverlayProps {
  attackerCardId: string | null;
  onTargetSelected?: (targetCardId?: string, targetType?: 'PLAYER' | 'CHARACTER') => void;
  onCancel?: () => void;
}

export const TargetingArrowOverlay: React.FC<TargetingArrowOverlayProps> = ({
  attackerCardId,
  onTargetSelected,
  onCancel,
}) => {
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null);
  const [hoveredTarget, setHoveredTarget] = useState<{
    type: 'PLAYER' | 'CHARACTER';
    cardId?: string;
    center: { x: number; y: number };
  } | null>(null);

  // 获取发起攻击的角色卡中心坐标
  const attackerCenter = useMemo(() => {
    if (!attackerCardId || typeof window === 'undefined') return null;
    const el = document.querySelector(`[data-card-instance-id="${attackerCardId}"]`);
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
  }, [attackerCardId, mousePos]); // mousePos 变动时也可轻量更新以防窗口微调

  // 监听全局鼠标移动，并检测是否悬停在合法攻击目标上
  useEffect(() => {
    if (!attackerCardId) {
      setMousePos(null);
      setHoveredTarget(null);
      return;
    }

    const handleMouseMove = (e: MouseEvent) => {
      setMousePos({ x: e.clientX, y: e.clientY });

      // 寻找鼠标下方的目标元素
      const targetElement = document.elementFromPoint(e.clientX, e.clientY);
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

    // 右键极速取消指示线 (YGOPro 核心习惯)
    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      onCancel?.();
    };

    // 按 Esc 键快速取消
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCancel?.();
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('contextmenu', handleContextMenu);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('contextmenu', handleContextMenu);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [attackerCardId, onCancel]);

  if (!attackerCardId || !attackerCenter || !mousePos) {
    return null;
  }

  // 终点坐标：若有吸附锁定目标，吸附到目标中心；否则跟随鼠标
  const endX = hoveredTarget ? hoveredTarget.center.x : mousePos.x;
  const endY = hoveredTarget ? hoveredTarget.center.y : mousePos.y;

  const startX = attackerCenter.x;
  const startY = attackerCenter.y;

  // 三次贝塞尔曲线控制点计算
  const dx = endX - startX;
  const dy = endY - startY;
  const distance = Math.hypot(dx, dy);

  // 控制点偏置 (向上凸起或弧线)，营造类似炉石/YGOPro2 的弧度弹道
  const curvature = Math.min(Math.max(distance * 0.25, 40), 160);
  const cp1X = startX + dx * 0.25;
  const cp1Y = startY + dy * 0.25 - curvature;
  const cp2X = startX + dx * 0.75;
  const cp2Y = startY + dy * 0.75 - curvature;

  const pathD = `M ${startX} ${startY} C ${cp1X} ${cp1Y}, ${cp2X} ${cp2Y}, ${endX} ${endY}`;

  // 计算终点切线角度用于旋转箭头
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
          {/* 红色发光滤镜 */}
          <filter id="glow-red" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="3.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

          {/* 箭头阴影与微光 */}
          <linearGradient id="laser-gradient" x1="0%" y1="100%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#ff2a5f" stopOpacity="0.4" />
            <stop offset="50%" stopColor="#ff0055" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="1" />
          </linearGradient>
        </defs>

        {/* 底层光晕路径 */}
        <path
          d={pathD}
          fill="none"
          stroke={isLocked ? '#ff0033' : '#ff2a5f'}
          strokeWidth={isLocked ? 9 : 6}
          strokeOpacity={isLocked ? 0.6 : 0.35}
          strokeLinecap="round"
          filter="url(#glow-red)"
        />

        {/* 核心能量光线 (流光虚线动画) */}
        <path
          d={pathD}
          fill="none"
          stroke="url(#laser-gradient)"
          strokeWidth={isLocked ? 4.5 : 3.5}
          strokeLinecap="round"
          strokeDasharray={isLocked ? '8, 4' : '10, 5'}
          className="targeting-arrow-pulse"
        />

        {/* 起始点聚焦微光环 */}
        <circle
          cx={startX}
          cy={startY}
          r="8"
          fill="#ff2a5f"
          fillOpacity="0.3"
          stroke="#ffffff"
          strokeWidth="2"
        />
        <circle cx={startX} cy={startY} r="3" fill="#ffffff" />

        {/* 终点箭头 */}
        <g
          transform={`translate(${endX}, ${endY}) rotate(${angleDeg})`}
          className={isLocked ? 'scale-125 transition-transform' : ''}
        >
          <path
            d="M -18 -10 L 0 0 L -18 10 L -12 0 Z"
            fill={isLocked ? '#ffffff' : '#ff0055'}
            stroke="#ff2a5f"
            strokeWidth="1.5"
            filter="url(#glow-red)"
          />
        </g>
      </svg>

      {/* 终点全息目标锁定环 (当吸附至合法目标时展开) */}
      {isLocked && (
        <div
          className="fixed -translate-x-1/2 -translate-y-1/2 pointer-events-none flex flex-col items-center gap-1 z-50 animate-pulse"
          style={{ left: endX, top: endY }}
        >
          <div className="relative w-20 h-20 sm:w-24 sm:h-24 flex items-center justify-center">
            {/* 旋转准星 */}
            <div className="absolute inset-0 rounded-full border-2 border-dashed border-red-500 animate-spin [animation-duration:4s]" />
            <div className="absolute inset-2 rounded-full border border-white/60 animate-ping [animation-duration:2s]" />

            {/* 四角准星标记 */}
            <div className="absolute -top-1 w-2 h-2 border-t-2 border-l-2 border-red-400" />
            <div className="absolute -top-1 right-0 w-2 h-2 border-t-2 border-r-2 border-red-400" />
            <div className="absolute -bottom-1 left-0 w-2 h-2 border-b-2 border-l-2 border-red-400" />
            <div className="absolute -bottom-1 -right-1 w-2 h-2 border-b-2 border-r-2 border-red-400" />

            {/* 中心红点 */}
            <div className="w-2.5 h-2.5 rounded-full bg-red-500 shadow-[0_0_12px_#ff0033]" />
          </div>

          <div className="px-2 py-0.5 rounded bg-black/90 border border-red-500 text-red-300 font-mono text-[10px] font-bold shadow-lg uppercase tracking-wider">
            {hoveredTarget.type === 'PLAYER' ? '⚔️ 锁定: 对手玩家 (点击攻击)' : '⚔️ 锁定: 目标角色 (点击攻击)'}
          </div>
        </div>
      )}
    </div>
  );
};

'use client';

import React, { useState } from 'react';
import { CardInstance } from '@zhanshuang/shared';
import { CardView } from './CardView';
import { Shield, Zap, Swords, Layers, Crosshair } from 'lucide-react';
import { sfx } from '@/lib/audio';

interface BattlefieldSlotViewProps {
  slotIndex: number;
  roleCard?: CardInstance;
  isOpponent?: boolean;
  isSelected?: boolean;
  isPlayTargetable?: boolean;
  canActivateAbility?: boolean;
  canAttack?: boolean;
  canBlock?: boolean;
  hasAbility?: boolean;
  isLegalAttackTarget?: boolean;
  isAttacking?: boolean;
  attackDirection?: 'UP' | 'DOWN';
  isHit?: boolean;
  customClassName?: string;
  onSlotClick?: (slotIndex: number) => void;
  onRoleClick?: (cardId: string) => void;
  onRoleDoubleClick?: (cardId: string) => void;
  onRoleContextMenu?: (e: React.MouseEvent, card: CardInstance) => void;
  onRoleLongPress?: (card: CardInstance) => void;
  onRoleHover?: (card: CardInstance | null) => void;
  onActivateAbility?: (cardId: string) => void;
  onAttackClick?: (cardId: string) => void;
  onBlockClick?: (cardId: string) => void;
  onDropCard?: (slotIndex: number, cardInstanceId: string) => void;
  onDropAttackTarget?: (targetCardId: string, attackerCardId: string) => void;
}

export const BattlefieldSlotView: React.FC<BattlefieldSlotViewProps> = React.memo(({
  slotIndex,
  roleCard,
  isOpponent = false,
  isSelected = false,
  isPlayTargetable = false,
  canActivateAbility = false,
  canAttack = false,
  canBlock = false,
  hasAbility = false,
  isLegalAttackTarget = false,
  isAttacking = false,
  attackDirection = 'UP',
  isHit = false,
  customClassName = '',
  onSlotClick,
  onRoleClick,
  onRoleDoubleClick,
  onRoleContextMenu,
  onRoleLongPress,
  onRoleHover,
  onActivateAbility,
  onAttackClick,
  onBlockClick,
  onDropCard,
  onDropAttackTarget,
}) => {
  const [isDragOver, setIsDragOver] = useState(false);

  // HTML5 Drag & Drop: 拖拽到卡位释放
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (!isDragOver) setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const cardInstanceId = e.dataTransfer.getData('text/card-instance-id');
    const attackerInstanceId = e.dataTransfer.getData('text/attacker-instance-id');

    if (attackerInstanceId && roleCard && isOpponent) {
      // 攻击方拖拽至敌方角色进行定点进攻 (7.2.1.b.1)
      sfx.playAttack();
      onDropAttackTarget?.(roleCard.instanceId, attackerInstanceId);
    } else if (cardInstanceId && !isOpponent) {
      // 手牌拖拽至己方卡位 (空闲卡位普通出牌 或 目标角色卡位升变/装备)
      sfx.playCardPlay();
      onDropCard?.(slotIndex, cardInstanceId);
    }
  };

  // 攻击方拖拽开始
  const handleAttackerDragStart = (e: React.DragEvent) => {
    if (!roleCard || isOpponent || !canAttack) return;
    e.dataTransfer.setData('text/attacker-instance-id', roleCard.instanceId);
    e.dataTransfer.effectAllowed = 'move';
    sfx.playClick();
  };

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={() => {
        if (roleCard && onRoleClick) {
          onRoleClick(roleCard.instanceId);
        } else if (onSlotClick) {
          onSlotClick(slotIndex);
        }
      }}
      onDoubleClick={() => {
        if (roleCard && onRoleDoubleClick) {
          onRoleDoubleClick(roleCard.instanceId);
        }
      }}
      onContextMenu={(e) => {
        if (roleCard && onRoleContextMenu) {
          e.preventDefault();
          onRoleContextMenu(e, roleCard);
        }
      }}
      onMouseEnter={() => {
        if (roleCard) {
          sfx.playHover();
          onRoleHover?.(roleCard);
        }
      }}
      onMouseLeave={() => {
        if (roleCard) {
          onRoleHover?.(null);
        }
      }}
      data-slot-index={slotIndex}
      data-is-opponent={isOpponent ? 'true' : 'false'}
      className={`relative ${
        customClassName || 'w-full h-full'
      } rounded-xl border flex flex-col items-center justify-center transition-all duration-150 select-none group card-interactive ${
        isAttacking
          ? attackDirection === 'DOWN'
            ? 'animate-attack-down z-50'
            : 'animate-attack-up z-50'
          : isHit
          ? 'animate-target-hit z-40'
          : ''
      } ${
        isDragOver
          ? 'drag-valid-slot'
          : isLegalAttackTarget
          ? 'border-erosionRed/90 bg-erosionRed/20 terminal-glow-red animate-pulse ring-2 ring-erosionRed cursor-crosshair'
          : isPlayTargetable
          ? 'border-terminalCyan/80 bg-terminalCyan/15 cursor-pointer animate-pulse terminal-glow-cyan'
          : isSelected
          ? 'border-cyan-400/50 bg-cyan-500/10 cursor-pointer'
          : canAttack
          ? 'border-erosionRed/60 hover:border-erosionRed shadow-[0_0_12px_rgba(255,42,95,0.4)]'
          : 'border-terminalBorder/40 bg-surface/15 hover:border-terminalBorder hover:bg-surface/30 backdrop-blur-[1px]'
      }`}
    >
      {/* 科技角标 */}
      <span className="corner-tl">┌</span>
      <span className="corner-tr">┐</span>
      <span className="corner-bl">└</span>
      <span className="corner-br">┘</span>

      {/* 角色卡实体 */}
      {roleCard ? (
        <div
          data-card-instance-id={roleCard.instanceId}
          {...(isOpponent ? { 'data-opponent-role-id': roleCard.instanceId } : {})}
          draggable={!isOpponent && canAttack}
          onDragStart={handleAttackerDragStart}
          className="relative w-full h-full flex items-center justify-center"
        >
          <CardView
            card={roleCard}
            isSelected={isSelected}
            isTargetable={isLegalAttackTarget}
            isRested={!roleCard.isReady || isAttacking}
            size="full"
            onLongPress={roleCard && onRoleLongPress ? () => onRoleLongPress(roleCard) : undefined}
          />

          {/* 横置状态水平正向指示牌 (绝对水平正向，不随卡面旋转倾倒，方便玩家直观阅读) */}
          {(!roleCard.isReady || isAttacking) && (
            <div className="absolute top-1 left-1 z-30 px-1.5 py-0.5 rounded bg-black/95 text-terminalGold text-[10px] font-mono font-black border border-terminalGold/70 shadow-[0_0_8px_rgba(255,183,3,0.6)] select-none pointer-events-none tracking-wider">
              横置
            </div>
          )}

          {/* 升变垫牌层数指示 */}
          {roleCard.underneathCardIds && roleCard.underneathCardIds.length > 0 && (
            <div
              className="absolute top-1 right-1 bg-black/85 border border-purple-500/70 text-purple-300 text-[9px] px-1 py-0.2 rounded flex items-center gap-0.5 shadow z-20 font-mono"
              title={`升变底牌: ${roleCard.underneathCardIds.length} 张`}
            >
              <Layers className="w-2.5 h-2.5" />
              <span>+{roleCard.underneathCardIds.length}</span>
            </div>
          )}

          {/* 附着装备指示 */}
          {roleCard.attachedEquipmentId && (
            <div className="absolute -bottom-2 -right-1 bg-neutral-900 border border-terminalGold/70 text-terminalGold text-[9px] px-1 py-0.5 rounded flex items-center gap-0.5 shadow z-20 font-mono">
              <Shield className="w-2.5 h-2.5" />
              <span>装备</span>
            </div>
          )}

          {/* 敌方角色：可攻击目标瞄准光标指示 */}
          {isOpponent && isLegalAttackTarget && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-30">
              <Crosshair className="w-8 h-8 text-erosionRed animate-spin" />
            </div>
          )}

          {/* 角色卡行动按钮 (发动【起】效果 / 宣告攻击 / 宣告阻挡) - 只要满足条件即常驻清晰展示，并向下延伸触控桥，彻底解决鼠标移向按键时按键消失的问题 */}
          {!isOpponent && (canActivateAbility || canAttack || canBlock) && (
            <div
              className={`absolute -top-8.5 inset-x-0 pb-3 flex items-center justify-center gap-1.5 z-40 transition-all duration-150 pointer-events-auto ${
                isSelected ? 'scale-105' : 'hover:scale-105'
              }`}
            >
              {canActivateAbility && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    sfx.playClick();
                    onActivateAbility?.(roleCard.instanceId);
                  }}
                  className="px-2.5 py-1 rounded-md bg-gradient-to-r from-amber-400 to-yellow-500 text-neutral-950 text-[11px] font-black font-mono shadow-[0_0_15px_rgba(250,204,21,0.7)] hover:scale-110 active:scale-95 flex items-center gap-1 hover:brightness-110 border border-amber-200 cursor-pointer transition-all"
                  title="发动卡牌【起】动能力"
                >
                  <Zap className="w-3.5 h-3.5 fill-current" />
                  <span>发动效果</span>
                </button>
              )}

              {canAttack && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    sfx.playAttack();
                    onAttackClick?.(roleCard.instanceId);
                  }}
                  className="px-2.5 py-1 rounded-md bg-gradient-to-r from-red-600 to-rose-600 text-white text-[11px] font-black font-mono shadow-[0_0_15px_rgba(255,50,50,0.7)] hover:scale-110 active:scale-95 flex items-center gap-1 hover:brightness-110 border border-white/60 cursor-pointer transition-all animate-pulse"
                  title="宣告攻击对方玩家 (或拖拽至敌方角色)"
                >
                  <Swords className="w-3.5 h-3.5" />
                  <span>攻击</span>
                </button>
              )}

              {canBlock && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    sfx.playClick();
                    onBlockClick?.(roleCard.instanceId);
                  }}
                  className="px-2.5 py-1 rounded-md bg-gradient-to-r from-cyan-400 to-cyan-500 text-neutral-950 text-[11px] font-black font-mono shadow-[0_0_18px_rgba(0,240,255,0.85)] hover:scale-110 active:scale-95 flex items-center gap-1 hover:brightness-110 border border-white/60 animate-bounce cursor-pointer transition-all font-black"
                  title="宣告该角色进行阻挡 (7.3.1.c)"
                >
                  <Shield className="w-3.5 h-3.5 fill-current" />
                  <span>宣告阻挡</span>
                </button>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center text-neutral-600 select-none pointer-events-none">
          <span className="text-[10px] font-mono tracking-widest uppercase">
            {isOpponent ? 'OPPONENT' : 'BATTLEFIELD'}
          </span>
          <span className="text-xs font-mono font-bold text-neutral-500">
            卡位 {slotIndex + 1}
          </span>
          {isPlayTargetable && (
            <span className="text-[9px] font-mono text-terminalCyan animate-bounce mt-1">
              可召唤 / 拖放至此
            </span>
          )}
        </div>
      )}
    </div>
  );
});

BattlefieldSlotView.displayName = 'BattlefieldSlotView';

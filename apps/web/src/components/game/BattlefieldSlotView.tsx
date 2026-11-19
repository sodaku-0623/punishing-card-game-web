'use client';

import React, { useState } from 'react';
import { CardInstance } from '@zhanshuang/shared';
import { CardView } from './CardView';
import { HudBrackets } from '@/components/ui';
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

  const bracketColor: 'crimson' | 'teal' | 'steel' = isLegalAttackTarget
    ? 'crimson'
    : isPlayTargetable || isSelected || isDragOver
    ? 'teal'
    : 'steel';

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
      data-has-ability={hasAbility ? 'true' : undefined}
      className={`relative ${
        customClassName || 'w-full h-full'
      } border flex flex-col items-center justify-center transition-all duration-fast ease-enter select-none group card-interactive ${
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
          ? 'border-crimson-500 bg-crimson-500/15 shadow-glow-crimson ring-1 ring-crimson-400 cursor-crosshair'
          : isPlayTargetable
          ? 'border-teal-400/80 bg-teal-400/10 shadow-glow-teal cursor-pointer'
          : isSelected
          ? 'border-teal-400 bg-teal-400/10 cursor-pointer'
          : canAttack
          ? 'border-crimson-500/60 bg-ink-900/40 hover:border-crimson-400'
          : 'border-line bg-ink-900/35 hover:border-line-strong hover:bg-ink-900/55'
      }`}
    >
      {/* 四角准星角标 */}
      <HudBrackets size="sm" color={bracketColor} interactive={!!roleCard || isPlayTargetable} />

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

          {/* 横置与冰冻 (10.15) 状态水平正向指示牌 (绝对水平正向，不随卡面旋转倾倒) */}
          {(!roleCard.isReady || isAttacking || roleCard.isFrozen) && (
            <div className="absolute top-1 left-1 z-30 flex flex-col gap-0.5 pointer-events-none select-none">
              {(!roleCard.isReady || isAttacking) && (
                <div className="px-1.5 py-0.5 bg-ink-950/95 text-gold-300 text-hud font-sans font-semibold border border-gold-300/60 tracking-wider">
                  横置
                </div>
              )}
              {roleCard.isFrozen && (
                <div className="px-1.5 py-0.5 bg-ink-950/95 text-teal-400 text-hud font-sans font-semibold border border-teal-400/70 tracking-wider">
                  冰冻
                </div>
              )}
            </div>
          )}

          {/* 升变垫牌层数指示 */}
          {roleCard.underneathCardIds && roleCard.underneathCardIds.length > 0 && (
            <div
              className="absolute top-1 right-1 bg-ink-950/90 border border-steel-300/60 text-steel-300 text-hud px-1 py-px flex items-center gap-0.5 z-20 font-num tabular-nums"
              title={`升变底牌: ${roleCard.underneathCardIds.length} 张`}
            >
              <Layers className="w-2.5 h-2.5" />
              <span>+{roleCard.underneathCardIds.length}</span>
            </div>
          )}

          {/* 附着装备指示 */}
          {roleCard.attachedEquipmentId && (
            <div className="absolute -bottom-1.5 -right-1 bg-ink-950 border border-gold-300/70 text-gold-300 text-hud px-1.5 py-px flex items-center gap-0.5 z-20 font-sans font-medium">
              <Shield className="w-2.5 h-2.5" />
              <span>装备</span>
            </div>
          )}

          {/* 敌方角色：可攻击目标瞄准准星 */}
          {isOpponent && isLegalAttackTarget && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-30">
              <div className="relative p-2 border border-crimson-500/80 bg-ink-950/50">
                <Crosshair className="w-6 h-6 text-crimson-400" />
              </div>
            </div>
          )}

          {/* 角色卡行动按钮 (发动【起】效果 / 宣告攻击 / 宣告阻挡) - 向下延伸触控桥防止悬停丢失 */}
          {!isOpponent && (canActivateAbility || canAttack || canBlock) && (
            <div
              className={`absolute -top-8.5 inset-x-0 pb-3 flex items-center justify-center gap-1.5 z-40 transition-transform duration-fast ease-enter pointer-events-auto ${
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
                  className="px-2.5 py-1 clip-corner-sm bg-gold-300 hover:bg-gold-300/90 text-ink-950 text-hud font-sans font-semibold active:scale-95 flex items-center gap-1 border border-fg/20 cursor-pointer transition-all duration-fast"
                  title="发动卡牌【起】动能力"
                >
                  <Zap className="w-3 h-3 fill-current" />
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
                  className="pgr-sweep px-2.5 py-1 clip-corner-sm bg-crimson-500 hover:bg-crimson-400 text-fg text-hud font-sans font-semibold shadow-glow-crimson active:scale-95 flex items-center gap-1 border border-fg/30 cursor-pointer transition-all duration-fast"
                  title="宣告攻击对方玩家 (或拖拽至敌方角色)"
                >
                  <Swords className="w-3 h-3" />
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
                  className="px-2.5 py-1 clip-corner-sm bg-teal-400 hover:bg-teal-400/90 text-ink-950 text-hud font-sans font-semibold shadow-glow-teal active:scale-95 flex items-center gap-1 border border-fg/30 cursor-pointer transition-all duration-fast"
                  title="宣告该角色进行阻挡 (7.3.1.c)"
                >
                  <Shield className="w-3 h-3 fill-current" />
                  <span>宣告阻挡</span>
                </button>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center text-fg-disabled select-none pointer-events-none">
          <span className="text-hud font-display tracking-widest uppercase">
            {isOpponent ? 'HOSTILE' : 'SECTOR'}
          </span>
          <span className="text-caption font-num tabular-nums font-medium text-fg-muted mt-0.5">
            0{slotIndex + 1}
          </span>
          {isPlayTargetable && (
            <span className="text-hud font-sans font-medium text-teal-400 mt-1 px-1.5 py-px border border-teal-400/40 bg-teal-400/10">
              可部署
            </span>
          )}
        </div>
      )}
    </div>
  );
});

BattlefieldSlotView.displayName = 'BattlefieldSlotView';

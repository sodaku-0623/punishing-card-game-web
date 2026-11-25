'use client';

import React, { useState } from 'react';
import { CardInstance } from '@zhanshuang/shared';
import { CardView } from './CardView';
import { HudBrackets } from '@/components/ui';
import { Shield, Zap, Swords, Layers, Crosshair, Users, Cpu } from 'lucide-react';
import { sfx } from '@/lib/audio';
import { findCardByNumberOrId } from '@/lib/cards-data';
import { getDisplayStats } from '@/lib/card-stats';
import type { ActivatedAbilityOption, SlotOccupancyKind } from '@/lib/battle-actions';

interface BattlefieldSlotViewProps {
  slotIndex: number;
  roleCard?: CardInstance;
  slotCardKind?: SlotOccupancyKind;
  isTransformed?: boolean;
  isOpponent?: boolean;
  isSelected?: boolean;
  isLegalPlay?: boolean;
  isPlayTargetable?: boolean;
  isEquipTargetable?: boolean;
  canActivateAbility?: boolean;
  activateOptions?: ActivatedAbilityOption[];
  canAttack?: boolean;
  canAttackPlayer?: boolean;
  canBlock?: boolean;
  canEquipStandalone?: boolean;
  canPerformAssist?: boolean;
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
  onActivateAbility?: (cardId: string, abilityIndex?: number) => void;
  onOpenUnderneath?: (card: CardInstance) => void;
  onAttackClick?: (cardId: string) => void;
  onBlockClick?: (cardId: string) => void;
  onEquipStartClick?: (equipmentCardId: string) => void;
  onPerformAssistClick?: (hostRoleCardId: string) => void;
  onDropCard?: (slotIndex: number, cardInstanceId: string) => void;
  onDropAttackTarget?: (targetCardId: string, attackerCardId: string) => void;
  onDropEquipToRole?: (targetRoleCardId: string, equipmentCardId: string) => void;
}

export const BattlefieldSlotView: React.FC<BattlefieldSlotViewProps> = React.memo(({
  slotIndex,
  roleCard,
  slotCardKind = roleCard ? 'ROLE' : 'EMPTY',
  isTransformed = false,
  isOpponent = false,
  isSelected = false,
  isLegalPlay = false,
  isPlayTargetable = false,
  isEquipTargetable = false,
  canActivateAbility = false,
  activateOptions,
  canAttack = false,
  canAttackPlayer,
  canBlock = false,
  canEquipStandalone = false,
  canPerformAssist = false,
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
  onOpenUnderneath,
  onAttackClick,
  onBlockClick,
  onEquipStartClick,
  onPerformAssistClick,
  onDropCard,
  onDropAttackTarget,
  onDropEquipToRole,
}) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const [showAbilityPicker, setShowAbilityPicker] = useState(false);

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
    const standaloneEquipId = e.dataTransfer.getData('text/standalone-equip-id');

    if (standaloneEquipId && roleCard && !isOpponent && slotCardKind === 'ROLE') {
      sfx.playCardPlay();
      onDropEquipToRole?.(roleCard.instanceId, standaloneEquipId);
    } else if (attackerInstanceId && roleCard && isOpponent && slotCardKind === 'ROLE') {
      // 攻击方拖拽至敌方角色进行定点进攻 (7.2.1.b.1)
      sfx.playAttack();
      onDropAttackTarget?.(roleCard.instanceId, attackerInstanceId);
    } else if (cardInstanceId && !isOpponent) {
      // 手牌拖拽至己方卡位 (空闲卡位普通出牌 或 目标角色卡位升变/装备)
      sfx.playCardPlay();
      onDropCard?.(slotIndex, cardInstanceId);
    }
  };

  // 攻击方或独立装备拖拽开始
  const handleCardDragStart = (e: React.DragEvent) => {
    if (!roleCard || isOpponent) return;
    if (slotCardKind === 'STANDALONE_EQUIPMENT' && canEquipStandalone) {
      e.dataTransfer.setData('text/standalone-equip-id', roleCard.instanceId);
      e.dataTransfer.effectAllowed = 'move';
      sfx.playClick();
      return;
    }
    if (slotCardKind === 'ROLE' && canAttack) {
      e.dataTransfer.setData('text/attacker-instance-id', roleCard.instanceId);
      e.dataTransfer.effectAllowed = 'move';
      sfx.playClick();
    }
  };

  const bracketColor: 'crimson' | 'teal' | 'steel' = isLegalAttackTarget
    ? 'crimson'
    : isPlayTargetable || isEquipTargetable || isSelected || isDragOver
    ? 'teal'
    : 'steel';

  const equipCount = roleCard
    ? (roleCard.attachedEquipmentId ? 1 : 0) + (roleCard.extraAttachedEquipmentIds?.length ?? 0)
    : 0;

  const transformedStats =
    roleCard && slotCardKind === 'ROLE' && isTransformed
      ? getDisplayStats(roleCard, findCardByNumberOrId(roleCard.cardNumber || roleCard.cardId))
      : null;

  const handleActivateButtonClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!roleCard) return;
    sfx.playClick();
    if (activateOptions && activateOptions.length >= 2) {
      setShowAbilityPicker((prev) => !prev);
      return;
    }
    const idx = activateOptions?.[0]?.abilityIndex ?? 0;
    onActivateAbility?.(roleCard.instanceId, idx);
  };

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={() => {
        setShowAbilityPicker(false);
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
        setShowAbilityPicker(false);
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
          : isEquipTargetable
          ? 'border-gold-300 bg-gold-300/15 ring-1 ring-gold-300 cursor-pointer'
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
      <HudBrackets size="sm" color={bracketColor} interactive={!!roleCard || isPlayTargetable || isEquipTargetable} />

      {/* 战场卡位实体 (角色 / 辅助机 / 单独占位装备) */}
      {roleCard ? (
        <div
          data-card-instance-id={roleCard.instanceId}
          data-slot-card-kind={slotCardKind}
          {...(isOpponent && slotCardKind === 'ROLE' && isLegalAttackTarget ? { 'data-opponent-role-id': roleCard.instanceId } : {})}
          draggable={!isOpponent && ((slotCardKind === 'ROLE' && canAttack) || (slotCardKind === 'STANDALONE_EQUIPMENT' && canEquipStandalone))}
          onDragStart={handleCardDragStart}
          className="relative w-full h-full flex items-center justify-center"
        >
          <CardView
            card={roleCard}
            isSelected={isSelected}
            isLegalPlay={isLegalPlay}
            isTargetable={isLegalAttackTarget || isEquipTargetable}
            isRested={!roleCard.isReady || isAttacking}
            hideStatusBadges={true}
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

          {/* 下方叠置卡牌可点击徽章 */}
          {roleCard.underneathCardIds && roleCard.underneathCardIds.length > 0 && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                sfx.playClick();
                onOpenUnderneath?.(roleCard);
              }}
              aria-label={`查看下方 ${roleCard.underneathCardIds.length} 张牌`}
              className="absolute top-1 right-1 bg-ink-950/90 hover:bg-ink-800 border border-steel-300/60 hover:border-teal-400 text-steel-300 hover:text-teal-400 text-hud px-1.5 py-px flex items-center gap-0.5 z-30 font-num tabular-nums cursor-pointer transition-colors"
              title={`点击查看下方 ${roleCard.underneathCardIds.length} 张牌`}
            >
              <Layers className="w-2.5 h-2.5" />
              <span>下方 {roleCard.underneathCardIds.length}</span>
            </button>
          )}

          {/* 底边统一非叠压状态栏：协战 -> 变身角色/辅助机/独立装备 -> 装备/装备×N */}
          {(roleCard.partnerCardId ||
            (slotCardKind === 'ROLE' && isTransformed && transformedStats) ||
            slotCardKind === 'ASSIST' ||
            slotCardKind === 'STANDALONE_EQUIPMENT' ||
            equipCount > 0) && (
            <div className="absolute -bottom-1.5 inset-x-0.5 z-20 flex items-center justify-center gap-0.5 flex-wrap pointer-events-none">
              {roleCard.partnerCardId && (
                <div className="bg-ink-950/95 border border-teal-400/70 text-teal-400 text-hud px-1.5 py-px font-sans font-semibold whitespace-nowrap">
                  协战
                </div>
              )}
              {slotCardKind === 'ROLE' && isTransformed && transformedStats && (
                <div className="bg-ink-950/95 border border-teal-400/80 text-teal-400 text-hud px-1.5 py-px flex items-center gap-1 font-sans font-semibold whitespace-nowrap">
                  <span>变身角色</span>
                  <span className="font-num tabular-nums text-gold-300">
                    {transformedStats.pp}/{transformedStats.dp}
                  </span>
                </div>
              )}
              {slotCardKind === 'ASSIST' && (
                <div className="bg-ink-950/95 border border-teal-400/80 text-teal-400 text-hud px-1.5 py-px flex items-center gap-0.5 font-sans font-semibold whitespace-nowrap">
                  <Cpu className="w-2.5 h-2.5" />
                  <span>{isTransformed ? '变身辅助机' : '辅助机'}</span>
                </div>
              )}
              {slotCardKind === 'STANDALONE_EQUIPMENT' && (
                <div className="bg-ink-950/95 border border-gold-300/80 text-gold-300 text-hud px-1.5 py-px flex items-center gap-0.5 font-sans font-semibold whitespace-nowrap">
                  <Shield className="w-2.5 h-2.5" />
                  <span>独立装备</span>
                </div>
              )}
              {equipCount > 0 && (
                <div className="bg-ink-950 border border-gold-300/70 text-gold-300 text-hud px-1.5 py-px flex items-center gap-0.5 font-sans font-medium whitespace-nowrap">
                  <Shield className="w-2.5 h-2.5" />
                  <span>{equipCount > 1 ? `装备×${equipCount}` : '装备'}</span>
                </div>
              )}
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

          {/* 角色/辅助机/独立装备行动按钮 */}
          {!isOpponent && (canActivateAbility || canAttack || canBlock || canEquipStandalone || canPerformAssist) && (
            <div
              className={`absolute -top-8 inset-x-0 pb-3 flex items-center justify-center gap-1 z-40 transition-transform duration-fast ease-enter pointer-events-auto ${
                isSelected ? 'scale-105' : 'hover:scale-105'
              }`}
            >
              {canActivateAbility && (
                <div className="relative">
                  <button
                    type="button"
                    onClick={handleActivateButtonClick}
                    className="px-2 py-1 clip-corner-sm bg-gold-300 hover:bg-gold-300/90 text-ink-950 text-hud font-sans font-semibold active:scale-95 flex items-center gap-1 border border-fg/20 cursor-pointer transition-all duration-fast whitespace-nowrap"
                    title={
                      activateOptions && activateOptions.length >= 2
                        ? '点击选择要发动的【起】动能力'
                        : activateOptions?.[0]?.label || '发动卡牌【起】动能力'
                    }
                  >
                    <Zap className="w-3 h-3 fill-current" />
                    <span>
                      {activateOptions && activateOptions.length >= 2
                        ? `发动效果 (${activateOptions.length})`
                        : '发动效果'}
                    </span>
                  </button>

                  {showAbilityPicker && activateOptions && activateOptions.length >= 2 && (
                    <div
                      role="menu"
                      onClick={(e) => e.stopPropagation()}
                      className="absolute left-1/2 -translate-x-1/2 top-full mt-1 w-56 bg-ink-950/95 border border-gold-300/70 p-1 shadow-overlay z-50 flex flex-col gap-0.5"
                    >
                      {activateOptions.map((opt) => (
                        <button
                          key={`slot-act-${opt.abilityIndex}-${opt.grantedByEquipmentId || 'own'}`}
                          type="button"
                          role="menuitem"
                          disabled={opt.disabled}
                          title={opt.disabled ? opt.reason : opt.label}
                          onClick={(e) => {
                            e.stopPropagation();
                            sfx.playClick();
                            setShowAbilityPicker(false);
                            onActivateAbility?.(roleCard.instanceId, opt.abilityIndex);
                          }}
                          className="w-full px-2 py-1.5 text-left text-hud border border-transparent hover:border-gold-300/50 hover:bg-gold-300/15 text-fg-secondary hover:text-fg flex items-center gap-1.5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          <Zap className="w-3 h-3 text-gold-300 shrink-0" />
                          <span className="truncate">
                            {opt.grantedByEquipmentId && !opt.label.includes('[装备]')
                              ? `[装备] ${opt.label}`
                              : opt.label}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {canEquipStandalone && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    sfx.playClick();
                    onEquipStartClick?.(roleCard.instanceId);
                  }}
                  className="px-2 py-1 clip-corner-sm bg-gold-300 hover:bg-gold-300/90 text-ink-950 text-hud font-sans font-semibold active:scale-95 flex items-center gap-1 border border-fg/20 cursor-pointer transition-all duration-fast whitespace-nowrap"
                  title="点击选择或拖拽至我方角色完成装备 (6.4.1.b.4)"
                >
                  <Shield className="w-3 h-3" />
                  <span>装备角色</span>
                </button>
              )}

              {canPerformAssist && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    sfx.playClick();
                    onPerformAssistClick?.(roleCard.instanceId);
                  }}
                  className="px-2 py-1 clip-corner-sm bg-teal-400 hover:bg-teal-400/90 text-ink-950 text-hud font-sans font-semibold shadow-glow-teal active:scale-95 flex items-center gap-1 border border-fg/30 cursor-pointer transition-all duration-fast whitespace-nowrap"
                  title="自由时点发动【协战】获得协战搭档 (8.13)"
                >
                  <Users className="w-3 h-3" />
                  <span>协战</span>
                </button>
              )}

              {canAttack && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (canAttackPlayer === false) {
                      sfx.playClick();
                      onRoleClick?.(roleCard.instanceId);
                      return;
                    }
                    sfx.playAttack();
                    onAttackClick?.(roleCard.instanceId);
                  }}
                  className="pgr-sweep px-2 py-1 clip-corner-sm bg-crimson-500 hover:bg-crimson-400 text-fg text-hud font-sans font-semibold shadow-glow-crimson active:scale-95 flex items-center gap-1 border border-fg/30 cursor-pointer transition-all duration-fast whitespace-nowrap"
                  title={
                    canAttackPlayer === false
                      ? '【突进】本回合仅可攻击对方角色 (点击选择或拖拽至敌方角色)'
                      : '宣告攻击对方玩家 (或拖拽至敌方角色)'
                  }
                >
                  <Swords className="w-3 h-3" />
                  <span>{canAttackPlayer === false ? '突进攻击' : '攻击'}</span>
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
                  className="px-2 py-1 clip-corner-sm bg-teal-400 hover:bg-teal-400/90 text-ink-950 text-hud font-sans font-semibold shadow-glow-teal active:scale-95 flex items-center gap-1 border border-fg/30 cursor-pointer transition-all duration-fast whitespace-nowrap"
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

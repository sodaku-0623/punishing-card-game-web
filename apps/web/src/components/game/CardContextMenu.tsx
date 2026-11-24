'use client';

import React, { useEffect, useRef } from 'react';
import {
  Zap,
  Swords,
  Shield,
  Layers,
  Search,
  X,
  Play,
  ArrowUpRight,
  Users,
  Cpu,
} from 'lucide-react';
import { CardInstance, CardType, GamePhase } from '@zhanshuang/shared';
import { parseAscensionConfig } from '@zhanshuang/game-rules';
import { findCardByNumberOrId } from '@/lib/cards-data';
import { getDisplayStats } from '@/lib/card-stats';
import type {
  ActivatedAbilityOption,
  AscensionPlan,
  NonHandPlayAction,
  NonTacticsInstantOption,
} from '@/lib/battle-actions';

export interface ContextMenuAction {
  id: string;
  label: string;
  subLabel?: string;
  icon: React.ReactNode;
  variant?: 'primary' | 'danger' | 'warning' | 'default';
  disabled?: boolean;
  onClick: () => void;
}

interface CardContextMenuProps {
  x: number;
  y: number;
  card: CardInstance;
  isMyTurn: boolean;
  phase: GamePhase;
  myAvailableCost: number;
  /** 轮到我方选择是否使用【瞬时】 */
  canUseInstant?: boolean;
  effectiveCost?: number;
  isFriendlyRole: boolean;
  isOpponentRole: boolean;
  isStandaloneEquipment?: boolean;
  isHandCard: boolean;
  /** 向后兼容旧调用方；若传入 `activateOptions` 则以 `activateOptions` 为准 */
  canActivateAbility?: boolean;
  activateOptions?: ActivatedAbilityOption[];
  handAscensionPlan?: AscensionPlan | null;
  nonHandPlayAction?: NonHandPlayAction | null;
  underneathCardsCount?: number;
  canAttack: boolean;
  canBlock: boolean;
  canPerformAssist?: boolean;
  canEquipStandalone?: boolean;
  canUseHandInstant?: boolean;
  underneathInstants?: NonTacticsInstantOption[];
  hasEmptySlot: boolean;
  hasAssistSlot?: boolean;
  hasSelectedAttacker: boolean;
  onPlayCard?: (card: CardInstance) => void;
  onAscendCard?: (card: CardInstance) => void;
  onActivateAbility?: (card: CardInstance, abilityIndex?: number) => void;
  onOpenUnderneath?: (card: CardInstance) => void;
  onNonHandPlay?: (card: CardInstance, action: NonHandPlayAction) => void;
  onAttackPlayer?: (card: CardInstance) => void;
  onAttackRole?: (card: CardInstance) => void;
  onBlock?: (card: CardInstance) => void;
  onPerformAssist?: (card: CardInstance) => void;
  onStartEquipStandalone?: (card: CardInstance) => void;
  onUseInstant?: (cardInstanceId: string) => void;
  onChargeCost?: (card: CardInstance) => void;
  onInspectCard?: (card: CardInstance) => void;
  onClose: () => void;
}

export const CardContextMenu: React.FC<CardContextMenuProps> = ({
  x,
  y,
  card,
  isMyTurn,
  phase,
  myAvailableCost,
  canUseInstant,
  effectiveCost,
  isFriendlyRole,
  isOpponentRole,
  isStandaloneEquipment = false,
  isHandCard,
  canActivateAbility = false,
  activateOptions,
  handAscensionPlan,
  nonHandPlayAction,
  underneathCardsCount = card.underneathCardIds?.length ?? 0,
  canAttack,
  canBlock,
  canPerformAssist = false,
  canEquipStandalone = false,
  canUseHandInstant = false,
  underneathInstants = [],
  hasEmptySlot,
  hasAssistSlot = hasEmptySlot,
  hasSelectedAttacker,
  onPlayCard,
  onAscendCard,
  onActivateAbility,
  onOpenUnderneath,
  onNonHandPlay,
  onAttackPlayer,
  onAttackRole,
  onBlock,
  onPerformAssist,
  onStartEquipStandalone,
  onUseInstant,
  onChargeCost,
  onInspectCard,
  onClose,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const cardDef = findCardByNumberOrId(card.cardNumber || card.cardId);

  const currentCost = effectiveCost !== undefined ? effectiveCost : (cardDef?.cost ?? 0);
  const costLabel =
    cardDef && effectiveCost !== undefined && effectiveCost < cardDef.cost
      ? `费用 ${effectiveCost} (原${cardDef.cost})`
      : `费用 ${currentCost}`;

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    window.addEventListener('mousedown', handleOutsideClick);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('mousedown', handleOutsideClick);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  const adjustedX = Math.min(Math.max(10, x), typeof window !== 'undefined' ? window.innerWidth - 260 : x);
  const adjustedY = Math.min(Math.max(10, y), typeof window !== 'undefined' ? window.innerHeight - 280 : y);

  // 向后兼容：若调用方未传 activateOptions，则根据 canActivateAbility 构造默认条目
  const resolvedActivateOptions: ActivatedAbilityOption[] =
    activateOptions !== undefined
      ? activateOptions
      : canActivateAbility
      ? [
          {
            sourceCardId: card.instanceId,
            abilityIndex: 0,
            label: '发动【起】能力',
            zone: isHandCard ? 'HAND' : 'BATTLEFIELD',
          },
        ]
      : [];

  const actions: ContextMenuAction[] = [];

  if (isHandCard) {
    if (cardDef?.cardType === CardType.ROLE) {
      actions.push({
        id: 'play_role',
        label: '召唤登场 (出牌)',
        subLabel: costLabel,
        icon: <Play className="w-3.5 h-3.5" />,
        variant: 'primary',
        disabled: !isMyTurn || phase !== 'MAIN_PHASE' || !hasEmptySlot || myAvailableCost < currentCost,
        onClick: () => {
          onPlayCard?.(card);
          onClose();
        },
      });

      if (handAscensionPlan !== undefined) {
        if (handAscensionPlan) {
          const ascCost = handAscensionPlan.config.ascensionCost;
          const taxSuffix =
            handAscensionPlan.tappedOpponentTaxCount > 0
              ? ` (+${handAscensionPlan.tappedOpponentTaxCount})`
              : '';
          const canUseAscend =
            isMyTurn && phase === 'MAIN_PHASE' && handAscensionPlan.canAscend;
          actions.push({
            id: 'ascend_role',
            label: '升变登场 (重叠)',
            subLabel: canUseAscend
              ? `升变 ${ascCost} 费${taxSuffix}`
              : handAscensionPlan.reason || `升变 ${ascCost} 费`,
            icon: <ArrowUpRight className="w-3.5 h-3.5 text-gold-300" />,
            variant: 'primary',
            disabled: !canUseAscend,
            onClick: () => {
              onAscendCard?.(card);
              onClose();
            },
          });
        }
      } else if (cardDef.rulesText) {
        const parsedAsc = parseAscensionConfig(cardDef.rulesText);
        if (parsedAsc) {
          actions.push({
            id: 'ascend_role',
            label: '升变登场 (重叠)',
            subLabel: `升变 ${parsedAsc.ascensionCost} 费`,
            icon: <ArrowUpRight className="w-3.5 h-3.5 text-gold-300" />,
            variant: 'primary',
            disabled: !isMyTurn || phase !== 'MAIN_PHASE' || myAvailableCost < parsedAsc.ascensionCost,
            onClick: () => {
              onAscendCard?.(card);
              onClose();
            },
          });
        }
      }
    } else if (cardDef?.cardType === CardType.TACTICS) {
      const isInstantCard = !!cardDef.isInstant || !!cardDef.rulesText?.includes('【瞬时');
      const canUseNow = isInstantCard
        ? !!canUseInstant ||
          (isMyTurn && phase === 'MAIN_PHASE' && !!cardDef.rulesText?.includes('主要阶段也可以发动'))
        : isMyTurn && phase === 'MAIN_PHASE';
      actions.push({
        id: 'play_tactics',
        label: cardDef.signalOrb ? '放置信号球' : isInstantCard ? '使用瞬时战术' : '发动战术卡',
        subLabel: costLabel,
        icon: <Zap className="w-3.5 h-3.5" />,
        variant: 'primary',
        disabled: !canUseNow || myAvailableCost < currentCost,
        onClick: () => {
          onPlayCard?.(card);
          onClose();
        },
      });
    } else if (cardDef?.cardType === CardType.EQUIPMENT) {
      actions.push({
        id: 'play_equip',
        label: '使用装备卡',
        subLabel: costLabel,
        icon: <Shield className="w-3.5 h-3.5" />,
        variant: 'primary',
        disabled: !isMyTurn || phase !== 'MAIN_PHASE' || myAvailableCost < currentCost,
        onClick: () => {
          onPlayCard?.(card);
          onClose();
        },
      });
    } else if (cardDef?.cardType === CardType.ASSIST) {
      actions.push({
        id: 'play_assist',
        label: '部署辅助机',
        subLabel: costLabel,
        icon: <Cpu className="w-3.5 h-3.5" />,
        variant: 'primary',
        disabled: !isMyTurn || phase !== 'MAIN_PHASE' || !hasAssistSlot || myAvailableCost < currentCost,
        onClick: () => {
          onPlayCard?.(card);
          onClose();
        },
      });
    }

    for (const opt of resolvedActivateOptions) {
      actions.push({
        id: `activate_hand_${opt.abilityIndex}`,
        label: opt.label,
        subLabel: opt.disabled ? opt.reason : '手牌【起】',
        icon: <Zap className="w-3.5 h-3.5 fill-current" />,
        variant: 'warning',
        disabled: Boolean(opt.disabled),
        onClick: () => {
          onActivateAbility?.(card, opt.abilityIndex);
          onClose();
        },
      });
    }

    if (canUseHandInstant && onUseInstant) {
      actions.push({
        id: 'use_hand_instant',
        label: '发动非战术【瞬时】',
        subLabel: '10.8',
        icon: <Zap className="w-3.5 h-3.5 fill-current" />,
        variant: 'warning',
        onClick: () => {
          onUseInstant(card.instanceId);
          onClose();
        },
      });
    }

    if (isMyTurn && phase === 'DRAW_CHARGE_PHASE') {
      actions.push({
        id: 'charge_cost',
        label: '充入明费 (6.3.1.c)',
        subLabel: '充能+1',
        icon: <Layers className="w-3.5 h-3.5" />,
        variant: 'warning',
        onClick: () => {
          onChargeCost?.(card);
          onClose();
        },
      });
    }
  }

  if (isFriendlyRole) {
    if (isStandaloneEquipment && canEquipStandalone && onStartEquipStandalone) {
      actions.push({
        id: 'equip_standalone',
        label: '装备给己方角色',
        subLabel: '6.4.1.b.4',
        icon: <Shield className="w-3.5 h-3.5" />,
        variant: 'warning',
        onClick: () => {
          onStartEquipStandalone(card);
          onClose();
        },
      });
    }

    if (canPerformAssist && onPerformAssist) {
      actions.push({
        id: 'perform_assist',
        label: '发动【协战】',
        subLabel: '8.13',
        icon: <Users className="w-3.5 h-3.5" />,
        variant: 'primary',
        onClick: () => {
          onPerformAssist(card);
          onClose();
        },
      });
    }

    if (onUseInstant && underneathInstants.length > 0) {
      for (const inst of underneathInstants) {
        actions.push({
          id: `underneath_instant_${inst.card.instanceId}`,
          label: `瞬时发动《${inst.name}》`,
          subLabel: inst.costLabel,
          icon: <Zap className="w-3.5 h-3.5 fill-current" />,
          variant: 'warning',
          onClick: () => {
            onUseInstant(inst.card.instanceId);
            onClose();
          },
        });
      }
    }

    for (const opt of resolvedActivateOptions) {
      const displayLabel = opt.grantedByEquipmentId
        ? opt.label.includes('[装备]')
          ? opt.label
          : `[装备] ${opt.label}`
        : opt.label;
      actions.push({
        id: `activate_${opt.abilityIndex}_${opt.grantedByEquipmentId || 'own'}`,
        label: displayLabel,
        subLabel: opt.disabled
          ? opt.reason
          : opt.grantedByEquipmentId
          ? '装备赋予'
          : '8.1.1.c',
        icon: <Zap className="w-3.5 h-3.5 fill-current" />,
        variant: opt.grantedByEquipmentId ? 'warning' : 'primary',
        disabled: Boolean(opt.disabled),
        onClick: () => {
          onActivateAbility?.(card, opt.abilityIndex);
          onClose();
        },
      });
    }

    if (underneathCardsCount > 0 && onOpenUnderneath) {
      actions.push({
        id: 'open_underneath',
        label: `查看下方牌 (${underneathCardsCount})`,
        subLabel: '下方叠置',
        icon: <Layers className="w-3.5 h-3.5" />,
        variant: 'default',
        onClick: () => {
          onOpenUnderneath(card);
          onClose();
        },
      });
    }

    if (canAttack) {
      actions.push({
        id: 'attack_player',
        label: '攻击对方玩家',
        subLabel: `PP: ${getDisplayStats(card, cardDef).pp}`,
        icon: <Swords className="w-3.5 h-3.5" />,
        variant: 'danger',
        onClick: () => {
          onAttackPlayer?.(card);
          onClose();
        },
      });
    }

    if (canBlock) {
      actions.push({
        id: 'block',
        label: '宣告该角色阻挡',
        subLabel: '7.3.1.c',
        icon: <Shield className="w-3.5 h-3.5" />,
        variant: 'primary',
        onClick: () => {
          onBlock?.(card);
          onClose();
        },
      });
    }
  }

  // 非战场、非手牌区域（如正面信号球区、墓地、明费等）的自身【起】或非手牌出牌
  if (!isHandCard && !isFriendlyRole) {
    for (const opt of resolvedActivateOptions) {
      actions.push({
        id: `activate_zone_${opt.zone}_${opt.abilityIndex}`,
        label: opt.label,
        subLabel: opt.disabled ? opt.reason : undefined,
        icon: <Zap className="w-3.5 h-3.5 fill-current" />,
        variant: 'warning',
        disabled: Boolean(opt.disabled),
        onClick: () => {
          onActivateAbility?.(card, opt.abilityIndex);
          onClose();
        },
      });
    }

    if (nonHandPlayAction && onNonHandPlay) {
      actions.push({
        id: `non_hand_${nonHandPlayAction.kind}`,
        label: nonHandPlayAction.label,
        icon: <Play className="w-3.5 h-3.5" />,
        variant: 'primary',
        onClick: () => {
          onNonHandPlay(card, nonHandPlayAction);
          onClose();
        },
      });
    }

    if (isOpponentRole && underneathCardsCount > 0 && onOpenUnderneath) {
      actions.push({
        id: 'open_opp_underneath',
        label: `查看下方牌 (${underneathCardsCount})`,
        subLabel: '下方叠置',
        icon: <Layers className="w-3.5 h-3.5" />,
        variant: 'default',
        onClick: () => {
          onOpenUnderneath(card);
          onClose();
        },
      });
    }
  }

  if (isOpponentRole && hasSelectedAttacker) {
    actions.push({
      id: 'target_role',
      label: '攻击该敌方角色',
      subLabel: '7.2.1.b.1',
      icon: <Swords className="w-3.5 h-3.5" />,
      variant: 'danger',
      onClick: () => {
        onAttackRole?.(card);
        onClose();
      },
    });
  }

  actions.push({
    id: 'inspect',
    label: '查看卡面大图 (F)',
    subLabel: card.cardNumber,
    icon: <Search className="w-3.5 h-3.5" />,
    variant: 'default',
    onClick: () => {
      onInspectCard?.(card);
      onClose();
    },
  });

  return (
    <div
      ref={menuRef}
      role="menu"
      style={{ left: adjustedX, top: adjustedY }}
      className="fixed z-modal w-64 bg-ink-950/95 border border-teal-400/70 p-1.5 shadow-overlay backdrop-blur-md text-caption animate-in fade-in duration-fast"
    >
      {/* 顶部细红装饰条 */}
      <div className="h-[2px] w-full bg-crimson-500/80 mb-1" />

      {/* 菜单标题 */}
      <div className="flex items-center justify-between px-2 py-1.5 border-b border-line mb-1 text-hud text-fg-muted">
        <span className="truncate font-semibold text-fg">
          {cardDef?.name || card.cardNumber}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭菜单"
          className="text-fg-muted hover:text-fg p-0.5 cursor-pointer"
          title="关闭菜单 (Esc)"
        >
          <X className="w-3 h-3" />
        </button>
      </div>

      {/* 动作选项列表 */}
      <div className="flex flex-col gap-0.5">
        {actions.map((act) => {
          const variantClasses = {
            primary: 'text-teal-400 hover:bg-teal-400/15 hover:border-teal-400/40',
            danger: 'text-crimson-400 hover:bg-crimson-500/15 hover:border-crimson-500/40 font-semibold',
            warning: 'text-gold-300 hover:bg-gold-300/15 hover:border-gold-300/40',
            default: 'text-fg-secondary hover:bg-ink-800 hover:text-fg',
          }[act.variant || 'default'];

          return (
            <button
              key={act.id}
              type="button"
              role="menuitem"
              disabled={act.disabled}
              onClick={act.onClick}
              title={act.subLabel ? `${act.label} (${act.subLabel})` : act.label}
              className={`w-full flex items-center justify-between px-2.5 py-2 border border-transparent transition-colors duration-fast text-left group cursor-pointer ${
                act.disabled ? 'opacity-40 cursor-not-allowed text-fg-disabled' : variantClasses
              }`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="flex-shrink-0">{act.icon}</span>
                <span className="text-caption font-medium truncate">{act.label}</span>
              </div>
              {act.subLabel && (
                <span className="text-hud font-num text-fg-muted group-hover:text-fg-secondary shrink-0 ml-2 max-w-[96px] truncate">
                  {act.subLabel}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};

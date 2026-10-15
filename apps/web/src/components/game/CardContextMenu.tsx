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
} from 'lucide-react';
import { CardInstance, CardType, GamePhase } from '@zhanshuang/shared';
import { findCardByNumberOrId } from '@/lib/cards-data';

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
  isFriendlyRole: boolean;
  isOpponentRole: boolean;
  isHandCard: boolean;
  canActivateAbility: boolean;
  canAttack: boolean;
  canBlock: boolean;
  hasEmptySlot: boolean;
  hasSelectedAttacker: boolean;
  onPlayCard?: (card: CardInstance) => void;
  onAscendCard?: (card: CardInstance) => void;
  onActivateAbility?: (card: CardInstance) => void;
  onAttackPlayer?: (card: CardInstance) => void;
  onAttackRole?: (card: CardInstance) => void;
  onBlock?: (card: CardInstance) => void;
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
  isFriendlyRole,
  isOpponentRole,
  isHandCard,
  canActivateAbility,
  canAttack,
  canBlock,
  hasEmptySlot,
  hasSelectedAttacker,
  onPlayCard,
  onAscendCard,
  onActivateAbility,
  onAttackPlayer,
  onAttackRole,
  onBlock,
  onChargeCost,
  onInspectCard,
  onClose,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const cardDef = findCardByNumberOrId(card.cardNumber || card.cardId);

  // 点击菜单外部或按下 Esc 自动关闭
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

  // 计算屏幕边界防止菜单溢出
  const adjustedX = Math.min(Math.max(10, x), typeof window !== 'undefined' ? window.innerWidth - 220 : x);
  const adjustedY = Math.min(Math.max(10, y), typeof window !== 'undefined' ? window.innerHeight - 260 : y);

  const actions: ContextMenuAction[] = [];

  // 1. 手牌动作
  if (isHandCard) {
    if (cardDef?.cardType === CardType.ROLE) {
      actions.push({
        id: 'play_role',
        label: '召唤登场 (出牌)',
        subLabel: `费用 ${cardDef.cost}`,
        icon: <Play className="w-3.5 h-3.5" />,
        variant: 'primary',
        disabled: !isMyTurn || phase !== 'MAIN_PHASE' || !hasEmptySlot || myAvailableCost < cardDef.cost,
        onClick: () => {
          onPlayCard?.(card);
          onClose();
        },
      });

      if (cardDef.rulesText?.includes('升变')) {
        const ascMatch =
          cardDef.rulesText.match(/(?:升变代价|【升变代价】|升变费用|【升变费用】)[^0-9\r\n]{0,10}(?:费用\s*(\d+)|(\d+)\s*费)/) ||
          cardDef.rulesText.match(/(?:升变代价|【升变代价】|升变费用|【升变费用】)[^0-9\r\n]{0,10}[【\[](\d+)[】\]]/);
        const ascCost = ascMatch ? parseInt(ascMatch[1] || ascMatch[2], 10) : 2;

        actions.push({
          id: 'ascend_role',
          label: '升变登场 (重叠)',
          subLabel: `升变 ${ascCost} 费`,
          icon: <ArrowUpRight className="w-3.5 h-3.5 text-terminalGold" />,
          variant: 'primary',
          disabled: !isMyTurn || phase !== 'MAIN_PHASE' || myAvailableCost < ascCost,
          onClick: () => {
            onAscendCard?.(card);
            onClose();
          },
        });
      }
    } else if (cardDef?.cardType === CardType.TACTICS) {
      actions.push({
        id: 'play_tactics',
        label: card.cardNumber?.startsWith('ORB-') ? '放置信号球' : '发动战术卡',
        subLabel: `费用 ${cardDef.cost}`,
        icon: <Zap className="w-3.5 h-3.5" />,
        variant: 'primary',
        disabled: !isMyTurn || phase !== 'MAIN_PHASE' || myAvailableCost < cardDef.cost,
        onClick: () => {
          onPlayCard?.(card);
          onClose();
        },
      });
    } else if (cardDef?.cardType === CardType.EQUIPMENT) {
      actions.push({
        id: 'play_equip',
        label: '使用装备卡',
        subLabel: `费用 ${cardDef.cost}`,
        icon: <Shield className="w-3.5 h-3.5" />,
        variant: 'primary',
        disabled: !isMyTurn || phase !== 'MAIN_PHASE' || myAvailableCost < cardDef.cost,
        onClick: () => {
          onPlayCard?.(card);
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

  // 2. 己方战场角色动作
  if (isFriendlyRole) {
    if (canActivateAbility) {
      actions.push({
        id: 'activate',
        label: '发动【起】能力',
        subLabel: '8.1.1.c',
        icon: <Zap className="w-3.5 h-3.5 fill-current" />,
        variant: 'primary',
        onClick: () => {
          onActivateAbility?.(card);
          onClose();
        },
      });
    }

    if (canAttack) {
      actions.push({
        id: 'attack_player',
        label: '攻击对方玩家',
        subLabel: `PP: ${(cardDef?.basePP ?? 0) + (card.tempPPBonus ?? 0)}`,
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

  // 3. 敌方战场角色动作
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

  // 4. 通用：查看卡牌全图详情
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
      style={{ left: adjustedX, top: adjustedY }}
      className="fixed z-50 w-52 rounded-xl bg-neutral-950/95 border border-terminalCyan/60 p-1.5 shadow-[0_10px_35px_rgba(0,0,0,0.8)] backdrop-blur-xl font-mono text-xs animate-in fade-in zoom-in-95 duration-100"
    >
      {/* 菜单标题 */}
      <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-terminalBorder/50 mb-1 text-[11px] text-neutral-400">
        <span className="truncate font-bold text-white">
          {cardDef?.name || card.cardNumber}
        </span>
        <button
          onClick={onClose}
          className="text-neutral-500 hover:text-white p-0.5"
          title="关闭菜单 (Esc)"
        >
          <X className="w-3 h-3" />
        </button>
      </div>

      {/* 动作选项列表 */}
      <div className="flex flex-col gap-0.5">
        {actions.map((act) => {
          const variantClasses = {
            primary: 'text-terminalCyan hover:bg-terminalCyan/15 hover:border-terminalCyan/40',
            danger: 'text-erosionRed hover:bg-erosionRed/15 hover:border-erosionRed/40 font-bold',
            warning: 'text-terminalGold hover:bg-terminalGold/15 hover:border-terminalGold/40',
            default: 'text-neutral-300 hover:bg-neutral-800 hover:text-white',
          }[act.variant || 'default'];

          return (
            <button
              key={act.id}
              disabled={act.disabled}
              onClick={act.onClick}
              className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg border border-transparent transition-all text-left group ${
                act.disabled ? 'opacity-40 cursor-not-allowed text-neutral-600' : variantClasses
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="flex-shrink-0">{act.icon}</span>
                <span className="text-xs font-medium">{act.label}</span>
              </div>
              {act.subLabel && (
                <span className="text-[10px] text-neutral-500 group-hover:text-neutral-300">
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

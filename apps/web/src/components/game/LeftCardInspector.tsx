'use client';

import React from 'react';
import { CardInstance, CardType, ElementAttribute } from '@zhanshuang/shared';
import { findCardByNumberOrId, getCardVariants, formatCardType } from '@/lib/cards-data';
import {
  Flame,
  Zap,
  Moon,
  Snowflake,
  Shield,
  Layers,
  Sparkles,
  Swords,
  Maximize2,
  X,
  ChevronLeft,
  Crosshair,
  Info,
  Radio,
} from 'lucide-react';

interface LeftCardInspectorProps {
  card: CardInstance | null;
  onClear: () => void;
  onToggleFold: () => void;
  onOpenFullModal?: () => void;
  onActivateAbility?: (cardInstanceId: string) => void;
  onAttackClick?: (cardInstanceId: string) => void;
  canActivateAbility?: boolean;
  canAttack?: boolean;
}

export const LeftCardInspector: React.FC<LeftCardInspectorProps> = ({
  card,
  onClear,
  onToggleFold,
  onOpenFullModal,
  onActivateAbility,
  onAttackClick,
  canActivateAbility = false,
  canAttack = false,
}) => {
  const cardDef = card ? findCardByNumberOrId(card.cardNumber || card.cardId) : null;
  const cardImgSrc = card?.imageUrl || (card ? `/cards/${card.cardNumber}.png` : '');

  const getElementBadge = (attr?: ElementAttribute, attrName?: string) => {
    if (attrName === '空' || attr === ElementAttribute.VOID || (attr as any) === 'VOID') {
      return (
        <span className="px-1.5 py-0.5 rounded bg-cyan-400/20 text-cyan-300 border border-cyan-400/40 text-[10px] flex items-center gap-1 font-bold">
          <Sparkles className="w-3 h-3 text-cyan-300" /> 空属性
        </span>
      );
    }
    switch (attr) {
      case ElementAttribute.FIRE:
        return (
          <span className="px-1.5 py-0.5 rounded bg-red-600/20 text-red-400 border border-red-500/40 text-[10px] flex items-center gap-1 font-bold">
            <Flame className="w-3 h-3 text-red-500" /> 火属性
          </span>
        );
      case ElementAttribute.LIGHTNING:
        return (
          <span className="px-1.5 py-0.5 rounded bg-yellow-400/20 text-yellow-300 border border-yellow-400/40 text-[10px] flex items-center gap-1 font-bold">
            <Zap className="w-3 h-3 text-yellow-400" /> 雷属性
          </span>
        );
      case ElementAttribute.DARK:
        return (
          <span className="px-1.5 py-0.5 rounded bg-purple-600/20 text-purple-300 border border-purple-500/40 text-[10px] flex items-center gap-1 font-bold">
            <Moon className="w-3 h-3 text-purple-400" /> 暗属性
          </span>
        );
      case ElementAttribute.ICE:
        return (
          <span className="px-1.5 py-0.5 rounded bg-cyan-400/20 text-cyan-300 border border-cyan-400/40 text-[10px] flex items-center gap-1 font-bold">
            <Snowflake className="w-3 h-3 text-cyan-300" /> 冰属性
          </span>
        );
      case ElementAttribute.PHYSICAL:
        return (
          <span className="px-1.5 py-0.5 rounded bg-neutral-700/40 text-neutral-300 border border-neutral-600 text-[10px] flex items-center gap-1 font-bold">
            <Shield className="w-3 h-3 text-neutral-400" /> 物理属性
          </span>
        );
      default:
        return null;
    }
  };

  const totalPP = card && cardDef ? (cardDef.basePP ?? 0) + (card.tempPPBonus ?? 0) : 0;
  const totalDP = card && cardDef ? (cardDef.baseDP ?? 0) + (card.tempDPBonus ?? 0) : 0;

  return (
    <aside className="w-64 sm:w-72 lg:w-80 h-full border-r border-terminalBorder bg-surface/95 flex flex-col justify-between p-3.5 backdrop-blur-md z-30 font-mono select-none overflow-y-auto flex-shrink-0 animate-in slide-in-from-left duration-200">
      {/* 头部：标题与快速收起 / 清除按钮 */}
      <div className="flex items-center justify-between border-b border-terminalBorder/60 pb-2.5 mb-2">
        <div className="flex items-center gap-2">
          <Crosshair className="w-4 h-4 text-terminalCyan animate-pulse" />
          <div>
            <div className="text-[9px] text-neutral-400 uppercase tracking-widest leading-none">
              TACTICAL INSPECTOR
            </div>
            <div className="text-xs font-bold text-white tracking-wide mt-0.5">
              全息卡牌检视台
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1">
          {card && onOpenFullModal && (
            <button
              onClick={onOpenFullModal}
              className="p-1 rounded hover:bg-neutral-800 text-neutral-400 hover:text-terminalCyan transition-colors"
              title="放大大图 [F]"
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
          )}

          {card && (
            <button
              onClick={onClear}
              className="p-1 rounded hover:bg-neutral-800 text-neutral-400 hover:text-white transition-colors"
              title="清空检视卡牌 [Esc]"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}

          <button
            onClick={onToggleFold}
            className="p-1 rounded hover:bg-neutral-800 text-neutral-400 hover:text-white transition-colors"
            title="收起左侧检视台"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 主体内容 */}
      {card ? (
        <div className="flex flex-col gap-3 flex-1 overflow-y-auto pr-0.5">
          {/* 超清大卡图与立绘展示 */}
          <div className="relative w-full aspect-[63/88] rounded-xl overflow-hidden border border-terminalBorder/80 bg-neutral-950 shadow-xl group">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={cardImgSrc}
              alt={card.cardNumber}
              className="w-full h-full object-fill block transition-transform duration-300 group-hover:scale-105"
            />

            {/* 费用徽章 */}
            {cardDef && cardDef.cost !== undefined && (
              <div className="absolute top-2 left-2 px-2 py-0.5 rounded-full bg-neutral-950/90 text-terminalCyan border border-terminalCyan/60 font-black text-xs shadow-lg">
                {cardDef.cost} 费
              </div>
            )}

            {/* 叠层指示 */}
            {card.underneathCardIds && card.underneathCardIds.length > 0 && (
              <div className="absolute top-2 right-2 px-1.5 py-0.5 rounded bg-purple-950/90 border border-purple-500/80 text-purple-300 text-[10px] font-mono flex items-center gap-0.5 shadow">
                <Layers className="w-3 h-3" />
                <span>+{card.underneathCardIds.length} 叠层</span>
              </div>
            )}

            {/* PP / DP 战斗数值浮动条 */}
            {cardDef?.cardType === CardType.ROLE && (
              <div className="absolute bottom-2 inset-x-2 flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-black/85 border border-terminalBorder/80 text-xs backdrop-blur-sm shadow-md">
                <div className="flex items-center gap-1 text-terminalCyan font-black">
                  <Swords className="w-3.5 h-3.5" />
                  <span>PP {totalPP}</span>
                  {card.tempPPBonus ? (
                    <span className="text-emerald-400 text-[10px] font-bold">
                      (+{card.tempPPBonus})
                    </span>
                  ) : null}
                </div>

                <div className="flex items-center gap-1 text-terminalGold font-black">
                  <Shield className="w-3.5 h-3.5" />
                  <span>DP {totalDP}</span>
                  {card.tempDPBonus ? (
                    <span className="text-emerald-400 text-[10px] font-bold">
                      (+{card.tempDPBonus})
                    </span>
                  ) : null}
                </div>
              </div>
            )}
          </div>

          {/* 卡名与属性特征 */}
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-terminalCyan font-bold">
                {card.cardNumber}
              </span>
              <span className="text-[10px] text-neutral-400">
                {card.zone ? `区域: ${card.zone}` : ''}
              </span>
            </div>

            <h3 className="font-bold text-white text-base tracking-wide leading-tight">
              {cardDef?.name || card.cardNumber}
            </h3>

            <div className="flex items-center gap-1.5 flex-wrap mt-1">
              <span className="px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-300 text-[10px]">
                {formatCardType(cardDef?.cardType, cardDef?.isInstant)}
              </span>
              {getElementBadge(cardDef?.attribute, cardDef?.attributeName)}
              {cardDef?.traits?.map((t, idx) => (
                <span
                  key={idx}
                  className="px-1.5 py-0.5 rounded bg-neutral-800/80 text-neutral-400 text-[10px]"
                >
                  #{t}
                </span>
              ))}
            </div>
          </div>

          {/* 规则效果文本 */}
          <div className="flex-1 min-h-[90px] max-h-48 overflow-y-auto rounded-lg bg-neutral-900/90 border border-terminalBorder/50 p-2.5 text-xs text-neutral-300 leading-relaxed font-sans">
            {cardDef?.rulesText ? (
              <p className="whitespace-pre-line leading-relaxed">{cardDef.rulesText}</p>
            ) : (
              <p className="text-neutral-500 italic">暂无特殊规则效果描述</p>
            )}
          </div>

          {/* 战场角色专属快捷交互按钮 */}
          {(canActivateAbility || canAttack) && (
            <div className="flex items-center gap-2 pt-1 border-t border-terminalBorder/40">
              {canActivateAbility && onActivateAbility && (
                <button
                  type="button"
                  onClick={() => onActivateAbility(card.instanceId)}
                  className="flex-1 py-1.5 rounded-lg bg-terminalCyan text-neutral-950 font-bold text-xs flex items-center justify-center gap-1 hover:brightness-110 active:scale-95 shadow animate-pulse"
                >
                  <Zap className="w-3.5 h-3.5 fill-current" />
                  <span>发动【起】</span>
                </button>
              )}

              {canAttack && onAttackClick && (
                <button
                  type="button"
                  onClick={() => onAttackClick(card.instanceId)}
                  className="flex-1 py-1.5 rounded-lg bg-erosionRed hover:bg-erosionRed/90 text-white font-bold text-xs flex items-center justify-center gap-1 active:scale-95 shadow"
                >
                  <Swords className="w-3.5 h-3.5" />
                  <span>发起进攻</span>
                </button>
              )}
            </div>
          )}
        </div>
      ) : (
        /* 无选中卡牌时的全息待机扫描状态 */
        <div className="flex-1 flex flex-col items-center justify-center text-center p-4 text-neutral-500 gap-3">
          <div className="relative w-20 h-20 rounded-full border border-dashed border-terminalBorder flex items-center justify-center animate-[spin_10s_linear_infinite]">
            <Radio className="w-8 h-8 text-terminalCyan/40" />
          </div>
          <div>
            <div className="text-xs font-bold text-neutral-300 tracking-wider">
              全息战术雷达待命中
            </div>
            <div className="text-[11px] text-neutral-500 mt-1 leading-normal font-sans">
              鼠标悬停或点击战场/手牌中的任意卡牌，即刻进行全景战术属性解析
            </div>
          </div>
        </div>
      )}

      {/* 底部辅助快捷键提示 */}
      <div className="pt-2 border-t border-terminalBorder/40 text-[10px] text-neutral-500 text-center flex items-center justify-between">
        <span className="flex items-center gap-1">
          <kbd className="px-1 py-0.5 rounded bg-neutral-800 border border-neutral-700 text-white font-mono text-[9px]">
            F
          </kbd>
          <span>放大</span>
        </span>
        <span className="flex items-center gap-1">
          <kbd className="px-1 py-0.5 rounded bg-neutral-800 border border-neutral-700 text-white font-mono text-[9px]">
            Esc
          </kbd>
          <span>清除</span>
        </span>
        <span className="flex items-center gap-1">
          <kbd className="px-1 py-0.5 rounded bg-neutral-800 border border-neutral-700 text-white font-mono text-[9px]">
            Space
          </kbd>
          <span>时点</span>
        </span>
      </div>
    </aside>
  );
};

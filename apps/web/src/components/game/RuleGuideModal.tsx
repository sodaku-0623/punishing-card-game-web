'use client';

import React, { useState, useEffect } from 'react';
import {
  X,
  BookOpen,
  Swords,
  RotateCcw,
  Flame,
  AlertTriangle,
} from 'lucide-react';
import { Button } from '@/components/ui';
import {
  GUIDE_CARD_EXAMPLES,
  GUIDE_DIAGRAMS,
  GuideCardExampleStrip,
  GuideDiagramFigure,
  GuideImagePreviewDialog,
  type GuidePreviewMedia,
} from '@/components/guide/GuideMedia';

interface RuleGuideModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type GuideTab =
  | 'overview'
  | 'card-types'
  | 'card-info'
  | 'field'
  | 'deck-building'
  | 'setup'
  | 'turn-flow'
  | 'combat-flow'
  | 'signal-orbs'
  | 'deck-refresh'
  | 'keywords';

const TABS: { id: GuideTab; num: string; label: string }[] = [
  { id: 'overview', num: '01', label: '游戏玩法与胜负' },
  { id: 'card-types', num: '02', label: '卡牌种类与使用' },
  { id: 'card-info', num: '03', label: '卡面信息详解' },
  { id: 'field', num: '04', label: '场地七大区域' },
  { id: 'deck-building', num: '05', label: '牌组构筑规则' },
  { id: 'setup', num: '06', label: '开局准备与调度' },
  { id: 'turn-flow', num: '07', label: '回合四大流程' },
  { id: 'combat-flow', num: '08', label: '战斗全流程' },
  { id: 'signal-orbs', num: '09', label: '信号球三消系统' },
  { id: 'deck-refresh', num: '10', label: '牌组更新规则' },
  { id: 'keywords', num: '11', label: '官方关键词图鉴' },
];

export const RuleGuideModal: React.FC<RuleGuideModalProps> = ({ isOpen, onClose }) => {
  const [activeTab, setActiveTab] = useState<GuideTab>('overview');
  const [previewMedia, setPreviewMedia] = useState<GuidePreviewMedia | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (previewMedia) {
          setPreviewMedia(null);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose, previewMedia]);

  if (!isOpen) return null;

  return (
    <>
    <div
      role="dialog"
      aria-modal="true"
      aria-label="战双帕弥什卡牌对战官方规则指南"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-ink-950/85 backdrop-blur-md animate-in fade-in duration-fast select-none"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-5xl h-[88vh] max-h-[900px] bg-ink-900 border border-line-strong clip-corner-md shadow-overlay flex flex-col overflow-hidden animate-in zoom-in-95 duration-fast"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="h-[2px] w-full bg-crimson-500 shrink-0" />

        {/* 顶部标题栏 */}
        <div className="flex items-center justify-between px-6 py-4 bg-ink-950 border-b border-line flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-teal-400/10 border border-teal-400/40 text-teal-400">
              <BookOpen className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-title-sm font-bold text-fg tracking-tight flex items-center gap-2 flex-wrap">
                <span>战双帕弥什 卡牌对战 · 官方作战指南</span>
                <span className="text-hud font-display uppercase tracking-widest px-2 py-0.5 bg-teal-400/15 text-teal-400 border border-teal-400/40">
                  OFFICIAL MANUAL
                </span>
              </h2>
              <p className="text-hud text-fg-muted font-display uppercase tracking-wider mt-0.5">
                PUNISHING CARD GAME · 基础规则与作战条令图鉴
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="关闭指南"
            className="p-1.5 border border-line text-fg-muted hover:text-fg hover:border-teal-400 transition-colors cursor-pointer"
            title="关闭指南 [Esc]"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 主体左右分栏 */}
        <div className="flex flex-1 min-h-0 overflow-hidden flex-col md:flex-row">
          {/* 左侧目录导航 */}
          <aside className="md:w-56 border-b md:border-b-0 md:border-r border-line bg-ink-950/70 p-2.5 flex md:flex-col gap-1 overflow-x-auto md:overflow-y-auto flex-shrink-0 text-caption">
            <div className="hidden md:block text-hud font-display uppercase text-fg-muted font-semibold px-2 py-1 tracking-widest">
              DIRECTORY
            </div>
            {TABS.map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2.5 px-3 py-2 text-left transition-colors duration-fast shrink-0 md:w-full cursor-pointer border-l-2 ${
                    isActive
                      ? 'bg-ink-850 text-fg font-semibold border-crimson-500'
                      : 'text-fg-muted hover:text-fg hover:bg-ink-900 border-transparent'
                  }`}
                >
                  <span className={`font-num text-hud ${isActive ? 'text-crimson-400' : 'text-fg-disabled'}`}>
                    {tab.num}
                  </span>
                  <span className="truncate">{tab.label}</span>
                </button>
              );
            })}
          </aside>

          {/* 右侧内容区 */}
          <main className="flex-1 overflow-y-auto p-6 space-y-6 text-fg-secondary text-body-sm leading-relaxed">
            {/* 1. 游戏玩法与胜负 */}
            {activeTab === 'overview' && (
              <div className="space-y-5 animate-in fade-in duration-fast">
                <div className="border-b border-line pb-3">
                  <h3 className="text-title-sm font-bold text-fg flex items-center gap-2">
                    <span className="text-crimson-400 font-num">01.</span> 游戏玩法与胜负判定
                  </h3>
                  <p className="text-hud text-fg-muted font-display uppercase tracking-widest mt-0.5">
                    VICTORY &amp; DEFEAT CONDITIONS
                  </p>
                </div>

                <div className="p-4 border border-crimson-500/40 bg-crimson-500/5 space-y-2">
                  <div className="font-semibold text-fg flex items-center gap-2">
                    <Flame className="w-4 h-4 text-crimson-400" />
                    <span>帕弥什病毒侵蚀胜负规则</span>
                  </div>
                  <p className="text-body-sm text-fg-secondary">
                    在对战过程中，双方通过卡牌战斗，使对手的帕弥什病毒侵蚀计数从 <strong className="text-fg font-num">0</strong> 开始增加。
                    当一方指挥官的侵蚀计数达到 <strong className="text-crimson-400 font-num">7</strong> 时，其被完全侵蚀，在对战中立刻落败。
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-caption">
                  <div className="p-4 border border-line bg-ink-950 space-y-1.5">
                    <div className="text-gold-300 font-semibold flex items-center gap-1.5">
                      <Swords className="w-4 h-4" />
                      <span>直接伤害侵蚀</span>
                    </div>
                    <p className="text-fg-muted">
                      攻击对方玩家且对方未进行阻挡时，根据攻击角色的 DP 数值，对手依次执行相同次数的【伤害充能】，每次充能完成后侵蚀计数 +1。
                    </p>
                  </div>
                  <div className="p-4 border border-line bg-ink-950 space-y-1.5">
                    <div className="text-teal-400 font-semibold flex items-center gap-1.5">
                      <RotateCcw className="w-4 h-4" />
                      <span>牌组更新惩罚</span>
                    </div>
                    <p className="text-fg-muted">
                      当牌组抽空时，需将己方墓地所有卡牌洗切作为新牌组（牌组更新），更新完毕后侵蚀计数惩罚性 +1。
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* 2. 卡牌种类与使用 */}
            {activeTab === 'card-types' && (
              <div className="space-y-5 animate-in fade-in duration-fast">
                <div className="border-b border-line pb-3">
                  <h3 className="text-title-sm font-bold text-fg flex items-center gap-2">
                    <span className="text-crimson-400 font-num">02.</span> 卡牌三大种类
                  </h3>
                  <p className="text-hud text-fg-muted font-display uppercase tracking-widest mt-0.5">
                    THREE CARD CATEGORIES &amp; MECHANICS
                  </p>
                </div>

                <p className="text-caption text-fg-muted">
                  本游戏中，卡牌分为【角色牌】、【道具牌】与【战术牌】三种类型：
                </p>

                <div className="p-4 border border-line bg-ink-950 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="font-semibold text-fg flex items-center gap-2">
                      <span className="px-2 py-0.5 bg-teal-400/15 text-teal-400 text-hud border border-teal-400/40 font-display">
                        ROLE
                      </span>
                      <span>角色牌</span>
                    </div>
                    <span className="text-hud text-fg-muted">核心战力 · 占位战斗</span>
                  </div>
                  <p className="text-caption text-fg-secondary">
                    出场到战场进行战斗的卡牌。包含 PP（攻击力）、DP（伤害值）、属性、费用以及特征。
                  </p>
                  <div className="bg-ink-900 p-3 border border-line text-caption space-y-2">
                    <div className="text-gold-300 font-semibold">登场方式：</div>
                    <ul className="list-disc list-inside space-y-1 text-fg-muted">
                      <li>
                        <strong className="text-fg">正规使用：</strong>放置到己方战场空余的卡位（战场共 5 个卡位）。
                      </li>
                      <li>
                        <strong className="text-fg">升变登场：</strong>持有《升变》能力的角色牌，在满足《升变条件》与属性要求时，支付《升变代价》，重叠在指定的对象上方。
                        <span className="text-teal-400 font-medium">
                          作为升变对象的卡牌原有状态会被刷新，升变角色以正面竖直状态出场。
                        </span>
                        （离开战场时，下方所有垫牌进入墓地）。
                      </li>
                    </ul>
                  </div>
                  <GuideCardExampleStrip examples={GUIDE_CARD_EXAMPLES.role} onPreview={setPreviewMedia} />
                </div>

                <div className="p-4 border border-line bg-ink-950 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="font-semibold text-fg flex items-center gap-2">
                      <span className="px-2 py-0.5 bg-gold-300/15 text-gold-300 text-hud border border-gold-300/40 font-display">
                        ITEM
                      </span>
                      <span>道具牌 (装备牌 &amp; 辅助机牌)</span>
                    </div>
                    <span className="text-hud text-fg-muted">持续增益 · 辅助驻留</span>
                  </div>
                  <p className="text-caption text-fg-secondary">
                    存在于战场，为战场的角色提供持续性增益的卡牌，不能直接进行战斗。分为两类：
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-caption">
                    <div className="p-3 bg-ink-900 border border-line space-y-1">
                      <div className="text-gold-300 font-semibold">1. 装备牌 (Equipment)</div>
                      <p className="text-fg-muted">
                        强化特定角色的道具牌。规则上每张角色只能装备 1 张装备牌。离开战场时装备随之送入墓地。
                      </p>
                    </div>
                    <div className="p-3 bg-ink-900 border border-line space-y-1">
                      <div className="text-teal-400 font-semibold">2. 辅助机牌 (Assist)</div>
                      <p className="text-fg-muted">
                        每名玩家战场只能存在 1 张辅助机牌。出场新辅助机时必须将原有辅助机送入墓地。
                      </p>
                    </div>
                  </div>
                  <GuideCardExampleStrip examples={GUIDE_CARD_EXAMPLES.item} onPreview={setPreviewMedia} />
                </div>

                <div className="p-4 border border-line bg-ink-950 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="font-semibold text-fg flex items-center gap-2">
                      <span className="px-2 py-0.5 bg-steel-700/30 text-steel-300 text-hud border border-steel-500/50 font-display">
                        TACTICS
                      </span>
                      <span>战术牌 (普通战术 &amp; 瞬时战术)</span>
                    </div>
                    <span className="text-hud text-fg-muted">即时结算 · 战局奇策</span>
                  </div>
                  <p className="text-caption text-fg-secondary">
                    直接从手牌打出、进入处理区即时处理的卡牌，能力处理完毕后送入墓地。
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-caption">
                    <div className="p-3 bg-ink-900 border border-line space-y-1">
                      <div className="text-fg font-semibold">普通战术牌</div>
                      <p className="text-fg-muted">只能在自己回合的主要阶段（空闲时点）使用。</p>
                    </div>
                    <div className="p-3 bg-ink-900 border border-line space-y-1">
                      <div className="text-teal-400 font-semibold">瞬时战术牌 (Instant)</div>
                      <p className="text-fg-muted">仅在战斗流程的自由时点步骤（阻挡前后）以及回合结束阶段使用。</p>
                    </div>
                  </div>
                  <GuideCardExampleStrip examples={GUIDE_CARD_EXAMPLES.tactics} onPreview={setPreviewMedia} />
                </div>
              </div>
            )}

            {/* 3. 卡牌信息详解 */}
            {activeTab === 'card-info' && (
              <div className="space-y-5 animate-in fade-in duration-fast">
                <div className="border-b border-line pb-3">
                  <h3 className="text-title-sm font-bold text-fg flex items-center gap-2">
                    <span className="text-crimson-400 font-num">03.</span> 卡牌信息结构详解
                  </h3>
                  <p className="text-hud text-fg-muted font-display uppercase tracking-widest mt-0.5">
                    CARD STRUCTURE &amp; STATS
                  </p>
                </div>

                <GuideDiagramFigure diagram={GUIDE_DIAGRAMS.cardStructure} onPreview={setPreviewMedia} />

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-caption">
                  <div className="p-3.5 bg-ink-950 border border-line">
                    <span className="text-gold-300 font-semibold">1. 费用 (左上角)</span>
                    <p className="text-fg-muted mt-1">使用卡牌需要支付的明费/暗费总额。</p>
                  </div>
                  <div className="p-3.5 bg-ink-950 border border-line">
                    <span className="text-teal-400 font-semibold">2. 属性 (右上角)</span>
                    <p className="text-fg-muted mt-1">
                      卡牌的元素属性（火/暗/物理/雷/冰/空）。费用区必须至少存在 1 张对应属性的明费方可使用。
                    </p>
                  </div>
                  <div className="p-3.5 bg-ink-950 border border-line">
                    <span className="text-fg font-semibold">3. PP (战斗力/攻击力)</span>
                    <p className="text-fg-muted mt-1">
                      战斗时与对方角色比拼数值。攻方 PP ≥ 防守方 PP 时破坏对方角色。
                    </p>
                  </div>
                  <div className="p-3.5 bg-ink-950 border border-line">
                    <span className="text-crimson-400 font-semibold">4. DP (伤害值)</span>
                    <p className="text-fg-muted mt-1">
                      攻击对方玩家成功时给予的伤害次数（触发相同次数的伤害充能，侵蚀 +1）。
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* 4. 场地七大区域 */}
            {activeTab === 'field' && (
              <div className="space-y-5 animate-in fade-in duration-fast">
                <div className="border-b border-line pb-3">
                  <h3 className="text-title-sm font-bold text-fg flex items-center gap-2">
                    <span className="text-crimson-400 font-num">04.</span> 官方场地七大区域
                  </h3>
                  <p className="text-hud text-fg-muted font-display uppercase tracking-widest mt-0.5">
                    SEVEN GAME ZONES
                  </p>
                </div>

                <GuideDiagramFigure diagram={GUIDE_DIAGRAMS.officialPlaymat} onPreview={setPreviewMedia} />

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-caption">
                  <div className="p-3.5 bg-ink-950 border border-line">
                    <span className="text-teal-400 font-semibold">01 · 战场区 (Battlefield)</span>
                    <p className="text-fg-muted mt-1">角色牌和道具牌出场及战斗区域，每位指挥官拥有 5 个卡位。</p>
                  </div>
                  <div className="p-3.5 bg-ink-950 border border-line">
                    <span className="text-gold-300 font-semibold">02 · 牌组 (Deck)</span>
                    <p className="text-fg-muted mt-1">放置牌组的区域，必须由刚好 50 张卡牌构成。</p>
                  </div>
                  <div className="p-3.5 bg-ink-950 border border-line">
                    <span className="text-crimson-400 font-semibold">03 · 侵蚀计数区 (Erosion)</span>
                    <p className="text-fg-muted mt-1">记录自身所受侵蚀计数的刻度（0~7）。达到 7 即败北。</p>
                  </div>
                  <div className="p-3.5 bg-ink-950 border border-line">
                    <span className="text-fg font-semibold">04 · 墓地 (Graveyard)</span>
                    <p className="text-fg-muted mt-1">放置已使用、被战斗破坏或离开战场的卡牌。</p>
                  </div>
                  <div className="p-3.5 bg-ink-950 border border-teal-400/40 col-span-1 md:col-span-2">
                    <div className="text-teal-400 font-semibold flex items-center justify-between">
                      <span>05 · 费用区 (Cost Zone) · 明费与暗费（上限 10 张）</span>
                      <span className="text-hud text-gold-300 bg-gold-300/10 px-2 py-0.5 border border-gold-300/30">
                        核心规则
                      </span>
                    </div>
                    <ul className="list-disc list-inside space-y-1 text-fg-muted mt-1.5 leading-relaxed">
                      <li>
                        <strong className="text-fg">明费：</strong>正面表示的卡牌。支付费用时将竖直状态的明费横置。
                      </li>
                      <li>
                        <strong className="text-fg">暗费：</strong>背面竖直表示的卡牌（伤害充能产生）。支付费用时移至墓地。
                        <span className="text-gold-300">回合玩家未使用的暗费在回合结束阶段全部送入墓地。</span>
                      </li>
                      <li>
                        <strong className="text-teal-400">10 张上限：</strong>费用区满 10 张后，后续进入费用区的卡牌改为送入墓地。
                      </li>
                    </ul>
                  </div>
                  <div className="p-3.5 bg-ink-950 border border-line">
                    <span className="text-gold-300 font-semibold">06 · 信号球区 (Signal Orb Zone)</span>
                    <p className="text-fg-muted mt-1">放置红、蓝、黄信号球的区域，数量无上限，卡牌顺序不可随意变动。</p>
                  </div>
                  <div className="p-3.5 bg-ink-950 border border-line">
                    <span className="text-steel-300 font-semibold">07 · 处理区 (Processing Zone)</span>
                    <p className="text-fg-muted mt-1">能力处理、攻击充能及伤害充能时卡牌临时公开放置该区域。</p>
                  </div>
                </div>
              </div>
            )}

            {/* 5. 牌组构筑规则 */}
            {activeTab === 'deck-building' && (
              <div className="space-y-5 animate-in fade-in duration-fast">
                <div className="border-b border-line pb-3">
                  <h3 className="text-title-sm font-bold text-fg flex items-center gap-2">
                    <span className="text-crimson-400 font-num">05.</span> 牌组构筑三大铁律
                  </h3>
                  <p className="text-hud text-fg-muted font-display uppercase tracking-widest mt-0.5">
                    DECK BUILDING RESTRICTIONS
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="p-4 border border-teal-400/40 bg-ink-950 text-center space-y-1">
                    <div className="text-title font-bold text-teal-400 font-num tabular-nums">50 张</div>
                    <div className="font-semibold text-fg text-caption">牌组固定总张数</div>
                    <p className="text-hud text-fg-muted">牌组必须刚好由 50 张卡牌构成，不能多也不能少。</p>
                  </div>
                  <div className="p-4 border border-gold-300/40 bg-ink-950 text-center space-y-1">
                    <div className="text-title font-bold text-gold-300 font-num tabular-nums">≤ 4 张</div>
                    <div className="font-semibold text-fg text-caption">同名/同卡号上限</div>
                    <p className="text-hud text-fg-muted">相同卡牌编号的卡牌最多投入 4 张（含异画版本）。</p>
                  </div>
                  <div className="p-4 border border-crimson-500/40 bg-ink-950 text-center space-y-1">
                    <div className="text-title font-bold text-crimson-400 font-num tabular-nums">4+4+4</div>
                    <div className="font-semibold text-fg text-caption">信号球必选投入</div>
                    <p className="text-hud text-fg-muted">必须投入 4 张红球、4 张蓝球以及 4 张黄球（共 12 张）。</p>
                  </div>
                </div>
              </div>
            )}

            {/* 6. 开局准备与调度 */}
            {activeTab === 'setup' && (
              <div className="space-y-5 animate-in fade-in duration-fast">
                <div className="border-b border-line pb-3">
                  <h3 className="text-title-sm font-bold text-fg flex items-center gap-2">
                    <span className="text-crimson-400 font-num">06.</span> 开局准备与手牌调度
                  </h3>
                  <p className="text-hud text-fg-muted font-display uppercase tracking-widest mt-0.5">
                    PREPARATION &amp; MULLIGAN
                  </p>
                </div>

                <div className="space-y-3 text-caption">
                  {[
                    { num: '1', title: '初始化侵蚀与洗牌', desc: '双方充分洗切牌组，并将各自的侵蚀计数设置为 0。', accent: false },
                    { num: '2', title: '确定先后手', desc: '系统随机掷点决定先后手顺序。', accent: false },
                    { num: '3', title: '手牌调度机会 (5.2.1.e)', desc: '双方玩家各自抽取 4 张手牌。各自仅有 1 次机会选择任意张数手牌放置到牌组底，从牌组顶抽取相同数量的牌后洗切牌组。', accent: true },
                    { num: '4', title: '填充起始明费', desc: '在手牌调度和洗切完成之后，双方将牌组顶 2 张牌正面竖直放置到费用区作为初始明费。', accent: false },
                  ].map((step) => (
                    <div
                      key={step.num}
                      className={`flex gap-3 items-start p-3.5 border ${
                        step.accent ? 'border-gold-300/40 bg-gold-300/5' : 'border-line bg-ink-950'
                      }`}
                    >
                      <span className={`w-5 h-5 border flex items-center justify-center flex-shrink-0 font-num font-bold text-hud ${
                        step.accent ? 'border-gold-300/60 text-gold-300 bg-gold-300/10' : 'border-teal-400/50 text-teal-400 bg-teal-400/10'
                      }`}>
                        {step.num}
                      </span>
                      <div>
                        <strong className={step.accent ? 'text-gold-300' : 'text-fg'}>{step.title}：</strong>
                        <span className="text-fg-muted">{step.desc}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 7. 回合四大流程 */}
            {activeTab === 'turn-flow' && (
              <div className="space-y-5 animate-in fade-in duration-fast">
                <div className="border-b border-line pb-3">
                  <h3 className="text-title-sm font-bold text-fg flex items-center gap-2">
                    <span className="text-crimson-400 font-num">07.</span> 回合的四大流程
                  </h3>
                  <p className="text-hud text-fg-muted font-display uppercase tracking-widest mt-0.5">
                    FOUR PHASES OF A TURN
                  </p>
                </div>

                <div className="space-y-3 text-caption">
                  <div className="p-3.5 bg-ink-950 border border-line">
                    <div className="font-semibold text-teal-400 text-body-sm">阶段 1 · 竖直阶段 (Upkeep Phase)</div>
                    <p className="text-fg-muted mt-1">回合玩家将自己战场和费用区的所有横置状态卡牌转为竖直状态。</p>
                  </div>

                  <div className="p-3.5 bg-ink-950 border border-line space-y-1.5">
                    <div className="font-semibold text-gold-300 text-body-sm">阶段 2 · 抽牌填充阶段 (Draw &amp; Charge)</div>
                    <ul className="list-disc list-inside text-fg-muted space-y-1">
                      <li>
                        <strong className="text-fg">抽牌：</strong>从牌组顶抽 2 张牌（<span className="text-gold-300">先攻第 1 回合只抽 1 张</span>）。
                      </li>
                      <li>
                        <strong className="text-fg">填充：</strong>可将最多 1 张手牌正面竖直放置到费用区作为明费。
                      </li>
                    </ul>
                  </div>

                  <div className="p-3.5 bg-ink-950 border border-teal-400/40 space-y-2">
                    <div className="font-semibold text-fg text-body-sm">阶段 3 · 主要阶段 (Main Phase)</div>
                    <ol className="list-decimal list-inside space-y-1 text-fg-muted">
                      <li>使用手牌卡牌（需满足属性并支付费用）。</li>
                      <li>发动战场卡牌的【起】动能力（支付相应代价）。</li>
                      <li>将战场未装备的装备牌装备到角色下方。</li>
                      <li>消除 3 张相邻或同色的信号球并抽 1 张牌。</li>
                      <li>宣告可以攻击的角色进行攻击（进入战斗流程）。</li>
                      <li>宣言回合结束，进入结束阶段。</li>
                    </ol>
                  </div>

                  <div className="p-3.5 bg-ink-950 border border-line space-y-1.5">
                    <div className="font-semibold text-steel-300 text-body-sm">阶段 4 · 结束阶段 (End Phase)</div>
                    <ol className="list-decimal list-inside space-y-1 text-fg-muted">
                      <li>双方轮流使用瞬时战术/瞬时能力（回合玩家优先）。</li>
                      <li>处理结束阶段效果。</li>
                      <li>手牌上限检查：手牌 &gt; 7 张时弃置至 7 张。</li>
                      <li><span className="text-gold-300 font-medium">清理暗费：</span>将回合玩家费用区的所有暗费送入墓地。</li>
                    </ol>
                  </div>
                </div>
              </div>
            )}

            {/* 8. 战斗全流程 */}
            {activeTab === 'combat-flow' && (
              <div className="space-y-5 animate-in fade-in duration-fast">
                <div className="border-b border-line pb-3">
                  <h3 className="text-title-sm font-bold text-fg flex items-center gap-2">
                    <span className="text-crimson-400 font-num">08.</span> 战斗全流程 (五步骤)
                  </h3>
                  <p className="text-hud text-fg-muted font-display uppercase tracking-widest mt-0.5">
                    COMBAT STEP-BY-STEP FLOW
                  </p>
                </div>

                <div className="space-y-3 text-caption">
                  <div className="p-3.5 bg-ink-950 border border-line">
                    <div className="font-semibold text-teal-400 text-body-sm">1. 攻击宣言步骤</div>
                    <p className="text-fg-muted mt-1">
                      将战场 1 张竖直状态的角色横置并选择攻击对象（对方玩家或对方横置的角色）。出场当回合不能攻击（除非持有【速攻】或【突进】）。
                    </p>
                  </div>
                  <div className="p-3.5 bg-ink-950 border border-line">
                    <div className="font-semibold text-gold-300 text-body-sm">2. 自由时点与阻挡步骤</div>
                    <p className="text-fg-muted mt-1">
                      由回合外玩家开始轮流使用瞬时能力。随后，被攻击玩家可以横置 1 张竖直状态的角色进行阻挡，将攻击对象转移给阻挡者。
                    </p>
                  </div>
                  <div className="p-3.5 bg-ink-950 border border-teal-400/40">
                    <div className="font-semibold text-teal-400 text-body-sm">3. 充能步骤 (Attack Charge)</div>
                    <p className="text-fg-muted mt-1">攻击角色根据充能次数（默认 1 次）翻开牌组顶放入处理区：</p>
                    <ul className="list-disc list-inside mt-1 text-fg-muted">
                      <li><strong className="text-fg">非信号球牌：</strong>直接加入手牌。</li>
                      <li><strong className="text-teal-400">信号球牌：</strong>触发【充能自】效果并放置到信号球区。</li>
                    </ul>
                  </div>
                  <div className="p-3.5 bg-ink-950 border border-line">
                    <div className="font-semibold text-fg text-body-sm">4. 角色战斗步骤 (PP 比较)</div>
                    <p className="text-fg-muted mt-1">
                      比较双方角色 PP 值。攻方 PP ≥ 防守方 PP 时，被攻击角色被战斗破坏送入墓地；否则无事发生。
                    </p>
                  </div>
                  <div className="p-3.5 bg-ink-950 border border-crimson-500/40">
                    <div className="font-semibold text-crimson-400 text-body-sm">5. 伤害步骤 (Damage Charge)</div>
                    <p className="text-fg-muted mt-1">
                      攻击玩家且未被阻挡时，根据攻方 DP 数值执行相同次数的【伤害充能】，每次充能完成受伤玩家侵蚀计数 +1，翻开卡牌作为暗费置入费用区（若为信号球则先触发【充能自】）。
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* 9. 信号球三消系统 */}
            {activeTab === 'signal-orbs' && (
              <div className="space-y-5 animate-in fade-in duration-fast">
                <div className="border-b border-line pb-3">
                  <h3 className="text-title-sm font-bold text-fg flex items-center gap-2">
                    <span className="text-crimson-400 font-num">09.</span> 信号球系统与三消机制
                  </h3>
                  <p className="text-hud text-fg-muted font-display uppercase tracking-widest mt-0.5">
                    SIGNAL ORBS &amp; TRIPLE ELIMINATION
                  </p>
                </div>

                <div className="grid grid-cols-3 gap-3 text-center">
                  <div className="p-3 bg-ink-950 border border-orb-red/50 space-y-1">
                    <div className="text-orb-red font-semibold text-caption">信号球 · 红</div>
                    <p className="text-hud text-fg-muted">专精于爆发与攻击强化</p>
                  </div>
                  <div className="p-3 bg-ink-950 border border-orb-blue/50 space-y-1">
                    <div className="text-orb-blue font-semibold text-caption">信号球 · 蓝</div>
                    <p className="text-hud text-fg-muted">专精于资源循环与检索</p>
                  </div>
                  <div className="p-3 bg-ink-950 border border-orb-yellow/50 space-y-1">
                    <div className="text-orb-yellow font-semibold text-caption">信号球 · 黄</div>
                    <p className="text-hud text-fg-muted">专精于侵蚀控制与防御</p>
                  </div>
                </div>

                <GuideCardExampleStrip examples={GUIDE_CARD_EXAMPLES.signalOrbs} onPreview={setPreviewMedia} />

                <div className="p-4 bg-ink-950 border border-line space-y-2 text-caption">
                  <div className="text-gold-300 font-semibold">信号球的三种来源：</div>
                  <ul className="list-disc list-inside space-y-1 text-fg-muted">
                    <li><strong className="text-fg">手牌主动打出：</strong>放置到信号球区最上方并抽 1 张牌（不触发充能自）。</li>
                    <li><strong className="text-teal-400">攻击充能翻出：</strong>触发【充能自】效果，正面放置到信号球区。</li>
                    <li><strong className="text-crimson-400">伤害充能翻出：</strong>触发【充能自】效果，背面放置到费用区作为暗费。</li>
                  </ul>
                </div>

                <div className="p-4 bg-ink-950 border border-teal-400/40 space-y-2 text-caption">
                  <div className="text-teal-400 font-semibold">主要阶段消除信号球 (三消)：</div>
                  <p className="text-fg-secondary">
                    在自己回合的主要阶段中，可消除信号球区任意 <strong className="text-fg">3 张相邻或同色的信号球</strong>送入墓地，并<strong className="text-gold-300">抽 1 张牌</strong>。
                  </p>
                </div>
              </div>
            )}

            {/* 10. 牌组更新规则 */}
            {activeTab === 'deck-refresh' && (
              <div className="space-y-5 animate-in fade-in duration-fast">
                <div className="border-b border-line pb-3">
                  <h3 className="text-title-sm font-bold text-fg flex items-center gap-2">
                    <span className="text-crimson-400 font-num">10.</span> 牌组更新规则
                  </h3>
                  <p className="text-hud text-fg-muted font-display uppercase tracking-widest mt-0.5">
                    DECK REFRESH &amp; PENALTY
                  </p>
                </div>

                <div className="p-4 border border-crimson-500/40 bg-crimson-500/5 space-y-2.5 text-caption">
                  <div className="text-crimson-400 font-semibold flex items-center gap-2 text-body-sm">
                    <AlertTriangle className="w-4 h-4" />
                    <span>牌组耗尽触发机制</span>
                  </div>
                  <p className="text-fg-secondary">
                    当一方指挥官的牌组没有卡牌时，需立即将其墓地的所有卡牌以背面表示充分洗切后，作为新的牌组放置到牌组区域，该动作视为【牌组更新】。
                  </p>
                  <p className="text-gold-300 font-semibold">
                    那之后，执行牌组更新的玩家的侵蚀计数 +1。
                  </p>
                  <p className="text-fg-muted">
                    （若存在正在进行的规则处理或能力处理，应先暂停；牌组更新完成后，继续处理未完成的行动）。
                  </p>
                </div>
              </div>
            )}

            {/* 11. 常用关键词图鉴 */}
            {activeTab === 'keywords' && (
              <div className="space-y-5 animate-in fade-in duration-fast">
                <div className="border-b border-line pb-3">
                  <h3 className="text-title-sm font-bold text-fg flex items-center gap-2">
                    <span className="text-crimson-400 font-num">11.</span> 官方关键词与能力图标图鉴
                  </h3>
                  <p className="text-hud text-fg-muted font-display uppercase tracking-widest mt-0.5">
                    ABILITY KEYWORDS GLOSSARY
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-caption">
                  {[
                    { tag: '【速攻】', tone: 'text-teal-400 border-teal-400/40 bg-teal-400/10', desc: '持有该能力的角色在出场的回合即可进行攻击（可攻击对方角色或玩家）。' },
                    { tag: '【突进】', tone: 'text-gold-300 border-gold-300/40 bg-gold-300/10', desc: '持有该能力的角色在出场的回合可以攻击对方角色（不能攻击对方玩家）。' },
                    { tag: '【贯通】', tone: 'text-crimson-400 border-crimson-500/40 bg-crimson-500/10', desc: '在角色战斗步骤中战斗破坏角色时，额外给予被破坏角色的玩家 1 点伤害。' },
                    { tag: '【瞬时】', tone: 'text-steel-300 border-steel-500/50 bg-steel-700/20', desc: '玩家在战斗自由时点步骤或回合结束阶段可以支付费用/代价使用。' },
                    { tag: '【出】出场', tone: 'text-fg border-line-strong bg-ink-850', desc: '卡牌进入战场时自动发动的能力。带有“代价：”时可选择是否支付发动。' },
                    { tag: '【起】起动', tone: 'text-fg border-line-strong bg-ink-850', desc: '在自己回合主要阶段，由玩家主动支付相应代价发动的能力。' },
                    { tag: '【自】自动', tone: 'text-fg border-line-strong bg-ink-850', desc: '在对局中满足指定触发条件时自动执行的能力。' },
                    { tag: '【永】永久', tone: 'text-fg border-line-strong bg-ink-850', desc: '满足条件时持续生效的静态能力。' },
                    { tag: '【充能自】', tone: 'text-teal-400 border-teal-400/40 bg-teal-400/10', desc: '仅在攻击充能或伤害充能翻开至处理区时触发的特殊自动能力。' },
                    { tag: '【充能X / +X】', tone: 'text-fg-secondary border-line bg-ink-850', desc: '角色默认充能次数为 1；【充能X】重置为 X；【充能+X】增加 X 次。' },
                  ].map((item) => (
                    <div key={item.tag} className="p-3.5 bg-ink-950 border border-line space-y-1.5">
                      <span className={`inline-block px-1.5 py-0.5 border text-hud font-semibold ${item.tone}`}>
                        {item.tag}
                      </span>
                      <p className="text-fg-muted">{item.desc}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </main>
        </div>

        {/* 底部快捷栏 */}
        <div className="px-6 py-3 bg-ink-950 border-t border-line flex items-center justify-between text-caption text-fg-muted flex-shrink-0">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 bg-teal-400" />
            <span>战双帕弥什 TCG 综合规则 V1.4 · 终端数据库已同步</span>
          </div>
          <Button variant="primary" size="sm" onClick={onClose}>
            完成查阅 [Esc]
          </Button>
        </div>
      </div>
    </div>
    <GuideImagePreviewDialog media={previewMedia} onClose={() => setPreviewMedia(null)} />
    </>
  );
};

'use client';

import React, { useState } from 'react';
import {
  X,
  BookOpen,
  Search,
  Shield,
  Swords,
  Zap,
  Layers,
  Sparkles,
  HelpCircle,
  AlertTriangle,
  RotateCcw,
  Flame,
  ChevronRight,
  ExternalLink,
} from 'lucide-react';

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

export const RuleGuideModal: React.FC<RuleGuideModalProps> = ({ isOpen, onClose }) => {
  const [activeTab, setActiveTab] = useState<GuideTab>('overview');
  const [searchQuery, setSearchQuery] = useState('');

  if (!isOpen) return null;

  const tabs: { id: GuideTab; label: string; icon: string }[] = [
    { id: 'overview', label: '游戏玩法与胜负', icon: '🎯' },
    { id: 'card-types', label: '卡牌种类与使用', icon: '🃏' },
    { id: 'card-info', label: '卡面信息详解', icon: '🔍' },
    { id: 'field', label: '场地七大区域', icon: '🗺️' },
    { id: 'deck-building', label: '牌组构筑规则', icon: '🛠️' },
    { id: 'setup', label: '开局准备与调度', icon: '🎲' },
    { id: 'turn-flow', label: '回合四大流程', icon: '🔄' },
    { id: 'combat-flow', label: '战斗全流程', icon: '⚔️' },
    { id: 'signal-orbs', label: '信号球三消系统', icon: '🔴' },
    { id: 'deck-refresh', label: '牌组更新规则', icon: '💫' },
    { id: 'keywords', label: '官方关键词图鉴', icon: '🏷️' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/85 backdrop-blur-md animate-in fade-in duration-200 select-none">
      <div className="relative w-full max-w-5xl h-[88vh] max-h-[900px] bg-surface/98 border border-terminalBorder/80 rounded-2xl shadow-[0_0_50px_rgba(0,240,255,0.25)] flex flex-col overflow-hidden font-sans">
        {/* 顶部标题栏 */}
        <div className="flex items-center justify-between px-6 py-4 bg-neutral-900/90 border-b border-terminalBorder/60 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-terminalCyan/10 border border-terminalCyan/30 text-terminalCyan shadow-[0_0_15px_rgba(0,240,255,0.3)]">
              <BookOpen className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold text-white tracking-wide flex items-center gap-2">
                <span>战双帕弥什 卡牌对战 • 官方新手作战指南</span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-terminalCyan/20 text-terminalCyan border border-terminalCyan/40">
                  OFFICIAL MANUAL
                </span>
              </h2>
              <p className="text-[11px] text-neutral-400 font-mono">
                PUNISHING CARD GAME • 基础规则与作战条令图鉴
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors"
              title="关闭指南 [Esc]"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* 主体左右分栏 */}
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* 左侧导航栏 */}
          <aside className="w-56 border-r border-terminalBorder/60 bg-neutral-950/60 p-3 flex flex-col gap-1 overflow-y-auto flex-shrink-0 font-mono text-xs">
            <div className="text-[10px] text-neutral-500 font-bold px-2 py-1 tracking-wider uppercase">
              目录导航 / DIRECTORY
            </div>
            {tabs.map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left transition-all ${
                    isActive
                      ? 'bg-terminalCyan/15 text-white font-bold border border-terminalCyan/40 shadow-[0_0_12px_rgba(0,240,255,0.2)]'
                      : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-900 border border-transparent'
                  }`}
                >
                  <span className="text-base">{tab.icon}</span>
                  <span className="truncate">{tab.label}</span>
                </button>
              );
            })}
          </aside>

          {/* 右侧内容展示区 */}
          <main className="flex-1 overflow-y-auto p-6 space-y-6 text-neutral-200 text-sm leading-relaxed scroll-smooth bg-gradient-to-b from-transparent via-neutral-950/20 to-neutral-950/50">
            {/* 1. 游戏玩法与胜负 */}
            {activeTab === 'overview' && (
              <div className="space-y-5 animate-in fade-in duration-150">
                <div className="border-b border-terminalBorder/60 pb-3">
                  <h3 className="text-lg font-bold text-white flex items-center gap-2">
                    <span className="text-terminalCyan">01.</span> 游戏玩法与胜负判定
                  </h3>
                  <p className="text-xs text-neutral-400 font-mono mt-0.5">VICTORY & DEFEAT CONDITIONS</p>
                </div>

                <div className="p-4 rounded-xl border border-terminalCyan/30 bg-terminalCyan/5 space-y-2">
                  <div className="font-bold text-terminalCyan flex items-center gap-2">
                    <Flame className="w-4 h-4 text-erosionRed" />
                    <span>帕弥什病毒侵蚀胜负规则</span>
                  </div>
                  <p className="text-xs sm:text-sm text-neutral-300">
                    在对战过程中，双方通过卡牌战斗，使对手的帕弥什病毒侵蚀计数从 <strong className="text-white">0</strong> 开始增加。
                    当一方指挥官的侵蚀计数达到 <strong className="text-erosionRed text-base font-bold">7</strong> 时，其被完全侵蚀，在对战中立刻落败！
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs font-mono">
                  <div className="p-3.5 rounded-xl border border-neutral-800 bg-neutral-900/60 space-y-1.5">
                    <div className="text-terminalGold font-bold flex items-center gap-1.5">
                      <Swords className="w-4 h-4" />
                      <span>直接伤害侵蚀</span>
                    </div>
                    <p className="text-neutral-400">
                      攻击对方玩家且对方未进行阻挡时，根据攻击角色的 DP 数值，对手依次执行相同次数的【伤害充能】，每次充能完成后侵蚀计数 +1。
                    </p>
                  </div>
                  <div className="p-3.5 rounded-xl border border-neutral-800 bg-neutral-900/60 space-y-1.5">
                    <div className="text-terminalCyan font-bold flex items-center gap-1.5">
                      <RotateCcw className="w-4 h-4" />
                      <span>牌组更新惩罚</span>
                    </div>
                    <p className="text-neutral-400">
                      当牌组抽空时，需将己方墓地所有卡牌洗切作为新牌组（牌组更新），更新完毕后侵蚀计数惩罚性 +1。
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* 2. 卡牌种类与使用 */}
            {activeTab === 'card-types' && (
              <div className="space-y-5 animate-in fade-in duration-150">
                <div className="border-b border-terminalBorder/60 pb-3">
                  <h3 className="text-lg font-bold text-white flex items-center gap-2">
                    <span className="text-terminalCyan">02.</span> 卡牌三大种类
                  </h3>
                  <p className="text-xs text-neutral-400 font-mono mt-0.5">THREE CARD CATEGORIES & MECHANICS</p>
                </div>

                <p className="text-xs text-neutral-400">
                  本游戏中，卡牌分为【角色牌】、【道具牌】与【战术牌】三种类型：
                </p>

                {/* 角色牌 */}
                <div className="p-4 rounded-xl border border-neutral-800 bg-neutral-900/50 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="font-bold text-white text-base flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded bg-terminalCyan/20 text-terminalCyan text-xs border border-terminalCyan/40 font-mono">
                        ROLE
                      </span>
                      <span>角色牌</span>
                    </div>
                    <span className="text-xs text-neutral-400">核心战力 • 占位战斗</span>
                  </div>
                  <p className="text-xs text-neutral-300">
                    出场到战场进行战斗的卡牌。包含 PP（攻击力）、DP（伤害值）、属性、费用以及特征。
                  </p>
                  <div className="bg-neutral-950 p-3 rounded-lg border border-neutral-800 text-xs space-y-2">
                    <div className="text-terminalGold font-bold">登场方式：</div>
                    <ul className="list-disc list-inside space-y-1 text-neutral-400">
                      <li>
                        <strong className="text-neutral-200">正规使用：</strong>放置到己方战场空余的卡位（战场共5个卡位）。
                      </li>
                      <li>
                        <strong className="text-neutral-200">升变登场：</strong>持有《升变》能力的角色牌，在满足《升变条件》与属性要求时，支付《升变代价》，重叠在指定的对象上方。
                        <span className="text-terminalCyan font-semibold">
                          作为升变对象的卡牌原有状态会被刷新，升变角色以正面竖直状态出场！
                        </span>
                        （离开战场时，下方所有垫牌进入墓地）。
                      </li>
                    </ul>
                  </div>
                  <div className="flex justify-center pt-2">
                    <img
                      src="https://zhanshuang-prod-minio.janime.cn/card-game-public/680725c2-9e71-4949-ab73-8ec20d473e53/ST01-R_ST01-001R.png"
                      alt="角色牌示例"
                      className="w-36 rounded-lg border border-neutral-700 shadow-md hover:scale-105 transition-transform"
                    />
                  </div>
                </div>

                {/* 道具牌 */}
                <div className="p-4 rounded-xl border border-neutral-800 bg-neutral-900/50 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="font-bold text-white text-base flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded bg-terminalGold/20 text-terminalGold text-xs border border-terminalGold/40 font-mono">
                        ITEM
                      </span>
                      <span>道具牌 (装备牌 & 辅助机牌)</span>
                    </div>
                    <span className="text-xs text-neutral-400">持续增益 • 辅助驻留</span>
                  </div>
                  <p className="text-xs text-neutral-300">
                    存在于战场，为战场的角色提供持续性增益的卡牌，不能直接进行战斗。分为两类：
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                    <div className="p-3 rounded-lg bg-neutral-950 border border-neutral-800 space-y-1.5">
                      <div className="text-terminalGold font-bold">1. 装备牌 (Equipment)</div>
                      <p className="text-neutral-400">
                        强化特定角色的道具牌。规则上每张角色只能装备 1 张装备牌。出场可放空卡位或直接置于未装备角色下方；离开战场时装备随之送入墓地。
                      </p>
                    </div>
                    <div className="p-3 rounded-lg bg-neutral-950 border border-neutral-800 space-y-1.5">
                      <div className="text-terminalCyan font-bold">2. 辅助机牌 (Assist)</div>
                      <p className="text-neutral-400">
                        每名玩家战场只能存在 1 张辅助机牌。若战场已存在辅助机牌，出场新辅助机时必须将原有辅助机送入墓地！
                      </p>
                    </div>
                  </div>
                  <div className="flex justify-center gap-4 pt-2">
                    <img
                      src="https://zhanshuang-prod-minio.janime.cn/card-game-public/af781e2b-d300-4092-bb30-f3263dd42278/ST04-ST_ST04-010ST.png"
                      alt="装备牌示例"
                      className="w-32 rounded-lg border border-neutral-700 shadow-md hover:scale-105 transition-transform"
                    />
                    <img
                      src="https://zhanshuang-prod-minio.janime.cn/card-game-public/d9828bcb-2b4e-474c-adb0-d45bd7e1371e/BP01-U_BP01-012U.png"
                      alt="辅助机牌示例"
                      className="w-32 rounded-lg border border-neutral-700 shadow-md hover:scale-105 transition-transform"
                    />
                  </div>
                </div>

                {/* 战术牌 */}
                <div className="p-4 rounded-xl border border-neutral-800 bg-neutral-900/50 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="font-bold text-white text-base flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded bg-purple-500/20 text-purple-400 text-xs border border-purple-500/40 font-mono">
                        TACTICS
                      </span>
                      <span>战术牌 (普通战术 & 瞬时战术)</span>
                    </div>
                    <span className="text-xs text-neutral-400">即时结算 • 战局奇策</span>
                  </div>
                  <p className="text-xs text-neutral-300">
                    直接从手牌打出、进入处理区即时处理的卡牌，能力处理完毕后送入墓地。
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                    <div className="p-3 rounded-lg bg-neutral-950 border border-neutral-800 space-y-1">
                      <div className="text-neutral-200 font-bold">普通战术牌：</div>
                      <p className="text-neutral-400">只能在自己回合的主要阶段（空闲时点）使用。</p>
                    </div>
                    <div className="p-3 rounded-lg bg-neutral-950 border border-neutral-800 space-y-1">
                      <div className="text-terminalCyan font-bold">瞬时战术牌 (Instant)：</div>
                      <p className="text-neutral-400">
                        仅在战斗流程的自由时点步骤（阻挡前后）以及回合结束阶段使用。
                      </p>
                    </div>
                  </div>
                  <div className="flex justify-center gap-4 pt-2">
                    <img
                      src="https://zhanshuang-prod-minio.janime.cn/card-game-public/fa5b2cb6-52a9-4df3-a90b-e0beeceae0ba/ST01-ST_ST01-011ST.png"
                      alt="普通战术牌"
                      className="w-32 rounded-lg border border-neutral-700 shadow-md hover:scale-105 transition-transform"
                    />
                    <img
                      src="https://zhanshuang-prod-minio.janime.cn/card-game-public/f3640984-f1c2-49b4-9e9d-153b2a5f4c3f/ST02-R_ST02-011R.png"
                      alt="瞬时战术牌"
                      className="w-32 rounded-lg border border-neutral-700 shadow-md hover:scale-105 transition-transform"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* 3. 卡牌信息详解 */}
            {activeTab === 'card-info' && (
              <div className="space-y-5 animate-in fade-in duration-150">
                <div className="border-b border-terminalBorder/60 pb-3">
                  <h3 className="text-lg font-bold text-white flex items-center gap-2">
                    <span className="text-terminalCyan">03.</span> 官方卡牌信息结构详解
                  </h3>
                  <p className="text-xs text-neutral-400 font-mono mt-0.5">CARD STRUCTURE & STATS DIAGRAM</p>
                </div>

                <div className="flex flex-col items-center justify-center p-3 bg-neutral-950 rounded-xl border border-neutral-800">
                  <img
                    src="https://zhanshuang-prod-minio.janime.cn/card-game-public/d86b32c1-ce48-454b-bb11-5c007fa2da68/手册_看图王(1).png"
                    alt="卡面结构图解"
                    className="max-h-[360px] w-auto rounded border border-neutral-700 object-contain shadow-lg"
                  />
                  <span className="text-[11px] font-mono text-neutral-500 mt-2">
                    战双帕弥什 TCG 官方卡面区域指示图
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs font-mono">
                  <div className="p-3 bg-neutral-900/60 rounded-xl border border-neutral-800">
                    <span className="text-terminalGold font-bold">1. 费用 (左上角)：</span>
                    <p className="text-neutral-400 mt-1">使用卡牌需要支付的明费/暗费总额。</p>
                  </div>
                  <div className="p-3 bg-neutral-900/60 rounded-xl border border-neutral-800">
                    <span className="text-terminalCyan font-bold">2. 属性 (右上角)：</span>
                    <p className="text-neutral-400 mt-1">
                      卡牌的元素属性（火/暗/物理/雷/冰/空）。费用区必须至少存在1张对应属性的明费方可使用！
                    </p>
                  </div>
                  <div className="p-3 bg-neutral-900/60 rounded-xl border border-neutral-800">
                    <span className="text-white font-bold">3. PP (战斗力/攻击力)：</span>
                    <p className="text-neutral-400 mt-1">
                      战斗时与对方角色比拼数值。攻方 PP ≥ 防守方 PP 时破坏对方角色。
                    </p>
                  </div>
                  <div className="p-3 bg-neutral-900/60 rounded-xl border border-neutral-800">
                    <span className="text-erosionRed font-bold">4. DP (伤害值)：</span>
                    <p className="text-neutral-400 mt-1">
                      攻击对方玩家成功时给予的伤害次数（触发相同次数的伤害充能，侵蚀+1）。
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* 4. 场地七大区域 */}
            {activeTab === 'field' && (
              <div className="space-y-5 animate-in fade-in duration-150">
                <div className="border-b border-terminalBorder/60 pb-3">
                  <h3 className="text-lg font-bold text-white flex items-center gap-2">
                    <span className="text-terminalCyan">04.</span> 官方场地七大区域
                  </h3>
                  <p className="text-xs text-neutral-400 font-mono mt-0.5">SEVEN GAME ZONES ON BATTLEFIELD MAT</p>
                </div>

                <div className="flex flex-col items-center justify-center p-3 bg-neutral-950 rounded-xl border border-neutral-800">
                  <img
                    src="https://zhanshuang-prod-minio.janime.cn/card-game-public/bf23374f-2389-4a97-a508-3d84823f8441/战双场地纸-确定修改_omote.jpg"
                    alt="官方对战纸"
                    className="max-h-[300px] w-auto rounded border border-neutral-700 object-contain shadow-lg"
                  />
                  <span className="text-[11px] font-mono text-neutral-500 mt-2">
                    战双帕弥什 官方对战垫布局 (7大区域划分)
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                  <div className="p-3 bg-neutral-900/60 rounded-xl border border-neutral-800">
                    <span className="text-terminalCyan font-bold">① 战场区 (Battlefield)：</span>
                    <p className="text-neutral-400 mt-1">
                      角色牌和道具牌出场及战斗区域，规则上每位指挥官拥有 5 个卡位。
                    </p>
                  </div>
                  <div className="p-3 bg-neutral-900/60 rounded-xl border border-neutral-800">
                    <span className="text-terminalGold font-bold">② 牌组 (Deck)：</span>
                    <p className="text-neutral-400 mt-1">
                      放置牌组的区域，必须由刚好 50 张卡牌构成。
                    </p>
                  </div>
                  <div className="p-3 bg-neutral-900/60 rounded-xl border border-neutral-800">
                    <span className="text-erosionRed font-bold">③ 侵蚀计数区 (Erosion)：</span>
                    <p className="text-neutral-400 mt-1">
                      记录自身所受侵蚀计数的刻度（0~7）。达到 7 即败北。
                    </p>
                  </div>
                  <div className="p-3 bg-neutral-900/60 rounded-xl border border-neutral-800">
                    <span className="text-neutral-300 font-bold">④ 墓地 (Graveyard)：</span>
                    <p className="text-neutral-400 mt-1">
                      放置已使用、被战斗破坏或离开战场的卡牌。
                    </p>
                  </div>
                  <div className="p-3 bg-neutral-900/60 rounded-xl border border-terminalCyan/40 col-span-1 md:col-span-2">
                    <div className="text-terminalCyan font-bold flex items-center justify-between">
                      <span>⑤ 费用区 (Cost Zone) • 明费与暗费（上限10张）</span>
                      <span className="text-[10px] text-terminalGold bg-terminalGold/10 px-2 py-0.5 rounded border border-terminalGold/30">
                        核心规则
                      </span>
                    </div>
                    <ul className="list-disc list-inside space-y-1 text-neutral-400 mt-1.5 leading-relaxed">
                      <li>
                        <strong className="text-neutral-200">明费：</strong>正面表示的卡牌。支付费用时将竖直状态的明费横置。
                      </li>
                      <li>
                        <strong className="text-neutral-200">暗费：</strong>背面竖直表示的卡牌（受到伤害充能产生）。支付费用时将暗费移至墓地。
                        <span className="text-terminalGold">回合玩家未使用的暗费在回合结束阶段全部送入墓地！</span>
                      </li>
                      <li>
                        <strong className="text-terminalCyan font-semibold">10张上限限制：</strong>
                        费用区中明费和暗费数量合计上限为 10 张。若费用区已存在 10 张卡牌，需要放置到费用区的卡牌改为放置到墓地！
                      </li>
                    </ul>
                  </div>
                  <div className="p-3 bg-neutral-900/60 rounded-xl border border-neutral-800">
                    <span className="text-terminalGold font-bold">⑥ 信号球区 (Signal Orb Zone)：</span>
                    <p className="text-neutral-400 mt-1">
                      放置红、蓝、黄信号球的区域，数量无上限，卡牌顺序不可随意变动。
                    </p>
                  </div>
                  <div className="p-3 bg-neutral-900/60 rounded-xl border border-neutral-800">
                    <span className="text-purple-400 font-bold">⑦ 处理区 (Processing Zone)：</span>
                    <p className="text-neutral-400 mt-1">
                      能力处理、攻击充能及伤害充能时卡牌临时公开放置该区域。处理完毕后送墓或进入对应区域。
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* 5. 牌组构筑规则 */}
            {activeTab === 'deck-building' && (
              <div className="space-y-5 animate-in fade-in duration-150">
                <div className="border-b border-terminalBorder/60 pb-3">
                  <h3 className="text-lg font-bold text-white flex items-center gap-2">
                    <span className="text-terminalCyan">05.</span> 牌组构筑三大铁律
                  </h3>
                  <p className="text-xs text-neutral-400 font-mono mt-0.5">DECK BUILDING RESTRICTIONS</p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="p-4 rounded-xl border border-terminalCyan/30 bg-terminalCyan/5 text-center space-y-1">
                    <div className="text-2xl font-black text-terminalCyan font-mono">50 张</div>
                    <div className="font-bold text-white text-xs">牌组固定总张数</div>
                    <p className="text-[11px] text-neutral-400">牌组必须刚好由50张卡牌构成，不能多也不能少。</p>
                  </div>
                  <div className="p-4 rounded-xl border border-terminalGold/30 bg-terminalGold/5 text-center space-y-1">
                    <div className="text-2xl font-black text-terminalGold font-mono">≤ 4 张</div>
                    <div className="font-bold text-white text-xs">同名/同卡号上限</div>
                    <p className="text-[11px] text-neutral-400">牌组中相同卡牌编号的卡牌最多投入4张（含异画版本）。</p>
                  </div>
                  <div className="p-4 rounded-xl border border-erosionRed/30 bg-erosionRed/5 text-center space-y-1">
                    <div className="text-2xl font-black text-erosionRed font-mono">4+4+4</div>
                    <div className="font-bold text-white text-xs">信号球必选投入</div>
                    <p className="text-[11px] text-neutral-400">
                      牌组中必须投入 4 张红球、4 张蓝球以及 4 张黄球（共12张）。
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* 6. 开局准备与调度 */}
            {activeTab === 'setup' && (
              <div className="space-y-5 animate-in fade-in duration-150">
                <div className="border-b border-terminalBorder/60 pb-3">
                  <h3 className="text-lg font-bold text-white flex items-center gap-2">
                    <span className="text-terminalCyan">06.</span> 游戏的准备与手牌调度 (Mulligan)
                  </h3>
                  <p className="text-xs text-neutral-400 font-mono mt-0.5">GAME PREPARATION & MULLIGAN SEQUENCE</p>
                </div>

                <div className="space-y-3 text-xs">
                  <div className="flex gap-3 items-start p-3 bg-neutral-900/60 rounded-xl border border-neutral-800">
                    <span className="w-5 h-5 rounded-full bg-terminalCyan/20 text-terminalCyan border border-terminalCyan/40 flex items-center justify-center flex-shrink-0 font-bold">1</span>
                    <div>
                      <strong className="text-white">初始化侵蚀与洗牌：</strong>
                      <span className="text-neutral-400">双方充分洗切牌组，并将各自的侵蚀计数设置为 0。</span>
                    </div>
                  </div>
                  <div className="flex gap-3 items-start p-3 bg-neutral-900/60 rounded-xl border border-neutral-800">
                    <span className="w-5 h-5 rounded-full bg-terminalCyan/20 text-terminalCyan border border-terminalCyan/40 flex items-center justify-center flex-shrink-0 font-bold">2</span>
                    <div>
                      <strong className="text-white">确定先后手：</strong>
                      <span className="text-neutral-400">系统随机掷点决定先后手顺序。</span>
                    </div>
                  </div>
                  <div className="flex gap-3 items-start p-3 bg-neutral-900/60 rounded-xl border border-terminalGold/40 bg-terminalGold/5">
                    <span className="w-5 h-5 rounded-full bg-terminalGold/20 text-terminalGold border border-terminalGold/40 flex items-center justify-center flex-shrink-0 font-bold">3</span>
                    <div>
                      <strong className="text-terminalGold">手牌调度机会 (5.2.1.e)：</strong>
                      <p className="text-neutral-300 mt-1 leading-relaxed">
                        双方玩家各自抽取 4 张手牌。先攻玩家与后攻玩家各自仅有 <strong className="text-white">1 次机会</strong> 选择任意张数手牌放置到牌组底，然后从牌组顶抽取相同数量的牌，最后将牌组充分洗切。
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-3 items-start p-3 bg-neutral-900/60 rounded-xl border border-neutral-800">
                    <span className="w-5 h-5 rounded-full bg-terminalCyan/20 text-terminalCyan border border-terminalCyan/40 flex items-center justify-center flex-shrink-0 font-bold">4</span>
                    <div>
                      <strong className="text-white">填充起始明费：</strong>
                      <p className="text-neutral-400 mt-1">
                        在手牌调度和洗切完成之后，双方玩家将自己牌组顶 2 张牌正面竖直放置到费用区作为初始明费。
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* 7. 回合四大流程 */}
            {activeTab === 'turn-flow' && (
              <div className="space-y-5 animate-in fade-in duration-150">
                <div className="border-b border-terminalBorder/60 pb-3">
                  <h3 className="text-lg font-bold text-white flex items-center gap-2">
                    <span className="text-terminalCyan">07.</span> 回合的四大流程
                  </h3>
                  <p className="text-xs text-neutral-400 font-mono mt-0.5">FOUR PHASES OF A TURN</p>
                </div>

                <div className="space-y-3 text-xs">
                  {/* 竖直阶段 */}
                  <div className="p-3.5 bg-neutral-900/60 rounded-xl border border-neutral-800">
                    <div className="font-bold text-terminalCyan flex items-center gap-2 text-sm">
                      <span>阶段 1 • 竖直阶段 (Upkeep Phase)</span>
                    </div>
                    <p className="text-neutral-400 mt-1">
                      回合玩家必须将自己战场和费用区的所有横置状态卡牌转为竖直状态。
                    </p>
                  </div>

                  {/* 抽牌填充阶段 */}
                  <div className="p-3.5 bg-neutral-900/60 rounded-xl border border-neutral-800 space-y-1.5">
                    <div className="font-bold text-terminalGold flex items-center gap-2 text-sm">
                      <span>阶段 2 • 抽牌填充阶段 (Draw & Charge Phase)</span>
                    </div>
                    <ul className="list-disc list-inside text-neutral-400 space-y-1">
                      <li>
                        <strong className="text-white">抽牌：</strong>回合玩家从自己牌组顶抽 2 张牌（<span className="text-terminalGold">注意：先攻玩家第1回合只抽1张牌</span>）。
                      </li>
                      <li>
                        <strong className="text-white">填充：</strong>那之后，回合玩家可以将最多 1 张手牌以竖直状态正面放置到费用区作为明费。
                      </li>
                    </ul>
                  </div>

                  {/* 主要阶段 */}
                  <div className="p-3.5 bg-neutral-900/60 rounded-xl border border-terminalCyan/30 bg-terminalCyan/5 space-y-2">
                    <div className="font-bold text-white flex items-center gap-2 text-sm">
                      <span>阶段 3 • 主要阶段 (Main Phase)</span>
                    </div>
                    <p className="text-neutral-300">回合玩家在主要阶段中可以按任意顺序进行以下行动：</p>
                    <ol className="list-decimal list-inside space-y-1 text-neutral-400">
                      <li>使用手牌卡牌（需满足属性并支付费用）。</li>
                      <li>发动战场卡牌的【起】动能力（支付相应代价）。</li>
                      <li>将战场未装备的装备牌装备到角色下方。</li>
                      <li>消除 3 张相邻的信号球并抽 1 张牌。</li>
                      <li>宣告可以攻击的角色进行攻击（进入战斗流程）。</li>
                      <li>宣言回合结束，进入结束阶段。</li>
                    </ol>
                  </div>

                  {/* 结束阶段 */}
                  <div className="p-3.5 bg-neutral-900/60 rounded-xl border border-neutral-800 space-y-1.5">
                    <div className="font-bold text-purple-400 flex items-center gap-2 text-sm">
                      <span>阶段 4 • 结束阶段 (End Phase)</span>
                    </div>
                    <ol className="list-decimal list-inside space-y-1 text-neutral-400">
                      <li>双方轮流使用瞬时战术/瞬时能力（回合玩家优先）。</li>
                      <li>处理结束阶段效果。</li>
                      <li>手牌上限检查：若回合玩家手牌 &gt; 7 张，弃置至 7 张。</li>
                      <li>
                        <span className="text-terminalGold font-semibold">清理暗费：</span>将回合玩家费用区的所有暗费送入墓地！
                      </li>
                    </ol>
                  </div>
                </div>
              </div>
            )}

            {/* 8. 战斗全流程 */}
            {activeTab === 'combat-flow' && (
              <div className="space-y-5 animate-in fade-in duration-150">
                <div className="border-b border-terminalBorder/60 pb-3">
                  <h3 className="text-lg font-bold text-white flex items-center gap-2">
                    <span className="text-terminalCyan">08.</span> 战斗全流程 (五步骤)
                  </h3>
                  <p className="text-xs text-neutral-400 font-mono mt-0.5">COMBAT PHASES & STEP-BY-STEP FLOW</p>
                </div>

                <div className="space-y-3 text-xs">
                  {/* 1. 攻击宣言步骤 */}
                  <div className="p-3 bg-neutral-900/60 rounded-xl border border-neutral-800">
                    <div className="font-bold text-terminalCyan text-sm">1. 攻击宣言步骤 (Attack Declaration)</div>
                    <p className="text-neutral-300 mt-1">
                      将战场 1 张竖直状态的角色横置并选择攻击对象（对方玩家或对方横置的角色）。出场当回合不能攻击（除非持有【速攻】或【突进】）。处理攻击时/被攻击时能力。
                    </p>
                  </div>

                  {/* 2. 自由时点步骤 */}
                  <div className="p-3 bg-neutral-900/60 rounded-xl border border-neutral-800">
                    <div className="font-bold text-terminalGold text-sm">2. 自由时点步骤 (Free Timing & Block)</div>
                    <p className="text-neutral-300 mt-1">
                      由回合外玩家开始轮流使用瞬时能力。随后，被攻击玩家可以横置 1 张竖直状态的角色进行阻挡，将攻击对象转移给阻挡者。
                    </p>
                  </div>

                  {/* 3. 充能步骤 */}
                  <div className="p-3 bg-neutral-900/60 rounded-xl border border-terminalCyan/40 bg-terminalCyan/5">
                    <div className="font-bold text-terminalCyan text-sm">3. 充能步骤 (Attack Charge Step)</div>
                    <p className="text-neutral-300 mt-1">
                      攻击角色根据其充能次数（默认 1 次）进行【攻击充能】，依次翻开牌组顶放入处理区：
                    </p>
                    <ul className="list-disc list-inside mt-1 text-neutral-400">
                      <li><strong className="text-neutral-200">非信号球牌：</strong>直接加入手牌！</li>
                      <li><strong className="text-terminalCyan">信号球牌：</strong>立刻发动其【充能自】效果，并正面放置到信号球区最上方！</li>
                    </ul>
                  </div>

                  {/* 4. 角色战斗步骤 */}
                  <div className="p-3 bg-neutral-900/60 rounded-xl border border-neutral-800">
                    <div className="font-bold text-white text-sm">4. 角色战斗步骤 (PP Comparison)</div>
                    <p className="text-neutral-300 mt-1">
                      若攻击对象为角色（或被角色阻挡）：比较双方角色的 PP 值。若攻方 PP ≥ 防守方 PP，被攻击角色被战斗破坏送入墓地；否则无事发生。
                    </p>
                  </div>

                  {/* 5. 伤害步骤 */}
                  <div className="p-3 bg-neutral-900/60 rounded-xl border border-erosionRed/40 bg-erosionRed/5">
                    <div className="font-bold text-erosionRed text-sm">5. 伤害步骤 (Damage Step & Damage Charge)</div>
                    <p className="text-neutral-300 mt-1">
                      若攻击对象为对方玩家且未被阻挡：攻击成功，根据攻方 DP 数值依次进行相同次数的【伤害充能】。每次充能完成受伤玩家侵蚀计数 +1！
                    </p>
                    <ul className="list-disc list-inside mt-1 text-neutral-400">
                      <li><strong className="text-neutral-200">非信号球：</strong>以背面竖直状态放置到费用区作为暗费。</li>
                      <li><strong className="text-terminalCyan">信号球：</strong>发动其【充能自】效果，那之后以背面竖直状态放置到费用区作为暗费。</li>
                    </ul>
                  </div>
                </div>
              </div>
            )}

            {/* 9. 信号球三消系统 */}
            {activeTab === 'signal-orbs' && (
              <div className="space-y-5 animate-in fade-in duration-150">
                <div className="border-b border-terminalBorder/60 pb-3">
                  <h3 className="text-lg font-bold text-white flex items-center gap-2">
                    <span className="text-terminalCyan">09.</span> 信号球系统与三消机制
                  </h3>
                  <p className="text-xs text-neutral-400 font-mono mt-0.5">SIGNAL ORBS & 3-ORB ELIMINATION SYSTEM</p>
                </div>

                <div className="grid grid-cols-3 gap-3 text-center">
                  <div className="p-3 rounded-xl bg-red-950/30 border border-red-500/40 space-y-1">
                    <div className="text-red-400 font-bold text-xs">信号球·红</div>
                    <p className="text-[11px] text-neutral-400">专精于爆发与攻击强化</p>
                  </div>
                  <div className="p-3 rounded-xl bg-blue-950/30 border border-blue-500/40 space-y-1">
                    <div className="text-blue-400 font-bold text-xs">信号球·蓝</div>
                    <p className="text-[11px] text-neutral-400">专精于资源循环与抽牌检索</p>
                  </div>
                  <div className="p-3 rounded-xl bg-yellow-950/30 border border-yellow-500/40 space-y-1">
                    <div className="text-yellow-400 font-bold text-xs">信号球·黄</div>
                    <p className="text-[11px] text-neutral-400">专精于侵蚀控制与防御扰乱</p>
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-neutral-900/60 border border-neutral-800 space-y-2 text-xs">
                  <div className="text-terminalGold font-bold text-sm">信号球的三种来源：</div>
                  <ul className="list-disc list-inside space-y-1.5 text-neutral-300">
                    <li><strong className="text-white">手牌主动打出：</strong>放置到信号球区最上方，并抽 1 张牌（不触发充能自）。</li>
                    <li><strong className="text-terminalCyan">攻击充能翻出：</strong>触发【充能自】效果，正面放置到信号球区最上方。</li>
                    <li><strong className="text-erosionRed">伤害充能翻出：</strong>触发【充能自】效果，背面放置到费用区作为暗费。</li>
                  </ul>
                </div>

                <div className="p-4 rounded-xl bg-terminalCyan/5 border border-terminalCyan/30 space-y-2 text-xs">
                  <div className="text-terminalCyan font-bold text-sm">主要阶段消除信号球 (三消)：</div>
                  <p className="text-neutral-300 leading-relaxed">
                    在自己回合的主要阶段中，指挥官可以选择消除信号球区任意 <strong className="text-white">3 张相邻的信号球</strong>（或同色三消），将其放置到墓地，并<strong className="text-terminalGold font-bold">抽 1 张牌</strong>！
                    某些卡牌的代价需要消除指定颜色的相邻信号球（如消除2红球）。
                  </p>
                </div>
              </div>
            )}

            {/* 10. 牌组更新规则 */}
            {activeTab === 'deck-refresh' && (
              <div className="space-y-5 animate-in fade-in duration-150">
                <div className="border-b border-terminalBorder/60 pb-3">
                  <h3 className="text-lg font-bold text-white flex items-center gap-2">
                    <span className="text-terminalCyan">10.</span> 牌组更新规则
                  </h3>
                  <p className="text-xs text-neutral-400 font-mono mt-0.5">DECK REFRESH & PENALTY</p>
                </div>

                <div className="p-4 rounded-xl border border-erosionRed/40 bg-erosionRed/5 space-y-3 text-xs leading-relaxed">
                  <div className="text-erosionRed font-bold text-sm flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4" />
                    <span>牌组耗尽触发机制</span>
                  </div>
                  <p className="text-neutral-300">
                    当一方指挥官的牌组没有卡牌时，需立即将其墓地的所有卡牌以背面表示充分洗切后，作为新的牌组放置到牌组区域，该动作视为【牌组更新】。
                  </p>
                  <p className="text-terminalGold font-bold">
                    那之后，执行牌组更新的玩家的侵蚀计数 +1！
                  </p>
                  <p className="text-neutral-400">
                    （若存在正在进行的规则处理或能力处理，应先暂停；牌组更新完成后，继续处理未完成的行动）。
                  </p>
                </div>
              </div>
            )}

            {/* 11. 常用关键词图鉴 */}
            {activeTab === 'keywords' && (
              <div className="space-y-5 animate-in fade-in duration-150">
                <div className="border-b border-terminalBorder/60 pb-3">
                  <h3 className="text-lg font-bold text-white flex items-center gap-2">
                    <span className="text-terminalCyan">11.</span> 官方关键词与能力图标图鉴
                  </h3>
                  <p className="text-xs text-neutral-400 font-mono mt-0.5">ABILITY ICONS & KEYWORDS GLOSSARY</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                  <div className="p-3 bg-neutral-900/60 rounded-xl border border-neutral-800 space-y-1">
                    <div className="flex items-center gap-2 font-bold text-white">
                      <span className="px-1.5 py-0.5 rounded bg-terminalCyan/20 text-terminalCyan text-[11px] font-mono">【速攻】</span>
                    </div>
                    <p className="text-neutral-400">持有该能力的角色在出场的回合即可进行攻击（可攻击对方角色或玩家）。</p>
                  </div>

                  <div className="p-3 bg-neutral-900/60 rounded-xl border border-neutral-800 space-y-1">
                    <div className="flex items-center gap-2 font-bold text-white">
                      <span className="px-1.5 py-0.5 rounded bg-terminalGold/20 text-terminalGold text-[11px] font-mono">【突进】</span>
                    </div>
                    <p className="text-neutral-400">持有该能力的角色在出场的回合可以攻击对方角色（不能攻击对方玩家）。</p>
                  </div>

                  <div className="p-3 bg-neutral-900/60 rounded-xl border border-neutral-800 space-y-1">
                    <div className="flex items-center gap-2 font-bold text-white">
                      <span className="px-1.5 py-0.5 rounded bg-erosionRed/20 text-erosionRed text-[11px] font-mono">【贯通】</span>
                    </div>
                    <p className="text-neutral-400">在角色战斗步骤中战斗破坏角色时，额外给予被破坏角色的玩家 1 点伤害。</p>
                  </div>

                  <div className="p-3 bg-neutral-900/60 rounded-xl border border-neutral-800 space-y-1">
                    <div className="flex items-center gap-2 font-bold text-white">
                      <span className="px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-400 text-[11px] font-mono">【瞬时】</span>
                    </div>
                    <p className="text-neutral-400">瞬时能力。玩家在战斗自由时点步骤或回合结束阶段可以支付费用/代价使用。</p>
                  </div>

                  <div className="p-3 bg-neutral-900/60 rounded-xl border border-neutral-800 space-y-1">
                    <div className="flex items-center gap-2 font-bold text-white">
                      <span className="px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-200 text-[11px] font-mono">【出】(出场)</span>
                    </div>
                    <p className="text-neutral-400">卡牌进入战场时自动发动的能力。若带有“代价：”则可由玩家选择是否支付发动。</p>
                  </div>

                  <div className="p-3 bg-neutral-900/60 rounded-xl border border-neutral-800 space-y-1">
                    <div className="flex items-center gap-2 font-bold text-white">
                      <span className="px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-200 text-[11px] font-mono">【起】(起动)</span>
                    </div>
                    <p className="text-neutral-400">在自己回合主要阶段，由玩家主动支付相应代价（横置、费用或消球）发动的能力。</p>
                  </div>

                  <div className="p-3 bg-neutral-900/60 rounded-xl border border-neutral-800 space-y-1">
                    <div className="flex items-center gap-2 font-bold text-white">
                      <span className="px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-200 text-[11px] font-mono">【自】(自动)</span>
                    </div>
                    <p className="text-neutral-400">在对局中满足指定触发条件时强制自动执行的能力。</p>
                  </div>

                  <div className="p-3 bg-neutral-900/60 rounded-xl border border-neutral-800 space-y-1">
                    <div className="flex items-center gap-2 font-bold text-white">
                      <span className="px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-200 text-[11px] font-mono">【永】(永久)</span>
                    </div>
                    <p className="text-neutral-400">满足条件时持续生效的静态能力，随着条件的满足与否实时生效或失效。</p>
                  </div>

                  <div className="p-3 bg-neutral-900/60 rounded-xl border border-terminalCyan/40 bg-terminalCyan/5 col-span-1 md:col-span-2 space-y-1">
                    <div className="flex items-center gap-2 font-bold text-terminalCyan">
                      <span className="px-1.5 py-0.5 rounded bg-terminalCyan/20 text-terminalCyan text-[11px] font-mono">【充能自】(充能时自动)</span>
                    </div>
                    <p className="text-neutral-300">
                      仅在攻击充能或受到伤害充能（翻开至处理区）时触发的特殊自动能力。玩家从手牌主动打出信号球时只能发动其主要效果，不触发充能自。
                    </p>
                  </div>

                  <div className="p-3 bg-neutral-900/60 rounded-xl border border-neutral-800 space-y-1">
                    <div className="flex items-center gap-2 font-bold text-white">
                      <span className="px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-300 text-[11px] font-mono">【充能X】/【充能+X】</span>
                    </div>
                    <p className="text-neutral-400">
                      角色默认充能次数为1；记述有【充能0】则充能次数为0；【充能X】重置为X；【充能+X】在原本基础上增加X次。
                    </p>
                  </div>

                  <div className="p-3 bg-neutral-900/60 rounded-xl border border-neutral-800 space-y-1">
                    <div className="flex items-center gap-2 font-bold text-white">
                      <span className="px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-300 text-[11px] font-mono">【1回合1次】</span>
                    </div>
                    <p className="text-neutral-400">该卡牌对应的该项能力在每回合内最多只能发动或触发 1 次。</p>
                  </div>
                </div>
              </div>
            )}
          </main>
        </div>

        {/* 底部快捷栏 */}
        <div className="px-6 py-3 bg-neutral-950 border-t border-terminalBorder/60 flex items-center justify-between text-xs font-mono text-neutral-400 flex-shrink-0">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-terminalCyan animate-ping" />
            <span>战双帕弥什 TCG 综合规则 (A0 初版) • 终端数据库校验完毕</span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-terminalCyan hover:bg-terminalCyan/90 text-neutral-950 font-bold transition-all shadow-[0_0_15px_rgba(0,240,255,0.4)]"
          >
            完成查阅 [Esc]
          </button>
        </div>
      </div>
    </div>
  );
};

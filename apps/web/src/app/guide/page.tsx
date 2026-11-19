'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import {
  Flame,
  Swords,
  RotateCcw,
  AlertTriangle,
  Library,
} from 'lucide-react';
import {
  AppShell,
  Button,
  Badge,
  SectionHeader,
  HudCounter,
} from '@/components/ui';

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

const GUIDE_TABS: { id: GuideTab; code: string; label: string; en: string }[] = [
  { id: 'overview', code: '01', label: '游戏玩法与胜负', en: 'VICTORY CONDITIONS' },
  { id: 'card-types', code: '02', label: '卡牌种类与使用', en: 'CARD CATEGORIES' },
  { id: 'card-info', code: '03', label: '卡面信息详解', en: 'CARD STRUCTURE' },
  { id: 'field', code: '04', label: '场地七大区域', en: 'SEVEN GAME ZONES' },
  { id: 'deck-building', code: '05', label: '牌组构筑规则', en: 'DECK RESTRICTIONS' },
  { id: 'setup', code: '06', label: '开局准备与调度', en: 'MULLIGAN SEQUENCE' },
  { id: 'turn-flow', code: '07', label: '回合四大流程', en: 'TURN PHASES' },
  { id: 'combat-flow', code: '08', label: '战斗全流程', en: 'COMBAT STEPS' },
  { id: 'signal-orbs', code: '09', label: '信号球三消系统', en: 'SIGNAL ORBS' },
  { id: 'deck-refresh', code: '10', label: '牌组更新规则', en: 'DECK REFRESH' },
  { id: 'keywords', code: '11', label: '官方关键词图鉴', en: 'KEYWORDS GLOSSARY' },
];

const KEYWORDS: { tag: string; variant: 'teal' | 'gold' | 'crimson' | 'neutral'; desc: string }[] = [
  { tag: '【速攻】', variant: 'teal', desc: '持有该能力的角色在出场的回合即可进行攻击（可攻击对方角色或玩家）。' },
  { tag: '【突进】', variant: 'gold', desc: '持有该能力的角色在出场的回合可以攻击对方角色（不能攻击对方玩家）。' },
  { tag: '【贯通】', variant: 'crimson', desc: '在角色战斗步骤中战斗破坏角色时，额外给予被破坏角色的玩家 1 点伤害。' },
  { tag: '【瞬时】', variant: 'gold', desc: '瞬时能力。玩家在战斗自由时点步骤或回合结束阶段可以支付费用/代价使用。' },
  { tag: '【出】(出场)', variant: 'neutral', desc: '卡牌进入战场时自动发动的能力。若带有“代价：”则可由玩家选择是否支付发动。' },
  { tag: '【起】(起动)', variant: 'neutral', desc: '在自己回合主要阶段，由玩家主动支付相应代价（横置、费用或消球）发动的能力。' },
  { tag: '【自】(自动)', variant: 'neutral', desc: '在对局中满足指定触发条件时强制自动执行的能力。' },
  { tag: '【永】(永久)', variant: 'neutral', desc: '满足条件时持续生效的静态能力，随着条件的满足与否实时生效或失效。' },
  {
    tag: '【充能自】(充能时自动)',
    variant: 'teal',
    desc: '仅在攻击充能或受到伤害充能（翻开至处理区）时触发的特殊自动能力。从手牌主动打出信号球时只能发动其主要效果，不触发充能自。',
  },
  {
    tag: '【充能X】/【充能+X】',
    variant: 'neutral',
    desc: '角色默认充能次数为 1；记述有【充能0】则充能次数为 0；【充能X】重置为 X；【充能+X】在原本基础上增加 X 次。',
  },
  { tag: '【1回合1次】', variant: 'neutral', desc: '该卡牌对应的该项能力在每回合内最多只能发动或触发 1 次。' },
];

export default function GuidePage() {
  const [activeTab, setActiveTab] = useState<GuideTab>('overview');
  const activeIndex = GUIDE_TABS.findIndex((t) => t.id === activeTab);
  const currentMeta = GUIDE_TABS[activeIndex] || GUIDE_TABS[0];

  return (
    <AppShell className="space-y-6">
      <SectionHeader
        code="SECTOR 05 // OFFICIAL RULES V1.4"
        pageLabel={`${currentMeta.code} / ${String(GUIDE_TABS.length).padStart(2, '0')}`}
        title="新手作战指南"
        subtitle="OFFICIAL COMPREHENSIVE RULEBOOK"
        action={
          <>
            <Link href="/cards">
              <Button variant="secondary" size="md">
                <Library className="w-4 h-4" />
                <span>查阅图鉴</span>
              </Button>
            </Link>
            <Link href="/rooms">
              <Button variant="primary" size="md">
                <Swords className="w-4 h-4" />
                <span>实战大厅</span>
              </Button>
            </Link>
          </>
        }
      />

      {/* 移动端横向章节导航 */}
      <div className="lg:hidden flex gap-1.5 overflow-x-auto pb-2 border-b border-line">
        {GUIDE_TABS.map((tab) => {
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`shrink-0 h-8 px-3 border text-caption transition-colors cursor-pointer ${
                active
                  ? 'border-crimson-500 bg-crimson-500/20 text-fg font-semibold'
                  : 'border-line bg-ink-850 text-fg-muted hover:text-fg'
              }`}
            >
              <span className="font-num mr-1 text-crimson-400">{tab.code}</span>
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* 桌面端左目录右正文布局 */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* 左侧官网竖向导航 */}
        <aside className="hidden lg:block lg:col-span-3 border border-line bg-ink-900 sticky top-20">
          <div className="px-4 py-3 border-b border-line flex items-center justify-between">
            <span className="font-display text-hud uppercase text-fg-muted">
              DIRECTORY // 目录
            </span>
            <HudCounter current={activeIndex + 1} total={GUIDE_TABS.length} />
          </div>
          <nav aria-label="规则章节目录" className="py-2">
            {GUIDE_TABS.map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 text-left border-l-2 transition-colors duration-fast cursor-pointer ${
                    isActive
                      ? 'border-crimson-500 bg-ink-800 text-fg font-medium'
                      : 'border-transparent text-fg-secondary hover:bg-ink-850 hover:text-fg'
                  }`}
                >
                  <span
                    className={`font-num text-caption tabular-nums ${
                      isActive ? 'text-crimson-400 font-semibold' : 'text-fg-disabled'
                    }`}
                  >
                    {tab.code}
                  </span>
                  <span className="text-body-sm truncate">{tab.label}</span>
                </button>
              );
            })}
          </nav>
        </aside>

        {/* 右侧阅读内容区 */}
        <article className="lg:col-span-9 border border-line bg-ink-850 p-6 md:p-8 space-y-6 text-body leading-relaxed animate-in fade-in duration-fast" key={activeTab}>
          <div className="border-b border-line pb-4 flex items-end justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 font-display text-hud uppercase text-fg-muted">
                <span className="text-crimson-400 font-num font-semibold">CHAPTER {currentMeta.code}</span>
                <span>{'//'}</span>
                <span>{currentMeta.en}</span>
              </div>
              <h2 className="text-title font-bold text-fg mt-1">{currentMeta.label}</h2>
            </div>
            <HudCounter current={activeIndex + 1} total={GUIDE_TABS.length} />
          </div>

          {activeTab === 'overview' && (
            <div className="space-y-6">
              <div className="border-l-2 border-crimson-500 bg-ink-900 p-5 space-y-2.5">
                <div className="flex items-center gap-2 text-title-sm font-semibold text-fg">
                  <Flame className="w-5 h-5 text-crimson-400" />
                  <span>帕弥什病毒侵蚀胜负规则</span>
                </div>
                <p className="text-fg-secondary">
                  在游戏过程中，双方通过卡牌战斗，使对手的帕弥什病毒侵蚀计数从{' '}
                  <strong className="font-num text-fg">0</strong> 开始增加。当一方玩家的侵蚀计数达到{' '}
                  <strong className="font-num text-crimson-400 text-title-sm">7</strong> 时，其被完全侵蚀，在对战中直接落败。
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 border border-line bg-ink-900 space-y-2">
                  <div className="text-body font-semibold text-fg flex items-center gap-2">
                    <Swords className="w-4 h-4 text-gold-300" />
                    <span>直接攻击玩家（伤害侵蚀）</span>
                  </div>
                  <p className="text-body-sm text-fg-secondary">
                    攻击对方玩家且对方未进行阻挡时，根据攻击角色的 DP 数值，对手依次执行相同次数的【伤害充能】，每次充能完成后侵蚀计数 +1。
                  </p>
                </div>
                <div className="p-4 border border-line bg-ink-900 space-y-2">
                  <div className="text-body font-semibold text-fg flex items-center gap-2">
                    <RotateCcw className="w-4 h-4 text-teal-400" />
                    <span>牌组更新惩罚</span>
                  </div>
                  <p className="text-body-sm text-fg-secondary">
                    当牌组抽空时，需将己方墓地所有卡牌洗切作为新牌组（牌组更新），更新完毕后侵蚀计数惩罚性 +1。
                  </p>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'card-types' && (
            <div className="space-y-6">
              <div className="p-5 border border-line bg-ink-900 space-y-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <Badge variant="teal">ROLE</Badge>
                    <h3 className="text-title-sm font-semibold text-fg">角色牌</h3>
                  </div>
                  <span className="text-caption text-fg-muted">主力战斗单位</span>
                </div>
                <p className="text-body-sm text-fg-secondary">
                  出场到战场进行战斗的卡牌。包含 PP（攻击力）、DP（伤害值）、属性、费用以及特征。
                </p>
                <div className="bg-ink-950 p-4 border border-line text-body-sm space-y-2">
                  <div className="font-semibold text-gold-300">出场方式：</div>
                  <ul className="list-disc list-inside space-y-1.5 text-fg-secondary">
                    <li>
                      <strong className="text-fg">正规使用：</strong>放置到己方战场空余卡位（战场共 5 个卡位）。
                    </li>
                    <li>
                      <strong className="text-fg">升变登场：</strong>持有《升变》能力的角色牌，在满足《升变条件》与属性要求时，支付《升变代价》，重叠在指定对象上方。
                      <span className="text-teal-400">
                        作为升变对象的卡牌原有状态会被刷新，升变角色以正面竖直状态出场。
                      </span>
                      （离开战场时，下方所有卡牌送入墓地）。
                    </li>
                  </ul>
                </div>
              </div>

              <div className="p-5 border border-line bg-ink-900 space-y-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <Badge variant="gold">ITEM</Badge>
                    <h3 className="text-title-sm font-semibold text-fg">道具牌（装备牌 & 辅助机牌）</h3>
                  </div>
                  <span className="text-caption text-fg-muted">持续强化 · 战场增益</span>
                </div>
                <p className="text-body-sm text-fg-secondary">
                  存在于战场，为战场的角色提供持续性增益的卡牌，不能直接进行战斗。
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-body-sm">
                  <div className="p-4 bg-ink-950 border border-line space-y-1.5">
                    <div className="font-semibold text-gold-300">1. 装备牌 (Equipment)</div>
                    <p className="text-fg-secondary">
                      每张角色只能装备 1 张装备牌。出场可放空卡位或直接置于未装备角色下方；角色离场时装备随之送入墓地。
                    </p>
                  </div>
                  <div className="p-4 bg-ink-950 border border-line space-y-1.5">
                    <div className="font-semibold text-teal-400">2. 辅助机牌 (Assist)</div>
                    <p className="text-fg-secondary">
                      每名玩家战场只能存在 1 张辅助机牌。若战场已存在辅助机牌，出场新辅助机时必须将原有辅助机送入墓地。
                    </p>
                  </div>
                </div>
              </div>

              <div className="p-5 border border-line bg-ink-900 space-y-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <Badge variant="crimson">TACTICS</Badge>
                    <h3 className="text-title-sm font-semibold text-fg">战术牌（普通战术 & 瞬时战术）</h3>
                  </div>
                  <span className="text-caption text-fg-muted">即时收益 · 关键策略</span>
                </div>
                <p className="text-body-sm text-fg-secondary">
                  直接从手牌打出、进入处理区即时处理的卡牌，能力处理完毕后送入墓地。
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-body-sm">
                  <div className="p-4 bg-ink-950 border border-line space-y-1">
                    <div className="font-semibold text-fg">普通战术牌</div>
                    <p className="text-fg-secondary">只能在自己回合的主要阶段（空闲时点）使用。</p>
                  </div>
                  <div className="p-4 bg-ink-950 border border-line space-y-1">
                    <div className="font-semibold text-teal-400">瞬时战术牌 (Instant)</div>
                    <p className="text-fg-secondary">在战斗流程的自由时点步骤（阻挡前后）以及回合结束阶段使用。</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'card-info' && (
            <div className="space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-body-sm">
                <div className="p-4 bg-ink-900 border border-line space-y-1">
                  <div className="font-semibold text-gold-300">1. 费用（左上角）</div>
                  <p className="text-fg-secondary">使用卡牌需要支付的明费/暗费总额。</p>
                </div>
                <div className="p-4 bg-ink-900 border border-line space-y-1">
                  <div className="font-semibold text-teal-400">2. 属性（右上角）</div>
                  <p className="text-fg-secondary">
                    卡牌的元素属性（火/暗/物理/雷/冰/空）。费用区必须至少存在 1 张对应属性的明费方可使用。
                  </p>
                </div>
                <div className="p-4 bg-ink-900 border border-line space-y-1">
                  <div className="font-semibold text-fg">3. PP（战斗力/攻击力）</div>
                  <p className="text-fg-secondary">
                    战斗时与对方角色比拼数值。攻方 PP ≥ 防守方 PP 时破坏对方角色。
                  </p>
                </div>
                <div className="p-4 bg-ink-900 border border-line space-y-1">
                  <div className="font-semibold text-crimson-400">4. DP（伤害值）</div>
                  <p className="text-fg-secondary">
                    攻击对方玩家成功时给予的伤害次数（触发相同次数的伤害充能，每次侵蚀 +1）。
                  </p>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'field' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-body-sm">
              <div className="p-4 bg-ink-900 border border-line">
                <div className="font-semibold text-teal-400">① 战场区 (Battlefield)</div>
                <p className="text-fg-secondary mt-1">角色牌和道具牌出场及战斗区域，每位指挥官拥有 5 个卡位。</p>
              </div>
              <div className="p-4 bg-ink-900 border border-line">
                <div className="font-semibold text-gold-300">② 牌组 (Deck)</div>
                <p className="text-fg-secondary mt-1">放置牌组的区域，必须由刚好 50 张卡牌构成。</p>
              </div>
              <div className="p-4 bg-ink-900 border border-line">
                <div className="font-semibold text-crimson-400">③ 侵蚀计数区 (Erosion)</div>
                <p className="text-fg-secondary mt-1">记录自身所受侵蚀计数的刻度（0~7）。达到 7 即败北。</p>
              </div>
              <div className="p-4 bg-ink-900 border border-line">
                <div className="font-semibold text-fg">④ 墓地 (Graveyard)</div>
                <p className="text-fg-secondary mt-1">放置已使用、被战斗破坏或离开战场的卡牌。</p>
              </div>
              <div className="p-4 bg-ink-900 border-l-2 border-teal-400 border border-line md:col-span-2 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-fg">⑤ 费用区 (Cost Zone) · 明费与暗费（上限 10 张）</span>
                  <Badge variant="gold">核心规则</Badge>
                </div>
                <ul className="list-disc list-inside space-y-1 text-fg-secondary">
                  <li><strong className="text-fg">明费：</strong>正面表示的卡牌。支付费用时将竖直状态的明费横置。</li>
                  <li>
                    <strong className="text-fg">暗费：</strong>背面竖直表示的卡牌（受伤害充能产生）。支付费用时移至墓地；
                    <span className="text-gold-300">回合玩家未使用的暗费在回合结束阶段全部送入墓地。</span>
                  </li>
                  <li>
                    <strong className="text-fg">10 张上限限制：</strong>费用区明费与暗费合计上限为 10 张，超出部分改为直接送入墓地。
                  </li>
                </ul>
              </div>
              <div className="p-4 bg-ink-900 border border-line">
                <div className="font-semibold text-gold-300">⑥ 信号球区 (Signal Orb Zone)</div>
                <p className="text-fg-secondary mt-1">放置红、蓝、黄信号球的队列区域，数量无上限，顺序不可随意变动。</p>
              </div>
              <div className="p-4 bg-ink-900 border border-line">
                <div className="font-semibold text-steel-300">⑦ 处理区 (Processing Zone)</div>
                <p className="text-fg-secondary mt-1">能力处理、攻击充能及伤害充能时卡牌临时公开放置该区域。</p>
              </div>
            </div>
          )}

          {activeTab === 'deck-building' && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="p-5 border border-line bg-ink-900 text-center space-y-2">
                <div className="font-num text-display font-bold text-teal-400">50</div>
                <div className="font-semibold text-fg text-body">牌组固定总张数</div>
                <p className="text-caption text-fg-secondary">牌组必须刚好由 50 张卡牌构成，不能多也不能少。</p>
              </div>
              <div className="p-5 border border-line bg-ink-900 text-center space-y-2">
                <div className="font-num text-display font-bold text-gold-300">≤ 4</div>
                <div className="font-semibold text-fg text-body">同名/同卡号上限</div>
                <p className="text-caption text-fg-secondary">牌组中相同卡号或同名卡牌最多投入 4 张（含异画）。</p>
              </div>
              <div className="p-5 border border-line bg-ink-900 text-center space-y-2">
                <div className="font-num text-display font-bold text-crimson-400">4+4+4</div>
                <div className="font-semibold text-fg text-body">信号球必选投入</div>
                <p className="text-caption text-fg-secondary">必须投入 4 张红球、4 张蓝球与 4 张黄球（共 12 张）。</p>
              </div>
            </div>
          )}

          {activeTab === 'setup' && (
            <div className="space-y-3 text-body-sm">
              {[
                { n: '01', title: '初始化侵蚀与洗牌', desc: '双方充分洗切牌组，并将各自的侵蚀计数设置为 0。' },
                { n: '02', title: '确定先后手', desc: '系统随机掷点决定先后手顺序。' },
                {
                  n: '03',
                  title: '手牌调度机会 (5.2.1.e)',
                  desc: '双方各自抽取 4 张手牌。先攻与后攻玩家各自仅有 1 次机会选择任意张数手牌放置到牌组底，从牌组顶抽取相同数量的牌，最后洗切牌组。',
                  highlight: true,
                },
                {
                  n: '04',
                  title: '填充起始明费',
                  desc: '手牌调度与洗切完成后，双方将牌组顶 2 张牌正面竖直放置到费用区作为初始明费。',
                },
              ].map((step) => (
                <div
                  key={step.n}
                  className={`flex gap-4 items-start p-4 border ${
                    step.highlight
                      ? 'border-gold-300/60 bg-gold-300/5'
                      : 'border-line bg-ink-900'
                  }`}
                >
                  <span className="font-num text-caption font-bold text-crimson-400 border border-line bg-ink-950 px-2 py-1 shrink-0">
                    {step.n}
                  </span>
                  <div>
                    <div className="font-semibold text-fg">{step.title}</div>
                    <p className="text-fg-secondary mt-1">{step.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {activeTab === 'turn-flow' && (
            <div className="space-y-4 text-body-sm">
              <div className="p-4 bg-ink-900 border border-line">
                <div className="font-semibold text-teal-400">阶段 1 · 竖直阶段 (Upkeep Phase)</div>
                <p className="text-fg-secondary mt-1">回合玩家将自己战场和费用区的所有横置状态卡牌转为竖直状态。</p>
              </div>
              <div className="p-4 bg-ink-900 border border-line space-y-1.5">
                <div className="font-semibold text-gold-300">阶段 2 · 抽牌填充阶段 (Draw & Charge Phase)</div>
                <ul className="list-disc list-inside text-fg-secondary space-y-1">
                  <li><strong className="text-fg">抽牌：</strong>从牌组顶抽 2 张牌（先攻第 1 回合只抽 1 张）。</li>
                  <li><strong className="text-fg">填充：</strong>可将最多 1 张手牌正面竖直放入费用区作为明费。</li>
                </ul>
              </div>
              <div className="p-4 bg-ink-900 border-l-2 border-crimson-500 border border-line space-y-2">
                <div className="font-semibold text-fg">阶段 3 · 主要阶段 (Main Phase)</div>
                <ol className="list-decimal list-inside space-y-1 text-fg-secondary">
                  <li>使用手牌卡牌（需满足属性并支付费用）。</li>
                  <li>发动战场卡牌的【起】动能力（支付相应代价）。</li>
                  <li>将战场未装备的装备牌装备到角色下方。</li>
                  <li>消除 3 张相邻信号球并抽 1 张牌。</li>
                  <li>宣告可以攻击的角色进行攻击（进入战斗流程）。</li>
                  <li>宣言回合结束，进入结束阶段。</li>
                </ol>
              </div>
              <div className="p-4 bg-ink-900 border border-line space-y-1.5">
                <div className="font-semibold text-steel-300">阶段 4 · 结束阶段 (End Phase)</div>
                <ol className="list-decimal list-inside space-y-1 text-fg-secondary">
                  <li>双方轮流使用瞬时战术/瞬时能力（回合玩家优先）。</li>
                  <li>处理结束阶段效果。</li>
                  <li>手牌上限检查：若回合玩家手牌 &gt; 7 张，弃置至 7 张。</li>
                  <li><strong className="text-gold-300">清理暗费：</strong>将回合玩家费用区的所有暗费送入墓地。</li>
                </ol>
              </div>
            </div>
          )}

          {activeTab === 'combat-flow' && (
            <div className="space-y-4 text-body-sm">
              {[
                {
                  title: '1. 攻击宣言步骤 (Attack Declaration)',
                  body: '横置己方 1 张竖直角色并选择攻击对象（对方玩家或对方横置角色）。出场当回合不能攻击（除非持有【速攻】或【突进】）。',
                },
                {
                  title: '2. 自由时点与阻挡 (Free Timing & Block)',
                  body: '由回合外玩家开始轮流使用瞬时能力。随后，被攻击玩家可横置 1 张竖直角色进行阻挡，将攻击目标转移给阻挡者。',
                },
                {
                  title: '3. 充能步骤 (Attack Charge Step)',
                  body: '攻击角色按充能次数（默认 1 次）翻开牌组顶放入处理区：非信号球直接加入手牌；信号球发动【充能自】后正面置于信号球区顶。',
                },
                {
                  title: '4. 角色战斗步骤 (PP Comparison)',
                  body: '比较双方角色的 PP 值。若攻方 PP ≥ 防守方 PP，被攻击角色被战斗破坏送入墓地；否则无事发生。',
                },
                {
                  title: '5. 伤害步骤 (Damage Step & Damage Charge)',
                  body: '攻击玩家未被阻挡时，根据攻方 DP 依次执行伤害充能，每次充能完成受伤方侵蚀 +1，翻开卡牌背面置入费用区作为暗费（信号球先触发【充能自】）。',
                  danger: true,
                },
              ].map((step) => (
                <div
                  key={step.title}
                  className={`p-4 border ${
                    step.danger
                      ? 'border-crimson-500/60 bg-crimson-700/15'
                      : 'border-line bg-ink-900'
                  }`}
                >
                  <div className={`font-semibold ${step.danger ? 'text-crimson-400' : 'text-fg'}`}>
                    {step.title}
                  </div>
                  <p className="text-fg-secondary mt-1">{step.body}</p>
                </div>
              ))}
            </div>
          )}

          {activeTab === 'signal-orbs' && (
            <div className="space-y-5 text-body-sm">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="p-4 border border-orb-red/50 bg-ink-900 space-y-1.5">
                  <div className="flex items-center gap-2 font-semibold text-orb-red">
                    <span className="h-5 w-5 rounded-full bg-orb-red text-ink-950 font-num text-hud inline-flex items-center justify-center font-bold">
                      R
                    </span>
                    <span>信号球 · 红</span>
                  </div>
                  <p className="text-caption text-fg-secondary">专精于爆发输出与攻击强化</p>
                </div>
                <div className="p-4 border border-orb-blue/50 bg-ink-900 space-y-1.5">
                  <div className="flex items-center gap-2 font-semibold text-orb-blue">
                    <span className="h-5 w-5 rounded-full bg-orb-blue text-ink-950 font-num text-hud inline-flex items-center justify-center font-bold">
                      B
                    </span>
                    <span>信号球 · 蓝</span>
                  </div>
                  <p className="text-caption text-fg-secondary">专精于资源循环与抽牌检索</p>
                </div>
                <div className="p-4 border border-orb-yellow/50 bg-ink-900 space-y-1.5">
                  <div className="flex items-center gap-2 font-semibold text-orb-yellow">
                    <span className="h-5 w-5 rounded-full bg-orb-yellow text-ink-950 font-num text-hud inline-flex items-center justify-center font-bold">
                      Y
                    </span>
                    <span>信号球 · 黄</span>
                  </div>
                  <p className="text-caption text-fg-secondary">专精于侵蚀控制与防御扰乱</p>
                </div>
              </div>

              <div className="p-5 bg-ink-900 border border-line space-y-2.5">
                <div className="font-semibold text-gold-300">信号球的三种来源</div>
                <ul className="list-disc list-inside space-y-1.5 text-fg-secondary">
                  <li><strong className="text-fg">手牌主动打出：</strong>放置到信号球区最上方，并抽 1 张牌（不触发充能自）。</li>
                  <li><strong className="text-teal-400">攻击充能翻出：</strong>触发【充能自】效果，正面放置到信号球区最上方。</li>
                  <li><strong className="text-crimson-400">伤害充能翻出：</strong>触发【充能自】效果，背面放置到费用区作为暗费。</li>
                </ul>
              </div>

              <div className="p-5 bg-ink-900 border-l-2 border-teal-400 border border-line space-y-2">
                <div className="font-semibold text-fg">主要阶段消除信号球（三消）</div>
                <p className="text-fg-secondary">
                  在自己回合的主要阶段中，可消除信号球区任意 <strong className="text-fg">3 张相邻的信号球</strong>，将其放置到墓地并{' '}
                  <strong className="text-gold-300">抽 1 张牌</strong>。部分卡牌代价也会要求消除特定颜色的相邻信号球。
                </p>
              </div>
            </div>
          )}

          {activeTab === 'deck-refresh' && (
            <div className="p-5 border border-crimson-500/60 bg-crimson-700/15 space-y-3 text-body-sm">
              <div className="font-semibold text-crimson-400 text-title-sm flex items-center gap-2">
                <AlertTriangle className="w-5 h-5" />
                <span>牌组耗尽触发机制</span>
              </div>
              <p className="text-fg-secondary">
                当一方指挥官的牌组没有卡牌时，需立即将其墓地的所有卡牌以背面表示充分洗切后，作为新的牌组放置到牌组区域，该动作视为【牌组更新】。
              </p>
              <p className="text-gold-300 font-semibold">
                那之后，执行牌组更新的玩家的侵蚀计数 +1。
              </p>
              <p className="text-caption text-fg-muted">
                若存在正在进行的规则处理或能力处理，应先暂停；牌组更新完成后，继续处理未完成的行动。
              </p>
            </div>
          )}

          {activeTab === 'keywords' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-body-sm">
              {KEYWORDS.map((kw) => (
                <div
                  key={kw.tag}
                  className="p-4 border border-line bg-ink-900 space-y-2"
                >
                  <Badge variant={kw.variant}>{kw.tag}</Badge>
                  <p className="text-fg-secondary">{kw.desc}</p>
                </div>
              ))}
            </div>
          )}
        </article>
      </div>
    </AppShell>
  );
}

'use client';

import React from 'react';
import Link from 'next/link';
import {
  Swords,
  Layers,
  Library,
  BookOpen,
  History,
  ArrowUpRight,
  ChevronRight,
  Radio,
  ShieldCheck,
  Sparkles,
  LogIn,
} from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import {
  AppShell,
  Button,
  Badge,
  SectionHeader,
  HudBrackets,
  HudRule,
  HudStripes,
  HudCounter,
} from '@/components/ui';

interface EntryCard {
  code: string;
  href: string;
  title: string;
  en: string;
  desc: string;
  icon: React.ComponentType<{ className?: string }>;
  tag: string;
}

const ENTRY_CARDS: EntryCard[] = [
  {
    code: '01',
    href: '/rooms',
    title: '进入对战大厅',
    en: 'BATTLE LOBBY',
    desc: '创建战术房间或输入房间 ID 定向联机，体验实时权威双人对抗。',
    icon: Swords,
    tag: '实时联机',
  },
  {
    code: '02',
    href: '/decks',
    title: '战术卡组构筑',
    en: 'DECK ARCHITECT',
    desc: '50 张精准编组、红蓝黄信号球合规校验，支持官方预组与自定义同步。',
    icon: Layers,
    tag: '规则校验',
  },
  {
    code: '03',
    href: '/cards',
    title: '全维卡牌图鉴',
    en: 'CARD ARCHIVE',
    desc: '收录角色、战术、装备、辅助机与升变形态全量数据，支持多维检索。',
    icon: Library,
    tag: '全量卡池',
  },
  {
    code: '04',
    href: '/guide',
    title: '新手作战指南',
    en: 'COMBAT MANUAL',
    desc: '官方《综合规则》V1.4 图解手册，快速掌握信号球三消与瞬时反制。',
    icon: BookOpen,
    tag: '综合规则',
  },
];

const SYSTEM_SPECS = [
  { label: '规则核心版本', value: 'V1.4', en: 'RULES ENGINE' },
  { label: '官方收录卡池', value: '490+', en: 'CARD POOL' },
  { label: '单套编组标准', value: '50', en: 'DECK SIZE' },
  { label: '对局仲裁模式', value: 'AUTH', en: 'SERVER SIDE' },
];

export default function HomePage() {
  const { user, isLoggedIn } = useAuth();

  return (
    <AppShell className="space-y-12 md:space-y-16">
      {/* ================= HERO 战术主屏 ================= */}
      <section className="relative border border-line bg-ink-900 overflow-hidden pgr-enter">
        <HudBrackets color="steel" />

        {/* 背景超大半透明英文水印 (design-spec 5.3) */}
        <span
          aria-hidden="true"
          className="pointer-events-none select-none absolute -right-6 -bottom-6 font-display font-bold uppercase text-fg/[0.04] pgr-watermark whitespace-nowrap"
        >
          PUNISHING
        </span>

        {/* 左侧绯红垂直坐标装饰条 */}
        <div
          aria-hidden="true"
          className="absolute left-0 top-0 bottom-0 w-1 bg-crimson-500"
        />

        <div className="relative z-10 px-6 py-10 md:px-12 md:py-14 grid grid-cols-1 lg:grid-cols-12 gap-8 items-end">
          <div className="lg:col-span-8 space-y-6">
            {/* 顶部 HUD 状态标尺 */}
            <div className="flex flex-wrap items-center gap-3">
              <Badge variant="crimson">BABYLONIA // ONLINE</Badge>
              <span className="inline-flex items-center gap-1.5 text-caption text-fg-muted">
                <Radio className="w-3.5 h-3.5 text-teal-400" />
                <span>服务端权威规则引擎已就绪</span>
              </span>
              <HudCounter current={1} total={4} prefix="SECTOR" className="hidden sm:inline-flex ml-auto lg:ml-2" />
            </div>

            {/* 主标题 */}
            <div className="space-y-3">
              <p className="font-display text-hud uppercase text-fg-muted flex items-center gap-2">
                <span aria-hidden="true" className="h-px w-6 bg-crimson-500 pgr-line-draw" />
                PUNISHING: GRAY RAVEN // TRADING CARD GAME
              </p>

              <h1 className="text-display md:text-banner font-bold tracking-tight text-fg leading-tight">
                {isLoggedIn && user ? (
                  <>
                    欢迎归队，指挥官{' '}
                    <span className="text-crimson-400">{user.nickname}</span>
                  </>
                ) : (
                  <>
                    接入战双
                    <span className="text-crimson-500 ml-2">战术卡牌终端</span>
                  </>
                )}
              </h1>

              <p className="text-body text-fg-secondary max-w-2xl leading-relaxed">
                {isLoggedIn
                  ? '空中花园战术通讯信道畅通。信号球三消抽卡、角色升变重叠出场、伤害充能转化暗费与侵蚀度实时裁定系统全部上线，随时投入演习。'
                  : '基于《战双帕弥什 卡牌对战》官方《综合规则》V1.4 构建的在线双人实时竞技平台。支持卡组合规验证、全流程权威仲裁与对局复盘回放。'}
              </p>
            </div>

            {/* 主操作行动区（每屏仅一个绯红主按钮） */}
            <div className="flex flex-wrap items-center gap-3 pt-2">
              <Link href="/rooms">
                <Button variant="primary" size="lg">
                  <Swords className="w-4 h-4" />
                  <span>进入对战大厅</span>
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </Link>

              <Link href="/decks">
                <Button variant="secondary" size="lg">
                  <Layers className="w-4 h-4" />
                  <span>构筑我的卡组</span>
                </Button>
              </Link>

              {!isLoggedIn && (
                <Link href="/login">
                  <Button variant="ghost" size="lg">
                    <LogIn className="w-4 h-4" />
                    <span>登录指挥官档案</span>
                  </Button>
                </Link>
              )}
            </div>
          </div>

          {/* 右侧终端实时态势卡 */}
          <div className="lg:col-span-4 border border-line bg-ink-850/90 p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-line pb-2.5">
              <span className="font-display text-hud uppercase text-fg-muted">
                TERMINAL STATUS
              </span>
              <span className="inline-flex items-center gap-1.5 text-caption text-success font-num">
                <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-success" />
                SYNC OK
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {SYSTEM_SPECS.map((spec) => (
                <div
                  key={spec.en}
                  className="border border-line bg-ink-900/70 px-3 py-2.5"
                >
                  <div className="font-num tabular-nums text-title font-bold text-fg">
                    {spec.value}
                  </div>
                  <div className="text-caption text-fg-secondary mt-0.5">
                    {spec.label}
                  </div>
                  <div
                    aria-hidden="true"
                    className="font-display text-hud uppercase text-fg-disabled mt-0.5"
                  >
                    {spec.en}
                  </div>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between pt-1 text-caption text-fg-muted">
              <Link
                href="/history"
                className="inline-flex items-center gap-1.5 text-fg-secondary hover:text-fg transition-colors duration-fast"
              >
                <History className="w-3.5 h-3.5 text-teal-400" />
                <span>查看最新战局回放</span>
              </Link>
              <HudStripes className="w-14 h-2.5" />
            </div>
          </div>
        </div>
      </section>

      {/* ================= 核心作战模块入口 ================= */}
      <section className="space-y-6 pgr-enter pgr-delay-1">
        <SectionHeader
          align="center"
          code="OPERATION"
          title="战术模块接入"
          subtitle="TACTICAL MODULES"
          watermark="MODULES"
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {ENTRY_CARDS.map((card, index) => {
            const Icon = card.icon;
            return (
              <Link
                key={card.href}
                href={card.href}
                className={`group relative border border-line bg-ink-850 p-5 flex flex-col justify-between min-h-[210px] pgr-sweep transition-colors duration-fast ease-enter hover:bg-ink-800 hover:border-line-strong pgr-enter pgr-delay-${Math.min(index + 1, 4)}`}
              >
                <HudBrackets color="steel" interactive />

                {/* 悬停左侧 2px 绯红激活指示条 */}
                <span
                  aria-hidden="true"
                  className="absolute left-0 top-0 bottom-0 w-0.5 bg-crimson-500 scale-y-0 origin-top transition-transform duration-base ease-enter group-hover:scale-y-100"
                />

                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="font-num tabular-nums text-caption font-semibold text-crimson-400">
                      {card.code}
                    </span>
                    <Badge variant="neutral">{card.tag}</Badge>
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 border border-line bg-ink-900 flex items-center justify-center text-fg-secondary group-hover:text-fg group-hover:border-line-strong transition-colors duration-fast">
                      <Icon className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="text-title-sm font-semibold text-fg">
                        {card.title}
                      </h3>
                      <p className="font-display text-hud uppercase text-fg-muted">
                        {card.en}
                      </p>
                    </div>
                  </div>

                  <p className="text-body-sm text-fg-secondary leading-relaxed">
                    {card.desc}
                  </p>
                </div>

                <div className="mt-5 pt-3 border-t border-line flex items-center justify-between text-caption text-fg-muted group-hover:text-fg transition-colors duration-fast">
                  <span className="font-display text-hud uppercase">ACCESS MODULE</span>
                  <ArrowUpRight className="w-4 h-4 transition-transform duration-fast ease-enter group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      {/* ================= 规则核心特性概览 ================= */}
      <section className="space-y-6 pgr-enter pgr-delay-2">
        <HudRule code="SYSTEM ARCHITECTURE // 02" />

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="border border-line bg-ink-850 p-5 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-display text-hud uppercase text-fg-muted">
                PROTOCOL 01
              </span>
              <ShieldCheck className="w-4 h-4 text-teal-400" />
            </div>
            <h3 className="text-title-sm font-semibold text-fg">服务端唯一权威裁定</h3>
            <p className="text-body-sm text-fg-secondary leading-relaxed">
              所有出牌、攻击、瞬时反制与伤害充能均由规则引擎事务性结算，手牌与暗费严格脱敏下发。
            </p>
          </div>

          <div className="border border-line bg-ink-850 p-5 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-display text-hud uppercase text-fg-muted">
                PROTOCOL 02
              </span>
              <Sparkles className="w-4 h-4 text-gold-300" />
            </div>
            <h3 className="text-title-sm font-semibold text-fg">信号球三消与升变机制</h3>
            <p className="text-body-sm text-fg-secondary leading-relaxed">
              完整还原红蓝黄信号球队列与三消补牌、角色叠层升变、装备附着与自由时点瞬时对抗。
            </p>
          </div>

          <div className="border border-line bg-ink-850 p-5 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-display text-hud uppercase text-fg-muted">
                PROTOCOL 03
              </span>
              <History className="w-4 h-4 text-crimson-400" />
            </div>
            <h3 className="text-title-sm font-semibold text-fg">全对局事件回放复盘</h3>
            <p className="text-body-sm text-fg-secondary leading-relaxed">
              完整记录每回合行动序列与战场状态，支持对局结束后随时回看关键决策与胜负转折点。
            </p>
          </div>
        </div>
      </section>
    </AppShell>
  );
}

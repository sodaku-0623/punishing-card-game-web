'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Menu,
  X,
  Shield,
  LogIn,
  LogOut,
  Edit3,
  Check,
  User,
} from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { cn } from '@/lib/cn';
import { Button } from './Button';
import { Badge } from './Badge';
import { Dialog } from './Dialog';
import { Input } from './Input';
import { HudCaution, HudRule, HudStripes } from './hud';

interface NavItem {
  href: string;
  label: string;
  en: string;
  code: string;
}

const NAV_ITEMS: NavItem[] = [
  { href: '/rooms', label: '大厅对战', en: 'LOBBY', code: '01' },
  { href: '/decks', label: '构筑卡组', en: 'DECKS', code: '02' },
  { href: '/cards', label: '卡牌图鉴', en: 'ARCHIVE', code: '03' },
  { href: '/history', label: '对局回放', en: 'REPLAY', code: '04' },
  { href: '/guide', label: '新手指南', en: 'GUIDE', code: '05' },
];

export interface AppShellProps {
  children: React.ReactNode;
  /** 是否使用全宽容器（例如卡组构筑器需要更宽作业区） */
  wide?: boolean;
  /** 是否使用钢灰蓝子品牌网格底 */
  steelBackdrop?: boolean;
  /** 是否隐藏页脚 */
  hideFooter?: boolean;
  className?: string;
}

/**
 * 全站统一战双帕弥什战术壳层 (顶栏 56px + 响应式抽屉导航 + 战术页脚)
 * 依据 docs/design/design-spec.md 5.4 / 5.9 / 9
 */
export function AppShell({
  children,
  wide = false,
  steelBackdrop = false,
  hideFooter = false,
  className,
}: AppShellProps) {
  const pathname = usePathname() || '/';
  const { user, isLoggedIn, isAdmin, logout, updateNickname } = useAuth();

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [editNameOpen, setEditNameOpen] = useState(false);
  const [newNickname, setNewNickname] = useState('');
  const [updatingName, setUpdatingName] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  const isNavActive = (href: string) =>
    pathname === href || pathname.startsWith(`${href}/`);

  const handleOpenEditName = () => {
    if (!user) return;
    setNewNickname(user.nickname);
    setNameError(null);
    setEditNameOpen(true);
    setMobileMenuOpen(false);
  };

  const handleSaveNickname = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newNickname.trim();
    if (!trimmed) {
      setNameError('指挥官名称不能为空');
      return;
    }
    setUpdatingName(true);
    setNameError(null);
    try {
      const res = await updateNickname(trimmed);
      if (res.success) {
        setEditNameOpen(false);
      } else {
        setNameError(res.error || '更新失败');
      }
    } finally {
      setUpdatingName(false);
    }
  };

  return (
    <div
      className={cn(
        'min-h-screen flex flex-col text-fg',
        steelBackdrop ? 'bg-steel-grid' : 'bg-tactical-grid',
      )}
    >
      {/* 顶部战术导航栏 (56px / ink-900 / 1px line) */}
      <header className="sticky top-0 z-sticky h-14 bg-ink-900/95 border-b border-line backdrop-blur-md">
        <div
          className={cn(
            'mx-auto h-full px-4 md:px-6 flex items-center justify-between gap-4',
            wide ? 'max-w-[1600px]' : 'max-w-[1200px]',
          )}
        >
          {/* 左侧品牌标识 */}
          <Link
            href="/"
            className="group flex items-center gap-3 shrink-0 focus-visible:outline-offset-4"
          >
            <span
              aria-hidden="true"
              className="relative flex h-8 w-8 items-center justify-center bg-crimson-500 clip-corner-sm pgr-sweep"
            >
              <span className="font-display text-caption font-bold tracking-tighter text-fg">
                PR
              </span>
            </span>
            <div className="leading-tight">
              <div className="text-body font-bold tracking-wider text-fg group-hover:text-fg transition-colors">
                战双帕弥什
                <span className="ml-1.5 text-caption font-normal text-fg-secondary">
                  卡牌对战
                </span>
              </div>
              <div className="font-display text-hud uppercase text-fg-muted">
                PUNISHING CARD TERMINAL
              </div>
            </div>
          </Link>

          {/* 中间桌面端横向导航 */}
          <nav aria-label="主导航" className="hidden lg:flex items-stretch h-full gap-1">
            {NAV_ITEMS.map((item) => {
              const active = isNavActive(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    'group relative flex flex-col justify-center px-3.5 h-full transition-colors duration-base ease-enter',
                    active ? 'text-fg' : 'text-fg-secondary hover:text-fg',
                  )}
                >
                  <div className="flex items-baseline gap-1.5">
                    <span
                      aria-hidden="true"
                      className={cn(
                        'font-num text-hud tabular-nums transition-colors duration-fast',
                        active ? 'text-crimson-400' : 'text-fg-disabled group-hover:text-fg-muted',
                      )}
                    >
                      {item.code}
                    </span>
                    <span className="text-body-sm font-medium">{item.label}</span>
                  </div>
                  <span
                    aria-hidden="true"
                    className="font-display text-hud uppercase text-fg-muted leading-none mt-0.5 pl-4"
                  >
                    {item.en}
                  </span>
                  <span
                    aria-hidden="true"
                    className={cn(
                      'absolute bottom-0 left-3 right-3 h-0.5 bg-crimson-500 transition-all duration-base ease-enter',
                      active ? 'opacity-100 scale-x-100' : 'opacity-0 scale-x-0 group-hover:opacity-40 group-hover:scale-x-100',
                    )}
                  />
                </Link>
              );
            })}
          </nav>

          {/* 右侧用户态 & 移动端菜单按钮 */}
          <div className="flex items-center gap-2 shrink-0">
            {isAdmin && (
              <Link
                href="/admin"
                className={cn(
                  'hidden sm:inline-flex items-center gap-1.5 h-8 px-2.5 border text-caption font-medium transition-colors duration-fast',
                  isNavActive('/admin')
                    ? 'border-gold-300 bg-gold-300/15 text-gold-300'
                    : 'border-gold-300/40 bg-gold-300/10 text-gold-300 hover:border-gold-300',
                )}
              >
                <Shield className="w-3.5 h-3.5" />
                <span>控制台</span>
              </Link>
            )}

            {isLoggedIn && user ? (
              <div className="hidden sm:flex items-center gap-2 pl-2 border-l border-line">
                <Badge variant={user.role === 'ADMIN' ? 'gold' : 'teal'}>
                  {user.role === 'ADMIN' ? (
                    <Shield className="w-3 h-3" />
                  ) : (
                    <User className="w-3 h-3" />
                  )}
                  <span>{user.role === 'ADMIN' ? '总指挥' : '指挥官'}</span>
                </Badge>

                <button
                  type="button"
                  onClick={handleOpenEditName}
                  title="点击修改指挥官名称"
                  className="group inline-flex items-center gap-1.5 h-8 px-2.5 border border-line bg-ink-850 hover:border-line-strong hover:bg-ink-800 transition-colors duration-fast cursor-pointer"
                >
                  <span className="text-caption font-medium text-fg max-w-28 truncate">
                    {user.nickname}
                  </span>
                  <Edit3 className="w-3 h-3 text-fg-muted group-hover:text-fg" />
                </button>

                <Button
                  variant="icon"
                  size="md"
                  onClick={logout}
                  aria-label="退出登录"
                  title="退出当前账号"
                  className="hover:border-crimson-500/60 hover:text-crimson-400"
                >
                  <LogOut className="w-3.5 h-3.5" />
                </Button>
              </div>
            ) : (
              <Link href="/login" className="hidden sm:inline-flex">
                <Button variant="primary" size="sm">
                  <LogIn className="w-3.5 h-3.5" />
                  <span>指挥官登录</span>
                </Button>
              </Link>
            )}

            <button
              type="button"
              onClick={() => setMobileMenuOpen((v) => !v)}
              aria-label={mobileMenuOpen ? '关闭导航菜单' : '打开导航菜单'}
              aria-expanded={mobileMenuOpen}
              className="lg:hidden h-9 w-9 inline-flex items-center justify-center border border-line bg-ink-850 text-fg-secondary hover:text-fg hover:border-line-strong transition-colors cursor-pointer"
            >
              {mobileMenuOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* 移动端滑出菜单 */}
        {mobileMenuOpen && (
          <div className="lg:hidden border-b border-line bg-ink-900 animate-in fade-in slide-in-from-top-2 duration-fast">
            <nav aria-label="移动端导航" className="px-4 py-3 space-y-1">
              {NAV_ITEMS.map((item) => {
                const active = isNavActive(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileMenuOpen(false)}
                    className={cn(
                      'flex items-center justify-between px-3 py-2.5 border-l-2 transition-colors duration-fast',
                      active
                        ? 'border-crimson-500 bg-ink-800 text-fg'
                        : 'border-transparent text-fg-secondary hover:bg-ink-850 hover:text-fg',
                    )}
                  >
                    <div className="flex items-center gap-2.5">
                      <span className="font-num text-hud text-crimson-400">{item.code}</span>
                      <span className="text-body-sm font-medium">{item.label}</span>
                    </div>
                    <span className="font-display text-hud uppercase text-fg-muted">
                      {item.en}
                    </span>
                  </Link>
                );
              })}

              {isAdmin && (
                <Link
                  href="/admin"
                  onClick={() => setMobileMenuOpen(false)}
                  className="flex items-center justify-between px-3 py-2.5 border-l-2 border-gold-300 bg-gold-300/10 text-gold-300"
                >
                  <span className="text-body-sm font-medium flex items-center gap-2">
                    <Shield className="w-4 h-4" />
                    管理控制台
                  </span>
                  <span className="font-display text-hud uppercase">ADMIN</span>
                </Link>
              )}

              <div className="pt-3 mt-2 border-t border-line flex items-center justify-between gap-2">
                {isLoggedIn && user ? (
                  <>
                    <button
                      type="button"
                      onClick={handleOpenEditName}
                      className="flex items-center gap-2 text-body-sm text-fg hover:text-teal-400 cursor-pointer"
                    >
                      <User className="w-4 h-4 text-teal-400" />
                      <span>{user.nickname}</span>
                      <Edit3 className="w-3.5 h-3.5 text-fg-muted" />
                    </button>
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => {
                        logout();
                        setMobileMenuOpen(false);
                      }}
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      <span>退出</span>
                    </Button>
                  </>
                ) : (
                  <Link
                    href="/login"
                    onClick={() => setMobileMenuOpen(false)}
                    className="w-full"
                  >
                    <Button variant="primary" size="md" className="w-full">
                      <LogIn className="w-4 h-4" />
                      <span>指挥官登录 / 注册</span>
                    </Button>
                  </Link>
                )}
              </div>
            </nav>
          </div>
        )}
      </header>

      {/* 主内容区域 */}
      <main
        className={cn(
          'flex-1 w-full mx-auto px-4 md:px-6 py-6 md:py-8',
          wide ? 'max-w-[1600px]' : 'max-w-[1200px]',
          className,
        )}
      >
        {children}
      </main>

      {/* 战双战术页脚 */}
      {!hideFooter && (
        <footer className="border-t border-line bg-ink-900 mt-auto">
          <div
            className={cn(
              'mx-auto px-4 md:px-6 py-5 space-y-3',
              wide ? 'max-w-[1600px]' : 'max-w-[1200px]',
            )}
          >
            <HudRule code="PUNISHING FORCE // TERMINAL V1.4" />
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 text-caption text-fg-muted">
              <div className="flex items-center gap-3">
                <span aria-hidden="true" className="font-display text-hud uppercase text-crimson-400">
                  ▸▸▸ PUNISHING FORCE
                </span>
                <span>规则依据：官方《综合规则》V1.4</span>
              </div>
              <div className="flex items-center gap-3">
                <HudCaution label="NON-COMMERCIAL" />
                <span className="text-fg-muted">
                  卡牌插画与商标权利归库洛游戏所有，仅限非商业交流
                </span>
              </div>
              <HudStripes className="hidden md:block" />
            </div>
          </div>
        </footer>
      )}

      {/* 快捷修改指挥官名称弹窗 */}
      <Dialog
        open={editNameOpen}
        onClose={() => setEditNameOpen(false)}
        title="修改指挥官作战名称"
        subtitle="COMMANDER IDENTITY UPDATE"
        size="sm"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setEditNameOpen(false)}>
              取消
            </Button>
            <Button
              variant="primary"
              size="sm"
              loading={updatingName}
              onClick={handleSaveNickname}
            >
              <Check className="w-3.5 h-3.5" />
              <span>确认修改</span>
            </Button>
          </>
        }
      >
        <form onSubmit={handleSaveNickname} className="space-y-4">
          <Input
            label="新作战代号 / 指挥官名称"
            required
            value={newNickname}
            onChange={(e) => setNewNickname(e.target.value)}
            placeholder="例如：露西亚·誓焰 / 灰鸦小队队长"
            error={nameError}
            hint="更改后将立即在对战房间、对局记录与战报广播中生效。"
          />
        </form>
      </Dialog>
    </div>
  );
}

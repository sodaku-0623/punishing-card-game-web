'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import {
  Swords,
  Library,
  Layers,
  ShieldAlert,
  Cpu,
  Terminal,
  LogIn,
  LogOut,
  User,
  Shield,
  Edit3,
  History,
  Check,
  X,
  Sparkles,
  BookOpen,
} from 'lucide-react';
import { useAuth } from '@/lib/auth-context';

export default function HomePage() {
  const { user, isLoggedIn, isAdmin, logout, updateNickname } = useAuth();

  // 修改昵称 Modal 状态
  const [isEditNameModalOpen, setIsEditNameModalOpen] = useState(false);
  const [newNickname, setNewNickname] = useState('');
  const [updatingName, setUpdatingName] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  const handleOpenEditName = () => {
    if (user) {
      setNewNickname(user.nickname);
      setNameError(null);
      setIsEditNameModalOpen(true);
    }
  };

  const handleSaveNickname = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newNickname.trim()) {
      setNameError('指挥官名称不能为空');
      return;
    }
    setUpdatingName(true);
    setNameError(null);
    try {
      const res = await updateNickname(newNickname.trim());
      if (res.success) {
        setIsEditNameModalOpen(false);
      } else {
        setNameError(res.error || '更新失败');
      }
    } finally {
      setUpdatingName(false);
    }
  };

  return (
    <main className="w-full flex min-h-screen flex-col items-center justify-between p-6 md:p-12 relative overflow-x-hidden overflow-y-auto">
      {/* 背景科幻装饰光 */}
      <div className="absolute top-[-100px] left-1/2 -translate-x-1/2 w-[700px] h-[350px] bg-terminalCyan/10 blur-[130px] rounded-full pointer-events-none" />
      <div className="absolute bottom-[-100px] right-[-100px] w-[500px] h-[300px] bg-erosionRed/10 blur-[120px] rounded-full pointer-events-none" />

      {/* 顶部导航 */}
      <header className="w-full max-w-6xl flex flex-col md:flex-row justify-between items-center border-b border-terminalBorder/60 pb-6 gap-4 z-10">
        <div className="flex items-center gap-3">
          <Cpu className="w-8 h-8 text-terminalCyan animate-pulse" />
          <div>
            <h1 className="text-xl font-bold tracking-wider text-white">战双帕弥什 卡牌对战</h1>
            <p className="text-xs text-neutral-400 font-mono">PUNISHING CARD GAME • TCG/CCG ONLINE</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 md:gap-4 text-sm font-medium">
          <Link href="/cards" className="text-neutral-300 hover:text-terminalCyan transition-colors">
            卡牌图鉴
          </Link>
          <Link href="/decks" className="text-neutral-300 hover:text-terminalCyan transition-colors">
            构筑卡组
          </Link>
          <Link href="/rooms" className="text-neutral-300 hover:text-terminalCyan transition-colors">
            大厅对战
          </Link>
          <Link href="/history" className="text-neutral-300 hover:text-terminalCyan transition-colors">
            对局回放
          </Link>
          <Link href="/guide" className="text-neutral-300 hover:text-terminalCyan transition-colors flex items-center gap-1 font-semibold text-terminalCyan">
            <BookOpen className="w-3.5 h-3.5" />
            <span>新手指南</span>
          </Link>

          {/* 仅管理员可见后台管理入口 */}
          {isAdmin && (
            <Link
              href="/admin"
              className="flex items-center gap-1.5 px-3 py-1 rounded-lg border border-terminalGold/50 bg-terminalGold/10 text-xs font-mono text-terminalGold hover:bg-terminalGold/20 transition-all shadow-[0_0_10px_rgba(255,184,0,0.2)]"
            >
              <Shield className="w-3.5 h-3.5" />
              管理控制台
            </Link>
          )}

          {/* 认证状态栏 */}
          {isLoggedIn && user ? (
            <div className="flex items-center gap-2 pl-2 border-l border-terminalBorder/60">
              {/* 身份徽章 */}
              {user.role === 'ADMIN' ? (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-terminalGold/40 bg-terminalGold/15 text-terminalGold text-[11px] font-mono font-bold">
                  <Shield className="w-3 h-3" />
                  总指挥官
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-terminalCyan/40 bg-terminalCyan/15 text-terminalCyan text-[11px] font-mono font-bold">
                  <User className="w-3 h-3" />
                  作战指挥官
                </span>
              )}

              {/* 昵称与修改名称快捷操作 */}
              <button
                onClick={handleOpenEditName}
                className="group flex items-center gap-1.5 px-2.5 py-1 rounded border border-terminalBorder bg-surface hover:border-terminalCyan transition-colors text-xs text-white"
                title="点击修改指挥官名称"
              >
                <span className="font-bold group-hover:text-terminalCyan transition-colors">
                  {user.nickname}
                </span>
                <Edit3 className="w-3 h-3 text-neutral-400 group-hover:text-terminalCyan" />
              </button>

              {/* 退出登录 */}
              <button
                onClick={logout}
                className="p-1.5 rounded border border-neutral-800 text-neutral-400 hover:text-erosionRed hover:border-erosionRed/40 transition-colors"
                title="退出当前账号"
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <Link
              href="/login"
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg border border-terminalCyan/60 bg-terminalCyan/10 hover:bg-terminalCyan/25 text-xs font-mono font-bold text-terminalCyan transition-all shadow-[0_0_12px_rgba(0,240,255,0.2)]"
            >
              <LogIn className="w-3.5 h-3.5" />
              指挥官登录 / 注册
            </Link>
          )}
        </div>
      </header>

      {/* 终端主作战区 */}
      <section className="my-14 max-w-4xl text-center z-10 flex flex-col items-center">
        <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full border border-terminalCyan/30 bg-terminalCyan/5 text-terminalCyan text-xs font-mono mb-6">
          <Terminal className="w-3.5 h-3.5" />
          <span>规则引擎权威仲裁系统 • A0 综合规则驱动</span>
        </div>

        <h2 className="text-4xl md:text-6xl font-extrabold tracking-tight text-white mb-6">
          {isLoggedIn && user ? (
            <>
              欢迎归队，指挥官{' '}
              <span className="text-terminalCyan drop-shadow-[0_0_20px_rgba(0,240,255,0.4)]">
                【{user.nickname}】
              </span>
            </>
          ) : (
            <>
              指挥官，接入 <span className="text-terminalCyan drop-shadow-[0_0_20px_rgba(0,240,255,0.4)]">战双战术卡牌终端</span>
            </>
          )}
        </h2>

        <p className="text-base md:text-lg text-neutral-400 max-w-2xl mx-auto leading-relaxed mb-10">
          {isLoggedIn ? (
            <>
              战术网络通讯畅通。空中花园服务器权威裁判、信号球三消抽卡、升变角色重叠出场、伤害充能转化为暗费与侵蚀度结算机制已就绪。
            </>
          ) : (
            <>
              基于官方《综合规则》建立的实时双人在线对战平台。支持玩家注册登录、自定义作战代号、卡组验证及全流程实时对决。
            </>
          )}
        </p>

        {/* 核心操作入口 */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 w-full max-w-5xl">
          <Link
            href="/rooms"
            className="group p-5 rounded-xl border border-terminalBorder bg-surface hover:border-terminalCyan transition-all terminal-glow-cyan flex flex-col items-center text-center"
          >
            <div className="w-11 h-11 rounded-lg bg-terminalCyan/10 border border-terminalCyan/30 flex items-center justify-center text-terminalCyan mb-3.5 group-hover:scale-110 transition-transform">
              <Swords className="w-5 h-5" />
            </div>
            <h3 className="text-base font-bold text-white mb-1.5">进入对战大厅</h3>
            <p className="text-[11px] text-neutral-400">创建房间或加入对决，双人实时在线权威对战</p>
          </Link>

          <Link
            href="/decks"
            className="group p-5 rounded-xl border border-terminalBorder bg-surface hover:border-terminalGold transition-all flex flex-col items-center text-center"
          >
            <div className="w-11 h-11 rounded-lg bg-terminalGold/10 border border-terminalGold/30 flex items-center justify-center text-terminalGold mb-3.5 group-hover:scale-110 transition-transform">
              <Layers className="w-5 h-5" />
            </div>
            <h3 className="text-base font-bold text-white mb-1.5">战术卡组构筑</h3>
            <p className="text-[11px] text-neutral-400">50张精准卡组验证、红蓝黄信号球合规校验仪</p>
          </Link>

          <Link
            href="/cards"
            className="group p-5 rounded-xl border border-terminalBorder bg-surface hover:border-erosionRed transition-all flex flex-col items-center text-center"
          >
            <div className="w-11 h-11 rounded-lg bg-erosionRed/10 border border-erosionRed/30 flex items-center justify-center text-erosionRed mb-3.5 group-hover:scale-110 transition-transform">
              <Library className="w-5 h-5" />
            </div>
            <h3 className="text-base font-bold text-white mb-1.5">全维卡牌图鉴</h3>
            <p className="text-[11px] text-neutral-400">角色牌/战术牌/装备牌/辅助机及升变能力索引</p>
          </Link>

          <Link
            href="/guide"
            className="group p-5 rounded-xl border border-terminalBorder bg-surface hover:border-purple-400 transition-all flex flex-col items-center text-center"
          >
            <div className="w-11 h-11 rounded-lg bg-purple-500/10 border border-purple-500/30 flex items-center justify-center text-purple-400 mb-3.5 group-hover:scale-110 transition-transform">
              <BookOpen className="w-5 h-5" />
            </div>
            <h3 className="text-base font-bold text-white mb-1.5">新手作战指南</h3>
            <p className="text-[11px] text-neutral-400">官方规则手册、回合流程、胜负判定与关键词图鉴</p>
          </Link>
        </div>
      </section>

      {/* 修改昵称模态框 */}
      {isEditNameModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-surface border border-terminalBorder rounded-2xl p-6 shadow-2xl relative overflow-hidden">
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-terminalCyan to-terminalGold" />
            
            <div className="flex justify-between items-center border-b border-terminalBorder/60 pb-3 mb-4">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-terminalGold" />
                修改指挥官作战名称
              </h3>
              <button
                onClick={() => setIsEditNameModalOpen(false)}
                className="text-neutral-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {nameError && (
              <div className="mb-4 p-2.5 rounded-lg border border-red-500/40 bg-red-500/10 text-xs text-red-300">
                {nameError}
              </div>
            )}

            <form onSubmit={handleSaveNickname} className="space-y-4">
              <div>
                <label className="block text-xs font-mono text-neutral-400 mb-1.5">
                  新作战代号 / 指挥官名称
                </label>
                <input
                  type="text"
                  required
                  value={newNickname}
                  onChange={(e) => setNewNickname(e.target.value)}
                  placeholder="例如：露西亚·誓焰 / 灰鸦小队队长"
                  className="w-full px-3.5 py-2.5 rounded-lg bg-neutral-950 border border-terminalBorder text-white text-sm focus:border-terminalCyan focus:outline-none transition-colors"
                />
                <p className="text-[11px] text-neutral-500 mt-1">
                  更改后将立即在对战房间、对局记录与战报广播中生效。
                </p>
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsEditNameModalOpen(false)}
                  className="px-4 py-2 rounded-lg border border-terminalBorder text-xs text-neutral-400 hover:text-white transition-colors"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={updatingName}
                  className="px-5 py-2 rounded-lg bg-terminalCyan text-neutral-950 font-bold text-xs hover:bg-terminalCyan/90 transition-all disabled:opacity-50 flex items-center gap-1.5"
                >
                  <Check className="w-3.5 h-3.5" />
                  {updatingName ? '保存中...' : '确认修改'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 底部系统状态 */}
      <footer className="w-full max-w-6xl border-t border-terminalBorder/60 pt-6 flex flex-col md:flex-row justify-between items-center text-xs text-neutral-500 font-mono gap-4 z-10">
        <div>SERVER: AUTHORITATIVE ENGINE ACTIVE • AUTH V2.0 ENFORCED</div>
        <div className="flex items-center gap-6">
          <span>RULES: V2025.11.14 (A0)</span>
          <span>WEBSOCKET: READY</span>
          <span>ROLE: {user?.role || 'GUEST'}</span>
        </div>
      </footer>
    </main>
  );
}

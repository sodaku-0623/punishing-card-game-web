'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  User,
  KeyRound,
  UserPlus,
  LogIn,
  Cpu,
  Terminal,
  AlertCircle,
  CheckCircle2,
  Sparkles,
  ArrowRight,
  ShieldAlert,
} from 'lucide-react';
import { useAuth } from '@/lib/auth-context';

function LoginFormContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectPath = searchParams.get('redirect') || '/';

  const { login, register, user, isLoggedIn } = useAuth();

  const [activeTab, setActiveTab] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [nickname, setNickname] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // 如果已经登录且角色正确，直接跳转
  useEffect(() => {
    if (isLoggedIn && user) {
      if (redirectPath === '/admin' && user.role !== 'ADMIN') {
        setErrorMsg('当前登录账号无管理员权限，如需进入后台请使用管理员账号登录');
      } else {
        router.push(redirectPath);
      }
    }
  }, [isLoggedIn, user, redirectPath, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    if (!username.trim() || !password) {
      setErrorMsg('请填写完整的账号与密码');
      return;
    }

    setSubmitting(true);
    try {
      if (activeTab === 'login') {
        const result = await login(username.trim(), password);
        if (result.success) {
          setSuccessMsg('接入成功，正在同步战术终端...');
          setTimeout(() => {
            router.push(redirectPath);
          }, 600);
        } else {
          setErrorMsg(result.error || '登录失败');
        }
      } else {
        if (password.length < 6) {
          setErrorMsg('密码长度不能少于 6 个字符');
          setSubmitting(false);
          return;
        }
        const result = await register(username.trim(), password, nickname.trim() || undefined);
        if (result.success) {
          setSuccessMsg('指挥官档案建立成功！正在接入空中花园通讯网络...');
          setTimeout(() => {
            router.push(redirectPath);
          }, 800);
        } else {
          setErrorMsg(result.error || '注册失败');
        }
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="w-full max-w-md">
      {/* 提示条（如重定向自后台） */}
      {redirectPath.startsWith('/admin') && (
        <div className="mb-6 p-4 rounded-xl border border-erosionRed/40 bg-erosionRed/10 text-xs text-erosionRed flex items-center gap-3">
          <ShieldAlert className="w-5 h-5 flex-shrink-0" />
          <span>后台管理系统受最高安全协议限制，请使用管理员账号登录以继续。</span>
        </div>
      )}

      {/* 认证卡片主体 */}
      <div className="relative rounded-2xl border border-terminalBorder bg-surface/90 backdrop-blur-xl p-8 shadow-2xl overflow-hidden">
        {/* 顶部科幻装饰线 */}
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-terminalCyan via-terminalGold to-erosionRed" />

        {/* 终端标识 */}
        <div className="flex items-center justify-between mb-8 pb-4 border-b border-terminalBorder/60">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-terminalCyan/10 border border-terminalCyan/30 flex items-center justify-center text-terminalCyan">
              <Cpu className="w-6 h-6 animate-pulse" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white tracking-wide">指挥官身份验证</h2>
              <p className="text-xs text-neutral-400 font-mono">BABYLONIA COMM SYSTEM</p>
            </div>
          </div>
          <span className="text-[10px] font-mono px-2 py-0.5 rounded border border-terminalCyan/30 text-terminalCyan bg-terminalCyan/5">
            AUTH-v2.0
          </span>
        </div>

        {/* 登录/注册 Tab 切换 */}
        <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-neutral-900/80 border border-terminalBorder/60 mb-6">
          <button
            type="button"
            onClick={() => {
              setActiveTab('login');
              setErrorMsg(null);
            }}
            className={`py-2 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-2 ${
              activeTab === 'login'
                ? 'bg-terminalCyan/20 text-terminalCyan border border-terminalCyan/40 shadow-sm'
                : 'text-neutral-400 hover:text-white'
            }`}
          >
            <LogIn className="w-4 h-4" />
            指挥官登录
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab('register');
              setErrorMsg(null);
            }}
            className={`py-2 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-2 ${
              activeTab === 'register'
                ? 'bg-terminalGold/20 text-terminalGold border border-terminalGold/40 shadow-sm'
                : 'text-neutral-400 hover:text-white'
            }`}
          >
            <UserPlus className="w-4 h-4" />
            新指挥官注册
          </button>
        </div>

        {/* 错误与成功提示 */}
        {errorMsg && (
          <div className="mb-4 p-3 rounded-lg border border-red-500/40 bg-red-500/10 text-xs text-red-300 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}
        {successMsg && (
          <div className="mb-4 p-3 rounded-lg border border-emerald-500/40 bg-emerald-500/10 text-xs text-emerald-300 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}

        {/* 表单 */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-mono text-neutral-400 mb-1.5 flex items-center gap-1.5">
              <User className="w-3.5 h-3.5 text-terminalCyan" />
              账号 / 用户名
            </label>
            <input
              type="text"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="请输入账号代号 (至少3位)"
              className="w-full px-3.5 py-2.5 rounded-lg bg-neutral-950 border border-terminalBorder text-white text-sm focus:border-terminalCyan focus:outline-none transition-colors font-mono"
            />
          </div>

          <div>
            <label className="block text-xs font-mono text-neutral-400 mb-1.5 flex items-center gap-1.5">
              <KeyRound className="w-3.5 h-3.5 text-terminalCyan" />
              密码
            </label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="请输入身份验证密码"
              className="w-full px-3.5 py-2.5 rounded-lg bg-neutral-950 border border-terminalBorder text-white text-sm focus:border-terminalCyan focus:outline-none transition-colors font-mono"
            />
          </div>

          {activeTab === 'register' && (
            <div>
              <label className="block text-xs font-mono text-neutral-400 mb-1.5 flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-terminalGold" />
                  指挥官自定义昵称 (对战显示名)
                </span>
                <span className="text-[10px] text-neutral-500">留空则同用户名</span>
              </label>
              <input
                type="text"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                placeholder="例如：灰鸦小队·里 / 露西亚"
                className="w-full px-3.5 py-2.5 rounded-lg bg-neutral-950 border border-terminalBorder text-white text-sm focus:border-terminalGold focus:outline-none transition-colors"
              />
              <p className="text-[11px] text-neutral-500 mt-1">
                此名称将在大厅对战、战绩排行榜与对战房间中向所有指挥官公开展示。
              </p>
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className={`w-full py-3 mt-2 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 ${
              activeTab === 'login'
                ? 'bg-terminalCyan text-neutral-950 hover:bg-terminalCyan/90 shadow-[0_0_20px_rgba(0,240,255,0.3)]'
                : 'bg-terminalGold text-neutral-950 hover:bg-terminalGold/90 shadow-[0_0_20px_rgba(255,184,0,0.3)]'
            } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            {submitting ? (
              '通信验证中...'
            ) : activeTab === 'login' ? (
              <>
                <span>接入作战终端</span>
                <ArrowRight className="w-4 h-4" />
              </>
            ) : (
              <>
                <span>建立作战档案并接入</span>
                <Sparkles className="w-4 h-4" />
              </>
            )}
          </button>
        </form>
      </div>

      {/* 底部返回首页 */}
      <div className="mt-6 text-center">
        <Link
          href="/"
          className="text-xs text-neutral-500 hover:text-terminalCyan transition-colors inline-flex items-center gap-1 font-mono"
        >
          ← 返回终端大厅
        </Link>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-6 relative overflow-hidden">
      {/* 科幻装饰背景光晕 */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[300px] bg-terminalCyan/10 blur-[140px] rounded-full pointer-events-none" />
      <div className="absolute bottom-10 right-10 w-[400px] h-[250px] bg-terminalGold/10 blur-[130px] rounded-full pointer-events-none" />

      <Suspense
        fallback={
          <div className="text-terminalCyan font-mono text-sm flex items-center gap-2">
            <Cpu className="w-5 h-5 animate-spin" />
            <span>正在建立安全信道...</span>
          </div>
        }
      >
        <LoginFormContent />
      </Suspense>
    </main>
  );
}

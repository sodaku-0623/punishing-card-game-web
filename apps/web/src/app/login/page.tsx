'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  User,
  KeyRound,
  AlertCircle,
  CheckCircle2,
  ArrowRight,
  ShieldAlert,
  ArrowLeft,
  Sparkles,
} from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import {
  Button,
  Input,
  Tabs,
  Badge,
  HudBrackets,
  HudRule,
  HudStripes,
  HudCaution,
} from '@/components/ui';

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
          setSuccessMsg('指挥官档案建立成功，正在接入空中花园通讯网络...');
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
    <div className="w-full max-w-4xl grid grid-cols-1 lg:grid-cols-12 border border-line bg-ink-900 relative pgr-enter">
      <HudBrackets color="steel" />

      {/* 左侧战术终端视觉说明面板 */}
      <div className="hidden lg:flex lg:col-span-5 flex-col justify-between p-8 border-r border-line bg-ink-950 relative overflow-hidden">
        <span
          aria-hidden="true"
          className="pointer-events-none select-none absolute -left-4 -bottom-4 font-display font-bold uppercase text-fg/[0.04] pgr-watermark"
        >
          AUTH
        </span>

        <div className="space-y-6 relative z-10">
          <div className="flex items-center gap-2.5">
            <span className="h-7 w-7 bg-crimson-500 clip-corner-sm inline-flex items-center justify-center font-display text-caption font-bold text-fg">
              PR
            </span>
            <div>
              <div className="text-body-sm font-bold text-fg tracking-wider">
                战双帕弥什 卡牌对战
              </div>
              <div className="font-display text-hud uppercase text-fg-muted">
                BABYLONIA AUTH SYSTEM
              </div>
            </div>
          </div>

          <HudRule code="IDENTIFICATION" />

          <div className="space-y-3">
            <h1 className="text-display font-bold text-fg leading-snug">
              指挥官身份
              <br />
              安全接入协议
            </h1>
            <p className="text-body-sm text-fg-secondary leading-relaxed">
              登录后可云端同步自定义卡组、保存个人战绩与完整对局回放，并以专属指挥官代号进入实时对战房间。
            </p>
          </div>
        </div>

        <div className="space-y-4 relative z-10">
          <div className="border-l-2 border-crimson-500 pl-3 py-1 space-y-1">
            <div className="font-display text-hud uppercase text-fg-muted">
              SECURITY LEVEL
            </div>
            <div className="text-caption text-fg-secondary">
              加密口令校验 · 会话签名验证 · 权限隔离保护
            </div>
          </div>

          <div className="flex items-center justify-between pt-2">
            <HudCaution label="AUTHORIZED ACCESS" />
            <HudStripes className="w-16 h-2.5" />
          </div>
        </div>
      </div>

      {/* 右侧登录 / 注册表单区 */}
      <div className="lg:col-span-7 p-6 sm:p-8 md:p-10 flex flex-col justify-between">
        <div>
          {/* 后台重定向安全警示 */}
          {redirectPath.startsWith('/admin') && (
            <div
              role="alert"
              className="mb-6 p-3.5 border border-crimson-500/60 bg-crimson-700/20 text-caption text-crimson-400 flex items-center gap-2.5"
            >
              <ShieldAlert className="w-4 h-4 shrink-0" />
              <span>后台管理系统受最高安全协议限制，请使用管理员账号登录以继续。</span>
            </div>
          )}

          {/* 标题栏 */}
          <div className="flex items-center justify-between mb-6">
            <div>
              <p className="font-display text-hud uppercase text-fg-muted">
                COMMANDER ACCESS TERMINAL
              </p>
              <h2 className="text-title font-bold text-fg mt-0.5">
                {activeTab === 'login' ? '指挥官登录' : '建立新指挥官档案'}
              </h2>
            </div>
            <Badge variant="neutral" className="font-num">
              AUTH-V2
            </Badge>
          </div>

          {/* 官网风格标签页 */}
          <Tabs
            items={[
              { id: 'login', label: '指挥官登录' },
              { id: 'register', label: '新指挥官注册' },
            ]}
            value={activeTab}
            onChange={(val) => {
              setActiveTab(val);
              setErrorMsg(null);
              setSuccessMsg(null);
            }}
            className="mb-6"
          />

          {/* 错误与成功反馈 */}
          {errorMsg && (
            <div
              role="alert"
              className="mb-5 p-3 border border-crimson-500/60 bg-crimson-700/20 text-caption text-crimson-400 flex items-center gap-2 animate-in fade-in duration-fast"
            >
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {successMsg && (
            <div className="mb-5 p-3 border border-success/50 bg-success/10 text-caption text-success flex items-center gap-2 animate-in fade-in duration-fast">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{successMsg}</span>
            </div>
          )}

          {/* 表单本体 */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              label="账号 / 用户名"
              required
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="请输入账号代号（至少 3 位）"
              leftSlot={<User className="w-4 h-4" />}
              className="font-num"
            />

            <Input
              label="身份验证密码"
              type="password"
              required
              autoComplete={activeTab === 'login' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={activeTab === 'login' ? '请输入身份验证密码' : '请设置密码（至少 6 位）'}
              leftSlot={<KeyRound className="w-4 h-4" />}
              className="font-num"
            />

            {activeTab === 'register' && (
              <div className="animate-in fade-in slide-in-from-top-1 duration-fast">
                <Input
                  label="指挥官自定义昵称（选填，留空则同用户名）"
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  placeholder="例如：灰鸦小队·里 / 露西亚"
                  leftSlot={<Sparkles className="w-4 h-4" />}
                  hint="此名称将在大厅对战、战绩记录与对战房间中公开显示。"
                />
              </div>
            )}

            <div className="pt-2">
              <Button
                type="submit"
                variant="primary"
                size="lg"
                loading={submitting}
                className="w-full"
              >
                <span>
                  {activeTab === 'login' ? '接入作战终端' : '建立作战档案并接入'}
                </span>
                <ArrowRight className="w-4 h-4" />
              </Button>
            </div>
          </form>
        </div>

        {/* 底部返回链接 */}
        <div className="mt-8 pt-4 border-t border-line flex items-center justify-between text-caption">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-fg-muted hover:text-fg transition-colors duration-fast"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>返回终端首页</span>
          </Link>
          <span className="font-display text-hud uppercase text-fg-disabled">
            GUEST MODE AVAILABLE IN LOBBY
          </span>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <main className="min-h-screen bg-tactical-grid text-fg flex flex-col items-center justify-center p-4 sm:p-6">
      <Suspense
        fallback={
          <div className="border border-line bg-ink-900 px-6 py-4 text-body-sm text-fg-secondary flex items-center gap-3">
            <span
              aria-hidden="true"
              className="h-4 w-4 border border-crimson-500 border-t-transparent rounded-full animate-spin"
            />
            <span>正在建立安全信道...</span>
          </div>
        }
      >
        <LoginFormContent />
      </Suspense>
    </main>
  );
}

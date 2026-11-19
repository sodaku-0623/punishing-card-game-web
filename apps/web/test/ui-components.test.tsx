import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { cn } from '@/lib/cn';
import {
  Button,
  Badge,
  Input,
  Panel,
  SectionHeader,
  Tabs,
  Dialog,
  AppShell,
  HudRule,
  HudStripes,
  HudCaution,
  HudBrackets,
  HudCounter,
} from '@/components/ui';
import HomePage from '@/app/page';
import LoginPage from '@/app/login/page';
import GuidePage from '@/app/guide/page';

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({
    user: null,
    loading: false,
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
    updateNickname: vi.fn(),
  }),
}));

describe('PGR UI Design System Components', () => {
  it('cn() preserves both custom design-spec fontSize and text color classes', () => {
    const merged = cn('text-title', 'text-fg', 'text-crimson-400');
    expect(merged).toContain('text-title');
    expect(merged).toContain('text-crimson-400');
    expect(merged).not.toContain('text-fg');
  });

  it('renders Button variants and sizes', () => {
    const html = renderToString(
      <div>
        <Button variant="primary" size="lg">进入作战大厅</Button>
        <Button variant="secondary" size="md">构筑卡组</Button>
        <Button variant="ghost" size="sm">规则手册</Button>
        <Button variant="danger">投降</Button>
        <Button variant="icon" aria-label="关闭">X</Button>
      </div>
    );
    expect(html).toContain('进入作战大厅');
    expect(html).toContain('clip-corner-sm');
    expect(html).toContain('pgr-sweep');
    expect(html).toContain('aria-label="关闭"');
  });

  it('renders Badge, Input, Panel, SectionHeader, Tabs, and HUD primitives', () => {
    const html = renderToString(
      <div>
        <Badge variant="crimson">对战中</Badge>
        <Badge variant="teal">准备就绪</Badge>
        <Input label="指挥官代号" placeholder="输入代号" error="格式错误" />
        <Panel title="战术模块" subtitle="TACTICAL" brackets cutCorner>
          <span>内容区</span>
        </Panel>
        <SectionHeader title="卡牌图鉴" subtitle="CARD ARCHIVE" variant="card" />
        <Tabs
          items={[
            { id: '01', label: '角色牌' },
            { id: '02', label: '战术牌' },
          ]}
          value="01"
          onChange={() => {}}
        />
        <HudRule code="SECTION" />
        <HudStripes />
        <HudCaution />
        <HudBrackets size="sm" color="teal" />
        <HudCounter current={1} total={3} />
      </div>
    );
    expect(html).toContain('对战中');
    expect(html).toContain('指挥官代号');
    expect(html).toContain('格式错误');
    expect(html).toContain('战术模块');
    expect(html).toContain('CARD ARCHIVE');
    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-hidden="true"');
  });

  it('renders Dialog with accessible dialog attributes when open', () => {
    const html = renderToString(
      <Dialog open={true} onClose={() => {}} title="确认操作" subtitle="CONFIRM">
        <p>是否继续？</p>
      </Dialog>
    );
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('确认操作');
  });

  it('renders AppShell and core redesigned pages without throwing', () => {
    const shellHtml = renderToString(
      <AppShell>
        <div>测试内容</div>
      </AppShell>
    );
    expect(shellHtml).toContain('PUNISHING CARD TERMINAL');
    expect(shellHtml).toContain('测试内容');

    const homeHtml = renderToString(<HomePage />);
    expect(homeHtml).toContain('战双帕弥什');
    expect(homeHtml).toContain('大厅对战');

    const loginHtml = renderToString(<LoginPage />);
    expect(loginHtml).toContain('登录');

    const guideHtml = renderToString(<GuidePage />);
    expect(guideHtml).toContain('游戏玩法与胜负');
  });
});

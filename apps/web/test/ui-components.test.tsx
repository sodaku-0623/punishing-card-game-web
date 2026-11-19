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
import { PendingChoiceModal } from '@/components/game/PendingChoiceModal';
import { TurnFlowView } from '@/components/game/TurnFlowView';
import { canRoleAttackOnEnterTurn, formatCardModifiers, hasCardKeyword } from '@/lib/card-stats';
import type { CardInstance, PendingChoice } from '@zhanshuang/shared';

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

  it('supports CHOOSE_TRIGGER_ORDER modal, multi-select ordering prompt, pendingTriggers HUD, and 8.9 card-stats helpers', () => {
    const triggerOrderChoice: PendingChoice = {
      id: 'ch-trig-1',
      playerId: 'p1',
      choiceType: 'SELECT_OPTION',
      effectType: 'CHOOSE_TRIGGER_ORDER',
      prompt: '共有 2 项自动能力同时处于待机状态，请选择优先发动哪一项：',
      minSelections: 1,
      maxSelections: 1,
      options: [
        { id: 't1', label: '【可靠的伙伴 21号&诺克提】《薇拉·瑰丽》出场时', payload: { cardNumber: 'ST03-009', eligible: true } },
        { id: 't2', label: '【奥兹玛】攻击时 PP-4000', payload: { cardNumber: 'ST02-009', eligible: true } },
      ],
    };
    const triggerHtml = renderToString(
      <PendingChoiceModal choice={triggerOrderChoice} onConfirm={() => {}} />
    );
    expect(triggerHtml).toContain('待机自动能力顺序选择');
    expect(triggerHtml).toContain('ST03-009');
    expect(triggerHtml).toContain('优先发动所选能力');

    const multiOrderChoice: PendingChoice = {
      id: 'ch-multi-1',
      playerId: 'p1',
      choiceType: 'SELECT_CARDS',
      effectType: 'PRESET_ST02_006_ORDER',
      prompt: '按从下到上的顺序依次点选信号球区的全部 2 张牌',
      minSelections: 2,
      maxSelections: 2,
      options: [
        { id: 'c1', label: 'ST02-012', payload: { cardNumber: 'ST02-012', eligible: true } },
        { id: 'c2', label: 'ST02-013', payload: { cardNumber: 'ST02-013', eligible: true } },
      ],
    };
    const multiHtml = renderToString(
      <PendingChoiceModal choice={multiOrderChoice} onConfirm={() => {}} />
    );
    expect(multiHtml).toContain('点击顺序即排列顺序');

    const flowHtml = renderToString(
      <TurnFlowView
        currentPhase="MAIN_PHASE"
        isMyTurn={true}
        pendingTriggers={[
          {
            id: 'trig-1',
            sourceCardInstanceId: 'card-1',
            sourceCardNumber: 'ST03-009',
            controllerPlayerId: 'p1',
            label: '【可靠的伙伴】薇拉出场触发',
          },
        ]}
      />
    );
    expect(flowHtml).toContain('待机自动能力');
    expect(flowHtml).toContain('【可靠的伙伴】薇拉出场触发');

    const card: CardInstance = {
      instanceId: 'c-1',
      cardId: 'c-st01-005',
      cardNumber: 'ST01-005',
      ownerPlayerId: 'p1',
      controllerPlayerId: 'p1',
      zone: 'BATTLEFIELD',
      underneathCardIds: [],
      isFaceUp: true,
      isReady: true,
      turnEnteredZone: 1,
      effectiveKeywords: ['突进'],
      modifiers: [
        { pp: 2000, keywords: ['突进'], untilTurn: 1, source: 'BP01-002' },
        { setPP: 70, addTraits: ['升格者'], untilTurn: undefined, source: 'TEST' },
      ],
    };
    expect(hasCardKeyword(card, null, '突进')).toBe(true);
    expect(hasCardKeyword(card, null, '速攻')).toBe(false);
    expect(canRoleAttackOnEnterTurn(card, null)).toBe(true);
    const modTags = formatCardModifiers(card);
    expect(modTags.some((t) => t.includes('PP+2000') && t.includes('至T1末'))).toBe(true);
    expect(modTags.some((t) => t.includes('PP=70') && t.includes('至离场'))).toBe(true);
  });
});

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
import { CardDetailPanel } from '@/components/game/CardDetailPanel';
import {
  canRoleAttackOnEnterTurn,
  formatCardModifiers,
  formatCardProhibitions,
  hasCardKeyword,
  hasCardProhibition,
} from '@/lib/card-stats';
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

  it('shows 近似效果 badge on unmigrated booster cards and hides it on exact migrated cards', () => {
    const exactHtml = renderToString(
      <CardDetailPanel
        card={{
          cardNumber: 'ST01-001',
          name: '露西亚·红莲',
          cardType: 'ROLE',
          attribute: 'PHYSICAL',
          cost: 5,
          basePP: 5000,
          baseDP: 1,
          traits: ['灰鸦小队', '露西亚'],
          rulesText: '【出】丢弃1张手牌：…',
        }}
      />
    );
    expect(exactHtml).toContain('ST01-001');
    expect(exactHtml).not.toContain('近似效果');

    const exactBp01Html = renderToString(
      <CardDetailPanel
        card={{
          cardNumber: 'BP01-001',
          name: '露西亚·鸦羽',
          cardType: 'ROLE',
          attribute: 'ICE',
          cost: 8,
          basePP: 7000,
          baseDP: 2,
          traits: ['灰鸦小队', '露西亚'],
          rulesText: '【出】消除2同色信号球：…',
        }}
      />
    );
    expect(exactBp01Html).toContain('BP01-001');
    expect(exactBp01Html).not.toContain('近似效果');

    const approxHtml = renderToString(
      <CardDetailPanel
        card={{
          cardNumber: 'BP02-001',
          name: '未迁移补充包卡',
          cardType: 'ROLE',
          attribute: 'FIRE',
          cost: 4,
          basePP: 4000,
          baseDP: 1,
          traits: ['工程部队'],
          rulesText: '【自】测试未迁移补充包卡牌。',
        }}
      />
    );
    expect(approxHtml).toContain('BP02-001');
    expect(approxHtml).toContain('近似效果');
  });

  it('formats prohibition flags, treated-as effects, and 10.15 frozen state cleanly', () => {
    const card: CardInstance = {
      instanceId: 'c-frozen',
      cardId: 'c-bp02-066',
      cardNumber: 'BP02-066',
      ownerPlayerId: 'p1',
      controllerPlayerId: 'p1',
      zone: 'BATTLEFIELD',
      underneathCardIds: [],
      isFaceUp: true,
      isReady: false,
      isFrozen: true,
      turnEnteredZone: 1,
      effectiveProhibitions: ['CANNOT_ATTACK', 'CANNOT_BLOCK'],
      modifiers: [
        {
          prohibitions: ['CANNOT_ATTACK', 'CANNOT_DEAL_DAMAGE'],
          treatedAsOrbColors: ['RED', 'YELLOW'],
          orbValue: 3,
          treatedAsNames: ['飞叶点翠'],
          untilTurn: 2,
          source: 'BP01-037',
        },
      ],
    };
    expect(hasCardProhibition(card, 'CANNOT_ATTACK')).toBe(true);
    expect(hasCardProhibition(card, 'CANNOT_BLOCK')).toBe(true);
    expect(hasCardProhibition(card, 'CANNOT_ELIMINATE')).toBe(false);
    expect(formatCardProhibitions(card)).toEqual(['不能攻击', '不能阻挡']);
    const tags = formatCardModifiers(card);
    expect(tags.some((t) => t.includes('冰冻状态'))).toBe(true);
    expect(tags.some((t) => t.includes('视为红/黄信号球'))).toBe(true);
    expect(tags.some((t) => t.includes('视为3个信号球'))).toBe(true);
    expect(tags.some((t) => t.includes('《飞叶点翠》'))).toBe(true);

    const assistAirborneCard: CardInstance = {
      ...card,
      isAirborne: true,
      partnerCardId: 'c-partner-1',
    };
    const assistTags = formatCardModifiers(assistAirborneCard);
    expect(assistTags.some((t) => t.includes('浮空模式'))).toBe(true);
    expect(assistTags.some((t) => t.includes('协战状态'))).toBe(true);
  });
});

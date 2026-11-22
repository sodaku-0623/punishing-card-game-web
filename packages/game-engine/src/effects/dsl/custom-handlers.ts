import { CardInstance, GameAction, PendingChoice, ZoneId } from '@zhanshuang/shared';
import type { CardEffectContext, CardEffectEngine } from '../card-effects.js';
import { addCardModifier } from '../continuous-effects.js';
import type {
  AbilityCost,
  CardEffectSpec,
  CardFilter,
  CustomHandlerId,
  DeclarativeEntrySpec,
  EffectStep,
  PlayerSide,
} from './types.js';

type Result = { success: boolean; error?: string };

export interface CustomHandlerFrameState {
  cardNumber: string;
  sourceCardInstanceId: string;
  playerId: string;
  vars: Record<string, string[]>;
  remainingSteps: EffectStep[];
  handlerId: CustomHandlerId;
  stage: string;
  extra?: Record<string, unknown>;
}

/**
 * 声明式自定义复杂处理器运行时接口 (由 DeclarativeEffectInterpreter 提供)
 */
export interface CustomHandlerRuntime {
  ctx: CardEffectContext;
  effects: CardEffectEngine;
  registry: ReadonlyMap<string, CardEffectSpec>;
  def: (card: CardInstance) => ReturnType<CardEffectContext['cardDb']['getCard']>;
  zone: (playerId: string, zone: ZoneId) => CardInstance[];
  roles: (playerId: string) => CardInstance[];
  hasTrait: (card: CardInstance, trait: string) => boolean;
  matchesFilter: (card: CardInstance, filter: CardFilter, sourceId?: string) => boolean;
  resolveSide: (playerId: string, side: PlayerSide) => string;
  hasEmptySlot: (playerId: string) => boolean;
  choiceId: (tag: string) => string;
  enqueueCustomChoice: (
    choice: Omit<PendingChoice, 'metadata'>,
    frame: CustomHandlerFrameState
  ) => void;
  resumeSteps: (
    cardNumber: string,
    sourceId: string,
    playerId: string,
    vars: Record<string, string[]>,
    queue: EffectStep[]
  ) => void;
  executeEntryOnSource: (
    entryCardNumber: string,
    sourceId: string,
    playerId: string,
    cost: AbilityCost | undefined,
    steps: EffectStep[],
    vars: Record<string, string[]>
  ) => void;
  bringToField: (
    playerId: string,
    cardId: string,
    triggerEntry: boolean,
    enterTapped?: boolean,
    enterAbilitiesLost?: boolean
  ) => boolean;
}

const LILITH_COST_DECL_CARDS: Readonly<Record<string, number[]>> = {
  'BP03-065': [2, 4, 6, 8],
  'BP03-066': [1, 3, 5, 7],
};

function readLilithCostMap(vars: Record<string, string[]>): Map<string, number> {
  const map = new Map<string, number>();
  for (const item of vars.__lilith_cost_map ?? []) {
    const [id, rawCost] = item.split(':');
    const parsed = Number(rawCost);
    if (id && Number.isFinite(parsed)) {
      map.set(id, parsed);
    }
  }
  return map;
}

function writeLilithCostOverride(vars: Record<string, string[]>, cardId: string, declaredCost: number): void {
  const map = readLilithCostMap(vars);
  map.set(cardId, declaredCost);
  vars.__lilith_cost_map = Array.from(map.entries()).map(([id, c]) => `${id}:${c}`);
}

function getEffectiveRevealedCost(
  rt: CustomHandlerRuntime,
  card: CardInstance,
  vars: Record<string, string[]>
): number {
  const overridden = readLilithCostMap(vars).get(card.instanceId);
  if (overridden !== undefined) return overridden;
  return rt.def(card)?.cost ?? 0;
}

function isSourceLilith(rt: CustomHandlerRuntime, sourceId: string): boolean {
  const src = rt.ctx.state.cards[sourceId];
  return Boolean(src && rt.hasTrait(src, '莉莉丝'));
}

/**
 * 若本次公开的卡牌中包含 BP03-065 血色醍醐 / BP03-066 繁宵蜃景之哀 且来源属于<莉莉丝>，
 * 依序询问控制者声明其临时视为的费用；若已全部声明返回 false。
 */
function promptNextLilithCostDeclaration(
  rt: CustomHandlerRuntime,
  candidateIds: string[],
  vars: Record<string, string[]>,
  frame: Omit<CustomHandlerFrameState, 'vars' | 'stage'>,
  nextStageAfterDone: string
): boolean {
  if (!isSourceLilith(rt, frame.sourceCardInstanceId)) return false;
  const declared = readLilithCostMap(vars);
  for (const id of candidateIds) {
    if (declared.has(id)) continue;
    const card = rt.ctx.state.cards[id];
    if (!card || card.controllerPlayerId !== frame.playerId) continue;
    const choices = LILITH_COST_DECL_CARDS[card.cardNumber];
    if (!choices) continue;
    const def = rt.def(card);
    rt.enqueueCustomChoice(
      {
        id: rt.choiceId(`lilith-declare-${card.cardNumber}`),
        playerId: frame.playerId,
        choiceType: 'SELECT_OPTION',
        prompt: `【${def?.name ?? card.cardNumber}】被我方<莉莉丝>的效果公开，请选择该次处理中将其费用视为的数字：`,
        options: choices.map((n) => ({ id: String(n), label: `费用视为 ${n}` })),
        effectType: `DSL_LILITH_DECLARE_${card.cardNumber}`,
        sourceCardInstanceId: frame.sourceCardInstanceId,
        minSelections: 1,
        maxSelections: 1,
      },
      {
        ...frame,
        vars,
        stage: 'LILITH_DECLARE_COST',
        extra: {
          ...(frame.extra ?? {}),
          targetCardId: id,
          candidateIds,
          nextStage: nextStageAfterDone,
        },
      }
    );
    return true;
  }
  return false;
}

function getCardEntryList(rt: CustomHandlerRuntime, cardNumber: string): DeclarativeEntrySpec[] {
  const spec = rt.registry.get(cardNumber);
  if (!spec) return [];
  if (spec.entries && spec.entries.length > 0) return spec.entries;
  if (spec.entry) return [spec.entry];
  return [];
}

/**
 * 执行声明式 CUSTOM_HANDLER 起始步骤
 */
export function startCustomHandler(
  handlerId: CustomHandlerId,
  rt: CustomHandlerRuntime,
  cardNumber: string,
  sourceId: string,
  playerId: string,
  vars: Record<string, string[]>,
  remainingSteps: EffectStep[]
): boolean {
  const baseFrame = {
    cardNumber,
    sourceCardInstanceId: sourceId,
    playerId,
    handlerId,
    remainingSteps,
  };

  switch (handlerId) {
    case 'BP02_048_WANSHIMING_SACRIFICE': {
      const candidates = [
        ...rt.zone(playerId, 'COST'),
        ...rt.zone(playerId, 'HAND'),
      ].filter((c) => rt.hasTrait(c, '万世铭'));
      if (candidates.length === 0) return false;
      rt.enqueueCustomChoice(
        {
          id: rt.choiceId('bp02-048-sac'),
          playerId,
          choiceType: 'SELECT_CARDS',
          prompt: '【BP02-048 曲·启明】【出】可选择我方费用区和手牌任意数量的<万世铭>放置到墓地：',
          options: candidates.map((c) => ({
            ...rt.effects.createGeneralCardChoiceOption(c),
            label: `${c.zone === 'COST' ? '[费用区]' : '[手牌]'} ${rt.def(c)?.name ?? c.cardNumber}`,
          })),
          effectType: 'DSL_CUSTOM_BP02_048_SAC',
          sourceCardInstanceId: sourceId,
          minSelections: 0,
          maxSelections: candidates.length,
        },
        { ...baseFrame, vars, stage: 'PICK_SACRIFICE' }
      );
      return true;
    }

    case 'BP03_056_COPY_GY_ENTRY': {
      const gyCards = rt.zone(playerId, 'GRAVEYARD').filter((c) => {
        const isLilithMirror =
          rt.ctx.continuousEffects?.hasCardName(c.instanceId, '莉莉丝·谬影') ??
          rt.def(c)?.name === '莉莉丝·谬影';
        return isLilithMirror && getCardEntryList(rt, c.cardNumber).length > 0;
      });
      if (gyCards.length === 0) return false;
      rt.enqueueCustomChoice(
        {
          id: rt.choiceId('bp03-056-gy'),
          playerId,
          choiceType: 'SELECT_CARDS',
          prompt: '【BP03-056 莉莉丝·谬影 纸牌屋】请选择我方墓地 1 张《莉莉丝·谬影》复制其【出】能力：',
          options: gyCards.map((c) => rt.effects.createGeneralCardChoiceOption(c)),
          effectType: 'DSL_CUSTOM_BP03_056_GY',
          sourceCardInstanceId: sourceId,
          minSelections: 1,
          maxSelections: 1,
        },
        { ...baseFrame, vars, stage: 'PICK_GY_ROLE' }
      );
      return true;
    }

    case 'BP03_058_ASCENDING_COST_5': {
      const revealed: string[] = [];
      for (let i = 0; i < 5; i++) {
        if (!rt.ctx.zoneMgr.refreshDeckIfEmpty(playerId)) break;
        const top = rt.zone(playerId, 'DECK')[0]!;
        rt.ctx.zoneMgr.moveCard(top.instanceId, 'PROCESSING', { isFaceUp: true });
        revealed.push(top.instanceId);
      }
      vars.bp03_058_rev = revealed;
      if (promptNextLilithCostDeclaration(rt, revealed, vars, baseFrame, 'PICK_5_CARDS')) {
        return true;
      }
      return continueCustomStage(rt, { ...baseFrame, vars, stage: 'PICK_5_CARDS' });
    }

    case 'BP03_059_BLACKJACK_21': {
      const handLiliths = rt.zone(playerId, 'HAND').filter((c) => rt.hasTrait(c, '莉莉丝'));
      vars.bp03_059_hand_rev = [];
      vars.bp03_059_deck_rev = [];
      if (handLiliths.length === 0) {
        return continueCustomStage(rt, { ...baseFrame, vars, stage: 'ASK_CONTINUE' });
      }
      rt.enqueueCustomChoice(
        {
          id: rt.choiceId('bp03-059-hand'),
          playerId,
          choiceType: 'SELECT_CARDS',
          prompt: '【BP03-059 莉莉丝·谬影】可公开我方手牌最多 2 张<莉莉丝>（不选则跳过）：',
          options: handLiliths.map((c) => rt.effects.createGeneralCardChoiceOption(c)),
          effectType: 'DSL_CUSTOM_BP03_059_HAND',
          sourceCardInstanceId: sourceId,
          minSelections: 0,
          maxSelections: Math.min(2, handLiliths.length),
        },
        { ...baseFrame, vars, stage: 'PICK_HAND_LILITH' }
      );
      return true;
    }

    case 'BP03_061_GUESS_PARITY': {
      const oppId = rt.resolveSide(playerId, 'OPPONENT');
      rt.enqueueCustomChoice(
        {
          id: rt.choiceId('bp03-061-opp-guess'),
          playerId: oppId,
          choiceType: 'SELECT_OPTION',
          prompt: '【BP03-061 莉莉丝·谬影】请宣言对方牌组顶卡牌费用的奇偶：',
          options: [
            { id: 'odd', label: '宣言：奇数' },
            { id: 'even', label: '宣言：偶数' },
          ],
          effectType: 'DSL_CUSTOM_BP03_061_GUESS',
          sourceCardInstanceId: sourceId,
          minSelections: 1,
          maxSelections: 1,
        },
        { ...baseFrame, vars, stage: 'OPP_GUESS' }
      );
      return true;
    }

    case 'BP03_063_CLASH_TOP': {
      const oppId = rt.resolveSide(playerId, 'OPPONENT');
      let selfTopId: string | undefined;
      let oppTopId: string | undefined;
      if (rt.ctx.zoneMgr.refreshDeckIfEmpty(playerId)) {
        const c = rt.zone(playerId, 'DECK')[0]!;
        rt.ctx.zoneMgr.moveCard(c.instanceId, 'PROCESSING', { isFaceUp: true });
        selfTopId = c.instanceId;
      }
      if (rt.ctx.zoneMgr.refreshDeckIfEmpty(oppId)) {
        const c = rt.zone(oppId, 'DECK')[0]!;
        rt.ctx.zoneMgr.moveCard(c.instanceId, 'PROCESSING', { isFaceUp: true });
        oppTopId = c.instanceId;
      }
      vars.bp03_063_self = selfTopId ? [selfTopId] : [];
      vars.bp03_063_opp = oppTopId ? [oppTopId] : [];
      if (selfTopId && promptNextLilithCostDeclaration(rt, [selfTopId], vars, baseFrame, 'RESOLVE_CLASH')) {
        return true;
      }
      return continueCustomStage(rt, { ...baseFrame, vars, stage: 'RESOLVE_CLASH' });
    }

    case 'BP03_064_SIMULTANEOUS_REVEAL_ORB': {
      const oppId = rt.resolveSide(playerId, 'OPPONENT');
      const selfRev: string[] = [];
      const oppRev: string[] = [];
      let selfHit = false;
      let oppHit = false;
      let interrupted = false;

      while (true) {
        const selfDeck = rt.zone(playerId, 'DECK');
        const oppDeck = rt.zone(oppId, 'DECK');
        if (selfDeck.length === 0 || oppDeck.length === 0) {
          interrupted = true;
          break;
        }
        const sTop = selfDeck[0]!;
        const oTop = oppDeck[0]!;
        rt.ctx.zoneMgr.moveCard(sTop.instanceId, 'PROCESSING', { isFaceUp: true });
        rt.ctx.zoneMgr.moveCard(oTop.instanceId, 'PROCESSING', { isFaceUp: true });
        selfRev.push(sTop.instanceId);
        oppRev.push(oTop.instanceId);
        if (rt.def(sTop)?.signalOrb) selfHit = true;
        if (rt.def(oTop)?.signalOrb) oppHit = true;
        if (selfHit || oppHit) break;
      }

      // 将公开到处理区的牌放回各自牌组并洗切
      for (const id of selfRev) rt.ctx.zoneMgr.moveCard(id, 'DECK', { isFaceUp: false });
      for (const id of oppRev) rt.ctx.zoneMgr.moveCard(id, 'DECK', { isFaceUp: false });
      if (selfRev.length > 0) rt.ctx.zoneMgr.shuffleDeck(playerId);
      if (oppRev.length > 0) rt.ctx.zoneMgr.shuffleDeck(oppId);

      if (interrupted) return false;

      if (selfHit) rt.ctx.zoneMgr.drawCards(playerId, 2);
      if (oppHit) rt.ctx.zoneMgr.drawCards(oppId, 2);

      const needSelfDiscard = selfHit && rt.zone(playerId, 'HAND').length > 0;
      const needOppDiscard = oppHit && rt.zone(oppId, 'HAND').length > 0;
      if (!needSelfDiscard && !needOppDiscard) return false;

      if (needSelfDiscard) {
        enqueueBp03064Discard(rt, playerId, 'SELF_DISCARD', { oppPending: needOppDiscard }, baseFrame, vars);
        return true;
      }
      enqueueBp03064Discard(rt, oppId, 'OPP_DISCARD', {}, baseFrame, vars);
      return true;
    }
  }
}

function enqueueBp03064Discard(
  rt: CustomHandlerRuntime,
  targetPlayerId: string,
  stage: 'SELF_DISCARD' | 'OPP_DISCARD',
  extra: Record<string, unknown>,
  baseFrame: Omit<CustomHandlerFrameState, 'vars' | 'stage'>,
  vars: Record<string, string[]>
): void {
  const hand = rt.zone(targetPlayerId, 'HAND');
  rt.enqueueCustomChoice(
    {
      id: rt.choiceId(`bp03-064-discard-${targetPlayerId}`),
      playerId: targetPlayerId,
      choiceType: 'SELECT_CARDS',
      prompt: '【BP03-064 莉莉丝·谬影】公开了信号球，抽 2 张后请选择 1 张手牌丢弃：',
      options: hand.map((c) => rt.effects.createGeneralCardChoiceOption(c)),
      effectType: 'DSL_CUSTOM_BP03_064_DISCARD',
      sourceCardInstanceId: baseFrame.sourceCardInstanceId,
      minSelections: 1,
      maxSelections: 1,
    },
    { ...baseFrame, vars, stage, extra }
  );
}

function continueCustomStage(rt: CustomHandlerRuntime, frame: CustomHandlerFrameState): boolean {
  const { cardNumber, sourceCardInstanceId: sourceId, playerId, vars, remainingSteps, handlerId, stage } = frame;
  const baseFrame = { cardNumber, sourceCardInstanceId: sourceId, playerId, handlerId, remainingSteps };

  if (handlerId === 'BP03_058_ASCENDING_COST_5' && stage === 'PICK_5_CARDS') {
    const revCards = (vars.bp03_058_rev ?? [])
      .map((id) => rt.ctx.state.cards[id])
      .filter((c): c is CardInstance => Boolean(c));
    const handCards = rt.zone(playerId, 'HAND');
    const pool = [...revCards, ...handCards];
    if (pool.length < 5) {
      return finishBp03058ShuffleRemaining(rt, frame);
    }
    const costMap = readLilithCostMap(vars);
    rt.enqueueCustomChoice(
      {
        id: rt.choiceId('bp03-058-pick5'),
        playerId,
        choiceType: 'SELECT_CARDS',
        prompt: '【BP03-058 莉莉丝·谬影】可从公开的牌与手牌中选择合计 5 张费用严格递增的卡牌放置到墓地（不选则全部洗回）：',
        options: pool.map((c) => {
          const effCost = costMap.get(c.instanceId) ?? rt.def(c)?.cost ?? 0;
          return {
            ...rt.effects.createGeneralCardChoiceOption(c),
            label: `${c.zone === 'PROCESSING' ? '[公开]' : '[手牌]'} ${rt.def(c)?.name ?? c.cardNumber} (费用 ${effCost})`,
          };
        }),
        effectType: 'DSL_CUSTOM_BP03_058_PICK5',
        sourceCardInstanceId: sourceId,
        minSelections: 0,
        maxSelections: 5,
      },
      { ...baseFrame, vars, stage: 'PICK_5_CARDS_SUBMIT' }
    );
    return true;
  }

  if (handlerId === 'BP03_059_BLACKJACK_21') {
    if (stage === 'AFTER_HAND_COSTS') {
      return continueCustomStage(rt, { ...frame, stage: 'ASK_CONTINUE' });
    }
    if (stage === 'ASK_CONTINUE') {
      const deckRev = vars.bp03_059_deck_rev ?? [];
      const currentSum = sumLilithRevealedCosts(rt, [...(vars.bp03_059_hand_rev ?? []), ...deckRev], vars);
      if (deckRev.length < 5 && rt.zone(playerId, 'DECK').length > 0) {
        rt.enqueueCustomChoice(
          {
            id: rt.choiceId('bp03-059-step'),
            playerId,
            choiceType: 'SELECT_OPTION',
            prompt: `【BP03-059 莉莉丝·谬影】当前公开的<莉莉丝>费用合计为 ${currentSum} (已从牌组公开 ${deckRev.length}/5 张)，是否继续公开下 1 张？`,
            options: [
              { id: 'reveal_one', label: '公开牌组顶下 1 张牌' },
              { id: 'stop', label: '停止公开并结算结果' },
            ],
            effectType: 'DSL_CUSTOM_BP03_059_STEP',
            sourceCardInstanceId: sourceId,
            minSelections: 1,
            maxSelections: 1,
          },
          { ...baseFrame, vars, stage: 'DECIDE_REVEAL_ONE' }
        );
        return true;
      }
      return finishBp03059Outcome(rt, frame);
    }
  }

  if (handlerId === 'BP03_061_GUESS_PARITY' && stage === 'CHECK_REVEALED_PARITY') {
    const revId = (vars.bp03_061_rev ?? [])[0];
    const declared = (vars.bp03_061_declared ?? [])[0];
    if (!revId || !declared) return false;
    const revCard = rt.ctx.state.cards[revId];
    const cost = revCard ? getEffectiveRevealedCost(rt, revCard, vars) : 0;
    if (revCard) {
      rt.ctx.zoneMgr.moveCardToTopOfDeck(revId);
    }
    const actual = cost % 2 === 1 ? 'odd' : 'even';
    if (actual === declared) return false;
    const lilithRoles = rt.roles(playerId).filter((r) => rt.hasTrait(r, '莉莉丝'));
    if (lilithRoles.length === 0) return false;
    rt.enqueueCustomChoice(
      {
        id: rt.choiceId('bp03-061-untap'),
        playerId,
        choiceType: 'SELECT_CARDS',
        prompt: '【BP03-061 莉莉丝·谬影】费用奇偶与对方宣言不同！请选择我方战场 1 张<莉莉丝>角色，回合结束时将其竖直：',
        options: lilithRoles.map((r) => rt.effects.createRoleChoiceOption(r)),
        effectType: 'DSL_CUSTOM_BP061_PICK_UNTAP',
        sourceCardInstanceId: sourceId,
        minSelections: 1,
        maxSelections: 1,
      },
      { ...baseFrame, vars, stage: 'PICK_LILITH_UNTAP' }
    );
    return true;
  }

  if (handlerId === 'BP03_063_CLASH_TOP' && stage === 'RESOLVE_CLASH') {
    const oppId = rt.resolveSide(playerId, 'OPPONENT');
    const selfId = (vars.bp03_063_self ?? [])[0];
    const oppTopId = (vars.bp03_063_opp ?? [])[0];
    const selfCard = selfId ? rt.ctx.state.cards[selfId] : undefined;
    const oppCard = oppTopId ? rt.ctx.state.cards[oppTopId] : undefined;
    const selfCost = selfCard ? getEffectiveRevealedCost(rt, selfCard, vars) : -1;
    const oppCost = oppCard ? (rt.def(oppCard)?.cost ?? 0) : -1;
    if (selfId) rt.ctx.zoneMgr.moveCardToTopOfDeck(selfId);
    if (oppTopId) rt.ctx.zoneMgr.moveCardToTopOfDeck(oppTopId);
    if (selfCost > oppCost && selfCost >= 0) {
      rt.ctx.zoneMgr.drawCards(playerId, 1);
    } else if (oppCost > selfCost && oppCost >= 0) {
      rt.ctx.zoneMgr.drawCards(oppId, 1);
    }
    return false;
  }

  return false;
}

function sumLilithRevealedCosts(
  rt: CustomHandlerRuntime,
  cardIds: string[],
  vars: Record<string, string[]>
): number {
  let sum = 0;
  for (const id of cardIds) {
    const card = rt.ctx.state.cards[id];
    if (!card || !rt.hasTrait(card, '莉莉丝')) continue;
    sum += getEffectiveRevealedCost(rt, card, vars);
  }
  return sum;
}

function finishBp03058ShuffleRemaining(rt: CustomHandlerRuntime, frame: CustomHandlerFrameState): boolean {
  const revIds = frame.vars.bp03_058_rev ?? [];
  let movedAny = false;
  for (const id of revIds) {
    const c = rt.ctx.state.cards[id];
    if (c && c.zone === 'PROCESSING') {
      rt.ctx.zoneMgr.moveCard(id, 'DECK', { isFaceUp: false });
      movedAny = true;
    }
  }
  if (movedAny) {
    rt.ctx.zoneMgr.shuffleDeck(frame.playerId);
  }
  return false;
}

function finishBp03059Outcome(rt: CustomHandlerRuntime, frame: CustomHandlerFrameState): boolean {
  const { playerId, vars, cardNumber, sourceCardInstanceId: sourceId, remainingSteps } = frame;
  const deckRev = vars.bp03_059_deck_rev ?? [];
  const total = sumLilithRevealedCosts(rt, [...(vars.bp03_059_hand_rev ?? []), ...deckRev], vars);

  let paused = false;
  if (total === 19 || total === 20 || total === 21) {
    const delta = total === 21 ? -9999 : -4000;
    const oppId = rt.resolveSide(playerId, 'OPPONENT');
    const oppRoles = rt.roles(oppId);
    if (oppRoles.length > 0) {
      rt.enqueueCustomChoice(
        {
          id: rt.choiceId('bp03-059-debuff'),
          playerId,
          choiceType: 'SELECT_CARDS',
          prompt: `【BP03-059 莉莉丝·谬影】费用合计 ${total}！请选择对方战场 1 张角色使其直到回合结束 PP${delta}：`,
          options: oppRoles.map((r) => rt.effects.createRoleChoiceOption(r)),
          effectType: 'DSL_CUSTOM_BP03_059_DEBUFF',
          sourceCardInstanceId: sourceId,
          minSelections: 1,
          maxSelections: 1,
        },
        {
          cardNumber,
          sourceCardInstanceId: sourceId,
          playerId,
          vars,
          remainingSteps,
          handlerId: 'BP03_059_BLACKJACK_21',
          stage: 'PICK_OPP_DEBUFF',
          extra: { ppDelta: delta },
        }
      );
      paused = true;
    }
  }

  // 洗切因该方法从牌组公开的牌 (若等待选目标，仍在处理区的将在 debuff 完成后洗切，或此时立即放回)
  if (!paused && deckRev.length > 0) {
    for (const id of deckRev) {
      const c = rt.ctx.state.cards[id];
      if (c && c.zone === 'PROCESSING') {
        rt.ctx.zoneMgr.moveCard(id, 'DECK', { isFaceUp: false });
      }
    }
    rt.ctx.zoneMgr.shuffleDeck(playerId);
  }
  return paused;
}

/**
 * 结算自定义复杂处理器挂起的决策
 */
export function resolveCustomChoice(
  rt: CustomHandlerRuntime,
  action: Extract<GameAction, { type: 'SELECT_CHOICE_OPTION' }>,
  frame: CustomHandlerFrameState
): Result {
  const { handlerId, stage, playerId, cardNumber, sourceCardInstanceId: sourceId, remainingSteps, extra } = frame;
  const vars: Record<string, string[]> = { ...frame.vars };
  const selected = action.selectedIds;
  const turn = rt.ctx.state.turnNumber;

  // 通用的 BP03-065/066 公开费用声明分支
  if (stage === 'LILITH_DECLARE_COST') {
    const targetCardId = extra?.targetCardId as string;
    const candidateIds = (extra?.candidateIds as string[]) ?? [];
    const nextStage = (extra?.nextStage as string) ?? '';
    const pickedNum = Number(selected[0]);
    if (!targetCardId || !Number.isFinite(pickedNum)) {
      return { success: false, error: '无效的费用声明选择' };
    }
    writeLilithCostOverride(vars, targetCardId, pickedNum);
    const nextFrameBase = {
      cardNumber,
      sourceCardInstanceId: sourceId,
      playerId,
      handlerId,
      remainingSteps,
    };
    if (promptNextLilithCostDeclaration(rt, candidateIds, vars, nextFrameBase, nextStage)) {
      return { success: true };
    }
    const paused = continueCustomStage(rt, { ...nextFrameBase, vars, stage: nextStage });
    if (!paused) {
      rt.resumeSteps(cardNumber, sourceId, playerId, vars, remainingSteps);
    }
    return { success: true };
  }

  switch (handlerId) {
    case 'BP02_048_WANSHIMING_SACRIFICE': {
      if (selected.length === 0) {
        rt.resumeSteps(cardNumber, sourceId, playerId, vars, remainingSteps);
        return { success: true };
      }
      let fromCostCount = 0;
      let fromHandCount = 0;
      for (const id of selected) {
        const c = rt.ctx.state.cards[id];
        if (!c) continue;
        if (c.zone === 'COST') fromCostCount++;
        else if (c.zone === 'HAND') fromHandCount++;
        rt.ctx.zoneMgr.moveCard(id, 'GRAVEYARD', { isFaceUp: true });
      }
      if (fromCostCount > 0) {
        rt.ctx.zoneMgr.syncCostStats(playerId);
        const selfCard = rt.ctx.state.cards[sourceId];
        if (selfCard && rt.ctx.fieldMgr.isSlotRole(playerId, sourceId)) {
          addCardModifier(rt.ctx.state, selfCard, {
            keywords: ['速攻'],
            setBasePP: 9999,
            untilTurn: turn + 1,
            source: cardNumber,
            sourceCardInstanceId: sourceId,
          });
        }
      }
      const nextQueue = [...remainingSteps];
      if (fromHandCount > 0) {
        nextQueue.unshift(
          { op: 'REVEAL_TOP', count: 4, saveToVar: '__bp02048_rev' },
          {
            op: 'CHOOSE_FROM_VAR',
            varName: '__bp02048_rev',
            prompt: '【BP02-048 曲·启明】从公开的 4 张牌中选择最多 2 张加入手牌 (剩余放牌组底)：',
            alwaysShow: true,
            min: 0,
            max: 2,
            saveToVar: '__bp02048_keep',
          },
          { op: 'MOVE_CARDS', target: { kind: 'VAR', varName: '__bp02048_keep' }, toZone: 'HAND' },
          {
            op: 'MOVE_CARDS',
            target: { kind: 'REST_OF_VAR', allVar: '__bp02048_rev', excludeVar: '__bp02048_keep' },
            toZone: 'DECK_BOTTOM',
          }
        );
      }
      rt.resumeSteps(cardNumber, sourceId, playerId, vars, nextQueue);
      return { success: true };
    }

    case 'BP03_056_COPY_GY_ENTRY': {
      if (stage === 'PICK_GY_ROLE') {
        const gyId = selected[0];
        const gyCard = gyId ? rt.ctx.state.cards[gyId] : undefined;
        if (!gyCard) return { success: false, error: '所选墓地卡牌不存在' };
        const entryList = getCardEntryList(rt, gyCard.cardNumber);
        if (entryList.length === 0) return { success: false, error: '该卡牌没有可复制的【出】能力' };
        vars.__bp03056_picked_gy = [gyId!];
        const moveGyToBottomStep: EffectStep = {
          op: 'MOVE_CARDS',
          target: { kind: 'VAR', varName: '__bp03056_picked_gy' },
          toZone: 'DECK_BOTTOM',
        };
        if (entryList.length === 1) {
          const e = entryList[0]!;
          rt.executeEntryOnSource(
            gyCard.cardNumber,
            sourceId,
            playerId,
            e.cost,
            [...e.steps, moveGyToBottomStep, ...remainingSteps],
            vars
          );
          return { success: true };
        }
        rt.enqueueCustomChoice(
          {
            id: rt.choiceId('bp03-056-entry'),
            playerId,
            choiceType: 'SELECT_OPTION',
            prompt: `【BP03-056 莉莉丝·谬影 纸牌屋】请选择要发动的【出】能力：`,
            options: entryList.map((e, idx) => ({
              id: String(idx),
              label: e.label ?? `【出】能力 #${idx + 1}`,
            })),
            effectType: 'DSL_CUSTOM_BP03_056_ENTRY_IDX',
            sourceCardInstanceId: sourceId,
            minSelections: 1,
            maxSelections: 1,
          },
          { ...frame, vars, stage: 'PICK_ENTRY_INDEX', extra: { gyCardNumber: gyCard.cardNumber } }
        );
        return { success: true };
      }

      if (stage === 'PICK_ENTRY_INDEX') {
        const idx = Number(selected[0]);
        const gyCardNumber = extra?.gyCardNumber as string;
        const entryList = getCardEntryList(rt, gyCardNumber);
        const picked = Number.isInteger(idx) ? entryList[idx] : undefined;
        if (!picked) return { success: false, error: '所选【出】能力索引无效' };
        const moveGyToBottomStep: EffectStep = {
          op: 'MOVE_CARDS',
          target: { kind: 'VAR', varName: '__bp03056_picked_gy' },
          toZone: 'DECK_BOTTOM',
        };
        rt.executeEntryOnSource(
          gyCardNumber,
          sourceId,
          playerId,
          picked.cost,
          [...picked.steps, moveGyToBottomStep, ...remainingSteps],
          vars
        );
        return { success: true };
      }
      return { success: false, error: '未知 BP03-056 阶段' };
    }

    case 'BP03_058_ASCENDING_COST_5': {
      if (stage === 'PICK_5_CARDS_SUBMIT') {
        if (selected.length === 0) {
          finishBp03058ShuffleRemaining(rt, frame);
          rt.resumeSteps(cardNumber, sourceId, playerId, vars, remainingSteps);
          return { success: true };
        }
        if (selected.length !== 5) {
          return { success: false, error: '若选择放置到墓地，必须选择恰好 5 张费用递增的卡牌 (或 0 张跳过)' };
        }
        const costs = selected
          .map((id) => {
            const c = rt.ctx.state.cards[id];
            return c ? getEffectiveRevealedCost(rt, c, vars) : -1;
          })
          .sort((a, b) => a - b);
        for (let i = 1; i < costs.length; i++) {
          if (costs[i]! <= costs[i - 1]!) {
            return {
              success: false,
              error: `所选 5 张卡牌费用 (${costs.join(', ')}) 不是严格递增`,
            };
          }
        }
        for (const id of selected) {
          const c = rt.ctx.state.cards[id];
          if (!c) continue;
          rt.ctx.zoneMgr.moveCard(id, 'GRAVEYARD', {
            isFaceUp: true,
            countAsDeckToGy: c.zone === 'PROCESSING',
          });
        }
        const gyCandidates = rt.zone(playerId, 'GRAVEYARD').filter((c) => {
          const d = rt.def(c);
          const isName =
            rt.ctx.continuousEffects?.hasCardName(c.instanceId, '莉莉丝·谬影') ??
            d?.name === '莉莉丝·谬影';
          return isName && d?.cardType === 'ROLE' && d.cost <= 4;
        });
        if (gyCandidates.length > 0 && rt.hasEmptySlot(playerId)) {
          rt.enqueueCustomChoice(
            {
              id: rt.choiceId('bp03-058-deploy'),
              playerId,
              choiceType: 'SELECT_CARDS',
              prompt: '【BP03-058 莉莉丝·谬影】请选择我方墓地 1 张费用为 4 及以下的《莉莉丝·谬影》出场：',
              options: gyCandidates.map((c) => rt.effects.createGeneralCardChoiceOption(c)),
              effectType: 'DSL_CUSTOM_BP03_058_DEPLOY',
              sourceCardInstanceId: sourceId,
              minSelections: 1,
              maxSelections: 1,
            },
            { ...frame, vars, stage: 'PICK_GY_DEPLOY' }
          );
          return { success: true };
        }
        finishBp03058ShuffleRemaining(rt, frame);
        rt.resumeSteps(cardNumber, sourceId, playerId, vars, remainingSteps);
        return { success: true };
      }

      if (stage === 'PICK_GY_DEPLOY') {
        const deployId = selected[0];
        if (deployId && rt.hasEmptySlot(playerId)) {
          rt.bringToField(playerId, deployId, true);
        }
        finishBp03058ShuffleRemaining(rt, frame);
        rt.resumeSteps(cardNumber, sourceId, playerId, vars, remainingSteps);
        return { success: true };
      }
      return { success: false, error: '未知 BP03-058 阶段' };
    }

    case 'BP03_059_BLACKJACK_21': {
      if (stage === 'PICK_HAND_LILITH') {
        vars.bp03_059_hand_rev = [...selected];
        if (
          promptNextLilithCostDeclaration(rt, selected, vars, { cardNumber, sourceCardInstanceId: sourceId, playerId, handlerId, remainingSteps }, 'AFTER_HAND_COSTS')
        ) {
          return { success: true };
        }
        const paused = continueCustomStage(rt, { ...frame, vars, stage: 'ASK_CONTINUE' });
        if (!paused) rt.resumeSteps(cardNumber, sourceId, playerId, vars, remainingSteps);
        return { success: true };
      }

      if (stage === 'DECIDE_REVEAL_ONE') {
        if (selected[0] === 'stop') {
          const paused = finishBp03059Outcome(rt, { ...frame, vars });
          if (!paused) rt.resumeSteps(cardNumber, sourceId, playerId, vars, remainingSteps);
          return { success: true };
        }
        if (rt.zone(playerId, 'DECK').length > 0) {
          const top = rt.zone(playerId, 'DECK')[0]!;
          rt.ctx.zoneMgr.moveCard(top.instanceId, 'PROCESSING', { isFaceUp: true });
          vars.bp03_059_deck_rev = [...(vars.bp03_059_deck_rev ?? []), top.instanceId];
          if (
            promptNextLilithCostDeclaration(
              rt,
              [top.instanceId],
              vars,
              { cardNumber, sourceCardInstanceId: sourceId, playerId, handlerId, remainingSteps },
              'ASK_CONTINUE'
            )
          ) {
            return { success: true };
          }
        }
        const paused = continueCustomStage(rt, { ...frame, vars, stage: 'ASK_CONTINUE' });
        if (!paused) rt.resumeSteps(cardNumber, sourceId, playerId, vars, remainingSteps);
        return { success: true };
      }

      if (stage === 'PICK_OPP_DEBUFF') {
        const targetId = selected[0];
        const ppDelta = Number(extra?.ppDelta ?? -4000);
        const targetCard = targetId ? rt.ctx.state.cards[targetId] : undefined;
        if (targetCard && rt.ctx.fieldMgr.isSlotRole(rt.resolveSide(playerId, 'OPPONENT'), targetCard.instanceId)) {
          addCardModifier(rt.ctx.state, targetCard, {
            pp: ppDelta,
            untilTurn: turn,
            source: cardNumber,
            sourceCardInstanceId: sourceId,
            appliedByPlayerId: playerId,
          });
        }
        const deckRev = vars.bp03_059_deck_rev ?? [];
        if (deckRev.length > 0) {
          for (const id of deckRev) {
            const c = rt.ctx.state.cards[id];
            if (c && c.zone === 'PROCESSING') rt.ctx.zoneMgr.moveCard(id, 'DECK', { isFaceUp: false });
          }
          rt.ctx.zoneMgr.shuffleDeck(playerId);
        }
        rt.resumeSteps(cardNumber, sourceId, playerId, vars, remainingSteps);
        return { success: true };
      }
      return { success: false, error: '未知 BP03-059 阶段' };
    }

    case 'BP03_061_GUESS_PARITY': {
      if (stage === 'OPP_GUESS') {
        vars.bp03_061_declared = [selected[0]!];
        if (!rt.ctx.zoneMgr.refreshDeckIfEmpty(playerId)) {
          rt.resumeSteps(cardNumber, sourceId, playerId, vars, remainingSteps);
          return { success: true };
        }
        const top = rt.zone(playerId, 'DECK')[0]!;
        rt.ctx.zoneMgr.moveCard(top.instanceId, 'PROCESSING', { isFaceUp: true });
        vars.bp03_061_rev = [top.instanceId];
        if (
          promptNextLilithCostDeclaration(
            rt,
            [top.instanceId],
            vars,
            { cardNumber, sourceCardInstanceId: sourceId, playerId, handlerId, remainingSteps },
            'CHECK_REVEALED_PARITY'
          )
        ) {
          return { success: true };
        }
        const paused = continueCustomStage(rt, { ...frame, vars, stage: 'CHECK_REVEALED_PARITY' });
        if (!paused) rt.resumeSteps(cardNumber, sourceId, playerId, vars, remainingSteps);
        return { success: true };
      }

      if (stage === 'PICK_LILITH_UNTAP') {
        const pickedId = selected[0];
        const role = pickedId ? rt.ctx.state.cards[pickedId] : undefined;
        if (role && role.zone === 'BATTLEFIELD') {
          rt.ctx.triggerMgr?.registerDelayedTrigger({
            eventType: 'END_PHASE_TRIGGERS',
            triggerTurn: turn,
            sourceCardInstanceId: role.instanceId,
            sourceCardNumber: role.cardNumber,
            controllerPlayerId: role.controllerPlayerId,
            abilityId: 'DELAYED_END_OF_TURN_UNTAP',
            label: `【${rt.def(role)?.name ?? role.cardNumber}】回合结束时竖直`,
            once: true,
            payload: { expectedEnteredTimestamp: role.enteredZoneTimestamp },
          });
        }
        rt.resumeSteps(cardNumber, sourceId, playerId, vars, remainingSteps);
        return { success: true };
      }
      return { success: false, error: '未知 BP03-061 阶段' };
    }

    case 'BP03_064_SIMULTANEOUS_REVEAL_ORB': {
      if (stage === 'SELF_DISCARD') {
        if (selected[0]) {
          rt.ctx.zoneMgr.moveCard(selected[0], 'GRAVEYARD', { isFaceUp: true });
        }
        const oppId = rt.resolveSide(playerId, 'OPPONENT');
        if (extra?.oppPending && rt.zone(oppId, 'HAND').length > 0) {
          enqueueBp03064Discard(
            rt,
            oppId,
            'OPP_DISCARD',
            {},
            { cardNumber, sourceCardInstanceId: sourceId, playerId, handlerId, remainingSteps },
            vars
          );
          return { success: true };
        }
        rt.resumeSteps(cardNumber, sourceId, playerId, vars, remainingSteps);
        return { success: true };
      }

      if (stage === 'OPP_DISCARD') {
        if (selected[0]) {
          rt.ctx.zoneMgr.moveCard(selected[0], 'GRAVEYARD', { isFaceUp: true });
        }
        rt.resumeSteps(cardNumber, sourceId, playerId, vars, remainingSteps);
        return { success: true };
      }
      return { success: false, error: '未知 BP03-064 阶段' };
    }

    default:
      return { success: false, error: `不支持的自定义决策处理器: ${String(handlerId)}` };
  }
}

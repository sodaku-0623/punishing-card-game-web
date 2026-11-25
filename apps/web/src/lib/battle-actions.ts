import {
  AscensionRestriction,
  AscensionRuleConfig,
  BattlefieldSlot,
  CardInstance,
  CardType,
  ElementAttribute,
  PublicGameState,
} from '@zhanshuang/shared';
import { parseAscensionConfig } from '@zhanshuang/game-rules';
import {
  canRoleAttackCharacterOnEnterTurn,
  canRoleAttackPlayerOnEnterTurn,
  getCardUnblockableMaxPP,
  getDisplayStats,
  hasCardProhibition,
} from '@/lib/card-stats';
import { findCardByNumberOrId } from '@/lib/cards-data';
import { resolveOrbDisplayInfo } from '@/lib/signal-orbs';
import { getTimingStatus } from '@/lib/timing';

export type SlotOccupancyKind = 'ROLE' | 'STANDALONE_EQUIPMENT' | 'ASSIST' | 'EMPTY';

export interface NonTacticsInstantOption {
  card: CardInstance;
  name: string;
  sourceLabel: string;
  costLabel: string;
}

export interface AssistPartnerOption {
  card: CardInstance;
  name: string;
  cardNumber: string;
  zoneLabel: string;
  cost: number;
  matchesFilter: boolean;
}

/**
 * 允许发动【起】动能力的区域（与引擎 `interpreter.ts` 的 `UsableActivationZone` 对齐）
 */
export type ActivatedAbilityZone =
  | 'BATTLEFIELD'
  | 'HAND'
  | 'GRAVEYARD'
  | 'COST'
  | 'SIGNAL_ORB'
  | 'UNDERNEATH';

/**
 * 卡牌在指定区域下可发动的【起】动能力条目（严格对齐引擎 `abilityIndex` 编排）
 */
export interface ActivatedAbilityOption {
  sourceCardId: string;
  abilityIndex: number;
  label: string;
  zone: ActivatedAbilityZone;
  grantedByEquipmentId?: string;
  hostCardId?: string;
  disabled?: boolean;
  reason?: string;
}

/**
 * 非手牌区出牌类型
 */
export type NonHandPlayKind =
  | 'ASCEND_FROM_GRAVEYARD'
  | 'PLAY_TACTICS_FROM_GRAVEYARD'
  | 'PLAY_TACTICS_FROM_UNDERNEATH';

export interface NonHandPlayAction {
  kind: NonHandPlayKind;
  label: string;
}

export type AscensionTargetZone = 'BATTLEFIELD' | 'SIGNAL_ORB' | 'AIRBORNE';

export interface AscensionTargetCandidate {
  card: CardInstance;
  zone: AscensionTargetZone;
  slotIndex?: number;
  requiresEmptySlot: boolean;
  name: string;
  cost: number;
}

export interface AscensionPlan {
  card: CardInstance;
  config: AscensionRuleConfig;
  sourceZoneValid: boolean;
  targets: AscensionTargetCandidate[];
  minCount: number;
  allowMultiple: boolean;
  extraCostCandidates: Array<{ card: CardInstance; slotIndex: number; name: string }>;
  emptySlotIndices: number[];
  tappedOpponentTaxCount: number;
  ascensionCost: number;
  minPayableCost: number;
  restrictionError?: string;
  canAscend: boolean;
  reason?: string;
}

export interface TraitLookupTarget {
  cardNumber?: string;
  cardId?: string;
  traits?: string[];
  effectiveTraits?: string[];
  modifiers?: CardInstance['modifiers'];
}

function normalizeCoreCardNumber(cardNumber?: string): string {
  if (!cardNumber) return '';
  const match = cardNumber.match(/^([A-Z]{2}\d*-\d+)/i);
  return match ? match[1]!.toUpperCase() : cardNumber.trim().toUpperCase();
}

function isModifierActive(untilTurn: number | undefined, turnNumber: number | undefined): boolean {
  return untilTurn === undefined || turnNumber === undefined || untilTurn >= turnNumber;
}

function getOpponentPlayerId(gameState: PublicGameState, myUserId: string): string | undefined {
  return (
    Object.keys(gameState.players || {}).find((id) => id !== myUserId) ??
    (gameState.activePlayerId === myUserId
      ? gameState.nonActivePlayerId
      : gameState.activePlayerId)
  );
}

/**
 * 规范化卡牌名称（与引擎 `continuous-effects.ts` 一致：`·\s+` → `·`、连续空白 → 单空格）
 */
export function normalizeCardName(name: string): string {
  return name.replace(/·\s+/g, '·').replace(/\s+/g, ' ').trim();
}

/**
 * 展开同义特征名称（与引擎 `expandBaseTraits` 一致：机械教会↔火花、神寂启示录↔异聚体、太刀类↔封刃太刀）
 */
export function expandTraitSynonyms(rawTraits: Iterable<string>): Set<string> {
  const traits = new Set<string>(rawTraits);
  if (traits.has('异聚体')) traits.add('神寂启示录');
  if (traits.has('神寂启示录')) traits.add('异聚体');
  if (traits.has('火花')) traits.add('机械教会');
  if (traits.has('机械教会')) traits.add('火花');
  if (traits.has('太刀') || traits.has('小太刀') || traits.has('大太刀')) {
    traits.add('封刃太刀');
  }
  if (traits.has('封刃太刀')) {
    traits.add('太刀');
  }
  return traits;
}

/**
 * 获取卡牌经 `effectiveTraits` / `modifiers` 调整并展开同义特征后的有效特征集合
 */
function getCardExpandedTraits(card: TraitLookupTarget): Set<string> {
  if (card.effectiveTraits !== undefined) {
    return expandTraitSynonyms(card.effectiveTraits);
  }
  const key = card.cardNumber || card.cardId || '';
  const def = key ? findCardByNumberOrId(key) : undefined;
  const clearBase = Boolean(card.modifiers?.some((m) => m.clearBaseTraits));
  const baseTraits = clearBase ? [] : card.traits ?? def?.traits ?? [];
  const addedTraits = card.modifiers?.flatMap((m) => m.addTraits ?? []) ?? [];
  return expandTraitSynonyms([...baseTraits, ...addedTraits]);
}

/**
 * 检查卡牌（或卡牌定义/待选负载）是否具备指定特征（自动展开同义特征）
 */
export function hasCardTrait(card: TraitLookupTarget | null | undefined, trait: string): boolean {
  if (!card) return false;
  return getCardExpandedTraits(card).has(trait);
}

/**
 * 检查卡牌名称（含原卡名与 `modifiers.treatedAsNames`「视为」效果）是否匹配目标卡名
 */
function hasCardName(card: CardInstance, targetName: string): boolean {
  const normTarget = normalizeCardName(targetName);
  const def = findCardByNumberOrId(card.cardNumber || card.cardId);
  if (def && normalizeCardName(def.name) === normTarget) return true;
  return Boolean(
    card.modifiers?.some((m) =>
      m.treatedAsNames?.some((n) => normalizeCardName(n) === normTarget)
    )
  );
}

function getLatestLoseAbilitiesTimestamp(
  card: CardInstance | null | undefined,
  turnNumber?: number
): number {
  let latestLoseTs = -1;
  for (const m of card?.modifiers ?? []) {
    if (m.loseAbilities === true && isModifierActive(m.untilTurn, turnNumber)) {
      latestLoseTs = Math.max(latestLoseTs, m.timestamp ?? 0);
    }
  }
  return latestLoseTs;
}

/**
 * 检查卡牌是否带有尚未过期的 `loseAbilities` 失能标记（8.3.4）
 */
function hasLostInherentAbilities(card: CardInstance, turnNumber?: number): boolean {
  return getLatestLoseAbilitiesTimestamp(card, turnNumber) >= 0;
}

/**
 * 读取卡牌经 `CardModifier.setCardType` 覆写后的有效卡类（按 `timestamp` 升序取最后一项，无则回退卡表定义或 `CardType.ROLE`）
 */
export function getEffectiveCardType(
  card: CardInstance,
  cardDef?: { cardType?: CardType }
): CardType {
  const mods = (card.modifiers ?? []).filter((m) => m.setCardType !== undefined);
  if (mods.length > 0) {
    mods.sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
    const last = mods[mods.length - 1];
    if (last?.setCardType !== undefined) {
      return last.setCardType;
    }
  }
  return cardDef?.cardType ?? CardType.ROLE;
}

export function isBattlefieldSlotEmpty(slot: BattlefieldSlot): boolean {
  return !slot.roleCardId && !slot.standaloneEquipmentId && !slot.assistCardId;
}

/**
 * 解析战场卡位的当前实际占用类型（兼容 `BP04-001` 角色变为辅助机与 `PR-041` 辅助机变为角色）
 */
export function getSlotOccupancy(
  slot: BattlefieldSlot,
  publicCards?: Record<string, CardInstance>
): { kind: SlotOccupancyKind; card?: CardInstance; isTransformed?: boolean } {
  if (slot.roleCardId && publicCards?.[slot.roleCardId]) {
    const roleCard = publicCards[slot.roleCardId]!;
    const effectiveType = getEffectiveCardType(roleCard, { cardType: CardType.ROLE });
    if (effectiveType === CardType.ASSIST) {
      return { kind: 'ASSIST', card: roleCard, isTransformed: true };
    }
    if (effectiveType === CardType.EQUIPMENT) {
      return { kind: 'STANDALONE_EQUIPMENT', card: roleCard, isTransformed: true };
    }
    return { kind: 'ROLE', card: roleCard };
  }
  if (slot.standaloneEquipmentId && publicCards?.[slot.standaloneEquipmentId]) {
    return { kind: 'STANDALONE_EQUIPMENT', card: publicCards[slot.standaloneEquipmentId]! };
  }
  if (slot.assistCardId && publicCards?.[slot.assistCardId]) {
    const assistCard = publicCards[slot.assistCardId]!;
    const effectiveType = getEffectiveCardType(assistCard, { cardType: CardType.ASSIST });
    if (effectiveType === CardType.ROLE) {
      return { kind: 'ROLE', card: assistCard, isTransformed: true };
    }
    return { kind: 'ASSIST', card: assistCard };
  }
  return { kind: 'EMPTY' };
}

/**
 * 判断指定卡牌在给定战场槽位上当前是否作为有效「角色牌」存在（对齐引擎 `BattlefieldManager.isSlotRole`）
 */
export function isSlotEffectiveRoleCard(
  slot: BattlefieldSlot,
  publicCards: Record<string, CardInstance> | undefined,
  cardId: string
): boolean {
  const occ = getSlotOccupancy(slot, publicCards);
  return occ.kind === 'ROLE' && occ.card?.instanceId === cardId;
}

/**
 * 8.6.2.b.2 判断目标战场槽位当前是否允许部署或替换辅助机牌（严格对齐引擎 `engine.ts:1013-1020`）：
 * 不能存在 `roleCardId`（含已变身辅助机的 `BP04-001`）或 `standaloneEquipmentId`，
 * 且要么为空卡位，要么仅占 `assistCardId` 且有效卡类仍为 `CardType.ASSIST`（不替换已变身为角色的 `PR-041`）。
 */
export function canPlayAssistOnSlot(
  slot: BattlefieldSlot,
  publicCards?: Record<string, CardInstance>
): boolean {
  if (slot.roleCardId || slot.standaloneEquipmentId) return false;
  if (!slot.assistCardId) return true;
  return getSlotOccupancy(slot, publicCards).kind === 'ASSIST';
}

function getEffectiveRoleCardsForPlayer(
  gameState: PublicGameState,
  playerId: string
): Array<{ slotIndex: number; slot: BattlefieldSlot; card: CardInstance }> {
  const slots = gameState.battlefields?.[playerId] || [];
  const publicCards = gameState.publicCards;
  const results: Array<{ slotIndex: number; slot: BattlefieldSlot; card: CardInstance }> = [];
  for (const slot of slots) {
    const occ = getSlotOccupancy(slot, publicCards);
    if (occ.kind === 'ROLE' && occ.card) {
      results.push({ slotIndex: slot.slotIndex, slot, card: occ.card });
    }
  }
  return results;
}

/**
 * 获取己方战场上全部当前有效「角色牌」（兼容 `PR-041` 变身角色，排除变为辅助机期间的 `BP04-001`）
 */
export function getAllFriendlyEffectiveRoleCards(
  gameState: PublicGameState,
  myUserId: string
): Array<{ slotIndex: number; slot: BattlefieldSlot; card: CardInstance }> {
  return getEffectiveRoleCardsForPlayer(gameState, myUserId);
}

export function isNonTacticsInstantCard(cardNumberOrId?: string): boolean {
  if (!cardNumberOrId) return false;
  const def = findCardByNumberOrId(cardNumberOrId);
  if (!def || def.cardType === CardType.TACTICS) return false;
  return Boolean(def.isInstant || def.rulesText?.includes('【瞬时】'));
}

function hasTraitOrName(card: CardInstance, keyword: string): boolean {
  if (getCardExpandedTraits(card).has(keyword)) return true;
  if (card.effectiveTraits?.some((t) => t === keyword || t.includes(keyword))) return true;
  const def = findCardByNumberOrId(card.cardNumber || card.cardId);
  if (!def) return false;
  return Boolean(
    def.traits?.some((t) => t === keyword || t.includes(keyword)) ||
      def.name.includes(keyword)
  );
}

function hasTwoAdjacentEliminatableOrbs(orbs: CardInstance[]): boolean {
  const infos = orbs.map((orb, idx) => resolveOrbDisplayInfo(orb, idx));
  for (let i = 0; i + 1 < infos.length; i++) {
    if (infos[i]!.isEliminatable && infos[i + 1]!.isEliminatable) {
      return true;
    }
  }
  return false;
}

/**
 * 汇总当前优先权瞬时窗下我方可发动的 10.8 非战术【瞬时】卡牌：
 * - BP03-054（明费区）
 * - BP04-004 / BP04-007（我方《露娜·终焉》下方）
 * - BP04-028（手牌）
 */
export function getUsableNonTacticsInstants(
  gameState: PublicGameState,
  myUserId: string
): NonTacticsInstantOption[] {
  const window = gameState.timingWindow;
  if (
    !window ||
    window.priorityPlayerId !== myUserId ||
    gameState.currentPendingChoice ||
    gameState.opponentPendingChoice
  ) {
    return [];
  }

  const player = gameState.players?.[myUserId];
  if (!player) return [];

  const availCost = player.availableOpenCostCount + player.hiddenCostCount;
  const mySlots = gameState.battlefields?.[myUserId] || [];
  const hasEmptySlot = mySlots.some(isBattlefieldSlotEmpty);
  const publicCards = gameState.publicCards || {};
  const allPublicCards = Object.values(publicCards);
  const myRoles = getAllFriendlyEffectiveRoleCards(gameState, myUserId).map((r) => r.card);
  const myOrbs = allPublicCards.filter(
    (c) => c.controllerPlayerId === myUserId && c.zone === 'SIGNAL_ORB'
  );

  const results: NonTacticsInstantOption[] = [];

  // 1. 明费区非战术瞬时（如 BP03-054 《艾拉·万华》）
  if (window.kind === 'FREE_TIMING') {
    const hasArtAssoc = myRoles.some((r) => hasTraitOrName(r, '艺术协会'));
    if (hasArtAssoc) {
      for (const card of allPublicCards) {
        if (
          card.controllerPlayerId === myUserId &&
          card.zone === 'COST' &&
          card.isFaceUp &&
          card.cardNumber === 'BP03-054'
        ) {
          const def = findCardByNumberOrId(card.cardNumber || card.cardId);
          results.push({
            card,
            name: def?.name || card.cardNumber,
            sourceLabel: '明费区',
            costLabel: '回牌组底',
          });
        }
      }
    }
  }

  // 2. 我方《露娜·终焉》下方的非战术瞬时（BP04-004 / BP04-007）
  if (hasEmptySlot) {
    const isOppFreeTiming = window.kind === 'FREE_TIMING' && gameState.activePlayerId !== myUserId;
    for (const host of myRoles) {
      if (!hasCardName(host, '露娜·终焉') || !host.underneathCardIds?.length) continue;
      for (const uid of host.underneathCardIds) {
        const uCard = publicCards[uid];
        if (!uCard) continue;
        if (uCard.cardNumber === 'BP04-004') {
          const cost = isOppFreeTiming ? 3 : 4;
          if (availCost >= cost) {
            const def = findCardByNumberOrId(uCard.cardNumber || uCard.cardId);
            results.push({
              card: uCard,
              name: def?.name || uCard.cardNumber,
              sourceLabel: '露娜下方',
              costLabel: `${cost}费`,
            });
          }
        } else if (uCard.cardNumber === 'BP04-007') {
          if (availCost >= 2) {
            const def = findCardByNumberOrId(uCard.cardNumber || uCard.cardId);
            results.push({
              card: uCard,
              name: def?.name || uCard.cardNumber,
              sourceLabel: '露娜下方',
              costLabel: '2费',
            });
          }
        }
      }
    }
  }

  // 3. 手牌非战术瞬时（如 BP04-028 《渡边·尘铭》）
  for (const card of gameState.myHandCards || []) {
    if (card.cardNumber === 'BP04-028') {
      const used = (player.turnAbilityUsage?.['BP04-028:INSTANT'] ?? 0) > 0;
      const destroyedFires = player.destroyedFireRoleCountThisTurn ?? 0;
      if (!used && destroyedFires >= 3 && hasEmptySlot && hasTwoAdjacentEliminatableOrbs(myOrbs)) {
        const def = findCardByNumberOrId(card.cardNumber || card.cardId);
        results.push({
          card,
          name: def?.name || card.cardNumber,
          sourceLabel: '手牌',
          costLabel: '消2相邻球',
        });
      }
    }
  }

  return results;
}

/**
 * 8.13.3 检查指定我方战场角色当前是否可以发动协战机制
 */
export function canRolePerformAssist(
  gameState: PublicGameState,
  myUserId: string,
  roleCard?: CardInstance
): boolean {
  if (!roleCard || roleCard.controllerPlayerId !== myUserId || roleCard.zone !== 'BATTLEFIELD') {
    return false;
  }
  const window = gameState.timingWindow;
  if (
    gameState.phase !== 'COMBAT_FREE_TIMING' ||
    !window ||
    window.kind !== 'FREE_TIMING' ||
    window.priorityPlayerId !== myUserId ||
    gameState.currentPendingChoice ||
    gameState.opponentPendingChoice
  ) {
    return false;
  }
  const def = findCardByNumberOrId(roleCard.cardNumber || roleCard.cardId);
  if (!def?.rulesText?.includes('【协战搭档】')) return false;

  const player = gameState.players?.[myUserId];
  if ((player?.turnAbilityUsage?.[`${roleCard.instanceId}:ASSIST`] ?? 0) > 0) {
    return false;
  }
  return true;
}

/**
 * 判断该协战角色是否存在信号球代价选项（用于在协战弹窗中提供可选相邻信号球选择）
 */
export function doesAssistSupportOrbCost(roleCard: CardInstance): boolean {
  const def = findCardByNumberOrId(roleCard.cardNumber || roleCard.cardId);
  const text = def?.rulesText || '';
  return text.includes('信号球') && (text.includes('【协战代价】') || text.includes('【协战费用】'));
}

/**
 * 为指定协战宿主筛选手牌 / 战场 / 墓地中的候选协战搭档
 */
export function getAssistPartnerCandidates(
  gameState: PublicGameState,
  myUserId: string,
  hostRoleCard: CardInstance
): AssistPartnerOption[] {
  const hostDef = findCardByNumberOrId(hostRoleCard.cardNumber || hostRoleCard.cardId);
  const rulesText = hostDef?.rulesText || '';
  const partnerLine = rulesText.match(/【协战搭档】[：:\s]*([^\n]+)/)?.[1] || '';
  const costLine = rulesText.match(/【(?:协战代价|协战费用)】[：:\s]*([^\n]+)/)?.[1] || '';

  const allowHand = costLine.includes('手牌');
  const allowField = costLine.includes('战场');
  const allowGraveyard =
    costLine.includes('墓地') ||
    ['BP04-023', 'BP04-024', 'BP04-025'].includes(hostRoleCard.cardNumber);

  const requiredTraits: string[] = [];
  const traitRegex = /<([^>]+)>/g;
  let tm: RegExpExecArray | null;
  while ((tm = traitRegex.exec(partnerLine)) !== null) {
    if (tm[1]) requiredTraits.push(tm[1].trim());
  }

  const requiredNames: string[] = [];
  const nameRegex = /《([^》]+)》/g;
  let nm: RegExpExecArray | null;
  while ((nm = nameRegex.exec(partnerLine)) !== null) {
    if (nm[1]) requiredNames.push(nm[1].trim());
  }

  const costRangeMatch = partnerLine.match(/费用(?:为)?\s*(\d+)\s*(及以下|以下)?/);
  const maxCost = costRangeMatch
    ? costRangeMatch[2] === '以下'
      ? parseInt(costRangeMatch[1]!, 10) - 1
      : parseInt(costRangeMatch[1]!, 10)
    : undefined;

  const matchesPartner = (card: CardInstance): boolean => {
    const def = findCardByNumberOrId(card.cardNumber || card.cardId);
    if (!def || def.cardType !== CardType.ROLE) return false;
    if (maxCost !== undefined && (def.cost ?? 0) > maxCost) return false;
    if (requiredNames.length > 0) {
      if (!requiredNames.some((n) => def.name.includes(n))) return false;
    }
    if (requiredTraits.length > 0) {
      if (!requiredTraits.some((t) => hasTraitOrName(card, t))) return false;
    }
    return true;
  };

  const combat = gameState.currentCombat;
  const inCombatIds = new Set(
    [combat?.attackerCardId, combat?.targetCardId, combat?.blockerCardId].filter(Boolean) as string[]
  );

  const candidates: AssistPartnerOption[] = [];
  const pushIfRole = (card: CardInstance, zoneLabel: string) => {
    const def = findCardByNumberOrId(card.cardNumber || card.cardId);
    if (!def || def.cardType !== CardType.ROLE) return;
    candidates.push({
      card,
      name: def.name,
      cardNumber: card.cardNumber,
      zoneLabel,
      cost: def.cost ?? 0,
      matchesFilter: matchesPartner(card),
    });
  };

  if (allowHand) {
    for (const c of gameState.myHandCards || []) {
      pushIfRole(c, '手牌');
    }
  }
  if (allowField) {
    for (const { slotIndex, card: c } of getAllFriendlyEffectiveRoleCards(gameState, myUserId)) {
      if (c.instanceId === hostRoleCard.instanceId) continue;
      if (inCombatIds.has(c.instanceId)) continue;
      pushIfRole(c, `战场位${slotIndex + 1}`);
    }
  }
  if (allowGraveyard) {
    for (const c of Object.values(gameState.publicCards || {})) {
      if (c.controllerPlayerId === myUserId && c.zone === 'GRAVEYARD') {
        pushIfRole(c, '墓地');
      }
    }
  }

  // 符合搭档条件的排在前面
  candidates.sort((a, b) => Number(b.matchesFilter) - Number(a.matchesFilter));
  return candidates;
}

// ==================== 全区域【起】与装备赋予【起】识别 ====================

/**
 * 仅在非战场区域拥有【起】而在战场无自身【起】的卡号集合（严格对齐 DSL specs `usableZones`）
 */
const NON_BATTLEFIELD_ONLY_ACTIVATE_CARDS = new Set<string>([
  'BP03-002',
  'BP03-045',
  'BP03-046',
  'BP03-047',
  'BP03-050',
  'BP04-050',
  'BP04-051',
  'BP04-052',
  'BP04-053',
  'BP04-054',
  'BP04-061',
  'PR-023',
  'PR-024',
  'PR-025',
  'PR-036',
  'PR-039',
  'PR-047',
]);

/** 手牌【起】精确映射 */
const HAND_ACTIVATE_LABELS: Record<string, { label: string; usageKey?: (card: CardInstance, name: string) => string }> = {
  'BP03-002': { label: '手牌【起】【5费】直接【浮空】' },
  'BP04-052': { label: '手牌【起】丢弃自身：检索《神寂启示录》出场或抽1' },
  'BP04-053': {
    label: '手牌【起】丢弃自身：破坏<神寂启示录>/<=3<遗忘者>，赋予【速攻】',
    usageKey: (_c, name) => `player:${name}:act:hand_sac_rush`,
  },
  'BP04-054': {
    label: '手牌【起】丢弃自身：自伤1使1张角色【充能+1】',
    usageKey: (_c, name) => `player:${name}:act:hand_self_damage_charge`,
  },
  'BP04-071': { label: '手牌【起】【2费】直接【浮空】' },
  'BP04-077': {
    label: '手牌【起】置入<九龙商会>下方：宿主获得【贯通】',
    usageKey: () => 'player:BP04-077:act:tuck',
  },
  'BP04-078': {
    label: '手牌【起】置入<九龙商会>下方：宿主下回合末前 PP+2000',
    usageKey: () => 'player:BP04-078:act:tuck',
  },
  'BP04-079': {
    label: '手牌【起】置入<九龙商会>下方：宿主获得【充能+1】',
    usageKey: () => 'player:BP04-079:act:tuck',
  },
  'PR-023': { label: '手牌【起】丢弃自身：可丢弃<万事>/<神寂启示录>冰冻对方<=3费角色' },
  'PR-024': {
    label: '手牌【起】丢弃自身：公开牌组顶4张，1张入墓其余置底',
    usageKey: (_c, name) => `player:${name}:act:hand_mill_top4`,
  },
  'PR-025': { label: '手牌【起】丢弃自身：可丢弃<21号>/<神寂启示录>使角色 PP+2000' },
  'PR-036': { label: '手牌【起】丢弃自身：可丢弃<莉莉丝>/<神寂启示录>回合末抽2' },
  'PR-047': { label: '手牌【起】丢弃自身：检索《冈格尼尔》或重排信号球区' },
};

/** 墓地【起】精确映射 */
const GRAVEYARD_ACTIVATE_LABELS: Record<string, { label: string; usageKey?: (card: CardInstance, name: string) => string }> = {
  'BP04-050': {
    label: '墓地【起】置底墓地《血契者》/<=6《瘟疫骑士》，该牌回手',
    usageKey: (_c, name) => `player:${name}:act:gy_to_hand`,
  },
  'BP04-051': {
    label: '墓地【起】置底墓地《血契者》/<=5《饥荒骑士》，该牌回手',
    usageKey: (_c, name) => `player:${name}:act:gy_to_hand`,
  },
  'BP04-053': { label: '墓地【起】【4费】置底墓地<神寂启示录>角色，该牌出场' },
  'BP04-054': { label: '墓地【起】【4费】置底墓地<神寂启示录>角色，该牌出场' },
  'PR-023': { label: '墓地【起】【3费】置底墓地<神寂启示录>角色，该牌出场' },
  'PR-036': { label: '墓地【起】【3费】置底墓地<神寂启示录>角色，该牌出场' },
  'PR-039': {
    label: '墓地【起】置底墓地3张<神寂启示录>并送墓战场2张，该牌出场',
    usageKey: (_c, name) => `player:${name}:act:gy_revive_gabriel`,
  },
};

/** 明费区【起】精确映射（须 `isFaceUp === true`） */
const COST_ACTIVATE_LABELS: Record<string, string> = {
  'BP03-045': '明费【起】【5费】《艾拉·万华》>=7张时换人出场',
  'BP03-046': '明费【起】【5费】《艾拉·万华》>=7张时换人出场',
  'BP03-047': '明费【起】回牌组底并消2任意球，对方<=3费角色横置入费',
  'BP03-050': '明费【起】回牌组底，己方《艾拉·万华》PP+2000(可消2球获【速攻】)',
};

/** 信号球区【起】精确映射（须 `isFaceUp === true`） */
const SIGNAL_ORB_ACTIVATE_LABELS: Record<string, { label: string; usageKey?: (card: CardInstance, name: string) => string }> = {
  'BP04-061': {
    label: '信号球【起】【蓝色信号球】将该牌加入手牌',
    usageKey: (_c, name) => `player:${name}:act:self`,
  },
};

/** 角色下方【起】精确映射 */
const UNDERNEATH_ACTIVATE_LABELS: Record<string, string> = {
  'BP04-077': '下方【起】【红球+2费】从<九龙商会>下方出场',
  'BP04-078': '下方【起】【黄球+1费】从<九龙商会>下方出场',
  'BP04-079': '下方【起】【蓝球】从<九龙商会>下方出场',
};

/** 兼具非战场与战场【起】的卡牌在战场的精确条目（`abilityIndex: 0`） */
const BATTLEFIELD_ACTIVATE_OVERRIDES: Record<string, { label: string; usageKey: (card: CardInstance) => string }> = {
  'BP04-071': {
    label: '【起】【回合1】送墓其他《丽芙·极昼》，获【速攻】PP+2000',
    usageKey: (c) => `${c.instanceId}:sac_liv_rush`,
  },
  'BP04-077': {
    label: '【起】置入<九龙商会>下方：宿主获得【贯通】',
    usageKey: () => 'player:BP04-077:act:tuck',
  },
  'BP04-078': {
    label: '【起】置入<九龙商会>下方：宿主下回合末前 PP+2000',
    usageKey: () => 'player:BP04-078:act:tuck',
  },
  'BP04-079': {
    label: '【起】置入<九龙商会>下方：宿主获得【充能+1】',
    usageKey: () => 'player:BP04-079:act:tuck',
  },
};

const OWN_ACTIVATE_LINE_RE = /^(?:[晖暮](?:（[^）]+）)?|·\s*\d+张及以上\s*)?(?:【起】|起动)/;

function extractConciseActivateLabel(cardNumber: string, rulesText: string): string {
  if (cardNumber === 'BP01-040') {
    return '【起】墓地《帕瓦》置下方 / 【游戏1】消2黄球伤1';
  }
  const line = rulesText
    .split('\n')
    .map((l) => l.trim())
    .find((l) => OWN_ACTIVATE_LINE_RE.test(l));
  if (!line) return '【起】发动起动能力';
  const cleaned = line.replace(/\s+/g, ' ').trim();
  return cleaned.length > 36 ? `${cleaned.slice(0, 35)}…` : cleaned;
}

function findFriendlyUnderneathHost(
  gameState: PublicGameState,
  myUserId: string,
  cardId: string
): CardInstance | undefined {
  const publicCards = gameState.publicCards || {};
  for (const slot of gameState.battlefields?.[myUserId] || []) {
    for (const hostId of [slot.roleCardId, slot.assistCardId]) {
      if (!hostId) continue;
      const host = publicCards[hostId];
      if (host?.underneathCardIds?.includes(cardId)) {
        return host;
      }
    }
  }
  return undefined;
}

function isAttachedEquipmentOnFriendlyField(
  gameState: PublicGameState,
  myUserId: string,
  cardId: string
): boolean {
  const publicCards = gameState.publicCards || {};
  for (const slot of gameState.battlefields?.[myUserId] || []) {
    for (const hostId of [slot.roleCardId, slot.assistCardId]) {
      if (!hostId) continue;
      const host = publicCards[hostId];
      if (!host) continue;
      if (
        host.attachedEquipmentId === cardId ||
        host.extraAttachedEquipmentIds?.includes(cardId)
      ) {
        return true;
      }
    }
  }
  return false;
}

/**
 * 获取指定卡牌在当前（或指定）区域下可用的【起】动能力列表（严格对齐引擎 `interpreter.ts` 的 `abilityIndex` 与限制）
 */
export function getCardActivatedAbilityOptions(
  gameState: PublicGameState,
  myUserId: string,
  card: CardInstance,
  zoneOverride?: ActivatedAbilityZone,
  hostCard?: CardInstance,
  options?: { ignoreTiming?: boolean }
): ActivatedAbilityOption[] {
  if (!card || card.controllerPlayerId !== myUserId) return [];
  if (!options?.ignoreTiming && !getTimingStatus(gameState, myUserId).canActMainPhase) {
    return [];
  }

  const player = gameState.players?.[myUserId];
  const publicCards = gameState.publicCards || {};
  const mySlots = gameState.battlefields?.[myUserId] || [];
  const isTopLevel = mySlots.some(
    (s) =>
      s.roleCardId === card.instanceId ||
      s.assistCardId === card.instanceId ||
      s.standaloneEquipmentId === card.instanceId
  );
  const resolvedHost = hostCard ?? findFriendlyUnderneathHost(gameState, myUserId, card.instanceId);

  let zone: ActivatedAbilityZone | undefined = zoneOverride;
  if (!zone) {
    if (isTopLevel) {
      zone = 'BATTLEFIELD';
    } else if (resolvedHost && resolvedHost.underneathCardIds?.includes(card.instanceId)) {
      zone = 'UNDERNEATH';
    } else if (card.zone === 'HAND' || card.zone === 'GRAVEYARD' || card.zone === 'COST' || card.zone === 'SIGNAL_ORB') {
      zone = card.zone;
    } else if (
      card.zone === 'BATTLEFIELD' &&
      !isAttachedEquipmentOnFriendlyField(gameState, myUserId, card.instanceId)
    ) {
      zone = 'BATTLEFIELD';
    }
  }

  if (!zone) return [];

  const def = findCardByNumberOrId(card.cardNumber || card.cardId);
  const cardName = def?.name ?? card.cardNumber;
  const turnUsage = player?.turnAbilityUsage ?? {};
  const isUsageExhausted = (key: string | undefined): boolean => Boolean(key && (turnUsage[key] ?? 0) > 0);

  if (zone === 'HAND') {
    const entry = HAND_ACTIVATE_LABELS[card.cardNumber];
    if (!entry) return [];
    const used = isUsageExhausted(entry.usageKey?.(card, cardName));
    return [
      {
        sourceCardId: card.instanceId,
        abilityIndex: 0,
        label: entry.label,
        zone: 'HAND',
        ...(used ? { disabled: true, reason: '该能力本回合已发动过' } : {}),
      },
    ];
  }

  if (zone === 'GRAVEYARD') {
    const entry = GRAVEYARD_ACTIVATE_LABELS[card.cardNumber];
    if (!entry) return [];
    const used = isUsageExhausted(entry.usageKey?.(card, cardName));
    return [
      {
        sourceCardId: card.instanceId,
        abilityIndex: 0,
        label: entry.label,
        zone: 'GRAVEYARD',
        ...(used ? { disabled: true, reason: '该能力本回合已发动过' } : {}),
      },
    ];
  }

  if (zone === 'COST') {
    if (!card.isFaceUp) return [];
    const label = COST_ACTIVATE_LABELS[card.cardNumber];
    if (!label) return [];
    return [
      {
        sourceCardId: card.instanceId,
        abilityIndex: 0,
        label,
        zone: 'COST',
      },
    ];
  }

  if (zone === 'SIGNAL_ORB') {
    if (!card.isFaceUp) return [];
    const entry = SIGNAL_ORB_ACTIVATE_LABELS[card.cardNumber];
    if (!entry) return [];
    const used = isUsageExhausted(entry.usageKey?.(card, cardName));
    return [
      {
        sourceCardId: card.instanceId,
        abilityIndex: 0,
        label: entry.label,
        zone: 'SIGNAL_ORB',
        ...(used ? { disabled: true, reason: '该能力本回合已发动过' } : {}),
      },
    ];
  }

  if (zone === 'UNDERNEATH') {
    const label = UNDERNEATH_ACTIVATE_LABELS[card.cardNumber];
    if (!label) return [];
    if (resolvedHost && resolvedHost.controllerPlayerId !== myUserId) return [];
    const hostNotJiulong = resolvedHost ? !getCardExpandedTraits(resolvedHost).has('九龙商会') : false;
    const noEmptySlot = !mySlots.some(isBattlefieldSlotEmpty);
    const reason = hostNotJiulong
      ? '需要位于<九龙商会>角色下方'
      : noEmptySlot
      ? '战场没有空余卡位'
      : undefined;
    return [
      {
        sourceCardId: card.instanceId,
        abilityIndex: 0,
        label,
        zone: 'UNDERNEATH',
        ...(resolvedHost ? { hostCardId: resolvedHost.instanceId } : {}),
        ...(reason ? { disabled: true, reason } : {}),
      },
    ];
  }

  // ---------- BATTLEFIELD 区域 ----------
  // 8.3.4 失能判定：与引擎 engine.ts:1619 一致，顶层牌存在未过期 loseAbilities 时拦截整个 ACTIVATE_ABILITY
  if (hasLostInherentAbilities(card, gameState.turnNumber)) {
    return [];
  }

  const results: ActivatedAbilityOption[] = [];

  if (card.cardNumber === 'BP02-025') {
    const radUsed = isUsageExhausted(`${card.instanceId}:radiance_bottom_orb_to_hand`);
    const duskUsed = isUsageExhausted(`${card.instanceId}:dusk_place_bianca_orb_bottom`);
    const tappedReason = !card.isReady ? '该牌已横置' : undefined;
    results.push(
      {
        sourceCardId: card.instanceId,
        abilityIndex: 0,
        label: '晖【起】信号球最下方回手',
        zone: 'BATTLEFIELD',
        ...(tappedReason || radUsed
          ? { disabled: true, reason: tappedReason ?? '该能力本回合已发动过' }
          : {}),
      },
      {
        sourceCardId: card.instanceId,
        abilityIndex: 1,
        label: '暮【起】手牌《比安卡·晖暮》置球底并抽1',
        zone: 'BATTLEFIELD',
        ...(tappedReason || duskUsed
          ? { disabled: true, reason: tappedReason ?? '该能力本回合已发动过' }
          : {}),
      }
    );
  } else if (BATTLEFIELD_ACTIVATE_OVERRIDES[card.cardNumber]) {
    const ov = BATTLEFIELD_ACTIVATE_OVERRIDES[card.cardNumber]!;
    const used = isUsageExhausted(ov.usageKey(card));
    results.push({
      sourceCardId: card.instanceId,
      abilityIndex: 0,
      label: ov.label,
      zone: 'BATTLEFIELD',
      ...(used ? { disabled: true, reason: '该能力本回合已发动过' } : {}),
    });
  } else if (
    !NON_BATTLEFIELD_ONLY_ACTIVATE_CARDS.has(card.cardNumber) &&
    card.cardNumber !== 'BP01-022' &&
    def?.rulesText &&
    def.rulesText
      .split('\n')
      .some((line) => OWN_ACTIVATE_LINE_RE.test(line.trim()))
  ) {
    const isOnce = def.rulesText
      .split('\n')
      .some((line) => OWN_ACTIVATE_LINE_RE.test(line.trim()) && line.includes('【回合1】'));
    const used = isOnce && isUsageExhausted(card.instanceId);
    results.push({
      sourceCardId: card.instanceId,
      abilityIndex: 0,
      label: extractConciseActivateLabel(card.cardNumber, def.rulesText),
      zone: 'BATTLEFIELD',
      ...(used ? { disabled: true, reason: '该能力本回合已发动过' } : {}),
    });
  }

  // 装备赋予【起】：依次扫描宿主附加的装备，追加到自身战场【起】之后
  const attachedEquipIds = Array.from(
    new Set(
      [card.attachedEquipmentId, ...(card.extraAttachedEquipmentIds ?? [])].filter(
        (id): id is string => Boolean(id)
      )
    )
  );
  if (
    attachedEquipIds.length > 0 &&
    !hasCardProhibition(card, 'CANNOT_GAIN_ABILITIES') &&
    hasCardName(card, '露西亚·深红囚影')
  ) {
    const hostOwnCount = results.length;
    let grantedIdx = 0;
    for (const eqId of attachedEquipIds) {
      const eq = publicCards[eqId];
      if (!eq) continue;
      if (hasLostInherentAbilities(eq, gameState.turnNumber)) continue;
      if (eq.cardNumber === 'BP01-022') {
        const used = isUsageExhausted(`${card.instanceId}:equipAct:${eq.instanceId}`);
        results.push({
          sourceCardId: card.instanceId,
          abilityIndex: hostOwnCount + grantedIdx,
          label: '【夜煌—小太刀】选择1张信号球视为【蓝色信号球】',
          zone: 'BATTLEFIELD',
          grantedByEquipmentId: eq.instanceId,
          ...(used ? { disabled: true, reason: '该装备赋予能力本回合已发动过' } : {}),
        });
        grantedIdx++;
      }
    }
  }

  return results;
}

/**
 * 扫描己方全部区域（手牌、战场顶层、角色/辅助机下方、墓地、明费、正面信号球），
 * 返回 `instanceId -> ActivatedAbilityOption[]` 映射。
 */
export function getZoneActivatedAbilityCardMap(
  gameState: PublicGameState,
  myUserId: string,
  options?: { ignoreTiming?: boolean }
): Record<string, ActivatedAbilityOption[]> {
  const result: Record<string, ActivatedAbilityOption[]> = {};
  if (!options?.ignoreTiming && !getTimingStatus(gameState, myUserId).canActMainPhase) {
    return result;
  }

  const register = (
    card: CardInstance | undefined,
    zoneOverride: ActivatedAbilityZone,
    hostCard?: CardInstance
  ) => {
    if (!card || result[card.instanceId]) return;
    const opts = getCardActivatedAbilityOptions(
      gameState,
      myUserId,
      card,
      zoneOverride,
      hostCard,
      options
    );
    if (opts.length > 0) {
      result[card.instanceId] = opts;
    }
  };

  // 1. 手牌
  for (const card of gameState.myHandCards || []) {
    register(card, 'HAND');
  }

  // 2. 战场顶层卡 & 下方卡
  const publicCards = gameState.publicCards || {};
  for (const slot of gameState.battlefields?.[myUserId] || []) {
    for (const topId of [slot.roleCardId, slot.standaloneEquipmentId, slot.assistCardId]) {
      if (topId && publicCards[topId]) {
        register(publicCards[topId], 'BATTLEFIELD');
      }
    }
    for (const hostId of [slot.roleCardId, slot.assistCardId]) {
      if (!hostId) continue;
      const host = publicCards[hostId];
      if (!host?.underneathCardIds?.length) continue;
      for (const uid of host.underneathCardIds) {
        if (publicCards[uid]) {
          register(publicCards[uid], 'UNDERNEATH', host);
        }
      }
    }
  }

  // 3. 墓地 / 明费区 / 正面信号球区
  for (const card of Object.values(publicCards)) {
    if (card.controllerPlayerId !== myUserId) continue;
    if (card.zone === 'GRAVEYARD') {
      register(card, 'GRAVEYARD');
    } else if (card.zone === 'COST' && card.isFaceUp) {
      register(card, 'COST');
    } else if (card.zone === 'SIGNAL_ORB' && card.isFaceUp) {
      register(card, 'SIGNAL_ORB');
    }
  }

  return result;
}

// ==================== 非手牌区出牌辅助 ====================

/**
 * 判断非手牌区域的卡牌（墓地 `BP02-026` / `BP02-036`、角色下方 `BP04-011`）在当前时机下是否可执行非手牌使用
 */
export function getNonHandPlayAction(
  gameState: PublicGameState,
  myUserId: string,
  card: CardInstance,
  hostCard?: CardInstance
): NonHandPlayAction | null {
  if (!card || card.controllerPlayerId !== myUserId) return null;
  const timing = getTimingStatus(gameState, myUserId);

  if (card.zone === 'GRAVEYARD') {
    if (card.cardNumber === 'BP02-026' && timing.canActMainPhase) {
      return { kind: 'ASCEND_FROM_GRAVEYARD', label: '墓地升变' };
    }
    if (card.cardNumber === 'BP02-036' && (timing.canActMainPhase || timing.hasInstantPriority)) {
      return { kind: 'PLAY_TACTICS_FROM_GRAVEYARD', label: '墓地使用战术' };
    }
    return null;
  }

  if (card.cardNumber === 'BP04-011') {
    const isAttackedFreeTiming =
      timing.hasInstantPriority &&
      gameState.timingWindow?.kind === 'FREE_TIMING' &&
      gameState.currentCombat?.targetType === 'PLAYER' &&
      gameState.activePlayerId !== myUserId;
    if (!isAttackedFreeTiming) return null;

    const myRoles = getAllFriendlyEffectiveRoleCards(gameState, myUserId).map((r) => r.card);
    const matchingHost = hostCard
      ? myRoles.find(
          (r) =>
            r.instanceId === hostCard.instanceId &&
            hasCardName(r, '露娜·终焉') &&
            r.underneathCardIds?.includes(card.instanceId)
        )
      : myRoles.find(
          (r) =>
            hasCardName(r, '露娜·终焉') && r.underneathCardIds?.includes(card.instanceId)
        );
    if (!matchingHost) return null;
    return { kind: 'PLAY_TACTICS_FROM_UNDERNEATH', label: '使用《升空凌视》' };
  }

  return null;
}

// ==================== 统一权威升变计划 (8.11) ====================

function checkAscensionRestrictionFrontend(
  gameState: PublicGameState,
  myUserId: string,
  cardNumber: string,
  condition: AscensionRestriction
): string | undefined {
  const player = gameState.players?.[myUserId];
  const allPublicCards = Object.values(gameState.publicCards || {});
  const costCards = allPublicCards.filter(
    (c) => c.controllerPlayerId === myUserId && c.zone === 'COST'
  );
  const totalCostCount = costCards.length > 0 ? costCards.length : player?.totalCostCount ?? 0;

  switch (condition.kind) {
    case 'MIN_COST_LIMIT': {
      if (totalCostCount >= condition.value) return undefined;
      if (cardNumber === 'BP01-001') {
        const grayRavensInGy = allPublicCards.filter(
          (c) =>
            c.controllerPlayerId === myUserId &&
            c.zone === 'GRAVEYARD' &&
            getCardExpandedTraits(c).has('灰鸦小队')
        );
        if (grayRavensInGy.length >= 10) return undefined;
      }
      return `升变限制条件：费用上限需达到 ${condition.value} (当前 ${totalCostCount})`;
    }
    case 'MIN_OPEN_COST_LIMIT': {
      const openCount =
        costCards.length > 0
          ? costCards.filter((c) => c.isFaceUp).length
          : player?.openCostCount ?? 0;
      return openCount >= condition.value
        ? undefined
        : `升变限制条件：明费上限需达到 ${condition.value} (当前 ${openCount})`;
    }
    case 'MIN_ORB_ZONE_CARDS': {
      const myOrbs = allPublicCards.filter(
        (c) => c.controllerPlayerId === myUserId && c.zone === 'SIGNAL_ORB'
      );
      const matched = condition.cardName
        ? myOrbs.filter((c) => c.isFaceUp && hasCardName(c, condition.cardName!))
        : myOrbs;
      return matched.length >= condition.value
        ? undefined
        : `升变限制条件：信号球区的${
            condition.cardName ? `《${condition.cardName}》` : '牌'
          }需达到 ${condition.value} 张 (当前 ${matched.length})`;
    }
    case 'MAX_FIELD_ROLES': {
      const roleCount = getAllFriendlyEffectiveRoleCards(gameState, myUserId).length;
      return roleCount <= condition.value
        ? undefined
        : `升变限制条件：我方战场的角色需为 ${condition.value} 张及以下 (当前 ${roleCount})`;
    }
    case 'COST_ZONE_ROLES_ATTRIBUTE': {
      const allMatch = costCards
        .filter((c) => c.isFaceUp)
        .every((c) => {
          const def = findCardByNumberOrId(c.cardNumber || c.cardId);
          return def?.cardType !== CardType.ROLE || def.attribute === condition.attribute;
        });
      return allMatch ? undefined : '升变限制条件：费用区所有角色牌的属性不满足要求';
    }
  }
}

/**
 * 计算指定卡牌在当前对局状态下的完整升变计划（兼容单/多对象、信号球区正面对象、浮空对象、`BP01-040` 叠置代价与 `BP02-067` 横置税）
 */
export function getAscensionPlan(
  gameState: PublicGameState,
  myUserId: string,
  card: CardInstance
): AscensionPlan | null {
  const def = findCardByNumberOrId(card.cardNumber || card.cardId);
  if (!def?.rulesText) return null;
  const config = parseAscensionConfig(def.rulesText);
  if (!config) return null;

  const allowedSourceZones = config.sourceZones ?? ['HAND'];
  const sourceZoneValid =
    card.controllerPlayerId === myUserId &&
    allowedSourceZones.includes(card.zone as 'HAND' | 'GRAVEYARD');

  const mySlots = gameState.battlefields?.[myUserId] || [];
  const emptySlotIndices = mySlots.filter(isBattlefieldSlotEmpty).map((s) => s.slotIndex);

  const tf = config.targetFilter;
  const targetZones = tf.targetZones ?? ['BATTLEFIELD'];
  const allPublicCards = Object.values(gameState.publicCards || {});

  const matchesTargetFilter = (candidate: CardInstance): { ok: boolean; name: string; cost: number } => {
    const cDef = findCardByNumberOrId(candidate.cardNumber || candidate.cardId);
    const name = cDef?.name ?? candidate.cardNumber;
    const cost = cDef?.cost ?? 0;
    if (!cDef) return { ok: false, name, cost };
    if (tf.exactName && !hasCardName(candidate, tf.exactName)) {
      return { ok: false, name, cost };
    }
    if (tf.traits && tf.traits.length > 0) {
      const expanded = getCardExpandedTraits(candidate);
      if (!tf.traits.every((t) => expanded.has(t))) {
        return { ok: false, name, cost };
      }
    }
    if (!tf.exactName && !tf.traits?.length && tf.nameIncludes) {
      if (!name.includes(tf.nameIncludes)) {
        return { ok: false, name, cost };
      }
    }
    if (tf.exactCost !== undefined && cost !== tf.exactCost) {
      return { ok: false, name, cost };
    }
    if (tf.maxCost !== undefined && cost > tf.maxCost) {
      return { ok: false, name, cost };
    }
    if (tf.requireReady && !candidate.isReady) {
      return { ok: false, name, cost };
    }
    return { ok: true, name, cost };
  };

  const targets: AscensionTargetCandidate[] = [];
  if (targetZones.includes('BATTLEFIELD')) {
    for (const { slotIndex, card: roleCard } of getAllFriendlyEffectiveRoleCards(gameState, myUserId)) {
      const m = matchesTargetFilter(roleCard);
      if (m.ok) {
        targets.push({
          card: roleCard,
          zone: 'BATTLEFIELD',
          slotIndex,
          requiresEmptySlot: false,
          name: m.name,
          cost: m.cost,
        });
      }
    }
  }
  if (targetZones.includes('SIGNAL_ORB')) {
    for (const orbCard of allPublicCards) {
      if (
        orbCard.controllerPlayerId === myUserId &&
        orbCard.zone === 'SIGNAL_ORB' &&
        orbCard.isFaceUp === true
      ) {
        const m = matchesTargetFilter(orbCard);
        if (m.ok) {
          targets.push({
            card: orbCard,
            zone: 'SIGNAL_ORB',
            requiresEmptySlot: true,
            name: m.name,
            cost: m.cost,
          });
        }
      }
    }
  }
  if (targetZones.includes('AIRBORNE')) {
    for (const procCard of allPublicCards) {
      if (
        procCard.controllerPlayerId === myUserId &&
        procCard.zone === 'PROCESSING' &&
        procCard.isAirborne === true
      ) {
        const m = matchesTargetFilter(procCard);
        if (m.ok) {
          targets.push({
            card: procCard,
            zone: 'AIRBORNE',
            requiresEmptySlot: true,
            name: m.name,
            cost: m.cost,
          });
        }
      }
    }
  }

  const minCount = tf.minCount ?? 1;
  const allowMultiple = Boolean(tf.allowMultiple);

  const extraCostCandidates: Array<{ card: CardInstance; slotIndex: number; name: string }> = [];
  if (config.extraCost?.kind === 'STACK_FIELD_ROLE_UNDERNEATH') {
    const reqName = config.extraCost.exactName;
    for (const { slotIndex, card: roleCard } of getAllFriendlyEffectiveRoleCards(gameState, myUserId)) {
      if (hasCardName(roleCard, reqName)) {
        const rDef = findCardByNumberOrId(roleCard.cardNumber || roleCard.cardId);
        extraCostCandidates.push({
          card: roleCard,
          slotIndex,
          name: rDef?.name ?? reqName,
        });
      }
    }
  }

  // 对方战场有效/顶层横置 BP02-067 数量（横置对象升变额外+1费）
  const opponentId = getOpponentPlayerId(gameState, myUserId);
  let tappedOpponentTaxCount = 0;
  if (opponentId) {
    const publicCards = gameState.publicCards || {};
    for (const slot of gameState.battlefields?.[opponentId] || []) {
      const occ = getSlotOccupancy(slot, publicCards);
      const topCard = occ.card;
      if (
        topCard &&
        normalizeCoreCardNumber(topCard.cardNumber) === 'BP02-067' &&
        !topCard.isReady &&
        !hasLostInherentAbilities(topCard, gameState.turnNumber)
      ) {
        tappedOpponentTaxCount++;
      }
    }
  }

  let restrictionError: string | undefined;
  for (const cond of config.restrictionFilter?.conditions ?? []) {
    const err = checkAscensionRestrictionFrontend(gameState, myUserId, card.cardNumber, cond);
    if (err) {
      restrictionError = err;
      break;
    }
  }

  const usableTargets = targets.filter((t) => !t.requiresEmptySlot || emptySlotIndices.length > 0);
  const hasUsableTargets =
    usableTargets.length >= minCount &&
    (targets.some((t) => !t.requiresEmptySlot) || emptySlotIndices.length > 0);

  const hasValidExtraCost =
    config.extraCost?.kind !== 'STACK_FIELD_ROLE_UNDERNEATH' ||
    (extraCostCandidates.length > 0 &&
      usableTargets.some((t) =>
        extraCostCandidates.some((e) => e.card.instanceId !== t.card.instanceId)
      ));

  const allUsableTargetsTapped =
    usableTargets.length > 0 && usableTargets.every((t) => !t.card.isReady);
  const costInfo = getCardEffectiveCostInfo(gameState, myUserId, card, {
    isAscension: true,
    targetAscensionCards: allUsableTargetsTapped ? usableTargets.map((t) => t.card) : undefined,
  });
  const player = gameState.players?.[myUserId];
  const availCost = (player?.availableOpenCostCount ?? 0) + (player?.hiddenCostCount ?? 0);

  let reason: string | undefined;
  if (config.unsupportedReason) {
    reason = config.unsupportedReason;
  } else if (!sourceZoneValid) {
    reason = '当前区域不能发动该牌的升变';
  } else if (restrictionError) {
    reason = restrictionError;
  } else if (targets.length < minCount) {
    reason = '没有满足升变条件的对象';
  } else if (!hasUsableTargets) {
    reason = '战场没有空余卡位供升变对象出场';
  } else if (!hasValidExtraCost) {
    reason = `升变代价不足：我方战场不存在可放置到下方的《${config.extraCost?.exactName ?? ''}》`;
  } else if (
    card.zone === 'HAND' &&
    !hasMatchingAttributeForPlay(gameState, myUserId, card, true)
  ) {
    reason = `费用区没有与【${def.attribute}】属性匹配的明费 (8.6.2.a.1)`;
  } else if (costInfo.minPayableCost > availCost) {
    reason = `费用不足：升变需要 ${costInfo.minPayableCost} 费 (当前可用 ${availCost})`;
  }

  return {
    card,
    config,
    sourceZoneValid,
    targets,
    minCount,
    allowMultiple,
    extraCostCandidates,
    emptySlotIndices,
    tappedOpponentTaxCount,
    ascensionCost: costInfo.effectiveCost,
    minPayableCost: costInfo.minPayableCost,
    restrictionError,
    canAscend: !reason,
    ...(reason ? { reason } : {}),
  };
}

// ==================== 全量费用与减费计算 (8.6.2.c) ====================

export interface EffectiveCostInfo {
  baseCost: number;
  effectiveCost: number;
  minPayableCost: number;
  hasOptionalDiscount: boolean;
  optionalDiscountLabel?: string;
}

/**
 * 计算卡牌当前实时费用（用于信号球区 `ST05-009`/`BP02-022` 奇偶判定含 `BP02-024` +1，及战场 `canAttackReadyRolesMaxCost` 含搭档费用与 `BP02-060` -1）
 */
function getRealtimeCardCost(gameState: PublicGameState, card: CardInstance): number {
  const def = findCardByNumberOrId(card.cardNumber || card.cardId);
  let cost = def?.cost ?? 0;
  if (card.zone === 'BATTLEFIELD' && card.partnerCardId) {
    const partner = gameState.publicCards?.[card.partnerCardId];
    if (partner) {
      const pDef = findCardByNumberOrId(partner.cardNumber || partner.cardId);
      cost += pDef?.cost ?? 0;
    }
  }

  let costDeltaTotal = 0;
  let setCostOverride: number | undefined;
  const mods = [...(card.modifiers ?? [])].sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
  for (const m of mods) {
    if (!isModifierActive(m.untilTurn, gameState.turnNumber)) continue;
    if (m.costDelta !== undefined) costDeltaTotal += m.costDelta;
    if (m.setCost !== undefined) setCostOverride = m.setCost;
  }

  const core = normalizeCoreCardNumber(card.cardNumber);
  if (
    card.zone === 'SIGNAL_ORB' &&
    card.isFaceUp &&
    core === 'BP02-024' &&
    !hasLostInherentAbilities(card, gameState.turnNumber)
  ) {
    costDeltaTotal += 1;
  }
  if (
    card.zone === 'BATTLEFIELD' &&
    core === 'BP02-060' &&
    !hasLostInherentAbilities(card, gameState.turnNumber)
  ) {
    const ownerId = card.controllerPlayerId;
    const oppId = getOpponentPlayerId(gameState, ownerId);
    const selfOpen = gameState.players?.[ownerId]?.openCostCount ?? 0;
    const oppOpen = oppId ? (gameState.players?.[oppId]?.openCostCount ?? 0) : 0;
    if (selfOpen <= oppOpen) {
      costDeltaTotal -= 1;
    }
  }

  if (setCostOverride !== undefined) {
    return Math.max(0, setCostOverride);
  }
  return Math.max(0, cost + costDeltaTotal);
}

/**
 * 10.14 检查我方信号球区最下方正面卡牌的实时费用奇偶性（晖=奇数 / 暮=偶数）
 */
function isSignalOrbBottomCostParity(
  gameState: PublicGameState,
  myUserId: string,
  parity: 'ODD' | 'EVEN'
): boolean {
  const myOrbs = Object.values(gameState.publicCards || {}).filter(
    (c) => c.controllerPlayerId === myUserId && c.zone === 'SIGNAL_ORB'
  );
  const bottom = myOrbs[0];
  if (!bottom || !bottom.isFaceUp) return false;
  const cost = getRealtimeCardCost(gameState, bottom);
  return parity === 'ODD' ? cost % 2 === 1 : cost % 2 === 0;
}

/**
 * 收集己方战场上可用于 `playSacrificeDiscount` 的候选卡牌（顶层角色/辅助机/独立装备 + 附着装备 + 可选协战搭档）
 */
function collectFriendlyBattlefieldSacrificeCards(
  gameState: PublicGameState,
  myUserId: string,
  excludeCardId: string,
  includePartners: boolean
): CardInstance[] {
  const results: CardInstance[] = [];
  const seen = new Set<string>([excludeCardId]);
  const publicCards = gameState.publicCards || {};
  const push = (c: CardInstance | undefined) => {
    if (!c || seen.has(c.instanceId)) return;
    seen.add(c.instanceId);
    results.push(c);
  };
  for (const slot of gameState.battlefields?.[myUserId] || []) {
    for (const id of [slot.roleCardId, slot.assistCardId, slot.standaloneEquipmentId]) {
      if (id) push(publicCards[id]);
    }
    if (slot.roleCardId && publicCards[slot.roleCardId]) {
      const roleCard = publicCards[slot.roleCardId]!;
      for (const eqId of [
        roleCard.attachedEquipmentId,
        ...(roleCard.extraAttachedEquipmentIds ?? []),
      ]) {
        if (eqId) push(publicCards[eqId]);
      }
      if (includePartners && roleCard.partnerCardId) {
        push(publicCards[roleCard.partnerCardId]);
      }
    }
  }
  return results;
}

/**
 * 8.6.2.c 全量计算使用/升变手牌时的费用明细（严格对齐 `engine.ts:672-882` 与 `interpreter.ts:271-337`）
 */
export function getCardEffectiveCostInfo(
  gameState: PublicGameState,
  myUserId: string,
  card: CardInstance,
  options?: { isAscension?: boolean; targetAscensionCards?: CardInstance[] }
): EffectiveCostInfo {
  const def = findCardByNumberOrId(card.cardNumber || card.cardId);
  if (!def) {
    return {
      baseCost: 0,
      effectiveCost: 0,
      minPayableCost: 0,
      hasOptionalDiscount: false,
    };
  }

  const player = gameState.players?.[myUserId];
  const oppId = getOpponentPlayerId(gameState, myUserId);
  const oppPlayer = oppId ? gameState.players?.[oppId] : undefined;
  const publicCards = gameState.publicCards || {};
  const allPublicCards = Object.values(publicCards);

  const ascConfig = def.rulesText ? parseAscensionConfig(def.rulesText) : undefined;
  const isAscensionPlay = Boolean(options?.isAscension && ascConfig);

  // 1. 基础费用与升变横置《万事·明晰梦》增费
  let baseCost = isAscensionPlay ? ascConfig!.ascensionCost : (def.cost ?? 0);
  if (
    isAscensionPlay &&
    options?.targetAscensionCards?.some((targetAsc) => !targetAsc.isReady) &&
    oppId
  ) {
    let tappedWanshiCount = 0;
    for (const slot of gameState.battlefields?.[oppId] || []) {
      const r = slot.roleCardId ? publicCards[slot.roleCardId] : undefined;
      if (
        r &&
        normalizeCoreCardNumber(r.cardNumber) === 'BP02-067' &&
        !r.isReady &&
        !hasLostInherentAbilities(r, gameState.turnNumber)
      ) {
        tappedWanshiCount++;
      }
    }
    baseCost += tappedWanshiCount;
  }

  let discount = 0;
  const cardTraits = getCardExpandedTraits(card);
  const normCardName = normalizeCardName(def.name);

  // 2. 玩家动态费用修改器 (player.costModifiers)
  if (player?.costModifiers && player.costModifiers.length > 0) {
    for (const mod of player.costModifiers) {
      if (mod.remainingCount !== undefined && mod.remainingCount <= 0) continue;
      if (mod.excludeAscension && isAscensionPlay) continue;
      if (mod.cardType && mod.cardType !== def.cardType) continue;
      if (mod.targetTrait) {
        const matchTrait =
          cardTraits.has(mod.targetTrait) ||
          def.traits?.some((t) => t.includes(mod.targetTrait!));
        const matchName = normCardName.includes(normalizeCardName(mod.targetTrait));
        if (!matchTrait && !matchName) continue;
      }
      if (mod.targetName && !normCardName.includes(normalizeCardName(mod.targetName))) continue;
      discount += mod.amount;
    }
  }

  // 3. 18 张卡牌自身静态减费 (handCostDiscount)
  const core = normalizeCoreCardNumber(card.cardNumber);
  const myRoles = getEffectiveRoleCardsForPlayer(gameState, myUserId).map((r) => r.card);
  const oppRoles = oppId
    ? getEffectiveRoleCardsForPlayer(gameState, oppId).map((r) => r.card)
    : [];

  switch (core) {
    case 'ST03-011': {
      discount += myRoles.filter((r) => hasCardTrait(r, '三头犬小队')).length;
      break;
    }
    case 'ST05-009': {
      if (isSignalOrbBottomCostParity(gameState, myUserId, 'ODD')) {
        discount += 3;
      }
      break;
    }
    case 'ST06-004': {
      discount +=
        myRoles.filter((r) => hasCardTrait(r, '亚里莎') && Boolean(r.partnerCardId)).length * 3;
      break;
    }
    case 'BP01-002': {
      if (
        myRoles.some((r) => hasCardTrait(r, '里')) &&
        myRoles.some((r) => hasCardTrait(r, '丽芙'))
      ) {
        discount += 3;
      }
      break;
    }
    case 'BP01-059': {
      discount += allPublicCards.filter(
        (c) =>
          c.controllerPlayerId === myUserId &&
          c.zone === 'GRAVEYARD' &&
          hasCardName(c, '梦赴光寥之乡')
      ).length;
      break;
    }
    case 'BP02-013':
    case 'BP02-014':
    case 'BP04-072': {
      if (myRoles.length < oppRoles.length) {
        discount += 1;
      }
      break;
    }
    case 'BP02-022': {
      if (isSignalOrbBottomCostParity(gameState, myUserId, 'ODD')) {
        discount += 4;
      }
      break;
    }
    case 'BP02-060': {
      if ((player?.openCostCount ?? 0) <= (oppPlayer?.openCostCount ?? 0)) {
        discount += 1;
      }
      break;
    }
    case 'BP02-068': {
      if (oppRoles.some((r) => r.isFrozen === true)) {
        discount += 2;
      }
      break;
    }
    case 'BP03-004': {
      const hasHiddenCost =
        allPublicCards.some(
          (c) => c.controllerPlayerId === myUserId && c.zone === 'COST' && !c.isFaceUp
        ) || (player?.hiddenCostCount ?? 0) >= 1;
      if (hasHiddenCost) {
        discount += 2;
      }
      break;
    }
    case 'BP03-026': {
      if (player?.chargedAutoByLeeThisTurn) {
        discount += 2;
      }
      break;
    }
    case 'BP03-036': {
      if ((player?.cardsPlayedThisTurn ?? 0) === 2) {
        discount += 2;
      }
      break;
    }
    case 'BP03-043': {
      if ((player?.cardsPlayedThisTurn ?? 0) === 2) {
        discount += 1;
      }
      break;
    }
    case 'BP04-014': {
      if ((player?.damageTakenThisTurn ?? 0) >= 1) {
        discount += 2;
      }
      break;
    }
    case 'BP04-047': {
      if (myRoles.some((r) => hasCardName(r, '亚里莎·回音') && !r.partnerCardId)) {
        discount += 1;
      }
      break;
    }
    case 'BP04-066': {
      discount += allPublicCards.filter(
        (c) =>
          c.controllerPlayerId === myUserId &&
          c.zone === 'SIGNAL_ORB' &&
          c.isFaceUp === true &&
          hasCardName(c, '潮涌球')
      ).length;
      break;
    }
  }

  // 4. 3 张战场【永】手牌费用光环 (fieldCardCostRule，非升变且未失能)
  let fieldSetCost: number | undefined;
  let fieldDiscount = 0;
  if (!isAscensionPlay) {
    for (const role of myRoles) {
      if (hasLostInherentAbilities(role, gameState.turnNumber)) continue;
      const roleCore = normalizeCoreCardNumber(role.cardNumber);
      if (roleCore === 'BP01-077') {
        if (
          normCardName === '荣光护盾' &&
          (player?.turnCardPlayedCountByName?.['荣光护盾'] ?? 0) === 0
        ) {
          fieldSetCost = fieldSetCost === undefined ? 1 : Math.min(fieldSetCost, 1);
        }
      } else if (roleCore === 'BP01-015') {
        if (
          def.cardType === CardType.EQUIPMENT &&
          (player?.turnEquipmentPlayedCount ?? 0) === 0
        ) {
          fieldDiscount += 1;
        }
      } else if (roleCore === 'BP03-073') {
        if (
          def.cardType === CardType.TACTICS &&
          cardTraits.has('艺术协会') &&
          (player?.turnArtAssocTacticsPlayedCount ?? 0) === 0
        ) {
          fieldDiscount += 1;
        }
      }
    }
  }

  const effectiveBase = fieldSetCost !== undefined ? fieldSetCost : baseCost;
  const effectiveCost = Math.max(0, effectiveBase - discount - fieldDiscount);

  // 5. 5 张可选减费 (playDiscardDiscount / playSacrificeDiscount，非升变)
  let minPayableCost = effectiveCost;
  let optionalDiscountLabel: string | undefined;

  if (!isAscensionPlay) {
    if (core === 'BP01-067') {
      const candidates = (gameState.myHandCards || []).filter(
        (c) => c.instanceId !== card.instanceId && hasCardName(c, '梦赴光寥之乡')
      );
      if (candidates.length > 0) {
        const discounted = Math.max(0, effectiveCost - candidates.length);
        if (discounted < minPayableCost) {
          minPayableCost = discounted;
          optionalDiscountLabel = '可弃手牌《梦赴光寥之乡》减费 (每张-1)';
        }
      }
    } else if (core === 'BP03-075') {
      const myOrbs = allPublicCards.filter(
        (c) => c.controllerPlayerId === myUserId && c.zone === 'SIGNAL_ORB'
      );
      const blueOrbs = myOrbs.filter((c, idx) => {
        if (c.instanceId === card.instanceId || !c.isFaceUp) return false;
        const info = resolveOrbDisplayInfo(c, idx);
        return info.colors.includes('BLUE') && info.orbValue > 0;
      });
      if (blueOrbs.length > 0) {
        const discounted = Math.max(0, effectiveCost - blueOrbs.length * 2);
        if (discounted < minPayableCost) {
          minPayableCost = discounted;
          optionalDiscountLabel = '可将蓝球送墓减费 (每张-2)';
        }
      }
    } else if (core === 'BP02-012') {
      const fieldCards = collectFriendlyBattlefieldSacrificeCards(
        gameState,
        myUserId,
        card.instanceId,
        true
      );
      if (fieldCards.some((c) => hasCardName(c, '丽芙·极昼'))) {
        const discounted = 4;
        if (discounted < minPayableCost) {
          minPayableCost = discounted;
          optionalDiscountLabel = '可送墓战场《丽芙·极昼》使费用变为 4';
        }
      }
    } else if (core === 'BP02-041') {
      const fieldCards = collectFriendlyBattlefieldSacrificeCards(
        gameState,
        myUserId,
        card.instanceId,
        true
      );
      if (fieldCards.some((c) => hasCardName(c, '飞叶点翠'))) {
        const discounted = Math.max(0, effectiveCost - 2);
        if (discounted < minPayableCost) {
          minPayableCost = discounted;
          optionalDiscountLabel = '可送墓战场《飞叶点翠》减费 -2';
        }
      }
    } else if (core === 'BP04-060') {
      const handCandidates = (gameState.myHandCards || []).filter(
        (c) => c.instanceId !== card.instanceId && hasCardTrait(c, '神寂启示录')
      );
      const fieldCandidates = collectFriendlyBattlefieldSacrificeCards(
        gameState,
        myUserId,
        card.instanceId,
        true
      ).filter((c) => hasCardTrait(c, '神寂启示录'));
      if (handCandidates.length > 0 || fieldCandidates.length > 0) {
        const discounted = Math.max(0, effectiveCost - 2);
        if (discounted < minPayableCost) {
          minPayableCost = discounted;
          optionalDiscountLabel = '可送墓手牌/战场<神寂启示录>减费 -2';
        }
      }
    }
  }

  return {
    baseCost,
    effectiveCost,
    minPayableCost,
    hasOptionalDiscount: minPayableCost < effectiveCost,
    ...(optionalDiscountLabel ? { optionalDiscountLabel } : {}),
  };
}

/**
 * 获取卡牌在当前场面下使用时的实际费用（不含需额外弃牌/送墓的可选减费）
 */
export function getCardEffectiveCost(
  gameState: PublicGameState,
  myUserId: string,
  card: CardInstance
): number {
  return getCardEffectiveCostInfo(gameState, myUserId, card).effectiveCost;
}

// ==================== 精准攻击资格、目标与阻挡判定 (第 7 章) ====================

export interface AttackerCapabilities {
  canAttack: boolean;
  canAttackPlayer: boolean;
  canAttackCharacter: boolean;
  canAttackReadyRolesMaxCost?: number;
}

function hasEffectiveInherentCannotAttack(
  card: CardInstance,
  cardDef: { rulesText?: string } | undefined,
  turnNumber?: number
): boolean {
  if (hasCardProhibition(card, 'CANNOT_ATTACK')) return true;
  if (card.effectiveProhibitions !== undefined) return false;
  return Boolean(
    cardDef?.rulesText?.includes('【永】：该牌不能攻击') &&
      !hasLostInherentAbilities(card, turnNumber)
  );
}

function getCardCanAttackReadyRolesMaxCost(
  card: CardInstance,
  turnNumber?: number
): number | undefined {
  const latestLoseTs = getLatestLoseAbilitiesTimestamp(card, turnNumber);
  let maxCost: number | undefined;
  for (const m of card.modifiers ?? []) {
    if (m.canAttackReadyRolesMaxCost === undefined) continue;
    if (!isModifierActive(m.untilTurn, turnNumber)) continue;
    if (latestLoseTs >= 0 && (m.timestamp ?? 0) <= latestLoseTs) continue;
    maxCost =
      maxCost === undefined
        ? m.canAttackReadyRolesMaxCost
        : Math.max(maxCost, m.canAttackReadyRolesMaxCost);
  }
  return maxCost;
}

function hasMustBeAttackTarget(gameState: PublicGameState, roleCard: CardInstance): boolean {
  const latestLoseTs = getLatestLoseAbilitiesTimestamp(roleCard, gameState.turnNumber);
  for (const m of roleCard.modifiers ?? []) {
    if (!m.mustBeAttackTarget) continue;
    if (!isModifierActive(m.untilTurn, gameState.turnNumber)) continue;
    if (latestLoseTs >= 0 && (m.timestamp ?? 0) <= latestLoseTs) continue;
    return true;
  }
  if (
    normalizeCoreCardNumber(roleCard.cardNumber) === 'BP02-010' &&
    latestLoseTs < 0 &&
    gameState.activePlayerId !== roleCard.controllerPlayerId
  ) {
    return true;
  }
  return false;
}

/**
 * 7.2.1 计算指定己方战场角色在当前时机下的攻击资格与攻击范围（对齐 `combat-manager.ts:130-198`）
 */
export function getAttackerCapabilities(
  gameState: PublicGameState,
  myUserId: string,
  attacker: CardInstance
): AttackerCapabilities {
  const denied: AttackerCapabilities = {
    canAttack: false,
    canAttackPlayer: false,
    canAttackCharacter: false,
  };

  if (!attacker || attacker.controllerPlayerId !== myUserId) return denied;
  if (gameState.status && gameState.status !== 'PLAYING') return denied;
  if (!getTimingStatus(gameState, myUserId).canActMainPhase) return denied;

  const isFriendlyRole = getEffectiveRoleCardsForPlayer(gameState, myUserId).some(
    (r) => r.card.instanceId === attacker.instanceId
  );
  if (!isFriendlyRole) return denied;
  if (!attacker.isReady) return denied;

  const def = findCardByNumberOrId(attacker.cardNumber || attacker.cardId);
  if (hasEffectiveInherentCannotAttack(attacker, def, gameState.turnNumber)) {
    return denied;
  }

  const canAttackReadyRolesMaxCost = getCardCanAttackReadyRolesMaxCost(
    attacker,
    gameState.turnNumber
  );
  const isEnterTurn = attacker.turnEnteredZone === gameState.turnNumber;

  const canAttackPlayer = !isEnterTurn
    ? true
    : canRoleAttackPlayerOnEnterTurn(attacker, def, gameState.turnNumber);
  const canAttackCharacter = !isEnterTurn
    ? true
    : canRoleAttackCharacterOnEnterTurn(attacker, def);

  return {
    canAttack: canAttackPlayer || canAttackCharacter,
    canAttackPlayer,
    canAttackCharacter,
    ...(canAttackReadyRolesMaxCost !== undefined ? { canAttackReadyRolesMaxCost } : {}),
  };
}

/**
 * 7.2.1.b.1 校验指定对方战场角色是否为当前攻击者的合法角色攻击目标（含横置条件、可攻击竖直上限与 `BP02-010` 嘲讽约束）
 */
export function isLegalRoleAttackTarget(
  gameState: PublicGameState,
  myUserId: string,
  attacker: CardInstance,
  targetCard: CardInstance
): boolean {
  const caps = getAttackerCapabilities(gameState, myUserId, attacker);
  if (!caps.canAttackCharacter) return false;

  const opponentId = getOpponentPlayerId(gameState, myUserId);
  if (!opponentId || targetCard.controllerPlayerId !== opponentId) return false;

  const oppRoles = getEffectiveRoleCardsForPlayer(gameState, opponentId).map((r) => r.card);
  if (!oppRoles.some((r) => r.instanceId === targetCard.instanceId)) return false;

  const isSelectableByState = (role: CardInstance): boolean => {
    if (!role.isReady) return true;
    if (caps.canAttackReadyRolesMaxCost === undefined) return false;
    return getRealtimeCardCost(gameState, role) <= caps.canAttackReadyRolesMaxCost;
  };

  if (!isSelectableByState(targetCard)) return false;

  if (!hasMustBeAttackTarget(gameState, targetCard)) {
    const forcedExists = oppRoles.some(
      (r) => isSelectableByState(r) && hasMustBeAttackTarget(gameState, r)
    );
    if (forcedExists) return false;
  }

  return true;
}

/**
 * 7.3.1.c 校验己方战场角色是否可以阻挡当前攻击者（对齐 `combat-manager.ts:335-402`）
 */
export function canRoleBlockAttacker(
  gameState: PublicGameState,
  myUserId: string,
  blockerCard: CardInstance
): boolean {
  if (!blockerCard || blockerCard.controllerPlayerId !== myUserId) return false;
  if (!getTimingStatus(gameState, myUserId).canDeclareBlock) return false;

  const isFriendlyRole = getEffectiveRoleCardsForPlayer(gameState, myUserId).some(
    (r) => r.card.instanceId === blockerCard.instanceId
  );
  if (!isFriendlyRole) return false;
  if (!blockerCard.isReady) return false;
  if (hasCardProhibition(blockerCard, 'CANNOT_BLOCK')) return false;

  const attackerId = gameState.currentCombat?.attackerCardId;
  const attacker = attackerId ? gameState.publicCards?.[attackerId] : undefined;
  if (attacker) {
    const unblockableMaxPP = getCardUnblockableMaxPP(attacker, gameState.turnNumber);
    if (unblockableMaxPP !== undefined) {
      const blockerDef = findCardByNumberOrId(blockerCard.cardNumber || blockerCard.cardId);
      const blockerPP = getDisplayStats(blockerCard, blockerDef).pp;
      if (blockerPP <= unblockableMaxPP) return false;
    }
  }

  return true;
}

// ==================== 手牌出牌合法性判定 (8.6.2 / 10.8 / 6.3) ====================

function canIgnoreAttributeForPlayFrontend(
  gameState: PublicGameState,
  myUserId: string,
  card: CardInstance,
  isAscension: boolean
): boolean {
  const def = findCardByNumberOrId(card.cardNumber || card.cardId);
  if (!def) return false;
  if (def.attribute === ElementAttribute.NONE) return true;

  const core = normalizeCoreCardNumber(card.cardNumber);
  const myRoles = getEffectiveRoleCardsForPlayer(gameState, myUserId).map((r) => r.card);

  // 自身【永】：无视属性条件
  if (core === 'ST04-008' || core === 'BP01-076') {
    if (myRoles.some((r) => hasCardTrait(r, '突击鹰小队'))) return true;
  } else if (core === 'BP01-070') {
    if (myRoles.some((r) => hasCardTrait(r, '薇拉') || hasCardTrait(r, '21号'))) return true;
  } else if (core === 'PR-010' || core === 'BP04-059') {
    return true;
  }

  // 战场 / 费用区光环：fieldIgnoreAttributeRule (BP04-059 / BP02-009)
  const publicCards = gameState.publicCards || {};
  const topFieldCards: CardInstance[] = [];
  for (const slot of gameState.battlefields?.[myUserId] || []) {
    for (const id of [slot.roleCardId, slot.assistCardId, slot.standaloneEquipmentId]) {
      if (id && publicCards[id]) topFieldCards.push(publicCards[id]!);
    }
  }

  if (
    hasCardTrait(card, '神寂启示录') &&
    topFieldCards.some(
      (c) =>
        normalizeCoreCardNumber(c.cardNumber) === 'BP04-059' &&
        !hasLostInherentAbilities(c, gameState.turnNumber)
    )
  ) {
    return true;
  }

  const hasAscensionConfig = Boolean(def.rulesText && parseAscensionConfig(def.rulesText));
  if (!isAscension && def.cardType === CardType.ROLE && hasAscensionConfig) {
    const bp02009Active =
      topFieldCards.some(
        (c) =>
          normalizeCoreCardNumber(c.cardNumber) === 'BP02-009' &&
          !hasLostInherentAbilities(c, gameState.turnNumber)
      ) ||
      Object.values(publicCards).some(
        (c) =>
          c.controllerPlayerId === myUserId &&
          c.zone === 'COST' &&
          c.isFaceUp === true &&
          normalizeCoreCardNumber(c.cardNumber) === 'BP02-009'
      );
    if (bp02009Active) return true;
  }

  return false;
}

function hasMatchingAttributeForPlay(
  gameState: PublicGameState,
  myUserId: string,
  card: CardInstance,
  isAscension: boolean
): boolean {
  const def = findCardByNumberOrId(card.cardNumber || card.cardId);
  if (!def) return false;
  if (def.attribute === ElementAttribute.NONE) return true;
  if (canIgnoreAttributeForPlayFrontend(gameState, myUserId, card, isAscension)) return true;

  const openCostCards = Object.values(gameState.publicCards || {}).filter(
    (c) => c.controllerPlayerId === myUserId && c.zone === 'COST' && c.isFaceUp
  );
  const player = gameState.players?.[myUserId];
  if (openCostCards.length === 0 && (player?.openCostCount ?? 0) > 0) {
    return true;
  }
  return openCostCards.some(
    (c) => findCardByNumberOrId(c.cardNumber || c.cardId)?.attribute === def.attribute
  );
}

function wouldViolateUniqueBloodPactFrontend(
  gameState: PublicGameState,
  myUserId: string,
  incomingCard: CardInstance
): boolean {
  const def = findCardByNumberOrId(incomingCard.cardNumber || incomingCard.cardId);
  if (!def || def.cardType !== CardType.ROLE) return false;

  const incomingCore = normalizeCoreCardNumber(incomingCard.cardNumber);
  const isIncomingBloodPact =
    hasCardName(incomingCard, '血契者') || incomingCore === 'BP04-052';
  if (!isIncomingBloodPact) return false;

  const publicCards = gameState.publicCards || {};
  const existing: CardInstance[] = [];
  for (const slot of gameState.battlefields?.[myUserId] || []) {
    const id = slot.roleCardId ?? slot.assistCardId;
    const c = id ? publicCards[id] : undefined;
    if (!c || c.instanceId === incomingCard.instanceId) continue;
    if (hasCardName(c, '血契者') || normalizeCoreCardNumber(c.cardNumber) === 'BP04-052') {
      existing.push(c);
    }
  }
  if (existing.length === 0) return false;

  const anyExistingActive = existing.some(
    (c) => !hasLostInherentAbilities(c, gameState.turnNumber)
  );
  return anyExistingActive || incomingCore === 'BP04-052';
}

function isFengrenTachiEquipmentDefFrontend(
  def: { cardType?: CardType; traits?: string[] } | undefined
): boolean {
  if (!def || def.cardType !== CardType.EQUIPMENT) return false;
  const traits = def.traits ?? [];
  return traits.some(
    (t) => t === '封刃太刀' || t === '太刀' || t === '小太刀' || t === '大太刀'
  );
}

function canEquipToRoleFrontend(
  gameState: PublicGameState,
  myUserId: string,
  equipCard: CardInstance,
  roleCard: CardInstance
): boolean {
  const existingIds = Array.from(
    new Set(
      [roleCard.attachedEquipmentId, ...(roleCard.extraAttachedEquipmentIds ?? [])].filter(
        (id): id is string => Boolean(id)
      )
    )
  );
  if (existingIds.includes(equipCard.instanceId)) return false;
  if (existingIds.length === 0) return true;
  if (existingIds.length >= 2) return false;

  const roleCore = normalizeCoreCardNumber(roleCard.cardNumber);
  const canDual =
    (roleCore === 'BP01-014' || roleCore === 'BP01-016' || roleCore === 'BP01-017') &&
    !hasLostInherentAbilities(roleCard, gameState.turnNumber);
  if (!canDual) return false;

  const existingCard = gameState.publicCards?.[existingIds[0]!];
  const existingDef = existingCard
    ? findCardByNumberOrId(existingCard.cardNumber || existingCard.cardId)
    : undefined;
  const newDef = findCardByNumberOrId(equipCard.cardNumber || equipCard.cardId);
  return (
    isFengrenTachiEquipmentDefFrontend(existingDef) &&
    isFengrenTachiEquipmentDefFrontend(newDef)
  );
}

function checkInstantTimingFrontend(
  gameState: PublicGameState,
  myUserId: string,
  rulesText: string
): boolean {
  const window = gameState.timingWindow;
  const combat = gameState.currentCombat;
  const isOpponentTurn = myUserId !== gameState.activePlayerId;

  if (
    (rulesText.includes('该牌只能在对方回合使用') ||
      /【瞬时】[:：]\s*对方回合中/.test(rulesText)) &&
    !isOpponentTurn
  ) {
    return false;
  }
  if (rulesText.includes('我方玩家被攻击时才能发动')) {
    const attacked =
      window?.kind === 'FREE_TIMING' && combat?.targetType === 'PLAYER' && isOpponentTurn;
    if (!attacked) return false;
  }
  if (
    (rulesText.includes('角色攻击时才能发动') ||
      rulesText.includes('该牌只能在自由时点步骤发动')) &&
    window?.kind !== 'FREE_TIMING'
  ) {
    return false;
  }
  const fieldRequirement = rulesText.match(
    /该牌只能在我方战场存在([《<])([^》>]+)[》>](?:角色)?时才能使用/
  );
  if (fieldRequirement) {
    const bracket = fieldRequirement[1]!;
    const subject = fieldRequirement[2]!;
    const myRoles = getEffectiveRoleCardsForPlayer(gameState, myUserId).map((r) => r.card);
    const exists = myRoles.some((r) =>
      bracket === '《' ? hasCardName(r, subject) : hasCardTrait(r, subject)
    );
    if (!exists) return false;
  }
  return true;
}

/**
 * 校验己方手牌在当前对局状态下是否具备合法操作（`DRAW_CHARGE_PHASE` 充明费 / 瞬时窗口 / 主阶段手牌【起】、常规出牌或升变）
 */
export function isHandCardLegalToPlay(
  gameState: PublicGameState,
  myUserId: string,
  card: CardInstance,
  usableInstantCardIds?: Set<string>,
  zoneAbilityMap?: Record<string, ActivatedAbilityOption[]>
): boolean {
  if (!card || card.controllerPlayerId !== myUserId || card.zone !== 'HAND') return false;
  if (gameState.status && gameState.status !== 'PLAYING') return false;
  const choicePending = Boolean(gameState.currentPendingChoice || gameState.opponentPendingChoice);
  if (choicePending) return false;

  // 1. 6.3 抽牌填充阶段：回合玩家可选择任意手牌放置为明费
  if (gameState.phase === 'DRAW_CHARGE_PHASE') {
    return gameState.activePlayerId === myUserId;
  }

  const def = findCardByNumberOrId(card.cardNumber || card.cardId);
  if (!def) return false;

  const player = gameState.players?.[myUserId];
  const availCost = (player?.availableOpenCostCount ?? 0) + (player?.hiddenCostCount ?? 0);
  const core = normalizeCoreCardNumber(card.cardNumber);
  const isInstantTactics =
    def.cardType === CardType.TACTICS &&
    Boolean(def.isInstant || def.rulesText?.includes('【瞬时】'));
  const timing = getTimingStatus(gameState, myUserId);

  const canPlayAsInstantTactics = (): boolean => {
    if (!isInstantTactics) return false;
    if (core === 'PR-014' && (player?.turnCardPlayedCountByName?.[def.name] ?? 0) >= 1) {
      return false;
    }
    if (!checkInstantTimingFrontend(gameState, myUserId, def.rulesText || '')) {
      return false;
    }
    if (!hasMatchingAttributeForPlay(gameState, myUserId, card, false)) {
      return false;
    }
    const costInfo = getCardEffectiveCostInfo(gameState, myUserId, card, { isAscension: false });
    return costInfo.minPayableCost <= availCost;
  };

  // 2. 10.8 轮流使用【瞬时】时机：非战术瞬时或瞬时战术
  if (timing.hasInstantPriority) {
    if (usableInstantCardIds?.has(card.instanceId)) return true;
    if (
      !usableInstantCardIds &&
      getUsableNonTacticsInstants(gameState, myUserId).some(
        (opt) => opt.card.instanceId === card.instanceId
      )
    ) {
      return true;
    }
    return canPlayAsInstantTactics();
  }

  // 3. 6.4.1.b 主要阶段行动时机：手牌【起】 / 常规出牌 / 升变出场
  if (!timing.canActMainPhase) return false;

  const handAbilities =
    zoneAbilityMap?.[card.instanceId] ??
    getCardActivatedAbilityOptions(gameState, myUserId, card, 'HAND');
  if (handAbilities.some((opt) => !opt.disabled)) {
    return true;
  }

  // 3a. 常规出牌判定
  let canNormalPlay = true;
  if (isInstantTactics) {
    const allowInMain =
      core === 'PR-011' || Boolean(def.rulesText?.includes('主要阶段也可以发动'));
    if (!allowInMain || !canPlayAsInstantTactics()) {
      canNormalPlay = false;
    }
  } else {
    if (core === 'PR-014' && (player?.turnCardPlayedCountByName?.[def.name] ?? 0) >= 1) {
      canNormalPlay = false;
    }
    if (canNormalPlay && wouldViolateUniqueBloodPactFrontend(gameState, myUserId, card)) {
      canNormalPlay = false;
    }
    if (canNormalPlay && !hasMatchingAttributeForPlay(gameState, myUserId, card, false)) {
      canNormalPlay = false;
    }
    if (canNormalPlay) {
      const mySlots = gameState.battlefields?.[myUserId] || [];
      const publicCards = gameState.publicCards || {};
      if (def.cardType === CardType.ROLE) {
        if (!mySlots.some(isBattlefieldSlotEmpty)) canNormalPlay = false;
      } else if (def.cardType === CardType.ASSIST) {
        if (!mySlots.some((s) => canPlayAssistOnSlot(s, publicCards))) canNormalPlay = false;
      } else if (def.cardType === CardType.EQUIPMENT) {
        const hasEmptySlot = mySlots.some(isBattlefieldSlotEmpty);
        const hasValidHost = getEffectiveRoleCardsForPlayer(gameState, myUserId).some((r) =>
          canEquipToRoleFrontend(gameState, myUserId, card, r.card)
        );
        if (!hasEmptySlot && !hasValidHost) canNormalPlay = false;
      }
    }
    if (canNormalPlay) {
      const costInfo = getCardEffectiveCostInfo(gameState, myUserId, card, { isAscension: false });
      if (costInfo.minPayableCost > availCost) {
        canNormalPlay = false;
      }
    }
  }
  if (canNormalPlay) return true;

  // 3b. 升变出场判定
  const ascPlan = getAscensionPlan(gameState, myUserId, card);
  return Boolean(ascPlan && ascPlan.canAscend);
}

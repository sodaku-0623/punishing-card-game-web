import {
  AscensionRestriction,
  AscensionRuleConfig,
  BattlefieldSlot,
  CardInstance,
  CardType,
  PublicGameState,
} from '@zhanshuang/shared';
import { parseAscensionConfig } from '@zhanshuang/game-rules';
import { hasCardProhibition } from '@/lib/card-stats';
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
  restrictionError?: string;
  canAscend: boolean;
  reason?: string;
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
function expandTraitSynonyms(rawTraits: Iterable<string>): Set<string> {
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
function getCardExpandedTraits(card: CardInstance): Set<string> {
  if (card.effectiveTraits !== undefined) {
    return expandTraitSynonyms(card.effectiveTraits);
  }
  const def = findCardByNumberOrId(card.cardNumber || card.cardId);
  const clearBase = Boolean(card.modifiers?.some((m) => m.clearBaseTraits));
  const baseTraits = clearBase ? [] : def?.traits ?? [];
  const addedTraits = card.modifiers?.flatMap((m) => m.addTraits ?? []) ?? [];
  return expandTraitSynonyms([...baseTraits, ...addedTraits]);
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

/**
 * 检查卡牌是否带有尚未过期的 `loseAbilities` 失能标记（8.3.4）
 */
function hasLostInherentAbilities(card: CardInstance, turnNumber?: number): boolean {
  return Boolean(
    card.modifiers?.some(
      (m) =>
        m.loseAbilities === true &&
        (m.untilTurn === undefined || turnNumber === undefined || m.untilTurn >= turnNumber)
    )
  );
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

/**
 * 获取己方战场上全部当前有效「角色牌」（兼容 `PR-041` 变身角色，排除变为辅助机期间的 `BP04-001`）
 */
export function getAllFriendlyEffectiveRoleCards(
  gameState: PublicGameState,
  myUserId: string
): Array<{ slotIndex: number; slot: BattlefieldSlot; card: CardInstance }> {
  const slots = gameState.battlefields?.[myUserId] || [];
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
  const opponentId =
    Object.keys(gameState.players || {}).find((id) => id !== myUserId) ??
    (gameState.activePlayerId === myUserId
      ? gameState.nonActivePlayerId
      : gameState.activePlayerId);
  let tappedOpponentTaxCount = 0;
  if (opponentId) {
    const publicCards = gameState.publicCards || {};
    for (const slot of gameState.battlefields?.[opponentId] || []) {
      const occ = getSlotOccupancy(slot, publicCards);
      const topCard = occ.card;
      if (
        topCard &&
        topCard.cardNumber === 'BP02-067' &&
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
    restrictionError,
    canAscend: !reason,
    ...(reason ? { reason } : {}),
  };
}

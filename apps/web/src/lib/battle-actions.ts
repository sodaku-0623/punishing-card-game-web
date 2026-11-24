import {
  BattlefieldSlot,
  CardInstance,
  CardType,
  PublicGameState,
} from '@zhanshuang/shared';
import { findCardByNumberOrId } from '@/lib/cards-data';
import { resolveOrbDisplayInfo } from '@/lib/signal-orbs';

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

export function isBattlefieldSlotEmpty(slot: BattlefieldSlot): boolean {
  return !slot.roleCardId && !slot.standaloneEquipmentId && !slot.assistCardId;
}

export function getSlotOccupancy(
  slot: BattlefieldSlot,
  publicCards?: Record<string, CardInstance>
): { kind: SlotOccupancyKind; card?: CardInstance } {
  if (slot.roleCardId && publicCards?.[slot.roleCardId]) {
    return { kind: 'ROLE', card: publicCards[slot.roleCardId] };
  }
  if (slot.standaloneEquipmentId && publicCards?.[slot.standaloneEquipmentId]) {
    return { kind: 'STANDALONE_EQUIPMENT', card: publicCards[slot.standaloneEquipmentId] };
  }
  if (slot.assistCardId && publicCards?.[slot.assistCardId]) {
    return { kind: 'ASSIST', card: publicCards[slot.assistCardId] };
  }
  return { kind: 'EMPTY' };
}

export function isNonTacticsInstantCard(cardNumberOrId?: string): boolean {
  if (!cardNumberOrId) return false;
  const def = findCardByNumberOrId(cardNumberOrId);
  if (!def || def.cardType === CardType.TACTICS) return false;
  return Boolean(def.isInstant || def.rulesText?.includes('【瞬时】'));
}

function hasTraitOrName(card: CardInstance, keyword: string): boolean {
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
  const myRoles = mySlots
    .map((s) => (s.roleCardId ? publicCards[s.roleCardId] : undefined))
    .filter((c): c is CardInstance => Boolean(c));
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
      const hostDef = findCardByNumberOrId(host.cardNumber || host.cardId);
      if (!hostDef?.name.includes('露娜·终焉') || !host.underneathCardIds?.length) continue;
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
    const mySlots = gameState.battlefields?.[myUserId] || [];
    for (const slot of mySlots) {
      if (!slot.roleCardId || slot.roleCardId === hostRoleCard.instanceId) continue;
      if (inCombatIds.has(slot.roleCardId)) continue;
      const c = gameState.publicCards?.[slot.roleCardId];
      if (c) pushIfRole(c, `战场位${slot.slotIndex + 1}`);
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

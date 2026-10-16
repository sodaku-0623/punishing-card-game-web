import {
  GameState,
  GameEvent,
  GameAction,
  CardInstance,
  CardType,
  CardVersionData,
  PendingChoice,
} from '@zhanshuang/shared';
import { ICardDatabase } from '../database/card-registry.js';
import { ZoneManager } from '../zone/zone-manager.js';
import { BattlefieldManager } from '../zone/battlefield-manager.js';

export interface CardEffectContext {
  state: GameState;
  zoneMgr: ZoneManager;
  fieldMgr: BattlefieldManager;
  cardDb: ICardDatabase;
  events: GameEvent[];
  payCost: (playerId: string, costToPay: number) => boolean;
  setPendingChoice: (choice?: PendingChoice) => void;
}

/**
 * 战双卡牌对战 全卡牌效果执行引擎
 * 负责识别并处理所有卡牌的登场效果【出】、战术效果、起动能力【起】与决策分支结算
 */
export class CardEffectEngine {
  constructor(private ctx: CardEffectContext) {}

  private getOpponentPlayerId(playerId: string): string {
    return playerId === this.ctx.state.activePlayerId
      ? this.ctx.state.nonActivePlayerId
      : this.ctx.state.activePlayerId;
  }

  private getFriendlyRoles(playerId: string): CardInstance[] {
    const slots = this.ctx.state.battlefields[playerId] || [];
    return slots
      .map((s) => (s.roleCardId ? this.ctx.state.cards[s.roleCardId] : null))
      .filter(Boolean) as CardInstance[];
  }

  private getOpponentRoles(playerId: string): CardInstance[] {
    const oppId = this.getOpponentPlayerId(playerId);
    const slots = this.ctx.state.battlefields[oppId] || [];
    return slots
      .map((s) => (s.roleCardId ? this.ctx.state.cards[s.roleCardId] : null))
      .filter(Boolean) as CardInstance[];
  }

  getCardDef(cardOrId: CardInstance | string): CardVersionData | undefined {
    const num = typeof cardOrId === 'string'
      ? cardOrId
      : (cardOrId.cardNumber || cardOrId.cardId);
    return this.ctx.cardDb.getCard(num);
  }

  createRoleChoiceOption(
    card: CardInstance,
    options?: {
      eligible?: boolean;
      ineligibleReason?: string;
      customLabel?: string;
    }
  ): { id: string; label: string; payload: any } {
    const d = this.getCardDef(card);
    const effectivePP = this.ctx.fieldMgr.calculateRoleEffectivePP(card.instanceId);
    const eligible = options?.eligible !== false;
    const name = d?.name || card.cardNumber;
    const slotText = card.slotIndex !== undefined ? ` (卡位 ${card.slotIndex + 1})` : '';
    const label = options?.customLabel || `【${name}】[PP: ${effectivePP}]${slotText}`;

    return {
      id: card.instanceId,
      label,
      payload: {
        cardNumber: card.cardNumber,
        name,
        cardType: d?.cardType || CardType.ROLE,
        cost: d?.cost ?? 0,
        basePP: effectivePP,
        baseDP: d?.baseDP ?? 1,
        attribute: d?.attribute,
        traits: d?.traits || [],
        imageUrl: (d as any)?.imageUrl || card.imageUrl || `/cards/${card.cardNumber}.png`,
        rulesText: d?.rulesText || '',
        slotIndex: card.slotIndex,
        eligible,
        ineligibleReason: !eligible ? (options?.ineligibleReason || '不符合选择条件') : undefined,
      },
    };
  }

  createGeneralCardChoiceOption(
    card: CardInstance,
    options?: {
      eligible?: boolean;
      ineligibleReason?: string;
      customLabel?: string;
    }
  ): { id: string; label: string; payload: any } {
    const d = this.getCardDef(card);
    const eligible = options?.eligible !== false;
    const name = d?.name || card.cardNumber;
    const label = options?.customLabel || `【${name}】${d?.cost !== undefined ? `费用:${d.cost}` : ''} ${d?.basePP !== undefined ? `PP:${d.basePP}` : ''}`;

    return {
      id: card.instanceId,
      label,
      payload: {
        cardNumber: card.cardNumber,
        name,
        cardType: d?.cardType,
        cost: d?.cost ?? 0,
        basePP: d?.basePP,
        baseDP: d?.baseDP,
        attribute: d?.attribute,
        traits: d?.traits || [],
        imageUrl: (d as any)?.imageUrl || card.imageUrl || `/cards/${card.cardNumber}.png`,
        rulesText: d?.rulesText || '',
        eligible,
        ineligibleReason: !eligible ? (options?.ineligibleReason || '不符合选择条件') : undefined,
      },
    };
  }

  /**
   * 官方规则公开牌组顶卡牌与双方确认检索流程 (3.8.1 / 公开机制)
   * 1. 将公开卡牌从 DECK 移至 PROCESSING 处理区 (正面朝上，双方公共可见)
   * 2. 若存在对手，先向对手派发 OPPONENT_CONFIRM_REVEAL 决策，待对手查阅确认
   * 3. 对手确认后，向发动方派发卡牌选取决策并高亮可选卡牌
   * 4. 选取的卡牌移入 destination (手牌/战场/费用区等)，其余卡牌移入 remainingDestination (墓地/牌组底/洗切)
   */
  public revealTopAndSearch(
    playerId: string,
    config: {
      sourceCardInstanceId?: string;
      cardName: string;
      count: number;
      prompt: string;
      promptNoEligible?: string;
      isEligible?: (card: CardInstance, def?: CardVersionData) => boolean;
      ineligibleReason?: string;
      destination?: 'HAND' | 'BATTLEFIELD' | 'COST' | 'SIGNAL_ORB' | 'GRAVEYARD';
      remainingDestination?: 'GRAVEYARD' | 'DECK_BOTTOM' | 'SHUFFLE_DECK';
      minSelections?: number;
      maxSelections?: number;
      choiceEffectType?: string;
    }
  ): { success: boolean; error?: string } {
    const deck = this.ctx.zoneMgr.getCardsInZone(playerId, 'DECK');
    const topCards = deck.slice(0, config.count);

    if (topCards.length === 0) {
      if (config.sourceCardInstanceId) {
        const src = this.ctx.state.cards[config.sourceCardInstanceId];
        if (src && src.zone === 'PROCESSING') {
          this.ctx.zoneMgr.moveCard(config.sourceCardInstanceId, 'GRAVEYARD', { isFaceUp: true });
        }
      }
      this.ctx.events.push({
        type: 'ABILITY_ACTIVATED',
        playerId,
        cardInstanceId: config.sourceCardInstanceId || '',
        abilityName: `【${config.cardName}】效果发动`,
        rulesText: '牌组为空，无卡牌可公开。',
      });
      return { success: true };
    }

    // 规则 3.8.1：公开卡牌进入处理区 (PROCESSING)，公开区域双方可见
    for (const c of topCards) {
      this.ctx.zoneMgr.moveCard(c.instanceId, 'PROCESSING', { isFaceUp: true });
    }

    const topCardIds = topCards.map((c) => c.instanceId);

    // 记录公开事件
    this.ctx.events.push({
      type: 'ABILITY_ACTIVATED',
      playerId,
      cardInstanceId: config.sourceCardInstanceId || '',
      abilityName: `【${config.cardName}】公开牌组顶卡牌`,
      rulesText: `公开了牌组顶 ${topCards.length} 张卡牌至处理区。`,
    });

    const oppId = this.getOpponentPlayerId(playerId);

    const serializedConfig = {
      activePlayerId: playerId,
      sourceCardInstanceId: config.sourceCardInstanceId,
      cardName: config.cardName,
      prompt: config.prompt,
      promptNoEligible: config.promptNoEligible,
      ineligibleReason: config.ineligibleReason,
      destination: config.destination,
      remainingDestination: config.remainingDestination,
      minSelections: config.minSelections ?? 1,
      maxSelections: config.maxSelections ?? 1,
      choiceEffectType: config.choiceEffectType || 'SEARCH_TOP_CARDS',
      topCardIds,
      filterTrait:
        config.cardName.includes('升格者') || config.prompt.includes('升格者')
          ? '升格者'
          : config.cardName.includes('灰鸦') || config.prompt.includes('灰鸦')
          ? '灰鸦'
          : config.prompt.includes('21号') || config.prompt.includes('诺克提')
          ? '三头犬'
          : undefined,
    };

    // 若存在对手且不为自身，则必须先由对手确认公开卡牌 (规则：公开卡牌需双方展示，对手确认后发动方才可继续操作)
    if (oppId && oppId !== playerId) {
      const options = topCards.map((c) => this.createGeneralCardChoiceOption(c, { eligible: true }));
      this.ctx.setPendingChoice({
        id: `choice-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        playerId: oppId,
        choiceType: 'SELECT_CARDS',
        prompt: `【对方公开卡牌展示】对方发动了【${config.cardName}】的效果，公开了以下 ${topCards.length} 张卡牌。请检视确认：`,
        options,
        effectType: 'OPPONENT_CONFIRM_REVEAL',
        sourceCardInstanceId: config.sourceCardInstanceId,
        metadata: serializedConfig,
        minSelections: 0,
        maxSelections: topCards.length,
      });
      return { success: true };
    }

    // 单人/无对手模式下直接进入发动方选择阶段
    return this.dispatchRevealedSelection(playerId, {
      ...serializedConfig,
      isEligible: config.isEligible,
    });
  }

  public dispatchRevealedSelection(
    playerId: string,
    config: {
      activePlayerId?: string;
      sourceCardInstanceId?: string;
      cardName?: string;
      prompt?: string;
      promptNoEligible?: string;
      ineligibleReason?: string;
      destination?: 'HAND' | 'BATTLEFIELD' | 'COST' | 'SIGNAL_ORB' | 'GRAVEYARD';
      remainingDestination?: 'GRAVEYARD' | 'DECK_BOTTOM' | 'SHUFFLE_DECK';
      minSelections?: number;
      maxSelections?: number;
      choiceEffectType?: string;
      topCardIds: string[];
      filterTrait?: string;
      isEligible?: (card: CardInstance, def?: CardVersionData) => boolean;
    }
  ): { success: boolean; error?: string } {
    const activePlayerId = config.activePlayerId || playerId;
    const topCards = (config.topCardIds || [])
      .map((id) => this.ctx.state.cards[id])
      .filter((c) => c && c.zone === 'PROCESSING') as CardInstance[];

    if (topCards.length === 0) {
      return { success: true };
    }

    // 里·异火 / 翻开卡牌条件判定专用检视弹窗 (双方展示并确认)
    if (config.choiceEffectType === 'ST01_002_INSPECT_ORB') {
      const isOrb = (c: CardInstance) => {
        const d = this.getCardDef(c);
        return (
          !!d?.signalOrb ||
          c.cardNumber.startsWith('ORB-') ||
          Boolean(d?.name && d.name.includes('信号球')) ||
          c.cardNumber === 'ST01-012' ||
          c.cardNumber === 'ST01-013' ||
          c.cardNumber === 'ST01-014'
        );
      };
      const hasOrb = topCards.some(isOrb);

      const options = topCards.map((c) => {
        const match = isOrb(c);
        return this.createGeneralCardChoiceOption(c, {
          eligible: match,
          ineligibleReason: !match ? '非信号球牌' : undefined,
        });
      });

      const prompt = hasOrb
        ? `【${config.cardName || '里·异火'}】已翻开牌组顶${topCards.length}张卡牌（已成功检出信号球！）：请检视确认，下一步将选择战场<灰鸦小队>角色赋予【充能+1】(PP+1000)`
        : `【${config.cardName || '里·异火'}】已翻开牌组顶${topCards.length}张卡牌（未检测到信号球牌）：未能触发【充能+1】效果。请检视确认，翻开的卡牌将全部送入墓地：`;

      this.ctx.setPendingChoice({
        id: `choice-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        playerId: activePlayerId,
        choiceType: 'SELECT_CARDS',
        prompt,
        options,
        effectType: 'ST01_002_INSPECT_ORB',
        sourceCardInstanceId: config.sourceCardInstanceId,
        metadata: {
          ...config,
          activePlayerId,
          hasOrb,
          topCardIds: topCards.map((c) => c.instanceId),
        },
        minSelections: 0,
        maxSelections: topCards.length,
      });
      return { success: true };
    }

    // 判定过滤函数
    let testEligible = config.isEligible;
    if (!testEligible) {
      const cardName = config.cardName || '';
      const prompt = config.prompt || '';
      const trait = config.filterTrait || '';
      if (trait === '升格者' || cardName.includes('升格者') || prompt.includes('升格者')) {
        testEligible = (_c, d) => {
          if (!d || d.cardType !== CardType.ROLE) return false;
          const traits = d.traits || [];
          return (
            traits.some((t) => t.includes('升格者')) ||
            ['露娜', '罗兰', '加百列', '阿尔法'].some((k) => d.name.includes(k))
          );
        };
      } else if (trait === '灰鸦' || cardName.includes('灰鸦') || prompt.includes('灰鸦')) {
        testEligible = (_c, d) => {
          if (!d || d.cardType !== CardType.ROLE) return false;
          const traits = d.traits || [];
          return (
            traits.some((t) => t.includes('灰鸦')) ||
            ['露西亚', '里', '丽芙'].some((k) => d.name.includes(k))
          );
        };
      } else if (trait === '三头犬' || prompt.includes('21号') || prompt.includes('诺克提')) {
        testEligible = (_c, d) => {
          if (!d || d.cardType !== CardType.ROLE) return false;
          return (
            d.name.includes('21号') ||
            d.name.includes('诺克提') ||
            (d.traits || []).some((t) => t.includes('三头犬'))
          );
        };
      } else if (config.destination === 'BATTLEFIELD') {
        testEligible = (_c, d) => d?.cardType === CardType.ROLE;
      } else {
        testEligible = () => true;
      }
    }

    const eligibleCards = topCards.filter((c) => testEligible!(c, this.getCardDef(c)));
    const hasEligible = eligibleCards.length > 0;
    const eligibleCardIds = eligibleCards.map((c) => c.instanceId);

    const options = topCards.map((c) => {
      const isEligible = eligibleCardIds.includes(c.instanceId);
      return this.createGeneralCardChoiceOption(c, {
        eligible: isEligible,
        ineligibleReason: !isEligible ? (config.ineligibleReason || '不符合选取条件') : undefined,
      });
    });

    const minSelections = hasEligible ? Math.min(config.minSelections ?? 1, eligibleCards.length) : 0;
    const maxSelections = hasEligible ? Math.min(config.maxSelections ?? 1, topCards.length) : 0;

    const prompt = hasEligible
      ? (config.prompt || `请选择卡牌：`)
      : (config.promptNoEligible || `公开卡牌中未检出符合条件的卡牌，请点击确认继续：`);

    this.ctx.setPendingChoice({
      id: `choice-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      playerId: activePlayerId,
      choiceType: 'SELECT_CARDS',
      prompt,
      options,
      effectType: config.choiceEffectType || 'SEARCH_TOP_CARDS',
      sourceCardInstanceId: config.sourceCardInstanceId,
      metadata: {
        ...config,
        activePlayerId,
        eligibleCardIds,
        destination: config.destination || 'HAND',
        remainingDestination: config.remainingDestination || 'DECK_BOTTOM',
      },
      minSelections,
      maxSelections,
    });

    return { success: true };
  }

  // =========================================================================
  // 1. 战术牌打出效果处理 (含信号球、专属大招、抽滤、消灭、增益战术)
  // =========================================================================
  handlePlayTactics(
    playerId: string,
    cardInstanceId: string,
    cardDef: CardVersionData
  ): { success: boolean; error?: string } {
    const cardNum = cardDef.cardNumber || cardDef.id;

    // --- 前置条件校验 ---
    // 重逢 (ST01-011): 需我方战场存在<露西亚>角色
    if (cardNum === 'ST01-011' || cardDef.name.includes('重逢')) {
      const hasLucia = this.getFriendlyRoles(playerId).some((c) => {
        const d = this.getCardDef(c);
        return d?.traits?.includes('露西亚') || d?.name?.includes('露西亚');
      });
      if (!hasLucia) {
        return { success: false, error: '我方战场不存在<露西亚>角色，无法使用【重逢】' };
      }
      const oppRoles = this.getOpponentRoles(playerId).filter(
        (c) => this.ctx.fieldMgr.calculateRoleEffectivePP(c.instanceId) <= 8000
      );
      if (oppRoles.length === 0) {
        return { success: false, error: '对方战场没有PP为8000及以下的角色' };
      }
    }

    // 刹那制裁 (ST02-010): 需我方战场存在《露娜·银冕》
    if (cardNum === 'ST02-010' || cardDef.name.includes('刹那制裁')) {
      const hasLuna = this.getFriendlyRoles(playerId).some((c) => {
        const d = this.getCardDef(c);
        return d?.name?.includes('露娜');
      });
      if (!hasLuna) {
        return { success: false, error: '我方战场不存在《露娜·银冕》，无法使用【刹那制裁】' };
      }
      if (this.getOpponentRoles(playerId).length === 0) {
        return { success: false, error: '对方战场没有可选择的角色' };
      }
    }

    // 筛选开始 (ST02-011): 需我方战场存在《露娜·银冕》
    if (cardNum === 'ST02-011' || cardDef.name.includes('筛选开始')) {
      const hasLuna = this.getFriendlyRoles(playerId).some((c) => {
        const d = this.getCardDef(c);
        return d?.name?.includes('露娜');
      });
      if (!hasLuna) {
        return { success: false, error: '我方战场不存在《露娜·银冕》，无法使用【筛选开始】' };
      }
      const gyRoles = this.ctx.zoneMgr
        .getCardsInZone(playerId, 'GRAVEYARD')
        .filter((c) => {
          const d = this.getCardDef(c);
          return d?.cardType === CardType.ROLE && (d?.cost || 0) <= 3;
        });
      if (gyRoles.length === 0) {
        return { success: false, error: '我方墓地没有费用为3及以下的角色' };
      }
      if (this.ctx.fieldMgr.findFirstEmptySlot(playerId) === undefined) {
        return { success: false, error: '战场没有空余卡位' };
      }
    }

    // --- 分流执行效果 ---

    // A. 专武/招式战术牌 (使用后放置到信号球区最上方，抽1张牌)
    // ST01-012/013/014, ST02-012/013/014, ST03-012/013/014
    if (
      cardDef.rulesText.includes('放置到我方信号球区最上方') ||
      cardDef.rulesText.includes('信号球区最上方')
    ) {
      // 1. 移动至信号球区最上方 (不进入墓地)
      this.ctx.zoneMgr.moveCard(cardInstanceId, 'SIGNAL_ORB', { isFaceUp: true });
      // 2. 抽1张牌
      this.ctx.zoneMgr.drawCards(playerId, 1);

      this.ctx.events.push({
        type: 'ABILITY_ACTIVATED',
        playerId,
        cardInstanceId,
        abilityName: `${cardDef.name} 充能就绪并抽牌`,
        rulesText: cardDef.rulesText,
      });

      // 规则：玩家从手牌中发动信号球将其填充到信号球区则只能发动其<充能自>效果以外的效果
      // 不在此处执行 <充能自> 效果 (仅在攻击充能与伤害充能流程中触发)
      return { success: true };
    }

    // B. 基础信号球牌 (ORB-RED, ORB-BLUE, ORB-YELLOW)
    if (cardNum.startsWith('ORB-') || (cardDef.signalOrb && cardDef.cost === 0)) {
      this.ctx.zoneMgr.moveCard(cardInstanceId, 'SIGNAL_ORB', { isFaceUp: true });
      this.ctx.events.push({
        type: 'ABILITY_ACTIVATED',
        playerId,
        cardInstanceId,
        abilityName: `${cardDef.name} 信号球就绪`,
        rulesText: cardDef.rulesText,
      });
      return { success: true };
    }

    // C. 常规战术牌：先移入处理区，完成效果后送入墓地
    this.ctx.zoneMgr.moveCard(cardInstanceId, 'PROCESSING', { isFaceUp: true });

    // 1. 阿呆蛙与铃铛羊 (ST01-009): 抽1张牌，选择我方战场1张角色PP+2000
    if (cardNum === 'ST01-009' || cardDef.name.includes('阿呆蛙与铃铛羊')) {
      this.ctx.zoneMgr.drawCards(playerId, 1);
      const friendlyRoles = this.getFriendlyRoles(playerId);
      if (friendlyRoles.length === 0) {
        this.ctx.zoneMgr.moveCard(cardInstanceId, 'GRAVEYARD', { isFaceUp: true });
      } else if (friendlyRoles.length === 1 && friendlyRoles[0]) {
        friendlyRoles[0].tempPPBonus = (friendlyRoles[0].tempPPBonus || 0) + 2000;
        this.ctx.zoneMgr.moveCard(cardInstanceId, 'GRAVEYARD', { isFaceUp: true });
      } else {
        this.ctx.setPendingChoice({
          id: `choice-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          playerId,
          choiceType: 'SELECT_CARDS',
          prompt: `【${cardDef.name}】已抽1张牌，请选择我方战场1张角色获得 PP+2000：`,
          options: friendlyRoles.map((c) => this.createRoleChoiceOption(c)),
          effectType: 'BUFF_ROLE_PP',
          sourceCardInstanceId: cardInstanceId,
          metadata: { buffPP: 2000 },
          minSelections: 1,
          maxSelections: 1,
        });
      }
      return { success: true };
    }

    // 2. 灰鸦小队，集合！ (ST01-010): 公开牌组顶5张牌，选1张灰鸦小队角色加入手牌，其余牌组底
    if (cardNum === 'ST01-010' || cardDef.name.includes('灰鸦小队，集合')) {
      return this.revealTopAndSearch(playerId, {
        sourceCardInstanceId: cardInstanceId,
        cardName: cardDef.name,
        count: 5,
        prompt: `【${cardDef.name}】已公开牌组顶5张牌，请选择1张<灰鸦小队>角色加入手牌（其余卡牌将放置到牌组底）：`,
        promptNoEligible: `【${cardDef.name}】已公开牌组顶5张牌，其中没有<灰鸦小队>角色，请确认并将所有公开卡牌放置到牌组底：`,
        isEligible: (_c, d) => {
          if (!d || d.cardType !== CardType.ROLE) return false;
          const traits = d.traits || [];
          return traits.some((t) => t.includes('灰鸦')) || Boolean(d.name && d.name.includes('灰鸦'));
        },
        ineligibleReason: '非<灰鸦小队>角色',
        destination: 'HAND',
        remainingDestination: 'DECK_BOTTOM',
        minSelections: 1,
        maxSelections: 1,
        choiceEffectType: 'SEARCH_TOP_CARDS',
      });
    }

    // 3. 重逢 (ST01-011): 破坏对方战场1张PP<=8000角色
    if (cardNum === 'ST01-011' || cardDef.name.includes('重逢')) {
      const allOppRoles = this.getOpponentRoles(playerId);
      const eligibleOppRoles = allOppRoles.filter(
        (c) => this.ctx.fieldMgr.calculateRoleEffectivePP(c.instanceId) <= 8000
      );
      this.ctx.setPendingChoice({
        id: `choice-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        playerId,
        choiceType: 'SELECT_CARDS',
        prompt: `【${cardDef.name}】发动：请选择对方战场1张PP<=8000的角色进行破坏：`,
        options: allOppRoles.map((c) => {
          const pp = this.ctx.fieldMgr.calculateRoleEffectivePP(c.instanceId);
          const isEligible = pp <= 8000;
          return this.createRoleChoiceOption(c, {
            eligible: isEligible,
            ineligibleReason: !isEligible ? `PP(${pp})超过8000限制` : undefined,
          });
        }),
        effectType: 'DESTROY_ROLE',
        sourceCardInstanceId: cardInstanceId,
        metadata: {
          eligibleCardIds: eligibleOppRoles.map((c) => c.instanceId),
        },
        minSelections: 1,
        maxSelections: 1,
      });
      return { success: true };
    }

    // 4. 刹那制裁 (ST02-010): 对方1张角色按我方侵蚀计数每有1 PP-2000
    if (cardNum === 'ST02-010' || cardDef.name.includes('刹那制裁')) {
      const oppRoles = this.getOpponentRoles(playerId);
      this.ctx.setPendingChoice({
        id: `choice-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        playerId,
        choiceType: 'SELECT_CARDS',
        prompt: `【${cardDef.name}】发动：请选择对方战场1张角色，使其PP减少 (我方侵蚀计数 x 2000)：`,
        options: oppRoles.map((c) => this.createRoleChoiceOption(c)),
        effectType: 'REDUCE_PP_BY_EROSION',
        sourceCardInstanceId: cardInstanceId,
        minSelections: 1,
        maxSelections: 1,
      });
      return { success: true };
    }

    // 5. 筛选开始 (ST02-011): 墓地费用<=3角色出场
    if (cardNum === 'ST02-011' || cardDef.name.includes('筛选开始')) {
      const gyRoles = this.ctx.zoneMgr
        .getCardsInZone(playerId, 'GRAVEYARD')
        .filter((c) => {
          const d = this.getCardDef(c);
          return d?.cardType === CardType.ROLE && (d?.cost || 0) <= 3;
        });
      this.ctx.setPendingChoice({
        id: `choice-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        playerId,
        choiceType: 'SELECT_CARDS',
        prompt: `【${cardDef.name}】发动：请选择我方墓地1张费用<=3的角色出场：`,
        options: gyRoles.map((c) => this.createGeneralCardChoiceOption(c)),
        effectType: 'RESURRECT_ROLE',
        sourceCardInstanceId: cardInstanceId,
        minSelections: 1,
        maxSelections: 1,
      });
      return { success: true };
    }

    // 6. 暗域力场 (ST03-010): 抽2张牌，横置三头犬角色PP+1000
    if (cardNum === 'ST03-010' || cardDef.name.includes('暗域力场')) {
      this.ctx.zoneMgr.drawCards(playerId, 2);
      const friendlyRoles = this.getFriendlyRoles(playerId);
      for (const r of friendlyRoles) {
        if (!r.isReady) {
          r.tempPPBonus = (r.tempPPBonus || 0) + 1000;
        }
      }
      this.ctx.zoneMgr.moveCard(cardInstanceId, 'GRAVEYARD', { isFaceUp: true });
      return { success: true };
    }

    // 7. 三头犬出击 (ST03-011): 选择对方战场1张角色破坏
    if (cardNum === 'ST03-011' || cardDef.name.includes('三头犬出击')) {
      const oppRoles = this.getOpponentRoles(playerId);
      if (oppRoles.length === 0) {
        return { success: false, error: '对方战场没有可破坏的角色' };
      }
      this.ctx.setPendingChoice({
        id: `choice-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        playerId,
        choiceType: 'SELECT_CARDS',
        prompt: `【${cardDef.name}】发动：请选择对方战场1张角色进行破坏：`,
        options: oppRoles.map((c) => this.createRoleChoiceOption(c)),
        effectType: 'DESTROY_ROLE',
        sourceCardInstanceId: cardInstanceId,
        minSelections: 1,
        maxSelections: 1,
      });
      return { success: true };
    }

    // 8. 闪避充能 (BP01-012): 我方角色PP+1500
    if (cardNum === 'BP01-012' || cardDef.name.includes('闪避充能')) {
      const friendlyRoles = this.getFriendlyRoles(playerId);
      if (friendlyRoles.length === 0) {
        this.ctx.zoneMgr.moveCard(cardInstanceId, 'GRAVEYARD', { isFaceUp: true });
      } else if (friendlyRoles.length === 1 && friendlyRoles[0]) {
        friendlyRoles[0].tempPPBonus = (friendlyRoles[0].tempPPBonus || 0) + 1500;
        this.ctx.zoneMgr.moveCard(cardInstanceId, 'GRAVEYARD', { isFaceUp: true });
      } else {
        this.ctx.setPendingChoice({
          id: `choice-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          playerId,
          choiceType: 'SELECT_CARDS',
          prompt: `【${cardDef.name}】发动：请选择我方战场1张角色获得 PP+1500：`,
          options: friendlyRoles.map((c) => this.createRoleChoiceOption(c)),
          effectType: 'BUFF_ROLE_PP',
          sourceCardInstanceId: cardInstanceId,
          metadata: { buffPP: 1500 },
          minSelections: 1,
          maxSelections: 1,
        });
      }
      return { success: true };
    }

    // 9. 超算空间 (BP01-013): 抽2张牌
    if (cardNum === 'BP01-013' || cardDef.name.includes('超算空间')) {
      this.ctx.zoneMgr.drawCards(playerId, 2);
      this.ctx.zoneMgr.moveCard(cardInstanceId, 'GRAVEYARD', { isFaceUp: true });
      return { success: true };
    }

    // 通用战术默认处理 (抽牌、削弱、破坏、增益、检索等)
    return this.resolveUniversalTacticsEffect(playerId, cardInstanceId, cardDef);
  }

  // =========================================================================
  // 2. 角色登场效果处理【出】/【自】(出场时自动触发)
  // =========================================================================
  handleRoleEntryEffect(
    playerId: string,
    roleInstanceId: string,
    cardDef: CardVersionData
  ): void {
    const cardNum = cardDef.cardNumber;
    const roleCard = this.ctx.state.cards[roleInstanceId];
    if (!roleCard) return;

    // 1. BP01-001 (露西亚·鸦羽 8费): 【出】消除2同色信号球：公开我方牌组顶5张牌，选择其中任意数量的费用合计为6及以下的<灰鸦小队>角色出场，将剩余的牌按任意顺序放置到牌组底。
    if (cardNum === 'BP01-001' || cardDef.rulesText.includes('费用合计为6及以下的<灰鸦小队>角色出场')) {
      const orbs = this.ctx.zoneMgr.getCardsInZone(playerId, 'SIGNAL_ORB');
      if (orbs.length >= 2) {
        this.ctx.setPendingChoice({
          id: `choice-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          playerId,
          choiceType: 'SELECT_CARDS',
          prompt: `【${cardDef.name}】登场效果：可消除2个信号球以公开牌组顶5张召唤角色 (可跳过)：`,
          options: orbs.map((c) => this.createGeneralCardChoiceOption(c, { eligible: true })),
          effectType: 'BP01_001_ELIMINATE_ORBS_RECRUIT',
          sourceCardInstanceId: roleInstanceId,
          minSelections: 0,
          maxSelections: 2,
        });
        return;
      }
    }

    // 1b. Mock模式兼容：若规则文本包含“3张以上明费”，且明费达标，PP+500
    if (cardDef.rulesText.includes('3张以上明费')) {
      const openCostCount = this.ctx.zoneMgr
        .getCardsInZone(playerId, 'COST')
        .filter((c) => c.isFaceUp).length;
      if (openCostCount >= 3) {
        roleCard.tempPPBonus = (roleCard.tempPPBonus || 0) + 500;
        this.ctx.events.push({
          type: 'ABILITY_ACTIVATED',
          playerId,
          cardInstanceId: roleInstanceId,
          abilityName: `${cardDef.name} 明费加成`,
          rulesText: '出场时明费达标，PP+500',
        });
      }
    }

    // 2. BP01-002 (露西亚·鸦羽 7费): 【出】消除2同色信号球：直到回合结束为止，该牌获得【突进】及【充能0】
    if (cardNum === 'BP01-002' || cardDef.rulesText.includes('该牌获得【突进】及【充能0】')) {
      roleCard.grantedKeywords = roleCard.grantedKeywords || [];
      if (!roleCard.grantedKeywords.includes('突进')) roleCard.grantedKeywords.push('突进');
      this.ctx.events.push({
        type: 'ABILITY_ACTIVATED',
        playerId,
        cardInstanceId: roleInstanceId,
        abilityName: `${cardDef.name} 登场突进`,
        rulesText: '直到回合结束获得【突进】及【充能0】',
      });
    }

    // 2b. BP01-003 (露西亚·鸦羽 6费): 【出】：可以将我方战场1张<灰鸦小队>角色返回手牌。若如此做，选择战场1张费用为5及以下的角色，将其返回手牌。
    if (cardNum === 'BP01-003' || cardDef.rulesText.includes('可以将我方战场1张<灰鸦小队>角色返回手牌')) {
      const friendlyRoles = this.getFriendlyRoles(playerId);
      const grayRavenRoles = friendlyRoles.filter((c) => {
        const d = this.getCardDef(c);
        return d?.traits?.some((t) => t.includes('灰鸦')) || d?.name?.includes('灰鸦');
      });
      if (grayRavenRoles.length > 0) {
        this.ctx.setPendingChoice({
          id: `choice-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          playerId,
          choiceType: 'SELECT_CARDS',
          prompt: `【${cardDef.name}】登场：可选择我方战场1张<灰鸦小队>角色返回手牌，以回手战场1张<=5费角色 (可跳过)：`,
          options: friendlyRoles.map((c) => {
            const isEligible = grayRavenRoles.some((r) => r.instanceId === c.instanceId);
            return this.createRoleChoiceOption(c, {
              eligible: isEligible,
              ineligibleReason: !isEligible ? '非<灰鸦小队>角色' : undefined,
            });
          }),
          effectType: 'BP01_003_BOUNCE_STEP1',
          sourceCardInstanceId: roleInstanceId,
          minSelections: 0,
          maxSelections: 1,
        });
        return;
      }
    }

    // 2c. BP01-004 (露西亚·鸦羽 3费): 【出】丢弃1张手牌：选择我方费用区1张牌，将其加入手牌。
    if (cardNum === 'BP01-004' || (cardDef.rulesText.includes('丢弃1张手牌') && cardDef.rulesText.includes('选择我方费用区1张牌，将其加入手牌'))) {
      const hand = this.ctx.zoneMgr.getCardsInZone(playerId, 'HAND');
      if (hand.length > 0) {
        this.ctx.setPendingChoice({
          id: `choice-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          playerId,
          choiceType: 'SELECT_CARDS',
          prompt: `【${cardDef.name}】登场：可丢弃1张手牌，从费用区回收1张卡牌 (可跳过)：`,
          options: hand.map((c) => this.createGeneralCardChoiceOption(c)),
          effectType: 'BP01_004_DISCARD_RECOVER_COST',
          sourceCardInstanceId: roleInstanceId,
          minSelections: 0,
          maxSelections: 1,
        });
        return;
      }
    }

    // 2d. BP01-008 (露娜·银冕 7费): 【出】消除2同色信号球：选择对方战场1张角色，将其以横置状态放置到对方费用区。
    if (cardNum === 'BP01-008' || cardDef.rulesText.includes('将其以横置状态放置到对方费用区')) {
      const oppRoles = this.getOpponentRoles(playerId);
      if (oppRoles.length > 0) {
        this.ctx.setPendingChoice({
          id: `choice-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          playerId,
          choiceType: 'SELECT_CARDS',
          prompt: `【${cardDef.name}】登场：请选择对方战场1张角色，以横置状态放置到对方费用区：`,
          options: oppRoles.map((c) => this.createRoleChoiceOption(c)),
          effectType: 'SEND_ROLE_TO_COST',
          sourceCardInstanceId: roleInstanceId,
          minSelections: 1,
          maxSelections: 1,
        });
        return;
      }
    }

    // 2e. BP01-011 (露娜·银冕 6费): 【出】消除2同色信号球：选择我方墓地1张费用为4及以下的<升格者>角色，将其出场。
    if (cardNum === 'BP01-011' || cardDef.rulesText.includes('选择我方墓地1张费用为4及以下的<升格者>角色，将其出场')) {
      const gyRoles = this.ctx.zoneMgr.getCardsInZone(playerId, 'GRAVEYARD').filter((c) => {
        const d = this.getCardDef(c);
        return (
          d?.cardType === CardType.ROLE &&
          (d?.cost || 0) <= 4 &&
          (d?.traits?.some((t) => t.includes('升格')) || d?.name?.includes('露娜'))
        );
      });
      if (gyRoles.length > 0 && this.ctx.fieldMgr.findFirstEmptySlot(playerId) !== undefined) {
        this.ctx.setPendingChoice({
          id: `choice-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          playerId,
          choiceType: 'SELECT_CARDS',
          prompt: `【${cardDef.name}】登场：请选择我方墓地1张<=4费的<升格者>角色出场：`,
          options: gyRoles.map((c) => this.createGeneralCardChoiceOption(c)),
          effectType: 'RESURRECT_ROLE',
          sourceCardInstanceId: roleInstanceId,
          minSelections: 1,
          maxSelections: 1,
        });
        return;
      }
    }

    // 2f. BP01-007 (比安卡·零度): 出场时若我方战场角色为3张以上，抽1张牌
    if (cardDef.rulesText.includes('角色为3张以上，抽1张牌')) {
      const roles = this.getFriendlyRoles(playerId);
      if (roles.length >= 3) {
        this.ctx.zoneMgr.drawCards(playerId, 1);
        this.ctx.events.push({
          type: 'ABILITY_ACTIVATED',
          playerId,
          cardInstanceId: roleInstanceId,
          abilityName: `${cardDef.name} 阵列抽牌`,
          rulesText: '出场时战场角色达到3张，抽1张牌',
        });
      }
    }

    // 3. ST01-003 (丽芙·蚀暗): 选择我方墓地1张信号球，将其放置到我方信号球区最上方
    if (cardNum === 'ST01-003' || (cardDef.rulesText.includes('选择我方墓地1张信号球') && cardDef.rulesText.includes('【出】'))) {
      const gyOrb = this.ctx.zoneMgr
        .getCardsInZone(playerId, 'GRAVEYARD')
        .find((c) => {
          const d = this.getCardDef(c);
          return !!d?.signalOrb || c.cardNumber.startsWith('ORB-') || d?.name?.includes('信号球');
        });
      if (gyOrb) {
        this.ctx.zoneMgr.moveCard(gyOrb.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
        this.ctx.events.push({
          type: 'ABILITY_ACTIVATED',
          playerId,
          cardInstanceId: roleInstanceId,
          abilityName: `${cardDef.name} 信号球回收`,
          rulesText: '从墓地将1张信号球放置到信号球区最上方',
        });
      }
    }

    // 4. ST01-005 (露西亚·红莲): 【出】：抽1张牌，丢弃1张手牌
    if (cardNum === 'ST01-005' || cardDef.rulesText.includes('抽1张牌，丢弃1张手牌')) {
      this.ctx.zoneMgr.drawCards(playerId, 1);
      const handCards = this.ctx.zoneMgr.getCardsInZone(playerId, 'HAND');
      if (handCards.length > 0) {
        this.ctx.setPendingChoice({
          id: `choice-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          playerId,
          choiceType: 'SELECT_CARDS',
          prompt: `【${cardDef.name}】出场抽牌已完成，请选择1张手牌丢弃到墓地：`,
          options: handCards.map((c) => this.createGeneralCardChoiceOption(c)),
          effectType: 'DISCARD_HAND_CARD',
          sourceCardInstanceId: roleInstanceId,
          minSelections: 1,
          maxSelections: 1,
        });
      }
    }

    // 5. ST01-002 (里·异火): 【出】：可以将我方牌组顶3张牌放置到墓地，若有信号球，选择我方战场1张<灰鸦小队>角色获得充能+1 (PP+1000)
    if (cardNum === 'ST01-002' || (cardDef.rulesText.includes('牌组顶3张牌放置到墓地') && cardDef.rulesText.includes('若其中有信号球'))) {
      this.revealTopAndSearch(playerId, {
        sourceCardInstanceId: roleInstanceId,
        cardName: cardDef.name,
        count: 3,
        prompt: `【${cardDef.name}】出场：已翻开牌组顶3张牌，请检视确认：`,
        promptNoEligible: `【${cardDef.name}】已翻开牌组顶3张牌（未检测到信号球牌）：未能满足充能+1条件。请检视确认，翻开的卡牌将全部送入墓地：`,
        choiceEffectType: 'ST01_002_INSPECT_ORB',
        destination: 'GRAVEYARD',
        remainingDestination: 'GRAVEYARD',
        minSelections: 0,
        maxSelections: 0,
      });
      return;
    }

    // 6. ST01-001 (露西亚·红莲 5费): 丢弃1张手牌，公开牌组顶5张召唤<=3费灰鸦小队角色
    if (cardNum === 'ST01-001' && cardDef.rulesText.includes('丢弃1张手牌：公开我方牌组顶5张牌')) {
      const handCards = this.ctx.zoneMgr.getCardsInZone(playerId, 'HAND');
      if (handCards.length > 0) {
        this.ctx.setPendingChoice({
          id: `choice-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          playerId,
          choiceType: 'SELECT_CARDS',
          prompt: `【${cardDef.name}】登场能力：可选择1张手牌丢弃以公开牌组顶5张召唤角色 (可跳过)：`,
          options: handCards.map((c) => this.createGeneralCardChoiceOption(c)),
          effectType: 'ST01_001_DISCARD_RECRUIT',
          sourceCardInstanceId: roleInstanceId,
          minSelections: 0,
          maxSelections: 1,
        });
        return;
      }
    }

    // 7. ST02-003 (露娜·银冕 4费): 丢弃1张手牌，公开牌组顶3张选择升格者加入手牌，剩余送墓
    if (cardNum === 'ST02-003' || (cardDef.rulesText.includes('公开我方牌组顶3张牌') && cardDef.rulesText.includes('升格者'))) {
      const handCards = this.ctx.zoneMgr.getCardsInZone(playerId, 'HAND');
      if (handCards.length > 0) {
        this.ctx.setPendingChoice({
          id: `choice-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          playerId,
          choiceType: 'SELECT_CARDS',
          prompt: `【${cardDef.name}】登场能力：可丢弃1张手牌公开牌组顶3张检索<升格者>角色 (可跳过)：`,
          options: handCards.map((c) => this.createGeneralCardChoiceOption(c)),
          effectType: 'ST02_003_DISCARD_SEARCH',
          sourceCardInstanceId: roleInstanceId,
          minSelections: 0,
          maxSelections: 1,
        });
        return;
      }
    }

    // 8. ST02-007 (不明构造体α 3费): 丢弃1张手牌，选择墓地1张升格者加入手牌
    if (cardNum === 'ST02-007' || cardDef.rulesText.includes('选择我方墓地1张<升格者>角色，将其加入手牌')) {
      const handCards = this.ctx.zoneMgr.getCardsInZone(playerId, 'HAND');
      const gyRoles = this.ctx.zoneMgr
        .getCardsInZone(playerId, 'GRAVEYARD')
        .filter((c) => {
          const d = this.getCardDef(c);
          return (
            d?.cardType === CardType.ROLE &&
            (d?.traits?.some((t) => t.includes('升格者')) ||
              ['露娜', '罗兰', '加百列', '阿尔法'].some((k) => d.name.includes(k)))
          );
        });
      if (handCards.length > 0 && gyRoles.length > 0) {
        this.ctx.setPendingChoice({
          id: `choice-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          playerId,
          choiceType: 'SELECT_CARDS',
          prompt: `【${cardDef.name}】登场能力：可丢弃1张手牌从墓地回收1张<升格者>角色 (可跳过)：`,
          options: handCards.map((c) => this.createGeneralCardChoiceOption(c)),
          effectType: 'ST02_007_DISCARD_SALVAGE',
          sourceCardInstanceId: roleInstanceId,
          minSelections: 0,
          maxSelections: 1,
        });
        return;
      }
    }

    // 9. ST03-001 (薇拉·瑰丽 8费): 消除2同色信号球，选择三头犬角色竖直且全队PP+2000
    if (cardNum === 'ST03-001' || cardDef.rulesText.includes('消除2同色信号球')) {
      const orbs = this.ctx.zoneMgr.getCardsInZone(playerId, 'SIGNAL_ORB');
      if (orbs.length >= 2 && orbs[0] && orbs[1]) {
        this.ctx.zoneMgr.moveCard(orbs[0].instanceId, 'GRAVEYARD', { isFaceUp: true });
        this.ctx.zoneMgr.moveCard(orbs[1].instanceId, 'GRAVEYARD', { isFaceUp: true });
        roleCard.isReady = true;
        for (const r of this.getFriendlyRoles(playerId)) {
          r.tempPPBonus = (r.tempPPBonus || 0) + 2000;
        }
        this.ctx.events.push({
          type: 'ABILITY_ACTIVATED',
          playerId,
          cardInstanceId: roleInstanceId,
          abilityName: `${cardDef.name} 信号激荡`,
          rulesText: '消除2信号球，全队PP+2000且竖直就绪',
        });
      }
    }

    // 10. ST03-003 (薇拉·瑰丽 4费): 消除信号球或丢弃手牌，公开牌组顶5张牌，选最多2张加入手牌，剩余送墓
    if (cardNum === 'ST03-003' || cardDef.rulesText.includes('公开我方牌组顶5张牌。选择其中最多1张<21号>')) {
      const handCards = this.ctx.zoneMgr.getCardsInZone(playerId, 'HAND');
      const orbs = this.ctx.zoneMgr.getCardsInZone(playerId, 'SIGNAL_ORB');
      const costOptions = [
        ...handCards.map((c) => ({
          ...this.createGeneralCardChoiceOption(c),
          label: `[丢弃手牌] ${this.getCardDef(c)?.name || c.cardNumber}`,
        })),
        ...orbs.map((c) => ({
          ...this.createGeneralCardChoiceOption(c),
          label: `[消除信号球] ${this.getCardDef(c)?.name || c.cardNumber}`,
        })),
      ];
      if (costOptions.length > 0) {
        this.ctx.setPendingChoice({
          id: `choice-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          playerId,
          choiceType: 'SELECT_CARDS',
          prompt: `【${cardDef.name}】登场能力：消除任意信号球或丢弃1张手牌以公开顶5张牌 (可跳过)：`,
          options: costOptions,
          effectType: 'ST03_003_PAY_COST_SEARCH',
          sourceCardInstanceId: roleInstanceId,
          minSelections: 0,
          maxSelections: 1,
        });
        return;
      }
    }

    // 10b. ST04-003 (库洛姆·荣光 8费): 【出】：公开我方牌组顶7张牌，选择其中最多1张《荣光护盾》加入手牌，将剩余的牌加入牌组并洗切。
    if (cardNum === 'ST04-003' || cardDef.rulesText.includes('选择其中最多1张《荣光护盾》加入手牌')) {
      this.revealTopAndSearch(playerId, {
        sourceCardInstanceId: roleInstanceId,
        cardName: cardDef.name,
        count: 7,
        prompt: `【${cardDef.name}】出场：请选择最多1张《荣光护盾》加入手牌：`,
        promptNoEligible: `公开卡牌中未检出《荣光护盾》，点击确认将所有卡牌洗入牌组：`,
        isEligible: (_c, d) => !!d?.name?.includes('荣光护盾'),
        ineligibleReason: '非《荣光护盾》',
        destination: 'HAND',
        remainingDestination: 'SHUFFLE_DECK',
        minSelections: 0,
        maxSelections: 1,
      });
      return;
    }

    // 10c. ST06-005 (亚里莎·回音 4费): 【出】丢弃1张手牌：公开我方牌组顶5张牌，选择其中1张费用为4及以下的<亚里莎>角色或<塞西莉>角色出场，将剩余的牌加入牌组并洗切。
    if (cardNum === 'ST06-005' || cardDef.rulesText.includes('费用为4及以下的<亚里莎>角色或<塞西莉>角色出场')) {
      const handCards = this.ctx.zoneMgr.getCardsInZone(playerId, 'HAND');
      if (handCards.length > 0) {
        this.ctx.setPendingChoice({
          id: `choice-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          playerId,
          choiceType: 'SELECT_CARDS',
          prompt: `【${cardDef.name}】登场能力：可丢弃1张手牌公开牌组顶5张召唤角色 (可跳过)：`,
          options: handCards.map((c) => this.createGeneralCardChoiceOption(c)),
          effectType: 'ST06_005_DISCARD_RECRUIT',
          sourceCardInstanceId: roleInstanceId,
          minSelections: 0,
          maxSelections: 1,
        });
        return;
      }
    }

    // 11. BP01-003 (丽芙·蚀暗 2费): 查看牌组顶3张牌，选1张道具牌加入手牌
    if (cardNum === 'BP01-003' || cardDef.rulesText.includes('查看我方牌组顶3张卡牌，可将其中的1张道具牌加入手牌')) {
      this.revealTopAndSearch(playerId, {
        sourceCardInstanceId: roleInstanceId,
        cardName: cardDef.name,
        count: 3,
        prompt: `【${cardDef.name}】出场：请选择1张战术/道具牌加入手牌：`,
        promptNoEligible: `公开卡牌中未检出战术/道具牌，点击确认放置到牌组底：`,
        isEligible: (_c, d) => Boolean(d?.cardType === CardType.TACTICS || d?.cardType === CardType.EQUIPMENT),
        ineligibleReason: '非战术/道具牌',
        destination: 'HAND',
        remainingDestination: 'DECK_BOTTOM',
        minSelections: 0,
        maxSelections: 1,
      });
      return;
    }

    // 通用【出】效果解析与自动触发
    this.resolveUniversalEntryEffect(playerId, roleInstanceId, cardDef);
  }

  // =========================================================================
  // 3. 装备卡与辅助机生效处理
  // =========================================================================
  handleEquipmentBuff(targetRoleId: string, equipDef: CardVersionData): void {
    const roleCard = this.ctx.state.cards[targetRoleId];
    if (!roleCard) return;

    // 动态提取装备卡的 PP/DP 增益 (20张装备卡自适应)
    const ppMatch = equipDef.rulesText.match(/PP\+(\d+)/);
    if (ppMatch && ppMatch[1]) {
      roleCard.tempPPBonus = (roleCard.tempPPBonus || 0) + parseInt(ppMatch[1], 10);
    }
    const dpMatch = equipDef.rulesText.match(/DP\+(\d+)/);
    if (dpMatch && dpMatch[1]) {
      roleCard.tempDPBonus = (roleCard.tempDPBonus || 0) + parseInt(dpMatch[1], 10);
    }

    if (equipDef.cardNumber === 'BP01-010' || equipDef.name.includes('红莲狂士')) {
      if (!ppMatch) roleCard.tempPPBonus = (roleCard.tempPPBonus || 0) + 500;
    }
  }

  handleAssistBuff(playerId: string, assistDef: CardVersionData): void {
    if (assistDef.cardNumber === 'BP01-011' || assistDef.name.includes('辅助机·凌鹤')) {
      const friendlyRoles = this.getFriendlyRoles(playerId);
      for (const r of friendlyRoles) {
        r.tempPPBonus = (r.tempPPBonus || 0) + 500;
      }
    }
  }

  // =========================================================================
  // 4. 起动能力【起】处理
  // =========================================================================
  handleActivateAbility(
    playerId: string,
    sourceCardId: string,
    cardDef: CardVersionData
  ): { success: boolean; error?: string } {
    const card = this.ctx.state.cards[sourceCardId];
    if (!card) return { success: false, error: '未找到来源卡牌' };

    const cardNum = cardDef.cardNumber || cardDef.id;

    // 1. BP01-004 (里·异火): 【起】【1费】: 对对方战场的1张角色造成1000点效果伤害
    if (cardNum === 'BP01-004' || cardDef.rulesText.includes('造成1000点效果伤害')) {
      const oppRoles = this.getOpponentRoles(playerId);
      if (oppRoles.length === 0) {
        return { success: false, error: '对方战场没有可指定的目标角色' };
      }
      this.ctx.setPendingChoice({
        id: `choice-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        playerId,
        choiceType: 'SELECT_CARDS',
        prompt: `【${cardDef.name}】起动能力：请选择对方战场1张角色造成1000点效果伤害：`,
        options: oppRoles.map((c) => this.createRoleChoiceOption(c)),
        effectType: 'DEAL_DAMAGE_TO_ROLE',
        sourceCardInstanceId: sourceCardId,
        metadata: { damage: 1000 },
        minSelections: 1,
        maxSelections: 1,
      });
      return { success: true };
    }

    // 2. ST02-008 (苦刑之女): 【起】[费用1]：可以将我方侵蚀计数+1，直到回合结束DP+1
    if (cardNum === 'ST02-008' || cardDef.rulesText.includes('侵蚀计数+1。若如此做，直到回合结束为止，该牌DP+1')) {
      const p = this.ctx.state.players[playerId];
      if (p) p.erosionCount += 1;
      card.tempDPBonus = (card.tempDPBonus || 0) + 1;
      this.ctx.events.push({
        type: 'ABILITY_ACTIVATED',
        playerId,
        cardInstanceId: sourceCardId,
        abilityName: `${cardDef.name} 苦刑狂化`,
        rulesText: '侵蚀计数+1，该角色直到回合结束DP+1',
      });
      return { success: true };
    }

    // 3. ST02-001 (露娜·银冕): 【起】[费用2]：选择我方墓地1张费用<=4的<升格者>角色出场
    if (cardNum === 'ST02-001' || cardDef.rulesText.includes('选择我方墓地1张费用为4及以下的<升格者>角色，将其出场')) {
      const gyRoles = this.ctx.zoneMgr
        .getCardsInZone(playerId, 'GRAVEYARD')
        .filter((c) => {
          const d = this.getCardDef(c);
          return d?.cardType === CardType.ROLE && (d?.cost || 0) <= 4;
        });
      if (gyRoles.length === 0) {
        return { success: false, error: '我方墓地没有费用为4及以下的角色' };
      }
      if (this.ctx.fieldMgr.findFirstEmptySlot(playerId) === undefined) {
        return { success: false, error: '战场没有空余卡位' };
      }
      this.ctx.setPendingChoice({
        id: `choice-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        playerId,
        choiceType: 'SELECT_CARDS',
        prompt: `【${cardDef.name}】起动能力：请选择我方墓地1张费用<=4的角色特殊出场：`,
        options: gyRoles.map((c) => this.createGeneralCardChoiceOption(c)),
        effectType: 'RESURRECT_ROLE',
        sourceCardInstanceId: sourceCardId,
        minSelections: 1,
        maxSelections: 1,
      });
      return { success: true };
    }

    // 4. ST01-001 (露西亚·红莲): 【起】消除【2蓝色信号球】：选择我方战场1张角色返回手牌。若如此做，选择我方手牌1张费用为4及以下的<灰鸦小队>角色出场
    if (cardNum === 'ST01-001' && cardDef.rulesText.includes('选择我方战场1张角色返回手牌')) {
      const orbs = this.ctx.zoneMgr.getCardsInZone(playerId, 'SIGNAL_ORB');
      const blueOrbs = orbs.filter((c) => {
        const d = this.getCardDef(c);
        return d?.signalOrb === 'BLUE' || c.cardNumber.includes('BLUE') || d?.name?.includes('蓝');
      });
      if (blueOrbs.length >= 2) {
        this.ctx.setPendingChoice({
          id: `choice-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          playerId,
          choiceType: 'SELECT_CARDS',
          prompt: `【${cardDef.name}】起动能力：请选择消除2个蓝色信号球：`,
          options: blueOrbs.map((c) => this.createGeneralCardChoiceOption(c, { eligible: true })),
          effectType: 'ST01_001_ACTIVATE_ELIMINATE_ORBS',
          sourceCardInstanceId: sourceCardId,
          minSelections: 2,
          maxSelections: 2,
        });
        return { success: true };
      }
      return { success: false, error: '蓝色信号球不足2个，无法发动该起动能力' };
    }

    // 5. ST03-002 (薇拉·瑰丽): 【起】横置该牌：下1张<三头犬小队>角色费用-2
    if (cardNum === 'ST03-002' || cardDef.rulesText.includes('使用的下1张<三头犬小队>角色的费用-2')) {
      const player = this.ctx.state.players[playerId];
      if (player) {
        if (!player.costModifiers) player.costModifiers = [];
        player.costModifiers.push({
          id: `cost-mod-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          amount: 2,
          targetTrait: '三头犬小队',
          cardType: CardType.ROLE,
          excludeAscension: true,
          remainingCount: 1,
        });
      }

      this.ctx.events.push({
        type: 'ABILITY_ACTIVATED',
        playerId,
        cardInstanceId: sourceCardId,
        abilityName: `${cardDef.name} 狂咲支援`,
        rulesText: '横置该牌：直到回合结束为止，我方使用的下1张<三头犬小队>角色的费用-2（不包含升变费用）。',
      });
      return { success: true };
    }

    // 6. ST03-008 (21号·XXI): 【起】横置该牌：下1张<薇拉>角色费用-1
    if (cardNum === 'ST03-008' || cardDef.rulesText.includes('使用的下1张<薇拉>角色的费用-1')) {
      const player = this.ctx.state.players[playerId];
      if (player) {
        if (!player.costModifiers) player.costModifiers = [];
        player.costModifiers.push({
          id: `cost-mod-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          amount: 1,
          targetTrait: '薇拉',
          cardType: CardType.ROLE,
          excludeAscension: true,
          remainingCount: 1,
        });
      }

      this.ctx.events.push({
        type: 'ABILITY_ACTIVATED',
        playerId,
        cardInstanceId: sourceCardId,
        abilityName: `${cardDef.name} 牵引引流`,
        rulesText: '横置该牌：直到回合结束为止，我方使用的下1张<薇拉>角色的费用-1。',
      });
      return { success: true };
    }

    // 6b. ST04-007 (神威·重能 6费): 【起】横置该牌：公开我方牌组顶5张牌，选1张突击鹰小队加入手牌，剩余牌组底，那之后弃1手牌
    if (cardNum === 'ST04-007' || (cardDef.rulesText.includes('公开我方牌组顶5张牌') && cardDef.rulesText.includes('突击鹰小队'))) {
      return this.revealTopAndSearch(playerId, {
        sourceCardInstanceId: sourceCardId,
        cardName: cardDef.name,
        count: 5,
        prompt: `【${cardDef.name}】起动能力：请选择1张<突击鹰小队>角色加入手牌：`,
        promptNoEligible: `公开卡牌中未检出<突击鹰小队>角色，点击确认放置到牌组底：`,
        isEligible: (_c, d) => {
          if (!d || d.cardType !== CardType.ROLE) return false;
          const traits = d.traits || [];
          return traits.some((t) => t.includes('突击鹰')) || ['库洛姆', '神威', '万事'].some((k) => d.name.includes(k));
        },
        ineligibleReason: '非<突击鹰小队>角色',
        destination: 'HAND',
        remainingDestination: 'DECK_BOTTOM',
        minSelections: 1,
        maxSelections: 1,
      });
    }

    // 7. BP01-010 (露娜·银冕 5费): 【起】【回合1】丢弃1张手牌：选择我方费用区1张牌放置到墓地，将我方牌组顶1张牌放置到费用区
    if (cardNum === 'BP01-010' || cardDef.rulesText.includes('选择我方费用区1张牌放置到墓地，将我方牌组顶1张牌放置到费用区')) {
      const handCards = this.ctx.zoneMgr.getCardsInZone(playerId, 'HAND');
      if (handCards.length === 0) {
        return { success: false, error: '手牌不足，无法支付弃牌代价' };
      }
      this.ctx.setPendingChoice({
        id: `choice-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        playerId,
        choiceType: 'SELECT_CARDS',
        prompt: `【${cardDef.name}】起动能力：请选择1张手牌丢弃作为代价：`,
        options: handCards.map((c) => this.createGeneralCardChoiceOption(c, { eligible: true })),
        effectType: 'BP01_010_DISCARD_COST',
        sourceCardInstanceId: sourceCardId,
        minSelections: 1,
        maxSelections: 1,
      });
      return { success: true };
    }

    // 8. BP01-014 / BP01-016 (露西亚·深红囚影): 【起】【回合1】：选择我方墓地1张<封刃太刀>或<大太刀>装备，将其装备
    if (
      cardNum === 'BP01-014' ||
      cardNum === 'BP01-016' ||
      cardDef.rulesText.includes('选择我方墓地1张<大太刀>装备，将其装备') ||
      cardDef.rulesText.includes('选择我方墓地1张<封刃太刀>装备，将其装备')
    ) {
      const gyEquips = this.ctx.zoneMgr
        .getCardsInZone(playerId, 'GRAVEYARD')
        .filter((c) => {
          const d = this.getCardDef(c);
          return (
            d?.cardType === CardType.EQUIPMENT ||
            d?.name?.includes('太刀') ||
            d?.traits?.some((t) => t.includes('太刀'))
          );
        });
      if (gyEquips.length > 0) {
        this.ctx.setPendingChoice({
          id: `choice-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          playerId,
          choiceType: 'SELECT_CARDS',
          prompt: `【${cardDef.name}】起动能力：请选择我方墓地1张太刀装备附着：`,
          options: gyEquips.map((c) => this.createGeneralCardChoiceOption(c, { eligible: true })),
          effectType: 'EQUIP_FROM_GRAVEYARD',
          sourceCardInstanceId: sourceCardId,
          minSelections: 1,
          maxSelections: 1,
        });
        return { success: true };
      }
    }

    // 9. BP01-040 (七实·遥星之座 8费): 【起】【回合1】丢弃1张手牌：选择我方墓地1张《帕瓦》，将其放置到该牌下方
    if (cardNum === 'BP01-040' || cardDef.rulesText.includes('选择我方墓地1张《帕瓦》，将其放置到该牌下方')) {
      const handCards = this.ctx.zoneMgr.getCardsInZone(playerId, 'HAND');
      const gyPawa = this.ctx.zoneMgr.getCardsInZone(playerId, 'GRAVEYARD').filter((c) => {
        const d = this.getCardDef(c);
        return d?.name?.includes('帕瓦');
      });
      if (handCards.length === 0) {
        return { success: false, error: '手牌不足，无法支付弃牌代价' };
      }
      if (gyPawa.length === 0) {
        return { success: false, error: '墓地没有《帕瓦》卡牌' };
      }
      this.ctx.setPendingChoice({
        id: `choice-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        playerId,
        choiceType: 'SELECT_CARDS',
        prompt: `【${cardDef.name}】起动能力：请选择1张手牌丢弃作为代价：`,
        options: handCards.map((c) => this.createGeneralCardChoiceOption(c, { eligible: true })),
        effectType: 'BP01_040_DISCARD_ATTACH_PAWA',
        sourceCardInstanceId: sourceCardId,
        minSelections: 1,
        maxSelections: 1,
      });
      return { success: true };
    }

    // 10. BP01-049 ~ BP01-052 (帕瓦): 【起】：选择我方战场1张《七实·遥星之座》，将竖直状态的该牌放置到其下方
    if (cardDef.rulesText.includes('选择我方战场1张《七实·遥星之座》，将竖直状态的该牌放置到其下方')) {
      const nanamiRoles = this.getFriendlyRoles(playerId).filter((c) => {
        const d = this.getCardDef(c);
        return d?.name?.includes('七实');
      });
      if (nanamiRoles.length > 0) {
        this.ctx.setPendingChoice({
          id: `choice-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          playerId,
          choiceType: 'SELECT_CARDS',
          prompt: `【${cardDef.name}】起动能力：请选择我方战场1张《七实·遥星之座》将该牌放置到其下方：`,
          options: nanamiRoles.map((c) => this.createRoleChoiceOption(c)),
          effectType: 'ATTACH_UNDERNEATH',
          sourceCardInstanceId: sourceCardId,
          minSelections: 1,
          maxSelections: 1,
        });
        return { success: true };
      }
    }

    // 11. BP01-076 (卡穆·狂犬): 【起】将该牌从战场放置到牌组底：选择我方墓地1张<突击鹰小队>角色，将其加入手牌
    if (cardNum === 'BP01-076' || cardDef.rulesText.includes('选择我方墓地1张<突击鹰小队>角色，将其加入手牌')) {
      this.ctx.fieldMgr.handleCardLeaveField(sourceCardId);
      this.ctx.zoneMgr.moveCardToBottomOfDeck(sourceCardId);
      const gyRoles = this.ctx.zoneMgr.getCardsInZone(playerId, 'GRAVEYARD').filter((c) => {
        const d = this.getCardDef(c);
        return d?.cardType === CardType.ROLE && (d?.traits?.some((t) => t.includes('突击鹰')) || d?.name?.includes('神威') || d?.name?.includes('库洛姆'));
      });
      if (gyRoles.length > 0) {
        this.ctx.setPendingChoice({
          id: `choice-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          playerId,
          choiceType: 'SELECT_CARDS',
          prompt: `【${cardDef.name}】起动能力：卡穆已回牌组底！请选择墓地1张<突击鹰小队>角色回收至手牌：`,
          options: gyRoles.map((c) => this.createGeneralCardChoiceOption(c)),
          effectType: 'SALVAGE_TO_HAND',
          sourceCardInstanceId: sourceCardId,
          minSelections: 1,
          maxSelections: 1,
        });
        return { success: true };
      }
    }

    return this.resolveUniversalActivatedEffect(playerId, sourceCardId, cardDef);
  }

  // =========================================================================
  // 5. 玩家决策确认与执行 (SELECT_CHOICE_OPTION)
  // =========================================================================
  handleChoiceResolution(
    action: Extract<GameAction, { type: 'SELECT_CHOICE_OPTION' }>,
    choice: PendingChoice
  ): { success: boolean; error?: string } {
    const selectedIds = action.selectedIds || (action as any).selectedOptionIds || [];
    const playerId = action.playerId;
    const player = this.ctx.state.players[playerId];

    switch (choice.effectType) {
      // 专武信号球二选一 / 充能自
      case 'SIGNATURE_MOVE_EFFECT': {
        const option = selectedIds[0];
        if (option === 'opt_draw_1') {
          this.ctx.zoneMgr.drawCards(playerId, 1);
        } else if (option === 'opt_erosion_minus_1') {
          const oppId = this.getOpponentPlayerId(playerId);
          const opp = this.ctx.state.players[oppId];
          if (player && opp && player.erosionCount >= opp.erosionCount && player.erosionCount > 0) {
            player.erosionCount -= 1;
          }
        } else if (option === 'opt_dp_plus_1') {
          const friendlyRoles = this.getFriendlyRoles(playerId);
          const directTargetId = selectedIds[1] || (action as any).targetCardId;
          const directTarget = directTargetId ? friendlyRoles.find((r) => r.instanceId === directTargetId) : undefined;
          if (directTarget) {
            directTarget.tempDPBonus = (directTarget.tempDPBonus || 0) + 1;
          } else if (friendlyRoles.length > 0) {
            this.ctx.setPendingChoice({
              id: `choice-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              playerId,
              choiceType: 'SELECT_CARDS',
              prompt: `【${choice.metadata?.cardName || choice.metadata?.cardNumber || '信号球'}】充能自：请选择我方战场最多1张角色（直到回合结束 DP+1）：`,
              options: friendlyRoles.map((r) => {
                const def = this.getCardDef(r);
                return {
                  id: r.instanceId,
                  label: `${def?.name || r.cardNumber} (卡位 ${(r.slotIndex ?? 0) + 1})`,
                  payload: {
                    cardNumber: r.cardNumber,
                    name: def?.name,
                    cardType: def?.cardType,
                    attribute: def?.attribute,
                    basePP: r.tempPPBonus ? (def?.basePP || 0) + r.tempPPBonus : def?.basePP,
                    baseDP: r.tempDPBonus ? (def?.baseDP || 0) + r.tempDPBonus : def?.baseDP,
                    slotIndex: r.slotIndex,
                    imageUrl: r.imageUrl || def?.imageUrl,
                    eligible: true,
                  },
                };
              }),
              effectType: 'SELECT_ROLE_FOR_CHARGE_BUFF',
              sourceCardInstanceId: choice.sourceCardInstanceId,
              metadata: {
                buffType: 'DP',
                buffAmount: 1,
                cardName: choice.metadata?.cardName || choice.metadata?.cardNumber || '信号球',
              },
              minSelections: 0,
              maxSelections: 1,
            });
          }
        } else if (option === 'opt_pp_plus_2000') {
          const friendlyRoles = this.getFriendlyRoles(playerId);
          const directTargetId = selectedIds[1] || (action as any).targetCardId;
          const directTarget = directTargetId ? friendlyRoles.find((r) => r.instanceId === directTargetId) : undefined;
          if (directTarget) {
            directTarget.tempPPBonus = (directTarget.tempPPBonus || 0) + 2000;
          } else if (friendlyRoles.length > 0) {
            this.ctx.setPendingChoice({
              id: `choice-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              playerId,
              choiceType: 'SELECT_CARDS',
              prompt: `【${choice.metadata?.cardName || choice.metadata?.cardNumber || '信号球'}】充能自：请选择我方战场最多1张角色（直到回合结束 PP+2000）：`,
              options: friendlyRoles.map((r) => {
                const def = this.getCardDef(r);
                return {
                  id: r.instanceId,
                  label: `${def?.name || r.cardNumber} (卡位 ${(r.slotIndex ?? 0) + 1})`,
                  payload: {
                    cardNumber: r.cardNumber,
                    name: def?.name,
                    cardType: def?.cardType,
                    attribute: def?.attribute,
                    basePP: r.tempPPBonus ? (def?.basePP || 0) + r.tempPPBonus : def?.basePP,
                    baseDP: r.tempDPBonus ? (def?.baseDP || 0) + r.tempDPBonus : def?.baseDP,
                    slotIndex: r.slotIndex,
                    imageUrl: r.imageUrl || def?.imageUrl,
                    eligible: true,
                  },
                };
              }),
              effectType: 'SELECT_ROLE_FOR_CHARGE_BUFF',
              sourceCardInstanceId: choice.sourceCardInstanceId,
              metadata: {
                buffType: 'PP',
                buffAmount: 2000,
                cardName: choice.metadata?.cardName || choice.metadata?.cardNumber || '信号球',
              },
              minSelections: 0,
              maxSelections: 1,
            });
          }
        } else if (option === 'opt_grant_sugong_chaoke') {
          const target = this.getFriendlyRoles(playerId).find((r) => this.getCardDef(r)?.name.includes('超刻'));
          if (target) {
            target.grantedKeywords = target.grantedKeywords || [];
            if (!target.grantedKeywords.includes('速攻')) target.grantedKeywords.push('速攻');
          }
        } else if (option === 'opt_ready_chaoke') {
          const target = this.getFriendlyRoles(playerId).find((r) => this.getCardDef(r)?.name.includes('超刻'));
          if (target) {
            target.isReady = true;
          }
        }
        break;
      }

      // 充能自指定己方角色增益
      case 'SELECT_ROLE_FOR_CHARGE_BUFF': {
        const buffType = choice.metadata?.buffType as 'PP' | 'DP';
        const buffAmount = (choice.metadata?.buffAmount as number) || (buffType === 'PP' ? 2000 : 1);
        const targetId = selectedIds[0];
        if (targetId) {
          const role = this.ctx.state.cards[targetId];
          if (role) {
            if (buffType === 'PP') {
              role.tempPPBonus = (role.tempPPBonus || 0) + buffAmount;
            } else {
              role.tempDPBonus = (role.tempDPBonus || 0) + buffAmount;
            }
            const roleDef = this.getCardDef(role);
            this.ctx.events.push({
              type: 'ABILITY_ACTIVATED',
              playerId,
              cardInstanceId: targetId,
              abilityName: `【${choice.metadata?.cardName || '充能自'}】${buffType}+${buffAmount}`,
              rulesText: `${roleDef?.name || '角色'} 获得 ${buffType}+${buffAmount} 增益`,
            });
          }
        }
        break;
      }

      // 角色 PP 增益
      case 'BUFF_ROLE_PP': {
        const bonus = (choice.metadata?.buffPP as number) || 2000;
        for (const id of selectedIds) {
          const role = this.ctx.state.cards[id];
          if (role) role.tempPPBonus = (role.tempPPBonus || 0) + bonus;
        }
        if (choice.sourceCardInstanceId) {
          this.ctx.zoneMgr.moveCard(choice.sourceCardInstanceId, 'GRAVEYARD', { isFaceUp: true });
        }
        break;
      }

      // 角色 DP 增益
      case 'BUFF_ROLE_DP': {
        const bonus = (choice.metadata?.buffDP as number) || 1;
        for (const id of selectedIds) {
          const role = this.ctx.state.cards[id];
          if (role) role.tempDPBonus = (role.tempDPBonus || 0) + bonus;
        }
        if (choice.sourceCardInstanceId) {
          this.ctx.zoneMgr.moveCard(choice.sourceCardInstanceId, 'GRAVEYARD', { isFaceUp: true });
        }
        break;
      }

      // 角色破坏
      case 'DESTROY_ROLE': {
        for (const id of selectedIds) {
          this.ctx.fieldMgr.handleCardLeaveField(id);
          this.ctx.zoneMgr.moveCard(id, 'GRAVEYARD', { isFaceUp: true });
          this.ctx.events.push({
            type: 'CARD_DESTROYED',
            cardInstanceId: id,
            reason: 'EFFECT',
          });
        }
        if (choice.sourceCardInstanceId) {
          this.ctx.zoneMgr.moveCard(choice.sourceCardInstanceId, 'GRAVEYARD', { isFaceUp: true });
        }
        break;
      }

      // 刹那制裁按侵蚀削减PP
      case 'REDUCE_PP_BY_EROSION': {
        const erosion = player?.erosionCount || 1;
        const reduction = Math.max(1, erosion) * 2000;
        for (const id of selectedIds) {
          const role = this.ctx.state.cards[id];
          if (role) {
            role.tempPPBonus = (role.tempPPBonus || 0) - reduction;
            const effectivePP = this.ctx.fieldMgr.calculateRoleEffectivePP(id);
            if (effectivePP <= 0) {
              this.ctx.fieldMgr.handleCardLeaveField(id);
              this.ctx.zoneMgr.moveCard(id, 'GRAVEYARD', { isFaceUp: true });
              this.ctx.events.push({
                type: 'CARD_DESTROYED',
                cardInstanceId: id,
                reason: 'PP_ZERO',
              });
            }
          }
        }
        if (choice.sourceCardInstanceId) {
          this.ctx.zoneMgr.moveCard(choice.sourceCardInstanceId, 'GRAVEYARD', { isFaceUp: true });
        }
        break;
      }

      // 效果伤害角色
      case 'DEAL_DAMAGE_TO_ROLE': {
        const dmg = (choice.metadata?.damage as number) || 1000;
        for (const id of selectedIds) {
          const role = this.ctx.state.cards[id];
          if (role) {
            role.tempPPBonus = (role.tempPPBonus || 0) - dmg;
            const effectivePP = this.ctx.fieldMgr.calculateRoleEffectivePP(id);
            if (effectivePP <= 0) {
              this.ctx.fieldMgr.handleCardLeaveField(id);
              this.ctx.zoneMgr.moveCard(id, 'GRAVEYARD', { isFaceUp: true });
              this.ctx.events.push({
                type: 'CARD_DESTROYED',
                cardInstanceId: id,
                reason: 'PP_ZERO',
              });
            }
          }
        }
        break;
      }

      // 特殊出场 (从墓地召唤)
      case 'RESURRECT_ROLE': {
        for (const id of selectedIds) {
          const emptySlot = this.ctx.fieldMgr.findFirstEmptySlot(playerId);
          if (emptySlot !== undefined) {
            this.ctx.fieldMgr.playRoleCard(playerId, id, emptySlot);
            const def = this.getCardDef(id);
            if (def) this.handleRoleEntryEffect(playerId, id, def);
          }
        }
        if (choice.sourceCardInstanceId) {
          this.ctx.zoneMgr.moveCard(choice.sourceCardInstanceId, 'GRAVEYARD', { isFaceUp: true });
        }
        break;
      }

      // 里·异火 登场充能+1 (PP+1000)
      case 'BUFF_ROLE_CHARGE': {
        const targetId = selectedIds[0];
        if (targetId) {
          const targetCard = this.ctx.state.cards[targetId];
          if (targetCard) {
            targetCard.tempPPBonus = (targetCard.tempPPBonus || 0) + 1000;
            const targetDef = this.getCardDef(targetCard);
            this.ctx.events.push({
              type: 'ABILITY_ACTIVATED',
              playerId,
              cardInstanceId: choice.sourceCardInstanceId || targetId,
              abilityName: '【里·异火】登场充能赋能',
              rulesText: `已选择角色【${targetDef?.name || targetCard.cardNumber}】直到回合结束PP+1000 (充能+1)`,
            });
          }
        }
        // 将翻开的卡牌从 PROCESSING 移入墓地
        const topCardIds = (choice.metadata?.topCardIds as string[]) || [];
        for (const id of topCardIds) {
          const card = this.ctx.state.cards[id];
          if (card && card.zone === 'PROCESSING') {
            this.ctx.zoneMgr.moveCard(id, 'GRAVEYARD', { isFaceUp: true });
          }
        }
        break;
      }

      // 弃置手牌
      case 'DISCARD_HAND_CARD': {
        for (const id of selectedIds) {
          this.ctx.zoneMgr.moveCard(id, 'GRAVEYARD', { isFaceUp: true });
        }
        break;
      }

      // 对手确认公开展示卡牌，转回发动方进行具体选择
      case 'OPPONENT_CONFIRM_REVEAL': {
        const activePlayerId = (choice.metadata?.activePlayerId as string) || choice.playerId;
        return this.dispatchRevealedSelection(activePlayerId, choice.metadata as any);
      }

      // 里·异火 / 翻开卡牌检视确认结算
      case 'ST01_002_INSPECT_ORB': {
        const topCardIds = (choice.metadata?.topCardIds as string[]) || [];
        const hasOrb = Boolean(choice.metadata?.hasOrb);
        const cardName = choice.metadata?.cardName || '里·异火';

        if (hasOrb) {
          const friendlyRoles = this.getFriendlyRoles(playerId).filter((c) => {
            const d = this.getCardDef(c);
            return (
              d?.traits?.some((t) => t.includes('灰鸦')) ||
              ['露西亚', '里', '丽芙'].some((k) => d?.name?.includes(k))
            );
          });
          if (friendlyRoles.length > 0) {
            this.ctx.setPendingChoice({
              id: `choice-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              playerId,
              choiceType: 'SELECT_CARDS',
              prompt: `【${cardName}】已检出信号球！请选择我方战场1张<灰鸦小队>角色赋予【充能+1】(直到回合结束 PP+1000)：`,
              options: friendlyRoles.map((c) => this.createRoleChoiceOption(c)),
              effectType: 'BUFF_ROLE_CHARGE',
              sourceCardInstanceId: choice.sourceCardInstanceId,
              metadata: {
                topCardIds,
                cardName,
              },
              minSelections: 1,
              maxSelections: 1,
            });
          } else {
            // 战场无灰鸦小队角色，翻开卡牌移入墓地
            for (const id of topCardIds) {
              const card = this.ctx.state.cards[id];
              if (card && card.zone === 'PROCESSING') {
                this.ctx.zoneMgr.moveCard(id, 'GRAVEYARD', { isFaceUp: true });
              }
            }
            this.ctx.events.push({
              type: 'ABILITY_ACTIVATED',
              playerId,
              cardInstanceId: choice.sourceCardInstanceId || '',
              abilityName: `【${cardName}】登场效果结算`,
              rulesText: '虽检出信号球，但战场无<灰鸦小队>角色，翻开卡牌已送入墓地',
            });
          }
        } else {
          // 未检出信号球，翻开卡牌移入墓地
          for (const id of topCardIds) {
            const card = this.ctx.state.cards[id];
            if (card && card.zone === 'PROCESSING') {
              this.ctx.zoneMgr.moveCard(id, 'GRAVEYARD', { isFaceUp: true });
            }
          }
          this.ctx.events.push({
            type: 'ABILITY_ACTIVATED',
            playerId,
            cardInstanceId: choice.sourceCardInstanceId || '',
            abilityName: `【${cardName}】登场效果结算`,
            rulesText: '未检出信号球，翻开卡牌已全部送入墓地',
          });
        }
        break;
      }

      // 公开检索最终卡牌选择结算 (RESOLVE_REVEALED_SELECTION 与 SEARCH_TOP_CARDS 通用处理)
      case 'RESOLVE_REVEALED_SELECTION':
      case 'SEARCH_TOP_CARDS': {
        const topCardIds = (choice.metadata?.topCardIds as string[]) || [];
        const eligibleCardIds = (choice.metadata?.eligibleCardIds as string[]) || [];
        const destination = choice.metadata?.destination || 'HAND';
        const remainingDestination = choice.metadata?.remainingDestination || 'DECK_BOTTOM';
        const cardName = choice.metadata?.cardName || '卡牌效果';

        // 1. 将选取的卡牌移入目标区域
        const selectedCards: CardInstance[] = [];
        if (selectedIds.length > 0) {
          for (const id of selectedIds) {
            if (eligibleCardIds.length > 0 && !eligibleCardIds.includes(id)) {
              return { success: false, error: '所选卡牌不符合指定条件' };
            }
            const card = this.ctx.state.cards[id];
            if (card) {
              selectedCards.push(card);
              if (destination === 'HAND') {
                this.ctx.zoneMgr.moveCard(id, 'HAND', { isFaceUp: true });
              } else if (destination === 'BATTLEFIELD') {
                const emptySlot = this.ctx.fieldMgr.findFirstEmptySlot(playerId);
                if (emptySlot !== undefined) {
                  this.ctx.fieldMgr.playRoleCard(playerId, id, emptySlot);
                  const def = this.getCardDef(id);
                  if (def) this.handleRoleEntryEffect(playerId, id, def);
                } else {
                  this.ctx.zoneMgr.moveCard(id, 'HAND', { isFaceUp: true });
                }
              } else if (destination === 'COST') {
                this.ctx.zoneMgr.moveCard(id, 'COST', { isFaceUp: true, isReady: false });
              } else if (destination === 'SIGNAL_ORB') {
                this.ctx.zoneMgr.moveCard(id, 'SIGNAL_ORB', { isFaceUp: true });
              } else if (destination === 'GRAVEYARD') {
                this.ctx.zoneMgr.moveCard(id, 'GRAVEYARD', { isFaceUp: true });
              }
            }
          }
        }

        // 2. 将剩余未选取的公开卡牌移入对应区域
        const remainingIds = topCardIds.filter((id) => !selectedIds.includes(id));
        for (const id of remainingIds) {
          const card = this.ctx.state.cards[id];
          if (card && card.zone === 'PROCESSING') {
            if (remainingDestination === 'GRAVEYARD') {
              this.ctx.zoneMgr.moveCard(id, 'GRAVEYARD', { isFaceUp: true });
            } else if (remainingDestination === 'SHUFFLE_DECK') {
              this.ctx.zoneMgr.moveCard(id, 'DECK', { isFaceUp: false });
            } else {
              // 默认 DECK_BOTTOM
              this.ctx.zoneMgr.moveCardToBottomOfDeck(id);
            }
          }
        }

        if (remainingDestination === 'SHUFFLE_DECK') {
          this.ctx.zoneMgr.shuffleDeck(playerId);
        }

        // 3. 若来源战术牌在处理区，移入墓地
        if (choice.sourceCardInstanceId) {
          const src = this.ctx.state.cards[choice.sourceCardInstanceId];
          if (src && src.zone === 'PROCESSING') {
            this.ctx.zoneMgr.moveCard(choice.sourceCardInstanceId, 'GRAVEYARD', { isFaceUp: true });
          }
        }

        const selNames = selectedCards.map((c) => this.getCardDef(c)?.name || c.cardNumber).join('、');
        const destText = destination === 'HAND' ? '手牌' : destination === 'BATTLEFIELD' ? '战场' : destination;
        const remText =
          remainingDestination === 'GRAVEYARD'
            ? '墓地'
            : remainingDestination === 'SHUFFLE_DECK'
            ? '牌组洗切'
            : '牌组底';

        this.ctx.events.push({
          type: 'ABILITY_ACTIVATED',
          playerId,
          cardInstanceId: choice.sourceCardInstanceId || '',
          abilityName: `【${cardName}】效果结算`,
          rulesText:
            selectedIds.length > 0
              ? `已选择【${selNames}】加入${destText}，其余 ${remainingIds.length} 张卡牌放置到${remText}。`
              : `未选取卡牌，所有 ${remainingIds.length} 张公开卡牌放置到${remText}。`,
        });

        break;
      }

      // ST01-001 弃牌召唤后续公开检视
      case 'ST01_001_DISCARD_RECRUIT': {
        const discardId = selectedIds[0];
        if (discardId) {
          this.ctx.zoneMgr.moveCard(discardId, 'GRAVEYARD', { isFaceUp: true });
          return this.revealTopAndSearch(playerId, {
            sourceCardInstanceId: choice.sourceCardInstanceId,
            cardName: '露西亚·红莲',
            count: 5,
            prompt: '已弃牌！请选择公开的1张<=3费<灰鸦小队>角色出场：',
            promptNoEligible: '公开卡牌中未检出符合条件的<=3费灰鸦角色，点击确认放置到牌组底：',
            isEligible: (_c, d) => {
              if (!d || d.cardType !== CardType.ROLE || (d.cost ?? 0) > 3) return false;
              const traits = d.traits || [];
              return traits.some((t) => t.includes('灰鸦')) || ['露西亚', '里', '丽芙'].some((k) => d.name.includes(k));
            },
            ineligibleReason: '非<=3费<灰鸦小队>角色',
            destination: 'BATTLEFIELD',
            remainingDestination: 'DECK_BOTTOM',
            minSelections: 1,
            maxSelections: 1,
          });
        }
        break;
      }

      // ST02-003 弃牌检索后续公开检视 (升格者加入手牌，其余入墓)
      case 'ST02_003_DISCARD_SEARCH': {
        const discardId = selectedIds[0];
        if (discardId) {
          this.ctx.zoneMgr.moveCard(discardId, 'GRAVEYARD', { isFaceUp: true });
          return this.revealTopAndSearch(playerId, {
            sourceCardInstanceId: choice.sourceCardInstanceId,
            cardName: '露娜·银冕',
            count: 3,
            prompt: '已弃牌！请选择1张公开的<升格者>角色加入手牌：',
            promptNoEligible: '未检出<升格者>角色，点击确认将所有公开卡牌送入墓地：',
            isEligible: (_c, d) => {
              if (!d || d.cardType !== CardType.ROLE) return false;
              const traits = d.traits || [];
              return (
                traits.some((t) => t.includes('升格者')) ||
                ['露娜', '罗兰', '加百列', '阿尔法'].some((k) => d.name.includes(k))
              );
            },
            ineligibleReason: '非<升格者>角色',
            destination: 'HAND',
            remainingDestination: 'GRAVEYARD',
            minSelections: 1,
            maxSelections: 1,
          });
        }
        break;
      }

      // ST02-007 弃牌回收墓地升格者角色
      case 'ST02_007_DISCARD_SALVAGE': {
        const discardId = selectedIds[0];
        if (discardId) {
          this.ctx.zoneMgr.moveCard(discardId, 'GRAVEYARD', { isFaceUp: true });
          const gyRoles = this.ctx.zoneMgr
            .getCardsInZone(playerId, 'GRAVEYARD')
            .filter((c) => {
              const d = this.getCardDef(c);
              return (
                d?.cardType === CardType.ROLE &&
                (d?.traits?.some((t) => t.includes('升格者')) ||
                  ['露娜', '罗兰', '加百列', '阿尔法'].some((k) => d.name.includes(k)))
              );
            });
          if (gyRoles.length > 0) {
            this.ctx.setPendingChoice({
              id: `choice-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              playerId,
              choiceType: 'SELECT_CARDS',
              prompt: '已弃牌！请选择墓地1张<升格者>角色回收至手牌：',
              options: gyRoles.map((c) => this.createGeneralCardChoiceOption(c, { eligible: true })),
              effectType: 'SALVAGE_TO_HAND',
              sourceCardInstanceId: choice.sourceCardInstanceId,
              minSelections: 1,
              maxSelections: 1,
            });
            return { success: true };
          }
        }
        break;
      }

      // ST03-003 支付代价公开检索 (选最多1张21号和1张诺克提加入手牌，其余入墓)
      case 'ST03_003_PAY_COST_SEARCH': {
        const costId = selectedIds[0];
        if (costId) {
          this.ctx.zoneMgr.moveCard(costId, 'GRAVEYARD', { isFaceUp: true });
          return this.revealTopAndSearch(playerId, {
            sourceCardInstanceId: choice.sourceCardInstanceId,
            cardName: '薇拉·瑰丽',
            count: 5,
            prompt: '已支付代价！请选择最多1张<21号>和最多1张<诺克提>加入手牌：',
            promptNoEligible: '未检出<21号>或<诺克提>角色，点击确认将所有公开卡牌放置到墓地：',
            isEligible: (_c, d) => {
              if (!d || d.cardType !== CardType.ROLE) return false;
              return d.name.includes('21号') || d.name.includes('诺克提');
            },
            ineligibleReason: '非<21号>或<诺克提>角色',
            destination: 'HAND',
            remainingDestination: 'GRAVEYARD',
            minSelections: 0,
            maxSelections: 2,
          });
        }
        break;
      }

      // ST06-005 弃牌召唤 (公开顶5张，选择<=4费亚里莎/塞西莉出场，洗牌)
      case 'ST06_005_DISCARD_RECRUIT': {
        const discardId = selectedIds[0];
        if (discardId) {
          this.ctx.zoneMgr.moveCard(discardId, 'GRAVEYARD', { isFaceUp: true });
          return this.revealTopAndSearch(playerId, {
            sourceCardInstanceId: choice.sourceCardInstanceId,
            cardName: '亚里莎·回音',
            count: 5,
            prompt: '已弃牌！请选择公开的1张<=4费<亚里莎>或<塞西莉>角色出场：',
            promptNoEligible: '未检出符合条件的角色，点击确认将所有卡牌洗入牌组：',
            isEligible: (_c, d) => {
              if (!d || d.cardType !== CardType.ROLE || (d.cost ?? 0) > 4) return false;
              return d.name.includes('亚里莎') || d.name.includes('塞西莉');
            },
            ineligibleReason: '非<=4费<亚里莎>/<塞西莉>角色',
            destination: 'BATTLEFIELD',
            remainingDestination: 'SHUFFLE_DECK',
            minSelections: 1,
            maxSelections: 1,
          });
        }
        break;
      }

      // BP01-001 消除2信号球特殊登场 (公开顶5张，费用合计<=6出场，其余牌组底)
      case 'BP01_001_ELIMINATE_ORBS_RECRUIT': {
        if (selectedIds.length === 2) {
          for (const id of selectedIds) {
            this.ctx.zoneMgr.moveCard(id, 'GRAVEYARD', { isFaceUp: true });
          }
          return this.revealTopAndSearch(playerId, {
            sourceCardInstanceId: choice.sourceCardInstanceId,
            cardName: '露西亚·鸦羽',
            count: 5,
            prompt: '已消除信号球！请选择公开的费用合计<=6的<灰鸦小队>角色出场：',
            promptNoEligible: '公开卡牌中未检出符合条件的灰鸦角色，点击确认放置到牌组底：',
            isEligible: (_c, d) => {
              if (!d || d.cardType !== CardType.ROLE || (d.cost ?? 0) > 6) return false;
              const traits = d.traits || [];
              return traits.some((t) => t.includes('灰鸦')) || ['露西亚', '里', '丽芙'].some((k) => d.name.includes(k));
            },
            ineligibleReason: '非<=6费灰鸦角色',
            destination: 'BATTLEFIELD',
            remainingDestination: 'DECK_BOTTOM',
            minSelections: 1,
            maxSelections: 3,
          });
        }
        break;
      }

      // ST01-001 起动消除2蓝色信号球后回手己方角色
      case 'ST01_001_ACTIVATE_ELIMINATE_ORBS': {
        if (selectedIds.length === 2) {
          for (const id of selectedIds) {
            this.ctx.zoneMgr.moveCard(id, 'GRAVEYARD', { isFaceUp: true });
          }
          const friendlyRoles = this.getFriendlyRoles(playerId);
          this.ctx.setPendingChoice({
            id: `choice-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            playerId,
            choiceType: 'SELECT_CARDS',
            prompt: '已消除2个蓝色信号球！请选择我方战场1张角色返回手牌：',
            options: friendlyRoles.map((c) => this.createRoleChoiceOption(c)),
            effectType: 'BOUNCE_FRIENDLY_ROLE',
            sourceCardInstanceId: choice.sourceCardInstanceId,
            minSelections: 1,
            maxSelections: 1,
          });
          return { success: true };
        }
        break;
      }

      // BP01-010 消除信号球赋予贯通
      case 'BP01_010_ELIMINATE_ORBS_PIERCE': {
        if (selectedIds.length === 2) {
          for (const id of selectedIds) {
            this.ctx.zoneMgr.moveCard(id, 'GRAVEYARD', { isFaceUp: true });
          }
          const targetRoleId = choice.metadata?.targetRoleId as string;
          const target = this.ctx.state.cards[targetRoleId];
          if (target) {
            target.grantedKeywords = target.grantedKeywords || [];
            if (!target.grantedKeywords.includes('贯通')) {
              target.grantedKeywords.push('贯通');
            }
            this.ctx.events.push({
              type: 'ABILITY_ACTIVATED',
              playerId,
              cardInstanceId: choice.sourceCardInstanceId || '',
              abilityName: '【罗兰·戏炎】赋予贯通',
              rulesText: '已消除2个信号球，《露娜·银冕》获得【贯通】！',
            });
          }
        }
        break;
      }

      // BP01-010 起动弃牌代价
      case 'BP01_010_DISCARD_COST': {
        const discardId = selectedIds[0];
        if (discardId) {
          this.ctx.zoneMgr.moveCard(discardId, 'GRAVEYARD', { isFaceUp: true });
          const costCards = this.ctx.zoneMgr.getCardsInZone(playerId, 'COST');
          if (costCards.length > 0) {
            this.ctx.setPendingChoice({
              id: `choice-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              playerId,
              choiceType: 'SELECT_CARDS',
              prompt: '已弃牌！请选择我方费用区1张牌送入墓地以补充牌组顶费用：',
              options: costCards.map((c) => this.createGeneralCardChoiceOption(c, { eligible: true })),
              effectType: 'DISCARD_FROM_COST_AND_REPLENISH',
              sourceCardInstanceId: choice.sourceCardInstanceId,
              minSelections: 1,
              maxSelections: 1,
            });
            return { success: true };
          }
        }
        break;
      }

      // 费用送入墓地并补充牌组顶费用
      case 'DISCARD_FROM_COST_AND_REPLENISH': {
        for (const id of selectedIds) {
          this.ctx.zoneMgr.moveCard(id, 'GRAVEYARD', { isFaceUp: true });
        }
        const topDeck = this.ctx.zoneMgr.getCardsInZone(playerId, 'DECK')[0];
        if (topDeck) {
          this.ctx.zoneMgr.moveCard(topDeck.instanceId, 'COST', { isFaceUp: false, isReady: true });
        }
        break;
      }

      // BP01-040 弃牌附着帕瓦
      case 'BP01_040_DISCARD_ATTACH_PAWA': {
        const discardId = selectedIds[0];
        if (discardId) {
          this.ctx.zoneMgr.moveCard(discardId, 'GRAVEYARD', { isFaceUp: true });
          const gyPawa = this.ctx.zoneMgr.getCardsInZone(playerId, 'GRAVEYARD').filter((c) => {
            const d = this.getCardDef(c);
            return d?.name?.includes('帕瓦');
          });
          if (gyPawa.length > 0) {
            this.ctx.setPendingChoice({
              id: `choice-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              playerId,
              choiceType: 'SELECT_CARDS',
              prompt: '已弃牌！请选择我方墓地1张《帕瓦》放置到该牌下方：',
              options: gyPawa.map((c) => this.createGeneralCardChoiceOption(c, { eligible: true })),
              effectType: 'ATTACH_UNDERNEATH',
              sourceCardInstanceId: choice.sourceCardInstanceId,
              minSelections: 1,
              maxSelections: 1,
            });
            return { success: true };
          }
        }
        break;
      }

      // BP01-007 刹那冰华 PP+1500 并可选追加弃牌
      case 'BP01_007_BUFF_AND_DISCARD': {
        const targetId = selectedIds[0];
        if (targetId) {
          const targetCard = this.ctx.state.cards[targetId];
          if (targetCard) {
            targetCard.tempPPBonus = (targetCard.tempPPBonus || 0) + 1500;
          }
          const handCards = this.ctx.zoneMgr.getCardsInZone(playerId, 'HAND');
          if (handCards.length > 0) {
            this.ctx.setPendingChoice({
              id: `choice-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              playerId,
              choiceType: 'SELECT_CARDS',
              prompt: '【刹那冰华】基础PP+1500生效！可追加丢弃手牌（每丢弃1张PP再+1000，可跳过）：',
              options: handCards.map((c) => this.createGeneralCardChoiceOption(c, { eligible: true })),
              effectType: 'BP01_007_EXTRA_DISCARD',
              sourceCardInstanceId: choice.sourceCardInstanceId,
              metadata: { targetRoleId: targetId },
              minSelections: 0,
              maxSelections: handCards.length,
            });
            return { success: true };
          }
        }
        if (choice.sourceCardInstanceId) {
          this.ctx.zoneMgr.moveCard(choice.sourceCardInstanceId, 'GRAVEYARD', { isFaceUp: true });
        }
        break;
      }

      // BP01-007 追加弃牌结算
      case 'BP01_007_EXTRA_DISCARD': {
        const count = selectedIds.length;
        for (const id of selectedIds) {
          this.ctx.zoneMgr.moveCard(id, 'GRAVEYARD', { isFaceUp: true });
        }
        const targetRoleId = choice.metadata?.targetRoleId as string;
        const target = this.ctx.state.cards[targetRoleId];
        if (target && count > 0) {
          target.tempPPBonus = (target.tempPPBonus || 0) + count * 1000;
        }
        if (choice.sourceCardInstanceId) {
          this.ctx.zoneMgr.moveCard(choice.sourceCardInstanceId, 'GRAVEYARD', { isFaceUp: true });
        }
        break;
      }

      // 通用出场弃牌代价后续执行
      case 'UNIVERSAL_ENTRY_DISCARD_COST': {
        for (const id of selectedIds) {
          this.ctx.zoneMgr.moveCard(id, 'GRAVEYARD', { isFaceUp: true });
        }
        const followUpRules = (choice.metadata?.followUpRules as string) || '';
        const sourceRoleInstanceId = choice.metadata?.sourceRoleInstanceId as string;
        const cardName = (choice.metadata?.cardName as string) || '角色出场能力';

        // 1. 公开牌组顶
        const searchMatch = followUpRules.match(/公开(?:我方)?牌组顶(\d+)张牌/);
        if (searchMatch && searchMatch[1]) {
          const count = parseInt(searchMatch[1], 10);
          const isGrave = followUpRules.includes('放置到墓地');
          const isShuffle = followUpRules.includes('洗切');
          const isRoleToField = followUpRules.includes('出场');
          return this.revealTopAndSearch(playerId, {
            sourceCardInstanceId: sourceRoleInstanceId,
            cardName,
            count,
            prompt: `已弃牌！请从公开的${count}张卡牌中选择目标：`,
            destination: isRoleToField ? 'BATTLEFIELD' : 'HAND',
            remainingDestination: isGrave ? 'GRAVEYARD' : isShuffle ? 'SHUFFLE_DECK' : 'DECK_BOTTOM',
            minSelections: 0,
            maxSelections: 1,
          });
        }

        // 2. 从费用区回收
        if (followUpRules.includes('选择我方费用区1张牌') && followUpRules.includes('加入手牌')) {
          const costCards = this.ctx.zoneMgr.getCardsInZone(playerId, 'COST');
          if (costCards.length > 0) {
            this.ctx.setPendingChoice({
              id: `choice-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              playerId,
              choiceType: 'SELECT_CARDS',
              prompt: '已弃牌！请选择我方费用区1张卡牌加入手牌：',
              options: costCards.map((c) => this.createGeneralCardChoiceOption(c, { eligible: true })),
              effectType: 'SALVAGE_FROM_COST',
              sourceCardInstanceId: sourceRoleInstanceId,
              minSelections: 1,
              maxSelections: 1,
            });
            return { success: true };
          }
        }

        // 3. 从墓地回收至手牌
        if (followUpRules.includes('选择我方墓地1张') && followUpRules.includes('加入手牌')) {
          const gyCards = this.ctx.zoneMgr.getCardsInZone(playerId, 'GRAVEYARD');
          if (gyCards.length > 0) {
            this.ctx.setPendingChoice({
              id: `choice-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              playerId,
              choiceType: 'SELECT_CARDS',
              prompt: '已弃牌！请选择我方墓地1张卡牌加入手牌：',
              options: gyCards.map((c) => this.createGeneralCardChoiceOption(c, { eligible: true })),
              effectType: 'SALVAGE_TO_HAND',
              sourceCardInstanceId: sourceRoleInstanceId,
              minSelections: 1,
              maxSelections: 1,
            });
            return { success: true };
          }
        }

        // 4. 从墓地特殊出场
        if (followUpRules.includes('选择我方墓地1张') && followUpRules.includes('出场')) {
          const gyRoles = this.ctx.zoneMgr
            .getCardsInZone(playerId, 'GRAVEYARD')
            .filter((c) => this.getCardDef(c)?.cardType === CardType.ROLE);
          if (gyRoles.length > 0 && this.ctx.fieldMgr.findFirstEmptySlot(playerId) !== undefined) {
            this.ctx.setPendingChoice({
              id: `choice-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              playerId,
              choiceType: 'SELECT_CARDS',
              prompt: '已弃牌！请选择我方墓地1张角色卡牌出场：',
              options: gyRoles.map((c) => this.createGeneralCardChoiceOption(c, { eligible: true })),
              effectType: 'RESURRECT_ROLE',
              sourceCardInstanceId: sourceRoleInstanceId,
              minSelections: 1,
              maxSelections: 1,
            });
            return { success: true };
          }
        }

        // 5. 抽牌
        const drawMatch = followUpRules.match(/抽(\d+)张牌/);
        if (drawMatch && drawMatch[1]) {
          this.ctx.zoneMgr.drawCards(playerId, parseInt(drawMatch[1], 10));
        }

        // 6. 削减对方PP
        const reduceMatch = followUpRules.match(/选择对方战场1张角色.*?PP-(\d+)/);
        if (reduceMatch && reduceMatch[1]) {
          const oppRoles = this.getOpponentRoles(playerId);
          if (oppRoles.length > 0) {
            const debuff = parseInt(reduceMatch[1], 10);
            this.ctx.setPendingChoice({
              id: `choice-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              playerId,
              choiceType: 'SELECT_CARDS',
              prompt: `已弃牌！请选择对方战场1张角色使期PP-${debuff}：`,
              options: oppRoles.map((c) => this.createRoleChoiceOption(c)),
              effectType: 'BUFF_ROLE_PP',
              sourceCardInstanceId: sourceRoleInstanceId,
              metadata: { buffPP: -debuff },
              minSelections: 1,
              maxSelections: 1,
            });
            return { success: true };
          }
        }

        break;
      }

      // 回收至手牌
      case 'SALVAGE_TO_HAND': {
        for (const id of selectedIds) {
          this.ctx.zoneMgr.moveCard(id, 'HAND', { isFaceUp: true });
        }
        break;
      }

      // 角色回手
      case 'BOUNCE_FRIENDLY_ROLE': {
        for (const id of selectedIds) {
          this.ctx.fieldMgr.handleCardLeaveField(id);
          this.ctx.zoneMgr.moveCard(id, 'HAND', { isFaceUp: true, isReady: true });
        }
        // ST01-001 连携后续：选择手牌中费用<=4的<灰鸦小队>角色出场
        const handRoles = this.ctx.zoneMgr.getCardsInZone(playerId, 'HAND').filter((c) => {
          const d = this.getCardDef(c);
          return d?.cardType === CardType.ROLE && (d?.cost || 0) <= 4 && (d?.traits?.some((t) => t.includes('灰鸦')) || !d?.traits?.length);
        });
        if (handRoles.length > 0 && this.ctx.fieldMgr.findFirstEmptySlot(playerId) !== undefined) {
          this.ctx.setPendingChoice({
            id: `choice-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            playerId,
            choiceType: 'SELECT_CARDS',
            prompt: '已回手角色！请选择手牌中1张<=4费的<灰鸦小队>角色特殊出场：',
            options: handRoles.map((c) => {
              const d = this.getCardDef(c);
              return { id: c.instanceId, label: `【${d?.name}】费用:${d?.cost} PP:${d?.basePP}` };
            }),
            effectType: 'RESURRECT_ROLE',
            minSelections: 0,
            maxSelections: 1,
          });
          return { success: true };
        }
        break;
      }

      // BP01-003 回手两段式结算
      case 'BP01_003_BOUNCE_STEP1': {
        const bounceId = selectedIds[0];
        if (bounceId) {
          this.ctx.fieldMgr.handleCardLeaveField(bounceId);
          this.ctx.zoneMgr.moveCard(bounceId, 'HAND', { isFaceUp: true, isReady: true });

          // 第二阶段：选择战场1张费用为5及以下的角色返回手牌 (双方战场均可)
          const allRoles = [...this.getFriendlyRoles(playerId), ...this.getOpponentRoles(playerId)];
          const eligibleRoles = allRoles.filter((r) => {
            const d = this.getCardDef(r);
            return (d?.cost || 0) <= 5;
          });
          if (eligibleRoles.length > 0) {
            this.ctx.setPendingChoice({
              id: `choice-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              playerId,
              choiceType: 'SELECT_CARDS',
              prompt: '已回手<灰鸦小队>角色！请选择战场1张费用<=5的角色返回手牌：',
              options: allRoles.map((r) => {
                const isEligible = eligibleRoles.some((e) => e.instanceId === r.instanceId);
                return this.createRoleChoiceOption(r, {
                  eligible: isEligible,
                  ineligibleReason: !isEligible ? '费用超过5' : undefined,
                });
              }),
              effectType: 'BOUNCE_ROLE',
              sourceCardInstanceId: choice.sourceCardInstanceId,
              minSelections: 1,
              maxSelections: 1,
            });
            return { success: true };
          }
        }
        break;
      }

      // BP01-004 弃牌并从费用区回收
      case 'BP01_004_DISCARD_RECOVER_COST': {
        const discardId = selectedIds[0];
        if (discardId) {
          this.ctx.zoneMgr.moveCard(discardId, 'GRAVEYARD', { isFaceUp: true });

          const costCards = this.ctx.zoneMgr.getCardsInZone(playerId, 'COST');
          if (costCards.length > 0) {
            this.ctx.setPendingChoice({
              id: `choice-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              playerId,
              choiceType: 'SELECT_CARDS',
              prompt: '已弃牌！请选择我方费用区1张卡牌加入手牌：',
              options: costCards.map((c) => this.createGeneralCardChoiceOption(c)),
              effectType: 'SALVAGE_FROM_COST',
              sourceCardInstanceId: choice.sourceCardInstanceId,
              minSelections: 1,
              maxSelections: 1,
            });
            return { success: true };
          }
        }
        break;
      }

      // 从费用区回收至手牌
      case 'SALVAGE_FROM_COST': {
        for (const id of selectedIds) {
          this.ctx.zoneMgr.moveCard(id, 'HAND', { isFaceUp: true });
        }
        break;
      }

      // 从费用区丢弃至墓地
      case 'DISCARD_FROM_COST': {
        for (const id of selectedIds) {
          this.ctx.zoneMgr.moveCard(id, 'GRAVEYARD', { isFaceUp: true });
        }
        break;
      }

      // 费用区卡牌竖直
      case 'READY_COST': {
        for (const id of selectedIds) {
          const card = this.ctx.state.cards[id];
          if (card) {
            card.isReady = true;
            card.isFaceUp = true;
          }
        }
        break;
      }

      // 角色以横置状态放置到对方费用区 (BP01-008 等)
      case 'SEND_ROLE_TO_COST': {
        for (const id of selectedIds) {
          const card = this.ctx.state.cards[id];
          if (card) {
            this.ctx.fieldMgr.handleCardLeaveField(id);
            this.ctx.zoneMgr.moveCard(id, 'COST', { isFaceUp: false, isReady: false });
          }
        }
        break;
      }

      // 角色放置到底牌组 (BP01-058 / BP01-067 等)
      case 'SEND_ROLE_TO_DECK_BOTTOM': {
        for (const id of selectedIds) {
          this.ctx.fieldMgr.handleCardLeaveField(id);
          this.ctx.zoneMgr.moveCardToBottomOfDeck(id);
        }
        break;
      }

      // 角色竖直就绪
      case 'READY_ROLE': {
        for (const id of selectedIds) {
          const card = this.ctx.state.cards[id];
          if (card) card.isReady = true;
        }
        break;
      }

      // 角色横置
      case 'REST_ROLE': {
        for (const id of selectedIds) {
          const card = this.ctx.state.cards[id];
          if (card) card.isReady = false;
        }
        break;
      }

      // 通用角色返回手牌
      case 'BOUNCE_ROLE': {
        for (const id of selectedIds) {
          this.ctx.fieldMgr.handleCardLeaveField(id);
          this.ctx.zoneMgr.moveCard(id, 'HAND', { isFaceUp: true, isReady: true });
        }
        break;
      }

      // 墓地信号球回收至信号球区
      case 'RECOVER_ORB_TO_ZONE': {
        for (const id of selectedIds) {
          this.ctx.zoneMgr.moveCard(id, 'SIGNAL_ORB', { isFaceUp: true });
        }
        break;
      }

      // 角色下方垫牌 (如《帕瓦》附着于《七实·遥星之座》下方)
      case 'ATTACH_UNDERNEATH': {
        for (const id of selectedIds) {
          const target = this.ctx.state.cards[id];
          if (target && choice.sourceCardInstanceId) {
            target.underneathCardIds = target.underneathCardIds || [];
            target.underneathCardIds.push(choice.sourceCardInstanceId);
            this.ctx.fieldMgr.handleCardLeaveField(choice.sourceCardInstanceId);
            this.ctx.zoneMgr.moveCard(choice.sourceCardInstanceId, 'PROCESSING', { isFaceUp: true });
          }
        }
        break;
      }

      // 使用装备牌时选择装备对象 (8.6.2.e.2)
      case 'EQUIP_FROM_PROCESSING': {
        const equipId = choice.sourceCardInstanceId;
        const roleId = selectedIds[0];
        const equipCard = equipId ? this.ctx.state.cards[equipId] : undefined;
        if (!equipCard || equipCard.zone !== 'PROCESSING' || !roleId) {
          return { success: false, error: '装备牌已不在处理区' };
        }
        if (!this.ctx.fieldMgr.equipToRole(playerId, equipCard.instanceId, roleId)) {
          return { success: false, error: '装备对象必须是自身战场上未装备装备牌的角色 (4.18.3)' };
        }
        const equipDef = this.getCardDef(equipCard);
        if (equipDef) this.handleEquipmentBuff(roleId, equipDef);
        break;
      }

      // 默认兼容旧格式
      default: {
        for (const selectedId of selectedIds) {
          const targetCard = this.ctx.state.cards[selectedId];
          if (targetCard) {
            if (choice.prompt.includes('返回手牌')) {
              this.ctx.fieldMgr.handleCardLeaveField(targetCard.instanceId);
              this.ctx.zoneMgr.moveCard(targetCard.instanceId, 'HAND', { isFaceUp: true, isReady: true });
            } else if (choice.prompt.includes('装备')) {
              const processingEquip = this.ctx.zoneMgr
                .getCardsInZone(playerId, 'PROCESSING')
                .find((c) => this.getCardDef(c)?.cardType === CardType.EQUIPMENT);
              if (processingEquip) {
                this.ctx.fieldMgr.equipToRole(playerId, processingEquip.instanceId, targetCard.instanceId);
                const equipDef = this.getCardDef(processingEquip);
                if (equipDef) this.handleEquipmentBuff(targetCard.instanceId, equipDef);
              }
            } else if (choice.prompt.includes('PP-2000')) {
              targetCard.tempPPBonus = (targetCard.tempPPBonus || 0) - 2000;
            } else if (choice.prompt.includes('PP+2000') || choice.prompt.includes('PP+1000')) {
              const val = choice.prompt.includes('PP+2000') ? 2000 : 1000;
              targetCard.tempPPBonus = (targetCard.tempPPBonus || 0) + val;
            }
          }
        }
        break;
      }
    }

    // 若当前决策衍生出了下一阶段的目标选择决策 (如 SELECT_ROLE_FOR_CHARGE_BUFF)，予以保留
    if (this.ctx.state.currentPendingChoice && this.ctx.state.currentPendingChoice.id !== choice.id) {
      // 保持派生的二级目标选择决策激活状态
    } else {
      // 结算完成后将处理区中残留的普通战术牌送入墓地 (信号球与招式已入信号球区，不受影响)
      const processingTactics = this.ctx.zoneMgr
        .getCardsInZone(playerId, 'PROCESSING')
        .filter((c) => {
          const d = this.getCardDef(c);
          return d?.cardType === CardType.TACTICS;
        });
      for (const t of processingTactics) {
        this.ctx.zoneMgr.moveCard(t.instanceId, 'GRAVEYARD', { isFaceUp: true });
      }

      this.ctx.setPendingChoice(undefined);
    }

    this.ctx.events.push({
      type: 'CHOICE_RESOLVED',
      playerId,
      pendingChoiceId: choice.id,
      selectedIds,
    });

    return { success: true };
  }

  // =========================================================================
  // 6. 充能自能力自动判定与决策窗口 (全量69张专武/招式自适应)
  // =========================================================================
  handleChargeAutoEffect(
    playerId: string,
    cardInstanceId: string,
    cardDef: CardVersionData
  ): boolean {
    const rules = cardDef.rulesText || '';
    if (!rules.includes('【充能自】') && !rules.includes('充能自')) return false;

    const options: { id: string; label: string }[] = [];

    if (rules.includes('DP+1')) {
      options.push({ id: 'opt_dp_plus_1', label: '选择我方战场最多1张角色，直到回合结束 DP+1' });
    }
    if (rules.includes('抽1张牌')) {
      options.push({ id: 'opt_draw_1', label: '额外抽 1 张牌' });
    }
    if (rules.includes('侵蚀计数')) {
      options.push({ id: 'opt_erosion_minus_1', label: '若我方侵蚀计数不小于对方，我方侵蚀计数 -1' });
    }
    if (rules.includes('《里·超刻》') && rules.includes('【速攻】')) {
      options.push({ id: 'opt_grant_sugong_chaoke', label: '选择我方战场1张《里·超刻》，直到回合结束获得【速攻】' });
    }
    if (rules.includes('《里·超刻》') && rules.includes('将其竖直')) {
      options.push({ id: 'opt_ready_chaoke', label: '选择我方战场1张《里·超刻》，该回合结束时将其竖直' });
    }
    if (rules.includes('PP+2000') || options.length < 2) {
      options.push({ id: 'opt_pp_plus_2000', label: '选择我方战场最多1张角色，直到回合结束 PP+2000' });
    }

    if (options.length === 0) return false;

    this.ctx.setPendingChoice({
      id: `choice-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      playerId,
      choiceType: 'SELECT_OPTION',
      prompt: `【${cardDef.name}】充能自效果触发！请从以下选项中选择 1 项执行：`,
      options,
      effectType: 'SIGNATURE_MOVE_EFFECT',
      sourceCardInstanceId: cardInstanceId,
      metadata: { cardNumber: cardDef.cardNumber },
      minSelections: 1,
      maxSelections: 1,
    });
    return true;
  }

  // =========================================================================
  // 7. 通用战术规则解析执行引擎 (针对全量战术牌抽牌、破坏、消灭、增益、削弱与检索)
  // =========================================================================
  resolveUniversalTacticsEffect(
    playerId: string,
    cardInstanceId: string,
    cardDef: CardVersionData
  ): { success: boolean; error?: string } {
    const rules = cardDef.rulesText || '';
    const player = this.ctx.state.players[playerId];

    // 1. 抽牌判定: 抽X张牌
    const drawMatch = rules.match(/抽(\d+)张牌/);
    if (drawMatch && drawMatch[1]) {
      const drawCount = parseInt(drawMatch[1], 10);
      this.ctx.zoneMgr.drawCards(playerId, drawCount);
      this.ctx.events.push({
        type: 'ABILITY_ACTIVATED',
        playerId,
        cardInstanceId,
        abilityName: `${cardDef.name} 抽牌效果`,
        rulesText: `抽取 ${drawCount} 张牌`,
      });
    }

    // 2. 侵蚀计数判定
    const erosionDown = rules.match(/侵蚀计数-(\d+)/);
    if (erosionDown && erosionDown[1] && player) {
      player.erosionCount = Math.max(0, player.erosionCount - parseInt(erosionDown[1], 10));
    }
    const erosionUp = rules.match(/侵蚀计数\+(\d+)/);
    if (erosionUp && erosionUp[1] && player) {
      player.erosionCount += parseInt(erosionUp[1], 10);
    }

    // 3. 破坏对方角色判定
    if (rules.includes('破坏') && rules.includes('对方战场')) {
      const oppRoles = this.getOpponentRoles(playerId);
      const ppLimitMatch = rules.match(/PP为(\d+)及以下/);
      const maxPP = ppLimitMatch && ppLimitMatch[1] ? parseInt(ppLimitMatch[1], 10) : undefined;

      const eligible = maxPP !== undefined
        ? oppRoles.filter((c) => this.ctx.fieldMgr.calculateRoleEffectivePP(c.instanceId) <= maxPP)
        : oppRoles;

      if (eligible.length > 0) {
        this.ctx.setPendingChoice({
          id: `choice-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          playerId,
          choiceType: 'SELECT_CARDS',
          prompt: `【${cardDef.name}】发动：请选择对方战场1张角色破坏：`,
          options: oppRoles.map((c) => {
            const pp = this.ctx.fieldMgr.calculateRoleEffectivePP(c.instanceId);
            const isEligible = maxPP === undefined || pp <= maxPP;
            return this.createRoleChoiceOption(c, {
              eligible: isEligible,
              ineligibleReason: !isEligible ? `PP(${pp})超过${maxPP}限制` : undefined,
            });
          }),
          effectType: 'DESTROY_ROLE',
          sourceCardInstanceId: cardInstanceId,
          minSelections: 1,
          maxSelections: 1,
        });
        return { success: true };
      }
    }

    // 4. 削减对方角色PP判定
    const reducePPMatch = rules.match(/选择对方战场1张角色.*PP-(\d+)/);
    if (reducePPMatch && reducePPMatch[1]) {
      const oppRoles = this.getOpponentRoles(playerId);
      if (oppRoles.length > 0) {
        const reduction = parseInt(reducePPMatch[1], 10);
        this.ctx.setPendingChoice({
          id: `choice-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          playerId,
          choiceType: 'SELECT_CARDS',
          prompt: `【${cardDef.name}】发动：请选择对方战场1张角色削减PP (-${reduction})：`,
          options: oppRoles.map((c) => this.createRoleChoiceOption(c)),
          effectType: 'DEAL_DAMAGE_TO_ROLE',
          sourceCardInstanceId: cardInstanceId,
          metadata: { damage: reduction },
          minSelections: 1,
          maxSelections: 1,
        });
        return { success: true };
      }
    }

    // 5. 我方角色PP增益
    const buffPPMatch = rules.match(/选择我方战场(?:最多)?1张角色.*PP\+(\d+)/);
    if (buffPPMatch && buffPPMatch[1]) {
      const friendlyRoles = this.getFriendlyRoles(playerId);
      const bonus = parseInt(buffPPMatch[1], 10);
      if (friendlyRoles.length > 0) {
        this.ctx.setPendingChoice({
          id: `choice-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          playerId,
          choiceType: 'SELECT_CARDS',
          prompt: `【${cardDef.name}】发动：请选择我方战场1张角色获得 PP+${bonus}：`,
          options: friendlyRoles.map((c) => this.createRoleChoiceOption(c)),
          effectType: 'BUFF_ROLE_PP',
          sourceCardInstanceId: cardInstanceId,
          metadata: { buffPP: bonus },
          minSelections: rules.includes('最多') ? 0 : 1,
          maxSelections: 1,
        });
        return { success: true };
      }
    }

    // 6. 我方角色DP增益
    const buffDPMatch = rules.match(/选择我方战场(?:最多)?1张角色.*DP\+(\d+)/);
    if (buffDPMatch && buffDPMatch[1]) {
      const friendlyRoles = this.getFriendlyRoles(playerId);
      const bonus = parseInt(buffDPMatch[1], 10);
      if (friendlyRoles.length > 0) {
        this.ctx.setPendingChoice({
          id: `choice-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          playerId,
          choiceType: 'SELECT_CARDS',
          prompt: `【${cardDef.name}】发动：请选择我方战场1张角色获得 DP+${bonus}：`,
          options: friendlyRoles.map((c) => this.createRoleChoiceOption(c)),
          effectType: 'BUFF_ROLE_DP',
          sourceCardInstanceId: cardInstanceId,
          metadata: { buffDP: bonus },
          minSelections: rules.includes('最多') ? 0 : 1,
          maxSelections: 1,
        });
        return { success: true };
      }
    }

    // 6b. 对方角色放置到对方费用区 (如《自由》等)
    if (rules.includes('选择对方战场') && (rules.includes('放置到对方费用区') || rules.includes('放置到费用区'))) {
      const oppRoles = this.getOpponentRoles(playerId);
      if (oppRoles.length > 0) {
        this.ctx.setPendingChoice({
          id: `choice-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          playerId,
          choiceType: 'SELECT_CARDS',
          prompt: `【${cardDef.name}】发动：请选择对方战场1张角色以横置状态放置到对方费用区：`,
          options: oppRoles.map((c) => this.createRoleChoiceOption(c)),
          effectType: 'SEND_ROLE_TO_COST',
          sourceCardInstanceId: cardInstanceId,
          minSelections: 1,
          maxSelections: 1,
        });
        return { success: true };
      }
    }

    // 6c. 对方角色放置到对方牌组底 (如《最后的晚空》等)
    if (rules.includes('选择对方战场') && (rules.includes('放置到对方牌组底') || rules.includes('放置到牌组底'))) {
      const oppRoles = this.getOpponentRoles(playerId);
      if (oppRoles.length > 0) {
        this.ctx.setPendingChoice({
          id: `choice-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          playerId,
          choiceType: 'SELECT_CARDS',
          prompt: `【${cardDef.name}】发动：请选择对方战场1张角色放置到对方牌组底：`,
          options: oppRoles.map((c) => this.createRoleChoiceOption(c)),
          effectType: 'SEND_ROLE_TO_DECK_BOTTOM',
          sourceCardInstanceId: cardInstanceId,
          minSelections: 1,
          maxSelections: 1,
        });
        return { success: true };
      }
    }

    // 6d. 角色竖直
    if (rules.includes('选择我方战场') && rules.includes('将其竖直')) {
      const friendlyRoles = this.getFriendlyRoles(playerId);
      if (friendlyRoles.length > 0) {
        this.ctx.setPendingChoice({
          id: `choice-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          playerId,
          choiceType: 'SELECT_CARDS',
          prompt: `【${cardDef.name}】发动：请选择我方战场1张角色将其竖直：`,
          options: friendlyRoles.map((c) => this.createRoleChoiceOption(c)),
          effectType: 'READY_ROLE',
          sourceCardInstanceId: cardInstanceId,
          minSelections: 1,
          maxSelections: 1,
        });
        return { success: true };
      }
    }

    // 6e. 费用区卡牌加入手牌
    if (rules.includes('选择我方费用区') && rules.includes('加入手牌')) {
      const costCards = this.ctx.zoneMgr.getCardsInZone(playerId, 'COST');
      if (costCards.length > 0) {
        this.ctx.setPendingChoice({
          id: `choice-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          playerId,
          choiceType: 'SELECT_CARDS',
          prompt: `【${cardDef.name}】发动：请选择我方费用区1张卡牌加入手牌：`,
          options: costCards.map((c) => this.createGeneralCardChoiceOption(c)),
          effectType: 'SALVAGE_FROM_COST',
          sourceCardInstanceId: cardInstanceId,
          minSelections: 1,
          maxSelections: 1,
        });
        return { success: true };
      }
    }

    // 7. 墓地角色特殊出场
    if (rules.includes('墓地') && rules.includes('出场')) {
      const costLimitMatch = rules.match(/费用(?:为)?(\d+)及以下/);
      const maxCost = costLimitMatch && costLimitMatch[1] ? parseInt(costLimitMatch[1], 10) : 99;
      const gyRoles = this.ctx.zoneMgr.getCardsInZone(playerId, 'GRAVEYARD').filter((c) => {
        const d = this.getCardDef(c);
        return d?.cardType === CardType.ROLE && (d.cost || 0) <= maxCost;
      });
      if (gyRoles.length > 0 && this.ctx.fieldMgr.findFirstEmptySlot(playerId) !== undefined) {
        this.ctx.setPendingChoice({
          id: `choice-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          playerId,
          choiceType: 'SELECT_CARDS',
          prompt: `【${cardDef.name}】发动：请选择我方墓地1张角色特殊出场：`,
          options: gyRoles.map((c) => this.createGeneralCardChoiceOption(c)),
          effectType: 'RESURRECT_ROLE',
          sourceCardInstanceId: cardInstanceId,
          minSelections: 1,
          maxSelections: 1,
        });
        return { success: true };
      }
    }

    // 8. 检索公开牌组顶卡牌
    const searchMatch = rules.match(/公开(?:我方)?牌组顶(\d+)张牌/);
    if (searchMatch && searchMatch[1]) {
      const count = parseInt(searchMatch[1], 10);
      const isGrave = rules.includes('放置到墓地');
      const isShuffle = rules.includes('洗切');
      return this.revealTopAndSearch(playerId, {
        sourceCardInstanceId: cardInstanceId,
        cardName: cardDef.name,
        count,
        prompt: `【${cardDef.name}】已公开牌组顶${count}张牌，请选择最多1张卡牌加入手牌：`,
        promptNoEligible: `公开卡牌中未检出符合条件的卡牌，点击确认继续：`,
        destination: 'HAND',
        remainingDestination: isGrave ? 'GRAVEYARD' : isShuffle ? 'SHUFFLE_DECK' : 'DECK_BOTTOM',
        minSelections: 0,
        maxSelections: 1,
      });
    }

    // 默认结算完成送入墓地
    this.ctx.zoneMgr.moveCard(cardInstanceId, 'GRAVEYARD', { isFaceUp: true });
    return { success: true };
  }

  // =========================================================================
  // 8. 通用角色【出】能力解析与自动执行引擎
  // =========================================================================
  resolveUniversalEntryEffect(
    playerId: string,
    roleInstanceId: string,
    cardDef: CardVersionData
  ): void {
    const rules = cardDef.rulesText || '';
    if (!rules.includes('【出】')) return;

    const roleCard = this.ctx.state.cards[roleInstanceId];
    if (!roleCard) return;

    // 1. 抽牌
    const drawMatch = rules.match(/【出】.*?抽(\d+)张牌/);
    if (drawMatch && drawMatch[1]) {
      this.ctx.zoneMgr.drawCards(playerId, parseInt(drawMatch[1], 10));
    }

    // 2. 弃手牌代价与后续效果连携
    const costMatch = rules.match(/【出】\s*(?:可以)?丢弃(?:手牌)?(\d+)张(?:手牌)?[：:](.*)/);
    if (costMatch && costMatch[1]) {
      const count = parseInt(costMatch[1], 10);
      const followUpRules = costMatch[2] || '';
      const hand = this.ctx.zoneMgr.getCardsInZone(playerId, 'HAND');
      if (hand.length > 0) {
        this.ctx.setPendingChoice({
          id: `choice-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          playerId,
          choiceType: 'SELECT_CARDS',
          prompt: `【${cardDef.name}】出场能力：可选择 ${count} 张手牌丢弃以触发后续效果 (可跳过)：`,
          options: hand.map((c) => this.createGeneralCardChoiceOption(c, { eligible: true })),
          effectType: 'UNIVERSAL_ENTRY_DISCARD_COST',
          sourceCardInstanceId: roleInstanceId,
          metadata: {
            followUpRules,
            sourceRoleInstanceId: roleInstanceId,
            cardName: cardDef.name,
          },
          minSelections: 0,
          maxSelections: count,
        });
        return;
      }
    } else {
      const discardMatch = rules.match(/【出】.*?丢弃(\d+)张手牌/);
      if (discardMatch && discardMatch[1]) {
        const count = parseInt(discardMatch[1], 10);
        const hand = this.ctx.zoneMgr.getCardsInZone(playerId, 'HAND');
        if (hand.length > 0) {
          this.ctx.setPendingChoice({
            id: `choice-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            playerId,
            choiceType: 'SELECT_CARDS',
            prompt: `【${cardDef.name}】出场效果：请选择 ${count} 张手牌丢弃到墓地：`,
            options: hand.map((c) => this.createGeneralCardChoiceOption(c)),
            effectType: 'DISCARD_HAND_CARD',
            sourceCardInstanceId: roleInstanceId,
            minSelections: Math.min(count, hand.length),
            maxSelections: Math.min(count, hand.length),
          });
          return;
        }
      }
    }

    // 3. 自身PP增益
    const selfPPMatch = rules.match(/【出】.*?(?:该牌|自身).*?PP\+(\d+)/);
    if (selfPPMatch && selfPPMatch[1]) {
      roleCard.tempPPBonus = (roleCard.tempPPBonus || 0) + parseInt(selfPPMatch[1], 10);
    }

    // 4. 全队PP增益
    const allPPMatch = rules.match(/【出】.*?所有角色PP\+(\d+)/);
    if (allPPMatch && allPPMatch[1]) {
      const bonus = parseInt(allPPMatch[1], 10);
      for (const r of this.getFriendlyRoles(playerId)) {
        r.tempPPBonus = (r.tempPPBonus || 0) + bonus;
      }
    }

    // 5. 破坏对方角色
    if (rules.includes('【出】') && rules.includes('破坏') && rules.includes('对方战场')) {
      const oppRoles = this.getOpponentRoles(playerId);
      const ppLimitMatch = rules.match(/PP为(\d+)及以下/);
      const maxPP = ppLimitMatch && ppLimitMatch[1] ? parseInt(ppLimitMatch[1], 10) : undefined;
      const eligible = maxPP !== undefined
        ? oppRoles.filter((c) => this.ctx.fieldMgr.calculateRoleEffectivePP(c.instanceId) <= maxPP)
        : oppRoles;
      if (eligible.length > 0) {
        this.ctx.setPendingChoice({
          id: `choice-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          playerId,
          choiceType: 'SELECT_CARDS',
          prompt: `【${cardDef.name}】出场：请选择对方战场1张角色破坏：`,
          options: oppRoles.map((c) => {
            const pp = this.ctx.fieldMgr.calculateRoleEffectivePP(c.instanceId);
            const isEligible = maxPP === undefined || pp <= maxPP;
            return this.createRoleChoiceOption(c, {
              eligible: isEligible,
              ineligibleReason: !isEligible ? `PP(${pp})超过${maxPP}限制` : undefined,
            });
          }),
          effectType: 'DESTROY_ROLE',
          sourceCardInstanceId: roleInstanceId,
          minSelections: 1,
          maxSelections: 1,
        });
      }
    }

    // 6. 削减对方PP
    const reduceMatch = rules.match(/【出】.*?选择对方战场1张角色.*?PP-(\d+)/);
    if (reduceMatch && reduceMatch[1]) {
      const oppRoles = this.getOpponentRoles(playerId);
      if (oppRoles.length > 0) {
        const reduction = parseInt(reduceMatch[1], 10);
        this.ctx.setPendingChoice({
          id: `choice-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          playerId,
          choiceType: 'SELECT_CARDS',
          prompt: `【${cardDef.name}】出场：请选择对方战场1张角色削减PP (-${reduction})：`,
          options: oppRoles.map((c) => this.createRoleChoiceOption(c)),
          effectType: 'DEAL_DAMAGE_TO_ROLE',
          sourceCardInstanceId: roleInstanceId,
          metadata: { damage: reduction },
          minSelections: 1,
          maxSelections: 1,
        });
      }
    }

    // 7. 信号球回收
    if (rules.includes('【出】') && rules.includes('信号球区最上方')) {
      const gyOrb = this.ctx.zoneMgr.getCardsInZone(playerId, 'GRAVEYARD').find((c) => {
        const d = this.getCardDef(c);
        return !!d?.signalOrb || c.cardNumber.startsWith('ORB-') || d?.name?.includes('信号球');
      });
      if (gyOrb) {
        this.ctx.zoneMgr.moveCard(gyOrb.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
      }
    }

    // 8. 墓地角色出场 / 墓地卡牌回收
    if (rules.includes('【出】') && rules.includes('选择我方墓地') && rules.includes('出场')) {
      const gyRoles = this.ctx.zoneMgr.getCardsInZone(playerId, 'GRAVEYARD').filter((c) => {
        const d = this.getCardDef(c);
        return d?.cardType === CardType.ROLE;
      });
      if (gyRoles.length > 0 && this.ctx.fieldMgr.findFirstEmptySlot(playerId) !== undefined) {
        this.ctx.setPendingChoice({
          id: `choice-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          playerId,
          choiceType: 'SELECT_CARDS',
          prompt: `【${cardDef.name}】出场：请选择我方墓地1张角色特殊出场：`,
          options: gyRoles.map((c) => this.createGeneralCardChoiceOption(c)),
          effectType: 'RESURRECT_ROLE',
          sourceCardInstanceId: roleInstanceId,
          minSelections: 1,
          maxSelections: 1,
        });
      }
    } else if (rules.includes('【出】') && rules.includes('选择我方墓地') && rules.includes('加入手牌')) {
      const gyCards = this.ctx.zoneMgr.getCardsInZone(playerId, 'GRAVEYARD');
      if (gyCards.length > 0) {
        this.ctx.setPendingChoice({
          id: `choice-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          playerId,
          choiceType: 'SELECT_CARDS',
          prompt: `【${cardDef.name}】出场：请选择我方墓地1张卡牌回收至手牌：`,
          options: gyCards.map((c) => this.createGeneralCardChoiceOption(c)),
          effectType: 'SALVAGE_TO_HAND',
          sourceCardInstanceId: roleInstanceId,
          minSelections: 1,
          maxSelections: 1,
        });
      }
    }

    // 9. 牌组顶公开检索
    const entrySearchMatch = rules.match(/【出】.*?公开(?:我方)?牌组顶(\d+)张牌/);
    if (entrySearchMatch && entrySearchMatch[1]) {
      const count = parseInt(entrySearchMatch[1], 10);
      const isGrave = rules.includes('放置到墓地');
      const isShuffle = rules.includes('洗切') || rules.includes('洗牌');
      const isRoleToField = rules.includes('出场');
      const remainingDestination = isGrave ? 'GRAVEYARD' : isShuffle ? 'SHUFFLE_DECK' : 'DECK_BOTTOM';

      this.revealTopAndSearch(playerId, {
        sourceCardInstanceId: roleInstanceId,
        cardName: cardDef.name,
        count,
        prompt: `【${cardDef.name}】出场能力：请从公开的卡牌中选择${isRoleToField ? '登场角色' : '加入手牌的卡牌'}：`,
        promptNoEligible: `【${cardDef.name}】公开卡牌中未检出符合条件的卡牌，将全部送入${remainingDestination === 'GRAVEYARD' ? '墓地' : '牌组'}。`,
        destination: isRoleToField ? 'BATTLEFIELD' : 'HAND',
        remainingDestination,
        minSelections: 0,
        maxSelections: 1,
      });
    }

    this.ctx.events.push({
      type: 'ABILITY_ACTIVATED',
      playerId,
      cardInstanceId: roleInstanceId,
      abilityName: `${cardDef.name}【出】能力`,
      rulesText: cardDef.rulesText,
    });
  }

  // =========================================================================
  // 9. 通用起动能力【起】解析执行引擎
  // =========================================================================
  resolveUniversalActivatedEffect(
    playerId: string,
    sourceCardId: string,
    cardDef: CardVersionData
  ): { success: boolean; error?: string } {
    const card = this.ctx.state.cards[sourceCardId];
    if (!card) return { success: false, error: '未找到来源卡牌' };
    const rules = cardDef.rulesText || '';

    // 1. 判定并扣除费用代价
    const costMatch = rules.match(/【起】.*?(?:【(\d+)费】|\[费用(\d+)\])/);
    if (costMatch) {
      const rawCost = costMatch[1] || costMatch[2];
      if (rawCost) {
        const cost = parseInt(rawCost, 10);
        if (cost > 0 && !this.ctx.payCost(playerId, cost)) {
          return { success: false, error: `费用不足，需要支付 ${cost} 费用` };
        }
      }
    }

    // 2. 判定并横置自身
    if (rules.includes('【起】横置该牌') || rules.includes('【起】: 横置该牌') || rules.includes('【起】：横置该牌')) {
      if (!card.isReady) {
        return { success: false, error: '该角色已经处于横置状态，无法再次发动' };
      }
      card.isReady = false;
    }

    // 3. 效果伤害
    const dmgMatch = rules.match(/造成(\d+)点效果伤害/);
    if (dmgMatch && dmgMatch[1]) {
      const oppRoles = this.getOpponentRoles(playerId);
      if (oppRoles.length === 0) {
        return { success: false, error: '对方战场没有可指定的目标角色' };
      }
      const dmg = parseInt(dmgMatch[1], 10);
      this.ctx.setPendingChoice({
        id: `choice-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        playerId,
        choiceType: 'SELECT_CARDS',
        prompt: `【${cardDef.name}】起动能力：请选择对方战场1张角色造成 ${dmg} 点效果伤害：`,
        options: oppRoles.map((c) => this.createRoleChoiceOption(c)),
        effectType: 'DEAL_DAMAGE_TO_ROLE',
        sourceCardInstanceId: sourceCardId,
        metadata: { damage: dmg },
        minSelections: 1,
        maxSelections: 1,
      });
      return { success: true };
    }

    // 4. 浮空处理
    if (rules.includes('将该牌【浮空】') || rules.includes('将手牌的该牌【浮空】')) {
      this.ctx.fieldMgr.handleCardLeaveField(sourceCardId);
      this.ctx.zoneMgr.moveCard(sourceCardId, 'PROCESSING', { isFaceUp: true });
      this.ctx.events.push({
        type: 'ABILITY_ACTIVATED',
        playerId,
        cardInstanceId: sourceCardId,
        abilityName: `${cardDef.name} 进入浮空模式`,
        rulesText: '卡牌进入处理区变为浮空模式',
      });
      return { success: true };
    }

    // 5. 抽牌
    const drawMatch = rules.match(/【起】.*?抽(\d+)张牌/);
    if (drawMatch && drawMatch[1]) {
      this.ctx.zoneMgr.drawCards(playerId, parseInt(drawMatch[1], 10));
    }

    this.ctx.events.push({
      type: 'ABILITY_ACTIVATED',
      playerId,
      cardInstanceId: sourceCardId,
      abilityName: `${cardDef.name} 起动能力发动`,
      rulesText: cardDef.rulesText,
    });
    return { success: true };
  }
}

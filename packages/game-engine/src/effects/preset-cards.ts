import { CardInstance, CardModifier, CardType, CardVersionData, GameAction, PendingChoice } from '@zhanshuang/shared';
import type { CardEffectContext, CardEffectEngine } from './card-effects.js';

type Result = { success: boolean; error?: string };
type ChoiceAction = Extract<GameAction, { type: 'SELECT_CHOICE_OPTION' }>;
type OrbFilter = 'ANY' | 'SAME' | 'RED' | 'BLUE' | 'YELLOW';

/**
 * 官方预组 ST01 (灰鸦小队)、ST02 (升格者)、ST03 (三头犬小队) 的卡牌效果。
 *
 * 逐卡按卡牌文本精确实现：代价 (8.4) 在效果前支付，「可以」的代价可以不支付，
 * 「若如此做」只在前段实际执行时继续 (8.6.4)，选择须在可能范围内选满 (8.6.3.a)。
 * 需要玩家决策的步骤以 PendingChoice 暂停，后续步骤所需的数据保存在 metadata 中 (可随快照恢复)。
 *
 * 信号球牌 (ST0x-012~014) 的【充能自】与其他卡包通用，由 CardEffectEngine.handleChargeAutoEffect 处理。
 */
export class PresetCardEffects {
  constructor(
    private ctx: CardEffectContext,
    private effects: CardEffectEngine
  ) {}

  // ===================================================================
  // 分派
  // ===================================================================

  handlesTactics(cardNumber: string): boolean {
    return ['ST01-009', 'ST01-010', 'ST01-011', 'ST02-010', 'ST02-011', 'ST03-010', 'ST03-011'].includes(cardNumber);
  }

  handlesEntry(cardNumber: string): boolean {
    return [
      'ST01-001', 'ST01-002', 'ST01-003', 'ST01-005',
      'ST02-003', 'ST02-006', 'ST02-007',
      'ST03-001', 'ST03-003', 'ST03-006',
    ].includes(cardNumber);
  }

  handlesActivation(cardNumber: string): boolean {
    return ['ST01-001', 'ST02-001', 'ST02-008', 'ST03-002', 'ST03-008'].includes(cardNumber);
  }

  /** 预组中没有【出】能力的角色：出场时不执行任何效果，不再交给按关键字近似的通用解析 */
  isVanillaEntry(cardNumber: string): boolean {
    return [
      'ST01-004', 'ST01-006', 'ST01-007', 'ST01-008',
      'ST02-001', 'ST02-002', 'ST02-004', 'ST02-005', 'ST02-008',
      'ST03-002', 'ST03-004', 'ST03-005', 'ST03-007', 'ST03-008', 'ST03-009',
    ].includes(cardNumber);
  }

  playTactics(playerId: string, cardId: string, def: CardVersionData): Result {
    switch (def.cardNumber) {
      case 'ST01-009': {
        // 抽1张牌。选择我方战场1张<灰鸦小队>角色，直到回合结束为止，其PP+2000。
        this.ctx.zoneMgr.drawCards(playerId, 1);
        this.chooseRoles(playerId, cardId, 'PRESET_ST01_009_BUFF', `【${def.name}】选择我方战场1张<灰鸦小队>角色，直到回合结束为止 PP+2000`,
          this.roles(playerId).filter((r) => this.hasTrait(r, '灰鸦小队')));
        return { success: true };
      }
      case 'ST01-010': {
        // 公开我方牌组顶5张牌，选择其中1张<灰鸦小队>角色加入手牌，将剩余的牌按任意顺序放置到牌组底。
        const revealed = this.revealTop(playerId, 5);
        this.chooseRevealed(playerId, cardId, 'PRESET_ST01_010_PICK', `【${def.name}】选择其中1张<灰鸦小队>角色加入手牌 (剩余的牌放置到牌组底)`, revealed,
          (c) => this.isRole(c) && this.hasTrait(c, '灰鸦小队'), 1);
        return { success: true };
      }
      case 'ST01-011': {
        // 该牌只能在我方战场存在<露西亚>角色时才能使用。选择对方战场1张PP为8000及以下的角色，将其破坏。
        if (!this.roles(playerId).some((r) => this.hasTrait(r, '露西亚'))) {
          return { success: false, error: '该牌只能在我方战场存在<露西亚>角色时才能使用' };
        }
        this.chooseRoles(playerId, cardId, 'PRESET_DESTROY', `【${def.name}】选择对方战场1张PP为8000及以下的角色破坏`,
          this.roles(this.opponent(playerId)),
          (r) => this.ctx.fieldMgr.calculateRoleEffectivePP(r.instanceId) <= 8000, 'PP 超过 8000');
        return { success: true };
      }
      case 'ST02-010': {
        // 该牌只能在我方战场存在《露娜·银冕》时才能使用。选择对方战场1张角色，直到回合结束为止，我方侵蚀计数每有1，其PP-2000。
        if (!this.roles(playerId).some((r) => this.def(r)?.name === '露娜·银冕')) {
          return { success: false, error: '该牌只能在我方战场存在《露娜·银冕》时才能使用' };
        }
        const erosion = this.ctx.state.players[playerId]!.erosionCount;
        this.chooseRoles(playerId, cardId, 'PRESET_PP_DOWN', `【${def.name}】选择对方战场1张角色，直到回合结束为止 PP-${erosion * 2000}`,
          this.roles(this.opponent(playerId)), undefined, undefined, { amount: erosion * 2000 });
        return { success: true };
      }
      case 'ST02-011': {
        // 该牌只能在我方战场存在《露娜·银冕》时才能使用。【瞬时】：我方玩家被攻击时才能发动。
        // 选择我方墓地1张费用为3及以下的<升格者>角色，将其出场。若我方侵蚀计数为4及以下，则其获得“【自】：该回合结束时，将该牌放置到墓地。”
        if (!this.roles(playerId).some((r) => this.def(r)?.name === '露娜·银冕')) {
          return { success: false, error: '该牌只能在我方战场存在《露娜·银冕》时才能使用' };
        }
        const candidates = this.zone(playerId, 'GRAVEYARD').filter(
          (c) => this.isRole(c) && this.hasTrait(c, '升格者') && (this.def(c)?.cost ?? 99) <= 3
        );
        this.chooseCards(playerId, cardId, 'PRESET_ST02_011_REVIVE', `【${def.name}】选择我方墓地1张费用为3及以下的<升格者>角色出场`,
          candidates, () => this.hasEmptySlot(playerId), 1, '战场没有空余卡位');
        return { success: true };
      }
      case 'ST03-010': {
        // 抽2张牌。直到下个回合结束为止，我方战场所有横置状态的<三头犬小队>角色PP+1000。(8.9.2 只作用于此时符合条件的角色)
        this.ctx.zoneMgr.drawCards(playerId, 2);
        for (const r of this.roles(playerId)) {
          if (!r.isReady && this.hasTrait(r, '三头犬小队')) {
            this.addModifier(r, { pp: 1000, untilTurn: this.ctx.state.turnNumber + 1, source: 'ST03-010' });
          }
        }
        return { success: true };
      }
      case 'ST03-011': {
        // 选择对方战场1张角色，将其破坏。(手牌中的减费由引擎计算)
        this.chooseRoles(playerId, cardId, 'PRESET_DESTROY', `【${def.name}】选择对方战场1张角色破坏`, this.roles(this.opponent(playerId)));
        return { success: true };
      }
    }
    return { success: false, error: '未实现的战术牌' };
  }

  enter(playerId: string, roleId: string, def: CardVersionData): void {
    const hand = this.zone(playerId, 'HAND');
    switch (def.cardNumber) {
      case 'ST01-001':
        // 【出】丢弃1张手牌：公开我方牌组顶5张牌，选择其中1张费用为3及以下的<灰鸦小队>角色出场，将剩余的牌按任意顺序放置到牌组底。
        this.askDiscardCost(playerId, roleId, 'PRESET_ST01_001_ENTER', `【${def.name}】【出】是否丢弃1张手牌：公开牌组顶5张，选择其中1张费用3及以下的<灰鸦小队>角色出场？`, hand);
        return;
      case 'ST01-002':
        // 【出】：可以将我方牌组顶3张牌放置到墓地。若其中有信号球，选择我方战场1张<灰鸦小队>角色，直到回合结束为止，其获得【充能+1】。
        this.enqueue({
          id: this.choiceId('st01-002'),
          playerId,
          choiceType: 'SELECT_OPTION',
          prompt: `【${def.name}】【出】是否将牌组顶3张牌放置到墓地？(若其中有信号球，选择1张<灰鸦小队>角色获得【充能+1】)`,
          options: [
            { id: 'opt_yes', label: '放置到墓地' },
            { id: 'opt_no', label: '不放置' },
          ],
          effectType: 'PRESET_ST01_002_MILL',
          sourceCardInstanceId: roleId,
          minSelections: 1,
          maxSelections: 1,
        });
        return;
      case 'ST01-003':
        // 【出】：选择我方墓地1张信号球，将其放置到我方信号球区最上方。
        this.chooseCards(playerId, roleId, 'PRESET_ORB_FROM_GRAVEYARD', `【${def.name}】选择我方墓地1张信号球放置到信号球区最上方`,
          this.zone(playerId, 'GRAVEYARD').filter((c) => this.isOrb(c)), undefined, 1);
        return;
      case 'ST01-005':
        // 【出】：抽1张牌，丢弃1张手牌。
        this.ctx.zoneMgr.drawCards(playerId, 1);
        this.chooseCards(playerId, roleId, 'PRESET_DISCARD', `【${def.name}】选择1张手牌丢弃`, this.zone(playerId, 'HAND'), undefined, 1);
        return;
      case 'ST02-003':
        // 【出】丢弃1张手牌：公开我方牌组顶3张牌，选择其中1张<升格者>角色加入手牌，将剩余的牌放置到墓地。
        this.askDiscardCost(playerId, roleId, 'PRESET_ST02_003_ENTER', `【${def.name}】【出】是否丢弃1张手牌：公开牌组顶3张，选择其中1张<升格者>角色加入手牌？`, hand);
        return;
      case 'ST02-006': {
        // 【出】：将我方信号球区的牌按任意顺序排列。
        const orbs = this.zone(playerId, 'SIGNAL_ORB');
        if (orbs.length <= 1) return;
        this.enqueue({
          id: this.choiceId('st02-006'),
          playerId,
          choiceType: 'SELECT_CARDS',
          prompt: `【${def.name}】【出】按从下到上的顺序依次点选信号球区的全部 ${orbs.length} 张牌，以重新排列`,
          options: orbs.map((c) => this.effects.createGeneralCardChoiceOption(c)),
          effectType: 'PRESET_ST02_006_ORDER',
          sourceCardInstanceId: roleId,
          minSelections: orbs.length,
          maxSelections: orbs.length,
        });
        return;
      }
      case 'ST02-007':
        // 【出】丢弃1张手牌：选择我方墓地1张<升格者>角色，将其加入手牌。
        this.askDiscardCost(playerId, roleId, 'PRESET_ST02_007_ENTER', `【${def.name}】【出】是否丢弃1张手牌：选择墓地1张<升格者>角色加入手牌？`, hand);
        return;
      case 'ST03-001': {
        // 【出】消除2同色信号球：选择我方战场1张<三头犬小队>角色，将其竖直。直到回合结束为止，我方战场所有<三头犬小队>角色PP+2000。
        this.askOrbCost(playerId, roleId, 'SAME', 2, 'PRESET_ST03_001_ENTER', `【${def.name}】【出】是否消除2张相邻的同色信号球：竖直1张<三头犬小队>角色，所有<三头犬小队>角色 PP+2000？`);
        return;
      }
      case 'ST03-003': {
        // 【出】消除【任意信号球】或丢弃1张手牌：公开我方牌组顶5张牌。选择其中最多1张<21号>和最多1张<诺克提>加入手牌，将剩余的牌放置到墓地。
        const options = [
          { id: 'skip', label: '不支付代价 (不发动)' },
          ...this.zone(playerId, 'SIGNAL_ORB')
            .filter((c) => this.isOrb(c))
            .map((c) => ({ id: `orb:${c.instanceId}`, label: `消除信号球【${this.def(c)?.name ?? c.cardNumber}】` })),
          ...hand.map((c) => ({ id: `hand:${c.instanceId}`, label: `丢弃手牌【${this.def(c)?.name ?? c.cardNumber}】` })),
        ];
        if (options.length === 1) return;
        this.enqueue({
          id: this.choiceId('st03-003'),
          playerId,
          choiceType: 'SELECT_OPTION',
          prompt: `【${def.name}】【出】是否消除1张信号球或丢弃1张手牌：公开牌组顶5张，选择最多1张<21号>和最多1张<诺克提>加入手牌？`,
          options,
          effectType: 'PRESET_ST03_003_COST',
          sourceCardInstanceId: roleId,
          minSelections: 1,
          maxSelections: 1,
        });
        return;
      }
      case 'ST03-006':
        // 【出】丢弃1张手牌：若我方战场的<三头犬小队>角色为3张及以上，选择我方墓地1张信号球，将其放置到我方信号球区最上方。
        this.askDiscardCost(playerId, roleId, 'PRESET_ST03_006_ENTER', `【${def.name}】【出】是否丢弃1张手牌：若我方战场<三头犬小队>角色为3张及以上，将墓地1张信号球放置到信号球区最上方？`, hand);
        return;
    }
  }

  activate(playerId: string, cardId: string, def: CardVersionData): Result {
    const card = this.ctx.state.cards[cardId]!;
    const player = this.ctx.state.players[playerId]!;
    const usedThisTurn = (player.turnAbilityUsage[cardId] ?? 0) > 0;

    switch (def.cardNumber) {
      case 'ST01-001':
        // 【起】消除【2蓝色信号球】：选择我方战场1张角色返回手牌。若如此做，选择我方手牌1张费用为4及以下的<灰鸦小队>角色出场。
        return this.payOrbCostThen(playerId, cardId, 'BLUE', 2, 'PRESET_ST01_001_ACT');
      case 'ST02-001':
        // 【起】【回合1】消除【2蓝色信号球】：选择我方墓地1张费用为4及以下的<升格者>角色，将其出场。
        if (usedThisTurn) return { success: false, error: '该能力本回合已发动过 (【回合1】)' };
        return this.payOrbCostThen(playerId, cardId, 'BLUE', 2, 'PRESET_ST02_001_ACT');
      case 'ST02-008':
        // 【起】【回合1】消除【任意信号球】：可以将我方侵蚀计数+1。若如此做，直到回合结束为止，该牌DP+1。
        if (usedThisTurn) return { success: false, error: '该能力本回合已发动过 (【回合1】)' };
        return this.payOrbCostThen(playerId, cardId, 'ANY', 1, 'PRESET_ST02_008_ACT');
      case 'ST03-002':
      case 'ST03-008': {
        // 【起】横置该牌：直到回合结束为止，我方使用的下1张<三头犬小队>/<薇拉>角色的费用-2/-1 (不包含升变费用)
        if (!card.isReady) return { success: false, error: '该牌已横置，无法支付「横置该牌」的代价' };
        card.isReady = false;
        const isVera = def.cardNumber === 'ST03-002';
        player.costModifiers = [
          ...(player.costModifiers ?? []),
          {
            id: `cost-mod-${cardId}-${this.ctx.events.length}`,
            amount: isVera ? 2 : 1,
            targetTrait: isVera ? '三头犬小队' : '薇拉',
            cardType: CardType.ROLE,
            excludeAscension: true,
            remainingCount: 1,
          },
        ];
        this.logAbility(playerId, cardId, def, `横置该牌：下1张<${isVera ? '三头犬小队' : '薇拉'}>角色费用-${isVera ? 2 : 1}`);
        return { success: true };
      }
    }
    return { success: false, error: '未实现的起动能力' };
  }

  /**
   * 8.9 永久能力带来的 PP 增减
   */
  staticPP(cardId: string): number {
    const state = this.ctx.state;
    const card = state.cards[cardId];
    if (!card) return 0;
    const ownerId = card.controllerPlayerId;
    const player = state.players[ownerId];
    if (!player) return 0;
    const isOpponentTurn = state.activePlayerId !== ownerId;
    let bonus = 0;

    // 自身的永久能力
    switch (card.cardNumber) {
      case 'ST02-004': // 若我方墓地的牌为10张及以上，该牌PP+1500
        if (this.zone(ownerId, 'GRAVEYARD').length >= 10) bonus += 1500;
        break;
      case 'ST02-006': // 若我方的侵蚀计数为4及以上，该牌PP+1000
        if (player.erosionCount >= 4) bonus += 1000;
        break;
      case 'ST02-008': // 若我方战场存在<升格者>角色，该牌PP+1000
        if (this.roles(ownerId).some((r) => this.hasTrait(r, '升格者'))) bonus += 1000;
        break;
      case 'ST03-004': // 对方回合中，横置状态的该牌PP+1000
        if (isOpponentTurn && !card.isReady) bonus += 1000;
        break;
    }

    // 战场上其他角色的永久能力
    for (const source of this.roles(ownerId)) {
      if (source.cardNumber === 'ST02-001' && player.erosionCount >= 5 && this.hasTrait(card, '升格者')) {
        bonus += 1000; // 若我方侵蚀计数为5及以上，我方战场所有<升格者>角色PP+1000
      }
      if (source.cardNumber === 'ST03-002' && isOpponentTurn && !card.isReady && this.hasTrait(card, '三头犬小队')) {
        bonus += 1000; // 对方回合中，我方战场所有横置状态的<三头犬小队>角色PP+1000
      }
    }
    return bonus;
  }

  /**
   * 7.2.1.d「攻击时」触发：ST02-009 奥兹玛赋予《露娜·银冕》的自动能力
   */
  onAttackDeclared(attackerId: string): void {
    const attacker = this.ctx.state.cards[attackerId];
    if (!attacker?.attachedEquipmentId) return;
    const equip = this.ctx.state.cards[attacker.attachedEquipmentId];
    if (equip?.cardNumber !== 'ST02-009' || this.def(attacker)?.name !== '露娜·银冕') return;
    // 【自】：该牌攻击时，可以消除2同色信号球。若如此做，选择对方战场1张角色，直到回合结束为止，其PP-4000。
    this.askOrbCost(attacker.controllerPlayerId, attackerId, 'SAME', 2, 'PRESET_ST02_009_ATTACK',
      '【奥兹玛】攻击时，是否消除2张相邻的同色信号球：选择对方战场1张角色 PP-4000？');
  }

  /**
   * 角色出场时触发其他卡牌的自动能力：ST03-009「我方1张《薇拉·瑰丽》出场时」
   */
  onRoleEntered(playerId: string, enteredId: string): void {
    const entered = this.ctx.state.cards[enteredId];
    if (!entered || this.def(entered)?.name !== '薇拉·瑰丽') return;
    for (const partner of this.roles(playerId)) {
      if (partner.cardNumber !== 'ST03-009') continue;
      // 【自】：我方1张《薇拉·瑰丽》出场时，可以消除【2红色信号球】。若如此做，将该牌竖直。直到回合结束为止，该牌PP+2000，DP-1。
      this.askOrbCost(playerId, partner.instanceId, 'RED', 2, 'PRESET_ST03_009_TRIGGER',
        '【可靠的伙伴 21号&诺克提】《薇拉·瑰丽》出场，是否消除2张相邻的红色信号球：竖直该牌，PP+2000，DP-1？');
    }
  }

  // ===================================================================
  // 决策处理
  // ===================================================================

  resolveChoice(action: ChoiceAction, choice: PendingChoice): Result {
    const playerId = action.playerId;
    const selected = action.selectedIds;
    const meta = (choice.metadata ?? {}) as Record<string, any>;
    const sourceId = choice.sourceCardInstanceId ?? '';
    const turn = this.ctx.state.turnNumber;

    switch (choice.effectType) {
      // ---------- 通用 ----------
      case 'PRESET_DESTROY':
        for (const id of selected) this.destroy(id);
        return { success: true };
      case 'PRESET_PP_DOWN':
        for (const id of selected) {
          const card = this.ctx.state.cards[id];
          if (card) this.addModifier(card, { pp: -(meta.amount as number), untilTurn: turn, source: this.sourceNumber(sourceId) });
        }
        return { success: true };
      case 'PRESET_DISCARD':
        for (const id of selected) this.ctx.zoneMgr.moveCard(id, 'GRAVEYARD', { isFaceUp: true });
        return { success: true };
      case 'PRESET_ORB_FROM_GRAVEYARD':
        for (const id of selected) this.ctx.zoneMgr.moveCard(id, 'SIGNAL_ORB', { isFaceUp: true });
        return { success: true };

      // ---------- 代价支付 ----------
      case 'PRESET_ORB_COST': {
        const group = selected[0];
        if (!group || group === 'skip') return { success: true };
        const ids = group.split(',');
        this.eliminate(playerId, ids);
        return this.afterOrbCost(playerId, sourceId, meta.next as string);
      }
      case 'PRESET_DISCARD_COST': {
        if (selected.length === 0) return { success: true };
        this.ctx.zoneMgr.moveCard(selected[0]!, 'GRAVEYARD', { isFaceUp: true });
        return this.afterDiscardCost(playerId, sourceId, meta.next as string);
      }

      // ---------- ST01 ----------
      case 'PRESET_ST01_002_MILL': {
        if (selected[0] !== 'opt_yes') return { success: true };
        const milled = this.mill(playerId, 3);
        if (milled.some((id) => this.isOrb(this.ctx.state.cards[id]!))) {
          this.chooseRoles(playerId, sourceId, 'PRESET_ST01_002_CHARGE', '【里·异火】翻出了信号球：选择我方战场1张<灰鸦小队>角色，直到回合结束为止获得【充能+1】',
            this.roles(playerId).filter((r) => this.hasTrait(r, '灰鸦小队')));
        }
        return { success: true };
      }
      case 'PRESET_ST01_002_CHARGE':
        for (const id of selected) {
          this.addModifier(this.ctx.state.cards[id]!, { charge: 1, untilTurn: turn, source: 'ST01-002' });
        }
        return { success: true };
      case 'PRESET_ST01_009_BUFF':
        for (const id of selected) {
          this.addModifier(this.ctx.state.cards[id]!, { pp: 2000, untilTurn: turn, source: 'ST01-009' });
        }
        return { success: true };
      case 'PRESET_ST01_010_PICK':
        for (const id of selected) this.ctx.zoneMgr.moveCard(id, 'HAND', { isFaceUp: true });
        this.restToDeckBottom(meta.revealed as string[], selected);
        return { success: true };
      case 'PRESET_ST01_001_PICK':
        for (const id of selected) this.bringToField(playerId, id);
        this.restToDeckBottom(meta.revealed as string[], selected);
        return { success: true };
      case 'PRESET_ST01_001_BOUNCE': {
        const id = selected[0];
        if (!id) return { success: true };
        this.ctx.zoneMgr.moveCard(id, 'HAND', { isFaceUp: true });
        // 若如此做，选择我方手牌1张费用为4及以下的<灰鸦小队>角色出场
        const candidates = this.zone(playerId, 'HAND').filter(
          (c) => this.isRole(c) && this.hasTrait(c, '灰鸦小队') && (this.def(c)?.cost ?? 99) <= 4
        );
        this.chooseCards(playerId, sourceId, 'PRESET_DEPLOY', '【露西亚·红莲】选择我方手牌1张费用为4及以下的<灰鸦小队>角色出场',
          candidates, () => this.hasEmptySlot(playerId), 1, '战场没有空余卡位');
        return { success: true };
      }
      case 'PRESET_DEPLOY':
        for (const id of selected) this.bringToField(playerId, id);
        return { success: true };

      // ---------- ST02 ----------
      case 'PRESET_ST02_003_PICK':
        for (const id of selected) this.ctx.zoneMgr.moveCard(id, 'HAND', { isFaceUp: true });
        this.restToGraveyard(meta.revealed as string[], selected);
        return { success: true };
      case 'PRESET_ST02_006_ORDER':
        // 按选择顺序 (从下到上) 重新排列信号球区：依次移到区域最上方
        for (const id of selected) {
          const card = this.ctx.state.cards[id];
          if (!card || card.zone !== 'SIGNAL_ORB') continue;
          delete this.ctx.state.cards[id];
          this.ctx.state.cards[id] = card;
        }
        return { success: true };
      case 'PRESET_TO_HAND':
        for (const id of selected) this.ctx.zoneMgr.moveCard(id, 'HAND', { isFaceUp: true });
        return { success: true };
      case 'PRESET_ST02_011_REVIVE':
        for (const id of selected) {
          if (!this.bringToField(playerId, id)) continue;
          if (this.ctx.state.players[playerId]!.erosionCount <= 4) {
            this.ctx.state.cards[id]!.endOfTurnToGraveyard = turn;
          }
        }
        return { success: true };
      case 'PRESET_ST02_008_EROSION': {
        if (selected[0] !== 'opt_yes') return { success: true };
        const player = this.ctx.state.players[playerId]!;
        const previous = player.erosionCount;
        player.erosionCount += 1; // 4.10.2 侵蚀计数增加不是伤害
        this.ctx.events.push({ type: 'EROSION_INCREASED', playerId, previousValue: previous, newValue: player.erosionCount, reason: 'EFFECT' });
        const card = this.ctx.state.cards[sourceId];
        if (card && this.ctx.fieldMgr.isSlotRole(playerId, sourceId)) {
          this.addModifier(card, { dp: 1, untilTurn: turn, source: 'ST02-008' });
        }
        return { success: true };
      }

      // ---------- ST03 ----------
      case 'PRESET_ST03_001_READY': {
        for (const id of selected) {
          const card = this.ctx.state.cards[id];
          if (card) card.isReady = true;
        }
        // 直到回合结束为止，我方战场所有<三头犬小队>角色PP+2000 (8.9.2 只作用于此时在场的角色)
        for (const r of this.roles(playerId)) {
          if (this.hasTrait(r, '三头犬小队')) this.addModifier(r, { pp: 2000, untilTurn: turn, source: 'ST03-001' });
        }
        return { success: true };
      }
      case 'PRESET_ST03_003_COST': {
        const pick = selected[0];
        if (!pick || pick === 'skip') return { success: true };
        const [kind, id] = pick.split(':') as [string, string];
        if (kind === 'orb') this.eliminate(playerId, [id]);
        else this.ctx.zoneMgr.moveCard(id, 'GRAVEYARD', { isFaceUp: true });
        const revealed = this.revealTop(playerId, 5);
        const eligible = (c: CardInstance) => this.hasTrait(c, '21号') || this.hasTrait(c, '诺克提');
        this.chooseRevealed(playerId, sourceId, 'PRESET_ST03_003_PICK', '【薇拉·瑰丽】选择其中最多1张<21号>和最多1张<诺克提>加入手牌 (剩余的牌放置到墓地)',
          revealed, eligible, 2, 0);
        return { success: true };
      }
      case 'PRESET_ST03_003_PICK': {
        // 最多1张<21号>和最多1张<诺克提>：所选卡牌须能分别对应到不同的特征
        const cards = selected.map((id) => this.ctx.state.cards[id]!);
        if (cards.length === 2) {
          const [a, b] = cards as [CardInstance, CardInstance];
          const ok =
            (this.hasTrait(a, '21号') && this.hasTrait(b, '诺克提')) ||
            (this.hasTrait(a, '诺克提') && this.hasTrait(b, '21号'));
          if (!ok) return { success: false, error: '只能选择最多1张<21号>和最多1张<诺克提>' };
        }
        for (const id of selected) this.ctx.zoneMgr.moveCard(id, 'HAND', { isFaceUp: true });
        this.restToGraveyard(meta.revealed as string[], selected);
        return { success: true };
      }
      case 'PRESET_ST02_009_TARGET':
        for (const id of selected) {
          const card = this.ctx.state.cards[id];
          if (card) this.addModifier(card, { pp: -4000, untilTurn: turn, source: 'ST02-009' });
        }
        return { success: true };
    }
    return { success: false, error: `未知的决策类型 ${choice.effectType}` };
  }

  // ===================================================================
  // 代价之后的效果
  // ===================================================================

  private afterOrbCost(playerId: string, sourceId: string, next: string): Result {
    const turn = this.ctx.state.turnNumber;
    switch (next) {
      case 'PRESET_ST01_001_ACT':
        this.markUsed(playerId, sourceId);
        this.chooseRoles(playerId, sourceId, 'PRESET_ST01_001_BOUNCE', '【露西亚·红莲】选择我方战场1张角色返回手牌', this.roles(playerId));
        return { success: true };
      case 'PRESET_ST02_001_ACT': {
        this.markUsed(playerId, sourceId);
        const candidates = this.zone(playerId, 'GRAVEYARD').filter(
          (c) => this.isRole(c) && this.hasTrait(c, '升格者') && (this.def(c)?.cost ?? 99) <= 4
        );
        this.chooseCards(playerId, sourceId, 'PRESET_DEPLOY', '【露娜·银冕】选择我方墓地1张费用为4及以下的<升格者>角色出场',
          candidates, () => this.hasEmptySlot(playerId), 1, '战场没有空余卡位');
        return { success: true };
      }
      case 'PRESET_ST02_008_ACT':
        this.markUsed(playerId, sourceId);
        this.enqueue({
          id: this.choiceId('st02-008'),
          playerId,
          choiceType: 'SELECT_OPTION',
          prompt: '【苦刑之女】是否将我方侵蚀计数+1？若如此做，直到回合结束为止，该牌 DP+1',
          options: [
            { id: 'opt_yes', label: '侵蚀计数+1，DP+1' },
            { id: 'opt_no', label: '不执行' },
          ],
          effectType: 'PRESET_ST02_008_EROSION',
          sourceCardInstanceId: sourceId,
          minSelections: 1,
          maxSelections: 1,
        });
        return { success: true };
      case 'PRESET_ST03_001_ENTER':
        this.chooseRoles(playerId, sourceId, 'PRESET_ST03_001_READY', '【薇拉·瑰丽】选择我方战场1张<三头犬小队>角色竖直',
          this.roles(playerId).filter((r) => this.hasTrait(r, '三头犬小队')));
        // 选择没有可选对象时，仍执行后段的 PP+2000
        if (!this.ctx.state.currentPendingChoice) {
          for (const r of this.roles(playerId)) {
            if (this.hasTrait(r, '三头犬小队')) this.addModifier(r, { pp: 2000, untilTurn: turn, source: 'ST03-001' });
          }
        }
        return { success: true };
      case 'PRESET_ST02_009_ATTACK':
        this.chooseRoles(playerId, sourceId, 'PRESET_ST02_009_TARGET', '【奥兹玛】选择对方战场1张角色，直到回合结束为止 PP-4000',
          this.roles(this.opponent(playerId)));
        return { success: true };
      case 'PRESET_ST03_009_TRIGGER': {
        const card = this.ctx.state.cards[sourceId];
        if (card && this.ctx.fieldMgr.isSlotRole(playerId, sourceId)) {
          card.isReady = true;
          this.addModifier(card, { pp: 2000, dp: -1, untilTurn: turn, source: 'ST03-009' });
        }
        return { success: true };
      }
    }
    return { success: false, error: `未知的后续效果 ${next}` };
  }

  private afterDiscardCost(playerId: string, sourceId: string, next: string): Result {
    switch (next) {
      case 'PRESET_ST01_001_ENTER': {
        const revealed = this.revealTop(playerId, 5);
        this.chooseRevealed(playerId, sourceId, 'PRESET_ST01_001_PICK', '【露西亚·红莲】选择其中1张费用为3及以下的<灰鸦小队>角色出场 (剩余的牌放置到牌组底)',
          revealed,
          (c) => this.isRole(c) && this.hasTrait(c, '灰鸦小队') && (this.def(c)?.cost ?? 99) <= 3 && this.hasEmptySlot(playerId), 1);
        return { success: true };
      }
      case 'PRESET_ST02_003_ENTER': {
        const revealed = this.revealTop(playerId, 3);
        this.chooseRevealed(playerId, sourceId, 'PRESET_ST02_003_PICK', '【露娜·银冕】选择其中1张<升格者>角色加入手牌 (剩余的牌放置到墓地)',
          revealed, (c) => this.isRole(c) && this.hasTrait(c, '升格者'), 1);
        return { success: true };
      }
      case 'PRESET_ST02_007_ENTER':
        this.chooseCards(playerId, sourceId, 'PRESET_TO_HAND', '【不明构造体α】选择我方墓地1张<升格者>角色加入手牌',
          this.zone(playerId, 'GRAVEYARD').filter((c) => this.isRole(c) && this.hasTrait(c, '升格者')), undefined, 1);
        return { success: true };
      case 'PRESET_ST03_006_ENTER': {
        const cerberusCount = this.roles(playerId).filter((r) => this.hasTrait(r, '三头犬小队')).length;
        if (cerberusCount >= 3) {
          this.chooseCards(playerId, sourceId, 'PRESET_ORB_FROM_GRAVEYARD', '【21号·XXI】选择我方墓地1张信号球放置到信号球区最上方',
            this.zone(playerId, 'GRAVEYARD').filter((c) => this.isOrb(c)), undefined, 1);
        }
        return { success: true };
      }
    }
    return { success: false, error: `未知的后续效果 ${next}` };
  }

  // ===================================================================
  // 代价
  // ===================================================================

  /** 可选的「丢弃1张手牌」代价：可以不支付 (不发动) */
  private askDiscardCost(playerId: string, sourceId: string, next: string, prompt: string, hand: CardInstance[]): void {
    if (hand.length === 0) return;
    this.enqueue({
      id: this.choiceId('discard-cost'),
      playerId,
      choiceType: 'SELECT_CARDS',
      prompt: `${prompt} (不选择则不支付代价)`,
      options: hand.map((c) => this.effects.createGeneralCardChoiceOption(c)),
      effectType: 'PRESET_DISCARD_COST',
      sourceCardInstanceId: sourceId,
      metadata: { next },
      minSelections: 0,
      maxSelections: 1,
    });
  }

  /** 可选的消除信号球代价：没有可消除的组合时不发动 */
  private askOrbCost(playerId: string, sourceId: string, filter: OrbFilter, size: number, next: string, prompt: string): void {
    const groups = this.orbGroups(playerId, size, filter);
    if (groups.length === 0) return;
    this.enqueue({
      id: this.choiceId('orb-cost'),
      playerId,
      choiceType: 'SELECT_OPTION',
      prompt,
      options: [
        { id: 'skip', label: '不支付代价 (不发动)' },
        ...groups.map((g) => ({ id: g.join(','), label: `消除 ${g.map((id) => this.def(this.ctx.state.cards[id]!)?.name ?? id).join('、')}` })),
      ],
      effectType: 'PRESET_ORB_COST',
      sourceCardInstanceId: sourceId,
      metadata: { next },
      minSelections: 1,
      maxSelections: 1,
    });
  }

  /** 起动能力的消除信号球代价：必须能够支付 (8.4.2.b)；只有一种支付方式时直接支付 */
  private payOrbCostThen(playerId: string, sourceId: string, filter: OrbFilter, size: number, next: string): Result {
    const groups = this.orbGroups(playerId, size, filter);
    if (groups.length === 0) {
      return { success: false, error: '信号球区没有满足代价的相邻信号球，无法发动 (8.4.2.b)' };
    }
    if (groups.length === 1) {
      this.eliminate(playerId, groups[0]!);
      return this.afterOrbCost(playerId, sourceId, next);
    }
    this.enqueue({
      id: this.choiceId('orb-cost'),
      playerId,
      choiceType: 'SELECT_OPTION',
      prompt: '选择要消除的信号球 (起动能力的代价)',
      options: groups.map((g) => ({ id: g.join(','), label: `消除 ${g.map((id) => this.def(this.ctx.state.cards[id]!)?.name ?? id).join('、')}` })),
      effectType: 'PRESET_ORB_COST',
      sourceCardInstanceId: sourceId,
      metadata: { next },
      minSelections: 1,
      maxSelections: 1,
    });
    return { success: true };
  }

  /**
   * 信号球区中满足条件的相邻信号球组合 (4.16.2 / 10.9 任意信号球 / 10.10 同色信号球)
   */
  private orbGroups(playerId: string, size: number, filter: OrbFilter): string[][] {
    const zone = this.zone(playerId, 'SIGNAL_ORB');
    const groups: string[][] = [];
    for (let i = 0; i + size <= zone.length; i++) {
      const slice = zone.slice(i, i + size);
      const colors = slice.map((c) => (c.isFaceUp ? this.def(c)?.signalOrb : undefined));
      if (colors.some((c) => !c)) continue;
      if (filter === 'SAME' && new Set(colors).size !== 1) continue;
      if (filter !== 'ANY' && filter !== 'SAME' && colors.some((c) => c !== filter)) continue;
      groups.push(slice.map((c) => c.instanceId));
    }
    return groups;
  }

  private eliminate(playerId: string, ids: string[]): void {
    for (const id of ids) this.ctx.zoneMgr.moveCard(id, 'GRAVEYARD', { isFaceUp: true });
    this.ctx.events.push({ type: 'ORBS_ELIMINATED', playerId, orbCardIds: ids, cardDrawnCount: 0 });
  }

  // ===================================================================
  // 选择
  // ===================================================================

  /** 选择战场上的角色；指定数量 1，存在可选对象时必须选择 (8.6.3.a) */
  private chooseRoles(
    playerId: string,
    sourceId: string,
    effectType: string,
    prompt: string,
    candidates: CardInstance[],
    isEligible?: (c: CardInstance) => boolean,
    ineligibleReason?: string,
    metadata?: Record<string, unknown>
  ): void {
    if (candidates.length === 0) return;
    const eligibleCount = candidates.filter((c) => !isEligible || isEligible(c)).length;
    if (eligibleCount === 0) return;
    this.enqueue({
      id: this.choiceId(effectType),
      playerId,
      choiceType: 'SELECT_CARDS',
      prompt,
      options: candidates.map((c) =>
        this.effects.createRoleChoiceOption(c, {
          eligible: !isEligible || isEligible(c),
          ineligibleReason,
        })
      ),
      effectType,
      sourceCardInstanceId: sourceId,
      metadata,
      minSelections: 1,
      maxSelections: 1,
    });
  }

  /** 选择非战场的卡牌 (手牌、墓地)，指定数量为 count */
  private chooseCards(
    playerId: string,
    sourceId: string,
    effectType: string,
    prompt: string,
    candidates: CardInstance[],
    canChoose: (() => boolean) | undefined,
    count: number,
    ineligibleReason?: string
  ): void {
    if (candidates.length === 0) return;
    const allowed = !canChoose || canChoose();
    if (!allowed) return;
    this.enqueue({
      id: this.choiceId(effectType),
      playerId,
      choiceType: 'SELECT_CARDS',
      prompt,
      options: candidates.map((c) => this.effects.createGeneralCardChoiceOption(c, { ineligibleReason })),
      effectType,
      sourceCardInstanceId: sourceId,
      minSelections: Math.min(count, candidates.length),
      maxSelections: count,
    });
  }

  /** 公开的牌中选择：没有符合条件的牌时也显示 (minSelections 为 0)，以便玩家确认 */
  private chooseRevealed(
    playerId: string,
    sourceId: string,
    effectType: string,
    prompt: string,
    revealed: string[],
    isEligible: (c: CardInstance) => boolean,
    max: number,
    min = max
  ): void {
    const cards = revealed.map((id) => this.ctx.state.cards[id]!).filter(Boolean);
    const eligibleCount = cards.filter(isEligible).length;
    this.enqueue({
      id: this.choiceId(effectType),
      playerId,
      choiceType: 'SELECT_CARDS',
      prompt: eligibleCount > 0 ? prompt : `${prompt}：公开的牌中没有符合条件的卡牌，请确认`,
      options: cards.map((c) =>
        this.effects.createGeneralCardChoiceOption(c, { eligible: isEligible(c), ineligibleReason: '不符合条件' })
      ),
      effectType,
      sourceCardInstanceId: sourceId,
      metadata: { revealed },
      minSelections: Math.min(min, eligibleCount),
      maxSelections: Math.min(max, eligibleCount),
    });
  }

  // ===================================================================
  // 基础行动
  // ===================================================================

  /** 3.3.5 公开牌组顶 N 张：放置到处理区 (3.3.3.c 不足 N 张时只公开剩余的牌) */
  private revealTop(playerId: string, count: number): string[] {
    const top = this.zone(playerId, 'DECK').slice(0, count);
    for (const c of top) this.ctx.zoneMgr.moveCard(c.instanceId, 'PROCESSING', { isFaceUp: true });
    return top.map((c) => c.instanceId);
  }

  /** 将牌组顶 N 张放置到墓地 (3.3.3.b 中途牌组耗尽时执行牌组更新后继续) */
  private mill(playerId: string, count: number): string[] {
    const milled: string[] = [];
    for (let i = 0; i < count; i++) {
      if (!this.ctx.zoneMgr.refreshDeckIfEmpty(playerId)) break;
      const top = this.zone(playerId, 'DECK')[0]!;
      this.ctx.zoneMgr.moveCard(top.instanceId, 'GRAVEYARD', { isFaceUp: true });
      milled.push(top.instanceId);
    }
    return milled;
  }

  private restToDeckBottom(revealed: string[] | undefined, chosen: string[]): void {
    for (const id of revealed ?? []) {
      if (chosen.includes(id)) continue;
      if (this.ctx.state.cards[id]?.zone === 'PROCESSING') this.ctx.zoneMgr.moveCardToBottomOfDeck(id);
    }
  }

  private restToGraveyard(revealed: string[] | undefined, chosen: string[]): void {
    for (const id of revealed ?? []) {
      if (chosen.includes(id)) continue;
      if (this.ctx.state.cards[id]?.zone === 'PROCESSING') this.ctx.zoneMgr.moveCard(id, 'GRAVEYARD', { isFaceUp: true });
    }
  }

  /** 将角色出场到空余卡位，并处理其出场能力 */
  private bringToField(playerId: string, cardId: string): boolean {
    const slot = this.ctx.fieldMgr.findFirstEmptySlot(playerId);
    if (slot === undefined) return false;
    if (!this.ctx.fieldMgr.playRoleCard(playerId, cardId, slot)) return false;
    const def = this.def(this.ctx.state.cards[cardId]!);
    if (def) this.effects.handleRoleEntryEffect(playerId, cardId, def);
    return true;
  }

  private destroy(cardId: string): void {
    const card = this.ctx.state.cards[cardId];
    if (!card || !this.ctx.fieldMgr.isSlotRole(card.controllerPlayerId, cardId)) return;
    this.ctx.zoneMgr.moveCard(cardId, 'GRAVEYARD', { isFaceUp: true });
    this.ctx.events.push({ type: 'CARD_DESTROYED', cardInstanceId: cardId, reason: 'EFFECT' });
  }

  private addModifier(card: CardInstance, modifier: CardModifier): void {
    card.modifiers = [...(card.modifiers ?? []), modifier];
  }

  private markUsed(playerId: string, cardId: string): void {
    const usage = this.ctx.state.players[playerId]!.turnAbilityUsage;
    usage[cardId] = (usage[cardId] ?? 0) + 1;
  }

  private logAbility(playerId: string, cardId: string, def: CardVersionData, text: string): void {
    this.ctx.events.push({ type: 'ABILITY_ACTIVATED', playerId, cardInstanceId: cardId, abilityName: `${def.name}【起】`, rulesText: text });
  }

  // ===================================================================
  // 查询
  // ===================================================================

  private def(card: CardInstance): CardVersionData | undefined {
    return this.ctx.cardDb.getCard(card.cardNumber) || (card.cardId ? this.ctx.cardDb.getCard(card.cardId) : undefined);
  }

  private sourceNumber(cardId: string): string | undefined {
    return this.ctx.state.cards[cardId]?.cardNumber;
  }

  private hasTrait(card: CardInstance, trait: string): boolean {
    return !!this.def(card)?.traits.includes(trait);
  }

  private isRole(card: CardInstance): boolean {
    return this.def(card)?.cardType === CardType.ROLE;
  }

  private isOrb(card: CardInstance): boolean {
    return !!this.def(card)?.signalOrb;
  }

  private zone(playerId: string, zone: Parameters<CardEffectContext['zoneMgr']['getCardsInZone']>[1]): CardInstance[] {
    return this.ctx.zoneMgr.getCardsInZone(playerId, zone);
  }

  private roles(playerId: string): CardInstance[] {
    return this.ctx.fieldMgr
      .getSlots(playerId)
      .map((s) => (s.roleCardId ? this.ctx.state.cards[s.roleCardId] : undefined))
      .filter((c): c is CardInstance => !!c);
  }

  private hasEmptySlot(playerId: string): boolean {
    return this.ctx.fieldMgr.findFirstEmptySlot(playerId) !== undefined;
  }

  private opponent(playerId: string): string {
    const s = this.ctx.state;
    return playerId === s.activePlayerId ? s.nonActivePlayerId : s.activePlayerId;
  }

  private enqueue(choice: PendingChoice): void {
    this.ctx.setPendingChoice(choice);
  }

  private choiceSeq = 0;
  private choiceId(tag: string): string {
    this.choiceSeq += 1;
    return `choice-${tag}-${this.ctx.state.turnNumber}-${this.ctx.events.length}-${this.choiceSeq}`;
  }
}

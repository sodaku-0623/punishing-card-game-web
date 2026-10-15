'use client';

import React, { useRef, useState, useEffect } from 'react';
import {
  PublicGameState,
  CardInstance,
} from '@zhanshuang/shared';
import { BattlefieldSlotView } from './BattlefieldSlotView';
import { ProcessingZoneView } from './ProcessingZoneView';
import { DeckZoneView } from './DeckZoneView';
import { GraveyardZoneView } from './GraveyardZoneView';
import { Swords, Clock, Shield } from 'lucide-react';
import { findCardByNumberOrId } from '@/lib/cards-data';

export interface AttackAnimInfo {
  attackerCardId: string;
  targetCardId?: string;
  targetType: 'PLAYER' | 'CHARACTER';
  direction: 'UP' | 'DOWN'; // UP: player attacking, DOWN: opponent attacking
  isClashing: boolean;
  clashX?: number; // %
  clashY?: number; // %
}

interface BattlefieldArenaViewProps {
  gameState: PublicGameState;
  resolvedMyUserId: string;
  opponentUserId: string;
  isMyTurn: boolean;
  selectedHandCardId: string | null;
  selectedBattlefieldCardId: string | null;
  attackAnim: AttackAnimInfo | null;
  myGraveyardCards: CardInstance[];
  opponentGraveyardCards: CardInstance[];
  onRoleClick: (cardId: string) => void;
  onRoleDoubleClick: (cardId: string) => void;
  onRoleContextMenu: (e: React.MouseEvent, card: CardInstance) => void;
  onRoleLongPress: (card: CardInstance) => void;
  onRoleHover: (card: CardInstance | null) => void;
  onSlotClick: (slotIndex: number) => void;
  onActivateAbility: (cardId: string) => void;
  onAttackClick: (cardId: string) => void;
  onBlockClick: (cardId: string) => void;
  onPassTiming: () => void;
  onDropCardToSlot: (slotIndex: number, cardInstanceId: string) => void;
  onDropAttackTarget: (targetCardId: string, attackerCardId: string) => void;
  onInspectCard: (card: CardInstance) => void;
  onOpenGraveyard: (cards: CardInstance[], title: string) => void;
}

// 己方 5 个卡位在 2560 x 1440 官方竞技对战场地上的定位百分比 (对应官方战场区 5 个卡位)
const MY_SLOT_POSITIONS = [
  { left: '14.06%', width: '13.28%' }, // 卡位 1 (Slot 0)
  { left: '27.97%', width: '13.28%' }, // 卡位 2 (Slot 1)
  { left: '41.88%', width: '13.28%' }, // 卡位 3 (Slot 2)
  { left: '55.78%', width: '13.28%' }, // 卡位 4 (Slot 3)
  { left: '69.69%', width: '13.28%' }, // 卡位 5 (Slot 4)
];

// 敌方 5 个卡位在 180° 旋转对决半场上的精准面对面定位百分比
const OPPONENT_SLOT_POSITIONS = [
  { left: '69.69%', width: '13.28%' }, // 敌方 Slot 0 (面对我方 Slot 4)
  { left: '55.78%', width: '13.28%' }, // 敌方 Slot 1 (面对我方 Slot 3)
  { left: '41.88%', width: '13.28%' }, // 敌方 Slot 2 (面对我方 Slot 2)
  { left: '27.97%', width: '13.28%' }, // 敌方 Slot 3 (面对我方 Slot 1)
  { left: '14.06%', width: '13.28%' }, // 敌方 Slot 4 (面对我方 Slot 0)
];

export const BattlefieldArenaView: React.FC<BattlefieldArenaViewProps> = React.memo(({
  gameState,
  resolvedMyUserId,
  opponentUserId,
  isMyTurn,
  selectedHandCardId,
  selectedBattlefieldCardId,
  attackAnim,
  myGraveyardCards,
  opponentGraveyardCards,
  onRoleClick,
  onRoleDoubleClick,
  onRoleContextMenu,
  onRoleLongPress,
  onRoleHover,
  onSlotClick,
  onActivateAbility,
  onAttackClick,
  onBlockClick,
  onPassTiming,
  onDropCardToSlot,
  onDropAttackTarget,
  onInspectCard,
  onOpenGraveyard,
}) => {
  const mySlots = gameState.battlefields?.[resolvedMyUserId] || [];
  const opponentSlots = gameState.battlefields?.[opponentUserId] || [];

  const wrapperRef = useRef<HTMLDivElement>(null);
  const [arenaStyle, setArenaStyle] = useState<React.CSSProperties>({
    aspectRatio: '2560 / 1440',
    maxWidth: '100%',
    maxHeight: '100%',
    width: 'auto',
    height: '100%',
  });

  useEffect(() => {
    const parent = wrapperRef.current?.parentElement;
    if (!parent) return;

    const updateDimensions = () => {
      const { clientWidth, clientHeight } = parent;
      if (clientWidth <= 0 || clientHeight <= 0) return;

      const targetRatio = 2560 / 1440;
      const currentRatio = clientWidth / clientHeight;

      let w: number;
      let h: number;

      if (currentRatio > targetRatio) {
        h = clientHeight;
        w = Math.floor(h * targetRatio);
      } else {
        w = clientWidth;
        h = Math.floor(w / targetRatio);
      }

      setArenaStyle({
        width: `${w}px`,
        height: `${h}px`,
        maxWidth: '100%',
        maxHeight: '100%',
        aspectRatio: '2560 / 1440',
      });
    };

    updateDimensions();
    const observer = new ResizeObserver(updateDimensions);
    observer.observe(parent);
    window.addEventListener('resize', updateDimensions);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateDimensions);
    };
  }, []);

  return (
    <div
      ref={wrapperRef}
      className="relative mx-auto select-none rounded-2xl border border-cyan-500/40 overflow-hidden shadow-[0_0_40px_rgba(0,240,255,0.22)] ygo-battlefield-mat flex-shrink-0"
      style={arenaStyle}
    >
      {/* 赛博网格与边缘微光暗角遮罩 */}
      <div className="absolute inset-0 bg-gradient-to-b from-black/35 via-transparent to-black/40 pointer-events-none" />

      {/* ================= 敌方战场 5 个绝对卡位 (TOP ROW: top 8.00%, height 29.33%) ================= */}
      {opponentSlots.slice(0, 5).map((slot, index) => {
        const pos = OPPONENT_SLOT_POSITIONS[index] || OPPONENT_SLOT_POSITIONS[0];
        const roleCard = slot.roleCardId ? gameState.publicCards?.[slot.roleCardId] : undefined;
        const isLegalAttackTarget =
          isMyTurn &&
          gameState.phase === 'MAIN_PHASE' &&
          !!selectedBattlefieldCardId &&
          !!roleCard;

        const isAttacking = !!attackAnim && !!roleCard && attackAnim.attackerCardId === roleCard.instanceId;
        const isHit = !!attackAnim && !!roleCard && attackAnim.targetCardId === roleCard.instanceId && attackAnim.isClashing;

        return (
          <div
            key={`opp-slot-${slot.slotIndex}`}
            className="absolute z-10"
            style={{
              left: pos.left,
              top: '11.11%',
              width: pos.width,
              height: '33.33%',
            }}
          >
            <BattlefieldSlotView
              slotIndex={slot.slotIndex}
              roleCard={roleCard}
              isOpponent
              isSelected={selectedBattlefieldCardId === roleCard?.instanceId}
              isLegalAttackTarget={isLegalAttackTarget}
              isAttacking={isAttacking}
              attackDirection={attackAnim?.direction}
              isHit={isHit}
              onRoleClick={onRoleClick}
              onRoleDoubleClick={onRoleDoubleClick}
              onRoleContextMenu={onRoleContextMenu}
              onRoleLongPress={onRoleLongPress}
              onRoleHover={onRoleHover}
              onDropAttackTarget={onDropAttackTarget}
            />
          </div>
        );
      })}

      {/* ================= 战术交战中线与对决状态指示 (MIDFIELD: top 46.5%, height 7.0%) ================= */}
      <div
        className="absolute z-15 flex items-center justify-between px-3"
        style={{
          left: '14.0%',
          right: '17.0%',
          top: '46.5%',
          height: '7.0%',
        }}
      >
        <div className="w-full flex items-center justify-center gap-2 border-y border-dashed border-cyan-500/30 bg-black/55 backdrop-blur-[2px] py-1 text-[11px] font-mono text-neutral-300 rounded shadow-sm">
          <div className="h-px bg-terminalBorder/60 flex-1" />
          <div className="flex items-center gap-2 flex-wrap justify-center">
            <Swords className="w-3.5 h-3.5 text-terminalCyan animate-pulse" />
            <span className="font-bold tracking-wider text-cyan-200">
              战术交战区 • 5v5 绝对卡位
            </span>

            {gameState.currentCombat && (
              <>
                <span className="ml-1 px-2 py-0.5 rounded bg-erosionRed/25 text-red-200 border border-erosionRed/50 font-bold animate-pulse text-[10px]">
                  【交战中】目标: {gameState.currentCombat.targetType === 'PLAYER' ? '对方玩家' : '角色卡'}
                </span>

                {gameState.phase === 'COMBAT_FREE_TIMING' && (
                  isMyTurn ? (
                    <span className="px-2 py-0.5 rounded bg-yellow-500/20 text-yellow-300 border border-yellow-500/40 text-[10px] font-bold flex items-center gap-1 animate-pulse">
                      <Clock className="w-3 h-3 text-yellow-400 animate-spin" />
                      <span>等待对方选择是否阻挡...</span>
                    </span>
                  ) : (
                    <div className="flex items-center gap-2 ml-1">
                      <span className="px-2 py-0.5 rounded bg-erosionRed/30 text-red-200 border border-erosionRed/60 text-[10px] font-bold flex items-center gap-1 animate-pulse">
                        <Shield className="w-3 h-3 text-yellow-300" />
                        <span>请选择角色【阻挡】，或：</span>
                      </span>
                      <button
                        type="button"
                        onClick={onPassTiming}
                        className="px-2.5 py-0.5 rounded bg-terminalGold hover:bg-yellow-400 text-neutral-950 font-black text-[10px] font-mono shadow-[0_0_12px_rgba(255,200,0,0.8)] animate-bounce active:scale-95 transition-all cursor-pointer"
                        title="放弃阻挡并推进战斗伤害结算 (快捷键: Space)"
                      >
                        放弃阻挡 [Space]
                      </button>
                    </div>
                  )
                )}
              </>
            )}
          </div>
          <div className="h-px bg-terminalBorder/60 flex-1" />
        </div>
      </div>

      {/* ================= 己方战场 5 个绝对卡位 (BOTTOM ROW: top 54.86%, height 33.33%) ================= */}
      {mySlots.slice(0, 5).map((slot, index) => {
        const pos = MY_SLOT_POSITIONS[index] || MY_SLOT_POSITIONS[0];
        const roleCard = slot.roleCardId ? gameState.publicCards?.[slot.roleCardId] : undefined;
        const isPlayTargetable = !!selectedHandCardId && !slot.roleCardId;

        const roleDef = roleCard ? findCardByNumberOrId(roleCard.cardNumber || roleCard.cardId) : null;
        const hasAbility = !!(
          roleDef?.rulesText?.includes('【起】') ||
          roleDef?.rulesText?.includes('起动')
        );
        const canActivateAbility = isMyTurn && gameState.phase === 'MAIN_PHASE' && hasAbility;
        const hasRush = Boolean(
          roleDef?.rulesText?.includes('速攻') ||
          roleCard?.grantedKeywords?.includes('速攻')
        );
        const canAttack =
          isMyTurn &&
          gameState.phase === 'MAIN_PHASE' &&
          !!roleCard?.isReady &&
          (roleCard.turnEnteredZone < gameState.turnNumber || hasRush);
        const canBlock =
          !isMyTurn &&
          gameState.phase === 'COMBAT_FREE_TIMING' &&
          !!roleCard?.isReady;

        const isAttacking = !!attackAnim && !!roleCard && attackAnim.attackerCardId === roleCard.instanceId;
        const isHit = !!attackAnim && !!roleCard && attackAnim.targetCardId === roleCard.instanceId && attackAnim.isClashing;

        return (
          <div
            key={`my-slot-${slot.slotIndex}`}
            className="absolute z-10"
            style={{
              left: pos.left,
              top: '54.86%',
              width: pos.width,
              height: '33.33%',
            }}
          >
            <BattlefieldSlotView
              slotIndex={slot.slotIndex}
              roleCard={roleCard}
              isSelected={selectedBattlefieldCardId === roleCard?.instanceId}
              isPlayTargetable={isPlayTargetable}
              canActivateAbility={canActivateAbility}
              canAttack={canAttack}
              canBlock={canBlock}
              hasAbility={hasAbility}
              isAttacking={isAttacking}
              attackDirection={attackAnim?.direction}
              isHit={isHit}
              onSlotClick={onSlotClick}
              onRoleClick={onRoleClick}
              onRoleDoubleClick={onRoleDoubleClick}
              onRoleContextMenu={onRoleContextMenu}
              onRoleLongPress={onRoleLongPress}
              onRoleHover={onRoleHover}
              onActivateAbility={onActivateAbility}
              onAttackClick={onAttackClick}
              onBlockClick={onBlockClick}
              onDropCard={onDropCardToSlot}
            />
          </div>
        );
      })}

      {/* ================= 左翼：官方战术处理区 (PROCESSING ZONE: left 2.34%, top 38.88%, width 10.15%, height 22.22%) ================= */}
      <div
        className="absolute z-15 flex flex-col items-center justify-center"
        style={{
          left: '2.34%',
          top: '38.88%',
          width: '10.15%',
          height: '22.22%',
        }}
      >
        <ProcessingZoneView
          gameState={gameState}
          playerId={resolvedMyUserId}
          isMyZone={true}
          compact={true}
          onCardClick={onInspectCard}
          onCardLongPress={onRoleLongPress}
          onCardHover={onRoleHover}
        />
      </div>

      {/* ================= 敌方牌库与墓地 (右侧上方: left 85.15%, width 10.94%) ================= */}
      <div
        className="absolute z-15 flex flex-col items-center justify-center gap-1"
        style={{
          left: '85.15%',
          top: '11.11%',
          width: '10.94%',
          height: '15.97%',
        }}
      >
        <GraveyardZoneView
          cards={opponentGraveyardCards}
          label="敌方墓地"
          isOpponent={true}
          onClick={() => onOpenGraveyard(opponentGraveyardCards, '敌方墓地')}
          onCardHover={onRoleHover}
        />
      </div>

      <div
        className="absolute z-15 flex flex-col items-center justify-center gap-1"
        style={{
          left: '85.15%',
          top: '28.47%',
          width: '10.94%',
          height: '15.97%',
        }}
      >
        <DeckZoneView
          cardCount={gameState.opponentDeckCount}
          label="敌方牌组"
          isMyDeck={false}
        />
      </div>

      {/* ================= 我方牌库与墓地 (右侧下方: left 85.15%, width 10.94%) ================= */}
      <div
        className="absolute z-15 flex flex-col items-center justify-center gap-1"
        style={{
          left: '85.15%',
          top: '54.86%',
          width: '10.94%',
          height: '15.97%',
        }}
      >
        <DeckZoneView
          cardCount={gameState.myDeckCount}
          label="我方牌组"
          isMyDeck={true}
        />
      </div>

      <div
        className="absolute z-15 flex flex-col items-center justify-center gap-1"
        style={{
          left: '85.15%',
          top: '72.22%',
          width: '10.94%',
          height: '15.97%',
        }}
      >
        <GraveyardZoneView
          cards={myGraveyardCards}
          label="我方墓地"
          isOpponent={false}
          onClick={() => onOpenGraveyard(myGraveyardCards, '我方墓地')}
          onCardHover={onRoleHover}
        />
      </div>

      {/* ================= 攻击碰撞闪光与刀光特效图层 (CLASH FLASH OVERLAY) ================= */}
      {attackAnim?.isClashing && (
        <div
          className="absolute z-50 pointer-events-none clash-flash-effect flex items-center justify-center"
          style={{
            left: attackAnim.clashX ? `${attackAnim.clashX}%` : '50%',
            top: attackAnim.clashY ? `${attackAnim.clashY}%` : '50%',
          }}
        >
          {/* 核心能量耀斑与环形冲击波 */}
          <div className="relative flex items-center justify-center">
            <div className="w-24 h-24 sm:w-32 sm:h-32 rounded-full bg-gradient-to-r from-red-500 via-amber-300 to-white opacity-90 blur-[2px] shadow-[0_0_35px_#ff2a5f]" />
            <div className="absolute w-36 h-36 rounded-full border-2 border-white/80 animate-ping" />
            <div className="absolute w-44 h-1 bg-white transform rotate-45 shadow-[0_0_20px_#ffffff]" />
            <div className="absolute w-44 h-1 bg-white transform -rotate-45 shadow-[0_0_20px_#ffffff]" />
          </div>
        </div>
      )}
    </div>
  );
});

BattlefieldArenaView.displayName = 'BattlefieldArenaView';

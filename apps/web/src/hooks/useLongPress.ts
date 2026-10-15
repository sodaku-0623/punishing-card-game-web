import { useRef, useCallback } from 'react';

export interface UseLongPressOptions {
  onLongPress: () => void;
  onClick?: () => void;
  thresholdMs?: number;
}

export function useLongPress({ onLongPress, onClick, thresholdMs = 400 }: UseLongPressOptions) {
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const isLongPressRef = useRef(false);
  const startPosRef = useRef<{ x: number; y: number } | null>(null);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      // 仅响应鼠标左键或触控单指
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      isLongPressRef.current = false;
      startPosRef.current = { x: e.clientX, y: e.clientY };

      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        isLongPressRef.current = true;
        onLongPress();
      }, thresholdMs);
    },
    [onLongPress, thresholdMs]
  );

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!startPosRef.current) return;
    const dx = Math.abs(e.clientX - startPosRef.current.x);
    const dy = Math.abs(e.clientY - startPosRef.current.y);
    // 移动超过 10px 说明是滚动/滑动手势，取消长按
    if (dx > 10 || dy > 10) {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    }
  }, []);

  const onPointerUp = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    startPosRef.current = null;
  }, []);

  const onPointerCancel = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    startPosRef.current = null;
  }, []);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if (isLongPressRef.current) {
        e.preventDefault();
        e.stopPropagation();
        isLongPressRef.current = false;
        return;
      }
      onClick?.();
    },
    [onClick]
  );

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    onClick: handleClick,
  };
}

/**
 * 新建房间时的密码暂存工具。
 * 房间由房主进入等待室、通过 Socket 首次加入时创建；密码经 sessionStorage 在两个页面间传递，
 * 避免出现在 URL / 浏览器历史中，读取后立即清除。
 */
const keyFor = (roomId: string) => `zs_pending_room_pw_${roomId}`;

export function stashPendingRoomPassword(roomId: string, password: string): void {
  try {
    if (password) {
      sessionStorage.setItem(keyFor(roomId), password);
    } else {
      sessionStorage.removeItem(keyFor(roomId));
    }
  } catch {}
}

export function takePendingRoomPassword(roomId: string): string | undefined {
  try {
    const value = sessionStorage.getItem(keyFor(roomId));
    if (value !== null) {
      sessionStorage.removeItem(keyFor(roomId));
      return value || undefined;
    }
  } catch {}
  return undefined;
}

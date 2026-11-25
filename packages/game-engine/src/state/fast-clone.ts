/**
 * 零依赖高性能深拷贝：替代 JSON.parse(JSON.stringify(...)) 与较慢的 structuredClone。
 * 保持对象属性插入顺序 (确保 state.cards 物理顺序不变)，正确处理原始值、Array、Date 与 plain object。
 */
export function fastDeepClone<T>(value: T): T {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    const len = value.length;
    const out = new Array(len);
    for (let i = 0; i < len; i++) {
      out[i] = fastDeepClone(value[i]);
    }
    return out as unknown as T;
  }
  if (value instanceof Date) {
    return new Date(value.getTime()) as unknown as T;
  }
  const out: Record<string, unknown> = {};
  const keys = Object.keys(value);
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i]!;
    out[k] = fastDeepClone((value as Record<string, unknown>)[k]);
  }
  return out as T;
}

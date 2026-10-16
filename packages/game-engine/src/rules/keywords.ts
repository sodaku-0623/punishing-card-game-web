/**
 * 卡牌自身持有的关键字永久能力 (10.3 充能X、10.5 速攻、10.6 突进、10.16 同命 等)。
 *
 * 只识别形如「【永】：【速攻】」的独立能力行；条件性的、赋予其他卡牌的、或在其他能力中
 * 「获得【速攻】」的记述都不算自身持有，避免「文本中出现某个词就视为拥有该能力」。
 */
export interface InherentKeyword {
  keyword: string;
  /** 10.14 暮形态 / 晖形态能力：仅在信号球区最下方卡牌的费用为偶数 / 奇数时有效 */
  form?: '暮' | '晖';
}

const cache = new Map<string, InherentKeyword[]>();

export function parseInherentKeywords(rulesText: string | undefined): InherentKeyword[] {
  if (!rulesText) return [];
  const cached = cache.get(rulesText);
  if (cached) return cached;

  const result: InherentKeyword[] = [];
  for (const rawLine of rulesText.split('\n')) {
    // 2.5.3 注释文本 (括号内) 不影响游戏
    const line = rawLine.replace(/（[^）]*）|\([^)]*\)/g, '').replace(/\s+/g, '');
    const m = line.match(/^(暮|晖)?【永】[:：]((?:【[^】]+】[、及和]?)+)。?$/);
    if (!m) continue;
    for (const token of m[2]!.matchAll(/【([^】]+)】/g)) {
      const keyword = token[1]!.replace(/icon$/, '');
      result.push({ keyword, form: m[1] as '暮' | '晖' | undefined });
    }
  }
  cache.set(rulesText, result);
  return result;
}

/**
 * 10.3 【充能X】：基本充能数变为 X (多个时以最后适用的为准)；未持有时为 undefined
 */
export function parseInherentChargeCount(keywords: InherentKeyword[]): number | undefined {
  let count: number | undefined;
  for (const k of keywords) {
    const m = k.keyword.match(/^充能(\d+)$/);
    if (m) count = parseInt(m[1]!, 10);
  }
  return count;
}

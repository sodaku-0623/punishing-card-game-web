/**
 * 卡牌图像高性能加载与缩略图路由工具
 */

/**
 * 获取卡牌高性能轻量缩略图 URL
 * @param imageUrl 原高清图路径，如 "/cards/BP01-001.png" 或 "/cards/ST01-R_ST01-001R★.png"
 * @param fallbackNumber 备选卡号，如 "BP01-001"
 * @returns 缩略图路径，如 "/cards/thumbs/BP01-001.jpg"
 */
export function getCardThumbnailUrl(imageUrl?: string | null, fallbackNumber?: string): string {
  const target = imageUrl || (fallbackNumber ? `/cards/${fallbackNumber}.png` : '');
  if (!target) return '';
  
  // 如果已经是缩略图
  if (target.includes('/cards/thumbs/')) return target;

  // 提取纯文件名（不含路径与扩展名）
  const fileName = target.split('/').pop()?.split('\\').pop()?.replace(/\.(png|jpe?g|webp)$/i, '');
  if (!fileName) return target;

  return `/cards/thumbs/${fileName}.jpg`;
}

/**
 * 获取卡牌原始高分辨率大图 URL (用于大图检视、全屏放大、高精细节查看)
 * @param imageUrl 原图或缩略图路径
 * @param fallbackNumber 备选卡号
 */
export function getCardFullImageUrl(imageUrl?: string | null, fallbackNumber?: string): string {
  const target = imageUrl || (fallbackNumber ? `/cards/${fallbackNumber}.png` : '');
  if (!target) return '';

  // 若传入的是缩略图路径，还原为原图
  if (target.includes('/cards/thumbs/')) {
    return target.replace('/cards/thumbs/', '/cards/').replace(/\.jpg$/i, '.png');
  }

  return target;
}

/**
 * 缩略图加载失败时的通用降级处理器 (优雅回退到原图)
 */
export function handleThumbnailError(e: React.SyntheticEvent<HTMLImageElement, Event>, fullImageUrl?: string) {
  const img = e.currentTarget;
  if (!fullImageUrl) return;

  // 若当前 src 尚未尝试加载原图，则降级为原图
  if (!img.src.includes(fullImageUrl) && !img.dataset.fallbackTried) {
    img.dataset.fallbackTried = 'true';
    img.src = fullImageUrl;
  }
}

/**
 * 卡牌图像高性能加载与缩略图路由工具 (支持 Cloudflare R2 / CDN 接入)
 */

const CARD_CDN = (process.env.NEXT_PUBLIC_CARD_CDN || '').replace(/\/$/, '');

/**
 * 将相对路径转换为携带 CDN 域名前缀与 URL 安全编码的完整地址
 */
export function formatCardCdnUrl(relativePath: string): string {
  if (!relativePath) return '';
  if (relativePath.startsWith('http://') || relativePath.startsWith('https://')) {
    return relativePath;
  }
  const cleanPath = relativePath.startsWith('/') ? relativePath : `/${relativePath}`;

  // 对非 ASCII 特殊符号（如 '★' 等字符）进行安全 URL 编码，避免 R2 / CDN 路径解析异常
  const encodedPath = cleanPath
    .split('/')
    .map((seg) => (seg ? encodeURIComponent(decodeURIComponent(seg)) : ''))
    .join('/');

  return CARD_CDN ? `${CARD_CDN}${encodedPath}` : encodedPath;
}

/**
 * 获取卡牌高性能轻量缩略图 URL
 * @param imageUrl 原高清图路径，如 "/cards/BP01-001.png" 或 "/cards/ST01-R_ST01-001R★.png"
 * @param fallbackNumber 备选卡号，如 "BP01-001"
 * @returns 缩略图路径，如 "https://cdn.example.com/cards/thumbs/BP01-001.jpg"
 */
export function getCardThumbnailUrl(imageUrl?: string | null, fallbackNumber?: string): string {
  const target = imageUrl || (fallbackNumber ? `/cards/${fallbackNumber}.png` : '');
  if (!target) return '';

  // 如果已经是缩略图
  if (target.includes('/cards/thumbs/')) {
    return formatCardCdnUrl(target);
  }

  // 提取纯文件名（不含路径与扩展名）
  const fileName = target.split('/').pop()?.split('\\').pop()?.replace(/\.(png|jpe?g|webp)$/i, '');
  if (!fileName) return formatCardCdnUrl(target);

  return formatCardCdnUrl(`/cards/thumbs/${fileName}.jpg`);
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
    const fullPath = target.replace('/cards/thumbs/', '/cards/').replace(/\.jpg$/i, '.png');
    return formatCardCdnUrl(fullPath);
  }

  return formatCardCdnUrl(target);
}

/**
 * 缩略图加载失败时的通用降级处理器 (优雅回退到原图)
 */
export function handleThumbnailError(e: React.SyntheticEvent<HTMLImageElement, Event>, fullImageUrl?: string) {
  const img = e.currentTarget;
  if (!fullImageUrl) return;

  const resolvedFullUrl = getCardFullImageUrl(fullImageUrl);

  // 若当前 src 尚未尝试加载原图，则降级为原图
  if (!img.src.includes(resolvedFullUrl) && !img.dataset.fallbackTried) {
    img.dataset.fallbackTried = 'true';
    img.src = resolvedFullUrl;
  }
}

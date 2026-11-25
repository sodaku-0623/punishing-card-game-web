'use client';

import React from 'react';
import Link from 'next/link';
import { ZoomIn, ExternalLink } from 'lucide-react';
import { Badge, Button, Dialog } from '@/components/ui';
import {
  getCardFullImageUrl,
  getCardThumbnailUrl,
  handleThumbnailError,
} from '@/lib/card-image';

export interface GuideCardExample {
  cardNumber: string;
  name: string;
  roleLabel: string;
  badgeVariant?: 'teal' | 'gold' | 'crimson' | 'neutral';
  remoteFallbackUrl?: string;
}

export interface GuideDiagramConfig {
  title: string;
  subtitle: string;
  src: string;
  fallbackSrc?: string;
  alt: string;
  caption: string;
  maxHeightClass?: string;
}

export interface GuidePreviewMedia {
  title: string;
  subtitle?: string;
  src: string;
  fallbackSrc?: string;
  alt: string;
  cardNumber?: string;
}

/**
 * 新手指南示例卡牌表（与原版指南及官方卡表编号一致）
 */
export const GUIDE_CARD_EXAMPLES = {
  role: [
    {
      cardNumber: 'ST01-001',
      name: '露西亚·红莲',
      roleLabel: '角色牌示例',
      badgeVariant: 'teal',
      remoteFallbackUrl:
        'https://zhanshuang-prod-minio.janime.cn/card-game-public/680725c2-9e71-4949-ab73-8ec20d473e53/ST01-R_ST01-001R.png',
    },
  ] satisfies GuideCardExample[],
  item: [
    {
      cardNumber: 'ST04-010',
      name: '阿波罗',
      roleLabel: '装备牌示例',
      badgeVariant: 'gold',
      remoteFallbackUrl:
        'https://zhanshuang-prod-minio.janime.cn/card-game-public/af781e2b-d300-4092-bb30-f3263dd42278/ST04-ST_ST04-010ST.png',
    },
    {
      cardNumber: 'BP01-012',
      name: '沃托',
      roleLabel: '辅助机牌示例',
      badgeVariant: 'teal',
      remoteFallbackUrl:
        'https://zhanshuang-prod-minio.janime.cn/card-game-public/d9828bcb-2b4e-474c-adb0-d45bd7e1371e/BP01-U_BP01-012U.png',
    },
  ] satisfies GuideCardExample[],
  tactics: [
    {
      cardNumber: 'ST01-011',
      name: '重逢',
      roleLabel: '普通战术牌示例',
      badgeVariant: 'neutral',
      remoteFallbackUrl:
        'https://zhanshuang-prod-minio.janime.cn/card-game-public/fa5b2cb6-52a9-4df3-a90b-e0beeceae0ba/ST01-ST_ST01-011ST.png',
    },
    {
      cardNumber: 'ST02-011',
      name: '筛选开始',
      roleLabel: '瞬时战术牌示例',
      badgeVariant: 'teal',
      remoteFallbackUrl:
        'https://zhanshuang-prod-minio.janime.cn/card-game-public/f3640984-f1c2-49b4-9e9d-153b2a5f4c3f/ST02-R_ST02-011R.png',
    },
  ] satisfies GuideCardExample[],
  signalOrbs: [
    {
      cardNumber: 'ST01-012',
      name: '红莲-起手式',
      roleLabel: '信号球 · 红',
      badgeVariant: 'crimson',
    },
    {
      cardNumber: 'ST01-013',
      name: '红莲-波动斩',
      roleLabel: '信号球 · 蓝',
      badgeVariant: 'teal',
    },
    {
      cardNumber: 'ST01-014',
      name: '红莲-闪击',
      roleLabel: '信号球 · 黄',
      badgeVariant: 'gold',
    },
  ] satisfies GuideCardExample[],
};

/**
 * 新手指南官方图解配置
 * 对战垫优先使用仓库内置静态资源 `/official-playmat.jpg`，远程官方存储作为兜底
 */
export const GUIDE_DIAGRAMS = {
  cardStructure: {
    title: '卡面信息结构图解',
    subtitle: 'OFFICIAL CARD STRUCTURE',
    src: 'https://zhanshuang-prod-minio.janime.cn/card-game-public/d86b32c1-ce48-454b-bb11-5c007fa2da68/%E6%89%8B%E5%86%8C_%E7%9C%8B%E5%9B%BE%E7%8E%8B(1).png',
    alt: '战双帕弥什 TCG 官方卡面结构图解',
    caption: '战双帕弥什 TCG 官方卡面区域指示图（点击放大查看细节）',
    maxHeightClass: 'max-h-[460px]',
  },
  officialPlaymat: {
    title: '官方对战垫布局（七大区域）',
    subtitle: 'OFFICIAL BATTLEFIELD MAT',
    src: '/official-playmat.jpg',
    fallbackSrc:
      'https://zhanshuang-prod-minio.janime.cn/card-game-public/bf23374f-2389-4a97-a508-3d84823f8441/%E6%88%98%E5%8F%8C%E5%9C%BA%E5%9C%B0%E7%BA%B8-%E7%A1%AE%E5%AE%9A%E4%BF%AE%E6%94%B9_omote.jpg',
    alt: '战双帕弥什官方对战垫布局（七大区域划分）',
    caption: '战双帕弥什官方对战垫布局 · 7 大区域划分（点击放大查看细节）',
    maxHeightClass: 'max-h-96',
  },
} satisfies Record<string, GuideDiagramConfig>;

function handleFallbackImageError(
  e: React.SyntheticEvent<HTMLImageElement, Event>,
  fallbackSrc?: string,
) {
  if (!fallbackSrc) return;
  const img = e.currentTarget;
  if (!img.dataset.fallbackTried) {
    img.dataset.fallbackTried = 'true';
    img.src = fallbackSrc;
  }
}

function handleExampleCardError(
  e: React.SyntheticEvent<HTMLImageElement, Event>,
  item: GuideCardExample,
) {
  const img = e.currentTarget;
  // 第一阶段先回退到卡图原图（本地或 R2 CDN），若原图仍不可达再降级到官方镜像 URL
  if (!img.dataset.fallbackTried) {
    handleThumbnailError(e, `/cards/${item.cardNumber}.png`);
    return;
  }
  if (item.remoteFallbackUrl && !img.dataset.remoteFallbackTried) {
    img.dataset.remoteFallbackTried = 'true';
    img.src = item.remoteFallbackUrl;
  }
}

export interface GuideCardExampleStripProps {
  examples: GuideCardExample[];
  onPreview: (media: GuidePreviewMedia) => void;
}

/**
 * 章节底部的示例卡牌横排展示，支持点击放大查看原图与跳转图鉴
 */
export function GuideCardExampleStrip({ examples, onPreview }: GuideCardExampleStripProps) {
  return (
    <div className="pt-2 border-t border-line">
      <div className="flex flex-wrap justify-center gap-6 pt-2">
        {examples.map((item) => (
          <button
            key={item.cardNumber}
            type="button"
            onClick={() =>
              onPreview({
                title: `${item.name} (${item.cardNumber})`,
                subtitle: item.roleLabel,
                src: getCardFullImageUrl(undefined, item.cardNumber),
                fallbackSrc: item.remoteFallbackUrl,
                alt: `${item.roleLabel} - ${item.name}`,
                cardNumber: item.cardNumber,
              })
            }
            aria-label={`放大查看${item.roleLabel} ${item.name} (${item.cardNumber})`}
            className="group flex flex-col items-center gap-2 text-center cursor-pointer focus:outline-none"
          >
            <div className="relative w-36 aspect-[7/10] bg-ink-950 border border-line rounded-card overflow-hidden transition-colors duration-fast group-hover:border-line-strong">
              <img
                src={getCardThumbnailUrl(undefined, item.cardNumber)}
                alt={`${item.roleLabel}：${item.name}`}
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover transition-transform duration-base ease-enter group-hover:scale-105"
                loading="lazy"
                onError={(e) => handleExampleCardError(e, item)}
              />
              <span
                aria-hidden="true"
                className="absolute bottom-1.5 right-1.5 h-6 w-6 inline-flex items-center justify-center bg-ink-950/85 border border-line text-fg-secondary group-hover:text-fg group-hover:border-crimson-500 transition-colors"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </span>
            </div>
            <div className="flex flex-col items-center gap-1">
              <Badge variant={item.badgeVariant ?? 'neutral'}>{item.roleLabel}</Badge>
              <div className="text-caption text-fg-secondary group-hover:text-fg transition-colors">
                <span>{item.name}</span>
                <span className="font-num text-fg-muted ml-1.5">{item.cardNumber}</span>
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

export interface GuideDiagramFigureProps {
  diagram: GuideDiagramConfig;
  onPreview: (media: GuidePreviewMedia) => void;
}

/**
 * 新手指南官方示意图卡片，居中自适应展示并支持点击放大
 */
export function GuideDiagramFigure({ diagram, onPreview }: GuideDiagramFigureProps) {
  return (
    <figure className="bg-ink-950 border border-line p-4 flex flex-col items-center gap-3">
      <button
        type="button"
        onClick={() =>
          onPreview({
            title: diagram.title,
            subtitle: diagram.subtitle,
            src: diagram.src,
            fallbackSrc: diagram.fallbackSrc,
            alt: diagram.alt,
          })
        }
        aria-label={`放大查看${diagram.title}`}
        className="group relative max-w-full flex items-center justify-center cursor-pointer focus:outline-none"
      >
        <img
          src={diagram.src}
          alt={diagram.alt}
          referrerPolicy="no-referrer"
          className={`${diagram.maxHeightClass ?? 'max-h-96'} w-auto max-w-full object-contain border border-line transition-colors duration-fast group-hover:border-line-strong`}
          onError={(e) => handleFallbackImageError(e, diagram.fallbackSrc)}
        />
        <span
          aria-hidden="true"
          className="absolute top-2 right-2 px-2 py-1 bg-ink-950/85 border border-line text-fg-secondary text-caption inline-flex items-center gap-1 group-hover:text-fg group-hover:border-crimson-500 transition-colors"
        >
          <ZoomIn className="w-3.5 h-3.5" />
          <span>放大</span>
        </span>
      </button>
      <figcaption className="text-caption text-fg-muted text-center">
        {diagram.caption}
      </figcaption>
    </figure>
  );
}

export interface GuideImagePreviewDialogProps {
  media: GuidePreviewMedia | null;
  onClose: () => void;
}

/**
 * 新手指南高清图片检视弹窗（支持 Esc 关闭与图鉴直达）
 */
export function GuideImagePreviewDialog({ media, onClose }: GuideImagePreviewDialogProps) {
  return (
    <Dialog
      open={Boolean(media)}
      onClose={onClose}
      title={media?.title}
      subtitle={media?.subtitle}
      size="xl"
      blurBackdrop
      footer={
        media?.cardNumber ? (
          <Link href={`/cards/${media.cardNumber}`}>
            <Button variant="secondary" size="sm">
              <ExternalLink className="w-3.5 h-3.5" />
              <span>查看图鉴详情</span>
            </Button>
          </Link>
        ) : undefined
      }
    >
      {media && (
        <div className="flex items-center justify-center bg-ink-950 border border-line p-3">
          <img
            key={media.src}
            src={media.src}
            alt={media.alt}
            referrerPolicy="no-referrer"
            className="max-h-[72vh] w-auto max-w-full object-contain"
            onError={(e) => handleFallbackImageError(e, media.fallbackSrc)}
          />
        </div>
      )}
    </Dialog>
  );
}

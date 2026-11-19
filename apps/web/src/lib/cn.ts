import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

// 向 tailwind-merge 注册 design-spec.md 自定义字号阶梯，避免与 text-fg / text-crimson-* 颜色类互相覆盖
const customTwMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [
        {
          text: [
            'hud',
            'caption',
            'body-sm',
            'body',
            'title-sm',
            'title',
            'display',
            'banner',
          ],
        },
      ],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return customTwMerge(clsx(inputs));
}

import fs from 'node:fs';
import path from 'node:path';

const SRC_DIR = 'F:/zhanshuangpamishi/战双帕弥什对战卡牌卡表';
const DEST_DIR = 'F:/zhanshuangpamishi/apps/web/public/cards';

if (!fs.existsSync(DEST_DIR)) {
  fs.mkdirSync(DEST_DIR, { recursive: true });
}

// 映射表: 截图文件名 -> 标准卡号
const FILE_MAPPING = {
  'ST01-灰鸦小队预组': [
    { file: '屏幕截图 2026-09-28 120405.png', cardNum: 'ST01-001', variant: 'R2' },
    { file: '屏幕截图 2026-09-28 120546.png', cardNum: 'ST01-001', variant: 'R1' },
    { file: '屏幕截图 2026-09-28 120656.png', cardNum: 'ST01-001', isMain: true },
    { file: '屏幕截图 2026-09-28 120749.png', cardNum: 'ST01-002', variant: 'R1' },
    { file: '屏幕截图 2026-09-28 120927.png', cardNum: 'ST01-002', isMain: true },
    { file: '屏幕截图 2026-09-28 120957.png', cardNum: 'ST01-003', variant: 'R1' },
    { file: '屏幕截图 2026-09-28 121026.png', cardNum: 'ST01-003', isMain: true },
    { file: '屏幕截图 2026-09-28 121142.png', cardNum: 'ST01-004', isMain: true },
    { file: '屏幕截图 2026-09-28 121206.png', cardNum: 'ST01-005', isMain: true },
    { file: '屏幕截图 2026-09-28 121310.png', cardNum: 'ST01-006', isMain: true },
    { file: '屏幕截图 2026-09-28 121432.png', cardNum: 'ST01-007', isMain: true },
    { file: '屏幕截图 2026-09-28 121507.png', cardNum: 'ST01-008', isMain: true },
    { file: '屏幕截图 2026-09-28 121545.png', cardNum: 'ST01-009', isMain: true },
    { file: '屏幕截图 2026-09-28 121620.png', cardNum: 'ST01-010', isMain: true },
    { file: '屏幕截图 2026-09-28 121655.png', cardNum: 'ST01-011', isMain: true },
    { file: '屏幕截图 2026-09-28 121727.png', cardNum: 'ST01-012', isMain: true },
    { file: '屏幕截图 2026-09-28 121803.png', cardNum: 'ST01-013', isMain: true },
    { file: '屏幕截图 2026-09-28 121822.png', cardNum: 'ST01-014', isMain: true },
  ],
  'ST02-升格者小队预组': [
    { file: '屏幕截图 2026-09-28 121954.png', cardNum: 'ST02-001', variant: 'R2' },
    { file: '屏幕截图 2026-09-28 122037.png', cardNum: 'ST02-001', variant: 'R1' },
    { file: '屏幕截图 2026-09-28 122052.png', cardNum: 'ST02-001', isMain: true },
    { file: '屏幕截图 2026-09-28 122357.png', cardNum: 'ST02-002', isMain: true },
    { file: '屏幕截图 2026-09-28 122436.png', cardNum: 'ST02-003', isMain: true },
    { file: '屏幕截图 2026-09-28 122502.png', cardNum: 'ST02-004', isMain: true },
    { file: '屏幕截图 2026-09-28 122525.png', cardNum: 'ST02-005', isMain: true },
    { file: '屏幕截图 2026-09-28 122755.png', cardNum: 'ST02-006', isMain: true },
    { file: '屏幕截图 2026-09-28 123019.png', cardNum: 'ST02-007', isMain: true },
    { file: '屏幕截图 2026-09-28 123050.png', cardNum: 'ST02-008', isMain: true },
    { file: '屏幕截图 2026-09-28 123109.png', cardNum: 'ST02-009', isMain: true },
    { file: '屏幕截图 2026-09-28 123300.png', cardNum: 'ST02-010', variant: 'R1' },
    { file: '屏幕截图 2026-09-28 123610.png', cardNum: 'ST02-010', isMain: true },
    { file: '屏幕截图 2026-09-28 123714.png', cardNum: 'ST02-011', variant: 'R1' },
    { file: '屏幕截图 2026-09-28 123735.png', cardNum: 'ST02-011', isMain: true },
    { file: '屏幕截图 2026-09-28 123850.png', cardNum: 'ST02-012', isMain: true },
    { file: '屏幕截图 2026-09-28 123937.png', cardNum: 'ST02-013', isMain: true },
    { file: '屏幕截图 2026-09-28 124000.png', cardNum: 'ST02-014', isMain: true },
  ],
  'ST03-三头犬小队预组': [
    { file: '屏幕截图 2026-09-28 124342.png', cardNum: 'ST03-001', variant: 'R2' },
    { file: '屏幕截图 2026-09-28 124411.png', cardNum: 'ST03-001', variant: 'R1' },
    { file: '屏幕截图 2026-09-28 124432.png', cardNum: 'ST03-001', isMain: true },
    { file: '屏幕截图 2026-09-28 124527.png', cardNum: 'ST03-002', variant: 'R1' },
    { file: '屏幕截图 2026-09-28 125158.png', cardNum: 'ST03-002', isMain: true },
    { file: '屏幕截图 2026-09-28 125221.png', cardNum: 'ST03-003', isMain: true },
    { file: '屏幕截图 2026-09-28 125243.png', cardNum: 'ST03-004', isMain: true },
    { file: '屏幕截图 2026-09-28 125312.png', cardNum: 'ST03-005', isMain: true },
    { file: '屏幕截图 2026-09-28 125430.png', cardNum: 'ST03-006', isMain: true },
    { file: '屏幕截图 2026-09-28 125453.png', cardNum: 'ST03-007', isMain: true },
    { file: '屏幕截图 2026-09-28 125612.png', cardNum: 'ST03-008', variant: 'R1' },
    { file: '屏幕截图 2026-09-28 125735.png', cardNum: 'ST03-008', isMain: true },
    { file: '屏幕截图 2026-09-28 125802.png', cardNum: 'ST03-009', isMain: true },
    { file: '屏幕截图 2026-09-28 125828.png', cardNum: 'ST03-010', isMain: true },
    { file: '屏幕截图 2026-09-28 125905.png', cardNum: 'ST03-011', isMain: true },
    { file: '屏幕截图 2026-09-28 130005.png', cardNum: 'ST03-012', isMain: true },
    { file: '屏幕截图 2026-09-28 130032.png', cardNum: 'ST03-013', isMain: true },
    { file: '屏幕截图 2026-09-28 130054.png', cardNum: 'ST03-014', isMain: true },
  ],
};

let copiedCount = 0;

for (const [folder, items] of Object.entries(FILE_MAPPING)) {
  const folderPath = path.join(SRC_DIR, folder);
  for (const item of items) {
    const srcFile = path.join(folderPath, item.file);
    if (!fs.existsSync(srcFile)) {
      console.warn(`File not found: ${srcFile}`);
      continue;
    }

    // 主图目标文件: 例如 ST01-001.png
    if (item.isMain) {
      const destFile = path.join(DEST_DIR, `${item.cardNum}.png`);
      fs.copyFileSync(srcFile, destFile);
      copiedCount++;
    }

    // 异画/罕贵版本文件: 例如 ST01-001-R1.png
    if (item.variant) {
      const destVariantFile = path.join(DEST_DIR, `${item.cardNum}-${item.variant}.png`);
      fs.copyFileSync(srcFile, destVariantFile);
      copiedCount++;
    }
  }
}

console.log(`Successfully copied and organized ${copiedCount} card images into ${DEST_DIR}`);

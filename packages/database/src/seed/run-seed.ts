import { getPrismaClient } from '../index.js';
import { PrismaCardRepository } from '../repositories/prisma-repos.js';
import { OFFICIAL_SEED_CARDS } from './official-cards.js';

export async function runDatabaseSeed(): Promise<void> {
  const prisma = getPrismaClient();
  const cardRepo = new PrismaCardRepository(prisma);

  console.log(`[Seed] 开始向数据库注入官方卡牌数据... 总量: ${OFFICIAL_SEED_CARDS.length}`);
  const result = await cardRepo.batchImport(OFFICIAL_SEED_CARDS);
  console.log(`[Seed] 卡牌数据注入完成: 新增 ${result.importedCount} 张, 更新 ${result.updatedCount} 张`);
}

// 允许直接作为脚本执行
if (process.argv[1]?.includes('run-seed')) {
  runDatabaseSeed()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[Seed] 注入失败:', err);
      process.exit(1);
    });
}

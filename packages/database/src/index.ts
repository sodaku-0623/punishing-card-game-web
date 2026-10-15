import { PrismaClient } from '@prisma/client';

export * from '@prisma/client';
export * from './repositories/interfaces.js';
export * from './repositories/prisma-repos.js';
export * from './repositories/memory-repos.js';
export * from './seed/official-cards.js';
export * from './seed/run-seed.js';

let prismaInstance: PrismaClient | null = null;

export function getPrismaClient(): PrismaClient {
  if (!prismaInstance) {
    prismaInstance = new PrismaClient({
      log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
    });
  }
  return prismaInstance;
}

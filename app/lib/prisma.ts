// Prisma Client Singleton
// Prevents multiple instances in development (hot reload)

import { PrismaClient } from '@prisma/client';

// Validate DATABASE_URL before creating Prisma client
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    'DATABASE_URL is not set. Please create a .env file in the app directory with:\n' +
    'DATABASE_URL="postgresql://user:password@localhost:5432/database_name?schema=public"'
  );
}

// Validate URL format
if (!databaseUrl.startsWith('postgresql://') && !databaseUrl.startsWith('postgres://') && !databaseUrl.startsWith('file:')) {
  throw new Error(
    `Invalid DATABASE_URL format. Must start with "postgresql://", "postgres://", or "file:".\n` +
    `Current value: ${databaseUrl.substring(0, 50)}...\n` +
    `Please check your .env file.`
  );
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

export default prisma;


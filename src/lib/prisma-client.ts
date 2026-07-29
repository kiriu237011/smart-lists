import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";

type PrismaLogLevel = "query" | "info" | "warn" | "error";

type CreatePrismaClientOptions = {
  log?: PrismaLogLevel[];
};

/**
 * Создаёт Prisma Client поверх node-postgres с предсказуемыми настройками пула.
 *
 * Пять соединений сохраняют параллелизм текущих запросов, но не позволяют каждой
 * Vercel-функции использовать дефолтный пул pg из десяти соединений. Ограниченное
 * ожидание не даёт запросам зависать, а короткий idle timeout освобождает
 * соединения Neon, когда serverless-инстанс простаивает.
 */
export function createPrismaClient(
  connectionString: string,
  options: CreatePrismaClientOptions = {},
): PrismaClient {
  if (connectionString.trim() === "") {
    throw new Error("Строка подключения PostgreSQL не может быть пустой.");
  }

  const adapter = new PrismaPg({
    connectionString,
    max: 5,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 10_000,
  });

  return new PrismaClient({
    adapter,
    ...(options.log ? { log: options.log } : {}),
  });
}

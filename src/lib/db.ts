/**
 * @file db.ts
 * @description Единственный экземпляр Prisma Client для всего приложения.
 *
 * Проблема, которую решает этот файл:
 * В режиме разработки Next.js перекомпилирует модули при каждом изменении файла (Hot Reload).
 * Если просто делать `new PrismaClient()` в каждом модуле, каждый раз создавался бы новый
 * клиент и новое подключение к базе данных. Это быстро исчерпало бы лимит соединений PostgreSQL.
 *
 * Решение — паттерн "Глобальный Синглтон":
 * Первый раз создаём клиент и сохраняем его в `globalThis` (глобальный объект Node.js).
 * При следующих перекомпиляциях берём уже готовый экземпляр из `globalThis`.
 * В production этот трюк не нужен, т.к. модули инициализируются только один раз.
 */

import { PrismaClient } from "@prisma/client";

/**
 * Фабричная функция, создающая новый экземпляр PrismaClient.
 * Вынесена отдельно, чтобы TypeScript мог вывести корректный тип через ReturnType<>.
 */
const prismaClientSingleton = () => {
  return new PrismaClient();
};

/** Тип единственного экземпляра PrismaClient, выведенный из фабрики. */
type PrismaClientSingleton = ReturnType<typeof prismaClientSingleton>;

/**
 * Расширяем тип глобального объекта `globalThis`, добавляя в него поле `prisma`.
 * Это необходимо, поскольку по умолчанию TypeScript не знает об этом поле.
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClientSingleton | undefined;
};

/**
 * Главный экземпляр Prisma Client.
 * - Если в `globalThis.prisma` уже есть готовый клиент — используем его (Hot Reload).
 * - Если нет — создаём новый через `prismaClientSingleton()`.
 */
const prisma = globalForPrisma.prisma ?? prismaClientSingleton();

export default prisma;

/**
 * В режиме разработки (не production) сохраняем экземпляр клиента в `globalThis`,
 * чтобы он пережил следующую горячую перезагрузку модуля.
 * В production это не нужно: серверный процесс живёт постоянно.
 */
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

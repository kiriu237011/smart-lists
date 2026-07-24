/**
 * @file setup.ts
 * @description Общая обвязка интеграционных тестов: моки внешних сервисов и
 *              очистка БД между тестами.
 *
 * Замокано всё, что не является предметом проверки и требует сети или секретов:
 *   - `@/auth` — сессия управляется тестом через `setSessionUser`;
 *   - `next/cache` — `revalidatePath` превращается в no-op;
 *   - `next/server` — `after` не выполняет колбэк сразу, а копит его: побочки
 *     (Pusher, очистка S3) в проде идут после ответа, тест запускает их явно
 *     через `flushAfter`, когда именно их и проверяет;
 *   - `next/headers` — cookie-хранилище в памяти;
 *   - `@/lib/notify` — Pusher-рассылка (проверяется как факт вызова);
 *   - сетевые функции `@/lib/s3` (реальный `buildAttachmentKey` сохранён —
 *     он чистый и участвует в проверяемой логике ключей).
 *
 * БД настоящая: `@/lib/db` не мокается, Prisma работает против тестового
 * PostgreSQL из `vitest.integration.config.ts`.
 */

import { afterEach, beforeEach, vi } from "vitest";

// Разделяемое между фабриками vi.mock состояние. vi.mock хойстится выше
// импортов, поэтому его фабрики не видят обычные переменные модуля — только
// то, что поднято через vi.hoisted.
const mockState = vi.hoisted(() => ({
  session: null as { user?: { id?: string } } | null,
  afterCallbacks: [] as Array<() => unknown | Promise<unknown>>,
  cookies: new Map<string, string>(),
}));

vi.mock("@/auth", () => ({
  auth: vi.fn(async () => mockState.session),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

vi.mock("next/server", () => ({
  after: (callback: () => unknown | Promise<unknown>) => {
    mockState.afterCallbacks.push(callback);
  },
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) =>
      mockState.cookies.has(name)
        ? { name, value: mockState.cookies.get(name)! }
        : undefined,
    set: (name: string, value: string) => {
      mockState.cookies.set(name, value);
    },
    delete: (name: string) => {
      mockState.cookies.delete(name);
    },
  })),
}));

vi.mock("@/lib/notify", () => ({
  notifyListMembers: vi.fn(async () => {}),
  notifyListsMembers: vi.fn(async () => {}),
  notifyUsers: vi.fn(async () => {}),
}));

// Частичный мок: подменяем только сетевые функции и гейт конфигурации, чистый
// buildAttachmentKey остаётся настоящим — он участвует в проверяемой логике
// генерации ключей. Без мока isS3Configured вернул бы false (в тестах нет
// S3-env), и requestUpload отбивал бы любую загрузку ещё до проверки квот.
vi.mock("@/lib/s3", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/s3")>();
  return {
    ...actual,
    isS3Configured: vi.fn(() => true),
    createUploadPost: vi.fn(async () => ({ url: "https://s3.test/upload", fields: {} })),
    // По умолчанию файла в S3 «нет»: тест успешного confirm задаёт метаданные
    // через mockResolvedValueOnce, а по умолчанию проверяется отказ.
    headObject: vi.fn(async () => null),
    getDownloadUrl: vi.fn(async () => "https://s3.test/download"),
    deleteObject: vi.fn(async () => {}),
    deleteObjects: vi.fn(async () => {}),
  };
});

// Реальный Prisma-клиент против тестовой БД (тот же, что используют Actions).
import prisma from "@/lib/db";

export { prisma };

/** Задаёт текущего авторизованного пользователя для `auth()`. */
export function setSessionUser(userId: string): void {
  mockState.session = { user: { id: userId } };
}

/** Сбрасывает сессию — `auth()` вернёт null (неавторизованный вызов). */
export function clearSession(): void {
  mockState.session = null;
}

/** Значение cookie, установленное Server Action (для проверок). */
export function getCookie(name: string): string | undefined {
  return mockState.cookies.get(name);
}

/** Кладёт cookie до вызова Action (например, «последнее пространство»). */
export function setCookie(name: string, value: string): void {
  mockState.cookies.set(name, value);
}

/**
 * Выполняет отложенные `after`-колбэки и дожидается их завершения.
 * Так проверяются побочные эффекты, которые в проде идут после ответа:
 * Pusher-рассылка и очистка S3.
 */
export async function flushAfter(): Promise<void> {
  const callbacks = mockState.afterCallbacks.splice(0);
  for (const callback of callbacks) {
    await callback();
  }
}

/** Таблицы в порядке, безопасном для TRUNCATE ... CASCADE. */
const TABLES = [
  "Attachment",
  "Item",
  "ListShare",
  "ListGroup",
  "List",
  "Space",
  "AiInsightUsage",
  "Session",
  "Account",
  "VerificationToken",
  "AllowedEmail",
  "AppSetting",
  "User",
];

beforeEach(async () => {
  // Чистое состояние на каждый тест: одну БД делят все тесты, поэтому остатки
  // прошлого теста иначе протекли бы в следующий.
  await prisma.$executeRawUnsafe(
    `TRUNCATE ${TABLES.map((table) => `"${table}"`).join(", ")} RESTART IDENTITY CASCADE`,
  );
  clearSession();
  mockState.cookies.clear();
  mockState.afterCallbacks.length = 0;
  vi.clearAllMocks();
});

afterEach(() => {
  mockState.afterCallbacks.length = 0;
});

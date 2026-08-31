import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";

/**
 * Хосты, для которых TLS не требуется: соединение не покидает машину.
 * `[::1]` — форма, в которой `new URL` возвращает IPv6-loopback.
 */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/**
 * Проверяет, что строка подключения обязывает драйвер проверять сертификат.
 *
 * Зачем нужна проверка, если сегодня и `require` работает строго: у
 * node-postgres своя трактовка `sslmode`, и она временная. Сейчас
 * `pg-connection-string` схлопывает `prefer`, `require` и `verify-ca` в
 * `verify-full`, но в `pg` 9 перейдёт на семантику libpq, где `require`
 * шифрует, не проверяя, с кем говорит. `pg` — транзитивная зависимость
 * `@prisma/adapter-pg`, поэтому этот мажор приедет внутри обновления Prisma,
 * то есть в обход правила «мажоры руками»; тесты при этом останутся зелёными,
 * потому что соединение продолжит устанавливаться. Единственное значение,
 * сохраняющее смысл в обеих трактовках, — `verify-full`, поэтому требуется
 * именно оно, а не «любое не слабое».
 *
 * Сравнение точное и в нижнем регистре: драйвер сверяет значение так же, и
 * `Verify-Full` он попросту не распознает — TLS тогда не включится вовсе.
 *
 * Сообщения об ошибках не содержат саму строку: в ней пароль роли.
 *
 * @param connectionString строка подключения PostgreSQL.
 * @throws Error если строка допускает соединение без проверки сертификата.
 */
export function assertSecureDatabaseUrl(connectionString: string): void {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error("Строка подключения PostgreSQL некорректна.");
  }

  if (!["postgres:", "postgresql:"].includes(url.protocol)) {
    throw new Error(
      "Строка подключения PostgreSQL должна использовать протокол postgres/postgresql.",
    );
  }

  // Флаг переводит драйвер в семантику libpq немедленно, не дожидаясь pg 9,
  // и делает `require` небезопасным уже сегодня.
  if (url.searchParams.get("uselibpqcompat") === "true") {
    throw new Error(
      "В строке подключения запрещён uselibpqcompat=true: он ослабляет проверку TLS.",
    );
  }

  // К локальной базе TLS не применяется: так работают интеграционные и E2E
  // прогоны, а также docker-compose разработчика.
  if (LOCAL_HOSTS.has(url.hostname.toLowerCase())) return;

  const sslmode = url.searchParams.get("sslmode");

  // Отсутствие параметра — не «дефолт по-строгому», а отсутствие TLS: без
  // `sslmode` node-postgres не включает шифрование вообще.
  if (sslmode === null) {
    throw new Error(
      "В строке подключения к удалённой базе отсутствует sslmode=verify-full.",
    );
  }

  if (sslmode !== "verify-full") {
    throw new Error(
      "Строка подключения к удалённой базе требует sslmode=verify-full.",
    );
  }
}

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

  // Fail-closed до создания пула: приложение без проверки сертификата не
  // стартует вовсе. Значение приходит из окружения, минуя ревью и CI, поэтому
  // барьер существует только здесь.
  assertSecureDatabaseUrl(connectionString);

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

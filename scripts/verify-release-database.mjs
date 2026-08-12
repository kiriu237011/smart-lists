/**
 * Проверяет идентичность цели перед release-миграцией, не печатая секрет.
 */
export function verifyReleaseDatabaseTarget(directUrl, expectedHost) {
  if (!directUrl) throw new Error("DIRECT_URL не задан");
  if (!expectedHost) throw new Error("EXPECTED_DATABASE_HOST не задан");

  let parsed;
  try {
    parsed = new URL(directUrl);
  } catch {
    throw new Error("DIRECT_URL не является корректным PostgreSQL URL");
  }

  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
    throw new Error("DIRECT_URL должен использовать протокол postgres/postgresql");
  }

  const actualHost = parsed.hostname.toLowerCase();
  const normalizedExpectedHost = expectedHost.trim().toLowerCase();
  if (actualHost !== normalizedExpectedHost) {
    throw new Error(
      "Release DB host не совпадает с ожидаемым: " + (actualHost || "<empty>"),
    );
  }
  if (actualHost.includes("-pooler")) {
    throw new Error("Release-миграции нельзя выполнять через pooled endpoint");
  }

  const database = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
  if (!database) throw new Error("В DIRECT_URL отсутствует имя базы данных");
  return { host: actualHost, database };
}

function run() {
  try {
    const target = verifyReleaseDatabaseTarget(
      process.env.DIRECT_URL,
      process.env.EXPECTED_DATABASE_HOST,
    );
    console.log("Release DB verified: " + target.host + "/" + target.database);
  } catch (error) {
    const message = error instanceof Error ? error.message : "неизвестная ошибка";
    console.error("::error::" + message);
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1]?.replaceAll("\\", "/");
const modulePath = new URL(import.meta.url).pathname;
if (invokedPath && modulePath.endsWith(invokedPath)) run();

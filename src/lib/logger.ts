import pino from "pino";
import { createHash } from "crypto";

/**
 * Глобальный логгер для приложения.
 *
 * В режиме разработки (NODE_ENV !== "production") использует pino-pretty
 * для красивого и цветного вывода в терминал.
 *
 * В production режиме выводит логи в формате JSON, что оптимально
 * для систем мониторинга вроде Vercel, AWS CloudWatch, Datadog и т.д.
 */

/**
 * Возвращает псевдоним идентификатора: первые 8 символов SHA-256.
 * Позволяет коррелировать действия одного пользователя без раскрытия его личности.
 */
export function hashId(id: string): string {
  return createHash("sha256").update(id).digest("hex").slice(0, 8);
}

export const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  ...(process.env.NODE_ENV !== "production"
    ? {
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "SYS:standard",
            ignore: "pid,hostname",
          },
        },
      }
    : {}),
});

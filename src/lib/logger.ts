import pino from "pino";

/**
 * Глобальный логгер для приложения.
 * 
 * В режиме разработки (NODE_ENV !== "production") использует pino-pretty
 * для красивого и цветного вывода в терминал.
 * 
 * В production режиме выводит логи в формате JSON, что оптимально
 * для систем мониторинга вроде Vercel, AWS CloudWatch, Datadog и т.д.
 */
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

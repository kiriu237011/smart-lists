/**
 * @file uuid.ts
 * @description Кроссбраузерная генерация UUID v4.
 *
 * `crypto.randomUUID()` доступен только в secure context (https или localhost).
 * При открытии dev-сервера по LAN-IP (http://192.168.x.x:3000) его нет,
 * и вызов падает с TypeError. Здесь — тот же UUID, но с фолбэком на
 * `crypto.getRandomValues()`, который работает и в insecure context.
 */

/** Возвращает UUID v4. Работает и вне secure context (http по LAN-IP). */
export function randomUUID(): string {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  // Фолбэк: собираем UUID v4 вручную из криптослучайных байтов
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // Версия 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // Вариант RFC 4122

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

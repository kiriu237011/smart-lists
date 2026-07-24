/**
 * @file memory-storage.ts
 * @description Реализация Storage в памяти для тестов гостевого режима.
 *
 * Гостевые данные живут в localStorage, поэтому его нужно чем-то заменить.
 * Взято вместо jsdom: гостевому коду нужен только Storage, а не DOM, и
 * полноценное окружение браузера здесь стоило бы секунд на прогон.
 *
 * `failOnWrite` воспроизводит исчерпанную квоту: настоящий localStorage в этом
 * случае бросает исключение, а гостевой код обязан вернуть "storageFailed",
 * а не потерять данные молча.
 */

export class MemoryStorage implements Storage {
  private store = new Map<string, string>();

  /** Когда true, любая запись бросает исключение — как переполненная квота. */
  failOnWrite = false;

  get length(): number {
    return this.store.size;
  }

  key(index: number): string | null {
    return [...this.store.keys()][index] ?? null;
  }

  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (this.failOnWrite) {
      throw new DOMException("Quota exceeded", "QuotaExceededError");
    }
    this.store.set(key, String(value));
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  /** Кладёт сырое значение мимо проверок — для тестов повреждённых данных. */
  seedRaw(key: string, value: string): void {
    this.store.set(key, value);
  }
}

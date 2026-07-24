/**
 * @file uuid.test.ts
 * @description Тесты генерации UUID и псевдонима идентификатора.
 *
 * `randomUUID` существует ради фолбэка: вне secure context (dev-сервер по
 * LAN-IP) `crypto.randomUUID` отсутствует, и без запасной ветки генерация ID
 * гостевых сущностей падает с TypeError. Фолбэк проверяется явной подменой.
 *
 * `hashId` — единственный способ попасть идентификатору в лог, поэтому важно,
 * что он не обратим и не пропускает исходное значение наружу.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { hashId } from "@/lib/logger";
import { randomUUID } from "@/lib/uuid";

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("randomUUID", () => {
  it("возвращает UUID v4", () => {
    expect(randomUUID()).toMatch(UUID_V4);
  });

  it("не повторяется", () => {
    const generated = new Set(Array.from({ length: 500 }, () => randomUUID()));

    expect(generated.size).toBe(500);
  });

  describe("вне secure context", () => {
    /** Оставляет только getRandomValues — как в http-контексте по LAN-IP. */
    function stubInsecureCrypto() {
      vi.stubGlobal("crypto", {
        getRandomValues: (array: Uint8Array) => {
          for (let i = 0; i < array.length; i++) {
            array[i] = i * 7 + 3; // детерминированно, чтобы проверить биты
          }
          return array;
        },
      });
    }

    it("не падает без crypto.randomUUID", () => {
      stubInsecureCrypto();

      expect(() => randomUUID()).not.toThrow();
    });

    it("собирает корректный UUID v4 из случайных байтов", () => {
      stubInsecureCrypto();

      expect(randomUUID()).toMatch(UUID_V4);
    });

    it("проставляет версию 4 и вариант RFC 4122", () => {
      stubInsecureCrypto();

      const uuid = randomUUID();

      // 13-й hex-символ — версия, 17-й — вариант (8, 9, a или b).
      expect(uuid[14]).toBe("4");
      expect(["8", "9", "a", "b"]).toContain(uuid[19]);
    });

    it("использует getRandomValues, а не Math.random", () => {
      const getRandomValues = vi.fn((array: Uint8Array) => array);
      vi.stubGlobal("crypto", { getRandomValues });

      randomUUID();

      expect(getRandomValues).toHaveBeenCalledTimes(1);
    });
  });
});

describe("hashId", () => {
  it("возвращает восемь hex-символов", () => {
    expect(hashId("user_1")).toMatch(/^[0-9a-f]{8}$/);
  });

  it("стабилен: один вход даёт один и тот же псевдоним", () => {
    expect(hashId("user_1")).toBe(hashId("user_1"));
  });

  it("различает разные идентификаторы", () => {
    expect(hashId("user_1")).not.toBe(hashId("user_2"));
  });

  it("не содержит исходное значение", () => {
    const id = "zhirikhin.kirill@example.com";

    expect(hashId(id)).not.toContain(id);
  });

  it("не падает на пустой строке", () => {
    expect(hashId("")).toMatch(/^[0-9a-f]{8}$/);
  });
});

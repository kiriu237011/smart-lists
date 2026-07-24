/**
 * @file attachments.test.ts
 * @description Тесты белого списка типов и форматирования размера.
 *
 * Белый список — ранний отсев на входе загрузки. Значения категорий должны
 * совпадать с Prisma-enum `FileCategory`, а расширения попадают в object key
 * S3, поэтому таблица зафиксирована тестом целиком.
 */

import { describe, expect, it } from "vitest";

import {
  ACCEPT_ATTRIBUTE,
  ALLOWED_TYPES,
  formatFileSize,
  getCategory,
  getExtension,
  isAllowedType,
  MAX_FILE_SIZE,
} from "@/lib/attachments";

describe("белый список типов", () => {
  it("содержит ровно четыре согласованных формата", () => {
    expect(Object.keys(ALLOWED_TYPES).sort()).toEqual([
      "application/pdf",
      "image/jpeg",
      "image/png",
      "text/plain",
    ]);
  });

  it("использует только категории, существующие в Prisma-enum", () => {
    for (const { category } of Object.values(ALLOWED_TYPES)) {
      expect(["IMAGE", "DOCUMENT"]).toContain(category);
    }
  });

  it("перечисляет все разрешённые типы в accept-атрибуте", () => {
    for (const type of Object.keys(ALLOWED_TYPES)) {
      expect(ACCEPT_ATTRIBUTE).toContain(type);
    }
  });
});

describe("isAllowedType", () => {
  it("пропускает разрешённый тип", () => {
    expect(isAllowedType("image/png")).toBe(true);
  });

  it("отбивает неразрешённый тип", () => {
    expect(isAllowedType("application/zip")).toBe(false);
  });

  it("отбивает пустую строку", () => {
    expect(isAllowedType("")).toBe(false);
  });

  it("не пропускает унаследованные от Object свойства", () => {
    // `contentType in ALLOWED_TYPES` видит прототипную цепочку, поэтому
    // "constructor" и "toString" — реальные кандидаты на ложное срабатывание.
    expect(isAllowedType("constructor")).toBe(false);
    expect(isAllowedType("toString")).toBe(false);
  });
});

describe("getCategory и getExtension", () => {
  it("определяют категорию изображения", () => {
    expect(getCategory("image/png")).toBe("IMAGE");
    expect(getCategory("image/jpeg")).toBe("IMAGE");
  });

  it("определяют категорию документа", () => {
    expect(getCategory("text/plain")).toBe("DOCUMENT");
    expect(getCategory("application/pdf")).toBe("DOCUMENT");
  });

  it("возвращают расширение для object key", () => {
    expect(getExtension("image/jpeg")).toBe("jpg");
    expect(getExtension("application/pdf")).toBe("pdf");
  });

  it("возвращают null для неразрешённого типа", () => {
    expect(getCategory("application/zip")).toBeNull();
    expect(getExtension("application/zip")).toBeNull();
  });

  it("возвращают null для унаследованных свойств, а не функцию прототипа", () => {
    expect(getCategory("toString")).toBeNull();
    expect(getExtension("toString")).toBeNull();
  });
});

describe("formatFileSize", () => {
  it("показывает байты без дробной части", () => {
    expect(formatFileSize(512)).toBe("512 B");
  });

  it("переключается на килобайты на границе", () => {
    expect(formatFileSize(1024)).toBe("1.0 KB");
  });

  it("округляет килобайты до одного знака", () => {
    expect(formatFileSize(1536)).toBe("1.5 KB");
  });

  it("переключается на мегабайты на границе", () => {
    expect(formatFileSize(1024 * 1024)).toBe("1.0 MB");
  });

  it("показывает предельный размер файла", () => {
    expect(formatFileSize(MAX_FILE_SIZE)).toBe("10.0 MB");
  });

  it("не падает на нуле", () => {
    expect(formatFileSize(0)).toBe("0 B");
  });
});

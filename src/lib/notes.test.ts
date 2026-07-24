/**
 * @file notes.test.ts
 * @description Тесты хелперов заметок.
 *
 * `normalizeNote` определяет, что попадёт в БД: пустая заметка обязана стать
 * null, а осмысленные переносы строк — уцелеть. `getNoteExcerpt` формирует
 * фрагмент вокруг поискового совпадения и не должен выходить за отведённую
 * длину ни на одной из веток.
 */

import { describe, expect, it } from "vitest";

import { getNoteExcerpt, normalizeNote } from "@/lib/notes";

describe("normalizeNote", () => {
  it("превращает пустую строку в null", () => {
    expect(normalizeNote("")).toBeNull();
  });

  it("превращает пробельную строку в null", () => {
    expect(normalizeNote("   \n\t  ")).toBeNull();
  });

  it("сохраняет переносы строк внутри текста", () => {
    expect(normalizeNote("первая\nвторая")).toBe("первая\nвторая");
  });

  it("приводит CRLF к LF", () => {
    expect(normalizeNote("первая\r\nвторая")).toBe("первая\nвторая");
  });

  it("приводит одиночный CR к LF", () => {
    expect(normalizeNote("первая\rвторая")).toBe("первая\nвторая");
  });

  it("обрезает пробелы по краям, не трогая середину", () => {
    expect(normalizeNote("  первая  вторая  ")).toBe("первая  вторая");
  });
});

describe("getNoteExcerpt", () => {
  it("возвращает короткую заметку целиком", () => {
    expect(getNoteExcerpt("короткая заметка", "заметка")).toBe("короткая заметка");
  });

  it("схлопывает любые пробелы в один", () => {
    expect(getNoteExcerpt("первая\n\n  вторая", "первая")).toBe("первая вторая");
  });

  it("не превышает заданную длину, когда совпадение найдено", () => {
    const note = `${"а".repeat(300)} игла ${"б".repeat(300)}`;

    expect(getNoteExcerpt(note, "игла", 60).length).toBeLessThanOrEqual(60);
  });

  it("не превышает заданную длину, когда совпадения нет", () => {
    const note = "а".repeat(300);

    expect(getNoteExcerpt(note, "игла", 60).length).toBeLessThanOrEqual(60);
  });

  it("включает совпадение во фрагмент", () => {
    const note = `${"а".repeat(300)} игла ${"б".repeat(300)}`;

    expect(getNoteExcerpt(note, "игла", 60)).toContain("игла");
  });

  it("ищет совпадение без учёта регистра", () => {
    const note = `${"а".repeat(300)} ИГЛА ${"б".repeat(300)}`;

    expect(getNoteExcerpt(note, "игла", 60)).toContain("ИГЛА");
  });

  it("обрезает с многоточием, когда совпадения нет", () => {
    expect(getNoteExcerpt("а".repeat(300), "игла", 60).endsWith("…")).toBe(true);
  });

  it("не ставит многоточие в начале, когда совпадение в самом начале", () => {
    const note = `игла ${"б".repeat(300)}`;

    expect(getNoteExcerpt(note, "игла", 60).startsWith("…")).toBe(false);
  });

  it("не ставит многоточие в конце, когда фрагмент дошёл до конца текста", () => {
    const note = `${"а".repeat(300)} игла`;

    expect(getNoteExcerpt(note, "игла", 60).endsWith("…")).toBe(false);
  });
});

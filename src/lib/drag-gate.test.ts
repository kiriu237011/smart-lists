/**
 * @file drag-gate.test.ts
 * @description Тесты затвора realtime-обновлений на время перетаскивания.
 *
 * Состояние затвора — модульные переменные, поэтому каждый тест начинается с
 * `endDrag()`: незакрытый затвор из предыдущего теста иначе протёк бы в
 * следующий. Это же и есть главный риск в проде — забытый `endDrag`
 * навсегда перестаёт пропускать обновления во вкладке.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  beginDrag,
  deferRefreshWhileDragging,
  endDrag,
} from "@/lib/drag-gate";

beforeEach(() => {
  endDrag();
});

describe("deferRefreshWhileDragging", () => {
  it("вне жеста не откладывает обновление", () => {
    const refresh = vi.fn();

    expect(deferRefreshWhileDragging(refresh)).toBe(false);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("во время жеста откладывает обновление и не вызывает его сразу", () => {
    const refresh = vi.fn();
    beginDrag();

    expect(deferRefreshWhileDragging(refresh)).toBe(true);
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("endDrag", () => {
  it("выполняет отложенное обновление после жеста", () => {
    const refresh = vi.fn();
    beginDrag();
    deferRefreshWhileDragging(refresh);

    endDrag();

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("хранит только последнее обновление: router.refresh идемпотентен", () => {
    const first = vi.fn();
    const second = vi.fn();
    beginDrag();
    deferRefreshWhileDragging(first);
    deferRefreshWhileDragging(second);

    endDrag();

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("не вызывает отложенное обновление повторно", () => {
    const refresh = vi.fn();
    beginDrag();
    deferRefreshWhileDragging(refresh);

    endDrag();
    endDrag();

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("безопасен, когда жеста не было", () => {
    expect(() => endDrag()).not.toThrow();
  });

  it("открывает затвор: после жеста обновления снова проходят напрямую", () => {
    beginDrag();
    deferRefreshWhileDragging(vi.fn());
    endDrag();

    expect(deferRefreshWhileDragging(vi.fn())).toBe(false);
  });

  it("отменённый жест не оставляет затвор закрытым", () => {
    beginDrag();
    endDrag(); // отмена без единого отложенного обновления

    expect(deferRefreshWhileDragging(vi.fn())).toBe(false);
  });
});

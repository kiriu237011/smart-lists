/**
 * @file drag-gate.test.ts
 * @description Тесты затвора realtime-обновлений на время перетаскивания.
 *
 * Состояние затвора — модульные переменные, поэтому каждый тест начинается с
 * `endItemDrag()`: незакрытый затвор из предыдущего теста иначе протёк бы в
 * следующий. Это же и есть главный риск в проде — забытый `endItemDrag`
 * навсегда перестаёт пропускать обновления во вкладке.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  beginItemDrag,
  deferRefreshWhileDragging,
  endItemDrag,
} from "@/lib/drag-gate";

beforeEach(() => {
  endItemDrag();
});

describe("deferRefreshWhileDragging", () => {
  it("вне жеста не откладывает обновление", () => {
    const refresh = vi.fn();

    expect(deferRefreshWhileDragging(refresh)).toBe(false);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("во время жеста откладывает обновление и не вызывает его сразу", () => {
    const refresh = vi.fn();
    beginItemDrag();

    expect(deferRefreshWhileDragging(refresh)).toBe(true);
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("endItemDrag", () => {
  it("выполняет отложенное обновление после жеста", () => {
    const refresh = vi.fn();
    beginItemDrag();
    deferRefreshWhileDragging(refresh);

    endItemDrag();

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("хранит только последнее обновление: router.refresh идемпотентен", () => {
    const first = vi.fn();
    const second = vi.fn();
    beginItemDrag();
    deferRefreshWhileDragging(first);
    deferRefreshWhileDragging(second);

    endItemDrag();

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("не вызывает отложенное обновление повторно", () => {
    const refresh = vi.fn();
    beginItemDrag();
    deferRefreshWhileDragging(refresh);

    endItemDrag();
    endItemDrag();

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("безопасен, когда жеста не было", () => {
    expect(() => endItemDrag()).not.toThrow();
  });

  it("открывает затвор: после жеста обновления снова проходят напрямую", () => {
    beginItemDrag();
    deferRefreshWhileDragging(vi.fn());
    endItemDrag();

    expect(deferRefreshWhileDragging(vi.fn())).toBe(false);
  });

  it("отменённый жест не оставляет затвор закрытым", () => {
    beginItemDrag();
    endItemDrag(); // отмена без единого отложенного обновления

    expect(deferRefreshWhileDragging(vi.fn())).toBe(false);
  });
});

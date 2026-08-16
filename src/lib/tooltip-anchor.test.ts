/**
 * @file tooltip-anchor.test.ts
 * @description Тесты геометрии всплывающей подсказки.
 *
 * Проверяется выбор стороны и зажатие в окно. Показ, задержка и уборка
 * подсказки живут в компоненте и видны только в E2E — здесь только координаты.
 */

import { describe, expect, it } from "vitest";

import { tooltipAnchorFor } from "@/lib/tooltip-anchor";

/** Окно ноутбука. */
const viewport = { width: 1000, height: 800 };

/** Подсказка средней длины. */
const tooltip = { width: 120, height: 28 };

/** Кнопка 28x28 в середине экрана. */
const middleButton = { left: 486, right: 514, top: 400, bottom: 428 };

describe("tooltipAnchorFor", () => {
  it("центрирует подсказку по кнопке", () => {
    const anchor = tooltipAnchorFor(middleButton, tooltip, viewport);

    expect(anchor.left).toBe(440);
    // Центр подсказки совпал с центром кнопки.
    expect(anchor.left + tooltip.width / 2).toBe(500);
  });

  it("ставит подсказку над кнопкой, когда сверху есть место", () => {
    const anchor = tooltipAnchorFor(middleButton, tooltip, viewport);

    expect(anchor.placement).toBe("top");
    // 400 - 6 зазора - 28 высоты.
    expect(anchor.top).toBe(366);
  });

  it("уводит подсказку вниз у верхнего края окна", () => {
    const headerButton = { left: 486, right: 514, top: 8, bottom: 36 };

    const anchor = tooltipAnchorFor(headerButton, tooltip, viewport);

    expect(anchor.placement).toBe("bottom");
    // 36 + 6 зазора.
    expect(anchor.top).toBe(42);
  });

  it("остаётся сверху у нижнего края окна", () => {
    const footerButton = { left: 486, right: 514, top: 760, bottom: 788 };

    const anchor = tooltipAnchorFor(footerButton, tooltip, viewport);

    expect(anchor.placement).toBe("top");
    expect(anchor.top).toBe(726);
  });

  it("прижимает подсказку к левому краю у крайней левой кнопки", () => {
    const leftButton = { left: 4, right: 32, top: 400, bottom: 428 };

    const anchor = tooltipAnchorFor(leftButton, tooltip, viewport);

    // Центрирование дало бы -42 — подсказка ушла бы за экран.
    expect(anchor.left).toBe(8);
  });

  it("прижимает подсказку к правому краю у крайней правой кнопки", () => {
    const rightButton = { left: 968, right: 996, top: 400, bottom: 428 };

    const anchor = tooltipAnchorFor(rightButton, tooltip, viewport);

    // 1000 - 120 ширины - 8 отступа.
    expect(anchor.left).toBe(872);
    expect(anchor.left + tooltip.width).toBeLessThanOrEqual(viewport.width);
  });

  it("оставляет видимым левый край подсказки шире окна", () => {
    const narrowViewport = { width: 100, height: 800 };
    const wideTooltip = { width: 200, height: 28 };

    const anchor = tooltipAnchorFor(middleButton, wideTooltip, narrowViewport);

    // Зажатие по правому краю дало бы -108: за экраном оказалось бы начало
    // текста, то есть единственная читаемая его часть.
    expect(anchor.left).toBe(8);
  });

  it("держит подсказку в окне, когда она не помещается ни сверху, ни снизу", () => {
    const shortViewport = { width: 1000, height: 60 };
    const button = { left: 486, right: 514, top: 20, bottom: 48 };

    const anchor = tooltipAnchorFor(button, tooltip, shortViewport);

    expect(anchor.top).toBe(8);
    expect(anchor.top).toBeGreaterThanOrEqual(0);
  });
});

/**
 * @file tooltip.e2e.ts
 * @description Всплывающие подсказки иконочных кнопок.
 *
 * Юнит-тест проверяет только геометрию (`src/lib/tooltip-anchor.test.ts`).
 * Здесь — поведение, которого нет без настоящего браузера: задержка показа,
 * различие мыши и клавиатуры, уборка подсказки и подпись кнопки.
 *
 * Кнопка сворачивания карточки взята как представитель: подсказку ей выдаёт
 * тот же общий компонент, что и остальным иконочным кнопкам, поэтому проверять
 * каждую отдельно значило бы проверять React.
 */

import type { Locator, Page } from "@playwright/test";

import { expect, test } from "./fixtures";
import { makeList } from "./factories";
import { onlyListCard, openSpace, visible } from "./helpers";

/** Подсказка живёт порталом в `body`, поэтому ищется по всей странице. */
function tooltip(page: Page): Locator {
  return visible(page, "tooltip");
}

/**
 * Переводит фокус клавишей Tab, пока он не дойдёт до нужной кнопки.
 *
 * Программный `focus()` здесь не годится: подсказка по фокусу показывается
 * только при `:focus-visible`, а его выдаёт эвристика браузера по последнему
 * способу ввода. Настоящий Tab — единственный способ в неё попасть.
 */
async function tabTo(page: Page, testId: string): Promise<void> {
  for (let press = 0; press < 40; press++) {
    await page.keyboard.press("Tab");
    const reached = await page.evaluate(
      (id) => document.activeElement?.getAttribute("data-testid") === id,
      testId,
    );
    if (reached) return;
  }
  throw new Error(`Фокус не дошёл до элемента ${testId} за 40 нажатий Tab`);
}

test("подсказка появляется при наведении и уходит вместе с курсором", async ({
  page,
  user,
  db,
}) => {
  await makeList(db, user.id, user.defaultSpaceId, { title: "Продукты" });
  await openSpace(page, user);

  const card = onlyListCard(page);
  await expect(tooltip(page)).toHaveCount(0);

  await card.getByTestId("list-collapse-toggle").hover();
  await expect(tooltip(page)).toHaveText("Collapse list");

  // Подсказка не перехватывает указатель: иначе собственное появление увело бы
  // курсор с кнопки и тут же её убрало.
  await expect(tooltip(page)).toHaveCSS("pointer-events", "none");

  /* Подсказка лежит выше модалок (`z-50`): она нужна и у кнопок внутри них, а
     без своего z-index осталась бы под их контекстом наложения. Проверяется
     вычисленным стилем, потому что ступени 60 в шкале Tailwind нет — класс
     `z-60` молча не сгенерировался бы, и разметка выглядела бы верной. */
  await expect(tooltip(page)).toHaveCSS("z-index", "60");

  await page.mouse.move(0, 0);
  await expect(tooltip(page)).toHaveCount(0);
});

test("подсказка не остаётся висеть после клика мышью", async ({
  page,
  user,
  db,
}) => {
  // Клик оставляет кнопку сфокусированной. Показ по фокусу ограничен
  // `:focus-visible` ровно затем, чтобы подсказка не висела над результатом
  // собственного нажатия, пока фокус не уйдёт.
  await makeList(db, user.id, user.defaultSpaceId, { title: "Продукты" });
  await openSpace(page, user);

  const card = onlyListCard(page);
  const toggle = card.getByTestId("list-collapse-toggle");

  await toggle.hover();
  await expect(tooltip(page)).toBeVisible();

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(tooltip(page)).toHaveCount(0);

  // Ждём дольше задержки показа: подсказка не должна вернуться сама.
  await page.waitForTimeout(700);
  await expect(tooltip(page)).toHaveCount(0);
});

test("подсказка доходит до клавиатуры и убирается по Escape", async ({
  page,
  user,
  db,
}) => {
  await makeList(db, user.id, user.defaultSpaceId, { title: "Продукты" });
  await openSpace(page, user);

  await tabTo(page, "list-collapse-toggle");
  await expect(tooltip(page)).toHaveText("Collapse list");

  await page.keyboard.press("Escape");
  await expect(tooltip(page)).toHaveCount(0);
});

test("подсказка становится подписью иконочной кнопки", async ({
  page,
  user,
  db,
}) => {
  // Один источник текста на подсказку и на озвучку: разойтись им нечем.
  await makeList(db, user.id, user.defaultSpaceId, { title: "Продукты" });
  await openSpace(page, user);

  const toggle = onlyListCard(page).getByTestId("list-collapse-toggle");
  await expect(toggle).toHaveAttribute("aria-label", "Collapse list");

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-label", "Expand list");
});

test("своя подпись кнопки подсказкой не подменяется", async ({
  page,
  user,
  db,
}) => {
  // У меню списка озвучка подробнее видимой подсказки: скринридер читает
  // кнопку вне контекста карточки, и название списка ему нужно.
  await makeList(db, user.id, user.defaultSpaceId, { title: "Продукты" });
  await openSpace(page, user);

  const trigger = onlyListCard(page).getByTestId("list-menu-trigger");
  await expect(trigger).toHaveAttribute("aria-label", "Actions for list Продукты");

  await trigger.hover();
  await expect(tooltip(page)).toHaveText("List actions");
});

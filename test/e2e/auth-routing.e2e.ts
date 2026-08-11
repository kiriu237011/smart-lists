/**
 * @file auth-routing.e2e.ts
 * @description Гейты доступа, редиректы пространств и локализованные маршруты.
 *
 * Проверяется то, что живёт в связке proxy + Server Component + cookie и в
 * тестах Actions не воспроизводится: куда попадает пользователь по конкретному
 * URL и какой префикс локали получает адрес.
 */

import { anonymousTest, expect, test } from "./fixtures";
import { makeSpace, makeUser } from "./factories";
import { LAST_SPACE_COOKIE } from "./env";
import { openSpace, visible } from "./helpers";

anonymousTest.describe("без сессии", () => {
  anonymousTest("корень редиректит на локаль и показывает вход", async ({ page }) => {
    await page.goto("/");

    await expect(page).toHaveURL(/\/en$/);
    await expect(page.getByTestId("auth-hero-title")).toHaveText(
      "Everything important, in one list.",
    );
    await expect(page.getByTestId("auth-list-preview")).toBeVisible();
    await expect(page.getByTestId("sign-in-google")).toBeVisible();
  });

  anonymousTest("экран входа помещается на мобильной ширине", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/en");

    await expect(page.getByTestId("auth-hero-title")).toBeVisible();
    await expect(page.getByTestId("auth-list-preview")).toBeVisible();
    await expect(page.getByTestId("sign-in-google")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  });

  anonymousTest("чужое пространство недоступно и уводит на экран входа", async ({
    page,
    db,
  }) => {
    const stranger = await makeUser(db);

    await page.goto(`/en/spaces/${stranger.defaultSpaceId}`);

    await expect(page).toHaveURL(/\/en$/);
    await expect(page.getByTestId("sign-in-google")).toBeVisible();
  });
});

test("авторизованный корень ведёт в пространство", async ({ page, user }) => {
  await page.goto("/en");

  await expect(page).toHaveURL(`/en/spaces/${user.defaultSpaceId}`);
});

test("несуществующее пространство подменяется default", async ({ page, user }) => {
  await page.goto("/en/spaces/space_does_not_exist");

  await expect(page).toHaveURL(`/en/spaces/${user.defaultSpaceId}`);
});

test("пространство другого пользователя недоступно по прямой ссылке", async ({
  page,
  user,
  db,
}) => {
  const stranger = await makeUser(db);
  const strangerSpace = await makeSpace(db, stranger.id, "Чужое пространство");

  await page.goto(`/en/spaces/${strangerSpace.id}`);

  // Не 404 и не чужие данные: пользователя возвращает в его собственное
  // пространство, потому что `getUserSpace` ищет с фильтром по владельцу.
  await expect(page).toHaveURL(`/en/spaces/${user.defaultSpaceId}`);
});

test("последнее пространство запоминается в cookie", async ({
  page,
  context,
  user,
  db,
}) => {
  const second = await makeSpace(db, user.id, "Второе пространство");

  await openSpace(page, user, second.id);

  // Пространство запоминает эффект в `SpaceSwitcher` после гидратации, вызывая
  // Server Action, поэтому cookie появляется не мгновенно.
  await expect
    .poll(async () =>
      (await context.cookies()).find((item) => item.name === LAST_SPACE_COOKIE)
        ?.value,
    )
    .toBe(second.id);

  // Заход на корень ведёт уже не в default, а в запомненное пространство.
  await page.goto("/en");
  await expect(page).toHaveURL(`/en/spaces/${second.id}`);
});

test("удаление из whitelist обрывает уже выданную сессию", async ({
  page,
  user,
  db,
}) => {
  await openSpace(page, user);

  // Отзыв доступа в проде выглядит именно так: строка удаляется руками в БД,
  // деплоя и выхода пользователя из системы при этом не происходит.
  await db.allowedEmail.delete({ where: { email: user.email } });

  await page.goto(`/en/spaces/${user.defaultSpaceId}`);

  await expect(page).toHaveURL(/\/en$/);
  await expect(page.getByTestId("sign-in-google")).toBeVisible();

  // Сессия не просто проигнорирована, а удалена: иначе cookie осталась бы
  // валидной и упиралась в проверку на каждом запросе.
  expect(await db.session.count({ where: { userId: user.id } })).toBe(0);
});

test("переключение локали меняет префикс URL и язык интерфейса", async ({
  page,
  user,
}) => {
  await openSpace(page, user);

  await visible(page, "locale-trigger").click();
  await page.locator('[data-testid="locale-option"][data-locale="ru"]:visible').click();

  await expect(page).toHaveURL(`/ru/spaces/${user.defaultSpaceId}`);
  // Подпись вкладки берётся из messages/ru.json — значит, сменилась не только
  // строка адреса, но и активные сообщения next-intl.
  await expect(visible(page, "tab-create")).toHaveText("Создать");
});

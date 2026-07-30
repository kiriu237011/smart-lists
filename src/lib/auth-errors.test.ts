/**
 * @file auth-errors.test.ts
 * @description Тесты безопасного отображения и логирования ошибок входа.
 *
 * Страница должна отличать только отказ по whitelist, не раскрывая причины
 * OAuth-сбоев. Email в логах заменяется стабильным коротким хешем.
 */

import { describe, expect, it } from "vitest";

import {
  deniedSignInLogContext,
  getAuthErrorContent,
} from "@/lib/auth-errors";

describe("getAuthErrorContent", () => {
  it("показывает причину whitelist только для AccessDenied", () => {
    expect(getAuthErrorContent("AccessDenied")).toEqual({
      title: "Доступ закрыт",
      description:
        "Ваш аккаунт не добавлен в список разрешённых пользователей.",
      hint: "Обратитесь к администратору, чтобы получить доступ.",
    });
  });

  it("не выдаёт ошибку конфигурации за отказ по whitelist", () => {
    const content = getAuthErrorContent("Configuration");

    expect(content.title).toBe("Не удалось войти");
    expect(JSON.stringify(content)).not.toContain("Configuration");
    expect(JSON.stringify(content)).not.toContain("список разрешённых");
  });

  it("скрывает неизвестный или отсутствующий код", () => {
    expect(getAuthErrorContent("CallbackRouteError")).toEqual(
      getAuthErrorContent(undefined),
    );
  });

  it("безопасно обрабатывает повторяющийся query-параметр", () => {
    expect(getAuthErrorContent(["AccessDenied", "Configuration"])).toEqual(
      getAuthErrorContent("AccessDenied"),
    );
  });
});

describe("deniedSignInLogContext", () => {
  it("не включает исходный email", () => {
    const email = "person@example.com";
    const context = deniedSignInLogContext(email);

    expect(context).toEqual({
      action: "signIn.denied",
      emailHash: expect.stringMatching(/^[a-f0-9]{8}$/),
    });
    expect(JSON.stringify(context)).not.toContain(email);
    expect(context).not.toHaveProperty("email");
  });

  it("даёт стабильный хеш и различает email", () => {
    expect(deniedSignInLogContext("person@example.com").emailHash).toBe(
      deniedSignInLogContext("person@example.com").emailHash,
    );
    expect(deniedSignInLogContext("person@example.com").emailHash).not.toBe(
      deniedSignInLogContext("other@example.com").emailHash,
    );
  });
});

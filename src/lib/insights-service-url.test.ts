/**
 * @file insights-service-url.test.ts
 * @description Контракт A68: адрес AI-сервиса проверяется до исходящего запроса.
 *
 * Тест существует не ради разбора URL, а ради одного свойства: значение
 * `INSIGHTS_SERVICE_URL` не может увести содержимое списков на произвольный хост.
 * Проверка формы — единственный барьер на этом пути: egress рантайма Vercel не
 * ограничен ничем и ограничить его нечем (A69).
 *
 * Негативные случаи подобраны по способам обойти наивную проверку, а не по
 * учебнику: чужой домен с `.run.app` внутри, credentials перед хостом, лишний
 * путь. Каждый из них прошёл бы `includes(".run.app")` или сравнение по началу
 * строки.
 */

import { describe, expect, it } from "vitest";

import { resolveInsightsServiceUrl } from "@/lib/insights-service-url";

/** Обе формы адреса, которые Cloud Run выдаёт этому сервису на самом деле. */
const REGIONAL = "https://insights-api-912709146180.us-central1.run.app";
const LEGACY = "https://insights-api-opzyml5ika-uc.a.run.app";

describe("resolveInsightsServiceUrl — принимает настоящий адрес", () => {
  it("принимает обе живые формы адреса Cloud Run", () => {
    expect(resolveInsightsServiceUrl(REGIONAL)).toBe(REGIONAL);
    expect(resolveInsightsServiceUrl(LEGACY)).toBe(LEGACY);
  });

  it("снимает завершающий слэш, чтобы к origin можно было дописать путь", () => {
    // Вызывающий собирает адрес как `${serviceUrl}/insights`; двойной слэш
    // дал бы 404 на ровном месте.
    expect(resolveInsightsServiceUrl(`${REGIONAL}/`)).toBe(REGIONAL);
  });
});

describe("resolveInsightsServiceUrl — отвергает чужое", () => {
  it("отвергает чужой домен, содержащий .run.app внутри", () => {
    // Прошло бы любую проверку через `includes`.
    expect(
      resolveInsightsServiceUrl("https://insights-api-x.run.app.evil.example"),
    ).toBeNull();
  });

  it("отвергает credentials перед хостом", () => {
    // Хост здесь — `evil.example`, а всё до `@` парсер считает логином.
    expect(
      resolveInsightsServiceUrl(
        "https://insights-api-x.run.app@evil.example",
      ),
    ).toBeNull();
  });

  it("отвергает другой сервис на том же домене Cloud Run", () => {
    expect(
      resolveInsightsServiceUrl("https://other-service-123.us-central1.run.app"),
    ).toBeNull();
  });

  it("отвергает http", () => {
    expect(resolveInsightsServiceUrl(REGIONAL.replace("https:", "http:"))).toBeNull();
  });

  it("отвергает путь, query, fragment и порт", () => {
    expect(resolveInsightsServiceUrl(`${REGIONAL}/insights`)).toBeNull();
    expect(resolveInsightsServiceUrl(`${REGIONAL}?to=evil.example`)).toBeNull();
    expect(resolveInsightsServiceUrl(`${REGIONAL}#evil`)).toBeNull();
    expect(
      resolveInsightsServiceUrl(
        "https://insights-api-912709146180.us-central1.run.app:8443",
      ),
    ).toBeNull();
  });

  it("отвергает пустое, отсутствующее и неразбираемое значение", () => {
    expect(resolveInsightsServiceUrl(undefined)).toBeNull();
    expect(resolveInsightsServiceUrl(null)).toBeNull();
    expect(resolveInsightsServiceUrl("")).toBeNull();
    expect(resolveInsightsServiceUrl("не адрес вовсе")).toBeNull();
  });
});

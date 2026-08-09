/**
 * @file gcp-auth.ts
 * @description Получение Google ID-токена для вызова приватного Cloud Run.
 *
 * Зачем: AI-сервис живёт в Cloud Run, и до 2026-08-09 его мог вызвать любой
 * желающий — ingress был публичным, а `run.invoker` выдан `allUsers`. Единственной
 * защитой оставался shared secret, а встроенный в сервис rate limit не работал
 * вовсе: ключ лимитера берётся из `X-Forwarded-For`, который задаёт сам клиент.
 * Теперь Cloud Run проверяет вызывающего сам, до того как запрос дойдёт до кода
 * сервиса, поэтому чужой трафик не поднимает инстансы и ничего не стоит.
 *
 * Как: Vercel выдаёт функции подписанный OIDC-токен, Workload Identity Federation
 * меняет его на право говорить от имени service account, а тот выпускает ID-токен
 * с audience целевого сервиса. Долгоживущих ключей нет ни на одном шаге — тот же
 * приём, что уже используют GitHub Actions для AWS и для GCP.
 *
 * ВАЖНО: модуль серверный. Ключей он не содержит, но тянет `google-auth-library`
 * и обращается к внутренним эндпоинтам Google — в клиентском бандле ему нечего
 * делать.
 */

import "server-only";

import { getVercelOidcToken } from "@vercel/oidc";
import { ExternalAccountClient, Impersonated } from "google-auth-library";

import { logger } from "@/lib/logger";

/**
 * Клиент переживает вызовы: он держит кеш обменянных токенов, и создавать его
 * заново на каждый инсайт значило бы ходить в STS каждый раз. Ленивая
 * инициализация нужна, чтобы отсутствие env не роняло импорт модуля.
 */
let impersonatedClient: Impersonated | null = null;
let clientInitialized = false;

/**
 * Все четыре значения несекретные: номер проекта, ID пула, ID провайдера и email SA.
 * Заданы только в Production — там же, где заданы `INSIGHTS_SERVICE_*`.
 */
function buildClient(): Impersonated | null {
  const projectNumber = process.env.GCP_PROJECT_NUMBER;
  const poolId = process.env.GCP_WORKLOAD_IDENTITY_POOL_ID;
  const providerId = process.env.GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID;
  const serviceAccount = process.env.GCP_SERVICE_ACCOUNT_EMAIL;

  if (!projectNumber || !poolId || !providerId || !serviceAccount) return null;

  // Обмен OIDC-токена Vercel на федеративный токен GCP. Импersonation здесь
  // намеренно не указан: ID-токен выпускает `Impersonated` ниже, а STS отдаёт
  // только федеративную личность.
  const sourceClient = ExternalAccountClient.fromJSON({
    type: "external_account",
    audience: `//iam.googleapis.com/projects/${projectNumber}/locations/global/workloadIdentityPools/${poolId}/providers/${providerId}`,
    subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
    token_url: "https://sts.googleapis.com/v1/token",
    subject_token_supplier: {
      // Токен приходит заголовком `x-vercel-oidc-token` на вызов функции.
      // Vercel переиспользует его до 90 минут при TTL два часа.
      getSubjectToken: () => getVercelOidcToken(),
    },
  });

  if (!sourceClient) return null;

  return new Impersonated({
    sourceClient,
    targetPrincipal: serviceAccount,
    lifetime: 3600,
    delegates: [],
    targetScopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });
}

/**
 * Выпускает ID-токен для приватного Cloud Run.
 *
 * @param audience базовый URL сервиса — именно его Cloud Run сверяет с `aud`.
 * @returns токен либо `null`, если федерация не настроена или обмен не удался.
 *
 * Возврат `null` вместо исключения сознателен. Федерация настроена только на
 * production, поэтому ни локальная разработка, ни Preview токена не получают —
 * им он и не нужен: переменные AI-сервиса там не заданы, и до этого места
 * выполнение не доходит. Это же свойство делало безопасным сам переход: пока
 * `allUsers` оставался на месте, отсутствие токена ничего не ломало.
 */
export async function getCloudRunIdToken(
  audience: string,
): Promise<string | null> {
  if (!clientInitialized) {
    impersonatedClient = buildClient();
    clientInitialized = true;
  }
  if (!impersonatedClient) return null;

  try {
    return await impersonatedClient.fetchIdToken(audience);
  } catch (error) {
    // Логируем без токена и без деталей ответа STS: там бывают фрагменты
    // подписанных утверждений.
    logger.error(
      { error, action: "getCloudRunIdToken" },
      "Не удалось выпустить ID-токен для Cloud Run",
    );
    return null;
  }
}

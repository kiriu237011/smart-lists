# Smart Lists

Smart Lists — локализованное веб-приложение для личных и совместных списков. Оно поддерживает пространства, группы, realtime-обновления, заметки, вложения и AI-инсайты, а также отдельный гостевой режим без регистрации.

## Возможности

- личные пространства и до пяти дополнительных пространств на пользователя;
- списки с группами, поиском, оптимистичными обновлениями и отметкой выполненных записей;
- совместное редактирование списков по приглашению;
- realtime-синхронизация между участниками, вкладками и устройствами через Pusher;
- текстовые заметки для списков и отдельных записей с защитой от конфликтов версий;
- приватные вложения в S3: PNG, JPEG, TXT и PDF;
- AI-инсайты по содержимому списка и его заметкам;
- гостевой режим с хранением данных только в `localStorage`;
- локали `ru`, `vi`, `en`, `ja` и автоматическое определение языка;
- адаптивный интерфейс, светлая и тёмная темы.

## Технологии

- Next.js 16 App Router, React 19, TypeScript;
- Tailwind CSS 4, Framer Motion, Lucide React;
- Auth.js v5 и Google OAuth;
- Prisma 6 и PostgreSQL;
- next-intl, Zod, Pino;
- Pusher, AWS S3, внешний FastAPI-сервис для AI.

## Требования

- Node.js 20 или новее;
- npm;
- PostgreSQL;
- Google OAuth-приложение;
- для полного набора функций: Pusher, AWS S3 и запущенный insights-сервис.

## Локальный запуск

1. Установите зависимости:

```bash
npm install
```

2. Создайте в корне файл `.env` и заполните необходимые переменные:

```env
DATABASE_URL=postgresql://user:password@localhost:5432/smart_lists
DIRECT_URL=postgresql://user:password@localhost:5432/smart_lists

AUTH_SECRET=replace-with-a-strong-random-secret
AUTH_URL=http://localhost:3000
AUTH_GOOGLE_ID=google-client-id
AUTH_GOOGLE_SECRET=google-client-secret
```

`DATABASE_URL` и `DIRECT_URL` в локальной среде могут совпадать. В облачной среде первая переменная обычно использует pooled connection, а вторая — прямое соединение для миграций.

Для Google OAuth добавьте callback URL:

```text
http://localhost:3000/api/auth/callback/google
```

3. Для realtime добавьте учётные данные Pusher:

```env
PUSHER_APP_ID=pusher-app-id
PUSHER_SECRET=pusher-secret
NEXT_PUBLIC_PUSHER_KEY=pusher-key
NEXT_PUBLIC_PUSHER_CLUSTER=pusher-cluster
```

4. Для вложений настройте приватный S3-бакет и CORS для прямой загрузки из браузера:

```env
S3_BUCKET_NAME=private-bucket-name
S3_REGION=ap-southeast-1
S3_ACCESS_KEY_ID=aws-access-key
S3_SECRET_ACCESS_KEY=aws-secret-key
```

5. Для AI-инсайтов укажите адрес отдельного сервиса и общий секрет:

```env
INSIGHTS_SERVICE_URL=http://localhost:8000
INSIGHTS_SERVICE_SECRET=shared-service-secret
```

Необязательный `LOG_LEVEL` задаёт уровень Pino; значение по умолчанию — `info`.

6. Примените существующие миграции:

```bash
npx prisma migrate deploy
```

7. Добавьте разрешённый Google email в таблицу `AllowedEmail`. Без записи в whitelist вход будет отклонён. Для локальной настройки удобно открыть Prisma Studio:

```bash
npx prisma studio
```

8. При необходимости включите гостевой вход, создав в таблице `AppSetting` запись:

| Поле | Значение |
| --- | --- |
| `key` | `guestModeEnabled` |
| `value` | `true` |

Любое другое значение или отсутствие записи отключает гостевой вход. Гостевые данные при этом не удаляются из браузера.

9. Запустите приложение:

```bash
npm run dev
```

Откройте [http://localhost:3000](http://localhost:3000). Корневой маршрут перенаправит на локаль, а после входа — в последнее выбранное пространство.

## Режимы доступа

Авторизованный пользователь получает серверное хранение, пространства, совместный доступ, realtime, вложения и AI. Вход разрешён только email-адресам из `AllowedEmail`.

Гостевой режим не требует аккаунта. Списки, записи, группы и заметки сохраняются в `localStorage` текущего браузера. Данные не синхронизируются и не переносятся автоматически в аккаунт.

## Как устроено приложение

- Основной маршрут авторизованного пользователя: `/{locale}/spaces/{spaceId}`.
- Server Components загружают данные напрямую через Prisma.
- Клиентские компоненты используют единый `ListsApi`: серверную реализацию для PostgreSQL или гостевую для `localStorage`.
- Мутации выполняются Server Actions с проверкой сессии, пространства, прав и Zod-валидацией.
- Вкладка-автор получает обновлённый RSC payload из ответа Action; остальные вкладки и участники получают событие Pusher `refresh`.
- Вложения загружаются напрямую в S3 по presigned POST и становятся видимыми только после серверной проверки `HeadObject`.

## Структура

```text
messages/                  переводы ru, vi, en, ja
prisma/
  schema.prisma            модели PostgreSQL
  migrations/              история миграций
src/
  app/
    [locale]/              локализованные страницы
    actions/               Server Actions
    api/                   Auth.js и Pusher auth endpoints
  components/
    guest/                 гостевой экран
    lists/                 списки, записи и связанные функции
    providers/             ListsApi, темы и настройки
    spaces/                пространства
    ui/                    общие UI-компоненты
  i18n/                    конфигурация next-intl
  lib/                     Prisma, S3, Pusher и доменные helpers
  auth.ts                  Auth.js
  proxy.ts                 locale middleware для Next.js 16
```

## Команды

| Команда | Назначение |
| --- | --- |
| `npm run dev` | Запустить dev server |
| `npm run lint` | Выполнить ESLint |
| `npm run build` | Применить миграции и собрать production bundle |
| `npm start` | Запустить готовую production-сборку |
| `npx prisma migrate deploy` | Применить существующие миграции |
| `npx prisma migrate dev` | Создать и применить миграцию при разработке схемы |
| `npx prisma studio` | Открыть интерфейс управления локальной БД |

> Важно: `npm run build` сначала выполняет `prisma migrate deploy`. Перед запуском проверьте, на какую базу указывает `DATABASE_URL`.

Отдельного автоматизированного test script в проекте пока нет.

## Ограничения

- дополнительные пространства: не более 5 на пользователя;
- заметка списка или записи: до 4000 символов;
- вложение: до 10 MiB;
- вложения: до 5 на список и до 20 на загрузившего пользователя;
- AI-инсайты: до 15 запросов на пользователя в сутки по UTC.

## Развёртывание

Проект рассчитан на Vercel и использует регион `sin1`. Перед production deploy:

1. настройте все необходимые environment variables;
2. убедитесь, что `DIRECT_URL` допускает применение миграций;
3. разрешите production origin в Google OAuth, Pusher и CORS-конфигурации S3;
4. проверьте доступность PostgreSQL и, если функции включены, insights-сервиса;
5. запустите `npm run lint` и production build в безопасном окружении.

Не публикуйте `.env`, OAuth secrets, Pusher secret, AWS keys и shared secret AI-сервиса.

## Документация для агентов

- `AGENTS.md` — обязательные правила работы в репозитории;
- `PROJECT_MEMORY.md` — актуальная архитектура, инварианты и важные решения;
- `CLAUDE.md` — импорт общих инструкций для Claude Code.

# План усиления доступа к PostgreSQL

**Статус:** этап 2a завершён; этап 2b включён и проверен в Preview, Production ожидает отдельного go/no-go
**Дата:** 2026-08-13

Этот документ задаёт целевую модель ролей PostgreSQL, границы первого RLS-контура,
матрицу доступа и безопасный порядок внедрения. Текущее состояние приложения
по-прежнему описывает `THREAT_MODEL.md`: сейчас изоляцию обеспечивают Auth.js,
`listInSpaceWhere` и проверки Server Actions, а RLS в базе не включён.

## Цель и границы

Цель первого цикла — добавить независимый DB-слой защиты от пропущенного
Prisma-фильтра и ограничить ущерб от runtime-роли:

- миграции и runtime используют разные роли и разные секреты;
- runtime не владеет таблицами, не имеет DDL и `BYPASSRLS`;
- tenant-строки закрыты native RLS;
- контекст пользователя и пространства устанавливается только из серверной
  сессии и живёт только внутри транзакции;
- существующие `auth()`, Zod, `listInSpaceWhere` и владельческие фильтры
  сохраняются как первый слой защиты.

Первый цикл **не** обещает защиту от полного RCE процесса Next.js или кражи
runtime connection string. Роль runtime сможет установить произвольный
двухчастный custom GUC, поэтому `app.user_id` не является доказанной базой
личностью. RLS с таким контекстом закрывает ошибки приложения, но не считается
контролем против злоумышленника, уже управляющего соединением. DB-проверяемый
JWT или отдельные DB-роли на каждого пользователя в этот цикл не входят.

## Целевая модель ролей

| Роль | Где доступна | Права |
|---|---|---|
| `smartlists_owner` | без login; используется владельческой ролью миграций | владеет схемой, таблицами, функциями и политиками |
| `smartlists_migrator` | только release workflow | применяет миграции через прямое подключение и может действовать от имени owner |
| `smartlists_runtime` | только Next.js runtime | `CONNECT`, `USAGE` схемы и минимальные DML-права; без DDL, ownership, `CREATEROLE`, `BYPASSRLS` |
| backup-role | только backup workflow | read-only доступ ко всем строкам; точный способ обхода RLS выбирается после проверки возможностей Neon |

Названия предварительные. Пароли, connection strings и создание login-ролей не
попадают в миграции или репозиторий. Миграции содержат владение объектами,
`GRANT`/`REVOKE`, default privileges и политики, но не credentials.

`DIRECT_URL` удалён из окружения Vercel Production и Preview после успешного
cutover-релиза. Репозиторий не использует его в build/generate; прямой
credential остаётся только в защищённых release/backup workflow и локальной
среде. Поэтому следующий этап — runtime-роль без DDL — больше не обесценивается
соседней владельческой строкой подключения.

## Gate этапа 2b: runtime least privilege без RLS

Первый cutover прав отделяет только runtime. Текущая Neon-роль-владелец пока
остаётся совмещённой owner/migrator ролью в GitHub release-контуре; перенос
ownership на отдельную `NOLOGIN`-роль не объединяется с заменой runtime
credential. Это уменьшает число одновременно меняющихся условий и сохраняет
простой откат. Backup также остаётся отдельным следующим изменением: сейчас он
использует `pg_dump` через защищённый workflow и не попадает в Vercel runtime.

### Фактические обращения приложения

Матрица ниже получена из Server Components, Server Actions, raw SQL и текущего
`@auth/prisma-adapter`. Она описывает права до RLS: роль всё ещё технически
может обращаться к любым строкам разрешённой таблицы. Поэтому этот этап
ограничивает последствия компрометации runtime на уровне DDL и состава таблиц,
но ещё не создаёт tenant-изоляцию внутри таблицы.

| Таблица | Runtime-права | Причина |
|---|---|---|
| `User` | `SELECT, INSERT, UPDATE` | Google OAuth: поиск, создание и обновление профиля |
| `Account` | `SELECT, INSERT` | поиск и привязка Google account; unlink/delete потока сейчас нет |
| `Session` | `SELECT, INSERT, UPDATE, DELETE` | database sessions Auth.js, sign-out и отзыв сессий |
| `VerificationToken` | нет | email/passwordless provider не настроен |
| `AllowedEmail` | `SELECT` | whitelist управляется вне runtime |
| `AppSetting` | `SELECT` | глобальный feature flag управляется вне runtime |
| `Space` | `SELECT, INSERT, UPDATE, DELETE` | default-space, rename и удаление пространства |
| `List`, `ListGroup`, `_ListGroupMembers`, `ListShare`, `Item`, `Attachment` | `SELECT, INSERT, UPDATE, DELETE` | действующие CRUD, reorder, sharing и two-phase attachments |
| `UserDailyUsage` | `SELECT, INSERT, UPDATE, DELETE` | upsert счётчика, компенсация и очистка старых собственных строк |
| `_prisma_migrations` | нет | доступен только миграционному контуру |

Во всей схеме runtime не получает `TRUNCATE`, `REFERENCES`, `TRIGGER`, права на
sequences/functions и автоматический доступ к будущим объектам. Сейчас
application sequences в `public` отсутствуют: идентификаторы создаются в коде.
Новая таблица намеренно ломает runtime до явного review и добавления в матрицу,
а не наследует широкий `GRANT ALL`.

Роль создаётся SQL-командой, а не через Neon Console/CLI: роли, созданные
control plane Neon, получают membership в `neon_superuser`, что уничтожило бы
изоляцию. Контракт роли:

- `LOGIN`, но `NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE`, `NOINHERIT`,
  `NOREPLICATION`, `NOBYPASSRLS` и без membership в других ролях;
- только `CONNECT` к нужной БД и `USAGE` схемы `public`;
- без database/schema `CREATE`, ownership и доступа к
  `_prisma_migrations`;
- `TEMP` пока наследуется от стандартного `PUBLIC`: приложение его не
  использует, но глобальный `REVOKE TEMP FROM PUBLIC` затронул бы все роли и
  не входит в этот узкий cutover. Это остаточный privilege, а не право менять
  постоянную схему.

### Инструменты и защита от ошибочного target

`npm run db:audit-privileges` выполняет только `BEGIN READ ONLY`, читает
Postgres catalogs и выводит fingerprint endpoint, атрибуты роли, ownership,
эффективные права и RLS-состояние. Connection string и строки данных не
выводятся. Источник выбирается в порядке `AUDIT_DATABASE_URL`, `DIRECT_URL`,
`DATABASE_URL`.

`npm run db:configure-runtime-role` по умолчанию показывает план. Реальное
изменение требует аргумента `-- --apply` и трёх env-переменных:
`DIRECT_URL`, `EXPECTED_DATABASE_HOST`, `RUNTIME_ROLE_PASSWORD`. Скрипт
запрещает pooled admin endpoint, сравнивает exact host, отказывается работать
при неожиданном наборе таблиц, выполняет `REVOKE` и точечные `GRANT` в одной
транзакции, затем подключается новым credential и повторно проверяет полный
контракт. Существующий пароль не меняется без отдельного
`--rotate-password`; пароль и runtime URL никогда не печатаются.

До применения в любой облачной среде read-only audit обязан подтвердить её
фактическую роль и endpoint. Метаданных Vercel недостаточно: `DATABASE_URL`
имеет тип `sensitive`, его значение нельзя считать обратно через CLI. Для
аудита используется прямой credential соответствующего GitHub Environment или
доступ к выбранной ветке Neon; локальный `.env` доказательством Preview или
Production не считается.

**Read-only audit 2026-08-13:** через Neon CLI отдельно проверены ветки `dev`
(Preview) и `production`. Их direct endpoints различаются; обе ветки содержат
ожидаемые 15 таблиц `public` вместе с `_prisma_migrations`, без sequences,
RLS и policies. Единственная пользовательская login-роль — `neondb_owner`;
она владеет БД, схемой и всеми таблицами, наследует `neon_superuser` и имеет
`CREATEROLE`, `CREATEDB`, `REPLICATION`, `BYPASSRLS` и полный набор табличных
прав. Отдельных runtime, migrator или backup ролей пока нет. Audit выполнялся
в `READ ONLY`-транзакции; connection strings не печатались и не записывались.
Набор объектов совпал с fail-closed матрицей, поэтому неожиданных препятствий
для отдельного Preview cutover не найдено.

**Подготовка Preview 2026-08-13:** в ветке `dev` SQL-командой создана
`smartlists_runtime` с одноразовым случайным паролем. Скрипт после commit
переподключился под новой ролью и подтвердил весь контракт: нет membership,
DDL/BYPASS/role attributes и доступа к `_prisma_migrations`, а DML совпадает с
матрицей. Control-plane проверка подтвердила наличие роли только в `dev`; в
`production` по-прежнему существует лишь `neondb_owner`.

**Preview cutover 2026-08-13:** пароль роли ротирован в памяти процесса,
Vercel Preview `DATABASE_URL` заменён на pooled credential
`smartlists_runtime`, а deployment `dpl_2Q3NqEW1QfNZxTpa1tRgXaoZwBu6` получил
`Ready` и постоянный branch alias. Защищённый Vercel Authentication deployment
проверен через временный automation bypass: приложение ответило `200` на
`/en`; token сразу отозван, временные OIDC-файлы удалены. Финальный read-only
audit подтвердил запрещённые role attributes, отсутствие membership в других
ролях и точную DML-матрицу. Production и его credential не менялись.

**Ручной Preview gate 2026-08-13:** пользователь подтвердил Google OAuth и
сохранение сессии, CRUD списков/записей/групп/заметок, sharing с разделением
прав владельца и редактора, realtime между вкладками/участниками и полный поток
вложений. В Vercel runtime logs после проверки ошибок нет. Тем самым Preview
gate закрыт; следующий инфраструктурный шаг — только отдельный Production
go/no-go. AI намеренно не входит в Preview gate: эта среда не получает
`INSIGHTS_SERVICE_*` и не допущена GCP federation.

Первый пробный cutover был автоматически откачен на owner credential после
ошибочной трактовки штатного Vercel Authentication `302` как отказа приложения.
Rollback deployment получил `Ready`; повторная проверка через официальный
protection bypass отделила ответ приложения от внешнего SSO-редиректа. Также
исправлена идемпотентная ротация: существующая роль теперь сначала проверяется
fail-closed, а не получает повторный `ALTER ROLE ... NOSUPERUSER`, запрещённый
для обычной `CREATEROLE`-роли PostgreSQL 17.

### Cutover и rollback

Порядок не меняется местами:

1. Read-only audit Preview, сохранение текущего owner pooled URL в защищённом
   операторском хранилище и проверка, что им можно восстановить Vercel
   `DATABASE_URL`. Без этого rollback не подготовлен.
2. Создание/сверка `smartlists_runtime` в Preview, запуск интеграционных и
   отрицательных privilege-тестов новым credential.
3. Замена только Preview `DATABASE_URL`, новый deployment, проверка Google
   sign-in/session, списков, sharing, групп, reorder, заметок, вложений, AI и
   realtime. Миграционный secret и схема не меняются.
4. При ошибке вернуть сохранённый owner pooled URL, redeploy и только после
   восстановления разбирать недостающий `GRANT`. Роль не удалять; при
   подозрении на компрометацию перевести в `NOLOGIN` и ротировать пароль.
5. После стабильного Preview повторить read-only audit и тот же процесс для
   Production отдельным go/no-go. Старый owner URL не хранить в Vercel рядом с
   runtime: после окна отката удалить операторскую копию по принятой процедуре.

Структурный rollback не нужен: создание ограниченной роли и `GRANT` не меняют
данные, ownership или схему. Функциональный откат — только возврат Vercel на
прежний credential и redeploy. Автоматические privilege-, deployment- и
HTTP-проверки, а также ручные пользовательские потоки Preview пройдены.
Production требует отдельного явного go/no-go.

## Контексты запросов

Планируются два явных контекста:

- пользовательский: `app.user_id` — квоты, список пространств и операции без
  выбранного пространства;
- пользователь + пространство: `app.user_id` и `app.space_id` — списки,
  группы, записи, shares и вложения.

Оба устанавливаются параметризованным `set_config(..., true)` внутри
interactive transaction Prisma. Политики читают настройки через
`current_setting(..., true)` и при отсутствующем/пустом значении отказывают в
доступе. Значение никогда не берётся из `FormData`, URL или cookie напрямую:
`userId` приходит из `auth()`, а `spaceId` сначала подтверждается запросом
`Space(id, userId)`.

Публичный код не получает глобальный Prisma Client для tenant-операций. Он
работает через явный `withUserDb`/`withSpaceDb` и переданный `tx`. Существующие
вложенные `$transaction` должны быть распрямлены; сетевые вызовы S3, Pusher и AI
не удерживают DB-транзакцию.

## Матрица первого RLS-контура

| Таблица | `SELECT` | `INSERT` | `UPDATE` | `DELETE` |
|---|---|---|---|---|
| `Space` | только строка `userId = app.user_id` | только для `userId = app.user_id` | только своя строка; нельзя сменить владельца | только своя строка |
| `List` | владелец либо активный `ListShare` в `app.space_id` | владелец — текущий пользователь, `spaceId` — текущий | владелец или editor в текущем пространстве; поля владения защищены отдельно | только владелец в текущем пространстве |
| `ListShare` | участники доступного списка могут видеть состав доступа | только владелец списка; получатель существует | в текущем коде запрещён | владелец списка либо сам получатель удаляет свой доступ |
| `ListGroup` | только группа пользователя в текущем пространстве | только пользователь и текущее пространство | только владелец группы; нельзя сменить владельца/пространство | только владелец группы |
| `ListGroupMembership` | только если группа принадлежит пользователю, а список доступен в том же пространстве | то же условие для обеих сторон связи | в текущем коде запрещён | только владелец группы, при сохранении space-инварианта |
| `Item` | через доступ к родительскому списку в текущем пространстве | editor или владелец списка | editor или владелец списка | editor или владелец списка |
| `Attachment` | через доступ к родительскому списку в текущем пространстве | editor или владелец; `uploadedById = app.user_id` | только допустимый переход состояния для доступного списка | editor/владелец списка; отдельная очистка — по узкому системному пути |
| `UserDailyUsage` | только `userId = app.user_id` | только собственная строка | только собственная строка | runtime не требуется |

Политика RLS ограничивает строки, но сама по себе не запрещает editor менять
отдельные колонки доступной строки `List`. Поля `userId`, `spaceId`, `title` и
операции владения должны получить дополнительный контроль. Перед реализацией
выбирается один из двух вариантов:

1. trigger сравнивает `OLD`/`NEW` и разрешает editor менять только содержимое;
2. у runtime отзывается прямой `UPDATE` защищённых колонок, а легитимные
   операции проходят через узкие `SECURITY DEFINER`-функции владельца.

Предпочтителен второй вариант там, где он не усложняет Prisma-поток. Любая
definer-функция получает фиксированный `search_path`, минимальные права,
валидацию владельца внутри функции и `REVOKE ... FROM PUBLIC`.

Общая логика «доступен ли список в пространстве» должна находиться в одной
неизменяемой по контракту DB-функции и использоваться политиками `List`,
`Item`, `Attachment`, `ListShare` и membership. Это снижает риск расхождения
пяти копий одного правила.

## Модели вне первого RLS-контура

| Таблицы | Решение первого цикла |
|---|---|
| `User`, `Account`, `Session`, `VerificationToken` | остаются за Auth.js/Prisma Adapter; runtime получает только необходимые DML-права |
| `AllowedEmail`, `AppSetting` | остаются глобальными; доступ разрешён только конкретным серверным потокам, без tenant-RLS |

Разделение одного runtime-подключения на auth-клиент и tenant-клиент в первом
цикле не планируется: это отдельное усложнение пула и деплоя. Поэтому остаточный
риск для глобальных таблиц уменьшается least privilege, но не устраняется RLS.
Решение пересматривается после стабилизации tenant-контура.

## Специальные потоки, которые нельзя сломать

### Расшаривание и пространство получателя

Сейчас `shareList` может создать получателю default-space через
`ensureSpaceState(recipientId)`. Обычная пользовательская RLS-политика не должна
позволять создавать `Space` другому пользователю. До включения enforcement
нужно либо изменить инвариант так, чтобы default-space создавался только при
регистрации/входе, либо вынести этот один поток в узкую owner-функцию. Второй
вариант требует отдельного abuse-теста и не должен давать произвольный
cross-user `INSERT`.

### Realtime после commit

`after()` сейчас может читать участников списка после завершения мутации.
Контекст транзакции к этому моменту уже закрыт. Список получателей нужно
вычислять внутри авторизованной транзакции и передавать в фоновую задачу как
минимальный набор идентификаторов; `after()` не должен повторно обращаться к
tenant-таблицам через Prisma.

### Очистка вложений

Пользовательская очистка stale `PENDING` остаётся ограниченной текущим
пользователем и доступными списками. Глобальная операционная очистка, если она
понадобится, выполняется отдельным job-role, а не расширением пользовательской
политики.

### Auth.js и квоты

Prisma Adapter выполняет запросы до появления `app.user_id`, поэтому auth-
таблицы не зависят от пользовательского контекста. `UserDailyUsage`, напротив,
всегда выполняется внутри `withUserDb`; AI-вызов идёт уже после атомарного
резервирования квоты.

## Порядок реализации

1. **Design — этот этап.** Зафиксировать матрицу, исключения, критерии допуска,
   откат и остаточные риски. Не менять production.
2. **Release pipeline.** Убрать `prisma migrate deploy` из Vercel build,
   завести отдельный миграционный workflow и секрет, проверить backup/restore.
3. **Least privilege без RLS.** Создать owner/migrator/runtime-роли, передать
   runtime минимальные права и доказать, что он не может DDL/ownership/role
   operations. Приложение всё ещё защищено существующими фильтрами.
4. **Scoped Prisma API.** Добавить `withUserDb`/`withSpaceDb`, перенести все
   tenant-запросы и специальные потоки, сохранив поведение и тесты.
5. **DB-объекты без enforcement.** Добавить helper-функции, column controls и
   политики миграцией, но пока не включать RLS для runtime-трафика.
6. **Enforcement.** Сначала integration DB, затем dev/preview и только после
   полного go/no-go — production. Таблицы включаются небольшими связанными
   группами, а не одним большим переключателем.
7. **Проверка после включения.** Аудит атрибутов ролей, policy catalog,
   отрицательные cross-user тесты, метрики ошибок и повторный threat impact-
   check.

Каждая миграция должна быть совместима и со старой, и с новой версией
приложения. RLS включается только после ухода старых инстансов, которые ещё не
устанавливают контекст.

### Gate этапа 2: подготовка и cutover

Репозиторий сначала получает feature flag-закрытый release-контур:

- встроенная в `ci.yml` job `production-migration` запускается только при
  repository variable `ENABLE_PRODUCTION_MIGRATION=true` и после всех
  проверок того же main SHA;
- `sync-preview.yml` мигрирует Preview до push только при
  `ENABLE_PREVIEW_MIGRATION=true`;
- оба потока сравнивают host `DIRECT_URL` с отдельным environment secret
  `EXPECTED_DATABASE_HOST` и запрещают pooled endpoint;
- после доказанного внешнего gate Vercel build заменяется на обычный
  `npm run build`; `prisma generate` не требует `DIRECT_URL`, а dependency
  install не получает даже placeholder этого секрета.

Перед cutover обязательно:

1. Создать GitHub Environments `production` и `preview`. В каждом задать secret
   `DIRECT_URL` соответствующей Neon-ветки и второй secret
   `EXPECTED_DATABASE_HOST` с точным direct hostname.
2. Создать repository variables `ENABLE_PRODUCTION_MIGRATION=true` и
   `ENABLE_PREVIEW_MIGRATION=true`. Первый прогон оставался безопасным:
   временный `build:deploy` ещё применял те же миграции идемпотентно.
3. Убедиться, что main CI создал зелёную check job production migration, а
   Preview sync применил миграции до push.
4. В Vercel Production Deployment Checks сделать эту GitHub job обязательной
   для promotion. Проверить на следующем no-op release, что production alias
   ждёт её завершения.
5. Убедиться, что backup workflow по-прежнему создаёт читаемый dump; последняя
   полная restore-проверка остаётся действительной только до изменения мажора
   PostgreSQL или формата дампа.
6. Только после этих проверок отдельным commit заменить Vercel build на
   `npm run build`, удалить `build:deploy`, доказать успешный Production и
   Preview release и затем удалить `DIRECT_URL` из Vercel environments.

**Прогресс 2026-08-12:** пункт 1 подготовлен. Через GitHub API подтверждены
Environments `Production` и `Preview`, наличие в каждой secrets `DIRECT_URL` и
`EXPECTED_DATABASE_HOST`, а также branch policy `main`. Значения secrets API
не раскрывает; соответствие реальным Neon-веткам считается подтверждённым
только после успешного target guard. Repository variables
`ENABLE_PRODUCTION_MIGRATION` и `ENABLE_PREVIEW_MIGRATION` включены 2026-08-12.
PR №60 слит в `main` 2026-08-13. Run `31652132055` прошёл все тестовые gates,
production target guard подтвердил direct host, а Prisma обнаружила 18
миграций и отсутствие pending-изменений. Следующий run `31652333174` тем же
образом проверил Preview до push постоянной ветки; Vercel deployment нового
preview SHA завершился успешно. Секреты и hostname в логи не попали.
Release-контур этапа 2a доказан для обеих сред. Обязательный GitHub Deployment Check
`Production database migration` доказан контрольным release PR №62, merge SHA
`c0e5388829b8aa8df5efbe5d90ca8d5b0dbdae65`: Vercel перешёл в
`Waiting for checks to complete` в `00:30:46Z`, migration job стартовала в
`00:32:46Z` и завершилась в `00:33:20Z`, а Production deployment получил
`success` только в `00:33:23Z`. Run `31654625609` повторно прошёл target guard
и no-op миграцию (18 миграций, pending нет). Последний scheduled backup run
`31614719537` успешен; схема, мажор PostgreSQL и формат дампа после полной
restore-проверки не менялись. Пункты 4 и 5 выполнены. Пункт 6 завершён
2026-08-13 через PR №64, merge SHA
`90345676199951798bcc1597f8da410ad6f75c90`: `vercel.json` использует
`npm run build`, `build:deploy` удалён, Prisma Client генерируется без
`DIRECT_URL`. Production run `31657217922` прошёл target guard и no-op
миграцию до успешного Vercel deployment; Preview run `31657384104` сделал то
же до push ветки `preview`, её Vercel deployment также успешен. После этого
`DIRECT_URL` удалён из Vercel Production и Preview, а повторный список
переменных подтвердил отсутствие секрета при сохранённых runtime
`DATABASE_URL`.

Если Deployment Check не настроен или не удерживает alias, cutover запрещён:
сборка Vercel и GitHub migration идут параллельно, и новый код может стать
доступен раньше схемы.

## Go/no-go перед production enforcement

Переход разрешён только при одновременном выполнении всех условий:

- CI использует раздельные миграционный и runtime URL; приложение и preview не
  имеют миграционного секрета;
- runtime-роль не владеет объектами, не имеет `BYPASSRLS`, `CREATEROLE`,
  `CREATE` на схему и DDL-права;
- прямой нефильтрованный запрос к каждой tenant-таблице видит только строки
  текущего пользователя/пространства;
- отсутствие или пустой контекст даёт zero rows/denied write, а не полный
  доступ;
- тест Alice/Bob на пуле размером 1 доказывает отсутствие утечки контекста
  между переиспользованными соединениями;
- тесты покрывают owner/editor/stranger, неверное пространство, подмену
  `userId`/`spaceId`, смену владельца и перенос строки между пространствами;
- проверены relation-запросы Prisma, nested writes и все поля `include`;
- работают sign-in/session/Auth.js Adapter, создание default-space при share,
  realtime после commit, квоты и очистка stale attachments;
- backup создан привилегированным workflow и пробно восстановлен в отдельную
  базу;
- зелёные `lint`, `typecheck`, unit, DB integration, build и релевантные E2E;
- ни одна новая policy не ослабляет текущую прикладную матрицу доступа.

Если хотя бы один отрицательный тест не доказан, включение откладывается.

## Откат

Откат проектируется заранее и разделяется по слоям:

1. при функциональной несовместимости применить `NO FORCE ROW LEVEL SECURITY`/
   `DISABLE ROW LEVEL SECURITY` на конкретной группе таблиц миграционной ролью;
   политики и helper-функции не удалять, чтобы сохранить возможность анализа;
2. приложение продолжает использовать существующие `listInSpaceWhere` и
   ownership-проверки, поэтому отключение RLS возвращает текущую защиту, а не
   открытый доступ через UI;
3. переключение runtime credentials и откат версии приложения выполняются
   независимо от миграции;
4. break-glass owner credential доступен только release-процессу, его
   использование журналируется и после инцидента ротируется;
5. destructive schema changes и включение RLS не объединяются в один release.

Откат RLS не считается нормальным способом лечить единичную policy-ошибку в
production: сначала блокируется затронутый поток, затем применяется проверенная
миграция. Полное отключение — аварийный сценарий при широком отказе.

## Критерий завершения программы

Программа завершена, когда production runtime не имеет DDL/ownership/BYPASS,
все tenant-запросы устанавливают проверенный транзакционный контекст, RLS
принудительно действует на целевых таблицах, отрицательные cross-user тесты
проходят через прямой Prisma-запрос без прикладного фильтра, а
`THREAT_MODEL.md` отражает проверенное состояние. До этого момента текущие
прикладные фильтры остаются обязательным основным контролем.

# План усиления доступа к PostgreSQL

**Статус:** этапы 2a–2c завершены; foundation scoped Prisma API, `spaces`,
server read-path, user quota, space mutations и AI insights локально проверены,
attachment flow и ListGroup lifecycle локально проверены, RLS выключен
**Дата:** 2026-08-14

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
| `smartlists_backup` | только backup workflow | read-only доступ ко всем строкам с `BYPASSRLS`; без DDL, write и membership |

Названия предварительные. Пароли, connection strings и создание login-ролей не
попадают в миграции или репозиторий. Миграции содержат владение объектами,
`GRANT`/`REVOKE`, default privileges и политики, но не credentials.

`DIRECT_URL` удалён из окружения Vercel Production и Preview после успешного
cutover-релиза. Репозиторий не использует его в build/generate; прямые
credentials ограниченных migrator/backup ролей остаются только в защищённых
release/backup workflow. Поэтому уже завершённый этап runtime-роли без DDL не
обесценивается соседней владельческой строкой подключения.

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
Postgres catalogs и выводит fingerprint endpoint, атрибуты и settings роли,
database/schema/relation/type/routine ownership, эффективные права и
RLS-состояние. Connection string и строки данных не выводятся. Источник
выбирается в порядке `AUDIT_DATABASE_URL`, `DIRECT_URL`, `DATABASE_URL`.

`npm run db:configure-runtime-role` по умолчанию показывает план. Реальное
изменение требует аргумента `-- --apply` и трёх env-переменных:
`DIRECT_URL`, `EXPECTED_DATABASE_HOST`, `RUNTIME_ROLE_PASSWORD`. Скрипт
запрещает pooled admin endpoint, сравнивает exact host, отказывается работать
при неожиданном наборе таблиц, выполняет `REVOKE` и точечные `GRANT` в одной
транзакции, затем подключается новым credential и повторно проверяет полный
контракт. Существующий пароль не меняется без отдельного
`--rotate-password`; пароль и runtime URL никогда не печатаются.

`npm run db:configure-operational-roles` также работает plan-only по умолчанию.
Apply требует `-- --apply --scope=migration` либо `--scope=backup`, direct
`DIRECT_URL`, exact `EXPECTED_DATABASE_HOST` и пароль только выбранной роли.
`migration` создаёт/проверяет `NOLOGIN` owner и migrator, передаёт ownership и
проверяет автоматический `SET ROLE`; `backup` отдельно создаёт read-only роль
и её default privileges. Любой неожиданный table/type/sequence/view/routine/
domain, owner, role attribute, setting, membership или default ACL прекращает
транзакцию. Скрипт повторно подключается новыми credentials и не выводит их.

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

**Production cutover 2026-08-13:** после явного go/no-go в Neon `production`
SQL-командой создана и post-connect проверена `smartlists_runtime`. Пароль и
owner rollback URL существовали только в памяти процесса. Vercel Production
`DATABASE_URL` заменён на pooled runtime credential; deployment
`dpl_2T9N6y3ugsuWmn7gN4yXQWp2u6YT` для `main` SHA `3213ce7` получил `Ready` и
production alias. Публичный post-cutover smoke-check вернул `200 /en`, а
повторный catalog audit подтвердил exact endpoint `eec09bcdb874`, безопасные
атрибуты роли и точную DML-матрицу. Automation bypass не создавался. Rollback
не потребовался.

**Ручной Production gate 2026-08-13:** пользователь подтвердил Google OAuth и
сессию, CRUD списков, записей, групп и заметок, sharing с разделением владельца
и редактора, realtime и вложения. Ошибок доступа к БД в runtime logs нет.
Единственное сообщение — Node.js `DEP0169` для транзитивного `url.parse()` —
уже отслеживается issue №26 и не связано с PostgreSQL privileges. Полный gate
этапа 2b закрыт.

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
HTTP-проверки пройдены в обеих средах; ручные пользовательские потоки Preview
и Production также пройдены.

## Gate этапа 2c: owner, migrator и backup

Этот этап меняет только административный и операционный доступ к БД. Runtime
credential, DML-матрица приложения, данные и RLS-состояние не меняются.

### Read-only audit и проверенная модель

Аудит Neon `dev` и `production` 2026-08-13 подтвердил одинаковую исходную
структуру: БД `neondb`, схема `public`, 15 таблиц и enum-типы `FileCategory`,
`AttachmentStatus`, `ListShareRole` принадлежат `neondb_owner`; sequences,
routines, policies и RLS отсутствуют. Из прикладных ролей существуют только
`neondb_owner` и `smartlists_runtime`. Release Environment secrets и
repository-level backup secret пока содержат разные экземпляры владельческого
`DIRECT_URL`; значения не читались и не выводились.

На одноразовом PostgreSQL 17 проверено:

- login `smartlists_migrator` с membership `SET TRUE, INHERIT FALSE` и
  database-specific `role=smartlists_owner` подключается как
  `session_user=smartlists_migrator`, `current_user=smartlists_owner`;
- новый объект миграции принадлежит `smartlists_owner`, а не login-роли;
- перенос ownership таблицы сохраняет существующий runtime ACL;
- non-superuser с `CREATEROLE` и собственным `BYPASSRLS` может создать
  `smartlists_backup` с `BYPASSRLS`, но без DDL/write/membership;
- backup с точечным `SELECT` читает все строки даже при `FORCE ROW LEVEL
  SECURITY`, а обычный `pg_dump -Fc --no-owner --no-privileges` завершается
  успешно;
- `CONNECT` migrator/backup выдаёт `neondb_owner` как владелец БД;
  `smartlists_owner` управляет только прикладной схемой и не получает ownership
  самой Neon-БД.

### Точный контракт ролей

| Роль | Атрибуты и membership | Объекты и доступ |
|---|---|---|
| `smartlists_owner` | `NOLOGIN`, без `SUPERUSER`, `CREATEDB`, `CREATEROLE`, `REPLICATION`, `BYPASSRLS` | owner схемы `public`, всех прикладных таблиц, enum, будущих routines и policies |
| `smartlists_migrator` | `LOGIN NOINHERIT`, безопасные атрибуты; membership в owner только с `SET TRUE, INHERIT FALSE` | прямой `CONNECT`; при каждом login автоматически `SET ROLE smartlists_owner`; только GitHub Environment `DIRECT_URL` |
| `smartlists_backup` | `LOGIN NOINHERIT BYPASSRLS`, без membership и остальных специальных атрибутов | `CONNECT`, `USAGE public`, `SELECT` текущих и будущих tables/sequences; без write, DDL и function `EXECUTE`; только backup workflow |
| `neondb_owner` | Neon admin и database owner; член `neon_superuser` | остаётся break-glass/control-plane ролью, но после cutover отсутствует в Vercel и GitHub Actions secrets |

В Neon роль, созданная `neondb_owner`, автоматически получает отдельную
membership-строку от `cloud_admin`: `ADMIN=true`, `SET=false`,
`INHERIT=false`. Для `SET ROLE` configurator создаёт вторую строку с grantor
`neondb_owner`: `ADMIN=false`, `SET=true`, `INHERIT=false`. Он принимает только
этот точный Neon-профиль либо обычный PostgreSQL-профиль с одной прямой строкой;
другой grantor или option означает fail-closed отказ.

`BYPASSRLS` у backup — узкое осознанное исключение. По документации PostgreSQL
`pg_dump` по умолчанию выключает row security и завершится ошибкой, если роль
не может его обойти. Атрибут не даёт доступ сам по себе: backup дополнительно
получает только `SELECT` на разрешённые объекты. Вариант
`--enable-row-security` отвергнут, потому что мог бы создать формально успешный,
но неполный tenant-дамп.

Default privileges owner настраиваются асимметрично: runtime не получает ничего
автоматически и остаётся fail-closed; backup автоматически получает `SELECT`
на будущие tables/sequences, чтобы новая миграция не делала дамп неполным.
`EXECUTE` на будущие функции отзывается у `PUBLIC` и backup; узкие вызовы будут
выдаваться явно после review.

### Порядок cutover

1. В репозитории подготовить fail-closed configurator и проверки полного
   ownership/role/default-privilege контракта. На Docker применить все текущие
   миграции владельцем, выполнить перенос, no-op `prisma migrate deploy`
   migrator-ролью и полный `pg_dump` backup-ролью.
2. Только в Neon `dev` одной транзакцией создать owner/migrator, передать
   `public`, 15 таблиц и 3 enum. Пароль migrator генерировать в памяти; роль
   создавать SQL, а не Neon control plane, чтобы не получить
   `neon_superuser`.
3. Заменить только GitHub Environment `Preview` secret `DIRECT_URL`, выполнить
   target guard, no-op migration и post-connect audit. Vercel
   `DATABASE_URL` не трогать. После успешного workflow пройти Preview gate.
4. После отдельного go/no-go повторить owner/migrator cutover в Production,
   заменить только Production Environment secret и доказать migration job того
   же SHA до Vercel promotion.
5. Отдельно создать `smartlists_backup` только в Production, заменить
   repository secret `DIRECT_URL`, вручную запустить backup, проверить
   `pg_restore --list` и восстановить дамп в изолированную временную БД.
6. После каждого шага повторить audit и threat impact-check. Пароли и URL не
   печатать, не записывать в файлы и не передавать между средами.

### Go/no-go и откат

Cutover среды разрешён, только если inventory совпал точно, runtime ACL до и
после идентичен, migrator имеет ожидаемые `session_user/current_user`, новый
объект получает owner `smartlists_owner`, no-op Prisma migration зелёный, а
owner credential подготовлен как операторский rollback без сохранения в
Vercel. Неожиданный relation/type/routine или membership означает stop.

При отказе migrator GitHub secret возвращается на прежний owner URL. Чтобы
старый login мог работать с уже переданными объектами без обратного переноса,
оператор временно задаёт ему database-specific default
`role=smartlists_owner`; после восстановления release-контура настройка
снимается и migrator исправляется. Полный обратный перенос ownership допустим
только отдельной проверенной транзакцией и не является первым откатом.
Runtime не переключается и не redeploy-ится.

При отказе backup repository secret возвращается на прежний owner URL и
workflow повторяется. Ограниченные роли не удаляются: их переводят в `NOLOGIN`
при подозрении на credential compromise и ротируют пароль после разбора.

**Статус 2026-08-13:** Preview `scope=migration` завершён. В Neon `dev`
`smartlists_owner` владеет `public`, 15 таблицами и 3 enum, а
`smartlists_migrator` подключается как `session_user` и автоматически работает
как `current_user=smartlists_owner`. Два idempotent apply, target guard, no-op
18 миграций, временный ownership-probe и post-cutover audit прошли на direct
endpoint `d95cc95b87c7`; runtime ACL до/после совпал. GitHub Environment
`Preview` `DIRECT_URL` заменён на migrator credential, Vercel не менялся.

Первый apply безопасно откатился до commit на Neon-специфичном запрете повторно
выдать `ADMIN` option grantor-у. Откатываемый probe установил точный
`cloud_admin`/`neondb_owner` membership-профиль; configurator и локальный runner
были усилены. Полный PostgreSQL 17 прогон теперь выполняется через
несуперпользовательскую `CREATEROLE` admin-роль и повторно прошёл оба scopes,
213 runtime-тестов и dump/restore. До отдельного Production go/no-go
control-plane audit показывал только `neondb_owner` и `smartlists_runtime`;
backup scope не применялся.

PR №66 merged в `main` SHA `4a497759`. Main CI `31673950201` прошёл checks,
213 role-integration tests, 100 E2E и штатную Production no-op migration.
Автоматический `Sync Preview Proxy` `31674172929` для того же SHA прочитал
новый Preview Environment secret, прошёл target guard и получил
`No pending migrations to apply` для 18 миграций. После этого workflow
продвинул `preview` на `4a108cb`, а Vercel deployment для этого SHA получил
`success`. Preview owner/migrator gate закрыт полностью.

Production migration scope применён 2026-08-13 на direct endpoint
`eec09bcdb874`. Транзакционный configurator передал `public`, 15 таблиц и
3 enum роли `smartlists_owner`, создал `smartlists_migrator` и подтвердил
неизменность runtime contract. База осталась во владении `neondb_owner`.
GitHub Environment `Production` `DIRECT_URL` заменён на migrator credential;
локальные target guard, no-op всех 18 миграций и откатываемый ownership-probe
прошли. Probe подтвердил `session_user=smartlists_migrator`,
`current_user=smartlists_owner` и owner нового объекта `smartlists_owner`.
PR №68 merged в `main` SHA `9a4ebb73`. Main CI `31677854835` прошёл checks,
213 role-integration tests и 100 E2E, после чего Production migration job
`94376916769` прочитал новый Environment secret. Target guard вернул
`Release DB target verified`, Prisma нашёл 18 миграций и не нашёл pending.
Migration deployment получил `success` в `07:31:16Z`, а Vercel Production —
в `07:31:17Z`, поэтому promotion состоялся после БД для того же SHA.
`Sync Preview Proxy` `31678100642` также завершился успешно. Production
owner/migrator gate закрыт полностью.

Production backup scope применён 2026-08-13 на том же direct endpoint
`eec09bcdb874`. `smartlists_backup` имеет `LOGIN NOINHERIT BYPASSRLS`, не имеет
membership, write/DDL/role-прав и получает только `CONNECT`, `USAGE public` и
`SELECT` на текущие и будущие tables/sequences. Полный Production dump
PostgreSQL 17 размером 57 570 байт восстановлен в изолированную временную БД:
проверены 15 таблиц, 3 enum, 18 завершённых миграций, отсутствие незавершённых
миграций и невалидированных FK. Контейнер и локальный operator-файл удалены.
Repository secret `DIRECT_URL` заменён на backup credential; owner credential
в GitHub Actions больше не используется. Ручной workflow run `31681055043` на
main SHA `53bcba40edfeadf7022ed2b5b0b61242da456846` успешно выполнил `pg_dump`,
проверку каталога, получение AWS credentials через GitHub OIDC и upload в S3.
Runtime contract до/после совпал. После этого начат scoped-контекст запросов.

## Контексты запросов

Целевой API содержит два явных контекста:

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

**Foundation 2026-08-14:** `src/lib/scoped-db.ts` реализует оба wrapper.
Контекст устанавливается
параметризованным transaction-local `set_config`; user-only wrapper явно
очищает `app.space_id`, space-wrapper сначала подтверждает `Space(id, userId)`,
а оба перечитывают GUC перед передачей callback только
`Prisma.TransactionClient`. Реальные PostgreSQL-тесты доказывают fail-closed
валидацию, отказ для чужого пространства, rollback и отсутствие переноса
контекста между транзакциями. Первой consumer-группой перенесён
`src/lib/spaces.ts`: default-space и lookup работают через user-контекст,
проверка доступа к списку — через подтверждённый space-контекст. Интеграционный
тест сохраняет ownership, placement расшаренного списка и fail-closed ответ для
чужого/некорректного пространства. Второй группой переведены
`AuthenticatedHome` и `ListsDataFetcher`: список пространств, счётчик списков,
основная выборка списков со связями и группы выполняются через `withSpaceDb`, а
переводы и React-рендер не удерживают транзакцию. DB-тест доказывает, что
server read-path видит все пространства пользователя, но не смешивает списки и
группы разных пространств и сохраняет placement shared-list. Третьей группой
переведён `src/lib/usage.ts`: атомарный инкремент, fail-soft
очистка и компенсация выполняются отдельными `withUserDb`-транзакциями, чтобы
сбой второстепенной операции не отменял пользовательское действие. Конкурентный
DB-тест подтверждает, что при двух оставшихся единицах из восьми параллельных
запросов проходят ровно два. Четвёртой группой переведены Server Actions
пространств: `createSpace` сохраняет `Serializable` через scoped transaction
options, rename/impact/delete используют подтверждённый space-контекст, а
удаление атомарно собирает payload и выполняет DB-каскад до запуска cookies,
S3 и realtime после commit. Поведение подтверждено полным integration suite и
14 E2E-тестами пространств/маршрутизации. Пятой группой переведён
`getListInsight`: данные списка и записей читаются в `withSpaceDb`, а
атомарное резервирование и компенсация превышения квоты — в отдельных
`withUserDb`. Получение Google ID-токена и запрос к AI-сервису происходят
только после закрытия DB-транзакций. Отрицательный DB-тест подтверждает, что
подмена пространства не отправляет данные и не расходует квоту; конкурентный
тест на границе 15/сутки пропускает ровно один из двух запросов и оставляет
счётчик на лимите. Allowlist прямых импортов глобального Prisma сократился с 13
до 7; новые обходы запрещены. Шестой группой переведены attachment actions:
`requestUpload` сохраняет list row-lock, квоты, stale-cleanup и создание
`PENDING` в `withSpaceDb`; `confirmUpload` разделён на scoped read,
`HeadObject` и scoped state transition; delete/download также закрывают
DB-фазу до S3. Получатели realtime вычисляются до commit, поэтому `after()`
вызывает только `notifyUsers` без tenant-чтения. Fail-soft восстановление
метаданных после сбоя S3 получает отдельный scoped-контекст. DB-тесты
подтверждают commit-before-S3, fail-closed чужого пространства и сохранение
глобальной пользовательской квоты/уборки между пространствами. Allowlist
сократился с 13 до 6. Седьмой группой переведены `createGroup`,
`deleteGroup`, `renameGroup` и `moveGroup`: limit/position/create и
read/validate/rebalance выполняются внутри `withSpaceDb`, а вложенная batch-
транзакция reorder распрямлена в тот же scoped callback. Отдельный статический
guard запрещает этим четырём функциям возвращаться к global Prisma, пока
`index.ts` целиком остаётся в переходном allowlist. DB-тест закрепляет
атомарный rebalance при исчерпании точности позиции; полный group UI flow прошёл
E2E. Пока остальные tenant-потоки не переведены и RLS выключен, это ещё не
завершённый контроль изоляции строк.

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

**Обнаруженный enforcement-gap 2026-08-14:** `MAX_FILES_PER_USER` и уборка
собственных stale `PENDING` имеют глобальную семантику по всем пространствам
пользователя. Обычная policy `Attachment`, ограниченная `app.space_id`,
занизит count и не сможет восстановить метаданные другого пространства после
сбоя S3. До включения RLS нужен узкий DB-helper: он принимает только текущий
`app.user_id`, возвращает aggregate/minimal cleanup payload и разрешает
удалять/восстанавливать только собственные stale `PENDING`. Расширять обычный
`SELECT`/`DELETE` всех вложений ради квоты нельзя. Cross-space DB-тесты уже
фиксируют текущий контракт и должны стать enforcement-тестами helper.

### Auth.js и квоты

Prisma Adapter выполняет запросы до появления `app.user_id`, поэтому auth-
таблицы не зависят от пользовательского контекста. `UserDailyUsage`, напротив,
всегда выполняется внутри `withUserDb`; AI-вызов идёт уже после атомарного
резервирования квоты и закрытия транзакции. По существующему контракту ошибка
AI-сервиса расходует зарезервированную попытку; компенсируется только инкремент
сверх дневного лимита.

## Порядок реализации

1. **Design — этот этап.** Зафиксировать матрицу, исключения, критерии допуска,
   откат и остаточные риски. Не менять production.
2. **Release pipeline.** Убрать `prisma migrate deploy` из Vercel build,
   завести отдельный миграционный workflow и секрет, проверить backup/restore.
3. **Least privilege без RLS.** Создать owner/migrator/runtime-роли, передать
   runtime минимальные права и доказать, что он не может DDL/ownership/role
   operations. Приложение всё ещё защищено существующими фильтрами.
4. **Scoped Prisma API — в работе.** Foundation `withUserDb`/`withSpaceDb`,
   space helpers, основной server read-path, user quota, space mutations и DB-
   фазы AI insights, attachments и ListGroup lifecycle реализованы и локально
   проверены; далее перенести остальные tenant-мутации и специальные потоки,
   сохранив поведение и тесты.
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

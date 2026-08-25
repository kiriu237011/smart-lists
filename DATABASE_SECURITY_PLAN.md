# План усиления доступа к PostgreSQL

**Статус:** этапы 2a–2c и scoped Prisma API завершены; policy/helper/column-
guard объекты первого tenant-контура применены в Preview и Production,
проверены локально и прошли live catalog audit в Preview; Preview-only профили
`UserDailyUsage`, `List + Item`, `Space + Groups` и финальный `tenant-full`
включены и проверены; все восемь tenant-таблиц Preview защищены, Production
остаётся без enforcement
**Дата:** 2026-08-25

Этот документ задаёт целевую модель ролей PostgreSQL, границы первого RLS-контура,
матрицу доступа и безопасный порядок внедрения. Текущее состояние приложения
по-прежнему описывает `THREAT_MODEL.md`: сейчас изоляцию обеспечивают Auth.js,
`listInSpaceWhere` и проверки Server Actions; дополнительный RLS-слой работает
для всех восьми tenant-таблиц в Preview.

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
sequences и автоматический доступ к будущим объектам. Из routines точечный
`EXECUTE` разрешён только
`app_attachment_prepare_maintenance(text)` и
`app_attachment_finish_maintenance(uuid[], boolean)`. Сейчас
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
database/schema/relation/type/routine ownership, эффективные права,
RLS/policy catalog и состояние guard-триггеров. Connection string и строки
данных не выводятся. Источник
выбирается в порядке `AUDIT_DATABASE_URL`, `DIRECT_URL`, `DATABASE_URL`.

`.github/workflows/audit-database.yml` запускает этот аудит вручную только с
`main` для выбранного Environment `preview` или `Production`. Job имеет только
`contents: read`; dependency install не получает DB secret и не исполняет
install-hooks. Перед `BEGIN READ ONLY` тот же release guard сравнивает exact
direct hostname с `EXPECTED_DATABASE_HOST`, а `AUDIT_ROLE=smartlists_runtime`
выводит именно runtime attributes и ACL. Environment branch policy остаётся
вторым независимым ограничением запуска.

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
E2E. Восьмой группой переведены `addListToGroup`, `removeListFromGroup` и
`moveListInGroup`: личная группа, доступный собственный/расшаренный список,
membership read/write и rebalance теперь находятся в одном `withSpaceDb`, без
вложенной транзакции. Статический guard расширен до всех семи перенесённых
group actions. DB-тесты закрепляют reorder расшаренного списка редактором и
fail-closed отказ всех трёх действий при подмене пространства; production
build и семь E2E групп/порядка зелёные. Общий allowlist остаётся равен 6,
поскольку в `index.ts` ещё есть legacy-потоки. Девятой группой переведены
`createList`, `deleteList`, `renameList` и `setListAiEnabled`: проверка
лимита, optional initial membership, owner/editor access, mutation и сбор
post-commit payload выполняются внутри `withSpaceDb`. S3 и Pusher запускаются
после commit; create уведомляет известного владельца, остальные действия
передают в `notifyUsers` участников, собранных в транзакции, поэтому
`after()` не читает tenant-таблицы. DB-тест отдельным соединением подтверждает
commit каскадного удаления до S3; cross-space тест закрывает все четыре Action.
Per-action guard расширен с семи до одиннадцати функций, общий direct-import
allowlist остаётся равен 6. Десятой группой переведены `shareList`,
`removeSharedUser` и `leaveSharedList`: owner/self checks, запись `ListShare`
и сбор всех realtime recipients выполняются внутри `withSpaceDb`, а
`after()` получает только готовые user IDs. `shareList` больше не вызывает
`ensureSpaceState(recipientId)` и не устанавливает DB-контекст другого
пользователя; default-space определяется детерминированно, а составной FK
откатывает share при нарушении инварианта. Проверка владения списком идёт до
поиска email, поэтому чужой `listId` не является oracle регистрации.
Per-action guard расширен до четырнадцати функций; общий allowlist остаётся 6.
Одиннадцатой группой переведены `updateItemNote` и `updateListNote`: чтение
текущей версии, условный `updateMany`, получение актуальной версии при конфликте
и сбор realtime recipients выполняются в одной `withSpaceDb`-транзакции.
Optimistic concurrency по `noteVersion`, editor-доступ и нормализация пустой
заметки сохранены. Реальные DB-тесты проверяют параллельную гонку одной версии,
cross-space отказ и отсутствие tenant-чтения из `after()`. Per-action guard
расширен до шестнадцати функций; общий allowlist остаётся 6.
Двенадцатой группой переведён item lifecycle: `addItem`, `deleteItem`,
`toggleItem` и `renameItem`. Проверка editor-доступа, limit/position/create,
каскад подпунктов, пересчёт денормализованной отметки родителя и запись
выполняются в одной `withSpaceDb`-транзакции. Получатели realtime собираются
до commit; `after()` не читает tenant-таблицы. DB-тесты закрепляют cross-space
fail-closed для всех четырёх Actions и прежнюю семантику подпунктов.
Per-action guard расширен до двадцати функций и теперь также запрещает
перенесённым Actions возвращать `notifyListMembers`/`notifyListsMembers`; общий
direct-import allowlist остаётся 6.
Тринадцатой группой переведены `moveItem` и `moveItemToList`. Доступ к
исходному и целевому спискам, проверка соседей/лимита, обычная запись,
rebalance, перенос поддерева и копирование родителя с подпунктами выполняются
в одной `withSpaceDb`-транзакции. Realtime recipients собираются до commit:
union двух списков для move и только target для copy. Глобальный Prisma import
из `src/app/actions/index.ts` удалён; allowlist сократился с 6 до 5, guard
расширен до двадцати двух функций. Обычный tenant data plane теперь scoped.
RLS всё ещё выключен, поэтому это ещё не завершённый контроль изоляции строк;
attachment helper уже локально проверен; до enforcement остаются policies и
их отрицательные тесты.

## Матрица первого RLS-контура

| Таблица | `SELECT` | `INSERT` | `UPDATE` | `DELETE` |
|---|---|---|---|---|
| `Space` | только строка `userId = app.user_id` | только для `userId = app.user_id` | только своя строка; нельзя сменить владельца | только своя строка |
| `List` | владелец либо активный `ListShare` в `app.space_id` | владелец — текущий пользователь, `spaceId` — текущий | владелец или editor в текущем пространстве; поля владения защищены отдельно | только владелец в текущем пространстве |
| `ListShare` | участники доступного списка могут видеть состав доступа | только владелец списка; получатель существует | в текущем коде запрещён | владелец списка либо сам получатель удаляет свой доступ |
| `ListGroup` | только группа пользователя в текущем пространстве | только пользователь и текущее пространство | только владелец группы; нельзя сменить владельца/пространство | только владелец группы |
| `ListGroupMembership` | только если группа принадлежит пользователю, а список доступен в том же пространстве | то же условие для обеих сторон связи | только `position`, при том же условии; `listId`/`groupId` неизменяемы | только владелец группы, при сохранении space-инварианта |
| `Item` | через доступ к родительскому списку в текущем пространстве | editor или владелец списка | editor или владелец списка | editor или владелец списка |
| `Attachment` | через доступ к родительскому списку в текущем пространстве | editor или владелец; `uploadedById = app.user_id` | только допустимый переход состояния для доступного списка | editor/владелец списка; отдельная очистка — по узкому системному пути |
| `UserDailyUsage` | только `userId = app.user_id` | только собственная строка | только собственная строка | только собственные старые строки для ленивой очистки |

Политика RLS ограничивает строки, но сама по себе не запрещает editor менять
отдельные колонки доступной строки `List`. Для первого контура выбран общий
`BEFORE UPDATE` trigger: он сохраняет существующие Prisma writes и отдельно
защищает ownership/space/attribution, owner-only `List.title`, неизменяемые
membership endpoints и единственный runtime-переход вложения
`PENDING -> UPLOADED`. Table owner проходит guard для миграций и узких
attachment helpers. Функция trigger работает как `SECURITY INVOKER` с
фиксированным `search_path`; прямой `EXECUTE` отозван у PUBLIC и runtime.

Общая логика «доступен ли список в пространстве» должна находиться в одной
неизменяемой по контракту DB-функции и использоваться политиками `List`,
`Item`, `Attachment`, `ListShare` и membership. Это снижает риск расхождения
пяти копий одного правила.

**DB-объекты 2026-08-21:** additive-миграция создаёт
`app_list_access(text)`, 31 policy на восьми tenant-таблицах и восемь column-
guard triggers. Policies адресованы `PUBLIC`, потому что operational login-
роли не создаются миграциями; table ACL остаётся отдельным fail-closed
барьером. Helper — `SECURITY DEFINER` с фиксированным `search_path`, без
PUBLIC EXECUTE; runtime получает только точечный EXECUTE. Role configurators
теперь проверяют exact routine/policy/trigger inventory, а read-only audit
выводит `qual`, `with_check` и состояние triggers. Миграция намеренно не
выполняет `ENABLE/FORCE ROW LEVEL SECURITY`; triggers созданы disabled.
`FORCE` несовместим с текущим helper: table owner обязан обходить policies,
чтобы чтение `List`/`ListShare` не рекурсировало. Это явное допущение A50, а не
скрытый режим; первый enforcement использует только обычный `ENABLE`.

На локальном PostgreSQL 17 restricted-role gate временно включил RLS и guards,
после чего прямые нефильтрованные Prisma-запросы доказали изоляцию всех восьми
таблиц, fail-closed отсутствие GUC, Alice/Bob reuse пула размера 1,
owner/editor/stranger, защищённые колонки, перенос Item только между двумя
доступными списками, attribution, sharing и attachment state transition.
Полный role suite: 287 тестов, миграция под migrator и backup/restore прошли.
После теста RLS/guards снова выключены; это доказательство policy-механики, а
не разрешение на live enforcement.

**Live apply 2026-08-21:** merge `e15d883` применил три накопленные additive-
миграции в Production через CI run `32443454219` и в Preview через Sync Preview
Proxy run `32443735539`. Оба target guard подтвердили direct endpoint; Prisma
сообщил об успешном применении `20260821000000_add_tenant_rls_policies` вместе
с двумя attachment maintenance migrations. Первая Production-попытка получила
`P1001` до установления соединения с Neon; повтор той же job прошёл успешно.
Это меняет live catalog, но не runtime enforcement: миграция не содержит
`ENABLE/FORCE RLS`, а все восемь guard-триггеров созданы disabled.

**Preview catalog gate 2026-08-21:** ручной workflow run `32446720820` от
`main@613ea662` прошёл exact-host guard и `BEGIN READ ONLY`. Аудит подтвердил
direct endpoint, безопасные атрибуты `smartlists_runtime`, отсутствие у неё
membership в повышенной роли, DDL и доступа к migration metadata, точное
совпадение DML-матрицы, 15 таблиц, 3 enum, 4 routines, 31 policy и 8 disabled
guards. На всех таблицах `rls_enabled=false` и `rls_forced=false`. Это закрывает
gate инвентаризации, но не повышает live security status: следующий отдельный
шаг — подготовить и включить первую малую связанную группу enforcement только
в Preview с заранее подготовленным откатом и отрицательной проверкой.

**Первый enforcement-canary подготовлен локально 2026-08-21:** выбрана только
`UserDailyUsage`, потому что её policy зависит от одного `app.user_id` и не
затрагивает sharing/space-граф. Новый fail-closed configurator принимает ровно
`enable-usage-canary` или `rollback-usage-canary`, до DDL сверяет direct
endpoint, migrator/owner boundary, runtime ACL и полный catalog, а RLS и
column guard меняет одной транзакцией под advisory lock. Частичное или
неизвестное состояние отклоняется. Workflow жёстко привязан к `main` и GitHub
Environment `preview`, не принимает имя Environment или таблицы и разделяет
concurrency lock с Preview migration. Локальный PostgreSQL 17 подтвердил
enable/повторный enable, fail-closed отказ на частичном профиле,
rollback/повторный rollback и возврат к полностью disabled состоянию; полный
restricted-role suite сохранил 287 зелёных DB-тестов и backup/restore. Это
готовый механизм отката; до отдельного live go/no-go контроль не учитывался в
security posture.

**Preview usage-canary включён 2026-08-21:** PR №107 merged в
`main@35e8049`, post-merge CI run `32450657827`, Production no-op migration и
Sync Preview Proxy run `32450869155` прошли успешно. Ручной workflow
`32451253175` подтвердил переход `disabled → usage-canary`: RLS и column guard
включены только на `UserDailyUsage`, `FORCE RLS` остался выключен. Пользователь
прошёл авторизованный CRUD smoke в постоянном Preview deployment; поведение и
логи без ошибок. Независимый `BEGIN READ ONLY` audit `32452107430` на direct
endpoint `d95cc95b87c7` увидел ровно один `rls_enabled=true` и один trigger
`enabled=O`, оба на `UserDailyUsage`; остальные семь tenant-таблиц и guards
остались disabled, `relforcerowsecurity=false` везде. Rollback остаётся
именованной операцией `rollback-usage-canary` того же workflow.

**Профиль `List + Item` подготовлен 2026-08-21:** configurator теперь
разрешает только линейный переход `usage-canary → list-item` и обратный
`list-item → usage-canary`; перепрыгнуть профиль или передать произвольную
таблицу нельзя. Перед DDL он дополнительно сверяет точные predicates `List`,
`Item`, `UserDailyUsage`, атрибуты, ACL и SHA-256 тел `app_list_access` и
`app_enforce_tenant_update_columns`. Role-suite доказал идемпотентные переходы,
отказ при подмене helper/policy и частичном catalog, затем полный rollback.
Отдельный partial-profile тест под restricted runtime проверил нефильтрованные
чтения и реальные Server Actions: editor может добавить `Item` в расшаренный
список, но не переименовать чужой `List`, владелец сохраняет rename. Всего
зелёные 21 integration-файл/289 DB-тестов и backup/restore.

**Первый Preview apply откатан 2026-08-21:** PR №109 merged в
`main@76dfd2b`; post-merge CI, Production no-op migration, Vercel и Sync Preview
Proxy прошли. Workflow `32459870529` выполнил `usage-canary → list-item`, а
read-only audit `32459969470` подтвердил ожидаемые RLS/guards только на
`UserDailyUsage`, `List`, `Item`. Ручной smoke затем обнаружил отказ создания
списка: Prisma `INSERT … RETURNING` получил PostgreSQL `42501`, потому что
`app_list_select` повторно искал ещё не видимую новой команде строку через
`app_list_access(id)`. Rollback `32460715430` вернул `usage-canary`, аудит
`32460792514` подтвердил восстановление; Production не менялся.

Исправление не расширяет shared-доступ: новая additive migration
`20260821010000_fix_list_insert_returning_rls` добавляет в `List SELECT` прямую
ветку только для `ownerId = app.user_id AND spaceId = app.space_id`, сохраняя
helper для существующих own/shared строк. Regression test вызывает настоящий
`createList` под partial profile. Чистый PostgreSQL 17 role-suite применил 22
миграции и прошёл 21 integration-файл/290 DB-тестов, configurator transitions и
backup/restore.

**Повторный Preview gate пройден 2026-08-24:** corrective PR №110 merged в
`main@b826f4f`; post-merge CI, E2E, Production/Preview catalog-миграции и Preview
deployment зелёные. Workflow `32699850399` выполнил точный переход
`usage-canary → list-item`. Независимый `BEGIN READ ONLY` audit `32699937238` на
endpoint `d95cc95b87c7` подтвердил RLS и column guards ровно на
`UserDailyUsage`, `List`, `Item`, `NOBYPASSRLS` runtime-роли и отсутствие FORCE
RLS. Пользовательский CRUD smoke, включая создание третьего списка, операции с
записями, rename, reload и sharing, прошёл без ошибок. Rollback
`list-item → usage-canary` остаётся готов; Production enforcement не менялся.

**Профиль `Space + Groups` подготовлен 2026-08-25:** к действующему
`list-item` добавляются `Space`, `ListGroup` и `_ListGroupMembers`. Configurator
разрешает только линейный переход `list-item → space-groups` и обратный
`space-groups → list-item`; произвольный пропуск профиля и частичное состояние
отклоняются до DDL. Exact predicates берутся из уже применённого policy-
catalog: пространство ограничено `app.user_id`, группа — пользователем и
`app.space_id`, membership требует одновременно личную группу и доступный в
том же пространстве список. Partial-profile regression проверяет
нефильтрованные чтения и настоящие Server Actions создания Space/Group,
переименования группы и добавления расшаренного списка. Чистый PostgreSQL 17
role-suite прошёл 21 integration-файл/292 DB-теста, идемпотентные переходы,
отрицательные tamper/partial-profile проверки и backup/restore. Новых
миграций, credentials, сервисов или границ доверия нет. Это локальная
готовность: на момент подготовки live Preview оставался на `list-item` до
отдельного go/no-go.

**Preview gate `Space + Groups` пройден 2026-08-25:** PR №112 merged в
`main@984322a`; PR и post-merge CI, 118 E2E, integration, CodeQL, Production
no-op migration и Sync Preview Proxy прошли. Workflow `32818823108` выполнил
точный переход `list-item → space-groups` на direct endpoint fingerprint
`d95cc95b87c7`. Независимый `BEGIN READ ONLY` audit `32818934270` подтвердил
RLS и column guards ровно на шести таблицах: `UserDailyUsage`, `List`, `Item`,
`Space`, `ListGroup`, `_ListGroupMembers`; `ListShare` и `Attachment` остались
disabled, FORCE RLS отсутствует везде. Пользовательский smoke переключения,
создания, переименования и удаления пространств, а также lifecycle,
membership и reorder групп прошёл без ошибок. Именованный rollback
`space-groups → list-item` готов; Production enforcement не менялся.

**Финальный профиль `ListShare + Attachment` подготовлен локально
2026-08-25:** configurator допускает только линейный переход
`space-groups → tenant-full` и rollback `tenant-full → space-groups`. Перед DDL
он сверяет exact predicates `ListShare`/`Attachment`, а также исполняемые тела,
fixed `search_path`, `SECURITY DEFINER` и `EXECUTE`-границы двух attachment
maintenance helpers. Restricted-role suite прошёл 21 integration-файл/294
DB-теста: owner invite/revoke, self-leave и полный
`PENDING → UPLOADED → delete` выполняются настоящими Server Actions; tamper
policy/helper, частичное состояние и пропуск профиля отклоняются fail-closed.
Новых миграций, credentials, сервисов или границ доверия нет. Live Preview
остаётся на `space-groups` до публикации через PR/CI и отдельного go/no-go.

**Preview gate `tenant-full` пройден 2026-08-25:** PR №116 merged в
`main@d64e9f75`; PR и post-merge CI, 118 E2E, restricted-role integration,
CodeQL, Production no-op migration и Sync Preview Proxy прошли. Workflow
`32822405891` выполнил точный переход `space-groups → tenant-full` на direct
endpoint fingerprint `d95cc95b87c7`. Независимый `BEGIN READ ONLY` audit
`32822519427` подтвердил `rls_enabled=true` и enabled column guard на всех
восьми tenant-таблицах, `rls_forced=false` везде и неизменный runtime ACL.
Ручной smoke подтвердил owner invite/revoke, self-leave, editor-доступ к
расшаренному списку, загрузку/чтение/удаление вложений и отсутствие ошибок.
Rollback `tenant-full → space-groups` готов; Production enforcement не менялся.

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

**Blocker закрыт 2026-08-14 без privileged helper.** Все существовавшие на
момент перехода пользователи получили default-space expand/contract-
миграциями; новые получают его в Auth.js `createUser`, а собственные entrypoint
дополнительно выполняют idempotent self-heal. `shareList` теперь работает
только в owner-scoped транзакции, вычисляет детерминированный
`space_default_<recipientId>` и не вызывает
`ensureSpaceState(recipientId)`. Составной FK `ListShare(spaceId, userId)`
подтверждает принадлежность пространства получателю; если инвариант нарушен,
вся выдача доступа откатывается. DB-тест доказывает одновременно отсутствие
`ListShare` и отсутствие cross-user `Space INSERT`. Следовательно, обычная
RLS-политика `Space` может остаться строго `userId = app.user_id`, а
`SECURITY DEFINER` для sharing не требуется.

### Realtime после commit

`after()` не должен повторно обращаться к tenant-таблицам через Prisma:
контекст транзакции к этому моменту уже закрыт. Attachment, List lifecycle,
sharing, note, item lifecycle и item movement вычисляют получателей внутри
авторизованной транзакции и передают в фоновую задачу минимальный набор
идентификаторов. Обычный tenant data plane больше не вызывает
`notifyListMembers`/`notifyListsMembers`.

### Очистка вложений

Пользовательская очистка stale `PENDING` остаётся ограниченной текущим
пользователем и доступными списками. Глобальная операционная очистка, если она
понадобится, выполняется отдельным job-role, а не расширением пользовательской
политики.

**Enforcement-blocker закрыт локально 2026-08-14:** `MAX_FILES_PER_USER` и уборка
собственных stale `PENDING` имеют глобальную семантику по всем пространствам
пользователя. Обычная policy `Attachment`, ограниченная `app.space_id`,
занизила бы count и не смогла бы безопасно повторить cleanup другого
пространства. Две owner-функции решают это без расширения обычной policy:

- prepare требует непустые `app.user_id`/`app.space_id`, повторно проверяет
  принадлежность Space и owner/editor-доступ к целевому списку;
- только stale `PENDING` целевого списка или текущего uploader переводятся в
  `CLEANUP_PENDING`; одноразовые UUID-токены создаёт БД;
- наружу возвращаются только глобальный count и `{token,key}`; произвольные
  metadata, status или user ID функция не принимает;
- finish удаляет либо возвращает в `PENDING` только токены, ранее выданные
  текущему пользователю; успешный S3 delete при сбое finalize остаётся
  `CLEANUP_PENDING` для идемпотентного повтора;
- CHECK связывает служебные поля со статусом; fixed `search_path`,
  `REVOKE FROM PUBLIC`, точечный runtime `EXECUTE` и отсутствие EXECUTE у
  backup закреплены role-contract;
- старый application build понимает схему: служебные строки не видны в UI,
  но до возврата нового build могут временно учитываться старым quota count.

Cross-space, чужой token, S3 rollback, quota-rejection и exact ACL проверены на
реальной БД. В live Preview RLS для `Attachment` включён профилем
`tenant-full`; helper сохраняет специальный глобальный data-flow, не расширяя
обычную пользовательскую policy.

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
4. **Scoped Prisma API — завершён для обычного tenant data plane.** Foundation `withUserDb`/`withSpaceDb`,
   space helpers, основной server read-path, user quota, space mutations и DB-
   фазы AI insights, attachments, ListGroup lifecycle/membership, List
   lifecycle, sharing lifecycle, note/item lifecycle и movement реализованы и
   локально проверены.
5. **DB-объекты без enforcement — применены и проверены 2026-08-21.** Attachment helpers,
   общая access-функция, policies и disabled column guards находятся в Preview
   и Production; exact catalog contract и отрицательные Alice/Bob тесты
   зелёные. Preview live catalog audit `32446720820` совпал с контрактом; на
   момент этого gate live RLS ещё не был включён.
6. **Enforcement — все четыре Preview gate включены.**
   `UserDailyUsage`, исправленный профиль `List + Item`, затем `Space + Groups`
   прошли локальный integration gate, post-merge CI, транзакционный live apply,
   пользовательский smoke и независимый read-only audit. Финальный
   `tenant-full` добавил `ListShare + Attachment` после тех же локальных и live
   gates. Production остаётся без enforcement.
7. **Проверка после включения — выполнена для всех восьми tenant-таблиц.** Exact
   role/catalog audit, функциональный smoke и повторный threat impact-check
   пройдены; rollback `tenant-full → space-groups` готов. Следующий отдельный
   архитектурный gate — план и go/no-go Production enforcement.

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
- работают sign-in/session/Auth.js Adapter, гарантия default-space через
  migration/Auth.js и fail-closed share без cross-user создания `Space`,
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

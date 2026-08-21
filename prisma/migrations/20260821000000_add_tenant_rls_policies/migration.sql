-- Общая проверка доступа к списку. SECURITY DEFINER нужен намеренно: после
-- включения RLS функция должна читать List/ListShare без рекурсии их policies.
-- Владелец функции одновременно владеет таблицами и не подпадает под RLS без
-- FORCE; runtime получает только EXECUTE и не может менять тело функции.
CREATE FUNCTION public.app_list_access(text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT CASE
    WHEN NULLIF(current_setting('app.user_id', true), '') IS NULL
      OR NULLIF(current_setting('app.space_id', true), '') IS NULL
      THEN NULL
    WHEN NOT EXISTS (
      SELECT 1
      FROM public."Space" AS space
      WHERE space."id" = NULLIF(current_setting('app.space_id', true), '')
        AND space."userId" = NULLIF(current_setting('app.user_id', true), '')
    )
      THEN NULL
    WHEN EXISTS (
      SELECT 1
      FROM public."List" AS list
      WHERE list."id" = $1
        AND list."ownerId" = NULLIF(current_setting('app.user_id', true), '')
        AND list."spaceId" = NULLIF(current_setting('app.space_id', true), '')
    )
      THEN 'OWNER'
    WHEN EXISTS (
      SELECT 1
      FROM public."ListShare" AS share
      WHERE share."listId" = $1
        AND share."userId" = NULLIF(current_setting('app.user_id', true), '')
        AND share."spaceId" = NULLIF(current_setting('app.space_id', true), '')
    )
      THEN 'EDITOR'
    ELSE NULL
  END
$function$;

REVOKE ALL PRIVILEGES ON FUNCTION public.app_list_access(text) FROM PUBLIC;

-- RLS ограничивает строки, но не набор изменяемых колонок. Один общий trigger
-- удерживает immutable/owner-only поля. Он SECURITY INVOKER: table owner и
-- migrator проходят по current_user, runtime получает только явно разрешённые
-- переходы. Триггеры создаются выключенными и будут включаться тем же отдельным
-- gate, что и RLS соответствующей таблицы.
CREATE FUNCTION public.app_enforce_tenant_update_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $function$
BEGIN
  IF current_user = (
    SELECT pg_get_userbyid(relation.relowner)
    FROM pg_class AS relation
    WHERE relation.oid = TG_RELID
  ) THEN
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'Space' THEN
    IF NEW."id" IS DISTINCT FROM OLD."id"
      OR NEW."userId" IS DISTINCT FROM OLD."userId"
      OR NEW."isDefault" IS DISTINCT FROM OLD."isDefault"
      OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
    THEN
      RAISE EXCEPTION 'protected Space columns cannot be updated'
        USING ERRCODE = '42501';
    END IF;
  ELSIF TG_TABLE_NAME = 'List' THEN
    IF NEW."id" IS DISTINCT FROM OLD."id"
      OR NEW."ownerId" IS DISTINCT FROM OLD."ownerId"
      OR NEW."spaceId" IS DISTINCT FROM OLD."spaceId"
      OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
    THEN
      RAISE EXCEPTION 'protected List columns cannot be updated'
        USING ERRCODE = '42501';
    END IF;
    IF NEW."title" IS DISTINCT FROM OLD."title"
      AND public.app_list_access(OLD."id") IS DISTINCT FROM 'OWNER'
    THEN
      RAISE EXCEPTION 'only the list owner can update title'
        USING ERRCODE = '42501';
    END IF;
  ELSIF TG_TABLE_NAME = 'ListShare' THEN
    RAISE EXCEPTION 'ListShare rows cannot be updated'
      USING ERRCODE = '42501';
  ELSIF TG_TABLE_NAME = 'ListGroup' THEN
    IF NEW."id" IS DISTINCT FROM OLD."id"
      OR NEW."userId" IS DISTINCT FROM OLD."userId"
      OR NEW."spaceId" IS DISTINCT FROM OLD."spaceId"
      OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
    THEN
      RAISE EXCEPTION 'protected ListGroup columns cannot be updated'
        USING ERRCODE = '42501';
    END IF;
  ELSIF TG_TABLE_NAME = '_ListGroupMembers' THEN
    IF NEW."A" IS DISTINCT FROM OLD."A"
      OR NEW."B" IS DISTINCT FROM OLD."B"
    THEN
      RAISE EXCEPTION 'membership endpoints cannot be updated'
        USING ERRCODE = '42501';
    END IF;
  ELSIF TG_TABLE_NAME = 'Item' THEN
    IF NEW."id" IS DISTINCT FROM OLD."id"
      OR NEW."addedById" IS DISTINCT FROM OLD."addedById"
      OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
    THEN
      RAISE EXCEPTION 'protected Item columns cannot be updated'
        USING ERRCODE = '42501';
    END IF;
  ELSIF TG_TABLE_NAME = 'Attachment' THEN
    IF OLD."status" IS DISTINCT FROM 'PENDING'::public."AttachmentStatus"
      OR NEW."status" IS DISTINCT FROM 'UPLOADED'::public."AttachmentStatus"
      OR NEW."id" IS DISTINCT FROM OLD."id"
      OR NEW."key" IS DISTINCT FROM OLD."key"
      OR NEW."name" IS DISTINCT FROM OLD."name"
      OR NEW."type" IS DISTINCT FROM OLD."type"
      OR NEW."contentType" IS DISTINCT FROM OLD."contentType"
      OR NEW."cleanupToken" IS DISTINCT FROM OLD."cleanupToken"
      OR NEW."cleanupRequestedById" IS DISTINCT FROM OLD."cleanupRequestedById"
      OR NEW."cleanupStartedAt" IS DISTINCT FROM OLD."cleanupStartedAt"
      OR NEW."listId" IS DISTINCT FROM OLD."listId"
      OR NEW."uploadedById" IS DISTINCT FROM OLD."uploadedById"
      OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
    THEN
      RAISE EXCEPTION 'invalid Attachment state transition'
        USING ERRCODE = '42501';
    END IF;
  ELSIF TG_TABLE_NAME = 'UserDailyUsage' THEN
    IF NEW."id" IS DISTINCT FROM OLD."id"
      OR NEW."userId" IS DISTINCT FROM OLD."userId"
      OR NEW."date" IS DISTINCT FROM OLD."date"
    THEN
      RAISE EXCEPTION 'protected UserDailyUsage columns cannot be updated'
        USING ERRCODE = '42501';
    END IF;
  ELSE
    RAISE EXCEPTION 'tenant column guard is attached to an unknown table'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL PRIVILEGES
ON FUNCTION public.app_enforce_tenant_update_columns()
FROM PUBLIC;

CREATE TRIGGER app_tenant_update_columns_guard
BEFORE UPDATE ON public."Space"
FOR EACH ROW EXECUTE FUNCTION public.app_enforce_tenant_update_columns();
ALTER TABLE public."Space" DISABLE TRIGGER app_tenant_update_columns_guard;

CREATE TRIGGER app_tenant_update_columns_guard
BEFORE UPDATE ON public."List"
FOR EACH ROW EXECUTE FUNCTION public.app_enforce_tenant_update_columns();
ALTER TABLE public."List" DISABLE TRIGGER app_tenant_update_columns_guard;

CREATE TRIGGER app_tenant_update_columns_guard
BEFORE UPDATE ON public."ListShare"
FOR EACH ROW EXECUTE FUNCTION public.app_enforce_tenant_update_columns();
ALTER TABLE public."ListShare" DISABLE TRIGGER app_tenant_update_columns_guard;

CREATE TRIGGER app_tenant_update_columns_guard
BEFORE UPDATE ON public."ListGroup"
FOR EACH ROW EXECUTE FUNCTION public.app_enforce_tenant_update_columns();
ALTER TABLE public."ListGroup" DISABLE TRIGGER app_tenant_update_columns_guard;

CREATE TRIGGER app_tenant_update_columns_guard
BEFORE UPDATE ON public."_ListGroupMembers"
FOR EACH ROW EXECUTE FUNCTION public.app_enforce_tenant_update_columns();
ALTER TABLE public."_ListGroupMembers" DISABLE TRIGGER app_tenant_update_columns_guard;

CREATE TRIGGER app_tenant_update_columns_guard
BEFORE UPDATE ON public."Item"
FOR EACH ROW EXECUTE FUNCTION public.app_enforce_tenant_update_columns();
ALTER TABLE public."Item" DISABLE TRIGGER app_tenant_update_columns_guard;

CREATE TRIGGER app_tenant_update_columns_guard
BEFORE UPDATE ON public."Attachment"
FOR EACH ROW EXECUTE FUNCTION public.app_enforce_tenant_update_columns();
ALTER TABLE public."Attachment" DISABLE TRIGGER app_tenant_update_columns_guard;

CREATE TRIGGER app_tenant_update_columns_guard
BEFORE UPDATE ON public."UserDailyUsage"
FOR EACH ROW EXECUTE FUNCTION public.app_enforce_tenant_update_columns();
ALTER TABLE public."UserDailyUsage" DISABLE TRIGGER app_tenant_update_columns_guard;

-- Policies намеренно адресованы PUBLIC: login-роли являются operational
-- объектами и могут отсутствовать в чистой БД во время migrate deploy. Это не
-- расширяет права — policy только сужает уже выданный GRANT, а runtime ACL
-- остаётся fail-closed и проверяется отдельным role-contract.

CREATE POLICY app_space_select ON public."Space"
FOR SELECT TO PUBLIC
USING ("userId" = NULLIF(current_setting('app.user_id', true), ''));

CREATE POLICY app_space_insert ON public."Space"
FOR INSERT TO PUBLIC
WITH CHECK ("userId" = NULLIF(current_setting('app.user_id', true), ''));

CREATE POLICY app_space_update ON public."Space"
FOR UPDATE TO PUBLIC
USING ("userId" = NULLIF(current_setting('app.user_id', true), ''))
WITH CHECK ("userId" = NULLIF(current_setting('app.user_id', true), ''));

CREATE POLICY app_space_delete ON public."Space"
FOR DELETE TO PUBLIC
USING ("userId" = NULLIF(current_setting('app.user_id', true), ''));

CREATE POLICY app_list_select ON public."List"
FOR SELECT TO PUBLIC
USING (public.app_list_access("id") IS NOT NULL);

CREATE POLICY app_list_insert ON public."List"
FOR INSERT TO PUBLIC
WITH CHECK (
  "ownerId" = NULLIF(current_setting('app.user_id', true), '')
  AND "spaceId" = NULLIF(current_setting('app.space_id', true), '')
);

CREATE POLICY app_list_update ON public."List"
FOR UPDATE TO PUBLIC
USING (public.app_list_access("id") IS NOT NULL)
WITH CHECK (public.app_list_access("id") IS NOT NULL);

CREATE POLICY app_list_delete ON public."List"
FOR DELETE TO PUBLIC
USING (public.app_list_access("id") = 'OWNER');

CREATE POLICY app_list_share_select ON public."ListShare"
FOR SELECT TO PUBLIC
USING (public.app_list_access("listId") IS NOT NULL);

CREATE POLICY app_list_share_insert ON public."ListShare"
FOR INSERT TO PUBLIC
WITH CHECK (public.app_list_access("listId") = 'OWNER');

CREATE POLICY app_list_share_delete ON public."ListShare"
FOR DELETE TO PUBLIC
USING (
  public.app_list_access("listId") = 'OWNER'
  OR (
    "userId" = NULLIF(current_setting('app.user_id', true), '')
    AND "spaceId" = NULLIF(current_setting('app.space_id', true), '')
  )
);

CREATE POLICY app_list_group_select ON public."ListGroup"
FOR SELECT TO PUBLIC
USING (
  "userId" = NULLIF(current_setting('app.user_id', true), '')
  AND "spaceId" = NULLIF(current_setting('app.space_id', true), '')
);

CREATE POLICY app_list_group_insert ON public."ListGroup"
FOR INSERT TO PUBLIC
WITH CHECK (
  "userId" = NULLIF(current_setting('app.user_id', true), '')
  AND "spaceId" = NULLIF(current_setting('app.space_id', true), '')
);

CREATE POLICY app_list_group_update ON public."ListGroup"
FOR UPDATE TO PUBLIC
USING (
  "userId" = NULLIF(current_setting('app.user_id', true), '')
  AND "spaceId" = NULLIF(current_setting('app.space_id', true), '')
)
WITH CHECK (
  "userId" = NULLIF(current_setting('app.user_id', true), '')
  AND "spaceId" = NULLIF(current_setting('app.space_id', true), '')
);

CREATE POLICY app_list_group_delete ON public."ListGroup"
FOR DELETE TO PUBLIC
USING (
  "userId" = NULLIF(current_setting('app.user_id', true), '')
  AND "spaceId" = NULLIF(current_setting('app.space_id', true), '')
);

CREATE POLICY app_list_group_membership_select ON public."_ListGroupMembers"
FOR SELECT TO PUBLIC
USING (
  EXISTS (
    SELECT 1
    FROM public."ListGroup" AS list_group
    WHERE list_group."id" = "B"
      AND list_group."userId" = NULLIF(current_setting('app.user_id', true), '')
      AND list_group."spaceId" = NULLIF(current_setting('app.space_id', true), '')
  )
  AND public.app_list_access("A") IS NOT NULL
);

CREATE POLICY app_list_group_membership_insert ON public."_ListGroupMembers"
FOR INSERT TO PUBLIC
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public."ListGroup" AS list_group
    WHERE list_group."id" = "B"
      AND list_group."userId" = NULLIF(current_setting('app.user_id', true), '')
      AND list_group."spaceId" = NULLIF(current_setting('app.space_id', true), '')
  )
  AND public.app_list_access("A") IS NOT NULL
);

CREATE POLICY app_list_group_membership_update ON public."_ListGroupMembers"
FOR UPDATE TO PUBLIC
USING (
  EXISTS (
    SELECT 1
    FROM public."ListGroup" AS list_group
    WHERE list_group."id" = "B"
      AND list_group."userId" = NULLIF(current_setting('app.user_id', true), '')
      AND list_group."spaceId" = NULLIF(current_setting('app.space_id', true), '')
  )
  AND public.app_list_access("A") IS NOT NULL
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public."ListGroup" AS list_group
    WHERE list_group."id" = "B"
      AND list_group."userId" = NULLIF(current_setting('app.user_id', true), '')
      AND list_group."spaceId" = NULLIF(current_setting('app.space_id', true), '')
  )
  AND public.app_list_access("A") IS NOT NULL
);

CREATE POLICY app_list_group_membership_delete ON public."_ListGroupMembers"
FOR DELETE TO PUBLIC
USING (
  EXISTS (
    SELECT 1
    FROM public."ListGroup" AS list_group
    WHERE list_group."id" = "B"
      AND list_group."userId" = NULLIF(current_setting('app.user_id', true), '')
      AND list_group."spaceId" = NULLIF(current_setting('app.space_id', true), '')
  )
  AND public.app_list_access("A") IS NOT NULL
);

CREATE POLICY app_item_select ON public."Item"
FOR SELECT TO PUBLIC
USING (public.app_list_access("listId") IS NOT NULL);

CREATE POLICY app_item_insert ON public."Item"
FOR INSERT TO PUBLIC
WITH CHECK (
  public.app_list_access("listId") IS NOT NULL
  AND "addedById" = NULLIF(current_setting('app.user_id', true), '')
);

CREATE POLICY app_item_update ON public."Item"
FOR UPDATE TO PUBLIC
USING (public.app_list_access("listId") IS NOT NULL)
WITH CHECK (public.app_list_access("listId") IS NOT NULL);

CREATE POLICY app_item_delete ON public."Item"
FOR DELETE TO PUBLIC
USING (public.app_list_access("listId") IS NOT NULL);

CREATE POLICY app_attachment_select ON public."Attachment"
FOR SELECT TO PUBLIC
USING (public.app_list_access("listId") IS NOT NULL);

CREATE POLICY app_attachment_insert ON public."Attachment"
FOR INSERT TO PUBLIC
WITH CHECK (
  public.app_list_access("listId") IS NOT NULL
  AND "uploadedById" = NULLIF(current_setting('app.user_id', true), '')
  AND "status" = 'PENDING'::public."AttachmentStatus"
  AND "cleanupToken" IS NULL
  AND "cleanupRequestedById" IS NULL
  AND "cleanupStartedAt" IS NULL
);

CREATE POLICY app_attachment_update ON public."Attachment"
FOR UPDATE TO PUBLIC
USING (public.app_list_access("listId") IS NOT NULL)
WITH CHECK (public.app_list_access("listId") IS NOT NULL);

CREATE POLICY app_attachment_delete ON public."Attachment"
FOR DELETE TO PUBLIC
USING (public.app_list_access("listId") IS NOT NULL);

CREATE POLICY app_user_daily_usage_select ON public."UserDailyUsage"
FOR SELECT TO PUBLIC
USING ("userId" = NULLIF(current_setting('app.user_id', true), ''));

CREATE POLICY app_user_daily_usage_insert ON public."UserDailyUsage"
FOR INSERT TO PUBLIC
WITH CHECK ("userId" = NULLIF(current_setting('app.user_id', true), ''));

CREATE POLICY app_user_daily_usage_update ON public."UserDailyUsage"
FOR UPDATE TO PUBLIC
USING ("userId" = NULLIF(current_setting('app.user_id', true), ''))
WITH CHECK ("userId" = NULLIF(current_setting('app.user_id', true), ''));

CREATE POLICY app_user_daily_usage_delete ON public."UserDailyUsage"
FOR DELETE TO PUBLIC
USING ("userId" = NULLIF(current_setting('app.user_id', true), ''));

-- Runtime может вызывать только общий access helper. Trigger function
-- исполняется исключительно через привязанные триггеры и прямого EXECUTE не
-- получает. На уже настроенных окружениях runtime существует до миграции.
DO $block$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'smartlists_runtime') THEN
    GRANT EXECUTE
    ON FUNCTION public.app_list_access(text)
    TO smartlists_runtime;
  END IF;
END;
$block$;

-- ВАЖНО: эта миграция не выполняет ENABLE/FORCE ROW LEVEL SECURITY и не
-- включает column guard triggers. Production-поведение после migrate deploy
-- остаётся прежним до отдельного enforcement gate.

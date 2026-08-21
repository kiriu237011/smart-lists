ALTER TABLE "Attachment"
ADD CONSTRAINT "Attachment_cleanup_state_check"
CHECK (
  (
    "status" = 'CLEANUP_PENDING'::"AttachmentStatus"
    AND "cleanupToken" IS NOT NULL
    AND "cleanupRequestedById" IS NOT NULL
    AND "cleanupStartedAt" IS NOT NULL
  )
  OR
  (
    "status" <> 'CLEANUP_PENDING'::"AttachmentStatus"
    AND "cleanupToken" IS NULL
    AND "cleanupRequestedById" IS NULL
    AND "cleanupStartedAt" IS NULL
  )
);

CREATE FUNCTION public.app_attachment_prepare_maintenance(text)
RETURNS TABLE("cleanupPayload" jsonb, "userCount" bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  p_list_id ALIAS FOR $1;
  v_user_id text := NULLIF(current_setting('app.user_id', true), '');
  v_space_id text := NULLIF(current_setting('app.space_id', true), '');
BEGIN
  IF v_user_id IS NULL OR v_space_id IS NULL THEN
    RAISE EXCEPTION 'database context is missing or invalid'
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public."Space" AS space
    WHERE space."id" = v_space_id
      AND space."userId" = v_user_id
  ) THEN
    RAISE EXCEPTION 'database context is missing or invalid'
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public."List" AS list
    WHERE list."id" = p_list_id
      AND (
        (list."ownerId" = v_user_id AND list."spaceId" = v_space_id)
        OR EXISTS (
          SELECT 1
          FROM public."ListShare" AS share
          WHERE share."listId" = list."id"
            AND share."userId" = v_user_id
            AND share."spaceId" = v_space_id
        )
      )
  ) THEN
    RAISE EXCEPTION 'list is not accessible in database context'
      USING ERRCODE = '42501';
  END IF;

  -- SKIP LOCKED не ждёт параллельный cleanup того же пользователя в другом
  -- списке. Неполная уборка безопасна: оставшиеся PENDING всё ещё учитываются
  -- квотой и будут подобраны следующим запросом.
  UPDATE public."Attachment" AS attachment
  SET "status" = 'CLEANUP_PENDING'::public."AttachmentStatus",
      "cleanupToken" = gen_random_uuid(),
      "cleanupRequestedById" = v_user_id,
      "cleanupStartedAt" = clock_timestamp()
  WHERE attachment."id" IN (
    SELECT candidate."id"
    FROM public."Attachment" AS candidate
    WHERE candidate."status" = 'PENDING'::public."AttachmentStatus"
      AND candidate."createdAt" < clock_timestamp() - interval '15 minutes'
      AND (
        candidate."listId" = p_list_id
        OR candidate."uploadedById" = v_user_id
      )
    ORDER BY candidate."id"
    FOR UPDATE SKIP LOCKED
  );

  SELECT COALESCE(
           jsonb_agg(
             jsonb_build_object(
               'token', attachment."cleanupToken"::text,
               'key', attachment."key"
             )
             ORDER BY attachment."id"
           ),
           '[]'::jsonb
         )
  INTO "cleanupPayload"
  FROM public."Attachment" AS attachment
  WHERE attachment."status" = 'CLEANUP_PENDING'::public."AttachmentStatus"
    AND attachment."cleanupRequestedById" = v_user_id;

  SELECT count(*)
  INTO "userCount"
  FROM public."Attachment" AS attachment
  WHERE attachment."uploadedById" = v_user_id
    AND attachment."status" IN (
      'PENDING'::public."AttachmentStatus",
      'UPLOADED'::public."AttachmentStatus"
    );

  RETURN NEXT;
END;
$function$;

CREATE FUNCTION public.app_attachment_finish_maintenance(
  uuid[],
  boolean
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  p_tokens ALIAS FOR $1;
  p_restore ALIAS FOR $2;
  v_user_id text := NULLIF(current_setting('app.user_id', true), '');
  v_space_id text := NULLIF(current_setting('app.space_id', true), '');
  v_affected integer;
BEGIN
  IF v_user_id IS NULL OR v_space_id IS NULL THEN
    RAISE EXCEPTION 'database context is missing or invalid'
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public."Space" AS space
    WHERE space."id" = v_space_id
      AND space."userId" = v_user_id
  ) THEN
    RAISE EXCEPTION 'database context is missing or invalid'
      USING ERRCODE = '42501';
  END IF;

  IF p_restore IS NULL OR cardinality(p_tokens) > 1000 THEN
    RAISE EXCEPTION 'invalid attachment maintenance request'
      USING ERRCODE = '22023';
  END IF;

  IF COALESCE(cardinality(p_tokens), 0) = 0 THEN
    RETURN 0;
  END IF;

  IF p_restore THEN
    UPDATE public."Attachment" AS attachment
    SET "status" = 'PENDING'::public."AttachmentStatus",
        "cleanupToken" = NULL,
        "cleanupRequestedById" = NULL,
        "cleanupStartedAt" = NULL
    WHERE attachment."status" = 'CLEANUP_PENDING'::public."AttachmentStatus"
      AND attachment."cleanupRequestedById" = v_user_id
      AND attachment."cleanupToken" = ANY(p_tokens);
  ELSE
    DELETE FROM public."Attachment" AS attachment
    WHERE attachment."status" = 'CLEANUP_PENDING'::public."AttachmentStatus"
      AND attachment."cleanupRequestedById" = v_user_id
      AND attachment."cleanupToken" = ANY(p_tokens);
  END IF;

  GET DIAGNOSTICS v_affected = ROW_COUNT;
  RETURN v_affected;
END;
$function$;

REVOKE ALL PRIVILEGES
ON FUNCTION public.app_attachment_prepare_maintenance(text)
FROM PUBLIC;

REVOKE ALL PRIVILEGES
ON FUNCTION public.app_attachment_finish_maintenance(uuid[], boolean)
FROM PUBLIC;

-- В уже настроенных окружениях runtime существует до этой миграции. В новой
-- локальной БД роль создаст configurator и выдаст те же точечные права.
DO $block$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'smartlists_runtime') THEN
    GRANT EXECUTE
    ON FUNCTION public.app_attachment_prepare_maintenance(text)
    TO smartlists_runtime;

    GRANT EXECUTE
    ON FUNCTION public.app_attachment_finish_maintenance(uuid[], boolean)
    TO smartlists_runtime;
  END IF;
END;
$block$;

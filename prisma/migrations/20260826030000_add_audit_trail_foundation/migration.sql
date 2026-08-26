-- CreateEnum
CREATE TYPE "AuditEventSource" AS ENUM ('APPLICATION', 'DATABASE_TRIGGER');

-- CreateEnum
CREATE TYPE "AuditEventAction" AS ENUM (
    'LIST_DELETED',
    'LIST_SHARE_GRANTED',
    'LIST_SHARE_REVOKED',
    'LIST_SHARE_LEFT',
    'LIST_AI_ACCESS_CHANGED',
    'ATTACHMENT_UPLOADED',
    'ATTACHMENT_DELETED',
    'SPACE_DELETED',
    'ALLOWED_EMAIL_CREATED',
    'ALLOWED_EMAIL_UPDATED',
    'ALLOWED_EMAIL_DELETED',
    'APP_SETTING_CREATED',
    'APP_SETTING_UPDATED',
    'APP_SETTING_DELETED'
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "occurredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" "AuditEventSource" NOT NULL,
    "action" "AuditEventAction" NOT NULL,
    "actorUserId" TEXT,
    "subjectUserId" TEXT,
    "spaceId" TEXT,
    "listId" TEXT,
    "targetId" TEXT,
    "databaseRole" TEXT NOT NULL,
    "requestId" VARCHAR(128),

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuditEvent_occurredAt_idx" ON "AuditEvent"("occurredAt");

-- CreateIndex
CREATE INDEX "AuditEvent_action_occurredAt_idx" ON "AuditEvent"("action", "occurredAt");

-- CreateIndex
CREATE INDEX "AuditEvent_actorUserId_occurredAt_idx" ON "AuditEvent"("actorUserId", "occurredAt");

-- CreateIndex
CREATE INDEX "AuditEvent_spaceId_occurredAt_idx" ON "AuditEvent"("spaceId", "occurredAt");

-- CreateIndex
CREATE INDEX "AuditEvent_listId_occurredAt_idx" ON "AuditEvent"("listId", "occurredAt");

-- Runtime не получает прямых прав на журнал: единственный write-path ниже.
REVOKE ALL PRIVILEGES ON TABLE public."AuditEvent" FROM PUBLIC;

CREATE FUNCTION public.app_write_audit_event(
  public."AuditEventAction",
  text DEFAULT NULL,
  text DEFAULT NULL,
  text DEFAULT NULL,
  text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  actor_user_id text := NULLIF(current_setting('app.user_id', true), '');
  context_space_id text := NULLIF(current_setting('app.space_id', true), '');
  event_id uuid;
BEGIN
  IF actor_user_id IS NULL THEN
    RAISE EXCEPTION 'audit event requires app.user_id';
  END IF;

  IF $2 IS NULL OR $2 = '' OR context_space_id IS DISTINCT FROM $2 THEN
    RAISE EXCEPTION 'audit event requires matching app.space_id';
  END IF;

  IF $1 = 'SPACE_DELETED' THEN
    IF $3 IS NOT NULL OR $4 IS NOT NULL OR $5 IS NOT NULL THEN
      RAISE EXCEPTION 'invalid space audit event shape';
    END IF;
  ELSIF $1 IN ('LIST_DELETED', 'LIST_AI_ACCESS_CHANGED') THEN
    IF $3 IS NULL OR $3 = '' OR $4 IS NOT NULL OR $5 IS NOT NULL THEN
      RAISE EXCEPTION 'invalid list audit event shape';
    END IF;
  ELSIF $1 IN ('LIST_SHARE_GRANTED', 'LIST_SHARE_REVOKED', 'LIST_SHARE_LEFT') THEN
    IF $3 IS NULL OR $3 = '' OR $4 IS NOT NULL OR $5 IS NULL OR $5 = '' THEN
      RAISE EXCEPTION 'invalid sharing audit event shape';
    END IF;
    IF $1 = 'LIST_SHARE_LEFT' AND $5 <> actor_user_id THEN
      RAISE EXCEPTION 'self-leave subject must match actor';
    END IF;
  ELSIF $1 IN ('ATTACHMENT_UPLOADED', 'ATTACHMENT_DELETED') THEN
    IF $3 IS NULL OR $3 = '' OR $4 IS NULL OR $4 = '' OR $5 IS NOT NULL THEN
      RAISE EXCEPTION 'invalid attachment audit event shape';
    END IF;
  ELSE
    -- Административные action доступны только DB-триггеру ниже.
    RAISE EXCEPTION 'audit action is not available to application runtime';
  END IF;

  INSERT INTO public."AuditEvent" (
    "source",
    "action",
    "actorUserId",
    "subjectUserId",
    "spaceId",
    "listId",
    "targetId",
    "databaseRole"
  )
  VALUES (
    'APPLICATION',
    $1,
    actor_user_id,
    $5,
    $2,
    $3,
    $4,
    session_user
  )
  RETURNING "id" INTO event_id;

  RETURN event_id;
END;
$function$;

REVOKE ALL PRIVILEGES
ON FUNCTION public.app_write_audit_event(public."AuditEventAction", text, text, text, text)
FROM PUBLIC;

CREATE FUNCTION public.app_audit_global_admin_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  audit_action public."AuditEventAction";
  audit_target_id text;
BEGIN
  IF TG_TABLE_NAME = 'AllowedEmail' THEN
    audit_target_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
    audit_action := CASE TG_OP
      WHEN 'INSERT' THEN 'ALLOWED_EMAIL_CREATED'::public."AuditEventAction"
      WHEN 'UPDATE' THEN 'ALLOWED_EMAIL_UPDATED'::public."AuditEventAction"
      WHEN 'DELETE' THEN 'ALLOWED_EMAIL_DELETED'::public."AuditEventAction"
    END;
  ELSIF TG_TABLE_NAME = 'AppSetting' THEN
    audit_target_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.key ELSE NEW.key END;
    audit_action := CASE TG_OP
      WHEN 'INSERT' THEN 'APP_SETTING_CREATED'::public."AuditEventAction"
      WHEN 'UPDATE' THEN 'APP_SETTING_UPDATED'::public."AuditEventAction"
      WHEN 'DELETE' THEN 'APP_SETTING_DELETED'::public."AuditEventAction"
    END;
  ELSE
    RAISE EXCEPTION 'unsupported audit trigger table: %', TG_TABLE_NAME;
  END IF;

  INSERT INTO public."AuditEvent" (
    "source",
    "action",
    "targetId",
    "databaseRole"
  )
  VALUES (
    'DATABASE_TRIGGER',
    audit_action,
    audit_target_id,
    session_user
  );

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL PRIVILEGES
ON FUNCTION public.app_audit_global_admin_change()
FROM PUBLIC;

-- Срок хранения фиксирован внутри БД: вызывающий не может подставить более
-- свежую границу и превратить maintenance-команду в произвольное удаление.
CREATE FUNCTION public.app_prune_audit_events()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  deleted_count bigint;
BEGIN
  DELETE FROM public."AuditEvent"
  WHERE "occurredAt" < clock_timestamp() - INTERVAL '180 days';

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$function$;

REVOKE ALL PRIVILEGES
ON FUNCTION public.app_prune_audit_events()
FROM PUBLIC;

CREATE TRIGGER app_audit_global_admin_change
AFTER INSERT OR UPDATE OR DELETE ON public."AllowedEmail"
FOR EACH ROW
EXECUTE FUNCTION public.app_audit_global_admin_change();

CREATE TRIGGER app_audit_global_admin_change
AFTER INSERT OR UPDATE OR DELETE ON public."AppSetting"
FOR EACH ROW
EXECUTE FUNCTION public.app_audit_global_admin_change();

-- На уже настроенных средах роль существует до миграции; в чистой локальной
-- БД тот же точечный GRANT позже выдаст role configurator.
DO $block$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'smartlists_runtime') THEN
    GRANT EXECUTE
    ON FUNCTION public.app_write_audit_event(public."AuditEventAction", text, text, text, text)
    TO smartlists_runtime;
  END IF;
END;
$block$;

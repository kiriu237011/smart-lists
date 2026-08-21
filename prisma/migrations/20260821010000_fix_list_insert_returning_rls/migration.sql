-- Prisma `create` использует INSERT ... RETURNING. Для новой строки прежний
-- SELECT predicate обращался к этой же таблице через app_list_access(id), но
-- повторный SELECT внутри одной команды ещё не видел вставляемую строку. Это
-- отклоняло корректный INSERT владельца уже после прохождения WITH CHECK.
--
-- Прямой owner/space predicate разрешает вернуть только собственную строку в
-- подтверждённом transaction-local контексте. Доступ к существующим shared-
-- спискам по-прежнему вычисляется через app_list_access(id).

ALTER POLICY app_list_select ON public."List"
USING (
  (
    "ownerId" = NULLIF(current_setting('app.user_id', true), '')
    AND "spaceId" = NULLIF(current_setting('app.space_id', true), '')
  )
  OR public.app_list_access("id") IS NOT NULL
);

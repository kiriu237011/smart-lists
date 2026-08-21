export const DATABASE_ROLES = {
  owner: "smartlists_owner",
  migrator: "smartlists_migrator",
  runtime: "smartlists_runtime",
  backup: "smartlists_backup",
};

export const EXPECTED_TABLES = [
  "Account",
  "AllowedEmail",
  "AppSetting",
  "Attachment",
  "Item",
  "List",
  "ListGroup",
  "ListShare",
  "Session",
  "Space",
  "User",
  "UserDailyUsage",
  "VerificationToken",
  "_ListGroupMembers",
  "_prisma_migrations",
];

export const EXPECTED_ENUM_TYPES = [
  "AttachmentStatus",
  "FileCategory",
  "ListShareRole",
];

// Новая sequence, view, routine или domain требует явного решения об ownership
// и правах. Пустые списки являются частью fail-closed inventory, а не пропуском.
export const EXPECTED_SEQUENCES = [];
export const EXPECTED_VIEWS = [];
// Формат routines: `function:name(identity arguments)` или
// `procedure:name(identity arguments)`, чтобы ALTER-команда не угадывала тип.
export const EXPECTED_ROUTINE_DEFINITIONS = [
  {
    kind: "function",
    name: "app_attachment_finish_maintenance",
    identityArguments: "uuid[], boolean",
  },
  {
    kind: "function",
    name: "app_attachment_prepare_maintenance",
    identityArguments: "text",
  },
  {
    kind: "function",
    name: "app_enforce_tenant_update_columns",
    identityArguments: "",
  },
  {
    kind: "function",
    name: "app_list_access",
    identityArguments: "text",
  },
];
export const RUNTIME_EXECUTE_ROUTINES = EXPECTED_ROUTINE_DEFINITIONS.filter(
  (routine) => routine.name !== "app_enforce_tenant_update_columns",
);
export const EXPECTED_ROUTINES = EXPECTED_ROUTINE_DEFINITIONS.map(
  (routine) =>
    `${routine.kind}:${routine.name}(${routine.identityArguments})`,
);
export const EXPECTED_DOMAINS = [];

// Policies адресованы PUBLIC, потому что operational login-роли не создаются
// миграциями. Без table GRANT они не дают доступа, а только сужают его.
export const EXPECTED_POLICIES = [
  "Attachment:app_attachment_delete:DELETE:PERMISSIVE:public",
  "Attachment:app_attachment_insert:INSERT:PERMISSIVE:public",
  "Attachment:app_attachment_select:SELECT:PERMISSIVE:public",
  "Attachment:app_attachment_update:UPDATE:PERMISSIVE:public",
  "Item:app_item_delete:DELETE:PERMISSIVE:public",
  "Item:app_item_insert:INSERT:PERMISSIVE:public",
  "Item:app_item_select:SELECT:PERMISSIVE:public",
  "Item:app_item_update:UPDATE:PERMISSIVE:public",
  "List:app_list_delete:DELETE:PERMISSIVE:public",
  "List:app_list_insert:INSERT:PERMISSIVE:public",
  "List:app_list_select:SELECT:PERMISSIVE:public",
  "List:app_list_update:UPDATE:PERMISSIVE:public",
  "ListGroup:app_list_group_delete:DELETE:PERMISSIVE:public",
  "ListGroup:app_list_group_insert:INSERT:PERMISSIVE:public",
  "ListGroup:app_list_group_select:SELECT:PERMISSIVE:public",
  "ListGroup:app_list_group_update:UPDATE:PERMISSIVE:public",
  "ListShare:app_list_share_delete:DELETE:PERMISSIVE:public",
  "ListShare:app_list_share_insert:INSERT:PERMISSIVE:public",
  "ListShare:app_list_share_select:SELECT:PERMISSIVE:public",
  "Space:app_space_delete:DELETE:PERMISSIVE:public",
  "Space:app_space_insert:INSERT:PERMISSIVE:public",
  "Space:app_space_select:SELECT:PERMISSIVE:public",
  "Space:app_space_update:UPDATE:PERMISSIVE:public",
  "UserDailyUsage:app_user_daily_usage_delete:DELETE:PERMISSIVE:public",
  "UserDailyUsage:app_user_daily_usage_insert:INSERT:PERMISSIVE:public",
  "UserDailyUsage:app_user_daily_usage_select:SELECT:PERMISSIVE:public",
  "UserDailyUsage:app_user_daily_usage_update:UPDATE:PERMISSIVE:public",
  "_ListGroupMembers:app_list_group_membership_delete:DELETE:PERMISSIVE:public",
  "_ListGroupMembers:app_list_group_membership_insert:INSERT:PERMISSIVE:public",
  "_ListGroupMembers:app_list_group_membership_select:SELECT:PERMISSIVE:public",
  "_ListGroupMembers:app_list_group_membership_update:UPDATE:PERMISSIVE:public",
];

// D означает disabled. Включение guard-триггеров и RLS — отдельный gate;
// этот контракт намеренно не позволяет configurator сделать это молча.
export const EXPECTED_TRIGGERS = [
  "Attachment:app_tenant_update_columns_guard:app_enforce_tenant_update_columns:D",
  "Item:app_tenant_update_columns_guard:app_enforce_tenant_update_columns:D",
  "List:app_tenant_update_columns_guard:app_enforce_tenant_update_columns:D",
  "ListGroup:app_tenant_update_columns_guard:app_enforce_tenant_update_columns:D",
  "ListShare:app_tenant_update_columns_guard:app_enforce_tenant_update_columns:D",
  "Space:app_tenant_update_columns_guard:app_enforce_tenant_update_columns:D",
  "UserDailyUsage:app_tenant_update_columns_guard:app_enforce_tenant_update_columns:D",
  "_ListGroupMembers:app_tenant_update_columns_guard:app_enforce_tenant_update_columns:D",
];

export const RUNTIME_TABLE_PRIVILEGES = {
  Account: ["SELECT", "INSERT"],
  AllowedEmail: ["SELECT"],
  AppSetting: ["SELECT"],
  Attachment: ["SELECT", "INSERT", "UPDATE", "DELETE"],
  Item: ["SELECT", "INSERT", "UPDATE", "DELETE"],
  List: ["SELECT", "INSERT", "UPDATE", "DELETE"],
  ListGroup: ["SELECT", "INSERT", "UPDATE", "DELETE"],
  ListShare: ["SELECT", "INSERT", "UPDATE", "DELETE"],
  Session: ["SELECT", "INSERT", "UPDATE", "DELETE"],
  Space: ["SELECT", "INSERT", "UPDATE", "DELETE"],
  User: ["SELECT", "INSERT", "UPDATE"],
  UserDailyUsage: ["SELECT", "INSERT", "UPDATE", "DELETE"],
  VerificationToken: [],
  _ListGroupMembers: ["SELECT", "INSERT", "UPDATE", "DELETE"],
  _prisma_migrations: [],
};

export const ALL_TABLE_PRIVILEGES = [
  "SELECT",
  "INSERT",
  "UPDATE",
  "DELETE",
  "TRUNCATE",
  "REFERENCES",
  "TRIGGER",
];

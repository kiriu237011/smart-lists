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
export const RUNTIME_EXECUTE_ROUTINES = [
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
];
export const EXPECTED_ROUTINES = RUNTIME_EXECUTE_ROUTINES.map(
  (routine) =>
    `${routine.kind}:${routine.name}(${routine.identityArguments})`,
);
export const EXPECTED_DOMAINS = [];

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

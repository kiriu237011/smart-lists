-- Переименовываем саму таблицу
ALTER TABLE "ShoppingList" RENAME TO "List";

-- Переименовываем её первичный ключ, чтобы Prisma не ругалась на несовпадение имен по умолчанию
ALTER TABLE "List" RENAME CONSTRAINT "ShoppingList_pkey" TO "List_pkey";

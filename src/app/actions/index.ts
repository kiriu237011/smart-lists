/**
 * @file actions.ts
 * @description Server Actions — серверные функции, вызываемые напрямую из клиентских компонентов.
 *
 * Директива `"use server"` в начале файла обозначает, что ВСЕ экспортируемые функции
 * здесь являются Server Actions: они выполняются исключительно на сервере, даже если
 * их вызывают из клиентских компонентов (`"use client"`).
 *
 * Преимущества Server Actions:
 *   - Прямой доступ к БД (через Prisma) без промежуточных API-роутов.
 *   - Автоматическая защита: клиент видит только имя функции, not its body.
 *   - Встроенная интеграция с формами Next.js (`<form action={serverAction}>`).
 *
 * Общая схема каждого Action:
 *   1. Проверка авторизации (`auth()`) — для защищённых операций.
 *   2. Сборка сырых данных из `FormData`.
 *   3. Валидация через Zod (`schema.safeParse`).
 *   4. Операция с БД через Prisma.
 *   5. Инвалидация кеша Next.js (`revalidatePath("/", "layout")` — весь layout-дерево, включая все локали: /ru, /vi, /en, /ja).
 *   6. Возврат результата `{ success: true }` или `{ success: false, error: string }`.
 */

"use server";

import {
  createItemSchema,
  deleteItemSchema,
  toggleItemSchema,
  createListSchema,
  deleteListSchema,
  shareListSchema,
  removeSharedUserSchema,
  renameListSchema,
  renameItemSchema,
  createGroupSchema,
  deleteGroupSchema,
  renameGroupSchema,
  listGroupMembershipSchema,
  updateListNoteSchema,
  updateItemNoteSchema,
} from "@/lib/validations";
import prisma from "@/lib/db";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { auth } from "@/auth";
import { logger, hashId } from "@/lib/logger";
import { notifyListMembers, notifyUsers } from "@/lib/notify";
import { deleteObjects } from "@/lib/s3";
import { ZodError } from "zod";
import {
  ensureSpaceState,
  getUserSpace,
  listInSpaceWhere,
} from "@/lib/spaces";
import { normalizeNote } from "@/lib/notes";

/** Возвращает код ошибки валидации: "tooLong" при превышении длины, иначе "validationError". */
function getValidationError(error: ZodError): string {
  return error.issues.some((i) => i.code === "too_big") ? "tooLong" : "validationError";
}

/** Проверяет, что spaceId из формы принадлежит текущему пользователю. */
async function resolveActionSpace(userId: string, formData: FormData) {
  const spaceId = formData.get("spaceId");
  if (typeof spaceId !== "string" || !spaceId) return null;
  return getUserSpace(userId, spaceId);
}

// ===========================================================================
// SERVER ACTIONS ДЛЯ ЗАПИСЕЙ (Item)
// ===========================================================================

/**
 * Добавляет новую запись в список.
 *
 * Вызывается из компонента `SmartList` оптимистично: запись сначала
 * появляется на экране мгновенно (с временным ID), а эта функция
 * сохраняет его в БД в фоне.
 *
 * @param formData - FormData с полями:
 *   - `itemName` {string} — название записи (1–100 символов).
 *   - `listId`   {string} — ID списка, к которому добавляется запись.
 * @returns `{ success: true }` или `{ success: false, error: string }`.
 */
export async function addItem(formData: FormData) {
  try {
    // Проверяем сессию до обработки данных
    const session = await auth();
    if (!session?.user?.id) {
      return { success: false, error: "Необходима авторизация" };
    }
    const space = await resolveActionSpace(session.user.id, formData);
    if (!space) return { success: false, error: "Пространство не найдено" };

    // Собираем объект из FormData: Zod лучше работает с обычными объектами
    const rawData = {
      itemName: formData.get("itemName"),
      listId: formData.get("listId"),
    };

    // safeParse не бросает исключение, а возвращает { success, data | error }
    const result = createItemSchema.safeParse(rawData);

    if (!result.success) {
      logger.error({ error: result.error }, "Ошибка валидации:");
      return { success: false, error: getValidationError(result.error) };
    }

    // Проверяем, что пользователь является владельцем или участником списка
    const list = await prisma.list.findFirst({
      where: {
        id: result.data.listId,
        ...listInSpaceWhere(session.user.id, space.id),
      },
      select: { id: true },
    });

    if (!list) {
      return { success: false, error: "Список не найден" };
    }

    // После safeParse TypeScript точно знает, что result.data.itemName — string
    await prisma.item.create({
      data: {
        name: result.data.itemName,
        listId: result.data.listId,
        addedById: session.user.id,
      },
    });

    // Инвалидируем весь layout-дерево (/ и все локали) → перефетч Server Component
    revalidatePath("/", "layout");
    // Pusher-уведомление уходит ПОСЛЕ отправки ответа клиенту (after) —
    // не задерживает action. Вкладка автора исключается по socketId:
    // ей свежие данные приходят вместе с ответом action (revalidatePath).
    const socketId = formData.get("socketId");
    after(() => notifyListMembers(result.data.listId, socketId));
    logger.info({ uid: hashId(session.user.id), listId: result.data.listId, action: "addItem" }, "Запись добавлена");
    return { success: true };
  } catch (error) {
    logger.error({ error: error }, "Ошибка при добавлении записи:");
    return { success: false, error: "Не удалось добавить запись" };
  }
}

/**
 * Удаляет запись из списка по её ID.
 *
 * Используется оптимистично: запись исчезает с экрана немедленно,
 * а эта функция удаляет его из БД в фоне.
 *
 * @param formData - FormData с полем:
 *   - `itemId` {string} — ID удаляемой записи.
 * @returns `void` (ошибки логируются в консоль, но не передаются клиенту).
 */
export async function deleteItem(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) return;
  const space = await resolveActionSpace(session.user.id, formData);
  if (!space) return;

  const data = { itemId: formData.get("itemId") };

  const result = deleteItemSchema.safeParse(data);

  if (!result.success) {
    logger.error({ error: result.error }, "Validation Error:");
    return;
  }

  // Получаем listId до удаления и одновременно проверяем права доступа
  const item = await prisma.item.findFirst({
    where: {
      id: result.data.itemId,
      list: listInSpaceWhere(session.user.id, space.id),
    },
    select: { listId: true },
  });

  // Если item не найден или нет доступа — молча выходим
  if (!item) return;

  await prisma.item.delete({
    where: { id: result.data.itemId },
  });

  revalidatePath("/", "layout");
  // Уведомление после ответа (after), без эха вкладке автора (socketId)
  const socketId = formData.get("socketId");
  after(() => notifyListMembers(item.listId, socketId));
  logger.info({ uid: hashId(session.user.id), listId: item.listId, action: "deleteItem" }, "Запись удалена");
}

/**
 * Переключает статус записи: "выполнено" ↔ "не выполнено".
 *
 * Важный нюанс: FormData всегда возвращает строки.
 * Поэтому `isCompleted` нужно явно преобразовать до отправки в схему:
 * `formData.get("isCompleted") === "true"` → `true | false`.
 *
 * Логика: мы передаём ТЕКУЩЕЕ значение `isCompleted`, а в БД сохраняем ИНВЕРСИЮ.
 *
 * @param formData - FormData с полями:
 *   - `itemId`      {string} — ID записи.
 *   - `isCompleted` {string} — текущий статус ("true" | "false").
 * @returns `void`.
 */
export async function toggleItem(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) return;
  const space = await resolveActionSpace(session.user.id, formData);
  if (!space) return;

  const data = {
    itemId: formData.get("itemId"),
    // FormData возвращает строки → явно преобразуем в boolean
    isCompleted: formData.get("isCompleted") === "true",
  };

  const result = toggleItemSchema.safeParse(data);

  if (!result.success) {
    logger.error({ error: result.error }, "Validation Error:");
    return;
  }

  // Проверяем права доступа перед обновлением
  const item = await prisma.item.findFirst({
    where: {
      id: result.data.itemId,
      list: listInSpaceWhere(session.user.id, space.id),
    },
    select: { listId: true },
  });

  if (!item) return;

  await prisma.item.update({
    where: { id: result.data.itemId },
    data: {
      isCompleted: !result.data.isCompleted, // Инвертируем текущее значение
    },
  });

  revalidatePath("/", "layout");
  // Уведомление после ответа (after), без эха вкладке автора (socketId)
  const socketId = formData.get("socketId");
  after(() => notifyListMembers(item.listId, socketId));
  logger.info({ uid: hashId(session.user.id), listId: item.listId, completed: !result.data.isCompleted, action: "toggleItem" }, "Статус записи изменён");
}

/**
 * Переименовывает запись в списке.
 *
 * Доступно владельцу списка и пользователям, которым список расшарен.
 *
 * @param formData - FormData с полями:
 *   - `itemId`   {string} — ID переименовываемой записи.
 *   - `itemName` {string} — новое название (1–100 символов).
 * @returns `{ success: true }` или `{ success: false, error: string }`.
 */
export async function renameItem(formData: FormData) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return { success: false, error: "Необходима авторизация" };
    }
    const space = await resolveActionSpace(session.user.id, formData);
    if (!space) return { success: false, error: "Пространство не найдено" };

    const rawData = {
      itemId: formData.get("itemId"),
      itemName: formData.get("itemName"),
    };

    const result = renameItemSchema.safeParse(rawData);
    if (!result.success) {
      return {
        success: false,
        error: getValidationError(result.error),
      };
    }

    // updateMany позволяет атомарно проверить права и обновить за один запрос
    const renamedItem = await prisma.item.updateMany({
      where: {
        id: result.data.itemId,
        list: listInSpaceWhere(session.user.id, space.id),
      },
      data: { name: result.data.itemName },
    });

    if (renamedItem.count === 0) {
      return { success: false, error: "Запись не найдена" };
    }

    // Получаем listId для уведомления участников
    const item = await prisma.item.findUnique({
      where: { id: result.data.itemId },
      select: { listId: true },
    });

    revalidatePath("/", "layout");
    if (item) {
      // Уведомление после ответа (after), без эха вкладке автора (socketId)
      const socketId = formData.get("socketId");
      after(() => notifyListMembers(item.listId, socketId));
      logger.info({ uid: hashId(session.user.id), listId: item.listId, action: "renameItem" }, "Запись переименована");
    }
    return { success: true };
  } catch (error) {
    logger.error({ error: error }, "Ошибка при переименовании записи:");
    return { success: false, error: "Не удалось переименовать запись" };
  }
}

/**
 * Сохраняет заметку записи с optimistic concurrency control.
 * Редактировать её может любой участник списка с ролью EDITOR.
 */
export async function updateItemNote(formData: FormData) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return { success: false, error: "Необходима авторизация" };
    }
    const space = await resolveActionSpace(session.user.id, formData);
    if (!space) return { success: false, error: "Пространство не найдено" };

    const result = updateItemNoteSchema.safeParse({
      itemId: formData.get("itemId"),
      note: formData.get("note"),
      expectedVersion: formData.get("expectedVersion"),
    });
    if (!result.success) {
      return { success: false, error: getValidationError(result.error) };
    }

    const current = await prisma.item.findFirst({
      where: {
        id: result.data.itemId,
        list: listInSpaceWhere(session.user.id, space.id),
      },
      select: { note: true, noteVersion: true, listId: true },
    });
    if (!current) return { success: false, error: "Запись не найдена" };

    if (current.noteVersion !== result.data.expectedVersion) {
      return {
        success: false,
        error: "noteConflict",
        currentNote: current.note,
        currentVersion: current.noteVersion,
      };
    }

    const note = normalizeNote(result.data.note);
    if (current.note === note) {
      return { success: true, note, noteVersion: current.noteVersion };
    }

    const updated = await prisma.item.updateMany({
      where: {
        id: result.data.itemId,
        noteVersion: result.data.expectedVersion,
        list: listInSpaceWhere(session.user.id, space.id),
      },
      data: {
        note,
        noteVersion: { increment: 1 },
        noteUpdatedAt: new Date(),
      },
    });

    if (updated.count === 0) {
      const latest = await prisma.item.findFirst({
        where: {
          id: result.data.itemId,
          list: listInSpaceWhere(session.user.id, space.id),
        },
        select: { note: true, noteVersion: true },
      });
      return {
        success: false,
        error: "noteConflict",
        currentNote: latest?.note ?? null,
        currentVersion: latest?.noteVersion ?? result.data.expectedVersion,
      };
    }

    const noteVersion = result.data.expectedVersion + 1;
    revalidatePath("/", "layout");
    const socketId = formData.get("socketId");
    after(() => notifyListMembers(current.listId, socketId));
    logger.info(
      { uid: hashId(session.user.id), listId: current.listId, action: "updateItemNote" },
      "Заметка записи обновлена",
    );
    return { success: true, note, noteVersion };
  } catch (error) {
    logger.error({ error }, "Ошибка при сохранении заметки записи:");
    return { success: false, error: "Не удалось сохранить заметку" };
  }
}

// ===========================================================================
// SERVER ACTIONS ДЛЯ СПИСКОВ (List)
// ===========================================================================

/**
 * Сохраняет общую заметку списка с optimistic concurrency control.
 * В отличие от названия списка, заметка доступна всем EDITOR-участникам.
 */
export async function updateListNote(formData: FormData) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return { success: false, error: "Необходима авторизация" };
    }
    const space = await resolveActionSpace(session.user.id, formData);
    if (!space) return { success: false, error: "Пространство не найдено" };

    const result = updateListNoteSchema.safeParse({
      listId: formData.get("listId"),
      note: formData.get("note"),
      expectedVersion: formData.get("expectedVersion"),
    });
    if (!result.success) {
      return { success: false, error: getValidationError(result.error) };
    }

    const current = await prisma.list.findFirst({
      where: {
        id: result.data.listId,
        ...listInSpaceWhere(session.user.id, space.id),
      },
      select: { note: true, noteVersion: true },
    });
    if (!current) return { success: false, error: "Список не найден" };

    if (current.noteVersion !== result.data.expectedVersion) {
      return {
        success: false,
        error: "noteConflict",
        currentNote: current.note,
        currentVersion: current.noteVersion,
      };
    }

    const note = normalizeNote(result.data.note);
    if (current.note === note) {
      return { success: true, note, noteVersion: current.noteVersion };
    }

    const updated = await prisma.list.updateMany({
      where: {
        id: result.data.listId,
        noteVersion: result.data.expectedVersion,
        ...listInSpaceWhere(session.user.id, space.id),
      },
      data: {
        note,
        noteVersion: { increment: 1 },
        noteUpdatedAt: new Date(),
      },
    });

    if (updated.count === 0) {
      const latest = await prisma.list.findFirst({
        where: {
          id: result.data.listId,
          ...listInSpaceWhere(session.user.id, space.id),
        },
        select: { note: true, noteVersion: true },
      });
      return {
        success: false,
        error: "noteConflict",
        currentNote: latest?.note ?? null,
        currentVersion: latest?.noteVersion ?? result.data.expectedVersion,
      };
    }

    const noteVersion = result.data.expectedVersion + 1;
    revalidatePath("/", "layout");
    const socketId = formData.get("socketId");
    after(() => notifyListMembers(result.data.listId, socketId));
    logger.info(
      { uid: hashId(session.user.id), listId: result.data.listId, action: "updateListNote" },
      "Заметка списка обновлена",
    );
    return { success: true, note, noteVersion };
  } catch (error) {
    logger.error({ error }, "Ошибка при сохранении заметки списка:");
    return { success: false, error: "Не удалось сохранить заметку" };
  }
}

/**
 * Создаёт новый список для авторизованного пользователя.
 *
 * Ключевой принцип безопасности: `ownerId` берётся из серверной сессии,
 * а не из FormData. Клиент не может подменить владельца списка.
 *
 * @param formData - FormData с полем:
 *   - `title` {string} — название списка (1–50 символов).
 * @returns
 *   - `{ success: true, list: ListData }` — созданный список с полными данными.
 *   - `{ success: false, error: string }` — ошибка авторизации или валидации.
 */
export async function createList(formData: FormData) {
  try {
    // 1. Проверяем авторизацию НА СЕРВЕРЕ
    const session = await auth();
    if (!session || !session.user || !session.user.id) {
      return { success: false, error: "Необходима авторизация" };
    }
    const space = await resolveActionSpace(session.user.id, formData);
    if (!space) return { success: false, error: "Пространство не найдено" };

    // 2. Валидация данных
    const rawData = {
      title: formData.get("title"),
      groupId: formData.get("groupId") ?? undefined,
    };

    const result = createListSchema.safeParse(rawData);

    if (!result.success) {
      return {
        success: false,
        error: getValidationError(result.error),
      };
    }

    // 3. Создаём список в БД.
    // ownerId берём из сессии — клиент не может его подменить!
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const newList = (await (prisma.list.create as any)({
      data: {
        title: result.data.title,
        ownerId: session.user.id,
        spaceId: space.id,
      },
      // include подгружает связанные записи одним запросом
      include: {
        owner: true,
        items: {
          include: {
            addedBy: {
              select: { id: true, name: true, email: true },
            },
          },
        },
      },
    })) as {
      id: string;
      title: string;
      note: string | null;
      noteVersion: number;
      ownerId: string;
      owner: { name: string | null; email: string };
      items: {
        id: string;
        name: string;
        note: string | null;
        noteVersion: number;
        isCompleted: boolean;
        addedBy: { id: string; name: string | null; email: string } | null;
      }[];
    };

    // Если передан groupId — сразу подключаем список к группе (одна операция)
    let listGroups: { id: string; name: string }[] = [];
    if (result.data.groupId) {
      const group = await prisma.listGroup.findFirst({
        where: { id: result.data.groupId, userId: session.user.id, spaceId: space.id },
        select: { id: true, name: true },
      });
      if (group) {
        await prisma.listGroup.update({
          where: { id: group.id },
          data: { lists: { connect: { id: newList.id } } },
        });
        listGroups = [{ id: group.id, name: group.name }];
      }
    }

    revalidatePath("/", "layout");
    // Уведомление после ответа (after), без эха вкладке автора (socketId)
    const socketId = formData.get("socketId");
    after(() => notifyListMembers(newList.id, socketId));
    logger.info({ uid: hashId(session.user.id), listId: newList.id, action: "createList" }, "Список создан");

    // Возвращаем только нужные поля (не весь объект Prisma)
    return {
      success: true,
      list: {
        id: newList.id,
        title: newList.title,
        note: newList.note,
        noteVersion: newList.noteVersion,
        ownerId: newList.ownerId,
        owner: {
          name: newList.owner.name,
          email: newList.owner.email,
        },
        items: newList.items.map((item) => ({
          id: item.id,
          name: item.name,
          note: item.note,
          noteVersion: item.noteVersion,
          isCompleted: item.isCompleted,
          addedBy: item.addedBy
            ? {
                id: item.addedBy.id,
                name: item.addedBy.name,
                email: item.addedBy.email,
              }
            : null,
        })),
        sharedWith: [],
        groups: listGroups,
        // Новый список вложений ещё не имеет — поле обязательно для типа ListData.
        files: [],
      },
    };
  } catch (error) {
    logger.error({ error: error }, "Ошибка при создании списка:");
    return { success: false, error: "Не удалось создать список" };
  }
}

/**
 * Удаляет список.
 *
 * Защита: `deleteMany` с фильтром `ownerId === session.user.id` гарантирует,
 * что только владелец может удалить свой список. Если `deleted.count === 0`,
 * значит запись не найдена или пользователь не является владельцем.
 *
 * @param formData - FormData с полем:
 *   - `listId` {string} — ID удаляемого списка.
 * @returns `{ success: true }` или `{ success: false, error: string }`.
 */
export async function deleteList(formData: FormData) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return { success: false, error: "Необходима авторизация" };
    }
    const space = await resolveActionSpace(session.user.id, formData);
    if (!space) return { success: false, error: "Пространство не найдено" };

    const rawData = {
      listId: formData.get("listId"),
    };

    const result = deleteListSchema.safeParse(rawData);
    if (!result.success) {
      return { success: false, error: "Неверные данные" };
    }

    // Собираем участников И ключи вложений ДО удаления: каскад снесёт строки
    // Attachment вместе со списком, а ключи для S3-уборки лежат именно в них.
    const listToNotify = await prisma.list.findFirst({
      where: { id: result.data.listId, ownerId: session.user.id, spaceId: space.id },
      select: {
        ownerId: true,
        shares: { select: { userId: true } },
        files: { select: { key: true } },
      },
    });

    // deleteMany с двойным условием — атомарная проверка прав.
    // onDelete: Cascade удалит строки Attachment автоматически.
    const deleted = await prisma.list.deleteMany({
      where: {
        id: result.data.listId,
        ownerId: session.user.id, // Только владелец может удалить список
        spaceId: space.id,
      },
    });

    if (deleted.count === 0) {
      return {
        success: false,
        error: "Только владелец может удалить список",
      };
    }

    // S3-уборка батчем — best-effort. Удаление списка НЕ блокируется её успехом:
    // при сбое останется редкий невидимый сирота в бакете (дешевле битой ссылки).
    if (listToNotify && listToNotify.files.length > 0) {
      try {
        await deleteObjects(listToNotify.files.map((f) => f.key));
      } catch (s3Error) {
        logger.error(
          { error: s3Error, listId: result.data.listId, action: "deleteList" },
          "Не удалось удалить вложения списка из S3 (осиротевшие файлы)",
        );
      }
    }

    revalidatePath("/", "layout");
    // Уведомляем всех участников после удаления (используем заранее собранные ID).
    // after — после отправки ответа; socketId исключает вкладку автора из эха.
    if (listToNotify) {
      const userIds = [
        listToNotify.ownerId,
        ...listToNotify.shares.map((share) => share.userId),
      ];
      const socketId = formData.get("socketId");
      after(() => notifyUsers(userIds, socketId));
    }
    logger.info({ uid: hashId(session.user.id), listId: result.data.listId, action: "deleteList" }, "Список удалён");
    return { success: true };
  } catch (error) {
    logger.error({ error: error }, "Ошибка при удалении списка:");
    return { success: false, error: "Не удалось удалить список" };
  }
}

/**
 * Предоставляет совместный доступ к списку другому пользователю.
 *
 * Порядок операций:
 *   1. Проверяем авторизацию.
 *   2. Валидируем listId и email приглашённого.
 *   3. Ищем пользователя с таким email в БД.
 *   4. Запрещаем приглашать самого себя.
 *   5. Создаём явную запись доступа `ListShare`.
 *
 * Защита: `update` с условием `ownerId === session.user.id` гарантирует,
 * что только владелец списка может приглашать других.
 *
 * @param formData - FormData с полями:
 *   - `listId` {string} — ID списка.
 *   - `email`  {string} — email приглашаемого пользователя.
 * @returns
 *   - `{ success: true, user: SharedUser }` — данные добавленного пользователя.
 *   - `{ success: false, error: string }` — описание ошибки.
 */
export async function shareList(formData: FormData) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return { success: false, error: "Необходима авторизация" };
    }
    const ownerId = session.user.id;
    const space = await resolveActionSpace(ownerId, formData);
    if (!space) return { success: false, error: "Пространство не найдено" };

    const rawData = {
      listId: formData.get("listId"),
      email: formData.get("email"),
    };

    const result = shareListSchema.safeParse(rawData);
    if (!result.success) {
      return { success: false, error: "Неверные данные" };
    }

    // 1. Ищем пользователя по email (он должен быть зарегистрирован в системе)
    const userToShare = await prisma.user.findUnique({
      where: { email: result.data.email },
    });

    if (!userToShare) {
      return {
        success: false,
        error: "Пользователь с таким email не найден",
      };
    }

    // Нельзя поделиться списком с самим собой
    if (userToShare.id === session.user.id) {
      return {
        success: false,
        error: "Нельзя поделиться списком с самим собой",
      };
    }

    // Получатель всегда видит новый общий список в своём default-пространстве.
    const recipientSpaceId = await ensureSpaceState(userToShare.id);
    await prisma.$transaction(async (tx) => {
      const ownedList = await tx.list.findFirst({
        where: { id: result.data.listId, ownerId, spaceId: space.id },
        select: { id: true },
      });
      if (!ownedList) throw new Error("LIST_NOT_FOUND");

      await tx.listShare.upsert({
        where: {
          listId_userId: { listId: ownedList.id, userId: userToShare.id },
        },
        create: {
          listId: ownedList.id,
          userId: userToShare.id,
          spaceId: recipientSpaceId,
        },
        update: {},
      });
    });

    revalidatePath("/", "layout");
    // Уведомление после ответа (after), без эха вкладке автора (socketId)
    const socketId = formData.get("socketId");
    after(() => notifyListMembers(result.data.listId, socketId));
    logger.info({ uid: hashId(session.user.id), listId: result.data.listId, action: "shareList" }, "Доступ к списку предоставлен");

    return {
      success: true,
      user: {
        id: userToShare.id,
        name: userToShare.name,
        email: userToShare.email,
      },
    };
  } catch (error) {
    logger.error({ error: error }, "Ошибка при предоставлении доступа:");
    return {
      success: false,
      error: "Не удалось предоставить доступ",
    };
  }
}

/**
 * Убирает пользователя из совместного доступа к списку.
 *
 * Защита: `update` с условием `ownerId === session.user.id` гарантирует,
 * что только владелец может отзывать доступ.
 *
 * @param formData - FormData с полями:
 *   - `listId` {string} — ID списка.
 *   - `userId` {string} — ID пользователя, которого убирают.
 * @returns `{ success: true }` или `{ success: false, error: string }`.
 */
export async function removeSharedUser(formData: FormData) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return { success: false, error: "Необходима авторизация" };
    }
    const ownerId = session.user.id;
    const space = await resolveActionSpace(ownerId, formData);
    if (!space) return { success: false, error: "Пространство не найдено" };

    const rawData = {
      listId: formData.get("listId"),
      userId: formData.get("userId"),
    };

    const result = removeSharedUserSchema.safeParse(rawData);
    if (!result.success) {
      return { success: false, error: "Неверные данные" };
    }

    await prisma.$transaction(async (tx) => {
      const ownedList = await tx.list.findFirst({
        where: { id: result.data.listId, ownerId, spaceId: space.id },
        select: { id: true },
      });
      if (!ownedList) throw new Error("LIST_NOT_FOUND");

      await tx.listShare.deleteMany({
        where: { listId: ownedList.id, userId: result.data.userId },
      });
    });

    revalidatePath("/", "layout");
    // Уведомляем удалённого пользователя отдельно — после удаления ListShare
    // notifyListMembers уже не включает его в рассылку.
    // after гарантирует, что refresh придёт после ответа (и после revalidatePath);
    // socketId исключает вкладку автора из эха.
    const socketId = formData.get("socketId");
    after(async () => {
      await notifyUsers([result.data.userId], socketId);
      await notifyListMembers(result.data.listId, socketId);
    });
    logger.info({ uid: hashId(session.user.id), listId: result.data.listId, action: "removeSharedUser" }, "Доступ к списку отозван");
    return { success: true };
  } catch (error) {
    logger.error({ error: error }, "Ошибка при удалении доступа:");
    return { success: false, error: "Не удалось убрать доступ" };
  }
}

/**
 * Позволяет пользователю самостоятельно покинуть расшаренный список.
 *
 * В отличие от `removeSharedUser` (где действует владелец), здесь
 * действует сам пользователь: он удаляет собственную запись `ListShare`.
 *
 * Защита: удаляется только ListShare текущего пользователя в выбранном
 * пространстве, существование которой проверено перед операцией.
 *
 * @param formData - FormData с полем:
 *   - `listId` {string} — ID списка, от которого пользователь хочет отписаться.
 * @returns `{ success: true }` или `{ success: false, error: string }`.
 */
export async function leaveSharedList(formData: FormData) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return { success: false, error: "Необходима авторизация" };
    }

    const listId = formData.get("listId");
    if (!listId || typeof listId !== "string" || !listId.trim()) {
      return { success: false, error: "Неверные данные" };
    }
    const userId = session.user.id;
    const space = await resolveActionSpace(userId, formData);
    if (!space) return { success: false, error: "Пространство не найдено" };
    const share = await prisma.listShare.findFirst({
      where: { listId, userId, spaceId: space.id },
      select: { listId: true },
    });
    if (!share) return { success: false, error: "Список не найден" };

    await prisma.listShare.deleteMany({
      where: { listId, userId, spaceId: space.id },
    });

    revalidatePath("/", "layout");
    // Уведомляем самого пользователя отдельно — после удаления его нет в ListShare,
    // поэтому notifyListMembers его не затронет (нужно для других вкладок/устройств).
    // after — после ответа; socketId исключает ТЕКУЩУЮ вкладку автора (другие получат).
    const socketId = formData.get("socketId");
    after(async () => {
      await notifyUsers([userId], socketId);
      await notifyListMembers(listId, socketId);
    });
    logger.info({ uid: hashId(session.user.id), listId, action: "leaveSharedList" }, "Пользователь покинул список");
    return { success: true };
  } catch (error) {
    logger.error({ error: error }, "Ошибка при выходе из списка:");
    return { success: false, error: "Не удалось отписаться от списка" };
  }
}

/**
 * Переименовывает список покупок.
 *
 * Защита: `updateMany` с фильтром `ownerId === session.user.id` гарантирует,
 * что только владелец может переименовать свой список.
 *
 * @param formData - FormData с полями:
 *   - `listId` {string} — ID переименовываемого списка.
 *   - `title`  {string} — новое название (1–50 символов).
 * @returns `{ success: true }` или `{ success: false, error: string }`.
 */
export async function renameList(formData: FormData) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return { success: false, error: "Необходима авторизация" };
    }
    const space = await resolveActionSpace(session.user.id, formData);
    if (!space) return { success: false, error: "Пространство не найдено" };

    const rawData = {
      listId: formData.get("listId"),
      title: formData.get("title"),
    };

    const result = renameListSchema.safeParse(rawData);
    if (!result.success) {
      return {
        success: false,
        error: getValidationError(result.error),
      };
    }

    // updateMany с двойным условием — атомарная проверка прав
    const updated = await prisma.list.updateMany({
      where: {
        id: result.data.listId,
        ownerId: session.user.id, // Только владелец может переименовать список
        spaceId: space.id,
      },
      data: {
        title: result.data.title,
      },
    });

    if (updated.count === 0) {
      return {
        success: false,
        error: "Только владелец может переименовать список",
      };
    }

    revalidatePath("/", "layout");
    // Уведомление после ответа (after), без эха вкладке автора (socketId)
    const socketId = formData.get("socketId");
    after(() => notifyListMembers(result.data.listId, socketId));
    logger.info({ uid: hashId(session.user.id), listId: result.data.listId, action: "renameList" }, "Список переименован");
    return { success: true };
  } catch (error) {
    logger.error({ error: error }, "Ошибка при переименовании списка:");
    return { success: false, error: "Не удалось переименовать список" };
  }
}

// ===========================================================================
// SERVER ACTIONS ДЛЯ ГРУПП СПИСКОВ (ListGroup)
// ===========================================================================

/**
 * Создаёт новую группу списков для авторизованного пользователя.
 *
 * @param formData - FormData с полем:
 *   - `name` {string} — название группы (1–50 символов).
 * @returns `{ success: true, group: { id, name } }` или `{ success: false, error: string }`.
 */
export async function createGroup(formData: FormData) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return { success: false, error: "Необходима авторизация" };
    }
    const space = await resolveActionSpace(session.user.id, formData);
    if (!space) return { success: false, error: "Пространство не найдено" };

    const rawData = { name: formData.get("name") };
    const result = createGroupSchema.safeParse(rawData);
    if (!result.success) {
      return {
        success: false,
        error: getValidationError(result.error),
      };
    }

    const group = await prisma.listGroup.create({
      data: {
        name: result.data.name,
        userId: session.user.id,
        spaceId: space.id,
      },
      select: { id: true, name: true },
    });

    revalidatePath("/", "layout");
    logger.info({ uid: hashId(session.user.id), groupId: group.id, action: "createGroup" }, "Группа создана");
    return { success: true, group };
  } catch (error) {
    logger.error({ error: error }, "Ошибка при создании группы:");
    return { success: false, error: "Не удалось создать группу" };
  }
}

/**
 * Удаляет группу списков.
 * Списки из группы не удаляются — только связь списков с группой.
 *
 * @param formData - FormData с полем:
 *   - `groupId` {string} — ID удаляемой группы.
 * @returns `{ success: true }` или `{ success: false, error: string }`.
 */
export async function deleteGroup(formData: FormData) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return { success: false, error: "Необходима авторизация" };
    }
    const space = await resolveActionSpace(session.user.id, formData);
    if (!space) return { success: false, error: "Пространство не найдено" };

    const rawData = { groupId: formData.get("groupId") };
    const result = deleteGroupSchema.safeParse(rawData);
    if (!result.success) {
      return { success: false, error: "Неверные данные" };
    }

    // deleteMany с проверкой userId гарантирует что только владелец удаляет свою группу
    const deleted = await prisma.listGroup.deleteMany({
      where: {
        id: result.data.groupId,
        userId: session.user.id,
        spaceId: space.id,
      },
    });

    if (deleted.count === 0) {
      return { success: false, error: "Только владелец может удалить группу" };
    }

    revalidatePath("/", "layout");
    logger.info({ uid: hashId(session.user.id), groupId: result.data.groupId, action: "deleteGroup" }, "Группа удалена");
    return { success: true };
  } catch (error) {
    logger.error({ error: error }, "Ошибка при удалении группы:");
    return { success: false, error: "Не удалось удалить группу" };
  }
}

/**
 * Переименовывает группу списков.
 *
 * @param formData - FormData с полями:
 *   - `groupId` {string} — ID переименовываемой группы.
 *   - `name`    {string} — новое название (1–50 символов).
 * @returns `{ success: true }` или `{ success: false, error: string }`.
 */
export async function renameGroup(formData: FormData) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return { success: false, error: "Необходима авторизация" };
    }
    const space = await resolveActionSpace(session.user.id, formData);
    if (!space) return { success: false, error: "Пространство не найдено" };

    const rawData = {
      groupId: formData.get("groupId"),
      name: formData.get("name"),
    };
    const result = renameGroupSchema.safeParse(rawData);
    if (!result.success) {
      return {
        success: false,
        error: getValidationError(result.error),
      };
    }

    const updated = await prisma.listGroup.updateMany({
      where: {
        id: result.data.groupId,
        userId: session.user.id,
        spaceId: space.id,
      },
      data: { name: result.data.name },
    });

    if (updated.count === 0) {
      return {
        success: false,
        error: "Только владелец может переименовать группу",
      };
    }

    revalidatePath("/", "layout");
    logger.info({ uid: hashId(session.user.id), groupId: result.data.groupId, action: "renameGroup" }, "Группа переименована");
    return { success: true };
  } catch (error) {
    logger.error({ error: error }, "Ошибка при переименовании группы:");
    return { success: false, error: "Не удалось переименовать группу" };
  }
}

/**
 * Добавляет список в группу.
 *
 * Проверяет, что:
 *   1. Пользователь — владелец группы.
 *   2. Пользователь имеет доступ к списку (владелец или через ListShare).
 *
 * @param formData - FormData с полями:
 *   - `groupId` {string} — ID группы.
 *   - `listId`  {string} — ID списка.
 * @returns `{ success: true }` или `{ success: false, error: string }`.
 */
export async function addListToGroup(formData: FormData) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return { success: false, error: "Необходима авторизация" };
    }
    const space = await resolveActionSpace(session.user.id, formData);
    if (!space) return { success: false, error: "Пространство не найдено" };

    const rawData = {
      groupId: formData.get("groupId"),
      listId: formData.get("listId"),
    };
    const result = listGroupMembershipSchema.safeParse(rawData);
    if (!result.success) {
      return { success: false, error: "Неверные данные" };
    }

    // Проверяем что группа принадлежит пользователю
    const group = await prisma.listGroup.findFirst({
      where: { id: result.data.groupId, userId: session.user.id, spaceId: space.id },
    });
    if (!group) {
      return { success: false, error: "Группа не найдена" };
    }

    // Проверяем что пользователь имеет доступ к списку
    const list = await prisma.list.findFirst({
      where: {
        id: result.data.listId,
        ...listInSpaceWhere(session.user.id, space.id),
      },
    });
    if (!list) {
      return { success: false, error: "Список не найден" };
    }

    await prisma.listGroup.update({
      where: { id: result.data.groupId },
      data: {
        lists: { connect: { id: result.data.listId } },
      },
    });

    revalidatePath("/", "layout");
    logger.info({ uid: hashId(session.user.id), groupId: result.data.groupId, listId: result.data.listId, action: "addListToGroup" }, "Список добавлен в группу");
    return { success: true };
  } catch (error) {
    logger.error({ error: error }, "Ошибка при добавлении списка в группу:");
    return { success: false, error: "Не удалось добавить список в группу" };
  }
}

/**
 * Убирает список из группы.
 *
 * Проверяет что пользователь — владелец группы.
 *
 * @param formData - FormData с полями:
 *   - `groupId` {string} — ID группы.
 *   - `listId`  {string} — ID списка.
 * @returns `{ success: true }` или `{ success: false, error: string }`.
 */
export async function removeListFromGroup(formData: FormData) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return { success: false, error: "Необходима авторизация" };
    }
    const space = await resolveActionSpace(session.user.id, formData);
    if (!space) return { success: false, error: "Пространство не найдено" };

    const rawData = {
      groupId: formData.get("groupId"),
      listId: formData.get("listId"),
    };
    const result = listGroupMembershipSchema.safeParse(rawData);
    if (!result.success) {
      return { success: false, error: "Неверные данные" };
    }

    // Проверяем что группа принадлежит пользователю
    const group = await prisma.listGroup.findFirst({
      where: { id: result.data.groupId, userId: session.user.id, spaceId: space.id },
    });
    if (!group) {
      return { success: false, error: "Группа не найдена" };
    }

    await prisma.listGroup.update({
      where: { id: result.data.groupId },
      data: {
        lists: { disconnect: { id: result.data.listId } },
      },
    });

    revalidatePath("/", "layout");
    logger.info({ uid: hashId(session.user.id), groupId: result.data.groupId, listId: result.data.listId, action: "removeListFromGroup" }, "Список убран из группы");
    return { success: true };
  } catch (error) {
    logger.error({ error: error }, "Ошибка при удалении списка из группы:");
    return { success: false, error: "Не удалось убрать список из группы" };
  }
}

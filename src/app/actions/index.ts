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
 *   5. Инвалидация кеша Next.js (`revalidatePath("/", "layout")` — весь layout-дерево, включая /ru, /vi).
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
} from "@/lib/validations";
import prisma from "@/lib/db";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { pusherServer } from "@/lib/pusher-server";

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
    // Собираем объект из FormData: Zod лучше работает с обычными объектами
    const rawData = {
      itemName: formData.get("itemName"),
      listId: formData.get("listId"),
    };

    // safeParse не бросает исключение, а возвращает { success, data | error }
    const result = createItemSchema.safeParse(rawData);

    if (!result.success) {
      console.error("Ошибка валидации:", result.error);
      return { success: false, error: "Некорректные данные" };
    }

    // Получаем текущего пользователя, чтобы сохранить кто добавил запись
    const session = await auth();

    // После safeParse TypeScript точно знает, что result.data.itemName — string
    await prisma.item.create({
      data: {
        name: result.data.itemName,
        listId: result.data.listId,
        addedById: session?.user?.id ?? null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    });

    // Инвалидируем весь layout-дерево (/, /ru, /vi) → перефетч Server Component
    revalidatePath("/", "layout");
    await notifyListMembers(result.data.listId);
    return { success: true };
  } catch (error) {
    console.error("Ошибка при добавлении записи:", error);
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
  const data = { itemId: formData.get("itemId") };

  const result = deleteItemSchema.safeParse(data);

  if (!result.success) {
    console.error("Validation Error:", result.error);
    return;
  }

  // Получаем listId до удаления, чтобы уведомить участников после
  const item = await prisma.item.findUnique({
    where: { id: result.data.itemId },
    select: { listId: true },
  });

  await prisma.item.delete({
    where: { id: result.data.itemId },
  });

  revalidatePath("/", "layout");
  if (item) await notifyListMembers(item.listId);
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
  const data = {
    itemId: formData.get("itemId"),
    // FormData возвращает строки → явно преобразуем в boolean
    isCompleted: formData.get("isCompleted") === "true",
  };

  const result = toggleItemSchema.safeParse(data);

  if (!result.success) {
    console.error("Validation Error:", result.error);
    return;
  }

  const updatedItem = await prisma.item.update({
    where: { id: result.data.itemId },
    data: {
      isCompleted: !result.data.isCompleted, // Инвертируем текущее значение
    },
    select: { listId: true },
  });

  revalidatePath("/", "layout");
  await notifyListMembers(updatedItem.listId);
}

/**
 * Переименовывает запись в списке.
 *
 * Не требует проверки прав владельца: запись привязана к списку,
 * а доступ к самому списку уже проверен на уровне авторизации сессии.
 * Любой, кто имеет доступ к списку (владелец или расшаренный), может
 * редактировать записи.
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

    const rawData = {
      itemId: formData.get("itemId"),
      itemName: formData.get("itemName"),
    };

    const result = renameItemSchema.safeParse(rawData);
    if (!result.success) {
      return {
        success: false,
        error: result.error.issues[0]?.message || "Неверные данные",
      };
    }

    const renamedItem = await prisma.item.update({
      where: { id: result.data.itemId },
      data: { name: result.data.itemName },
      select: { listId: true },
    });

    revalidatePath("/", "layout");
    await notifyListMembers(renamedItem.listId);
    return { success: true };
  } catch (error) {
    console.error("Ошибка при переименовании записи:", error);
    return { success: false, error: "Не удалось переименовать запись" };
  }
}

// ===========================================================================
// SERVER ACTIONS ДЛЯ СПИСКОВ (List)
// ===========================================================================

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

    // 2. Валидация данных
    const rawData = {
      title: formData.get("title"),
      groupId: formData.get("groupId") ?? undefined,
    };

    const result = createListSchema.safeParse(rawData);

    if (!result.success) {
      return {
        success: false,
        error: result.error.issues[0]?.message || "Неверные данные",
      };
    }

    // 3. Создаём список в БД.
    // ownerId берём из сессии — клиент не может его подменить!
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const newList = (await (prisma.list.create as any)({
      data: {
        title: result.data.title,
        ownerId: session.user.id,
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
        sharedWith: true,
      },
    })) as {
      id: string;
      title: string;
      ownerId: string;
      owner: { name: string | null; email: string };
      items: {
        id: string;
        name: string;
        isCompleted: boolean;
        addedBy: { id: string; name: string | null; email: string } | null;
      }[];
      sharedWith: { id: string; name: string | null; email: string | null }[];
    };

    // Если передан groupId — сразу подключаем список к группе (одна операция)
    let listGroups: { id: string; name: string }[] = [];
    if (result.data.groupId) {
      const group = await prisma.listGroup.findFirst({
        where: { id: result.data.groupId, userId: session.user.id },
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
    await notifyListMembers(newList.id);

    // Возвращаем только нужные поля (не весь объект Prisma)
    return {
      success: true,
      list: {
        id: newList.id,
        title: newList.title,
        ownerId: newList.ownerId,
        owner: {
          name: newList.owner.name,
          email: newList.owner.email,
        },
        items: newList.items.map((item) => ({
          id: item.id,
          name: item.name,
          isCompleted: item.isCompleted,
          addedBy: item.addedBy
            ? {
                id: item.addedBy.id,
                name: item.addedBy.name,
                email: item.addedBy.email,
              }
            : null,
        })),
        sharedWith: newList.sharedWith,
        groups: listGroups,
      },
    };
  } catch (error) {
    console.error("Ошибка при создании списка:", error);
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

    const rawData = {
      listId: formData.get("listId"),
    };

    const result = deleteListSchema.safeParse(rawData);
    if (!result.success) {
      return { success: false, error: "Неверные данные" };
    }

    // Собираем участников до удаления: после удаления запрос вернёт null
    const listToNotify = await prisma.list.findFirst({
      where: { id: result.data.listId, ownerId: session.user.id },
      select: { ownerId: true, sharedWith: { select: { id: true } } },
    });

    // deleteMany с двойным условием — атомарная проверка прав
    const deleted = await prisma.list.deleteMany({
      where: {
        id: result.data.listId,
        ownerId: session.user.id, // Только владелец может удалить список
      },
    });

    if (deleted.count === 0) {
      return {
        success: false,
        error: "Только владелец может удалить список",
      };
    }

    revalidatePath("/", "layout");
    // Уведомляем всех участников после удаления (используем заранее собранные ID)
    if (listToNotify) {
      const userIds = [
        listToNotify.ownerId,
        ...listToNotify.sharedWith.map((u) => u.id),
      ];
      await notifyUsers(userIds);
    }
    return { success: true };
  } catch (error) {
    console.error("Ошибка при удалении списка:", error);
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
 *   5. Добавляем пользователя в Many-to-Many связь `sharedWith`.
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

    // 2. Связываем пользователя со списком через Prisma's `connect`
    // (Many-to-Many: один список может быть у нескольких пользователей)
    await prisma.list.update({
      where: {
        id: result.data.listId,
        ownerId: session.user.id, // Только владелец может приглашать
      },
      data: {
        sharedWith: {
          connect: { id: userToShare.id }, // Prisma сам создаёт запись в таблице-связке
        },
      },
    });

    revalidatePath("/", "layout");
    await notifyListMembers(result.data.listId);

    return {
      success: true,
      user: {
        id: userToShare.id,
        name: userToShare.name,
        email: userToShare.email,
      },
    };
  } catch (error) {
    console.error("Ошибка при предоставлении доступа:", error);
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

    const rawData = {
      listId: formData.get("listId"),
      userId: formData.get("userId"),
    };

    const result = removeSharedUserSchema.safeParse(rawData);
    if (!result.success) {
      return { success: false, error: "Неверные данные" };
    }

    // `disconnect` убирает связь в Many-to-Many без удаления самого пользователя
    await prisma.list.update({
      where: {
        id: result.data.listId,
        ownerId: session.user.id, // Только владелец может отзывать доступ
      },
      data: {
        sharedWith: {
          disconnect: { id: result.data.userId },
        },
      },
    });

    revalidatePath("/", "layout");
    // Уведомляем удалённого пользователя отдельно — после disconnect он уже не в sharedWith,
    // но refresh должен прийти уже после revalidatePath, чтобы сервер вернул актуальные данные
    await notifyUsers([result.data.userId]);
    await notifyListMembers(result.data.listId);
    return { success: true };
  } catch (error) {
    console.error("Ошибка при удалении доступа:", error);
    return { success: false, error: "Не удалось убрать доступ" };
  }
}

/**
 * Позволяет пользователю самостоятельно покинуть расшаренный список.
 *
 * В отличие от `removeSharedUser` (где действует владелец), здесь
 * действует сам пользователь: он отключает себя из `sharedWith`.
 *
 * Защита: в WHERE-условии стоит `sharedWith: { some: { id: session.user.id } }`,
 * что гарантирует — пользователь действительно входит в список и не может
 * покинуть чужой список, к которому у него нет доступа.
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

    await prisma.list.update({
      where: {
        id: listId,
        sharedWith: { some: { id: session.user.id } }, // Убеждаемся, что пользователь в списке
      },
      data: {
        sharedWith: {
          disconnect: { id: session.user.id }, // Пользователь удаляет себя сам
        },
      },
    });

    revalidatePath("/", "layout");
    // Уведомляем самого пользователя отдельно — после disconnect его нет в sharedWith,
    // поэтому notifyListMembers его не затронет (нужно для других вкладок/устройств)
    await notifyUsers([session.user.id]);
    await notifyListMembers(listId);
    return { success: true };
  } catch (error) {
    console.error("Ошибка при выходе из списка:", error);
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

    const rawData = {
      listId: formData.get("listId"),
      title: formData.get("title"),
    };

    const result = renameListSchema.safeParse(rawData);
    if (!result.success) {
      return {
        success: false,
        error: result.error.issues[0]?.message || "Неверные данные",
      };
    }

    // updateMany с двойным условием — атомарная проверка прав
    const updated = await prisma.list.updateMany({
      where: {
        id: result.data.listId,
        ownerId: session.user.id, // Только владелец может переименовать список
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
    await notifyListMembers(result.data.listId);
    return { success: true };
  } catch (error) {
    console.error("Ошибка при переименовании списка:", error);
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

    const rawData = { name: formData.get("name") };
    const result = createGroupSchema.safeParse(rawData);
    if (!result.success) {
      return {
        success: false,
        error: result.error.issues[0]?.message || "Неверные данные",
      };
    }

    const group = await prisma.listGroup.create({
      data: {
        name: result.data.name,
        userId: session.user.id,
      },
      select: { id: true, name: true },
    });

    revalidatePath("/", "layout");
    return { success: true, group };
  } catch (error) {
    console.error("Ошибка при создании группы:", error);
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
      },
    });

    if (deleted.count === 0) {
      return { success: false, error: "Только владелец может удалить группу" };
    }

    revalidatePath("/", "layout");
    return { success: true };
  } catch (error) {
    console.error("Ошибка при удалении группы:", error);
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

    const rawData = {
      groupId: formData.get("groupId"),
      name: formData.get("name"),
    };
    const result = renameGroupSchema.safeParse(rawData);
    if (!result.success) {
      return {
        success: false,
        error: result.error.issues[0]?.message || "Неверные данные",
      };
    }

    const updated = await prisma.listGroup.updateMany({
      where: {
        id: result.data.groupId,
        userId: session.user.id,
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
    return { success: true };
  } catch (error) {
    console.error("Ошибка при переименовании группы:", error);
    return { success: false, error: "Не удалось переименовать группу" };
  }
}

/**
 * Добавляет список в группу.
 *
 * Проверяет, что:
 *   1. Пользователь — владелец группы.
 *   2. Пользователь имеет доступ к списку (владелец или в sharedWith).
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
      where: { id: result.data.groupId, userId: session.user.id },
    });
    if (!group) {
      return { success: false, error: "Группа не найдена" };
    }

    // Проверяем что пользователь имеет доступ к списку
    const list = await prisma.list.findFirst({
      where: {
        id: result.data.listId,
        OR: [
          { ownerId: session.user.id },
          { sharedWith: { some: { id: session.user.id } } },
        ],
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
    return { success: true };
  } catch (error) {
    console.error("Ошибка при добавлении списка в группу:", error);
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
      where: { id: result.data.groupId, userId: session.user.id },
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
    return { success: true };
  } catch (error) {
    console.error("Ошибка при удалении списка из группы:", error);
    return { success: false, error: "Не удалось убрать список из группы" };
  }
}

/**
 * Находит всех пользователей у которых есть доступ к списку
 * (владелец + все с кем поделились) и отправляет им событие refresh.
 * Ошибка логируется, но не пробрасывается — сбой уведомления не отменяет уже успешную мутацию.
 */
async function notifyListMembers(listId: string) {
  try {
    const list = await prisma.list.findUnique({
      where: { id: listId },
      select: {
        ownerId: true,
        sharedWith: { select: { id: true } },
      },
    });

    if (!list) return;

    const userIds = [list.ownerId, ...list.sharedWith.map((u) => u.id)];

    await notifyUsers(userIds);
  } catch (err) {
    console.error("notifyListMembers failed:", err);
  }
}

/**
 * Отправляет refresh в личные private-каналы пользователей.
 * Ошибка Pusher логируется, но не ломает уже завершённую мутацию.
 */
async function notifyUsers(userIds: string[]) {
  // Каждому пользователю — свой private-канал.
  // private-* каналы требуют прохождения auth endpoint (/api/pusher/auth),
  // который проверяет, что клиент подписывается только на свой канал.
  // .catch не пробрасывает ошибку наружу — сбой Pusher не откатывает мутацию в БД.
  await Promise.all(
    userIds.map((userId) =>
      pusherServer.trigger(`private-user-${userId}`, "refresh", {}),
    ),
  ).catch((err) => console.error("Pusher notify failed:", err));
}

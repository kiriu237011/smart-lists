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
 *   5. Инвалидация кеша Next.js (`revalidatePath("/")`).
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
} from "@/lib/validations";
import prisma from "@/lib/db";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";

// ===========================================================================
// SERVER ACTIONS ДЛЯ ТОВАРОВ (Item)
// ===========================================================================

/**
 * Добавляет новый товар в список покупок.
 *
 * Вызывается из компонента `ShoppingList` оптимистично: товар сначала
 * появляется на экране мгновенно (с временным ID), а эта функция
 * сохраняет его в БД в фоне.
 *
 * @param formData - FormData с полями:
 *   - `itemName` {string} — название товара (1–100 символов).
 *   - `listId`   {string} — ID списка, к которому добавляется товар.
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

    // После safeParse TypeScript точно знает, что result.data.itemName — string
    await prisma.item.create({
      data: {
        name: result.data.itemName,
        listId: result.data.listId,
      },
    });

    // Сообщаем Next.js, что данные на "/" изменились → перефетч Server Component
    revalidatePath("/");
    return { success: true };
  } catch (error) {
    console.error("Ошибка при добавлении товара:", error);
    return { success: false, error: "Не удалось добавить товар" };
  }
}

/**
 * Удаляет товар из списка покупок по его ID.
 *
 * Используется оптимистично: товар исчезает с экрана немедленно,
 * а эта функция удаляет его из БД в фоне.
 *
 * @param formData - FormData с полем:
 *   - `itemId` {string} — ID удаляемого товара.
 * @returns `void` (ошибки логируются в консоль, но не передаются клиенту).
 */
export async function deleteItem(formData: FormData) {
  const data = { itemId: formData.get("itemId") };

  const result = deleteItemSchema.safeParse(data);

  if (!result.success) {
    console.error("Validation Error:", result.error);
    return;
  }

  await prisma.item.delete({
    where: { id: result.data.itemId },
  });

  revalidatePath("/");
}

/**
 * Переключает статус товара: "куплен" ↔ "не куплен".
 *
 * Важный нюанс: FormData всегда возвращает строки.
 * Поэтому `isCompleted` нужно явно преобразовать до отправки в схему:
 * `formData.get("isCompleted") === "true"` → `true | false`.
 *
 * Логика: мы передаём ТЕКУЩЕЕ значение `isCompleted`, а в БД сохраняем ИНВЕРСИЮ.
 *
 * @param formData - FormData с полями:
 *   - `itemId`      {string} — ID товара.
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

  await prisma.item.update({
    where: { id: result.data.itemId },
    data: {
      isCompleted: !result.data.isCompleted, // Инвертируем текущее значение
    },
  });

  revalidatePath("/");
}

// ===========================================================================
// SERVER ACTIONS ДЛЯ СПИСКОВ ПОКУПОК (ShoppingList)
// ===========================================================================

/**
 * Создаёт новый список покупок для авторизованного пользователя.
 *
 * Ключевой принцип безопасности: `ownerId` берётся из серверной сессии,
 * а не из FormData. Клиент не может подменить владельца списка.
 *
 * @param formData - FormData с полем:
 *   - `title` {string} — название списка (1–50 символов).
 * @returns
 *   - `{ success: true, list: ShoppingListData }` — созданный список с полными данными.
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
    const newList = await prisma.shoppingList.create({
      data: {
        title: result.data.title,
        ownerId: session.user.id,
      },
      // include подгружает связанные записи одним запросом
      include: {
        owner: true,
        items: true,
        sharedWith: true,
      },
    });

    revalidatePath("/");

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
        items: newList.items,
        sharedWith: newList.sharedWith,
      },
    };
  } catch (error) {
    console.error("Ошибка при создании списка:", error);
    return { success: false, error: "Не удалось создать список" };
  }
}

/**
 * Удаляет список покупок.
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

    // deleteMany с двойным условием — атомарная проверка прав
    const deleted = await prisma.shoppingList.deleteMany({
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

    revalidatePath("/");
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
    await prisma.shoppingList.update({
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

    revalidatePath("/");

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

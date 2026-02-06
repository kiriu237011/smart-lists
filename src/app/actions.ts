"use server"; // <--- Самая важная строчка! Она говорит: "Этот код выполняется ТОЛЬКО на сервере"

import {
  createItemSchema,
  deleteItemSchema,
  toggleItemSchema,
  createListSchema,
  shareListSchema,
} from "@/lib/validations"; // <--- Импорт схемы
import prisma from "@/lib/db";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";

// Действие для добавления товара
export async function addItem(formData: FormData) {
  try {
    // 1. Собираем объект из FormData
    // Zod удобнее работать с обычным объектом, а не с FormData
    const rawData = {
      itemName: formData.get("itemName"),
      listId: formData.get("listId"),
    };

    // 2. Проверяем данные через Zod (safeParse)
    // safeParse не ломает программу ошибкой, а возвращает отчет (успех/неуспех)
    const result = createItemSchema.safeParse(rawData);

    // 3. Если проверка не прошла — выходим
    if (!result.success) {
      // Если данные невалидны, можно обработать ошибку или просто выйти
      console.error("Ошибка валидации:", result.error);
      return { success: false, error: "Некорректные данные" };
    }

    // 4. Если всё ок — берем ЧИСТЫЕ данные из result.data
    // TypeScript теперь точно знает, что itemName — это string, а не null
    await prisma.item.create({
      data: {
        name: result.data.itemName,
        listId: result.data.listId, // Привязываем к конкретному списку
      },
    });

    // 3. Обновляем страницу
    // Эта команда говорит Next.js: "Данные изменились, перерисуй главную страницу"
    revalidatePath("/");
    return { success: true };
  } catch (error) {
    console.error("Ошибка при добавлении товара:", error);
    return { success: false, error: "Не удалось добавить товар" };
  }
}

// Действие для удаления товара
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

// Действие для переключения статуса товара
export async function toggleItem(formData: FormData) {
  // Нюанс: formData всегда возвращает строки.
  // Нам нужно превратить строку "true" в настоящий boolean true.
  const data = {
    itemId: formData.get("itemId"),
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
      isCompleted: !result.data.isCompleted, // Инвертируем чистое значение
    },
  });

  revalidatePath("/");
}

// Действие для создания списка
export async function createList(formData: FormData) {
  // 1. Проверяем авторизацию НА СЕРВЕРЕ
  const session = await auth();
  if (!session || !session.user || !session.user.id) {
    // Если юзер не залогинен — ничего не делаем (или можно бросить ошибку)
    return;
  }

  // 2. Валидация данных
  const rawData = {
    title: formData.get("title"),
  };

  const result = createListSchema.safeParse(rawData);

  if (!result.success) {
    return;
  }

  // 3. Создаем список
  // Обрати внимание: ownerId мы берем из session.user.id, а не из формы!
  await prisma.shoppingList.create({
    data: {
      title: result.data.title,
      ownerId: session.user.id,
    },
  });

  revalidatePath("/");
}

// Действие для предоставления совместного доступа к списку
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

    // 1. Сначала ищем пользователя, которого хотим пригласить
    const userToShare = await prisma.user.findUnique({
      where: { email: result.data.email },
    });

    if (!userToShare) {
      return {
        success: false,
        error: "Пользователь с таким email не найден",
      };
    }

    if (userToShare.id === session.user.id) {
      return {
        success: false,
        error: "Нельзя поделиться списком с самим собой",
      };
    }

    // 2. Обновляем список
    await prisma.shoppingList.update({
      where: {
        id: result.data.listId,
        ownerId: session.user.id, // ВАЖНО: Только владелец может приглашать!
      },
      data: {
        sharedWith: {
          connect: { id: userToShare.id }, // <--- Магия Prisma: "Свяжи с этим ID"
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


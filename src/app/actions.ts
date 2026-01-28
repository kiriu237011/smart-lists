"use server"; // <--- Самая важная строчка! Она говорит: "Этот код выполняется ТОЛЬКО на сервере"

import prisma from "@/lib/db";
import { revalidatePath } from "next/cache";

// Действие для добавления товара
export async function addItem(formData: FormData) {
  // 1. Получаем данные из формы
  const name = formData.get("itemName") as string;
  const listId = formData.get("listId") as string;

  if (!name || !listId) return; // Простая проверка

  // 2. Пишем в базу (Prisma)
  await prisma.item.create({
    data: {
      name: name,
      listId: listId, // Привязываем к конкретному списку
    },
  });

  // 3. Обновляем страницу
  // Эта команда говорит Next.js: "Данные изменились, перерисуй главную страницу"
  revalidatePath("/");
}

// Действие для удаления товара
export async function deleteItem(formData: FormData) {
  const itemId = formData.get("itemId") as string;

  if (!itemId) return;

  await prisma.item.delete({
    where: {
      id: itemId,
    },
  });

  revalidatePath("/");
}

// Действие для переключения статуса товара
export async function toggleItem(formData: FormData) {
  const itemId = formData.get("itemId") as string;
  const isCompleted = formData.get("isCompleted") === "true"; // Читаем текущий статус

  if (!itemId) return;

  await prisma.item.update({
    where: { id: itemId },
    data: {
      // Меняем на противоположный (!true = false)
      isCompleted: !isCompleted,
    },
  });

  revalidatePath("/");
}

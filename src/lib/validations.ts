import { z } from "zod";

// Схема для создания товара
// Мы говорим: "Это должен быть объект..."
export const createItemSchema = z.object({
  // Поле itemName:
  // 1. Должно быть строкой
  // 2. Минимум 1 символ (не пустое)
  // 3. Максимум 100 символов (чтобы не спамили)
  itemName: z.string().min(1).max(100),

  // Поле listId:
  // Должно быть строкой (здесь можно добавить .uuid() или .cuid(), если нужно строже)
  listId: z.string(),
});

// Схема для удаления товара
export const deleteItemSchema = z.object({
  itemId: z.string(),
});

// Схема для переключения статуса товара
export const toggleItemSchema = z.object({
  itemId: z.string(),
  isCompleted: z.boolean(), // Мы будем преобразовывать строку в булево значение перед проверкой
});

// Схема для создания списка
export const createListSchema = z.object({
  title: z
    .string()
    .min(1, "Название обязательно")
    .max(50, "Слишком длинное название"),
});

// Схема для совместного доступа к списку
export const shareListSchema = z.object({
  listId: z.string(),
  email: z.string().trim().pipe(z.email("Введите корректный email")),
});

"use client";

import { startTransition, useOptimistic, useState } from "react";
import { shareList } from "@/app/actions";

type SharedUser = {
  id: string;
  name: string | null;
  email: string | null;
};

type ShareListFormProps = {
  listId: string;
  sharedWith: SharedUser[];
};

export default function ShareListForm({
  listId,
  sharedWith,
}: ShareListFormProps) {
  // Оптимистичное состояние для списка пользователей
  const [optimisticSharedWith, setOptimisticSharedWith] = useOptimistic(
    sharedWith,
    (
      state,
      { action, user }: { action: "add" | "remove"; user: SharedUser },
    ) => {
      switch (action) {
        case "add":
          // Проверяем, нет ли уже такого пользователя
          if (state.some((u) => u.email === user.email)) {
            return state;
          }
          return [...state, user];
        case "remove":
          // Удаляем пользователя с временным ID
          return state.filter((u) => u.id !== user.id);
        default:
          return state;
      }
    },
  );

  const [email, setEmail] = useState("");

  const handleSubmit = async (event: React.SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();

    const formData = new FormData(event.currentTarget);
    const rawEmail = (formData.get("email") as string) ?? "";
    const normalizedEmail = rawEmail.trim();

    if (!normalizedEmail) {
      return;
    }

    // Временный ID для оптимистичного обновления
    const tempId = `temp-${Date.now()}`;
    const tempUser = {
      id: tempId,
      email: normalizedEmail,
      name: null,
    };

    // 1. Мгновенно добавляем пользователя в список
    startTransition(() => {
      setOptimisticSharedWith({ action: "add", user: tempUser });
    });

    // 2. Очищаем поле email
    setEmail("");

    // 3. Отправляем на сервер
    formData.set("email", normalizedEmail);
    const result = await shareList(formData);

    // 4. Если ошибка - откатываем и возвращаем email в input
    if (result && !result.success) {
      startTransition(() => {
        setOptimisticSharedWith({ action: "remove", user: tempUser });
      });
      setEmail(normalizedEmail);
      alert(result.error || "Не удалось предоставить доступ");
    }
  };

  return (
    <div className="mt-4 pt-4 border-t border-gray-100">
      <h4 className="text-xs font-semibold text-gray-500 mb-2 uppercase">
        Поделиться списком:
      </h4>

      {/* Список тех, кто уже имеет доступ */}
      {optimisticSharedWith.length > 0 && (
        <div className="flex gap-1 mb-2 flex-wrap">
          {optimisticSharedWith.map((user) => (
            <span
              key={user.id}
              className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded-full"
            >
              {user.name || user.email}
            </span>
          ))}
        </div>
      )}

      {/* Форма приглашения */}
      <form onSubmit={handleSubmit} className="flex gap-2 mt-3">
        <input type="hidden" name="listId" value={listId} />
        <input
          name="email"
          type="email"
          placeholder="Email друга..."
          className="border p-1 rounded text-xs flex-1"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />
        <button
          type="submit"
          className="bg-blue-100 text-blue-600 px-3 py-1 rounded text-xs font-bold hover:bg-blue-200"
        >
          Пригласить
        </button>
      </form>
    </div>
  );
}

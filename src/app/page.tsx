import prisma from "@/lib/db";
import { auth, signIn, signOut } from "@/auth"; // <--- Импортируем магию Auth.js
import {
  addItem,
  deleteItem,
  toggleItem,
  createList,
  shareList,
} from "./actions";

export default async function Home() {
  // 1. Проверяем сессию (кто зашел?)
  const session = await auth();

  // --- СЦЕНАРИЙ 1: ГОСТЬ (Не залогинен) ---
  if (!session || !session.user) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center p-24">
        <h1 className="text-4xl font-bold mb-8">Smart Shopping List 🛒</h1>
        <p className="text-gray-500 mb-8">
          Войдите, чтобы сохранять свои списки
        </p>

        {/* Кнопка Входа (Server Action внутри формы) */}
        <form
          action={async () => {
            "use server"; // Говорим Next.js, что это серверный код
            await signIn("google"); // Перенаправляем на Google
          }}
        >
          <button className="bg-blue-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-blue-700 transition shadow-lg flex items-center gap-2">
            {/* Иконка Google (SVG) для красоты */}
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
              <path
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                fill="#FFFFFF"
              />
              <path
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                fill="#FFFFFF"
              />
              <path
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                fill="#FFFFFF"
              />
              <path
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                fill="#FFFFFF"
              />
            </svg>
            Войти через Google
          </button>
        </form>
      </main>
    );
  }

  // --- СЦЕНАРИЙ 2: ПОЛЬЗОВАТЕЛЬ (Залогинен) ---

  // 2. Загружаем списки ТОЛЬКО ЭТОГО пользователя
  const allLists = await prisma.shoppingList.findMany({
    where: {
      OR: [
        { ownerId: session.user.id }, // Я владелец
        { sharedWith: { some: { id: session.user.id } } }, // ИЛИ я есть среди "sharedWith"
      ],
    },
    include: {
      items: true,
      owner: true, // <--- Добавим это, чтобы видеть, кто создал список (если это не я)
      sharedWith: true, // <--- И это, чтобы видеть, кто уже имеет доступ
    },
  });

  return (
    <main className="p-10 max-w-xl mx-auto">
      {/* Шапка с профилем */}
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-2xl font-bold">
            Привет, {session.user.name}! 👋
          </h1>
          <p className="text-gray-500 text-sm">{session.user.email}</p>
        </div>

        {/* Кнопка Выхода */}
        <form
          action={async () => {
            "use server";
            await signOut();
          }}
        >
          <button className="text-sm text-red-500 hover:underline">
            Выйти
          </button>
        </form>
      </div>

      {/* --- ФОРМА СОЗДАНИЯ НОВОГО СПИСКА --- */}
      <div className="bg-white p-6 rounded-xl shadow-sm mb-8 border border-blue-100">
        <h3 className="text-lg font-semibold mb-3">Создать новый список 📝</h3>
        <form action={createList} className="flex gap-3">
          <input
            name="title"
            placeholder="Например: Продукты на неделю..."
            className="flex-1 border p-3 rounded-lg bg-gray-50 focus:bg-white focus:ring-2 ring-blue-500 outline-none transition"
            required
          />
          <button
            type="submit"
            className="bg-blue-600 text-white px-6 py-2 rounded-lg font-medium hover:bg-blue-700 transition"
          >
            Создать
          </button>
        </form>
      </div>

      {/* --- Тут всё по-старому: Вывод списков --- */}
      <div className="space-y-6">
        {allLists.map((list) => (
          <div
            key={list.id}
            className="border p-6 rounded-xl shadow-sm bg-white"
          >
            <h2 className="text-xl font-bold mb-4 border-b pb-2">
              {list.title}
            </h2>

            <ul className="mb-4 space-y-2">
              {list.items.map((item) => (
                <li
                  key={item.id}
                  className="flex items-center justify-between bg-gray-50 p-2 rounded"
                >
                  <div className="flex items-center gap-2">
                    <form action={toggleItem}>
                      <input type="hidden" name="itemId" value={item.id} />
                      <input
                        type="hidden"
                        name="isCompleted"
                        value={item.isCompleted.toString()}
                      />
                      <button
                        type="submit"
                        className={`w-5 h-5 border rounded flex items-center justify-center transition-colors ${
                          item.isCompleted
                            ? "bg-blue-500 border-blue-500"
                            : "bg-white border-gray-300"
                        }`}
                      >
                        {item.isCompleted && (
                          <span className="text-white text-xs">✔</span>
                        )}
                      </button>
                    </form>
                    <span
                      className={
                        item.isCompleted ? "line-through text-gray-400" : ""
                      }
                    >
                      {item.name}
                    </span>
                  </div>
                  <form action={deleteItem}>
                    <input type="hidden" name="itemId" value={item.id} />
                    <button
                      type="submit"
                      className="text-red-500 hover:text-red-700 text-xs font-bold px-2 py-1"
                    >
                      ✕
                    </button>
                  </form>
                </li>
              ))}
              {list.items.length === 0 && (
                <li className="text-gray-400 text-sm text-center">
                  Список пуст
                </li>
              )}
            </ul>

            <form action={addItem} className="flex gap-2">
              <input type="hidden" name="listId" value={list.id} />
              <input
                name="itemName"
                placeholder="Что купить?"
                className="border p-2 rounded w-full text-sm"
                required
              />
              <button
                type="submit"
                className="bg-black text-white px-4 py-2 rounded text-sm hover:bg-gray-800"
              >
                +
              </button>
            </form>
            {/* ... выше код добавления товаров ... */}

            {/* --- БЛОК SHARE (Только для владельца) --- */}
            {list.ownerId === session?.user?.id && (
              <div className="mt-4 pt-4 border-t border-gray-100">
                <h4 className="text-xs font-semibold text-gray-500 mb-2 uppercase">
                  Поделиться списком:
                </h4>

                {/* Список тех, кто уже имеет доступ */}
                {list.sharedWith.length > 0 && (
                  <div className="flex gap-1 mb-2 flex-wrap">
                    {list.sharedWith.map((user) => (
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
                <form action={shareList} className="flex gap-2 mt-3">
                  <input type="hidden" name="listId" value={list.id} />
                  <input
                    name="email"
                    type="email"
                    placeholder="Email друга..."
                    className="border p-1 rounded text-xs flex-1"
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
            )}

            {/* Если я ГОСТЬ — показываем, кто владелец */}
            {list.ownerId !== session?.user?.id && (
              <div className="mt-4 pt-4 border-t border-gray-100 text-xs text-gray-400">
                Владелец: {list.owner.name || list.owner.email}
              </div>
            )}
          </div>
        ))}

        {allLists.length === 0 && (
          <div className="text-center py-10 border-2 border-dashed rounded-xl">
            <p className="text-gray-500">У вас пока нет списков.</p>
            <p className="text-sm text-gray-400">
              {/* TODO:Мы добавим кнопку создания списка на следующем шаге. */}
            </p>
          </div>
        )}
      </div>
    </main>
  );
}

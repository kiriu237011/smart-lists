import prisma from "@/lib/db";
import { addItem, deleteItem, toggleItem } from "./actions"; // <--- Импортируем нашу функцию

export default async function Home() {
  // Получаем списки вместе с товарами (items)
  const allLists = await prisma.shoppingList.findMany({
    include: {
      owner: true,
      items: true, // <--- Важно! Теперь мы просим базу вернуть и товары тоже
    },
  });

  return (
    <main className="p-10 max-w-xl mx-auto">
      <h1 className="text-3xl font-bold mb-8">Мои списки</h1>

      <div className="space-y-6">
        {allLists.map((list) => (
          <div
            key={list.id}
            className="border p-6 rounded-xl shadow-sm bg-white"
          >
            {/* Заголовок списка */}
            <h2 className="text-xl font-bold mb-4 border-b pb-2">
              {list.title}
            </h2>

            {/* Список товаров */}
            <ul className="mb-4 space-y-2">
              {list.items.map((item) => (
                <li
                  key={item.id}
                  className="flex items-center justify-between bg-gray-50 p-2 rounded"
                >
                  <div className="flex items-center gap-2">
                    {/* ФОРМА ПЕРЕКЛЮЧЕНИЯ (TOGGLE) */}
                    <form action={toggleItem}>
                      <input type="hidden" name="itemId" value={item.id} />
                      {/* Передаем текущий статус, чтобы сервер знал, что инвертировать */}
                      <input
                        type="hidden"
                        name="isCompleted"
                        value={item.isCompleted.toString()}
                      />

                      <button
                        type="submit"
                        className={`w-6 h-6 border-2 rounded-md flex items-center justify-center transition-all duration-200 shadow-sm hover:shadow-md hover:scale-105 ${
                          item.isCompleted
                            ? "bg-gradient-to-br from-sky-300 to-blue-400 border-sky-400 shadow-sky-200"
                            : "bg-white border-gray-300 hover:border-sky-300"
                        }`}
                      >
                        {/* Если куплено — показываем галочку */}
                        {item.isCompleted && (
                          <span className="text-white text-sm font-bold">
                            ✔
                          </span>
                        )}
                      </button>
                    </form>

                    {/* Название товара (зачеркиваем, если куплено) */}
                    <span
                      className={
                        item.isCompleted ? "line-through text-gray-400" : ""
                      }
                    >
                      {item.name}
                    </span>
                  </div>

                  {/* ФОРМА УДАЛЕНИЯ */}
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
                <li className="text-gray-400 text-sm text-center py-2">
                  Список пуст
                </li>
              )}
            </ul>

            {/* ФОРМА ДОБАВЛЕНИЯ */}
            {/* action={addItem} — вызываем серверную функцию напрямую! */}
            <form action={addItem} className="flex gap-2">
              {/* Скрытое поле, чтобы передать ID списка */}
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
          </div>
        ))}
      </div>
    </main>
  );
}

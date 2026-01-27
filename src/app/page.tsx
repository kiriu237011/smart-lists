import prisma from "@/lib/db"; // Наш синглтон

// 1. Компонент асинхронный (async) — значит он может ждать базу данных
export default async function Home() {
  
  // 2. Прямой запрос в БД. Никаких fetch('/api/...')!
  // Мы просим: "Дай мне все списки и включи информацию о владельце"
  const allLists = await prisma.shoppingList.findMany({
    include: {
      owner: true, // Это как JOIN в SQL, только проще
    }
  });

  return (
    <main className="p-10">
      <h1 className="text-2xl font-bold mb-5">Мои списки покупок</h1>

      <div className="grid gap-4">
        {/* 3. Рендерим данные, которые пришли из БД */}
        {allLists.map((list) => (
          <div 
            key={list.id} 
            className="border p-4 rounded-lg shadow-sm bg-white"
          >
            <h2 className="text-xl font-semibold">{list.title}</h2>
            <p className="text-gray-500 text-sm">
              Владелец: {list.owner.name} ({list.owner.email})
            </p>
            <p className="text-xs text-gray-400 mt-2">
              ID: {list.id}
            </p>
          </div>
        ))}

        {allLists.length === 0 && (
          <p className="text-gray-500">Списков пока нет.</p>
        )}
      </div>
    </main>
  );
}
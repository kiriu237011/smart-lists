import prisma from "@/lib/db";
import ListsContainer from "@/components/lists/ListsContainer";

/**
 * Server Component: загружает все данные для контейнера списков.
 *
 * Производительность важна вдвойне: этот компонент перерисовывается не только
 * при первой загрузке, но и при КАЖДОМ Server Action (revalidatePath("/", "layout")
 * подкладывает свежий RSC-payload в ответ action). Поэтому:
 *   - оба запроса независимы и выполняются параллельно (Promise.all);
 *   - везде точечный select вместо include: раньше owner и sharedWith тянулись
 *     целиком (все поля User — image, даты и т.д.), клиенту нужны только
 *     id/name/email. Меньше данных — быстрее запрос и меньше RSC-payload.
 */
export default async function ListsDataFetcher({
  userId,
  userName,
  userEmail,
}: {
  userId: string;
  userName: string | null;
  userEmail: string;
}) {
  const [allLists, userGroups] = await Promise.all([
    // Списки, доступные пользователю (свои + расшаренные), со всеми связями
    prisma.list.findMany({
      where: {
        OR: [
          { ownerId: userId },
          { sharedWith: { some: { id: userId } } },
        ],
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        title: true,
        ownerId: true,
        owner: { select: { name: true, email: true } },
        items: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            name: true,
            isCompleted: true,
            addedBy: {
              select: { id: true, name: true, email: true },
            },
          },
        },
        sharedWith: { select: { id: true, name: true, email: true } },
        // Подгружаем только группы, принадлежащие текущему пользователю
        groups: {
          where: { userId },
          select: { id: true, name: true },
        },
        // Вложения: показываем ТОЛЬКО подтверждённые (UPLOADED).
        // PENDING-строки (недозалитые) в UI не рендерятся.
        files: {
          where: { status: "UPLOADED" },
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            name: true,
            type: true,
            contentType: true,
            size: true,
            // uploadedBy может быть null (onDelete: SetNull) — fallback в UI.
            uploadedBy: { select: { id: true, name: true, email: true } },
          },
        },
      },
    }),
    // Группы пользователя для панели фильтрации
    prisma.listGroup.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  return (
    <ListsContainer
      allLists={allLists}
      currentUserId={userId}
      currentUserName={userName}
      currentUserEmail={userEmail}
      userGroups={userGroups}
    />
  );
}

import prisma from "@/lib/db";
import ListsContainer from "@/components/lists/ListsContainer";

export default async function ListsDataFetcher({
  userId,
  userName,
  userEmail,
}: {
  userId: string;
  userName: string | null;
  userEmail: string;
}) {
  // Запрос списков с группами текущего пользователя
  const allLists = await prisma.list.findMany({
    where: {
      OR: [
        { ownerId: userId },
        { sharedWith: { some: { id: userId } } },
      ],
    },
    orderBy: { createdAt: "desc" },
    include: {
      items: {
        orderBy: { createdAt: "asc" },
        include: {
          addedBy: {
            select: { id: true, name: true, email: true },
          },
        },
      },
      owner: true,
      sharedWith: true,
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
  });

  // Группы пользователя для панели фильтрации
  const userGroups = await prisma.listGroup.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true },
  });

  return (
    <ListsContainer
      allLists={allLists as any}
      currentUserId={userId}
      currentUserName={userName}
      currentUserEmail={userEmail}
      userGroups={userGroups}
    />
  );
}

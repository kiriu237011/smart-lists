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

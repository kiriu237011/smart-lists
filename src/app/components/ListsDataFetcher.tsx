import prisma from "@/lib/db";
import ListsContainer from "@/app/components/ListsContainer";

export default async function ListsDataFetcher({
  userId,
  userName,
  userEmail,
}: {
  userId: string;
  userName: string | null;
  userEmail: string;
}) {
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
    },
  });

  return (
    <ListsContainer
      allLists={allLists as any}
      currentUserId={userId}
      currentUserName={userName}
      currentUserEmail={userEmail}
    />
  );
}

import prisma from "@/lib/db";
import ListsContainer from "@/components/lists/ListsContainer";
import ServerListsApiProvider from "@/components/providers/ServerListsApiProvider";
import { listInSpaceWhere } from "@/lib/spaces";

/**
 * Server Component: загружает все данные для контейнера списков.
 *
 * Производительность важна вдвойне: этот компонент перерисовывается не только
 * при первой загрузке, но и при КАЖДОМ Server Action (revalidatePath("/", "layout")
 * подкладывает свежий RSC-payload в ответ action). Поэтому:
 *   - оба запроса независимы и выполняются параллельно (Promise.all);
 *   - везде точечный select вместо include: раньше связанные User тянулись
 *     целиком (все поля User — image, даты и т.д.), клиенту нужны только
 *     id/name/email. Меньше данных — быстрее запрос и меньше RSC-payload.
 */
export default async function ListsDataFetcher({
  userId,
  userName,
  userEmail,
  spaceId,
}: {
  userId: string;
  userName: string | null;
  userEmail: string;
  spaceId: string;
}) {
  const [allLists, userGroups] = await Promise.all([
    // Списки, доступные пользователю (свои + расшаренные), со всеми связями.
    // relationLoadStrategy: "join" — все связи одним SQL-запросом (LATERAL JOIN):
    // один round-trip до БД вместо ~6 последовательных (по одному на связь).
    prisma.list.findMany({
      relationLoadStrategy: "join",
      where: listInSpaceWhere(userId, spaceId),
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      select: {
        id: true,
        title: true,
        note: true,
        noteVersion: true,
        ownerId: true,
        owner: { select: { name: true, email: true } },
        items: {
          // Порядок задаёт position. createdAt и id — тайбрейк на случай, когда
          // две записи получили одинаковую позицию (конкурентное добавление):
          // порядок остаётся детерминированным, а не «как ляжет».
          orderBy: [{ position: "asc" }, { createdAt: "asc" }, { id: "asc" }],
          select: {
            id: true,
            name: true,
            note: true,
            noteVersion: true,
            isCompleted: true,
            addedBy: {
              select: { id: true, name: true, email: true },
            },
          },
        },
        shares: {
          select: {
            user: { select: { id: true, name: true, email: true } },
          },
        },
        // Подгружаем только группы, принадлежащие текущему пользователю
        groupMemberships: {
          where: { group: { userId, spaceId } },
          select: {
            position: true,
            group: { select: { id: true, name: true, position: true } },
          },
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
      where: { userId, spaceId },
      orderBy: [
        { position: "asc" },
        { createdAt: "asc" },
        { id: "asc" },
      ],
      select: { id: true, name: true },
    }),
  ]);

  // UI пока использует имя sharedWith как представление списка участников.
  // Источником данных уже служит только явная модель ListShare.
  const lists = allLists.map(({ shares, groupMemberships, ...list }) => ({
    ...list,
    sharedWith: shares.map(({ user }) => user),
    // Бейджи и меню идут в персональном порядке вкладок, а позиция самой
    // membership используется для сортировки карточек активной группы.
    groups: groupMemberships
      .sort(
        (left, right) =>
          left.group.position - right.group.position ||
          left.group.id.localeCompare(right.group.id),
      )
      .map(({ group, position }) => ({
        id: group.id,
        name: group.name,
        position,
      })),
  }));

  return (
    // Серверная реализация адаптера ListsApi: операции идут в БД через Server Actions
    <ServerListsApiProvider spaceId={spaceId}>
      <ListsContainer
        allLists={lists}
        currentUserId={userId}
        currentUserName={userName}
        currentUserEmail={userEmail}
        userGroups={userGroups}
        spaceId={spaceId}
      />
    </ServerListsApiProvider>
  );
}

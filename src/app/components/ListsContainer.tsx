"use client";

import {
  startTransition,
  useCallback,
  useEffect,
  useOptimistic,
  useState,
} from "react";
import { createList, deleteList } from "@/app/actions";
import ShoppingList from "@/app/components/ShoppingList";
import ShareListForm from "@/app/components/ShareListForm";
import CreateListForm from "@/app/components/CreateListForm";

type SharedUser = {
  id: string;
  name: string | null;
  email: string | null;
};

type ListOwner = {
  name: string | null;
  email: string;
};

type Item = {
  id: string;
  name: string;
  isCompleted: boolean;
};

type ShoppingListData = {
  id: string;
  title: string;
  ownerId: string;
  owner: ListOwner;
  items: Item[];
  sharedWith: SharedUser[];
};

type ListsContainerProps = {
  allLists: ShoppingListData[];
  currentUserId: string;
  currentUserName: string | null;
  currentUserEmail: string;
};

export default function ListsContainer({
  allLists,
  currentUserId,
  currentUserName,
  currentUserEmail,
}: ListsContainerProps) {
  const [listToDelete, setListToDelete] = useState<ShoppingListData | null>(
    null,
  );
  const [isDeleting, setIsDeleting] = useState(false);

  const [optimisticLists, setOptimisticLists] = useOptimistic(
    allLists,
    (
      state,
      {
        action,
        listId,
        list,
      }: {
        action: "add" | "delete" | "restore" | "replace";
        listId?: string;
        list?: ShoppingListData;
      },
    ) => {
      switch (action) {
        case "add":
          if (!list || state.some((item) => item.id === list.id)) {
            return state;
          }
          return [list, ...state];
        case "delete":
          if (!listId) {
            return state;
          }
          return state.filter((item) => item.id !== listId);
        case "restore":
          if (!list || !listId || state.some((item) => item.id === list.id)) {
            return state;
          }

          // Возвращаем список на исходную позицию, если удаление не удалось
          const originalIndex = allLists.findIndex(
            (item) => item.id === listId,
          );
          if (originalIndex < 0) {
            return [...state, list];
          }

          const nextState = [...state];
          nextState.splice(originalIndex, 0, list);
          return nextState;
        case "replace":
          if (!list || !listId) {
            return state;
          }

          return state.map((item) => (item.id === listId ? list : item));
        default:
          return state;
      }
    },
  );

  const handleCreateList = useCallback(
    async (title: string) => {
      const tempListId = `temp-${crypto.randomUUID()}`;
      const optimisticList: ShoppingListData = {
        id: tempListId,
        title,
        ownerId: currentUserId,
        owner: {
          name: currentUserName,
          email: currentUserEmail,
        },
        items: [],
        sharedWith: [],
      };

      startTransition(() => {
        setOptimisticLists({ action: "add", list: optimisticList });
      });

      const formData = new FormData();
      formData.append("title", title);
      const result = await createList(formData);

      if (!result || !result.success) {
        startTransition(() => {
          setOptimisticLists({ action: "delete", listId: tempListId });
        });
        alert(result?.error || "Не удалось создать список");
        return { success: false };
      }

      if (!result.list) {
        startTransition(() => {
          setOptimisticLists({ action: "delete", listId: tempListId });
        });
        alert("Список создан, но возникла ошибка при загрузке данных");
        return { success: false };
      }

      startTransition(() => {
        setOptimisticLists({
          action: "replace",
          listId: tempListId,
          list: result.list,
        });
      });

      return { success: true };
    },
    [currentUserEmail, currentUserId, currentUserName, setOptimisticLists],
  );

  const handleConfirmDelete = useCallback(async () => {
    if (!listToDelete) {
      return;
    }

    const list = listToDelete;
    setIsDeleting(true);
    setListToDelete(null);
    startTransition(() => {
      setOptimisticLists({ action: "delete", listId: list.id });
    });

    const formData = new FormData();
    formData.append("listId", list.id);
    const result = await deleteList(formData);

    if (result && !result.success) {
      startTransition(() => {
        setOptimisticLists({
          action: "restore",
          listId: list.id,
          list,
        });
      });
      alert(result.error || "Не удалось удалить список");
    }

    setIsDeleting(false);
  }, [listToDelete, setOptimisticLists]);

  useEffect(() => {
    if (!listToDelete) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setListToDelete(null);
        return;
      }

      if (event.key === "Enter" && !isDeleting) {
        event.preventDefault();
        void handleConfirmDelete();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [handleConfirmDelete, isDeleting, listToDelete]);

  return (
    <>
      <div className="bg-white p-6 rounded-xl shadow-sm mb-8 border border-blue-100">
        <h3 className="text-lg font-semibold mb-3">Создать новый список 📝</h3>
        <CreateListForm onCreateList={handleCreateList} />
      </div>

      <div className="space-y-6">
        {optimisticLists.map((list) => (
          <div
            key={list.id}
            className="border p-6 rounded-xl shadow-sm bg-white"
          >
            {list.id.startsWith("temp-") && (
              <div className="mb-3 text-xs text-blue-600 font-medium">
                Создаём список...
              </div>
            )}
            <div className="mb-4 border-b pb-2 flex items-center justify-between gap-3">
              <h2 className="text-xl font-bold">{list.title}</h2>

              {list.ownerId === currentUserId &&
                !list.id.startsWith("temp-") && (
                  <button
                    type="button"
                    aria-label={`Удалить список ${list.title}`}
                    disabled={isDeleting}
                    onClick={() => setListToDelete(list)}
                    className="text-red-500 hover:text-red-700 text-xs font-bold px-2 py-1"
                  >
                    ✕
                  </button>
                )}
            </div>

            {!list.id.startsWith("temp-") && (
              <ShoppingList items={list.items} listId={list.id} />
            )}

            {list.ownerId === currentUserId && !list.id.startsWith("temp-") && (
              <ShareListForm listId={list.id} sharedWith={list.sharedWith} />
            )}

            {list.ownerId !== currentUserId && (
              <div className="mt-4 pt-4 border-t border-gray-100 text-xs text-gray-400">
                Владелец: {list.owner.name || list.owner.email}
              </div>
            )}
          </div>
        ))}

        {optimisticLists.length === 0 && (
          <div className="text-center py-10 border-2 border-dashed rounded-xl">
            <p className="text-gray-500">У вас пока нет списков.</p>
            <p className="text-sm text-gray-400" />
          </div>
        )}
      </div>

      {listToDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setListToDelete(null)}
        >
          <div
            className="w-full max-w-md rounded-xl bg-white p-5 shadow-lg"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 className="text-lg font-semibold mb-2">Удалить список?</h3>
            <p className="text-sm text-gray-600 mb-5">
              Вы действительно хотите удалить список «{listToDelete.title}»?
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setListToDelete(null)}
                className="px-3 py-2 rounded-md text-sm border border-gray-300 hover:bg-gray-50"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                className="px-3 py-2 rounded-md text-sm bg-red-600 text-white hover:bg-red-700"
              >
                Удалить
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

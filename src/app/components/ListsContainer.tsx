"use client";

import {
  startTransition,
  useCallback,
  useEffect,
  useOptimistic,
  useState,
} from "react";
import { deleteList } from "@/app/actions";
import ShoppingList from "@/app/components/ShoppingList";
import ShareListForm from "@/app/components/ShareListForm";

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
};

export default function ListsContainer({
  allLists,
  currentUserId,
}: ListsContainerProps) {
  const [listToDelete, setListToDelete] = useState<ShoppingListData | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const [optimisticLists, setOptimisticLists] = useOptimistic(
    allLists,
    (
      state,
      {
        action,
        listId,
        list,
      }: { action: "delete" | "restore"; listId: string; list?: ShoppingListData },
    ) => {
      switch (action) {
        case "delete":
          return state.filter((item) => item.id !== listId);
        case "restore":
          if (!list || state.some((item) => item.id === list.id)) {
            return state;
          }

          // Возвращаем список на исходную позицию, если удаление не удалось
          const originalIndex = allLists.findIndex((item) => item.id === listId);
          if (originalIndex < 0) {
            return [...state, list];
          }

          const nextState = [...state];
          nextState.splice(originalIndex, 0, list);
          return nextState;
        default:
          return state;
      }
    },
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
      <div className="space-y-6">
        {optimisticLists.map((list) => (
          <div key={list.id} className="border p-6 rounded-xl shadow-sm bg-white">
            <div className="mb-4 border-b pb-2 flex items-center justify-between gap-3">
              <h2 className="text-xl font-bold">{list.title}</h2>

              {list.ownerId === currentUserId && (
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

            <ShoppingList items={list.items} listId={list.id} />

            {list.ownerId === currentUserId && (
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

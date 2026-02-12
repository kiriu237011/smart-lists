"use client";

import { createList } from "@/app/actions";
import { useFormStatus } from "react-dom";

function CreateListSubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full shrink-0 bg-blue-600 text-white px-6 py-2 rounded-lg font-medium transition sm:w-auto disabled:cursor-not-allowed disabled:bg-blue-700 hover:bg-blue-700"
    >
      {pending ? (
        <span className="inline-flex items-center gap-2">
          <span
            aria-hidden="true"
            className="h-4 w-4 animate-spin rounded-full border-2 border-white/80 border-t-transparent"
          />
          Создаём...
        </span>
      ) : (
        "Создать"
      )}
    </button>
  );
}

export default function CreateListForm() {
  return (
    <form action={createList} className="flex flex-col gap-3 sm:flex-row">
      <input
        name="title"
        placeholder="Например: Продукты на неделю..."
        className="w-full min-w-0 flex-1 border p-3 rounded-lg bg-gray-50 focus:bg-white focus:ring-2 ring-blue-500 outline-none transition"
        required
      />
      <CreateListSubmitButton />
    </form>
  );
}

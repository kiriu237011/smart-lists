/**
 * @file actions.ts
 * @description Server Actions — серверные функции, вызываемые напрямую из клиентских компонентов.
 *
 * Директива `"use server"` в начале файла обозначает, что ВСЕ экспортируемые функции
 * здесь являются Server Actions: они выполняются исключительно на сервере, даже если
 * их вызывают из клиентских компонентов (`"use client"`).
 *
 * Преимущества Server Actions:
 *   - Прямой доступ к БД (через Prisma) без промежуточных API-роутов.
 *   - Автоматическая защита: клиент видит только имя функции, not its body.
 *   - Встроенная интеграция с формами Next.js (`<form action={serverAction}>`).
 *
 * Общая схема каждого Action:
 *   1. Проверка авторизации (`auth()`) — для защищённых операций.
 *   2. Сборка сырых данных из `FormData`.
 *   3. Валидация через Zod (`schema.safeParse`).
 *   4. Операция с БД через Prisma.
 *   5. Инвалидация кеша Next.js (`revalidatePath("/", "layout")` — весь layout-дерево, включая все локали: /ru, /vi, /en, /ja).
 *   6. Возврат результата `{ success: true }` или `{ success: false, error: string }`.
 */

"use server";

import {
  createItemSchema,
  deleteItemSchema,
  toggleItemSchema,
  createListSchema,
  deleteListSchema,
  shareListSchema,
  removeSharedUserSchema,
  renameListSchema,
  renameItemSchema,
  moveItemSchema,
  moveItemToListSchema,
  createGroupSchema,
  deleteGroupSchema,
  renameGroupSchema,
  moveGroupSchema,
  moveListInGroupSchema,
  listGroupMembershipSchema,
  updateListNoteSchema,
  updateItemNoteSchema,
} from "@/lib/validations";
import prisma from "@/lib/db";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { auth } from "@/auth";
import { logger, hashId } from "@/lib/logger";
import { notifyListMembers, notifyListsMembers, notifyUsers } from "@/lib/notify";
import { deleteObjects } from "@/lib/s3";
import { ZodError } from "zod";
import {
  ensureSpaceState,
  getUserSpace,
  listInSpaceWhere,
} from "@/lib/spaces";
import { normalizeNote } from "@/lib/notes";
import {
  MAX_GROUPS_PER_SPACE,
  MAX_ITEMS_PER_LIST,
  MAX_LISTS_PER_SPACE,
  MAX_SUB_ITEMS_PER_ITEM,
} from "@/lib/limits";

/**
 * Шаг между позициями записей при добавлении в конец списка.
 * Величина произвольна: значимо только сравнение позиций между собой.
 */
const POSITION_STEP = 1;

/** Возвращает код ошибки валидации: "tooLong" при превышении длины, иначе "validationError". */
function getValidationError(error: ZodError): string {
  return error.issues.some((i) => i.code === "too_big") ? "tooLong" : "validationError";
}

/**
 * Приводит кеш отметки родителя в соответствие с его подпунктами.
 *
 * Возвращает две операции, а не выполняет их: вызывающий код кладёт их в тот же
 * `$transaction`, что и собственное изменение подпункта, и весь пересчёт
 * укладывается в один round-trip до БД. Условия взаимоисключающие, поэтому
 * ровно одна из операций затрагивает строку, а вторая ничего не делает.
 *
 * Отметка родителя производная (см. `src/lib/item-tree.ts`), и в строке лежит
 * лишь кеш для запросов, которые дерево не собирают. Поэтому атомарность с
 * изменением подпункта желательна, но не критична: расхождение кеша
 * пользователю не видно.
 *
 * Родитель, оставшийся вовсе без подпунктов, сохраняет прежнее значение —
 * с этого момента оно снова его собственное. Отсюда условие `some: {}` в
 * первой операции: без него удаление последнего подпункта отметило бы пункт
 * выполненным, потому что «все ноль подпунктов выполнены».
 */
function syncParentCompletion(parentId: string) {
  return [
    prisma.item.updateMany({
      where: { id: parentId, children: { some: {}, none: { isCompleted: false } } },
      data: { isCompleted: true },
    }),
    prisma.item.updateMany({
      where: { id: parentId, children: { some: { isCompleted: false } } },
      data: { isCompleted: false },
    }),
  ];
}

/** Проверяет, что spaceId из формы принадлежит текущему пользователю. */
async function resolveActionSpace(userId: string, formData: FormData) {
  const spaceId = formData.get("spaceId");
  if (typeof spaceId !== "string" || !spaceId) return null;
  return getUserSpace(userId, spaceId);
}

// ===========================================================================
// SERVER ACTIONS ДЛЯ ЗАПИСЕЙ (Item)
// ===========================================================================

/**
 * Добавляет новую запись в список.
 *
 * Вызывается из компонента `SmartList` оптимистично: запись сначала
 * появляется на экране мгновенно (с временным ID), а эта функция
 * сохраняет его в БД в фоне.
 *
 * @param formData - FormData с полями:
 *   - `itemName`     {string} — название записи (1–100 символов).
 *   - `listId`       {string} — ID списка, к которому добавляется запись.
 *   - `parentItemId` {string} — ID родительского пункта для подпункта ("" — обычный пункт).
 * @returns `{ success: true }` или `{ success: false, error: string }`.
 */
export async function addItem(formData: FormData) {
  try {
    // Проверяем сессию до обработки данных
    const session = await auth();
    if (!session?.user?.id) {
      return { success: false, error: "Необходима авторизация" };
    }
    const space = await resolveActionSpace(session.user.id, formData);
    if (!space) return { success: false, error: "Пространство не найдено" };

    // Собираем объект из FormData: Zod лучше работает с обычными объектами
    const rawData = {
      itemName: formData.get("itemName"),
      listId: formData.get("listId"),
      // FormData не умеет передавать null: пустая строка означает обычный пункт.
      parentItemId: formData.get("parentItemId") || null,
    };

    // safeParse не бросает исключение, а возвращает { success, data | error }
    const result = createItemSchema.safeParse(rawData);

    if (!result.success) {
      logger.error({ error: result.error }, "Ошибка валидации:");
      return { success: false, error: getValidationError(result.error) };
    }

    const { listId, itemName, parentItemId } = result.data;

    // Позиция значима внутри своего уровня, поэтому максимум берётся по
    // соседям будущей записи: у подпункта это подпункты того же родителя,
    // у обычного пункта — пункты верхнего уровня списка.
    //
    // Два одновременных добавления могут прочитать один и тот же максимум и
    // получить равные позиции. Это допустимо: порядок доопределяет тайбрейк по
    // createdAt и id при выборке, список не ломается.
    let position: number;

    if (parentItemId) {
      // Один запрос закрывает четыре проверки сразу: доступ к списку,
      // существование родителя ИМЕННО в этом списке, запрет второго уровня
      // вложенности (`parentId: null` у родителя) — и отдаёт максимальную
      // позицию среди уже существующих подпунктов.
      const parent = await prisma.item.findFirst({
        where: {
          id: parentItemId,
          listId,
          parentId: null,
          list: listInSpaceWhere(session.user.id, space.id),
        },
        select: {
          id: true,
          children: {
            orderBy: { position: "desc" },
            take: 1,
            select: { position: true },
          },
          // Счёт берётся тем же запросом, что и проверка доступа с позицией:
          // отдельный COUNT стоил бы лишнего round-trip до БД ради числа,
          // которое почти всегда далеко от потолка.
          _count: { select: { children: true } },
        },
      });

      if (!parent) {
        return { success: false, error: "Пункт не найден" };
      }

      if (parent._count.children >= MAX_SUB_ITEMS_PER_ITEM) {
        logger.warn(
          { uid: hashId(session.user.id), listId, action: "addItem" },
          "Достигнут потолок подпунктов у пункта",
        );
        return { success: false, error: "subItemLimitReached" };
      }

      position = (parent.children[0]?.position ?? 0) + POSITION_STEP;
    } else {
      // Проверяем, что пользователь является владельцем или участником списка.
      // Заодно забираем максимальную позицию верхнего уровня: новая запись
      // встаёт в конец. Отдельным запросом это стоило бы лишнего round-trip
      // до БД, поэтому берём его тем же запросом, что и проверку доступа.
      const list = await prisma.list.findFirst({
        where: {
          id: listId,
          ...listInSpaceWhere(session.user.id, space.id),
        },
        select: {
          id: true,
          items: {
            where: { parentId: null },
            orderBy: { position: "desc" },
            take: 1,
            select: { position: true },
          },
          // Считаются только пункты верхнего уровня: у подпунктов свой потолок,
          // общий счёт означал бы разное для разных списков.
          _count: { select: { items: { where: { parentId: null } } } },
        },
      });

      if (!list) {
        return { success: false, error: "Список не найден" };
      }

      if (list._count.items >= MAX_ITEMS_PER_LIST) {
        logger.warn(
          { uid: hashId(session.user.id), listId, action: "addItem" },
          "Достигнут потолок пунктов в списке",
        );
        return { success: false, error: "itemLimitReached" };
      }

      position = (list.items[0]?.position ?? 0) + POSITION_STEP;
    }

    // После safeParse TypeScript точно знает, что result.data.itemName — string
    const create = prisma.item.create({
      data: {
        name: itemName,
        listId,
        parentId: parentItemId,
        addedById: session.user.id,
        position,
      },
    });

    if (parentItemId) {
      // Новый подпункт всегда невыполненный, поэтому родитель заведомо
      // перестаёт быть выполненным — пересчитывать нечего, достаточно снять
      // кеш. Обе операции идут одним батчем: лишний round-trip до БД дороже.
      await prisma.$transaction([
        create,
        prisma.item.updateMany({
          where: { id: parentItemId },
          data: { isCompleted: false },
        }),
      ]);
    } else {
      await create;
    }

    // Инвалидируем весь layout-дерево (/ и все локали) → перефетч Server Component
    revalidatePath("/", "layout");
    // Pusher-уведомление уходит ПОСЛЕ отправки ответа клиенту (after) —
    // не задерживает action. Вкладка автора исключается по socketId:
    // ей свежие данные приходят вместе с ответом action (revalidatePath).
    const socketId = formData.get("socketId");
    after(() => notifyListMembers(result.data.listId, socketId));
    logger.info({ uid: hashId(session.user.id), listId: result.data.listId, action: "addItem" }, "Запись добавлена");
    return { success: true };
  } catch (error) {
    logger.error({ error: error }, "Ошибка при добавлении записи:");
    return { success: false, error: "Не удалось добавить запись" };
  }
}

/**
 * Удаляет запись из списка по её ID.
 *
 * Используется оптимистично: запись исчезает с экрана немедленно,
 * а эта функция удаляет его из БД в фоне.
 *
 * @param formData - FormData с полем:
 *   - `itemId` {string} — ID удаляемой записи.
 * @returns `void` (ошибки логируются в консоль, но не передаются клиенту).
 */
export async function deleteItem(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) return;
  const space = await resolveActionSpace(session.user.id, formData);
  if (!space) return;

  const data = { itemId: formData.get("itemId") };

  const result = deleteItemSchema.safeParse(data);

  if (!result.success) {
    logger.error({ error: result.error }, "Validation Error:");
    return;
  }

  // Получаем listId до удаления и одновременно проверяем права доступа.
  // parentId нужен, чтобы после удаления подпункта пересчитать родителя.
  const item = await prisma.item.findFirst({
    where: {
      id: result.data.itemId,
      list: listInSpaceWhere(session.user.id, space.id),
    },
    select: { listId: true, parentId: true },
  });

  // Если item не найден или нет доступа — молча выходим
  if (!item) return;

  // Подпункты удаляемого пункта уходят каскадом на уровне БД (составной FK
  // с onDelete: Cascade), поэтому отдельного запроса на них нет.
  const remove = prisma.item.delete({
    where: { id: result.data.itemId },
  });

  if (item.parentId) {
    // Удалённый подпункт мог быть последним невыполненным — тогда родитель
    // становится выполненным. Пересчёт идёт тем же батчем, что и удаление.
    await prisma.$transaction([remove, ...syncParentCompletion(item.parentId)]);
  } else {
    await remove;
  }

  revalidatePath("/", "layout");
  // Уведомление после ответа (after), без эха вкладке автора (socketId)
  const socketId = formData.get("socketId");
  after(() => notifyListMembers(item.listId, socketId));
  logger.info({ uid: hashId(session.user.id), listId: item.listId, action: "deleteItem" }, "Запись удалена");
}

/**
 * Переключает статус записи: "выполнено" ↔ "не выполнено".
 *
 * Важный нюанс: FormData всегда возвращает строки.
 * Поэтому `isCompleted` нужно явно преобразовать до отправки в схему:
 * `formData.get("isCompleted") === "true"` → `true | false`.
 *
 * Логика: мы передаём ТЕКУЩЕЕ значение `isCompleted`, а в БД сохраняем ИНВЕРСИЮ.
 * Присланное значение — то, что видел пользователь на экране: если чужая
 * правка успела прийти раньше, результат всё равно соответствует его намерению.
 *
 * Подпункты меняют смысл операции в обе стороны:
 *   - у пункта с подпунктами собственной отметки нет, она производная, поэтому
 *     клик по нему означает «проставить это значение всем подпунктам»;
 *   - клик по подпункту меняет только его, а родитель пересчитывается по итогу.
 *
 * @param formData - FormData с полями:
 *   - `itemId`      {string} — ID записи.
 *   - `isCompleted` {string} — текущий статус ("true" | "false").
 * @returns `void`.
 */
export async function toggleItem(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) return;
  const space = await resolveActionSpace(session.user.id, formData);
  if (!space) return;

  const data = {
    itemId: formData.get("itemId"),
    // FormData возвращает строки → явно преобразуем в boolean
    isCompleted: formData.get("isCompleted") === "true",
  };

  const result = toggleItemSchema.safeParse(data);

  if (!result.success) {
    logger.error({ error: result.error }, "Validation Error:");
    return;
  }

  // Проверяем права доступа перед обновлением. Заодно узнаём положение записи
  // в дереве: подпункт она или пункт, и есть ли у неё свои подпункты.
  const item = await prisma.item.findFirst({
    where: {
      id: result.data.itemId,
      list: listInSpaceWhere(session.user.id, space.id),
    },
    select: {
      listId: true,
      parentId: true,
      _count: { select: { children: true } },
    },
  });

  if (!item) return;

  const isCompleted = !result.data.isCompleted; // Инвертируем текущее значение

  const updateSelf = prisma.item.update({
    where: { id: result.data.itemId },
    data: { isCompleted },
  });

  if (item._count.children > 0) {
    // Каскад вниз. Собственное поле пункта пишется вместе с подпунктами: на
    // чтении оно не используется, но остаётся согласованным кешем.
    await prisma.$transaction([
      prisma.item.updateMany({
        where: { parentId: result.data.itemId },
        data: { isCompleted },
      }),
      updateSelf,
    ]);
  } else if (item.parentId) {
    // Каскад вверх. Операции идут по порядку в одной транзакции, поэтому
    // пересчёт родителя видит уже изменённый подпункт.
    await prisma.$transaction([updateSelf, ...syncParentCompletion(item.parentId)]);
  } else {
    await updateSelf;
  }

  revalidatePath("/", "layout");
  // Уведомление после ответа (after), без эха вкладке автора (socketId)
  const socketId = formData.get("socketId");
  after(() => notifyListMembers(item.listId, socketId));
  logger.info({ uid: hashId(session.user.id), listId: item.listId, completed: !result.data.isCompleted, action: "toggleItem" }, "Статус записи изменён");
}

/**
 * Переименовывает запись в списке.
 *
 * Доступно владельцу списка и пользователям, которым список расшарен.
 *
 * @param formData - FormData с полями:
 *   - `itemId`   {string} — ID переименовываемой записи.
 *   - `itemName` {string} — новое название (1–100 символов).
 * @returns `{ success: true }` или `{ success: false, error: string }`.
 */
export async function renameItem(formData: FormData) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return { success: false, error: "Необходима авторизация" };
    }
    const space = await resolveActionSpace(session.user.id, formData);
    if (!space) return { success: false, error: "Пространство не найдено" };

    const rawData = {
      itemId: formData.get("itemId"),
      itemName: formData.get("itemName"),
    };

    const result = renameItemSchema.safeParse(rawData);
    if (!result.success) {
      return {
        success: false,
        error: getValidationError(result.error),
      };
    }

    // updateMany позволяет атомарно проверить права и обновить за один запрос
    const renamedItem = await prisma.item.updateMany({
      where: {
        id: result.data.itemId,
        list: listInSpaceWhere(session.user.id, space.id),
      },
      data: { name: result.data.itemName },
    });

    if (renamedItem.count === 0) {
      return { success: false, error: "Запись не найдена" };
    }

    // Получаем listId для уведомления участников
    const item = await prisma.item.findUnique({
      where: { id: result.data.itemId },
      select: { listId: true },
    });

    revalidatePath("/", "layout");
    if (item) {
      // Уведомление после ответа (after), без эха вкладке автора (socketId)
      const socketId = formData.get("socketId");
      after(() => notifyListMembers(item.listId, socketId));
      logger.info({ uid: hashId(session.user.id), listId: item.listId, action: "renameItem" }, "Запись переименована");
    }
    return { success: true };
  } catch (error) {
    logger.error({ error: error }, "Ошибка при переименовании записи:");
    return { success: false, error: "Не удалось переименовать запись" };
  }
}

/**
 * Перемещает запись внутри списка.
 *
 * Клиент присылает ID новых соседей, а не целевой индекс: индекс мог устареть,
 * пока другой участник добавлял или удалял записи. Позиции соседей читаются
 * из БД — присланным клиентом значениям доверять нельзя.
 *
 * Обычный путь пишет ОДНУ строку: новая позиция это середина между позициями
 * соседей. Перенумерация всего списка выполняется только в вырожденном случае,
 * когда дробное деление исчерпало точность double (см. ниже).
 *
 * @param formData - FormData с полями:
 *   - `itemId`         {string} — ID перемещаемой записи.
 *   - `previousItemId` {string} — ID записи, после которой встать ("" — в начало).
 *   - `nextItemId`     {string} — ID записи, перед которой встать ("" — в конец).
 * @returns `{ success: true }` или `{ success: false, error: string }`.
 */
export async function moveItem(formData: FormData) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return { success: false, error: "Необходима авторизация" };
    }
    const space = await resolveActionSpace(session.user.id, formData);
    if (!space) return { success: false, error: "Пространство не найдено" };

    const result = moveItemSchema.safeParse({
      itemId: formData.get("itemId"),
      // FormData не умеет передавать null: пустая строка означает край списка.
      previousItemId: formData.get("previousItemId") || null,
      nextItemId: formData.get("nextItemId") || null,
    });

    if (!result.success) {
      logger.error({ error: result.error }, "Validation Error:");
      return { success: false, error: getValidationError(result.error) };
    }

    const { itemId, previousItemId, nextItemId } = result.data;

    // Один запрос закрывает сразу три задачи: проверку доступа к списку,
    // проверку принадлежности соседей ЭТОМУ ЖЕ списку и получение позиций.
    // Условие items.some гарантирует, что перемещаемая запись лежит здесь же.
    const list = await prisma.list.findFirst({
      where: {
        items: { some: { id: itemId } },
        ...listInSpaceWhere(session.user.id, space.id),
      },
      select: {
        id: true,
        items: {
          orderBy: [{ position: "asc" }, { createdAt: "asc" }, { id: "asc" }],
          select: { id: true, position: true, parentId: true },
        },
      },
    });

    if (!list) {
      return { success: false, error: "Запись не найдена" };
    }

    // Перемещение всегда идёт внутри своего уровня: подпункт остаётся у своего
    // родителя, пункт — среди пунктов списка. Позиции сравнимы только внутри
    // этой группы, поэтому и соседи ищутся только среди неё: сосед с другого
    // уровня означает устаревшее или подделанное представление клиента.
    const moving = list.items.find((item) => item.id === itemId);
    if (!moving) {
      return { success: false, error: "Запись не найдена" };
    }
    const siblings = list.items.filter((item) => item.parentId === moving.parentId);

    // `?? null` приводит «сосед не запрошен» и «сосед не найден» к одному типу:
    // различает их проверка ниже, а дальше по коду null означает край уровня.
    const previous = previousItemId
      ? (siblings.find((item) => item.id === previousItemId) ?? null)
      : null;
    const next = nextItemId
      ? (siblings.find((item) => item.id === nextItemId) ?? null)
      : null;

    // Сосед не найден — другой участник успел удалить запись, и представление
    // клиента устарело. Переставить «примерно куда просили» хуже, чем отказать:
    // клиент откатит оптимистичное перемещение и покажет актуальный порядок.
    if ((previousItemId && !previous) || (nextItemId && !next)) {
      return { success: false, error: "stale" };
    }

    // Записи уже отсортированы по позиции, поэтому края берутся без обхода.
    const lowestPosition = siblings[0].position;
    const highestPosition = siblings[siblings.length - 1].position;

    let newPosition: number;
    if (previous && next) {
      newPosition = (previous.position + next.position) / 2;
    } else if (previous) {
      newPosition = highestPosition + POSITION_STEP;
    } else if (next) {
      newPosition = lowestPosition - POSITION_STEP;
    } else {
      // Соседей нет вовсе: на этом уровне одна запись, двигать её некуда.
      return { success: true };
    }

    // Середина не легла строго между соседями — double исчерпал мантиссу.
    // Практически недостижимо (нужно ~50 вставок подряд между одной и той же
    // парой), но молча получить одинаковые позиции нельзя, поэтому здесь
    // перенумеровывается весь уровень. Проверка идёт по факту, а не по
    // произвольному эпсилону: так она верна при любых значениях позиций.
    const needsRebalance =
      previous !== null &&
      next !== null &&
      (newPosition <= previous.position || newPosition >= next.position);

    if (needsRebalance) {
      // Перенумеровываются только соседи по уровню: позиции подпунктов и
      // пунктов независимы, и трогать чужой уровень незачем.
      const reordered = siblings.filter((item) => item.id !== itemId);
      const insertAt = previous
        ? reordered.findIndex((item) => item.id === previous.id) + 1
        : 0;
      reordered.splice(insertAt, 0, {
        id: itemId,
        position: newPosition,
        parentId: moving.parentId,
      });

      await prisma.$transaction(
        reordered.map((item, index) =>
          prisma.item.update({
            where: { id: item.id },
            data: { position: (index + 1) * POSITION_STEP },
          }),
        ),
      );
      logger.info(
        { uid: hashId(session.user.id), listId: list.id, action: "moveItem" },
        "Позиции записей перенумерованы: исчерпана точность дробной позиции",
      );
    } else {
      await prisma.item.update({
        where: { id: itemId },
        data: { position: newPosition },
      });
    }

    revalidatePath("/", "layout");
    // Уведомление после ответа (after), без эха вкладке автора (socketId)
    const socketId = formData.get("socketId");
    after(() => notifyListMembers(list.id, socketId));
    logger.info(
      { uid: hashId(session.user.id), listId: list.id, action: "moveItem" },
      "Запись перемещена",
    );
    return { success: true };
  } catch (error) {
    logger.error({ error: error }, "Ошибка при перемещении записи:");
    return { success: false, error: "Не удалось переместить запись" };
  }
}

/**
 * Переносит или копирует запись в другой список ТОГО ЖЕ пространства.
 *
 * Ограничение «в рамках пространства» не требует отдельного кода: оба списка
 * ищутся через `listInSpaceWhere` с одним и тем же `spaceId`, поэтому список
 * из другого пространства просто не найдётся.
 *
 * Перенос — это одна запись в БД: у существующей строки меняются `listId` и
 * `position`. Заметка, её версия, автор и `createdAt` едут со строкой сами.
 * Подпункты тоже: составной внешний ключ `(parentId, listId)` объявлен с
 * ON UPDATE CASCADE, поэтому смена `listId` у родителя переносит их на уровне
 * БД. Их позиции значимы внутри родителя и потому не меняются.
 *
 * Копирование создаёт новую строку: `noteVersion` начинается с нуля (у новой
 * строки свой счётчик optimistic concurrency), автором становится тот, кто
 * копировал, а отметка о выполнении сбрасывается — копию заводят, чтобы
 * сделать дело заново в другом списке. Подпункты копируются по тем же
 * правилам и сохраняют свой порядок.
 *
 * Сам подпункт перенести нельзя: он принадлежит родителю, а не списку.
 * Интерфейс такого пункта меню не показывает, но присланному ID доверять
 * нельзя, поэтому проверка есть и здесь.
 *
 * Запись встаёт в конец целевого списка, как при обычном добавлении.
 *
 * @param formData - FormData с полями:
 *   - `itemId`       {string} — ID переносимой записи.
 *   - `targetListId` {string} — ID списка-получателя.
 *   - `mode`         {string} — "move" | "copy".
 * @returns `{ success: true }` или `{ success: false, error: string }`.
 */
export async function moveItemToList(formData: FormData) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return { success: false, error: "Необходима авторизация" };
    }
    const space = await resolveActionSpace(session.user.id, formData);
    if (!space) return { success: false, error: "Пространство не найдено" };

    const result = moveItemToListSchema.safeParse({
      itemId: formData.get("itemId"),
      targetListId: formData.get("targetListId"),
      mode: formData.get("mode"),
    });

    if (!result.success) {
      logger.error({ error: result.error }, "Validation Error:");
      return { success: false, error: getValidationError(result.error) };
    }

    const { itemId, targetListId, mode } = result.data;

    // Доступ к записи проверяется через её список: право менять содержимое
    // есть и у владельца, и у редактора (ListShare).
    const item = await prisma.item.findFirst({
      where: {
        id: itemId,
        list: listInSpaceWhere(session.user.id, space.id),
      },
      select: {
        id: true,
        name: true,
        note: true,
        listId: true,
        parentId: true,
        // Подпункты нужны только при копировании, но отдельный запрос ради
        // этого стоил бы round-trip: список подпунктов у записи короткий.
        children: {
          orderBy: [{ position: "asc" }, { createdAt: "asc" }, { id: "asc" }],
          select: { name: true, note: true, position: true },
        },
      },
    });

    if (!item) {
      return { success: false, error: "Запись не найдена" };
    }

    // Подпункт принадлежит родителю: переносить его отдельно в другой список
    // нельзя, туда он поедет только вместе с ним.
    if (item.parentId) {
      return { success: false, error: "subItem" };
    }

    // Клиент такой пункт и не показывает, но присланному ID доверять нельзя.
    if (item.listId === targetListId) {
      return { success: false, error: "sameList" };
    }

    // Тем же запросом, что и проверку доступа к целевому списку, забираем его
    // максимальную позицию: запись встаёт в конец (см. addItem).
    const targetList = await prisma.list.findFirst({
      where: {
        id: targetListId,
        ...listInSpaceWhere(session.user.id, space.id),
      },
      select: {
        id: true,
        items: {
          where: { parentId: null },
          orderBy: { position: "desc" },
          take: 1,
          select: { position: true },
        },
        _count: { select: { items: { where: { parentId: null } } } },
      },
    });

    if (!targetList) {
      return { success: false, error: "Список не найден" };
    }

    // Перенос и копирование — вторая дверь к росту списка. Потолок здесь не
    // ради хранилища (при переносе строк не прибавляется вовсе), а ради
    // инварианта: ни один список не должен вырасти за размер, на котором
    // интерфейс и пересчёт позиций остаются отзывчивыми.
    if (targetList._count.items >= MAX_ITEMS_PER_LIST) {
      logger.warn(
        { uid: hashId(session.user.id), listId: targetListId, action: "moveItemToList" },
        "Целевой список достиг потолка пунктов",
      );
      return { success: false, error: "itemLimitReached" };
    }

    const position = (targetList.items[0]?.position ?? 0) + POSITION_STEP;

    if (mode === "move") {
      // Подпункты едут за родителем сами: ON UPDATE CASCADE на составном
      // ключе (parentId, listId) переписывает им listId. Позиции подпунктов
      // значимы внутри родителя, поэтому остаются прежними.
      await prisma.item.update({
        where: { id: itemId },
        data: { listId: targetListId, position },
      });
    } else {
      // Внутри колбэка транзакции сужение типа сессии теряется, поэтому ID
      // автора берётся здесь, где он ещё проверен.
      const authorId = session.user.id;
      const copyData = {
        name: item.name,
        note: item.note,
        // У копии своя история заметки: версия начинается с нуля, а отметка
        // времени ставится по факту создания — по ней AI отбирает контекст.
        noteUpdatedAt: item.note ? new Date() : null,
        listId: targetListId,
        addedById: authorId,
        position,
      };

      if (item.children.length === 0) {
        await prisma.item.create({ data: copyData });
      } else {
        // ID копии известен только после её создания, поэтому подпункты
        // пишутся вторым запросом — но в одной транзакции: половина
        // скопированного пункта хуже, чем не скопированный вовсе.
        await prisma.$transaction(async (tx) => {
          const copy = await tx.item.create({ data: copyData, select: { id: true } });
          await tx.item.createMany({
            data: item.children.map((child) => ({
              name: child.name,
              note: child.note,
              noteUpdatedAt: child.note ? new Date() : null,
              listId: targetListId,
              parentId: copy.id,
              addedById: authorId,
              position: child.position,
            })),
          });
        });
      }
    }

    revalidatePath("/", "layout");
    // Затронуты ДВА списка с разными наборами участников. При копировании
    // исходный список не менялся — его участников дёргать незачем.
    const socketId = formData.get("socketId");
    const affectedListIds =
      mode === "move" ? [item.listId, targetListId] : [targetListId];
    after(() => notifyListsMembers(affectedListIds, socketId));
    logger.info(
      {
        uid: hashId(session.user.id),
        listId: item.listId,
        targetListId,
        action: mode === "move" ? "moveItemToList" : "copyItemToList",
      },
      "Запись перенесена в другой список",
    );
    return { success: true };
  } catch (error) {
    logger.error({ error: error }, "Ошибка при переносе записи в другой список:");
    return { success: false, error: "Не удалось перенести запись" };
  }
}

/**
 * Сохраняет заметку записи с optimistic concurrency control.
 * Редактировать её может любой участник списка с ролью EDITOR.
 */
export async function updateItemNote(formData: FormData) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return { success: false, error: "Необходима авторизация" };
    }
    const space = await resolveActionSpace(session.user.id, formData);
    if (!space) return { success: false, error: "Пространство не найдено" };

    const result = updateItemNoteSchema.safeParse({
      itemId: formData.get("itemId"),
      note: formData.get("note"),
      expectedVersion: formData.get("expectedVersion"),
    });
    if (!result.success) {
      return { success: false, error: getValidationError(result.error) };
    }

    const current = await prisma.item.findFirst({
      where: {
        id: result.data.itemId,
        list: listInSpaceWhere(session.user.id, space.id),
      },
      select: { note: true, noteVersion: true, listId: true },
    });
    if (!current) return { success: false, error: "Запись не найдена" };

    if (current.noteVersion !== result.data.expectedVersion) {
      return {
        success: false,
        error: "noteConflict",
        currentNote: current.note,
        currentVersion: current.noteVersion,
      };
    }

    const note = normalizeNote(result.data.note);
    if (current.note === note) {
      return { success: true, note, noteVersion: current.noteVersion };
    }

    const updated = await prisma.item.updateMany({
      where: {
        id: result.data.itemId,
        noteVersion: result.data.expectedVersion,
        list: listInSpaceWhere(session.user.id, space.id),
      },
      data: {
        note,
        noteVersion: { increment: 1 },
        noteUpdatedAt: new Date(),
      },
    });

    if (updated.count === 0) {
      const latest = await prisma.item.findFirst({
        where: {
          id: result.data.itemId,
          list: listInSpaceWhere(session.user.id, space.id),
        },
        select: { note: true, noteVersion: true },
      });
      return {
        success: false,
        error: "noteConflict",
        currentNote: latest?.note ?? null,
        currentVersion: latest?.noteVersion ?? result.data.expectedVersion,
      };
    }

    const noteVersion = result.data.expectedVersion + 1;
    revalidatePath("/", "layout");
    const socketId = formData.get("socketId");
    after(() => notifyListMembers(current.listId, socketId));
    logger.info(
      { uid: hashId(session.user.id), listId: current.listId, action: "updateItemNote" },
      "Заметка записи обновлена",
    );
    return { success: true, note, noteVersion };
  } catch (error) {
    logger.error({ error }, "Ошибка при сохранении заметки записи:");
    return { success: false, error: "Не удалось сохранить заметку" };
  }
}

// ===========================================================================
// SERVER ACTIONS ДЛЯ СПИСКОВ (List)
// ===========================================================================

/**
 * Сохраняет общую заметку списка с optimistic concurrency control.
 * В отличие от названия списка, заметка доступна всем EDITOR-участникам.
 */
export async function updateListNote(formData: FormData) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return { success: false, error: "Необходима авторизация" };
    }
    const space = await resolveActionSpace(session.user.id, formData);
    if (!space) return { success: false, error: "Пространство не найдено" };

    const result = updateListNoteSchema.safeParse({
      listId: formData.get("listId"),
      note: formData.get("note"),
      expectedVersion: formData.get("expectedVersion"),
    });
    if (!result.success) {
      return { success: false, error: getValidationError(result.error) };
    }

    const current = await prisma.list.findFirst({
      where: {
        id: result.data.listId,
        ...listInSpaceWhere(session.user.id, space.id),
      },
      select: { note: true, noteVersion: true },
    });
    if (!current) return { success: false, error: "Список не найден" };

    if (current.noteVersion !== result.data.expectedVersion) {
      return {
        success: false,
        error: "noteConflict",
        currentNote: current.note,
        currentVersion: current.noteVersion,
      };
    }

    const note = normalizeNote(result.data.note);
    if (current.note === note) {
      return { success: true, note, noteVersion: current.noteVersion };
    }

    const updated = await prisma.list.updateMany({
      where: {
        id: result.data.listId,
        noteVersion: result.data.expectedVersion,
        ...listInSpaceWhere(session.user.id, space.id),
      },
      data: {
        note,
        noteVersion: { increment: 1 },
        noteUpdatedAt: new Date(),
      },
    });

    if (updated.count === 0) {
      const latest = await prisma.list.findFirst({
        where: {
          id: result.data.listId,
          ...listInSpaceWhere(session.user.id, space.id),
        },
        select: { note: true, noteVersion: true },
      });
      return {
        success: false,
        error: "noteConflict",
        currentNote: latest?.note ?? null,
        currentVersion: latest?.noteVersion ?? result.data.expectedVersion,
      };
    }

    const noteVersion = result.data.expectedVersion + 1;
    revalidatePath("/", "layout");
    const socketId = formData.get("socketId");
    after(() => notifyListMembers(result.data.listId, socketId));
    logger.info(
      { uid: hashId(session.user.id), listId: result.data.listId, action: "updateListNote" },
      "Заметка списка обновлена",
    );
    return { success: true, note, noteVersion };
  } catch (error) {
    logger.error({ error }, "Ошибка при сохранении заметки списка:");
    return { success: false, error: "Не удалось сохранить заметку" };
  }
}

/**
 * Создаёт новый список для авторизованного пользователя.
 *
 * Ключевой принцип безопасности: `ownerId` берётся из серверной сессии,
 * а не из FormData. Клиент не может подменить владельца списка.
 *
 * @param formData - FormData с полем:
 *   - `title` {string} — название списка (1–50 символов).
 * @returns
 *   - `{ success: true, list: ListData }` — созданный список с полными данными.
 *   - `{ success: false, error: string }` — ошибка авторизации или валидации.
 */
export async function createList(formData: FormData) {
  try {
    // 1. Проверяем авторизацию НА СЕРВЕРЕ
    const session = await auth();
    if (!session || !session.user || !session.user.id) {
      return { success: false, error: "Необходима авторизация" };
    }
    const space = await resolveActionSpace(session.user.id, formData);
    if (!space) return { success: false, error: "Пространство не найдено" };

    // 2. Валидация данных
    const rawData = {
      title: formData.get("title"),
      groupId: formData.get("groupId") ?? undefined,
    };

    const result = createListSchema.safeParse(rawData);

    if (!result.success) {
      return {
        success: false,
        error: getValidationError(result.error),
      };
    }

    // Потолок на размер пространства. Без лока: при 200 списках перебор на
    // один-два ничего не значит, а параллельный флуд, способный проскочить
    // окно между COUNT и INSERT, ограничивает суточный лимит мутаций. Там,
    // где счёт мал и точность важна (5 пространств, 5 вложений), в проекте
    // используется строгий вариант с транзакцией — здесь он был бы платой
    // без выигрыша.
    const listsInSpace = await prisma.list.count({
      where: { ownerId: session.user.id, spaceId: space.id },
    });
    if (listsInSpace >= MAX_LISTS_PER_SPACE) {
      logger.warn(
        { uid: hashId(session.user.id), spaceId: space.id, action: "createList" },
        "Достигнут потолок списков в пространстве",
      );
      return { success: false, error: "listLimitReached" };
    }

    // Если список создаётся из активной группы, сначала проверяем личную группу
    // в том же пространстве и вычисляем позицию в её начале. Сам membership
    // создаётся вложенно вместе со списком: ошибка связи не должна оставлять
    // успешно созданный, но не показанный в активной группе список.
    let initialMembership: {
      group: { id: string; name: string };
      position: number;
    } | null = null;
    if (result.data.groupId) {
      const group = await prisma.listGroup.findFirst({
        where: {
          id: result.data.groupId,
          userId: session.user.id,
          spaceId: space.id,
        },
        select: { id: true, name: true },
      });
      if (!group) return { success: false, error: "Группа не найдена" };

      const firstMembership = await prisma.listGroupMembership.findFirst({
        where: { groupId: group.id },
        orderBy: { position: "asc" },
        select: { position: true },
      });
      initialMembership = {
        group,
        position: firstMembership
          ? firstMembership.position - POSITION_STEP
          : POSITION_STEP,
      };
    }

    // 3. Создаём список и начальное членство одной атомарной Prisma-операцией.
    // ownerId берём из сессии — клиент не может его подменить!
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const newList = (await (prisma.list.create as any)({
      data: {
        title: result.data.title,
        ownerId: session.user.id,
        spaceId: space.id,
        groupMemberships: initialMembership
          ? {
              create: {
                groupId: initialMembership.group.id,
                position: initialMembership.position,
              },
            }
          : undefined,
      },
      // include подгружает связанные записи одним запросом
      include: {
        owner: true,
        items: {
          include: {
            addedBy: {
              select: { id: true, name: true, email: true },
            },
          },
        },
      },
    })) as {
      id: string;
      title: string;
      note: string | null;
      noteVersion: number;
      ownerId: string;
      owner: { name: string | null; email: string };
      items: {
        id: string;
        name: string;
        note: string | null;
        noteVersion: number;
        isCompleted: boolean;
        parentId: string | null;
        addedBy: { id: string; name: string | null; email: string } | null;
      }[];
    };

    const listGroups = initialMembership
      ? [
          {
            id: initialMembership.group.id,
            name: initialMembership.group.name,
            position: initialMembership.position,
          },
        ]
      : [];

    revalidatePath("/", "layout");
    // Уведомление после ответа (after), без эха вкладке автора (socketId)
    const socketId = formData.get("socketId");
    after(() => notifyListMembers(newList.id, socketId));
    logger.info({ uid: hashId(session.user.id), listId: newList.id, action: "createList" }, "Список создан");

    // Возвращаем только нужные поля (не весь объект Prisma)
    return {
      success: true,
      list: {
        id: newList.id,
        title: newList.title,
        note: newList.note,
        noteVersion: newList.noteVersion,
        ownerId: newList.ownerId,
        owner: {
          name: newList.owner.name,
          email: newList.owner.email,
        },
        items: newList.items.map((item) => ({
          id: item.id,
          name: item.name,
          note: item.note,
          noteVersion: item.noteVersion,
          isCompleted: item.isCompleted,
          parentId: item.parentId,
          addedBy: item.addedBy
            ? {
                id: item.addedBy.id,
                name: item.addedBy.name,
                email: item.addedBy.email,
              }
            : null,
        })),
        sharedWith: [],
        groups: listGroups,
        // Новый список вложений ещё не имеет — поле обязательно для типа ListData.
        files: [],
      },
    };
  } catch (error) {
    logger.error({ error: error }, "Ошибка при создании списка:");
    return { success: false, error: "Не удалось создать список" };
  }
}

/**
 * Удаляет список.
 *
 * Защита: `deleteMany` с фильтром `ownerId === session.user.id` гарантирует,
 * что только владелец может удалить свой список. Если `deleted.count === 0`,
 * значит запись не найдена или пользователь не является владельцем.
 *
 * @param formData - FormData с полем:
 *   - `listId` {string} — ID удаляемого списка.
 * @returns `{ success: true }` или `{ success: false, error: string }`.
 */
export async function deleteList(formData: FormData) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return { success: false, error: "Необходима авторизация" };
    }
    const space = await resolveActionSpace(session.user.id, formData);
    if (!space) return { success: false, error: "Пространство не найдено" };

    const rawData = {
      listId: formData.get("listId"),
    };

    const result = deleteListSchema.safeParse(rawData);
    if (!result.success) {
      return { success: false, error: "Неверные данные" };
    }

    // Собираем участников И ключи вложений ДО удаления: каскад снесёт строки
    // Attachment вместе со списком, а ключи для S3-уборки лежат именно в них.
    const listToNotify = await prisma.list.findFirst({
      where: { id: result.data.listId, ownerId: session.user.id, spaceId: space.id },
      select: {
        ownerId: true,
        shares: { select: { userId: true } },
        files: { select: { key: true } },
      },
    });

    // deleteMany с двойным условием — атомарная проверка прав.
    // onDelete: Cascade удалит строки Attachment автоматически.
    const deleted = await prisma.list.deleteMany({
      where: {
        id: result.data.listId,
        ownerId: session.user.id, // Только владелец может удалить список
        spaceId: space.id,
      },
    });

    if (deleted.count === 0) {
      return {
        success: false,
        error: "Только владелец может удалить список",
      };
    }

    // S3-уборка батчем — best-effort. Удаление списка НЕ блокируется её успехом:
    // при сбое останется редкий невидимый сирота в бакете (дешевле битой ссылки).
    if (listToNotify && listToNotify.files.length > 0) {
      try {
        await deleteObjects(listToNotify.files.map((f) => f.key));
      } catch (s3Error) {
        logger.error(
          { error: s3Error, listId: result.data.listId, action: "deleteList" },
          "Не удалось удалить вложения списка из S3 (осиротевшие файлы)",
        );
      }
    }

    revalidatePath("/", "layout");
    // Уведомляем всех участников после удаления (используем заранее собранные ID).
    // after — после отправки ответа; socketId исключает вкладку автора из эха.
    if (listToNotify) {
      const userIds = [
        listToNotify.ownerId,
        ...listToNotify.shares.map((share) => share.userId),
      ];
      const socketId = formData.get("socketId");
      after(() => notifyUsers(userIds, socketId));
    }
    logger.info({ uid: hashId(session.user.id), listId: result.data.listId, action: "deleteList" }, "Список удалён");
    return { success: true };
  } catch (error) {
    logger.error({ error: error }, "Ошибка при удалении списка:");
    return { success: false, error: "Не удалось удалить список" };
  }
}

/**
 * Предоставляет совместный доступ к списку другому пользователю.
 *
 * Порядок операций:
 *   1. Проверяем авторизацию.
 *   2. Валидируем listId и email приглашённого.
 *   3. Ищем пользователя с таким email в БД.
 *   4. Запрещаем приглашать самого себя.
 *   5. Создаём явную запись доступа `ListShare`.
 *
 * Защита: `update` с условием `ownerId === session.user.id` гарантирует,
 * что только владелец списка может приглашать других.
 *
 * @param formData - FormData с полями:
 *   - `listId` {string} — ID списка.
 *   - `email`  {string} — email приглашаемого пользователя.
 * @returns
 *   - `{ success: true, user: SharedUser }` — данные добавленного пользователя.
 *   - `{ success: false, error: string }` — описание ошибки.
 */
export async function shareList(formData: FormData) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return { success: false, error: "Необходима авторизация" };
    }
    const ownerId = session.user.id;
    const space = await resolveActionSpace(ownerId, formData);
    if (!space) return { success: false, error: "Пространство не найдено" };

    const rawData = {
      listId: formData.get("listId"),
      email: formData.get("email"),
    };

    const result = shareListSchema.safeParse(rawData);
    if (!result.success) {
      return { success: false, error: "Неверные данные" };
    }

    // 1. Ищем пользователя по email (он должен быть зарегистрирован в системе)
    const userToShare = await prisma.user.findUnique({
      where: { email: result.data.email },
    });

    if (!userToShare) {
      return {
        success: false,
        error: "Пользователь с таким email не найден",
      };
    }

    // Нельзя поделиться списком с самим собой
    if (userToShare.id === session.user.id) {
      return {
        success: false,
        error: "Нельзя поделиться списком с самим собой",
      };
    }

    // Получатель всегда видит новый общий список в своём default-пространстве.
    const recipientSpaceId = await ensureSpaceState(userToShare.id);
    await prisma.$transaction(async (tx) => {
      const ownedList = await tx.list.findFirst({
        where: { id: result.data.listId, ownerId, spaceId: space.id },
        select: { id: true },
      });
      if (!ownedList) throw new Error("LIST_NOT_FOUND");

      await tx.listShare.upsert({
        where: {
          listId_userId: { listId: ownedList.id, userId: userToShare.id },
        },
        create: {
          listId: ownedList.id,
          userId: userToShare.id,
          spaceId: recipientSpaceId,
        },
        update: {},
      });
    });

    revalidatePath("/", "layout");
    // Уведомление после ответа (after), без эха вкладке автора (socketId)
    const socketId = formData.get("socketId");
    after(() => notifyListMembers(result.data.listId, socketId));
    logger.info({ uid: hashId(session.user.id), listId: result.data.listId, action: "shareList" }, "Доступ к списку предоставлен");

    return {
      success: true,
      user: {
        id: userToShare.id,
        name: userToShare.name,
        email: userToShare.email,
      },
    };
  } catch (error) {
    logger.error({ error: error }, "Ошибка при предоставлении доступа:");
    return {
      success: false,
      error: "Не удалось предоставить доступ",
    };
  }
}

/**
 * Убирает пользователя из совместного доступа к списку.
 *
 * Защита: `update` с условием `ownerId === session.user.id` гарантирует,
 * что только владелец может отзывать доступ.
 *
 * @param formData - FormData с полями:
 *   - `listId` {string} — ID списка.
 *   - `userId` {string} — ID пользователя, которого убирают.
 * @returns `{ success: true }` или `{ success: false, error: string }`.
 */
export async function removeSharedUser(formData: FormData) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return { success: false, error: "Необходима авторизация" };
    }
    const ownerId = session.user.id;
    const space = await resolveActionSpace(ownerId, formData);
    if (!space) return { success: false, error: "Пространство не найдено" };

    const rawData = {
      listId: formData.get("listId"),
      userId: formData.get("userId"),
    };

    const result = removeSharedUserSchema.safeParse(rawData);
    if (!result.success) {
      return { success: false, error: "Неверные данные" };
    }

    await prisma.$transaction(async (tx) => {
      const ownedList = await tx.list.findFirst({
        where: { id: result.data.listId, ownerId, spaceId: space.id },
        select: { id: true },
      });
      if (!ownedList) throw new Error("LIST_NOT_FOUND");

      await tx.listShare.deleteMany({
        where: { listId: ownedList.id, userId: result.data.userId },
      });
    });

    revalidatePath("/", "layout");
    // Уведомляем удалённого пользователя отдельно — после удаления ListShare
    // notifyListMembers уже не включает его в рассылку.
    // after гарантирует, что refresh придёт после ответа (и после revalidatePath);
    // socketId исключает вкладку автора из эха.
    const socketId = formData.get("socketId");
    after(async () => {
      await notifyUsers([result.data.userId], socketId);
      await notifyListMembers(result.data.listId, socketId);
    });
    logger.info({ uid: hashId(session.user.id), listId: result.data.listId, action: "removeSharedUser" }, "Доступ к списку отозван");
    return { success: true };
  } catch (error) {
    logger.error({ error: error }, "Ошибка при удалении доступа:");
    return { success: false, error: "Не удалось убрать доступ" };
  }
}

/**
 * Позволяет пользователю самостоятельно покинуть расшаренный список.
 *
 * В отличие от `removeSharedUser` (где действует владелец), здесь
 * действует сам пользователь: он удаляет собственную запись `ListShare`.
 *
 * Защита: удаляется только ListShare текущего пользователя в выбранном
 * пространстве, существование которой проверено перед операцией.
 *
 * @param formData - FormData с полем:
 *   - `listId` {string} — ID списка, от которого пользователь хочет отписаться.
 * @returns `{ success: true }` или `{ success: false, error: string }`.
 */
export async function leaveSharedList(formData: FormData) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return { success: false, error: "Необходима авторизация" };
    }

    const listId = formData.get("listId");
    if (!listId || typeof listId !== "string" || !listId.trim()) {
      return { success: false, error: "Неверные данные" };
    }
    const userId = session.user.id;
    const space = await resolveActionSpace(userId, formData);
    if (!space) return { success: false, error: "Пространство не найдено" };
    const share = await prisma.listShare.findFirst({
      where: { listId, userId, spaceId: space.id },
      select: { listId: true },
    });
    if (!share) return { success: false, error: "Список не найден" };

    await prisma.listShare.deleteMany({
      where: { listId, userId, spaceId: space.id },
    });

    revalidatePath("/", "layout");
    // Уведомляем самого пользователя отдельно — после удаления его нет в ListShare,
    // поэтому notifyListMembers его не затронет (нужно для других вкладок/устройств).
    // after — после ответа; socketId исключает ТЕКУЩУЮ вкладку автора (другие получат).
    const socketId = formData.get("socketId");
    after(async () => {
      await notifyUsers([userId], socketId);
      await notifyListMembers(listId, socketId);
    });
    logger.info({ uid: hashId(session.user.id), listId, action: "leaveSharedList" }, "Пользователь покинул список");
    return { success: true };
  } catch (error) {
    logger.error({ error: error }, "Ошибка при выходе из списка:");
    return { success: false, error: "Не удалось отписаться от списка" };
  }
}

/**
 * Переименовывает список покупок.
 *
 * Защита: `updateMany` с фильтром `ownerId === session.user.id` гарантирует,
 * что только владелец может переименовать свой список.
 *
 * @param formData - FormData с полями:
 *   - `listId` {string} — ID переименовываемого списка.
 *   - `title`  {string} — новое название (1–50 символов).
 * @returns `{ success: true }` или `{ success: false, error: string }`.
 */
export async function renameList(formData: FormData) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return { success: false, error: "Необходима авторизация" };
    }
    const space = await resolveActionSpace(session.user.id, formData);
    if (!space) return { success: false, error: "Пространство не найдено" };

    const rawData = {
      listId: formData.get("listId"),
      title: formData.get("title"),
    };

    const result = renameListSchema.safeParse(rawData);
    if (!result.success) {
      return {
        success: false,
        error: getValidationError(result.error),
      };
    }

    // updateMany с двойным условием — атомарная проверка прав
    const updated = await prisma.list.updateMany({
      where: {
        id: result.data.listId,
        ownerId: session.user.id, // Только владелец может переименовать список
        spaceId: space.id,
      },
      data: {
        title: result.data.title,
      },
    });

    if (updated.count === 0) {
      return {
        success: false,
        error: "Только владелец может переименовать список",
      };
    }

    revalidatePath("/", "layout");
    // Уведомление после ответа (after), без эха вкладке автора (socketId)
    const socketId = formData.get("socketId");
    after(() => notifyListMembers(result.data.listId, socketId));
    logger.info({ uid: hashId(session.user.id), listId: result.data.listId, action: "renameList" }, "Список переименован");
    return { success: true };
  } catch (error) {
    logger.error({ error: error }, "Ошибка при переименовании списка:");
    return { success: false, error: "Не удалось переименовать список" };
  }
}

// ===========================================================================
// SERVER ACTIONS ДЛЯ ГРУПП СПИСКОВ (ListGroup)
// ===========================================================================

/**
 * Создаёт новую группу списков для авторизованного пользователя.
 *
 * @param formData - FormData с полем:
 *   - `name` {string} — название группы (1–50 символов).
 * @returns `{ success: true, group: { id, name } }` или `{ success: false, error: string }`.
 */
export async function createGroup(formData: FormData) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return { success: false, error: "Необходима авторизация" };
    }
    const space = await resolveActionSpace(session.user.id, formData);
    if (!space) return { success: false, error: "Пространство не найдено" };

    const rawData = { name: formData.get("name") };
    const result = createGroupSchema.safeParse(rawData);
    if (!result.success) {
      return {
        success: false,
        error: getValidationError(result.error),
      };
    }

    const groupsInSpace = await prisma.listGroup.count({
      where: { userId: session.user.id, spaceId: space.id },
    });
    if (groupsInSpace >= MAX_GROUPS_PER_SPACE) {
      logger.warn(
        { uid: hashId(session.user.id), spaceId: space.id, action: "createGroup" },
        "Достигнут потолок групп в пространстве",
      );
      return { success: false, error: "groupLimitReached" };
    }

    // Новая группа встаёт в конец текущего порядка. Тайбрейки createdAt/id в
    // выборке сохранят детерминированность даже при двух одновременных созданиях.
    const lastGroup = await prisma.listGroup.findFirst({
      where: { userId: session.user.id, spaceId: space.id },
      orderBy: [
        { position: "desc" },
        { createdAt: "desc" },
        { id: "desc" },
      ],
      select: { position: true },
    });

    const group = await prisma.listGroup.create({
      data: {
        name: result.data.name,
        userId: session.user.id,
        spaceId: space.id,
        position: (lastGroup?.position ?? 0) + POSITION_STEP,
      },
      select: { id: true, name: true },
    });

    revalidatePath("/", "layout");
    logger.info({ uid: hashId(session.user.id), groupId: group.id, action: "createGroup" }, "Группа создана");
    return { success: true, group };
  } catch (error) {
    logger.error({ error: error }, "Ошибка при создании группы:");
    return { success: false, error: "Не удалось создать группу" };
  }
}

/**
 * Удаляет группу списков.
 * Списки из группы не удаляются — только связь списков с группой.
 *
 * @param formData - FormData с полем:
 *   - `groupId` {string} — ID удаляемой группы.
 * @returns `{ success: true }` или `{ success: false, error: string }`.
 */
export async function deleteGroup(formData: FormData) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return { success: false, error: "Необходима авторизация" };
    }
    const space = await resolveActionSpace(session.user.id, formData);
    if (!space) return { success: false, error: "Пространство не найдено" };

    const rawData = { groupId: formData.get("groupId") };
    const result = deleteGroupSchema.safeParse(rawData);
    if (!result.success) {
      return { success: false, error: "Неверные данные" };
    }

    // deleteMany с проверкой userId гарантирует что только владелец удаляет свою группу
    const deleted = await prisma.listGroup.deleteMany({
      where: {
        id: result.data.groupId,
        userId: session.user.id,
        spaceId: space.id,
      },
    });

    if (deleted.count === 0) {
      return { success: false, error: "Только владелец может удалить группу" };
    }

    revalidatePath("/", "layout");
    logger.info({ uid: hashId(session.user.id), groupId: result.data.groupId, action: "deleteGroup" }, "Группа удалена");
    return { success: true };
  } catch (error) {
    logger.error({ error: error }, "Ошибка при удалении группы:");
    return { success: false, error: "Не удалось удалить группу" };
  }
}

/**
 * Переименовывает группу списков.
 *
 * @param formData - FormData с полями:
 *   - `groupId` {string} — ID переименовываемой группы.
 *   - `name`    {string} — новое название (1–50 символов).
 * @returns `{ success: true }` или `{ success: false, error: string }`.
 */
export async function renameGroup(formData: FormData) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return { success: false, error: "Необходима авторизация" };
    }
    const space = await resolveActionSpace(session.user.id, formData);
    if (!space) return { success: false, error: "Пространство не найдено" };

    const rawData = {
      groupId: formData.get("groupId"),
      name: formData.get("name"),
    };
    const result = renameGroupSchema.safeParse(rawData);
    if (!result.success) {
      return {
        success: false,
        error: getValidationError(result.error),
      };
    }

    const updated = await prisma.listGroup.updateMany({
      where: {
        id: result.data.groupId,
        userId: session.user.id,
        spaceId: space.id,
      },
      data: { name: result.data.name },
    });

    if (updated.count === 0) {
      return {
        success: false,
        error: "Только владелец может переименовать группу",
      };
    }

    revalidatePath("/", "layout");
    logger.info({ uid: hashId(session.user.id), groupId: result.data.groupId, action: "renameGroup" }, "Группа переименована");
    return { success: true };
  } catch (error) {
    logger.error({ error: error }, "Ошибка при переименовании группы:");
    return { success: false, error: "Не удалось переименовать группу" };
  }
}

/**
 * Перемещает личную группу между двумя новыми соседями.
 *
 * Клиент передаёт место назначения соседями, а не индексом. Сервер заново
 * читает их позиции в текущем пространстве и изменяет только одну строку.
 * Если сосед исчез или перестал быть соседним, клиентское представление
 * считается устаревшим и оптимистичное перемещение откатывается.
 */
export async function moveGroup(formData: FormData) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return { success: false, error: "Необходима авторизация" };
    }
    const space = await resolveActionSpace(session.user.id, formData);
    if (!space) return { success: false, error: "Пространство не найдено" };

    const result = moveGroupSchema.safeParse({
      groupId: formData.get("groupId"),
      previousGroupId: formData.get("previousGroupId") || null,
      nextGroupId: formData.get("nextGroupId") || null,
    });
    if (!result.success) {
      return { success: false, error: getValidationError(result.error) };
    }

    const { groupId, previousGroupId, nextGroupId } = result.data;
    const groups = await prisma.listGroup.findMany({
      where: { userId: session.user.id, spaceId: space.id },
      orderBy: [
        { position: "asc" },
        { createdAt: "asc" },
        { id: "asc" },
      ],
      select: { id: true, position: true },
    });

    const movingGroup = groups.find((group) => group.id === groupId);
    if (!movingGroup) {
      return { success: false, error: "Группа не найдена" };
    }

    const previous = previousGroupId
      ? (groups.find((group) => group.id === previousGroupId) ?? null)
      : null;
    const next = nextGroupId
      ? (groups.find((group) => group.id === nextGroupId) ?? null)
      : null;
    if ((previousGroupId && !previous) || (nextGroupId && !next)) {
      return { success: false, error: "stale" };
    }

    // После удаления перемещаемой группы указанные соседи должны описывать
    // реальный разрыв в текущем порядке. Иначе другая вкладка успела изменить
    // порядок, и применять жест приблизительно было бы неожиданно.
    const withoutMoving = groups.filter((group) => group.id !== groupId);
    const previousIndex = previous
      ? withoutMoving.findIndex((group) => group.id === previous.id)
      : -1;
    const nextIndex = next
      ? withoutMoving.findIndex((group) => group.id === next.id)
      : withoutMoving.length;
    if (
      nextIndex !== previousIndex + 1 ||
      (!previous && nextIndex !== 0) ||
      (!next && previousIndex !== withoutMoving.length - 1)
    ) {
      return { success: false, error: "stale" };
    }

    if (!previous && !next) {
      // Единственная группа уже находится на единственно возможном месте.
      return { success: true };
    }

    const lowestPosition = groups[0].position;
    const highestPosition = groups[groups.length - 1].position;
    let newPosition: number;
    if (previous && next) {
      newPosition = (previous.position + next.position) / 2;
    } else if (previous) {
      newPosition = highestPosition + POSITION_STEP;
    } else {
      newPosition = lowestPosition - POSITION_STEP;
    }

    const needsRebalance =
      previous !== null &&
      next !== null &&
      (newPosition <= previous.position || newPosition >= next.position);

    if (needsRebalance) {
      const reordered = [...withoutMoving];
      reordered.splice(nextIndex, 0, movingGroup);
      await prisma.$transaction(
        reordered.map((group, index) =>
          prisma.listGroup.update({
            where: { id: group.id },
            data: { position: (index + 1) * POSITION_STEP },
          }),
        ),
      );
      logger.info(
        {
          uid: hashId(session.user.id),
          groupId,
          spaceId: space.id,
          action: "moveGroup",
        },
        "Позиции групп перенумерованы: исчерпана точность дробной позиции",
      );
    } else {
      await prisma.listGroup.update({
        where: { id: groupId },
        data: { position: newPosition },
      });
    }

    revalidatePath("/", "layout");
    logger.info(
      {
        uid: hashId(session.user.id),
        groupId,
        spaceId: space.id,
        action: "moveGroup",
      },
      "Группа перемещена",
    );
    return { success: true };
  } catch (error) {
    logger.error({ error }, "Ошибка при перемещении группы:");
    return { success: false, error: "Не удалось переместить группу" };
  }
}

/**
 * Перемещает список между соседями внутри личной группы пользователя.
 *
 * Клиент передаёт соседей итогового порядка, а сервер читает их позиции из БД
 * и проверяет актуальность разрыва. Обычно меняется одна membership-строка;
 * при исчерпании точности перенумеровывается только целевая группа.
 */
export async function moveListInGroup(formData: FormData) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return { success: false, error: "Необходима авторизация" };
    }
    const space = await resolveActionSpace(session.user.id, formData);
    if (!space) return { success: false, error: "Пространство не найдено" };

    const result = moveListInGroupSchema.safeParse({
      groupId: formData.get("groupId"),
      listId: formData.get("listId"),
      previousListId: formData.get("previousListId") || null,
      nextListId: formData.get("nextListId") || null,
    });
    if (!result.success) {
      return { success: false, error: getValidationError(result.error) };
    }

    const { groupId, listId, previousListId, nextListId } = result.data;
    const [group, visibleList] = await Promise.all([
      prisma.listGroup.findFirst({
        where: { id: groupId, userId: session.user.id, spaceId: space.id },
        select: { id: true },
      }),
      prisma.list.findFirst({
        where: { id: listId, ...listInSpaceWhere(session.user.id, space.id) },
        select: { id: true },
      }),
    ]);
    if (!group) return { success: false, error: "Группа не найдена" };
    if (!visibleList) return { success: false, error: "Список не найден" };

    const memberships = await prisma.listGroupMembership.findMany({
      where: { groupId },
      orderBy: [
        { position: "asc" },
        { list: { createdAt: "asc" } },
        { listId: "asc" },
      ],
      select: { listId: true, position: true },
    });
    const movingMembership = memberships.find(
      (membership) => membership.listId === listId,
    );
    if (!movingMembership) {
      return { success: false, error: "Список не входит в группу" };
    }

    const previous = previousListId
      ? (memberships.find(
          (membership) => membership.listId === previousListId,
        ) ?? null)
      : null;
    const next = nextListId
      ? (memberships.find((membership) => membership.listId === nextListId) ??
        null)
      : null;
    if ((previousListId && !previous) || (nextListId && !next)) {
      return { success: false, error: "stale" };
    }

    const withoutMoving = memberships.filter(
      (membership) => membership.listId !== listId,
    );
    const previousIndex = previous
      ? withoutMoving.findIndex(
          (membership) => membership.listId === previous.listId,
        )
      : -1;
    const nextIndex = next
      ? withoutMoving.findIndex(
          (membership) => membership.listId === next.listId,
        )
      : withoutMoving.length;
    if (
      nextIndex !== previousIndex + 1 ||
      (!previous && nextIndex !== 0) ||
      (!next && previousIndex !== withoutMoving.length - 1)
    ) {
      return { success: false, error: "stale" };
    }

    if (!previous && !next) {
      return { success: true };
    }

    const lowestPosition = memberships[0].position;
    const highestPosition = memberships[memberships.length - 1].position;
    let newPosition: number;
    if (previous && next) {
      newPosition = (previous.position + next.position) / 2;
    } else if (previous) {
      newPosition = highestPosition + POSITION_STEP;
    } else {
      newPosition = lowestPosition - POSITION_STEP;
    }

    const needsRebalance =
      previous !== null &&
      next !== null &&
      (newPosition <= previous.position || newPosition >= next.position);

    if (needsRebalance) {
      const reordered = [...withoutMoving];
      reordered.splice(nextIndex, 0, movingMembership);
      await prisma.$transaction(
        reordered.map((membership, index) =>
          prisma.listGroupMembership.update({
            where: {
              listId_groupId: {
                listId: membership.listId,
                groupId,
              },
            },
            data: { position: (index + 1) * POSITION_STEP },
          }),
        ),
      );
      logger.info(
        {
          uid: hashId(session.user.id),
          groupId,
          listId,
          spaceId: space.id,
          action: "moveListInGroup",
        },
        "Позиции списков группы перенумерованы: исчерпана точность дробной позиции",
      );
    } else {
      await prisma.listGroupMembership.update({
        where: { listId_groupId: { listId, groupId } },
        data: { position: newPosition },
      });
    }

    revalidatePath("/", "layout");
    logger.info(
      {
        uid: hashId(session.user.id),
        groupId,
        listId,
        spaceId: space.id,
        action: "moveListInGroup",
      },
      "Список перемещён внутри группы",
    );
    return { success: true };
  } catch (error) {
    logger.error({ error }, "Ошибка при перемещении списка внутри группы:");
    return { success: false, error: "Не удалось переместить список" };
  }
}

/**
 * Добавляет список в группу.
 *
 * Проверяет, что:
 *   1. Пользователь — владелец группы.
 *   2. Пользователь имеет доступ к списку (владелец или через ListShare).
 *
 * @param formData - FormData с полями:
 *   - `groupId` {string} — ID группы.
 *   - `listId`  {string} — ID списка.
 * @returns `{ success: true }` или `{ success: false, error: string }`.
 */
export async function addListToGroup(formData: FormData) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return { success: false, error: "Необходима авторизация" };
    }
    const space = await resolveActionSpace(session.user.id, formData);
    if (!space) return { success: false, error: "Пространство не найдено" };

    const rawData = {
      groupId: formData.get("groupId"),
      listId: formData.get("listId"),
    };
    const result = listGroupMembershipSchema.safeParse(rawData);
    if (!result.success) {
      return { success: false, error: "Неверные данные" };
    }

    // Проверяем что группа принадлежит пользователю
    const group = await prisma.listGroup.findFirst({
      where: { id: result.data.groupId, userId: session.user.id, spaceId: space.id },
    });
    if (!group) {
      return { success: false, error: "Группа не найдена" };
    }

    // Проверяем что пользователь имеет доступ к списку
    const list = await prisma.list.findFirst({
      where: {
        id: result.data.listId,
        ...listInSpaceWhere(session.user.id, space.id),
      },
    });
    if (!list) {
      return { success: false, error: "Список не найден" };
    }

    const lastMembership = await prisma.listGroupMembership.findFirst({
      where: { groupId: result.data.groupId },
      orderBy: { position: "desc" },
      select: { position: true },
    });
    await prisma.listGroupMembership.upsert({
      where: {
        listId_groupId: {
          listId: result.data.listId,
          groupId: result.data.groupId,
        },
      },
      create: {
        listId: result.data.listId,
        groupId: result.data.groupId,
        position: (lastMembership?.position ?? 0) + POSITION_STEP,
      },
      update: {},
    });

    revalidatePath("/", "layout");
    logger.info({ uid: hashId(session.user.id), groupId: result.data.groupId, listId: result.data.listId, action: "addListToGroup" }, "Список добавлен в группу");
    return { success: true };
  } catch (error) {
    logger.error({ error: error }, "Ошибка при добавлении списка в группу:");
    return { success: false, error: "Не удалось добавить список в группу" };
  }
}

/**
 * Убирает список из группы.
 *
 * Проверяет что пользователь — владелец группы.
 *
 * @param formData - FormData с полями:
 *   - `groupId` {string} — ID группы.
 *   - `listId`  {string} — ID списка.
 * @returns `{ success: true }` или `{ success: false, error: string }`.
 */
export async function removeListFromGroup(formData: FormData) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return { success: false, error: "Необходима авторизация" };
    }
    const space = await resolveActionSpace(session.user.id, formData);
    if (!space) return { success: false, error: "Пространство не найдено" };

    const rawData = {
      groupId: formData.get("groupId"),
      listId: formData.get("listId"),
    };
    const result = listGroupMembershipSchema.safeParse(rawData);
    if (!result.success) {
      return { success: false, error: "Неверные данные" };
    }

    // Проверяем что группа принадлежит пользователю
    const group = await prisma.listGroup.findFirst({
      where: { id: result.data.groupId, userId: session.user.id, spaceId: space.id },
    });
    if (!group) {
      return { success: false, error: "Группа не найдена" };
    }

    await prisma.listGroupMembership.deleteMany({
      where: {
        groupId: result.data.groupId,
        listId: result.data.listId,
      },
    });

    revalidatePath("/", "layout");
    logger.info({ uid: hashId(session.user.id), groupId: result.data.groupId, listId: result.data.listId, action: "removeListFromGroup" }, "Список убран из группы");
    return { success: true };
  } catch (error) {
    logger.error({ error: error }, "Ошибка при удалении списка из группы:");
    return { success: false, error: "Не удалось убрать список из группы" };
  }
}

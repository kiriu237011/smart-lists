/**
 * @file guest-storage.test.ts
 * @description Тесты гостевой реализации `ListsApi` поверх localStorage.
 *
 * Гостевой режим — вторая полноценная реализация того же контракта, что и
 * Server Actions, но без БД и без ревью со стороны Prisma: любая ошибка здесь
 * тихо портит данные в браузере пользователя. При этом почти всё поведение
 * проверяемо без сети, поэтому покрытие идёт по продуктовым правилам —
 * куда встаёт новая запись, что происходит с копией, когда версия заметки
 * конфликтует, — а не по строкам кода.
 *
 * localStorage подменяется `MemoryStorage`: гостевому коду нужен только
 * Storage, поднимать ради него jsdom незачем.
 */

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { MemoryStorage } from "../../test/memory-storage";
import {
  createGuestListsApi,
  GUEST_USER_ID,
  loadGuestData,
  toListData,
} from "@/lib/guest-storage";

const STORAGE_KEY = "guest-data-v1";
const GUEST_NAME = "Гость";

const storage = new MemoryStorage();
vi.stubGlobal("localStorage", storage);

let refresh: Mock<() => void>;

/** Свежий API поверх чистого хранилища — состояние между тестами не течёт. */
function createApi() {
  return createGuestListsApi(refresh, GUEST_NAME);
}

/** Прямое чтение того, что реально записано в хранилище. */
function stored() {
  return loadGuestData();
}

beforeEach(() => {
  storage.clear();
  storage.failOnWrite = false;
  refresh = vi.fn<() => void>();
});

afterEach(() => {
  // Отдельные тесты подменяют localStorage своей заглушкой. Без возврата
  // глобала на место все последующие тесты писали бы уже в неё.
  vi.stubGlobal("localStorage", storage);
});

describe("тестовое окружение", () => {
  it("модуль пишет именно в подставленное хранилище", async () => {
    // Канарейка: если стаб перестанет доходить до модуля, остальные тесты
    // начнут проверять чужое состояние вместо реального.
    await createApi().createList({ title: "Проверка" });

    expect(storage.getItem(STORAGE_KEY)).toContain("Проверка");
  });

  it("очистка хранилища видна модулю", async () => {
    await createApi().createList({ title: "Проверка" });

    storage.clear();

    expect(stored().lists).toHaveLength(0);
  });
});

describe("изоляция пустого состояния", () => {
  it("отдаёт независимый объект на каждый вызов", () => {
    const first = loadGuestData();
    const second = loadGuestData();

    expect(first).not.toBe(second);
    expect(first.lists).not.toBe(second.lists);
  });

  it("неудачная запись не оставляет список в памяти", async () => {
    // Регрессия: `loadGuestData` возвращал ссылку на общую константу, а
    // мутации шли прямо в результат. При отказе записи (приватный режим,
    // квота) список оседал в константе и всплывал как несуществующий.
    storage.failOnWrite = true;

    const result = await createApi().createList({ title: "Фантом" });

    expect(result).toEqual({ success: false, error: "storageFailed" });
    expect(loadGuestData().lists).toHaveLength(0);
  });

  it("не накапливает записи между независимыми чтениями пустого хранилища", async () => {
    storage.failOnWrite = true;
    const api = createApi();

    await api.createList({ title: "Первый" });
    await api.createList({ title: "Второй" });

    expect(loadGuestData().lists).toHaveLength(0);
  });
});

describe("loadGuestData", () => {
  it("возвращает пустое состояние, когда данных нет", () => {
    expect(loadGuestData()).toEqual({ lists: [], groups: [] });
  });

  it("возвращает пустое состояние на невалидном JSON", () => {
    storage.seedRaw(STORAGE_KEY, "{не json");

    expect(loadGuestData()).toEqual({ lists: [], groups: [] });
  });

  it("возвращает пустое состояние на структуре, не прошедшей схему", () => {
    storage.seedRaw(STORAGE_KEY, JSON.stringify({ lists: "не массив", groups: [] }));

    expect(loadGuestData()).toEqual({ lists: [], groups: [] });
  });

  it("не падает, когда localStorage недоступен", () => {
    vi.stubGlobal("localStorage", {
      getItem() {
        throw new Error("privacy mode");
      },
    });

    expect(loadGuestData()).toEqual({ lists: [], groups: [] });
  });

  it("добавляет порядок списков старым группам без потери membership", () => {
    storage.seedRaw(
      STORAGE_KEY,
      JSON.stringify({
        lists: [
          { id: "new", title: "Новый", groupIds: ["g1"], items: [] },
          { id: "old", title: "Старый", groupIds: ["g1"], items: [] },
        ],
        groups: [{ id: "g1", name: "Дом" }],
      }),
    );

    expect(loadGuestData().groups[0].listIds).toEqual(["new", "old"]);
  });
});

describe("createList", () => {
  it("добавляет новый список наверх", async () => {
    const api = createApi();
    await api.createList({ title: "Первый" });
    await api.createList({ title: "Второй" });

    expect(stored().lists.map((l) => l.title)).toEqual(["Второй", "Первый"]);
  });

  it("сообщает об обновлении данных", async () => {
    await createApi().createList({ title: "Покупки" });

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("отбивает слишком длинное название кодом tooLong", async () => {
    const result = await createApi().createList({ title: "я".repeat(51) });

    expect(result).toEqual({ success: false, error: "tooLong" });
    expect(stored().lists).toHaveLength(0);
  });

  it("привязывает список к существующей группе", async () => {
    const api = createApi();
    const group = await api.createGroup("Дом");
    await api.createList({ title: "Покупки", groupId: group.group?.id });

    expect(stored().lists[0].groupIds).toEqual([group.group?.id]);
  });

  it("не создаёт список для несуществующей группы", async () => {
    const result = await createApi().createList({
      title: "Покупки",
      groupId: "нет-такой",
    });

    expect(result).toEqual({ success: false, error: "Группа не найдена" });
    expect(stored().lists).toHaveLength(0);
  });

  it("возвращает storageFailed и не зовёт refresh, когда запись невозможна", async () => {
    storage.failOnWrite = true;

    const result = await createApi().createList({ title: "Покупки" });

    expect(result).toEqual({ success: false, error: "storageFailed" });
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("addItem", () => {
  it("добавляет запись в конец списка", async () => {
    const api = createApi();
    const list = await api.createList({ title: "Покупки" });
    const listId = list.list!.id;

    await api.addItem(listId, "Молоко");
    await api.addItem(listId, "Хлеб");

    expect(stored().lists[0].items.map((i) => i.name)).toEqual(["Молоко", "Хлеб"]);
  });

  it("создаёт запись невыполненной и с нулевой версией заметки", async () => {
    const api = createApi();
    const list = await api.createList({ title: "Покупки" });
    await api.addItem(list.list!.id, "Молоко");

    expect(stored().lists[0].items[0]).toMatchObject({
      isCompleted: false,
      note: null,
      noteVersion: 0,
    });
  });

  it("отбивает запись в несуществующий список", async () => {
    const result = await createApi().addItem("нет-такого", "Молоко");

    expect(result.success).toBe(false);
  });
});

describe("toggleItem", () => {
  it("сохраняет инверсию переданного значения, а не само значение", async () => {
    const api = createApi();
    const list = await api.createList({ title: "Покупки" });
    await api.addItem(list.list!.id, "Молоко");
    const itemId = stored().lists[0].items[0].id;

    // Контракт совпадает с Server Action toggleItem: приходит СТАРОЕ значение.
    await api.toggleItem(itemId, false);

    expect(stored().lists[0].items[0].isCompleted).toBe(true);
  });

  it("снимает отметку обратно", async () => {
    const api = createApi();
    const list = await api.createList({ title: "Покупки" });
    await api.addItem(list.list!.id, "Молоко");
    const itemId = stored().lists[0].items[0].id;

    await api.toggleItem(itemId, false);
    await api.toggleItem(itemId, true);

    expect(stored().lists[0].items[0].isCompleted).toBe(false);
  });

  it("не меняет позицию записи в массиве", async () => {
    const api = createApi();
    const list = await api.createList({ title: "Покупки" });
    for (const name of ["Молоко", "Хлеб", "Сыр"]) {
      await api.addItem(list.list!.id, name);
    }
    const middleId = stored().lists[0].items[1].id;

    await api.toggleItem(middleId, false);

    expect(stored().lists[0].items.map((i) => i.name)).toEqual([
      "Молоко",
      "Хлеб",
      "Сыр",
    ]);
  });
});

describe("moveItem", () => {
  /** Список из четырёх записей: A, B, C, D. */
  async function seedList() {
    const api = createApi();
    const list = await api.createList({ title: "Покупки" });
    for (const name of ["A", "B", "C", "D"]) {
      await api.addItem(list.list!.id, name);
    }
    const ids = Object.fromEntries(
      stored().lists[0].items.map((i) => [i.name, i.id]),
    ) as Record<string, string>;
    return { api, ids };
  }

  function order() {
    return stored().lists[0].items.map((i) => i.name);
  }

  it("двигает запись вверх между соседями", async () => {
    const { api, ids } = await seedList();

    await api.moveItem(ids.C, ids.A, ids.B);

    expect(order()).toEqual(["A", "C", "B", "D"]);
  });

  it("двигает запись вниз без смещения на единицу", async () => {
    const { api, ids } = await seedList();

    // Ветка, ради которой запись изымается из массива до поиска соседей:
    // если искать индекс соседа в массиве с самой записью, вставка съезжает.
    await api.moveItem(ids.A, ids.B, ids.C);

    expect(order()).toEqual(["B", "A", "C", "D"]);
  });

  it("ставит запись в начало, когда предыдущего соседа нет", async () => {
    const { api, ids } = await seedList();

    await api.moveItem(ids.D, null, ids.A);

    expect(order()).toEqual(["D", "A", "B", "C"]);
  });

  it("ставит запись в конец, когда следующего соседа нет", async () => {
    const { api, ids } = await seedList();

    await api.moveItem(ids.A, ids.D, null);

    expect(order()).toEqual(["B", "C", "D", "A"]);
  });

  it("возвращает stale, когда сосед исчез", async () => {
    const { api, ids } = await seedList();

    const result = await api.moveItem(ids.A, "пропавший-сосед", null);

    expect(result).toEqual({ success: false, error: "stale" });
  });

  it("не меняет порядок при stale: изъятая запись возвращается на место", async () => {
    const { api, ids } = await seedList();

    await api.moveItem(ids.A, "пропавший-сосед", null);

    // mutate не сохраняет данные при ошибке, поэтому в хранилище прежний порядок.
    expect(order()).toEqual(["A", "B", "C", "D"]);
  });

  it("перемещение на то же место сохраняет порядок", async () => {
    const { api, ids } = await seedList();

    await api.moveItem(ids.B, ids.A, ids.C);

    expect(order()).toEqual(["A", "B", "C", "D"]);
  });
});

describe("moveItemToList", () => {
  /** Два списка: исходный с записью «Молоко» и пустой целевой. */
  async function seedTwoLists() {
    const api = createApi();
    const source = await api.createList({ title: "Источник" });
    const target = await api.createList({ title: "Получатель" });
    await api.addItem(source.list!.id, "Молоко");

    const sourceId = source.list!.id;
    const targetId = target.list!.id;
    const itemId = stored().lists.find((l) => l.id === sourceId)!.items[0].id;

    return { api, sourceId, targetId, itemId };
  }

  function listById(id: string) {
    return stored().lists.find((l) => l.id === id)!;
  }

  it("переносит запись: из исходного пропадает, в целевом появляется", async () => {
    const { api, sourceId, targetId, itemId } = await seedTwoLists();

    await api.moveItemToList(itemId, targetId, "move");

    expect(listById(sourceId).items).toHaveLength(0);
    expect(listById(targetId).items.map((i) => i.name)).toEqual(["Молоко"]);
  });

  it("сохраняет ID записи при переносе", async () => {
    const { api, targetId, itemId } = await seedTwoLists();

    await api.moveItemToList(itemId, targetId, "move");

    expect(listById(targetId).items[0].id).toBe(itemId);
  });

  it("копирует запись, оставляя оригинал на месте", async () => {
    const { api, sourceId, targetId, itemId } = await seedTwoLists();

    await api.moveItemToList(itemId, targetId, "copy");

    expect(listById(sourceId).items).toHaveLength(1);
    expect(listById(targetId).items).toHaveLength(1);
  });

  it("даёт копии новый ID", async () => {
    const { api, targetId, itemId } = await seedTwoLists();

    await api.moveItemToList(itemId, targetId, "copy");

    expect(listById(targetId).items[0].id).not.toBe(itemId);
  });

  it("сбрасывает у копии отметку о выполнении и версию заметки", async () => {
    const { api, targetId, itemId } = await seedTwoLists();
    await api.toggleItem(itemId, false); // отметить выполненной
    await api.updateItemNote(itemId, "заметка", 0); // версия станет 1

    await api.moveItemToList(itemId, targetId, "copy");

    expect(listById(targetId).items[0]).toMatchObject({
      isCompleted: false,
      noteVersion: 0,
      note: "заметка",
    });
  });

  it("ставит запись в конец списка-получателя", async () => {
    const { api, targetId, itemId } = await seedTwoLists();
    await api.addItem(targetId, "Хлеб");

    await api.moveItemToList(itemId, targetId, "move");

    expect(listById(targetId).items.map((i) => i.name)).toEqual(["Хлеб", "Молоко"]);
  });

  it("отбивает перенос в тот же список кодом sameList", async () => {
    const { api, sourceId, itemId } = await seedTwoLists();

    const result = await api.moveItemToList(itemId, sourceId, "same" as never);

    expect(result.success).toBe(false);
  });

  it("отбивает перенос в несуществующий список", async () => {
    const { api, itemId } = await seedTwoLists();

    const result = await api.moveItemToList(itemId, "нет-такого", "move");

    expect(result.success).toBe(false);
  });
});

describe("заметки", () => {
  async function seedItem() {
    const api = createApi();
    const list = await api.createList({ title: "Покупки" });
    await api.addItem(list.list!.id, "Молоко");
    const itemId = stored().lists[0].items[0].id;
    return { api, listId: list.list!.id, itemId };
  }

  it("сохраняет заметку записи и поднимает версию", async () => {
    const { api, itemId } = await seedItem();

    const result = await api.updateItemNote(itemId, "купить 2 литра", 0);

    expect(result).toMatchObject({ success: true, noteVersion: 1 });
    expect(stored().lists[0].items[0].note).toBe("купить 2 литра");
  });

  it("отбивает сохранение с устаревшей версией", async () => {
    const { api, itemId } = await seedItem();
    await api.updateItemNote(itemId, "первая", 0);

    const result = await api.updateItemNote(itemId, "вторая", 0);

    expect(result).toMatchObject({ success: false, error: "noteConflict" });
    expect(stored().lists[0].items[0].note).toBe("первая");
  });

  it("не поднимает версию, когда текст не изменился", async () => {
    const { api, itemId } = await seedItem();
    await api.updateItemNote(itemId, "текст", 0);

    const result = await api.updateItemNote(itemId, "текст", 1);

    expect(result).toMatchObject({ success: true, noteVersion: 1 });
  });

  it("очищает заметку пустой строкой, сохраняя её как null", async () => {
    const { api, itemId } = await seedItem();
    await api.updateItemNote(itemId, "текст", 0);

    await api.updateItemNote(itemId, "   ", 1);

    expect(stored().lists[0].items[0].note).toBeNull();
  });

  it("сохраняет заметку списка и поднимает версию", async () => {
    const { api, listId } = await seedItem();

    const result = await api.updateListNote(listId, "общая заметка", 0);

    expect(result).toMatchObject({ success: true, noteVersion: 1 });
    expect(stored().lists[0].note).toBe("общая заметка");
  });

  it("отбивает слишком длинную заметку кодом tooLong", async () => {
    const { api, itemId } = await seedItem();

    const result = await api.updateItemNote(itemId, "я".repeat(4001), 0);

    expect(result).toMatchObject({ success: false, error: "tooLong" });
  });
});

describe("группы", () => {
  it("создаёт группы в порядке добавления", async () => {
    const api = createApi();
    await api.createGroup("Дом");
    await api.createGroup("Работа");

    expect(stored().groups.map((g) => g.name)).toEqual(["Дом", "Работа"]);
  });

  it("перемещает группу между новыми соседями", async () => {
    const api = createApi();
    const home = await api.createGroup("Дом");
    const work = await api.createGroup("Работа");
    const archive = await api.createGroup("Архив");

    const result = await api.moveGroup(
      archive.group!.id,
      null,
      home.group!.id,
    );

    expect(result).toEqual({ success: true });
    expect(stored().groups.map((group) => group.name)).toEqual([
      "Архив",
      "Дом",
      "Работа",
    ]);
    expect(work.success).toBe(true);
  });

  it("не применяет перемещение с устаревшими соседями", async () => {
    const api = createApi();
    const home = await api.createGroup("Дом");
    const work = await api.createGroup("Работа");
    await api.createGroup("Архив");

    const result = await api.moveGroup(
      work.group!.id,
      home.group!.id,
      null,
    );

    expect(result).toEqual({ success: false, error: "stale" });
    expect(stored().groups.map((group) => group.name)).toEqual([
      "Дом",
      "Работа",
      "Архив",
    ]);
  });

  it("удаление группы не удаляет списки, а только снимает связь", async () => {
    const api = createApi();
    const group = await api.createGroup("Дом");
    await api.createList({ title: "Покупки", groupId: group.group!.id });

    await api.deleteGroup(group.group!.id);

    expect(stored().lists).toHaveLength(1);
    expect(stored().lists[0].groupIds).toEqual([]);
  });

  it("не добавляет список в группу дважды", async () => {
    const api = createApi();
    const group = await api.createGroup("Дом");
    const list = await api.createList({ title: "Покупки" });

    await api.addListToGroup(list.list!.id, group.group!.id);
    await api.addListToGroup(list.list!.id, group.group!.id);

    expect(stored().lists[0].groupIds).toEqual([group.group!.id]);
    expect(stored().groups[0].listIds).toEqual([list.list!.id]);
  });

  it("хранит независимый порядок списков в пересекающихся группах", async () => {
    const api = createApi();
    const firstGroup = await api.createGroup("Первая");
    const secondGroup = await api.createGroup("Вторая");
    const first = await api.createList({ title: "A" });
    const second = await api.createList({ title: "B" });
    const third = await api.createList({ title: "C" });
    for (const list of [first, second, third]) {
      await api.addListToGroup(list.list!.id, firstGroup.group!.id);
      await api.addListToGroup(list.list!.id, secondGroup.group!.id);
    }

    const result = await api.moveListInGroup(
      firstGroup.group!.id,
      third.list!.id,
      null,
      first.list!.id,
    );

    expect(result).toEqual({ success: true });
    const groups = stored().groups;
    expect(groups.find((group) => group.id === firstGroup.group!.id)?.listIds).toEqual([
      third.list!.id,
      first.list!.id,
      second.list!.id,
    ]);
    expect(groups.find((group) => group.id === secondGroup.group!.id)?.listIds).toEqual([
      first.list!.id,
      second.list!.id,
      third.list!.id,
    ]);
  });

  it("назначение в другую группу сохраняет исходную", async () => {
    const api = createApi();
    const source = await api.createGroup("Исходная");
    const target = await api.createGroup("Целевая");
    const list = await api.createList({
      title: "Покупки",
      groupId: source.group!.id,
    });

    await api.addListToGroup(list.list!.id, target.group!.id);

    expect(stored().lists[0].groupIds).toEqual([
      source.group!.id,
      target.group!.id,
    ]);
  });

  it("отбивает добавление в несуществующую группу", async () => {
    const api = createApi();
    const list = await api.createList({ title: "Покупки" });

    const result = await api.addListToGroup(list.list!.id, "нет-такой");

    expect(result.success).toBe(false);
  });
});

describe("удаление", () => {
  it("удаляет список вместе с его записями", async () => {
    const api = createApi();
    const list = await api.createList({ title: "Покупки" });
    await api.addItem(list.list!.id, "Молоко");

    await api.deleteList(list.list!.id);

    expect(stored().lists).toHaveLength(0);
  });

  it("отбивает удаление несуществующего списка", async () => {
    const result = await createApi().deleteList("нет-такого");

    expect(result.success).toBe(false);
  });

  it("удаляет запись, не трогая соседей", async () => {
    const api = createApi();
    const list = await api.createList({ title: "Покупки" });
    for (const name of ["A", "B", "C"]) {
      await api.addItem(list.list!.id, name);
    }
    const bId = stored().lists[0].items[1].id;

    await api.deleteItem(bId);

    expect(stored().lists[0].items.map((i) => i.name)).toEqual(["A", "C"]);
  });
});

describe("toListData", () => {
  it("подставляет гостя владельцем и автором записи", async () => {
    const api = createApi();
    const list = await api.createList({ title: "Покупки" });
    await api.addItem(list.list!.id, "Молоко");

    const [listData] = toListData(stored(), GUEST_NAME);

    expect(listData.ownerId).toBe(GUEST_USER_ID);
    expect(listData.owner.name).toBe(GUEST_NAME);
    expect(listData.items[0].addedBy).toMatchObject({ id: GUEST_USER_ID });
  });

  it("отдаёт пустые шаринг и вложения: гостю они недоступны", async () => {
    await createApi().createList({ title: "Покупки" });

    const [listData] = toListData(stored(), GUEST_NAME);

    expect(listData.sharedWith).toEqual([]);
    expect(listData.files).toEqual([]);
  });

  it("резолвит группы списка в объекты с именами", async () => {
    const api = createApi();
    const group = await api.createGroup("Дом");
    await api.createList({ title: "Покупки", groupId: group.group!.id });

    const [listData] = toListData(stored(), GUEST_NAME);

    expect(listData.groups).toEqual([
      { id: group.group!.id, name: "Дом", position: 1 },
    ]);
  });

  it("подставляет нулевую версию заметки, когда поля нет в хранилище", () => {
    // Данные, записанные до появления заметок: полей note/noteVersion нет.
    storage.seedRaw(
      STORAGE_KEY,
      JSON.stringify({
        lists: [{ id: "l1", title: "Старый", groupIds: [], items: [{ id: "i1", name: "A", isCompleted: false }] }],
        groups: [],
      }),
    );

    const [listData] = toListData(stored(), GUEST_NAME);

    expect(listData.noteVersion).toBe(0);
    expect(listData.note).toBeNull();
    expect(listData.items[0].noteVersion).toBe(0);
  });
});

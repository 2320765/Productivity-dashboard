import assert from "node:assert/strict";
import test from "node:test";
import { EMPTY_TASK_FILTERS, activeFilterLabels, filterTasks, getTaskSearchRows, sortTasks, sortIndicator } from "./taskFilters.js";

const today = "2026-10-25";
const tasks = [
  { id: "a", title: "Написать план", notes: "Работа над запуском", date: "2026-10-20", time: "09:00", deadline: "", priority: "Высокий", status: "К выполнению", goalId: "g1" },
  { id: "b", title: "Покупки", notes: "", date: "2026-10-21", time: "", deadline: "2026-10-22", priority: "Низкий", status: "В процессе", goalId: null },
  { id: "c", title: "Отчёт", notes: "Отправить клиенту", date: "2026-10-24", time: "12:00", deadline: "2026-10-30", priority: "Средний", status: "Выполнено", goalId: "g2" },
  { id: "d", title: "План на будущее", notes: "", date: "2026-11-02", time: "", deadline: "", priority: "Средний", status: "К выполнению", goalId: "g1" },
];
const goals = [{ id: "g1", title: "Запуск" }, { id: "g2", title: "Отчётность" }];
const range = { start: "2026-10-24", end: "2026-10-25" };

test("сочетает статус, приоритет, цель, срок и поиск по заметкам", () => {
  const result = filterTasks(tasks, { ...EMPTY_TASK_FILTERS, dateScope: "all", status: "active", priority: "Высокий", goalId: "g1", deadline: "without" }, goals, today, "запуск");
  assert.deepEqual(result.map((task) => task.id), ["a"]);
  assert.deepEqual(filterTasks(tasks, { ...EMPTY_TASK_FILTERS, dateScope: "all" }, goals, today, "клиенту").map((task) => task.id), ["c"]);
});

test("активные, выполненные, просроченные и отсутствие срока", () => {
  assert.deepEqual(filterTasks(tasks, { ...EMPTY_TASK_FILTERS, status: "active", dateScope: "all" }, goals, today).map((task) => task.id), ["a", "b", "d"]);
  assert.deepEqual(filterTasks(tasks, { ...EMPTY_TASK_FILTERS, status: "completed", dateScope: "all" }, goals, today).map((task) => task.id), ["c"]);
  assert.deepEqual(filterTasks(tasks, { ...EMPTY_TASK_FILTERS, status: "overdue", dateScope: "all" }, goals, today).map((task) => task.id), ["a", "b"]);
  assert.deepEqual(filterTasks(tasks, { ...EMPTY_TASK_FILTERS, deadline: "without", dateScope: "all" }, goals, today).map((task) => task.id), ["a", "d"]);
});

test("фильтр периода и всех дат, включая все обычные задачи и ограниченный горизонт повторов", () => {
  assert.deepEqual(getTaskSearchRows(tasks, range, "period", today).map((task) => task.id), ["a", "b", "c"]);
  assert.deepEqual(getTaskSearchRows(tasks, range, "period", "2026-10-10").map((task) => task.id), ["c"]);
  assert.deepEqual(getTaskSearchRows(tasks, range, "all", today).map((task) => task.id).sort(), ["a", "b", "c", "d"]);
  const oldRecurring = { ...tasks[0], id: "repeat", date: "2020-01-01", recurrence: { unit: "day", interval: 1, weekdays: [], until: "", overrides: {}, moves: {} } };
  const repeated = getTaskSearchRows([oldRecurring], range, "all", today);
  assert.ok(repeated.length < 370);
  assert.equal(repeated[0].date, "2025-10-25");
});

test("сортировка по дате, названию, приоритету и статусу в обе стороны", () => {
  const asc = sortTasks(tasks, { key: "priority", direction: "asc" });
  const desc = sortTasks(tasks, { key: "priority", direction: "desc" });
  assert.equal(asc[0].priority, "Высокий");
  assert.equal(desc[0].priority, "Низкий");
  assert.equal(sortTasks(tasks, { key: "status", direction: "asc" })[0].status, "К выполнению");
  assert.equal(sortTasks(tasks, { key: "title", direction: "asc" })[0].title, "Написать план");
  assert.equal(sortTasks(tasks, { key: "date", direction: "desc" })[0].id, "d");
  assert.equal(sortIndicator({ key: "date", direction: "desc" }, "date"), "↓");
  assert.equal(sortIndicator({ key: "date", direction: "desc" }, "title"), "↕");
});

test("показывает подписи активных фильтров и различает пустые результаты от отсутствия задач", () => {
  const filters = { ...EMPTY_TASK_FILTERS, status: "overdue", priority: "Высокий", goalId: "g1", deadline: "without", dateScope: "all" };
  assert.deepEqual(activeFilterLabels(filters, goals).map((item) => item.text), ["Просроченные", "Приоритет: Высокий", "Цель: Запуск", "Без срока", "Все даты (повторы за год)"]);
  assert.equal(filterTasks([], EMPTY_TASK_FILTERS, goals, today).length, 0);
  assert.equal(filterTasks(tasks, { ...EMPTY_TASK_FILTERS, priority: "Высокий", status: "completed" }, goals, today).length, 0);
});

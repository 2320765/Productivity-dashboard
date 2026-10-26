import assert from "node:assert/strict";
import test from "node:test";
import { getResultTarget, goalStatus, isArchived, searchRecords, setArchived, splitArchived } from "./archive.js";
import { getAnalytics } from "./analytics.js";
import { getGoalProgress } from "./dashboard.js";
import { getOverdueTasks } from "./reschedule.js";
import { filterTasks, getTaskSearchRows, EMPTY_TASK_FILTERS } from "./taskFilters.js";

const goals = [
  { id: "g1", title: "Запуск сайта", period: "month", startDate: "2026-10-01", endDate: "2026-10-31", parentId: null, priority: "Высокий", notes: "Главная цель осени" },
  { id: "g2", title: "Старая цель", period: "month", startDate: "2026-03-01", endDate: "2026-03-31", parentId: null, priority: "Средний", notes: "", archivedAt: "2026-04-02T10:00:00.000Z" },
];
const tasks = [
  { id: "t1", title: "Написать текст", category: "Работа", date: "2026-10-20", time: "", deadline: "", priority: "Средний", status: "Выполнено", notes: "Ёлка и баннер", goalId: "g1" },
  { id: "t2", title: "Проверить форму", category: "Работа", date: "2026-10-21", time: "", deadline: "", priority: "Средний", status: "К выполнению", notes: "", goalId: "g1", archivedAt: "2026-10-22T08:00:00.000Z" },
  { id: "t3", title: "Купить лампу", category: "Личное", date: "2026-03-10", time: "", deadline: "", priority: "Низкий", status: "Выполнено", notes: "для кабинета", goalId: "g2", archivedAt: "2026-04-01T08:00:00.000Z" },
];
const dashboard = { goals, tasks };

test("архивация и восстановление меняют только archivedAt и не удаляют запись", () => {
  const archived = setArchived(dashboard, "task", "t1", true, "2026-10-26T10:00:00.000Z");
  assert.equal(archived.tasks.length, tasks.length);
  assert.equal(archived.tasks.find((task) => task.id === "t1").archivedAt, "2026-10-26T10:00:00.000Z");
  assert.equal(dashboard.tasks.find((task) => task.id === "t1").archivedAt, undefined);
  const restored = setArchived(archived, "task", "t1", false);
  assert.deepEqual(restored.tasks.find((task) => task.id === "t1"), tasks[0]);
  assert.equal(isArchived(restored.tasks.find((task) => task.id === "t1")), false);

  const goalArchived = setArchived(dashboard, "goal", "g1", true, "2026-10-26T10:00:00.000Z");
  assert.equal(goalArchived.goals.length, goals.length);
  assert.equal(splitArchived(goalArchived.goals).archived.length, 2);
  assert.deepEqual(setArchived(goalArchived, "goal", "g1", false).goals[0], goals[0]);
});

test("повторная архивация не меняет дату архивации", () => {
  const again = setArchived(dashboard, "task", "t2", true, "2027-01-01T00:00:00.000Z");
  assert.equal(again.tasks.find((task) => task.id === "t2").archivedAt, "2026-10-22T08:00:00.000Z");
});

test("архивные записи не попадают в обычный список, просрочку и фильтры", () => {
  const { live } = splitArchived(tasks);
  assert.deepEqual(live.map((task) => task.id), ["t1"]);
  const rows = getTaskSearchRows(live, { start: "2026-10-01", end: "2026-10-31" }, "period", "2026-10-26");
  assert.deepEqual(filterTasks(rows, EMPTY_TASK_FILTERS, goals, "2026-10-26").map((task) => task.id), ["t1"]);
  assert.deepEqual(getOverdueTasks(live, "2026-10-26"), []);
  assert.equal(getOverdueTasks(tasks, "2026-10-26").length, 1);
});

test("прогресс цели и историческая статистика учитывают архивные задачи", () => {
  assert.deepEqual(getGoalProgress("g1", goals, tasks), { completed: 1, total: 2, percent: 50 });
  const month = getAnalytics(tasks, goals, "2026-10-21", "month", "2026-10-26");
  assert.equal(month.planned, 2);
  assert.equal(month.completed, 1);
  const march = getAnalytics(tasks, goals, "2026-03-15", "month", "2026-10-26");
  assert.equal(march.planned, 1);
  assert.equal(march.completed, 1);
  assert.equal(goalStatus(goals[1], goals, tasks), "Выполнено");
  assert.equal(goalStatus(goals[0], goals, tasks), "В процессе");
});

test("поиск находит задачи и цели по названию и заметкам, слова в любом порядке, ё = е", () => {
  const byTitle = searchRecords(dashboard, "форму проверить");
  assert.deepEqual(byTitle.map((row) => row.key), ["task:t2"]);
  assert.deepEqual(searchRecords(dashboard, "елка").map((row) => row.key), ["task:t1"]);
  assert.deepEqual(searchRecords(dashboard, "осени").map((row) => [row.key, row.type]), [["goal:g1", "goal"]]);
  assert.deepEqual(searchRecords(dashboard, "кабинета").map((row) => row.key), ["task:t3"]);
  assert.deepEqual(searchRecords(dashboard, "несуществует"), []);
});

test("результат содержит тип, статус, дату и связанную цель", () => {
  const [row] = searchRecords(dashboard, "Написать");
  assert.equal(row.type, "task");
  assert.equal(row.status, "Выполнено");
  assert.equal(row.date, "2026-10-20");
  assert.equal(row.goalTitle, "Запуск сайта");
  assert.equal(row.archived, false);
});

test("область поиска: обычные, архивные, все; архив не смешивается с обычным списком", () => {
  const active = searchRecords(dashboard, "", { scope: "active" });
  assert.ok(active.every((row) => !row.archived));
  assert.deepEqual(active.map((row) => row.key).sort(), ["goal:g1", "task:t1"]);
  const archived = searchRecords(dashboard, "", { scope: "archived" });
  assert.deepEqual(archived.map((row) => row.key).sort(), ["goal:g2", "task:t2", "task:t3"]);
  assert.equal(searchRecords(dashboard, "", { scope: "all" }).length, 5);
});

test("фильтры архива по статусу, типу и датам", () => {
  assert.deepEqual(searchRecords(dashboard, "", { scope: "archived", status: "Выполнено" }).map((row) => row.key).sort(), ["goal:g2", "task:t3"]);
  assert.deepEqual(searchRecords(dashboard, "", { scope: "archived", type: "goal" }).map((row) => row.key), ["goal:g2"]);
  assert.deepEqual(searchRecords(dashboard, "", { scope: "archived", from: "2026-10-01", to: "2026-10-31" }).map((row) => row.key), ["task:t2"]);
  assert.deepEqual(searchRecords(dashboard, "", { scope: "archived", dateBy: "archived", from: "2026-04-01", to: "2026-04-30" }).map((row) => row.key).sort(), ["goal:g2", "task:t3"]);
  assert.deepEqual(searchRecords(dashboard, "лампу", { scope: "archived", status: "К выполнению" }), []);
});

test("выбор результата открывает нужный период и вкладку", () => {
  const [archivedTask] = searchRecords(dashboard, "Проверить");
  assert.deepEqual(getResultTarget(archivedTask), { selectedDate: "2026-10-21", layout: "archive", highlightKey: "task:t2" });
  const [liveTask] = searchRecords(dashboard, "Написать");
  assert.deepEqual(getResultTarget(liveTask), { selectedDate: "2026-10-20", layout: "table", highlightKey: "task:t1" });
  const [goal] = searchRecords(dashboard, "Запуск");
  assert.equal(getResultTarget(goal).selectedDate, "2026-10-01");
});

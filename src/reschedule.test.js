import assert from "node:assert/strict";
import test from "node:test";
import { applyChanges, getNextWeekStart, getOverdueTasks, getTomorrow, isOverdue, planReschedule, revertChanges } from "./reschedule.js";
import { expandTasks } from "./recurrence.js";

const today = "2026-10-25"; // воскресенье
const base = { category: "Работа", time: "", deadline: "", priority: "Средний", status: "К выполнению", notes: "", goalId: null };
const tasks = [
  { ...base, id: "old", title: "Старая", date: "2026-10-20" },
  { ...base, id: "done", title: "Готово", date: "2026-10-20", status: "Выполнено" },
  { ...base, id: "today", title: "Сегодня", date: today },
  { ...base, id: "dl", title: "Дедлайн", date: "2026-10-30", deadline: "2026-10-22T18:00" },
  { ...base, id: "goal", title: "С целью", date: "2026-10-21", goalId: "g1" },
  { ...base, id: "daily", title: "Ежедневная", date: "2026-10-20", recurrence: { unit: "day", interval: 1, weekdays: [], until: "", overrides: { "2026-10-22": "Выполнено" } } },
];
const goals = [{ id: "g1", startDate: "2026-10-01", endDate: "2026-10-31" }];

test("просроченные: без выполненных и сегодняшних, повторы считаются по экземплярам", () => {
  assert.equal(isOverdue(tasks[2], today), false);
  assert.equal(isOverdue(tasks[1], today), false);
  assert.equal(isOverdue(tasks[3], today), true);
  const keys = getOverdueTasks(tasks, today).map((task) => `${task.id}:${task.occurrenceDate ?? ""}`);
  assert.ok(keys.includes("old:") && keys.includes("dl:") && keys.includes("goal:"));
  assert.ok(!keys.includes("done:") && !keys.includes("today:"));
  assert.ok(keys.includes("daily:2026-10-24") && !keys.includes("daily:2026-10-22") && !keys.includes("daily:2026-10-25"));
});

test("быстрые даты: завтра и понедельник следующей недели", () => {
  assert.equal(getTomorrow(today), "2026-10-26");
  assert.equal(getNextWeekStart(today), "2026-10-26");
  assert.equal(getNextWeekStart("2026-10-26"), "2026-11-02");
  assert.equal(getNextWeekStart("2026-10-28"), "2026-11-02");
});

test("перенос меняет существующую задачу и хранит историю", () => {
  const { changes } = planReschedule(tasks, [tasks[0]], "2026-10-26", goals, "NOW");
  assert.equal(changes.length, 1);
  const next = applyChanges(tasks, changes);
  assert.equal(next.length, tasks.length);
  const moved = next.find((task) => task.id === "old");
  assert.deepEqual([moved.date, moved.movedFrom, moved.movedAt, moved.moveCount], ["2026-10-26", "2026-10-20", "NOW", 1]);
  assert.equal(next.find((task) => task.id === "today"), tasks[2]);
});

test("дедлайн сдвигается, только если оказался раньше новой даты; задача без изменения даты пропускается", () => {
  const { changes } = planReschedule(tasks, [tasks[3], tasks[2]], "2026-10-26", goals);
  assert.equal(changes.length, 2);
  assert.equal(changes[0].after.deadline, "2026-10-26T18:00");
  assert.equal(planReschedule(tasks, [tasks[2]], today, goals).changes.length, 0);
});

test("цель вне нового срока отвязывается и учитывается в плане", () => {
  const plan = planReschedule(tasks, [tasks[4]], "2026-11-02", goals);
  assert.equal(plan.goalUnlinks, 1);
  assert.equal(plan.changes[0].after.goalId, null);
});

test("повтор: переносится только выбранный экземпляр, правило не меняется", () => {
  const instance = expandTasks(tasks, "2026-10-24", "2026-10-24")[0];
  const { changes } = planReschedule(tasks, [instance], "2026-10-26", goals);
  const series = applyChanges(tasks, changes).find((task) => task.id === "daily");
  assert.equal(series.date, "2026-10-20");
  assert.deepEqual([series.recurrence.unit, series.recurrence.interval], ["day", 1]);
  const days = expandTasks([series], "2026-10-23", "2026-10-27").map((task) => `${task.occurrenceDate}>${task.date}`);
  assert.ok(!days.includes("2026-10-24>2026-10-24"));
  assert.ok(days.includes("2026-10-24>2026-10-26"));
  assert.ok(days.includes("2026-10-26>2026-10-26"));
  assert.equal(series.recurrence.overrides["2026-10-22"], "Выполнено");
  assert.ok(!getOverdueTasks([series], today).some((task) => task.occurrenceDate === "2026-10-24"));
});

test("несколько экземпляров одной серии и отмена возвращают исходные данные", () => {
  const instances = expandTasks(tasks, "2026-10-23", "2026-10-24");
  const { changes } = planReschedule(tasks, instances, "2026-10-26", goals);
  const series = applyChanges(tasks, changes).find((task) => task.id === "daily");
  assert.deepEqual(Object.keys(series.recurrence.moves).sort(), ["2026-10-23", "2026-10-24"]);
  assert.deepEqual(revertChanges(applyChanges(tasks, changes), changes), tasks);
});

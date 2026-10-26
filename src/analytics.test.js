import assert from "node:assert/strict";
import test from "node:test";
import { getAnalytics, getAnalyticsComparison } from "./analytics.js";

const task = (id, date, overrides = {}) => ({
  id, title: id, date, deadline: "", time: "", priority: "Средний",
  status: "К выполнению", goalId: null, ...overrides,
});
const noGoals = [];

test("пустая неделя возвращает нулевые показатели и семь локальных дат", () => {
  const result = getAnalytics([], noGoals, "2026-10-21", "week", "2026-10-25");
  assert.deepEqual(result.range, { start: "2026-10-19", end: "2026-10-25" });
  assert.equal(result.planned, 0);
  assert.equal(result.completed, 0);
  assert.equal(result.percent, 0);
  assert.equal(result.overdue, 0);
  assert.equal(result.days.length, 7);
  assert.equal(result.days.reduce((sum, day) => sum + day.planned, 0), 0);
});

test("год группирует задачи по 12 месяцам и сравнивается с прошлым годом", () => {
  const tasks = [
    task("a", "2026-01-10", { status: "Выполнено" }),
    task("b", "2026-10-21"),
    task("c", "2026-10-30"),
    task("old", "2025-05-05"),
  ];
  const result = getAnalytics(tasks, noGoals, "2026-10-21", "year", "2026-10-25");
  assert.deepEqual(result.range, { start: "2026-01-01", end: "2026-12-31" });
  assert.equal(result.days.length, 12);
  assert.equal(result.days[9].planned, 2);
  assert.equal(result.days[0].completed, 1);
  assert.equal(result.planned, 3);
  const comparison = getAnalyticsComparison(tasks, noGoals, "2026-10-21", "year", "2026-10-25");
  assert.equal(comparison.previous.planned, 1);
  assert.equal(comparison.available, true);
});

test("неделя считает выполненные, активные просроченные, переносы и цели без дублирования", () => {
  const tasks = [
    task("done", "2026-10-19", { status: "Выполнено", goalId: "g" }),
    task("late", "2026-10-20", { goalId: "g" }),
    task("deadline-late", "2026-10-21", { deadline: "2026-10-22", movedAt: "2026-10-23T12:00:00Z", movedFrom: "2026-10-20", moveCount: 2 }),
    task("future", "2026-10-25"),
    task("outside", "2026-10-26"),
  ];
  const goals = [{ id: "g", startDate: "2026-10-01", endDate: "2026-10-31" }];
  const result = getAnalytics(tasks, goals, "2026-10-21", "week", "2026-10-25");
  assert.equal(result.planned, 4);
  assert.equal(result.completed, 1);
  assert.equal(result.percent, 25);
  assert.equal(result.overdue, 2);
  assert.equal(result.moved, 1);
  assert.deepEqual([result.goals.count, result.goals.withTasks, result.goals.planned, result.goals.completed, result.goals.percent], [1, 1, 2, 1, 50]);
  assert.equal(result.days.reduce((sum, day) => sum + day.planned, 0), result.planned);
});

test("повторяющиеся задачи считаются по экземплярам; выполненность и переносы только внутри периода", () => {
  const series = task("repeat", "2026-10-01", {
    recurrence: {
      unit: "day", interval: 1, weekdays: [], until: "2026-10-31",
      overrides: { "2026-10-19": "Выполнено" },
      moves: { "2026-10-20": "2026-10-21" },
    },
  });
  const result = getAnalytics([series], [], "2026-10-21", "week", "2026-10-25");
  assert.equal(result.planned, 7);
  assert.equal(result.completed, 1);
  assert.equal(result.moved, 1);
  assert.equal(result.days.find((day) => day.date === "2026-10-20").planned, 0);
  assert.equal(result.days.find((day) => day.date === "2026-10-21").planned, 2);
});

test("месячная граница и сравнение с предыдущим календарным месяцем корректны", () => {
  const tasks = [
    task("sep-done", "2026-09-30", { status: "Выполнено" }),
    task("oct-done", "2026-10-01", { status: "Выполнено" }),
    task("oct-active", "2026-10-31"),
    task("nov", "2026-11-01"),
  ];
  const comparison = getAnalyticsComparison(tasks, [], "2026-10-31", "month", "2026-11-02");
  assert.deepEqual(comparison.current.range, { start: "2026-10-01", end: "2026-10-31" });
  assert.deepEqual(comparison.previous.range, { start: "2026-09-01", end: "2026-09-30" });
  assert.equal(comparison.current.planned, 2);
  assert.equal(comparison.current.completed, 1);
  assert.equal(comparison.current.percent, 50);
  assert.equal(comparison.previous.planned, 1);
  assert.equal(comparison.previous.percent, 100);
  assert.equal(comparison.available, true);
  assert.equal(comparison.percentDelta, -50);
  assert.equal(comparison.current.days.length, 31);
});

test("сравнение не показывает выводы при отсутствии предыдущих данных", () => {
  const result = getAnalyticsComparison([task("now", "2026-10-26")], [], "2026-10-26", "week", "2026-10-26");
  assert.equal(result.available, false);
  assert.equal(result.previous.planned, 0);
});

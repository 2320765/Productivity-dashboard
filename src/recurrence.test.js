import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRecurrence, describeRecurrence, expandTask, normalizeRecurrence, occursOn,
  setOccurrenceStatus, stopRecurrenceAfter,
} from "./recurrence.js";

const base = { id: "t1", title: "Зарядка", date: "2026-01-29", status: "К выполнению", goalId: null };
const dates = (items) => items.map((item) => item.date);

test("daily recurrence crosses month and year boundaries", () => {
  const task = { ...base, date: "2026-12-30", recurrence: { unit: "day", interval: 1 } };
  assert.deepEqual(dates(expandTask(task, "2026-12-29", "2027-01-02")), ["2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02"]);
});

test("custom day interval counts from the start date", () => {
  const task = { ...base, date: "2026-02-26", recurrence: { unit: "day", interval: 3 } };
  assert.deepEqual(dates(expandTask(task, "2026-02-01", "2026-03-10")), ["2026-02-26", "2026-03-01", "2026-03-04", "2026-03-07", "2026-03-10"]);
});

test("weekly recurrence repeats on the start weekday and by selected weekdays", () => {
  const weekly = { ...base, date: "2026-10-26", recurrence: { unit: "week", interval: 1 } };
  assert.deepEqual(dates(expandTask(weekly, "2026-10-01", "2026-11-30")), ["2026-10-26", "2026-11-02", "2026-11-09", "2026-11-16", "2026-11-23", "2026-11-30"]);
  const selected = { ...base, date: "2026-10-27", recurrence: { unit: "week", interval: 1, weekdays: [5, 1] } };
  assert.deepEqual(dates(expandTask(selected, "2026-10-26", "2026-11-08")), ["2026-10-30", "2026-11-02", "2026-11-06"]);
});

test("every second week uses weeks counted from the start week", () => {
  const task = { ...base, date: "2026-10-28", recurrence: { unit: "week", interval: 2, weekdays: [1, 3] } };
  assert.deepEqual(dates(expandTask(task, "2026-10-01", "2026-11-20")), ["2026-10-28", "2026-11-09", "2026-11-11"]);
});

test("monthly recurrence clamps short months without drifting", () => {
  const task = { ...base, date: "2026-01-31", recurrence: { unit: "month", interval: 1 } };
  assert.deepEqual(dates(expandTask(task, "2026-01-01", "2026-04-30")), ["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
  assert.deepEqual(dates(expandTask(task, "2028-02-01", "2028-02-29")), ["2028-02-29"]);
  assert.equal(occursOn(normalizeRecurrence(task.recurrence), task.date, "2026-02-27"), false);
});

test("until date ends the series and tasks before start are not shown", () => {
  const task = { ...base, date: "2026-03-10", recurrence: { unit: "day", interval: 1, until: "2026-03-12" } };
  assert.deepEqual(dates(expandTask(task, "2026-03-01", "2026-03-31")), ["2026-03-10", "2026-03-11", "2026-03-12"]);
});

test("completing one occurrence does not complete the others", () => {
  let task = { ...base, date: "2026-10-26", recurrence: { unit: "day", interval: 1 } };
  task = setOccurrenceStatus(task, "2026-10-27", "Выполнено");
  const statuses = expandTask(task, "2026-10-26", "2026-10-28").map((item) => item.status);
  assert.deepEqual(statuses, ["К выполнению", "Выполнено", "К выполнению"]);
  task = setOccurrenceStatus(task, "2026-10-27", "К выполнению");
  assert.deepEqual(task.recurrence.overrides, {});
});

test("stopping the series keeps past and current occurrences only", () => {
  const task = stopRecurrenceAfter({ ...base, date: "2026-10-26", recurrence: { unit: "day", interval: 1 } }, "2026-10-28");
  assert.deepEqual(dates(expandTask(task, "2026-10-26", "2026-11-05")), ["2026-10-26", "2026-10-27", "2026-10-28"]);
});

test("editing the rule keeps statuses only for dates that still occur", () => {
  const source = { unit: "day", interval: 1, overrides: { "2026-10-26": "Выполнено", "2026-10-27": "Выполнено" } };
  const { rule } = buildRecurrence({ preset: "custom", unit: "day", interval: 2, weekdays: [], until: "" }, "2026-10-26", source);
  assert.deepEqual(rule.overrides, { "2026-10-26": "Выполнено" });
});

test("validation errors and descriptions", () => {
  assert.ok(buildRecurrence({ preset: "weekdays", weekdays: [], until: "" }, "2026-10-26").error);
  assert.ok(buildRecurrence({ preset: "custom", unit: "day", interval: 0, weekdays: [], until: "" }, "2026-10-26").error);
  assert.ok(buildRecurrence({ preset: "daily", weekdays: [], until: "2026-10-01" }, "2026-10-26").error);
  assert.equal(buildRecurrence({ preset: "none" }, "2026-10-26").rule, null);
  assert.equal(describeRecurrence({ unit: "week", interval: 1, weekdays: [1, 3] }, "2026-10-26"), "Еженедельно: пн, ср");
  assert.equal(describeRecurrence({ unit: "month", interval: 1, until: "2027-01-01" }, "2026-10-31"), "Каждый месяц, 31-го · до 2027-01-01");
  assert.equal(describeRecurrence({ unit: "day", interval: 1 }, "2026-10-26"), "Каждый день");
});

test("non-recurring tasks are filtered by range as before", () => {
  assert.deepEqual(dates(expandTask(base, "2026-01-01", "2026-01-31")), ["2026-01-29"]);
  assert.deepEqual(expandTask(base, "2026-02-01", "2026-02-28"), []);
});

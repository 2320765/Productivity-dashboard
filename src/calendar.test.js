import assert from "node:assert/strict";
import test from "node:test";
import { findConflicts, getCalendarRange, getMonthWeeks, groupByHour, hasTime, shiftCalendar, splitDayTasks } from "./calendar.js";

const task = (id, time, title = id) => ({ id, title, time, date: "2026-10-26" });

test("splits timed and untimed tasks and sorts by time", () => {
  const { timed, untimed } = splitDayTasks([task("b", "14:30"), task("c", ""), task("a", "09:00"), task("d", undefined)]);
  assert.deepEqual(timed.map((item) => item.id), ["a", "b"]);
  assert.deepEqual(untimed.map((item) => item.id), ["c", "d"]);
  assert.equal(hasTime({ time: "24:00" }), false);
});

test("same start time marks both tasks as a conflict without hiding either", () => {
  const items = [task("a", "10:00"), task("b", "10:00"), task("c", "11:00")];
  const conflicts = findConflicts(items);
  assert.deepEqual(items.filter((item) => conflicts.has(item)).map((item) => item.id), ["a", "b"]);
  assert.equal(groupByHour(items).get(10).length, 2);
});

test("month grid starts on Monday, ends on Sunday and covers whole month", () => {
  const weeks = getMonthWeeks("2026-10-15");
  assert.equal(weeks[0][0], "2026-09-28");
  assert.equal(weeks.at(-1).at(-1), "2026-11-01");
  assert.ok(weeks.every((week) => week.length === 7));
  assert.deepEqual(getCalendarRange("2026-10-15", "week"), { start: "2026-10-12", end: "2026-10-18" });
});

test("navigation moves by day, week and month and clamps short months", () => {
  assert.equal(shiftCalendar("2026-12-31", "day", 1), "2027-01-01");
  assert.equal(shiftCalendar("2026-10-26", "week", -1), "2026-10-19");
  assert.equal(shiftCalendar("2026-01-31", "month", 1), "2026-02-28");
  assert.equal(shiftCalendar("2026-12-15", "month", 1), "2027-01-15");
  assert.equal(shiftCalendar("2026-03-31", "month", -1), "2026-02-28");
});

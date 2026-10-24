import assert from "node:assert/strict";
import test from "node:test";
import { buildWorkspaceProgress } from "./workspaceProgress.js";

const range = { start: "2026-10-19", end: "2026-10-25" };

function records(overrides = {}) {
  return {
    goals: [],
    tasks: [],
    members: [],
    ...overrides,
  };
}

test("empty spaces and empty periods return zeroed progress", () => {
  assert.deepEqual(buildWorkspaceProgress(records(), range, new Date("2026-10-24T12:00:00")), {
    total: 0,
    completed: 0,
    active: 0,
    overdue: 0,
    pending: 0,
    percent: 0,
    goals: [],
    assignees: [],
    upcoming: [],
  });
});

test("counts unique shared tasks once and assigns mutually exclusive status buckets", () => {
  const tasks = [
    { id: "done", date: "2026-10-20", status: "Выполнено", assigneeId: "a" },
    { id: "active", date: "2026-10-24", time: "23:59", status: "В процессе", assigneeId: "b" },
    { id: "late", date: "2026-10-22", time: "09:00", status: "В процессе", assigneeId: "b" },
    { id: "pending", date: "2026-10-24", status: "К выполнению", assigneeId: null },
    { id: "active", date: "2026-10-24", status: "В процессе", assigneeId: "b" },
    { id: "archived", date: "2026-10-20", status: "К выполнению", archivedAt: "2026-10-22T10:00:00" },
    { id: "outside", date: "2026-10-26", status: "Выполнено" },
  ];
  const result = buildWorkspaceProgress(records({
    tasks,
    members: [{ userId: "a", name: "Алия" }, { userId: "b", name: "Бек" }],
  }), range, new Date("2026-10-24T12:00:00"));

  assert.deepEqual(
    { total: result.total, completed: result.completed, active: result.active, overdue: result.overdue, pending: result.pending, percent: result.percent },
    { total: 4, completed: 1, active: 1, overdue: 1, pending: 1, percent: 25 },
  );
  assert.deepEqual(result.assignees.map(({ name, count }) => [name, count]), [["Бек", 2], ["Алия", 1], ["Не назначен", 1]]);
});

test("goal progress includes only active shared goals and excludes archived tasks", () => {
  const result = buildWorkspaceProgress(records({
    goals: [
      { id: "goal", title: "Общая цель", period: "week", startDate: "2026-10-19", endDate: "2026-10-25" },
      { id: "archived-goal", title: "Скрытая цель", startDate: "2026-10-19", endDate: "2026-10-25", archivedAt: "2026-10-21T10:00:00" },
    ],
    tasks: [
      { id: "done", date: "2026-10-20", status: "Выполнено", goalId: "goal" },
      { id: "archived-task", date: "2026-10-21", status: "Выполнено", goalId: "goal", archivedAt: "2026-10-22T10:00:00" },
    ],
  }), range, new Date("2026-10-24T12:00:00"));

  assert.equal(result.goals.length, 1);
  assert.deepEqual(result.goals[0].progress, { completed: 1, total: 1, percent: 100 });
});

test("upcoming deadlines use local date and time and stay within the selected range", () => {
  const result = buildWorkspaceProgress(records({
    tasks: [
      { id: "soon", title: "Скоро", date: "2026-10-24", deadline: "2026-10-24T13:30", status: "К выполнению" },
      { id: "past", title: "Уже прошло", date: "2026-10-24", deadline: "2026-10-24T10:30", status: "К выполнению" },
      { id: "outside", title: "Другой период", date: "2026-10-26", deadline: "2026-10-26T15:00", status: "К выполнению" },
    ],
  }), range, new Date("2026-10-24T12:00:00"));

  assert.deepEqual(result.upcoming.map(({ task }) => task.id), ["soon"]);
});

test("period changes filter tasks and overlapping goals against the provided range", () => {
  const data = records({
    goals: [{ id: "october", startDate: "2026-10-01", endDate: "2026-10-31" }],
    tasks: [
      { id: "october-task", date: "2026-10-24", status: "Выполнено" },
      { id: "november-task", date: "2026-11-02", status: "Выполнено" },
    ],
  });

  const october = buildWorkspaceProgress(data, range, new Date("2026-10-24T12:00:00"));
  const november = buildWorkspaceProgress(data, { start: "2026-11-01", end: "2026-11-30" }, new Date("2026-10-24T12:00:00"));
  assert.equal(october.total, 1);
  assert.equal(october.goals.length, 1);
  assert.equal(november.total, 1);
  assert.equal(november.goals.length, 0);
});

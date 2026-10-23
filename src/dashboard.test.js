import assert from "node:assert/strict";
import test from "node:test";
import {
  getGoalProgress,
  getPeriodRange,
  GOAL_PERIODS,
  loadDashboard,
  mergeDashboards,
  reconcileRelationships,
  shiftDate,
  STORAGE_KEY,
  LEGACY_STORAGE_KEY,
} from "./dashboard.js";

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

test("period navigation includes year, month, Monday-based week, and day boundaries", () => {
  assert.deepEqual(getPeriodRange("2026-10-13", "day"), {
    start: "2026-10-13",
    end: "2026-10-13",
  });
  assert.deepEqual(getPeriodRange("2026-10-13", "week"), {
    start: "2026-10-12",
    end: "2026-10-18",
  });
  assert.deepEqual(getPeriodRange("2026-02-17", "month"), {
    start: "2026-02-01",
    end: "2026-02-28",
  });
  assert.deepEqual(getPeriodRange("2024-02-17", "year"), {
    start: "2024-01-01",
    end: "2024-12-31",
  });
});

test("monthly goal progress includes tasks linked to nested weekly and daily goals", () => {
  const goals = [
    { id: "month", parentId: null },
    { id: "week", parentId: "month" },
    { id: "day", parentId: "week" },
  ];
  const tasks = [
    { id: "direct", goalId: "month", status: "Выполнено" },
    { id: "weekly", goalId: "week", status: "К выполнению" },
    { id: "daily", goalId: "day", status: "Выполнено" },
    { id: "unrelated", goalId: null, status: "Выполнено" },
  ];

  assert.deepEqual(getGoalProgress("month", goals, tasks), { completed: 2, total: 3, percent: 67 });
  assert.deepEqual(getGoalProgress("week", goals, tasks), { completed: 1, total: 2, percent: 50 });
  assert.deepEqual(getGoalProgress("day", goals, tasks), { completed: 1, total: 1, percent: 100 });
});

test("editing goal dates detaches out-of-range children and tasks without deleting them", () => {
  const result = reconcileRelationships(
    [
      { id: "month", period: "month", startDate: "2026-10-20", endDate: "2026-10-31", parentId: null },
      { id: "week", period: "week", startDate: "2026-10-12", endDate: "2026-10-18", parentId: "month" },
    ],
    [{ id: "task", date: "2026-10-13", goalId: "month" }],
  );

  assert.equal(result.goals.length, 2);
  assert.equal(result.goals[1].parentId, null);
  assert.equal(result.tasks.length, 1);
  assert.equal(result.tasks[0].goalId, null);
});

test("annual, monthly, weekly, and daily goals keep their valid parent links", () => {
  const goals = [
    { id: "year", period: "year", startDate: "2026-01-01", endDate: "2026-12-31", parentId: null },
    { id: "month", period: "month", startDate: "2026-10-01", endDate: "2026-10-31", parentId: "year" },
    { id: "week", period: "week", startDate: "2026-10-12", endDate: "2026-10-18", parentId: "month" },
    { id: "day", period: "day", startDate: "2026-10-13", endDate: "2026-10-13", parentId: "week" },
  ];
  const result = reconcileRelationships(goals, []);

  assert.deepEqual(GOAL_PERIODS, ["year", "month", "week", "day"]);
  assert.deepEqual(result.goals.map((goal) => goal.parentId), [null, "year", "month", "week"]);
});

test("merging local and server snapshots preserves conflicting records and their links", () => {
  const merged = mergeDashboards(
    {
      goals: [
        { id: "goal", title: "Локальная цель", parentId: null },
        { id: "child", title: "Подцель", parentId: "goal" },
      ],
      tasks: [{ id: "task", title: "Локальная задача", goalId: "goal" }],
    },
    {
      goals: [{ id: "goal", title: "Серверная цель", parentId: null }],
      tasks: [{ id: "task", title: "Серверная задача", goalId: "goal" }],
    },
  );

  assert.equal(merged.goals.length, 3);
  assert.equal(merged.tasks.length, 2);
  const localGoal = merged.goals.find((goal) => goal.title === "Локальная цель");
  const localChild = merged.goals.find((goal) => goal.title === "Подцель");
  const localTask = merged.tasks.find((task) => task.title === "Локальная задача");
  assert.equal(localChild.parentId, localGoal.id);
  assert.equal(localTask.goalId, localGoal.id);
  assert.equal(merged.goals.find((goal) => goal.id === "goal").title, "Серверная цель");
});

test("local dashboard data survives reload and existing saved entries are kept", () => {
  const dashboard = {
    goals: [{ id: "g1", title: "Сдать проект", period: "month" }],
    tasks: [{ id: "t1", title: "Сделать план", date: "2026-10-13", status: "Выполнено" }],
  };
  const storage = createStorage({ [STORAGE_KEY]: JSON.stringify(dashboard) });

  assert.deepEqual(loadDashboard(storage), dashboard);
  storage.setItem(STORAGE_KEY, JSON.stringify(loadDashboard(storage)));
  assert.deepEqual(loadDashboard(storage), dashboard);
});

test("previous dashboard tasks and focus cards are migrated without dropping user content", () => {
  const storage = createStorage({
    [LEGACY_STORAGE_KEY]: JSON.stringify({
      tasks: [{ id: 1, title: "Старая задача", time: "09:30", done: true }],
      focus: [{ id: 1, title: "Старый фокус", status: "Готово" }],
    }),
  });
  const migrated = loadDashboard(storage);

  assert.equal(migrated.tasks.length, 2);
  assert.equal(migrated.tasks[0].title, "Старая задача");
  assert.equal(migrated.tasks[0].time, "09:30");
  assert.equal(migrated.tasks[0].status, "Выполнено");
  assert.equal(migrated.tasks[1].title, "Старый фокус");
  assert.notEqual(migrated.tasks[0].id, migrated.tasks[1].id);
});

test("date changes across month and year boundaries stay in the local calendar", () => {
  assert.equal(shiftDate("2026-12-31", 1), "2027-01-01");
  assert.equal(shiftDate("2026-01-01", -1, "month"), "2025-12-01");
});

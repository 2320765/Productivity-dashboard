import assert from "node:assert/strict";
import test from "node:test";
import { filterWorkspaceArchive } from "./workspaceArchive.js";

const records = [
  {
    id: "goal",
    recordType: "goal",
    title: "Годовой запуск",
    notes: "Подготовить проект",
    archivedAt: "2026-10-12T08:00:00.000Z",
    archivedBy: "owner",
    createdBy: "member",
  },
  {
    id: "task",
    recordType: "task",
    title: "Подготовить демонстрацию",
    notes: "",
    status: "Выполнено",
    archivedAt: "2026-10-14T09:30:00.000Z",
    archivedBy: "admin",
    createdBy: "member",
    assigneeId: "owner",
  },
];
const comments = [
  { taskId: "task", authorId: "commenter", body: "Макет готов" },
];

function filter(overrides = {}) {
  return filterWorkspaceArchive(records, comments, {
    search: "",
    status: "",
    participant: "",
    from: "",
    to: "",
    ...overrides,
  });
}

test("archive search matches record fields and retained task comments", () => {
  assert.deepEqual(filter({ search: "подготовить проект" }).map((record) => record.id), ["goal"]);
  assert.deepEqual(filter({ search: "макет готов" }).map((record) => record.id), ["task"]);
});

test("archive filters by goal type or task status", () => {
  assert.deepEqual(filter({ status: "Цель" }).map((record) => record.id), ["goal"]);
  assert.deepEqual(filter({ status: "Выполнено" }).map((record) => record.id), ["task"]);
});

test("archive filters by creators, assignees, archivists, and comment authors", () => {
  assert.deepEqual(filter({ participant: "commenter" }).map((record) => record.id), ["task"]);
  assert.deepEqual(filter({ participant: "owner" }).map((record) => record.id), ["task", "goal"]);
  assert.deepEqual(filter({ participant: "admin" }).map((record) => record.id), ["task"]);
  assert.deepEqual(filter({ participant: "member" }).map((record) => record.id), ["task", "goal"]);
});

test("archive filters by archive date range and returns newest entries first", () => {
  assert.deepEqual(filter({ from: "2026-10-13", to: "2026-10-14" }).map((record) => record.id), ["task"]);
  assert.deepEqual(filter().map((record) => record.id), ["task", "goal"]);
});

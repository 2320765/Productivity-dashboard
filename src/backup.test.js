import assert from "node:assert/strict";
import test from "node:test";
import {
  backupToJson, buildBackup, parseBackup, planImport, protectCsvCell, tasksToCsv,
} from "./backup.js";

const goal = (over = {}) => ({ id: "g1", title: "Цель", period: "month", startDate: "2026-10-01", endDate: "2026-10-31", parentId: null, priority: "Высокий", notes: "заметка", ...over });
const task = (over = {}) => ({ id: "t1", title: "Задача", category: "Работа", date: "2026-10-05", time: "09:30", deadline: "", priority: "Средний", status: "К выполнению", notes: "n", goalId: "g1", ...over });
const empty = { goals: [], tasks: [] };

async function roundTrip(dashboard, theme = "dark") {
  const parsed = await parseBackup(backupToJson(buildBackup(dashboard, { theme })));
  assert.ok(parsed.ok, parsed.errors?.join("\n"));
  return parsed;
}

test("JSON backup keeps links, dates, statuses, priorities, notes and theme, and nothing else", async () => {
  const dashboard = {
    goals: [goal(), goal({ id: "g2", period: "week", startDate: "2026-10-05", endDate: "2026-10-11", parentId: "g1", archivedAt: "2026-10-20T10:00:00.000Z" })],
    tasks: [task({ status: "Выполнено", userId: "SECRET-USER", access_token: "SECRET-TOKEN", reminder: { mode: "before", minutes: 15 }, recurrence: { unit: "week", interval: 1, weekdays: [1], until: "", overrides: {}, moves: {} } })],
  };
  const json = backupToJson(buildBackup(dashboard, { theme: "dark" }));
  assert.ok(!json.includes("SECRET"), "лишние поля не должны попадать в копию");
  const { backup } = await roundTrip(dashboard);
  assert.equal(backup.theme, "dark");
  assert.equal(backup.goals[1].parentId, "g1");
  assert.equal(backup.goals[1].archivedAt, "2026-10-20T10:00:00.000Z");
  assert.equal(backup.tasks[0].goalId, "g1");
  assert.equal(backup.tasks[0].status, "Выполнено");
  assert.equal(backup.tasks[0].reminder.minutes, 15);
  assert.equal(backup.tasks[0].recurrence.unit, "week");
});

test("CSV protects formula-like values and escapes separators", () => {
  assert.equal(protectCsvCell("=1+1"), "'=1+1");
  assert.equal(protectCsvCell("  @SUM(A1)"), "'  @SUM(A1)");
  assert.equal(protectCsvCell("-5"), "'-5");
  assert.equal(protectCsvCell("обычный текст"), "обычный текст");
  const csv = tasksToCsv([task({ title: '=HYPERLINK("http://evil")', notes: "строка1\nстрока; 2" })], [goal({ title: "+цель" })]);
  assert.ok(csv.startsWith("\uFEFFНазвание;"));
  assert.ok(csv.includes(`"'=HYPERLINK(""http://evil"")"`));
  assert.ok(csv.includes("'+цель"));
  assert.ok(csv.includes('"строка1\nстрока; 2"'));
  assert.ok(!/(^|;)[=+@]/m.test(csv.split("\r\n")[1]));
});

test("corrupted and foreign files are rejected with clear errors", async () => {
  assert.equal((await parseBackup("")).ok, false);
  assert.match((await parseBackup("{oops")).errors[0], /повреждён/);
  assert.match((await parseBackup("[1,2]")).errors[0], /структур/);
  assert.match((await parseBackup(JSON.stringify({ goals: [], tasks: [] }))).errors[0], /не резервная копия/);
  const wrongVersion = { app: "dayflow", kind: "dashboard-backup", version: 99, goals: [], tasks: [] };
  assert.match((await parseBackup(JSON.stringify(wrongVersion))).errors[0], /версия/);
  const noLists = { app: "dayflow", kind: "dashboard-backup", version: 1 };
  assert.equal((await parseBackup(JSON.stringify(noLists))).ok, false);
});

test("invalid records are skipped and reported, valid ones survive", async () => {
  const file = buildBackup({ goals: [goal()], tasks: [task(), task({ id: "t2" }), task({ id: "t3" })] });
  file.tasks[1].date = "2026-02-31";
  file.tasks[2].status = "Взломано";
  file.goals.push({ id: "g9", title: "", period: "month" });
  const parsed = await parseBackup(JSON.stringify(file));
  assert.ok(parsed.ok);
  assert.equal(parsed.backup.tasks.length, 1);
  assert.equal(parsed.backup.goals.length, 1);
  assert.equal(parsed.errors.length, 3);
  assert.match(parsed.errors.join("\n"), /Задача №2/);
});

test("duplicate ids inside the file are reported", async () => {
  const file = buildBackup({ goals: [], tasks: [task(), task({ title: "Другая" })] });
  const parsed = await parseBackup(JSON.stringify(file));
  assert.equal(parsed.backup.tasks.length, 1);
  assert.match(parsed.errors[0], /повторяющийся id/);
});

test("merge mode adds new, updates changed and leaves identical records", async () => {
  const current = { goals: [goal()], tasks: [task(), task({ id: "t2", title: "Старая" })] };
  const { backup } = await roundTrip({ goals: [goal()], tasks: [task({ title: "Изменена" }), task({ id: "t2", title: "Старая" }), task({ id: "t3", title: "Новая" })] });
  const { summary, dashboard } = planImport(current, backup, "merge");
  assert.deepEqual([summary.tasks.added, summary.tasks.updated, summary.tasks.unchanged], [1, 1, 1]);
  assert.equal(summary.goals.unchanged, 1);
  assert.equal(dashboard.tasks.length, 3);
  assert.equal(dashboard.tasks.find((item) => item.id === "t1").title, "Изменена");
});

test("copy mode creates new ids, remaps links and never touches current data", async () => {
  const data = { goals: [goal(), goal({ id: "g2", period: "week", startDate: "2026-10-05", endDate: "2026-10-11", parentId: "g1" })], tasks: [task({ goalId: "g2" })] };
  const { backup } = await roundTrip(data);
  const { summary, dashboard } = planImport(data, backup, "copy");
  assert.equal(dashboard.goals.length, 4);
  assert.equal(dashboard.tasks.length, 2);
  assert.equal(summary.possibleDuplicates, 1);
  const ids = [...dashboard.goals, ...dashboard.tasks].map((item) => item.id);
  assert.equal(new Set(ids).size, ids.length);
  const copy = dashboard.tasks.find((item) => item.id !== "t1");
  const copiedGoal = dashboard.goals.find((item) => item.id === copy.goalId);
  assert.ok(copiedGoal && copiedGoal.id !== "g2");
  assert.equal(dashboard.goals.find((item) => item.id === copiedGoal.parentId)?.title, "Цель");
  assert.ok(dashboard.tasks.find((item) => item.id === "t1").goalId === "g2");
});

test("replace mode restores the backup and reports what will be removed", async () => {
  const { backup } = await roundTrip({ goals: [goal()], tasks: [task()] });
  const current = { goals: [goal({ id: "x" })], tasks: [task({ id: "y", goalId: "x" }), task({ id: "z", goalId: null })] };
  const { summary, dashboard } = planImport(current, backup, "replace");
  assert.equal(summary.goals.removed, 1);
  assert.equal(summary.tasks.removed, 2);
  assert.deepEqual(dashboard.tasks.map((item) => item.id), ["t1"]);
  assert.equal(dashboard.tasks[0].goalId, "g1");
});

test("links to missing goals are cleared with a warning", async () => {
  const file = buildBackup({ goals: [goal()], tasks: [task({ goalId: "ghost" }), task({ id: "t2", goalId: "g1", date: "2027-01-01" })] });
  const parsed = await parseBackup(JSON.stringify(file));
  const { summary, dashboard } = planImport(empty, parsed.backup, "merge");
  assert.equal(summary.linksCleared, 2);
  assert.ok(dashboard.tasks.every((item) => item.goalId === null));
  assert.ok(summary.warnings.length > 0);
});

test("a backup file never carries another user's identity into the plan", async () => {
  const file = buildBackup({ goals: [goal({ user_id: "other" })], tasks: [task({ user_id: "other" })] });
  file.goals[0].user_id = "other";
  file.tasks[0].userId = "other";
  const parsed = await parseBackup(JSON.stringify(file));
  const { dashboard } = planImport(empty, parsed.backup, "merge");
  assert.ok(!JSON.stringify(dashboard).includes("other"));
});

test("large backups parse correctly", async () => {
  const tasks = Array.from({ length: 12000 }, (_, index) => task({ id: `t${index}`, goalId: null }));
  const parsed = await roundTrip({ goals: [], tasks });
  assert.equal(parsed.backup.tasks.length, 12000);
  const { summary } = planImport(empty, parsed.backup, "merge");
  assert.equal(summary.tasks.added, 12000);
});

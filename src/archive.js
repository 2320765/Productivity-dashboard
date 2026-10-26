import { getGoalProgress } from "./dashboard.js";

export const TASK_STATUSES = ["К выполнению", "В процессе", "Выполнено"];

export function isArchived(record) {
  return Boolean(record?.archivedAt);
}

export function splitArchived(items) {
  const live = [];
  const archived = [];
  for (const item of items) (isArchived(item) ? archived : live).push(item);
  return { live, archived };
}

// Архивация не удаляет запись: меняется только archivedAt. Восстановление убирает это поле.
export function setArchived(dashboard, type, id, archived, now = new Date().toISOString()) {
  const key = type === "goal" ? "goals" : "tasks";
  return {
    ...dashboard,
    [key]: dashboard[key].map((item) => {
      if (item.id !== id || isArchived(item) === archived) return item;
      if (archived) return { ...item, archivedAt: now };
      const restored = { ...item };
      delete restored.archivedAt;
      return restored;
    }),
  };
}

// У цели нет собственного статуса — он выводится из выполнения связанных задач (включая архивные).
export function goalStatus(goal, goals, tasks) {
  const progress = getGoalProgress(goal.id, goals, tasks);
  if (!progress.total) return "Без задач";
  if (progress.completed === progress.total) return "Выполнено";
  return progress.completed > 0 ? "В процессе" : "К выполнению";
}

export const RECORD_STATUSES = [...TASK_STATUSES, "Без задач"];

function normalize(value) {
  return String(value ?? "").toLocaleLowerCase("ru").replace(/ё/g, "е");
}

export function buildRows(dashboard) {
  const { goals, tasks } = dashboard;
  const goalTitles = new Map(goals.map((goal) => [goal.id, goal.title]));
  const taskRows = tasks.map((task) => ({
    key: `task:${task.id}`,
    type: "task",
    id: task.id,
    title: task.title ?? "",
    notes: task.notes ?? "",
    status: task.status,
    date: task.date,
    endDate: task.date,
    goalId: task.goalId ?? null,
    goalTitle: task.goalId ? goalTitles.get(task.goalId) ?? "" : "",
    archivedAt: task.archivedAt ?? "",
    recurring: Boolean(task.recurrence),
  }));
  const goalRows = goals.map((goal) => ({
    key: `goal:${goal.id}`,
    type: "goal",
    id: goal.id,
    title: goal.title ?? "",
    notes: goal.notes ?? "",
    status: goalStatus(goal, goals, tasks),
    date: goal.startDate,
    endDate: goal.endDate,
    goalId: goal.parentId ?? null,
    goalTitle: goal.parentId ? goalTitles.get(goal.parentId) ?? "" : "",
    archivedAt: goal.archivedAt ?? "",
    recurring: false,
  }));
  return [...taskRows, ...goalRows];
}

function score(row, tokens, phrase) {
  const title = normalize(row.title);
  const notes = normalize(row.notes);
  if (!tokens.every((token) => title.includes(token) || notes.includes(token))) return 0;
  if (title === phrase) return 4;
  if (title.startsWith(phrase)) return 3;
  if (title.includes(phrase)) return 2;
  return tokens.every((token) => title.includes(token)) ? 1.5 : 1;
}

function dateKey(row, dateBy) {
  return dateBy === "archived" ? row.archivedAt.slice(0, 10) : row.date;
}

function inDateRange(row, { from, to, dateBy }) {
  if (!from && !to) return true;
  if (dateBy === "archived") {
    const day = dateKey(row, dateBy);
    return Boolean(day) && (!from || day >= from) && (!to || day <= to);
  }
  // Цель попадает в диапазон, если её период пересекается с ним.
  return (!from || row.endDate >= from) && (!to || row.date <= to);
}

// scope: "active" | "archived" | "all". Ищет по названию и заметкам, слова запроса могут стоять в любом порядке.
export function searchRecords(dashboard, query, filters = {}) {
  const {
    scope = "all", type = "all", status = "all", from = "", to = "", dateBy = "record", limit = Infinity,
  } = filters;
  const phrase = normalize(query).trim();
  const tokens = phrase.split(/\s+/).filter(Boolean);
  const results = [];
  for (const row of buildRows(dashboard)) {
    const archived = Boolean(row.archivedAt);
    if (scope === "active" && archived) continue;
    if (scope === "archived" && !archived) continue;
    if (type !== "all" && row.type !== type) continue;
    if (status !== "all" && row.status !== status) continue;
    if (!inDateRange(row, { from, to, dateBy })) continue;
    const rank = tokens.length ? score(row, tokens, phrase) : 1;
    if (!rank) continue;
    results.push({ ...row, archived, rank });
  }
  results.sort((a, b) => b.rank - a.rank
    || (dateBy === "archived" ? b.archivedAt.localeCompare(a.archivedAt) : b.date.localeCompare(a.date))
    || a.title.localeCompare(b.title, "ru"));
  return Number.isFinite(limit) ? results.slice(0, limit) : results;
}

// Куда перейти при выборе результата: период, вкладка и запись для подсветки.
export function getResultTarget(result) {
  return {
    selectedDate: result.date,
    layout: result.archived ? "archive" : "table",
    highlightKey: result.key,
  };
}

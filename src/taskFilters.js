import { DONE_STATUS, addDays, expandTasks } from "./recurrence.js";

const PRIORITY_ORDER = { Высокий: 0, Средний: 1, Низкий: 2 };
const STATUS_ORDER = ["К выполнению", "В процессе", DONE_STATUS];
const SEARCH_SCOPE_DAYS = 365;

export const EMPTY_TASK_FILTERS = {
  status: "all",
  priority: "all",
  goalId: "all",
  deadline: "all",
  dateScope: "period",
};

export function getTaskSearchRows(tasks, range, dateScope, today) {
  if (dateScope === "period") {
    const rows = expandTasks(tasks, range.start, range.end);
    if (today < range.start || today > range.end) return rows;
    // Unfinished past tasks keep showing up in the period that contains today.
    const carried = tasks.filter((task) => !task.recurrence && task.status !== DONE_STATUS && task.date < range.start);
    return [...carried, ...rows];
  }

  const recurring = tasks.filter((task) => task.recurrence);
  const lookbackStart = addDays(today, -SEARCH_SCOPE_DAYS);
  const start = range.start > today ? range.start : lookbackStart;
  const end = range.end > today ? range.end : today;
  return [
    ...tasks.filter((task) => !task.recurrence),
    ...expandTasks(recurring, start, end),
  ];
}

export function filterTasks(tasks, filters, goals, today, search = "") {
  const term = search.trim().toLocaleLowerCase("ru");
  const goalIds = new Set(goals.map((goal) => goal.id));
  return tasks.filter((task) => {
    if (filters.status === "active" && task.status === DONE_STATUS) return false;
    if (filters.status === "completed" && task.status !== DONE_STATUS) return false;
    const dueDate = task.deadline?.slice(0, 10) || task.date;
    if (filters.status === "overdue" && (task.status === DONE_STATUS || dueDate >= today)) return false;
    if (filters.priority !== "all" && task.priority !== filters.priority) return false;
    if (filters.goalId === "none" && task.goalId) return false;
    if (filters.goalId !== "all" && filters.goalId !== "none" && task.goalId !== filters.goalId) return false;
    if (filters.goalId !== "all" && filters.goalId !== "none" && !goalIds.has(filters.goalId)) return false;
    if (filters.deadline === "with" && !task.deadline) return false;
    if (filters.deadline === "without" && task.deadline) return false;
    if (term && !`${task.title} ${task.notes ?? ""}`.toLocaleLowerCase("ru").includes(term)) return false;
    return true;
  });
}

export function sortTasks(tasks, sort) {
  const direction = sort.direction === "asc" ? 1 : -1;
  return [...tasks].sort((a, b) => {
    if (sort.key === "priority") {
      return ((PRIORITY_ORDER[a.priority] ?? 1) - (PRIORITY_ORDER[b.priority] ?? 1)) * direction;
    }
    if (sort.key === "status") {
      return (STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status)) * direction;
    }
    const left = sort.key === "title" ? a.title : `${a.date} ${a.time ?? ""}`;
    const right = sort.key === "title" ? b.title : `${b.date} ${b.time ?? ""}`;
    return String(left).localeCompare(String(right), "ru") * direction;
  });
}

export function activeFilterLabels(filters, goals) {
  const labels = [];
  if (filters.status !== "all") labels.push({ key: "status", text: { active: "Активные", completed: "Выполненные", overdue: "Просроченные" }[filters.status] });
  if (filters.priority !== "all") labels.push({ key: "priority", text: `Приоритет: ${filters.priority}` });
  if (filters.goalId === "none") labels.push({ key: "goalId", text: "Без цели" });
  else if (filters.goalId !== "all") labels.push({ key: "goalId", text: `Цель: ${goals.find((goal) => goal.id === filters.goalId)?.title ?? "не найдена"}` });
  if (filters.deadline !== "all") labels.push({ key: "deadline", text: filters.deadline === "with" ? "Со сроком" : "Без срока" });
  if (filters.dateScope === "all") labels.push({ key: "dateScope", text: "Все даты (повторы за год)" });
  return labels;
}

export function sortIndicator(sort, key) {
  if (sort.key !== key) return "↕";
  return sort.direction === "asc" ? "↑" : "↓";
}

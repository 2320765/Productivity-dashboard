import { expandTask } from "./recurrence.js";

export const STORAGE_KEY = "dayflow-productivity-v2";
export const LEGACY_STORAGE_KEY = "dayflow-dashboard-v1";
export const THEME_KEY = "dayflow-theme-v1";

export const PRIORITIES = ["Низкий", "Средний", "Высокий"];
export const STATUSES = ["К выполнению", "В процессе", "Выполнено"];
export const GOAL_PERIODS = ["year", "month", "week", "day"];

export function localDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function shiftDate(value, amount, unit = "day") {
  const date = new Date(`${value}T12:00:00`);
  if (unit === "month") {
    date.setDate(1);
    date.setMonth(date.getMonth() + amount);
  } else if (unit === "year") {
    date.setDate(1);
    date.setMonth(0);
    date.setFullYear(date.getFullYear() + amount);
  } else {
    date.setDate(date.getDate() + amount);
  }
  return localDateString(date);
}

export function getPeriodRange(date, view) {
  const current = new Date(`${date}T12:00:00`);
  if (view === "day") return { start: date, end: date };

  if (view === "week") {
    const start = new Date(current);
    start.setDate(current.getDate() - ((current.getDay() + 6) % 7));
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    return { start: localDateString(start), end: localDateString(end) };
  }

  if (view === "month") {
    const start = new Date(current.getFullYear(), current.getMonth(), 1, 12);
    const end = new Date(current.getFullYear(), current.getMonth() + 1, 0, 12);
    return { start: localDateString(start), end: localDateString(end) };
  }

  const start = new Date(current.getFullYear(), 0, 1, 12);
  const end = new Date(current.getFullYear(), 11, 31, 12);
  return { start: localDateString(start), end: localDateString(end) };
}

export function getGoalDefaultRange(date, period) {
  return getPeriodRange(date, period);
}

export function formatPeriod(date, view) {
  const current = new Date(`${date}T12:00:00`);
  if (view === "day") {
    return new Intl.DateTimeFormat("ru-RU", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(current);
  }
  if (view === "month") {
    return new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric" }).format(current);
  }
  if (view === "year") return String(current.getFullYear());

  const { start, end } = getPeriodRange(date, "week");
  const startDate = new Date(`${start}T12:00:00`);
  const endDate = new Date(`${end}T12:00:00`);
  const startText = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" }).format(
    startDate,
  );
  const endText = new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(endDate);
  return `${startText} — ${endText}`;
}

export function createId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

export function mergeDashboards(local, remote) {
  const remoteGoals = new Map(remote.goals.map((goal) => [goal.id, goal]));
  const remoteTasks = new Map(remote.tasks.map((task) => [task.id, task]));
  const goalIds = new Map();
  const taskIds = new Map();

  for (const goal of local.goals) {
    const serverGoal = remoteGoals.get(goal.id);
    if (serverGoal && JSON.stringify(goal) !== JSON.stringify(serverGoal)) {
      goalIds.set(goal.id, createId());
    }
  }
  for (const task of local.tasks) {
    const serverTask = remoteTasks.get(task.id);
    if (serverTask && JSON.stringify(task) !== JSON.stringify(serverTask)) {
      taskIds.set(task.id, createId());
    }
  }

  const goals = new Map();
  for (const goal of local.goals) {
    const id = goalIds.get(goal.id) ?? goal.id;
    goals.set(id, {
      ...goal,
      id,
      parentId: goalIds.get(goal.parentId) ?? goal.parentId,
    });
  }
  for (const goal of remote.goals) goals.set(goal.id, goal);

  const tasks = new Map();
  for (const task of local.tasks) {
    const id = taskIds.get(task.id) ?? task.id;
    tasks.set(id, {
      ...task,
      id,
      goalId: goalIds.get(task.goalId) ?? task.goalId,
    });
  }
  for (const task of remote.tasks) tasks.set(task.id, task);

  return { goals: [...goals.values()], tasks: [...tasks.values()] };
}

export function loadDashboard(storage) {
  try {
    const localStore = storage ?? globalThis.localStorage;
    const saved = localStore?.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      return {
        goals: Array.isArray(parsed.goals) ? parsed.goals : [],
        tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
      };
    }

    const legacySaved = localStore?.getItem(LEGACY_STORAGE_KEY);
    if (!legacySaved) return { goals: [], tasks: [] };

    const legacy = JSON.parse(legacySaved);
    const today = localDateString();
    const migratedTasks = Array.isArray(legacy.tasks)
      ? legacy.tasks.map((task, index) => ({
          id: `legacy-task-${task.id ?? index}`,
          title: task.title ?? "Старая задача",
          category: task.category ?? "Личное",
          date: today,
          time: task.time ?? "",
          deadline: "",
          priority: "Средний",
          notes: "",
          status: task.done ? "Выполнено" : "К выполнению",
          goalId: null,
        }))
      : [];
    const migratedFocus = Array.isArray(legacy.focus)
      ? legacy.focus.map((item, index) => ({
          id: `legacy-focus-${item.id ?? index}`,
          title: item.title ?? "Старый фокус",
          category: "Личное",
          date: today,
          time: "",
          deadline: "",
          priority: "Средний",
          notes: "",
          status: item.status === "Готово" ? "Выполнено" : "К выполнению",
          goalId: null,
        }))
      : [];

    return { goals: [], tasks: [...migratedTasks, ...migratedFocus] };
  } catch (error) {
    console.error("Не удалось загрузить локальные данные дашборда:", error);
    return { goals: [], tasks: [] };
  }
}

export function getGoalProgress(goalId, goals, tasks) {
  const descendants = new Set([goalId]);
  let changed = true;

  while (changed) {
    changed = false;
    for (const goal of goals) {
      if (goal.parentId && descendants.has(goal.parentId) && !descendants.has(goal.id)) {
        descendants.add(goal.id);
        changed = true;
      }
    }
  }

  const goalsById = new Map(goals.map((goal) => [goal.id, goal]));
  const linkedTasks = tasks
    .filter((task) => task.goalId && descendants.has(task.goalId))
    .flatMap((task) => {
      if (!task.recurrence) return [task];
      const goal = goalsById.get(task.goalId);
      return goal ? expandTask(task, goal.startDate, goal.endDate) : [];
    });
  const completed = linkedTasks.filter((task) => task.status === "Выполнено").length;
  return {
    completed,
    total: linkedTasks.length,
    percent: linkedTasks.length ? Math.round((completed / linkedTasks.length) * 100) : 0,
  };
}

export function reconcileRelationships(goals, tasks) {
  const goalsById = new Map(goals.map((goal) => [goal.id, goal]));
  const normalizedGoals = goals.map((goal) => {
    if (!goal.parentId) return goal;
    const parent = goalsById.get(goal.parentId);
    const expectedParentPeriod = goal.period === "month"
      ? "year"
      : goal.period === "week" ? "month" : goal.period === "day" ? "week" : null;
    const validParent = parent &&
      parent.period === expectedParentPeriod &&
      goal.startDate >= parent.startDate &&
      goal.endDate <= parent.endDate;
    return validParent ? goal : { ...goal, parentId: null };
  });
  const normalizedGoalsById = new Map(normalizedGoals.map((goal) => [goal.id, goal]));
  const normalizedTasks = tasks.map((task) => {
    if (!task.goalId) return task;
    const goal = normalizedGoalsById.get(task.goalId);
    return goal && task.date >= goal.startDate && task.date <= goal.endDate
      ? task
      : { ...task, goalId: null };
  });
  return { goals: normalizedGoals, tasks: normalizedTasks };
}

export function getNavigationTarget(date, view, amount) {
  if (view === "year") return shiftDate(date, amount, "year");
  if (view === "month") return shiftDate(date, amount, "month");
  return shiftDate(date, amount * (view === "week" ? 7 : 1));
}

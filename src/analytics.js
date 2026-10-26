import { getPeriodRange, localDateString, shiftDate } from "./dashboard.js";
import { addDays, expandTasks } from "./recurrence.js";

function taskKey(task) {
  return task.occurrenceDate ? `${task.id}:${task.occurrenceDate}` : task.id;
}

function dueDate(task) {
  return task.deadline?.slice(0, 10) || task.date;
}

function uniqueTasks(tasks, start, end) {
  const seen = new Set();
  return expandTasks(tasks, start, end).filter((task) => {
    const key = taskKey(task);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function movedInRange(tasks, start, end) {
  const moved = new Set();
  for (const task of tasks) {
    if (!task.recurrence) {
      const movedAt = task.movedAt ? localDateString(new Date(task.movedAt)) : "";
      if (movedAt >= start && movedAt <= end) moved.add(task.id);
      continue;
    }
    for (const [occurrence, target] of Object.entries(task.recurrence.moves ?? {})) {
      if (target >= start && target <= end) moved.add(`${task.id}:${occurrence}`);
    }
  }
  return moved.size;
}

function calculateGoals(goals, periodTasks, range) {
  const activeGoals = goals.filter((goal) => goal.startDate <= range.end && goal.endDate >= range.start);
  const goalIds = new Set(activeGoals.map((goal) => goal.id));
  const linked = new Map();
  for (const task of periodTasks) {
    if (!task.goalId || !goalIds.has(task.goalId)) continue;
    if (!linked.has(task.goalId)) linked.set(task.goalId, new Map());
    linked.get(task.goalId).set(taskKey(task), task);
  }
  let planned = 0;
  let completed = 0;
  let goalsWithTasks = 0;
  for (const goalId of goalIds) {
    const tasks = [...(linked.get(goalId)?.values() ?? [])];
    if (tasks.length) goalsWithTasks += 1;
    planned += tasks.length;
    completed += tasks.filter((task) => task.status === "Выполнено").length;
  }
  return {
    count: activeGoals.length,
    withTasks: goalsWithTasks,
    planned,
    completed,
    percent: planned ? Math.round(completed / planned * 100) : 0,
  };
}

export function getAnalyticsRange(anchorDate, period) {
  if (period !== "week" && period !== "month") throw new Error(`Unsupported analytics period: ${period}`);
  return getPeriodRange(anchorDate, period);
}

export function getAnalytics(tasks, goals, anchorDate, period, today) {
  const range = getAnalyticsRange(anchorDate, period);
  const periodTasks = uniqueTasks(tasks, range.start, range.end);
  const planned = periodTasks.length;
  const completed = periodTasks.filter((task) => task.status === "Выполнено").length;
  const overdue = periodTasks.filter((task) => task.status !== "Выполнено" && dueDate(task) < today).length;
  const days = [];
  for (let date = range.start; date <= range.end; date = addDays(date, 1)) {
    const daily = periodTasks.filter((task) => task.date === date);
    days.push({
      date,
      planned: daily.length,
      completed: daily.filter((task) => task.status === "Выполнено").length,
    });
  }
  return {
    period,
    range,
    planned,
    completed,
    percent: planned ? Math.round(completed / planned * 100) : 0,
    overdue,
    moved: movedInRange(tasks, range.start, range.end),
    goals: calculateGoals(goals, periodTasks, range),
    days,
  };
}

export function getAnalyticsComparison(tasks, goals, anchorDate, period, today) {
  const current = getAnalytics(tasks, goals, anchorDate, period, today);
  const previousAnchor = period === "week" ? addDays(anchorDate, -7) : shiftDate(anchorDate, -1, "month");
  const previous = getAnalytics(tasks, goals, previousAnchor, period, today);
  return {
    current,
    previous,
    available: previous.planned > 0,
    plannedDelta: current.planned - previous.planned,
    completedDelta: current.completed - previous.completed,
    percentDelta: current.percent - previous.percent,
  };
}

import { DONE_STATUS, addDays, expandTasks, moveOccurrence } from "./recurrence.js";

export const OVERDUE_LOOKBACK_DAYS = 30;

export function taskKey(task) {
  return task.occurrenceDate ? `${task.id}:${task.occurrenceDate}` : task.id;
}

// Срок задачи — дата дедлайна, если он есть, иначе дата задачи. Экземпляры повторов дедлайна не имеют.
export function dueDate(task) {
  return (task.deadline && task.deadline.slice(0, 10)) || task.date;
}

export function isOverdue(task, today) {
  return task.status !== DONE_STATUS && dueDate(task) < today;
}

// Обычные задачи — без ограничения давности; экземпляры повторов — только за последние OVERDUE_LOOKBACK_DAYS дней.
export function getOverdueTasks(tasks, today) {
  const plain = tasks.filter((task) => !task.recurrence && isOverdue(task, today));
  const recurring = expandTasks(tasks.filter((task) => task.recurrence), addDays(today, -OVERDUE_LOOKBACK_DAYS), addDays(today, -1))
    .filter((task) => isOverdue(task, today));
  return [...plain, ...recurring].sort((a, b) => `${dueDate(a)} ${a.time}`.localeCompare(`${dueDate(b)} ${b.time}`));
}

export function getTomorrow(today) {
  return addDays(today, 1);
}

// Понедельник следующей недели.
export function getNextWeekStart(today) {
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay() || 7;
  return addDays(today, 8 - weekday);
}

function moveDeadline(deadline, date) {
  if (!deadline || deadline.slice(0, 10) >= date) return deadline;
  return `${date}${deadline.slice(10)}`;
}

function goalOutOfRange(task, goals, date) {
  const goal = task.goalId ? goals.find((item) => item.id === task.goalId) : null;
  return Boolean(goal && (date < goal.startDate || date > goal.endDate));
}

// Считает, что изменится, не меняя данные. Для обычной задачи меняется её дата, для экземпляра повтора — только он сам.
export function planReschedule(tasks, selected, date, goals, now = new Date().toISOString()) {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const working = new Map(byId);
  const changes = [];
  let goalUnlinks = 0;
  let goalWarnings = 0;
  const seen = new Set();
  for (const item of selected) {
    const key = taskKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    const current = working.get(item.id);
    if (!current) continue;
    if (current.recurrence) {
      if (!item.occurrenceDate || item.date === date) continue;
      if (goalOutOfRange(current, goals, date)) goalWarnings += 1;
      const after = moveOccurrence(current, item.occurrenceDate, date);
      working.set(item.id, after);
      changes.push({ before: byId.get(item.id), after });
      continue;
    }
    if (current.date === date) continue;
    const unlink = goalOutOfRange(current, goals, date);
    if (unlink) goalUnlinks += 1;
    const after = {
      ...current,
      date,
      deadline: moveDeadline(current.deadline, date),
      goalId: unlink ? null : current.goalId ?? null,
      movedFrom: current.date,
      movedAt: now,
      moveCount: (current.moveCount ?? 0) + 1,
    };
    working.set(item.id, after);
    changes.push({ before: byId.get(item.id), after });
  }
  return { changes, goalUnlinks, goalWarnings };
}

export function applyChanges(tasks, changes) {
  const byId = new Map(changes.map((change) => [change.after.id, change.after]));
  return tasks.map((task) => byId.get(task.id) ?? task);
}

export function revertChanges(tasks, changes) {
  const byId = new Map(changes.map((change) => [change.before.id, change.before]));
  return tasks.map((task) => byId.get(task.id) ?? task);
}

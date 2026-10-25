import { getPeriodRange, shiftDate } from "./dashboard.js";

// В модели задач нет длительности: у задачи есть только время начала («HH:MM»).
// В расписании каждая задача занимает часовой слот, в котором она начинается.
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export function hasTime(task) {
  return TIME_PATTERN.test(task.time ?? "");
}

export function splitDayTasks(tasks) {
  const timed = tasks.filter(hasTime).sort((a, b) => a.time.localeCompare(b.time) || a.title.localeCompare(b.title, "ru"));
  const untimed = tasks.filter((task) => !hasTime(task)).sort((a, b) => a.title.localeCompare(b.title, "ru"));
  return { timed, untimed };
}

// Задачи с одинаковым временем начала конфликтуют; ни одна из них не скрывается.
export function findConflicts(timedTasks) {
  const byTime = new Map();
  for (const task of timedTasks) byTime.set(task.time, [...(byTime.get(task.time) ?? []), task]);
  const conflicting = new Set();
  for (const group of byTime.values()) {
    if (group.length > 1) group.forEach((task) => conflicting.add(task));
  }
  return conflicting;
}

export function groupByHour(timedTasks) {
  const hours = new Map();
  for (const task of timedTasks) {
    const hour = Number(task.time.slice(0, 2));
    hours.set(hour, [...(hours.get(hour) ?? []), task]);
  }
  return hours;
}

export function tasksByDate(tasks) {
  const map = new Map();
  for (const task of tasks) map.set(task.date, [...(map.get(task.date) ?? []), task]);
  return map;
}

export function getCalendarRange(date, mode) {
  if (mode === "day") return { start: date, end: date };
  if (mode === "week") return getPeriodRange(date, "week");
  // Месячная сетка начинается с понедельника и заканчивается воскресеньем.
  const month = getPeriodRange(date, "month");
  return { start: getPeriodRange(month.start, "week").start, end: getPeriodRange(month.end, "week").end };
}

export function getMonthWeeks(date) {
  const { start, end } = getCalendarRange(date, "month");
  const weeks = [];
  for (let weekStart = start; weekStart <= end; weekStart = shiftDate(weekStart, 7)) {
    weeks.push(Array.from({ length: 7 }, (_, index) => shiftDate(weekStart, index)));
  }
  return weeks;
}

export function shiftCalendar(date, mode, direction) {
  if (mode === "day") return shiftDate(date, direction);
  if (mode === "week") return shiftDate(date, direction * 7);
  const target = shiftDate(date, direction, "month");
  const lastDay = Number(getPeriodRange(target, "month").end.slice(8));
  return `${target.slice(0, 8)}${String(Math.min(Number(date.slice(8, 10)), lastDay)).padStart(2, "0")}`;
}

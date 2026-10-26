import { localDateString } from "./dashboard.js";
import { addDays, expandTasks } from "./recurrence.js";

export const REMINDER_LEADS = [
  { value: 0, label: "В назначенное время" },
  { value: 5, label: "За 5 минут" },
  { value: 15, label: "За 15 минут" },
  { value: 30, label: "За 30 минут" },
  { value: 60, label: "За 1 час" },
  { value: 1440, label: "За 1 день" },
];

export function normalizeReminder(value) {
  if (!value || typeof value !== "object" || !["at", "before"].includes(value.mode)) return { mode: "none" };
  const minutes = Number(value.minutes ?? 0);
  if (!Number.isInteger(minutes) || !REMINDER_LEADS.some((item) => item.value === minutes)) return { mode: "none" };
  if (value.mode === "at") return { mode: "at", minutes: 0 };
  return minutes > 0 ? { mode: "before", minutes } : { mode: "none" };
}

export function getNotificationPermission(notificationApi) {
  if (!notificationApi || typeof notificationApi.permission !== "string") return "unsupported";
  return notificationApi.permission;
}

export function canSendBrowserNotifications(enabled, permission) {
  return Boolean(enabled && permission === "granted");
}

function parseLocalDateTime(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), 0, 0);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function getReminderTarget(task) {
  const reminder = normalizeReminder(task.reminder);
  if (reminder.mode === "none" || task.status === "Выполнено") return null;
  let target = task.deadline ? parseLocalDateTime(task.deadline.slice(0, 16)) : null;
  if (!target && task.time && /^\d{2}:\d{2}$/.test(task.time)) {
    target = parseLocalDateTime(`${task.date}T${task.time}`);
  }
  if (!target) return null;
  return new Date(target.getTime() - reminder.minutes * 60_000);
}

export function reminderTaskKey(task, target) {
  return `${task.id}:${task.occurrenceDate ?? ""}:${target.getTime()}`;
}

export function getReminderOccurrences(tasks, today = localDateString(), days = 7) {
  const end = addDays(today, days);
  const expanded = expandTasks(tasks, addDays(today, -1), end);
  const seen = new Set();
  return expanded.flatMap((task) => {
    const target = getReminderTarget(task);
    if (!target || target < new Date(`${addDays(today, -1)}T00:00:00`)) return [];
    const key = reminderTaskKey(task, target);
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ task, target, key }];
  }).sort((a, b) => a.target - b.target);
}

export function getDueReminders(tasks, now, windowMs = 60_000) {
  const today = localDateString(now);
  return getReminderOccurrences(tasks, today, 2).filter(({ target }) => {
    const difference = target.getTime() - now.getTime();
    return difference <= 0 && difference >= -windowMs;
  });
}

export function formatReminderTime(date) {
  return new Intl.DateTimeFormat("ru-RU", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(date);
}

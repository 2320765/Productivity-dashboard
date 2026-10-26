import assert from "node:assert/strict";
import test from "node:test";
import { canSendBrowserNotifications, getDueReminders, getNotificationPermission, getReminderOccurrences, getReminderTarget, normalizeReminder } from "./reminders.js";

function task(overrides = {}) {
  return {
    id: "task-1", title: "Проверить отчёт", date: "2026-10-25", time: "10:00",
    deadline: "", status: "К выполнению", reminder: { mode: "at", minutes: 0 },
    ...overrides,
  };
}

test("нормализует настройки, включая отключённое и недопустимый интервал", () => {
  assert.deepEqual(normalizeReminder(null), { mode: "none" });
  assert.deepEqual(normalizeReminder({ mode: "before", minutes: 15 }), { mode: "before", minutes: 15 });
  assert.deepEqual(normalizeReminder({ mode: "before", minutes: 7 }), { mode: "none" });
  assert.deepEqual(normalizeReminder({ mode: "at", minutes: 15 }), { mode: "at", minutes: 0 });
});

test("глобальный выключатель и состояние разрешения управляют браузерными уведомлениями", () => {
  assert.equal(getNotificationPermission(undefined), "unsupported");
  assert.equal(getNotificationPermission({ permission: "denied" }), "denied");
  assert.equal(canSendBrowserNotifications(false, "granted"), false);
  assert.equal(canSendBrowserNotifications(true, "default"), false);
  assert.equal(canSendBrowserNotifications(true, "denied"), false);
  assert.equal(canSendBrowserNotifications(true, "granted"), true);
});

test("использует локальные дату/время или дедлайн и пересчитывает время после изменения", () => {
  const scheduled = getReminderTarget(task({ reminder: { mode: "before", minutes: 15 } }));
  assert.equal(scheduled.getFullYear(), 2026);
  assert.equal(scheduled.getMonth(), 9);
  assert.equal(scheduled.getDate(), 25);
  assert.equal(scheduled.getHours(), 9);
  assert.equal(scheduled.getMinutes(), 45);
  const deadline = getReminderTarget(task({ deadline: "2026-10-26T12:30", reminder: { mode: "at", minutes: 0 } }));
  assert.equal(deadline.getHours(), 12);
  assert.equal(deadline.getDate(), 26);
  const moved = getReminderTarget(task({ date: "2026-10-27", time: "08:00" }));
  assert.equal(moved.getDate(), 27);
  assert.equal(moved.getHours(), 8);
});

test("не создаёт напоминание без времени, при отключённом правиле или выполнении", () => {
  assert.equal(getReminderTarget(task({ time: "", reminder: { mode: "at" } })), null);
  assert.equal(getReminderTarget(task({ reminder: { mode: "none" } })), null);
  assert.equal(getReminderTarget(task({ status: "Выполнено" })), null);
});

test("повторные вызовы в пределах минуты дают один и тот же ключ, а выполненная задача удаляется", () => {
  const target = new Date(2026, 9, 25, 10, 0, 0);
  const current = task();
  assert.equal(getDueReminders([current], new Date(target.getTime() - 10_000)).length, 0);
  const due = getDueReminders([current], target);
  assert.equal(due.length, 1);
  assert.equal(getDueReminders([current], new Date(target.getTime() + 20_000))[0].key, due[0].key);
  assert.equal(getDueReminders([task({ status: "Выполнено" })], target).length, 0);
});

test("список ближайших уведомлений включает повторы и отсортирован по дате", () => {
  const tasks = [
    task({ id: "later", date: "2026-10-26", time: "12:00" }),
    task({ id: "soon", time: "10:30" }),
    task({ id: "repeat", date: "2026-10-25", time: "11:00", recurrence: { unit: "day", interval: 1, weekdays: [], until: "2026-10-25", overrides: {}, moves: {} } }),
  ];
  const reminders = getReminderOccurrences(tasks, "2026-10-25", 2);
  assert.equal(reminders[0].task.id, "soon");
  assert.equal(reminders[1].task.occurrenceDate, "2026-10-25");
  assert.equal(reminders[2].task.id, "later");
});

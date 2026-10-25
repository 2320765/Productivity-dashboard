// Повторяющаяся задача хранится одной записью (серией). Экземпляры строятся на лету для
// нужного периода, а их статусы лежат в recurrence.overrides: { "YYYY-MM-DD": "Выполнено" }.
// Все даты — календарные строки пользователя; арифметика идёт в UTC, поэтому смена
// летнего/зимнего времени и часовой пояс не сдвигают дни.
const DAY_MS = 86400000;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const MAX_INTERVAL = 99;
export const WEEKDAY_LABELS = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];
export const DONE_STATUS = "Выполнено";
export const DEFAULT_STATUS = "К выполнению";

function toUtc(value) {
  const [year, month, day] = value.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

function fromUtc(ms) {
  const date = new Date(ms);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function isoWeekday(ms) {
  const day = new Date(ms).getUTCDay();
  return day === 0 ? 7 : day;
}

function mondayOf(ms) {
  return ms - (isoWeekday(ms) - 1) * DAY_MS;
}

function daysInMonth(year, monthIndex) {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

export function addDays(value, amount) {
  return fromUtc(toUtc(value) + amount * DAY_MS);
}

export function normalizeRecurrence(rule) {
  if (!rule || typeof rule !== "object") return null;
  if (!["day", "week", "month"].includes(rule.unit)) return null;
  const interval = Number(rule.interval);
  if (!Number.isInteger(interval) || interval < 1 || interval > MAX_INTERVAL) return null;
  const weekdays = rule.unit === "week" && Array.isArray(rule.weekdays)
    ? [...new Set(rule.weekdays.map(Number).filter((day) => Number.isInteger(day) && day >= 1 && day <= 7))].sort((a, b) => a - b)
    : [];
  const until = typeof rule.until === "string" && DATE_PATTERN.test(rule.until) ? rule.until : "";
  const overrides = {};
  if (rule.overrides && typeof rule.overrides === "object") {
    for (const [date, status] of Object.entries(rule.overrides)) {
      if (DATE_PATTERN.test(date) && typeof status === "string") overrides[date] = status;
    }
  }
  return { unit: rule.unit, interval, weekdays, until, overrides };
}

export function occursOn(rule, startDate, date) {
  if (!rule || !DATE_PATTERN.test(startDate) || !DATE_PATTERN.test(date)) return false;
  if (date < startDate || (rule.until && date > rule.until)) return false;
  const start = toUtc(startDate);
  const target = toUtc(date);
  if (rule.unit === "day") return ((target - start) / DAY_MS) % rule.interval === 0;
  if (rule.unit === "week") {
    const weekdays = rule.weekdays.length ? rule.weekdays : [isoWeekday(start)];
    if (!weekdays.includes(isoWeekday(target))) return false;
    return ((mondayOf(target) - mondayOf(start)) / DAY_MS / 7) % rule.interval === 0;
  }
  const first = new Date(start);
  const current = new Date(target);
  const months = (current.getUTCFullYear() - first.getUTCFullYear()) * 12 + current.getUTCMonth() - first.getUTCMonth();
  if (months % rule.interval !== 0) return false;
  // Для коротких месяцев берётся последний день месяца, но отсчёт всегда от исходного числа.
  return current.getUTCDate() === Math.min(first.getUTCDate(), daysInMonth(current.getUTCFullYear(), current.getUTCMonth()));
}

export function expandTask(task, rangeStart, rangeEnd) {
  const rule = normalizeRecurrence(task.recurrence);
  if (!rule) return task.date >= rangeStart && task.date <= rangeEnd ? [task] : [];
  const from = task.date > rangeStart ? task.date : rangeStart;
  const to = rule.until && rule.until < rangeEnd ? rule.until : rangeEnd;
  const instances = [];
  for (let day = from; day <= to; day = addDays(day, 1)) {
    if (!occursOn(rule, task.date, day)) continue;
    instances.push({
      ...task,
      recurrence: rule,
      date: day,
      deadline: "",
      status: rule.overrides[day] ?? DEFAULT_STATUS,
      occurrenceDate: day,
      seriesStart: task.date,
    });
  }
  return instances;
}

export function expandTasks(tasks, rangeStart, rangeEnd) {
  return tasks.flatMap((task) => expandTask(task, rangeStart, rangeEnd));
}

export function setOccurrenceStatus(task, date, status) {
  const rule = normalizeRecurrence(task.recurrence);
  if (!rule) return { ...task, status };
  const overrides = { ...rule.overrides };
  if (status === DEFAULT_STATUS) delete overrides[date];
  else overrides[date] = status;
  return { ...task, recurrence: { ...rule, overrides } };
}

// Серия заканчивается на выбранном экземпляре: прошлые и текущий остаются, будущие исчезают.
export function stopRecurrenceAfter(task, date) {
  const rule = normalizeRecurrence(task.recurrence);
  if (!rule) return task;
  return { ...task, recurrence: { ...rule, until: date } };
}

export function describeRecurrence(rawRule, startDate) {
  const rule = normalizeRecurrence(rawRule);
  if (!rule) return "";
  let text;
  if (rule.unit === "day") {
    text = rule.interval === 1 ? "Каждый день" : `Каждые ${rule.interval} дн.`;
  } else if (rule.unit === "week") {
    const days = rule.weekdays.map((day) => WEEKDAY_LABELS[day - 1]).join(", ");
    const every = rule.interval === 1 ? "Еженедельно" : `Каждые ${rule.interval} нед.`;
    text = days ? `${every}: ${days}` : every;
  } else {
    const day = Number(startDate?.slice(8, 10));
    text = rule.interval === 1 ? "Каждый месяц" : `Каждые ${rule.interval} мес.`;
    if (day) text += `, ${day}-го`;
  }
  return rule.until ? `${text} · до ${rule.until}` : text;
}

export function presetOf(rule) {
  if (!rule) return "none";
  if (rule.interval === 1 && rule.unit === "day") return "daily";
  if (rule.interval === 1 && rule.unit === "week") return rule.weekdays.length ? "weekdays" : "weekly";
  if (rule.interval === 1 && rule.unit === "month") return "monthly";
  return "custom";
}

export function recurrenceToForm(rawRule) {
  const rule = normalizeRecurrence(rawRule);
  return {
    preset: presetOf(rule),
    unit: rule?.unit ?? "day",
    interval: rule?.interval ?? 1,
    weekdays: rule?.weekdays ?? [],
    until: rule?.until ?? "",
  };
}

// Возвращает { rule } или { error }. Статусы экземпляров переносятся только для дат, которые остались в серии.
export function buildRecurrence(form, startDate, previousRule) {
  if (!form || form.preset === "none") return { rule: null };
  const presets = {
    daily: { unit: "day", interval: 1, weekdays: [] },
    weekly: { unit: "week", interval: 1, weekdays: [] },
    weekdays: { unit: "week", interval: 1, weekdays: form.weekdays },
    monthly: { unit: "month", interval: 1, weekdays: [] },
    custom: { unit: form.unit, interval: Number(form.interval), weekdays: form.unit === "week" ? form.weekdays : [] },
  };
  const base = presets[form.preset];
  if (!base) return { error: "Выберите правило повторения." };
  if (form.preset === "weekdays" && !form.weekdays.length) return { error: "Выберите хотя бы один день недели." };
  if (form.preset === "custom" && !(Number.isInteger(base.interval) && base.interval >= 1 && base.interval <= MAX_INTERVAL)) {
    return { error: `Интервал должен быть целым числом от 1 до ${MAX_INTERVAL}.` };
  }
  if (form.until && form.until < startDate) return { error: "Дата окончания не может быть раньше даты начала." };
  const rule = normalizeRecurrence({ ...base, until: form.until });
  const previous = normalizeRecurrence(previousRule);
  for (const [date, status] of Object.entries(previous?.overrides ?? {})) {
    if (occursOn(rule, startDate, date)) rule.overrides[date] = status;
  }
  return { rule };
}

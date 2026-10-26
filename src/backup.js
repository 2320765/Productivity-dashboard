import { createId } from "./dashboard.js";
import { reconcileRelationships, PRIORITIES, STATUSES, GOAL_PERIODS } from "./dashboard.js";
import { describeRecurrence, normalizeRecurrence } from "./recurrence.js";
import { normalizeReminder } from "./reminders.js";

export const BACKUP_APP = "dayflow";
export const BACKUP_KIND = "dashboard-backup";
export const BACKUP_VERSION = 1;
export const MAX_BACKUP_BYTES = 25 * 1024 * 1024;
export const MAX_RECORDS = 50_000;
export const IMPORT_MODES = ["merge", "copy", "replace"];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DEADLINE_RE = /^\d{4}-\d{2}-\d{2}(T([01]\d|2[0-3]):[0-5]\d)?$/;
const LIMITS = { id: 120, title: 500, category: 100, notes: 20_000 };

function isRealDate(value) {
  if (typeof value !== "string" || !DATE_RE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isTimestamp(value) {
  return typeof value === "string" && value.length <= 40 && !Number.isNaN(Date.parse(value));
}

// ---------- Экспорт ----------

// Белый список полей: токены, сессии и чужие идентификаторы в копию попасть не могут.
export function sanitizeGoal(goal) {
  return {
    id: goal.id,
    title: goal.title,
    period: goal.period,
    startDate: goal.startDate,
    endDate: goal.endDate,
    parentId: goal.parentId ?? null,
    priority: goal.priority,
    notes: goal.notes ?? "",
    archivedAt: goal.archivedAt ?? null,
  };
}

export function sanitizeTask(task) {
  const result = {
    id: task.id,
    title: task.title,
    category: task.category ?? "",
    date: task.date,
    time: task.time ?? "",
    deadline: task.deadline ?? "",
    priority: task.priority,
    status: task.status,
    notes: task.notes ?? "",
    goalId: task.goalId ?? null,
    archivedAt: task.archivedAt ?? null,
  };
  if (task.recurrence) result.recurrence = task.recurrence;
  if (task.reminder) result.reminder = task.reminder;
  if (task.moveCount) {
    result.movedFrom = task.movedFrom ?? null;
    result.movedAt = task.movedAt ?? null;
    result.moveCount = task.moveCount;
  }
  return result;
}

export function buildBackup(dashboard, { theme = "light", now = new Date() } = {}) {
  return {
    app: BACKUP_APP,
    kind: BACKUP_KIND,
    version: BACKUP_VERSION,
    exportedAt: now.toISOString(),
    settings: { theme: theme === "dark" ? "dark" : "light" },
    counts: { goals: dashboard.goals.length, tasks: dashboard.tasks.length },
    goals: dashboard.goals.map(sanitizeGoal),
    tasks: dashboard.tasks.map(sanitizeTask),
  };
}

export function backupToJson(backup) {
  return JSON.stringify(backup, null, 2);
}

// Значения, начинающиеся с = + - @ или управляющего символа, Excel/Sheets могут выполнить как формулу.
export function protectCsvCell(value) {
  const text = String(value ?? "");
  return /^[\s]*[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

function csvCell(value) {
  const text = protectCsvCell(value);
  return /[",\r\n;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const CSV_HEADERS = ["Название", "Дата", "Время", "Срок", "Статус", "Приоритет", "Категория", "Цель", "Повтор", "Напоминание", "Заметки", "В архиве", "ID"];

function describeReminder(reminder) {
  if (!reminder || reminder.mode === "none") return "";
  return reminder.mode === "at" ? "В момент задачи" : `За ${reminder.minutes} мин`;
}

export function tasksToCsv(tasks, goals) {
  const goalTitles = new Map(goals.map((goal) => [goal.id, goal.title]));
  const rows = tasks.map((task) => [
    task.title,
    task.date,
    task.time ?? "",
    task.deadline ?? "",
    task.status,
    task.priority,
    task.category ?? "",
    task.goalId ? goalTitles.get(task.goalId) ?? "" : "",
    task.recurrence ? describeRecurrence(task.recurrence, task.date) : "",
    describeReminder(task.reminder),
    task.notes ?? "",
    task.archivedAt ? "Да" : "Нет",
    task.id,
  ]);
  const lines = [CSV_HEADERS, ...rows].map((row) => row.map(csvCell).join(";"));
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

export function backupFileName(kind, now = new Date()) {
  const stamp = now.toISOString().slice(0, 10);
  return kind === "csv" ? `dayflow-tasks-${stamp}.csv` : `dayflow-backup-${stamp}.json`;
}

// ---------- Разбор и валидация ----------

const yieldToUi = () => new Promise((resolve) => setTimeout(resolve, 0));

function checkText(value, field, max, { required = false, allowEmpty = true } = {}) {
  if (value === undefined || value === null) return required ? `поле «${field}» отсутствует` : null;
  if (typeof value !== "string") return `поле «${field}» должно быть строкой`;
  if (required && !allowEmpty && !value.trim()) return `поле «${field}» пустое`;
  if (value.length > max) return `поле «${field}» длиннее ${max} символов`;
  return null;
}

function validateGoal(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { error: "запись не является объектом" };
  const problems = [
    checkText(raw.id, "id", LIMITS.id, { required: true, allowEmpty: false }),
    checkText(raw.title, "title", LIMITS.title, { required: true, allowEmpty: false }),
    checkText(raw.notes, "notes", LIMITS.notes),
  ].filter(Boolean);
  if (!GOAL_PERIODS.includes(raw.period)) problems.push("неизвестный период цели");
  if (!PRIORITIES.includes(raw.priority)) problems.push("неизвестный приоритет");
  if (!isRealDate(raw.startDate) || !isRealDate(raw.endDate)) problems.push("даты должны быть в формате ГГГГ-ММ-ДД");
  else if (raw.endDate < raw.startDate) problems.push("дата окончания раньше начала");
  if (raw.archivedAt && !isTimestamp(raw.archivedAt)) problems.push("некорректная дата архивации");
  if (problems.length) return { error: problems.join("; ") };
  return {
    value: {
      id: raw.id,
      title: raw.title.trim(),
      period: raw.period,
      startDate: raw.startDate,
      endDate: raw.endDate,
      parentId: typeof raw.parentId === "string" && raw.parentId ? raw.parentId : null,
      priority: raw.priority,
      notes: raw.notes ?? "",
      ...(raw.archivedAt ? { archivedAt: raw.archivedAt } : {}),
    },
  };
}

function validateTask(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { error: "запись не является объектом" };
  const problems = [
    checkText(raw.id, "id", LIMITS.id, { required: true, allowEmpty: false }),
    checkText(raw.title, "title", LIMITS.title, { required: true, allowEmpty: false }),
    checkText(raw.category, "category", LIMITS.category),
    checkText(raw.notes, "notes", LIMITS.notes),
  ].filter(Boolean);
  if (!isRealDate(raw.date)) problems.push("дата должна быть в формате ГГГГ-ММ-ДД");
  if (raw.time && !TIME_RE.test(raw.time)) problems.push("время должно быть в формате ЧЧ:ММ");
  if (raw.deadline && !DEADLINE_RE.test(raw.deadline)) problems.push("некорректный срок");
  if (!PRIORITIES.includes(raw.priority)) problems.push("неизвестный приоритет");
  if (!STATUSES.includes(raw.status)) problems.push("неизвестный статус");
  if (raw.archivedAt && !isTimestamp(raw.archivedAt)) problems.push("некорректная дата архивации");
  if (raw.recurrence && !normalizeRecurrence(raw.recurrence)) problems.push("некорректное правило повторения");
  if (problems.length) return { error: problems.join("; ") };
  const reminder = raw.reminder ? normalizeReminder(raw.reminder) : null;
  const moveCount = Number.isInteger(raw.moveCount) && raw.moveCount > 0 ? raw.moveCount : 0;
  return {
    value: {
      id: raw.id,
      title: raw.title.trim(),
      category: raw.category || "Личное",
      date: raw.date,
      time: raw.time ?? "",
      deadline: raw.deadline ?? "",
      priority: raw.priority,
      status: raw.status,
      notes: raw.notes ?? "",
      goalId: typeof raw.goalId === "string" && raw.goalId ? raw.goalId : null,
      ...(raw.archivedAt ? { archivedAt: raw.archivedAt } : {}),
      ...(raw.recurrence ? { recurrence: normalizeRecurrence(raw.recurrence) } : {}),
      ...(reminder && reminder.mode !== "none" ? { reminder } : {}),
      ...(moveCount ? {
        movedFrom: isRealDate(raw.movedFrom) ? raw.movedFrom : null,
        movedAt: isTimestamp(raw.movedAt) ? raw.movedAt : null,
        moveCount,
      } : {}),
    },
  };
}

async function validateList(list, validate, label, errors, seen) {
  const valid = [];
  for (let index = 0; index < list.length; index += 1) {
    if (index > 0 && index % 1000 === 0) await yieldToUi();
    const { value, error } = validate(list[index]);
    const where = `${label} №${index + 1}${list[index]?.title ? ` «${String(list[index].title).slice(0, 40)}»` : ""}`;
    if (error) {
      errors.push(`${where}: ${error}`);
    } else if (seen.has(value.id)) {
      errors.push(`${where}: повторяющийся id — запись пропущена`);
    } else {
      seen.add(value.id);
      valid.push(value);
    }
  }
  return valid;
}

// Возвращает { ok, backup, errors, warnings }. Повреждённые записи пропускаются и попадают в отчёт; битая структура файла — ok: false.
export async function parseBackup(text) {
  const errors = [];
  const warnings = [];
  if (typeof text !== "string" || !text.trim()) return { ok: false, errors: ["Файл пустой."], warnings };
  if (text.length > MAX_BACKUP_BYTES) return { ok: false, errors: ["Файл слишком большой (максимум 25 МБ)."], warnings };

  let data;
  try {
    data = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch {
    return { ok: false, errors: ["Файл повреждён: это не корректный JSON."], warnings };
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return { ok: false, errors: ["Неверная структура файла."], warnings };
  if (data.app !== BACKUP_APP || data.kind !== BACKUP_KIND) return { ok: false, errors: ["Это не резервная копия Dayflow."], warnings };
  if (!Number.isInteger(data.version) || data.version > BACKUP_VERSION || data.version < 1) {
    return { ok: false, errors: [`Неподдерживаемая версия копии: ${data.version}.`], warnings };
  }
  if (!Array.isArray(data.goals) || !Array.isArray(data.tasks)) return { ok: false, errors: ["В файле нет списков целей и задач."], warnings };
  if (data.goals.length + data.tasks.length > MAX_RECORDS) return { ok: false, errors: [`Слишком много записей (максимум ${MAX_RECORDS}).`], warnings };

  const goals = await validateList(data.goals, validateGoal, "Цель", errors, new Set());
  const tasks = await validateList(data.tasks, validateTask, "Задача", errors, new Set());

  const theme = data.settings?.theme === "dark" || data.settings?.theme === "light" ? data.settings.theme : null;
  const skipped = errors.length;
  if (skipped) warnings.push(`Пропущено повреждённых записей: ${skipped}.`);
  return { ok: true, backup: { goals, tasks, theme, exportedAt: typeof data.exportedAt === "string" ? data.exportedAt : "" }, errors, warnings };
}

// ---------- План импорта ----------

function sameRecord(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function uniqueId(used) {
  let id = createId();
  while (used.has(id)) id = createId();
  used.add(id);
  return id;
}

function countLinkFixes(before, after) {
  let fixed = 0;
  const goalsAfter = new Map(after.goals.map((goal) => [goal.id, goal]));
  const tasksAfter = new Map(after.tasks.map((task) => [task.id, task]));
  for (const goal of before.goals) if (goal.parentId && goalsAfter.get(goal.id)?.parentId !== goal.parentId) fixed += 1;
  for (const task of before.tasks) if (task.goalId && tasksAfter.get(task.id)?.goalId !== task.goalId) fixed += 1;
  return fixed;
}

// mode: "merge" — добавить новые и обновить совпавшие по id; "copy" — добавить всё как новые записи; "replace" — полностью заменить текущие данные.
export function planImport(current, backup, mode = "merge") {
  if (!IMPORT_MODES.includes(mode)) throw new Error(`Неизвестный режим импорта: ${mode}`);
  const summary = {
    mode,
    goals: { added: 0, updated: 0, unchanged: 0, removed: 0 },
    tasks: { added: 0, updated: 0, unchanged: 0, removed: 0 },
    possibleDuplicates: 0,
    linksCleared: 0,
    warnings: [],
  };

  const incomingGoalIds = new Set(backup.goals.map((goal) => goal.id));
  const incomingTaskIds = new Set(backup.tasks.map((task) => task.id));
  let incoming = { goals: backup.goals, tasks: backup.tasks };

  if (mode === "copy") {
    const used = new Set([...current.goals.map((goal) => goal.id), ...current.tasks.map((task) => task.id)]);
    const goalMap = new Map();
    for (const goal of backup.goals) goalMap.set(goal.id, uniqueId(used));
    incoming = {
      goals: backup.goals.map((goal) => ({ ...goal, id: goalMap.get(goal.id), parentId: goal.parentId ? goalMap.get(goal.parentId) ?? null : null })),
      tasks: backup.tasks.map((task) => ({ ...task, id: uniqueId(used), goalId: task.goalId ? goalMap.get(task.goalId) ?? null : null })),
    };
  }

  const currentGoals = new Map(current.goals.map((goal) => [goal.id, goal]));
  const currentTasks = new Map(current.tasks.map((task) => [task.id, task]));
  const mergedGoals = new Map(mode === "replace" ? [] : currentGoals);
  const mergedTasks = new Map(mode === "replace" ? [] : currentTasks);

  for (const goal of incoming.goals) {
    const existing = currentGoals.get(goal.id);
    if (!existing) summary.goals.added += 1;
    else if (sameRecord(existing, goal)) summary.goals.unchanged += 1;
    else summary.goals.updated += 1;
    mergedGoals.set(goal.id, goal);
  }
  for (const task of incoming.tasks) {
    const existing = currentTasks.get(task.id);
    if (!existing) summary.tasks.added += 1;
    else if (sameRecord(existing, task)) summary.tasks.unchanged += 1;
    else summary.tasks.updated += 1;
    mergedTasks.set(task.id, task);
  }
  if (mode === "replace") {
    summary.goals.removed = current.goals.filter((goal) => !incomingGoalIds.has(goal.id)).length;
    summary.tasks.removed = current.tasks.filter((task) => !incomingTaskIds.has(task.id)).length;
  }
  if (mode === "copy") {
    const keys = new Set(current.tasks.map((task) => `${task.title}|${task.date}`));
    summary.possibleDuplicates = incoming.tasks.filter((task) => keys.has(`${task.title}|${task.date}`)).length;
    if (summary.possibleDuplicates) summary.warnings.push(`${summary.possibleDuplicates} задач совпадают по названию и дате с текущими — они будут добавлены как копии.`);
  }

  const before = { goals: [...mergedGoals.values()], tasks: [...mergedTasks.values()] };
  const dashboard = reconcileRelationships(before.goals, before.tasks);
  summary.linksCleared = countLinkFixes(before, dashboard);
  if (summary.linksCleared) summary.warnings.push(`Связей, ссылающихся на отсутствующие или несовместимые цели, очищено: ${summary.linksCleared}.`);

  const changes = summary.goals.added + summary.goals.updated + summary.tasks.added + summary.tasks.updated + summary.goals.removed + summary.tasks.removed;
  return { summary, dashboard, hasChanges: changes > 0 };
}

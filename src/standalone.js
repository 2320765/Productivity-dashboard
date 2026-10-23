import "./index.css";
import "./App.css";
import {
  createId,
  formatPeriod,
  getGoalDefaultRange,
  getGoalProgress,
  getNavigationTarget,
  getPeriodRange,
  GOAL_PERIODS,
  LEGACY_STORAGE_KEY,
  loadDashboard,
  localDateString,
  PRIORITIES,
  reconcileRelationships,
  STATUSES,
  STORAGE_KEY,
  THEME_KEY,
} from "./dashboard.js";

const root = document.querySelector("#root");
const viewOptions = [
  ["year", "Год"],
  ["month", "Месяц"],
  ["week", "Неделя"],
  ["day", "День"],
];
const periodLabels = { month: "Месяц", week: "Неделя", day: "День" };
const categories = ["Работа", "Личное", "Учёба", "Здоровье"];
const priorityOrder = { Высокий: 0, Средний: 1, Низкий: 2 };
const state = {
  dashboard: loadDashboard(),
  theme: loadTheme(),
  view: "day",
  selectedDate: localDateString(),
  sort: { key: "date", direction: "asc" },
  search: "",
  dialog: null,
};

function loadTheme() {
  try {
    return localStorage.getItem(THEME_KEY) === "dark" ? "dark" : "light";
  } catch (error) {
    console.error("Не удалось загрузить тему дашборда:", error);
    return "light";
  }
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

function icon(name, size = 16) {
  const paths = {
    sparkle: '<path d="m12 3 1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2L12 3Z"/><path d="m19 14 1.1 2.9L23 18l-2.9 1.1L19 22l-1.1-2.9L15 18l2.9-1.1L19 14Z"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18"/>',
    moon: '<path d="M20.9 13A9 9 0 0 1 11 3.1 9 9 0 1 0 20.9 13Z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
    list: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6h.01M4 12h.01M4 18h.01"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    left: '<path d="m15 18-6-6 6-6"/>',
    right: '<path d="m9 18 6-6-6-6"/>',
    arrow: '<path d="M5 12h14m-7-7 7 7-7 7"/>',
    sort: '<path d="m8 7 4-4 4 4M12 3v18m4-4-4 4-4-4"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    circle: '<circle cx="12" cy="12" r="9" fill="currentColor" stroke="none"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
    close: '<path d="m18 6-12 12M6 6l12 12"/>',
    trash: '<path d="M3 6h18m-2 0-.9 14H5.9L5 6m4 0V4h6v2m-5 4v6m4-6v6"/>',
    edit: '<path d="m15 5 4 4M4 20l4-.8L19 8a2.1 2.1 0 0 0-3-3L5 16l-1 4Z"/>',
    save: '<path d="m5 12 4 4L19 6"/>',
  };
  return `<svg aria-hidden="true" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths[name] ?? ""}</svg>`;
}

function persistDashboard() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.dashboard));
  } catch (error) {
    console.error("Не удалось сохранить дашборд в localStorage:", error);
  }
}

function persistTheme() {
  try {
    localStorage.setItem(THEME_KEY, state.theme);
  } catch (error) {
    console.error("Не удалось сохранить тему дашборда:", error);
  }
}

function progressBar(percent, compact = false) {
  return `<div class="progress-track${compact ? " progress-track-compact" : ""}" aria-label="Прогресс ${percent}%"><span style="width:${percent}%"></span></div>`;
}

function optionList(items, selected) {
  return items.map((item) => {
    const value = typeof item === "object" ? item.value : item;
    const label = typeof item === "object" ? item.label : item;
    return `<option value="${escapeHtml(value)}"${value === selected ? " selected" : ""}>${escapeHtml(label)}</option>`;
  }).join("");
}

function selectField(label, name, items, selected, wide = false) {
  return `<label class="field${wide ? " field-wide" : ""}"><span>${label}</span><select name="${name}">${optionList(items, selected)}</select></label>`;
}

function inputField(label, name, value, type = "text", wide = false, attrs = "") {
  return `<label class="field${wide ? " field-wide" : ""}"><span>${label}</span><input name="${name}" type="${type}" value="${escapeHtml(value)}" ${attrs}></label>`;
}

function matchingParents(period, startDate, endDate, goalId) {
  const parentPeriod = period === "week" ? "month" : period === "day" ? "week" : null;
  if (!parentPeriod) return [];
  return state.dashboard.goals.filter((goal) =>
    goal.id !== goalId &&
    goal.period === parentPeriod &&
    startDate >= goal.startDate &&
    endDate <= goal.endDate);
}

function goalDialogHtml() {
  const editing = state.dialog?.type === "goal" && state.dialog.id;
  const goal = editing ? state.dashboard.goals.find((item) => item.id === state.dialog.id) : null;
  const draft = state.dialog?.draft ?? {};
  const period = draft.period ?? goal?.period ?? "month";
  const range = getGoalDefaultRange(state.selectedDate, period);
  const startDate = draft.startDate ?? goal?.startDate ?? range.start;
  const endDate = draft.endDate ?? goal?.endDate ?? range.end;
  const parentPeriod = period === "week" ? "month" : period === "day" ? "week" : null;
  const parents = matchingParents(period, startDate, endDate, goal?.id);
  const parentId = draft.parentId ?? goal?.parentId ?? "";
  const parentField = parentPeriod
    ? `<label class="field field-wide"><span>Связать с целью · необязательно</span><select name="parentId"><option value="">Без связи</option>${parents.map((parent) => `<option value="${escapeHtml(parent.id)}"${parent.id === parentId ? " selected" : ""}>${escapeHtml(parent.title)}</option>`).join("")}</select><small>${parents.length ? `Можно связать с целью на уровень выше (${periodLabels[parentPeriod].toLowerCase()}).` : `Сначала создайте цель на уровень выше (${periodLabels[parentPeriod].toLowerCase()}) для этой даты.`}</small></label>`
    : "";
  return `<div class="modal-backdrop" data-action="backdrop"><section class="modal-card" role="dialog" aria-modal="true" aria-labelledby="modal-title"><header class="modal-header"><div><h2 id="modal-title">${goal ? "Изменить цель" : "Новая цель"}</h2><p>Свяжите цель с родительской, чтобы видеть общий прогресс.</p></div><button class="icon-button" type="button" data-action="close-dialog" aria-label="Закрыть">${icon("close", 19)}</button></header><form class="dialog-form" data-form="goal">
    <label class="field field-wide"><span>Название цели</span><input name="title" required autofocus value="${escapeHtml(draft.title ?? goal?.title ?? "")}" placeholder="Например, запустить личный сайт"></label>
    ${selectField("Период", "period", GOAL_PERIODS.map((item) => ({ value: item, label: periodLabels[item] })), period, false)}
    ${selectField("Приоритет", "priority", PRIORITIES, draft.priority ?? goal?.priority ?? "Средний")}
    ${inputField("Начало", "startDate", startDate, "date", false, "required")}
    ${inputField("Конец", "endDate", endDate, "date", false, `required min="${escapeHtml(startDate)}"`)}
    ${parentField}
    <label class="field field-wide"><span>Заметки</span><textarea name="notes" rows="3" placeholder="Что поможет достичь цели?">${escapeHtml(draft.notes ?? goal?.notes ?? "")}</textarea></label>
    <div class="dialog-actions field-wide"><button type="button" class="button button-quiet" data-action="close-dialog">Отмена</button><button type="submit" class="button button-primary">${icon("save", 17)} Сохранить цель</button></div>
  </form></section></div>`;
}

function taskDialogHtml() {
  const editing = state.dialog?.type === "task" && state.dialog.id;
  const task = editing ? state.dashboard.tasks.find((item) => item.id === state.dialog.id) : null;
  const draft = state.dialog?.draft ?? {};
  const taskDate = draft.date ?? task?.date ?? state.selectedDate;
  const availableGoals = state.dashboard.goals.filter((goal) => taskDate >= goal.startDate && taskDate <= goal.endDate);
  const selectedGoalId = draft.goalId ?? task?.goalId ?? "";
  const goalOptions = [{ value: "", label: "Без связи" }, ...availableGoals.map((goal) => ({
    value: goal.id,
    label: `${periodLabels[goal.period]} · ${goal.title}`,
  }))];
  return `<div class="modal-backdrop" data-action="backdrop"><section class="modal-card" role="dialog" aria-modal="true" aria-labelledby="modal-title"><header class="modal-header"><div><h2 id="modal-title">${task ? "Изменить задачу" : "Новая задача"}</h2><p>Выберите срок, приоритет и цель, к которой относится задача.</p></div><button class="icon-button" type="button" data-action="close-dialog" aria-label="Закрыть">${icon("close", 19)}</button></header><form class="dialog-form" data-form="task">
    <label class="field field-wide"><span>Название задачи</span><input name="title" required autofocus value="${escapeHtml(draft.title ?? task?.title ?? "")}" placeholder="Что нужно сделать?"></label>
    ${inputField("Дата", "date", taskDate, "date", false, "required")}
    ${inputField("Время", "time", draft.time ?? task?.time ?? "", "time")}
    ${inputField("Срок выполнения", "deadline", draft.deadline ?? task?.deadline ?? "", "datetime-local")}
    ${selectField("Приоритет", "priority", PRIORITIES, draft.priority ?? task?.priority ?? "Средний")}
    ${selectField("Статус", "status", STATUSES, draft.status ?? task?.status ?? "К выполнению")}
    ${selectField("Категория", "category", categories, draft.category ?? task?.category ?? "Работа")}
    <label class="field field-wide"><span>Связанная цель · необязательно</span><select name="goalId">${optionList(goalOptions, availableGoals.some((goal) => goal.id === selectedGoalId) ? selectedGoalId : "")}</select></label>
    <label class="field field-wide"><span>Заметки</span><textarea name="notes" rows="3" placeholder="Дополнительные детали">${escapeHtml(draft.notes ?? task?.notes ?? "")}</textarea></label>
    <div class="dialog-actions field-wide"><button type="button" class="button button-quiet" data-action="close-dialog">Отмена</button><button type="submit" class="button button-primary">${icon("save", 17)} Сохранить задачу</button></div>
  </form></section></div>`;
}

function visibleData() {
  const { goals, tasks } = state.dashboard;
  const range = getPeriodRange(state.selectedDate, state.view);
  const term = state.search.trim().toLocaleLowerCase("ru");
  const visibleTasks = tasks
    .filter((task) => task.date >= range.start && task.date <= range.end &&
      (!term || `${task.title} ${task.category} ${task.notes}`.toLocaleLowerCase("ru").includes(term)))
    .sort((a, b) => {
      const direction = state.sort.direction === "asc" ? 1 : -1;
      if (state.sort.key === "priority") {
        return ((priorityOrder[a.priority] ?? 1) - (priorityOrder[b.priority] ?? 1)) * direction;
      }
      if (state.sort.key === "status") {
        return (STATUSES.indexOf(a.status) - STATUSES.indexOf(b.status)) * direction;
      }
      const left = state.sort.key === "title" ? a.title : `${a.date} ${a.time}`;
      const right = state.sort.key === "title" ? b.title : `${b.date} ${b.time}`;
      return String(left).localeCompare(String(right), "ru") * direction;
    });
  const selected = new Set(goals
    .filter((goal) => state.view === "year"
      ? goal.period === "month" && goal.startDate <= range.end && goal.endDate >= range.start
      : goal.startDate <= range.end && goal.endDate >= range.start)
    .map((goal) => goal.id));
  const goalsById = new Map(goals.map((goal) => [goal.id, goal]));
  for (const id of [...selected]) {
    let goal = goalsById.get(id);
    while (goal?.parentId && !selected.has(goal.parentId)) {
      selected.add(goal.parentId);
      goal = goalsById.get(goal.parentId);
    }
  }
  const visibleGoals = goals
    .filter((goal) => selected.has(goal.id))
    .sort((a, b) => GOAL_PERIODS.indexOf(a.period) - GOAL_PERIODS.indexOf(b.period) || a.startDate.localeCompare(b.startDate));
  const completed = visibleTasks.filter((task) => task.status === "Выполнено").length;
  return { range, visibleTasks, visibleGoals, completed, progress: visibleTasks.length ? Math.round(completed / visibleTasks.length * 100) : 0 };
}

function yearOverview() {
  const year = Number(state.selectedDate.slice(0, 4));
  const months = Array.from({ length: 12 }, (_, index) => new Date(year, index, 1, 12));
  const goalsInYear = state.dashboard.goals.filter((goal) => goal.period === "month" && goal.startDate.slice(0, 4) === String(year)).length;
  return `<section class="year-overview"><div class="section-heading year-heading"><div><span class="section-kicker">Годовой обзор</span><h2>Ваш год, месяц за месяцем</h2></div><span class="year-count">${goalsInYear} месячных целей</span></div><div class="month-grid">${months.map((month) => {
    const date = localDateString(month);
    const range = getPeriodRange(date, "month");
    const monthGoals = state.dashboard.goals.filter((goal) => goal.period === "month" && goal.startDate.slice(0, 7) === date.slice(0, 7));
    const monthTasks = state.dashboard.tasks.filter((task) => task.date >= range.start && task.date <= range.end);
    const done = monthTasks.filter((task) => task.status === "Выполнено").length;
    const monthName = new Intl.DateTimeFormat("ru-RU", { month: "long" }).format(month);
    return `<button type="button" class="month-card" data-action="choose-month" data-date="${date}"><span class="month-name">${monthName}</span><span class="month-data">${monthGoals.length} целей <b>·</b> ${monthTasks.length} задач</span>${progressBar(monthTasks.length ? Math.round(done / monthTasks.length * 100) : 0, true)}<span class="month-foot">${done} выполнено ${icon("right", 13)}</span></button>`;
  }).join("")}</div></section>`;
}

function goalsMarkup(goals, tasks) {
  if (!goals.length) {
    return `<div class="empty-state"><span class="empty-icon">${icon("target", 21)}</span><strong>На этот период целей пока нет</strong><span>Добавьте цель, чтобы разбить её на шаги и следить за прогрессом.</span><button type="button" class="button button-secondary" data-action="new-goal">${icon("plus", 16)} Создать цель</button></div>`;
  }
  return `<div class="goals-list">${goals.map((goal) => {
    const progress = getGoalProgress(goal.id, state.dashboard.goals, tasks);
    const parent = state.dashboard.goals.find((item) => item.id === goal.parentId);
    return `<article class="goal-card"><div class="goal-timeline"><span class="goal-dot goal-${goal.period}"></span><span class="goal-line"></span></div><div class="goal-content"><div class="goal-main"><div class="goal-title-row"><span class="period-badge badge-${goal.period}">${periodLabels[goal.period]}</span><h3>${escapeHtml(goal.title)}</h3><span class="priority-pill priority-${goal.priority}">${escapeHtml(goal.priority)}</span></div><p class="goal-dates">${escapeHtml(goal.startDate === goal.endDate ? goal.startDate : `${goal.startDate} — ${goal.endDate}`)}${parent ? `<span class="goal-parent">Связана с: ${escapeHtml(parent.title)}</span>` : ""}</p>${goal.notes ? `<p class="goal-notes">${escapeHtml(goal.notes)}</p>` : ""}<div class="goal-progress-row">${progressBar(progress.percent, true)}<span>${progress.total ? `${progress.completed}/${progress.total} задач · ${progress.percent}%` : "Пока нет связанных задач"}</span></div></div><div class="goal-actions"><button class="icon-button" type="button" data-action="edit-goal" data-id="${escapeHtml(goal.id)}" aria-label="Редактировать цель ${escapeHtml(goal.title)}" title="Редактировать">${icon("edit", 16)}</button><button class="icon-button danger-hover" type="button" data-action="delete-goal" data-id="${escapeHtml(goal.id)}" aria-label="Удалить цель ${escapeHtml(goal.title)}" title="Удалить">${icon("trash", 16)}</button></div></div></article>`;
  }).join("")}</div>`;
}

function taskRow(task) {
  const linkedGoal = state.dashboard.goals.find((goal) => goal.id === task.goalId);
  const statusClass = task.status === "Выполнено" ? "done" : task.status === "В процессе" ? "doing" : "todo";
  return `<tr class="${task.status === "Выполнено" ? "task-done" : ""}"><td class="check-col"><button type="button" class="task-check${task.status === "Выполнено" ? " checked" : ""}" data-action="toggle-task" data-id="${escapeHtml(task.id)}" aria-label="${task.status === "Выполнено" ? "Снять отметку" : "Отметить выполненной"}: ${escapeHtml(task.title)}">${task.status === "Выполнено" ? icon("check", 13) : ""}</button></td><td><div class="task-name">${escapeHtml(task.title)}</div><span class="task-category">${escapeHtml(task.category)}</span>${task.notes ? `<p class="table-note">${escapeHtml(task.notes)}</p>` : ""}</td><td><span class="task-date">${icon("calendar", 14)}${escapeHtml(task.date)}</span>${task.time ? `<span class="task-time">${icon("clock", 13)}${escapeHtml(task.time)}</span>` : ""}${task.deadline ? `<span class="task-deadline">Срок ${escapeHtml(task.deadline.replace("T", " "))}</span>` : ""}</td><td><span class="priority-pill priority-${task.priority}">${escapeHtml(task.priority)}</span></td><td><span class="status-pill status-${statusClass}">${icon("circle", 7)}${escapeHtml(task.status)}</span></td><td><span class="linked-goal">${linkedGoal ? `${icon("target", 13)}${escapeHtml(linkedGoal.title)}` : '<span class="unlinked">Без связи</span>'}</span></td><td class="row-actions"><button class="icon-button" type="button" data-action="edit-task" data-id="${escapeHtml(task.id)}" title="Редактировать задачу" aria-label="Редактировать задачу ${escapeHtml(task.title)}">${icon("edit", 16)}</button><button class="icon-button danger-hover" type="button" data-action="delete-task" data-id="${escapeHtml(task.id)}" title="Удалить задачу" aria-label="Удалить задачу ${escapeHtml(task.title)}">${icon("trash", 15)}</button></td></tr>`;
}

function render() {
  const { tasks } = state.dashboard;
  const { visibleTasks, visibleGoals, completed, progress } = visibleData();
  const today = new Intl.DateTimeFormat("ru-RU", { weekday: "long", day: "numeric", month: "long" }).format(new Date());
  const viewTabs = viewOptions.map(([id, label]) => `<button type="button" role="tab" aria-selected="${state.view === id}" class="view-tab${state.view === id ? " active" : ""}" data-action="set-view" data-view="${id}">${label}</button>`).join("");
  const taskTable = visibleTasks.length
    ? `<table class="task-table"><thead><tr><th class="check-col"><span class="sr-only">Выполнение</span></th><th><button type="button" data-action="sort" data-sort="title">Задача ${icon("sort", 13)}</button></th><th><button type="button" data-action="sort" data-sort="date">Дата и время ${icon("sort", 13)}</button></th><th><button type="button" data-action="sort" data-sort="priority">Приоритет ${icon("sort", 13)}</button></th><th><button type="button" data-action="sort" data-sort="status">Статус ${icon("sort", 13)}</button></th><th>Цель / заметки</th><th class="actions-col"><span class="sr-only">Действия</span></th></tr></thead><tbody>${visibleTasks.map(taskRow).join("")}</tbody></table>`
    : `<div class="table-empty"><span class="empty-icon">${icon("list", 20)}</span><strong>${state.search ? "Ничего не найдено" : "Задач пока нет"}</strong><span>${state.search ? "Попробуйте изменить запрос." : "Добавьте первую задачу для этого периода."}</span>${state.search ? "" : `<button type="button" class="button button-secondary" data-action="new-task">${icon("plus", 16)} Добавить задачу</button>`}</div>`;
  root.innerHTML = `<main class="app-shell" data-theme="${state.theme}"><div class="dashboard">
    <header class="topbar"><a href="#" class="brand" aria-label="Dayflow — начало"><span class="brand-mark">${icon("sparkle", 20)}</span><span><strong>dayflow</strong><small>твой день в фокусе</small></span></a><div class="topbar-actions"><span class="today-label">${icon("calendar", 15)} ${today}</span><button class="theme-toggle" type="button" data-action="toggle-theme" aria-label="Переключить тему" title="${state.theme === "light" ? "Тёмная тема" : "Светлая тема"}">${icon(state.theme === "light" ? "moon" : "sun", 17)}</button></div></header>
    <section class="welcome-panel"><div class="welcome-copy"><div class="eyebrow">${icon("sparkle", 14)} Личное пространство продуктивности</div><h1>Планы, которые становятся делом.</h1><p>Большая цель начинается с одного маленького шага.</p></div><div class="welcome-stat"><span class="stat-icon">${icon("check", 21)}</span><span><strong>${completed}<i> / ${visibleTasks.length}</i></strong><small>задач выполнено</small></span></div><div class="welcome-art" aria-hidden="true"><span></span><span></span><span></span></div></section>
    <section class="planner-bar" aria-label="Навигация по календарю"><div class="view-switch" role="tablist" aria-label="Выбрать период">${viewTabs}</div><div class="period-controls"><button type="button" class="icon-button" aria-label="Предыдущий период" data-action="navigate" data-amount="-1">${icon("left", 17)}</button><h2 class="period-title">${escapeHtml(formatPeriod(state.selectedDate, state.view))}</h2><button type="button" class="icon-button" aria-label="Следующий период" data-action="navigate" data-amount="1">${icon("right", 17)}</button><button type="button" class="button button-today" data-action="today">Сегодня</button></div></section>
    ${state.view === "year" ? yearOverview() : ""}
    <section class="summary-grid"><article class="summary-card"><span class="summary-icon purple">${icon("target", 19)}</span><span><small>Цели в периоде</small><strong>${visibleGoals.length}</strong></span></article><article class="summary-card"><span class="summary-icon green">${icon("list", 19)}</span><span><small>Задачи в периоде</small><strong>${visibleTasks.length}</strong></span></article><article class="summary-card summary-progress"><span class="summary-icon amber">${icon("check", 19)}</span><span class="summary-progress-copy"><small>Выполнено · ${progress}%</small><strong>${completed} из ${visibleTasks.length}</strong>${progressBar(progress)}</span></article></section>
    <section class="panel goals-panel"><div class="section-heading"><div><span class="section-kicker">Большое складывается из малого</span><h2>Цели</h2></div><button type="button" class="button button-primary" data-action="new-goal">${icon("plus", 17)} Новая цель</button></div>${goalsMarkup(visibleGoals, tasks)}</section>
    <section class="panel tasks-panel"><div class="section-heading task-heading"><div><span class="section-kicker">План на выбранный период</span><h2>Задачи</h2></div><div class="task-tools"><label class="search-box">${icon("search", 16)}<input id="task-search" value="${escapeHtml(state.search)}" placeholder="Найти задачу" aria-label="Поиск задач">${state.search ? `<button type="button" data-action="clear-search" aria-label="Очистить поиск">${icon("close", 14)}</button>` : ""}</label><button type="button" class="button button-primary" data-action="new-task">${icon("plus", 17)} Новая задача</button></div></div><div class="table-wrap">${taskTable}</div><footer class="table-footer"><span>${visibleTasks.length} задач · сортировка по нажатию на заголовок столбца</span><span>${icon("save", 14)} Сохранение включено</span></footer></section>
    <footer class="app-footer"><span>${icon("sparkle", 14)} Ваши планы остаются только в этом браузере</span><button type="button" data-action="clear-all">Очистить все данные</button></footer>
  </div>${state.dialog?.type === "goal" ? goalDialogHtml() : state.dialog?.type === "task" ? taskDialogHtml() : ""}</main>`;
}

function openDialog(type, id = null) {
  state.dialog = { type, id, draft: {} };
  render();
  root.querySelector("[autofocus]")?.focus();
}

function closeDialog() {
  state.dialog = null;
  render();
}

function saveGoal(form) {
  const goal = state.dialog.id
    ? state.dashboard.goals.find((item) => item.id === state.dialog.id)
    : null;
  const value = {
    ...goal,
    ...form,
    title: form.title.trim(),
    parentId: form.parentId || null,
    id: goal?.id ?? createId(),
  };
  state.dashboard = reconcileRelationships(
    goal
      ? state.dashboard.goals.map((item) => item.id === goal.id ? value : item)
      : [...state.dashboard.goals, value],
    state.dashboard.tasks,
  );
}

function saveTask(form) {
  const task = state.dialog.id
    ? state.dashboard.tasks.find((item) => item.id === state.dialog.id)
    : null;
  const value = {
    ...task,
    ...form,
    title: form.title.trim(),
    goalId: form.goalId || null,
    id: task?.id ?? createId(),
  };
  state.dashboard.tasks = task
    ? state.dashboard.tasks.map((item) => item.id === task.id ? value : item)
    : [...state.dashboard.tasks, value];
}

function readFormDraft(form) {
  return Object.fromEntries(new FormData(form).entries());
}

root.addEventListener("input", (event) => {
  if (event.target.id === "task-search") {
    state.search = event.target.value;
    render();
    const input = root.querySelector("#task-search");
    input?.focus();
    input?.setSelectionRange(state.search.length, state.search.length);
  } else if (event.target.form?.dataset.form && state.dialog) {
    state.dialog.draft = readFormDraft(event.target.form);
  }
});

root.addEventListener("change", (event) => {
  const form = event.target.form;
  if (!form?.dataset.form || !state.dialog) return;
  const draft = readFormDraft(form);
  if (state.dialog.type === "goal" && event.target.name === "period") {
    const range = getGoalDefaultRange(state.selectedDate, draft.period);
    const parents = matchingParents(draft.period, range.start, range.end, state.dialog.id);
    state.dialog.draft = {
      ...draft,
      startDate: range.start,
      endDate: range.end,
      parentId: parents.length === 1 ? parents[0].id : "",
    };
    render();
    root.querySelector('[name="startDate"]')?.focus();
  } else if (["startDate", "endDate", "date"].includes(event.target.name)) {
    state.dialog.draft = draft;
    render();
    root.querySelector(`[name="${event.target.name}"]`)?.focus();
  } else {
    state.dialog.draft = draft;
  }
});

root.addEventListener("submit", (event) => {
  const form = event.target.closest("form[data-form]");
  if (!form) return;
  event.preventDefault();
  const values = readFormDraft(form);
  if (!values.title?.trim()) return;
  if (form.dataset.form === "goal") {
    if (!values.startDate || !values.endDate || values.endDate < values.startDate) return;
    saveGoal(values);
  } else {
    if (!values.date) return;
    saveTask(values);
  }
  state.dialog = null;
  persistDashboard();
  render();
});

root.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const { action, id } = button.dataset;
  const goal = state.dashboard.goals.find((item) => item.id === id);
  const task = state.dashboard.tasks.find((item) => item.id === id);
  switch (action) {
    case "toggle-theme":
      state.theme = state.theme === "light" ? "dark" : "light";
      persistTheme();
      render();
      break;
    case "set-view":
      state.view = button.dataset.view;
      render();
      break;
    case "navigate":
      state.selectedDate = getNavigationTarget(state.selectedDate, state.view, Number(button.dataset.amount));
      render();
      break;
    case "today":
      state.view = "day";
      state.selectedDate = localDateString();
      render();
      break;
    case "choose-month":
      state.view = "month";
      state.selectedDate = button.dataset.date;
      render();
      break;
    case "new-goal":
      openDialog("goal");
      break;
    case "edit-goal":
      openDialog("goal", id);
      break;
    case "delete-goal":
      if (goal && confirm(`Удалить цель «${goal.title}»? Связанные задачи и подцели сохранятся без связи.`)) {
        state.dashboard.goals = state.dashboard.goals.filter((item) => item.id !== id)
          .map((item) => item.parentId === id ? { ...item, parentId: null } : item);
        state.dashboard.tasks = state.dashboard.tasks.map((item) => item.goalId === id ? { ...item, goalId: null } : item);
        persistDashboard();
        render();
      }
      break;
    case "new-task":
      openDialog("task");
      break;
    case "edit-task":
      openDialog("task", id);
      break;
    case "delete-task":
      if (task && confirm(`Удалить задачу «${task.title}»?`)) {
        state.dashboard.tasks = state.dashboard.tasks.filter((item) => item.id !== id);
        persistDashboard();
        render();
      }
      break;
    case "toggle-task":
      if (task) {
        task.status = task.status === "Выполнено" ? "К выполнению" : "Выполнено";
        persistDashboard();
        render();
      }
      break;
    case "sort": {
      const key = button.dataset.sort;
      state.sort = state.sort.key === key
        ? { key, direction: state.sort.direction === "asc" ? "desc" : "asc" }
        : { key, direction: "asc" };
      render();
      break;
    }
    case "clear-search":
      state.search = "";
      render();
      break;
    case "clear-all":
      if (confirm("Удалить все цели и задачи? Это действие нельзя отменить.")) {
        try {
          localStorage.removeItem(STORAGE_KEY);
          localStorage.removeItem(LEGACY_STORAGE_KEY);
        } catch (error) {
          console.error("Не удалось очистить данные дашборда:", error);
        }
        state.dashboard = { goals: [], tasks: [] };
        render();
      }
      break;
    case "close-dialog":
      closeDialog();
      break;
    case "backdrop":
      if (event.target === button) closeDialog();
      break;
    default:
      break;
  }
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && state.dialog) closeDialog();
});

render();

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUpDown,
  CalendarDays,
  Check,
  CheckCheck,
  ChevronDown,
  Circle,
  Clock3,
  ListTodo,
  LogOut,
  Moon,
  Plus,
  Search,
  Share2,
  Sparkles,
  Sun,
  Target,
  Trash2,
  Users,
  X,
} from "lucide-react";
import {
  createId,
  formatPeriod,
  getGoalDefaultRange,
  getGoalProgress,
  getNavigationTarget,
  getPeriodRange,
  GOAL_PERIODS,
  localDateString,
  mergeDashboards,
  PRIORITIES,
  reconcileRelationships,
  STATUSES,
  STORAGE_KEY,
  THEME_KEY,
} from "./dashboard.js";
import {
  loadWorkspaceOverview,
  loadWorkspaceRecords,
  loadRemoteDashboard,
  saveWorkspaceGoal,
  saveWorkspaceTask,
  supabase,
  supabaseConfigError,
  syncRemoteDashboard,
} from "./supabase.js";
import Workspaces from "./Workspaces.jsx";
import Friends from "./Friends.jsx";
import { getErrorMessage } from "./errorMessage.js";
import { readUserDashboard } from "./userDashboardStorage.js";
import "./App.css";

const VIEW_OPTIONS = [
  { id: "year", label: "Год" },
  { id: "month", label: "Месяц" },
  { id: "week", label: "Неделя" },
  { id: "day", label: "День" },
];
const PERIOD_LABELS = { year: "Год", month: "Месяц", week: "Неделя", day: "День" };
const CATEGORY_OPTIONS = ["Работа", "Личное", "Учёба", "Здоровье"];
const PRIORITY_ORDER = { Высокий: 0, Средний: 1, Низкий: 2 };
const EMPTY_DASHBOARD = { goals: [], tasks: [] };

function hasDashboardData(dashboard) {
  return dashboard.goals.length > 0 || dashboard.tasks.length > 0;
}

function dashboardsMatch(first, second) {
  const normalize = (dashboard) => ({
    goals: [...dashboard.goals].sort((a, b) => a.id.localeCompare(b.id)),
    tasks: [...dashboard.tasks].sort((a, b) => a.id.localeCompare(b.id)),
  });
  return JSON.stringify(normalize(first)) === JSON.stringify(normalize(second));
}

function AuthScreen({
  theme,
  setTheme,
  error,
  onClearError,
  loading,
  onSubmit,
}) {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [notice, setNotice] = useState("");

  async function submit(event) {
    event.preventDefault();
    setNotice("");
    await onSubmit(mode, email.trim(), password, setNotice);
  }

  return (
    <main className="app-shell" data-theme={theme}>
      <div className="dashboard">
        <header className="topbar">
          <a href="#" className="brand" aria-label="Dayflow — начало">
            <span className="brand-mark"><Sparkles size={20} /></span>
            <span><strong>dayflow</strong><small>твой день в фокусе</small></span>
          </a>
          <button className="theme-toggle" type="button" onClick={() => setTheme((current) => current === "light" ? "dark" : "light")} aria-label={theme === "light" ? "Включить тёмную тему" : "Включить светлую тему"}>
            {theme === "light" ? <Moon size={17} /> : <Sun size={17} />}
          </button>
        </header>
        <section className="auth-panel">
          <div className="auth-intro">
            <span className="eyebrow"><Sparkles size={14} /> Личное пространство продуктивности</span>
            <h1>{mode === "login" ? "С возвращением" : "Создайте аккаунт"}</h1>
            <p>Войдите, чтобы синхронизировать цели и задачи между устройствами.</p>
          </div>
          {supabaseConfigError && <p className="sync-alert" role="alert">{supabaseConfigError} Скопируйте .env.example в .env.local, укажите данные проекта и перезапустите Vite.</p>}
          <form className="auth-form" onSubmit={submit}>
            <label className="field">
              <span>Электронная почта</span>
              <input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
            </label>
            <label className="field">
              <span>Пароль</span>
              <input type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} minLength="6" required value={password} onChange={(event) => setPassword(event.target.value)} />
            </label>
            {error && <p className="sync-alert" role="alert">{error}<button type="button" onClick={onClearError} aria-label="Закрыть сообщение"><X size={15} /></button></p>}
            {notice && <p className="sync-notice" role="status">{notice}</p>}
            <button className="button button-primary auth-submit" type="submit" disabled={loading || Boolean(supabaseConfigError)}>
              {loading ? "Подождите…" : mode === "login" ? "Войти" : "Зарегистрироваться"}
            </button>
          </form>
          <button className="auth-switch" type="button" onClick={() => { setMode((current) => current === "login" ? "signup" : "login"); setNotice(""); onClearError(); }}>
            {mode === "login" ? "Нет аккаунта? Зарегистрироваться" : "Уже есть аккаунт? Войти"}
          </button>
        </section>
      </div>
    </main>
  );
}

function DashboardLoading({ theme, message, error, onRetry, onSignOut }) {
  return (
    <main className="app-shell" data-theme={theme}>
      <section className="auth-panel" role={error ? "alert" : "status"}>
        <div className="auth-intro">
          <span className="eyebrow"><Sparkles size={14} /> dayflow</span>
          <h1>{error ? "Не удалось загрузить данные" : "Загружаем ваше пространство…"}</h1>
          <p>{error ?? message}</p>
        </div>
        {error && <div className="auth-actions">
          <button className="button button-primary" type="button" onClick={onRetry}>Повторить загрузку</button>
          <button className="button button-secondary" type="button" onClick={onSignOut}>Выйти</button>
        </div>}
      </section>
    </main>
  );
}

function MigrationChoice({ theme, migration, onUseServer, onImportLocal }) {
  const hasServerData = hasDashboardData(migration.remote.dashboard);
  return (
    <main className="app-shell" data-theme={theme}>
      <section className="auth-panel migration-panel">
        <div className="auth-intro">
          <span className="eyebrow"><Sparkles size={14} /> Перенос данных</span>
          <h1>{hasServerData ? "Нашли разные версии данных" : "Нашли данные на этом устройстве"}</h1>
          <p>
            На устройстве: {migration.local.goals.length} целей и {migration.local.tasks.length} задач.
            {hasServerData && ` На сервере: ${migration.remote.dashboard.goals.length} целей и ${migration.remote.dashboard.tasks.length} задач.`}
            {" "}Локальная копия останется на устройстве.
          </p>
        </div>
        <div className="migration-actions">
          {hasServerData ? (
            <>
              <button className="button button-primary" type="button" onClick={onImportLocal}>Объединить данные</button>
              <button className="button button-secondary" type="button" onClick={onUseServer}>Использовать данные сервера</button>
              <small>Если записи с одинаковым ID различаются, сохранятся обе; локальной записи назначится новый ID, связи целей и задач будут обновлены.</small>
            </>
          ) : (
            <>
              <button className="button button-primary" type="button" onClick={onImportLocal}>Импортировать локальные данные</button>
              <button className="button button-secondary" type="button" onClick={onUseServer}>Начать с пустого дэшборда</button>
            </>
          )}
        </div>
      </section>
    </main>
  );
}

function matchingParents(period, startDate, endDate, goals, goalId) {
  const parentPeriod = period === "month"
    ? "year"
    : period === "week" ? "month" : period === "day" ? "week" : null;
  if (!parentPeriod) return [];
  return goals.filter(
    (item) =>
      item.id !== goalId &&
      item.period === parentPeriod &&
      startDate >= item.startDate &&
      endDate <= item.endDate,
  );
}

function loadTheme() {
  try {
    return globalThis.localStorage?.getItem(THEME_KEY) === "dark" ? "dark" : "light";
  } catch (error) {
    console.error("Не удалось загрузить тему дашборда:", error);
    return "light";
  }
}

function Modal({ title, subtitle, onClose, children }) {
  useEffect(() => {
    function onKeyDown(event) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <header className="modal-header">
          <div>
            <h2 id="modal-title">{title}</h2>
            <p>{subtitle}</p>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Закрыть">
            <X size={19} />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}

function GoalDialog({ goal, goals, selectedDate, workspaceOptions, overviewLoading, onClose, onSave }) {
  const [workspaceGoalsState, setWorkspaceGoals] = useState({ workspaceId: "", goals: [] });
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(() => {
    const range = getGoalDefaultRange(selectedDate, goal?.period ?? "month");
    return {
      title: goal?.title ?? "",
      period: goal?.period ?? "month",
      startDate: goal?.startDate ?? range.start,
      endDate: goal?.endDate ?? range.end,
      parentId: goal?.parentId ?? "",
      priority: goal?.priority ?? "Средний",
      notes: goal?.notes ?? "",
      workspaceId: "",
      destinationChosen: Boolean(goal),
    };
  });
  const workspaceGoals = workspaceGoalsState.workspaceId === form.workspaceId ? workspaceGoalsState.goals : [];
  const goalOptions = form.workspaceId ? workspaceGoals : goals;
  useEffect(() => {
    if (!form.workspaceId) return undefined;
    let active = true;
    loadWorkspaceRecords(form.workspaceId)
      .then((data) => {
        if (active) setWorkspaceGoals({ workspaceId: form.workspaceId, goals: data.goals });
      })
      .catch((error) => {
        if (active) setFormError(`Не удалось загрузить цели пространства: ${getErrorMessage(error)}`);
      })
      .finally(() => {
        if (active) setWorkspaceLoading(false);
      });
    return () => {
      active = false;
    };
  }, [form.workspaceId]);

  const parentPeriod = form.period === "month"
    ? "year"
    : form.period === "week" ? "month" : form.period === "day" ? "week" : null;
  const parents = matchingParents(form.period, form.startDate, form.endDate, goalOptions, goal?.id);

  function changePeriod(period) {
    const range = getGoalDefaultRange(selectedDate, period);
    const matching = matchingParents(period, range.start, range.end, goalOptions, goal?.id);
    setForm((current) => ({
      ...current,
      period,
      startDate: range.start,
      endDate: range.end,
      parentId: matching.length === 1 ? matching[0].id : "",
    }));
  }

  function changeDate(field, value) {
    const next = { ...form, [field]: value };
    const matching = matchingParents(next.period, next.startDate, next.endDate, goalOptions, goal?.id);
    setForm({
      ...next,
      parentId: matching.some((item) => item.id === form.parentId)
        ? form.parentId
        : matching.length === 1 ? matching[0].id : "",
    });
  }

  async function submit(event) {
    event.preventDefault();
    if (!form.destinationChosen) {
      setFormError("Выберите, где хранить цель: лично или в рабочем пространстве.");
      return;
    }
    if (!form.title.trim() || !form.startDate || !form.endDate || form.endDate < form.startDate) return;
    setSaving(true);
    setFormError("");
    try {
      await onSave({
        ...goal,
        ...form,
        title: form.title.trim(),
        parentId: form.parentId || null,
        id: goal?.id ?? createId(),
      });
      onClose();
    } catch (error) {
      setFormError(getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={goal ? "Изменить цель" : "Новая цель"}
      subtitle="Свяжите цель с родительской, чтобы видеть общий прогресс."
      onClose={onClose}
    >
      <form className="dialog-form" onSubmit={submit}>
        {!goal && overviewLoading && <p className="workspace-hint field-wide">Проверяем доступные пространства…</p>}
        {!goal && <label className="field field-wide"><span>Где хранить цель?</span><select required disabled={overviewLoading} value={!form.destinationChosen ? "" : form.workspaceId || "__personal__"} onChange={(event) => { const workspaceId = event.target.value === "__personal__" ? "" : event.target.value; setWorkspaceLoading(Boolean(workspaceId)); setForm({ ...form, workspaceId, destinationChosen: true, parentId: "" }); }}><option value="" disabled>Выберите назначение</option><option value="__personal__">Личное</option>{workspaceOptions.map((workspace) => <option key={workspace.id} value={workspace.id}>Пространство: {workspace.name}</option>)}</select><small>Личные цели видны только вам.</small></label>}
        <label className="field field-wide">
          <span>Название цели</span>
          <input autoFocus required value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="Например, запустить личный сайт" />
        </label>
        <label className="field">
          <span>Период</span>
          <select value={form.period} onChange={(event) => changePeriod(event.target.value)}>
            {GOAL_PERIODS.map((period) => <option key={period} value={period}>{PERIOD_LABELS[period]}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Приоритет</span>
          <select value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value })}>
            {PRIORITIES.map((priority) => <option key={priority}>{priority}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Начало</span>
          <input required type="date" value={form.startDate} onChange={(event) => changeDate("startDate", event.target.value)} />
        </label>
        <label className="field">
          <span>Конец</span>
          <input required type="date" min={form.startDate} value={form.endDate} onChange={(event) => changeDate("endDate", event.target.value)} />
        </label>
        {parentPeriod && (
          <label className="field field-wide">
            <span>Связать с целью · необязательно</span>
            <select disabled={workspaceLoading} value={parents.some((item) => item.id === form.parentId) ? form.parentId : ""} onChange={(event) => setForm({ ...form, parentId: event.target.value })}>
              <option value="">Без связи</option>
              {parents.map((parent) => <option value={parent.id} key={parent.id}>{parent.title}</option>)}
            </select>
            <small>{workspaceLoading ? "Загружаем цели пространства…" : parents.length ? `Можно связать с целью на уровень выше (${PERIOD_LABELS[parentPeriod].toLowerCase()}).` : `Сначала создайте цель на уровень выше (${PERIOD_LABELS[parentPeriod].toLowerCase()}) для этой даты.`}</small>
          </label>
        )}
        <label className="field field-wide">
          <span>Заметки</span>
          <textarea rows="3" value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="Что поможет достичь цели?" />
        </label>
        {formError && <p className="sync-alert field-wide" role="alert">{formError}</p>}
        <div className="dialog-actions field-wide">
          <button type="button" className="button button-quiet" onClick={onClose}>Отмена</button>
          <button type="submit" className="button button-primary" disabled={saving || workspaceLoading || (!goal && overviewLoading)}><Check size={17} /> {saving ? "Сохраняем…" : "Сохранить цель"}</button>
        </div>
      </form>
    </Modal>
  );
}

function TaskDialog({ task, goals, selectedDate, workspaceOptions, overviewLoading, userId, onClose, onSave }) {
  const [workspaceGoalsState, setWorkspaceGoals] = useState({ workspaceId: "", goals: [] });
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(() => ({
    title: task?.title ?? "",
    category: task?.category ?? "Работа",
    date: task?.date ?? selectedDate,
    time: task?.time ?? "",
    deadline: task?.deadline ?? "",
    priority: task?.priority ?? "Средний",
    status: task?.status ?? "К выполнению",
    notes: task?.notes ?? "",
    goalId: task?.goalId ?? "",
    workspaceId: "",
    destinationChosen: Boolean(task),
  }));
  const workspaceGoals = workspaceGoalsState.workspaceId === form.workspaceId ? workspaceGoalsState.goals : [];
  const goalOptions = form.workspaceId ? workspaceGoals : goals;
  const availableGoals = goalOptions.filter((goal) => form.date >= goal.startDate && form.date <= goal.endDate);

  useEffect(() => {
    if (!form.workspaceId) return undefined;
    let active = true;
    loadWorkspaceRecords(form.workspaceId)
      .then((data) => {
        if (active) setWorkspaceGoals({ workspaceId: form.workspaceId, goals: data.goals });
      })
      .catch((error) => {
        if (active) setFormError(`Не удалось загрузить цели пространства: ${getErrorMessage(error)}`);
      })
      .finally(() => {
        if (active) setWorkspaceLoading(false);
      });
    return () => {
      active = false;
    };
  }, [form.workspaceId]);

  async function submit(event) {
    event.preventDefault();
    if (!form.destinationChosen) {
      setFormError("Выберите, где хранить задачу: лично или в рабочем пространстве.");
      return;
    }
    if (!form.title.trim() || !form.date) return;
    setSaving(true);
    setFormError("");
    try {
      await onSave({ ...task, ...form, title: form.title.trim(), goalId: form.goalId || null, id: task?.id ?? createId(), assigneeId: userId });
      onClose();
    } catch (error) {
      setFormError(getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={task ? "Изменить задачу" : "Новая задача"}
      subtitle="Выберите срок, приоритет и цель, к которой относится задача."
      onClose={onClose}
    >
      <form className="dialog-form" onSubmit={submit}>
        {!task && overviewLoading && <p className="workspace-hint field-wide">Проверяем доступные пространства…</p>}
        {!task && <label className="field field-wide"><span>Где хранить задачу?</span><select required disabled={overviewLoading} value={!form.destinationChosen ? "" : form.workspaceId || "__personal__"} onChange={(event) => { const workspaceId = event.target.value === "__personal__" ? "" : event.target.value; setWorkspaceLoading(Boolean(workspaceId)); setForm({ ...form, workspaceId, destinationChosen: true, goalId: "" }); }}><option value="" disabled>Выберите назначение</option><option value="__personal__">Личное</option>{workspaceOptions.map((workspace) => <option key={workspace.id} value={workspace.id}>Пространство: {workspace.name}</option>)}</select><small>Личные задачи видны только вам.</small></label>}
        <label className="field field-wide">
          <span>Название задачи</span>
          <input autoFocus required value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="Что нужно сделать?" />
        </label>
        <label className="field">
          <span>Дата</span>
          <input required type="date" value={form.date} onChange={(event) => {
            const date = event.target.value;
            const keepsGoal = goalOptions.some((goal) => goal.id === form.goalId && date >= goal.startDate && date <= goal.endDate);
            setForm({ ...form, date, goalId: keepsGoal ? form.goalId : "" });
          }} />
        </label>
        <label className="field">
          <span>Время</span>
          <input type="time" value={form.time} onChange={(event) => setForm({ ...form, time: event.target.value })} />
        </label>
        <label className="field">
          <span>Срок выполнения</span>
          <input type="datetime-local" value={form.deadline} onChange={(event) => setForm({ ...form, deadline: event.target.value })} />
        </label>
        <label className="field">
          <span>Приоритет</span>
          <select value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value })}>
            {PRIORITIES.map((priority) => <option key={priority}>{priority}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Статус</span>
          <select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}>
            {STATUSES.map((status) => <option key={status}>{status}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Категория</span>
          <select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}>
            {CATEGORY_OPTIONS.map((category) => <option key={category}>{category}</option>)}
          </select>
        </label>
        <label className="field field-wide">
          <span>Связанная цель · необязательно</span>
          <select disabled={workspaceLoading} value={availableGoals.some((goal) => goal.id === form.goalId) ? form.goalId : ""} onChange={(event) => setForm({ ...form, goalId: event.target.value })}>
            <option value="">Без связи</option>
            {availableGoals.map((goal) => <option key={goal.id} value={goal.id}>{PERIOD_LABELS[goal.period]} · {goal.title}</option>)}
          </select>
        </label>
        <label className="field field-wide">
          <span>Заметки</span>
          <textarea rows="3" value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="Дополнительные детали" />
        </label>
        {formError && <p className="sync-alert field-wide" role="alert">{formError}</p>}
        <div className="dialog-actions field-wide">
          <button type="button" className="button button-quiet" onClick={onClose}>Отмена</button>
          <button type="submit" className="button button-primary" disabled={saving || workspaceLoading || (!task && overviewLoading)}><Check size={17} /> {saving ? "Сохраняем…" : "Сохранить задачу"}</button>
        </div>
      </form>
    </Modal>
  );
}

function TaskShareDialog({ task, workspaceOptions, onClose, onShare }) {
  const [workspaceId, setWorkspaceId] = useState(workspaceOptions[0]?.id ?? "");
  const [mode, setMode] = useState("copy");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(event) {
    event.preventDefault();
    const workspace = workspaceOptions.find((item) => item.id === workspaceId);
    if (!workspace) return;
    const action = mode === "move" ? "перенести" : "скопировать";
    if (!window.confirm(`${action[0].toLocaleUpperCase("ru")}${action.slice(1)} задачу «${task.title}» в пространство «${workspace.name}»?${mode === "move" ? " Личная задача будет удалена после успешного переноса." : ""}`)) return;
    setSaving(true);
    setError("");
    try {
      await onShare(task, workspaceId, mode);
      onClose();
    } catch (shareError) {
      setError(getErrorMessage(shareError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Перенести задачу в пространство" subtitle="Действие требует подтверждения. Связь с личной целью не переносится, личная цель останется приватной." onClose={onClose}>
      <form className="dialog-form" onSubmit={submit}>
        <label className="field field-wide"><span>Пространство назначения</span><select required value={workspaceId} onChange={(event) => setWorkspaceId(event.target.value)}>{workspaceOptions.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}</select></label>
        <label className="field field-wide"><span>Действие</span><select value={mode} onChange={(event) => setMode(event.target.value)}><option value="copy">Скопировать — оставить личную задачу</option><option value="move">Перенести — удалить личную после сохранения копии</option></select></label>
        {error && <p className="sync-alert field-wide" role="alert">{error}</p>}
        <div className="dialog-actions field-wide"><button className="button button-quiet" type="button" onClick={onClose}>Отмена</button><button className="button button-primary" type="submit" disabled={saving || !workspaceOptions.length}><Share2 size={16} />{saving ? "Сохраняем…" : mode === "move" ? "Подтвердить перенос" : "Подтвердить копирование"}</button></div>
      </form>
    </Modal>
  );
}

function ProgressBar({ percent, compact = false }) {
  return (
    <div className={`progress-track${compact ? " progress-track-compact" : ""}`} aria-label={`Прогресс ${percent}%`}>
      <span style={{ width: `${percent}%` }} />
    </div>
  );
}

function App() {
  const [dashboard, setDashboard] = useState(EMPTY_DASHBOARD);
  const [theme, setTheme] = useState(loadTheme);
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(!supabase);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [initializedUserId, setInitializedUserId] = useState(null);
  const [migration, setMigration] = useState(null);
  const [syncState, setSyncState] = useState("loading");
  const [syncError, setSyncError] = useState("");
  const [remoteConflict, setRemoteConflict] = useState(null);
  const [syncTrigger, setSyncTrigger] = useState(0);
  const [view, setView] = useState("day");
  const [selectedDate, setSelectedDate] = useState(localDateString());
  const [sort, setSort] = useState({ key: "date", direction: "asc" });
  const [search, setSearch] = useState("");
  const [goalDialog, setGoalDialog] = useState(undefined);
  const [taskDialog, setTaskDialog] = useState(undefined);
  const [taskShareDialog, setTaskShareDialog] = useState(null);
  const [activeSection, setActiveSection] = useState("dashboard");
  const [workspaceOverview, setWorkspaceOverview] = useState({ workspaces: [], invitations: [] });
  const [workspaceOverviewError, setWorkspaceOverviewError] = useState("");
  const [workspaceOverviewLoading, setWorkspaceOverviewLoading] = useState(false);
  const userId = user?.id;
  const refreshWorkspaceOverview = useCallback(async () => {
    if (!userId) return false;
    setWorkspaceOverviewLoading(true);
    try {
      const overview = await loadWorkspaceOverview(userId);
      setWorkspaceOverview(overview);
      setWorkspaceOverviewError("");
      return overview;
    } catch (error) {
      setWorkspaceOverviewError(`Не удалось обновить рабочие пространства: ${getErrorMessage(error)}`);
      return false;
    } finally {
      setWorkspaceOverviewLoading(false);
    }
  }, [userId]);
  const revisionRef = useRef(0);
  const skipSyncOnce = useRef(false);
  const dirtyRef = useRef(false);
  const syncInProgress = useRef(false);
  const latestDashboard = useRef(dashboard);
  latestDashboard.current = dashboard;

  useEffect(() => {
    if (!supabase) return undefined;

    let active = true;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (active) {
        setUser(session?.user ?? null);
        setAuthReady(true);
        setAuthError("");
      }
    });

    supabase.auth.getSession()
      .then(({ data, error }) => {
        if (!active) return;
        if (error) setAuthError(error.message);
        setUser(data.session?.user ?? null);
        setAuthReady(true);
      })
      .catch((error) => {
        if (!active) return;
        setAuthError(getErrorMessage(error));
        setAuthReady(true);
      });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!userId || !supabase) {
      setWorkspaceOverview({ workspaces: [], invitations: [] });
      setWorkspaceOverviewError("");
      return undefined;
    }
    let active = true;
    setWorkspaceOverviewLoading(true);
    loadWorkspaceOverview(userId)
      .then((overview) => {
        if (!active) return;
        setWorkspaceOverview(overview);
        setWorkspaceOverviewError("");
      })
      .catch((error) => {
        if (active) setWorkspaceOverviewError(`Не удалось загрузить рабочие пространства: ${getErrorMessage(error)}`);
      })
      .finally(() => {
        if (active) setWorkspaceOverviewLoading(false);
      });
    return () => {
      active = false;
    };
  }, [userId]);

  useEffect(() => {
    if (!userId || !supabase) return undefined;
    let active = true;
    async function refreshInvitations() {
      try {
        const overview = await loadWorkspaceOverview(userId);
        if (active) {
          setWorkspaceOverview(overview);
          setWorkspaceOverviewError("");
        }
      } catch (error) {
        if (active) setWorkspaceOverviewError(`Не удалось обновить приглашения: ${getErrorMessage(error)}`);
      }
    }

    const channel = supabase
      .channel(`workspace-invitations-${userId}`)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "workspace_invitations",
        filter: `invitee_id=eq.${userId}`,
      }, refreshInvitations)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "workspace_invitations",
        filter: `invited_by=eq.${userId}`,
      }, refreshInvitations)
      .subscribe((status, subscriptionError) => {
        if (active && (status === "CHANNEL_ERROR" || status === "TIMED_OUT")) {
          setWorkspaceOverviewError(`Подписка на приглашения недоступна: ${subscriptionError ? getErrorMessage(subscriptionError) : status}`);
        }
      });

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [userId]);

  useEffect(() => {
    if (!authReady || !userId || !supabase) return undefined;

    let active = true;
    setInitializedUserId(null);
    setMigration(null);
    setLoadError("");
    setSyncError("");
    setRemoteConflict(null);
    setSyncState("loading");
    setDashboard(EMPTY_DASHBOARD);
    dirtyRef.current = false;
    skipSyncOnce.current = false;

    async function initialize() {
      let local;
      try {
        local = readUserDashboard(userId);
      } catch (error) {
        if (active) setLoadError(`Не удалось прочитать локальные данные: ${getErrorMessage(error)}`);
        return;
      }

      try {
        const remote = await loadRemoteDashboard(userId);
        if (!active) return;
        revisionRef.current = remote.revision;
        const localHasData = local.exists && hasDashboardData(local.dashboard);
        const serverHasData = hasDashboardData(remote.dashboard);

        if (localHasData && (!serverHasData || !local.isScoped || (local.pending && !dashboardsMatch(local.dashboard, remote.dashboard)))) {
          setMigration({ local: local.dashboard, remote });
          return;
        }

        skipSyncOnce.current = true;
        setDashboard(remote.dashboard);
        setSyncState("synced");
        setInitializedUserId(userId);
      } catch (error) {
        if (!active) return;
        if (!local.exists) {
          setLoadError(`Не удалось загрузить данные с Supabase: ${getErrorMessage(error)}`);
          return;
        }

        revisionRef.current = local.revision;
        dirtyRef.current = local.pending;
        skipSyncOnce.current = !local.pending;
        setDashboard(local.dashboard);
        setSyncState("offline");
        setSyncError(`Сервер пока недоступен. Изменения останутся на устройстве: ${getErrorMessage(error)}`);
        setInitializedUserId(userId);
      }
    }

    initialize();
    return () => {
      active = false;
    };
  }, [authReady, userId, loadAttempt]);

  useEffect(() => {
    if (!userId || initializedUserId !== userId || !supabase) return undefined;
    const channel = supabase
      .channel(`dashboard-revision-${userId}`)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "dashboard_revisions",
        filter: `user_id=eq.${userId}`,
      }, async (payload) => {
        const remoteRevision = Number(payload.new?.revision ?? 0);
        if (!remoteRevision || remoteRevision <= revisionRef.current || syncInProgress.current) return;
        if (dirtyRef.current) {
          setRemoteConflict({ revision: remoteRevision });
          setSyncState("conflict");
          return;
        }

        try {
          const remote = await loadRemoteDashboard(userId);
          revisionRef.current = remote.revision;
          skipSyncOnce.current = true;
          setDashboard(remote.dashboard);
          setSyncState("synced");
          setSyncError("");
        } catch (error) {
          setSyncState("error");
          setSyncError(`Не удалось получить обновление с другого устройства: ${getErrorMessage(error)}`);
        }
      })
      .subscribe((status, error) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          setSyncError(`Подписка на синхронизацию недоступна: ${error ? getErrorMessage(error) : status}`);
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, initializedUserId]);

  useEffect(() => {
    if (!userId || initializedUserId !== userId) return undefined;
    function onOnline() {
      if (dirtyRef.current) {
        setSyncState("pending");
        setSyncTrigger((value) => value + 1);
      }
    }
    function onOffline() {
      if (dirtyRef.current) setSyncState("offline");
    }
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [userId, initializedUserId]);

  const { goals, tasks } = dashboard;
  const range = useMemo(() => getPeriodRange(selectedDate, view), [selectedDate, view]);
  const visibleTasks = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("ru");
    const matching = tasks.filter((task) => task.date >= range.start && task.date <= range.end && (!term || `${task.title} ${task.category} ${task.notes}`.toLocaleLowerCase("ru").includes(term)));
    return matching.sort((a, b) => {
      const direction = sort.direction === "asc" ? 1 : -1;
      let left;
      let right;
      if (sort.key === "priority") {
        left = PRIORITY_ORDER[a.priority] ?? 1;
        right = PRIORITY_ORDER[b.priority] ?? 1;
        return (left - right) * direction;
      }
      if (sort.key === "status") {
        left = STATUSES.indexOf(a.status);
        right = STATUSES.indexOf(b.status);
        return (left - right) * direction;
      }
      if (sort.key === "title") {
        left = a.title;
        right = b.title;
      } else {
        left = `${a.date} ${a.time}`;
        right = `${b.date} ${b.time}`;
      }
      return String(left).localeCompare(String(right), "ru") * direction;
    });
  }, [range.end, range.start, search, sort, tasks]);

  const visibleGoals = useMemo(() => {
    const selected = new Set(
      goals
        .filter((goal) => view === "year"
          ? ["year", "month"].includes(goal.period) && goal.startDate <= range.end && goal.endDate >= range.start
          : goal.startDate <= range.end && goal.endDate >= range.start)
        .map((goal) => goal.id),
    );
    const byId = new Map(goals.map((goal) => [goal.id, goal]));
    for (const id of [...selected]) {
      let goal = byId.get(id);
      while (goal?.parentId && !selected.has(goal.parentId)) {
        selected.add(goal.parentId);
        goal = byId.get(goal.parentId);
      }
    }
    return goals
      .filter((goal) => selected.has(goal.id))
      .sort((a, b) => GOAL_PERIODS.indexOf(a.period) - GOAL_PERIODS.indexOf(b.period) || a.startDate.localeCompare(b.startDate));
  }, [goals, range.end, range.start, view]);

  const completedCount = visibleTasks.filter((task) => task.status === "Выполнено").length;
  const progress = visibleTasks.length ? Math.round((completedCount / visibleTasks.length) * 100) : 0;
  const yearMonths = useMemo(
    () => Array.from({ length: 12 }, (_, index) => new Date(Number(selectedDate.slice(0, 4)), index, 1, 12)),
    [selectedDate],
  );

  useEffect(() => {
    if (!userId || initializedUserId !== userId) return undefined;
    let localSaved = true;
    try {
      const localKey = `${STORAGE_KEY}:${userId}`;
      localStorage.setItem(localKey, JSON.stringify(dashboard));
      localStorage.setItem(`${localKey}:revision`, String(revisionRef.current));
      if (dirtyRef.current) localStorage.setItem(`${localKey}:pending`, "true");
    } catch (error) {
      localSaved = false;
      console.error("Не удалось сохранить локальную копию дашборда:", error);
      queueMicrotask(() => {
        setSyncError(`Не удалось сохранить локальную копию: ${getErrorMessage(error)}`);
        setSyncState("local-error");
      });
    }
    if (skipSyncOnce.current) {
      skipSyncOnce.current = false;
      return undefined;
    }
    if (!dirtyRef.current) return undefined;
    if (!localSaved) setSyncState("local-error");
    else setSyncState(navigator.onLine ? "pending" : "offline");

    const snapshot = JSON.stringify(dashboard);
    const timer = window.setTimeout(async () => {
      if (!navigator.onLine) {
        setSyncState("offline");
        return;
      }
      setSyncState("syncing");
      syncInProgress.current = true;
      try {
        const revision = await syncRemoteDashboard(userId, dashboard, revisionRef.current);
        revisionRef.current = revision;
        try {
          localStorage.setItem(`${STORAGE_KEY}:${userId}:revision`, String(revision));
        } catch (error) {
          console.error("Не удалось сохранить версию локальной копии:", error);
        }
        if (JSON.stringify(latestDashboard.current) === snapshot) {
          dirtyRef.current = false;
          if (localSaved) {
            setSyncError("");
            setSyncState("synced");
            try {
              localStorage.removeItem(`${STORAGE_KEY}:${userId}:pending`);
            } catch (error) {
              console.error("Не удалось обновить отметку локальной синхронизации:", error);
            }
          } else {
            setSyncState("local-error");
          }
        } else {
          setSyncState("pending");
        }
      } catch (error) {
        if (error?.code === "40001" || error?.message?.includes("Dashboard revision conflict")) {
          try {
            const remote = await loadRemoteDashboard(userId);
            revisionRef.current = remote.revision;
            setRemoteConflict({ revision: remote.revision });
            setSyncState("conflict");
            setSyncError("На сервере есть более новая версия. Выберите, какую версию оставить.");
          } catch (refreshError) {
            setSyncState("error");
            setSyncError(`Не удалось проверить конфликт версий: ${getErrorMessage(refreshError)}`);
          }
        } else {
          setSyncState(navigator.onLine ? "error" : "offline");
          setSyncError(`Изменения сохранены локально, но не отправлены на сервер: ${getErrorMessage(error)}`);
        }
      } finally {
        syncInProgress.current = false;
      }
    }, 700);

    return () => window.clearTimeout(timer);
  }, [dashboard, initializedUserId, syncTrigger, userId]);

  useEffect(() => {
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch (error) {
      console.error("Не удалось сохранить тему дашборда:", error);
    }
  }, [theme]);

  async function submitAuth(mode, email, password, setNotice) {
    if (!supabase) return;
    setAuthLoading(true);
    setAuthError("");
    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        if (!data.session) setNotice("Аккаунт создан. Проверьте почту и подтвердите адрес, затем войдите.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (error) {
      setAuthError(getErrorMessage(error));
    } finally {
      setAuthLoading(false);
    }
  }

  async function signOut() {
    if (!supabase) return;
    setAuthLoading(true);
    setAuthError("");
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      setUser(null);
    } catch (error) {
      setAuthError(`Не удалось выйти из аккаунта: ${getErrorMessage(error)}`);
    } finally {
      setAuthLoading(false);
    }
  }

  function useServerDashboard() {
    skipSyncOnce.current = true;
    dirtyRef.current = false;
    revisionRef.current = migration.remote.revision;
    try {
      localStorage.setItem(`${STORAGE_KEY}:${user.id}:backup`, JSON.stringify(migration.local));
    } catch (error) {
      setSyncError(`Не удалось создать локальную резервную копию: ${getErrorMessage(error)}`);
    }
    setDashboard(migration.remote.dashboard);
    setMigration(null);
    setSyncState("synced");
    setInitializedUserId(user.id);
    try {
      localStorage.removeItem(`${STORAGE_KEY}:${user.id}:pending`);
    } catch (error) {
      console.error("Не удалось очистить отметку локальной синхронизации:", error);
    }
  }

  function importLocalDashboard() {
    const imported = hasDashboardData(migration.remote.dashboard)
      ? mergeDashboards(migration.local, migration.remote.dashboard)
      : migration.local;
    revisionRef.current = migration.remote.revision;
    dirtyRef.current = true;
    skipSyncOnce.current = false;
    setDashboard(imported);
    setMigration(null);
    setSyncState("pending");
    setInitializedUserId(user.id);
  }

  async function loadServerVersion() {
    if (dirtyRef.current && !window.confirm("Загрузить серверную версию вместо несинхронизированных изменений на этом устройстве?")) return;
    try {
      setSyncState("loading");
      const remote = await loadRemoteDashboard(user.id);
      revisionRef.current = remote.revision;
      dirtyRef.current = false;
      skipSyncOnce.current = true;
      setDashboard(remote.dashboard);
      setRemoteConflict(null);
      setSyncError("");
      setSyncState("synced");
      localStorage.removeItem(`${STORAGE_KEY}:${user.id}:pending`);
    } catch (error) {
      setSyncState("error");
      setSyncError(`Не удалось загрузить серверную версию: ${getErrorMessage(error)}`);
    }
  }

  function keepThisVersion() {
    if (!window.confirm("Заменить серверные данные текущей версией с этого устройства?")) return;
    revisionRef.current = remoteConflict.revision;
    setRemoteConflict(null);
    dirtyRef.current = true;
    setSyncState("pending");
    setSyncTrigger((value) => value + 1);
  }

  function retrySync() {
    if (dirtyRef.current) {
      setSyncState("pending");
      setSyncTrigger((value) => value + 1);
    } else {
      loadServerVersion();
    }
  }

  async function saveGoal(goal) {
    if (goal.workspaceId) {
      await saveWorkspaceGoal(userId, goal.workspaceId, { ...goal, createdBy: userId });
      await refreshWorkspaceOverview();
      return;
    }
    const personalGoal = { ...goal };
    delete personalGoal.workspaceId;
    delete personalGoal.destinationChosen;
    updateDashboard((current) => reconcileRelationships(
      current.goals.some((item) => item.id === personalGoal.id)
        ? current.goals.map((item) => item.id === personalGoal.id ? personalGoal : item)
        : [...current.goals, personalGoal],
      current.tasks,
    ));
  }

  async function saveTask(task) {
    if (task.workspaceId) {
      await saveWorkspaceTask(userId, task.workspaceId, { ...task, createdBy: userId, assigneeId: userId });
      await refreshWorkspaceOverview();
      return;
    }
    const personalTask = { ...task };
    delete personalTask.workspaceId;
    delete personalTask.assigneeId;
    delete personalTask.destinationChosen;
    updateDashboard((current) => ({
      ...current,
      tasks: current.tasks.some((item) => item.id === personalTask.id)
        ? current.tasks.map((item) => item.id === personalTask.id ? personalTask : item)
        : [...current.tasks, personalTask],
    }));
  }

  async function sharePersonalTask(task, workspaceId, mode) {
    await saveWorkspaceTask(userId, workspaceId, {
      ...task,
      id: createId(),
      workspaceId,
      createdBy: userId,
      assigneeId: userId,
      goalId: null,
    });
    if (mode === "move") {
      updateDashboard((current) => ({
        ...current,
        tasks: current.tasks.filter((item) => item.id !== task.id),
      }));
    }
    await refreshWorkspaceOverview();
  }

  function deleteGoal(goal) {
    if (!window.confirm(`Удалить цель «${goal.title}»? Связанные задачи и подцели сохранятся без связи.`)) return;
    updateDashboard((current) => ({
      goals: current.goals.filter((item) => item.id !== goal.id).map((item) => item.parentId === goal.id ? { ...item, parentId: null } : item),
      tasks: current.tasks.map((task) => task.goalId === goal.id ? { ...task, goalId: null } : task),
    }));
  }

  function deleteTask(task) {
    if (!window.confirm(`Удалить задачу «${task.title}»?`)) return;
    updateDashboard((current) => ({ ...current, tasks: current.tasks.filter((item) => item.id !== task.id) }));
  }

  function updateDashboard(updater) {
    dirtyRef.current = true;
    setDashboard(updater);
  }

  function toggleTask(task) {
    saveTask({ ...task, status: task.status === "Выполнено" ? "К выполнению" : "Выполнено" });
  }

  function changeSort(key) {
    setSort((current) => current.key === key
      ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
      : { key, direction: "asc" });
  }

  function navigatePeriod(amount) {
    setSelectedDate(getNavigationTarget(selectedDate, view, amount));
  }

  function goToToday() {
    setView("day");
    setSelectedDate(localDateString());
  }

  function chooseMonth(month) {
    setView("month");
    setSelectedDate(localDateString(month));
  }

  const todayLabel = new Intl.DateTimeFormat("ru-RU", { weekday: "long", day: "numeric", month: "long" }).format(new Date());

  if (!authReady) {
    return <DashboardLoading theme={theme} message="Проверяем сессию Supabase." />;
  }
  if (!user) {
    return (
      <AuthScreen
        theme={theme}
        setTheme={setTheme}
        error={authError}
        onClearError={() => setAuthError("")}
        loading={authLoading}
        onSubmit={submitAuth}
      />
    );
  }
  if (loadError) {
    return <DashboardLoading theme={theme} error={loadError} onRetry={() => setLoadAttempt((value) => value + 1)} onSignOut={signOut} />;
  }
  if (migration) {
    return <MigrationChoice theme={theme} migration={migration} onUseServer={useServerDashboard} onImportLocal={importLocalDashboard} />;
  }
  if (initializedUserId !== user.id) {
    return <DashboardLoading theme={theme} message="Загружаем ваши цели и задачи из Supabase." />;
  }

  const syncLabels = {
    loading: "Загрузка…",
    synced: "Синхронизировано",
    pending: "Ожидает синхронизации",
    syncing: "Синхронизация…",
    offline: "Ожидает сети",
    error: "Ошибка синхронизации",
    conflict: "Конфликт версий",
    "local-error": "Ошибка локального сохранения",
  };
  const syncLabel = syncLabels[syncState] ?? "Статус неизвестен";

  return (
    <main className="app-shell" data-theme={theme}>
      <div className="dashboard">
        <header className="topbar">
          <a href="#" className="brand" aria-label="Dayflow — начало">
            <span className="brand-mark"><Sparkles size={20} /></span>
            <span><strong>dayflow</strong><small>твой день в фокусе</small></span>
          </a>
          <div className="topbar-actions">
            <span className="sync-indicator" data-state={syncState} title={syncError || syncLabel} role="status">{syncLabel}</span>
            <span className="account-email" title={user.email}>{user.email}</span>
            <span className="today-label"><CalendarDays size={15} /> {todayLabel}</span>
            <button className="icon-button" type="button" onClick={signOut} disabled={authLoading} aria-label="Выйти из аккаунта" title="Выйти">
              <LogOut size={16} />
            </button>
            <button className="theme-toggle" type="button" onClick={() => setTheme((current) => current === "light" ? "dark" : "light")} aria-label={theme === "light" ? "Включить тёмную тему" : "Включить светлую тему"} title={theme === "light" ? "Тёмная тема" : "Светлая тема"}>
              {theme === "light" ? <Moon size={17} /> : <Sun size={17} />}
            </button>
          </div>
        </header>

        <nav className="section-tabs" aria-label="Разделы дэшборда">
          <button type="button" className={activeSection === "dashboard" ? "section-tab active" : "section-tab"} aria-current={activeSection === "dashboard" ? "page" : undefined} onClick={() => setActiveSection("dashboard")}>Личные планы</button>
          <button type="button" className={activeSection === "spaces" ? "section-tab active" : "section-tab"} aria-current={activeSection === "spaces" ? "page" : undefined} onClick={() => { setActiveSection("spaces"); refreshWorkspaceOverview(); }}><Users size={15} /> Пространства{workspaceOverview.invitations.some((invitation) => invitation.inviteeId === user.id && invitation.status === "pending") && <span className="section-tab-badge">!</span>}</button>
          <button type="button" className={activeSection === "friends" ? "section-tab active" : "section-tab"} aria-current={activeSection === "friends" ? "page" : undefined} onClick={() => setActiveSection("friends")}><Users size={15} /> Друзья</button>
        </nav>

        {syncError && !remoteConflict && (
          <p className="sync-alert sync-alert-inline" role="alert">
            {syncError}
            <button type="button" onClick={retrySync}>Повторить</button>
          </p>
        )}
        {remoteConflict && (
          <section className="conflict-panel" role="alert">
            <div><strong>На сервере появились более новые данные.</strong><span>Локальные изменения сохранены. Выберите серверную версию или замените её этой версией.</span></div>
            <div className="conflict-actions">
              <button className="button button-secondary" type="button" onClick={loadServerVersion}>Загрузить серверную</button>
              <button className="button button-primary" type="button" onClick={keepThisVersion}>Оставить эту версию</button>
            </div>
          </section>
        )}
        {authError && <p className="sync-alert sync-alert-inline" role="alert">{authError}</p>}
        {activeSection !== "spaces" && workspaceOverviewError && <p className="sync-alert sync-alert-inline" role="alert">{workspaceOverviewError}</p>}

        {activeSection === "spaces" ? (
          <Workspaces
            userId={user.id}
            overview={workspaceOverview}
            overviewError={workspaceOverviewError}
            overviewLoading={workspaceOverviewLoading}
            onRefreshOverview={refreshWorkspaceOverview}
          />
        ) : activeSection === "friends" ? (
          <Friends userId={user.id} />
        ) : (
        <>
        <section className="welcome-panel">
          <div className="welcome-copy">
            <div className="eyebrow"><Sparkles size={14} /> Личное пространство продуктивности</div>
            <h1>Планы, которые становятся делом.</h1>
            <p>Большая цель начинается с одного маленького шага.</p>
          </div>
          <div className="welcome-stat">
            <span className="stat-icon"><CheckCheck size={21} /></span>
            <span><strong>{completedCount}<i> / {visibleTasks.length}</i></strong><small>задач выполнено</small></span>
          </div>
          <div className="welcome-art" aria-hidden="true"><span /><span /><span /></div>
        </section>

        <section className="planner-bar" aria-label="Навигация по календарю">
          <div className="view-switch" role="tablist" aria-label="Выбрать период">
            {VIEW_OPTIONS.map((option) => (
              <button key={option.id} type="button" role="tab" aria-selected={view === option.id} className={view === option.id ? "view-tab active" : "view-tab"} onClick={() => setView(option.id)}>{option.label}</button>
            ))}
          </div>
          <div className="period-controls">
            <button type="button" className="icon-button" aria-label="Предыдущий период" onClick={() => navigatePeriod(-1)}><ArrowLeft size={17} /></button>
            <h2 className="period-title">{formatPeriod(selectedDate, view)}</h2>
            <button type="button" className="icon-button" aria-label="Следующий период" onClick={() => navigatePeriod(1)}><ArrowRight size={17} /></button>
            <button type="button" className="button button-today" onClick={goToToday}>Сегодня</button>
          </div>
        </section>

        {view === "year" && (
          <section className="year-overview">
            <div className="section-heading year-heading">
              <div><span className="section-kicker">Годовой обзор</span><h2>Ваш год, месяц за месяцем</h2></div>
              <span className="year-count">{goals.filter((goal) => goal.period === "month" && goal.startDate.slice(0, 4) === selectedDate.slice(0, 4)).length} месячных целей</span>
            </div>
            <div className="month-grid">
              {yearMonths.map((month) => {
                const monthKey = localDateString(month).slice(0, 7);
                const monthRange = getPeriodRange(localDateString(month), "month");
                const monthGoals = goals.filter((goal) => goal.period === "month" && goal.startDate.slice(0, 7) === monthKey);
                const monthTasks = tasks.filter((task) => task.date >= monthRange.start && task.date <= monthRange.end);
                const done = monthTasks.filter((task) => task.status === "Выполнено").length;
                return (
                  <button type="button" key={monthKey} className="month-card" onClick={() => chooseMonth(month)}>
                    <span className="month-name">{new Intl.DateTimeFormat("ru-RU", { month: "long" }).format(month)}</span>
                    <span className="month-data">{monthGoals.length} целей <b>·</b> {monthTasks.length} задач</span>
                    <ProgressBar compact percent={monthTasks.length ? Math.round(done / monthTasks.length * 100) : 0} />
                    <span className="month-foot">{done} выполнено <ArrowRight size={13} /></span>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        <section className="summary-grid">
          <article className="summary-card">
            <span className="summary-icon purple"><Target size={19} /></span>
            <span><small>Цели в периоде</small><strong>{visibleGoals.length}</strong></span>
          </article>
          <article className="summary-card">
            <span className="summary-icon green"><ListTodo size={19} /></span>
            <span><small>Задачи в периоде</small><strong>{visibleTasks.length}</strong></span>
          </article>
          <article className="summary-card summary-progress">
            <span className="summary-icon amber"><CheckCheck size={19} /></span>
            <span className="summary-progress-copy"><small>Выполнено · {progress}%</small><strong>{completedCount} из {visibleTasks.length}</strong><ProgressBar percent={progress} /></span>
          </article>
        </section>

        <section className="panel goals-panel">
          <div className="section-heading">
            <div><span className="section-kicker">Большое складывается из малого</span><h2>Цели</h2></div>
            <button type="button" className="button button-primary" onClick={() => setGoalDialog(null)}><Plus size={17} /> Новая цель</button>
          </div>
          {visibleGoals.length ? (
            <div className="goals-list">
              {visibleGoals.map((goal) => {
                const goalProgress = getGoalProgress(goal.id, goals, tasks);
                const parent = goals.find((item) => item.id === goal.parentId);
                return (
                  <article className="goal-card" key={goal.id}>
                    <div className="goal-timeline"><span className={`goal-dot goal-${goal.period}`} /><span className="goal-line" /></div>
                    <div className="goal-content">
                      <div className="goal-main">
                        <div className="goal-title-row">
                          <span className={`period-badge badge-${goal.period}`}>{PERIOD_LABELS[goal.period]}</span>
                          <h3>{goal.title}</h3>
                          <span className={`priority-pill priority-${goal.priority}`}>{goal.priority}</span>
                        </div>
                        <p className="goal-dates">{goal.startDate === goal.endDate ? goal.startDate : `${goal.startDate} — ${goal.endDate}`}{parent && <span className="goal-parent">Связана с: {parent.title}</span>}</p>
                        {goal.notes && <p className="goal-notes">{goal.notes}</p>}
                        <div className="goal-progress-row"><ProgressBar percent={goalProgress.percent} compact /><span>{goalProgress.total ? `${goalProgress.completed}/${goalProgress.total} задач · ${goalProgress.percent}%` : "Пока нет связанных задач"}</span></div>
                      </div>
                      <div className="goal-actions">
                        <button className="icon-button" type="button" onClick={() => setGoalDialog(goal)} aria-label={`Редактировать цель ${goal.title}`} title="Редактировать"><ChevronDown size={16} /></button>
                        <button className="icon-button danger-hover" type="button" onClick={() => deleteGoal(goal)} aria-label={`Удалить цель ${goal.title}`} title="Удалить"><Trash2 size={16} /></button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="empty-state"><span className="empty-icon"><Target size={21} /></span><strong>На этот период целей пока нет</strong><span>Добавьте цель, чтобы разбить её на шаги и следить за прогрессом.</span><button type="button" className="button button-secondary" onClick={() => setGoalDialog(null)}><Plus size={16} /> Создать цель</button></div>
          )}
        </section>

        <section className="panel tasks-panel">
          <div className="section-heading task-heading">
            <div><span className="section-kicker">План на выбранный период</span><h2>Задачи</h2></div>
            <div className="task-tools">
              <label className="search-box"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Найти задачу" aria-label="Поиск задач" />{search && <button type="button" onClick={() => setSearch("")} aria-label="Очистить поиск"><X size={14} /></button>}</label>
              <button type="button" className="button button-primary" onClick={() => setTaskDialog(null)}><Plus size={17} /> Новая задача</button>
            </div>
          </div>
          <div className="table-wrap">
            <table className="task-table">
              <thead><tr>
                <th className="check-col"><span className="sr-only">Выполнение</span></th>
                <th><button type="button" onClick={() => changeSort("title")}>Задача <ArrowUpDown size={13} /></button></th>
                <th><button type="button" onClick={() => changeSort("date")}>Дата и время <ArrowUpDown size={13} /></button></th>
                <th><button type="button" onClick={() => changeSort("priority")}>Приоритет <ArrowUpDown size={13} /></button></th>
                <th><button type="button" onClick={() => changeSort("status")}>Статус <ArrowUpDown size={13} /></button></th>
                <th>Цель / заметки</th><th className="actions-col"><span className="sr-only">Действия</span></th>
              </tr></thead>
              <tbody>
                {visibleTasks.map((task) => {
                  const linkedGoal = goals.find((goal) => goal.id === task.goalId);
                  return (
                    <tr key={task.id} className={task.status === "Выполнено" ? "task-done" : ""}>
                      <td className="check-col"><button type="button" className={`task-check${task.status === "Выполнено" ? " checked" : ""}`} aria-label={task.status === "Выполнено" ? `Снять отметку: ${task.title}` : `Отметить выполненной: ${task.title}`} onClick={() => toggleTask(task)}>{task.status === "Выполнено" && <Check size={13} />}</button></td>
                      <td><div className="task-name">{task.title}</div><span className="task-category">{task.category}</span>{task.notes && <p className="table-note">{task.notes}</p>}</td>
                      <td><span className="task-date"><CalendarDays size={14} />{task.date}</span>{task.time && <span className="task-time"><Clock3 size={13} />{task.time}</span>}{task.deadline && <span className="task-deadline">Срок {task.deadline.replace("T", " ")}</span>}</td>
                      <td><span className={`priority-pill priority-${task.priority}`}>{task.priority}</span></td>
                      <td><span className={`status-pill status-${task.status === "Выполнено" ? "done" : task.status === "В процессе" ? "doing" : "todo"}`}><Circle size={7} fill="currentColor" />{task.status}</span></td>
                      <td><span className="linked-goal">{linkedGoal ? <><Target size={13} />{linkedGoal.title}</> : <span className="unlinked">Без связи</span>}</span></td>
                      <td className="row-actions">{workspaceOverview.workspaces.length > 0 && <button className="icon-button" type="button" onClick={() => setTaskShareDialog(task)} title="Скопировать или перенести в пространство" aria-label={`Скопировать или перенести задачу ${task.title} в пространство`}><Share2 size={15} /></button>}<button className="icon-button" type="button" onClick={() => setTaskDialog(task)} title="Редактировать задачу" aria-label={`Редактировать задачу ${task.title}`}><ChevronDown size={16} /></button><button className="icon-button danger-hover" type="button" onClick={() => deleteTask(task)} title="Удалить задачу" aria-label={`Удалить задачу ${task.title}`}><Trash2 size={15} /></button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!visibleTasks.length && <div className="table-empty"><span className="empty-icon"><ListTodo size={20} /></span><strong>{search ? "Ничего не найдено" : "Задач пока нет"}</strong><span>{search ? "Попробуйте изменить запрос." : "Добавьте первую задачу для этого периода."}</span>{!search && <button type="button" className="button button-secondary" onClick={() => setTaskDialog(null)}><Plus size={16} /> Добавить задачу</button>}</div>}
          </div>
          <footer className="table-footer"><span>{visibleTasks.length} задач · сортировка по нажатию на заголовок столбца</span><span><ArrowDown size={14} /> {syncLabel}</span></footer>
        </section>

        <footer className="app-footer"><span><Sparkles size={14} /> Данные синхронизируются между вашими устройствами</span><button type="button" onClick={() => { if (!window.confirm("Удалить все цели и задачи? Это действие нельзя отменить.")) return; updateDashboard(EMPTY_DASHBOARD); }}>Очистить все данные</button></footer>
        </>
        )}
      </div>

      {goalDialog !== undefined && <GoalDialog key={goalDialog?.id ?? "new-goal"} goal={goalDialog} goals={goals} selectedDate={selectedDate} workspaceOptions={workspaceOverview.workspaces} overviewLoading={workspaceOverviewLoading} onClose={() => setGoalDialog(undefined)} onSave={saveGoal} />}
      {taskDialog !== undefined && <TaskDialog key={taskDialog?.id ?? "new-task"} task={taskDialog} goals={goals} selectedDate={selectedDate} workspaceOptions={workspaceOverview.workspaces} overviewLoading={workspaceOverviewLoading} userId={user.id} onClose={() => setTaskDialog(undefined)} onSave={saveTask} />}
      {taskShareDialog && <TaskShareDialog key={taskShareDialog.id} task={taskShareDialog} workspaceOptions={workspaceOverview.workspaces} onClose={() => setTaskShareDialog(null)} onShare={sharePersonalTask} />}
    </main>
  );
}

export default App;

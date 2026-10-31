import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  AlertTriangle,
  Archive,
  BarChart3,
  CalendarClock,
  Check,
  CheckCircle2,
  Circle,
  Clock3,
  History,
  MessageCircle,
  FolderPlus,
  Search,
  Mail,
  Plus,
  RefreshCw,
  Target,
  Trash2,
  UserMinus,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import {
  createId,
  formatPeriod,
  getGoalDefaultRange,
  getGoalProgress,
  getPeriodRange,
  localDateString,
  PRIORITIES,
  shiftDate,
  STATUSES,
} from "./dashboard.js";
import {
  cancelWorkspaceInvitation,
  createWorkspace,
  deleteWorkspace,
  deleteWorkspaceGoal,
  deleteWorkspaceTask,
  deleteWorkspaceComment,
  leaveWorkspace,
  loadWorkspaceRecords,
  removeWorkspaceMember,
  respondToWorkspaceInvitation,
  saveWorkspaceGoal,
  saveWorkspaceTask,
  saveWorkspaceComment,
  sendWorkspaceInvitation,
  sendWorkspaceInvitationByUsername,
  sendWorkspaceInvitationToUser,
  setWorkspaceMemberRole,
  transferWorkspaceOwnership,
  renameWorkspace,
  loadFriends,
  loadWorkspaceRecordHistory,
  setWorkspaceRecordArchived,
  supabase,
} from "./supabase.js";
import { filterWorkspaceArchive } from "./workspaceArchive.js";
import { buildWorkspaceProgress } from "./workspaceProgress.js";
import { getErrorMessage } from "./errorMessage.js";
import { isEmailQuery, normalizeUsername, primaryName, validateUsername } from "./username.js";

const PERIODS = [
  { id: "year", label: "Год" },
  { id: "month", label: "Месяц" },
  { id: "week", label: "Неделя" },
  { id: "day", label: "День" },
];
const PERIOD_NAMES = Object.fromEntries(PERIODS.map(({ id, label }) => [id, label]));
const STATUS_NAMES = {
  pending: "Ожидает ответа",
  accepted: "Принято",
  declined: "Отклонено",
  cancelled: "Отменено",
  expired: "Срок истёк",
};

function RecordHistory({ workspaceId, recordId, recordType, members, archived, canManage, onArchive }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [error, setError] = useState("");
  async function toggle() {
    if (open) { setOpen(false); return; }
    setOpen(true);
    try { setItems(await loadWorkspaceRecordHistory(workspaceId, recordType, recordId)); setError(""); }
    catch (loadError) { setError(getErrorMessage(loadError)); }
  }
  function description(item) {
    if (item.action === "created") return "Создано";
    if (item.action === "deleted") return "Удалено";
    if (item.changes.archived) return item.changes.archived.to ? "Добавлено в архив" : "Восстановлено из архива";
    const labels = { title: "название", deadline: "срок", start_date: "дата начала", priority: "приоритет", status: "статус", assignee: "ответственный" };
    return Object.keys(item.changes).map((key) => {
      const change = item.changes[key];
      const value = (raw) => key === "assignee" ? (members.find((member) => member.userId === raw)?.name ?? (raw ? "Участник" : "Не назначен")) : raw ?? "—";
      return `${labels[key] ?? key}: ${value(change.from)} → ${value(change.to)}`;
    }).join(" · ");
  }
  return <div className="record-history"><button className="button button-quiet history-toggle" type="button" onClick={toggle}><History size={14} />{open ? "Скрыть историю" : "История"}</button>{canManage && <button className="icon-button" type="button" title={archived ? "Восстановить запись" : "В архив"} aria-label={archived ? "Восстановить запись" : "В архив"} onClick={onArchive}><Archive size={14} /></button>}{open && <div className="record-history-list">{error ? <small className="history-error">{error}</small> : items.length ? items.map((item) => <div className="record-history-item" key={item.id}><span>{description(item)}</span><small>{item.actorName} · {new Date(item.occurredAt).toLocaleString("ru-RU")}</small></div>) : <small>История пока пуста.</small>}</div>}</div>;
}

function emptyRecords() {
  return { workspace: null, members: [], goals: [], tasks: [], comments: [] };
}

function WorkspaceProgress({ stats, periodLabel }) {
  const buckets = [
    { id: "completed", label: "Выполнено", value: stats.completed, icon: CheckCircle2 },
    { id: "active", label: "В процессе", value: stats.active, icon: Clock3 },
    { id: "overdue", label: "Просрочено", value: stats.overdue, icon: AlertTriangle },
    { id: "pending", label: "К выполнению", value: stats.pending, icon: Circle },
  ];
  const maxAssigneeCount = Math.max(1, ...stats.assignees.map((assignee) => assignee.count));
  const dueDateFormatter = new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <section className="workspace-progress panel">
      <div className="section-heading">
        <div>
          <span className="section-kicker">Командный обзор · {periodLabel}</span>
          <h3><BarChart3 size={18} /> Прогресс пространства</h3>
        </div>
        <span className="workspace-progress-total">{stats.total} задач</span>
      </div>
      <div className="workspace-progress-summary">
        <div className="workspace-progress-rate">
          <div><strong>{stats.percent}%</strong><span>выполнено</span></div>
          <div className="progress-track" role="img" aria-label={`Выполнено ${stats.percent} процентов задач`}>
            <span style={{ width: `${stats.percent}%` }} />
          </div>
          <small>Выполненные задачи / все задачи периода</small>
        </div>
        <div className="workspace-progress-metrics">
          {buckets.map(({ id, label, value, icon: Icon }) => (
            <div className={`workspace-progress-metric metric-${id}`} key={id}>
              <Icon size={15} />
              <span>{label}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </div>
      </div>
      <p className="workspace-progress-rule">
        Каждая задача учитывается один раз по дате задачи. Просроченная — незавершённая с уже прошедшим сроком; группы статусов не пересекаются.
      </p>
      <div className="workspace-progress-details">
        <section className="workspace-progress-block">
          <h4><Users size={15} /> Задачи по ответственным</h4>
          {stats.assignees.length ? (
            <div className="assignee-chart">
              {stats.assignees.map((assignee) => (
                <div className="assignee-chart-row" key={assignee.userId || "unassigned"}>
                  <span title={assignee.name}>{assignee.name}</span>
                  <div className="assignee-chart-track" role="img" aria-label={`${assignee.name}: ${assignee.count} задач`}>
                    <span style={{ width: `${(assignee.count / maxAssigneeCount) * 100}%` }} />
                  </div>
                  <strong>{assignee.count}</strong>
                </div>
              ))}
            </div>
          ) : <p className="workspace-hint">За период задач нет.</p>}
        </section>
        <section className="workspace-progress-block">
          <h4><CalendarClock size={15} /> Ближайшие сроки</h4>
          {stats.upcoming.length ? (
            <ul className="upcoming-deadlines">
              {stats.upcoming.map(({ task, dueAt }) => (
                <li key={task.id}>
                  <span className="deadline-date">{dueDateFormatter.format(dueAt)}</span>
                  <span className="deadline-task" title={task.title}>{task.title}</span>
                </li>
              ))}
            </ul>
          ) : <p className="workspace-hint">Ближайших сроков в этом периоде нет.</p>}
        </section>
      </div>
      <section className="workspace-goal-progress">
        <h4><Target size={15} /> Прогресс общих целей</h4>
        {stats.goals.length ? (
          <div className="workspace-goal-progress-list">
            {stats.goals.map((goal) => (
              <div className="workspace-goal-progress-item" key={goal.id}>
                <div><strong title={goal.title}>{goal.title}</strong><span>{goal.progress.completed}/{goal.progress.total} задач · {goal.progress.percent}%</span></div>
                <div className="progress-track" role="img" aria-label={`${goal.title}: выполнено ${goal.progress.percent} процентов задач`}>
                  <span style={{ width: `${goal.progress.percent}%` }} />
                </div>
              </div>
            ))}
          </div>
        ) : <p className="workspace-hint">Целей, пересекающихся с выбранным периодом, нет.</p>}
      </section>
    </section>
  );
}

function WorkspaceEditor({ userId, workspaceId, records, onSave, onCancel, kind, initialGoal, initialTask }) {
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const initialDate = localDateString();
  const [goalForm, setGoalForm] = useState(() => {
    const period = initialGoal?.period ?? "month";
    const range = getGoalDefaultRange(initialDate, period);
    return {
      id: initialGoal?.id ?? createId(),
      createdBy: initialGoal?.createdBy ?? userId,
      title: initialGoal?.title ?? "",
      period,
      startDate: initialGoal?.startDate ?? range.start,
      endDate: initialGoal?.endDate ?? range.end,
      parentId: initialGoal?.parentId ?? "",
      priority: initialGoal?.priority ?? "Средний",
      notes: initialGoal?.notes ?? "",
      archivedAt: initialGoal?.archivedAt ?? null,
    };
  });
  const [taskForm, setTaskForm] = useState(() => ({
    id: initialTask?.id ?? createId(),
    createdBy: initialTask?.createdBy ?? userId,
    assigneeId: initialTask?.assigneeId ?? "",
    title: initialTask?.title ?? "",
    category: initialTask?.category ?? "Работа",
    date: initialTask?.date ?? initialDate,
    time: initialTask?.time ?? "",
    deadline: initialTask?.deadline ?? "",
    priority: initialTask?.priority ?? "Средний",
    status: initialTask?.status ?? "К выполнению",
    notes: initialTask?.notes ?? "",
    goalId: initialTask?.goalId ?? "",
    archivedAt: initialTask?.archivedAt ?? null,
  }));
  const editingGoal = kind === "goal";
  const editingTask = kind === "task";
  const goalPeriod = goalForm.period === "month"
    ? "year"
    : goalForm.period === "week" ? "month" : goalForm.period === "day" ? "week" : null;
  const parentGoals = records.goals.filter((goal) =>
    !goal.archivedAt
    && goal.id !== goalForm.id
    && goal.period === goalPeriod
    && goalForm.startDate >= goal.startDate
    && goalForm.endDate <= goal.endDate);
  const availableGoals = records.goals.filter((goal) =>
    (!goal.archivedAt || goal.id === initialTask?.goalId)
    && taskForm.date >= goal.startDate && taskForm.date <= goal.endDate);

  async function submitGoal(event) {
    event.preventDefault();
    setError("");
    setSaving(true);
    try {
      await saveWorkspaceGoal(userId, workspaceId, {
        ...goalForm,
        title: goalForm.title.trim(),
        parentId: goalForm.parentId || null,
      });
      await onSave();
    } catch (saveError) {
      setError(getErrorMessage(saveError));
    } finally {
      setSaving(false);
    }
  }

  async function submitTask(event) {
    event.preventDefault();
    setError("");
    setSaving(true);
    try {
      await saveWorkspaceTask(userId, workspaceId, {
        ...taskForm,
        title: taskForm.title.trim(),
        goalId: taskForm.goalId || null,
        assigneeId: taskForm.assigneeId || null,
      });
      await onSave();
    } catch (saveError) {
      setError(getErrorMessage(saveError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel workspace-editor">
      <div className="section-heading">
        <div><span className="section-kicker">Общие записи</span><h2>{editingGoal ? "Изменить цель" : editingTask ? "Изменить задачу" : "Новая запись"}</h2></div>
        <button className="icon-button" type="button" onClick={onCancel} aria-label="Закрыть"><X size={17} /></button>
      </div>
      {editingGoal && (
        <form className="dialog-form workspace-form" onSubmit={submitGoal}>
          <label className="field field-wide"><span>Название общей цели</span><input autoFocus required maxLength="200" value={goalForm.title} onChange={(event) => setGoalForm({ ...goalForm, title: event.target.value })} /></label>
          <label className="field"><span>Период</span><select value={goalForm.period} onChange={(event) => {
            const period = event.target.value;
            const range = getGoalDefaultRange(initialDate, period);
            setGoalForm({ ...goalForm, period, ...range, parentId: "" });
          }}>{PERIODS.map(({ id, label }) => <option key={id} value={id}>{label}</option>)}</select></label>
          <label className="field"><span>Приоритет</span><select value={goalForm.priority} onChange={(event) => setGoalForm({ ...goalForm, priority: event.target.value })}>{PRIORITIES.map((item) => <option key={item}>{item}</option>)}</select></label>
          <label className="field"><span>Начало</span><input required type="date" value={goalForm.startDate} onChange={(event) => setGoalForm({ ...goalForm, startDate: event.target.value, parentId: "" })} /></label>
          <label className="field"><span>Конец</span><input required type="date" min={goalForm.startDate} value={goalForm.endDate} onChange={(event) => setGoalForm({ ...goalForm, endDate: event.target.value, parentId: "" })} /></label>
          {goalPeriod && <label className="field field-wide"><span>Связать с целью на уровень выше</span><select value={goalForm.parentId} onChange={(event) => setGoalForm({ ...goalForm, parentId: event.target.value })}><option value="">Без связи</option>{parentGoals.map((goal) => <option key={goal.id} value={goal.id}>{goal.title}</option>)}</select></label>}
          <label className="field field-wide"><span>Заметки</span><textarea rows="3" value={goalForm.notes} onChange={(event) => setGoalForm({ ...goalForm, notes: event.target.value })} /></label>
          {error && <p className="sync-alert field-wide" role="alert">{error}</p>}
          <div className="dialog-actions field-wide"><button className="button button-quiet" type="button" onClick={onCancel}>Отмена</button><button className="button button-primary" type="submit" disabled={saving}><Check size={16} />{saving ? "Сохраняем…" : "Сохранить цель"}</button></div>
        </form>
      )}
      {editingTask && (
        <form className="dialog-form workspace-form" onSubmit={submitTask}>
          <label className="field field-wide"><span>Название общей задачи</span><input autoFocus={!editingGoal} required maxLength="200" value={taskForm.title} onChange={(event) => setTaskForm({ ...taskForm, title: event.target.value })} /></label>
          <label className="field"><span>Категория</span><input required value={taskForm.category} onChange={(event) => setTaskForm({ ...taskForm, category: event.target.value })} /></label>
          <label className="field"><span>Ответственный</span><select value={taskForm.assigneeId} onChange={(event) => setTaskForm({ ...taskForm, assigneeId: event.target.value })}><option value="">Не назначен</option>{records.members.map((member) => <option key={member.userId} value={member.userId}>{member.name}</option>)}</select></label>
          <label className="field"><span>Дата</span><input required type="date" value={taskForm.date} onChange={(event) => setTaskForm({ ...taskForm, date: event.target.value, goalId: "" })} /></label>
          <label className="field"><span>Время</span><input type="time" value={taskForm.time} onChange={(event) => setTaskForm({ ...taskForm, time: event.target.value })} /></label>
          <label className="field"><span>Срок выполнения</span><input type="datetime-local" value={taskForm.deadline} onChange={(event) => setTaskForm({ ...taskForm, deadline: event.target.value })} /></label>
          <label className="field"><span>Приоритет</span><select value={taskForm.priority} onChange={(event) => setTaskForm({ ...taskForm, priority: event.target.value })}>{PRIORITIES.map((item) => <option key={item}>{item}</option>)}</select></label>
          <label className="field"><span>Статус</span><select value={taskForm.status} onChange={(event) => setTaskForm({ ...taskForm, status: event.target.value })}>{STATUSES.map((item) => <option key={item}>{item}</option>)}</select></label>
          <label className="field field-wide"><span>Связать с общей целью</span><select value={taskForm.goalId} onChange={(event) => setTaskForm({ ...taskForm, goalId: event.target.value })}><option value="">Без связи</option>{availableGoals.map((goal) => <option key={goal.id} value={goal.id}>{goal.title}</option>)}</select></label>
          <label className="field field-wide"><span>Заметки</span><textarea rows="3" value={taskForm.notes} onChange={(event) => setTaskForm({ ...taskForm, notes: event.target.value })} /></label>
          {error && <p className="sync-alert field-wide" role="alert">{error}</p>}
          <div className="dialog-actions field-wide"><button className="button button-quiet" type="button" onClick={onCancel}>Отмена</button><button className="button button-primary" type="submit" disabled={saving}><Check size={16} />{saving ? "Сохраняем…" : "Сохранить задачу"}</button></div>
        </form>
      )}
    </section>
  );
}

export default function Workspaces({ userId, overview, overviewError, overviewLoading, onRefreshOverview }) {
  const [selectedId, setSelectedId] = useState("");
  const [records, setRecords] = useState(emptyRecords);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [workspaceFormOpen, setWorkspaceFormOpen] = useState(false);
  const [workspaceName, setWorkspaceName] = useState("");
  const [workspaceDescription, setWorkspaceDescription] = useState("");
  const [workspaceNameEdit, setWorkspaceNameEdit] = useState("");
  const [transferTarget, setTransferTarget] = useState("");
  const [workspaceSettingsOpen, setWorkspaceSettingsOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [friends, setFriends] = useState([]);
  const [recordEditor, setRecordEditor] = useState(null);
  const [period, setPeriod] = useState("week");
  const [showArchive, setShowArchive] = useState(false);
  const [archiveSearch, setArchiveSearch] = useState("");
  const [archiveStatus, setArchiveStatus] = useState("");
  const [archiveMember, setArchiveMember] = useState("");
  const [archiveFrom, setArchiveFrom] = useState("");
  const [archiveTo, setArchiveTo] = useState("");
  const [commentDrafts, setCommentDrafts] = useState({});
  const [editingComments, setEditingComments] = useState({});
  const [selectedDate, setSelectedDate] = useState(localDateString());
  const selectedWorkspace = overview.workspaces.find((workspace) => workspace.id === selectedId);
  const selectedWorkspaceRole = selectedWorkspace?.role;
  const currentRange = useMemo(() => getPeriodRange(selectedDate, period), [selectedDate, period]);
  const progressStats = buildWorkspaceProgress(records, currentRange);
  const visibleGoals = records.goals.filter((goal) =>
    !goal.archivedAt && goal.startDate <= currentRange.end && goal.endDate >= currentRange.start);
  const visibleTasks = records.tasks.filter((task) =>
    !task.archivedAt && task.date >= currentRange.start && task.date <= currentRange.end);
  const names = new Map(records.members.map((member) => [member.userId, member.name]));
  const canManageArchive = ["owner", "admin"].includes(selectedWorkspace?.role);
  const allArchivedRecords = [
    ...records.goals.filter((goal) => goal.archivedAt).map((record) => ({ ...record, recordType: "goal" })),
    ...records.tasks.filter((task) => task.archivedAt).map((record) => ({ ...record, recordType: "task" })),
  ];
  const archiveParticipants = [...new Set(allArchivedRecords.flatMap((record) => [
    record.createdBy,
    record.archivedBy,
    record.assigneeId,
    ...(record.recordType === "task"
      ? records.comments.filter((comment) => comment.taskId === record.id).map((comment) => comment.authorId)
      : []),
  ]).filter(Boolean))].map((userId) => ({
    userId,
    name: names.get(userId) ?? `Участник ${userId.slice(0, 8)}`,
  }));
  const archivedRecords = filterWorkspaceArchive(allArchivedRecords, records.comments, {
    search: archiveSearch,
    status: archiveStatus,
    participant: archiveMember,
    from: archiveFrom,
    to: archiveTo,
  });

  useEffect(() => {
    if (!selectedId) return undefined;
    let active = true;
    loadWorkspaceRecords(selectedId)
      .then((data) => {
        if (active) setRecords(data);
      })
      .catch((loadError) => {
        if (active) setError(`Не удалось загрузить пространство: ${getErrorMessage(loadError)}`);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [selectedId]);

  useEffect(() => {
    if (!["owner", "admin"].includes(selectedWorkspaceRole)) { return; }
    let active = true;
    loadFriends().then((items) => { if (active) setFriends(items.filter((friend) => friend.status === "accepted")); })
      .catch((loadError) => { if (active) setError(`Не удалось загрузить друзей: ${getErrorMessage(loadError)}`); });
    return () => { active = false; };
  }, [selectedWorkspaceRole]);

  useEffect(() => {
    if (!selectedId || !supabase) return undefined;
    let active = true;
    async function refreshSharedData() {
      try {
        const latestOverview = await onRefreshOverview();
        if (active && latestOverview && !latestOverview.workspaces.some((workspace) => workspace.id === selectedId)) {
          setSelectedId("");
          setRecords(emptyRecords());
          setLoading(false);
          return;
        }
        const data = await loadWorkspaceRecords(selectedId);
        if (active) {
          setRecords(data);
          setError("");
        }
      } catch (refreshError) {
        if (active) setError(`Не удалось получить обновление пространства: ${getErrorMessage(refreshError)}`);
      }
    }

    const channel = supabase
      .channel(`workspace-${selectedId}`)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "workspaces",
        filter: `id=eq.${selectedId}`,
      }, refreshSharedData)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "workspace_members",
        filter: `workspace_id=eq.${selectedId}`,
      }, refreshSharedData)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "workspace_invitations",
        filter: `workspace_id=eq.${selectedId}`,
      }, refreshSharedData)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "workspace_goals",
        filter: `workspace_id=eq.${selectedId}`,
      }, refreshSharedData)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "workspace_tasks",
        filter: `workspace_id=eq.${selectedId}`,
      }, refreshSharedData)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "workspace_task_comments",
        filter: `workspace_id=eq.${selectedId}`,
      }, refreshSharedData)
      .subscribe((status, subscriptionError) => {
        if (active && (status === "CHANNEL_ERROR" || status === "TIMED_OUT")) {
          setError(`Не удалось подписаться на обновления пространства: ${subscriptionError ? getErrorMessage(subscriptionError) : status}`);
        }
      });

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [onRefreshOverview, selectedId]);

  async function refreshSelected() {
    if (selectedId) {
      const data = await loadWorkspaceRecords(selectedId);
      setRecords(data);
    }
    await onRefreshOverview();
  }

  async function reloadSelected() {
    setLoading(true);
    setError("");
    try {
      const data = await loadWorkspaceRecords(selectedId);
      setRecords(data);
    } catch (loadError) {
      setError(`Не удалось обновить пространство: ${getErrorMessage(loadError)}`);
    } finally {
      setLoading(false);
    }
  }

  async function runAction(label, action, refresh = true) {
    setBusy(label);
    setError("");
    setNotice("");
    try {
      await action();
      if (refresh) await refreshSelected();
      return true;
    } catch (actionError) {
      setError(getErrorMessage(actionError));
      return false;
    } finally {
      setBusy("");
    }
  }

  async function submitWorkspace(event) {
    event.preventDefault();
    setBusy("workspace");
    setError("");
    try {
      const newId = await createWorkspace(workspaceName.trim(), workspaceDescription.trim());
      setWorkspaceName("");
      setWorkspaceDescription("");
      setWorkspaceFormOpen(false);
      await onRefreshOverview();
      setRecords(emptyRecords());
      setLoading(true);
      setSelectedId(newId);
    } catch (actionError) {
      setError(getErrorMessage(actionError));
    } finally {
      setBusy("");
    }
  }

  async function submitInvite(event) {
    event.preventDefault();
    const value = inviteEmail.trim();
    if (!value) return;
    const byEmail = isEmailQuery(value);
    if (!byEmail) {
      const formatError = validateUsername(value);
      if (formatError) { setError(formatError); return; }
    }
    const sent = await runAction("invite", async () => {
      if (byEmail) await sendWorkspaceInvitation(selectedId, value);
      else await sendWorkspaceInvitationByUsername(selectedId, normalizeUsername(value));
      setInviteEmail("");
    });
    if (sent) setNotice(byEmail
      ? "Если пользователь с этим адресом зарегистрирован, приглашение появится у него в разделе «Пространства». Email-уведомление не отправляется."
      : "Приглашение отправлено. Оно появится у пользователя в разделе «Пространства».");
  }

  async function inviteFriend(friend) {
    const sent = await runAction(`invite-friend-${friend.userId}`, () => sendWorkspaceInvitationToUser(selectedId, friend.userId));
    if (sent) setNotice(`Приглашение для ${friend.name} отправлено.`);
  }

  async function submitWorkspaceRename(event) {
    event.preventDefault();
    if (!workspaceNameEdit.trim()) return;
    await runAction("rename-workspace", () => renameWorkspace(selectedId, workspaceNameEdit.trim()));
  }

  async function transferOwnership() {
    const target = records.members.find((member) => member.userId === transferTarget);
    if (!target || !window.confirm(`Передать владение пространством пользователю «${target.name}»? Вы станете администратором.`)) return;
    const transferred = await runAction("transfer-owner", () => transferWorkspaceOwnership(selectedId, target.userId));
    if (transferred) { setTransferTarget(""); setNotice(`Владение передано пользователю ${target.name}.`); }
  }

  async function answerInvitation(invitation, accept) {
    const completed = await runAction(
      `invite-${invitation.id}`,
      () => respondToWorkspaceInvitation(invitation.id, accept),
      false,
    );
    if (!completed) return;
    const refreshed = await onRefreshOverview();
    if (refreshed && accept) {
      setLoading(true);
      setError("");
      setRecords(emptyRecords());
      setSelectedId(invitation.workspaceId);
    }
  }

  async function deleteGoal(goal) {
    if (!window.confirm(`Удалить общую цель «${goal.title}»? Связанные подцели и задачи сохранятся без связи.`)) return;
    await runAction(`goal-${goal.id}`, () => deleteWorkspaceGoal(selectedId, goal.id));
  }

  async function deleteTask(task) {
    if (!window.confirm(`Удалить общую задачу «${task.title}»?`)) return;
    await runAction(`task-${task.id}`, () => deleteWorkspaceTask(selectedId, task.id));
  }

  async function toggleArchive(kind, record) {
    const restoring = Boolean(record.archivedAt);
    const actionLabel = restoring ? "восстановить" : "архивировать";
    if (!window.confirm(`${actionLabel[0].toLocaleUpperCase("ru")}${actionLabel.slice(1)} ${kind === "goal" ? "цель" : "задачу"} «${record.title}»?`)) return;
    await runAction(`archive-${record.id}`, () => setWorkspaceRecordArchived(selectedId, kind, record.id, !restoring));
  }

  async function toggleTask(task) {
    await runAction(`task-${task.id}`, () => saveWorkspaceTask(userId, selectedId, {
      ...task,
      status: task.status === "Выполнено" ? "К выполнению" : "Выполнено",
    }));
  }

  async function assignTask(task, assigneeId) {
    await runAction(`assignee-${task.id}`, () => saveWorkspaceTask(userId, selectedId, { ...task, assigneeId: assigneeId || null }));
  }

  async function submitComment(task, event) {
    event.preventDefault();
    const body = (commentDrafts[task.id] ?? "").trim();
    if (!body) return;
    const saved = await runAction(`comment-${task.id}`, () => saveWorkspaceComment(selectedId, task.id, { authorId: userId, body }));
    if (saved) setCommentDrafts((drafts) => ({ ...drafts, [task.id]: "" }));
  }

  function clearEditingComment(commentId) {
    setEditingComments((current) => {
      const next = { ...current };
      delete next[commentId];
      return next;
    });
  }

  async function editComment(comment) {
    const body = (editingComments[comment.id] ?? comment.body).trim();
    if (!body || body === comment.body) { clearEditingComment(comment.id); return; }
    const saved = await runAction(`comment-${comment.id}`, () => saveWorkspaceComment(selectedId, comment.taskId, { ...comment, body }));
    if (saved) clearEditingComment(comment.id);
  }

  async function removeComment(comment) {
    if (comment.authorId !== userId && selectedWorkspace?.role !== "owner") return;
    await runAction(`comment-${comment.id}`, () => deleteWorkspaceComment(comment.id));
  }

  return (
    <section className="workspace-area">
      {overviewError && <p className="sync-alert workspace-alert" role="alert">{overviewError}</p>}
      {error && <p className="sync-alert workspace-alert" role="alert">{error}</p>}
      {notice && <p className="sync-notice workspace-alert" role="status">{notice}</p>}

      <section className="panel workspace-overview">
        <div className="section-heading">
          <div><span className="section-kicker">Планируйте вместе</span><h2>Пространства</h2></div>
          <button className="button button-primary" type="button" onClick={() => setWorkspaceFormOpen((open) => !open)}><FolderPlus size={16} /> Создать пространство</button>
        </div>
        {workspaceFormOpen && (
          <form className="dialog-form workspace-create-form" onSubmit={submitWorkspace}>
            <label className="field"><span>Название</span><input required maxLength="80" value={workspaceName} onChange={(event) => setWorkspaceName(event.target.value)} placeholder="Например, Команда проекта" /></label>
            <label className="field"><span>Описание</span><input maxLength="500" value={workspaceDescription} onChange={(event) => setWorkspaceDescription(event.target.value)} placeholder="Над чем работает команда" /></label>
            <div className="dialog-actions field-wide"><button className="button button-quiet" type="button" onClick={() => setWorkspaceFormOpen(false)}>Отмена</button><button className="button button-primary" type="submit" disabled={busy === "workspace"}>{busy === "workspace" ? "Создаём…" : "Создать"}</button></div>
          </form>
        )}
        {overview.workspaces.length ? (
          <div className="workspace-cards">
            {overview.workspaces.map((workspace) => (
              <button type="button" key={workspace.id} className={`workspace-card${selectedId === workspace.id ? " active" : ""}`} onClick={() => {
                setRecordEditor(null);
                if (selectedId === workspace.id) return;
                setLoading(true);
                setError("");
                setRecords(emptyRecords());
                setSelectedId(workspace.id);
              }}>
                <span className="workspace-card-icon"><Users size={17} /></span>
                <span><strong>{workspace.name}</strong><small>{workspace.role === "owner" ? "Владелец" : workspace.role === "admin" ? "Администратор" : "Участник"} · {workspace.description || "Совместные цели и задачи"}</small></span>
              </button>
            ))}
          </div>
        ) : overviewLoading ? (
          <p className="workspace-hint">Загружаем ваши пространства…</p>
        ) : !overviewError && (
          <div className="workspace-empty"><span className="empty-icon"><Users size={20} /></span><strong>Пока нет рабочих пространств</strong><span>Создайте пространство и пригласите участников, чтобы планировать вместе.</span></div>
        )}
      </section>

      <section className="panel invitation-panel">
        <div className="section-heading">
          <div><span className="section-kicker">Приглашения отдельно от личных планов</span><h2>Приглашения</h2></div>
        </div>
        {overview.invitations.length ? (
          <div className="invitation-list">
            {overview.invitations.map((invitation) => {
              const received = invitation.inviteeId === userId;
              const invitationWorkspace = overview.workspaces.find((workspace) => workspace.id === invitation.workspaceId);
              const outgoingPending = ["owner", "admin"].includes(invitationWorkspace?.role) && !received && invitation.status === "pending";
              return (
                <article className="invitation-row" key={invitation.id}>
                  <span className="workspace-card-icon"><Mail size={16} /></span>
                  <div className="invitation-copy"><strong>{invitation.workspaceName}</strong><small>{received ? "Приглашение для вас" : `Приглашён: ${invitation.inviteeName ?? "Пользователь"}`}</small></div>
                  <span className={`invitation-status status-${invitation.status}`}>{STATUS_NAMES[invitation.status]}</span>
                  {received && invitation.status === "pending" && <div className="invitation-actions"><button className="button button-primary" type="button" disabled={Boolean(busy)} onClick={() => answerInvitation(invitation, true)}>Принять</button><button className="button button-quiet" type="button" disabled={Boolean(busy)} onClick={() => answerInvitation(invitation, false)}>Отклонить</button></div>}
                  {outgoingPending && <button className="button button-quiet" type="button" disabled={Boolean(busy)} onClick={async () => {
                    const completed = await runAction(`invite-${invitation.id}`, () => cancelWorkspaceInvitation(invitation.id), false);
                    if (completed) await onRefreshOverview();
                  }}>Отменить</button>}
                </article>
              );
            })}
          </div>
        ) : <p className="workspace-hint">Входящие и отправленные приглашения появятся здесь.</p>}
      </section>

      {selectedWorkspace && (
        <section className="panel workspace-detail">
          <div className="section-heading">
            <div><span className="section-kicker">{selectedWorkspace.role === "owner" ? "Владелец" : selectedWorkspace.role === "admin" ? "Администратор" : "Участник"} · {records.members.length} участников</span><h2>{selectedWorkspace.name}</h2>{selectedWorkspace.description && <p className="workspace-description">{selectedWorkspace.description}</p>}</div>
            <div className="workspace-heading-actions">
            <button className="button button-quiet" type="button" onClick={reloadSelected} disabled={loading}><RefreshCw size={15} /> Обновить</button>
            {selectedWorkspace.role === "owner"
              ? <button className="button button-quiet danger-hover" type="button" disabled={Boolean(busy)} onClick={async () => {
                if (window.confirm(`Удалить пространство «${selectedWorkspace.name}» и все его общие записи? Это нельзя отменить.`)) {
                  const deleted = await runAction("delete-workspace", () => deleteWorkspace(selectedId), false);
                  if (!deleted) return;
                  setSelectedId("");
                  setRecords(emptyRecords());
                  await onRefreshOverview();
                }
              }}><Trash2 size={15} /> Удалить пространство</button>
              : <button className="button button-quiet" type="button" disabled={Boolean(busy)} onClick={async () => {
                if (window.confirm(`Выйти из пространства «${selectedWorkspace.name}»?`)) {
                  const left = await runAction("leave-workspace", () => leaveWorkspace(selectedId), false);
                  if (!left) return;
                  setSelectedId("");
                  setRecords(emptyRecords());
                  await onRefreshOverview();
                }
              }}>Покинуть пространство</button>}
            </div>
          </div>
          {selectedWorkspace.role === "owner" && <div className="workspace-owner-tools">
            <button className="button button-quiet" type="button" onClick={() => { setWorkspaceNameEdit(selectedWorkspace.name); setWorkspaceSettingsOpen((open) => !open); }}>Настройки владельца</button>
            {workspaceSettingsOpen && <div className="workspace-owner-settings">
              <form className="workspace-rename-form" onSubmit={submitWorkspaceRename}><label className="field"><span>Название пространства</span><input required maxLength="80" value={workspaceNameEdit} onChange={(event) => setWorkspaceNameEdit(event.target.value)} /></label><button className="button button-secondary" type="submit" disabled={Boolean(busy)}>Сохранить название</button></form>
              <div className="workspace-transfer-form"><label className="field"><span>Передать владение участнику</span><select value={transferTarget} onChange={(event) => setTransferTarget(event.target.value)}><option value="">Выберите участника</option>{records.members.filter((member) => member.role !== "owner").map((member) => <option key={member.userId} value={member.userId}>{member.name} · {member.role === "admin" ? "Администратор" : "Участник"}</option>)}</select></label><button className="button button-quiet" type="button" disabled={!transferTarget || Boolean(busy)} onClick={transferOwnership}>Передать владение…</button><small>Вы останетесь администратором и сохраните доступ.</small></div>
            </div>}
          </div>}
          {(["owner", "admin"].includes(selectedWorkspace.role)) && (
            <>
              <div className="workspace-friend-invites">
                <div className="section-heading"><div><span className="section-kicker">Пригласите друга</span><h3>Друзья</h3></div></div>
                {friends.length ? <div className="workspace-friend-list">{friends.map((friend) => {
                  const member = records.members.some((item) => item.userId === friend.userId);
                  const pending = overview.invitations.some((item) => item.workspaceId === selectedId && item.inviteeId === friend.userId && item.status === "pending");
                  const accepted = overview.invitations.some((item) => item.workspaceId === selectedId && item.inviteeId === friend.userId && item.status === "accepted");
                  const label = member ? "Участник" : pending ? "Ожидает ответа" : accepted ? "Приглашение принято" : "Можно пригласить";
                  return <div className="workspace-friend-row" key={friend.userId}><span className="member-avatar">{friend.avatarUrl ? <img src={friend.avatarUrl} alt="" /> : primaryName(friend.name, friend.username).replace(/^@/, "").slice(0, 1).toLocaleUpperCase("ru")}</span><span className="member-name"><strong>{primaryName(friend.name, friend.username)}{friend.username && primaryName(friend.name, friend.username) !== `@${friend.username}` && <span className="username-tag">@{friend.username}</span>}</strong><small>{label}</small></span>{!member && !pending && !accepted && <button className="button button-secondary" type="button" disabled={Boolean(busy)} onClick={() => inviteFriend(friend)}><UserPlus size={14} /> Пригласить</button>}{member && <Check size={16} className="workspace-friend-check" />}</div>;
                })}</div> : <p className="workspace-hint">Добавьте друзей, чтобы приглашать их сюда. Можно также пригласить зарегистрированного пользователя по email.</p>}
              </div>
              <form className="workspace-invite-form" onSubmit={submitInvite}>
                <label className="field"><span>Или пригласите зарегистрированного пользователя по @username или email</span><input required value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} maxLength="320" autoCapitalize="none" placeholder="@username или name@example.com" /></label>
                <button className="button button-secondary" type="submit" disabled={Boolean(busy)}><UserPlus size={16} />{busy === "invite" ? "Отправляем…" : "Отправить приглашение"}</button>
                <small>Подходит и для пользователя, который ещё не в друзьях. Приглашение появится у него в разделе «Пространства» после входа.</small>
              </form>
            </>
          )}
          <div className="member-list">
            {records.members.map((member) => (
              <div className="member-row" key={member.userId}>
                <span className="member-avatar">{member.name.replace(/^@/, "").slice(0, 1).toLocaleUpperCase("ru")}</span>
                <span className="member-name"><strong>{member.name}{member.username && member.name !== `@${member.username}` && <span className="username-tag">@{member.username}</span>}</strong><small>{member.role === "owner" ? "Владелец" : member.role === "admin" ? "Администратор" : "Участник"}{member.userId === userId ? " · Вы" : ""}</small></span>
                {selectedWorkspace.role === "owner" && member.role !== "owner" && <select className="member-role-select" aria-label={`Роль ${member.name}`} value={member.role} disabled={Boolean(busy)} onChange={(event) => runAction(`role-${member.userId}`, () => setWorkspaceMemberRole(selectedId, member.userId, event.target.value))}><option value="admin">Администратор</option><option value="member">Участник</option></select>}{["owner", "admin"].includes(selectedWorkspace.role) && member.role === "member" && <button className="icon-button danger-hover" type="button" aria-label={`Удалить участника ${member.name}`} title="Удалить участника" disabled={Boolean(busy)} onClick={() => {
                  if (window.confirm(`Удалить участника «${member.name}»?`)) {
                    runAction(`member-${member.userId}`, () => removeWorkspaceMember(selectedId, member.userId));
                  }
                }}><UserMinus size={16} /></button>}
              </div>
            ))}
            {loading && <p className="workspace-hint">Загружаем участников и общие записи…</p>}
          </div>

          {!loading && (
            <>
              <div className="workspace-planner">
                <div className="view-switch" role="tablist" aria-label="Фильтр общего плана">{PERIODS.map(({ id, label }) => <button key={id} type="button" role="tab" aria-selected={period === id} className={period === id ? "view-tab active" : "view-tab"} onClick={() => setPeriod(id)}>{label}</button>)}</div>
                <div className="period-controls"><button className="icon-button" type="button" aria-label="Предыдущий период" onClick={() => setSelectedDate(shiftDate(selectedDate, period === "week" ? -7 : -1, period === "week" ? "day" : period))}><ArrowLeft size={16} /></button><h3 className="period-title">{formatPeriod(selectedDate, period)}</h3><button className="icon-button" type="button" aria-label="Следующий период" onClick={() => setSelectedDate(shiftDate(selectedDate, period === "week" ? 7 : 1, period === "week" ? "day" : period))}><ArrowRight size={16} /></button></div>
                <button className={showArchive ? "button button-primary" : "button button-secondary"} type="button" onClick={() => { setShowArchive((visible) => !visible); setRecordEditor(null); }}><Archive size={15} />{showArchive ? "Вернуться к плану" : `Архив (${archivedRecords.length})`}</button>
              </div>
              {!showArchive && <WorkspaceProgress stats={progressStats} periodLabel={formatPeriod(selectedDate, period)} />}
              {recordEditor && <WorkspaceEditor key={`${recordEditor.kind}-${recordEditor.record?.id ?? "new"}`} kind={recordEditor.kind} userId={userId} workspaceId={selectedId} records={records} initialGoal={recordEditor.kind === "goal" ? recordEditor.record : null} initialTask={recordEditor.kind === "task" ? recordEditor.record : null} onCancel={() => setRecordEditor(null)} onSave={async () => { setRecordEditor(null); await refreshSelected(); }} />}
              {showArchive ? (
                <section className="workspace-record-section archive-view">
                  <div className="section-heading"><div><span className="section-kicker">Общие записи сохраняются вместе со связями и обсуждениями</span><h3>Архив</h3></div><span className="year-count">{archivedRecords.length} записей</span></div>
                  <div className="archive-filters">
                    <label className="search-box"><Search size={15} /><input value={archiveSearch} onChange={(event) => setArchiveSearch(event.target.value)} placeholder="Поиск по названию и заметкам" aria-label="Поиск в архиве" /></label>
                    <label className="field"><span>Тип или статус</span><select value={archiveStatus} onChange={(event) => setArchiveStatus(event.target.value)}><option value="">Все записи</option><option value="Цель">Цели</option>{STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}</select></label>
                    <label className="field"><span>Участник</span><select value={archiveMember} onChange={(event) => setArchiveMember(event.target.value)}><option value="">Любой участник</option>{archiveParticipants.map((member) => <option key={member.userId} value={member.userId}>{member.name}</option>)}</select></label>
                    <label className="field"><span>Архивировано с</span><input type="date" value={archiveFrom} onChange={(event) => setArchiveFrom(event.target.value)} /></label>
                    <label className="field"><span>Архивировано по</span><input type="date" min={archiveFrom || undefined} value={archiveTo} onChange={(event) => setArchiveTo(event.target.value)} /></label>
                  </div>
                  {archivedRecords.length ? (
                    <div className="shared-task-list archive-list">
                      {archivedRecords.map((record) => {
                        const archivedBy = names.get(record.archivedBy) ?? "Участник";
                        const creator = names.get(record.createdBy) ?? "Участник";
                        const taskComments = record.recordType === "task" ? records.comments.filter((comment) => comment.taskId === record.id) : [];
                        const linkedGoal = records.goals.find((goal) => goal.id === (record.recordType === "task" ? record.goalId : record.parentId));
                        return (
                          <article className="shared-task-row archive-record" key={`${record.recordType}-${record.id}`}>
                            <div className="shared-record-content">
                              <div><span className={`archive-type archive-type-${record.recordType}`}>{record.recordType === "goal" ? `Цель · ${PERIOD_NAMES[record.period]}` : "Задача"}</span><strong>{record.title}</strong>{record.recordType === "task" && <span className={`status-pill status-${record.status === "Выполнено" ? "done" : record.status === "В процессе" ? "doing" : "todo"}`}>{record.status}</span>}</div>
                              <small>{record.recordType === "goal" ? `${record.startDate} — ${record.endDate}` : `${record.date}${record.time ? ` · ${record.time}` : ""}${record.deadline ? ` · срок ${record.deadline.replace("T", " ")}` : ""}`} · Создал: {creator}{record.recordType === "task" && ` · Ответственный: ${record.assigneeId ? names.get(record.assigneeId) ?? "Участник" : "Не назначен"}`}{linkedGoal ? ` · Связь: ${linkedGoal.title}` : ""}</small>
                              <small className="archive-attribution">Архивировал: {archivedBy} · {new Date(record.archivedAt).toLocaleString("ru-RU")}</small>
                              {record.notes && <p>{record.notes}</p>}
                              {taskComments.map((comment) => <div className="archive-comment" key={comment.id}><MessageCircle size={13} /><span>{comment.authorName}: {comment.body}</span><small>{new Date(comment.createdAt).toLocaleString("ru-RU")}</small></div>)}
                            </div>
                            <div className="goal-actions"><RecordHistory workspaceId={selectedId} recordId={record.id} recordType={record.recordType} members={records.members} archived canManage={canManageArchive} onArchive={() => toggleArchive(record.recordType, record)} /></div>
                          </article>
                        );
                      })}
                    </div>
                  ) : allArchivedRecords.length ? <p className="workspace-hint">По выбранным фильтрам записей нет.</p> : <p className="workspace-hint">В этом пространстве пока нет архивных записей.</p>}
                </section>
              ) : (
              <>
              <section className="workspace-record-section">
                <div className="section-heading"><div><span className="section-kicker">Общие цели и прогресс</span><h3>Цели</h3></div><button className="button button-primary" type="button" onClick={() => setRecordEditor({ kind: "goal" })}><Plus size={16} /> Новая цель</button></div>
                {visibleGoals.length ? <div className="shared-goal-list">{visibleGoals.map((goal) => {
                  const progress = getGoalProgress(
                    goal.id,
                    records.goals.filter((item) => !item.archivedAt),
                    records.tasks.filter((item) => !item.archivedAt),
                  );
                  const parent = records.goals.find((item) => item.id === goal.parentId);
                  const creator = names.get(goal.createdBy) ?? "Участник";
                  return <article className="shared-goal-row" key={goal.id}><span className={`period-badge badge-${goal.period}`}>{PERIOD_NAMES[goal.period]}</span><div className="shared-record-content"><div><strong>{goal.title}</strong>{goal.archivedAt && <span className="archive-label">В архиве</span>}<span className={`priority-pill priority-${goal.priority}`}>{goal.priority}</span></div><small>{goal.startDate} — {goal.endDate} · Создал: {creator}{parent ? ` · Связана с: ${parent.title}` : ""}</small>{goal.notes && <p>{goal.notes}</p>}<div className="goal-progress-row"><div className="progress-track"><span style={{ width: `${progress.percent}%` }} /></div><small>{progress.completed}/{progress.total} задач · {progress.percent}%</small></div></div><div className="goal-actions"><button className="icon-button" type="button" title="Редактировать цель" aria-label={`Редактировать цель ${goal.title}`} onClick={() => setRecordEditor({ kind: "goal", record: goal })}>✎</button><RecordHistory workspaceId={selectedId} recordId={goal.id} recordType="goal" members={records.members} archived={false} canManage={canManageArchive} onArchive={() => toggleArchive("goal", goal)} /><button className="icon-button danger-hover" type="button" title="Удалить цель" aria-label={`Удалить цель ${goal.title}`} disabled={Boolean(busy)} onClick={() => deleteGoal(goal)}><Trash2 size={15} /></button></div></article>;
                })}</div> : <p className="workspace-hint">На этот период общих целей нет.</p>}
              </section>
              <section className="workspace-record-section">
                <div className="section-heading"><div><span className="section-kicker">{visibleTasks.length} задач · {currentRange.start} — {currentRange.end}</span><h3>Задачи</h3></div><button className="button button-primary" type="button" onClick={() => setRecordEditor({ kind: "task" })}><Plus size={16} /> Новая задача</button></div>
                {visibleTasks.length ? <div className="shared-task-list">{visibleTasks.map((task) => {
                  const creator = names.get(task.createdBy) ?? "Участник";
                  const assignee = task.assigneeId ? names.get(task.assigneeId) ?? "Участник" : "Не назначен";
                  const linkedGoal = records.goals.find((goal) => goal.id === task.goalId);
                  const done = task.status === "Выполнено";
                  const taskComments = records.comments.filter((comment) => comment.taskId === task.id);
                  return (
                    <article className={`shared-task-row${done ? " task-done" : ""}`} key={task.id}>
                      <button
                        type="button"
                        className={`task-check${done ? " checked" : ""}`}
                        aria-label={done ? `Снять отметку: ${task.title}` : `Отметить выполненной: ${task.title}`}
                        disabled={Boolean(busy)}
                        onClick={() => toggleTask(task)}
                      >
                        {done && <Check size={13} />}
                      </button>
                      <div className="shared-record-content">
                        <div>
                          <strong className="task-name">{task.title}</strong>
                          <span className="task-category">{task.category}</span>
                          <span className={`priority-pill priority-${task.priority}`}>{task.priority}</span>
                          <span className={`status-pill status-${done ? "done" : task.status === "В процессе" ? "doing" : "todo"}`}>
                            <Circle size={7} fill="currentColor" />{task.status}
                          </span>
                        </div>
                        <small>
                          {task.date}{task.time ? ` · ${task.time}` : ""}{task.deadline ? ` · Срок ${task.deadline.replace("T", " ")}` : ""}
                          {" · Создал: "}{creator}{" · Ответственный: "}{assignee}
                          {linkedGoal ? ` · Цель: ${linkedGoal.title}` : ""}
                        </small>
                        <label className="task-assignee">
                          <span>Ответственный</span>
                          <select
                            aria-label={`Ответственный за задачу ${task.title}`}
                            value={task.assigneeId ?? ""}
                            disabled={Boolean(busy)}
                            onChange={(event) => assignTask(task, event.target.value)}
                          >
                            <option value="">Не назначен</option>
                            {records.members.map((member) => (
                              <option key={member.userId} value={member.userId}>{member.name}{member.userId === userId ? " (вы)" : ""}</option>
                            ))}
                          </select>
                        </label>
                        {task.notes && <p>{task.notes}</p>}
                        <div className="task-discussion">
                          <div className="task-discussion-heading"><MessageCircle size={14} /><strong>Обсуждение</strong><small>{taskComments.length}</small></div>
                          {taskComments.map((comment) => (
                            <div className="task-comment" key={comment.id}>
                              <div>
                                {editingComments[comment.id] !== undefined ? (
                                  <>
                                    <textarea rows="2" maxLength="4000" value={editingComments[comment.id]} onChange={(event) => setEditingComments({ ...editingComments, [comment.id]: event.target.value })} />
                                    <div className="task-comment-actions">
                                      <button className="button button-quiet" type="button" onClick={() => editComment(comment)}>Сохранить</button>
                                      <button className="button button-quiet" type="button" onClick={() => clearEditingComment(comment.id)}>Отмена</button>
                                    </div>
                                  </>
                                ) : <p>{comment.body}</p>}
                                <small>{comment.authorName ?? names.get(comment.authorId) ?? "Участник"} · {new Date(comment.createdAt).toLocaleString("ru-RU")}{comment.updatedAt !== comment.createdAt ? " · изменено" : ""}</small>
                              </div>
                              {(comment.authorId === userId || selectedWorkspace.role === "owner") && editingComments[comment.id] === undefined && (
                                <div className="goal-actions">
                                  {comment.authorId === userId && <button className="icon-button" type="button" aria-label="Изменить комментарий" onClick={() => setEditingComments({ ...editingComments, [comment.id]: comment.body })}>✎</button>}
                                  <button className="icon-button danger-hover" type="button" aria-label="Удалить комментарий" onClick={() => removeComment(comment)}><Trash2 size={14} /></button>
                                </div>
                              )}
                            </div>
                          ))}
                          <form className="task-comment-form" onSubmit={(event) => submitComment(task, event)}>
                            <textarea rows="2" maxLength="4000" placeholder="Написать комментарий…" value={commentDrafts[task.id] ?? ""} onChange={(event) => setCommentDrafts({ ...commentDrafts, [task.id]: event.target.value })} />
                            <button className="button button-secondary" type="submit" disabled={Boolean(busy) || !(commentDrafts[task.id] ?? "").trim()}><MessageCircle size={14} /> Отправить</button>
                          </form>
                        </div>
                      </div>
                      <div className="goal-actions">
                        <button className="icon-button" type="button" title="Редактировать задачу" aria-label={`Редактировать задачу ${task.title}`} onClick={() => setRecordEditor({ kind: "task", record: task })}>✎</button>
                        <RecordHistory workspaceId={selectedId} recordId={task.id} recordType="task" members={records.members} archived={false} canManage={canManageArchive} onArchive={() => toggleArchive("task", task)} />
                        <button className="icon-button danger-hover" type="button" title="Удалить задачу" aria-label={`Удалить задачу ${task.title}`} disabled={Boolean(busy)} onClick={() => deleteTask(task)}><Trash2 size={15} /></button>
                      </div>
                    </article>
                  );
                })}</div> : <p className="workspace-hint">На этот период общих задач нет.</p>}
              </section>
            </>
              )}
            </>
          )}
        </section>
      )}
    </section>
  );
}

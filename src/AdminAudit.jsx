import { useCallback, useEffect, useRef, useState } from "react";
import { adminAuditEvents } from "./supabase.js";
import { adminError as getErrorMessage } from "./adminError.js";

const ACTIONS = {
  block_user: "Блокировка пользователя", unblock_user: "Разблокировка пользователя",
  add_member: "Добавление участника", remove_member: "Удаление участника", change_member: "Изменение участника",
  change_owner: "Смена владельца", restore_owner: "Восстановление владельца (ранее)",
  cancel_invitation: "Отмена приглашения", correct_record: "Исправление записи", search_records: "Поиск записей",
};
const OBJECTS = { user: "Пользователь", workspaces: "Пространство", workspace_members: "Участник пространства",
  workspace_invitations: "Приглашение", goals: "Личная цель", tasks: "Личная задача",
  workspace_goals: "Цель пространства", workspace_tasks: "Задача пространства",
  workspace_task_comments: "Комментарий", profiles: "Профиль", record_search: "Поиск" };
const EMPTY = { from: "", to: "", action: "", objectType: "", objectId: "" };

export default function AdminAudit({ version }) {
  const [validation, setValidation] = useState("");
  const [draft, setDraft] = useState(EMPTY);
  const [filters, setFilters] = useState(EMPTY);
  const [page, setPage] = useState(0);
  const [state, setState] = useState({ status: "loading", events: [], total: 0, error: "" });
  const request = useRef(0);
  const load = useCallback(async () => {
    const id = ++request.current;
    setState((old) => ({ ...old, status: "loading", error: "" }));
    try {
      const result = await adminAuditEvents(filters, page * 20);
      if (id === request.current) setState({ status: "ready", ...result, error: "" });
    } catch (error) {
      if (id === request.current) setState({ status: "error", events: [], total: 0, error: getErrorMessage(error) });
    }
  }, [filters, page]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    return () => { request.current += 1; };
  }, [load, version]);
  const field = (name) => ({ value: draft[name], onChange: (event) => setDraft((old) => ({ ...old, [name]: event.target.value })) });
  function submit(event) {
    event.preventDefault();
    if (draft.from && draft.to && new Date(draft.from) >= new Date(draft.to)) { setValidation("Конец периода должен быть позже начала."); return; }
    setValidation("");
    // Date/time controls use the administrator's local timezone; the server receives explicit UTC.
    setFilters({ ...draft, from: draft.from ? new Date(draft.from).toISOString() : "", to: draft.to ? new Date(draft.to).toISOString() : "" });
    setPage(0);
  }
  return <section className="admin-events" aria-labelledby="admin-audit-title">
    <header className="admin-header"><h3 id="admin-audit-title">Журнал административных действий</h3>
      <button type="button" className="button button-secondary" disabled={state.status === "loading"} onClick={load}>Обновить журнал</button></header>
    <p className="workspace-hint">События нельзя редактировать или удалять. Время указано в вашем часовом поясе; верхняя граница периода не включается. Причины не должны содержать секреты и личные данные.</p>
    {validation && <p className="sync-alert" role="alert">{validation}</p>}
    <form className="admin-audit-filters" onSubmit={submit}>
      <label>С даты и времени<input type="datetime-local" {...field("from")} /></label>
      <label>До даты и времени<input type="datetime-local" {...field("to")} /></label>
      <label>Действие<select {...field("action")}><option value="">Все действия</option>{Object.entries(ACTIONS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label>Тип объекта<select {...field("objectType")}><option value="">Все объекты</option>{Object.entries(OBJECTS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label>ID объекта, пользователя или пространства<input type="search" maxLength={200} {...field("objectId")} /></label>
      <button className="button button-primary" type="submit">Применить</button>
      <button className="button button-secondary" type="button" onClick={() => { setValidation(""); setDraft(EMPTY); setFilters(EMPTY); setPage(0); }}>Сбросить</button>
    </form>
    {state.status === "error" && <p className="sync-alert" role="alert">{state.error}<button type="button" onClick={load}>Повторить</button></p>}
    {state.status === "loading" && <p role="status">Загружаем журнал…</p>}
    {state.status === "ready" && state.events.length === 0 && <p>Событий по выбранным фильтрам нет.</p>}
    <ul className="admin-event-list">{state.events.map((event) => <li key={event.id}>
      <div><strong>{ACTIONS[event.action] || event.action}</strong>
        <p>{OBJECTS[event.object_type] || event.object_type}: <code>{event.object_id || "ID не сохранён в старом событии"}</code>{event.operation && ` · ${event.operation}`}</p>
        <p>Администратор: <code>{event.admin_id}</code></p>
        {event.workspace_id && <p>Пространство: <code>{event.workspace_id}</code></p>}
        <p>Причина: {event.reason || "Не указана в старом событии"}</p></div>
      <time dateTime={event.created_at}>{new Date(event.created_at).toLocaleString("ru-RU")}</time>
    </li>)}</ul>
    <nav className="admin-pager" aria-label="Страницы журнала">
      <button type="button" disabled={page === 0 || state.status === "loading"} onClick={() => setPage((old) => old - 1)}>Назад</button>
      <span>{page + 1} / {Math.max(1, Math.ceil(state.total / 20))} · Событий: {state.total}</span>
      <button type="button" disabled={(page + 1) * 20 >= state.total || state.status === "loading"} onClick={() => setPage((old) => old + 1)}>Вперёд</button>
    </nav>
  </section>;
}

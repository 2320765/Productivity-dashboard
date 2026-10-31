import AdminConfirm from "./AdminConfirm.jsx";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Crown, RefreshCw, Search, Users, XCircle } from "lucide-react";
import { adminCancelWorkspaceInvitation, adminListWorkspaces, adminRestoreWorkspaceOwner, adminWorkspaceDetails } from "./supabase.js";
import { adminError as getErrorMessage } from "./adminError.js";

const PAGE_SIZE = 10;
const dateFormat = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", year: "numeric" });
const ROLE_LABELS = { owner: "Владелец", admin: "Админ", member: "Участник" };
const INVITE_LABELS = { pending: "Ожидает", accepted: "Принято", declined: "Отклонено", cancelled: "Отменено", expired: "Срок истёк" };

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : dateFormat.format(date);
}

function WorkspaceDetails({ workspace, onChanged }) {
  const [state, setState] = useState({ status: "loading", data: null, error: "" });
  const [confirmation, setConfirmation] = useState(null);
  const [pending, setPending] = useState("");
  const [actionError, setActionError] = useState("");

  const load = useCallback(async () => {
    setState((current) => ({ ...current, status: "loading", error: "" }));
    try {
      setState({ status: "ready", data: await adminWorkspaceDetails(workspace.id), error: "" });
    } catch (error) {
      setState({ status: "error", data: null, error: getErrorMessage(error) });
    }
  }, [workspace.id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  function run(key, title, description, changes, action) {
    setConfirmation({ title, description, changes, run: async reason => {
      setPending(key); setActionError("");
      try { await action(reason); await Promise.all([load(), onChanged()]); }
      finally { setPending(""); }
    }});
  }
  const cancelInvitation = invitation => run(invitation.id, "Отмена приглашения",
    "Получатель больше не сможет принять приглашение. При необходимости отправитель сможет создать новое.",
    [["Пространство", workspace.name], ["Получатель", invitation.invitee], ["ID приглашения", invitation.id], ["Статус", "Ожидает → Отменено"]],
    reason => adminCancelWorkspaceInvitation(invitation.id, reason));
  const restoreOwner = member => run(member.userId, "Смена владельца",
    "Новый владелец получит полный контроль над пространством. Текущий владелец станет администратором пространства.",
    [["Пространство", workspace.name], ["Текущий владелец", data?.members.find(m => m.role === "owner")?.label || workspace.owner], ["Новый владелец", member.label], ["ID нового владельца", member.userId], ["Роль нового владельца", (ROLE_LABELS[member.role] || member.role) + " → Владелец"]],
    reason => adminRestoreWorkspaceOwner(workspace.id, member.userId, reason));

  const { status, data, error } = state;
  return (
    <div className="admin-ws-details">
      {confirmation && <AdminConfirm action={confirmation} onClose={() => setConfirmation(null)} />}
      {actionError && <p className="sync-alert" role="alert">{actionError}</p>}
      {status === "loading" && !data && <p className="workspace-hint" role="status">Загружаем состав…</p>}
      {status === "error" && <p className="sync-alert" role="alert">Не удалось загрузить состав: {error}<button type="button" onClick={load}>Повторить</button></p>}
      {data && (
        <>
          <h4>Участники</h4>
          {data.members.length === 0 ? (
            <div className="empty-state"><strong>Участников нет</strong><span>Восстановить владельца можно только из числа текущих участников.</span></div>
          ) : (
            <ul className="admin-event-list">
              {data.members.map((member) => (
                <li key={member.userId}>
                  <span>{member.label} · {ROLE_LABELS[member.role] ?? member.role}{member.blocked ? " · заблокирован" : ""} · с {formatDate(member.joinedAt)}</span>
                  {member.role !== "owner" && !member.blocked && (
                    <button className="button button-secondary" type="button" disabled={Boolean(pending) || status !== "ready"} onClick={() => restoreOwner(member)}>
                      <Crown size={14} /> Назначить владельцем
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          <h4>Приглашения</h4>
          {data.invitations.length === 0 ? (
            <div className="empty-state"><strong>Приглашений нет</strong></div>
          ) : (
            <ul className="admin-event-list">
              {data.invitations.map((invitation) => (
                <li key={invitation.id}>
                  <span>{invitation.invitee} · {INVITE_LABELS[invitation.status] ?? invitation.status} · {formatDate(invitation.createdAt)}{invitation.invitedBy ? ` · от ${invitation.invitedBy}` : ""}</span>
                  {invitation.status === "pending" && (
                    <button className="button button-secondary" type="button" disabled={Boolean(pending) || status !== "ready"} onClick={() => cancelInvitation(invitation)}>
                      <XCircle size={14} /> Отменить
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

export default function AdminWorkspaces({ onAuditChanged = () => {} }) {
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [openId, setOpenId] = useState("");
  const [list, setList] = useState({ status: "loading", total: 0, workspaces: [], error: "" });
  const requestId = useRef(0);

  const load = useCallback(async () => {
    const current = ++requestId.current;
    setList((state) => ({ ...state, status: "loading", error: "" }));
    try {
      const data = await adminListWorkspaces(search, PAGE_SIZE, page * PAGE_SIZE);
      if (current === requestId.current) setList({ status: "ready", ...data, error: "" });
    } catch (error) {
      if (current === requestId.current) setList({ status: "error", total: 0, workspaces: [], error: getErrorMessage(error) });
    }
  }, [search, page]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    return () => { requestId.current += 1; };
  }, [load]);

  function submitSearch(event) {
    event.preventDefault();
    setPage(0);
    setOpenId("");
    setSearch(query.trim());
  }

  async function changed() {
    onAuditChanged();
    await load();
  }

  const pageCount = Math.max(1, Math.ceil(list.total / PAGE_SIZE));

  return (
    <section aria-busy={list.status === "loading"} className="admin-users" aria-labelledby="admin-ws-title">
      <header className="admin-header">
        <div>
          <h3 id="admin-ws-title">Рабочие пространства</h3>
          <p className="workspace-hint">Только название, владелец, состав, счётчики и приглашения. Содержимое целей и задач, комментарии и email недоступны.</p>
        </div>
        <button className="button button-secondary" type="button" onClick={load} disabled={list.status === "loading"}><RefreshCw size={15} /> Обновить</button>
      </header>

      <form className="admin-search" onSubmit={submitSearch} role="search">
        <label className="sr-only" htmlFor="admin-ws-search">Поиск пространства</label>
        <input id="admin-ws-search" type="search" value={query} maxLength={64} placeholder="Название, владелец или ID пространства" onChange={(event) => setQuery(event.target.value)} />
        <button className="button button-secondary" type="button" onClick={() => { setQuery(""); setSearch(""); setPage(0); setOpenId(""); }}>Сбросить</button>
        <button className="button button-primary" type="submit" disabled={list.status === "loading"}><Search size={15} /> Найти</button>
      </form>

      <p className="workspace-hint" role="status">Найдено: {list.total}{search && ` · Поиск: ${search}`}</p>
      {list.status === "error" && <p className="sync-alert" role="alert">Не удалось загрузить пространства: {list.error}<button type="button" onClick={load}>Повторить</button></p>}
      {list.status === "loading" && <p className="workspace-hint" role="status">Загружаем пространства…</p>}
      {list.status === "ready" && list.workspaces.length === 0 && (
        <div className="empty-state">
          <strong>{search ? "Ничего не нашли" : "Пространств пока нет"}</strong>
          <span>{search ? "Проверьте название, владельца или ID и повторите поиск." : "Здесь появятся созданные рабочие пространства."}</span>
        </div>
      )}

      {list.workspaces.length > 0 && (
        <ul className="admin-user-list">
          {list.workspaces.map((workspace) => (
            <li key={workspace.id} className="admin-user" data-blocked={!workspace.ownerOk}>
              <div className="admin-user-main">
                <strong>{workspace.name}</strong>
                <span>Владелец: {workspace.owner}{workspace.ownerOk ? "" : " (нарушено)"}</span>
                <small>Создано: {formatDate(workspace.createdAt)}</small>
              </div>
              <div className="admin-user-counts" aria-label="Счётчики">
                <span>Участники: <b>{workspace.members}</b></span>
                <span>Цели: <b>{workspace.goals}</b></span>
                <span>Задачи: <b>{workspace.tasks}</b></span>
                <span>Приглашения: <b>{workspace.pendingInvitations}</b></span>
              </div>
              <div className="admin-user-actions">
                <button className="button button-secondary" type="button" aria-expanded={openId === workspace.id} onClick={() => setOpenId(openId === workspace.id ? "" : workspace.id)}>
                  <Users size={14} /> {openId === workspace.id ? "Скрыть" : "Состав"}
                </button>
              </div>
              {openId === workspace.id && <WorkspaceDetails workspace={workspace} onChanged={changed} />}
            </li>
          ))}
        </ul>
      )}

      {list.total > PAGE_SIZE && (
        <nav className="admin-pager" aria-label="Страницы пространств">
          <button className="icon-button" type="button" onClick={() => setPage((value) => value - 1)} disabled={page === 0 || list.status === "loading"} aria-label="Назад"><ChevronLeft size={16} /></button>
          <span>{page + 1} / {pageCount}</span>
          <button className="icon-button" type="button" onClick={() => setPage((value) => value + 1)} disabled={page + 1 >= pageCount || list.status === "loading"} aria-label="Вперёд"><ChevronRight size={16} /></button>
        </nav>
      )}
    </section>
  );
}

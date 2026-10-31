import AdminConfirm from "./AdminConfirm.jsx";
import { useCallback, useEffect, useRef, useState } from "react";
import { Ban, ChevronLeft, ChevronRight, RefreshCw, Search, ShieldCheck, UserCheck } from "lucide-react";
import { adminListUsers, adminSetUserBlocked } from "./supabase.js";
import { adminError as getErrorMessage } from "./adminError.js";

const PAGE_SIZE = 10;
const dateFormat = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", year: "numeric" });

function formatDate(value, format = dateFormat) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : format.format(date);
}

export default function AdminUsers({ onAuditChanged = () => {} }) {
  const [confirmation, setConfirmation] = useState(null);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [list, setList] = useState({ status: "loading", total: 0, users: [], error: "" });
  const [pendingId, setPendingId] = useState("");
  const [actionError, setActionError] = useState("");
  const requestId = useRef(0);

  const loadUsers = useCallback(async () => {
    const current = ++requestId.current;
    setList((state) => ({ ...state, status: "loading", error: "" }));
    try {
      const data = await adminListUsers(search, PAGE_SIZE, page * PAGE_SIZE);
      if (current !== requestId.current) return;
      if (page > 0 && page * PAGE_SIZE >= data.total) { setPage(Math.max(0, Math.ceil(data.total / PAGE_SIZE) - 1)); return; }
      setList({ status: "ready", ...data, error: "" });
    } catch (error) {
      if (current === requestId.current) setList({ status: "error", total: 0, users: [], error: getErrorMessage(error) });
    }
  }, [search, page]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadUsers();
    return () => { requestId.current += 1; };
  }, [loadUsers]);
  function submitSearch(event) {
    event.preventDefault();
    setPage(0);
    setSearch(query.trim());
  }

  function toggleBlock(user) {
    const label = user.username ? '@' + user.username : user.displayName || user.id;
    const blocking = !user.blocked;
    setConfirmation({ title: blocking ? "Блокировка пользователя" : "Разблокировка пользователя",
      description: blocking ? "Доступ к данным и вход будут запрещены. Текущие сессии будут закрыты. Разблокировка доступна здесь же." : "Пользователь снова сможет войти. Закрытые сессии не восстанавливаются.",
      changes: [["Пользователь", label], ["ID", user.id], ["Статус", blocking ? "Активен → Заблокирован" : "Заблокирован → Активен"]],
      run: async reason => {
        setPendingId(user.id); setActionError("");
        try { await adminSetUserBlocked(user.id, blocking, reason); await loadUsers(); onAuditChanged(); }
        finally { setPendingId(""); }
      }
    });
  }

  const pageCount = Math.max(1, Math.ceil(list.total / PAGE_SIZE));

  return (
    <section aria-busy={list.status === "loading"} className="admin-users" aria-labelledby="admin-users-title">
      <header className="admin-header">
        <div>
          <h3 id="admin-users-title">Пользователи</h3>
          <p className="workspace-hint">Показываются только имя, username, дата регистрации, статус и число записей. Email, пароли и содержимое записей недоступны.</p>
        </div>
        <button className="button button-secondary" type="button" onClick={loadUsers} disabled={list.status === "loading"}><RefreshCw size={15} /> Обновить</button>
      </header>

      <form className="admin-search" onSubmit={submitSearch} role="search">
        <label className="sr-only" htmlFor="admin-user-search">Поиск пользователя</label>
        <input id="admin-user-search" type="search" value={query} maxLength={64} placeholder="Username, имя или ID пользователя" onChange={(event) => setQuery(event.target.value)} />
        <button className="button button-secondary" type="button" onClick={() => { setQuery(""); setSearch(""); setPage(0); }}>Сбросить</button>
        <button className="button button-primary" type="submit" disabled={list.status === "loading"}><Search size={15} /> Найти</button>
      </form>

      <p className="workspace-hint" role="status">Найдено: {list.total}{search && ` · Поиск: ${search}`}</p>
      {actionError && <p className="sync-alert" role="alert">{actionError}</p>}
      {list.status === "error" && (
        <p className="sync-alert" role="alert">Не удалось загрузить пользователей: {list.error}<button type="button" onClick={loadUsers}>Повторить</button></p>
      )}
      {list.status === "loading" && <p className="workspace-hint" role="status">Загружаем пользователей…</p>}
      {list.status === "ready" && list.users.length === 0 && (
        <div className="empty-state">
          <strong>{search ? "Никого не нашли" : "Пользователей пока нет"}</strong>
          <span>{search ? "Проверьте username, имя или ID и повторите поиск." : "Здесь появятся зарегистрированные пользователи."}</span>
        </div>
      )}

      {list.users.length > 0 && (
        <table className="admin-table"><caption className="sr-only">Пользователи сервиса</caption><thead><tr><th scope="col">Пользователь</th><th scope="col">Записи</th><th scope="col">Статус и действия</th></tr></thead><tbody>
          {list.users.map((user) => (
            <tr key={user.id} data-blocked={user.blocked}>
              <td className="admin-user-main">
                <strong>{user.displayName || "Без имени"}</strong>
                <span>{user.username ? `@${user.username}` : "username не задан"}</span>
                <small>Регистрация: {formatDate(user.createdAt)}</small>
              </td>
              <td className="admin-user-counts" aria-label="Связанные записи">
                <span>Цели: <b>{user.goals}</b></span>
                <span>Задачи: <b>{user.tasks}</b></span>
                <span>Пространства: <b>{user.workspaces}</b></span>
              </td>
              <td className="admin-user-actions">
                {user.isAdmin
                  ? <span className="admin-badge"><ShieldCheck size={13} /> Администратор</span>
                  : <span className="admin-badge" data-state={user.blocked ? "blocked" : "active"}>{user.blocked ? "Заблокирован" : "Активен"}</span>}
                {!user.isAdmin && (
                  <button className="button button-secondary" type="button" disabled={Boolean(pendingId) || list.status !== "ready"} onClick={() => toggleBlock(user)}>
                    {user.blocked ? <><UserCheck size={14} /> Разблокировать</> : <><Ban size={14} /> Заблокировать</>}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody></table>
      )}

      {list.total > PAGE_SIZE && (
        <nav className="admin-pager" aria-label="Страницы пользователей">
          <button className="icon-button" type="button" onClick={() => setPage((value) => value - 1)} disabled={page === 0 || list.status === "loading"} aria-label="Назад"><ChevronLeft size={16} /></button>
          <span>{page + 1} / {pageCount}</span>
          <button className="icon-button" type="button" onClick={() => setPage((value) => value + 1)} disabled={page + 1 >= pageCount || list.status === "loading"} aria-label="Вперёд"><ChevronRight size={16} /></button>
        </nav>
      )}


      {confirmation && <AdminConfirm action={confirmation} onClose={() => setConfirmation(null)} />}
    </section>
  );
}

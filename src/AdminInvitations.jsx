import AdminConfirm from "./AdminConfirm.jsx";
import { useCallback, useEffect, useRef, useState } from "react";
import { Ban } from "lucide-react";
import { adminCancelWorkspaceInvitation, adminListInvitations } from "./supabase.js";
import { adminError as getErrorMessage } from "./adminError.js";

const PAGE_SIZE = 10;
const dateFormat = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const STATUS_LABELS = { pending: "Ожидает", accepted: "Принято", declined: "Отклонено", cancelled: "Отменено", expired: "Срок истёк" };
const FILTERS = [["", "Все"], ["pending", "Ожидают"], ["expired", "Истёкшие"], ["accepted", "Принятые"], ["declined", "Отклонённые"], ["cancelled", "Отменённые"]];

function formatDate(value) {
  const date = new Date(value);
  return value && !Number.isNaN(date.getTime()) ? dateFormat.format(date) : "—";
}

export default function AdminInvitations({ onAuditChanged = () => {} }) {
  const request = useRef(0);
  const [confirmation, setConfirmation] = useState(null);
  const [filter, setFilter] = useState("");
  const [page, setPage] = useState(0);
  const [state, setState] = useState({ status: "loading", data: null, error: "" });
  const [notice, setNotice] = useState("");
  const [busyId, setBusyId] = useState("");

  const load = useCallback(async () => {
    const id = ++request.current;
    setState((current) => ({ ...current, status: "loading", error: "" }));
    try {
      const data = await adminListInvitations(filter, PAGE_SIZE, page * PAGE_SIZE);
      if (id !== request.current) return;
      if (page > 0 && page * PAGE_SIZE >= data.total) { setPage(Math.max(0, Math.ceil(data.total / PAGE_SIZE) - 1)); return; }
      setState({ status: "ready", data, error: "" });
    } catch (error) {
      if (id === request.current) setState({ status: "error", data: null, error: getErrorMessage(error) });
    }
  }, [filter, page]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    return () => { request.current += 1; };
  }, [load]);

  function cancel(invitation) {
    setConfirmation({ title: "Отмена приглашения", description: "Получатель больше не сможет принять это приглашение. Отправитель сможет создать новое.",
      changes: [["Пространство", invitation.workspace], ["Получатель", invitation.recipient], ["ID", invitation.id], ["Статус", "Ожидает → Отменено"]],
      run: async reason => {
        setBusyId(invitation.id); setNotice("");
        try { await adminCancelWorkspaceInvitation(invitation.id, reason); setNotice("Приглашение отменено."); onAuditChanged(); await load(); }
        finally { setBusyId(""); }
      }
    });
  }

  const { status, data, error } = state;
  const total = data?.total ?? 0;
  return (
    <section className="admin-users" aria-labelledby="admin-invitations-title">
      <header className="admin-header">
        <div>
          <h3 id="admin-invitations-title">Приглашения в пространства</h3>
          <p className="workspace-hint">Администратор может только отменить приглашение с причиной; принять его от имени пользователя нельзя. Приглашения действуют 14 дней, после чего отправитель может выслать новое.</p>
        </div>
      </header>

      <div className="admin-search" role="group" aria-label="Фильтр по статусу">
        {FILTERS.map(([value, label]) => (
          <button key={value || "all"} aria-pressed={filter === value} type="button" className={`button ${filter === value ? "button-primary" : "button-secondary"}`} onClick={() => { setFilter(value); setPage(0); }}>{label}</button>
        ))}
      </div>

      {notice && <p className="workspace-hint" role="status">{notice}</p>}
      {status === "loading" && <p className="workspace-hint" role="status">Загружаем приглашения…</p>}
      {status === "error" && (
        <p className="sync-alert" role="alert">Не удалось загрузить приглашения: {error}<button type="button" onClick={load}>Повторить</button></p>
      )}
      {status === "ready" && data.invitations.length === 0 && (
        <div className="empty-state"><strong>Приглашений нет</strong><span>Для выбранного фильтра ничего не найдено.</span></div>
      )}
      {status === "ready" && data.invitations.length > 0 && (
        <>
          <ul className="admin-user-list">
            {data.invitations.map((invitation) => (
              <li key={invitation.id} className="admin-user">
                <div className="admin-user-main">
                  <strong>{invitation.workspace || "Пространство"} · {STATUS_LABELS[invitation.status] ?? invitation.status}</strong>
                  <span>От {invitation.sender || "—"} → {invitation.recipient || "—"}</span>
                  <small>Отправлено: {formatDate(invitation.createdAt)} · Действует до: {formatDate(invitation.expiresAt)}</small>
                </div>
                {invitation.status === "pending" && (
                  <button className="button button-secondary" type="button" disabled={Boolean(busyId) || status !== "ready"} onClick={() => cancel(invitation)}>
                    <Ban size={15} /> Отменить
                  </button>
                )}
              </li>
            ))}
          </ul>
          <div className="admin-search">
            <button className="button button-secondary" type="button" disabled={page === 0} onClick={() => setPage((value) => value - 1)}>Назад</button>
            <span className="workspace-hint">{page * PAGE_SIZE + 1}–{page * PAGE_SIZE + data.invitations.length} из {total}</span>
            <button className="button button-secondary" type="button" disabled={(page + 1) * PAGE_SIZE >= total} onClick={() => setPage((value) => value + 1)}>Далее</button>
          </div>
        </>
      )}
      {confirmation && <AdminConfirm action={confirmation} onClose={() => setConfirmation(null)} />}
    </section>
  );
}

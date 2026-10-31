import { useState } from "react";
import { Search } from "lucide-react";
import { adminFindRecords } from "./supabase.js";
import { adminError as getErrorMessage } from "./adminError.js";

const dateFormat = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", year: "numeric" });
const KIND_LABELS = { goal: "Цель", task: "Задача" };

function formatDate(value) {
  const date = new Date(value);
  return value && !Number.isNaN(date.getTime()) ? dateFormat.format(date) : "—";
}

export default function AdminRecordLookup({ onAuditChanged = () => {} }) {
  const [query, setQuery] = useState("");
  const [reason, setReason] = useState("");
  const [state, setState] = useState({ status: "idle", data: null, error: "", query: "" });

  async function submit(event) {
    event.preventDefault();
    const term = query.trim();
    setState({ status: "loading", data: null, error: "", query: term });
    try {
      const data = await adminFindRecords(term, reason.trim());
      setState({ status: "ready", data, error: "", query: term });
      onAuditChanged();
    } catch (error) {
      setState({ status: "error", data: null, error: getErrorMessage(error), query: term });
    }
  }

  const { status, data, error } = state;
  return (
    <section className="admin-users" aria-labelledby="admin-records-title">
      <header className="admin-header">
        <div>
          <h3 id="admin-records-title">Поиск целей и задач</h3>
          <p className="workspace-hint">Только чтение. Точный username, ID пользователя или ID записи. Заметки и комментарии не показываются; каждый поиск записывается в журнал с причиной.</p>
        </div>
      </header>

      <form className="admin-search admin-search-stack" onSubmit={submit} role="search">
        <label className="sr-only" htmlFor="admin-record-query">Username или ID</label>
        <input id="admin-record-query" type="search" value={query} minLength={3} maxLength={64} required placeholder="Username, ID пользователя или ID записи" onChange={(event) => setQuery(event.target.value)} />
        <label className="sr-only" htmlFor="admin-record-reason">Причина поиска</label>
        <input id="admin-record-reason" type="text" value={reason} minLength={3} maxLength={120} required placeholder="Причина (например, номер обращения)" onChange={(event) => setReason(event.target.value)} />
        <button className="button button-primary" type="submit" disabled={status === "loading"}><Search size={15} /> Найти</button>
      </form>

      {status === "loading" && <p className="workspace-hint" role="status">Ищем…</p>}
      {status === "error" && <p className="sync-alert" role="alert">Не удалось выполнить поиск: {error}</p>}
      {status === "ready" && data.records.length === 0 && (
        <div className="empty-state">
          <strong>Ничего не найдено</strong>
          <span>{data.userFound ? "У пользователя нет целей и задач." : "Проверьте точное написание username или ID."}</span>
        </div>
      )}
      {status === "ready" && data.records.length > 0 && (
        <>
          <p className="workspace-hint">Результаты для: {state.query}. Только чтение; исправление и удаление записей здесь недоступны.</p>
          {data.total > data.records.length && <p className="workspace-hint">Показаны первые {data.records.length} из {data.total}. Уточните запрос.</p>}
          <ul className="admin-user-list">
            {data.records.map((record) => (
              <li key={`${record.scope}-${record.kind}-${record.recordId}`} className="admin-user">
                <div className="admin-user-main">
                  <strong>{record.title || "Без названия"}</strong>
                  <span>{KIND_LABELS[record.kind] ?? record.kind} · {record.scope === "workspace" ? `Пространство «${record.workspace || "—"}»` : "Личное"}</span>
                  <small>Владелец/автор: {record.owner} · ID: {record.recordId}</small>
                </div>
                <div className="admin-user-counts">
                  <span>Дата: <b>{formatDate(record.date)}</b></span>
                  {record.status && <span>Статус: <b>{record.status}</b></span>}
                  {record.archived && <span><b>В архиве</b></span>}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckSquare, RefreshCw, ShieldCheck, Target, UserPlus, Users, Briefcase } from "lucide-react";
import { loadAdminOverview } from "./supabase.js";
import AdminAudit from "./AdminAudit.jsx";
import AdminUsers from "./AdminUsers.jsx";
import AdminWorkspaces from "./AdminWorkspaces.jsx";
import AdminRecordLookup from "./AdminRecordLookup.jsx";
import AdminInvitations from "./AdminInvitations.jsx";
import AdminHealth from "./AdminHealth.jsx";
import { adminError as getErrorMessage } from "./adminError.js";

const EVENT_LABELS = {
  user_signup: { label: "Новая регистрация", icon: UserPlus },
  workspace_created: { label: "Создано рабочее пространство", icon: Briefcase },
};

const dateFormat = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const numberFormat = new Intl.NumberFormat("ru-RU");

function formatEventDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : dateFormat.format(date);
}

function AdminOverview() {
  const request = useRef(0);
  const [state, setState] = useState({ status: "loading", data: null, error: "" });

  const load = useCallback(async () => {
    const id = ++request.current;
    setState((current) => ({ ...current, status: "loading", error: "" }));
    try {
      const data = await loadAdminOverview();
      if (id === request.current) setState({ status: "ready", data, error: "" });
    } catch (error) {
      if (id === request.current) setState({ status: "error", data: null, error: getErrorMessage(error) });
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    return () => { request.current += 1; };
  }, [load]);

  const { status, data, error } = state;
  const stats = data ? [
    { key: "users", label: "Пользователи", value: data.users, hint: `+${numberFormat.format(data.usersLast7Days)} за 7 дней`, icon: Users },
    { key: "goals", label: "Цели", value: data.goals, hint: "личные и общие", icon: Target },
    { key: "tasks", label: "Задачи", value: data.tasks, hint: "личные и общие", icon: CheckSquare },
    { key: "workspaces", label: "Пространства", value: data.workspaces, hint: `+${numberFormat.format(data.workspacesLast7Days)} за 7 дней`, icon: Briefcase },
  ] : [];

  return (
    <section className="admin-panel" aria-labelledby="admin-title">
      <header className="admin-header">
        <div>
          <span className="eyebrow"><ShieldCheck size={14} /> Администратор</span>
          <h2 id="admin-title">Обзор сервиса</h2>
          <p className="workspace-hint">Только агрегированные данные: без email, названий и содержимого записей пользователей.</p>
        </div>
        <button className="button button-secondary" type="button" onClick={load} disabled={status === "loading"}>
          <RefreshCw size={15} /> Обновить
        </button>
      </header>

      {status === "loading" && data && <p className="workspace-hint" role="status">Обновляем обзор…</p>}

      {status === "error" && (
        <p className="sync-alert" role="alert">
          Не удалось загрузить обзор: {error}
          <button type="button" onClick={load}>Повторить</button>
        </p>
      )}

      {status === "loading" && !data && (
        <div className="admin-stats" role="status" aria-label="Загружаем обзор">
          {[0, 1, 2, 3].map((item) => <div key={item} className="admin-stat admin-skeleton" aria-hidden="true" />)}
        </div>
      )}

      {data && (
        <>
          <div className="admin-stats">
            {stats.map(({ key, label, value, hint, icon: Icon }) => (
              <article className="admin-stat" key={key}>
                <span className="admin-stat-icon"><Icon size={17} /></span>
                <strong>{numberFormat.format(value)}</strong>
                <span>{label}</span>
                <small>{hint}</small>
              </article>
            ))}
          </div>

          <section className="admin-events" aria-labelledby="admin-events-title">
            <h3 id="admin-events-title">Недавние события</h3>
            {data.events.length === 0 ? (
              <div className="empty-state">
                <strong>Событий пока нет</strong>
                <span>Здесь появятся новые регистрации и созданные пространства.</span>
              </div>
            ) : (
              <ul className="admin-event-list">
                {data.events.map((event, index) => {
                  const meta = EVENT_LABELS[event.kind] ?? { label: "Событие", icon: ShieldCheck };
                  const Icon = meta.icon;
                  return (
                    <li key={`${event.kind}-${event.at}-${index}`}>
                      <span className="admin-stat-icon"><Icon size={15} /></span>
                      <span>{meta.label}</span>
                      <time dateTime={event.at}>{formatEventDate(event.at)}</time>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      )}


    </section>
  );
}

const SECTIONS = [["overview", "Обзор"], ["users", "Пользователи"], ["workspaces", "Пространства"], ["invitations", "Приглашения"], ["records", "Поиск записей"], ["health", "Состояние сайта"], ["audit", "Журнал"]];
export default function AdminPanel() {
  const [section, setSection] = useState("overview");
  const [auditVersion, setAuditVersion] = useState(0);
  const changed = () => setAuditVersion(value => value + 1);
  return <div className="admin-area">
    <header className="admin-area-header"><span className="admin-badge"><ShieldCheck size={16} /> Административный раздел</span><p>Доступ ограничен. Важные изменения требуют причины и записываются в журнал.</p></header>
    <nav className="admin-nav" aria-label="Разделы администрирования">{SECTIONS.map(([id, label]) => <button key={id} type="button" className={section === id ? "button button-primary" : "button button-secondary"} aria-current={section === id ? "page" : undefined} onClick={() => setSection(id)}>{label}</button>)}</nav>
    <div key={section} id="admin-section" tabIndex={-1}>
      {section === "overview" && <AdminOverview />}
      {section === "users" && <AdminUsers onAuditChanged={changed} />}
      {section === "workspaces" && <AdminWorkspaces onAuditChanged={changed} />}
      {section === "invitations" && <AdminInvitations onAuditChanged={changed} />}
      {section === "records" && <AdminRecordLookup onAuditChanged={changed} />}
      {section === "health" && <AdminHealth />}
      {section === "audit" && <AdminAudit version={auditVersion} />}
    </div>
  </div>;
}

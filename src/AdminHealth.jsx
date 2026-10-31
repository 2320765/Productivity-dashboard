import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { adminHealth, checkAuthHealth } from "./supabase.js";
import { adminError as getErrorMessage } from "./adminError.js";

const dateFormat = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" });
const PERIODS = [[1, "1 час"], [24, "24 часа"], [168, "7 дней"], [720, "30 дней"]];
const CATEGORIES = [["", "Все типы"], ["sync", "Синхронизация"], ["realtime", "Реальное время"], ["load", "Загрузка"], ["local_storage", "Локальное хранилище"]];
const CATEGORY_LABELS = Object.fromEntries(CATEGORIES.filter(([value]) => value));
const HINTS = {
  "40001": "Конфликт версий: данные изменили на другом устройстве.",
  "42501": "Недостаточно прав или сессия недействительна — войти заново.",
  "28000": "Пользователь не авторизован: истекла сессия.",
  PGRST301: "Токен сессии недействителен или истёк.",
  TIMED_OUT: "Таймаут подписки реального времени — проверьте сеть.",
  CHANNEL_ERROR: "Канал реального времени недоступен.",
  TypeError: "Сетевая ошибка: сервер недоступен или нет связи.",
  "57014": "Запрос к базе превысил лимит времени.",
};

function formatDate(value) {
  const date = new Date(value);
  return value && !Number.isNaN(date.getTime()) ? dateFormat.format(date) : "—";
}

export default function AdminHealth() {
  const request = useRef(0);
  const [hours, setHours] = useState(24);
  const [category, setCategory] = useState("");
  const [state, setState] = useState({ status: "loading", data: null, error: "", latency: null, auth: null });

  const load = useCallback(async () => {
    const id = ++request.current;
    setState((current) => ({ ...current, status: "loading", error: "", auth: null }));
    const started = performance.now();
    const authPromise = checkAuthHealth();
    try {
      const data = await adminHealth(hours, category);
      const auth = await authPromise;
      if (id === request.current) setState({ status: "ready", data, error: "", latency: Math.round(performance.now() - started), auth });
    } catch (error) {
      const auth = await authPromise;
      if (id === request.current) setState({ status: "error", data: null, error: getErrorMessage(error), latency: null, auth });
    }
  }, [hours, category]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    return () => { request.current += 1; };
  }, [load]);

  const { status, data, error, latency, auth } = state;
  const dbOk = status === "ready";
  const tiles = [
    { key: "db", label: "База данных (API)", ok: dbOk, text: dbOk ? `Доступна · ${latency} мс` : status === "loading" ? "Проверяем…" : "Недоступна" },
    { key: "auth", label: "Авторизация", ok: auth === true, text: auth === null ? "Проверяем…" : auth ? "Доступна" : "Недоступна" },
    { key: "sync", label: "Последняя синхронизация", ok: Boolean(data?.lastSyncAt), text: data ? (data.lastSyncAt ? formatDate(data.lastSyncAt) : "Данных нет") : "—" },
  ];

  return (
    <section className="admin-users" aria-labelledby="admin-health-title">
      <header className="admin-header">
        <div>
          <h3 id="admin-health-title">Состояние сайта и синхронизации</h3>
          <p className="workspace-hint">Журнал ошибок хранит только категорию и короткий технический код (не более 10 событий в час на пользователя, 30 дней). Текстов ошибок, токенов, заметок и персональных данных нет.</p>
        </div>
        <button className="button button-secondary" type="button" onClick={load} disabled={status === "loading"}><RefreshCw size={15} /> Обновить</button>
      </header>

      <div className="admin-stats">
        {tiles.map((tile) => (
          <article className="admin-stat" key={tile.key}>
            <span>{tile.label}</span>
            <strong>{status === "loading" ? "…" : tile.ok ? "✓" : "!"}</strong>
            <small>{tile.text}</small>
          </article>
        ))}
        <article className="admin-stat">
          <span>Синхронизаций за 24 ч</span>
          <strong>{data ? data.syncsLast24h : "—"}</strong>
          <small>по пользователям с обновлёнными данными</small>
        </article>
      </div>

      <div className="admin-search" role="group" aria-label="Фильтры ошибок">
        <label className="sr-only" htmlFor="health-period">Период</label>
        <select id="health-period" value={hours} onChange={(event) => setHours(Number(event.target.value))}>
          {PERIODS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <label className="sr-only" htmlFor="health-category">Тип ошибки</label>
        <select id="health-category" value={category} onChange={(event) => setCategory(event.target.value)}>
          {CATEGORIES.map(([value, label]) => <option key={value || "all"} value={value}>{label}</option>)}
        </select>
      </div>

      {status === "loading" && !data && <p className="workspace-hint" role="status">Загружаем состояние…</p>}
      {status === "error" && (
        <p className="sync-alert" role="alert">Не удалось получить состояние: {error}. Проверьте подключение к интернету и сессию администратора.<button type="button" onClick={load}>Повторить</button></p>
      )}
      {status === "ready" && data.errors.length === 0 && (
        <div className="empty-state"><strong>Ошибок нет</strong><span>За выбранный период ошибок не зафиксировано.</span></div>
      )}
      {status === "ready" && data.errors.length > 0 && (
        <>
          <p className="workspace-hint">
            Всего за период: {data.errorTotal}. {Object.entries(data.byCategory).map(([key, count]) => `${CATEGORY_LABELS[key] ?? key}: ${count}`).join(" · ")}
          </p>
          <ul className="admin-user-list">
            {data.errors.map((item) => (
              <li key={item.id} className="admin-user">
                <div className="admin-user-main">
                  <strong>{CATEGORY_LABELS[item.category] ?? item.category} · {item.code}</strong>
                  <span>{HINTS[item.code] ?? "Код без описания: см. документацию Supabase/PostgREST."}</span>
                  <small>{formatDate(item.createdAt)}</small>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

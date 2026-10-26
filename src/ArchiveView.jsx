import { useEffect, useMemo, useRef, useState } from "react";
import { Archive, ArchiveRestore, CalendarDays, Search, Target, Trash2, X } from "lucide-react";
import { RECORD_STATUSES, searchRecords } from "./archive.js";

const TYPE_LABELS = { task: "Задача", goal: "Цель" };
const STATUS_CLASS = { "Выполнено": "done", "В процессе": "doing", "К выполнению": "todo", "Без задач": "todo" };

function formatDate(row) {
  return row.type === "goal" && row.endDate !== row.date ? `${row.date} — ${row.endDate}` : row.date;
}

function formatArchivedAt(value) {
  return value ? new Date(value).toLocaleDateString("ru-RU") : "";
}

export function ResultMeta({ row }) {
  return (
    <>
      <span className={`archive-type archive-type-${row.type}`}>{TYPE_LABELS[row.type]}</span>
      <span className={`status-pill status-${STATUS_CLASS[row.status] ?? "todo"}`}>{row.status}</span>
      <small className="result-date"><CalendarDays size={12} />{formatDate(row)}</small>
      {row.goalTitle && <small className="result-goal"><Target size={12} />{row.goalTitle}</small>}
      {row.archived && <small className="result-archived"><Archive size={12} />в архиве</small>}
    </>
  );
}

export function GlobalSearch({ dashboard, onSelect }) {
  const [query, setQuery] = useState("");
  const [includeArchive, setIncludeArchive] = useState(true);
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const results = useMemo(
    () => query.trim() ? searchRecords(dashboard, query, { scope: includeArchive ? "all" : "active", limit: 8 }) : [],
    [dashboard, includeArchive, query],
  );

  useEffect(() => {
    function onPointerDown(event) {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  function choose(row) {
    setOpen(false);
    setQuery("");
    onSelect(row);
  }

  return (
    <section className="global-search" ref={rootRef}>
      <label className="search-box">
        <Search size={16} />
        <input
          value={query}
          onChange={(event) => { setQuery(event.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={(event) => {
            if (event.key === "Escape") setOpen(false);
            if (event.key === "Enter" && results[0]) choose(results[0]);
          }}
          placeholder="Поиск по всем задачам и целям, включая заметки"
          aria-label="Глобальный поиск"
        />
        {query && <button type="button" onClick={() => setQuery("")} aria-label="Очистить поиск"><X size={14} /></button>}
      </label>
      <label className="global-search-toggle"><input type="checkbox" checked={includeArchive} onChange={(event) => setIncludeArchive(event.target.checked)} /> Искать в архиве</label>
      {open && query.trim() && (
        <div className="global-search-results" role="listbox" aria-label="Результаты поиска">
          {results.length ? results.map((row) => (
            <button type="button" role="option" aria-selected="false" className="global-search-result" key={row.key} onClick={() => choose(row)}>
              <strong>{row.title}</strong>
              <span className="result-meta"><ResultMeta row={row} /></span>
            </button>
          )) : <p className="workspace-hint">Ничего не найдено.</p>}
        </div>
      )}
    </section>
  );
}

export default function ArchiveView({ dashboard, highlightKey, onRestore, onDelete }) {
  const [query, setQuery] = useState("");
  const [type, setType] = useState("all");
  const [status, setStatus] = useState("all");
  const [dateBy, setDateBy] = useState("archived");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const total = useMemo(() => searchRecords(dashboard, "", { scope: "archived" }).length, [dashboard]);
  const rows = useMemo(
    () => searchRecords(dashboard, query, { scope: "archived", type, status, from, to, dateBy }),
    [dashboard, dateBy, from, query, status, to, type],
  );

  useEffect(() => {
    if (!highlightKey) return;
    document.querySelector(`[data-record-key="${highlightKey}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [highlightKey]);

  return (
    <div className="archive-view personal-archive">
      <p className="workspace-hint">Архивные записи скрыты из обычных списков, но остаются в базе и учитываются в прогрессе и статистике. Их можно восстановить.</p>
      <div className="archive-filters personal-archive-filters">
        <label className="search-box"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск по названию и заметкам" aria-label="Поиск в архиве" /></label>
        <label className="field"><span>Тип</span><select value={type} onChange={(event) => setType(event.target.value)}><option value="all">Задачи и цели</option><option value="task">Только задачи</option><option value="goal">Только цели</option></select></label>
        <label className="field"><span>Статус</span><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">Любой</option>{RECORD_STATUSES.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
        <label className="field"><span>Дата</span><select value={dateBy} onChange={(event) => setDateBy(event.target.value)}><option value="archived">Дата архивации</option><option value="record">Дата записи</option></select></label>
        <label className="field"><span>С</span><input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
        <label className="field"><span>По</span><input type="date" min={from || undefined} value={to} onChange={(event) => setTo(event.target.value)} /></label>
      </div>
      {rows.length ? (
        <div className="shared-task-list archive-list">
          {rows.map((row) => (
            <article className={`shared-task-row archive-record${row.key === highlightKey ? " record-highlight" : ""}`} key={row.key} data-record-key={row.key}>
              <div className="shared-record-content">
                <div><strong>{row.title}</strong><span className="result-meta"><ResultMeta row={{ ...row, archived: false }} /></span></div>
                <small className="archive-attribution">В архиве с {formatArchivedAt(row.archivedAt)}{row.recurring ? " · вся серия повторений" : ""}</small>
                {row.notes && <p>{row.notes}</p>}
              </div>
              <div className="goal-actions">
                <button type="button" className="button button-secondary" onClick={() => onRestore(row)}><ArchiveRestore size={15} /> Восстановить</button>
                <button type="button" className="icon-button danger-hover" onClick={() => onDelete(row)} title="Удалить навсегда" aria-label={`Удалить навсегда: ${row.title}`}><Trash2 size={15} /></button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="table-empty"><span className="empty-icon"><Archive size={20} /></span><strong>{total ? "В архиве ничего не найдено" : "Архив пуст"}</strong><span>{total ? "Измените поиск или фильтры." : "Архивируйте выполненные задачи и старые цели, чтобы убрать их из списков, не теряя историю."}</span></div>
      )}
    </div>
  );
}

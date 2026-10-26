import { useMemo, useState } from "react";
import { CalendarClock, Repeat, Undo2, X } from "lucide-react";
import { describeRecurrence } from "./recurrence.js";
import { dueDate, getNextWeekStart, getOverdueTasks, getTomorrow, OVERDUE_LOOKBACK_DAYS, planReschedule, taskKey } from "./reschedule.js";

function fmt(date) {
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long" }).format(new Date(`${date}T12:00:00`));
}

function daysLate(task, today) {
  return Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${dueDate(task)}T00:00:00Z`)) / 86400000);
}

function plural(count, one, few, many) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

export default function OverdueTasks({ tasks, goals, today, onApply, onUndo }) {
  const overdue = useMemo(() => getOverdueTasks(tasks, today), [tasks, today]);
  const [selected, setSelected] = useState(() => new Set());
  const [customDate, setCustomDate] = useState(getTomorrow(today));
  const [pending, setPending] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const tomorrow = getTomorrow(today);
  const nextWeek = getNextWeekStart(today);
  // Выбор хранится по ключам; устаревшие ключи (задача уже перенесена) просто не попадают в список.
  const chosen = overdue.filter((task) => selected.has(taskKey(task)));
  const allChosen = overdue.length > 0 && chosen.length === overdue.length;

  function toggle(task) {
    setSelected((current) => {
      const next = new Set(current);
      const key = taskKey(task);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function request(items, date) {
    setError("");
    if (!date || date < today) {
      setError("Выберите дату не раньше сегодняшней.");
      return;
    }
    const plan = planReschedule(tasks, items, date, goals);
    if (!plan.changes.length) {
      setError("Нечего переносить: задачи уже стоят на эту дату.");
      return;
    }
    if (items.length === 1) commit(plan, date);
    else setPending({ plan, date, count: plan.changes.length });
  }

  function commit(plan, date) {
    try {
      onApply(plan.changes);
      setResult({ plan, date });
      setSelected(new Set());
      setPending(null);
    } catch (applyError) {
      setError(`Не удалось перенести: ${applyError instanceof Error ? applyError.message : String(applyError)}`);
    }
  }

  function undo() {
    if (!result) return;
    try {
      onUndo(result.plan.changes);
      setResult(null);
    } catch (undoError) {
      setError(`Не удалось отменить: ${undoError instanceof Error ? undoError.message : String(undoError)}`);
    }
  }

  const quick = (items) => (
    <>
      <button type="button" className="button button-secondary" onClick={() => request(items, tomorrow)}>Завтра</button>
      <button type="button" className="button button-secondary" onClick={() => request(items, nextWeek)} title={`Понедельник, ${fmt(nextWeek)}`}>След. неделя</button>
    </>
  );

  return (
    <div className="overdue">
      <p className="workspace-hint">Здесь личные задачи, срок которых прошёл, а статус не «Выполнено». Ничего не переносится само: выберите дату вручную. Для повторяющихся задач переносится только выбранный экземпляр (за последние {OVERDUE_LOOKBACK_DAYS} дней).</p>

      {result && (
        <p className="sync-notice overdue-result" role="status">
          <span>Перенесено: {result.plan.changes.length} {plural(result.plan.changes.length, "задача", "задачи", "задач")} на {fmt(result.date)}.</span>
          <button type="button" className="button button-quiet" onClick={undo}><Undo2 size={13} /> Отменить перенос</button>
          <button type="button" aria-label="Закрыть сообщение" onClick={() => setResult(null)}><X size={12} /></button>
        </p>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}

      {pending && (
        <div className="sync-notice overdue-confirm" role="alertdialog" aria-label="Подтвердите массовый перенос">
          <span>
            Будет изменено задач: <b>{pending.count}</b>. Новая дата: <b>{fmt(pending.date)}</b>.
            {pending.plan.goalUnlinks > 0 && ` У ${pending.plan.goalUnlinks} задач дата выходит за срок цели — связь с целью будет снята.`}
            {pending.plan.goalWarnings > 0 && ` ${pending.plan.goalWarnings} экземпляров повторов выйдут за срок цели и не будут учитываться в её прогрессе.`}
            {" "}Копии не создаются, правила повторения не меняются.
          </span>
          <button type="button" className="button button-primary" onClick={() => commit(pending.plan, pending.date)}>Перенести {pending.count}</button>
          <button type="button" className="button button-quiet" onClick={() => setPending(null)}>Отмена</button>
        </div>
      )}

      {overdue.length === 0 ? (
        <div className="table-empty"><span className="empty-icon"><CalendarClock size={20} /></span><strong>Просроченных задач нет</strong><span>Все прошлые задачи выполнены или перенесены.</span></div>
      ) : (
        <>
          <div className="overdue-bulk">
            <label className="overdue-all"><input type="checkbox" checked={allChosen} onChange={() => setSelected(allChosen ? new Set() : new Set(overdue.map(taskKey)))} /> Выбрать все ({overdue.length})</label>
            {chosen.length > 0 && (
              <div className="overdue-actions">
                <span>Выбрано: {chosen.length}</span>
                {quick(chosen)}
                <input type="date" min={today} value={customDate} aria-label="Дата переноса выбранных" onChange={(event) => setCustomDate(event.target.value)} />
                <button type="button" className="button button-primary" onClick={() => request(chosen, customDate)}>Перенести выбранные</button>
              </div>
            )}
          </div>
          <ul className="overdue-list">
            {overdue.map((task) => (
              <li key={taskKey(task)} className="overdue-row">
                <input type="checkbox" checked={selected.has(taskKey(task))} onChange={() => toggle(task)} aria-label={`Выбрать: ${task.title}`} />
                <div className="overdue-info">
                  <strong>{task.title}</strong>
                  <small>
                    Срок {fmt(dueDate(task))}{task.time ? ` ${task.time}` : ""} · просрочено на {daysLate(task, today)} дн. · {task.priority}
                    {task.moveCount ? ` · уже переносилась ${task.moveCount} р. (с ${fmt(task.movedFrom)})` : ""}
                  </small>
                  {task.recurrence && <span className="recurrence-badge"><Repeat size={11} />{describeRecurrence(task.recurrence, task.seriesStart ?? task.date)} · только этот экземпляр</span>}
                </div>
                <div className="overdue-actions">
                  {quick([task])}
                  <input type="date" min={today} value={customDate} aria-label={`Дата переноса: ${task.title}`} onChange={(event) => setCustomDate(event.target.value)} />
                  <button type="button" className="button button-secondary" onClick={() => request([task], customDate)}>Перенести</button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

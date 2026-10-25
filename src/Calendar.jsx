import { useMemo, useState } from "react";
import { AlertTriangle, ArrowLeft, ArrowRight, Check, Clock3, Plus, Repeat, X } from "lucide-react";
import { localDateString } from "./dashboard.js";
import { expandTasks } from "./recurrence.js";
import {
  findConflicts, getCalendarRange, getMonthWeeks, groupByHour, shiftCalendar, splitDayTasks, tasksByDate,
} from "./calendar.js";
import { getErrorMessage } from "./errorMessage.js";

const MODES = [
  { id: "month", label: "Месяц" },
  { id: "week", label: "Неделя" },
  { id: "day", label: "День" },
];
const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

function formatDate(date, options) {
  return new Intl.DateTimeFormat("ru-RU", options).format(new Date(`${date}T12:00:00`));
}

function title(date, mode, range) {
  if (mode === "day") return formatDate(date, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  if (mode === "week") return `${formatDate(range.start, { day: "numeric", month: "short" })} — ${formatDate(range.end, { day: "numeric", month: "short", year: "numeric" })}`;
  return formatDate(date, { month: "long", year: "numeric" });
}

function TaskChip({ task, conflict, showTime = true, onOpen, onDragStart }) {
  const done = task.status === "Выполнено";
  const draggable = !task.recurrence;
  return (
    <button
      type="button"
      className={`cal-task priority-${task.priority}${done ? " cal-done" : ""}${conflict ? " cal-conflict" : ""}`}
      draggable={draggable}
      onDragStart={draggable ? (event) => { event.dataTransfer.setData("text/plain", task.id); event.dataTransfer.effectAllowed = "move"; onDragStart(task); } : undefined}
      onClick={() => onOpen(task)}
      title={`${task.title}${task.time ? ` · ${task.time}` : ""}${conflict ? " · совпадает по времени с другой задачей" : ""}`}
    >
      {done && <Check size={11} />}
      {showTime && task.time && <b>{task.time}</b>}
      <span>{task.title}</span>
      {task.recurrence && <Repeat size={10} aria-label="Повторяется" />}
      {conflict && <AlertTriangle size={11} className="cal-conflict-icon" aria-label="Конфликт по времени" />}
    </button>
  );
}

export default function TaskCalendar({ tasks, selectedDate, onDateChange, onOpenTask, onCreateTask, onMoveTask }) {
  const [mode, setMode] = useState("month");
  const [dragged, setDragged] = useState(null);
  const [pendingMove, setPendingMove] = useState(null);
  const [moving, setMoving] = useState(false);
  const [message, setMessage] = useState({ type: "", text: "" });
  const today = localDateString();
  const range = useMemo(() => getCalendarRange(selectedDate, mode), [selectedDate, mode]);
  const instances = useMemo(() => expandTasks(tasks, range.start, range.end), [tasks, range.start, range.end]);
  const byDate = useMemo(() => tasksByDate(instances), [instances]);

  function drop(event, date, time = "") {
    event.preventDefault();
    if (!dragged || (dragged.date === date && (dragged.time ?? "") === (time || dragged.time || ""))) return;
    setPendingMove({ task: dragged, date, time });
    setDragged(null);
  }

  async function confirmMove() {
    if (!pendingMove || moving) return;
    setMoving(true);
    try {
      await onMoveTask(pendingMove.task, pendingMove.date, pendingMove.time);
      setMessage({ type: "ok", text: `«${pendingMove.task.title}» перенесена на ${formatDate(pendingMove.date, { day: "numeric", month: "long" })}${pendingMove.time ? ` в ${pendingMove.time}` : ""}.` });
    } catch (error) {
      setMessage({ type: "error", text: `Не удалось перенести задачу: ${getErrorMessage(error)}` });
    } finally {
      setPendingMove(null);
      setMoving(false);
    }
  }

  const dropProps = (date, time) => ({
    onDragOver: (event) => { if (dragged) event.preventDefault(); },
    onDrop: (event) => drop(event, date, time),
  });
  const chipProps = { onOpen: onOpenTask, onDragStart: setDragged };

  function renderDayCell(date, compact) {
    const { timed, untimed } = splitDayTasks(byDate.get(date) ?? []);
    const conflicts = findConflicts(timed);
    const outside = mode === "month" && date.slice(0, 7) !== selectedDate.slice(0, 7);
    const limit = compact ? 3 : Infinity;
    const all = [...timed, ...untimed];
    return (
      <div className={`cal-cell${date === today ? " cal-today" : ""}${date === selectedDate ? " cal-selected" : ""}${outside ? " cal-outside" : ""}`} {...dropProps(date, "")}>
        <div className="cal-cell-head">
          <button type="button" className="cal-date" onClick={() => { onDateChange(date); setMode("day"); }} aria-label={`Открыть день ${date}`}>{Number(date.slice(8))}</button>
          <button type="button" className="cal-add" onClick={() => onCreateTask(date, "")} aria-label={`Создать задачу на ${date}`} title="Создать задачу"><Plus size={12} /></button>
        </div>
        {all.slice(0, limit).map((task) => <TaskChip key={`${task.id}:${task.occurrenceDate ?? ""}`} task={task} conflict={conflicts.has(task)} {...chipProps} />)}
        {all.length > limit && <button type="button" className="cal-more" onClick={() => { onDateChange(date); setMode("day"); }}>ещё {all.length - limit}</button>}
      </div>
    );
  }

  function renderDaySchedule() {
    const { timed, untimed } = splitDayTasks(byDate.get(selectedDate) ?? []);
    const conflicts = findConflicts(timed);
    const hours = groupByHour(timed);
    return (
      <div className="cal-day">
        <section className="cal-untimed" aria-label="Без времени" {...dropProps(selectedDate, "")}>
          <h3>Без времени <small>{untimed.length}</small></h3>
          {untimed.length ? untimed.map((task) => <TaskChip key={`${task.id}:${task.occurrenceDate ?? ""}`} task={task} showTime={false} {...chipProps} />) : <p className="workspace-hint">Задач без времени нет.</p>}
        </section>
        <section className="cal-schedule" aria-label="Расписание дня">
          {conflicts.size > 0 && <p className="cal-conflict-note" role="status"><AlertTriangle size={13} /> Есть задачи на одно время — они показаны рядом.</p>}
          {HOURS.map((hour) => {
            const label = `${String(hour).padStart(2, "0")}:00`;
            const items = hours.get(hour) ?? [];
            return (
              <div className="cal-hour" key={hour} {...dropProps(selectedDate, label)}>
                <span className="cal-hour-label">{label}</span>
                <div className="cal-hour-body">
                  {items.map((task) => <TaskChip key={`${task.id}:${task.occurrenceDate ?? ""}`} task={task} conflict={conflicts.has(task)} {...chipProps} />)}
                </div>
                <button type="button" className="cal-add" onClick={() => onCreateTask(selectedDate, label)} aria-label={`Создать задачу на ${label}`} title={`Создать задачу на ${label}`}><Plus size={12} /></button>
              </div>
            );
          })}
        </section>
      </div>
    );
  }

  const weeks = mode === "month" ? getMonthWeeks(selectedDate) : [];
  const weekDays = mode === "week" ? Array.from({ length: 7 }, (_, index) => shiftCalendar(range.start, "day", index)) : [];

  return (
    <div className="calendar">
      <div className="cal-toolbar">
        <div className="view-switch" role="tablist" aria-label="Режим календаря">
          {MODES.map(({ id, label }) => <button key={id} type="button" role="tab" aria-selected={mode === id} className={mode === id ? "view-tab active" : "view-tab"} onClick={() => setMode(id)}>{label}</button>)}
        </div>
        <div className="period-controls">
          <button className="icon-button" type="button" aria-label="Назад" onClick={() => onDateChange(shiftCalendar(selectedDate, mode, -1))}><ArrowLeft size={16} /></button>
          <h3 className="period-title">{title(selectedDate, mode, range)}</h3>
          <button className="icon-button" type="button" aria-label="Вперёд" onClick={() => onDateChange(shiftCalendar(selectedDate, mode, 1))}><ArrowRight size={16} /></button>
        </div>
        <button type="button" className="button button-secondary" onClick={() => onDateChange(today)}>Сегодня</button>
        <input className="cal-date-input" type="date" value={selectedDate} aria-label="Выбрать дату" onChange={(event) => event.target.value && onDateChange(event.target.value)} />
        <button type="button" className="button button-primary" onClick={() => onCreateTask(selectedDate, "")}><Plus size={16} /> Задача на {formatDate(selectedDate, { day: "numeric", month: "short" })}</button>
      </div>

      {pendingMove && (
        <p className="sync-notice cal-confirm" role="alertdialog">
          <span>Перенести «{pendingMove.task.title}» на {formatDate(pendingMove.date, { day: "numeric", month: "long" })}{pendingMove.time ? ` в ${pendingMove.time}` : ""}?</span>
          <button type="button" className="button button-primary" disabled={moving} onClick={confirmMove}>{moving ? "Переносим…" : "Перенести"}</button>
          <button type="button" className="button button-quiet" disabled={moving} onClick={() => setPendingMove(null)}><X size={13} /> Отмена</button>
        </p>
      )}
      {message.text && <p className={message.type === "error" ? "sync-alert" : "sync-notice"} role={message.type === "error" ? "alert" : "status"}>{message.text}<button type="button" onClick={() => setMessage({ type: "", text: "" })} aria-label="Закрыть сообщение"><X size={12} /></button></p>}

      {mode === "month" && (
        <div className="cal-month" role="grid" aria-label="Календарь месяца">
          <div className="cal-weekdays">{WEEKDAYS.map((day) => <span key={day}>{day}</span>)}</div>
          {weeks.map((week) => <div className="cal-week" key={week[0]}>{week.map((date) => renderDayCell(date, true))}</div>)}
        </div>
      )}
      {mode === "week" && (
        <div className="cal-weekview">
          {weekDays.map((date) => (
            <div className="cal-weekcol" key={date}>
              <span className="cal-weekday-head">{WEEKDAYS[(new Date(`${date}T12:00:00`).getDay() + 6) % 7]}</span>
              renderDayCell(date, false)
            </div>
          ))}
        </div>
      )}
      {mode === "day" && renderDaySchedule()}
      <p className="cal-hint"><Clock3 size={12} /> Длительность задач не хранится: задача показывается в часовом слоте начала. Задачи на одно время отмечены значком конфликта. Перетащить можно обычную задачу — перенос выполняется после подтверждения.</p>
    </div>
  );
}

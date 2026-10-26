import { useMemo, useState } from "react";
import { BarChart3, CheckCheck, Clock3, Repeat, Target } from "lucide-react";
import { getAnalyticsComparison } from "./analytics.js";

function formatRange(range, period) {
  const formatter = new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "short",
    ...(period === "month" ? { year: "numeric" } : {}),
  });
  return `${formatter.format(new Date(`${range.start}T12:00:00`))} — ${formatter.format(new Date(`${range.end}T12:00:00`))}`;
}

function deltaText(value, unit = "") {
  if (value === 0) return `без изменений${unit}`;
  return `${value > 0 ? "+" : "−"}${Math.abs(value)}${unit}`;
}

export default function AnalyticsOverview({ tasks, goals, selectedDate, today }) {
  const [period, setPeriod] = useState("week");
  const comparison = useMemo(
    () => getAnalyticsComparison(tasks, goals, selectedDate, period, today),
    [goals, period, selectedDate, tasks, today],
  );
  const { current, previous } = comparison;
  const maxPlanned = Math.max(1, ...current.days.map((day) => day.planned));
  const enoughData = current.planned > 0;

  return (
    <section className="panel analytics-panel" aria-labelledby="analytics-title">
      <div className="section-heading analytics-heading">
        <div><span className="section-kicker">На основе личных задач</span><h2 id="analytics-title">Прогресс</h2></div>
        <div className="view-switch" role="tablist" aria-label="Период аналитики">
          <button type="button" role="tab" aria-selected={period === "week"} className={period === "week" ? "view-tab active" : "view-tab"} onClick={() => setPeriod("week")}>Неделя</button>
          <button type="button" role="tab" aria-selected={period === "month"} className={period === "month" ? "view-tab active" : "view-tab"} onClick={() => setPeriod("month")}>Месяц</button>
        </div>
      </div>

      <div className="analytics-period">{period === "week" ? "Неделя" : "Месяц"} · {formatRange(current.range, period)}</div>
      <div className="analytics-metrics">
        <article className="analytics-metric"><span className="analytics-metric-icon"><BarChart3 size={16} /></span><div><small>Запланировано</small><strong>{current.planned}</strong></div></article>
        <article className="analytics-metric"><span className="analytics-metric-icon analytics-green"><CheckCheck size={16} /></span><div><small>Выполнено</small><strong>{current.completed} <em>/ {current.planned}</em></strong></div></article>
        <article className="analytics-metric"><span className="analytics-metric-icon analytics-amber"><Clock3 size={16} /></span><div><small>Просрочено</small><strong>{current.overdue}</strong></div></article>
        <article className="analytics-metric"><span className="analytics-metric-icon analytics-purple"><Repeat size={16} /></span><div><small>Переносы</small><strong>{current.moved}</strong></div></article>
      </div>

      <div className="analytics-progress">
        <div className="analytics-progress-copy"><span>Выполнение за период</span><strong>{enoughData ? `${current.percent}%` : "—"}</strong></div>
        <div className="analytics-progress-track" role="progressbar" aria-label="Выполнение задач" aria-valuemin="0" aria-valuemax="100" aria-valuenow={current.percent}>
          <span style={{ width: `${current.percent}%` }} />
        </div>
      </div>

      <div className={`analytics-chart analytics-chart-${period}`} role="img" aria-label={`${period === "week" ? "Задачи по дням недели" : "Задачи по дням месяца"}`}>
        {current.days.map((day) => {
          const date = new Date(`${day.date}T12:00:00`);
          const label = period === "week"
            ? new Intl.DateTimeFormat("ru-RU", { weekday: "short" }).format(date)
            : String(Number(day.date.slice(8)));
          const height = day.planned ? Math.max(8, Math.round(day.planned / maxPlanned * 100)) : 0;
          const completedHeight = day.planned ? Math.round(day.completed / day.planned * height) : 0;
          return (
            <div className="analytics-day" key={day.date} title={`${day.date}: ${day.completed} из ${day.planned} выполнено`}>
              <span className="analytics-day-count">{day.planned || ""}</span>
              <div className="analytics-bar-track"><span className="analytics-bar" style={{ height: `${height}%` }}><span className="analytics-bar-done" style={{ height: `${day.planned ? completedHeight / height * 100 : 0}%` }} /></span></div>
              <span className="analytics-day-label">{label}</span>
            </div>
          );
        })}
      </div>
      <div className="analytics-legend"><span><i className="analytics-legend-planned" /> Запланировано</span><span><i className="analytics-legend-done" /> Выполнено</span></div>

      <div className="analytics-bottom">
        <div className="analytics-goals">
          <span className="analytics-metric-icon analytics-purple"><Target size={16} /></span>
          <span><small>Цели периода</small><strong>{current.goals.count}</strong></span>
          <span className="analytics-goal-progress">{current.goals.planned
            ? `${current.goals.completed}/${current.goals.planned} связанных задач · ${current.goals.percent}%`
            : "Нет связанных задач в периоде"}</span>
        </div>
        <div className="analytics-comparison">
          {comparison.available ? (
            <>
              <strong>К предыдущему {period === "week" ? "периоду" : "месяцу"}</strong>
              <span>Задачи {deltaText(comparison.plannedDelta)} · выполнено {deltaText(comparison.completedDelta)} · процент {deltaText(comparison.percentDelta, " п.п.")}</span>
              <small>Ранее: {previous.completed}/{previous.planned} ({previous.percent}%)</small>
            </>
          ) : <span>Для сравнения нужны задачи за {period === "week" ? "предыдущую неделю" : "предыдущий месяц"}.</span>}
        </div>
      </div>
      <p className="analytics-note">
        {enoughData
          ? "Процент рассчитан как выполненные задачи ÷ все задачи с датой в этом периоде. Повторы считаются по экземплярам; перенесённая задача считается по последней сохранённой дате переноса."
          : "Пока нет задач в этом периоде. Статистика формируется по сохранённым задачам и их экземплярам повторов."}
      </p>
    </section>
  );
}

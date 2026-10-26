import { useMemo, useRef, useState } from "react";
import { Download, FileJson, FileSpreadsheet, Upload } from "lucide-react";
import {
  MAX_BACKUP_BYTES, backupFileName, backupToJson, buildBackup, parseBackup, planImport, tasksToCsv,
} from "./backup.js";

const MODE_OPTIONS = [
  { id: "merge", title: "Добавить и обновить", hint: "Новые записи добавятся, записи с тем же id обновятся. Остальные данные не тронем." },
  { id: "copy", title: "Добавить как копии", hint: "Всё из файла добавится с новыми id, ваши текущие записи останутся как есть." },
  { id: "replace", title: "Восстановить полностью", hint: "Текущие цели и задачи будут заменены содержимым копии. Перед этим скачается страховочная копия." },
];

function download(content, fileName, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function SummaryLine({ label, stats, showRemoved }) {
  return (
    <li><strong>{label}:</strong> добавится {stats.added}, обновится {stats.updated}, без изменений {stats.unchanged}{showRemoved ? `, будет удалено ${stats.removed}` : ""}</li>
  );
}

export default function BackupDialog({ Modal, dashboard, theme, onThemeChange, onApply, onClose }) {
  const inputRef = useRef(null);
  const [parsing, setParsing] = useState(false);
  const [file, setFile] = useState(null);
  const [fileError, setFileError] = useState("");
  const [mode, setMode] = useState("merge");
  const [useTheme, setUseTheme] = useState(false);
  const [done, setDone] = useState("");

  const plan = useMemo(() => (file?.parsed ? planImport(dashboard, file.parsed.backup, mode) : null), [dashboard, file, mode]);
  const themeDiffers = Boolean(file?.parsed?.backup.theme && file.parsed.backup.theme !== theme);

  function exportJson() {
    download(backupToJson(buildBackup(dashboard, { theme })), backupFileName("json"), "application/json");
  }

  function exportCsv() {
    download(tasksToCsv(dashboard.tasks, dashboard.goals), backupFileName("csv"), "text/csv;charset=utf-8");
  }

  async function chooseFile(event) {
    const selected = event.target.files?.[0];
    event.target.value = "";
    setDone("");
    setFile(null);
    setFileError("");
    if (!selected) return;
    if (selected.size > MAX_BACKUP_BYTES) { setFileError("Файл слишком большой (максимум 25 МБ)."); return; }
    setParsing(true);
    try {
      const parsed = await parseBackup(await selected.text());
      if (!parsed.ok) setFileError(parsed.errors.join(" "));
      else setFile({ name: selected.name, parsed });
    } catch {
      setFileError("Не удалось прочитать файл.");
    } finally {
      setParsing(false);
    }
  }

  function apply() {
    if (!plan?.hasChanges) return;
    if (mode === "replace") {
      const { goals: removedGoals, tasks: removedTasks } = plan.summary;
      const ok = window.confirm(`Заменить текущие данные содержимым копии? Будет удалено целей: ${removedGoals.removed}, задач: ${removedTasks.removed}. Страховочная копия текущих данных скачается автоматически.`);
      if (!ok) return;
      download(backupToJson(buildBackup(dashboard, { theme })), `dayflow-before-restore-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`, "application/json");
    }
    onApply(plan.dashboard);
    if (useTheme && themeDiffers) onThemeChange(file.parsed.backup.theme);
    setDone(`Импорт выполнен: цели +${plan.summary.goals.added}/~${plan.summary.goals.updated}, задачи +${plan.summary.tasks.added}/~${plan.summary.tasks.updated}.`);
    setFile(null);
  }

  const parsed = file?.parsed;
  const errors = parsed?.errors ?? [];

  return (
    <Modal title="Экспорт и резервная копия" subtitle="Данные только вашего аккаунта. В файл не попадают пароли, токены и ключи." onClose={onClose}>
      <div className="backup-dialog">
        <section className="backup-section">
          <h3>Экспорт</h3>
          <p className="workspace-hint">JSON — полная копия ({dashboard.goals.length} целей, {dashboard.tasks.length} задач, включая архив, связи и тему). CSV — таблица задач для Excel и Google Таблиц.</p>
          <div className="backup-actions">
            <button type="button" className="button button-primary" onClick={exportJson}><FileJson size={16} /> Резервная копия (JSON)</button>
            <button type="button" className="button button-secondary" onClick={exportCsv}><FileSpreadsheet size={16} /> Задачи (CSV)</button>
          </div>
        </section>

        <section className="backup-section">
          <h3>Импорт</h3>
          <input ref={inputRef} type="file" accept=".json,application/json" className="sr-only" onChange={chooseFile} aria-label="Файл резервной копии" />
          <button type="button" className="button button-secondary" onClick={() => inputRef.current?.click()} disabled={parsing}><Upload size={16} /> {parsing ? "Проверяем файл…" : "Выбрать файл копии"}</button>
          {fileError && <p className="form-error" role="alert">{fileError}</p>}
          {done && <p className="workspace-hint backup-done" role="status">{done}</p>}

          {parsed && plan && (
            <div className="backup-preview">
              <p><strong>{file.name}</strong>{parsed.backup.exportedAt ? ` · создан ${new Date(parsed.backup.exportedAt).toLocaleString("ru-RU")}` : ""}</p>
              <div className="backup-modes" role="radiogroup" aria-label="Режим импорта">
                {MODE_OPTIONS.map((option) => (
                  <label key={option.id} className={mode === option.id ? "backup-mode active" : "backup-mode"}>
                    <input type="radio" name="backup-mode" value={option.id} checked={mode === option.id} onChange={() => setMode(option.id)} />
                    <span><strong>{option.title}</strong><small>{option.hint}</small></span>
                  </label>
                ))}
              </div>
              <ul className="backup-summary">
                <SummaryLine label="Цели" stats={plan.summary.goals} showRemoved={mode === "replace"} />
                <SummaryLine label="Задачи" stats={plan.summary.tasks} showRemoved={mode === "replace"} />
              </ul>
              {plan.summary.warnings.map((warning) => <p className="workspace-hint backup-warning" key={warning}>⚠ {warning}</p>)}
              {errors.length > 0 && (
                <details className="backup-errors" open>
                  <summary>Пропущено записей с ошибками: {errors.length}</summary>
                  <ul>{errors.slice(0, 10).map((message) => <li key={message}>{message}</li>)}</ul>
                  {errors.length > 10 && <small>…и ещё {errors.length - 10}</small>}
                </details>
              )}
              {themeDiffers && <label className="backup-theme"><input type="checkbox" checked={useTheme} onChange={(event) => setUseTheme(event.target.checked)} /> Применить тему из копии ({parsed.backup.theme === "dark" ? "тёмная" : "светлая"})</label>}
              <div className="dialog-actions">
                <button type="button" className="button button-secondary" onClick={() => setFile(null)}>Отмена</button>
                <button type="button" className="button button-primary" onClick={apply} disabled={!plan.hasChanges}><Download size={16} /> {plan.hasChanges ? "Применить импорт" : "Нечего импортировать"}</button>
              </div>
            </div>
          )}
        </section>
      </div>
    </Modal>
  );
}

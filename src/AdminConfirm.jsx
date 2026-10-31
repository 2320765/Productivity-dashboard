import { useEffect, useRef, useState } from "react";
import { adminError } from "./adminError.js";

export default function AdminConfirm({ action, onClose }) {
  const dialog = useRef(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const previous = document.activeElement;
    dialog.current.showModal();
    return () => previous?.isConnected && previous.focus();
  }, []);
  async function submit(event) {
    event.preventDefault();
    if (busy || reason.trim().length < 3) return;
    setBusy(true);
    setError("");
    try { await action.run(reason.trim()); onClose(); }
    catch (error) { setError(adminError(error)); setBusy(false); }
  }
  return <dialog ref={dialog} className="admin-confirm" aria-labelledby="admin-confirm-title" onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
    <form onSubmit={submit} aria-busy={busy}>
      <span className="admin-badge">Подтверждение действия</span>
      <h2 id="admin-confirm-title">{action.title}</h2>
      <p>{action.description}</p>
      <dl>{action.changes.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      <label htmlFor="admin-action-reason">Причина для защищённого журнала</label>
      <textarea id="admin-action-reason" autoFocus required minLength={3} maxLength={200} value={reason} onChange={(event) => setReason(event.target.value)} disabled={busy} />
      <small>3–200 символов. Укажите основание без паролей, токенов и личных данных.</small>
      {error && <p role="alert" className="sync-alert">{error}</p>}
      <div className="admin-confirm-actions">
        <button type="button" className="button button-secondary" disabled={busy} onClick={onClose}>Отмена</button>
        <button type="submit" className="button button-primary" disabled={busy || reason.trim().length < 3}>{busy ? "Сохраняем…" : "Подтвердить изменение"}</button>
      </div>
    </form>
  </dialog>;
}

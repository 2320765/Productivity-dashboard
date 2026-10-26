import { useEffect, useMemo, useRef, useState } from "react";
import { Bell, BellOff, Clock3 } from "lucide-react";
import { localDateString } from "./dashboard.js";
import { canSendBrowserNotifications, formatReminderTime, getNotificationPermission, getReminderOccurrences } from "./reminders.js";
import { getErrorMessage } from "./errorMessage.js";

function preferenceKey(userId) {
  return `dayflow-reminders-enabled:${userId}`;
}

function notifiedKey(userId) {
  return `dayflow-notified-reminders:${userId}`;
}

function readPreference(userId) {
  if (!userId) return { enabled: false, error: "" };
  try {
    return { enabled: localStorage.getItem(preferenceKey(userId)) === "true", error: "" };
  } catch (storageError) {
    console.error("Не удалось прочитать настройку напоминаний:", storageError);
    return { enabled: false, error: `Не удалось прочитать настройку напоминаний: ${getErrorMessage(storageError)}` };
  }
}

function readNotified(userId, now) {
  const stored = localStorage.getItem(notifiedKey(userId));
  const parsed = stored ? JSON.parse(stored) : [];
  if (!Array.isArray(parsed)) return [];
  const cutoff = now - 30 * 24 * 60 * 60 * 1000;
  return parsed.filter((entry) => entry && typeof entry.key === "string" && Number(entry.at) >= cutoff);
}

export default function ReminderCenter({ tasks, userId }) {
  const [preference, setPreference] = useState(() => readPreference(userId));
  const enabled = preference.enabled;
  const [message, setMessage] = useState("");
  const [error, setError] = useState(preference.error);
  const [permission, setPermission] = useState(() => (
    typeof window !== "undefined" ? getNotificationPermission(window.Notification) : "unsupported"
  ));
  const [now, setNow] = useState(() => new Date());
  const sessionNotified = useRef(new Set());
  const today = localDateString();
  const upcoming = useMemo(
    () => getReminderOccurrences(tasks, today, 7).filter(({ target }) => target >= now).slice(0, 5),
    [now, tasks, today],
  );

  useEffect(() => {
    const interval = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    sessionNotified.current.clear();
  }, [userId]);

  useEffect(() => {
    if (!userId || !canSendBrowserNotifications(enabled, permission)) return undefined;
    let active = true;

    function checkReminders() {
      if (!active) return;
      const now = new Date();
      let notified;
      try {
        notified = readNotified(userId, now.getTime());
      } catch (storageError) {
        console.error("Не удалось прочитать историю уведомлений:", storageError);
        setError(`Не удалось проверить уже отправленные напоминания: ${getErrorMessage(storageError)}`);
        return;
      }
      const keys = new Set(notified.map((entry) => entry.key));
      const due = getReminderOccurrences(tasks, localDateString(now), 2)
        .filter(({ target, key }) => {
          const difference = target.getTime() - now.getTime();
          return difference <= 0 && difference >= -60_000 && !keys.has(key) && !sessionNotified.current.has(key);
        });
      if (!due.length) return;

      const additions = [];
      for (const { task, target, key } of due) {
        sessionNotified.current.add(key);
        try {
          const notification = new window.Notification("Напоминание о задаче", {
            body: `${task.title} · ${formatReminderTime(target)}`,
            tag: key,
          });
          notification.onclick = () => {
            window.focus();
            notification.close();
          };
          additions.push({ key, at: now.getTime() });
        } catch (notificationError) {
          console.error("Не удалось показать напоминание браузера:", notificationError);
          setError(`Не удалось показать напоминание: ${getErrorMessage(notificationError)}. Ближайшие напоминания остаются в списке ниже.`);
          additions.push({ key, at: now.getTime() });
        }
      }
      if (additions.length) {
        try {
          localStorage.setItem(notifiedKey(userId), JSON.stringify([...notified, ...additions]));
        } catch (storageError) {
          console.error("Не удалось сохранить историю уведомлений:", storageError);
          setError(`Уведомления показаны, но не удалось сохранить их историю: ${getErrorMessage(storageError)}`);
        }
      }
    }

    checkReminders();
    const interval = window.setInterval(checkReminders, 20_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [enabled, permission, tasks, userId]);

  async function toggle() {
    setError("");
    setMessage("");
    if (enabled) {
      try {
        localStorage.setItem(preferenceKey(userId), "false");
        setPreference({ enabled: false, error: "" });
        setMessage("Уведомления отключены. Список ближайших напоминаний останется доступен.");
      } catch (storageError) {
        console.error("Не удалось отключить напоминания:", storageError);
        setError(`Не удалось сохранить настройку: ${getErrorMessage(storageError)}`);
      }
      return;
    }

    let nextPermission = permission;
    if (!("Notification" in window)) {
      nextPermission = "unsupported";
      setMessage("Этот браузер не поддерживает уведомления. Ближайшие напоминания будут показаны в списке, пока сайт открыт.");
    } else if (window.Notification.permission === "default") {
      // Запрос permission намеренно вызывается только из явного клика пользователя.
      try {
        nextPermission = await window.Notification.requestPermission();
        setMessage(nextPermission === "granted"
          ? "Разрешение получено. Уведомления будут приходить, пока сайт открыт."
          : "Разрешение не выдано. Ближайшие напоминания будут показаны в списке, пока сайт открыт.");
      } catch (permissionError) {
        nextPermission = window.Notification.permission;
        setError(`Не удалось запросить разрешение браузера: ${getErrorMessage(permissionError)}`);
      }
    } else if (window.Notification.permission === "denied") {
      nextPermission = "denied";
      setMessage("Браузер запретил уведомления. Разрешите их в настройках сайта браузера; список напоминаний останется доступен.");
    } else {
      setMessage("Уведомления включены для этой вкладки. Фоновая доставка после закрытия сайта не выполняется.");
    }

    try {
      localStorage.setItem(preferenceKey(userId), "true");
      setPermission(nextPermission);
      setPreference({ enabled: true, error: "" });
    } catch (storageError) {
      console.error("Не удалось включить напоминания:", storageError);
      setError(`Не удалось сохранить настройку: ${getErrorMessage(storageError)}`);
    }
  }

  return (
    <section className="panel reminder-panel" aria-labelledby="reminder-heading">
      <div className="section-heading reminder-heading">
        <div><span className="section-kicker">Пока сайт открыт</span><h2 id="reminder-heading">Напоминания</h2></div>
        <button type="button" className={enabled ? "button button-secondary" : "button button-primary"} onClick={toggle} disabled={!userId}>
          {enabled ? <BellOff size={15} /> : <Bell size={15} />}
          {enabled ? "Отключить уведомления" : "Включить уведомления"}
        </button>
      </div>
      <p className="workspace-hint reminder-explainer">
        Разрешение браузера будет запрошено только при включении. Напоминания работают в открытой вкладке; после закрытия сайта фоновой доставки нет.
        {permission === "unsupported" && " Этот браузер не поддерживает уведомления."}
        {permission === "denied" && " Сейчас браузер запретил показ уведомлений."}
      </p>
      {message && <p className="sync-notice" role="status">{message}</p>}
      {error && <p className="sync-alert" role="alert">{error}</p>}
      <div className="reminder-list">
        <strong>Ближайшие задачи</strong>
        {!upcoming.length ? <span className="workspace-hint">Нет задач с настроенным временем напоминания на ближайшие 7 дней.</span> : (
          <ul>
            {upcoming.map(({ task, target, key }) => (
              <li key={key}>
                <Clock3 size={14} />
                <span><b>{task.title}</b><small>{formatReminderTime(target)}</small></span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

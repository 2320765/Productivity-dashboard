import {
  LEGACY_STORAGE_KEY,
  loadDashboard,
  STORAGE_KEY,
} from "./dashboard.js";

function dashboardFromValue(value, legacyValue) {
  return loadDashboard({
    getItem(key) {
      if (key === STORAGE_KEY) return value;
      if (key === LEGACY_STORAGE_KEY) return legacyValue;
      return null;
    },
  });
}

export function readUserDashboard(userId, storage = globalThis.localStorage) {
  if (!userId) throw new Error("Для чтения личных данных требуется пользователь.");
  const localKey = `${STORAGE_KEY}:${userId}`;
  const ownerKey = `${STORAGE_KEY}:legacy-owner`;
  const scopedValue = storage.getItem(localKey);
  const legacyOwner = storage.getItem(ownerKey);

  if (scopedValue !== null) {
    if (!legacyOwner) {
      storage.setItem(ownerKey, userId);
    }
    const dashboard = dashboardFromValue(scopedValue, null);
    return {
      dashboard,
      exists: true,
      isScoped: true,
      pending: storage.getItem(`${localKey}:pending`) === "true",
      revision: Number(storage.getItem(`${localKey}:revision`) ?? 0),
    };
  }

  if (legacyOwner && legacyOwner !== userId) {
    return {
      dashboard: { goals: [], tasks: [] },
      exists: false,
      isScoped: true,
      pending: false,
      revision: 0,
    };
  }

  const legacyValue = storage.getItem(LEGACY_STORAGE_KEY);
  const unscopedValue = storage.getItem(STORAGE_KEY);
  if (unscopedValue === null && legacyValue === null) {
    return {
      dashboard: { goals: [], tasks: [] },
      exists: false,
      isScoped: true,
      pending: false,
      revision: 0,
    };
  }

  const dashboard = dashboardFromValue(unscopedValue, legacyValue);
  storage.setItem(ownerKey, userId);
  storage.setItem(localKey, JSON.stringify(dashboard));
  storage.setItem(`${localKey}:revision`, "0");
  const hasData = dashboard.goals.length > 0 || dashboard.tasks.length > 0;
  if (hasData) storage.setItem(`${localKey}:pending`, "true");
  storage.removeItem(STORAGE_KEY);
  storage.removeItem(LEGACY_STORAGE_KEY);

  return {
    dashboard,
    exists: true,
    isScoped: true,
    pending: hasData,
    revision: 0,
  };
}

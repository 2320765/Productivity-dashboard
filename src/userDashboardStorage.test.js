import assert from "node:assert/strict";
import test from "node:test";
import { LEGACY_STORAGE_KEY, STORAGE_KEY } from "./dashboard.js";
import { readUserDashboard } from "./userDashboardStorage.js";

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

test("unscoped saved data is claimed once, moved to the first account, and removed from shared keys", () => {
  const legacyDashboard = {
    goals: [{ id: "goal-a", title: "Private goal" }],
    tasks: [{ id: "task-a", title: "Private task" }],
  };
  const storage = createStorage({ [STORAGE_KEY]: JSON.stringify(legacyDashboard) });

  const firstAccount = readUserDashboard("user-a", storage);
  const secondAccount = readUserDashboard("user-b", storage);

  assert.deepEqual(firstAccount.dashboard, legacyDashboard);
  assert.equal(firstAccount.pending, true);
  assert.equal(storage.getItem(`${STORAGE_KEY}:user-a`), JSON.stringify(legacyDashboard));
  assert.equal(storage.getItem(`${STORAGE_KEY}:legacy-owner`), "user-a");
  assert.equal(storage.getItem(STORAGE_KEY), null);
  assert.deepEqual(secondAccount.dashboard, { goals: [], tasks: [] });
  assert.equal(secondAccount.exists, false);
});

test("legacy dashboard format is migrated only to the account that claims it", () => {
  const storage = createStorage({
    [LEGACY_STORAGE_KEY]: JSON.stringify({
      tasks: [{ id: 1, title: "Private legacy task", done: false }],
    }),
  });

  const owner = readUserDashboard("user-a", storage);
  const other = readUserDashboard("user-b", storage);

  assert.equal(owner.dashboard.tasks[0].title, "Private legacy task");
  assert.equal(owner.pending, true);
  assert.deepEqual(other.dashboard, { goals: [], tasks: [] });
  assert.equal(storage.getItem(LEGACY_STORAGE_KEY), null);
});

test("existing user-scoped dashboard is preferred and never falls back to another user's data", () => {
  const scoped = {
    goals: [{ id: "goal-b", title: "Account B goal" }],
    tasks: [],
  };
  const global = {
    goals: [{ id: "goal-a", title: "Account A goal" }],
    tasks: [],
  };
  const storage = createStorage({
    [`${STORAGE_KEY}:user-b`]: JSON.stringify(scoped),
    [STORAGE_KEY]: JSON.stringify(global),
  });

  const account = readUserDashboard("user-b", storage);

  assert.deepEqual(account.dashboard, scoped);
  assert.equal(storage.getItem(`${STORAGE_KEY}:legacy-owner`), "user-b");
  assert.equal(storage.getItem(STORAGE_KEY), JSON.stringify(global));
  assert.deepEqual(readUserDashboard("user-a", storage).dashboard, { goals: [], tasks: [] });
});

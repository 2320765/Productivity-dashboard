import assert from "node:assert/strict";
import test from "node:test";
import { getErrorMessage } from "./errorMessage.js";

test("formats Error and string values", () => {
  assert.equal(getErrorMessage(new Error("Network unavailable")), "Network unavailable");
  assert.equal(getErrorMessage("Request failed"), "Request failed");
});

test("formats plain Supabase error objects instead of [object Object]", () => {
  assert.equal(getErrorMessage({
    message: "Could not find the table",
    details: "The schema cache is stale",
    hint: "Run the migration",
    code: "PGRST205",
  }), "Could not find the table · The schema cache is stale · Run the migration · PGRST205");
});

test("formats nested and array errors, and has a readable unknown fallback", () => {
  assert.equal(getErrorMessage({ error: { message: "Permission denied" } }), "Permission denied");
  assert.equal(getErrorMessage([{ message: "First failure" }, "Second failure"]), "First failure; Second failure");
  assert.equal(getErrorMessage({}), "Произошла неизвестная ошибка. Попробуйте обновить данные.");
});

import assert from "node:assert/strict";
import test from "node:test";
import { formatUsername, isEmailQuery, normalizeUsername, validateUsername } from "./username.js";

test("normalizes case, spaces and leading @", () => {
  assert.equal(normalizeUsername("  @Anna_Lee "), "anna_lee");
});

test("accepts valid usernames", () => {
  for (const name of ["abc", "anna_lee", "user123", "a".repeat(20), "@Dev_1"]) assert.equal(validateUsername(name), "");
});

test("rejects invalid usernames", () => {
  for (const name of ["", "ab", "a".repeat(21), "1abc", "_abc", "ann a", "анна", "a-b-c", "a.b.c", "x@y"]) {
    assert.notEqual(validateUsername(name), "", name);
  }
  for (const name of ["admin", "root", "support", "dayflow"]) assert.match(validateUsername(name), /зарезервировано/);
});

test("distinguishes email from username and formats display", () => {
  assert.equal(isEmailQuery("name@example.com"), true);
  assert.equal(isEmailQuery("@anna_lee"), false);
  assert.equal(isEmailQuery("anna_lee"), false);
  assert.equal(formatUsername("anna"), "@anna");
  assert.equal(formatUsername(""), "");
});

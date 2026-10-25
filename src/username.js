const USERNAME_PATTERN = /^[a-z][a-z0-9_]{2,19}$/;

export function normalizeUsername(value) {
  return String(value ?? "").trim().replace(/^@/, "").toLowerCase();
}

export function validateUsername(value) {
  const username = normalizeUsername(value);
  if (!username) return "Введите username.";
  if (username.length < 3 || username.length > 20) return "Username должен быть от 3 до 20 символов.";
  if (!/^[a-z]/.test(username)) return "Username должен начинаться с латинской буквы.";
  if (!USERNAME_PATTERN.test(username)) return "Допустимы только латинские буквы, цифры и знак подчёркивания.";
  return "";
}

export function isEmailQuery(value) {
  return /.@./.test(String(value ?? "").trim());
}

export function formatUsername(username) {
  return username ? `@${username}` : "";
}

const GENERIC_NAMES = new Set(["Пользователь", "Участник"]);

export function primaryName(name, username) {
  return username && (!name || GENERIC_NAMES.has(name)) ? `@${username}` : name;
}

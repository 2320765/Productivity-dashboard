const ERROR_FIELDS = ["message", "details", "hint", "code"];

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function getErrorMessage(error) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error.trim()) return error;

  if (isRecord(error)) {
    const parts = ERROR_FIELDS
      .map((field) => error[field])
      .filter((value) => typeof value === "string" && value.trim())
      .filter((value, index, values) => values.indexOf(value) === index);
    if (parts.length) return parts.join(" · ");

    if (isRecord(error.error)) return getErrorMessage(error.error);
    if (typeof error.statusText === "string" && error.statusText.trim()) return error.statusText;
  }

  if (Array.isArray(error)) {
    const messages = error.map(getErrorMessage).filter(Boolean);
    if (messages.length) return messages.join("; ");
  }

  return "Произошла неизвестная ошибка. Попробуйте обновить данные.";
}

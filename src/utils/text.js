function trimTrailingSlash(value) {
  return String(value ?? "").replace(/\/+$/, "");
}

function truncateText(value, maxLength = 240) {
  return String(value ?? "").slice(0, maxLength);
}

function jiraFieldToPlainText(value) {
  if (!value) return "";

  if (typeof value === "string") return value;

  if (Array.isArray(value)) {
    return value.map(jiraFieldToPlainText).filter(Boolean).join("\n");
  }

  if (typeof value === "object") {
    if (typeof value.text === "string") return value.text;
    if (typeof value.value === "string") return value.value;
    if (typeof value.name === "string") return value.name;

    if (Array.isArray(value.content)) {
      return value.content.map(jiraFieldToPlainText).filter(Boolean).join("\n");
    }
  }

  return "";
}

module.exports = {
  trimTrailingSlash,
  truncateText,
  jiraFieldToPlainText,
};

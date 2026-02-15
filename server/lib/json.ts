export function extractJsonBlock(text: string): string {
  if (!text) return "{}";

  // Remove common markdown fences.
  let clean = text
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();

  const start = clean.indexOf("{");
  const end = clean.lastIndexOf("}");
  if (start === -1 || end === -1 || start >= end) return clean;

  return clean.slice(start, end + 1);
}

export function tryRepairAndParseJson(jsonStr: string): unknown {
  try {
    return JSON.parse(jsonStr);
  } catch {
    // Best-effort repairs for common LLM issues.
    let fixed = jsonStr;

    // Remove trailing commas.
    fixed = fixed.replace(/,(\s*[}\]])/g, "$1");

    // Quote unquoted keys: { key: "v" } -> { "key": "v" }
    fixed = fixed.replace(/([{,]\s*)([a-zA-Z0-9_]+?)\s*:/g, '$1"$2":');

    // Remove control chars (preserve newline/tab).
    fixed = fixed.replace(/[\x00-\x1F\x7F]/g, (m) => {
      if (m === "\n" || m === "\r" || m === "\t") return m;
      return "";
    });

    return JSON.parse(fixed);
  }
}


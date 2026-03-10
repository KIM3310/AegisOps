export interface ReviewUrlState {
  grounding?: boolean;
  history?: boolean;
  incident?: string;
  preset?: string;
  tm?: boolean;
}

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);
const FALSE_VALUES = new Set(["0", "false", "no", "off"]);

function normalizeSearch(search: string) {
  return search.startsWith("?") ? search.slice(1) : search;
}

function parseBooleanFlag(value: string | null) {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (TRUE_VALUES.has(normalized)) return true;
  if (FALSE_VALUES.has(normalized)) return false;
  return undefined;
}

function sanitizeId(value: string | null) {
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function slugifyPresetName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function parseReviewUrlState(search: string): ReviewUrlState {
  const params = new URLSearchParams(normalizeSearch(search));
  const next: ReviewUrlState = {};
  const preset = sanitizeId(params.get("preset"));
  const incident = sanitizeId(params.get("incident"));
  const grounding = parseBooleanFlag(params.get("grounding"));
  const tm = parseBooleanFlag(params.get("tm"));
  const history = parseBooleanFlag(params.get("history"));

  if (preset) next.preset = preset;
  if (incident) next.incident = incident;
  if (typeof grounding === "boolean") next.grounding = grounding;
  if (typeof tm === "boolean") next.tm = tm;
  if (typeof history === "boolean") next.history = history;

  return next;
}

export function buildReviewUrlSearch(state: Required<ReviewUrlState>) {
  const params = new URLSearchParams();
  if (state.preset) params.set("preset", state.preset);
  if (state.incident) params.set("incident", state.incident);
  params.set("grounding", state.grounding ? "1" : "0");
  params.set("tm", state.tm ? "1" : "0");
  params.set("history", state.history ? "1" : "0");
  return params.toString();
}

export function replaceReviewUrlSearch(nextSearch: string) {
  if (typeof window === "undefined") return;
  const search = nextSearch ? `?${nextSearch}` : "";
  const nextUrl = `${window.location.pathname}${search}${window.location.hash}`;
  window.history.replaceState(window.history.state, "", nextUrl);
}

export function buildReviewShareUrl(
  nextSearch: string,
  options?: {
    origin?: string;
    pathname?: string;
    hash?: string;
  }
) {
  const origin =
    options?.origin ??
    (typeof window !== "undefined" ? window.location.origin : "");
  const pathname =
    options?.pathname ??
    (typeof window !== "undefined" ? window.location.pathname : "/");
  const hash =
    options?.hash ??
    (typeof window !== "undefined" ? window.location.hash : "");
  const search = nextSearch ? `?${nextSearch}` : "";
  return `${origin}${pathname}${search}${hash}`;
}

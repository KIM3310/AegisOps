import type express from "express";

const PROTECTED_PREFIXES = ["/api/analyze", "/api/followup", "/api/tts"];
const ROLE_HEADERS = ["x-operator-role", "x-operator-roles"] as const;

export function readBearerToken(value: string | undefined): string {
  const auth = String(value || "").trim();
  if (!auth.toLowerCase().startsWith("bearer ")) return "";
  return auth.slice("bearer ".length).trim();
}

export function getOperatorToken(): string {
  return String(process.env.AEGISOPS_OPERATOR_TOKEN || "").trim();
}

export function getOperatorAllowedRoles(): string[] {
  return String(process.env.AEGISOPS_OPERATOR_ALLOWED_ROLES || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

export function isOperatorAuthEnabled(): boolean {
  return getOperatorToken().length > 0;
}

export function getOperatorRoleHeaders(): readonly string[] {
  return ROLE_HEADERS;
}

export function requiresOperatorToken(req: express.Request): boolean {
  const method = String(req.method || "GET").toUpperCase();
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(method)) return false;
  const path = String(req.path || req.originalUrl || "");
  return PROTECTED_PREFIXES.some((prefix) => path.startsWith(prefix));
}

export function hasValidOperatorToken(req: express.Request): boolean {
  const expected = getOperatorToken();
  if (!expected) return true;
  const headerToken = String(req.headers["x-operator-token"] || "").trim();
  const bearerToken = readBearerToken(String(req.headers.authorization || ""));
  return headerToken === expected || bearerToken === expected;
}

function readPresentedOperatorRoles(req: express.Request): string[] {
  const values = ROLE_HEADERS.flatMap((header) => {
    const raw = req.headers[header];
    if (Array.isArray(raw)) {
      return raw;
    }
    return typeof raw === "string" ? [raw] : [];
  });

  return values
    .flatMap((value) => value.split(","))
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

export function hasRequiredOperatorRole(req: express.Request): boolean {
  const allowedRoles = getOperatorAllowedRoles();
  if (allowedRoles.length === 0) {
    return true;
  }
  const presentedRoles = readPresentedOperatorRoles(req);
  return presentedRoles.some((role) => allowedRoles.includes(role));
}

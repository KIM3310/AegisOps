import type express from "express";

const PROTECTED_PREFIXES = ["/api/analyze", "/api/followup", "/api/tts"];

export function readBearerToken(value: string | undefined): string {
  const auth = String(value || "").trim();
  if (!auth.toLowerCase().startsWith("bearer ")) return "";
  return auth.slice("bearer ".length).trim();
}

export function getOperatorToken(): string {
  return String(process.env.AEGISOPS_OPERATOR_TOKEN || "").trim();
}

export function isOperatorAuthEnabled(): boolean {
  return getOperatorToken().length > 0;
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

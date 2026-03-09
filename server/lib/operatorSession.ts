import { createHmac, timingSafeEqual } from "node:crypto";
import type express from "express";

type OperatorSessionRecord = {
  authMode: "oidc" | "token";
  credential: string;
  expiresAt: string;
  issuedAt: string;
  roles: string[];
  subject: string | null;
};

export type OperatorSessionView = Omit<OperatorSessionRecord, "credential">;

const DEFAULT_COOKIE_NAME = "aegisops_operator_session";
const DEFAULT_TTL_SEC = 12 * 60 * 60;

function toBase64Url(value: string): string {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function fromBase64Url(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return Buffer.from(padded, "base64").toString("utf8");
}

function getCookieName(): string {
  return String(process.env.AEGISOPS_OPERATOR_SESSION_COOKIE || "").trim() || DEFAULT_COOKIE_NAME;
}

function getSessionTtlSec(): number {
  const parsed = Number.parseInt(String(process.env.AEGISOPS_OPERATOR_SESSION_TTL_SEC || ""), 10);
  if (!Number.isFinite(parsed) || Number.isNaN(parsed) || parsed <= 0) {
    return DEFAULT_TTL_SEC;
  }
  return Math.min(parsed, 7 * 24 * 60 * 60);
}

function getSessionSecret(): string {
  return (
    String(process.env.AEGISOPS_OPERATOR_SESSION_SECRET || "").trim() ||
    String(process.env.AEGISOPS_OPERATOR_TOKEN || "").trim() ||
    "aegisops-local-session-secret"
  );
}

function useSecureCookie(): boolean {
  const configured = String(process.env.AEGISOPS_OPERATOR_SESSION_SECURE || "").trim().toLowerCase();
  if (configured === "1" || configured === "true" || configured === "yes") return true;
  if (configured === "0" || configured === "false" || configured === "no") return false;
  return process.env.NODE_ENV === "production";
}

function signPayload(payload: string): string {
  return createHmac("sha256", getSessionSecret()).update(payload).digest("base64url");
}

function signaturesMatch(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function parseCookieHeader(value: string | undefined): Record<string, string> {
  return String(value || "")
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((cookies, chunk) => {
      const separator = chunk.indexOf("=");
      if (separator <= 0) {
        return cookies;
      }
      const key = chunk.slice(0, separator).trim();
      const val = chunk.slice(separator + 1).trim();
      if (key) {
        cookies[key] = val;
      }
      return cookies;
    }, {});
}

function isExpired(record: OperatorSessionRecord): boolean {
  return Date.parse(record.expiresAt) <= Date.now();
}

export function getOperatorSessionCookieName(): string {
  return getCookieName();
}

export function readOperatorSession(req: express.Request): OperatorSessionView | null {
  const encoded = parseCookieHeader(String(req.headers.cookie || ""))[getCookieName()];
  if (!encoded) {
    return null;
  }
  const separator = encoded.indexOf(".");
  if (separator <= 0) {
    return null;
  }
  const payload = encoded.slice(0, separator);
  const signature = encoded.slice(separator + 1);
  const expected = signPayload(payload);
  if (!signaturesMatch(signature, expected)) {
    return null;
  }

  try {
    const parsed = JSON.parse(fromBase64Url(payload)) as OperatorSessionRecord;
    if (!parsed || typeof parsed !== "object" || !parsed.credential || isExpired(parsed)) {
      return null;
    }
    return {
      authMode: parsed.authMode,
      expiresAt: parsed.expiresAt,
      issuedAt: parsed.issuedAt,
      roles: Array.isArray(parsed.roles) ? parsed.roles : [],
      subject: parsed.subject || null,
    };
  } catch {
    return null;
  }
}

function readOperatorSessionRecord(req: express.Request): OperatorSessionRecord | null {
  const encoded = parseCookieHeader(String(req.headers.cookie || ""))[getCookieName()];
  if (!encoded) {
    return null;
  }
  const separator = encoded.indexOf(".");
  if (separator <= 0) {
    return null;
  }
  const payload = encoded.slice(0, separator);
  const signature = encoded.slice(separator + 1);
  const expected = signPayload(payload);
  if (!signaturesMatch(signature, expected)) {
    return null;
  }

  try {
    const parsed = JSON.parse(fromBase64Url(payload)) as OperatorSessionRecord;
    if (!parsed || typeof parsed !== "object" || !parsed.credential || isExpired(parsed)) {
      return null;
    }
    return {
      authMode: parsed.authMode,
      credential: String(parsed.credential),
      expiresAt: String(parsed.expiresAt),
      issuedAt: String(parsed.issuedAt),
      roles: Array.isArray(parsed.roles) ? parsed.roles.map((item) => String(item).trim().toLowerCase()).filter(Boolean) : [],
      subject: parsed.subject ? String(parsed.subject) : null,
    };
  } catch {
    return null;
  }
}

export function applyOperatorSession(req: express.Request): OperatorSessionView | null {
  const session = readOperatorSessionRecord(req);
  if (!session) {
    return null;
  }
  if (!String(req.headers.authorization || "").trim() && !String(req.headers["x-operator-token"] || "").trim()) {
    if (session.authMode === "oidc") {
      req.headers.authorization = `Bearer ${session.credential}`;
    } else {
      req.headers["x-operator-token"] = session.credential;
    }
  }
  if (!String(req.headers["x-operator-role"] || "").trim() && !String(req.headers["x-operator-roles"] || "").trim() && session.roles.length > 0) {
    req.headers["x-operator-roles"] = session.roles.join(",");
  }
  return {
    authMode: session.authMode,
    expiresAt: session.expiresAt,
    issuedAt: session.issuedAt,
    roles: session.roles,
    subject: session.subject,
  };
}

export function createOperatorSessionCookie(options: {
  authMode: "oidc" | "token";
  credential: string;
  roles: string[];
  subject: string | null;
}): { cookie: string; session: OperatorSessionView } {
  const issuedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + getSessionTtlSec() * 1000).toISOString();
  const record: OperatorSessionRecord = {
    authMode: options.authMode,
    credential: options.credential,
    expiresAt,
    issuedAt,
    roles: options.roles,
    subject: options.subject,
  };
  const payload = toBase64Url(JSON.stringify(record));
  const signature = signPayload(payload);
  const parts = [
    `${getCookieName()}=${payload}.${signature}`,
    "Path=/",
    `Max-Age=${getSessionTtlSec()}`,
    "HttpOnly",
    "SameSite=Strict",
  ];
  if (useSecureCookie()) {
    parts.push("Secure");
  }
  return {
    cookie: parts.join("; "),
    session: {
      authMode: record.authMode,
      expiresAt,
      issuedAt,
      roles: record.roles,
      subject: record.subject,
    },
  };
}

export function clearOperatorSessionCookie(): string {
  const parts = [
    `${getCookieName()}=`,
    "Path=/",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    "Max-Age=0",
    "HttpOnly",
    "SameSite=Strict",
  ];
  if (useSecureCookie()) {
    parts.push("Secure");
  }
  return parts.join("; ");
}

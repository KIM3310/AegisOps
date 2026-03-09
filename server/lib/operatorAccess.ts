import { createPublicKey, verify as verifySignature } from "node:crypto";
import type express from "express";

const PROTECTED_PREFIXES = ["/api/analyze", "/api/followup", "/api/tts"];
const ROLE_HEADERS = ["x-operator-role", "x-operator-roles"] as const;
const ACCEPTED_HEADERS = ["authorization: Bearer <token>", "x-operator-token"] as const;
const OIDC_CACHE_TTL_MS = 5 * 60 * 1000;

type JwtHeader = {
  alg?: string;
  kid?: string;
  typ?: string;
};

type JwtPayload = {
  aud?: string | string[];
  email?: string;
  exp?: number;
  groups?: unknown;
  iss?: string;
  nbf?: number;
  realm_access?: {
    roles?: unknown;
  };
  resource_access?: Record<string, { roles?: unknown }>;
  role?: unknown;
  roles?: unknown;
  sub?: string;
  [key: string]: unknown;
};

type OperatorOidcConfig = {
  audience: string;
  issuer: string;
  jwksJson: string;
  jwksUri: string;
  roleClaimPaths: string[];
};

type OidcJwk = {
  alg?: string;
  e?: string;
  kid?: string;
  kty?: string;
  n?: string;
  use?: string;
};

type ResolvedJwks = {
  keys: OidcJwk[];
  source: "config" | "discovery" | "uri";
  uri: string | null;
};

type VerifiedOperatorIdentity = {
  authMode: "oidc" | "token";
  claims?: JwtPayload;
  roles: string[];
  subject: string | null;
};

export type OperatorAuthStatus = {
  acceptedHeaders: readonly string[];
  enabled: boolean;
  mode: "hybrid" | "none" | "oidc" | "token";
  oidc: {
    audience: string | null;
    enabled: boolean;
    issuer: string | null;
    jwksSource: "config" | "discovery" | "uri" | null;
    roleClaimPaths: string[];
  };
  requiredRoles: string[];
  roleHeaders: readonly string[];
};

export type OperatorAuthorizationResult = {
  authMode: "hybrid" | "none" | "oidc" | "token";
  ok: boolean;
  reason: "invalid-token" | "missing-role" | "missing-token" | null;
  roles: string[];
  subject: string | null;
};

const jwksCache = new Map<
  string,
  {
    expiresAt: number;
    value: ResolvedJwks;
  }
>();

export function readBearerToken(value: string | undefined): string {
  const auth = String(value || "").trim();
  if (!auth.toLowerCase().startsWith("bearer ")) return "";
  return auth.slice("bearer ".length).trim();
}

export function getOperatorToken(): string {
  return String(process.env.AEGISOPS_OPERATOR_TOKEN || "").trim();
}

function getOperatorOidcConfig(): OperatorOidcConfig {
  return {
    issuer: String(process.env.AEGISOPS_OPERATOR_OIDC_ISSUER || "").trim(),
    audience: String(process.env.AEGISOPS_OPERATOR_OIDC_AUDIENCE || "").trim(),
    jwksUri: String(process.env.AEGISOPS_OPERATOR_OIDC_JWKS_URI || "").trim(),
    jwksJson: String(process.env.AEGISOPS_OPERATOR_OIDC_JWKS_JSON || "").trim(),
    roleClaimPaths: String(
      process.env.AEGISOPS_OPERATOR_OIDC_ROLE_CLAIMS ||
        "roles,groups,realm_access.roles,resource_access.aegisops.roles"
    )
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  };
}

function isOperatorOidcEnabled(): boolean {
  const config = getOperatorOidcConfig();
  return config.issuer.length > 0 && config.audience.length > 0;
}

function getOperatorAuthMode(): "hybrid" | "none" | "oidc" | "token" {
  const tokenEnabled = getOperatorToken().length > 0;
  const oidcEnabled = isOperatorOidcEnabled();
  if (tokenEnabled && oidcEnabled) return "hybrid";
  if (tokenEnabled) return "token";
  if (oidcEnabled) return "oidc";
  return "none";
}

export function getOperatorAllowedRoles(): string[] {
  return String(process.env.AEGISOPS_OPERATOR_ALLOWED_ROLES || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

export function isOperatorAuthEnabled(): boolean {
  return getOperatorAuthMode() !== "none";
}

export function getOperatorRoleHeaders(): readonly string[] {
  return ROLE_HEADERS;
}

export function getOperatorAuthStatus(): OperatorAuthStatus {
  const mode = getOperatorAuthMode();
  const oidc = getOperatorOidcConfig();
  const jwksSource = oidc.jwksJson
    ? "config"
    : oidc.jwksUri
      ? "uri"
      : oidc.issuer
        ? "discovery"
        : null;
  return {
    enabled: mode !== "none",
    mode,
    acceptedHeaders: ACCEPTED_HEADERS,
    roleHeaders: ROLE_HEADERS,
    requiredRoles: getOperatorAllowedRoles(),
    oidc: {
      enabled: isOperatorOidcEnabled(),
      issuer: oidc.issuer || null,
      audience: oidc.audience || null,
      jwksSource,
      roleClaimPaths: oidc.roleClaimPaths,
    },
  };
}

export function requiresOperatorToken(req: express.Request): boolean {
  const method = String(req.method || "GET").toUpperCase();
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(method)) return false;
  const path = String(req.path || req.originalUrl || "");
  return PROTECTED_PREFIXES.some((prefix) => path.startsWith(prefix));
}

function readHeaderToken(req: express.Request): string {
  return String(req.headers["x-operator-token"] || "").trim();
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

function decodeBase64Url(value: string): Buffer {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return Buffer.from(padded, "base64");
}

function parseJwtPart<T>(segment: string): T {
  return JSON.parse(decodeBase64Url(segment).toString("utf8")) as T;
}

function normalizeAudience(audience: JwtPayload["aud"]): string[] {
  if (Array.isArray(audience)) {
    return audience.map((value) => String(value).trim()).filter(Boolean);
  }
  if (typeof audience === "string") {
    const trimmed = audience.trim();
    return trimmed ? [trimmed] : [];
  }
  return [];
}

function readObjectPath(source: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((current, segment) => {
    if (current && typeof current === "object" && segment in current) {
      return (current as Record<string, unknown>)[segment];
    }
    return undefined;
  }, source);
}

function normalizeRoleValues(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item).trim().toLowerCase())
      .filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean);
  }
  return [];
}

function readRolesFromClaims(claims: JwtPayload): string[] {
  const config = getOperatorOidcConfig();
  const dynamicPaths = config.roleClaimPaths.flatMap((path) => {
    if (path.includes("{audience}")) {
      return path.replaceAll("{audience}", config.audience);
    }
    return path;
  });
  const defaultPaths = [
    "roles",
    "groups",
    "role",
    "realm_access.roles",
    `resource_access.${config.audience}.roles`,
  ];
  const paths = Array.from(new Set([...dynamicPaths, ...defaultPaths]));

  return Array.from(
    new Set(paths.flatMap((path) => normalizeRoleValues(readObjectPath(claims, path))))
  );
}

function selectOidcJwk(keys: OidcJwk[], header: JwtHeader): OidcJwk | null {
  if (header.kid) {
    const matching = keys.find((key) => key.kid === header.kid);
    if (matching) {
      return matching;
    }
  }
  if (keys.length === 1) {
    return keys[0];
  }
  return null;
}

async function resolveOidcJwks(): Promise<ResolvedJwks> {
  const config = getOperatorOidcConfig();
  const cacheKey = JSON.stringify({
    issuer: config.issuer,
    audience: config.audience,
    jwksJson: config.jwksJson,
    jwksUri: config.jwksUri,
  });
  const cached = jwksCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  let value: ResolvedJwks;
  if (config.jwksJson) {
    const parsed = JSON.parse(config.jwksJson) as { keys?: OidcJwk[] };
    value = {
      keys: Array.isArray(parsed.keys) ? parsed.keys : [],
      source: "config",
      uri: null,
    };
  } else {
    const jwksUri =
      config.jwksUri ||
      String(
        (
          (await fetch(
            `${config.issuer.replace(/\/$/, "")}/.well-known/openid-configuration`
          ).then(async (response) => {
            if (!response.ok) {
              throw new Error(`OIDC discovery failed (${response.status})`);
            }
            return response.json();
          })) as { jwks_uri?: string }
        ).jwks_uri || ""
      ).trim();
    if (!jwksUri) {
      throw new Error("missing OIDC jwks_uri");
    }
    const response = await fetch(jwksUri);
    if (!response.ok) {
      throw new Error(`OIDC JWKS fetch failed (${response.status})`);
    }
    const parsed = (await response.json()) as { keys?: OidcJwk[] };
    value = {
      keys: Array.isArray(parsed.keys) ? parsed.keys : [],
      source: config.jwksUri ? "uri" : "discovery",
      uri: jwksUri,
    };
  }

  jwksCache.set(cacheKey, {
    expiresAt: Date.now() + OIDC_CACHE_TTL_MS,
    value,
  });
  return value;
}

async function verifyOidcToken(token: string): Promise<VerifiedOperatorIdentity | null> {
  const config = getOperatorOidcConfig();
  if (!config.issuer || !config.audience) {
    return null;
  }

  const segments = token.split(".");
  if (segments.length !== 3) {
    return null;
  }

  const [encodedHeader, encodedPayload, encodedSignature] = segments;
  const header = parseJwtPart<JwtHeader>(encodedHeader);
  if (header.alg !== "RS256") {
    return null;
  }

  const payload = parseJwtPart<JwtPayload>(encodedPayload);
  const { keys } = await resolveOidcJwks();
  const jwk = selectOidcJwk(keys, header);
  if (!jwk) {
    return null;
  }

  const publicKey = createPublicKey({
    format: "jwk",
    key: jwk,
  });
  const signingInput = Buffer.from(`${encodedHeader}.${encodedPayload}`, "utf8");
  const signature = decodeBase64Url(encodedSignature);
  const valid = verifySignature("RSA-SHA256", signingInput, publicKey, signature);
  if (!valid) {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp === "number" && payload.exp <= now) {
    return null;
  }
  if (typeof payload.nbf === "number" && payload.nbf > now) {
    return null;
  }
  if (String(payload.iss || "").trim() !== config.issuer) {
    return null;
  }
  if (!normalizeAudience(payload.aud).includes(config.audience)) {
    return null;
  }

  const roles = readRolesFromClaims(payload);
  return {
    authMode: "oidc",
    claims: payload,
    roles,
    subject: String(payload.sub || payload.email || "").trim() || null,
  };
}

function hasRequiredRole(presentedRoles: string[]): boolean {
  const allowedRoles = getOperatorAllowedRoles();
  if (allowedRoles.length === 0) {
    return true;
  }
  return presentedRoles.some((role) => allowedRoles.includes(role));
}

function buildTokenIdentity(req: express.Request): VerifiedOperatorIdentity | null {
  const expected = getOperatorToken();
  if (!expected) {
    return null;
  }
  const headerToken = readHeaderToken(req);
  const bearerToken = readBearerToken(String(req.headers.authorization || ""));
  if (headerToken !== expected && bearerToken !== expected) {
    return null;
  }

  return {
    authMode: "token",
    roles: readPresentedOperatorRoles(req),
    subject: "token-operator",
  };
}

export async function validateOperatorAccess(
  req: express.Request
): Promise<OperatorAuthorizationResult> {
  const mode = getOperatorAuthMode();
  if (mode === "none") {
    return {
      ok: true,
      reason: null,
      authMode: "none",
      roles: [],
      subject: null,
    };
  }

  const tokenIdentity = buildTokenIdentity(req);
  let identity = tokenIdentity;
  if (!identity && isOperatorOidcEnabled()) {
    const bearerToken = readBearerToken(String(req.headers.authorization || ""));
    if (bearerToken) {
      identity = await verifyOidcToken(bearerToken);
    }
  }

  if (!identity) {
    return {
      ok: false,
      reason:
        readHeaderToken(req) || readBearerToken(String(req.headers.authorization || ""))
          ? "invalid-token"
          : "missing-token",
      authMode: mode,
      roles: [],
      subject: null,
    };
  }

  const presentedRoles = Array.from(
    new Set([...identity.roles, ...readPresentedOperatorRoles(req)])
  );
  if (!hasRequiredRole(presentedRoles)) {
    return {
      ok: false,
      reason: "missing-role",
      authMode: identity.authMode,
      roles: presentedRoles,
      subject: identity.subject,
    };
  }

  return {
    ok: true,
    reason: null,
    authMode: identity.authMode,
    roles: presentedRoles,
    subject: identity.subject,
  };
}


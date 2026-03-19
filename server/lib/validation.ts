type RawImageInput = { mimeType?: string; data?: string } | null | undefined;
type NormalizedImageInput = { mimeType: string; data: string };

const BASE64_PATTERN = /^[A-Za-z0-9+/=\s]+$/;
const DATA_URL_PREFIX = /^data:([^;,]+);base64,/i;

export const ALLOWED_IMAGE_MIME_TYPES = new Set<string>([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
  "image/bmp",
]);

/** MIME types that must be rejected before any processing. */
const DANGEROUS_MIME_TYPES = new Set<string>([
  "image/svg+xml",
  "image/svg",
  "text/html",
  "text/xml",
  "application/xml",
  "application/xhtml+xml",
]);

function normalizeMimeType(input: string | undefined): string {
  const raw = String(input || "image/png").trim().toLowerCase();
  if (!raw) return "image/png";
  return raw;
}

function stripDataUrlPrefix(value: string): { mimeType?: string; data: string } {
  const raw = String(value || "").trim();
  const m = raw.match(DATA_URL_PREFIX);
  if (!m) return { data: raw };
  return {
    mimeType: String(m[1] || "").trim().toLowerCase(),
    data: raw.slice(m[0].length),
  };
}

function removeWhitespace(value: string): string {
  return String(value || "").replace(/\s+/g, "");
}

export function estimateBase64Bytes(value: string): number {
  const base64 = removeWhitespace(value);
  if (!base64) return 0;
  // Use Buffer.byteLength for accurate decoded size instead of a formula
  // that underestimates by 10-20% due to padding assumptions.
  try {
    return Buffer.from(base64, "base64").byteLength;
  } catch {
    // Fallback: ceiling-based estimate that never underestimates.
    return Math.ceil((base64.length * 3) / 4);
  }
}

export function normalizeAndValidateImages(
  imagesRaw: RawImageInput[],
  options: { maxImages: number; maxImageBytes: number }
): NormalizedImageInput[] {
  const maxImages = Math.max(0, Number(options.maxImages || 0));
  const maxImageBytes = Math.max(1, Number(options.maxImageBytes || 1));
  const source = Array.isArray(imagesRaw) ? imagesRaw : [];
  const out: NormalizedImageInput[] = [];

  for (const row of source) {
    if (!row || typeof row.data !== "string" || !row.data.trim()) continue;

    // Reject dangerous MIME types BEFORE any normalization or data processing.
    const rawMime = String(row.mimeType || "").trim().toLowerCase();
    if (rawMime && DANGEROUS_MIME_TYPES.has(rawMime)) {
      throw new Error(`Unsupported image mimeType: ${rawMime}`);
    }

    const stripped = stripDataUrlPrefix(row.data);

    // Also check the MIME type extracted from a data-URL prefix before normalization.
    if (stripped.mimeType && DANGEROUS_MIME_TYPES.has(stripped.mimeType)) {
      throw new Error(`Unsupported image mimeType: ${stripped.mimeType}`);
    }

    const mimeType = normalizeMimeType(stripped.mimeType || row.mimeType);
    if (!ALLOWED_IMAGE_MIME_TYPES.has(mimeType)) {
      throw new Error(`Unsupported image mimeType: ${mimeType}`);
    }

    const data = removeWhitespace(stripped.data);
    if (!data) continue;
    if (!BASE64_PATTERN.test(data)) {
      throw new Error("Invalid image base64 payload.");
    }

    const sizeBytes = estimateBase64Bytes(data);
    if (sizeBytes > maxImageBytes) {
      throw new Error(`Image payload too large (${sizeBytes} bytes > ${maxImageBytes} bytes).`);
    }

    out.push({ mimeType, data });
    if (out.length >= maxImages) break;
  }

  return out;
}


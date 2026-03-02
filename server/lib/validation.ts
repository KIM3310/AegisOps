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
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

export function normalizeAndValidateImages(
  imagesRaw: RawImageInput[],
  options: { maxImages: number; maxImageBytes: number }
): NormalizedImageInput[] {
  const maxImages = Math.max(0, Number(options.maxImages || 0));
  const maxImageBytes = Math.max(1, Number(options.maxImageBytes || 1));
  if (maxImages === 0) return [];
  const source = Array.isArray(imagesRaw) ? imagesRaw : [];
  const out: NormalizedImageInput[] = [];

  for (const row of source) {
    if (!row || typeof row.data !== "string" || !row.data.trim()) continue;

    const stripped = stripDataUrlPrefix(row.data);
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

/** Catalog product-image helpers. No schema changes. */

const MIME_ALIASES: Record<string, string> = {
  "image/jpg": "image/jpeg",
  "image/pjpeg": "image/jpeg",
  "image/x-png": "image/png"
};

export const ALLOWED_CATALOG_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
export const MAX_CATALOG_IMAGE_BYTES = 5 * 1024 * 1024;

export function normalizeImageContentType(raw: string | null | undefined): string {
  return MIME_ALIASES[(raw ?? "").trim().toLowerCase()] ?? (raw ?? "").trim().toLowerCase();
}

export function detectImageContentType(buffer: Buffer): string | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return "image/png";
  }
  if (buffer.length >= 6) {
    const gif = buffer.subarray(0, 6).toString("ascii");
    if (gif === "GIF87a" || gif === "GIF89a") return "image/gif";
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

export function isHeicLike(buffer: Buffer): boolean {
  if (buffer.length < 12) return false;
  if (buffer.subarray(4, 8).toString("ascii") !== "ftyp") return false;
  const brand = buffer.subarray(8, 12).toString("ascii").toLowerCase();
  return brand === "heic" || brand === "heif" || brand === "mif1" || brand === "msf1";
}

/**
 * Stored catalog URLs sometimes point at an unprovisioned DigitalOcean CDN host
 * (`*.cdn.digitaloceanspaces.com`) that does not resolve. Origin virtual-host
 * URLs on the same bucket remain fetchable. Rewrite on read — no DB migration.
 */
export function browserAccessibleMediaUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.hostname.endsWith(".cdn.digitaloceanspaces.com")) {
      parsed.hostname = parsed.hostname.replace(".cdn.digitaloceanspaces.com", ".digitaloceanspaces.com");
      return parsed.toString();
    }
    return url;
  } catch {
    return url;
  }
}

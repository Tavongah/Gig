/** Catalog product-image helpers. No schema changes. */

import { createRequire } from "node:module";
import sharp from "sharp";
import {
  AppError,
  PHOTO_INVALID,
  PHOTO_PROCESS_FAILED,
  PHOTO_TOO_LARGE
} from "./errors.js";

const require = createRequire(import.meta.url);
const heicConvert = require("heic-convert") as (opts: {
  buffer: Buffer;
  format: "JPEG" | "PNG";
  quality: number;
}) => Promise<ArrayBuffer>;

const MIME_ALIASES: Record<string, string> = {
  "image/jpg": "image/jpeg",
  "image/pjpeg": "image/jpeg",
  "image/x-png": "image/png",
  "image/heic": "image/heic",
  "image/heif": "image/heif",
  "image/heic-sequence": "image/heic",
  "image/heif-sequence": "image/heif"
};

const HEIC_BRANDS = new Set(["heic", "heif", "heix", "heim", "heis", "mif1", "msf1"]);
const VIDEO_BRANDS = new Set(["isom", "iso2", "mp41", "mp42", "avc1", "dash", "mmp4", "ndsc"]);

export const ALLOWED_CATALOG_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
  "image/avif",
  "image/bmp",
  "image/tiff"
]);

/** Decoded input cap (~20MB) before normalization. */
export const MAX_CATALOG_IMAGE_BYTES = 20 * 1024 * 1024;
export const CATALOG_IMAGE_MAX_EDGE = 1800;
export const CATALOG_JPEG_QUALITY = 82;

export function normalizeImageContentType(raw: string | null | undefined): string {
  return MIME_ALIASES[(raw ?? "").trim().toLowerCase()] ?? (raw ?? "").trim().toLowerCase();
}

export function detectImageContentType(buffer: Buffer): string | null {
  if (isHeicLike(buffer)) return "image/heic";
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
  if (buffer.length >= 12 && buffer.subarray(4, 8).toString("ascii") === "ftyp") {
    const brand = buffer.subarray(8, 12).toString("ascii").toLowerCase();
    if (brand === "avif" || brand === "avis") return "image/avif";
  }
  if (buffer.length >= 2 && buffer[0] === 0x42 && buffer[1] === 0x4d) return "image/bmp";
  if (
    buffer.length >= 4 &&
    ((buffer[0] === 0x49 && buffer[1] === 0x49 && buffer[2] === 0x2a && buffer[3] === 0x00) ||
      (buffer[0] === 0x4d && buffer[1] === 0x4d && buffer[2] === 0x00 && buffer[3] === 0x2a))
  ) {
    return "image/tiff";
  }
  return null;
}

export function isHeicLike(buffer: Buffer): boolean {
  if (buffer.length < 12) return false;
  if (buffer.subarray(4, 8).toString("ascii") !== "ftyp") return false;
  const brand = buffer.subarray(8, 12).toString("ascii").toLowerCase();
  return HEIC_BRANDS.has(brand);
}

function isObviousNonImage(buffer: Buffer): boolean {
  if (buffer.length >= 5 && buffer.subarray(0, 5).toString("ascii") === "%PDF-") return true;
  if (buffer.length >= 2 && buffer[0] === 0x4d && buffer[1] === 0x5a) return true; // EXE
  if (buffer.length >= 4 && buffer.subarray(0, 4).toString("ascii") === "PK\u0003\u0004") return true;
  if (buffer.length >= 12 && buffer.subarray(4, 8).toString("ascii") === "ftyp") {
    const brand = buffer.subarray(8, 12).toString("ascii").toLowerCase();
    if (VIDEO_BRANDS.has(brand) && !HEIC_BRANDS.has(brand)) return true;
  }
  if (buffer.length >= 4 && buffer.subarray(0, 4).toString("ascii") === "RIFF") {
    const kind = buffer.subarray(8, 12).toString("ascii");
    if (kind === "AVI " || kind === "WAVE") return true;
  }
  if (buffer.length >= 4 && buffer.subarray(0, 4).toString("ascii") === "OggS") return true;
  if (buffer.length >= 3 && buffer.subarray(0, 3).toString("ascii") === "ID3") return true;
  return false;
}

async function heicToJpeg(buffer: Buffer): Promise<Buffer> {
  const out = await heicConvert({ buffer, format: "JPEG", quality: 0.9 });
  return Buffer.from(out);
}

export async function normalizeCatalogPhoto(buffer: Buffer): Promise<{
  body: Buffer;
  contentType: "image/jpeg";
}> {
  if (!buffer.length) {
    throw new AppError(PHOTO_INVALID, 400, "INVALID_IMAGE_TYPE");
  }
  if (buffer.length > MAX_CATALOG_IMAGE_BYTES) {
    throw new AppError(PHOTO_TOO_LARGE, 413, "INVALID_IMAGE_SIZE");
  }
  if (isObviousNonImage(buffer)) {
    throw new AppError(PHOTO_INVALID, 400, "INVALID_IMAGE_TYPE");
  }

  const detected = detectImageContentType(buffer);
  if (!detected) {
    throw new AppError(PHOTO_INVALID, 400, "INVALID_IMAGE_TYPE");
  }
  if (!ALLOWED_CATALOG_IMAGE_TYPES.has(detected)) {
    throw new AppError(PHOTO_INVALID, 400, "INVALID_IMAGE_TYPE");
  }

  let input = buffer;
  if (detected === "image/heic" || detected === "image/heif") {
    try {
      input = await heicToJpeg(buffer);
    } catch (err) {
      console.error("[catalog-media] heic_convert_failed", {
        name: err instanceof Error ? err.name : "unknown"
      });
      throw new AppError(PHOTO_PROCESS_FAILED, 400, "IMAGE_PROCESSING_FAILED");
    }
  }

  try {
    const body = await sharp(input, { failOn: "truncated", animated: false })
      .rotate()
      .resize({
        width: CATALOG_IMAGE_MAX_EDGE,
        height: CATALOG_IMAGE_MAX_EDGE,
        fit: "inside",
        withoutEnlargement: true
      })
      .jpeg({ quality: CATALOG_JPEG_QUALITY, mozjpeg: true })
      .toBuffer();
    if (!body.length || detectImageContentType(body) !== "image/jpeg") {
      throw new Error("normalized output was not jpeg");
    }
    return { body, contentType: "image/jpeg" };
  } catch (err) {
    if (err instanceof AppError) throw err;
    console.error("[catalog-media] normalize_failed", {
      name: err instanceof Error ? err.name : "unknown"
    });
    throw new AppError(PHOTO_PROCESS_FAILED, 400, "IMAGE_PROCESSING_FAILED");
  }
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

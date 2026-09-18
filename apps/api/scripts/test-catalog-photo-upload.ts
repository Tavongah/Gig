/**
 * Catalog photo normalize + unique keys + reject non-images.
 * Run: npx tsx apps/api/scripts/test-catalog-photo-upload.ts
 */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";

const mediaDir = mkdtempSync(path.join(os.tmpdir(), "duts-catalog-media-"));
process.env.DATABASE_URL ||= "postgresql://postgres:postgres@127.0.0.1:5432/gigflow";
process.env.JWT_SECRET ||= "ci-jwt-secret-minimum-24-characters-long";
process.env.API_PUBLIC_URL = "https://api.duts.tech";
process.env.CATALOG_MEDIA_DIR = mediaDir;
process.env.SPACES_ACCESS_KEY_ID = "";
process.env.SPACES_SECRET_ACCESS_KEY = "";

const {
  detectImageContentType,
  isHeicLike,
  MAX_CATALOG_IMAGE_BYTES,
  normalizeCatalogPhoto
} = await import("../src/lib/catalog-media.js");
const { AppError, PHOTO_INVALID, PHOTO_TOO_LARGE } = await import("../src/lib/errors.js");
const { buildObjectKey, PRODUCT_IMAGE_KEY_RE, uploadPublicObject } = await import("../src/lib/spaces.js");

async function jpeg(opts?: { width?: number; height?: number }): Promise<Buffer> {
  return sharp({
    create: {
      width: opts?.width ?? 32,
      height: opts?.height ?? 24,
      channels: 3,
      background: { r: 200, g: 40, b: 40 }
    }
  })
    .jpeg()
    .toBuffer();
}

async function png(): Promise<Buffer> {
  return sharp({
    create: { width: 16, height: 16, channels: 3, background: { r: 20, g: 180, b: 80 } }
  })
    .png()
    .toBuffer();
}

async function webp(): Promise<Buffer> {
  return sharp({
    create: { width: 20, height: 20, channels: 3, background: { r: 20, g: 80, b: 200 } }
  })
    .webp()
    .toBuffer();
}

async function expectAppError(fn: () => Promise<unknown>, message: string, code: string) {
  await assert.rejects(fn, (err: unknown) => {
    assert.ok(err instanceof AppError);
    assert.equal(err.message, message);
    assert.equal(err.code, code);
    return true;
  });
}

{
  const a = buildObjectKey("product-image", "user-1", "IMG 1234.JPG");
  const b = buildObjectKey("product-image", "user-1", "IMG 1234.JPG");
  assert.ok(PRODUCT_IMAGE_KEY_RE.test(a), a);
  assert.ok(PRODUCT_IMAGE_KEY_RE.test(b), b);
  assert.notEqual(a, b);
  assert.ok(a.startsWith("product-image/"));
  assert.ok(a.endsWith(".jpg"));
}

{
  const jpegBuf = await jpeg();
  assert.equal(detectImageContentType(jpegBuf), "image/jpeg");
  const out = await normalizeCatalogPhoto(jpegBuf);
  assert.equal(out.contentType, "image/jpeg");
  assert.equal(detectImageContentType(out.body), "image/jpeg");
}

{
  const out = await normalizeCatalogPhoto(await png());
  assert.equal(detectImageContentType(out.body), "image/jpeg");
}

{
  const out = await normalizeCatalogPhoto(await webp());
  assert.equal(detectImageContentType(out.body), "image/jpeg");
}

{
  const portrait = await jpeg({ width: 40, height: 80 });
  const oriented = await sharp(portrait).withMetadata({ orientation: 6 }).jpeg().toBuffer();
  const out = await normalizeCatalogPhoto(oriented);
  const meta = await sharp(out.body).metadata();
  assert.ok((meta.width ?? 0) >= (meta.height ?? 0));
}

{
  const large = await jpeg({ width: 2400, height: 1800 });
  const out = await normalizeCatalogPhoto(large);
  const meta = await sharp(out.body).metadata();
  assert.ok((meta.width ?? 0) <= 1800);
  assert.ok((meta.height ?? 0) <= 1800);
}

{
  const heic = Buffer.alloc(12);
  heic.write("xxxxftypheic", 0, "ascii");
  assert.equal(isHeicLike(heic), true);
  await expectAppError(
    () => normalizeCatalogPhoto(heic),
    "We couldn't process this photo. Try another one.",
    "IMAGE_PROCESSING_FAILED"
  );
}

let heicAccepted = false;
try {
  const heif = await sharp({
    create: { width: 12, height: 12, channels: 3, background: { r: 10, g: 10, b: 200 } }
  })
    .heif()
    .toBuffer();
  const out = await normalizeCatalogPhoto(heif);
  assert.equal(detectImageContentType(out.body), "image/jpeg");
  heicAccepted = true;
} catch {
  heicAccepted = false;
}

await expectAppError(
  () => normalizeCatalogPhoto(Buffer.from("%PDF-1.4 not an image")),
  PHOTO_INVALID,
  "INVALID_IMAGE_TYPE"
);
await expectAppError(
  () => normalizeCatalogPhoto(Buffer.from("just a text file")),
  PHOTO_INVALID,
  "INVALID_IMAGE_TYPE"
);
await expectAppError(
  () =>
    normalizeCatalogPhoto(
      Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d])
    ),
  PHOTO_INVALID,
  "INVALID_IMAGE_TYPE"
);
await expectAppError(
  () => normalizeCatalogPhoto(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x01])),
  "We couldn't process this photo. Try another one.",
  "IMAGE_PROCESSING_FAILED"
);
await expectAppError(
  () => normalizeCatalogPhoto(Buffer.alloc(MAX_CATALOG_IMAGE_BYTES + 1, 0xff)),
  PHOTO_TOO_LARGE,
  "INVALID_IMAGE_SIZE"
);

{
  const jpegBuf = await jpeg();
  const normalized = await normalizeCatalogPhoto(jpegBuf);
  const uploaded = await uploadPublicObject({
    purpose: "product-image",
    userId: "tester",
    fileName: "IMG 1234.JPG",
    contentType: normalized.contentType,
    body: normalized.body
  });
  assert.ok(PRODUCT_IMAGE_KEY_RE.test(uploaded.objectKey));
  assert.equal(uploaded.publicUrl, `https://api.duts.tech/v1/media/${uploaded.objectKey}`);
  const stored = await readFile(path.join(mediaDir, uploaded.objectKey));
  assert.equal(detectImageContentType(stored), "image/jpeg");
}

await rm(mediaDir, { recursive: true, force: true });

console.log(JSON.stringify({ ok: true, heicEncoderAvailable: heicAccepted }, null, 2));

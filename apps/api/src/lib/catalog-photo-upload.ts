import { AppError, PHOTO_INVALID, PHOTO_TOO_LARGE } from "./errors.js";
import { MAX_CATALOG_IMAGE_BYTES, normalizeCatalogPhoto } from "./catalog-media.js";
import { uploadPublicObject } from "./spaces.js";

export async function persistNormalizedCatalogPhoto(input: {
  userId: string;
  fileName?: string;
  dataBase64: string;
}): Promise<{ url: string; objectKey: string }> {
  if (!input.dataBase64) {
    throw new AppError(PHOTO_INVALID, 400, "VALIDATION_ERROR");
  }
  let buffer: Buffer;
  try {
    buffer = Buffer.from(input.dataBase64, "base64");
  } catch {
    throw new AppError(PHOTO_INVALID, 400, "INVALID_IMAGE_TYPE");
  }
  if (buffer.length === 0) {
    throw new AppError(PHOTO_INVALID, 400, "INVALID_IMAGE_TYPE");
  }
  if (buffer.length > MAX_CATALOG_IMAGE_BYTES) {
    throw new AppError(PHOTO_TOO_LARGE, 413, "INVALID_IMAGE_SIZE");
  }
  const normalized = await normalizeCatalogPhoto(buffer);
  const uploaded = await uploadPublicObject({
    purpose: "product-image",
    userId: input.userId,
    fileName: "product.jpg",
    contentType: normalized.contentType,
    body: normalized.body
  });
  return { url: uploaded.publicUrl, objectKey: uploaded.objectKey };
}

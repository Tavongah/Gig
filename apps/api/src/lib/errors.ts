export class AppError extends Error {
  constructor(
    message: string,
    readonly statusCode: number = 500,
    readonly code?: string,
    readonly errors?: Record<string, string>
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const PHOTO_UPLOAD_FAILED = "Photo couldn't be uploaded. Please try again.";
export const PHOTO_INVALID = "Please choose a photo.";
export const PHOTO_TOO_LARGE = "This photo is too large. Please choose a smaller photo.";
export const PHOTO_PROCESS_FAILED = "We couldn't process this photo. Try another one.";
export const PRODUCT_SAVE_FAILED = "Product wasn't saved. Please try again.";

/** S3/Spaces/network failures — never send infrastructure text to Admin. */
export function isStorageInfraError(error: unknown): boolean {
  const err = error as { name?: string; Code?: string; code?: string; message?: string };
  const hay = [err?.name, err?.Code, err?.code, err?.message].filter(Boolean).join(" ");
  return /NoSuchBucket|InvalidAccessKeyId|SignatureDoesNotMatch|NetworkingError|TimeoutError|ECONNREFUSED|ECONNRESET|ENOTFOUND|specified bucket|digitaloceanspaces|STORAGE_NOT_CONFIGURED|STORAGE_UPLOAD_FAILED|S3Exception|S3ServiceException/i.test(
    hay
  );
}

export function mapErrorToResponse(error: unknown): {
  status: number;
  body: { success?: boolean; error: string; code?: string; errors?: Record<string, string> };
} {
  if (error instanceof AppError) {
    const storageish =
      error.code === "STORAGE_NOT_CONFIGURED" ||
      error.code === "STORAGE_UPLOAD_FAILED" ||
      isStorageInfraError(error);
    const message = storageish ? PHOTO_UPLOAD_FAILED : error.message;
    return {
      status: error.statusCode,
      body: {
        ...(error.errors ? { success: false, errors: error.errors } : {}),
        error: message,
        ...(error.code ? { code: error.code } : {})
      }
    };
  }

  if (error instanceof Error) {
    const known: Record<string, number> = {
      GIG_NOT_AVAILABLE: 409,
      AUTH_REQUIRED: 401,
      INVALID_TOKEN: 401,
      FORBIDDEN: 403,
      NOT_FOUND: 404,
      VALIDATION_ERROR: 400,
      INVALID_STATUS_TRANSITION: 409,
      CATEGORY_NOT_AVAILABLE: 400,
      GIG_NOT_REVIEWABLE: 400,
      WORKER_NOT_ASSIGNED: 400,
      CANCEL_NOT_ALLOWED: 409,
      DEV_PAYMENT_DISABLED: 403,
      DELIVERY_DISTANCE_EXCEEDED: 400,
      INVALID_PICKUP_PIN: 400,
      INVALID_DELIVERY_PIN: 400,
      NOT_A_DELIVERY: 400,
      USE_DELIVERY_ENDPOINTS: 409,
      DELIVERY_CANCEL_AFTER_PICKUP: 409,
      COURIER_NOT_ASSIGNED: 403,
      GPS_REQUIRED: 400,
      PICKUP_PIN_LOCKED: 429,
      DELIVERY_PIN_LOCKED: 429,
      PIN_REGEN_NOT_ALLOWED: 409,
      INVALID_TRANSPORT_MODE: 400,
      WORKER_PROFILE_REQUIRED: 400
    };

    if (/entity too large|PayloadTooLargeError/i.test(`${error.name} ${error.message}`)) {
      return { status: 413, body: { error: PHOTO_TOO_LARGE, code: "INVALID_IMAGE_SIZE" } };
    }

    if (isStorageInfraError(error)) {
      console.error("[spaces] storage_error", {
        name: error.name,
        code: (error as Error & { Code?: string; code?: string }).Code ?? (error as Error & { code?: string }).code
      });
      return {
        status: 503,
        body: { error: PHOTO_UPLOAD_FAILED, code: "STORAGE_UPLOAD_FAILED" }
      };
    }

    const status = known[error.message] ?? known[(error as Error & { code?: string }).code ?? ""] ?? 500;
    const fieldErrors = (error as Error & { errors?: Record<string, string> }).errors;
    if (fieldErrors && Object.keys(fieldErrors).length > 0) {
      return {
        status,
        body: { success: false, error: error.message, errors: fieldErrors, ...((error as Error & { code?: string }).code ? { code: (error as Error & { code?: string }).code } : {}) }
      };
    }
    return { status, body: { error: error.message } };
  }

  return { status: 500, body: { error: "INTERNAL_ERROR" } };
}

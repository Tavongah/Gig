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

export function mapErrorToResponse(error: unknown): {
  status: number;
  body: { success?: boolean; error: string; code?: string; errors?: Record<string, string> };
} {
  if (error instanceof AppError) {
    return {
      status: error.statusCode,
      body: {
        ...(error.errors ? { success: false, errors: error.errors } : {}),
        error: error.message,
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
      CANCEL_NOT_ALLOWED: 409
    };

    const status = known[error.message] ?? 500;
    return { status, body: { error: error.message } };
  }

  return { status: 500, body: { error: "INTERNAL_ERROR" } };
}

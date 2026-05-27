export class AppError extends Error {
  constructor(
    message: string,
    readonly statusCode: number = 500,
    readonly code?: string
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function mapErrorToResponse(error: unknown): { status: number; body: { error: string; code?: string } } {
  if (error instanceof AppError) {
    return {
      status: error.statusCode,
      body: { error: error.message, ...(error.code ? { code: error.code } : {}) }
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
      INVALID_STATUS_TRANSITION: 409
    };

    const status = known[error.message] ?? 500;
    return { status, body: { error: error.message } };
  }

  return { status: 500, body: { error: "INTERNAL_ERROR" } };
}

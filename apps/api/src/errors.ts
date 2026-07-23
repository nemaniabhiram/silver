import type { NextFunction, Request, Response } from "express";

export type ApiErrorCode =
  | "INVALID_UPLOAD"
  | "UPLOAD_TOO_LARGE"
  | "NOT_FOUND"
  | "INVALID_STATE"
  | "RATE_LIMITED"
  | "INTERNAL";

const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  INVALID_UPLOAD: 400,
  UPLOAD_TOO_LARGE: 413,
  NOT_FOUND: 404,
  INVALID_STATE: 409,
  RATE_LIMITED: 429,
  INTERNAL: 500,
};

/** Every message here is read by a human in the UI, so write it for one. */
export class ApiError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly headers: Record<string, string> = {},
  ) {
    super(message);
    this.name = "ApiError";
  }

  get status(): number {
    return STATUS_BY_CODE[this.code];
  }
}

export function handleErrors(
  error: unknown,
  _request: Request,
  response: Response,
  next: NextFunction,
): void {
  if (response.headersSent) {
    next(error);
    return;
  }

  const apiError =
    error instanceof ApiError
      ? error
      : new ApiError("INTERNAL", "Something broke on our side. Try again.");

  if (!(error instanceof ApiError)) {
    console.error("[api] unhandled error", error);
  }

  response.set(apiError.headers);
  response.status(apiError.status).json({
    error: { code: apiError.code, message: apiError.message },
  });
}

export const ErrorCodes = {
  UNAUTHENTICATED: "UNAUTHENTICATED",
  FORBIDDEN: "FORBIDDEN",
  AGENT_CAPABILITY_DENIED: "AGENT_CAPABILITY_DENIED",
  NOT_FOUND: "NOT_FOUND",
  VALIDATION: "VALIDATION",
  CONFLICT: "CONFLICT",
  RATE_LIMITED: "RATE_LIMITED",
  INVITATION_EXPIRED: "INVITATION_EXPIRED",
  INVITATION_USED: "INVITATION_USED",
  INVITATION_INVALID: "INVITATION_INVALID",
  COUNCIL_IN_PROGRESS: "COUNCIL_IN_PROGRESS",
  AGENTS_NOT_CONFIGURED: "AGENTS_NOT_CONFIGURED",
  AGENT_RUNTIME_FAILED: "AGENT_RUNTIME_FAILED",
  PROVIDER_NOT_CONFIGURED: "PROVIDER_NOT_CONFIGURED",
  PROVIDER_UNAVAILABLE: "PROVIDER_UNAVAILABLE",
  PROVIDER_RATE_LIMITED: "PROVIDER_RATE_LIMITED",
  LOCATION_NOT_FOUND: "LOCATION_NOT_FOUND",
  INTERNAL: "INTERNAL"
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;

  constructor(code: ErrorCode, message: string, status: number) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = status;
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

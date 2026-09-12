/**
 * Base application domain error.
 * Represents an operational error in business/service logic without being coupled to HTTP.
 */
export class AppError extends Error {
  public readonly code: string;
  public readonly details?: unknown;

  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Resource not found error.
 * Mapped to HTTP 404.
 */
export class NotFoundError extends AppError {
  constructor(message = "The requested resource was not found", details?: unknown) {
    super("NOT_FOUND", message, details);
  }
}

/**
 * Unauthenticated error.
 * Mapped to HTTP 401.
 */
export class UnauthorizedError extends AppError {
  constructor(message = "Authentication required", details?: unknown) {
    super("UNAUTHORIZED", message, details);
  }
}

/**
 * Permission denied / authorization failure.
 * Mapped to HTTP 403.
 */
export class ForbiddenError extends AppError {
  constructor(message = "You do not have permission to perform this action", details?: unknown) {
    super("FORBIDDEN", message, details);
  }
}

/**
 * State conflict error (e.g. duplicate key, concurrent update).
 * Mapped to HTTP 409.
 */
export class ConflictError extends AppError {
  constructor(message = "A conflict occurred with the current resource state", details?: unknown) {
    super("CONFLICT", message, details);
  }
}

/**
 * Domain / business validation error.
 * Mapped to HTTP 400.
 */
export class ValidationError extends AppError {
  constructor(message = "Validation failed", details?: unknown) {
    super("VALIDATION_ERROR", message, details);
  }
}

/**
 * Generic bad request error.
 * Mapped to HTTP 400.
 */
export class BadRequestError extends AppError {
  constructor(message = "Bad request", details?: unknown) {
    super("BAD_REQUEST", message, details);
  }
}

/**
 * Unrecoverable internal error.
 * Mapped to HTTP 500.
 */
export class InternalError extends AppError {
  constructor(message = "An unexpected internal error occurred", details?: unknown) {
    super("INTERNAL_ERROR", message, details);
  }
}

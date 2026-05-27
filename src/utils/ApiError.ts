/** Operational error with an HTTP status — thrown by services, caught by the error middleware. */
export class ApiError extends Error {
  statusCode: number;
  details?: unknown;

  constructor(statusCode: number, message: string, details?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
    this.name = "ApiError";
    Error.captureStackTrace(this, this.constructor);
  }

  static badRequest(msg = "Bad request", details?: unknown) {
    return new ApiError(400, msg, details);
  }
  static unauthorized(msg = "Unauthorized") {
    return new ApiError(401, msg);
  }
  static forbidden(msg = "Forbidden") {
    return new ApiError(403, msg);
  }
  static notFound(msg = "Not found") {
    return new ApiError(404, msg);
  }
  static internal(msg = "Internal server error", details?: unknown) {
    return new ApiError(500, msg, details);
  }
}

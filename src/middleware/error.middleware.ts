import { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import { ApiError } from "../utils/ApiError";
import { logger } from "../utils/logger";

// 404 handler for unmatched routes.
export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({ success: false, error: { message: "Route not found" } });
}

// Central error handler — must have 4 args for Express to recognize it.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    return res.status(400).json({
      success: false,
      error: { message: "Validation failed", details: err.flatten().fieldErrors },
    });
  }

  if (err instanceof ApiError) {
    return res.status(err.statusCode).json({
      success: false,
      error: { message: err.message, details: err.details },
    });
  }

  logger.error("Unhandled error", err instanceof Error ? err.stack : err);
  return res.status(500).json({
    success: false,
    error: { message: "Internal server error" },
  });
}

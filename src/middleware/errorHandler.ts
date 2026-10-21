import type { ErrorRequestHandler, RequestHandler } from "express";
import { randomUUID } from "node:crypto";
import { isProduction } from "../config/env.js";
import { logger } from "../utils/logger.js";

export class AppError extends Error {
  public readonly statusCode: number;
  /** Optional machine-readable code clients can branch on. */
  public readonly code?: string;

  constructor(message: string, statusCode = 500, code?: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

export const requestId: RequestHandler = (req, res, next) => {
  const headerRequestId = req.header("X-Request-Id");
  const id = headerRequestId && headerRequestId.length <= 128 ? headerRequestId : randomUUID();
  req.id = id;
  res.setHeader("X-Request-Id", id);
  next();
};

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new AppError(`Route not found: ${req.method} ${req.originalUrl}`, 404));
};

export const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  const statusCode = resolveStatusCode(error);
  const requestIdValue = req.id ?? randomUUID();

  // Client mistakes (bad JSON, oversized body) are not server failures; keep them out of error logs.
  if (statusCode >= 500) {
    logger.error(
      { error, method: req.method, path: req.path, requestId: requestIdValue },
      "Request failed",
    );
  } else {
    logger.debug({ statusCode, path: req.path, requestId: requestIdValue }, "Request rejected");
  }

  res.status(statusCode).json({
    error: {
      ...(error instanceof AppError && error.code ? { code: error.code } : {}),
      message:
        statusCode >= 500 && isProduction
          ? "Something went wrong. Please contact support with the request id."
          : error.message,
      requestId: requestIdValue,
    },
  });
};

function resolveStatusCode(error: unknown) {
  if (error instanceof AppError) return error.statusCode;

  // body-parser errors (malformed JSON, payload too large) carry an HTTP status and a type.
  const candidate = error as { status?: unknown; type?: unknown } | null;
  if (
    candidate &&
    typeof candidate.type === "string" &&
    candidate.type.startsWith("entity.") &&
    typeof candidate.status === "number" &&
    candidate.status >= 400 &&
    candidate.status < 500
  ) {
    return candidate.status;
  }

  return 500;
}

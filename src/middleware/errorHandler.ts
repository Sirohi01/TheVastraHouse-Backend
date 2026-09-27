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
  const statusCode = error instanceof AppError ? error.statusCode : 500;
  const requestIdValue = req.id ?? randomUUID();

  logger.error({ error, requestId: requestIdValue }, "Request failed");

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

import type { RequestHandler } from "express";
import type { ZodTypeAny, z } from "zod";
import { AppError } from "./errorHandler.js";

type RequestSchemas = {
  body?: ZodTypeAny;
  params?: ZodTypeAny;
  query?: ZodTypeAny;
};

export function validateRequest(schemas: RequestSchemas): RequestHandler {
  return (req, _res, next) => {
    try {
      if (schemas.body) {
        req.body = parseStrict(schemas.body, req.body);
      }

      if (schemas.params) {
        req.params = parseStrict(schemas.params, req.params);
      }

      if (schemas.query) {
        Object.defineProperty(req, "query", {
          configurable: true,
          enumerable: true,
          value: parseStrict(schemas.query, req.query),
        });
      }

      next();
    } catch (error) {
      next(new AppError(error instanceof Error ? error.message : "Invalid request", 400));
    }
  };
}

function parseStrict<TSchema extends ZodTypeAny>(
  schema: TSchema,
  value: unknown,
): z.infer<TSchema> {
  return schema.parse(value);
}

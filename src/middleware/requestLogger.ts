import type { Request, Response } from "express";
import { pinoHttp } from "pino-http";
import { logger } from "../utils/logger.js";

export const requestLogger = pinoHttp({
  logger,
  customProps(req: Request, _res: Response) {
    return {
      requestId: req.id,
    };
  },
});

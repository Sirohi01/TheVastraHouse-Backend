import pino from "pino";
import { env, isProduction } from "../config/env.js";

export const logger = pino({
  level: env.LOG_LEVEL,
  // Call sites log `{ error }`; without this serializer Error objects render as `{}`.
  serializers: { err: pino.stdSerializers.err, error: pino.stdSerializers.err },
  transport: isProduction
    ? undefined
    : {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "SYS:standard",
        },
      },
});

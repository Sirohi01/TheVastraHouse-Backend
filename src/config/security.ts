import type { CorsOptions } from "cors";
import type { RequestHandler } from "express";
import cors from "cors";
import helmet from "helmet";
import { env, isProduction } from "./env.js";

const allowedOrigins = new Set([
  env.FRONTEND_PUBLIC_URL.replace(/\/$/, ""),
  env.BACKEND_PUBLIC_URL.replace(/\/$/, ""),
]);

export const corsOptions: CorsOptions = {
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin)) {
      callback(null, true);
      return;
    }

    callback(new Error("Origin is not allowed by CORS"));
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Guest-Session-Id", "X-Request-Id"],
  credentials: false,
};

export const securityMiddleware: RequestHandler[] = [
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        "default-src": ["'self'"],
        "img-src": ["'self'", "data:", "https://res.cloudinary.com"],
        "script-src": ["'self'", "https://checkout.razorpay.com"],
        "connect-src": ["'self'", env.FRONTEND_PUBLIC_URL, env.BACKEND_PUBLIC_URL],
      },
    },
    hsts: isProduction ? undefined : false,
  }),
  cors(corsOptions),
];

import type { CorsOptions } from "cors";
import type { RequestHandler } from "express";
import cors from "cors";
import helmet from "helmet";
import { env, isProduction } from "./env.js";

const frontendOrigin = new URL(env.FRONTEND_PUBLIC_URL);
// The storefront is reachable on both the apex and www host of its domain.
const frontendHostAlias = frontendOrigin.hostname.startsWith("www.")
  ? frontendOrigin.hostname.slice(4)
  : `www.${frontendOrigin.hostname}`;

const allowedOrigins = new Set([
  frontendOrigin.origin,
  `${frontendOrigin.protocol}//${frontendHostAlias}${frontendOrigin.port ? `:${frontendOrigin.port}` : ""}`,
  new URL(env.BACKEND_PUBLIC_URL).origin,
  ...env.CORS_ALLOWED_ORIGINS.split(",")
    .map((origin) => origin.trim().replace(/\/$/, ""))
    .filter(Boolean),
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

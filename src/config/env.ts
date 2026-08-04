import { existsSync } from "node:fs";
import { resolve } from "node:path";
import dotenv from "dotenv";
import { z } from "zod";

for (const envPath of [
  resolve(process.cwd(), ".env"),
  resolve(process.cwd(), ".env.local"),
  resolve(process.cwd(), ".env.production"),
]) {
  if (existsSync(envPath)) {
    dotenv.config({ path: envPath, override: false });
  }
}

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "staging", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().optional(),
  BACKEND_PORT: z.coerce.number().int().positive().default(4000),
  FRONTEND_PUBLIC_URL: z.string().url().default("http://localhost:3000"),
  BACKEND_PUBLIC_URL: z.string().url().default("http://localhost:4000"),
  MONGODB_URI: z.string().min(1).default("mongodb://127.0.0.1:27017/vastra_house"),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),
  JWT_ACCESS_SECRET: z.string().min(32).default("dev-access-secret-change-me-at-least-32-chars"),
  JWT_REFRESH_SECRET: z.string().min(32).default("dev-refresh-secret-change-me-at-least-32-chars"),
  JWT_ACCESS_TTL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(15 * 60),
  JWT_REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(30),
  ADMIN_TOTP_REQUIRED: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  TOTP_ISSUER: z.string().min(1).default("The Vastra House"),
  CLOUDINARY_CLOUD_NAME: z.string().optional(),
  CLOUDINARY_API_KEY: z.string().optional(),
  CLOUDINARY_API_SECRET: z.string().optional(),
  MERCHANDISING_NEW_ARRIVAL_DAYS: z.coerce.number().int().positive().default(30),
  MERCHANDISING_BEST_SELLER_UNITS: z.coerce.number().int().nonnegative().default(25),
  MERCHANDISING_TRENDING_SCORE: z.coerce.number().int().nonnegative().default(100),
  MERCHANDISING_BADGE_JOB_INTERVAL_MINUTES: z.coerce.number().int().positive().default(60),
  CART_GIFT_PACKAGING_FEE: z.coerce.number().nonnegative().default(99),
  ABANDONED_CART_THRESHOLD_MINUTES: z.coerce.number().int().positive().default(60),
  ABANDONED_CART_JOB_INTERVAL_MINUTES: z.coerce.number().int().positive().default(15),
  WISHLIST_SIGNAL_JOB_INTERVAL_MINUTES: z.coerce.number().int().positive().default(60),
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),
  RAZORPAY_ENABLE_GATEWAY_CALLS: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  COD_MANUAL_REVIEW_THRESHOLD: z.coerce.number().nonnegative().default(10000),
  UPI_PAYMENT_ADDRESS: z.string().min(3).default("payments@vastrahouse"),
  UPI_QR_IMAGE_URL: z.string().default(""),
  BANK_ACCOUNT_NAME: z.string().default("The Vastra House"),
  BANK_ACCOUNT_NUMBER: z.string().default(""),
  BANK_IFSC: z.string().default(""),
  BANK_NAME: z.string().default(""),
  MANUAL_PAYMENT_INSTRUCTIONS: z
    .string()
    .default("Complete the transfer, then upload the payment proof during checkout."),
  SMTP_HOST: z.string().default(""),
  SMTP_PORT: z.coerce.number().int().positive().default(465),
  SMTP_SECURE: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  SMTP_USER: z.string().default(""),
  SMTP_PASS: z.string().default(""),
  SMTP_FROM_EMAIL: z.string().default(""),
  SMTP_FROM_NAME: z.string().default("The Vastra House"),
  COMPANY_NAME: z.string().default("The Vastra House"),
  COMPANY_ADDRESS: z.string().default("India"),
  COMPANY_EMAIL: z.string().default(""),
  COMPANY_GSTIN: z.string().default(""),
  SHIPPING_STANDARD_FEE: z.coerce.number().nonnegative().default(99),
  SHIPPING_EXPRESS_FEE: z.coerce.number().nonnegative().default(199),
  SHIPPING_FREE_THRESHOLD: z.coerce.number().nonnegative().default(2999),
  SEO_SITE_NAME: z.string().default("The Vastra House"),
  SEO_DEFAULT_TITLE: z.string().default("The Vastra House — Soft-Luxury Indian Wear"),
  SEO_DEFAULT_DESCRIPTION: z
    .string()
    .default(
      "Shop soft-luxury Indian wear at The Vastra House — festive kurtas, sarees and occasion wear crafted with heritage fabrics, made to order across India.",
    ),
  SEO_DEFAULT_OG_IMAGE: z
    .string()
    .default(
      "https://res.cloudinary.com/dzxlcorcf/image/upload/w_1200,h_630,c_fill,g_auto/v1782143954/vastra-house/media/g9dvkswmban106sgcpra.png",
    ),
  SEO_TWITTER_HANDLE: z.string().default(""),
  SEO_ORGANIZATION_LOGO_URL: z.string().default(""),
  SEO_ROBOTS_EXTRA_DISALLOW: z.string().default(""),
  WHATSAPP_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  WHATSAPP_PHONE_NUMBER_ID: z.string().default(""),
  WHATSAPP_ACCESS_TOKEN: z.string().default(""),
  WHATSAPP_API_VERSION: z.string().default("v21.0"),
  NOTIFICATION_DISPATCH_JOB_INTERVAL_SECONDS: z.coerce.number().int().positive().default(15),
  NOTIFICATION_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  REWARD_POINTS_EARN_RATE: z.coerce.number().nonnegative().default(5),
  REWARD_POINTS_REDEMPTION_VALUE: z.coerce.number().nonnegative().default(0.1),
  LOYALTY_TIER_SILVER_THRESHOLD: z.coerce.number().nonnegative().default(10_000),
  LOYALTY_TIER_GOLD_THRESHOLD: z.coerce.number().nonnegative().default(50_000),
  LOYALTY_TIER_PLATINUM_THRESHOLD: z.coerce.number().nonnegative().default(150_000),
  REFERRAL_REWARD_AMOUNT: z.coerce.number().nonnegative().default(200),
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  console.error("Invalid backend environment configuration", parsedEnv.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsedEnv.data;
export const isProduction = env.NODE_ENV === "production";

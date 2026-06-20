import mongoose from "mongoose";
import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";

const maxAttempts = 5;

export async function connectMongo(attempt = 1): Promise<void> {
  try {
    await mongoose.connect(env.MONGODB_URI, {
      serverSelectionTimeoutMS: 5000,
    });
    logger.info("MongoDB connection established");
  } catch (error) {
    logger.error({ error, attempt }, "MongoDB connection failed");

    if (attempt >= maxAttempts) {
      throw error;
    }

    const delayMs = Math.min(1000 * attempt, 5000);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    await connectMongo(attempt + 1);
  }
}

export function getDatabaseStatus(): "connected" | "disconnected" | "connecting" | "unknown" {
  switch (mongoose.connection.readyState) {
    case 0:
      return "disconnected";
    case 1:
      return "connected";
    case 2:
      return "connecting";
    default:
      return "unknown";
  }
}

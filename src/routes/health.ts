import { Router } from "express";
import type { HealthStatus } from "../config/api.js";
import { getDatabaseStatus } from "../db/mongoose.js";

export const healthRouter = Router();

healthRouter.get("/", (_req, res) => {
  const payload: HealthStatus = {
    status: "ok",
    service: "vastra-house-api",
    version: "v1",
    timestamp: new Date().toISOString(),
    database: getDatabaseStatus(),
  };

  res.json(payload);
});

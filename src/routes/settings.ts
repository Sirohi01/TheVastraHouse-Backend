import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/authMiddleware.js";
import { AppError } from "../middleware/errorHandler.js";
import { validateRequest } from "../middleware/validateRequest.js";
import { listRuntimeSettings, saveRuntimeSettings } from "../services/runtimeSettingsService.js";

export const settingsRouter = Router();

settingsRouter.use(requireAuth);

settingsRouter.get("/admin", async (req, res, next) => {
  try {
    if (req.user?.type !== "admin") {
      throw new AppError("Permission denied", 403);
    }

    res.json({ settings: await listRuntimeSettings() });
  } catch (error) {
    next(error);
  }
});

settingsRouter.put(
  "/admin",
  validateRequest({
    body: z.object({ values: z.record(z.string().max(2000)) }).strict(),
  }),
  async (req, res, next) => {
    try {
      if (req.user?.type !== "admin") {
        throw new AppError("Permission denied", 403);
      }

      res.json({
        settings: await saveRuntimeSettings(req.body.values, req.user.id),
      });
    } catch (error) {
      next(error);
    }
  },
);

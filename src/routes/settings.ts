import { Router } from "express";
import { z } from "zod";
import { requireAuth, requirePermission } from "../middleware/authMiddleware.js";
import { validateRequest } from "../middleware/validateRequest.js";
import { listRuntimeSettings, saveRuntimeSettings } from "../services/runtimeSettingsService.js";

export const settingsRouter = Router();

settingsRouter.use(requireAuth);

settingsRouter.get("/admin", requirePermission({ module: "settings", action: "read" }), async (_req, res, next) => {
  try {
    res.json({ settings: await listRuntimeSettings() });
  } catch (error) {
    next(error);
  }
});

settingsRouter.put(
  "/admin",
  requirePermission({ module: "settings", action: "manage" }),
  validateRequest({
    body: z.object({ values: z.record(z.string().max(2000)) }).strict(),
  }),
  async (req, res, next) => {
    try {
      res.json({
        settings: await saveRuntimeSettings(req.body.values, req.user!.id),
      });
    } catch (error) {
      next(error);
    }
  },
);

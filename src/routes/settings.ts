import { Router } from "express";
import { z } from "zod";
import { requireAuth, requirePermission } from "../middleware/authMiddleware.js";
import { validateRequest } from "../middleware/validateRequest.js";
import { AppError } from "../middleware/errorHandler.js";
import { writeAuditLog } from "../services/auditLogService.js";
import {
  listRuntimeSettings,
  saveRuntimeSettings,
  superAdminOnlySettings,
} from "../services/runtimeSettingsService.js";

export const settingsRouter = Router();

settingsRouter.use(requireAuth);

settingsRouter.get(
  "/admin",
  requirePermission({ module: "settings", action: "read" }),
  async (_req, res, next) => {
    try {
      res.json({ settings: await listRuntimeSettings() });
    } catch (error) {
      next(error);
    }
  },
);

settingsRouter.put(
  "/admin",
  requirePermission({ module: "settings", action: "manage" }),
  validateRequest({
    body: z.object({ values: z.record(z.string().max(2000)) }).strict(),
  }),
  async (req, res, next) => {
    try {
      const keys = Object.keys(req.body.values);
      const restricted = keys.filter((key) => superAdminOnlySettings.has(key));

      if (restricted.length && req.user!.roleSlug !== "super-admin") {
        throw new AppError(`Only a Super Admin can change: ${restricted.join(", ")}`, 403);
      }

      const settings = await saveRuntimeSettings(req.body.values, req.user!.id);
      // Audit which keys changed, never the values (they may be secrets).
      await writeAuditLog({
        action: "update",
        actor: { actorId: req.user!.id as never, actorType: "admin", ipAddress: req.ip },
        after: { keys },
        before: {},
        entity: { id: req.user!.id as never, type: "runtime-settings", displayId: "settings" },
        metadata: { keys },
      });
      res.json({ settings });
    } catch (error) {
      next(error);
    }
  },
);

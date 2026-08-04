import { Router } from "express";
import { Types } from "mongoose";
import { z } from "zod";
import { requireAuth, requirePermission } from "../middleware/authMiddleware.js";
import { AppError } from "../middleware/errorHandler.js";
import { validateRequest } from "../middleware/validateRequest.js";
import { AdminLoginHistory } from "../models/AdminLoginHistory.js";
import { Permission } from "../models/Permission.js";
import { Role } from "../models/Role.js";
import { User } from "../models/User.js";
import { writeAuditLog } from "../services/auditLogService.js";
import { hashPassword } from "../services/passwordService.js";

export const accessControlRouter = Router();
const objectId = z.string().regex(/^[a-f\d]{24}$/i);
const overrideSchema = z
  .object({
    action: z.string().min(1).max(60),
    effect: z.enum(["allow", "deny"]),
    module: z.string().min(1).max(60),
  })
  .strict();

function serializeAdminUser(user: InstanceType<typeof User>) {
  const value = user.toObject();
  delete (value as { passwordHash?: string }).passwordHash;
  delete (value as { passwordResetTokenHash?: string }).passwordResetTokenHash;
  return value;
}

accessControlRouter.use(requireAuth, requirePermission({ module: "users", action: "manage" }));

accessControlRouter.get("/roles", async (_req, res, next) => {
  try {
    const [roles, permissions] = await Promise.all([
      Role.find({ active: true }).sort({ name: 1 }).lean(),
      Permission.find({}).sort({ module: 1, action: 1 }).lean(),
    ]);
    res.json({ permissions, roles });
  } catch (error) {
    next(error);
  }
});

accessControlRouter.get("/users", async (_req, res, next) => {
  try {
    const users = await User.find({ status: { $ne: "deleted" }, type: "admin" })
      .select(
        "email firstName lastName roleSlug status permissionOverrides lastLoginAt lockedUntil createdAt",
      )
      .sort({ createdAt: -1 })
      .lean();
    res.json({ users });
  } catch (error) {
    next(error);
  }
});

accessControlRouter.post(
  "/users",
  validateRequest({
    body: z
      .object({
        email: z.string().email(),
        firstName: z.string().min(1).max(80),
        lastName: z.string().max(80).optional(),
        password: z.string().min(12).max(128),
        roleSlug: z.string().min(2).max(80),
      })
      .strict(),
  }),
  async (req, res, next) => {
    try {
      const role = await Role.findOne({ active: true, slug: req.body.roleSlug });
      if (!role) throw new AppError("Role not found", 404);
      const user = await User.create({
        email: req.body.email.toLowerCase(),
        firstName: req.body.firstName,
        lastName: req.body.lastName,
        passwordHash: await hashPassword(req.body.password),
        roleId: role._id,
        roleSlug: role.slug,
        type: "admin",
      });
      await writeAuditLog({
        action: "create",
        actor: { actorId: new Types.ObjectId(req.user!.id), actorType: "admin" },
        after: serializeAdminUser(user),
        entity: { id: user._id, type: "admin-user", displayId: user.email },
      });
      res.status(201).json({ user: serializeAdminUser(user) });
    } catch (error) {
      next(error);
    }
  },
);

accessControlRouter.patch(
  "/users/:id",
  validateRequest({
    params: z.object({ id: objectId }).strict(),
    body: z
      .object({
        permissionOverrides: z.array(overrideSchema).max(100).optional(),
        roleSlug: z.string().min(2).max(80).optional(),
        status: z.enum(["active", "inactive"]).optional(),
      })
      .strict(),
  }),
  async (req, res, next) => {
    try {
      const user = await User.findOne({ _id: req.params.id, type: "admin" });
      if (!user) throw new AppError("Admin user not found", 404);
      if (String(user._id) === req.user!.id && req.body.status === "inactive") {
        throw new AppError("You cannot deactivate your own active session", 409);
      }
      const removesSuperAdmin =
        user.roleSlug === "super-admin" &&
        (req.body.status === "inactive" ||
          (req.body.roleSlug !== undefined && req.body.roleSlug !== "super-admin"));
      if (removesSuperAdmin) {
        const remaining = await User.countDocuments({
          _id: { $ne: user._id },
          roleSlug: "super-admin",
          status: "active",
          type: "admin",
        });
        if (remaining === 0) throw new AppError("At least one active super-admin is required", 409);
      }
      const before = user.toObject();
      if (req.body.roleSlug) {
        const role = await Role.findOne({ active: true, slug: req.body.roleSlug });
        if (!role) throw new AppError("Role not found", 404);
        user.roleSlug = role.slug;
        user.roleId = role._id;
      }
      if (req.body.permissionOverrides) user.permissionOverrides = req.body.permissionOverrides;
      if (req.body.status) user.status = req.body.status;
      await user.save();
      await writeAuditLog({
        action: "update",
        actor: { actorId: new Types.ObjectId(req.user!.id), actorType: "admin" },
        after: serializeAdminUser(user),
        before,
        entity: { id: user._id, type: "admin-user", displayId: user.email },
      });
      res.json({ user: serializeAdminUser(user) });
    } catch (error) {
      next(error);
    }
  },
);

accessControlRouter.get("/login-history", async (_req, res, next) => {
  try {
    const history = await AdminLoginHistory.find({}).sort({ createdAt: -1 }).limit(250).lean();
    res.json({ history });
  } catch (error) {
    next(error);
  }
});

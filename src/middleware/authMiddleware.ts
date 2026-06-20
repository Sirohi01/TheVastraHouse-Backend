import type { RequestHandler } from "express";
import { Role } from "../models/Role.js";
import { User } from "../models/User.js";
import { verifyAccessToken } from "../services/jwtService.js";
import { hasPermission, type Permission } from "../services/rbacService.js";
import { AppError } from "./errorHandler.js";

export type AuthenticatedRequestUser = {
  id: string;
  type: "customer" | "admin";
  roleSlug?: string;
  customerType?: "retail" | "wholesale";
};

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedRequestUser;
    }
  }
}

export const requireAuth: RequestHandler = (req, _res, next) => {
  const authHeader = req.header("Authorization");

  if (!authHeader?.startsWith("Bearer ")) {
    next(new AppError("Authentication required", 401));
    return;
  }

  try {
    const claims = verifyAccessToken(authHeader.slice("Bearer ".length));
    req.user = {
      id: claims.sub,
      type: claims.type,
      roleSlug: claims.roleSlug,
      customerType: claims.customerType,
    };
    next();
  } catch {
    next(new AppError("Authentication token is invalid or expired", 401));
  }
};

export const attachOptionalUser: RequestHandler = (req, _res, next) => {
  const authHeader = req.header("Authorization");

  if (!authHeader?.startsWith("Bearer ")) {
    next();
    return;
  }

  try {
    const claims = verifyAccessToken(authHeader.slice("Bearer ".length));
    req.user = {
      id: claims.sub,
      type: claims.type,
      roleSlug: claims.roleSlug,
      customerType: claims.customerType,
    };
  } catch {
    // Public commerce routes still work for guests; invalid tokens simply do not attach a user.
  }

  next();
};

export function requirePermission(permission: Permission): RequestHandler {
  return async (req, _res, next) => {
    if (!req.user) {
      next(new AppError("Authentication required", 401));
      return;
    }

    const user = await User.findById(req.user.id);

    if (!user) {
      next(new AppError("User not found", 401));
      return;
    }

    const role = user.roleSlug
      ? ((await Role.findOne({ slug: user.roleSlug }).lean().exec()) as {
          permissions?: Permission[];
        } | null)
      : null;
    const allowed = hasPermission(
      {
        type: user.type,
        roleSlug: user.roleSlug,
        permissions: role?.permissions ?? [],
        permissionOverrides: user.permissionOverrides,
      },
      permission,
    );

    if (!allowed) {
      next(new AppError("Permission denied", 403));
      return;
    }

    next();
  };
}

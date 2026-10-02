import type { RequestHandler } from "express";
import mongoose from "mongoose";
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

export const requireAuth: RequestHandler = async (req, _res, next) => {
  const authHeader = req.header("Authorization");

  if (!authHeader?.startsWith("Bearer ")) {
    next(new AppError("Authentication required", 401));
    return;
  }

  let claims: ReturnType<typeof verifyAccessToken> & { iat?: number };

  try {
    claims = verifyAccessToken(authHeader.slice("Bearer ".length));
  } catch {
    next(new AppError("Authentication token is invalid or expired", 401));
    return;
  }

  try {
    // Tokens die with the account: deactivation, anonymisation or a password change revoke them.
    if (mongoose.connection.readyState === 1) {
      const account = (await User.findById(claims.sub)
        .select("status deactivatedAt anonymizedAt passwordChangedAt")
        .lean()) as {
        status?: string;
        deactivatedAt?: Date;
        anonymizedAt?: Date;
        passwordChangedAt?: Date;
      } | null;

      if (
        !account ||
        account.status !== "active" ||
        account.deactivatedAt ||
        account.anonymizedAt
      ) {
        next(new AppError("Authentication token is invalid or expired", 401));
        return;
      }

      if (
        account.passwordChangedAt &&
        claims.iat &&
        claims.iat * 1000 < account.passwordChangedAt.getTime() - 1000
      ) {
        next(new AppError("Your password was changed. Please sign in again.", 401));
        return;
      }
    }

    req.user = {
      id: claims.sub,
      type: claims.type,
      roleSlug: claims.roleSlug,
      customerType: claims.customerType,
    };
    next();
  } catch (error) {
    next(error);
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
    // A token that is present but expired/invalid must not silently downgrade a signed-in
    // shopper to a guest cart. Returning 401 lets the client refresh (or drop the stale
    // session) and retry; requests without an Authorization header are unaffected.
    next(new AppError("Authentication token is invalid or expired", 401));
    return;
  }

  next();
};

/**
 * Resolves whether an authenticated user holds a permission right now (role permissions from
 * the database plus per-user overrides). Inactive accounts never hold permissions.
 */
export async function userHasPermission(userId: string, permission: Permission) {
  const user = await User.findById(userId);

  if (!user) {
    return { allowed: false, reason: "User not found", status: 401 } as const;
  }

  if (user.status !== "active" || user.deactivatedAt) {
    return { allowed: false, reason: "Account is inactive", status: 403 } as const;
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

  return allowed
    ? ({ allowed: true, reason: "", status: 200 } as const)
    : ({ allowed: false, reason: "Permission denied", status: 403 } as const);
}

export function requirePermission(permission: Permission): RequestHandler {
  return async (req, _res, next) => {
    if (!req.user) {
      next(new AppError("Authentication required", 401));
      return;
    }

    try {
      const result = await userHasPermission(req.user.id, permission);

      if (!result.allowed) {
        next(new AppError(result.reason, result.status));
        return;
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}

/** Allows staff only (any admin account); used before permission checks on admin routers. */
export const requireAdmin: RequestHandler = (req, _res, next) => {
  if (!req.user) {
    next(new AppError("Authentication required", 401));
    return;
  }

  if (req.user.type !== "admin") {
    next(new AppError("Permission denied", 403));
    return;
  }

  next();
};

/** Passes when the user holds at least one of the listed permissions. */
export function requireAnyPermission(...permissions: Permission[]): RequestHandler {
  return async (req, _res, next) => {
    if (!req.user) {
      next(new AppError("Authentication required", 401));
      return;
    }

    try {
      for (const permission of permissions) {
        const result = await userHasPermission(req.user.id, permission);
        if (result.allowed) {
          next();
          return;
        }
        if (result.status === 401 || result.reason === "Account is inactive") {
          next(new AppError(result.reason, result.status));
          return;
        }
      }
      next(new AppError("Permission denied", 403));
    } catch (error) {
      next(error);
    }
  };
}

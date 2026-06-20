export type Permission = {
  module: string;
  action: string;
};

export type PermissionOverride = Permission & {
  effect: "allow" | "deny";
};

export type AuthorizableUser = {
  type: "customer" | "admin";
  roleSlug?: string | null;
  permissions?: Permission[];
  permissionOverrides?: PermissionOverride[];
};

export function hasPermission(user: AuthorizableUser, requiredPermission: Permission): boolean {
  if (user.type !== "admin") {
    return false;
  }

  const normalizedRequired = normalizePermission(requiredPermission);
  const override = user.permissionOverrides?.find(
    (item) =>
      item.module.toLowerCase() === normalizedRequired.module &&
      item.action.toLowerCase() === normalizedRequired.action,
  );

  if (override?.effect === "deny") {
    return false;
  }

  if (override?.effect === "allow") {
    return true;
  }

  return Boolean(
    user.permissions?.some((item) => {
      const normalized = normalizePermission(item);
      return (
        normalized.module === normalizedRequired.module &&
        (normalized.action === normalizedRequired.action || normalized.action === "manage")
      );
    }),
  );
}

function normalizePermission(permission: Permission): Permission {
  return {
    module: permission.module.toLowerCase(),
    action: permission.action.toLowerCase(),
  };
}

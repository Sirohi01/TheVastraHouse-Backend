import assert from "node:assert/strict";
import test from "node:test";
import { createOpaqueToken, hashOpaqueToken } from "./cryptoTokenService.js";
import { signAccessToken, verifyAccessToken } from "./jwtService.js";
import { hashPassword, verifyPassword } from "./passwordService.js";
import { hasPermission } from "./rbacService.js";
import { seedRoles } from "./roleSeedService.js";
import { createTotpSecret } from "./totpService.js";

test("password hashing verifies correct passwords and rejects wrong passwords", async () => {
  const hash = await hashPassword("Password@123");

  assert.equal(await verifyPassword("Password@123", hash), true);
  assert.equal(await verifyPassword("WrongPassword@123", hash), false);
});

test("opaque tokens are hashed deterministically without exposing raw token", () => {
  const token = createOpaqueToken();
  const hash = hashOpaqueToken(token);

  assert.notEqual(hash, token);
  assert.equal(hash, hashOpaqueToken(token));
});

test("JWT access tokens round-trip expected claims", () => {
  const token = signAccessToken({
    sub: "user-id",
    type: "admin",
    roleSlug: "super-admin",
  });
  const claims = verifyAccessToken(token);

  assert.equal(claims.sub, "user-id");
  assert.equal(claims.type, "admin");
  assert.equal(claims.roleSlug, "super-admin");
});

test("TOTP setup produces secret and otpauth URL", () => {
  const setup = createTotpSecret("admin@example.com");

  assert.ok(setup.secret.length >= 16);
  assert.ok(setup.otpauthUrl.startsWith("otpauth://totp/"));
});

test("RBAC denies customers and respects admin permissions and overrides", () => {
  assert.equal(hasPermission({ type: "customer" }, { module: "orders", action: "read" }), false);
  assert.equal(
    hasPermission(
      {
        type: "admin",
        permissions: [{ module: "orders", action: "manage" }],
      },
      { module: "orders", action: "read" },
    ),
    true,
  );
  assert.equal(
    hasPermission(
      {
        type: "admin",
        permissions: [{ module: "orders", action: "manage" }],
        permissionOverrides: [{ module: "orders", action: "read", effect: "deny" }],
      },
      { module: "orders", action: "read" },
    ),
    false,
  );
});

test("seven documented admin roles enforce their allow and deny boundaries", () => {
  assert.equal(seedRoles.length, 7);
  const cases = [
    ["super-admin", "users", "manage", true],
    ["admin", "settings", "manage", true],
    ["admin", "users", "read", false],
    ["inventory-manager", "inventory", "manage", true],
    ["inventory-manager", "payments", "manage", false],
    ["order-manager", "orders", "manage", true],
    ["order-manager", "cms", "manage", false],
    ["content-manager", "cms", "manage", true],
    ["content-manager", "orders", "manage", false],
    ["marketing-manager", "notifications", "manage", true],
    ["marketing-manager", "inventory", "manage", false],
    ["support-agent", "support", "manage", true],
    ["support-agent", "payments", "manage", false],
  ] as const;

  for (const [slug, module, action, expected] of cases) {
    const role = seedRoles.find((item) => item.slug === slug);
    assert.ok(role, `missing role ${slug}`);
    assert.equal(
      hasPermission({ type: "admin", permissions: role.permissions }, { module, action }),
      expected,
      `${slug} ${module}/${action}`,
    );
  }
});

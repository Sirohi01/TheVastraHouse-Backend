import mongoose from "mongoose";
import { env, isProduction } from "../config/env.js";
import { Role } from "../models/Role.js";
import { User } from "../models/User.js";
import { hashPassword } from "../services/passwordService.js";
import { seedDefaultRoles } from "../services/roleSeedService.js";

const defaultEmail = "manishsirohi023@gmail.com";
const defaultPassword = "Manish123";

const email = (process.env.SEED_ADMIN_EMAIL || defaultEmail).trim().toLowerCase();
const password = process.env.SEED_ADMIN_PASSWORD || defaultPassword;
const resetTotp =
  process.argv.includes("--reset-totp") || process.env.SEED_ADMIN_RESET_TOTP === "true";

if (isProduction && password === defaultPassword) {
  console.error("Refusing to seed production admin with the default password.");
  console.error("Set SEED_ADMIN_PASSWORD to a strong unique value and run again.");
  process.exit(1);
}

async function seedAdmin() {
  await mongoose.connect(env.MONGODB_URI);
  await seedDefaultRoles();

  const role = await Role.findOne({ slug: "super-admin" });

  if (!role) {
    throw new Error("Super Admin role was not seeded.");
  }

  const passwordHash = await hashPassword(password);
  const existingAdmin = await User.findOne({ email }).select("+totpSecret");

  if (existingAdmin) {
    existingAdmin.type = "admin";
    existingAdmin.passwordHash = passwordHash;
    existingAdmin.firstName = existingAdmin.firstName || "Seed";
    existingAdmin.lastName = existingAdmin.lastName || "Admin";
    existingAdmin.emailVerifiedAt = existingAdmin.emailVerifiedAt || new Date();
    existingAdmin.roleId = role._id;
    existingAdmin.roleSlug = "super-admin";
    existingAdmin.failedLoginCount = 0;
    existingAdmin.lockedUntil = undefined;
    existingAdmin.deactivatedAt = undefined;

    if (resetTotp) {
      existingAdmin.totpSecret = undefined;
      existingAdmin.totpEnabled = false;
    }

    await existingAdmin.save();
    printResult("updated");
    return;
  }

  await User.create({
    type: "admin",
    email,
    passwordHash,
    firstName: "Seed",
    lastName: "Admin",
    emailVerifiedAt: new Date(),
    roleId: role._id,
    roleSlug: "super-admin",
    totpEnabled: false,
  });

  printResult("created");
}

function printResult(action: "created" | "updated") {
  console.info(`Admin user ${action}.`);
  console.info(`Email: ${email}`);
  console.info(
    password === defaultPassword
      ? `Password: ${defaultPassword}`
      : "Password: value from SEED_ADMIN_PASSWORD",
  );
  console.info("Role: super-admin");
  console.info("TOTP: login will return setup URL until 2FA is enabled.");
}

seedAdmin()
  .then(async () => {
    await mongoose.disconnect();
  })
  .catch(async (error: unknown) => {
    console.error(error);
    await mongoose.disconnect();
    process.exit(1);
  });

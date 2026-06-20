import { Role } from "../models/Role.js";

type SeedRole = {
  name: string;
  slug: string;
  description: string;
  permissions: { module: string; action: string }[];
};

const allModules = [
  "catalog",
  "orders",
  "payments",
  "inventory",
  "manufacturing",
  "crm",
  "marketing",
  "seo",
  "cms",
  "media",
  "invoicing",
  "analytics",
  "settings",
  "users",
  "audit",
] as const;

const manageAll = allModules.map((module) => ({ module, action: "manage" }));

export const seedRoles: SeedRole[] = [
  {
    name: "Super Admin",
    slug: "super-admin",
    description: "Full unrestricted access including roles, permissions, and audit logs.",
    permissions: manageAll,
  },
  {
    name: "Admin",
    slug: "admin",
    description: "Day-to-day operational owner excluding system-level role management.",
    permissions: manageAll.filter((permission) => !["users", "audit"].includes(permission.module)),
  },
  {
    name: "Inventory Manager",
    slug: "inventory-manager",
    description: "Owns stock accuracy across warehouses.",
    permissions: [
      { module: "inventory", action: "manage" },
      { module: "catalog", action: "read" },
      { module: "orders", action: "read" },
    ],
  },
  {
    name: "Order Manager",
    slug: "order-manager",
    description: "Owns order lifecycle, payment verification, shipment, returns, and invoices.",
    permissions: [
      { module: "orders", action: "manage" },
      { module: "payments", action: "manage" },
      { module: "invoicing", action: "read" },
      { module: "inventory", action: "read" },
      { module: "catalog", action: "read" },
    ],
  },
  {
    name: "Content Manager",
    slug: "content-manager",
    description: "Owns customer-facing content and merchandising presentation.",
    permissions: [
      { module: "cms", action: "manage" },
      { module: "media", action: "manage" },
      { module: "seo", action: "manage" },
      { module: "catalog", action: "read" },
    ],
  },
  {
    name: "Marketing Manager",
    slug: "marketing-manager",
    description: "Owns campaigns, coupons, segments, and SEO coordination.",
    permissions: [
      { module: "marketing", action: "manage" },
      { module: "seo", action: "manage" },
      { module: "crm", action: "read" },
      { module: "orders", action: "read" },
      { module: "customers", action: "read" },
    ],
  },
  {
    name: "Support Agent",
    slug: "support-agent",
    description: "Front-line customer support with limited write access.",
    permissions: [
      { module: "orders", action: "read" },
      { module: "customers", action: "read" },
      { module: "invoicing", action: "read" },
      { module: "support", action: "manage" },
    ],
  },
];

export async function seedDefaultRoles(): Promise<void> {
  for (const role of seedRoles) {
    await Role.updateOne({ slug: role.slug }, { $set: role }, { upsert: true });
  }
}

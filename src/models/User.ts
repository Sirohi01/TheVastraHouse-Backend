import mongoose, { Schema, type InferSchemaType } from "mongoose";
import { addressSchema } from "./shared/address.js";
import { applySoftDeleteFields } from "./shared/softDelete.js";

const permissionOverrideSchema = new Schema(
  {
    module: { type: String, required: true, trim: true, lowercase: true },
    action: { type: String, required: true, trim: true, lowercase: true },
    effect: { type: String, enum: ["allow", "deny"], required: true },
  },
  { _id: false },
);

const userSchema = new Schema(
  {
    type: { type: String, enum: ["customer", "admin"], required: true, index: true },
    email: { type: String, required: true, lowercase: true, trim: true, unique: true },
    passwordHash: { type: String, required: true, select: false },
    firstName: { type: String, trim: true },
    lastName: { type: String, trim: true },
    phone: { type: String, trim: true },
    emailVerifiedAt: { type: Date },
    roleId: { type: Schema.Types.ObjectId, ref: "Role" },
    roleSlug: { type: String, trim: true, lowercase: true },
    customerType: { type: String, enum: ["retail", "wholesale"], default: "retail" },
    addresses: [addressSchema],
    permissionOverrides: [permissionOverrideSchema],
    failedLoginCount: { type: Number, default: 0 },
    lockedUntil: { type: Date },
    lastLoginAt: { type: Date },
    totpSecret: { type: String, select: false },
    totpEnabled: { type: Boolean, default: false },
    deactivatedAt: { type: Date },
  },
  { timestamps: true },
);

applySoftDeleteFields(userSchema);

userSchema.index({ type: 1, roleSlug: 1 });

export type UserDocument = InferSchemaType<typeof userSchema>;

export const User = mongoose.models.User || mongoose.model("User", userSchema);

import mongoose, { Schema, type InferSchemaType } from "mongoose";
import { addressBookEntrySchema } from "./shared/address.js";
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
    addresses: [addressBookEntrySchema],
    permissionOverrides: [permissionOverrideSchema],
    failedLoginCount: { type: Number, default: 0 },
    lockedUntil: { type: Date },
    lastLoginAt: { type: Date },
    totpSecret: { type: String, select: false },
    totpEnabled: { type: Boolean, default: false },
    whatsappOptIn: { type: Boolean, default: false },
    notificationPreferences: {
      orderUpdatesEmail: { type: Boolean, default: true },
      orderUpdatesWhatsapp: { type: Boolean, default: false },
      marketingEmail: { type: Boolean, default: false },
      marketingWhatsapp: { type: Boolean, default: false },
      backInStock: { type: Boolean, default: true },
      reviewRequests: { type: Boolean, default: true },
    },
    marketingConsentAt: { type: Date },
    cookieConsent: {
      analytics: { type: Boolean, default: false },
      marketing: { type: Boolean, default: false },
      updatedAt: { type: Date },
    },
    priceListCode: { type: String, trim: true, uppercase: true },
    wholesaleStatus: {
      type: String,
      enum: ["none", "pending", "approved", "rejected"],
      default: "none",
    },
    wholesaleProfile: {
      businessName: { type: String, trim: true },
      gstin: { type: String, trim: true, uppercase: true },
      contactPhone: { type: String, trim: true },
      notes: { type: String, trim: true },
      appliedAt: { type: Date },
      reviewedAt: { type: Date },
      reviewedBy: { type: Schema.Types.ObjectId, ref: "User" },
      paymentTerms: { type: String, enum: ["prepaid", "advance_50", "net_15", "net_30"] },
      creditLimit: { type: Number, min: 0 },
    },
    crm: {
      tags: [{ type: String, trim: true, lowercase: true }],
      notes: [
        {
          body: { type: String, required: true, trim: true },
          authorId: { type: Schema.Types.ObjectId, ref: "User" },
          createdAt: { type: Date, default: Date.now },
        },
      ],
      segment: { type: String, trim: true },
      orderCount: { type: Number, default: 0 },
      lastOrderAt: { type: Date },
      firstOrderAt: { type: Date },
      segmentComputedAt: { type: Date },
    },
    passwordChangedAt: { type: Date },
    deletionRequestedAt: { type: Date },
    anonymizedAt: { type: Date },
    storeCreditBalance: { type: Number, default: 0, min: 0 },
    rewardPointsBalance: { type: Number, default: 0, min: 0 },
    lifetimeOrderValue: { type: Number, default: 0, min: 0 },
    referralCode: { type: String, trim: true, uppercase: true, unique: true, sparse: true },
    deactivatedAt: { type: Date },
  },
  { timestamps: true },
);

applySoftDeleteFields(userSchema);

userSchema.index({ type: 1, roleSlug: 1 });

export type UserDocument = InferSchemaType<typeof userSchema>;

export const User = mongoose.models.User || mongoose.model("User", userSchema);

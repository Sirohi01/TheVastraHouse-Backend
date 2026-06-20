import mongoose, { Schema, type InferSchemaType } from "mongoose";

const roleSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, unique: true },
    slug: { type: String, required: true, trim: true, lowercase: true, unique: true },
    description: { type: String, trim: true },
    permissions: [
      {
        module: { type: String, required: true, trim: true, lowercase: true },
        action: { type: String, required: true, trim: true, lowercase: true },
      },
    ],
    systemRole: { type: Boolean, default: true },
    active: { type: Boolean, default: true, index: true },
  },
  { timestamps: true },
);

export type RoleDocument = InferSchemaType<typeof roleSchema>;

export const Role = mongoose.models.Role || mongoose.model("Role", roleSchema);

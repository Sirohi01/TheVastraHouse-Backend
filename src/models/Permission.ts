import mongoose, { Schema, type InferSchemaType } from "mongoose";

const permissionSchema = new Schema(
  {
    module: { type: String, required: true, trim: true, lowercase: true },
    action: { type: String, required: true, trim: true, lowercase: true },
    description: { type: String, trim: true },
  },
  { timestamps: true },
);

permissionSchema.index({ module: 1, action: 1 }, { unique: true });

export type PermissionDocument = InferSchemaType<typeof permissionSchema>;

export const Permission =
  mongoose.models.Permission || mongoose.model("Permission", permissionSchema);

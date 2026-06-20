import type { Schema } from "mongoose";

export type SoftDeleteFields = {
  status: "active" | "inactive" | "deleted";
  deletedAt?: Date;
};

export function applySoftDeleteFields(schema: Schema): void {
  schema.add({
    status: {
      type: String,
      enum: ["active", "inactive", "deleted"],
      default: "active",
      index: true,
    },
    deletedAt: { type: Date },
  });
}

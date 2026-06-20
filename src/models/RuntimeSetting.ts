import mongoose, { Schema, type InferSchemaType } from "mongoose";

const runtimeSettingSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, trim: true, uppercase: true },
    value: { type: String, required: true, trim: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

export type RuntimeSettingDocument = InferSchemaType<typeof runtimeSettingSchema>;

export const RuntimeSetting =
  mongoose.models.RuntimeSetting || mongoose.model("RuntimeSetting", runtimeSettingSchema);

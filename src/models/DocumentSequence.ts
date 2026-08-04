import mongoose, { Schema, type InferSchemaType } from "mongoose";

const documentSequenceSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, trim: true, index: true },
    value: { type: Number, required: true, min: 0, default: 0 },
  },
  { timestamps: true },
);

export type DocumentSequenceDocument = InferSchemaType<typeof documentSequenceSchema>;
export const DocumentSequence =
  mongoose.models.DocumentSequence || mongoose.model("DocumentSequence", documentSequenceSchema);

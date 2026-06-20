import mongoose, { Schema, type InferSchemaType } from "mongoose";
import { applySoftDeleteFields } from "./shared/softDelete.js";

const currencySchema = new Schema(
  {
    code: { type: String, required: true, uppercase: true, trim: true, minlength: 3, maxlength: 3 },
    symbol: { type: String, required: true, trim: true },
    decimalPrecision: { type: Number, required: true, min: 0, max: 4, default: 2 },
    active: { type: Boolean, default: true, index: true },
  },
  { timestamps: true },
);

applySoftDeleteFields(currencySchema);

currencySchema.index({ code: 1 }, { unique: true });

export type CurrencyDocument = InferSchemaType<typeof currencySchema>;

export const Currency = mongoose.models.Currency || mongoose.model("Currency", currencySchema);

import mongoose from "mongoose";
import { env } from "../config/env.js";
import { PaymentSettings } from "../models/PaymentSettings.js";
import { getRuntimeSetting } from "./runtimeSettingsService.js";

export type PaymentSettingsInput = {
  upiId: string;
  upiQrImageUrl?: string;
  bankAccountName?: string;
  bankAccountNumber?: string;
  bankIfsc?: string;
  bankName?: string;
  manualInstructions?: string;
  updatedBy?: string;
};

export async function getPaymentSettings() {
  const fallback = await fallbackPaymentSettingsWithOverrides();

  if (mongoose.connection.readyState === 0) {
    return fallback;
  }

  const settings = await PaymentSettings.findOne({ key: "default" }).lean();

  return {
    ...fallback,
    ...settings,
  };
}

export async function savePaymentSettings(input: PaymentSettingsInput) {
  return PaymentSettings.findOneAndUpdate(
    { key: "default" },
    {
      $set: {
        ...input,
        bankIfsc: input.bankIfsc?.toUpperCase(),
        key: "default",
      },
    },
    { new: true, upsert: true },
  );
}

async function fallbackPaymentSettingsWithOverrides() {
  return {
    bankAccountName: (await getRuntimeSetting("BANK_ACCOUNT_NAME")) ?? env.BANK_ACCOUNT_NAME,
    bankAccountNumber: (await getRuntimeSetting("BANK_ACCOUNT_NUMBER")) ?? env.BANK_ACCOUNT_NUMBER,
    bankIfsc: (await getRuntimeSetting("BANK_IFSC")) ?? env.BANK_IFSC,
    bankName: (await getRuntimeSetting("BANK_NAME")) ?? env.BANK_NAME,
    manualInstructions:
      (await getRuntimeSetting("MANUAL_PAYMENT_INSTRUCTIONS")) ?? env.MANUAL_PAYMENT_INSTRUCTIONS,
    upiId: (await getRuntimeSetting("UPI_PAYMENT_ADDRESS")) ?? env.UPI_PAYMENT_ADDRESS,
    upiQrImageUrl: (await getRuntimeSetting("UPI_QR_IMAGE_URL")) ?? env.UPI_QR_IMAGE_URL,
  };
}

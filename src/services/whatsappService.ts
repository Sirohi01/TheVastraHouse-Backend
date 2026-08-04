import { logger } from "../utils/logger.js";
import { env } from "../config/env.js";
import { getRuntimeSetting } from "./runtimeSettingsService.js";

export type WhatsappTemplate = {
  subject: string;
  text: string;
};

export async function sendWhatsappMessage(to: string, template: WhatsappTemplate) {
  if (!env.WHATSAPP_ENABLED) {
    logger.info({ subject: template.subject, to }, "WhatsApp is globally disabled; message skipped");
    return { skipped: true };
  }
  const settings = await whatsappSettings();

  if (!settings.phoneNumberId || !settings.accessToken) {
    logger.info({ subject: template.subject, to }, "WhatsApp is not configured; message skipped");
    return { skipped: true };
  }

  const url = `https://graph.facebook.com/${settings.apiVersion}/${settings.phoneNumberId}/messages`;
  const response = await fetch(url, {
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: normalizeWhatsappNumber(to),
      type: "text",
      text: { body: template.text },
    }),
    headers: {
      Authorization: `Bearer ${settings.accessToken}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`WhatsApp send failed (${response.status}): ${body}`);
  }

  return { skipped: false };
}

function normalizeWhatsappNumber(value: string) {
  return value.replace(/[^\d+]/g, "");
}

type WhatsappSettings = {
  phoneNumberId: string;
  accessToken: string;
  apiVersion: string;
};

async function whatsappSettings(): Promise<WhatsappSettings> {
  return {
    accessToken: (await getRuntimeSetting("WHATSAPP_ACCESS_TOKEN")) ?? "",
    apiVersion: (await getRuntimeSetting("WHATSAPP_API_VERSION")) ?? "v21.0",
    phoneNumberId: (await getRuntimeSetting("WHATSAPP_PHONE_NUMBER_ID")) ?? "",
  };
}

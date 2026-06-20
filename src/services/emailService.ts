import net from "node:net";
import tls from "node:tls";
import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";
import type { AuthEmailTemplate } from "./emailTemplateService.js";
import {
  getRuntimeBooleanSetting,
  getRuntimeNumberSetting,
  getRuntimeSetting,
} from "./runtimeSettingsService.js";

export async function sendEmail(to: string, template: AuthEmailTemplate) {
  const settings = await smtpSettings();

  if (!settings.host || !settings.fromEmail) {
    logger.info({ subject: template.subject, to }, "SMTP is not configured; email skipped");
    return { skipped: true };
  }

  const message = buildMimeMessage(to, template, settings);
  await sendSmtpMessage(to, message, settings);
  return { skipped: false };
}

async function sendSmtpMessage(to: string, message: string, settings: SmtpSettings) {
  let socket: net.Socket | tls.TLSSocket = settings.secure
    ? tls.connect(settings.port, settings.host)
    : net.connect(settings.port, settings.host);

  let read = createReader(socket);
  await read();
  await command(socket, read, `EHLO ${settings.host}`);

  if (!settings.secure) {
    await command(socket, read, "STARTTLS");
    socket = await upgradeToTls(socket, settings.host);
    read = createReader(socket);
    await command(socket, read, `EHLO ${settings.host}`);
  }

  if (settings.user && settings.pass) {
    await command(socket, read, "AUTH LOGIN");
    await command(socket, read, Buffer.from(settings.user).toString("base64"));
    await command(socket, read, Buffer.from(settings.pass).toString("base64"));
  }

  await command(socket, read, `MAIL FROM:<${settings.fromEmail}>`);
  await command(socket, read, `RCPT TO:<${to}>`);
  await command(socket, read, "DATA");
  await command(socket, read, `${message}\r\n.`);
  await command(socket, read, "QUIT");
}

function upgradeToTls(socket: net.Socket, host: string) {
  return new Promise<tls.TLSSocket>((resolve, reject) => {
    const secureSocket = tls.connect({ servername: host, socket }, () => {
      resolve(secureSocket);
    });
    secureSocket.once("error", reject);
  });
}

function buildMimeMessage(to: string, template: AuthEmailTemplate, settings: SmtpSettings) {
  const boundary = `vastra-${Date.now()}`;
  const fromName = encodeHeader(settings.fromName);

  return [
    `From: ${fromName} <${settings.fromEmail}>`,
    `To: <${to}>`,
    `Subject: ${encodeHeader(template.subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "",
    template.text,
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "",
    template.html ?? template.text.replace(/\n/g, "<br />"),
    `--${boundary}--`,
  ].join("\r\n");
}

function createReader(socket: net.Socket) {
  return () =>
    new Promise<string>((resolve, reject) => {
      socket.once("data", (data) => {
        const response = data.toString("utf8");
        if (/^[45]/.test(response)) {
          reject(new Error(response.trim()));
          return;
        }
        resolve(response);
      });
      socket.once("error", reject);
    });
}

async function command(socket: net.Socket, read: () => Promise<string>, value: string) {
  socket.write(`${value}\r\n`);
  return read();
}

function encodeHeader(value: string) {
  return `=?UTF-8?B?${Buffer.from(value).toString("base64")}?=`;
}

type SmtpSettings = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  fromEmail: string;
  fromName: string;
};

async function smtpSettings(): Promise<SmtpSettings> {
  return {
    fromEmail: (await getRuntimeSetting("SMTP_FROM_EMAIL")) ?? env.SMTP_FROM_EMAIL,
    fromName: (await getRuntimeSetting("SMTP_FROM_NAME")) ?? env.SMTP_FROM_NAME,
    host: (await getRuntimeSetting("SMTP_HOST")) ?? env.SMTP_HOST,
    pass: (await getRuntimeSetting("SMTP_PASS")) ?? env.SMTP_PASS,
    port: await getRuntimeNumberSetting("SMTP_PORT", env.SMTP_PORT),
    secure: await getRuntimeBooleanSetting("SMTP_SECURE", env.SMTP_SECURE),
    user: (await getRuntimeSetting("SMTP_USER")) ?? env.SMTP_USER,
  };
}

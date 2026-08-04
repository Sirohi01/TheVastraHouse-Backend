import { Types } from "mongoose";
import { env } from "../config/env.js";
import { NotificationJob } from "../models/NotificationJob.js";
import { NotificationLog } from "../models/NotificationLog.js";
import { NotificationTemplate } from "../models/NotificationTemplate.js";
import { logger } from "../utils/logger.js";
import { sendEmail } from "./emailService.js";
import { sendWhatsappMessage } from "./whatsappService.js";

export type NotificationChannel = "email" | "whatsapp";

export type NotificationFallback = {
  subject: string;
  text: string;
  html?: string;
};

export async function enqueueNotification(input: {
  eventType: string;
  channel: NotificationChannel;
  to?: string;
  variables: Record<string, string | undefined>;
  fallback: NotificationFallback;
  relatedEntity?: { type: string; id?: string };
}) {
  if (!input.to) {
    return null;
  }

  return NotificationJob.create({
    channel: input.channel,
    eventType: input.eventType,
    nextAttemptAt: new Date(),
    payload: { fallback: input.fallback, variables: input.variables },
    relatedEntity: input.relatedEntity
      ? {
          id: input.relatedEntity.id ? new Types.ObjectId(input.relatedEntity.id) : undefined,
          type: input.relatedEntity.type,
        }
      : undefined,
    status: "pending",
    to: input.to,
  });
}

export async function processNotificationQueue(limit = 20) {
  const now = new Date();
  const jobs = await NotificationJob.find({
    status: "pending",
    nextAttemptAt: { $lte: now },
  })
    .sort({ nextAttemptAt: 1 })
    .limit(limit);

  let sent = 0;
  let failed = 0;

  for (const job of jobs) {
    try {
      const rendered = await resolveTemplate(
        job.eventType,
        job.channel as NotificationChannel,
        job.payload as { fallback: NotificationFallback; variables: Record<string, string> },
      );

      if (job.channel === "email") {
        await sendEmail(job.to, {
          html: rendered.html,
          subject: rendered.subject,
          text: rendered.text,
        });
      } else {
        await sendWhatsappMessage(job.to, { subject: rendered.subject, text: rendered.text });
      }

      await NotificationLog.create({
        channel: job.channel,
        eventType: job.eventType,
        relatedEntity: job.relatedEntity,
        status: "sent",
        subject: rendered.subject,
        to: job.to,
      });
      job.status = "sent";
      await job.save();
      sent += 1;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      job.attempts += 1;
      job.lastError = errorMessage;

      if (job.attempts >= env.NOTIFICATION_MAX_ATTEMPTS) {
        job.status = "failed";
        await NotificationLog.create({
          channel: job.channel,
          error: errorMessage,
          eventType: job.eventType,
          relatedEntity: job.relatedEntity,
          status: "failed",
          to: job.to,
        });
      } else {
        job.nextAttemptAt = new Date(Date.now() + backoffMs(job.attempts));
      }

      await job.save();
      failed += 1;
      logger.warn(
        { error, eventType: job.eventType, jobId: job._id },
        "Notification dispatch attempt failed",
      );
    }
  }

  return { failed, processed: jobs.length, sent };
}

export function startNotificationDispatchJob() {
  const intervalMs = env.NOTIFICATION_DISPATCH_JOB_INTERVAL_SECONDS * 1000;
  const timer = setInterval(() => {
    void processNotificationQueue().catch((error) => {
      logger.warn({ error }, "Notification dispatch job failed");
    });
  }, intervalMs);

  timer.unref();
  return timer;
}

function backoffMs(attempts: number) {
  return Math.min(60_000 * 2 ** attempts, 30 * 60_000);
}

export async function resolveTemplate(
  eventType: string,
  channel: NotificationChannel,
  payload: { fallback: NotificationFallback; variables: Record<string, string> },
): Promise<NotificationFallback> {
  const template = (await NotificationTemplate.findOne({
    active: true,
    channel,
    eventType,
  }).lean()) as { subject?: string; body: string } | null;

  if (!template) {
    return payload.fallback;
  }

  return {
    subject: interpolate(template.subject ?? payload.fallback.subject, payload.variables),
    text: interpolate(template.body, payload.variables),
  };
}

function interpolate(template: string, variables: Record<string, string | undefined>) {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => variables[key] ?? "");
}

import assert from "node:assert/strict";
import test from "node:test";
import { Types } from "mongoose";
import { NotificationJob } from "../models/NotificationJob.js";
import { NotificationLog } from "../models/NotificationLog.js";
import { NotificationTemplate } from "../models/NotificationTemplate.js";
import {
  enqueueNotification,
  processNotificationQueue,
  resolveTemplate,
} from "./notificationDispatchService.js";

test("enqueueNotification stores the fallback template and variables as a pending job", async (t) => {
  const originalCreate = NotificationJob.create;
  const created: Array<Record<string, unknown>> = [];
  (NotificationJob as unknown as { create: unknown }).create = (
    payload: Record<string, unknown>,
  ) => {
    created.push(payload);
    return Promise.resolve(payload);
  };
  t.after(() => {
    (NotificationJob as unknown as { create: unknown }).create = originalCreate;
  });

  await enqueueNotification({
    channel: "email",
    eventType: "otp",
    fallback: { subject: "Your OTP", text: "Code is 123456" },
    to: "customer@vastrahouse.test",
    variables: { code: "123456" },
  });

  assert.equal(created.length, 1);
  assert.equal(created[0].status, "pending");
  assert.equal(created[0].to, "customer@vastrahouse.test");
  assert.deepEqual(created[0].payload, {
    fallback: { subject: "Your OTP", text: "Code is 123456" },
    variables: { code: "123456" },
  });
});

test("enqueueNotification skips silently when there is no recipient", async () => {
  const result = await enqueueNotification({
    channel: "email",
    eventType: "otp",
    fallback: { subject: "x", text: "x" },
    to: undefined,
    variables: {},
  });

  assert.equal(result, null);
});

test("enqueueNotification rejects reserved placeholder email domains", async () => {
  const result = await enqueueNotification({
    channel: "email",
    eventType: "order_confirmation",
    fallback: { subject: "x", text: "x" },
    to: "officialmanishsirohi.01@gmail.com",
    variables: {},
  });

  assert.equal(result, null);
});

test("resolveTemplate falls back to the hardcoded template when no admin override exists", async (t) => {
  const originalFindOne = NotificationTemplate.findOne;
  (NotificationTemplate as unknown as { findOne: unknown }).findOne = () => ({
    lean: () => Promise.resolve(null),
  });
  t.after(() => {
    (NotificationTemplate as unknown as { findOne: unknown }).findOne = originalFindOne;
  });

  const rendered = await resolveTemplate("otp", "email", {
    fallback: { subject: "Your OTP", text: "Code is 654321" },
    variables: { code: "654321" },
  });

  assert.deepEqual(rendered, { subject: "Your OTP", text: "Code is 654321" });
});

test("resolveTemplate interpolates an active admin-edited template over the fallback", async (t) => {
  const originalFindOne = NotificationTemplate.findOne;
  (NotificationTemplate as unknown as { findOne: unknown }).findOne = () => ({
    lean: () =>
      Promise.resolve({ body: "Hi {{name}}, your code is {{code}}", subject: "Code {{code}}" }),
  });
  t.after(() => {
    (NotificationTemplate as unknown as { findOne: unknown }).findOne = originalFindOne;
  });

  const rendered = await resolveTemplate("otp", "email", {
    fallback: { subject: "Your OTP", text: "Code is 654321" },
    variables: { code: "654321", name: "Ananya" },
  });

  assert.equal(rendered.subject, "Code 654321");
  assert.equal(rendered.text, "Hi Ananya, your code is 654321");
});

test("processNotificationQueue marks a job sent and writes a notification log entry", async (t) => {
  const ctx = patchQueueModels();
  t.after(ctx.restore);

  ctx.jobs.push(
    buildJob({
      channel: "email",
      eventType: "otp",
      payload: { fallback: { subject: "Your OTP", text: "Code is 111222" }, variables: {} },
      to: "customer@vastrahouse.test",
    }),
  );

  const result = await processNotificationQueue();

  assert.equal(result.processed, 1);
  assert.equal(result.sent, 1);
  assert.equal(ctx.jobs[0].status, "sent");
  assert.equal(ctx.logs.length, 1);
  assert.equal(ctx.logs[0].status, "sent");
  assert.equal(ctx.logs[0].eventType, "otp");
});

test("processNotificationQueue retries on failure and marks failed after max attempts", async (t) => {
  const ctx = patchQueueModels({ failLogWrites: true });
  t.after(ctx.restore);

  const job = buildJob({
    channel: "email",
    eventType: "order_confirmation",
    payload: { fallback: { subject: "Order confirmed", text: "Thanks" }, variables: {} },
    to: "customer@vastrahouse.test",
  });
  ctx.jobs.push(job);

  await processNotificationQueue();
  assert.equal(job.status, "pending");
  assert.equal(job.attempts, 1);
  assert.ok(job.nextAttemptAt.getTime() > Date.now());

  job.attempts = 4;
  job.nextAttemptAt = new Date();
  await processNotificationQueue();

  assert.equal(job.status, "failed");
  assert.equal(job.attempts, 5);
});

function buildJob(input: {
  channel: "email" | "whatsapp";
  eventType: string;
  payload: unknown;
  to: string;
}) {
  const job: Record<string, unknown> & { save: () => Promise<unknown> } = {
    _id: new Types.ObjectId(),
    attempts: 0,
    channel: input.channel,
    eventType: input.eventType,
    nextAttemptAt: new Date(Date.now() - 1000),
    payload: input.payload,
    status: "pending",
    to: input.to,
    save: async () => job,
  };
  return job as unknown as {
    attempts: number;
    channel: string;
    eventType: string;
    lastError?: string;
    nextAttemptAt: Date;
    status: string;
    to: string;
    save: () => Promise<unknown>;
  };
}

function patchQueueModels(options: { failLogWrites?: boolean } = {}) {
  const originalFind = NotificationJob.find;
  const originalTemplateFindOne = NotificationTemplate.findOne;
  const originalLogCreate = NotificationLog.create;
  const jobs: Array<ReturnType<typeof buildJob>> = [];
  const logs: Array<Record<string, unknown>> = [];

  (NotificationJob as unknown as { find: unknown }).find = () => ({
    limit() {
      return this;
    },
    sort() {
      return this;
    },
    then(resolve: (value: unknown[]) => void) {
      resolve(jobs);
    },
  });
  (NotificationTemplate as unknown as { findOne: unknown }).findOne = () => ({
    lean: () => Promise.resolve(null),
  });
  (NotificationLog as unknown as { create: unknown }).create = (
    payload: Record<string, unknown>,
  ) => {
    if (options.failLogWrites && payload.status === "sent") {
      return Promise.reject(new Error("simulated log write failure"));
    }

    logs.push(payload);
    return Promise.resolve(payload);
  };

  return {
    jobs,
    logs,
    restore() {
      (NotificationJob as unknown as { find: unknown }).find = originalFind;
      (NotificationTemplate as unknown as { findOne: unknown }).findOne = originalTemplateFindOne;
      (NotificationLog as unknown as { create: unknown }).create = originalLogCreate;
    },
  };
}

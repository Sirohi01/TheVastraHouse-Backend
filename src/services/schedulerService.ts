import crypto from "node:crypto";
import os from "node:os";
import mongoose from "mongoose";
import { env } from "../config/env.js";
import { JobLock } from "../models/JobLock.js";
import { logger } from "../utils/logger.js";

/**
 * Durable job scheduling. Every job runs under a MongoDB lease so exactly one API instance
 * executes it at a time, run history/failures are persisted for monitoring, and jobs can also be
 * triggered by an external cron (POST /api/v1/system/jobs/:name/run with CRON_SECRET) so they
 * keep running even when an idle web instance is asleep.
 */
export type JobDefinition = {
  name: string;
  intervalMs: number;
  run: () => Promise<unknown>;
  description: string;
};

const owner = `${os.hostname()}:${process.pid}:${crypto.randomBytes(3).toString("hex")}`;
const registry = new Map<string, JobDefinition>();
const timers: NodeJS.Timeout[] = [];

export function registerJob(definition: JobDefinition) {
  registry.set(definition.name, definition);
}

export function listRegisteredJobs() {
  return [...registry.values()].map(({ description, intervalMs, name }) => ({
    description,
    intervalMs,
    name,
  }));
}

async function acquireLease(name: string, ttlMs: number) {
  const now = new Date();

  try {
    const lock = await JobLock.findOneAndUpdate(
      { name, $or: [{ lockedUntil: { $lte: now } }, { owner }] },
      {
        $inc: { runCount: 1 },
        $set: { lastStartedAt: now, lockedUntil: new Date(now.getTime() + ttlMs), owner },
        $setOnInsert: { name },
      },
      { new: true, upsert: true },
    );
    return Boolean(lock);
  } catch (error) {
    // Duplicate key = another instance holds a live lease.
    if ((error as { code?: number }).code === 11000) return false;
    throw error;
  }
}

/** Runs a job once if its lease is free. Returns the job result or null when skipped. */
export async function runJobOnce(name: string) {
  const job = registry.get(name);
  if (!job) throw new Error(`Unknown job ${name}`);

  if (mongoose.connection.readyState !== 1) {
    return { skipped: "database unavailable" };
  }

  const ttlMs = Math.max(job.intervalMs, env.JOB_LOCK_TTL_SECONDS * 1000);
  if (!(await acquireLease(name, ttlMs))) {
    return { skipped: "running on another instance" };
  }

  const started = Date.now();
  try {
    const result = await job.run();
    await JobLock.updateOne(
      { name, owner },
      {
        $set: {
          lastDurationMs: Date.now() - started,
          lastFinishedAt: new Date(),
          lastResult: summarise(result),
          // Release early so the next tick (or external cron) can run on schedule.
          lockedUntil: new Date(started + Math.min(job.intervalMs, ttlMs) - 1000),
        },
      },
    );
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ error, job: name }, "Scheduled job failed");
    await JobLock.updateOne(
      { name, owner },
      {
        $inc: { failureCount: 1 },
        $set: {
          lastDurationMs: Date.now() - started,
          lastError: message.slice(0, 500),
          lastErrorAt: new Date(),
          lockedUntil: new Date(),
        },
      },
    );
    throw error;
  }
}

export function startScheduler() {
  for (const job of registry.values()) {
    const tick = () => {
      void runJobOnce(job.name).catch(() => undefined);
    };
    // Stagger first runs so boot is not a thundering herd.
    const initial = setTimeout(tick, 5_000 + Math.floor(Math.random() * 20_000));
    initial.unref();
    const timer = setInterval(tick, job.intervalMs);
    timer.unref();
    timers.push(initial, timer);
  }
  logger.info({ jobs: registry.size, owner }, "Scheduler started");
}

export function stopScheduler() {
  for (const timer of timers) clearInterval(timer);
  timers.length = 0;
}

export async function getJobStatuses() {
  const locks = (await JobLock.find({}).lean()) as unknown as Array<
    Record<string, unknown> & { name: string }
  >;
  return listRegisteredJobs().map((job) => {
    const lock = locks.find((item) => item.name === job.name);
    const lastFinishedAt = lock?.lastFinishedAt as Date | undefined;
    const overdue = lastFinishedAt
      ? Date.now() - new Date(lastFinishedAt).getTime() > job.intervalMs * 3
      : true;
    return {
      ...job,
      failureCount: lock?.failureCount ?? 0,
      healthy:
        !lock?.lastErrorAt ||
        (lastFinishedAt !== undefined &&
          new Date(lastFinishedAt) > new Date(lock.lastErrorAt as Date)),
      lastDurationMs: lock?.lastDurationMs,
      lastError: lock?.lastError,
      lastErrorAt: lock?.lastErrorAt,
      lastFinishedAt,
      lastResult: lock?.lastResult,
      lastStartedAt: lock?.lastStartedAt,
      overdue,
      runCount: lock?.runCount ?? 0,
    };
  });
}

export function verifyCronSecret(provided: string | undefined) {
  if (!env.CRON_SECRET || !provided) return false;
  const a = Buffer.from(env.CRON_SECRET);
  const b = Buffer.from(provided);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function summarise(result: unknown) {
  if (result === undefined || result === null) return null;
  try {
    const text = JSON.stringify(result);
    return text.length > 1000 ? { truncated: text.slice(0, 1000) } : result;
  } catch {
    return String(result);
  }
}

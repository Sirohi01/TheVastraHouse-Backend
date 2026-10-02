import { Router } from "express";
import { z } from "zod";
import { attachOptionalUser } from "../middleware/authMiddleware.js";
import { emailIdentity, rateLimit } from "../middleware/rateLimit.js";
import { validateRequest } from "../middleware/validateRequest.js";
import { ticketCategories } from "../models/SupportTicket.js";
import { SiteVisitDaily } from "../models/SiteVisitDaily.js";
import {
  subscribeBackInStock,
  subscribeNewsletter,
  unsubscribeByToken,
} from "../services/engagementService.js";
import { getActiveCampaignBanner } from "../services/marketingService.js";
import { createTicketFromContactForm } from "../services/supportService.js";

export const engagementRouter = Router();
engagementRouter.use(attachOptionalUser);

const objectId = z.string().regex(/^[a-f\d]{24}$/i);
const email = z.string().trim().email().max(254);

engagementRouter.post(
  "/newsletter",
  rateLimit({ identify: emailIdentity, keyPrefix: "newsletter", max: 5, windowMs: 60 * 60 * 1000 }),
  validateRequest({
    body: z
      .object({
        email,
        consent: z.literal(true, { errorMap: () => ({ message: "Please tick the consent box" }) }),
        source: z.string().trim().max(40).optional(),
      })
      .strict(),
  }),
  async (req, res, next) => {
    try {
      res.status(201).json(
        await subscribeNewsletter({
          consent: req.body.consent,
          email: req.body.email,
          ipAddress: req.ip,
          source: req.body.source,
          userId: req.user?.type === "customer" ? req.user.id : undefined,
        }),
      );
    } catch (error) {
      next(error);
    }
  },
);

engagementRouter.post(
  "/unsubscribe",
  rateLimit({ keyPrefix: "unsubscribe", max: 30, windowMs: 60 * 60 * 1000 }),
  validateRequest({ body: z.object({ token: z.string().min(10).max(200) }).strict() }),
  async (req, res, next) => {
    try {
      res.json(await unsubscribeByToken(req.body.token));
    } catch (error) {
      next(error);
    }
  },
);

engagementRouter.post(
  "/back-in-stock",
  rateLimit({
    identify: emailIdentity,
    keyPrefix: "back-in-stock",
    max: 20,
    windowMs: 60 * 60 * 1000,
  }),
  validateRequest({ body: z.object({ email, productId: objectId, variantId: objectId }).strict() }),
  async (req, res, next) => {
    try {
      res.status(201).json(
        await subscribeBackInStock({
          ...req.body,
          userId: req.user?.type === "customer" ? req.user.id : undefined,
        }),
      );
    } catch (error) {
      next(error);
    }
  },
);

engagementRouter.post(
  "/contact",
  rateLimit({ identify: emailIdentity, keyPrefix: "contact", max: 5, windowMs: 60 * 60 * 1000 }),
  validateRequest({
    body: z
      .object({
        name: z.string().trim().min(2).max(120),
        email,
        phone: z
          .string()
          .trim()
          .regex(/^\+?[0-9\s-]{8,16}$/, "Enter a valid phone number")
          .optional()
          .or(z.literal("")),
        category: z.enum(ticketCategories).default("other"),
        subject: z.string().trim().min(3).max(200),
        message: z.string().trim().min(10, "Please add a little more detail").max(5000),
        orderNumber: z.string().trim().max(80).optional().or(z.literal("")),
        // Honeypot: real users never fill this hidden field.
        website: z.string().max(0).optional().or(z.literal("")),
      })
      .strict(),
  }),
  async (req, res, next) => {
    try {
      const result = await createTicketFromContactForm({
        category: req.body.category,
        email: req.body.email,
        ipAddress: req.ip,
        message: req.body.message,
        name: req.body.name,
        orderNumber: req.body.orderNumber || undefined,
        phone: req.body.phone || undefined,
        subject: req.body.subject,
        userId: req.user?.type === "customer" ? req.user.id : undefined,
      });
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  },
);

/** Session beacon: one call per browser session feeds aggregate traffic/conversion stats. */
engagementRouter.post(
  "/visit",
  rateLimit({ keyPrefix: "visit", max: 60, windowMs: 60 * 60 * 1000 }),
  validateRequest({
    body: z
      .object({
        source: z.string().trim().max(60).optional(),
        medium: z.string().trim().max(60).optional(),
        referrerHost: z.string().trim().max(120).optional(),
      })
      .strict(),
  }),
  async (req, res, next) => {
    try {
      const source = normaliseSource(req.body.source, req.body.referrerHost);
      const date = new Date().toISOString().slice(0, 10);
      await SiteVisitDaily.updateOne(
        {
          date,
          medium: (req.body.medium || (source === "direct" ? "none" : "referral")).toLowerCase(),
          source,
        },
        { $inc: { sessions: 1 } },
        { upsert: true },
      );
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  },
);

function normaliseSource(source?: string, referrerHost?: string) {
  if (source)
    return (
      source
        .toLowerCase()
        .replace(/[^a-z0-9_.-]/g, "")
        .slice(0, 40) || "direct"
    );
  if (!referrerHost) return "direct";
  const host = referrerHost.toLowerCase().replace(/^www\./, "");
  if (/google\./.test(host)) return "google";
  if (/bing\./.test(host)) return "bing";
  if (/instagram|facebook|fb\./.test(host)) return "social";
  return host.slice(0, 40);
}

engagementRouter.get("/banner", async (_req, res, next) => {
  try {
    res.json({ banner: await getActiveCampaignBanner() });
  } catch (error) {
    next(error);
  }
});

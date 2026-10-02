import { Router } from "express";
import { z } from "zod";
import { requireAuth, requirePermission } from "../middleware/authMiddleware.js";
import { AppError } from "../middleware/errorHandler.js";
import { validateRequest } from "../middleware/validateRequest.js";
import { Coupon, CouponRedemption } from "../models/Coupon.js";
import { writeAuditLog } from "../services/auditLogService.js";
import {
  deleteCustomSegment,
  listCustomSegments,
  previewCustomSegment,
  saveCustomSegment,
} from "../services/crmService.js";
import {
  exportNewsletterCsv,
  listBackInStockDemand,
  listNewsletterSubscribers,
} from "../services/engagementService.js";
import {
  cancelCampaign,
  createCampaign,
  getAutomationSettings,
  listCampaigns,
  previewCampaignAudience,
  sendCampaign,
  updateAutomationSetting,
  updateCampaign,
} from "../services/marketingService.js";
import { buildPaginatedResult, parsePagination } from "../utils/pagination.js";

export const marketingRouter = Router();
marketingRouter.use(requireAuth);

const manage = requirePermission({ module: "marketing", action: "manage" });
const read = requirePermission({ module: "marketing", action: "read" });
const objectId = z.string().regex(/^[a-f\d]{24}$/i);
const idParams = z.object({ id: objectId }).strict();

// ---------------- Coupons ----------------

const couponSchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(3)
      .max(30)
      .regex(/^[A-Za-z0-9_-]+$/, "Use letters, numbers, dash or underscore"),
    description: z.string().trim().max(300).optional(),
    type: z.enum(["percentage", "fixed", "free_shipping"]),
    value: z.coerce.number().min(0).default(0),
    minCartValue: z.coerce.number().min(0).default(0),
    maxDiscount: z.coerce.number().min(0).optional().nullable(),
    startsAt: z.coerce.date().optional().nullable(),
    endsAt: z.coerce.date().optional().nullable(),
    active: z.boolean().default(true),
    usageLimit: z.coerce.number().int().min(1).optional().nullable(),
    perUserLimit: z.coerce.number().int().min(0).default(1),
    applicableProductIds: z.array(objectId).default([]),
    applicableCategoryIds: z.array(objectId).default([]),
    excludedProductIds: z.array(objectId).default([]),
    excludedCategoryIds: z.array(objectId).default([]),
    firstOrderOnly: z.boolean().default(false),
    allowedUserIds: z.array(objectId).default([]),
    combinableWithStoreCredit: z.boolean().default(true),
    combinableWithRewards: z.boolean().default(true),
    combinableWithGiftCards: z.boolean().default(true),
  })
  .strict()
  .refine((value) => value.type !== "percentage" || (value.value > 0 && value.value <= 100), {
    message: "Percentage coupons need a value between 1 and 100",
  })
  .refine((value) => value.type !== "fixed" || value.value > 0, {
    message: "Fixed coupons need an amount",
  })
  .refine((value) => !value.startsAt || !value.endsAt || value.startsAt < value.endsAt, {
    message: "End date must be after the start date",
  });

marketingRouter.get("/coupons", read, async (req, res, next) => {
  try {
    const pagination = parsePagination(req.query);
    const query: Record<string, unknown> = { status: { $ne: "deleted" } };
    if (typeof req.query.search === "string" && req.query.search) {
      query.code = {
        $options: "i",
        $regex: req.query.search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      };
    }
    const [items, total] = await Promise.all([
      Coupon.find(query)
        .sort({ createdAt: -1 })
        .skip(pagination.skip)
        .limit(pagination.limit)
        .lean(),
      Coupon.countDocuments(query),
    ]);
    res.json(buildPaginatedResult(items, total, pagination));
  } catch (error) {
    next(error);
  }
});

marketingRouter.get(
  "/coupons/:id/redemptions",
  read,
  validateRequest({ params: idParams }),
  async (req, res, next) => {
    try {
      res.json({
        redemptions: await CouponRedemption.find({ couponId: req.params.id })
          .sort({ createdAt: -1 })
          .limit(200)
          .lean(),
      });
    } catch (error) {
      next(error);
    }
  },
);

marketingRouter.post(
  "/coupons",
  manage,
  validateRequest({ body: couponSchema }),
  async (req, res, next) => {
    try {
      const code = req.body.code.toUpperCase();
      if (await Coupon.exists({ code })) throw new AppError(`Coupon ${code} already exists`, 409);
      const coupon = await Coupon.create({ ...req.body, code, createdBy: req.user!.id });
      await writeAuditLog({
        action: "create",
        actor: { actorId: req.user!.id as never, actorType: "admin" },
        after: coupon.toObject(),
        entity: { displayId: code, id: coupon._id, type: "coupon" },
      });
      res.status(201).json({ coupon });
    } catch (error) {
      next(error);
    }
  },
);

marketingRouter.patch(
  "/coupons/:id",
  manage,
  validateRequest({ params: idParams, body: couponSchema }),
  async (req, res, next) => {
    try {
      const code = req.body.code.toUpperCase();
      if (await Coupon.exists({ _id: { $ne: req.params.id }, code })) {
        throw new AppError(`Coupon ${code} already exists`, 409);
      }
      const before = await Coupon.findById(req.params.id).lean();
      const coupon = await Coupon.findByIdAndUpdate(
        req.params.id,
        { $set: { ...req.body, code } },
        { new: true, runValidators: true },
      );
      if (!coupon) throw new AppError("Coupon not found", 404);
      await writeAuditLog({
        action: "update",
        actor: { actorId: req.user!.id as never, actorType: "admin" },
        after: coupon.toObject(),
        before,
        entity: { displayId: code, id: coupon._id, type: "coupon" },
      });
      res.json({ coupon });
    } catch (error) {
      next(error);
    }
  },
);

marketingRouter.delete(
  "/coupons/:id",
  manage,
  validateRequest({ params: idParams }),
  async (req, res, next) => {
    try {
      const coupon = await Coupon.findByIdAndUpdate(
        req.params.id,
        { $set: { active: false, deletedAt: new Date(), status: "deleted" } },
        { new: true },
      );
      if (!coupon) throw new AppError("Coupon not found", 404);
      res.json({ deleted: true });
    } catch (error) {
      next(error);
    }
  },
);

// ---------------- Campaigns ----------------

const campaignSchema = z
  .object({
    name: z.string().trim().min(3).max(120),
    kind: z.enum(["newsletter", "festival", "segment"]),
    subject: z.string().trim().min(3).max(200),
    previewText: z.string().trim().max(200).optional(),
    bodyHtml: z.string().min(10).max(200_000),
    audience: z
      .object({
        type: z.enum(["segment", "newsletter", "all_consented", "custom_segment"]),
        segment: z.enum(["new", "repeat", "vip", "wholesale", "inactive"]).optional(),
        customSegmentId: objectId.optional(),
      })
      .strict(),
    couponId: objectId.nullable().optional(),
    banner: z
      .object({
        enabled: z.boolean().default(false),
        title: z.string().trim().max(120).optional(),
        text: z.string().trim().max(300).optional(),
        href: z
          .string()
          .trim()
          .regex(/^\/[^\s]*$/, "Banner links must be site paths")
          .optional(),
        media: z.record(z.unknown()).optional(),
      })
      .strict()
      .optional(),
    startsAt: z.coerce.date().optional(),
    endsAt: z.coerce.date().optional(),
    scheduledAt: z.coerce.date().optional().nullable(),
    utmCampaign: z.string().trim().max(60).optional(),
  })
  .strict();

marketingRouter.get("/campaigns", read, async (_req, res, next) => {
  try {
    res.json({ campaigns: await listCampaigns() });
  } catch (error) {
    next(error);
  }
});

marketingRouter.post(
  "/campaigns",
  manage,
  validateRequest({ body: campaignSchema }),
  async (req, res, next) => {
    try {
      res.status(201).json({ campaign: await createCampaign(req.body, req.user!.id) });
    } catch (error) {
      next(error);
    }
  },
);

marketingRouter.patch(
  "/campaigns/:id",
  manage,
  validateRequest({ params: idParams, body: campaignSchema.partial() }),
  async (req, res, next) => {
    try {
      res.json({ campaign: await updateCampaign(String(req.params.id), req.body) });
    } catch (error) {
      next(error);
    }
  },
);

marketingRouter.get(
  "/campaigns/:id/audience",
  read,
  validateRequest({ params: idParams }),
  async (req, res, next) => {
    try {
      res.json(await previewCampaignAudience(String(req.params.id)));
    } catch (error) {
      next(error);
    }
  },
);

marketingRouter.post(
  "/campaigns/:id/send",
  manage,
  validateRequest({ params: idParams }),
  async (req, res, next) => {
    try {
      res.json({ campaign: await sendCampaign(String(req.params.id)) });
    } catch (error) {
      next(error);
    }
  },
);

marketingRouter.post(
  "/campaigns/:id/cancel",
  manage,
  validateRequest({ params: idParams }),
  async (req, res, next) => {
    try {
      res.json({ campaign: await cancelCampaign(String(req.params.id)) });
    } catch (error) {
      next(error);
    }
  },
);

// ---------------- Automations ----------------

marketingRouter.get("/automations", read, async (_req, res, next) => {
  try {
    res.json({ automations: await getAutomationSettings() });
  } catch (error) {
    next(error);
  }
});

marketingRouter.patch(
  "/automations/:key",
  manage,
  validateRequest({
    params: z
      .object({
        key: z.enum(["abandoned_cart", "win_back", "review_request", "welcome", "back_in_stock"]),
      })
      .strict(),
    body: z
      .object({
        enabled: z.boolean().optional(),
        delayHours: z.coerce
          .number()
          .min(0)
          .max(24 * 60)
          .optional(),
        couponCode: z.string().trim().max(30).nullable().optional(),
      })
      .strict(),
  }),
  async (req, res, next) => {
    try {
      res.json({
        automation: await updateAutomationSetting(
          req.params.key as
            | "abandoned_cart"
            | "win_back"
            | "review_request"
            | "welcome"
            | "back_in_stock",
          req.body,
        ),
      });
    } catch (error) {
      next(error);
    }
  },
);

// ---------------- Custom segments ----------------

const rulesSchema = z
  .object({
    minOrders: z.coerce.number().int().min(0).optional(),
    maxOrders: z.coerce.number().int().min(0).optional(),
    minSpend: z.coerce.number().min(0).optional(),
    maxSpend: z.coerce.number().min(0).optional(),
    lastOrderWithinDays: z.coerce.number().int().min(1).optional(),
    noOrderForDays: z.coerce.number().int().min(1).optional(),
    customerType: z.enum(["retail", "wholesale"]).optional(),
    tags: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
    marketingConsentOnly: z.boolean().default(true),
  })
  .strict();

marketingRouter.get("/segments", read, async (_req, res, next) => {
  try {
    res.json({ segments: await listCustomSegments() });
  } catch (error) {
    next(error);
  }
});

marketingRouter.post(
  "/segments/preview",
  read,
  validateRequest({ body: z.object({ rules: rulesSchema }).strict() }),
  async (req, res, next) => {
    try {
      res.json(await previewCustomSegment(req.body.rules));
    } catch (error) {
      next(error);
    }
  },
);

marketingRouter.post(
  "/segments",
  manage,
  validateRequest({
    body: z
      .object({
        name: z.string().trim().min(2).max(80),
        description: z.string().trim().max(300).optional(),
        rules: rulesSchema,
      })
      .strict(),
  }),
  async (req, res, next) => {
    try {
      res.status(201).json({ segment: await saveCustomSegment(req.body, req.user!.id) });
    } catch (error) {
      next(error);
    }
  },
);

marketingRouter.delete(
  "/segments/:id",
  manage,
  validateRequest({ params: idParams }),
  async (req, res, next) => {
    try {
      await deleteCustomSegment(String(req.params.id));
      res.json({ deleted: true });
    } catch (error) {
      next(error);
    }
  },
);

// ---------------- Newsletter & demand ----------------

marketingRouter.get("/newsletter", read, async (req, res, next) => {
  try {
    res.json(
      await listNewsletterSubscribers(
        {
          search: typeof req.query.search === "string" ? req.query.search : undefined,
          status: typeof req.query.status === "string" ? req.query.status : undefined,
        },
        parsePagination(req.query),
      ),
    );
  } catch (error) {
    next(error);
  }
});

marketingRouter.get("/newsletter/export.csv", manage, async (req, res, next) => {
  try {
    const csv = await exportNewsletterCsv();
    await writeAuditLog({
      action: "export",
      actor: { actorId: req.user!.id as never, actorType: "admin" },
      after: { rows: csv.split("\n").length - 1 },
      entity: { displayId: "newsletter", id: req.user!.id as never, type: "newsletter-export" },
    });
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="newsletter-subscribers.csv"`);
    res.send(csv);
  } catch (error) {
    next(error);
  }
});

marketingRouter.get("/back-in-stock", read, async (_req, res, next) => {
  try {
    res.json({ demand: await listBackInStockDemand() });
  } catch (error) {
    next(error);
  }
});

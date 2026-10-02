import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/authMiddleware.js";
import { AppError } from "../middleware/errorHandler.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { validateRequest } from "../middleware/validateRequest.js";
import { User } from "../models/User.js";
import {
  addAddress,
  deleteAddress,
  listAddresses,
  updateAddress,
} from "../services/addressService.js";
import { listUserGiftCards, startGiftCardPurchase } from "../services/giftCardService.js";
import { getLoyaltyTier } from "../services/loyaltyTierService.js";
import {
  downloadExport,
  listOwnPrivacyRequests,
  requestAccountDeletion,
  requestDataExport,
} from "../services/privacyService.js";
import { getOrCreateReferralCode } from "../services/referralService.js";
import { listRewardPointsHistory } from "../services/rewardPointsService.js";
import { listStoreCreditHistory } from "../services/storeCreditService.js";
import {
  createTicketFromContactForm,
  getTicket,
  listCustomerTickets,
  replyToTicket,
} from "../services/supportService.js";
import { applyForWholesale } from "../services/wholesaleService.js";
import { env } from "../config/env.js";

export const accountRouter = Router();
accountRouter.use(requireAuth);
accountRouter.use((req, _res, next) => {
  // Customer self-service only; staff accounts use the admin console.
  if (req.user?.type !== "customer") {
    next(new AppError("This area is for customer accounts", 403));
    return;
  }
  next();
});

const objectId = z.string().regex(/^[a-f\d]{24}$/i);
const addressSchema = z
  .object({
    label: z.string().trim().max(40).optional(),
    fullName: z.string().trim().min(2).max(120),
    company: z.string().trim().max(120).optional(),
    line1: z.string().trim().min(3).max(180),
    line2: z.string().trim().max(180).optional(),
    city: z.string().trim().min(2).max(100),
    region: z.string().trim().min(2).max(100),
    postalCode: z.string().trim().min(3).max(12),
    countryCode: z.string().trim().length(2).default("IN"),
    phone: z
      .string()
      .trim()
      .regex(/^\+?[0-9\s-]{8,16}$/, "Enter a valid phone number"),
    isDefaultShipping: z.boolean().optional(),
    isDefaultBilling: z.boolean().optional(),
  })
  .strict();

accountRouter.get("/overview", async (req, res, next) => {
  try {
    const user = (await User.findById(req.user!.id)
      .select(
        "email firstName lastName phone rewardPointsBalance storeCreditBalance lifetimeOrderValue customerType wholesaleStatus crm.orderCount createdAt emailVerifiedAt",
      )
      .lean()) as unknown as (Record<string, unknown> & { email: string }) | null;
    if (!user) throw new AppError("User not found", 404);

    const [tier, giftCards, addresses] = await Promise.all([
      getLoyaltyTier(req.user!.id),
      listUserGiftCards(req.user!.id, user.email),
      listAddresses(req.user!.id),
    ]);

    res.json({
      addressesCount: addresses.length,
      customer: user,
      giftCardBalance: (
        giftCards as unknown as Array<{ status: string; balance: number; recipientEmail?: string }>
      )
        .filter(
          (card) =>
            card.status === "active" &&
            (!card.recipientEmail || card.recipientEmail === user.email),
        )
        .reduce((total, card) => total + card.balance, 0),
      tier,
    });
  } catch (error) {
    next(error);
  }
});

// ---------- Address book ----------
accountRouter.get("/addresses", async (req, res, next) => {
  try {
    res.json({ addresses: await listAddresses(req.user!.id) });
  } catch (error) {
    next(error);
  }
});

accountRouter.post(
  "/addresses",
  validateRequest({ body: addressSchema }),
  async (req, res, next) => {
    try {
      res.status(201).json({ addresses: await addAddress(req.user!.id, req.body) });
    } catch (error) {
      next(error);
    }
  },
);

accountRouter.patch(
  "/addresses/:id",
  validateRequest({ params: z.object({ id: objectId }).strict(), body: addressSchema }),
  async (req, res, next) => {
    try {
      res.json({ addresses: await updateAddress(req.user!.id, String(req.params.id), req.body) });
    } catch (error) {
      next(error);
    }
  },
);

accountRouter.delete(
  "/addresses/:id",
  validateRequest({ params: z.object({ id: objectId }).strict() }),
  async (req, res, next) => {
    try {
      res.json({ addresses: await deleteAddress(req.user!.id, String(req.params.id)) });
    } catch (error) {
      next(error);
    }
  },
);

// ---------- Loyalty, credit, gift cards, referrals ----------
accountRouter.get("/rewards", async (req, res, next) => {
  try {
    const user = (await User.findById(req.user!.id)
      .select("email rewardPointsBalance storeCreditBalance")
      .lean()) as unknown as {
      email: string;
      rewardPointsBalance?: number;
      storeCreditBalance?: number;
    } | null;
    if (!user) throw new AppError("User not found", 404);

    const [pointsHistory, creditHistory, giftCards, tier, referralCode] = await Promise.all([
      listRewardPointsHistory(req.user!.id),
      listStoreCreditHistory(req.user!.id),
      listUserGiftCards(req.user!.id, user.email),
      getLoyaltyTier(req.user!.id),
      getOrCreateReferralCode(req.user!.id),
    ]);

    res.json({
      creditHistory,
      giftCards,
      pointsHistory,
      referral: {
        code: referralCode,
        link: `${env.FRONTEND_PUBLIC_URL.replace(/\/$/, "")}/register?ref=${referralCode}`,
        rewardAmount: env.REFERRAL_REWARD_AMOUNT,
      },
      rewardPoints: user.rewardPointsBalance ?? 0,
      storeCredit: user.storeCreditBalance ?? 0,
      tier,
    });
  } catch (error) {
    next(error);
  }
});

accountRouter.post(
  "/gift-cards/purchase",
  rateLimit({ keyPrefix: "gift-card-purchase", max: 10, windowMs: 60 * 60 * 1000 }),
  validateRequest({
    body: z
      .object({
        amount: z.coerce.number().int().min(500).max(50_000),
        recipientEmail: z.string().trim().email(),
        recipientName: z.string().trim().max(80).optional(),
        message: z.string().trim().max(300).optional(),
      })
      .strict(),
  }),
  async (req, res, next) => {
    try {
      const user = (await User.findById(req.user!.id).select("email").lean()) as unknown as {
        email: string;
      } | null;
      if (!user) throw new AppError("User not found", 404);
      res.status(201).json(
        await startGiftCardPurchase({
          ...req.body,
          purchaserEmail: user.email,
          userId: req.user!.id,
        }),
      );
    } catch (error) {
      next(error);
    }
  },
);

// ---------- Wholesale ----------
accountRouter.post(
  "/wholesale/apply",
  rateLimit({ keyPrefix: "wholesale-apply", max: 5, windowMs: 24 * 60 * 60 * 1000 }),
  validateRequest({
    body: z
      .object({
        businessName: z.string().trim().min(2).max(160),
        gstin: z.string().trim().max(15).optional().or(z.literal("")),
        contactPhone: z
          .string()
          .trim()
          .regex(/^\+?[0-9\s-]{8,16}$/),
        notes: z.string().trim().max(1000).optional(),
      })
      .strict(),
  }),
  async (req, res, next) => {
    try {
      const result = await applyForWholesale(req.user!.id, {
        ...req.body,
        gstin: req.body.gstin || undefined,
      });
      const user = (await User.findById(req.user!.id)
        .select("email firstName")
        .lean()) as unknown as { email: string; firstName?: string };
      await createTicketFromContactForm({
        category: "wholesale",
        email: user.email,
        message: `Wholesale application from ${req.body.businessName}${req.body.gstin ? ` (GSTIN ${req.body.gstin})` : ""}.\n\n${req.body.notes ?? ""}`,
        name: user.firstName ?? req.body.businessName,
        phone: req.body.contactPhone,
        source: "account",
        subject: `Wholesale application: ${req.body.businessName}`,
        userId: req.user!.id,
      });
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  },
);

// ---------- Support tickets ----------
accountRouter.get("/support", async (req, res, next) => {
  try {
    const user = (await User.findById(req.user!.id).select("email").lean()) as unknown as {
      email: string;
    };
    res.json({ tickets: await listCustomerTickets(user.email) });
  } catch (error) {
    next(error);
  }
});

accountRouter.get("/support/:ticketNumber", async (req, res, next) => {
  try {
    const user = (await User.findById(req.user!.id).select("email").lean()) as unknown as {
      email: string;
    };
    res.json({
      ticket: await getTicket(String(req.params.ticketNumber), { customerEmail: user.email }),
    });
  } catch (error) {
    next(error);
  }
});

accountRouter.post(
  "/support/:ticketNumber/replies",
  rateLimit({ keyPrefix: "ticket-reply", max: 20, windowMs: 60 * 60 * 1000 }),
  validateRequest({ body: z.object({ body: z.string().trim().min(2).max(5000) }).strict() }),
  async (req, res, next) => {
    try {
      const user = (await User.findById(req.user!.id).select("email").lean()) as unknown as {
        email: string;
      };
      await replyToTicket({
        body: req.body.body,
        customerEmail: user.email,
        ticketNumber: String(req.params.ticketNumber),
      });
      res.json({
        ticket: await getTicket(String(req.params.ticketNumber), { customerEmail: user.email }),
      });
    } catch (error) {
      next(error);
    }
  },
);

// ---------- Privacy centre ----------
accountRouter.get("/privacy/requests", async (req, res, next) => {
  try {
    res.json({ requests: await listOwnPrivacyRequests(req.user!.id) });
  } catch (error) {
    next(error);
  }
});

accountRouter.post(
  "/privacy/export",
  rateLimit({ keyPrefix: "privacy-export", max: 3, windowMs: 24 * 60 * 60 * 1000 }),
  validateRequest({ body: z.object({ stepUpToken: z.string().min(20).max(200) }).strict() }),
  async (req, res, next) => {
    try {
      res.status(201).json(await requestDataExport(req.user!.id, req.body.stepUpToken));
    } catch (error) {
      next(error);
    }
  },
);

accountRouter.get("/privacy/export/:requestNumber", async (req, res, next) => {
  try {
    const data = await downloadExport(req.user!.id, String(req.params.requestNumber));
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="vastra-house-data-${String(req.params.requestNumber)}.json"`,
    );
    res.json(data);
  } catch (error) {
    next(error);
  }
});

accountRouter.post(
  "/privacy/delete",
  rateLimit({ keyPrefix: "privacy-delete", max: 3, windowMs: 24 * 60 * 60 * 1000 }),
  validateRequest({
    body: z
      .object({
        reason: z.string().trim().max(1000).optional(),
        stepUpToken: z.string().min(20).max(200),
      })
      .strict(),
  }),
  async (req, res, next) => {
    try {
      res
        .status(201)
        .json(await requestAccountDeletion(req.user!.id, req.body.reason, req.body.stepUpToken));
    } catch (error) {
      next(error);
    }
  },
);

accountRouter.patch(
  "/privacy/cookies",
  validateRequest({ body: z.object({ analytics: z.boolean(), marketing: z.boolean() }).strict() }),
  async (req, res, next) => {
    try {
      await User.updateOne(
        { _id: req.user!.id },
        { $set: { cookieConsent: { ...req.body, updatedAt: new Date() } } },
      );
      res.json({ cookieConsent: req.body });
    } catch (error) {
      next(error);
    }
  },
);

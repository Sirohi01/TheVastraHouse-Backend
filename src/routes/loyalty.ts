import { randomBytes } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { requireAuth, requirePermission } from "../middleware/authMiddleware.js";
import { validateRequest } from "../middleware/validateRequest.js";
import { GiftCard } from "../models/GiftCard.js";
import { getLoyaltyTier } from "../services/loyaltyTierService.js";
import { getOrCreateReferralCode } from "../services/referralService.js";
import { getRewardPointsBalance } from "../services/rewardPointsService.js";
import { getStoreCreditBalance } from "../services/storeCreditService.js";
import { buildPaginatedResult, parsePagination } from "../utils/pagination.js";

export const loyaltyRouter = Router();

loyaltyRouter.use(requireAuth);

loyaltyRouter.get("/me", async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const [rewardPoints, storeCreditBalance, tier, referralCode] = await Promise.all([
      getRewardPointsBalance(userId),
      getStoreCreditBalance(userId),
      getLoyaltyTier(userId),
      getOrCreateReferralCode(userId),
    ]);

    res.json({ referralCode, rewardPoints, storeCreditBalance, tier });
  } catch (error) {
    next(error);
  }
});

const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i);

loyaltyRouter.get(
  "/admin/gift-cards",
  requirePermission({ module: "marketing", action: "read" }),
  async (req, res, next) => {
    try {
      const pagination = parsePagination(req.query);
      const [giftCards, total] = await Promise.all([
        GiftCard.find({})
          .sort({ createdAt: -1 })
          .skip(pagination.skip)
          .limit(pagination.limit)
          .lean(),
        GiftCard.countDocuments({}),
      ]);

      res.json(buildPaginatedResult(giftCards, total, pagination));
    } catch (error) {
      next(error);
    }
  },
);

loyaltyRouter.post(
  "/admin/gift-cards",
  requirePermission({ module: "marketing", action: "manage" }),
  validateRequest({
    body: z
      .object({
        balance: z.coerce.number().positive(),
        currencyCode: z.string().length(3).default("INR"),
        issuedToUserId: objectIdSchema.optional(),
        expiresAt: z.coerce.date().optional(),
      })
      .strict(),
  }),
  async (req, res, next) => {
    try {
      const giftCard = await GiftCard.create({
        balance: req.body.balance,
        code: generateGiftCardCode(),
        currencyCode: req.body.currencyCode,
        expiresAt: req.body.expiresAt,
        issuedToUserId: req.body.issuedToUserId,
        status: "active",
      });

      res.status(201).json({ giftCard });
    } catch (error) {
      next(error);
    }
  },
);

function generateGiftCardCode() {
  return `TVH-${randomBytes(5).toString("hex").toUpperCase()}`;
}

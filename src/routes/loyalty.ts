import { Router } from "express";
import { Types } from "mongoose";
import { z } from "zod";
import { requireAuth, requirePermission } from "../middleware/authMiddleware.js";
import { AppError } from "../middleware/errorHandler.js";
import { validateRequest } from "../middleware/validateRequest.js";
import { GiftCard } from "../models/GiftCard.js";
import { RewardPointsLedger } from "../models/RewardPointsLedger.js";
import { User } from "../models/User.js";
import { writeAuditLog } from "../services/auditLogService.js";
import { issueGiftCard, listGiftCardTransactions } from "../services/giftCardService.js";
import { getLoyaltyTier } from "../services/loyaltyTierService.js";
import { enqueueNotification } from "../services/notificationDispatchService.js";
import { getOrCreateReferralCode } from "../services/referralService.js";
import { getRewardPointsBalance } from "../services/rewardPointsService.js";
import { getStoreCreditBalance, issueStoreCredit, reverseStoreCredit } from "../services/storeCreditService.js";
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
      const filter: Record<string, unknown> = {};
      if (typeof req.query.search === "string" && req.query.search) {
        const pattern = { $options: "i", $regex: req.query.search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") };
        filter.$or = [{ code: pattern }, { recipientEmail: pattern }];
      }
      const [giftCards, total] = await Promise.all([
        GiftCard.find(filter).sort({ createdAt: -1 }).skip(pagination.skip).limit(pagination.limit).lean(),
        GiftCard.countDocuments(filter),
      ]);

      res.json(buildPaginatedResult(giftCards, total, pagination));
    } catch (error) {
      next(error);
    }
  },
);

loyaltyRouter.get(
  "/admin/gift-cards/:id",
  requirePermission({ module: "marketing", action: "read" }),
  validateRequest({ params: z.object({ id: objectIdSchema }).strict() }),
  async (req, res, next) => {
    try {
      const giftCard = await GiftCard.findById(req.params.id).lean();
      if (!giftCard) throw new AppError("Gift card not found", 404);
      res.json({ giftCard, transactions: await listGiftCardTransactions(String(req.params.id)) });
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
        balance: z.coerce.number().positive().max(200_000),
        currencyCode: z.string().length(3).default("INR"),
        issuedToUserId: objectIdSchema.optional(),
        recipientEmail: z.string().trim().email().optional(),
        recipientName: z.string().trim().max(80).optional(),
        message: z.string().trim().max(300).optional(),
        expiresAt: z.coerce.date().optional(),
      })
      .strict(),
  }),
  async (req, res, next) => {
    try {
      if (req.body.expiresAt && req.body.expiresAt <= new Date()) {
        throw new AppError("Expiry date must be in the future", 400);
      }

      const giftCard = await issueGiftCard({
        actorId: req.user!.id,
        amount: req.body.balance,
        currencyCode: req.body.currencyCode,
        expiresAt: req.body.expiresAt,
        issuedToUserId: req.body.issuedToUserId,
        message: req.body.message,
        recipientEmail: req.body.recipientEmail,
        recipientName: req.body.recipientName,
        source: "admin",
      });

      if (req.body.recipientEmail) {
        await enqueueNotification({
          channel: "email",
          eventType: "gift_card_delivered",
          fallback: {
            subject: "You have received a The Vastra House gift card",
            text: `You have received a gift card worth Rs. ${req.body.balance}.${req.body.message ? `\n\n${req.body.message}` : ""}\n\nCode: ${giftCard.code}${giftCard.expiresAt ? `\nValid until ${giftCard.expiresAt.toDateString()}` : ""}`,
          },
          to: req.body.recipientEmail,
          variables: { code: giftCard.code },
        });
      }

      await writeAuditLog({
        action: "create",
        actor: { actorId: new Types.ObjectId(req.user!.id), actorType: "admin" },
        after: { balance: giftCard.balance, code: giftCard.code },
        entity: { displayId: giftCard.code, id: giftCard._id, type: "gift-card" },
      });
      res.status(201).json({ giftCard });
    } catch (error) {
      next(error);
    }
  },
);

loyaltyRouter.patch(
  "/admin/gift-cards/:id",
  requirePermission({ module: "marketing", action: "manage" }),
  validateRequest({
    params: z.object({ id: objectIdSchema }).strict(),
    body: z.object({ status: z.enum(["active", "disabled"]) }).strict(),
  }),
  async (req, res, next) => {
    try {
      const giftCard = await GiftCard.findOneAndUpdate(
        { _id: req.params.id, status: { $ne: "expired" } },
        { $set: { status: req.body.status } },
        { new: true },
      );
      if (!giftCard) throw new AppError("Gift card not found or already expired", 404);
      res.json({ giftCard });
    } catch (error) {
      next(error);
    }
  },
);

/** Goodwill credit or correction by staff; audited and shown on the customer's ledger. */
loyaltyRouter.post(
  "/admin/customers/:id/store-credit",
  requirePermission({ module: "marketing", action: "manage" }),
  validateRequest({
    params: z.object({ id: objectIdSchema }).strict(),
    body: z
      .object({ amount: z.coerce.number().refine((value) => value !== 0, "Amount cannot be zero"), notes: z.string().trim().min(3).max(300) })
      .strict(),
  }),
  async (req, res, next) => {
    try {
      const userId = String(req.params.id);
      if (req.body.amount > 0) {
        await issueStoreCredit({ amount: req.body.amount, notes: req.body.notes, sourceType: "admin", userId });
      } else {
        const reversed = await reverseStoreCredit({
          amount: Math.abs(req.body.amount),
          notes: req.body.notes,
          orderNumber: "ADMIN-ADJUSTMENT",
          userId,
        });
        if (!reversed) throw new AppError("Customer has no store credit to deduct", 409);
      }
      await writeAuditLog({
        action: "update",
        actor: { actorId: new Types.ObjectId(req.user!.id), actorType: "admin" },
        after: { amount: req.body.amount, notes: req.body.notes },
        entity: { displayId: userId, id: new Types.ObjectId(userId), type: "store-credit" },
      });
      res.json({ storeCreditBalance: await getStoreCreditBalance(userId) });
    } catch (error) {
      next(error);
    }
  },
);

loyaltyRouter.post(
  "/admin/customers/:id/points",
  requirePermission({ module: "marketing", action: "manage" }),
  validateRequest({
    params: z.object({ id: objectIdSchema }).strict(),
    body: z
      .object({ points: z.coerce.number().int().refine((value) => value !== 0, "Points cannot be zero"), reason: z.string().trim().min(3).max(300) })
      .strict(),
  }),
  async (req, res, next) => {
    try {
      const userId = String(req.params.id);
      const filter = req.body.points < 0 ? { _id: userId, rewardPointsBalance: { $gte: -req.body.points } } : { _id: userId };
      const user = (await User.findOneAndUpdate(filter, { $inc: { rewardPointsBalance: req.body.points } }, { new: true })
        .select("rewardPointsBalance")
        .lean()) as unknown as { rewardPointsBalance: number } | null;
      if (!user) throw new AppError("Customer not found or insufficient points", 409);

      await RewardPointsLedger.create({
        balanceAfter: user.rewardPointsBalance,
        points: req.body.points,
        reason: `Staff adjustment: ${req.body.reason}`,
        remaining: req.body.points > 0 ? req.body.points : undefined,
        type: "adjust",
        userId,
      });
      await writeAuditLog({
        action: "update",
        actor: { actorId: new Types.ObjectId(req.user!.id), actorType: "admin" },
        after: { points: req.body.points, reason: req.body.reason },
        entity: { displayId: userId, id: new Types.ObjectId(userId), type: "reward-points" },
      });
      res.json({ rewardPointsBalance: user.rewardPointsBalance });
    } catch (error) {
      next(error);
    }
  },
);

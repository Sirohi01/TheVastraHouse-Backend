import crypto from "node:crypto";
import type { Types } from "mongoose";
import { AppError } from "../middleware/errorHandler.js";
import { GiftCard } from "../models/GiftCard.js";
import { GiftCardTransaction } from "../models/GiftCardTransaction.js";

type GiftCardLean = {
  _id: Types.ObjectId;
  code: string;
  balance: number;
  status: string;
  currencyCode: string;
  expiresAt?: Date;
};

export function normalizeGiftCardCode(code: string) {
  return code.trim().toUpperCase();
}

export function isGiftCardUsable(card: GiftCardLean | null, now = new Date()) {
  return Boolean(
    card &&
    card.status === "active" &&
    card.balance > 0 &&
    (!card.expiresAt || card.expiresAt.getTime() >= now.getTime()),
  );
}

export async function getGiftCardByCode(code: string) {
  return (await GiftCard.findOne({
    code: normalizeGiftCardCode(code),
  }).lean()) as GiftCardLean | null;
}

/**
 * Debits gift cards for an order. Each debit is conditional on the card still holding enough
 * balance, so two checkouts cannot spend the same balance. If any card fails, earlier debits in
 * this call are restored before the error propagates.
 */
export async function redeemGiftCardsForOrder(input: {
  orderNumber: string;
  redemptions: Array<{ code: string; amount: number }>;
}) {
  const applied: Array<{ code: string; amount: number }> = [];

  try {
    for (const redemption of input.redemptions) {
      const amount = roundMoney(redemption.amount);

      if (amount <= 0) {
        continue;
      }

      const code = normalizeGiftCardCode(redemption.code);
      const card = (await GiftCard.findOneAndUpdate(
        {
          code,
          status: "active",
          balance: { $gte: amount },
          $or: [
            { expiresAt: { $exists: false } },
            { expiresAt: null },
            { expiresAt: { $gte: new Date() } },
          ],
        },
        { $inc: { balance: -amount } },
        { new: true },
      )) as (GiftCardLean & { save: () => Promise<unknown> }) | null;

      if (!card) {
        throw new AppError(`Gift card ${code} no longer has enough balance`, 409);
      }

      applied.push({ amount, code });
      await GiftCardTransaction.create({
        amount: -amount,
        balanceAfter: card.balance,
        code,
        giftCardId: card._id,
        orderNumber: input.orderNumber,
        type: "redeem",
      });
    }
  } catch (error) {
    await restoreGiftCardsForOrder({ orderNumber: input.orderNumber, redemptions: applied });
    throw error;
  }

  return applied;
}

/** Credits gift card redemptions back for a cancelled order. Idempotent per card and order. */
export async function restoreGiftCardsForOrder(input: {
  orderNumber: string;
  redemptions: Array<{ code: string; amount: number }>;
}) {
  let restored = 0;

  for (const redemption of input.redemptions) {
    const code = normalizeGiftCardCode(redemption.code);
    const card = (await GiftCard.findOne({ code }).lean()) as GiftCardLean | null;

    if (!card || redemption.amount <= 0) {
      continue;
    }

    try {
      // Insert the ledger row first: its unique index is the idempotency guard.
      const entry = await GiftCardTransaction.create({
        amount: redemption.amount,
        balanceAfter: card.balance + redemption.amount,
        code,
        giftCardId: card._id,
        notes: "Order cancelled",
        orderNumber: input.orderNumber,
        type: "restore",
      });
      const updated = (await GiftCard.findByIdAndUpdate(
        card._id,
        { $inc: { balance: redemption.amount } },
        { new: true },
      ).lean()) as GiftCardLean | null;
      if (updated) {
        await GiftCardTransaction.updateOne(
          { _id: entry._id },
          { $set: { balanceAfter: updated.balance } },
        );
      }
      restored += redemption.amount;
    } catch (error) {
      if ((error as { code?: number }).code !== 11000) {
        throw error;
      }
    }
  }

  return restored;
}

export async function issueGiftCard(input: {
  amount: number;
  actorId?: string;
  currencyCode?: string;
  expiresAt?: Date;
  issuedToUserId?: string;
  message?: string;
  purchaseOrderNumber?: string;
  purchasedByUserId?: string;
  recipientEmail?: string;
  recipientName?: string;
  source?: "admin" | "purchase" | "refund";
  code?: string;
}) {
  if (input.amount <= 0) {
    throw new AppError("Gift card amount must be positive", 400);
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = input.code ? normalizeGiftCardCode(input.code) : generateGiftCardCode();

    try {
      const card = await GiftCard.create({
        balance: input.amount,
        code,
        currencyCode: input.currencyCode ?? "INR",
        expiresAt: input.expiresAt,
        initialAmount: input.amount,
        issuedToUserId: input.issuedToUserId,
        message: input.message,
        purchaseOrderNumber: input.purchaseOrderNumber,
        purchasedByUserId: input.purchasedByUserId,
        recipientEmail: input.recipientEmail,
        recipientName: input.recipientName,
        source: input.source ?? "admin",
        status: "active",
      });
      await GiftCardTransaction.create({
        actorId: input.actorId,
        amount: input.amount,
        balanceAfter: input.amount,
        code,
        giftCardId: card._id,
        orderNumber: input.purchaseOrderNumber,
        type: "issue",
      });
      return card;
    } catch (error) {
      if ((error as { code?: number }).code !== 11000 || input.code) {
        throw error;
      }
    }
  }

  throw new AppError("Could not generate a unique gift card code", 500);
}

export async function listGiftCardTransactions(giftCardId: string) {
  return GiftCardTransaction.find({ giftCardId }).sort({ createdAt: -1 }).limit(100).lean();
}

export async function expireGiftCards(now = new Date()) {
  const result = await GiftCard.updateMany(
    { expiresAt: { $lt: now }, status: "active" },
    { $set: { status: "expired" } },
  );
  return { expired: result.modifiedCount };
}

function generateGiftCardCode() {
  return `TVH-${crypto
    .randomBytes(6)
    .toString("hex")
    .toUpperCase()
    .match(/.{1,4}/g)!
    .join("-")}`;
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

const GIFT_CARD_MIN = 500;
const GIFT_CARD_MAX = 50_000;
const GIFT_CARD_VALIDITY_DAYS = 365;

/** Starts an online gift-card purchase; the card is issued only after payment capture. */
export async function startGiftCardPurchase(input: {
  userId: string;
  purchaserEmail: string;
  amount: number;
  recipientEmail: string;
  recipientName?: string;
  message?: string;
}) {
  if (
    !Number.isInteger(input.amount) ||
    input.amount < GIFT_CARD_MIN ||
    input.amount > GIFT_CARD_MAX
  ) {
    throw new AppError(
      `Gift cards can be bought for Rs. ${GIFT_CARD_MIN} to Rs. ${GIFT_CARD_MAX}`,
      400,
    );
  }

  const { createRazorpayPayment } = await import("./paymentService.js");
  const reference = `GC-${crypto.randomBytes(5).toString("hex").toUpperCase()}`;
  const payment = await createRazorpayPayment({
    amount: input.amount,
    orderReference: reference,
    paymentMode: "full",
    userId: input.userId,
  });
  payment.session.set("metadata", {
    kind: "gift_card_purchase",
    message: input.message?.slice(0, 300),
    purchaserEmail: input.purchaserEmail,
    recipientEmail: input.recipientEmail.trim().toLowerCase(),
    recipientName: input.recipientName?.slice(0, 80),
  });
  await payment.session.save();

  return { gatewayOrder: payment.gatewayOrder, reference };
}

/**
 * Called after any successful capture. Issues the purchased gift card exactly once: the session
 * metadata is claimed atomically before issuing.
 */
export async function fulfillGiftCardPurchase(session: {
  _id: unknown;
  status: string;
  amount: number;
  orderReference: string;
  userId?: unknown;
  metadata?: Record<string, unknown>;
}) {
  const metadata = session.metadata ?? {};

  if (
    metadata.kind !== "gift_card_purchase" ||
    session.status !== "confirmed" ||
    metadata.giftCardIssuedAt
  ) {
    return null;
  }

  const { PaymentSession } = await import("../models/PaymentSession.js");
  const claimed = await PaymentSession.updateOne(
    { _id: session._id, "metadata.giftCardIssuedAt": { $exists: false } },
    { $set: { "metadata.giftCardIssuedAt": new Date() } },
  );

  if (!claimed.modifiedCount) {
    return null;
  }

  const card = await issueGiftCard({
    amount: session.amount,
    expiresAt: new Date(Date.now() + GIFT_CARD_VALIDITY_DAYS * 86_400_000),
    message: metadata.message as string | undefined,
    purchaseOrderNumber: session.orderReference,
    purchasedByUserId: session.userId ? String(session.userId) : undefined,
    recipientEmail: metadata.recipientEmail as string,
    recipientName: metadata.recipientName as string | undefined,
    source: "purchase",
  });
  const { enqueueNotification } = await import("./notificationDispatchService.js");
  const { env } = await import("../config/env.js");
  const recipient = (metadata.recipientName as string | undefined) ?? "there";
  await enqueueNotification({
    channel: "email",
    eventType: "gift_card_delivered",
    fallback: {
      subject: "You have received a The Vastra House gift card",
      text: `Hi ${recipient},\n\nYou have received a gift card worth Rs. ${session.amount}.${metadata.message ? `\n\nMessage: ${String(metadata.message)}` : ""}\n\nCode: ${card.code}\nValid until: ${card.expiresAt?.toDateString()}\n\nApply it in your cart at ${env.FRONTEND_PUBLIC_URL.replace(/\/$/, "")}/shop`,
    },
    to: metadata.recipientEmail as string,
    variables: { code: card.code },
  });

  if (metadata.purchaserEmail) {
    await enqueueNotification({
      channel: "email",
      eventType: "gift_card_purchase_receipt",
      fallback: {
        subject: `Gift card purchase confirmed (${session.orderReference})`,
        text: `Your Rs. ${session.amount} gift card has been sent to ${String(metadata.recipientEmail)}.`,
      },
      to: metadata.purchaserEmail as string,
      variables: {},
    });
  }

  return card;
}

export async function listUserGiftCards(userId: string, email: string) {
  return GiftCard.find({
    $or: [{ issuedToUserId: userId }, { purchasedByUserId: userId }, { recipientEmail: email }],
  })
    .select(
      "code balance initialAmount currencyCode status expiresAt recipientEmail source createdAt",
    )
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();
}

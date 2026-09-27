import { Types } from "mongoose";
import { AppError } from "../middleware/errorHandler.js";
import { Order } from "../models/Order.js";
import { PaymentSession } from "../models/PaymentSession.js";
import { Product } from "../models/Product.js";
import { User } from "../models/User.js";
import { buildPaginatedResult, type PaginationOptions } from "../utils/pagination.js";
import { writeAuditLog } from "./auditLogService.js";
import { enqueueNotification } from "./notificationDispatchService.js";

export type WholesalePaymentTerms = "prepaid" | "advance_50" | "net_15" | "net_30";

const GSTIN_PATTERN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

export type WholesaleAccount = {
  approved: boolean;
  priceListCode?: string;
  paymentTerms: WholesalePaymentTerms;
  creditLimit: number;
  gstin?: string;
  businessName?: string;
};

export async function getWholesaleAccount(userId?: string): Promise<WholesaleAccount | undefined> {
  if (!userId) return undefined;

  const user = (await User.findById(userId)
    .select("customerType wholesaleStatus priceListCode wholesaleProfile")
    .lean()) as unknown as {
    customerType?: string;
    wholesaleStatus?: string;
    priceListCode?: string;
    wholesaleProfile?: { paymentTerms?: WholesalePaymentTerms; creditLimit?: number; gstin?: string; businessName?: string };
  } | null;

  if (!user || user.customerType !== "wholesale" || user.wholesaleStatus !== "approved") {
    return undefined;
  }

  return {
    approved: true,
    businessName: user.wholesaleProfile?.businessName,
    creditLimit: user.wholesaleProfile?.creditLimit ?? 0,
    gstin: user.wholesaleProfile?.gstin,
    paymentTerms: user.wholesaleProfile?.paymentTerms ?? "prepaid",
    priceListCode: (user.priceListCode || "WHOLESALE").toUpperCase(),
  };
}

export async function applyForWholesale(
  userId: string,
  input: { businessName: string; gstin?: string; contactPhone: string; notes?: string },
) {
  const gstin = input.gstin?.trim().toUpperCase();

  if (gstin && !GSTIN_PATTERN.test(gstin)) {
    throw new AppError("Enter a valid 15-character GSTIN", 400);
  }

  const user = await User.findById(userId);
  if (!user || user.type !== "customer") throw new AppError("User not found", 404);
  if (user.wholesaleStatus === "approved") throw new AppError("Your wholesale account is already active", 409);

  user.wholesaleStatus = "pending";
  user.set("wholesaleProfile", {
    ...(user.wholesaleProfile ?? {}),
    appliedAt: new Date(),
    businessName: input.businessName,
    contactPhone: input.contactPhone,
    gstin,
    notes: input.notes,
  });
  await user.save();

  return { wholesaleStatus: user.wholesaleStatus };
}

export async function listWholesaleAccounts(filter: { status?: string }, pagination: PaginationOptions) {
  const query: Record<string, unknown> = { type: "customer", wholesaleStatus: filter.status ?? { $ne: "none" } };
  const [items, total] = await Promise.all([
    User.find(query)
      .select("email firstName lastName phone customerType wholesaleStatus priceListCode wholesaleProfile lifetimeOrderValue createdAt")
      .sort({ "wholesaleProfile.appliedAt": -1 })
      .skip(pagination.skip)
      .limit(pagination.limit)
      .lean(),
    User.countDocuments(query),
  ]);
  return buildPaginatedResult(items, total, pagination);
}

export async function reviewWholesaleApplication(input: {
  userId: string;
  decision: "approve" | "reject" | "update";
  priceListCode?: string;
  paymentTerms?: WholesalePaymentTerms;
  creditLimit?: number;
  note?: string;
  adminUserId: string;
}) {
  const user = await User.findById(input.userId);
  if (!user || user.type !== "customer") throw new AppError("Customer not found", 404);

  const before = user.toObject();

  if (input.decision === "reject") {
    user.wholesaleStatus = "rejected";
    user.customerType = "retail";
    user.priceListCode = undefined;
  } else {
    const priceListCode = (input.priceListCode || user.priceListCode || "WHOLESALE").trim().toUpperCase();
    const hasPrices = await Product.exists({ "variants.priceTiers.priceListCode": priceListCode });
    if (!hasPrices) {
      throw new AppError(`No products have prices for price list ${priceListCode} yet`, 400);
    }
    user.wholesaleStatus = "approved";
    user.customerType = "wholesale";
    user.priceListCode = priceListCode;
    user.set("wholesaleProfile.paymentTerms", input.paymentTerms ?? user.wholesaleProfile?.paymentTerms ?? "prepaid");
    user.set("wholesaleProfile.creditLimit", input.creditLimit ?? user.wholesaleProfile?.creditLimit ?? 0);
  }

  user.set("wholesaleProfile.reviewedAt", new Date());
  user.set("wholesaleProfile.reviewedBy", new Types.ObjectId(input.adminUserId));
  await user.save();
  await writeAuditLog({
    action: "update",
    actor: { actorId: new Types.ObjectId(input.adminUserId), actorType: "admin" },
    after: user.toObject(),
    before,
    entity: { displayId: user.email, id: user._id, type: "wholesale-account" },
    metadata: { decision: input.decision },
  });

  if (input.decision !== "update") {
    await enqueueNotification({
      channel: "email",
      eventType: `wholesale_${input.decision === "approve" ? "approved" : "rejected"}`,
      fallback:
        input.decision === "approve"
          ? {
              subject: "Your wholesale account is approved",
              text: "Your The Vastra House wholesale account is active. Sign in to see your trade prices and use bulk ordering.",
            }
          : {
              subject: "Update on your wholesale application",
              text: `We are unable to approve your wholesale application at this time.${input.note ? `\n\n${input.note}` : ""}`,
            },
      to: user.email,
      variables: {},
    });
  }

  return user;
}

/** Enforces per-style minimum order quantities for wholesale carts. */
export async function assertWholesaleMinimums(items: Array<{ productId: unknown; quantity: number; productName: string }>) {
  const totals = new Map<string, { quantity: number; name: string }>();
  for (const item of items) {
    const key = String(item.productId);
    const current = totals.get(key) ?? { name: item.productName, quantity: 0 };
    totals.set(key, { name: current.name, quantity: current.quantity + item.quantity });
  }

  const products = (await Product.find({ _id: { $in: [...totals.keys()] } })
    .select("wholesaleMinQuantity")
    .lean()) as unknown as Array<{ _id: unknown; wholesaleMinQuantity?: number }>;

  for (const product of products) {
    const total = totals.get(String(product._id));
    if (product.wholesaleMinQuantity && total && total.quantity < product.wholesaleMinQuantity) {
      throw new AppError(
        `${total.name} has a wholesale minimum of ${product.wholesaleMinQuantity} pieces (you have ${total.quantity})`,
        400,
      );
    }
  }
}

/** Outstanding credit across confirmed credit-terms orders, for the credit-limit check. */
export async function outstandingCredit(userId: string) {
  const sessions = (await PaymentSession.find({
    method: "credit_terms",
    outstandingAmount: { $gt: 0 },
    userId,
  })
    .select("outstandingAmount orderReference")
    .lean()) as unknown as Array<{ outstandingAmount: number; orderReference: string }>;
  if (!sessions.length) return 0;

  const closed = new Set(
    (
      (await Order.find({
        orderNumber: { $in: sessions.map((session) => session.orderReference) },
        status: { $in: ["cancelled", "refunded"] },
      }).distinct("orderNumber")) as string[]
    ).map(String),
  );
  return sessions
    .filter((session) => !closed.has(session.orderReference))
    .reduce((total, session) => total + session.outstandingAmount, 0);
}

export function creditTermsDueDate(terms: WholesalePaymentTerms, from = new Date()) {
  const days = terms === "net_30" ? 30 : terms === "net_15" ? 15 : 0;
  return new Date(from.getTime() + days * 86_400_000);
}

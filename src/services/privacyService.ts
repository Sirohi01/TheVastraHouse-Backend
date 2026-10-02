import crypto from "node:crypto";
import { Types } from "mongoose";
import { AppError } from "../middleware/errorHandler.js";
import { AbandonedCartEvent } from "../models/AbandonedCartEvent.js";
import { AuthToken } from "../models/AuthToken.js";
import { BackInStockSubscription } from "../models/BackInStockSubscription.js";
import { Cart } from "../models/Cart.js";
import { NewsletterSubscriber } from "../models/NewsletterSubscriber.js";
import { NotificationLog } from "../models/NotificationLog.js";
import { Order } from "../models/Order.js";
import { PaymentHistory } from "../models/PaymentHistory.js";
import { PaymentSession } from "../models/PaymentSession.js";
import { PrivacyRequest } from "../models/PrivacyRequest.js";
import { ProductReview } from "../models/ProductReview.js";
import { ReturnRequest } from "../models/ReturnRequest.js";
import { RewardPointsLedger } from "../models/RewardPointsLedger.js";
import { StoreCreditTransaction } from "../models/StoreCreditTransaction.js";
import { SupportTicket } from "../models/SupportTicket.js";
import { User } from "../models/User.js";
import { Wishlist } from "../models/Wishlist.js";
import { buildPaginatedResult, type PaginationOptions } from "../utils/pagination.js";
import { writeAuditLog } from "./auditLogService.js";
import { hashOpaqueToken } from "./cryptoTokenService.js";
import { enqueueNotification } from "./notificationDispatchService.js";
import { hashPassword } from "./passwordService.js";
import { revokeAllUserSessions } from "./refreshTokenService.js";

const RESPONSE_SLA_DAYS = 30;
const OPEN_ORDER_STATUSES = [
  "pending_payment",
  "payment_verification_pending",
  "confirmed",
  "pre_order_confirmed",
  "cod_confirmed",
  "in_production",
  "packed",
  "ready_to_dispatch",
  "shipped",
];

function requestNumber(kind: "export" | "deletion") {
  return `PRV-${kind === "export" ? "EXP" : "DEL"}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
}

/** Sensitive actions require a fresh OTP step-up token (auth/otp/verify purpose=sensitive-action). */
async function consumeStepUpToken(userId: string, token: string | undefined) {
  if (!token) {
    throw new AppError("Please confirm this action with the code we email you", 401);
  }

  const record = await AuthToken.findOneAndUpdate(
    {
      expiresAt: { $gt: new Date() },
      tokenHash: hashOpaqueToken(token),
      type: "step-up",
      usedAt: { $exists: false },
      userId,
    },
    { $set: { usedAt: new Date() } },
  );

  if (!record) {
    throw new AppError("Verification expired. Please request a new code.", 401);
  }
}

/** Everything we hold about a customer, in a portable JSON document (DPDP/GDPR access right). */
export async function compileCustomerData(userId: string) {
  const id = new Types.ObjectId(userId);
  const user = (await User.findById(id)
    .select("-passwordHash -totpSecret -permissionOverrides -failedLoginCount -lockedUntil")
    .lean()) as (Record<string, unknown> & { email: string }) | null;

  if (!user) throw new AppError("User not found", 404);

  const [orders, reviews, tickets, newsletter, alerts, points, credit, returns, sessions] =
    await Promise.all([
      Order.find({ userId: id })
        .select("-costPrice -items.costPrice -risk -stockReservations")
        .lean(),
      ProductReview.find({ userId: id }).lean(),
      SupportTicket.find({ email: user.email }).select("-ipAddress").lean(),
      NewsletterSubscriber.find({ email: user.email }).select("-unsubscribeToken").lean(),
      BackInStockSubscription.find({ email: user.email }).select("-unsubscribeToken").lean(),
      RewardPointsLedger.find({ userId: id }).lean(),
      StoreCreditTransaction.find({ userId: id }).lean(),
      ReturnRequest.find({ userId: id }).lean(),
      PaymentSession.find({ userId: id })
        .select(
          "orderReference method status amount paidAmount outstandingAmount currencyCode createdAt",
        )
        .lean(),
    ]);

  return {
    account: user,
    alerts,
    exportedAt: new Date().toISOString(),
    newsletter,
    orders,
    payments: sessions,
    returns,
    reviews,
    rewardPoints: points,
    storeCredit: credit,
    supportTickets: tickets,
  };
}

export async function requestDataExport(userId: string, stepUpToken?: string) {
  await consumeStepUpToken(userId, stepUpToken);
  const user = (await User.findById(userId).select("email").lean()) as unknown as {
    email: string;
  } | null;
  if (!user) throw new AppError("User not found", 404);

  const exportData = await compileCustomerData(userId);
  const request = await PrivacyRequest.create({
    completedAt: new Date(),
    dueAt: new Date(Date.now() + RESPONSE_SLA_DAYS * 86_400_000),
    email: user.email,
    exportData,
    requestNumber: requestNumber("export"),
    status: "completed",
    type: "export",
    userId,
  });

  await writeAuditLog({
    action: "export",
    actor: { actorId: new Types.ObjectId(userId), actorType: "customer" },
    after: { requestNumber: request.requestNumber },
    before: {},
    entity: { displayId: request.requestNumber, id: request._id, type: "privacy-request" },
  });

  return { requestNumber: request.requestNumber, status: request.status };
}

export async function requestAccountDeletion(
  userId: string,
  reason: string | undefined,
  stepUpToken?: string,
) {
  await consumeStepUpToken(userId, stepUpToken);
  const user = (await User.findById(userId).select("email").lean()) as unknown as {
    email: string;
  } | null;
  if (!user) throw new AppError("User not found", 404);

  const pending = await PrivacyRequest.exists({
    status: { $in: ["pending", "processing"] },
    type: "deletion",
    userId,
  });
  if (pending) throw new AppError("A deletion request is already being processed", 409);

  const request = await PrivacyRequest.create({
    dueAt: new Date(Date.now() + RESPONSE_SLA_DAYS * 86_400_000),
    email: user.email,
    reason,
    requestNumber: requestNumber("deletion"),
    status: "pending",
    type: "deletion",
    userId,
  });
  await User.updateOne({ _id: userId }, { $set: { deletionRequestedAt: new Date() } });
  await enqueueNotification({
    channel: "email",
    eventType: "privacy_deletion_received",
    fallback: {
      subject: `We received your account deletion request (${request.requestNumber})`,
      text: `We will delete your personal data within ${RESPONSE_SLA_DAYS} days. Tax invoices for past orders are retained in anonymised form as required by law. If you did not make this request, contact us immediately.`,
    },
    to: user.email,
    variables: {},
  });

  return { requestNumber: request.requestNumber, status: request.status };
}

export async function listOwnPrivacyRequests(userId: string) {
  return PrivacyRequest.find({ userId }).select("-exportData").sort({ createdAt: -1 }).lean();
}

export async function downloadExport(userId: string, requestNumberValue: string) {
  const request = (await PrivacyRequest.findOne({
    requestNumber: requestNumberValue,
    type: "export",
    userId,
  })
    .select("+exportData")
    .lean()) as unknown as { exportData?: unknown; createdAt: Date } | null;

  if (!request?.exportData) throw new AppError("Export not found", 404);
  if (Date.now() - new Date(request.createdAt).getTime() > 7 * 86_400_000) {
    throw new AppError("This export has expired. Request a new one.", 410);
  }

  return request.exportData;
}

export async function listPrivacyRequests(
  filter: { status?: string; type?: string },
  pagination: PaginationOptions,
) {
  const query: Record<string, unknown> = {};
  if (filter.status) query.status = filter.status;
  if (filter.type) query.type = filter.type;
  const [items, total] = await Promise.all([
    PrivacyRequest.find(query)
      .select("-exportData")
      .sort({ dueAt: 1 })
      .skip(pagination.skip)
      .limit(pagination.limit)
      .lean(),
    PrivacyRequest.countDocuments(query),
  ]);
  return buildPaginatedResult(items, total, pagination);
}

/**
 * Fulfils a deletion request: removes or anonymises PII in every collection that holds it,
 * while keeping statutory financial records (orders, invoices, payments) in anonymised form.
 */
export async function processDeletionRequest(input: {
  requestNumber: string;
  adminUserId: string;
  decision: "approve" | "reject";
  note?: string;
}) {
  const request = await PrivacyRequest.findOne({
    requestNumber: input.requestNumber,
    type: "deletion",
  });
  if (!request) throw new AppError("Request not found", 404);
  if (!["pending", "processing"].includes(request.status))
    throw new AppError("Request already resolved", 409);

  const userId = String(request.userId);

  if (input.decision === "reject") {
    request.status = "rejected";
    request.resolutionNote = input.note;
    request.processedBy = new Types.ObjectId(input.adminUserId);
    request.completedAt = new Date();
    await request.save();
    await User.updateOne({ _id: userId }, { $unset: { deletionRequestedAt: "" } });
    return request;
  }

  const openOrders = await Order.countDocuments({ status: { $in: OPEN_ORDER_STATUSES }, userId });
  if (openOrders) {
    throw new AppError(
      `Customer has ${openOrders} open order(s). Complete or cancel them before deletion.`,
      409,
    );
  }

  request.status = "processing";
  await request.save();
  const user = (await User.findById(userId).select("email").lean()) as unknown as {
    email: string;
  } | null;
  const originalEmail = user?.email ?? request.email;
  const anonymousEmail = `deleted-${userId}@anonymized.invalid`;
  const scrubbedAddress = {
    "billingAddress.company": undefined,
    "billingAddress.fullName": "Deleted customer",
    "billingAddress.line1": "Redacted",
    "billingAddress.line2": undefined,
    "billingAddress.phone": undefined,
    guestEmail: undefined,
    "shippingAddress.company": undefined,
    "shippingAddress.fullName": "Deleted customer",
    "shippingAddress.line1": "Redacted",
    "shippingAddress.line2": undefined,
    "shippingAddress.phone": undefined,
  };
  const unset = Object.fromEntries(
    Object.entries(scrubbedAddress)
      .filter(([, value]) => value === undefined)
      .map(([key]) => [key, ""]),
  );
  const set = Object.fromEntries(
    Object.entries(scrubbedAddress).filter(([, value]) => value !== undefined),
  );

  await revokeAllUserSessions(userId);
  await Promise.all([
    User.updateOne(
      { _id: userId },
      {
        $set: {
          addresses: [],
          anonymizedAt: new Date(),
          "crm.notes": [],
          "crm.tags": [],
          email: anonymousEmail,
          firstName: "Deleted",
          lastName: "Customer",
          notificationPreferences: {},
          passwordHash: await hashPassword(crypto.randomBytes(32).toString("hex")),
          status: "deleted",
          whatsappOptIn: false,
        },
        $unset: { phone: "", referralCode: "", totpSecret: "", wholesaleProfile: "" },
      },
    ),
    // Place of supply (city/state/PIN) stays on orders for GST; identity fields are removed.
    Order.updateMany({ userId }, { $set: set, $unset: unset }),
    PaymentSession.updateMany(
      { userId },
      { $unset: { guestEmail: "", manualScreenshot: "", upiReference: "" } },
    ),
    PaymentHistory.updateMany(
      { paymentSessionId: { $in: await PaymentSession.find({ userId }).distinct("_id") } },
      { $unset: { "metadata.upiReference": "" } },
    ),
    ProductReview.updateMany(
      { userId },
      { $set: { guestName: "Former customer" }, $unset: { guestEmail: "", photos: "" } },
    ),
    SupportTicket.updateMany(
      { email: originalEmail },
      {
        $set: { email: anonymousEmail, name: "Deleted customer" },
        $unset: { ipAddress: "", phone: "" },
      },
    ),
    NotificationLog.updateMany({ to: originalEmail }, { $set: { to: anonymousEmail } }),
    NewsletterSubscriber.deleteMany({ email: originalEmail }),
    BackInStockSubscription.deleteMany({ email: originalEmail }),
    AbandonedCartEvent.deleteMany({ $or: [{ userId }, { email: originalEmail }] }),
    Cart.deleteMany({ userId }),
    Wishlist.deleteMany({ userId }),
  ]);

  request.status = "completed";
  request.email = anonymousEmail;
  request.processedBy = new Types.ObjectId(input.adminUserId);
  request.completedAt = new Date();
  request.resolutionNote = input.note;
  await request.save();

  await enqueueNotification({
    channel: "email",
    eventType: "privacy_deletion_completed",
    fallback: {
      subject: "Your The Vastra House account has been deleted",
      text: "Your account and personal data have been deleted. Tax records of past purchases are retained in anonymised form as required by law.",
    },
    to: originalEmail,
    variables: {},
  });
  await writeAuditLog({
    action: "delete",
    actor: { actorId: new Types.ObjectId(input.adminUserId), actorType: "admin" },
    after: { anonymizedAt: new Date() },
    before: { requestNumber: request.requestNumber },
    entity: { displayId: request.requestNumber, id: new Types.ObjectId(userId), type: "user" },
    metadata: { privacyRequest: request.requestNumber },
  });

  return request;
}

import { Router } from "express";
import { z } from "zod";
import { attachOptionalUser } from "../middleware/authMiddleware.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { validateRequest } from "../middleware/validateRequest.js";
import { Order } from "../models/Order.js";
import { PaymentSession } from "../models/PaymentSession.js";
import { createOrderFromCheckout, previewCheckout } from "../services/checkoutService.js";
import {
  createBalancePaymentForOrder,
  getRazorpayPublicConfig,
  verifyRazorpayPayment,
} from "../services/paymentService.js";

export const checkoutRouter = Router();

const addressSchema = z
  .object({
    fullName: z.string().max(120).optional(),
    company: z.string().max(120).optional(),
    line1: z.string().min(1).max(180),
    line2: z.string().max(180).optional(),
    city: z.string().min(1).max(100),
    region: z.string().max(100).optional(),
    postalCode: z.string().max(20).optional(),
    countryCode: z.string().length(2),
    phone: z.string().max(30).optional(),
  })
  .strict();

const checkoutSchema = z
  .object({
    shippingAddress: addressSchema,
    billingAddress: addressSchema.optional(),
    guestEmail: z.string().email().optional(),
    whatsappOptIn: z.boolean().optional(),
    shippingMethod: z.enum(["standard", "express"]),
    // v1 storefront policy (FR-PAY-01): Razorpay full payment or secured COD only.
    // Manual bank transfer / direct UPI remain admin-side operational capabilities.
    paymentMethod: z.enum(["razorpay", "cod", "credit_terms"]),
    paymentMode: z.enum(["full", "advance", "balance"]).optional(),
    payableNow: z.coerce.number().positive().optional(),
    couponCode: z.string().max(80).optional(),
    storeCreditRequested: z.coerce.number().nonnegative().optional(),
    rewardValueRequested: z.coerce.number().nonnegative().optional(),
    notes: z.string().max(500).optional(),
    saveAddress: z.boolean().optional(),
    marketingConsent: z.boolean().optional(),
  })
  .strict();

checkoutRouter.use(attachOptionalUser);

const orderCreationLimit = rateLimit({
  keyPrefix: "checkout-order-create",
  windowMs: 15 * 60 * 1000,
  max: 20,
});

const paymentConfirmLimit = rateLimit({
  keyPrefix: "checkout-payment-confirm",
  windowMs: 15 * 60 * 1000,
  max: 30,
});

checkoutRouter.get("/razorpay/config", async (_req, res, next) => {
  try {
    res.json(await getRazorpayPublicConfig());
  } catch (error) {
    next(error);
  }
});

checkoutRouter.post(
  "/preview",
  validateRequest({
    body: checkoutSchema.omit({ paymentMethod: true }),
  }),
  async (req, res, next) => {
    try {
      res.json({
        checkout: await previewCheckout({
          ...req.body,
          guestSessionId: req.header("X-Guest-Session-Id"),
          userId: req.user?.id,
        }),
      });
    } catch (error) {
      next(error);
    }
  },
);

checkoutRouter.post(
  "/orders",
  orderCreationLimit,
  validateRequest({ body: checkoutSchema }),
  async (req, res, next) => {
    try {
      const result = await createOrderFromCheckout({
        ...req.body,
        guestSessionId: req.header("X-Guest-Session-Id"),
        ipAddress: req.ip,
        userId: req.user?.id,
      });
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  },
);

checkoutRouter.post(
  "/razorpay/confirm",
  paymentConfirmLimit,
  validateRequest({
    body: z
      .object({
        razorpayOrderId: z.string().min(3),
        razorpayPaymentId: z.string().min(3),
        razorpaySignature: z.string().min(10),
      })
      .strict(),
  }),
  async (req, res, next) => {
    try {
      const session = await verifyRazorpayPayment({
        ...req.body,
        actorId: req.user?.id,
      });
      const order = await Order.findOne({ paymentSessionId: session._id });

      res.json({ order, session });
    } catch (error) {
      next(error);
    }
  },
);

checkoutRouter.post(
  "/orders/:orderNumber/balance/razorpay",
  validateRequest({
    body: z.object({ guestEmail: z.string().email().optional() }).strict(),
    params: z.object({ orderNumber: z.string().min(3) }).strict(),
  }),
  async (req, res, next) => {
    try {
      const result = await createBalancePaymentForOrder({
        guestEmail: req.body.guestEmail,
        guestSessionId: req.header("X-Guest-Session-Id"),
        orderNumber: String(req.params.orderNumber),
        userId: req.user?.id,
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);

checkoutRouter.get("/orders/:orderNumber", async (req, res, next) => {
  try {
    const guestSessionId = req.header("X-Guest-Session-Id");
    if (!req.user?.id && !guestSessionId) {
      res.status(401).json({ error: { message: "Authentication or guest session is required" } });
      return;
    }
    const order = (await Order.findOne({
      orderNumber: req.params.orderNumber,
      ...(req.user?.id ? { userId: req.user.id } : { guestSessionId }),
    }).lean()) as { paymentSessionId?: unknown } | null;

    if (!order) {
      res.status(404).json({ error: { message: "Order not found" } });
      return;
    }

    const paymentSession = order.paymentSessionId
      ? await PaymentSession.findById(order.paymentSessionId).lean()
      : null;

    res.json({ order, paymentSession });
  } catch (error) {
    next(error);
  }
});

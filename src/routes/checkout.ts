import { Router } from "express";
import { z } from "zod";
import { env } from "../config/env.js";
import { attachOptionalUser } from "../middleware/authMiddleware.js";
import { validateRequest } from "../middleware/validateRequest.js";
import { Order } from "../models/Order.js";
import { PaymentSession } from "../models/PaymentSession.js";
import { createOrderFromCheckout, previewCheckout } from "../services/checkoutService.js";
import { createBalancePaymentForOrder, verifyRazorpayPayment } from "../services/paymentService.js";
import { getRuntimeBooleanSetting, getRuntimeSetting } from "../services/runtimeSettingsService.js";

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
    shippingMethod: z.enum(["standard", "express"]),
    paymentMethod: z.enum(["razorpay", "cod", "manual_bank_transfer", "upi"]),
    paymentMode: z.enum(["full", "advance", "balance"]).optional(),
    payableNow: z.coerce.number().positive().optional(),
    couponCode: z.string().max(80).optional(),
    storeCreditRequested: z.coerce.number().nonnegative().optional(),
    rewardValueRequested: z.coerce.number().nonnegative().optional(),
    manualScreenshot: z
      .object({
        url: z.string().url(),
        type: z.literal("image"),
        aspectRatio: z.string().optional(),
        altText: z.string().max(160).optional(),
      })
      .strict()
      .optional(),
    upiReference: z.string().max(120).optional(),
    notes: z.string().max(500).optional(),
  })
  .strict();

checkoutRouter.use(attachOptionalUser);

checkoutRouter.get("/razorpay/config", async (_req, res, next) => {
  try {
    res.json({
      gatewayEnabled: await getRuntimeBooleanSetting(
        "RAZORPAY_ENABLE_GATEWAY_CALLS",
        env.RAZORPAY_ENABLE_GATEWAY_CALLS,
      ),
      keyId: (await getRuntimeSetting("RAZORPAY_KEY_ID")) ?? env.RAZORPAY_KEY_ID ?? "",
    });
  } catch (error) {
    next(error);
  }
});

checkoutRouter.post(
  "/preview",
  validateRequest({
    body: checkoutSchema.omit({ paymentMethod: true, manualScreenshot: true, upiReference: true }),
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
  validateRequest({ body: checkoutSchema }),
  async (req, res, next) => {
    try {
      const result = await createOrderFromCheckout({
        ...req.body,
        guestSessionId: req.header("X-Guest-Session-Id"),
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
    const order = (await Order.findOne({
      orderNumber: req.params.orderNumber,
      ...(req.user?.id ? { userId: req.user.id } : {}),
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

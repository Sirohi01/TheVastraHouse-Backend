import type { Request } from "express";
import { Router } from "express";
import { z } from "zod";
import { attachOptionalUser, requireAuth } from "../middleware/authMiddleware.js";
import { validateRequest } from "../middleware/validateRequest.js";
import {
  addCartItem,
  addWishlistItem,
  getOrCreateCart,
  getOrCreateWishlist,
  mergeGuestCartIntoUserCart,
  removeCartItem,
  removeWishlistItem,
  setGiftPackaging,
  updateCartItemPurchaseMode,
  updateCartItemQuantity,
  validateGiftCardForCart,
  type CommerceIdentity,
} from "../services/cartService.js";

export const commerceRouter = Router();

const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i);
const guestSessionSchema = z.string().min(12).max(128);
const addItemSchema = z
  .object({
    productId: objectIdSchema,
    purchaseMode: z.enum(["regular", "pre_order"]).optional(),
    variantId: objectIdSchema,
    quantity: z.coerce.number().int().min(1).max(99).default(1),
  })
  .strict();
const wishlistItemSchema = addItemSchema.omit({ quantity: true });

commerceRouter.use(attachOptionalUser);

commerceRouter.get("/cart", async (req, res, next) => {
  try {
    res.json({ cart: await getOrCreateCart(getCommerceIdentity(req)) });
  } catch (error) {
    next(error);
  }
});

commerceRouter.post(
  "/cart/items",
  validateRequest({ body: addItemSchema }),
  async (req, res, next) => {
    try {
      res.status(201).json({ cart: await addCartItem(getCommerceIdentity(req), req.body) });
    } catch (error) {
      next(error);
    }
  },
);

commerceRouter.patch(
  "/cart/items/:lineItemId/purchase-mode",
  validateRequest({
    body: z.object({ purchaseMode: z.enum(["regular", "pre_order"]) }).strict(),
    params: z.object({ lineItemId: objectIdSchema }).strict(),
  }),
  async (req, res, next) => {
    try {
      res.json({
        cart: await updateCartItemPurchaseMode(
          getCommerceIdentity(req),
          String(req.params.lineItemId),
          req.body.purchaseMode,
        ),
      });
    } catch (error) {
      next(error);
    }
  },
);

commerceRouter.patch(
  "/cart/items/:lineItemId",
  validateRequest({
    body: z.object({ quantity: z.coerce.number().int().min(1).max(99) }).strict(),
    params: z.object({ lineItemId: objectIdSchema }).strict(),
  }),
  async (req, res, next) => {
    try {
      res.json({
        cart: await updateCartItemQuantity(
          getCommerceIdentity(req),
          String(req.params.lineItemId),
          req.body.quantity,
        ),
      });
    } catch (error) {
      next(error);
    }
  },
);

commerceRouter.delete(
  "/cart/items/:lineItemId",
  validateRequest({ params: z.object({ lineItemId: objectIdSchema }).strict() }),
  async (req, res, next) => {
    try {
      res.json({
        cart: await removeCartItem(getCommerceIdentity(req), String(req.params.lineItemId)),
      });
    } catch (error) {
      next(error);
    }
  },
);

commerceRouter.patch(
  "/cart/gift-packaging",
  validateRequest({ body: z.object({ enabled: z.boolean() }).strict() }),
  async (req, res, next) => {
    try {
      res.json({ cart: await setGiftPackaging(getCommerceIdentity(req), req.body.enabled) });
    } catch (error) {
      next(error);
    }
  },
);

commerceRouter.post(
  "/cart/gift-cards/validate",
  validateRequest({ body: z.object({ code: z.string().min(3).max(64) }).strict() }),
  async (req, res, next) => {
    try {
      res.json({ cart: await validateGiftCardForCart(getCommerceIdentity(req), req.body.code) });
    } catch (error) {
      next(error);
    }
  },
);

commerceRouter.post(
  "/cart/merge",
  requireAuth,
  validateRequest({ body: z.object({ guestSessionId: guestSessionSchema }).strict() }),
  async (req, res, next) => {
    try {
      res.json({ cart: await mergeGuestCartIntoUserCart(req.body.guestSessionId, req.user!.id) });
    } catch (error) {
      next(error);
    }
  },
);

commerceRouter.get("/wishlist", async (req, res, next) => {
  try {
    res.json({ wishlist: await getOrCreateWishlist(getCommerceIdentity(req)) });
  } catch (error) {
    next(error);
  }
});

commerceRouter.post(
  "/wishlist/items",
  validateRequest({ body: wishlistItemSchema }),
  async (req, res, next) => {
    try {
      res.status(201).json({ wishlist: await addWishlistItem(getCommerceIdentity(req), req.body) });
    } catch (error) {
      next(error);
    }
  },
);

commerceRouter.delete(
  "/wishlist/items/:lineItemId",
  validateRequest({ params: z.object({ lineItemId: objectIdSchema }).strict() }),
  async (req, res, next) => {
    try {
      res.json({
        wishlist: await removeWishlistItem(getCommerceIdentity(req), String(req.params.lineItemId)),
      });
    } catch (error) {
      next(error);
    }
  },
);

function getCommerceIdentity(req: Request): CommerceIdentity {
  return {
    guestSessionId: req.header("X-Guest-Session-Id") ?? undefined,
    userId: req.user?.id,
  };
}

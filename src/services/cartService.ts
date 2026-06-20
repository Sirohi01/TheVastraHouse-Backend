import { Types } from "mongoose";
import { env } from "../config/env.js";
import { AbandonedCartEvent } from "../models/AbandonedCartEvent.js";
import { Cart } from "../models/Cart.js";
import { GiftCard } from "../models/GiftCard.js";
import { Product } from "../models/Product.js";
import { Wishlist } from "../models/Wishlist.js";
import { AppError } from "../middleware/errorHandler.js";
import { getAvailableStockBySku } from "./inventoryService.js";
import { isPreOrderActive, type PreOrderVariantSnapshot } from "./preOrderService.js";
import { getRuntimeNumberSetting } from "./runtimeSettingsService.js";

export type CommerceIdentity = {
  userId?: string;
  guestSessionId?: string;
};

export type AddCartItemInput = {
  productId: string;
  purchaseMode?: PurchaseMode;
  variantId: string;
  quantity: number;
};

export type PurchaseMode = "regular" | "pre_order";

type ProductVariantSnapshot = {
  productId: Types.ObjectId;
  variantId: Types.ObjectId;
  productName: string;
  slug: string;
  sku: string;
  purchaseMode: PurchaseMode;
  color?: string;
  size?: string;
  barcode?: string;
  media?: unknown;
  unitPrice: number;
  currencyCode: string;
  hsnCode: string;
  gstRate: number;
  stock: number;
  preOrder?: PreOrderVariantSnapshot;
  preOrderOption?: PreOrderVariantSnapshot;
};

type CartLine = {
  _id?: unknown;
  productId: unknown;
  variantId: unknown;
  productName: string;
  slug: string;
  sku: string;
  purchaseMode?: PurchaseMode;
  color?: string;
  size?: string;
  barcode?: string;
  media?: unknown;
  unitPrice: number;
  currencyCode: string;
  hsnCode?: string;
  gstRate?: number;
  quantity: number;
  stockSnapshot: number;
  preOrder?: PreOrderVariantSnapshot;
  preOrderOption?: PreOrderVariantSnapshot;
  priceSnapshotAt?: Date;
  deleteOne: () => void;
};

type WishlistLine = {
  _id?: unknown;
  productId: unknown;
  variantId: unknown;
  priceSnapshot: number;
  stockSnapshot: number;
  currentPrice: number;
  currentStock: number;
  priceChanged: boolean;
  stockChanged: boolean;
  checkedAt: Date;
  deleteOne: () => void;
};

type ProductLean = {
  hsnCode: string;
  gstRate: number;
  name: string;
  slug: string;
  media?: unknown[];
  variants: Array<{
    _id: Types.ObjectId;
    active?: boolean;
    color?: string;
    size?: string;
    barcode?: string;
    sku: string;
    basePrice: number;
    salePrice?: number;
    currencyCode?: string;
    stockPlaceholder?: number;
    preOrder?: PreOrderVariantSnapshot;
    media?: unknown[];
  }>;
};

export function assertCommerceIdentity(identity: CommerceIdentity): CommerceIdentity {
  if (!identity.userId && !identity.guestSessionId) {
    throw new AppError("Guest session or authentication is required", 401);
  }

  return identity;
}

export async function getOrCreateCart(identity: CommerceIdentity) {
  assertCommerceIdentity(identity);
  const filter = identity.userId
    ? { userId: identity.userId }
    : { guestSessionId: identity.guestSessionId };
  const existing = await Cart.findOne(filter);

  if (existing) {
    await refreshCartLineSnapshots(existing);
    existing.totals = await calculateCartTotals(existing);
    await existing.save();
    return existing;
  }

  const cart = await Cart.create({
    ...filter,
    giftPackaging: { enabled: false, fee: 0 },
    items: [],
    lastActivityAt: new Date(),
  });
  cart.totals = await calculateCartTotals(cart);
  await cart.save();
  return cart;
}

export async function addCartItem(identity: CommerceIdentity, input: AddCartItemInput) {
  const cart = await getOrCreateCart(identity);
  const purchaseMode = normalizePurchaseMode(input.purchaseMode);
  const snapshot = await getProductVariantSnapshot(input.productId, input.variantId, purchaseMode);

  if (snapshot.stock < input.quantity) {
    throw new AppError("Requested quantity is not available", 409);
  }

  const existingLine = cartLines(cart).find(
    (item) =>
      String(item.variantId) === input.variantId &&
      normalizePurchaseMode(item.purchaseMode) === purchaseMode,
  );

  if (existingLine) {
    const nextQuantity = existingLine.quantity + input.quantity;
    if (snapshot.stock < nextQuantity) {
      throw new AppError("Requested quantity is not available", 409);
    }
    existingLine.quantity = nextQuantity;
    existingLine.unitPrice = snapshot.unitPrice;
    existingLine.productName = snapshot.productName;
    existingLine.slug = snapshot.slug;
    existingLine.sku = snapshot.sku;
    existingLine.purchaseMode = snapshot.purchaseMode;
    existingLine.color = snapshot.color;
    existingLine.size = snapshot.size;
    existingLine.barcode = snapshot.barcode;
    existingLine.media = snapshot.media;
    existingLine.hsnCode = snapshot.hsnCode;
    existingLine.gstRate = snapshot.gstRate;
    existingLine.stockSnapshot = snapshot.stock;
    existingLine.preOrder = snapshot.preOrder;
    existingLine.preOrderOption = snapshot.preOrderOption;
  } else {
    cart.items.push({
      productId: snapshot.productId,
      variantId: snapshot.variantId,
      productName: snapshot.productName,
      slug: snapshot.slug,
      sku: snapshot.sku,
      purchaseMode: snapshot.purchaseMode,
      color: snapshot.color,
      size: snapshot.size,
      barcode: snapshot.barcode,
      media: snapshot.media,
      unitPrice: snapshot.unitPrice,
      currencyCode: snapshot.currencyCode,
      hsnCode: snapshot.hsnCode,
      gstRate: snapshot.gstRate,
      quantity: input.quantity,
      stockSnapshot: snapshot.stock,
      preOrder: snapshot.preOrder,
      preOrderOption: snapshot.preOrderOption,
      priceSnapshotAt: new Date(),
    });
  }

  return saveCartActivity(cart);
}

export async function updateCartItemQuantity(
  identity: CommerceIdentity,
  lineItemId: string,
  quantity: number,
) {
  const cart = await getOrCreateCart(identity);
  const line = findCartLine(cart, lineItemId);

  if (!line) {
    throw new AppError("Cart line item not found", 404);
  }

  const snapshot = await getProductVariantSnapshot(
    String(line.productId),
    String(line.variantId),
    normalizePurchaseMode(line.purchaseMode),
  );

  if (snapshot.stock < quantity) {
    throw new AppError("Requested quantity is not available", 409);
  }

  line.quantity = quantity;
  line.unitPrice = snapshot.unitPrice;
  line.productName = snapshot.productName;
  line.slug = snapshot.slug;
  line.sku = snapshot.sku;
  line.purchaseMode = snapshot.purchaseMode;
  line.color = snapshot.color;
  line.size = snapshot.size;
  line.barcode = snapshot.barcode;
  line.media = snapshot.media;
  line.hsnCode = snapshot.hsnCode;
  line.gstRate = snapshot.gstRate;
  line.stockSnapshot = snapshot.stock;
  line.preOrder = snapshot.preOrder;
  line.preOrderOption = snapshot.preOrderOption;

  return saveCartActivity(cart);
}

export async function updateCartItemPurchaseMode(
  identity: CommerceIdentity,
  lineItemId: string,
  purchaseMode: PurchaseMode,
) {
  const cart = await getOrCreateCart(identity);
  const line = findCartLine(cart, lineItemId);

  if (!line) {
    throw new AppError("Cart line item not found", 404);
  }

  const nextMode = normalizePurchaseMode(purchaseMode);
  const snapshot = await getProductVariantSnapshot(
    String(line.productId),
    String(line.variantId),
    nextMode,
  );

  if (snapshot.stock < line.quantity) {
    throw new AppError("Requested quantity is not available", 409);
  }

  const existing = cartLines(cart).find(
    (item) =>
      String(item._id) !== String(line._id) &&
      String(item.variantId) === String(line.variantId) &&
      normalizePurchaseMode(item.purchaseMode) === nextMode,
  );

  if (existing) {
    const nextQuantity = existing.quantity + line.quantity;
    if (snapshot.stock < nextQuantity) {
      throw new AppError("Requested quantity is not available", 409);
    }
    existing.quantity = nextQuantity;
    applySnapshotToLine(existing, snapshot);
    line.deleteOne();
  } else {
    applySnapshotToLine(line, snapshot);
  }

  return saveCartActivity(cart);
}

export async function removeCartItem(identity: CommerceIdentity, lineItemId: string) {
  const cart = await getOrCreateCart(identity);
  const line = findCartLine(cart, lineItemId);

  if (!line) {
    throw new AppError("Cart line item not found", 404);
  }

  line.deleteOne();
  return saveCartActivity(cart);
}

export async function setGiftPackaging(identity: CommerceIdentity, enabled: boolean) {
  const cart = await getOrCreateCart(identity);
  const fee = await getRuntimeNumberSetting("CART_GIFT_PACKAGING_FEE", env.CART_GIFT_PACKAGING_FEE);
  cart.giftPackaging = {
    enabled,
    fee: enabled ? fee : 0,
  };

  return saveCartActivity(cart);
}

export async function validateGiftCardForCart(identity: CommerceIdentity, code: string) {
  const cart = await getOrCreateCart(identity);
  const normalizedCode = code.trim().toUpperCase();
  const giftCard = await GiftCard.findOne({ code: normalizedCode });

  if (
    !giftCard ||
    giftCard.status !== "active" ||
    giftCard.balance <= 0 ||
    (giftCard.expiresAt && giftCard.expiresAt.getTime() < Date.now())
  ) {
    throw new AppError("Gift card is not valid for redemption", 400);
  }

  cart.giftCardRedemptions = [
    {
      code: normalizedCode,
      amount: giftCard.balance,
      currencyCode: giftCard.currencyCode,
    },
  ];

  return saveCartActivity(cart);
}

export async function mergeGuestCartIntoUserCart(guestSessionId: string, userId: string) {
  const guestCart = await Cart.findOne({ guestSessionId });
  const userCart = await getOrCreateCart({ userId });

  if (!guestCart || String(guestCart._id) === String(userCart._id)) {
    return userCart;
  }

  for (const guestLine of guestCart.items) {
    const mode = normalizePurchaseMode(guestLine.purchaseMode);
    const existing = cartLines(userCart).find(
      (line) =>
        String(line.variantId) === String(guestLine.variantId) &&
        normalizePurchaseMode(line.purchaseMode) === mode,
    );
    const snapshot = await getProductVariantSnapshot(
      String(guestLine.productId),
      String(guestLine.variantId),
      mode,
    );

    if (existing) {
      existing.quantity = Math.min(snapshot.stock, existing.quantity + guestLine.quantity);
      existing.unitPrice = snapshot.unitPrice;
      existing.productName = snapshot.productName;
      existing.slug = snapshot.slug;
      existing.sku = snapshot.sku;
      existing.purchaseMode = snapshot.purchaseMode;
      existing.color = snapshot.color;
      existing.size = snapshot.size;
      existing.barcode = snapshot.barcode;
      existing.media = snapshot.media;
      existing.hsnCode = snapshot.hsnCode;
      existing.gstRate = snapshot.gstRate;
      existing.stockSnapshot = snapshot.stock;
      existing.preOrder = snapshot.preOrder;
      existing.preOrderOption = snapshot.preOrderOption;
    } else if (snapshot.stock > 0) {
      userCart.items.push({
        productId: snapshot.productId,
        variantId: snapshot.variantId,
        productName: snapshot.productName,
        slug: snapshot.slug,
        sku: snapshot.sku,
        purchaseMode: snapshot.purchaseMode,
        color: snapshot.color,
        size: snapshot.size,
        barcode: snapshot.barcode,
        media: snapshot.media,
        unitPrice: snapshot.unitPrice,
        currencyCode: snapshot.currencyCode,
        hsnCode: snapshot.hsnCode,
        gstRate: snapshot.gstRate,
        quantity: Math.min(snapshot.stock, guestLine.quantity),
        stockSnapshot: snapshot.stock,
        preOrder: snapshot.preOrder,
        preOrderOption: snapshot.preOrderOption,
        priceSnapshotAt: new Date(),
      });
    }
  }

  if (guestCart.giftPackaging?.enabled) {
    userCart.giftPackaging = guestCart.giftPackaging;
  }
  userCart.giftCardRedemptions = guestCart.giftCardRedemptions;
  await saveCartActivity(userCart);
  await Cart.deleteOne({ _id: guestCart._id });

  return userCart;
}

export async function getOrCreateWishlist(identity: CommerceIdentity) {
  assertCommerceIdentity(identity);
  const filter = identity.userId
    ? { userId: identity.userId }
    : { guestSessionId: identity.guestSessionId };
  const existing = await Wishlist.findOne(filter);

  return existing ?? Wishlist.create({ ...filter, items: [] });
}

export async function addWishlistItem(
  identity: CommerceIdentity,
  input: Omit<AddCartItemInput, "quantity">,
) {
  const wishlist = await getOrCreateWishlist(identity);
  const snapshot = await getProductVariantSnapshot(input.productId, input.variantId);
  const existing = wishlistLines(wishlist).find(
    (item) => String(item.variantId) === input.variantId,
  );

  if (!existing) {
    wishlist.items.push({
      productId: snapshot.productId,
      variantId: snapshot.variantId,
      productName: snapshot.productName,
      slug: snapshot.slug,
      sku: snapshot.sku,
      media: snapshot.media,
      priceSnapshot: snapshot.unitPrice,
      currentPrice: snapshot.unitPrice,
      stockSnapshot: snapshot.stock,
      currentStock: snapshot.stock,
      priceChanged: false,
      stockChanged: false,
      addedAt: new Date(),
      checkedAt: new Date(),
    });
    await wishlist.save();
  }

  return wishlist;
}

export async function removeWishlistItem(identity: CommerceIdentity, lineItemId: string) {
  const wishlist = await getOrCreateWishlist(identity);
  const item = findWishlistLine(wishlist, lineItemId);

  if (!item) {
    throw new AppError("Wishlist item not found", 404);
  }

  item.deleteOne();
  await wishlist.save();
  return wishlist;
}

export async function refreshWishlistSignals() {
  const wishlists = await Wishlist.find({});
  let updatedItems = 0;

  for (const wishlist of wishlists) {
    for (const item of wishlist.items) {
      try {
        const snapshot = await getProductVariantSnapshot(
          String(item.productId),
          String(item.variantId),
        );
        item.currentPrice = snapshot.unitPrice;
        item.currentStock = snapshot.stock;
        item.priceChanged = item.priceSnapshot !== snapshot.unitPrice;
        item.stockChanged = item.stockSnapshot !== snapshot.stock;
        item.checkedAt = new Date();
        updatedItems += 1;
      } catch {
        item.currentStock = 0;
        item.stockChanged = item.stockSnapshot !== 0;
        item.checkedAt = new Date();
        updatedItems += 1;
      }
    }
    await wishlist.save();
  }

  return { wishlistsChecked: wishlists.length, updatedItems };
}

export function startAbandonedCartJob() {
  const interval = setInterval(
    () => {
      emitAbandonedCartEvents().catch(() => undefined);
    },
    env.ABANDONED_CART_JOB_INTERVAL_MINUTES * 60 * 1000,
  );

  return interval;
}

export function startWishlistSignalJob() {
  const interval = setInterval(
    () => {
      refreshWishlistSignals().catch(() => undefined);
    },
    env.WISHLIST_SIGNAL_JOB_INTERVAL_MINUTES * 60 * 1000,
  );

  return interval;
}

export async function emitAbandonedCartEvents(now = new Date()) {
  const cutoff = new Date(now.getTime() - env.ABANDONED_CART_THRESHOLD_MINUTES * 60 * 1000);
  const carts = await Cart.find({
    abandonedCartEventEmittedAt: { $exists: false },
    "items.0": { $exists: true },
    lastActivityAt: { $lte: cutoff },
  });
  let emitted = 0;

  for (const cart of carts) {
    await AbandonedCartEvent.create({
      cartId: cart._id,
      userId: cart.userId,
      guestSessionId: cart.guestSessionId,
      itemCount: cartLines(cart).reduce(
        (total: number, item: CartLine) => total + item.quantity,
        0,
      ),
      subtotal: cart.totals?.subtotal ?? 0,
      currencyCode: cart.totals?.currencyCode ?? "INR",
      emittedAt: now,
    });
    cart.abandonedCartEventEmittedAt = now;
    await cart.save();
    emitted += 1;
  }

  return { cartsChecked: carts.length, emitted };
}

async function saveCartActivity(cart: Awaited<ReturnType<typeof getOrCreateCart>>) {
  cart.lastActivityAt = new Date();
  cart.abandonedCartEventEmittedAt = undefined;
  cart.totals = await calculateCartTotals(cart);
  await cart.save();
  return cart;
}

async function refreshCartLineSnapshots(cart: Awaited<ReturnType<typeof getOrCreateCart>>) {
  for (const line of cartLines(cart)) {
    const mode = normalizePurchaseMode(
      line.purchaseMode ?? (line.preOrder?.enabled ? "pre_order" : "regular"),
    );

    try {
      const snapshot = await getProductVariantSnapshot(
        String(line.productId),
        String(line.variantId),
        mode,
      );
      applySnapshotToLine(line, snapshot);
    } catch {
      line.purchaseMode = mode;
    }
  }
}

async function calculateCartTotals(cart: Awaited<ReturnType<typeof getOrCreateCart>>) {
  const lines = cartLines(cart);
  const redemptions = cart.giftCardRedemptions as Array<{ amount: number }>;
  const subtotal = lines.reduce(
    (total: number, item: CartLine) => total + item.unitPrice * item.quantity,
    0,
  );
  const taxBreakdown = new Map<number, { taxableAmount: number; gstAmount: number }>();

  for (const line of lines) {
    const gstRate = line.gstRate ?? 0;
    const lineSubtotal = roundMoney(line.unitPrice * line.quantity);
    const taxableAmount = roundMoney(lineSubtotal / (1 + gstRate / 100));
    const gstAmount = roundMoney(lineSubtotal - taxableAmount);
    const current = taxBreakdown.get(gstRate) ?? { gstAmount: 0, taxableAmount: 0 };

    taxBreakdown.set(gstRate, {
      gstAmount: roundMoney(current.gstAmount + gstAmount),
      taxableAmount: roundMoney(current.taxableAmount + taxableAmount),
    });
  }

  const giftPackagingFee = cart.giftPackaging?.enabled ? (cart.giftPackaging.fee ?? 0) : 0;
  const availableTotal = subtotal + giftPackagingFee;
  const giftCardDiscount = Math.min(
    availableTotal,
    redemptions.reduce(
      (total: number, redemption: { amount: number }) => total + redemption.amount,
      0,
    ),
  );

  return {
    subtotal,
    giftPackagingFee,
    giftCardDiscount,
    grandTotal: Math.max(0, availableTotal - giftCardDiscount),
    gstAmount: roundMoney(
      [...taxBreakdown.values()].reduce((total, item) => total + item.gstAmount, 0),
    ),
    taxableAmount: roundMoney(
      [...taxBreakdown.values()].reduce((total, item) => total + item.taxableAmount, 0),
    ),
    taxBreakdown: [...taxBreakdown.entries()].map(([gstRate, value]) => ({
      gstRate,
      ...value,
    })),
    currencyCode: lines[0]?.currencyCode ?? "INR",
  };
}

async function getProductVariantSnapshot(
  productId: string,
  variantId: string,
  purchaseMode: PurchaseMode = "regular",
): Promise<ProductVariantSnapshot> {
  const product = (await Product.findOne({
    _id: productId,
    active: true,
    status: { $ne: "deleted" },
  }).lean()) as ProductLean | null;

  if (!product) {
    throw new AppError("Product not found", 404);
  }

  const variant = product.variants.find(
    (item) => String(item._id) === variantId && item.active !== false,
  );

  if (!variant) {
    throw new AppError("Product variant not found", 404);
  }

  const inventoryAvailable = await getAvailableStockBySku(variant.sku);
  const preOrderActive = isPreOrderActive(variant.preOrder);
  const regularStock = inventoryAvailable ?? variant.stockPlaceholder ?? 0;

  if (purchaseMode === "pre_order" && !preOrderActive) {
    throw new AppError("Variant is not available for pre-order", 409);
  }

  return {
    productId: new Types.ObjectId(productId),
    variantId: new Types.ObjectId(variantId),
    productName: product.name,
    slug: product.slug,
    sku: variant.sku,
    purchaseMode,
    color: variant.color,
    size: variant.size,
    barcode: variant.barcode,
    media: (variant.media?.[0] ?? product.media?.[0]) as unknown,
    preOrder: purchaseMode === "pre_order" ? variant.preOrder : undefined,
    preOrderOption: preOrderActive ? variant.preOrder : undefined,
    unitPrice: variant.salePrice ?? variant.basePrice,
    hsnCode: product.hsnCode,
    gstRate: product.gstRate,
    currencyCode: variant.currencyCode ?? "INR",
    stock: purchaseMode === "pre_order" ? (variant.preOrder?.remainingQuantity ?? 0) : regularStock,
  };
}

function applySnapshotToLine(line: CartLine, snapshot: ProductVariantSnapshot) {
  line.unitPrice = snapshot.unitPrice;
  line.productName = snapshot.productName;
  line.slug = snapshot.slug;
  line.sku = snapshot.sku;
  line.purchaseMode = snapshot.purchaseMode;
  line.color = snapshot.color;
  line.size = snapshot.size;
  line.barcode = snapshot.barcode;
  line.media = snapshot.media;
  line.hsnCode = snapshot.hsnCode;
  line.gstRate = snapshot.gstRate;
  line.stockSnapshot = snapshot.stock;
  line.preOrder = snapshot.preOrder;
  line.preOrderOption = snapshot.preOrderOption;
}

function normalizePurchaseMode(value?: string): PurchaseMode {
  return value === "pre_order" ? "pre_order" : "regular";
}

function cartLines(cart: { items: unknown }): CartLine[] {
  return cart.items as CartLine[];
}

function wishlistLines(wishlist: { items: unknown }): WishlistLine[] {
  return wishlist.items as WishlistLine[];
}

function findCartLine(cart: { items: unknown }, lineItemId: string) {
  return cartLines(cart).find((line) => String(line._id) === lineItemId);
}

function findWishlistLine(wishlist: { items: unknown }, lineItemId: string) {
  return wishlistLines(wishlist).find((line) => String(line._id) === lineItemId);
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

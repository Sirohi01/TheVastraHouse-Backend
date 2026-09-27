import { Types } from "mongoose";
import { AppError } from "../middleware/errorHandler.js";
import { Brand } from "../models/Brand.js";
import { Order } from "../models/Order.js";
import { Product } from "../models/Product.js";
import { StockLedger } from "../models/StockLedger.js";
import { Warehouse } from "../models/Warehouse.js";
import { isPreOrderActive, type PreOrderVariantSnapshot } from "./preOrderService.js";

export const LOW_STOCK_DISPLAY_THRESHOLD = 5;

export type AvailabilityStatus = "in_stock" | "low_stock" | "out_of_stock" | "pre_order";

export type SkuAvailability = { available: number; lowStockThreshold: number };

type VariantLike = {
  _id?: unknown;
  sku: string;
  color?: string;
  size?: string;
  basePrice: number;
  salePrice?: number;
  costPrice?: number;
  priceTiers?: Array<{ priceListCode: string; price: number; currencyCode?: string }>;
  stockPlaceholder?: number;
  preOrder?: PreOrderVariantSnapshot & { quantityCap?: number };
  active?: boolean;
  media?: unknown[];
  [key: string]: unknown;
};

export type PublicViewer = {
  priceListCode?: string;
};

/** Sums sellable stock per SKU across all warehouses. SKUs without ledger rows have 0. */
export async function getAvailabilityBySkus(skus: string[]): Promise<Map<string, SkuAvailability>> {
  const normalized = [...new Set(skus.filter(Boolean).map((sku) => sku.trim().toUpperCase()))];
  const result = new Map<string, SkuAvailability>();

  if (!normalized.length) {
    return result;
  }

  const rows = (await StockLedger.aggregate([
    { $match: { sku: { $in: normalized } } },
    {
      $group: {
        _id: "$sku",
        available: { $sum: "$available" },
        lowStockThreshold: { $max: "$lowStockThreshold" },
      },
    },
  ])) as Array<{ _id: string; available: number; lowStockThreshold: number }>;

  for (const row of rows) {
    result.set(row._id, { available: row.available, lowStockThreshold: row.lowStockThreshold });
  }

  return result;
}

export function variantAvailability(
  variant: VariantLike,
  stock: SkuAvailability | undefined,
): { status: AvailabilityStatus; available: number; canPurchase: boolean; canPreOrder: boolean } {
  const available = Math.max(0, stock?.available ?? 0);
  const preOrderOpen =
    isPreOrderActive(variant.preOrder) && (variant.preOrder?.remainingQuantity ?? 0) > 0;

  if (variant.active === false) {
    return { available: 0, canPreOrder: false, canPurchase: false, status: "out_of_stock" };
  }

  if (available > 0) {
    const low = Math.max(stock?.lowStockThreshold ?? 0, LOW_STOCK_DISPLAY_THRESHOLD);
    return {
      available,
      canPreOrder: preOrderOpen,
      canPurchase: true,
      status: available <= low ? "low_stock" : "in_stock",
    };
  }

  return {
    available: 0,
    canPreOrder: preOrderOpen,
    canPurchase: false,
    status: preOrderOpen ? "pre_order" : "out_of_stock",
  };
}

/** Resolves the price a viewer pays: wholesale tier when their price list matches, else sale/base. */
export function resolveVariantPrice(variant: VariantLike, viewer?: PublicViewer) {
  const retail = variant.salePrice ?? variant.basePrice;

  if (viewer?.priceListCode) {
    const tier = variant.priceTiers?.find(
      (item) => item.priceListCode.toUpperCase() === viewer.priceListCode!.toUpperCase(),
    );
    if (tier) {
      return { price: tier.price, priceListCode: tier.priceListCode, retailPrice: retail };
    }
  }

  return { price: retail, priceListCode: undefined, retailPrice: retail };
}

/**
 * Storefront-safe product shape. Strips cost prices, wholesale price lists, placeholder stock
 * and internal merchandising metrics; adds ledger-backed availability per variant.
 */
export function serializePublicProduct(
  product: Record<string, unknown>,
  availability: Map<string, SkuAvailability>,
  viewer?: PublicViewer,
) {
  const {
    costPrice: _cost,
    merchandisingMetrics: _metrics,
    badgeOverrides: _overrides,
    __v: _version,
    deletedAt: _deletedAt,
    ...rest
  } = product as Record<string, unknown> & { costPrice?: unknown };
  const variants = ((product.variants as VariantLike[] | undefined) ?? []).map((variant) => {
    const {
      costPrice: _variantCost,
      priceTiers: _tiers,
      stockPlaceholder: _placeholder,
      ...publicVariant
    } = variant;
    const stock = availability.get(String(variant.sku).toUpperCase());
    const pricing = resolveVariantPrice(variant, viewer);
    return {
      ...publicVariant,
      availability: variantAvailability(variant, stock),
      ...(pricing.priceListCode
        ? { tierPrice: pricing.price, priceListCode: pricing.priceListCode }
        : {}),
    };
  });
  const statuses = variants.map((variant) => variant.availability.status);

  return {
    ...rest,
    availabilityStatus: statuses.includes("in_stock")
      ? "in_stock"
      : statuses.includes("low_stock")
        ? "low_stock"
        : statuses.includes("pre_order")
          ? "pre_order"
          : "out_of_stock",
    variants,
  };
}

export async function serializePublicProducts(
  products: Array<Record<string, unknown>>,
  viewer?: PublicViewer,
) {
  const skus = products.flatMap((product) =>
    ((product.variants as VariantLike[] | undefined) ?? []).map((variant) => variant.sku),
  );
  const availability = await getAvailabilityBySkus(skus);
  return products.map((product) => serializePublicProduct(product, availability, viewer));
}

/** Returns (creating on first use) the warehouse new SKUs are stocked into. */
export async function getDefaultWarehouse() {
  const existing = await Warehouse.findOne({ active: true, status: { $ne: "deleted" } })
    .sort({ createdAt: 1 })
    .lean();

  if (existing) {
    return existing as { _id: Types.ObjectId };
  }

  let brand = (await Brand.findOne({}).sort({ createdAt: 1 }).lean()) as unknown as { _id: Types.ObjectId } | null;

  if (!brand) {
    brand = (await Brand.create({ name: "The Vastra House", slug: "the-vastra-house" })).toObject();
  }

  const warehouse = await Warehouse.create({
    active: true,
    address: { city: "Jaipur", countryCode: "IN", line1: "Primary warehouse" },
    brandId: brand!._id,
    name: "Primary Warehouse",
  });

  return warehouse.toObject() as { _id: Types.ObjectId };
}

/**
 * Ensures every SKU of a product has an inventory ledger row. New SKUs are seeded with the
 * admin-entered opening stock; existing ledgers are never overwritten (stock changes go
 * through the Inventory module so they stay audited).
 */
export async function ensureLedgersForVariants(
  variants: Array<{ sku: string; initialStock?: number; stockPlaceholder?: number }>,
) {
  const skus = variants.map((variant) => variant.sku.toUpperCase());
  const existing = new Set(
    (await StockLedger.distinct("sku", { sku: { $in: skus } })) as string[],
  );
  const missing = variants.filter((variant) => !existing.has(variant.sku.toUpperCase()));

  if (!missing.length) {
    return 0;
  }

  const warehouse = await getDefaultWarehouse();
  const { upsertStockLedger } = await import("./inventoryService.js");

  for (const variant of missing) {
    await upsertStockLedger({
      actor: { actorType: "system" },
      available: Math.max(0, Math.floor(variant.initialStock ?? variant.stockPlaceholder ?? 0)),
      lowStockThreshold: 2,
      sku: variant.sku,
      warehouseId: String(warehouse._id),
    } as Parameters<typeof upsertStockLedger>[0]);
  }

  return missing.length;
}

/**
 * Merges an edited variant list into the stored one without regenerating ids. Variants are
 * matched by _id, then by SKU. Removed variants that appear on orders are archived
 * (active=false) rather than deleted so order history, carts and pre-order slots stay valid.
 */
export async function mergeVariantsPreservingIds(
  productId: string,
  incoming: Array<VariantLike & { _id?: string }>,
) {
  const product = (await Product.findById(productId).select("variants").lean()) as unknown as {
    variants: VariantLike[];
  } | null;

  if (!product) {
    throw new AppError("Product not found", 404);
  }

  const existing = product.variants ?? [];
  const usedIds = new Set<string>();
  const merged: VariantLike[] = incoming.map((variant) => {
    const match =
      (variant._id && existing.find((item) => String(item._id) === String(variant._id))) ||
      existing.find((item) => item.sku.toUpperCase() === variant.sku.toUpperCase() && !usedIds.has(String(item._id)));

    if (match) {
      usedIds.add(String(match._id));
      return {
        ...variant,
        _id: match._id,
        // Keep live pre-order counters unless the admin explicitly changed them.
        preOrder:
          variant.preOrder && variant.preOrder.remainingQuantity === undefined
            ? { ...variant.preOrder, remainingQuantity: match.preOrder?.remainingQuantity }
            : variant.preOrder,
      };
    }

    return { ...variant, _id: new Types.ObjectId() };
  });
  const removed = existing.filter((item) => !usedIds.has(String(item._id)));

  if (removed.length) {
    const referenced = new Set(
      (
        (await Order.distinct("items.variantId", {
          "items.variantId": { $in: removed.map((item) => item._id) },
        })) as unknown[]
      ).map(String),
    );

    for (const variant of removed) {
      if (referenced.has(String(variant._id))) {
        merged.push({ ...variant, active: false });
      }
    }
  }

  return merged;
}

/** Rejects SKUs duplicated within the request or already used by another product. */
export async function assertSkusAvailable(skus: string[], excludeProductId?: string) {
  const normalized = skus.map((sku) => sku.trim().toUpperCase());
  const duplicate = normalized.find((sku, index) => normalized.indexOf(sku) !== index);

  if (duplicate) {
    throw new AppError(`SKU ${duplicate} is used by more than one variant`, 409);
  }

  const clash = (await Product.findOne({
    "variants.sku": { $in: normalized },
    ...(excludeProductId ? { _id: { $ne: excludeProductId } } : {}),
  })
    .select("name variants.sku")
    .lean()) as unknown as { name: string; variants: Array<{ sku: string }> } | null;

  if (clash) {
    const sku = clash.variants.find((variant) => normalized.includes(variant.sku))?.sku;
    throw new AppError(`SKU ${sku} already belongs to "${clash.name}"`, 409);
  }
}

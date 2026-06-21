import type { NextFunction, Request, Response } from "express";
import type { Model } from "mongoose";
import { Router } from "express";
import { z } from "zod";
import { AppError } from "../middleware/errorHandler.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { requireAuth, requirePermission } from "../middleware/authMiddleware.js";
import { validateRequest } from "../middleware/validateRequest.js";
import { Category } from "../models/Category.js";
import { Collection } from "../models/Collection.js";
import { Product } from "../models/Product.js";
import { Warehouse } from "../models/Warehouse.js";
import { ProductReview } from "../models/ProductReview.js";
import { Tag } from "../models/Tag.js";
import { createSlug } from "../services/slugService.js";
import { generateBarcode, generateSku } from "../services/skuService.js";
import { computeBadges, recomputeProductBadges } from "../services/merchandisingBadgeService.js";
import { validateGstRate } from "../services/taxValidationService.js";
import { buildPaginatedResult, parsePagination } from "../utils/pagination.js";
import { buildQuery } from "../utils/queryBuilder.js";

export const catalogRouter = Router();

const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i);
const idParamsSchema = z.object({ id: objectIdSchema }).strict();
const gstRateSchema = z.coerce.number().refine(validateGstRate, "GST rate is not supported");

const mediaReferenceSchema = z
  .object({
    mediaId: objectIdSchema.optional(),
    url: z.string().min(1).refine(isMediaUrl, "Media URL must be absolute or site-relative"),
    altText: z.string().min(3).max(160),
    type: z.enum(["image", "video", "pdf", "lookbook"]),
    aspectRatio: z.enum(["1:1", "4:5", "9:16", "16:7", "16:9", "21:9", "3:2", "2:3", "custom"]),
    objectFit: z.enum(["cover", "contain"]).optional(),
  })
  .strict();

function isMediaUrl(value: string) {
  return value.startsWith("/") || z.string().url().safeParse(value).success;
}

const preOrderInputSchema = z
  .object({
    enabled: z.boolean().default(false),
    startAt: z.coerce.date().optional(),
    endAt: z.coerce.date().optional(),
    expectedDispatchAt: z.coerce.date().optional(),
    expectedDeliveryAt: z.coerce.date().optional(),
    paymentMode: z.enum(["full", "advance"]).default("full"),
    advancePercent: z.coerce.number().int().min(1).max(99).default(50),
    quantityCap: z.coerce.number().int().min(0).default(0),
    remainingQuantity: z.coerce.number().int().min(0).optional(),
  })
  .strict()
  .refine((value) => !value.enabled || (value.startAt && value.endAt), {
    message: "Pre-order start and end dates are required",
  })
  .refine((value) => !value.startAt || !value.endAt || value.startAt <= value.endAt, {
    message: "Pre-order end date must be after start date",
  });

const seoSchema = z
  .object({
    title: z.string().max(70).optional(),
    description: z.string().max(180).optional(),
    canonicalUrl: z.string().url().optional(),
    ogImage: mediaReferenceSchema.optional(),
  })
  .strict()
  .optional();

const variantInputSchema = z
  .object({
    color: z.string().max(60).optional(),
    size: z.string().max(40).optional(),
    sku: z.string().max(80).optional(),
    barcode: z.string().max(80).optional(),
    basePrice: z.coerce.number().min(0),
    salePrice: z.coerce.number().min(0).optional(),
    costPrice: z.coerce.number().min(0).default(0),
    currencyCode: z.string().length(3).default("INR"),
    stockPlaceholder: z.coerce.number().int().min(0).default(0),
    preOrder: preOrderInputSchema.optional(),
    priceTiers: z
      .array(
        z
          .object({
            priceListCode: z.string().min(1).max(40),
            price: z.coerce.number().min(0),
            currencyCode: z.string().length(3).default("INR"),
          })
          .strict(),
      )
      .default([]),
    media: z.array(mediaReferenceSchema).default([]),
    active: z.boolean().default(true),
  })
  .strict();

const productInputSchema = z
  .object({
    name: z.string().min(1).max(180),
    slug: z.string().max(220).optional(),
    description: z.string().min(1),
    shortDescription: z.string().max(300).optional(),
    highlights: z.array(z.string().min(1).max(160)).default([]),
    fabricDetails: z.string().optional(),
    washCare: z.string().optional(),
    sizeGuide: z.string().optional(),
    sizeGuideMedia: mediaReferenceSchema.optional(),
    hsnCode: z.string().regex(/^\d{4,8}$/),
    gstRate: gstRateSchema,
    categoryIds: z.array(objectIdSchema).default([]),
    collectionIds: z.array(objectIdSchema).default([]),
    tagIds: z.array(objectIdSchema).default([]),
    media: z.array(mediaReferenceSchema).default([]),
    variants: z.array(variantInputSchema).min(1),
    seo: seoSchema,
    badgeOverrides: z
      .object({
        newArrival: z.boolean().optional(),
        bestSeller: z.boolean().optional(),
        trending: z.boolean().optional(),
        limitedEdition: z.boolean().optional(),
      })
      .strict()
      .optional(),
    merchandisingMetrics: z
      .object({
        unitsSold30d: z.coerce.number().int().min(0).default(0),
        views7d: z.coerce.number().int().min(0).default(0),
        sales7d: z.coerce.number().int().min(0).default(0),
        trendingScore: z.coerce.number().int().min(0).default(0),
      })
      .strict()
      .optional(),
    relatedProductIds: z.array(objectIdSchema).default([]),
    recommendedProductIds: z.array(objectIdSchema).default([]),
    frequentlyBoughtTogetherIds: z.array(objectIdSchema).default([]),
    completeTheLookIds: z.array(objectIdSchema).default([]),
    active: z.boolean().default(true),
  })
  .strict();

const taxonomyInputSchema = z
  .object({
    name: z.string().min(1).max(140),
    slug: z.string().max(180).optional(),
    description: z.string().optional(),
    banner: mediaReferenceSchema.nullable().optional(),
    active: z.boolean().default(true),
    seo: seoSchema,
  })
  .strict();

const collectionInputSchema = taxonomyInputSchema;

const tagInputSchema = z
  .object({
    name: z.string().min(1).max(80),
    slug: z.string().max(120).optional(),
    active: z.boolean().default(true),
  })
  .strict();

const reviewInputSchema = z
  .object({
    rating: z.coerce.number().int().min(1).max(5),
    title: z.string().max(120).optional(),
    body: z.string().min(10).max(2000),
    guestName: z.string().max(100).optional(),
    guestEmail: z.string().email().optional(),
    photos: z.array(mediaReferenceSchema).max(5).default([]),
  })
  .strict();

type CatalogModel = Model<Record<string, unknown>>;
type TaxonomySchema = z.AnyZodObject;
type ProductMerchandisingPayload = {
  computedBadges?: Record<string, boolean>;
  relatedProductIds?: unknown[];
  recommendedProductIds?: unknown[];
  frequentlyBoughtTogetherIds?: unknown[];
  completeTheLookIds?: unknown[];
};
type ProductSlugPayload = { slug?: string };
type ProductIdPayload = { _id: unknown };

catalogRouter.get("/products", listPublicProducts);
catalogRouter.get("/home", getCatalogHome);
catalogRouter.get("/filters", getCatalogFilters);
catalogRouter.get("/search", searchCatalog);
catalogRouter.get("/products/:slug/pdp", getProductPdp);
catalogRouter.get("/products/:slug/reviews", listProductReviews);
catalogRouter.post(
  "/products/:slug/reviews",
  rateLimit({ windowMs: 60_000, max: 5, keyPrefix: "review-submit" }),
  validateRequest({ body: reviewInputSchema }),
  submitProductReview,
);
catalogRouter.get("/products/:slug", getProductBySlug);
catalogRouter.get("/categories/:slug", getCategoryBySlug);
catalogRouter.get("/collections/:slug", getCollectionBySlug);
catalogRouter.get(
  "/admin/lookups",
  requireAuth,
  requirePermission({ module: "catalog", action: "manage" }),
  listAdminLookups,
);
catalogRouter.get(
  "/admin/products",
  requireAuth,
  requirePermission({ module: "catalog", action: "manage" }),
  listProducts,
);
catalogRouter.post(
  "/admin/products",
  requireAuth,
  requirePermission({ module: "catalog", action: "manage" }),
  validateRequest({ body: productInputSchema }),
  createProduct,
);
catalogRouter.patch(
  "/admin/products/:id",
  requireAuth,
  requirePermission({ module: "catalog", action: "manage" }),
  validateRequest({ params: idParamsSchema, body: productInputSchema.partial() }),
  updateProduct,
);
catalogRouter.delete(
  "/admin/products/:id",
  requireAuth,
  requirePermission({ module: "catalog", action: "manage" }),
  validateRequest({ params: idParamsSchema }),
  deleteProduct,
);
catalogRouter.post(
  "/admin/products/recompute-badges",
  requireAuth,
  requirePermission({ module: "catalog", action: "manage" }),
  recomputeBadges,
);

registerTaxonomyRoutes("categories", Category as CatalogModel, taxonomyInputSchema);
registerTaxonomyRoutes("collections", Collection as CatalogModel, collectionInputSchema);
registerTaxonomyRoutes("tags", Tag as CatalogModel, tagInputSchema);

async function listProducts(req: Request, res: Response, next: NextFunction) {
  return listProductsWithVisibility(req, res, next, { publicOnly: false });
}

async function listPublicProducts(req: Request, res: Response, next: NextFunction) {
  return listProductsWithVisibility(req, res, next, { publicOnly: true });
}

async function getCatalogHome(_req: Request, res: Response, next: NextFunction) {
  try {
    const [products, categories, collections] = await Promise.all([
      Product.find({ active: true, status: { $ne: "deleted" } })
        .sort({ createdAt: -1 })
        .limit(12)
        .select("name slug media variants computedBadges")
        .lean(),
      Category.find({ active: true, status: { $ne: "deleted" } })
        .sort({ name: 1 })
        .limit(8)
        .select("name slug description banner")
        .lean(),
      Collection.find({ active: true, status: { $ne: "deleted" } })
        .sort({ createdAt: -1 })
        .limit(8)
        .select("name slug description banner")
        .lean(),
    ]);

    res.json({ products, categories, collections });
  } catch (error) {
    next(error);
  }
}

async function getCatalogFilters(_req: Request, res: Response, next: NextFunction) {
  try {
    const products = await Product.find({ active: true, status: { $ne: "deleted" } })
      .select("categoryIds collectionIds tagIds variants fabricDetails")
      .lean();

    const categoryCounts = new Map<string, number>();
    const collectionCounts = new Map<string, number>();
    const tagCounts = new Map<string, number>();
    const sizes = new Set<string>();
    const colors = new Set<string>();
    const fabrics = new Set<string>();
    let minPrice = Number.POSITIVE_INFINITY;
    let maxPrice = 0;

    for (const product of products) {
      incrementIds(categoryCounts, product.categoryIds);
      incrementIds(collectionCounts, product.collectionIds);
      incrementIds(tagCounts, product.tagIds);

      if (typeof product.fabricDetails === "string" && product.fabricDetails.trim().length > 0) {
        for (const item of product.fabricDetails.split(/[,/]/)) {
          const fabric = item.trim();

          if (fabric.length > 0) {
            fabrics.add(fabric);
          }
        }
      }

      for (const variant of product.variants ?? []) {
        if (typeof variant.size === "string" && variant.size.length > 0) {
          sizes.add(variant.size);
        }
        if (typeof variant.color === "string" && variant.color.length > 0) {
          colors.add(variant.color);
        }

        const price = variant.salePrice ?? variant.basePrice;
        if (typeof price === "number") {
          minPrice = Math.min(minPrice, price);
          maxPrice = Math.max(maxPrice, price);
        }
      }
    }

    const [categories, collections, tags] = await Promise.all([
      Category.find({ _id: { $in: [...categoryCounts.keys()] }, active: true })
        .select("name slug")
        .lean(),
      Collection.find({ _id: { $in: [...collectionCounts.keys()] }, active: true })
        .select("name slug")
        .lean(),
      Tag.find({ _id: { $in: [...tagCounts.keys()] }, active: true })
        .select("name slug")
        .lean(),
    ]);

    res.json({
      categories: categories.map((item) => ({
        _id: String(item._id),
        count: categoryCounts.get(String(item._id)) ?? 0,
        name: item.name,
        slug: item.slug,
      })),
      collections: collections.map((item) => ({
        _id: String(item._id),
        count: collectionCounts.get(String(item._id)) ?? 0,
        name: item.name,
        slug: item.slug,
      })),
      colors: [...colors].sort(),
      fabrics: [...fabrics].sort(),
      price: {
        max: maxPrice,
        min: Number.isFinite(minPrice) ? minPrice : 0,
      },
      sizes: [...sizes].sort(sortSizes),
      tags: tags.map((item) => ({
        _id: String(item._id),
        count: tagCounts.get(String(item._id)) ?? 0,
        name: item.name,
        slug: item.slug,
      })),
    });
  } catch (error) {
    next(error);
  }
}

async function searchCatalog(req: Request, res: Response, next: NextFunction) {
  try {
    const rawQuery = typeof req.query.q === "string" ? req.query.q.trim() : "";

    if (rawQuery.length < 2) {
      res.json({ results: [] });
      return;
    }

    const regex = { $regex: escapeRegex(rawQuery), $options: "i" };
    const activeFilter = { active: true, status: { $ne: "deleted" } };
    const [products, categories, collections, tags] = await Promise.all([
      Product.find({ ...activeFilter, name: regex })
        .sort({ createdAt: -1 })
        .limit(5)
        .select("name slug media variants")
        .lean(),
      Category.find({ ...activeFilter, name: regex })
        .sort({ name: 1 })
        .limit(4)
        .select("name slug banner")
        .lean(),
      Collection.find({ ...activeFilter, name: regex })
        .sort({ name: 1 })
        .limit(4)
        .select("name slug banner")
        .lean(),
      Tag.find({ ...activeFilter, name: regex })
        .sort({ name: 1 })
        .limit(4)
        .select("name slug")
        .lean(),
    ]);

    res.json({
      results: [
        ...products.map((item) => ({
          _id: String(item._id),
          href: `/shop/${item.slug}`,
          image: item.media?.[0] ?? item.variants?.[0]?.media?.[0],
          kind: "Product",
          title: item.name,
        })),
        ...categories.map((item) => ({
          _id: String(item._id),
          href: `/categories/${item.slug}`,
          image: item.banner,
          kind: "Category",
          title: item.name,
        })),
        ...collections.map((item) => ({
          _id: String(item._id),
          href: `/collections/${item.slug}`,
          image: item.banner,
          kind: "Collection",
          title: item.name,
        })),
        ...tags.map((item) => ({
          _id: String(item._id),
          href: `/shop?tagId=${String(item._id)}`,
          kind: "Tag",
          title: item.name,
        })),
      ],
    });
  } catch (error) {
    next(error);
  }
}

async function listProductsWithVisibility(
  req: Request,
  res: Response,
  next: NextFunction,
  options: { publicOnly: boolean },
) {
  try {
    const pagination = parsePagination(req.query);
    const query = buildQuery(
      {
        filter: normalizeProductFilters(req.query),
        sort: typeof req.query.sort === "string" ? req.query.sort : undefined,
      },
      {
        filters: {
          brandId: { field: "brandId", operators: ["eq"] },
          categoryId: { field: "categoryIds", operators: ["eq"] },
          collectionId: { field: "collectionIds", operators: ["eq"] },
          tagId: { field: "tagIds", operators: ["eq"] },
          active: { field: "active", operators: ["eq"] },
          search: { field: "name", operators: ["regex"] },
          size: { field: "variants.size", operators: ["eq"] },
          color: { field: "variants.color", operators: ["eq"] },
          fabric: { field: "fabricDetails", operators: ["regex"] },
          preOrder: { field: "variants.preOrder.enabled", operators: ["eq"] },
          price: { field: "variants.basePrice", operators: ["gte", "lte"] },
        },
        sorts: {
          newest: { field: "createdAt" },
          name: { field: "name" },
          price: { field: "variants.basePrice" },
          bestSelling: { field: "merchandisingMetrics.unitsSold30d" },
        },
      },
    );
    const filter = {
      ...query.filter,
      ...(options.publicOnly ? { active: true } : {}),
      status: { $ne: "deleted" },
    };
    const [products, total] = await Promise.all([
      Product.find(filter).sort(query.sort).skip(pagination.skip).limit(pagination.limit).lean(),
      Product.countDocuments(filter),
    ]);

    res.json(buildPaginatedResult(products, total, pagination));
  } catch (error) {
    next(error);
  }
}

async function getProductBySlug(req: Request, res: Response, next: NextFunction) {
  try {
    const product = await Product.findOne({
      slug: req.params.slug,
      active: true,
      status: { $ne: "deleted" },
    })
      .populate("categoryIds", "name slug")
      .populate("collectionIds", "name slug")
      .populate("tagIds", "name slug")
      .lean();

    if (!product) {
      throw new AppError("Product not found", 404);
    }

    res.json({ product });
  } catch (error) {
    next(error);
  }
}

async function getProductPdp(req: Request, res: Response, next: NextFunction) {
  try {
    const product = (await Product.findOne({
      slug: req.params.slug,
      active: true,
      status: { $ne: "deleted" },
    })
      .populate("categoryIds", "name slug")
      .populate("collectionIds", "name slug")
      .populate("tagIds", "name slug")
      .lean()) as ProductMerchandisingPayload | null;

    if (!product) {
      throw new AppError("Product not found", 404);
    }

    const [relatedProducts, recommendedProducts, frequentlyBoughtTogether, completeTheLook] =
      await Promise.all([
        findCuratedProducts(product.relatedProductIds),
        findCuratedProducts(product.recommendedProductIds),
        findCuratedProducts(product.frequentlyBoughtTogetherIds),
        findCuratedProducts(product.completeTheLookIds),
      ]);

    res.json({
      product,
      badges: product.computedBadges,
      merchandising: {
        relatedProducts,
        recommendedProducts,
        frequentlyBoughtTogether,
        completeTheLook,
      },
    });
  } catch (error) {
    next(error);
  }
}

async function listProductReviews(req: Request, res: Response, next: NextFunction) {
  try {
    const pagination = parsePagination(req.query);
    const product = (await Product.findOne({
      slug: req.params.slug,
      active: true,
      status: { $ne: "deleted" },
    })
      .select("_id")
      .lean()) as ProductIdPayload | null;

    if (!product) {
      throw new AppError("Product not found", 404);
    }

    const filter = {
      productId: product._id,
      moderationStatus: "approved",
      status: { $ne: "deleted" },
    };
    const [reviews, total] = await Promise.all([
      ProductReview.find(filter)
        .sort({ createdAt: -1 })
        .skip(pagination.skip)
        .limit(pagination.limit)
        .lean(),
      ProductReview.countDocuments(filter),
    ]);

    res.json(buildPaginatedResult(reviews, total, pagination));
  } catch (error) {
    next(error);
  }
}

async function submitProductReview(req: Request, res: Response, next: NextFunction) {
  try {
    const product = (await Product.findOne({
      slug: req.params.slug,
      active: true,
      status: { $ne: "deleted" },
    })
      .select("_id")
      .lean()) as ProductIdPayload | null;

    if (!product) {
      throw new AppError("Product not found", 404);
    }

    const review = await ProductReview.create({
      ...req.body,
      productId: product._id,
      userId: req.user?.id,
      moderationStatus: "pending",
      verifiedPurchase: false,
    });

    res.status(201).json({ review, moderationStatus: "pending" });
  } catch (error) {
    next(error);
  }
}

async function getCategoryBySlug(req: Request, res: Response, next: NextFunction) {
  try {
    const category = await Category.findOne({
      slug: req.params.slug,
      active: true,
      status: { $ne: "deleted" },
    }).lean();

    if (!category) {
      throw new AppError("Category not found", 404);
    }

    res.json({ category });
  } catch (error) {
    next(error);
  }
}

async function getCollectionBySlug(req: Request, res: Response, next: NextFunction) {
  try {
    const collection = await Collection.findOne({
      slug: req.params.slug,
      active: true,
      status: { $ne: "deleted" },
    }).lean();

    if (!collection) {
      throw new AppError("Collection not found", 404);
    }

    res.json({ collection });
  } catch (error) {
    next(error);
  }
}

async function createProduct(req: Request, res: Response, next: NextFunction) {
  try {
    const slug = createSlug(req.body.slug ?? req.body.name);
    const variants = req.body.variants.map(
      (variant: z.infer<typeof variantInputSchema>, index: number) =>
        normalizeVariantIdentity(variant, slug, index),
    );
    const product = await Product.create({ ...req.body, slug, variants });
    product.computedBadges = computeBadges(product);
    await product.save();

    res.status(201).json({ product });
  } catch (error) {
    next(error);
  }
}

async function updateProduct(req: Request, res: Response, next: NextFunction) {
  try {
    const update = { ...req.body };

    if (update.slug || update.name) {
      update.slug = createSlug(update.slug ?? update.name);
    }

    if (update.variants) {
      const existingProduct = (await Product.findById(req.params.id)
        .select("slug")
        .lean()) as ProductSlugPayload | null;
      const productSlug = update.slug ?? existingProduct?.slug ?? "product";

      update.variants = update.variants.map(
        (variant: z.infer<typeof variantInputSchema>, index: number) =>
          normalizeVariantIdentity(variant, productSlug, index),
      );
    }

    const product = await Product.findByIdAndUpdate(req.params.id, { $set: update }, { new: true });

    if (!product) {
      throw new AppError("Product not found", 404);
    }

    product.computedBadges = computeBadges(product);
    await product.save();

    res.json({ product });
  } catch (error) {
    next(error);
  }
}

async function listAdminLookups(_req: Request, res: Response, next: NextFunction) {
  try {
    const [categories, collections, tags, warehouses] = await Promise.all([
      Category.find({ status: { $ne: "deleted" } })
        .sort({ name: 1 })
        .limit(200)
        .lean(),
      Collection.find({ status: { $ne: "deleted" } })
        .sort({ name: 1 })
        .limit(200)
        .lean(),
      Tag.find({ status: { $ne: "deleted" } })
        .sort({ name: 1 })
        .limit(200)
        .lean(),
      Warehouse.find({ status: { $ne: "deleted" }, active: true })
        .sort({ name: 1 })
        .limit(100)
        .lean(),
    ]);

    res.json({ categories, collections, tags, warehouses });
  } catch (error) {
    next(error);
  }
}

function normalizePreOrder(preOrder?: z.infer<typeof preOrderInputSchema>) {
  if (!preOrder?.enabled) {
    return { enabled: false, quantityCap: 0, remainingQuantity: 0 };
  }

  return {
    ...preOrder,
    remainingQuantity: preOrder.remainingQuantity ?? preOrder.quantityCap,
  };
}

function normalizeVariantIdentity(
  variant: z.infer<typeof variantInputSchema>,
  productSlug: string,
  index: number,
) {
  const sku =
    variant.sku ??
    generateSku({
      color: variant.color,
      productSlug,
      sequence: index + 1,
      size: variant.size,
    });

  return {
    ...variant,
    barcode: variant.barcode ?? generateBarcode(sku),
    preOrder: normalizePreOrder(variant.preOrder),
    sku,
  };
}

async function deleteProduct(req: Request, res: Response, next: NextFunction) {
  try {
    const product = await Product.findByIdAndUpdate(
      req.params.id,
      { $set: { status: "deleted", deletedAt: new Date() } },
      { new: true },
    );

    if (!product) {
      throw new AppError("Product not found", 404);
    }

    res.json({ deleted: true });
  } catch (error) {
    next(error);
  }
}

async function recomputeBadges(_req: Request, res: Response, next: NextFunction) {
  try {
    const result = await recomputeProductBadges();
    res.json(result);
  } catch (error) {
    next(error);
  }
}

async function findCuratedProducts(productIds: unknown) {
  if (!Array.isArray(productIds) || productIds.length === 0) {
    return [];
  }

  return Product.find({ _id: { $in: productIds }, status: { $ne: "deleted" }, active: true })
    .select("name slug media variants computedBadges")
    .lean();
}

function registerTaxonomyRoutes(path: string, model: CatalogModel, schema: TaxonomySchema) {
  catalogRouter.get(
    `/admin/${path}`,
    requireAuth,
    requirePermission({ module: "catalog", action: "manage" }),
    async (req, res, next) => {
      try {
        const pagination = parsePagination(req.query);
        const query = buildQuery(
          {
            filter: normalizeTaxonomyFilters(req.query),
            sort: typeof req.query.sort === "string" ? req.query.sort : undefined,
          },
          {
            filters: {
              active: { field: "active", operators: ["eq"] },
              search: { field: "name", operators: ["regex"] },
              brandId: { field: "brandId", operators: ["eq"] },
            },
            sorts: {
              newest: { field: "createdAt" },
              name: { field: "name" },
            },
          },
        );
        const filter = { ...query.filter, status: { $ne: "deleted" } };
        const [items, total] = await Promise.all([
          model.find(filter).sort(query.sort).skip(pagination.skip).limit(pagination.limit).lean(),
          model.countDocuments(filter),
        ]);

        res.json(buildPaginatedResult(items, total, pagination));
      } catch (error) {
        next(error);
      }
    },
  );

  catalogRouter.post(
    `/admin/${path}`,
    requireAuth,
    requirePermission({ module: "catalog", action: "manage" }),
    validateRequest({ body: schema }),
    async (req, res, next) => {
      try {
        const item = await model.create({
          ...req.body,
          slug: createSlug(req.body.slug ?? req.body.name),
        });
        res.status(201).json({ item });
      } catch (error) {
        next(error);
      }
    },
  );

  catalogRouter.patch(
    `/admin/${path}/:id`,
    requireAuth,
    requirePermission({ module: "catalog", action: "manage" }),
    validateRequest({ params: idParamsSchema, body: schema.partial() }),
    async (req, res, next) => {
      try {
        const update = { ...req.body };

        if (update.slug || update.name) {
          update.slug = createSlug(update.slug ?? update.name);
        }

        const item = await model.findByIdAndUpdate(req.params.id, { $set: update }, { new: true });

        if (!item) {
          throw new AppError("Catalog item not found", 404);
        }

        res.json({ item });
      } catch (error) {
        next(error);
      }
    },
  );

  catalogRouter.delete(
    `/admin/${path}/:id`,
    requireAuth,
    requirePermission({ module: "catalog", action: "manage" }),
    validateRequest({ params: idParamsSchema }),
    async (req, res, next) => {
      try {
        const item = await model.findByIdAndUpdate(
          req.params.id,
          { $set: { status: "deleted", deletedAt: new Date() } },
          { new: true },
        );

        if (!item) {
          throw new AppError("Catalog item not found", 404);
        }

        res.json({ deleted: true });
      } catch (error) {
        next(error);
      }
    },
  );
}

function normalizeProductFilters(query: Record<string, unknown>): Record<string, unknown> {
  const filter = pickStringFilters(query, [
    "brandId",
    "categoryId",
    "collectionId",
    "tagId",
    "active",
    "search",
    "size",
    "color",
    "preOrder",
  ]);

  if (typeof query.fabric === "string" && query.fabric.length > 0) {
    filter["fabric.regex"] = query.fabric;
  }

  if (typeof query.minPrice === "string" && query.minPrice.length > 0) {
    filter["price.gte"] = query.minPrice;
  }

  if (typeof query.maxPrice === "string" && query.maxPrice.length > 0) {
    filter["price.lte"] = query.maxPrice;
  }

  return filter;
}

function normalizeTaxonomyFilters(query: Record<string, unknown>): Record<string, unknown> {
  return pickStringFilters(query, ["brandId", "active", "search"]);
}

function pickStringFilters(
  query: Record<string, unknown>,
  keys: string[],
): Record<string, unknown> {
  const filter: Record<string, unknown> = {};

  for (const key of keys) {
    const value = query[key];

    if (typeof value === "string" && value.length > 0) {
      filter[key] = key === "active" ? value === "true" : value;
    }
  }

  return filter;
}

function incrementIds(counter: Map<string, number>, ids: unknown) {
  if (!Array.isArray(ids)) {
    return;
  }

  for (const id of ids) {
    const key = String(id);
    counter.set(key, (counter.get(key) ?? 0) + 1);
  }
}

function sortSizes(left: string, right: string) {
  const order = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "3XL", "4XL", "5XL"];
  const leftIndex = order.indexOf(left.toUpperCase());
  const rightIndex = order.indexOf(right.toUpperCase());

  if (leftIndex >= 0 || rightIndex >= 0) {
    return (
      (leftIndex >= 0 ? leftIndex : Number.MAX_SAFE_INTEGER) -
      (rightIndex >= 0 ? rightIndex : Number.MAX_SAFE_INTEGER)
    );
  }

  return left.localeCompare(right);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

import type { NextFunction, Request, Response } from "express";
import type { Model } from "mongoose";
import { Types } from "mongoose";
import { Router } from "express";
import { z } from "zod";
import { AppError } from "../middleware/errorHandler.js";
import { rateLimit } from "../middleware/rateLimit.js";
import {
  attachOptionalUser,
  requireAuth,
  requirePermission,
} from "../middleware/authMiddleware.js";
import { validateRequest } from "../middleware/validateRequest.js";
import { Category } from "../models/Category.js";
import { Collection } from "../models/Collection.js";
import { Product } from "../models/Product.js";
import { StockLedger } from "../models/StockLedger.js";
import { Warehouse } from "../models/Warehouse.js";
import { Tag } from "../models/Tag.js";
import { createSlug } from "../services/slugService.js";
import { generateBarcode, generateSku } from "../services/skuService.js";
import { computeBadges, recomputeProductBadges } from "../services/merchandisingBadgeService.js";
import { buyerPriceList } from "../services/cartService.js";
import {
  assertSkusAvailable,
  ensureLedgersForVariants,
  mergeVariantsPreservingIds,
  serializePublicProducts,
} from "../services/catalogPublicService.js";
import { recordSlugChange } from "../services/redirectService.js";
import {
  deleteReview,
  listApprovedReviews,
  listOwnReviews,
  listReviewsForModeration,
  moderateReview,
  submitReview,
  updateOwnReview,
} from "../services/reviewService.js";
import { invalidateSearchIndex, searchProducts } from "../services/searchService.js";
import { getPublicSeoSettings } from "../services/seoService.js";
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
  return (
    (value.startsWith("/") && !value.startsWith("//")) ||
    /^https:\/\//i.test(value) ||
    /^http:\/\/localhost/i.test(value)
  );
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

export const seoInputSchema = z
  .object({
    title: z.string().max(120).optional(),
    description: z.string().max(320).optional(),
    keywords: z.array(z.string().min(1).max(60)).max(20).optional(),
    canonicalUrl: z
      .string()
      .max(500)
      .refine((value) => !value || value.startsWith("/") || /^https:\/\//.test(value), {
        message: "Canonical URL must be a site path or https URL",
      })
      .optional()
      .or(z.literal("")),
    robotsIndex: z.boolean().optional(),
    robotsFollow: z.boolean().optional(),
    ogTitle: z.string().max(120).optional(),
    ogDescription: z.string().max(320).optional(),
    ogImage: mediaReferenceSchema.optional(),
    twitterTitle: z.string().max(120).optional(),
    twitterDescription: z.string().max(320).optional(),
    twitterImage: mediaReferenceSchema.optional(),
    schemaEnabled: z.boolean().optional(),
  })
  .strict()
  .optional();

const faqInputSchema = z
  .object({ question: z.string().min(3).max(300), answer: z.string().min(2).max(4000) })
  .strict();

const variantInputSchema = z
  .object({
    _id: objectIdSchema.optional(),
    color: z.string().max(60).optional(),
    size: z.string().max(40).optional(),
    sku: z.string().max(80).optional(),
    barcode: z.string().max(80).optional(),
    basePrice: z.coerce.number().min(0),
    salePrice: z.coerce.number().min(0).optional(),
    costPrice: z.coerce.number().min(0).default(0),
    currencyCode: z.string().length(3).default("INR"),
    // Opening stock for a brand-new SKU. Existing stock is managed in the Inventory module.
    initialStock: z.coerce.number().int().min(0).optional(),
    stockPlaceholder: z.coerce.number().int().min(0).optional(),
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
  .strict()
  .refine((value) => value.salePrice === undefined || value.salePrice <= value.basePrice, {
    message: "Sale price cannot exceed the base price",
  });

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
    seo: seoInputSchema,
    wholesaleMinQuantity: z.coerce.number().int().min(1).optional(),
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
    description: z.string().max(2000).optional(),
    banner: mediaReferenceSchema.nullable().optional(),
    active: z.boolean().default(true),
    seo: seoInputSchema,
    introContent: z.string().max(4000).optional(),
    bottomContent: z.string().max(12000).optional(),
    faqs: z.array(faqInputSchema).max(20).optional(),
    sortOrder: z.coerce.number().int().optional(),
    parentId: objectIdSchema.nullable().optional(),
  })
  .strict();

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
    title: z.string().trim().max(120).optional(),
    body: z.string().trim().min(10, "Please write at least 10 characters").max(2000),
    photoMediaIds: z.array(objectIdSchema).max(5).optional(),
  })
  .strict();

type CatalogModel = Model<Record<string, unknown>>;
type TaxonomySchema = z.AnyZodObject;
type ProductMerchandisingPayload = Record<string, unknown> & {
  computedBadges?: Record<string, boolean>;
  relatedProductIds?: unknown[];
  recommendedProductIds?: unknown[];
  frequentlyBoughtTogetherIds?: unknown[];
  completeTheLookIds?: unknown[];
};

const reviewLimit = rateLimit({ keyPrefix: "review-submit", max: 5, windowMs: 60 * 60 * 1000 });
const searchLimit = rateLimit({ keyPrefix: "catalog-search", max: 120, windowMs: 60 * 1000 });

catalogRouter.use(attachOptionalUser);

catalogRouter.get("/products", searchLimit, listPublicProducts);
catalogRouter.get("/home", getCatalogHome);
catalogRouter.get("/filters", getCatalogFilters);
catalogRouter.get("/search", searchLimit, searchCatalog);
catalogRouter.get("/sitemap", getSitemapData);
catalogRouter.get("/seo-settings", getSeoSettings);
catalogRouter.get("/products/:slug/pdp", getProductPdp);
catalogRouter.get("/products/:slug/reviews", listProductReviews);
catalogRouter.post(
  "/products/:slug/reviews",
  requireAuth,
  reviewLimit,
  validateRequest({ body: reviewInputSchema }),
  async (req, res, next) => {
    try {
      const review = await submitReview({
        review: req.body,
        slug: String(req.params.slug),
        userId: req.user!.id,
      });
      res.status(201).json({ moderationStatus: "pending", review });
    } catch (error) {
      next(error);
    }
  },
);
catalogRouter.get("/reviews/mine", requireAuth, async (req, res, next) => {
  try {
    res.json({ reviews: await listOwnReviews(req.user!.id) });
  } catch (error) {
    next(error);
  }
});
catalogRouter.patch(
  "/reviews/:id",
  requireAuth,
  reviewLimit,
  validateRequest({ params: idParamsSchema, body: reviewInputSchema }),
  async (req, res, next) => {
    try {
      res.json({
        review: await updateOwnReview({
          review: req.body,
          reviewId: String(req.params.id),
          userId: req.user!.id,
        }),
      });
    } catch (error) {
      next(error);
    }
  },
);
catalogRouter.get("/products/:slug", getProductBySlug);
catalogRouter.get("/categories/:slug", getCategoryBySlug);
catalogRouter.get("/collections/:slug", getCollectionBySlug);

// ---------- Admin ----------
const requireCatalogManage = [
  requireAuth,
  requirePermission({ module: "catalog", action: "manage" }),
];

catalogRouter.get("/admin/lookups", ...requireCatalogManage, listAdminLookups);
catalogRouter.get("/admin/products", ...requireCatalogManage, listProducts);
catalogRouter.post(
  "/admin/products",
  ...requireCatalogManage,
  validateRequest({ body: productInputSchema }),
  createProduct,
);
catalogRouter.patch(
  "/admin/products/:id",
  ...requireCatalogManage,
  validateRequest({ params: idParamsSchema, body: productInputSchema.partial() }),
  updateProduct,
);
catalogRouter.delete(
  "/admin/products/:id",
  ...requireCatalogManage,
  validateRequest({ params: idParamsSchema }),
  deleteProduct,
);
catalogRouter.post("/admin/products/recompute-badges", ...requireCatalogManage, recomputeBadges);

catalogRouter.get(
  "/admin/reviews",
  requireAuth,
  requirePermission({ module: "catalog", action: "manage" }),
  validateRequest({
    query: z
      .object({
        moderationStatus: z.enum(["pending", "approved", "rejected"]).optional(),
        search: z.string().max(100).optional(),
        page: z.string().optional(),
        limit: z.string().optional(),
      })
      .strict(),
  }),
  async (req, res, next) => {
    try {
      const query = req.query as { moderationStatus?: string; search?: string };
      res.json(
        await listReviewsForModeration(
          { moderationStatus: query.moderationStatus, search: query.search },
          parsePagination(req.query),
        ),
      );
    } catch (error) {
      next(error);
    }
  },
);
catalogRouter.patch(
  "/admin/reviews/:id",
  requireAuth,
  requirePermission({ module: "catalog", action: "manage" }),
  validateRequest({
    params: idParamsSchema,
    body: z
      .object({
        moderationStatus: z.enum(["pending", "approved", "rejected"]),
        moderationNote: z.string().max(500).optional(),
      })
      .strict(),
  }),
  async (req, res, next) => {
    try {
      res.json({
        review: await moderateReview({
          adminUserId: req.user!.id,
          moderationNote: req.body.moderationNote,
          moderationStatus: req.body.moderationStatus,
          reviewId: String(req.params.id),
        }),
      });
    } catch (error) {
      next(error);
    }
  },
);
catalogRouter.delete(
  "/admin/reviews/:id",
  requireAuth,
  requirePermission({ module: "catalog", action: "manage" }),
  validateRequest({ params: idParamsSchema }),
  async (req, res, next) => {
    try {
      res.json(await deleteReview(String(req.params.id), req.user!.id));
    } catch (error) {
      next(error);
    }
  },
);

registerTaxonomyRoutes("categories", Category as CatalogModel, taxonomyInputSchema, "/categories/");
registerTaxonomyRoutes(
  "collections",
  Collection as CatalogModel,
  taxonomyInputSchema,
  "/collections/",
);
registerTaxonomyRoutes("tags", Tag as CatalogModel, tagInputSchema);

async function viewerFor(req: Request) {
  return {
    priceListCode: await buyerPriceList(req.user?.type === "customer" ? req.user.id : undefined),
  };
}

async function listProducts(req: Request, res: Response, next: NextFunction) {
  return listProductsWithVisibility(req, res, next, { publicOnly: false });
}

async function listPublicProducts(req: Request, res: Response, next: NextFunction) {
  return listProductsWithVisibility(req, res, next, { publicOnly: true });
}

async function getCatalogHome(req: Request, res: Response, next: NextFunction) {
  try {
    const [products, categories, collections] = await Promise.all([
      Product.find({ active: true, status: { $ne: "deleted" } })
        .sort({ createdAt: -1 })
        .limit(12)
        .select("name slug media variants computedBadges ratingAverage ratingCount")
        .lean(),
      Category.find({ active: true, status: { $ne: "deleted" } })
        .sort({ sortOrder: 1, name: 1 })
        .limit(8)
        .select("name slug description banner")
        .lean(),
      Collection.find({ active: true, status: { $ne: "deleted" } })
        .sort({ sortOrder: 1, createdAt: -1 })
        .limit(8)
        .select("name slug description banner")
        .lean(),
    ]);

    res.json({
      categories,
      collections,
      products: await serializePublicProducts(
        products as Array<Record<string, unknown>>,
        await viewerFor(req),
      ),
    });
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

          if (fabric.length > 0 && fabric.length <= 40) {
            fabrics.add(fabric);
          }
        }
      }

      for (const variant of product.variants ?? []) {
        if (variant.active === false) continue;
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

/** Indexable URLs only: noindex entities are excluded from sitemaps. */
async function getSitemapData(_req: Request, res: Response, next: NextFunction) {
  try {
    const activeFilter = {
      active: true,
      status: { $ne: "deleted" },
      "seo.robotsIndex": { $ne: false },
    };
    const [products, categories, collections] = await Promise.all([
      Product.find(activeFilter).select("slug updatedAt name media").lean(),
      Category.find(activeFilter).select("slug updatedAt").lean(),
      Collection.find(activeFilter).select("slug updatedAt").lean(),
    ]);

    res.json({
      categories: categories.map((item) => ({ slug: item.slug, updatedAt: item.updatedAt })),
      collections: collections.map((item) => ({ slug: item.slug, updatedAt: item.updatedAt })),
      products: products.map((item) => ({
        images: ((item.media as Array<{ url?: string; altText?: string; type?: string }>) ?? [])
          .filter((media) => media.type === "image" && media.url?.startsWith("https://"))
          .slice(0, 8)
          .map((media) => ({ alt: media.altText, url: media.url })),
        name: item.name,
        slug: item.slug,
        updatedAt: item.updatedAt,
      })),
    });
  } catch (error) {
    next(error);
  }
}

async function getSeoSettings(_req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ seo: await getPublicSeoSettings() });
  } catch (error) {
    next(error);
  }
}

async function searchCatalog(req: Request, res: Response, next: NextFunction) {
  try {
    const rawQuery = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 100) : "";

    if (rawQuery.length < 2) {
      res.json({ results: [] });
      return;
    }

    const regex = { $regex: escapeRegex(rawQuery), $options: "i" };
    const activeFilter = { active: true, status: { $ne: "deleted" } };
    const ranked = await searchProducts(rawQuery, { limit: 6, prefix: true });
    const [rankedProducts, categories, collections, tags] = await Promise.all([
      ranked.ids.length
        ? Product.find({ ...activeFilter, _id: { $in: ranked.ids } })
            .select("name slug media variants.media")
            .lean()
        : Promise.resolve([]),
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
    const order = new Map(ranked.ids.map((id, index) => [id, index]));
    const products = [...(rankedProducts as Array<Record<string, unknown>>)].sort(
      (a, b) => (order.get(String(a._id)) ?? 0) - (order.get(String(b._id)) ?? 0),
    );

    res.json({
      results: [
        ...products.map((item) => ({
          _id: String(item._id),
          href: `/shop/${String(item.slug)}`,
          image:
            (item.media as unknown[] | undefined)?.[0] ??
            (item.variants as Array<{ media?: unknown[] }> | undefined)?.[0]?.media?.[0],
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
      suggestion: ranked.suggestion,
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
    const sortParam = typeof req.query.sort === "string" ? req.query.sort : undefined;
    const query = buildQuery(
      {
        filter: normalizeProductFilters(req.query),
        sort: sortParam,
      },
      {
        filters: {
          brandId: { field: "brandId", operators: ["eq"] },
          categoryId: { field: "categoryIds", operators: ["eq"] },
          collectionId: { field: "collectionIds", operators: ["eq"] },
          tagId: { field: "tagIds", operators: ["eq"] },
          active: { field: "active", operators: ["eq"] },
          size: { field: "variants.size", operators: ["eq"] },
          color: { field: "variants.color", operators: ["eq"] },
          fabric: { field: "fabricDetails", operators: ["regex"] },
          preOrder: { field: "variants.preOrder.enabled", operators: ["eq"] },
        },
        sorts: {
          newest: { field: "createdAt" },
          name: { field: "name" },
          price: { field: "effectivePrice" },
          bestSelling: { field: "merchandisingMetrics.unitsSold30d" },
          rating: { field: "ratingAverage" },
        },
      },
    );
    const filter: Record<string, unknown> = {
      ...castObjectIds(query.filter),
      ...(options.publicOnly ? { active: true } : {}),
      status: { $ne: "deleted" },
    };
    const priceMatch = buildPriceMatch(req.query);
    const searchText =
      typeof req.query.search === "string" && req.query.search.trim().length >= 2
        ? req.query.search.trim().slice(0, 100)
        : typeof req.query.q === "string" && req.query.q.trim().length >= 2
          ? req.query.q.trim().slice(0, 100)
          : undefined;
    let rankedIds: string[] | undefined;
    let suggestion: string | undefined;

    if (searchText) {
      const ranked = await searchProducts(searchText, { prefix: false });
      rankedIds = ranked.ids;
      suggestion = ranked.suggestion;

      if (!options.publicOnly && !rankedIds.length) {
        // Admin search also matches inactive products by name/SKU.
        filter.$or = [
          { name: { $regex: escapeRegex(searchText), $options: "i" } },
          { "variants.sku": searchText.toUpperCase() },
        ];
        rankedIds = undefined;
      } else {
        filter._id = { $in: rankedIds.map((id) => new Types.ObjectId(id)) };
      }
    }

    // In-stock items first, then open pre-orders (merchandising rule), then the chosen sort.
    const sort: Record<string, 1 | -1> =
      rankedIds && !sortParam
        ? { searchRank: 1 }
        : {
            hasActivePreOrder: 1,
            ...(Object.keys(query.sort).length ? query.sort : { createdAt: -1 }),
          };
    const pipeline: Record<string, unknown>[] = [
      { $match: filter },
      {
        $addFields: {
          effectivePrice: {
            $min: {
              $map: {
                input: "$variants",
                as: "variant",
                in: { $ifNull: ["$$variant.salePrice", "$$variant.basePrice"] },
              },
            },
          },
          hasActivePreOrder: {
            $anyElementTrue: [
              {
                $map: {
                  input: "$variants",
                  as: "variant",
                  in: {
                    $and: [
                      { $eq: ["$$variant.preOrder.enabled", true] },
                      {
                        $or: [
                          { $eq: [{ $ifNull: ["$$variant.preOrder.startAt", null] }, null] },
                          { $lte: ["$$variant.preOrder.startAt", "$$NOW"] },
                        ],
                      },
                      {
                        $or: [
                          { $eq: [{ $ifNull: ["$$variant.preOrder.endAt", null] }, null] },
                          { $gte: ["$$variant.preOrder.endAt", "$$NOW"] },
                        ],
                      },
                      { $gt: [{ $ifNull: ["$$variant.preOrder.remainingQuantity", 0] }, 0] },
                    ],
                  },
                },
              },
            ],
          },
          ...(rankedIds
            ? { searchRank: { $indexOfArray: [rankedIds, { $toString: "$_id" }] } }
            : {}),
        },
      },
      ...(priceMatch ? [{ $match: priceMatch }] : []),
    ];
    const [products, countRows] = await Promise.all([
      Product.aggregate([
        ...pipeline,
        { $sort: sort },
        { $skip: pagination.skip },
        { $limit: pagination.limit },
      ] as never),
      Product.aggregate([...pipeline, { $count: "total" }] as never),
    ]);
    const total = (countRows as Array<{ total: number }>)[0]?.total ?? 0;
    const data: unknown[] = options.publicOnly
      ? await serializePublicProducts(
          products as Array<Record<string, unknown>>,
          await viewerFor(req),
        )
      : await attachAdminStock(products as Array<Record<string, unknown>>);

    res.json({ ...buildPaginatedResult(data, total, pagination), suggestion });
  } catch (error) {
    next(error);
  }
}

/** Admin list shows real ledger stock per SKU (read-only; edits go through Inventory). */
async function attachAdminStock(products: Array<Record<string, unknown>>) {
  const skus = products.flatMap((product) =>
    ((product.variants as Array<{ sku: string }>) ?? []).map((variant) => variant.sku),
  );
  const rows = (await StockLedger.aggregate([
    { $match: { sku: { $in: skus } } },
    { $group: { _id: "$sku", available: { $sum: "$available" }, reserved: { $sum: "$reserved" } } },
  ])) as Array<{ _id: string; available: number; reserved: number }>;
  const stock = new Map(rows.map((row) => [row._id, row]));

  return products.map((product) => ({
    ...product,
    variants: ((product.variants as Array<Record<string, unknown>>) ?? []).map((variant) => ({
      ...variant,
      ledgerStock: stock.get(String(variant.sku)) ?? { available: 0, reserved: 0 },
    })),
  }));
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

    const [serialized] = await serializePublicProducts(
      [product as Record<string, unknown>],
      await viewerFor(req),
    );
    res.json({ product: serialized });
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

    const viewer = await viewerFor(req);
    const [relatedProducts, recommendedProducts, frequentlyBoughtTogether, completeTheLook] =
      await Promise.all([
        findCuratedProducts(product.relatedProductIds, viewer),
        findCuratedProducts(product.recommendedProductIds, viewer),
        findCuratedProducts(product.frequentlyBoughtTogetherIds, viewer),
        findCuratedProducts(product.completeTheLookIds, viewer),
      ]);
    const [serialized] = await serializePublicProducts([product], viewer);

    res.json({
      product: serialized,
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
    res.json(await listApprovedReviews(String(req.params.slug), parsePagination(req.query)));
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

async function assertSlugAvailable(model: CatalogModel, slug: string, excludeId?: string) {
  const clash = await model
    .findOne({ slug, ...(excludeId ? { _id: { $ne: excludeId } } : {}) })
    .select("_id")
    .lean();

  if (clash) {
    throw new AppError(`The URL slug "${slug}" is already in use. Choose another.`, 409);
  }
}

async function createProduct(req: Request, res: Response, next: NextFunction) {
  try {
    const slug = createSlug(req.body.slug ?? req.body.name);
    await assertSlugAvailable(Product as unknown as CatalogModel, slug);
    const variants = req.body.variants.map(
      (variant: z.infer<typeof variantInputSchema>, index: number) =>
        normalizeVariantIdentity(variant, slug, index),
    );
    await assertSkusAvailable(variants.map((variant: { sku: string }) => variant.sku));
    const product = await Product.create({
      ...req.body,
      slug,
      variants: stripStockInput(variants),
    });
    product.computedBadges = computeBadges(product);
    await product.save();
    await ensureLedgersForVariants(variants);
    invalidateSearchIndex();

    res.status(201).json({ product });
  } catch (error) {
    next(error);
  }
}

async function updateProduct(req: Request, res: Response, next: NextFunction) {
  try {
    const productId = String(req.params.id);
    const existing = (await Product.findById(productId).select("slug").lean()) as {
      slug: string;
    } | null;

    if (!existing) {
      throw new AppError("Product not found", 404);
    }

    const update = { ...req.body };

    if (update.slug || update.name) {
      update.slug = createSlug(update.slug ?? update.name);
      await assertSlugAvailable(Product as unknown as CatalogModel, update.slug, productId);
    }

    let incomingVariants: Array<ReturnType<typeof normalizeVariantIdentity>> | undefined;

    if (update.variants) {
      const productSlug = update.slug ?? existing.slug ?? "product";
      incomingVariants = update.variants.map(
        (variant: z.infer<typeof variantInputSchema>, index: number) =>
          normalizeVariantIdentity(variant, productSlug, index),
      );
      await assertSkusAvailable(
        incomingVariants!.map((variant) => variant.sku),
        productId,
      );
      update.variants = stripStockInput(
        await mergeVariantsPreservingIds(productId, incomingVariants! as never),
      );
    }

    const product = await Product.findByIdAndUpdate(productId, { $set: update }, { new: true });

    if (!product) {
      throw new AppError("Product not found", 404);
    }

    product.computedBadges = computeBadges(product);
    await product.save();

    if (incomingVariants) {
      await ensureLedgersForVariants(incomingVariants);
    }

    if (update.slug && update.slug !== existing.slug) {
      await recordSlugChange(`/shop/${existing.slug}`, `/shop/${update.slug}`, req.user?.id);
    }

    invalidateSearchIndex();
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
  const sku = (
    variant.sku?.trim() ||
    generateSku({
      color: variant.color,
      productSlug,
      sequence: index + 1,
      size: variant.size,
    })
  ).toUpperCase();

  return {
    ...variant,
    barcode: variant.barcode ?? generateBarcode(sku),
    preOrder: normalizePreOrder(variant.preOrder),
    sku,
  };
}

/** Opening stock is written to the inventory ledger, never stored on the product. */
function stripStockInput<T extends Record<string, unknown>>(variants: T[]) {
  return variants.map(
    ({ initialStock: _initial, stockPlaceholder: _placeholder, ...variant }) => variant,
  );
}

async function deleteProduct(req: Request, res: Response, next: NextFunction) {
  try {
    const product = await Product.findByIdAndUpdate(
      req.params.id,
      { $set: { status: "deleted", deletedAt: new Date(), active: false } },
      { new: true },
    );

    if (!product) {
      throw new AppError("Product not found", 404);
    }

    invalidateSearchIndex();
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

async function findCuratedProducts(productIds: unknown, viewer: { priceListCode?: string }) {
  if (!Array.isArray(productIds) || productIds.length === 0) {
    return [];
  }

  const products = await Product.find({
    _id: { $in: productIds },
    status: { $ne: "deleted" },
    active: true,
  })
    .select("name slug media variants computedBadges ratingAverage ratingCount")
    .lean();

  return serializePublicProducts(products as Array<Record<string, unknown>>, viewer);
}

function registerTaxonomyRoutes(
  path: string,
  model: CatalogModel,
  schema: TaxonomySchema,
  publicPrefix?: string,
) {
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
        const slug = createSlug(req.body.slug ?? req.body.name);
        await assertSlugAvailable(model, slug);
        const item = await model.create({ ...req.body, slug });
        invalidateSearchIndex();
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
        const id = String(req.params.id);
        const update = { ...req.body };
        const existing = (await model.findById(id).select("slug").lean()) as {
          slug?: string;
        } | null;

        if (!existing) {
          throw new AppError("Catalog item not found", 404);
        }

        if (update.slug || update.name) {
          update.slug = createSlug(update.slug ?? update.name);
          await assertSlugAvailable(model, update.slug, id);
        }

        const item = await model.findByIdAndUpdate(id, { $set: update }, { new: true });

        if (publicPrefix && update.slug && existing.slug && update.slug !== existing.slug) {
          await recordSlugChange(
            `${publicPrefix}${existing.slug}`,
            `${publicPrefix}${update.slug}`,
            req.user?.id,
          );
        }

        invalidateSearchIndex();
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
          { $set: { status: "deleted", deletedAt: new Date(), active: false } },
          { new: true },
        );

        if (!item) {
          throw new AppError("Catalog item not found", 404);
        }

        invalidateSearchIndex();
        res.json({ deleted: true });
      } catch (error) {
        next(error);
      }
    },
  );
}

function buildPriceMatch(query: Record<string, unknown>) {
  const min = Number(query.minPrice);
  const max = Number(query.maxPrice);
  const range: Record<string, number> = {};

  if (typeof query.minPrice === "string" && query.minPrice && Number.isFinite(min))
    range.$gte = min;
  if (typeof query.maxPrice === "string" && query.maxPrice && Number.isFinite(max))
    range.$lte = max;

  return Object.keys(range).length ? { effectivePrice: range } : undefined;
}

/** Aggregation $match does not cast strings, so id filters are converted explicitly. */
function castObjectIds(filter: Record<string, unknown>) {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(filter)) {
    if (
      ["brandId", "categoryIds", "collectionIds", "tagIds"].includes(key) &&
      typeof value === "string"
    ) {
      if (!Types.ObjectId.isValid(value)) {
        throw new AppError(`Invalid ${key} filter`, 400);
      }
      result[key] = new Types.ObjectId(value);
    } else {
      result[key] = value;
    }
  }

  return result;
}

function normalizeProductFilters(query: Record<string, unknown>): Record<string, unknown> {
  const filter = pickStringFilters(query, [
    "brandId",
    "categoryId",
    "collectionId",
    "tagId",
    "active",
    "size",
    "color",
    "preOrder",
  ]);

  if (filter.preOrder !== undefined) {
    filter.preOrder = filter.preOrder === "true";
  }

  if (typeof query.fabric === "string" && query.fabric.length > 0) {
    filter["fabric.regex"] = query.fabric.slice(0, 60);
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

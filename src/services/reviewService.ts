import { Types } from "mongoose";
import { AppError } from "../middleware/errorHandler.js";
import { Media } from "../models/Media.js";
import { Order } from "../models/Order.js";
import { Product } from "../models/Product.js";
import { ProductReview } from "../models/ProductReview.js";
import { User } from "../models/User.js";
import { buildPaginatedResult, type PaginationOptions } from "../utils/pagination.js";
import { writeAuditLog } from "./auditLogService.js";

type ReviewInput = {
  rating: number;
  title?: string;
  body: string;
  photoMediaIds?: string[];
};

const verifiedPurchaseStatuses = ["delivered", "returned", "refunded", "shipped"];

async function findActiveProduct(slug: string) {
  const product = (await Product.findOne({ slug, active: true, status: { $ne: "deleted" } })
    .select("_id name slug")
    .lean()) as unknown as { _id: Types.ObjectId; name: string; slug: string } | null;

  if (!product) {
    throw new AppError("Product not found", 404);
  }

  return product;
}

export async function submitReview(input: { slug: string; userId: string; review: ReviewInput }) {
  const product = await findActiveProduct(input.slug);
  const existing = await ProductReview.findOne({
    productId: product._id,
    status: { $ne: "deleted" },
    userId: input.userId,
  })
    .select("_id")
    .lean();

  if (existing) {
    throw new AppError("You have already reviewed this product. Edit your existing review instead.", 409);
  }

  const [user, purchase, photos] = await Promise.all([
    User.findById(input.userId).select("firstName lastName email").lean() as unknown as Promise<{
      firstName?: string;
      lastName?: string;
      email: string;
    } | null>,
    Order.exists({
      "items.productId": product._id,
      status: { $in: verifiedPurchaseStatuses },
      userId: input.userId,
    }),
    resolveReviewPhotos(input.userId, input.review.photoMediaIds ?? []),
  ]);

  const review = await ProductReview.create({
    body: input.review.body,
    guestName: displayName(user),
    moderationStatus: "pending",
    photos,
    productId: product._id,
    rating: input.review.rating,
    title: input.review.title,
    userId: input.userId,
    verifiedPurchase: Boolean(purchase),
  });

  return review;
}

/** Customers may edit their review; an edit sends it back through moderation. */
export async function updateOwnReview(input: { reviewId: string; userId: string; review: ReviewInput }) {
  const review = await ProductReview.findOne({
    _id: input.reviewId,
    status: { $ne: "deleted" },
    userId: input.userId,
  });

  if (!review) {
    throw new AppError("Review not found", 404);
  }

  review.rating = input.review.rating;
  review.title = input.review.title;
  review.body = input.review.body;
  if (input.review.photoMediaIds) {
    review.set("photos", await resolveReviewPhotos(input.userId, input.review.photoMediaIds));
  }
  const wasApproved = review.moderationStatus === "approved";
  review.moderationStatus = "pending";
  await review.save();

  if (wasApproved) {
    await recalculateProductRating(review.productId);
  }

  return review;
}

export async function listOwnReviews(userId: string) {
  return ProductReview.find({ status: { $ne: "deleted" }, userId })
    .populate("productId", "name slug media")
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();
}

export async function listApprovedReviews(slug: string, pagination: PaginationOptions) {
  const product = await findActiveProduct(slug);
  const filter = { moderationStatus: "approved", productId: product._id, status: { $ne: "deleted" } };
  const [reviews, total, distribution] = await Promise.all([
    ProductReview.find(filter)
      .select("rating title body guestName photos verifiedPurchase createdAt")
      .sort({ createdAt: -1 })
      .skip(pagination.skip)
      .limit(pagination.limit)
      .lean(),
    ProductReview.countDocuments(filter),
    ProductReview.aggregate([
      { $match: filter },
      { $group: { _id: "$rating", count: { $sum: 1 } } },
    ]) as Promise<Array<{ _id: number; count: number }>>,
  ]);
  const counts = Object.fromEntries([1, 2, 3, 4, 5].map((star) => [star, 0])) as Record<number, number>;
  let sum = 0;
  for (const row of distribution) {
    counts[row._id] = row.count;
    sum += row._id * row.count;
  }

  return {
    ...buildPaginatedResult(reviews, total, pagination),
    summary: {
      average: total ? Math.round((sum / total) * 10) / 10 : 0,
      count: total,
      distribution: counts,
    },
  };
}

export async function listReviewsForModeration(
  filter: { moderationStatus?: string; search?: string },
  pagination: PaginationOptions,
) {
  const query: Record<string, unknown> = { status: { $ne: "deleted" } };

  if (filter.moderationStatus) {
    query.moderationStatus = filter.moderationStatus;
  }

  if (filter.search) {
    query.$or = [
      { body: { $regex: escapeRegex(filter.search), $options: "i" } },
      { title: { $regex: escapeRegex(filter.search), $options: "i" } },
    ];
  }

  const [items, total] = await Promise.all([
    ProductReview.find(query)
      .populate("productId", "name slug")
      .populate("userId", "email firstName lastName")
      .sort({ createdAt: -1 })
      .skip(pagination.skip)
      .limit(pagination.limit)
      .lean(),
    ProductReview.countDocuments(query),
  ]);

  return buildPaginatedResult(items, total, pagination);
}

export async function moderateReview(input: {
  reviewId: string;
  moderationStatus: "approved" | "rejected" | "pending";
  moderationNote?: string;
  adminUserId: string;
}) {
  const review = await ProductReview.findOne({ _id: input.reviewId, status: { $ne: "deleted" } });

  if (!review) {
    throw new AppError("Review not found", 404);
  }

  const before = review.toObject();
  review.moderationStatus = input.moderationStatus;
  review.moderationNote = input.moderationNote;
  review.moderatedBy = new Types.ObjectId(input.adminUserId);
  review.moderatedAt = new Date();
  await review.save();
  await recalculateProductRating(review.productId);
  await writeAuditLog({
    action: "update",
    actor: { actorId: new Types.ObjectId(input.adminUserId), actorType: "admin" },
    after: review.toObject(),
    before,
    entity: { displayId: String(review._id), id: review._id, type: "product-review" },
    metadata: { moderationStatus: input.moderationStatus },
  });

  return review;
}

export async function deleteReview(reviewId: string, adminUserId: string) {
  const review = await ProductReview.findOneAndUpdate(
    { _id: reviewId, status: { $ne: "deleted" } },
    { $set: { deletedAt: new Date(), status: "deleted" } },
    { new: true },
  );

  if (!review) {
    throw new AppError("Review not found", 404);
  }

  await recalculateProductRating(review.productId);
  await writeAuditLog({
    action: "delete",
    actor: { actorId: new Types.ObjectId(adminUserId), actorType: "admin" },
    after: {},
    before: review.toObject(),
    entity: { displayId: String(review._id), id: review._id, type: "product-review" },
  });
  return { deleted: true };
}

/** Keeps Product.ratingAverage/ratingCount equal to approved reviews only. */
export async function recalculateProductRating(productId: unknown) {
  const [row] = (await ProductReview.aggregate([
    {
      $match: {
        moderationStatus: "approved",
        productId: new Types.ObjectId(String(productId)),
        status: { $ne: "deleted" },
      },
    },
    { $group: { _id: null, average: { $avg: "$rating" }, count: { $sum: 1 } } },
  ])) as Array<{ average: number; count: number }>;

  await Product.updateOne(
    { _id: productId },
    {
      $set: {
        ratingAverage: row ? Math.round(row.average * 10) / 10 : 0,
        ratingCount: row?.count ?? 0,
      },
    },
  );
}

async function resolveReviewPhotos(userId: string, mediaIds: string[]) {
  if (!mediaIds.length) {
    return [];
  }

  const media = (await Media.find({
    _id: { $in: mediaIds.slice(0, 5) },
    status: { $ne: "deleted" },
    uploadContext: "review-photo",
    uploadedBy: userId,
  }).lean()) as unknown as Array<{
    _id: Types.ObjectId;
    secureUrl: string;
    altText: string;
    selectedAspectRatio: string;
    renditions?: Array<{ url: string; width: number }>;
  }>;

  if (media.length !== Math.min(mediaIds.length, 5)) {
    throw new AppError("Review photos must be images you uploaded", 400);
  }

  return media.map((item) => ({
    altText: item.altText,
    aspectRatio: item.selectedAspectRatio,
    mediaId: item._id,
    type: "image",
    url: item.renditions?.find((rendition) => rendition.width === 768)?.url ?? item.secureUrl,
  }));
}

function displayName(user: { firstName?: string; lastName?: string; email: string } | null) {
  if (!user) {
    return "Customer";
  }

  if (user.firstName) {
    return `${user.firstName}${user.lastName ? ` ${user.lastName.charAt(0)}.` : ""}`;
  }

  return user.email.split("@")[0];
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

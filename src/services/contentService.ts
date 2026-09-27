import { AppError } from "../middleware/errorHandler.js";
import { BlogAuthor, BlogCategory, BlogPost } from "../models/Blog.js";
import { CmsPage } from "../models/CmsPage.js";
import { Product } from "../models/Product.js";
import { buildPaginatedResult, type PaginationOptions } from "../utils/pagination.js";
import { estimateReadingMinutes, htmlToPlainText, sanitizeRichHtml } from "./htmlSanitizer.js";
import { recordSlugChange } from "./redirectService.js";
import { createSlug } from "./slugService.js";

// ---------- CMS pages & policies ----------

type PageInput = {
  slug?: string;
  title: string;
  kind: "policy" | "page";
  summary?: string;
  body: string;
  heroImage?: unknown;
  faqs?: Array<{ question: string; answer: string }>;
  pageStatus: "draft" | "published";
  showInFooter?: boolean;
  sortOrder?: number;
  seo?: Record<string, unknown>;
};

/** Paths owned by application routes; CMS pages may not shadow them. */
const RESERVED_SLUGS = new Set([
  "admin",
  "account",
  "api",
  "blog",
  "cart",
  "checkout",
  "shop",
  "categories",
  "collections",
  "login",
  "register",
  "contact",
  "faq",
  "about",
  "search",
]);

export async function listPublishedPages(kind?: "policy" | "page") {
  return CmsPage.find({ pageStatus: "published", status: { $ne: "deleted" }, ...(kind ? { kind } : {}) })
    .select("slug title kind summary showInFooter sortOrder updatedAt seo.robotsIndex")
    .sort({ sortOrder: 1, title: 1 })
    .lean();
}

export async function getPublishedPage(slug: string) {
  const page = await CmsPage.findOne({ pageStatus: "published", slug, status: { $ne: "deleted" } }).lean();
  if (!page) throw new AppError("Page not found", 404);
  return page;
}

export async function listAdminPages() {
  return CmsPage.find({ status: { $ne: "deleted" } }).sort({ kind: 1, sortOrder: 1 }).lean();
}

export async function savePage(input: PageInput, updatedBy: string, id?: string) {
  const slug = createSlug(input.slug || input.title);

  if (RESERVED_SLUGS.has(slug)) {
    throw new AppError(`"${slug}" is reserved by the storefront. Choose another URL.`, 409);
  }

  const clash = await CmsPage.findOne({ slug, ...(id ? { _id: { $ne: id } } : {}) }).select("_id").lean();
  if (clash) throw new AppError(`A page already uses /pages/${slug}`, 409);

  const data = {
    ...input,
    body: sanitizeRichHtml(input.body),
    faqs: input.faqs?.map((faq) => ({ answer: faq.answer.trim(), question: faq.question.trim() })),
    slug,
    updatedBy,
  };

  if (!id) {
    return CmsPage.create({ ...data, publishedAt: data.pageStatus === "published" ? new Date() : undefined });
  }

  const existing = await CmsPage.findById(id);
  if (!existing) throw new AppError("Page not found", 404);
  const previousSlug = existing.slug;
  existing.set(data);
  if (data.pageStatus === "published" && !existing.publishedAt) existing.publishedAt = new Date();
  await existing.save();

  if (previousSlug !== slug) {
    await recordSlugChange(`/pages/${previousSlug}`, `/pages/${slug}`, updatedBy);
  }

  return existing;
}

export async function deletePage(id: string) {
  const page = await CmsPage.findByIdAndUpdate(id, { $set: { deletedAt: new Date(), status: "deleted" } });
  if (!page) throw new AppError("Page not found", 404);
}

/**
 * Creates draft policy pages on first run so the storefront legal pages always resolve. The
 * text is a starting template the business must review with its legal adviser before publishing.
 */
export async function seedDefaultPolicyPages() {
  const defaults: Array<{ slug: string; title: string; summary: string; body: string }> = [
    {
      body: "<h2>Information we collect</h2><p>We collect the details you give us when you create an account, place an order or contact us: your name, email, phone number, delivery address and order history. Payments are processed by Razorpay; we never see or store your card details.</p><h2>How we use it</h2><p>To process and deliver orders, provide customer support, prevent fraud, meet tax obligations and, only with your consent, send offers and updates.</p><h2>Your choices</h2><p>You can update marketing preferences, download your data or request deletion of your account at any time from My Account &gt; Privacy.</p><h2>Contact</h2><p>For privacy questions, write to us through the Contact page.</p>",
      slug: "privacy-policy",
      summary: "How The Vastra House collects, uses and protects your personal data.",
      title: "Privacy Policy",
    },
    {
      body: "<h2>Orders</h2><p>An order is accepted once payment (or the secured-COD advance) is confirmed. Prices include GST. We may cancel an order if an item is unavailable, in which case any payment is refunded in full.</p><h2>Pre-orders</h2><p>Pre-order items are made after you order. Expected dispatch dates are estimates and we will keep you updated at each production stage.</p><h2>Use of the website</h2><p>Content, images and designs on this website belong to The Vastra House and may not be reused without permission.</p>",
      slug: "terms-and-conditions",
      summary: "The terms that apply when you shop with The Vastra House.",
      title: "Terms & Conditions",
    },
    {
      body: "<h2>Delivery timelines</h2><p>In-stock orders are dispatched within 2–4 business days. Pre-order items ship on the expected dispatch date shown on the product page.</p><h2>Shipping charges</h2><p>Standard shipping is free above the threshold shown at checkout; express shipping is charged at checkout.</p><h2>Tracking</h2><p>You will receive tracking details by email once your order ships, and you can follow it on the Track Order page.</p>",
      slug: "shipping-policy",
      summary: "Delivery timelines, charges and tracking.",
      title: "Shipping Policy",
    },
    {
      body: "<h2>Return window</h2><p>You can request a return within 7 days of delivery from My Account &gt; Orders. Items must be unused, unwashed and with original tags.</p><h2>Refunds</h2><p>Online payments are refunded to the original payment method; COD orders are refunded by bank transfer or as store credit. Refunds are processed after the returned item passes quality check.</p><h2>Non-returnable items</h2><p>Custom and made-to-measure pieces cannot be returned unless they arrive damaged or defective.</p>",
      slug: "return-policy",
      summary: "How to return an item and how refunds work.",
      title: "Return & Refund Policy",
    },
    {
      body: "<h2>Before dispatch</h2><p>You can cancel an order from My Account &gt; Orders until it is dispatched. Online payments are refunded automatically to the original payment method; any store credit or reward points used are restored.</p><h2>After dispatch</h2><p>Once an order has shipped it cannot be cancelled, but you can request a return after delivery.</p>",
      slug: "cancellation-policy",
      summary: "How and when you can cancel an order.",
      title: "Cancellation Policy",
    },
  ];

  let created = 0;
  for (const [index, page] of defaults.entries()) {
    const result = await CmsPage.updateOne(
      { slug: page.slug },
      {
        $setOnInsert: {
          ...page,
          kind: "policy",
          pageStatus: "published",
          publishedAt: new Date(),
          showInFooter: true,
          sortOrder: index,
        },
      },
      { upsert: true },
    );
    created += result.upsertedCount;
  }
  return { created };
}

// ---------- Blog ----------

type PostInput = {
  title: string;
  slug?: string;
  excerpt?: string;
  content: string;
  featuredImage?: unknown;
  categoryId?: string | null;
  tags?: string[];
  authorId?: string | null;
  relatedProductIds?: string[];
  faqs?: Array<{ question: string; answer: string }>;
  postStatus: "draft" | "scheduled" | "published";
  publishedAt?: Date;
  seo?: Record<string, unknown>;
};

const publicPostFilter = () => ({
  postStatus: "published",
  publishedAt: { $lte: new Date() },
  status: { $ne: "deleted" },
});

export async function listPublishedPosts(
  filter: { category?: string; tag?: string },
  pagination: PaginationOptions,
) {
  const query: Record<string, unknown> = publicPostFilter();

  if (filter.category) {
    const category = (await BlogCategory.findOne({ slug: filter.category, status: { $ne: "deleted" } })
      .select("_id")
      .lean()) as unknown as { _id: unknown } | null;
    if (!category) throw new AppError("Category not found", 404);
    query.categoryId = category._id;
  }
  if (filter.tag) query.tags = filter.tag.toLowerCase();

  const [items, total] = await Promise.all([
    BlogPost.find(query)
      .select("title slug excerpt featuredImage categoryId tags authorId publishedAt readingMinutes updatedAt")
      .populate("categoryId", "name slug")
      .populate("authorId", "name slug")
      .sort({ publishedAt: -1 })
      .skip(pagination.skip)
      .limit(pagination.limit)
      .lean(),
    BlogPost.countDocuments(query),
  ]);

  return buildPaginatedResult(items, total, pagination);
}

export async function getPublishedPost(slug: string) {
  const post = (await BlogPost.findOne({ ...publicPostFilter(), slug })
    .populate("categoryId", "name slug")
    .populate("authorId", "name slug bio avatar")
    .lean()) as unknown as (Record<string, unknown> & {
    _id: unknown;
    categoryId?: { _id: unknown };
    tags?: string[];
    relatedProductIds?: unknown[];
  }) | null;

  if (!post) throw new AppError("Article not found", 404);

  const [related, products] = await Promise.all([
    BlogPost.find({
      ...publicPostFilter(),
      _id: { $ne: post._id },
      $or: [{ categoryId: post.categoryId?._id }, { tags: { $in: post.tags ?? [] } }],
    })
      .select("title slug excerpt featuredImage publishedAt")
      .sort({ publishedAt: -1 })
      .limit(3)
      .lean(),
    post.relatedProductIds?.length
      ? Product.find({ _id: { $in: post.relatedProductIds }, active: true, status: { $ne: "deleted" } })
          .select("name slug media variants.basePrice variants.salePrice")
          .lean()
      : Promise.resolve([]),
  ]);

  return { post, relatedPosts: related, relatedProducts: products };
}

export async function listBlogTaxonomy() {
  const [categories, tags] = await Promise.all([
    BlogCategory.find({ status: { $ne: "deleted" } }).select("name slug description seo").sort({ name: 1 }).lean(),
    BlogPost.aggregate([
      { $match: publicPostFilter() },
      { $unwind: "$tags" },
      { $group: { _id: "$tags", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 50 },
    ]),
  ]);
  return { categories, tags: (tags as Array<{ _id: string; count: number }>).map((tag) => ({ count: tag.count, tag: tag._id })) };
}

export async function listAdminPosts(pagination: PaginationOptions, search?: string) {
  const query: Record<string, unknown> = { status: { $ne: "deleted" } };
  if (search) query.title = { $options: "i", $regex: search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") };
  const [items, total] = await Promise.all([
    BlogPost.find(query)
      .select("title slug postStatus publishedAt categoryId authorId updatedAt seo.title seo.description")
      .populate("categoryId", "name")
      .populate("authorId", "name")
      .sort({ updatedAt: -1 })
      .skip(pagination.skip)
      .limit(pagination.limit)
      .lean(),
    BlogPost.countDocuments(query),
  ]);
  return buildPaginatedResult(items, total, pagination);
}

export async function getAdminPost(id: string) {
  const post = await BlogPost.findOne({ _id: id, status: { $ne: "deleted" } }).lean();
  if (!post) throw new AppError("Article not found", 404);
  return post;
}

export async function savePost(input: PostInput, userId: string, id?: string) {
  const slug = createSlug(input.slug || input.title);
  const clash = await BlogPost.findOne({ slug, ...(id ? { _id: { $ne: id } } : {}) }).select("_id").lean();
  if (clash) throw new AppError(`Another article already uses /blog/${slug}`, 409);

  if (input.postStatus === "scheduled" && (!input.publishedAt || input.publishedAt <= new Date())) {
    throw new AppError("Scheduled articles need a future publish date", 400);
  }

  const content = sanitizeRichHtml(input.content);
  const data = {
    ...input,
    authorId: input.authorId || undefined,
    categoryId: input.categoryId || undefined,
    content,
    excerpt: input.excerpt?.trim() || htmlToPlainText(content).slice(0, 220),
    publishedAt:
      input.postStatus === "published" ? (input.publishedAt ?? new Date()) : input.publishedAt,
    readingMinutes: estimateReadingMinutes(content),
    slug,
    tags: [...new Set((input.tags ?? []).map((tag) => tag.trim().toLowerCase()).filter(Boolean))],
    updatedBy: userId,
  };

  if (!id) {
    return BlogPost.create({ ...data, createdBy: userId });
  }

  const post = await BlogPost.findById(id);
  if (!post) throw new AppError("Article not found", 404);
  const previousSlug = post.slug;
  post.set(data);
  await post.save();

  if (previousSlug !== slug && post.postStatus === "published") {
    await recordSlugChange(`/blog/${previousSlug}`, `/blog/${slug}`, userId);
  }

  return post;
}

export async function deletePost(id: string) {
  const post = await BlogPost.findByIdAndUpdate(id, { $set: { deletedAt: new Date(), status: "deleted" } });
  if (!post) throw new AppError("Article not found", 404);
}

/** Scheduled job: publishes articles whose scheduled time has arrived. */
export async function publishScheduledPosts(now = new Date()) {
  const result = await BlogPost.updateMany(
    { postStatus: "scheduled", publishedAt: { $lte: now }, status: { $ne: "deleted" } },
    { $set: { postStatus: "published" } },
  );
  return { published: result.modifiedCount };
}

export async function saveBlogCategory(input: { name: string; slug?: string; description?: string; seo?: Record<string, unknown> }, id?: string) {
  const slug = createSlug(input.slug || input.name);
  const clash = await BlogCategory.findOne({ slug, ...(id ? { _id: { $ne: id } } : {}) }).select("_id").lean();
  if (clash) throw new AppError(`Category slug "${slug}" is taken`, 409);
  return id
    ? BlogCategory.findByIdAndUpdate(id, { $set: { ...input, slug } }, { new: true })
    : BlogCategory.create({ ...input, slug });
}

export async function saveBlogAuthor(input: { name: string; slug?: string; bio?: string; avatar?: unknown }, id?: string) {
  const slug = createSlug(input.slug || input.name);
  const clash = await BlogAuthor.findOne({ slug, ...(id ? { _id: { $ne: id } } : {}) }).select("_id").lean();
  if (clash) throw new AppError(`Author slug "${slug}" is taken`, 409);
  return id
    ? BlogAuthor.findByIdAndUpdate(id, { $set: { ...input, slug } }, { new: true })
    : BlogAuthor.create({ ...input, slug });
}

export async function listBlogAuthors() {
  return BlogAuthor.find({ status: { $ne: "deleted" } }).sort({ name: 1 }).lean();
}

export async function blogSitemapEntries() {
  const [posts, categories] = await Promise.all([
    BlogPost.find({ ...publicPostFilter(), "seo.robotsIndex": { $ne: false } })
      .select("slug updatedAt publishedAt title featuredImage")
      .lean(),
    BlogCategory.find({ status: { $ne: "deleted" }, "seo.robotsIndex": { $ne: false } }).select("slug updatedAt").lean(),
  ]);
  return { categories, posts };
}

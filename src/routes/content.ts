import { Router } from "express";
import { z } from "zod";
import { requireAuth, requirePermission } from "../middleware/authMiddleware.js";
import { validateRequest } from "../middleware/validateRequest.js";
import {
  blogSitemapEntries,
  deletePage,
  deletePost,
  getAdminPost,
  getPublishedPage,
  getPublishedPost,
  listAdminPages,
  listAdminPosts,
  listBlogAuthors,
  listBlogTaxonomy,
  listPublishedPages,
  listPublishedPosts,
  saveBlogAuthor,
  saveBlogCategory,
  savePage,
  savePost,
} from "../services/contentService.js";
import {
  createRedirect,
  deleteRedirect,
  listRedirects,
  resolveRedirect,
  updateRedirect,
} from "../services/redirectService.js";
import { getAdminSeoSettings, runSeoAudit, updateSeoSettings } from "../services/seoService.js";
import { parsePagination } from "../utils/pagination.js";
import { seoInputSchema } from "./catalog.js";

export const contentRouter = Router();

const objectId = z.string().regex(/^[a-f\d]{24}$/i);
const idParams = z.object({ id: objectId }).strict();
const slugParams = z.object({ slug: z.string().min(1).max(200) }).strict();
const mediaSchema = z
  .object({
    mediaId: objectId.optional(),
    url: z.string().min(1).max(1000),
    altText: z.string().min(3).max(160),
    type: z.enum(["image", "video", "pdf", "lookbook"]).default("image"),
    aspectRatio: z.enum(["1:1", "4:5", "9:16", "16:7", "16:9", "21:9", "3:2", "2:3", "custom"]).default("16:9"),
    objectFit: z.enum(["cover", "contain"]).optional(),
  })
  .strict();
const faqSchema = z.object({ question: z.string().trim().min(3).max(300), answer: z.string().trim().min(2).max(4000) }).strict();

// ---------------- Public ----------------

contentRouter.get("/pages", async (req, res, next) => {
  try {
    const kind = req.query.kind === "policy" || req.query.kind === "page" ? req.query.kind : undefined;
    res.json({ pages: await listPublishedPages(kind) });
  } catch (error) {
    next(error);
  }
});

contentRouter.get("/pages/:slug", validateRequest({ params: slugParams }), async (req, res, next) => {
  try {
    res.json({ page: await getPublishedPage(String(req.params.slug)) });
  } catch (error) {
    next(error);
  }
});

contentRouter.get("/blog", async (req, res, next) => {
  try {
    res.json(
      await listPublishedPosts(
        {
          category: typeof req.query.category === "string" ? req.query.category : undefined,
          tag: typeof req.query.tag === "string" ? req.query.tag : undefined,
        },
        parsePagination(req.query),
      ),
    );
  } catch (error) {
    next(error);
  }
});

contentRouter.get("/blog/taxonomy", async (_req, res, next) => {
  try {
    res.json(await listBlogTaxonomy());
  } catch (error) {
    next(error);
  }
});

contentRouter.get("/blog/sitemap", async (_req, res, next) => {
  try {
    res.json(await blogSitemapEntries());
  } catch (error) {
    next(error);
  }
});

contentRouter.get("/blog/:slug", validateRequest({ params: slugParams }), async (req, res, next) => {
  try {
    res.json(await getPublishedPost(String(req.params.slug)));
  } catch (error) {
    next(error);
  }
});

/** Used by the storefront edge middleware to apply 301/302s before rendering. */
contentRouter.get(
  "/redirects/resolve",
  validateRequest({ query: z.object({ path: z.string().min(1).max(500) }).strict() }),
  async (req, res, next) => {
    try {
      res.setHeader("Cache-Control", "public, max-age=60");
      res.json({ redirect: await resolveRedirect(String((req.query as { path: string }).path)) });
    } catch (error) {
      next(error);
    }
  },
);

// ---------------- Admin: pages ----------------

const cmsManage = [requireAuth, requirePermission({ module: "cms", action: "manage" })];
const seoManage = [requireAuth, requirePermission({ module: "seo", action: "manage" })];

const pageSchema = z
  .object({
    slug: z.string().trim().max(160).optional(),
    title: z.string().trim().min(2).max(160),
    kind: z.enum(["policy", "page"]).default("page"),
    summary: z.string().trim().max(500).optional(),
    body: z.string().min(1).max(200_000),
    heroImage: mediaSchema.optional(),
    faqs: z.array(faqSchema).max(30).optional(),
    pageStatus: z.enum(["draft", "published"]).default("draft"),
    showInFooter: z.boolean().optional(),
    sortOrder: z.coerce.number().int().optional(),
    seo: seoInputSchema,
  })
  .strict();

contentRouter.get("/admin/pages", ...cmsManage, async (_req, res, next) => {
  try {
    res.json({ pages: await listAdminPages() });
  } catch (error) {
    next(error);
  }
});

contentRouter.post("/admin/pages", ...cmsManage, validateRequest({ body: pageSchema }), async (req, res, next) => {
  try {
    res.status(201).json({ page: await savePage(req.body, req.user!.id) });
  } catch (error) {
    next(error);
  }
});

contentRouter.patch(
  "/admin/pages/:id",
  ...cmsManage,
  validateRequest({ params: idParams, body: pageSchema }),
  async (req, res, next) => {
    try {
      res.json({ page: await savePage(req.body, req.user!.id, String(req.params.id)) });
    } catch (error) {
      next(error);
    }
  },
);

contentRouter.delete("/admin/pages/:id", ...cmsManage, validateRequest({ params: idParams }), async (req, res, next) => {
  try {
    await deletePage(String(req.params.id));
    res.json({ deleted: true });
  } catch (error) {
    next(error);
  }
});

// ---------------- Admin: blog ----------------

const postSchema = z
  .object({
    title: z.string().trim().min(3).max(200),
    slug: z.string().trim().max(200).optional(),
    excerpt: z.string().trim().max(500).optional(),
    content: z.string().min(20).max(300_000),
    featuredImage: mediaSchema.optional(),
    categoryId: objectId.nullable().optional(),
    tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
    authorId: objectId.nullable().optional(),
    relatedProductIds: z.array(objectId).max(12).optional(),
    faqs: z.array(faqSchema).max(20).optional(),
    postStatus: z.enum(["draft", "scheduled", "published"]).default("draft"),
    publishedAt: z.coerce.date().optional(),
    seo: seoInputSchema,
  })
  .strict();

contentRouter.get("/admin/blog", ...cmsManage, async (req, res, next) => {
  try {
    res.json(
      await listAdminPosts(parsePagination(req.query), typeof req.query.search === "string" ? req.query.search : undefined),
    );
  } catch (error) {
    next(error);
  }
});

contentRouter.get("/admin/blog/meta", ...cmsManage, async (_req, res, next) => {
  try {
    const [taxonomy, authors] = await Promise.all([listBlogTaxonomy(), listBlogAuthors()]);
    res.json({ ...taxonomy, authors });
  } catch (error) {
    next(error);
  }
});

contentRouter.get("/admin/blog/:id", ...cmsManage, validateRequest({ params: idParams }), async (req, res, next) => {
  try {
    res.json({ post: await getAdminPost(String(req.params.id)) });
  } catch (error) {
    next(error);
  }
});

contentRouter.post("/admin/blog", ...cmsManage, validateRequest({ body: postSchema }), async (req, res, next) => {
  try {
    res.status(201).json({ post: await savePost(req.body, req.user!.id) });
  } catch (error) {
    next(error);
  }
});

contentRouter.patch(
  "/admin/blog/:id",
  ...cmsManage,
  validateRequest({ params: idParams, body: postSchema }),
  async (req, res, next) => {
    try {
      res.json({ post: await savePost(req.body, req.user!.id, String(req.params.id)) });
    } catch (error) {
      next(error);
    }
  },
);

contentRouter.delete("/admin/blog/:id", ...cmsManage, validateRequest({ params: idParams }), async (req, res, next) => {
  try {
    await deletePost(String(req.params.id));
    res.json({ deleted: true });
  } catch (error) {
    next(error);
  }
});

const blogCategorySchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    slug: z.string().trim().max(100).optional(),
    description: z.string().trim().max(1000).optional(),
    seo: seoInputSchema,
  })
  .strict();

contentRouter.post("/admin/blog-categories", ...cmsManage, validateRequest({ body: blogCategorySchema }), async (req, res, next) => {
  try {
    res.status(201).json({ category: await saveBlogCategory(req.body) });
  } catch (error) {
    next(error);
  }
});

contentRouter.patch(
  "/admin/blog-categories/:id",
  ...cmsManage,
  validateRequest({ params: idParams, body: blogCategorySchema }),
  async (req, res, next) => {
    try {
      res.json({ category: await saveBlogCategory(req.body, String(req.params.id)) });
    } catch (error) {
      next(error);
    }
  },
);

const authorSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    slug: z.string().trim().max(100).optional(),
    bio: z.string().trim().max(1000).optional(),
    avatar: mediaSchema.optional(),
  })
  .strict();

contentRouter.post("/admin/blog-authors", ...cmsManage, validateRequest({ body: authorSchema }), async (req, res, next) => {
  try {
    res.status(201).json({ author: await saveBlogAuthor(req.body) });
  } catch (error) {
    next(error);
  }
});

contentRouter.patch(
  "/admin/blog-authors/:id",
  ...cmsManage,
  validateRequest({ params: idParams, body: authorSchema }),
  async (req, res, next) => {
    try {
      res.json({ author: await saveBlogAuthor(req.body, String(req.params.id)) });
    } catch (error) {
      next(error);
    }
  },
);

// ---------------- Admin: SEO ----------------

const verificationSchema = z
  .object({
    google: z.string().trim().max(200).optional(),
    bing: z.string().trim().max(200).optional(),
    pinterest: z.string().trim().max(200).optional(),
    yandex: z.string().trim().max(200).optional(),
    other: z
      .array(z.object({ name: z.string().trim().regex(/^[a-z0-9:_-]{2,60}$/i), content: z.string().trim().max(300) }).strict())
      .max(10)
      .optional(),
  })
  .strict();

const seoSettingsSchema = z
  .object({
    siteName: z.string().trim().max(80).optional(),
    brandName: z.string().trim().max(80).optional(),
    titleTemplate: z
      .string()
      .trim()
      .max(80)
      .refine((value) => value.includes("%s"), "Title template must contain %s")
      .optional(),
    defaultTitle: z.string().trim().max(120).optional(),
    defaultDescription: z.string().trim().max(320).optional(),
    defaultKeywords: z.array(z.string().trim().min(1).max(60)).max(30).optional(),
    baseUrl: z.string().trim().url().optional().or(z.literal("")),
    defaultOgImage: mediaSchema.optional(),
    defaultTwitterImage: mediaSchema.optional(),
    twitterHandle: z.string().trim().regex(/^@?[A-Za-z0-9_]{0,15}$/).optional().or(z.literal("")),
    facebookAppId: z.string().trim().regex(/^\d*$/).optional(),
    locale: z.string().trim().regex(/^[a-z]{2}_[A-Z]{2}$/).optional(),
    verification: verificationSchema.optional(),
    robots: z
      .object({
        indexSite: z.boolean().optional(),
        extraDisallow: z.array(z.string().trim().regex(/^\/[^\s]*$/, "Disallow paths must start with /")).max(30).optional(),
      })
      .strict()
      .optional(),
    organization: z
      .object({
        legalName: z.string().trim().max(160).optional(),
        logo: mediaSchema.optional(),
        email: z.string().trim().email().optional().or(z.literal("")),
        phone: z.string().trim().max(30).optional(),
        streetAddress: z.string().trim().max(200).optional(),
        locality: z.string().trim().max(100).optional(),
        region: z.string().trim().max(100).optional(),
        postalCode: z.string().trim().max(12).optional(),
        countryCode: z.string().trim().length(2).optional(),
        sameAs: z.array(z.string().trim().url()).max(15).optional(),
      })
      .strict()
      .optional(),
    search: z
      .object({
        synonyms: z.array(z.string().trim().min(3).max(300)).max(200).optional(),
        boostNewArrivals: z.boolean().optional(),
      })
      .strict()
      .optional(),
    pages: z
      .array(
        z
          .object({
            path: z.string().trim().regex(/^\/[a-z0-9/_-]*$/i),
            label: z.string().trim().max(80).optional(),
            seo: seoInputSchema,
          })
          .strict(),
      )
      .max(50)
      .optional(),
  })
  .strict();

contentRouter.get("/admin/seo", ...seoManage, async (_req, res, next) => {
  try {
    res.json(await getAdminSeoSettings());
  } catch (error) {
    next(error);
  }
});

contentRouter.put("/admin/seo", ...seoManage, validateRequest({ body: seoSettingsSchema }), async (req, res, next) => {
  try {
    await updateSeoSettings(req.body, req.user!.id);
    res.json(await getAdminSeoSettings());
  } catch (error) {
    next(error);
  }
});

contentRouter.get("/admin/seo/audit", ...seoManage, async (_req, res, next) => {
  try {
    res.json(await runSeoAudit());
  } catch (error) {
    next(error);
  }
});

const redirectSchema = z
  .object({
    source: z.string().trim().min(1).max(500),
    destination: z.string().trim().min(1).max(1000),
    statusCode: z.union([z.literal(301), z.literal(302), z.literal(308)]).default(301),
    active: z.boolean().default(true),
  })
  .strict();

contentRouter.get("/admin/redirects", ...seoManage, async (_req, res, next) => {
  try {
    res.json({ redirects: await listRedirects() });
  } catch (error) {
    next(error);
  }
});

contentRouter.post("/admin/redirects", ...seoManage, validateRequest({ body: redirectSchema }), async (req, res, next) => {
  try {
    res.status(201).json({ redirect: await createRedirect({ ...req.body, createdBy: req.user!.id }) });
  } catch (error) {
    next(error);
  }
});

contentRouter.patch(
  "/admin/redirects/:id",
  ...seoManage,
  validateRequest({ params: idParams, body: redirectSchema.partial() }),
  async (req, res, next) => {
    try {
      res.json({ redirect: await updateRedirect(String(req.params.id), req.body) });
    } catch (error) {
      next(error);
    }
  },
);

contentRouter.delete("/admin/redirects/:id", ...seoManage, validateRequest({ params: idParams }), async (req, res, next) => {
  try {
    await deleteRedirect(String(req.params.id));
    res.json({ deleted: true });
  } catch (error) {
    next(error);
  }
});

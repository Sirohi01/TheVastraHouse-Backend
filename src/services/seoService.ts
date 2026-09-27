import { Types } from "mongoose";
import { env } from "../config/env.js";
import { BlogPost } from "../models/Blog.js";
import { Category } from "../models/Category.js";
import { CmsPage } from "../models/CmsPage.js";
import { Collection } from "../models/Collection.js";
import { Product } from "../models/Product.js";
import { SeoSettings } from "../models/SeoSettings.js";
import { getRuntimeSetting } from "./runtimeSettingsService.js";
import { htmlToPlainText } from "./htmlSanitizer.js";

type MediaRef = { url?: string; altText?: string; type?: string; aspectRatio?: string };

type SeoSettingsDoc = {
  siteName?: string;
  brandName?: string;
  titleTemplate?: string;
  defaultTitle?: string;
  defaultDescription?: string;
  defaultKeywords?: string[];
  baseUrl?: string;
  defaultOgImage?: MediaRef;
  defaultTwitterImage?: MediaRef;
  twitterHandle?: string;
  facebookAppId?: string;
  locale?: string;
  verification?: {
    google?: string;
    bing?: string;
    pinterest?: string;
    yandex?: string;
    other?: Array<{ name?: string; content?: string }>;
  };
  robots?: { indexSite?: boolean; extraDisallow?: string[] };
  organization?: {
    legalName?: string;
    logo?: MediaRef;
    email?: string;
    phone?: string;
    streetAddress?: string;
    locality?: string;
    region?: string;
    postalCode?: string;
    countryCode?: string;
    sameAs?: string[];
  };
  search?: { synonyms?: string[]; boostNewArrivals?: boolean };
  pages?: Array<{ path: string; label?: string; seo?: Record<string, unknown> }>;
  updatedAt?: Date;
};

export const TITLE_LIMITS = { max: 60, min: 30 };
export const DESCRIPTION_LIMITS = { max: 160, min: 70 };

async function loadSettings(): Promise<SeoSettingsDoc> {
  return ((await SeoSettings.findOne({ key: "global" }).lean()) as SeoSettingsDoc | null) ?? {};
}

/**
 * Public, fully-resolved SEO defaults: admin SEO settings first, then the legacy runtime/env
 * values, so the storefront always receives complete metadata inputs.
 */
export async function getPublicSeoSettings() {
  const [settings, siteName, defaultTitle, defaultDescription, defaultOgImage, twitterHandle, logoUrl, robotsExtraDisallow] =
    await Promise.all([
      loadSettings(),
      getRuntimeSetting("SEO_SITE_NAME"),
      getRuntimeSetting("SEO_DEFAULT_TITLE"),
      getRuntimeSetting("SEO_DEFAULT_DESCRIPTION"),
      getRuntimeSetting("SEO_DEFAULT_OG_IMAGE"),
      getRuntimeSetting("SEO_TWITTER_HANDLE"),
      getRuntimeSetting("SEO_ORGANIZATION_LOGO_URL"),
      getRuntimeSetting("SEO_ROBOTS_EXTRA_DISALLOW"),
    ]);
  const resolvedSiteName = settings.siteName || siteName || env.SEO_SITE_NAME;
  const ogImageUrl = settings.defaultOgImage?.url || defaultOgImage || env.SEO_DEFAULT_OG_IMAGE;
  const logo = settings.organization?.logo?.url || logoUrl || env.SEO_ORGANIZATION_LOGO_URL;
  const legacyDisallow = (robotsExtraDisallow ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  const ga4MeasurementId = (await getRuntimeSetting("GA4_MEASUREMENT_ID")) || env.GA4_MEASUREMENT_ID;

  return {
    analytics: { ga4MeasurementId: /^G-[A-Z0-9]{4,}$/.test(ga4MeasurementId) ? ga4MeasurementId : "" },
    baseUrl: (settings.baseUrl || env.FRONTEND_PUBLIC_URL).replace(/\/$/, ""),
    brandName: settings.brandName || resolvedSiteName,
    defaultDescription: settings.defaultDescription || defaultDescription || env.SEO_DEFAULT_DESCRIPTION,
    defaultKeywords: settings.defaultKeywords ?? [],
    defaultOgImage: ogImageUrl,
    defaultOgImageAlt: settings.defaultOgImage?.altText || resolvedSiteName,
    defaultTitle: settings.defaultTitle || defaultTitle || env.SEO_DEFAULT_TITLE,
    defaultTwitterImage: settings.defaultTwitterImage?.url || ogImageUrl,
    facebookAppId: settings.facebookAppId || "",
    locale: settings.locale || "en_IN",
    organization: {
      email: settings.organization?.email || env.COMPANY_EMAIL || "",
      legalName: settings.organization?.legalName || env.COMPANY_NAME,
      locality: settings.organization?.locality || "",
      logo,
      phone: settings.organization?.phone || "",
      postalCode: settings.organization?.postalCode || "",
      region: settings.organization?.region || "",
      countryCode: settings.organization?.countryCode || "IN",
      sameAs: settings.organization?.sameAs ?? [],
      streetAddress: settings.organization?.streetAddress || "",
    },
    // Kept for older clients.
    organizationLogoUrl: logo,
    pages: (settings.pages ?? []).map((page) => ({ label: page.label, path: page.path, seo: page.seo ?? {} })),
    robots: {
      extraDisallow: [...new Set([...(settings.robots?.extraDisallow ?? []), ...legacyDisallow])],
      indexSite: settings.robots?.indexSite !== false,
    },
    robotsExtraDisallow: [...(settings.robots?.extraDisallow ?? []), ...legacyDisallow].join(","),
    siteName: resolvedSiteName,
    titleTemplate: settings.titleTemplate || `%s | ${resolvedSiteName}`,
    twitterHandle: settings.twitterHandle || twitterHandle || env.SEO_TWITTER_HANDLE,
    updatedAt: settings.updatedAt,
    verification: {
      bing: settings.verification?.bing || "",
      google: settings.verification?.google || "",
      other: (settings.verification?.other ?? []).filter((item) => item.name && item.content),
      pinterest: settings.verification?.pinterest || "",
      yandex: settings.verification?.yandex || "",
    },
  };
}

export async function getAdminSeoSettings() {
  const settings = await loadSettings();
  return { settings, resolved: await getPublicSeoSettings() };
}

export async function updateSeoSettings(input: Record<string, unknown>, updatedBy: string) {
  const updated = await SeoSettings.findOneAndUpdate(
    { key: "global" },
    { $set: { ...input, key: "global", updatedBy: new Types.ObjectId(updatedBy) } },
    { new: true, runValidators: true, upsert: true },
  ).lean();
  const { invalidateSearchIndex } = await import("./searchService.js");
  invalidateSearchIndex();
  return updated;
}

type AuditIssue = {
  entityType: "product" | "category" | "collection" | "blog" | "page";
  entityId: string;
  name: string;
  path: string;
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
};

type AuditEntity = {
  _id: unknown;
  name?: string;
  title?: string;
  slug: string;
  description?: string;
  excerpt?: string;
  summary?: string;
  body?: string;
  content?: string;
  seo?: {
    title?: string;
    description?: string;
    canonicalUrl?: string;
    robotsIndex?: boolean;
    ogImage?: MediaRef;
  };
  media?: MediaRef[];
  banner?: MediaRef;
  featuredImage?: MediaRef;
  heroImage?: MediaRef;
  variants?: Array<{ media?: MediaRef[] }>;
};

/**
 * Reports concrete SEO problems across indexable content. No invented "score": every item is a
 * specific fixable issue with the value that caused it.
 */
export async function runSeoAudit() {
  const settings = await getPublicSeoSettings();
  const [products, categories, collections, posts, pages] = (await Promise.all([
    Product.find({ active: true, status: { $ne: "deleted" } }).select("name slug description seo media variants.media").lean(),
    Category.find({ active: true, status: { $ne: "deleted" } }).select("name slug description seo banner").lean(),
    Collection.find({ active: true, status: { $ne: "deleted" } }).select("name slug description seo banner").lean(),
    BlogPost.find({ postStatus: "published", status: { $ne: "deleted" } }).select("title slug excerpt content seo featuredImage").lean(),
    CmsPage.find({ pageStatus: "published", status: { $ne: "deleted" } }).select("title slug summary body seo heroImage kind").lean(),
  ])) as unknown as AuditEntity[][];
  const issues: AuditIssue[] = [];
  const titles = new Map<string, string[]>();
  const descriptions = new Map<string, string[]>();
  const groups: Array<{ type: AuditIssue["entityType"]; prefix: string; items: AuditEntity[] }> = [
    { items: products, prefix: "/shop/", type: "product" },
    { items: categories, prefix: "/categories/", type: "category" },
    { items: collections, prefix: "/collections/", type: "collection" },
    { items: posts, prefix: "/blog/", type: "blog" },
    { items: pages, prefix: "/pages/", type: "page" },
  ];

  if (!settings.defaultOgImage) {
    issues.push({ code: "missing_default_og_image", entityId: "global", entityType: "page", message: "No global default social sharing image is configured.", name: "Global SEO", path: "/admin/seo", severity: "error" });
  }

  for (const group of groups) {
    for (const item of group.items) {
      const name = item.name ?? item.title ?? item.slug;
      const path = `${group.prefix}${item.slug}`;
      const add = (severity: AuditIssue["severity"], code: string, message: string) =>
        issues.push({ code, entityId: String(item._id), entityType: group.type, message, name, path, severity });
      const effectiveTitle = (item.seo?.title || name).trim();
      const fallbackDescription = htmlToPlainText(
        item.description ?? item.excerpt ?? item.summary ?? item.content ?? item.body ?? "",
      );
      const effectiveDescription = (item.seo?.description || fallbackDescription).trim();

      if (item.seo?.robotsIndex === false) {
        add("info", "noindex", "Marked noindex: excluded from search engines and sitemaps.");
        continue;
      }

      if (!item.seo?.title) add("info", "title_fallback", `No custom SEO title; using "${effectiveTitle}".`);
      if (effectiveTitle.length > TITLE_LIMITS.max) add("warning", "title_too_long", `Title is ${effectiveTitle.length} characters (aim for under ${TITLE_LIMITS.max}).`);
      if (effectiveTitle.length < 10) add("warning", "title_too_short", `Title "${effectiveTitle}" is very short.`);

      if (!effectiveDescription) {
        add("error", "missing_description", "No meta description and no description text to fall back on.");
      } else {
        if (!item.seo?.description) add("info", "description_fallback", "No custom meta description; the page text is used.");
        if (item.seo?.description && item.seo.description.length > DESCRIPTION_LIMITS.max) add("warning", "description_too_long", `Meta description is ${item.seo.description.length} characters (aim for ${DESCRIPTION_LIMITS.min}-${DESCRIPTION_LIMITS.max}).`);
        if (item.seo?.description && item.seo.description.length < DESCRIPTION_LIMITS.min) add("warning", "description_too_short", `Meta description is only ${item.seo.description.length} characters.`);
      }

      const images = [
        ...(item.media ?? []),
        ...((item.variants ?? []).flatMap((variant) => variant.media ?? [])),
        item.banner,
        item.featuredImage,
        item.heroImage,
        item.seo?.ogImage,
      ].filter((media): media is MediaRef => Boolean(media?.url));

      if (!images.length && group.type !== "page") add("warning", "missing_image", "No image: social previews will use the global default image.");
      for (const image of images) {
        if (!image.altText || image.altText.trim().length < 3) add("warning", "missing_alt", `Image ${image.url} has no meaningful alt text.`);
      }

      if (item.seo?.canonicalUrl && !item.seo.canonicalUrl.startsWith("/") && !item.seo.canonicalUrl.startsWith(settings.baseUrl)) {
        add("warning", "external_canonical", `Canonical points to another site (${item.seo.canonicalUrl}).`);
      }

      const titleKey = effectiveTitle.toLowerCase();
      titles.set(titleKey, [...(titles.get(titleKey) ?? []), path]);
      if (effectiveDescription) {
        const descriptionKey = effectiveDescription.slice(0, 160).toLowerCase();
        descriptions.set(descriptionKey, [...(descriptions.get(descriptionKey) ?? []), path]);
      }
    }
  }

  for (const [title, paths] of titles) {
    if (paths.length > 1) {
      issues.push({ code: "duplicate_title", entityId: paths.join(","), entityType: "page", message: `${paths.length} pages share the title "${title}": ${paths.join(", ")}`, name: title, path: paths[0], severity: "warning" });
    }
  }

  for (const [description, paths] of descriptions) {
    if (paths.length > 1) {
      issues.push({ code: "duplicate_description", entityId: paths.join(","), entityType: "page", message: `${paths.length} pages share the same meta description: ${paths.join(", ")}`, name: description.slice(0, 60), path: paths[0], severity: "warning" });
    }
  }

  const counts = { error: 0, info: 0, warning: 0 };
  for (const issue of issues) counts[issue.severity] += 1;

  return {
    checked: groups.reduce((total, group) => total + group.items.length, 0),
    counts,
    generatedAt: new Date(),
    issues: issues.sort((a, b) => ["error", "warning", "info"].indexOf(a.severity) - ["error", "warning", "info"].indexOf(b.severity)),
  };
}

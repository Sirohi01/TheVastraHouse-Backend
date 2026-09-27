import sanitizeHtml from "sanitize-html";

/**
 * Rich-text sanitiser for admin-authored HTML (blog posts, CMS/policy pages, campaign emails).
 * Only formatting markup survives: no scripts, iframes, inline event handlers, styles or
 * javascript:/data: URLs. Applied on write so stored content is always safe to render.
 */
export function sanitizeRichHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedAttributes: {
      a: ["href", "title", "target", "rel"],
      img: ["src", "alt", "title", "width", "height", "loading"],
      td: ["colspan", "rowspan"],
      th: ["colspan", "rowspan", "scope"],
    },
    allowedSchemes: ["https", "http", "mailto", "tel"],
    allowedSchemesByTag: { img: ["https"] },
    allowedTags: [
      "h2",
      "h3",
      "h4",
      "p",
      "br",
      "hr",
      "strong",
      "b",
      "em",
      "i",
      "u",
      "s",
      "blockquote",
      "ul",
      "ol",
      "li",
      "a",
      "img",
      "figure",
      "figcaption",
      "table",
      "thead",
      "tbody",
      "tr",
      "th",
      "td",
      "code",
      "pre",
      "span",
    ],
    disallowedTagsMode: "discard",
    transformTags: {
      a: (tagName, attribs) => {
        const external = /^https?:\/\//i.test(attribs.href ?? "");
        return {
          attribs: {
            ...attribs,
            ...(external ? { rel: "noopener noreferrer", target: "_blank" } : {}),
          },
          tagName,
        };
      },
      // H1 is reserved for the page title; demote any authored H1 to keep one H1 per page.
      h1: "h2",
      img: (tagName, attribs) => ({
        attribs: { ...attribs, loading: "lazy" },
        tagName,
      }),
    },
  });
}

/** Plain text for excerpts, meta descriptions and reading-time estimates. */
export function htmlToPlainText(html: string): string {
  return sanitizeHtml(html, { allowedAttributes: {}, allowedTags: [] })
    .replace(/\s+/g, " ")
    .trim();
}

export function estimateReadingMinutes(html: string): number {
  const words = htmlToPlainText(html).split(" ").filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

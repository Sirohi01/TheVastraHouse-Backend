import { z } from "zod";

type Rule = { label: string; pattern: RegExp };

const RULES: Rule[] = [
  { label: "TODO/FIXME/TBD marker", pattern: /\b(?:todo|fixme|tbd|tba)\b/i },
  { label: "placeholder text", pattern: /\b(?:lorem ipsum|placeholder|dummy text|sample text)\b/i },
  {
    label: "internal instruction",
    pattern:
      /\b(?:internal note|note to (?:self|team|dev|editor)|do not (?:publish|write|use|show)|don'?t (?:publish|write|show)|content team|dev(?:eloper)? team|confirm (?:with|this|before)|to be (?:confirmed|added|updated))\b/i,
  },
  {
    label: "drafting instruction (Hinglish)",
    pattern: /\b(?:karna|likhna|likhe|wahi|nahi|nhi|kaise|agar|confirm na ho|ho to|mat likhna)\b/i,
  },
  {
    label: "template token",
    pattern: /\{\{[^}]*\}\}|\[\s*(?:insert|add|your|xx+)[^\]]*\]|<\s*insert[^>]*>/i,
  },
  { label: "repeated placeholder characters", pattern: /(?:\?{3,}|x{4,}|_{4,})/i },
];

/** Returns the label of the first rule the text violates, or undefined when it is clean. */
export function findInternalNote(text: string | undefined | null): string | undefined {
  if (!text) return undefined;
  const plain = text.replace(/<[^>]+>/g, " ");
  return RULES.find((rule) => rule.pattern.test(plain))?.label;
}

/**
 * Removes whole sentences/lines that contain internal notes. Used as defence in depth when
 * serving legacy records; writes are rejected by {@link customerText} instead.
 */
export function stripInternalNotes(text: string | undefined | null): string {
  if (!text) return "";
  const kept = text
    .split(/(?<=[.!?])\s+|\r?\n/)
    .filter((sentence) => sentence.trim() && !findInternalNote(sentence));
  return kept
    .join(" ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Zod refinement: rejects text that looks like an internal note or placeholder. */
export function customerText<T extends z.ZodTypeAny>(schema: T, fieldLabel: string) {
  return schema.superRefine((value, ctx) => {
    if (typeof value !== "string") return;
    const problem = findInternalNote(value);
    if (problem) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${fieldLabel} contains ${problem}. Customer-facing fields must not contain internal notes or placeholders.`,
      });
    }
  });
}

export type ContentWarning = { field: string; message: string };

/** Non-blocking quality checks surfaced to admins (see GET /catalog/admin/content-quality). */
export function auditProductContent(product: {
  name?: string;
  slug?: string;
  description?: string;
  shortDescription?: string;
  fabricDetails?: string;
  washCare?: string;
  sizeGuide?: string;
  highlights?: string[];
  media?: Array<{ altText?: string }>;
  seo?: { title?: string; description?: string };
}): ContentWarning[] {
  const warnings: ContentWarning[] = [];
  const check = (field: string, value: string | undefined) => {
    const problem = findInternalNote(value);
    if (problem) warnings.push({ field, message: `Contains ${problem}.` });
  };

  check("name", product.name);
  check("description", product.description);
  check("shortDescription", product.shortDescription);
  check("fabricDetails", product.fabricDetails);
  check("washCare", product.washCare);
  check("sizeGuide", product.sizeGuide);
  product.highlights?.forEach((item, index) => check(`highlights[${index}]`, item));
  check("seo.title", product.seo?.title);
  check("seo.description", product.seo?.description);

  if (!product.fabricDetails?.trim()) {
    warnings.push({ field: "fabricDetails", message: "Fabric details are missing." });
  }
  if (!product.washCare?.trim()) {
    warnings.push({ field: "washCare", message: "Care instructions are missing." });
  }
  if ((product.description ?? "").trim().length < 80) {
    warnings.push({ field: "description", message: "Description is shorter than 80 characters." });
  }
  if (!product.seo?.description || product.seo.description.length < 70) {
    warnings.push({ field: "seo.description", message: "Meta description is missing or short." });
  }
  if (product.seo?.title && product.seo.title.length > 65) {
    warnings.push({ field: "seo.title", message: "Meta title is longer than 65 characters." });
  }
  if (product.seo?.description && product.seo.description.length > 160) {
    warnings.push({
      field: "seo.description",
      message: "Meta description is longer than 160 characters and may be truncated.",
    });
  }
  const missingAlt = (product.media ?? []).filter((item) => !item.altText?.trim()).length;
  if (missingAlt) {
    warnings.push({ field: "media", message: `${missingAlt} image(s) have no alt text.` });
  }
  return warnings;
}

import { Category } from "../models/Category.js";
import { Collection } from "../models/Collection.js";
import { Product } from "../models/Product.js";
import { SeoSettings } from "../models/SeoSettings.js";
import { Tag } from "../models/Tag.js";

/**
 * Phase 31 — Search & Discovery sized for this catalog (hundreds to low-thousands of SKUs):
 * an in-process index rebuilt at most every INDEX_TTL_MS (and immediately after catalog edits),
 * with typo tolerance (Damerau-Levenshtein), prefix matching for autocomplete, admin-managed
 * synonyms and field-weighted relevance. No external search cluster is required at this scale;
 * the index can be swapped for Typesense/Algolia behind the same `searchProducts` contract.
 */
type IndexedProduct = {
  id: string;
  name: string;
  slug: string;
  tokens: Map<string, number>;
  skus: string[];
  createdAt: number;
  newArrival: boolean;
  bestSeller: boolean;
};

type IndexState = {
  builtAt: number;
  products: IndexedProduct[];
  vocabulary: Set<string>;
  synonyms: Map<string, string[]>;
  boostNewArrivals: boolean;
};

const INDEX_TTL_MS = 2 * 60 * 1000;
const FIELD_WEIGHTS = { category: 3, collection: 3, fabric: 2, name: 10, tag: 4, description: 1 };
let state: IndexState | undefined;
let building: Promise<IndexState> | undefined;

export function invalidateSearchIndex() {
  state = undefined;
}

export function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 1);
}

/** Optimal-string-alignment distance (adjacent transpositions count as one edit). */
export function editDistance(a: string, b: string, max = 2): number {
  if (Math.abs(a.length - b.length) > max) {
    return max + 1;
  }

  const rows = a.length + 1;
  const cols = b.length + 1;
  const d: number[][] = Array.from({ length: rows }, (_, i) => [i, ...new Array(cols - 1).fill(0)]);
  for (let j = 0; j < cols; j += 1) d[0][j] = j;

  for (let i = 1; i < rows; i += 1) {
    let rowMin = Number.POSITIVE_INFINITY;
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
      rowMin = Math.min(rowMin, d[i][j]);
    }
    if (rowMin > max) return max + 1;
  }

  return d[a.length][b.length];
}

function allowedTypos(token: string) {
  if (token.length >= 8) return 2;
  if (token.length >= 4) return 1;
  return 0;
}

export function parseSynonymGroups(groups: string[]): Map<string, string[]> {
  const map = new Map<string, string[]>();

  for (const group of groups) {
    const terms = group
      .split(",")
      .map((term) => term.trim().toLowerCase())
      .filter(Boolean);
    for (const term of terms) {
      map.set(term, [
        ...new Set([...(map.get(term) ?? []), ...terms.filter((item) => item !== term)]),
      ]);
    }
  }

  return map;
}

async function buildIndex(): Promise<IndexState> {
  const [products, categories, collections, tags, settings] = await Promise.all([
    Product.find({ active: true, status: { $ne: "deleted" } })
      .select(
        "name slug description fabricDetails categoryIds collectionIds tagIds variants.sku computedBadges createdAt",
      )
      .lean() as unknown as Promise<Array<Record<string, unknown>>>,
    Category.find({ status: { $ne: "deleted" } })
      .select("name")
      .lean(),
    Collection.find({ status: { $ne: "deleted" } })
      .select("name")
      .lean(),
    Tag.find({ status: { $ne: "deleted" } })
      .select("name")
      .lean(),
    SeoSettings.findOne({ key: "global" }).select("search").lean() as unknown as Promise<{
      search?: { synonyms?: string[]; boostNewArrivals?: boolean };
    } | null>,
  ]);
  const nameOf = (list: Array<Record<string, unknown>>) =>
    new Map(list.map((item) => [String(item._id), String(item.name ?? "")]));
  const categoryNames = nameOf(categories as Array<Record<string, unknown>>);
  const collectionNames = nameOf(collections as Array<Record<string, unknown>>);
  const tagNames = nameOf(tags as Array<Record<string, unknown>>);
  const vocabulary = new Set<string>();
  const indexed: IndexedProduct[] = products.map((product) => {
    const tokens = new Map<string, number>();
    const add = (text: string | undefined, weight: number) => {
      for (const token of tokenize(text ?? "")) {
        tokens.set(token, Math.max(tokens.get(token) ?? 0, weight));
        vocabulary.add(token);
      }
    };
    add(String(product.name ?? ""), FIELD_WEIGHTS.name);
    add(String(product.fabricDetails ?? ""), FIELD_WEIGHTS.fabric);
    add(String(product.description ?? "").slice(0, 600), FIELD_WEIGHTS.description);
    for (const id of (product.categoryIds as unknown[]) ?? [])
      add(categoryNames.get(String(id)), FIELD_WEIGHTS.category);
    for (const id of (product.collectionIds as unknown[]) ?? [])
      add(collectionNames.get(String(id)), FIELD_WEIGHTS.collection);
    for (const id of (product.tagIds as unknown[]) ?? [])
      add(tagNames.get(String(id)), FIELD_WEIGHTS.tag);
    const badges = (product.computedBadges ?? {}) as { newArrival?: boolean; bestSeller?: boolean };

    return {
      bestSeller: Boolean(badges.bestSeller),
      createdAt: new Date(String(product.createdAt ?? 0)).getTime(),
      id: String(product._id),
      name: String(product.name ?? ""),
      newArrival: Boolean(badges.newArrival),
      skus: ((product.variants as Array<{ sku?: string }>) ?? []).map((variant) =>
        String(variant.sku ?? "").toUpperCase(),
      ),
      slug: String(product.slug ?? ""),
      tokens,
    };
  });

  return {
    boostNewArrivals: settings?.search?.boostNewArrivals !== false,
    builtAt: Date.now(),
    products: indexed,
    synonyms: parseSynonymGroups(settings?.search?.synonyms ?? defaultSynonyms),
    vocabulary,
  };
}

// Sensible defaults for Indian ethnic wear; admins can replace them in SEO > Search.
export const defaultSynonyms = [
  "kurta, kurti, kurtis, kurtas",
  "saree, sari, sarees",
  "lehenga, lehnga, ghagra",
  "dupatta, stole, chunni",
  "anarkali, anarkalis",
  "salwar, shalwar",
  "red, maroon, crimson",
  "festive, festival, occasion",
];

async function getIndex() {
  if (state && Date.now() - state.builtAt < INDEX_TTL_MS) {
    return state;
  }

  building ??= buildIndex().finally(() => {
    building = undefined;
  });
  state = await building;
  return state;
}

/** Expands each query token into itself, its synonyms and close spellings found in the index. */
function expandToken(token: string, index: IndexState, allowPrefix: boolean) {
  const variants = new Map<string, number>([[token, 1]]);

  for (const synonym of index.synonyms.get(token) ?? []) {
    for (const part of tokenize(synonym))
      variants.set(part, Math.max(variants.get(part) ?? 0, 0.9));
  }

  const typos = allowedTypos(token);
  for (const word of index.vocabulary) {
    if (variants.has(word)) continue;
    if (allowPrefix && token.length >= 2 && word.startsWith(token)) {
      variants.set(word, 0.8);
      continue;
    }
    if (typos && editDistance(token, word, typos) <= typos) {
      variants.set(word, 0.6);
    }
  }

  return variants;
}

export async function searchProducts(
  query: string,
  options: { limit?: number; prefix?: boolean } = {},
) {
  const index = await getIndex();
  const raw = query.trim();
  const tokens = tokenize(raw);

  if (!tokens.length) {
    return { ids: [] as string[], suggestion: undefined as string | undefined };
  }

  const skuQuery = raw.toUpperCase();
  const expansions = tokens.map((token, position) =>
    expandToken(token, index, options.prefix !== false && position === tokens.length - 1),
  );
  const scored: Array<{ id: string; score: number }> = [];

  for (const product of index.products) {
    if (
      product.skus.some(
        (sku) => sku === skuQuery || (skuQuery.length >= 4 && sku.startsWith(skuQuery)),
      )
    ) {
      scored.push({ id: product.id, score: 1000 });
      continue;
    }

    let score = 0;
    let matchedTokens = 0;
    for (const expansion of expansions) {
      let best = 0;
      for (const [term, confidence] of expansion) {
        const weight = product.tokens.get(term);
        if (weight) best = Math.max(best, weight * confidence);
      }
      if (best > 0) matchedTokens += 1;
      score += best;
    }

    // Require every query word to match something (AND semantics keeps results relevant).
    if (matchedTokens < expansions.length || score <= 0) continue;
    if (product.name.toLowerCase().includes(raw.toLowerCase())) score += 25;
    if (index.boostNewArrivals && product.newArrival) score *= 1.1;
    if (product.bestSeller) score *= 1.05;
    scored.push({ id: product.id, score });
  }

  scored.sort((a, b) => b.score - a.score);
  const suggestion =
    scored.length === 0
      ? tokens
          .map((token) => {
            let bestWord: string | undefined;
            let bestDistance = 3;
            for (const word of index.vocabulary) {
              const distance = editDistance(token, word, 2);
              if (distance < bestDistance) {
                bestDistance = distance;
                bestWord = word;
              }
            }
            return bestWord ?? token;
          })
          .join(" ")
      : undefined;

  return {
    ids: scored.slice(0, options.limit ?? 500).map((item) => item.id),
    suggestion: suggestion && suggestion !== tokens.join(" ") ? suggestion : undefined,
  };
}

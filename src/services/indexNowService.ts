import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";

/**
 * IndexNow tells Bing (and engines that share its index) about new or changed URLs immediately.
 * It is a no-op until INDEXNOW_KEY is set, and never runs for non-public (localhost/http) hosts.
 * The same key must be served by the storefront at /indexnow-key.txt.
 */
const ENDPOINT = "https://api.indexnow.org/indexnow";
const MAX_URLS_PER_REQUEST = 10_000;

export function isIndexNowEnabled() {
  if (!env.INDEXNOW_KEY) return false;
  const site = new URL(env.FRONTEND_PUBLIC_URL);
  return site.protocol === "https:" && site.hostname !== "localhost";
}

export function storefrontUrl(path: string) {
  return `${env.FRONTEND_PUBLIC_URL.replace(/\/$/, "")}${path}`;
}

/** Submits absolute storefront URLs. Never throws: indexing pings must not break admin saves. */
export async function submitToIndexNow(urls: string[]) {
  if (!isIndexNowEnabled()) return { submitted: 0, skipped: true };

  const host = new URL(env.FRONTEND_PUBLIC_URL).hostname;
  const unique = [...new Set(urls)].filter((url) => new URL(url).hostname === host);
  let submitted = 0;

  try {
    for (let i = 0; i < unique.length; i += MAX_URLS_PER_REQUEST) {
      const batch = unique.slice(i, i + MAX_URLS_PER_REQUEST);
      const response = await fetch(ENDPOINT, {
        body: JSON.stringify({
          host,
          key: env.INDEXNOW_KEY,
          keyLocation: storefrontUrl("/indexnow-key.txt"),
          urlList: batch,
        }),
        headers: { "Content-Type": "application/json; charset=utf-8" },
        method: "POST",
        signal: AbortSignal.timeout(8000),
      });

      if (response.status === 200 || response.status === 202) {
        submitted += batch.length;
      } else {
        logger.warn({ status: response.status }, "IndexNow submission rejected");
      }
    }
  } catch (error) {
    logger.warn({ error }, "IndexNow submission failed");
  }

  return { submitted, skipped: false };
}

/** Fire-and-forget helper for request handlers. */
export function notifyIndexNow(paths: string[]) {
  void submitToIndexNow(paths.map(storefrontUrl));
}

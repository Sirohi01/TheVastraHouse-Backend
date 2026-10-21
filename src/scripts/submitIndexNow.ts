import { env } from "../config/env.js";
import { isIndexNowEnabled, submitToIndexNow } from "../services/indexNowService.js";

/** One-off: submit every URL in the live sitemap index to IndexNow. */
async function main() {
  if (!isIndexNowEnabled()) {
    console.error("IndexNow disabled: set INDEXNOW_KEY and an https FRONTEND_PUBLIC_URL.");
    process.exit(1);
  }

  const base = env.FRONTEND_PUBLIC_URL.replace(/\/$/, "");
  const locs = async (url: string) => {
    const xml = await (await fetch(url)).text();
    return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1].replace(/&amp;/g, "&"));
  };
  const urls: string[] = [];
  for (const child of await locs(`${base}/sitemap.xml`)) {
    urls.push(...(await locs(child)));
  }

  console.info(`Submitting ${urls.length} URLs`);
  console.info(await submitToIndexNow(urls));
}

void main();

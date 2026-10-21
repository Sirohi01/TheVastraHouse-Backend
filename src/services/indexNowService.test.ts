import assert from "node:assert/strict";
import test from "node:test";
import { env } from "../config/env.js";
import { isIndexNowEnabled, submitToIndexNow } from "./indexNowService.js";

test("IndexNow is a no-op without a key or on non-https/localhost hosts", async (t) => {
  const mutable = env as unknown as Record<string, unknown>;
  const original = { key: mutable.INDEXNOW_KEY, site: mutable.FRONTEND_PUBLIC_URL };
  t.after(() => {
    mutable.INDEXNOW_KEY = original.key;
    mutable.FRONTEND_PUBLIC_URL = original.site;
  });

  mutable.FRONTEND_PUBLIC_URL = "https://thevastrahouse.co.in";
  mutable.INDEXNOW_KEY = undefined;
  assert.equal(isIndexNowEnabled(), false);

  mutable.INDEXNOW_KEY = "abcdef1234567890";
  mutable.FRONTEND_PUBLIC_URL = "http://localhost:3000";
  assert.equal(isIndexNowEnabled(), false);
  assert.deepEqual(await submitToIndexNow(["http://localhost:3000/shop/x"]), {
    skipped: true,
    submitted: 0,
  });
});

test("IndexNow submits only same-host URLs and never throws on network failure", async (t) => {
  const mutable = env as unknown as Record<string, unknown>;
  const original = { key: mutable.INDEXNOW_KEY, site: mutable.FRONTEND_PUBLIC_URL };
  const realFetch = globalThis.fetch;
  let payload: { host: string; urlList: string[]; keyLocation: string } | undefined;
  t.after(() => {
    mutable.INDEXNOW_KEY = original.key;
    mutable.FRONTEND_PUBLIC_URL = original.site;
    globalThis.fetch = realFetch;
  });

  mutable.FRONTEND_PUBLIC_URL = "https://thevastrahouse.co.in";
  mutable.INDEXNOW_KEY = "abcdef1234567890";
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    payload = JSON.parse(String(init?.body));
    return new Response(null, { status: 200 });
  }) as typeof fetch;

  const ok = await submitToIndexNow([
    "https://thevastrahouse.co.in/shop/a",
    "https://thevastrahouse.co.in/shop/a",
    "https://evil.example/shop/b",
  ]);
  assert.deepEqual(ok, { skipped: false, submitted: 1 });
  assert.deepEqual(payload?.urlList, ["https://thevastrahouse.co.in/shop/a"]);
  assert.equal(payload?.keyLocation, "https://thevastrahouse.co.in/indexnow-key.txt");

  globalThis.fetch = (async () => {
    throw new Error("network down");
  }) as typeof fetch;
  assert.deepEqual(await submitToIndexNow(["https://thevastrahouse.co.in/shop/a"]), {
    skipped: false,
    submitted: 0,
  });
});

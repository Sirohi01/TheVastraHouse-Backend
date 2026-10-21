import assert from "node:assert/strict";
import test from "node:test";
import type { Request, Response } from "express";
import { rateLimit } from "./rateLimit.js";

function run(limiter: ReturnType<typeof rateLimit>, path: string) {
  const headers: Record<string, string> = {};
  const req = { ip: "203.0.113.9", path } as unknown as Request;
  const res = {
    setHeader: (key: string, value: string) => (headers[key] = value),
  } as unknown as Response;
  return new Promise<unknown>((resolve) => {
    void limiter(req, res, (error?: unknown) => resolve(error));
  });
}

test("keyByPath:false throttles one IP across different order numbers", async () => {
  const limiter = rateLimit({
    keyByPath: false,
    keyPrefix: "test-track",
    max: 3,
    windowMs: 60_000,
  });

  for (let i = 0; i < 3; i += 1) {
    assert.equal(await run(limiter, `/track/TVH-20261021-A${i}`), undefined);
  }
  const blocked = (await run(limiter, "/track/TVH-20261021-ZZ")) as { statusCode?: number };
  assert.equal(blocked.statusCode, 429);
});

test("default limiter keeps separate buckets per path", async () => {
  const limiter = rateLimit({ keyPrefix: "test-default", max: 1, windowMs: 60_000 });

  assert.equal(await run(limiter, "/a"), undefined);
  assert.equal(await run(limiter, "/b"), undefined);
  assert.equal(((await run(limiter, "/a")) as { statusCode?: number }).statusCode, 429);
});

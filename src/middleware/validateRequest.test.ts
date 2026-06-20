import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import { validateRequest } from "./validateRequest.js";

test("zod strict schemas reject unknown fields for request validation", () => {
  const schema = z
    .object({
      name: z.string(),
    })
    .strict();

  assert.throws(() => schema.parse({ name: "Brand", isSuperAdmin: true }), /Unrecognized key/);
});

test("request query validation works with Express 5 readonly query getter", async () => {
  const req = {};

  Object.defineProperty(req, "query", {
    configurable: true,
    get() {
      return { limit: "25", page: "2" };
    },
  });

  await new Promise<void>((resolve, reject) => {
    validateRequest({
      query: z
        .object({
          limit: z.coerce.number().int(),
          page: z.coerce.number().int(),
        })
        .strict(),
    })(
      req as Parameters<ReturnType<typeof validateRequest>>[0],
      {} as Parameters<ReturnType<typeof validateRequest>>[1],
      (error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      },
    );
  });

  assert.deepEqual((req as { query: unknown }).query, { limit: 25, page: 2 });
});

import assert from "node:assert/strict";
import test from "node:test";
import { buildQuery, type QueryBuilderConfig } from "./queryBuilder.js";

const config: QueryBuilderConfig = {
  filters: {
    status: { field: "status", operators: ["eq", "in"] },
    createdAt: { field: "createdAt", operators: ["gte", "lte"] },
    name: { field: "name", operators: ["regex"] },
  },
  sorts: {
    createdAt: { field: "createdAt" },
    name: { field: "name" },
  },
};

test("buildQuery maps allow-listed filters and sort fields", () => {
  const query = buildQuery(
    {
      filter: {
        "status.in": ["active", "inactive"],
        "createdAt.gte": "2026-01-01",
        "name.regex": "Silk (Red)",
      },
      sort: "-createdAt,name",
    },
    config,
  );

  assert.deepEqual(query, {
    filter: {
      status: { $in: ["active", "inactive"] },
      createdAt: { $gte: "2026-01-01" },
      name: { $regex: "Silk \\(Red\\)", $options: "i" },
    },
    sort: {
      createdAt: -1,
      name: 1,
    },
  });
});

test("buildQuery rejects unknown filter fields", () => {
  assert.throws(
    () => buildQuery({ filter: { "passwordHash.regex": "x" } }, config),
    /Filter field is not allowed/,
  );
});

test("buildQuery rejects unknown sort fields", () => {
  assert.throws(() => buildQuery({ sort: "-costPrice" }, config), /Sort field is not allowed/);
});

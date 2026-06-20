import assert from "node:assert/strict";
import test from "node:test";
import { buildPaginatedResult, parsePagination } from "./pagination.js";

test("parsePagination returns page, limit, and skip", () => {
  const result = parsePagination({ page: "3", limit: "25" });

  assert.deepEqual(result, {
    page: 3,
    limit: 25,
    skip: 50,
  });
});

test("parsePagination defaults to first page and capped default limit", () => {
  const result = parsePagination({});

  assert.deepEqual(result, {
    page: 1,
    limit: 20,
    skip: 0,
  });
});

test("buildPaginatedResult includes navigation metadata", () => {
  const result = buildPaginatedResult(["a", "b"], 45, { page: 2, limit: 20 });

  assert.equal(result.meta.totalPages, 3);
  assert.equal(result.meta.hasNextPage, true);
  assert.equal(result.meta.hasPreviousPage, true);
});

import { z } from "zod";

const paginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export type PaginationInput = {
  page?: unknown;
  limit?: unknown;
};

export type PaginationOptions = {
  page: number;
  limit: number;
  skip: number;
};

export type PaginatedResult<T> = {
  data: T[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
};

export function parsePagination(input: PaginationInput): PaginationOptions {
  const parsed = paginationSchema.parse(input);
  return {
    page: parsed.page,
    limit: parsed.limit,
    skip: (parsed.page - 1) * parsed.limit,
  };
}

export function buildPaginatedResult<T>(
  data: T[],
  total: number,
  options: Pick<PaginationOptions, "page" | "limit">,
): PaginatedResult<T> {
  const totalPages = Math.ceil(total / options.limit);

  return {
    data,
    meta: {
      page: options.page,
      limit: options.limit,
      total,
      totalPages,
      hasNextPage: options.page < totalPages,
      hasPreviousPage: options.page > 1,
    },
  };
}

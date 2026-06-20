import { z } from "zod";

type FilterConfig = {
  field: string;
  operators?: readonly FilterOperator[];
};

type SortConfig = {
  field: string;
};

export type FilterOperator = "eq" | "in" | "gte" | "lte" | "regex";

export type QueryBuilderConfig = {
  filters: Record<string, FilterConfig>;
  sorts: Record<string, SortConfig>;
};

export type QueryBuilderInput = {
  filter?: Record<string, unknown>;
  sort?: string;
};

export type BuiltQuery = {
  filter: Record<string, unknown>;
  sort: Record<string, 1 | -1>;
};

const primitiveValueSchema = z.union([
  z.string().min(1),
  z.number(),
  z.boolean(),
  z.array(z.union([z.string().min(1), z.number(), z.boolean()])).nonempty(),
]);

export function buildQuery(input: QueryBuilderInput, config: QueryBuilderConfig): BuiltQuery {
  return {
    filter: buildFilter(input.filter ?? {}, config),
    sort: buildSort(input.sort, config),
  };
}

function buildFilter(
  requestedFilters: Record<string, unknown>,
  config: QueryBuilderConfig,
): Record<string, unknown> {
  const mongoFilter: Record<string, unknown> = {};

  for (const [rawKey, rawValue] of Object.entries(requestedFilters)) {
    const [publicField, rawOperator = "eq"] = rawKey.split(".");
    const filterConfig = config.filters[publicField];

    if (!filterConfig) {
      throw new Error(`Filter field is not allowed: ${publicField}`);
    }

    const operator = parseOperator(rawOperator);
    const allowedOperators = filterConfig.operators ?? ["eq"];

    if (!allowedOperators.includes(operator)) {
      throw new Error(`Filter operator is not allowed for ${publicField}: ${operator}`);
    }

    const parsedValue = primitiveValueSchema.parse(rawValue);
    applyFilter(mongoFilter, filterConfig.field, operator, parsedValue);
  }

  return mongoFilter;
}

function buildSort(sort: string | undefined, config: QueryBuilderConfig): Record<string, 1 | -1> {
  if (!sort) {
    return {};
  }

  const mongoSort: Record<string, 1 | -1> = {};
  const sortFields = sort.split(",").map((part) => part.trim());

  for (const sortField of sortFields) {
    const direction = sortField.startsWith("-") ? -1 : 1;
    const publicField = sortField.replace(/^-/, "");
    const sortConfig = config.sorts[publicField];

    if (!sortConfig) {
      throw new Error(`Sort field is not allowed: ${publicField}`);
    }

    mongoSort[sortConfig.field] = direction;
  }

  return mongoSort;
}

function parseOperator(rawOperator: string): FilterOperator {
  if (["eq", "in", "gte", "lte", "regex"].includes(rawOperator)) {
    return rawOperator as FilterOperator;
  }

  throw new Error(`Filter operator is not supported: ${rawOperator}`);
}

function applyFilter(
  mongoFilter: Record<string, unknown>,
  field: string,
  operator: FilterOperator,
  value: string | number | boolean | [string | number | boolean, ...(string | number | boolean)[]],
): void {
  if (operator === "eq") {
    mongoFilter[field] = value;
    return;
  }

  if (operator === "regex") {
    mongoFilter[field] = { $regex: escapeRegex(String(value)), $options: "i" };
    return;
  }

  const operatorMap = {
    in: "$in",
    gte: "$gte",
    lte: "$lte",
  } as const;

  mongoFilter[field] = {
    ...(typeof mongoFilter[field] === "object" && mongoFilter[field] !== null
      ? (mongoFilter[field] as Record<string, unknown>)
      : {}),
    [operatorMap[operator]]: operator === "in" ? (Array.isArray(value) ? value : [value]) : value,
  };
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

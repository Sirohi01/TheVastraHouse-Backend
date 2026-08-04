import { Types } from "mongoose";

type Encoded =
  | { __type: "ObjectId"; value: string }
  | { __type: "Date"; value: string }
  | Encoded[]
  | { [key: string]: Encoded }
  | string
  | number
  | boolean
  | null;

export function encodeForBackup(value: unknown): Encoded {
  if (value instanceof Types.ObjectId) {
    return { __type: "ObjectId", value: value.toHexString() };
  }

  if (value instanceof Date) {
    return { __type: "Date", value: value.toISOString() };
  }

  if (Array.isArray(value)) {
    return value.map((item) => encodeForBackup(item));
  }

  if (value && typeof value === "object") {
    const result: Record<string, Encoded> = {};

    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      result[key] = encodeForBackup(item);
    }

    return result;
  }

  return value as Encoded;
}

export function decodeFromBackup(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => decodeFromBackup(item));
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;

    if (record.__type === "ObjectId" && typeof record.value === "string") {
      return new Types.ObjectId(record.value);
    }

    if (record.__type === "Date" && typeof record.value === "string") {
      return new Date(record.value);
    }

    const result: Record<string, unknown> = {};

    for (const [key, item] of Object.entries(record)) {
      result[key] = decodeFromBackup(item);
    }

    return result;
  }

  return value;
}

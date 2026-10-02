import { AppError } from "../middleware/errorHandler.js";
import { Redirect } from "../models/Redirect.js";

type RedirectLean = {
  _id: unknown;
  source: string;
  destination: string;
  statusCode: number;
  active: boolean;
};

export function normalizeRedirectPath(value: string) {
  const trimmed = value.trim();

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  const [path] = trimmed.split(/[?#]/);
  const withSlash = path.startsWith("/") ? path : `/${path}`;
  return withSlash.length > 1 ? withSlash.replace(/\/+$/, "").toLowerCase() : "/";
}

/**
 * Validates a redirect so it can never create a loop: the destination may not be the source,
 * may not itself redirect back to the source, and chains are collapsed to their final target.
 */
async function assertNoLoop(source: string, destination: string, excludeId?: unknown) {
  if (source === destination) {
    throw new AppError("A redirect cannot point to itself", 400);
  }

  const visited = new Set([source]);
  let current = destination;

  for (let depth = 0; depth < 10; depth += 1) {
    if (visited.has(current)) {
      throw new AppError("This redirect would create a redirect loop", 400);
    }
    visited.add(current);

    const next = (await Redirect.findOne({
      active: true,
      source: current,
      ...(excludeId ? { _id: { $ne: excludeId } } : {}),
    }).lean()) as RedirectLean | null;

    if (!next) {
      return;
    }

    current = normalizeRedirectPath(next.destination);
  }

  throw new AppError("Redirect chain is too long", 400);
}

export async function createRedirect(input: {
  source: string;
  destination: string;
  statusCode?: 301 | 302 | 308;
  active?: boolean;
  createdBy?: string;
  origin?: "manual" | "slug-change";
}) {
  const source = normalizeRedirectPath(input.source);
  const destination = normalizeRedirectPath(input.destination);

  if (/^https?:\/\//i.test(source)) {
    throw new AppError("Redirect source must be a path on this site", 400);
  }

  if (source.startsWith("/admin") || source.startsWith("/api")) {
    throw new AppError("Admin and API paths cannot be redirected", 400);
  }

  await assertNoLoop(source, destination);

  try {
    return await Redirect.create({
      active: input.active ?? true,
      createdBy: input.createdBy,
      destination,
      origin: input.origin ?? "manual",
      source,
      statusCode: input.statusCode ?? 301,
    });
  } catch (error) {
    if ((error as { code?: number }).code === 11000) {
      throw new AppError(`A redirect from ${source} already exists`, 409);
    }
    throw error;
  }
}

export async function updateRedirect(
  id: string,
  input: Partial<{
    source: string;
    destination: string;
    statusCode: 301 | 302 | 308;
    active: boolean;
  }>,
) {
  const redirect = await Redirect.findById(id);

  if (!redirect) {
    throw new AppError("Redirect not found", 404);
  }

  const source = input.source ? normalizeRedirectPath(input.source) : redirect.source;
  const destination = input.destination
    ? normalizeRedirectPath(input.destination)
    : redirect.destination;

  if (input.active !== false) {
    await assertNoLoop(source, destination, redirect._id);
  }

  redirect.source = source;
  redirect.destination = destination;
  if (input.statusCode) redirect.statusCode = input.statusCode;
  if (input.active !== undefined) redirect.active = input.active;
  await redirect.save();
  return redirect;
}

/**
 * Called whenever a product/category/collection/blog/page slug changes: permanently redirects
 * the old URL, and repoints older redirects that targeted it so no chains form.
 */
export async function recordSlugChange(oldPath: string, newPath: string, createdBy?: string) {
  const source = normalizeRedirectPath(oldPath);
  const destination = normalizeRedirectPath(newPath);

  if (source === destination) {
    return;
  }

  // The new URL is live content now; an old redirect away from it would shadow it.
  await Redirect.deleteMany({ source: destination });
  await Redirect.updateMany({ destination: source }, { $set: { destination } });
  await Redirect.updateOne(
    { source },
    {
      $set: { active: true, destination, origin: "slug-change", statusCode: 301 },
      $setOnInsert: { createdBy, source },
    },
    { upsert: true },
  );
}

export async function resolveRedirect(path: string) {
  const source = normalizeRedirectPath(path);
  const redirect = (await Redirect.findOneAndUpdate(
    { active: true, source },
    { $inc: { hits: 1 }, $set: { lastHitAt: new Date() } },
    { new: true },
  ).lean()) as RedirectLean | null;

  return redirect ? { destination: redirect.destination, statusCode: redirect.statusCode } : null;
}

export async function listRedirects() {
  return Redirect.find({}).sort({ updatedAt: -1 }).limit(1000).lean();
}

export async function deleteRedirect(id: string) {
  const result = await Redirect.deleteOne({ _id: id });

  if (!result.deletedCount) {
    throw new AppError("Redirect not found", 404);
  }
}

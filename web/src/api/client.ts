import type { z } from "zod";
import { errorBodySchema, listingSchema, rootsResponseSchema } from "./schemas";
import type { Listing, RootsResponse } from "./schemas";

/** A failed /api call, carrying the server's message where it gave one. */
export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function request<T>(
  path: string,
  schema: z.ZodType<T>,
  init?: RequestInit
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      headers: { Accept: "application/json" },
      ...init
    });
  } catch (cause) {
    // Usually the server stopped or the laptop slept. Either way it should
    // read as a server problem, not a blank screen.
    throw new ApiError(0, "Could not reach the Rhythm server.");
  }

  const text = await response.text();
  if (!response.ok) {
    throw new ApiError(
      response.status,
      serverMessage(text) ?? response.statusText
    );
  }

  let json: unknown;
  try {
    json = JSON.parse(text) as unknown;
  } catch {
    throw new ApiError(
      response.status,
      "The server returned a malformed response."
    );
  }

  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new ApiError(
      response.status,
      "The server returned an unexpected response shape."
    );
  }
  return parsed.data;
}

function serverMessage(text: string): string | undefined {
  try {
    const parsed = errorBodySchema.safeParse(JSON.parse(text) as unknown);
    return parsed.success ? parsed.data.error : undefined;
  } catch {
    return undefined;
  }
}

/** Lists one directory. An empty path is the root itself. */
export function browse(
  path: string,
  options?: { root?: string; signal?: AbortSignal }
): Promise<Listing> {
  const params = new URLSearchParams();
  if (path) params.set("path", path);
  if (options?.root) params.set("root", options.root);
  const query = params.toString();
  return request(
    `/api/browse${query ? `?${query}` : ""}`,
    listingSchema,
    options?.signal ? { signal: options.signal } : undefined
  );
}

export function fetchRoots(options?: {
  signal?: AbortSignal;
}): Promise<RootsResponse> {
  return request(
    "/api/roots",
    rootsResponseSchema,
    options?.signal ? { signal: options.signal } : undefined
  );
}

/** The URL a client plays a file from. */
export function streamUrl(id: string): string {
  return `/api/stream/${encodeURIComponent(id)}`;
}

/** Sizes the art endpoint serves; anything else is a 400. */
export type ArtSize = 64 | 160 | 320 | 640;

/** Cover art URL. 404s when there is none, so callers need a fallback. */
export function artUrl(id: string, size: ArtSize): string {
  return `/api/art/${encodeURIComponent(id)}?size=${size}`;
}

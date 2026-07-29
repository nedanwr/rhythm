import { z } from "zod";

/**
 * Zod lives at the trust boundary and nowhere else: /api responses are parsed
 * here, and the rest of the app is plain typed TypeScript.
 *
 * These mirror the Go structs in server/internal/library by hand for now, so
 * drift surfaces as a parse error rather than as `any`.
 */

export const entrySchema = z.object({
  name: z.string(),
  path: z.string(),
  isDir: z.boolean(),
  id: z.string().optional(),
  ext: z.string().optional(),
  size: z.number().optional(),
  modTime: z.string().optional()
});

export const listingSchema = z.object({
  rootId: z.string(),
  root: z.string(),
  path: z.string(),
  parent: z.string().nullable(),
  entries: z.array(entrySchema)
});

export const rootSchema = z.object({
  id: z.string(),
  name: z.string(),
  path: z.string()
});

export const rootsResponseSchema = z.object({
  libraries: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      roots: z.array(rootSchema)
    })
  )
});

export const errorBodySchema = z.object({ error: z.string() });

export type Entry = z.infer<typeof entrySchema>;
export type Listing = z.infer<typeof listingSchema>;
export type Root = z.infer<typeof rootSchema>;
export type RootsResponse = z.infer<typeof rootsResponseSchema>;

/** A file entry that is known to be playable, i.e. one carrying an id. */
export type Track = Entry & { id: string; isDir: false };

export function isTrack(entry: Entry): entry is Track {
  return !entry.isDir && typeof entry.id === "string" && entry.id.length > 0;
}
